import { describe, expect, it } from "vitest";
import { handlePublicRequest } from "../src/public-surface.js";
import { NANO_PACKAGE_MANIFEST } from "../src/generated/package-manifest.js";

describe("orchestrator-auth public surface", () => {
  it("exposes only probe routes publicly", async () => {
    const probe = await handlePublicRequest(new Request("https://example.com/"), {
      NANO_AGENT_DB: {} as D1Database,
      WORKER_VERSION: "orchestrator-auth@test",
    }).json();
    expect(probe.worker).toBe("orchestrator-auth");
    expect(probe.worker_version).toBe("orchestrator-auth@test");
    expect(probe.public_business_routes).toBe(false);

    expect(NANO_PACKAGE_MANIFEST.worker).toBe("orchestrator-auth");
    expect(NANO_PACKAGE_MANIFEST.packages).toHaveLength(3);

    // ZX2 Phase 1 P1-03: binding-scope guard.
    // public-surface now returns 401 binding-scope-forbidden (was 404 not-found)
    // so monitors / clients see the same code as the other non-facade workers.
    const forbiddenResponse = handlePublicRequest(
      new Request("https://example.com/auth/login", { method: "POST" }),
      {},
    );
    expect(forbiddenResponse.status).toBe(401);
    const forbidden = await forbiddenResponse.json();
    expect(forbidden.ok).toBe(false);
    expect(forbidden.error.code).toBe("binding-scope-forbidden");
    expect(forbidden.error.status).toBe(401);
    expect(forbidden.error.details.worker).toBe("orchestrator-auth");
  });
});
