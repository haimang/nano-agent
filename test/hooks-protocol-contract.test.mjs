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
