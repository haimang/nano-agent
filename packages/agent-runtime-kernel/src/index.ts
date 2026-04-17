/**
 * @nano-agent/agent-runtime-kernel — Agent Runtime Kernel
 *
 * This is the public API surface. All consumers should import from here.
 */

// ── Version ──
export { KERNEL_VERSION } from "./version.js";

// ── Core types & schemas ──
export {
  KernelPhaseSchema,
  StepKindSchema,
  InterruptReasonSchema,
  StepDecisionSchema,
  RuntimeEventSchema,
} from "./types.js";
export type {
  KernelPhase,
  StepKind,
  InterruptReason,
  StepDecision,
  RuntimeEvent,
  LlmChunk,
  CapabilityChunk,
} from "./types.js";

// ── State ──
export {
  SessionStateSchema,
  TurnPhaseSchema,
  TurnStateSchema,
  PendingToolCallSchema,
  KernelSnapshotSchema,
  createInitialSessionState,
  createTurnState,
  createKernelSnapshot,
} from "./state.js";
export type {
  SessionState,
  TurnPhase,
  TurnState,
  PendingToolCall,
  KernelSnapshot,
} from "./state.js";

// ── Step ──
export { KernelStepSchema } from "./step.js";
export type { KernelStep } from "./step.js";

// ── Delegates ──
export type {
  LlmDelegate,
  CapabilityDelegate,
  HookDelegate,
  CompactDelegate,
  KernelDelegates,
} from "./delegates.js";

// ── Errors ──
export { KernelError, KERNEL_ERROR_CODES } from "./errors.js";
export type { KernelErrorCode } from "./errors.js";

// ── Reducer ──
export { applyAction } from "./reducer.js";
export type { KernelAction } from "./reducer.js";

// ── Scheduler ──
export { scheduleNextStep } from "./scheduler.js";
export type { SchedulerSignals } from "./scheduler.js";

// ── Interrupt ──
export { classifyInterrupt, canResumeFrom } from "./interrupt.js";
export type { InterruptClassification } from "./interrupt.js";

// ── Runner ──
export { KernelRunner } from "./runner.js";
export type { AdvanceStepResult } from "./runner.js";

// ── Events & NACP alignment ──
export {
  mapRuntimeEventToStreamKind,
  buildStreamEventBody,
} from "./events.js";
export type { SessionStreamKind } from "./events.js";

// ── Session stream mapping ──
export { RUNTIME_TO_STREAM_MAP } from "./session-stream-mapping.js";

// ── Message intents ──
export { intentForStep } from "./message-intents.js";
export type { MessageIntent } from "./message-intents.js";

// ── Checkpoint / Restore ──
export {
  buildCheckpointFragment,
  restoreFromFragment,
  validateFragment,
} from "./checkpoint.js";
export type { KernelCheckpointFragment } from "./checkpoint.js";
