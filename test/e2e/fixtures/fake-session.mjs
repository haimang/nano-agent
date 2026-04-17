/**
 * Shared E2E session harness helpers.
 */

import {
  DEFAULT_RUNTIME_CONFIG,
  SessionOrchestrator,
  buildSessionCheckpoint,
  restoreSessionCheckpoint,
  validateSessionCheckpoint,
} from "../../../packages/session-do-runtime/dist/index.js";
import {
  DoStorageTraceSink,
  SessionInspector,
  traceEventToAuditBody,
  classifyEvent,
} from "../../../packages/eval-observability/dist/index.js";
import { SessionStreamEventBodySchema } from "../../../packages/nacp-session/dist/stream-event.js";

export function makeOrchestratorDeps(pushedBodies = []) {
  return {
    advanceStep: async (snapshot) => ({ snapshot, events: [], done: true }),
    buildCheckpoint: (snapshot) => snapshot,
    restoreCheckpoint: (fragment) => fragment,
    createSessionState: () => ({ phase: "idle" }),
    createTurnState: (turnId) => ({ turnId, stepIndex: 0 }),
    emitHook: async () => undefined,
    emitTrace: async () => undefined,
    pushStreamEvent: (_kind, body) => {
      pushedBodies.push(body);
    },
  };
}

export function createOrchestrator(pushedBodies = []) {
  return new SessionOrchestrator(makeOrchestratorDeps(pushedBodies), DEFAULT_RUNTIME_CONFIG);
}

export function createTraceSink() {
  const events = [];
  const sink = {
    async emit(event) {
      const tier = classifyEvent(event.eventKind);
      events.push({ tier, event });
    },
    async flush() {},
  };
  return { sink, events };
}

export function createInspector() {
  return new SessionInspector((candidate) => {
    const result = SessionStreamEventBodySchema.safeParse(candidate);
    return result.success ? { ok: true } : { ok: false, reason: result.error.message };
  });
}

export {
  SessionOrchestrator,
  DEFAULT_RUNTIME_CONFIG,
  buildSessionCheckpoint,
  restoreSessionCheckpoint,
  validateSessionCheckpoint,
  SessionStreamEventBodySchema,
  traceEventToAuditBody,
  SessionInspector,
};
