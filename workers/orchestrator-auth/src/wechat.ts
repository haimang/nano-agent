import { AuthServiceError } from "./errors.js";

export interface WeChatSessionInfo {
  readonly openid: string;
  readonly session_key: string;
  readonly unionid?: string;
}

export interface WeChatDecryptedProfile {
  readonly openid?: string;
  readonly unionid?: string;
  readonly display_name?: string;
  readonly avatar_url?: string;
}

export interface WeChatClient {
  exchangeCode(code: string): Promise<WeChatSessionInfo>;
  decryptProfile(sessionKey: string, encryptedData: string, iv: string): Promise<WeChatDecryptedProfile>;
}

export interface WeChatEnv {
  readonly WECHAT_APPID?: string;
  readonly WECHAT_SECRET?: string;
  readonly WECHAT_API_BASE_URL?: string;
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
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
          if (typeof payload.session_key !== "string" || payload.session_key.length === 0) {
            throw new AuthServiceError(
              "invalid-wechat-code",
              400,
              "wechat response missing session_key",
            );
          }
          return {
            openid: payload.openid,
            session_key: payload.session_key,
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

    async decryptProfile(
      sessionKey: string,
      encryptedData: string,
      iv: string,
    ): Promise<WeChatDecryptedProfile> {
      try {
        const key = await crypto.subtle.importKey(
          "raw",
          decodeBase64(sessionKey),
          { name: "AES-CBC" },
          false,
          ["decrypt"],
        );
        const decrypted = await crypto.subtle.decrypt(
          {
            name: "AES-CBC",
            iv: decodeBase64(iv),
          },
          key,
          decodeBase64(encryptedData),
        );
        const payload = JSON.parse(new TextDecoder().decode(decrypted)) as Record<string, unknown>;
        const watermark = payload.watermark;
        const watermarkAppId =
          watermark && typeof watermark === "object" && !Array.isArray(watermark)
            ? (watermark as Record<string, unknown>).appid
            : undefined;
        const appid =
          typeof watermarkAppId === "string" ? watermarkAppId : undefined;
        if (typeof appid !== "string" || appid !== env.WECHAT_APPID) {
          throw new AuthServiceError(
            "invalid-wechat-payload",
            400,
            "wechat decrypt watermark appid mismatch",
          );
        }
        return {
          ...(typeof payload.openId === "string" && payload.openId.length > 0
            ? { openid: payload.openId }
            : {}),
          ...(typeof payload.unionId === "string" && payload.unionId.length > 0
            ? { unionid: payload.unionId }
            : {}),
          ...(typeof payload.nickName === "string" && payload.nickName.trim().length > 0
            ? { display_name: payload.nickName.trim().slice(0, 80) }
            : {}),
          ...(typeof payload.avatarUrl === "string" && payload.avatarUrl.length > 0
            ? { avatar_url: payload.avatarUrl }
            : {}),
        };
      } catch (error) {
        if (error instanceof AuthServiceError) throw error;
        throw new AuthServiceError(
          "invalid-wechat-payload",
          400,
          "wechat encrypted payload could not be decrypted",
        );
      }
    },
  };
}
