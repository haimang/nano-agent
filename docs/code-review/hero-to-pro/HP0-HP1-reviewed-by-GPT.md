# Nano-Agent 代码审查

> 审查对象: `hero-to-pro / HP0-HP1 + current broader hero-to-pro handoff`
> 审查类型: `mixed`
> 审查时间: `2026-04-30`
> 审查人: `GPT-5.4`
> 审查范围:
> - `docs/action-plan/hero-to-pro/HP0-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP1-action-plan.md`
> - `docs/issue/hero-to-pro/HP0-closure.md`
> - `docs/issue/hero-to-pro/HP1-closure.md`
> - `docs/charter/plan-hero-to-pro.md`
> - `docs/architecture/hero-to-pro-schema.md`
> - `workers/orchestrator-core/**`
> - `workers/agent-core/**`
> - `workers/orchestrator-core/migrations/007-013*.sql`
> - `packages/nacp-session/**`
> - `clients/api-docs/**`
> 对照真相:
> - `docs/charter/plan-hero-to-pro.md`
> - `docs/action-plan/hero-to-pro/HP0-action-plan.md`
> - `docs/action-plan/hero-to-pro/HP1-action-plan.md`
> - `docs/issue/hero-to-pro/HP0-closure.md`
> - `docs/issue/hero-to-pro/HP1-closure.md`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`HP0~HP1 的代码、migration 与 closure 主体成立，足以作为 hero-to-pro 的稳定起点；但 broader hero-to-pro 当前还不能被描述为“文档完全对齐、继承契约零漂移”，因为 clients/api-docs 与若干下游 handoff 仍有已证实 follow-up。`
- **结论等级**：`approve-with-followups`
- **是否允许关闭本轮 review**：`yes`
- **本轮最关键的 1-3 个判断**：
  1. `HP0 的三入口 model law、HP1 的 007-013 DDL Freeze Gate、consumer map 与 schema-freeze test 都真实落地，HP0/HP1 closure 大体可信。`
  2. `当前 confirmed 的主要问题不在 HP0/HP1 主实现，而在 broader hero-to-pro 的 client-facing truth：usage / error / catalog 文档与现行代码不完全一致。`
  3. `HP2/HP4 仍继承两条真实 seam：model_id ↔ modelId 翻译链，以及 free-form ended_reason；它们不是 HP0/HP1 blocker，但必须在后续 phase 明确冻结。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-hero-to-pro.md`
  - `docs/action-plan/hero-to-pro/HP0-action-plan.md`
  - `docs/action-plan/hero-to-pro/HP1-action-plan.md`
  - `docs/issue/hero-to-pro/HP0-closure.md`
  - `docs/issue/hero-to-pro/HP1-closure.md`
  - `docs/templates/code-review.md`
- **核查实现**：
  - `packages/nacp-session/src/messages.ts`
  - `workers/orchestrator-core/src/{session-lifecycle.ts,user-do/session-flow.ts,user-do/message-runtime.ts,user-do/surface-runtime.ts,index.ts,user-do-runtime.ts}`
  - `workers/agent-core/src/host/{runtime-mainline.ts,turn-ingress.ts}`
  - `workers/orchestrator-core/migrations/{008,009,011,012,013}-*.sql`
  - `workers/orchestrator-core/test/{binding-presence.test.ts,migrations-schema-freeze.test.ts}`
  - `workers/agent-core/test/host/system-prompt-seam.test.ts`
  - `clients/api-docs/{catalog,session,usage,error-index}.md`
- **执行过的验证**：
  - `pnpm --filter @haimang/orchestrator-core-worker test`
  - `pnpm --filter @haimang/agent-core-worker test`
  - `rg "usage-d1-unavailable|model-unavailable|model-disabled|wrong-device|spike-disabled|no-attached-client" workers`
  - `glob docs/runbook/*`
- **复用 / 对照的既有审查**：
  - `none` — `本文件只基于当前代码、migration、action-plan、closure、charter 与 clients/api-docs 的一手事实；未采纳其他 reviewer 的结论。`

### 1.1 已确认的正面事实

