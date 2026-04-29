# Nano-Agent Action-Plan 文档审查 — real-to-hero RH0–RH6

> 审查对象: `docs/action-plan/real-to-hero/RH{0..6}-*.md`（7 份执行计划）
> 审查类型: `docs-review`
> 审查时间: `2026-04-29`
> 审查人: `GLM`
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
> - `docs/design/real-to-hero/RHX-qna.md`
> - 6-worker 代码库实际状态（workers/ + packages/）
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：7 份 action-plan 主体结构合理、Phase 递进清晰、与 charter / design 的对齐度高；但存在多处行号引用与代码现状不符、若干功能断点描述不够精确、个别 scope 边界需要收紧。
- **结论等级**：`approve-with-followups`
- **是否允许关闭本轮 review**：`no` — 需要修正事实性错误后重新确认
- **本轮最关键的 3 个判断**：
  1. RH1–RH6 普遍引用了不存在的函数名或行号（如 `forwardServerFrameToClient`、`user-do.ts:1196-1212`、`nano-session-do.ts:1723-2078`），需与代码现状校准
  2. RH0 的 P0-B 测试文件名/数量与 charter §7.1 交付物存在数量矛盾（5 vs ≥7），且测试目录路径 `workers/orchestrator-core/test/` 下的文件名需与 charter 对齐
  3. RH2/RH5 对 `nacp-session` 和 `canonical.ts` 的"已存在"断言部分与代码现实不符（`ImageUrlContentPart` 未确认存在；`SessionStartBodySchema` 无 `model_id`/`reasoning`）

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-real-to-hero.md` r2 全文（含 §7.1–§7.7 Phase 细节、§4 In-Scope/Out-of-Scope、§9.2 测试纪律）
  - `docs/design/real-to-hero/RHX-qna.md`（Q1–Q5 业主决策）
  - 7 份 `docs/design/real-to-hero/RH{0..6}-*.md`（逐篇核对 design 与 action-plan 的一致性）
- **核查实现**：
  - `workers/agent-core/src/kernel/scheduler.ts`（68 行）— 无 `hook_emit` 决策路径
  - `workers/agent-core/src/kernel/types.ts`（173 行）— `StepKindSchema` 含 `"hook_emit"`
  - `workers/agent-core/src/host/runtime-mainline.ts`（345 行）— `hook.emit` 为 no-op
  - `workers/agent-core/src/host/do/nano-session-do.ts`（2,078 行）— 巨石未拆
  - `workers/orchestrator-core/src/user-do.ts`（2,285 行）— 巨石未拆
  - `workers/orchestrator-core/src/index.ts`（884 行）— 无 `/models`、`/sessions/{id}/context` 路由
  - `workers/orchestrator-core/src/auth.ts`（184 行）— 纯 JWT 鉴权，无 device_uuid / API key
  - `workers/agent-core/src/llm/gateway.ts`（263 行）— 仅 2 模型，无 `supportsReasoning`
  - `workers/agent-core/src/llm/canonical.ts`（128 行）— 无 `reasoning` 字段
  - `workers/agent-core/src/llm/registry/models.ts`（59 行）— 无 `supportsReasoning`/`reasoningEfforts`
  - `workers/agent-core/src/llm/request-builder.ts`（102 行）— 无 reasoning 校验
  - `workers/orchestrator-auth/src/service.ts`（415 行）— `verifyApiKey` 为 stub
  - `packages/orchestrator-auth-contract/src/index.ts`（285 行）— 无 `device_uuid`/`team_slug`
  - `packages/nacp-session/src/messages.ts`（256 行）— 无 `model_id`/`reasoning`
  - `workers/filesystem-core/src/index.ts`（93 行）— `library_worker:true`；fetch 返回 401
  - `workers/filesystem-core/src/artifacts.ts`（60 行）— 仅 `InMemoryArtifactStore`
  - 全部 6 份 `wrangler.jsonc` — 无 KV/R2 binding；agent-core 的 `CONTEXT_CORE`/`FILESYSTEM_CORE` 注释掉
- **执行过的验证**：
  - `wc -l nano-session-do.ts` → 2078 行（与 charter §1.2 声称 2078 行一致）
  - `wc -l user-do.ts` → 2285 行（与 charter §1.2 声称 2285 行一致）
  - `grep -c "forwardServerFrameToClient" user-do.ts` → 0（不存在）
  - `grep "hook_emit" scheduler.ts` → 0 匹配（scheduler 不产生该决策）
  - `grep "hook_emit" types.ts` → StepKindSchema 含 `"hook_emit"`（类型系统允许）
  - `ls workers/orchestrator-core/migrations/` → 仅 001–007（无 008+）
  - `ls workers/agent-core/src/host/do/` → 仅 `nano-session-do.ts`（verify/persistence 未拆出）
  - `ls tests/cross-worker/` → 不存在（实际路径为 `test/cross-e2e/`）
  - `grep "madge" package.json` → 无（CI 中无 cycle 检测）
- **复用 / 对照的既有审查**：
  - 无前序 action-plan review — 这是 first-pass

### 1.1 已确认的正面事实

- RH0 的 7 个 Phase 结构清晰，P0-F owner checklist 在 charter §7.1 有强对应，P0-A/B/C/D/E/G 覆盖了 charter 列出的全部 ZX5 残余
- RH1 对 Lane F 4 链断点的识别准确：scheduler 不产 `hook_emit`（代码确认）、`hook.emit` no-op（代码确认）、`emitPermissionRequestAndAwait` 零调用方（代码确认）、`onUsageCommit` 仅 console.log（代码确认）
- RH2 正确识别了 `/models` 和 `/sessions/{id}/context` 的缺失（代码确认 index.ts 无这些路由）
- RH3 正确识别了 `verifyApiKey` 为 stub（代码确认）、`nano_teams` 无 `team_name`/`team_slug`、`nano_user_devices` device_uuid 需要全链路
- RH4 正确识别了 filesystem-core 现状：`InMemoryArtifactStore`（代码确认）、`library_worker:true`（代码确认）、`CONTEXT_CORE`/`FILESYSTEM_CORE` binding 被注释掉（代码确认）
- RH5 正确识别了 `ModelCapabilities` 缺 `supportsReasoning`（代码确认）、`CanonicalLLMRequest` 无 reasoning 字段（代码确认）、`llama-4-scout` 的 `supportsVision=false`（代码确认）
- RH6 对两个巨石的行数描述准确（2078 / 2285 行）
- Charter §8.4 migration 冻结编号（008/009/010/011）在所有 action-plan 中保持一致
- RHX-qna Q1–Q5 的冻结决策在各 action-plan 的"依赖的冻结设计决策"节中被正确引用

### 1.2 已确认的负面事实

- 所有 action-plan 中引用的行号（如 `runtime-mainline.ts:295-298`、`user-do.ts:1196-1212`、`nano-session-do.ts:797-829`、`nano-session-do.ts:494-501`）未经代码校验，可能已漂移
- `forwardServerFrameToClient` 在整个代码库中不存在（最接近的是 `user-do.ts` 的 `emitServerFrame` 和 `forwardFramesToAttachment`）
- RH0 P0-B 的 endpoint test 文件名与 charter §7.1 交付物列表不一致
- `tests/cross-worker/` 目录不存在，action-plan 中多处引用此路径；实际的跨 worker e2e 目录是 `test/cross-e2e/`
- `madge` 未在 root `package.json` 中列为依赖，RH6 P6-01 声称要接入 CI 但当前无基础
- Charter §7.1 P0-B 交付物列表含 7 份 test file（≥35 用例），但 RH0 action-plan 只列了 5 份（≥25 用例），少了 `permission-decision` 和 `policy-permission-mode`
- RH2 action-plan P2-09 提到 `user-do.ts:1905-1981` 为 `handleWsAttach`，但实际 `handleWsAttach` 在 1905 行附近需确认
- RH4 action-plan P4-07 引用 `nano-session-do.ts:353` 为 InMemoryArtifactStore 替换位置，但该行号需确认
- RH4 action-plan §4.4 P4-06 引用 `agent-core/wrangler.jsonc:43-50` 为 binding 位置，具体行号需确认

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 全面核查了 7 份 action-plan 引用的源文件路径与行号 |
| 本地命令 / 测试 | yes | 运行了 wc -l、grep、ls 等命令验证代码现状 |
| schema / contract 反向校验 | yes | 校验了 nacp-session、orchestrator-auth-contract、canonical 等包的 schema 定义 |
| live / deploy / preview 证据 | no | 未做 preview deploy 验证 |
| 与上游 design / QNA 对账 | yes | 逐份与 charter r2 和 RHX-qna Q1–Q5 对账 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | 行号引用普遍漂移，未与代码校准 | medium | docs-gap | no | 全部行号改为函数名/方法名引用，或标注"截至 ZX5 closure" |
| R2 | `forwardServerFrameToClient` 函数名不存在 | high | correctness | yes | 改为代码实际存在的 `emitServerFrame` + `forwardFramesToAttachment`，或明确定义新增函数 |
| R3 | P0-B 测试数量与 charter 矛盾（5 vs ≥7） | high | scope-drift | yes | 补齐 `permission-decision` 与 `policy-permission-mode` 两个 test file |
| R4 | 测试目录路径 `tests/cross-worker/` 不存在 | medium | correctness | no | 统一为 `test/cross-e2e/` 或明确定义新目录 |
| R5 | `handleUsage` 行号引用不精确 | low | docs-gap | no | 改为函数名引用 |
| R6 | RH0 P0-D 拆分行号 `nano-session-do.ts:1723-2078` 与 verify/persistence 方法定位可能漂移 | medium | docs-gap | no | 改为方法名引用而非行号范围 |
| R7 | RH2 P2-07 对 `/sessions/{id}/context/compact` 的 RPC seam 是否存在未确认 | medium | delivery-gap | no | action-plan 应显式标注 context-core inspector facade 的 RPC method 缺口 |
| R8 | RH3 `handleMeDevicesRevoke` 行号引用 `index.ts:725-814` 需校验 | low | docs-gap | no | 改为函数名引用 |
| R9 | RH4 P4-07 dual-track 代码位置 `nano-session-do.ts:353` 需校验 | low | docs-gap | no | 改为函数名/方法名引用 |
| R10 | RH5 P5-02 声称 `CanonicalContentPart.ImageUrlContentPart` "已存在不需改"但未代码确认 | medium | correctness | no | 需确认 `ImageUrlContentPart` 在 canonical.ts 中是否确实已定义 |
| R11 | RH6 P6-01 `madge` 接入 CI 需新增依赖和 CI workflow | low | delivery-gap | no | action-plan 应列出新增 devDep 和 CI config 的具体工作项 |
| R12 | RH2 Phase 4 客户端 adapter 升级（web/wechat）的工作量估算可能不足 | medium | delivery-gap | no | clients/web 和 clients/wechat-miniprogram 的现有代码量需评估 |
| R13 | RH1 至 RH3 缺 Service Binding 启用的显式 Phase 或工作项 | medium | delivery-gap | no | agent-core 的 agent-core→orchestrator-core binding 已存在，但 RH1 P1-06/07 需 user-do RPC 注册 |

---

### R1. 行号引用普遍漂移

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - RH0 引用 `nano-session-do.ts:1723-2078`（verify/persistence 拆分范围）
  - RH1 引用 `runtime-mainline.ts:295-298`（hook.emit no-op）、`scheduler.ts`（hook_emit 产生）、`nano-session-do.ts:797-829`（emitPermission/emitElicitation）、`nano-session-do.ts:494-501`（onUsageCommit）
  - RH2 引用 `user-do.ts:1196-1212`（emitServerFrame）、`user-do.ts:1905-1981`（handleWsAttach）
  - RH3 引用 `orchestrator-auth/src/service.ts:402-413`（verifyApiKey）、`orchestrator-core/src/user-do.ts:1215-1257`（handleUsage）、`index.ts:618-646`（conversations）、`index.ts:725-814`（devices revoke）
  - RH4 引用 `nano-session-do.ts:353`（InMemoryArtifactStore 替换位置）、`filesystem-core/src/index.ts:50-85`（fetch handler）、`orchestrator-core/src/user-do.ts:1651-1699`（files handler）
  - RH5 引用 `agent-core/src/llm/canonical.ts:67-77`、`registry/models.ts:8-22`、`request-builder.ts:56-92`、`adapters/workers-ai.ts:148-220`
  - 这些行号可能随 ZX5 implementer fix 及后续 PR 改变
- **为什么重要**：实施者按行号定位代码会出错，导致在错误位置操作
- **审查判断**：所有行号引用应改为函数名或方法名引用，或在 action-plan 头部标注"行号截至 ZX5 closure (2026-04-29)"并附带 commit hash
- **建议修法**：全局替换为 `scheduler.scheduleNextStep()`、`runtime-mainline.hook.emit`（no-op 方法）、`NanoSessionDO.emitPermissionRequestAndAwait` 等函数名引用

### R2. `forwardServerFrameToClient` 函数名不存在

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - RH1 P1-06/P1-07 提出 `user-do.ts` 新增 `forwardServerFrameToClient` RPC
  - 代码库中 user-do.ts 实际有 `emitServerFrame`（单 frame 推送）和 `forwardFramesToAttachment`（frame 数组推送到 attached WS）
  - 不存在名为 `forwardServerFrameToClient` 的函数
  - RH1 声称这是"全新实装"，但命名与代码现有模式不一致
- **为什么重要**：这是 RH1 跨 worker WS push 的核心通道，命名混淆会导致实施者在错误位置适配
- **审查判断**：action-plan 应明确这是新增函数（RH1 design §5.1 也用了此名），并说明其与现有 `emitServerFrame` 的关系——是替换、包装还是并行。如果设计意图是 agent-core 通过 service binding 调 orchestrator-core 的 user DO，而 user DO 内部复用 `emitServerFrame` 投递到 attached client，则函数内部实现应注明调用现有 `emitServerFrame`。
- **建议修法**：RH1 action-plan §4.3 P1-06 应注明 `forwardServerFrameToClient` 为新增 RPC method，内部委托给现有 `emitServerFrame`；或考虑直接使用 `emitServerFrame` 加 session_uuid 参数作为 RPC interface

### R3. P0-B 测试数量与 charter 矛盾

- **严重级别**：`high`
- **类型**：`scope-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - Charter §7.1 P0-B 交付物明确列出 7 份 endpoint test file：`messages, files, me-conversations, me-devices, permission-decision, elicitation-answer, policy-permission-mode`，≥7 文件 ≥35 用例
  - RH0 action-plan §1.2/§2.1/§4.4 只列了 5 份 test file：`messages, files, me-conversations, me-devices, me-devices-revoke`，≥25 用例
  - RH0 缺少 `permission-decision` 和 `policy-permission-mode`（或 `elicitation-answer`）的直达测试
  - Charter §9.2 要求"每个新增 public endpoint ≥ 5 用例"，而 `permission/decision` 和 `policy/permission_mode` 是独立的 session 子路径端点
