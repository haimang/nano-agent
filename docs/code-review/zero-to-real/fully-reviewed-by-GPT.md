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

---

## 6. 实现者回应

### 6.1 对本轮审查的回应

> 执行者: `Claude Sonnet 4.6`
> 执行时间: `2026-04-29`
> 回应范围: `GPT R1–R7 / DeepSeek R1–R23 / kimi R1–R6 / GLM R1–R12（共 48 条 finding）`
> 对应审查文件:
> - `docs/code-review/zero-to-real/fully-reviewed-by-GPT.md`
> - `docs/code-review/zero-to-real/fully-reviewed-by-deepseek.md`
> - `docs/code-review/zero-to-real/fully-reviewed-by-kimi.md`
> - `docs/code-review/zero-to-real/fully-reviewed-by-GLM.md`

- **总体回应**：4 家审查员共提出 48 条 finding，本轮完全修复 14 条、部分修复 6 条、有理由 deferred 27 条、1 条 blocked（jwt-shared lockfile 需 NODE_AUTH_TOKEN 环境）；DeepSeek 独立发现的最关键 correctness critical（needsBody 遗漏 5 条路由、WorkerEntrypoint 默认导出错误、alarm 链断裂）已全部修复；closure 文档已诚实降级为 partial-close / handoff-ready。
- **本轮修改策略**：优先修复影响运行时正确性的 critical/high 断点（needsBody 短路、RPC 方法不可达、alarm 链断裂、错误信封逃逸）；对需要 kernel 改造或复杂协议重构的 Lane F / NACP 问题明确 deferred 并写入 closure §4；安全类问题（quota auto-seed）直接修复。
- **实现者自评状态**：`partially-closed`

### 6.2 逐项回应表

