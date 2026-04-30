import {
  type CreateApiKeyEnvelope,
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
import { NANO_PACKAGE_MANIFEST } from "./generated/package-manifest.js";
import { AuthServiceError } from "./errors.js";
import { handlePublicRequest, type AuthWorkerProbeResponse } from "./public-surface.js";
import { D1AuthRepository } from "./repository.js";
import { AuthService } from "./service.js";
import { createWeChatClient } from "./wechat.js";

void NANO_PACKAGE_MANIFEST;

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
  readonly WORKER_VERSION?: string;
  readonly [key: string]: unknown;
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
    // Wrap unexpected errors (D1, crypto, Zod parse) into an internal-error
    // envelope so the RPC caller always receives a typed AuthEnvelope, not a
    // raw thrown exception that bypasses the auth envelope contract.
    const wrapped = new AuthServiceError(
      "worker-misconfigured",
      503,
      error instanceof Error ? error.message : "internal error",
    );
    return wrapped.toEnvelope<never>() as T;
  }
}

export default class OrchestratorAuthEntrypoint
  extends WorkerEntrypoint<AuthWorkerEnv>
  implements OrchestratorAuthRpcService
{
  async fetch(request: Request): Promise<Response> {
    return handlePublicRequest(request, this.env);
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
    return invokeKnown(this.env, (service) => service.verifyApiKey(rawInput, rawMeta));
  }

  async createApiKey(rawInput: unknown, rawMeta: unknown): Promise<CreateApiKeyEnvelope> {
    return invokeKnown(this.env, (service) => service.createApiKey(rawInput, rawMeta));
  }
}
