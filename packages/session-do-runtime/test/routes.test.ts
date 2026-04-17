/**
 * Tests for Worker-level routing.
 */

import { describe, it, expect } from "vitest";
import { routeRequest } from "../src/routes.js";

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

describe("routeRequest", () => {
  describe("WebSocket routes", () => {
    it("routes /sessions/:id/ws with Upgrade header to websocket", () => {
      const result = routeRequest(
        makeRequest("https://example.com/sessions/sess-123/ws", {
          upgrade: "websocket",
        }),
      );

      expect(result).toEqual({ type: "websocket", sessionId: "sess-123" });
    });

    it("routes /sessions/:id/ws without Upgrade header to websocket", () => {
      const result = routeRequest(
        makeRequest("https://example.com/sessions/sess-123/ws"),
      );

      expect(result).toEqual({ type: "websocket", sessionId: "sess-123" });
    });

    it("handles Upgrade header case-insensitively", () => {
      const result = routeRequest(
        makeRequest("https://example.com/sessions/sess-123/ws", {
          upgrade: "WebSocket",
        }),
      );

      expect(result).toEqual({ type: "websocket", sessionId: "sess-123" });
    });
  });

  describe("HTTP fallback routes", () => {
    it("routes /sessions/:id/start to http-fallback", () => {
      const result = routeRequest(
        makeRequest("https://example.com/sessions/sess-123/start"),
      );

      expect(result).toEqual({
        type: "http-fallback",
        sessionId: "sess-123",
        action: "start",
      });
    });

    it("routes /sessions/:id/status to http-fallback", () => {
      const result = routeRequest(
        makeRequest("https://example.com/sessions/sess-456/status"),
      );

      expect(result).toEqual({
        type: "http-fallback",
        sessionId: "sess-456",
        action: "status",
      });
    });

    it("routes /sessions/:id/timeline to http-fallback", () => {
      const result = routeRequest(
        makeRequest("https://example.com/sessions/sess-789/timeline"),
      );

      expect(result).toEqual({
        type: "http-fallback",
        sessionId: "sess-789",
        action: "timeline",
      });
    });

    it("routes /sessions/:id/input to http-fallback", () => {
      const result = routeRequest(
        makeRequest("https://example.com/sessions/sess-001/input"),
      );

      expect(result).toEqual({
        type: "http-fallback",
        sessionId: "sess-001",
        action: "input",
      });
    });
  });

  describe("not-found routes", () => {
    it("returns not-found for root path", () => {
      const result = routeRequest(
        makeRequest("https://example.com/"),
      );

      expect(result).toEqual({ type: "not-found" });
    });

    it("returns not-found for unknown prefix", () => {
      const result = routeRequest(
        makeRequest("https://example.com/unknown/sess-123/start"),
      );

      expect(result).toEqual({ type: "not-found" });
    });

    it("returns not-found for /sessions without session ID and action", () => {
      const result = routeRequest(
        makeRequest("https://example.com/sessions"),
      );

      expect(result).toEqual({ type: "not-found" });
    });

    it("returns not-found for /sessions/:id without action", () => {
      const result = routeRequest(
        makeRequest("https://example.com/sessions/sess-123"),
      );

      expect(result).toEqual({ type: "not-found" });
    });

    it("returns not-found for invalid URL", () => {
      const result = routeRequest(
        makeRequest("not-a-url"),
      );

      expect(result).toEqual({ type: "not-found" });
    });
  });

  describe("edge cases", () => {
    it("handles trailing slashes", () => {
      const result = routeRequest(
        makeRequest("https://example.com/sessions/sess-123/start/"),
      );

      expect(result.type).toBe("http-fallback");
      if (result.type === "http-fallback") {
        expect(result.sessionId).toBe("sess-123");
        expect(result.action).toBe("start");
      }
    });

    it("handles UUID-style session IDs", () => {
      const result = routeRequest(
        makeRequest("https://example.com/sessions/550e8400-e29b-41d4-a716-446655440000/status"),
      );

      expect(result).toEqual({
        type: "http-fallback",
        sessionId: "550e8400-e29b-41d4-a716-446655440000",
        action: "status",
      });
    });
  });
});
