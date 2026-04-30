// HP5 P1-03 — confirmation control plane frame family schema tests.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.6 HP5
//   * docs/design/hero-to-pro/HP5-confirmation-control-plane.md §7 F4/F5
//   * docs/design/hero-to-pro/HPX-qna.md Q16-Q18
//   * workers/orchestrator-core/migrations/012-session-confirmations.sql

import { describe, it, expect } from "vitest";
import {
  SessionConfirmationKindSchema,
  SessionConfirmationStatusSchema,
  SessionConfirmationRequestBodySchema,
  SessionConfirmationUpdateBodySchema,
  SESSION_BODY_SCHEMAS,
  SESSION_BODY_REQUIRED,
  SESSION_MESSAGE_TYPES,
  NACP_SESSION_TYPE_DIRECTION_MATRIX,
  isLegalSessionDirection,
  SESSION_ROLE_REQUIREMENTS,
  isSessionMessageAllowedInPhase,
} from "../src/index.js";

describe("HP5 confirmation kind enum (Q18)", () => {
  it("accepts the 7 frozen kinds and only those", () => {
    const allowed = [
      "tool_permission",
      "elicitation",
      "model_switch",
      "context_compact",
      "fallback_model",
      "checkpoint_restore",
      "context_loss",
    ];
    for (const kind of allowed) {
      expect(SessionConfirmationKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  it("rejects tool_cancel (Q18 forbids it as a confirmation kind)", () => {
    expect(SessionConfirmationKindSchema.safeParse("tool_cancel").success).toBe(
      false,
    );
  });

  it("rejects custom (Q18 forbids the escape hatch)", () => {
    expect(SessionConfirmationKindSchema.safeParse("custom").success).toBe(false);
  });
});

describe("HP5 confirmation status enum (Q16)", () => {
  it("accepts the 6 frozen statuses and only those", () => {
    const allowed = [
      "pending",
      "allowed",
      "denied",
      "modified",
      "timeout",
      "superseded",
    ];
    for (const status of allowed) {
      expect(SessionConfirmationStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("rejects failed (Q16 forbids it; rollback uses superseded instead)", () => {
    expect(SessionConfirmationStatusSchema.safeParse("failed").success).toBe(
      false,
    );
  });
});

describe("HP5 confirmation request frame", () => {
  it("accepts a tool_permission request", () => {
    const body = SessionConfirmationRequestBodySchema.parse({
      confirmation_uuid: "11111111-1111-4111-8111-111111111111",
      kind: "tool_permission",
      payload: {
        tool_name: "bash",
        tool_input: { command: "ls" },
        reason: "PreToolUse asked",
      },
      request_uuid: "22222222-2222-4222-8222-222222222222",
      expires_at: "2026-05-01T00:00:00.000Z",
    });
    expect(body.kind).toBe("tool_permission");
  });

  it("accepts an elicitation request without a request_uuid alias", () => {
    const body = SessionConfirmationRequestBodySchema.parse({
      confirmation_uuid: "33333333-3333-4333-8333-333333333333",
      kind: "elicitation",
      payload: { prompt: "Pick one" },
    });
    expect(body.kind).toBe("elicitation");
  });

  it("rejects a missing payload", () => {
    expect(
      SessionConfirmationRequestBodySchema.safeParse({
        confirmation_uuid: "11111111-1111-4111-8111-111111111111",
        kind: "tool_permission",
      }).success,
    ).toBe(false);
  });
});

describe("HP5 confirmation update frame", () => {
  it("accepts a terminal allowed transition with decision payload", () => {
    const body = SessionConfirmationUpdateBodySchema.parse({
      confirmation_uuid: "11111111-1111-4111-8111-111111111111",
      status: "allowed",
      decision_payload: { decision: "allow", scope: "once" },
      decided_at: "2026-05-01T00:01:00.000Z",
    });
    expect(body.status).toBe("allowed");
  });

  it("accepts a superseded transition without decision payload", () => {
    const body = SessionConfirmationUpdateBodySchema.parse({
      confirmation_uuid: "11111111-1111-4111-8111-111111111111",
      status: "superseded",
    });
    expect(body.status).toBe("superseded");
  });

  it("rejects status=failed (Q16)", () => {
    expect(
      SessionConfirmationUpdateBodySchema.safeParse({
        confirmation_uuid: "11111111-1111-4111-8111-111111111111",
        status: "failed",
      }).success,
    ).toBe(false);
  });
});

describe("HP5 frames in registries", () => {
  it("registers both frames in SESSION_BODY_SCHEMAS", () => {
    expect(SESSION_BODY_SCHEMAS["session.confirmation.request"]).toBeDefined();
    expect(SESSION_BODY_SCHEMAS["session.confirmation.update"]).toBeDefined();
  });

  it("requires non-empty body for both frames", () => {
    expect(SESSION_BODY_REQUIRED.has("session.confirmation.request")).toBe(true);
    expect(SESSION_BODY_REQUIRED.has("session.confirmation.update")).toBe(true);
  });

  it("registers both frames in SESSION_MESSAGE_TYPES", () => {
    expect(SESSION_MESSAGE_TYPES.has("session.confirmation.request")).toBe(true);
    expect(SESSION_MESSAGE_TYPES.has("session.confirmation.update")).toBe(true);
  });
});

describe("HP5 frames direction & phase matrix", () => {
  it("only allows server → client (event delivery)", () => {
    const allowed = NACP_SESSION_TYPE_DIRECTION_MATRIX["session.confirmation.request"];
    expect(allowed).toBeDefined();
    expect(isLegalSessionDirection("session.confirmation.request", "event")).toBe(
      true,
    );
    expect(
      isLegalSessionDirection("session.confirmation.request", "command"),
    ).toBe(false);
    expect(
      isLegalSessionDirection("session.confirmation.update", "command"),
    ).toBe(false);
  });

  it("session role produces, client role consumes", () => {
    expect(
      SESSION_ROLE_REQUIREMENTS.session.producer.has(
        "session.confirmation.request",
      ),
    ).toBe(true);
    expect(
      SESSION_ROLE_REQUIREMENTS.session.producer.has("session.confirmation.update"),
    ).toBe(true);
    expect(
      SESSION_ROLE_REQUIREMENTS.client.consumer.has("session.confirmation.request"),
    ).toBe(true);
    expect(
      SESSION_ROLE_REQUIREMENTS.client.consumer.has("session.confirmation.update"),
    ).toBe(true);
  });

  it("client role cannot produce confirmation frames (server-only)", () => {
    expect(
      SESSION_ROLE_REQUIREMENTS.client.producer.has("session.confirmation.request"),
    ).toBe(false);
    expect(
      SESSION_ROLE_REQUIREMENTS.client.producer.has("session.confirmation.update"),
    ).toBe(false);
  });

  it("allowed in attached + turn_running phases, not in unattached / ended", () => {
    expect(
      isSessionMessageAllowedInPhase("attached", "session.confirmation.request"),
    ).toBe(true);
    expect(
      isSessionMessageAllowedInPhase("turn_running", "session.confirmation.update"),
    ).toBe(true);
    expect(
      isSessionMessageAllowedInPhase("unattached", "session.confirmation.request"),
    ).toBe(false);
    expect(
      isSessionMessageAllowedInPhase("ended", "session.confirmation.update"),
    ).toBe(false);
  });
});
