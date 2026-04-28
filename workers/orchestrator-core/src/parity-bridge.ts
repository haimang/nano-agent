// ZX4 Phase 0 seam extraction(per ZX4-ZX5 GPT review Q3 4-module seam):
// parity-bridge — internal fetch / RPC dual-track + parity logging + stream
// frame parsing helpers. **本文件仅含类型 + pure helper functions**;DO class
// 的 forwardInternalRaw / forwardInternalJsonShadow 方法体仍在 user-do.ts,
// 通过 import 这里的 helper 实现。Phase 0 的口径是零行为变更 + 零回归。

export class InvalidStreamFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStreamFrameError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function jsonDeepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => jsonDeepEqual(value, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] && jsonDeepEqual(left[key], right[key]),
      )
    );
  }
  return false;
}

// ZX1-ZX2 review (Kimi §6.3 #1): structured warn line on every parity
// failure so 7-day preview observation can grep `agent-rpc-parity-failed`
// in worker logs and count mismatches per action / session.
//
// ZX4 Phase 2 upgrade: emit JSON-pointer field-level body diff so future
// R29-class divergences (e.g. stateful field drifting between rpc / fetch
// samples) can be located at the exact field rather than diffed by hand.
// `body_diff` is capped + value-truncated to keep the log line tractable.
//
// **ZX4 Phase 9 retain-as-reference note(per ZX3-ZX4 review deepseek R6)**:
// 自 P3-05 flip 起 user-do.ts 已不再调用 logParityFailure / computeBodyDiff
// (parity 比较代码整体删除)。这两个 helper 与下方的 jsonDeepEqual 一并保留
// 在本模块中作为 "reference implementation" — 若 ZX5+ 因长期 RPC 不稳需重启
// dual-track parity profile,可直接复用。如果 owner 确认 internal-http-compat
// 永久 retired,后续 ZX5 cleanup 可加 @deprecated 标记或物理删除。当前文件
// 保留是 deliberate 决策,不是 dead code 遗漏。

export type BodyDiffKind = "value-mismatch" | "rpc-only" | "fetch-only";

export interface BodyDiffEntry {
  readonly pointer: string;
  readonly kind: BodyDiffKind;
  readonly rpc?: unknown;
  readonly fetch?: unknown;
}

const PARITY_DIFF_MAX_ENTRIES = 20;
const PARITY_DIFF_VALUE_PREVIEW_CHARS = 200;

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function appendPointer(base: string, segment: string | number): string {
  const piece =
    typeof segment === "number"
      ? String(segment)
      : escapePointerSegment(segment);
  return `${base}/${piece}`;
}

function previewDiffValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > PARITY_DIFF_VALUE_PREVIEW_CHARS
      ? `${value.slice(0, PARITY_DIFF_VALUE_PREVIEW_CHARS)}…`
      : value;
  }
  if (Array.isArray(value)) {
    return `[array len=${value.length}]`;
  }
  if (isRecord(value)) {
    return `{object keys=${Object.keys(value).length}}`;
  }
  return value;
}

function diffNodes(
  rpc: unknown,
  fetch: unknown,
  pointer: string,
  out: BodyDiffEntry[],
  budget: { remaining: number },
): void {
  if (budget.remaining <= 0) return;
  if (jsonDeepEqual(rpc, fetch)) return;

  if (Array.isArray(rpc) && Array.isArray(fetch)) {
    const max = Math.max(rpc.length, fetch.length);
    for (let i = 0; i < max; i++) {
      if (budget.remaining <= 0) return;
      const childPointer = appendPointer(pointer, i);
      if (i >= rpc.length) {
        out.push({
          pointer: childPointer,
          kind: "fetch-only",
          fetch: previewDiffValue(fetch[i]),
        });
        budget.remaining -= 1;
        continue;
      }
      if (i >= fetch.length) {
        out.push({
          pointer: childPointer,
          kind: "rpc-only",
          rpc: previewDiffValue(rpc[i]),
        });
        budget.remaining -= 1;
        continue;
      }
      diffNodes(rpc[i], fetch[i], childPointer, out, budget);
    }
    return;
  }

  if (isRecord(rpc) && isRecord(fetch)) {
    const keys = new Set<string>([...Object.keys(rpc), ...Object.keys(fetch)]);
    for (const key of keys) {
      if (budget.remaining <= 0) return;
      const childPointer = appendPointer(pointer, key);
      const inRpc = Object.prototype.hasOwnProperty.call(rpc, key);
      const inFetch = Object.prototype.hasOwnProperty.call(fetch, key);
      if (inRpc && !inFetch) {
        out.push({
          pointer: childPointer,
          kind: "rpc-only",
          rpc: previewDiffValue(rpc[key]),
        });
        budget.remaining -= 1;
        continue;
      }
      if (!inRpc && inFetch) {
        out.push({
          pointer: childPointer,
          kind: "fetch-only",
          fetch: previewDiffValue(fetch[key]),
        });
        budget.remaining -= 1;
        continue;
      }
      diffNodes(rpc[key], fetch[key], childPointer, out, budget);
    }
    return;
  }

  // Leaf-level mismatch (different types or different scalars).
  out.push({
    pointer: pointer === "" ? "/" : pointer,
    kind: "value-mismatch",
    rpc: previewDiffValue(rpc),
    fetch: previewDiffValue(fetch),
  });
  budget.remaining -= 1;
}

