import { describe, it, expect } from "vitest";
import { matchEvent } from "../../src/hooks/matcher.js";
import type { HookMatcherConfig } from "../../src/hooks/types.js";

describe("matchEvent", () => {
  // ── exact ─────────────────────────────────────────────────────────

  it("exact: matches when value equals eventName", () => {
    const cfg: HookMatcherConfig = { type: "exact", value: "PreToolUse" };
    expect(matchEvent(cfg, "PreToolUse")).toBe(true);
  });

  it("exact: does not match when value differs", () => {
    const cfg: HookMatcherConfig = { type: "exact", value: "PreToolUse" };
    expect(matchEvent(cfg, "PostToolUse")).toBe(false);
  });

  // ── wildcard ──────────────────────────────────────────────────────

  it("wildcard '*' matches any event name", () => {
    const cfg: HookMatcherConfig = { type: "wildcard", value: "*" };
    expect(matchEvent(cfg, "PreToolUse")).toBe(true);
    expect(matchEvent(cfg, "SessionStart")).toBe(true);
  });

  it("wildcard with non-'*' value does not match", () => {
    const cfg: HookMatcherConfig = { type: "wildcard", value: "foo" };
    expect(matchEvent(cfg, "PreToolUse")).toBe(false);
  });

  // ── toolName ──────────────────────────────────────────────────────

  it("toolName: matches when context.toolName equals config value", () => {
    const cfg: HookMatcherConfig = { type: "toolName", value: "Bash" };
    expect(matchEvent(cfg, "PreToolUse", { toolName: "Bash" })).toBe(true);
  });

  it("toolName: does not match when toolName differs", () => {
    const cfg: HookMatcherConfig = { type: "toolName", value: "Bash" };
    expect(matchEvent(cfg, "PreToolUse", { toolName: "Read" })).toBe(false);
  });

  it("toolName: does not match when context has no toolName", () => {
    const cfg: HookMatcherConfig = { type: "toolName", value: "Bash" };
    expect(matchEvent(cfg, "PreToolUse", {})).toBe(false);
  });

  it("toolName: does not match when context is undefined", () => {
    const cfg: HookMatcherConfig = { type: "toolName", value: "Bash" };
    expect(matchEvent(cfg, "PreToolUse")).toBe(false);
  });

  // ── undefined matcher (matches all) ───────────────────────────────

  it("undefined matcher matches everything", () => {
    expect(matchEvent(undefined, "PreToolUse")).toBe(true);
    expect(matchEvent(undefined, "SessionStart")).toBe(true);
    expect(matchEvent(undefined, "PostCompact", { toolName: "X" })).toBe(true);
  });
});
