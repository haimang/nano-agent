/**
 * Trace Substrate Benchmark Runner (A2 Phase 2).
 *
 * Goal: produce package-local / seam-level evidence for the current trace
 * substrate shape (DO storage hot anchor). NOT a deploy-shaped or
 * `wrangler dev --remote` benchmark — that scope belongs to A6.
 *
 * Modes:
 *   - local-bench     — steady + burst append scenarios against the real
 *                       `DoStorageTraceSink` wired to an in-isolate fake
 *                       DurableObjectStorage, plus read-back diff.
 *   - readback-probe  — write-then-rehydrate probe that proves a fresh sink
 *                       instance over the same storage can reconstruct the
 *                       full timeline via the `_index` key (hibernation-safe).
 *
 * Output:
 *   - Structured JSON on stdout (or `--out <path>` to a file)
 *   - Optional Markdown summary (`--markdown <path>`)
 *
 * Intentionally depends only on the already-shipped
 * `@nano-agent/eval-observability` seams (DoStorageTraceSink + trace-event)
 * and Node built-ins. No wrangler, no D1, no real Cloudflare bindings.
 */

import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  DoStorageTraceSink,
  type DoStorageLike,
} from "../src/sinks/do-storage.js";
import type { TraceEvent } from "../src/trace-event.js";

// ─────────────────────────────────────────────────────────────────────
// Benchmark contract / thresholds (see AX-QNA Q5 + A2 §1.5 pass criteria)
// ─────────────────────────────────────────────────────────────────────

export const BENCH_THRESHOLDS = Object.freeze({
  /** Readback completeness — must be 100% for restart/hibernation safety. */
  readbackSuccessPct: 100,
  /** Maximum write-amplification (bytes persisted / raw JSONL bytes). */
  writeAmplificationMax: 2,
  /**
   * Tail / median ratio beyond which a single run must be annotated.
   * `p99/p50 > 5` without explanation downgrades the verdict to `yellow`.
   */
  tailRatioWarn: 5,
  /**
   * A2-A3 review R2: Q5 absolute per-event emit-path latency budgets.
   * These are *package-local isolate* thresholds, NOT real DO p50/p99 —
   * remote Q5 closure is reserved for A6 deployment dry-run.
   *   - `emitP50MsMax = 20ms`  per AX-QNA Q5
   *   - `emitP99MsMax = 100ms` per AX-QNA Q5
   * Violating either downgrades the verdict to `red`.
   */
  emitP50MsMax: 20,
  emitP99MsMax: 100,
});

// ─────────────────────────────────────────────────────────────────────
// CLI parsing (tiny, no external deps)
// ─────────────────────────────────────────────────────────────────────

interface CliOptions {
  mode: "local-bench" | "readback-probe" | "all";
  steadyCount: number;
  burstCount: number;
  burstSize: number;
  readbackSessions: number;
  readbackEventsPerSession: number;
  bufferSize: number;
  outJson?: string;
  outMarkdown?: string;
  seed: number;
  help: boolean;
}

const DEFAULTS: CliOptions = {
  mode: "all",
  steadyCount: 500,
  burstCount: 5,
  burstSize: 50,
  readbackSessions: 4,
  readbackEventsPerSession: 64,
  bufferSize: 16,
  seed: 0xC0FFEE,
  help: false,
};

function parseCli(argv: readonly string[]): CliOptions {
  const opts: CliOptions = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`flag ${arg} requires a value`);
      return v;
    };
    switch (arg) {
      case "--help":
      case "-h":
        opts.help = true;
        break;
      case "--mode":
        opts.mode = next() as CliOptions["mode"];
        break;
      case "--steady":
        opts.steadyCount = Number(next());
        break;
      case "--burst-count":
        opts.burstCount = Number(next());
        break;
      case "--burst-size":
        opts.burstSize = Number(next());
        break;
      case "--readback-sessions":
        opts.readbackSessions = Number(next());
        break;
      case "--readback-events":
        opts.readbackEventsPerSession = Number(next());
        break;
      case "--buffer":
        opts.bufferSize = Number(next());
        break;
      case "--out":
        opts.outJson = next();
        break;
      case "--markdown":
        opts.outMarkdown = next();
        break;
      case "--seed":
        opts.seed = Number(next());
        break;
      default:
        throw new Error(`unknown flag: ${arg}`);
    }
  }
  return opts;
}

