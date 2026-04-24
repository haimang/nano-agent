import { createExecHandlers } from "./capabilities/exec.js";
import { createFilesystemHandlers } from "./capabilities/filesystem.js";
import { createNetworkHandlers } from "./capabilities/network.js";
import { createSearchHandlers } from "./capabilities/search.js";
import { createTextProcessingHandlers } from "./capabilities/text-processing.js";
import { createVcsHandlers } from "./capabilities/vcs.js";
import { CapabilityExecutor } from "./executor.js";
import { registerMinimalCommands } from "./fake-bash/commands.js";
import { planFromToolCall } from "./planner.js";
import { CapabilityPolicyGate } from "./policy.js";
import { InMemoryCapabilityRegistry } from "./registry.js";
import type { CapabilityResult } from "./result.js";
import { LocalTsTarget, type LocalCapabilityHandler } from "./targets/local-ts.js";
import type { CapabilityDeclaration } from "./types.js";

export const PX_SLEEP_TOOL_NAME = "__px_sleep";

export interface WorkerToolCallBody {
  readonly tool_name: string;
  readonly tool_input?: unknown;
}

export interface WorkerCapabilityCallRequest {
  readonly requestId: string;
  readonly capabilityName?: string;
  readonly body: WorkerToolCallBody;
}

export interface WorkerCapabilityCancelRequest {
  readonly requestId: string;
  readonly body?: { readonly reason?: string };
}

interface BashWorkerRuntime {
  readonly registry: InMemoryCapabilityRegistry;
  readonly gate: CapabilityPolicyGate;
  readonly target: LocalTsTarget;
  readonly executor: CapabilityExecutor;
}

const PX_SLEEP_DECLARATION: CapabilityDeclaration = {
  name: PX_SLEEP_TOOL_NAME,
  kind: "custom",
  description: "Preview-only deterministic delay tool for live E2E cancel verification",
  inputSchema: {
    type: "object",
    properties: {
      ms: { type: "integer" },
    },
  },
  executionTarget: "local-ts",
  policy: "allow",
};

function createPreviewSleepHandler(): LocalCapabilityHandler {
  return async (input, signal) => {
    const candidate =
      input && typeof input === "object" && "ms" in (input as Record<string, unknown>)
        ? (input as Record<string, unknown>).ms
        : undefined;
    const ms = typeof candidate === "number" && Number.isFinite(candidate)
      ? Math.max(1, Math.min(5_000, Math.trunc(candidate)))
      : 250;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });

    return { output: `[px-sleep] completed ${ms}ms` };
  };
}

function registerAllHandlers(target: LocalTsTarget): void {
  const maps = [
    createFilesystemHandlers({}),
    createSearchHandlers({}),
    createTextProcessingHandlers(),
    createNetworkHandlers({
      fetchImpl: typeof fetch === "function" ? fetch.bind(globalThis) : undefined,
    }),
    createExecHandlers(),
    createVcsHandlers(),
  ];

  for (const handlers of maps) {
    for (const [name, handler] of handlers) {
      target.registerHandler(name, handler);
    }
  }
  target.registerHandler(PX_SLEEP_TOOL_NAME, createPreviewSleepHandler());
}

function createRuntime(): BashWorkerRuntime {
  const registry = new InMemoryCapabilityRegistry();
  registerMinimalCommands(registry);
  registry.register(PX_SLEEP_DECLARATION);

  const target = new LocalTsTarget();
  registerAllHandlers(target);

  return {
    registry,
    gate: new CapabilityPolicyGate(registry),
    target,
    executor: new CapabilityExecutor(
      new Map([["local-ts", target]]),
      new CapabilityPolicyGate(registry),
    ),
  };
}

const runtime = createRuntime();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toErrorBody(code: string, message: string) {
  return {
    status: "error" as const,
    error: { code, message },
  };
}

function toOkBody(output?: string) {
  return {
    status: "ok" as const,
    ...(output !== undefined ? { output } : {}),
  };
}

function resultToToolResponse(result: CapabilityResult) {
  switch (result.kind) {
    case "inline":
    case "promoted":
      return toOkBody(result.output ?? "");
    case "cancelled":
    case "timeout":
    case "error":
    default:
      return toErrorBody(
        result.error?.code ?? result.kind,
        result.error?.message ?? `capability execution ended with ${result.kind}`,
      );
  }
}

export async function executeCapabilityCall(
  request: WorkerCapabilityCallRequest,
  options: { previewMode: boolean },
) {
  const { requestId, capabilityName, body } = request;
  const toolName = body.tool_name;
  const toolInput = isRecord(body.tool_input) ? body.tool_input : {};

  if (capabilityName && capabilityName !== toolName) {
    return toErrorBody(
      "capability-name-mismatch",
      `capabilityName "${capabilityName}" does not match tool_name "${toolName}"`,
    );
  }
  if (toolName === PX_SLEEP_TOOL_NAME && !options.previewMode) {
    return toErrorBody(
      "preview-only-tool",
      `${PX_SLEEP_TOOL_NAME} is restricted to preview verification`,
    );
  }

  const plan = planFromToolCall(toolName, toolInput, runtime.registry);
  if (!plan) {
    return toErrorBody("unknown-tool", `tool "${toolName}" is not registered`);
  }

  const result = await runtime.executor.executeWithRequestId(plan, requestId);
  return resultToToolResponse(result);
}

export function cancelCapabilityCall(requestId: string) {
  return { ok: true, cancelled: runtime.executor.cancel(requestId) };
}

export function parseCapabilityCallRequest(raw: unknown): WorkerCapabilityCallRequest | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.requestId !== "string" || raw.requestId.length === 0) return null;
  if (!isRecord(raw.body) || typeof raw.body.tool_name !== "string") return null;
  return {
    requestId: raw.requestId,
    capabilityName: typeof raw.capabilityName === "string" ? raw.capabilityName : undefined,
    body: {
      tool_name: raw.body.tool_name,
      tool_input: isRecord(raw.body.tool_input) ? raw.body.tool_input : {},
    },
  };
}

export function parseCapabilityCancelRequest(raw: unknown): WorkerCapabilityCancelRequest | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.requestId !== "string" || raw.requestId.length === 0) return null;
  const body = isRecord(raw.body) ? raw.body : undefined;
  return {
    requestId: raw.requestId,
    body: typeof body?.reason === "string" ? { reason: body.reason } : undefined,
  };
}
