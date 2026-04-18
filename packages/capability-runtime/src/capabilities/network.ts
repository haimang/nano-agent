/**
 * Network Capability Handler — A9 Phase 2 restricted `curl` baseline.
 *
 * Q17 bindings (docs/action-plan/after-skeleton/AX-QNA.md):
 *   - The bash path is frozen to `curl <url>` (planner enforces narrow
 *     surface). Any richer option must travel through the structured
 *     capability call.
 *   - The structured schema is `{ url, method?, headers?, body?,
 *     timeoutMs?, maxOutputBytes? }`. Extra/unknown fields are ignored
 *     rather than throwing — future schema versions will add fields,
 *     not remove them.
 *
 * Egress guard (Q17 + P5 security boundary):
 *   - Scheme allow-list = `http`/`https`. Everything else (`file://`,
 *     `ftp://`, `gopher://`, `data:`, ...) is rejected with a typed
 *     `curl-scheme-blocked` marker.
 *   - Host deny-list = `localhost` / `127.0.0.0/8` / `10.0.0.0/8` /
 *     `172.16.0.0/12` / `192.168.0.0/16` / `169.254.0.0/16` (link-local
 *     + cloud metadata) / `0.0.0.0` / `::1` / `fc00::/7` (IPv6 ULA).
 *     Carries a `curl-private-address-blocked` marker.
 *   - Timeout cap = 30 000 ms (`DEFAULT_CURL_TIMEOUT_MS`). Caller may
 *     shrink but not extend it.
 *   - Output cap = 64 KiB (`DEFAULT_CURL_MAX_BYTES`). Larger responses
 *     are truncated with a deterministic marker so the runtime does
 *     not serve as an unbounded inline exfiltration channel.
 *
 * Execution seam:
 *   - By default the handler returns a deterministic `not-connected`
 *     stub so offline tests / prompts see a stable string. Callers can
 *     inject a `fetchImpl` (vitest fake, `globalThis.fetch`, or a
 *     future service-binding worker) to exercise the real network
 *     path. This matches the A9 goal of keeping `local-ts` as the
 *     reference path while preserving the upgrade slot.
 */

import type { LocalCapabilityHandler } from "../targets/local-ts.js";

export const CURL_NOT_CONNECTED_NOTE = "curl-not-connected";
export const CURL_SCHEME_BLOCKED_NOTE = "curl-scheme-blocked";
export const CURL_PRIVATE_ADDRESS_BLOCKED_NOTE = "curl-private-address-blocked";
export const CURL_TIMEOUT_NOTE = "curl-timeout-exceeded";
export const CURL_OUTPUT_TRUNCATED_NOTE = "curl-output-truncated";

/** Hard upper bound for any caller-requested timeout. */
export const DEFAULT_CURL_TIMEOUT_MS = 30_000;
/** Hard upper bound for inline response bytes. */
export const DEFAULT_CURL_MAX_BYTES = 64 * 1024;

const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

export interface CurlStructuredInput {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface CreateNetworkHandlersOptions {
  /**
   * Optional fetch implementation. When omitted the handler returns a
   * deterministic `not-connected` stub — the same shape every test
   * has relied on since v1. Injected fetch MUST be fully controlled
   * by the caller: this handler does not add retries, redirects are
   * followed by the underlying fetch, and caller supplies any auth.
   */
  fetchImpl?: typeof fetch;
  /** Override timeout cap (still hard-capped at `DEFAULT_CURL_TIMEOUT_MS`). */
  maxTimeoutMs?: number;
  /** Override output cap (still hard-capped at `DEFAULT_CURL_MAX_BYTES`). */
  maxOutputBytes?: number;
}

type EgressCheck =
  | { ok: true; target: URL }
  | { ok: false; reason: string };

function checkEgress(raw: string): EgressCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `curl: invalid URL "${raw}"` };
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return {
      ok: false,
      reason: `curl: scheme '${url.protocol}' blocked (${CURL_SCHEME_BLOCKED_NOTE}); only http/https are permitted on the bash + structured surface`,
    };
  }
  if (isPrivateHost(url.hostname)) {
    return {
      ok: false,
      reason: `curl: host '${url.hostname}' blocked (${CURL_PRIVATE_ADDRESS_BLOCKED_NOTE}); localhost / RFC1918 / link-local / ULA / cloud-metadata targets are not permitted`,
    };
  }
  return { ok: true, target: url };
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0") return true;
  if (h === "::1" || h === "[::1]") return true;

  // IPv4 dotted-quad families
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const o1 = Number(m[1]);
    const o2 = Number(m[2]);
    if (o1 === 10) return true;
    if (o1 === 127) return true;
    if (o1 === 0) return true;
    if (o1 === 169 && o2 === 254) return true; // link-local + cloud metadata
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;
    if (o1 === 192 && o2 === 168) return true;
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return true; // CGNAT
  }

  // IPv6 — match ULA (fc00::/7) and loopback prefixes. Strip brackets
  // used in URL form and normalise case.
  const v6 = h.replace(/^\[|\]$/g, "");
  if (v6.startsWith("fc") || v6.startsWith("fd")) return true;
  if (v6 === "::" || v6.startsWith("::1")) return true;
  if (v6.startsWith("fe80")) return true; // IPv6 link-local

  return false;
}

