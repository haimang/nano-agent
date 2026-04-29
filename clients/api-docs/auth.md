# Auth API — ZX5 Snapshot

> Public facade owner: `orchestrator-core`
> Profile: `facade-http-v1`
> Backend: proxy to `orchestrator-auth` via RPC service binding
> Header: `x-trace-uuid: <uuid>`（建议全部路由显式携带）

---

## Route Overview

| Route | Method | Auth | 说明 |
|-------|--------|------|------|
| `/auth/register` | `POST` | none | email/password 注册 → tokens + user + team + snapshot |
| `/auth/login` | `POST` | none | email/password 登录 → tokens + user + team + snapshot |
| `/auth/refresh` | `POST` | none (refresh token in body) | 刷新 access token + refresh token |
| `/auth/verify` | `POST` | bearer | 校验 access token 有效性，返回 `valid:true + AuthView` |
| `/auth/me` | `GET` `POST` | bearer | 读取当前用户视图 |
| `/me` | `GET` `POST` | bearer | `/auth/me` 别名 |
| `/auth/password/reset` | `POST` | bearer | 修改密码 |
| `/auth/wechat/login` | `POST` | none | 微信小程序登录（见 `wechat-auth.md`） |

---

## Common Envelope

所有 auth 路由使用统一 facade envelope：

**Success**
```json
{
  "ok": true,
  "data": { "...": "..." },
  "trace_uuid": "11111111-1111-4111-8111-111111111111"
}
```

**Error**
```json
{
  "ok": false,
  "error": {
    "code": "invalid-auth",
    "status": 401,
    "message": "token missing, invalid, or expired"
  },
  "trace_uuid": "11111111-1111-4111-8111-111111111111"
}
```

---

## Shared Response Objects

### `AuthFlowResult` — register / login / refresh / wechat login 共用

