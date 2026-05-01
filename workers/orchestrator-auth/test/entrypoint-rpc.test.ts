import { describe, expect, it } from "vitest";
import OrchestratorAuthEntrypoint from "../src/index.js";

const META = {
  trace_uuid: "11111111-1111-4111-8111-111111111111",
  caller: "orchestrator-core" as const,
};

function makeEntrypoint(env: Record<string, unknown> = {}) {
  return new OrchestratorAuthEntrypoint(env as never);
}

describe("orchestrator-auth entrypoint adapter", () => {
  it("fetch preserves the public-surface binding-scope guard", async () => {
    const ep = makeEntrypoint({
      WORKER_VERSION: "orchestrator-auth@test",
    });

    const response = await ep.fetch(
      new Request("https://example.com/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com", password: "password-123" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("binding-scope-forbidden");
    expect(body.error.details.worker).toBe("orchestrator-auth");
  });

  it("wraps known misconfiguration errors into auth envelopes", async () => {
    const ep = makeEntrypoint();

    const envelope = await ep.register(
      {
        email: "user@example.com",
        password: "password-123",
        display_name: "User",
      },
      META,
    );

    expect(envelope.ok).toBe(false);
    if (envelope.ok) return;
    expect(envelope.error.code).toBe("worker-misconfigured");
    expect(envelope.error.status).toBe(503);
  });

  it("wraps unexpected repository errors instead of throwing raw exceptions", async () => {
    const ep = makeEntrypoint({
      NANO_AGENT_DB: {} as D1Database,
      PASSWORD_SALT: "salt",
      JWT_SIGNING_KID: "v1",
      JWT_SIGNING_KEY_v1: "x".repeat(32),
    });

    const envelope = await ep.login(
      {
        email: "user@example.com",
        password: "password-123",
      },
      META,
    );

    expect(envelope.ok).toBe(false);
    if (envelope.ok) return;
    expect(envelope.error.code).toBe("worker-misconfigured");
    expect(envelope.error.status).toBe(503);
    expect(typeof envelope.error.message).toBe("string");
  });
});
