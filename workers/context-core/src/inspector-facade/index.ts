/**
 * Context-Management — inspector-facade submodule.
 *
 * `InspectorFacade.handle(request)` returns a `Response`. The session
 * worker entry routes `/inspect/...` traffic to this handler when
 * inspection is enabled (default: disabled — see `route-mount.ts`).
 *
 * Endpoint surface (per `P3-context-management-inspector.md §4`):
 *
 *   GET  /inspect/sessions/:id/context/usage          → UsageReport
 *   GET  /inspect/sessions/:id/context/layers?tag=…   → LayerView[]
 *   GET  /inspect/sessions/:id/context/policy         → PolicyView
 *   GET  /inspect/sessions/:id/context/snapshots      → SnapshotMetadata[]
 *   GET  /inspect/sessions/:id/context/compact-state  → CompactStateInspectorView
 *   POST /inspect/sessions/:id/context/snapshot       → { snapshotId }
 *   POST /inspect/sessions/:id/context/compact        → { outcome }
 *   POST /inspect/sessions/:id/context/restore        → 204
 *
 * The facade does NOT bundle a HTTP framework. Tests drive it with a
 * plain `Request`; the worker entry forwards `request` straight in.
 */

import { respondWithFacadeError } from "@haimang/nacp-core/logger";
import { checkAuth } from "./inspector-auth.js";
import { redactPayload } from "./inspector-redact.js";
import { buildUsageReport } from "./usage-report.js";
import {
  INSPECTOR_DEDUP_CAVEAT,
  INSPECTOR_HEADER_BEARER,
  INSPECTOR_HEADER_IP_BYPASS,
  INSPECTOR_HEADER_TRACE_UUID,
  type CompactStateInspectorView,
  type InspectorFacadeConfig,
  type LayerView,
  type PolicyView,
  type StreamSubscription,
  type SubscribeFilter,
  type UsageReport,
} from "./types.js";

// ── Re-exports ──
export {
  INSPECTOR_DEDUP_CAVEAT,
  INSPECTOR_HEADER_BEARER,
  INSPECTOR_HEADER_IP_BYPASS,
  INSPECTOR_HEADER_TRACE_UUID,
  buildUsageReport,
  redactPayload,
};
export { redactSecrets } from "./inspector-redact.js";
export { parseBearer, isIpAllowed, checkAuth } from "./inspector-auth.js";
export type {
  CompactStateInspectorView,
  InspectorAuthConfig,
  InspectorDataProviders,
  InspectorFacadeConfig,
  LayerView,
  PolicyView,
  StreamSubscription,
  SubscribeFilter,
  UsageReport,
} from "./types.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — InspectorFacade
// ═══════════════════════════════════════════════════════════════════

export class InspectorFacade {
  private readonly config: InspectorFacadeConfig;
  private readonly subscriptions = new Set<InternalSubscription>();

  constructor(config: InspectorFacadeConfig) {
    this.config = config;
  }

  /**
   * Main HTTP entry. Routes by URL path + method; returns a `Response`.
   * Errors are mapped to `5xx` with redacted body.
   */
  async handle(request: Request, ctx?: { remoteIp?: string }): Promise<Response> {
    const auth = checkAuth({
      config: this.config.auth,
      headers: request.headers,
      remoteIp: ctx?.remoteIp,
    });
    if (!auth.ok) {
      return jsonResponse({ error: auth.reason }, auth.status);
    }

    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);
    // Expected: ["inspect", "sessions", ":sessionUuid", "context", action]
    if (
      segments.length < 5 ||
      segments[0] !== "inspect" ||
      segments[1] !== "sessions" ||
      segments[3] !== "context"
    ) {
      return jsonResponse({ error: "not-found" }, 404);
    }
    const sessionUuidInPath = segments[2]!;
    if (sessionUuidInPath !== this.config.sessionUuid) {
      // Defence in depth — facade is per-session; refuse cross-session
      // queries even if the URL pattern matches.
      return jsonResponse({ error: "session-mismatch" }, 404);
    }
    const action = segments[4]!;