```json
{
  "tokens": {
    "access_token": "eyJhbGciOiJIUzI1NiIsImtpZCI6InYxIn0...",
    "refresh_token": "opaque-refresh-token-string",
    "expires_in": 3600,
    "refresh_expires_in": 2592000,
    "kid": "v1"
  },
  "user": {
    "user_uuid": "11111111-1111-4111-8111-111111111111",
    "display_name": "Nano User",
    "identity_provider": "email_password",
    "login_identifier": "user@example.com"
  },
  "team": {
    "team_uuid": "22222222-2222-4222-8222-222222222222",
    "membership_level": 100,
    "plan_level": 0
  },
  "snapshot": {
    "sub": "11111111-1111-4111-8111-111111111111",
    "user_uuid": "11111111-1111-4111-8111-111111111111",
    "team_uuid": "22222222-2222-4222-8222-222222222222",
    "tenant_uuid": "22222222-2222-4222-8222-222222222222",
    "tenant_source": "claim",
    "membership_level": 100,
    "source_name": "orchestrator.auth",
    "exp": 1760000000
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `tokens.access_token` | string | HMAC HS256 JWT，默认 1 小时有效期 |
| `tokens.refresh_token` | string | opaque refresh token，默认 30 天有效期 |
| `tokens.expires_in` | number | access token 有效期（秒） |
| `tokens.refresh_expires_in` | number | refresh token 有效期（秒） |
| `tokens.kid` | string | JWT key ID |
| `user.user_uuid` | string | 用户 UUID |
| `user.display_name` | string\|null | 显示名称；register 缺省时会从 email 推导 |
| `user.identity_provider` | string | `"email_password"` 或 `"wechat"` |
| `user.login_identifier` | string\|null | email 或 wechat openid |
| `team.team_uuid` | string | 租户 UUID |
| `team.membership_level` | number | 成员级别 |
| `team.plan_level` | number | 计划级别 |
| `snapshot` | object | 后续 session 请求使用的 auth snapshot |

### `AuthView` — `/auth/me` / `/me` 共用

```json
{
  "user": { "user_uuid": "...", "display_name": "...", "identity_provider": "...", "login_identifier": "..." },
  "team": { "team_uuid": "...", "membership_level": 100, "plan_level": 0 },
  "snapshot": { "sub": "...", "user_uuid": "...", "team_uuid": "...", "tenant_uuid": "...", "tenant_source": "claim", "membership_level": 100, "source_name": "orchestrator.auth", "exp": 1760000000 }
}
```

### `VerifyTokenResult` — `/auth/verify`

```json
{
  "valid": true,
  "user": { "user_uuid": "...", "display_name": "...", "identity_provider": "...", "login_identifier": "..." },
  "team": { "team_uuid": "...", "membership_level": 100, "plan_level": 0 },
  "snapshot": { "sub": "...", "user_uuid": "...", "team_uuid": "...", "tenant_uuid": "...", "tenant_source": "claim", "membership_level": 100, "source_name": "orchestrator.auth", "exp": 1760000000 }
}
```

### `ResetPasswordResult` — `/auth/password/reset`

```json
{
  "password_reset": true,
  "user": { "user_uuid": "...", "display_name": "...", "identity_provider": "...", "login_identifier": "..." },
  "team": { "team_uuid": "...", "membership_level": 100, "plan_level": 0 },
  "snapshot": { "sub": "...", "user_uuid": "...", "team_uuid": "...", "tenant_uuid": "...", "tenant_source": "claim", "membership_level": 100, "source_name": "orchestrator.auth", "exp": 1760000000 }
}
```

---

## `POST /auth/register`

### Request
```http
POST /auth/register HTTP/1.1
x-trace-uuid: <uuid>
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secure-password",
  "display_name": "Nano User"
}
```

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `email` | ✅ | string (email) | 注册邮箱 |
| `password` | ✅ | string (min 8) | 密码 |
| `display_name` | no | string | 显示名称 |

### Success (200) — `AuthFlowResult`

### Stable Runtime Errors
| HTTP | error.code | 说明 |
|------|-----------|------|
| 409 | `identity-already-exists` | email 已被占用 |
| 503 | `worker-misconfigured` | 缺 D1 / salt / JWT 配置，或当前 wrapper 将 parser 错误归并为 503 |

---

## `POST /auth/login`

### Request
```http
POST /auth/login HTTP/1.1
x-trace-uuid: <uuid>
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secure-password"
}
```

### Success (200) — `AuthFlowResult`

### Stable Runtime Errors
| HTTP | error.code | 说明 |
|------|-----------|------|
| 401 | `password-mismatch` | 密码不匹配 |
| 404 | `identity-not-found` | email identity 不存在 |
| 503 | `worker-misconfigured` | 缺 D1 / salt / JWT 配置，或当前 wrapper 将 parser 错误归并为 503 |

---

## `POST /auth/refresh`

### Request
```http
POST /auth/refresh HTTP/1.1
x-trace-uuid: <uuid>
Content-Type: application/json

{
  "refresh_token": "opaque-refresh-token-string"
}
```

### Success (200) — `AuthFlowResult`

### Stable Runtime Errors
| HTTP | error.code | 说明 |
|------|-----------|------|
| 401 | `refresh-invalid` | refresh token 未找到 |
| 401 | `refresh-revoked` | refresh token 已被撤销 |
| 401 | `refresh-expired` | refresh token 已过期 |
| 404 | `identity-not-found` | user/team context 不存在 |
| 503 | `worker-misconfigured` | 缺 D1 / salt / JWT 配置，或当前 wrapper 将 parser 错误归并为 503 |

---

## `POST /auth/verify`

> 当前 facade **只从 `Authorization: Bearer <access_token>` header 取 token**，不会从请求 body 读取 `access_token`。

### Request
```http
POST /auth/verify HTTP/1.1
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
Content-Type: application/json

