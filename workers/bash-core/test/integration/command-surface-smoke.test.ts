/**
 * Integration: command surface smoke test.
 *
 * Verifies that every command in the allowlist can be planned from a
 * bash-shaped string, and that unsupported/OOM-risk/unknown commands
 * are correctly rejected at the plan layer.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryCapabilityRegistry } from "../../src/registry.js";
import { registerMinimalCommands } from "../../src/fake-bash/commands.js";
import { planFromBashCommand } from "../../src/planner.js";

const ALLOWLIST: Array<{ command: string; sample: string }> = [
  // Original 12-pack
  { command: "pwd", sample: "pwd" },
  { command: "ls", sample: "ls /workspace" },
  { command: "cat", sample: "cat readme.md" },
  { command: "write", sample: "write out.txt hello" },
  { command: "mkdir", sample: "mkdir dir" },
  { command: "rm", sample: "rm file.txt" },
  { command: "mv", sample: "mv a.txt b.txt" },
  { command: "cp", sample: "cp a.txt b.txt" },
  { command: "rg", sample: "rg pattern ." },
  { command: "curl", sample: "curl https://example.com" },
  { command: "ts-exec", sample: "ts-exec console.log(1)" },
  { command: "git", sample: "git status" },
  // B3 wave 1 — text-processing core
  { command: "wc", sample: "wc readme.md" },
  { command: "head", sample: "head readme.md" },
  { command: "tail", sample: "tail readme.md" },
  // jq's bash form is `jq <query> <path>`; pass a `.` query.
  { command: "jq", sample: "jq . data.json" },
  // sed's bash form requires the expression to be a single token; quote
  // it so the parseSimpleCommand picks it up as one argv.
  { command: "sed", sample: 'sed "s/a/b/" notes.txt' },
  // awk's bash form takes a quoted program + path.
  { command: "awk", sample: 'awk "{ print $1 }" data.txt' },
  // B3 wave 2 — text-processing aux
  { command: "sort", sample: "sort lines.txt" },
  { command: "uniq", sample: "uniq lines.txt" },
  { command: "diff", sample: "diff a.txt b.txt" },
];

describe("integration: command surface smoke", () => {
  let registry: InMemoryCapabilityRegistry;

  beforeEach(() => {
    registry = new InMemoryCapabilityRegistry();
    registerMinimalCommands(registry);
  });

  it("registers exactly 21 commands (12 minimal + 9 text-processing per B3)", () => {
    expect(registry.list().length).toBe(21);
  });

  it.each(ALLOWLIST)(
    "plans '$command' from bash-shaped input",
    ({ command, sample }) => {
      const plan = planFromBashCommand(sample, registry);
      expect(plan, `expected plan for "${sample}"`).not.toBeNull();
      expect(plan!.capabilityName).toBe(command);
      expect(plan!.source).toBe("bash-command");
      expect(plan!.rawCommand).toBe(sample);
    },
  );

  it("returns null for unsupported commands at the planner layer", () => {
    // The planner itself doesn't know about unsupported lists — it just
    // checks the registry. Unsupported commands should also not be
    // registered, so they plan as null.
    expect(planFromBashCommand("sudo rm -rf /", registry)).toBeNull();
    expect(planFromBashCommand("docker run", registry)).toBeNull();
    expect(planFromBashCommand("npm install", registry)).toBeNull();
  });

  it("returns null for OOM-risk commands at the planner layer", () => {
    expect(planFromBashCommand("tar -xvf x.tar", registry)).toBeNull();
    expect(planFromBashCommand("gzip file", registry)).toBeNull();
    expect(planFromBashCommand("unzip archive.zip", registry)).toBeNull();
  });

  it("returns null for entirely unknown commands", () => {
    expect(planFromBashCommand("definitely-not-a-tool", registry)).toBeNull();
    expect(planFromBashCommand("xyzzy foo bar", registry)).toBeNull();
  });
});
