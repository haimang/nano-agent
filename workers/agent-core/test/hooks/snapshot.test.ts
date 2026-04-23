import { describe, it, expect } from "vitest";
import { snapshotRegistry, restoreRegistry } from "../../src/hooks/snapshot.js";
import type { HookRegistrySnapshot } from "../../src/hooks/snapshot.js";
import { HookRegistry } from "../../src/hooks/registry.js";
import type { HookHandlerConfig } from "../../src/hooks/types.js";
import { HOOKS_VERSION } from "../../src/hooks/version.js";

function makeHandler(
  overrides: Partial<HookHandlerConfig> & { id: string },
): HookHandlerConfig {
  return {
    source: "session",
    event: "PreToolUse",
    runtime: "local-ts",
    ...overrides,
  };
}

describe("snapshotRegistry", () => {
  it("captures version and timestamp", () => {
    const registry = new HookRegistry();
    const snapshot = snapshotRegistry(registry);

    expect(snapshot.version).toBe(HOOKS_VERSION);
    expect(snapshot.snapshotAt).toBeTruthy();
    expect(() => new Date(snapshot.snapshotAt)).not.toThrow();
  });

  it("captures all registered handlers", () => {
    const registry = new HookRegistry();
    registry.register(makeHandler({ id: "h1", event: "PreToolUse" }));
    registry.register(makeHandler({ id: "h2", event: "SessionStart" }));
    registry.register(makeHandler({ id: "h3", event: "PostToolUse", source: "platform-policy" }));

    const snapshot = snapshotRegistry(registry);

    expect(snapshot.handlers).toHaveLength(3);
    const ids = snapshot.handlers.map((h) => h.id).sort();
    expect(ids).toEqual(["h1", "h2", "h3"]);
  });

  it("captures empty registry", () => {
    const registry = new HookRegistry();
    const snapshot = snapshotRegistry(registry);

    expect(snapshot.handlers).toHaveLength(0);
  });
});

describe("restoreRegistry", () => {
  it("re-registers all handlers from snapshot", () => {
    const snapshot: HookRegistrySnapshot = {
      version: HOOKS_VERSION,
      handlers: [
        makeHandler({ id: "h1", event: "PreToolUse" }),
        makeHandler({ id: "h2", event: "SessionStart" }),
      ],
      snapshotAt: new Date().toISOString(),
    };

    const registry = restoreRegistry(snapshot);

    expect(registry.listAll()).toHaveLength(2);
    expect(registry.lookup("PreToolUse")).toHaveLength(1);
    expect(registry.lookup("SessionStart")).toHaveLength(1);
  });

  it("restores empty snapshot to empty registry", () => {
    const snapshot: HookRegistrySnapshot = {
      version: HOOKS_VERSION,
      handlers: [],
      snapshotAt: new Date().toISOString(),
    };

    const registry = restoreRegistry(snapshot);
    expect(registry.listAll()).toHaveLength(0);
  });

  it("preserves handler properties", () => {
    const handler = makeHandler({
      id: "detailed",
      source: "platform-policy",
      event: "PreToolUse",
      runtime: "local-ts",
      timeoutMs: 5000,
      description: "A detailed handler",
      matcher: { type: "toolName", value: "Bash" },
    });

    const snapshot: HookRegistrySnapshot = {
      version: HOOKS_VERSION,
      handlers: [handler],
      snapshotAt: new Date().toISOString(),
    };

    const registry = restoreRegistry(snapshot);
    const restored = registry.listAll()[0];

    expect(restored.id).toBe("detailed");
    expect(restored.source).toBe("platform-policy");
    expect(restored.timeoutMs).toBe(5000);
    expect(restored.description).toBe("A detailed handler");
    expect(restored.matcher).toEqual({ type: "toolName", value: "Bash" });
  });
});

describe("snapshot / restore roundtrip", () => {
  it("handlers survive a snapshot-restore cycle", () => {
    const original = new HookRegistry();
    original.register(makeHandler({ id: "a", source: "platform-policy", event: "PreToolUse" }));
    original.register(makeHandler({ id: "b", source: "session", event: "SessionStart" }));
    original.register(makeHandler({ id: "c", source: "skill", event: "PostToolUse" }));

    const snapshot = snapshotRegistry(original);
    const restored = restoreRegistry(snapshot);

    // Same handler count
    expect(restored.listAll()).toHaveLength(3);

    // Same IDs
    const originalIds = original.listAll().map((h) => h.id).sort();
    const restoredIds = restored.listAll().map((h) => h.id).sort();
    expect(restoredIds).toEqual(originalIds);

    // Lookups still work
    expect(restored.lookup("PreToolUse")).toHaveLength(1);
    expect(restored.lookup("SessionStart")).toHaveLength(1);
    expect(restored.lookup("PostToolUse")).toHaveLength(1);
  });

  it("B5 — v2 handlers (Setup / Stop / Permission* / Context*) round-trip", () => {
    const original = new HookRegistry();
    const v2Handlers: HookHandlerConfig[] = [
      makeHandler({ id: "setup-1", event: "Setup", source: "platform-policy" }),
      makeHandler({ id: "stop-1", event: "Stop", source: "platform-policy" }),
      makeHandler({ id: "perm-req-1", event: "PermissionRequest" }),
      makeHandler({ id: "perm-den-1", event: "PermissionDenied" }),
      makeHandler({ id: "pressure-1", event: "ContextPressure" }),
      makeHandler({ id: "armed-1", event: "ContextCompactArmed" }),
      makeHandler({ id: "prep-1", event: "ContextCompactPrepareStarted" }),
      makeHandler({ id: "commit-1", event: "ContextCompactCommitted" }),
      makeHandler({ id: "fail-1", event: "ContextCompactFailed" }),
      makeHandler({ id: "overflow-1", event: "EvalSinkOverflow" }),
    ];
    for (const h of v2Handlers) original.register(h);

    const snapshot = snapshotRegistry(original);
    const restored = restoreRegistry(snapshot);

    expect(restored.listAll()).toHaveLength(v2Handlers.length);
    for (const h of v2Handlers) {
      expect(restored.lookup(h.event)).toHaveLength(1);
      expect(restored.lookup(h.event)[0]?.id).toBe(h.id);
    }
  });

  it("source priority is preserved after restore", () => {
    const original = new HookRegistry();
    original.register(makeHandler({ id: "skill-1", source: "skill", event: "PreToolUse" }));
    original.register(makeHandler({ id: "policy-1", source: "platform-policy", event: "PreToolUse" }));
    original.register(makeHandler({ id: "session-1", source: "session", event: "PreToolUse" }));

    const snapshot = snapshotRegistry(original);
    const restored = restoreRegistry(snapshot);

    const handlers = restored.lookup("PreToolUse");
    expect(handlers.map((h) => h.id)).toEqual([
      "policy-1",
      "session-1",
      "skill-1",
    ]);
  });
});