export function computeBodyDiff(
  rpcBody: unknown,
  fetchBody: unknown,
  maxEntries: number = PARITY_DIFF_MAX_ENTRIES,
): BodyDiffEntry[] {
  if (jsonDeepEqual(rpcBody, fetchBody)) return [];
  const entries: BodyDiffEntry[] = [];
  const budget = { remaining: maxEntries };
  diffNodes(rpcBody, fetchBody, "", entries, budget);
  return entries;
}

export function logParityFailure(
  action: string,
  sessionUuid: string,
  rpcResult: { status: number; body: unknown },
  fetchResult: { response: Response; body: Record<string, unknown> | null },
): void {
  const fetchStatus = fetchResult.response.status;
  const statusMatch = rpcResult.status === fetchStatus;
  const bodyDiff = computeBodyDiff(rpcResult.body ?? null, fetchResult.body ?? null);
  const truncated = bodyDiff.length >= PARITY_DIFF_MAX_ENTRIES;
  const firstPointer = bodyDiff[0]?.pointer ?? null;
  console.warn(
    `agent-rpc-parity-failed action=${action} session=${sessionUuid} rpc_status=${rpcResult.status} fetch_status=${fetchStatus} status_match=${statusMatch} diff_count=${bodyDiff.length}${firstPointer ? ` first_pointer=${firstPointer}` : ""}${truncated ? " truncated=true" : ""}`,
    {
      action,
      session_uuid: sessionUuid,
      rpc_status: rpcResult.status,
      fetch_status: fetchStatus,
      status_match: statusMatch,
      body_diff: bodyDiff,
      body_diff_truncated: truncated,
      tag: "agent-rpc-parity-failed",
    },
  );
}

export type StreamFrame =
  | { kind: "meta"; seq: 0; event: "opened"; session_uuid: string }
  | {
      kind: "event";
      seq: number;
      name: "session.stream.event";
      payload: Record<string, unknown>;
    }
  | {
      kind: "terminal";
      seq: number;
      terminal: "completed" | "cancelled" | "error";
      payload?: Record<string, unknown>;
    };

export type StreamReadResult =
  | { ok: true; frames: StreamFrame[] }
  | { ok: false; response: Response };

export function parseStreamFrame(value: unknown, context: string): StreamFrame {
  if (!isRecord(value)) {
    throw new InvalidStreamFrameError(`${context}: frame must be an object`);
  }
  if (value.kind === "meta") {
    if (
      value.seq !== 0 ||
      value.event !== "opened" ||
      typeof value.session_uuid !== "string" ||
      value.session_uuid.length === 0
    ) {
      throw new InvalidStreamFrameError(`${context}: invalid meta frame`);
    }
    return {
      kind: "meta",
      seq: 0,
      event: "opened",
      session_uuid: value.session_uuid,
    };
  }
  if (value.kind === "event") {
    if (
      !isNonNegativeInteger(value.seq) ||
      value.seq < 1 ||
      value.name !== "session.stream.event" ||
      !isRecord(value.payload)
    ) {
      throw new InvalidStreamFrameError(`${context}: invalid event frame`);
    }
    return {
      kind: "event",
      seq: value.seq,
      name: "session.stream.event",
      payload: value.payload,
    };
  }
  if (value.kind === "terminal") {
    if (!isNonNegativeInteger(value.seq) || value.seq < 1) {
      throw new InvalidStreamFrameError(`${context}: invalid terminal seq`);
    }
    if (
      value.terminal !== "completed" &&
      value.terminal !== "cancelled" &&
      value.terminal !== "error"
    ) {
      throw new InvalidStreamFrameError(`${context}: invalid terminal kind`);
    }
    if (value.payload !== undefined && !isRecord(value.payload)) {
      throw new InvalidStreamFrameError(`${context}: invalid terminal payload`);
    }
    return {
      kind: "terminal",
      seq: value.seq,
      terminal: value.terminal,
      ...(value.payload !== undefined ? { payload: value.payload } : {}),
    };
  }
  throw new InvalidStreamFrameError(`${context}: unknown frame kind`);
}

export async function readJson(
  response: Response,
): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

export async function readNdjsonFrames(response: Response): Promise<StreamFrame[]> {
  if (!response.body) return [];
  const frames: StreamFrame[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const idx = buffer.indexOf("\n");
      if (idx === -1) break;
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new InvalidStreamFrameError(
          `stream line ${frames.length + 1}: malformed JSON`,
        );
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
      throw new InvalidStreamFrameError(
        `stream line ${frames.length + 1}: malformed JSON`,
      );
    }
    frames.push(parseStreamFrame(parsed, `stream line ${frames.length + 1}`));
  }
  return frames;
}
