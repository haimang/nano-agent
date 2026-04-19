/**
 * ProbeDO — Durable Object for spike-do-storage.
 *
 * Routes consumed by probes (intra-worker only):
 *   POST /transaction-probe                — V1-storage-DO-transactional
 *   POST /mem-vs-do-probe                  — V1-storage-Memory-vs-DO
 *   POST /cap-mkdir-partial                — V2A-bash-capability-parity (mkdir)
 *   POST /cap-reserved-namespace           — V2A-bash-capability-parity (/_platform/**)
 *   POST /cap-rg-cap                       — V2A-bash-capability-parity (rg cap)
 *   POST /stress-memory                    — V2B-bash-platform-stress (memory)
 *   POST /stress-cpu-scan                  — V2B-bash-platform-stress (cpu/scan)
 *   GET  /healthz                          — liveness
 *
 * SQLite-backed (declared as `new_sqlite_classes` in wrangler.jsonc),
 * required for transactional get/put behavior.
 */

const RESERVED_PREFIX = "/_platform/";
const MKDIR_PARTIAL_NOTE = "mkdir-partial-no-directory-entity";

interface MemVsDoStep {
  op: "set" | "get" | "delete";
  key: string;
  value?: string;
}

export class ProbeDO {
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/healthz" && request.method === "GET") {
      return Response.json({ ok: true, do: "ProbeDO" });
    }

    if (request.method !== "POST") {
      return new Response("ProbeDO only accepts POST for probe routes", { status: 405 });
    }

    try {
      switch (path) {
        case "/transaction-probe":
          return Response.json(await this.handleTransactionProbe());
        case "/mem-vs-do-probe":
          return Response.json(await this.handleMemVsDoProbe(request));
        case "/cap-mkdir-partial":
          return Response.json(await this.handleCapMkdirPartial(request));
        case "/cap-reserved-namespace":
          return Response.json(await this.handleCapReservedNamespace(request));
        case "/cap-rg-cap":
          return Response.json(await this.handleCapRgCap(request));
        case "/stress-memory":
          return Response.json(await this.handleStressMemory(request));
        case "/stress-cpu-scan":
          return Response.json(await this.handleStressCpuScan(request));
        default:
          return new Response(`Unknown ProbeDO route: ${path}`, { status: 404 });
      }
    } catch (err) {
      return Response.json(
        { ok: false, error: String((err as Error)?.message ?? err) },
        { status: 500 },
      );
    }
  }

  // ── V1-storage-DO-transactional ─────────────────────────────────────

  private async handleTransactionProbe(): Promise<Record<string, unknown>> {
    const storage = this.state.storage;

    // Scenario 1: happy commit.
    let s1: { committed: boolean; error?: string } = { committed: false };
    try {
      await storage.transaction(async (tx) => {
        await tx.put("tx-1-a", "value-1a");
        await tx.put("tx-1-b", "value-1b");
      });
      const a = await storage.get<string>("tx-1-a");
      const b = await storage.get<string>("tx-1-b");
      s1 = { committed: a === "value-1a" && b === "value-1b" };
    } catch (e) {
      s1 = { committed: false, error: String((e as Error)?.message ?? e) };
    }

    // Scenario 2: throw inside tx → expect rollback.
    let s2: { rolledBack: boolean; error?: string; survivors?: string[] } = {
      rolledBack: false,
    };
    try {
      try {
        await storage.transaction(async (tx) => {
          await tx.put("tx-2-a", "should-rollback");
          throw new Error("intentional-rollback");
        });
      } catch {
        // expected
      }
      const survivor = await storage.get<string>("tx-2-a");
      s2 = {
        rolledBack: survivor === undefined,
        survivors: survivor !== undefined ? [survivor] : [],
      };
    } catch (e) {
      s2 = { rolledBack: false, error: String((e as Error)?.message ?? e) };
    }

    // Scenario 3: tx + KV-style direct put outside tx (read-after-tx).
    let s3: { kvOutsideTxObserved: boolean } = { kvOutsideTxObserved: false };
    try {
      await storage.put("kv-3", "v-pre");
      await storage.transaction(async (tx) => {
        await tx.put("tx-3-a", "in-tx");
      });
      const got = await storage.get<string>("kv-3");
      s3 = { kvOutsideTxObserved: got === "v-pre" };
    } catch (e) {
      s3 = { kvOutsideTxObserved: false };
    }

    // Cleanup keys to keep DO state small.
    await storage.delete([
      "tx-1-a",
      "tx-1-b",
      "tx-2-a",
      "tx-3-a",
      "kv-3",
    ]);

    return { scenarios: { s1, s2, s3 } };
  }

  // ── V1-storage-Memory-vs-DO ─────────────────────────────────────────

  private async handleMemVsDoProbe(req: Request): Promise<{ state: string; reads: (string | null)[] }> {
    const seq = (await req.json()) as MemVsDoStep[];
    const storage = this.state.storage;
    const reads: (string | null)[] = [];

    // Use a fresh prefix so re-runs are independent.
    const prefix = `mem-vs-do/run-${Date.now()}/`;
    const k = (key: string) => `${prefix}${key}`;

    for (const step of seq) {
      if (step.op === "set" && step.value !== undefined) {
        await storage.put(k(step.key), step.value);
      } else if (step.op === "get") {
        const got = await storage.get<string>(k(step.key));
        reads.push(got ?? null);
      } else if (step.op === "delete") {
        await storage.delete(k(step.key));
      }
    }

    // Build state hash from the prefix scan.
    const all = await storage.list<string>({ prefix });
    const entries: [string, string][] = [];
    for (const [key, value] of all) {
      entries.push([key.slice(prefix.length), value]);
    }
    entries.sort();
    const state = entries.map(([key, value]) => `${key}=${value}`).join(";");

    // Cleanup.
    const keysToDelete: string[] = [];
    for (const [key] of all) keysToDelete.push(key);
    if (keysToDelete.length > 0) await storage.delete(keysToDelete);

    return { state, reads };
  }

  // ── V2A-bash-capability-parity (mkdir partial) ──────────────────────

  private async handleCapMkdirPartial(
    req: Request,
  ): Promise<{ note: string; listAfter: string[] }> {
    const { path } = (await req.json()) as { path: string };
    const storage = this.state.storage;

    // Emulate the capability-runtime mkdir semantics:
    //   - Reserved namespace check (not relevant here for the happy case)
    //   - "ack-create prefix only" — backend has no directory entity,
    //     so we just record the intent and return the partial note.
    // The probe asserts:
    //   - returned note matches MKDIR_PARTIAL_NOTE
    //   - subsequent listDir of that prefix is empty (no synthetic entry)
    if (path.startsWith(RESERVED_PREFIX)) {
      return { note: "rejected", listAfter: [] };
    }

    // Intentionally do NOT write any synthetic marker key.
    // (The capability-runtime `mkdir` handler does not write a marker
    // either — that's the contract under test.)

    const prefix = path.endsWith("/") ? path : `${path}/`;
    const list = await storage.list<string>({ prefix });
    const listAfter: string[] = [];
    for (const [key] of list) listAfter.push(key);

    return { note: MKDIR_PARTIAL_NOTE, listAfter };
  }

  // ── V2A-bash-capability-parity (reserved namespace) ─────────────────

  private async handleCapReservedNamespace(
    req: Request,
  ): Promise<{ rejected: boolean; errorKind?: string }> {
    const { path } = (await req.json()) as { path: string };
    if (path.startsWith(RESERVED_PREFIX)) {
      return { rejected: true, errorKind: "reserved-namespace" };
    }
    return { rejected: false };
  }

  // ── V2A-bash-capability-parity (rg cap) ─────────────────────────────

  private async handleCapRgCap(req: Request): Promise<{
    truncated: boolean;
    returnedLines: number;
    returnedBytes: number;
  }> {
    const { content, lineCap, byteCap, pattern } = (await req.json()) as {
      content: string;
      lineCap: number;
      byteCap: number;
      pattern: string;
    };

    // Emulate the capability-runtime `rg` inline cap:
    //   - Match lines containing pattern
    //   - Stop when either lineCap or byteCap reached
    const matchedLines: string[] = [];
    let bytesAccum = 0;
    let truncated = false;
    for (const line of content.split("\n")) {
      if (!line.includes(pattern)) continue;
      const lineBytes = new TextEncoder().encode(line + "\n").byteLength;
      if (matchedLines.length >= lineCap || bytesAccum + lineBytes > byteCap) {
        truncated = true;
        break;
      }
      matchedLines.push(line);
      bytesAccum += lineBytes;
    }

    return {
      truncated,
      returnedLines: matchedLines.length,
      returnedBytes: bytesAccum,
    };
  }

  // ── V2B-bash-platform-stress (memory) ───────────────────────────────

  private async handleStressMemory(
    req: Request,
  ): Promise<{ wrote: boolean; readBack: boolean; sizeBytes: number }> {
    const { sizeBytes } = (await req.json()) as { sizeBytes: number };
    const storage = this.state.storage;

    // Generate a deterministic blob and round-trip it through DO storage.
    const buf = new Uint8Array(sizeBytes);
    for (let i = 0; i < sizeBytes; i++) buf[i] = i & 0xff;

    const key = `stress-mem/${sizeBytes}-${Date.now()}`;
    await storage.put(key, buf);
    const got = await storage.get<Uint8Array>(key);
    const readBack = got != null && (got as Uint8Array).byteLength === sizeBytes;
    await storage.delete(key);

    return { wrote: true, readBack, sizeBytes };
  }

  // ── V2B-bash-platform-stress (cpu/scan) ─────────────────────────────

  private async handleStressCpuScan(
    req: Request,
  ): Promise<{ keyCount: number; matchCount: number; scanWallMs: number }> {
    const { keyCount } = (await req.json()) as { keyCount: number };
    const storage = this.state.storage;

    const prefix = `stress-cpu/run-${Date.now()}/`;
    // Seed.
    for (let i = 0; i < keyCount; i++) {
      const v = `payload-${i}-${i % 7 === 0 ? "needle" : "haystack"}-tail`;
      await storage.put(`${prefix}${String(i).padStart(5, "0")}`, v);
    }

    // Scan.
    const t0 = Date.now();
    const list = await storage.list<string>({ prefix });
    let matchCount = 0;
    for (const [, value] of list) {
      if (value.includes("needle")) matchCount++;
    }
    const scanWallMs = Date.now() - t0;

    // Cleanup.
    const keysToDelete: string[] = [];
    for (const [key] of list) keysToDelete.push(key);
    if (keysToDelete.length > 0) await storage.delete(keysToDelete);

    return { keyCount, matchCount, scanWallMs };
  }
}
