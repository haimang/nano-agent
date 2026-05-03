# Nano-Agent 行动计划

> 服务业务簇: `pro-to-product / PP4 — Hook Delivery Closure`
> 计划对象: `接通 PreToolUse minimal live hook loop：session-scoped register → tool 前 emit → block/update outcome → frontend visible + audit visible`
> 类型: `modify`
> 作者: `GPT-5.5`
> 时间: `2026-05-03`
> 文件位置: `docs/action-plan/pro-to-product/PP4-hook-delivery-closure-action-plan.md`
> 上游前序 / closure:
> - `docs/action-plan/pro-to-product/PP1-hitl-interrupt-closure-action-plan.md`
> - `docs/issue/pro-to-product/PP1-closure.md`
> - `docs/action-plan/pro-to-product/PP3-reconnect-session-recovery-action-plan.md`
> - `docs/issue/pro-to-product/PP3-closure.md`
> - `docs/design/pro-to-product/05-hook-delivery-closure.md`
> 下游交接:
> - `docs/action-plan/pro-to-product/PP5-policy-reliability-hardening-action-plan.md`
> - `docs/action-plan/pro-to-product/PP6-api-contract-docs-closure-action-plan.md`
> - `docs/issue/pro-to-product/PP4-closure.md`
> 关联设计 / 调研文档:
> - `docs/design/pro-to-product/00-agent-loop-truth-model.md`
> - `docs/design/pro-to-product/01-frontend-trust-contract.md`
> - `docs/design/pro-to-product/PPX-qna.md` Q15-Q17
> 冻结决策来源:
> - `docs/design/pro-to-product/PPX-qna.md` Q15（PP4 只闭合 minimal live hook loop，不扩 full catalog）
> - `docs/design/pro-to-product/PPX-qna.md` Q16（不开放 shell hook）
> - `docs/design/pro-to-product/PPX-qna.md` Q17（PermissionRequest 无 handler 默认 fail-closed）
> 文档状态: `draft`

---

## 0. 执行背景与目标

PP4 的核心不是“hook catalog 已经有多少事件”，而是至少一条用户驱动 hook 能真实影响 agent loop，并被前端与 audit 同时看见。当前 nano-agent 已有 substrate：`HookRegistry.register/list/unregister` 可保存 handler（`workers/agent-core/src/hooks/registry.ts:18-72`），`HookDispatcher.emit()` 能按 matcher、blocking、timeout、runtime 执行 handler（`workers/agent-core/src/hooks/dispatcher.ts:61-148`），catalog 中 `PreToolUse` 支持 `block` / `updatedInput` / `diagnostics`（`workers/agent-core/src/hooks/catalog.ts:92-97`），runtime mainline 也有 hook delegate seam（`workers/agent-core/src/host/runtime-mainline.ts:810-832`）。但断点也很清楚：PreToolUse 仍缺 production caller，generic `hook_emit` 只会广播，不证明工具执行前 outcome 真生效（`workers/agent-core/src/kernel/runner.ts:412-428`）。

参考 agent 的一手代码支持 PP4 的收窄：Gemini 的 before-tool hook 能 stop、block、modify input 并重建/验证 invocation（`context/gemini-cli/packages/core/src/core/coreToolHookTriggers.ts:88-150`）；Codex 的 pre-tool hook 以 session/turn/cwd/model/permission mode 构造 request，并发 hook started/completed events（`context/codex/codex-rs/core/src/hook_runtime.rs:118-172`）；Claude Code 的 hooks 是 user-defined shell commands，但这正是 nano-agent 不照搬的部分，因为 Cloudflare worker 不能 fork/exec（`context/claude-code/utils/hooks.ts:1-5`）。PP4 因此只做 worker-safe、session-scoped、PreToolUse-first 的 minimal live loop。

- **服务业务簇**：`pro-to-product / PP4 — Hook Delivery Closure`
- **计划对象**：`PreToolUse minimal live loop`
- **本次计划解决的问题**：
  - hook registry/dispatcher 已存在，但用户无法通过 public/session-scoped path 注册可运行 handler。
  - PreToolUse 缺 production caller，无法证明 block/update input 真影响工具执行。
  - hook outcome 与 audit/stream/frontend visibility 尚未形成可对账闭环。
- **本次计划的直接产出**：
  - session-scoped register/list/unregister path，带 auth、validation、matcher/runtime restrictions。
  - PreToolUse caller，在工具执行前 emit，并尊重 `block` 与 `updatedInput`。
  - `docs/issue/pro-to-product/PP4-closure.md`，登记 register→emit→outcome→frontend visible + audit visible 证据。