#### DeepSeek R1–R23

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| DS R1 | `needsBody` 遗漏 5 条路由，POST /messages 等请求体被丢弃 | `fixed` | 将 `messages / resume / permission/decision / policy/permission_mode / elicitation/answer` 加入 `needsBody`；同步修复 `optionalBody` 覆盖 `resume`（body 可选） | `workers/orchestrator-core/src/index.ts` |
| DS R2 | hook.emit kernel delegate 为硬编码 no-op | `deferred-with-rationale` | 真实实现需修改 scheduler（R6）并补 dispatcher，属于 Lane F 整体工作；本轮时间盒内无法安全完成 | — |
| DS R3 | onUsageCommit callback 未被传入 createMainlineKernelRunner | `partially-fixed` | 在 `createLiveKernelRunner()` 中注册 callback，当前实现为 `console.log` 可观测记录；WS push 到 client 的完整路径需 orchestrator-core 协调，deferred | `workers/agent-core/src/host/do/nano-session-do.ts` |
| DS R4 | Permission/Elicitation wait-and-resume infra 完全孤立（零调用方） | `deferred-with-rationale` | 核心断点是 hook.emit delegate（R2）和 scheduler 不产生 hook_emit（R6），两者均 deferred，故 R4 无法本轮闭合 | — |
| DS R5 | context-core / filesystem-core 默认导出非 WorkerEntrypoint | `fixed` | 将两个 worker 的默认导出从 `export default worker`（plain `{fetch}` 对象）改为 `export default ContextCoreEntrypoint / FilesystemCoreEntrypoint`；新增 `export { worker as fetchWorker }` 命名导出供测试使用 | `workers/context-core/src/index.ts`, `workers/filesystem-core/src/index.ts` |
| DS R6 | kernel scheduler 无 hook_emit 决策生成路径 | `deferred-with-rationale` | 需在 scheduler 中引入 session pending-hook state 检测，属于 Lane F F4 后续工作 | — |
| DS R7 | D1 先写后验（handleMessages RPC 失败产生孤儿数据） | `deferred-with-rationale` | 修复需 D1 rollback 或 RPC-first 改序，影响面较大；当前 turn 标记 failed 可限制影响范围；deferred | — |
| DS R8 | /me/conversations D1-only 忽略 KV 热索引 | `deferred-with-rationale` | 需明确 KV-to-D1 迁移策略后再合并双源；已记录为 closure §4 item 14 | — |
| DS R9 | alarm() 无 try/catch，任一步骤抛出导致 alarm 链永久断裂 | `fixed` | 在 alarm() 中用独立 try/catch 包裹三个步骤；每步失败仅 console.warn；ensureHotStateAlarm 移至 finally 保证必然执行 | `workers/orchestrator-core/src/user-do.ts` |
| DS R10 | socket lifecycle KV 写使用 void 吞没错误 | `fixed` | 将 `void this.markDetached(...)` 和 `void this.touchSession(...)` 改为 `.catch((err) => console.warn(...))` | `workers/orchestrator-core/src/user-do.ts` |
| DS R11 | orchestrator-auth 非 AuthServiceError 逃逸 envelope 体系 | `fixed` | 在 `invokeKnown` 中增加 catch-all，将未知错误包装为 `worker-misconfigured` 类型的 AuthServiceError | `workers/orchestrator-auth/src/index.ts` |
| DS R12 | `inferMessageRole` 精确匹配导致 user.input.text/multipart 被误标 system | `fixed` | 改为 `kind.startsWith('user.input') ? 'user' : 'system'` | `workers/orchestrator-core/src/session-truth.ts` |
| DS R13 | recordStreamFrames KV/D1 写入顺序缺事务保护 | `deferred-with-rationale` | 当前写入频率低，short-term risk 可控；补偿逻辑是独立 PR；deferred | — |
| DS R14 | expires_in 硬编码 3600 与 JWT exp 可能不一致 | `fixed` | 改为 `access.exp - Math.floor(Date.now() / 1000)`，从实际 JWT claims 计算（2 处） | `workers/orchestrator-auth/src/service.ts` |
| DS R15 | last_seen_at 跨端点语义不一致 | `deferred-with-rationale` | 与 GLM R8 重叠；内部字段语义对齐是技术债，deferred | — |
| DS R16 | D1 device revoke 使用非原子 batch() | `deferred-with-rationale` | 影响仅限 audit 完整性，不影响 security enforcement；deferred | — |
| DS R17 | agent-core R2_ARTIFACTS/KV_CONFIG required 类型但无 wrangler 绑定 | `fixed` | 改为 `readonly R2_ARTIFACTS?: unknown; readonly KV_CONFIG?: unknown;` | `workers/agent-core/src/host/env.ts` |
| DS R18 | forwardInternalJson 为死代码 | `fixed` | 添加 `/** @deprecated Use forwardInternalJsonShadow instead */` | `workers/orchestrator-core/src/user-do.ts` |
| DS R19 | streamSnapshot RPC 无调用方 | `deferred-with-rationale` | 保留为 reserved RPC slot；deferred | — |
| DS R20 | handleResume 为只读 stub | `deferred-with-rationale` | resume 完整行为（重连 WS、更新 DO state）是 transport hardening 工作；closure §4 已标注 | — |
| DS R21 | orchestrator-auth / jwt-shared 缺 README | `deferred-with-rationale` | 低优先级文档；deferred | — |
| DS R22 | checkpointOnTurnEnd 标志永不被消费 | `deferred-with-rationale` | 属于 agent-core 技术债；deferred | — |
| DS R23 | JWT_LEEWAY_SECONDS 未在 exp 检查中使用 | `fixed` | 在 `verifyJwt` 的 exp check 改为 `Date.now() / 1000 > payload.exp + JWT_LEEWAY_SECONDS` | `packages/jwt-shared/src/index.ts` |

#### kimi R1–R6

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| KM R1 | Lane E binding 未活化，agent-core 仍走 library import | `partially-fixed` | context-core/filesystem-core 默认导出已改为 WorkerEntrypoint（DS R5 修复）；agent-core wrangler.jsonc binding 注释按 owner 短期 shim 决策保持；consumer migration deferred | `workers/context-core/src/index.ts`, `workers/filesystem-core/src/index.ts` |
| KM R2 | Lane F onUsageCommit callback 未传入 kernel runner | `partially-fixed` | 同 DS R3 处理 | `workers/agent-core/src/host/do/nano-session-do.ts` |
| KM R3 | user-do.ts 2268 行未按 domain 拆分 | `deferred-with-rationale` | post-zero-to-real 技术债首选；需完整测试矩阵保障；deferred | — |
| KM R4 | quota allowSeedMissingTeam 在 preview 默认开启（生产泄漏风险） | `fixed` | 从 top-level `vars` 中移除 `NANO_AGENT_ALLOW_PREVIEW_TEAM_SEED`，确保只在 `env.preview.vars` 中保留 | `workers/agent-core/wrangler.jsonc` |
| KM R5 | /me/conversations next_cursor 恒为 null | `deferred-with-rationale` | cursor-based pagination 是 follow-up；当前 limit=200 已知限制；deferred | — |
| KM R6 | D1 migration 003/006 使用 table-swap 模式 | `deferred-with-rationale` | 当前数据量小，风险可控；production flip 前 owner dry-run 是 owner-action；deferred | — |

