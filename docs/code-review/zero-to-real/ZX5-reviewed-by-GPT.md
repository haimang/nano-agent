# Nano-Agent 代码审查

> 审查对象: `ZX5-protocol-hygiene-product-surface-architecture`
> 审查类型: `mixed`
> 审查时间: `2026-04-28`
> 审查人: `GPT-5.4`
> 审查范围:
> - `docs/action-plan/zero-to-real/ZX5-protocol-hygiene-product-surface-architecture.md`
> - `docs/issue/zero-to-real/ZX5-closure.md`
> - `docs/issue/zero-to-real/zero-to-real-final-closure.md`
> - `workers/agent-core/**`
> - `workers/orchestrator-core/**`
> - `workers/context-core/**`
> - `workers/filesystem-core/**`
> - `packages/jwt-shared/**`
> - `packages/orchestrator-auth-contract/**`
> - `clients/api-docs/**`
> 对照真相:
> - `docs/action-plan/zero-to-real/ZX5-protocol-hygiene-product-surface-architecture.md`
> - `docs/issue/zero-to-real/ZX5-closure.md`
> - `docs/issue/zero-to-real/zero-to-real-final-closure.md`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`ZX5 的主体完成度较高，但当前不应按 closure 文案标记为 fully closed；它更接近“Lane C 与部分 Lane D/F4 落地，Lane E/F 仍未真正收口，client-facing truth 发生明显漂移”。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `Lane F 实际只落了 wait-and-resume infra 与 usage callback seam，Permission/Elicitation runtime resume 与 live usage push 都没有形成端到端闭环。`
  2. `Lane E 实际只把 context-core / filesystem-core 暴露成 minimal WorkerEntrypoint seam；agent-core 仍未切到 service binding 主路径，仓库自述仍是 probe-only posture。`
  3. `ZX5 新增 product surface 已进入代码，但 clients/api-docs 与 zero-to-real 最终闭合叙事没有同步，导致 public contract truth、closure truth、代码事实三者分裂。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/zero-to-real/ZX5-protocol-hygiene-product-surface-architecture.md`
  - `docs/issue/zero-to-real/ZX5-closure.md`
  - `docs/issue/zero-to-real/zero-to-real-final-closure.md`
  - `docs/templates/code-review.md`
- **核查实现**：
  - `packages/jwt-shared/src/index.ts`
  - `workers/orchestrator-auth/src/jwt.ts`
  - `packages/orchestrator-auth-contract/src/facade-http.ts`
  - `workers/orchestrator-core/src/{index,user-do,session-truth}.ts`
  - `workers/agent-core/src/host/{do/nano-session-do,runtime-mainline}.ts`
  - `workers/agent-core/src/hooks/permission.ts`
  - `workers/context-core/src/index.ts`
  - `workers/filesystem-core/src/index.ts`
  - `clients/api-docs/{README,session,session-ws-v1,permissions}.md`
- **执行过的验证**：
  - `pnpm test:contracts`
  - `bash -n scripts/deploy-preview.sh`
  - `find workers -mindepth 1 -maxdepth 1 -type d | wc -l`
- **复用 / 对照的既有审查**：
  - `none` — `本文件的判断只基于当前 action-plan / closure / 代码 / 测试与客户端文档事实；未采纳其他 reviewer 的结论。`

### 1.1 已确认的正面事实

- `Lane C` 的核心交付真实存在：`packages/jwt-shared` 已创建，两侧 worker 已切换，`workers/orchestrator-auth/test/kid-rotation.test.ts` 也已补上 kid rotation 测试；`packages/orchestrator-auth-contract/src/facade-http.ts` 已有 `_rpcErrorCodesAreFacadeCodes` 断言。
- `Lane D` 的部分产品面真实存在：`workers/orchestrator-core/src/user-do.ts` 已实现 `handleMessages()`、`handleFiles()`、`handleMeConversations()`，`workers/orchestrator-core/src/index.ts` 已接入 `GET /me/conversations`、`GET /me/devices`、`POST /me/devices/revoke` 路由；catalog 也已从 placeholder 变为静态 registry。
- `Lane F4` 的 `handleStart` 并发 claim 修法真实存在：`workers/orchestrator-core/src/session-truth.ts` 增加了 `claimPendingForStart()`，`workers/orchestrator-core/src/user-do.ts` 也在 side-effect 前执行 D1 conditional claim。
- 本轮能独立复核的根层 contracts 通过：`pnpm test:contracts` 成功，`scripts/deploy-preview.sh` 语法有效，仓库目录现实仍是 `6 workers / 7 packages`。

### 1.2 已确认的负面事实

- `Lane F` 没有达到 plan/closure 声称的 runtime closure：`workers/agent-core/src/hooks/permission.ts` 仍是同步 `verdictOf()` 模型；`NanoSessionDO.emitPermissionRequestAndAwait()` / `emitElicitationRequestAndAwait()` 只是等待 storage decision，并没有实际发 live WS request frame；`createLiveKernelRunner()` 也没有把 `onUsageCommit` 传入 `createMainlineKernelRunner()`。
- `Lane E` 没有达到 “agent-core 通过 service binding 调真 RPC” 的收口标准：`workers/agent-core/wrangler.jsonc` 里 `CONTEXT_CORE` / `FILESYSTEM_CORE` 仍是注释状态；`workers/context-core/src/index.ts` 与 `workers/filesystem-core/src/index.ts` 暴露的也只是 `probe / nacpVersion / *Ops()` 最小缝；`test/INDEX.md` 仍把两者描述为 `remain probe-only`。
- `clients/api-docs` 与 ZX5 现实严重漂移：`clients/api-docs/README.md` 仍把 `POST /sessions/{id}/messages`、`GET /sessions/{id}/files`、`GET /me/conversations`、`POST /me/devices/revoke` 写成“尚未实现”；但代码里这些路径已经存在。反过来，`session-ws-v1.md` / `permissions.md` 对 “permission / usage / elicitation 还未 live” 的保守描述却是对的，这与 ZX5 closure 的 runtime 完成叙事直接冲突。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 直接核对了 ZX5 action-plan、closure、zero-to-real final closure、相关 worker 实现、测试目录与 client API docs。 |
| 本地命令 / 测试 | `yes` | 运行了 `pnpm test:contracts`、`bash -n scripts/deploy-preview.sh`，并核对了 workers/packages 目录数量。 |
| schema / contract 反向校验 | `yes` | 对照了 `facade-http-v1`、`session-ws-v1`、`clients/api-docs` 与实际 route / runtime wire 的一致性。 |
| live / deploy / preview 证据 | `no` | 本轮未以 live deploy 作为主要证据来源；closure 中的 live 叙事没有被直接采纳为事实。 |
| 与上游 design / QNA 对账 | `yes` | 逐项对照了 ZX5 plan 的 In-Scope / DoD / closure claim 与真实代码落点。 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | Lane F 仍停在 infra seam，runtime kernel hookup 被 closure 明显写满 | `high` | `delivery-gap` | `yes` | 要么补齐 hook dispatcher / WS request emit / usage push / e2e，要么下调 ZX5 与 zero-to-real closure 结论 |
| R2 | Lane E 仍是 minimal RPC seam + probe-only posture，不是 agent-core 已切真 RPC | `high` | `scope-drift` | `yes` | 明确把 Lane E 改写为 partial，或继续完成 binding 打开、agent-core 调用切换与对应测试 |
| R3 | client-facing contract truth 严重漂移，clients/api-docs 与代码现实相互矛盾 | `medium` | `docs-gap` | `yes` | 立即按当前 facade 真实接口重写 `clients/api-docs`，并同步修正 zero-to-real 对 “real clients closed” 的叙述边界 |
| R4 | `GET /me/conversations` 的 `last_seen_at` 命名与实现语义不一致 | `medium` | `protocol-drift` | `no` | 改成真实活动时间字段，或把字段重命名为更准确的排序/最新 session 含义 |
| R5 | ZX5 新 product endpoints 缺少明确的直达测试证据 | `medium` | `test-gap` | `no` | 为 `/messages`、`/files`、`/me/conversations`、`/me/devices*` 增加 unit/integration 覆盖，或降低 closure 的“全收口”措辞 |

### R1. Lane F 仍停在 infra seam，runtime kernel hookup 被 closure 明显写满

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/action-plan/zero-to-real/ZX5-protocol-hygiene-product-surface-architecture.md:485-490` 要求 Lane F 收口至少包含 PermissionRequest / ElicitationRequest await-resume、`session.usage.update` live push 与对应 e2e。
  - `workers/agent-core/src/hooks/permission.ts:50-69` 仍然只是 `AggregatedHookOutcome -> allow/deny` 的同步翻译，没有任何 await / resume 路径。
  - `workers/agent-core/src/host/do/nano-session-do.ts:771-803` 的 `emitPermissionRequestAndAwait()` / `emitElicitationRequestAndAwait()` 只调用 `awaitAsyncAnswer()`，没有实际 `emitServerFrame(...)` 或等价 live request emit。
  - `workers/agent-core/src/host/runtime-mainline.ts:96-114,245-251` 虽然已经支持 `onUsageCommit` callback，但 `workers/agent-core/src/host/do/nano-session-do.ts:481-490` 创建 kernel runner 时没有把该 callback 传进去。
  - `clients/api-docs/session-ws-v1.md:102-112` 与 `clients/api-docs/permissions.md:117-125` 仍明确写着 permission / usage / elicitation 还没有成为 live WS 行为，这反而更接近代码现实。
