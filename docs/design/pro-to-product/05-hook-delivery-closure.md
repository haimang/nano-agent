# PP4 / Hook Delivery Closure

> 功能簇: `PP4 / Hook Delivery Closure`
> 讨论日期: `2026-05-02`
> 讨论者: `GPT-5.5`
> 关联调查报告:
> - `docs/charter/plan-pro-to-product.md`
> - `docs/design/pro-to-product/00-agent-loop-truth-model.md`
> - `docs/design/pro-to-product/01-frontend-trust-contract.md`
> 关联 QNA / 决策登记:
> - `docs/charter/plan-pro-to-product.md` §10 T5
> 文档状态: `draft`

---

## 0. 背景与前置约束

- **项目定位回顾**：hook 是 nano-agent 的治理/扩展边界，但 pro-to-product 不能把“catalog/dispatcher 存在”误写成“用户可配置 hook 已产品化”。
- **本次讨论的前置共识**：
  - 当前 agent-core 已有 hook registry、dispatcher、catalog、audit builder 与 runtime assembly。
  - charter 已精化 PP4 为 user-driven hook：`PreToolUse / PostToolUse / PermissionRequest`。
- **本设计必须回答的问题**：
  - 什么叫 hook delivery closed？
  - 哪些 hook 已是 substrate，哪些需要用户驱动 register caller？
  - 前端要不要直接操作 hook？