#### GLM R1–R12

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| GL R1 | NACP 错误信封生产路径与空 verb set 互斥（wrapAsError 无法通过 validateEnvelope） | `deferred-with-rationale` | 当前所有活跃 RPC 路径使用 Envelope<T> 的 ok:false 路径，不走 NacpEnvelope 错误信封，不是运行时 blocker；协议层断点已记录 closure §4；修复需 owner 决定方案 A/B；deferred | — |
| GL R2 | context-core/filesystem-core 脱离 probe-only shim，与 charter 叙事漂移 | `partially-fixed` | 默认导出已改为 WorkerEntrypoint（DS R5）；closure 文档更新为 partial-close 并明确标注 Lane E consumer migration deferred | `workers/context-core/src/index.ts`, `workers/filesystem-core/src/index.ts`, `docs/issue/zero-to-real/zero-to-real-final-closure.md` |
| GL R3 | 三层错误信封并存，缺少 facadeFromRpcEnvelope 桥接 | `deferred-with-rationale` | 需协议层重构；当前 wrapSessionResponse heuristic 可工作；deferred 为协议卫生 follow-up | — |
| GL R4 | VerifyApiKeyResultSchema 返回 supported:false，与 charter Z2 矛盾 | `deferred-with-rationale` | closure §4 item 12 已标注：需实装最小 verify 或将 Z1 charter 条目降级；deferred | — |
| GL R5 | handleRead timeline/status 双路径结构不一致 | `deferred-with-rationale` | 可维护性问题，不影响当前正确性；deferred 到 user-do 重构阶段 | — |
| GL R6 | bash-core BashCoreAllowedCallers 含幽灵调用者 "runtime" | `fixed` | 从 `BASH_CORE_ALLOWED_CALLERS` 数组中移除 `"runtime"`；rpc.test.ts 中对应测试更新为期望 `ok: false` | `workers/bash-core/src/index.ts`, `workers/bash-core/test/rpc.test.ts` |
| GL R7 | SHA-256(salt:raw) 密码哈希未在 charter 中声明安全边界 | `deferred-with-rationale` | Workers 环境已知妥协；需在 design 文档中声明；deferred 为文档 follow-up | — |
| GL R8 | last_seen_at 内部语义不一致 | `deferred-with-rationale` | 同 DS R15；内部字段 rename 影响多处；属于技术债；deferred | — |
| GL R9 | D1 single-writer 约束未文档化 | `deferred-with-rationale` | 架构约束需在文档中声明；deferred 为文档 follow-up | — |
| GL R10 | CapabilityCallDO 无持久状态，DO 语义冗余 | `deferred-with-rationale` | 低优先级平台优化；deferred | — |
| GL R11 | NacpObservabilityEnvelopeSchema 未在 nacp-core 主 index 导出 | `fixed` | 在 `packages/nacp-core/src/index.ts` 补导出 `NacpObservabilityEnvelopeSchema`, `NacpAlertSeveritySchema`, `NacpAlertScopeSchema`, `NacpAlertPayloadSchema` 及对应类型 | `packages/nacp-core/src/index.ts` |
| GL R12 | @nano-agent/ 与 @haimang/ 双 scope 并存 | `deferred-with-rationale` | @nano-agent/ 包（workspace-context-artifacts、eval-observability、storage-topology）已标记 DEPRECATED；cutover 是 P5 后续工作；deferred | — |