const HELP_TEXT = `
trace-substrate-benchmark — package-local DO storage benchmark (A2 Phase 2)

Usage:
  tsx scripts/trace-substrate-benchmark.ts [flags]

Modes (--mode <mode>):
  local-bench      Steady + burst append against real DoStorageTraceSink
  readback-probe   Write-then-rehydrate with a fresh sink instance
  all              Run both (default)

Flags:
  --steady <n>              Steady-append event count   [500]
  --burst-count <n>         Number of burst waves       [5]
  --burst-size <n>          Events per burst wave       [50]
  --readback-sessions <n>   Parallel sessions probed    [4]
  --readback-events <n>     Events per session          [64]
  --buffer <n>              Sink maxBufferSize          [16]
  --out <path>              Write JSON result to <path>
  --markdown <path>         Write Markdown summary to <path>
  --seed <n>                Deterministic fixture seed  [0xC0FFEE]

Thresholds (A2 §1.5):
  readbackSuccessPct = 100
  writeAmplificationMax = 2
  tailRatioWarn = 5

Scope:
  * package-local / in-isolate fake storage only
  * NOT wrangler dev / deploy-shaped; that belongs to A6
`;

// ─────────────────────────────────────────────────────────────────────
// Deterministic fake storage (same semantics as FakeDoStorage in tests)
// ─────────────────────────────────────────────────────────────────────

/**
 * Fake `DoStorageLike` that records byte-level write volume so we can
 * compute write amplification. Matches the semantics of the sink's test
 * double, but also exposes `bytesWritten` + `opsWritten` for the runner.
 */
class RecordingFakeStorage implements DoStorageLike {
  private readonly store = new Map<string, string>();
  private _bytesWritten = 0;
  private _opsWritten = 0;

  async get(key: string): Promise<string | undefined> {
    return this.store.get(key);
  }

  async put(key: string, value: string): Promise<void> {
    this._bytesWritten += byteLength(value);
    this._opsWritten += 1;
    this.store.set(key, value);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.store.keys()]
      .filter((k) => k.startsWith(prefix))
      .sort();
  }

  /**
   * Produce a view of this storage that DOES NOT expose `list()`.
   * The `DoStorageTraceSink.enumerateDataKeys()` routine will then be
   * forced to fall back to the persisted `_index` key — this is the
   * assertion the substrate memo makes ("fresh sink reconstructs the
   * full timeline from the _index key with 100% fidelity"), and it
   * must be probed without the list-fast-path in the way.
   */
  asListless(): {
    get: RecordingFakeStorage["get"];
    put: RecordingFakeStorage["put"];
    // intentionally no `list`
  } {
    const self = this;
    return {
      get: (k: string) => self.get(k),
      put: (k: string, v: string) => self.put(k, v),
    };
  }

  get bytesWritten(): number {
    return this._bytesWritten;
  }

  get opsWritten(): number {
    return this._opsWritten;
  }

  keys(): string[] {
    return [...this.store.keys()].sort();
  }

  rawEntries(): Array<[string, string]> {
    return [...this.store.entries()];
  }
}

// ─────────────────────────────────────────────────────────────────────
// Deterministic event fixtures
// ─────────────────────────────────────────────────────────────────────

