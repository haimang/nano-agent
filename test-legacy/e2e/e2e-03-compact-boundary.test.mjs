import test from "node:test";
import assert from "node:assert/strict";

import {
  CompactBoundaryManager,
  promoteToArtifactRef,
  toNacpRef,
} from "../../packages/workspace-context-artifacts/dist/index.js";
import {
  NacpRefSchema,
  ContextCompactRequestBodySchema,
  ContextCompactResponseBodySchema,
} from "../../packages/nacp-core/dist/index.js";
import { buildStreamEventBody, mapRuntimeEventToStreamKind } from "../../packages/agent-runtime-kernel/dist/events.js";
import { SessionStreamEventBodySchema } from "../../packages/nacp-session/dist/stream-event.js";
import { traceEventToAuditBody } from "../../packages/eval-observability/dist/index.js";
import { TEAM_UUID, NOW } from "./fixtures/seed-data.mjs";

test("E2E-03: Context Compact Boundary — Strip → Summary Ref → Reinjection", async () => {
  const mgr = new CompactBoundaryManager();

  const messages = [
    { role: "user", content: "msg1", tokenEstimate: 80 },
    { role: "assistant", content: "reply1", tokenEstimate: 60 },
    { role: "user", content: "msg2", tokenEstimate: 80 },
    { role: "assistant", content: "reply2", tokenEstimate: 60 },
    { role: "user", content: "msg3", tokenEstimate: 80 },
    { role: "assistant", content: "reply3", tokenEstimate: 60 },
    { role: "user", content: "msg4", tokenEstimate: 80 },
    { role: "assistant", content: "reply4", tokenEstimate: 60 },
  ];

  // history_ref points to a compact-archive artifact
  const summaryRef = promoteToArtifactRef(
    TEAM_UUID,
    "compact summary",
    "text/plain",
    "compact-archive",
    { idFactory: () => "summary-001" },
  );
  const historyRef = toNacpRef(summaryRef);

  // 1. Build compact request
  const requestBody = mgr.buildCompactRequest({
    historyRef,
    messages,
    targetTokenBudget: 200,
  });

  assert.equal(ContextCompactRequestBodySchema.safeParse(requestBody).success, true);
  assert.equal(requestBody.target_token_budget, 200);

  // 2. Pick split point (budget-aware, not count-based)
  const splitPoint = mgr.pickSplitPoint(messages, 200);
  // Suffix must fit in 200 tokens:
  // reply4(60)+msg4(80)=140 <=200; +reply3(60)=200 <=200; +msg3(80)=280 >200
  // splitIndex tracks the first message included in suffix, so split at index 5
  assert.equal(splitPoint, 5);

  // 3. Build compact response
  const responseBody = {
    status: "ok",
    summary_ref: historyRef,
    tokens_before: 500,
    tokens_after: 140,
  };
  assert.equal(ContextCompactResponseBodySchema.safeParse(responseBody).success, true);

  // 4. Apply compact response
  const recentMessages = messages.slice(splitPoint);
  const applied = mgr.applyCompactResponse(recentMessages, responseBody, summaryRef, "0-5");
  assert.ok("messages" in applied);
  assert.equal(applied.messages.length, 1 + recentMessages.length); // boundary + recent

  const boundaryMarker = applied.messages[0];
  assert.equal(boundaryMarker.role, "system");
  assert.ok(boundaryMarker.content.includes("Compact boundary"));

  // 5. NacpRef validation
  assert.equal(NacpRefSchema.safeParse(historyRef).success, true);
  assert.ok(summaryRef.key.startsWith(`tenants/${TEAM_UUID}/`));

  // 6. Compact notify stream event
  const compactEvent = {
    type: "compact.notify",
    status: "completed",
    tokensBefore: 500,
    tokensAfter: 140,
    timestamp: NOW,
  };
  const streamBody = buildStreamEventBody(compactEvent);
  assert.equal(streamBody.kind, "compact.notify");
  assert.equal(SessionStreamEventBodySchema.safeParse(streamBody).success, true);

  // 7. Audit trace (compact.notify is live-only, so use a durable event like tool.call.result)
  const auditBody = traceEventToAuditBody({
    eventKind: "tool.call.result",
    timestamp: NOW,
    sessionUuid: "sess-001",
    teamUuid: TEAM_UUID,
    turnUuid: "turn-001",
    toolName: "compact",
    resultSizeBytes: 256,
    durationMs: 20,
  });
  assert.ok(auditBody);
});
