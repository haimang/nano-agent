/**
 * Regression guard for the A2 benchmark runner.
 *
 * The runner is what the substrate decision memo cites as evidence — it must
 * keep meeting its own pass criteria against the real `DoStorageTraceSink`
 * code path. These tests pin the runner so future edits cannot silently
 * weaken the artifact.
 */

import { describe, it, expect } from "vitest";
import {
  runBenchmark,
  computeVerdict,
  summariseLatencies,
  renderMarkdown,
  RecordingFakeStorage,
  BENCH_THRESHOLDS,
  type BenchmarkReport,
} from "../../scripts/trace-substrate-benchmark.js";
import { DoStorageTraceSink } from "../../src/sinks/do-storage.js";

describe("trace-substrate-benchmark / smoke", () => {
  it("single-flush invocation never reports red and exposes both scenarios", async () => {
    // Buffer ≥ event count → exactly one flush per session → WA ≈ 1×.
    // Tail-ratio (p99/p50) on in-isolate fakes is noisy at small sample
    // counts, so a "yellow" verdict caused only by the tail-ratio warn
    // is acceptable for this smoke; "red" would still indicate a real
    // sink-level regression.
    const report = await runBenchmark({
      steadyCount: 80,
      burstCount: 1,
      burstSize: 16,
      readbackSessions: 2,
      readbackEventsPerSession: 24,
      bufferSize: 256,
    });

    expect(report.verdict).not.toBe("red");
    expect(report.scope).toBe("package-local-isolate");
    expect(report.localBench).toBeDefined();
    expect(report.readback).toBeDefined();
    // Any non-green note must be tail-ratio related on this configuration.
    for (const note of report.notes) {
      expect(note.includes("p99/p50")).toBe(true);
    }
  });

  it("readback probe reaches 100% success and zero ordering violations", async () => {
    const report = await runBenchmark({
      mode: "readback-probe",
      readbackSessions: 4,
      readbackEventsPerSession: 32,
      bufferSize: 8,
    });

    expect(report.readback?.successPct).toBe(100);
    expect(report.readback?.perSessionMismatches).toBe(0);
    expect(report.readback?.orderViolations).toBe(0);
    // _index key per session
    expect(report.readback?.indexKeysObserved).toBe(report.readback?.sessions);
  });

  it("single-flush WA stays under the published threshold", async () => {
    // Buffer ≥ event count → single put per session → WA ≈ 1×.
    const report = await runBenchmark({
      mode: "local-bench",
      steadyCount: 200,
      burstCount: 1,
      burstSize: 200,
      bufferSize: 1024,
    });
    expect(report.localBench?.steady.writeAmplification).toBeLessThanOrEqual(
      BENCH_THRESHOLDS.writeAmplificationMax,
    );
    expect(report.localBench?.burst.writeAmplification).toBeLessThanOrEqual(
      BENCH_THRESHOLDS.writeAmplificationMax,
    );
  });

  it("multi-flush configuration surfaces high write amplification (sink finding)", async () => {
    // Small buffer + many events → many auto-flushes; the sink does
    // read-modify-write of the date-keyed JSONL value, so WA grows ≈ N/2.
    // The runner MUST report this so the substrate decision memo can call
    // it out as a sink-level recommendation (size buffer per turn end).
    const report = await runBenchmark({
      mode: "local-bench",
      steadyCount: 200,
      burstCount: 4,
      burstSize: 32,
      bufferSize: 16,
    });
    expect(report.verdict).toBe("red");
    expect(
      report.notes.some((n) => n.includes("write amplification")),
    ).toBe(true);
    expect(report.localBench?.steady.writeAmplification).toBeGreaterThan(
      BENCH_THRESHOLDS.writeAmplificationMax,
    );
  });
});

