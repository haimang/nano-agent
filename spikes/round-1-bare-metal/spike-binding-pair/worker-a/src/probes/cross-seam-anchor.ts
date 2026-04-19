/**
 * V3-binding-cross-seam-anchor probe.
 *
 * Validation goal (per P0-spike-binding-pair-design §4.2):
 *   - 5 `x-nacp-*` headers survive service-binding hop
 *   - case-normalization behavior
 *   - value size limits (128 / 1024 / 8192 chars)
 *   - fallback path when headers absent
 */

import { makeResult, type BindingProbeResult } from "../result-shape.js";

const ANCHOR_HEADERS = {
  "x-nacp-trace-uuid": "11111111-1111-4111-8111-111111111111",
  "x-nacp-session-uuid": "22222222-2222-4222-8222-222222222222",
  "x-nacp-team-uuid": "33333333-3333-4333-8333-333333333333",
  "x-nacp-request-uuid": "44444444-4444-4444-8444-444444444444",
  "x-nacp-source-uuid": "55555555-5555-4555-8555-555555555555",
  "x-nacp-source-role": "spike-test-caller",
};

export async function probeCrossSeamAnchor(
  workerB: Fetcher,
  _params: Record<string, unknown>,
): Promise<BindingProbeResult> {
  const start = Date.now();
  const observations: BindingProbeResult["observations"] = [];
  const errors: BindingProbeResult["errors"] = [];

  // (1) Baseline: send all 6 anchor headers, dump back.
  try {
    const headers = new Headers();
    for (const [k, v] of Object.entries(ANCHOR_HEADERS)) headers.set(k, v);
    const res = await workerB.fetch(
      new Request("https://worker-b.spike/handle/header-dump", {
        method: "POST",
        body: "{}",
        headers,
      }),
    );
    const body = (await res.json()) as { receivedHeaders: Record<string, string> };
    const received = body.receivedHeaders;
    const survived: Record<string, "ok" | "missing" | "mismatch"> = {};
    for (const [k, v] of Object.entries(ANCHOR_HEADERS)) {
      const got = received[k] ?? received[k.toLowerCase()];
      if (got === undefined) survived[k] = "missing";
      else if (got !== v) survived[k] = "mismatch";
      else survived[k] = "ok";
    }
    observations.push({
      label: "anchor_baseline",
      value: {
        survived,
        receivedHeaderCount: Object.keys(received).length,
        receivedHeaderNames: Object.keys(received).sort(),
      },
    });
  } catch (err) {
    errors.push({
      code: "AnchorBaselineFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  // (2) Case sensitivity probe: send mixed-case anchor, see normalized form.
  try {
    const headers = new Headers();
    headers.set("X-Nacp-Trace-Uuid", "MIXED-CASE-VALUE-AAAA");
    const res = await workerB.fetch(
      new Request("https://worker-b.spike/handle/header-dump", {
        method: "POST",
        body: "{}",
        headers,
      }),
    );
    const body = (await res.json()) as { receivedHeaders: Record<string, string> };
    observations.push({
      label: "anchor_case_normalization",
      value: {
        sentName: "X-Nacp-Trace-Uuid",
        sentValue: "MIXED-CASE-VALUE-AAAA",
        receivedAsLower: body.receivedHeaders["x-nacp-trace-uuid"] ?? null,
        receivedAsMixed: body.receivedHeaders["X-Nacp-Trace-Uuid"] ?? null,
      },
    });
  } catch (err) {
    errors.push({
      code: "AnchorCaseProbeFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  // (3) Value size probe: 128 / 1024 / 8192 char values.
  for (const sz of [128, 1024, 8192]) {
    try {
      const headers = new Headers();
      const value = "a".repeat(sz);
      headers.set("x-nacp-trace-uuid", value);
      const res = await workerB.fetch(
        new Request("https://worker-b.spike/handle/header-dump", {
          method: "POST",
          body: "{}",
          headers,
        }),
      );
      const body = (await res.json()) as { receivedHeaders: Record<string, string> };
      const got = body.receivedHeaders["x-nacp-trace-uuid"];
      observations.push({
        label: `anchor_value_size_${sz}`,
        value: {
          sentBytes: sz,
          receivedBytes: got ? got.length : 0,
          truncated: got ? got.length < sz : null,
          rejected: got === undefined,
        },
      });
    } catch (err) {
      observations.push({
        label: `anchor_value_size_${sz}`,
        value: { error: String((err as Error)?.message ?? err) },
      });
    }
  }

  // (4) Absence: no anchor headers — verify worker-b just returns whatever it got.
  try {
    const res = await workerB.fetch(
      new Request("https://worker-b.spike/handle/header-dump", {
        method: "POST",
        body: "{}",
      }),
    );
    const body = (await res.json()) as { receivedHeaders: Record<string, string> };
    const anchorPresent = Object.keys(body.receivedHeaders).filter((h) =>
      h.startsWith("x-nacp-"),
    );
    observations.push({
      label: "anchor_absent_path",
      value: {
        anchorHeadersUnexpectedlyPresent: anchorPresent,
        // If non-empty, something in the binding/runtime is injecting anchors.
      },
    });
  } catch (err) {
    errors.push({
      code: "AnchorAbsentProbeFailed",
      message: String((err as Error)?.message ?? err),
      count: 1,
    });
  }

  return makeResult("V3-binding-cross-seam-anchor", start, {
    success: errors.length === 0,
    observations,
    errors,
    timings: { samplesN: 1 + 1 + 3 + 1 },
  });
}
