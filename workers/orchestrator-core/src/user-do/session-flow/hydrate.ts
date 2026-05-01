import {
  MAX_RECENT_FRAMES,
  recentFramesKey,
  type RecentFramesState,
} from "../../session-read-model.js";
import {
  sessionKey,
  type SessionEntry,
} from "../../session-lifecycle.js";
import type { UserDoSessionFlowContext } from "./types.js";

export async function hydrateSessionFromDurableTruth(
  ctx: UserDoSessionFlowContext,
  sessionUuid: string,
): Promise<SessionEntry | null> {
  const durable = await ctx.readDurableSnapshot(sessionUuid);
  if (!durable) return null;
  if (durable.session_status === "pending" || durable.session_status === "expired") {
    return null;
  }
  const now = new Date().toISOString();
  const entry: SessionEntry = {
    created_at: durable.started_at,
    last_seen_at: now,
    status: durable.session_status,
    last_phase: durable.last_phase,
    relay_cursor: durable.last_event_seq,
    ended_at: durable.ended_at,
  };
  await ctx.put(sessionKey(sessionUuid), entry);
  await ctx.updateConversationIndex(
    {
      conversation_uuid: durable.conversation_uuid,
      session_uuid: sessionUuid,
      conversation_created: false,
    },
    entry,
  );
  const timeline = await ctx.readDurableTimeline(sessionUuid);
  if (timeline.length > 0) {
    const recentEvents = timeline.slice(-MAX_RECENT_FRAMES);
    const startSeq = Math.max(1, durable.last_event_seq - recentEvents.length + 1);
    await ctx.put(recentFramesKey(sessionUuid), {
      updated_at: now,
      frames: recentEvents.map((payload, index) => ({
        kind: "event",
        seq: startSeq + index,
        name: "session.stream.event",
        payload,
      })),
    } satisfies RecentFramesState);
  }
  return entry;
}

export async function requireReadableSession(
  ctx: UserDoSessionFlowContext,
  sessionUuid: string,
): Promise<SessionEntry | null> {
  return (await ctx.requireSession(sessionUuid)) ?? hydrateSessionFromDurableTruth(ctx, sessionUuid);
}
