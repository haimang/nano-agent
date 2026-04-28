# ZX2 Rollback Runbook — internal-http-compat retirement

> 写于: 2026-04-27（ZX2 Phase 3 P3-05）
> ZX4 Phase 9 update(2026-04-28): P3-05 flip 已 land。本 runbook 仍保留作为反向通道,**保留至 2026-05-12 后归档**(2 周窗口,per ZX4 plan + owner direction fast-track)。归档前任何 prod regression 仍按本 runbook 执行;归档后回滚需走更重的"重新启用 internal-http-compat profile"流程,见 §6。
> 适用范围: agent-core 内部 HTTP 路径（`/internal/sessions/:id/{start,input,cancel,verify,timeline,stream}` 与 `https://*.internal/...` relay）翻转到 RPC 之后的回滚动作
> 关联文档: `docs/transport/transport-profiles.md`、`docs/action-plan/zero-to-real/ZX2-transport-enhance.md`、`docs/action-plan/zero-to-real/ZX4-transport-true-close-and-session-semantics.md`

---

## 0. 何时使用本 runbook

当且仅当下面任一条件触发：

1. preview env 上 dual-track parity（`agent-rpc-parity-failed`）出现 ≥1 次 mismatch，且分类归因显示是 RPC 路径错误。
2. production 部署后，`agent-core` 任一 RPC 方法返回的 envelope 与 HTTP 路径行为不一致，且 root cause 不在客户端。
3. WorkerEntrypoint binding 在某 env 加载失败（例如 `env.AGENT_CORE.start` 为 undefined），错误率 ≥0.1%。
4. `bash-core` RPC 路径（`call/cancel`）出现 envelope `error.code = internal-error` 飙升，且 fetch 路径正常。

---

## 1. 回滚开关位置（runtime feature flag）

> **ZX4 P9 update(2026-04-28)**: P3-05 flip 已在 ZX4 P9 完成,**软回滚通道已不可用** —— `forwardInternalJsonShadow` 中的 HTTP fetch fallback + `jsonDeepEqual` parity 比较已被物理删除,`agent-core/host/internal.ts` 的非 stream `/internal/` action handler 也已删除。post-flip 任何 prod regression 只能走"硬回滚"(代码 revert + redeploy)。本节 §1.1/§1.2 中标 "软回滚" 的步骤仅作为 **历史 ZX2 P3-04 状态描述**,不可执行。

### 1.1 agent-core 端

- ~~软回滚~~ **(post-P9 不可用)**：原"取消 orchestrator-core 的 `AGENT_CORE.input/cancel/verify/timeline/streamSnapshot` 绑定 → forwardInternalJsonShadow 自动退化为 HTTP 路径"通道已被 ZX4 P9 物理删除。post-flip 不再有 `typeof rpc !== 'function'` 自动退化分支;取消 binding 后 orchestrator-core 直接返 503 `agent-rpc-unavailable`,无 HTTP 兜底。
- 硬回滚(post-P9 唯一通道)：
  1. 找到 ZX4 P9 翻转的 commit(`git log --oneline -- workers/orchestrator-core/src/user-do.ts | head`)
  2. revert P9 的 forwardInternalJsonShadow / forwardStart / forwardStatus 改写 + revert agent-core/host/internal.ts 的 `SUPPORTED_INTERNAL_ACTIONS` 收紧
  3. typecheck + 全量测试(orchestrator-core 75 + agent-core 1056) + redeploy 6 worker
  4. 测试 dual-track 是否重新工作

### 1.2 bash-core 端

- ~~软回滚~~ **(post-P9 同样不可用)**：`agent-core/host/remote-bindings.ts:makeCapabilityTransport` 的 RPC vs fetch 分支在 ZX4 不变,但 ZX4 没有针对 bash-core 的 P9 翻转。bash-core 的回滚仍可参照 ZX2 P3-03/04 描述执行,但需额外 revert ZX4 P9 对 orchestrator-core 的影响。
- 硬回滚：还原 `workers/bash-core/src/index.ts` 中 `BashCoreEntrypoint` class 部分至 fetch-only worker。确保 `workers_dev: false` 与 binding-secret 校验保留,仅撤回 RPC 入口。

### 1.3 wrangler workers_dev 回滚

不建议回滚 P1-02 的 `workers_dev: false` 决议。即使 rollback 也仅 agent-core preview 在极端调试需要时临时开启，开启窗口必须 ≤ 24h 并设定移除日期。

---

## 2. 回滚步骤（preview env）

> 默认假设 owner 已确认要回滚。所有命令在 repo 根目录执行。

### 2.1 ~~软回滚~~ (post-ZX4 P9 不可用)

> 本子节为 ZX2 P3-04 状态下的历史步骤记录,ZX4 P9 翻转后已无效。post-flip 取消 RPC binding 不会自动退化为 HTTP 路径(HTTP 路径已删),orchestrator-core 直接返 503 `agent-rpc-unavailable`。**任何 post-P9 prod regression 必须走 §2.2 硬回滚或 §2.4 重新启用 internal-http-compat profile 的重型流程。**

### 2.2 硬回滚（agent-core 代码 revert）

