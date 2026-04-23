import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryCapabilityRegistry } from "../src/registry.js";
import type { CapabilityDeclaration } from "../src/types.js";

function makeDecl(name: string, overrides?: Partial<CapabilityDeclaration>): CapabilityDeclaration {
  return {
    name,
    kind: "filesystem",
    description: `Test capability: ${name}`,
    inputSchema: {},
    executionTarget: "local-ts",
    policy: "allow",
    ...overrides,
  };
}

describe("InMemoryCapabilityRegistry", () => {
  let registry: InMemoryCapabilityRegistry;

  beforeEach(() => {
    registry = new InMemoryCapabilityRegistry();
  });

  it("starts empty", () => {
    expect(registry.list()).toEqual([]);
    expect(registry.has("anything")).toBe(false);
  });

  it("registers and retrieves a capability", () => {
    const decl = makeDecl("ls");
    registry.register(decl);

    expect(registry.has("ls")).toBe(true);
    expect(registry.get("ls")).toBe(decl);
  });

  it("lists all registered capabilities", () => {
    registry.register(makeDecl("ls"));
    registry.register(makeDecl("cat"));
    registry.register(makeDecl("pwd"));

    const names = registry.list().map((d) => d.name);
    expect(names).toEqual(["ls", "cat", "pwd"]);
  });

  it("returns undefined for unregistered capability", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("throws when registering a duplicate name", () => {
    registry.register(makeDecl("ls"));
    expect(() => registry.register(makeDecl("ls"))).toThrowError(
      'Capability "ls" is already registered',
    );
  });

  it("removes a capability", () => {
    registry.register(makeDecl("ls"));
    expect(registry.remove("ls")).toBe(true);
    expect(registry.has("ls")).toBe(false);
    expect(registry.get("ls")).toBeUndefined();
  });

  it("returns false when removing a non-existent capability", () => {
    expect(registry.remove("nonexistent")).toBe(false);
  });

  it("allows re-registration after removal", () => {
    const decl1 = makeDecl("ls", { description: "first" });
    const decl2 = makeDecl("ls", { description: "second" });

    registry.register(decl1);
    registry.remove("ls");
    registry.register(decl2);

    expect(registry.get("ls")?.description).toBe("second");
  });
});
