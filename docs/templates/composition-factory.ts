/**
 * docs/templates/composition-factory.ts
 *
 * Worker-matrix starter template. This is intentionally a typed sketch:
 * it demonstrates how the already-shipped B2-B7 surfaces fit together
 * without pretending B8 already made the next phase's shell decisions.
 *
 * Evidence-backed constraints:
 * - Keep `agent.core` as the host worker; it is NOT a binding slot.
 * - Keep the shipped DOStorageAdapter default explicit. B7 measured a safe
 *   2 MiB planning value, but raising the package default is still a next-phase
 *   decision, not something B8 silently bakes in.
 * - B7 proved cross-worker eval sink dedup + overflow disclosure on the true
 *   push path; keep `BoundedEvalSink` explicit instead of falling back to an
 *   invisible array sink.
 * - All `x-nacp-*` binding headers must be treated as lowercase on the wire.
 */

import {
  D1Adapter,
  DOStorageAdapter,
  KvAdapter,
  R2Adapter,
  type D1DatabaseBinding,
  type DurableObjectStorageBinding,
  type KVNamespaceBinding,
  type R2BucketBinding,
} from "@nano-agent/storage-topology";
import {
  AsyncCompactOrchestrator,
  DEFAULT_COMPACT_POLICY,
  InspectorFacade,
  type AsyncCompactOrchestratorConfig,
  type InspectorFacadeConfig,
} from "@nano-agent/context-management";
import {
  CapabilityExecutor,
  CapabilityPolicyGate,
  InMemoryCapabilityRegistry,
  LocalTsTarget,
} from "@nano-agent/capability-runtime";
import { HookDispatcher, HookRegistry } from "@nano-agent/hooks";
import {
  ServiceBindingTransport,
  type ServiceBindingTarget,
} from "@haimang/nacp-core";
import {
  hookBroadcastToStreamEvent,
  toolResultToStreamEvent,
} from "@haimang/nacp-session";
import {
  BoundedEvalSink,
  readCompositionProfile,
  type SessionRuntimeEnv,
} from "@nano-agent/session-do-runtime";

export interface WorkerMatrixTemplateEnv extends SessionRuntimeEnv {
  readonly DO_STORAGE?: DurableObjectStorageBinding;
  readonly KV_CONFIG: KVNamespaceBinding;
  readonly R2_ARTIFACTS: R2BucketBinding;
  readonly D1_PRIMARY?: D1DatabaseBinding;
}

export interface WorkerMatrixTemplateOptions {
  readonly sessionUuid: string;
  readonly llmProvider?: AsyncCompactOrchestratorConfig["llmProvider"];
  readonly inspectorConfig?: InspectorFacadeConfig;
  readonly hookRuntimes?: ConstructorParameters<typeof HookDispatcher>[1];
  readonly remoteTargets?: {
    readonly bash?: ServiceBindingTarget;
    readonly filesystem?: ServiceBindingTarget;
    readonly context?: ServiceBindingTarget;
  };
}

export interface WorkerMatrixTemplate {
  readonly compositionProfile: ReturnType<typeof readCompositionProfile>;
  readonly storage: {
    readonly r2: R2Adapter;
    readonly kv: KvAdapter;
    readonly d1?: D1Adapter;
    readonly doStorage?: DOStorageAdapter;
  };
  readonly capability: {
    readonly registry: InMemoryCapabilityRegistry;
    readonly localTsTarget: LocalTsTarget;
    readonly executor: CapabilityExecutor;
  };
  readonly hooks: HookDispatcher;
  readonly evalSink: BoundedEvalSink;
  readonly compact?: AsyncCompactOrchestrator;
  readonly inspector?: InspectorFacade;
  readonly remote: {
    readonly serviceBindingTransportCtor: typeof ServiceBindingTransport;
    readonly targets: WorkerMatrixTemplateOptions["remoteTargets"];
  };
  readonly sessionAdapters: {
    readonly toolResultToStreamEvent: typeof toolResultToStreamEvent;
    readonly hookBroadcastToStreamEvent: typeof hookBroadcastToStreamEvent;
  };
}

export function createWorkerMatrixTemplate(
  env: WorkerMatrixTemplateEnv,
  options: WorkerMatrixTemplateOptions,
): WorkerMatrixTemplate {
  const compositionProfile = readCompositionProfile(env);

  const r2 = new R2Adapter(env.R2_ARTIFACTS);
  const kv = new KvAdapter(env.KV_CONFIG);
  const d1 = env.D1_PRIMARY ? new D1Adapter(env.D1_PRIMARY) : undefined;

  // Keep the shipped package default visible. Worker matrix may later
  // choose to opt into `2_097_152` per B7 F08, but B8 does not silently
  // bake that policy into the starter template.
  const doStorage = env.DO_STORAGE ? new DOStorageAdapter(env.DO_STORAGE) : undefined;

  const registry = new InMemoryCapabilityRegistry();
  const policy = new CapabilityPolicyGate(registry);
  const localTsTarget = new LocalTsTarget();

  // Worker matrix phase 1 decides which minimal handlers belong in the
  // host and which move behind remote workers. Keep the executor shape
  // explicit without pretending B8 already made that split.
  const executor = new CapabilityExecutor(new Map(), policy);

  const hooks = new HookDispatcher(
    new HookRegistry(),
    options.hookRuntimes ?? new Map(),
  );

  // B7 proved the real cross-worker path. Keep the bounded sink explicit.
  const evalSink = new BoundedEvalSink({ capacity: 1024 });

  // When `r2` is wired, the orchestrator may spill oversize summaries to R2
  // instead of failing at the DO cap boundary. Without `r2`, summaries above
  // `DOStorageAdapter.maxValueBytes` fail, so worker matrix should choose that
  // fallback behavior explicitly per worker profile.
  const compact =
    doStorage && options.llmProvider
      ? new AsyncCompactOrchestrator({
          sessionUuid: options.sessionUuid,
          doStorage,
          r2,
          llmProvider: options.llmProvider,
          compactPolicy: DEFAULT_COMPACT_POLICY,
        })
      : undefined;

  const inspector = options.inspectorConfig
    ? new InspectorFacade(options.inspectorConfig)
    : undefined;

  return {
    compositionProfile,
    storage: {
      r2,
      kv,
      d1,
      doStorage,
    },
    capability: {
      registry,
      localTsTarget,
      executor,
    },
    hooks,
    evalSink,
    compact,
    inspector,
    remote: {
      serviceBindingTransportCtor: ServiceBindingTransport,
      targets: options.remoteTargets,
    },
    sessionAdapters: {
      toolResultToStreamEvent,
      hookBroadcastToStreamEvent,
    },
  };
}
