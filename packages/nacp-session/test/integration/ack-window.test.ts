import { describe, it, expect, vi } from "vitest";
import { SessionWebSocketHelper, type SessionSocketLike, type SessionContext } from "../../src/websocket.js";
import { SESSION_ERROR_CODES } from "../../src/errors.js";

const CTX: SessionContext = { team_uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", plan_level: "pro", session_uuid: "22222222-2222-2222-2222-222222222222", trace_id: "33333333-3333-3333-3333-333333333333", producer_id: "nano-agent.session.do@v1", stamped_by: "nano-agent.platform.ingress@v1" };
function mockSock(): SessionSocketLike & { sent: string[] } { return { sent: [], send(d: string) { this.sent.push(d); }, close: vi.fn() }; }

describe("ack window integration", () => {
  it("ack-required events track in window, ack clears them", () => {
    const h = new SessionWebSocketHelper({ sessionContext: CTX });
    h.attach(mockSock());
    h.pushEvent("s1", { kind: "system.notify", severity: "info", message: "a" }, { ackRequired: true });
    h.pushEvent("s1", { kind: "system.notify", severity: "info", message: "b" }, { ackRequired: true });
    expect(h.ackWindow.pendingCount).toBe(2);
    h.handleAck("s1", 1); // ack up to seq 1
    expect(h.ackWindow.pendingCount).toBe(0);
  });

  it("best-effort events don't enter ack window", () => {
    const h = new SessionWebSocketHelper({ sessionContext: CTX });
    h.attach(mockSock());
    h.pushEvent("s1", { kind: "system.notify", severity: "info", message: "a" });
    expect(h.ackWindow.pendingCount).toBe(0);
  });

  it("checkAckHealth detects timed-out acks", async () => {
    const h = new SessionWebSocketHelper({ sessionContext: CTX, ack: { ackTimeoutMs: 20 } });
    h.attach(mockSock());
    h.pushEvent("s1", { kind: "system.notify", severity: "info", message: "a" }, { ackRequired: true });
    await new Promise(r => setTimeout(r, 40));
    try { h.checkAckHealth(); expect.fail("should throw"); }
    catch (e: any) { expect(e.code).toBe(SESSION_ERROR_CODES.NACP_SESSION_ACK_MISMATCH); }
  });

  it("backpressure blocks pushEvent when maxUnacked reached", () => {
    const h = new SessionWebSocketHelper({ sessionContext: CTX, ack: { maxUnacked: 2 } });
    h.attach(mockSock());
    h.pushEvent("s1", { kind: "system.notify", severity: "info", message: "a" }, { ackRequired: true });
    h.pushEvent("s1", { kind: "system.notify", severity: "info", message: "b" }, { ackRequired: true });
    try { h.pushEvent("s1", { kind: "system.notify", severity: "info", message: "c" }, { ackRequired: true }); expect.fail("should throw"); }
    catch (e: any) { expect(e.code).toBe(SESSION_ERROR_CODES.NACP_SESSION_ACK_MISMATCH); }
  });
});