#### GPT R1–R7

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| GP R1 | D6 device revoke 只写 D1，不进入 access/refresh/WS auth gate | `deferred-with-rationale` | 需 device_uuid 进入 AccessTokenClaimsSchema + refresh gate + WS auth gate，是完整 auth enforcement 重构；closure §4 item 8 已标注为下一阶段 blocker | — |
| GP R2 | Permission/Elicitation/Usage 仍不是 live runtime | `partially-fixed` | onUsageCommit 已注册（DS R3）；hook dispatcher、WS frame emit、scheduler hook_emit deferred（DS R2/R4/R6）；closure 已更新 criterion 4 为 partial | `workers/agent-core/src/host/do/nano-session-do.ts`, `docs/issue/zero-to-real/zero-to-real-final-closure.md` |
| GP R3 | context/filesystem 仍是 host-local/minimal seam | `partially-fixed` | 默认导出已修复为 WorkerEntrypoint（DS R5）；agent-core binding 注释按 owner short-term shim 决策保持；closure criterion 5 已更新为 partial | `workers/context-core/src/index.ts`, `workers/filesystem-core/src/index.ts`, `docs/issue/zero-to-real/zero-to-real-final-closure.md` |
| GP R4 | jwt-shared lockfile/install truth 断裂 | `blocked` | pnpm install 需 NODE_AUTH_TOKEN（classic PAT w/ read:packages）；本轮无法在无 token 环境刷新 pnpm-lock.yaml；pre-existing 断点，closure §4 item 13 已标注 | — |
| GP R5 | ZX5 新 product endpoints 缺直达测试 | `deferred-with-rationale` | /messages / /files / /me/conversations / /me/devices/revoke 缺 endpoint-level 测试；closure §4 item 15 已标注；deferred | — |
| GP R6 | final closure 与代码事实分裂 | `fixed` | 将 zero-to-real-final-closure.md 状态改为 partial-close / handoff-ready；criterion 4 和 5 从 ✅ 改为 ✅ partial 并补充已知断点；新增 §4 items 8–15 覆盖全部审查后确认的未完成项；更新最终 verdict | `docs/issue/zero-to-real/zero-to-real-final-closure.md` |
| GP R7 | worker-matrix package truth 与当前 repo 状态需重新对账 | `deferred-with-rationale` | worker-matrix closure 作为历史文档保留；需补 "post-zero-to-real current package reality" 段落；deferred 为文档 follow-up | — |

### 6.3 Blocker / Follow-up 状态汇总

| 分类 | 数量 | 编号 | 说明 |
|------|------|------|------|
| 已完全修复 | 14 | DS R1, R5, R9, R10, R11, R12, R14, R17, R18, R23; KM R4; GL R6, R11; GP R6 | correctness + security + docs；全量测试已通过 |
| 部分修复，需二审判断 | 6 | DS R3; KM R1, R2; GL R2; GP R2, R3 | onUsageCommit console.log 注册 / WorkerEntrypoint export 修复；WS push 和 binding 活化 deferred |
| 有理由 deferred | 27 | DS R2, R4, R6, R7, R8, R13, R15, R16, R19, R20, R21, R22; KM R3, R5, R6; GL R1, R3, R4, R5, R7, R8, R9, R10, R12; GP R1, R5, R7 | 需 kernel 改造 / 协议重构 / owner-action / 纯文档；均已写入 closure §4 |
| blocked | 1 | GP R4 | jwt-shared lockfile 需 NODE_AUTH_TOKEN；CI 环境重建前无法完成 |

### 6.4 变更文件清单

- `workers/orchestrator-core/src/index.ts` — DS R1: needsBody 扩展至 messages / resume / permission/decision / policy/permission_mode / elicitation/answer
- `workers/orchestrator-core/src/user-do.ts` — DS R9: alarm() try/catch；DS R10: void→.catch()；DS R18: forwardInternalJson @deprecated
- `workers/orchestrator-core/src/session-truth.ts` — DS R12: inferMessageRole 改用 startsWith
- `workers/orchestrator-auth/src/index.ts` — DS R11: invokeKnown 增加 catch-all 包装为 worker-misconfigured
- `workers/orchestrator-auth/src/service.ts` — DS R14: expires_in 从 JWT claims 计算（2 处）
- `workers/agent-core/src/host/do/nano-session-do.ts` — DS R3: 注册 onUsageCommit callback（console.log 观测）
- `workers/agent-core/src/host/env.ts` — DS R17: R2_ARTIFACTS / KV_CONFIG 改为 optional 类型
- `workers/agent-core/wrangler.jsonc` — KM R4: 移除 top-level NANO_AGENT_ALLOW_PREVIEW_TEAM_SEED
- `workers/bash-core/src/index.ts` — GL R6: 移除幽灵 "runtime" 调用者
- `workers/context-core/src/index.ts` — DS R5: 默认导出改为 ContextCoreEntrypoint；新增 fetchWorker 命名导出
- `workers/filesystem-core/src/index.ts` — DS R5: 默认导出改为 FilesystemCoreEntrypoint；新增 fetchWorker 命名导出
- `packages/jwt-shared/src/index.ts` — DS R23: verifyJwt exp check 应用 JWT_LEEWAY_SECONDS
- `packages/nacp-core/src/index.ts` — GL R11: 补导出 NacpObservabilityEnvelopeSchema 及相关 Schema / 类型
- `docs/issue/zero-to-real/zero-to-real-final-closure.md` — GP R6: 降级为 partial-close；更新 criterion 4/5；新增 §4 items 8–15；更新 verdict
- `workers/orchestrator-core/test/auth.test.ts` — expired token 从 -10s 改为 -400s（超过 JWT_LEEWAY_SECONDS=300）
- `workers/bash-core/test/rpc.test.ts` — "admits caller='runtime'" 改为期望 ok: false
- `workers/context-core/test/smoke.test.ts` — 导入改为 `fetchWorker` 命名导出
- `workers/filesystem-core/test/smoke.test.ts` — 导入改为 `fetchWorker` 命名导出

