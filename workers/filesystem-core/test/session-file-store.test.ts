import { beforeEach, describe, expect, it } from "vitest";
import { buildSessionFileKey, SessionFileStore } from "../src/artifacts.js";

class MemoryR2Object {
  constructor(readonly bytes: Uint8Array) {}
  async text(): Promise<string> {
    return new TextDecoder().decode(this.bytes);
  }
  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.bytes.slice().buffer;
  }
}

function createR2Bucket() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    binding: {
      async put(key: string, value: ArrayBuffer | ArrayBufferView | string | ReadableStream | null) {
        if (typeof value === "string") {
          objects.set(key, new TextEncoder().encode(value));
          return;
        }
        if (value instanceof ArrayBuffer) {
          objects.set(key, new Uint8Array(value));
          return;
        }
        if (ArrayBuffer.isView(value)) {
          objects.set(key, new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)));
          return;
        }
        throw new Error("unsupported test body");
      },
      async get(key: string) {
        const bytes = objects.get(key);
        return bytes ? new MemoryR2Object(bytes) : null;
      },
      async head(key: string) {
        const bytes = objects.get(key);
        return bytes ? { key, size: bytes.byteLength } : null;
      },
      async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
        const prefix = options?.prefix ?? "";
        const limit = options?.limit ?? 1000;
        const start = options?.cursor ? Number(options.cursor) : 0;
        const filtered = Array.from(objects.keys())
          .filter((key) => key.startsWith(prefix))
          .sort();
        const page = filtered.slice(start, start + limit);
        const next = start + limit;
        return {
          objects: page.map((key) => ({ key, size: objects.get(key)?.byteLength ?? 0 })),
          truncated: next < filtered.length,
          ...(next < filtered.length ? { cursor: String(next) } : {}),
        };
      },
      async delete(key: string | string[]) {
        for (const item of Array.isArray(key) ? key : [key]) {
          objects.delete(item);
        }
      },
    },
  };
}

function createD1(sessionTeam = "team-a") {
  const sessions = new Map<string, { team_uuid: string }>([
    ["11111111-1111-4111-8111-111111111111", { team_uuid: sessionTeam }],
  ]);
  const files = new Map<string, Record<string, unknown>>();
  let failInsert = false;

  return {
    files,
    setFailInsert(value: boolean) {
      failInsert = value;
    },
    binding: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async first<T = Record<string, unknown>>() {
                if (sql.includes("FROM nano_conversation_sessions")) {
                  const session = sessions.get(String(args[0]));
                  if (session && session.team_uuid === String(args[1])) {
                    return { session_uuid: args[0] } as T;
                  }
                  return null;
                }
                if (sql.includes("FROM nano_session_files")) {
                  const row = files.get(String(args[0]));
                  if (
                    row &&
                    row.session_uuid === args[1] &&
                    row.team_uuid === args[2]
                  ) {
                    return row as T;
                  }
                  return null;
                }
                return null;
              },
              async all<T = Record<string, unknown>>() {
                if (sql.includes("FROM nano_session_files")) {
                  let rows = Array.from(files.values()).filter(
                    (row) =>
                      row.session_uuid === args[0] &&
                      row.team_uuid === args[1],
                  );
                  if (sql.includes("created_at < ?3")) {
                    rows = rows.filter((row) => {
                      const createdAt = String(args[2]);
                      const fileUuid = String(args[3]);
                      return (
                        String(row.created_at) < createdAt ||
                        (String(row.created_at) === createdAt &&
                          String(row.file_uuid) < fileUuid)
                      );
                    });
                  }
                  rows.sort((a, b) =>
                    String(b.created_at).localeCompare(String(a.created_at)) ||
                    String(b.file_uuid).localeCompare(String(a.file_uuid)),
                  );
                  const limit = Number(args[sql.includes("created_at < ?3") ? 4 : 2]);
                  return {
                    results: rows.slice(0, limit) as T[],
                    success: true,
                  };
                }
                return { results: [], success: true };
              },
              async run() {
                if (sql.includes("INSERT INTO nano_session_files")) {
                  if (failInsert) {
                    throw new Error("forced insert failure");
                  }
                  files.set(String(args[0]), {
                    file_uuid: args[0],
                    session_uuid: args[1],
                    team_uuid: args[2],
                    r2_key: args[3],
                    mime: args[4],
                    size_bytes: args[5],
                    original_name: args[6],
                    created_at: args[7],
                  });
                } else if (sql.includes("DELETE FROM nano_session_files")) {
                  files.delete(String(args[0]));
                }
                return { success: true, results: [] };
              },
            };
          },
        };
      },
      async batch() {
        return [];
      },
    },
  };
}

