# Nano-Agent 行动计划 — HP2 Model State Machine

> 服务业务簇: `hero-to-pro / HP2`
> 计划对象: `把当前零散的 turn 级 model_id / reasoning 能力提升为 session 可读写、turn 可覆盖、runtime 可审计、fallback 可追踪的模型控制面`
> 类型: `modify + API + runtime + test`
> 作者: `Owner + GPT-5.4`
> 时间: `2026-04-30`
> 文件位置:
> - `packages/nacp-session/src/messages.ts`
> - `packages/nacp-session/src/stream-event.ts`
> - `workers/orchestrator-core/src/session-lifecycle.ts`
> - `workers/orchestrator-core/src/user-do/{session-flow,message-runtime}.ts`
> - `workers/orchestrator-core/src/index.ts`
> - `workers/agent-core/src/llm/{canonical,request-builder,gateway}.ts`
> - `workers/orchestrator-core/test/**`
> - `workers/agent-core/test/**`
> - `test/cross-e2e/**`
> - `docs/issue/hero-to-pro/HP2-closure.md`
> 上游前序 / closure:
> - `docs/action-plan/hero-to-pro/HP1-action-plan.md`
> - `docs/charter/plan-hero-to-pro.md` §7.3 HP2
> 下游交接:
> - `docs/action-plan/hero-to-pro/HP3-action-plan.md`
> 关联设计 / 调研文档:
> - `docs/design/hero-to-pro/HP2-model-state-machine.md`
> - `docs/design/hero-to-pro/HPX-qna.md`
> 冻结决策来源:
> - `docs/design/hero-to-pro/HPX-qna.md` Q7-Q9（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `executed`

---

## 0. 执行背景与目标

HP2 不是“再多加几个模型参数”的小修，而是要把当前已经散落在协议层、`/messages`、LLM canonical request 和 Workers AI gateway 里的模型能力，收束成一个真正的产品级 model control plane。当前仓库已经具备若干先决条件：NACP schema 已接受 `model_id` / `reasoning`，HP0 会把 `/start` / `/input` / `/messages` 三入口 law 对齐，HP1 会提供 richer `nano_models` metadata、alias 表、session/turn audit 列。但到当前代码现实为止，`/models` 仍只有 list，session 没有 current model API，gateway 仍主要靠 message infer model，fallback 也没有用户可见的 stream/event 与 durable audit。

因此 HP2 的任务是把“message 里顺手带一个 `model_id`”升级为完整状态机：`global default → session default → turn override → effective + fallback`。这份 action-plan 只消费已冻结的 charter / design / QNA 结论，不重新打开多 provider routing、pricing、完整 compact 等后续议题。

- **服务业务簇**：`hero-to-pro / HP2`
- **计划对象**：`hero-to-pro 的模型控制面与四层状态机闭环`
- **本次计划解决的问题**：
  - 当前 `GET /models` 只返回 team-filtered list，缺 `GET /models/{id}` 和 `GET/PATCH /sessions/{id}/model`，客户端无法读取或修改 session 当前模型。
  - `CanonicalLLMRequest`、request builder、Workers AI gateway 已支持 `model` / `reasoning` / capability law，但运行主线仍偏 infer-only，缺少 requested/effective/fallback 的 durable product semantics。
  - fallback 目前没有显式的 D1 audit 与 stream event；跨模型切换也还没有冻结成 `<model_switch>` developer message contract。
- **本次计划的直接产出**：
  - `GET /sessions/{id}/model` / `PATCH /sessions/{id}/model` 与 `GET /models/{id}`。
  - alias resolve、requested/effective/fallback audit、`<model_switch>` developer message、`model.fallback` stream event。
  - 5+ e2e 与 `docs/issue/hero-to-pro/HP2-closure.md`。
- **本计划不重新讨论的设计结论**：
  - 必须引入 session default，并冻结优先级为 `turn override > session default > global default`；`PATCH /sessions/{id}/model` 第一版必须支持 set 与 clear（`{ model_id: null }`）语义（来源：`docs/design/hero-to-pro/HPX-qna.md` Q7）。
  - fallback 第一版只做单层，并且必须留下 audit + stream event（来源：`docs/design/hero-to-pro/HPX-qna.md` Q8）。
  - `<model_switch>` developer message contract 在 HP2 冻结，HP3 只做 strip / recover；仅 reasoning effort 变化不注入 `<model_switch>`，但 effort 必须独立 audit（来源：`docs/design/hero-to-pro/HPX-qna.md` Q9）。