### 6.5 验证结果

| 验证项 | 命令 | 结果 | 覆盖的 finding |
|--------|------|------|----------------|
| orchestrator-core 全量测试 | `pnpm --filter @haimang/orchestrator-core-worker test` | `pass (80/80)` | DS R1, R9, R10, R12, R18 |
| orchestrator-auth 全量测试 | `pnpm --filter @haimang/orchestrator-auth-worker test` | `pass (13/13)` | DS R11, R14 |
| orchestrator-auth-contract 全量测试 | `pnpm --filter @haimang/orchestrator-auth-contract test` | `pass (19/19)` | — |
| agent-core 全量测试 | `pnpm --filter @haimang/agent-core-worker test` | `pass (1056/1056)` | DS R3, R17, KM R4 |
| bash-core 全量测试 | `pnpm --filter @haimang/bash-core-worker test` | `pass (374/374)` | GL R6 |
| context-core 全量测试 | `pnpm --filter @haimang/context-core-worker test` | `pass (171/171)` | DS R5, KM R1 |
| filesystem-core 全量测试 | `pnpm --filter @haimang/filesystem-core-worker test` | `pass (294/294)` | DS R5 |
| root contracts | `pnpm test:contracts` | `pass (31/31)` | — |
| jwt-shared standalone build/test | `pnpm --filter @haimang/jwt-shared build && test` | `fail (vitest/tsc not found)` | GP R4 — pre-existing lockfile 断点，非本轮回归 |

```text
orchestrator-core         80 / 80   pass
orchestrator-auth         13 / 13   pass
orchestrator-auth-contract 19 / 19  pass
agent-core              1056 / 1056 pass
bash-core                374 / 374  pass
context-core             171 / 171  pass
filesystem-core          294 / 294  pass
contracts                 31 / 31   pass

jwt-shared               FAIL — sh: 1: vitest: not found
                         pre-existing lockfile issue (GP R4); not introduced by this PR
```

### 6.6 未解决事项与承接

