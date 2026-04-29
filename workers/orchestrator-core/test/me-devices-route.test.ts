// RH0 P0-B4 — endpoint-level direct test for GET /me/devices.
// charter §7.1 hard gate: ≥5 cases, naming `me-devices-route.test.ts`.
//
// /me/devices 路径直接读 D1 nano_user_devices(per ZX5 D6 / Q9 owner direction
// in design). 本层 fixture 提供轻量 D1 mock,专注 façade routing + 跨用户
// 隔离 + revoked filter 不暴露。RH3 device gate 完成后,本文件应扩 case
// 验证 device_uuid claim 与 D1 一致。

import { describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { signTestJwt } from "./jwt-helper.js";

const USER_UUID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_UUID = "55555555-5555-4555-8555-555555555555";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";
const JWT_SECRET = "x".repeat(32);

type Row = Record<string, unknown>;

function createD1Mock(rowsFor: (userUuid: string) => Row[]) {
  return {
    prepare: (sql: string) => ({
      bind: (userUuid: string) => ({
        all: async () => ({
          results: sql.includes("status = 'active'")
            ? rowsFor(userUuid).filter((row) => row.status === "active")
            : rowsFor(userUuid),
        }),
        first: async () => (
          sql.includes("WHERE device_uuid = ?1")
            ? { status: "active" }
            : rowsFor(userUuid)[0] ?? null
        ),
        run: async () => ({ success: true, meta: { changes: 1 } }),
      }),
    }),
  } as any;
}

describe("GET /me/devices route", () => {
  it("200 happy — single active device", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const db = createD1Mock(() => [
      {
        device_uuid: "dev-1",
        device_label: "iPhone",
        device_kind: "ios",
        status: "active",
        created_at: "2026-04-29T00:00:00Z",
        last_seen_at: "2026-04-29T01:00:00Z",
        revoked_at: null,
        revoked_reason: null,
      },
    ]);
    const response = await worker.fetch(
      new Request("https://example.com/me/devices", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: db,
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { devices: any[] } };
    expect(body.data.devices).toHaveLength(1);
    expect(body.data.devices[0].device_uuid).toBe("dev-1");
  });

  it("200 — multi-device list ordered by last_seen_at DESC (mock returns input order)", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const db = createD1Mock(() => [
      {
        device_uuid: "dev-2",
        device_label: "Mac",
        device_kind: "desktop",
        status: "active",
        created_at: "2026-04-28T00:00:00Z",
        last_seen_at: "2026-04-29T02:00:00Z",
        revoked_at: null,
        revoked_reason: null,
      },
      {
        device_uuid: "dev-1",
        device_label: "iPhone",
        device_kind: "ios",
        status: "active",
        created_at: "2026-04-29T00:00:00Z",
        last_seen_at: "2026-04-29T01:00:00Z",
        revoked_at: null,
        revoked_reason: null,
      },
    ]);
    const response = await worker.fetch(
      new Request("https://example.com/me/devices", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: db,
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    const body = (await response.json()) as { data: { devices: any[] } };
    expect(body.data.devices).toHaveLength(2);
    expect(body.data.devices.map((d: any) => d.device_uuid)).toEqual([
      "dev-2",
      "dev-1",
    ]);
  });

  it("401 missing bearer", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/me/devices", { method: "GET" }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createD1Mock(() => []),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("invalid-auth");
  });

  it("revoked device is excluded from the default active list", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const db = createD1Mock(() => [
      {
        device_uuid: "dev-revoked",
        device_label: "Old",
        device_kind: "ios",
        status: "revoked",
        created_at: "2026-04-20T00:00:00Z",
        last_seen_at: "2026-04-21T00:00:00Z",
        revoked_at: "2026-04-22T00:00:00Z",
        revoked_reason: "user-action",
      },
    ]);
    const response = await worker.fetch(
      new Request("https://example.com/me/devices", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: db,
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    const body = (await response.json()) as { data: { devices: any[] } };
    expect(body.data.devices).toEqual([]);
  });

  it("cross-user — D1 binding receives current user's uuid", async () => {
    const tokenOther = await signTestJwt(
      {
        sub: OTHER_USER_UUID,
        user_uuid: OTHER_USER_UUID,
        team_uuid: TEAM_UUID,
      },
      JWT_SECRET,
    );
    const seen: string[] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: string[]) => {
          if (sql.includes("WHERE device_uuid = ?1")) {
            return {
              all: async () => ({ results: [] }),
              first: async () => ({ status: "active" }),
              run: async () => ({ success: true, meta: { changes: 1 } }),
            };
          }
          seen.push(args[0]!);
          return {
            all: async () => ({ results: [] }),
            first: async () => null,
            run: async () => ({ success: true, meta: { changes: 1 } }),
          };
        },
      }),
    } as any;
    await worker.fetch(
      new Request("https://example.com/me/devices", {
        method: "GET",
        headers: {
          authorization: `Bearer ${tokenOther}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: db,
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(seen).toContain(OTHER_USER_UUID);
    expect(seen).not.toContain(USER_UUID);
  });
});
