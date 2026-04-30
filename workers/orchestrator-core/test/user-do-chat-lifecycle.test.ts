import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  sessionKey,
  terminalKey,
  type SessionEntry,
} from "../src/session-lifecycle.js";
import { createUserDoSessionFlow } from "../src/user-do/session-flow.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_AUTH_SNAPSHOT_KEY = "user/auth-snapshot";

function createFlowHarness(entryOverrides?: Partial<SessionEntry>) {
  const entry: SessionEntry = {
    created_at: "2026-04-30T00:00:00.000Z",
    last_seen_at: "2026-04-30T00:00:00.000Z",
    status: "detached",
    last_phase: "attached",
    relay_cursor: 5,
    ended_at: null,
    device_uuid: null,
    ...entryOverrides,
  };
  const store = new Map<string, unknown>([
    [
      USER_AUTH_SNAPSHOT_KEY,
      {
        sub: "22222222-2222-4222-8222-222222222222",
        user_uuid: "22222222-2222-4222-8222-222222222222",
        team_uuid: "44444444-4444-4444-8444-444444444444",
        tenant_uuid: "44444444-4444-4444-8444-444444444444",
        tenant_source: "jwt",
      },
    ],
  ]);
  const sessionTruth = {
    readSessionLifecycle: vi.fn(async () => ({
      conversation_uuid: CONVERSATION_UUID,
      session_uuid: SESSION_UUID,
      team_uuid: "44444444-4444-4444-8444-444444444444",
      actor_user_uuid: "22222222-2222-4222-8222-222222222222",
      session_status: entry.status,
      started_at: entry.created_at,
      ended_at: entry.ended_at,
      ended_reason: null,
      last_phase: entry.last_phase,
      title: "Before",
      deleted_at: null,
    })),
    updateSessionState: vi.fn(async () => {}),
    tombstoneConversation: vi.fn(async () => ({})),
    updateConversationTitle: vi.fn(async () => ({
      conversation_uuid: CONVERSATION_UUID,
      session_uuid: SESSION_UUID,
      team_uuid: "44444444-4444-4444-8444-444444444444",
      actor_user_uuid: "22222222-2222-4222-8222-222222222222",
      session_status: entry.status,
      started_at: entry.created_at,
      ended_at: entry.ended_at,
      ended_reason: null,
      last_phase: entry.last_phase,
      title: "Renamed",
      deleted_at: null,
    })),
  };

  const flow = createUserDoSessionFlow({
    sessionTruth: () => sessionTruth as any,
    get: async <T,>(key: string) => store.get(key) as T | undefined,
    put: async <T,>(key: string, value: T) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    userAuthSnapshotKey: USER_AUTH_SNAPSHOT_KEY,
    readDurableSnapshot: async () => ({
      conversation_uuid: CONVERSATION_UUID,
      session_status: entry.status,
      last_phase: entry.last_phase,
      last_event_seq: entry.relay_cursor,
      ended_at: entry.ended_at,
      started_at: entry.created_at,
    }),
    readDurableTimeline: async () => [],
    readDurableHistory: async () => [],
    rememberCache: async () => {},
    updateConversationIndex: vi.fn(async () => {}),
    updateActivePointers: vi.fn(async () => {}),
    refreshUserState: async () => {},
    requireAllowedModel: async () => null,
    ensureDurableSession: vi.fn(async () => ({
      conversation_uuid: CONVERSATION_UUID,
      session_uuid: SESSION_UUID,
      conversation_created: false,
    })),
    createDurableTurn: vi.fn(async () => null),
    recordUserMessage: vi.fn(async () => {}),
    recordContextSnapshot: vi.fn(async () => {}),
    appendDurableActivity: vi.fn(async () => {}),
    recordStreamFrames: vi.fn(async () => {}),
    forwardStart: vi.fn(async () => ({ response: Response.json({ ok: true }), body: { ok: true } })),
    forwardStatus: vi.fn(async () => Response.json({ ok: true })),
    forwardInternalJsonShadow: vi.fn(async () => ({
      response: Response.json({ ok: true }),
      body: { ok: true },
    })),
    readInternalStream: vi.fn(async () => ({ ok: true, frames: [] as any[] })),
    requireSession: vi.fn(async () => entry),
    requireReadableSession: vi.fn(async () => entry),
    sessionGateMiss: vi.fn(async () => Response.json({ error: "missing" }, { status: 404 })),
    getTerminal: vi.fn(async () => null),
    enforceSessionDevice: vi.fn(async () => entry),
    notifyTerminal: vi.fn(async () => {}),
    rememberEndedSession: vi.fn(async () => {}),
    cleanupEndedSessions: vi.fn(async () => {}),
    proxyReadResponse: vi.fn(async (_sessionUuid, _entry, response) => response),
    cloneJsonResponse: (status, body) => Response.json(body, { status }),
    touchSession: vi.fn(async () => {}),
    forwardFramesToAttachment: vi.fn(async (_sessionUuid, nextEntry) => nextEntry),
    handleMessages: vi.fn(async () => Response.json({ ok: true })),
    attachments: new Map(),
  });

  return { flow, store, sessionTruth };
}

describe("User DO chat lifecycle flow", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("handleClose marks the session ended with closed_by_user", async () => {
    const { flow, store, sessionTruth } = createFlowHarness();
    const response = await flow.handleClose(SESSION_UUID, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      action: "close",
      session_uuid: SESSION_UUID,
      session_status: "ended",
      ended_reason: "closed_by_user",
    });
    expect(sessionTruth.updateSessionState).toHaveBeenCalledWith(
      expect.objectContaining({
        session_uuid: SESSION_UUID,
        status: "ended",
        ended_reason: "closed_by_user",
      }),
    );
    expect(store.get(sessionKey(SESSION_UUID))).toMatchObject({
      status: "ended",
      ended_at: expect.any(String),
    });
    expect(store.get(terminalKey(SESSION_UUID))).toMatchObject({
      terminal: "completed",
    });
  });

  it("handleDelete tombstones the parent conversation and closes the session", async () => {
    const { flow, sessionTruth } = createFlowHarness();
    const response = await flow.handleDelete(SESSION_UUID, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      action: "delete",
      session_uuid: SESSION_UUID,
      conversation_uuid: CONVERSATION_UUID,
      session_status: "ended",
      deleted_at: expect.any(String),
    });
    expect(sessionTruth.updateSessionState).toHaveBeenCalledWith(
      expect.objectContaining({
        session_uuid: SESSION_UUID,
        status: "ended",
        ended_reason: "closed_by_user",
      }),
    );
    expect(sessionTruth.tombstoneConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        session_uuid: SESSION_UUID,
        deleted_at: expect.any(String),
      }),
    );
  });

  it("handleTitle trims and persists the conversation title", async () => {
    const { flow, sessionTruth } = createFlowHarness();
    const response = await flow.handleTitle(SESSION_UUID, { title: "  Renamed  " });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      action: "title",
      session_uuid: SESSION_UUID,
      conversation_uuid: CONVERSATION_UUID,
      title: "Renamed",
    });
    expect(sessionTruth.updateConversationTitle).toHaveBeenCalledWith({
      session_uuid: SESSION_UUID,
      title: "Renamed",
      touched_at: expect.any(String),
    });
  });
});
