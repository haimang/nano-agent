import { describe, it, expect, vi } from "vitest";
import { SessionWebSocketHelper, type SessionSocketLike, type SessionStorageLike, type SessionContext } from "../src/websocket.js";
import { NacpSessionError, SESSION_ERROR_CODES } from "../src/errors.js";

const CTX: SessionContext = {
  team_uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  plan_level: "pro",
  session_uuid: "22222222-2222-2222-2222-222222222222",
  trace_uuid: "33333333-3333-3333-3333-333333333333",
  producer_key: "nano-agent.session.do@v1",
  stamped_by_key: "nano-agent.platform.ingress@v1",
};

function mockSocket(): SessionSocketLike & { sent: string[] } {
  return { sent: [] as string[], send(d: string) { this.sent.push(d); }, close: vi.fn() };
}
function mockStorage(): SessionStorageLike & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: async <T>(k: string) => data.get(k) as T | undefined, put: async <T>(k: string, v: T) => { data.set(k, v); } };
}

describe("SessionWebSocketHelper", () => {
  it("attach + pushEvent sends with real session context (R3 fix)", () => {
    const h = new SessionWebSocketHelper({ sessionContext: CTX });
    const sock = mockSocket();
    h.attach(sock);
    h.pushEvent("s1", { kind: "system.notify", severity: "info", message: "hello" });
    expect(sock.sent).toHaveLength(1);
    const parsed = JSON.parse(sock.sent[0]!);
    expect(parsed.authority.team_uuid).toBe(CTX.team_uuid);
    expect(parsed.trace.session_uuid).toBe(CTX.session_uuid);
  });

  it("R1 fix: per-stream seq counter", () => {
    const h = new SessionWebSocketHelper({ sessionContext: CTX });
    const sock = mockSocket();
    h.attach(sock);
    h.pushEvent("s1", { kind: "system.notify", severity: "info", message: "a" });
    h.pushEvent("s2", { kind: "system.notify", severity: "info", message: "b" });
    h.pushEvent("s1", { kind: "system.notify", severity: "info", message: "c" });
    const seqs = sock.sent.map(s => { const p = JSON.parse(s); return { stream: p.session_frame.stream_uuid, seq: p.session_frame.stream_seq }; });
    expect(seqs).toEqual([{ stream: "s1", seq: 0 }, { stream: "s2", seq: 0 }, { stream: "s1", seq: 1 }]);
  });

  it("R1 fix: multi-stream replay works correctly", () => {
    const h = new SessionWebSocketHelper({ sessionContext: CTX });
    h.pushEvent("s1", { kind: "system.notify", severity: "info", message: "s1-0" });
    h.pushEvent("s2", { kind: "system.notify", severity: "info", message: "s2-0" });
    h.pushEvent("s2", { kind: "system.notify", severity: "info", message: "s2-1" });
    h.pushEvent("s1", { kind: "system.notify", severity: "info", message: "s1-1" });
    const sock = mockSocket();
    h.attach(sock);
    const replayed = h.handleResume("s1", 0);
    expect(replayed).toHaveLength(1);
  });

  it("R2 fix: rejects invalid event kind", () => {
    const h = new SessionWebSocketHelper({ sessionContext: CTX });
    expect(() => h.pushEvent("s1", { kind: "not-a-real-kind" } as any)).toThrow();
  });

  it("double attach throws", () => {
    const h = new SessionWebSocketHelper({ sessionContext: CTX });
    h.attach(mockSocket());
    expect(() => h.attach(mockSocket())).toThrow(NacpSessionError);
  });

  it("detach clears socket", () => {
    const h = new SessionWebSocketHelper({ sessionContext: CTX });
    h.attach(mockSocket());
    h.detach();
    expect(h.isAttached).toBe(false);
  });

  it("handleAck clears ack window", () => {
    const h = new SessionWebSocketHelper({ sessionContext: CTX });
    h.attach(mockSocket());
    h.pushEvent("s1", { kind: "system.notify", severity: "info", message: "x" }, { ackRequired: true });
    expect(h.ackWindow.pendingCount).toBe(1);
    h.handleAck("s1", 0);
    expect(h.ackWindow.pendingCount).toBe(0);
  });

  it("R5 fix: checkHeartbeatHealth throws on timeout", async () => {
    const h = new SessionWebSocketHelper({ sessionContext: CTX, heartbeat: { intervalMs: 10, timeoutMs: 30 } });
    await new Promise(r => setTimeout(r, 50));
    try { h.checkHeartbeatHealth(); expect.fail("should throw"); }
    catch (e: any) { expect(e.code).toBe(SESSION_ERROR_CODES.NACP_SESSION_HEARTBEAT_TIMEOUT); }
  });

  it("R5 fix: checkAckHealth throws when acks timed out", async () => {
    const h = new SessionWebSocketHelper({ sessionContext: CTX, ack: { ackTimeoutMs: 30 } });
    h.attach(mockSocket());
    h.pushEvent("s1", { kind: "system.notify", severity: "info", message: "x" }, { ackRequired: true });
    await new Promise(r => setTimeout(r, 50));
    try { h.checkAckHealth(); expect.fail("should throw"); }
    catch (e: any) { expect(e.code).toBe(SESSION_ERROR_CODES.NACP_SESSION_ACK_MISMATCH); }
  });

  it("checkpoint + restore preserves state", async () => {
    const h = new SessionWebSocketHelper({ sessionContext: CTX });
    h.pushEvent("s1", { kind: "system.notify", severity: "info", message: "a" });
    const storage = mockStorage();
    await h.checkpoint(storage);
    const h2 = new SessionWebSocketHelper({ sessionContext: CTX });
    await h2.restore(storage);
    expect(h2.replay.size).toBe(1);
  });

  it("close calls socket.close", () => {
    const h = new SessionWebSocketHelper({ sessionContext: CTX });
    const sock = mockSocket();
    h.attach(sock);
    h.close(1000, "done");
    expect(sock.close).toHaveBeenCalledWith(1000, "done");
    expect(h.isAttached).toBe(false);
  });
});