---

## 1. 执行综述

### 1.1 总体执行方式

HP2 采用**先建 control-plane API 与 alias/detail truth → 再接 runtime requested/effective/fallback audit → 最后补 `<model_switch>` / stream event / e2e / closure** 的顺序。先把用户可见的“当前模型是谁”定成稳定产品面，再去接 runtime 与 D1 audit，能避免实现者继续沿用“从 message body 猜当前模型”的旧路径；而把 `<model_switch>` 与 `model.fallback` 放在后半段，则能确保它们消费的 already-written requested/effective state 是同一套真相。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Control Plane Surface | M | 建立 `/sessions/{id}/model`、`/models/{id}`、alias/detail 读模型 | `-` |
| Phase 2 | Runtime State Wiring | M | 把 session default / turn override / effective / fallback 接进 runtime 与 D1 audit | Phase 1 |
| Phase 3 | Switch Semantics + Fallback Event | S | 冻结 `<model_switch>` 与 `model.fallback` 可见语义 | Phase 2 |
| Phase 4 | E2E + Closure | S | 完成 5+ e2e、prompt 验证与 HP2 closure | Phase 1-3 |

### 1.3 Phase 说明

1. **Phase 1 — Control Plane Surface**
   - **核心目标**：让 model picker 第一次拥有 session-level API 与 model detail API。
   - **为什么先做**：没有 control plane，后续 runtime audit 仍会退化成“只在内部多写几列”。
2. **Phase 2 — Runtime State Wiring**
   - **核心目标**：把 session default、turn override、effective model、fallback reason 接到 LLM request 主线和 D1 turn/session truth。
   - **为什么放在这里**：只有 API 与 alias/detail 已定型后，runtime 才不会继续走 infer-only 分叉。
3. **Phase 3 — Switch Semantics + Fallback Event**
   - **核心目标**：冻结 `<model_switch>` 与 `model.fallback` 的用户可见行为。
   - **为什么放在这里**：它们必须建立在 requested/effective/fallback audit 已经可靠的前提上。
4. **Phase 4 — E2E + Closure**
   - **核心目标**：证明 API、D1 audit、stream event 与 prompt 语义三层对齐。
   - **为什么最后**：e2e 与 closure 必须对撞已经落地的 control plane 与 runtime 行为。

### 1.4 执行策略说明

- **执行顺序原则**：先产品面后 runtime、先 detail/alias 再 fallback、先 durable truth 再 stream 语义。
- **风险控制原则**：不在 HP2 越界做 multi-provider / pricing / compact 细节；所有 schema 缺口只能回到 HP1 correction law。
- **测试推进原则**：orchestrator-core + agent-core 单测/集成测试之外，必须补 cross-e2e，覆盖 reasoning↔non-reasoning、vision↔non-vision、131K↔24K、alias、fallback。
- **文档同步原则**：closure 必须同时记录 API verdict、D1 audit verdict、stream event verdict 与 prompt 注入 verdict。
- **回滚 / 降级原则**：若 fallback 不满足 capability law 或 fallback model 也失败，直接 surface error，不伪装成 fallback success。

### 1.5 本次 action-plan 影响结构图

```text
hero-to-pro HP2 model state machine
├── Phase 1: Control Plane Surface
│   ├── workers/orchestrator-core/src/index.ts
│   ├── /models/{id}
│   └── /sessions/{id}/model
├── Phase 2: Runtime State Wiring
│   ├── workers/orchestrator-core/src/user-do/{session-flow,message-runtime}.ts
│   ├── workers/agent-core/src/llm/{canonical,request-builder,gateway}.ts
│   └── HP1 session/turn/model durable columns
├── Phase 3: Switch Semantics + Fallback Event
│   ├── <model_switch> developer message
│   └── packages/nacp-session/src/stream-event.ts
└── Phase 4: E2E + Closure
    ├── test/cross-e2e/**
    └── docs/issue/hero-to-pro/HP2-closure.md
```

### 1.6 已核对的当前代码锚点

1. **协议层已能承载 turn-level 模型输入**
   - `packages/nacp-session/src/messages.ts:43-52,119-136`
   - `SessionStartBodySchema`、`SessionFollowupInputBodySchema`、`SessionMessagePostBodySchema` 已支持 `model_id` / `reasoning`。