- `HP0` 的 `/start` / `/input` / `/messages` 已真实共享同一条 `parseModelOptions()` ingress law：`packages/nacp-session/src/messages.ts:43-52,119-136`、`workers/orchestrator-core/src/session-lifecycle.ts:51-128`、`workers/orchestrator-core/src/user-do/session-flow.ts:238-250,470-483`、`workers/orchestrator-core/src/user-do/message-runtime.ts:135-139,221-224,274-289` 一致对齐。
- `HP0` 的 verify-only / cleanup 承诺真实成立：`workers/orchestrator-core/test/binding-presence.test.ts:40-71` 钉住了 `CONTEXT_CORE` 与 `LANE_E_RPC_FIRST=false` 当前事实；`docs/runbook/` 目录现只剩 `zx5-r28-investigation.md`，说明 `docs/runbook/zx2-rollback.md` 已被删除。
- `HP0` 的 system prompt seam 确实按 partial 法律落地：`workers/agent-core/src/host/runtime-mainline.ts:174-188` 已接受 `modelId?`，`workers/agent-core/test/host/system-prompt-seam.test.ts:10-33` 证明 HP0 阶段“带不带 modelId 行为一致”。
- `HP1` 的 007-013 migration、consumer map 与 schema-freeze test 全部存在：`docs/issue/hero-to-pro/HP1-closure.md:16-23,149-206`、`docs/architecture/hero-to-pro-schema.md:11-241`、`workers/orchestrator-core/test/migrations-schema-freeze.test.ts:115-257` 都能互相对上。
- 当前验证结果支持 “HP0/HP1 baseline 可用” 的结论：`orchestrator-core` 测试 `21 files / 196 tests` 通过，`agent-core` 测试 `102 files / 1072 tests` 通过。

### 1.2 已确认的负面事实

- `clients/api-docs` 当前不是完全 error-free：`clients/api-docs/usage.md:56-69,88-94`、`clients/api-docs/error-index.md:75-98`、`clients/api-docs/catalog.md:95-97,120-121` 与现行实现存在已证实漂移。
- `HP0-closure` 的 lockfile 证据里，`13 个 importer key` 这个数字不准确；`pnpm-lock.yaml` 当前可见 importer 实际是 `14` 个（root + 7 packages + 6 workers）。
- broader hero-to-pro 仍有两条下游继承 seam：`model_id` 与 `modelId` 在 orchestrator/agent 两侧并未彻底统一；`ended_reason` 虽已落表，但仍是 free-form 列，真正的值域冻结留给 HP4。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 直接核对了 action-plan、closure、charter、schema doc、migrations、实现代码与 clients/api-docs。 |
| 本地命令 / 测试 | `yes` | 重新执行了 `orchestrator-core` 与 `agent-core` 原生测试脚本，并核对 runbook / 错误码搜索结果。 |
| schema / contract 反向校验 | `yes` | 反查了 `007-013` DDL、schema-freeze test、ingress schema、ad-hoc error codes 与 route 文档的一致性。 |
| live / deploy / preview 证据 | `no` | 本轮不以 preview/live deploy 作为主要证据。 |
| 与上游 design / QNA 对账 | `yes` | 以 charter / action-plan / closure 的冻结结论为比照面，判断 HP0/HP1 是否真正完成与是否越界。 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | `clients/api-docs` 对 usage / error truth 存在实质漂移 | `medium` | `docs-gap` | `no` | 在 HP9 文档收口前，至少修正 `usage.md` / `error-index.md` / `session.md` 的错误码与 usage 占位语义 |
| R2 | `catalog.md` 不再是当前 catalog registry 的忠实镜像 | `low` | `docs-gap` | `no` | 对齐 `/files` bytes 能力与 verify agent 描述，避免 catalog 页自相矛盾 |
| R3 | HP0 closure 的 lockfile importer 计数有事实性笔误 | `low` | `docs-gap` | `no` | 将 `13` 改为 `14`，或去掉具体数字只保留“无 stale drift” |
| R4 | HP0/HP1 留给 HP2/HP4 的 handoff seam 仍需显式冻结 | `medium` | `protocol-drift` | `no` | 在 HP2/HP4 明确锁定 model naming translation 与 ended_reason 值域 |

