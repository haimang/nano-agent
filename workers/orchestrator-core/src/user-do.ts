import type { AuthSnapshot, InitialContextSeed } from './auth.js';

export interface OrchestratorUserEnv {
  readonly AGENT_CORE?: Fetcher;
  readonly NANO_INTERNAL_BINDING_SECRET?: string;
}

export interface DurableObjectStateLike {
  readonly storage?: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put<T = unknown>(key: string, value: T): Promise<void>;
    delete?(key: string): Promise<void>;
  };
}

export type SessionStatus = 'starting' | 'active' | 'detached' | 'ended';
export type TerminalKind = 'completed' | 'cancelled' | 'error';

export interface SessionEntry {
  readonly created_at: string;
  readonly last_seen_at: string;
  readonly status: SessionStatus;
  readonly last_phase: string | null;
  readonly relay_cursor: number;
  readonly ended_at: string | null;
}

interface SessionTerminalRecord {
  readonly terminal: TerminalKind;
  readonly last_phase: string | null;
  readonly ended_at: string;
}

interface StartSessionBody {
  readonly initial_input?: string;
  readonly text?: string;
  readonly initial_context?: unknown;
  readonly trace_uuid?: string;
  readonly auth_snapshot?: AuthSnapshot;
  readonly initial_context_seed?: InitialContextSeed;
}

interface FollowupBody {
  readonly text?: string;
  readonly context_ref?: unknown;
  readonly stream_seq?: number;
  readonly trace_uuid?: string;
  readonly auth_snapshot?: AuthSnapshot;
  readonly initial_context_seed?: InitialContextSeed;
}

interface CancelBody {
  readonly reason?: string;
  readonly trace_uuid?: string;
  readonly auth_snapshot?: AuthSnapshot;
  readonly initial_context_seed?: InitialContextSeed;
}

interface VerifyBody {
  readonly trace_uuid?: string;
  readonly auth_snapshot?: AuthSnapshot;
  readonly initial_context_seed?: InitialContextSeed;
  readonly [key: string]: unknown;
}

type StreamFrame =
  | { kind: 'meta'; seq: 0; event: 'opened'; session_uuid: string }
  | { kind: 'event'; seq: number; name: 'session.stream.event'; payload: Record<string, unknown> }
  | { kind: 'terminal'; seq: number; terminal: TerminalKind; payload?: Record<string, unknown> };

type StreamReadResult =
  | { ok: true; frames: StreamFrame[] }
  | { ok: false; response: Response };

interface WorkerSocketLike {
  accept?(): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener?: (type: 'message' | 'close', handler: (event?: unknown) => void) => void;
}

interface AttachmentState {
  readonly socket: WorkerSocketLike;
  readonly attached_at: string;
}

interface EndedIndexItem {
  readonly session_uuid: string;
  readonly ended_at: string;
}

const USER_META_KEY = 'user/meta';
const USER_AUTH_SNAPSHOT_KEY = 'user/auth-snapshot';
const USER_SEED_KEY = 'user/seed';
const ENDED_INDEX_KEY = 'sessions/ended-index';
const MAX_ENDED_SESSIONS = 100;
const ENDED_TTL_MS = 24 * 60 * 60 * 1000;

function sessionKey(sessionUuid: string): string {
  return `sessions/${sessionUuid}`;
}

function terminalKey(sessionUuid: string): string {
  return `session-terminal/${sessionUuid}`;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status });
}

function isAuthSnapshot(value: unknown): value is AuthSnapshot {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { sub?: unknown }).sub === 'string' &&
    ((value as { tenant_source?: unknown }).tenant_source === undefined ||
      (value as { tenant_source?: unknown }).tenant_source === 'claim' ||
      (value as { tenant_source?: unknown }).tenant_source === 'deploy-fill')
  );
}

function sessionMissingResponse(sessionUuid: string): Response {
  return jsonResponse(404, { error: 'session_missing', session_uuid: sessionUuid });
}