- **为什么重要**：
  - 这不是“还差一点 polish”，而是 plan 里明确定义为 ZX4 cluster work 真正 closure 的核心部分。
  - 如果 runtime 不会等待用户 decision、不会 live 推 usage、不会发出真实 request frame，那么前端拿到的仍是 contract layer，而不是可消费的 end-to-end runtime capability。
- **审查判断**：
  - ZX5 Lane F 当前只能算 **F4 done + F1/F2/F3 partial + F5 missing**。
  - `docs/issue/zero-to-real/ZX5-closure.md` 与 `docs/issue/zero-to-real/zero-to-real-final-closure.md` 因此都存在过度完工叙事。
- **建议修法**：
  - 二选一，且必须明确：
  - 1. **补实现**：把 Permission/Elicitation hook 真正接到 DO waiter，给 WS 发 live request frame，把 `onUsageCommit` 真正接入 `NanoSessionDO`，并补 cross-e2e。
  - 2. **补真相**：把 ZX5 closure 与 zero-to-real final closure 降级为 “infra landed, runtime consumer deferred”，并把 Lane F 重新打开为 follow-up phase。

### R2. Lane E 仍是 minimal RPC seam + probe-only posture，不是 agent-core 已切真 RPC

- **严重级别**：`high`
- **类型**：`scope-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/action-plan/zero-to-real/ZX5-protocol-hygiene-product-surface-architecture.md:479-483,498-499` 对 Lane E 的收口要求是：context/filesystem 升级为真 RPC，且 agent-core 通过 short-term shim 改成 service binding 调用。
  - `workers/agent-core/wrangler.jsonc:41-48` 明确写着 `CONTEXT_CORE / FILESYSTEM_CORE stay commented`，说明 deploy truth 仍未打开两个 service binding。
  - `workers/context-core/src/index.ts:61-106` 与 `workers/filesystem-core/src/index.ts:71-85` 暴露的只是 `assemblerOps()` / `filesystemOps()` 等 op 列表，不是 plan 里写的 `assemble / compact / get_layers`、`read_file / write_file` 等真实业务 RPC。
  - `workers/agent-core/src/host/do/nano-session-do.ts:994-1012` 仍直接使用 `@haimang/context-core-worker/context-api/append-initial-context-layer` 的 in-process import。
  - `workers/agent-core/src/host/do/nano-session-do.ts:2035-2049` 的 `verifyFilesystemPosture()` 仍返回 `hostLocalFilesystem: true`。
  - `test/INDEX.md:126-130` 仍把 `context/filesystem` 描述成 `remain probe-only`。
- **为什么重要**：
  - Lane E 的目标不是“多两个可探测 worker class”，而是把 6-worker 拓扑里的这两条边真正从 library-only 提升为 cross-worker seam。
  - 如果 deploy binding 没开、agent-core 仍走 host-local import、tests 仍把它们当 probe-only，那么 closure 不能把这条 lane写成已收口。
- **审查判断**：
  - 当前更准确的状态是：**minimal RPC surface landed, consumer migration deferred**。
  - 这和 plan / closure 里“真 RPC uplift 已完成”的表述不是一回事。
- **建议修法**：
  - 1. 若要按 ZX5 收口：打开 `CONTEXT_CORE` / `FILESYSTEM_CORE` binding，给 agent-core 增加真正的 remote path，并让测试矩阵从 `probe-only` 转成真实调用验证。
  - 2. 若不准备继续推进：把 Lane E 明确降级成 “RPC seam prework”，不要继续在 closure 里表述为完成态。

### R3. client-facing contract truth 严重漂移，clients/api-docs 与代码现实相互矛盾

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `clients/api-docs/README.md:70-78` 仍把 `POST /sessions/{id}/messages`、`GET /sessions/{id}/files`、`GET /me/conversations`、`POST /me/devices/revoke` 写成“尚未实现，不应被当前前端调用”。
  - 但 `workers/orchestrator-core/src/user-do.ts:1498-1672,1783-1862` 与 `workers/orchestrator-core/src/index.ts:572-629,631-690` 证明这些路径已经有真实实现。
  - 同一个 README `clients/api-docs/README.md:67` 仍说 catalog “内容仍为空数组 placeholder”，而 `workers/orchestrator-core/test/smoke.test.ts:311-371` 已按“non-empty registry”写断言。
  - 反过来，`clients/api-docs/session-ws-v1.md:104-112` 与 `clients/api-docs/permissions.md:117-125` 把 WS live request/usage 能力写成未落地，这又恰好与代码现实一致，直接暴露出 closure 文案与 public docs 的相互打架。
