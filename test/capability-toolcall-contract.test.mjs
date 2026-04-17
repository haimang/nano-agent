import test from "node:test";
import assert from "node:assert/strict";

import {
  buildToolCallRequest,
  buildToolCallCancelBody,
  parseToolCallResponse,
} from "../packages/capability-runtime/dist/tool-call.js";
import {
  ToolCallRequestBodySchema,
  ToolCallResponseBodySchema,
  ToolCallCancelBodySchema,
} from "../packages/nacp-core/dist/messages/tool.js";

test("capability-runtime request and cancel helpers align with nacp-core tool schemas", () => {
  const requestBody = buildToolCallRequest({
    capabilityName: "ls",
    input: { path: "/workspace" },
    executionTarget: "local-ts",
    source: "bash-command",
    rawCommand: "ls /workspace",
  });
  assert.equal(ToolCallRequestBodySchema.safeParse(requestBody).success, true);

  const wrappedInputBody = buildToolCallRequest({
    capabilityName: "batch",
    input: ["a", "b"],
    executionTarget: "service-binding",
    source: "structured-tool",
  });
  assert.deepEqual(wrappedInputBody.tool_input, { value: ["a", "b"] });
  assert.equal(
    ToolCallRequestBodySchema.safeParse(wrappedInputBody).success,
    true,
  );

  const cancelBody = buildToolCallCancelBody("user aborted");
  assert.equal(ToolCallCancelBodySchema.safeParse(cancelBody).success, true);
});

test("capability-runtime response parser accepts nacp-core response bodies", () => {
  const okBody = { status: "ok", output: "file1.txt\nfile2.txt" };
  assert.equal(ToolCallResponseBodySchema.safeParse(okBody).success, true);

  const okResult = parseToolCallResponse(okBody);
  assert.equal(okResult.kind, "inline");
  assert.equal(okResult.output, "file1.txt\nfile2.txt");

  const errorBody = {
    status: "error",
    error: { code: "not-found", message: "missing" },
  };
  assert.equal(ToolCallResponseBodySchema.safeParse(errorBody).success, true);

  const errorResult = parseToolCallResponse(errorBody);
  assert.equal(errorResult.kind, "error");
  assert.equal(errorResult.error?.code, "not-found");
  assert.equal(errorResult.error?.message, "missing");
});
