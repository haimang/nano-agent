import { describe, expect, it, vi } from "vitest";
import {
  WorkersAiGateway,
  buildWorkersAiExecutionRequestFromMessages,
  toCanonicalMessage,
} from "../../src/llm/gateway.js";
import { getMinimalCommandDeclarations as getBashCoreMinimalCommandDeclarations } from "../../../bash-core/src/fake-bash/commands.js";

describe("WorkersAiGateway", () => {
  it("streams normalized request-started, tool-call, delta, and finish events", async () => {
    const ai = {
      run: vi.fn(async () => ({
        tool_calls: [
          {
            id: "call-1",
            function: {
              name: "pwd",
              arguments: JSON.stringify({}),
            },
          },
        ],
        response: "workspace",
        usage: {
          prompt_tokens: 2,
          completion_tokens: 3,
        },
      })),
    };
    const gateway = new WorkersAiGateway(ai);
    const exec = buildWorkersAiExecutionRequestFromMessages({
      messages: [{ role: "user", content: "where am i?" }],
      tools: true,
    });

    const events = [];
    for await (const event of gateway.executeStream(exec)) {
      events.push(event);
    }

    expect(events[0]).toMatchObject({
      type: "llm.request.started",
      modelId: exec.model.modelId,
    });
    expect(events).toContainEqual({
      type: "tool_call",
      id: "call-1",
      name: "pwd",
      arguments: "{}",
    });
    expect(events).toContainEqual({
      type: "delta",
      content: "workspace",
      index: 0,
    });
    expect(events.at(-1)).toEqual({
      type: "finish",
      finishReason: "tool_calls",
      usage: {
        inputTokens: 2,
        outputTokens: 3,
        totalTokens: 5,
      },
    });
  });

  it("normalizes structured content into canonical messages", () => {
    expect(
      toCanonicalMessage({
        role: "assistant",
        content: [
          { kind: "text", text: "hello" },
          {
            kind: "tool_result",
            toolCallId: "call-1",
            content: { ok: true },
          },
        ],
      }),
    ).toEqual({
      role: "assistant",
      content: [
        { kind: "text", text: "hello" },
        {
          kind: "tool_result",
          toolCallId: "call-1",
          content: JSON.stringify({ ok: true }),
          isError: false,
        },
      ],
    });
  });

  it("builds Workers AI tools from the shared minimal capability registry", () => {
    const exec = buildWorkersAiExecutionRequestFromMessages({
      messages: [{ role: "user", content: "list files" }],
      tools: true,
    });
    const toolNames = exec.request.tools?.map((tool) => tool.function.name).sort();
    const registryNames = getBashCoreMinimalCommandDeclarations().map((decl) => decl.name).sort();

    expect(toolNames).toEqual(registryNames);
    expect(toolNames).toContain("ts-exec");
  });
});
