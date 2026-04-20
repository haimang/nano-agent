/**
 * /sink/ingest — binding-F04 TRUE callback push path.
 *
 * Round 1's eval fan-in test only observed the response body — i.e.
 * worker-a made a request, worker-b returned records, worker-a
 * checked them. That is NOT a "true push" sink; it's a batched
 * response. B7 § 2.4 / §6.2 #5 fixes this by physically placing the
 * sink inside worker-b and having worker-a drive a sequence of
 * `POST /sink/ingest` calls whose payload format matches the dedup
 * / overflow input the real `session-do-runtime` default sink
 * consumes.
 *
 * Request body:
 *   {
 *     "records": [{ record: unknown, messageUuid?: string }, ...]
 *   }
 *
 * Response body:
 *   {
 *     "accepted": number,
 *     "dropped":  number,   // how many were rejected on this call
 *     "batchId":  string
 *   }
 *
 * `/sink/stats` and `/sink/disclosure` then let worker-a confirm
 * the sink's dedup + overflow counters reflect the push path exactly.
 */

import type {
  EvalSinkOverflowDisclosure,
  EvalSinkStats,
} from "@nano-agent/session-do-runtime";

interface IngestArg {
  readonly record: unknown;
  readonly messageUuid?: string;
}
interface IngestBody {
  readonly records?: ReadonlyArray<IngestArg>;
  readonly record?: unknown;
  readonly messageUuid?: string;
}

export async function handleSinkIngest(
  request: Request,
  emit: (args: { record: unknown; messageUuid?: string }) => boolean,
  extractUuid: (record: unknown) => string | undefined,
): Promise<Response> {
  const body: IngestBody = (await request.json().catch(() => ({}))) as IngestBody;
  const items: IngestArg[] = Array.isArray(body.records)
    ? [...body.records]
    : body.record !== undefined
      ? [{ record: body.record, messageUuid: body.messageUuid }]
      : [];

  let accepted = 0;
  let dropped = 0;
  for (const item of items) {
    const messageUuid =
      item.messageUuid ?? extractUuid(item.record) ?? undefined;
    const ok = emit({ record: item.record, messageUuid });
    if (ok) accepted += 1;
    else dropped += 1;
  }

  return Response.json({
    ok: true,
    accepted,
    dropped,
    batchId: `batch-${Date.now()}-${crypto.randomUUID?.() ?? Math.random()}`,
  });
}

export function handleSinkStats(
  getStats: () => EvalSinkStats,
  getRecords: () => readonly unknown[],
): Response {
  const stats = getStats();
  return Response.json({
    ok: true,
    stats,
    recordCount: getRecords().length,
    sampledAt: new Date().toISOString(),
  });
}

export function handleSinkDisclosure(
  getDisclosure: () => readonly EvalSinkOverflowDisclosure[],
): Response {
  const items = getDisclosure();
  return Response.json({
    ok: true,
    count: items.length,
    items,
    sampledAt: new Date().toISOString(),
  });
}

// Reset is handled inline in the worker entry so it can rebuild the
// sink instance with a fresh closure.
export function handleSinkReset(): Response {
  return Response.json({ ok: true });
}