/** Mulberry32 PRNG — deterministic, tiny, no deps. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DURABLE_KINDS: readonly string[] = [
  "session.start",
  "turn.begin",
  "tool.call.request",
  "tool.call.result",
  "assistant.message",
  "user.message",
  "hook.outcome",
  "compact.start",
  "compact.end",
  "turn.end",
  "session.end",
];

function makeEvent(
  rand: () => number,
  sessionUuid: string,
  teamUuid: string,
  baseEpochMs: number,
  idx: number,
): TraceEvent {
  const kind = DURABLE_KINDS[Math.floor(rand() * DURABLE_KINDS.length)]!;
  const ts = new Date(baseEpochMs + idx * 37).toISOString();
  // A2-A3 review R3 / Kimi R1: fixture MUST carry trace carriers.
  // Prior to A3, `traceUuid` / `sourceRole` were optional — the
  // benchmark fixture was not upgraded when the trace-law freeze
  // landed. A deterministic synthetic traceUuid per (sessionUuid, idx)
  // keeps the fixture reproducible without relying on `crypto.randomUUID`.
  const traceUuid = `00000000-0000-4000-8000-${(idx & 0xffff).toString(16).padStart(12, "0")}`;
  return {
    eventKind: kind,
    timestamp: ts,
    traceUuid,
    sourceRole: "session",
    sourceKey: "trace-substrate-benchmark@v1",
    sessionUuid,
    teamUuid,
    turnUuid: `turn-${Math.floor(rand() * 4)}`,
    stepIndex: idx,
    audience: "internal",
    layer: "durable-audit",
  };
}

function rawJsonlBytes(events: readonly TraceEvent[]): number {
  // Mirror the sink's own serialization: JSON.stringify + "\n".join
  let total = 0;
  for (const e of events) total += byteLength(JSON.stringify(e)) + 1;
  return total > 0 ? total - 1 : 0; // last event has no trailing newline
}

function byteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

// ─────────────────────────────────────────────────────────────────────
// Latency stats
// ─────────────────────────────────────────────────────────────────────

interface LatencySummary {
  samples: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  meanMs: number;
  tailRatio: number;
}

function summariseLatencies(samples: readonly number[]): LatencySummary {
  if (samples.length === 0) {
    return {
      samples: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
      meanMs: 0,
      tailRatio: 0,
    };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p = (q: number) => {
    const idx = Math.min(sorted.length - 1, Math.floor((q / 100) * sorted.length));
    return sorted[idx]!;
  };
  const p50 = p(50);
  const p99 = p(99);
  const mean = sorted.reduce((s, x) => s + x, 0) / sorted.length;
  return {
    samples: sorted.length,
    p50Ms: round(p50),
    p95Ms: round(p(95)),
    p99Ms: round(p99),
    maxMs: round(sorted[sorted.length - 1]!),
    meanMs: round(mean),
    tailRatio: round(p50 === 0 ? 0 : p99 / p50),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ─────────────────────────────────────────────────────────────────────
// Scenario: local-bench  (steady append + burst append)
// ─────────────────────────────────────────────────────────────────────

interface LocalBenchResult {
  scenario: "local-bench";
  steady: {
    events: number;
    emitLatency: LatencySummary;
    manualFlushMs: number;
    storageOps: number;
    storageBytes: number;
    rawBytes: number;
    writeAmplification: number;
  };
  burst: {
    waves: number;
    perWaveEvents: number;
    totalEvents: number;
    emitLatency: LatencySummary;
    flushLatency: LatencySummary;
    storageOps: number;
    storageBytes: number;
    rawBytes: number;
    writeAmplification: number;
  };
}

async function runLocalBench(opts: CliOptions): Promise<LocalBenchResult> {
  // ── Steady append ──
  const steadyStorage = new RecordingFakeStorage();
  const steadySink = new DoStorageTraceSink(
    steadyStorage,
    "team-bench",
    "sess-steady",
    { maxBufferSize: opts.bufferSize },
  );
  const rand = mulberry32(opts.seed);
  const baseMs = Date.parse("2026-04-18T10:00:00.000Z");

  const steadyEvents: TraceEvent[] = [];
  const emitLatencies: number[] = [];
  for (let i = 0; i < opts.steadyCount; i++) {
    const ev = makeEvent(rand, "sess-steady", "team-bench", baseMs, i);
    steadyEvents.push(ev);
    const t0 = performance.now();
    await steadySink.emit(ev);
    emitLatencies.push(performance.now() - t0);
  }
  const tFlush = performance.now();
  await steadySink.flush();
  const manualFlushMs = performance.now() - tFlush;

  const steadyRaw = rawJsonlBytes(steadyEvents);

  // ── Burst append ──
  const burstStorage = new RecordingFakeStorage();
  const burstSink = new DoStorageTraceSink(
    burstStorage,
    "team-bench",
    "sess-burst",
    { maxBufferSize: opts.bufferSize },
  );
  const burstRand = mulberry32(opts.seed ^ 0x9e3779b9);
  const burstEmit: number[] = [];
  const burstFlush: number[] = [];
  const burstEvents: TraceEvent[] = [];
  let burstIdx = 0;
  for (let w = 0; w < opts.burstCount; w++) {
    for (let i = 0; i < opts.burstSize; i++) {
      const ev = makeEvent(
        burstRand,
        "sess-burst",
        "team-bench",
        baseMs + w * 60_000,
        burstIdx++,
      );
      burstEvents.push(ev);
      const t0 = performance.now();
      await burstSink.emit(ev);
      burstEmit.push(performance.now() - t0);
    }
    const t0 = performance.now();
    await burstSink.flush();
    burstFlush.push(performance.now() - t0);
  }
  const burstRaw = rawJsonlBytes(burstEvents);

  return {
    scenario: "local-bench",
    steady: {
      events: opts.steadyCount,
      emitLatency: summariseLatencies(emitLatencies),
      manualFlushMs: round(manualFlushMs),
      storageOps: steadyStorage.opsWritten,
      storageBytes: steadyStorage.bytesWritten,
      rawBytes: steadyRaw,
      writeAmplification:
        steadyRaw === 0 ? 0 : round(steadyStorage.bytesWritten / steadyRaw),
    },
    burst: {
      waves: opts.burstCount,
      perWaveEvents: opts.burstSize,
      totalEvents: opts.burstCount * opts.burstSize,
      emitLatency: summariseLatencies(burstEmit),
      flushLatency: summariseLatencies(burstFlush),
      storageOps: burstStorage.opsWritten,
      storageBytes: burstStorage.bytesWritten,
      rawBytes: burstRaw,
      writeAmplification:
        burstRaw === 0 ? 0 : round(burstStorage.bytesWritten / burstRaw),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Scenario: readback-probe (new-instance timeline reconstruction)
// ─────────────────────────────────────────────────────────────────────

interface ReadbackResult {
  scenario: "readback-probe";
  sessions: number;
  eventsPerSession: number;
  totalWritten: number;
  totalRead: number;
  successPct: number;
  perSessionMismatches: number;
  orderViolations: number;
  indexKeysObserved: number;
  /**
   * A2-A3 review R2: result from the listless (no-`list()`) readback
   * pass. This is the probe that actually exercises the `_index`
   * fallback path in `DoStorageTraceSink.enumerateDataKeys()` — the
   * default readback with `list()` present can never prove that claim.
   */
  listlessReadback: {
    totalWritten: number;
    totalRead: number;
    successPct: number;
    perSessionMismatches: number;
  };
}

