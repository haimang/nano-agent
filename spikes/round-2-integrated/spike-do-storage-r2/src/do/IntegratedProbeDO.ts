/**
 * IntegratedProbeDO — Durable Object backing spike-do-storage-r2.
 *
 * Routes consumed by probes (intra-worker only):
 *   POST /cap-binary-search                — F08 follow-up
 *   POST /cap-binary-search-reset          — F08 follow-up (wipe state between runs)
 *   POST /native-do-roundtrip              — re-validation storage (DO roundtrip)
 *   GET  /healthz                          — liveness
 *
 * Distinction from round-1 `ProbeDO`:
 *   - Separate DO class name (isolation)
 *   - `cap-binary-search` implements a bisection step over the 1-10 MiB
 *     range, caching the last low/high in durable storage so the caller
 *     can drive the search incrementally across HTTP requests.
 *   - SQLITE_TOOBIG is caught and reported as a "capped" observation
 *     rather than a 500 — the finding is about the threshold, not
 *     crashing the DO.
 */

interface BinarySearchState {
  readonly lowBytes: number;
  readonly highBytes: number;
  readonly attempts: ReadonlyArray<{
    readonly sizeBytes: number;
    readonly ok: boolean;
    readonly errorCode?: string;
    readonly elapsedMs: number;
    /** B7 §5.4: requested samples per candidate size. */
    readonly samples?: number;
    /** How many samples succeeded before fail-fast (undefined on old state). */
    readonly successfulSamples?: number;
  }>;
}

const BINARY_SEARCH_KEY = "follow-up:f08:binary-search-state";

const INITIAL_LOW = 1 * 1024 * 1024; // 1 MiB known-good
const INITIAL_HIGH = 10 * 1024 * 1024; // 10 MiB known-TOOBIG

