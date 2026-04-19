/**
 * V1-storage-Memory-vs-DO probe.
 *
 * Validation goal (per P0-spike-do-storage-design §4.5):
 *   - Identify behaviors of `MemoryBackend` (in-spike mock) that
 *     differ from real DO storage in this Cloudflare runtime.
 *
 * Strategy: run identical sequence of ops against in-memory mock and
 * against ProbeDO storage; diff state hashes.
 *
 * For round 1, this probe is intentionally MINIMAL — it confirms only
 * that the basic key-set/get path agrees on round-tripping; richer diffs
 * are added when V1-storage-DO-transactional finding raises specific
 * concerns.
 */

import { makeResult, type ProbeResult } from "../result-shape.js";

const SEQUENCE: Array<{ op: "set" | "get" | "delete"; key: string; value?: string }> = [
  { op: "set", key: "a", value: "1" },
  { op: "set", key: "b", value: "2" },
  { op: "get", key: "a" },
  { op: "set", key: "a", value: "1-overwritten" },
  { op: "get", key: "a" },
  { op: "delete", key: "b" },
  { op: "get", key: "b" },
];

function hashState(map: Map<string, string>): string {
  return [...map.entries()]
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join(";");
}

async function runMemory(): Promise<{ state: string; reads: (string | null)[] }> {
  const m = new Map<string, string>();
  const reads: (string | null)[] = [];
  for (const step of SEQUENCE) {
    if (step.op === "set" && step.value !== undefined) m.set(step.key, step.value);
    else if (step.op === "get") reads.push(m.get(step.key) ?? null);
    else if (step.op === "delete") m.delete(step.key);
  }
  return { state: hashState(m), reads };
}

async function runDo(
  doNs: DurableObjectNamespace,
): Promise<{ state: string; reads: (string | null)[] }> {
  const id = doNs.idFromName("mem-vs-do-probe");
  const stub = doNs.get(id);
  const res = await stub.fetch(
    new Request("https://probe-do/mem-vs-do-probe", {
      method: "POST",
      body: JSON.stringify(SEQUENCE),
      headers: { "content-type": "application/json" },
    }),
  );
  const body = (await res.json()) as { state: string; reads: (string | null)[] };
  return body;
}

export async function probeMemVsDo(
  doNs: DurableObjectNamespace,
  _params: Record<string, unknown>,
): Promise<ProbeResult> {
  const start = Date.now();
  const observations: ProbeResult["observations"] = [];
  const errors: ProbeResult["errors"] = [];

  try {
    const mem = await runMemory();
    const dor = await runDo(doNs);
    const stateMatch = mem.state === dor.state;
    const readsMatch = JSON.stringify(mem.reads) === JSON.stringify(dor.reads);

    observations.push({
      label: "memory_state",
      value: { state: mem.state, reads: mem.reads },
    });
    observations.push({
      label: "do_state",
      value: { state: dor.state, reads: dor.reads },
    });
    observations.push({
      label: "diff",
      value: { stateMatch, readsMatch },
    });
  } catch (err) {
    errors.push({
      code: "DoFetchFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  return makeResult("V1-storage-Memory-vs-DO", start, {
    success: errors.length === 0,
    observations,
    errors,
    timings: { samplesN: 1 },
  });
}
