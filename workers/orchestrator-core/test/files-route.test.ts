import { describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { signTestJwt } from "./jwt-helper.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const FILE_UUID = "77777777-7777-4777-8777-777777777777";
const USER_UUID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_UUID = "55555555-5555-4555-8555-555555555555";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const OTHER_TEAM_UUID = "66666666-6666-4666-8666-666666666666";
const DEVICE_UUID = "88888888-8888-4888-8888-888888888888";
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";
const JWT_SECRET = "x".repeat(32);

function makeFilesystemCoreMock(overrides?: {
  listArtifacts?: any;
  writeArtifact?: any;
  readArtifact?: any;
  shouldThrow?: boolean;
}) {
  const stub = (name: string, defaultValue: unknown) =>
    overrides?.shouldThrow
      ? vi.fn().mockRejectedValue(new Error(`filesystem-core ${name} simulated failure`))
      : overrides?.[name as keyof typeof overrides]
        ?? vi.fn().mockResolvedValue(defaultValue);
  return {
    listArtifacts: stub("listArtifacts", {
      files: [
        {
          file_uuid: FILE_UUID,
          session_uuid: SESSION_UUID,
          team_uuid: TEAM_UUID,
          r2_key: `tenants/${TEAM_UUID}/sessions/${SESSION_UUID}/files/${FILE_UUID}`,
          mime: "image/png",
          size_bytes: 4,
          original_name: "image.png",
          created_at: "2026-04-29T12:00:00.000Z",
        },
      ],
      next_cursor: null,
    }),
    writeArtifact: stub("writeArtifact", {
      file: {
        file_uuid: FILE_UUID,
        session_uuid: SESSION_UUID,
        team_uuid: TEAM_UUID,
        r2_key: `tenants/${TEAM_UUID}/sessions/${SESSION_UUID}/files/${FILE_UUID}`,
        mime: "image/png",
        size_bytes: 4,
        original_name: "image.png",
        created_at: "2026-04-29T12:00:00.000Z",
      },
    }),
    readArtifact: stub("readArtifact", {
      file: {
        file_uuid: FILE_UUID,
        session_uuid: SESSION_UUID,
        team_uuid: TEAM_UUID,
        r2_key: `tenants/${TEAM_UUID}/sessions/${SESSION_UUID}/files/${FILE_UUID}`,
        mime: "image/png",
        size_bytes: 4,
        original_name: "image.png",
        created_at: "2026-04-29T12:00:00.000Z",
      },
      bytes: new TextEncoder().encode("png!").buffer,
    }),
  };
}

function makeDbMock(options?: {
  sessionExists?: boolean;
  sessionTeam?: string;
  sessionUser?: string;
  deviceStatus?: string | null;
}) {
  const sessionExists = options?.sessionExists ?? true;
  const sessionTeam = options?.sessionTeam ?? TEAM_UUID;
  const sessionUser = options?.sessionUser ?? USER_UUID;
  const deviceStatus = options?.deviceStatus ?? "active";
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T = Record<string, unknown>>() {
              if (sql.includes("FROM nano_user_devices")) {
                return deviceStatus === null
                  ? null
                  : ({ status: deviceStatus } as T);
              }
              if (sql.includes("FROM nano_conversation_sessions")) {
                return sessionExists
                  ? ({ team_uuid: sessionTeam, actor_user_uuid: sessionUser } as T)
                  : null;
              }
              return null;
            },
          };
        },
      };
    },
  };
}

async function authHeaders(userUuid = USER_UUID, teamUuid = TEAM_UUID) {
  const token = await signTestJwt(
    { sub: userUuid, team_uuid: teamUuid, device_uuid: DEVICE_UUID },
    JWT_SECRET,
  );
  return {
    authorization: `Bearer ${token}`,
    "x-trace-uuid": TRACE_UUID,
  };
}