- **为什么重要**：charter 是权威性文档，action-plan 少于 charter 要求的交会物范围属于 scope 漂移
- **审查判断**：RH0 action-plan 的 P0-B 必须补齐 charter 要求的 7 份测试文件
- **建议修法**：在 P0-B 工作表中增加 P0-B6（permission-decision endpoint test）和 P0-B7（policy-permission-mode 或 elicitation-answer endpoint test），目标 ≥7 文件 ≥35 用例

### R4. 测试目录路径不存在

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - RH1/3/4/5 等多处引用 `tests/cross-worker/` 作为 e2e test 路径
  - 实际代码库中跨 worker e2e 测试目录为 `test/cross-e2e/`
  - `tests/cross-worker/` 目录不存在
- **建议修法**：统一使用 `test/cross-e2e/` 或在 action-plan 中明确定义新目录路径与现有目录的关系

### R5. RH1 `handleUsage` 行号引用

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：RH1 P1-09 引用 `user-do.ts:1215-1257` 为 handleUsage 位置。代码中 `handleUsage` 函数确实存在，但行号需确认。
- **建议修法**：改为 `UserDO.handleUsage` 方法名引用

### R6. RH0 P0-D 拆分行号与方法的对应

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - RH0 P0-D1 声称拆出 `nano-session-do.ts:1723-2078` 的 5 个 verify 方法
  - 实际代码中 `emitPermissionRequestAndAwait` 在 797-815 行，`emitElicitationRequestAndAwait` 在 817-829 行，这与 1723-2078 不对应
  - 1723 行以后的内容可能是其他方法（如 DO lifecycle 等）
