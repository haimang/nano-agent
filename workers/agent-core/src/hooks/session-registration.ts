import type { HookEventName } from "./catalog.js";
import type { HookOutcome, HookOutcomeAction } from "./outcome.js";
import { HookDispatcher } from "./dispatcher.js";
import { HookRegistry } from "./registry.js";
import { LocalTsRuntime } from "./runtimes/local-ts.js";
import type { HookHandlerConfig, HookMatcherConfig } from "./types.js";

const SESSION_HOOK_EVENT = "PreToolUse" as const;
const MAX_TIMEOUT_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 2_000;
const ID_RE = /^[a-zA-Z0-9._:-]{1,96}$/;

export const SESSION_HOOKS_STORAGE_KEY = "session:hooks:v1";

export interface SessionHookRegistration {
  readonly id: string;
  readonly source: "session";
  readonly event: "PreToolUse";
  readonly matcher?: HookMatcherConfig;
  readonly runtime: "local-ts";
  readonly timeoutMs: number;
  readonly description?: string;
  readonly outcome: {
    readonly action: HookOutcomeAction;
    readonly reason?: string;
    readonly updatedInput?: Record<string, unknown>;
    readonly diagnostics?: Record<string, unknown>;
  };
}

export interface SessionHookRuntime {
  readonly registry: HookRegistry;
  readonly localRuntime: LocalTsRuntime;
  readonly dispatcher: HookDispatcher;
  register(input: unknown): SessionHookRegistration;
  unregister(handlerId: string): boolean;
  list(): SessionHookRegistration[];
  restore(registrations: readonly SessionHookRegistration[]): void;
}

export function createSessionHookRuntime(): SessionHookRuntime {
  const registry = new HookRegistry();
  const localRuntime = new LocalTsRuntime();
  const dispatcher = new HookDispatcher(registry, new Map([["local-ts", localRuntime]]));
  const registrations = new Map<string, SessionHookRegistration>();

  function install(registration: SessionHookRegistration): void {
    registrations.set(registration.id, registration);
    registry.register(toHandlerConfig(registration));
    localRuntime.registerHandler(registration.id, async () => toHookOutcome(registration));
  }

  return {
    registry,
    localRuntime,
    dispatcher,
    register(input: unknown): SessionHookRegistration {
      const registration = parseSessionHookRegistration(input);
      install(registration);
      return registration;
    },
    unregister(handlerId: string): boolean {
      if (!registrations.has(handlerId)) return false;
      registrations.delete(handlerId);
      registry.unregister(handlerId);
      localRuntime.unregisterHandler(handlerId);
      return true;
    },
    list(): SessionHookRegistration[] {
      return Array.from(registrations.values());
    },
    restore(next: readonly SessionHookRegistration[]): void {
      registry.clear();
      registrations.clear();
      for (const registration of next) {
        install(registration);
      }
    },
  };
}

export function parsePersistedSessionHooks(value: unknown): SessionHookRegistration[] {
  if (!Array.isArray(value)) return [];
  const parsed: SessionHookRegistration[] = [];
  for (const item of value) {
    try {
      parsed.push(parseSessionHookRegistration(item));
    } catch {
      // Ignore corrupt persisted entries; registration APIs still reject bad input.
    }
  }
  return parsed;
}

function parseSessionHookRegistration(input: unknown): SessionHookRegistration {
  const record = asRecord(input, "hook registration must be an object");
  const id = readString(record.id, "id");
  if (!ID_RE.test(id)) {
    throw new Error("id must be 1-96 chars and contain only letters, numbers, dot, colon, underscore, or dash");
  }
  const event = readString(record.event, "event");
  if (event !== SESSION_HOOK_EVENT) {
    throw new Error("PP4 only allows PreToolUse session hooks");
  }
  const runtime = record.runtime === undefined ? "local-ts" : readString(record.runtime, "runtime");
  if (runtime !== "local-ts") {
    throw new Error("PP4 only allows worker-safe local-ts declarative hooks");
  }
  if (record.source !== undefined && record.source !== "session") {
    throw new Error("PP4 session hook source must be session");
  }
  const timeoutMs = readTimeout(record.timeout_ms ?? record.timeoutMs);
  const matcher = record.matcher === undefined ? undefined : parseMatcher(record.matcher);
  const outcome = parseOutcome(record.outcome);
  const description =
    typeof record.description === "string" && record.description.length > 0
      ? record.description.slice(0, 512)
      : undefined;

  return {
    id,
    source: "session",
    event: SESSION_HOOK_EVENT,
    ...(matcher ? { matcher } : {}),
    runtime: "local-ts",
    timeoutMs,
    ...(description ? { description } : {}),
    outcome,
  };
}

function parseMatcher(input: unknown): HookMatcherConfig {
  const record = asRecord(input, "matcher must be an object");
  const type = readString(record.type, "matcher.type");
  if (type !== "exact" && type !== "wildcard" && type !== "toolName") {
    throw new Error("matcher.type must be exact, wildcard, or toolName");
  }
  const value = readString(record.value, "matcher.value");
  if (value.length > 128) throw new Error("matcher.value exceeds 128 characters");
  return { type, value };
}

function parseOutcome(input: unknown): SessionHookRegistration["outcome"] {
  const record = asRecord(input, "outcome must be an object");
  const actionRaw = record.action === "updateInput" ? "continue" : readString(record.action, "outcome.action");
  if (actionRaw !== "continue" && actionRaw !== "block") {
    throw new Error("outcome.action must be continue, updateInput, or block");
  }
  const updatedInputRaw = record.updated_input ?? record.updatedInput;
  const updatedInput =
    updatedInputRaw === undefined ? undefined : asRecord(updatedInputRaw, "outcome.updated_input must be an object");
  const reason =
    typeof record.reason === "string" && record.reason.length > 0
      ? record.reason.slice(0, 2048)
      : undefined;
  const diagnostics =
    record.diagnostics === undefined
      ? undefined
      : asRecord(record.diagnostics, "outcome.diagnostics must be an object");
  return {
    action: actionRaw,
    ...(reason ? { reason } : {}),
    ...(updatedInput ? { updatedInput } : {}),
    ...(diagnostics ? { diagnostics } : {}),
  };
}

function toHandlerConfig(registration: SessionHookRegistration): HookHandlerConfig {
  return {
    id: registration.id,
    source: "session",
    event: registration.event,
    ...(registration.matcher ? { matcher: registration.matcher } : {}),
    runtime: "local-ts",
    timeoutMs: registration.timeoutMs,
    ...(registration.description ? { description: registration.description } : {}),
  };
}

function toHookOutcome(registration: SessionHookRegistration): HookOutcome {
  return {
    action: registration.outcome.action,
    handlerId: registration.id,
    durationMs: 0,
    ...(registration.outcome.reason ? { additionalContext: registration.outcome.reason } : {}),
    ...(registration.outcome.updatedInput !== undefined ? { updatedInput: registration.outcome.updatedInput } : {}),
    ...(registration.outcome.diagnostics ? { diagnostics: registration.outcome.diagnostics } : {}),
  };
}

function readTimeout(value: unknown): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > MAX_TIMEOUT_MS) {
    throw new Error(`timeout_ms must be an integer in [1, ${MAX_TIMEOUT_MS}]`);
  }
  return value;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}
