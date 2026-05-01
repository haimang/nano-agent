# WeChat Auth API — hero-to-pro Frozen Pack

> Public facade owner: `orchestrator-core`
> Profile: `facade-http-v1`
> 后端: proxy to `orchestrator-auth` → WeChat `jscode2session` API
> Optional device headers: `x-device-uuid`, `x-device-label`, `x-device-kind`

---

## Route

| Route | Method | Auth |
|-------|--------|------|
| `/auth/wechat/login` | `POST` | none |

---

## `POST /auth/wechat/login`

### Request
```http
POST /auth/wechat/login HTTP/1.1
x-trace-uuid: <uuid>
Content-Type: application/json

{
  "code": "wx-auth-code-from-wx.login()",
  "encrypted_data": "optional-encrypted-data",
  "iv": "optional-iv",
  "display_name": "WeChat User"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `code` | ✅ | 微信 `wx.login()` 返回的临时 auth code |
| `encrypted_data` | no | 微信加密 profile（需与 `iv` 配对） |
| `iv` | no | 解密向量（需与 `encrypted_data` 配对） |
| `display_name` | no | fallback 显示名称 |

### Field Policy

- `encrypted_data` + `iv`：必须同时提供或同时省略
- `display_name`：仅作为 fallback；若解密成功，优先使用解密后的昵称

### Success (200) — `AuthFlowResult`

返回与 `register` / `login` / `refresh` 相同的 `AuthFlowResult` 形状：

```json
{
  "ok": true,
  "data": {
    "tokens": {
      "access_token": "eyJ...",
      "refresh_token": "opaque-token",
      "expires_in": 3600,
      "refresh_expires_in": 2592000,
      "kid": "v1"
    },
    "user": {
      "user_uuid": "...",
      "display_name": "WeChat User",
      "identity_provider": "wechat",
      "login_identifier": "oxxx..."
    },
    "team": {
      "team_uuid": "...",
      "membership_level": 100,
      "plan_level": 0
    },
    "snapshot": {
      "sub": "...",
      "user_uuid": "...",
      "team_uuid": "...",
      "tenant_uuid": "...",
      "tenant_source": "claim",
      "membership_level": 100,
      "source_name": "orchestrator.auth",
      "exp": 1760000000
    }
  },
  "trace_uuid": "..."
}
```

### Server-Side Flow

1. `code` → WeChat `jscode2session` API → 获取 `openid` + `session_key`
2. 若有 `encrypted_data` + `iv` → 解密用户 profile
3. 校验 decrypted openid 与 `jscode2session` openid 一致
4. 查找 / 创建 identity（provider=`wechat`）
5. Bootstrap 或复用 user + team
6. 签发 access token + refresh token
7. 若提供 device headers，会写入/更新 device truth，后续 device revoke 会影响 auth gate 和 WS attach。

### Stable Runtime Errors

| HTTP | error.code | 触发 |
|------|-----------|------|
| 400 / 502 / 504 | `invalid-wechat-code` | code 无效、WeChat 响应异常、上游超时 |
| 400 | `invalid-wechat-payload` | encrypted payload 解密失败、watermark appid 不匹配、openid 不一致 |
| 503 | `worker-misconfigured` | 缺 WeChat / D1 / JWT / salt 配置，或当前 wrapper 将 parser 错误归并为 503 |

---

## Environment Configuration (server-side)

| Env Var | 说明 |
|---------|------|
| `WECHAT_APPID` | 微信小程序 AppID |
| `WECHAT_SECRET` | 微信小程序 AppSecret |
| `WECHAT_API_BASE_URL` | WeChat API base（默认 `https://api.weixin.qq.com/sns/jscode2session`） |

---

## Auth Mechanism

WeChat login 使用 `identity_provider: "wechat"`，`login_identifier` 为 openid。返回的 JWT 与 email/password 登录返回的 JWT 等价，可用于所有 `Authorization: Bearer` 鉴权路由。