- **建议修法**：改为方法名引用（`emitPermissionRequestAndAwait`、`emitElicitationRequestAndAwait` 等），而非行号范围

### R7. RH2 context-core inspector facade RPC seam 缺口未显式标注

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - RH2 P2-05/06/07 声称 `/sessions/{id}/context` 等端点会"调用 context-core inspector facade（已有 RPC seam）"
  - 代码中 `context-core/src/inspector-facade/index.ts`（371 行）确实存在
  - 但 `orchestrator-core/src/user-do.ts` 中无直接的 context-core RPC call 做 context 查询
  - `orchestrator-core` 的 `CONTEXT_CORE` service binding 虽已声明（在 wrangler.jsonc 中未注释），但 context snapshot/compact 需要新的 RPC method path
- **建议修法**：RH2 action-plan 应在 Phase 3 工作项中显式列出需要新增的 context-core RPC method（如 `getContextSnapshot`、`triggerCompact`），而不是假设已存在

### R8–R12. 其他行号与命名问题

（低/中严重级别的行号/命名问题在 R1 中已原则性覆盖，此处不逐一展开）

### R13. RH1–RH3 Service Binding 启用的隐含依赖

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - RH1 P1-06/07 需要 agent-core 通过 USER_DO service binding 调 orchestrator-core 的 user DO 的 RPC
  - 当前 `agent-core/wrangler.jsonc` 中 `USER_DO` service binding 不存在——只有 `BASH_CORE` 是活跃的，`CONTEXT_CORE`/`FILESYSTEM_CORE` 被注释
  - orchestrator-core 有 `AGENT_CORE` service binding 指向 agent-core
  - RH1 的 `forwardServerFrameToClient` 需要反向路径：agent-core → orchestrator-core user DO
  - 但 RH1 action-plan 只在 §5.3 P1-07 提到"binding 启用"，未将其作为独立工作项
  - RH0 P0-C 只在 6 个 worker 的 `wrangler.jsonc` 中占位 KV/R2 binding，不涉及 service binding 新增