2. **public ingress 仍只是入口，不是模型控制面**
   - `workers/orchestrator-core/src/session-lifecycle.ts:41-57`
   - `workers/orchestrator-core/src/user-do/session-flow.ts:342-347,445-454`
   - `workers/orchestrator-core/src/user-do/message-runtime.ts:134-161,243-245,296-310`
   - `/messages` 已有 gate 与 forward，但 session-level current model API 仍不存在。
3. **当前 `/models` 只有 list，没有 detail/current-model**
   - `workers/orchestrator-core/src/index.ts:1347-1419`
   - 现在只查询 `nano_models` 的基础字段，且只返回 team-filtered list。
4. **LLM canonical / builder / gateway 已有底层 seams，但仍偏 infer-only**
   - `workers/agent-core/src/llm/canonical.ts:67-78`
   - `workers/agent-core/src/llm/request-builder.ts:57-121`
   - `workers/agent-core/src/llm/gateway.ts:165-231`
   - canonical request 已有 `model` / `reasoning`，builder 已做 reasoning/vision/tool/jsonSchema capability 校验，但 gateway 仍主要从 messages / fallback 参数推断 model。
5. **当前没有 `model.fallback` stream kind**
   - `packages/nacp-session/src/stream-event.ts:81-107`
   - 现有 registry 只有 `compact.notify` 等事件，HP2 需要新增 fallback 事件。
6. **外部 precedent 已核对并支持 HP2 的四层模型状态机边界**
   - `context/codex/codex-rs/app-server/src/codex_message_processor.rs:7018-7028`, `context/codex/codex-rs/protocol/src/models.rs:471-474`, `context/codex/codex-rs/core/src/codex.rs:3954-3961`, `context/claude-code/utils/model/model.ts:49-98`, `context/claude-code/query.ts:572-578,659-670,894-897`, `context/gemini-cli/packages/core/src/config/config.ts:1872-1898`, `context/gemini-cli/packages/core/src/services/modelConfigService.ts:16-40,56-80,116-125,149-215,268-328,341-389`
   - precedent 共同说明 requested / current / effective / fallback / `<model_switch>` 必须分层表达；HP2 只吸收状态机与审计边界，不引入 multi-provider routing 或 UI 级 `/model` 细节。

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 四层模型状态机：`global default → session default → turn override → effective + fallback`。
- **[S2]** `GET /sessions/{id}/model` / `PATCH /sessions/{id}/model` 与 `GET /models/{id}`。
- **[S3]** alias resolve、requested/effective/fallback D1 audit、team policy gate 与 clear 语义。
- **[S4]** `<model_switch>` developer message 与 `model.fallback` stream event。
- **[S5]** 5+ e2e 与 HP2 closure。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** multi-provider routing、fallback chain、多层 provider policy。
- **[O2]** pricing/quota/admin-plane 字段与 per-team billing 逻辑。
- **[O3]** HP3 的 compact / window governance / strip-recover 执行逻辑。
- **[O4]** checkpoint / restore / fork / file revert。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| `PATCH /sessions/{id}/model` 的 clear 语义 | `in-scope` | Q7 已冻结必须支持 `{ model_id: null }` | 仅在协议层冻结被正式修订时重评 |
| fallback 做成链式 | `out-of-scope` | Q8 明确第一版只做单层 | hero-to-platform routing phase |
| 仅 reasoning effort 变化是否注入 `<model_switch>` | `out-of-scope` | Q9 明确只 audit effort，不注入 `<model_switch>` | 未来若 QNA 重开 |
| compact 前的 model switch strip/recover | `defer / depends-on-HP3` | HP2 只冻结 `<model_switch>` 语义，执行逻辑由 HP3 消费 | HP3 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | model detail API | `update` | `workers/orchestrator-core/src/index.ts` | 让 `/models` 从 list 升级到 list + detail | `medium` |
| P1-02 | Phase 1 | session current model API | `update` | `workers/orchestrator-core/src/index.ts`, ingress/runtime files | 让 session default 成为独立产品面 | `medium` |
| P1-03 | Phase 1 | alias resolve + clear semantics | `update` | orchestrator-core handlers + HP1 metadata truth | 让 alias 和 clear 恢复默认模型变成第一类行为 | `medium` |
| P2-01 | Phase 2 | requested/effective/fallback durable audit | `update` | `workers/orchestrator-core/src/user-do/{session-flow,message-runtime}.ts` | 每个 turn 都能反查 requested/effective/fallback 事实 | `high` |
| P2-02 | Phase 2 | canonical request explicit model wiring | `update` | `workers/agent-core/src/llm/{canonical,request-builder,gateway}.ts` | 从 infer-only 升级到 control-plane 驱动的显式 request | `high` |
| P3-01 | Phase 3 | `<model_switch>` developer message | `update` | request assembly path, agent-core runtime | 让跨模型切换成为 LLM 可见语义 | `medium` |
| P3-02 | Phase 3 | `model.fallback` stream event | `update` | `packages/nacp-session/src/stream-event.ts`, server push path | 让 fallback 成为用户可见事实 | `medium` |
| P4-01 | Phase 4 | cross-e2e matrix | `add` | `test/cross-e2e/**` | 用端到端场景证明模型控制面真实闭环 | `medium` |
| P4-02 | Phase 4 | HP2 closure | `update` | `docs/issue/hero-to-pro/HP2-closure.md` | 让 HP3/HP9 能直接消费 HP2 结果 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Control Plane Surface

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | model detail API | 在当前 `/models` list 基础上新增 `GET /models/{id}`，暴露 HP1 落地的 10 个 metadata 字段与 alias 信息；detail 不得绕过 team deny policy | `workers/orchestrator-core/src/index.ts`, HP1 model truth | `/models` 不再只有粗列表 | orchestrator-core test | detail 能返回 model metadata + alias；denied/disabled model 有明确错误 |
| P1-02 | session current model API | 新增 `GET /sessions/{id}/model` / `PATCH /sessions/{id}/model`，读取和修改 session durable default model / reasoning effort | `workers/orchestrator-core/src/index.ts`, session truth wiring | session default 成为独立产品面 | 同上 | GET/PATCH live；ended/expired session 不可修改 |
| P1-03 | alias resolve + clear semantics | 在 PATCH 和 runtime gate 前先 alias resolve；支持 `{ model_id: null }` 清回 global default | API handlers + model lookup path | alias 与 clear 成为第一类控制面行为 | 同上 | clear 不污染 durable truth；alias 不绕过 team deny |

