/**
 * Workspace Context Artifacts — Artifact Registry & Store
 *
 * Provides an in-memory artifact store that tracks metadata
 * for all registered artifacts, supporting lookup by key and
 * filtering by artifact kind.
 */

import { D1Adapter, type D1DatabaseBinding, R2Adapter, type R2BucketBinding } from "@nano-agent/storage-topology";
import type { ArtifactRef, ArtifactKind } from "./refs.js";
import type {
  ListArtifactsInput,
  ReadArtifactInput,
  ReadArtifactResult,
  SessionFileListResult,
  SessionFileRecord,
  WriteArtifactInput,
  WriteArtifactResult,
} from "./types.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Artifact Metadata
// ═══════════════════════════════════════════════════════════════════

export interface ArtifactMetadata {
  readonly ref: ArtifactRef;
  readonly audience: "internal" | "client-visible";
  readonly previewText?: string;
  readonly preparedState?: "pending" | "ready" | "failed";
  readonly createdAt: string;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — Artifact Store Interface
// ═══════════════════════════════════════════════════════════════════

export interface ArtifactStore {
  register(meta: ArtifactMetadata): void;
  get(key: string): ArtifactMetadata | undefined;
  list(): ArtifactMetadata[];
  listByKind(kind: ArtifactKind): ArtifactMetadata[];
}

// ═══════════════════════════════════════════════════════════════════
// §3 — InMemoryArtifactStore
// ═══════════════════════════════════════════════════════════════════

export class InMemoryArtifactStore implements ArtifactStore {
  private artifacts: Map<string, ArtifactMetadata> = new Map();

  register(meta: ArtifactMetadata): void {
    this.artifacts.set(meta.ref.key, meta);
  }

  get(key: string): ArtifactMetadata | undefined {
    return this.artifacts.get(key);
  }

  list(): ArtifactMetadata[] {
    return Array.from(this.artifacts.values());
  }

