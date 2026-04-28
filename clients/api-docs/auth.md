# Auth API

> Public facade owner: `orchestrator-core`
> Profile: `facade-http-v1`

## Base URLs

| 环境 | Base URL |
|---|---|
| preview | `https://nano-agent-orchestrator-core-preview.haimang.workers.dev` |
| production | `https://nano-agent-orchestrator-core.haimang.workers.dev` |

## Routes

| Route | Method | Auth | 说明 |
|---|---|---|---|
| `/auth/register` | `POST` | no | 注册并直接返回 tokens + user/team/snapshot |
| `/auth/login` | `POST` | no | 邮箱密码登录 |
| `/auth/refresh` | `POST` | no | 刷新 access token / rotate refresh token |
| `/auth/verify` | `POST` | bearer recommended | 校验 access token 是否有效 |
| `/auth/me` | `GET` / `POST` | bearer | 读取当前用户视图 |
| `/me` | `GET` / `POST` | bearer | `/auth/me` 的兼容别名 |
| `/auth/password/reset` | `POST` | bearer | 修改密码 |

## Common success envelope

所有 auth 路由都返回标准 facade success envelope：

```json
{
  "ok": true,
  "data": {},
  "trace_uuid": "11111111-1111-4111-8111-111111111111"
}
```

所有失败都返回 facade error envelope：

```json
{
  "ok": false,
  "error": {
    "code": "password-mismatch",
    "status": 401,
    "message": "password mismatch"
  },
  "trace_uuid": "11111111-1111-4111-8111-111111111111"
}
```

## Shared response objects

### `AuthFlowResult`

`register` / `login` / `refresh` 共用：

```json
{
  "tokens": {
    "access_token": "eyJ...",
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
    "exp": 1760000000
  }
}
```

### `AuthView`

`/auth/me` / `/me` 共用：

```json
{
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
    "exp": 1760000000
  }
}
```

## `POST /auth/register`

```http
POST /auth/register
content-type: application/json
x-trace-uuid: 11111111-1111-4111-8111-111111111111

{
  "email": "user@example.com",
  "password": "password-123",
  "display_name": "Nano User"
}
```

### Success

返回 facade success envelope，`data` 完整符合上面的 `AuthFlowResult`。

### Common errors

| HTTP | `error.code` | 触发 |
|---|---|---|
| 400 | `invalid-request` | body 不通过 schema 校验 |
| 409 | `identity-already-exists` | 邮箱已注册 |
| 503 | `worker-misconfigured` | 缺数据库 / salt / key 配置 |

## `POST /auth/login`

```http
POST /auth/login
content-type: application/json
x-trace-uuid: 11111111-1111-4111-8111-111111111111

{
  "email": "user@example.com",
  "password": "password-123"
}
```

### Success

和 `register` 相同，返回 facade success envelope，`data` 完整符合 `AuthFlowResult`。

### Common errors

| HTTP | `error.code` | 触发 |
|---|---|---|
| 400 | `invalid-request` | body 不通过 schema 校验 |
| 404 | `identity-not-found` | 邮箱不存在 |
| 401 | `password-mismatch` | 密码错误 |
| 503 | `worker-misconfigured` | 缺数据库 / salt / key 配置 |

## `POST /auth/refresh`

```http
POST /auth/refresh
content-type: application/json
x-trace-uuid: 11111111-1111-4111-8111-111111111111

{
  "refresh_token": "opaque-refresh-token"
}
```

### Success

返回新的 `AuthFlowResult`。`refresh_token` 会被轮换，旧 token 再用会返回 `refresh-revoked`。

### Common errors

| HTTP | `error.code` | 触发 |
|---|---|---|
| 400 | `invalid-request` | body 不通过 schema 校验 |
| 401 | `refresh-invalid` | refresh token 不存在 |
| 401 | `refresh-revoked` | refresh token 已轮换或撤销 |
| 401 | `refresh-expired` | refresh token 已过期 |
| 404 | `identity-not-found` | token 指向的 user/team 不存在 |

## `POST /auth/verify`

```http
POST /auth/verify
authorization: Bearer <access_token>
x-trace-uuid: 11111111-1111-4111-8111-111111111111
```

> 当前 facade 从 bearer 头读取 token；推荐不再额外传 body。

### Success

返回 facade success envelope，`data` 形状为 `{ valid: true, ...AuthView }`。

## `GET /auth/me` / `GET /me`

```http
GET /auth/me
authorization: Bearer <access_token>
x-trace-uuid: 11111111-1111-4111-8111-111111111111
```

### Success

返回 facade success envelope，`data` 完整符合上面的 `AuthView`。

## `POST /auth/password/reset`

```http
POST /auth/password/reset
authorization: Bearer <access_token>
content-type: application/json
x-trace-uuid: 11111111-1111-4111-8111-111111111111

{
  "old_password": "password-123",
  "new_password": "password-456"
}
```

### Success

返回 facade success envelope，`data` 形状为 `{ password_reset: true, ...AuthView }`。

### Common errors

| HTTP | `error.code` | 触发 |
|---|---|---|
| 400 | `invalid-request` | body 不通过 schema 校验 |
| 401 | `invalid-auth` | bearer 缺失或无效 |
| 401 | `password-mismatch` | `old_password` 错误 |
| 404 | `identity-not-found` | 当前 token 对应的密码身份不存在 |