### R1. `clients/api-docs` 对 usage / error truth 存在实质漂移

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `clients/api-docs/usage.md:56-69,88-94` 声称 usage placeholder 是全 `null`，且 D1 读取失败“只会 warn，不会让请求失败”。
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:130-163` 的当前实现实际返回零值 placeholder（`0`，不是 `null`），并在 D1 读取失败时直接返回 `503` + `usage-d1-unavailable`。
  - `clients/api-docs/error-index.md:79-98` 未列出 `usage-d1-unavailable`、`wrong-device`、`model-unavailable`、`model-disabled`、`spike-disabled`、`no-attached-client`。
  - 这些 code 当前真实存在于 `workers/orchestrator-core/src/user-do/surface-runtime.ts:82-87,156-163,386-402` 与 `workers/orchestrator-core/src/user-do-runtime.ts:834-849`。
- **为什么重要**：
  - 这不是措辞小差异，而是会直接影响客户端对 503/403/409 分支的处理、usage 空态渲染以及错误分类逻辑。
  - 当前 `clients/api-docs` 已被当作 client-facing truth 使用；如果这里写错，后续 HP9 的大包更新之前都会持续误导消费方。
- **审查判断**：
  - HP0/HP1 的主实现没有问题，问题在于 broader hero-to-pro 的 client docs 还没有完全追上当前代码现实。
  - 这不阻塞把 HP0/HP1 视为已完成，但阻止把“当前 clients/api-docs 已完整正确匹配代码”当作事实。
- **建议修法**：
  - 修正 `usage.md`：把 placeholder 改成零值示例，并把 D1 失败行为改成 `503 usage-d1-unavailable`。
  - 修正 `error-index.md`：补录上述 6 个 ad-hoc public codes。
  - 修正 `session.md`：把 `/start` / `/input` / `/verify` / follow-up device gate 的遗漏错误码补齐。

### R2. `catalog.md` 不再是当前 catalog registry 的忠实镜像

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `clients/api-docs/catalog.md:95-97` 仍写 `/files` “当前不提供 bytes download”。
  - 但 `workers/orchestrator-core/src/index.ts:1657-1678` 已实现 `readArtifact` 字节读取并直接返回 raw bytes；`clients/api-docs/session.md:27,378-390` 也已正确记录 `GET /sessions/{id}/files/{fileUuid}/content`。
  - `clients/api-docs/catalog.md:120-121` 把 `nano-preview-verify` 描述成包含 `compact / filesystem posture harness`。
  - 但当前静态 registry `workers/orchestrator-core/src/catalog-content.ts:94-99` 的描述仍只写到 `initial-context` 级别，并不是 catalog 文档里那条更完整的说明。
- **为什么重要**：
  - catalog 页承担“先看概览再进详情”的入口作用；如果入口页和真实 registry / detail page 打架，读者很容易拿到错误的 capability 认知。
  - 这类漂移虽然不伤 runtime correctness，但会伤文档体系的一致性和可维护性。
- **审查判断**：
  - 当前 `catalog.md` 更像“解释性文档”，而不是 registry truth 的逐项镜像；这一点应该被纠正或显式说明。
- **建议修法**：
  - 对齐 `/files` 描述，明确 bytes download 已存在。
  - 对齐 `nano-preview-verify` 的描述：要么把 `catalog-content.ts` 更新到文档表述，要么把 `catalog.md` 改回与 registry 完全一致的 wording。

### R3. HP0 closure 的 lockfile importer 计数有事实性笔误

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/issue/hero-to-pro/HP0-closure.md:21,118` 两处都写了“13 个 key 全部对应工作树真实目录”。
  - `pnpm-lock.yaml:9,15,30,39,60,82,98,117,136,173,198,229,257,282` 当前可见 importer 实际为 `14` 个。
  - 同时，`HP0` 关于“无 stale importer，因此不需要触碰 lockfile”的核心判断本身是正确的。
- **为什么重要**：
  - HP0 closure 被下游 phase 当作审计输入；这里的数字虽然不影响代码行为，但会削弱 closure 作为事实凭证的精确性。
- **审查判断**：
  - 这是 closure 证据书写问题，不是 HP0 实现问题，也不改变 `conditional cleanup = not-needed` 的结论。
- **建议修法**：
  - 将 `13` 改为 `14`，或改写成“不再写具体数量，只声明所有 importer 均对应真实工作树目录”。

### R4. HP0/HP1 留给 HP2/HP4 的 handoff seam 仍需显式冻结

- **严重级别**：`medium`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - public/storage-facing side 统一使用 `model_id`：`packages/nacp-session/src/messages.ts:43-52,119-136`、`workers/orchestrator-core/src/session-lifecycle.ts:51-128`、`workers/orchestrator-core/src/user-do/session-flow.ts:363-372,472-480`。
  - agent-core internal side 仍主要使用 `modelId`：`workers/agent-core/src/host/turn-ingress.ts:85-107,120-125`、`workers/agent-core/src/host/runtime-mainline.ts:190-211`；其中 `runtime-mainline.ts:198-203` 还显式兼容 `message.model_id` 与 `message.modelId` 双写读取。
  - `workers/agent-core/src/host/runtime-mainline.ts:174-178` 的 `withNanoAgentSystemPrompt(modelId?)` 仍是 seam-only；`docs/issue/hero-to-pro/HP1-closure.md:47-49` 也把真 wiring handoff 给 HP2。
  - `workers/orchestrator-core/migrations/008-session-model-audit.sql:24-29` 将 `ended_reason` 落为 free-form `TEXT`，并在注释中明确“HP4 enumerates app-side”。
