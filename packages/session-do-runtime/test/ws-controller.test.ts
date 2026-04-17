/**
 * Tests for WsController — WebSocket lifecycle stubs.
 *
 * Covers:
 *   - handleUpgrade returns 101 for non-empty sessionId and 400 otherwise.
 *   - handleMessage / handleClose resolve without throwing (they are
 *     stubs in v1; the DO class routes through them).
 */

import { describe, it, expect } from "vitest";
import { WsController } from "../src/ws-controller.js";

describe("WsController", () => {
  it("handleUpgrade returns 101 for a non-empty sessionId", async () => {
    const ctrl = new WsController();
    const res = await ctrl.handleUpgrade("sess-42");
    expect(res.status).toBe(101);
  });

  it("handleUpgrade returns 400 for an empty sessionId", async () => {
    const ctrl = new WsController();
    const res = await ctrl.handleUpgrade("");
    expect(res.status).toBe(400);
  });

  it("handleUpgrade returns 400 for a whitespace-only sessionId", async () => {
    const ctrl = new WsController();
    const res = await ctrl.handleUpgrade("   ");
    expect(res.status).toBe(400);
  });

  it("handleMessage resolves without throwing for arbitrary payloads", async () => {
    const ctrl = new WsController();
    await expect(ctrl.handleMessage("sess-1", { any: "payload" })).resolves.toBeUndefined();
  });

  it("handleClose resolves without throwing", async () => {
    const ctrl = new WsController();
    await expect(ctrl.handleClose("sess-1")).resolves.toBeUndefined();
  });
});
