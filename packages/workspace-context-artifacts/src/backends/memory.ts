/**
 * Workspace Context Artifacts — Memory Backend
 *
 * In-memory backend for session-local writable workspace.
 * Stores files in a Map keyed by normalized relative paths.
 * Suitable for ephemeral session data that does not need
 * persistence beyond the current Durable Object lifetime.
 */

import type { WorkspaceBackend } from "./types.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Internal File Record
// ═══════════════════════════════════════════════════════════════════

interface FileRecord {
  content: string;
  modifiedAt: string;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — MemoryBackend
// ═══════════════════════════════════════════════════════════════════

export class MemoryBackend implements WorkspaceBackend {
  private files: Map<string, FileRecord> = new Map();

  async read(relativePath: string): Promise<string | null> {
    const key = this.normalize(relativePath);
    const record = this.files.get(key);
    return record ? record.content : null;
  }

  async write(relativePath: string, content: string): Promise<void> {
    const key = this.normalize(relativePath);
    this.files.set(key, {
      content,
      modifiedAt: new Date().toISOString(),
    });
  }

  async list(
    relativePath: string,
  ): Promise<Array<{ name: string; size: number }>> {
    const prefix = this.normalize(relativePath);
    const dirPrefix = prefix === "" ? "" : prefix + "/";
    const results: Array<{ name: string; size: number }> = [];
    const seen = new Set<string>();

    for (const [filePath, record] of this.files) {
      if (!filePath.startsWith(dirPrefix) && prefix !== "") {
        continue;
      }

      // For root listing (prefix === ""), list all top-level entries
      const remainder =
        prefix === "" ? filePath : filePath.slice(dirPrefix.length);
      if (remainder === "") continue;

      // Extract the immediate child name (first segment)
      const slashIdx = remainder.indexOf("/");
      const childName = slashIdx === -1 ? remainder : remainder.slice(0, slashIdx);

      if (!seen.has(childName)) {
        seen.add(childName);
        // If it's a direct file (no further slash), report its size
        // If it's a directory prefix, report size 0
        const size =
          slashIdx === -1 ? new TextEncoder().encode(record.content).length : 0;
        results.push({ name: childName, size });
      }
    }

    return results;
  }

  async stat(
    relativePath: string,
  ): Promise<{ size: number; modifiedAt: string } | null> {
    const key = this.normalize(relativePath);
    const record = this.files.get(key);
    if (!record) return null;
    return {
      size: new TextEncoder().encode(record.content).length,
      modifiedAt: record.modifiedAt,
    };
  }

  async delete(relativePath: string): Promise<boolean> {
    const key = this.normalize(relativePath);
    return this.files.delete(key);
  }

  /**
   * Normalize a relative path by stripping leading slashes
   * and collapsing multiple slashes.
   */
  private normalize(path: string): string {
    return path
      .replace(/\/+/g, "/")
      .replace(/^\//, "")
      .replace(/\/$/, "");
  }
}
