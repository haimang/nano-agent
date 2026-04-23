/**
 * Workspace Context Artifacts — Backend Interface
 *
 * The WorkspaceBackend interface defines the contract that all
 * storage backends must implement. Backends are plugged into
 * the MountRouter to provide actual file operations.
 */

// ═══════════════════════════════════════════════════════════════════
// §1 — WorkspaceBackend
// ═══════════════════════════════════════════════════════════════════

/**
 * Backend interface for workspace file operations.
 *
 * All paths passed to backend methods are relative to the mount point —
 * the MountRouter strips the mount prefix before delegating.
 */
export interface WorkspaceBackend {
  /** Read file content. Returns null if the file does not exist. */
  read(relativePath: string): Promise<string | null>;

  /** Write file content. Creates or overwrites the file. */
  write(relativePath: string, content: string): Promise<void>;

  /** List immediate children of a directory path. */
  list(
    relativePath: string,
  ): Promise<Array<{ name: string; size: number }>>;

  /** Get file metadata. Returns null if the file does not exist. */
  stat(
    relativePath: string,
  ): Promise<{ size: number; modifiedAt: string } | null>;

  /** Delete a file. Returns true if the file existed and was deleted. */
  delete(relativePath: string): Promise<boolean>;
}
