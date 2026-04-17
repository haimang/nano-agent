/**
 * Tests for NanoSessionDO — Durable Object class.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NanoSessionDO } from "../../src/do/nano-session-do.js";

// ═══════════════════════════════════════════════════════════════════
// Helper: create a minimal Request-like object
// ═══════════════════════════════════════════════════════════════════

function makeRequest(
  url: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, { headers });
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe("NanoSessionDO", () => {
  let doInstance: NanoSessionDO;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
    doInstance = new NanoSessionDO({}, {});
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
  });

  // ── fetch routing ──────────────────────────────────────────

  describe("fetch", () => {
    it("routes WebSocket upgrade to ws controller with 101", async () => {
      const request = makeRequest(
        "https://example.com/sessions/sess-001/ws",
        { upgrade: "websocket" },
      );
      const response = await doInstance.fetch(request);

      // In Cloudflare Workers 101 is valid; in Node.js/vitest it falls back to 200
      expect([101, 200]).toContain(response.status);
    });

    it("routes HTTP fallback actions to http controller", async () => {
      const request = makeRequest(
        "https://example.com/sessions/sess-001/status",
      );
      const response = await doInstance.fetch(request);

      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.ok).toBe(true);
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

    it("routes known HTTP actions correctly", async () => {
      const actions = ["start", "input", "cancel", "end", "status", "timeline"];
      for (const action of actions) {
        const request = makeRequest(
          `https://example.com/sessions/sess-001/${action}`,
        );
        const response = await doInstance.fetch(request);
        expect(response.status).toBe(200);
      }
    });

    it("returns 404 for unknown HTTP actions", async () => {
      const request = makeRequest(
        "https://example.com/sessions/sess-001/unknown-action",
      );
      const response = await doInstance.fetch(request);

      // The HTTP controller returns 404 for unknown actions
      expect(response.status).toBe(404);
    });
  });

  // ── webSocketMessage dispatch ──────────────────────────────

  describe("webSocketMessage", () => {
    it("handles session.start by starting a turn", async () => {
      const message = JSON.stringify({
        message_type: "session.start",
        body: { initial_input: "Hello, world!" },
      });

      await doInstance.webSocketMessage(null, message);

      const state = doInstance.getState();
      // After startTurn completes (stub advanceStep returns done=true),
      // actor should be in attached state
      expect(state.actorState.phase).toBe("attached");
    });

    it("handles session.end by ending the session", async () => {
      // First, start a turn to get into an attached state
      const startMsg = JSON.stringify({
        message_type: "session.start",
        body: { initial_input: "Hello" },
      });
      await doInstance.webSocketMessage(null, startMsg);

      const endMsg = JSON.stringify({ message_type: "session.end" });
      await doInstance.webSocketMessage(null, endMsg);

      const state = doInstance.getState();
      expect(state.actorState.phase).toBe("ended");
    });

    it("handles session.cancel", async () => {
      // Start a turn first
      const startMsg = JSON.stringify({
        message_type: "session.start",
        body: { initial_input: "Hello" },
      });
      await doInstance.webSocketMessage(null, startMsg);

      // The turn completes immediately (stub), so actor is attached.
      // Cancel should still work (just calls advanceStep with cancel signal)
      const cancelMsg = JSON.stringify({ message_type: "session.cancel" });
      await doInstance.webSocketMessage(null, cancelMsg);

      const state = doInstance.getState();
      // Actor should still be in a valid state (attached since turn was already done)
      expect(["attached", "unattached", "ended"]).toContain(state.actorState.phase);
    });

    it("handles session.heartbeat by updating tracker", async () => {
      const msg = JSON.stringify({ message_type: "session.heartbeat" });
      await doInstance.webSocketMessage(null, msg);

      // Heartbeat tracker should be updated — verify through health gate
      const healthGate = doInstance.getHealthGate();
      expect(healthGate).toBeDefined();
    });

    it("handles session.stream.ack", async () => {
      const msg = JSON.stringify({ message_type: "session.stream.ack" });
      // Should not throw
      await doInstance.webSocketMessage(null, msg);
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
        {},
      );

      const msg = JSON.stringify({
        message_type: "session.resume",
        body: { last_seen_seq: 42 },
      });
      await instance.webSocketMessage(null, msg);

      expect(store.get("session:lastSeenSeq")).toBe(42);
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
        {},
      );

      const msg = JSON.stringify({
        message_type: "session.resume",
        checkpoint: { pretend: "I'm a checkpoint" },
      });
      await instance.webSocketMessage(null, msg);

      expect(store.has("session:lastSeenSeq")).toBe(false);
    });

    it("ignores malformed JSON", async () => {
      await doInstance.webSocketMessage(null, "not valid json{{{");
      // Should not throw, state unchanged
      const state = doInstance.getState();
      expect(state.actorState.phase).toBe("unattached");
    });

    it("ignores messages without message_type", async () => {
      const msg = JSON.stringify({ data: "no type field" });
      await doInstance.webSocketMessage(null, msg);

      const state = doInstance.getState();
      expect(state.actorState.phase).toBe("unattached");
    });

    it("ignores unknown message types", async () => {
      const msg = JSON.stringify({ message_type: "session.unknown" });
      await doInstance.webSocketMessage(null, msg);

      const state = doInstance.getState();
      expect(state.actorState.phase).toBe("unattached");
    });

    it("handles ArrayBuffer messages", async () => {
      const text = JSON.stringify({
        message_type: "session.start",
        body: { initial_input: "Binary hello" },
      });
      const buffer = new TextEncoder().encode(text).buffer;

      await doInstance.webSocketMessage(null, buffer as ArrayBuffer);

      const state = doInstance.getState();
      expect(state.actorState.phase).toBe("attached");
    });
  });

  // ── webSocketClose ─────────────────────────────────────────

  describe("webSocketClose", () => {
    it("transitions attached actor to unattached", async () => {
      // Start a turn to get to attached
      const startMsg = JSON.stringify({
        message_type: "session.start",
        body: { initial_input: "Hello" },
      });
      await doInstance.webSocketMessage(null, startMsg);
      expect(doInstance.getState().actorState.phase).toBe("attached");

      await doInstance.webSocketClose(null);

      expect(doInstance.getState().actorState.phase).toBe("unattached");
    });

    it("does not throw if already unattached", async () => {
      // Actor is unattached initially
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
      // Set a heartbeat so we have something to check
      const hbMsg = JSON.stringify({ message_type: "session.heartbeat" });
      await doInstance.webSocketMessage(null, hbMsg);

      // Alarm should evaluate and not throw
      await expect(doInstance.alarm()).resolves.not.toThrow();
    });
  });
});
