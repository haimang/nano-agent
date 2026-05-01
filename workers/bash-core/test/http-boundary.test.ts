import { describe, expect, it } from "vitest";
import BashCoreEntrypoint from "../src/index.js";

const INTERNAL_SECRET = "hpx1-bash-secret";

function makeEntrypoint() {
  return new BashCoreEntrypoint({
    ENVIRONMENT: "preview",
    NANO_INTERNAL_BINDING_SECRET: INTERNAL_SECRET,
  } as never);
}

async function postJson(
  ep: BashCoreEntrypoint,
  pathname: string,
  body: string,
  headers: Record<string, string> = {},
) {
  const response = await ep.fetch(
    new Request(`https://example.com${pathname}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nano-internal-binding-secret": INTERNAL_SECRET,
        ...headers,
      },
      body,
    }),
  );
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { response, text, json };
}

describe("bash-core HTTP boundary", () => {
  it.each([
    ["pwd", {}],
    ["ls", {}],
  ] as const)("returns canonical ok envelope for %s", async (toolName, toolInput) => {
    const ep = makeEntrypoint();
    const { response, json } = await postJson(
      ep,
      "/capability/call",
      JSON.stringify({
        requestId: `hpx1-${toolName}`,
        capabilityName: toolName,
        body: { tool_name: toolName, tool_input: toolInput },
      }),
    );

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ status: "ok" });
    expect(typeof (json as { output?: unknown }).output).toBe("string");
  });

  it.each([
    ["unknown-tool", "echo", {}],
    ["policy-ask", "curl", {}],
    ["handler-error", "cat", {}],
  ] as const)(
    'returns canonical "%s" error envelope for %s',
    async (code, toolName, toolInput) => {
      const ep = makeEntrypoint();
      const { response, json } = await postJson(
        ep,
        "/capability/call",
        JSON.stringify({
          requestId: `hpx1-${code}`,
          capabilityName: toolName,
          body: { tool_name: toolName, tool_input: toolInput },
        }),
      );

      expect(response.status).toBe(200);
      expect(json).toMatchObject({
        status: "error",
        error: { code },
      });
      expect(typeof (json as { error?: { message?: unknown } }).error?.message).toBe("string");
    },
  );

  it("rejects malformed JSON with a facade error envelope", async () => {
    const ep = makeEntrypoint();
    const { response, json } = await postJson(ep, "/capability/call", "not-json");

    expect(response.status).toBe(400);
    expect(json).toMatchObject({
      ok: false,
      error: {
        code: "invalid-json",
        status: 400,
        details: {
          worker: "bash-core",
          phase: "worker-matrix-P1.B-absorbed",
        },
      },
    });
  });

  it("rejects missing tool_name with invalid-request-shape", async () => {
    const ep = makeEntrypoint();
    const { response, json } = await postJson(
      ep,
      "/capability/call",
      JSON.stringify({ requestId: "missing-tool-name", body: {} }),
    );

    expect(response.status).toBe(400);
    expect(json).toMatchObject({
      ok: false,
      error: {
        code: "invalid-request-shape",
        status: 400,
        details: {
          worker: "bash-core",
          phase: "worker-matrix-P1.B-absorbed",
          pathname: "/capability/call",
        },
      },
    });
    expect((json as { error?: { message?: string } }).error?.message).toContain("tool_name");
  });

  it("rejects empty body with invalid-request-shape", async () => {
    const ep = makeEntrypoint();
    const { response, json } = await postJson(ep, "/capability/call", JSON.stringify({}));

    expect(response.status).toBe(400);
    expect(json).toMatchObject({
      ok: false,
      error: {
        code: "invalid-request-shape",
        status: 400,
      },
    });
  });
});