| 编号 | 状态 | 不在本轮完成的原因 | 承接位置 |
|------|------|--------------------|----------|
| DS R2, R4, R6（Lane F dispatcher 整体） | `deferred` | 需要 scheduler hook_emit 决策产生 + hook.emit 真实 delegate + emitPermissionRequestAndAwait 调用方；是 Lane F 整体工作，需独立 sprint | closure §4 item 9 |
| DS R3 / KM R2 / GP R2（onUsageCommit WS push） | `partially-fixed` | callback 已注册；完整 session.usage.update WS push 需 orchestrator-core 侧 connected WS helper 协调 | closure §4 item 10 |
| DS R7（D1 先写后验） | `deferred` | handleMessages 回滚逻辑需仔细设计；当前 turn 标 failed 作为临时保障 | 下一阶段 session-truth hardening |
| DS R8（/me/conversations 双源） | `deferred` | KV-to-D1 迁移策略未定；需与 handleMeSessions 读取对齐 | closure §4 item 14 |
| DS R13（recordStreamFrames 事务） | `deferred` | 低发生频率；补偿逻辑是独立 PR | 下一阶段 stream-truth hardening |
| DS R15 / GL R8（last_seen_at 语义） | `deferred` | 全量 rename 影响多处 KV schema；是技术债清理 | 下一阶段 session schema cleanup |
| DS R16（device revoke batch） | `deferred` | 仅影响 audit 完整性；可在 D6 auth gate 完整闭合时同步处理 | GP R1 承接位置 |
| DS R19–R22（streamSnapshot / handleResume / README / checkpointOnTurnEnd） | `deferred` | 低优先级代码卫生 / 文档 | 下一阶段 polish |
| KM R1 / GP R3（Lane E consumer migration） | `deferred` | agent-core binding 注释按 owner short-term shim 决策保持；RPC-first 路径需 CONTEXT_CORE_RPC_FIRST env flag 切换机制后启动 | closure §4 item 11 |
| KM R3（user-do.ts 拆分） | `deferred` | 需完整测试矩阵保障的 domain 拆分；属于 post-zero-to-real 首选技术债 | 下一阶段 |
| KM R5（next_cursor pagination） | `deferred` | cursor-based pagination 需 D1 view；当前 limit=200 已知限制已标注 | 下一阶段产品化 |
| KM R6（D1 migration table-swap） | `deferred` | production flip 前 owner dry-run；低风险 | owner-action |
| GL R1（NACP error verb 注册） | `deferred` | 协议层决策（注册 verb vs 废弃 wrapAsError）需 owner 定夺；当前 runtime 不走此路径 | 下一阶段协议演进 |
| GL R3（三层错误信封 + facadeFromRpcEnvelope） | `deferred` | 需 auth-contract 重构；当前可工作 | 下一阶段协议演进 |
| GL R4（VerifyApiKey supported:false） | `deferred` | 实装最小 verify 或降级 charter；closure §4 item 12 已标注 | closure §4 item 12 |
| GL R5, R7, R9, R10, R12（medium/low） | `deferred` | 技术债 / 文档 / 安全声明；逐条在下一阶段处理 | 下一阶段 |
| GP R1（D6 device revoke auth gate） | `deferred` | 需 device_uuid 进入 JWT claims + refresh gate + WS auth gate，是 auth enforcement 重构 | closure §4 item 8 |
| GP R4（jwt-shared lockfile） | `blocked` | 需 NODE_AUTH_TOKEN（classic PAT w/ read:packages）重建 pnpm-lock.yaml；本轮环境无法完成 | closure §4 item 13 |
| GP R5（endpoint tests） | `deferred` | /messages / /files / /me/conversations / /me/devices/revoke 需 endpoint-level 测试 | closure §4 item 15 |
| GP R7（worker-matrix package truth） | `deferred` | 历史 closure 需补 "post-zero-to-real current package reality" 段落 | 下一阶段文档 |

### 6.7 Ready-for-rereview gate

- **是否请求二次审查**：`yes`
- **请求复核的范围**：`DS R1 / DS R5 / DS R9–R12 / DS R14 / DS R17 / DS R23 / KM R4 / GL R6 / GL R11 / GP R6 的修复实现；以及 DS R3/KM R2/GP R2 的 partially-fixed 接受程度`
- **实现者认为可以关闭的前提**：
  1. 上述 14 个已修条目经二次审查确认符合预期。
  2. DS R3/KM R2/GP R2 的 onUsageCommit console.log 注册被接受为 "partial close"（WS push 明确 deferred）。
  3. DS R5/KM R1/GL R2/GP R3 的 WorkerEntrypoint 默认导出修复被接受；agent-core binding 注释作为 owner short-term shim 决策可接受。
  4. GP R4（jwt-shared lockfile）被接受为 blocked，不阻塞本轮闭合。
  5. zero-to-real-final-closure.md 的 partial-close / handoff-ready 表述被接受为阶段级 truth anchor。

---

## 7. 审查质量评价

> 评价对象: `GPT-5.5 对 zero-to-real + ZX5 rereview + 6-worker/packages 的代码审查`
> 评价人: `Claude Sonnet 4.6（实现者，结合本轮真实修复结果）`
> 评价时间: `2026-04-29`

### 7.0 评价结论

- **一句话评价**：以"closure 真相 vs 代码现实 vs api-docs 三方对账"为切入点，是 4 家中阶段级 truth anchor 把握最强、对 closure 措辞降级要求最坚定的审查；唯一明确把 D6 device revoke auth gate 上升为 zero-to-real blocker 的 reviewer。
- **综合评分**：`8.8 / 10`
- **推荐使用场景**：阶段闭合（closure）的最终把关、charter exit criteria 与代码事实 vs 客户端 docs 的三方对账、D1/auth/security 语义的端到端核查、partial-close vs full-close 的判定。
- **不建议单独依赖的场景**：runtime correctness 全链路调用链对账（不及 DeepSeek 深入）、协议层 schema 注册表完整性核查（不及 GLM 深入）。

