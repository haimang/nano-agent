import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  buildToolCallRequest,
  buildToolCallCancelBody,
  parseToolCallResponse,
} from "../src/tool-call.js";
import type { CapabilityPlan } from "../src/types.js";

// Local re-declaration of the NACP schema shapes so this package can
// validate against them without taking a runtime dependency on
// @haimang/nacp-core. These MUST stay in sync with
// packages/nacp-core/src/messages/tool.ts.
const ToolCallRequestBodySchema = z.object({
  tool_name: z.string().min(1).max(64),
  tool_input: z.record(z.string(), z.unknown()),
});
const ToolCallResponseBodySchema = z.object({
  status: z.enum(["ok", "error"]),
  output: z.string().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
const ToolCallCancelBodySchema = z.object({
  reason: z.string().max(256).optional(),
});

describe("buildToolCallRequest", () => {
  it("builds a request body that conforms to the NACP schema", () => {
    const plan: CapabilityPlan = {
      capabilityName: "ls",
      input: { path: "/workspace" },
      executionTarget: "local-ts",
      source: "bash-command",
      rawCommand: "ls /workspace",
    };

    const body = buildToolCallRequest(plan);
    expect(body.tool_name).toBe("ls");
    expect(body.tool_input).toEqual({ path: "/workspace" });

    const parsed = ToolCallRequestBodySchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it("wraps string inputs as { value: ... } to satisfy tool_input schema", () => {
    const plan: CapabilityPlan = {
      capabilityName: "echo",
      input: "hello",
      executionTarget: "local-ts",
      source: "structured-tool",
    };
    const body = buildToolCallRequest(plan);
    expect(body.tool_input).toEqual({ value: "hello" });
    expect(ToolCallRequestBodySchema.safeParse(body).success).toBe(true);
  });

  it("wraps array inputs as { value: [...] }", () => {
    const plan: CapabilityPlan = {
      capabilityName: "batch",
      input: [1, 2, 3],
      executionTarget: "local-ts",
      source: "structured-tool",
    };
    const body = buildToolCallRequest(plan);
    expect(body.tool_input).toEqual({ value: [1, 2, 3] });
    expect(ToolCallRequestBodySchema.safeParse(body).success).toBe(true);
  });

  it("wraps null inputs as { value: null }", () => {
    const plan: CapabilityPlan = {
      capabilityName: "noop",
      input: null,
      executionTarget: "local-ts",
      source: "structured-tool",
    };
    const body = buildToolCallRequest(plan);
    expect(body.tool_input).toEqual({ value: null });
    expect(ToolCallRequestBodySchema.safeParse(body).success).toBe(true);
  });

  it("does NOT include envelope fields (method/params/source/rawCommand)", () => {
    const plan: CapabilityPlan = {
      capabilityName: "ls",
      input: { path: "/" },
      executionTarget: "local-ts",
      source: "bash-command",
      rawCommand: "ls /",
    };
    const body = buildToolCallRequest(plan) as Record<string, unknown>;
    expect(body["method"]).toBeUndefined();
    expect(body["params"]).toBeUndefined();
    expect(body["source"]).toBeUndefined();
    expect(body["rawCommand"]).toBeUndefined();
    expect(body["executionTarget"]).toBeUndefined();
  });
});

describe("buildToolCallCancelBody", () => {
  it("returns an empty body when no reason is given", () => {
    const body = buildToolCallCancelBody();
    expect(body).toEqual({});
    expect(ToolCallCancelBodySchema.safeParse(body).success).toBe(true);
  });

  it("returns a body with reason when provided", () => {
    const body = buildToolCallCancelBody("user aborted");
    expect(body).toEqual({ reason: "user aborted" });
    expect(ToolCallCancelBodySchema.safeParse(body).success).toBe(true);
  });
});

describe("parseToolCallResponse", () => {
  it("parses a successful response (status=ok) as inline", () => {
    const body = {
      status: "ok",
      output: "file1.txt\nfile2.txt",
    };
    expect(ToolCallResponseBodySchema.safeParse(body).success).toBe(true);

    const result = parseToolCallResponse(body);
    expect(result.kind).toBe("inline");
    expect(result.output).toBe("file1.txt\nfile2.txt");
    expect(result.outputSizeBytes).toBeGreaterThan(0);
  });

  it("parses a successful response with no output as inline with undefined output", () => {
    const body = { status: "ok" };
    const result = parseToolCallResponse(body);
    expect(result.kind).toBe("inline");
    expect(result.output).toBeUndefined();
    expect(result.outputSizeBytes).toBeUndefined();
  });

  it("parses an error response (status=error) with error payload", () => {
    const body = {
      status: "error",
      error: { code: "not-found", message: "File not found" },
    };
    expect(ToolCallResponseBodySchema.safeParse(body).success).toBe(true);

    const result = parseToolCallResponse(body);
    expect(result.kind).toBe("error");
    expect(result.error?.code).toBe("not-found");
    expect(result.error?.message).toBe("File not found");
  });

  it("returns error for missing status field", () => {
    const result = parseToolCallResponse({ output: "hi" });
    expect(result.kind).toBe("error");
    expect(result.error?.code).toBe("invalid-response");
  });

  it("returns error for invalid status value", () => {
    const result = parseToolCallResponse({ status: "weird" });
    expect(result.kind).toBe("error");
    expect(result.error?.code).toBe("invalid-response");
  });

  it("returns error for null body", () => {
    const result = parseToolCallResponse(null);
    expect(result.kind).toBe("error");
    expect(result.error?.code).toBe("invalid-response");
  });

  it("returns error for non-object body", () => {
    const result = parseToolCallResponse("not an object");
    expect(result.kind).toBe("error");
    expect(result.error?.code).toBe("invalid-response");
  });
});
