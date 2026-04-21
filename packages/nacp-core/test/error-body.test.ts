import { describe, it, expect } from "vitest";
import {
  NacpErrorBodySchema,
  wrapAsError,
  type NacpErrorBody,
} from "../src/error-body.js";
import type { NacpEnvelope } from "../src/types.js";
import { NACP_VERSION } from "../src/version.js";

const VALID_UUID = "11111111-1111-1111-1111-111111111111";
const NEW_UUID = "22222222-2222-2222-2222-222222222222";
const VALID_SENT_AT = "2026-04-21T00:00:00.000+00:00";
const NEW_SENT_AT = "2026-04-21T00:00:01.000+00:00";
const TEAM_UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function makeSourceEnvelope(): NacpEnvelope {
  return {
    header: {
      schema_version: NACP_VERSION,
      message_uuid: VALID_UUID,
      message_type: "tool.call.request",
      delivery_kind: "command",
      sent_at: VALID_SENT_AT,
      producer_role: "session",
      producer_key: "nano-agent.session.do@v1",
      priority: "normal",
    },
    authority: {
      team_uuid: TEAM_UUID,
      plan_level: "pro",
      stamped_by_key: "nano-agent.platform.ingress@v1",
      stamped_at: VALID_SENT_AT,
    },
    trace: {
      trace_uuid: VALID_UUID,
      session_uuid: VALID_UUID,
    },
    body: {
      tool_name: "bash",
      tool_input: { command: "ls" },
    },
  } as unknown as NacpEnvelope;
}

describe("NacpErrorBodySchema", () => {
  it("parses minimal valid body", () => {
    const body: NacpErrorBody = { code: "X", message: "boom" };
    expect(() => NacpErrorBodySchema.parse(body)).not.toThrow();
  });

  it("parses full body with retriable and cause", () => {
    const body = {
      code: "DEP_DOWN",
      message: "downstream unavailable",
      retriable: true,
      cause: { code: "upstream.503", message: "gateway" },
    };
    expect(() => NacpErrorBodySchema.parse(body)).not.toThrow();
  });

  it("rejects missing code", () => {
    expect(() =>
      NacpErrorBodySchema.parse({ message: "x" }),
    ).toThrow();
  });

  it("rejects empty code", () => {
    expect(() =>
      NacpErrorBodySchema.parse({ code: "", message: "x" }),
    ).toThrow();
  });
});

describe("wrapAsError()", () => {
  it("flips delivery_kind to error and replaces body", () => {
    const source = makeSourceEnvelope();
    const wrapped = wrapAsError(
      source,
      { code: "FAILED", message: "nope" },
      { message_uuid: NEW_UUID, sent_at: NEW_SENT_AT },
    );
    expect(wrapped.header.delivery_kind).toBe("error");
    expect(wrapped.header.message_uuid).toBe(NEW_UUID);
    expect(wrapped.header.sent_at).toBe(NEW_SENT_AT);
    expect(wrapped.body).toEqual({ code: "FAILED", message: "nope" });
  });

  it("preserves authority and trace", () => {
    const source = makeSourceEnvelope();
    const wrapped = wrapAsError(
      source,
      { code: "FAILED", message: "nope" },
      { message_uuid: NEW_UUID, sent_at: NEW_SENT_AT },
    );
    expect(wrapped.authority).toEqual(source.authority);
    expect(wrapped.trace).toEqual(source.trace);
  });

  it("output body parses through NacpErrorBodySchema", () => {
    const source = makeSourceEnvelope();
    const wrapped = wrapAsError(
      source,
      {
        code: "X",
        message: "y",
        retriable: false,
        cause: { code: "upstream.A", message: "B" },
      },
      { message_uuid: NEW_UUID, sent_at: NEW_SENT_AT },
    );
    expect(() => NacpErrorBodySchema.parse(wrapped.body)).not.toThrow();
  });
});