describe("trace-substrate-benchmark / verdict logic", () => {
  it("flags red when readback success drops below threshold", () => {
    const v = computeVerdict({
      readback: {
        scenario: "readback-probe",
        sessions: 4,
        eventsPerSession: 10,
        totalWritten: 40,
        totalRead: 30,
        successPct: 75,
        perSessionMismatches: 1,
        orderViolations: 0,
        indexKeysObserved: 4,
        // A2-A3 review R2: the listless (_index-only) readback probe
        // now carries its own success figures that verdict logic
        // inspects separately. Keep it green here so only the primary
        // readback failure is the driver.
        listlessReadback: {
          totalWritten: 40,
          totalRead: 40,
          successPct: 100,
          perSessionMismatches: 0,
        },
      },
    });
    expect(v.verdict).toBe("red");
    expect(v.notes.some((n) => n.includes("75%"))).toBe(true);
  });

  it("flags red when listless (_index-only) readback drops below threshold (A2-A3 review R2)", () => {
    const v = computeVerdict({
      readback: {
        scenario: "readback-probe",
        sessions: 4,
        eventsPerSession: 10,
        totalWritten: 40,
        totalRead: 40,
        successPct: 100,
        perSessionMismatches: 0,
        orderViolations: 0,
        indexKeysObserved: 4,
        listlessReadback: {
          totalWritten: 40,
          totalRead: 10,
          successPct: 25,
          perSessionMismatches: 3,
        },
      },
    });
    expect(v.verdict).toBe("red");
    expect(
      v.notes.some((n) => n.includes("listless (_index-only) readback")),
    ).toBe(true);
  });

  it("flags red when emit p50 exceeds the Q5 20ms budget (A2-A3 review R2)", () => {
    const v = computeVerdict({
      localBench: {
        scenario: "local-bench",
        steady: {
          events: 100,
          emitLatency: summariseLatencies([25, 25, 25, 25]),
          manualFlushMs: 1,
          storageOps: 5,
          storageBytes: 1000,
          rawJsonlBytes: 1000,
          writeAmplification: 1,
        },
        burst: {
          events: 0,
          emitLatency: summariseLatencies([1]),
          manualFlushMs: 1,
          storageOps: 0,
          storageBytes: 0,
          rawJsonlBytes: 0,
          writeAmplification: 0,
        },
      },
    });
    expect(v.verdict).toBe("red");
    expect(v.notes.some((n) => n.includes("Q5 budget 20ms"))).toBe(true);
  });

  it("flags red when write amplification exceeds the cap", () => {
    const v = computeVerdict({
      localBench: {
        scenario: "local-bench",
        steady: {
          events: 100,
          emitLatency: summariseLatencies([0.1, 0.2, 0.3]),
          manualFlushMs: 1,
          storageOps: 5,
          storageBytes: 2000,
          rawBytes: 500,
          writeAmplification: 4,
        },
        burst: {
          waves: 1,
          perWaveEvents: 4,
          totalEvents: 4,
          emitLatency: summariseLatencies([0.1]),
          flushLatency: summariseLatencies([0.5]),
          storageOps: 1,
          storageBytes: 100,
          rawBytes: 100,
          writeAmplification: 1,
        },
      },
    });
    expect(v.verdict).toBe("red");
    expect(v.notes.some((n) => n.includes("write amplification"))).toBe(true);
  });

  it("downgrades to yellow on tail-ratio breach without other failures", () => {
    const samples = [0.05, 0.05, 0.05, 0.05, 5.0]; // p99/p50 = 100×
    const v = computeVerdict({
      localBench: {
        scenario: "local-bench",
        steady: {
          events: 5,
          emitLatency: summariseLatencies(samples),
          manualFlushMs: 0,
          storageOps: 1,
          storageBytes: 10,
          rawBytes: 10,
          writeAmplification: 1,
        },
        burst: {
          waves: 1,
          perWaveEvents: 1,
          totalEvents: 1,
          emitLatency: summariseLatencies([0.1]),
          flushLatency: summariseLatencies([0.5]),
          storageOps: 1,
          storageBytes: 10,
          rawBytes: 10,
          writeAmplification: 1,
        },
      },
    });
    expect(v.verdict).toBe("yellow");
    expect(v.notes.some((n) => n.includes("tail"))).toBe(false);
    expect(v.notes.some((n) => n.includes("p99/p50"))).toBe(true);
  });
});

describe("trace-substrate-benchmark / artifact + telemetry", () => {
  it("renderMarkdown produces a non-empty artifact with the verdict and scope", async () => {
    const report = await runBenchmark({
      steadyCount: 40,
      burstCount: 2,
      burstSize: 8,
      readbackSessions: 1,
      readbackEventsPerSession: 8,
      bufferSize: 4,
    });
    const md = renderMarkdown(report);
    expect(md).toContain("Trace Substrate Benchmark");
    expect(md).toContain(report.verdict.toUpperCase());
    expect(md).toContain("package-local-isolate");
    expect(md).toContain("Readback probe");
    expect(md).toContain("Scope & Limitations");
  });

  it("RecordingFakeStorage stays compatible with DoStorageTraceSink keys", async () => {
    const storage = new RecordingFakeStorage();
    const sink = new DoStorageTraceSink(storage, "team-z", "sess-z", {
      maxBufferSize: 1,
    });
    // A2-A3 review R3 / Kimi R1: fixture upgraded to carry trace-law
    // required carriers (`traceUuid` + `sourceRole`).
    await sink.emit({
      eventKind: "session.start",
      timestamp: "2026-04-18T10:00:00.000Z",
      traceUuid: "00000000-0000-4000-8000-000000000001",
      sourceRole: "session",
      sourceKey: "trace-substrate-benchmark-test@v1",
      sessionUuid: "sess-z",
      teamUuid: "team-z",
      audience: "internal",
      layer: "durable-audit",
    });
    const keys = storage.keys();
    expect(keys).toContain("tenants/team-z/trace/sess-z/2026-04-18.jsonl");
    expect(keys).toContain("tenants/team-z/trace/sess-z/_index");
    expect(storage.opsWritten).toBeGreaterThan(0);
    expect(storage.bytesWritten).toBeGreaterThan(0);
  });

  it("run report carries the immutable thresholds object", async () => {
    const report: BenchmarkReport = await runBenchmark({
      steadyCount: 16,
      burstCount: 1,
      burstSize: 4,
      readbackSessions: 1,
      readbackEventsPerSession: 4,
      bufferSize: 4,
    });
    expect(report.thresholds.readbackSuccessPct).toBe(100);
    expect(report.thresholds.writeAmplificationMax).toBe(2);
    expect(report.thresholds.tailRatioWarn).toBe(5);
  });
});
