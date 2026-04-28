# WeChat auth API

> Public facade owner: `orchestrator-core`
> Profile: `facade-http-v1`

## Base URLs

| 环境 | Base URL |
|---|---|
| preview | `https://nano-agent-orchestrator-core-preview.haimang.workers.dev` |
| production | `https://nano-agent-orchestrator-core.haimang.workers.dev` |

## Route

| Route | Method | Auth |
|---|---|---|
| `/auth/wechat/login` | `POST` | no |

## Request

```http
POST /auth/wechat/login
content-type: application/json
x-trace-uuid: 11111111-1111-4111-8111-111111111111

{
  "code": "021x...",
  "encrypted_data": "CiyLU1Aw2KjvrjMdj8YKliAjtP4gsMZM...",
  "iv": "r7BXXKkLb8qrSNn05n0qiA==",
  "display_name": "Mini User"
}
```

## Field policy

| Field | 当前事实 |
|---|---|
| `code` | 必填 |
| `encrypted_data` + `iv` | 要么都传，要么都不传；只传一个会被 schema reject |
| `display_name` | 仅 bootstrap fallback；若 decrypt 成功，以解密资料优先 |

## Success envelope

成功形状与邮箱注册/登录相同，返回 `tokens + user + team + snapshot`：

```json
{
  "ok": true,
  "data": {
    "tokens": {
      "access_token": "eyJ...",
      "refresh_token": "opaque-refresh-token",
      "expires_in": 3600,
      "refresh_expires_in": 2592000,
      "kid": "v1"
    },
    "user": {
      "user_uuid": "11111111-1111-4111-8111-111111111111",
      "display_name": "小程序用户",
      "identity_provider": "wechat",
      "login_identifier": "openid:abc"
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
  },
  "trace_uuid": "11111111-1111-4111-8111-111111111111"
}
```

## Server-side flow

1. `code -> jscode2session`
2. 拿到 `openid + session_key`
3. 若请求携带 `encrypted_data + iv`，服务端解密 profile
4. 若解密 profile 中的 `openid` 与 `jscode2session.openid` 不一致，返回 `invalid-wechat-payload`
5. 命中已有 wechat identity 则复用；否则 bootstrap 新用户并签发 tokens

## Common errors

| HTTP | `error.code` | 触发 |
|---|---|---|
| 400 | `invalid-request` | body 不通过 schema 校验 |
| 400 / 502 / 504 | `invalid-wechat-code` | `code` 无效、微信接口失败或超时 |
| 400 | `invalid-wechat-payload` | `encrypted_data/iv` 半缺失、解密失败、或解密 `openid` 不一致 |
| 503 | `worker-misconfigured` | 缺 `WECHAT_APPID/WECHAT_SECRET` 或数据库配置 |

## Mini Program recommendation

推荐在用户点击“一键登录”后同时获取：

1. `wx.login()` 的 `code`
2. `wx.getUserProfile()` 的 `encryptedData + iv + nickName`

然后一次性发给 `/auth/wechat/login`。这样可以避免 code-only fallback 导致的展示名不完整。
