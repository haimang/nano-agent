/**
 * A5 Phase 4 — cross-seam propagation + failure + startup-queue tests.
 */

import { describe, it, expect } from "vitest";
import {
  CROSS_SEAM_HEADERS,
  CROSS_SEAM_FAILURE_REASONS,
  CrossSeamError,
  StartupQueue,
  buildCrossSeamHeaders,
  readCrossSeamHeaders,
  validateCrossSeamAnchor,
  classifySeamError,
  type CrossSeamAnchor,
} from "../../src/host/cross-seam.js";

const ANCHOR: CrossSeamAnchor = {
  traceUuid: "11111111-1111-4111-8111-111111111111",
  sessionUuid: "22222222-2222-4222-8222-222222222222",
  teamUuid: "team-x",
  requestUuid: "33333333-3333-4333-8333-333333333333",
  sourceRole: "session",
  sourceKey: "nano-agent.session.do@v1",
  deadlineMs: 5000,
};

describe("buildCrossSeamHeaders / readCrossSeamHeaders", () => {
  it("round-trips every anchor field through the headers", () => {
    const headers = buildCrossSeamHeaders(ANCHOR);
    expect(headers[CROSS_SEAM_HEADERS.trace]).toBe(ANCHOR.traceUuid);
    expect(headers[CROSS_SEAM_HEADERS.session]).toBe(ANCHOR.sessionUuid);
    expect(headers[CROSS_SEAM_HEADERS.team]).toBe(ANCHOR.teamUuid);
    expect(headers[CROSS_SEAM_HEADERS.request]).toBe(ANCHOR.requestUuid);
    expect(headers[CROSS_SEAM_HEADERS.sourceRole]).toBe(ANCHOR.sourceRole);
    expect(headers[CROSS_SEAM_HEADERS.deadline]).toBe("5000");

    const recovered = readCrossSeamHeaders(new Headers(headers));
    expect(recovered.traceUuid).toBe(ANCHOR.traceUuid);
    expect(recovered.requestUuid).toBe(ANCHOR.requestUuid);
    expect(recovered.deadlineMs).toBe(5000);
  });

  it("omits deadline / sourceRole / sourceKey when not provided", () => {
    const minimal: CrossSeamAnchor = {
      traceUuid: ANCHOR.traceUuid,
      sessionUuid: ANCHOR.sessionUuid,
      teamUuid: ANCHOR.teamUuid,
      requestUuid: ANCHOR.requestUuid,
    };
    const headers = buildCrossSeamHeaders(minimal);
    expect(headers[CROSS_SEAM_HEADERS.deadline]).toBeUndefined();
    expect(headers[CROSS_SEAM_HEADERS.sourceRole]).toBeUndefined();
  });
});

describe("validateCrossSeamAnchor", () => {
  it("returns no missing fields for a complete anchor", () => {
    expect(validateCrossSeamAnchor(ANCHOR)).toEqual([]);
  });

  it("reports each missing required field", () => {
    expect(validateCrossSeamAnchor({ traceUuid: ANCHOR.traceUuid })).toEqual([
      "sessionUuid",
      "teamUuid",
      "requestUuid",
    ]);
  });
});

describe("CrossSeamError + classifySeamError", () => {
  it("CROSS_SEAM_FAILURE_REASONS lists exactly the five reasons", () => {
    expect([...CROSS_SEAM_FAILURE_REASONS]).toEqual([
      "not-connected",
      "transport-error",
      "timeout",
      "cancelled",
      "not-ready",
    ]);
  });

  it("rethrows existing CrossSeamError unchanged", () => {
    const original = new CrossSeamError("hook", "cancelled", "user cancelled");
    const reclassified = classifySeamError("hook", original);
    expect(reclassified).toBe(original);
  });

  it("translates HookRuntimeError-shaped errors using the .reason field", () => {
    class FakeHookError extends Error {
      reason = "not-connected" as const;
    }
    const out = classifySeamError("hook", new FakeHookError("nope"));
    expect(out).toBeInstanceOf(CrossSeamError);
    expect(out.reason).toBe("not-connected");
    expect(out.seam).toBe("hook");
  });

  it("translates capability not-connected from .code", () => {
    const out = classifySeamError("capability", { code: "not-connected", message: "x" });
    expect(out.reason).toBe("not-connected");
    expect(out.seam).toBe("capability");
  });

  it("falls through to transport-error for generic Error instances", () => {
    const out = classifySeamError("provider", new Error("boom"));
    expect(out.reason).toBe("transport-error");
    expect(out.seam).toBe("provider");
  });
});

describe("StartupQueue", () => {
  it("buffers events while not ready and flushes them in FIFO order on markReady", async () => {
    const queue = new StartupQueue<string>();
    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");
    expect(queue.size).toBe(3);
    expect(queue.isBuffering).toBe(true);

    const seen: string[] = [];
    await queue.markReady(async (event) => {
      seen.push(event);
    });
    expect(seen).toEqual(["a", "b", "c"]);
    expect(queue.isBuffering).toBe(false);
    expect(queue.size).toBe(0);
  });

  it("rejects enqueue() after markReady — caller should call destination directly", () => {
    const queue = new StartupQueue<number>();
    return queue.markReady(() => undefined).then(() => {
      expect(() => queue.enqueue(1)).toThrow(/markReady/);
    });
  });

  it("drop() returns buffered events and surfaces not-ready on subsequent enqueue", () => {
    const queue = new StartupQueue<string>();
    queue.enqueue("a");
    queue.enqueue("b");
    expect(queue.drop()).toEqual(["a", "b"]);
    expect(() => queue.enqueue("c")).toThrowError(CrossSeamError);
  });

  it("respects maxSize and surfaces not-ready when overflowed", () => {
    const queue = new StartupQueue<number>(2);
    queue.enqueue(1);
    queue.enqueue(2);
    try {
      queue.enqueue(3);
    } catch (e) {
      expect(e).toBeInstanceOf(CrossSeamError);
      expect((e as CrossSeamError).reason).toBe("not-ready");
    }
  });
});
