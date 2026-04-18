/**
 * Replay Buffer — per-stream_uuid ring buffer for session event replay.
 *
 * Hot path: isolate memory. Hibernation: checkpoint to DO storage.
 * Default: 200 events per stream_uuid, 1000 total across all streams.
 */

import { NacpSessionError, SESSION_ERROR_CODES } from "./errors.js";
import type { NacpSessionFrame } from "./frame.js";

export interface ReplayBufferOptions {
  maxPerStream?: number;
  maxTotal?: number;
}

interface StreamBuffer {
  events: NacpSessionFrame[];
  baseSeq: number; // seq of the oldest event in buffer
}

export class ReplayBuffer {
  private streams = new Map<string, StreamBuffer>();
  private totalCount = 0;
  private readonly maxPerStream: number;
  private readonly maxTotal: number;

  constructor(opts: ReplayBufferOptions = {}) {
    this.maxPerStream = opts.maxPerStream ?? 200;
    this.maxTotal = opts.maxTotal ?? 1000;
  }

  append(frame: NacpSessionFrame): void {
    const sid = frame.session_frame.stream_uuid;
    const seq = frame.session_frame.stream_seq;

    let buf = this.streams.get(sid);
    if (!buf) {
      buf = { events: [], baseSeq: seq };
      this.streams.set(sid, buf);
    }

    buf.events.push(frame);
    this.totalCount++;

    // Trim per-stream
    while (buf.events.length > this.maxPerStream) {
      buf.events.shift();
      buf.baseSeq++;
      this.totalCount--;
    }

    // Trim global (evict oldest from largest stream)
    while (this.totalCount > this.maxTotal) {
      this.evictOldest();
    }
  }

  replay(streamUuid: string, fromSeq: number): NacpSessionFrame[] {
    const buf = this.streams.get(streamUuid);
    if (!buf) return [];

    const endSeq = buf.baseSeq + buf.events.length;
    if (fromSeq < buf.baseSeq) {
      throw new NacpSessionError(
        [`replay_from ${fromSeq} is before buffer start ${buf.baseSeq} for stream '${streamUuid}'`],
        SESSION_ERROR_CODES.NACP_REPLAY_OUT_OF_RANGE,
      );
    }
    if (fromSeq >= endSeq) return [];

    const offset = fromSeq - buf.baseSeq;
    return buf.events.slice(offset);
  }

  getLatestSeq(streamUuid: string): number {
    const buf = this.streams.get(streamUuid);
    if (!buf || buf.events.length === 0) return -1;
    return buf.events[buf.events.length - 1]!.session_frame.stream_seq;
  }

  /** Serialize for DO storage checkpoint (hibernation). */
  checkpoint(): Record<string, { events: unknown[]; baseSeq: number }> {
    const result: Record<string, { events: unknown[]; baseSeq: number }> = {};
    for (const [sid, buf] of this.streams) {
      result[sid] = { events: buf.events, baseSeq: buf.baseSeq };
    }
    return result;
  }

  /** Restore from DO storage checkpoint (wake from hibernation). */
  restore(data: Record<string, { events: unknown[]; baseSeq: number }>): void {
    this.streams.clear();
    this.totalCount = 0;
    for (const [sid, raw] of Object.entries(data)) {
      const buf: StreamBuffer = {
        events: raw.events as NacpSessionFrame[],
        baseSeq: raw.baseSeq,
      };
      this.streams.set(sid, buf);
      this.totalCount += buf.events.length;
    }
  }

  get size(): number {
    return this.totalCount;
  }

  get streamCount(): number {
    return this.streams.size;
  }

  private evictOldest(): void {
    let largestSid: string | null = null;
    let largestLen = 0;
    for (const [sid, buf] of this.streams) {
      if (buf.events.length > largestLen) {
        largestLen = buf.events.length;
        largestSid = sid;
      }
    }
    if (largestSid) {
      const buf = this.streams.get(largestSid)!;
      buf.events.shift();
      buf.baseSeq++;
      this.totalCount--;
      if (buf.events.length === 0) this.streams.delete(largestSid);
    }
  }
}
