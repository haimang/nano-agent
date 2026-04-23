/**
 * A10 Phase 2 — virtual `git` baseline (Q18).
 *
 * Covers:
 *   1. `status` consults the workspace namespace (real, deterministic)
 *   2. `diff` emits the no-baseline marker (honest partial)
 *   3. `log` emits the no-history marker (honest partial)
 *   4. unsupported subcommands trip `git-subcommand-blocked` at the
 *      handler (structured path)
 *   5. `/_platform/**` contents NEVER leak into `git status`
 *   6. empty subcommand is rejected explicitly
 */

import { describe, it, expect } from "vitest";
import {
  createVcsHandlers,
  GIT_SUPPORTED_SUBCOMMANDS,
  GIT_SUBCOMMAND_BLOCKED_NOTE,
  GIT_PARTIAL_NO_BASELINE_NOTE,
  GIT_PARTIAL_NO_HISTORY_NOTE,
  isSupportedGitSubcommand,
} from "../../src/capabilities/vcs.js";
import {
  DEFAULT_WORKSPACE_ROOT,
  type WorkspaceFsLike,
} from "../../src/capabilities/workspace-truth.js";

class FakeWorkspace implements WorkspaceFsLike {
  constructor(private readonly files: Map<string, string>) {}
  async readFile(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async listDir(path: string): Promise<Array<{ path: string; size: number }>> {
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

describe("git subset (A10 Q18)", () => {
  it("GIT_SUPPORTED_SUBCOMMANDS is exactly [status, diff, log]", () => {
    expect([...GIT_SUPPORTED_SUBCOMMANDS]).toEqual(["status", "diff", "log"]);
  });

  it("isSupportedGitSubcommand agrees with the constant", () => {
    for (const s of ["status", "diff", "log"]) {
      expect(isSupportedGitSubcommand(s)).toBe(true);
    }
    for (const s of ["add", "commit", "restore", "branch", "checkout", "merge", "rebase", "reset"]) {
      expect(isSupportedGitSubcommand(s)).toBe(false);
    }
  });

  it("status reports workspace entries under the root (namespace attached)", async () => {
    const ws = new FakeWorkspace(
      new Map([
        ["/workspace/a.txt", "hello"],
        ["/workspace/lib/b.ts", "world"],
      ]),
    );
    const handlers = createVcsHandlers({
      workspacePath: DEFAULT_WORKSPACE_ROOT,
      namespace: ws,
    });
    const out = (await handlers.get("git")!({
      subcommand: "status",
      args: [],
    })) as { output: string };
    expect(out.output).toContain("[git status]");
    expect(out.output).toContain("/workspace/a.txt");
    expect(out.output).toContain("/workspace/lib/b.ts");
    // Read-only view disclaimer is part of the frozen baseline shape.
    expect(out.output).toContain("read-only view");
  });

  it("status on an empty workspace reports a clean baseline", async () => {
    const ws = new FakeWorkspace(new Map());
    const handlers = createVcsHandlers({ namespace: ws });
    const out = (await handlers.get("git")!({
      subcommand: "status",
    })) as { output: string };
    expect(out.output).toContain("clean workspace");
    expect(out.output).toContain("0 tracked-like entries");
  });

  // A8-A10 review Kimi R2: pre-fix, a FakeWorkspace whose `listDir`
  // returned `[]` for a synthetic "empty directory" child would get
  // that child pushed into the output list. The new traversal uses
  // `readFile(entry)` as the leaf disambiguator, so empty directory
  // entries silently drop and `git status` only reports real files.
  it("status omits leaf entries whose readFile returns null (empty-directory guard)", async () => {
    // This custom workspace advertises an `emptyDir` child via listDir
    // but returns null from readFile — mirroring a namespace that has
    // a registered empty directory without any files beneath it.
    class WsWithEmptyDir implements WorkspaceFsLike {
      async readFile(p: string): Promise<string | null> {
        if (p === "/workspace/file.txt") return "content";
        return null;
      }
      async writeFile(): Promise<void> {}
      async listDir(p: string): Promise<Array<{ path: string; size: number }>> {
        if (p === "/workspace") {
          return [
            { path: "/workspace/file.txt", size: 7 },
            { path: "/workspace/emptyDir", size: 0 },
          ];
        }
        return [];
      }
      async deleteFile(): Promise<boolean> {
        return false;
      }
    }
    const handlers = createVcsHandlers({ namespace: new WsWithEmptyDir() });
    const out = (await handlers.get("git")!({
      subcommand: "status",
    })) as { output: string };
    expect(out.output).toContain("/workspace/file.txt");
    expect(out.output).not.toContain("/workspace/emptyDir");
  });

  it("status without a namespace keeps the legacy not-wired disclosure", async () => {
    const handlers = createVcsHandlers();
    const out = (await handlers.get("git")!({
      subcommand: "status",
    })) as { output: string };
    expect(out.output).toContain("[git status] partial");
    expect(out.output).toContain("workspace not wired");
  });

  it("diff returns the deterministic no-baseline partial marker", async () => {
    const handlers = createVcsHandlers();
    const out = (await handlers.get("git")!({
      subcommand: "diff",
    })) as { output: string };
    expect(out.output).toContain(GIT_PARTIAL_NO_BASELINE_NOTE);
    expect(out.output).toContain("Phase 8+");
  });

  it("log returns the deterministic no-history partial marker", async () => {
    const handlers = createVcsHandlers();
    const out = (await handlers.get("git")!({
      subcommand: "log",
    })) as { output: string };
    expect(out.output).toContain(GIT_PARTIAL_NO_HISTORY_NOTE);
    expect(out.output).toContain("virtual VCS worker");
  });

  it("rejects mutating subcommands with the git-subcommand-blocked marker", async () => {
    const handlers = createVcsHandlers();
    for (const sub of ["add", "commit", "restore", "branch", "merge", "rebase", "reset", "checkout"]) {
      await expect(
        handlers.get("git")!({ subcommand: sub }),
      ).rejects.toThrow(new RegExp(GIT_SUBCOMMAND_BLOCKED_NOTE));
    }
  });

  it("rejects an empty subcommand", async () => {
    const handlers = createVcsHandlers();
    await expect(handlers.get("git")!({ subcommand: "" })).rejects.toThrow(
      /no subcommand provided/,
    );
  });

  it("status never leaks /_platform/** contents", async () => {
    const ws = new FakeWorkspace(
      new Map([
        ["/workspace/a.txt", "hello"],
        ["/_platform/secret.json", "{ \"k\": 1 }"],
      ]),
    );
    const handlers = createVcsHandlers({ namespace: ws });
    const out = (await handlers.get("git")!({
      subcommand: "status",
    })) as { output: string };
    expect(out.output).toContain("/workspace/a.txt");
    expect(out.output).not.toContain("/_platform");
    expect(out.output).not.toContain("secret.json");
  });
});
