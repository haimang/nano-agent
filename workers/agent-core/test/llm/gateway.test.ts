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
    const expectedNames = [...registryNames, "write_todos"].sort();

    expect(toolNames).toEqual(expectedNames);
    expect(toolNames).toContain("ts-exec");
    const writeTodosTool = exec.request.tools?.find((tool) => tool.function.name === "write_todos");
    expect(writeTodosTool?.function.parameters).toMatchObject({
      type: "object",
      required: ["todos"],
      properties: {
        todos: {
          type: "array",
          minItems: 1,
          maxItems: 100,
        },
        request_uuid: {
          type: "string",
          format: "uuid",
        },
      },
    });
  });

  it("passes explicit model, reasoning effort, and image content to Workers AI", async () => {
    const ai = {
      run: vi.fn(async () => ({
        response: "ok",
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })),
    };
    const gateway = new WorkersAiGateway(ai);
    const exec = buildWorkersAiExecutionRequestFromMessages({
      messages: [
        {
          role: "user",
          model_id: "@cf/meta/llama-4-scout-17b-16e-instruct",
          reasoning: { effort: "high" },
          content: [
            { kind: "text", text: "describe" },
            { kind: "image_url", url: "/sessions/s/files/f/content" },
          ],
        },
      ],
      tools: false,
    });

    for await (const _event of gateway.executeStream(exec)) {
      // drain
    }

    expect(ai.run).toHaveBeenCalledWith(
      "@cf/meta/llama-4-scout-17b-16e-instruct",
      expect.objectContaining({
        reasoning_effort: "high",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "describe" },
              { type: "image_url", image_url: { url: "/sessions/s/files/f/content" } },
            ],
          },
        ],
      }),
    );
  });

  it("uses injected D1-backed model capabilities for runtime model selection", () => {
    const exec = buildWorkersAiExecutionRequestFromMessages({
      messages: [
        {
          role: "user",
          model_id: "@cf/custom/reasoning-vision",
          reasoning: { effort: "low" },
          content: [
            { kind: "text", text: "describe" },
            { kind: "image_url", url: "/sessions/s/files/f/content" },
          ],
        },
      ],
      modelCapabilities: [
        {
          modelId: "@cf/custom/reasoning-vision",
          provider: "workers-ai",
          supportsStream: true,
          supportsTools: true,
          supportsVision: true,
          supportsReasoning: true,
          reasoningEfforts: ["low"],
          supportsJsonSchema: false,
          contextWindow: 8192,
          maxOutputTokens: 1024,
        },
      ],
    });

    expect(exec.model.modelId).toBe("@cf/custom/reasoning-vision");
    expect(exec.request.reasoning?.effort).toBe("low");
  });

  it("prefers explicit modelId/reasoning inputs over message inference", () => {
    const exec = buildWorkersAiExecutionRequestFromMessages({
      messages: [
        {
          role: "user",
          model_id: "@cf/meta/llama-3.2-3b-instruct",
          reasoning: { effort: "low" },
          content: "hello",
        },
      ],
      modelId: "@cf/meta/llama-4-scout-17b-16e-instruct",
      reasoning: { effort: "high" },
      modelCapabilities: [
        {
          modelId: "@cf/meta/llama-4-scout-17b-16e-instruct",
          provider: "workers-ai",
          supportsStream: true,
          supportsTools: true,
          supportsVision: false,
          supportsReasoning: true,
          reasoningEfforts: ["high"],
          supportsJsonSchema: false,
          contextWindow: 131072,
          maxOutputTokens: 4096,
        },
      ],
    });

    expect(exec.model.modelId).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
    expect(exec.request.reasoning?.effort).toBe("high");
  });
});
