# Hero-to-Pro Full Closure Test Report

> 文档状态: `executed — preview release verified / live-e2e partial-pass`
> 服务业务簇: `hero-to-pro`
> 执行范围: `权限核验 → package truth gate → root test → preview D1 apply → 6-worker preview redeploy → live probes → full live e2e`
> 执行日期: `2026-05-01`
> 执行目标环境: `preview`
> 部署版本标识: `6e7aea2-dirty`

---

## 0. Final Verdict

| 维度 | 结果 |
|------|------|
| GitHub CLI 登录 | ✅ `pass` |
| Wrangler 身份 / Cloudflare 写权限 | ✅ `pass` |
| GitHub Packages 发布凭证 | ✅ `pass` |
| published package truth gate | ✅ `pass` |
| root `pnpm test` | ✅ `pass` |
| preview D1 migrations apply | ✅ `pass`（`006` → `014` 全部 apply） |
| 6-worker preview redeploy | ✅ `pass` |
| aggregated worker health | ✅ `pass`（`live=6 / total=6`） |
| deployed package manifest drift | ✅ `pass`（`drift_detected=false`） |
| full live e2e | ❌ `partial-pass`（`92 tests / 55 pass / 8 fail / 29 skip`） |

**总判断**：

1. 当前 **GitHub / Cloudflare / GitHub Packages 权限齐全**，足以执行 repo 现有发布链路。
2. 当前 repo 的真实发布与 live-e2e 拓扑是 **preview-first**；本轮按仓库已有脚本执行的是 `preview` 重新发布，不是单独的 production 流程。
3. 发布、D1、绑定与 package truth 本身已对齐；**阻塞 full green 的是 8 个 live-e2e 失败项**，其中 **4 个是真实 WebSocket 运行时断点**，**1 个是 RH5 usage evidence 断点**，**1 个是 initial-context 不稳定项**，**2 个是测试用例本身与当前 auth law 漂移**。

---

## 1. 权限核验结果

### 1.1 GitHub

- `gh auth status`：已登录账号 `haimang`
- git 协议：`https`
- GH CLI token scopes：`gist`, `read:org`, `repo`, `workflow`

### 1.2 Cloudflare

- `npx wrangler whoami`：通过
- 当前账号：`Sean.z@haimangtech.cn's Account`
- 关键权限：`workers(write)`, `workers_kv(write)`, `workers_scripts(write)`, `d1(write)`, `ai(write)` 等均存在

### 1.3 GitHub Packages

- `.npmrc` registry 绑定：`@haimang:registry=https://npm.pkg.github.com`
- `.npmrc` token 变量：`NODE_AUTH_TOKEN`
- `npm whoami --registry=https://npm.pkg.github.com`：返回 `haimang`
- `NODE_AUTH_TOKEN` 对 GitHub API 的 scope：包含 `write:packages`、`delete:packages`、`repo`、`workflow`

**结论**：repo 当前要求的 3 类权限都具备；没有发现权限型 blocker。

---

## 2. 实际执行的发布与验证链路

### 2.1 发布前 package 真值校验

执行：`node scripts/verify-published-packages.mjs`

结果：

| Package | Workspace | Registry latest | 结论 |
|---------|-----------|-----------------|------|
| `@haimang/nacp-core` | `1.6.0` | `1.6.0` | aligned |
| `@haimang/nacp-session` | `1.4.0` | `1.4.0` | aligned |
| `@haimang/jwt-shared` | `0.1.0` | `0.1.0` | aligned |

并成功写出 `.nano-agent/package-manifest.json`。

### 2.2 仓库根测试

执行：`pnpm test`

结果：通过。

### 2.3 Preview D1 对齐

执行：`bash scripts/deploy-preview.sh`

脚本先执行：

`npx wrangler d1 migrations apply NANO_AGENT_DB --env preview --remote`

本轮 remote preview D1 最终 apply 到：

- `006-error-and-audit-log.sql`
- `007-model-metadata-and-aliases.sql`
- `008-session-model-audit.sql`
- `009-turn-attempt-and-message-supersede.sql`
- `010-agentic-loop-todos.sql`
- `011-session-temp-files-and-provenance.sql`
- `012-session-confirmations.sql`
- `013-product-checkpoints.sql`
- `014-session-model-fallback-reason.sql`

### 2.4 6-worker preview 重新发布

执行顺序（脚本既定顺序）：

1. `bash-core`
2. `filesystem-core`
3. `context-core`
4. `orchestrator-auth`
5. `agent-core`
6. `orchestrator-core`

本轮 deploy 返回的 version id：

