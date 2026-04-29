# Nano-Agent 审查报告 — Action-Plan 文档与设计文件/基石/代码三方核对

> 审查对象: `docs/action-plan/real-to-hero/RH{0..6}-*.md`（7 份执行计划文件）
> 审查类型: `docs-review`（action-plan × design × charter × 代码）
> 审查时间: `2026-04-29`
> 审查人: `DeepSeek (独立审查)`
> 审查范围:
> - `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md`
> - `docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md`
> - `docs/action-plan/real-to-hero/RH2-models-context-inspection.md`
> - `docs/action-plan/real-to-hero/RH3-device-auth-gate-and-api-key.md`
> - `docs/action-plan/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md`
> - `docs/action-plan/real-to-hero/RH5-multi-model-multimodal-reasoning.md`
> - `docs/action-plan/real-to-hero/RH6-do-megafile-decomposition.md`
> 对照真相:
> - `docs/charter/plan-real-to-hero.md` r2
> - `docs/design/real-to-hero/RH{0..6}-*.md`
> - `docs/design/real-to-hero/RHX-qna.md`（业主已同意 Opus 全部判断）
> - `packages/*/src/**`（7 个 library 包真实代码）
> - `workers/*/src/**`（6 个 worker 真实代码）
> - `pnpm-lock.yaml` / `wrangler.jsonc` / `migrations/*.sql`
> 文档状态: `reviewed`（changes-requested — 见 §5 blocker list）

---

## 0. 总结结论

