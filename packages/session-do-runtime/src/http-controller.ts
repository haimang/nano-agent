/**
 * Session DO Runtime — HTTP fallback controller (A4 Phase 3).
 *
 * Provides an HTTP action surface as a fallback for clients that cannot
 * use WebSockets. When the controller is wired to an `HttpDispatchHost`
 * (the DO provides one at construction time), the actions route to the
 * same `acceptIngress()` pipeline the WS path uses so WS and HTTP share
 * a single actor/session model.
 *
 * When no host is wired, the controller keeps its pre-A4 stub behaviour
 * so standalone `HttpController` tests keep exercising the 4xx / 2xx
 * envelope shape without needing a full DO.
 */

/** Set of supported HTTP fallback actions. */
const SUPPORTED_ACTIONS = new Set([
  "start",
  "input",
  "cancel",
  "end",
  "status",
  "timeline",
] as const);

/** Response from the controller — status + JSON body. */
export interface HttpControllerResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * Capabilities the DO lends the controller so the controller can act on
 * real session state instead of fabricating stub responses. Every method
 * is optional — the controller degrades gracefully when the DO has not
 * yet been constructed (e.g. in isolated controller tests).
 */
export interface HttpDispatchHost {
  /** Inject a client frame into the DO's ingress pipeline. */
  readonly submitFrame?: (raw: string) => Promise<void>;
  /** Read the current actor phase. */
  readonly getPhase?: () => string;
  /** Read the replay timeline — returns session stream event bodies. */
  readonly readTimeline?: () => readonly Record<string, unknown>[];
}

/** Outcome of an HTTP action, before it is serialised into a Response. */
export interface HttpActionOutcome {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/**
 * HTTP fallback controller for session operations.
 *
 *   start    — begin a session turn via `session.start`
 *   input    — queue follow-up input via `session.followup_input`
 *   cancel   — cancel the running turn via `session.cancel`
 *   end      — end the session via `session.end` (platform-emitted)
 *   status   — read actor phase from the DO
 *   timeline — read the in-memory replay timeline
 */
export class HttpController {
  private host: HttpDispatchHost;

  constructor(host: HttpDispatchHost = {}) {
    this.host = host;
  }

  /** Late-bind the DO-owned host. */
  attachHost(host: HttpDispatchHost): void {
    this.host = { ...this.host, ...host };
  }

  async handleRequest(
    sessionId: string,
    action: string,
    body?: unknown,
  ): Promise<HttpControllerResponse> {
    if (!sessionId || sessionId.trim().length === 0) {
      return { status: 400, body: { error: "Missing session ID" } };
    }
    if (!SUPPORTED_ACTIONS.has(action as typeof SUPPORTED_ACTIONS extends Set<infer U> ? U : never)) {
      return { status: 404, body: { error: `Unknown action: ${action}` } };
    }

    switch (action) {
      case "start":
        return this.handleStart(sessionId, body);
      case "input":
        return this.handleInput(sessionId, body);
      case "cancel":
        return this.handleCancel(sessionId);
      case "end":
        return this.handleEnd(sessionId);
      case "status":
        return this.handleStatus(sessionId);
      case "timeline":
        return this.handleTimeline(sessionId);
      default:
        return { status: 404, body: { error: `Unknown action: ${action}` } };
    }
  }

  private extractText(body: unknown, fields: readonly string[]): string | null {
    if (body === null || body === undefined || typeof body !== "object") {
      return null;
    }
    const record = body as Record<string, unknown>;
    for (const f of fields) {
      const v = record[f];
      if (typeof v === "string" && v.length > 0) return v;
    }
    return null;
  }

  private buildClientFrame(
    sessionId: string,
    messageType: string,
    body: Record<string, unknown>,
  ): string {
    return JSON.stringify({
      header: {
        schema_version: "1.1.0",
        message_uuid: crypto.randomUUID(),
        message_type: messageType,
        delivery_kind: "command",
        sent_at: new Date().toISOString(),
        producer_role: "client",
        producer_key: "nano-agent.client.http-fallback@v1",
        priority: "normal",
      },
      trace: {
        trace_uuid: crypto.randomUUID(),
        session_uuid: sessionId,
      },
      body,
    });
  }

  private async handleStart(
    sessionId: string,
    body: unknown,
  ): Promise<HttpActionOutcome> {
    if (!this.host.submitFrame) {
      return { status: 200, body: { ok: true, action: "start" } };
    }
    const initial = this.extractText(body, ["initial_input", "text"]);
    if (!initial) {
      return {
        status: 400,
        body: { error: "start requires initial_input / text" },
      };
    }
    const frame = this.buildClientFrame(sessionId, "session.start", {
      initial_input: initial,
    });
    await this.host.submitFrame(frame);
    return {
      status: 200,
      body: { ok: true, action: "start", phase: this.host.getPhase?.() },
    };
  }

  private async handleInput(
    sessionId: string,
    body: unknown,
  ): Promise<HttpActionOutcome> {
    if (!this.host.submitFrame) {
      return { status: 200, body: { ok: true, action: "input" } };
    }
    const text = this.extractText(body, ["text", "input"]);
    if (!text) {
      return {
        status: 400,
        body: { error: "input requires text" },
      };
    }
    const frame = this.buildClientFrame(sessionId, "session.followup_input", {
      text,
    });
    await this.host.submitFrame(frame);
    return {
      status: 200,
      body: { ok: true, action: "input", phase: this.host.getPhase?.() },
    };
  }

  private async handleCancel(
    sessionId: string,
  ): Promise<HttpActionOutcome> {
    if (!this.host.submitFrame) {
      return { status: 200, body: { ok: true, action: "cancel" } };
    }
    const frame = this.buildClientFrame(sessionId, "session.cancel", {});
    await this.host.submitFrame(frame);
    return {
      status: 200,
      body: { ok: true, action: "cancel", phase: this.host.getPhase?.() },
    };
  }

  private async handleEnd(
    _sessionId: string,
  ): Promise<HttpActionOutcome> {
    // `session.end` is a server-emitted family in nacp-session; clients
    // cannot produce it. The fallback surfaces an explicit 405 when a
    // DO host is wired. Without a host, preserve the legacy stub body.
    if (!this.host.submitFrame) {
      return { status: 200, body: { ok: true, action: "end" } };
    }
    return {
      status: 405,
      body: {
        error:
          "session.end is server-emitted; clients should send session.cancel and wait for the server-issued end",
      },
    };
  }

  private async handleStatus(
    _sessionId: string,
  ): Promise<HttpActionOutcome> {
    const phase = this.host.getPhase?.() ?? "unattached";
    return {
      status: 200,
      body: { ok: true, action: "status", phase },
    };
  }

  private async handleTimeline(
    _sessionId: string,
  ): Promise<HttpActionOutcome> {
    const events = this.host.readTimeline?.() ?? [];
    return {
      status: 200,
      body: { ok: true, action: "timeline", events },
    };
  }
}