function sessionTerminalResponse(
  sessionUuid: string,
  terminal: SessionTerminalRecord | null,
): Response {
  return jsonResponse(409, {
    error: 'session_terminal',
    session_uuid: sessionUuid,
    terminal: terminal?.terminal ?? 'completed',
    ...(terminal?.last_phase ? { last_phase: terminal.last_phase } : {}),
  });
}

class InvalidStreamFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStreamFrameError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function parseStreamFrame(value: unknown, context: string): StreamFrame {
  if (!isRecord(value)) {
    throw new InvalidStreamFrameError(`${context}: frame must be an object`);
  }
  if (value.kind === 'meta') {
    if (value.seq !== 0 || value.event !== 'opened' || typeof value.session_uuid !== 'string' || value.session_uuid.length === 0) {
      throw new InvalidStreamFrameError(`${context}: invalid meta frame`);
    }
    return {
      kind: 'meta',
      seq: 0,
      event: 'opened',
      session_uuid: value.session_uuid,
    };
  }
  if (value.kind === 'event') {
    if (!isNonNegativeInteger(value.seq) || value.seq < 1 || value.name !== 'session.stream.event' || !isRecord(value.payload)) {
      throw new InvalidStreamFrameError(`${context}: invalid event frame`);
    }
    return {
      kind: 'event',
      seq: value.seq,
      name: 'session.stream.event',
      payload: value.payload,
    };
  }
  if (value.kind === 'terminal') {
    if (!isNonNegativeInteger(value.seq) || value.seq < 1) {
      throw new InvalidStreamFrameError(`${context}: invalid terminal seq`);
    }
    if (value.terminal !== 'completed' && value.terminal !== 'cancelled' && value.terminal !== 'error') {
      throw new InvalidStreamFrameError(`${context}: invalid terminal kind`);
    }
    if (value.payload !== undefined && !isRecord(value.payload)) {
      throw new InvalidStreamFrameError(`${context}: invalid terminal payload`);
    }
    return {
      kind: 'terminal',
      seq: value.seq,
      terminal: value.terminal,
      ...(value.payload !== undefined ? { payload: value.payload } : {}),
    };
  }
  throw new InvalidStreamFrameError(`${context}: unknown frame kind`);
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

async function readNdjsonFrames(response: Response): Promise<StreamFrame[]> {
  if (!response.body) return [];
  const frames: StreamFrame[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const idx = buffer.indexOf('\n');
      if (idx === -1) break;
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new InvalidStreamFrameError(`stream line ${frames.length + 1}: malformed JSON`);
      }
      frames.push(parseStreamFrame(parsed, `stream line ${frames.length + 1}`));
    }
  }

  buffer += decoder.decode();
  const lastLine = buffer.trim();
  if (lastLine) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lastLine);
    } catch {
      throw new InvalidStreamFrameError(`stream line ${frames.length + 1}: malformed JSON`);
    }
    frames.push(parseStreamFrame(parsed, `stream line ${frames.length + 1}`));
  }
  return frames;
}

function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket';
}

function extractPhase(body: Record<string, unknown> | null): string | null {
  return typeof body?.phase === 'string' ? body.phase : null;
}

function createWebSocketPair(): { client: unknown; server: WorkerSocketLike } | null {
  const Pair = (
    globalThis as unknown as {
      WebSocketPair?: new () => { 0: WorkerSocketLike; 1: WorkerSocketLike };
    }
  ).WebSocketPair;
  if (!Pair) return null;
  const pair = new Pair();
  return { client: pair[0], server: pair[1] };
}