- **为什么重要**：
  - 这些 seam 如果在 HP2/HP4 没有被显式冻结，就很容易变成“代码里能凑合跑，但文档、D1、HTTP、agent runtime 的命名与值域各说各话”。
  - 这类问题不一定立刻炸，但会在模型切换、fallback 审计、session close reason、checkpoint replay 等 phase 里不断放大。
- **审查判断**：
  - 这不是 HP0/HP1 的失败；相反，HP0/HP1 closure 已经诚实地把它们登记成 partial/handoff。
  - 但从 broader hero-to-pro 视角看，当前还不能说“这些 contract 已经 fully frozen”。
- **建议修法**：
  - HP2 明确固定 `model_id`（public/D1）与 `modelId`（agent internal）的翻译边界，并补测试，避免继续依赖双读容错掩盖漂移。
  - HP4 在首次写入 `ended_reason` 之前，先把允许值集合与消费者语义写进 design/action-plan/closure，而不是继续依赖 free-form 口头约定。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | HP0：`/start` / `/input` / `/messages` 三入口 model law 对齐 | `done` | `parseModelOptions()` 已成为三入口共享 validator，字段转发与 model gate 均已统一。 |
| S2 | HP0：`withNanoAgentSystemPrompt(modelId?)` seam | `partial` | seam 已落地，但真 suffix wiring 仍按 closure handoff 给 HP2。 |
| S3 | HP0：verify-only binding / lane-E 当前事实冻结 + runbook cleanup | `done` | binding-presence test 与 runbook 删除都已真实存在。 |
| S4 | HP0：conditional lockfile cleanup | `done` | “不需要改 lockfile” 的判断正确；只是 closure 里的 importer 数量写错。 |
| S5 | HP1：007-013 七个 migration 一次性冻结 | `done` | migration、schema doc、closure、schema-freeze test 四层证据一致。 |
| S6 | HP1：Q6 correction law + consumer map + schema assertion | `done` | correction registry、consumer map 和 `migrations-schema-freeze.test.ts` 都已就位。 |
| S7 | HP1：`base_instructions_suffix` / HP0 seam 真接线 + prod baseline | `partial` | 列已落表，但 wiring 留 HP2、prod baseline 留 HP9，closure 也已如实登记。 |
| S8 | broader hero-to-pro：当前 clients/api-docs 已与代码完全一致 | `stale` | `usage.md` / `error-index.md` / `catalog.md` 仍有 confirmed drift。 |
| S9 | broader hero-to-pro：HP0/HP1 向 HP2/HP4 的继承契约已 fully frozen | `partial` | handoff 已登记，但 model naming 与 ended_reason 值域尚未在消费 phase 锁死。 |

### 3.1 对齐结论

- **done**: `5`
- **partial**: `3`
- **missing**: `0`
- **stale**: `1`
- **out-of-scope-by-design**: `0`

这更像“HP0~HP1 作为基础 phase 已经完成，但 broader hero-to-pro 的文档真相与下游契约仍需继续收口”，而不是“从 HP0 到当前所有对外 truth 都已经 fully settled”。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | HP0 不改 wrangler / 不翻转 `CONTEXT_CORE` 与 `LANE_E_RPC_FIRST` final-state | `遵守` | 当前只做 verify-only，与 charter / HP0 action-plan 一致。 |
| O2 | HP0 不强删 `forwardInternalJsonShadow` / `parity-bridge` residue | `遵守` | closure 已将其 retained 给 HP8-B / HP10，没有越界“顺手清理”。 |
| O3 | HP1 不新增 `014+` correction migration | `遵守` | 当前只有 `007-013`，DDL Freeze Gate 口径成立。 |
| O4 | HP1 不把 prod baseline 冒充成本 phase 已完成事实 | `遵守` | HP1 closure 已把 prod baseline 明确 handoff 给 HP9。 |
| O5 | 当前 `clients/api-docs` 漂移是否意味着 HP0/HP1 phase 失职 | `误报风险` | charter `§6.3` 已把 `clients/api-docs` 集中更新冻结到 HP9；因此文档漂移是 broader-phase follow-up，不应被误判成 HP0/HP1 越界或未完成。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`HP0~HP1 可以关闭；但 broader hero-to-pro 仍应带着文档与 handoff follow-up 继续推进，不能宣称“当前所有 client-facing truth 与后续 phase 契约都已 fully aligned”。`
- **是否允许关闭本轮 review**：`yes`
- **关闭前必须完成的 blocker**：
  1. `无（就 HP0~HP1 主实现与 closure 而言）`
  2. `无`
