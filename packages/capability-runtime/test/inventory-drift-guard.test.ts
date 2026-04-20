/**
 * A10 Phase 4 P4-01 — inventory / registry / taxonomy drift guard.
 *
 * The minimal command pack (B3 expansion: 12 → 21), the
 * `UNSUPPORTED_COMMANDS` taxonomy, the `OOM_RISK_COMMANDS` taxonomy,
 * the `ask-gated` policy set, and the `git` subset are the five
 * pieces of capability truth that MUST stay pinned. Any drift —
 * adding a command, flipping a policy, demoting a surface — must
 * force an explicit update to this fixture (and therefore to
 * `docs/design/after-skeleton/PX-capability-inventory.md` in the
 * same PR).
 *
 * A8-A10 review GPT R4 upgrade: the test now ALSO parses PX §7.1 from
 * the real `PX-capability-inventory.md` file and asserts that the
 * table's row order and policy column match the code's canonical
 * order and policy map. This is what closes the GPT R4 loop: "code
 * changed without docs updated" and "docs changed without code
 * updated" now BOTH fail CI.
 *
 * B3 (After-Foundations Phase 2) extension: the canonical order
 * grows by 9 — `wc / head / tail / jq / sed / awk / sort / uniq /
 * diff` are appended after `git` to keep the existing
 * 12-pack section unchanged.
 *
 * This is the single enforcement point Q19 refers to when it asks
 * that "prompt / registry / inventory never diverge". If this test
 * fires, PX inventory needs to be updated in lockstep — otherwise
 * reviewers must refuse the PR.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PX_INVENTORY_PATH = resolve(
  __dirname,
  "../../..",
  "docs/design/after-skeleton/PX-capability-inventory.md",
);

const EXPECTED_COMMAND_ORDER: readonly string[] = [
  // Original 12-pack (A8/A9/A10 baseline)
  "pwd", "ls", "cat", "write", "mkdir", "rm", "mv", "cp",
  "rg", "curl", "ts-exec", "git",
  // B3 wave 1 — text-processing core
  "wc", "head", "tail", "jq", "sed", "awk",
  // B3 wave 2 — text-processing aux
  "sort", "uniq", "diff",
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
  // B3 wave 1 + 2: all 9 are pure-function read-only over workspace
  // files, no writes, no network → policy: allow.
  wc: "allow",
  head: "allow",
  tail: "allow",
  jq: "allow",
  sed: "allow",
  awk: "allow",
  sort: "allow",
  uniq: "allow",
  diff: "allow",
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

describe("capability inventory drift guard (A10 Q19 + B3 expansion)", () => {
  it("minimal command registry holds exactly the frozen 21-pack in the canonical order (B3)", () => {
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

// ────────────────────────────────────────────────────────────────
// A8-A10 review GPT R4 — PX-capability-inventory §7.1 docs guard
// ────────────────────────────────────────────────────────────────

interface PxInventoryRow {
  readonly name: string;
  readonly policy: "allow" | "ask" | "deny";
}

/**
 * Parse the `### 7.1 Command Inventory` markdown table out of
 * `PX-capability-inventory.md`. Returns rows in document order so
 * callers can assert positional equality against the code's
 * canonical order. Intentionally forgiving about extra whitespace
 * and header-column variation so trivial formatting edits don't
 * break CI — the check that matters is `(name, policy)`.
 */
function parsePxCommandInventory(markdown: string): PxInventoryRow[] {
  const lines = markdown.split("\n");
  const startIdx = lines.findIndex((l) => /^### 7\.1 Command Inventory/.test(l));
  if (startIdx === -1) {
    throw new Error("PX-capability-inventory.md: §7.1 heading not found");
  }
  const rows: PxInventoryRow[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    // Stop at the next h3 or h2 heading.
    if (/^#{2,3}\s/.test(line)) break;
    // Match table rows whose first cell is a backticked command name.
    const m = line.match(/^\|\s*`([^`]+)`\s*\|([^|]*)\|([^|]*)\|\s*(allow|ask|deny)\s*\|/);
    if (!m) continue;
    const [, name, , , policyRaw] = m;
    const policy = policyRaw!.trim() as "allow" | "ask" | "deny";
    rows.push({ name: name!.trim(), policy });
  }
  return rows;
}

describe("PX-capability-inventory §7.1 docs guard (A8-A10 review GPT R4)", () => {
  const markdown = readFileSync(PX_INVENTORY_PATH, "utf-8");
  const pxRows = parsePxCommandInventory(markdown);

  it("§7.1 contains exactly the 21 canonical commands in the canonical order (B3 expansion)", () => {
    expect(pxRows.map((r) => r.name)).toEqual(EXPECTED_COMMAND_ORDER);
  });

  it("§7.1 policy column matches the code's canonical policy for every command", () => {
    for (const row of pxRows) {
      expect(row.policy).toBe(EXPECTED_POLICY[row.name]);
    }
  });

  it("§7.1 has no ghost rows that do not exist in the registry", () => {
    for (const row of pxRows) {
      expect(EXPECTED_POLICY).toHaveProperty(row.name);
    }
  });
});
