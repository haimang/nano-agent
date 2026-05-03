import {
  CheckpointRestoreJobConstraintError,
  D1CheckpointRestoreJobs,
} from "../../checkpoint-restore-plane.js";
import { D1ConfirmationControlPlane } from "../../confirmation-control-plane.js";
import { jsonPolicyError } from "../../policy/authority.js";
import {
  D1TodoControlPlane,
  TODO_STATUSES,
  TodoConstraintError,
  type TodoStatus,
} from "../../todo-control-plane.js";
import type { OrchestratorCoreEnv } from "../env.js";
import {
  parseBody,
  RESTORE_REQUEST_MODES,
  type RestoreRequestMode,
  UUID_RE,
} from "../shared/request.js";
import { emitFrameViaUserDO } from "../../wsemit.js";
import { dispatchExecutorJob } from "../../executor-runtime.js";
import { readOwnedSession } from "./session-control-shared.js";
import {
  handleSessionConfirmation,
  parseSessionConfirmationRoute,
} from "./session-confirmations.js";

type SessionTodoRoute =
  | { kind: "list"; sessionUuid: string }
  | { kind: "create"; sessionUuid: string }
  | { kind: "patch"; sessionUuid: string; todoUuid: string }
  | { kind: "delete"; sessionUuid: string; todoUuid: string };

type SessionCheckpointRoute =
  | { kind: "list"; sessionUuid: string }
  | { kind: "create"; sessionUuid: string }
  | { kind: "diff"; sessionUuid: string; checkpointUuid: string }
  | { kind: "restore"; sessionUuid: string; checkpointUuid: string };

function parseSessionTodoRoute(request: Request): SessionTodoRoute | null {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  const list = pathname.match(/^\/sessions\/([^/]+)\/todos$/);
  if (list) {
    const sessionUuid = list[1]!;
    if (!UUID_RE.test(sessionUuid)) return null;
    if (method === "GET") return { kind: "list", sessionUuid };
    if (method === "POST") return { kind: "create", sessionUuid };
    return null;
  }
  const item = pathname.match(/^\/sessions\/([^/]+)\/todos\/([^/]+)$/);
  if (!item) return null;
  const sessionUuid = item[1]!;
  const todoUuid = item[2]!;
  if (!UUID_RE.test(sessionUuid) || !UUID_RE.test(todoUuid)) return null;
  if (method === "PATCH") return { kind: "patch", sessionUuid, todoUuid };
  if (method === "DELETE") return { kind: "delete", sessionUuid, todoUuid };
  return null;
}

function parseSessionCheckpointRoute(request: Request): SessionCheckpointRoute | null {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  const listOrCreate = pathname.match(/^\/sessions\/([^/]+)\/checkpoints$/);
  if (listOrCreate) {
    const sessionUuid = listOrCreate[1]!;
    if (!UUID_RE.test(sessionUuid)) return null;
    if (method === "GET") return { kind: "list", sessionUuid };
    if (method === "POST") return { kind: "create", sessionUuid };
    return null;
  }
  const diff = pathname.match(/^\/sessions\/([^/]+)\/checkpoints\/([^/]+)\/diff$/);
  if (diff) {
    const sessionUuid = diff[1]!;
    const checkpointUuid = diff[2]!;
    if (!UUID_RE.test(sessionUuid) || !UUID_RE.test(checkpointUuid) || method !== "GET") return null;
    return { kind: "diff", sessionUuid, checkpointUuid };
  }
  const restore = pathname.match(/^\/sessions\/([^/]+)\/checkpoints\/([^/]+)\/restore$/);
  if (!restore) return null;
  const sessionUuid = restore[1]!;
  const checkpointUuid = restore[2]!;
  if (!UUID_RE.test(sessionUuid) || !UUID_RE.test(checkpointUuid) || method !== "POST") return null;
  return { kind: "restore", sessionUuid, checkpointUuid };
}

function isTodoStatus(value: unknown): value is TodoStatus {
  return TODO_STATUSES.includes(value as TodoStatus);
}

function todoConstraintToResponse(err: TodoConstraintError, traceUuid: string): Response {
  // HPX3 F1 + F5 — 移除 dead code 后，TodoConstraintError 仅剩 `in-progress-conflict`。
  return jsonPolicyError(409, err.code, err.message, traceUuid);
}

