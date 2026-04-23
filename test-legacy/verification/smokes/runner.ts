/**
 * A6 Phase 2 — verification smoke runner + verdict bundle writer.
 *
 * Provides three building blocks every smoke case shares:
 *
 *   1. `WorkerHarness` — a no-wrangler in-process double that wires
 *      `NanoSessionDO.fetch()` directly so the same smoke specs can run
 *      on a developer laptop without `wrangler dev --remote`. The
 *      harness records the profile id used so reviewers can tell
 *      whether a bundle came from a real L1 or the local fallback.
 *
 *   2. `SmokeRecorder` — accumulates assertion results, per-step
 *      timings, failure records, and trace anchors. Matches the bundle
 *      shape documented in `test-legacy/verification/README.md`.
 *
 *   3. `writeVerdictBundle()` — serialises a recorder + computed
 *      verdict to `test-legacy/verification/verdict-bundles/<ts>-<id>.json`
 *      (or returns the JSON when the writer is invoked in-memory).
 *
 * The runner intentionally has zero external deps beyond Node + the
 * already-built session-do-runtime package, so smoke cases stay
 * portable between local execution and CI.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  NanoSessionDO,
  makeRemoteBindingsFactory,
  resolveCompositionProfile,
  DEFAULT_RUNTIME_CONFIG,
  type SessionRuntimeEnv,
  type CompositionProfile,
  type SubsystemHandles,
  type CompositionFactory,
} from "../../../packages/session-do-runtime/dist/index.js";

import type { LadderLayer } from "../profiles/manifest.ts";
import { getProfile, type ProfileManifest } from "../profiles/manifest.ts";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BUNDLE_DIR = join(here, "..", "verdict-bundles");

// ─────────────────────────────────────────────────────────────────────
// Bundle types
// ─────────────────────────────────────────────────────────────────────

export type Verdict = "green" | "yellow" | "red";

export interface SmokeStep {
  readonly name: string;
  readonly status: "pass" | "fail" | "skip";
  readonly durationMs: number;
  readonly note?: string;
}

export interface SmokeFailureRecord {
  readonly name: string;
  readonly reason: string;
  readonly detail?: Record<string, unknown>;
}

export interface LatencyBaseline {
  readonly wsAttachMs?: number;
  readonly firstByteMs?: number;
  readonly fullTurnMs?: number;
  readonly [extra: string]: number | undefined;
}

export interface VerdictBundle {
  readonly bundleVersion: 1;
  readonly profile: string;
  readonly profileLadder: LadderLayer | "local-l0-harness";
  readonly scenario: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly verdict: Verdict;
  readonly blocking: readonly string[];
  readonly trace: { anchorTraceUuid?: string; events: readonly unknown[] };
  readonly timeline: readonly unknown[];
  readonly placement: readonly unknown[];
  readonly summary: { passes: number; failures: number; skipped: number };
  readonly steps: readonly SmokeStep[];
  readonly failureRecord: readonly SmokeFailureRecord[];
  readonly latencyBaseline?: LatencyBaseline;
  readonly notes?: string;
}

// ─────────────────────────────────────────────────────────────────────
// SmokeRecorder
// ─────────────────────────────────────────────────────────────────────

export class SmokeRecorder {
  readonly profileId: string;
  readonly scenario: string;
  readonly startedAt = new Date().toISOString();
  readonly profileLadder: VerdictBundle["profileLadder"];

  private readonly steps: SmokeStep[] = [];
  private readonly failures: SmokeFailureRecord[] = [];
  private readonly traceEvents: unknown[] = [];
  private readonly timelineEvents: unknown[] = [];
  private readonly placementEvents: unknown[] = [];
  private readonly blockingItems: string[] = [];
  private latency: LatencyBaseline = {};
  private anchorTraceUuid: string | undefined;
  private notes: string | undefined;

  constructor(opts: {
    scenario: string;
    profile: ProfileManifest;
    /**
     * When true, this recorder represents the local in-process harness
     * fallback, NOT a real L1 / L2 run. The bundle distinguishes the
     * two so reviewers cannot mistake a laptop run for a deploy-shaped
     * one.
     */
    localFallback?: boolean;
  }) {
    this.profileId = opts.profile.id;
    this.scenario = opts.scenario;
    this.profileLadder = opts.localFallback
      ? "local-l0-harness"
      : (opts.profile.ladderPosition ?? "L0");
  }

  /** Record a single step with its assertion result. */
  step(
    name: string,
    status: SmokeStep["status"],
    durationMs: number,
    note?: string,
  ): void {
    this.steps.push({ name, status, durationMs, note });
  }

  /** Convenience: time + record a step around an async block. */
  async timed<T>(name: string, fn: () => Promise<T>, note?: string): Promise<T> {
    const t0 = performance.now();
    try {
      const out = await fn();
      this.step(name, "pass", performance.now() - t0, note);
      return out;
    } catch (e) {
      this.step(name, "fail", performance.now() - t0, note);
      this.recordFailure(name, e);
      throw e;
    }
  }

  recordFailure(name: string, err: unknown, detail?: Record<string, unknown>): void {
    this.failures.push({
      name,
      reason: err instanceof Error ? err.message : String(err),
      detail,
    });
  }

  block(reason: string): void {
    this.blockingItems.push(reason);
  }

  emitTrace(event: unknown): void {
    this.traceEvents.push(event);
  }

  emitTimeline(event: unknown): void {
    this.timelineEvents.push(event);
  }

  emitPlacement(event: unknown): void {
    this.placementEvents.push(event);
  }

  setAnchorTrace(traceUuid: string): void {
    this.anchorTraceUuid = traceUuid;
  }

  setLatency(baseline: LatencyBaseline): void {
    this.latency = { ...this.latency, ...baseline };
  }

  setNotes(notes: string): void {
    this.notes = notes;
  }

  /** Compute the local verdict for this recorder. */
  computeVerdict(): Verdict {
    if (this.failures.length === 0 && this.blockingItems.length === 0) {
      return "green";
    }
    // Anything that lands in `blocking` or that is a structural failure
    // (the smoke says it cannot prove what it set out to prove) is red.
    if (this.blockingItems.length > 0) return "red";
    return "yellow";
  }

  build(): VerdictBundle {
    const summary = {
      passes: this.steps.filter((s) => s.status === "pass").length,
      failures: this.steps.filter((s) => s.status === "fail").length,
      skipped: this.steps.filter((s) => s.status === "skip").length,
    };
    return {
      bundleVersion: 1,
      profile: this.profileId,
      profileLadder: this.profileLadder,
      scenario: this.scenario,
      startedAt: this.startedAt,
      endedAt: new Date().toISOString(),
      verdict: this.computeVerdict(),
      blocking: this.blockingItems.slice(),
      trace: {
        anchorTraceUuid: this.anchorTraceUuid,
        events: this.traceEvents.slice(),
      },
      timeline: this.timelineEvents.slice(),
      placement: this.placementEvents.slice(),
      summary,
      steps: this.steps.slice(),
      failureRecord: this.failures.slice(),
      latencyBaseline:
        Object.keys(this.latency).length > 0 ? this.latency : undefined,
      notes: this.notes,
    };
  }
}

