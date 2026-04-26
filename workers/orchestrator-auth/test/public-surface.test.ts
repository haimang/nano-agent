import { describe, expect, it } from "vitest";
import { handlePublicRequest } from "../src/public-surface.js";

describe("orchestrator-auth public surface", () => {
  it("exposes only probe routes publicly", async () => {
    const probe = await handlePublicRequest(new Request("https://example.com/"), {
      NANO_AGENT_DB: {} as D1Database,
      WORKER_VERSION: "orchestrator-auth@test",
    }).json();
    expect(probe.worker).toBe("orchestrator-auth");
    expect(probe.worker_version).toBe("orchestrator-auth@test");
    expect(probe.public_business_routes).toBe(false);

    const forbidden = await handlePublicRequest(
      new Request("https://example.com/auth/login", { method: "POST" }),
      {},
    ).json();
    expect(forbidden.error).toBe("not-found");
  });
});
