/**
 * Delivery & Ack — delivery_mode / ack_required / ack window management.
 *
 * v1: two modes only — at-most-once (best-effort) and at-least-once (ack-required).
 */

import { NacpSessionError, SESSION_ERROR_CODES } from "./errors.js";

export type DeliveryMode = "at-most-once" | "at-least-once";

export interface AckWindowOptions {
  maxUnacked?: number;
  ackTimeoutMs?: number;
}

export interface PendingAck {
  streamId: string;
  seq: number;
  sentAt: number;
}

export class AckWindow {
  private pending: PendingAck[] = [];
  private readonly maxUnacked: number;
  private readonly ackTimeoutMs: number;

  constructor(opts: AckWindowOptions = {}) {
    this.maxUnacked = opts.maxUnacked ?? 50;
    this.ackTimeoutMs = opts.ackTimeoutMs ?? 30_000;
  }

  track(streamId: string, seq: number): void {
    this.pending.push({ streamId, seq, sentAt: Date.now() });
  }

  ack(streamId: string, ackedSeq: number): number {
    const before = this.pending.length;
    this.pending = this.pending.filter(
      (p) => !(p.streamId === streamId && p.seq <= ackedSeq),
    );
    return before - this.pending.length;
  }

  getTimedOut(): PendingAck[] {
    const now = Date.now();
    return this.pending.filter((p) => now - p.sentAt > this.ackTimeoutMs);
  }

  isBackpressured(): boolean {
    return this.pending.length >= this.maxUnacked;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  clear(): void {
    this.pending = [];
  }
}

export function shouldRequireAck(deliveryMode: DeliveryMode): boolean {
  return deliveryMode === "at-least-once";
}