describe("SessionFileStore", () => {
  let d1: ReturnType<typeof createD1>;
  let r2: ReturnType<typeof createR2Bucket>;
  let store: SessionFileStore;

  beforeEach(() => {
    d1 = createD1();
    r2 = createR2Bucket();
    store = new SessionFileStore({ db: d1.binding as any, r2: r2.binding as any });
  });

  it("writes bytes to R2 and metadata to D1", async () => {
    const result = await store.put({
      team_uuid: "team-a",
      session_uuid: "11111111-1111-4111-8111-111111111111",
      file_uuid: "22222222-2222-4222-8222-222222222222",
      mime: "text/plain",
      original_name: "note.txt",
      bytes: new TextEncoder().encode("hello"),
    });
    expect(result.file.r2_key).toBe(
      buildSessionFileKey("team-a", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"),
    );
    expect(d1.files.size).toBe(1);
    expect(r2.objects.size).toBe(1);
  });

  it("reads a stored file back with bytes", async () => {
    await store.put({
      team_uuid: "team-a",
      session_uuid: "11111111-1111-4111-8111-111111111111",
      file_uuid: "22222222-2222-4222-8222-222222222222",
      mime: "text/plain",
      bytes: new TextEncoder().encode("hello"),
    });
    const result = await store.get({
      team_uuid: "team-a",
      session_uuid: "11111111-1111-4111-8111-111111111111",
      file_uuid: "22222222-2222-4222-8222-222222222222",
    });
    expect(result).not.toBeNull();
    expect(new TextDecoder().decode(new Uint8Array(result!.bytes))).toBe("hello");
  });

  it("lists files with keyset cursor", async () => {
    await store.put({
      team_uuid: "team-a",
      session_uuid: "11111111-1111-4111-8111-111111111111",
      file_uuid: "22222222-2222-4222-8222-222222222221",
      mime: "text/plain",
      bytes: new TextEncoder().encode("a"),
    });
    d1.files.get("22222222-2222-4222-8222-222222222221")!.created_at = "2026-04-29T12:00:00.000Z";
    await store.put({
      team_uuid: "team-a",
      session_uuid: "11111111-1111-4111-8111-111111111111",
      file_uuid: "22222222-2222-4222-8222-222222222222",
      mime: "text/plain",
      bytes: new TextEncoder().encode("b"),
    });
    d1.files.get("22222222-2222-4222-8222-222222222222")!.created_at = "2026-04-29T12:00:01.000Z";
    const page1 = await store.list({
      team_uuid: "team-a",
      session_uuid: "11111111-1111-4111-8111-111111111111",
      limit: 1,
    });
    expect(page1.files).toHaveLength(1);
    expect(page1.next_cursor).not.toBeNull();
    const page2 = await store.list({
      team_uuid: "team-a",
      session_uuid: "11111111-1111-4111-8111-111111111111",
      limit: 1,
      cursor: page1.next_cursor,
    });
    expect(page2.files).toHaveLength(1);
  });

  it("enforces session/team isolation on reads", async () => {
    await store.put({
      team_uuid: "team-a",
      session_uuid: "11111111-1111-4111-8111-111111111111",
      file_uuid: "22222222-2222-4222-8222-222222222222",
      mime: "text/plain",
      bytes: new TextEncoder().encode("hello"),
    });
    const result = await store.get({
      team_uuid: "team-b",
      session_uuid: "11111111-1111-4111-8111-111111111111",
      file_uuid: "22222222-2222-4222-8222-222222222222",
    });
    expect(result).toBeNull();
  });

  it("cleans up the R2 object when metadata insert fails", async () => {
    d1.setFailInsert(true);
    await expect(() =>
      store.put({
        team_uuid: "team-a",
        session_uuid: "11111111-1111-4111-8111-111111111111",
        file_uuid: "22222222-2222-4222-8222-222222222222",
        mime: "text/plain",
        bytes: new TextEncoder().encode("hello"),
      }),
    ).rejects.toThrow("forced insert failure");
    expect(r2.objects.size).toBe(0);
  });
});