- **为什么重要**：
  - 这已经不只是“文档忘了更新”，而是客户端 contract truth 失去单一真相。
  - 对前端/BFF/外部消费方而言，当前最危险的不是某个接口没做，而是“代码、closure、api-docs 三者给出互相矛盾的答案”。
- **审查判断**：
  - ZX5 D lane 进入了代码，但并没有同步收敛成稳定的 client-facing truth。
  - `zero-to-real-final-closure.md` 中关于 “real clients closed / first-wave baseline” 的叙事，因此也被削弱了可信度。
- **建议修法**：
  - 立即以 `workers/orchestrator-core` public facade 为唯一真相重写 `clients/api-docs/`。
  - 每个接口必须明确区分：`implemented`、`partial/stub`、`future-not-live`，并同步修正 zero-to-real final closure 对客户端完成态的边界表达。

### R4. `GET /me/conversations` 的 `last_seen_at` 命名与实现语义不一致

- **严重级别**：`medium`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts:588-590` 的 route 注释把 `last_seen_at` 写成 `latest session.started_at in conv`。
  - `workers/orchestrator-core/src/user-do.ts:1835-1843` 首次建 conversation row 时直接把 `last_seen_at` 赋值为 `row.started_at`。
  - `workers/orchestrator-core/src/user-do.ts:1847-1852` 后续 group merge 只会更新 `started_at` 的最早值，不会真正计算 conversation 的最后活动时间。
- **为什么重要**：
  - `last_seen_at` 这个名字在客户端天然会被理解为“最后活跃时间 / 最后可见变更时间”，而不是“最新 session 的 started_at”。
  - 如果后续用它做排序、未读、最近活跃列表或会话摘要，语义会持续漂移。
- **审查判断**：
  - 这不是当前阶段的硬 blocker，但它说明 read-model 命名已经先于真实语义扩散。
- **建议修法**：
  - 要么把字段重命名成更诚实的 `latest_session_started_at`；
  - 要么在 D1/read-model 中真正引入 conversation 级最后活动时间并据此填充 `last_seen_at`。

### R5. ZX5 新 product endpoints 缺少明确的直达测试证据

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/test/smoke.test.ts:311-371` 只明确覆盖了 catalog registry。
  - `test/INDEX.md:121-133` 的 package/cross-e2e 列表中，没有看到 `/messages`、`/files`、`/me/conversations`、`/me/devices*` 对应的独立测试入口。
  - 本轮代码搜索也没有在 `workers/orchestrator-core/test` 与 `test/` 下找到这些 ZX5 新 endpoints 的直接测试项。
- **为什么重要**：
  - ZX5 D lane 的新增面本身就带有语义选择：`/messages` 与 `/input` 的关系、`/files` 只返 metadata、`/me/conversations` 的 read-model 聚合、`/me/devices/revoke` 的 best-effort 边界。
  - 这些都不是“看代码就稳定”的面，没有直达测试，后续回归时很容易被误改。
- **审查判断**：
  - 现有测试更像守住旧主链和 catalog，而不是证明 D3-D6 已经稳定可依赖。
- **建议修法**：
  - 给 `/messages`、`/files`、`/me/conversations`、`/me/devices`、`/me/devices/revoke` 补最小 unit/integration 覆盖。
  - 如果短期不补，就不要继续在 closure 中把 D lane描述成“完整产品面已收口”。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | `jwt-shared package 创建 + 两 worker 切换 + kid rotation 测试` | `done` | 包、调用切换、rotation tests 都能在代码层看到真实落点。 |
| S2 | `RpcErrorCode ⊂ FacadeErrorCode 跨包断言` | `done` | `packages/orchestrator-auth-contract/src/facade-http.ts` 已有断言。 |
| S3 | `envelope 关系文档化` | `done` | auth-contract README 与 nacp-core README 已补 cross-link。 |
| S4 | `web / wechat client 切 shared helper` | `partial` | 行为阈值对齐了，但仍是 local mirror / adapter 形态，不是 plan 里更理想的单一 source 消费。 |
| S5 | `WORKER_VERSION owner-local 注入` | `done` | `scripts/deploy-preview.sh` 已存在且脚本语法正确。 |
| S6 | `catalog content 填充` | `done` | registry 已非空，测试也已从 empty 改为 non-empty。 |
| S7 | `4 个 product endpoint` | `partial` | 代码实现已存在，但 client docs、测试与部分语义收口仍明显不足。 |
| S8 | `context-core / filesystem-core 升级真 RPC，保持 6-worker` | `partial` | WorkerEntrypoint seam 已有，但 bindings 未启用、agent-core 未主切、tests 仍是 probe-only。 |
| S9 | `ZX4 cluster runtime kernel hookup` | `missing` | F1/F2/F3 的核心消费链没有真正完成，只落了 infra seam。 |
| S10 | `handleStart idempotency` | `done` | D1 conditional claim 已进主线，且有针对性测试。 |
| S11 | `R28 owner-driven 根因定位` | `stale` | runbook 模板已建，但根因、决策、closure 回填都还未发生。 |

### 3.1 对齐结论

- **done**: `6`
- **partial**: `3`
- **missing**: `1`
- **stale**: `1`
- **out-of-scope-by-design**: `0`

这更像 **“ZX5 完成了协议卫生、部分产品补面与一个关键并发修补，但真正的 runtime/kernel closure 与 library-worker topology uplift 还停在预备态”**，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | `不新增 worker / 不创建 workers/session-do` | `遵守` | ZX5 期间 worker 数量仍为 6，未出现第 7 个 session-do worker。 |
| O2 | `user-do 巨石进一步 refactor 不作为 ZX5 强制目标` | `遵守` | `workers/orchestrator-core/src/user-do.ts` 仍是巨石，这不是本轮 blocker。 |
| O3 | `prod migration apply 不属于 ZX5 phase` | `遵守` | 未看到把 prod migration 伪装成已执行代码交付。 |
| O4 | `WeChat 真机 smoke / owner live ops` | `误报风险` | 本轮不应把 owner-side live evidence 缺失本身误判为代码 blocker；真正的问题是 closure 把未执行的 owner-action 写成已完成态。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. `对 Lane F 和 Lane E 二选一：要么补齐剩余 wiring 与测试，要么把 ZX5 closure / zero-to-real final closure 明确降级为 partial-close，不得继续宣称 runtime kernel hookup 与 true RPC uplift 已完成。`
  2. `重写 clients/api-docs，使 public contract truth 与当前 facade 代码保持一致，并同步修正 zero-to-real 对 “real clients closed” 的边界表述。`