export class NanoOrchestratorUserDO {
  private readonly attachments = new Map<string, AttachmentState>();

  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: OrchestratorUserEnv,
  ) {}

  async fetch(request: Request): Promise<Response> {
    await this.cleanupEndedSessions();

    const segments = new URL(request.url).pathname.split('/').filter(Boolean);
    if (segments.length !== 3 || segments[0] !== 'sessions') {
      return jsonResponse(404, { error: 'not-found', message: 'user DO route not found' });
    }

    const sessionUuid = segments[1]!;
    const action = segments[2]!;

    if (request.method === 'POST' && action === 'start') {
      const body = (await request.json().catch(() => null)) as StartSessionBody | null;
      if (!body || typeof body !== 'object') {
        return jsonResponse(400, { error: 'invalid-start-body', message: 'start requires a JSON body' });
      }
      return this.handleStart(sessionUuid, body);
    }

    if (request.method === 'POST' && action === 'input') {
      const body = (await request.json().catch(() => null)) as FollowupBody | null;
      if (!body || typeof body !== 'object') {
        return jsonResponse(400, { error: 'invalid-input-body', message: 'input requires a JSON body' });
      }
      return this.handleInput(sessionUuid, body);
    }

    if (request.method === 'POST' && action === 'cancel') {
      const body = (await request.json().catch(() => ({}))) as CancelBody;
      return this.handleCancel(sessionUuid, body ?? {});
    }

    if (request.method === 'POST' && action === 'verify') {
      const body = (await request.json().catch(() => null)) as VerifyBody | null;
      if (!body || typeof body !== 'object') {
        return jsonResponse(400, { error: 'invalid-verify-body', message: 'verify requires a JSON body' });
      }
      return this.handleVerify(sessionUuid, body);
    }

    if (request.method === 'GET' && action === 'status') return this.handleRead(sessionUuid, 'status');
    if (request.method === 'GET' && action === 'timeline') return this.handleRead(sessionUuid, 'timeline');
    if (request.method === 'GET' && action === 'ws') return this.handleWsAttach(sessionUuid, request);

    return jsonResponse(404, { error: 'not-found', message: 'user DO route not found' });
  }

  private async handleStart(sessionUuid: string, body: StartSessionBody): Promise<Response> {
    const initialInput =
      typeof body.initial_input === 'string' && body.initial_input.length > 0
        ? body.initial_input
        : typeof body.text === 'string' && body.text.length > 0
          ? body.text
          : null;
    if (!initialInput) {
      return jsonResponse(400, { error: 'invalid-start-body', message: 'start requires initial_input / text' });
    }
    if (!body.auth_snapshot || typeof body.auth_snapshot.sub !== 'string' || body.auth_snapshot.sub.length === 0) {
      return jsonResponse(400, { error: 'invalid-auth-snapshot', message: 'auth_snapshot.sub is required' });
    }

    const now = new Date().toISOString();
    const startingEntry: SessionEntry = {
      created_at: now,
      last_seen_at: now,
      status: 'starting',
      last_phase: null,
      relay_cursor: -1,
      ended_at: null,
    };

    await this.refreshUserState(body.auth_snapshot, body.initial_context_seed);
    await this.put(sessionKey(sessionUuid), startingEntry);

    const startAck = await this.forwardInternalJson(sessionUuid, 'start', {
      initial_input: initialInput,
      ...(body.initial_context !== undefined ? { initial_context: body.initial_context } : {}),
      ...(typeof body.trace_uuid === 'string' ? { trace_uuid: body.trace_uuid } : {}),
      authority: body.auth_snapshot,
    });
    if (!startAck.response.ok) {
      return jsonResponse(startAck.response.status, {
        error: 'agent-start-failed',
        message: 'agent-core internal start failed',
        start_ack: startAck.body,
      });
    }

    const stream = await this.readInternalStream(sessionUuid);
    if (!stream.ok) return stream.response;
    const frames = stream.frames;
    let entry: SessionEntry = {
      ...startingEntry,
      last_seen_at: new Date().toISOString(),
      last_phase: extractPhase(startAck.body),
      status: this.attachments.has(sessionUuid) ? 'active' : 'detached',
    };
    await this.put(sessionKey(sessionUuid), entry);
    entry = await this.forwardFramesToAttachment(sessionUuid, entry, frames);

    const firstEvent =
      frames.find((frame): frame is Extract<StreamFrame, { kind: 'event' }> => frame.kind === 'event') ?? null;

    return jsonResponse(200, {
      ok: true,
      action: 'start',
      session_uuid: sessionUuid,
      user_uuid: body.auth_snapshot.sub,
      last_phase: entry.last_phase,
      status: entry.status,
      relay_cursor: entry.relay_cursor,
      first_event: firstEvent?.payload ?? null,
      terminal: null,
      start_ack: startAck.body,
    });
  }

  private async handleInput(sessionUuid: string, body: FollowupBody): Promise<Response> {
    const entry = await this.requireSession(sessionUuid);
    if (!entry) return sessionMissingResponse(sessionUuid);
    if (entry.status === 'ended') return sessionTerminalResponse(sessionUuid, await this.getTerminal(sessionUuid));
    if (typeof body.text !== 'string' || body.text.length === 0) {
      return jsonResponse(400, { error: 'invalid-input-body', message: 'input requires non-empty text' });
    }
    if (body.auth_snapshot) await this.refreshUserState(body.auth_snapshot, body.initial_context_seed);

    const inputAck = await this.forwardInternalJson(sessionUuid, 'input', {
      text: body.text,
      ...(body.context_ref !== undefined ? { context_ref: body.context_ref } : {}),
      ...(body.stream_seq !== undefined ? { stream_seq: body.stream_seq } : {}),
      ...(typeof body.trace_uuid === 'string' ? { trace_uuid: body.trace_uuid } : {}),
      ...(body.auth_snapshot ? { authority: body.auth_snapshot } : {}),
    });
    if (!inputAck.response.ok) {
      return this.cloneJsonResponse(inputAck.response.status, inputAck.body);
    }

    const stream = await this.readInternalStream(sessionUuid);
    if (!stream.ok) return stream.response;
    const frames = stream.frames;
    let nextEntry: SessionEntry = {
      ...entry,
      last_seen_at: new Date().toISOString(),
      last_phase: extractPhase(inputAck.body) ?? entry.last_phase,
      status: this.attachments.has(sessionUuid) ? 'active' : 'detached',
      ended_at: null,
    };
    await this.put(sessionKey(sessionUuid), nextEntry);
    nextEntry = await this.forwardFramesToAttachment(sessionUuid, nextEntry, frames);

    return jsonResponse(inputAck.response.status, {
      ...(inputAck.body ?? { ok: true, action: 'input' }),
      session_uuid: sessionUuid,
      session_status: nextEntry.status,
      relay_cursor: nextEntry.relay_cursor,
    });
  }

  private async handleCancel(sessionUuid: string, body: CancelBody): Promise<Response> {
    const entry = await this.requireSession(sessionUuid);
    if (!entry) return sessionMissingResponse(sessionUuid);
    if (entry.status === 'ended') return sessionTerminalResponse(sessionUuid, await this.getTerminal(sessionUuid));
    if (body.auth_snapshot) await this.refreshUserState(body.auth_snapshot, body.initial_context_seed);

    const cancelAck = await this.forwardInternalJson(sessionUuid, 'cancel', {
      ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
      ...(typeof body.trace_uuid === 'string' ? { trace_uuid: body.trace_uuid } : {}),
      ...(body.auth_snapshot ? { authority: body.auth_snapshot } : {}),
    });
    if (!cancelAck.response.ok) {
      return this.cloneJsonResponse(cancelAck.response.status, cancelAck.body);
    }

    const now = new Date().toISOString();
    const terminal: SessionTerminalRecord = {
      terminal: 'cancelled',
      last_phase: extractPhase(cancelAck.body) ?? entry.last_phase,
      ended_at: now,
    };
    const nextEntry: SessionEntry = {
      ...entry,
      last_seen_at: now,
      status: 'ended',
      last_phase: terminal.last_phase,
      ended_at: now,
    };

    await this.put(sessionKey(sessionUuid), nextEntry);
    await this.put(terminalKey(sessionUuid), terminal);
    await this.rememberEndedSession(sessionUuid, now);
    await this.cleanupEndedSessions();
    await this.notifyTerminal(sessionUuid, terminal);

    return jsonResponse(cancelAck.response.status, {
      ...(cancelAck.body ?? { ok: true, action: 'cancel' }),
      session_uuid: sessionUuid,
      session_status: nextEntry.status,
      terminal: terminal.terminal,
    });
  }

  private async handleVerify(sessionUuid: string, body: VerifyBody): Promise<Response> {
    const entry = await this.requireSession(sessionUuid);
    if (!entry) return sessionMissingResponse(sessionUuid);
    if (body.auth_snapshot) await this.refreshUserState(body.auth_snapshot, body.initial_context_seed);
    const response = await this.forwardInternalRaw(sessionUuid, 'verify', body);
    return this.proxyReadResponse(sessionUuid, entry, response);
  }

  private async handleRead(sessionUuid: string, action: 'status' | 'timeline'): Promise<Response> {
    const entry = await this.requireSession(sessionUuid);
    if (!entry) return sessionMissingResponse(sessionUuid);
    const response = await this.forwardInternalRaw(sessionUuid, action);
    return this.proxyReadResponse(sessionUuid, entry, response);
  }

  private async handleWsAttach(sessionUuid: string, request: Request): Promise<Response> {
    const entry = await this.requireSession(sessionUuid);
    if (!entry) return sessionMissingResponse(sessionUuid);
    if (entry.status === 'ended') return sessionTerminalResponse(sessionUuid, await this.getTerminal(sessionUuid));
    if (!isWebSocketUpgrade(request)) {
      return jsonResponse(400, { error: 'invalid-upgrade', message: 'ws route requires websocket upgrade' });
    }

    const pair = createWebSocketPair();
    if (!pair) {
      return jsonResponse(501, { error: 'websocket-unavailable', message: 'WebSocketPair unavailable' });
    }
    pair.server.accept?.();

    const stream = await this.readInternalStream(sessionUuid);
    if (!stream.ok) return stream.response;

    const current = this.attachments.get(sessionUuid);
    if (current) {
      this.attachments.delete(sessionUuid);
      current.socket.send(
        JSON.stringify({
          kind: 'attachment_superseded',
          reason: 'replaced_by_new_attachment',
          new_attachment_at: new Date().toISOString(),
        }),
      );
      current.socket.close(4001, 'attachment_superseded');
    }

    this.attachments.set(sessionUuid, {
      socket: pair.server,
      attached_at: new Date().toISOString(),
    });
    this.bindSocketLifecycle(sessionUuid, pair.server);

    const nextEntry: SessionEntry = {
      ...entry,
      last_seen_at: new Date().toISOString(),
      status: 'active',
      ended_at: null,
    };
    await this.put(sessionKey(sessionUuid), nextEntry);
    await this.forwardFramesToAttachment(sessionUuid, nextEntry, stream.frames);

    try {
      return new Response(null, {
        status: 101,
        statusText: 'Switching Protocols',
        // @ts-expect-error Cloudflare-only webSocket init field
        webSocket: pair.client,
      });
    } catch {
      return new Response(null, { status: 200, statusText: 'Switching Protocols' });
    }
  }

  private bindSocketLifecycle(sessionUuid: string, socket: WorkerSocketLike): void {
    socket.addEventListener?.('close', () => {
      const current = this.attachments.get(sessionUuid);
      if (!current || current.socket !== socket) return;
      this.attachments.delete(sessionUuid);
      void this.markDetached(sessionUuid);
    });

    socket.addEventListener?.('message', () => {
      void this.touchSession(sessionUuid, this.attachments.has(sessionUuid) ? 'active' : 'detached');
    });
  }

  private async markDetached(sessionUuid: string): Promise<void> {
    const entry = await this.get<SessionEntry>(sessionKey(sessionUuid));
    if (!entry || entry.status === 'ended') return;
    await this.put(sessionKey(sessionUuid), {
      ...entry,
      status: 'detached',
      last_seen_at: new Date().toISOString(),
    } satisfies SessionEntry);
  }

  private async touchSession(sessionUuid: string, status: SessionStatus): Promise<void> {
    const entry = await this.get<SessionEntry>(sessionKey(sessionUuid));
    if (!entry || entry.status === 'ended') return;
    await this.put(sessionKey(sessionUuid), {
      ...entry,
      status,
      last_seen_at: new Date().toISOString(),
    } satisfies SessionEntry);
  }

  private async proxyReadResponse(
    sessionUuid: string,
    entry: SessionEntry,
    response: Response,
  ): Promise<Response> {
    const body = await readJson(response);
    await this.put(sessionKey(sessionUuid), {
      ...entry,
      last_seen_at: new Date().toISOString(),
      last_phase: extractPhase(body) ?? entry.last_phase,
    } satisfies SessionEntry);
    return this.cloneJsonResponse(
      response.status,
      body,
      response.headers.get('Content-Type') ?? 'application/json',
    );
  }

  private async forwardFramesToAttachment(
    sessionUuid: string,
    entry: SessionEntry,
    frames: readonly StreamFrame[],
  ): Promise<SessionEntry> {
    const attachment = this.attachments.get(sessionUuid);
    if (!attachment) return entry;

    let cursor = entry.relay_cursor;
    for (const frame of frames) {
      if (frame.kind !== 'event') continue;
      if (frame.seq <= cursor) continue;
      attachment.socket.send(JSON.stringify(frame));
      cursor = frame.seq;
    }

    if (cursor === entry.relay_cursor) return entry;

    const nextEntry: SessionEntry = {
      ...entry,
      relay_cursor: cursor,
      last_seen_at: new Date().toISOString(),
    };
    await this.put(sessionKey(sessionUuid), nextEntry);
    return nextEntry;
  }

  private async notifyTerminal(
    sessionUuid: string,
    terminal: SessionTerminalRecord,
  ): Promise<void> {
    const attachment = this.attachments.get(sessionUuid);
    if (!attachment) return;

    attachment.socket.send(
      JSON.stringify({
        kind: 'terminal',
        terminal: terminal.terminal,
        session_uuid: sessionUuid,
        ...(terminal.last_phase ? { last_phase: terminal.last_phase } : {}),
      }),
    );
    attachment.socket.close(1000, `session_${terminal.terminal}`);
    this.attachments.delete(sessionUuid);
  }

  private async forwardInternalJson(
    sessionUuid: string,
    action: string,
    body?: Record<string, unknown>,
  ): Promise<{ response: Response; body: Record<string, unknown> | null }> {
    const response = await this.forwardInternalRaw(sessionUuid, action, body);
    return { response, body: await readJson(response.clone()) };
  }

  private async forwardInternalRaw(
    sessionUuid: string,
    action: string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    if (!this.env.AGENT_CORE) {
      return jsonResponse(503, { error: 'agent-core-unavailable', message: 'AGENT_CORE binding missing' });
    }
    if (!this.env.NANO_INTERNAL_BINDING_SECRET) {
      return jsonResponse(503, { error: 'internal-auth-unconfigured', message: 'internal binding secret missing' });
    }

    const traceUuid =
      typeof body?.trace_uuid === 'string' && body.trace_uuid.length > 0
        ? body.trace_uuid
        : crypto.randomUUID();
    const authority = isAuthSnapshot(body?.auth_snapshot)
      ? body.auth_snapshot
      : await this.get<AuthSnapshot>(USER_AUTH_SNAPSHOT_KEY);
    if (!authority || typeof authority.sub !== 'string' || authority.sub.length === 0) {
      return jsonResponse(400, {
        error: 'missing-authority',
        message: 'internal requests require a persisted auth snapshot',
        session_uuid: sessionUuid,
      });
    }

    const headers = new Headers({
      'x-nano-internal-binding-secret': this.env.NANO_INTERNAL_BINDING_SECRET,
      'x-trace-uuid': traceUuid,
      'x-nano-internal-authority': JSON.stringify(authority),
    });
    if (body) headers.set('content-type', 'application/json');

    return this.env.AGENT_CORE.fetch(
      new Request(`https://agent.internal/internal/sessions/${sessionUuid}/${action}`, {
        method: body ? 'POST' : 'GET',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
  }

  private async readInternalStream(sessionUuid: string): Promise<StreamReadResult> {
    const response = await this.forwardInternalRaw(sessionUuid, 'stream');
    if (!response.ok) return { ok: true, frames: [] };
    try {
      return { ok: true, frames: await readNdjsonFrames(response) };
    } catch (error) {
      if (error instanceof InvalidStreamFrameError) {
        return {
          ok: false,
          response: jsonResponse(502, {
            error: 'invalid-stream-frame',
            message: error.message,
            session_uuid: sessionUuid,
          }),
        };
      }
      throw error;
    }
  }

  private async refreshUserState(
    authSnapshot?: AuthSnapshot,
    seed?: InitialContextSeed,
  ): Promise<void> {
    if (authSnapshot) {
      await this.put(USER_META_KEY, { user_uuid: authSnapshot.sub });
      await this.put(USER_AUTH_SNAPSHOT_KEY, authSnapshot);
    }
    if (seed) await this.put(USER_SEED_KEY, seed);
  }

  private async requireSession(sessionUuid: string): Promise<SessionEntry | null> {
    return (await this.get<SessionEntry>(sessionKey(sessionUuid))) ?? null;
  }

  private async getTerminal(sessionUuid: string): Promise<SessionTerminalRecord | null> {
    return (await this.get<SessionTerminalRecord>(terminalKey(sessionUuid))) ?? null;
  }

  private async rememberEndedSession(sessionUuid: string, endedAt: string): Promise<void> {
    const current = (await this.get<EndedIndexItem[]>(ENDED_INDEX_KEY)) ?? [];
    const next = [
      ...current.filter((item) => item.session_uuid !== sessionUuid),
      { session_uuid: sessionUuid, ended_at: endedAt },
    ].sort((a, b) => a.ended_at.localeCompare(b.ended_at));
    await this.put(ENDED_INDEX_KEY, next);
  }

  private async cleanupEndedSessions(now = Date.now()): Promise<void> {
    const index = (await this.get<EndedIndexItem[]>(ENDED_INDEX_KEY)) ?? [];
    const keptByTime = index.filter((item) => {
      const endedAt = Date.parse(item.ended_at);
      return Number.isFinite(endedAt) && endedAt >= now - ENDED_TTL_MS;
    });
    const kept = keptByTime.slice(-MAX_ENDED_SESSIONS);
    const keepSet = new Set(kept.map((item) => item.session_uuid));

    for (const item of index) {
      if (keepSet.has(item.session_uuid)) continue;
      await this.delete(sessionKey(item.session_uuid));
      await this.delete(terminalKey(item.session_uuid));
    }

    await this.put(ENDED_INDEX_KEY, kept);
  }

  private async get<T>(key: string): Promise<T | undefined> {
    return this.state.storage?.get<T>(key);
  }

  private async put<T>(key: string, value: T): Promise<void> {
    await this.state.storage?.put(key, value);
  }

  private async delete(key: string): Promise<void> {
    await this.state.storage?.delete?.(key);
  }

  private cloneJsonResponse(
    status: number,
    body: Record<string, unknown> | null,
    contentType = 'application/json',
  ): Response {
    return new Response(body ? JSON.stringify(body) : null, {
      status,
      headers: { 'Content-Type': contentType },
    });
  }
}
