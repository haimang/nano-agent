import { describe, expect, it } from "vitest";
import {
  isLegalSessionDirection,
  isSessionMessageAllowedInPhase,
  SessionApprovalPolicySchema,
  SessionItemKindSchema,
  SessionItemStartedBodySchema,
  SessionRestoreCompletedBodySchema,
  SessionRuntimeUpdateBodySchema,
  SESSION_BODY_REQUIRED,
  SESSION_BODY_SCHEMAS,
  SESSION_MESSAGE_TYPES,
  SESSION_ROLE_REQUIREMENTS,
} from "../src/index.js";

const sessionUuid = "11111111-1111-4111-8111-111111111111";
const itemUuid = "22222222-2222-4222-8222-222222222222";
const jobUuid = "33333333-3333-4333-8333-333333333333";
const checkpointUuid = "44444444-4444-4444-8444-444444444444";
const now = "2026-05-02T00:00:00.000Z";

describe("HPX6 runtime.update frame", () => {
  it("accepts the session-scoped runtime config object", () => {
    const body = SessionRuntimeUpdateBodySchema.parse({
      session_uuid: sessionUuid,
      version: 1,
      permission_rules: [
        {
          tool_name: "bash",
          pattern: "git *",
          behavior: "ask",
          scope: "session",
        },
      ],
      network_policy: { mode: "restricted" },
      web_search: { mode: "disabled" },
      workspace_scope: { mounts: ["/workspace"] },
      approval_policy: "ask",
      updated_at: now,
    });
    expect(body.permission_rules[0]?.behavior).toBe("ask");
  });

  it("keeps approval_policy to the frozen replacement enum", () => {
    expect(SessionApprovalPolicySchema.safeParse("always_allow").success).toBe(true);
    expect(SessionApprovalPolicySchema.safeParse("permission").success).toBe(false);
  });
});

describe("HPX6 restore.completed frame", () => {
  it("accepts terminal restore executor statuses", () => {
    for (const status of ["succeeded", "partial", "failed", "rolled_back"]) {
      expect(
        SessionRestoreCompletedBodySchema.safeParse({
          job_uuid: jobUuid,
          checkpoint_uuid: checkpointUuid,
          session_uuid: sessionUuid,
          status,
          started_at: now,
          completed_at: now,
        }).success,
      ).toBe(true);
    }
  });

  it("rejects non-terminal pending/running statuses", () => {
    expect(
      SessionRestoreCompletedBodySchema.safeParse({
        job_uuid: jobUuid,
        checkpoint_uuid: checkpointUuid,
        session_uuid: sessionUuid,
        status: "running",
        started_at: now,
        completed_at: now,
      }).success,
    ).toBe(false);
  });
});

describe("HPX6 item projection frames", () => {
  it("accepts the seven frozen item kinds", () => {
    for (const kind of [
      "agent_message",
      "reasoning",
      "tool_call",
      "file_change",
      "todo_list",
      "confirmation",
      "error",
    ]) {
      expect(SessionItemKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  it("accepts an item.started payload", () => {
    const body = SessionItemStartedBodySchema.parse({
      item_uuid: itemUuid,
      session_uuid: sessionUuid,
      kind: "tool_call",
      created_at: now,
      payload: { request_uuid: jobUuid, tool_name: "bash" },
    });
    expect(body.kind).toBe("tool_call");
  });
});

describe("HPX6 workbench frames in registries", () => {
  const frames = [
    "session.runtime.update",
    "session.restore.completed",
    "session.item.started",
    "session.item.updated",
    "session.item.completed",
  ];

  it("registers all HPX6 top-level frames", () => {
    for (const frame of frames) {
      expect(SESSION_BODY_SCHEMAS[frame as keyof typeof SESSION_BODY_SCHEMAS]).toBeDefined();
      expect(SESSION_BODY_REQUIRED.has(frame)).toBe(true);
      expect(SESSION_MESSAGE_TYPES.has(frame)).toBe(true);
    }
  });

  it("marks all HPX6 top-level frames as server events", () => {
    for (const frame of frames) {
      expect(isLegalSessionDirection(frame, "event")).toBe(true);
      expect(isLegalSessionDirection(frame, "command")).toBe(false);
      expect(SESSION_ROLE_REQUIREMENTS.session.producer.has(frame)).toBe(true);
      expect(SESSION_ROLE_REQUIREMENTS.client.consumer.has(frame)).toBe(true);
    }
  });

  it("allows HPX6 events while attached and turn_running", () => {
    for (const frame of frames) {
      expect(isSessionMessageAllowedInPhase("attached", frame)).toBe(true);
      expect(isSessionMessageAllowedInPhase("turn_running", frame)).toBe(true);
      expect(isSessionMessageAllowedInPhase("unattached", frame)).toBe(false);
    }
  });
});
