# Z1 Closure — Full Auth and Tenant Foundation

> 阶段: `zero-to-real / Z1`
> 状态: `closed`
> 作者: `GPT-5.4`
> 时间: `2026-04-25`
> 对应 action-plan: `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md`
> 直接解锁: `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md`

---

## 1. 结论

Z1 已达到 action-plan 约定的主要关闭条件。

zero-to-real 现在已经拥有一条真实的 auth foundation：**shared typed auth contract、internal-only `orchestrator.auth` worker、Wave A identity schema、JWT `HS256 + kid` keyring verify、register/login/refresh/verify/me/reset/wechat baseline、以及由 `orchestrator-core` 对外代理的 `/auth/*` façade 已经落地。**

---

## 2. 实际交付

1. 新建 `packages/orchestrator-auth-contract/`，冻结 register/login/refresh/me/verify/reset/wechat/API-key-reserved 的 typed RPC contract、request/response schema 与 envelope truth。
2. 新建 `workers/orchestrator-auth/`，实现 internal-only auth owner：password hash、JWT mint/verify、refresh rotation、WeChat `code -> openid` bridge、D1 repository、public probe-only surface。
3. 新增 `workers/orchestrator-core/migrations/001-identity-core.sql`，落下 Wave A `nano_users / nano_user_profiles / nano_user_identities / nano_teams / nano_team_memberships / nano_auth_sessions / nano_team_api_keys` baseline。
4. `workers/orchestrator-core/` 已接入 `/auth/register`、`/auth/login`、`/auth/refresh`、`/auth/verify`、`/auth/password/reset`、`/auth/wechat/login`、`/auth/me` 与 `/me` proxy surface。
5. `workers/orchestrator-core/src/auth.ts` 已升级到 `kid`-aware JWT keyring verify，同时保留 legacy `JWT_SECRET` fast-path 兼容。
6. 新增 unit tests、package-e2e probe、live helper `kid` 兼容，以及 worker CI 对 `orchestrator-auth` 与 contract package 的覆盖。
7. `docs/action-plan/zero-to-real/Z1-full-auth-and-tenant-foundation.md` 已翻到 `executed` 并补入详细工作日志。

---

## 3. 已验证的收口点

1. `@haimang/orchestrator-auth-contract` 的 schema / envelope tests 通过。
2. `@haimang/orchestrator-auth-worker` 的 service tests 覆盖 register/login/refresh/me/reset/wechat/caller discipline。
3. `@haimang/orchestrator-core-worker` 的 unit tests 覆盖 kid-aware verify 与 `/auth/*` proxy。
4. `workers/orchestrator-auth` 与 `workers/orchestrator-core` 的 `wrangler deploy --dry-run` 都已通过。
5. root `pnpm test:package-e2e` 与 `pnpm test:cross-e2e` 维持既有 baseline（当前 live gate 仍按 `NANO_AGENT_LIVE_E2E=1` 控制）。
6. 本轮额外补齐了 non-live regression guard：`workers/orchestrator-auth/test/public-surface.test.ts` 锁住 public probe-only surface；`service.test.ts` 与 `auth.test.ts` 现在覆盖 revoked refresh、forged/expired token、legacy no-`kid` fallback 收紧等负例。

---

## 4. 仍需诚实记录的限制

1. `verifyApiKey` 仍是 **schema-reserved / not-supported**，只冻结 contract，不宣称已实现 runtime verify plane。
2. `agent-core` / `NanoSessionDO` 当前仍以 deploy-local `TEAM_UUID` 作为 runtime tenant anchor；因此 Z1 已建立真实 `user/team/token` 真相，但 **多租户 team truth 的 session/runtime 全量消费仍留给 Z2 及后续阶段**。
3. `deploy-fill` 仍是 orchestrator ingress 的 legacy bridge 概念，而不是 auth contract 的正式输出；真正的 contract snapshot 现已固定为 `tenant_source: "claim"`。
4. WeChat 路径已具备真实 `jscode2session` bridge、`unionid` 预留字段、超时/重试 baseline，但真机/开发者工具层面的更深 hardening 仍属于后续客户端阶段。
5. password / refresh hashing 仍维持 first-wave `SHA-256 + PASSWORD_SALT` 最小实现；更强 KDF 升级不在 Z1 范围内。
6. `/auth/*` façade 已建立，但 owner 在 `ZX-qna` 中冻结的 shim 退役目标仍然成立：到 Z2 closure 前，shim/posture 必须继续向正式 RPC session seam 收口，而不能成为长期架构。
7. `pnpm test:package-e2e` / `pnpm test:cross-e2e` 当前仍是 live-gated；因此 Z1 的细粒度 auth 负例主要由 worker unit tests 与 non-live surface tests 守护，而不是默认 root live suite。

---

## 5. 对 Z2 的直接价值

1. Z2 现在可以直接消费 `AuthSnapshot` / `team_uuid` / `membership_level` 真相，而不必再依赖伪 token。
2. `NANO_AGENT_DB` 的 Wave A identity core 已存在，后续 session/activity/audit schema 只需继续沿 shared D1 baseline 追加 Wave B。
3. `orchestrator-core -> orchestrator.auth` 的 public façade / private owner 分层已经成立，Z2 不需要再回头拆 auth ownership。

---

## 6. 最终 verdict

**Z1 closed.**

这次最重要的变化不是“多了几个 auth route”，而是 zero-to-real 第一次拥有了真正的用户、团队、刷新态、和 internal auth owner。Z1 还没有替 Z2 提前解决 runtime tenant full-consumption，但它已经把真实入口和真实身份基底搭好了，后续 session/runtime/workflow 都可以建立在这层真相之上。
