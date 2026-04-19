/**
 * V1-storage-R2-list-cursor probe.
 *
 * Validation goal (per P0-spike-do-storage-design §4.2):
 *   - R2 list() page-size upper bound
 *   - cursor / truncated semantics
 *   - Total wall-clock for full enumeration
 *
 * Strategy: pre-populate N keys (default 1500), then list with various
 * limits and cursor walking.
 */

import { makeResult, type ProbeResult } from "../result-shape.js";

const PREFIX = "list-cursor-probe/";

async function ensureKeys(r2: R2Bucket, n: number): Promise<number> {
  // Idempotent: only put missing keys. Cheap to re-run.
  let created = 0;
  // Probe in batches to avoid blowing cpu_ms budget.
  for (let i = 0; i < n; i++) {
    const key = `${PREFIX}${String(i).padStart(5, "0")}`;
    // Fast check via head() — but head() per key is N round-trips, expensive.
    // Cheaper to just put() since R2 put is idempotent.
    await r2.put(key, `payload-${i}`);
    created++;
  }
  return created;
}

export async function probeR2ListCursor(
  r2: R2Bucket,
  params: { keyCount?: number; pageLimit?: number; preseed?: boolean },
): Promise<ProbeResult> {
  const start = Date.now();
  const keyCount = params.keyCount ?? 1500;
  const pageLimit = params.pageLimit ?? 1000;
  const observations: ProbeResult["observations"] = [];
  const errors: ProbeResult["errors"] = [];

  // Preseed only when requested (preseeding 1500 keys can take 30+s and
  // burn cpu_ms; default false to allow caller to control).
  if (params.preseed) {
    try {
      const t0 = Date.now();
      const created = await ensureKeys(r2, keyCount);
      observations.push({
        label: "preseed_complete",
        value: { keyCount: created, durationMs: Date.now() - t0 },
      });
    } catch (err) {
      errors.push({
        code: "PreseedFailed",
        message: String((err as Error)?.message ?? err),
        count: 1,
      });
    }
  }

  // First list call: no cursor.
  let pages = 0;
  let totalReturned = 0;
  let cursor: string | undefined;
  const pageSizes: number[] = [];

  try {
    do {
      const listResult = await r2.list({
        prefix: PREFIX,
        limit: pageLimit,
        cursor,
      });
      pages++;
      const objCount = listResult.objects.length;
      totalReturned += objCount;
      pageSizes.push(objCount);
      observations.push({
        label: `page_${pages}`,
        value: {
          objCount,
          truncated: listResult.truncated,
          cursor: listResult.truncated ? "..." : null,
        },
      });
      cursor = listResult.truncated ? (listResult as { cursor?: string }).cursor : undefined;
      // Safety: bail at 20 pages.
      if (pages >= 20) break;
    } while (cursor);
  } catch (err) {
    errors.push({
      code: "ListFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  observations.push({
    label: "summary",
    value: { pages, totalReturned, requestedLimit: pageLimit, pageSizes },
  });

  return makeResult("V1-storage-R2-list-cursor", start, {
    success: errors.length === 0,
    observations,
    errors,
    timings: { samplesN: pages },
  });
}
