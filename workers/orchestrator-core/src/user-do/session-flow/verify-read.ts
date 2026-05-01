import { readJson } from "../../parity-bridge.js";
import {
  jsonResponse,
  type VerifyBody,
} from "../../session-lifecycle.js";
import type { UserDoSessionFlowContext } from "./types.js";
import { maybeRefreshUserState, readPersistedAuthSnapshot } from "./shared.js";
import { requireReadableSession } from "./hydrate.js";

export async function handleVerify(
  ctx: UserDoSessionFlowContext,
  sessionUuid: string,
  body: VerifyBody,
): Promise<Response> {
  const entry = await ctx.requireSession(sessionUuid);
  if (!entry) return ctx.sessionGateMiss(sessionUuid);
  await maybeRefreshUserState(ctx, body);
  const authSnapshot = await readPersistedAuthSnapshot(ctx, body);
  const gatedEntry = await ctx.enforceSessionDevice(sessionUuid, entry, authSnapshot);
  if (gatedEntry instanceof Response) return gatedEntry;
  const verifyAck = await ctx.forwardInternalJsonShadow(
    sessionUuid,
    "verify",
    body as unknown as Record<string, unknown>,
    "verify",
  );
  const response = verifyAck.response;
  const proxied = await ctx.proxyReadResponse(sessionUuid, gatedEntry, response);
  const durableTruth = await ctx.readDurableSnapshot(sessionUuid);
  const bodyJson = await readJson(proxied.clone());
  const nextBody = !durableTruth
    ? bodyJson
    : {
        ...(bodyJson ?? {}),
        durable_truth: durableTruth,
      };
  await ctx.rememberCache(`verify:${sessionUuid}`, nextBody ?? null);
  return ctx.cloneJsonResponse(proxied.status, nextBody ?? null);
}

export async function handleRead(
  ctx: UserDoSessionFlowContext,
  sessionUuid: string,
  action: "status" | "timeline" | "history",
): Promise<Response> {
  const entry = await requireReadableSession(ctx, sessionUuid);
  if (!entry) return ctx.sessionGateMiss(sessionUuid);
  if (action === "history") {
    await ctx.touchSession(sessionUuid, entry.status);
    const messages = await ctx.readDurableHistory(sessionUuid);
    return jsonResponse(200, {
      ok: true,
      action: "history",
      session_uuid: sessionUuid,
      messages,
    });
  }
  if (action === "timeline") {
    const events = await ctx.readDurableTimeline(sessionUuid);
    if (events.length > 0) {
      await ctx.touchSession(sessionUuid, entry.status);
      return jsonResponse(200, {
        ok: true,
        action: "timeline",
        session_uuid: sessionUuid,
        events,
      });
    }
  }
  if (action === "status") {
    const durableTruth = await ctx.readDurableSnapshot(sessionUuid);
    const response = await ctx.forwardStatus(sessionUuid);
    const proxied = await ctx.proxyReadResponse(sessionUuid, entry, response);
    const bodyJson = await readJson(proxied.clone());
    const nextBody = !durableTruth
      ? bodyJson
      : {
          ...(bodyJson ?? {}),
          durable_truth: durableTruth,
        };
    await ctx.rememberCache(`status:${sessionUuid}`, nextBody ?? null);
    return ctx.cloneJsonResponse(proxied.status, nextBody ?? null);
  }
  const timelineAck = await ctx.forwardInternalJsonShadow(
    sessionUuid,
    "timeline",
    undefined,
    "timeline",
  );
  return ctx.proxyReadResponse(sessionUuid, entry, timelineAck.response);
}
