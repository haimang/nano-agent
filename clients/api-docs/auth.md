# Auth API — hero-to-pro Frozen Pack

> Public facade owner: `orchestrator-core`
> Profile: `facade-http-v1`
> Backend: `orchestrator-auth` RPC through service binding

## Routes

| Route | Method | Auth | 说明 |
|-------|--------|------|------|
| `/auth/register` | `POST` | none | email/password 注册 |
| `/auth/login` | `POST` | none | email/password 登录 |
| `/auth/refresh` | `POST` | none | refresh token 换新 token |
| `/auth/verify` | `POST` | bearer | 校验 access token |
| `/auth/me` | `GET`/`POST` | bearer | 当前用户视图 |
| `/me` | `GET`/`POST` | bearer | `/auth/me` alias |
| `/auth/password/reset` | `POST` | bearer | 修改密码 |
| `/auth/wechat/login` | `POST` | none | 微信登录，详见 [`wechat-auth.md`](./wechat-auth.md) |
| `/auth/api-keys/revoke` | `POST` | bearer | 撤销当前 team 下的 `nak_` API key |

## Common Envelope

Success:

```json
{ "ok": true, "data": { "...": "..." }, "trace_uuid": "11111111-1111-4111-8111-111111111111" }
```

Error:

```json
{
  "ok": false,
  "error": { "code": "invalid-auth", "status": 401, "message": "token missing, invalid, or expired" },
  "trace_uuid": "11111111-1111-4111-8111-111111111111"
}
```

## Request Notes

| 规则 | 说明 |
|------|------|
| `x-trace-uuid` | 建议所有 auth 请求都传；未传时 auth proxy 会生成一个 trace。 |
| Device metadata | `register/login/wechatLogin` 会透传 `x-device-uuid`、`x-device-label`、`x-device-kind` 到 auth worker；小程序端建议提供稳定 device UUID。 |
| Bearer | `/auth/verify`、`/auth/me`、`/me`、`/auth/password/reset`、`/auth/api-keys/revoke` 从 `Authorization` header 取 access token。 |
| `POST /auth/verify` body | body 可为空；facade 不从 body 读取 `access_token`。 |

## Shared Objects

### `AuthFlowResult`

`register` / `login` / `refresh` / `wechat login` 成功时返回：

```json
{
  "tokens": {
    "access_token": "jwt",
    "refresh_token": "opaque-refresh-token",
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
    "team_name": "Nano User's Team",
    "team_slug": "nano-user-ab12cd",
    "membership_level": 100,
    "plan_level": 0
  },
  "snapshot": {
    "sub": "11111111-1111-4111-8111-111111111111",
    "user_uuid": "11111111-1111-4111-8111-111111111111",
    "team_uuid": "22222222-2222-4222-8222-222222222222",
    "tenant_uuid": "22222222-2222-4222-8222-222222222222",
    "device_uuid": "33333333-3333-4333-8333-333333333333",
    "tenant_source": "claim",
    "membership_level": 100,
    "source_name": "orchestrator.auth",
    "exp": 1760000000
  }
}
```

### `AuthView`

`/auth/me` / `/me` 返回 `{user, team, snapshot}`，字段与 `AuthFlowResult` 中同名字段一致。

### `VerifyTokenResult`

`/auth/verify` 返回 `AuthView + {valid:true}`。

### `ResetPasswordResult`

`/auth/password/reset` 返回 `AuthView + {password_reset:true}`。

## `POST /auth/register`

Request:

```json
{ "email": "user@example.com", "password": "secure-password", "display_name": "Nano User" }
```

| 字段 | 必填 | 规则 |
|------|------|------|
| `email` | yes | valid email |
| `password` | yes | min 8 |
| `display_name` | no | 1-80 chars |

Stable errors: `identity-already-exists`(409), `worker-misconfigured`(503), `invalid-auth-body`(400).

## `POST /auth/login`

Request:

```json
{ "email": "user@example.com", "password": "secure-password" }
```

Stable errors: `password-mismatch`(401), `identity-not-found`(404), `worker-misconfigured`(503), `invalid-auth-body`(400).

## `POST /auth/refresh`

Request:

```json
{ "refresh_token": "opaque-refresh-token" }
```

Stable errors: `refresh-invalid`(401), `refresh-revoked`(401), `refresh-expired`(401), `identity-not-found`(404), `worker-misconfigured`(503).

## `POST /auth/verify`

Request:

```http
POST /auth/verify
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
Content-Type: application/json

{}
```

Stable errors: `invalid-auth`(401), `identity-not-found`(404), `worker-misconfigured`(503).

## `GET /auth/me` / `GET /me`

Request:

```http
GET /me
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
```

`POST /auth/me` 和 `POST /me` 仍可用，body 会被忽略；客户端优先使用 `GET`。

## `POST /auth/password/reset`

Request:

```json
{ "old_password": "old-password", "new_password": "new-secure-password" }
```

Stable errors: `invalid-auth`(401), `password-mismatch`(401), `identity-not-found`(404), `worker-misconfigured`(503).

## `POST /auth/api-keys/revoke`

撤销当前 authenticated user 在当前 team 下的 `nak_` API key。`team_uuid` 与 `user_uuid` 由 facade 从 bearer snapshot 注入，客户端只传 `key_id`。

Request:

```http
POST /auth/api-keys/revoke
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
Content-Type: application/json

{ "key_id": "nak_..." }
```

Success:

```json
{
  "ok": true,
  "data": {
    "key_id": "nak_...",
    "team_uuid": "22222222-2222-4222-8222-222222222222",
    "revoked_at": "2026-04-30T00:00:00.000Z"
  },
  "trace_uuid": "..."
}
```

Stable errors: `invalid-auth`(401), `missing-team-claim`(403), `not-found`(404), `permission-denied`(403), `worker-misconfigured`(503).

## Auth Mechanism

- Access token 是 HMAC HS256 JWT，默认 1 小时有效期，支持 `kid` keyring。
- Refresh token 是 opaque string，默认 30 天有效期，D1 `nano_auth_sessions` 持久化。
- `snapshot.team_uuid` 与 `snapshot.tenant_uuid` 当前等价；内部 NACP authority 继续使用 team/tenant 双头校验。
- `membership_level >= 100` 表示 team owner，用于 `/me/team PATCH`、`/debug/audit` 等 owner gate。
