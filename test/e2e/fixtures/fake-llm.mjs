/**
 * Fake LLM fetcher for E2E tests.
 * Simulates an OpenAI-compatible chat completion endpoint.
 */

export function createAssistantResponse(content) {
  return {
    id: "resp-assistant",
    object: "chat.completion",
    model: "gpt-4o",
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 10, completion_tokens: content.length, total_tokens: 10 + content.length },
  };
}

export function createToolCallResponse(toolCalls) {
  return {
    id: "resp-tool",
    object: "chat.completion",
    model: "gpt-4o",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: toolCalls.map((tc, idx) => ({
          id: tc.id ?? `call-${idx}`,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
      },
      finish_reason: "tool_calls",
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

export function createErrorResponse(status, message) {
  return {
    ok: false,
    status,
    text: async () => message,
    headers: new Map(),
    json: async () => ({ error: { message } }),
  };
}

export function createSuccessResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    headers: new Map(),
    json: async () => body,
  };
}

export function createFakeFetcher(scenarios) {
  let callIndex = 0;
  return async (_url, init) => {
    const scenario = scenarios[callIndex++];
    if (!scenario) {
      return createErrorResponse(500, "unexpected fetch call");
    }
    if (typeof scenario === "function") {
      return scenario(init);
    }
    return createSuccessResponse(scenario);
  };
}

export function createStreamingDeltaResponse(deltas) {
  // Minimal non-streaming fallback for tests that don't strictly require SSE parsing
  return createSuccessResponse(createAssistantResponse(deltas.join("")));
}
