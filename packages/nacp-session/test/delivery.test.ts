import { describe, it, expect } from "vitest";
import { AckWindow, shouldRequireAck } from "../src/delivery.js";

describe("AckWindow", () => {
  it("tracks pending acks", () => {
    const w = new AckWindow();
    w.track("s1", 0);
    w.track("s1", 1);
    expect(w.pendingCount).toBe(2);
  });

  it("ack clears up to acked_seq", () => {
    const w = new AckWindow();
    w.track("s1", 0);
    w.track("s1", 1);
    w.track("s1", 2);
    const cleared = w.ack("s1", 1);
    expect(cleared).toBe(2); // seq 0 and 1
    expect(w.pendingCount).toBe(1);
  });

  it("isBackpressured when maxUnacked reached", () => {
    const w = new AckWindow({ maxUnacked: 3 });
    w.track("s1", 0);
    w.track("s1", 1);
    w.track("s1", 2);
    expect(w.isBackpressured()).toBe(true);
  });

  it("getTimedOut returns stale acks", async () => {
    const w = new AckWindow({ ackTimeoutMs: 50 });
    w.track("s1", 0);
    await new Promise(r => setTimeout(r, 100));
    expect(w.getTimedOut()).toHaveLength(1);
  });

  it("clear removes all pending", () => {
    const w = new AckWindow();
    w.track("s1", 0);
    w.clear();
    expect(w.pendingCount).toBe(0);
  });
});

describe("shouldRequireAck", () => {
  it("at-least-once requires ack", () => expect(shouldRequireAck("at-least-once")).toBe(true));
  it("at-most-once does not", () => expect(shouldRequireAck("at-most-once")).toBe(false));
});
