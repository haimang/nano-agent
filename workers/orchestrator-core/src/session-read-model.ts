// ZX4 Phase 0 seam extraction(per ZX4-ZX5 GPT review Q3 4-module seam):
// session-read-model — read-side index types(conversations / active pointers /
// recent frames / cache / ended index)+ keys + size limits。
// **本文件仅含类型 + pure helper functions + 常量**;DO class 的 handleStatus /
// handleTimeline / handleHistory / handleMeSessions / handleUsage 方法体仍在
// user-do.ts。
//
// **R1 read-model 多状态可见(per ZX4-ZX5 GPT review §2.2 R1)**: ZX4 Phase 3
// 引入 'pending' + 'expired' 后,GET /me/sessions 必须返 5 状态全集
// (pending / active / detached / ended / expired)。

import type { SessionStatus } from "./session-lifecycle.js";
import type { StreamFrame } from "./parity-bridge.js";

export interface ConversationIndexItem {
  readonly conversation_uuid: string;
  readonly latest_session_uuid: string;
  readonly status: SessionStatus;
  readonly updated_at: string;
}

export interface ActivePointers {
  readonly conversation_uuid: string | null;
  readonly session_uuid: string | null;
  readonly turn_uuid: string | null;
}

export interface RecentFramesState {
  readonly updated_at: string;
  readonly frames: StreamFrame[];
}

export interface EphemeralCacheEntry {
  readonly key: string;
  readonly value: Record<string, unknown> | null;
  readonly expires_at: string;
}

export interface EndedIndexItem {
  readonly session_uuid: string;
  readonly ended_at: string;
}

export const USER_META_KEY = "user/meta";
export const USER_AUTH_SNAPSHOT_KEY = "user/auth-snapshot";
export const USER_SEED_KEY = "user/seed";
export const ENDED_INDEX_KEY = "sessions/ended-index";
export const CONVERSATION_INDEX_KEY = "conversation/index";
export const ACTIVE_POINTERS_KEY = "conversation/active-pointers";
export const RECENT_FRAMES_PREFIX = "recent-frames/";
export const CACHE_PREFIX = "cache/";

export const MAX_CONVERSATIONS = 200;
export const MAX_RECENT_FRAMES = 50;
export const MAX_ENDED_SESSIONS = 100;
export const ENDED_TTL_MS = 24 * 60 * 60 * 1000;
export const CACHE_TTL_MS = 5 * 60 * 1000;
export const HOT_STATE_ALARM_MS = 10 * 60 * 1000;
// ZX4 P3-04 — pending session TTL: row stays 'pending' until /start arrives
// or alarm GC marks it 'expired'. Per ZX4 plan §1.3 Phase 3.
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export function recentFramesKey(sessionUuid: string): string {
  return `${RECENT_FRAMES_PREFIX}${sessionUuid}`;
}

export function cacheKey(name: string): string {
  return `${CACHE_PREFIX}${name}`;
}
