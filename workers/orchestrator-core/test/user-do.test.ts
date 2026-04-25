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

    const userDo = new NanoOrchestratorUserDO(state, {
      AGENT_CORE: { fetch: agentFetch } as Fetcher,
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

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: 'invalid-stream-frame',
      session_uuid: SESSION_UUID,
    });
  });
});