- **可以后续跟进的 non-blocking follow-up**：
  1. `修正 /me/conversations 的 last_seen_at 语义或字段命名。`
  2. `为 ZX5 新 product endpoints 增补直达测试，尤其是 /messages、/files、/me/conversations、/me/devices*。`
- **建议的二次审查方式**：`same reviewer rereview`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

本轮 review 不收口，等待实现者按 §6 响应并再次更新代码或 closure 文档。

---

## 6. 实现者回应

> 本回应是对 4 位 reviewer (deepseek / GLM / GPT / kimi) ZX5 review 的**整合修复**。代码修复**逐项核查 4 份审查的 finding**，对查实有效的问题进行修复;closure 文档措辞按 4-reviewer 共识降级。本节按 GPT 文件的 R 编号组织,并在表格末尾交叉引用其它 reviewer 的对应编号。

### 6.1 对本轮审查的回应

> 执行者: `Opus 4.7 (1M ctx)`
> 执行时间: `2026-04-28`
> 回应范围: `R1–R5 (GPT)+ deepseek R1-R8 + GLM R1-R12 + kimi R1-R10 整合`
> 对应审查文件:
>   - `docs/code-review/zero-to-real/ZX5-reviewed-by-GPT.md`(本文件)
>   - `docs/code-review/zero-to-real/ZX5-reviewed-by-deepseek.md`
>   - `docs/code-review/zero-to-real/ZX5-reviewed-by-GLM.md`
>   - `docs/code-review/zero-to-real/ZX5-reviewed-by-kimi.md`

- **总体回应**:4 位 reviewer 一致命中 3 类硬伤:**(a) D3 `/messages` endpoint 写 D1 不 forward agent-core**(deepseek R1 / GLM R1 / GPT R1 fragment / kimi R5);**(b) closure 措辞 over-claim Lane F**(deepseek R6/R7 / GLM R2 / GPT R1 / kimi R1/R2);**(c) clients/api-docs 与代码现实漂移**(GPT R3)。本轮全部修复。Lane E partial-by-design 的 GPT R2 / kimi R4 投诉,以 closure 措辞降级 + 代码层标注承接的方式回应,not by 强行 wiring binding(per Q6 short-term shim 期内 owner-decided toggle);R28 / pnpm-lock.yaml / WeChat smoke / R2 binding 4 项保持 owner-action carryover。
- **本轮修改策略**:correctness 类问题(R1/R2/R5) 直接代码修复;protocol-drift 类(R4 last_seen_at / GLM R10 stale comment / GLM R11 RPC 方法命名)用 alias + rename + 说明型注释;test-gap(GLM R5 orchestrator-core kid rotation)补 3 unit;closure 措辞按 4-reviewer 共识降级为 "F1/F2 wait-and-resume infra land,hook dispatcher integration deferred" + "F3 callback contract land,emitServerFrame wiring deferred"。
- **实现者自评状态**:`ready-for-rereview`

### 6.2 逐项回应表

