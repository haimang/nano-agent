import { createLogger, recordAuditEvent } from "@haimang/nacp-core/logger";
import { assertTraceLaw, type TraceContext } from "../../traces.js";
import { createDefaultCompositionFactory } from "../../composition.js";
import type { CompositionFactory, SubsystemHandles } from "../../composition.js";
import { makeRemoteBindingsFactory } from "../../remote-bindings.js";
import type { CrossSeamAnchor } from "../../cross-seam.js";
import type { RuntimeConfig, SessionRuntimeEnv } from "../../env.js";
import { resolveCapabilityBinding } from "../../env.js";
import { SessionOrchestrator } from "../../orchestration.js";
import type { OrchestrationDeps, OrchestrationState } from "../../orchestration.js";
import {
  composeWorkspaceWithEvidence,
  type WorkspaceCompositionHandle,
} from "../../workspace-runtime.js";
import { BoundedEvalSink, extractMessageUuid } from "../../eval-sink.js";
import {
  InMemoryArtifactStore,
  MountRouter,
  WorkspaceNamespace,
  type EvidenceAnchorLike,
} from "@nano-agent/workspace-context-artifacts";
import { D1QuotaRepository } from "../../quota/repository.js";
import {
  QuotaAuthorizer,
  type QuotaRuntimeContext,
} from "../../quota/authorizer.js";
import {
  createMainlineKernelRunner,
  composeCompactSignalProbe,
  createCompactBreaker,
  type CapabilityTransportLike,
} from "../../runtime-mainline.js";
import type { SessionWebSocketHelper } from "@haimang/nacp-session";
import { buildHookAuditRecord } from "../../../hooks/audit.js";
import type { HookEventName } from "../../../hooks/catalog.js";
import { parseHookOutcomeBody } from "../../../hooks/core-mapping.js";
import { HookDispatcher } from "../../../hooks/dispatcher.js";
import { HookRegistry } from "../../../hooks/registry.js";
import { LocalTsRuntime } from "../../../hooks/runtimes/local-ts.js";
import type { HookEmitContext } from "../../../hooks/dispatcher.js";

const logger = createLogger("agent-core");

const DEFAULT_LLM_CALL_LIMIT = 200;
const DEFAULT_TOOL_CALL_LIMIT = 400;
const DEFAULT_SINK_MAX = 1024;

function selectCompositionFactory(
  env: unknown,
  anchorProvider?: () => CrossSeamAnchor | undefined,
): CompositionFactory {
  const e = (env ?? {}) as Partial<SessionRuntimeEnv>;
  const anyRemote = Boolean(
    resolveCapabilityBinding(e) || e.HOOK_WORKER || e.FAKE_PROVIDER_WORKER,
  );
  return anyRemote
    ? makeRemoteBindingsFactory({ anchorProvider })
    : createDefaultCompositionFactory();
}

