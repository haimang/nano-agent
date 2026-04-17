import { describe, it, expect } from "vitest";
import { MountRouter } from "../src/mounts.js";
import { WorkspaceNamespace } from "../src/namespace.js";
import { MemoryBackend } from "../src/backends/memory.js";
import type { MountConfig } from "../src/types.js";
import type { WorkspacePath } from "../src/paths.js";

function wp(path: string): WorkspacePath {
  return path as WorkspacePath;
}

function createConfig(
  mountPoint: string,
  access: "readonly" | "writable" = "writable",
): MountConfig {
  return {
    mountPoint,
    backend: "memory",
    access,
  };
}

function setupNamespace(
  mounts: Array<{ config: MountConfig; backend: MemoryBackend }>,
): WorkspaceNamespace {
  const router = new MountRouter();
  for (const m of mounts) {
    router.addMount(m.config, m.backend);
  }
  return new WorkspaceNamespace(router);
}

describe("WorkspaceNamespace", () => {
  describe("readFile", () => {
    it("reads a file through a mounted backend", async () => {
      const backend = new MemoryBackend();
      await backend.write("hello.txt", "Hello, world!");

      const ns = setupNamespace([
        { config: createConfig("/"), backend },
      ]);

      const content = await ns.readFile(wp("/hello.txt"));
      expect(content).toBe("Hello, world!");
    });

    it("returns null for non-existent file", async () => {
      const ns = setupNamespace([
        { config: createConfig("/"), backend: new MemoryBackend() },
      ]);

      const content = await ns.readFile(wp("/missing.txt"));
      expect(content).toBeNull();
    });

    it("returns null when no mount matches", async () => {
      const ns = setupNamespace([]);
      const content = await ns.readFile(wp("/anything.txt"));
      expect(content).toBeNull();
    });

    it("routes to the correct mount", async () => {
      const rootBackend = new MemoryBackend();
      await rootBackend.write("root.txt", "root content");

      const wsBackend = new MemoryBackend();
      await wsBackend.write("src/app.ts", "workspace content");

      const ns = setupNamespace([
        { config: createConfig("/"), backend: rootBackend },
        { config: createConfig("/workspace"), backend: wsBackend },
      ]);

      expect(await ns.readFile(wp("/root.txt"))).toBe("root content");
      expect(await ns.readFile(wp("/workspace/src/app.ts"))).toBe("workspace content");
    });
  });

  describe("writeFile", () => {
    it("writes a file through a mounted backend", async () => {
      const backend = new MemoryBackend();
      const ns = setupNamespace([
        { config: createConfig("/"), backend },
      ]);

      await ns.writeFile(wp("/test.txt"), "test content");

      const content = await backend.read("test.txt");
      expect(content).toBe("test content");
    });

    it("throws when writing to a readonly mount", async () => {
      const backend = new MemoryBackend();
      const ns = setupNamespace([
        { config: createConfig("/", "readonly"), backend },
      ]);

      await expect(
        ns.writeFile(wp("/test.txt"), "content"),
      ).rejects.toThrow("Cannot write to readonly mount");
    });

    it("throws when no mount matches", async () => {
      const ns = setupNamespace([]);

      await expect(
        ns.writeFile(wp("/test.txt"), "content"),
      ).rejects.toThrow("No mount found for path");
    });
  });

  describe("listDir", () => {
    it("lists directory contents", async () => {
      const backend = new MemoryBackend();
      await backend.write("file1.txt", "a");
      await backend.write("file2.txt", "bb");

      const ns = setupNamespace([
        { config: createConfig("/"), backend },
      ]);

      const entries = await ns.listDir(wp("/"));
      expect(entries).toHaveLength(2);

      const names = entries.map((e) => e.path);
      expect(names).toContain("/file1.txt");
      expect(names).toContain("/file2.txt");
    });

    it("returns empty array when no mount matches", async () => {
      const ns = setupNamespace([]);
      const entries = await ns.listDir(wp("/nonexistent"));
      expect(entries).toHaveLength(0);
    });
  });

  describe("stat", () => {
    it("returns file metadata", async () => {
      const backend = new MemoryBackend();
      await backend.write("data.json", '{"key":"value"}');

      const ns = setupNamespace([
        { config: createConfig("/"), backend },
      ]);

      const entry = await ns.stat(wp("/data.json"));
      expect(entry).not.toBeNull();
      expect(entry!.path).toBe("/data.json");
      expect(entry!.size).toBe(new TextEncoder().encode('{"key":"value"}').length);
      expect(entry!.modifiedAt).toBeTruthy();
    });

    it("returns null for non-existent file", async () => {
      const ns = setupNamespace([
        { config: createConfig("/"), backend: new MemoryBackend() },
      ]);

      const entry = await ns.stat(wp("/missing.txt"));
      expect(entry).toBeNull();
    });

    it("returns null when no mount matches", async () => {
      const ns = setupNamespace([]);
      const entry = await ns.stat(wp("/anything"));
      expect(entry).toBeNull();
    });
  });

  describe("deleteFile", () => {
    it("deletes a file through a mounted backend", async () => {
      const backend = new MemoryBackend();
      await backend.write("doomed.txt", "goodbye");

      const ns = setupNamespace([
        { config: createConfig("/"), backend },
      ]);

      const deleted = await ns.deleteFile(wp("/doomed.txt"));
      expect(deleted).toBe(true);

      const content = await backend.read("doomed.txt");
      expect(content).toBeNull();
    });

    it("returns false for non-existent file", async () => {
      const ns = setupNamespace([
        { config: createConfig("/"), backend: new MemoryBackend() },
      ]);

      const deleted = await ns.deleteFile(wp("/missing.txt"));
      expect(deleted).toBe(false);
    });

    it("throws when deleting from a readonly mount", async () => {
      const backend = new MemoryBackend();
      await backend.write("protected.txt", "safe");

      const ns = setupNamespace([
        { config: createConfig("/", "readonly"), backend },
      ]);

      await expect(
        ns.deleteFile(wp("/protected.txt")),
      ).rejects.toThrow("Cannot delete from readonly mount");
    });

    it("returns false when no mount matches", async () => {
      const ns = setupNamespace([]);
      const deleted = await ns.deleteFile(wp("/whatever.txt"));
      expect(deleted).toBe(false);
    });
  });

  describe("readonly vs writable routing", () => {
    it("allows reads from readonly mounts but rejects writes", async () => {
      const backend = new MemoryBackend();
      await backend.write("readme.md", "# Hello");

      const ns = setupNamespace([
        { config: createConfig("/", "readonly"), backend },
      ]);

      // Read should succeed
      const content = await ns.readFile(wp("/readme.md"));
      expect(content).toBe("# Hello");

      // Write should fail
      await expect(
        ns.writeFile(wp("/readme.md"), "# Updated"),
      ).rejects.toThrow("Cannot write to readonly mount");

      // Delete should fail
      await expect(
        ns.deleteFile(wp("/readme.md")),
      ).rejects.toThrow("Cannot delete from readonly mount");
    });

    it("allows all operations on writable mounts", async () => {
      const backend = new MemoryBackend();
      const ns = setupNamespace([
        { config: createConfig("/"), backend },
      ]);

      await ns.writeFile(wp("/file.txt"), "content");
      expect(await ns.readFile(wp("/file.txt"))).toBe("content");

      const statResult = await ns.stat(wp("/file.txt"));
      expect(statResult).not.toBeNull();

      const deleted = await ns.deleteFile(wp("/file.txt"));
      expect(deleted).toBe(true);

      expect(await ns.readFile(wp("/file.txt"))).toBeNull();
    });
  });
});
