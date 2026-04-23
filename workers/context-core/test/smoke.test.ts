import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";

describe("context-core shell smoke", () => {
  it("exports a fetch handler", () => {
    expect(typeof worker.fetch).toBe("function");
  });

  it("returns the shell worker identity", async () => {
    const response = await worker.fetch(new Request("https://example.com"), {});
    const body = await response.json();

    expect(body.worker).toBe("context-core");
    expect(body.status).toBe("ok");
    expect(body.phase).toBe("worker-matrix-P3-absorbed");
    expect(body.absorbed_runtime).toBe(true);
    expect(body.library_worker).toBe(true);
  });

  it("returns NACP versions from the shell response", async () => {
    const response = await worker.fetch(new Request("https://example.com/health"), {});
    const body = await response.json();

    expect(body.nacp_core_version).toBe(NACP_VERSION);
    expect(body.nacp_session_version).toBe(NACP_SESSION_VERSION);
  });

  it("returns 404 for non-probe routes", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/runtime", { method: "POST" }),
      {},
    );

    expect(response.status).toBe(404);
  });
});
