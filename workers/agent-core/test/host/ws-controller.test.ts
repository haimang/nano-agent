/**
 * Tests for WsController — WebSocket façade.
 *
 * A4 Phase 2 upgraded the controller to a real façade that owns the
 * upgrade verdict and DO-provided hooks (`onMessage`, `onClose`).
 */

import { describe, it, expect, vi } from "vitest";
import { WsController } from "../../src/host/ws-controller.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";

describe("WsController", () => {
  it("handleUpgrade returns 101 for a UUID-shaped sessionId", async () => {
    const ctrl = new WsController();
    const res = await ctrl.handleUpgrade(SESSION_UUID);
    expect(res.status).toBe(101);
  });

  it("handleUpgrade returns 400 with missing-session-id for empty input", async () => {
    const ctrl = new WsController();
    const res = await ctrl.handleUpgrade("");
    expect(res.status).toBe(400);
    if (res.status === 400) expect(res.reason).toBe("missing-session-id");
  });

  it("handleUpgrade returns 400 with missing-session-id for whitespace", async () => {
    const ctrl = new WsController();
    const res = await ctrl.handleUpgrade("   ");
    expect(res.status).toBe(400);
    if (res.status === 400) expect(res.reason).toBe("missing-session-id");
  });

  it("handleUpgrade returns 400 with invalid-session-id for non-UUID strings", async () => {
    const ctrl = new WsController();
    const res = await ctrl.handleUpgrade("sess-42");
    expect(res.status).toBe(400);
    if (res.status === 400) expect(res.reason).toBe("invalid-session-id");
  });

  it("handleMessage forwards string payloads to the attached onMessage hook", async () => {
    const onMessage = vi.fn().mockResolvedValue(undefined);
    const ctrl = new WsController({ onMessage });
    await ctrl.handleMessage(SESSION_UUID, "frame-bytes");
    expect(onMessage).toHaveBeenCalledWith("frame-bytes");
  });

  it("handleMessage forwards ArrayBuffer payloads", async () => {
    const onMessage = vi.fn().mockResolvedValue(undefined);
    const ctrl = new WsController({ onMessage });
    const buf = new TextEncoder().encode("x").buffer;
    await ctrl.handleMessage(SESSION_UUID, buf);
    expect(onMessage).toHaveBeenCalledOnce();
  });

  it("handleMessage ignores payloads when no hook is attached", async () => {
    const ctrl = new WsController();
    await expect(
      ctrl.handleMessage(SESSION_UUID, "anything"),
    ).resolves.toBeUndefined();
  });

  it("attachHooks can late-bind onMessage", async () => {
    const ctrl = new WsController();
    const onMessage = vi.fn().mockResolvedValue(undefined);
    ctrl.attachHooks({ onMessage });
    await ctrl.handleMessage(SESSION_UUID, "frame");
    expect(onMessage).toHaveBeenCalledWith("frame");
  });

  it("handleClose calls the onClose hook when attached", async () => {
    const onClose = vi.fn().mockResolvedValue(undefined);
    const ctrl = new WsController({ onClose });
    await ctrl.handleClose(SESSION_UUID);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("handleClose resolves when no hook is attached", async () => {
    const ctrl = new WsController();
    await expect(ctrl.handleClose(SESSION_UUID)).resolves.toBeUndefined();
  });
});