| Worker | Version ID |
|--------|------------|
| `nano-agent-bash-core-preview` | `b13e7121-9422-4bed-87d5-7a803e5287a3` |
| `nano-agent-filesystem-core-preview` | `15043cbc-332c-44a1-b83b-24614479d59b` |
| `nano-agent-context-core-preview` | `f078343a-ce81-4862-a9d4-54a69484ec1f` |
| `nano-agent-orchestrator-auth-preview` | `6f8001e4-6b07-4e05-a4fc-f2913a5c1242` |
| `nano-agent-agent-core-preview` | `b1c2a68a-1383-4706-8985-f505037e1cce` |
| `nano-agent-orchestrator-core-preview` | `aac2e6c0-64d3-49b0-bd87-6dd01014faa4` |

---

## 3. 在线健康、绑定与 package 对齐结果

### 3.1 Public health

`GET /health` 返回：

- `status: "ok"`
- `worker_version: "orchestrator-core@6e7aea2-dirty"`
- `public_facade: true`
- `agent_binding: true`

### 3.2 Aggregated worker health

`GET /debug/workers/health` 返回：

- `summary.live = 6`
- `summary.total = 6`

六个 worker 均返回 `live=true` / `status="ok"`，且 `worker_version` 全部对齐到本轮发布标识：

- `orchestrator-core@6e7aea2-dirty`
- `orchestrator-auth@6e7aea2-dirty`
- `agent-core@6e7aea2-dirty`
- `bash-core@6e7aea2-dirty`
- `context-core@6e7aea2-dirty`
- `filesystem-core@6e7aea2-dirty`

### 3.3 Runtime package manifest

我用真实注册账号访问了 `GET /debug/packages`。

结果：

- `status = 200`
- `drift_detected = false`
- deployed manifest 中三项 package 全部与 build-time registry truth 对齐：
  - `@haimang/nacp-core = 1.6.0`
  - `@haimang/nacp-session = 1.4.0`
  - `@haimang/jwt-shared = 0.1.0`

注意：

`/debug/packages` 的 **live registry fetch** 当前返回的是 `auth-not-available-in-runtime`，因为 worker runtime 并未注入 `NODE_AUTH_TOKEN / GITHUB_TOKEN`。  
这不会推翻本轮“package 对齐”结论，因为：

1. deploy 前 `verify-published-packages.mjs` 已用 owner 本地 token 证明 workspace = registry latest；
2. deployed manifest 自身已把那次校验结果固化进当前部署；
3. `/debug/packages` 返回 `drift_detected=false`。

### 3.4 `/models` 路由当前真实 law

本轮在线探针额外确认：

- 未带 bearer 访问 `GET /models` → `401 invalid-auth`
- 带 bearer 访问 `GET /models` → `200`，当前 active models `25` 项

这说明 `/models` 现在是 **authenticated route**，不是匿名 public list。

---

## 4. Full live e2e 结果

执行：`NANO_AGENT_LIVE_E2E=1 pnpm test:live:e2e`

结果汇总：

| 项目 | 数量 |
|------|------|
| tests | `92` |
| pass | `55` |
| fail | `8` |
| skip | `29` |

`29` 个 skip 的主体原因不是新回归，而是 harness 仍只默认暴露 `orchestrator-core` public preview URL；其余 5 个 leaf worker 维持 `workers_dev:false`，对应 direct-URL live probes 会被测试框架按设计 skip。

---

## 5. 失败项逐条分析

### 5.1 稳定运行时断点：WebSocket attach / reconnect

本轮稳定失败的 4 项：

1. `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs`
2. `test/cross-e2e/13-device-revoke-force-disconnect.test.mjs`
3. `test/package-e2e/orchestrator-core/03-ws-attach.test.mjs`
4. `test/package-e2e/orchestrator-core/04-reconnect.test.mjs`

共同症状：

- `Received network error or non-101 status code.`

额外复核：

- `03-ws-attach.test.mjs` 单独重跑仍稳定失败

当前判断：

- 这是 **真实运行时断点**，不是单纯测试噪音。
- 代码面最可疑位置是 `workers/orchestrator-core/src/index.ts` 对 public `/sessions/{id}/ws` 的转发：当前只构造了一个新的内部 `Request` 并设置 `upgrade: websocket` header，再调用 DO `stub.fetch(...)`。
- `workers/orchestrator-core/src/user-do/ws-runtime.ts` 的 attach runtime 要求真实 upgrade 语义；当前 façade → User DO 的转接很可能 **没有完整保留 WebSocket upgrade 所需的底层上下文**，导致 live edge 上拿不到 `101`。

