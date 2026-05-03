import { describe, expect, it } from "vitest";
import { buildRuntimeCompactMutation } from "../../../src/host/do/session-do/runtime-assembly.js";

describe("PP2 runtime compact mutation", () => {
  it("uses session totalTokens as the accounting base, not message estimates", () => {
    const mutation = buildRuntimeCompactMutation({
      totalTokens: 1000,
      messages: [
        { role: "user", content: "x".repeat(4000) },
        { role: "assistant", content: "y".repeat(1200) },
        { role: "user", content: "latest question" },
        { role: "assistant", content: "latest answer" },
        { role: "user", content: "final question" },
      ],
    });

    expect(mutation).not.toBeNull();
    expect(mutation?.tokensBefore).toBe(1000);
    expect(mutation?.tokensFreed).toBe(
      Math.max(0, 1000 - (mutation?.tokensAfter ?? 0)),
    );
    expect(mutation?.tokensFreed).toBeLessThanOrEqual(1000);
  });

  it("does not compact when deterministic summary would increase token count", () => {
    const mutation = buildRuntimeCompactMutation({
      totalTokens: 10,
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "c" },
        { role: "assistant", content: "d" },
        { role: "user", content: "e" },
      ],
    });

    expect(mutation).toBeNull();
  });
});
