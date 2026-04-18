import { describe, it, expect, vi } from "vitest";
import { SessionWebSocketHelper, type SessionSocketLike, type SessionContext } from "../../src/websocket.js";
import { SESSION_ERROR_CODES } from "../../src/errors.js";

const CTX: SessionContext = { team_uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", plan_level: "pro", session_uuid: "22222222-2222-2222-2222-222222222222", trace_uuid: "33333333-3333-3333-3333-333333333333", producer_key: "nano-agent.session.do@v1", stamped_by_key: "nano-agent.platform.ingress@v1" };

describe("heartbeat timeout integration", () => {
  it("healthy immediately after creation", () => {
    const h = new SessionWebSocketHelper({ sessionContext: CTX });
    expect(() => h.checkHeartbeatHealth()).not.toThrow();
  });

  it("timeout fires after configured period without heartbeat", async () => {
    const h = new SessionWebSocketHelper({ sessionContext: CTX, heartbeat: { intervalMs: 10, timeoutMs: 30 } });
    await new Promise(r => setTimeout(r, 50));
    try { h.checkHeartbeatHealth(); expect.fail("should throw"); }
    catch (e: any) { expect(e.code).toBe(SESSION_ERROR_CODES.NACP_SESSION_HEARTBEAT_TIMEOUT); }
  });

  it("heartbeat resets timeout", async () => {
    const h = new SessionWebSocketHelper({ sessionContext: CTX, heartbeat: { intervalMs: 10, timeoutMs: 40 } });
    await new Promise(r => setTimeout(r, 30));
    h.handleHeartbeat();
    await new Promise(r => setTimeout(r, 20));
    expect(() => h.checkHeartbeatHealth()).not.toThrow();
  });

  it("timeout after heartbeat stop", async () => {
    const h = new SessionWebSocketHelper({ sessionContext: CTX, heartbeat: { intervalMs: 10, timeoutMs: 30 } });
    h.handleHeartbeat();
    await new Promise(r => setTimeout(r, 50));
    try { h.checkHeartbeatHealth(); expect.fail("should throw"); }
    catch (e: any) { expect(e.code).toBe(SESSION_ERROR_CODES.NACP_SESSION_HEARTBEAT_TIMEOUT); }
  });
});
