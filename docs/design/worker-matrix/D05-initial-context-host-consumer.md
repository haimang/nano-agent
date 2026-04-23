# D05 — `initial_context` host consumer 接线(含 dedicated root e2e)

> 功能簇: `worker-matrix / initial-context-consumer`
> 讨论日期: `2026-04-23`
> 讨论者: `Claude Opus 4.7 (1M context)`
> 关联调查报告:
> - `docs/plan-worker-matrix.md` §4.1、§5.3 P2.A-P2.B、§6.2 P2 DoD(含 GPT R2 dedicated e2e)、§7 Q2
> - `docs/eval/worker-matrix/cross-worker-interaction-matrix.md` §3.2("highest-value unresolved cross-worker responsibility")
> - `docs/plan-worker-matrix-reviewed-by-GPT.md` §2 R2、§5.2 Q2
> - `docs/design/pre-worker-matrix/W3-absorption-map.md`
> - `docs/design/worker-matrix/D03-context-core-absorption-and-posture.md`(`appendInitialContextLayer` API owner)
> - `docs/design/worker-matrix/D01-agent-core-absorption.md`(host shell 落点)
> 文档状态: `draft`

---

## 0. 背景与前置约束

`SessionStartInitialContextSchema` + `SessionStartBodySchema.initial_context` 在 `@haimang/nacp-session@1.3.0` 中已冻结为 shipped wire schema,但当前仓库实测:

```
grep "initial_context" packages/session-do-runtime/src/
```

**host 侧无消费路径**。`NanoSessionDO.dispatchAdmissibleFrame` 在 `session.start` 分支只抽 `turn_input`,不读 `body.initial_context`。

本设计负责把这个 "wire-shipped but no consumer" 的 gap 闭合,并补一个 **dedicated root e2e 测试**(per GPT R2)证明闭环成立。

- **项目定位回顾**:`initial_context` 是 session 启动时,upstream(e.g. 产品前端)把"本轮初始上下文"传给 session 的 wire hook。consumer 归 `agent.core` host。
- **本次讨论的前置共识**:
  - `appendInitialContextLayer(...)` API owner = `context.core`(D03 F4 已冻结 shape)
  - host consumer = `NanoSessionDO.dispatchAdmissibleFrame` 的 `session.start` 分支(`agent.core`)
  - schema 解析由 `nacp-session::validateSessionFrame` + `SessionStartInitialContextSchema` 承担,本设计不重解
  - P2.F2 要求 **dedicated** root e2e 验证 payload 真被消费且影响 assembled prompt / context evidence
- **显式排除的讨论范围**:
  - `appendInitialContextLayer` 的 context 侧实现(D03)
  - default composition 升级(D06)
  - `tool.call.*` 闭环验证(D07 / P2.F1)
  - 多 layer / 优先级 / 覆盖策略的扩展(保留为未来 charter)

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**:`initial_context host consumer wiring + dedicated root e2e`
- **一句话定义**:在 `workers/agent-core/src/host/do/nano-session-do.ts` 的 `dispatchAdmissibleFrame` `session.start` 分支,新增 `body.initial_context` 的消费路径:解析后调 context.core 的 `appendInitialContextLayer`,让 payload 真的影响后续 assembled prompt / context evidence;并补一个 root e2e 证明闭环成立。
- **边界描述**:
  - **包含**:host consumer 接线代码(~10-30 行新增)+ dedicated root e2e test + `packages/session-do-runtime` 内等价 test 升级
  - **不包含**:context 侧 API 实现(D03 F4)、composition 其他 handle(D06)、multi-layer 优先级 / 覆盖语义
- **关键术语对齐**:

| 术语 | 定义 |
|------|------|
| `SessionStartBodySchema.initial_context` | `@haimang/nacp-session` 中 session.start 的 body 可选字段;其 shape 由 `SessionStartInitialContextSchema` 定义 |
| `appendInitialContextLayer` | context.core public API;`(assembler, payload) => void` |
| `dispatchAdmissibleFrame` | `NanoSessionDO` 的 frame 分派函数;`session.start` 分支是 consumer 落点 |
| dedicated root e2e | 独立于 `tool.call.*` e2e 的一个 e2e;只验证 `initial_context` 闭环 |
| assembled prompt 变化 | consumer 生效的可观测信号:layers stack 增加 / prompt content 含 payload 语义 / evidence 产出 AssemblyEvidence 含 initial_context 标识 |