    try {
      if (request.method === "GET") {
        return await this.handleGet(action, url);
      }
      if (request.method === "POST") {
        return await this.handlePost(action, request);
      }
      return jsonResponse({ error: "method-not-allowed" }, 405);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Redact in case the underlying error message embeds a secret.
      return jsonResponse(
        redactPayload({ error: "internal-error", detail: message }),
        500,
      );
    }
  }

  /**
   * Subscribe to the live event stream. Worker entry adapts the
   * returned `StreamSubscription` to its actual WebSocket transport.
   */
  subscribeStream(filter: SubscribeFilter = {}): StreamSubscription {
    const subscriptions = this.subscriptions;
    const sub: InternalSubscription = {
      filter,
      sink: [],
      cancelled: false,
      cancel() {
        if (this.cancelled) return;
        this.cancelled = true;
        subscriptions.delete(this);
      },
      push(event) {
        if (this.cancelled) return false;
        if (!matchesFilter(this.filter, event)) return false;
        this.sink.push(event);
        return true;
      },
    };
    this.subscriptions.add(sub);
    return sub;
  }

  /** Read the in-memory subscription list — useful for tests. */
  listSubscriptions(): ReadonlyArray<InternalSubscription> {
    return [...this.subscriptions];
  }

  /** Push an event to all subscriptions; returns the count delivered. */
  broadcast(event: { kind: string; tag?: string; body: unknown }): number {
    let delivered = 0;
    for (const sub of this.subscriptions) {
      if (sub.push(event)) delivered += 1;
    }
    return delivered;
  }

  // ── GET handlers ─────────────────────────────────────────────────

  private async handleGet(action: string, url: URL): Promise<Response> {
    switch (action) {
      case "usage":
        return jsonResponse(await this.buildReport());
      case "layers": {
        const tag = url.searchParams.get("tag") ?? undefined;
        const layers = await this.config.providers.getLayers(tag);
        return jsonResponse(redactPayload(layers));
      }
      case "policy": {
        const view: PolicyView = {
          buffer: await this.config.providers.getBufferPolicy(),
          compact: await this.config.providers.getCompactPolicy(),
        };
        return jsonResponse(view);
      }
      case "snapshots":
        return jsonResponse(await this.config.providers.getSnapshots());
      case "compact-state":
        return jsonResponse(await this.config.providers.getCompactStateSnapshot());
      default:
        return jsonResponse({ error: "unknown-action" }, 404);
    }
  }

  // ── POST handlers ────────────────────────────────────────────────

  private async handlePost(action: string, request: Request): Promise<Response> {
    switch (action) {
      case "snapshot": {
        const trigger = this.config.providers.triggerSnapshot;
        if (!trigger) {
          return jsonResponse({ error: "control-disabled" }, 501);
        }
        const result = await trigger();
        return jsonResponse(result, 200);
      }
      case "compact": {
        const trigger = this.config.providers.triggerCompact;
        if (!trigger) {
          return jsonResponse({ error: "control-disabled" }, 501);
        }
        const body = await safeReadJson(request);
        const mode =
          body && typeof body === "object" && (body as { mode?: string }).mode === "sync"
            ? "sync"
            : "async";
        const result = await trigger(mode);
        return jsonResponse(result, 200);
      }
      case "restore": {
        const restore = this.config.providers.restoreSnapshot;
        if (!restore) {
          return jsonResponse({ error: "control-disabled" }, 501);
        }
        const body = await safeReadJson(request);
        const snapshotId = (body as { snapshotId?: string } | null)?.snapshotId;
        if (!snapshotId) {
          return jsonResponse({ error: "missing-snapshot-id" }, 400);
        }
        await restore(snapshotId);
        return new Response(null, { status: 204 });
      }
      default:
        return jsonResponse({ error: "unknown-action" }, 404);
    }
  }

  private async buildReport(): Promise<UsageReport> {
    const providers = this.config.providers;
    const usage = await providers.getUsageSnapshot();
    const compactState = await providers.getCompactStateSnapshot();
    const bufferPolicy = await providers.getBufferPolicy();
    const compactPolicy = await providers.getCompactPolicy();
    const snapshots = await providers.getSnapshots();
    const tierRouterMetrics = providers.getTierRouterMetrics
      ? await providers.getTierRouterMetrics()
      : undefined;
    return buildUsageReport({
      usage,
      bufferPolicy,
      compactPolicy,
      snapshots,
      compactState,
      tierRouterMetrics,
      preB6Dedup: this.config.preB6Dedup,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// §2 — Internals
// ═══════════════════════════════════════════════════════════════════

interface InternalSubscription extends StreamSubscription {
  filter: SubscribeFilter;
  sink: Array<{ kind: string; tag?: string; body: unknown }>;
  cancelled: boolean;
}

function matchesFilter(
  filter: SubscribeFilter,
  event: { kind: string; tag?: string },
): boolean {
  if (filter.events && filter.events.length > 0) {
    const matched = filter.events.some((pattern) => matchEventName(pattern, event.kind));
    if (!matched) return false;
  }
  if (filter.tags && filter.tags.length > 0) {
    if (!event.tag) return false;
    if (!filter.tags.includes(event.tag)) return false;
  }
  return true;
}

function matchEventName(pattern: string, name: string): boolean {
  if (pattern === name) return true;
  if (pattern.endsWith("*")) {
    return name.startsWith(pattern.slice(0, -1));
  }
  return false;
}

async function safeReadJson(request: Request): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD") return null;
  try {
    const text = await request.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ═══════════════════════════════════════════════════════════════════
// §3 — route-mount helper
// ═══════════════════════════════════════════════════════════════════

/**
 * Conditional mount helper — worker entry calls
 * `mountInspectorFacade(env, request)` and gets back `null` (skip) or
 * a `Response` (already handled). Default: disabled.
 *
 * Env keys (recognised by the helper; deployment chooses what to set):
 *   - `INSPECTOR_FACADE_ENABLED` ("1" / "true" → enable)
 *   - `INSPECTOR_BEARER_TOKEN`
 *   - `INSPECTOR_IP_ALLOWLIST` (comma-separated CIDR list)
 *
 * Intentionally takes a `facadeFactory` rather than a pre-built
 * facade so the per-session DO can lazily instantiate (one per
 * sessionUuid).
 */
export interface MountInspectorOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly request: Request;
  readonly remoteIp?: string;
  readonly facadeFactory: (sessionUuid: string) => InspectorFacade;
  /**
   * Optional URL-prefix the facade lives under. Default `/inspect/`.
   * The helper checks `pathname.startsWith(prefix)`.
   */
  readonly prefix?: string;
}

export async function mountInspectorFacade(
  options: MountInspectorOptions,
): Promise<Response | null> {
  const env = options.env;
  const enabledRaw = env["INSPECTOR_FACADE_ENABLED"];
  const enabled = enabledRaw === "1" || enabledRaw === "true";
  if (!enabled) return null;

  const url = new URL(options.request.url);
  const prefix = options.prefix ?? "/inspect/";
  if (!url.pathname.startsWith(prefix)) return null;

  const canonicalPrefix = "/inspect/";
  const relativePath = url.pathname.slice(prefix.length);
  const segs = relativePath.split("/").filter(Boolean);
  if (segs.length < 2 || segs[0] !== "sessions") {
    // RHX2 P3-03: unified to FacadeErrorEnvelope.
    const traceUuid = options.request.headers.get("x-trace-uuid") ?? crypto.randomUUID();
    return respondWithFacadeError("not-found", 404, "not-found", traceUuid);
  }
  const sessionUuid = segs[1]!;

  const facade = options.facadeFactory(sessionUuid);
  if (prefix === canonicalPrefix) {
    return facade.handle(options.request, { remoteIp: options.remoteIp });
  }

  const rewrittenUrl = new URL(options.request.url);
  rewrittenUrl.pathname = `${canonicalPrefix}${relativePath}`;
  const rewrittenRequest = new Request(rewrittenUrl, options.request);
  return facade.handle(rewrittenRequest, { remoteIp: options.remoteIp });
}