> 列 "其它 reviewer 对应" 给出同一问题在 deepseek/GLM/kimi 文件中的编号,便于 4 份审查交叉对账。

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 | 其它 reviewer 对应 |
|----------|----------|----------|----------|----------|--------------------|
| **GPT R1** | Lane F 仍停在 infra seam,closure 写满了 runtime kernel hookup | `partially-fixed` | closure 措辞降级:§0 状态行、§0 已完成 bullet、§5.1 sign-off 全部改为明确的 "F1/F2 wait-and-resume **infra** land,hook dispatcher integration deferred" + "F3 `onUsageCommit` callback land,`emitServerFrame` wiring deferred";不在 ZX5 内补 wiring(本期产能预算已用完,且 dispatcher 改造是 cluster-level kernel work) | `docs/issue/zero-to-real/ZX5-closure.md` | deepseek R6+R7 / GLM R2 / kimi R1+R2 |
| **GPT R2** | Lane E 仍是 minimal RPC seam,不是 agent-core 已切真 RPC | `partially-fixed` | closure 措辞降级:§0 + §5.1 改为 "Lane E library worker RPC **seam** land(short-term shim period)";`workers/agent-core/wrangler.jsonc` CONTEXT_CORE / FILESYSTEM_CORE binding 仍 commented(per Q6 owner direction:short-term shim ≤ 2 周,owner 决定 RPC-first toggle);**不在本期强行打开 binding,因为没有 cross-e2e 证据保证 RPC-first 切换不引入回归** | `docs/issue/zero-to-real/ZX5-closure.md` | kimi R4 |
| **GPT R3** | clients/api-docs 与代码现实严重漂移:`/messages` `/files` `/me/conversations` `/me/devices*` 仍写 "尚未实现" | `fixed` | `clients/api-docs/README.md` 重写:删 "尚未实现" 段;新增 "ZX5 新增产品面" 表,逐路由标注 `implemented` / `partial(metadata-only)` / `partial(D1 写入,auth-gate device-active check 待 second-half)`;catalog 段从 "空数组 placeholder" 改为 "ZX5 起 11 entries";新增 "尚未 live 的客户端能力" 段(WS round-trip permission/elicitation / live usage push / R2 file bytes)与 closure §3.2 边界完全一致 | `clients/api-docs/README.md` | (GPT 独有) |
| **GPT R4** | `/me/conversations` 的 `last_seen_at` 命名与实现语义不一致 | `fixed(rename + legacy alias)` | `user-do.ts:handleMeConversations` Conversation type 增加 `latest_session_started_at` 字段(精确语义),**保留 `last_seen_at` 为 legacy alias**(同值,one-release deprecation window);sort key 改用 `latest_session_started_at`;`index.ts` route doc 同步更新;closure / api-docs 两边都说明新字段 | `workers/orchestrator-core/src/user-do.ts`、`workers/orchestrator-core/src/index.ts` | (GPT 独有,GLM R12 提到分页缺陷但属另一项 follow-up) |
| **GPT R5** | ZX5 新 product endpoints 缺少明确直达测试 | `partially-fixed` | 本轮新增 `workers/orchestrator-core/test/kid-rotation.test.ts`(3 unit,GLM R5 修复)— 不直接覆盖 endpoints,但提升 jwt-shared keyring 在 orchestrator-core 验证侧的覆盖。`/messages`、`/files`、`/me/conversations`、`/me/devices*` 的 endpoint-level integration 测试**承接到下一 plan**(本轮 review 仅暴露 closure 措辞与 D3 forward 缺口,补测试是独立 follow-up phase);closure §3.2 已加该项 | `workers/orchestrator-core/test/kid-rotation.test.ts`(新)| kimi 隐含(无单独编号)|
| **deepseek R1 / GLM R1 / kimi R5(整合 GPT R1 fragment)** | D3 `/messages` 不转发 agent-core,消息成数据墓碑 | `fixed` | `user-do.ts:handleMessages`:`recordUserMessage + appendDurableActivity` 之后,新增 parts→text 归一化(text parts join '\n',artifact_ref 部分surface as `[artifact:<uuid>\|<summary>]` placeholder)+ `forwardInternalJsonShadow(sessionUuid, 'input', {text, parts, message_kind, ...}, 'input')` + `readInternalStream` + KV/D1 state update + WS attachment frame forward + `recordStreamFrames` + `updateConversationIndex` + `updateActivePointers` + closeTurn,与 `handleInput` 历史路径完全一致。前端发 `/messages` 现在会真正驱动 agent-runtime | `workers/orchestrator-core/src/user-do.ts` | — |
| **deepseek R2** | `recordUserMessage` role 判定 bug:`kind === 'user.input'` 对 `'user.input.text'` / `'user.input.multipart'` 返 false → role 错标为 `'system'` | `fixed` | line 373 改为 `kind.startsWith('user.input') ? 'user' : 'system'` + 注释说明 D3 的 kind 扩展 | `workers/orchestrator-core/src/user-do.ts` | — |
| **deepseek R3 / kimi R5(整合 Q8)** | `/input` 未按 Q8 归一化为 `/messages` 的 alias,两套独立 handler | `fixed` | `handleInput` 现在是 thin alias:仅校验 `body.text`(保留 `invalid-input-body` 历史 error code),把 `body` 转换为 `{parts: [{kind:'text', text}], ..., _origin:'input'}`,然后 `return this.handleMessages(sessionUuid, messagesBody)`。Single 落库路径,single agent-core forward | `workers/orchestrator-core/src/user-do.ts` | — |
| **deepseek R4** | `/input` 与 `/messages` 用不同 `message_kind`(`user.input` vs `user.input.text`)| `fixed(passively by R3 fix)` | R3 fix 后 `/input` 走 `handleMessages` 路径,messageKind 在 `handleMessages` 里统一计算为 `'user.input.text'`(单 text part)。R4 自动消除 | `workers/orchestrator-core/src/user-do.ts` | — |
| **deepseek R5** | `handleMeConversations` 不读 `x-nano-internal-authority` header,first-time user 看不到对话列表 | `fixed` | 新增顶层 `readInternalAuthority(request)` helper(parse `x-nano-internal-authority` JSON,通过 `isAuthSnapshot` 校验);`fetch` handler 在 `/me/conversations` 路由分支读 header 并传给 `handleMeConversations(limit, headerAuthority?)`;`handleMeConversations` 优先用 header authority,fallback 到 KV 兼容旧路径 | `workers/orchestrator-core/src/user-do.ts` | — |
| **deepseek R6** | F3 `emitServerFrame('session.usage.update')` wire-up 缺失 | `deferred-with-rationale` | 已在 closure 语义 reword(GPT R1 fix),不在本期补 wiring。理由:NanoSessionDO 注册 `onUsageCommit` 是 cluster-level 改造,涉及 `MainlineKernelOptions` composition + WS frame schema;独立 PR 推进 | (closure §3.2)| GLM R2 / kimi R2 |
| **deepseek R7** | F1/F2 hook dispatcher 未接 wait-and-resume infra | `deferred-with-rationale` | 同上 — closure 已 acknowledge,本轮只 reword closure;dispatcher 集成是 cluster-level kernel work | (closure §3.2)| GLM R2 / kimi R1 |
| **deepseek R8** | `claimPendingForStart` 缺 `started_at` 条件守卫(Q11(b) 字面)| `deferred-with-rationale + 注释` | `session-truth.ts:claimPendingForStart` 加详细注释解释:当前场景下 `started_at` 是 immutable post-mint 且 session_uuid 是 UUIDv4(单一行),Q11(b) literal 仅在 "expire+remint same UUID" 假设路径下提供额外保护(不在产品 roadmap)。本期不补,以避免每个 /start 多一次 D1 read | `workers/orchestrator-core/src/session-truth.ts` | — |
| **GLM R3** | `deploy-preview.sh` 缺 `wrangler d1 migrations apply`,`/me/devices*` deploy 后 500 | `fixed` | `scripts/deploy-preview.sh` 新增 `apply_d1_migrations_preview()` 函数(`SKIP_D1_MIGRATIONS=1` 可跳过),在 worker deploy 之前 apply migrations 到 preview NANO_AGENT_DB(007 等 pending migration 都会被 wrangler 处理,已 apply 过的会被跳过);header comment 同步更新 | `scripts/deploy-preview.sh` | — |
| **GLM R4** | C2 两 worker jwt-shared 导入策略不一致(orchestrator-core 动态 import vs orchestrator-auth 静态 import)| `fixed` | `orchestrator-core/src/auth.ts` 改为顶层静态 `import { verifyJwt as sharedVerifyJwt } from "@haimang/jwt-shared"`,删除 `verifyJwt()` 内的 `await import(...)` 写法;两 worker 现在 import 模式一致 | `workers/orchestrator-core/src/auth.ts` | — |
| **GLM R5** | kid rotation 测试仅在 orchestrator-auth,orchestrator-core 零覆盖(`verifyJwtAgainstKeyring` 路径无单测)| `fixed` | 新建 `workers/orchestrator-core/test/kid-rotation.test.ts`(3 unit):(1) v1 token + post-v2-rotation env 仍接受;(2) v1 token + v1 secret 移除后拒绝 401;(3) signature tamper 三键都不通过(防 silent fall-through)| `workers/orchestrator-core/test/kid-rotation.test.ts`(新)| — |
| **GLM R6 / kimi R3** | C6 web 客户端是 local mirror,不是真正消费 nacp-session shared helper | `partially-fixed (TODO 标注)` | 在 `clients/web/src/heartbeat.ts` 与 `clients/wechat-miniprogram/utils/heartbeat-adapter.js` 文件头加 TODO,明确 "post-ZX5,build pipeline 接入 NODE_AUTH_TOKEN 后删除 mirror 改用 root export"。**当前不删除 mirror**(NODE_AUTH_TOKEN 在 vite/wechat build 暂未配置);两 client 行为依然 1:1 一致 | `clients/web/src/heartbeat.ts`、`clients/wechat-miniprogram/utils/heartbeat-adapter.js` | — |
| **GLM R7** | user-do.ts 2240 行,seam extraction 收益被 ZX5 新 handler 吞噬 | `deferred-with-rationale` | 不在本轮做拆分。理由:R7 / kimi R8 都是 platform-fitness 类问题,不影响 correctness;真正的拆分应该在 envelope refactor + handler-by-domain 重组的独立 phase 里做(同时处理 forwardInternalJsonShadow 重命名,O11),否则会跟 R1 fix 的 diff 冲突 | (carryover 到下一 plan)| kimi R8 |
| **GLM R8** | F1/F2 `setTimeout` 在 DO hibernation/restart 场景下行为未文档化 | `fixed` | `workers/agent-core/src/host/do/nano-session-do.ts:awaitAsyncAnswer` JSDoc 新增 "Cloudflare DO hibernation behavior" 段:说明 hibernation 时 setTimeout + deferredAnswers Map 都丢失,recovery 走 `alarm()` → `sweepDeferredAnswers()` 重读 storage 路径;timeout 设置必须覆盖 hibernate-and-revive worst case | `workers/agent-core/src/host/do/nano-session-do.ts` | — |
| **GLM R9 / kimi R6** | D6 device 写入与 auth gate 读取端未连接;`verifyAccessToken` 不查 `nano_user_devices.status` | `partially-fixed (TODO 标注)` | `workers/orchestrator-core/src/index.ts:handleMeDevicesRevoke` block comment 新增 "TODO (D6 second-half)" 段,精确列出 second-half PR 的 3 个改造点(`verifyAccessToken` 加 D1 lookup / `IngressAuthSnapshot.device_uuid` 加字段 / `/me/devices/revoke` → User-DO fan-out 强断 active session);明确 "当前已发出的 access token 在 exp 前仍可用" 是 known/documented 状态 | `workers/orchestrator-core/src/index.ts` | — |
| **GLM R10** | `forwardInternalJsonShadow` 命名漂移 + `index.ts:18` stale comment(指向已删的 `jsonDeepEqual`)| `fixed(comment)` | `index.ts:18` block comment 重写:从 "HTTP-truth result via jsonDeepEqual" 改为完整说明 — ZX2 P3-01 引入 dual-track,ZX4 P9 P9-01 P3-05 flip 删 HTTP shadow,binding 现是唯一 transport,方法名 `forwardInternalJsonShadow` 保留是 diff 卫生,rename 在 envelope refactor 时一并处理(O11)| `workers/orchestrator-core/src/index.ts` | kimi R9 |
| **GLM R11** | E1/E2 RPC op 方法命名不统一(`assemblerOps()` vs `filesystemOps()`)| `fixed(rename + alias)` | `workers/context-core/src/index.ts`:`assemblerOps()` 重命名为 `contextOps()`(匹配 `{domain}Ops` 模式);`assemblerOps()` 保留为 `@deprecated` alias,内部 `return this.contextOps()`;header doc 同步更新调用方 binding 示例 | `workers/context-core/src/index.ts` | — |
| **GLM R12** | `/me/conversations` 分页不足,`next_cursor` 恒 null | `deferred` | 不在本轮修复。理由:cursor-based 分页是 read-model 级改造,需要 `listSessionsForUser` / D1 view 同步演进;最大影响是 conversation > 200 时 long tail 看不到,当前用户基数不触发。承接到下一 plan | (carryover)| — |
| **kimi R7** | F4 idempotency 测试是 mock 而非真实 D1 并发竞态 | `deferred-with-rationale` | 现有 mock 测试覆盖了 winner / loser 分支逻辑,真实 D1 并发竞态需要 wrangler dev or sandbox D1(Vitest pool 不支持原生 D1);承接到 owner-action 真机 smoke | (carryover)| — |
| **kimi R10** | R28 根因从 ZX4 carryover 到 ZX5 仍未定位 | `owner-action carryover` | F5 runbook stub 已就位 → owner 在自己环境跑 wrangler tail + 复现后 fill `docs/runbook/zx5-r28-investigation.md` §3。sandbox 拒 wrangler tail,代码 agent 无法独立推进 | (closure §3.1)| — |