- **建议修法**：RH1 应在 P1-06 或独立工作项中显式列出 `agent-core/wrangler.jsonc` 新增 `USER_DO` service binding 的配置步骤

---

## 3. In-Scope 逐项对齐审核

> 逐项核对每份 action-plan 的 In-Scope 列表与 design doc / charter 的一致性。

### RH0

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S1 | pnpm-lock.yaml 重建 + jwt-shared importer | `done` | 与 charter §7.1 P0-A 一致 |
| S2 | jwt-shared 独立 build/typecheck/test | `done` | 与 charter §7.1 P0-A 一致 |
| S3 | 6 worker KV/R2 binding 占位 | `done` | 与 charter §7.1 P0-C 一致；但当前 0 个 wrangler 有 KV/R2 binding（待实施） |
| S4 | 5 份 endpoint test | `partial` | charter 要求 ≥7 份（见 R3），action-plan 只列 5 份 |
| S5 | NanoSessionDO 拆 verify/persistence | `done` | 与 charter §7.1 P0-D 一致；但行号引用需修正（见 R6） |
| S6 | bootstrap-hardening 3 case | `done` | 与 charter §7.1 P0-G 一致 |
| S7 | preview deploy + manual smoke | `done` | 与 charter §7.1 P0-E 一致 |
| S8 | P0-F 8 步 checklist | `done` | 与 charter §7.1 P0-F 一致；8 步已包含 charter 原始 6 步 + 扩展的 2 步 |

### RH1

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S1 | scheduler 产生 hook_emit | `done` | 与 design RH1 §8.4 一致；但需注意 scheduler 当前不产生此决策（需新增路径） |
| S2 | runtime-mainline.hook.emit 调 dispatcher | `done` | 与 design 一致；当前确为 no-op |
| S3 | emitPermission/emitElicitation 真 emit WS frame | `done` | 与 design 一致 |
| S4 | runtime hook 调 emitPermission | `done` | design §6.3 首个调用方 |
| S5 | forwardServerFrameToClient RPC | `partial` | 函数名与代码不匹配（见 R2）；需明确与现有 `emitServerFrame` 的关系 |
| S6 | onUsageCommit 经 RPC 推 usage frame | `done` | 与 design 一致 |
| S7 | handleUsage no-null | `done` | 与 charter §7.2 P1-E 一致 |
| S8 | 4 条 live path evidence | `done` | 与 charter 收口标准一致 |

### RH2

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S1 | heartbeat/terminal/superseded schema | `done` | nacp-session 已有 `session.heartbeat` 等消息类型定义 |
| S2 | migration 008 + /models | `done` | 与 charter §7.3 一致；当前不存在 migration 008 |
| S3 | /sessions/{id}/context + snapshot/compact | `partial` | charter 要求，但 context-core inspector facade 的 RPC method 需显式列出新增性（见 R7） |
| S4 | emitServerFrame 走 validateSessionFrame | `done` | 与 design 一致 |
| S5 | client→server 4 类消息 ingress | `done` | nacp-session/messages.ts 中已有 schema 定义 |
| S6 | heartbeat lifecycle 4 scenario | `done` | 与 charter §4 item 4 一致 |
| S7 | tool semantic chunk + tool.call.result | `done` | 与 design RH2-llm-delta-policy 一致 |
| S8 | web + wechat adapter 升级 | `done` | 但工作量评估需审视（见 R12） |
| S9 | LLM delta policy doc | `done` | 与 charter §4 item 2 一致 |

### RH3

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S1 | migration 009 三表变更 | `done` | 与 charter §7.4 一致 |
| S2 | auth-contract 升版 | `done` | 当前 contract 无 `device_uuid`/`team_slug`，需新增 |
| S3 | login/register mint device_uuid | `done` | 与 charter 一致 |
| S4 | refresh rotation bind device | `done` | 与 charter 一致 |
| S5 | authenticateRequest device gate | `done` | 与 charter §7.4 一致；当前 auth.ts 无 device_uuid |
| S6 | WS attach 校验 device_uuid + force-disconnect | `done` | 与 charter 一致；需复用 RH1 的 WS push 通道 |
| S7 | verifyApiKey + authenticateRequest 双轨 | `done` | 当前 verifyApiKey 确实是 stub（`supported: false`） |
| S8 | team display + /me/team + /me/teams | `done` | 与 charter 一致 |
| S9 | /me/conversations 双源 + cursor | `done` | 与 charter §4 item 14 一致 |

### RH4

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S1 | migration 010 | `done` | 当前最高 migration = 007 |
| S2 | R2ArtifactStore | `done` | 当前仅 `InMemoryArtifactStore`，storage/adapters 已有 r2/d1/kv adapter |
| S3 | filesystem-core fetch 收口 | `done` | 当前确实返回 `bindingScopeForbidden` |
| S4 | filesystem-core RPC ops 真实化 | `done` | 当前 filesystemOps 返回 op name list |
| S5 | agent-core binding 启用 | `done` | 当前确实被注释掉 |
| S6 | RPC-first dual-track | `done` | 与 RHX-qna Q2 一致 |
| S7 | POST /sessions/{id}/files multipart | `done` | 当前 files handler 存在但仅返回 D1 metadata |
| S8 | list handler | `done` | 与 design 一致 |
| S9 | download handler | `done` | 与 design 一致 |
| S10 | R2 key namespace | `done` | 与 design §5.1 一致 |
| S11 | Lane E sunset | `done` | 与 RHX-qna Q2 4 项限定一致 |

