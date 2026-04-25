import { AuthServiceError } from "./errors.js";

export interface WeChatSessionInfo {
  readonly openid: string;
  readonly unionid?: string;
}

export interface WeChatClient {
  exchangeCode(code: string): Promise<WeChatSessionInfo>;
}

export interface WeChatEnv {
  readonly WECHAT_APPID?: string;
  readonly WECHAT_SECRET?: string;
  readonly WECHAT_API_BASE_URL?: string;
}

export function createWeChatClient(env: WeChatEnv): WeChatClient {
  return {
    async exchangeCode(code: string): Promise<WeChatSessionInfo> {
      if (!env.WECHAT_APPID || !env.WECHAT_SECRET) {
        throw new AuthServiceError(
          "worker-misconfigured",
          503,
          "WECHAT_APPID and WECHAT_SECRET must be configured",
        );
      }
      const url = new URL(
        env.WECHAT_API_BASE_URL ?? "https://api.weixin.qq.com/sns/jscode2session",
      );
      url.searchParams.set("appid", env.WECHAT_APPID);
      url.searchParams.set("secret", env.WECHAT_SECRET);
      url.searchParams.set("js_code", code);
      url.searchParams.set("grant_type", "authorization_code");
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(url, {
            method: "GET",
            signal: AbortSignal.timeout(5_000),
          });
          if (!response.ok) {
            if (attempt === 0 && response.status >= 500) continue;
            throw new AuthServiceError(
              "invalid-wechat-code",
              502,
              `wechat jscode2session failed with ${response.status}`,
            );
          }
          const payload = (await response.json()) as Record<string, unknown>;
          if (typeof payload.openid !== "string" || payload.openid.length === 0) {
            throw new AuthServiceError("invalid-wechat-code", 400, "wechat response missing openid");
          }
          return {
            openid: payload.openid,
            ...(typeof payload.unionid === "string" && payload.unionid.length > 0
              ? { unionid: payload.unionid }
              : {}),
          };
        } catch (error) {
          if (error instanceof AuthServiceError) throw error;
          const retryableTimeout =
            error instanceof Error &&
            (error.name === "AbortError" || error.name === "TimeoutError");
          if (attempt === 0 && retryableTimeout) continue;
          if (
            error instanceof Error &&
            (error.name === "AbortError" || error.name === "TimeoutError")
          ) {
            throw new AuthServiceError("invalid-wechat-code", 504, "wechat jscode2session timed out");
          }
          throw new AuthServiceError("invalid-wechat-code", 502, "wechat jscode2session request failed");
        }
      }
      throw new AuthServiceError("invalid-wechat-code", 502, "wechat jscode2session request failed");
    },
  };
}