- **本计划不重新讨论的设计结论**：
  - PP4 只闭合 PreToolUse minimal loop，不接 full 18-event catalog（来源：`PPX-qna.md` Q15）。
  - 不开放 shell hook；当前 worker runtime 不具备进程执行能力（来源：`PPX-qna.md` Q16）。
  - PermissionRequest 缺 handler时 fail-closed，不 fallback confirmation（来源：`PPX-qna.md` Q17）。

---

## 1. 执行综述

### 1.1 总体执行方式

PP4 采用 **先开放最小 register surface，再接 PreToolUse caller，最后补 observability/e2e** 的执行方式。第一步让用户或前端能注册 session-scoped handler；第二步把工具执行前的真实 path 接到 dispatcher 并验证 outcome；第三步补 audit、`hook.broadcast` 与 docs/closure。PostToolUse 与 PermissionRequest 只作为 secondary candidate，不进入 hard gate。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Session Hook Registration | `M` | 增加 session-scoped register/list/unregister，限制 event/runtime/matcher | `PP1 + PP3 closure` |
| Phase 2 | PreToolUse Production Caller | `L` | 工具执行前 emit PreToolUse，并尊重 block/update outcome | `Phase 1` |
| Phase 3 | Observability & Frontend Visibility | `M` | 产出 audit、hook.broadcast、redaction 与 docs truth | `Phase 2` |
| Phase 4 | Minimal Hook E2E & Closure | `S` | e2e 证明 register→tool call→outcome→visibility 闭环 | `Phase 3` |

### 1.3 Phase 说明

1. **Phase 1 — Session Hook Registration**
   - **核心目标**：把 registry 从测试/内部 substrate 变成 session-scoped product path。
   - **为什么先做**：没有 user-driven register，PreToolUse caller 只能证明内部注入，不算 T5。
2. **Phase 2 — PreToolUse Production Caller**
   - **核心目标**：在真实 tool execution 前触发 dispatcher，并让 block/update 改变执行行为。
   - **为什么放在这里**：T5 的硬闸是 hook outcome 影响真实 agent loop，而不是广播一个 hook event。
3. **Phase 3 — Observability & Frontend Visibility**
   - **核心目标**：blocked/updated/diagnostics outcome 必须可 audit，且至少一条 frontend-visible path 可见。
   - **为什么放在这里**：没有 visibility，前端无法区分 hook 生效还是工具自己失败。
4. **Phase 4 — Minimal Hook E2E & Closure**
   - **核心目标**：以 PP0 evidence shape 证明最小 loop，并写 PP4 closure。
   - **为什么放在最后**：closure 必须建立在 register、caller、observability 三者都成立之后。

### 1.4 执行策略说明

- **执行顺序原则**：register surface → runtime caller → audit/stream → e2e/docs。
- **风险控制原则**：不扩 hook enum、不开放 shell hook、不做 full hook editor、不把 PermissionRequest 当 PP4 硬闸。
- **测试推进原则**：先测 registry validation，再测 PreToolUse block/update，再测 stream/audit/e2e。
- **文档同步原则**：只同步 PP4 hook surface 的最小 docs truth；完整 docs pack 由 PP6 扫。
- **回滚 / 降级原则**：handler exception 在 blocking path 必须 fail-safe 并可 audit；不能 silent continue 后让用户误以为 hook 成功。

### 1.5 本次 action-plan 影响结构图

