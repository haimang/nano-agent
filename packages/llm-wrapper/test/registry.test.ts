import { describe, it, expect } from "vitest";
import { ProviderRegistry } from "../src/registry/providers.js";
import { ModelRegistry } from "../src/registry/models.js";
import { loadRegistryFromConfig, loadRegistryFromEnv } from "../src/registry/loader.js";
import type { ProviderProfile } from "../src/registry/providers.js";
import type { ModelCapabilities } from "../src/registry/models.js";

// ── Fixtures ────────────────────────────────────────────────────

const openaiProfile: ProviderProfile = {
  name: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKeys: ["sk-key-1", "sk-key-2", "sk-key-3"],
  keyRotationPolicy: "round-robin",
  defaultHeaders: { "X-Custom": "test" },
  retryConfig: { maxRetries: 3, baseDelayMs: 500 },
};

const anthropicProfile: ProviderProfile = {
  name: "anthropic",
  baseUrl: "https://api.anthropic.com/v1",
  apiKeys: ["ant-key-1"],
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

const claudeCap: ModelCapabilities = {
  modelId: "claude-sonnet-4-20250514",
  provider: "anthropic",
  supportsStream: true,
  supportsTools: true,
  supportsVision: true,
  supportsJsonSchema: false,
  contextWindow: 200_000,
  maxOutputTokens: 8_192,
  notes: "Anthropic model",
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

// ── ProviderRegistry ────────────────────────────────────────────

describe("ProviderRegistry", () => {
  it("registers and retrieves a provider", () => {
    const reg = new ProviderRegistry();
    reg.register(openaiProfile);
    expect(reg.get("openai")).toEqual(openaiProfile);
  });

  it("returns undefined for unknown provider", () => {
    const reg = new ProviderRegistry();
    expect(reg.get("nonexistent")).toBeUndefined();
  });

  it("lists all registered providers", () => {
    const reg = new ProviderRegistry();
    reg.register(openaiProfile);
    reg.register(anthropicProfile);
    expect(reg.list()).toHaveLength(2);
    expect(reg.list().map((p) => p.name)).toContain("openai");
    expect(reg.list().map((p) => p.name)).toContain("anthropic");
  });

  it("overwrites profile on re-register with same name", () => {
    const reg = new ProviderRegistry();
    reg.register(openaiProfile);
    const updated = { ...openaiProfile, baseUrl: "https://new.api.com" };
    reg.register(updated);
    expect(reg.get("openai")?.baseUrl).toBe("https://new.api.com");
    expect(reg.list()).toHaveLength(1);
  });

  it("throws on empty name", () => {
    const reg = new ProviderRegistry();
    expect(() =>
      reg.register({ ...openaiProfile, name: "" }),
    ).toThrow("non-empty name");
  });

  it("throws on empty apiKeys", () => {
    const reg = new ProviderRegistry();
    expect(() =>
      reg.register({ ...openaiProfile, apiKeys: [] }),
    ).toThrow("at least one API key");
  });

  describe("key rotation", () => {
    it("rotates keys round-robin", () => {
      const reg = new ProviderRegistry();
      reg.register(openaiProfile);

      expect(reg.getNextApiKey("openai")).toBe("sk-key-1");
      expect(reg.getNextApiKey("openai")).toBe("sk-key-2");
      expect(reg.getNextApiKey("openai")).toBe("sk-key-3");
      // Wraps around
      expect(reg.getNextApiKey("openai")).toBe("sk-key-1");
    });

    it("returns single key repeatedly for single-key provider", () => {
      const reg = new ProviderRegistry();
      reg.register(anthropicProfile);

      expect(reg.getNextApiKey("anthropic")).toBe("ant-key-1");
      expect(reg.getNextApiKey("anthropic")).toBe("ant-key-1");
    });

    it("throws when requesting key for unregistered provider", () => {
      const reg = new ProviderRegistry();
      expect(() => reg.getNextApiKey("nonexistent")).toThrow("not registered");
    });
  });
});

// ── ModelRegistry ───────────────────────────────────────────────

describe("ModelRegistry", () => {
  it("registers and retrieves a model", () => {
    const reg = new ModelRegistry();
    reg.register(gpt4Cap);
    expect(reg.get("gpt-4o")).toEqual(gpt4Cap);
  });

  it("returns undefined for unknown model", () => {
    const reg = new ModelRegistry();
    expect(reg.get("nonexistent")).toBeUndefined();
  });

  it("lists all registered models", () => {
    const reg = new ModelRegistry();
    reg.register(gpt4Cap);
    reg.register(claudeCap);
    expect(reg.list()).toHaveLength(2);
  });

  it("overwrites on re-register", () => {
    const reg = new ModelRegistry();
    reg.register(gpt4Cap);
    const updated = { ...gpt4Cap, contextWindow: 256_000 };
    reg.register(updated);
    expect(reg.get("gpt-4o")?.contextWindow).toBe(256_000);
    expect(reg.list()).toHaveLength(1);
  });

  it("throws on empty modelId", () => {
    const reg = new ModelRegistry();
    expect(() => reg.register({ ...gpt4Cap, modelId: "" })).toThrow("non-empty modelId");
  });

  describe("checkCapability", () => {
    it("returns true for supported capabilities", () => {
      const reg = new ModelRegistry();
      reg.register(gpt4Cap);
      expect(reg.checkCapability("gpt-4o", "stream")).toBe(true);
      expect(reg.checkCapability("gpt-4o", "tools")).toBe(true);
      expect(reg.checkCapability("gpt-4o", "vision")).toBe(true);
      expect(reg.checkCapability("gpt-4o", "json-schema")).toBe(true);
    });

    it("returns false for unsupported capabilities", () => {
      const reg = new ModelRegistry();
      reg.register(textOnlyCap);
      expect(reg.checkCapability("text-only", "stream")).toBe(false);
      expect(reg.checkCapability("text-only", "tools")).toBe(false);
      expect(reg.checkCapability("text-only", "vision")).toBe(false);
      expect(reg.checkCapability("text-only", "json-schema")).toBe(false);
    });

    it("returns false for unknown model", () => {
      const reg = new ModelRegistry();
      expect(reg.checkCapability("nonexistent", "stream")).toBe(false);
    });
  });
});

// ── Loader ──────────────────────────────────────────────────────

describe("loadRegistryFromConfig", () => {
  it("loads providers and models from config", () => {
    const { providers, models } = loadRegistryFromConfig({
      providers: [openaiProfile, anthropicProfile],
      models: [gpt4Cap, claudeCap],
    });

    expect(providers.list()).toHaveLength(2);
    expect(models.list()).toHaveLength(2);
    expect(providers.get("openai")).toEqual(openaiProfile);
    expect(models.get("gpt-4o")).toEqual(gpt4Cap);
  });

  it("handles empty config", () => {
    const { providers, models } = loadRegistryFromConfig({
      providers: [],
      models: [],
    });
    expect(providers.list()).toHaveLength(0);
    expect(models.list()).toHaveLength(0);
  });
});

describe("loadRegistryFromEnv", () => {
  it("loads providers from environment variables", () => {
    const env = {
      LLM_PROVIDER_OPENAI_BASE_URL: "https://api.openai.com/v1",
      LLM_PROVIDER_OPENAI_API_KEYS: "sk-1,sk-2",
      LLM_PROVIDER_OPENAI_ROTATION: "round-robin",
    };

    const { providers } = loadRegistryFromEnv(env);
    expect(providers.list()).toHaveLength(1);

    const p = providers.get("openai");
    expect(p).toBeDefined();
    expect(p!.baseUrl).toBe("https://api.openai.com/v1");
    expect(p!.apiKeys).toEqual(["sk-1", "sk-2"]);
    expect(p!.keyRotationPolicy).toBe("round-robin");
  });

  it("skips providers missing base URL or keys", () => {
    const env = {
      LLM_PROVIDER_OPENAI_BASE_URL: "https://api.openai.com/v1",
      // Missing API keys
      LLM_PROVIDER_ANTHROPIC_API_KEYS: "ant-key",
      // Missing base URL
    };

    const { providers } = loadRegistryFromEnv(env);
    expect(providers.list()).toHaveLength(0);
  });

  it("handles empty env", () => {
    const { providers, models } = loadRegistryFromEnv({});
    expect(providers.list()).toHaveLength(0);
    expect(models.list()).toHaveLength(0);
  });

  it("trims whitespace from comma-separated keys", () => {
    const env = {
      LLM_PROVIDER_TEST_BASE_URL: "https://test.com",
      LLM_PROVIDER_TEST_API_KEYS: " key1 , key2 , key3 ",
    };

    const { providers } = loadRegistryFromEnv(env);
    const p = providers.get("test");
    expect(p!.apiKeys).toEqual(["key1", "key2", "key3"]);
  });
});
