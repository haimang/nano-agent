/**
 * V1-storage-DO-transactional probe.
 *
 * Validation goal (per P0-spike-do-storage-design §4.4):
 *   - DO state.storage.transaction() commit / abort / throw rollback
 *     semantics
 *   - Behavior when transaction throws midway
 *
 * Strategy: run 3 transactions in ProbeDO and report committed state vs
 * intended state.
 *
 * Routed to ProbeDO via env.DO_PROBE — the actual transactional code
 * lives in ProbeDO.transactionProbe().
 */

import { makeResult, type ProbeResult } from "../result-shape.js";

export async function probeDoTransactional(
  doNs: DurableObjectNamespace,
  _params: Record<string, unknown>,
): Promise<ProbeResult> {
  const start = Date.now();
  const observations: ProbeResult["observations"] = [];
  const errors: ProbeResult["errors"] = [];

  const id = doNs.idFromName("transaction-probe");
  const stub = doNs.get(id);

  try {
    const res = await stub.fetch(
      new Request("https://probe-do/transaction-probe", { method: "POST" }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    observations.push({ label: "do_response", value: body });
  } catch (err) {
    errors.push({
      code: "DoFetchFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  return makeResult("V1-storage-DO-transactional", start, {
    success: errors.length === 0,
    observations,
    errors,
    timings: { samplesN: 1 },
  });
}