### 1.2 参考调查报告

- `packages/nacp-session/src/frame.ts` — `SessionStartInitialContextSchema` 定义
- `packages/session-do-runtime/src/do/nano-session-do.ts:608-645` — 当前 `dispatchAdmissibleFrame` 实现(无 consumer)
- `docs/design/worker-matrix/D03-context-core-absorption-and-posture.md` F4 — `appendInitialContextLayer` API shape
- `docs/plan-worker-matrix-reviewed-by-GPT.md` §2 R2 — dedicated e2e 要求
- `docs/eval/worker-matrix/cross-worker-interaction-matrix.md` §3.2

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **架构角色**:闭合 pre-worker-matrix 遗留的 "wire shipped but consumer missing" 真相层缺口;它是 first-wave **最重要的非 remote cross-worker 责任**
- **服务于**:所有需要 "session 启动时带初始上下文" 的 upstream caller、后续 D06 composition 里 assembler 的消费方
- **依赖**:D03 F4(`appendInitialContextLayer` API shape 已冻结)、D01 F1 已把 host shell 搬进 `workers/agent-core/src/host/`、W0 shipped nacp-session 1.3.0
- **被谁依赖**:P2 DoD(GPT R2 dedicated e2e)、charter §9 exit criteria primary #1 里 "session.start → initial_context consumer → context.core assembly" 链路

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|----------|----------|------|
| D01 agent.core absorption | 上游 | 强 | D01 F1 host shell 搬家后,本设计在 `workers/agent-core/src/host/do/nano-session-do.ts` 里加 consumer |
| D03 context.core absorption | 上游 | 强 | D03 F4 已冻结 `appendInitialContextLayer` API;本设计直接 call |
| D06 default composition | 同周期 | 中 | D06 在 composition 里挂 context handle;本设计的 consumer 调用需要能拿到 assembler |
| D07 agent↔bash activation | 无直接 | 弱 | 本设计与 `tool.call.*` 解耦;两者是 P2 不同 e2e |
| W0 nacp-session schema | 参考 | 强 | `SessionStartInitialContextSchema` 已冻结,不改 |
| B7 LIVE contract | 非破坏 | 弱 | B7 LIVE 不直接涉及 initial_context,但本设计 PR 需保证 5 tests 全绿 |

### 2.3 一句话定位陈述

> "在 nano-agent 里,`initial_context host consumer` 是 **worker-matrix P2 的最重要非 remote cross-worker 责任闭合**,负责 **在 agent-core host 里把 session.start.body.initial_context 从被忽略的 wire 字段升级成真实被 context.core 消费的 layer 输入,并由一个 dedicated root e2e 证明 payload 的语义影响了后续 assembled prompt / context evidence**,对上游(产品前端 / SDK)提供 **"session 启动携带初始上下文" 承诺的真实兑现**,对下游(D06 composition / context.core assembler)要求 **shape-stable 的 layer push API(已由 D03 F4 冻结)**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点

| 被砍项 | 来源 | 砍的理由 | 未来回补 |
|--------|------|----------|----------|
| 多 initial_context layer 优先级 / 覆盖规则 | "更灵活" | payload 已是结构化 layer;首波按 append 即可;优先级需独立 RFC | 否(需要时单独 charter)|
| 在 host 侧重做 schema 校验 | "防御性" | `validateSessionFrame` 已在 ingress 做过 | 否 |
| 本设计内同步实现 `restoreVersion` 或其他 async-compact 语义 | 顺手完成 | D03 out-of-scope;分开干净 | 否 |
| 多次 session.start 的 initial_context 合并语义 | "多轮场景" | session 生命周期内 start 只一次;不越位 | 否 |
| 对 initial_context 做缓存 / persistence | "断线重连" | host 已有 checkpoint/replay glue;不另造 | 否 |

