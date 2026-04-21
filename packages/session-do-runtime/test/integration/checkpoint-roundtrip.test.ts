/**
 * Integration — persistCheckpoint must write a checkpoint that its own
 * `validateSessionCheckpoint()` will accept.
 *
 * Regression guard for the second-round GPT R4 finding: the writer was
 * emitting `sessionUuid: activeTurnId ?? "unknown"` while the validator
 * was tightened to require a UUID; `"unknown"` immediately failed,
 * leaving the DO with a checkpoint that could never be restored.
 *
 * The fixed writer:
 *   - uses a real `sessionUuid` source-of-truth (env / attachSessionUuid)
 *   - refuses to persist when `teamUuid` is missing
 *   - runs `validateSessionCheckpoint()` as a symmetry guard before
 *     handing the record to DO storage
 */

import { describe, it, expect } from "vitest";
import { NanoSessionDO } from "../../src/do/nano-session-do.js";
import type { DurableObjectStateLike } from "../../src/do/nano-session-do.js";
import { validateSessionCheckpoint } from "../../src/checkpoint.js";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const TEAM_UUID = "team-aaa";
// B9: DO storage is now tenant-scoped under `tenants/<team>/...` via
// nacp-core's tenantDoStorage* wrapper. Checkpoint/resume tests must
// inspect the prefixed key.
const CHECKPOINT_KEY = `tenants/${TEAM_UUID}/session:checkpoint`;

function makeStorage(): {
  state: DurableObjectStateLike;
  store: Map<string, unknown>;
} {
  const store = new Map<string, unknown>();
  const state: DurableObjectStateLike = {
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        return store.get(key) as T | undefined;
      },
      async put<T>(key: string, value: T): Promise<void> {
        store.set(key, value);
      },
    },
  };
  return { state, store };
}

describe("integration: NanoSessionDO persistCheckpoint roundtrip", () => {
  it("writes a checkpoint that its own validator accepts when given a UUID via env", async () => {
    const { state, store } = makeStorage();
    const instance = new NanoSessionDO(state, { SESSION_UUID: VALID_UUID, TEAM_UUID });

    await instance.webSocketClose(null); // triggers persistCheckpoint()
    const persisted = store.get(CHECKPOINT_KEY);
    expect(persisted).toBeDefined();
    expect(validateSessionCheckpoint(persisted)).toBe(true);
  });

  it("attaches sessionUuid from a route sessionId the first time a WebSocket upgrade arrives", async () => {
    const { state, store } = makeStorage();
    const instance = new NanoSessionDO(state, { TEAM_UUID });

    // Trigger the WS upgrade path so attachSessionUuid() is called
    // with the route sessionId.
    const req = new Request(`https://example.com/sessions/${VALID_UUID}/ws`, {
      headers: { upgrade: "websocket" },
    });
    await instance.fetch(req);
    await instance.webSocketClose(null);

    const persisted = store.get(CHECKPOINT_KEY);
    expect(persisted).toBeDefined();
    expect(validateSessionCheckpoint(persisted)).toBe(true);
    expect((persisted as { sessionUuid: string }).sessionUuid).toBe(VALID_UUID);
  });

  it("refuses to persist a checkpoint when no UUID source-of-truth has been attached", async () => {
    const { state, store } = makeStorage();
    const instance = new NanoSessionDO(state, { TEAM_UUID });

    // Deliberately: no SESSION_UUID env; no WS upgrade; drive
    // webSocketClose() directly.
    await instance.webSocketClose(null);

    expect(store.has(CHECKPOINT_KEY)).toBe(false);
  });

  it("ignores an off-spec sessionId that is not a UUID (no accidental 'default' persisted)", async () => {
    const { state, store } = makeStorage();
    const instance = new NanoSessionDO(state, { TEAM_UUID });

    const req = new Request("https://example.com/sessions/not-a-uuid/ws", {
      headers: { upgrade: "websocket" },
    });
    await instance.fetch(req);
    await instance.webSocketClose(null);

    expect(store.has(CHECKPOINT_KEY)).toBe(false);
  });

  it("round-trips through restoreFromStorage after a valid persist", async () => {
    const { state, store } = makeStorage();
    const instance = new NanoSessionDO(state, { SESSION_UUID: VALID_UUID, TEAM_UUID });

    await instance.webSocketClose(null);
    // Simulate resume on a fresh instance pointed at the same storage.
    const fresh = new NanoSessionDO(state, { SESSION_UUID: VALID_UUID, TEAM_UUID });
    const msg = JSON.stringify({
      message_type: "session.resume",
      body: { last_seen_seq: 0 },
    });
    await fresh.webSocketMessage(null, msg);
    // Validator must still accept the stored checkpoint.
    expect(validateSessionCheckpoint(store.get(CHECKPOINT_KEY))).toBe(true);
  });
});
