# Auth API

## Routes

| Route | Method | Auth | 说明 |
|------|--------|------|------|
| `/auth/register` | `POST` | no | 注册并返回 envelope |
| `/auth/login` | `POST` | no | 邮箱密码登录 |
| `/auth/refresh` | `POST` | no | 刷新 access token |
| `/auth/verify` | `POST` | optional bearer | 校验 token |
| `/auth/me` / `/me` | `GET` | bearer | 读取当前用户快照 |
| `/auth/password/reset` | `POST` | bearer | 修改密码 |

## Register

```http
POST /auth/register
content-type: application/json
x-trace-uuid: <uuid>

{
  "email": "user@example.com",
  "password": "password-123",
  "display_name": "Nano User"
}
```

## Login success shape

```json
{
  "ok": true,
  "data": {
    "tokens": {
      "access_token": "eyJ...",
      "refresh_token": "eyJ...",
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
    }
  }
}
```

## Error shape

```json
{
  "ok": false,
  "error": {
    "code": "invalid-credentials",
    "status": 401,
    "message": "invalid email or password"
  }
}
```

## JWT / salt / secret setup

仓库内只保留键名与非敏感默认值，真实 secret 不进 Git。

### Local development

在 `workers/orchestrator-auth/` 目录使用非提交式 `.dev.vars`：

```dotenv
PASSWORD_SALT=replace-with-long-random-salt
JWT_SIGNING_KID=v1
JWT_SIGNING_KEY_v1=replace-with-32-byte-or-longer-secret
WECHAT_APPID=wx-your-appid
WECHAT_SECRET=your-wechat-secret
```

### Cloudflare preview / production

```bash
cd workers/orchestrator-auth
npx wrangler secret put PASSWORD_SALT --env preview
npx wrangler secret put JWT_SIGNING_KEY_v1 --env preview
npx wrangler secret put WECHAT_APPID --env preview
npx wrangler secret put WECHAT_SECRET --env preview
```

如果后续轮换 JWT key：

1. 新增 `JWT_SIGNING_KEY_v2`
2. 将 `JWT_SIGNING_KID` 改为 `v2`
3. 重新部署 auth worker 与 orchestrator-core

`JWT_SECRET` 仍保留为 legacy fallback，但新接入应使用 `JWT_SIGNING_KEY_<kid>`。