async function runReadbackProbe(opts: CliOptions): Promise<ReadbackResult> {
  const storage = new RecordingFakeStorage();
  const rand = mulberry32(opts.seed ^ 0xa5a5a5a5);
  const baseMs = Date.parse("2026-04-18T09:00:00.000Z");

  const sessionsWritten = new Map<string, TraceEvent[]>();

  // ── Writer phase: short-lived sinks emit then drop ──
  for (let s = 0; s < opts.readbackSessions; s++) {
    const sessionUuid = `sess-rb-${s}`;
    const team = s % 2 === 0 ? "team-alpha" : "team-beta";
    const sink = new DoStorageTraceSink(storage, team, sessionUuid, {
      maxBufferSize: opts.bufferSize,
    });
    const events: TraceEvent[] = [];
    for (let i = 0; i < opts.readbackEventsPerSession; i++) {
      const ev = makeEvent(rand, sessionUuid, team, baseMs + s * 3600_000, i);
      events.push(ev);
      await sink.emit(ev);
    }
    await sink.flush();
    sessionsWritten.set(sessionKey(team, sessionUuid), events);
  }

  // ── Reader phase: brand-new sink instance, same storage ──
  let totalWritten = 0;
  let totalRead = 0;
  let perSessionMismatches = 0;
  let orderViolations = 0;
  for (const [key, writtenEvents] of sessionsWritten) {
    const { team, sessionUuid } = parseSessionKey(key);
    const freshSink = new DoStorageTraceSink(storage, team, sessionUuid, {
      maxBufferSize: opts.bufferSize,
    });
    const timeline = await freshSink.readTimeline();

    totalWritten += writtenEvents.length;
    totalRead += timeline.length;
    if (timeline.length !== writtenEvents.length) perSessionMismatches += 1;

    // Ordering invariant: readTimeline() must return events in timestamp order.
    for (let i = 1; i < timeline.length; i++) {
      if (
        timeline[i - 1]!.timestamp.localeCompare(timeline[i]!.timestamp) > 0
      ) {
        orderViolations += 1;
      }
    }
  }

  const indexKeysObserved = storage
    .keys()
    .filter((k) => k.endsWith("/_index")).length;

  // ── Listless reader phase (A2-A3 review R2) ──
  // Replay the reader phase against a view that exposes ONLY `get` /
  // `put` — no `list`. This forces `enumerateDataKeys()` to take the
  // `_index` fallback branch, which is the load-bearing claim of the
  // substrate memo. Default-path readback with `list()` present does
  // NOT actually prove `_index` reconstruction works.
  let listlessWritten = 0;
  let listlessRead = 0;
  let listlessMismatches = 0;
  const listless = storage.asListless();
  for (const [key, writtenEvents] of sessionsWritten) {
    const { team, sessionUuid } = parseSessionKey(key);
    // `DoStorageTraceSink` narrows its storage surface by structural typing
    // — supplying the listless view here gives it no `list()` to call.
    const freshSink = new DoStorageTraceSink(
      listless as unknown as RecordingFakeStorage,
      team,
      sessionUuid,
      { maxBufferSize: opts.bufferSize },
    );
    const timeline = await freshSink.readTimeline();
    listlessWritten += writtenEvents.length;
    listlessRead += timeline.length;
    if (timeline.length !== writtenEvents.length) listlessMismatches += 1;
  }

  return {
    scenario: "readback-probe",
    sessions: opts.readbackSessions,
    eventsPerSession: opts.readbackEventsPerSession,
    totalWritten,
    totalRead,
    successPct:
      totalWritten === 0 ? 0 : round((totalRead / totalWritten) * 100),
    perSessionMismatches,
    orderViolations,
    indexKeysObserved,
    listlessReadback: {
      totalWritten: listlessWritten,
      totalRead: listlessRead,
      successPct:
        listlessWritten === 0
          ? 0
          : round((listlessRead / listlessWritten) * 100),
      perSessionMismatches: listlessMismatches,
    },
  };
}

