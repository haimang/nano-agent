/**
 * A10 Phase 4 P4-01 — inventory / registry / taxonomy drift guard.
 *
 * The 12-command minimal pack, the `UNSUPPORTED_COMMANDS` taxonomy,
 * the `OOM_RISK_COMMANDS` taxonomy, the `ask-gated` policy set, and
 * the `git` subset are the five pieces of capability truth that MUST
 * stay pinned. Any drift — adding a command, flipping a policy,
 * demoting a surface — must force an explicit update to this fixture
 * (and therefore to `docs/design/after-skeleton/PX-capability-inventory.md`
 * in the same PR).
 *
 * This is the single enforcement point Q19 refers to when it asks
 * that "prompt / registry / inventory never diverge". If this test
 * fires, PX inventory needs to be updated in lockstep — otherwise
 * reviewers must refuse the PR.
 */

import { describe, it, expect } from "vitest";
import {
  InMemoryCapabilityRegistry,
  registerMinimalCommands,
  getMinimalCommandDeclarations,
  getAskGatedCommands,
  getAllowGatedCommands,
  UNSUPPORTED_COMMANDS,
  OOM_RISK_COMMANDS,
  GIT_SUPPORTED_SUBCOMMANDS,
} from "../src/index.js";

const EXPECTED_COMMAND_ORDER: readonly string[] = [
  "pwd", "ls", "cat", "write", "mkdir", "rm", "mv", "cp",
  "rg", "curl", "ts-exec", "git",
];

const EXPECTED_POLICY: Record<string, "allow" | "ask" | "deny"> = {
  pwd: "allow",
  ls: "allow",
  cat: "allow",
  write: "ask",
  mkdir: "ask",
  rm: "ask",
  mv: "ask",
  cp: "ask",
  rg: "allow",
  curl: "ask",
  "ts-exec": "ask",
  git: "allow",
};

const EXPECTED_UNSUPPORTED: readonly string[] = [
  // package managers + host interpreters
  "apt", "apt-get", "npm", "npx", "yarn", "pnpm", "pip", "pip3",
  "python", "python3", "node", "nodejs", "bash", "sh", "zsh", "deno", "bun",
  // privilege / OS
  "sudo", "su", "chmod", "chown", "chgrp",
  // containers / lifecycle / disk
  "docker", "docker-compose", "podman",
  "systemctl", "service", "journalctl",
  "mount", "umount", "fdisk", "mkfs", "dd",
  "kill", "killall",
  "reboot", "shutdown", "poweroff",
  "iptables", "ufw",
  // remote / transfer
  "ssh", "scp", "rsync", "wget",
  // scheduling / users
  "crontab", "useradd", "userdel", "passwd", "groupadd",
];

const EXPECTED_OOM_RISK: readonly string[] = [
  "tar", "gzip", "gunzip", "zcat", "zip", "unzip", "bzip2", "xz",
];

describe("capability inventory drift guard (A10 Q19)", () => {
  it("minimal command registry holds exactly the frozen 12-pack in the canonical order", () => {
    const decls = getMinimalCommandDeclarations();
    expect(decls.map((d) => d.name)).toEqual(EXPECTED_COMMAND_ORDER);
  });

  it("registerMinimalCommands() registers every command and nothing else", () => {
    const r = new InMemoryCapabilityRegistry();
    registerMinimalCommands(r);
    const registered = r.list().map((d) => d.name).sort();
    expect(registered).toEqual([...EXPECTED_COMMAND_ORDER].sort());
  });

  it("every command has its frozen policy (allow / ask)", () => {
    const decls = getMinimalCommandDeclarations();
    for (const decl of decls) {
      expect(decl.policy).toBe(EXPECTED_POLICY[decl.name]);
    }
  });

  it("ask-gated set matches the PX inventory truth table", () => {
    const ask = [...getAskGatedCommands()].sort();
    const expected = Object.entries(EXPECTED_POLICY)
      .filter(([, p]) => p === "ask")
      .map(([n]) => n)
      .sort();
    expect(ask).toEqual(expected);
  });

  it("allow-gated set matches the PX inventory truth table", () => {
    const allow = [...getAllowGatedCommands()].sort();
    const expected = Object.entries(EXPECTED_POLICY)
      .filter(([, p]) => p === "allow")
      .map(([n]) => n)
      .sort();
    expect(allow).toEqual(expected);
  });

  it("UNSUPPORTED_COMMANDS matches the frozen taxonomy", () => {
    expect([...UNSUPPORTED_COMMANDS].sort()).toEqual(
      [...EXPECTED_UNSUPPORTED].sort(),
    );
  });

  it("OOM_RISK_COMMANDS matches the frozen taxonomy", () => {
    expect([...OOM_RISK_COMMANDS].sort()).toEqual(
      [...EXPECTED_OOM_RISK].sort(),
    );
  });

  it("UNSUPPORTED_COMMANDS and OOM_RISK_COMMANDS are disjoint (Q19 orthogonal taxonomy)", () => {
    for (const u of UNSUPPORTED_COMMANDS) {
      expect(OOM_RISK_COMMANDS.has(u)).toBe(false);
    }
  });

  it("no minimal command is in the unsupported or oom-risk sets", () => {
    for (const name of EXPECTED_COMMAND_ORDER) {
      expect(UNSUPPORTED_COMMANDS.has(name)).toBe(false);
      expect(OOM_RISK_COMMANDS.has(name)).toBe(false);
    }
  });

  it("git subset is frozen to [status, diff, log] (Q18)", () => {
    expect([...GIT_SUPPORTED_SUBCOMMANDS]).toEqual(["status", "diff", "log"]);
  });
});
