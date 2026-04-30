/**
 * RHX2 P3-01 unit tests — respond.ts.
 *
 * Coverage targets (RHX2 design §7.3): ≥3 cases. We add ≥7 below to
 * cover the FacadeErrorEnvelope wire shape, header injection, logger
 * mirroring (warn vs critical based on status), Server-Timing
 * formatting, and edge cases (empty timings, invalid status).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  respondWithFacadeError,
  attachServerTimings,
  buildFacadeServerTimings,
  __setLoggerConsoleForTests,
  createLogger,
  type LogRecord,
} from "../../src/observability/logger/index.js";

interface Sink {
  warn: string[];
  error: string[];
}
function sink(): Sink {
  const s: Sink = { warn: [], error: [] };
  __setLoggerConsoleForTests({
    debug: () => {},
    log: () => {},
    warn: (line) => s.warn.push(String(line)),
    error: (line) => s.error.push(String(line)),
  });
  return s;
}

describe("respondWithFacadeError — wire shape", () => {
  afterEach(() => __setLoggerConsoleForTests(null));

  it("[case 1] body matches FacadeErrorEnvelope schema", async () => {
    const res = respondWithFacadeError(
      "rate-limited",
      429,
      "rate limit reached",
      "11111111-1111-4111-8111-111111111111",
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("x-trace-uuid")).toBe("11111111-1111-4111-8111-111111111111");
    const body = await res.json();
    expect(body).toEqual({
      ok: false,
      error: { code: "rate-limited", status: 429, message: "rate limit reached" },
      trace_uuid: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("[case 2] details field included only when defined", async () => {
    const without = await respondWithFacadeError("not-found", 404, "x", "22222222-2222-4222-8222-222222222222").json();
    const withD = await respondWithFacadeError(
      "invalid-input",
      400,
      "bad",
      "33333333-3333-4333-8333-333333333333",
      { field: "team_uuid" },
    ).json();
    expect("details" in (without as { error: object }).error).toBe(false);
    expect((withD as { error: { details: { field: string } } }).error.details).toEqual({ field: "team_uuid" });
  });

  it("[case 3] non-4xx/5xx status throws RangeError (compile-time soft guard)", () => {
    expect(() =>
      respondWithFacadeError("ok", 200, "x", "44444444-4444-4444-8444-444444444444"),
    ).toThrow(RangeError);
    expect(() =>
      respondWithFacadeError("nope", 600, "x", "55555555-5555-4555-8555-555555555555"),
    ).toThrow(RangeError);
  });
});

describe("respondWithFacadeError — logger mirroring", () => {
  let s: Sink;
  beforeEach(() => {
    s = sink();
  });
  afterEach(() => __setLoggerConsoleForTests(null));

  it("[case 4] 4xx status causes logger.warn", () => {
    const logger = createLogger("test-w");
    respondWithFacadeError(
      "rate-limited",
      429,
      "limit",
      "66666666-6666-4666-8666-666666666666",
      undefined,
      { logger },
    );
    expect(s.warn.length).toBe(1);
    expect(s.error.length).toBe(0);
    const rec = JSON.parse(s.warn[0]) as LogRecord;
    expect(rec.code).toBe("rate-limited");
    expect(rec.level).toBe("warn");
    expect((rec.ctx as { http_status?: number }).http_status).toBe(429);
  });

  it("[case 5] 5xx status causes logger.critical (bypasses dedupe)", () => {
    const logger = createLogger("test-w");
    respondWithFacadeError(
      "internal-error",
      500,
      "boom",
      "77777777-7777-4777-8777-777777777777",
      undefined,
      { logger },
    );
    respondWithFacadeError(
      "internal-error",
      500,
      "boom-again",
      "77777777-7777-4777-8777-777777777777",
      undefined,
      { logger },
    );
    // Critical is not deduped; expect 2 lines.
    expect(s.error.length).toBe(2);
    expect(s.error[0]).toMatch(/^\[CRITICAL\] /);
    expect(s.error[1]).toMatch(/^\[CRITICAL\] /);
  });
});

describe("attachServerTimings + buildFacadeServerTimings", () => {
  it("[case 6] formats segments as Server-Timing header, preserves existing", () => {
    const base = new Response("{}", {
      status: 200,
      headers: { "Server-Timing": "preexisting;dur=1.000" },
    });
    const out = attachServerTimings(base, [
      { name: "auth", durMs: 12.345 },
      { name: "agent", durMs: 7 },
      { name: "total", durMs: 33.5 },
    ]);
    expect(out.headers.get("Server-Timing")).toBe(
      "preexisting;dur=1.000, auth;dur=12.345, agent;dur=7, total;dur=33.5",
    );
    expect(out.status).toBe(200);
  });

  it("[case 7] negative / NaN / undefined timing segments are dropped", () => {
    const base = new Response("{}", { status: 200 });
    const out = attachServerTimings(base, [
      { name: "good", durMs: 5 },
      { name: "bad", durMs: -1 },
      { name: "alsoBad", durMs: Number.NaN },
    ]);
    expect(out.headers.get("Server-Timing")).toBe("good;dur=5");
  });

  it("[case 8] empty timings array preserves response identity (no header changes)", () => {
    const base = new Response("{}", { status: 200 });
    const out = attachServerTimings(base, []);
    expect(out).toBe(base);
  });

  it("[case 9] buildFacadeServerTimings omits absent segments", () => {
    const t1 = buildFacadeServerTimings({ totalMs: 100 });
    expect(t1.map((t) => t.name)).toEqual(["total"]);
    const t2 = buildFacadeServerTimings({ totalMs: 100, authMs: 5, agentMs: 30 });
    expect(t2.map((t) => t.name)).toEqual(["auth", "agent", "total"]);
  });

  it("[case 10] description quoted with comma/semicolon stripped + truncated", () => {
    const base = new Response("{}", { status: 200 });
    const out = attachServerTimings(base, [
      { name: "n", durMs: 1, description: "has, comma; and; semis" },
    ]);
    expect(out.headers.get("Server-Timing")).toBe('n;dur=1;desc="has comma and semis"');
  });
});