### 7.1 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | `closure 真相对账 + auth/security 端到端语义` | R1 串起 `migrations/007-user-devices.sql` 冻结的预期行为 ↔ `index.ts:710-721 TODO` ↔ `AccessTokenClaimsSchema 缺 device_uuid` ↔ `verifyAccessToken 不读 D1`，证明 D6 不是 partial 而是 auth gate 完全缺失 |
| 证据类型 | `精确行号 + charter exit criteria + client api-docs 三方对账` | 几乎每个 finding 都同时引用代码行号、charter §X.Y、`clients/api-docs/README.md` 的对应描述，形成三方互证 |
| Verdict 倾向 | `STRICT-CLOSURE — 7 finding 中 4 个 blocker，全部围绕"是否能闭合 zero-to-real"` | R6 (final closure 与代码事实分裂) 直接要求把 closure 改为 partial-close；R1/R2/R4 都把 zero-to-real 闭合作为判断尺度 |
| Finding 粒度 | `COARSE — 仅 7 项，但每项都是阶段级判断` | 不追求 finding 数量；R7 (worker-matrix package truth) 这种纯 docs 项也被独立拎出来作为 P5 cutover 的真相要求 |
| 修法建议风格 | `ACTIONABLE，强调 "实装 OR 降级 charter" 二选一` | R1/R2 都给"补 device_uuid claim+gate"或"把 zero-to-real charter 降级"二选一；R6 直接给"将 closure 改为 partial-close / handoff-ready"的具体措辞建议 |

### 7.2 优点与短板

#### 7.2.1 优点

1. **唯一把 D6 device revoke 上升为 zero-to-real blocker**：R1 不止指出 D6 当前只写 D1（这是 closure §4 已经默认接受的），而是把它与"完整 end-user auth truth 已成立"的 zero-to-real exit criterion 直接对账，证明这个 exit criterion 当前不满足。其他 3 家审查没有上升到这个 charter 维度。
2. **三方对账（代码 ↔ charter ↔ api-docs）的 paper-trail 最完整**：R6 直接列出 `zero-to-real-final-closure.md:56-70` 标 ✅ vs `ZX5-closure.md:309-315` 标 partial vs `clients/api-docs/README.md:82-86` 标 not-live 三个仓库内部说法不一致——这是 closure 治理上的硬证据。本轮已 fixed（closure 降级为 partial-close）。
3. **R4 (jwt-shared lockfile) 是 4 家中唯一的 install/build truth 核查**：通过实际跑 `pnpm --filter @haimang/jwt-shared build/test` 暴露出 standalone build/test 失败 + lockfile 缺新 importer + 仍保留旧物理删除包的 importer 三层断点。这种"手动跑命令验证"的核查方式比静态分析更扎实。
4. **R5 (endpoint tests gap) 视角独特**：明确指出 ZX5 D3-D6 新增的 `/messages` `/files` `/me/conversations` `/me/devices*` 缺直达测试。这与 DeepSeek/kimi/GLM 全部漏掉——他们都只看代码本身存在与否，没有上升到"测试矩阵未覆盖产品面"的判断。
5. **R7 worker-matrix package truth 对账**：4 家中唯一指出 `worker-matrix-final-closure.md:56-75` 仍描述"9 个 Tier B + 7 CHANGELOG"但当前物理只有 7 packages 的差异；提醒 closure 文档作为下一阶段 truth anchor 不能继续陈旧化。

#### 7.2.2 短板 / 盲区

1. **needsBody 硬断点漏掉**：DeepSeek R1 (5 条 POST 路由请求体被 silent-drop) 是产品级 critical bug，GPT 完全没看出。原因是 GPT 的审查路径偏 closure / charter / endpoint metadata，没有深入 `index.ts:430` needsBody 判定的具体逻辑。
2. **WorkerEntrypoint 默认导出错误漏掉**：DeepSeek R5 (context/filesystem-core default export 是 plain `{fetch}` 不是 WorkerEntrypoint，导致 RPC 不可达) 也漏掉。GPT R3 触及周边问题（context/filesystem 仍是 minimal seam）但没下沉到"default export 形态错误"这层。
3. **alarm() 无 try/catch 漏掉**：DeepSeek R9 这种生产稳定性陷阱完全不在 GPT 的审查面内。
4. **NACP 协议层断点漏掉**：GLM R1 (NACP_ERROR_BODY_VERBS 空集 vs wrapAsError 互斥) 也未被 GPT 发现。GPT 没有审查 nacp-core 包内部实现。
5. **finding 粒度偏粗，medium 项未细分**：R3 把 context/filesystem 当 1 个 medium finding，但其实包含了 binding 注释、consumer migration、`/debug/workers/health` direct binding 三个独立子问题——拆分会让修复 priority 排序更清晰。

