/**
 * Workspace Context Artifacts — Reference Backend
 *
 * Placeholder backend for future durable storage connection.
 * All operations throw "not connected" errors by default.
 * Real implementations will be provided when storage-topology
 * Phase 3+ connects workspace backends to R2/KV/DO storage.
 */

import type { WorkspaceBackend } from "./types.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — ReferenceBackend
// ═══════════════════════════════════════════════════════════════════

export class ReferenceBackend implements WorkspaceBackend {
  async read(_relativePath: string): Promise<string | null> {
    throw new Error(
      "ReferenceBackend: not connected — durable storage backend is not yet available",
    );
  }

  async write(_relativePath: string, _content: string): Promise<void> {
    throw new Error(
      "ReferenceBackend: not connected — durable storage backend is not yet available",
    );
  }

  async list(
    _relativePath: string,
  ): Promise<Array<{ name: string; size: number }>> {
    throw new Error(
      "ReferenceBackend: not connected — durable storage backend is not yet available",
    );
  }

  async stat(
    _relativePath: string,
  ): Promise<{ size: number; modifiedAt: string } | null> {
    throw new Error(
      "ReferenceBackend: not connected — durable storage backend is not yet available",
    );
  }

  async delete(_relativePath: string): Promise<boolean> {
    throw new Error(
      "ReferenceBackend: not connected — durable storage backend is not yet available",
    );
  }
}
