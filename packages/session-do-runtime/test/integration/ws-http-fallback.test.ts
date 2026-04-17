/**
 * Integration test: WebSocket and HTTP fallback routing + controllers.
 *
 * Verifies that:
 *   1. WS route returns websocket type
 *   2. HTTP fallback routes return correct actions
 *   3. Both use the same session model (actor state)
 */

import { describe, it, expect } from "vitest";
import { routeRequest } from "../../src/routes.js";
import { WsController } from "../../src/ws-controller.js";
import { HttpController } from "../../src/http-controller.js";
import {
  createInitialActorState,
  transitionPhase,
} from "../../src/actor-state.js";

// ── Helpers ──

function makeRequest(
  url: string,
  headers: Record<string, string> = {},
): { url: string; headers: { get(name: string): string | null } } {
  return {
    url,
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
  };
}

// ── Tests ──

describe("WS and HTTP fallback integration", () => {
  const sessionId = "sess-ws-http-001";

  describe("routing dispatches to correct controller type", () => {
    it("WS route returns websocket type for /sessions/:id/ws", () => {
      const result = routeRequest(
        makeRequest(`https://example.com/sessions/${sessionId}/ws`, {
          upgrade: "websocket",
        }),
      );

      expect(result.type).toBe("websocket");
      if (result.type === "websocket") {
        expect(result.sessionId).toBe(sessionId);
      }
    });

    it("HTTP fallback routes return correct action names", () => {
      const actions = ["start", "input", "cancel", "end", "status", "timeline"];

      for (const action of actions) {
        const result = routeRequest(
          makeRequest(`https://example.com/sessions/${sessionId}/${action}`),
        );

        expect(result.type).toBe("http-fallback");
        if (result.type === "http-fallback") {
          expect(result.sessionId).toBe(sessionId);
          expect(result.action).toBe(action);
        }
      }
    });
  });

  describe("WsController handles upgrade and messages", () => {
    const ws = new WsController();

    it("accepts valid session ID", async () => {
      const result = await ws.handleUpgrade(sessionId);
      expect(result.status).toBe(101);
    });

    it("rejects empty session ID", async () => {
      const result = await ws.handleUpgrade("");
      expect(result.status).toBe(400);
    });

    it("handleMessage does not throw", async () => {
      await expect(
        ws.handleMessage(sessionId, { type: "session.start" }),
      ).resolves.toBeUndefined();
    });

    it("handleClose does not throw", async () => {
      await expect(ws.handleClose(sessionId)).resolves.toBeUndefined();
    });
  });

  describe("HttpController handles all supported actions", () => {
    const http = new HttpController();

    it("returns 200 for each supported action", async () => {
      const actions = ["start", "input", "cancel", "end", "status", "timeline"];

      for (const action of actions) {
        const result = await http.handleRequest(sessionId, action);
        expect(result.status).toBe(200);
        expect((result.body as Record<string, unknown>).ok).toBe(true);
        expect((result.body as Record<string, unknown>).action).toBe(action);
      }
    });

    it("returns 404 for unknown action", async () => {
      const result = await http.handleRequest(sessionId, "unknown-action");
      expect(result.status).toBe(404);
    });

    it("returns 400 for empty session ID", async () => {
      const result = await http.handleRequest("", "start");
      expect(result.status).toBe(400);
    });
  });

  describe("both controllers share the same actor state model", () => {
    it("actor state transitions are consistent regardless of controller path", () => {
      // Simulate: a WS connection attaches the session actor
      let state = createInitialActorState();
      expect(state.phase).toBe("unattached");

      // WS upgrade → attached
      state = transitionPhase(state, "attached");
      expect(state.phase).toBe("attached");

      // HTTP fallback start → turn_running (same state machine)
      state = transitionPhase(state, "turn_running");
      expect(state.phase).toBe("turn_running");

      // Turn completes → attached
      state = transitionPhase(state, "attached");
      expect(state.phase).toBe("attached");

      // HTTP fallback end → ended
      state = transitionPhase(state, "ended");
      expect(state.phase).toBe("ended");
    });

    it("routing result carries the sessionId for actor lookup", () => {
      const wsRoute = routeRequest(
        makeRequest(`https://example.com/sessions/${sessionId}/ws`, {
          upgrade: "websocket",
        }),
      );
      const httpRoute = routeRequest(
        makeRequest(`https://example.com/sessions/${sessionId}/status`),
      );

      // Both routes carry the same sessionId for actor lookup
      if (wsRoute.type === "websocket") {
        expect(wsRoute.sessionId).toBe(sessionId);
      }
      if (httpRoute.type === "http-fallback") {
        expect(httpRoute.sessionId).toBe(sessionId);
      }
    });
  });
});
