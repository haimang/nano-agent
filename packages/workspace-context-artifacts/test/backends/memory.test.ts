import { describe, it, expect } from "vitest";
import { MemoryBackend } from "../../src/backends/memory.js";

describe("MemoryBackend", () => {
  describe("write + read", () => {
    it("writes and reads a file", async () => {
      const backend = new MemoryBackend();
      await backend.write("hello.txt", "Hello, world!");

      const content = await backend.read("hello.txt");
      expect(content).toBe("Hello, world!");
    });

    it("overwrites existing file", async () => {
      const backend = new MemoryBackend();
      await backend.write("file.txt", "original");
      await backend.write("file.txt", "updated");

      const content = await backend.read("file.txt");
      expect(content).toBe("updated");
    });

    it("returns null for non-existent file", async () => {
      const backend = new MemoryBackend();
      const content = await backend.read("missing.txt");
      expect(content).toBeNull();
    });

    it("handles nested paths", async () => {
      const backend = new MemoryBackend();
      await backend.write("src/lib/utils.ts", "export const x = 1;");

      const content = await backend.read("src/lib/utils.ts");
      expect(content).toBe("export const x = 1;");
    });

    it("normalizes leading slashes", async () => {
      const backend = new MemoryBackend();
      await backend.write("/file.txt", "content");

      // Reading without leading slash should find the same file
      const content = await backend.read("file.txt");
      expect(content).toBe("content");
    });

    it("handles empty content", async () => {
      const backend = new MemoryBackend();
      await backend.write("empty.txt", "");

      const content = await backend.read("empty.txt");
      expect(content).toBe("");
    });
  });

  describe("list", () => {
    it("lists files in root directory", async () => {
      const backend = new MemoryBackend();
      await backend.write("a.txt", "aaa");
      await backend.write("b.txt", "bb");

      const entries = await backend.list("");
      expect(entries).toHaveLength(2);

      const names = entries.map((e) => e.name).sort();
      expect(names).toEqual(["a.txt", "b.txt"]);
    });

    it("lists immediate children only", async () => {
      const backend = new MemoryBackend();
      await backend.write("src/a.ts", "a");
      await backend.write("src/b.ts", "b");
      await backend.write("src/lib/c.ts", "c");
      await backend.write("readme.md", "# Hi");

      const entries = await backend.list("");
      const names = entries.map((e) => e.name).sort();
      expect(names).toEqual(["readme.md", "src"]);
    });

    it("lists contents of a subdirectory", async () => {
      const backend = new MemoryBackend();
      await backend.write("src/a.ts", "a");
      await backend.write("src/b.ts", "b");
      await backend.write("src/lib/c.ts", "c");

      const entries = await backend.list("src");
      const names = entries.map((e) => e.name).sort();
      expect(names).toEqual(["a.ts", "b.ts", "lib"]);
    });

    it("returns empty array for non-existent directory", async () => {
      const backend = new MemoryBackend();
      const entries = await backend.list("nonexistent");
      expect(entries).toHaveLength(0);
    });

    it("reports correct size for direct files", async () => {
      const backend = new MemoryBackend();
      await backend.write("data.txt", "hello");

      const entries = await backend.list("");
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe("data.txt");
      expect(entries[0].size).toBe(5); // "hello" is 5 bytes
    });

    it("reports size 0 for directory entries", async () => {
      const backend = new MemoryBackend();
      await backend.write("dir/file.txt", "content");

      const entries = await backend.list("");
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe("dir");
      expect(entries[0].size).toBe(0);
    });
  });

  describe("stat", () => {
    it("returns metadata for existing file", async () => {
      const backend = new MemoryBackend();
      await backend.write("info.json", '{"key":"val"}');

      const result = await backend.stat("info.json");
      expect(result).not.toBeNull();
      expect(result!.size).toBe(new TextEncoder().encode('{"key":"val"}').length);
      expect(result!.modifiedAt).toBeTruthy();
      // modifiedAt should be a valid ISO string
      expect(() => new Date(result!.modifiedAt)).not.toThrow();
    });

    it("returns null for non-existent file", async () => {
      const backend = new MemoryBackend();
      const result = await backend.stat("missing.txt");
      expect(result).toBeNull();
    });

    it("updates modifiedAt on overwrite", async () => {
      const backend = new MemoryBackend();
      await backend.write("file.txt", "v1");
      const stat1 = await backend.stat("file.txt");

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));

      await backend.write("file.txt", "v2-longer");
      const stat2 = await backend.stat("file.txt");

      expect(stat2!.size).toBeGreaterThan(stat1!.size);
      expect(new Date(stat2!.modifiedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(stat1!.modifiedAt).getTime(),
      );
    });

    it("correctly computes size for multi-byte characters", async () => {
      const backend = new MemoryBackend();
      const content = "Hello \u{1F600}"; // emoji is 4 bytes in UTF-8
      await backend.write("emoji.txt", content);

      const result = await backend.stat("emoji.txt");
      expect(result).not.toBeNull();
      expect(result!.size).toBe(new TextEncoder().encode(content).length);
    });
  });

  describe("delete", () => {
    it("deletes an existing file", async () => {
      const backend = new MemoryBackend();
      await backend.write("temp.txt", "temporary");

      const deleted = await backend.delete("temp.txt");
      expect(deleted).toBe(true);

      const content = await backend.read("temp.txt");
      expect(content).toBeNull();
    });

    it("returns false for non-existent file", async () => {
      const backend = new MemoryBackend();
      const deleted = await backend.delete("missing.txt");
      expect(deleted).toBe(false);
    });

    it("does not affect other files", async () => {
      const backend = new MemoryBackend();
      await backend.write("keep.txt", "keep me");
      await backend.write("delete.txt", "delete me");

      await backend.delete("delete.txt");

      expect(await backend.read("keep.txt")).toBe("keep me");
      expect(await backend.read("delete.txt")).toBeNull();
    });
  });

  describe("CRUD integration", () => {
    it("supports full create-read-update-delete cycle", async () => {
      const backend = new MemoryBackend();

      // Create
      await backend.write("doc.md", "# Draft");
      expect(await backend.read("doc.md")).toBe("# Draft");

      // Update
      await backend.write("doc.md", "# Final");
      expect(await backend.read("doc.md")).toBe("# Final");

      // Stat
      const stat = await backend.stat("doc.md");
      expect(stat).not.toBeNull();
      expect(stat!.size).toBe(7); // "# Final" = 7 bytes

      // List
      const entries = await backend.list("");
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe("doc.md");

      // Delete
      const deleted = await backend.delete("doc.md");
      expect(deleted).toBe(true);

      // Verify gone
      expect(await backend.read("doc.md")).toBeNull();
      expect(await backend.stat("doc.md")).toBeNull();
      expect(await backend.list("")).toHaveLength(0);
    });
  });
});
