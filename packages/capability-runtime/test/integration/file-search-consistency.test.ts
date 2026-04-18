/**
 * A8 Phase 4 P4-01 — file/search consistency guard.
 *
 * Exercises the same workspace through `ls`, `cat`, and `rg` and
 * asserts:
 *   1. All three commands speak the same path universe (workspace
 *      root + namespace-backed listing).
 *   2. `/_platform/**` is rejected by all three with the same typed
 *      reserved-namespace message.
 *   3. `mkdir` is partial-with-disclosure; the result line carries
 *      the `mkdir-partial-no-directory-entity` marker.
 *   4. The `grep` alias resolves through the planner to the same
 *      canonical capability and produces output identical to a direct
 *      `rg` call.
 *
 * The harness uses the actual `createFilesystemHandlers` +
 * `createSearchHandlers` factories so any future drift in either path
 * fires this test immediately.
 */

import { describe, it, expect } from "vitest";
import { createFilesystemHandlers } from "../../src/capabilities/filesystem.js";
import { createSearchHandlers } from "../../src/capabilities/search.js";
import {
  DEFAULT_WORKSPACE_ROOT,
  type WorkspaceFsLike,
} from "../../src/capabilities/workspace-truth.js";
import { planFromBashCommand } from "../../src/planner.js";
import { InMemoryCapabilityRegistry } from "../../src/registry.js";
import { registerMinimalCommands } from "../../src/fake-bash/commands.js";

class FakeWorkspace implements WorkspaceFsLike {
  constructor(private readonly files: Map<string, string>) {}
  async readFile(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async listDir(
    path: string,
  ): Promise<Array<{ path: string; size: number }>> {
    const prefix = path === "/" ? "/" : `${path}/`;
    const seen = new Set<string>();
    const out: Array<{ path: string; size: number }> = [];
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const head = key.slice(prefix.length).split("/")[0]!;
      const child = `${prefix}${head}`.replace(/\/+/g, "/");
      if (!seen.has(child)) {
        seen.add(child);
        out.push({ path: child, size: this.files.get(child)?.length ?? 0 });
      }
    }
    return out;
  }
  async deleteFile(path: string): Promise<boolean> {
    return this.files.delete(path);
  }
}

const BASE = DEFAULT_WORKSPACE_ROOT;

function makeRig() {
  const ws = new FakeWorkspace(
    new Map([
      ["/workspace/lib/parser.ts", "function parse() {\n  return needle;\n}\n"],
      ["/workspace/README.md", "# README\nlook for needle here\n"],
      ["/_platform/secret.json", "{ \"shh\": \"needle\" }"],
    ]),
  );
  const fs = createFilesystemHandlers({ workspacePath: BASE, namespace: ws });
  const search = createSearchHandlers({ workspacePath: BASE, namespace: ws });
  const registry = new InMemoryCapabilityRegistry();
  registerMinimalCommands(registry);
  return { ws, fs, search, registry };
}

describe("file/search consistency (A8 Phase 4)", () => {
  it("ls/cat/rg all see the same workspace files at the same paths", async () => {
    const { fs, search } = makeRig();

    const ls = (await fs.get("ls")!({ path: "lib" })) as { output: string };
    expect(ls.output).toBe("/workspace/lib/parser.ts");

    const cat = (await fs.get("cat")!({ path: "lib/parser.ts" })) as {
      output: string;
    };
    expect(cat.output).toContain("needle");

    const rg = (await search.get("rg")!({
      pattern: "needle",
      path: "lib",
    })) as { output: string };
    expect(rg.output).toContain("/workspace/lib/parser.ts:2:");
  });

  it("rejects /_platform reads from ls / cat / rg with the same vocabulary", async () => {
    const { fs, search } = makeRig();
    await expect(
      fs.get("ls")!({ path: "/_platform" }),
    ).rejects.toThrow(/reserved \/_platform namespace/);
    await expect(
      fs.get("cat")!({ path: "/_platform/secret.json" }),
    ).rejects.toThrow(/reserved \/_platform namespace/);
    await expect(
      search.get("rg")!({ pattern: "needle", path: "/_platform" }),
    ).rejects.toThrow(/reserved \/_platform namespace/);
  });

  it("rg silently skips /_platform descendants when scanning from a workspace root", async () => {
    const { search } = makeRig();
    const rg = (await search.get("rg")!({ pattern: "needle" })) as {
      output: string;
    };
    expect(rg.output).toContain("/workspace/lib/parser.ts");
    expect(rg.output).toContain("/workspace/README.md");
    expect(rg.output).not.toContain("/_platform");
  });

  it("mkdir is partial-with-disclosure and emits the mkdir-partial-no-directory-entity marker", async () => {
    const { fs } = makeRig();
    const out = (await fs.get("mkdir")!({ path: "newdir" })) as {
      output: string;
    };
    expect(out.output).toContain("[mkdir] partial");
    expect(out.output).toContain("mkdir-partial-no-directory-entity");
  });

  it("`grep` alias produces the same plan as direct `rg` (Q16 narrow alias)", async () => {
    const { registry } = makeRig();
    const rgPlan = planFromBashCommand("rg needle lib", registry);
    const grepPlan = planFromBashCommand("grep needle lib", registry);
    expect(grepPlan?.capabilityName).toBe("rg");
    expect(grepPlan?.input).toEqual(rgPlan?.input);
  });

  it("path normalization gives the same canonical form for relative and absolute inputs", async () => {
    const { fs } = makeRig();
    const lsRelative = (await fs.get("ls")!({ path: "lib" })) as {
      output: string;
    };
    const lsAbsolute = (await fs.get("ls")!({ path: "/workspace/lib" })) as {
      output: string;
    };
    expect(lsRelative.output).toBe(lsAbsolute.output);
  });
});
