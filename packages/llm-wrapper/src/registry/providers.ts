/**
 * Provider Registry
 *
 * Manages LLM provider profiles with multi-key rotation support.
 * Providers register once; callers retrieve profiles and rotate API
 * keys via round-robin or on-429 policies.
 *
 * Rotation rules:
 *   - `round-robin` (default): every `getNextApiKey()` advances the
 *     key cursor by 1, spreading load evenly across keys.
 *   - `on-429`: `getNextApiKey()` returns the current key without
 *     advancing. Callers MUST call `rotateApiKey()` after a 429 to
 *     move the cursor, so all subsequent requests on the same
 *     provider use the next key.
 */

export interface ProviderProfile {
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKeys: string[];
  readonly keyRotationPolicy?: "round-robin" | "on-429";
  readonly defaultHeaders?: Record<string, string>;
  readonly retryConfig?: { maxRetries: number; baseDelayMs: number };
  readonly notes?: string;
}

export class ProviderRegistry {
  private readonly profiles = new Map<string, ProviderProfile>();
  private readonly keyIndices = new Map<string, number>();

  /** Register a provider profile. Overwrites any existing profile with the same name. */
  register(profile: ProviderProfile): void {
    if (!profile.name) {
      throw new Error("Provider profile must have a non-empty name");
    }
    if (!profile.apiKeys.length) {
      throw new Error(`Provider "${profile.name}" must have at least one API key`);
    }
    this.profiles.set(profile.name, profile);
    if (!this.keyIndices.has(profile.name)) {
      this.keyIndices.set(profile.name, 0);
    }
  }

  /** Retrieve a provider profile by name. */
  get(name: string): ProviderProfile | undefined {
    return this.profiles.get(name);
  }

  /** List all registered provider profiles. */
  list(): ProviderProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Get the next API key for the named provider.
   *
   * - `round-robin` (default or explicit): advance the cursor every call.
   * - `on-429`: return the current key WITHOUT advancing — callers call
   *   `rotateApiKey()` explicitly after a 429 to move to the next key.
   *
   * Throws if the provider is not registered.
   */
  getNextApiKey(name: string): string {
    const profile = this.profiles.get(name);
    if (!profile) {
      throw new Error(`Provider "${name}" is not registered`);
    }
    const idx = this.keyIndices.get(name) ?? 0;
    const key = profile.apiKeys[idx % profile.apiKeys.length]!;

    const policy = profile.keyRotationPolicy ?? "round-robin";
    if (policy === "round-robin") {
      this.keyIndices.set(name, (idx + 1) % profile.apiKeys.length);
    }
    // `on-429`: do not advance automatically.
    return key;
  }

  /**
   * Explicitly advance the key cursor for a provider. Intended for use by
   * `LLMExecutor` when a 429 is observed and `keyRotationPolicy === "on-429"`.
   *
   * Returns the NEW current key (the one that will be served by the next
   * `getNextApiKey()` call).
   */
  rotateApiKey(name: string): string {
    const profile = this.profiles.get(name);
    if (!profile) {
      throw new Error(`Provider "${name}" is not registered`);
    }
    const idx = this.keyIndices.get(name) ?? 0;
    const next = (idx + 1) % profile.apiKeys.length;
    this.keyIndices.set(name, next);
    return profile.apiKeys[next]!;
  }

  /**
   * Current (unconsumed) API key for a provider — useful for tests or
   * for constructing a request with the already-selected key.
   */
  currentApiKey(name: string): string {
    const profile = this.profiles.get(name);
    if (!profile) {
      throw new Error(`Provider "${name}" is not registered`);
    }
    const idx = this.keyIndices.get(name) ?? 0;
    return profile.apiKeys[idx % profile.apiKeys.length]!;
  }
}
