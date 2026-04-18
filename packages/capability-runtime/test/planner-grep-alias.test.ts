/**
 * A8 Phase 3 P3-02 — `grep -> rg` narrow alias tests.
 *
 * The alias is intentionally minimal (Q16):
 *   - `grep <pattern> [path]` → `rg <pattern> [path]`
 *   - any `-flag` rejects with a clear "use rg directly" message
 *   - missing pattern rejects with the same vocabulary
 */

import { describe, it, expect } from "vitest";
import { COMMAND_ALIASES, planFromBashCommand } from "../src/planner.js";
import { InMemoryCapabilityRegistry } from "../src/registry.js";
import { registerMinimalCommands } from "../src/fake-bash/commands.js";

function makeRegistry() {
  const r = new InMemoryCapabilityRegistry();
  registerMinimalCommands(r);
  return r;
}

describe("COMMAND_ALIASES", () => {
  it("only ships the grep -> rg mapping in v1", () => {
    expect(Object.keys(COMMAND_ALIASES)).toEqual(["grep"]);
    expect(COMMAND_ALIASES.grep).toBe("rg");
  });
});

describe("planFromBashCommand — grep alias", () => {
  it("rewrites `grep needle` to a canonical rg plan", () => {
    const plan = planFromBashCommand("grep needle", makeRegistry());
    expect(plan).toBeDefined();
    expect(plan!.capabilityName).toBe("rg");
    expect(plan!.input).toEqual({ pattern: "needle", path: "." });
    expect(plan!.source).toBe("bash-command");
    expect(plan!.rawCommand).toBe("grep needle");
  });

  it("accepts an optional path argument", () => {
    const plan = planFromBashCommand("grep foo src/lib.ts", makeRegistry());
    expect(plan!.capabilityName).toBe("rg");
    expect(plan!.input).toEqual({ pattern: "foo", path: "src/lib.ts" });
  });

  it("throws when grep is invoked without a pattern", () => {
    expect(() => planFromBashCommand("grep", makeRegistry())).toThrow(
      /pattern required/,
    );
  });

  it("rejects flag-form usage with a 'use rg directly' message (Q16 narrow)", () => {
    expect(() =>
      planFromBashCommand("grep -i needle file.txt", makeRegistry()),
    ).toThrow(/grep alias is intentionally narrow/);
  });

  it("rejects unsupported `-r` flag form too", () => {
    expect(() =>
      planFromBashCommand("grep -r needle src", makeRegistry()),
    ).toThrow(/grep alias is intentionally narrow/);
  });

  it("does NOT register grep as a separate capability — only rg is canonical", () => {
    const r = makeRegistry();
    expect(r.has("rg")).toBe(true);
    expect(r.has("grep")).toBe(false);
  });
});
