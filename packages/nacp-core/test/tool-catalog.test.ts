// HP8 P4-01 — tool catalog SSoT tests.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.9 HP8
//   * docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md §7 F4
//   * docs/design/hero-to-pro/HPX-qna.md Q26

import { describe, it, expect } from "vitest";
import {
  TOOL_CATALOG,
  TOOL_CATALOG_IDS,
  findToolEntry,
} from "../src/tools/tool-catalog.js";

describe("HP8 tool catalog", () => {
  it("exposes at least the bash tool entry", () => {
    expect(TOOL_CATALOG_IDS).toContain("bash");
  });

  it("every entry binds to a known capability owner", () => {
    const allowed = new Set(["bash-core", "filesystem-core", "workspace-runtime"]);
    for (const entry of TOOL_CATALOG) {
      expect(allowed.has(entry.capability_owner)).toBe(true);
    }
  });

  it("every entry has a non-empty binding_key + description + stable_id", () => {
    for (const entry of TOOL_CATALOG) {
      expect(entry.binding_key.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.stable_id.length).toBeGreaterThan(0);
    }
  });

  it("tool ids are unique", () => {
    const ids = TOOL_CATALOG.map((e) => e.tool_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("findToolEntry returns null for unknown tool ids (not a fallback)", () => {
    expect(findToolEntry("ghost-tool")).toBeNull();
  });

  it("findToolEntry locates a known tool", () => {
    const entry = findToolEntry("bash");
    expect(entry?.binding_key).toBe("BASH_CORE");
  });

  it("TOOL_CATALOG and TOOL_CATALOG_IDS are frozen (Q26: no second registry)", () => {
    expect(Object.isFrozen(TOOL_CATALOG)).toBe(true);
    expect(Object.isFrozen(TOOL_CATALOG_IDS)).toBe(true);
  });
});