### 3.2 接口保留点

| 扩展点 | 表现形式 | 第一版行为 | 未来演进 |
|--------|----------|------------|----------|
| `appendInitialContextLayer(assembler, payload)` | context.core 侧 API | D03 F4 冻结 | 多调用 / 优先级 / 替换策略 |
| `dispatchAdmissibleFrame` session.start 分支消费顺序 | 本设计引入的 `before extractTurnInput` 调用点 | 先消费 initial_context,后 `extractTurnInput` | 若未来出现 `session.start` 额外字段,可继续在同一分支追加消费 |
| e2e test helper `makeInitialContextSessionStart` | root test 新 helper | 接受 payload,构造带 `body.initial_context` 的 session.start frame | 后续可复用于其他 initial_context 变体测试 |

### 3.3 完全解耦点

- **解耦对象**:consumer 接线代码(host 侧)vs `appendInitialContextLayer` 实现(context.core 侧)
- **解耦原因**:API owner 归 D03;host 只 call;两者 PR 可独立,只要 shape 冻结
- **依赖边界**:host 侧只要求 shape;context 侧实现变化不影响 host consumer

### 3.4 聚合点

- **聚合对象**:`dispatchAdmissibleFrame` session.start 分支作为 initial_context 消费唯一入口
- **聚合形式**:单一 consumer;不允许 ingress / WS controller 分别消费
- **为什么不能分散**:payload 只有一次被 consume 的有效时机(session 初始化)

---

## 4. 三个代表实现对比(内部 precedent)

### 4.1 B9 `initial_context` wire freeze

- **实现概要**:B9 把 `SessionStartInitialContextSchema` 冻结到 `@haimang/nacp-session`
- **借鉴**:schema shape 不改;schema 解析由 `validateSessionFrame` 承担
- **不照抄**:B9 只冻结 wire;本设计闭合 consumer 侧

### 4.2 `turn_input` consumer pattern(现有)

- **实现概要**:`dispatchAdmissibleFrame` 在 session.start 分支调 `extractTurnInput`
- **借鉴**:consumer 在 session.start 分支的位置 / 模式;本设计在 `extractTurnInput` **之前** 加 `initial_context` 消费
- **不照抄**:`turn_input` 驱动 kernel turn;`initial_context` 只 push layer,不驱动 turn

### 4.3 `hook.*` consumer pattern(已 live)

- **实现概要**:host dispatches `hook.emit` → remote HOOK_WORKER → `hook.outcome` 回来
- **借鉴**:consumer 闭环的 test 构造方式(root e2e 带真实 frame)
- **不照抄**:hook 是 remote worker;本设计是 in-process context layer push

### 4.4 横向对比

| 维度 | B9 wire freeze | turn_input consumer | hook pattern | **D05** |
|------|---------------|--------------------|--------------|---------|
| 位置 | schema | session.start 分支 | multi-frame | **session.start 分支(在 turn_input 之前)** |
| 结果 | shipped wire | kernel turn 启动 | remote dispatch | **assembler layer push** |
| 是否有 remote | 否 | 否 | 是 | **否(in-process)** |
| 是否需要 e2e | 否 | 有现有 tests | 有 | **需要 dedicated e2e(per GPT R2)** |

---

## 5. In-Scope / Out-of-Scope

### 5.1 In-Scope

- **[S1]** 在 `workers/agent-core/src/host/do/nano-session-do.ts` 的 `dispatchAdmissibleFrame` `session.start` 分支,在 `extractTurnInput` 调用 **之前**,新增如下消费路径:
  1. 从 `body` 读 `initial_context`(可选字段)
  2. 若存在:通过 composition 拿到 assembler handle,调 `appendInitialContextLayer(assembler, body.initial_context)`
  3. 若不存在:no-op(保持 backward-compat)
