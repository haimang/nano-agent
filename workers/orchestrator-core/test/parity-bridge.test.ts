// ZX4 Phase 2 — parity-bridge unit tests for JSON-pointer body diff.
// Covers: equal bodies, value mismatch, rpc-only / fetch-only keys,
// nested object, array length mismatch, JSON pointer escape (~ /),
// entry cap, string preview truncation, logParityFailure structured fields.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  computeBodyDiff,
  jsonDeepEqual,
  logParityFailure,
} from "../src/parity-bridge.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";

describe("computeBodyDiff", () => {
  it("returns empty array for identical bodies", () => {
    expect(computeBodyDiff({ a: 1, b: "x" }, { a: 1, b: "x" })).toEqual([]);
  });

  it("returns empty array for null=null", () => {
    expect(computeBodyDiff(null, null)).toEqual([]);
  });

  it("flags top-level scalar mismatch with `/` pointer", () => {
    expect(computeBodyDiff(1, 2)).toEqual([
      { pointer: "/", kind: "value-mismatch", rpc: 1, fetch: 2 },
    ]);
  });

  it("flags nested value mismatch with leaf JSON pointer", () => {
    const diff = computeBodyDiff(
      { ok: true, payload: { phase: "attached" } },
      { ok: true, payload: { phase: "starting" } },
    );
    expect(diff).toEqual([
      {
        pointer: "/payload/phase",
        kind: "value-mismatch",
        rpc: "attached",
        fetch: "starting",
      },
    ]);
  });

  it("flags rpc-only key", () => {
    const diff = computeBodyDiff({ ok: true, extra: 9 }, { ok: true });
    expect(diff).toEqual([
      { pointer: "/extra", kind: "rpc-only", rpc: 9 },
    ]);
  });

  it("flags fetch-only key", () => {
    const diff = computeBodyDiff({ ok: true }, { ok: true, extra: 9 });
    expect(diff).toEqual([
      { pointer: "/extra", kind: "fetch-only", fetch: 9 },
    ]);
  });

  it("walks arrays index-wise and tags length mismatch", () => {
    const diff = computeBodyDiff(
      { items: [1, 2, 3] },
      { items: [1, 2] },
    );
    expect(diff).toEqual([
      { pointer: "/items/2", kind: "rpc-only", rpc: 3 },
    ]);
  });

  it("escapes ~ and / in pointer segments per RFC 6901", () => {
    const diff = computeBodyDiff(
      { "a/b": 1, "c~d": 2 },
      { "a/b": 9, "c~d": 8 },
    );
    expect(diff.map((d) => d.pointer).sort()).toEqual([
      "/a~1b",
      "/c~0d",
    ]);
  });

  it("treats type mismatch (object vs scalar) as value-mismatch at parent", () => {
    const diff = computeBodyDiff({ payload: { x: 1 } }, { payload: 5 });
    expect(diff).toEqual([
      {
        pointer: "/payload",
        kind: "value-mismatch",
        rpc: "{object keys=1}",
        fetch: 5,
      },
    ]);
  });

  it("caps diff entries at maxEntries", () => {
    const rpc: Record<string, number> = {};
    const fetch: Record<string, number> = {};
    for (let i = 0; i < 30; i++) {
      rpc[`k${i}`] = i;
      fetch[`k${i}`] = i + 1;
    }
    const diff = computeBodyDiff(rpc, fetch);
    expect(diff.length).toBe(20);
  });

  it("truncates long string previews", () => {
    const long = "a".repeat(500);
    const diff = computeBodyDiff({ s: long }, { s: "different" });
    expect(diff).toHaveLength(1);
    const rpcPreview = diff[0].rpc;
    expect(typeof rpcPreview).toBe("string");
    expect((rpcPreview as string).length).toBeLessThanOrEqual(201);
    expect((rpcPreview as string).endsWith("…")).toBe(true);
  });

  it("previews arrays/objects compactly instead of dumping content", () => {
    const diff = computeBodyDiff(
      { v: [1, 2, 3, 4] },
      { v: { a: 1 } },
    );
    expect(diff).toEqual([
      {
        pointer: "/v",
        kind: "value-mismatch",
        rpc: "[array len=4]",
        fetch: "{object keys=1}",
      },
    ]);
  });
});

describe("jsonDeepEqual sanity (regression guard)", () => {
  it("matches key-order-insensitive objects", () => {
    expect(jsonDeepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("rejects ordered-array mismatch", () => {
    expect(jsonDeepEqual([1, 2], [2, 1])).toBe(false);
  });
});

describe("logParityFailure", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function makeFetchResult(status: number, body: Record<string, unknown> | null) {
    return {
      response: new Response(null, { status }),
      body,
    };
  }

  it("emits structured fields including body_diff and first_pointer", () => {
    logParityFailure(
      "start",
      SESSION_UUID,
      { status: 200, body: { ok: true, phase: "attached" } },
      makeFetchResult(200, { ok: true, phase: "starting" }),
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [msg, payload] = warnSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(msg).toContain("agent-rpc-parity-failed");
    expect(msg).toContain("action=start");
    expect(msg).toContain(`session=${SESSION_UUID}`);
    expect(msg).toContain("rpc_status=200");
    expect(msg).toContain("fetch_status=200");
    expect(msg).toContain("status_match=true");
    expect(msg).toContain("first_pointer=/phase");
    expect(payload.tag).toBe("agent-rpc-parity-failed");
    expect(payload.action).toBe("start");
    expect(payload.session_uuid).toBe(SESSION_UUID);
    expect(payload.status_match).toBe(true);
    expect(payload.body_diff).toEqual([
      {
        pointer: "/phase",
        kind: "value-mismatch",
        rpc: "attached",
        fetch: "starting",
      },
    ]);
    expect(payload.body_diff_truncated).toBe(false);
  });

  it("flags status mismatch when rpc/fetch status diverge", () => {
    logParityFailure(
      "status",
      SESSION_UUID,
      { status: 500, body: { error: "boom" } },
      makeFetchResult(200, { ok: true }),
    );
    const [msg, payload] = warnSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(msg).toContain("status_match=false");
    expect(payload.status_match).toBe(false);
    expect(Array.isArray(payload.body_diff)).toBe(true);
  });

  it("marks truncated=true when diff exceeds cap", () => {
    const rpc: Record<string, number> = {};
    const fetch: Record<string, number> = {};
    for (let i = 0; i < 30; i++) {
      rpc[`k${i}`] = i;
      fetch[`k${i}`] = i + 1;
    }
    logParityFailure(
      "input",
      SESSION_UUID,
      { status: 200, body: rpc },
      makeFetchResult(200, fetch),
    );
    const [msg, payload] = warnSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(msg).toContain("truncated=true");
    expect(payload.body_diff_truncated).toBe(true);
    expect((payload.body_diff as unknown[]).length).toBe(20);
  });

  it("emits empty diff and no first_pointer when bodies are equal but status differ", () => {
    logParityFailure(
      "verify",
      SESSION_UUID,
      { status: 500, body: { ok: true } },
      makeFetchResult(200, { ok: true }),
    );
    const [msg, payload] = warnSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(msg).not.toContain("first_pointer=");
    expect(payload.body_diff).toEqual([]);
    expect(payload.status_match).toBe(false);
  });
});
