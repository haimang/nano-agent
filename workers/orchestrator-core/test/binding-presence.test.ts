// HP0 P4-01 — verify-only binding-presence regression。
// 设计来源: docs/design/hero-to-pro/HP0-pre-defer-fixes.md §7.2 F3 + Q3 frozen 法律。
// 本测试**不修改 wrangler 配置**;它只把"当前 wrangler.jsonc 中的 binding/env
// 现实"钉住,任何后续 phase 若想撤掉/改动这两条 binding 必须先回到 design / QNA
// 提出新决议(HP3/HP8 retoken),不能在 HP0 之外被悄悄翻转。
//
// 用 jsonc-friendly 的方式读取(去 // 注释 + 多余逗号)以避免引入 jsonc 解析器
// 依赖。读到的事实: orchestrator-core 与 agent-core 的 prod + preview 两层
// 都声明了 `CONTEXT_CORE` service binding;agent-core 的 vars 与 env.preview.vars
// 都声明 `LANE_E_RPC_FIRST=false`(Q3 frozen 现状,HP0 不翻转)。

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function loadJsonc(relativePath: string): Record<string, unknown> {
  const raw = readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
  // 1) strip line comments  2) strip block comments  3) strip trailing commas
  const stripped = raw
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(stripped);
}

interface ServiceBindingSlot {
  readonly binding?: string;
  readonly service?: string;
}

function bindingNames(slots: unknown): string[] {
  if (!Array.isArray(slots)) return [];
  return (slots as ServiceBindingSlot[])
    .map((slot) => slot.binding)
    .filter((name): name is string => typeof name === "string");
}

describe("HP0 P4-01: verify-only binding presence (orchestrator-core + agent-core wrangler)", () => {
  const orchestrator = loadJsonc("workers/orchestrator-core/wrangler.jsonc");
  const agentCore = loadJsonc("workers/agent-core/wrangler.jsonc");

  it("orchestrator-core prod services include CONTEXT_CORE", () => {
    expect(bindingNames(orchestrator.services)).toContain("CONTEXT_CORE");
  });

  it("orchestrator-core preview services include CONTEXT_CORE", () => {
    const preview = ((orchestrator.env as Record<string, unknown>)?.preview as Record<string, unknown>) ?? {};
    expect(bindingNames(preview.services)).toContain("CONTEXT_CORE");
  });

  it("agent-core prod services include CONTEXT_CORE", () => {
    expect(bindingNames(agentCore.services)).toContain("CONTEXT_CORE");
  });

  it("agent-core preview services include CONTEXT_CORE", () => {
    const preview = ((agentCore.env as Record<string, unknown>)?.preview as Record<string, unknown>) ?? {};
    expect(bindingNames(preview.services)).toContain("CONTEXT_CORE");
  });

  it("agent-core prod vars set LANE_E_RPC_FIRST='false' (HP0 verify-only — Q3 frozen)", () => {
    const vars = (agentCore.vars ?? {}) as Record<string, unknown>;
    expect(vars.LANE_E_RPC_FIRST).toBe("false");
  });

  it("agent-core preview vars set LANE_E_RPC_FIRST='false'", () => {
    const preview = ((agentCore.env as Record<string, unknown>)?.preview as Record<string, unknown>) ?? {};
    const vars = (preview.vars ?? {}) as Record<string, unknown>;
    expect(vars.LANE_E_RPC_FIRST).toBe("false");
  });
});
