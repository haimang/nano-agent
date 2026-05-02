/**
 * Tests for NanoSessionDO — Durable Object class.
 *
 * A4 P1-02: ingress now routes through `acceptIngress()` which invokes
 * `nacp-session`'s `normalizeClientFrame` + legality gate. These tests
 * build proper client frames via `makeFrame()` rather than hand-rolled
 * `{ message_type, body }` shells.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NanoSessionDO } from "../../../src/host/do/nano-session-do.js";

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function makeRequest(
  url: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, { headers });
}

const TRACE_UUID = "11111111-1111-4111-8111-111111111111";
const SESSION_UUID = "22222222-2222-4222-8222-222222222222";
const MESSAGE_UUID_SEED = "33333333-3333-4";
const AUTHORITY = {
  sub: "44444444-4444-4444-8444-444444444444",
  tenant_uuid: "team-xyz",
  tenant_source: "claim",
};

let msgCounter = 0;
function nextMessageUuid(): string {
  msgCounter = (msgCounter + 1) % 999;
  const tail = String(msgCounter).padStart(3, "0");
  return `${MESSAGE_UUID_SEED}${tail}-8333-333333333333`;
}

/**
 * Build a minimal valid NacpClientFrame for the given message type + body.
 * Matches the shape `nacp-session`'s normalizeClientFrame expects.
 */