export class IntegratedProbeDO {
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/healthz" && request.method === "GET") {
      return Response.json({ ok: true, do: "IntegratedProbeDO" });
    }

    if (request.method !== "POST") {
      return new Response("IntegratedProbeDO only accepts POST for probe routes", {
        status: 405,
      });
    }

    try {
      switch (path) {
        case "/cap-binary-search":
          return Response.json(await this.handleCapBinarySearch(request));
        case "/cap-binary-search-reset":
          return Response.json(await this.handleCapBinarySearchReset());
        case "/native-do-roundtrip":
          return Response.json(await this.handleNativeDoRoundtrip(request));
        case "/parity-apply":
          return Response.json(await this.handleParityApply(request));
        case "/parity-reset":
          return Response.json(await this.handleParityReset());
        default:
          return new Response(`Unknown route: ${path}`, { status: 404 });
      }
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  }

  // ── F08 binary-search handler ─────────────────────────────────────

  private async handleCapBinarySearch(request: Request): Promise<unknown> {
    const params = (await request.json().catch(() => ({}))) as {
      step?: number;
      maxAttempts?: number;
      samplesPerStep?: number;
    };
    const maxAttempts = typeof params.maxAttempts === "number" ? params.maxAttempts : 1;
    // B7 §5.4 rubric: each candidate size gets `samplesPerStep` independent
    // put/delete round-trips. A size is judged OK only if all samples
    // succeed; a size is judged TOOBIG if ANY sample fails with
    // SQLITE_TOOBIG (fail-fast), because platform caps are deterministic,
    // not stochastic — any single TOOBIG is authoritative.
    const samplesPerStep = Math.max(
      1,
      typeof params.samplesPerStep === "number" ? params.samplesPerStep : 3,
    );

    const existing =
      (await this.state.storage.get<BinarySearchState>(BINARY_SEARCH_KEY)) ?? {
        lowBytes: INITIAL_LOW,
        highBytes: INITIAL_HIGH,
        attempts: [],
      };

    let lowBytes = existing.lowBytes;
    let highBytes = existing.highBytes;
    const attempts: BinarySearchState["attempts"] = [...existing.attempts];

    for (let i = 0; i < maxAttempts; i++) {
      const sizeBytes = Math.floor((lowBytes + highBytes) / 2);
      if (sizeBytes === lowBytes || sizeBytes === highBytes) break;

      const payload = new Uint8Array(sizeBytes);
      let ok = true;
      let errorCode: string | undefined;
      const sampleStarted = Date.now();
      const sampleLatencies: number[] = [];

      for (let s = 0; s < samplesPerStep; s++) {
        const probeKey = `probe-bytes-${sizeBytes}-${s}-${Date.now()}`;
        const t0 = Date.now();
        try {
          await this.state.storage.put(probeKey, payload);
          await this.state.storage.delete(probeKey);
          sampleLatencies.push(Date.now() - t0);
        } catch (err) {
          ok = false;
          errorCode =
            err instanceof Error
              ? err.message.includes("SQLITE_TOOBIG")
                ? "SQLITE_TOOBIG"
                : err.message
              : String(err);
          // fail-fast: any sample TOOBIG means the size is TOOBIG.
          break;
        }
      }

      const elapsedMs = Date.now() - sampleStarted;
      attempts.push({
        sizeBytes,
        ok,
        errorCode,
        elapsedMs,
        samples: samplesPerStep,
        successfulSamples: sampleLatencies.length,
      } as BinarySearchState["attempts"][number]);

      if (ok) lowBytes = sizeBytes;
      else highBytes = sizeBytes;
    }

    const next: BinarySearchState = { lowBytes, highBytes, attempts };
    await this.state.storage.put(BINARY_SEARCH_KEY, next);

    const widthBytes = highBytes - lowBytes;
    return {
      ok: true,
      lowBytes,
      highBytes,
      widthBytes,
      converged: widthBytes <= 1024,
      attemptCount: attempts.length,
      samplesPerStep,
      attempts,
    };
  }

  private async handleCapBinarySearchReset(): Promise<unknown> {
    await this.state.storage.delete(BINARY_SEARCH_KEY);
    return { ok: true, reset: true };
  }

  // ── F05 mem-vs-DO parity ─────────────────────────────────────────
  //
  // B7-R2 fix (2026-04-20): Round 1 asserted mem vs DO behaves the same
  // on set/get/delete. The Round-2 implementation of this re-validation
  // was too weak — it only called `/native-do-roundtrip` per get step,
  // which is a fresh write/read/delete that cannot witness state that
  // SHOULD have survived from previous steps.
  //
  // This route applies ONE op (set / get / delete) against a single
  // persistent namespace inside the DO, and returns the value the DO
  // observes for the given key post-op. The caller runs a 5-step trace
  // against BOTH an in-memory Map and this endpoint, and compares the
  // observed DO value to the expected memory value at each step.

  private readonly parityKeyPrefix = "parity:";

  private async handleParityApply(request: Request): Promise<unknown> {
    const body = (await request.json().catch(() => ({}))) as {
      op?: "set" | "get" | "delete";
      key?: string;
      value?: string;
    };
    const op = body.op;
    const key = body.key;
    if (!key || !op) {
      return { ok: false, error: "op and key required" };
    }
    const storageKey = this.parityKeyPrefix + key;
    if (op === "set") {
      if (typeof body.value !== "string") {
        return { ok: false, error: "set requires value" };
      }
      await this.state.storage.put(storageKey, body.value);
    } else if (op === "delete") {
      await this.state.storage.delete(storageKey);
    }
    // After every op (including get) return the DO's observed state
    // of this key so the caller can compare to its in-memory mirror.
    const observed = await this.state.storage.get<string>(storageKey);
    return {
      ok: true,
      op,
      key,
      observedValue: observed ?? null,
    };
  }

  private async handleParityReset(): Promise<unknown> {
    // Delete only parity: keys; leave binary-search state untouched.
    const toDelete: string[] = [];
    const entries = await this.state.storage.list({
      prefix: this.parityKeyPrefix,
    });
    for (const [k] of entries) toDelete.push(k);
    for (const k of toDelete) await this.state.storage.delete(k);
    return { ok: true, cleared: toDelete.length };
  }

  // ── DO round-trip (used by re-validation/storage.ts) ──────────────

  private async handleNativeDoRoundtrip(request: Request): Promise<unknown> {
    const params = (await request.json().catch(() => ({}))) as {
      key?: string;
      value?: string;
    };
    const key = typeof params.key === "string" ? params.key : "roundtrip-default";
    const value = typeof params.value === "string" ? params.value : "ok";
    const started = Date.now();
    await this.state.storage.put(key, value);
    const read = await this.state.storage.get<string>(key);
    await this.state.storage.delete(key);
    return {
      ok: true,
      roundtrip: read === value,
      elapsedMs: Date.now() - started,
    };
  }
}
