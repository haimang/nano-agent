import test from "node:test";
import assert from "node:assert/strict";

import {
  CapabilityExecutor,
  CapabilityPolicyGate,
  InMemoryCapabilityRegistry,
  LocalTsTarget,
  registerMinimalCommands,
  createFilesystemHandlers,
  createSearchHandlers,
  planFromBashCommand,
} from "../../packages/capability-runtime/dist/index.js";
import {
  WorkspaceNamespace,
  MountRouter,
  MemoryBackend,
  normalizePath,
} from "../../packages/workspace-context-artifacts/dist/index.js";
import { buildStreamEventBody } from "../../packages/agent-runtime-kernel/dist/events.js";
import { SessionStreamEventBodySchema } from "../../packages/nacp-session/dist/stream-event.js";
import { redactPayload } from "../../packages/nacp-session/dist/index.js";
import { TURN_UUID, NOW } from "./fixtures/seed-data.mjs";

test("E2E-07: Workspace File Operations via Capability Runtime Mount Router", async () => {
  // 1. Setup workspace namespace
  const router = new MountRouter();
  const writableBackend = new MemoryBackend();
  const readonlyBackend = new MemoryBackend();
  await readonlyBackend.write("readme.md", "# Readme");

  router.addMount({ mountPoint: "/workspace", backend: "memory", access: "writable" }, writableBackend);
  router.addMount({ mountPoint: "/readonly", backend: "memory", access: "readonly" }, readonlyBackend);
  const namespace = new WorkspaceNamespace(router);

  // 2. Register capabilities and set up LocalTsTarget with filesystem handlers
  const registry = new InMemoryCapabilityRegistry();
  registerMinimalCommands(registry, {
    policyOverrides: {
      mkdir: "allow",
      write: "allow",
    },
  });
  const policy = new CapabilityPolicyGate(registry);
  
  // Set up LocalTsTarget with filesystem handlers
  const fsHandlers = createFilesystemHandlers({
    workspacePath: "/workspace",
    namespace,
  });
  const searchHandlers = createSearchHandlers({
    workspacePath: "/workspace",
    namespace,
  });
  const localTarget = new LocalTsTarget();
  for (const [name, handler] of fsHandlers) {
    localTarget.registerHandler(name, handler);
  }
  for (const [name, handler] of searchHandlers) {
    localTarget.registerHandler(name, handler);
  }
  
  const executor = new CapabilityExecutor(
    new Map([["local-ts", localTarget]]),
    policy,
  );

  // Helper to execute a filesystem command plan
  async function execCmd(name, input) {
    const plan = { capabilityName: name, input, executionTarget: "local-ts", source: "bash-command" };
    return executor.execute(plan);
  }

  // mkdir
  const mkdirResult = await execCmd("mkdir", { path: "/workspace/src" });
  assert.equal(mkdirResult.kind, "inline");
  assert.match(mkdirResult.output, /mkdir-partial-no-directory-entity/);

  // write
  const writeResult = await execCmd("write", {
    path: "/workspace/src/main.ts",
    content: "console.log('hello')",
  });
  assert.equal(writeResult.kind, "inline");

  // cat (namespace-backed handlers now read the actual content)
  const catResult = await execCmd("cat", { path: "/workspace/src/main.ts" });
  assert.equal(catResult.kind, "inline");
  assert.equal(catResult.output, "console.log('hello')");

  // ls (namespace-backed handlers enumerate real entries)
  const lsResult = await execCmd("ls", { path: "/workspace" });
  assert.equal(lsResult.kind, "inline");
  assert.ok(lsResult.output.includes("/workspace/src"));

  // grep -> rg canonical alias via the planner
  const grepPlan = planFromBashCommand(
    "grep hello /workspace/src/main.ts",
    registry,
  );
  assert.ok(grepPlan);
  assert.equal(grepPlan.capabilityName, "rg");
  const grepResult = await executor.execute(grepPlan);
  assert.equal(grepResult.kind, "inline");
  assert.ok(grepResult.output.includes("/workspace/src/main.ts"));
  assert.ok(grepResult.output.includes("hello"));

  // readonly mount write should fail
  try {
    await namespace.writeFile(normalizePath("/readonly/hack.txt"), "bad");
    assert.fail("should throw for readonly mount write");
  } catch (err) {
    assert.ok(err.message.includes("readonly"));
  }

  // 3. Stream event redaction
  const streamBody = buildStreamEventBody({
    type: "tool.call.result",
    turnId: TURN_UUID,
    toolName: "cat",
    requestId: TURN_UUID,
    status: "ok",
    output: catResult.output,
    timestamp: NOW,
  });
  assert.equal(SessionStreamEventBodySchema.safeParse(streamBody).success, true);

  // Simulate client-visible redaction
  const redacted = redactPayload({ output: catResult.output }, ["output"]);
  assert.equal(redacted.output, "[redacted]");
});