### 4.2 Phase 2 — Runtime State Wiring

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | requested/effective/fallback durable audit | `recordTurnStart()` 写 requested model / effort；turn 结束回填 effective model / fallback_used / fallback_reason；未显式 override 时继承 session default，再落到 global default | `workers/orchestrator-core/src/user-do/{session-flow,message-runtime}.ts` | D1 能反查每个 turn 的模型事实 | orchestrator-core test + D1 assertions | requested/effective/fallback 三态都能被 durable truth 解释 |
| P2-02 | canonical request explicit model wiring | 不再仅靠 message infer model；把 session default / turn override 明确送进 canonical request 与 execution request，仍复用现有 reasoning/vision capability 校验 | `workers/agent-core/src/llm/{canonical,request-builder,gateway}.ts` | runtime request 与产品状态机同真相 | agent-core test | 显式 model/reasoning wiring 生效；capability error 不被伪装 |

### 4.3 Phase 3 — Switch Semantics + Fallback Event

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | `<model_switch>` developer message | 检测 effective model 与上一有效模型是否不同；不同则在 canonical request 前注入 `<model_switch>` developer message；仅 reasoning effort 变化不注入 | request assembly path | 跨模型切换不再是 silent swap | agent-core/orchestrator-core test + prompt verification | cross-turn 模型切换时 prompt 中可见 `<model_switch>` |
| P3-02 | `model.fallback` stream event | 第一版仅 single-step fallback；触发时写 D1 audit + emit `model.fallback` event；fallback model 也必须再次走 capability law | `packages/nacp-session/src/stream-event.ts`, push path | fallback 成为可见且可审计事实 | runtime test + stream assertions | event payload 与 D1 audit shape 对齐；fallback model 失败时 surface error |

