/**
 * worker-b /handle/eval-emit — emulates downstream worker emitting
 * evidence to upstream sink.
 *
 * Used by V3-binding-eval-fanin to test whether ordering / dedup /
 * sink overflow are preserved across service-binding callbacks.
 *
 * The handler simulates the FAN-IN side: caller (worker-a) makes a
 * request that asks "emit N evidence records back to me"; this
 * handler responds with N records the caller can then post to its
 * own sink endpoint via a follow-up call. (This emulates worker-b
 * acting as a downstream component pushing events upstream.)
 *
 * Request body:
 *   { count: number, traceUuid: string, dedupSeed?: string }
 */

interface EvalEmitBody {
  count?: number;
  traceUuid?: string;
  dedupSeed?: string;
}

interface EvidenceRecord {
  readonly seq: number;
  readonly traceUuid: string;
  readonly messageUuid: string;
  readonly payload: { tag: string; value: number };
  readonly emittedAt: string;
}

function fakeUuid(seed: string, i: number): string {
  // Deterministic so dedup tests are repeatable.
  let h = 0;
  const s = `${seed}-${i}`;
  for (let j = 0; j < s.length; j++) h = ((h << 5) - h + s.charCodeAt(j)) | 0;
  const hex = (h >>> 0).toString(16).padStart(8, "0");
  return `${hex.slice(0, 8)}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-8${hex.slice(2, 5)}-${hex}${hex.slice(0, 4)}`;
}

export async function handleEvalEmit(request: Request): Promise<Response> {
  const t0 = Date.now();
  let body: EvalEmitBody = {};
  try {
    body = (await request.json()) as EvalEmitBody;
  } catch {
    /* empty body is allowed */
  }
  const count = Math.max(1, Math.min(200, body.count ?? 10));
  const traceUuid = body.traceUuid ?? "00000000-0000-4000-8000-000000000000";
  const dedupSeed = body.dedupSeed ?? "default";

  const records: EvidenceRecord[] = [];
  for (let i = 0; i < count; i++) {
    records.push({
      seq: i,
      traceUuid,
      messageUuid: fakeUuid(dedupSeed, i),
      payload: { tag: "v2-eval-fanin", value: i },
      emittedAt: new Date().toISOString(),
    });
  }

  return Response.json(
    {
      ok: true,
      handler: "eval-emit",
      count: records.length,
      records,
      generationLatencyMs: Date.now() - t0,
    },
    { headers: { "x-spike-handler": "eval-emit" } },
  );
}
