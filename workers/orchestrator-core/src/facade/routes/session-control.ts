import { authenticateRequest } from "../../auth.js";
import {
  CheckpointRestoreJobConstraintError,
  D1CheckpointRestoreJobs,
} from "../../checkpoint-restore-plane.js";
import {
  CONFIRMATION_KINDS,
  D1ConfirmationControlPlane,
  type ConfirmationStatus,
} from "../../confirmation-control-plane.js";
import { jsonPolicyError } from "../../policy/authority.js";
import {
  D1SessionTruthRepository,
  type DurableSessionLifecycleRecord,
} from "../../session-truth.js";
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

type SessionTodoRoute =
  | { kind: "list"; sessionUuid: string }
  | { kind: "create"; sessionUuid: string }
  | { kind: "patch"; sessionUuid: string; todoUuid: string }
  | { kind: "delete"; sessionUuid: string; todoUuid: string };

type SessionConfirmationRoute =
  | { kind: "list"; sessionUuid: string }
  | { kind: "detail"; sessionUuid: string; confirmationUuid: string }
  | { kind: "decision"; sessionUuid: string; confirmationUuid: string };

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

function parseSessionConfirmationRoute(request: Request): SessionConfirmationRoute | null {
  const pathname = new URL(request.url).pathname;
  const method = request.method.toUpperCase();
  const list = pathname.match(/^\/sessions\/([^/]+)\/confirmations$/);
  if (list) {
    const sessionUuid = list[1]!;
    if (!UUID_RE.test(sessionUuid) || method !== "GET") return null;
    return { kind: "list", sessionUuid };
  }
  const detailOrDecision = pathname.match(/^\/sessions\/([^/]+)\/confirmations\/([^/]+)(?:\/(decision))?$/);
  if (!detailOrDecision) return null;
  const sessionUuid = detailOrDecision[1]!;
  const confirmationUuid = detailOrDecision[2]!;
  const isDecision = detailOrDecision[3] === "decision";
  if (!UUID_RE.test(sessionUuid) || !UUID_RE.test(confirmationUuid)) return null;
  if (isDecision) {
    if (method !== "POST") return null;
    return { kind: "decision", sessionUuid, confirmationUuid };
  }
  if (method !== "GET") return null;
  return { kind: "detail", sessionUuid, confirmationUuid };
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

function isConfirmationStatus(value: unknown): value is ConfirmationStatus {
  return value === "allowed"
    || value === "denied"
    || value === "modified"
    || value === "timeout"
    || value === "superseded";
}

function isTodoStatus(value: unknown): value is TodoStatus {
  return TODO_STATUSES.includes(value as TodoStatus);
}

function todoConstraintToResponse(err: TodoConstraintError, traceUuid: string): Response {
  const status =
    err.code === "todo-not-found"
      ? 404
      : err.code === "in-progress-conflict"
        ? 409
        : 400;
  return jsonPolicyError(status, err.code, err.message, traceUuid);
}

interface OwnedSessionResult {
  readonly repo: D1SessionTruthRepository;
  readonly session: DurableSessionLifecycleRecord;
  readonly traceUuid: string;
}

async function readOwnedSession(
  env: OrchestratorCoreEnv,
  request: Request,
  sessionUuid: string,
): Promise<OwnedSessionResult | Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth.ok) return auth.response;
  const traceUuid = auth.value.trace_uuid;
  const db = env.NANO_AGENT_DB;
  if (!db) {
    return jsonPolicyError(503, "worker-misconfigured", "NANO_AGENT_DB binding must be configured", traceUuid);
  }
  const repo = new D1SessionTruthRepository(db);
  const session = await repo.readSessionLifecycle(sessionUuid);
  if (
    !session ||
    session.team_uuid !== (auth.value.snapshot.team_uuid ?? auth.value.snapshot.tenant_uuid) ||
    session.actor_user_uuid !== auth.value.user_uuid
  ) {
    return jsonPolicyError(404, "not-found", "session not found", traceUuid);
  }
  if (session.deleted_at) {
    return jsonPolicyError(409, "conversation-deleted", "conversation is deleted", traceUuid);
  }
  return { repo, session, traceUuid };
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
      return Response.json(
        {
          ok: true,
          data: {
            session_uuid: route.sessionUuid,
            conversation_uuid: session.conversation_uuid,
            checkpoint,
            restore_job: restoreJob,
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

async function handleSessionConfirmation(
  request: Request,
  env: OrchestratorCoreEnv,
  route: SessionConfirmationRoute,
): Promise<Response> {
  const owned = await readOwnedSession(env, request, route.sessionUuid);
  if (owned instanceof Response) return owned;
  const { session, traceUuid } = owned;
  const plane = new D1ConfirmationControlPlane(env.NANO_AGENT_DB!);

  if (route.kind === "list") {
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    let listFilter: ConfirmationStatus | "any" | undefined;
    if (statusParam && statusParam !== "any") {
      if (!isConfirmationStatus(statusParam) && statusParam !== "pending") {
        return jsonPolicyError(400, "invalid-input", "status must be one of pending|allowed|denied|modified|timeout|superseded|any", traceUuid);
      }
      listFilter = statusParam as ConfirmationStatus;
    } else if (statusParam === "any") {
      listFilter = "any";
    }
    const confirmations = await plane.list({
      session_uuid: route.sessionUuid,
      status: listFilter,
    });
    return Response.json(
      {
        ok: true,
        data: {
          session_uuid: route.sessionUuid,
          conversation_uuid: session.conversation_uuid,
          confirmations,
          known_kinds: CONFIRMATION_KINDS,
        },
        trace_uuid: traceUuid,
      },
      { status: 200, headers: { "x-trace-uuid": traceUuid } },
    );
  }

  if (route.kind === "detail") {
    const row = await plane.read({
      session_uuid: route.sessionUuid,
      confirmation_uuid: route.confirmationUuid,
    });
    if (!row) {
      return jsonPolicyError(404, "not-found", "confirmation not found", traceUuid);
    }
    return Response.json(
      {
        ok: true,
        data: {
          session_uuid: route.sessionUuid,
          conversation_uuid: session.conversation_uuid,
          confirmation: row,
        },
        trace_uuid: traceUuid,
      },
      { status: 200, headers: { "x-trace-uuid": traceUuid } },
    );
  }

  const body = await parseBody(request);
  if (!body) {
    return jsonPolicyError(400, "invalid-input", "decision requires a JSON body", traceUuid);
  }
  const status = body.status;
  if (!isConfirmationStatus(status)) {
    return jsonPolicyError(400, "invalid-input", "status must be one of allowed|denied|modified|timeout|superseded", traceUuid);
  }
  const decisionPayloadRaw = body.decision_payload;
  let decisionPayload: Record<string, unknown> | null = null;
  if (decisionPayloadRaw !== undefined && decisionPayloadRaw !== null) {
    if (typeof decisionPayloadRaw !== "object" || Array.isArray(decisionPayloadRaw)) {
      return jsonPolicyError(400, "invalid-input", "decision_payload must be a JSON object", traceUuid);
    }
    decisionPayload = decisionPayloadRaw as Record<string, unknown>;
  }

  const result = await plane.applyDecision({
    session_uuid: route.sessionUuid,
    confirmation_uuid: route.confirmationUuid,
    status,
    decision_payload: decisionPayload,
    decided_at: new Date().toISOString(),
  });
  if (!result.row) {
    return jsonPolicyError(404, "not-found", "confirmation not found", traceUuid);
  }
  if (result.conflict) {
    return jsonPolicyError(
      409,
      "confirmation-already-resolved",
      "confirmation has already been resolved with a different status",
      traceUuid,
    );
  }
  return Response.json(
    {
      ok: true,
      data: {
        session_uuid: route.sessionUuid,
        conversation_uuid: session.conversation_uuid,
        confirmation: result.row,
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
