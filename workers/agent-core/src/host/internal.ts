import {
  validateInternalAuthority,
  type InternalAuthorityResult,
} from "./internal-policy.js";

export interface AgentInternalEnv {
  readonly SESSION_DO: DurableObjectNamespace;
  readonly NANO_INTERNAL_BINDING_SECRET?: string;
  readonly TEAM_UUID?: string;
  readonly ENVIRONMENT?: string;
}

// ZX4 Phase 9 P9-01 — P3-05 flip: non-stream HTTP fetch handlers retired.
// Only `stream` (NDJSON relay) and `stream_snapshot` (cursor pagination)
// remain on the worker-level /internal/ surface. start / input / cancel /
// status / timeline / verify are reachable solely via the RPC binding
// (AgentCoreEntrypoint methods → DO stub.fetch on `session.internal`).
// permission-decision / elicitation-answer also bypass this path — they
// route directly through the DO via stub.fetch.
type SupportedInternalAction = "stream" | "stream_snapshot";

const SUPPORTED_INTERNAL_ACTIONS = new Set<SupportedInternalAction>([
  "stream",
  "stream_snapshot",
]);

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

type ValidatedInternalAuthority = Extract<InternalAuthorityResult, { ok: true }>;

function buildForwardHeaders(
  env: AgentInternalEnv,
  validated: ValidatedInternalAuthority,
  contentType?: string | null,
): Headers {
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  headers.set("x-trace-uuid", validated.traceUuid);
  headers.set("x-nano-internal-authority", JSON.stringify(validated.authority));
  if (env.NANO_INTERNAL_BINDING_SECRET) {
    headers.set("x-nano-internal-binding-secret", env.NANO_INTERNAL_BINDING_SECRET);
  }
  return headers;
}

function parseInternalRoute(request: Request):
  | { type: "action"; sessionId: string; action: SupportedInternalAction }
  | { type: "unsupported-action"; action: string | null }
  | { type: "not-found" } {
  const pathname = new URL(request.url).pathname.replace(/\/$/, "");
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length !== 4 || segments[0] !== "internal" || segments[1] !== "sessions") {
    return { type: "not-found" };
  }
  const sessionId = segments[2];
  const action = segments[3];
  if (!sessionId || !action) return { type: "not-found" };
  if (!SUPPORTED_INTERNAL_ACTIONS.has(action as SupportedInternalAction)) {
    return { type: "unsupported-action", action };
  }
  return { type: "action", sessionId, action: action as SupportedInternalAction };
}