### 6.3 Blocker / Follow-up 状态汇总

| 分类 | 数量 | 编号(跨 reviewer)| 说明 |
|------|------|------|------|
| 已完全修复 | 13 | GPT R3 / GPT R4 + deepseek R1+R2+R3+R4+R5 + GLM R3+R4+R5+R8+R10+R11 | 代码修复 + 注释/文档同步 |
| 部分修复(closure 降级 + 代码 carryover 标注)| 5 | GPT R1+R2 + deepseek R6+R7 + GLM R2 + GLM R6/kimi R3 + GLM R9/kimi R6 + GPT R5 | infra 已 land,wiring/dispatcher/真实 npm import/auth-gate device check 是承接 PR;closure 措辞 + 代码 TODO 已诚实标注 |
| 有理由 deferred | 3 | deepseek R8 + GLM R7/kimi R8 + GLM R12 + kimi R7 | platform-fitness / 低优先级 / mock vs real D1,均不影响 correctness |
| 拒绝 / stale-rejected | 0 | — | — |
| 仍 blocked(owner-action)| 1 | kimi R10 / closure §3.1 R28 | sandbox 限制,owner ops |

### 6.4 变更文件清单

- `workers/orchestrator-core/src/user-do.ts` — R1 (`handleMessages` agent-core forward)、R2 (role 判定 fix)、R3 (`/input` alias)、R5 (header authority)、R4 (`latest_session_started_at` rename)
- `workers/orchestrator-core/src/index.ts` — R3 stale comment、R4 route doc 同步、R9/kimi R6 D6 second-half TODO
- `workers/orchestrator-core/src/auth.ts` — GLM R4 静态 import
- `workers/orchestrator-core/src/session-truth.ts` — deepseek R8 注释说明
- `workers/orchestrator-core/test/kid-rotation.test.ts` — GLM R5 新增 3 unit
- `workers/agent-core/src/host/do/nano-session-do.ts` — GLM R8 hibernation JSDoc
- `workers/context-core/src/index.ts` — GLM R11 contextOps 重命名 + assemblerOps deprecated alias
- `clients/web/src/heartbeat.ts` — kimi R3/GLM R6 TODO header
- `clients/wechat-miniprogram/utils/heartbeat-adapter.js` — kimi R3/GLM R6 TODO header
- `clients/api-docs/README.md` — GPT R3 实现状态全量 sync
- `scripts/deploy-preview.sh` — GLM R3 D1 migration apply
- `docs/issue/zero-to-real/ZX5-closure.md` — F1/F2/F3 over-claim 降级 + Lane E partial 措辞 + ZX5 review 修复脚注

### 6.5 验证结果

