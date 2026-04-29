import { appendInitialContextLayer } from "@haimang/context-core-worker/context-api/append-initial-context-layer";
import {
  SessionWebSocketHelper,
  type IngressContext,
  type SessionPhase,
  type SessionStorageLike,
} from "@haimang/nacp-session";
import { verifyTenantBoundary, type DoStorageLike } from "@haimang/nacp-core";
import { extractTurnInput } from "../../turn-ingress.js";
import { transitionPhase } from "../../actor-state.js";
import type { RuntimeConfig } from "../../env.js";
import type { SessionOrchestrator, OrchestrationState } from "../../orchestration.js";
import type { SubsystemHandles } from "../../composition.js";
import type { WsController } from "../../ws-controller.js";
import { acceptIngress } from "../../session-edge.js";
import type { IngressEnvelope } from "../../session-edge.js";

const LAST_SEEN_SEQ_KEY = "session:lastSeenSeq";

type EdgeTraceLayer = "live" | "durable-audit";

export interface SessionDoWsRuntimeContext {
  readonly config: RuntimeConfig;
  readonly doState: {
    readonly storage?: {
      get<T = unknown>(key: string): Promise<T | undefined>;
      put<T = unknown>(key: string, value: T): Promise<void>;
      setAlarm?(scheduledTime: number | Date): Promise<void>;
    };
    acceptWebSocket?(ws: unknown): void;
  };
  readonly wsController: WsController;
  readonly subsystems: SubsystemHandles;
  readonly orchestrator: SessionOrchestrator;
  readonly streamUuid: string;
  getState(): OrchestrationState;
  setState(next: OrchestrationState): void;
  getStreamSeq(): number;
  setStreamSeq(next: number): void;
  buildIngressContext(): IngressContext;
  tenantTeamUuid(): string;
  setLastIngressRejection(next: IngressEnvelope | null): void;
  attachTeamUuid(candidate: string | undefined | null): void;
  getTenantScopedStorage(): DoStorageLike | null;
  wsHelperStorage(): SessionStorageLike | null;
  ensureWsHelper(): SessionWebSocketHelper | null;
  emitEdgeTrace(
    eventKind: string,
    extra?: Record<string, unknown>,
    layer?: EdgeTraceLayer,
  ): Promise<void>;
  restoreFromStorage(): Promise<void>;
  persistCheckpoint(): Promise<void>;
  recordHeartbeat(timestamp: string): void;
  decrementAckPending(): void;
  attachHelperToSocket(rawSocket: unknown): void;
}

async function drainPendingInputs(
  ctx: SessionDoWsRuntimeContext,
  state: OrchestrationState,
): Promise<OrchestrationState> {
  let current = state;
  const safetyCap = Math.max(1, ctx.config.maxTurnSteps);
  for (let i = 0; i < safetyCap; i++) {
    if (current.actorState.pendingInputs.length === 0) return current;
    if (current.actorState.phase === "turn_running") return current;
    const next = await ctx.orchestrator.drainNextPendingInput(current);
    if (next === current) return current;
    current = next;
  }
  return current;
}