```text
PP4 Hook Delivery Closure
├── Phase 1: Session Hook Registration
│   ├── workers/agent-core/src/hooks/registry.ts
│   ├── workers/agent-core/src/hooks/catalog.ts
│   └── public/session-scoped register route or control seam
├── Phase 2: PreToolUse Production Caller
│   ├── workers/agent-core/src/host/runtime-mainline.ts
│   ├── workers/agent-core/src/kernel/runner.ts
│   └── tool execution path / validation
├── Phase 3: Observability & Frontend Visibility
│   ├── workers/agent-core/src/hooks/audit.ts
│   ├── packages/nacp-session/src/stream-event.ts
│   └── hook.broadcast redaction tests
└── Phase 4: Minimal Hook E2E & Closure
    ├── test/cross-e2e/**/*.test.mjs
    ├── clients/api-docs/hooks.md or relevant docs（必要最小同步）
    └── docs/issue/pro-to-product/PP4-closure.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** session-scoped hook register/list/unregister，至少支持 `PreToolUse` 与 worker-safe local-ts/service-binding 形态。
- **[S2]** registry validation：未知 event、未知 runtime、非法 matcher、超时/优先级越界必须拒绝。
- **[S3]** PreToolUse production caller：每次工具执行前 emit，`block` 阻止执行，`updatedInput` 重新 validate 后执行。
- **[S4]** hook outcome observability：blocked/updated/diagnostics 有 audit，至少一条 `hook.broadcast` 前端可见。
- **[S5]** redaction：tool input/output 按 catalog redaction hints 处理，不把敏感 payload 原样广播。
- **[S6]** minimal e2e：register → tool call → PreToolUse outcome → frontend visible + audit visible。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 不扩展 hook enum，不接 full 18-event catalog。
- **[O2]** 不开放 shell command hook；未来若需要，必须先有 dedicated sandbox worker 和独立 charter。
- **[O3]** 不实现完整 hook editor / admin plane / org policy UI。
- **[O4]** 不把 PermissionRequest fallback confirmation 纳入 PP4；Q17 已冻结 fail-closed。
- **[O5]** 不把 PostToolUse 作为 closure 硬闸；它可作为 secondary outcome，但不影响 PP4 T5 判定。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| PreToolUse block/update | `in-scope` | T5 最有信息量的 minimal live loop | 无 |
| Session register/list/unregister | `in-scope` | 没有用户驱动 register 不算 product hook | 无 |
| PermissionRequest no handler | `in-scope as constraint` | Q17 冻结 fail-closed | 若 owner 修订 Q17 |
| PostToolUse | `secondary` | 非 blocking，不能证明 outcome 改变行为 | PP4 完成后扩展 |
| Shell hook | `out-of-scope` | Worker runtime 不支持 fork/exec | 需要 sandbox worker charter |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | Hook registration control surface | `add` | agent-core/orchestrator facade seam | 用户可注册 session hook | `high` |
| P1-02 | Phase 1 | Handler validation | `add` | hooks schema/catalog/tests | 非法 handler 被拒绝 | `medium` |
| P1-03 | Phase 1 | Register persistence/scope | `add` | registry/session state | handler scope 不跨 session 泄漏 | `medium` |
| P2-01 | Phase 2 | PreToolUse caller | `update` | `runtime-mainline.ts`, tool execution path | 工具前触发 hook | `high` |
| P2-02 | Phase 2 | Block outcome enforcement | `update` | dispatcher/runtime tests | block 真阻止工具 | `high` |
| P2-03 | Phase 2 | Updated input validation | `update` | tool validation path/tests | updatedInput 重新 validate | `high` |
| P3-01 | Phase 3 | Audit outcome | `update` | `hooks/audit.ts` | blocked/updated 有 audit | `medium` |
| P3-02 | Phase 3 | Frontend broadcast/redaction | `update` | `stream-event.ts`, broadcast path | outcome 前端可见且脱敏 | `medium` |
| P4-01 | Phase 4 | Hook e2e | `add` | `test/cross-e2e` | 证明 minimal live loop | `high` |
| P4-02 | Phase 4 | PP4 closure | `add` | `docs/issue/pro-to-product/PP4-closure.md` | T5 truth 可被 PP5/PP6 引用 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Session Hook Registration

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | Hook registration control surface | 增加 session-scoped register/list/unregister caller | agent-core/orchestrator facade seam | 用户能注册 PreToolUse handler | route/integration tests | register 后 registry 可查 |
| P1-02 | Handler validation | 校验 event/runtime/matcher/timeout/source，不允许 shell runtime | hook schema/catalog/tests | invalid handler fail-visible | unit tests | 不 silent register |
| P1-03 | Register persistence/scope | 确保 session-scoped handler 不泄漏到其他 session，必要时持久化/恢复 | registry/session state | scope 明确 | tests | reconnect 后行为符合设计 |

### 4.2 Phase 2 — PreToolUse Production Caller

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | PreToolUse caller | 在真实工具执行前构造 payload/context 并 emit `PreToolUse` | runtime/tool execution | 每个目标工具执行前触发 | agent-core tests | caller 不只存在于 synthetic step |
| P2-02 | Block outcome enforcement | 当 outcome blocked 时阻止工具并返回可解释错误/diagnostics | dispatcher/runtime | block 真影响执行 | tests/e2e | 工具没有被执行 |
| P2-03 | Updated input validation | 对 updatedInput 重新走 tool validation，再执行 | tool validation path | 修改输入生效且安全 | tests | invalid update 被拒绝 |

### 4.3 Phase 3 — Observability & Frontend Visibility

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | Audit outcome | 写 `hook.outcome` audit，包含 event、handler id、duration、action、trace | `hooks/audit.ts` | 可追踪 | unit/integration | blocked/updated 必有 audit |
| P3-02 | Frontend broadcast/redaction | 发 `hook.broadcast` 或等价 frame，并按 redaction hints 脱敏 | stream-event/broadcast | 前端可见，不泄露输入 | tests | payload redacted 可证明 |

### 4.4 Phase 4 — Minimal Hook E2E & Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | Hook e2e | 覆盖 register→tool call→block/update→frontend/audit | cross-e2e | T5 有真实证据 | e2e | evidence shape 完整 |
| P4-02 | PP4 closure | 写 live/substrate-only hook 表、Q17 fail-closed、known issues | `PP4-closure.md` | PP6 可扫 docs | docs review | 不 overclaim full catalog |

---

## 5. Phase 详情

### 5.1 Phase 1 — Session Hook Registration

- **Phase 目标**：让 hook 从内部 substrate 变成 user-driven session capability。
- **本 Phase 对应编号**：`P1-01`, `P1-02`, `P1-03`
- **本 Phase 新增文件**：
  - hook registration route/control tests。
- **本 Phase 修改文件**：
  - `workers/agent-core/src/hooks/registry.ts`
  - hook handler schema/validation owner file
  - 可能的 `orchestrator-core` facade route 或 session-control seam。
- **具体功能预期**：
  1. session user 可以注册/list/unregister PreToolUse handler。
  2. 只允许 worker-safe runtime，不允许 shell。
  3. handler source/scope/priority 不越权。
- **具体测试安排**：
  - **单测**：validation and registry ordering。
  - **集成测试**：register/list/unregister route/control path。
  - **回归测试**：agent-core/orchestrator-core tests。
  - **手动验证**：非法 shell runtime 被拒绝。
- **收口标准**：
  - register 是用户驱动，不是测试 fixture 注入。
  - session scope 清楚。
- **本 Phase 风险提醒**：
  - 如果 register surface 太宽，会提前滑入 admin/hook editor 产品线。

### 5.2 Phase 2 — PreToolUse Production Caller

- **Phase 目标**：让 hook outcome 改变真实工具执行。
- **本 Phase 对应编号**：`P2-01`, `P2-02`, `P2-03`
- **本 Phase 新增文件**：
  - PreToolUse caller tests。
- **本 Phase 修改文件**：
  - `workers/agent-core/src/host/runtime-mainline.ts`
  - `workers/agent-core/src/kernel/runner.ts`
  - tool execution/validation path。
- **具体功能预期**：
  1. 工具执行前构造 payload：session、turn、tool name、redacted input、trace。
  2. block outcome 阻止执行并返回可解释 diagnostics。
  3. updatedInput outcome 重新 validate 后执行；invalid update fail-visible。
- **具体测试安排**：
  - **单测**：block/update/continue outcome mapping。
  - **集成测试**：真实 tool call path。
  - **回归测试**：`pnpm --filter @haimang/agent-core-worker test`。
  - **手动验证**：tool 没有在 blocked path 执行。
- **收口标准**：
  - generic `hook_emit` 不再被当作 PreToolUse closure 证据。
  - PreToolUse caller 是 production path。
- **本 Phase 风险提醒**：
  - updatedInput 必须重新 validate，否则 hook 成为绕过工具 schema 的后门。

### 5.3 Phase 3 — Observability & Frontend Visibility

- **Phase 目标**：让 hook outcome 可审计、可前端消费。
- **本 Phase 对应编号**：`P3-01`, `P3-02`
- **本 Phase 新增文件**：
  - audit/broadcast tests。
- **本 Phase 修改文件**：
  - `workers/agent-core/src/hooks/audit.ts`
  - stream frame/broadcast owner file。
- **具体功能预期**：
  1. blocked/updated/diagnostics outcome 写 audit。
  2. frontend 可见 `hook.broadcast` 或等价 frame。
  3. payload 按 redaction hints 脱敏。
- **具体测试安排**：
  - **单测**：audit record builder、redaction。
  - **集成测试**：runtime emit → stream event。
  - **回归测试**：agent-core tests。
  - **手动验证**：敏感 tool input 不出现在广播 payload。
- **收口标准**：
  - frontend visible + audit visible 双成立。
  - handler error 不 silent。
- **本 Phase 风险提醒**：
  - observability 不能泄露 tool input/output 原文。

### 5.4 Phase 4 — Minimal Hook E2E & Closure

- **Phase 目标**：证明 T5 hook truth 成立。
- **本 Phase 对应编号**：`P4-01`, `P4-02`
- **本 Phase 新增文件**：
  - PP4 hook e2e。
  - `docs/issue/pro-to-product/PP4-closure.md`
- **本 Phase 修改文件**：
  - 必要的 clients/api-docs hook 入口或 transport docs 最小同步。
- **具体功能预期**：
  1. e2e 从 register 开始，不使用内部 fixture 直接注入。
  2. 至少覆盖 block 或 updatedInput 一条能改变工具行为的 outcome。
  3. closure 列出 live hooks 与 catalog-only hooks。
- **具体测试安排**：
  - **单测**：无新增或 helper。
  - **集成测试**：register + tool path。
  - **回归测试**：`pnpm test:cross-e2e` 或 targeted package e2e。
  - **手动验证**：PP6 能据此更新 hook docs。
- **收口标准**：
  - register→emit→outcome→frontend visible + audit visible 闭环成立。
  - 不声称 full catalog live。
- **本 Phase 风险提醒**：
  - 如果只证明 dispatcher 被注入，不算 PP4 完成。

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q15 | `PPX-qna.md` Q15 | PP4 只做 PreToolUse minimal live loop，不扩 full catalog | 若要求 full catalog，需重写 PP4 |
| Q16 | `PPX-qna.md` Q16 | 禁止 shell hook | 若未来支持，需 sandbox worker charter |
| Q17 | `PPX-qna.md` Q17 | PermissionRequest 无 handler fail-closed | 若改 fallback confirmation，需修 catalog/dispatcher/tests/docs |
| T5 | `plan-pro-to-product.md` §10.1 | 至少一条 user-driven hook live loop 是 hard gate | 未满足则 PP4 cannot close |
| PP1 HITL truth | `PP1-closure.md` | Permission/HITL substrate 可被 secondary candidates 复用 | 若 PP1 未稳定，PP4 不进入主实现 |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| register/caller 脱节 | 用户能注册但 runtime 不触发 | `high` | e2e 必须从 register 到 tool call |
| updatedInput 绕过校验 | hook 修改输入后直接执行 | `high` | 必须重建/validate invocation |
| shell hook scope creep | 参考 CLI 支持 shell 导致误扩 | `medium` | Q16 写成 runtime 硬约束 |
| payload 泄露 | broadcast 未脱敏 | `high` | redaction hints test |

### 7.2 约束与前提

- **技术前提**：PP1 HITL 与 PP3 recovery 已稳定；hook e2e 可使用 PP0 evidence skeleton。
- **运行时前提**：worker-safe hook runtime 可执行，不依赖 shell。
- **组织协作前提**：frontend 需要确认最小 hook visibility 是否足够调试/展示。
- **上线 / 合并前提**：不扩 catalog enum，不支持 multi-hook platform UI。

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - 原则上无；若 Q15-Q17 改变，回到 PPX-qna。
- 需要同步更新的说明文档 / README：
  - `docs/issue/pro-to-product/PP4-closure.md`
  - 必要时新增或最小更新 `clients/api-docs` hook 相关条目。
- 需要同步更新的测试说明：
  - PP4 e2e evidence 写入 closure。

### 7.4 完成后的预期状态

1. 至少一条 PreToolUse hook 可以由用户/session 注册并真实触发。
2. block/update outcome 会改变真实工具执行。
3. hook outcome 对前端和 audit 均可见，且 payload 脱敏。
4. PP5 可以在明确 hook/policy 优先级与 Q17 fail-closed 语义上继续 hardening。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `git --no-pager diff --check -- docs/action-plan/pro-to-product/PP4-hook-delivery-closure-action-plan.md`
- **单元测试**：
  - registry validation/order。
  - dispatcher outcome mapping。
  - updatedInput validation/redaction。
- **集成测试**：
  - session register/list/unregister。
  - PreToolUse caller on real tool path。
- **端到端 / 手动验证**：
  - register → tool call → block/update → hook.broadcast → audit。
- **回归测试**：
  - `pnpm --filter @haimang/agent-core-worker test`
  - `pnpm --filter @haimang/orchestrator-core-worker test`（若有 facade/control route）
  - `pnpm test:cross-e2e`（若扩展 e2e）
- **文档校验**：
  - `pnpm run check:docs-consistency`（若改 clients/api-docs）。

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. PreToolUse user-driven minimal loop 成立。
2. block/update input 能真实影响工具执行。
3. hook outcome frontend visible + audit visible。
4. shell hook、full catalog、PermissionRequest fallback 均未被悄悄纳入 PP4 scope。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | PreToolUse minimal live loop 从注册到 outcome 全闭合 |
| 测试 | registry/caller/outcome/visibility/e2e 均覆盖 |
| 文档 | PP4 closure 诚实区分 live 与 catalog-only |
| 风险收敛 | 无 full catalog scope creep、无 shell hook、无 payload 泄露 |
| 可交付性 | PP5 可基于 hook/policy 优先级继续 hardening |