function buildNdjsonStream(lines: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
      controller.close();
    },
  });
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// First-wave relay is snapshot-based: synthesize a finite NDJSON body from
// timeline + status reads rather than holding a persistent push channel open.
async function forwardInternalStream(
  env: AgentInternalEnv,
  validated: ValidatedInternalAuthority,
  sessionId: string,
): Promise<Response> {
  const stub = env.SESSION_DO.get(env.SESSION_DO.idFromName(sessionId));
  const headers = buildForwardHeaders(env, validated);
  const timelineResponse = await stub.fetch(
    new Request(`https://session.internal/sessions/${sessionId}/timeline`, { method: "GET", headers }),
  );
  if (!timelineResponse.ok) return timelineResponse;
  const timelineBody = await readJson(timelineResponse);
  const events = Array.isArray(timelineBody?.events)
    ? timelineBody.events.filter((event): event is Record<string, unknown> => Boolean(event) && typeof event === "object")
    : [];

  const lines: string[] = [
    JSON.stringify({ kind: "meta", seq: 0, event: "opened", session_uuid: sessionId }),
    ...events.map((payload, index) => JSON.stringify({
      kind: "event",
      seq: index + 1,
      name: "session.stream.event",
      payload,
    })),
  ];

  const statusResponse = await stub.fetch(
    new Request(`https://session.internal/sessions/${sessionId}/status`, { method: "GET", headers }),
  );
  if (statusResponse.ok) {
    const statusBody = await readJson(statusResponse);
    const phase = typeof statusBody?.phase === "string" ? statusBody.phase : null;
    let nextSeq = events.length + 1;

    if (phase && events.length === 0) {
      lines.push(JSON.stringify({
        kind: "event",
        seq: nextSeq,
        name: "session.stream.event",
        payload: { kind: "session.update", phase },
      }));
      nextSeq += 1;
    }

    if (phase && phase !== "turn_running") {
      lines.push(JSON.stringify({
        kind: "terminal",
        seq: nextSeq,
        terminal: "completed",
        payload: { phase },
      }));
    }
  }

  return new Response(buildNdjsonStream(lines), {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

// ZX2 Phase 3 P3-02 — cursor-paginated stream snapshot.
//
// Wire shape (always Envelope-shaped JSON; never NDJSON over RPC):
//
//   200 OK:
//   {
//     ok: true,
//     data: {
//       events: Array<{ seq: number, payload: unknown }>,
//       next_cursor: string | null,   // opaque cursor; clients should
//                                     // pass it back in the next call
//       terminal?: { phase: string }, // present only when session ended
//     },
//   }
//
// Query params:
//   ?cursor=<seq>   start emitting events with seq > cursor (default 0)
//   ?limit=<n>      cap the number of events returned (default 200)
async function forwardStreamSnapshot(
  env: AgentInternalEnv,
  validated: ValidatedInternalAuthority,
  sessionId: string,
  url: URL,
): Promise<Response> {
  const cursorParam = url.searchParams.get("cursor");
  const limitParam = url.searchParams.get("limit");
  // ZX1-ZX2 review (Kimi §6.3 #2): cursor/limit must be validated, not
  // silently coerced. Bad input now returns invalid-input rather than
  // masquerading as defaults — this lets misbehaving clients surface
  // their bug instead of receiving an unrelated page silently.
  let cursor = 0;
  if (cursorParam !== null) {
    const n = Number(cursorParam);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      return jsonResponse(400, {
        ok: false,
        error: {
          code: "invalid-input",
          status: 400,
          message: "stream_snapshot cursor must be a non-negative integer",
        },
      });
    }
    cursor = n;
  }
  let limit = 200;
  if (limitParam !== null) {
    const n = Number(limitParam);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 1000) {
      return jsonResponse(400, {
        ok: false,
        error: {
          code: "invalid-input",
          status: 400,
          message: "stream_snapshot limit must be an integer in [1, 1000]",
        },
      });
    }
    limit = n;
  }

  const stub = env.SESSION_DO.get(env.SESSION_DO.idFromName(sessionId));
  const headers = buildForwardHeaders(env, validated);

  const timelineResponse = await stub.fetch(
    new Request(`https://session.internal/sessions/${sessionId}/timeline`, {
      method: "GET",
      headers,
    }),
  );
  if (!timelineResponse.ok) {
    const errBody = await readJson(timelineResponse);
    return jsonResponse(timelineResponse.status, {
      ok: false,
      error: {
        code: "internal-error",
        status: timelineResponse.status,
        message: typeof errBody?.message === "string" ? errBody.message : "timeline read failed",
      },
    });
  }
  const timelineBody = await readJson(timelineResponse);
  const allEvents = Array.isArray(timelineBody?.events)
    ? timelineBody.events.filter(
        (event): event is Record<string, unknown> => Boolean(event) && typeof event === "object",
      )
    : [];

  // Page slice — cursor is the last seq we already emitted; one event per
  // index. Seq numbers are 1-indexed in this snapshot RPC to mirror the
  // existing NDJSON stream (which numbers 1..N for events).
  const sliced = allEvents
    .map((payload, index) => ({ seq: index + 1, payload }))
    .filter((entry) => entry.seq > cursor)
    .slice(0, limit);
  const nextCursor =
    sliced.length === 0
      ? null
      : sliced[sliced.length - 1]!.seq < allEvents.length
        ? String(sliced[sliced.length - 1]!.seq)
        : null;

  let terminal: { phase: string } | undefined;
  const statusResponse = await stub.fetch(
    new Request(`https://session.internal/sessions/${sessionId}/status`, {
      method: "GET",
      headers,
    }),
  );
  if (statusResponse.ok) {
    const statusBody = await readJson(statusResponse);
    const phase = typeof statusBody?.phase === "string" ? statusBody.phase : null;
    if (phase && phase !== "turn_running") {
      terminal = { phase };
    }
  }

  return jsonResponse(200, {
    ok: true,
    data: {
      events: sliced,
      next_cursor: nextCursor,
      ...(terminal ? { terminal } : {}),
    },
  });
}

export async function routeInternal(request: Request, env: AgentInternalEnv): Promise<Response> {
  const route = parseInternalRoute(request);
  if (route.type === "not-found") {
    return jsonResponse(404, { error: "not-found", message: "internal route not found" });
  }
  if (route.type === "unsupported-action") {
    return jsonResponse(404, {
      error: "unsupported-action",
      message: `internal action '${route.action ?? "unknown"}' is not supported`,
    });
  }

  const validated = await validateInternalAuthority(request, env);
  if (!validated.ok) return validated.response;

  switch (route.action) {
    case "stream":
      return forwardInternalStream(env, validated, route.sessionId);
    case "stream_snapshot":
      return forwardStreamSnapshot(
        env,
        validated,
        route.sessionId,
        new URL(request.url),
      );
    default:
      return jsonResponse(404, { error: "unsupported-action", message: "internal action not supported" });
  }
}