function sessionKey(team: string, sessionUuid: string): string {
  return `${team}\u0000${sessionUuid}`;
}

function parseSessionKey(key: string): { team: string; sessionUuid: string } {
  const [team, sessionUuid] = key.split("\u0000");
  return { team: team ?? "", sessionUuid: sessionUuid ?? "" };
}

// ─────────────────────────────────────────────────────────────────────
// Verdict + Markdown
// ─────────────────────────────────────────────────────────────────────

type Verdict = "green" | "yellow" | "red";

interface BenchmarkReport {
  runAt: string;
  runner: "trace-substrate-benchmark";
  runnerVersion: "1.0.0";
  scope: "package-local-isolate";
  opts: CliOptions;
  thresholds: typeof BENCH_THRESHOLDS;
  localBench?: LocalBenchResult;
  readback?: ReadbackResult;
  verdict: Verdict;
  notes: string[];
}

function computeVerdict(
  report: Pick<BenchmarkReport, "localBench" | "readback">,
): { verdict: Verdict; notes: string[] } {
  const notes: string[] = [];
  let worst: Verdict = "green";

  if (report.localBench) {
    for (const scope of ["steady", "burst"] as const) {
      const r = report.localBench[scope];
      if (r.writeAmplification > BENCH_THRESHOLDS.writeAmplificationMax) {
        worst = "red";
        notes.push(
          `${scope}: write amplification ${r.writeAmplification}× exceeds ${BENCH_THRESHOLDS.writeAmplificationMax}× threshold`,
        );
      }
      if (
        r.emitLatency.tailRatio > BENCH_THRESHOLDS.tailRatioWarn &&
        r.emitLatency.p50Ms > 0
      ) {
        if (worst === "green") worst = "yellow";
        notes.push(
          `${scope}: emit p99/p50 = ${r.emitLatency.tailRatio}× — above ${BENCH_THRESHOLDS.tailRatioWarn}× warn threshold; artifact must explain or only claim "yellow"`,
        );
      }
      // A2-A3 review R2: enforce Q5 absolute budgets (package-local only).
      if (r.emitLatency.p50Ms > BENCH_THRESHOLDS.emitP50MsMax) {
        worst = "red";
        notes.push(
          `${scope}: emit p50 = ${r.emitLatency.p50Ms}ms exceeds Q5 budget ${BENCH_THRESHOLDS.emitP50MsMax}ms (package-local — remote Q5 closure still gated on A6)`,
        );
      }
      if (r.emitLatency.p99Ms > BENCH_THRESHOLDS.emitP99MsMax) {
        worst = "red";
        notes.push(
          `${scope}: emit p99 = ${r.emitLatency.p99Ms}ms exceeds Q5 budget ${BENCH_THRESHOLDS.emitP99MsMax}ms (package-local — remote Q5 closure still gated on A6)`,
        );
      }
    }
  }

  if (report.readback) {
    if (report.readback.successPct < BENCH_THRESHOLDS.readbackSuccessPct) {
      worst = "red";
      notes.push(
        `readback success ${report.readback.successPct}% below ${BENCH_THRESHOLDS.readbackSuccessPct}% threshold`,
      );
    }
    if (report.readback.perSessionMismatches > 0) {
      worst = "red";
      notes.push(
        `${report.readback.perSessionMismatches} session(s) returned a different event count after readback`,
      );
    }
    if (report.readback.orderViolations > 0) {
      worst = "red";
      notes.push(
        `${report.readback.orderViolations} ordering violations detected in readback timelines`,
      );
    }
    if (report.readback.indexKeysObserved !== report.readback.sessions) {
      if (worst === "green") worst = "yellow";
      notes.push(
        `expected ${report.readback.sessions} _index keys, observed ${report.readback.indexKeysObserved}`,
      );
    }
    // A2-A3 review R2: `_index` fallback must be proven without
    // list() in the way — otherwise the substrate memo's claim is
    // vacuous.
    const lr = report.readback.listlessReadback;
    if (lr.successPct < BENCH_THRESHOLDS.readbackSuccessPct) {
      worst = "red";
      notes.push(
        `listless (_index-only) readback success ${lr.successPct}% below ${BENCH_THRESHOLDS.readbackSuccessPct}% threshold — the substrate memo's "fresh sink reconstructs from _index" claim does not hold`,
      );
    }
    if (lr.perSessionMismatches > 0) {
      worst = "red";
      notes.push(
        `${lr.perSessionMismatches} session(s) differ between write and listless readback`,
      );
    }
  }

  return { verdict: worst, notes };
}

