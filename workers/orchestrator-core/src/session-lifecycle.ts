// ZX4 Phase 0 seam extraction(per ZX4-ZX5 GPT review Q3 4-module seam):
// session-lifecycle — write-side body schemas + status enum + terminal kind +
// session entry shape + redaction + missing/terminal response builders。
// **本文件仅含类型 + pure helper functions**;DO class 的 handleStart /
// handleInput / handleCancel / handleVerify 方法体仍在 user-do.ts。
//
// **R1 status enum 冻结(ZX4-ZX5 GPT review §2.2 R1 + R10/R11)**: ZX4 Phase 3
// 引入 'pending' + 'expired' 两个新状态值;现 union 已扩展。所有 narrow /
// exhaustive switch 必须同步;ingress guard(per R11)pending session 只允许
// /start,其他 follow-up endpoints 返 409 `session-pending-only-start-allowed`。

import type { IngressAuthSnapshot, InitialContextSeed } from "./auth.js";
import { redactPayload } from "@haimang/nacp-session";

export type SessionStatus =
  | "pending" // mint /me/sessions 后,未 start
  | "starting" // handleStart 进入,runtime 准备中
  | "active" // runtime ready,session 活跃
  | "detached" // WS detach 后,但 session 仍可 resume
  | "ended" // 终态(completed / cancelled / error 都映射到 ended)
  | "expired"; // pending 24h 未 start,alarm GC 标记

export type TerminalKind = "completed" | "cancelled" | "error";

export interface SessionEntry {
  readonly created_at: string;
  readonly last_seen_at: string;
  readonly status: SessionStatus;
  readonly last_phase: string | null;
  readonly relay_cursor: number;
  readonly ended_at: string | null;
  readonly device_uuid?: string | null;
}

export interface SessionTerminalRecord {
  readonly terminal: TerminalKind;
  readonly last_phase: string | null;
  readonly ended_at: string;
}

// HP0 P2-01 — public ingress 与 NACP-Session schema 对齐:
// `model_id` / `reasoning` 在 `packages/nacp-session/src/messages.ts` 已是
// authoritative 字段;HP0 之前 public body 类型把它们丢成 `Record<string, unknown>`
// 隐式吞,导致 `/start` / `/input` 与 `/messages` 在 hero-to-pro law 下不一致。
// 此处显式落字段,为 Phase 2 P2-02 透传与 P3-01 system prompt seam 提供入口口径。
export type ReasoningEffort = "low" | "medium" | "high";
export interface ReasoningOptions {
  readonly effort: ReasoningEffort;
}

export interface StartSessionBody {
  readonly initial_input?: string;
  readonly text?: string;
  readonly initial_context?: unknown;
  readonly trace_uuid?: string;
  readonly auth_snapshot?: IngressAuthSnapshot;
  readonly initial_context_seed?: InitialContextSeed;
  readonly model_id?: string;
  readonly reasoning?: ReasoningOptions;
}

export interface FollowupBody {
  readonly text?: string;
  readonly context_ref?: unknown;
  readonly stream_seq?: number;
  readonly trace_uuid?: string;
  readonly auth_snapshot?: IngressAuthSnapshot;
  readonly initial_context_seed?: InitialContextSeed;
  readonly model_id?: string;
  readonly reasoning?: ReasoningOptions;
}

export interface SessionModelPatchBody {
  readonly model_id?: string | null;
  readonly reasoning?: ReasoningOptions | null;
}

// HP0 P2-01 — 单一 model/reasoning ingress validator。
// `/messages` 历史上把同样的逻辑内联在 `message-runtime.ts` 中;HP0 把它收敛到
// session-lifecycle 模块,让 `/start` / `/input` / `/messages` 三入口共享同一
// reject 策略(invalid format → 400 invalid-input),避免一边放行一边拒绝。
const MODEL_ID_PATTERN = /^[a-z0-9@/._-]{1,120}$/i;

export type ParseModelOptionsResult =
  | { readonly ok: true; readonly model_id?: string; readonly reasoning?: ReasoningOptions }
  | { readonly ok: false; readonly response: Response };

export type ParseSessionModelPatchResult =
  | {
      readonly ok: true;
      readonly model_id_present: boolean;
      readonly model_id?: string | null;
      readonly reasoning_present: boolean;
      readonly reasoning?: ReasoningOptions | null;
    }
  | { readonly ok: false; readonly response: Response };