```bash
# 1. 找到 ZX2 P3-01 落地的 commit
git log --oneline workers/agent-core/src/index.ts | head -5

# 2. 还原到该 commit 前一版（这里 <SHA-PREV> 是 ZX2 P3-01 之前的 sha）
git show <SHA-PREV>:workers/agent-core/src/index.ts > workers/agent-core/src/index.ts

# 3. typecheck + 测试
cd workers/agent-core
pnpm typecheck && pnpm test

# 4. 部署
pnpm build && pnpm wrangler deploy --env preview

# 5. 验证（同上）
```

### 2.3 bash-core 回滚（保留 binding-secret 守卫）

```bash
# 1. 还原 src/index.ts 至 P3-03 之前（保留 P1-03 binding-scope guard）
git show <SHA-PRE-P3-03>:workers/bash-core/src/index.ts > workers/bash-core/src/index.ts

# 2. 还原 vitest.config.ts（如不再用 cloudflare:workers shim）
rm workers/bash-core/vitest.config.ts
rm workers/bash-core/test/support/cloudflare-workers-shim.ts

# 3. 还原 smoke.test.ts 与 rpc.test.ts
git checkout <SHA-PRE-P3-03> -- workers/bash-core/test/smoke.test.ts
rm workers/bash-core/test/rpc.test.ts

# 4. typecheck + 测试 + 部署
cd workers/bash-core
pnpm typecheck && pnpm test
pnpm build && pnpm wrangler deploy --env preview
```

### 2.4 重新启用 internal-http-compat profile (post-P9 重型流程)

post-ZX4 P9, transport-profiles.md 已标 `internal-http-compat: retired`。如确需重新启用 dual-track parity(例如发现 RPC 路径长期不稳),走以下流程而非"软回滚":

1. revert ZX4 P9 commit(`workers/orchestrator-core/src/user-do.ts` + `workers/agent-core/src/host/internal.ts`)
2. 在 `transport-profiles.md` 把 `internal-http-compat` 状态从 `retired` 改回 `active`,加 `(re-activated <date>)` 标注
3. 把本 runbook 头部的 archive date `2026-05-12` 推迟,并在 §1 重写 "P9 后状态" 块为 "重新启用"
4. **prod deploy 顺序硬约束**:
   - Step A: `wrangler d1 migrations apply --env prod --remote`(确保 migration 006 已 land 到 prod D1)
   - Step B: 部署 5 leaf worker(bash-core / filesystem-core / context-core / orchestrator-auth / agent-core)
   - Step C: 部署 orchestrator-core(facade)
   - Step D: 跑 30-session burst probe + cross-e2e 验证
   - **不允许跳过 A 直接 deploy worker** —— prod handleMeSessions / handleStart 在 migration 缺失时会因 D1 schema mismatch 抛错

---

## 3. 回滚后必跑 smoke

```bash
pnpm -F @haimang/agent-core-worker test       # 1054/1054
pnpm -F @haimang/bash-core-worker test        # 360/360（含 1 个 binding-scope 拒绝）
pnpm -F @haimang/orchestrator-core-worker test # 36/36
pnpm -w run typecheck                          # 全 workspace
```

preview env：

```bash
# 6 worker health 仍报 live:6
curl -s "https://nano-agent-orchestrator-core-preview.haimang.workers.dev/debug/workers/health" | jq .summary

# session start → input → cancel 三段闭环
TRACE=$(uuidgen)
curl -s -X POST -H "x-trace-uuid: $TRACE" -H "Authorization: Bearer $TOKEN" \
  -d '{"initial_input":"smoke"}' \
  "https://nano-agent-orchestrator-core-preview.haimang.workers.dev/sessions/$SESSION/start"
```

---

## 4. 回滚的硬限制

- 不允许回滚到 P1-03 之前（即不允许把 `workers_dev` 改回 `true`），即便 RPC 路径全错，binding-scope 守卫 + 代码层 401 都必须保留。
- 不允许回滚到 P1-01 之前（即不允许删除 transport-profiles.md），文档冻结的 5 个 profile 名是后续所有 PR 的引用基。
- 不允许回滚 P2 协议层（nacp-core/rpc.ts 与 nacp-session 5 族 message_type）— 它们是 contract，runtime 回滚不会影响 contract 静态形状。
- 不允许在 production 上跳过 preview 直接回滚 — production rollback 必须先在 preview 跑 ≥30 分钟 smoke。

---

## 5. 回滚后通信

- 通知 owner + 团队（slack `#nano-agent-deploy` channel）：粘贴 commit sha、回滚类型（软 / 硬）、影响时长、根因初步判断。
- 在 `docs/eval/zero-to-real/state-of-transportation-by-opus.md` 末尾追加一条 `rollback-history` 记录：日期 / 类型 / sha / 根因 / 后续动作。
- 如根因是 RPC 协议错误，更新 `docs/transport/transport-profiles.md` 把 `internal-http-compat` 状态从 `retired-with-rollback` 改回 `active`，并标注 `(re-activated <date>)`。

---

## 6. 重新前进的入口

回滚完成后，需要重新启动 RPC 翻转工作时：

1. 在 staging 复现根因；如是协议层 bug，先修 `nacp-core/rpc.ts` + 单测覆盖。
2. 重新跑 ZX2 P3-01..P3-05 的步骤；parity 观察期重启计时（≥1000 turns + ≥7 天 + 0 mismatch）。
3. 必须 owner 在 PR 描述里 ack 上一次 rollback 的 root cause + 已修复 evidence。
