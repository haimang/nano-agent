/**
 * Historical starter sketch for worker-matrix r2.
 *
 * **POST-ZX3 NOTE(2026-04-27)**: Packages referenced below(`agent-runtime-kernel` /
 * `capability-runtime` / `llm-wrapper` / `context-management` / `hooks` /
 * `session-do-runtime`)were physically removed during ZX3 Phase 2 P2-01.
 * Runtime truth now lives in `workers/agent-core/src/{kernel,host,llm,hooks}/`
 * and `workers/bash-core/src/`. This template no longer compiles;preserved as
 * historical sketch only.
 *
 * Current primary runtime truth now lives in:
 * - packages/session-do-runtime/src/composition.ts
 * - packages/session-do-runtime/src/remote-bindings.ts
 * - workers/*/src/
 *
 * Keep this file as a typed reminder of the target assembly shape, not as a
 * claim that worker-matrix is already wired.
 *
 * Carry-over constraints:
 * - `agent.core` stays the host worker, not a binding slot.
 * - DO size policy stays explicit; do not silently raise package defaults.
 * - `BoundedEvalSink` must remain explicit so dedup / overflow stay visible.
 * - `x-nacp-*` headers must be treated as lowercase on binding seams.
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

  const doStorage = env.DO_STORAGE ? new DOStorageAdapter(env.DO_STORAGE) : undefined;

  const registry = new InMemoryCapabilityRegistry();
  const policy = new CapabilityPolicyGate(registry);
  const localTsTarget = new LocalTsTarget();
  const executor = new CapabilityExecutor(registry, policy, localTsTarget);

  const hookRegistry = new HookRegistry();
  const hooks = new HookDispatcher(hookRegistry, options.hookRuntimes);

  const evalSink = new BoundedEvalSink({ maxRecords: 256 });
  const compact = options.llmProvider
    ? new AsyncCompactOrchestrator({
        llmProvider: options.llmProvider,
        policy: DEFAULT_COMPACT_POLICY,
      })
    : undefined;
  const inspector = options.inspectorConfig
    ? new InspectorFacade(options.inspectorConfig)
    : undefined;

  return {
    compositionProfile,
    storage: { r2, kv, d1, doStorage },
    capability: { registry, localTsTarget, executor },
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
