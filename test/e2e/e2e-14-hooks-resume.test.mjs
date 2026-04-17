import test from "node:test";
import assert from "node:assert/strict";

import {
  HookRegistry,
  HookDispatcher,
  LocalTsRuntime,
  hookEventToSessionBroadcast,
  snapshotRegistry,
  restoreRegistry,
} from "../../packages/hooks/dist/index.js";
import {
  buildSessionCheckpoint,
  restoreSessionCheckpoint,
} from "../../packages/session-do-runtime/dist/index.js";
import { SessionStreamEventBodySchema } from "../../packages/nacp-session/dist/stream-event.js";
import { traceEventToAuditBody } from "../../packages/eval-observability/dist/index.js";
import { AuditRecordBodySchema } from "../../packages/nacp-core/dist/messages/system.js";
import { TURN_UUID, SESSION_UUID, TEAM_UUID, NOW } from "./fixtures/seed-data.mjs";

test("E2E-14: Runtime-registered Session Hooks — aggregate outcomes and cross-resume persistence", async () => {
  // 1. Register 3 handlers in registry + runtime
  const registry = new HookRegistry();
  const runtime = new LocalTsRuntime();
  
  const handlers = [
    { id: "h-diag", handler: async () => ({ action: "continue", additionalContext: "diag" }) },
    { id: "h-update", handler: async () => ({ action: "continue", updatedInput: { tool_input: "ls" }, additionalContext: "updated" }) },
    { id: "h-block", handler: async () => ({ action: "block", additionalContext: "policy violation" }) },
  ];
  
  for (const h of handlers) {
    registry.register({
      id: h.id,
      event: "PreToolUse",
      handler: h.handler,
      runtime: "local-ts",
    });
    runtime.registerHandler(h.id, h.handler);
  }
  
  const dispatcher = new HookDispatcher(registry, new Map([["local-ts", runtime]]));

  // 2. Snapshot registry (snapshotRegistry takes a HookRegistry, not dispatcher)
  const hooksSnapshot = snapshotRegistry(registry);
  assert.equal(hooksSnapshot.handlers.length, 3);

  // 3. Build and restore checkpoint
  const checkpoint = await buildSessionCheckpoint(
    SESSION_UUID,
    TEAM_UUID,
    "attached",
    1,
    { totalTokens: 10, totalTurns: 1, totalDurationMs: 50 },
    {
      getKernelFragment: () => ({}),
      getReplayFragment: async () => ({}),
      getStreamSeqs: () => ({ main: 0 }),
      getWorkspaceFragment: async () => ({}),
      getHooksFragment: () => hooksSnapshot,
    },
  );

  // 4. Restore registry from checkpoint
  const restoredRegistry = restoreRegistry(checkpoint.hooksFragment);
  const restoredRuntime = new LocalTsRuntime();
  
  // Register handler functions in runtime
  for (const h of (checkpoint.hooksFragment?.handlers || [])) {
    const handlerFn = handlers.find(x => x.id === h.id)?.handler;
    if (handlerFn) restoredRuntime.registerHandler(h.id, handlerFn);
  }
  
  const restoredDispatcher = new HookDispatcher(restoredRegistry, new Map([["local-ts", restoredRuntime]]));

  // 5. Verify restored handlers count and order
  assert.equal(restoredRegistry.lookup("PreToolUse").length, 3);

  // 5. Trigger event on restored dispatcher
  const payload = { tool_name: "curl", tool_input: "https://example.com" };
  const aggregated = await restoredDispatcher.emit("PreToolUse", payload);

  assert.equal(aggregated.finalAction, "block");
  assert.equal(aggregated.blocked, true);

  // 6. Stream + audit validation
  const sessionBody = hookEventToSessionBroadcast("PreToolUse", payload, aggregated);
  assert.equal(SessionStreamEventBodySchema.safeParse(sessionBody).success, true);

  const auditBody = traceEventToAuditBody({
    eventKind: "hook.outcome",
    timestamp: NOW,
    sessionUuid: SESSION_UUID,
    teamUuid: TEAM_UUID,
    turnUuid: TURN_UUID,
    toolName: "curl",
    reason: "policy violation",
    durationMs: 3,
  });
  assert.equal(AuditRecordBodySchema.safeParse(auditBody).success, true);
});
