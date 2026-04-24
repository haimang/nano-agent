import { validateInternalAuthority } from "./internal-policy.js";

export interface AgentInternalEnv {
  readonly SESSION_DO: DurableObjectNamespace;
  readonly NANO_INTERNAL_BINDING_SECRET?: string;
  readonly TEAM_UUID?: string;
  readonly ENVIRONMENT?: string;
}

type SupportedInternalAction =
  | "start"
  | "input"
  | "cancel"
  | "status"
  | "timeline"
  | "verify"
  | "stream";

const SUPPORTED_INTERNAL_ACTIONS = new Set<SupportedInternalAction>([
  "start",
  "input",
  "cancel",
  "status",
  "timeline",
  "verify",
  "stream",
]);

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
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

async function forwardHttpAction(
  env: AgentInternalEnv,
  sessionId: string,
  action: Exclude<SupportedInternalAction, "stream">,
  method: string,
  contentType: string | null,
  bodyText?: string,
): Promise<Response> {
  const stub = env.SESSION_DO.get(env.SESSION_DO.idFromName(sessionId));
  const targetUrl = `https://session.internal/sessions/${sessionId}/${action}`;
  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  const body = method === "GET" || method === "HEAD" ? undefined : bodyText;
  return stub.fetch(new Request(targetUrl, { method, headers, body }));
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
async function forwardInternalStream(env: AgentInternalEnv, sessionId: string): Promise<Response> {
  const stub = env.SESSION_DO.get(env.SESSION_DO.idFromName(sessionId));
  const timelineResponse = await stub.fetch(
    new Request(`https://session.internal/sessions/${sessionId}/timeline`, { method: "GET" }),
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
    new Request(`https://session.internal/sessions/${sessionId}/status`, { method: "GET" }),
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
      return forwardInternalStream(env, route.sessionId);
    case "start":
    case "input":
    case "cancel":
    case "status":
    case "timeline":
    case "verify":
      return forwardHttpAction(
        env,
        route.sessionId,
        route.action,
        request.method.toUpperCase(),
        request.headers.get("content-type"),
        validated.bodyText,
      );
    default:
      return jsonResponse(404, { error: "unsupported-action", message: "internal action not supported" });
  }
}
