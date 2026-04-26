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

  it("executes a live capability call for pwd", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/capability/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: "smoke-call-1",
          capabilityName: "pwd",
          body: {
            tool_name: "pwd",
            tool_input: {},
          },
        }),
      }),
      { ENVIRONMENT: "preview" },
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
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: "smoke-cancel-1",
          capabilityName: "__px_sleep",
          body: {
            tool_name: "__px_sleep",
            tool_input: { ms: 100 },
          },
        }),
      }),
      { ENVIRONMENT: "preview" },
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    const cancelResponse = await worker.fetch(
      new Request("https://example.com/capability/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: "smoke-cancel-1",
          body: { reason: "smoke cancel" },
        }),
      }),
      { ENVIRONMENT: "preview" },
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