describe("RH4: GET /sessions/{uuid}/files", () => {
  it("200 happy — returns list from filesystem-core RPC", async () => {
    const fs = makeFilesystemCoreMock();
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/files?limit=10`, {
        headers: await authHeaders(),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: makeDbMock() as any,
        FILESYSTEM_CORE: fs,
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; data: { files: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.data.files).toHaveLength(1);
    expect(fs.listArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        team_uuid: TEAM_UUID,
        session_uuid: SESSION_UUID,
        limit: 10,
      }),
      expect.objectContaining({ trace_uuid: TRACE_UUID, team_uuid: TEAM_UUID }),
    );
  });

  it("401 missing bearer", async () => {
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/files`, {
        headers: { "x-trace-uuid": TRACE_UUID },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: makeDbMock() as any,
        FILESYSTEM_CORE: makeFilesystemCoreMock(),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(401);
  });

  it("403 session owned by another user", async () => {
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/files`, {
        headers: await authHeaders(),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: makeDbMock({ sessionUser: OTHER_USER_UUID }) as any,
        FILESYSTEM_CORE: makeFilesystemCoreMock(),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("permission-denied");
  });

  it("503 FILESYSTEM_CORE binding missing", async () => {
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/files`, {
        headers: await authHeaders(),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: makeDbMock() as any,
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("worker-misconfigured");
  });

  it("503 RPC throw — facade returns filesystem-rpc-unavailable", async () => {
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/files`, {
        headers: await authHeaders(),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: makeDbMock() as any,
        FILESYSTEM_CORE: makeFilesystemCoreMock({ shouldThrow: true }),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("filesystem-rpc-unavailable");
  });
});

describe("RH4: POST /sessions/{uuid}/files", () => {
  it("201 happy — uploads multipart file via filesystem-core RPC", async () => {
    const fs = makeFilesystemCoreMock();
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3, 4])], "image.png", { type: "image/png" }));
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/files`, {
        method: "POST",
        headers: await authHeaders(),
        body: form,
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: makeDbMock() as any,
        FILESYSTEM_CORE: fs,
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { data: { file_uuid: string } };
    expect(body.data.file_uuid).toBe(FILE_UUID);
    expect(fs.writeArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        team_uuid: TEAM_UUID,
        session_uuid: SESSION_UUID,
        mime: "image/png",
        original_name: "image.png",
      }),
      expect.objectContaining({ trace_uuid: TRACE_UUID, team_uuid: TEAM_UUID }),
    );
  });

  it("400 invalid content-type — multipart required", async () => {
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/files`, {
        method: "POST",
        headers: {
          ...(await authHeaders()),
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: makeDbMock() as any,
        FILESYSTEM_CORE: makeFilesystemCoreMock(),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid-input");
  });

  it("400 missing file field", async () => {
    const form = new FormData();
    form.set("note", "missing");
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/files`, {
        method: "POST",
        headers: await authHeaders(),
        body: form,
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: makeDbMock() as any,
        FILESYSTEM_CORE: makeFilesystemCoreMock(),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid-input");
  });

  it("413 oversize file rejected", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(25 * 1024 * 1024 + 1)], "too-big.bin", { type: "application/octet-stream" }));
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/files`, {
        method: "POST",
        headers: await authHeaders(),
        body: form,
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: makeDbMock() as any,
        FILESYSTEM_CORE: makeFilesystemCoreMock(),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("payload-too-large");
  });

  it("400 invalid mime override", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1])], "blob.bin"));
    form.set("mime", "invalid-mime");
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/files`, {
        method: "POST",
        headers: await authHeaders(),
        body: form,
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: makeDbMock() as any,
        FILESYSTEM_CORE: makeFilesystemCoreMock(),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid-input");
  });
});

describe("RH4: GET /sessions/{uuid}/files/{file_uuid}/content", () => {
  it("200 happy — returns file bytes", async () => {
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/files/${FILE_UUID}/content`, {
        headers: await authHeaders(),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: makeDbMock() as any,
        FILESYSTEM_CORE: makeFilesystemCoreMock(),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe("png!");
  });

  it("404 file not found", async () => {
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/files/${FILE_UUID}/content`, {
        headers: await authHeaders(),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: makeDbMock() as any,
        FILESYSTEM_CORE: makeFilesystemCoreMock({ readArtifact: vi.fn().mockResolvedValue(null) }),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not-found");
  });

  it("403 cross-team session denied before RPC", async () => {
    const fs = makeFilesystemCoreMock();
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/files/${FILE_UUID}/content`, {
        headers: await authHeaders(),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: makeDbMock({ sessionTeam: OTHER_TEAM_UUID }) as any,
        FILESYSTEM_CORE: fs,
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(403);
    expect(fs.readArtifact).not.toHaveBeenCalled();
  });

  it("503 FILESYSTEM_CORE binding missing", async () => {
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/files/${FILE_UUID}/content`, {
        headers: await authHeaders(),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: makeDbMock() as any,
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("worker-misconfigured");
  });

  it("503 RPC throw — facade returns filesystem-rpc-unavailable", async () => {
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/files/${FILE_UUID}/content`, {
        headers: await authHeaders(),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: makeDbMock() as any,
        FILESYSTEM_CORE: makeFilesystemCoreMock({ shouldThrow: true }),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("filesystem-rpc-unavailable");
  });
});