- **显式排除的讨论范围**：
  - 不开放任意远程代码执行式 hook marketplace。
  - 不新增 hook event enum。

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Hook Delivery Closure`
- **一句话定义**：把 hook 从内部 dispatcher substrate 推进到可注册、可触发、可观察、可阻断的用户驱动能力。
- **边界描述**：包含 hook registration surface、PreToolUse/PostToolUse/PermissionRequest live caller、blocking semantics、audit/stream visibility、timeout/depth guard；不包含 marketplace、plugin packaging、复杂前端 hook editor。

| 术语 | 定义 | 备注 |
|------|------|------|
| `registry` | 存储 hook handler config 的内存/可快照结构 | 当前已有 |
| `dispatcher` | 查找、过滤、执行 hook 的 runtime | 当前已有 |
| `user-driven register` | 用户/前端/会话配置能注册 handler | 当前缺口 |
| `blocking hook` | 可 block/stop/modify input 的 hook | PreToolUse/PermissionRequest |
| `hook delivery` | register → trigger → outcome → audit/stream → effect 全链路 | PP4 closure |

### 1.2 参考调查报告

- `docs/design/pro-to-product/00-agent-loop-truth-model.md` — T5 Hook truth。
- `docs/design/pro-to-product/01-frontend-trust-contract.md` — frontend-visible minimal loop 边界。
- `workers/agent-core/src/hooks/*` — 当前 substrate。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

PP4 位于 HITL、policy 与 tool execution 之间。它不是为了“炫技扩展”，而是让前端/产品可以配置最小治理：工具执行前拦截、工具执行后记录/补上下文、权限请求时介入。当前 `HookDispatcher` 已经有 timeout/depth/fail-closed guard，但没有稳定的 user-facing register surface；因此 PP4 的主线是 delivery，而不是再扩 enum。

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|----------|----------|------|
| `02-hitl-interrupt-closure` | `05 ↔ 02` | 强 | PermissionRequest hook 与 confirmation ask 交汇 |
| `03-context-budget-closure` | `05 ↔ 03` | 中 | Pre/PostCompact 仍可后续利用 |
| `04-reconnect-session-recovery` | `05 ↔ 04` | 中 | hook outcome/broadcast 要能恢复或降级 |
| `06-policy-reliability-hardening` | `05 ↔ 06` | 强 | hook block/allow 必须纳入 policy honesty |
| `07-api-contract-docs-closure` | `05 → 07` | 强 | 当前 clients/api-docs 没有 hook 专章 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Hook Delivery Closure` 是 **治理扩展交付层**，负责 **把 hook handler 从内部 substrate 接到用户驱动注册与真实 runtime caller**，对上游提供 **工具/权限治理能力**，对下游要求 **audit/stream/docs 全部可观察且不 overclaim**。

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| 新 hook event enum | Claude/Codex 事件很多 | nacp-core/catalog 已冻结 18 events | 新 charter |
| Marketplace/plugin UI | claude-code precedent | 超出 PP4 最小交付 | 产品插件阶段 |
| 任意 shell hook | CLI precedent | Cloudflare runtime 不适合直接 shell | 安全模型重评 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 | 第一版行为 | 未来可能的演进方向 |
|--------|----------|------------|---------------------|
| `HookSource` | platform-policy/session/skill | session/platform 最小接入 | skill hook |
| `HookRuntimeKind` | local-ts/service-binding | local-ts + future service-binding | remote hook worker |
| `hook.broadcast` | stream event | redacted payload/outcome | richer inspector |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：hook registration config 与 hook execution result。
- **解耦原因**：注册失败/handler 缺失不能在运行时伪装为 allow；执行失败要变 diagnostics 或 block，不能污染 registry。
- **依赖边界**：registry 只存 handler config；dispatcher 执行并聚合 outcome；runtime caller 决定 block/continue。
- **D1 纪律**：PP4 默认 zero migration；若后续产品 hook 需要 durable schema 例外，必须按 charter §4.5 申请，而不是在 delivery phase 内默认扩表。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：`HookDispatcher.emit()`。
- **聚合形式**：所有 caller 只通过 dispatcher，不绕过 registry/runtimes/guards。
- **为什么不能分散**：绕过 dispatcher 会丢 timeout、depth、blocking 与 audit discipline。

---

## 4. 参考实现 / 历史 precedent 对比

### 4.1 gemini-cli 的做法

- **实现概要**：Gemini 的 tool hook trigger 在工具执行前触发 before hook，可停止执行、阻断工具、修改输入，再执行工具。
- **亮点**：
  - before hook 可 `shouldStopExecution()` 直接停止 agent（`context/gemini-cli/packages/core/src/core/coreToolHookTriggers.ts:88-107`）。
  - before hook 可 block tool execution 并返回用户可见错误（`context/gemini-cli/packages/core/src/core/coreToolHookTriggers.ts:109-120`）。
  - before hook 可修改 tool input 并重新 build/validate invocation（`context/gemini-cli/packages/core/src/core/coreToolHookTriggers.ts:122-150`）。
- **值得借鉴**：PreToolUse 的 effect 必须真实影响工具执行，而不只是发日志。
- **不打算照抄的地方**：不提供本地 shell hook；Cloudflare 环境要通过受控 runtime/service-binding。

### 4.2 codex 的做法

- **实现概要**：Codex hook runtime 为 SessionStart/PreToolUse/PostToolUse/UserPromptSubmit 等构造请求、预览 runs、emit started/completed events，并把 block/context outcome 写回 loop。
- **亮点**：
  - `run_pre_tool_use_hooks()` 构造 session/turn/cwd/model/permission_mode/tool_use_id 等完整上下文（`context/codex/codex-rs/core/src/hook_runtime.rs:118-143`）。
  - PreToolUse 可返回 `block_reason`，调用方据此阻断（`context/codex/codex-rs/core/src/hook_runtime.rs:138-145`）。
  - PostToolUse 运行后 emit completed events（`context/codex/codex-rs/core/src/hook_runtime.rs:148-172`）。
- **值得借鉴**：hook payload 必须带足 session/turn/model/tool context。
- **不打算照抄的地方**：不在 PP4 实现 Codex 全 hook family 的全部 product behavior。

### 4.3 claude-code 的做法

- **实现概要**：Claude Code hook 系统支持多来源 hook、同步/异步输出、pending async hook registry、hook started/response events、SessionEnd timeout。
- **亮点**：
  - hook 模块显式定义 hooks 是 user-defined shell commands（`context/claude-code/utils/hooks.ts:1-5`）。
  - SessionEnd hook 有独立短 timeout（`context/claude-code/utils/hooks.ts:166-182`）。
  - async hook 完成后 emitHookResponse 并可能 enqueue pending notification（`context/claude-code/utils/hooks.ts:184-240`）。
- **值得借鉴**：hook 需要 started/response 可观察性和严格 timeout。
- **不打算照抄的地方**：不执行任意 shell command；nano-agent 的 worker 环境需要更保守。

### 4.4 横向对比速查表

| 维度 | gemini-cli | codex | claude-code | nano-agent 倾向 |
|------|------------|-------|-------------|------------------|
| before tool effect | stop/block/modify | block reason | permission/hook handlers | PreToolUse block/update |
| context payload | tool input/MCP | session/turn/cwd/model | app/session env | session/turn/tool/redacted payload |
| runtime | local JS | Rust hook runtime | shell/subprocess | local-ts/service-binding |
| observability | debug/errors | hook events | started/response events | audit `hook.outcome` + `hook.broadcast` |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1] User-driven hook registration** — 至少 session-scoped register/list/unregister。
- **[S2] PreToolUse live effect** — 这是 PP4 的最小硬闸，block/update input 必须影响工具执行。
- **[S3] Minimal hook observability** — 至少一条 user-driven loop 要有 audit/broadcast/docs visibility。
- **[S4] PermissionRequest / PostToolUse** — 只作为次级候选；是否进入本 phase live loop 取决于不突破 charter 最小范围、且对应 QNA 已冻结。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1] 新事件 enum** — catalog frozen。
- **[O2] 任意 shell command hook** — worker 环境安全不允许。
- **[O3] 完整前端 hook editor** — 只提供 contract，不做 UI。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| `HookRegistry.register()` | substrate | API 存在不等于用户可注册 | PP4 要 public/control surface |
| `eval/durable-promotion-registry` | out-of-scope | 不是 hook handler registry | 不作为 hook live evidence |
| `hook.broadcast` | in-scope visibility | 已在 stream catalog | PP4/PP6 docs |
| service-binding hook runtime | defer | 类型存在，产品策略未冻结 | PP4 后续或 PP5 |
| `PostToolUseFailure / Setup / Stop / PreCompact / PostCompact / PermissionDenied / ContextPressure / ContextCompact* / EvalSinkOverflow` | substrate-ready only | 不属于 charter 冻结的 minimal live loop | 下一阶段或 secondary outcome |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **用户驱动最小 register** 而不是 **只保留内部 registry**
   - **为什么**：没有 register caller，hook 无法被前端/用户实际使用。
   - **我们接受的代价**：需要定义 handler config validation 与 auth。
   - **未来重评条件**：若 owner 明确 hooks 只作为平台内部能力。

2. **取舍 2**：我们选择 **PreToolUse-first minimal loop** 而不是 **PreToolUse/PostToolUse/PermissionRequest 三类一起闭合**
   - **为什么**：charter 冻结的是“至少一条 user-driven hook live loop”，不是三类一起收口。
   - **我们接受的代价**：PostToolUse 与 PermissionRequest 可能只作为次级 outcome 或后续 phase 输入。
   - **未来重评条件**：owner 提高 PP4 scope，或 minimal loop 被证明不足。

3. **取舍 3**：我们选择 **先冻结 PermissionRequest fallback law** 而不是 **让 handler 缺失语义继续模糊**
   - **为什么**：`fallback confirmation` 与 `fail-closed` 是不同产品语义，不能在 action-plan 内临时改口。
   - **我们接受的代价**：Q17 未回答前，PermissionRequest 不能作为 PP4 硬闸。
   - **未来重评条件**：owner 在 PPX-qna Q17 中正式拍板。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| hook 能注册但不触发 | register surface 与 runtime caller 脱节 | fake-live | PP4 e2e 必须覆盖 register→tool call |
| handler 抛错被吞 | dispatcher diagnostics continue | 用户以为成功 | blocking hook 错误需 audit/broadcast |
| payload 泄露 | hook.broadcast 发原始 tool input/output | 安全风险 | redaction hints + payload_redacted |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：把“hooks substrate”与“hooks product”区分清楚。
- **对 nano-agent 的长期演进**：给 policy、skills、enterprise governance 预留统一扩展点。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：PreToolUse/PermissionRequest 是 skill 安全边界的基础。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | Session Hook Registration | session-scoped register/list/unregister | ✅ 用户能注册 handler |
| F2 | PreToolUse Delivery | tool 执行前触发并尊重 outcome | ✅ block/update 真生效 |
| F3 | Secondary Hook Candidates | PostToolUse/PermissionRequest 仅在不突破 charter scope 时进入 live loop | ✅ 不再 scope creep |
| F4 | Hook Observability | audit + stream docs | ✅ hook outcome 可追踪 |

### 7.2 详细阐述

#### F1: Session Hook Registration

- **输入**：handler config（id/source/event/matcher/runtime/timeout）。
- **输出**：registry 中可查的 handler。
- **主要调用者**：前端/配置面、agent-core runtime。
- **核心逻辑**：`HookRegistry.register()` 已支持替换/排序；PP4 要加用户驱动 caller 与 validation。
- **边界情况**：未知 event/runtime/matcher 必须拒绝，不能 silent register。
- **一句话收口目标**：✅ **hook 不再只能测试内注入。**

#### F2: PreToolUse Delivery

- **输入**：tool name/input/context。
- **输出**：allow/block/updatedInput。
- **主要调用者**：agent-core tool execution。
- **核心逻辑**：`runtime-mainline.ts:816-830` 只提供 dispatcher delegate seam；当前 PreToolUse 仍无 production caller。PP4 必须新增真实 caller，使每次工具执行前都会 emit PreToolUse，并根据 dispatcher outcome 决定 continue/block/updatedInput。
- **边界情况**：updatedInput 必须重新 validate，不能直接信任。
- **一句话收口目标**：✅ **hook outcome 改变真实工具执行。**

#### F3: Secondary Hook Candidates

- **输入**：PostToolUse result、policy ask / tool permission request。
- **输出**：optional live loop、或明确登记为 secondary outcome / deferred。
- **主要调用者**：PP4 action-plan、PP5。
- **核心逻辑**：PostToolUse 与 PermissionRequest 都只能在不突破 charter `minimal live loop` 范围时进入 PP4；其中 PermissionRequest 的无-handler语义以 PPX-qna Q17 为唯一决策来源，未冻结前不得作为 PP4 硬闸。
- **边界情况**：若 Q17 选择 `fallback confirmation`，则必须同步更新 `workers/agent-core/src/hooks/catalog.ts` 中当前 fail-closed 注释与对应 guard 语义。
- **一句话收口目标**：✅ **次级 hook 不再和 PP4 主闸混在一起。**

#### F4: Hook Observability

- **输入**：dispatcher outcome、event name、duration、trace。
- **输出**：`hook.outcome` audit、`hook.broadcast` stream、client docs。
- **主要调用者**：observability、frontend inspector。
- **核心逻辑**：`buildHookAuditRecord()` 与 `hook.broadcast` schema 已存在；PP4 要保证 product path emit。
- **边界情况**：continue outcome 是否 audit 全量记录需 balance；blocked/stop 必须记录。
- **一句话收口目标**：✅ **hook 不再是黑盒。**

### 7.3 非功能性要求与验证策略

- **性能目标**：hook timeout 必须有限，默认 guard 生效。
- **可观测性要求**：blocked/stop outcome 必有 audit，broadcast payload redacted。
- **稳定性要求**：handler exception 不应 crash 非 blocking path；blocking path 必须 fail safe。
- **安全 / 权限要求**：register surface 必须 auth/session ownership；不得执行任意 shell。
- **测试覆盖要求**：register/list/unregister、PreToolUse block/update、minimal hook observability；PostToolUse 或 PermissionRequest 只有在被 action-plan 正式纳入时才追加对应测试。
- **验证策略**：agent-core unit + orchestrator route（如有）+ cross-e2e tool hook。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 gemini-cli

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/gemini-cli/packages/core/src/core/coreToolHookTriggers.ts:88-107` | before hook stop execution | stop 真影响 agent loop | |
| `context/gemini-cli/packages/core/src/core/coreToolHookTriggers.ts:109-120` | block tool execution | PreToolUse block | |
| `context/gemini-cli/packages/core/src/core/coreToolHookTriggers.ts:122-150` | modified input + rebuild validate | updatedInput 必须验证 | |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/core/src/hook_runtime.rs:118-143` | PreToolUse request context | payload 要完整 | |
| `context/codex/codex-rs/core/src/hook_runtime.rs:138-145` | should_block/block_reason | block reason | |
| `context/codex/codex-rs/core/src/hook_runtime.rs:148-172` | PostToolUse outcome/events | post observable | |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/utils/hooks.ts:1-5` | hooks are user-defined commands | product hook 必须 user-driven | nano 不照搬 shell |
| `context/claude-code/utils/hooks.ts:166-182` | SessionEnd timeout | timeout discipline | |
| `context/claude-code/utils/hooks.ts:184-240` | async hook response/notification | observability | |

### 8.4 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `workers/agent-core/src/hooks/registry.ts:18-72` | registry substrate | 需要 user-driven caller |
| `workers/agent-core/src/hooks/dispatcher.ts:61-148` | dispatcher guard/execution | PP4 核心复用 |
| `workers/agent-core/src/hooks/catalog.ts:92-165` | PreToolUse/PermissionRequest metadata | 事件冻结 |
| `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:155-161` | runtime assembly 构造 dispatcher | substrate 已 live |
| `workers/agent-core/src/host/runtime-mainline.ts:816-830` | hook delegate seam exists, but PreToolUse 仍无 production caller | PP4 必须补 caller 而不只是改 outcome |
| `workers/agent-core/src/hooks/audit.ts:67-115` | hook.outcome audit | observability |
| `packages/nacp-session/src/stream-event.ts:75-80` | hook.broadcast schema | client visibility |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

| Q ID / 决策 ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|----------------|------|----------|----------|------|----------|
| D-05-1 | PP4 是否扩展 hook enum？ | PP4 | 否 | frozen | nacp-core/catalog |
| D-05-2 | 是否开放 shell hook？ | PP4 | 否 | proposed | Cloudflare runtime/security |
| D-05-3 | PermissionRequest 无 handler 如何处理？ | PP4/PP5 | 优先 fallback confirmation；仅当 confirmation substrate 不可用时 fail-closed | proposed | `docs/design/pro-to-product/PPX-qna.md` Q17 |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. 有用户驱动 register/list/unregister path。
2. 至少一条 charter 允许的 user-driven hook live loop 真实触发；PP4 默认以 PreToolUse 为硬闸。
3. blocked/stop/diagnostics 有 audit/stream visibility。
4. docs 明确哪些 hook live、哪些只是 catalog substrate。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - `docs/action-plan/pro-to-product/PP4-hook-delivery-closure-action-plan.md`
- **需要同步更新的设计文档**：
  - `06-policy-reliability-hardening.md` 的 policy/hook 优先级。
  - `07-api-contract-docs-closure.md` 的 hook docs 新增/回填。
- **需要进入 QNA register 的问题**：
  - 无；PermissionRequest fallback law 已集中到 `PPX-qna.md` Q17，PP4 只消费该答案。

---

## 10. 综述总结与 Value Verdict

### 10.1 功能簇画像

`Hook Delivery Closure` 的核心判断是：nano-agent 当前 hook 系统“底座很好”，但产品闭环还没完成。PP4 不应该再扩事件或引入复杂插件系统，而应该把最小用户驱动注册、真实工具/权限 caller、阻断语义和 audit/stream/docs 打通。

### 10.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 4 | 治理/扩展关键 |
| 第一版实现的性价比 | 4 | dispatcher 已有，register/caller 需补 |
| 对未来上下文管理 / Skill / 稳定性演进的杠杆 | 5 | skill/policy 基础 |
| 对开发者自己的日用友好度 | 3 | 需谨慎设计 UX |
| 风险可控程度 | 3 | 安全与 false-live 风险高 |
| **综合价值** | 4 | P0/P1 交界，但 charter 已列 hard gate |

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：Hook 是否只作为内部平台能力即可。
  - **A 方观点**：内部 dispatcher 足够。
  - **B 方观点**：没有 user-driven register，就不能叫产品化 hook。
  - **最终共识**：PP4 以最小 session-scoped register + 三类 caller 为闭环。

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-05-02` | `GPT-5.5` | 初稿 |