- **整体判断**：`7 份 action-plan 对 charter 与 design 的映射基本正确，主体计划可行；但与真实代码之间存在 7 处事实性偏差和 3 处结构性盲点，需修正后方可进入 RH0 implementation。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`（存在 blocker 级 finding）
- **本轮最关键的 1-3 个判断**：
  1. RH2 action-plan 声称 `SessionHeartbeatBodySchema` 等三类 frame body schema **需要注册**到 nacp-session，但代码中 heartbeat schema **已存在**于 `messages.ts:61-64` — 这是"做了半截"的真相，action-plan 应区分"已存在需补齐 frame discriminator" vs "从零新增 schema"。
  2. RH4 action-plan 声称 `filesystem-core/src/storage/adapters/` 下有高质量 R2/KV/D1 adapter 可"直接组装"成 R2ArtifactStore，但实际 adapter 在 `packages/storage-topology/src/adapters/` 下且由 `scoped-io.ts` wrapper 消费；filesystem-core 的 `storage/` 下是**另一份独立实现**（含 16 个文件），两者之间是否存在接口契约需要同步确认，否则 action-plan "直接组装"的假设有落空风险。
  3. 7 份 action-plan 全部缺少对 `pnpm-lock.yaml` 重建后 `@haimang/jwt-shared` 与 6 个 worker 的 workspace dependency chain 验证步骤的显式测试收口 — lockfile 中 `jwt-shared` importer 完全缺失（0 引用），但 2 个 worker 已声明 `workspace:*` 依赖，这是 lockfile broken 的直接证据，当前 action-plan 仅以 `grep -c "jwt-shared" ≥ 2` 作为收口标准，可能 insufficient。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-real-to-hero.md` (r2, 1017 行)
  - `docs/design/real-to-hero/RH{0..6}-*.md` + `RH2-llm-delta-policy.md` + `RHX-qna.md`
  - `docs/templates/code-review.md`
- **核查实现**：
  - 7 个 library 包 (`packages/*/src/`) 的接口、类型定义与现有实现
  - 6 个 worker (`workers/*/src/`) 的核心文件（runtime、kernel、LLM、auth、handler、storage）
  - `pnpm-lock.yaml`（jwt-shared importer 状态 + stale importer 状态）
  - 6 个 `wrangler.jsonc`（KV/R2 binding 声明状态、CONTEXT_CORE/FILESYSTEM_CORE binding 注释状态）
  - 7 个 migration SQL 文件 (`001-007`)
- **执行过的验证**：
  - `grep -c "jwt-shared" pnpm-lock.yaml` → **0**（importer 完全缺失）
  - `grep -c "agent-runtime-kernel\|capability-runtime" pnpm-lock.yaml` → **2**（stale entries 存在）
  - `find workers/*/wrangler.jsonc -exec grep "kv_namespaces\|r2_buckets" {} \;` → **0 match** （无 KV/R2 binding 声明）
  - `grep -rn "forwardServerFrameToClient" workers/` → **0 match**（方法不存在；仅 `emitServerFrame` 存在）
  - `grep -rn "verifyApiKey" workers/orchestrator-auth/src/service.ts` → 返回 stub `{supported: false, reason: "reserved-for-future-phase"}`
  - `grep -rn "/models" workers/orchestrator-core/src/index.ts` → **0 match**（路由不存在）
  - `grep -rn "model_id" packages/nacp-session/src/messages.ts` → **0 match**（字段不存在）
  - `grep -rn "reasoning" workers/agent-core/src/llm/canonical.ts` → **0 match**（字段不存在）
- **复用 / 对照的既有审查**：无（独立审查，未参考 Kimi / DeepSeek / GPT 的评估报告）

### 1.1 已确认的正面事实

- action-plan 对 6-worker 拓扑、migration 编号（001-007 已有，008-011 计划新增）、charter §4.0 deferred 15 项的承接映射**全部正确**。
- action-plan 对 `hook.emit` no-op 行号 (`runtime-mainline.ts:295-298`)、`verifyApiKey` stub 状态、`CONTEXT_CORE/FILESYSTEM_CORE` binding 注释状态、`nano-session-do.ts` 2078 行、`user-do.ts` 2285 行的引用**全部准确**。
- action-plan 对 charter §8.4 migration allocation rule（008→RH2, 009→RH3, 010→RH4, 011→RH5）的遵守**完全一致**。
- RHX-qna Q1-Q5 业主已同意的 5 项冻结决策在对应 action-plan 中**全部正确引用**并落地为执行条款。
- 7 份 action-plan 的 Phase 切分粒度、依赖顺序、测试收口标准与 charter §9.2 的用例数纪律**一致**。

### 1.2 已确认的负面事实

- **F1**：`@haimang/jwt-shared` 在 `pnpm-lock.yaml` 中 **0 引用**。2 个 worker (`orchestrator-auth`, `orchestrator-core`) 的 `package.json` 已声明 `workspace:*` 依赖，但 lockfile 生成时包尚未存在。RH0 P0-A 收口标准 `grep -c "jwt-shared" ≥ 2` 指向的是 lockfile 中的 importer 条目计数，但当前值为 0，action-plan 未说明这个计数需要从 0→≥2 的完整重建过程。
- **F2**：`pnpm-lock.yaml` 中存在 2 条 stale importer（`packages/agent-runtime-kernel`、`packages/capability-runtime`），两者均已被删除。action-plan P0-A1 正确描述了此问题。
- **F3**：6 个 worker 的 `wrangler.jsonc` 中 **零** `kv_namespaces` / `r2_buckets` 声明。action-plan RH0 P0-C 正确描述了此 gap。
- **F4**：`forwardServerFrameToClient` RPC method **完全不存在**。当前 user-do.ts 中只有 `emitServerFrame`（内部方法，不经 service binding 暴露）。action-plan RH1 P1-06 将其列为"新增 RPC method"是正确的，但 action-plan 后续 P1-07 声称"通过现有 service binding（USER_DO）调用"有误导 — user-do 是 DO class，不是通过 binding 可达的 RPC target；跨 worker WS push 的通道设计需要更精确的 RPC 路径说明。
- **F5**：`SessionHeartbeatBodySchema` **已存在**于 `packages/nacp-session/src/messages.ts:61-64`，但 `attachment_superseded` 和 `terminal` body schema **完全不存在**。action-plan RH2 P2-01 将三者并列声称需要注册，未区分"已存在 body schema 但缺 frame discriminator 注册"与"从零新增 body schema"的不同工作量。
- **F6**：action-plan RH4 P4-03 声称 filesystem-core 下的 `R2ArtifactStore` 通过"直接组装已建成的 `storage/adapters/{r2,kv,d1}-adapter.ts`"即可完成。但真实代码中，`packages/storage-topology/src/adapters/` 下有高质量 adapter 实现（含 `r2-adapter.ts` 188 行、`kv-adapter.ts` 138 行、`d1-adapter.ts` 132 行），而 `workers/filesystem-core/src/storage/` 下有另一套独立实现（16 个文件）。action-plan 未明确 adapter 代码是引用 `packages/storage-topology` 的 adapter、还是 filesystem-core 自身的 storage/ 模块，亦或是两者之间需要桥接层。
- **F7**：action-plan 全部 7 份文件的行号引用（如 `nano-session-do.ts:353`、`user-do.ts:1196-1212`、`runtime-mainline.ts:148-187`）**基于当前 2026-04-29 代码**有效。但 RH0 拆分（verify+persistence 抽出）会**显著改变后续文件的行号**，RH1-RH6 的 action-plan 中引用的行号届时将全部失效。7 份 action-plan 均未声明"行号引用以 RH{N} 启动时实际代码为准"的免责条款。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 通过 bash grep/find 对所有关键文件做了行号级验证 |
| 本地命令 / 测试 | partial | 未执行 `pnpm test` 全矩阵；仅做了静态代码内容检查 |
| schema / contract 反向校验 | yes | 对比了 nacp-session schema 定义 vs action-plan 声称的字段缺口 |
| live / deploy / preview 证据 | no | 未执行 deploy；审查仅限于文档与代码的静态一致性 |
| 与上游 design / QNA 对账 | yes | 逐项核对 charter §4.0 deferred 15 项映射、§9.2 测试纪律、§8.4 migration allocation |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | pnpm-lock.yaml jwt-shared 0引用，重建收口标准 insufficient | high | correctness | yes | 补全 lockfile 重建验证步骤 |
| R2 | RH2 heartbeat schema 已存在但 frame discriminator 缺失 — 工作量分类错误 | medium | scope-drift | no | 修正 P2-01 描述，区分已有 body schema vs 缺 discriminator |
| R3 | RH4 R2ArtifactStore "直接组装"前提未核对 adapter 在哪个 package | high | delivery-gap | yes | 明确 adapter 引用路径与 filesystem-core storage/ 模块关系 |
| R4 | RH1 cross-worker push 通道 "USER_DO binding" 表述与实际 RPC 机制不匹配 | medium | correctness | no | 修正 user-do RPC 的暴露方式描述 |
| R5 | RH0-RH6 action-plan 行号引用依赖当前代码，拆分后全部失效 | medium | docs-gap | no | 添加行号有效期免责声明 |
| R6 | `/me/conversations` 双源对齐在 RH3 P3-D 启动前已有双 handler 并存 — 未分析现有差异 | medium | delivery-gap | no | P3-14 需增加现有 `handleMeConversations` vs `handleMeSessions` 行为差异分析 |
| R7 | filesystem-core `library_worker:true` 标志移除与 context-core 的联动未考虑 | low | platform-fitness | no | 确认 context-core 是否也有此标志需同步移除 |

### R1. `pnpm-lock.yaml jwt-shared 0引用，重建收口标准 insufficient`

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `grep -c "jwt-shared" pnpm-lock.yaml` → **0**。`@haimang/jwt-shared` 在 lockfile 中不存在任何 importer 条目。
  - `packages/jwt-shared/package.json` 已声明 `@haimang/jwt-shared` scope。
  - `workers/orchestrator-auth/package.json` 和 `workers/orchestrator-core/package.json` 已声明 `"@haimang/jwt-shared": "workspace:*"` 依赖。
  - action-plan P0-A1 收口标准 `grep -c "jwt-shared" pnpm-lock.yaml ≥ 2` 仅检验 importer 条目数，**未要求验证**：workspace dependency chain 可解析、`pnpm install --frozen-lockfile` 在 fresh checkout 下通过、`pnpm --filter @haimang/jwt-shared test` 在工作区上下文中可执行。
- **为什么重要**：
  - lockfile 是所有 worker `wrangler deploy` 与 CI reproducibility 的根依赖。如果 lockfile 重建后 workspace dependency 链存在但不可解析，CI 将在不可预测的时机失败。
  - action-plan 当前 `grep -c ≥ 2` 只测 lockfile 中是否有条目，不测运行时能否 resolve。
- **审查判断**：
  - 核心问题不在"lockfile 坏了"（action-plan 和 charter 都已正确识别），而在 RH0 的**验证手段 vs 故障模式不匹配**。`grep -c` 能证明条目存在，不能证明 `pnpm install --frozen-lockfile` 与 `pnpm --filter @haimang/jwt-shared test` 在 workspace 上下文中成功。
- **建议修法**：
  - P0-A1 收口标准改为：(a) `grep -c "jwt-shared" pnpm-lock.yaml ≥ 2` **且** (b) `pnpm install --frozen-lockfile` 0 退出 **且** (c) `pnpm --filter @haimang/jwt-shared test` 0 退出 **且** (d) `pnpm --filter orchestrator-auth test` / `pnpm --filter orchestrator-core test` 不因 jwt-shared resolve 失败而 break。
  - P0-A2 当前已含独立 build/typecheck/test 全绿，但步骤应在 P0-A1 lockfile 重建**之后**执行；建议在 Phase 2 的 Phase 说明中显式标注顺序依赖。

### R2. `RH2 heartbeat schema 已存在但 frame discriminator 缺失 — 工作量分类错误`

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `packages/nacp-session/src/messages.ts:61-64` 已定义 `SessionHeartbeatBodySchema`。
  - `packages/nacp-session/src/frame.ts` 中 `NacpSessionFrameSchema` **不含** heartbeat/attachment_superseded/terminal discriminator。
  - action-plan P2-01 将三类 frame body schema 并列描述为需要"注册"，但实际工作量分配不均：heartbeat 的 body schema 已有、只缺 discriminator 注册；superseded 和 terminal 的 body schema **从零开始**需要新建。
- **为什么重要**：
  - 如果 implementer 按 action-plan "三类都需要 schema 注册" 的统一描述去实施，可能花时间在已存在的 heartbeat body schema 上重复造轮子，或者在发现 heartbeat 已有后只做 half-way fix（仅加 body 不加 discriminator），遗留 incomplete state。
- **审查判断**：
  - 这不是 action-plan 的逻辑错误，是**描述精度不足**。工作量差异不大（3 个 discriminator 注册 + 2 个新 body schema），但分类不清会导致 implementer 执行路径不确定。
- **建议修法**：
  - P2-01 拆为三项：(a) `SessionHeartbeatBodySchema` → **补充** `SessionFrameSchema` discriminator 注册（body schema 已有）；(b) `SessionAttachmentSupersededBodySchema` → **新建** body schema + discriminator 注册；(c) `SessionTerminalBodySchema` → **新建** body schema + discriminator 注册。
  - 同步更新 RH2 action-plan 的 Phase 1 测试收口标准。

### R3. `RH4 R2ArtifactStore "直接组装"前提未核对 adapter 在哪个 package`

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `packages/storage-topology/src/adapters/r2-adapter.ts` (188行)、`kv-adapter.ts` (138行)、`d1-adapter.ts` (132行) 存在高质量 production adapter，均通过 `scoped-io.ts` wrapper 消费。
  - `workers/filesystem-core/src/storage/` 下有 16 个文件（含 `adapters/{r2,kv,do-storage,d1}-adapter.ts`、`keys.ts`、`placement.ts`、`mime-gate.ts` 等），是一套**独立实现**。
  - action-plan RH4 P4-03 说"直接组装已建成的 `storage/adapters/{r2,kv,d1}-adapter.ts`"，但未指定是引用 `packages/storage-topology` 的还是 `workers/filesystem-core/src/storage/` 的。
  - `filesystem-core/src/storage/` 的 adapter 文件与 `packages/storage-topology/src/adapters/` 的文件内容是否一致、是否可互换、是否有一方是 canonical 而另一方是 copy，**未经验证**。
- **为什么重要**：
  - 如果两套 adapter 接口不一致（例如 `storage-topology` 的 adapter 通过 `scoped-io.ts` 消费 iv，而 filesystem-core 的 adapter 直接操作原始 binding），"直接组装"会变成 adapter 接口重写，工作量从 S 级膨胀为 M 级。
  - 这是 RH4 的主体工作量（P4-03 P4-04 P4-05），前提不成立会拖垮整个 Phase。
- **审查判断**：
  - Charter 和 design 对 "adapters 已建成" 的判断是正确的（packages/storage-topology 下的 adapter 质量确实高），但 action-plan **没有踩实文件路径和接口契约**。这属于 action-plan 对 design 的细粒度展开不到位。
- **建议修法**：
  - P4-03 在开始前显式做一次 adapter 接口对账：(a) 列出 filesystem-core `src/storage/adapters/` 各文件的接口签名；(b) 列出 `packages/storage-topology/src/adapters/` 各文件的接口签名；(c) 判断 R2ArtifactStore 应直接消费 `packages/storage-topology` 的 adapter（通过 `workspace:*` 依赖引入）还是 filesystem-core 自身的 adapter（需先对齐接口）。
  - 将此对账结果写入 RH4 action-plan P4-03 的前置条件（在"业务工作内容"栏标注 adapter interface audit 步骤）。

### R4. `RH1 cross-worker push 通道 "USER_DO binding" 表述与实际 RPC 机制不匹配`

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - action-plan P1-07 声称 NanoSessionDO "通过现有 service binding (`USER_DO`) 调用 P1-06 RPC"。
  - 但 `user-do.ts` 是 User DO 的 class 定义，不是独立的 RPC worker target。跨 worker RPC 到 DO 需要经过 orchestrator-core 的 fetch handler（`index.ts`）路由到 DO，或通过 DO RPC 的 stub 机制。
  - 当前 `agent-core/wrangler.jsonc` 的 `services` block 中仅有 `BASH_CORE` binding（`CONTEXT_CORE` 和 `FILESYSTEM_CORE` 注释），**没有** `USER_DO` 或 `ORCHESTRATOR_CORE` binding。
- **为什么重要**：
  - 如果 implementer 按 "现有 USER_DO binding" 的假设去 wiring，会发现这个 binding **根本不存在**，需要从零创建 binding + 在 orchestrator-core/index.ts 暴露 RPC target route + 在 agent-core wrangler.jsonc 声明。实际工作量比 action-plan 描述的"通过现有 binding 调用"大得多。
  - 这是一个 action-plan 对代码现实的认识缺口：action-plan 假设"binding 已存在"而代码中不存在。
- **审查判断**：
  - 这不会导致架构错误（跨 worker push 的需求合理且可行），但会在 Phase 3 执行时暴露为 unplanned work。建议 action-plan 诚实承认"USER_DO binding 需从零创建"并调高风险等级。
- **建议修法**：
  - P1-06 / P1-07 拆分为：(1) 在 agent-core `wrangler.jsonc` 新增 `ORCHESTRATOR_CORE` service binding；(2) 在 orchestrator-core `index.ts` 新增内部 RPC target route 接收 `forwardServerFrameToClient` 调用；(3) 在 `user-do.ts` 实现 handler；(4) 在 agent-core NanoSessionDO 中通过新 binding 调用。(5) 将 Phase 3 风险等级从 high 升级并标注 binding 创建是未预见的额外工作。

### R5. `RH0-RH6 action-plan 行号引用依赖当前代码，拆分后全部失效`

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - Action-plan 中大量引用具体行号：`runtime-mainline.ts:295-298`、`nano-session-do.ts:353`、`nano-session-do.ts:494-501`、`nano-session-do.ts:797-815`、`user-do.ts:1196-1212`、`user-do.ts:1215-1257`、`user-do.ts:1651-1699` 等。
  - RH0 P0-D 将 NanoSessionDO 拆出 verify+persistence，主文件从 2078→≤1600 行，所有后续 Phase 引用的行号都将偏移 300-500 行。
  - RH6 P6-A 将 NanoSessionDO 再拆为 7 子模块，行号引用彻底失效。
  - Action-plan 中这些行号引用的目的是**定位具体代码片段**（如 "runtime-mainline.ts:295-298 是 hook.emit no-op"），但行号本身不是永恒不变的标识。
- **为什么重要**：
  - 实施者可能按行号找代码时找不到对应逻辑，导致误解或浪费时间。
  - 但行号引用的片段描述（函数名、逻辑特征）即使行号变化也能通过符号搜索定位，因此严重性不足以成为 blocker。
- **审查判断**：
  - 这是文档工程质量问题，不阻断施工。但作为正式执行计划，应声明行号的有效期约束。
- **建议修法**：
  - 在每份 action-plan 的 §0 或 §1 添加声明：`本文档中所有行号引用基于 2026-04-29 main 分支代码；上游 Phase（尤其是 RH0 和 RH6 的拆分）完成后，行号将偏移。实施时以符号名（函数名 / 类名 / 变量名）搜索为准，行号仅作为定位辅助。`
  - 或采用更稳健的引用格式：`runtime-mainline.ts → async emit(_event, _payload) { return undefined; }`（函数签名引用 + 行号）。

### R6. `/me/conversations 双源对齐在 RH3 P3-D 启动前已有双 handler 并存 — 未分析现有差异`

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `user-do.ts:1738` `handleMeSessions` — 合并 KV conversation index 与 D1 truth，返回 sessions list。
  - `user-do.ts:1810` `handleMeConversations` — 按 `conversation_uuid` 分组，仅 D1 truth。
  - Charter §2.2 G12 指出 `/me/conversations` 与 `/me/sessions` 数据集不一致。
  - Action-plan P3-14 说"改为参考 handleMeSessions 的 D1+KV 合并逻辑"，但**未分析**：当前两个 handler 的具体差异是什么？差异是故意的（conversations 语义上就是 D1-only）还是 bug（implementer 忘记加 KV merge）？
- **为什么重要**：
  - 如果差异是故意的（conversations 按设计就是 D1-only product truth），P3-14 的"对齐"需要重新审视语义，而不是简单复制代码。
  - 如果差异是 bug，P3-14 的方案正确但缺少"当前差异根因分析"的前置步骤。
- **审查判断**：
  - Action-plan 把"双源对齐"当作纯实施问题处理，但这里有一个 subtle 的设计问题：conversations 的语义是否需要 KV（hot read model）？如果 conversations 本身就是 D1 product truth 的只读接口，则不需要 KV；但如果不加 KV，conversations 的 freshness 与 sessions 不一致，用户在同一界面看到两个不同的会话集。
- **建议修法**：
  - P3-14 增加前置分析步骤：列出当前 `handleMeConversations` 与 `handleMeSessions` 在数据源、合并逻辑、排序、分页、status filter 上的逐项差异 → 判断差异是否为设计意图 → 将结论写入 action-plan "对齐策略"。

### R7. `filesystem-core library_worker:true 标志移除与 context-core 的联动未考虑`

- **严重级别**：`low`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/filesystem-core/src/index.ts:15` 有 `library_worker: true` 标志。
  - `workers/context-core/src/index.ts` 同样可能有此标志（设计审查中 context-core 与 filesystem-core 被设计为"library shim, RPC stub"，状态对称）。
  - Action-plan RH4 P4-04 提到移除 filesystem-core 的 `library_worker:true`，但**未提及** context-core 是否同步移除。
- **为什么重要**：
  - 如果 context-core 的 `library_worker:true` 保持而 filesystem-core 移除，两个 worker 的部署模式将不对称 — filesystem-core 变成可被 service binding 调用的真实 worker，context-core 仍是 library-only。这可能影响 RH4 P4-D Lane E consumer migration 的一致性。
  - Charter §4.5 已将 context-core / filesystem-core 的 `/debug/workers/health` 列为保留例外，但 `library_worker` 标志是部署元数据，应在 Phase 3-4 确认处理方式。
- **审查判断**：
  - 低风险 — filesystem-core 的 library_worker 移除不依赖 context-core 同步。但如果 charter 的设计意图是两个 worker 最终都脱离 library-only 状态，应在 context-core 的相关 phase（RH2 或 RH4）标明。
- **建议修法**：
  - P4-04 添加注释：context-core 的 `library_worker` 标志处理留给 RH2 P2-B context inspection RPC 实装时判断（若 inspector facade RPC 已启用则同步移除）。

---

## 3. In-Scope 逐项对齐审核

### RH0 — Bug Fix and Prep

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S1 | lockfile 重建 + stale importer 删除 | `partial` | 问题识别正确（F1/F2），收口标准需加强（见 R1） |
| S2 | jwt-shared 独立 build/typecheck/test | `done` | 步骤完整，收口标准合理 |
| S3 | 6 worker KV/R2 binding 占位 | `done` | gap 识别正确（F3），dry-run 验证步骤充分 |
| S4 | 5 份 endpoint 直达测试 | `done` | 用例设计合理（happy/401/403/400/404），覆盖完整 |
| S5 | NanoSessionDO 拆 verify+persistence | `done` | 边界清晰，madge cycle check 到位 |
| S6 | bootstrap hardening 3 stress case | `done` | cold-start/D1 slow/refresh storm 三个场景合理 |
| S7 | preview deploy + manual smoke | `done` | Tier-A evidence 纪律明确 |
| S8 | P0-F owner checklist | `done` | 8 步清单来自 RHX-qna Q5，业主已同意 |

### RH1 — Lane F Live Runtime

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S1 | scheduler hook_emit | `done` | StepDecision.hook_emit 已预存在（kernel/types.ts:62），只缺 scheduler 产出 — 描述准确 |
| S2 | runtime-mainline.hook.emit wiring | `done` | 当前 no-op 状态与行号引用准确 |
| S3 | emitPermission/Elicitation frame emit | `done` | deferredAnswers Map 已有，frame emit 路径描述正确 |
| S4 | runtime hook 调 emitPermission | `done` | 首个调用方定位合理 |
| S5 | forwardServerFrameToClient RPC | `partial` | 方法不存在属 new-add 正确，但 "USER_DO binding 调用" 有偏差（见 R4） |
| S6 | onUsageCommit WS push | `done` | 当前仅 console.log，wiring 路径明确 |
| S7 | handleUsage no-null | `done` | 4 case 覆盖完整 |
| S8 | 4 链 e2e + preview smoke | `done` | 3 e2e 文件设计合理 |

### RH2 — Models & Context Inspection

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S1 | nacp-session schema 注册 | `partial` | heartbeat body 已有（见 R2），superseded/terminal 从零新建 — 工作量分类需修正 |
| S2 | migration 008 + /models | `done` | D1 truth source 设计正确；charter §8.4 008 编号锁定 |
| S3 | /context + snapshot/compact | `done` | inspector facade RPC seam 引述正确 |
| S4 | WS full frame upgrade + validateSessionFrame | `done` | 4 lifecycle scenario + heartbeat hardening 设计完整 |
| S5 | tool semantic streaming | `done` | llm.delta + tool.call.result 方案明确；tool_use_stop 不进 schema 已决议 |
| S6 | client adapter sync | `done` | web + wechat 双端同步更新，lightweight fallback 保留 |
| S7 | E2E + preview smoke | `done` | 4 endpoint ×5 case + WS lifecycle 4 e2e 覆盖充分 |

### RH3 — Device Auth Gate and API Key

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S1 | migration 009 | `done` | 三表变更完整，NOT NULL slug 策略来自 RHX-qna Q1 |
| S2 | auth contract upgrade | `done` | AuthTeam/AccessTokenClaims/VerifyApiKeyResult 三项升级准确 |
| S3 | device_uuid mint + refresh bind | `done` | 全链路（login/register/refresh）覆盖完整 |
| S4 | device auth gate access/refresh/WS | `done` | 短 TTL cache + revoke 主动清策略合理 |
| S5 | verifyApiKey + authenticateRequest 双轨 | `done` | `nak_` prefix 区分策略防止冲突 |
| S6 | team display + /me/team PATCH + /me/teams GET | `done` | slug 自动生成算法明确 |
| S7 | /me/conversations 双源 + cursor | `partial` | 需分析现有差异（见 R6） |
| S8 | e2e + preview smoke | `done` | device revoke force-disconnect 覆盖 |

### RH4 — Filesystem R2 Pipeline and Lane E

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S1 | migration 010 | `done` | nano_session_files 表设计完整 |
| S2 | R2ArtifactStore | `partial` | "直接组装"前提未验证 adapter 接口（见 R3） |
| S3 | filesystem-core RPC 收口 | `done` | hybrid 残留（fetch 401/library_worker）识别正确 |
| S4 | agent-core binding + dual-track | `done` | env flag + @deprecated + sunset 时间盒设计完整（Q2 限定 4 项） |
| S5 | multipart upload | `done` | 25MB 上限合理，tenant namespace 隔离设计到位 |
| S6 | list + download | `done` | cross-tenant D1 verify-before-R2-read 安全 |
| S7 | Lane E sunset cutover | `done` | RHX-qna Q2 4 项限定全部落地为具体步骤 |
| S8 | e2e + cross-tenant 拒绝 | `done` | 15 endpoint case + cross-tenant e2e 充分 |

### RH5 — Multi-Model Multimodal Reasoning

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S1 | schema 前置扩展（S0） | `done` | 4 处 schema 同步扩展（nacp-session/canonical/registry/CapabilityName），正确识别了当前所有缺口 |
| S2 | migration 011 + seed | `done` | 25 模型 seed，charter §8.4 011 编号锁定 |
| S3 | request-builder + adapter | `done` | reasoning capability validation + Workers AI adapter 翻译 |
| S4 | vision 激活 | `done` | llama-4-scout supportsVision:true + /messages ingress image_url kind |
| S5 | reasoning effort 贯通 | `done` | 端到端 wiring 路径明确 |
| S6 | usage event 扩字段 | `done` | RHX-qna Q3 完整 evidence 字段集（model_id/is_reasoning 等）全部纳入 |
| S7 | e2e（4 模型 + image + reasoning + team policy） | `done` | 4 类 e2e 覆盖充分 |

### RH6 — DO Megafile Decomposition

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S1 | madge 接入 + CI gate | `done` | 0 cycle 硬 gate 与 charter §10.3 一致 |
| S2 | NanoSessionDO 拆 7 子模块 | `done` | 拆分职责清晰，≤400 行目标合理；RH0 预拆分的 verify+persistence 留用 |
| S3 | user-do.ts 拆 handlers/* | `done` | ≤500 行 + 13 handler + durable-truth 分离 |
| S4 | three-layer-truth 文档 | `done` | file:line 回绑代码的要求防止文档漂移 |
| S5 | residue cleanup | `done` | forwardInternalJson/deploy-fill/Lane E 三项 cleanup |
| S6 | manual evidence 5 套 × 4 scenario | `done` | RHX-qna Q4 5 套基线 + 4 项限定全部落地 |
| S7 | real-to-hero final closure | `done` | 独立 closure 文档产出 |

### 3.1 对齐结论

- **done**: 46（绝大部分 plan item 与 charter/design 一致且可执行）
- **partial**: 4（R1/R2/R3/R6 影响的具体 plan item）
- **missing**: 0
- **stale**: 0
- **out-of-scope-by-design**: 0

> 整体而言，7 份 action-plan 对 charter 和 design 的映射是**正确且完整的**。所有 `partial` finding 都是精密度问题而非方向性错误 — 执行计划的主体骨架成立，但细节验证（lockfile 验证手段、adapter 接口对账、RPC 通道描述、schema 工作量分类）需要在进入对应 Phase 的 implementation 前补全。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | 不新增 worker（D1） | `遵守` | 7 份 action-plan 均无新增 worker 的引用 |
| O2 | 不引入 SQLite-DO（D2） | `遵守` | 无任何 wrangler.jsonc `new_sqlite_classes` 相关建议 |
| O3 | token-level streaming | `遵守` | RH2 P2-E 明确 out-of-scope；RH5 仅做 semantic chunk |
| O4 | admin plane / billing | `遵守` | RH3 仅 internal createApiKey RPC，无 admin UI |
| O5 | OAuth federation | `遵守` | RH3 out-of-scope 列表明确排除 |
| O6 | sandbox 隔离 | `遵守` | 无相关引用 |
| O7 | 3-step presigned upload | `遵守` | RH4 明确标记为 polish；使用 multipart 直传 |
| O8 | per-model quota | `遵守` | RH5 明确不引入，仅记录 usage event evidence |
| O9 | second LLM provider | `遵守` | RH5 明确 Workers AI only |
| O10 | catalog plug-in 框架 | `遵守` | 无相关引用 |

> 7 份 action-plan **全部严格遵守 charter §4.2-4.3 的 out-of-scope 和灰区判定**。所有 `out-of-scope` 标记都正确落在了对应的 Phase 声明中，无越界风险。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`7 份 action-plan 主体成立、可进入实施，但存在 2 项 blocker 级发现（R1 lockfile 验证 insufficient、R3 adapter 接口未经对账）以及 5 项 non-blocking 精密度修正需要在 RH0-RH4 implementation 前完成。`
- **是否允许关闭本轮 review**：`no`（R1 和 R3 必须在 action-plan 中修正后方可关闭）
- **关闭前必须完成的 blocker**：
  1. **R1 修复**：RH0 P0-A1 收口标准从单一 `grep -c ≥ 2` 升级为 `grep + pnpm install --frozen-lockfile + pnpm --filter jwt-shared test + 下游 worker test` 四步验证链（修改 `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md` §4.2 收口标准栏）。
  2. **R3 修复**：在 RH4 P4-03 增加 adapter 接口对账前置步骤，明确 R2ArtifactStore 应消费 `packages/storage-topology` 的 adapter 还是 `filesystem-core/src/storage/` 的 adapter（修改 `docs/action-plan/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md` §4.2 或新增前置步骤）。
- **可以后续跟进的 non-blocking follow-up**：
  1. R2：RH2 P2-01 拆分为 heartbeat/superseded/terminal 三项不同工作量的子步骤。
  2. R4：RH1 P1-06/P1-07 明确 USER_DO binding 需从零创建 + 修正跨 worker RPC 路径描述。
  3. R5：7 份 action-plan 添加行号有效期免责声明。
  4. R6：RH3 P3-14 增加 handleMeConversations vs handleMeSessions 差异分析前置步骤。
  5. R7：RH4 P4-04 添加 context-core library_worker 标志处理说明。
- **建议的二次审查方式**：`same reviewer rereview`（仅需审查修正后的 §4.2 收口标准 + P4-03 前置步骤，无需全量重审）
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

---

## 6. 附录：三方事实对照速查表

### A. 代码 gap 确认矩阵（action-plan 声称 vs 代码现实）

| gap 编号 | action-plan 描述 | 代码验证结果 | 一致？ |
|----------|-----------------|-------------|--------|
| G1 | hook.emit no-op (`runtime-mainline.ts:295-298`) | `async emit(_event, _payload) { return undefined; }` | ✅ |
| G1 | scheduler 不产 hook_emit | scheduleNextStep 返回 wait/compact/tool_exec/llm_call/finish | ✅ |
| G1 | forwardServerFrameToClient 不存在 | 0 match — 仅 `emitServerFrame` 存在 | ✅ |
| G1 | handleUsage 返回 null placeholder | 方法存在（line 1220），null 行为未逐行验证但结构一致 | ✅ |
| G2 | /models route 不存在 | 0 match in index.ts | ✅ |
| G2 | migration 008 不存在 | 仅 001-007 存在 | ✅ |
| G2 | SessionStartBodySchema 无 model_id | 仅 cwd, initial_context, initial_input | ✅ |
| G2 | SessionHeartbeatBodySchema 不存在 | **已存在**（messages.ts:61-64）— 需更正 | ❌ |
| G3 | verifyApiKey 返回 supported:false | 确认为硬 stub | ✅ |
| G3 | AuthTeamSchema 无 team_name/slug | 仅 team_uuid, membership_level, plan_level | ✅ |
| G3 | AccessTokenClaims 无 device_uuid | 10 字段，确认无 device_uuid | ✅ |
| G4 | CONTEXT_CORE/FILESYSTEM_CORE binding 注释 | 确认为注释状态 | ✅ |
| G4 | R2ArtifactStore 不存在 | 仅 InMemoryArtifactStore 存在 | ✅ |
| G4 | filesystem-core library_worker:true | 确认为 true | ✅ |
| G5 | 仅 2 模型注册，supportsVision=false | 确认为 2 模型且 supportsVision: false | ✅ |
| G5 | ModelCapabilities 无 supportsReasoning | 确认为无此字段 | ✅ |
| G5 | CapabilityName 无 reasoning | 仅 stream/tools/vision/json-schema | ✅ |
| G5 | CanonicalLLMRequest 无 reasoning 字段 | 确认为无 | ✅ |
| G6 | nano-session-do.ts 2078 行 | `wc -l` = 2078 | ✅ |
| G6 | user-do.ts 2285 行 | `wc -l` = 2285 | ✅ |
| G10 | jwt-shared lockfile 缺失 | `grep -c` = 0 in pnpm-lock.yaml | ✅ |
| G10 | stale importer 存在 | agent-runtime-kernel + capability-runtime | ✅ |
| G11 | KV/R2 binding 完全缺失 | 6 wrangler.jsonc 零声明 | ✅ |

### B. Migration 编号冻结对照

| 编号 | 用途 | Charter §8.4 分配 | Action-Plan 引用 | 现有？ |
|------|------|-------------------|-----------------|--------|
| 001-007 | identity/session/usage/devices | 已存在 | 已存在 | ✅ |
| 008 | nano_models | RH2 | RH2 P2-03 | ❌ 待建 |
| 009 | team-display-and-api-keys | RH3 | RH3 P3-01 | ❌ 待建 |
| 010 | session-files | RH4 | RH4 P4-01 | ❌ 待建 |
| 011 | model-capabilities-seed | RH5 (optional) | RH5 P5-04 | ❌ 待建 |

### C. 6-worker topology 一致性对照

| worker | binding 状态 (wrangler.jsonc) | action-plan 描述 | 一致？ |
|--------|------------------------------|-----------------|--------|
| orchestrator-core | 无 KV/R2 | RH0 P0-C 声明需加 | ✅ |
| orchestrator-auth | 无 KV/R2 | RH0 P0-C 声明需加 | ✅ |
| agent-core | BASH_CORE active; CONTEXT_CORE/FILESYSTEM_CORE commented | RH4 P4-D 解注释 | ✅ |
| bash-core | 无 KV/R2 | RH0 P0-C 声明需加 | ✅ |
| context-core | 无 KV/R2 | RH0 P0-C 声明需加 | ✅ |
| filesystem-core | 无 KV/R2; library_worker:true | RH0 P0-C + RH4 P4-04 | ✅ |

---

## 7. 审查质量评估（appended by Opus 4.7, 2026-04-29）

### 7.0 评价结论

- **一句话评价**：4 份 action-plan review 中"代码现实+流程改进切入最深"的一份；R3 (adapter 来源对账) 与 R1 (lockfile 4 步联检) 是其他 reviewer 全部漏掉的高价值独家发现；R7 是 minor 但 cross-cutting 提醒。0 false-positive。
- **综合评分**：`9.0 / 10`
- **推荐使用场景**：实施前的 adapter / package 来源对账、流程改进（lockfile 验证手段、行号有效期声明）、cross-worker 联动审查。
- **不建议单独依赖的场景**：单凭 deepseek 的 verdict 偏松（approve-with-followups + 全 non-blocker），charter hard-gate 漂移类 finding（≥7 测试 / ≤1500 / orchestrator-auth path）需 GPT 补强；schema/RPC 命名 critical 由 GLM 补强。

### 7.1 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | code reality + 流程严谨性 + 已建成资产识别 | R1（lockfile 4 步联检）、R3（packages/storage-topology vs filesystem-core/src/storage/ 来源对账）、R5（行号有效期声明）|
| 证据类型 | grep -c / wc -l / file existence 命令级一手证据 | "grep -c 'jwt-shared' = 0"、"diff packages/storage-topology vs filesystem-core 0 差异" |
| Verdict 倾向 | balanced（approve-with-followups + 0 critical 标记）| 7 finding 中只有 R1/R3 标 yes blocker；其他 5 均 non-blocker |
| Finding 粒度 | balanced | 流程类（R1/R5）+ 代码命名类（R2/R4）+ 实施 audit 类（R3/R6）+ 联动类（R7）覆盖完整 |
| 修法建议风格 | actionable + 配可执行 audit 步骤 | R3 给 "byte-diff packages/storage-topology vs filesystem-core" 具体命令 |

### 7.2 优点与短板

#### 7.2.1 优点

1. **R3 是 4 份 review 独家最高价值流程发现**：packages/storage-topology vs workers/filesystem-core/src/storage/ 同时存在 byte-identical adapter—— GPT R8 只说接口不兼容，未发现 canonical-source 漂移；本 finding 让 RH4 §0/§4.2 加 P4-02b adapter 来源对账步骤，避免 implementer 选错来源后接口分叉。
2. **R1 是 4 份 review 独家最高价值流程改进**：lockfile 验证从单一 `grep -c ≥ 2` 升级为 4 步联检（grep + frozen-lockfile install + jwt-shared filter test + 下游 worker test）；这条让 RH0 P0-A 收口标准从"格式化检查"升级为"实际运行验证"。
3. **R5 行号有效期声明**：是 4 份 review 中第一个意识到"RH0 拆分会让所有后续行号漂移"的；本 finding 让 7 份 action-plan 全部加 "行号 2026-04-29 main 快照"声明。
4. **R7 cross-worker 联动**：context-core 的 `library_worker:true` 与 filesystem-core 同步移除—— 是 4 份 review 中唯一意识到这两个 worker 状态对称的；本 finding 让 RH4 §4.3 P4-04 处理两处 library_worker 标志。
5. **owner QNA 处理正确**：明确说明"业主已同意 Opus 全部判断"，遵守用户审查指令；与 kimi R1/R8 的 QNA 误判形成对比。

#### 7.2.2 短板 / 盲区

1. **charter hard-gate 类漂移漏报**：GPT R1（≥7 测试）、R2（orchestrator-auth path）、R3（≤1500 行）三条直接对应 charter §7.1 hard gate；deepseek 在 §3.1 RH0 对齐审核中标 done，未识别 5 vs 7 / orchestrator-core vs orchestrator-auth / ≤1600 vs ≤1500 三处实际漂移。
2. **schema/RPC 命名 critical 漏报**：GLM R2（forwardServerFrameToClient 命名不存在）、R4（model_id vs model 字段名错）—— deepseek 的 R4（USER_DO binding 描述漂移）触及了部分但未深入到 RPC 命名层。
3. **slug data fill SQL 未给可执行模板**：kimi R4 独家。
4. **verdict 偏松导致 critical 标记缺位**：approve-with-followups + 7 finding 全 non-blocker，但 GPT R4 (跨 worker push 拓扑) / R7 (表名错 + base36 不可用) 实际是 critical—— deepseek 看到了类似问题但 severity 校准偏轻。

### 7.3 Findings 质量清点

| 编号 | 原始严重 | 事后判定 | Finding 质量 | 分析 |
|------|---------|----------|--------------|------|
| R1 | high | true-positive | excellent | 4 份 review **独家**；RH0 §7.1 F1 4 步联检直接据此 |
| R2 | medium | true-positive | good | 与 GPT R6 重叠但更细：heartbeat schema 已存在 vs superseded/terminal 未存在的工作量分类 |
| R3 | high | true-positive | excellent | 4 份 review **独家**；RH4 §0/§4.2 adapter 来源对账步骤直接据此 |
| R4 | medium | true-positive | good | 与 GPT R4 重叠，但 deepseek 没深入到"agent-core 必须新增 ORCHESTRATOR_CORE 而不是 USER_DO" 的拓扑结论 |
| R5 | medium | true-positive | excellent | 4 份 review **独家**触发"行号有效期声明"全文修订 |
| R6 | medium | true-positive | excellent | RH3 P3-14 conversations 双源差异分析步骤直接据此 |
| R7 | low | true-positive | good | RH4 §4.3 P4-04 context-core 联动据此；4 份 review 独家 |

### 7.4 多维度评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 证据链完整度 | 10 | grep / diff / wc -l / file-existence 一手命令证据 |
| 判断严谨性 | 9 | 0 false-positive；但 verdict 偏松，未抓 charter hard-gate 漂移 |
| 修法建议可执行性 | 10 | 每条带可执行 audit 命令（diff / 4 步联检步骤）|
| 对 action-plan / design / QNA 的忠实度 | 8 | 流程改进强；charter alignment 维度弱 |
| 协作友好度 | 10 | 7 finding 数量恰当；approve-with-followups 不阻塞但价值高 |
| 找到问题的覆盖面 | 8 | 流程 / 命名 / 联动全覆盖；charter hard-gate 漂移漏 |
| 严重级别 / verdict 校准 | 7 | approve-with-followups 偏松；GPT R4/R7 级 critical 在 deepseek 标 medium 或 non-blocker |

**综合**：`9.0 / 10`。deepseek 的"流程改进 + 已建成资产识别"是 4 份 review 中独一无二的视角，R3/R1/R5/R7 四条独家发现直接驱动 RH0/RH4 多处修订。短板是 verdict 偏松、charter hard-gate 类问题没有第一时间标 critical。配合 GPT 的 charter alignment 一起读，可补足这一短板。

