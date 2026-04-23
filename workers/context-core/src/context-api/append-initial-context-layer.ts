/**
 * D03 F4 stub — `appendInitialContextLayer` helper(P2 Phase 1 落点)
 *
 * Per P1-P5 GPT review R1:
 *   - `ContextAssembler` public API 当前仅 `assemble(layers)` + `setEvidenceWiring()`;
 *     不存在 `appendLayer()` mutator,不能在 assembler 上加 method。
 *   - `ContextLayerKindSchema` 合法枚举仅 6 项(`system / session /
 *     workspace_summary / artifact_summary / recent_transcript / injected`);
 *     `initial_context` 不是合法 kind,本 helper 不得发明。
 *
 * 实现策略:helper 在 assembler **外部** 维护一个 per-assembler 的 pending
 * layers list(WeakMap keyed by assembler instance)。每次 consumer 调
 * `appendInitialContextLayer(assembler, payload)`:
 *   1. 把 payload 映射成 1 条 canonical `ContextLayer`;
 *   2. push 到 pending list。
 * Host 在准备 `assemble()` 入参时,通过 `drainPendingInitialContextLayers
 * (assembler)` 取走 pending list 并合并到既有 turn-level layers 里。
 *
 * 映射 kind 选择口径:
 *   - 默认:`"session"`(最贴合 "前端/上游一次性注入的会话启动上下文" 语义);
 *   - 若未来 payload 形态更像 "一次性前端注入片段",D03 F4 迁到 context-core
 *     时可改为 `"injected"`;本 stub 保守选 `"session"`。
 *
 * `ContextAssembler` public API 保持 byte-identical,`appendInitialContextLayer`
 * 不调 assembler 任何 mutator(也没有 mutator 可调)。
 */

import type { ContextLayer } from "../context-layers.js";
import type { SessionStartInitialContext } from "@haimang/nacp-session";

type InitialContextTarget = object;

/**
 * Rough 4-bytes-per-token estimator; intentionally cheap — D03 F4 final
 * implementation in context-core may replace with a real tokenizer.
 */
function estimateTokens(content: string): number {
  if (!content) return 0;
  // Use UTF-8 byte length / 4 for a stable lower bound.
  let bytes = 0;
  for (const ch of content) {
    const code = ch.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return Math.max(1, Math.ceil(bytes / 4));
}

/**
 * Build canonical `ContextLayer`(s) from a validated
 * `SessionStartInitialContext` payload.
 *
 * Kind selection policy (P2 stub):
 *   - always `"session"` — upstream-inserted session-start context is
 *     conceptually "session prelude", not user message, not system
 *     preamble. Future D03 F4 in context-core may branch on payload
 *     shape (e.g., route realm_hints → "injected").
 *
 * Priority: below the canonical `session` rank centroid so that
 * assembler ordering stays deterministic against other session-kind
 * layers. We park the baseline at `0` (neutral) and offset by 1 per
 * additional pending item to keep tie-breaking stable.
 *
 * `required: false` — host degrades honestly under budget pressure.
 */
export function buildInitialContextLayers(
  payload: SessionStartInitialContext,
  baselinePriorityOffset: number = 0,
): ContextLayer[] {
  const content = JSON.stringify(payload);
  if (!content || content === "{}") {
    return [];
  }
  return [
    {
      kind: "session",
      priority: baselinePriorityOffset,
      content,
      tokenEstimate: estimateTokens(content),
      required: false,
    },
  ];
}

/**
 * Per-assembler pending layers map. `WeakMap` lets the pending list be
 * garbage-collected together with its owning assembler instance — i.e.
 * once the DO instance drops its `composition.workspace.assembler`, the
 * pending buffer disappears too. No module-level leak.
 */
const PENDING: WeakMap<InitialContextTarget, ContextLayer[]> = new WeakMap();

/**
 * Host consumer entry point. Called from `NanoSessionDO.dispatchAdmissibleFrame`
 * when a `session.start` frame carries `body.initial_context`.
 *
 * Semantics:
 *   - payload is already Zod-validated by `SessionStartBodySchema`;
 *   - helper tolerates "empty object" payload by producing 0 layers;
 *   - any future consumer retry appends additional layers (host is
 *     expected to call at most once per session.start in practice);
 *   - helper never touches `assembler.assemble()` directly — the host
 *     retrieves the pending list via `drainPendingInitialContextLayers`
 *     and feeds it to `assemble()` at turn time.
 */
export function appendInitialContextLayer(
  assembler: InitialContextTarget,
  payload: SessionStartInitialContext,
): void {
  const list = PENDING.get(assembler) ?? [];
  const baseline = list.length; // simple tie-breaker offset
  const incoming = buildInitialContextLayers(payload, baseline);
  if (incoming.length === 0) {
    // Preserve an existing entry (don't overwrite with empty) but also
    // don't create one — a fully-empty payload is a no-op.
    if (!PENDING.has(assembler)) {
      PENDING.set(assembler, []);
    }
    return;
  }
  PENDING.set(assembler, [...list, ...incoming]);
}

/**
 * Host-side helper used by `KernelRunner` (or equivalent) just before
 * calling `assembler.assemble(layers)`:
 *
 *   const pending = drainPendingInitialContextLayers(assembler);
 *   const layers = [...turnLayers, ...pending];
 *   const result = assembler.assemble(layers);
 *
 * Draining is intentional — each `session.start` payload should flow
 * into exactly one `assemble()` call. If the host needs to replay,
 * it must re-call `appendInitialContextLayer` explicitly.
 */
export function drainPendingInitialContextLayers(
  assembler: InitialContextTarget,
): ContextLayer[] {
  const list = PENDING.get(assembler);
  if (!list || list.length === 0) {
    return [];
  }
  PENDING.set(assembler, []);
  return list;
}

/**
 * Test-only inspector (not exported from package index). Lets unit
 * tests assert pending-list state without running a full assemble().
 */
export function peekPendingInitialContextLayers(
  assembler: InitialContextTarget,
): readonly ContextLayer[] {
  return PENDING.get(assembler) ?? [];
}
