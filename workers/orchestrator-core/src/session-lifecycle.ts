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

export interface StartSessionBody {
  readonly initial_input?: string;
  readonly text?: string;
  readonly initial_context?: unknown;
  readonly trace_uuid?: string;
  readonly auth_snapshot?: IngressAuthSnapshot;
  readonly initial_context_seed?: InitialContextSeed;
}

export interface FollowupBody {
  readonly text?: string;
  readonly context_ref?: unknown;
  readonly stream_seq?: number;
  readonly trace_uuid?: string;
  readonly auth_snapshot?: IngressAuthSnapshot;
  readonly initial_context_seed?: InitialContextSeed;
}

export interface CancelBody {
  readonly reason?: string;
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