export function writeVerdictBundle(
  bundle: VerdictBundle,
  options: { dir?: string; persist?: boolean } = {},
): { path: string; json: string } {
  const dir = options.dir ?? DEFAULT_BUNDLE_DIR;
  const safeScenario = bundle.scenario.replace(/[^a-z0-9-]+/gi, "-");
  const safeStamp = bundle.startedAt.replace(/[:.]/g, "-");
  const path = join(dir, `${safeStamp}-${bundle.profile}-${safeScenario}.json`);
  const json = JSON.stringify(bundle, null, 2);
  if (options.persist !== false) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, json);
  }
  return { path, json };
}

// ─────────────────────────────────────────────────────────────────────
// WorkerHarness
// ─────────────────────────────────────────────────────────────────────

/**
 * A6-A7 review Kimi R5: explicit allowlist of env overrides that
 * smoke specs may pass through to the harness. Using a named
 * interface (instead of `as never` / `as unknown`) keeps typecheck
 * honest: if `SessionRuntimeEnv` drops `TEAM_UUID` / `SESSION_UUID` /
 * `HOOK_WORKER` / `BASH_CORE` / `FAKE_PROVIDER_WORKER`, every
 * smoke that supplies them fails at compile time instead of silently
 * passing an inert override.
 */
export interface HarnessEnvOverrides
  extends Partial<
    Pick<
      SessionRuntimeEnv,
      | "TEAM_UUID"
      | "SESSION_UUID"
      | "HOOK_WORKER"
      | "BASH_CORE"
      | "CAPABILITY_WORKER"
      | "FAKE_PROVIDER_WORKER"
    >
  > {
  // Intentionally closed: adding a new override should be a deliberate
  // decision visible in this interface, not a one-off `as never`.
}

export interface WorkerHarnessOptions {
  /** Profile id (`local-l0` / `remote-dev-l1` / `deploy-smoke-l2`). */
  readonly profileId: string;
  /** Optional baseUrl — when set, the harness `fetch()` proxies to a real wrangler dev session. */
  readonly baseUrl?: string;
  /** Override env overrides — handy for plugging in fake worker fixtures. */
  readonly envOverrides?: HarnessEnvOverrides;
  /** Optional composition profile override (debug / spike). */
  readonly compositionProfile?: CompositionProfile;
  /** Optional eval sink so smoke cases can record traces into the bundle. */
  readonly evalSink?: { emit: (event: unknown) => void | Promise<void> };
}