### 4.4 Phase 4 — E2E + Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | cross-e2e matrix | 覆盖 reasoning↔non-reasoning、vision↔non-vision、131K↔24K、alias resolve、single-step fallback 至少 5 个 cross-e2e；建议文件名使用 `model-switch-reasoning` / `model-switch-vision` / `model-window-switch` / `model-alias-resolve` / `model-fallback` 描述性前缀；若采用编号文件，必须为 HP5 预留 `15-18` | `test/cross-e2e/**` | model control plane 在真实链路中闭环 | `pnpm test:cross-e2e` | 5+ e2e 全绿，且覆盖 API + D1 + stream/prompt 三层 |
| P4-02 | HP2 closure | 回填 API verdict、D1 audit verdict、fallback/event verdict、`<model_switch>` prompt verdict，并显式登记 F1-F17 chronic status（`closed / partial / not-touched / handed-to-platform`） | `docs/issue/hero-to-pro/HP2-closure.md` | HP3/HP9 可直接消费 HP2 输出 | doc review | closure 能独立回答“模型控制面是否已成产品面” |

---

## 5. Phase 详情

### 5.1 Phase 1 — Control Plane Surface

- **Phase 目标**：让 session current model 与 model detail 成为独立产品面。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/index.ts`
  - 可能涉及 session model lookup / route helper 所在模块
- **本 Phase 已核对的源码锚点**：
  - `workers/orchestrator-core/src/index.ts:1347-1419`
  - `packages/nacp-session/src/messages.ts:43-52,119-136`
- **具体功能预期**：
  1. `GET /models/{id}` 能暴露 HP1 metadata + alias，而不只是复用 list shape。
  2. `GET/PATCH /sessions/{id}/model` 能让客户端读取/修改 session default。
  3. clear 语义 `{ model_id: null }` 合法且可恢复 global default。
- **具体测试安排**：
  - **单测**：orchestrator-core route / policy tests。
  - **集成测试**：detail/current-model API tests。
  - **回归测试**：`pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - list/detail/current-model 三面语义无冲突。
  - alias/clear 不会污染或绕过 session durable truth。
- **本 Phase 风险提醒**：
  - 如果 API 先天没有 clear 语义，client 以后会被迫自己模拟“恢复默认”，这会永久制造行为漂移。

### 5.2 Phase 2 — Runtime State Wiring

