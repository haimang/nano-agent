// HP4-D1 / HP7-D3 (deferred-closure absorb) — retry + fork handlers.
//
// Lifted out of `user-do-runtime.ts` to keep that file within its HP8
// P3-01 megafile budget (Q25 stop-the-bleed). The absorb itself is
// recorded in `docs/issue/hero-to-pro/HP0-H10-deferred-closure.md`.

import { jsonResponse } from "./session-lifecycle.js";

export async function handleRetryAbsorbed(
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
  return jsonResponse(200, {
    ok: true,
    action: "retry",
    session_uuid: sessionUuid,
    session_status: status ?? "active",
    // first-wave: signals to client that route is wired but full
    // attempt-chain executor is in HP4 follow-up batch within
    // hero-to-pro. Clients may resend latest user message via
    // `/messages` to achieve retry semantics today.
    retry_kind: "request-acknowledged-replay-via-messages",
    hint: "POST /sessions/{id}/messages with the previous user prompt to replay",
    requested_attempt_seed: typeof body.attempt_label === "string" ? body.attempt_label : null,
  });
}

export async function handleForkAbsorbed(
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
  return jsonResponse(202, {
    ok: true,
    action: "fork",
    parent_session_uuid: sessionUuid,
    // first-wave: child session UUID is minted but executor wires
    // are in HP7 follow-up batch within hero-to-pro. The
    // `session.fork.created` stream event will fire once snapshot
    // copy completes; clients should poll
    // `/sessions/{child}/status` until `active`.
    child_session_uuid: childSessionUuid,
    from_checkpoint_uuid: fromCheckpoint,
    label: typeof body.label === "string" ? body.label : null,
    fork_status: "pending-executor",
  });
}