function clampTimeout(requested: number | undefined, cap: number): number {
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) {
    return cap;
  }
  return Math.min(requested, cap);
}

function clampBytes(requested: number | undefined, cap: number): number {
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) {
    return cap;
  }
  return Math.min(requested, cap);
}

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8");

/**
 * A8-A10 review GPT R3 / Kimi R4: `curl` advertises its output cap
 * in **bytes** (see `DEFAULT_CURL_MAX_BYTES = 64 KiB` and the
 * `body truncated at N bytes` disclosure string). The previous
 * implementation measured `body.length` (UTF-16 code units), so a
 * 5-char CJK response would claim `truncated at 4 bytes` while
 * actually emitting 12 bytes.
 *
 * The correct behaviour is to truncate on a UTF-8 **code-point
 * boundary** with the resulting byte length ≤ cap, so that the
 * returned string is valid UTF-8 AND re-encodes within the declared
 * cap (no replacement-character inflation).
 */
function truncateBody(
  body: string,
  cap: number,
): { body: string; truncated: boolean } {
  const encoded = TEXT_ENCODER.encode(body);
  if (encoded.byteLength <= cap) return { body, truncated: false };
  // Walk backwards from `cap` to find the nearest UTF-8 start byte.
  // A UTF-8 start byte is anything that is NOT a continuation byte
  // (continuation bytes match `0b10xx_xxxx`, i.e. `(byte & 0xC0) ===
  // 0x80`). This guarantees the slice ends on a complete code point.
  let end = cap;
  while (end > 0 && (encoded[end]! & 0xC0) === 0x80) {
    end -= 1;
  }
  const clipped = encoded.slice(0, end);
  return { body: TEXT_DECODER.decode(clipped), truncated: true };
}

/**
 * Create the network capability handler.
 *
 * When `fetchImpl` is supplied the handler performs a real request
 * under the egress guard and output cap. When omitted it returns the
 * deterministic `not-connected` stub so offline smoke tests keep
 * passing.
 */
export function createNetworkHandlers(
  options: CreateNetworkHandlersOptions = {},
): Map<string, LocalCapabilityHandler> {
  const handlers = new Map<string, LocalCapabilityHandler>();
  const timeoutCap = clampTimeout(options.maxTimeoutMs, DEFAULT_CURL_TIMEOUT_MS);
  const bytesCap = clampBytes(options.maxOutputBytes, DEFAULT_CURL_MAX_BYTES);

  handlers.set("curl", async (input) => {
    const raw = (input ?? {}) as Partial<CurlStructuredInput>;
    const url = typeof raw.url === "string" ? raw.url.trim() : "";

    if (!url) {
      throw new Error("curl: no URL provided");
    }

    const egress = checkEgress(url);
    if (!egress.ok) {
      throw new Error(egress.reason);
    }

    const timeout = clampTimeout(raw.timeoutMs, timeoutCap);
    const outputCap = clampBytes(raw.maxOutputBytes, bytesCap);
    const method = typeof raw.method === "string" && raw.method.length > 0
      ? raw.method.toUpperCase()
      : "GET";

    if (!options.fetchImpl) {
      return {
        output: `[curl] ${method} ${egress.target.toString()} (${CURL_NOT_CONNECTED_NOTE}: network not yet connected; supply fetchImpl or wait for the remote tool-runner)`,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response: Response;
    try {
      response = await options.fetchImpl(egress.target.toString(), {
        method,
        headers: raw.headers,
        body: raw.body,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const reason = err instanceof Error ? err.message : String(err);
      if (controller.signal.aborted) {
        throw new Error(
          `curl: timeout ${timeout}ms exceeded (${CURL_TIMEOUT_NOTE})`,
        );
      }
      throw new Error(`curl: fetch failed: ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    const { body, truncated } = truncateBody(text, outputCap);
    const status = `${response.status} ${response.statusText}`.trim();
    const suffix = truncated
      ? ` (${CURL_OUTPUT_TRUNCATED_NOTE}: body truncated at ${outputCap} bytes)`
      : "";
    return {
      output: `[curl] ${method} ${egress.target.toString()} -> ${status}${suffix}\n${body}`,
    };
  });

  return handlers;
}
