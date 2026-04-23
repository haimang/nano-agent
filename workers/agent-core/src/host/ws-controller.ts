/**
 * Session DO Runtime — WebSocket controller façade (A4 Phase 2).
 *
 * The controller is the named edge-side façade that the DO calls from
 * `fetch()` / `webSocketMessage()` / `webSocketClose()`. It owns:
 *
 *   - the upgrade verdict (accept / reject with reason)
 *   - a bridge into the DO's ingress pipeline via `onMessage(raw)` —
 *     the DO registers a handler at construction so the controller can
 *     route client bytes into `acceptIngress()` + dispatch without
 *     each DO lifecycle method having to wire the pipeline itself
 *   - the `detach()` hook (persist + signal health on close)
 *
 * The controller purposely does NOT instantiate a `SessionWebSocketHelper`
 * itself — the DO holds one and shares it through the handler closures.
 * This keeps replay/ack/heartbeat helpers as a single source of truth.
 */

export type WsUpgradeOutcome =
  | { status: 101 }
  | { status: 400; reason: "missing-session-id" | "invalid-session-id" };

export interface WsControllerHooks {
  /** Called once per admitted client frame. */
  readonly onMessage?: (raw: string | ArrayBuffer) => Promise<void>;
  /** Called when the WS is about to close. */
  readonly onClose?: () => Promise<void>;
}

/** UUID (v1–v5) pattern matching the DO's `attachSessionUuid` gate. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class WsController {
  private hooks: WsControllerHooks;

  constructor(hooks: WsControllerHooks = {}) {
    this.hooks = hooks;
  }

  /** Late-bind the DO-owned hooks (used when the DO constructs the controller
   *  before the helper is available). */
  attachHooks(hooks: WsControllerHooks): void {
    this.hooks = { ...this.hooks, ...hooks };
  }

  /**
   * Verdict for a WebSocket upgrade. `101` means the DO may call
   * `acceptWebSocket()`. `400` means reject with a typed reason so the
   * caller can surface a specific response body.
   */
  async handleUpgrade(sessionId: string): Promise<WsUpgradeOutcome> {
    if (!sessionId || sessionId.trim().length === 0) {
      return { status: 400, reason: "missing-session-id" };
    }
    // Require UUID-shaped session ids so the checkpoint path never
    // persists a "bad-session" sentinel. Non-UUID ids still give 400,
    // preserving the earlier "empty string" rejection behaviour.
    if (!UUID_RE.test(sessionId)) {
      return { status: 400, reason: "invalid-session-id" };
    }
    return { status: 101 };
  }

  /**
   * Forward an incoming message to the DO-owned ingress pipeline. No-op
   * when no handler is attached (test scaffolding / pre-wire).
   */
  async handleMessage(
    _sessionId: string,
    message: unknown,
  ): Promise<void> {
    if (!this.hooks.onMessage) return;
    if (typeof message === "string" || message instanceof ArrayBuffer) {
      await this.hooks.onMessage(message);
    }
  }

  /** Trigger detach on a close event. */
  async handleClose(_sessionId: string): Promise<void> {
    if (this.hooks.onClose) await this.hooks.onClose();
  }
}