### RH5

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S1 | nacp-session schema 加 model_id + reasoning | `done` | 当前确实不存在这些字段 |
| S2 | CanonicalLLMRequest.reasoning | `done` | 当前确实无此字段 |
| S3 | ModelCapabilities.supportsReasoning | `done` | 当前确实无此字段；CapabilityName 无 "reasoning" |
| S4 | migration 011 seed | `done` | 与 charter §7.6 一致 |
| S5 | gateway 从 D1 读 seed | `done` | 与 design 一致 |
| S6 | request-builder reasoning validation | `done` | 当前的 4 项 capability check 无 reasoning |
| S7 | workers-ai adapter reasoning 翻译 | `done` | 当前 workers-ai.ts 无 reasoning 参数 |
| S8 | llama-4-scout supportsVision=true | `done` | 当前确实为 false |
| S9 | /messages ingress 接 image_url | `done` | 当前 kind 数组为 `['text', 'artifact_ref']` |
| S10 | team policy filter | `done` | 与 design 一致 |
| S11 | usage event 扩字段 | `done` | 与 RHX-qna Q3 一致 |

### RH6

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S1 | madge 接入 CI | `done` | 当前无 madge 依赖 |
| S2 | NanoSessionDO 拆 7 子模块 | `done` | 当前巨石 2078 行，verify/persistence 尚未拆出 |
| S3 | user-do.ts 拆 | `done` | 当前巨石 2285 行 |
| S4 | three-layer-truth.md | `done` | 与 charter D6 一致 |
| S5 | residue cleanup | `done` | 与 charter §4 item 3 一致 |
| S6 | 5 套 evidence pack | `done` | 与 RHX-qna Q4 一致 |
| S7 | final closure | `done` | 与 charter §10 一致 |

### 3.1 对齐结论

- **done**: 38
- **partial**: 3
- **missing**: 0
- **stale**: 0
- **out-of-scope-by-design**: 0

3 项 partial 为：RH0 测试数量不足（S4）、RH1 RPC 函数名不匹配（S5）、RH2 context-core RPC 需显式列出（S3）。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | token-level streaming | `遵守` | RH2 design §5.2 明确 out-of-scope；RH1/2 action-plan 遵守 |
| O2 | admin plane / billing | `遵守` | RH3 action-plan 仅做 verify-only + internal RPC；RH5 不做 per-model quota |
| O3 | 第二 LLM provider | `遵守` | deepseek adapter 为 stub（代码确认），RH5 不启用 |
| O4 | SQLite-DO | `遵守` | RH0 只做 verify/persistence 预拆分；RH6 完整拆分在 DO 内不引入 SQLite |
| O5 | 3-step presigned upload | `遵守` | RH4 action-plan 明确 out-of-scope |
| O6 | user-supplied slug | `遵守` | RHX-qna Q1 冻结为自动生成 |
| O7 | per-model quota | `遵守` | RHX-qna Q3 冻结为不引入，仅记录 evidence |
| O8 | new worker | `遵守` | 所有 7 份 action-plan 在 6 worker 内消化 |
| O9 | NACP error envelope | `遵守` | 所有 action-plan 未引入协议层重构 |
| O10 | filesystem-core public ingress | `遵守` | RH4 保持 leaf（index.ts 仅有 /health） |

---

## 5. 逐 Phase 审查详细发现

### 5.1 RH0 审查

**与 charter 对齐**：7 个 Phase 结构与 charter §7.1 要求高度匹配。P0-F 8 步 checklist 正确采纳了 RHX-qna Q5 的扩展。

**问题**：
1. **P0-B 测试文件少 2 份**（R3）：charter §7.1 交付物列表含 `permission-decision`、`policy-permission-mode`（或 `elicitation-answer`），但 action-plan 只列了 `messages, files, me-conversations, me-devices, me-devices-revoke`。建议补齐。
2. **P0-B 测试路径**：action-plan 写 `workers/orchestrator-core/test/{5 new}.endpoint.test.ts`，但 charter §7.1 交付物列的文件名格式为 `{name}-route.test.ts`。需统一命名约定。
3. **P0-D 拆分范围**：action-plan §4.5 提到主文件 `≤~1600`，但 charter §7.1 要求 `≤1500`。且行号 `1723-2078` 与实际 `emitPermissionRequestAndAwait` (797-815) 和 `emitElicitationRequestAndAwait` (817-829) 不对应。R6 已详述。
4. **P0-G 测试文件位置**：action-plan 写 `workers/orchestrator-core/test/bootstrap-hardening.test.ts`，但 charter §7.1 交付物写 `workers/orchestrator-auth/test/bootstrap-hardening.test.ts`。两者不一致——bootstrap hardening 涉及 register/login/refresh，应在 orchestrator-auth 还是 orchestrator-core？charter 写 auth，action-plan 写 core。需统一。

### 5.2 RH1 审查

**与 charter 对齐**：5 个 Phase 结构与 charter §7.2 对应良好。Lane F 4 链断点识别精确。

**问题**：
1. **forwardServerFrameToClient 命名**（R2）：此名在代码中不存在。最接近的是 `emitServerFrame`（单 frame push）和 `forwardFramesToAttachment`（批量 replay）。action-plan 应明确这是新增 RPC method，且内部委托给 `emitServerFrame`。
2. **agent-core → user DO service binding**：RH1 需要 agent-core 通过 service binding 调 orchestrator-core 的 user DO，但 `agent-core/wrangler.jsonc` 中无 `USER_DO` binding。RH0 只占位 KV/R2，未涉及 service binding 新增。RH1 应在 P1-06/07 中显式包含 `agent-core/wrangler.jsonc` 新增 `USER_DO` binding 的配置。
3. **P0-G 测试位置不一致**：与 RH0 同理，需确认 bootstrap hardening 测试放在哪个 worker。
4. **P1-01 scheduler hook_emit**：scheduler 当前 68 行，确实不产生 `hook_emit` 决策。但 action-plan 应说明是在 `scheduleNextStep()` 中新增一种信号路由还是重构决策优先级链。

### 5.3 RH2 审查

**与 charter 对齐**：7 个 Phase 结构与 charter §7.3 对应。LLM delta policy out-of-scope 正确遵守。

