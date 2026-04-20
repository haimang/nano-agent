/**
 * Context-Management — inspector-facade auth helpers.
 *
 * Bearer token + IP allow-list. Everything is opt-in: the default
 * config (no bearer, no allow-list) accepts every request. Worker
 * entry MUST configure both fields in production environments.
 *
 * IPv4 CIDR matching is implemented in pure TS (no Node-only
 * dependencies). IPv6 CIDR is intentionally **not** supported in B4 —
 * production deployments that need IPv6 should use an upstream proxy
 * for IP gating until the worker matrix phase.
 */

import {
  INSPECTOR_HEADER_BEARER,
  INSPECTOR_HEADER_IP_BYPASS,
  type InspectorAuthConfig,
} from "./types.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Bearer
// ═══════════════════════════════════════════════════════════════════

/**
 * Extracts the bearer token from a request. Accepts both
 * `Authorization: Bearer <token>` and the lowercase
 * `x-inspector-bearer: <token>` header (per binding-F02 lowercase
 * convention).
 */
export function parseBearer(headers: Headers | Record<string, string>): string | undefined {
  const get = (key: string): string | undefined => {
    if (headers instanceof Headers) {
      return headers.get(key) ?? undefined;
    }
    // Plain object: callers MUST already lowercase keys to align with
    // binding-F02. We do not auto-lower here so type drift is visible.
    return headers[key];
  };
  const x = get(INSPECTOR_HEADER_BEARER);
  if (x) return x.trim();
  const auth = get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return undefined;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — IP allow-list (IPv4)
// ═══════════════════════════════════════════════════════════════════

/**
 * Returns `true` if `ip` matches any rule in `allowlist`. Each rule
 * is either an exact IPv4 (e.g. `203.0.113.1`) or a CIDR
 * (e.g. `10.0.0.0/8`). Non-IPv4 inputs return `false`.
 */
export function isIpAllowed(
  ip: string,
  allowlist: ReadonlyArray<string> | undefined,
): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  const ipNum = ipv4ToNumber(ip);
  if (ipNum === undefined) return false;
  for (const rule of allowlist) {
    if (rule.includes("/")) {
      const [base, bitsStr] = rule.split("/");
      const baseNum = ipv4ToNumber(base ?? "");
      const bits = Number.parseInt(bitsStr ?? "", 10);
      if (baseNum === undefined || !Number.isFinite(bits) || bits < 0 || bits > 32) {
        continue;
      }
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      if ((ipNum & mask) === (baseNum & mask)) return true;
    } else if (rule === ip) {
      return true;
    }
  }
  return false;
}

function ipv4ToNumber(ip: string): number | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return undefined;
  const o1 = Number(m[1]);
  const o2 = Number(m[2]);
  const o3 = Number(m[3]);
  const o4 = Number(m[4]);
  if ([o1, o2, o3, o4].some((n) => n < 0 || n > 255)) return undefined;
  return ((o1 << 24) | (o2 << 16) | (o3 << 8) | o4) >>> 0;
}

// ═══════════════════════════════════════════════════════════════════
// §3 — Combined check
// ═══════════════════════════════════════════════════════════════════

export interface AuthOutcome {
  readonly ok: boolean;
  readonly status: number;
  readonly reason?: string;
}

export function checkAuth(args: {
  config: InspectorAuthConfig | undefined;
  headers: Headers | Record<string, string>;
  remoteIp?: string;
}): AuthOutcome {
  const config = args.config;
  if (!config) return { ok: true, status: 200 };

  if (config.bearerToken) {
    const supplied = parseBearer(args.headers);
    if (!supplied) {
      return { ok: false, status: 401, reason: "missing-bearer" };
    }
    if (supplied !== config.bearerToken) {
      return { ok: false, status: 401, reason: "invalid-bearer" };
    }
  }

  if (config.ipAllowlist && config.ipAllowlist.length > 0) {
    const headers = args.headers;
    const bypass =
      config.allowDevBypassHeader === true &&
      ((headers instanceof Headers
        ? headers.get(INSPECTOR_HEADER_IP_BYPASS)
        : headers[INSPECTOR_HEADER_IP_BYPASS]) ?? "") === "1";
    if (!bypass) {
      if (!args.remoteIp) {
        return { ok: false, status: 403, reason: "missing-remote-ip" };
      }
      if (!isIpAllowed(args.remoteIp, config.ipAllowlist)) {
        return { ok: false, status: 403, reason: "ip-not-allowed" };
      }
    }
  }
  return { ok: true, status: 200 };
}
