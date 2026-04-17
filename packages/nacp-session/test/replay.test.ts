import { describe, it, expect } from "vitest";
import { ReplayBuffer } from "../src/replay.js";
import { NacpSessionError, SESSION_ERROR_CODES } from "../src/errors.js";
import type { NacpSessionFrame } from "../src/frame.js";

function fakeFrame(streamId: string, seq: number): NacpSessionFrame {
  return { session_frame: { stream_id: streamId, stream_seq: seq, delivery_mode: "at-most-once", ack_required: false } } as NacpSessionFrame;
}

describe("ReplayBuffer", () => {
  it("append + replay happy path", () => {
    const buf = new ReplayBuffer();
    buf.append(fakeFrame("s1", 0));
    buf.append(fakeFrame("s1", 1));
    buf.append(fakeFrame("s1", 2));
    const result = buf.replay("s1", 1);
    expect(result).toHaveLength(2); // seq 1 and 2
  });

  it("replay from seq 0 returns all", () => {
    const buf = new ReplayBuffer();
    for (let i = 0; i < 5; i++) buf.append(fakeFrame("s1", i));
    expect(buf.replay("s1", 0)).toHaveLength(5);
  });

  it("replay from beyond end returns empty", () => {
    const buf = new ReplayBuffer();
    buf.append(fakeFrame("s1", 0));
    expect(buf.replay("s1", 10)).toHaveLength(0);
  });

  it("replay from before buffer start throws NACP_REPLAY_OUT_OF_RANGE", () => {
    const buf = new ReplayBuffer({ maxPerStream: 3 });
    for (let i = 0; i < 10; i++) buf.append(fakeFrame("s1", i));
    // Buffer should contain seq 7,8,9 (last 3). Asking for seq 5 is out of range.
    try {
      buf.replay("s1", 5);
      expect.fail("should throw");
    } catch (e: any) {
      expect(e).toBeInstanceOf(NacpSessionError);
      expect(e.code).toBe(SESSION_ERROR_CODES.NACP_REPLAY_OUT_OF_RANGE);
    }
  });

  it("respects maxPerStream trim", () => {
    const buf = new ReplayBuffer({ maxPerStream: 5 });
    for (let i = 0; i < 20; i++) buf.append(fakeFrame("s1", i));
    expect(buf.size).toBe(5);
    expect(buf.getLatestSeq("s1")).toBe(19);
  });

  it("respects maxTotal trim across streams", () => {
    const buf = new ReplayBuffer({ maxPerStream: 100, maxTotal: 10 });
    for (let i = 0; i < 8; i++) buf.append(fakeFrame("s1", i));
    for (let i = 0; i < 8; i++) buf.append(fakeFrame("s2", i));
    expect(buf.size).toBeLessThanOrEqual(10);
  });

  it("replay unknown stream returns empty", () => {
    const buf = new ReplayBuffer();
    expect(buf.replay("nonexistent", 0)).toHaveLength(0);
  });

  it("getLatestSeq returns -1 for unknown stream", () => {
    const buf = new ReplayBuffer();
    expect(buf.getLatestSeq("x")).toBe(-1);
  });

  it("checkpoint + restore roundtrips", () => {
    const buf = new ReplayBuffer();
    buf.append(fakeFrame("s1", 0));
    buf.append(fakeFrame("s1", 1));
    buf.append(fakeFrame("s2", 0));
    const snap = buf.checkpoint();

    const buf2 = new ReplayBuffer();
    buf2.restore(snap);
    expect(buf2.size).toBe(3);
    expect(buf2.replay("s1", 0)).toHaveLength(2);
    expect(buf2.replay("s2", 0)).toHaveLength(1);
  });
});
