// ZX4 Phase 0 seam extraction(per ZX4-ZX5 GPT review Q3 4-module seam):
// ws-bridge — WebSocket attach + heartbeat + emitServerFrame producer seam +
// last_seen_seq parsing。**本文件仅含类型 + pure helper functions**;DO class
// 的 handleWsAttach / bindSocketLifecycle 方法体仍在 user-do.ts。

export interface WorkerSocketLike {
  accept?(): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener?: (
    type: "message" | "close",
    handler: (event?: unknown) => void,
  ) => void;
}

export interface AttachmentState {
  readonly socket: WorkerSocketLike;
  readonly attached_at: string;
  readonly device_uuid?: string | null;
  readonly heartbeat_timer?: ReturnType<typeof setInterval>;
}

export const CLIENT_WS_HEARTBEAT_INTERVAL_MS = 15_000;

export function isWebSocketUpgrade(request: Request): boolean {
  return request.headers.get("upgrade")?.toLowerCase() === "websocket";
}

export function parseLastSeenSeq(request: Request): number | null {
  const raw = new URL(request.url).searchParams.get("last_seen_seq");
  if (raw === null || raw.length === 0) return null;
  const seq = Number(raw);
  return Number.isInteger(seq) && seq >= 0 ? seq : null;
}

export function createWebSocketPair(): {
  client: unknown;
  server: WorkerSocketLike;
} | null {
  const Pair = (
    globalThis as unknown as {
      WebSocketPair?: new () => { 0: WorkerSocketLike; 1: WorkerSocketLike };
    }
  ).WebSocketPair;
  if (!Pair) return null;
  const pair = new Pair();
  return { client: pair[0], server: pair[1] };
}