export function parseModelOptions(
  body: Record<string, unknown> | null | undefined,
): ParseModelOptionsResult {
  if (!body) return { ok: true };
  let modelId: string | undefined;
  if (body.model_id !== undefined) {
    if (typeof body.model_id !== "string" || !MODEL_ID_PATTERN.test(body.model_id)) {
      return {
        ok: false,
        response: jsonResponse(400, {
          error: "invalid-input",
          message: "model_id has invalid format",
        }),
      };
    }
    modelId = body.model_id;
  }
  let reasoning: ReasoningOptions | undefined;
  if (body.reasoning !== undefined) {
    if (!body.reasoning || typeof body.reasoning !== "object" || Array.isArray(body.reasoning)) {
      return {
        ok: false,
        response: jsonResponse(400, {
          error: "invalid-input",
          message: "reasoning requires effort",
        }),
      };
    }
    const effort = (body.reasoning as Record<string, unknown>).effort;
    if (effort !== "low" && effort !== "medium" && effort !== "high") {
      return {
        ok: false,
        response: jsonResponse(400, {
          error: "invalid-input",
          message: "reasoning effort must be low, medium, or high",
        }),
      };
    }
    reasoning = { effort };
  }
  return {
    ok: true,
    ...(modelId !== undefined ? { model_id: modelId } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
}

export function parseSessionModelPatchBody(
  body: Record<string, unknown> | null | undefined,
): ParseSessionModelPatchResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      response: jsonResponse(400, {
        error: "invalid-input",
        message: "model patch requires JSON object body",
      }),
    };
  }
  const modelIdPresent = Object.prototype.hasOwnProperty.call(body, "model_id");
  const reasoningPresent = Object.prototype.hasOwnProperty.call(body, "reasoning");
  if (!modelIdPresent && !reasoningPresent) {
    return {
      ok: false,
      response: jsonResponse(400, {
        error: "invalid-input",
        message: "model patch requires model_id or reasoning",
      }),
    };
  }

  let modelId: string | null | undefined;
  if (modelIdPresent) {
    if (body.model_id === null) {
      modelId = null;
    } else if (typeof body.model_id === "string" && MODEL_ID_PATTERN.test(body.model_id)) {
      modelId = body.model_id;
    } else {
      return {
        ok: false,
        response: jsonResponse(400, {
          error: "invalid-input",
          message: "model_id has invalid format",
        }),
      };
    }
  }

  let reasoning: ReasoningOptions | null | undefined;
  if (reasoningPresent) {
    if (body.reasoning === null) {
      reasoning = null;
    } else {
      const parsed = parseModelOptions({ reasoning: body.reasoning });
      if (!parsed.ok) return parsed;
      reasoning = parsed.reasoning ?? null;
    }
  }
  return {
    ok: true,
    model_id_present: modelIdPresent,
    ...(modelIdPresent ? { model_id: modelId } : {}),
    reasoning_present: reasoningPresent,
    ...(reasoningPresent ? { reasoning } : {}),
  };
}

export function normalizeReasoningOptions(
  requested: ReasoningOptions | null | undefined,
  supportedLevels: readonly ReasoningEffort[] | null | undefined,
): ReasoningOptions | undefined {
  if (!requested) return undefined;
  const levels = Array.from(
    new Set(
      (supportedLevels ?? []).filter(
        (level): level is ReasoningEffort => level === "low" || level === "medium" || level === "high",
      ),
    ),
  );
  if (levels.length === 0) return undefined;
  if (levels.includes(requested.effort)) return requested;
  return { effort: levels[0]! };
}

export interface CancelBody {
  readonly reason?: string;
  readonly trace_uuid?: string;
  readonly auth_snapshot?: IngressAuthSnapshot;
  readonly initial_context_seed?: InitialContextSeed;
}

export interface CloseBody {
  readonly reason?: string;
  readonly trace_uuid?: string;
  readonly auth_snapshot?: IngressAuthSnapshot;
  readonly initial_context_seed?: InitialContextSeed;
}

export interface DeleteSessionBody {
  readonly trace_uuid?: string;
  readonly auth_snapshot?: IngressAuthSnapshot;
  readonly initial_context_seed?: InitialContextSeed;
}

export interface TitlePatchBody {
  readonly title?: string;
  readonly trace_uuid?: string;
  readonly auth_snapshot?: IngressAuthSnapshot;
  readonly initial_context_seed?: InitialContextSeed;
}

export interface VerifyBody {
  readonly trace_uuid?: string;
  readonly auth_snapshot?: IngressAuthSnapshot;
  readonly initial_context_seed?: InitialContextSeed;
  readonly [key: string]: unknown;
}

export function sessionKey(sessionUuid: string): string {
  return `sessions/${sessionUuid}`;
}

export function terminalKey(sessionUuid: string): string {
  return `session-terminal/${sessionUuid}`;
}

export function jsonResponse(
  status: number,
  body: Record<string, unknown>,
): Response {
  return Response.json(body, { status });
}

export function isAuthSnapshot(value: unknown): value is IngressAuthSnapshot {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { sub?: unknown }).sub === "string" &&
    ((value as { tenant_source?: unknown }).tenant_source === undefined ||
      (value as { tenant_source?: unknown }).tenant_source === "claim" ||
      (value as { tenant_source?: unknown }).tenant_source === "deploy-fill")
  );
}

export function sessionMissingResponse(sessionUuid: string): Response {
  return jsonResponse(404, {
    error: "session_missing",
    session_uuid: sessionUuid,
  });
}

export function sessionTerminalResponse(
  sessionUuid: string,
  terminal: SessionTerminalRecord | null,
): Response {
  return jsonResponse(409, {
    error: "session_terminal",
    session_uuid: sessionUuid,
    terminal: terminal?.terminal ?? "completed",
    ...(terminal?.last_phase ? { last_phase: terminal.last_phase } : {}),
  });
}

export function redactActivityPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return redactPayload(payload, [
    "access_token",
    "refresh_token",
    "authority",
    "auth_snapshot",
    "password",
    "secret",
    "openid",
    "unionid",
  ]);
}

export function extractPhase(body: Record<string, unknown> | null): string | null {
  return typeof body?.phase === "string" ? body.phase : null;
}
