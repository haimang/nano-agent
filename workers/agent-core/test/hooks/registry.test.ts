import { describe, it, expect, beforeEach } from "vitest";
import { HookRegistry } from "../../src/hooks/registry.js";
import type { HookHandlerConfig } from "../../src/hooks/types.js";

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

describe("HookRegistry", () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = new HookRegistry();
  });

  // ── register / unregister ──────────────────────────────────────────

  it("registers a handler and retrieves it via lookup", () => {
    const h = makeHandler({ id: "h1" });
    registry.register(h);
    expect(registry.lookup("PreToolUse")).toEqual([h]);
  });

  it("replaces a handler when re-registered with the same id", () => {
    registry.register(makeHandler({ id: "h1", description: "v1" }));
    registry.register(makeHandler({ id: "h1", description: "v2" }));
    expect(registry.listAll()).toHaveLength(1);
    expect(registry.listAll()[0].description).toBe("v2");
  });

  it("unregisters a handler by id", () => {
    registry.register(makeHandler({ id: "h1" }));
    registry.unregister("h1");
    expect(registry.lookup("PreToolUse")).toEqual([]);
  });

  it("unregister is a no-op for unknown id", () => {
    expect(() => registry.unregister("nope")).not.toThrow();
  });

  // ── lookup with source priority ───────────────────────────────────

  it("returns handlers sorted by source priority", () => {
    registry.register(makeHandler({ id: "skill-1", source: "skill" }));
    registry.register(makeHandler({ id: "session-1", source: "session" }));
    registry.register(
      makeHandler({ id: "policy-1", source: "platform-policy" }),
    );

    const result = registry.lookup("PreToolUse");
    expect(result.map((h) => h.id)).toEqual([
      "policy-1",
      "session-1",
      "skill-1",
    ]);
  });

  it("preserves registration order within the same source", () => {
    registry.register(makeHandler({ id: "s-a", source: "session" }));
    registry.register(makeHandler({ id: "s-b", source: "session" }));
    registry.register(makeHandler({ id: "s-c", source: "session" }));

    const ids = registry.lookup("PreToolUse").map((h) => h.id);
    expect(ids).toEqual(["s-a", "s-b", "s-c"]);
  });

  it("returns empty array when no handlers match the event", () => {
    registry.register(makeHandler({ id: "h1", event: "SessionStart" }));
    expect(registry.lookup("PreToolUse")).toEqual([]);
  });

  // ── listAll ────────────────────────────────────────────────────────

  it("listAll returns every handler", () => {
    registry.register(makeHandler({ id: "a", event: "PreToolUse" }));
    registry.register(makeHandler({ id: "b", event: "SessionStart" }));
    expect(registry.listAll()).toHaveLength(2);
  });

  // ── listBySource ──────────────────────────────────────────────────

  it("listBySource filters correctly", () => {
    registry.register(makeHandler({ id: "p", source: "platform-policy" }));
    registry.register(makeHandler({ id: "s", source: "session" }));
    registry.register(makeHandler({ id: "k", source: "skill" }));

    expect(registry.listBySource("platform-policy").map((h) => h.id)).toEqual([
      "p",
    ]);
    expect(registry.listBySource("session").map((h) => h.id)).toEqual(["s"]);
    expect(registry.listBySource("skill").map((h) => h.id)).toEqual(["k"]);
  });

  // ── clear ─────────────────────────────────────────────────────────

  it("clear removes all handlers", () => {
    registry.register(makeHandler({ id: "a" }));
    registry.register(makeHandler({ id: "b" }));
    registry.clear();
    expect(registry.listAll()).toEqual([]);
  });
});
