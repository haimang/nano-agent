// ZX5 Lane C C6 — web client heartbeat tracker (local mirror).
//
// This file is a behavior-equivalent copy of
// `packages/nacp-session/src/heartbeat.ts`'s `HeartbeatTracker`. The web
// client's vite/react build does not currently consume `@haimang/nacp-session`
// from the npm registry (the package is published to GitHub Packages, which
// requires `NODE_AUTH_TOKEN` plumbing into the deploy/build pipeline). Until
// that plumbing lands, this mirror keeps behavior in lockstep.
//
// TODO (post-ZX5, per kimi R3 + GLM R6): once the build pipeline gains
// `NODE_AUTH_TOKEN` access, replace this file with a re-export from
// `@haimang/nacp-session` and delete the local mirror. **The mirror's
// `intervalMs` / `timeoutMs` defaults and method shape MUST stay 1:1 with the
// upstream package** — diverging here will silently desync clients from the
// orchestrator-core heartbeat contract.

export interface HeartbeatOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

export type HeartbeatStatus = "healthy" | "stale" | "timeout";

export class HeartbeatTracker {
  private lastReceivedAt: number;
  readonly intervalMs: number;
  readonly timeoutMs: number;

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
