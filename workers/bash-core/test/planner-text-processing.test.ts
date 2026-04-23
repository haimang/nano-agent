/**
 * B3 — planner mappings + bash-narrow surface for the 9 text-processing
 * commands (`wc / head / tail / jq / sed / awk / sort / uniq / diff`).
 *
 * Verifies:
 *   1. argv → structured input mapping for each command;
 *   2. bash path is file/path-first — every leading `-flag` is rejected
 *      with the `text-processing-bash-narrow-use-structured` marker;
 *   3. the registry recognises every new command (no `null` plan).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  planFromBashCommand,
  TEXT_PROCESSING_BASH_NARROW_NOTE,
} from "../src/planner.js";
import { InMemoryCapabilityRegistry } from "../src/registry.js";
import { registerMinimalCommands } from "../src/fake-bash/commands.js";

describe("planner — B3 text-processing argv → structured input", () => {
  let registry: InMemoryCapabilityRegistry;
  beforeEach(() => {
    registry = new InMemoryCapabilityRegistry();
    registerMinimalCommands(registry);
  });

  it("maps `wc <path>` to { path }", () => {
    const plan = planFromBashCommand("wc readme.md", registry);
    expect(plan).not.toBeNull();
    expect(plan!.capabilityName).toBe("wc");
    expect(plan!.input).toEqual({ path: "readme.md" });
  });

  it("maps `head <path>` to { path } (no flags via bash)", () => {
    const plan = planFromBashCommand("head readme.md", registry);
    expect(plan!.input).toEqual({ path: "readme.md" });
  });

  it("maps `tail <path>` to { path }", () => {
    const plan = planFromBashCommand("tail readme.md", registry);
    expect(plan!.input).toEqual({ path: "readme.md" });
  });

  it("maps `jq <query> <path>` to { query, path }", () => {
    const plan = planFromBashCommand("jq .field data.json", registry);
    expect(plan!.input).toEqual({ query: ".field", path: "data.json" });
  });

  it("maps `sed <expr> <path>` (quoted expression) to { expression, path }", () => {
    const plan = planFromBashCommand('sed "s/a/b/g" notes.txt', registry);
    expect(plan!.input).toEqual({ expression: "s/a/b/g", path: "notes.txt" });
  });

  it("maps `awk <program> <path>` (quoted program) to { program, path }", () => {
    const plan = planFromBashCommand('awk "{ print $1 }" data.txt', registry);
    expect(plan!.input).toEqual({
      program: "{ print $1 }",
      path: "data.txt",
    });
  });

  it("joins trailing tokens for awk when the program was unquoted", () => {
    // Without quotes the lexer splits the program tokens; planner joins
    // everything except the final positional file path.
    const plan = planFromBashCommand("awk { print $1 } data.txt", registry);
    expect(plan!.input).toEqual({
      program: "{ print $1 }",
      path: "data.txt",
    });
  });

  it("maps `sort <path>` to { path }", () => {
    const plan = planFromBashCommand("sort lines.txt", registry);
    expect(plan!.input).toEqual({ path: "lines.txt" });
  });

  it("maps `uniq <path>` to { path }", () => {
    const plan = planFromBashCommand("uniq lines.txt", registry);
    expect(plan!.input).toEqual({ path: "lines.txt" });
  });

  it("maps `diff <left> <right>` to { left, right }", () => {
    const plan = planFromBashCommand("diff a.txt b.txt", registry);
    expect(plan!.input).toEqual({ left: "a.txt", right: "b.txt" });
  });
});

describe("planner — B3 bash-narrow surface for text-processing commands", () => {
  let registry: InMemoryCapabilityRegistry;
  beforeEach(() => {
    registry = new InMemoryCapabilityRegistry();
    registerMinimalCommands(registry);
  });

  const TEXT_CMDS = ["wc", "head", "tail", "jq", "sed", "awk", "sort", "uniq", "diff"] as const;

  it.each(TEXT_CMDS)(
    "%s rejects leading -flag with TEXT_PROCESSING_BASH_NARROW_NOTE marker",
    (cmd) => {
      // For 2-arg commands jq/sed/awk/diff we still want the flag at
      // the head position to trip the rule.
      const sample = cmd === "diff" ? `${cmd} -u a b` : `${cmd} -n file.txt`;
      expect(() => planFromBashCommand(sample, registry)).toThrow(
        new RegExp(TEXT_PROCESSING_BASH_NARROW_NOTE),
      );
    },
  );

  it.each(TEXT_CMDS)(
    "%s rejects when no positional argument is given",
    (cmd) => {
      expect(() => planFromBashCommand(cmd, registry)).toThrow(
        /argument required|TEXT_PROCESSING_BASH_NARROW|text-processing-bash-narrow-use-structured/,
      );
    },
  );

  it("does NOT trip the bash-narrow rule for the original 12-pack curl/ts-exec/git", () => {
    expect(() => planFromBashCommand("curl https://example.com", registry)).not.toThrow();
    expect(() => planFromBashCommand("ts-exec console.log(1)", registry)).not.toThrow();
    expect(() => planFromBashCommand("git status", registry)).not.toThrow();
  });
});