- **可以后续跟进的 non-blocking follow-up**：
  1. `修正 clients/api-docs：至少处理 usage/error/catalog/session 中已经证实的 drift，或在 HP9 文档包中一次性收口。`
  2. `在 HP2/HP4 明确冻结 model naming translation、base_instructions_suffix 真 wiring 与 ended_reason 值域。`
  3. `修正 HP0-closure 的 importer 计数笔误。`
- **建议的二次审查方式**：`independent reviewer`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

---

## 6. 复核后修复工作日志

> 本节记录在阅读 `docs/code-review/hero-to-pro/HP0-HP1-reviewed-by-deepseek.md` 与 `docs/code-review/hero-to-pro/HP0-HP1-reviewed-by-GLM.md` 后，对已核实问题实施的二次修复。

### 6.1 已核实并修复的项

1. `clients/api-docs/session.md`
   - 修正 `/models` 示例到当前真实 seed。
   - 为 `/start` / `/input` / `/messages` 补入 `model_id` / `reasoning`。
   - 为 `/verify` 与 common session errors 补入 `spike-disabled` / `no-attached-client` / `wrong-device` / `model-unavailable` / `model-disabled`。
2. `clients/api-docs/usage.md`
   - placeholder 改为 zero shape，不再写成全 `null`。
   - 明确 D1 失败返回 `503 usage-d1-unavailable`。
3. `clients/api-docs/error-index.md`
   - 补齐当前真实 emitted 的 6 个 public ad-hoc code。
4. `packages/nacp-core/src/error-registry.ts`
   - 将 `wrong-device`、`usage-d1-unavailable`、`model-unavailable`、`model-disabled`、`spike-disabled`、`no-attached-client` 正式纳入统一 registry，使文档与 `resolveErrorMeta()/getErrorMeta()` 对齐。
5. `clients/api-docs/catalog.md`
   - 将 `/files` 与 `nano-preview-verify` 的描述改回与当前静态 registry 一致。
6. `docs/issue/hero-to-pro/HP0-closure.md`
   - 将 `pnpm-lock.yaml` importer 数量从 `13` 修正为 `14`。
7. `docs/issue/hero-to-pro/HP1-closure.md`
   - 补充 007 仅冻结 column shape / alias truth、尚未完成 model metadata 真值回填的事实。
   - 明确 `clear-partial: HP0/P1` 已顺延到 HP2 closure。
   - 补入 HP0 → HP1 的测试基线衔接说明。

### 6.2 核实后未采纳为本轮修复项的结论

1. `model_id` ↔ `modelId` 双命名并存：事实成立，但属于 HP2 应显式冻结的跨 worker 契约，而不是在 HP0/HP1 后回头做破坏性重命名。
2. `ended_reason` 为 free-form TEXT：事实成立，但第一次真正冻结应发生在 HP4 消费该字段时。
3. `parseModelOptions()` 的 exactness / union 收紧建议：属于防御性重构，不是当前 bug。
4. 009 rebuild 的 prod 幂等 / 锁表担忧：属于 HP9 prod baseline 与运维策略问题，不是当前已证实的本地实现错误。

---

## 7. 新的收口意见

- **修复后 verdict**：`HP0~HP1 继续保持可关闭状态；本轮复核中确认成立的 client docs / error registry / closure truth 漂移已完成修复。`
- **是否允许关闭本轮 review**：`yes`
- **修复后 blocker**：
  1. `无`
  2. `无`
- **remaining non-blocking follow-up**：
  1. `HP2 冻结 model_id（public/D1）↔ modelId（agent internal）的翻译边界，并清空 HP0/P1 + HP1/P2 partial。`
  2. `HP4 首次消费 ended_reason 前冻结允许值集合与消费者语义。`
  3. `HP9 继续完成剩余 clients/api-docs 包的系统性收口；但 session/usage/error/catalog 这四份当前已不再存在本轮确认过的事实错误。`