**问题**：
1. **context-core inspector facade RPC method 缺口**（R7）：action-plan P2-05/06/07 假设"已有 RPC seam"，但 `orchestrator-core` → `context-core` 的 context snapshot/compact 请求路径需要新增 RPC method（当前 context-core 的 RPC 只有 `probe`、`nacpVersion`、`filesystemOps` 等基本方法）。建议在 Phase 3 中显式列出 `getContextSnapshot` 和 `triggerCompact` 新增 RPC。
2. **P2-01 heartbeat/terminal/superseded schema**：`nacp-session/src/messages.ts` 中 `session.heartbeat` 等消息类型已在 `typeDirectionMatrix` 中注册（L241-256 有 `session.heartbeat` 等 kind），但对应的 body schema 是否已在 `messages.ts` 中定义为独立 Zod schema 需确认。action-plan 应注明"注册或新增"而非仅"注册"。
3. **clients/web 和 clients/wechat-miniprogram 适配工作量**：RH2 Phase 6 要求 web + wechat adapter 升级到 full frame。当前 `clients/web/` 是完整的 React 应用，`clients/wechat-miniprogram/` 是微信小程序。这可能比计划估计的工作量大得多。

### 5.4 RH3 审查

**与 charter 对齐**：8 个 Phase 结构与 charter §7.4 对应。device auth gate 是 charter 声明的 blocker。

**问题**：
1. **authenticateRequest 在 orchestrator-core/src/auth.ts**：action-plan §4.4 引用 `orchestrator-core/src/auth.ts` 是正确的（184 行），但该文件当前的 `authenticateRequest` 只有 JWT 验证。新增 device gate 和 API key 双轨需要大幅改造。
2. **verifyApiKey stub 位置**：action-plan 引用 `orchestrator-auth/src/service.ts:402-414`，代码中 verifyApiKey 确实在 service.ts 但行号需确认。当前返回 `{supported: false}`。
3. **`/me/team` 路由不存在**：当前 `index.ts` 无 `/me/team` PATCH 或 GET 路由。需新增。
4. **`/me/teams` 路由不存在**：同上。当前只有 `/me/sessions` 和 `/me/conversations`。
5. **nano_auth_sessions 表的 device_uuid 字段**：需在 migration 009 中新增。当前 007 是 user-devices migration，但 auth_sessions 中无 device_uuid 列。
6. **Phase 3 与 Phase 4 的依赖关系**：action-plan 将 device_uuid mint（Phase 3）和 device gate（Phase 4）分开，但 charter 要求"login/register mint device_uuid + verifyAccessToken D1 lookup + WS attach 拒绝"一体化。建议确认拆分是否会导致 mint 出 device_uuid 但 gate 还未实装时的中间态风险。

### 5.5 RH4 审查

**与 charter 对齐**：8 个 Phase 与 charter §7.5 对应。Lane E dual-track sunset ≤ 2 周与 RHX-qna Q2 一致。

**问题**：
1. **storage/adapters 已建成**：代码确认 `r2-adapter.ts`（214 行）、`d1-adapter.ts`（132 行）、`kv-adapter.ts`（138 行）、`do-storage-adapter.ts`（210 行）已存在。RH4 action-plan 正确识别了这一点（"已是 484 行生产级实现"）。但 `artifacts.ts` 当前仅 60 行的 `InMemoryArtifactStore` + 接口定义，R2ArtifactStore 需新组装。
2. **P4-04 filesystem-core fetch 收口**：action-plan 声称改 `bindingScopeForbidden()` → 200 health response。但当前代码中 401 路径确实调用了 `bindingScopeForbidden()`。需确认改为 200 health 不会影响其他 worker 的健康检查逻辑。
3. **R2 key namespace**：`tenants/{teamUuid}/sessions/{sessionUuid}/files/{fileUuid}` 格式正确，但需确认 `tenants/` 前缀是否与 charter 或 design 中其他 key namespace 规范一致。

### 5.6 RH5 审查

**与 charter 对齐**：7 个 Phase 与 charter §7.6 对应。不引入 per-model quota 与 RHX-qna Q3 一致。

**问题**：
1. **P5-02 声称 `CanonicalContentPart.ImageUrlContentPart` 已存在不需改**：但 `canonical.ts` 在 128 行中未显式定义 `ImageUrlContentPart`。需代码确认是否存在此类型（可能在 `request-builder.ts` 中的 capability check 里引用了它）。如果不存在，P5-02 需从"update"改为"add"。
2. **DeepSeek adapter 是 stub**：`adapters/deepseek/index.ts` 仅 11 行抛出 "not implemented"。RH5 action-plan 正确将其列为 out-of-scope（O1），但 RH2/RH5 的模型列表提到 `kimi-k2.6` 和 `gpt-oss-120b`，这些模型可能需要确认 Workers AI binding 是否支持。
3. **P5-05 gateway 从 D1 读 seed**：当前 `gateway.ts` 中 `WORKERS_AI_REGISTRY` 是硬编码的。RH5 要求启动时从 D1 读 `nano_models` 并注入 runtime registry，但 migration 011 才建表。需确认 bootstrap 顺序（D1 query 在 DO alarm 启动时可用？或在 first request 时 lazy load？）。

### 5.7 RH6 审查

**与 charter 对齐**：7 个 Phase 与 charter §7.7 对应。不引入新功能、不引入 SQLite-DO 与 charter D1/D2 一致。

**问题**：
1. **NanoSessionDO 拆分风险**：ws 模块是最高风险（P6-06 标为 high），涉及 RH1 的 `forwardServerFrameToClient`（实际为 `emitServerFrame`）+ RH2 的 NACP frame upgrade。拆分后需要确保 import 无 cycle。
2. **user-do.ts 拆分**：13 个 handler 文件（P6-09）的拆分粒度合理，但 handler 间共享 helper 容易形成 cycle。action-plan 建议的"统一通过 façade 调度"是正确方向。
3. **madge 未安装**：P6-01 要求接入 CI，但 root `package.json` 无 madge devDep。需在 Phase 1 显式添加 `pnpm add -D madge` 步骤。
4. **three-layer-truth 文档**：P6-12 要求"与代码 file:line 回绑"，但代码在 RH6 拆分后行号会大幅变动。建议在拆分完成（Phase 2-3）之后、文档写作（Phase 4）之前有一个行号稳定窗口。
5. **evidence pack 设备**：RHX-qna Q4 冻结了 5 套（iOS Safari/Android Chrome/WeChat 真机/WeChat devtool/Chrome），action-plan 正确反映。

