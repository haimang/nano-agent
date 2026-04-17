/**
 * Heartbeat — liveness detection for WebSocket connections.
 *
 * Both client and server send periodic heartbeats.
 * If no heartbeat arrives within the timeout, the connection is considered stale.
 */

export interface HeartbeatOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

export type HeartbeatStatus = "healthy" | "stale" | "timeout";

export class HeartbeatTracker {
  private lastReceivedAt: number;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;

  constructor(opts: HeartbeatOptions = {}) {
    this.intervalMs = opts.intervalMs ?? 15_000;
    this.timeoutMs = opts.timeoutMs ?? 45_000;
    this.lastReceivedAt = Date.now();
  }

  recordHeartbeat(): void {
    this.lastReceivedAt = Date.now();
  }

  getStatus(): HeartbeatStatus {
    const elapsed = Date.now() - this.lastReceivedAt;
    if (elapsed <= this.intervalMs * 1.5) return "healthy";
    if (elapsed <= this.timeoutMs) return "stale";
    return "timeout";
  }

  isTimedOut(): boolean {
    return this.getStatus() === "timeout";
  }

  getElapsedMs(): number {
    return Date.now() - this.lastReceivedAt;
  }

  shouldSendHeartbeat(lastSentAt: number): boolean {
    return Date.now() - lastSentAt >= this.intervalMs;
  }

  get interval(): number {
    return this.intervalMs;
  }

  get timeout(): number {
    return this.timeoutMs;
  }
}
