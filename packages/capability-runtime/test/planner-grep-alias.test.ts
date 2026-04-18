/**
 * A8 Phase 3 P3-02 — `grep -> rg` narrow alias tests.
 *
 * The alias is intentionally minimal (AX-QNA Q16 owner-final answer):
 *   - `grep <pattern> [path]` → `rg <pattern> [path]`
 *   - `-i` (case-insensitive) and `-n` (line numbers) are accepted
 *     per Q16; every other `-flag` rejects with a clear "use rg
 *     directly" message
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
    expect(plan!.input).toEqual({
      pattern: "needle",
      path: ".",
      caseInsensitive: false,
      lineNumbers: false,
    });
    expect(plan!.source).toBe("bash-command");
    expect(plan!.rawCommand).toBe("grep needle");
  });

  it("accepts an optional path argument", () => {
    const plan = planFromBashCommand("grep foo src/lib.ts", makeRegistry());
    expect(plan!.capabilityName).toBe("rg");
    expect(plan!.input).toEqual({
      pattern: "foo",
      path: "src/lib.ts",
      caseInsensitive: false,
      lineNumbers: false,
    });
  });

  it("throws when grep is invoked without a pattern", () => {
    expect(() => planFromBashCommand("grep", makeRegistry())).toThrow(
      /pattern required/,
    );
  });

  // A8-A10 review GPT R1: AX-QNA Q16 owner-final answer accepts -i and -n.
  it("accepts `-i` (case-insensitive) per Q16 owner-final answer", () => {
    const plan = planFromBashCommand("grep -i needle file.txt", makeRegistry());
    expect(plan!.capabilityName).toBe("rg");
    expect(plan!.input).toEqual({
      pattern: "needle",
      path: "file.txt",
      caseInsensitive: true,
      lineNumbers: false,
    });
  });

  it("accepts `-n` (line numbers) per Q16 owner-final answer", () => {
    const plan = planFromBashCommand("grep -n needle src", makeRegistry());
    expect(plan!.input).toEqual({
      pattern: "needle",
      path: "src",
      caseInsensitive: false,
      lineNumbers: true,
    });
  });

  it("accepts combined `-i` and `-n` in either order", () => {
    const planA = planFromBashCommand("grep -i -n NEEDLE src", makeRegistry());
    const planB = planFromBashCommand("grep -n -i NEEDLE src", makeRegistry());
    expect(planA!.input).toEqual(planB!.input);
    expect(planA!.input).toMatchObject({
      caseInsensitive: true,
      lineNumbers: true,
    });
  });

  it("rejects `-r` as still out of scope (Q16 narrow)", () => {
    expect(() =>
      planFromBashCommand("grep -r needle src", makeRegistry()),
    ).toThrow(/grep alias is intentionally narrow/);
  });

  it("rejects other flags like `-A2` / `-E` / `-l`", () => {
    for (const bad of ["-A2", "-E", "-l"]) {
      expect(() =>
        planFromBashCommand(`grep ${bad} needle src`, makeRegistry()),
      ).toThrow(/grep alias is intentionally narrow/);
    }
  });

  it("does NOT register grep as a separate capability — only rg is canonical", () => {
    const r = makeRegistry();
    expect(r.has("rg")).toBe(true);
    expect(r.has("grep")).toBe(false);
  });
});
