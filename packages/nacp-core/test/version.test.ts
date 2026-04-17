import { describe, it, expect } from "vitest";
import { NACP_VERSION, NACP_VERSION_COMPAT, cmpSemver } from "../src/version.js";

describe("version constants", () => {
  it("NACP_VERSION is valid semver", () => {
    expect(NACP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("NACP_VERSION_COMPAT is valid semver", () => {
    expect(NACP_VERSION_COMPAT).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("NACP_VERSION >= NACP_VERSION_COMPAT", () => {
    expect(cmpSemver(NACP_VERSION, NACP_VERSION_COMPAT)).toBeGreaterThanOrEqual(0);
  });
});

describe("cmpSemver", () => {
  it("returns 0 for equal versions", () => {
    expect(cmpSemver("1.0.0", "1.0.0")).toBe(0);
    expect(cmpSemver("2.3.4", "2.3.4")).toBe(0);
  });

  it("returns -1 when a < b", () => {
    expect(cmpSemver("0.9.0", "1.0.0")).toBe(-1);
    expect(cmpSemver("1.0.0", "1.0.1")).toBe(-1);
    expect(cmpSemver("1.0.0", "1.1.0")).toBe(-1);
    expect(cmpSemver("1.0.0", "2.0.0")).toBe(-1);
  });

  it("returns 1 when a > b", () => {
    expect(cmpSemver("1.0.0", "0.9.0")).toBe(1);
    expect(cmpSemver("1.0.1", "1.0.0")).toBe(1);
    expect(cmpSemver("1.1.0", "1.0.0")).toBe(1);
    expect(cmpSemver("2.0.0", "1.0.0")).toBe(1);
  });
});
