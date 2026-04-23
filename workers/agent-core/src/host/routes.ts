/**
 * Session DO Runtime — Worker-level routing.
 *
 * Parses incoming requests and routes them to the appropriate handler:
 * WebSocket upgrade for real-time sessions, HTTP fallback for polling
 * clients, or a 404 for unrecognized paths.
 *
 * URL patterns:
 *   /sessions/:sessionId/ws       -> WebSocket upgrade
 *   /sessions/:sessionId/:action  -> HTTP fallback
 *
 * Reference: docs/action-plan/session-do-runtime.md Phase 2
 */

/** Discriminated union for routing results. */
export type RouteResult =
  | { type: "websocket"; sessionId: string }
  | { type: "http-fallback"; sessionId: string; action: string }
  | { type: "not-found" };

/**
 * Route an incoming request based on URL path and headers.
 *
 * @param request - Minimal request shape with url and headers
 * @returns A RouteResult indicating which handler should process the request
 */
export function routeRequest(request: {
  url: string;
  headers: { get(name: string): string | null };
}): RouteResult {
  let pathname: string;
  try {
    const url = new URL(request.url);
    pathname = url.pathname;
  } catch {
    return { type: "not-found" };
  }

  // Normalize: strip trailing slash
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }

  // Match /sessions/:sessionId/... pattern
  const segments = pathname.split("/").filter(Boolean);

  // Expect ["sessions", sessionId, action]
  if (segments.length < 3 || segments[0] !== "sessions") {
    return { type: "not-found" };
  }

  const sessionId = segments[1];
  const action = segments[2];

  if (!sessionId) {
    return { type: "not-found" };
  }

  // WebSocket route: /sessions/:sessionId/ws with Upgrade header
  if (action === "ws") {
    const upgradeHeader = request.headers.get("upgrade");
    if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
      return { type: "websocket", sessionId };
    }
    // If no Upgrade header on /ws, still treat as websocket intent
    return { type: "websocket", sessionId };
  }

  // HTTP fallback: /sessions/:sessionId/:action
  if (action) {
    return { type: "http-fallback", sessionId, action };
  }

  return { type: "not-found" };
}