async function handleSessionCheckpoint(
  request: Request,
  env: OrchestratorCoreEnv,
  route: SessionCheckpointRoute,
): Promise<Response> {
  const owned = await readOwnedSession(env, request, route.sessionUuid);
  if (owned instanceof Response) return owned;
  const { repo, session, traceUuid } = owned;
  const db = env.NANO_AGENT_DB!;

  if (route.kind === "list") {
    const checkpoints = await repo.listCheckpoints({
      session_uuid: route.sessionUuid,
      team_uuid: session.team_uuid,
    });
    return Response.json(
      {
        ok: true,
        data: {
          session_uuid: route.sessionUuid,
          conversation_uuid: session.conversation_uuid,
          checkpoints,
        },
        trace_uuid: traceUuid,
      },
      { status: 200, headers: { "x-trace-uuid": traceUuid } },
    );
  }

  if (route.kind === "create") {
    const body = await parseBody(request, true);
    const rawLabel = typeof body?.label === "string" ? body.label.trim() : "";
    if (body?.label !== undefined && (rawLabel.length === 0 || rawLabel.length > 200)) {
      return jsonPolicyError(400, "invalid-input", "label must be a non-empty string up to 200 characters", traceUuid);
    }
    const checkpoint = await repo.createUserCheckpoint({
      session_uuid: route.sessionUuid,
      team_uuid: session.team_uuid,
      label: rawLabel.length > 0 ? rawLabel : null,
      created_at: new Date().toISOString(),
    });
    if (!checkpoint) {
      return jsonPolicyError(500, "internal-error", "failed to create checkpoint", traceUuid);
    }
    return Response.json(
      {
        ok: true,
        data: {
          session_uuid: route.sessionUuid,
          conversation_uuid: session.conversation_uuid,
          checkpoint,
        },
        trace_uuid: traceUuid,
      },
      { status: 201, headers: { "x-trace-uuid": traceUuid } },
    );
  }

  const checkpoint = (await repo.listCheckpoints({
    session_uuid: route.sessionUuid,
    team_uuid: session.team_uuid,
  })).find((row) => row.checkpoint_uuid === route.checkpointUuid);
  if (!checkpoint) {
    return jsonPolicyError(404, "not-found", "checkpoint not found", traceUuid);
  }

  if (route.kind === "restore") {
    const body = await parseBody(request);
    if (body === null) {
      return jsonPolicyError(400, "invalid-input", "restore requires a JSON body", traceUuid);
    }
    const rawMode = body.mode;
    if (!RESTORE_REQUEST_MODES.includes(rawMode as RestoreRequestMode)) {
      return jsonPolicyError(400, "invalid-input", `mode must be one of ${RESTORE_REQUEST_MODES.join("|")}`, traceUuid);
    }
    const mode = rawMode as RestoreRequestMode;
    const confirmationUuid = typeof body.confirmation_uuid === "string" ? body.confirmation_uuid : "";
    if (!UUID_RE.test(confirmationUuid)) {
      return jsonPolicyError(400, "invalid-input", "confirmation_uuid must be a valid UUID", traceUuid);
    }
    const confirmationPlane = new D1ConfirmationControlPlane(db);
    const confirmation = await confirmationPlane.read({
      session_uuid: route.sessionUuid,
      confirmation_uuid: confirmationUuid,
    });
    if (!confirmation) {
      return jsonPolicyError(404, "not-found", "confirmation not found", traceUuid);
    }
    if (confirmation.kind !== "checkpoint_restore") {
      return jsonPolicyError(409, "invalid-input", "confirmation kind must be checkpoint_restore", traceUuid);
    }
    if (confirmation.status !== "pending") {
      return jsonPolicyError(
        409,
        "confirmation-already-resolved",
        "confirmation has already been resolved with a different status",
        traceUuid,
      );
    }
    try {
      const restoreJobs = new D1CheckpointRestoreJobs(db);
      const restoreJob = await restoreJobs.openJob({
        checkpoint_uuid: route.checkpointUuid,
        session_uuid: route.sessionUuid,
        mode,
        confirmation_uuid: confirmationUuid,
        target_session_uuid: null,
      });
      const dispatchPath = await dispatchExecutorJob(env, {
        kind: "restore",
        job_uuid: restoreJob.job_uuid,
        checkpoint_uuid: route.checkpointUuid,
        session_uuid: route.sessionUuid,
        mode,
        target_session_uuid: null,
        team_uuid: session.team_uuid,
        user_uuid: session.actor_user_uuid,
        trace_uuid: traceUuid,
      });
      const latestJob = await restoreJobs.read({ job_uuid: restoreJob.job_uuid });
      return Response.json(
        {
          ok: true,
          data: {
            session_uuid: route.sessionUuid,
            conversation_uuid: session.conversation_uuid,
            checkpoint,
            restore_job: latestJob ?? restoreJob,
            executor_status: dispatchPath === "queue" ? "enqueued" : "completed",
            dispatch_path: dispatchPath,
          },
          trace_uuid: traceUuid,
        },
        { status: 202, headers: { "x-trace-uuid": traceUuid } },
      );
    } catch (error) {
      if (error instanceof CheckpointRestoreJobConstraintError) {
        return jsonPolicyError(400, "invalid-input", error.message, traceUuid);
      }
      throw error;
    }
  }

  const diff = await repo.readCheckpointDiff({
    session_uuid: route.sessionUuid,
    checkpoint_uuid: route.checkpointUuid,
    team_uuid: session.team_uuid,
  });
  if (!diff) {
    return jsonPolicyError(404, "not-found", "checkpoint not found", traceUuid);
  }
  return Response.json(
    {
      ok: true,
      data: {
        session_uuid: route.sessionUuid,
        conversation_uuid: session.conversation_uuid,
        diff,
      },
      trace_uuid: traceUuid,
    },
    { status: 200, headers: { "x-trace-uuid": traceUuid } },
  );
}

