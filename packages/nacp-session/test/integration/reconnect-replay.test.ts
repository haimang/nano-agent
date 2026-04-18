import { describe, it, expect, vi } from "vitest";
import { SessionWebSocketHelper, type SessionSocketLike, type SessionContext } from "../../src/websocket.js";

const CTX: SessionContext = {
  team_uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", plan_level: "pro",
  session_uuid: "22222222-2222-2222-2222-222222222222", trace_uuid: "33333333-3333-3333-3333-333333333333",
  producer_key: "nano-agent.session.do@v1", stamped_by_key: "nano-agent.platform.ingress@v1",
};
function mockSock(): SessionSocketLike & { sent: string[] } {
  return { sent: [], send(d: string) { this.sent.push(d); }, close: vi.fn() };
}

describe("reconnect + replay integration", () => {
  it("full cycle: push → detach → reattach → resume", () => {
    const helper = new SessionWebSocketHelper({ sessionContext: CTX });
    const sock1 = mockSock();
    helper.attach(sock1);
    for (let i = 0; i < 5; i++) helper.pushEvent("main", { kind: "system.notify", severity: "info", message: `msg-${i}` });
    expect(sock1.sent).toHaveLength(5);
    helper.detach();
    helper.pushEvent("main", { kind: "system.notify", severity: "info", message: "offline-5" });
    helper.pushEvent("main", { kind: "system.notify", severity: "info", message: "offline-6" });
    const sock2 = mockSock();
    helper.attach(sock2);
    const replayed = helper.handleResume("main", 2);
    expect(replayed).toHaveLength(4);
    expect(sock2.sent).toHaveLength(4);
    const seqs = sock2.sent.map(s => JSON.parse(s).session_frame.stream_seq);
    expect(seqs).toEqual([3, 4, 5, 6]);
  });

  it("R1 fix: multi-stream resume works correctly", () => {
    const helper = new SessionWebSocketHelper({ sessionContext: CTX });
    helper.pushEvent("s1", { kind: "system.notify", severity: "info", message: "s1-0" });
    helper.pushEvent("s2", { kind: "system.notify", severity: "info", message: "s2-0" });
    helper.pushEvent("s2", { kind: "system.notify", severity: "info", message: "s2-1" });
    helper.pushEvent("s1", { kind: "system.notify", severity: "info", message: "s1-1" });
    const sock = mockSock();
    helper.attach(sock);
    const s1Replayed = helper.handleResume("s1", 0);
    expect(s1Replayed).toHaveLength(1);
    expect(JSON.parse(sock.sent[0]!).body.message).toBe("s1-1");
    const s2Replayed = helper.handleResume("s2", 0);
    expect(s2Replayed).toHaveLength(1);
    expect(JSON.parse(sock.sent[1]!).body.message).toBe("s2-1");
  });

  it("replay out-of-range throws", () => {
    const helper = new SessionWebSocketHelper({ sessionContext: CTX, replay: { maxPerStream: 3 } });
    for (let i = 0; i < 10; i++) helper.pushEvent("main", { kind: "system.notify", severity: "info", message: `m${i}` });
    const sock = mockSock();
    helper.attach(sock);
    try { helper.handleResume("main", 2); expect.fail("should throw"); }
    catch (e: any) { expect(e.code).toBe("NACP_REPLAY_OUT_OF_RANGE"); }
  });

  it("checkpoint + restore across hibernation", async () => {
    const h1 = new SessionWebSocketHelper({ sessionContext: CTX });
    h1.pushEvent("s1", { kind: "turn.begin", turn_uuid: "11111111-1111-1111-1111-111111111111" });
    h1.pushEvent("s1", { kind: "system.notify", severity: "info", message: "hello" });
    const store = new Map<string, unknown>();
    const storage = { get: async <T>(k: string) => store.get(k) as T | undefined, put: async <T>(k: string, v: T) => { store.set(k, v); } };
    await h1.checkpoint(storage);
    const h2 = new SessionWebSocketHelper({ sessionContext: CTX });
    await h2.restore(storage);
    expect(h2.replay.size).toBe(2);
  });
});
