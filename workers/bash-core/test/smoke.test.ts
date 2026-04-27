import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";

describe("bash-core shell smoke", () => {
  it("exports a fetch handler", () => {
    expect(typeof worker.fetch).toBe("function");
  });

  it("returns the shell worker identity", async () => {
    const response = await worker.fetch(new Request("https://example.com"), {
      WORKER_VERSION: "bash-core@test",
    });
    const body = await response.json();

    expect(body.worker).toBe("bash-core");
    expect(body.status).toBe("ok");
    expect(body.worker_version).toBe("bash-core@test");
  });

  it("returns NACP versions from the shell response", async () => {
    const response = await worker.fetch(new Request("https://example.com/health"), {});
    const body = await response.json();

    expect(body.nacp_core_version).toBe(NACP_VERSION);
    expect(body.nacp_session_version).toBe(NACP_SESSION_VERSION);
  });

  // ZX2 Phase 1 P1-03 (binding-scope guard): /capability/* requires the
  // `x-nano-internal-binding-secret` header now. The smoke env supplies a
  // matching secret; ZX2 Phase 3 P3-03 will additionally require a NACP
  // authority header on this path.
  const SMOKE_SECRET = "smoke-secret";
  const smokeEnv = {
    ENVIRONMENT: "preview" as const,
    NANO_INTERNAL_BINDING_SECRET: SMOKE_SECRET,
  };
  const internalHeaders = {
    "content-type": "application/json",
    "x-nano-internal-binding-secret": SMOKE_SECRET,
  };

  it("rejects /capability/* without the binding-secret header (ZX2 Phase 1)", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/capability/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: "smoke-rejected-1",
          capabilityName: "pwd",
          body: { tool_name: "pwd", tool_input: {} },
        }),
      }),
      smokeEnv,
    );
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("binding-scope-forbidden");
  });

  it("executes a live capability call for pwd", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/capability/call", {
        method: "POST",
        headers: internalHeaders,
        body: JSON.stringify({
          requestId: "smoke-call-1",
          capabilityName: "pwd",
          body: {
            tool_name: "pwd",
            tool_input: {},
          },
        }),
      }),
      smokeEnv,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(typeof body.output).toBe("string");
  });

  it("cancels a preview-only delayed capability call", async () => {
    const callPromise = worker.fetch(
      new Request("https://example.com/capability/call", {
        method: "POST",
        headers: internalHeaders,
        body: JSON.stringify({
          requestId: "smoke-cancel-1",
          capabilityName: "__px_sleep",
          body: {
            tool_name: "__px_sleep",
            tool_input: { ms: 100 },
          },
        }),
      }),
      smokeEnv,
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    const cancelResponse = await worker.fetch(
      new Request("https://example.com/capability/cancel", {
        method: "POST",
        headers: internalHeaders,
        body: JSON.stringify({
          requestId: "smoke-cancel-1",
          body: { reason: "smoke cancel" },
        }),
      }),
      smokeEnv,
    );
    const cancelBody = await cancelResponse.json();
    const callResponse = await callPromise;
    const callBody = await callResponse.json();

    expect(cancelResponse.status).toBe(200);
    expect(cancelBody.cancelled).toBe(true);
    expect(callResponse.status).toBe(200);
    expect(callBody.status).toBe("error");
    expect(callBody.error.code).toBe("cancelled");
  });
});