结论：

- **WS upgrade chain 当前不健康**。
- 这也是 why `device revoke closes attached websocket`、`public facade roundtrip`、`reattach superseded`、`detached reconnect` 4 条同时失败。

### 5.2 运行时 evidence 断点：RH5 reasoning usage

失败项：

- `test/package-e2e/orchestrator-core/11-rh5-models-image-reasoning.test.mjs`

断言失败：

- 期望 `nano_usage_events.is_reasoning = 1`
- 实际取到 `0`

该用例前半段已证明：

- `GET /models`（authenticated）可用
- session start 可用
- image file upload 可用
- `POST /sessions/{id}/messages` with `model_id + reasoning + image_url` 可用
- timeline 中也等到了 `llm.delta` / `turn.end`

因此这里更像是：

- **RH5 主链路能跑通**
- 但 **usage evidence 的 reasoning / vision flag 持久化没有与真实请求完全一致**

结论：

- 这是 **runtime evidence drift**，不是部署失败。

### 5.3 不稳定项：initial_context verify

在 full run 中失败：

- `test/cross-e2e/04-agent-context-initial-context.test.mjs`
- 失败点：`verify.json.pendingCount >= 1` 不成立

但单独重跑同一测试后：

- 该用例通过

同时：

- `test/package-e2e/orchestrator-core/02-session-start.test.mjs` 内的同类 `initial_context` verify 用例在 full run 里是通过的

结论：

- 这项当前更像 **flaky / race**，不是稳定 hard-fail
- 但它仍然说明 initial-context pending-layer 观察值不够稳定，不能当作 fully green

### 5.4 测试用例漂移：HP2 model 相关 2 项

失败项：

1. `test/cross-e2e/15-hp2-model-switch.test.mjs` — `model alias resolve`
2. `test/cross-e2e/15-hp2-model-switch.test.mjs` — `model.fallback stream event`

这两项的实际断言都只是：

- `GET /models` 应返回 `2xx/3xx`

但当前线上事实已确认：

- `/models` **需要 bearer auth**
- 匿名访问返回 `401 invalid-auth`

代码事实也一致：

- `workers/orchestrator-core/src/index.ts` 的 `handleModelsList()` 首句就是 `authenticateRequest(request, env)`

结论：

- 这两项失败首先是 **live test expectation drift**
- 它们不能证明 `/models` runtime 挂掉；相反，带 auth 的实测是 `200 + 25 models`

---

## 6. 结论与建议

### 6.1 本轮已经确认成立的事项

1. 权限链路完整：`gh` / Wrangler / GitHub Packages 均可用
2. published package truth 成立：workspace 与 registry latest 对齐
3. preview D1 已对齐到 `014`
4. 6-worker preview 全部重新发布成功
5. aggregated worker health 为 `6/6 live`
6. deployed package manifest 无 drift

### 6.2 当前仍阻塞 “full green live-e2e” 的事项

1. **WebSocket public attach/reconnect 链路真实断点**（4 项）
2. **RH5 usage evidence 的 reasoning flag 持久化断点**（1 项）
3. **initial_context verify 存在不稳定 race**（1 项）
4. **HP2 model 相关 live test 需要按当前 auth law 修正**（2 项）

### 6.3 最终判断

本轮可以确认：

- **发布能力、数据库对齐、绑定在线性、package 引用一致性** 都已具备并已执行通过；
- 但是 **当前 preview 环境还不满足“full live-e2e all green”**；
- 若要进入真正的 full-closure green gate，优先级应是：
  1. 修 WS attach/reconnect 链路
  2. 修 RH5 usage evidence flags
  3. 稳定 initial-context pending-layer 观察
  4. 回刷 `test/cross-e2e/15-hp2-model-switch.test.mjs` 使其与 `/models` 认证 law 对齐

---

## 7. 本轮执行命令清单

```bash
gh auth status
npx wrangler whoami
npm whoami --registry=https://npm.pkg.github.com
node scripts/verify-published-packages.mjs
pnpm test
bash scripts/deploy-preview.sh
curl https://nano-agent-orchestrator-core-preview.haimang.workers.dev/health
curl https://nano-agent-orchestrator-core-preview.haimang.workers.dev/debug/workers/health
NANO_AGENT_LIVE_E2E=1 pnpm test:live:e2e
NANO_AGENT_LIVE_E2E=1 node --test test/cross-e2e/04-agent-context-initial-context.test.mjs test/package-e2e/orchestrator-core/03-ws-attach.test.mjs
```
