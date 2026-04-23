/**
 * B4 — inspector-facade tests.
 *
 * Covers:
 *   - GET / POST endpoint surface
 *   - Auth (bearer + IP allowlist)
 *   - Lowercase header constants (binding-F02)
 *   - Redact filter blocks API keys / bearer tokens / JWT in
 *     `/inspect/.../layers` previews
 *   - WS subscribe filter (tags + event-name wildcard)
 *   - INSPECTOR_DEDUP_CAVEAT surfaced until B6 dedup ships
 *   - Conditional mount helper default-disabled / opt-in
 */

import { describe, it, expect } from "vitest";
import {
  INSPECTOR_DEDUP_CAVEAT,
  INSPECTOR_HEADER_BEARER,
  InspectorFacade,
  isIpAllowed,
  mountInspectorFacade,
  parseBearer,
  redactSecrets,
} from "../../src/inspector-facade/index.js";
import type {
  InspectorDataProviders,
  InspectorFacadeConfig,
  LayerView,
} from "../../src/inspector-facade/index.js";
import type { CompactPolicy } from "../../src/budget/index.js";
import type { CompactStateInspectorView } from "../../src/inspector-facade/types.js";

const compactPolicy: CompactPolicy = {
  softTriggerPct: 0.75,
  hardFallbackPct: 0.95,
  minHeadroomTokensForBackground: 5_000,
  backgroundTimeoutMs: 30_000,
  maxRetriesAfterFailure: 1,
  disabled: false,
};

function makeProviders(overrides: Partial<InspectorDataProviders> = {}): InspectorDataProviders {
  const compactState: CompactStateInspectorView = {
    state: "idle",
    stateId: "cs-1",
    enteredAt: "2026-04-20T00:00:00.000Z",
  };
  const base: InspectorDataProviders = {
    async getUsageSnapshot() {
      return {
        totalTokens: 10_000,
        maxTokens: 100_000,
        responseReserveTokens: 4_000,
        categories: [
          { name: "system", tokens: 1_000 },
          { name: "interaction", tokens: 9_000 },
        ],
      };
    },
    async getCompactStateSnapshot() {
      return compactState;
    },
    async getBufferPolicy() {
      return { hardLimitTokens: 100_000, responseReserveTokens: 4_000 };
    },
    async getCompactPolicy() {
      return compactPolicy;
    },
    async getSnapshots() {
      return [];
    },
    async getLayers() {
      return [
        {
          kind: "system",
          tokenEstimate: 50,
          required: true,
          preview: "you are nano-agent",
        },
      ] as LayerView[];
    },
  };
  return { ...base, ...overrides };
}

function makeFacade(config: Partial<InspectorFacadeConfig> = {}): InspectorFacade {
  return new InspectorFacade({
    sessionUuid: "sess-1",
    providers: makeProviders(),
    ...config,
  });
}

// ─── Auth ────────────────────────────────────────────────────────────