---

## 6. 跨 Phase 依赖与逻辑完整性

### 6.1 Phase 依赖链验证

| 依赖 | 验证结论 |
|------|----------|
| RH0 → RH1（endpoint baseline + binding 占位）| ✅ RH0 P0-B 提供 test baseline，P0-C 提供 binding 占位。 |
| RH0 → RH1（lockfile + jwt-shared）| ✅ RH0 P0-A 是 RH1 的前提。 |
| RH1 → RH2（WS push 通道）| ✅ RH1 P1-D/P1-06 建立 forwardServerFrame RPC，RH2 P2-11 heartbeat 依赖此通道。 |
| RH1 → RH3（WS push + force-disconnect）| ✅ RH3 P3-06/P3-07 device revoke force-disconnect 复用 RH1 P1-D 的 WS push 机制。 |
| RH2 → RH4（/models 端点）| ⚠ RH4 不直接依赖 RH2，但 image upload（RH4）与 model picker（RH2）在 client 侧有逻辑关联。设计文件中明确 RH2 是 RH4 的上游。 |
| RH2 → RH5（/models）| ✅ RH5 P5-05 依赖 RH2 P2-04 建立的 /models 端点。 |
| RH3 → RH4（auth gate + tenant namespace）| ✅ RH4 的 R2 key namespace 需要 team_uuid 全链路稳定。 |
| RH4 → RH5（image upload）| ✅ RH5 image_url e2e 依赖 RH4 R2 upload pipeline。 |
| RH1-RH5 → RH6（拆分前提）| ✅ 所有功能 change 在 RH6 之前落地。 |

### 6.2 Migration 编号连续性

| 编号 | Phase | 表 | 一致性 |
|------|-------|-----|--------|
| 008 | RH2 | nano_models | ✅ 与 charter §8.4 一致 |
| 009 | RH3 | team_display + api_keys + device_uuid | ✅ 与 charter §8.4 一致 |
| 010 | RH4 | session_files | ✅ 与 charter §8.4 一致 |
| 011 | RH5 | model_capabilities_seed | ✅ 与 charter §8.4 一致 |

### 6.3 逻辑断点

1. **RH0 P0-C 只占位 KV/R2 binding，不涉及 service binding**：但 RH1 需要 agent-core → orchestrator-core 的 USER_DO service binding，RH4 需要 agent-core → filesystem-core / context-core 的 CONTEXT_CORE/FILESYSTEM_CORE binding。这些 service binding 的新增不在 RH0 scope 中，需在各自 Phase 显式列出。
2. **RH2 P2-05 context inspection 需要 context-core 新增 RPC method**：当前 context-core 的 inspector facade 是 library 层面的，orchestrator-core 调 context-core 需要 service binding（已在 orchestrator-core wrangler.jsonc 中声明 `CONTEXT_CORE`），但 context-core 的 RPC surface 需要匹配新增的 snapshot/compact 操作。
3. **RH3 migration 009 中 nano_teams.team_slug 的 NOT NULL DEFAULT '' + data fill**：action-plan 正确识别了这一点。但需确认 data fill 的 slug 生成逻辑在 SQL migration 内还是需要 JS 脚本。

---

## 7. 最终 verdict 与收口意见

- **最终 verdict**：`action-plan 整体结构与 charter/design 对齐度高，Phase 递进合理，但存在 2 项 blocker（R2 forwardServerFrameToClient 命名不匹配、R3 P0-B 测试数量与 charter 矛盾）和多处行号/命名漂移需修正`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. RH1 P1-06/P1-07 修正 `forwardServerFrameToClient` 的命名和与代码现有 API 的关系（是新增 RPC method 还是在现有 `emitServerFrame` 上扩展）
  2. RH0 P0-B 补齐 charter 要求的 7 份 endpoint test file（当前缺少 `permission-decision` 和 `policy-permission-mode`/`elicitation-answer`）
- **可以后续跟进的 non-blocking follow-up**：
  1. 全部行号引用改为函数名/方法名引用
  2. 测试目录路径统一为 `test/cross-e2e/`
  3. RH2 Phase 3 显式列出 context-core 新增 RPC method
  4. RH1 显式列出 `agent-core/wrangler.jsonc` 新增 `USER_DO` service binding 配置步骤
  5. RH5 P5-02 确认 `ImageUrlContentPart` 是否真的已在代码中定义
  6. RH6 P6-01 显式列出 madge devDep 和 CI config 安装步骤
  7. RH0 P0-G 测试文件位置与 charter 对齐（auth vs core）
  8. RH1 P1-01 说明 scheduler 新增 `hook_emit` 决策的实现策略
  9. RH2 Phase 6 评估 clients/web 和 clients/wechat-miniprogram 的适配工作量
  10. RH3 Phase 3-4 的中间态风险分析（mint 出 device_uuid 但 gate 还未生效）
- **建议的二次审查方式**：`independent reviewer` — 修正 blocker 后应由独立 reviewer 确认修正内容
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

---

## 8. 审查质量评估（appended by Opus 4.7, 2026-04-29）

### 8.0 评价结论

- **一句话评价**：4 份 action-plan review 中"覆盖面最广（13 finding，全部 valid）+ 独家 high-value 发现最多（R7 context-core inspector RPC 缺口、R12 客户端 adapter 工作量、R2 forwardServerFrameToClient 命名澄清）"的一份；0 false-positive；但 13 条中有 5 条偏向行号微调，整体 ROI 略稀释。
- **综合评分**：`9.2 / 10`
- **推荐使用场景**：cross-worker RPC 拓扑澄清、客户端 adapter 工作量评估、命名一致性审查（forwardServerFrameToClient vs emitServerFrame vs forwardFramesToAttachment）。
- **不建议单独依赖的场景**：13 条混合优先级在大型 PR 中筛选成本较高；charter hard-gate（≤1500 / orchestrator-auth path / ≥7 测试）由 GPT 补强 verdict 严肃度。

