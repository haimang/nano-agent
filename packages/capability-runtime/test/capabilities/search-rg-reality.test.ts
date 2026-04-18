/**
 * A8 Phase 3 — canonical `rg` reality + bounded output tests.
 */

import { describe, it, expect } from "vitest";
import {
  createSearchHandlers,
  DEFAULT_RG_MAX_BYTES,
  DEFAULT_RG_MAX_MATCHES,
} from "../../src/capabilities/search.js";
import type { WorkspaceFsLike } from "../../src/capabilities/workspace-truth.js";

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
    const entries: Array<{ path: string; size: number }> = [];
    const seen = new Set<string>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const head = rest.split("/")[0]!;
      const childPath = `${prefix}${head}`.replace(/\/+/g, "/");
      if (!seen.has(childPath)) {
        seen.add(childPath);
        entries.push({
          path: childPath,
          size: this.files.get(childPath)?.length ?? 0,
        });
      }
    }
    return entries;
  }
  async deleteFile(path: string): Promise<boolean> {
    return this.files.delete(path);
  }
}

const BASE = "/workspace";

function rgHandler(workspace: FakeWorkspace) {
  return createSearchHandlers({
    workspacePath: BASE,
    namespace: workspace,
  }).get("rg")!;
}

describe("rg — canonical search reality", () => {
  it("scans nested workspace files and returns ripgrep-style path:line:text", async () => {
    const ws = new FakeWorkspace(
      new Map([
        ["/workspace/a.txt", "hello world\nfoo bar"],
        ["/workspace/sub/b.txt", "the foo strikes back\nnope"],
      ]),
    );
    const out = (await rgHandler(ws)({ pattern: "foo" })) as { output: string };
    const lines = out.output.split("\n").sort();
    expect(lines[0]).toMatch(/^\/workspace\/a\.txt:2:foo bar$/);
    expect(lines[1]).toMatch(
      /^\/workspace\/sub\/b\.txt:1:the foo strikes back$/,
    );
  });

  it("supports a single-file path argument", async () => {
    const ws = new FakeWorkspace(
      new Map([["/workspace/a.txt", "hello\nfoo\nbar"]]),
    );
    const out = (await rgHandler(ws)({
      pattern: "foo",
      path: "a.txt",
    })) as { output: string };
    expect(out.output).toBe("/workspace/a.txt:2:foo");
  });

  it("falls back to substring match when the pattern is not a valid regex", async () => {
    const ws = new FakeWorkspace(new Map([["/workspace/a.txt", "x [unclosed"]]));
    const out = (await rgHandler(ws)({ pattern: "[unclosed" })) as {
      output: string;
    };
    expect(out.output).toContain("[unclosed");
  });

  it("refuses to read /_platform paths", async () => {
    const ws = new FakeWorkspace(
      new Map([["/_platform/secret.json", "shh"]]),
    );
    await expect(
      rgHandler(ws)({ pattern: "shh", path: "/_platform" }),
    ).rejects.toThrow(/reserved \/_platform namespace/);
  });

  it("silently skips reserved-namespace files even when reachable from the root listing", async () => {
    const ws = new FakeWorkspace(
      new Map([
        ["/workspace/visible.txt", "needle"],
        ["/_platform/secret.txt", "needle"],
      ]),
    );
    const out = (await rgHandler(ws)({ pattern: "needle" })) as {
      output: string;
    };
    expect(out.output).toContain("/workspace/visible.txt");
    expect(out.output).not.toContain("/_platform");
  });

  it("emits a typed truncation marker when the cap fires", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) lines.push(`needle ${i}`);
    const ws = new FakeWorkspace(
      new Map([["/workspace/many.txt", lines.join("\n")]]),
    );
    const out = (await rgHandler(ws)({
      pattern: "needle",
      maxMatches: 10,
    })) as { output: string };
    const split = out.output.split("\n");
    expect(split.filter((l) => l.startsWith("/workspace/many.txt:"))).toHaveLength(
      10,
    );
    expect(split[split.length - 1]).toContain("[rg] truncated:");
  });

  it("returns a no-match marker when the pattern does not match anything", async () => {
    const ws = new FakeWorkspace(new Map([["/workspace/a.txt", "nothing"]]));
    const out = (await rgHandler(ws)({ pattern: "needle" })) as {
      output: string;
    };
    expect(out.output).toMatch(/^\[rg\] no matches/);
  });

  it("exports default cap constants", () => {
    expect(DEFAULT_RG_MAX_MATCHES).toBe(200);
    expect(DEFAULT_RG_MAX_BYTES).toBe(32 * 1024);
  });

  it("works without a workspace binding (legacy stub fallback)", async () => {
    const handler = createSearchHandlers().get("rg")!;
    const out = (await handler({ pattern: "x" })) as { output: string };
    expect(out.output).toContain("[rg] no workspace bound");
  });
});
