/**
 * B3 wave 2 — text-processing aux handlers (sort / uniq / diff).
 */

import { describe, it, expect } from "vitest";
import { createTextProcessingHandlers } from "../../src/capabilities/text-processing.js";

function makeWorkspace(seed: Record<string, string>) {
  const files = new Map<string, string>(Object.entries(seed));
  return {
    files,
    namespace: {
      async readFile(path: unknown) {
        return files.get(String(path)) ?? null;
      },
      async writeFile(path: unknown, content: string) {
        files.set(String(path), content);
      },
      async listDir() {
        return [];
      },
      async deleteFile(path: unknown) {
        return files.delete(String(path));
      },
    },
  };
}

function build(seed: Record<string, string> = {}) {
  const ws = makeWorkspace(seed);
  return {
    handlers: createTextProcessingHandlers({
      workspacePath: "/workspace",
      namespace: ws.namespace,
    }),
  };
}

describe("text-processing — sort", () => {
  it("sorts lines lexicographically by default", async () => {
    const { handlers } = build({ "/workspace/a.txt": "banana\napple\ncherry\n" });
    const out = await handlers.get("sort")!({ path: "a.txt" });
    expect(out.output).toBe("apple\nbanana\ncherry\n");
  });

  it("supports `reverse: true`", async () => {
    const { handlers } = build({ "/workspace/a.txt": "a\nb\nc\n" });
    const out = await handlers.get("sort")!({ path: "a.txt", reverse: true });
    expect(out.output).toBe("c\nb\na\n");
  });

  it("supports `numeric: true` with leading numeric tokens", async () => {
    const { handlers } = build({ "/workspace/a.txt": "10\n2\n100\n21\n" });
    const out = await handlers.get("sort")!({ path: "a.txt", numeric: true });
    expect(out.output).toBe("2\n10\n21\n100\n");
  });

  it("supports `unique: true`", async () => {
    const { handlers } = build({ "/workspace/a.txt": "b\na\nb\nc\na\n" });
    const out = await handlers.get("sort")!({ path: "a.txt", unique: true });
    expect(out.output).toBe("a\nb\nc\n");
  });

  it("preserves trailing newline behavior", async () => {
    const { handlers } = build({ "/workspace/a.txt": "b\na" });
    const out = await handlers.get("sort")!({ path: "a.txt" });
    expect(out.output).toBe("a\nb");
  });
});

describe("text-processing — uniq", () => {
  it("collapses adjacent duplicates only (POSIX semantics)", async () => {
    const { handlers } = build({
      "/workspace/a.txt": "a\na\nb\nb\nb\nc\na\n",
    });
    const out = await handlers.get("uniq")!({ path: "a.txt" });
    // Note: trailing 'a' after the run of 'c' is NOT a duplicate of
    // the leading 'a' run — they're not adjacent.
    expect(out.output).toBe("a\nb\nc\na\n");
  });

  it("supports `count: true` with right-padded count column", async () => {
    const { handlers } = build({
      "/workspace/a.txt": "a\na\nb\nb\nb\nc\n",
    });
    const out = await handlers.get("uniq")!({
      path: "a.txt",
      count: true,
    });
    expect(out.output).toBe("      2 a\n      3 b\n      1 c\n");
  });

  it("returns empty for empty file", async () => {
    const { handlers } = build({ "/workspace/empty.txt": "" });
    const out = await handlers.get("uniq")!({ path: "empty.txt" });
    expect(out.output).toBe("");
  });
});

describe("text-processing — diff", () => {
  it("produces empty output for identical files", async () => {
    const { handlers } = build({
      "/workspace/a.txt": "alpha\nbeta\n",
      "/workspace/b.txt": "alpha\nbeta\n",
    });
    const out = await handlers.get("diff")!({ left: "a.txt", right: "b.txt" });
    expect(out.output).toBe("");
  });

  it("emits unified-style hunks for differences", async () => {
    const { handlers } = build({
      "/workspace/a.txt": "alpha\nbeta\ngamma\n",
      "/workspace/b.txt": "alpha\nBETA\ngamma\n",
    });
    const out = await handlers.get("diff")!({ left: "a.txt", right: "b.txt" });
    expect(out.output).toContain("--- a /workspace/a.txt");
    expect(out.output).toContain("+++ b /workspace/b.txt");
    expect(out.output).toContain("@@ ");
    expect(out.output).toContain("-beta");
    expect(out.output).toContain("+BETA");
  });

  it("handles a pure deletion (right is shorter)", async () => {
    const { handlers } = build({
      "/workspace/a.txt": "alpha\nbeta\ngamma\n",
      "/workspace/b.txt": "alpha\ngamma\n",
    });
    const out = await handlers.get("diff")!({ left: "a.txt", right: "b.txt" });
    expect(out.output).toContain("-beta");
  });

  it("handles a pure addition (right is longer)", async () => {
    const { handlers } = build({
      "/workspace/a.txt": "alpha\ngamma\n",
      "/workspace/b.txt": "alpha\nbeta\ngamma\n",
    });
    const out = await handlers.get("diff")!({ left: "a.txt", right: "b.txt" });
    expect(out.output).toContain("+beta");
  });

  it("rejects when either path is missing", async () => {
    const { handlers } = build({ "/workspace/a.txt": "x" });
    await expect(
      handlers.get("diff")!({ left: "a.txt", right: "" }),
    ).rejects.toThrow("diff: left and right paths required");
  });

  it("rejects /_platform/** paths (F07 contract preserved)", async () => {
    const { handlers } = build({
      "/workspace/a.txt": "x",
    });
    await expect(
      handlers.get("diff")!({ left: "a.txt", right: "/_platform/secret" }),
    ).rejects.toThrow("/_platform");
  });
});