- **[S2]** 共存期:在 `packages/session-do-runtime/src/do/nano-session-do.ts` 里也补同样 consumer(P1.A 共存期内原 package 与 workers/agent-core 并行;同一 logic 两处落);后续由 D09 随原 package deprecate 统一删
- **[S3]** 新增 **dedicated root e2e test**(per GPT R2):
  - 路径:`test/initial-context-live-consumer.test.mjs`(或等价 `.test.ts` 按现有 root test 约定)
  - 场景:构造 `session.start` frame 带 `initial_context` payload → 通过 WS ingress 进入 DO → 验证 assembler layers stack / assembled prompt / context evidence 有 initial_context 的可观测痕迹
  - 断言至少 3 条:(a) no throw;(b) assembler layers 数 +1;(c) `buildAssemblyEvidence` / 等价 evidence 输出含 initial_context 标识(via layer kind 或 tag)
- **[S4]** package-local test 在 `packages/session-do-runtime` / `workers/agent-core` 都覆盖 consumer 行为(unit level,补充根级 e2e)
- **[S5]** PR body 内附带 P2 prerequisite check:D01 F1(host shell 已搬)+ D03 F4(API shape 已冻结)+ D06(default composition 已能给 consumer 拿到 assembler handle)

### 5.2 Out-of-Scope

- **[O1]** `appendInitialContextLayer` context.core 侧实现(D03 F4)
- **[O2]** default composition 的 kernel/llm/capability 装配(D06)
- **[O3]** multi-start / re-start 时的 initial_context 合并策略
- **[O4]** initial_context persistence / checkpoint 重放时的还原
- **[O5]** initial_context schema 扩展(归 nacp-session 后续 RFC)
- **[O6]** `tool.call.*` e2e(P2.F1)— 本设计只做 F2 dedicated e2e
- **[O7]** local-ts fallback seam(P2.F3 / D07)
- **[O8]** initial_context 对 agent.core 以外 worker 的直接可见性(context 消费后不回流)

### 5.3 边界清单

| 项目 | 判定 | 理由 |
|------|------|------|
| consumer 调用在 `extractTurnInput` 之前还是之后 | `in-scope 之前` | layer push 要在 kernel turn 启动前完成;否则 assembler 已被 kernel 消费 |
| 若 `appendInitialContextLayer` throw(异常 payload),host 如何处理 | `in-scope 降级` | catch + honest error frame(`{kind: "system.notify", severity: "error"}`)返回;不 abort DO |
| `extractTurnInput` 原签名改动 | `out-of-scope` | byte-identical 纪律 |
| e2e 是否走真实 preview deploy | `out-of-scope` | root e2e 用 in-process mock runtime(Miniflare / local DO stub)即可 |
| 本设计是否在 PR 内 flip D03 `appendInitialContextLayer` 为 real implementation | `out-of-scope` | D03 PR owner 实现 |
| host 内 consume 后是否 emit 额外 evidence | `in-scope optional` | 若 assembler 本身 emit `buildAssemblyEvidence` 已覆盖,则 no-op;否则补一条 AssemblyEvidence |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**:consumer 放在 `dispatchAdmissibleFrame` 的 `session.start` 分支(host DO),不在 ingress / WS controller
   - **为什么**:admissible legality 已完成;ingress 层面不负责业务 consumer;host DO 是 composition 所在
   - **代价**:消费时点略晚(frame 已通过 legality gate)
   - **缓解**:time-wise 仍早于 `extractTurnInput`,对 kernel turn 无影响

2. **取舍 2**:dedicated root e2e(per GPT R2)而非仅 package-local test
   - **为什么**:cross-worker-interaction-matrix §3.2 明确 initial_context 是 first-wave 最重要非 remote gap;没有 root e2e 等于只验证 API shape
   - **代价**:增加 root test 文件一个,CI 增加数秒
   - **缓解**:root test harness 已有(B7 LIVE 等);增量开销可控

