# ZX2 Rollback Runbook — internal-http-compat retirement

> 写于: 2026-04-27（ZX2 Phase 3 P3-05）
> 适用范围: agent-core 内部 HTTP 路径（`/internal/sessions/:id/{start,input,cancel,verify,timeline,stream}` 与 `https://*.internal/...` relay）翻转到 RPC 之后的回滚动作
> 关联文档: `docs/transport/transport-profiles.md`、`docs/action-plan/zero-to-real/ZX2-transport-enhance.md`

---

## 0. 何时使用本 runbook

当且仅当下面任一条件触发：

1. preview env 上 dual-track parity（`agent-rpc-parity-failed`）出现 ≥1 次 mismatch，且分类归因显示是 RPC 路径错误。
2. production 部署后，`agent-core` 任一 RPC 方法返回的 envelope 与 HTTP 路径行为不一致，且 root cause 不在客户端。
3. WorkerEntrypoint binding 在某 env 加载失败（例如 `env.AGENT_CORE.start` 为 undefined），错误率 ≥0.1%。
4. `bash-core` RPC 路径（`call/cancel`）出现 envelope `error.code = internal-error` 飙升，且 fetch 路径正常。

---

## 1. 回滚开关位置（runtime feature flag）

ZX2 在以下位置预留了软开关，rollback 时通过 wrangler secret 翻转，无需重新部署代码：

### 1.1 agent-core 端

- 软回滚（**优先**）：取消 orchestrator-core 的 `AGENT_CORE.input/cancel/verify/timeline/streamSnapshot` 绑定。在 `workers/orchestrator-core/wrangler.jsonc` 把对应 worker_dev_runtime 的 binding 改为 fetch-only 形态后 `wrangler deploy --env preview`。orchestrator-core `forwardInternalJsonShadow` 在 `typeof rpc !== 'function'` 时**自动退化为 HTTP 路径**，无 mismatch 502。
- 硬回滚：将 `agent-core/src/index.ts` 的 `AgentCoreEntrypoint` 还原成只暴露 `start` / `status` 的旧版本。从 git 取 `git show <sha>:workers/agent-core/src/index.ts > workers/agent-core/src/index.ts`，然后 `pnpm build && wrangler deploy --env preview`。

### 1.2 bash-core 端

- 软回滚：删除 agent-core 调用方在 `host/remote-bindings.ts:makeCapabilityTransport` 的 RPC 优先分支（保留 fetch fallback）。可临时把 `typeof rpc.call === "function"` 改为 `false`，rebuild + redeploy。
- 硬回滚：还原 `workers/bash-core/src/index.ts` 中 `BashCoreEntrypoint` class 部分至 fetch-only worker。确保 `workers_dev: false` 与 binding-secret 校验保留，仅撤回 RPC 入口。

### 1.3 wrangler workers_dev 回滚

不建议回滚 P1-02 的 `workers_dev: false` 决议。即使 rollback 也仅 agent-core preview 在极端调试需要时临时开启，开启窗口必须 ≤ 24h 并设定移除日期。

---

## 2. 回滚步骤（preview env）

> 默认假设 owner 已确认要回滚。所有命令在 repo 根目录执行。

### 2.1 软回滚（仅取消 RPC binding）

```bash
# 1. 编辑 orchestrator-core wrangler，注释掉 AGENT_CORE input/cancel/verify/timeline/streamSnapshot 的暴露
#    （或直接删除 RPC binding name 改回纯 service binding）
$EDITOR workers/orchestrator-core/wrangler.jsonc

# 2. 重新部署 orchestrator-core
cd workers/orchestrator-core
pnpm build && pnpm wrangler deploy --env preview

# 3. 验证
curl -s https://nano-agent-orchestrator-core-preview.haimang.workers.dev/debug/workers/health | jq .summary
# 期望: {"live":6,"total":6}

# 4. 复跑 cross-e2e parity 测试（应该全是 fetch-only 路径，无 mismatch）
cd ../..
pnpm -F @haimang/agent-core-worker test -- --run rpc
```

软回滚生效后，所有 session action 走 HTTP-truth 路径，dual-track 收到 `typeof rpc !== "function"` 后短路返回 `fetchResult`，**不发送 RPC 调用**。0 业务影响。

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
