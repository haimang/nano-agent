const DEFAULT_UPSTREAM =
  "https://nano-agent-orchestrator-core-preview.haimang.workers.dev";

function getBaseUrl(useBff: boolean): string {
  if (useBff) return "";
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("nano.baseUrl");
    if (stored) return stored;
  }
  if (typeof import.meta !== "undefined") {
    const env = (import.meta as ImportMeta & { env?: { VITE_NANO_BASE_URL?: string } })
      .env?.VITE_NANO_BASE_URL;
    if (env) return env;
  }
  return DEFAULT_UPSTREAM;
}

export interface TransportOptions {
  baseUrl?: string;
  useBff?: boolean;
  traceUuid?: () => string;
}

export interface FacadeSuccessEnvelope {
  ok: true;
  data: Record<string, unknown>;
  trace_uuid: string;
}

export interface FacadeErrorEnvelope {
  ok: false;
  error: {
    code: string;
    status: number;
    message: string;
    details?: unknown;
  };
  trace_uuid: string;
}

export interface LegacyActionPayload {
  ok: true;
  action: string;
  trace_uuid: string;
  [key: string]: unknown;
}

export type ApiResponse = FacadeSuccessEnvelope | LegacyActionPayload | Record<string, unknown>;

export interface ApiError {
  kind: "auth.expired" | "quota.exceeded" | "runtime.error" | "request.error";
  status: number;
  message: string;
  code?: string;
  trace_uuid?: string;
  details?: unknown;
}

export class ApiRequestError extends Error {
  constructor(readonly details: ApiError) {
    super(details.message);
  }
}

export class Transport {
  private _baseUrl: string;
  private readonly useBff: boolean;
  private readonly traceUuid: () => string;

  constructor(opts: TransportOptions = {}) {
    this.useBff = opts.useBff ?? true;
    this._baseUrl = opts.baseUrl ?? getBaseUrl(this.useBff);
    this.traceUuid = opts.traceUuid ?? crypto.randomUUID.bind(crypto);
  }

  async request(path: string, init: RequestInit = {}): Promise<ApiResponse> {
    const url = this.useBff
      ? `/api${path}`
      : `${this._baseUrl}${path}`;

    const headers = new Headers(init.headers);
    if (!headers.has("x-trace-uuid")) {
      headers.set("x-trace-uuid", this.traceUuid());
    }

    const response = await fetch(url, {
      ...init,
      headers,
    });

    const text = await response.text();
    const body: Record<string, unknown> = text ? JSON.parse(text) : {};

    if (!response.ok || body.ok === false) {
      const error = (
        body.error && typeof body.error === "object"
          ? body.error
          : body
      ) as Record<string, unknown>;

      const message =
        typeof error.message === "string"
          ? error.message
          : typeof body.message === "string"
            ? body.message
            : `HTTP ${response.status}`;

      throw new ApiRequestError({
        kind:
          response.status === 401
            ? "auth.expired"
            : response.status === 429
              ? "quota.exceeded"
              : response.status >= 500
                ? "runtime.error"
                : "request.error",
        status: response.status,
        message,
        code: typeof error.code === "string" ? error.code : undefined,
        trace_uuid:
          typeof body.trace_uuid === "string"
            ? body.trace_uuid
            : undefined,
        details: error.details,
      });
    }

    return body as ApiResponse;
  }

  setBaseUrl(url: string): void {
    this._baseUrl = url;
    localStorage.setItem("nano.baseUrl", url);
  }

  getBaseUrl(): string {
    return this._baseUrl;
  }
}

export const transport = new Transport();
