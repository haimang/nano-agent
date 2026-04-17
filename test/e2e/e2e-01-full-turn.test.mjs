import test from "node:test";
import assert from "node:assert/strict";

import {
  ProviderRegistry,
  ModelRegistry,
  LLMExecutor,
  OpenAIChatAdapter,
  buildExecutionRequest,
} from "../../packages/llm-wrapper/dist/index.js";
import {
  CapabilityExecutor,
  CapabilityPolicyGate,
  InMemoryCapabilityRegistry,
  LocalTsTarget,
  registerMinimalCommands,
  INLINE_RESULT_MAX_BYTES,
} from "../../packages/capability-runtime/dist/index.js";
import { HookDispatcher } from "../../packages/hooks/dist/index.js";
import { buildStreamEventBody, mapRuntimeEventToStreamKind } from "../../packages/agent-runtime-kernel/dist/events.js";
import { SessionStreamEventBodySchema } from "../../packages/nacp-session/dist/stream-event.js";
import { MountRouter, WorkspaceNamespace, MemoryBackend } from "../../packages/workspace-context-artifacts/dist/index.js";

import { createFakeFetcher, createToolCallResponse } from "./fixtures/fake-llm.mjs";
import { createTraceSink, createInspector } from "./fixtures/fake-session.mjs";
import { TURN_UUID, TEAM_UUID, NOW } from "./fixtures/seed-data.mjs";

test("E2E-01: Full Turn — Input → Kernel → LLM → Tool → Result → Stream", async () => {
  // ── 1. Workspace namespace ────────────────────────────────────────
  const router = new MountRouter();
  const memBackend = new MemoryBackend();
  await memBackend.write("src/app.ts", "console.log('hello')");
  router.addMount({ mountPoint: "/workspace", backend: "memory", access: "writable" }, memBackend);
  const namespace = new WorkspaceNamespace(router);

  // ── 2. LLM request + fake execution ───────────────────────────────
  const providers = new ProviderRegistry();
  providers.register({
    name: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKeys: ["k-A"],
    retryConfig: { maxRetries: 0 },
  });
  const models = new ModelRegistry();
  models.register({
    modelId: "gpt-4o",
    provider: "openai",
    supportsStream: false,
    supportsTools: true,
    supportsVision: false,
    supportsJsonSchema: false,
    contextWindow: 4096,
    maxOutputTokens: 1024,
  });

  const fetcher = createFakeFetcher([
    createToolCallResponse([{ id: "call-ls", name: "ls", args: { path: "/workspace" } }]),
  ]);

  const exec = buildExecutionRequest(
    {
      model: "gpt-4o",
      messages: [{ role: "user", content: "List files in /workspace" }],
      tools: [
        {
          type: "function",
          function: { name: "ls", description: "list files", parameters: { type: "object", properties: {} },
          },
        },
      ],
    },
    providers,
    models,
  );

  const executor = new LLMExecutor(new OpenAIChatAdapter(), { fetcher, providerRegistry: providers });
  const llmResult = await executor.execute(exec);

  assert.equal(llmResult.finishReason, "tool_calls");
  const toolCallPart = llmResult.content.find((c) => c.kind === "tool_call");
  assert.ok(toolCallPart, "expected a tool_call content part");
  assert.equal(toolCallPart.name, "ls");

  // ── 3. Capability execution ───────────────────────────────────────
  const capRegistry = new InMemoryCapabilityRegistry();
  registerMinimalCommands(capRegistry);
  const policy = new CapabilityPolicyGate(capRegistry);
  
  // Set up LocalTsTarget with filesystem handlers
  const { createFilesystemHandlers } = await import("../../packages/capability-runtime/dist/index.js");
  const fsHandlers = createFilesystemHandlers({ workspacePath: "/workspace" });
  const localTarget = new LocalTsTarget();
  for (const [name, handler] of fsHandlers) {
    localTarget.registerHandler(name, handler);
  }
  
  const capExecutor = new CapabilityExecutor(
    new Map([["local-ts", localTarget]]),
    policy,
  );

  const capPlan = {
    capabilityName: "ls",
    input: JSON.parse(toolCallPart.arguments),
    executionTarget: "local-ts",
    source: "structured-tool",
  };
  const capResult = await capExecutor.execute(capPlan);

  assert.equal(capResult.kind, "inline");
  assert.ok(typeof capResult.output === "string");
  assert.ok(capResult.output.includes("/workspace"), "output should contain resolved path");

  // ── 4. Hooks (non-blocking PreToolUse + PostToolUse) ──────────────
  const { HookRegistry, HookDispatcher, LocalTsRuntime } = await import("../../packages/hooks/dist/index.js");
  const hookRegistry = new HookRegistry();
  let preHookFired = false;
  let postHookFired = false;
  const hookRuntime = new LocalTsRuntime();
  hookRegistry.register({
    id: "h1",
    event: "PreToolUse",
    handler: async () => {
      preHookFired = true;
      return { action: "continue" };
    },
    runtime: "local-ts",
  });
  hookRuntime.registerHandler("h1", async () => {
    preHookFired = true;
    return { action: "continue" };
  });
  hookRegistry.register({
    id: "h2",
    event: "PostToolUse",
    handler: async () => {
      postHookFired = true;
      return { action: "continue" };
    },
    runtime: "local-ts",
  });
  hookRuntime.registerHandler("h2", async () => {
    postHookFired = true;
    return { action: "continue" };
  });
  const dispatcher = new HookDispatcher(hookRegistry, new Map([["local-ts", hookRuntime]]));

  await dispatcher.emit("PreToolUse", { tool_name: "ls", tool_input: capPlan.input });
  await dispatcher.emit("PostToolUse", { tool_name: "ls", tool_result: capResult.output });

  assert.equal(preHookFired, true);
  assert.equal(postHookFired, true);

  // ── 5. Trace + Inspector ──────────────────────────────────────────
  const { sink, events } = createTraceSink();
  const inspector = createInspector();

  sink.emit({
    eventKind: "tool.call.result",
    timestamp: NOW,
    sessionUuid: TURN_UUID,
    teamUuid: TEAM_UUID,
    turnUuid: TURN_UUID,
    toolName: "ls",
    resultSizeBytes: new TextEncoder().encode(capResult.output).length,
    durationMs: 12,
  });

  for (const e of events) {
    if (e.tier === "durable-audit") {
      inspector.onStreamEvent(e.event.eventKind, 1, e.event);
    }
  }

  assert.equal(inspector.getRejections().length, 0);
  const auditEvent = events.find((e) => e.tier === "durable-audit" || e.tier === "durable-transcript");
  assert.ok(auditEvent);
  assert.equal(auditEvent.event.toolName, "ls");

  // ── 6. Kernel stream event mapping ────────────────────────────────
  const runtimeEvent = {
    type: "tool.call.result",
    turnId: TURN_UUID,
    toolName: "ls",
    requestId: TURN_UUID,
    status: "ok",
    output: capResult.output,
    timestamp: NOW,
  };

  const kind = mapRuntimeEventToStreamKind(runtimeEvent);
  assert.equal(kind, "tool.call.result");

  const streamBody = buildStreamEventBody(runtimeEvent);
  assert.equal(streamBody.kind, kind);
  assert.equal(SessionStreamEventBodySchema.safeParse(streamBody).success, true);
});
