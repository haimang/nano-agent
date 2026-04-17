# @nano-agent/agent-runtime-kernel

Step-driven kernel for session actor turn loop.

The kernel owns session and turn state, a scheduler that picks the next
step (LLM call, tool execution, compaction, wait, finish), a pure-function
reducer that handles every state transition, and a `KernelRunner` that
drives delegates one step at a time. It is transport-agnostic: delegates
for LLM, tool capability, hook bus, and compaction are injected so the
same kernel can run against wasm, Workers, or in-process fakes.

## Core concepts

- **`SessionState`** — overall session lifecycle (`phase`, token counter,
  turn count, compact count, createdAt).
- **`TurnState`** — per-turn state (`turnId`, `stepIndex`, `messages`,
  `pendingToolCalls`, `pendingInput`, `interruptReason`).
- **`KernelSnapshot`** — immutable `{ session, activeTurn, version }`
  triple that gets threaded through the reducer and runner.
- **`StepDecision`** — discriminated union emitted by the scheduler
  (`llm_call | tool_exec | hook_emit | compact | wait | finish`).
- **`KernelAction`** — discriminated union consumed by `applyAction`
  (`start_turn | complete_step | llm_response | tool_calls_requested |
  tool_result | interrupt | input_arrived | resume | complete_turn |
  end_session | compact_done`).
- **`KernelRunner`** — async driver with a single `advanceStep(snapshot,
  signals)` entry point. Returns `{ snapshot, events, done }`.
- **`RuntimeEvent`** — internal event union the runner emits. Map to the
  NACP `session.stream.event` wire shape via `buildStreamEventBody`.
- **Delegates** — `LlmDelegate`, `CapabilityDelegate`, `HookDelegate`,
  `CompactDelegate`. The LLM and capability delegates stream strongly
  typed `LlmChunk` / `CapabilityChunk` values.
- **Checkpoint fragment** — `buildCheckpointFragment` /
  `restoreFromFragment`. Version-checked on restore.

## Minimal usage

```ts
import {
  KernelRunner,
  applyAction,
  createInitialSessionState,
  createKernelSnapshot,
  type CapabilityChunk,
  type KernelDelegates,
  type LlmChunk,
  type SchedulerSignals,
} from "@nano-agent/agent-runtime-kernel";

const delegates: KernelDelegates = {
  llm: {
    async *call(): AsyncIterable<LlmChunk> {
      yield { type: "content", content: "hello" };
      yield { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } };
    },
    abort() {},
  },
  capability: {
    async *execute(): AsyncIterable<CapabilityChunk> {
      yield { type: "result", result: null };
    },
    cancel() {},
  },
  hook: { async emit() { return null; } },
  compact: { async requestCompact() { return { tokensFreed: 0 }; } },
};

const runner = new KernelRunner(delegates);
let snap = createKernelSnapshot(createInitialSessionState());
snap = applyAction(snap, { type: "start_turn", turnId: "turn-1" });

const signals: SchedulerSignals = {
  hasMoreToolCalls: false,
  compactRequired: false,
  cancelRequested: false,
  timeoutReached: false,
  llmFinished: false,
};

const r1 = await runner.advanceStep(snap, signals);
// r1.snapshot is the new state; r1.events carries RuntimeEvents to push.

const r2 = await runner.advanceStep(r1.snapshot, { ...signals, llmFinished: true });
// r2.done === true; r2.snapshot.session.phase === "idle".
```

The snapshot is always the source of truth — never mutate it directly.
Every state change MUST flow through `applyAction` so checkpointing and
event emission stay consistent.

## References

- Design: `docs/design/agent-runtime-kernel-by-GPT.md`
- Action plan: `docs/action-plan/agent-runtime-kernel.md`
- Reviews: `docs/code-review/agent-runtime-kernel-by-GPT.md`,
  `docs/code-review/agent-runtime-kernel-by-kimi.md`
