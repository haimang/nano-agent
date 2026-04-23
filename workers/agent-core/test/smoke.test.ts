import { describe, expect, it } from "vitest";
import worker, { NanoSessionDO } from "../src/index.js";
import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";

describe("agent-core shell smoke", () => {
  it("exports a fetch handler", () => {
    expect(typeof worker.fetch).toBe("function");
  });

  it("exports the NanoSessionDO stub", () => {
    expect(typeof NanoSessionDO).toBe("function");
  });

  it("returns NACP versions + absorbed-runtime flag from the worker shell", async () => {
    const response = await worker.fetch(new Request("https://example.com"), {
      SESSION_DO: {} as DurableObjectNamespace,
    });
    const body = await response.json();

    expect(body.worker).toBe("agent-core");
    expect(body.nacp_core_version).toBe(NACP_VERSION);
    expect(body.nacp_session_version).toBe(NACP_SESSION_VERSION);
    expect(body.status).toBe("ok");
    expect(body.absorbed_runtime).toBe(true);
    expect(body.phase).toBe("worker-matrix-P1.A-absorbed");
  });
});
