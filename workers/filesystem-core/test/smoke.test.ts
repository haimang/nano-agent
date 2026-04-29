import { describe, expect, it } from "vitest";
import { fetchWorker as worker } from "../src/index.js";
import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";

describe("filesystem-core shell smoke", () => {
  it("exports a fetch handler", () => {
    expect(typeof worker.fetch).toBe("function");
  });

  it("returns the shell worker identity", async () => {
    const response = await worker.fetch(new Request("https://example.com"), {
      WORKER_VERSION: "filesystem-core@test",
    });
    const body = await response.json();

    expect(body.worker).toBe("filesystem-core");
    expect(body.status).toBe("ok");
    expect(body.worker_version).toBe("filesystem-core@test");
    expect(body.phase).toBe("worker-matrix-P4-absorbed");
    expect(body.absorbed_runtime).toBe(true);
  });

  it("returns NACP versions from the shell response", async () => {
    const response = await worker.fetch(new Request("https://example.com/health"), {
      WORKER_VERSION: "filesystem-core@test",
    });
    const body = await response.json();

    expect(body.nacp_core_version).toBe(NACP_VERSION);
    expect(body.nacp_session_version).toBe(NACP_SESSION_VERSION);
    expect(body.worker_version).toBe("filesystem-core@test");
  });

  // ZX2 Phase 1 P1-03: binding-scope guard. Non-/health paths now return
  // 401 binding-scope-forbidden so accidental workers.dev exposure is
  // defended at code level even before wrangler workers_dev:false takes
  // effect.
  it("returns 401 binding-scope-forbidden for non-probe routes (ZX2)", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/runtime", { method: "POST" }),
      {},
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("binding-scope-forbidden");
    expect(body.worker).toBe("filesystem-core");
  });
});
