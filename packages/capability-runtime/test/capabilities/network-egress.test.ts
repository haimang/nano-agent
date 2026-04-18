/**
 * A9 Phase 2 — restricted `curl` baseline + egress guard (Q17).
 *
 * Covers:
 *   1. no-fetchImpl → deterministic `curl-not-connected` stub
 *   2. scheme allow-list rejects `file://`, `ftp://`, `gopher://`, `data:`
 *   3. host deny-list rejects localhost / 127.0.0.0/8 / RFC1918 /
 *      link-local / 169.254.169.254 / CGNAT / IPv6 loopback / IPv6 ULA
 *   4. timeout cap aborts long-running fetches with `curl-timeout-exceeded`
 *   5. output cap truncates responses and emits `curl-output-truncated`
 *   6. structured `{ method, headers, body }` flows through to fetchImpl
 *      (proves the structured schema is the sanctioned richer-path)
 */

import { describe, it, expect } from "vitest";
import {
  createNetworkHandlers,
  CURL_NOT_CONNECTED_NOTE,
  CURL_SCHEME_BLOCKED_NOTE,
  CURL_PRIVATE_ADDRESS_BLOCKED_NOTE,
  CURL_TIMEOUT_NOTE,
  CURL_OUTPUT_TRUNCATED_NOTE,
} from "../../src/capabilities/network.js";

describe("curl — no fetchImpl (default stub)", () => {
  it("returns the deterministic not-connected marker", async () => {
    const handlers = createNetworkHandlers();
    const res = (await handlers.get("curl")!({
      url: "https://example.com",
    })) as { output: string };
    expect(res.output).toContain(CURL_NOT_CONNECTED_NOTE);
    expect(res.output).toContain("https://example.com");
    expect(res.output).toContain("GET");
  });
});

describe("curl — scheme allow-list (http/https only)", () => {
  const handlers = createNetworkHandlers();
  const blocked = ["file:///etc/passwd", "ftp://example.com", "gopher://x/", "data:text/plain,hi"];
  for (const url of blocked) {
    it(`rejects ${url}`, async () => {
      await expect(handlers.get("curl")!({ url })).rejects.toThrow(
        new RegExp(CURL_SCHEME_BLOCKED_NOTE),
      );
    });
  }
});

describe("curl — host deny-list (localhost / private / link-local / metadata / ULA)", () => {
  const handlers = createNetworkHandlers();
  const blockedHosts = [
    "http://localhost/",
    "http://127.0.0.1/",
    "http://127.7.7.7/",
    "http://0.0.0.0/",
    "http://10.0.0.5/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/", // AWS metadata
    "http://100.64.0.1/", // CGNAT
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fd12:3456::1]/",
    "http://[fe80::1]/",
  ];
  for (const url of blockedHosts) {
    it(`rejects ${url}`, async () => {
      await expect(handlers.get("curl")!({ url })).rejects.toThrow(
        new RegExp(CURL_PRIVATE_ADDRESS_BLOCKED_NOTE),
      );
    });
  }

  it("accepts a normal public hostname", async () => {
    const handlers2 = createNetworkHandlers();
    const res = (await handlers2.get("curl")!({ url: "https://example.com/" })) as {
      output: string;
    };
    expect(res.output).toContain("https://example.com/");
  });
});

describe("curl — fetchImpl injection path (structured schema)", () => {
  it("calls fetchImpl with method/headers/body from the structured input", async () => {
    const captured: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      captured.push({ url, init: init ?? {} });
      return new Response("hello world", {
        status: 200,
        statusText: "OK",
      });
    }) as typeof fetch;
    const handlers = createNetworkHandlers({ fetchImpl });
    const res = (await handlers.get("curl")!({
      url: "https://api.example.com/echo",
      method: "POST",
      headers: { "X-Test": "1" },
      body: "{\"a\":1}",
    })) as { output: string };

    expect(res.output).toContain("POST");
    expect(res.output).toContain("200 OK");
    expect(res.output).toContain("hello world");
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe("https://api.example.com/echo");
    expect(captured[0]!.init.method).toBe("POST");
    expect(captured[0]!.init.body).toBe("{\"a\":1}");
  });

  it("truncates response bodies over the output cap", async () => {
    const big = "a".repeat(200_000);
    const fetchImpl = (async () =>
      new Response(big, { status: 200, statusText: "OK" })) as typeof fetch;
    const handlers = createNetworkHandlers({ fetchImpl });
    const res = (await handlers.get("curl")!({
      url: "https://example.com/big",
    })) as { output: string };
    expect(res.output).toContain(CURL_OUTPUT_TRUNCATED_NOTE);
  });

  it("respects a caller-supplied smaller output cap", async () => {
    const fetchImpl = (async () =>
      new Response("0123456789", {
        status: 200,
        statusText: "OK",
      })) as typeof fetch;
    const handlers = createNetworkHandlers({ fetchImpl });
    const res = (await handlers.get("curl")!({
      url: "https://example.com/small",
      maxOutputBytes: 4,
    })) as { output: string };
    expect(res.output).toContain("0123");
    expect(res.output).not.toContain("456");
    expect(res.output).toContain(CURL_OUTPUT_TRUNCATED_NOTE);
  });

  it("aborts on timeout and emits the timeout marker", async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }
      });
    }) as typeof fetch;
    const handlers = createNetworkHandlers({ fetchImpl });
    await expect(
      handlers.get("curl")!({
        url: "https://example.com/hang",
        timeoutMs: 10,
      }),
    ).rejects.toThrow(new RegExp(CURL_TIMEOUT_NOTE));
  });
});