| 验证项 | 命令 / 证据 | 结果 | 覆盖的 finding |
|--------|-------------|------|----------------|
| jwt-shared unit | `vitest run packages/jwt-shared` | **20/20 pass** | 基础保障(无 finding 直接覆盖,但 R5/GLM R5 依赖)|
| orchestrator-auth-contract unit | `pnpm -F @haimang/orchestrator-auth-contract test` | **19/19 pass** | C4 跨包断言不 break |
| orchestrator-core test(含新 kid rotation)| `pnpm -F @haimang/orchestrator-core-worker test` | **80/80 pass**(+3 new vs ZX5 closure 时 77)| GLM R5 新增 3 unit + R1/R2/R3/R5 fix 不 break 现有测试 |
| agent-core test | `pnpm -F @haimang/agent-core-worker test` | **1056/1056 pass** | GLM R8 hibernation JSDoc 不 break 任何 host/runtime 测试 |
| bash-core test | `pnpm -F @haimang/bash-core-worker test` | **374/374 pass** | 零 cross-impact |
| orchestrator-auth test | `pnpm -F @haimang/orchestrator-auth-worker test` | **13/13 pass** | C2 jwt-shared import 仍工作 |
| context-core test | `pnpm -F @haimang/context-core-worker test` | **171/171 pass** | GLM R11 contextOps rename + assemblerOps alias 不 break 现有 baseline |
| filesystem-core test | `pnpm -F @haimang/filesystem-core-worker test` | **294/294 pass** | 零 cross-impact |
| root guardians | `pnpm test:contracts` | **31/31 pass** | proto contract / surface guard 不 break |
| deploy-preview.sh syntax | `bash -n scripts/deploy-preview.sh` | **OK** | GLM R3 fix 不破坏 shell 脚本结构 |
| **合计** | — | **2058 / 2058 tests pass(零回归;+3 vs ZX5 closure 时 2055)** | — |

```text
worker / package suites all green:
  jwt-shared:                     20/20
  orchestrator-auth-contract:     19/19
  orchestrator-core:              80/80 (+3 ZX5 review GLM R5)
  agent-core:                  1056/1056
  bash-core:                    374/374
  orchestrator-auth:             13/13
  context-core:                 171/171
  filesystem-core:              294/294
  root-guardians:                31/31
  ─────────────────────────────────────
  TOTAL:                       2058/2058
```

### 6.6 未解决事项与承接

| 编号 | 状态 | 不在本轮完成的原因 | 承接位置 |
|------|------|--------------------|----------|
| GPT R1 / deepseek R6+R7 / GLM R2 / kimi R1+R2(F1/F2 hook dispatcher + F3 emitServerFrame wiring)| `deferred` | cluster-level kernel work — 改造 `hooks/permission.ts` + NanoSessionDO composition + WS frame schema;**infra 已就绪,任何 future PR 引入 hook 调用即可消费** | ZX5+ 后续独立 PR(per ZX5 closure §3.2)|
| GPT R2 / kimi R4(Lane E binding 真切)| `deferred(owner-decided toggle)` | 短期 shim 期 ≤ 2 周,owner 决定 RPC-first 后打开 wrangler.jsonc binding;cross-e2e 稳定后再删 in-process import | per Q6 + R9 短期 shim;ZX5 closure §3.2 |
| GPT R5 / kimi(隐含)endpoint-level integration 测试 | `deferred` | `/messages` `/files` `/me/conversations` `/me/devices*` 直达测试;本轮已修 D3 forward + 新增 3 kid rotation 单测,endpoint integration 测试是独立 follow-up phase | 下一 review/test phase |
| deepseek R8(Q11(b) `started_at` 守卫字面合规)| `deferred-with-rationale` | 当前场景下 functionally equivalent;不为假设路径加每 /start 一次 D1 read | ZX5+ 若 expire+remint 路径成为 roadmap |
| GLM R7 / kimi R8(user-do.ts 行数膨胀)| `deferred` | platform-fitness;在 envelope refactor + handler-by-domain 重组的独立 phase 一并做 | 下一 plan |
| GLM R12(`/me/conversations` 分页)| `deferred` | cursor-based 分页是 read-model 级改造,当前用户基数不触发 long tail | 下一 plan |
| kimi R7(F4 真实 D1 并发竞态测试)| `deferred(owner-action)` | Vitest pool 不支持原生 D1 并发;wrangler dev or 真实 owner 环境 | owner-action smoke |
| kimi R3 / GLM R6(client 真 npm import)| `deferred(owner-action build pipeline)` | NODE_AUTH_TOKEN 在 vite/wechat build 暂未配置;TODO 已标注 | build pipeline 接入后 |
| GLM R9 / kimi R6(D6 second-half:auth-gate device-active check)| `deferred` | TODO 已在 `index.ts` 标注,涵盖 `verifyAccessToken` D1 lookup + `IngressAuthSnapshot.device_uuid` + revoke→User-DO fan-out 三件 | D6 second-half 独立 PR |
| kimi R10(R28 根因)| `owner-action(blocked)` | sandbox 拒 wrangler tail,F5 runbook stub 就位等 owner 复盘 | `docs/runbook/zx5-r28-investigation.md` §3 |

### 6.7 Ready-for-rereview gate

- **是否请求二次审查**:`yes`(对 GPT R1/R2/R3/R4 + deepseek R1/R2/R3/R5 + GLM R3/R4/R5/R8/R10/R11 修复处单点复核)
- **请求复核的范围**:`partial — 本轮代码修复 + closure 降级`(non-blocking follow-up 不在本轮 scope)
- **实现者认为可以关闭的前提**:
  1. reviewer 认可 closure §0 + §5.1 措辞已诚实降级到 "F1/F2/F3 partial-by-design,wiring deferred";
  2. reviewer 认可 D3 `/messages` 经 R1 fix 后已驱动 agent-runtime(`forwardInternalJsonShadow('input', ...)` 已加,parts→text 归一化策略合理);
  3. reviewer 认可 `/input → /messages` alias 归一化已落地(单 落库路径,messageKind 统一);
  4. reviewer 认可 clients/api-docs 与 facade 代码现实一致(implemented / partial / not-live 三态明确);
  5. reviewer 认可 deferred follow-up 列表(F1/F2/F3 wiring / Lane E binding / endpoint integration tests / R28 owner-action)是合理的承接边界,不再要求 ZX5 内部完成。

---

> 2026-04-28 — Opus 4.7 完成对 4 reviewer ZX5 review 的整合修复回应。代码层 13 项 fix(R1+R2+R3+R5 是核心修复,其它 9 项是 protocol-drift / docs-gap / test-gap 类);closure 措辞按 4-reviewer 共识降级 F1/F2/F3 + Lane E;clients/api-docs sync 完成。2058 / 2058 tests pass(零回归;+3 vs ZX5 closure 时 2055 baseline)。本轮 review 在修复后建议 reviewer 复核 closure 措辞 + D3 fix 实现细节,其余 deferred follow-up 转入下一 plan / owner-action。

---

## 8. 审查质量评价（Opus 4.7 修复后回填）

