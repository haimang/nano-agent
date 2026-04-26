export interface AuthState {
  readonly token: string;
  readonly refreshToken: string;
  readonly teamUuid: string;
  readonly userUuid: string;
}

export interface SessionEvent {
  readonly kind?: string;
  readonly seq?: number;
  readonly [key: string]: unknown;
}

export interface WorkerHealthEntry {
  readonly worker: string;
  readonly live: boolean;
  readonly status: string;
  readonly worker_version: string | null;
  readonly error?: string;
  readonly details?: Record<string, unknown>;
}

export interface WorkerHealthSnapshot {
  readonly ok: boolean;
  readonly environment: string;
  readonly generated_at: string;
  readonly summary: {
    readonly live: number;
    readonly total: number;
  };
  readonly workers: WorkerHealthEntry[];
}

export interface NanoClientOptions {
  readonly baseUrl: string;
  readonly traceUuid: () => string;
}

export interface ClientErrorDetails {
  readonly kind: "auth.expired" | "quota.exceeded" | "runtime.error" | "request.error";
  readonly status: number;
  readonly message: string;
  readonly code?: string;
  readonly quotaKind?: string;
  readonly remaining?: number;
  readonly limitValue?: number;
}

export class NanoClientError extends Error {
  constructor(readonly details: ClientErrorDetails) {
    super(details.message);
  }
}

export class NanoClient {
  constructor(private readonly options: NanoClientOptions) {}

  async register(email: string, password: string, displayName: string): Promise<AuthState> {
    await this.envelope("/auth/register", {
      email,
      password,
      display_name: displayName,
    });
    return this.login(email, password);
  }

  async login(email: string, password: string): Promise<AuthState> {
    const body = await this.envelope("/auth/login", { email, password });
    const data = body.data as {
      tokens?: { access_token?: string; refresh_token?: string };
      team?: { team_uuid?: string };
      user?: { user_uuid?: string };
    };
    if (!data.tokens?.access_token || !data.tokens.refresh_token || !data.team?.team_uuid || !data.user?.user_uuid) {
      throw new Error("login response missing token/team/user");
    }
    return {
      token: data.tokens.access_token,
      refreshToken: data.tokens.refresh_token,
      teamUuid: data.team.team_uuid,
      userUuid: data.user.user_uuid,
    };
  }

  async me(auth: AuthState): Promise<unknown> {
    return this.json("/me", { headers: this.authHeaders(auth) });
  }

  async workerHealth(): Promise<WorkerHealthSnapshot> {
    return (await this.json("/debug/workers/health")) as unknown as WorkerHealthSnapshot;
  }

  async startSession(auth: AuthState, sessionUuid: string, initialInput: string): Promise<unknown> {
    return this.json(`/sessions/${sessionUuid}/start`, {
      method: "POST",
      headers: this.authHeaders(auth, true),
      body: JSON.stringify({ initial_input: initialInput }),
    });
  }

  async sendInput(auth: AuthState, sessionUuid: string, text: string): Promise<unknown> {
    return this.json(`/sessions/${sessionUuid}/input`, {
      method: "POST",
      headers: this.authHeaders(auth, true),
      body: JSON.stringify({ text, session_uuid: sessionUuid }),
    });
  }

  async timeline(auth: AuthState, sessionUuid: string): Promise<SessionEvent[]> {
    const body = await this.json(`/sessions/${sessionUuid}/timeline`, {
      headers: this.authHeaders(auth),
    });
    return Array.isArray((body as { events?: unknown }).events)
      ? ((body as { events: SessionEvent[] }).events)
      : [];
  }

  openStream(
    auth: AuthState,
    sessionUuid: string,
    onEvent: (event: SessionEvent) => void,
    options: { readonly lastSeenSeq?: number } = {},
  ): WebSocket {
    const url = new URL(`${this.options.baseUrl}/sessions/${sessionUuid}/ws`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("access_token", auth.token);
    url.searchParams.set("trace_uuid", this.options.traceUuid());
    url.searchParams.set("last_seen_seq", String(Math.max(0, Math.trunc(options.lastSeenSeq ?? 0))));
    const socket = new WebSocket(url);
    let lastHeartbeatSentAt = 0;
    const sendHeartbeat = () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      if (now - lastHeartbeatSentAt < 15_000) return;
      lastHeartbeatSentAt = now;
      socket.send(JSON.stringify({ message_type: "session.heartbeat", body: { ts: now } }));
    };
    const heartbeatTimer = window.setInterval(sendHeartbeat, 15_000);
    const cleanup = () => window.clearInterval(heartbeatTimer);
    socket.addEventListener("open", () => {
      sendHeartbeat();
      socket.send(JSON.stringify({
        message_type: "session.resume",
        body: { last_seen_seq: Math.max(0, Math.trunc(options.lastSeenSeq ?? 0)) },
      }));
    });
    socket.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(event.data) as SessionEvent;
        if (typeof parsed.seq === "number" && Number.isFinite(parsed.seq) && parsed.seq > 0) {
          socket.dispatchEvent(new CustomEvent("nano:seq", { detail: parsed.seq }));
          socket.send(JSON.stringify({
            message_type: "session.stream.ack",
            body: { stream_uuid: "main", acked_seq: parsed.seq },
          }));
        }
        onEvent(parsed);
      } catch {
        onEvent({ kind: "client.invalid_json", raw: event.data });
      }
    });
    socket.addEventListener("close", cleanup);
    socket.addEventListener("error", cleanup);
    return socket;
  }

  private authHeaders(auth: AuthState, json = false): HeadersInit {
    return {
      authorization: `Bearer ${auth.token}`,
      "x-trace-uuid": this.options.traceUuid(),
      ...(json ? { "content-type": "application/json" } : {}),
    };
  }

  private async envelope(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.json(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-trace-uuid": this.options.traceUuid(),
      },
      body: JSON.stringify(body),
    });
  }

  private async json(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.options.baseUrl}${path}`, init);
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok || body.ok === false) {
      const error = (body.error && typeof body.error === "object" ? body.error : body) as Record<string, unknown>;
      const code = typeof error.code === "string" ? error.code : typeof body.error === "string" ? body.error : undefined;
      const message = typeof error.message === "string"
        ? error.message
        : typeof body.message === "string"
          ? body.message
          : `HTTP ${response.status}`;
      throw new NanoClientError({
        kind: response.status === 401
          ? "auth.expired"
          : code === "QUOTA_EXCEEDED" || response.status === 429
            ? "quota.exceeded"
            : response.status >= 500
              ? "runtime.error"
              : "request.error",
        status: response.status,
        message,
        ...(code ? { code } : {}),
        ...(typeof error.quota_kind === "string" ? { quotaKind: error.quota_kind } : {}),
        ...(typeof error.remaining === "number" ? { remaining: error.remaining } : {}),
        ...(typeof error.limit_value === "number" ? { limitValue: error.limit_value } : {}),
      });
    }
    return body;
  }
}
