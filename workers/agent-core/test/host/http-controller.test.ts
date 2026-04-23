/**
 * Tests for HttpController — the HTTP fallback action surface.
 *
 * Covers:
 *   - Happy-path for each of the 6 supported actions.
 *   - 400 on missing sessionId.
 *   - 404 on unknown actions.
 */

import { describe, it, expect } from "vitest";
import { HttpController } from "../../src/host/http-controller.js";

const SUPPORTED = ["start", "input", "cancel", "end", "status", "timeline"] as const;

describe("HttpController", () => {
  it("returns 400 when sessionId is empty", async () => {
    const ctrl = new HttpController();
    const res = await ctrl.handleRequest("", "start");
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when sessionId is whitespace-only", async () => {
    const ctrl = new HttpController();
    const res = await ctrl.handleRequest("   ", "start");
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown actions", async () => {
    const ctrl = new HttpController();
    const res = await ctrl.handleRequest("sess-1", "launch-rockets");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: expect.stringContaining("Unknown action") });
  });

  it.each(SUPPORTED)("returns 200 for supported action '%s'", async (action) => {
    const ctrl = new HttpController();
    const res = await ctrl.handleRequest("sess-1", action);
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).ok).toBe(true);
    expect((res.body as Record<string, unknown>).action).toBe(action);
  });

  it("`status` response surfaces an actor phase field", async () => {
    const ctrl = new HttpController();
    const res = await ctrl.handleRequest("sess-1", "status");
    expect((res.body as Record<string, unknown>).phase).toBe("unattached");
  });

  it("`timeline` response returns an `events` array", async () => {
    const ctrl = new HttpController();
    const res = await ctrl.handleRequest("sess-1", "timeline");
    expect(Array.isArray((res.body as Record<string, unknown>).events)).toBe(true);
  });
});
