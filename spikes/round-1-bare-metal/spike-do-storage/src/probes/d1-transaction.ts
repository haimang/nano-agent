/**
 * V1-storage-D1-transaction probe.
 *
 * Validation goal (per P0-spike-do-storage-design §4.6):
 *   - Test D1 single-query batch atomicity
 *   - Test whether D1 supports cross-query transactions (predicted: no)
 *   - Real atomic boundary of `db.batch([...])` API
 */

import { makeResult, type ProbeResult } from "../result-shape.js";

const TABLE = "v1_storage_d1_transaction_probe";

async function ensureSchema(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (id TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    )
    .run();
}

export async function probeD1Transaction(
  db: D1Database,
  _params: Record<string, unknown>,
): Promise<ProbeResult> {
  const start = Date.now();
  const observations: ProbeResult["observations"] = [];
  const errors: ProbeResult["errors"] = [];

  try {
    await ensureSchema(db);
    // Clean previous run.
    await db.prepare(`DELETE FROM ${TABLE} WHERE id LIKE 'probe-%'`).run();
  } catch (err) {
    errors.push({
      code: "SchemaInitFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
    return makeResult("V1-storage-D1-transaction", start, {
      success: false,
      observations,
      errors,
      timings: { samplesN: 0 },
    });
  }

  // (1) batch with no failure — should commit all.
  try {
    const t0 = Date.now();
    await db.batch([
      db.prepare(`INSERT INTO ${TABLE} (id, value) VALUES (?, ?)`).bind("probe-1a", "v1"),
      db.prepare(`INSERT INTO ${TABLE} (id, value) VALUES (?, ?)`).bind("probe-1b", "v2"),
    ]);
    const got = await db
      .prepare(`SELECT id, value FROM ${TABLE} WHERE id LIKE 'probe-1%' ORDER BY id`)
      .all<{ id: string; value: string }>();
    observations.push({
      label: "happy_batch",
      value: { latencyMs: Date.now() - t0, rows: got.results },
    });
  } catch (err) {
    errors.push({
      code: "HappyBatchFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  // (2) batch with one failing statement — observe whether earlier statements roll back.
  try {
    const t0 = Date.now();
    let batchError: string | null = null;
    try {
      await db.batch([
        db.prepare(`INSERT INTO ${TABLE} (id, value) VALUES (?, ?)`).bind("probe-2a", "v1"),
        // PK collision — should fail.
        db.prepare(`INSERT INTO ${TABLE} (id, value) VALUES (?, ?)`).bind("probe-1a", "duplicate"),
        db.prepare(`INSERT INTO ${TABLE} (id, value) VALUES (?, ?)`).bind("probe-2c", "v3"),
      ]);
    } catch (e) {
      batchError = String((e as Error)?.message ?? e);
    }
    const got = await db
      .prepare(`SELECT id FROM ${TABLE} WHERE id IN ('probe-2a','probe-2c') ORDER BY id`)
      .all<{ id: string }>();
    observations.push({
      label: "failing_batch_atomicity",
      value: {
        latencyMs: Date.now() - t0,
        batchError,
        survivingRows: got.results.map((r) => r.id),
        // If atomicity holds, survivingRows must be empty (entire batch rolled back).
        // If it does not hold, probe-2a or probe-2c may survive.
      },
    });
  } catch (err) {
    errors.push({
      code: "FailingBatchProbeFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  // (3) cross-query "transaction" — D1 has no BEGIN/COMMIT; this is to
  // confirm the absence and document the actual error if attempted.
  try {
    let beginError: string | null = null;
    try {
      await db.prepare("BEGIN").run();
    } catch (e) {
      beginError = String((e as Error)?.message ?? e);
    }
    observations.push({
      label: "cross_query_transaction_attempt",
      value: { beginError },
    });
  } catch (err) {
    errors.push({
      code: "CrossQueryProbeFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  return makeResult("V1-storage-D1-transaction", start, {
    success: errors.length === 0,
    observations,
    errors,
    timings: { samplesN: 3 },
  });
}