function readPositiveInt(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.length > 0
        ? Number(value)
        : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

export interface SessionDoRuntimeAssemblyContext {
  readonly env: unknown;
  readonly config: RuntimeConfig;
  readonly compositionFactory?: CompositionFactory;
  readonly streamUuid: string;
  buildCrossSeamAnchor(): CrossSeamAnchor | undefined;
  buildEvidenceAnchor(): EvidenceAnchorLike | undefined;
  buildQuotaContext(turnUuid?: string | null): QuotaRuntimeContext | null;
  getCapabilityTransport(): CapabilityTransportLike | undefined;
  pushServerFrameToClient(frame: {
    readonly kind: string;
    readonly [k: string]: unknown;
  }): Promise<{ ok: boolean; delivered: boolean; reason?: string }>;
  ensureWsHelper(): SessionWebSocketHelper | null;
  buildTraceContext(): TraceContext | undefined;
  currentTeamUuid(): string | null;
  getSessionUuid(): string | null;
}

export interface SessionDoRuntimeAssembly {
  readonly subsystems: SubsystemHandles;
  readonly workspaceComposition: WorkspaceCompositionHandle;
  readonly defaultEvalSink: BoundedEvalSink;
  readonly quotaAuthorizer: QuotaAuthorizer | null;
  readonly orchestrator: SessionOrchestrator;
  readonly state: OrchestrationState;
  // HP5 P2-02 — exposed so HP5 P3 (live caller wiring) and tests can
  // register handlers (e.g. PreToolUse permission) without rebuilding
  // the assembly. Always present in production assembly; the dispatcher
  // itself enforces timeout / depth / fail-closed via existing guards.
  readonly hookDispatcher: HookDispatcher;
}

function buildQuotaAuthorizer(
  env: unknown,
  evalSink: { emit?: (record: unknown) => void | Promise<void> },
): QuotaAuthorizer | null {
  const runtimeEnv = env as Partial<SessionRuntimeEnv> | undefined;
  const db = runtimeEnv?.NANO_AGENT_DB;
  if (!db) return null;
  return new QuotaAuthorizer(
    new D1QuotaRepository(db, {
      allowSeedMissingTeam: runtimeEnv.NANO_AGENT_ALLOW_PREVIEW_TEAM_SEED === "true",
    }),
    {
      llmLimit: readPositiveInt(
        runtimeEnv.NANO_AGENT_LLM_CALL_LIMIT,
        DEFAULT_LLM_CALL_LIMIT,
      ),
      toolLimit: readPositiveInt(
        runtimeEnv.NANO_AGENT_TOOL_CALL_LIMIT,
        DEFAULT_TOOL_CALL_LIMIT,
      ),
      emitTrace: async (event) => {
        assertTraceLaw(event);
        if (evalSink.emit) {
          await evalSink.emit(event);
        }
      },
    },
  );
}

// HP5 P2-02 — HookDispatcher runtime injection.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.6 HP5
//   * docs/design/hero-to-pro/HP5-confirmation-control-plane.md §7 F2
//   * workers/agent-core/src/hooks/dispatcher.ts
//
// Pre-HP5 the dispatcher was an optional seam: when live runtime
// assembly forgot to pass one, hook.emit became a no-op. That made
// `emitPermissionRequestAndAwait()` (and any future PreToolUse / live
// caller) impossible to ship without first re-wiring the host. HP5
// promotes the dispatcher to a *real* runtime dependency that is
// constructed unconditionally during session DO assembly. Existing
// `subsystems.hooks` aggregation (composition / remote-bindings) is
// not removed — we simply guarantee the kernel side has a working
// dispatcher with the local-ts runtime ready to receive handlers from
// future HP5 P3 wiring (PreToolUse permission, elicitation alias).
//
// The dispatcher's existing timeout / depth / fail-closed guards (see
// dispatcher.ts §1-3) are preserved verbatim; we only own the
// instantiation seam.
function createSessionHookDispatcher(): HookDispatcher {
  const registry = new HookRegistry();
  const runtimes = new Map([
    ["local-ts" as const, new LocalTsRuntime()],
  ]);
  return new HookDispatcher(registry, runtimes);
}

function createLiveKernelRunner(
  ctx: Omit<SessionDoRuntimeAssemblyContext, "getCapabilityTransport">,
  capabilityTransport: CapabilityTransportLike | undefined,
  quotaAuthorizer: QuotaAuthorizer | null,
  hookDispatcher: HookDispatcher,
) {
  const runtimeEnv = ctx.env as Partial<SessionRuntimeEnv> | undefined;
  if (!runtimeEnv?.AI) return null;
  // HPX5 F2b — wire WriteTodos backend to orchestrator-core service binding.
  // When LLM emits `tool_use { name: "write_todos" }`, capability execute
  // short-circuits to this backend (runtime-mainline.ts).
  const writeTodosBackend = runtimeEnv.ORCHESTRATOR_CORE?.writeTodos
    ? runtimeEnv.ORCHESTRATOR_CORE.writeTodos.bind(runtimeEnv.ORCHESTRATOR_CORE)
    : undefined;

  return createMainlineKernelRunner({
    ai: runtimeEnv.AI,
    modelCatalogDb: runtimeEnv.NANO_AGENT_DB,
    sessionFileReader: runtimeEnv.FILESYSTEM_CORE,
    quotaAuthorizer,
    capabilityTransport,
    writeTodosBackend,
    contextProvider: () => ctx.buildQuotaContext(),
    anchorProvider: () => ctx.buildCrossSeamAnchor(),
    // HP5 P2-02 — real dispatcher injection. Even with no handlers
    // registered yet, the per-emit timeout / depth / fail-closed
    // guards remain in force so PreToolUse permission and other live
    // callers added in HP5 P3 / HP6 / HP7 land on a fully-functional
    // seam without further runtime-assembly surgery.
    hookDispatcher,
    hookContextProvider: (): HookEmitContext => ({
      sessionUuid: ctx.getSessionUuid() ?? undefined,
    }),
    onUsageCommit: (event) => {
      logger.info("usage-commit", {
        tag: "usage-commit",
        kind: event.kind,
        remaining: event.remaining,
        limitValue: event.limitValue,
      });
      void ctx.pushServerFrameToClient({
        kind: "session.usage.update",
        session_uuid: ctx.getSessionUuid() ?? "unknown",
        quota_kind: event.kind,
        remaining: event.remaining,
        limit_value: event.limitValue,
        detail: event.detail,
      });
    },
    onToolEvent: (event) => {
      if (event.kind === "tool_call_result") {
        void ctx.pushServerFrameToClient({
          kind: "tool.call.result",
          session_uuid: ctx.getSessionUuid() ?? "unknown",
          tool_call_id: event.tool_call_id,
          tool_name: event.tool_name,
          status: event.status ?? "ok",
          ...(event.output !== undefined ? { output: event.output } : {}),
          ...(event.error !== undefined ? { error: event.error } : {}),
        });
        return;
      }
      void ctx.pushServerFrameToClient({
        kind: "llm.delta",
        session_uuid: ctx.getSessionUuid() ?? "unknown",
        content_type: event.kind,
        tool_call_id: event.tool_call_id,
        tool_name: event.tool_name,
        ...(event.tool_input !== undefined ? { tool_input: event.tool_input } : {}),
        ...(event.args_chunk !== undefined ? { args_chunk: event.args_chunk } : {}),
      });
    },
  });
}

function buildOrchestrationDeps(
  ctx: SessionDoRuntimeAssemblyContext,
  subsystems: SubsystemHandles,
  quotaAuthorizer: QuotaAuthorizer | null,
  hookDispatcher: HookDispatcher,
): OrchestrationDeps {
  const liveKernel = createLiveKernelRunner(
    ctx,
    readCapabilityTransport(subsystems),
    quotaAuthorizer,
    hookDispatcher,
  );

  // HPX5 F3 — auto-compact signal probe. When orchestrator-core service
  // binding exposes readContextDurableState, compose:
  //   composeCompactSignalProbe(budgetSource, breaker)
  // breaker = 3 consecutive failed compacts → 7-min cool-down (HP3-D4
  // already implemented in compact-breaker.ts:18-37, 44-55).
  // budgetSource computes `used >= auto_compact_token_limit` from the
  // probe state; default threshold 0.85 of context_window when model
  // has no per-model auto_compact_token_limit.
  const runtimeEnv = ctx.env as Partial<SessionRuntimeEnv> | undefined;
  const contextProbeFn = runtimeEnv?.ORCHESTRATOR_CORE?.readContextDurableState;
  let probeCompactRequired: (() => Promise<boolean>) | undefined;
  if (contextProbeFn) {
    const breaker = createCompactBreaker(3);
    probeCompactRequired = composeCompactSignalProbe(async (): Promise<boolean> => {
      const probeCtx = ctx.buildQuotaContext();
      if (!probeCtx) return false;
      try {
        const state = await contextProbeFn(
          probeCtx.sessionUuid,
          probeCtx.teamUuid,
          { trace_uuid: probeCtx.traceUuid, team_uuid: probeCtx.teamUuid },
        );
        if (!state || !state.usage || !state.model) return false;
        const used = (state.usage.llm_input_tokens ?? 0) + (state.usage.llm_output_tokens ?? 0);
        const window = state.model.context_window ?? 0;
        if (window <= 0) return false;
        const threshold = state.model.effective_context_pct ?? 0.85;
        const limit = state.model.auto_compact_token_limit ?? Math.floor(window * threshold);
        return used >= limit;
      } catch {
        return false;
      }
    }, breaker);
  }

  return {
    ...(probeCompactRequired ? { probeCompactRequired } : {}),
    advanceStep: async (snapshot, signals) => {
      const kernel = subsystems.kernel as
        | {
            advanceStep?: (
              snap: unknown,
              sig: unknown,
            ) => Promise<{ snapshot: unknown; events: unknown[]; done: boolean }>;
          }
        | undefined;
      if (kernel?.advanceStep) return kernel.advanceStep(snapshot, signals);
      if (liveKernel) {
        return liveKernel.advanceStep(
          snapshot as import("../../../kernel/state.js").KernelSnapshot,
          signals as import("../../../kernel/scheduler.js").SchedulerSignals,
        );
      }
      return { snapshot, events: [], done: true };
    },
    buildCheckpoint: (snapshot) => snapshot,
    restoreCheckpoint: (fragment) => fragment,
    createSessionState: () => ({
      phase: "idle",
      turnCount: 0,
      totalTokens: 0,
      compactCount: 0,
      lastCheckpointAt: null,
      createdAt: new Date().toISOString(),
    }),
    createTurnState: (turnId: string) => ({
      turnId,
      stepIndex: 0,
      phase: "pending",
      pendingToolCalls: [],
      messages: [],
      startedAt: new Date().toISOString(),
      interruptReason: null,
      llmFinished: false,
    }),
    emitHook: async (event, payload, context) => {
      const anchor = ctx.buildCrossSeamAnchor();
      const merged = anchor
        ? typeof context === "object" && context !== null
          ? { ...anchor, ...(context as Record<string, unknown>) }
          : { ...anchor, payloadContext: context }
        : context;
      const hooks = subsystems.hooks as
        | { emit?: (e: string, p: unknown, c?: unknown) => Promise<unknown> }
        | undefined;
      if (hooks?.emit) {
        const startedAt = Date.now();
        const result = await hooks.emit(event, payload, merged);
        const orch = ((ctx.env ?? {}) as Partial<SessionRuntimeEnv>).ORCHESTRATOR_CORE;
        const persistAudit = orch?.recordAuditEvent;
        if (typeof persistAudit === "function") {
          try {
            const outcome = parseHookOutcomeBody(result, {
              handlerId: `session.${event}`,
              durationMs: Date.now() - startedAt,
            });
            if (outcome.action !== "continue") {
              const body = buildHookAuditRecord(
                event as HookEventName,
                {
                  finalAction: outcome.action,
                  outcomes: [outcome],
                  blocked: outcome.action === "block" || outcome.action === "stop",
                  blockReason: outcome.additionalContext,
                  updatedInput: outcome.updatedInput,
                  mergedContext: outcome.additionalContext,
                  mergedDiagnostics: outcome.diagnostics,
                },
                Date.now() - startedAt,
                {
                  ref: ctx.getSessionUuid() ? { kind: "session", uuid: ctx.getSessionUuid()! } : undefined,
                  traceContext: anchor
                    ? {
                        traceUuid: anchor.traceUuid,
                        sourceRole: "hook",
                        sourceKey: `session.${event}`,
                      }
                    : undefined,
                },
              );
              await recordAuditEvent(
                {
                  worker: "agent-core",
                  event_kind: body.event_kind,
                  outcome: "denied",
                  ref:
                    body.ref && typeof body.ref.uuid === "string"
                      ? { kind: body.ref.kind, uuid: body.ref.uuid }
                      : undefined,
                  detail: body.detail,
                  trace_uuid: anchor?.traceUuid,
                  session_uuid: ctx.getSessionUuid() ?? undefined,
                  team_uuid: anchor?.teamUuid ?? ctx.currentTeamUuid() ?? undefined,
                },
                async (record) => {
                  await persistAudit.call(orch, record);
                },
              );
            }
          } catch (error) {
            logger.warn("hook-audit-persist-skipped", {
              code: "internal-error",
              ctx: {
                tag: "hook-audit-persist-skipped",
                event,
                error: String(error),
              },
            });
          }
        }
        return result;
      }
      return undefined;
    },
    emitTrace: async (event) => {
      assertTraceLaw(event);
      const evalSink = subsystems.eval as
        | { emit?: (record: unknown) => Promise<void> | void }
        | undefined;
      if (evalSink?.emit) await evalSink.emit(event);
    },
    traceContext: () => ctx.buildTraceContext(),
    pushStreamEvent: (_kind, body) => {
      const helper = ctx.ensureWsHelper();
      if (helper) {
        try {
          helper.pushEvent(
            ctx.streamUuid,
            body as unknown as Parameters<typeof helper.pushEvent>[1],
          );
        } catch {
          // replay / ack state remains authoritative
        }
        return;
      }
      const stream = subsystems.kernel as
        | { pushStreamEvent?: (payload: Record<string, unknown>) => void }
        | undefined;
      if (stream?.pushStreamEvent) stream.pushStreamEvent(body);
    },
    // HPX5 P1-02 — top-level frame emit seam (Q-bridging-6).
    // Confirmation/todos/runtime/restore/item frames go through here
    // (NOT pushStreamEvent which wraps as session.stream.event). Schema
    // validate + system.error fallback live at the caller via
    // packages/nacp-session/src/emit-helpers.ts:emitTopLevelFrame().
    emitTopLevelFrame: (messageType, body) => {
      const helper = ctx.ensureWsHelper();
      if (!helper) return;
      try {
        helper.pushFrame(messageType, body);
      } catch {
        // replay / ack state remains authoritative; emit-helpers caller
        // will surface system.error via pushStreamEvent fallback.
      }
    },
  };
}

function readCapabilityTransport(subsystems: SubsystemHandles): CapabilityTransportLike | undefined {
  const capability = subsystems.capability as
    | {
        serviceBindingTransport?: CapabilityTransportLike;
      }
    | null
    | undefined;
  return capability?.serviceBindingTransport;
}

export function createSessionDoRuntimeAssembly(
  ctx: SessionDoRuntimeAssemblyContext,
): SessionDoRuntimeAssembly {
  const factory =
    ctx.compositionFactory ??
    selectCompositionFactory(ctx.env, () => ctx.buildCrossSeamAnchor());
  const baseSubsystems = factory.create(
    (ctx.env ?? {}) as SessionRuntimeEnv,
    ctx.config,
  );

  let defaultEvalSink = new BoundedEvalSink({ capacity: DEFAULT_SINK_MAX });
  const evalCandidate = baseSubsystems.eval as
    | { sink?: unknown; emit?: (record: unknown) => void | Promise<void> }
    | undefined;
  if (evalCandidate?.sink instanceof BoundedEvalSink) {
    defaultEvalSink = evalCandidate.sink;
  }

  const baseEvalSink = baseSubsystems.eval as
    | { emit?: (record: unknown) => void | Promise<void> }
    | undefined;
  const effectiveEvalSink =
    baseEvalSink?.emit !== undefined
      ? baseEvalSink
      : {
          emit: (record: unknown): void => {
            const messageUuid = extractMessageUuid(record);
            defaultEvalSink.emit({ record, messageUuid });
          },
        };

  let workspaceHandle: WorkspaceCompositionHandle | undefined =
    baseSubsystems.workspace as WorkspaceCompositionHandle | undefined;
  const hasFullWorkspaceShape =
    workspaceHandle !== undefined &&
    workspaceHandle !== null &&
    typeof (workspaceHandle as { assembler?: unknown })?.assembler === "object" &&
    typeof (workspaceHandle as { compactManager?: unknown })?.compactManager === "object" &&
    typeof (workspaceHandle as { snapshotBuilder?: unknown })?.snapshotBuilder === "object" &&
    typeof (workspaceHandle as { captureSnapshot?: unknown })?.captureSnapshot === "function";
  if (!hasFullWorkspaceShape) {
    const evidenceSink = effectiveEvalSink.emit
      ? { emit: (record: unknown) => effectiveEvalSink.emit!(record) }
      : undefined;
    workspaceHandle = composeWorkspaceWithEvidence({
      namespace: new WorkspaceNamespace(new MountRouter()),
      artifactStore: new InMemoryArtifactStore(),
      evidenceSink,
      evidenceAnchor: () => ctx.buildEvidenceAnchor(),
    });
  } else if (effectiveEvalSink.emit) {
    const evidenceSink = {
      emit: (record: unknown) => effectiveEvalSink.emit!(record),
    };
    const evidenceAnchor = () => ctx.buildEvidenceAnchor();
    workspaceHandle!.assembler.setEvidenceWiring({ evidenceSink, evidenceAnchor });
    workspaceHandle!.compactManager.setEvidenceWiring({ evidenceSink, evidenceAnchor });
    workspaceHandle!.snapshotBuilder.setEvidenceWiring({ evidenceSink, evidenceAnchor });
  }

  const subsystems = {
    ...baseSubsystems,
    eval: effectiveEvalSink,
    workspace: workspaceHandle,
  } satisfies SubsystemHandles;
  const quotaAuthorizer = buildQuotaAuthorizer(ctx.env, effectiveEvalSink);
  const hookDispatcher = createSessionHookDispatcher();
  const orchestrator = new SessionOrchestrator(
    buildOrchestrationDeps(ctx, subsystems, quotaAuthorizer, hookDispatcher),
    ctx.config,
  );

  return {
    subsystems,
    workspaceComposition: workspaceHandle!,
    defaultEvalSink,
    quotaAuthorizer,
    orchestrator,
    state: orchestrator.createInitialState(),
    hookDispatcher,
  };
}
