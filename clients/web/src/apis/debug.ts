import { transport } from "./transport";
import type { AuthState } from "./auth";

function authHeaders(auth: AuthState): Record<string, string> {
  return { authorization: `Bearer ${auth.token}` };
}

export interface WorkerHealthEntry {
  readonly worker: string;
  readonly live: boolean;
  readonly status: string;
  readonly worker_version: string | null;
  readonly error?: string;
  readonly details?: Record<string, unknown>;
}

export interface WorkerHealthSnapshot {
  readonly ok: boolean;
  readonly environment: string;
  readonly generated_at: string;
  readonly summary: { readonly live: number; readonly total: number };
  readonly workers: WorkerHealthEntry[];
}

export async function workerHealth(): Promise<WorkerHealthSnapshot> {
  const body = await transport.request("/debug/workers/health");
  return body as unknown as WorkerHealthSnapshot;
}

export async function logs(
  auth: AuthState,
  params: { trace_uuid?: string; session_uuid?: string; code?: string; limit?: number } = {},
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") qs.set(key, String(value));
  }
  return transport.request(`/debug/logs${qs.size ? `?${qs.toString()}` : ""}`, {
    headers: authHeaders(auth),
  }) as Promise<Record<string, unknown>>;
}

export async function recentErrors(
  auth: AuthState,
  params: { code?: string; limit?: number } = {},
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") qs.set(key, String(value));
  }
  return transport.request(`/debug/recent-errors${qs.size ? `?${qs.toString()}` : ""}`, {
    headers: authHeaders(auth),
  }) as Promise<Record<string, unknown>>;
}

export async function audit(
  auth: AuthState,
  params: { trace_uuid?: string; session_uuid?: string; event_kind?: string; limit?: number } = {},
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") qs.set(key, String(value));
  }
  return transport.request(`/debug/audit${qs.size ? `?${qs.toString()}` : ""}`, {
    headers: authHeaders(auth),
  }) as Promise<Record<string, unknown>>;
}

export async function packages(auth: AuthState): Promise<Record<string, unknown>> {
  return transport.request("/debug/packages", {
    headers: authHeaders(auth),
  }) as Promise<Record<string, unknown>>;
}
