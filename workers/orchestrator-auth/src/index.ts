import {
  type LoginEnvelope,
  type MeEnvelope,
  type OrchestratorAuthRpcService,
  type RefreshEnvelope,
  type RegisterEnvelope,
  type ResetPasswordEnvelope,
  type VerifyApiKeyEnvelope,
  type VerifyTokenEnvelope,
  type WeChatLoginEnvelope,
} from "@haimang/orchestrator-auth-contract";
import { WorkerEntrypoint } from "cloudflare:workers";
import { AuthServiceError } from "./errors.js";
import { D1AuthRepository } from "./repository.js";
import { AuthService } from "./service.js";
import { createWeChatClient } from "./wechat.js";

export interface AuthWorkerEnv {
  readonly NANO_AGENT_DB?: D1Database;
  readonly PASSWORD_SALT?: string;
  readonly WECHAT_APPID?: string;
  readonly WECHAT_SECRET?: string;
  readonly WECHAT_API_BASE_URL?: string;
  readonly JWT_SECRET?: string;
  readonly JWT_SIGNING_KID?: string;
  readonly ENVIRONMENT?: string;
  readonly OWNER_TAG?: string;
  readonly [key: string]: unknown;
}

export interface AuthWorkerProbeResponse {
  readonly worker: "orchestrator-auth";
  readonly status: "ok";
  readonly public_business_routes: false;
  readonly rpc_surface: true;
  readonly d1_binding: boolean;
}

function createProbeResponse(env: AuthWorkerEnv): AuthWorkerProbeResponse {
  return {
    worker: "orchestrator-auth",
    status: "ok",
    public_business_routes: false,
    rpc_surface: true,
    d1_binding: Boolean(env.NANO_AGENT_DB),
  };
}

function createService(env: AuthWorkerEnv): AuthService {
  if (!env.NANO_AGENT_DB) {
    throw new AuthServiceError("worker-misconfigured", 503, "NANO_AGENT_DB must be configured");
  }
  return new AuthService({
    repo: new D1AuthRepository(env.NANO_AGENT_DB),
    keyEnv: env,
    passwordSalt: env.PASSWORD_SALT,
    wechatClient:
      env.WECHAT_APPID && env.WECHAT_SECRET ? createWeChatClient(env) : undefined,
    sourceName: "orchestrator.auth",
  });
}

async function invokeKnown<T>(
  env: AuthWorkerEnv,
  call: (service: AuthService) => Promise<T>,
): Promise<T> {
  try {
    return await call(createService(env));
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return error.toEnvelope<never>() as T;
    }
    throw error;
  }
}

export default class OrchestratorAuthEntrypoint
  extends WorkerEntrypoint<AuthWorkerEnv>
  implements OrchestratorAuthRpcService
{
  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (request.method.toUpperCase() === "GET" && (pathname === "/" || pathname === "/health")) {
      return Response.json(createProbeResponse(this.env));
    }
    return Response.json(
      {
        error: "not-found",
        message: "orchestrator.auth does not expose public business routes",
      },
      { status: 404 },
    );
  }

  async register(rawInput: unknown, rawMeta: unknown): Promise<RegisterEnvelope> {
    return invokeKnown(this.env, (service) => service.register(rawInput, rawMeta));
  }

  async login(rawInput: unknown, rawMeta: unknown): Promise<LoginEnvelope> {
    return invokeKnown(this.env, (service) => service.login(rawInput, rawMeta));
  }

  async refresh(rawInput: unknown, rawMeta: unknown): Promise<RefreshEnvelope> {
    return invokeKnown(this.env, (service) => service.refresh(rawInput, rawMeta));
  }

  async me(rawInput: unknown, rawMeta: unknown): Promise<MeEnvelope> {
    return invokeKnown(this.env, (service) => service.me(rawInput, rawMeta));
  }

  async verifyToken(rawInput: unknown, rawMeta: unknown): Promise<VerifyTokenEnvelope> {
    return invokeKnown(this.env, (service) => service.verifyToken(rawInput, rawMeta));
  }

  async resetPassword(rawInput: unknown, rawMeta: unknown): Promise<ResetPasswordEnvelope> {
    return invokeKnown(this.env, (service) => service.resetPassword(rawInput, rawMeta));
  }

  async wechatLogin(rawInput: unknown, rawMeta: unknown): Promise<WeChatLoginEnvelope> {
    return invokeKnown(this.env, (service) => service.wechatLogin(rawInput, rawMeta));
  }

  async verifyApiKey(rawInput: unknown, rawMeta: unknown): Promise<VerifyApiKeyEnvelope> {
    void rawInput;
    return invokeKnown(this.env, (service) => service.verifyApiKey(rawMeta));
  }
}