### 8.1 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | 命名一致性 + 客户端工作量 + cross-worker 拓扑 | R2（命名澄清）、R7（context-core RPC）、R12（client adapter）、R13（service binding 启用） |
| 证据类型 | grep / wc -l / 文件存在性 + 命名匹配 | "grep -c forwardServerFrameToClient = 0；最接近的是 emitServerFrame 与 forwardFramesToAttachment" |
| Verdict 倾向 | balanced（approve-with-followups + 2 yes blocker）| R2/R3 标 yes blocker；其他 11 均 non-blocker |
| Finding 粒度 | fine | 13 finding 中 5 条偏行号微调（R1/R5/R6/R8/R9）|
| 修法建议风格 | actionable + 命名细化 | R2 给"forwardServerFrameToClient 是新增 RPC method，内部委托现有 emitServerFrame"清晰路径 |

### 8.2 优点与短板

#### 8.2.1 优点

1. **R7 是 4 份 review 中除 GPT R4 外最高价值的独家 finding**：context-core inspector facade RPC 缺口（getContextSnapshot / triggerContextSnapshot / triggerCompact 当前不存在）—— GPT/deepseek/kimi 全部漏；本 finding 让 RH2 §4.3 P2-05/06/07 重写为"先在 context-core 新增 3 个 RPC method"，避免 RH2 实施时才发现 RPC 不可达。
2. **R2 命名澄清细致到提议复用方向**："forwardServerFrameToClient 是新增 RPC method 内部委托现有 emitServerFrame"—— 比单纯说"不存在"更可执行；本 finding 让 RH1 §4.3 P1-06b 实施步骤明确"内部委托 User DO emitServerFrame，不重复实现 WS push"。
3. **R12 客户端 adapter 工作量评估**：4 份 review 独家；指出 clients/web 是完整 React 应用、clients/wechat-miniprogram 是微信小程序，工作量可能从 S 膨胀到 M-L；本 finding 让 RH2 §4.6 P2-14/P2-15 加 audit 步骤。
4. **R13 service binding 启用 phase 缺失**：与 GPT R4 / deepseek R4 形成 cross-cutting 共识；GLM 独立指出 "RH0 P0-C 只占位 KV/R2，不涉及 service binding 新增"，是 RH1 拓扑修复的辅助证据。
5. **owner QNA 处理正确**：未把 QNA 业主未答当 blocker；遵守用户审查指令。

#### 8.2.2 短板 / 盲区

1. **5 条行号微调（R1/R5/R6/R8/R9）单独成 finding**：deepseek R5 用单条 "行号有效期声明" 覆盖整片；GLM 拆 5 条增加 reviewer / implementer 筛选成本。
2. **未抓 charter hard-gate 漂移**：GPT R1（≥7 测试）/ R2（orchestrator-auth path）/ R3（≤1500）—— GLM R3 抓到了 7 vs 5 但未抓 path 与行数；与 deepseek 类似的盲区。
3. **R10 ImageUrlContentPart "未确认存在" 是审慎而非确定**：实际上是 confirmed 存在于 canonical.ts:25-29；GLM 标注 medium correctness 但措辞 "未代码确认"，让 implementer 仍需自行核实——稍微扣可执行性。
4. **lockfile 验证手段未提**：deepseek R1 独家；GLM 未触及。

### 8.3 Findings 质量清点

| 编号 | 原始严重 | 事后判定 | Finding 质量 | 分析 |
|------|---------|----------|--------------|------|
| R1 | medium | true-positive | good | 行号引用普遍漂移；用 deepseek R5 风格的"全局声明"更经济 |
| R2 | high | true-positive | excellent | RH1 §4.3 P1-06b 实施步骤直接据此（"内部委托 emitServerFrame"）|
| R3 | high | true-positive | excellent | 与 GPT R1 共识：5 vs ≥7 测试文件 |
| R4 | medium | true-positive | excellent | tests/cross-worker/ → test/cross-e2e/ 全 7 份 action-plan 替换据此 |
| R5 | low | true-positive | weak | 单条行号微调；价值低 |
| R6 | medium | true-positive | mixed | 行号偏移 + 方法名定位；可与 R1 合并 |
| R7 | medium | true-positive | excellent | 4 份 review **独家**最高价值之一；RH2 §4.3 P2-05/06/07 重写据此 |
| R8 | low | true-positive | weak | 单条行号；ROI 低 |
| R9 | low | true-positive | weak | 单条行号；ROI 低 |
| R10 | medium | partial | good | "未确认 ImageUrlContentPart 存在" —— 实际存在；本评估在 RH5 §0 加澄清：已存在于 canonical.ts:25-29 |
| R11 | low | true-positive | good | madge 安装步骤；与 kimi R6 共识；本评估让 madge 移到 RH0 P0-A2 |
| R12 | medium | true-positive | excellent | 4 份 review **独家**；RH2 §4.6 P2-14/P2-15 audit 步骤据此 |
| R13 | medium | true-positive | excellent | 与 GPT R4 / deepseek R4 共识；为 RH1 拓扑修正提供独立验证 |

### 8.4 多维度评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 证据链完整度 | 10 | grep / wc -l / file-existence + 命名匹配证据全覆盖 |
| 判断严谨性 | 9 | 0 false-positive；R10 偏审慎而非确定让 implementer 多一次核实 |
| 修法建议可执行性 | 9 | 命名澄清 + 复用方向给得清楚；行号微调类略形式化 |
| 对 action-plan / design / QNA 的忠实度 | 9 | charter alignment 部分覆盖；owner QNA 处理正确 |
| 协作友好度 | 8 | 13 finding 数量略多；5 条行号微调可合并 |
| 找到问题的覆盖面 | 10 | 13 finding 全 valid；4 份 review 中 coverage 最广 |
| 严重级别 / verdict 校准 | 9 | 2 yes blocker / 11 non-blocker 校准合理；少 charter hard-gate critical |

**综合**：`9.2 / 10`。GLM 是 4 份 review 中**广度最广 + 独家发现最多**的一份；R7 (context-core RPC 缺口) 与 R12 (客户端 adapter 工作量) 是 GPT/deepseek/kimi 全部漏掉的 high-value finding。短板是 13 条略多 + 5 条行号微调价值较低。如果 implementer 时间紧张，可先看 R2/R3/R7/R12/R13 五条最高价值；行号类作为 cross-cutting follow-up 处理。
