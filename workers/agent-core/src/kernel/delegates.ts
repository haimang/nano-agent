/**
 * Agent Runtime Kernel — Delegate Interfaces
 *
 * These are the contracts that downstream subsystems (LLM provider,
 * capability executor, hook bus, compaction engine) must implement.
 * The kernel itself is agnostic to the concrete implementations.
 */

import type { CapabilityChunk, LlmChunk } from "./types.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — LLM Delegate
// ═══════════════════════════════════════════════════════════════════

export interface LlmDelegate {
  call(request: unknown): AsyncIterable<LlmChunk>;
  abort(): void;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — Capability Delegate
// ═══════════════════════════════════════════════════════════════════

export interface CapabilityDelegate {
  execute(plan: unknown): AsyncIterable<CapabilityChunk>;
  cancel(requestId: string): void;
}

// ═══════════════════════════════════════════════════════════════════
// §3 — Hook Delegate
// ═══════════════════════════════════════════════════════════════════

export interface HookDelegate {
  emit(event: string, payload: unknown): Promise<unknown>;
}

// ═══════════════════════════════════════════════════════════════════
// §4 — Compact Delegate
// ═══════════════════════════════════════════════════════════════════

export interface CompactDelegate {
  requestCompact(budget: unknown): Promise<unknown>;
}

// ═══════════════════════════════════════════════════════════════════
// §5 — Kernel Delegates (composite)
// ═══════════════════════════════════════════════════════════════════

export interface KernelDelegates {
  llm: LlmDelegate;
  capability: CapabilityDelegate;
  hook: HookDelegate;
  compact: CompactDelegate;
}
