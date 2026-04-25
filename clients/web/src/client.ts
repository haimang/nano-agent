export interface AuthState {
  readonly token: string;
  readonly refreshToken: string;
  readonly teamUuid: string;
  readonly userUuid: string;
}

export interface SessionEvent {
  readonly kind?: string;
  readonly [key: string]: unknown;
}

export interface NanoClientOptions {
  readonly baseUrl: string;
  readonly traceUuid: () => string;
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

  openStream(auth: AuthState, sessionUuid: string, onEvent: (event: SessionEvent) => void): WebSocket {
    const url = new URL(`${this.options.baseUrl}/sessions/${sessionUuid}/ws`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("access_token", auth.token);
    url.searchParams.set("trace_uuid", this.options.traceUuid());
    const socket = new WebSocket(url);
    socket.addEventListener("message", (event) => {
      try {
        onEvent(JSON.parse(event.data));
      } catch {
        onEvent({ kind: "client.invalid_json", raw: event.data });
      }
    });
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
      throw new Error(typeof body.message === "string" ? body.message : `HTTP ${response.status}`);
    }
    return body;
  }
}
