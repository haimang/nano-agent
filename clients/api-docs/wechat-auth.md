# WeChat auth API

## Route

| Route | Method | Auth | 说明 |
|------|--------|------|------|
| `/auth/wechat/login` | `POST` | no | 微信 code 登录；优先走 decrypt 自动登录 |

## Request

```http
POST /auth/wechat/login
content-type: application/json
x-trace-uuid: <uuid>

{
  "code": "021x...",
  "encrypted_data": "CiyLU1Aw2KjvrjMdj8YKliAjtP4gsMZM...",
  "iv": "r7BXXKkLb8qrSNn05n0qiA==",
  "display_name": "Mini User"
}
```

## Field policy

| Field | 当前策略 |
|------|----------|
| `code` | 必填 |
| `encrypted_data` | 推荐提供；与 `iv` 成对出现 |
| `iv` | 推荐提供；与 `encrypted_data` 成对出现 |
| `display_name` | 仅 bootstrap fallback，不是身份真相 |

当前服务端流程：

1. `code -> jscode2session`
2. 获取 `openid + session_key`
3. 如果收到 `encrypted_data + iv`，则在服务端解密
4. 校验 decrypted `openid` 与 `jscode2session.openid` 一致
5. 命中已有身份则复用；否则 bootstrap 新用户

## Success notes

- `session_key` 只在服务端短暂使用，不回传客户端
- decrypt 成功时，优先使用解密后的 `display_name`
- 当前仍保留 code-only compatibility，便于旧调用方平滑迁移

## Common errors

| Code | 含义 |
|------|------|
| `invalid-wechat-code` | `wx.login` code 不合法、过期，或微信接口未返回 `openid/session_key` |
| `invalid-wechat-payload` | `encrypted_data/iv` 半缺失、解密失败，或解密后的 `openid` 与 `jscode2session` 不一致 |
| `worker-misconfigured` | auth worker 未注入 `WECHAT_APPID/WECHAT_SECRET` |

## Mini Program client recommendation

优先在用户点击“微信一键登录”后同时调用：

1. `wx.login()`
2. `wx.getUserProfile()`

然后把 `code + encrypted_data + iv + userInfo.nickName` 一起发给后端。
