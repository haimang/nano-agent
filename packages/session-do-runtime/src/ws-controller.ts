/**
 * Session DO Runtime — WebSocket controller stub.
 *
 * Handles WebSocket lifecycle for a session: upgrade, message
 * processing, and close. This is a stub that defines the contract;
 * real implementations will integrate with the kernel and stream
 * subsystems.
 *
 * Reference: docs/action-plan/session-do-runtime.md Phase 2
 */

/**
 * WebSocket controller for session real-time communication.
 *
 * Manages the lifecycle of a WebSocket connection to a session DO:
 * upgrade negotiation, message dispatch, and cleanup on close.
 */
export class WsController {
  /**
   * Handle a WebSocket upgrade request for the given session.
   *
   * Returns a status code indicating the result:
   *   101 — upgrade accepted
   *   400 — invalid session ID
   */
  async handleUpgrade(sessionId: string): Promise<{ status: number }> {
    if (!sessionId || sessionId.trim().length === 0) {
      return { status: 400 };
    }
    // Stub: in production this would initiate the WebSocket handshake
    // and attach the connection to the session actor.
    return { status: 101 };
  }

  /**
   * Handle an incoming WebSocket message for the given session.
   *
   * The message is dispatched to the session actor for processing.
   * This is a fire-and-forget call from the WebSocket frame handler.
   */
  async handleMessage(_sessionId: string, _message: unknown): Promise<void> {
    // Stub: in production this would parse the NACP frame,
    // extract turn input, and dispatch to the kernel step loop.
  }

  /**
   * Handle a WebSocket close event for the given session.
   *
   * Triggers detach logic: checkpoint state, release resources,
   * and clean up the session actor's connection tracking.
   */
  async handleClose(_sessionId: string): Promise<void> {
    // Stub: in production this would trigger session detach,
    // persist checkpoint, and notify the health gate.
  }
}
