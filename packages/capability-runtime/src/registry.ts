/**
 * Capability Registry Interface & In-Memory Implementation
 *
 * Defines the contract for capability registration and lookup,
 * plus the concrete in-memory implementation.
 */

import type { CapabilityDeclaration } from "./types.js";

/** Registry for discovering and managing capability declarations. */
export interface CapabilityRegistry {
  /** Register a new capability. */
  register(decl: CapabilityDeclaration): void;

  /** Retrieve a capability by name, or undefined if not registered. */
  get(name: string): CapabilityDeclaration | undefined;

  /** List all registered capabilities. */
  list(): CapabilityDeclaration[];

  /** Check whether a capability with the given name is registered. */
  has(name: string): boolean;

  /** Remove a capability by name. Returns true if it existed. */
  remove(name: string): boolean;
}

/**
 * Simple in-memory implementation of CapabilityRegistry.
 *
 * Stores declarations in a Map keyed by capability name.
 * Not thread-safe — intended for single-agent use.
 */
export class InMemoryCapabilityRegistry implements CapabilityRegistry {
  private readonly capabilities = new Map<string, CapabilityDeclaration>();

  register(decl: CapabilityDeclaration): void {
    if (this.capabilities.has(decl.name)) {
      throw new Error(`Capability "${decl.name}" is already registered`);
    }
    this.capabilities.set(decl.name, decl);
  }

  get(name: string): CapabilityDeclaration | undefined {
    return this.capabilities.get(name);
  }

  list(): CapabilityDeclaration[] {
    return Array.from(this.capabilities.values());
  }

  has(name: string): boolean {
    return this.capabilities.has(name);
  }

  remove(name: string): boolean {
    return this.capabilities.delete(name);
  }
}
