/**
 * ZX2 Phase 2 P2-01 / P2-02 — RPC envelope, RpcMeta, and double-headed
 * validation tests.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  RpcErrorCodeSchema,
  RpcErrorSchema,
  RpcEnvelopeSchema,
  RpcMetaSchema,
  RpcCallerSchema,
  okEnvelope,
  errorEnvelope,
  validateRpcCall,
  envelopeFromThrown,
  envelopeFromAuthLike,
} from "../src/rpc.js";
import { NacpValidationError } from "../src/errors.js";

const TRACE = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const TEAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REQUEST = "33333333-3333-4333-8333-333333333333";

const sampleAuthority = {
  team_uuid: TEAM,
  plan_level: "pro" as const,
  membership_level: "admin" as const,
  stamped_by_key: "nano-agent.orchestrator-core@v1",
  stamped_at: "2026-04-27T00:00:00.000+00:00",
};

describe("RpcErrorCodeSchema", () => {
  it("accepts canonical codes", () => {
    expect(RpcErrorCodeSchema.parse("invalid-input")).toBe("invalid-input");
    expect(RpcErrorCodeSchema.parse("permission-denied")).toBe(
      "permission-denied",
    );
    expect(RpcErrorCodeSchema.parse("rpc-parity-failed")).toBe(
      "rpc-parity-failed",
    );
  });

  it("rejects unknown codes", () => {
    expect(() => RpcErrorCodeSchema.parse("totally-made-up")).toThrow();
  });
});

describe("RpcErrorSchema", () => {
  it("requires code/status/message", () => {
    expect(() => RpcErrorSchema.parse({})).toThrow();
    expect(
      RpcErrorSchema.parse({
        code: "invalid-input",
        status: 400,
        message: "bad",
      }),
    ).toEqual({ code: "invalid-input", status: 400, message: "bad" });
  });

  it("accepts optional details", () => {
    const e = RpcErrorSchema.parse({
      code: "invalid-input",
      status: 400,
      message: "bad",
      details: { issues: ["x"] },
    });
    expect(e.details).toEqual({ issues: ["x"] });
  });

  it("rejects status outside 4xx/5xx", () => {
    expect(() =>
      RpcErrorSchema.parse({ code: "invalid-input", status: 200, message: "x" }),
    ).toThrow();
  });
});

describe("RpcEnvelopeSchema", () => {
  it("narrows ok=true onto the data shape", () => {
    const Schema = RpcEnvelopeSchema(z.object({ session_uuid: z.string() }));
    const ok = Schema.parse({ ok: true, data: { session_uuid: "sess-1" } });
    expect(ok).toEqual({ ok: true, data: { session_uuid: "sess-1" } });
  });

  it("narrows ok=false onto the error shape", () => {
    const Schema = RpcEnvelopeSchema(z.unknown());
    const err = Schema.parse({
      ok: false,
      error: { code: "invalid-input", status: 400, message: "bad" },
    });
    expect(err).toEqual({
      ok: false,
      error: { code: "invalid-input", status: 400, message: "bad" },
    });
  });
});

describe("okEnvelope / errorEnvelope helpers", () => {
  it("constructs success envelope", () => {
    expect(okEnvelope({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
  });

  it("constructs error envelope, omitting details when absent", () => {
    expect(errorEnvelope("not-found", 404, "missing")).toEqual({
      ok: false,
      error: { code: "not-found", status: 404, message: "missing" },
    });
  });

  it("includes details when provided", () => {
    expect(errorEnvelope("conflict", 409, "dup", { id: 1 })).toEqual({
      ok: false,
      error: {
        code: "conflict",
        status: 409,
        message: "dup",
        details: { id: 1 },
      },
    });
  });
});

describe("RpcCallerSchema", () => {
  it("accepts known callers", () => {
    for (const c of [
      "orchestrator-core",
      "agent-core",
      "bash-core",
      "web",
      "test",
    ]) {
      expect(RpcCallerSchema.parse(c)).toBe(c);
    }
  });

  it("rejects free-form caller strings", () => {
    expect(() => RpcCallerSchema.parse("not-a-worker")).toThrow();
  });
});

describe("RpcMetaSchema", () => {
  it("requires trace + caller", () => {
    expect(() => RpcMetaSchema.parse({})).toThrow();
    expect(
      RpcMetaSchema.parse({ trace_uuid: TRACE, caller: "orchestrator-core" }),
    ).toEqual({ trace_uuid: TRACE, caller: "orchestrator-core" });
  });

  it("accepts authority + session_uuid + request_uuid", () => {
    const meta = RpcMetaSchema.parse({
      trace_uuid: TRACE,
      caller: "orchestrator-core",
      authority: sampleAuthority,
      session_uuid: SESSION,
      request_uuid: REQUEST,
      source: "session.runtime",
    });
    expect(meta.session_uuid).toBe(SESSION);
    expect(meta.authority?.team_uuid).toBe(TEAM);
    expect(meta.request_uuid).toBe(REQUEST);
    expect(meta.source).toBe("session.runtime");
  });

  it("rejects malformed trace_uuid", () => {
    expect(() =>
      RpcMetaSchema.parse({ trace_uuid: "not-a-uuid", caller: "test" }),
    ).toThrow();
  });
});

describe("validateRpcCall", () => {
  const InputSchema = z.object({ session_uuid: z.string().uuid() });

  it("returns parsed input + meta on a clean call", () => {
    const { input, meta } = validateRpcCall(
      { session_uuid: SESSION },
      { trace_uuid: TRACE, caller: "orchestrator-core" },
      { inputSchema: InputSchema },
    );
    expect(input.session_uuid).toBe(SESSION);
    expect(meta.caller).toBe("orchestrator-core");
  });

  it("throws NacpValidationError on input mismatch", () => {
    expect(() =>
      validateRpcCall(
        { session_uuid: "not-a-uuid" },
        { trace_uuid: TRACE, caller: "test" },
        { inputSchema: InputSchema },
      ),
    ).toThrow(NacpValidationError);
  });

  it("throws on missing trace", () => {
    expect(() =>
      validateRpcCall(
        { session_uuid: SESSION },
        { caller: "test" },
        { inputSchema: InputSchema },
      ),
    ).toThrow(NacpValidationError);
  });

  it("requireAuthority enforces presence", () => {
    expect(() =>
      validateRpcCall(
        { session_uuid: SESSION },
        { trace_uuid: TRACE, caller: "orchestrator-core" },
        { inputSchema: InputSchema, requireAuthority: true },
      ),
    ).toThrow(NacpValidationError);
  });

  it("requireTenant rejects mismatched team", () => {
    expect(() =>
      validateRpcCall(
        { session_uuid: SESSION },
        {
          trace_uuid: TRACE,
          caller: "orchestrator-core",
          authority: sampleAuthority,
        },
        {
          inputSchema: InputSchema,
          requireAuthority: true,
          requireTenant: "ffffffff-ffff-ffff-ffff-ffffffffffff",
        },
      ),
    ).toThrow(NacpValidationError);
  });

  it("requireTenant accepts matching team", () => {
    const { meta } = validateRpcCall(
      { session_uuid: SESSION },
      {
        trace_uuid: TRACE,
        caller: "orchestrator-core",
        authority: sampleAuthority,
      },
      {
        inputSchema: InputSchema,
        requireAuthority: true,
        requireTenant: TEAM,
      },
    );
    expect(meta.authority?.team_uuid).toBe(TEAM);
  });

  it("requireSession enforces session_uuid", () => {
    expect(() =>
      validateRpcCall(
        { session_uuid: SESSION },
        { trace_uuid: TRACE, caller: "test" },
        { inputSchema: InputSchema, requireSession: true },
      ),
    ).toThrow(NacpValidationError);
  });

  it("requireRequestUuid enforces request_uuid", () => {
    expect(() =>
      validateRpcCall(
        { session_uuid: SESSION },
        { trace_uuid: TRACE, caller: "agent-core" },
        { inputSchema: InputSchema, requireRequestUuid: true },
      ),
    ).toThrow(NacpValidationError);
  });
});

describe("envelopeFromThrown", () => {
  it("maps NacpValidationError to invalid-input/400", () => {
    const env = envelopeFromThrown(new NacpValidationError(["bad"]));
    expect(env.ok).toBe(false);
    if (!env.ok) {
      expect(env.error.code).toBe("invalid-input");
      expect(env.error.status).toBe(400);
    }
  });

  it("maps Error with default fallback", () => {
    const env = envelopeFromThrown(new Error("boom"));
    expect(env.ok).toBe(false);
    if (!env.ok) {
      expect(env.error.code).toBe("internal-error");
      expect(env.error.status).toBe(500);
      expect(env.error.message).toBe("boom");
    }
  });

  it("maps Error with caller-supplied fallback", () => {
    const env = envelopeFromThrown(
      new Error("timeout"),
      "upstream-timeout",
      504,
    );
    expect(env.ok).toBe(false);
    if (!env.ok) {
      expect(env.error.code).toBe("upstream-timeout");
      expect(env.error.status).toBe(504);
    }
  });

  it("maps non-Error throws", () => {
    const env = envelopeFromThrown("plain string");
    expect(env.ok).toBe(false);
    if (!env.ok) {
      expect(env.error.message).toBe("plain string");
    }
  });
});

describe("envelopeFromAuthLike", () => {
  it("preserves success", () => {
    const env = envelopeFromAuthLike({ ok: true, data: { x: 1 } });
    expect(env).toEqual({ ok: true, data: { x: 1 } });
  });

  it("preserves a known error code", () => {
    const env = envelopeFromAuthLike({
      ok: false,
      error: { code: "invalid-auth", status: 401, message: "bad" },
    });
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe("invalid-auth");
  });

  it("coerces an unknown error code to internal-error", () => {
    const env = envelopeFromAuthLike({
      ok: false,
      error: { code: "totally-made-up", status: 500, message: "bad" },
    });
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe("internal-error");
  });
});
