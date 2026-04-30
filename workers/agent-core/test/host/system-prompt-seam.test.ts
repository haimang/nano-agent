// HP0 P3-01 seam regression — `withNanoAgentSystemPrompt(messages, modelId?)`。
// 设计来源: docs/design/hero-to-pro/HP0-pre-defer-fixes.md §7.2 F2 + Q2 frozen 法律。
// 本测试只覆盖 seam 函数边界本身: HP0 不读 D1,因此带不带 modelId 行为一致。
// HP1 落 `nano_models.base_instructions_suffix` 后,本测试需扩展为"不同 modelId
// 产生不同 suffix"的回归;但函数签名不应再改。

import { describe, expect, it } from "vitest";
import { withNanoAgentSystemPrompt } from "../../src/host/runtime-mainline.js";

describe("HP0 P3-01: withNanoAgentSystemPrompt(messages, modelId?) seam", () => {
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
});
