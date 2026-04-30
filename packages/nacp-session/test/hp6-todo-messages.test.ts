// HP6 P1-02 — agentic-loop todo frame family schema tests.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.7 HP6
//   * docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md §7 F1
//   * workers/orchestrator-core/migrations/010-agentic-loop-todos.sql

import { describe, it, expect } from "vitest";
import {
  SessionTodoStatusSchema,
  SessionTodosWriteBodySchema,
  SessionTodosUpdateBodySchema,
  SESSION_BODY_SCHEMAS,
  SESSION_BODY_REQUIRED,
  SESSION_MESSAGE_TYPES,
  isLegalSessionDirection,
  SESSION_ROLE_REQUIREMENTS,
  isSessionMessageAllowedInPhase,
} from "../src/index.js";

describe("HP6 todo status enum (charter §436)", () => {
  it("accepts the 5 frozen statuses", () => {
    for (const s of ["pending", "in_progress", "completed", "cancelled", "blocked"]) {
      expect(SessionTodoStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects unknown statuses", () => {
    expect(SessionTodoStatusSchema.safeParse("deferred").success).toBe(false);
    expect(SessionTodoStatusSchema.safeParse("waiting").success).toBe(false);
  });
});

describe("HP6 todos.write frame", () => {
  it("accepts a single new todo", () => {
    const body = SessionTodosWriteBodySchema.parse({
      todos: [{ content: "review pr" }],
    });
    expect(body.todos[0]?.status).toBe("pending");
  });

  it("accepts multiple todos with explicit status", () => {
    const body = SessionTodosWriteBodySchema.parse({
      todos: [
        { content: "a", status: "in_progress" },
        { content: "b" },
      ],
    });
    expect(body.todos).toHaveLength(2);
  });

  it("rejects empty todo lists", () => {
    expect(
      SessionTodosWriteBodySchema.safeParse({ todos: [] }).success,
    ).toBe(false);
  });

  it("rejects oversize batches (>100)", () => {
    const todos = Array.from({ length: 101 }, () => ({ content: "x" }));
    expect(SessionTodosWriteBodySchema.safeParse({ todos }).success).toBe(false);
  });
});

describe("HP6 todos.update frame", () => {
  it("accepts a full state broadcast", () => {
    const body = SessionTodosUpdateBodySchema.parse({
      session_uuid: "11111111-1111-4111-8111-111111111111",
      todos: [
        {
          todo_uuid: "22222222-2222-4222-8222-222222222222",
          session_uuid: "11111111-1111-4111-8111-111111111111",
          conversation_uuid: "33333333-3333-4333-8333-333333333333",
          parent_todo_uuid: null,
          content: "review pr",
          status: "pending",
          created_at: "2026-04-30T00:00:00.000Z",
          updated_at: "2026-04-30T00:00:00.000Z",
          completed_at: null,
        },
      ],
    });
    expect(body.todos).toHaveLength(1);
  });
});

describe("HP6 todo frames in registries", () => {
  it("registers both frames in SESSION_BODY_SCHEMAS", () => {
    expect(SESSION_BODY_SCHEMAS["session.todos.write"]).toBeDefined();
    expect(SESSION_BODY_SCHEMAS["session.todos.update"]).toBeDefined();
  });

  it("requires non-empty body for both frames", () => {
    expect(SESSION_BODY_REQUIRED.has("session.todos.write")).toBe(true);
    expect(SESSION_BODY_REQUIRED.has("session.todos.update")).toBe(true);
  });

  it("registers both frames in SESSION_MESSAGE_TYPES", () => {
    expect(SESSION_MESSAGE_TYPES.has("session.todos.write")).toBe(true);
    expect(SESSION_MESSAGE_TYPES.has("session.todos.update")).toBe(true);
  });
});

describe("HP6 todo frames direction & phase", () => {
  it("todos.write is client → server (command), todos.update is server → client (event)", () => {
    expect(isLegalSessionDirection("session.todos.write", "command")).toBe(true);
    expect(isLegalSessionDirection("session.todos.write", "event")).toBe(false);
    expect(isLegalSessionDirection("session.todos.update", "event")).toBe(true);
    expect(isLegalSessionDirection("session.todos.update", "command")).toBe(false);
  });

  it("client produces todos.write, server produces todos.update", () => {
    expect(SESSION_ROLE_REQUIREMENTS.client.producer.has("session.todos.write")).toBe(true);
    expect(SESSION_ROLE_REQUIREMENTS.session.producer.has("session.todos.update")).toBe(true);
    expect(SESSION_ROLE_REQUIREMENTS.client.producer.has("session.todos.update")).toBe(false);
    expect(SESSION_ROLE_REQUIREMENTS.session.producer.has("session.todos.write")).toBe(false);
  });

  it("allowed in attached + turn_running phases", () => {
    expect(isSessionMessageAllowedInPhase("attached", "session.todos.write")).toBe(true);
    expect(isSessionMessageAllowedInPhase("turn_running", "session.todos.update")).toBe(true);
    expect(isSessionMessageAllowedInPhase("unattached", "session.todos.write")).toBe(false);
  });
});
