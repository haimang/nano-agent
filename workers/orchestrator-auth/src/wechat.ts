import { AuthServiceError } from "./errors.js";

export interface WeChatSessionInfo {
  readonly openid: string;
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
      const response = await fetch(url, { method: "GET" });
      if (!response.ok) {
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
      return { openid: payload.openid };
    },
  };
}