export function createSessionDoWsRuntime(ctx: SessionDoWsRuntimeContext) {
  return {
    async webSocketMessage(_ws: unknown, message: string | ArrayBuffer): Promise<void> {
      const raw =
        typeof message === "string"
          ? message
          : new TextDecoder().decode(message);

      const envelope = await this.acceptClientFrame(raw);
      if (!envelope.ok) return;

      await this.dispatchAdmissibleFrame(envelope.messageType, envelope.body);
    },

    async acceptClientFrame(raw: string | unknown): Promise<IngressEnvelope> {
      const state = ctx.getState();
      const result = acceptIngress({
        raw,
        authority: ctx.buildIngressContext(),
        streamSeq: ctx.getStreamSeq(),
        streamUuid: ctx.streamUuid,
        phase: state.actorState.phase as SessionPhase,
      });
      if (!result.ok) {
        ctx.setLastIngressRejection(result);
        return result;
      }

      try {
        ctx.attachTeamUuid(result.frame.authority.team_uuid);
        const doTeamUuid = ctx.tenantTeamUuid();
        await verifyTenantBoundary(result.frame, {
          serving_team_uuid: doTeamUuid,
          do_team_uuid: doTeamUuid,
          accept_delegation: false,
        });
      } catch (err) {
        const rejection: IngressEnvelope = {
          ok: false,
          reason: "schema-invalid",
          message: `tenant boundary verification failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          messageType: result.messageType,
        };
        ctx.setLastIngressRejection(rejection);
        return rejection;
      }

      ctx.setStreamSeq(ctx.getStreamSeq() + 1);
      ctx.setLastIngressRejection(null);
      return result;
    },

    async dispatchAdmissibleFrame(
      messageType: string,
      body: Record<string, unknown> | undefined,
    ): Promise<void> {
      if (messageType === "session.start" && body?.["initial_context"]) {
        const assembler = (
          ctx.subsystems.workspace as
            | { assembler?: import("@nano-agent/workspace-context-artifacts").ContextAssembler }
            | undefined
        )?.assembler;
        if (assembler) {
          try {
            const payload = body["initial_context"] as import("@haimang/nacp-session").SessionStartInitialContext;
            appendInitialContextLayer(assembler, payload);
          } catch (err) {
            const message =
              err instanceof Error
                ? `initial_context_consumer_error: ${err.message}`
                : "initial_context_consumer_error: unknown error";
            const helper = ctx.ensureWsHelper();
            if (helper) {
              try {
                helper.pushEvent(ctx.streamUuid, {
                  kind: "system.notify",
                  severity: "error",
                  message,
                } as unknown as Parameters<typeof helper.pushEvent>[1]);
              } catch {
                // pushEvent failure is non-fatal
              }
            }
          }
        }
      }

      switch (messageType) {
        case "session.start":
        case "session.followup_input": {
          const turnInput = extractTurnInput(messageType, body ?? {});
          if (!turnInput) break;
          const current = ctx.getState();
          if (current.actorState.phase === "turn_running") {
            ctx.setState({
              ...current,
              actorState: {
                ...current.actorState,
                pendingInputs: [...current.actorState.pendingInputs, turnInput],
              },
            });
            break;
          }
          let nextState = await ctx.orchestrator.startTurn(current, turnInput);
          nextState = await drainPendingInputs(ctx, nextState);
          ctx.setState(nextState);
          break;
        }

        case "session.cancel": {
          let nextState = await ctx.orchestrator.cancelTurn(ctx.getState());
          nextState = await drainPendingInputs(ctx, nextState);
          ctx.setState(nextState);
          break;
        }

        case "session.end":
          ctx.setState(await ctx.orchestrator.endSession(ctx.getState()));
          break;

        case "session.resume": {
          const lastSeenSeq = body?.["last_seen_seq"];
          if (typeof lastSeenSeq === "number" && Number.isFinite(lastSeenSeq)) {
            const scoped = ctx.getTenantScopedStorage();
            if (scoped) await scoped.put(LAST_SEEN_SEQ_KEY, lastSeenSeq);
            const helper = ctx.ensureWsHelper();
            if (helper) {
              const helperStorage = ctx.wsHelperStorage();
              if (helperStorage) await helper.restore(helperStorage);
              helper.handleResume(ctx.streamUuid, lastSeenSeq);
            }
          }
          await ctx.restoreFromStorage();
          await ctx.emitEdgeTrace("session.edge.resume", {
            lastSeenSeq: typeof lastSeenSeq === "number" ? lastSeenSeq : null,
          });
          break;
        }

        case "session.stream.ack": {
          const ackedSeq = body?.["acked_seq"];
          const streamUuid = body?.["stream_uuid"];
          if (
            typeof ackedSeq === "number" &&
            Number.isFinite(ackedSeq) &&
            typeof streamUuid === "string"
          ) {
            const helper = ctx.ensureWsHelper();
            if (helper) helper.handleAck(streamUuid, ackedSeq);
          }
          ctx.decrementAckPending();
          break;
        }

        case "session.heartbeat": {
          ctx.recordHeartbeat(new Date().toISOString());
          const helper = ctx.ensureWsHelper();
          if (helper) helper.handleHeartbeat();
          break;
        }

        default:
          break;
      }
    },

    async webSocketClose(_ws: unknown): Promise<void> {
      await ctx.emitEdgeTrace("session.edge.detach");
      await ctx.persistCheckpoint();

      const state = ctx.getState();
      if (state.actorState.phase === "turn_running") {
        const attached = transitionPhase(state.actorState, "attached");
        ctx.setState({
          ...state,
          actorState: transitionPhase(attached, "unattached"),
        });
      } else if (state.actorState.phase === "attached") {
        ctx.setState({
          ...state,
          actorState: transitionPhase(state.actorState, "unattached"),
        });
      }
    },

    async alarm(): Promise<void> {
      const storage = ctx.doState.storage;
      const helper = ctx.ensureWsHelper();
      if (helper && storage) {
        const helperStorage = ctx.wsHelperStorage();
        if (helperStorage) await helper.restore(helperStorage);
      }
      if (storage?.setAlarm) {
        await storage.setAlarm(Date.now() + ctx.config.heartbeatIntervalMs);
      }
    },

    async handleWebSocketUpgrade(sessionId: string): Promise<Response> {
      const result = await ctx.wsController.handleUpgrade(sessionId);
      if (result.status !== 101) {
        const reason = result.status === 400 ? result.reason : "upgrade-failed";
        return new Response(
          JSON.stringify({ error: "Upgrade failed", reason }),
          {
            status: result.status,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      ctx.ensureWsHelper();
      ctx.wsController.attachHooks({
        onMessage: (raw) => this.webSocketMessage(null, raw),
        onClose: () => this.webSocketClose(null),
      });
      await ctx.emitEdgeTrace("session.edge.attach");

      if (typeof ctx.doState.acceptWebSocket === "function") {
        try {
          const pair = new (globalThis as unknown as {
            WebSocketPair?: new () => { 0: unknown; 1: unknown };
          }).WebSocketPair!();
          const serverSocket = (pair as { 1: unknown })[1];
          ctx.doState.acceptWebSocket(serverSocket);
          ctx.attachHelperToSocket(serverSocket);
          return new Response(null, {
            status: 101,
            statusText: "Switching Protocols",
            // @ts-expect-error Cloudflare-only webSocket init field
            webSocket: (pair as { 0: unknown })[0],
          });
        } catch {
          // fall through to synthetic response
        }
      }

      try {
        return new Response(null, { status: 101, statusText: "Switching Protocols" });
      } catch {
        return new Response(null, { status: 200, statusText: "Switching Protocols" });
      }
    },
  };
}
