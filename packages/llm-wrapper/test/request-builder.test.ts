import { describe, it, expect } from "vitest";
import { buildExecutionRequest } from "../src/request-builder.js";
import { ProviderRegistry } from "../src/registry/providers.js";
import { ModelRegistry } from "../src/registry/models.js";
import { LlmWrapperError } from "../src/errors.js";
import type { CanonicalLLMRequest } from "../src/canonical.js";
import type { ProviderProfile } from "../src/registry/providers.js";
import type { ModelCapabilities } from "../src/registry/models.js";

// ── Fixtures ────────────────────────────────────────────────────

const openaiProfile: ProviderProfile = {
  name: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKeys: ["sk-key-1", "sk-key-2"],
  keyRotationPolicy: "round-robin",
};

const gpt4Cap: ModelCapabilities = {
  modelId: "gpt-4o",
  provider: "openai",
  supportsStream: true,
  supportsTools: true,
  supportsVision: true,
  supportsJsonSchema: true,
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
};

const textOnlyCap: ModelCapabilities = {
  modelId: "text-only",
  provider: "openai",
  supportsStream: false,
  supportsTools: false,
  supportsVision: false,
  supportsJsonSchema: false,
  contextWindow: 4096,
  maxOutputTokens: 1024,
};

function makeRegistries(
  providers: ProviderProfile[] = [openaiProfile],
  models: ModelCapabilities[] = [gpt4Cap, textOnlyCap],
) {
  const pReg = new ProviderRegistry();
  const mReg = new ModelRegistry();
  for (const p of providers) pReg.register(p);
  for (const m of models) mReg.register(m);
  return { providers: pReg, models: mReg };
}

const simpleRequest: CanonicalLLMRequest = {
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
};

// ── Tests ───────────────────────────────────────────────────────

describe("buildExecutionRequest", () => {
  it("builds a valid execution request", () => {
    const { providers, models } = makeRegistries();
    const exec = buildExecutionRequest(simpleRequest, providers, models);

    expect(exec.provider).toEqual(openaiProfile);
    expect(exec.model).toEqual(gpt4Cap);
    expect(exec.request).toEqual(simpleRequest);
    expect(exec.apiKey).toBe("sk-key-1");
  });

  it("rotates API keys across calls", () => {
    const { providers, models } = makeRegistries();
    const exec1 = buildExecutionRequest(simpleRequest, providers, models);
    const exec2 = buildExecutionRequest(simpleRequest, providers, models);

    expect(exec1.apiKey).toBe("sk-key-1");
    expect(exec2.apiKey).toBe("sk-key-2");
  });

  it("throws MODEL_NOT_FOUND for unknown model", () => {
    const { providers, models } = makeRegistries();
    const req: CanonicalLLMRequest = {
      model: "nonexistent",
      messages: [{ role: "user", content: "Hello" }],
    };

    expect(() => buildExecutionRequest(req, providers, models)).toThrow(LlmWrapperError);
    try {
      buildExecutionRequest(req, providers, models);
    } catch (e) {
      const err = e as LlmWrapperError;
      expect(err.code).toBe("MODEL_NOT_FOUND");
      expect(err.category).toBe("invalid_request");
    }
  });

  it("throws PROVIDER_NOT_FOUND when model's provider is missing", () => {
    const { models } = makeRegistries();
    const emptyProviders = new ProviderRegistry();

    expect(() =>
      buildExecutionRequest(simpleRequest, emptyProviders, models),
    ).toThrow(LlmWrapperError);
  });

  it("throws CAPABILITY_MISSING when streaming not supported", () => {
    const { providers, models } = makeRegistries();
    const req: CanonicalLLMRequest = {
      model: "text-only",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
    };

    expect(() => buildExecutionRequest(req, providers, models)).toThrow("does not support streaming");
  });

  it("throws CAPABILITY_MISSING when tools not supported", () => {
    const { providers, models } = makeRegistries();
    const req: CanonicalLLMRequest = {
      model: "text-only",
      messages: [{ role: "user", content: "Hello" }],
      tools: [{ type: "function", function: { name: "test", parameters: {} } }],
    };

    expect(() => buildExecutionRequest(req, providers, models)).toThrow("does not support tools");
  });

  it("throws CAPABILITY_MISSING when json-schema not supported", () => {
    const { providers, models } = makeRegistries();
    const req: CanonicalLLMRequest = {
      model: "text-only",
      messages: [{ role: "user", content: "Hello" }],
      jsonSchema: { type: "object" },
    };

    expect(() => buildExecutionRequest(req, providers, models)).toThrow("does not support JSON schema");
  });

  it("throws CAPABILITY_MISSING when vision not supported but image content present", () => {
    const { providers, models } = makeRegistries();
    const req: CanonicalLLMRequest = {
      model: "text-only",
      messages: [
        {
          role: "user",
          content: [
            { kind: "text", text: "What is this?" },
            { kind: "image_url", url: "https://example.com/img.png" },
          ],
        },
      ],
    };

    expect(() => buildExecutionRequest(req, providers, models)).toThrow("does not support vision");
  });

  it("allows all capabilities for capable model", () => {
    const { providers, models } = makeRegistries();
    const req: CanonicalLLMRequest = {
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { kind: "text", text: "Describe this" },
            { kind: "image_url", url: "https://example.com/img.png" },
          ],
        },
      ],
      stream: true,
      tools: [{ type: "function", function: { name: "test", parameters: {} } }],
      jsonSchema: { type: "object" },
    };

    const exec = buildExecutionRequest(req, providers, models);
    expect(exec.model.modelId).toBe("gpt-4o");
  });

  it("passes through empty tools array without checking capability", () => {
    const { providers, models } = makeRegistries();
    const req: CanonicalLLMRequest = {
      model: "text-only",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
    };

    // Empty tools array should not trigger tools capability check
    expect(() => buildExecutionRequest(req, providers, models)).not.toThrow();
  });
});
