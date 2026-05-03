import {
  CONFIRMATION_KINDS,
  D1ConfirmationControlPlane,
  type ConfirmationStatus,
} from "../../confirmation-control-plane.js";
import { jsonPolicyError } from "../../policy/authority.js";
import type { DurableSessionLifecycleRecord } from "../../session-truth.js";
import { emitFrameViaUserDO } from "../../wsemit.js";
import type { OrchestratorCoreEnv } from "../env.js";
import { UUID_RE, parseBody } from "../shared/request.js";
import { createOrchestratorLogger } from "../../observability.js";
import { readOwnedSession } from "./session-control-shared.js";

export type SessionConfirmationRoute =
  | { kind: "list"; sessionUuid: string }
  | { kind: "detail"; sessionUuid: string; confirmationUuid: string }
  | { kind: "decision"; sessionUuid: string; confirmationUuid: string };

export function parseSessionConfirmationRoute(request: Request): SessionConfirmationRoute | null {
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

function isConfirmationStatus(value: unknown): value is ConfirmationStatus {
  return value === "allowed"
    || value === "denied"
    || value === "modified"
    || value === "timeout"
    || value === "superseded";
}

function buildAgentAuthority(session: DurableSessionLifecycleRecord): Record<string, unknown> {
  return {
    sub: session.actor_user_uuid,
    tenant_uuid: session.team_uuid,
    tenant_source: "claim",
    source_name: "orchestrator-core.confirmation-decision",
  };
}

async function wakeAgentConfirmationWaiter(
  env: OrchestratorCoreEnv,
  session: DurableSessionLifecycleRecord,
  input: {
    readonly confirmationUuid: string;
    readonly kind: string;
    readonly status: ConfirmationStatus;
    readonly decisionPayload: Record<string, unknown> | null;
    readonly traceUuid: string;
  },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const authority = buildAgentAuthority(session);
  const meta = { trace_uuid: input.traceUuid, authority };
  try {
    if (input.kind === "tool_permission") {
      const rpc = env.AGENT_CORE?.permissionDecision;
      if (typeof rpc !== "function") return { ok: false, reason: "agent-rpc-missing" };
      const response = await rpc(
        {
          session_uuid: session.session_uuid,
          request_uuid: input.confirmationUuid,
          status: input.status,
          decision: input.status === "allowed" ? "allow" : "deny",
          scope:
            typeof input.decisionPayload?.scope === "string"
              ? input.decisionPayload.scope
              : "once",
          ...(input.decisionPayload ? { decision_payload: input.decisionPayload } : {}),
        },
        meta,
      );
      return response.status >= 200 && response.status < 300
        ? { ok: true }
        : { ok: false, reason: `agent-rpc-status-${response.status}` };
    }
    if (input.kind === "elicitation") {
      const rpc = env.AGENT_CORE?.elicitationAnswer;
      if (typeof rpc !== "function") return { ok: false, reason: "agent-rpc-missing" };
      const response = await rpc(
        {
          session_uuid: session.session_uuid,
          request_uuid: input.confirmationUuid,
          status: input.status,
          answer:
            input.decisionPayload && "answer" in input.decisionPayload
              ? input.decisionPayload.answer
              : input.decisionPayload,
          cancelled:
            input.status === "timeout" ||
            input.status === "superseded" ||
            input.status === "denied",
        },
        meta,
      );
      return response.status >= 200 && response.status < 300
        ? { ok: true }
        : { ok: false, reason: `agent-rpc-status-${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    createOrchestratorLogger(env).warn("confirmation-decision-wakeup-failed", {
      code: "internal-error",
      ctx: {
        tag: "confirmation-decision-wakeup-failed",
        session_uuid: session.session_uuid,
        confirmation_uuid: input.confirmationUuid,
        kind: input.kind,
        error: String(error),
      },
    });
    return { ok: false, reason: "agent-rpc-error" };
  }
}

export async function handleSessionConfirmation(
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
  if (!body) return jsonPolicyError(400, "invalid-input", "decision requires a JSON body", traceUuid);
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

  const decidedAt = new Date().toISOString();
  const result = await plane.applyDecision({
    session_uuid: route.sessionUuid,
    confirmation_uuid: route.confirmationUuid,
    status,
    decision_payload: decisionPayload,
    decided_at: decidedAt,
  });
  if (!result.row) return jsonPolicyError(404, "not-found", "confirmation not found", traceUuid);
  if (result.conflict) {
    return jsonPolicyError(
      409,
      "confirmation-already-resolved",
      "confirmation has already been resolved with a different status",
      traceUuid,
    );
  }
  emitFrameViaUserDO(
    env,
    {
      sessionUuid: route.sessionUuid,
      userUuid: session.actor_user_uuid,
      traceUuid,
    },
    "session.confirmation.update",
    {
      confirmation_uuid: route.confirmationUuid,
      status: result.row.status,
      ...(decisionPayload !== null ? { decision_payload: decisionPayload } : {}),
      decided_at: decidedAt,
    },
  );
  const wake = await wakeAgentConfirmationWaiter(env, session, {
    confirmationUuid: route.confirmationUuid,
    kind: result.row.kind,
    status: result.row.status,
    decisionPayload,
    traceUuid,
  });
  if (!wake.ok) {
    return jsonPolicyError(
      503,
      "internal-error",
      `confirmation decision committed but runtime wakeup failed: ${wake.reason}`,
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
