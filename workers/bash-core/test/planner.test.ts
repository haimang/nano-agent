import { describe, it, expect, beforeEach } from "vitest";
import {
  parseSimpleCommand,
  planFromBashCommand,
  planFromToolCall,
} from "../src/planner.js";
import { InMemoryCapabilityRegistry } from "../src/registry.js";
import { registerMinimalCommands } from "../src/fake-bash/commands.js";

describe("parseSimpleCommand", () => {
  it("parses a simple command with no args", () => {
    expect(parseSimpleCommand("pwd")).toEqual({ command: "pwd", args: [] });
  });

  it("parses a command with positional args", () => {
    expect(parseSimpleCommand("ls /workspace")).toEqual({
      command: "ls",
      args: ["/workspace"],
    });
  });

  it("parses multiple args", () => {
    expect(parseSimpleCommand("mv a.txt b.txt")).toEqual({
      command: "mv",
      args: ["a.txt", "b.txt"],
    });
  });

  it("handles double-quoted arguments", () => {
    expect(parseSimpleCommand('cat "my file.txt"')).toEqual({
      command: "cat",
      args: ["my file.txt"],
    });
  });

  it("handles single-quoted arguments", () => {
    expect(parseSimpleCommand("rg 'hello world' .")).toEqual({
      command: "rg",
      args: ["hello world", "."],
    });
  });

  it("handles extra whitespace", () => {
    expect(parseSimpleCommand("  ls   /tmp   ")).toEqual({
      command: "ls",
      args: ["/tmp"],
    });
  });

  it("handles empty string", () => {
    expect(parseSimpleCommand("")).toEqual({ command: "", args: [] });
  });

  it("handles whitespace-only string", () => {
    expect(parseSimpleCommand("   ")).toEqual({ command: "", args: [] });
  });
});

describe("planFromBashCommand", () => {
  let registry: InMemoryCapabilityRegistry;

  beforeEach(() => {
    registry = new InMemoryCapabilityRegistry();
    registerMinimalCommands(registry);
  });

  it("plans a simple ls command", () => {
    const plan = planFromBashCommand("ls /workspace", registry);
    expect(plan).not.toBeNull();
    expect(plan!.capabilityName).toBe("ls");
    expect(plan!.input).toEqual({ path: "/workspace" });
    expect(plan!.source).toBe("bash-command");
    expect(plan!.rawCommand).toBe("ls /workspace");
    expect(plan!.executionTarget).toBe("local-ts");
  });

  it("plans pwd with no args", () => {
    const plan = planFromBashCommand("pwd", registry);
    expect(plan).not.toBeNull();
    expect(plan!.capabilityName).toBe("pwd");
    expect(plan!.input).toEqual({});
  });

  it("plans cat with a file path", () => {
    const plan = planFromBashCommand("cat readme.md", registry);
    expect(plan).not.toBeNull();
    expect(plan!.capabilityName).toBe("cat");
    expect(plan!.input).toEqual({ path: "readme.md" });
  });

  it("plans mv with source and destination", () => {
    const plan = planFromBashCommand("mv old.txt new.txt", registry);
    expect(plan).not.toBeNull();
    expect(plan!.input).toEqual({ source: "old.txt", destination: "new.txt" });
  });

  it("returns null for unrecognized commands", () => {
    expect(planFromBashCommand("unknown-cmd foo", registry)).toBeNull();
  });

  it("returns null for empty command", () => {
    expect(planFromBashCommand("", registry)).toBeNull();
  });
});

describe("planFromToolCall", () => {
  let registry: InMemoryCapabilityRegistry;

  beforeEach(() => {
    registry = new InMemoryCapabilityRegistry();
    registerMinimalCommands(registry);
  });

  it("plans a direct tool call", () => {
    const plan = planFromToolCall("ls", { path: "/tmp" }, registry);
    expect(plan).not.toBeNull();
    expect(plan!.capabilityName).toBe("ls");
    expect(plan!.input).toEqual({ path: "/tmp" });
    expect(plan!.source).toBe("structured-tool");
    expect(plan!.rawCommand).toBeUndefined();
  });

  it("returns null for unregistered tool", () => {
    expect(planFromToolCall("unknown", {}, registry)).toBeNull();
  });
});
