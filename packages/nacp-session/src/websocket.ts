/**
 * WebSocket Profile Helper — session DO's reusable WS runtime.
 *
 * R1 fix: per-stream seqCounter (not global)
 * R2 fix: pushEvent validates body via SessionStreamEventBodySchema.parse()
 * R3 fix: SessionContext provides real authority/trace, no placeholders
 * R5 fix: ack timeout + heartbeat timeout enforcement integrated
 */

import type { NacpSessionFrame } from "./frame.js";
import { ReplayBuffer, type ReplayBufferOptions } from "./replay.js";
import { AckWindow, shouldRequireAck, type AckWindowOptions } from "./delivery.js";
import { HeartbeatTracker, type HeartbeatOptions } from "./heartbeat.js";
import { SessionStreamEventBodySchema, type SessionStreamEventBody } from "./stream-event.js";
import { NacpSessionError, SESSION_ERROR_CODES } from "./errors.js";
import { NACP_SESSION_WS_SUBPROTOCOL } from "./version.js";

export interface SessionSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface SessionStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

/** Real session identity — no placeholders (R3 fix). */
export interface SessionContext {
  team_uuid: string;
  plan_level: "free" | "pro" | "enterprise" | "internal";
  session_uuid: string;
  trace_id: string;
  producer_id: string;
  user_uuid?: string;
  stamped_by: string;
}

export interface SessionWebSocketHelperOptions {
  replay?: ReplayBufferOptions;
  ack?: AckWindowOptions;
  heartbeat?: HeartbeatOptions;
  sessionContext: SessionContext;
}

export class SessionWebSocketHelper {
  readonly subprotocol = NACP_SESSION_WS_SUBPROTOCOL;
  readonly replay: ReplayBuffer;
  readonly ackWindow: AckWindow;
  readonly heartbeat: HeartbeatTracker;

  private socket: SessionSocketLike | null = null;
  private attached = false;
  private streamSeqCounters = new Map<string, number>(); // R1 fix: per-stream
  private readonly ctx: SessionContext;

  constructor(opts: SessionWebSocketHelperOptions) {
    this.replay = new ReplayBuffer(opts.replay);
    this.ackWindow = new AckWindow(opts.ack);
    this.heartbeat = new HeartbeatTracker(opts.heartbeat);
    this.ctx = opts.sessionContext;
  }

  private nextSeq(streamId: string): number {
    const current = this.streamSeqCounters.get(streamId) ?? 0;
    this.streamSeqCounters.set(streamId, current + 1);
    return current;
  }

  // ── Lifecycle ──

  attach(socket: SessionSocketLike): void {
    if (this.attached) {
      throw new NacpSessionError(
        ["session already has an active WebSocket attachment"],
        SESSION_ERROR_CODES.NACP_SESSION_ALREADY_ATTACHED,
      );
    }
    this.socket = socket;
    this.attached = true;
    this.heartbeat.recordHeartbeat();
  }

  detach(): void {
    this.socket = null;
    this.attached = false;
    this.ackWindow.clear();
  }

  get isAttached(): boolean {
    return this.attached && this.socket !== null;
  }

  // ── Send (R2 + R3 fixed) ──

  pushEvent(
    streamId: string,
    eventBody: SessionStreamEventBody,
    opts: { ackRequired?: boolean } = {},
  ): NacpSessionFrame {
    // R2 fix: validate event body at runtime
    SessionStreamEventBodySchema.parse(eventBody);

    // R5 fix: check backpressure before sending
    if (this.ackWindow.isBackpressured()) {
      throw new NacpSessionError(
        ["ack window backpressured — too many unacked events"],
        SESSION_ERROR_CODES.NACP_SESSION_ACK_MISMATCH,
      );
    }

    const seq = this.nextSeq(streamId); // R1 fix: per-stream
    const deliveryMode = opts.ackRequired ? "at-least-once" : "at-most-once";

    // R3 fix: use real session context, not placeholders
    const frame: NacpSessionFrame = {
      header: {
        schema_version: "1.0.0",
        message_uuid: crypto.randomUUID(),
        message_type: "session.stream.event",
        delivery_kind: "event",
        sent_at: new Date().toISOString(),
        producer_role: "session",
        producer_id: this.ctx.producer_id,
        priority: "normal",
      },
      authority: {
        team_uuid: this.ctx.team_uuid,
        plan_level: this.ctx.plan_level,
        user_uuid: this.ctx.user_uuid,
        stamped_by: this.ctx.stamped_by,
        stamped_at: new Date().toISOString(),
      },
      trace: {
        trace_id: this.ctx.trace_id,
        session_uuid: this.ctx.session_uuid,
      },
      body: eventBody,
      session_frame: {
        stream_id: streamId,
        stream_seq: seq,
        delivery_mode: deliveryMode,
        ack_required: shouldRequireAck(deliveryMode),
      },
    } as NacpSessionFrame;

    this.replay.append(frame);

    if (this.socket && this.attached) {
      this.socket.send(JSON.stringify(frame));
      if (frame.session_frame.ack_required) {
        this.ackWindow.track(streamId, seq);
      }
    }

    return frame;
  }

