import type { IngressAuthSnapshot } from "../../auth.js";
import {
  isAuthSnapshot,
  type SessionEntry,
} from "../../session-lifecycle.js";
import type { UserDoSessionFlowContext } from "./types.js";

type BodyWithAuth = {
  auth_snapshot?: unknown;
  initial_context_seed?: unknown;
};

export async function maybeRefreshUserState(
  ctx: UserDoSessionFlowContext,
  body: BodyWithAuth,
): Promise<void> {
  if (body.auth_snapshot) {
    await ctx.refreshUserState(
      body.auth_snapshot as IngressAuthSnapshot,
      body.initial_context_seed,
    );
  }
}

export async function readPersistedAuthSnapshot(
  ctx: UserDoSessionFlowContext,
  body: BodyWithAuth,
): Promise<IngressAuthSnapshot | null> {
  return isAuthSnapshot(body.auth_snapshot)
    ? body.auth_snapshot
    : (await ctx.get<IngressAuthSnapshot>(ctx.userAuthSnapshotKey)) ?? null;
}

export function buildConversationPointer(
  conversationUuid: string,
  sessionUuid: string,
) {
  return {
    conversation_uuid: conversationUuid,
    session_uuid: sessionUuid,
    conversation_created: false,
  } as const;
}

export async function enforceReadableEntry(
  ctx: UserDoSessionFlowContext,
  sessionUuid: string,
  entry: SessionEntry,
  authSnapshot: IngressAuthSnapshot | null | undefined,
): Promise<SessionEntry | Response> {
  return ctx.enforceSessionDevice(sessionUuid, entry, authSnapshot);
}
