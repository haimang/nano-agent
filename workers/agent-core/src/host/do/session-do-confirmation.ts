import { createLogger } from "@haimang/nacp-core/logger";
import type { SessionRuntimeEnv } from "../env.js";

const logger = createLogger("agent-core");

type DeliveryResult = { ok: boolean; delivered: boolean; reason?: string };
type ConfirmationStatus = "timeout" | "superseded";

export interface SessionDoConfirmationRuntime {
  emitPermissionRequestAndAwait(input: {
    sessionUuid: string;
    requestUuid: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    capability?: string;
    reason?: string;
    timeoutMs?: number;
  }): Promise<Record<string, unknown>>;
  emitElicitationRequestAndAwait(input: {
    sessionUuid: string;
    requestUuid: string;
    prompt: string;
    timeoutMs?: number;
  }): Promise<Record<string, unknown>>;
}

export function createSessionDoConfirmationRuntime(deps: {
  readonly env: () => unknown;
  readonly currentTeamUuid: () => string | null;
  readonly traceUuid: () => string | null;
  readonly pushServerFrameToClient: (
    frame: { readonly kind: string; readonly [k: string]: unknown },
  ) => Promise<DeliveryResult>;
  readonly awaitAsyncAnswer: (input: {
    kind: "permission" | "elicitation";
    requestUuid: string;
    timeoutMs?: number;
  }) => Promise<Record<string, unknown>>;
}): SessionDoConfirmationRuntime {
  const settleConfirmation = async (input: {
    sessionUuid: string;
    requestUuid: string;
    status: ConfirmationStatus;
    decisionPayload: Record<string, unknown>;
  }): Promise<void> => {
    const env = deps.env() as Partial<SessionRuntimeEnv> | undefined;
    const orch = env?.ORCHESTRATOR_CORE;
    if (!orch || typeof orch.settleConfirmation !== "function") return;
    const teamUuid = deps.currentTeamUuid();
    if (!teamUuid) return;
    try {
      await orch.settleConfirmation(
        {
          session_uuid: input.sessionUuid,
          confirmation_uuid: input.requestUuid,
          status: input.status,
          decision_payload: input.decisionPayload,
        },
        {
          trace_uuid: deps.traceUuid() ?? crypto.randomUUID(),
          team_uuid: teamUuid,
        },
      );
    } catch (error) {
      logger.warn("settle-confirmation-failed", {
        code: "internal-error",
        ctx: {
          tag: "settle-confirmation-failed",
          session_uuid: input.sessionUuid,
          request_uuid: input.requestUuid,
          error: String(error),
        },
      });
    }
  };

  const settleTimeout = async (
    input: { sessionUuid: string; requestUuid: string },
    reason: string,
  ): Promise<void> =>
    settleConfirmation({
      sessionUuid: input.sessionUuid,
      requestUuid: input.requestUuid,
      status: "timeout",
      decisionPayload: { reason, source: "agent-core" },
    });

  return {
    async emitPermissionRequestAndAwait(input) {
      const toolName = input.toolName ?? input.capability ?? "unknown";
      const emitted = await deps.pushServerFrameToClient({
        kind: "session.confirmation.request",
        confirmation_uuid: input.requestUuid,
        confirmation_kind: "tool_permission",
        request_uuid: input.requestUuid,
        payload: {
          tool_name: toolName,
          tool_input: input.toolInput ?? {},
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
        },
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      });
      if (!emitted.delivered) {
        const reason = emitted.reason ?? "no-attached-client";
        await settleTimeout(input, reason);
        throw new Error(`permission no decider: ${reason}`);
      }
      try {
        return await deps.awaitAsyncAnswer({
          kind: "permission",
          requestUuid: input.requestUuid,
          timeoutMs: input.timeoutMs,
        });
      } catch (error) {
        await settleTimeout(input, error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    async emitElicitationRequestAndAwait(input) {
      const emitted = await deps.pushServerFrameToClient({
        kind: "session.confirmation.request",
        confirmation_uuid: input.requestUuid,
        confirmation_kind: "elicitation",
        request_uuid: input.requestUuid,
        payload: {
          prompt: input.prompt,
        },
      });
      if (!emitted.delivered) {
        const reason = emitted.reason ?? "no-attached-client";
        await settleTimeout(input, reason);
        throw new Error(`elicitation no decider: ${reason}`);
      }
      try {
        return await deps.awaitAsyncAnswer({
          kind: "elicitation",
          requestUuid: input.requestUuid,
          timeoutMs: input.timeoutMs,
        });
      } catch (error) {
        await settleTimeout(input, error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
  };
}