### 7.3 Findings 质量清点

| 问题编号 | 原始严重程度 | 事后判定 | Finding 质量 | 分析与说明 |
|----------|--------------|----------|--------------|------------|
| R1 | high / security | true-positive / missed-by-others | excellent | D6 device revoke 不是 partial 而是 auth gate 完全缺失；4 家中唯一上升到 zero-to-real exit criterion 维度；deferred（closure §4 item 8 标注为下一阶段 blocker）|
| R2 | high | true-positive | good | Permission/Elicitation/Usage 不是 live runtime；与 DeepSeek R2/R3/R4/R6 同方向但 GPT 把判断停在 "wiring deferred" 层（DeepSeek 拆出 4 条具体断点更细）；本轮 partially-fixed |
| R3 | medium | true-positive | mixed | context/filesystem 是 minimal seam；包含 3 个子问题（binding 注释 / consumer migration / `/debug/workers/health` direct binding）但合并为 1 finding 偏粗；本轮 partially-fixed |
| R4 | medium | true-positive / missed-by-others | excellent | jwt-shared lockfile/install truth 断裂；4 家中独有；通过实际跑 build/test 命令验证；本轮 blocked（需 NODE_AUTH_TOKEN 环境）|
| R5 | medium | true-positive / missed-by-others | excellent | ZX5 新 product endpoints 缺直达测试；4 家中独有；deferred；视角独到 |
| R6 | medium | true-positive | excellent | final closure 与代码事实分裂；三方对账（代码 ↔ ZX5-closure ↔ api-docs）paper-trail 最完整；本轮 fixed（closure 降级为 partial-close）|
| R7 | low | true-positive / missed-by-others | good | worker-matrix package truth 与 7 packages 现实对账；4 家中独有；deferred 为文档 follow-up |

**统计**：7 findings 全部 true-positive，0 false-positive，4 项 missed-by-others（R1 / R4 / R5 / R7），本轮 fixed 1 项 + partially-fixed 2 项 + blocked 1 项 + deferred 3 项。

### 7.4 多维度评分 — 单向总分 10 分

| 维度 | 评分 | 说明 |
|------|-----|------|
| 证据链完整度 | `9.5` | 7 个 finding 全部三方对账（代码行号 + charter §X.Y + api-docs 描述）；R4 还附实际 build/test 命令的失败输出作为 install truth 断裂证据 |
| 判断严谨性 | `9.5` | 0 false-positive；R1 把 D6 从 closure §4 已默认接受的 partial 上升为 zero-to-real blocker，校准非常清晰 |
| 修法建议可执行性 | `9.0` | "实装 OR 降级 charter" 二选一风格；R6 直接给出具体措辞建议（"将 closure 改为 partial-close / handoff-ready"）|
| 对 action-plan / design / QNA 的忠实度 | `10.0` | 4 家中最强；每个 finding 都对照 charter exit criteria；§3 In-Scope 逐项对齐表是阶段闭合判断的标准模板 |
| 协作友好度 | `9.0` | 友好；不情绪化；明确给出"关闭前必须完成的 blocker"+"可后续跟进的 non-blocking follow-up"分级 |
| 找到问题的覆盖面 | `7.5` | 7 项覆盖 security / delivery-gap / scope-drift / docs-gap；4 项 missed-by-others 是阶段级判断的独到视角；但 runtime correctness / 协议层 / 生产稳定性陷阱全部漏掉 |
| 严重级别 / verdict 校准 | `9.0` | high blocker / medium follow-up 分级清晰；R3 略偏粗（应拆 3 项），其他全部校准合理 |
| **加权综合** | **`8.8`** | 阶段闭合把关的标杆；charter-vs-代码-vs-api-docs 三方对账深度 4 家最强；唯一短板是 runtime correctness 调用链审计偏弱 |
