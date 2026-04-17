/**
 * Agent Runtime Kernel — Session Stream Mapping
 *
 * Direct mapping table between RuntimeEvent types and the 9
 * nacp-session stream event kinds. This is the explicit freeze
 * of the mapping from design doc appendix B.1.
 */

import type { SessionStreamKind } from "./events.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Mapping Table
// ═══════════════════════════════════════════════════════════════════

export const RUNTIME_TO_STREAM_MAP: Record<string, SessionStreamKind> = {
  "turn.started": "turn.begin",
  "turn.completed": "turn.end",
  "llm.delta": "llm.delta",
  "tool.call.progress": "tool.call.progress",
  "tool.call.result": "tool.call.result",
  "hook.broadcast": "hook.broadcast",
  "compact.notify": "compact.notify",
  "system.notify": "system.notify",
  "session.update": "session.update",
};
