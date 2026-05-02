import type { RestoreMode } from "./checkpoint-restore-plane.js";
import { D1CheckpointRestoreJobs } from "./checkpoint-restore-plane.js";
import { emitFrameViaUserDO } from "./wsemit.js";

export type ExecutorJob =
  | {
      readonly kind: "retry";
      readonly job_uuid: string;
      readonly session_uuid: string;
      readonly team_uuid?: string;
      readonly user_uuid?: string;
      readonly trace_uuid?: string;
      readonly requested_attempt_seed?: string | null;
    }
  | {
      readonly kind: "fork";
      readonly job_uuid: string;
      readonly parent_session_uuid: string;
      readonly child_session_uuid: string;
      readonly team_uuid?: string;
      readonly user_uuid?: string;
      readonly trace_uuid?: string;
      readonly from_checkpoint_uuid?: string | null;
      readonly label?: string | null;
    }
  | {
      readonly kind: "restore";
      readonly job_uuid: string;
      readonly session_uuid: string;
      readonly checkpoint_uuid: string;
      readonly mode: RestoreMode;
      readonly target_session_uuid: string | null;
      readonly team_uuid?: string;
      readonly user_uuid?: string;
      readonly trace_uuid?: string;
    };

export type ExecutorDispatchPath = "queue" | "inline";

const RESTORE_PARTIAL_REASON = "restore-executor-pending-deep-semantics";

export interface ExecutorRuntimeEnv {
  readonly NANO_AGENT_DB?: D1Database;
  readonly NANO_EXECUTOR_QUEUE?: Queue<ExecutorJob>;
  readonly ORCHESTRATOR_USER_DO?: DurableObjectNamespace;
}

export async function dispatchExecutorJob(
  env: ExecutorRuntimeEnv,
  job: ExecutorJob,
): Promise<ExecutorDispatchPath> {
  if (env.NANO_EXECUTOR_QUEUE) {
    await env.NANO_EXECUTOR_QUEUE.send(job);
    return "queue";
  }
  await runExecutorJob(env, job);
  return "inline";
}

export async function runExecutorJob(
  env: ExecutorRuntimeEnv,
  job: ExecutorJob,
): Promise<{ ok: true; job_uuid: string }> {
  if (job.kind !== "restore") {
    return { ok: true, job_uuid: job.job_uuid };
  }
  if (!env.NANO_AGENT_DB) {
    throw new Error("NANO_AGENT_DB binding missing for restore executor");
  }
  const jobs = new D1CheckpointRestoreJobs(env.NANO_AGENT_DB);
  const startedAt = new Date().toISOString();
  const running = await jobs.markRunning({ job_uuid: job.job_uuid, started_at: startedAt });
  const completedAt = new Date().toISOString();
  const terminal = await jobs.terminate({
    job_uuid: job.job_uuid,
    status: "partial",
    completed_at: completedAt,
    failure_reason: RESTORE_PARTIAL_REASON,
  });
  if (job.user_uuid && env.ORCHESTRATOR_USER_DO) {
    emitFrameViaUserDO(
      env as Parameters<typeof emitFrameViaUserDO>[0],
      { sessionUuid: job.session_uuid, userUuid: job.user_uuid, traceUuid: job.trace_uuid ?? crypto.randomUUID() },
      "session.restore.completed",
      {
        job_uuid: job.job_uuid,
        checkpoint_uuid: job.checkpoint_uuid,
        session_uuid: job.session_uuid,
        target_session_uuid: terminal?.target_session_uuid ?? job.target_session_uuid,
        status: terminal?.status ?? "partial",
        failure_reason: terminal?.failure_reason ?? RESTORE_PARTIAL_REASON,
        started_at: terminal?.started_at ?? running?.started_at ?? startedAt,
        completed_at: terminal?.completed_at ?? completedAt,
      },
    );
  }
  return { ok: true, job_uuid: job.job_uuid };
}