3. **取舍 3**:共存期 host consumer 两处落(packages/ + workers/)
   - **为什么**:P1.A A1 搬家后,`packages/session-do-runtime` 与 `workers/agent-core/src/host/` 共存 ~3 个月;consumer 漏在任一处都会有 bug
   - **代价**:两份 duplicate 代码
   - **缓解**:D09 随 deprecate 时清理 `packages/` 侧

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解 |
|------|----------|------|------|
| `appendInitialContextLayer` 异常 payload → host DO 崩 | payload 形状意外 | session 启动失败 | catch + `system.notify` severity=error honest frame;DO 不崩 |
| consumer 在 D03 F4 ship 前提前写 | D05 PR 先于 D03 PR | API 未冻结 | PR review gate:D05 PR 必须 reference 已 merged 的 D03 F4 commit |
| root e2e 依赖 preview deploy(重) | e2e 要求 live env | CI 变慢 | 用 Miniflare / in-process DO stub;无 preview 依赖 |
| `extractTurnInput` 被 initial_context 消费污染(顺序错位)| consumer 在 turn_input 之后 | 初始 layer 被 kernel 忽略 | code review + test 覆盖调用顺序 |
| assembled prompt 无可观测变化(consumer 生效但 assembly 未发 evidence)| evidence emit 漏 | e2e 断言 (c) fail | 要求 `appendInitialContextLayer` 或 assembler 在首次 assemble 时 emit AssemblyEvidence 含 initial_context tag |
| 共存期两处 consumer 代码 drift | 只改一处 | behavior 分叉 | W3 pattern §6 共存期 bug 先修原包;D09 随 deprecate 清理 |

### 6.3 价值

- **对开发者自己**:首波最大非 remote gap 闭合;`initial_context` 不再是 "wire shipped 但没人用" 的僵尸字段
- **对 nano-agent 长期演进**:session 启动 upstream → host → context 这条关键 handoff 路径正式成立
- **对 "上下文管理 / Skill / 稳定性" 杠杆**:
  - 上下文管理:直接受益 — session-scoped 初始上下文真正进入 assembly layers
  - Skill:未来 skill 初始化可沿用同 pattern(skill 自己的 wire hook)
  - 稳定性:dedicated e2e 让 consumer 路径在 CI 里持续 battle-test

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | host consumer 接线(workers 侧) | `workers/agent-core/src/host/do/nano-session-do.ts::dispatchAdmissibleFrame` session.start 分支新增消费路径 | ✅ consumer 代码在 `extractTurnInput` 之前调 `appendInitialContextLayer`(payload 可选);catch + honest error |
| F2 | host consumer 接线(packages 侧,共存期) | 同 logic 落 `packages/session-do-runtime/src/do/nano-session-do.ts` | ✅ 两处 consumer 行为一致 |
| F3 | dedicated root e2e(per GPT R2) | `test/initial-context-live-consumer.test.mjs`(或等价) | ✅ 3 条断言全绿;in-process runtime 足矣,不依赖 preview deploy |
| F4 | package-local unit tests | 覆盖 consumer 行为:正常 payload / 缺字段 / 异常 payload | ✅ 3 个 case package-local test 全绿 |
| F5 | honest error 处理 | `appendInitialContextLayer` throw 时走 `system.notify` severity=error frame(`session.stream.event` 9-kind 合法 union;不自造 kind) | ✅ 断言:DO 不崩;client 收到 `system.notify` 且 `severity === "error"` body |
| F6 | 调用顺序固化 | consumer 在 `extractTurnInput` 之前 | ✅ code review + test 明确顺序 |

### 7.2 详细阐述

#### F1: host consumer 接线(workers 侧)

- **输入**:`body` 已由 `validateSessionFrame` 解析(含 optional `initial_context: SessionStartInitialContext`);composition handle(assembler)来自 `this.composition?.workspace?.assembler`(D06 提供,实际由 `WorkspaceCompositionHandle.assembler` 暴露,挂在 `subsystems.workspace` 下,不是顶层 handle)
- **输出**:新增约 10-25 行代码在 `dispatchAdmissibleFrame` `session.start` 分支
- **核心逻辑**:
  ```ts
  const assembler = this.composition?.workspace?.assembler;
  if (body.initial_context && assembler) {
    try {
      appendInitialContextLayer(assembler, body.initial_context);
    } catch (err) {
      // 走合法的 9-kind `session.stream.event`:`system.notify` + severity=error
      // 不自造 `system.error` kind(nacp-session schema 里不存在)
      await this.pushStreamEvent({
        kind: "system.notify",
        severity: "error",
        message: `initial_context_consumer_error: ${serializeError(err)}`,
      });
      // 不 abort turn;continue with empty initial context
    }
  }
  // 然后进入 extractTurnInput
  ```
