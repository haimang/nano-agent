import { describe, expect, it } from "vitest";

import {
  liftLightweightFrame,
  mapKindToMessageType,
  validateLightweightServerFrame,
} from "../src/frame-compat.js";

describe("frame-compat", () => {
  it("maps HPX5 top-level confirmation/todo kinds to canonical message types", () => {
    expect(mapKindToMessageType("session.confirmation.request")).toBe("session.confirmation.request");
    expect(mapKindToMessageType("session.confirmation.update")).toBe("session.confirmation.update");
    expect(mapKindToMessageType("session.todos.write")).toBe("session.todos.write");
    expect(mapKindToMessageType("session.todos.update")).toBe("session.todos.update");
  });

  it("accepts lightweight confirmation request frames with confirmation_kind alias", () => {
    expect(validateLightweightServerFrame({
      kind: "session.confirmation.request",
      confirmation_uuid: "11111111-1111-4111-8111-111111111111",
      confirmation_kind: "tool_permission",
      payload: { tool_name: "bash", tool_input: { command: "ls" } },
    })).toEqual({ ok: true });
  });

  it("accepts lightweight todo update frames against the top-level schema", () => {
    expect(validateLightweightServerFrame({
      kind: "session.todos.update",
      session_uuid: "11111111-1111-4111-8111-111111111111",
      todos: [{
        todo_uuid: "22222222-2222-4222-8222-222222222222",
        session_uuid: "11111111-1111-4111-8111-111111111111",
        conversation_uuid: "33333333-3333-4333-8333-333333333333",
        parent_todo_uuid: null,
        content: "ship HPX5",
        status: "in_progress",
        created_at: "2026-05-02T00:00:00.000Z",
        updated_at: "2026-05-02T00:00:00.000Z",
        completed_at: null,
      }],
    })).toEqual({ ok: true });
  });

  it("lifts lightweight confirmation request frames into canonical confirmation bodies", () => {
    const lifted = liftLightweightFrame(
      {
        kind: "session.confirmation.request",
        confirmation_uuid: "11111111-1111-4111-8111-111111111111",
        confirmation_kind: "tool_permission",
        payload: { tool_name: "bash" },
      },
      {
        sessionUuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        traceUuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
    );
    expect(lifted.body).toMatchObject({
      confirmation_uuid: "11111111-1111-4111-8111-111111111111",
      kind: "tool_permission",
      payload: { tool_name: "bash" },
    });
  });
});
