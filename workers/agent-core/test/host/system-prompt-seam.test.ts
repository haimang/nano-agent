// HP0 P3-01 seam regression — `withNanoAgentSystemPrompt(messages, modelId?)`。
// 设计来源: docs/design/hero-to-pro/HP0-pre-defer-fixes.md §7.2 F2 + Q2 frozen 法律。
// 本测试覆盖 seam 函数边界本身: 未 prime suffix 时,带不带 modelId 行为一致。
// HP0-HP4 复审修复后,不同 modelId 的 suffix 通过 cache seam 注入;函数签名保持不变。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  primeModelPromptSuffix,
  resetModelPromptSuffixCache,
  withNanoAgentSystemPrompt,
} from "../../src/host/runtime-mainline.js";

describe("HP0 P3-01: withNanoAgentSystemPrompt(messages, modelId?) seam", () => {
  beforeEach(() => {
    resetModelPromptSuffixCache();
  });

  afterEach(() => {
    resetModelPromptSuffixCache();
  });

  it("preserves no-arg behavior when called without modelId", () => {
    const messages = [{ role: "user", content: "hi" }];
    const result = withNanoAgentSystemPrompt(messages);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ role: "system" });
    expect(result[1]).toMatchObject({ role: "user", content: "hi" });
  });

  it("accepts an optional modelId without changing HP0 output", () => {
    const messages = [{ role: "user", content: "hi" }];
    const withoutId = withNanoAgentSystemPrompt(messages);
    const withId = withNanoAgentSystemPrompt(messages, "@cf/meta/llama-4-scout-17b-16e-instruct");
    expect(withId).toEqual(withoutId);
  });

  it("still bypasses prepend when an explicit system prompt is already present", () => {
    const messages = [
      { role: "system", content: "custom system" },
      { role: "user", content: "hi" },
    ];
    const result = withNanoAgentSystemPrompt(messages, "any-model-id");
    expect(result).toEqual(messages);
  });

  it("appends a primed model suffix after the base nano-agent system prompt", () => {
    primeModelPromptSuffix("@cf/meta/llama-4-scout-17b-16e-instruct", "Model-specific suffix");
    const result = withNanoAgentSystemPrompt(
      [{ role: "user", content: "hi" }],
      "@cf/meta/llama-4-scout-17b-16e-instruct",
    );
    expect(result[0]).toMatchObject({ role: "system" });
    expect((result[0] as { content: string }).content).toContain("Cloudflare Workers");
    expect((result[0] as { content: string }).content).toContain("Model-specific suffix");
  });
});
