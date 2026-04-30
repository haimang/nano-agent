/**
 * RHX2 P2-03 — server registry ↔ client meta parity.
 *
 * Asserts that `error-registry-client/data.ts` (consumed by web +
 * WeChat mini-program) is a faithful subset of the server registry:
 *   - every client meta entry corresponds to a real server registry code;
 *   - http_status + retryable match exactly;
 *   - server categories map to client categories per the documented rules;
 *   - the client table is the SAME size as the server registry (no
 *     hidden codes; client and server agree on what codes exist).
 */

import { describe, it, expect } from "vitest";

import { listErrorMetas } from "../../src/error-registry.js";
import {
  listClientErrorMetas,
  getErrorMeta,
} from "../../src/error-registry-client/index.js";

describe("error-codes-client mirror of server registry", () => {
  it("client list has the same size as server registry", () => {
    const server = listErrorMetas();
    const client = listClientErrorMetas();
    expect(client.length).toBe(server.length);
  });

  it("every server code is reachable from getErrorMeta()", () => {
    const missing: string[] = [];
    for (const m of listErrorMetas()) {
      if (!getErrorMeta(m.code)) missing.push(m.code);
    }
    expect(missing).toEqual([]);
  });

  it("http_status + retryable match between server and client meta", () => {
    const drift: string[] = [];
    for (const s of listErrorMetas()) {
      const c = getErrorMeta(s.code);
      if (!c) {
        drift.push(`[client-missing] ${s.code}`);
        continue;
      }
      if (c.http_status !== s.http_status) {
        drift.push(`[http_status] ${s.code}: server=${s.http_status} client=${c.http_status}`);
      }
      if (c.retryable !== s.retryable) {
        drift.push(`[retryable] ${s.code}: server=${s.retryable} client=${c.retryable}`);
      }
    }
    expect(drift).toEqual([]);
  });

  it("client category enum stays in the documented 8-class set", () => {
    const allowed = new Set([
      "auth.expired",
      "quota.exceeded",
      "runtime.error",
      "request.error",
      "validation.failed",
      "security.denied",
      "dependency.unavailable",
      "conflict.state",
    ]);
    const offenders: string[] = [];
    for (const m of listClientErrorMetas()) {
      if (!allowed.has(m.category)) offenders.push(`${m.code}:${m.category}`);
    }
    expect(offenders).toEqual([]);
  });

  it("auth-flavoured server codes map to auth.expired client class", () => {
    const authFlavoured = [
      "invalid-auth",
      "password-mismatch",
      "refresh-invalid",
      "refresh-expired",
      "refresh-revoked",
    ];
    for (const code of authFlavoured) {
      const c = getErrorMeta(code);
      expect(c).toBeDefined();
      expect(c?.category).toBe("auth.expired");
    }
  });

  it("quota server codes map to quota.exceeded client class", () => {
    expect(getErrorMeta("rate-limited")?.category).toBe("quota.exceeded");
    expect(getErrorMeta("NACP_RATE_LIMITED")?.category).toBe("quota.exceeded");
    expect(getErrorMeta("NACP_TENANT_QUOTA_EXCEEDED")?.category).toBe("quota.exceeded");
    expect(getErrorMeta("llm-rate-limit")?.category).toBe("quota.exceeded");
  });
});