  listByKind(kind: ArtifactKind): ArtifactMetadata[] {
    // `ref.kind` is now the NacpRef backend (`r2`/`kv`/`do-storage`/…);
    // artifact-level classification lives on `ref.artifactKind`.
    return Array.from(this.artifacts.values()).filter(
      (meta) => meta.ref.artifactKind === kind,
    );
  }
}

const MAX_SESSION_FILE_BYTES = 25 * 1024 * 1024;
const FILE_CURSOR_SEPARATOR = "|";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SessionFileStore {
  private readonly d1: D1Adapter;
  private readonly r2: R2Adapter;

  constructor(bindings: {
    readonly db: D1DatabaseBinding;
    readonly r2: R2BucketBinding;
  }) {
    this.d1 = new D1Adapter(bindings.db);
    this.r2 = new R2Adapter(bindings.r2);
  }

  async put(input: WriteArtifactInput): Promise<WriteArtifactResult> {
    assertUuid(input.session_uuid, "session_uuid");
    assertNonEmpty(input.team_uuid, "team_uuid");
    const bytes = normalizeBytes(input.bytes);
    if (bytes.byteLength > MAX_SESSION_FILE_BYTES) {
      throw new Error(`file exceeds 25 MiB product limit (${bytes.byteLength} bytes)`);
    }
    const exists = await this.d1.first<{ session_uuid: string }>(
      `SELECT session_uuid
         FROM nano_conversation_sessions
        WHERE session_uuid = ?1
          AND team_uuid = ?2
        LIMIT 1`,
      input.session_uuid,
      input.team_uuid,
    );
    if (!exists) {
      throw new Error(`session ${input.session_uuid} not found for team ${input.team_uuid}`);
    }

    const fileUuid = input.file_uuid ?? crypto.randomUUID();
    assertUuid(fileUuid, "file_uuid");
    const createdAt = new Date().toISOString();
    const record: SessionFileRecord = {
      file_uuid: fileUuid,
      session_uuid: input.session_uuid,
      team_uuid: input.team_uuid,
      r2_key: buildSessionFileKey(input.team_uuid, input.session_uuid, fileUuid),
      mime: normalizeMime(input.mime),
      size_bytes: bytes.byteLength,
      original_name: normalizeName(input.original_name),
      created_at: createdAt,
    };

    await this.r2.put(record.r2_key, bytes);
    try {
      await this.d1.prepare(
        `INSERT INTO nano_session_files (
           file_uuid,
           session_uuid,
           team_uuid,
           r2_key,
           mime,
           size_bytes,
           original_name,
           created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ).bind(
        record.file_uuid,
        record.session_uuid,
        record.team_uuid,
        record.r2_key,
        record.mime,
        record.size_bytes,
        record.original_name,
        record.created_at,
      ).run();
    } catch (error) {
      await this.r2.delete(record.r2_key);
      throw error;
    }

    return { file: record };
  }

  async get(input: ReadArtifactInput): Promise<ReadArtifactResult | null> {
    const record = await this.head(input);
    if (!record) return null;
    const object = await this.r2.get(record.r2_key);
    if (!object) {
      throw new Error(`artifact body missing for ${record.file_uuid}`);
    }
    return {
      file: record,
      bytes: await object.arrayBuffer(),
    };
  }

  async head(input: ReadArtifactInput): Promise<SessionFileRecord | null> {
    assertUuid(input.session_uuid, "session_uuid");
    assertUuid(input.file_uuid, "file_uuid");
    assertNonEmpty(input.team_uuid, "team_uuid");
    const row = await this.d1.first<Record<string, unknown>>(
      `SELECT
         file_uuid,
         session_uuid,
         team_uuid,
         r2_key,
         mime,
         size_bytes,
         original_name,
         created_at
       FROM nano_session_files
      WHERE file_uuid = ?1
        AND session_uuid = ?2
        AND team_uuid = ?3
      LIMIT 1`,
      input.file_uuid,
      input.session_uuid,
      input.team_uuid,
    );
    return row ? toRecord(row) : null;
  }

  async delete(input: ReadArtifactInput): Promise<boolean> {
    const record = await this.head(input);
    if (!record) return false;
    await this.d1.prepare(
      `DELETE FROM nano_session_files
        WHERE file_uuid = ?1
          AND session_uuid = ?2
          AND team_uuid = ?3`,
    ).bind(record.file_uuid, record.session_uuid, record.team_uuid).run();
    await this.r2.delete(record.r2_key);
    return true;
  }

  async list(input: ListArtifactsInput): Promise<SessionFileListResult> {
    assertUuid(input.session_uuid, "session_uuid");
    assertNonEmpty(input.team_uuid, "team_uuid");
    const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
    const cursor = parseCursor(input.cursor ?? null);
    const params: unknown[] = [input.session_uuid, input.team_uuid];
    let cursorClause = "";
    if (cursor) {
      cursorClause = `
        AND (
          created_at < ?3
          OR (created_at = ?3 AND file_uuid < ?4)
        )`;
      params.push(cursor.created_at, cursor.file_uuid);
    }
    params.push(limit + 1);
    const sql = `SELECT
        file_uuid,
        session_uuid,
        team_uuid,
        r2_key,
        mime,
        size_bytes,
        original_name,
        created_at
      FROM nano_session_files
      WHERE session_uuid = ?1
        AND team_uuid = ?2
        ${cursorClause}
      ORDER BY created_at DESC, file_uuid DESC
       LIMIT ?${cursor ? 5 : 3}`;
    const rows = await this.d1.query<Record<string, unknown>>(sql, ...params);
    const records = (rows.results ?? []).map(toRecord);
    const page = records.slice(0, limit);
    const nextCursor = records.length > limit && page.length > 0
      ? encodeCursor(page[page.length - 1]!.created_at, page[page.length - 1]!.file_uuid)
      : null;
    return {
      files: page,
      next_cursor: nextCursor,
    };
  }
}

export function buildSessionFileKey(teamUuid: string, sessionUuid: string, fileUuid: string): string {
  assertNonEmpty(teamUuid, "team_uuid");
  assertUuid(sessionUuid, "session_uuid");
  assertUuid(fileUuid, "file_uuid");
  return `tenants/${teamUuid}/sessions/${sessionUuid}/files/${fileUuid}`;
}

function normalizeBytes(input: ArrayBuffer | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
}

function normalizeMime(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 255) : null;
}

function normalizeName(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 255) : null;
}

function encodeCursor(createdAt: string, fileUuid: string): string {
  return `${createdAt}${FILE_CURSOR_SEPARATOR}${fileUuid}`;
}

function parseCursor(raw: string | null): { created_at: string; file_uuid: string } | null {
  if (!raw) return null;
  const [createdAt, fileUuid] = raw.split(FILE_CURSOR_SEPARATOR);
  if (!createdAt || !fileUuid || !UUID_RE.test(fileUuid)) return null;
  return { created_at: createdAt, file_uuid: fileUuid };
}

function toRecord(row: Record<string, unknown>): SessionFileRecord {
  return {
    file_uuid: String(row.file_uuid),
    session_uuid: String(row.session_uuid),
    team_uuid: String(row.team_uuid),
    r2_key: String(row.r2_key),
    mime: typeof row.mime === "string" ? row.mime : null,
    size_bytes: Number(row.size_bytes ?? 0),
    original_name: typeof row.original_name === "string" ? row.original_name : null,
    created_at: String(row.created_at),
  };
}

function assertUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw new Error(`${field} must be a UUID`);
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${field} must be non-empty`);
  }
}
