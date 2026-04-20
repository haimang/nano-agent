import { describe, it, expect } from "vitest";

import {
  createFilesystemHandlers,
  WRITE_OVERSIZE_REJECTED_NOTE,
} from "../src/capabilities/filesystem.js";

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

  describe("write oversize disclosure (B3 P4 / F08)", () => {
    /**
     * Build a namespace whose `writeFile` throws a duck-typed
     * `ValueTooLargeError`. We do NOT import the real class from
     * `@nano-agent/storage-topology` — the capability runtime consumes
     * it structurally, so any object with the right shape suffices
     * (this is the seam-decoupling property the test is locking in).
     */
    function namespaceThatRejects(bytes: number, cap: number, adapter: string) {
      const files = new Map<string, string>();
      return {
        files,
        namespace: {
          async readFile(path: unknown) {
            return files.get(String(path)) ?? null;
          },
          async writeFile(_path: unknown, _content: string) {
            const err = new Error(
              `Value too large: ${bytes} bytes > ${cap} cap on ${adapter} adapter`,
            );
            (err as unknown as Record<string, unknown>).name = "ValueTooLargeError";
            (err as unknown as Record<string, unknown>).bytes = bytes;
            (err as unknown as Record<string, unknown>).cap = cap;
            (err as unknown as Record<string, unknown>).adapter = adapter;
            throw err;
          },
          async listDir() {
            return [];
          },
          async deleteFile() {
            return false;
          },
        },
      };
    }

    it("maps a typed ValueTooLargeError to a deterministic disclosure with marker", async () => {
      const { namespace } = namespaceThatRejects(2_000_000, 1_048_576, "do");
      const handlers = createFilesystemHandlers({
        workspacePath: "/workspace",
        namespace,
      });
      try {
        await handlers.get("write")!({ path: "big.txt", content: "x".repeat(10) });
        expect.unreachable("should have thrown");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        expect(msg).toContain(WRITE_OVERSIZE_REJECTED_NOTE);
        expect(msg).toContain("2000000");
        expect(msg).toContain("1048576");
        expect(msg).toContain("do");
        // Must NOT leak raw storage-layer text (e.g. SQLITE_TOOBIG).
        expect(msg).not.toContain("SQLITE_TOOBIG");
        // Must NOT hardcode a 1 MiB literal in the disclosure
        // (B3 §6.2 約束 #2: cap is data, not literal).
        expect(msg).not.toContain("1 MiB");
      }
    });

    it("propagates non-ValueTooLargeError errors unchanged", async () => {
      const files = new Map<string, string>();
      const handlers = createFilesystemHandlers({
        workspacePath: "/workspace",
        namespace: {
          async readFile() {
            return null;
          },
          async writeFile() {
            throw new Error("disk on fire");
          },
          async listDir() {
            return [];
          },
          async deleteFile() {
            return false;
          },
        },
      });
      void files;
      await expect(
        handlers.get("write")!({ path: "x.txt", content: "y" }),
      ).rejects.toThrow("disk on fire");
    });

    it("does not invoke writeFile when the path is /_platform/** (F07 still gates)", async () => {
      const calls: string[] = [];
      const handlers = createFilesystemHandlers({
        workspacePath: "/workspace",
        namespace: {
          async readFile() {
            return null;
          },
          async writeFile(p: unknown) {
            calls.push(String(p));
          },
          async listDir() {
            return [];
          },
          async deleteFile() {
            return false;
          },
        },
      });
      await expect(
        handlers.get("write")!({ path: "/_platform/secret", content: "x" }),
      ).rejects.toThrow("/_platform");
      expect(calls).toHaveLength(0);
    });
  });
});
