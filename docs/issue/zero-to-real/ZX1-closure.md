# ZX1 Closure — WeChat Enhance and Debug Surfaces

> 服务业务簇: `zero-to-real / ZX1`
> 阶段状态: `closed`
> 收口结论: `wechat decrypt-capable login + 6-worker health matrix + client api docs established`

---

## 1. 阶段目标回看

ZX1 的目标是在既有 6-worker baseline 上补齐三件事：微信登录从 code-only baseline 升级为 decrypt-capable auto-login、所有 worker 输出统一 live/version truth 并由 `orchestrator-core` 聚合、以及为前端建立正式的 `clients/api-docs/`。

---

## 2. 已完成事项

1. 扩展 `WeChatLoginInputSchema`，新增 `encrypted_data + iv` 成对输入约束，并新增 `invalid-wechat-payload` 错误码。
2. `orchestrator-auth` 的 WeChat client 现在会从 `jscode2session` 读取 `session_key`，并支持服务端 AES-CBC 解密 profile payload。
3. `wechatLogin()` 现在会在提供 decrypt payload 时校验 decrypted `openid` 与 `jscode2session.openid` 一致，并优先使用解密出的昵称。
4. 小程序登录入口与调试页都已改为发送 `code + encrypted_data + iv + display_name`；如果用户没有授权 profile，仍保留 code-only compatibility。
5. 6 个 worker 的 probe 都新增 `worker_version`，并通过 `WORKER_VERSION` env 统一提供版本标签。
6. `orchestrator-core` 新增 `/debug/workers/health`，聚合 self + auth + agent + bash + context + filesystem 六个 worker。
7. Web 客户端与小程序调试页都新增 worker health 消费入口。
8. 新增 `clients/api-docs/{README,auth,wechat-auth,session,worker-health}.md`，并补齐 JWT / WeChat secret 配置说明。

---

## 3. 验证结果

```text
pnpm --filter @haimang/orchestrator-auth-contract typecheck build test
pnpm --filter @haimang/orchestrator-auth-worker typecheck build test
pnpm --filter @haimang/orchestrator-core-worker typecheck build test
pnpm --filter @haimang/agent-core-worker typecheck build test
pnpm test:package-e2e
pnpm test:cross-e2e
```

---

## 4. 关键文件

- `packages/orchestrator-auth-contract/src/index.ts`
- `workers/orchestrator-auth/src/{wechat,service,public-surface}.ts`
- `workers/orchestrator-core/src/index.ts`
- `workers/{agent-core,bash-core,context-core,filesystem-core}/src/index.ts`
- `workers/*/wrangler.jsonc`
- `clients/wechat-miniprogram/pages/{auth,index}/index.js`
- `clients/wechat-miniprogram/utils/wechat-auth.js`
- `clients/web/src/{client,main}.ts`
- `clients/api-docs/**`

---

## 5. Secret / JWT 设置指南

1. **仓库内只保留键名，不保留真实 secret**。
2. **本地开发**：在 `workers/orchestrator-auth/.dev.vars` 中放置 `PASSWORD_SALT`、`JWT_SIGNING_KID`、`JWT_SIGNING_KEY_<kid>`、`WECHAT_APPID`、`WECHAT_SECRET`。
3. **Cloudflare preview / prod**：使用 `npx wrangler secret put <KEY> --env preview` 写入 secret，再部署 worker。
4. **JWT 主路径**：使用 `JWT_SIGNING_KEY_<kid>` + `JWT_SIGNING_KID`；`JWT_SECRET` 仅保留 legacy fallback。
5. **worker version**：各 worker 使用 `WORKER_VERSION` 标记当前部署版本；推荐在 CI/deploy 时改写为 `worker-name@<git-sha-or-release>`.

---

## 6. Residuals

1. **WeChat compatibility path retained**：当前仍保留 code-only fallback，方便旧调用方平滑迁移；严格 mandatory decrypt 可留待下一阶段收紧。
2. **Health route is debug-first**：`/debug/workers/health` 当前主要服务于 preview/debug，不应被误写成业务 API。
3. **True production secret handoff remains operational work**：本轮建立了命名、入口和指南，但不在仓库内完成真实 secret 注入。

---

## 7. 最终 verdict

ZX1 可以关闭为 **微信登录增强与 6-worker debug 可观测性闭合阶段**。当前仓库已经具备 decrypt-capable WeChat login、统一 `worker_version` probe、单入口 health matrix、以及面向前端的正式 API 文档；剩余事项属于 secret 运维落地与更严格的 production policy 收紧，不再阻塞本轮收口。