> 评价对象: `GPT ZX5 全 4 lane review`
> 评价人: `Opus 4.7 (1M ctx)`
> 评价时间: `2026-04-28`

---

### 8.0 评价结论

- **一句话评价**:**最强的"contract truth 三角对账"reviewer** — 唯一识别出代码 / closure 文档 / clients/api-docs 三者相互打架的 R3,在 closure verdict 上最严厉(`changes-requested`,4 位中唯一不允许收口的)。
- **综合评分**:**8.5 / 10**
- **推荐使用场景**:phase closure 前需要"对外契约可信度"复核 — 检查代码现实、closure 叙事、public docs 三者一致性;特别适合大 PR 收尾前最后一道把关。
- **不建议单独依赖的场景**:finding 颗粒度只有 5 条,但每条都是 high-severity blocker,**不会陪 owner 一起做 platform-fitness / 命名 / DO hibernation 这类长期工程关怀**(GLM/kimi 才是这类问题的 reviewer)。

---

### 8.1 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | **contract truth 三角对账(代码 ↔ closure ↔ public docs)** | R3 直接列出 `clients/api-docs/README.md` 写 "尚未实现" 与 `user-do.ts:1498-1672` 已 land 之间的矛盾 |
| 证据类型 | **行号 + `pnpm test:contracts` + `bash -n` + `find workers -mindepth 1 -maxdepth 1` 命令证据** | §1 直接执行命令验证 worker 数量 = 6 + bash syntax + 31 contract tests |
| Verdict 倾向 | **strict** — 4 位中唯一 `changes-requested`(其它 3 位都允许收口) | §0 "现 closure / final-closure 都存在过度完工叙事" |
| Finding 粒度 | **coarse(5 findings,但每条都是 high/medium 实质 blocker)** | R1+R2+R3 都是 blocker,R4+R5 是 follow-up;无 low 量级噪音 |
| 修法建议风格 | **二选一 fork 式** — 对 partial-by-design 项给 "补实现 OR 降级 closure 叙事" 两条路径 | R1 修法 1 "补齐 wiring + e2e";修法 2 "把 closure 降级为 'infra landed, runtime consumer deferred'" |

---

### 8.2 优点与短板

#### 8.2.1 优点

1. **R3 是 4 位 reviewer 中独家的 high-impact finding** — `clients/api-docs/README.md` 与代码现实漂移这条 ZX5 review 中**对外部消费者影响最大**的问题,只有 GPT 看到了 client docs 层。fix 后 README 全量重写,3 态(`implemented` / `partial` / `not-live`)明确。
2. **§5 verdict `changes-requested` 在 4 位中最严厉、且最准确** — 在所有 reviewer 都允许收口时,GPT 拒绝收口并坚持 closure 措辞必须降级。事后 4 位 reviewer 共识形成时,GPT 的判断成为**校准基准**。
3. **修法建议的"二选一 fork 式"是最高质量的协作输出** — R1+R2 都给"补实现 OR 降级 closure"两条路径,把决定权留给 owner;fix 时实现者按 fork 1(降级 closure)推进,GPT 的预判完全可验证。
4. **`pnpm test:contracts`+ `bash -n scripts/deploy-preview.sh` 命令证据** — §1.2 验证证据用命令而非仅文件 grep,在 4 位 reviewer 中证据类型最 robust;但和 GLM R3 比仍漏掉 migration apply 步骤(GPT 只 syntax-check,GLM 检查内容)。

#### 8.2.2 短板 / 盲区

1. **没看到 deepseek R2 的 role 判定 bug** — GPT 完全没识别 `recordUserMessage` 的 latent role 错标 bug,与 GLM 一样 scope 锁在 lane / closure 顶层。
2. **finding 数量太少(5 条)** — coverage 完全靠"每条都重"的方式,没有 platform-fitness / 命名 / hibernation 这类长期关怀;不适合做"全维度扫描"。
3. **R5(测试 gap)的修法路径偏笼统** — 只说"补 unit/integration",没像 GLM R5 那样指明"orchestrator-core 缺 kid rotation 因为走 verifyJwtAgainstKeyring 不同路径";reviewer 跨 worker test asymmetry 的具体形态没识别。
4. **R4(`last_seen_at` 命名漂移)是 GPT 独家但严重程度评估偏低** — 这是 read-model contract 公开给前端的字段,客户端会按字面理解为"用户最后活动时间";严重级别 medium 偏低,实际更接近 high(下游影响 sort/未读/列表语义)。

---

### 8.3 Findings 质量清点

| 问题编号 | 原始严重程度 | 事后判定 | Finding 质量 | 分析与说明 |
|----------|--------------|----------|--------------|------------|
| R1 | high | **true-positive(与 deepseek R6+R7 / GLM R2 / kimi R1+R2 共识)** | excellent | F1/F2/F3 closure over-claim;GPT 的"二选一 fork 式"修法是 4 位中最有协作价值的 |
| R2 | high | **true-positive(与 kimi R4 共识)** | good | Lane E partial-by-design 的措辞过强;fix 后 closure 已 reword |
| R3 | medium | **true-positive(GPT 独家)** | excellent | clients/api-docs 漂移,4 位中唯一识别;fix 后 README 全量 sync |
| R4 | medium | **true-positive(GPT 独家)** | good | `last_seen_at` 命名漂移;但严重级别可调高,实际客户端混淆风险大 |
| R5 | medium | **partial(笼统)** | mixed | 测试 gap 笼统提出,具体形态不如 GLM R5 + kimi R7;deferred |

---

### 8.4 多维度评分 - 单项总分 10 分

| 维度 | 评分(1–10)| 说明 |
|------|-------------|------|
| 证据链完整度 | **9** | 命令 + 行号 + 跨文件对账,§1.2 直接 contract-test 跑;扣分:client docs 3 文件交叉对照不如可以更细 |
| 判断严谨性 | **10** | 4 位中唯一坚持 changes-requested,事后被 4-reviewer 共识证明严谨度最高 |
| 修法建议可执行性 | **9** | 二选一 fork 式 + e2e 补测试路径清晰;R5 路径偏笼统 |
| 对 action-plan / design / QNA 的忠实度 | **9** | 引 plan §485-490 / §498-499 行号,但 Q answer 直接引用不如 deepseek |
| 协作友好度 | **9** | 严厉但 fork 式给 owner 决定权,verdict 措辞克制 |
| 找到问题的覆盖面 | **6** | 5 条 finding 太少;deploy 脚本 / DO hibernation / 命名 / role bug 均未识别 |
| 严重级别 / verdict 校准 | **9** | 4 位中校准最准;唯一扣分:R4 严重级别可调高 |

**加权总分:8.5 / 10**(契约一致性识别 + 严厉准确的 verdict + R3 独家高价值 finding;扣分主要来自 finding 数量太少导致的覆盖面不足,以及 R5 修法偏笼统)
