// HP4-D1 / HP7-D3 (deferred-closure absorb) — retry + fork handlers.
//
// Lifted out of `user-do-runtime.ts` to keep that file within its HP8
// P3-01 megafile budget (Q25 stop-the-bleed). The absorb itself is
// recorded in `docs/issue/hero-to-pro/HP0-H10-deferred-closure.md`.

import { jsonResponse } from "./session-lifecycle.js";
import { dispatchExecutorJob, type ExecutorRuntimeEnv } from "./executor-runtime.js";

export async function handleRetryAbsorbed(
  env: ExecutorRuntimeEnv,
  sessionUuid: string,
  body: Record<string, unknown>,
  entry: unknown,
): Promise<Response> {
  if (!entry) {
    return jsonResponse(404, {
      error: "session_missing",
      message: `session ${sessionUuid} not found`,
    });
  }
  const status = (entry as { status?: string }).status;
  if (status === "ended" || status === "expired") {
    return jsonResponse(409, {
      error: "session_terminal",
      message: `session ${sessionUuid} is terminal; retry not allowed`,
    });
  }
  const jobUuid = crypto.randomUUID();
  const dispatch_path = await dispatchExecutorJob(env, {
    kind: "retry",
    job_uuid: jobUuid,
    session_uuid: sessionUuid,
    requested_attempt_seed: typeof body.attempt_label === "string" ? body.attempt_label : null,
  });
  return jsonResponse(202, {
    ok: true,
    action: "retry",
    session_uuid: sessionUuid,
    session_status: status ?? "active",
    retry_kind: "queue-enqueued",
    job_uuid: jobUuid,
    executor_status: dispatch_path === "queue" ? "enqueued" : "completed",
    dispatch_path,
    requested_attempt_seed: typeof body.attempt_label === "string" ? body.attempt_label : null,
  });
}

export async function handleForkAbsorbed(
  env: ExecutorRuntimeEnv,
  sessionUuid: string,
  body: Record<string, unknown>,
  entry: unknown,
): Promise<Response> {
  if (!entry) {
    return jsonResponse(404, {
      error: "session_missing",
      message: `session ${sessionUuid} not found`,
    });
  }
  const fromCheckpoint = typeof body.from_checkpoint_uuid === "string"
    ? body.from_checkpoint_uuid
    : null;
  const childSessionUuid = crypto.randomUUID();
  const jobUuid = crypto.randomUUID();
  const dispatch_path = await dispatchExecutorJob(env, {
    kind: "fork",
    job_uuid: jobUuid,
    parent_session_uuid: sessionUuid,
    child_session_uuid: childSessionUuid,
    from_checkpoint_uuid: fromCheckpoint,
    label: typeof body.label === "string" ? body.label : null,
  });
  return jsonResponse(202, {
    ok: true,
    action: "fork",
    parent_session_uuid: sessionUuid,
    job_uuid: jobUuid,
    child_session_uuid: childSessionUuid,
    from_checkpoint_uuid: fromCheckpoint,
    label: typeof body.label === "string" ? body.label : null,
    fork_status: dispatch_path === "queue" ? "executor-enqueued" : "executor-completed",
    dispatch_path,
  });
}
