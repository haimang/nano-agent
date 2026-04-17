import { describe, it, expect } from "vitest";

import { InMemoryCapabilityRegistry } from "../src/registry.js";
import { registerMinimalCommands } from "../src/fake-bash/commands.js";

describe("registerMinimalCommands", () => {
  it("keeps mutating filesystem commands gated by default", () => {
    const registry = new InMemoryCapabilityRegistry();
    registerMinimalCommands(registry);

    expect(registry.get("write")?.policy).toBe("ask");
    expect(registry.get("mkdir")?.policy).toBe("ask");
    expect(registry.get("rm")?.policy).toBe("ask");
  });

  it("supports per-command policy overrides for non-interactive harnesses", () => {
    const registry = new InMemoryCapabilityRegistry();
    registerMinimalCommands(registry, {
      policyOverrides: {
        write: "allow",
        mkdir: "allow",
      },
    });

    expect(registry.get("write")?.policy).toBe("allow");
    expect(registry.get("mkdir")?.policy).toBe("allow");
    expect(registry.get("rm")?.policy).toBe("ask");
  });

  it("does not mutate the canonical defaults across registrations", () => {
    const relaxed = new InMemoryCapabilityRegistry();
    registerMinimalCommands(relaxed, {
      policyOverrides: { write: "allow" },
    });

    const fresh = new InMemoryCapabilityRegistry();
    registerMinimalCommands(fresh);

    expect(relaxed.get("write")?.policy).toBe("allow");
    expect(fresh.get("write")?.policy).toBe("ask");
  });
});
