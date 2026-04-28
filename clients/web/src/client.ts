import { HeartbeatTracker } from "./heartbeat";
import type { AuthState } from "./apis/auth";

export { HeartbeatTracker };
export type { HeartbeatOptions, HeartbeatStatus } from "./heartbeat";
export type { AuthState } from "./apis/auth";

export interface SessionEvent {
  readonly kind?: string;
  readonly seq?: number;
  readonly [key: string]: unknown;
}

const UPSTREAM_WS_BASE = "wss://nano-agent-orchestrator-core-preview.haimang.workers.dev";

function getWsBaseUrl(): string {
  if (typeof import.meta !== "undefined") {
    const env = (import.meta as ImportMeta & { env?: { VITE_NANO_BASE_URL?: string } })
      .env?.VITE_NANO_BASE_URL;
    if (env) {
      const url = new URL(env);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return url.origin;
    }
  }
  return UPSTREAM_WS_BASE;
}

export function openSessionStream(
  auth: AuthState,
  sessionUuid: string,
  onEvent: (event: SessionEvent) => void,
  options: { readonly lastSeenSeq?: number } = {},
): WebSocket {
  const wsBase = getWsBaseUrl();
  const url = new URL(`${wsBase}/sessions/${sessionUuid}/ws`);
  url.searchParams.set("access_token", auth.token);
  url.searchParams.set("trace_uuid", crypto.randomUUID());
  url.searchParams.set("last_seen_seq", String(Math.max(0, Math.trunc(options.lastSeenSeq ?? 0))));

  const socket = new WebSocket(url.toString());
  const heartbeat = new HeartbeatTracker({ intervalMs: 15_000, timeoutMs: 45_000 });
  let lastHeartbeatSentAt = 0;

  const sendHeartbeat = () => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (!heartbeat.shouldSendHeartbeat(lastHeartbeatSentAt)) return;
    lastHeartbeatSentAt = Date.now();
    socket.send(JSON.stringify({
      message_type: "session.heartbeat",
      body: { ts: lastHeartbeatSentAt },
    }));
  };

  const heartbeatTimer = window.setInterval(sendHeartbeat, heartbeat.interval);

  const cleanup = () => window.clearInterval(heartbeatTimer);

  socket.addEventListener("open", () => {
    sendHeartbeat();
    socket.send(JSON.stringify({
      message_type: "session.resume",
      body: { last_seen_seq: Math.max(0, Math.trunc(options.lastSeenSeq ?? 0)) },
    }));
  });

  socket.addEventListener("message", (event) => {
    heartbeat.recordHeartbeat();
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