/**
 * Lightweight in-process worker. Constructs a `NanoSessionDO` per
 * sessionUuid (mirroring `worker.ts` semantics) and lets the smoke
 * specs `fetch()` against `https://harness.local/sessions/.../...`.
 *
 * When `baseUrl` is set the harness becomes a thin proxy that forwards
 * to the real `wrangler dev --remote` URL — same code path, real wire.
 */
export class WorkerHarness {
  private readonly profile: ProfileManifest;
  private readonly env: SessionRuntimeEnv;
  private readonly factory: CompositionFactory;
  private readonly instances = new Map<string, NanoSessionDO>();
  readonly baseUrl: string;
  readonly localFallback: boolean;

  constructor(options: WorkerHarnessOptions) {
    this.profile = getProfile(options.profileId);
    this.localFallback = options.baseUrl === undefined;
    this.baseUrl = options.baseUrl ?? "https://harness.local";

    const sinkHandles =
      options.evalSink !== undefined
        ? { eval: options.evalSink }
        : undefined;

    const baseEnv: SessionRuntimeEnv = {
      SESSION_DO: {},
      R2_ARTIFACTS: {},
      KV_CONFIG: {},
    };
    this.env = { ...baseEnv, ...options.envOverrides };
    const baseFactory = makeRemoteBindingsFactory();
    this.factory = sinkHandles
      ? this.wrapFactoryWithSink(baseFactory, sinkHandles)
      : baseFactory;

    // Pre-resolve to surface bad profile combos early.
    resolveCompositionProfile(this.env, {
      ...DEFAULT_RUNTIME_CONFIG,
      compositionProfile: options.compositionProfile,
    });
  }

  /**
   * Fetch as if the request hit the deployed Worker entrypoint.
   *
   * A6-A7 review GPT R1: when `baseUrl` is explicitly set (meaning the
   * caller chose NOT to fall back to the local harness), rewrite the
   * request URL so the path lands on the real `wrangler dev --remote`
   * (or deployed) endpoint and forward it via the ambient `fetch`.
   * This is the only way a green L1 run can legitimately claim the
   * deploy-shaped Worker/DO boundary was exercised — previously the
   * harness silently resolved every request through the in-process
   * `NanoSessionDO` regardless of `baseUrl`, which is what R1 flagged.
   */
  async fetch(
    request: Request | string,
    init?: RequestInit,
  ): Promise<Response> {
    const req =
      typeof request === "string" ? new Request(request, init) : request;
    if (!this.localFallback) {
      return this.forwardToRemote(req);
    }
    const sessionUuid = this.extractSessionUuid(req);
    const stub = this.getInstance(sessionUuid);
    return stub.fetch(req);
  }

  private async forwardToRemote(req: Request): Promise<Response> {
    const originalUrl = new URL(req.url);
    const remote = new URL(this.baseUrl);
    // Preserve the incoming path + query; only the origin changes.
    remote.pathname = originalUrl.pathname;
    remote.search = originalUrl.search;
    const forwarded = new Request(remote.toString(), req);
    return fetch(forwarded);
  }

  private getInstance(sessionUuid: string): NanoSessionDO {
    let instance = this.instances.get(sessionUuid);
    if (instance) return instance;
    const env = {
      ...this.env,
      TEAM_UUID: (this.env as Record<string, unknown>)["TEAM_UUID"] ?? "team-harness",
      SESSION_UUID: sessionUuid,
    } as unknown as SessionRuntimeEnv;
    instance = new NanoSessionDO({}, env, this.factory);
    this.instances.set(sessionUuid, instance);
    return instance;
  }

  private extractSessionUuid(req: Request): string {
    try {
      const url = new URL(req.url);
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments[0] === "sessions" && segments[1]) return segments[1];
    } catch {
      /* noop */
    }
    return "11111111-1111-4111-8111-111111111111";
  }

  private wrapFactoryWithSink(
    inner: CompositionFactory,
    extras: { eval: { emit: (e: unknown) => void | Promise<void> } },
  ): CompositionFactory {
    return {
      create(env, config): SubsystemHandles {
        const handles = inner.create(env, config);
        return { ...handles, eval: handles.eval ?? extras.eval };
      },
    };
  }

  /** Profile metadata for the bundle. */
  describeProfile(): ProfileManifest {
    return this.profile;
  }
}

/** Convenience factory: build a harness and a recorder linked together. */
export function makeSmokeRig(options: {
  scenario: string;
  profileId: string;
  baseUrl?: string;
  envOverrides?: Partial<SessionRuntimeEnv>;
}): { harness: WorkerHarness; recorder: SmokeRecorder } {
  const harness = new WorkerHarness({
    profileId: options.profileId,
    baseUrl: options.baseUrl,
    envOverrides: options.envOverrides,
    evalSink: {
      emit(event: unknown) {
        rec.emitTrace(event);
      },
    },
  });
  const rec = new SmokeRecorder({
    scenario: options.scenario,
    profile: harness.describeProfile(),
    localFallback: harness.localFallback,
  });
  return { harness, recorder: rec };
}
