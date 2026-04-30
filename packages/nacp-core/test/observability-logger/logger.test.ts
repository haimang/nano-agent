/**
 * P1-01 unit tests — observability/logger sub-module.
 *
 * RHX2 design v0.5 §7.3 requires ≥10 cases covering:
 *   - 4 levels × with/without ALS  (8)
 *   - critical bypasses dedupe     (1)
 *   - dedupe suppresses repeats    (1)
 *   - serialize failure fallback   (1)
 *   - DO/Worker-Shell dual-mode    (1)
 *   - JSON schema check ≥2         (2+)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  createLogger,
  __setLoggerConsoleForTests,
  withTraceContext,
  RingBuffer,
  DedupeCache,
  buildDedupeKey,
} from "../../src/observability/logger/index.js";
import type { LogLevel, LogRecord, LogPersistFn } from "../../src/observability/logger/index.js";

interface CaptureSink {
  debug: string[];
  log: string[];
  warn: string[];
  error: string[];
  push(level: keyof CaptureSink, line: string): void;
}

function makeSink(): CaptureSink {
  const buf = { debug: [] as string[], log: [] as string[], warn: [] as string[], error: [] as string[] };
  return {
    ...buf,
    push(level, line) {
      buf[level].push(line);
    },
  } as unknown as CaptureSink;
}

function attachSink(sink: CaptureSink): void {
  __setLoggerConsoleForTests({
    debug: (...args) => sink.push("debug", String(args.join(" "))),
    log: (...args) => sink.push("log", String(args.join(" "))),
    warn: (...args) => sink.push("warn", String(args.join(" "))),
    error: (...args) => sink.push("error", String(args.join(" "))),
  });
}

describe("createLogger — 4 levels × ALS combinations", () => {
  let sink: CaptureSink;
  beforeEach(() => {
    sink = makeSink();
    attachSink(sink);
  });
  afterEach(() => {
    __setLoggerConsoleForTests(null);
  });

  it("[case 1] debug level emits when env permits and level is below warn", () => {
    const logger = createLogger("test-w", { level: "debug" });
    logger.debug("hello", { k: 1 });
    expect(sink.debug.length).toBe(1);
    const record = JSON.parse(sink.debug[0]) as LogRecord;
    expect(record.level).toBe("debug");
    expect(record.worker).toBe("test-w");
    expect(record.trace_uuid).toBeUndefined();
  });

  it("[case 2] info level + ALS injects trace_uuid", () => {
    const logger = createLogger("test-w", { level: "debug" });
    withTraceContext({ trace_uuid: "11111111-1111-4111-8111-111111111111", session_uuid: "s1", team_uuid: "t1" }, () => {
      logger.info("ok", { task: "x" });
    });
    const record = JSON.parse(sink.log[0]) as LogRecord;
    expect(record.trace_uuid).toBe("11111111-1111-4111-8111-111111111111");
    expect(record.session_uuid).toBe("s1");
    expect(record.team_uuid).toBe("t1");
  });

  it("[case 3] warn level emits with code without ALS", () => {
    const logger = createLogger("test-w");
    logger.warn("budget-low", { code: "rate-limited", ctx: { remaining: 3 } });
    const record = JSON.parse(sink.warn[0]) as LogRecord;
    expect(record.level).toBe("warn");
    expect(record.code).toBe("rate-limited");
    expect(record.ctx).toEqual({ remaining: 3 });
    expect(record.trace_uuid).toBeUndefined();
  });

  it("[case 4] error level + ALS produces a record with both code and trace_uuid", () => {
    const logger = createLogger("test-w");
    withTraceContext({ trace_uuid: "22222222-2222-4222-8222-222222222222" }, () => {
      logger.error("d1-write-failed", { code: "internal-error", ctx: { table: "nano_error_log" } });
    });
    const record = JSON.parse(sink.error[0]) as LogRecord;
    expect(record.level).toBe("error");
    expect(record.code).toBe("internal-error");
    expect(record.trace_uuid).toBe("22222222-2222-4222-8222-222222222222");
  });
});

describe("createLogger — dedupe + critical exemption", () => {
  let sink: CaptureSink;
  beforeEach(() => {
    sink = makeSink();
    attachSink(sink);
  });
  afterEach(() => {
    __setLoggerConsoleForTests(null);
  });

  it("[case 5] same (level,code,trace_uuid) within window is suppressed", () => {
    const logger = createLogger("test-w");
    withTraceContext({ trace_uuid: "33333333-3333-4333-8333-333333333333" }, () => {
      logger.error("first", { code: "rpc-parity-failed" });
      logger.error("second", { code: "rpc-parity-failed" });
      logger.error("third", { code: "rpc-parity-failed" });
    });
    expect(sink.error.length).toBe(1);
  });

  it("[case 6] critical bypasses dedupe — every call emits", () => {
    const logger = createLogger("test-w");
    withTraceContext({ trace_uuid: "44444444-4444-4444-8444-444444444444" }, () => {
      logger.critical("a", { code: "internal-error" });
      logger.critical("b", { code: "internal-error" });
    });
    expect(sink.error.length).toBe(2);
    expect(sink.error[0]).toMatch(/^\[CRITICAL\] /);
    expect(sink.error[1]).toMatch(/^\[CRITICAL\] /);
  });
});

describe("createLogger — serialize failure + level filter", () => {
  let sink: CaptureSink;
  beforeEach(() => {
    sink = makeSink();
    attachSink(sink);
  });
  afterEach(() => {
    __setLoggerConsoleForTests(null);
  });

  it("[case 7] circular ctx falls back with _serialize_error: true", () => {
    const logger = createLogger("test-w");
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    logger.warn("loop", { code: "validation-failed", ctx: cycle });
    const record = JSON.parse(sink.warn[0]) as LogRecord;
    expect(record._serialize_error).toBe(true);
    expect(record.code).toBe("validation-failed");
  });

  it("[case 8] level filter drops records below configured level", () => {
    const logger = createLogger("test-w", { level: "warn" });
    logger.debug("dropped");
    logger.info("dropped");
    logger.warn("kept", { code: "rate-limited" });
    expect(sink.debug.length).toBe(0);
    expect(sink.log.length).toBe(0);
    expect(sink.warn.length).toBe(1);
  });
});

describe("createLogger — DO / Worker-Shell dual-mode (sync/async persist)", () => {
  let sink: CaptureSink;
  beforeEach(() => {
    sink = makeSink();
    attachSink(sink);
  });
  afterEach(() => {
    __setLoggerConsoleForTests(null);
  });

  it("[case 9] async persistError failure produces a fallback rpc_log_failed record", async () => {
    const persist: LogPersistFn = () => Promise.reject(new Error("simulated D1 down"));
    const logger = createLogger("test-w", { persistError: persist });
    logger.error("first-write-fails", { code: "internal-error" });
    // Yield a microtask so the rejection has a chance to propagate.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const lines = sink.error.map((l) => JSON.parse(l) as LogRecord);
    expect(lines.length).toBe(2);
    expect(lines[1].rpc_log_failed).toBe(true);
  });

  it("[case 10] sync persistError throw is caught and degrades to console fallback", () => {
    const persist: LogPersistFn = () => {
      throw new Error("sync sink failure");
    };
    const logger = createLogger("test-w", { persistError: persist });
    logger.error("sync-fail", { code: "internal-error" });
    const lines = sink.error.map((l) => JSON.parse(l) as LogRecord);
    expect(lines.length).toBe(2);
    expect(lines[1].rpc_log_failed).toBe(true);
  });
});

describe("createLogger — JSON output schema invariants", () => {
  let sink: CaptureSink;
  beforeEach(() => {
    sink = makeSink();
    attachSink(sink);
  });
  afterEach(() => {
    __setLoggerConsoleForTests(null);
  });

  it("[case 11] every emitted line is single-line JSON with required fields", () => {
    const logger = createLogger("test-w", { level: "debug" });
    withTraceContext({ trace_uuid: "55555555-5555-4555-8555-555555555555" }, () => {
      logger.debug("d");
      logger.info("i");
      logger.warn("w", { code: "rate-limited" });
      logger.error("e", { code: "internal-error" });
      logger.critical("c", { code: "internal-error" });
    });
    const all = [...sink.debug, ...sink.log, ...sink.warn, ...sink.error];
    expect(all.length).toBe(5);
    for (const raw of all) {
      const stripped = raw.startsWith("[CRITICAL] ") ? raw.slice("[CRITICAL] ".length) : raw;
      const parsed = JSON.parse(stripped) as LogRecord;
      expect(typeof parsed.ts).toBe("string");
      expect(parsed.worker).toBe("test-w");
      expect(typeof parsed.msg).toBe("string");
      expect(["debug", "info", "warn", "error", "critical"]).toContain(parsed.level);
    }
  });

  it("[case 12] code is omitted on debug/info but present on warn+ when supplied", () => {
    const logger = createLogger("test-w", { level: "debug" });
    logger.debug("d", { tag: 1 });
    logger.error("e", { code: "internal-error" });
    const debugRec = JSON.parse(sink.debug[0]) as LogRecord;
    const errRec = JSON.parse(sink.error[0]) as LogRecord;
    expect(debugRec.code).toBeUndefined();
    expect(errRec.code).toBe("internal-error");
  });
});

describe("createLogger — recentErrors ring buffer", () => {
  let sink: CaptureSink;
  beforeEach(() => {
    sink = makeSink();
    attachSink(sink);
  });
  afterEach(() => {
    __setLoggerConsoleForTests(null);
  });

  it("[case 13] recentErrors() returns most-recent-first up to limit", () => {
    const logger = createLogger("test-w", { ringBufferSize: 4 });
    withTraceContext({ trace_uuid: "66666666-6666-4666-8666-666666666666" }, () => {
      logger.warn("a", { code: "x" });
    });
    withTraceContext({ trace_uuid: "77777777-7777-4777-8777-777777777777" }, () => {
      logger.warn("b", { code: "y" });
    });
    withTraceContext({ trace_uuid: "88888888-8888-4888-8888-888888888888" }, () => {
      logger.warn("c", { code: "z" });
    });
    const recent = logger.recentErrors(2);
    expect(recent.length).toBe(2);
    expect(recent[0].msg).toBe("c");
    expect(recent[1].msg).toBe("b");
  });
});

describe("RingBuffer + DedupeCache primitives", () => {
  it("[case 14] RingBuffer wraps around and returns newest-first", () => {
    const rb = new RingBuffer<number>(3);
    [1, 2, 3, 4, 5].forEach((v) => rb.push(v));
    expect(rb.takeRecent()).toEqual([5, 4, 3]);
  });

  it("[case 15] DedupeCache enforces window + capacity eviction", () => {
    let now = 0;
    const dc = new DedupeCache({ windowMs: 100, capacity: 2, now: () => now });
    expect(dc.shouldEmit("a")).toBe(true);
    expect(dc.shouldEmit("a")).toBe(false);
    now = 200;
    expect(dc.shouldEmit("a")).toBe(true);
    // Capacity 2: insert b, c → a should evict.
    expect(dc.shouldEmit("b")).toBe(true);
    expect(dc.shouldEmit("c")).toBe(true);
    expect(dc.size()).toBe(2);
  });

  it("[case 16] buildDedupeKey treats undefined as underscore", () => {
    expect(buildDedupeKey("warn", undefined, undefined)).toBe("warn|_|_");
    expect(buildDedupeKey("error", "rate-limited", "tr")).toBe("error|rate-limited|tr");
  });
});
