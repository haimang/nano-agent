// HP7 P4-02 — session.fork.created stream event schema tests.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.8 HP7
//   * docs/design/hero-to-pro/HP7-checkpoint-revert.md §7 F4
//   * docs/design/hero-to-pro/HPX-qna.md Q23

import { describe, it, expect } from "vitest";
import {
  SessionStreamEventBodySchema,
  STREAM_EVENT_KINDS,
  SessionForkCreatedKind,
} from "../src/index.js";

describe("HP7 session.fork.created — frozen shape", () => {
  it("registers in STREAM_EVENT_KINDS", () => {
    expect(STREAM_EVENT_KINDS).toContain("session.fork.created");
  });

  it("accepts a fork lineage event with both parent and child uuids", () => {
    const ev = SessionForkCreatedKind.parse({
      kind: "session.fork.created",
      parent_session_uuid: "11111111-1111-4111-8111-111111111111",
      child_session_uuid: "22222222-2222-4222-8222-222222222222",
      conversation_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      from_checkpoint_uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      restore_job_uuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      label: "branch-A",
    });
    expect(ev.parent_session_uuid).not.toBe(ev.child_session_uuid);
  });

  it("conversation_uuid is required (Q23 same-conversation invariant)", () => {
    expect(
      SessionForkCreatedKind.safeParse({
        kind: "session.fork.created",
        parent_session_uuid: "11111111-1111-4111-8111-111111111111",
        child_session_uuid: "22222222-2222-4222-8222-222222222222",
        from_checkpoint_uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        restore_job_uuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }).success,
    ).toBe(false);
  });

  it("restore_job_uuid is required (lineage truth lives on the restore job)", () => {
    expect(
      SessionForkCreatedKind.safeParse({
        kind: "session.fork.created",
        parent_session_uuid: "11111111-1111-4111-8111-111111111111",
        child_session_uuid: "22222222-2222-4222-8222-222222222222",
        conversation_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        from_checkpoint_uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }).success,
    ).toBe(false);
  });

  it("integrates with the SessionStreamEventBody discriminated union", () => {
    const ev = SessionStreamEventBodySchema.parse({
      kind: "session.fork.created",
      parent_session_uuid: "11111111-1111-4111-8111-111111111111",
      child_session_uuid: "22222222-2222-4222-8222-222222222222",
      conversation_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      from_checkpoint_uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      restore_job_uuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    expect(ev.kind).toBe("session.fork.created");
  });
});
