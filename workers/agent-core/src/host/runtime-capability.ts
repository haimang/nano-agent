import { SessionTodosWriteBodySchema } from "@haimang/nacp-session";
import type { CrossSeamAnchor } from "./cross-seam.js";
import type { MainlineKernelOptions, ToolSemanticEvent } from "./runtime-mainline.js";
import { QuotaAuthorizer, QuotaExceededError, type QuotaRuntimeContext } from "./quota/authorizer.js";
import type { AggregatedHookOutcome } from "../hooks/outcome.js";

type TodoStatusLiteral = "pending" | "in_progress" | "completed" | "cancelled" | "blocked";

export interface CapabilityTransportLike {
  call(input: {
    readonly requestId: string;
    readonly capabilityName: string;
    readonly body: unknown;
    readonly anchor?: CrossSeamAnchor;
    readonly quota?: Record<string, unknown>;
  }): Promise<unknown>;
  cancel?(input: {
    readonly requestId: string;
    readonly body: unknown;
    readonly anchor?: CrossSeamAnchor;
  }): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseCapabilityEnvelope(result: unknown):
  | { status: "ok"; output: string }
  | { status: "error"; error: { code: string; message: string } } {
  if (!isRecord(result)) {
    return {
      status: "error",
      error: {
        code: "invalid-capability-response",
        message: "capability transport returned a non-object envelope",
      },
    };
  }
  if (result.status === "ok") {
    return {
      status: "ok",
      output: typeof result.output === "string" ? result.output : "",
    };
  }
  const error = isRecord(result.error) ? result.error : {};
  return {
    status: "error",
    error: {
      code:
        typeof error.code === "string" && error.code.length > 0
          ? error.code
          : "capability-error",
      message:
        typeof error.message === "string" && error.message.length > 0
          ? error.message
          : "capability transport returned an error",
    },
  };
}

export function buildQuotaErrorEnvelope(error: QuotaExceededError) {
  return {
    status: "error" as const,
    error: {
      code: error.code,
      message: error.message,
      quota_kind: error.quotaKind,
      remaining: error.remaining,
      limit_value: error.limitValue,
    },
  };
}

export async function buildToolQuotaAuthorization(
  authorizer: QuotaAuthorizer | null,
  context: QuotaRuntimeContext | null,
  requestId: string,
  toolName: string,
): Promise<Record<string, unknown> | undefined> {
  if (!authorizer || !context) return undefined;
  const ticket = await authorizer.authorize("tool", context, requestId, {
    tool_name: toolName,
  });
  return {
    verdict: "allow",
    quota_kind: "tool",
    request_id: ticket.requestId,
    tool_name: toolName,
    remaining: ticket.remaining,
    limit_value: ticket.limitValue,
  };
}

async function authorizeToolPlan(
  options: MainlineKernelOptions,
  requestId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<{ allowed: true } | { allowed: false; error: { code: string; message: string; source?: string } }> {
  const ctx = options.contextProvider();
  if (!ctx || !options.authorizeToolUse) return { allowed: true };
  const result = await options.authorizeToolUse(
    {
      session_uuid: ctx.sessionUuid,
      team_uuid: ctx.teamUuid,
      tool_name: toolName,
      tool_input: toolInput,
    },
    { trace_uuid: ctx.traceUuid, team_uuid: ctx.teamUuid },
  );
  if (result.decision === "allow") return { allowed: true };
  if (result.decision === "ask") {
    if (!options.requestToolPermission) {
      return {
        allowed: false,
        error: {
          code: "tool-permission-no-decider",
          message: `tool ${toolName} requires permission but no HITL decider is wired`,
          source: result.source,
        },
      };
    }
    try {
      const decision = await options.requestToolPermission({
        session_uuid: ctx.sessionUuid,
        team_uuid: ctx.teamUuid,
        trace_uuid: ctx.traceUuid,
        request_uuid: requestId,
        tool_name: toolName,
        tool_input: toolInput,
        ...(result.reason ? { reason: result.reason } : {}),
      });
      const status = typeof decision.status === "string" ? decision.status : undefined;
      const legacyDecision =
        typeof decision.decision === "string" ? decision.decision : undefined;
      if (
        status === "allowed" ||
        legacyDecision === "allow" ||
        legacyDecision === "always_allow"
      ) {
        return { allowed: true };
      }
      return {
        allowed: false,
        error: {
          code: status === "timeout" ? "tool-permission-timeout" : "tool-permission-denied",
          message: `tool ${toolName} permission was ${status ?? legacyDecision ?? "denied"}`,
          source: result.source,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        allowed: false,
        error: {
          code: message.includes("timeout")
            ? "tool-permission-timeout"
            : "tool-permission-no-decider",
          message: `tool ${toolName} permission could not be resolved: ${message}`,
          source: result.source,
        },
      };
    }
  }
  return {
    allowed: false,
    error: {
      code: "tool-permission-denied",
      message: `tool ${toolName} was denied by runtime policy`,
      source: result.source,
    },
  };
}

function emitToolResult(
  options: MainlineKernelOptions,
  event: ToolSemanticEvent,
): void {
  options.onToolEvent?.(event);
}

function hookDiagnosticsFailed(outcome: AggregatedHookOutcome): boolean {
  return outcome.outcomes.some((item) => {
    const diagnostics = item.diagnostics;
    return Boolean(diagnostics && typeof diagnostics.error === "string");
  });
}

async function runPreToolUseHook(
  options: MainlineKernelOptions,
  input: {
    readonly requestId: string;
    readonly toolName: string;
    readonly toolInput: Record<string, unknown>;
  },
): Promise<
  | { ok: true; toolInput: Record<string, unknown> }
  | { ok: false; error: { code: string; message: string; diagnostics?: Record<string, unknown> } }
> {
  const dispatcher = options.hookDispatcher;
  if (!dispatcher) return { ok: true, toolInput: input.toolInput };
  const ctx = options.contextProvider();
  const payload = {
    session_uuid: ctx?.sessionUuid,
    team_uuid: ctx?.teamUuid,
    trace_uuid: ctx?.traceUuid,
    tool_call_id: input.requestId,
    tool_name: input.toolName,
    tool_input: input.toolInput,
  };
  const startedAt = Date.now();
  try {
    const hookContext = {
      ...(options.hookContextProvider?.() ?? {}),
      toolName: input.toolName,
    };
    const outcome = await dispatcher.emit("PreToolUse", payload, hookContext);
    options.onHookOutcome?.({
      eventName: "PreToolUse",
      caller: "pre-tool-use",
      payload,
      outcome,
      durationMs: Date.now() - startedAt,
    });
    if (outcome.blocked || hookDiagnosticsFailed(outcome)) {
      return {
        ok: false,
        error: {
          code: "hook-blocked",
          message: outcome.blockReason ?? "PreToolUse hook blocked tool execution",
          ...(outcome.mergedDiagnostics ? { diagnostics: outcome.mergedDiagnostics } : {}),
        },
      };
    }
    if (outcome.updatedInput === undefined) {
      return { ok: true, toolInput: input.toolInput };
    }
    if (!isRecord(outcome.updatedInput)) {
      return {
        ok: false,
        error: {
          code: "hook-invalid-updated-input",
          message: "PreToolUse updatedInput must be an object",
        },
      };
    }
    return { ok: true, toolInput: outcome.updatedInput };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "hook-dispatch-failed",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function createCapabilityAdapter(
  options: MainlineKernelOptions,
  inflightToolCalls: Map<string, { readonly toolName: string }>,
) {
  return {
    async *execute(plan: unknown) {
      const request = isRecord(plan) ? plan : {};
      const requestId =
        typeof request.requestId === "string" && request.requestId.length > 0
          ? request.requestId
          : crypto.randomUUID();
      const toolName =
        typeof request.toolName === "string" && request.toolName.length > 0
          ? request.toolName
          : "unknown";
      const toolInput =
        request.args && typeof request.args === "object"
          ? request.args
          : {};
      let normalizedToolInput = toolInput as Record<string, unknown>;
      const preToolUse = await runPreToolUseHook(options, {
        requestId,
        toolName,
        toolInput: normalizedToolInput,
      });
      if (!preToolUse.ok) {
        emitToolResult(options, {
          kind: "tool_call_result",
          tool_call_id: requestId,
          tool_name: toolName,
          status: "error",
          error: preToolUse.error,
        });
        yield { type: "result" as const, status: "error" as const, result: preToolUse.error };
        return;
      }
      normalizedToolInput = preToolUse.toolInput;
      const permission = await authorizeToolPlan(
        options,
        requestId,
        toolName,
        normalizedToolInput,
      );
      if (!permission.allowed) {
        emitToolResult(options, {
          kind: "tool_call_result",
          tool_call_id: requestId,
          tool_name: toolName,
          status: "error",
          error: permission.error,
        });
        yield { type: "result" as const, status: "error" as const, result: permission.error };
        return;
      }

      if (toolName === "write_todos") {
        emitToolResult(options, {
          kind: "tool_use_start",
          tool_call_id: requestId,
          tool_name: toolName,
          tool_input: normalizedToolInput,
        });
        if (!options.writeTodosBackend) {
          const errorBody = {
            code: "capability-not-wired",
            message: "writeTodosBackend not configured on host",
          };
          emitToolResult(options, {
            kind: "tool_call_result",
            tool_call_id: requestId,
            tool_name: toolName,
            status: "error",
            error: errorBody,
          });
          yield { type: "result" as const, status: "error" as const, result: errorBody };
          return;
        }
        const ctx = options.contextProvider();
        if (!ctx) {
          const errorBody = {
            code: "capability-not-wired",
            message: "session context unavailable for write_todos",
          };
          emitToolResult(options, {
            kind: "tool_call_result",
            tool_call_id: requestId,
            tool_name: toolName,
            status: "error",
            error: errorBody,
          });
          yield { type: "result" as const, status: "error" as const, result: errorBody };
          return;
        }
        const argsObj = normalizedToolInput as {
          readonly conversation_uuid?: unknown;
          readonly user_uuid?: unknown;
        };
        const parsedWrite = SessionTodosWriteBodySchema.safeParse(normalizedToolInput);
        if (!parsedWrite.success) {
          const errorBody = {
            code: "invalid-input",
            message: parsedWrite.error.message,
          };
          emitToolResult(options, {
            kind: "tool_call_result",
            tool_call_id: requestId,
            tool_name: toolName,
            status: "error",
            error: errorBody,
          });
          yield { type: "result" as const, status: "error" as const, result: errorBody };
          return;
        }
        try {
          const result = await options.writeTodosBackend({
            session_uuid: ctx.sessionUuid,
            conversation_uuid: typeof argsObj.conversation_uuid === "string" ? argsObj.conversation_uuid : ctx.sessionUuid,
            team_uuid: ctx.teamUuid,
            user_uuid: typeof argsObj.user_uuid === "string" ? argsObj.user_uuid : ctx.teamUuid,
            trace_uuid: ctx.traceUuid,
            todos: parsedWrite.data.todos as Array<{
              content: string;
              status?: TodoStatusLiteral;
              parent_todo_uuid?: string | null;
            }>,
          });
          if (result.ok) {
            emitToolResult(options, {
              kind: "tool_call_result",
              tool_call_id: requestId,
              tool_name: toolName,
              status: "ok",
              output: result,
            });
            yield { type: "result" as const, status: "ok" as const, result };
            return;
          }
          emitToolResult(options, {
            kind: "tool_call_result",
            tool_call_id: requestId,
            tool_name: toolName,
            status: "error",
            error: result.error,
          });
          yield { type: "result" as const, status: "error" as const, result: result.error };
        } catch (err) {
          const errorBody = {
            code: "capability-execution-error",
            message: err instanceof Error ? err.message : String(err),
          };
          emitToolResult(options, {
            kind: "tool_call_result",
            tool_call_id: requestId,
            tool_name: toolName,
            status: "error",
            error: errorBody,
          });
          yield { type: "result" as const, status: "error" as const, result: errorBody };
        }
        return;
      }

      if (!options.capabilityTransport) {
        yield {
          type: "result" as const,
          status: "error" as const,
          result: {
            code: "capability-transport-unavailable",
            message: "capability transport unavailable",
          },
        };
        return;
      }

      emitToolResult(options, {
        kind: "tool_use_start",
        tool_call_id: requestId,
        tool_name: toolName,
        tool_input: normalizedToolInput,
      });

      const quotaContext = options.contextProvider();
      inflightToolCalls.set(requestId, { toolName });
      try {
        const quota = await buildToolQuotaAuthorization(
          options.quotaAuthorizer,
          quotaContext,
          requestId,
          toolName,
        );
        const response = await options.capabilityTransport.call({
          requestId,
          capabilityName: toolName,
            body: {
              tool_name: toolName,
              tool_input: normalizedToolInput,
            },
          anchor: options.anchorProvider(),
          quota,
        });
        const parsed = parseCapabilityEnvelope(response);
        if (parsed.status === "ok") {
          if (options.quotaAuthorizer && quotaContext) {
            const balance = await options.quotaAuthorizer.commit("tool", quotaContext, requestId, {
              tool_name: toolName,
              status: "ok",
            });
            options.onUsageCommit?.({
              kind: "tool",
              remaining: balance.remaining,
              limitValue: balance.limitValue,
              detail: { tool_name: toolName, request_id: requestId },
            });
          }
          emitToolResult(options, {
            kind: "tool_call_result",
            tool_call_id: requestId,
            tool_name: toolName,
            status: "ok",
            output: parsed.output,
          });
          yield {
            type: "result" as const,
            status: "ok" as const,
            result: parsed.output,
          };
          return;
        }
        emitToolResult(options, {
          kind: "tool_call_result",
          tool_call_id: requestId,
          tool_name: toolName,
          status: "error",
          error: parsed.error,
        });
        yield {
          type: "result" as const,
          status: "error" as const,
          result: parsed.error,
        };
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          emitToolResult(options, {
            kind: "tool_call_result",
            tool_call_id: requestId,
            tool_name: toolName,
            status: "error",
            error: { code: error.code, message: error.message },
          });
          yield {
            type: "result" as const,
            status: "error" as const,
            result: {
              code: error.code,
              message: error.message,
            },
          };
          return;
        }
        const errorBody = {
          code: "capability-execution-error",
          message: error instanceof Error ? error.message : String(error),
        };
        emitToolResult(options, {
          kind: "tool_call_result",
          tool_call_id: requestId,
          tool_name: toolName,
          status: "error",
          error: errorBody,
        });
        yield {
          type: "result" as const,
          status: "error" as const,
          result: errorBody,
        };
      } finally {
        inflightToolCalls.delete(requestId);
      }
    },
    cancel(requestId: string) {
      const inflight = inflightToolCalls.get(requestId);
      if (inflight) {
        emitToolResult(options, {
          kind: "tool_call_cancelled",
          tool_call_id: requestId,
          tool_name: inflight.toolName,
          cancel_initiator: "parent_cancel",
          reason: "capability cancel requested by parent flow",
        });
      }
      options.capabilityTransport?.cancel?.({
        requestId,
        body: { reason: "cancelled-by-host" },
        anchor: options.anchorProvider(),
      });
    },
  };
}
