import { describe, it, expect } from "vitest";
import { MountRouter } from "../src/mounts.js";
import { MemoryBackend } from "../src/backends/memory.js";
import type { MountConfig } from "../src/types.js";
import type { WorkspacePath } from "../src/paths.js";

function wp(path: string): WorkspacePath {
  return path as WorkspacePath;
}

function createConfig(mountPoint: string, access: "readonly" | "writable" = "writable"): MountConfig {
  return {
    mountPoint,
    backend: "memory",
    access,
  };
}

describe("MountRouter", () => {
  describe("addMount / listMounts", () => {
    it("adds a mount and lists it", () => {
      const router = new MountRouter();
      const backend = new MemoryBackend();
      router.addMount(createConfig("/workspace"), backend);

      const mounts = router.listMounts();
      expect(mounts).toHaveLength(1);
      expect(mounts[0].mountPoint).toBe("/workspace");
    });

    it("replaces an existing mount at the same path", () => {
      const router = new MountRouter();
      const backend1 = new MemoryBackend();
      const backend2 = new MemoryBackend();

      router.addMount(createConfig("/workspace"), backend1);
      router.addMount(createConfig("/workspace"), backend2);

      const mounts = router.listMounts();
      expect(mounts).toHaveLength(1);
    });

    it("supports multiple mounts", () => {
      const router = new MountRouter();
      router.addMount(createConfig("/"), new MemoryBackend());
      router.addMount(createConfig("/workspace"), new MemoryBackend());
      router.addMount(createConfig("/workspace/src"), new MemoryBackend());

      expect(router.listMounts()).toHaveLength(3);
    });
  });

  describe("removeMount", () => {
    it("removes an existing mount", () => {
      const router = new MountRouter();
      router.addMount(createConfig("/workspace"), new MemoryBackend());
      router.removeMount("/workspace");

      expect(router.listMounts()).toHaveLength(0);
    });

    it("is a no-op for non-existent mount", () => {
      const router = new MountRouter();
      router.addMount(createConfig("/workspace"), new MemoryBackend());
      router.removeMount("/other");

      expect(router.listMounts()).toHaveLength(1);
    });
  });

  describe("routePath — longest-prefix matching", () => {
    it("routes to root mount when no more specific mount exists", () => {
      const router = new MountRouter();
      router.addMount(createConfig("/"), new MemoryBackend());

      const result = router.routePath(wp("/some/deep/path.txt"));
      expect(result).not.toBeNull();
      expect(result!.mount.config.mountPoint).toBe("/");
      expect(result!.relativePath).toBe("some/deep/path.txt");
    });

    it("prefers longer mount prefix", () => {
      const router = new MountRouter();
      router.addMount(createConfig("/"), new MemoryBackend());
      router.addMount(createConfig("/workspace"), new MemoryBackend());

      const result = router.routePath(wp("/workspace/src/index.ts"));
      expect(result).not.toBeNull();
      expect(result!.mount.config.mountPoint).toBe("/workspace");
      expect(result!.relativePath).toBe("src/index.ts");
    });

    it("selects the most specific mount in a three-level hierarchy", () => {
      const router = new MountRouter();
      router.addMount(createConfig("/"), new MemoryBackend());
      router.addMount(createConfig("/workspace"), new MemoryBackend());
      router.addMount(createConfig("/workspace/src"), new MemoryBackend());

      const result = router.routePath(wp("/workspace/src/lib/utils.ts"));
      expect(result).not.toBeNull();
      expect(result!.mount.config.mountPoint).toBe("/workspace/src");
      expect(result!.relativePath).toBe("lib/utils.ts");
    });

    it("returns null when no mount matches", () => {
      const router = new MountRouter();
      // No mounts registered
      const result = router.routePath(wp("/workspace/file.txt"));
      expect(result).toBeNull();
    });

    it("does not match partial path segments", () => {
      const router = new MountRouter();
      router.addMount(createConfig("/work"), new MemoryBackend());

      // "/workspace" should NOT match mount at "/work"
      const result = router.routePath(wp("/workspace/file.txt"));
      expect(result).toBeNull();
    });

    it("matches mount point exactly (path equals mount)", () => {
      const router = new MountRouter();
      router.addMount(createConfig("/workspace"), new MemoryBackend());

      const result = router.routePath(wp("/workspace"));
      expect(result).not.toBeNull();
      expect(result!.mount.config.mountPoint).toBe("/workspace");
      expect(result!.relativePath).toBe("");
    });

    it("handles root path routing", () => {
      const router = new MountRouter();
      router.addMount(createConfig("/"), new MemoryBackend());

      const result = router.routePath(wp("/"));
      expect(result).not.toBeNull();
      expect(result!.mount.config.mountPoint).toBe("/");
      expect(result!.relativePath).toBe("");
    });
  });

  describe("mount point normalization", () => {
    it("normalizes trailing slashes", () => {
      const router = new MountRouter();
      router.addMount(createConfig("/workspace/"), new MemoryBackend());

      const mounts = router.listMounts();
      expect(mounts[0].mountPoint).toBe("/workspace");
    });

    it("normalizes double slashes", () => {
      const router = new MountRouter();
      router.addMount(createConfig("//workspace//src//"), new MemoryBackend());

      const mounts = router.listMounts();
      expect(mounts[0].mountPoint).toBe("/workspace/src");
    });
  });

  describe("_platform/ reserved namespace (R6 regression guard)", () => {
    it("a root mount does NOT swallow /_platform/ paths", () => {
      const router = new MountRouter();
      router.addMount(createConfig("/"), new MemoryBackend());
      expect(router.routePath(wp("/_platform/config/feature_flags"))).toBeNull();
    });

    it("a root mount still serves normal paths untouched", () => {
      const router = new MountRouter();
      router.addMount(createConfig("/"), new MemoryBackend());
      const route = router.routePath(wp("/regular/path.txt"));
      expect(route).not.toBeNull();
    });

    it("an explicit /_platform mount IS allowed to claim the reserved namespace", () => {
      const router = new MountRouter();
      router.addMount(createConfig("/"), new MemoryBackend());
      router.addMount(createConfig("/_platform"), new MemoryBackend());
      const route = router.routePath(wp("/_platform/config/feature_flags"));
      expect(route).not.toBeNull();
      expect(route!.mount.config.mountPoint).toBe("/_platform");
      expect(route!.relativePath).toBe("config/feature_flags");
    });

    it("exact /_platform path routes to the /_platform mount, not to root", () => {
      const router = new MountRouter();
      router.addMount(createConfig("/"), new MemoryBackend());
      router.addMount(createConfig("/_platform"), new MemoryBackend());
      const route = router.routePath(wp("/_platform"));
      expect(route).not.toBeNull();
      expect(route!.mount.config.mountPoint).toBe("/_platform");
    });
  });
});
