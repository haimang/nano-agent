import { describe, expect, it, vi } from "vitest";
import { createUserDoSurfaceRuntime } from "../src/user-do/surface-runtime.js";
import { createUserDoWsRuntime } from "../src/user-do/ws-runtime.js";
import { sessionKey, type SessionEntry } from "../src/session-lifecycle.js";
import { NanoOrchestratorUserDO } from "../src/user-do-runtime.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const TEAM_UUID = "22222222-2222-4222-8222-222222222222";
const USER_UUID = "33333333-3333-4333-8333-333333333333";
const DEVICE_UUID = "44444444-4444-4444-8444-444444444444";

const AUTH_SNAPSHOT = {
  sub: USER_UUID,
  user_uuid: USER_UUID,
  team_uuid: TEAM_UUID,
  tenant_uuid: TEAM_UUID,
  device_uuid: DEVICE_UUID,
  tenant_source: "claim" as const,
};

function activeEntry(): SessionEntry {
  return {
    created_at: "2026-04-30T00:00:00.000Z",
    last_seen_at: "2026-04-30T00:00:00.000Z",
    status: "active",
    last_phase: "running",
    relay_cursor: 5,
    ended_at: null,
    device_uuid: DEVICE_UUID,
  };
}

describe("orchestrator-core observability runtime wiring", () => {
  it("writes audit when device revoke supersedes an attached session", async () => {
    const audits: Array<Record<string, unknown>> = [];
    const frames: Array<Record<string, unknown>> = [];
    const entries = new Map<string, SessionEntry>([[sessionKey(SESSION_UUID), activeEntry()]]);
    const runtime = createUserDoWsRuntime({
      attachments: new Map([
        [
          SESSION_UUID,
          {
            socket: {
              send: vi.fn(),
              close: vi.fn(),
            },
            attached_at: "2026-04-30T00:00:00.000Z",
            device_uuid: DEVICE_UUID,
          },
        ],
      ]),
      get: async <T,>(key: string) => entries.get(key) as T | undefined,
      put: async () => {},
      readInternalAuthority: () => null,
      requireReadableSession: async () => activeEntry(),
      sessionGateMiss: async () => new Response(null, { status: 404 }),
      getTerminal: async () => null,
      readInternalStream: async () => ({ ok: true, frames: [] }),
      emitServerFrame: (_sessionUuid, frame) => {
        frames.push(frame);
      },
      enforceSessionDevice: async (_sessionUuid, entry) => entry,
      readAuditAuthSnapshot: async () => AUTH_SNAPSHOT,
      persistAudit: async (record) => {
        audits.push(record as unknown as Record<string, unknown>);
      },
    });

    const response = await runtime.handleDeviceRevoke(DEVICE_UUID, "device_revoked");
    expect(response.status).toBe(200);
    expect(frames[0]?.kind).toBe("session.attachment.superseded");
    expect(audits).toHaveLength(1);
    expect(audits[0]?.event_kind).toBe("session.attachment.superseded");
    expect(audits[0]?.device_uuid).toBe(DEVICE_UUID);
  });

  it("writes audit when resume detects replay_lost", async () => {
    const audits: Array<Record<string, unknown>> = [];
    const runtime = createUserDoSurfaceRuntime({
      env: {},
      get: async () => undefined,
      put: async () => {},
      sessionTruth: () => null,
      readDurableSnapshot: async () => null,
      readDurableHistory: async () => [],
      requireReadableSession: async () => activeEntry(),
      readAuditAuthSnapshot: async () => AUTH_SNAPSHOT,
      persistAudit: async (record) => {
        audits.push(record as unknown as Record<string, unknown>);
      },
    });

    const response = await runtime.handleResume(
      SESSION_UUID,
      new Request("https://example.com/sessions/x/resume", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-trace-uuid": "55555555-5555-4555-8555-555555555555",
        },
        body: JSON.stringify({ last_seen_seq: 9 }),
      }),
    );

    const body = (await response.json()) as {
      data: {
        replay_lost: boolean;
        replay_lost_detail: {
          client_last_seen_seq: number;
          relay_cursor: number;
          reason: string;
          degraded: boolean;
        } | null;
      };
    };
    expect(body.data.replay_lost).toBe(true);
    expect(body.data.replay_lost_detail).toEqual({
      client_last_seen_seq: 9,
      relay_cursor: 5,
      reason: "client-ahead-of-relay-cursor",
      degraded: true,
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.event_kind).toBe("session.replay_lost");
    expect(audits[0]?.detail).toEqual({
      client_last_seen_seq: 9,
      relay_cursor: 5,
      reason: "client-ahead-of-relay-cursor",
      degraded: true,
    });
  });

  it("emits system.error when a server frame is rejected before delivery", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const runtime = new NanoOrchestratorUserDO(
      {
        storage: {
          get: async () => undefined,
          put: async () => {},
          delete: async () => {},
          setAlarm: async () => {},
        },
      },
      {},
    );
    const attachments = (runtime as unknown as {
      attachments: Map<string, { socket: { send(payload: string): void } }>;
    }).attachments;
    attachments.set(SESSION_UUID, {
      socket: {
        send(payload: string) {
          sent.push(JSON.parse(payload) as Record<string, unknown>);
        },
      },
    });

    expect(runtime.emitServerFrame(SESSION_UUID, { kind: "session.heartbeat" })).toBe(false);
    await Promise.resolve();

    expect(sent[0]?.kind).toBe("system.error");
  });
});