- **边界情况**:
  - `body.initial_context === undefined` → 跳过(backward-compat)
  - composition 还没装配(首波 degrade 路径)→ 跳过 + 记 evidence `initial_context_consumer_skipped_no_composition`
- **一句话收口目标**:✅ **`dispatchAdmissibleFrame` session.start 分支在 `extractTurnInput` 之前有 consumer 调用;异常走 honest error**

#### F2: host consumer 接线(packages 侧,共存期)

- **输入**:F1 相同 logic
- **输出**:同 diff 落 `packages/session-do-runtime/src/do/nano-session-do.ts`
- **核心逻辑**:两处 byte-identical logic
- **边界情况**:PR 内同步改两处,避免 drift
- **一句话收口目标**:✅ **packages 与 workers 两处 consumer 行为一致**

#### F3: dedicated root e2e(per GPT R2)

- **输入**:测试 payload(`SessionStartInitialContext` 结构化对象,含 1 个 example layer)、in-process test harness
- **输出**:新增 root test 文件
- **核心逻辑**:
  1. 起一个 in-process DO stub(Miniflare / mock);注入 composition with real `ContextAssembler` + BoundedEvalSink
  2. 发送 `session.start` frame,body 含 `initial_context: { layers: [{...}] }`
  3. 断言:
     - (a) 无异常 frame 返回,session 成功 start
     - (b) assembler 当前 layers 数 >= `initialLayers + 1`(payload 被 append)
     - (c) BoundedEvalSink 累计一条 AssemblyEvidence,且其 payload / tags 含 initial_context 标识(例如 `layer_kind === "initial_context"`)
  4. 附带一个 negative case:`body.initial_context === undefined` → assembler layers 数不变
- **边界情况**:
  - test 需在 `workers/agent-core` 吸收后仍绿 — harness 设计要能同时 run packages 版和 workers 版 consumer(两个 suite 或参数化)
- **一句话收口目标**:✅ **`test/initial-context-live-consumer.test.mjs`(或等价)3 条断言全绿;negative case 覆盖**

#### F4: package-local unit tests

- **输入**:单元 mock assembler + mock composition
- **输出**:`packages/session-do-runtime/test/do/initial-context-consumer.test.ts` + `workers/agent-core/test/host/initial-context-consumer.test.ts`
- **核心逻辑**:3 case:normal / missing field / throw
- **一句话收口目标**:✅ **3 case 全绿**

#### F5: honest error 处理

- **输入**:F1 catch 分支
- **输出**:`system.notify` severity=error frame 发给 client;DO 继续 session
- **核心逻辑**:走合法 9-kind 的 `system.notify`(`severity: "error"` + 描述性 `message`);**不**自造 `system.error` kind(`SessionStreamEventBodySchema` 中不存在);scope / reason 由 `message` 文本承载(例如 `initial_context_consumer_error: <detail>`)
- **一句话收口目标**:✅ **DO 不崩;client 收到 `{kind: "system.notify", severity: "error"}` body 可诊断;9-kind schema 合法**

#### F6: 调用顺序固化

- **输入**:F1 实现
- **输出**:`dispatchAdmissibleFrame` 内 `initial_context` 消费出现在 `extractTurnInput` 之前
- **核心逻辑**:code-level comment + review 强制
- **一句话收口目标**:✅ **grep 验证:`appendInitialContextLayer(` 行号 < `extractTurnInput(` 行号**

### 7.3 非功能性要求

- **性能目标**:consumer 调用是本地 in-process 操作;< 1ms overhead per session.start
- **可观测性要求**:至少一条 AssemblyEvidence 反映 initial_context 被消费(避免 silent success)
- **稳定性要求**:B7 LIVE 5 tests 仍全绿;异常 payload 不崩 DO
- **测试覆盖要求**:F3 root e2e + F4 unit tests

