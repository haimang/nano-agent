import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHookEmitBody,
  buildHookOutcomeBody,
  parseHookOutcomeBody,
  hookEventToSessionBroadcast,
  buildHookAuditRecord,
} from "../packages/hooks/dist/index.js";
import {
  HookEmitBodySchema,
  HookOutcomeBodySchema,
} from "../packages/nacp-core/dist/messages/hook.js";
import { AuditRecordBodySchema } from "../packages/nacp-core/dist/messages/system.js";
import { SessionStreamEventBodySchema } from "../packages/nacp-session/dist/stream-event.js";

test("hooks core/session/audit helpers align with nacp-core and nacp-session schemas", () => {
  const emitBody = buildHookEmitBody("PreToolUse", {
    tool_name: "Bash",
    tool_input: "ls -la",
  });
  assert.equal(HookEmitBodySchema.safeParse(emitBody).success, true);

  const outcomeBody = buildHookOutcomeBody({
    action: "continue",
    handlerId: "handler-1",
    durationMs: 12,
    updatedInput: { tool_input: "ls" },
    additionalContext: "allowed",
  });
  assert.equal(HookOutcomeBodySchema.safeParse(outcomeBody).success, true);

  const parsedOutcome = parseHookOutcomeBody(
    { ok: false, block: { reason: "policy violation" } },
    { handlerId: "handler-2", durationMs: 8 },
  );
  assert.equal(parsedOutcome.action, "block");
  assert.equal(parsedOutcome.additionalContext, "policy violation");

  const aggregatedOutcome = {
    finalAction: "continue",
    outcomes: [
      {
        action: "continue",
        handlerId: "handler-1",
        durationMs: 12,
        additionalContext: "allowed",
      },
    ],
    blocked: false,
    mergedContext: "allowed",
  };

  const sessionBody = hookEventToSessionBroadcast(
    "PreToolUse",
    { tool_name: "Bash", tool_input: "ls -la" },
    aggregatedOutcome,
  );
  assert.equal(SessionStreamEventBodySchema.safeParse(sessionBody).success, true);

  const auditBody = buildHookAuditRecord("PreToolUse", aggregatedOutcome, 12);
  assert.equal(AuditRecordBodySchema.safeParse(auditBody).success, true);
});

test("hook audit records carry trace-first fields when a trace context is threaded in", async () => {
  const { auditBodyToTraceEvent, validateTraceEvent } = await import(
    "../packages/eval-observability/dist/index.js"
  );

  const TRACE_UUID = "66666666-6666-4666-8666-666666666666";
  const TURN_UUID = "77777777-7777-4777-8777-777777777777";
  const SESSION_UUID = "88888888-8888-4888-8888-888888888888";
  const aggregatedOutcome = {
    finalAction: "continue",
    outcomes: [
      {
        action: "continue",
        handlerId: "handler-1",
        durationMs: 12,
        additionalContext: "allowed",
      },
    ],
    blocked: false,
    mergedContext: "allowed",
  };

  const body = buildHookAuditRecord("PreToolUse", aggregatedOutcome, 12, {
    timestamp: "2026-04-18T10:00:00.000Z",
    traceContext: {
      traceUuid: TRACE_UUID,
      sourceRole: "hook",
      sourceKey: "nano-agent.hook.dispatcher@v1",
      turnUuid: TURN_UUID,
    },
  });

  assert.equal(AuditRecordBodySchema.safeParse(body).success, true);
  assert.equal(body.detail.traceUuid, TRACE_UUID);
  assert.equal(body.detail.sourceRole, "hook");
  assert.equal(body.detail.turnUuid, TURN_UUID);

  const recovered = auditBodyToTraceEvent(body, {
    sessionUuid: SESSION_UUID,
    teamUuid: "team-z",
    timestamp: "2026-04-18T10:00:00.000Z",
  });
  assert.equal(recovered.traceUuid, TRACE_UUID);
  assert.equal(recovered.sourceRole, "hook");
  assert.deepEqual(validateTraceEvent(recovered), []);
});
