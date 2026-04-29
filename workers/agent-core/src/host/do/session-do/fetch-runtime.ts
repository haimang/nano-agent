import { routeRequest } from "../../routes.js";
import type { RouteResult } from "../../routes.js";
import { validateInternalAuthority } from "../../internal-policy.js";
import type { RuntimeConfig, SessionRuntimeEnv } from "../../env.js";
import type { HttpController } from "../../http-controller.js";
import type { OrchestrationState } from "../../orchestration.js";
import type { SessionWebSocketHelper } from "@haimang/nacp-session";

export interface SessionDoFetchRuntimeContext {
  readonly env: unknown;
  readonly config: RuntimeConfig;
  readonly httpController: HttpController;
  readonly streamUuid: string;
  getState(): OrchestrationState;
  getWsHelper(): SessionWebSocketHelper | null;
  getTraceUuid(): string | null;
  setTraceUuid(value: string): void;
  attachTeamUuid(candidate: string | undefined | null): void;
  attachUserUuid(candidate: string | undefined | null): void;
  attachSessionUuid(candidate: string | undefined | null): void;
  handleWebSocketUpgrade(sessionId: string): Promise<Response>;
  webSocketMessage(ws: unknown, raw: string | ArrayBuffer): Promise<void>;
  runPreviewVerification(
    sessionId: string,
    request: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  handlePermissionDecisionRecord(sessionId: string, body: unknown): Promise<Response>;
  handleElicitationAnswerRecord(sessionId: string, body: unknown): Promise<Response>;
}

export function createSessionDoFetchRuntime(ctx: SessionDoFetchRuntimeContext) {
  return {
    async fetch(request: Request): Promise<Response> {
      const route: RouteResult = routeRequest(request);
      const isInternalDoRequest = new URL(request.url).hostname === "session.internal";
      const validatedInternal = isInternalDoRequest
        ? await validateInternalAuthority(
            request,
            ctx.env as Pick<
              SessionRuntimeEnv,
              "NANO_INTERNAL_BINDING_SECRET" | "TEAM_UUID" | "ENVIRONMENT"
            >,
          )
        : null;
      if (validatedInternal && !validatedInternal.ok) return validatedInternal.response;
      if (validatedInternal?.ok) {
        ctx.attachTeamUuid(validatedInternal.authority.tenant_uuid);
        ctx.attachUserUuid(validatedInternal.authority.sub);
        if (!ctx.getTraceUuid() && validatedInternal.traceUuid.length > 0) {
          ctx.setTraceUuid(validatedInternal.traceUuid);
        }
      }

      switch (route.type) {
        case "websocket":
          ctx.attachSessionUuid(route.sessionId);
          return ctx.handleWebSocketUpgrade(route.sessionId);

        case "http-fallback": {
          if (!ctx.config.httpFallbackEnabled) {
            return new Response(
              JSON.stringify({ error: "HTTP fallback disabled" }),
              { status: 403, headers: { "Content-Type": "application/json" } },
            );
          }
          ctx.attachSessionUuid(route.sessionId);

          ctx.httpController.attachHost({
            submitFrame: (raw) => ctx.webSocketMessage(null, raw),
            getPhase: () => ctx.getState().actorState.phase,
            readTimeline: () => {
              const helper = ctx.getWsHelper();
              if (!helper) return [];
              const frames = helper.replay.replay(ctx.streamUuid, 0);
              return frames.map((frame) => frame.body as Record<string, unknown>);
            },
            getTraceUuid: () => {
              const traceUuid = ctx.getTraceUuid();
              if (traceUuid) return traceUuid;
              const nextTraceUuid = crypto.randomUUID();
              ctx.setTraceUuid(nextTraceUuid);
              return nextTraceUuid;
            },
            runVerification: (sessionId, body) =>
              ctx.runPreviewVerification(sessionId, body),
          });

          let body: unknown = validatedInternal?.ok ? validatedInternal.bodyJson ?? undefined : undefined;
          if (
            body === undefined &&
            (request.method === "POST" ||
              request.method === "PUT" ||
              request.method === "PATCH")
          ) {
            try {
              body = await request.json();
            } catch {
              body = undefined;
            }
          }
          if (route.action === "permission-decision") {
            return ctx.handlePermissionDecisionRecord(route.sessionId, body);
          }
          if (route.action === "elicitation-answer") {
            return ctx.handleElicitationAnswerRecord(route.sessionId, body);
          }
          const result = await ctx.httpController.handleRequest(
            route.sessionId,
            route.action,
            body,
          );
          return new Response(JSON.stringify(result.body), {
            status: result.status,
            headers: { "Content-Type": "application/json" },
          });
        }

        case "not-found":
        default:
          return new Response(
            JSON.stringify({ error: "Not found" }),
            { status: 404, headers: { "Content-Type": "application/json" } },
          );
      }
    },
  };
}
