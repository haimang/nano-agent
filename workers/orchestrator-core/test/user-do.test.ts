import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NanoOrchestratorUserDO } from '../src/user-do.js';
import type { DurableObjectStateLike } from '../src/user-do.js';

const SESSION_UUID = '11111111-1111-4111-8111-111111111111';
const USER_UUID = '22222222-2222-4222-8222-222222222222';
const USER_AUTH_SNAPSHOT_KEY = 'user/auth-snapshot';

class FakeSocket {
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Array<() => void>>();

  accept(): void {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    for (const cb of this.listeners.get('close') ?? []) cb();
  }

  addEventListener(type: 'message' | 'close', cb: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(cb);
    this.listeners.set(type, list);
  }
}

function installFakePair(): { created: Array<{ client: FakeSocket; server: FakeSocket }> } {
  const created: Array<{ client: FakeSocket; server: FakeSocket }> = [];
  class FakePair {
    0: FakeSocket;
    1: FakeSocket;

    constructor() {
      this[0] = new FakeSocket();
      this[1] = new FakeSocket();
      created.push({ client: this[0], server: this[1] });
    }
  }
  (globalThis as unknown as { WebSocketPair: unknown }).WebSocketPair = FakePair as unknown;
  return { created };
}

function createState(): { state: DurableObjectStateLike; store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    state: {
      storage: {
        async get<T>(key: string) {
          return store.get(key) as T | undefined;
        },
        async put<T>(key: string, value: T) {
          store.set(key, value);
        },
        async delete(key: string) {
          store.delete(key);
        },
      },
    },
  };
}

function makeNdjson(lines: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
      controller.close();
    },
  });
}

