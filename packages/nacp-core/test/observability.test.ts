import { describe, it, expect } from "vitest";
import {
  NacpAlertPayloadSchema,
  NacpObservabilityEnvelopeSchema,
} from "../src/observability/envelope.js";

const TEAM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UUID = "11111111-1111-4111-8111-111111111111";
const SENT = "2026-04-18T10:00:00.000+00:00";

function makeAlert(overrides: Record<string, unknown> = {}) {
  return {
    alert_uuid: UUID,
    team_uuid: TEAM,
    severity: "warning",
    category: "queue.backpressure",
    message: "queue latency degraded",
    emitted_at: SENT,
    ...overrides,
  };
}

describe("NacpAlertPayloadSchema — A3 Phase 1 trace law exception", () => {
  it("accepts a platform-scoped alert without trace_uuid", () => {
    const r = NacpAlertPayloadSchema.safeParse(
      makeAlert({ scope: "platform" }),
    );
    expect(r.success).toBe(true);
  });

  it("defaults scope to platform and allows missing trace_uuid", () => {
    const r = NacpAlertPayloadSchema.safeParse(makeAlert());
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.scope).toBe("platform");
  });

  it("rejects a request-scoped alert without trace_uuid", () => {
    const r = NacpAlertPayloadSchema.safeParse(
      makeAlert({ scope: "request" }),
    );
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path).toEqual(["trace_uuid"]);
    }
  });

  it("rejects a session-scoped alert without trace_uuid", () => {
    const r = NacpAlertPayloadSchema.safeParse(
      makeAlert({ scope: "session" }),
    );
    expect(r.success).toBe(false);
  });

  it("rejects a turn-scoped alert without trace_uuid", () => {
    const r = NacpAlertPayloadSchema.safeParse(makeAlert({ scope: "turn" }));
    expect(r.success).toBe(false);
  });

  it("accepts a request-scoped alert when trace_uuid is provided", () => {
    const r = NacpAlertPayloadSchema.safeParse(
      makeAlert({ scope: "request", trace_uuid: UUID }),
    );
    expect(r.success).toBe(true);
  });
});

describe("NacpObservabilityEnvelopeSchema", () => {
  it("accepts an envelope with a mix of platform and request alerts", () => {
    const r = NacpObservabilityEnvelopeSchema.safeParse({
      source_worker: "nano-agent-session",
      source_role: "session",
      alerts: [
        makeAlert({ scope: "platform" }),
        makeAlert({ scope: "request", trace_uuid: UUID }),
      ],
      metrics: { "queue.lag_ms": 42 },
      traces: {},
    });
    expect(r.success).toBe(true);
  });
});