describe("inspector-facade — auth", () => {
  it("parses bearer from Authorization header", () => {
    const headers = new Headers({ authorization: "Bearer abc123" });
    expect(parseBearer(headers)).toBe("abc123");
  });

  it("parses bearer from lowercase x-inspector-bearer header (binding-F02)", () => {
    const headers = new Headers({ [INSPECTOR_HEADER_BEARER]: "tok" });
    expect(parseBearer(headers)).toBe("tok");
  });

  it("rejects missing bearer when configured", async () => {
    const facade = makeFacade({
      auth: { bearerToken: "expected-token" },
    });
    const res = await facade.handle(
      new Request("https://x/inspect/sessions/sess-1/context/usage"),
    );
    expect(res.status).toBe(401);
  });

  it("accepts matching bearer", async () => {
    const facade = makeFacade({
      auth: { bearerToken: "expected-token" },
    });
    const res = await facade.handle(
      new Request("https://x/inspect/sessions/sess-1/context/usage", {
        headers: { [INSPECTOR_HEADER_BEARER]: "expected-token" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("isIpAllowed handles exact + CIDR rules", () => {
    expect(isIpAllowed("203.0.113.1", ["203.0.113.1"])).toBe(true);
    expect(isIpAllowed("10.0.0.5", ["10.0.0.0/8"])).toBe(true);
    expect(isIpAllowed("11.0.0.5", ["10.0.0.0/8"])).toBe(false);
    expect(isIpAllowed("not-an-ip", ["10.0.0.0/8"])).toBe(false);
    expect(isIpAllowed("any", undefined)).toBe(true);
    expect(isIpAllowed("any", [])).toBe(true);
  });

  it("rejects IP not in allowlist", async () => {
    const facade = makeFacade({
      auth: { ipAllowlist: ["10.0.0.0/8"] },
    });
    const res = await facade.handle(
      new Request("https://x/inspect/sessions/sess-1/context/usage"),
      { remoteIp: "8.8.8.8" },
    );
    expect(res.status).toBe(403);
  });
});

// ─── Routes ──────────────────────────────────────────────────────────

describe("inspector-facade — GET routes", () => {
  it("/usage returns the canonical UsageReport with diagnostics caveat", async () => {
    const facade = makeFacade();
    const res = await facade.handle(
      new Request("https://x/inspect/sessions/sess-1/context/usage"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalTokens).toBe(10_000);
    expect(body.maxTokens).toBe(100_000);
    expect(body.diagnostics).toContain(INSPECTOR_DEDUP_CAVEAT);
    expect(body.bufferPolicy.softCompactTriggerPct).toBe(0.75);
  });

  it("/usage diagnostics omits dedup caveat when preB6Dedup === false", async () => {
    const facade = makeFacade({ preB6Dedup: false });
    const res = await facade.handle(
      new Request("https://x/inspect/sessions/sess-1/context/usage"),
    );
    const body = await res.json();
    expect(body.diagnostics).not.toContain(INSPECTOR_DEDUP_CAVEAT);
  });

  it("/layers returns redacted previews", async () => {
    const facade = makeFacade({
      providers: makeProviders({
        async getLayers() {
          return [
            {
              kind: "system",
              tokenEstimate: 10,
              required: true,
              preview: "key=sk-ant-VeryLongFakeTokenABCDEFGHIJ",
            },
          ];
        },
      }),
    });
    const res = await facade.handle(
      new Request("https://x/inspect/sessions/sess-1/context/layers"),
    );
    const body = (await res.json()) as Array<{ preview: string }>;
    expect(body[0].preview).toContain("[redacted]");
  });

  it("/policy returns BufferPolicy + CompactPolicy", async () => {
    const facade = makeFacade();
    const res = await facade.handle(
      new Request("https://x/inspect/sessions/sess-1/context/policy"),
    );
    const body = await res.json();
    expect(body.buffer.hardLimitTokens).toBe(100_000);
    expect(body.compact.softTriggerPct).toBe(0.75);
  });

  it("returns 404 for unknown action", async () => {
    const facade = makeFacade();
    const res = await facade.handle(
      new Request("https://x/inspect/sessions/sess-1/context/wat"),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when path session does not match facade session", async () => {
    const facade = makeFacade();
    const res = await facade.handle(
      new Request("https://x/inspect/sessions/wrong-session/context/usage"),
    );
    expect(res.status).toBe(404);
  });
});

// ─── POST control endpoints ──────────────────────────────────────────

describe("inspector-facade — POST control endpoints", () => {
  it("/snapshot returns 501 when triggerSnapshot is not configured", async () => {
    const facade = makeFacade();
    const res = await facade.handle(
      new Request("https://x/inspect/sessions/sess-1/context/snapshot", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(501);
  });

  it("/compact dispatches to triggerCompact", async () => {
    let recorded: string | undefined;
    const facade = makeFacade({
      providers: makeProviders({
        async triggerCompact(mode) {
          recorded = mode;
          return { outcome: "ok" };
        },
      }),
    });
    const res = await facade.handle(
      new Request("https://x/inspect/sessions/sess-1/context/compact", {
        method: "POST",
        body: JSON.stringify({ mode: "sync" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(recorded).toBe("sync");
  });

  it("/restore returns 400 when snapshotId missing", async () => {
    const facade = makeFacade({
      providers: makeProviders({
        async restoreSnapshot() {
          /* noop */
        },
      }),
    });
    const res = await facade.handle(
      new Request("https://x/inspect/sessions/sess-1/context/restore", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
  });
});

// ─── Subscribe (WS) ─────────────────────────────────────────────────

describe("inspector-facade — subscribe filter", () => {
  it("delivers only events matching the tag list", () => {
    const facade = makeFacade();
    const sub = facade.subscribeStream({ tags: ["system"] });
    const matched1 = sub.push({ kind: "session.update", tag: "system", body: 1 });
    const matched2 = sub.push({ kind: "session.update", tag: "interaction", body: 2 });
    expect(matched1).toBe(true);
    expect(matched2).toBe(false);
  });

  it("supports wildcard event-name pattern", () => {
    const facade = makeFacade();
    const sub = facade.subscribeStream({ events: ["ContextCompact*"] });
    expect(sub.push({ kind: "ContextCompactArmed", body: 1 })).toBe(true);
    expect(sub.push({ kind: "session.update", body: 1 })).toBe(false);
  });

  it("broadcast delivers to every active subscription", () => {
    const facade = makeFacade();
    const sub1 = facade.subscribeStream();
    const sub2 = facade.subscribeStream();
    const delivered = facade.broadcast({ kind: "ContextCompactCommitted", body: { ok: true } });
    expect(delivered).toBe(2);
    void sub1;
    void sub2;
  });

  it("cancelled subscriptions stop receiving events", () => {
    const facade = makeFacade();
    const sub = facade.subscribeStream();
    sub.cancel();
    expect(sub.push({ kind: "anything", body: 1 })).toBe(false);
    expect(facade.listSubscriptions()).toHaveLength(0);
  });
});

// ─── Redact ──────────────────────────────────────────────────────────

describe("inspector-facade — redactSecrets", () => {
  it("scrubs sk-ant API keys", () => {
    expect(redactSecrets("token=sk-ant-AaBbCcDdEeFfGg1234")).toContain("[redacted]");
  });

  it("scrubs Bearer headers", () => {
    expect(redactSecrets("Authorization: Bearer abcdefghijkl")).toContain("[redacted]");
  });

  it("scrubs AWS access keys", () => {
    expect(redactSecrets("AKIA0123456789ABCDEF")).toBe("[redacted]");
  });

  it("scrubs JWT-shaped tokens", () => {
    expect(redactSecrets("aaaaaa.bbbbbb.cccccc")).toContain("[redacted]");
  });

  it("preserves benign text", () => {
    expect(redactSecrets("hello world 12345")).toBe("hello world 12345");
  });
});

// ─── Mount helper ────────────────────────────────────────────────────

describe("inspector-facade — mount helper", () => {
  it("returns null when INSPECTOR_FACADE_ENABLED is unset (default disabled)", async () => {
    const res = await mountInspectorFacade({
      env: {},
      request: new Request("https://x/inspect/sessions/sess-1/context/usage"),
      facadeFactory: (id) => makeFacade({ sessionUuid: id }),
    });
    expect(res).toBeNull();
  });

  it("returns null when path is outside /inspect/ prefix", async () => {
    const res = await mountInspectorFacade({
      env: { INSPECTOR_FACADE_ENABLED: "1" },
      request: new Request("https://x/sessions/sess-1/heartbeat"),
      facadeFactory: (id) => makeFacade({ sessionUuid: id }),
    });
    expect(res).toBeNull();
  });

  it("dispatches to facade when enabled and path matches", async () => {
    const res = await mountInspectorFacade({
      env: { INSPECTOR_FACADE_ENABLED: "true" },
      request: new Request("https://x/inspect/sessions/sess-1/context/usage"),
      facadeFactory: (id) => makeFacade({ sessionUuid: id }),
    });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
  });

  it("rewrites custom prefixes onto the canonical /inspect surface", async () => {
    const res = await mountInspectorFacade({
      env: { INSPECTOR_FACADE_ENABLED: "true" },
      prefix: "/ops/inspect/",
      request: new Request("https://x/ops/inspect/sessions/sess-1/context/usage"),
      facadeFactory: (id) => makeFacade({ sessionUuid: id }),
    });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
  });
});