async function handleSessionTodos(
  request: Request,
  env: OrchestratorCoreEnv,
  route: SessionTodoRoute,
): Promise<Response> {
  const owned = await readOwnedSession(env, request, route.sessionUuid);
  if (owned instanceof Response) return owned;
  const { session, traceUuid } = owned;
  const plane = new D1TodoControlPlane(env.NANO_AGENT_DB!);
  const now = new Date().toISOString();

  if (route.kind === "list") {
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    let filter: TodoStatus | "any" | undefined;
    if (statusParam && statusParam !== "any") {
      if (!isTodoStatus(statusParam)) {
        return jsonPolicyError(400, "invalid-input", "status must be one of pending|in_progress|completed|cancelled|blocked|any", traceUuid);
      }
      filter = statusParam;
    } else if (statusParam === "any") {
      filter = "any";
    }
    const todos = await plane.list({
      session_uuid: route.sessionUuid,
      status: filter,
    });
    return Response.json(
      {
        ok: true,
        data: {
          session_uuid: route.sessionUuid,
          conversation_uuid: session.conversation_uuid,
          todos,
        },
        trace_uuid: traceUuid,
      },
      { status: 200, headers: { "x-trace-uuid": traceUuid } },
    );
  }

  if (route.kind === "create") {
    const body = await parseBody(request);
    if (!body) {
      return jsonPolicyError(400, "invalid-input", "todo create requires a JSON body", traceUuid);
    }
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (content.length === 0 || content.length > 2000) {
      return jsonPolicyError(400, "invalid-input", "content must be a non-empty string up to 2000 chars", traceUuid);
    }
    const status = body.status === undefined ? undefined : body.status;
    if (status !== undefined && !isTodoStatus(status)) {
      return jsonPolicyError(400, "invalid-input", `status must be one of ${TODO_STATUSES.join("|")}`, traceUuid);
    }
    const parentTodoUuid = typeof body.parent_todo_uuid === "string" ? body.parent_todo_uuid : null;
    if (parentTodoUuid !== null && !UUID_RE.test(parentTodoUuid)) {
      return jsonPolicyError(400, "invalid-input", "parent_todo_uuid must be a UUID when provided", traceUuid);
    }
    try {
      const todo = await plane.create({
        session_uuid: route.sessionUuid,
        conversation_uuid: session.conversation_uuid,
        team_uuid: session.team_uuid,
        content,
        status: status as TodoStatus | undefined,
        parent_todo_uuid: parentTodoUuid,
        created_at: now,
      });
      // HPX5 F2c — emit `session.todos.update` after row write succeeds.
      // todos.update broadcasts the authoritative list; per messages.ts
      // SessionTodosUpdateBodySchema we send full snapshot of relevant rows.
      const fullList = await plane.list({ session_uuid: route.sessionUuid });
      emitFrameViaUserDO(
        env,
        {
          sessionUuid: route.sessionUuid,
          userUuid: session.actor_user_uuid,
          traceUuid,
        },
        "session.todos.update",
        {
          session_uuid: route.sessionUuid,
          todos: fullList,
        },
      );
      return Response.json(
        {
          ok: true,
          data: {
            session_uuid: route.sessionUuid,
            conversation_uuid: session.conversation_uuid,
            todo,
          },
          trace_uuid: traceUuid,
        },
        { status: 201, headers: { "x-trace-uuid": traceUuid } },
      );
    } catch (err) {
      if (err instanceof TodoConstraintError) return todoConstraintToResponse(err, traceUuid);
      throw err;
    }
  }

  if (route.kind === "patch") {
    const body = await parseBody(request);
    if (!body) {
      return jsonPolicyError(400, "invalid-input", "todo patch requires a JSON body", traceUuid);
    }
    const content = typeof body.content === "string" ? body.content.trim() : undefined;
    if (content !== undefined && (content.length === 0 || content.length > 2000)) {
      return jsonPolicyError(400, "invalid-input", "content must be a non-empty string up to 2000 chars", traceUuid);
    }
    const status = body.status === undefined ? undefined : body.status;
    if (status !== undefined && !isTodoStatus(status)) {
      return jsonPolicyError(400, "invalid-input", `status must be one of ${TODO_STATUSES.join("|")}`, traceUuid);
    }
    if (content === undefined && status === undefined) {
      return jsonPolicyError(400, "invalid-input", "patch requires at least one of content|status", traceUuid);
    }
    try {
      const todo = await plane.patch({
        session_uuid: route.sessionUuid,
        todo_uuid: route.todoUuid,
        content,
        status: status as TodoStatus | undefined,
        updated_at: now,
      });
      if (!todo) {
        return jsonPolicyError(404, "not-found", "todo not found", traceUuid);
      }
      // HPX5 F2c — emit `session.todos.update` after row write.
      const fullList = await plane.list({ session_uuid: route.sessionUuid });
      emitFrameViaUserDO(
        env,
        {
          sessionUuid: route.sessionUuid,
          userUuid: session.actor_user_uuid,
          traceUuid,
        },
        "session.todos.update",
        {
          session_uuid: route.sessionUuid,
          todos: fullList,
        },
      );
      return Response.json(
        {
          ok: true,
          data: {
            session_uuid: route.sessionUuid,
            conversation_uuid: session.conversation_uuid,
            todo,
          },
          trace_uuid: traceUuid,
        },
        { status: 200, headers: { "x-trace-uuid": traceUuid } },
      );
    } catch (err) {
      if (err instanceof TodoConstraintError) return todoConstraintToResponse(err, traceUuid);
      throw err;
    }
  }

  const removed = await plane.delete({
    session_uuid: route.sessionUuid,
    todo_uuid: route.todoUuid,
  });
  if (!removed) {
    return jsonPolicyError(404, "not-found", "todo not found", traceUuid);
  }
  // HPX5 F2c — emit `session.todos.update` after delete.
  const fullList = await plane.list({ session_uuid: route.sessionUuid });
  emitFrameViaUserDO(
    env,
    {
      sessionUuid: route.sessionUuid,
      userUuid: session.actor_user_uuid,
      traceUuid,
    },
    "session.todos.update",
    {
      session_uuid: route.sessionUuid,
      todos: fullList,
    },
  );
  return Response.json(
    {
      ok: true,
      data: {
        session_uuid: route.sessionUuid,
        conversation_uuid: session.conversation_uuid,
        todo_uuid: route.todoUuid,
        deleted: true,
      },
      trace_uuid: traceUuid,
    },
    { status: 200, headers: { "x-trace-uuid": traceUuid } },
  );
}

export async function tryHandleSessionControlRoute(
  request: Request,
  env: OrchestratorCoreEnv,
): Promise<Response | null> {
  const checkpointRoute = parseSessionCheckpointRoute(request);
  if (checkpointRoute) return handleSessionCheckpoint(request, env, checkpointRoute);
  const confirmationRoute = parseSessionConfirmationRoute(request);
  if (confirmationRoute) return handleSessionConfirmation(request, env, confirmationRoute);
  const todoRoute = parseSessionTodoRoute(request);
  if (todoRoute) return handleSessionTodos(request, env, todoRoute);
  return null;
}
