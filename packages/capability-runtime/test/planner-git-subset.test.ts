/**
 * A10 Phase 2 P2-02 — `git` subset validator is shared between the
 * bash and structured paths.
 *
 * This test lives at the planner layer because the bash path is the
 * only one where an LLM can smuggle a `git add` past the registry.
 * Both assertions together form the `single source of truth for the
 * v1 git subset` guarantee promised in Q18.
 */

import { describe, it, expect } from "vitest";
import { planFromBashCommand, planFromToolCall } from "../src/planner.js";
import { InMemoryCapabilityRegistry } from "../src/registry.js";
import { registerMinimalCommands } from "../src/fake-bash/commands.js";
import { GIT_SUBCOMMAND_BLOCKED_NOTE } from "../src/capabilities/vcs.js";

function makeRegistry() {
  const r = new InMemoryCapabilityRegistry();
  registerMinimalCommands(r);
  return r;
}

describe("planner — git subset (A10 Q18)", () => {
  it("accepts bash `git status` and maps to the canonical { subcommand, args }", () => {
    const plan = planFromBashCommand("git status", makeRegistry());
    expect(plan?.capabilityName).toBe("git");
    expect(plan?.input).toEqual({ subcommand: "status", args: [] });
  });

  it("accepts bash `git diff path/to/file`", () => {
    const plan = planFromBashCommand("git diff src/app.ts", makeRegistry());
    expect(plan?.input).toEqual({ subcommand: "diff", args: ["src/app.ts"] });
  });

  it("accepts bash `git log -5` — arg tokens pass through (handler does the work)", () => {
    const plan = planFromBashCommand("git log -5", makeRegistry());
    expect(plan?.input).toEqual({ subcommand: "log", args: ["-5"] });
  });

  it("rejects bash `git` without a subcommand", () => {
    expect(() => planFromBashCommand("git", makeRegistry())).toThrow(
      /subcommand required/,
    );
  });

  it("rejects bash `git add foo.txt` at the planner with the blocked marker", () => {
    expect(() =>
      planFromBashCommand("git add foo.txt", makeRegistry()),
    ).toThrow(new RegExp(GIT_SUBCOMMAND_BLOCKED_NOTE));
  });

  it("rejects every mutating subcommand at the bash planner layer", () => {
    const forbidden = [
      "commit", "restore", "branch", "checkout", "merge", "rebase",
      "reset", "push", "pull", "fetch", "clone", "tag", "stash",
    ];
    const reg = makeRegistry();
    for (const sub of forbidden) {
      expect(() => planFromBashCommand(`git ${sub}`, reg)).toThrow(
        new RegExp(GIT_SUBCOMMAND_BLOCKED_NOTE),
      );
    }
  });

  it("structured path accepts the same canonical shape as bash", () => {
    const plan = planFromToolCall(
      "git",
      { subcommand: "status", args: [] },
      makeRegistry(),
    );
    expect(plan?.capabilityName).toBe("git");
    expect(plan?.input).toEqual({ subcommand: "status", args: [] });
  });

  it("structured path does NOT enforce subset at planner layer — that's the handler's job", () => {
    // Structured callers are assumed to be programmatic, and the
    // handler enforces GIT_SUPPORTED_SUBCOMMANDS with the same typed
    // marker. Planner stays thin so external validators (schema,
    // hook, UI) can inspect the raw plan before execution.
    const plan = planFromToolCall(
      "git",
      { subcommand: "add", args: ["x"] },
      makeRegistry(),
    );
    expect(plan?.capabilityName).toBe("git");
    expect(plan?.input).toEqual({ subcommand: "add", args: ["x"] });
  });
});