  // ── Resume / Replay ──

  handleResume(streamId: string, lastSeenSeq: number): NacpSessionFrame[] {
    const frames = this.replay.replay(streamId, lastSeenSeq + 1);
    if (this.socket && this.attached) {
      for (const f of frames) {
        this.socket.send(JSON.stringify(f));
        if (f.session_frame.ack_required) {
          this.ackWindow.track(f.session_frame.stream_id, f.session_frame.stream_seq);
        }
      }
    }
    return frames;
  }

  // ── Ack handling (R5 fix: mismatch detection) ──

  /**
   * Handle client ack. Returns count of cleared pending acks.
   *
   * Contract (Blocker 3 clarification):
   * - ack/heartbeat health enforcement is CALLER-MANAGED, not auto-enforced.
   * - The session DO loop should periodically call checkHeartbeatHealth() and checkAckHealth().
   * - This helper will reject future acks (acked_seq beyond latest sent seq) as protocol error.
   * - Redundant/stale acks (already cleared) are silently accepted (no error).
   */
  handleAck(streamId: string, ackedSeq: number): number {
    const latestSeq = this.replay.getLatestSeq(streamId);
    if (latestSeq >= 0 && ackedSeq > latestSeq) {
      throw new NacpSessionError(
        [`ack seq ${ackedSeq} is beyond latest sent seq ${latestSeq} for stream '${streamId}'`],
        SESSION_ERROR_CODES.NACP_SESSION_ACK_MISMATCH,
      );
    }
    return this.ackWindow.ack(streamId, ackedSeq);
  }

  // ── Heartbeat (R5 fix: timeout enforcement) ──

  handleHeartbeat(): void {
    this.heartbeat.recordHeartbeat();
  }

  checkHeartbeatHealth(): void {
    if (this.heartbeat.isTimedOut()) {
      throw new NacpSessionError(
        ["heartbeat timeout — connection presumed dead"],
        SESSION_ERROR_CODES.NACP_SESSION_HEARTBEAT_TIMEOUT,
      );
    }
  }

  checkAckHealth(): void {
    const timedOut = this.ackWindow.getTimedOut();
    if (timedOut.length > 0) {
      throw new NacpSessionError(
        [`${timedOut.length} ack(s) timed out — client may be unresponsive`],
        SESSION_ERROR_CODES.NACP_SESSION_ACK_MISMATCH,
      );
    }
  }

  // ── Checkpoint for DO hibernation ──

  async checkpoint(storage: SessionStorageLike): Promise<void> {
    await storage.put("nacp_session:replay", this.replay.checkpoint());
    await storage.put("nacp_session:stream_seqs", Object.fromEntries(this.streamSeqCounters));
  }

  async restore(storage: SessionStorageLike): Promise<void> {
    const replayData = await storage.get<Record<string, { events: unknown[]; baseSeq: number }>>(
      "nacp_session:replay",
    );
    if (replayData) {
      this.replay.restore(replayData);
    }
    const seqs = await storage.get<Record<string, number>>("nacp_session:stream_seqs");
    if (seqs) {
      this.streamSeqCounters = new Map(Object.entries(seqs));
    }
  }

  close(code = 1000, reason = "session ended"): void {
    if (this.socket) {
      this.socket.close(code, reason);
    }
    this.detach();
  }
}