function renderMarkdown(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push(`# Trace Substrate Benchmark — ${report.runAt}`);
  lines.push("");
  lines.push(
    `> Runner: \`trace-substrate-benchmark\` v${report.runnerVersion} · scope: \`${report.scope}\` · verdict: **${report.verdict.toUpperCase()}**`,
  );
  lines.push("");
  lines.push("## Thresholds");
  lines.push("");
  lines.push("| metric | threshold |");
  lines.push("|---|---|");
  lines.push(`| readbackSuccessPct | ${report.thresholds.readbackSuccessPct}% |`);
  lines.push(`| writeAmplificationMax | ${report.thresholds.writeAmplificationMax}× |`);
  lines.push(`| tailRatioWarn (p99/p50) | ${report.thresholds.tailRatioWarn}× |`);
  lines.push("");

  if (report.localBench) {
    const lb = report.localBench;
    lines.push("## Local-bench — steady append");
    lines.push("");
    lines.push("| field | value |");
    lines.push("|---|---|");
    lines.push(`| events | ${lb.steady.events} |`);
    lines.push(`| emit p50 / p95 / p99 / max (ms) | ${lb.steady.emitLatency.p50Ms} / ${lb.steady.emitLatency.p95Ms} / ${lb.steady.emitLatency.p99Ms} / ${lb.steady.emitLatency.maxMs} |`);
    lines.push(`| manual flush (ms) | ${lb.steady.manualFlushMs} |`);
    lines.push(`| storage put ops | ${lb.steady.storageOps} |`);
    lines.push(`| storage bytes / raw bytes | ${lb.steady.storageBytes} / ${lb.steady.rawBytes} |`);
    lines.push(`| write amplification | ${lb.steady.writeAmplification}× |`);
    lines.push(`| tail ratio (p99/p50) | ${lb.steady.emitLatency.tailRatio}× |`);
    lines.push("");
    lines.push("## Local-bench — burst append");
    lines.push("");
    lines.push("| field | value |");
    lines.push("|---|---|");
    lines.push(`| waves × size | ${lb.burst.waves} × ${lb.burst.perWaveEvents} = ${lb.burst.totalEvents} |`);
    lines.push(`| emit p50 / p95 / p99 / max (ms) | ${lb.burst.emitLatency.p50Ms} / ${lb.burst.emitLatency.p95Ms} / ${lb.burst.emitLatency.p99Ms} / ${lb.burst.emitLatency.maxMs} |`);
    lines.push(`| flush p50 / p99 / max (ms) | ${lb.burst.flushLatency.p50Ms} / ${lb.burst.flushLatency.p99Ms} / ${lb.burst.flushLatency.maxMs} |`);
    lines.push(`| storage put ops | ${lb.burst.storageOps} |`);
    lines.push(`| storage bytes / raw bytes | ${lb.burst.storageBytes} / ${lb.burst.rawBytes} |`);
    lines.push(`| write amplification | ${lb.burst.writeAmplification}× |`);
    lines.push(`| tail ratio (p99/p50) | ${lb.burst.emitLatency.tailRatio}× |`);
    lines.push("");
  }

  if (report.readback) {
    const rb = report.readback;
    lines.push("## Readback probe — new-instance timeline reconstruction");
    lines.push("");
    lines.push("| field | value |");
    lines.push("|---|---|");
    lines.push(`| sessions × events | ${rb.sessions} × ${rb.eventsPerSession} |`);
    lines.push(`| written / read | ${rb.totalWritten} / ${rb.totalRead} |`);
    lines.push(`| success % | ${rb.successPct}% |`);
    lines.push(`| session mismatches | ${rb.perSessionMismatches} |`);
    lines.push(`| ordering violations | ${rb.orderViolations} |`);
    lines.push(`| _index keys observed | ${rb.indexKeysObserved} |`);
    lines.push("");
  }

  if (report.notes.length > 0) {
    lines.push("## Notes");
    lines.push("");
    for (const n of report.notes) lines.push(`- ${n}`);
    lines.push("");
  } else {
    lines.push("## Notes");
    lines.push("");
    lines.push("- no threshold violations observed in this run");
    lines.push("");
  }

  lines.push("## Scope & Limitations");
  lines.push("");
  lines.push("- In-isolate fake `DoStorageLike` — latency numbers represent code-path cost, not real DO put latency.");
  lines.push("- Real Cloudflare DO put p50/p99 budget (≤ 20 ms / ≤ 100 ms, AX-QNA Q5) must be re-verified in A6 (wrangler dev --remote / deploy smoke).");
  lines.push("- R2 / D1 / KV are not exercised by this harness; they are covered by the comparative note in the decision memo.");
  return lines.join("\n") + "\n";
}