---

## 8. 可借鉴的代码位置清单

### 8.1 现有 nano-agent 代码

| 位置 | 内容 | 借鉴点 |
|------|------|--------|
| `packages/session-do-runtime/src/do/nano-session-do.ts:608-645` | `dispatchAdmissibleFrame` 当前实现 | F1 / F2 consumer 落点 |
| `packages/nacp-session/src/frame.ts` | `SessionStartInitialContextSchema` | payload shape |
| `packages/workspace-context-artifacts/src/context-assembler.ts` | `ContextAssembler.assemble(...)` | assembler handle 类型来源 |
| `packages/session-do-runtime/src/composition.ts` | `createDefaultCompositionFactory()` | composition handle 提供 |
| `test/b7-round2-integrated-contract.test.mjs` | root e2e 模板 | F3 harness 模板 |

### 8.2 W0 / B9 precedent

| 位置 | 内容 | 借鉴点 |
|------|------|--------|
| B9 `initial_context` wire freeze PR | schema 冻结 | shape 不改 |
| W0 evidence vocabulary | AssemblyEvidence 生成 | F3 断言 (c) 证据来源 |

### 8.3 必须避开的反例

| 位置 | 问题 | 避开理由 |
|------|------|----------|
| 在 WS ingress / HTTP controller 层直接 consume `initial_context` | 破坏 legality / composition 边界 | consumer 归 host DO |
| `appendInitialContextLayer` 直接在 D05 PR 内加 side-effect evidence | 越位 D03 | D03 F4 决定 |
| e2e 依赖 preview deploy | CI 慢 + 脆 | in-process 足矣 |
| consumer 在 `extractTurnInput` 之后 | layer 被 kernel 忽略 | 顺序错 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

D05 是 P2 的小而关键交付物:约 30-80 行 consumer 代码 + 1 个 dedicated root e2e + 3 个 unit tests,闭合 first-wave 最重要的非 remote cross-worker 责任。共存期两处 consumer(packages + workers);D09 deprecate 时清理。风险主要在 assembler handle 获取路径(D06 composition 未升级前可能 undefined;F1 degrade 路径已覆盖)。

### 9.2 Value Verdict

| 维度 | 评级 | 说明 |
|------|------|------|
| 贴合度 | **5** | first-wave 最重要的非 remote gap(cross-worker-interaction-matrix §3.2)|
| 性价比 | **5** | 极小代码 + 高杠杆 |
| 对 "上下文管理 / Skill / 稳定性" 杠杆 | **5** | 上下文管理直接受益;root e2e 持续守护 |
| 开发者友好度 | **5** | 单一入口;逻辑清晰 |
| 风险可控 | **5** | unit + e2e + honest error;共存期纪律明确 |
| **综合价值** | **5.0** | P2 必做;GPT R2 明确补充 |

### 9.3 下一步行动

- [ ] **决策确认**:owner approve;D05 PR 作者 claim(建议与 D06 同期作者)
- [ ] **关联 PR**:D03 F4 先 merge → D06 composition 升级 → D05 PR merge(最后到 packages 侧同步)
- [ ] **待深入调查**:
  - D06 composition 升级前,degrade 路径(`this.composition?.workspace?.assembler === undefined`)是否需要特殊处理?(建议:F1 中 no-op + evidence 即可;P2 完成前 degrade 可容忍)
  - 多次 `session.start` 重发(边缘重连场景)是否会多 push layer?(建议:重发在 DO 层已有 de-dup;本设计不额外处理)

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-23 | Claude Opus 4.7 | 初稿;基于 charter + GPT R2 + 交互矩阵 §3.2 编制 |
| v0.2 | 2026-04-23 | Claude Opus 4.7 | 吸收 D01-D09 GPT review R1(assembler 落点 `this.composition?.workspace?.assembler`,不新增 top-level handle)+ R2(`system.error` → `system.notify` severity=error,按 `SessionStreamEventBodySchema` 9-kind 合法 union 落地)|
