import { transport, type ApiResponse } from "./transport";
import type { AuthState } from "./auth";

function authHeaders(auth: AuthState, json = false): Record<string, string> {
  const h: Record<string, string> = { authorization: `Bearer ${auth.token}` };
  if (json) h["content-type"] = "application/json";
  return h;
}

export async function listMySessions(
  auth: AuthState,
): Promise<Record<string, unknown>> {
  const body = await transport.request("/me/sessions", {
    headers: authHeaders(auth),
  });
  return "data" in body
    ? (body as { data: Record<string, unknown> }).data
    : body;
}

export async function createSession(
  auth: AuthState,
): Promise<{ session_uuid: string; ttl_seconds: number }> {
  const body = await transport.request("/me/sessions", {
    method: "POST",
    headers: authHeaders(auth, true),
    body: JSON.stringify({}),
  });

  const data = (
    "data" in body ? (body as { data: Record<string, unknown> }).data : body
  ) as { session_uuid?: string; ttl_seconds?: number };

  if (typeof data.session_uuid !== "string" || data.session_uuid.length === 0) {
    throw new Error("/me/sessions response missing session_uuid");
  }

  return {
    session_uuid: data.session_uuid,
    ttl_seconds: typeof data.ttl_seconds === "number" ? data.ttl_seconds : 86400,
  };
}

export async function startSession(
  auth: AuthState,
  sessionUuid: string,
  initialInput: string,
): Promise<ApiResponse> {
  return transport.request(`/sessions/${sessionUuid}/start`, {
    method: "POST",
    headers: authHeaders(auth, true),
    body: JSON.stringify({ initial_input: initialInput }),
  });
}

export async function sendInput(
  auth: AuthState,
  sessionUuid: string,
  text: string,
): Promise<ApiResponse> {
  return transport.request(`/sessions/${sessionUuid}/input`, {
    method: "POST",
    headers: authHeaders(auth, true),
    body: JSON.stringify({ text, session_uuid: sessionUuid }),
  });
}

export async function timeline(
  auth: AuthState,
  sessionUuid: string,
): Promise<Array<{ kind?: string; seq?: number; [key: string]: unknown }>> {
  const body = await transport.request(`/sessions/${sessionUuid}/timeline`, {
    headers: authHeaders(auth),
  });

  const data = (
    "data" in body ? (body as { data: Record<string, unknown> }).data : body
  ) as { events?: Array<{ kind?: string; seq?: number; [key: string]: unknown }> };

  return Array.isArray(data?.events) ? data.events : [];
}

export async function resume(
  auth: AuthState,
  sessionUuid: string,
  lastSeenSeq: number,
): Promise<Record<string, unknown>> {
  const body = await transport.request(`/sessions/${sessionUuid}/resume`, {
    method: "POST",
    headers: authHeaders(auth, true),
    body: JSON.stringify({ last_seen_seq: lastSeenSeq }),
  });
  return "data" in body
    ? (body as { data: Record<string, unknown> }).data
    : body;
}

export async function history(
  auth: AuthState,
  sessionUuid: string,
): Promise<Record<string, unknown>> {
  const body = await transport.request(`/sessions/${sessionUuid}/history`, {
    headers: authHeaders(auth),
  });
  return "data" in body
    ? (body as { data: Record<string, unknown> }).data
    : body;
}

export async function sessionStatus(
  auth: AuthState,
  sessionUuid: string,
): Promise<Record<string, unknown>> {
  const body = await transport.request(`/sessions/${sessionUuid}/status`, {
    headers: authHeaders(auth),
  });
  return "data" in body
    ? (body as { data: Record<string, unknown> }).data
    : body;
}

export async function usage(
  auth: AuthState,
  sessionUuid: string,
): Promise<Record<string, unknown>> {
  const body = await transport.request(`/sessions/${sessionUuid}/usage`, {
    headers: authHeaders(auth),
  });
  return "data" in body
    ? (body as { data: Record<string, unknown> }).data
    : body;
}
