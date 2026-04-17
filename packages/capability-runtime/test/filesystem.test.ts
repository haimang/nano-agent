import { describe, it, expect } from "vitest";

import { createFilesystemHandlers } from "../src/capabilities/filesystem.js";

function createNamespace() {
  const files = new Map<string, string>();

  return {
    files,
    namespace: {
      async readFile(path: unknown): Promise<string | null> {
        return files.get(String(path)) ?? null;
      },
      async writeFile(path: unknown, content: string): Promise<void> {
        files.set(String(path), content);
      },
      async listDir(path: unknown): Promise<Array<{ path: string; size: number }>> {
        const prefix = String(path).replace(/\/+$/, "");
        const dirPrefix = prefix === "/" ? "/" : `${prefix}/`;
        return [...files.entries()]
          .filter(([filePath]) => filePath.startsWith(dirPrefix))
          .map(([filePath, content]) => ({
            path: filePath,
            size: content.length,
          }));
      },
      async deleteFile(path: unknown): Promise<boolean> {
        return files.delete(String(path));
      },
    },
  };
}

describe("createFilesystemHandlers", () => {
  it("uses the provided namespace for write/cat/ls/rm", async () => {
    const { files, namespace } = createNamespace();
    const handlers = createFilesystemHandlers({
      workspacePath: "/workspace",
      namespace,
    });

    await handlers.get("write")?.({
      path: "src/main.ts",
      content: "console.log('hello')",
    });

    expect(files.get("/workspace/src/main.ts")).toBe("console.log('hello')");

    const cat = await handlers.get("cat")?.({ path: "/workspace/src/main.ts" });
    expect(cat?.output).toBe("console.log('hello')");

    const ls = await handlers.get("ls")?.({ path: "/workspace/src" });
    expect(ls?.output).toBe("/workspace/src/main.ts");

    const rm = await handlers.get("rm")?.({ path: "src/main.ts" });
    expect(rm?.output).toContain("/workspace/src/main.ts");
    expect(files.has("/workspace/src/main.ts")).toBe(false);
  });

  it("supports cp and mv via the provided namespace", async () => {
    const { files, namespace } = createNamespace();
    const handlers = createFilesystemHandlers({
      workspacePath: "/workspace",
      namespace,
    });

    files.set("/workspace/a.txt", "A");

    const cp = await handlers.get("cp")?.({
      source: "a.txt",
      destination: "b.txt",
    });
    expect(cp?.output).toContain("/workspace/a.txt -> /workspace/b.txt");
    expect(files.get("/workspace/b.txt")).toBe("A");

    const mv = await handlers.get("mv")?.({
      source: "b.txt",
      destination: "nested/c.txt",
    });
    expect(mv?.output).toContain("/workspace/b.txt -> /workspace/nested/c.txt");
    expect(files.has("/workspace/b.txt")).toBe(false);
    expect(files.get("/workspace/nested/c.txt")).toBe("A");
  });

  it("falls back to diagnostic strings when no namespace is provided", async () => {
    const handlers = createFilesystemHandlers({ workspacePath: "/workspace" });

    const cat = await handlers.get("cat")?.({ path: "hello.txt" });
    expect(cat?.output).toContain("[cat] reading: /workspace/hello.txt");

    const ls = await handlers.get("ls")?.({ path: "." });
    expect(ls?.output).toContain("[ls] listing: /workspace");
  });
});
