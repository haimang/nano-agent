/**
 * Session DO Runtime — HTTP fallback controller stub.
 *
 * Provides an HTTP polling interface as a fallback for clients that
 * cannot use WebSockets. Supports the same logical operations as the
 * WebSocket controller: start, input, cancel, end, status, timeline.
 *
 * Reference: docs/action-plan/session-do-runtime.md Phase 2
 */

/** Set of supported HTTP fallback actions. */
const SUPPORTED_ACTIONS = new Set([
  "start",
  "input",
  "cancel",
  "end",
  "status",
  "timeline",
]);

/**
 * HTTP fallback controller for session operations.
 *
 * Each action maps to a logical session operation:
 *   start    — begin a new session turn
 *   input    — send follow-up input to an active turn
 *   cancel   — cancel the currently running turn
 *   end      — end the session
 *   status   — retrieve current session/actor state
 *   timeline — retrieve the session event timeline
 */
export class HttpController {
  /**
   * Handle an HTTP request for a session action.
   *
   * @param sessionId - The target session identifier
   * @param action - The action to perform (start, input, cancel, end, status, timeline)
   * @param body - Optional request body for actions that require input
   * @returns Response with status code and body
   */
  async handleRequest(
    sessionId: string,
    action: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    if (!sessionId || sessionId.trim().length === 0) {
      return { status: 400, body: { error: "Missing session ID" } };
    }

    if (!SUPPORTED_ACTIONS.has(action)) {
      return { status: 404, body: { error: `Unknown action: ${action}` } };
    }

    // Dispatch to action-specific stubs.
    switch (action) {
      case "start":
        return this.handleStart(sessionId, body);
      case "input":
        return this.handleInput(sessionId, body);
      case "cancel":
        return this.handleCancel(sessionId);
      case "end":
        return this.handleEnd(sessionId);
      case "status":
        return this.handleStatus(sessionId);
      case "timeline":
        return this.handleTimeline(sessionId);
      default:
        return { status: 404, body: { error: `Unknown action: ${action}` } };
    }
  }

  private async handleStart(_sessionId: string, _body: unknown): Promise<{ status: number; body: unknown }> {
    // Stub: would extract initial_input, create turn, dispatch to kernel
    return { status: 200, body: { ok: true, action: "start" } };
  }

  private async handleInput(_sessionId: string, _body: unknown): Promise<{ status: number; body: unknown }> {
    // Stub: would validate input, queue as follow-up turn input
    return { status: 200, body: { ok: true, action: "input" } };
  }

  private async handleCancel(_sessionId: string): Promise<{ status: number; body: unknown }> {
    // Stub: would signal the kernel to abort the current turn
    return { status: 200, body: { ok: true, action: "cancel" } };
  }

  private async handleEnd(_sessionId: string): Promise<{ status: number; body: unknown }> {
    // Stub: would trigger session end, checkpoint, archive
    return { status: 200, body: { ok: true, action: "end" } };
  }

  private async handleStatus(_sessionId: string): Promise<{ status: number; body: unknown }> {
    // Stub: would return current actor state
    return { status: 200, body: { ok: true, action: "status", phase: "unattached" } };
  }

  private async handleTimeline(_sessionId: string): Promise<{ status: number; body: unknown }> {
    // Stub: would return session event timeline
    return { status: 200, body: { ok: true, action: "timeline", events: [] } };
  }
}
