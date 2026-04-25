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
