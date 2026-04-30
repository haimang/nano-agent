/**
 * P1-02 unit tests — error-registry-client sub-module (Phase 1 seed).
 * RHX2 design §7.3 requires ≥3 cases. Phase 2 (P2-03) adds a CI mirror
 * test that asserts equivalence with the server `listErrorMetas()`.
 */

import { describe, it, expect } from "vitest";

import {
  getErrorMeta,
  classifyByStatus,
  listClientErrorMetas,
} from "../../src/error-registry-client/index.js";

describe("getErrorMeta — known + unknown codes", () => {
  it("[case 1] known FacadeErrorCode hits", () => {
    const meta = getErrorMeta("rate-limited");
    expect(meta).toBeDefined();
    expect(meta?.category).toBe("quota.exceeded");
    expect(meta?.http_status).toBe(429);
    expect(meta?.retryable).toBe(true);
  });

  it("[case 2] unknown code returns undefined", () => {
    expect(getErrorMeta("never-defined")).toBeUndefined();
    expect(getErrorMeta(null)).toBeUndefined();
    expect(getErrorMeta(undefined)).toBeUndefined();
    expect(getErrorMeta("")).toBeUndefined();
  });

  it("[case 3] classifyByStatus returns the legacy 4-class result", () => {
    expect(classifyByStatus(401)).toBe("auth.expired");
    expect(classifyByStatus(429)).toBe("quota.exceeded");
    expect(classifyByStatus(503)).toBe("runtime.error");
    expect(classifyByStatus(400)).toBe("request.error");
  });

  it("[case 4] every entry from listClientErrorMetas() round-trips through getErrorMeta()", () => {
    for (const m of listClientErrorMetas()) {
      const recovered = getErrorMeta(m.code);
      expect(recovered).toEqual(m);
    }
  });

  it("[case 5] FacadeErrorCode coverage is 30+ (kebab-case codes excluding ad-hoc bash codes)", () => {
    // Sanity guard: if someone deletes Facade entries the test fails.
    const facadeLikeCount = listClientErrorMetas().filter(
      (m) =>
        /^[a-z][a-z0-9-]+$/.test(m.code) &&
        !m.code.startsWith("NACP_") &&
        !m.code.startsWith("llm-"),
    ).length;
    expect(facadeLikeCount).toBeGreaterThanOrEqual(30);
  });
});
