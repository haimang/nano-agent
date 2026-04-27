/**
 * ZX2 Phase 2 P2-04 — facade-http-v1 contract tests.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  AuthErrorCodeSchema,
  FacadeErrorCodeSchema,
  FacadeErrorSchema,
  FacadeSuccessEnvelopeSchema,
  FacadeErrorEnvelopeSchema,
  FacadeEnvelopeSchema,
  facadeOk,
  facadeError,
  facadeFromAuthEnvelope,
} from "../src/index.js";

const TRACE = "11111111-1111-4111-8111-111111111111";

describe("FacadeErrorCodeSchema", () => {
  it("includes every AuthErrorCode", () => {
    for (const c of AuthErrorCodeSchema.options) {
      expect(FacadeErrorCodeSchema.parse(c)).toBe(c);
    }
  });

  it("includes session/runtime additions", () => {
    expect(FacadeErrorCodeSchema.parse("permission-denied")).toBe(
      "permission-denied",
    );
    expect(FacadeErrorCodeSchema.parse("session-not-running")).toBe(
      "session-not-running",
    );
    expect(FacadeErrorCodeSchema.parse("rpc-parity-failed")).toBe(
      "rpc-parity-failed",
    );
  });

  it("rejects unknown codes", () => {
    expect(() => FacadeErrorCodeSchema.parse("totally-made-up")).toThrow();
  });
});

describe("FacadeErrorSchema", () => {
  it("requires code/status/message", () => {
    expect(() => FacadeErrorSchema.parse({})).toThrow();
    expect(
      FacadeErrorSchema.parse({ code: "invalid-input", status: 400, message: "bad" }),
    ).toEqual({ code: "invalid-input", status: 400, message: "bad" });
  });

  it("accepts optional details", () => {
    const e = FacadeErrorSchema.parse({
      code: "invalid-input",
      status: 400,
      message: "bad",
      details: { issues: ["x"] },
    });
    expect(e.details).toEqual({ issues: ["x"] });
  });
});

describe("FacadeEnvelopeSchema", () => {
  const Schema = FacadeEnvelopeSchema(z.object({ session_uuid: z.string() }));

  it("narrows ok=true with trace_uuid", () => {
    const ok = Schema.parse({
      ok: true,
      data: { session_uuid: "sess-1" },
      trace_uuid: TRACE,
    });
    expect(ok).toEqual({ ok: true, data: { session_uuid: "sess-1" }, trace_uuid: TRACE });
  });

  it("narrows ok=false with trace_uuid", () => {
    const err = Schema.parse({
      ok: false,
      error: { code: "invalid-input", status: 400, message: "bad" },
      trace_uuid: TRACE,
    });
    expect(err.ok).toBe(false);
    expect(err.trace_uuid).toBe(TRACE);
  });

  it("rejects missing trace_uuid", () => {
    expect(() =>
      Schema.parse({ ok: true, data: { session_uuid: "x" } }),
    ).toThrow();
    expect(() =>
      FacadeErrorEnvelopeSchema.parse({
        ok: false,
        error: { code: "invalid-input", status: 400, message: "x" },
      }),
    ).toThrow();
  });

  it("rejects bad trace_uuid", () => {
    expect(() =>
      FacadeSuccessEnvelopeSchema(z.unknown()).parse({
        ok: true,
        data: 1,
        trace_uuid: "not-a-uuid",
      }),
    ).toThrow();
  });
});

describe("facadeOk / facadeError helpers", () => {
  it("constructs success envelope", () => {
    expect(facadeOk({ a: 1 }, TRACE)).toEqual({
      ok: true,
      data: { a: 1 },
      trace_uuid: TRACE,
    });
  });

  it("constructs error envelope (no details)", () => {
    expect(facadeError("not-found", 404, "missing", TRACE)).toEqual({
      ok: false,
      error: { code: "not-found", status: 404, message: "missing" },
      trace_uuid: TRACE,
    });
  });

  it("constructs error envelope with details", () => {
    expect(
      facadeError("conflict", 409, "dup", TRACE, { id: "x" }),
    ).toEqual({
      ok: false,
      error: {
        code: "conflict",
        status: 409,
        message: "dup",
        details: { id: "x" },
      },
      trace_uuid: TRACE,
    });
  });
});

describe("facadeFromAuthEnvelope", () => {
  it("preserves success and stamps trace_uuid", () => {
    const env = facadeFromAuthEnvelope({ ok: true, data: { x: 1 } }, TRACE);
    expect(env).toEqual({ ok: true, data: { x: 1 }, trace_uuid: TRACE });
  });

  it("re-emits a valid auth error code unchanged", () => {
    const env = facadeFromAuthEnvelope(
      {
        ok: false,
        error: { code: "invalid-auth", status: 401, message: "bad" },
      },
      TRACE,
    );
    expect(env.ok).toBe(false);
    if (!env.ok) {
      expect(env.error.code).toBe("invalid-auth");
      expect(env.trace_uuid).toBe(TRACE);
    }
  });

  it("coerces an unknown code to internal-error", () => {
    const env = facadeFromAuthEnvelope(
      {
        ok: false,
        error: { code: "totally-made-up", status: 500, message: "bad" },
      },
      TRACE,
    );
    expect(env.ok).toBe(false);
    if (!env.ok) expect(env.error.code).toBe("internal-error");
  });
});
