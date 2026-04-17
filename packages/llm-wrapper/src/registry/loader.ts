/**
 * Registry Configuration Loader
 *
 * Hydrates ProviderRegistry and ModelRegistry from a static config object
 * or from environment variables (useful for CI / container deployments).
 */

import type { ProviderProfile } from "./providers.js";
import type { ModelCapabilities } from "./models.js";
import { ProviderRegistry } from "./providers.js";
import { ModelRegistry } from "./models.js";

export interface RegistryConfig {
  providers: ProviderProfile[];
  models: ModelCapabilities[];
}

/**
 * Build registries from an explicit config object.
 */
export function loadRegistryFromConfig(config: RegistryConfig): {
  providers: ProviderRegistry;
  models: ModelRegistry;
} {
  const providers = new ProviderRegistry();
  const models = new ModelRegistry();

  for (const p of config.providers) {
    providers.register(p);
  }
  for (const m of config.models) {
    models.register(m);
  }

  return { providers, models };
}

/**
 * Build registries from environment variables.
 *
 * Convention:
 *   LLM_PROVIDER_<NAME>_BASE_URL   — provider base URL
 *   LLM_PROVIDER_<NAME>_API_KEYS   — comma-separated API keys
 *   LLM_PROVIDER_<NAME>_ROTATION   — "round-robin" | "on-429"  (optional)
 *
 * Models are not loaded from env (they are typically static config),
 * so the returned ModelRegistry is empty.
 */
export function loadRegistryFromEnv(env: Record<string, string | undefined>): {
  providers: ProviderRegistry;
  models: ModelRegistry;
} {
  const providers = new ProviderRegistry();
  const models = new ModelRegistry();

  const providerPrefix = "LLM_PROVIDER_";
  const seen = new Set<string>();

  for (const key of Object.keys(env)) {
    if (!key.startsWith(providerPrefix)) continue;
    const rest = key.slice(providerPrefix.length);
    const underscoreIdx = rest.indexOf("_");
    if (underscoreIdx === -1) continue;
    const name = rest.slice(0, underscoreIdx).toLowerCase();
    seen.add(name);
  }

  for (const name of seen) {
    const upper = name.toUpperCase();
    const baseUrl = env[`${providerPrefix}${upper}_BASE_URL`];
    const apiKeysRaw = env[`${providerPrefix}${upper}_API_KEYS`];
    const rotation = env[`${providerPrefix}${upper}_ROTATION`] as
      | "round-robin"
      | "on-429"
      | undefined;

    if (!baseUrl || !apiKeysRaw) continue;

    const apiKeys = apiKeysRaw.split(",").map((k) => k.trim()).filter(Boolean);
    if (apiKeys.length === 0) continue;

    providers.register({
      name,
      baseUrl,
      apiKeys,
      keyRotationPolicy: rotation,
    });
  }

  return { providers, models };
}