// ─────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────

export interface RunOptions extends Partial<CliOptions> {}

export async function runBenchmark(
  options: RunOptions = {},
): Promise<BenchmarkReport> {
  const opts: CliOptions = { ...DEFAULTS, ...options };
  const report: BenchmarkReport = {
    runAt: new Date().toISOString(),
    runner: "trace-substrate-benchmark",
    runnerVersion: "1.0.0",
    scope: "package-local-isolate",
    opts,
    thresholds: BENCH_THRESHOLDS,
    verdict: "green",
    notes: [],
  };

  if (opts.mode === "local-bench" || opts.mode === "all") {
    report.localBench = await runLocalBench(opts);
  }
  if (opts.mode === "readback-probe" || opts.mode === "all") {
    report.readback = await runReadbackProbe(opts);
  }

  const v = computeVerdict(report);
  report.verdict = v.verdict;
  report.notes = v.notes;
  return report;
}

async function cliMain(argv: readonly string[]): Promise<void> {
  const opts = parseCli(argv);
  if (opts.help) {
    process.stdout.write(HELP_TEXT);
    return;
  }

  const report = await runBenchmark(opts);
  const json = JSON.stringify(report, null, 2);
  if (opts.outJson) {
    writeFileSync(opts.outJson, json);
  } else {
    process.stdout.write(json + "\n");
  }
  if (opts.outMarkdown) {
    writeFileSync(opts.outMarkdown, renderMarkdown(report));
  }
  if (report.verdict === "red") {
    process.exitCode = 2;
  }
}

// Only run when executed directly (tsx / node), not on import.
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /trace-substrate-benchmark(\.[jt]s)?$/.test(process.argv[1]);

if (invokedDirectly) {
  cliMain(process.argv.slice(2)).catch((err) => {
    console.error("benchmark failed:", err);
    process.exit(1);
  });
}

// Exported for unit tests + consumers wanting programmatic access.
export {
  renderMarkdown,
  computeVerdict,
  summariseLatencies,
  RecordingFakeStorage,
  type BenchmarkReport,
  type LocalBenchResult,
  type ReadbackResult,
};