{}
```

### Success (200)
```json
{
  "ok": true,
  "data": {
    "valid": true,
    "user": { "user_uuid": "...", "display_name": "...", "identity_provider": "...", "login_identifier": "..." },
    "team": { "team_uuid": "...", "membership_level": 100, "plan_level": 0 },
    "snapshot": { "sub": "...", "user_uuid": "...", "team_uuid": "...", "tenant_uuid": "...", "tenant_source": "claim", "membership_level": 100, "source_name": "orchestrator.auth", "exp": 1760000000 }
  },
  "trace_uuid": "..."
}
```

### Stable Runtime Errors
| HTTP | error.code | 说明 |
|------|-----------|------|
| 401 | `invalid-auth` | token 缺失、格式错误、签名失败、过期、缺 team truth |
| 404 | `identity-not-found` | token 合法但 user/team context 不存在 |
| 503 | `worker-misconfigured` | 当前 wrapper 将 parser 错误归并为 503 |

---

## `GET /auth/me` / `GET /me`

### Request
```http
GET /auth/me HTTP/1.1
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
```

### Success (200) — `AuthView`

### Stable Runtime Errors
| HTTP | error.code | 说明 |
|------|-----------|------|
| 401 | `invalid-auth` | token 缺失、格式错误、签名失败、过期、缺 team truth |
| 404 | `identity-not-found` | user/team context 不存在 |
| 503 | `worker-misconfigured` | 配置缺失或 wrapper 异常归并 |

> `POST /auth/me` 与 `POST /me` 也可用，但 body 当前会被忽略；推荐优先使用 GET。

---

## `POST /auth/password/reset`

### Request
```http
POST /auth/password/reset HTTP/1.1
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
Content-Type: application/json

{
  "old_password": "old-password",
  "new_password": "new-secure-password"
}
```

### Success (200)
```json
{
  "ok": true,
  "data": {
    "password_reset": true,
    "user": { "user_uuid": "...", "display_name": "...", "identity_provider": "...", "login_identifier": "..." },
    "team": { "team_uuid": "...", "membership_level": 100, "plan_level": 0 },
    "snapshot": { "sub": "...", "user_uuid": "...", "team_uuid": "...", "tenant_uuid": "...", "tenant_source": "claim", "membership_level": 100, "source_name": "orchestrator.auth", "exp": 1760000000 }
  },
  "trace_uuid": "..."
}
```

### Stable Runtime Errors
| HTTP | error.code | 说明 |
|------|-----------|------|
| 401 | `invalid-auth` | bearer token 无效 |
| 401 | `password-mismatch` | old password 不匹配 |
| 404 | `identity-not-found` | user/team 或 password identity 不存在 |
| 503 | `worker-misconfigured` | 配置缺失或 wrapper 异常归并 |

---

## Common Auth Error Notes

| code | 当前 public route 是否稳定暴露 | 说明 |
|------|------------------------------|------|
| `invalid-auth` | yes | `/auth/verify`、`/auth/me`、`/auth/password/reset` 的主要 401 |
| `identity-already-exists` | yes | register 冲突 |
| `identity-not-found` | yes | login / refresh / me / verify / reset 可能出现 |
| `password-mismatch` | yes | login / reset |
| `refresh-invalid` | yes | refresh token 不存在 |
| `refresh-expired` | yes | refresh token 已过期 |
| `refresh-revoked` | yes | refresh token 已撤销 |
| `worker-misconfigured` | yes | 缺 D1 / salt / JWT / WeChat 配置；当前 wrapper 也会把很多 parser/Zod 错误折叠到这里 |
| `invalid-request` | no（对 public clients 不稳定） | contract 中存在，但当前 public facade 很少稳定暴露给客户端 |

---

## Auth Mechanism

- **JWT**: HMAC HS256，默认 1 小时有效期
- **Refresh token**: opaque string，默认 30 天有效期，D1 `nano_auth_sessions` 表存储
- **Kid rotation**: 使用 `JWT_SIGNING_KID` + keyring 做签发 / 验签
- **鉴权入口**: `orchestrator-core` 会验证 JWT，提取 `AuthSnapshot`（`sub/user_uuid/team_uuid/tenant_uuid/membership_level/source_name/exp`），再注入 session 请求
- **Tenant guard**: session 路由要求 JWT 含 `team_uuid` 或 `tenant_uuid` claim