- **Phase 目标**：把 session default / turn override / effective / fallback 接到 LLM request 与 D1 audit 主线。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/user-do/session-flow.ts`
  - `workers/orchestrator-core/src/user-do/message-runtime.ts`
  - `workers/agent-core/src/llm/canonical.ts`
  - `workers/agent-core/src/llm/request-builder.ts`
  - `workers/agent-core/src/llm/gateway.ts`
- **本 Phase 已核对的源码锚点**：
  - `workers/orchestrator-core/src/user-do/message-runtime.ts:134-161,243-245,296-310`
  - `workers/agent-core/src/llm/canonical.ts:67-78`
  - `workers/agent-core/src/llm/request-builder.ts:57-121`
  - `workers/agent-core/src/llm/gateway.ts:165-231`
- **具体功能预期**：
  1. requested model / effort 在 turn start 时被 durable 记录。
  2. effective model / fallback_used / fallback_reason 在 turn end 时回填。
  3. canonical request 不再靠 message infer-only，而是显式吃到 session default / turn override。
- **具体测试安排**：
  - **单测**：orchestrator-core D1 audit tests、agent-core llm seam tests。
  - **集成测试**：requested/effective/fallback D1 assertions。
  - **回归测试**：
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - requested/effective/fallback 三态可在 D1 中对撞。
  - reasoning/vision capability law 仍复用现有 request-builder，不被绕开。
- **本 Phase 风险提醒**：
  - 如果 runtime 仍保留 infer-only 支路，session current model API 会很快退化成“看起来能改，实际上不一定生效”。

### 5.3 Phase 3 — Switch Semantics + Fallback Event

- **Phase 目标**：让跨模型切换与 fallback 成为可见、可解释、可审计的行为。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 修改文件**：
  - request assembly / runtime path
  - `packages/nacp-session/src/stream-event.ts`
  - 可能涉及 server frame push 的 orchestrator/agent path
- **本 Phase 已核对的源码锚点**：
  - `workers/agent-core/src/llm/request-builder.ts:57-121`
  - `packages/nacp-session/src/stream-event.ts:81-107`
- **具体功能预期**：
  1. effective model 与上一 turn 不同才注入 `<model_switch>`。
  2. 仅 reasoning effort 变化不注入 `<model_switch>`，但 effort audit 仍保留。
  3. fallback 触发时出现 `model.fallback` stream event，且 payload 与 D1 audit 一致。
- **具体测试安排**：
  - **单测**：`<model_switch>` injection tests、stream event schema tests。
  - **集成测试**：fallback event + D1 audit 对撞。
  - **回归测试**：
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
  - **手动验证**：prompt verification（确认 LLM request 可见 `<model_switch>`）。
- **收口标准**：
  - `<model_switch>` 语义与 Q9 完全一致。
  - `model.fallback` 事件不是可有可无的 best-effort，而是与 D1 audit 同步的正式事实。
- **本 Phase 风险提醒**：
  - HP2 只负责冻结 `<model_switch>` 语义，不能把 HP3 的 strip/recover 执行逻辑偷塞进本 phase。

### 5.4 Phase 4 — E2E + Closure

- **Phase 目标**：证明 API、D1、stream/prompt 三层是一致的。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 新增文件**：
  - `test/cross-e2e/**`（新增 5+ 用例）
- **本 Phase 修改文件**：
  - `docs/issue/hero-to-pro/HP2-closure.md`
- **具体功能预期**：
  1. reasoning↔non-reasoning、vision↔non-vision、131K↔24K、alias、fallback 至少 5 个端到端场景可重现。
  2. HP2 closure 能独立说明“当前模型控制面是否已成为产品面”。
- **具体测试安排**：
  - **单测**：无新增单测为主。
  - **集成测试**：跨 worker API + runtime + D1 audit。
  - **回归测试**：
    - `pnpm test:cross-e2e`
    - 受影响 worker 的 `typecheck build test`
  - **手动验证**：closure 对照 e2e 结果回填。
- **收口标准**：
  - 5+ e2e 全绿。
  - closure 对 requested/effective/fallback、`<model_switch>`、detail/current-model API 都给出明确 verdict。
- **本 Phase 风险提醒**：
  - 如果 e2e 只测 endpoint 200，而不看 prompt/D1/stream 三层，则 HP2 很容易出现 deceptive closure。

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q7 — 必须引入 session default | `docs/design/hero-to-pro/HPX-qna.md` | 决定 HP2 必须同时做 `/sessions/{id}/model` 与四层优先级，不得退化成 turn-only | 若执行期想回退 turn-only，必须退回 design/QNA |
| Q8 — fallback 先做单层 | `docs/design/hero-to-pro/HPX-qna.md` | 决定 `model.fallback` 与 D1 audit 只表达 single-step fallback | 若未来要链式 routing，进入 hero-to-platform |
| Q9 — `<model_switch>` 在 HP2 冻结 | `docs/design/hero-to-pro/HPX-qna.md` | 决定 HP2 负责注入 contract，HP3 只 strip/recover | 若 HP3 需要改语义，必须回到 HPX-qna |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| HP1 依赖未闭合 | HP2 依赖 HP1 的 metadata / alias / session-turn audit 列 | `high` | HP2 不得偷偷补 schema；若有缺口，只能走 HP1 correction |
| runtime 仍保留 infer-only | 旧代码路径可能继续从 messages 猜 model | `high` | 把 explicit model wiring 作为 Phase 2 硬目标 |
| fallback 与 policy gate 脱节 | alias/policy 只校验 requested，不校验 fallback | `medium` | fallback model 也必须再次经过 metadata + capability + policy law |
| HP2/HP3 边界漂移 | 容易把 compact / strip-recover 执行细节塞进 HP2 | `medium` | 只冻结 `<model_switch>` contract，compact 执行交给 HP3 |

### 7.2 约束与前提

- **技术前提**：HP1 已提供 `nano_models` richer metadata、alias 表、session/turn model audit 列。
- **运行时前提**：继续复用现有 request-builder capability law，不重写 reasoning/vision/tool 校验。
- **组织协作前提**：HP2 不重开 Q7-Q9；若模型控制面边界被推翻，必须回 design/QNA。
- **上线 / 合并前提**：API、D1 audit、stream/prompt、cross-e2e 四层证据齐全。

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/hero-to-pro/HP3-context-state-machine.md`（仅当 HP2 最终冻结语义导致其引用需要回填）
- 需要同步更新的说明文档 / README：
  - `docs/issue/hero-to-pro/HP2-closure.md`
- 需要同步更新的测试说明：
  - `test/index.md` 或相关 worker test README（若新增 e2e 入口说明）

### 7.4 完成后的预期状态

1. session 当前模型会成为独立 API，而不是藏在 message body 里的临时字段。
2. requested / effective / fallback 三态会在 D1 中可追溯，在 stream/prompt 中可见。
3. `<model_switch>` 会成为稳定 contract，HP3 可以直接围绕它做 strip/recover。
4. HP9 的 `models.md` / `session.md` 与 manual evidence 会第一次拥有可核对的模型控制面事实。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - 检查 `/models/{id}`、`GET/PATCH /sessions/{id}/model` 已存在且不绕过 auth/policy。
  - 检查 `packages/nacp-session/src/stream-event.ts` 已新增 `model.fallback` 正式 kind。
- **单元测试**：
  - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
  - `pnpm --filter @haimang/agent-core-worker typecheck build test`
- **集成测试**：
  - API + D1 audit + stream event / prompt verification
- **端到端 / 手动验证**：
  - `pnpm test:cross-e2e`
- **回归测试**：
  - reasoning↔non-reasoning、vision↔non-vision、131K↔24K、alias、fallback 至少 5 场景
- **前序 phase 回归**：
  - 至少回归 HP0 的三入口 model field/body law 与 `withNanoAgentSystemPrompt(modelId?)` seam，避免 HP2 wiring 把 HP0 已修好的入口一致性重新打破。
- **文档校验**：
  - `docs/issue/hero-to-pro/HP2-closure.md` 必须同时记录 API / D1 / stream / prompt 四层 verdict
  - `docs/issue/hero-to-pro/HP2-closure.md` 必须显式登记 F1-F17 chronic status

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. session current model API 与 model detail API 已 live。
2. D1 turn/session truth 能反查 requested / effective / fallback 事实。
3. fallback 触发时有 `model.fallback` stream event，跨模型切换时 prompt 可见 `<model_switch>`。
4. 5+ cross-e2e 全绿，且 closure 已清楚写出 HP2 的最终 verdict。
5. HP2 closure 已显式声明 F1-F17 的 phase 状态，不把 chronic 判定留到后续 phase 猜测。
5. HP2 closure 已显式声明 F1-F17 的 phase 状态，不把 chronic 判定留到后续 phase 猜测。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | 模型控制面已从 list/message 参数升级为 session current model + detail + fallback 语义 |
| 测试 | orchestrator-core / agent-core 测试通过，cross-e2e 覆盖 5+ 场景 |
| 文档 | HP2 closure 能独立解释 API、D1、stream、prompt 四层结果 |
| 风险收敛 | multi-provider / pricing / compact 边界未被 HP2 误吸收 |
| 可交付性 | HP3 可以直接在 HP2 已冻结的 `<model_switch>` 与 model metadata 之上继续实现 |

## 11. 工作日志回填

1. 重新对照 charter / design / Q7-Q9 / HP3-HP4 closure 与真实代码，确认 HP1 schema 已有 session/turn model audit 基线，但缺 `fallback_reason`，按 charter §7.2 R8 补出 `014-session-model-fallback-reason.sql` 作为 HP1 correction。
2. 在 `workers/orchestrator-core/src/session-truth.ts` 收敛 model control-plane 真相源：新增 team-scoped active model list、alias/detail resolve、global default 选取、session model state 视图、latest turn model audit 与 session default update。
3. 在 façade `workers/orchestrator-core/src/index.ts` 落地 `GET /models/{id}`、`GET /sessions/{id}/model`、`PATCH /sessions/{id}/model`，并把 `/models` list 升级为返回 alias 集的 control-plane catalog。
4. 在 `workers/orchestrator-core/src/user-do/{session-flow,message-runtime}.ts` 接上 `turn override > session default > global default`；`/start` 显式模型会写 session default，follow-up turn 会把 requested/effective model + reasoning 落入 durable turn truth。
5. 为兼容当前 schema reality，reasoning remap 采用 `supported_reasoning_levels` 的首优先级作为 server-side normalized effort；这解决了“unsupported effort 不能 silent drop”的冻结要求，但并不等价于未来 per-model default_reasoning_effort。
6. 新增 / 更新测试：`test/models-route.test.ts`、`test/session-model-route.test.ts`、`test/migrations-schema-freeze.test.ts`，并完整回归 `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`。
7. 本轮明确收口的是 **HP2 first wave / partial-live**：session/model control plane、alias/detail、requested/effective audit、schema correction 已 live；`<model_switch>`、`model.fallback` stream event、agent-core 侧更深 request assembly 与 cross-e2e 继续留在后续批次。
