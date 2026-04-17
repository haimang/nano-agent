import { describe, it, expect } from "vitest";
import { HeartbeatTracker } from "../src/heartbeat.js";

describe("HeartbeatTracker", () => {
  it("starts healthy", () => {
    const h = new HeartbeatTracker();
    expect(h.getStatus()).toBe("healthy");
  });

  it("becomes stale after 1.5x interval", async () => {
    const h = new HeartbeatTracker({ intervalMs: 50, timeoutMs: 200 });
    await new Promise(r => setTimeout(r, 100));
    expect(h.getStatus()).toBe("stale");
  });

  it("becomes timeout after timeoutMs", async () => {
    const h = new HeartbeatTracker({ intervalMs: 20, timeoutMs: 60 });
    await new Promise(r => setTimeout(r, 80));
    expect(h.isTimedOut()).toBe(true);
  });

  it("resets to healthy on recordHeartbeat", async () => {
    const h = new HeartbeatTracker({ intervalMs: 20, timeoutMs: 60 });
    await new Promise(r => setTimeout(r, 80));
    expect(h.isTimedOut()).toBe(true);
    h.recordHeartbeat();
    expect(h.getStatus()).toBe("healthy");
  });

  it("shouldSendHeartbeat after interval elapsed", async () => {
    const h = new HeartbeatTracker({ intervalMs: 30 });
    const start = Date.now();
    await new Promise(r => setTimeout(r, 50));
    expect(h.shouldSendHeartbeat(start)).toBe(true);
  });
});