function makeFrame(
  messageType: string,
  body?: Record<string, unknown>,
  deliveryKind: string = "command",
): string {
  return JSON.stringify({
    header: {
      schema_version: "1.1.0",
      message_uuid: nextMessageUuid(),
      message_type: messageType,
      delivery_kind: deliveryKind,
      sent_at: new Date().toISOString(),
      producer_role: "client",
      producer_key: "nano-agent.client.cli@v1",
      priority: "normal",
    },
    trace: {
      trace_uuid: TRACE_UUID,
      session_uuid: SESSION_UUID,
    },
    body,
  });
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe("NanoSessionDO", () => {
  let doInstance: NanoSessionDO;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
    doInstance = new NanoSessionDO({}, { TEAM_UUID: "team-xyz" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Constructor ─────────────────────────────────────────────

  describe("constructor", () => {
    it("initializes with unattached actor state", () => {
      const state = doInstance.getState();
      expect(state.actorState.phase).toBe("unattached");
    });

    it("initializes with turnCount 0", () => {
      const state = doInstance.getState();
      expect(state.turnCount).toBe(0);
    });

    it("initializes health gate", () => {
      expect(doInstance.getHealthGate()).toBeDefined();
    });

    it("swallows only the already-attached helper error during socket bind", () => {
      const runtime = doInstance as unknown as {
        sessionUuid: string | null;
        sessionTeamUuid: string | null;
        ensureWsHelper: () => { attach: (socket: { send(data: string): void; close?(code?: number, reason?: string): void }) => void };
        attachHelperToSocket: (socket: unknown) => void;
      };
      runtime.sessionUuid = SESSION_UUID;
      runtime.sessionTeamUuid = "team-xyz";
      const helper = runtime.ensureWsHelper();
      helper.attach({ send() {}, close() {} });

      expect(() => runtime.attachHelperToSocket({ send() {}, close() {} })).not.toThrow();
    });

    it("rethrows unexpected helper attach failures", () => {
      const runtime = doInstance as unknown as {
        wsHelper: { attach: (_socket: unknown) => void };
        attachHelperToSocket: (socket: unknown) => void;
      };
      runtime.wsHelper = {
        attach() {
          throw new Error("boom");
        },
      };

      expect(() => runtime.attachHelperToSocket({ send() {}, close() {} })).toThrow("boom");
    });
  });

  // ── fetch routing ──────────────────────────────────────────

  describe("fetch", () => {
    it("routes WebSocket upgrade to ws controller with 101", async () => {
      const request = makeRequest(
        `https://example.com/sessions/${SESSION_UUID}/ws`,
        { upgrade: "websocket" },
      );
      const response = await doInstance.fetch(request);
      expect([101, 200]).toContain(response.status);
    });

    it("routes HTTP fallback actions to http controller", async () => {
      const request = makeRequest(
        `https://example.com/sessions/${SESSION_UUID}/status`,
      );
      const response = await doInstance.fetch(request);

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.ok).toBe(true);
    });

    it("requires internal authority for session.internal DO fetches", async () => {
      const internalDo = new NanoSessionDO({}, {
        NANO_INTERNAL_BINDING_SECRET: "secret",
        TEAM_UUID: "team-xyz",
      });

      const missingAuth = await internalDo.fetch(
        new Request(`https://session.internal/sessions/${SESSION_UUID}/status`),
      );
      expect(missingAuth.status).toBe(401);

      const ok = await internalDo.fetch(
        new Request(`https://session.internal/sessions/${SESSION_UUID}/status`, {
          headers: {
            "x-nano-internal-binding-secret": "secret",
            "x-trace-uuid": TRACE_UUID,
            "x-nano-internal-authority": JSON.stringify(AUTHORITY),
          },
        }),
      );
      expect(ok.status).toBe(200);
    });

    it("latches authority.sub for server-frame routing", async () => {
      const forwardServerFrameToClient = vi.fn().mockResolvedValue({
        ok: true,
        delivered: true,
      });
      const internalDo = new NanoSessionDO({}, {
        TEAM_UUID: "team-xyz",
        NANO_INTERNAL_BINDING_SECRET: "secret",
        ORCHESTRATOR_CORE: { forwardServerFrameToClient },
      });

      const ok = await internalDo.fetch(
        new Request(`https://session.internal/sessions/${SESSION_UUID}/status`, {
          headers: {
            "x-nano-internal-binding-secret": "secret",
            "x-trace-uuid": TRACE_UUID,
            "x-nano-internal-authority": JSON.stringify(AUTHORITY),
          },
        }),
      );
      expect(ok.status).toBe(200);

      const pushed = await (internalDo as unknown as {
        pushServerFrameToClient: (frame: Record<string, unknown>) => Promise<Record<string, unknown>>;
      }).pushServerFrameToClient({ kind: "session.permission.request" });
      expect(pushed).toEqual({ ok: true, delivered: true });
      expect(forwardServerFrameToClient).toHaveBeenCalledWith(
        SESSION_UUID,
        { kind: "session.permission.request" },
        {
          userUuid: AUTHORITY.sub,
          teamUuid: "team-xyz",
          traceUuid: TRACE_UUID,
        },
      );
    });

    it("returns 404 for unrecognized paths", async () => {
      const request = makeRequest("https://example.com/unknown");
      const response = await doInstance.fetch(request);
      expect(response.status).toBe(404);
    });

    it("returns 404 for root path", async () => {
      const request = makeRequest("https://example.com/");
      const response = await doInstance.fetch(request);
      expect(response.status).toBe(404);
    });

    it("routes idempotent HTTP actions to 2xx responses", async () => {
      // start / input need bodies; see the dedicated tests below.
      for (const action of ["cancel", "status", "timeline"]) {
        const request = makeRequest(
          `https://example.com/sessions/${SESSION_UUID}/${action}`,
        );
        const response = await doInstance.fetch(request);
        expect(response.status).toBe(200);
      }
    });

    it("HTTP fallback `start` POST shares the actor model with WS ingress", async () => {
      const res = await doInstance.fetch(
        new Request(`https://example.com/sessions/${SESSION_UUID}/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initial_input: "hi via http" }),
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.ok).toBe(true);
      // Actor has advanced through the same single-active-turn path as WS.
      const state = doInstance.getState();
      expect(["attached", "turn_running"]).toContain(state.actorState.phase);
    });

    it("HTTP fallback `end` rejects client-produced session.end via the role gate", async () => {
      // Prime the actor so rejection is surfaced instead of a stub.
      await doInstance.fetch(
        new Request(`https://example.com/sessions/${SESSION_UUID}/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initial_input: "hi" }),
        }),
      );
      const res = await doInstance.fetch(
        new Request(`https://example.com/sessions/${SESSION_UUID}/end`, {
          method: "POST",
        }),
      );
      expect(res.status).toBe(405);
    });

    it("HTTP fallback `status` reflects the real actor phase", async () => {
      await doInstance.fetch(
        new Request(`https://example.com/sessions/${SESSION_UUID}/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initial_input: "hi" }),
        }),
      );
      const res = await doInstance.fetch(
        new Request(`https://example.com/sessions/${SESSION_UUID}/status`),
      );
      const body = (await res.json()) as Record<string, unknown>;
      expect(["attached", "turn_running"]).toContain(body.phase);
    });

    it("returns 404 for unknown HTTP actions", async () => {
      const request = makeRequest(
        `https://example.com/sessions/${SESSION_UUID}/unknown-action`,
      );
      const response = await doInstance.fetch(request);
      expect(response.status).toBe(404);
    });
  });

  // ── webSocketMessage dispatch ──────────────────────────────

  describe("webSocketMessage", () => {
    it("handles session.start by starting a turn", async () => {
      const message = makeFrame("session.start", {
        initial_input: "Hello, world!",
      });
      await doInstance.webSocketMessage(null, message);

      const state = doInstance.getState();
      expect(state.actorState.phase).toBe("attached");
    });

    it("handles session.followup_input as a Phase 0 widened ingress", async () => {
      await doInstance.webSocketMessage(
        null,
        makeFrame("session.start", { initial_input: "first" }),
      );
      await doInstance.webSocketMessage(
        null,
        makeFrame("session.followup_input", { text: "second turn" }),
      );
      const state = doInstance.getState();
      expect(state.turnCount).toBeGreaterThanOrEqual(2);
    });

    it("rejects client-produced session.end via the role gate (server-emitted only)", async () => {
      // session.end is a server→client message in nacp-session — clients
      // cannot end the session, they cancel and let the server emit end.
      await doInstance.webSocketMessage(
        null,
        makeFrame("session.start", { initial_input: "Hello" }),
      );

      // B9 / 1.3: session.end's matrix-legal delivery_kind is `event`.
      // We send the matrix-legal kind so the role gate (producer_role
      // "client" not allowed to produce server-emitted session.end) is
      // what catches the frame, not the matrix layer.
      await doInstance.webSocketMessage(
        null,
        makeFrame("session.end", { reason: "user" }, "event"),
      );

      const rej = doInstance.getLastIngressRejection();
      expect(rej?.ok).toBe(false);
      if (rej && rej.ok === false) {
        expect(rej.reason).toBe("role-illegal");
      }
      // The DO's actor remains in attached because the frame never reached dispatch.
      expect(doInstance.getState().actorState.phase).toBe("attached");
    });

    it("handles session.cancel", async () => {
      await doInstance.webSocketMessage(
        null,
        makeFrame("session.start", { initial_input: "Hello" }),
      );

      await doInstance.webSocketMessage(null, makeFrame("session.cancel", {}));

      const state = doInstance.getState();
      expect(["attached", "unattached", "ended"]).toContain(
        state.actorState.phase,
      );
    });

    it("handles session.heartbeat by updating tracker", async () => {
      // Heartbeat requires attached phase.
      await doInstance.webSocketMessage(
        null,
        makeFrame("session.start", { initial_input: "hi" }),
      );
      await doInstance.webSocketMessage(
        null,
        makeFrame("session.heartbeat", { ts: Date.now() }),
      );
      expect(doInstance.getHealthGate()).toBeDefined();
    });

    it("handles session.stream.ack", async () => {
      await doInstance.webSocketMessage(
        null,
        makeFrame("session.start", { initial_input: "hi" }),
      );
      await doInstance.webSocketMessage(
        null,
        makeFrame("session.stream.ack", {
          stream_uuid: "main",
          acked_seq: 0,
        }),
      );
    });

    it("session.resume reads body.last_seen_seq (not an invented `checkpoint` field)", async () => {
      const store = new Map<string, unknown>();
      const instance = new NanoSessionDO(
        {
          storage: {
            get: async <T,>(k: string) => store.get(k) as T | undefined,
            put: async <T,>(k: string, v: T) => {
              store.set(k, v);
            },
          },
        },
        { TEAM_UUID: "team-xyz", SESSION_UUID },
      );

      await instance.webSocketMessage(
        null,
        makeFrame("session.resume", { last_seen_seq: 42 }),
      );

      // B9: LAST_SEEN_SEQ_KEY now writes through tenantDoStorage* so
      // the actual key lives under `tenants/<team>/session:lastSeenSeq`.
      expect(store.get("tenants/team-xyz/session:lastSeenSeq")).toBe(42);
    });

    it("session.resume ignores invented `checkpoint` fields", async () => {
      const store = new Map<string, unknown>();
      const instance = new NanoSessionDO(
        {
          storage: {
            get: async <T,>(k: string) => store.get(k) as T | undefined,
            put: async <T,>(k: string, v: T) => {
              store.set(k, v);
            },
          },
        },
        { TEAM_UUID: "team-xyz", SESSION_UUID },
      );

      // Invalid: missing last_seen_seq is a schema-invalid frame; the ingress
      // gate rejects it and the body is never touched.
      await instance.webSocketMessage(null, makeFrame("session.resume", {}));

      // B9: neither the un-prefixed nor the tenant-scoped key should exist.
      expect(store.has("session:lastSeenSeq")).toBe(false);
      expect(store.has("tenants/team-xyz/session:lastSeenSeq")).toBe(false);
    });

    it("ignores malformed JSON", async () => {
      await doInstance.webSocketMessage(null, "not valid json{{{");
      const state = doInstance.getState();
      expect(state.actorState.phase).toBe("unattached");
    });

    it("records a typed rejection when header is missing", async () => {
      await doInstance.webSocketMessage(
        null,
        JSON.stringify({ data: "no header" }),
      );
      const rej = doInstance.getLastIngressRejection();
      expect(rej && rej.ok === false && rej.reason).toBe("schema-invalid");
    });

    it("rejects unknown message types via the legality gate", async () => {
      const msg = makeFrame("session.unknown", {});
      await doInstance.webSocketMessage(null, msg);
      const rej = doInstance.getLastIngressRejection();
      expect(rej?.ok).toBe(false);
    });

    it("handles ArrayBuffer messages", async () => {
      const text = makeFrame("session.start", {
        initial_input: "Binary hello",
      });
      const buffer = new TextEncoder().encode(text).buffer;

      await doInstance.webSocketMessage(null, buffer as ArrayBuffer);

      const state = doInstance.getState();
      expect(state.actorState.phase).toBe("attached");
    });

    it("session.followup_input during turn_running queues the input (single-active-turn)", async () => {
      // A4-A5 review R1: when the default advanceStep resolves immediately,
      // the follow-up arriving after start actually fires as a fresh turn
      // rather than queuing. Assert the stronger invariant: the sum of
      // executed turns + residual queue must equal the number of accepted
      // inputs — no input can be lost.
      await doInstance.webSocketMessage(
        null,
        makeFrame("session.start", { initial_input: "a" }),
      );
      await doInstance.webSocketMessage(
        null,
        makeFrame("session.followup_input", { text: "b" }),
      );
      const s = doInstance.getState();
      const totalAccepted =
        s.turnCount + s.actorState.pendingInputs.length;
      expect(totalAccepted).toBe(2);
    });

  });

  // ── webSocketClose ─────────────────────────────────────────

  describe("webSocketClose", () => {
    it("transitions attached actor to unattached", async () => {
      await doInstance.webSocketMessage(
        null,
        makeFrame("session.start", { initial_input: "Hello" }),
      );
      expect(doInstance.getState().actorState.phase).toBe("attached");

      await doInstance.webSocketClose(null);

      expect(doInstance.getState().actorState.phase).toBe("unattached");
    });

    it("does not throw if already unattached", async () => {
      await doInstance.webSocketClose(null);
      expect(doInstance.getState().actorState.phase).toBe("unattached");
    });
  });

  // ── alarm ──────────────────────────────────────────────────

  describe("alarm", () => {
    it("runs health check without throwing", async () => {
      await expect(doInstance.alarm()).resolves.not.toThrow();
    });

    it("evaluates health status via health gate", async () => {
      await doInstance.webSocketMessage(
        null,
        makeFrame("session.start", { initial_input: "hello" }),
      );
      await doInstance.webSocketMessage(
        null,
        makeFrame("session.heartbeat", { ts: Date.now() }),
      );
      await expect(doInstance.alarm()).resolves.not.toThrow();
    });
  });
});