describe('NanoOrchestratorUserDO', () => {
  beforeEach(() => {
    delete (globalThis as unknown as { WebSocketPair?: unknown }).WebSocketPair;
  });

  it('stores start sessions as detached instead of terminal when no client attachment exists', async () => {
    const { state, store } = createState();
    const agentFetch = async (request: Request): Promise<Response> => {
      const pathname = new URL(request.url).pathname;
      if (pathname.endsWith('/start')) {
        return Response.json({ ok: true, action: 'start', phase: 'attached' });
      }
      if (pathname.endsWith('/stream')) {
        return new Response(
          makeNdjson([
            JSON.stringify({ kind: 'meta', seq: 0, event: 'opened', session_uuid: SESSION_UUID }),
            JSON.stringify({
              kind: 'event',
              seq: 1,
              name: 'session.stream.event',
              payload: { kind: 'session.update', phase: 'attached' },
            }),
            JSON.stringify({
              kind: 'terminal',
              seq: 2,
              terminal: 'completed',
              payload: { phase: 'attached' },
            }),
          ]),
          { headers: { 'Content-Type': 'application/x-ndjson' } },
        );
      }
      return Response.json({ error: 'not-found' }, { status: 404 });
    };

    // ZX4 P9-01: post-flip RPC binding is the sole transport. Provide
    // an `start` RPC method alongside fetch so the test mirrors the
    // production deploy contract.
    const userDo = new NanoOrchestratorUserDO(state, {
      AGENT_CORE: {
        fetch: agentFetch,
        start: async () => ({
          status: 200,
          body: { ok: true, action: 'start', phase: 'attached' },
        }),
      } as any,
      NANO_INTERNAL_BINDING_SECRET: 'secret',
    });

    const response = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          initial_input: 'hello',
          auth_snapshot: { sub: USER_UUID, tenant_source: 'deploy-fill' },
          initial_context_seed: { default_layers: [], user_memory_ref: null },
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.status).toBe('detached');
    expect(store.get(`sessions/${SESSION_UUID}`)).toEqual({
      created_at: expect.any(String),
      last_seen_at: expect.any(String),
      status: 'detached',
      last_phase: 'attached',
      relay_cursor: -1,
      ended_at: null,
    });
  });

  it('forwards status and verify via internal routes for existing sessions', async () => {
    const { state, store } = createState();
    store.set(`sessions/${SESSION_UUID}`, {
      created_at: 'a',
      last_seen_at: 'a',
      status: 'detached',
      last_phase: 'attached',
      relay_cursor: -1,
      ended_at: null,
    });
    store.set(USER_AUTH_SNAPSHOT_KEY, { sub: USER_UUID, tenant_source: 'deploy-fill' });

    const agentFetch = vi.fn(async (request: Request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname.endsWith('/status')) {
        return Response.json({ ok: true, action: 'status', phase: 'attached' });
      }
      if (pathname.endsWith('/verify')) {
        return Response.json({ error: 'unknown-verify-check', action: 'verify' }, { status: 400 });
      }
      return Response.json({ error: 'unexpected' }, { status: 500 });
    });

    // ZX4 P9-01: post-flip RPC is sole transport.
    const userDo = new NanoOrchestratorUserDO(state, {
      AGENT_CORE: {
        fetch: agentFetch,
        status: async () => ({ status: 200, body: { ok: true, action: 'status', phase: 'attached' } }),
        verify: async () => ({ status: 400, body: { error: 'unknown-verify-check', action: 'verify' } }),
      } as any,
      NANO_INTERNAL_BINDING_SECRET: 'secret',
    });

    const status = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/status`),
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ ok: true, action: 'status', phase: 'attached' });

    const verify = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          check: 'bogus',
          auth_snapshot: { sub: USER_UUID, tenant_source: 'deploy-fill' },
          initial_context_seed: { default_layers: [], user_memory_ref: null },
        }),
      }),
    );
    expect(verify.status).toBe(400);
    expect(await verify.json()).toMatchObject({ error: 'unknown-verify-check' });
  });

  it('returns durable history payloads even when no D1 binding is configured', async () => {
    const { state, store } = createState();
    store.set(`sessions/${SESSION_UUID}`, {
      created_at: 'a',
      last_seen_at: 'a',
      status: 'detached',
      last_phase: 'attached',
      relay_cursor: -1,
      ended_at: null,
    });

    const userDo = new NanoOrchestratorUserDO(state, {
      AGENT_CORE: { fetch: async () => Response.json({ ok: true }) } as Fetcher,
      NANO_INTERNAL_BINDING_SECRET: 'secret',
    });

    const response = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/history`),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, action: 'history', messages: [] });
  });

  it('accepts rpc-backed start parity when rpc and fetch return the same envelope', async () => {
    const { state } = createState();
    const agentFetch = async (request: Request): Promise<Response> => {
      const pathname = new URL(request.url).pathname;
      if (pathname.endsWith('/start')) {
        return Response.json({ ok: true, action: 'start', phase: 'attached' });
      }
      if (pathname.endsWith('/stream')) {
        return new Response(
          makeNdjson([
            JSON.stringify({ kind: 'meta', seq: 0, event: 'opened', session_uuid: SESSION_UUID }),
            JSON.stringify({
              kind: 'event',
              seq: 1,
              name: 'session.stream.event',
              payload: { kind: 'session.update', phase: 'attached' },
            }),
          ]),
          { headers: { 'Content-Type': 'application/x-ndjson' } },
        );
      }
      return Response.json({ error: 'not-found' }, { status: 404 });
    };
    const userDo = new NanoOrchestratorUserDO(state, {
      AGENT_CORE: {
        fetch: agentFetch,
        start: async () => ({
          status: 200,
          body: { ok: true, action: 'start', phase: 'attached' },
        }),
      } as any,
      NANO_INTERNAL_BINDING_SECRET: 'secret',
    });

    const response = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          initial_input: 'hello',
          trace_uuid: '33333333-3333-4333-8333-333333333333',
          auth_snapshot: {
            sub: USER_UUID,
            user_uuid: USER_UUID,
            team_uuid: '44444444-4444-4444-8444-444444444444',
            tenant_uuid: '44444444-4444-4444-8444-444444444444',
            tenant_source: 'claim',
          },
          initial_context_seed: { default_layers: [], user_memory_ref: null },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, action: 'start' });
  });

  it('accepts rpc-backed start parity when object keys arrive in different order', async () => {
    const { state } = createState();
    const userDo = new NanoOrchestratorUserDO(state, {
      AGENT_CORE: {
        fetch: async (request: Request) => {
          const pathname = new URL(request.url).pathname;
          if (pathname.endsWith('/start')) {
            return Response.json({ ok: true, action: 'start', phase: 'attached' });
          }
          if (pathname.endsWith('/stream')) {
            return new Response(
              makeNdjson([
                JSON.stringify({ kind: 'meta', seq: 0, event: 'opened', session_uuid: SESSION_UUID }),
                JSON.stringify({
                  kind: 'event',
                  seq: 1,
                  name: 'session.stream.event',
                  payload: { kind: 'session.update', phase: 'attached' },
                }),
              ]),
              { headers: { 'Content-Type': 'application/x-ndjson' } },
            );
          }
          return Response.json({ error: 'not-found' }, { status: 404 });
        },
        start: async () => ({
          status: 200,
          body: { phase: 'attached', action: 'start', ok: true },
        }),
      } as any,
      NANO_INTERNAL_BINDING_SECRET: 'secret',
    });

    const response = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          initial_input: 'hello',
          trace_uuid: '33333333-3333-4333-8333-333333333333',
          auth_snapshot: {
            sub: USER_UUID,
            user_uuid: USER_UUID,
            team_uuid: '44444444-4444-4444-8444-444444444444',
            tenant_uuid: '44444444-4444-4444-8444-444444444444',
            tenant_source: 'claim',
          },
          initial_context_seed: { default_layers: [], user_memory_ref: null },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, action: 'start' });
  });

  it('cleans up starting session state when internal start fails', async () => {
    const { state, store } = createState();
    const userDo = new NanoOrchestratorUserDO(state, {
      AGENT_CORE: {
        fetch: async () => Response.json({ error: 'boom' }, { status: 503 }),
      } as Fetcher,
      NANO_INTERNAL_BINDING_SECRET: 'secret',
    });

    const response = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          initial_input: 'hello',
          auth_snapshot: { sub: USER_UUID, tenant_source: 'deploy-fill' },
          initial_context_seed: { default_layers: [], user_memory_ref: null },
        }),
      }),
    );

    expect(response.status).toBe(503);
    expect(store.has(`sessions/${SESSION_UUID}`)).toBe(false);
  });

  it('rolls back durable start scaffolding when internal start fails', async () => {
    const { state } = createState();
    const repo = {
      beginSession: vi.fn().mockResolvedValue({
        conversation_uuid: '44444444-4444-4444-8444-444444444444',
        session_uuid: SESSION_UUID,
        conversation_created: true,
      }),
      createTurn: vi.fn().mockResolvedValue({
        turn_uuid: '55555555-5555-4555-8555-555555555555',
        turn_index: 1,
      }),
      appendMessage: vi.fn().mockResolvedValue(undefined),
      captureContextSnapshot: vi.fn().mockResolvedValue(undefined),
      appendActivity: vi.fn().mockResolvedValue(1),
      rollbackSessionStart: vi.fn().mockResolvedValue(undefined),
      // ZX4 P3-06 — fresh-mint case: D1 row not yet present, status=null.
      readSessionStatus: vi.fn().mockResolvedValue(null),
    };
    const userDo = new NanoOrchestratorUserDO(state, {
      AGENT_CORE: {
        fetch: async () => Response.json({ error: 'boom' }, { status: 503 }),
      } as Fetcher,
      NANO_INTERNAL_BINDING_SECRET: 'secret',
    });
    (userDo as any).sessionTruth = () => repo;

    const response = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          initial_input: 'hello',
          auth_snapshot: {
            sub: USER_UUID,
            user_uuid: USER_UUID,
            team_uuid: '44444444-4444-4444-8444-444444444444',
            tenant_uuid: '44444444-4444-4444-8444-444444444444',
            tenant_source: 'claim',
          },
          initial_context_seed: { default_layers: [], user_memory_ref: null },
        }),
      }),
    );

    expect(response.status).toBe(503);
    expect(repo.rollbackSessionStart).toHaveBeenCalledWith({
      session_uuid: SESSION_UUID,
      conversation_uuid: '44444444-4444-4444-8444-444444444444',
      delete_conversation: true,
    });
    expect(repo.appendActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conversation_uuid: null,
        session_uuid: null,
        turn_uuid: null,
        event_kind: 'session.start.failed',
      }),
    );
  });

  it('redacts durable activity payloads before repository append', async () => {
    const { state } = createState();
    const repo = {
      appendActivity: vi.fn().mockResolvedValue(1),
    };
    const userDo = new NanoOrchestratorUserDO(state, {
      NANO_INTERNAL_BINDING_SECRET: 'secret',
    });
    (userDo as any).sessionTruth = () => repo;

    await (userDo as any).appendDurableActivity({
      pointer: {
        conversation_uuid: '44444444-4444-4444-8444-444444444444',
        session_uuid: SESSION_UUID,
        conversation_created: false,
      },
      authSnapshot: {
        sub: USER_UUID,
        user_uuid: USER_UUID,
        team_uuid: '44444444-4444-4444-8444-444444444444',
        tenant_uuid: '44444444-4444-4444-8444-444444444444',
        tenant_source: 'claim',
      },
      traceUuid: '33333333-3333-4333-8333-333333333333',
      turnUuid: null,
      eventKind: 'session.test',
      severity: 'info',
      payload: {
        access_token: 'secret-token',
        password: 'super-secret',
        ok: true,
      },
      timestamp: new Date().toISOString(),
    });

    expect(repo.appendActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          access_token: '[redacted]',
          password: '[redacted]',
          ok: true,
        },
      }),
    );
  });

  it('surfaces non-ok internal stream responses instead of treating them as empty replay', async () => {
    installFakePair();
    const { state, store } = createState();
    store.set(`sessions/${SESSION_UUID}`, {
      created_at: 'a',
      last_seen_at: 'a',
      status: 'detached',
      last_phase: 'attached',
      relay_cursor: -1,
      ended_at: null,
    });
    store.set(USER_AUTH_SNAPSHOT_KEY, { sub: USER_UUID, tenant_source: 'deploy-fill' });

    const userDo = new NanoOrchestratorUserDO(state, {
      AGENT_CORE: {
        fetch: async (request: Request) => {
          if (new URL(request.url).pathname.endsWith('/stream')) {
            return Response.json({ error: 'stream-broken' }, { status: 502 });
          }
          return Response.json({ ok: true });
        },
      } as Fetcher,
      NANO_INTERNAL_BINDING_SECRET: 'secret',
    });

    const response = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/ws`, {
        method: 'GET',
        headers: { upgrade: 'websocket' },
      }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: 'stream-broken' });
  });

  it('supersedes the old ws attachment before switching to the new one', async () => {
    const { created } = installFakePair();
    const { state, store } = createState();
    store.set(`sessions/${SESSION_UUID}`, {
      created_at: 'a',
      last_seen_at: 'a',
      status: 'detached',
      last_phase: 'attached',
      relay_cursor: -1,
      ended_at: null,
    });
    store.set(USER_AUTH_SNAPSHOT_KEY, { sub: USER_UUID, tenant_source: 'deploy-fill' });

    const agentFetch = async (request: Request): Promise<Response> => {
      const pathname = new URL(request.url).pathname;
      if (pathname.endsWith('/stream')) {
        return new Response(
          makeNdjson([
            JSON.stringify({ kind: 'meta', seq: 0, event: 'opened', session_uuid: SESSION_UUID }),
            JSON.stringify({
              kind: 'event',
              seq: 1,
              name: 'session.stream.event',
              payload: { kind: 'session.update', phase: 'attached' },
            }),
          ]),
          { headers: { 'Content-Type': 'application/x-ndjson' } },
        );
      }
      return Response.json({ ok: true });
    };

    const userDo = new NanoOrchestratorUserDO(state, {
      AGENT_CORE: { fetch: agentFetch } as Fetcher,
      NANO_INTERNAL_BINDING_SECRET: 'secret',
    });

    const first = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/ws`, {
        method: 'GET',
        headers: { upgrade: 'websocket' },
      }),
    );
    const second = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/ws`, {
        method: 'GET',
        headers: { upgrade: 'websocket' },
      }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstServer = created[0]!.server;
    expect(firstServer.sent[0]).toContain('"kind":"event"');
    expect(firstServer.sent[1]).toContain('attachment_superseded');
    expect(firstServer.closed).toBe(true);
    expect(store.get(`sessions/${SESSION_UUID}`)).toEqual(
      expect.objectContaining({ status: 'active' }),
    );
  });

  it('uses client last_seen_seq on ws attach to replay missed frames without duplicating acknowledged frames', async () => {
    const { created } = installFakePair();
    const { state, store } = createState();
    store.set(`sessions/${SESSION_UUID}`, {
      created_at: 'a',
      last_seen_at: 'a',
      status: 'detached',
      last_phase: 'attached',
      relay_cursor: 3,
      ended_at: null,
    });
    store.set(USER_AUTH_SNAPSHOT_KEY, { sub: USER_UUID, team_uuid: 'team-1', tenant_source: 'claim' });

    const agentFetch = async (request: Request): Promise<Response> => {
      if (new URL(request.url).pathname.endsWith('/stream')) {
        return new Response(
          makeNdjson([
            JSON.stringify({ kind: 'meta', seq: 0, event: 'opened', session_uuid: SESSION_UUID }),
            JSON.stringify({ kind: 'event', seq: 1, name: 'session.stream.event', payload: { kind: 'one' } }),
            JSON.stringify({ kind: 'event', seq: 2, name: 'session.stream.event', payload: { kind: 'two' } }),
            JSON.stringify({ kind: 'event', seq: 3, name: 'session.stream.event', payload: { kind: 'three' } }),
          ]),
          { headers: { 'Content-Type': 'application/x-ndjson' } },
        );
      }
      return Response.json({ ok: true });
    };

    const userDo = new NanoOrchestratorUserDO(state, {
      AGENT_CORE: { fetch: agentFetch } as Fetcher,
      NANO_INTERNAL_BINDING_SECRET: 'secret',
    });

    const response = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/ws?last_seen_seq=1`, {
        method: 'GET',
        headers: { upgrade: 'websocket' },
      }),
    );

    expect(response.status).toBe(200);
    const frames = created[0]!.server.sent.map((line) => JSON.parse(line));
    expect(frames.map((frame) => frame.seq)).toEqual([2, 3]);
    expect(store.get(`sessions/${SESSION_UUID}`)).toEqual(
      expect.objectContaining({ relay_cursor: 3 }),
    );
  });

  it('rejects ws attach for missing or ended sessions with typed errors', async () => {
    installFakePair();
    const { state, store } = createState();
    store.set(`sessions/${SESSION_UUID}`, {
      created_at: 'a',
      last_seen_at: 'a',
      status: 'ended',
      last_phase: 'attached',
      relay_cursor: -1,
      ended_at: 'b',
    });
    store.set(`session-terminal/${SESSION_UUID}`, {
      terminal: 'cancelled',
      last_phase: 'attached',
      ended_at: 'b',
    });

    const userDo = new NanoOrchestratorUserDO(state, {
      AGENT_CORE: { fetch: async () => Response.json({ ok: true }) } as Fetcher,
      NANO_INTERNAL_BINDING_SECRET: 'secret',
    });

    const missing = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/33333333-3333-4333-8333-333333333333/ws`, {
        method: 'GET',
        headers: { upgrade: 'websocket' },
      }),
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: 'session_missing' });

    const ended = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/ws`, {
        method: 'GET',
        headers: { upgrade: 'websocket' },
      }),
    );
    expect(ended.status).toBe(409);
    expect(await ended.json()).toMatchObject({ error: 'session_terminal', terminal: 'cancelled' });
  });

  it('purges ended session metadata outside the retention window', async () => {
    const { state, store } = createState();
    const oldEndedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    store.set(`sessions/${SESSION_UUID}`, {
      created_at: oldEndedAt,
      last_seen_at: oldEndedAt,
      status: 'ended',
      last_phase: 'attached',
      relay_cursor: -1,
      ended_at: oldEndedAt,
    });
    store.set(`session-terminal/${SESSION_UUID}`, {
      terminal: 'cancelled',
      last_phase: 'attached',
      ended_at: oldEndedAt,
    });
    store.set('sessions/ended-index', [{ session_uuid: SESSION_UUID, ended_at: oldEndedAt }]);

    const userDo = new NanoOrchestratorUserDO(state, {
      AGENT_CORE: { fetch: async () => Response.json({ ok: true, action: 'status', phase: 'attached' }) } as Fetcher,
      NANO_INTERNAL_BINDING_SECRET: 'secret',
    });

    const response = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/status`),
    );
    expect(response.status).toBe(404);
    expect(store.has(`sessions/${SESSION_UUID}`)).toBe(false);
    expect(store.has(`session-terminal/${SESSION_UUID}`)).toBe(false);
  });

  it('hydrates readable state from durable truth when hot state was cleared', async () => {
    const { state, store } = createState();
    const repo = {
      readSnapshot: vi.fn().mockResolvedValue({
        conversation_uuid: '44444444-4444-4444-8444-444444444444',
        session_uuid: SESSION_UUID,
        team_uuid: '44444444-4444-4444-8444-444444444444',
        actor_user_uuid: USER_UUID,
        trace_uuid: '33333333-3333-4333-8333-333333333333',
        session_status: 'detached',
        started_at: '2026-04-25T00:00:00.000Z',
        ended_at: null,
        last_phase: 'attached',
        last_event_seq: 60,
        message_count: 60,
        activity_count: 2,
        latest_turn_uuid: '55555555-5555-4555-8555-555555555555',
      }),
      readTimeline: vi.fn().mockResolvedValue(
        Array.from({ length: 60 }, (_, index) => ({
          kind: 'session.update',
          phase: 'attached',
          seq: index + 1,
        })),
      ),
      readHistory: vi.fn().mockResolvedValue([
        {
          message_uuid: '66666666-6666-4666-8666-666666666666',
          turn_uuid: null,
          trace_uuid: '33333333-3333-4333-8333-333333333333',
          role: 'assistant',
          kind: 'stream-event',
          body: { kind: 'session.update', phase: 'attached' },
          created_at: '2026-04-25T00:00:01.000Z',
        },
      ]),
      updateSessionState: vi.fn().mockResolvedValue(undefined),
    };
    const userDo = new NanoOrchestratorUserDO(state, {
      AGENT_CORE: { fetch: async () => Response.json({ ok: true, action: 'status', phase: 'attached' }) } as Fetcher,
      NANO_INTERNAL_BINDING_SECRET: 'secret',
    });
    (userDo as any).sessionTruth = () => repo;

    const timeline = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/timeline`),
    );

    expect(timeline.status).toBe(200);
    expect(await timeline.json()).toMatchObject({ ok: true, action: 'timeline' });
    expect(store.get(`sessions/${SESSION_UUID}`)).toEqual(
      expect.objectContaining({
        status: 'detached',
        last_phase: 'attached',
        relay_cursor: 60,
      }),
    );
    expect(store.get(`recent-frames/${SESSION_UUID}`)).toEqual(
      expect.objectContaining({
        frames: expect.arrayContaining([
          expect.objectContaining({ seq: 11 }),
          expect.objectContaining({ seq: 60 }),
        ]),
      }),
    );
    expect((store.get(`recent-frames/${SESSION_UUID}`) as { frames: unknown[] }).frames).toHaveLength(50);
  });

  it('evicts expired caches and trims active recent frames during alarm', async () => {
    const { state, store } = createState();
    const now = new Date().toISOString();
    store.set('conversation/index', [
      {
        conversation_uuid: '44444444-4444-4444-8444-444444444444',
        latest_session_uuid: SESSION_UUID,
        status: 'detached',
        updated_at: now,
      },
    ]);
    store.set('conversation/active-pointers', {
      conversation_uuid: '44444444-4444-4444-8444-444444444444',
      session_uuid: SESSION_UUID,
      turn_uuid: null,
    });
    store.set(`recent-frames/${SESSION_UUID}`, {
      updated_at: now,
      frames: Array.from({ length: 55 }, (_, index) => ({
        kind: 'event',
        seq: index + 1,
        name: 'session.stream.event',
        payload: { kind: 'session.update', phase: 'attached' },
      })),
    });
    store.set(`cache/status:${SESSION_UUID}`, {
      key: `status:${SESSION_UUID}`,
      value: { ok: true },
      expires_at: '2000-01-01T00:00:00.000Z',
    });

    const userDo = new NanoOrchestratorUserDO(state, {
      NANO_INTERNAL_BINDING_SECRET: 'secret',
    });

    await userDo.alarm();

    expect((store.get(`recent-frames/${SESSION_UUID}`) as { frames: unknown[] }).frames).toHaveLength(50);
    expect(store.has(`cache/status:${SESSION_UUID}`)).toBe(false);
  });

  it('accepts rpc-backed status parity when object keys arrive in different order', async () => {
    const { state, store } = createState();
    store.set(`sessions/${SESSION_UUID}`, {
      created_at: 'a',
      last_seen_at: 'a',
      status: 'detached',
      last_phase: 'attached',
      relay_cursor: -1,
      ended_at: null,
    });
    store.set(USER_AUTH_SNAPSHOT_KEY, {
      sub: USER_UUID,
      user_uuid: USER_UUID,
      team_uuid: '44444444-4444-4444-8444-444444444444',
      tenant_uuid: '44444444-4444-4444-8444-444444444444',
      tenant_source: 'claim',
    });
    const userDo = new NanoOrchestratorUserDO(state, {
      AGENT_CORE: {
        fetch: async () => Response.json({ ok: true, action: 'status', phase: 'attached' }),
        status: async () => ({
          status: 200,
          body: { phase: 'attached', action: 'status', ok: true },
        }),
      } as any,
      NANO_INTERNAL_BINDING_SECRET: 'secret',
    });

    const response = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/status`),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, action: 'status', phase: 'attached' });
  });

  it('returns typed invalid-stream-frame when internal NDJSON violates the façade schema', async () => {
    const { state } = createState();
    const agentFetch = async (request: Request): Promise<Response> => {
      const pathname = new URL(request.url).pathname;
      if (pathname.endsWith('/start')) {
        return Response.json({ ok: true, action: 'start', phase: 'attached' });
      }
      if (pathname.endsWith('/stream')) {
        return new Response(
          makeNdjson([
            JSON.stringify({ kind: 'meta', seq: 0, event: 'opened', session_uuid: SESSION_UUID }),
            JSON.stringify({ kind: 'terminal', seq: -1, terminal: 'completed' }),
          ]),
          { headers: { 'Content-Type': 'application/x-ndjson' } },
        );
      }
      return Response.json({ error: 'not-found' }, { status: 404 });
    };

    // ZX4 P9-01: post-flip — start RPC mock alongside fetch (used for /stream NDJSON).
    const userDo = new NanoOrchestratorUserDO(state, {
      AGENT_CORE: {
        fetch: agentFetch,
        start: async () => ({
          status: 200,
          body: { ok: true, action: 'start', phase: 'attached' },
        }),
      } as any,
      NANO_INTERNAL_BINDING_SECRET: 'secret',
    });

    const response = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          initial_input: 'hello',
          auth_snapshot: { sub: USER_UUID, tenant_source: 'deploy-fill' },
          initial_context_seed: { default_layers: [], user_memory_ref: null },
        }),
      }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: 'invalid-stream-frame',
      session_uuid: SESSION_UUID,
    });
  });

  // ZX1-ZX2 review (Kimi R6 / GPT R5): /me/sessions mints a UUID; the
  // first /sessions/{id}/start owns it. A second start on the same UUID
  // must 409 instead of overwriting an active or terminal session.
  it('rejects duplicate /start with 409 session-already-started when session entry already exists', async () => {
    const { state, store } = createState();
    store.set(`sessions/${SESSION_UUID}`, {
      created_at: 'a',
      last_seen_at: 'a',
      status: 'detached',
      last_phase: 'attached',
      relay_cursor: -1,
      ended_at: null,
    });
    const agentFetch = vi.fn(async () => Response.json({ ok: true }));

    const userDo = new NanoOrchestratorUserDO(state, {
      AGENT_CORE: { fetch: agentFetch } as Fetcher,
      NANO_INTERNAL_BINDING_SECRET: 'secret',
    });

    const response = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          initial_input: 'hello',
          auth_snapshot: { sub: USER_UUID, tenant_source: 'deploy-fill' },
          initial_context_seed: { default_layers: [], user_memory_ref: null },
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'session-already-started',
      session_uuid: SESSION_UUID,
      current_status: 'detached',
    });
    expect(agentFetch).not.toHaveBeenCalled();
    // Existing entry must NOT be overwritten.
    expect((store.get(`sessions/${SESSION_UUID}`) as { status: string }).status).toBe('detached');
  });

  // ZX4 P3-07 — ingress guard: KV miss + D1 'pending' returns a distinct
  // 409 (`session-pending-only-start-allowed`) instead of generic 404,
  // so clients can tell "minted but never started" apart from "never minted".
  describe('ZX4 P3-07 pending ingress guard', () => {
    function userDoWithDurableStatus(status: string | null) {
      const { state, store } = createState();
      const userDo = new NanoOrchestratorUserDO(state, {
        AGENT_CORE: {
          fetch: async () => Response.json({ ok: true }),
        } as Fetcher,
        NANO_INTERNAL_BINDING_SECRET: 'secret',
      });
      (userDo as any).sessionTruth = () => ({
        readSessionStatus: vi.fn().mockResolvedValue(status),
        readSnapshot: vi.fn().mockResolvedValue(null),
      });
      return { userDo, store };
    }

    const followups: Array<{ method: 'POST' | 'GET'; action: string; body?: object }> = [
      { method: 'POST', action: 'input', body: { text: 'hi', auth_snapshot: { sub: USER_UUID } } },
      { method: 'POST', action: 'cancel', body: { reason: 'stop' } },
      { method: 'POST', action: 'verify', body: { check: 'initial-context' } },
      { method: 'GET', action: 'status' },
      { method: 'GET', action: 'history' },
      { method: 'GET', action: 'timeline' },
      { method: 'GET', action: 'usage' },
    ];

    for (const { method, action, body } of followups) {
      it(`rejects ${method} /${action} with session-pending-only-start-allowed when D1 row is pending`, async () => {
        const { userDo } = userDoWithDurableStatus('pending');
        const response = await userDo.fetch(
          new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/${action}`, {
            method,
            headers: body ? { 'content-type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
          }),
        );
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({
          error: 'session-pending-only-start-allowed',
          session_uuid: SESSION_UUID,
          current_status: 'pending',
        });
      });
    }

    it('rejects POST /input with session-expired when D1 row is expired', async () => {
      const { userDo } = userDoWithDurableStatus('expired');
      const response = await userDo.fetch(
        new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/input`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'hi' }),
        }),
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: 'session-expired',
        session_uuid: SESSION_UUID,
        current_status: 'expired',
      });
    });

    it('falls through to 404 session_missing when D1 row is absent', async () => {
      const { userDo } = userDoWithDurableStatus(null);
      const response = await userDo.fetch(
        new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/input`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: 'hi' }),
        }),
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: 'session_missing' });
    });

    it('rejects POST /start with session-expired when D1 row is expired', async () => {
      const { userDo } = userDoWithDurableStatus('expired');
      const response = await userDo.fetch(
        new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            initial_input: 'hi',
            auth_snapshot: { sub: USER_UUID, tenant_source: 'deploy-fill' },
            initial_context_seed: { default_layers: [], user_memory_ref: null },
          }),
        }),
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: 'session-expired',
        session_uuid: SESSION_UUID,
        current_status: 'expired',
      });
    });

    // ZX4 Phase 4 / 6 — decision forwarding contract. orchestrator-core
    // forwards to agent-core via the RPC binding; the KV-side fallback
    // record must persist regardless of RPC availability so a future
    // kernel waiter can resolve via storage scan.
    it('P4-01: forwards permission decision to agent-core RPC and stores KV fallback', async () => {
      const { state, store } = createState();
      store.set(USER_AUTH_SNAPSHOT_KEY, {
        sub: USER_UUID,
        user_uuid: USER_UUID,
        team_uuid: '44444444-4444-4444-8444-444444444444',
        tenant_uuid: '44444444-4444-4444-8444-444444444444',
        tenant_source: 'claim',
      });
      store.set(`sessions/${SESSION_UUID}`, {
        created_at: 'a', last_seen_at: 'a', status: 'active',
        last_phase: 'attached', relay_cursor: -1, ended_at: null,
      });
      const permissionDecision = vi.fn().mockResolvedValue({ status: 200, body: { ok: true } });
      const userDo = new NanoOrchestratorUserDO(state, {
        AGENT_CORE: { fetch: async () => Response.json({}), permissionDecision } as any,
        NANO_INTERNAL_BINDING_SECRET: 'secret',
      });

      const requestUuid = '99999999-9999-4999-8999-999999999999';
      const response = await userDo.fetch(
        new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/permission/decision`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ request_uuid: requestUuid, decision: 'allow', scope: 'once' }),
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        data: { request_uuid: requestUuid, decision: 'allow', scope: 'once' },
      });
      expect(permissionDecision).toHaveBeenCalledTimes(1);
      expect(permissionDecision.mock.calls[0][0]).toMatchObject({
        session_uuid: SESSION_UUID,
        request_uuid: requestUuid,
        decision: 'allow',
        scope: 'once',
      });
      expect(store.get(`permission_decision/${requestUuid}`)).toMatchObject({
        request_uuid: requestUuid,
        decision: 'allow',
        scope: 'once',
      });
    });

    it('P4-01: returns 200 even if agent-core RPC throws (fallback to KV record)', async () => {
      const { state, store } = createState();
      store.set(USER_AUTH_SNAPSHOT_KEY, { sub: USER_UUID, tenant_source: 'deploy-fill' });
      const permissionDecision = vi.fn().mockRejectedValue(new Error('rpc-down'));
      const userDo = new NanoOrchestratorUserDO(state, {
        AGENT_CORE: { fetch: async () => Response.json({}), permissionDecision } as any,
        NANO_INTERNAL_BINDING_SECRET: 'secret',
      });
      const requestUuid = '99999999-9999-4999-8999-999999999991';
      const response = await userDo.fetch(
        new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/permission/decision`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ request_uuid: requestUuid, decision: 'deny' }),
        }),
      );
      expect(response.status).toBe(200);
      expect(store.get(`permission_decision/${requestUuid}`)).toMatchObject({
        request_uuid: requestUuid,
        decision: 'deny',
      });
    });

    it('P6-01: elicitation/answer forwards to agent-core RPC and stores KV fallback', async () => {
      const { state, store } = createState();
      store.set(USER_AUTH_SNAPSHOT_KEY, {
        sub: USER_UUID,
        user_uuid: USER_UUID,
        team_uuid: '44444444-4444-4444-8444-444444444444',
        tenant_source: 'claim',
      });
      const elicitationAnswer = vi.fn().mockResolvedValue({ status: 200, body: { ok: true } });
      const userDo = new NanoOrchestratorUserDO(state, {
        AGENT_CORE: { fetch: async () => Response.json({}), elicitationAnswer } as any,
        NANO_INTERNAL_BINDING_SECRET: 'secret',
      });
      const requestUuid = '99999999-9999-4999-8999-999999999992';
      const response = await userDo.fetch(
        new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/elicitation/answer`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ request_uuid: requestUuid, answer: 'forty-two' }),
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        data: { request_uuid: requestUuid, answer: 'forty-two' },
      });
      expect(elicitationAnswer).toHaveBeenCalledTimes(1);
      expect(elicitationAnswer.mock.calls[0][0]).toMatchObject({
        session_uuid: SESSION_UUID,
        request_uuid: requestUuid,
        answer: 'forty-two',
      });
      expect(store.get(`elicitation_answer/${requestUuid}`)).toMatchObject({
        request_uuid: requestUuid,
        answer: 'forty-two',
      });
    });

    it('P6-01: rejects elicitation/answer without answer field', async () => {
      const { state } = createState();
      const userDo = new NanoOrchestratorUserDO(state, {
        AGENT_CORE: { fetch: async () => Response.json({}) } as any,
        NANO_INTERNAL_BINDING_SECRET: 'secret',
      });
      const response = await userDo.fetch(
        new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/elicitation/answer`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ request_uuid: '99999999-9999-4999-8999-999999999993' }),
        }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'invalid-input' });
    });

    it('rejects POST /start with session-already-started when D1 row is ended', async () => {
      const { userDo } = userDoWithDurableStatus('ended');
      const response = await userDo.fetch(
        new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            initial_input: 'hi',
            auth_snapshot: { sub: USER_UUID, tenant_source: 'deploy-fill' },
            initial_context_seed: { default_layers: [], user_memory_ref: null },
          }),
        }),
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: 'session-already-started',
        current_status: 'ended',
      });
    });
  });

  // ZX5 F4 — handleStart idempotency: D1 conditional UPDATE (per Q11 owner
  // 修法 b). When two concurrent /start requests reach the pending row,
  // only the first one's claimPendingForStart returns true; the rest get
  // 409 immediately and don't run the start side-effects.
  describe('ZX5 F4 handleStart idempotency', () => {
    it('returns 409 when claimPendingForStart returns false (concurrent retry)', async () => {
      const { state } = createState();
      const userDo = new NanoOrchestratorUserDO(state, {
        AGENT_CORE: { fetch: async () => Response.json({ ok: true }) } as Fetcher,
        NANO_INTERNAL_BINDING_SECRET: 'secret',
      });
      const claim = vi.fn().mockResolvedValue(false);
      const beginSession = vi.fn();
      (userDo as any).sessionTruth = () => ({
        readSessionStatus: vi.fn().mockResolvedValue('pending'),
        claimPendingForStart: claim,
        readSnapshot: vi.fn().mockResolvedValue(null),
        beginSession,
        appendActivity: vi.fn(),
      });
      const response = await userDo.fetch(
        new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            initial_input: 'hi',
            auth_snapshot: { sub: USER_UUID, tenant_source: 'deploy-fill' },
            initial_context_seed: { default_layers: [], user_memory_ref: null },
          }),
        }),
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: 'session-already-started',
        current_status: 'starting',
      });
      expect(claim).toHaveBeenCalledTimes(1);
      expect(beginSession).not.toHaveBeenCalled();
    });

    it('proceeds with start when claimPendingForStart returns true (winner)', async () => {
      const { state, store } = createState();
      const userDo = new NanoOrchestratorUserDO(state, {
        AGENT_CORE: {
          fetch: async (request: Request) => {
            const pathname = new URL(request.url).pathname;
            if (pathname.endsWith('/start')) {
              return Response.json({ ok: true, action: 'start', phase: 'attached' });
            }
            if (pathname.endsWith('/stream')) {
              return new Response(
                makeNdjson([
                  JSON.stringify({ kind: 'meta', seq: 0, event: 'opened', session_uuid: SESSION_UUID }),
                ]),
                { headers: { 'Content-Type': 'application/x-ndjson' } },
              );
            }
            return Response.json({ error: 'not-found' }, { status: 404 });
          },
          start: async () => ({ status: 200, body: { ok: true, action: 'start', phase: 'attached' } }),
        } as any,
        NANO_INTERNAL_BINDING_SECRET: 'secret',
      });
      const claim = vi.fn().mockResolvedValue(true);
      (userDo as any).sessionTruth = () => ({
        readSessionStatus: vi.fn().mockResolvedValue('pending'),
        claimPendingForStart: claim,
        readSnapshot: vi.fn().mockResolvedValue(null),
        beginSession: vi.fn().mockResolvedValue({
          conversation_uuid: '44444444-4444-4444-8444-444444444444',
          session_uuid: SESSION_UUID,
          conversation_created: false,
        }),
        createTurn: vi.fn().mockResolvedValue({
          turn_uuid: '55555555-5555-4555-8555-555555555555',
          turn_index: 1,
        }),
        appendMessage: vi.fn(),
        appendActivity: vi.fn(),
        captureContextSnapshot: vi.fn(),
        updateSessionState: vi.fn(),
        closeTurn: vi.fn(),
      });

      const response = await userDo.fetch(
        new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            initial_input: 'hello',
            auth_snapshot: { sub: USER_UUID, tenant_source: 'deploy-fill' },
            initial_context_seed: { default_layers: [], user_memory_ref: null },
          }),
        }),
      );
      expect(response.status).toBe(200);
      expect(claim).toHaveBeenCalledTimes(1);
      expect(store.has(`sessions/${SESSION_UUID}`)).toBe(true);
    });
  });
});
