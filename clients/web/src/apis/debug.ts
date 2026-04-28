import { transport } from "./transport";

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
