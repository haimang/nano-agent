# Nano-Agent 代码审查

> 审查对象: `zero-to-real + ZX5 rereview + current 6-worker/packages`
> 审查类型: `mixed`
> 审查时间: `2026-04-29`
> 审查人: `GPT-5.5`
> 审查范围:
> - `workers/{orchestrator-core,orchestrator-auth,agent-core,bash-core,context-core,filesystem-core}/**`
> - `packages/{nacp-core,nacp-session,jwt-shared,orchestrator-auth-contract,eval-observability,storage-topology,workspace-context-artifacts}/**`
> - `clients/api-docs/**`
> - `scripts/deploy-preview.sh`
> - `pnpm-lock.yaml`
> 对照真相:
> - `docs/charter/plan-zero-to-real.md`
> - `docs/charter/plan-worker-matrix.md`
> - `docs/action-plan/zero-to-real/ZX5-protocol-hygiene-product-surface-architecture.md`
> - `docs/issue/zero-to-real/ZX5-closure.md`
> - `docs/issue/zero-to-real/zero-to-real-final-closure.md`
> - `docs/issue/worker-matrix/worker-matrix-final-closure.md`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`当前代码已经具备 6-worker 主骨架、真实 auth/session/runtime 的大部分主链，以及 ZX5 review 后若干关键修复；但 zero-to-real 仍不应被视为完全 closed，因为 device revoke 安全语义、Permission/Elicitation/Usage live runtime、context/filesystem 真 RPC、package lock/install truth 与最终 closure 文案仍存在真实断点。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `ZX5 review 后 /messages forward、/input alias、client api-docs、last_seen_at rename、kid rotation 覆盖等修复真实存在；这不是“完全没做”。`
  2. `但是 Lane F 与 Lane E 仍是 infra/seam，不是端到端 runtime truth；zero-to-real final closure 仍把 real runtime / real clients 写成 closed，和代码及 api-docs 事实不一致。`
  3. `D6 device revoke 当前只写 D1，不进入 access/refresh/WS auth gate；再叠加 jwt-shared lockfile/install 断点，当前不能作为“完整 end-user auth + product baseline”收口。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-zero-to-real.md`
  - `docs/charter/plan-worker-matrix.md`
  - `docs/action-plan/zero-to-real/ZX5-protocol-hygiene-product-surface-architecture.md`
  - `docs/issue/zero-to-real/ZX5-closure.md`
  - `docs/issue/zero-to-real/zero-to-real-final-closure.md`
  - `docs/issue/worker-matrix/worker-matrix-final-closure.md`
  - `docs/templates/code-review.md`
- **核查实现**：
  - `workers/orchestrator-core/src/{index,user-do,auth,session-truth}.ts`
  - `workers/orchestrator-auth/src/{jwt,service,index}.ts`
  - `workers/agent-core/src/{index,host/do/nano-session-do,host/runtime-mainline,hooks/permission}.ts`
  - `workers/{bash-core,context-core,filesystem-core}/src/index.ts`
  - `packages/{jwt-shared,orchestrator-auth-contract,nacp-core,nacp-session,storage-topology,workspace-context-artifacts,eval-observability}/**`
  - `clients/api-docs/README.md`
  - `scripts/deploy-preview.sh`
  - `pnpm-lock.yaml`
- **执行过的验证**：
  - `pnpm test:contracts` — `31 / 31 pass`
  - `pnpm --filter @haimang/orchestrator-core-worker test` — `80 / 80 pass`
  - `pnpm --filter @haimang/agent-core-worker test` — `1056 / 1056 pass`
  - `pnpm --filter @haimang/bash-core-worker test` — `374 / 374 pass`
  - `pnpm --filter @haimang/context-core-worker test` — `171 / 171 pass`
  - `pnpm --filter @haimang/filesystem-core-worker test` — `294 / 294 pass`
  - `pnpm --filter @haimang/orchestrator-auth-worker test` — `13 / 13 pass`
  - `pnpm --filter @haimang/orchestrator-auth-contract test` — `19 / 19 pass`
  - `pnpm --filter @haimang/jwt-shared build` — `failed: tsc not found`
  - `pnpm --filter @haimang/jwt-shared test` — `failed: vitest not found`
- **复用 / 对照的既有审查**：
  - `none` — `本轮不采纳 Kimi / DeepSeek / GLM / GPT 既有审查结论；docs/code-review/zero-to-real/ZX5-reviewed-by-GPT.md §6 仅作为实现者回应和修改清单的待核实 claim 使用。`

### 1.1 已确认的正面事实

- 当前物理拓扑确实是 `6 workers / 7 packages`：`workers/{agent-core,bash-core,context-core,filesystem-core,orchestrator-auth,orchestrator-core}` 与 `packages/{eval-observability,jwt-shared,nacp-core,nacp-session,orchestrator-auth-contract,storage-topology,workspace-context-artifacts}`。
- `ZX5 Lane C` 的主体落地真实存在：`packages/jwt-shared/src/index.ts` 已抽出 JWT HMAC primitive；`workers/orchestrator-core/src/auth.ts:1-11` 与 `workers/orchestrator-auth/src/jwt.ts:1-13` 都改为顶层静态 import；`packages/orchestrator-auth-contract/src/facade-http.ts:97-114` 已加入 `RpcErrorCode ⊂ FacadeErrorCode` 的编译期断言。
- `ZX5 Lane D` 的核心产品面代码真实存在：`workers/orchestrator-core/src/user-do.ts:1424-1631` 实现 `/messages` 并 forward 到 agent-core `input` RPC；`workers/orchestrator-core/src/user-do.ts:979-1000` 已把 `/input` 改为 `/messages` thin alias；`workers/orchestrator-core/src/index.ts:584-642` 与 `user-do.ts:1795-1890` 实现 `/me/conversations`。
- `clients/api-docs/README.md:70-86` 已把 `/messages`、`/files`、`/me/conversations`、`/me/devices*` 与尚未 live 的 Permission/Usage/Elicitation 能力重新标成当前状态，比 ZX5 第一轮 review 前诚实很多。
- `bash-core`、`agent-core`、`orchestrator-core` 的主测试面当前都能通过；这说明已落地的主链和已有测试没有明显回归。

### 1.2 已确认的负面事实

- `D6 device revoke` 仍不是 auth truth：`workers/orchestrator-core/src/index.ts:710-721` 明确承认 access token 在 `exp` 前仍可用；`packages/orchestrator-auth-contract/src/index.ts:35-46` 的 `AccessTokenClaimsSchema` 没有 `device_uuid`；`workers/orchestrator-auth/src/jwt.ts:76-143` 的 `verifyAccessToken()` 没有任何 D1 device status lookup。
- `Lane F` 仍不是 live runtime：`workers/agent-core/src/hooks/permission.ts:50-58` 仍是同步 `verdictOf()`；`workers/agent-core/src/host/do/nano-session-do.ts:785-817` 的 emit helper 没有实际发 `session.permission.request` / `session.elicitation.request` frame；`NanoSessionDO.createLiveKernelRunner()` 在 `workers/agent-core/src/host/do/nano-session-do.ts:481-490` 未传 `onUsageCommit`。
- `Lane E` 仍是 RPC seam，不是 context/filesystem 真业务 RPC：`workers/agent-core/wrangler.jsonc:45-49` 只打开 `BASH_CORE`，`CONTEXT_CORE` / `FILESYSTEM_CORE` 仍注释；`workers/agent-core/src/host/do/nano-session-do.ts:34-35` 仍直接从 `@haimang/context-core-worker/context-api/...` in-process import；`workers/context-core/src/index.ts:104-119` 与 `workers/filesystem-core/src/index.ts:77-85` 只返回 op 列表。
- `@haimang/jwt-shared` 的 standalone build/test 在当前工作树失败；`pnpm-lock.yaml` 的 importer 区块没有 `packages/jwt-shared`，但仍有已不存在的旧包 importer，如 `packages/agent-runtime-kernel`、`packages/capability-runtime`、`packages/context-management` 等。
- `zero-to-real-final-closure.md:56-70` 仍把 real runtime 与 real clients 写成 ✅ closed，但同一仓库的 `clients/api-docs/README.md:82-86` 与 `ZX5-closure.md:309-315` 都承认 Permission/Elicitation/Usage live path 未闭合。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 直接核对了 6-worker 源码、7 packages、wrangler、client docs、charter / closure / action-plan。 |
| 本地命令 / 测试 | `yes` | 跑了 root contracts、6 个 worker/package 关键测试；同时捕获 `jwt-shared` standalone build/test 失败。 |
| schema / contract 反向校验 | `yes` | 对照了 JWT claims、FacadeErrorCode、device schema、NACP/session message 使用面。 |
| live / deploy / preview 证据 | `no` | 本轮未调用外部 preview URL；不把 closure 中的 live 叙事当作已复核事实。 |
| 与上游 design / QNA 对账 | `yes` | 对照 zero-to-real / worker-matrix charter 的 in-scope、exit criteria 与当前代码事实。 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | Device revoke 只写 D1，不进入 access/refresh/WS auth gate | `high` | `security` | `yes` | 补 device_uuid claim + verify/refresh/WS gate，或把 D6/zero-to-real auth closure 降级 |
| R2 | Permission/Elicitation/Usage 仍不是 live runtime | `high` | `delivery-gap` | `yes` | 补 hook dispatcher、WS request emit、onUsageCommit wiring 与 e2e |
| R3 | context/filesystem 仍是 host-local/minimal seam，不是 agent-core 真 RPC consumer | `medium` | `scope-drift` | `no` | 保持 partial 口径，或完成 binding + 真业务 RPC + consumer migration |
| R4 | `jwt-shared` 新包未进入 lock/install truth，standalone build/test 失败 | `medium` | `delivery-gap` | `yes` | 更新 lockfile / install state，并让 package 自身 build/test 可独立运行 |
| R5 | ZX5 新 product endpoints 缺直达测试覆盖 | `medium` | `test-gap` | `no` | 补 `/messages`、`/files`、`/me/conversations`、`/me/devices*` integration/unit tests |
| R6 | final closure 与当前代码事实仍分裂 | `medium` | `docs-gap` | `yes` | 重写 zero-to-real final closure 为 partial-close / handoff-ready，而非 fully closed |
| R7 | worker-matrix package truth 与当前 repo 状态需要重新对账 | `low` | `docs-gap` | `no` | 刷新 worker-matrix closure/handoff 对当前 7 packages、stale lock 与 coexistence duplicate 的描述 |

### R1. Device revoke 只写 D1，不进入 access/refresh/WS auth gate

- **严重级别**：`high`
- **类型**：`security`
- **是否 blocker**：`yes`
- **事实依据**：
  - `workers/orchestrator-core/migrations/007-user-devices.sql:3-8` 冻结的行为是“单设备全部 token / refresh chain revoke、新 authenticated HTTP/WS attach 立即拒绝、已有 live session best-effort 断开”。
  - `workers/orchestrator-core/src/index.ts:710-721` 明确写出当前 TODO：需要给 `verifyAccessToken / authenticateRequest` 加 D1 lookup、给 `IngressAuthSnapshot` 加 `device_uuid`、给已 attach session fan-out；在此之前，已发 access token 直到 `exp` 都继续可用。
  - `workers/orchestrator-core/src/index.ts:775-789` 当前实现只做 D1 `UPDATE nano_user_devices` + `INSERT nano_user_device_revocations`。
  - `packages/orchestrator-auth-contract/src/index.ts:35-46` 的 `AccessTokenClaimsSchema` 没有 `device_uuid`。
  - `workers/orchestrator-auth/src/jwt.ts:76-143` 的 `verifyAccessToken()` 只验签、解析 claims、检查 exp，不读 D1。
- **为什么重要**：
  - 这直接影响 end-user auth 的安全语义。用户点“撤销设备”后，同一设备的 access token 仍能继续访问 `/me`、session routes、WS attach 直到过期；refresh chain 也没有被 device truth gate 明确拒绝。
  - zero-to-real charter 把“完整 end-user auth truth”和“真实客户端入口”列为 primary exit criteria；D6 当前只能算 product endpoint/D1 schema 预备，而不是 auth enforcement 闭环。
- **审查判断**：
  - 当前 D6 应标为 **partial**，且对 zero-to-real full auth closure 是 blocker。
  - `clients/api-docs/README.md:80` 的 partial 标注是诚实的；`zero-to-real-final-closure.md:32-39` 的“完整 end-user auth truth 已成立”需要被下调或附加明确例外。
- **建议修法**：
  - 在 token mint 阶段把 `device_uuid` 纳入 access / refresh session truth，并投影进 `AccessTokenClaimsSchema` 与 `IngressAuthSnapshot`。
  - 在 `orchestrator-auth` 的 refresh / verify path 与 `orchestrator-core` 的 public ingress / WS attach path 做 D1 device-active lookup；revoked 则返回 401。
  - `/me/devices/revoke` 成功后至少使同 device 的 refresh 立即失效；已有 attached session 的 best-effort terminate 可作为 follow-up，但必须从“TODO”进入明确 action-plan。

### R2. Permission/Elicitation/Usage 仍不是 live runtime

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `workers/agent-core/src/hooks/permission.ts:50-58` 仍把 `AggregatedHookOutcome` 同步翻译成 allow/deny，没有 await / resume / DO storage wait。
  - `workers/agent-core/src/host/do/nano-session-do.ts:785-817` 的 `emitPermissionRequestAndAwait()` / `emitElicitationRequestAndAwait()` 只调用 `awaitAsyncAnswer()`，实际 frame emit 是 no-op 级注释，没有 `emitServerFrame` 或对 attached WS 的发送。
  - `workers/agent-core/src/host/runtime-mainline.ts:96-113,245-251` 已定义并调用 `onUsageCommit` callback。
  - `workers/agent-core/src/host/do/nano-session-do.ts:481-490` 创建 live kernel runner 时没有传 `onUsageCommit`，因此 callback 不会推到 client。
  - `clients/api-docs/README.md:82-86` 也明确当前 `session.permission.request`、`session.elicitation.request`、`session.usage.update` 不 live。
- **为什么重要**：
  - 这三条能力是“真实客户端实验”和“runtime hook-up”的关键体感面：客户端是否能收到 permission prompt、是否能回答 elicitation、usage 是否实时反映，都决定 first real run 是否可操作。
  - 如果只落 infra/callback contract，不接 dispatcher 与 WS emit，前端和 runtime 仍没有闭环。
- **审查判断**：
  - Lane F 当前准确状态是 **F4 done，F1/F2/F3 partial**。ZX5 closure 的 §3.2/§5.1 已比旧文案诚实，但 `zero-to-real-final-closure.md` 还没有同步降级。
- **建议修法**：
  - Permission/Elicitation：在 hook dispatcher 或 kernel tool gate 中真正调用 DO await helper，先向 attached client 发 `session.permission.request` / `session.elicitation.request`，再等待 D1/DO decision，并补 timeout / disconnect / replay 行为测试。
  - Usage：在 `NanoSessionDO.createLiveKernelRunner()` 注册 `onUsageCommit`，将 callback 转成 `session.usage.update` server frame，并补 WS / HTTP snapshot 一致性测试。

### R3. context/filesystem 仍是 host-local/minimal seam，不是 agent-core 真 RPC consumer

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/agent-core/wrangler.jsonc:45-49` 只启用了 `BASH_CORE`；`CONTEXT_CORE` 与 `FILESYSTEM_CORE` 仍保持注释。
  - `workers/agent-core/src/host/do/nano-session-do.ts:34-35` 仍从 `@haimang/context-core-worker/context-api/append-initial-context-layer` in-process import。
  - `workers/context-core/src/index.ts:104-119` 的 RPC 方法只返回 `appendInitialContextLayer / drainPendingInitialContextLayers / peekPendingInitialContextLayers` 这类 op 名单。
  - `workers/filesystem-core/src/index.ts:77-85` 的 RPC 方法只返回 `readArtifact / writeArtifact / listArtifacts` op 名单，没有业务 body 实现。
  - `workers/agent-core/src/host/do/nano-session-do.ts:2049-2064` 的 filesystem posture 仍返回 `hostLocalFilesystem: true`。
- **为什么重要**：
  - worker-matrix 与 zero-to-real 都把 6-worker mesh 当作阶段性事实，但 context/filesystem 当前仍主要是 library-worker / host-local posture。这个选择可以成立，但不能同时写成“真 RPC uplift 已完成”。
  - `orchestrator-core` 还在 `workers/orchestrator-core/wrangler.jsonc:48-54` 直接 bind 了 `BASH_CORE / CONTEXT_CORE / FILESYSTEM_CORE` 用于 `/debug/workers/health`，这需要被明确标成 debug exception，否则会与 `agent.core` 负责 runtime mesh 的边界纪律混淆。
- **审查判断**：
  - Lane E 是 **minimal RPC seam landed, consumer migration deferred**。如果把它作为 short-term shim 是可接受的；如果作为 zero-to-real / worker-matrix “true RPC” closure 证据，则过度。
- **建议修法**：
  - 二选一：要么在 closure 中持续保持 partial 口径并给出 time-box / owner trigger；要么打开 agent-core `CONTEXT_CORE` / `FILESYSTEM_CORE` binding，补实际 RPC body 与 consumer migration，并用 cross-e2e 验证 initial_context / filesystem posture 走远端。
  - `/debug/workers/health` 的 direct binding 需在 docs 中定义为 ops/debug exception，不得扩成业务路由依赖。

### R4. `jwt-shared` 新包未进入 lock/install truth，standalone build/test 失败

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `packages/jwt-shared/package.json:17-25` 声明了 `build/typecheck/test` 与 `typescript/vitest` devDependencies。
  - 当前执行 `pnpm --filter @haimang/jwt-shared build` 失败：`sh: 1: tsc: not found`。
  - 当前执行 `pnpm --filter @haimang/jwt-shared test` 失败：`sh: 1: vitest: not found`。
  - `pnpm-lock.yaml:103-158` 在 `packages/nacp-core`、`packages/nacp-session`、`packages/orchestrator-auth-contract` 之间没有 `packages/jwt-shared` importer；同一 lockfile 前段还保留了已不存在的旧 importer，例如 `packages/agent-runtime-kernel`、`packages/capability-runtime`、`packages/context-management`。
  - `.npmrc:5-10` 要求 `${NODE_AUTH_TOKEN}`，本轮所有 pnpm 命令都出现缺 token warning；这解释了 owner-action 背景，但不改变当前 lock/install truth 断裂的事实。
- **为什么重要**：
  - ZX5 Lane C 把 JWT 抽成 single source 后，`jwt-shared` 就是 auth 主链的 load-bearing package。它不能只在某些 worker pretest 环境里“间接能 build”，而应能作为 workspace package 独立 build/test。
  - lockfile 缺新 importer、留旧 importer，会让 fresh install / CI / deploy reproducibility 变成不确定状态。
- **审查判断**：
  - 当前不能采纳 closure 中 `jwt-shared 20/20 pass` 作为可复现事实；本轮只能确认依赖它的 worker tests 通过，而不能确认 package 自身独立验证可跑。
- **建议修法**：
  - 在带 `NODE_AUTH_TOKEN` 的环境中执行一次 `pnpm install`，提交更新后的 `pnpm-lock.yaml`，确保有 `packages/jwt-shared` importer 并删除已物理不存在包的 stale importer。
  - 重新跑 `pnpm --filter @haimang/jwt-shared build typecheck test` 与依赖它的 `orchestrator-core/orchestrator-auth` tests。

### R5. ZX5 新 product endpoints 缺直达测试覆盖

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - 本轮 `rg` 在 `workers/orchestrator-core/test` 与根 `test/` 下没有找到 `/messages`、`/me/devices`、`/me/conversations` 的 endpoint-level 覆盖；这些字符串主要只出现在 `clients/api-docs/README.md`。
  - `workers/orchestrator-core/test/kid-rotation.test.ts:1-80` 覆盖的是 auth key rotation，不覆盖 D3-D6 endpoints。
  - `workers/orchestrator-core/test/user-do.test.ts` 有 35 个 UserDO 测试，但本轮核查范围内未看到 `/messages` forward、`/files` artifact_ref 扫描、`/me/conversations` header authority、`/me/devices/revoke` D1 batch 的直达断言。
- **为什么重要**：
  - D3 `/messages` 是 `/input` alias 与 agent runtime forward 的关键变化；D6 `/devices/revoke` 又有安全语义。靠既有 smoke/kid rotation 不能证明这些新增 product surface 稳定。
- **审查判断**：
  - 这不是阻止所有代码运行的 blocker，但会阻止把 Lane D 写成“完整产品面已稳定”。
- **建议修法**：
  - 增加最小 unit/integration 测试：`/input -> handleMessages` 单路径、`/messages` D1 append + `AGENT_CORE.input` 被调用、`/files` 从 artifact_ref 返回 metadata、`/me/conversations` 使用 header authority、`/me/devices/revoke` ownership / idempotent / audit insert。

### R6. final closure 与当前代码事实仍分裂

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/issue/zero-to-real/zero-to-real-final-closure.md:56-70` 把 real runtime 与 real clients 标为 ✅。
  - `docs/issue/zero-to-real/ZX5-closure.md:309-315` 同时承认 Lane E partial、F1/F2/F3 partial。
  - `clients/api-docs/README.md:82-86` 同步承认 Permission/Elicitation/Usage live 能力未实现。
  - `docs/issue/zero-to-real/zero-to-real-final-closure.md:93-102` 的“明确未做”列表没有覆盖 device revoke enforcement、Lane E/F deferred runtime 这些当前仍影响用户可见闭环的事项。
- **为什么重要**：
  - closure 文档是下一阶段的 truth anchor。如果它把 partial runtime 写成 closed，后续 plan 会把真实 blocker 当作 polish/backlog，造成优先级错误。
- **审查判断**：
  - `ZX5-closure.md` 在 review 后已经趋于诚实，但 `zero-to-real-final-closure.md` 未同步，因此阶段级 truth 仍分裂。
- **建议修法**：
  - 将 zero-to-real final closure 改为 `partial-close / handoff-ready baseline`，明确列出：D6 auth-gate、F1/F2/F3 runtime wiring、Lane E consumer migration、jwt-shared lockfile、endpoint tests、R28 owner ops。
  - 只有这些闭合或被 owner 明确降为下一阶段非 blocker 后，再恢复 `closed`。

### R7. worker-matrix package truth 与当前 repo 状态需要重新对账

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - 当前 `packages/` 只有 7 个目录；`docs/issue/worker-matrix/worker-matrix-final-closure.md:56-75` 仍描述“9 个 Tier B package README banner + 7 CHANGELOG 条目”。
  - `docs/issue/worker-matrix/worker-matrix-final-closure.md:157-168` 的 handoff 仍以“9 个 Tier B + 2 个 Tier A”作为 runtime/package truth，但当前物理事实已被后续阶段改变。
  - `packages/workspace-context-artifacts/README.md:9-12` 诚实承认 agent-core 主 consumer 仍 import 本包；`workers/agent-core/package.json:21,25` 也仍依赖 `@nano-agent/workspace-context-artifacts` 与 `@nano-agent/eval-observability`。
- **为什么重要**：
  - 这不是当前 runtime blocker，但会误导下一阶段作者：到底哪些 package 已删除、哪些仍是 coexistence duplicate、哪些仍被 runtime 消费，当前需要新的 single truth。
- **审查判断**：
  - worker-matrix closure 作为历史文档可以保留，但若继续作为当前 charter truth 使用，需要补一段“post-zero-to-real current package reality”。
- **建议修法**：
  - 在 handoff/closure 或新 review 中更新当前 7-package reality、stale lockfile 状态、仍被 worker 消费的 deprecated packages，以及 package 物理删除/共存边界。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | `6-worker 拓扑保持` | `done` | 当前 workers 目录确实是 6 个，未出现第 7 worker。 |
| S2 | `orchestrator-core 是唯一 public facade` | `done` | leaf workers `workers_dev:false`，public routes 集中在 orchestrator-core；但 `/debug/workers/health` 是 unauthenticated debug 面，应单独标边界。 |
| S3 | `orchestrator-auth internal-only + JWT single source` | `partial` | RPC auth 与 jwt-shared 抽取成立；但 jwt-shared install/lock 断裂，device revoke 未进入 auth gate。 |
| S4 | `D1 session / turn / message / context / audit baseline` | `partial` | 主表与读写路径存在，`/messages` 已 forward；新增 product endpoints 缺直达测试，device truth 只建 schema/endpoint。 |
| S5 | `real provider + quota mainline` | `partial` | agent-core tests 通过，usage/quota callback 存在；但 live `session.usage.update` 未 wire 到 DO/client。 |
| S6 | `Permission / Elicitation await-resume` | `partial` | DO storage waiter infra 存在；hook dispatcher 与 WS request frame 未接入。 |
| S7 | `context-core / filesystem-core RPC uplift` | `partial` | WorkerEntrypoint seam 存在；业务 RPC body 与 agent-core consumer migration 未落地。 |
| S8 | `ZX5 product surface` | `partial` | `/messages`、`/files`、`/me/conversations`、`/me/devices*` 代码存在；D6 enforcement 与 endpoint tests 缺失。 |
| S9 | `clients/api-docs 与代码现实同步` | `done` | README 已诚实标注 implemented / partial / not-live。 |
| S10 | `worker-matrix package absorption / deprecation truth` | `stale` | 历史 closure 与当前 7 packages / stale lockfile / remaining runtime deps 需要重新对账。 |
| S11 | `zero-to-real final closure` | `stale` | 仍标 `closed`，与 ZX5 partial、client docs、代码事实冲突。 |

### 3.1 对齐结论

- **done**: `3`
- **partial**: `6`
- **missing**: `0`
- **stale**: `2`
- **out-of-scope-by-design**: `0`

这更像 **“可运行 baseline 已形成，但安全 enforcement、runtime live hook、library-worker RPC consumer、package install truth 与最终 closure truth 仍未收口”**，不是可以无条件关闭的 zero-to-real completed 状态。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | 不新增第 7 worker / 不把 NanoSessionDO 拆出 | `遵守` | 当前仍是 6 worker。 |
| O2 | 不做完整 admin plane / API key admin UI | `遵守` | 未看到 admin plane 搭车扩张。 |
| O3 | R2 file bytes / cold archive 不属于 ZX5 必交 | `遵守` | `/files` metadata-only 可以接受，但必须保持 partial 口径。 |
| O4 | full stream-plane RPC retirement 不属于 zero-to-real 一步到位 | `遵守` | `stream`/WS 过渡面仍存在，不应误判为 blocker。 |
| O5 | context/filesystem host-local posture 本身不是 blocker | `误报风险` | blocker 不是 host-local，而是 closure/charter 把它写成真 RPC 完成态。 |
| O6 | owner live ops / wrangler tail / WeChat 真机证据 | `误报风险` | 不能要求代码 agent 代替 owner 执行，但 final closure 需要诚实标明未执行。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. `把 D6 device revoke 接入 access/refresh/WS auth gate，或把 zero-to-real full auth closure 明确降级并列为下一阶段 blocker。`
  2. `完成 F1/F2/F3 runtime wiring，或把 final closure 改为 partial-close，不再宣称 real runtime / real clients 已完全闭合。`
  3. `修复 @haimang/jwt-shared 的 lockfile/install truth，使 package 自身 build/typecheck/test 可独立复现。`
  4. `同步更新 zero-to-real-final-closure.md，让阶段级 truth 与 ZX5 closure、client docs、代码事实一致。`
- **可以后续跟进的 non-blocking follow-up**：
  1. `为 ZX5 新 product endpoints 补直达测试。`
  2. `决定 Lane E 的 short-term shim 退出条件：真实 RPC consumer migration，或正式保留 host-local posture 并更新 charter。`
  3. `刷新 worker-matrix handoff/closure 对当前 7 packages、stale lockfile、coexistence duplicate 的事实描述。`
  4. `把 /debug/workers/health 的 direct leaf-worker bindings 标成 ops/debug exception，避免扩散为业务边界。`
- **建议的二次审查方式**：`same reviewer rereview`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

本轮 review 不收口，等待实现者按 §6 响应并再次更新代码或 closure 文档。
