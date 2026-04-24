# F2 — Session Seam Completion

> 服务业务簇: `orchestration-facade / F2 / session-seam-completion`
> 计划对象: `把 first-wave session lifecycle、WS、input/status/timeline/verify 补成完整 façade seam`
> 类型: `upgrade`
> 作者: `GPT-5.4`
> 时间: `2026-04-24`
> 文件位置: `docs/action-plan/orchestration-facade/F2-session-seam-completion.md`
> 关联设计 / 调研文档:
> - `docs/plan-orchestration-facade.md`
> - `docs/action-plan/orchestration-facade/F1-bringup-and-first-roundtrip.md`
> - `docs/design/orchestration-facade/F0-stream-relay-mechanism.md`
> - `docs/design/orchestration-facade/F0-user-do-schema.md`
> - `docs/design/orchestration-facade/F0-session-lifecycle-and-reconnect.md`
> - `docs/design/orchestration-facade/F0-compatibility-facade-contract.md`
> - `docs/design/orchestration-facade/FX-qna.md`
> 文档状态: `executed`

---

## 0. 执行背景与目标

F1 只证明 narrow roundtrip 可行；F2 的任务是把 façade 从“能转发一次 start”推进到 **具备完整 first-wave session seam** 的状态。这个周期要补全的不是“大而全的产品 API”，而是 charter 已冻结的那一组 first-wave session-facing surface：WS attach/reconnect、input/cancel、status/timeline、verify、initial_context、terminal result 与 retention。

F2 完成后，`orchestrator.core` 才能被视为真正的 session owner；否则它依然只是一个能够“代理 start”的瘦 façade。这里的重点仍是 **façade ownership**：当前不少 runtime lifecycle / WS / verify 语义已经存在于 `agent-core`，但 F2 要把这些语义以 façade-owner 的方式接管、对齐并给出 public evidence，而不是重写一套新的 runtime loop。

- **服务业务簇**：`orchestration-facade / F2`
- **计划对象**：`Session Seam Completion`
- **本次计划解决的问题**：
  - `F1 之后 façade 仍缺少完整 lifecycle / reconnect / terminal law`
  - `public surface 还未覆盖 first-wave 全部 session-facing routes`
  - `user DO registry / cursor / retention 尚未形成可依赖的完整行为`
- **本次计划的直接产出**：
  - `完整 first-wave public session routes`
  - `single active writable attachment + reconnect taxonomy`
  - `session lifecycle / terminal / retention 的真实代码与测试证据`

---

## 1. 执行综述

### 1.1 总体执行方式

采用 **先补 registry/lifecycle，再补 public route family，再补 WS/reconnect，最后补 terminal/retention/tests** 的方式推进。F2 的重点不是增加更多 worker，而是让 `orchestrator.core` 真正承担起 façade 侧 session owner 责任。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | lifecycle 与 registry 补全 | `L` | 把 session entry / terminal / retention 变成真实行为 | `F1 closed` |
| Phase 2 | public route family completion | `L` | 补 `input/cancel/status/timeline/verify` façade 路径 | `Phase 1` |
| Phase 3 | WS attach / reconnect | `L` | 单写 attachment、typed supersede、success/terminal/missing | `Phase 2` |
| Phase 4 | stream/terminal 稳定化 | `M` | terminal mapping、cursor/resume、terminal attach rejection | `Phase 3` |
| Phase 5 | tests、closure 与 F3 交接 | `M` | package-e2e / integration evidence + F2 closure | `Phase 4` |

### 1.3 Phase 说明

1. **Phase 1 — lifecycle 与 registry 补全**
   - **核心目标**：让 D5/D6 不只是设计，而是真实 registry law
   - **为什么先做**：没有 registry/lifecycle，后面的 WS/reconnect 只会变成脆弱逻辑
2. **Phase 2 — public route family completion**
   - **核心目标**：把 first-wave 规定的 HTTP surface 补齐
   - **为什么放在这里**：先有内部 owner/state，再开放更多 façade 路径
3. **Phase 3 — WS attach / reconnect**
   - **核心目标**：实现 single-writer attach、typed supersede、typed terminal reject
   - **为什么放在这里**：WS 行为必须依赖稳定 registry 与 public route owner
4. **Phase 4 — stream/terminal 稳定化**
   - **核心目标**：把 cursor、terminal mapping、terminal result 彻底对齐
   - **为什么放在这里**：只有 WS/reconnect 已接上，terminal 与 cursor 才有真实消费者
5. **Phase 5 — tests、closure 与 F3 交接**
   - **核心目标**：形成 F2 closure，并给 F3 提供可迁移的 façade baseline
   - **为什么放在最后**：cutover 只能建立在完整 session seam 之上

### 1.4 执行策略说明

- **执行顺序原则**：`先 owner/state，再 route，再 WS/reconnect，再 terminal 稳定化`
- **风险控制原则**：`不偷渡 multi-attachment / read-only mirror / history archive`
- **测试推进原则**：`先 worker/integration，再 package-e2e；为 F3 保留 live cutover 任务`
- **文档同步原则**：`F2 closure 与 F3 inventory/compat contract 必须同步校准`

### 1.5 本次 action-plan 影响目录树

```text
F2 Session Seam Completion
├── workers/orchestrator-core/
│   ├── src/index.ts
│   ├── src/ingress/*
│   ├── src/user-do/*
│   └── src/ws/*
├── workers/agent-core/
│   └── src/host/internal/*
├── test/package-e2e/orchestrator-core/
│   ├── 03-ws-attach.test.mjs
│   ├── 04-reconnect.test.mjs
│   └── 05-verify-status-timeline.test.mjs
├── test/shared/live.mjs
└── docs/issue/orchestration-facade/F2-closure.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** lifecycle states、terminal mapping、ended-session retention 的真实落地
- **[S2]** `input/cancel/status/timeline/verify` façade route completion
- **[S3]** public WS attach/reconnect、single active writable attachment、typed supersede
- **[S4]** cursor/resume、terminal attach rejection、F2 closure

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** multi-writer / read-only mirror attachment
- **[O2]** partial replay / richer replay protocol
- **[O3]** full history archive / SQLite / richer memory domain
- **[O4]** F3 canonical cutover 与 legacy hard deprecation

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| read-only mirror | `out-of-scope` | D6 已明确延后 | `下一阶段 richer orchestrator` |
| terminal 只读查询 | `in-scope` | terminal 仍需 status/timeline/read-after-end | `F2 执行期` |
| `session.end` richer semantics | `defer` | 当前只需 terminal result，不扩产品语义 | `下一阶段 public API` |
| cross-e2e canonical cutover | `out-of-scope` | F3 才统一迁入口 | `F3` |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | SessionEntry 行为完整化 | `update` | `orchestrator-core user DO` | 在 F1 初始 entry 之上补齐状态流转，不再扩字段 | `high` |
| P1-02 | Phase 1 | ended retention | `update` | `user DO cleanup` | `24h + 100` 双上限变成真实行为 | `medium` |
| P2-01 | Phase 2 | façade input/cancel | `update` | `src/ingress/*` | input/cancel 进入 façade | `high` |
| P2-02 | Phase 2 | façade status/timeline/verify | `update` | `src/ingress/*` | 只读与 verify 路由完成 | `medium` |
| P3-01 | Phase 3 | WS attach | `add` | `src/ws/*` | façade 成为 canonical attach owner | `high` |
| P3-02 | Phase 3 | reconnect taxonomy | `update` | `user DO + ws` | success/terminal/missing 被断言 | `high` |
| P4-01 | Phase 4 | terminal mapping | `update` | `stream relay + lifecycle` | stream terminal 与 lifecycle.status 一致 | `medium` |
| P4-02 | Phase 4 | terminal / missing attach rejection | `update` | `ws upgrade flow` | retention 窗口内 terminal 与 purge 后 missing 被明确区分 | `medium` |
| P5-01 | Phase 5 | façade package-e2e 扩面 | `add` | `orchestrator-core/03-05*` | F2 行为有最小 live evidence | `medium` |
| P5-02 | Phase 5 | F2 closure + probe rollover | `add/update` | `docs/issue/orchestration-facade/F2-closure.md` `workers/orchestrator-core/src/index.ts` | 解锁 F3，并把 orchestrator probe marker bump 到 F2 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — lifecycle 与 registry 补全

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | SessionEntry 行为完整化 | 在 F1 已写入的 `created_at / last_seen_at / status / last_phase / relay_cursor / ended_at` 形状上补齐真实状态流转与默认值语义，不再新增字段 | `orchestrator-core/src/user-do/*` | lifecycle owner 成立 | unit/integration tests | schema 与 D5/D6 对齐，F2 不再做 schema 扩列 |
| P1-02 | ended retention | 实现 `24h + 100` 双上限 retention 与 purge policy | `user DO cleanup` | terminal metadata 有边界 | unit tests | bounded retention 可被断言 |

### 4.2 Phase 2 — public route family completion

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | façade input/cancel | 让 `input/cancel` 经 orchestrator 进入 internal runtime | `src/ingress/*` `agent internal routes` | turn follow-up/cancel 成为 façade 行为 | integration tests | input/cancel 不再绕过 façade |
| P2-02 | façade status/timeline/verify | 提供 façade 所有权下的 read/verify 入口；`verify` 只做 JWT ingress + authority translation 后 forward 到 agent internal verify；`initial_context` seed builder 采用 JWT claim 直映射（`realm_hints / source_name / default_layers=[] / user_memory_ref=null`） | `src/ingress/*` | first-wave route family 基本补齐 | integration tests | status/timeline/verify 可断言，且 verify 不发明 orchestrator 私有检查 |

### 4.3 Phase 3 — WS attach / reconnect

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | WS attach | 让 `/sessions/:id/ws` 由 orchestrator 接管，并由 user DO 负责 attachment 替换顺序：先发 `attachment_superseded`，再 server-close，最后切换 active attachment | `src/ws/*` `user DO` | façade 成为 canonical attach owner | integration / package-e2e | attach 成立，supersede 顺序稳定 |
| P3-02 | reconnect taxonomy | 实现 success/terminal/missing 分支；其中 `terminal` = retention 窗口内 ended entry 仍在 registry，`missing` = registry 无 entry（从未 mint 或已 purge） | `src/ws/*` `user DO` | reconnect 行为可预测 | integration / package-e2e | 3 分支与 supersede 都可断言 |

### 4.4 Phase 4 — stream/terminal 稳定化

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | terminal mapping | 将 `completed/cancelled/error` 映射到 lifecycle `ended` 与 client-visible terminal result | `stream relay + user DO` | D3/D6 语义在代码层闭合 | integration tests | mapping 不再漂移 |
| P4-02 | terminal / missing attach rejection | retention 窗口内 ended session 新 attach 返回 typed `session_terminal`；purged / no-entry session 返回 typed `session_missing` | `ws upgrade flow` | ended 与 purged 语义不再混淆 | package-e2e | `session_terminal` / `session_missing` 都可断言 |

### 4.5 Phase 5 — tests、closure 与 F3 交接

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | façade e2e 扩面 | 新增 `03-ws-attach` / `04-reconnect` / `05-verify-status-timeline` | `test/package-e2e/orchestrator-core/*` | F2 有最小 live proof | live e2e | F2 核心行为有证据 |
| P5-02 | F2 closure | 写清 first-wave session seam 已补齐、F3 可切 cutover | `docs/issue/orchestration-facade/F2-closure.md` | F3 有明确入口 | 文档 review | F2 正式闭合 |

---

## 5. Phase 详情

### 5.1 Phase 1 — lifecycle 与 registry 补全

- **Phase 目标**：让 façade 的 session owner 身份从设计词汇变成真实状态机
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 新增文件**：
  - `workers/orchestrator-core/src/user-do/cleanup.ts`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/user-do/*.ts`
- **具体功能预期**：
  1. SessionEntry 在 F1 初始形状上完整表达 starting/active/detached/ended，而不是继续扩字段
  2. `tenant_source`、`relay_cursor`、`ended_at` 等必要元数据可被保存
  3. ended retention 有明确 purge 纪律
- **具体测试安排**：
  - **单测**：`registry update / retention tests`
  - **集成测试**：`session lifecycle transitions`
  - **回归测试**：`orchestrator-core tests`
  - **手动验证**：`检查 storage 中 session entry 形状`
- **收口标准**：
  - registry 与 D5/D6 完整对齐
  - retention 可被机械断言
- **本 Phase 风险提醒**：
  - 最容易把 registry 做成 runtime timeline copy

### 5.2 Phase 2 — public route family completion

- **Phase 目标**：补齐 first-wave façade HTTP surface
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/ingress/*.ts`
  - `workers/agent-core/src/host/internal/*.ts`
- **具体功能预期**：
  1. input/cancel 统一走 façade owner
  2. status/timeline/verify 有 façade-level typed 行为，`verify` 只做 façade forward，不发明私有 checks
  3. `initial_context/seed` 由 JWT claims 直映射生产，不引入额外存储查询
- **具体测试安排**：
  - **单测**：`route handlers`
  - **集成测试**：`follow-up / verify / status / timeline`
  - **回归测试**：`orchestrator-core + agent-core package tests`
  - **手动验证**：`同一 session 完成多步调用`
- **收口标准**：
  - HTTP surface 与 charter first-wave 对齐
  - 无直接绕过 façade 的 public path
- **本 Phase 风险提醒**：
  - 最容易让 `verify` 重新变成 agent-core 特权入口

### 5.3 Phase 3 — WS attach / reconnect

- **Phase 目标**：把 façade 的 live session owner 身份补完整
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `workers/orchestrator-core/src/ws/*.ts`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/index.ts`
  - `workers/orchestrator-core/src/user-do/*.ts`
- **具体功能预期**：
  1. `/sessions/:id/ws` 由 orchestrator 接管
  2. user DO 先向旧 attachment 发送 `attachment_superseded`，再关闭旧连接并切换 active attachment
  3. reconnect result taxonomy 可预测，且 `terminal` / `missing` 与 retention / purge 语义分离
- **具体测试安排**：
  - **单测**：`ws attachment manager`
  - **集成测试**：`attach / reconnect / supersede`
  - **回归测试**：`orchestrator-core package tests`
  - **手动验证**：`双 attachment 行为`
- **收口标准**：
  - single active writable attachment 成立
  - reconnect 的 3 种结果都能断言
- **本 Phase 风险提醒**：
  - 最容易把 superseded 行为做成静默断开

### 5.4 Phase 4 — stream/terminal 稳定化

- **Phase 目标**：闭合 terminal、cursor 与 attach 之间的所有语义缝隙
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/ws/*`
  - `workers/orchestrator-core/src/user-do/*`
- **具体功能预期**：
  1. terminal frame 到 lifecycle/status 的映射稳定
  2. ended session 新 attach 与 purged session re-attach 被明确区分
  3. cursor/resume 不再 off-by-one
- **具体测试安排**：
  - **单测**：`terminal mapping / cursor tests`
  - **集成测试**：`terminal after cancel / complete / error`
  - **回归测试**：`orchestrator-core tests`
  - **手动验证**：`ended session re-attach smoke`
- **收口标准**：
  - terminal / cursor / attach 三层口径统一
  - 不再存在 overloaded `ended`
- **本 Phase 风险提醒**：
  - 最容易出现 99% 正常、1% 丢帧的 cursor bug

### 5.5 Phase 5 — tests、closure 与 F3 交接

- **Phase 目标**：证明 façade 已具备完整 first-wave session seam
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 新增文件**：
  - `test/package-e2e/orchestrator-core/03-ws-attach.test.mjs`
  - `test/package-e2e/orchestrator-core/04-reconnect.test.mjs`
  - `test/package-e2e/orchestrator-core/05-verify-status-timeline.test.mjs`
  - `docs/issue/orchestration-facade/F2-closure.md`
- **本 Phase 修改文件**：
  - `test/shared/live.mjs`
- **具体功能预期**：
  1. attach/reconnect/verify/status/timeline 有 live evidence
  2. F2 closure 清楚说明 F3 可开始 cutover，并同步把 orchestrator probe marker bump 到 `orchestration-facade-F2`
  3. F3 不需要再回头发明 session law
- **具体测试安排**：
  - **单测**：`无新增`
  - **集成测试**：`session lifecycle integration`
  - **回归测试**：`relevant package tests + façade live suite`
  - **手动验证**：`WS attach/reconnect smoke + probe marker rollover`
- **收口标准**：
  - façade 已可被视作完整 first-wave session owner
  - orchestrator probe marker 已切到 `orchestration-facade-F2`
  - F2 closure 解锁 F3
- **本 Phase 风险提醒**：
  - 最容易在未完成 F2 就急着做 F3 live cutover

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 当前结论

本阶段 **无新增 owner-level blocker**。  
Q3 / Q4 / Q7 / Q8 等与 F2/F3 相关的 frozen answers 已在 `FX-qna.md` 给定，F2 直接按其执行。

### 6.2 问题整理建议

- terminal result 是否附带 `last_phase` 可在实现时决定，不阻塞 F2
- 若 partial replay 被证明必须存在，应作为下一阶段议题，不回灌 F2

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| façade lifecycle 未闭合 | 容易只做 route，不做 owner/state | `high` | Phase 1 必须先做 registry/lifecycle |
| WS 行为静默漂移 | attach/reconnect 容易以“看起来能用”为准 | `high` | 用 typed supersede / terminal reject / taxonomy 固定行为 |
| retention 失控 | 没有 cleanup 纪律会让 user DO 膨胀 | `medium` | 采用 `24h + 100` 双上限 |

### 7.2 约束与前提

- **技术前提**：`F1 已证明 narrow roundtrip 成立`
- **运行时前提**：`orchestrator-core 与 agent-core 已能通过 internal start/stream 交互`
- **组织协作前提**：`F2 不跳过 F3 去做 cutover，也不跳过 F4 去做法律收口`
- **上线 / 合并前提**：`attach / reconnect / terminal read 行为都要有真实测试证据`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/orchestration-facade/F0-user-do-schema.md`
  - `docs/design/orchestration-facade/F0-session-lifecycle-and-reconnect.md`
- 需要同步更新的说明文档 / README：
  - `workers/orchestrator-core/README.md`
- 需要同步更新的测试说明：
  - `test/shared/live.mjs`

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `façade full first-wave route family 基本齐备`
  - `registry / cursor / retention 与 design 一致`
- **单元测试**：
  - `user DO lifecycle / ws attachment / cleanup tests`
- **集成测试**：
  - `input/cancel/status/timeline/verify + reconnect flows`
- **端到端 / 手动验证**：
  - `orchestrator-core attach/reconnect/terminal smoke`
- **回归测试**：
  - `relevant worker tests + façade package-e2e`
- **文档校验**：
  - `F2 closure 与 F3 action-plan 边界一致`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `façade 已具备完整 first-wave session seam`
2. `single active writable attachment 已真实成立`
3. `success/terminal/missing reconnect taxonomy 可被断言`
4. `terminal mapping / retention / cursor 语义已闭合`
5. `reconnect purged session -> session_missing` 可被断言
6. `F2-closure.md` 已正式解锁 F3，且 probe marker 已 rollover

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `first-wave session owner 语义已由 orchestrator-core 完整承担` |
| 测试 | `worker/integration/package-e2e 对 lifecycle/WS/terminal 有证据` |
| 文档 | `F2 closure 与相关设计文档保持一致` |
| 风险收敛 | `不再存在 attach/reconnect/terminal 的隐含语义` |
| 可交付性 | `F3 可以在完整 façade seam 上做 cutover` |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`Phase 3/4 可能因 WS 与 cursor 细节明显放大`
- **哪些编号的拆分还不够合理**：`如 terminal 与 reconnect 总被一起返工，可进一步细拆`
- **哪些问题本应更早问架构师**：`若 F2 仍出现多 attachment 或 replay 新问题，说明 design 粒度还不够`
- **哪些测试安排在实际执行中证明不够**：`若 package-e2e 仍不足以支撑 F3，应提前增强 façade suite`
- **模板本身还需要补什么字段**：`future 可增加 “state machine transitions” 专门表格`

---

## 10. 结语

这份 action-plan 以 **把 `orchestrator.core` 真正补成 first-wave session owner** 为第一优先级，采用 **先 registry/lifecycle、再 route family、再 WS/reconnect、最后 terminal 稳定化** 的推进方式，优先解决 **façade 仍然过瘦** 与 **attach/reconnect/terminal 语义尚未闭合** 两个问题，并把 **不偷渡 multi-attachment、partial replay、history archive** 作为主要约束。整个计划完成后，`orchestration-facade / F2` 应达到 **完整 first-wave session seam 已成立** 的状态，从而为后续的 **F3 canonical cutover 与 legacy retirement** 提供稳定基础。

---

## 11. 工作日志回填（executed）

### 11.1 执行结果总览

- **结论**：F2 已完成，`orchestrator-core` 现已具备 first-wave session seam 的完整 public owner 形态。
- **核心变化**：不再只有 `start` 一条窄通路；`input/cancel/status/timeline/verify/ws` 全部已经进 façade，user DO 也拥有 lifecycle、retention、WS supersede 与 reconnect 基础纪律。

### 11.2 本轮新增 / 重点修改文件

1. `workers/orchestrator-core/src/user-do.ts`
2. `workers/orchestrator-core/src/index.ts`
3. `workers/orchestrator-core/src/auth.ts`
4. `workers/orchestrator-core/test/smoke.test.ts`
5. `workers/orchestrator-core/test/user-do.test.ts`
6. `workers/agent-core/src/host/internal.ts`
7. `workers/agent-core/test/smoke.test.ts`
8. `test/package-e2e/orchestrator-core/01-preview-probe.test.mjs`
9. `test/package-e2e/orchestrator-core/02-session-start.test.mjs`
10. `test/package-e2e/orchestrator-core/03-ws-attach.test.mjs`
11. `test/package-e2e/orchestrator-core/04-reconnect.test.mjs`
12. `test/package-e2e/orchestrator-core/05-verify-status-timeline.test.mjs`
13. `docs/issue/orchestration-facade/F2-closure.md`

### 11.3 实际完成的工作项

1. **P1-01 / P1-02 — lifecycle 与 retention**
   - user DO 现在真正维护 `SessionEntry` 状态流转，而不是只写一次 start shell。
   - ended metadata 采用 `24h + 100` 双上限 lazy cleanup，并将 terminal metadata 独立收口。
2. **P2-01 / P2-02 — public route family completion**
   - `orchestrator-core` 已接住 `input/cancel/status/timeline/verify`。
   - `agent-core` guarded internal routes 扩到 `status/timeline/verify`，不再只够 F1 的 `start/input/cancel/stream`。
3. **P3-01 / P3-02 — WS attach / reconnect**
   - `/sessions/:id/ws` 已由 façade 接管。
   - user DO 现在执行 single active writable attachment；旧连接先收到 `attachment_superseded`，再被 server 关闭。
4. **P4-01 / P4-02 — terminal / missing discipline**
   - ended session 新 attach 返回 typed `session_terminal`。
   - registry 不存在时返回 typed `session_missing`。
   - start 完成后的 detached session 不再被错误映射成 terminal。
5. **P5-01 / P5-02 — tests / closure / probe rollover**
   - orchestrator probe marker 已切到 `orchestration-facade-F2`。
   - 新增 03/04/05 live tests，覆盖 ws attach、reconnect、route family。
   - 新增 `F2-closure.md`，明确 F3 可开始。

### 11.4 本轮关键修正与工程判断

1. F1 时 internal `stream` 的 terminal frame 被错误当成 session terminal；F2 已把“request 完成”与“session ended”从 façade lifecycle 角度重新分开。
2. `relay_cursor` 现在只在 façade 真正向 WS client forward event 时推进，不再把 HTTP start response 错记成 WS relay。
3. live WS supersede 测试暴露了一个真实细缝：旧 socket `close` 回调会把新 attachment 状态打回 `detached`。本轮已通过“先从 active map 移除，再 close 旧 socket”修复。
4. live `verify` truth 与 agent-core 既有行为对齐为 **HTTP 200 + body.error**，而不是错误地假设为 400。

### 11.5 Preview deploy 与 live 证据

1. `agent-core` preview 已重新部署：`https://nano-agent-agent-core-preview.haimang.workers.dev`
   - Version ID: `23ffe916-20bf-4d68-aaae-34bbcd980db3`
2. `orchestrator-core` preview 已部署 F2：`https://nano-agent-orchestrator-core-preview.haimang.workers.dev`
   - Version ID: `14596ab9-5645-45f9-9613-c87832c00465`
3. 本地验证已通过：
   - `pnpm --filter @haimang/orchestrator-core-worker typecheck`
   - `pnpm --filter @haimang/orchestrator-core-worker build`
   - `pnpm --filter @haimang/orchestrator-core-worker test`
   - `pnpm --filter @haimang/orchestrator-core-worker deploy:dry-run`
   - `pnpm --filter @haimang/agent-core-worker typecheck`
   - `pnpm --filter @haimang/agent-core-worker build`
   - `pnpm --filter @haimang/agent-core-worker test`
   - `pnpm --filter @haimang/agent-core-worker deploy:dry-run`
4. live 验证已通过：
   - `pnpm test:package-e2e` → `29/29`（仓库 package-e2e 汇总）
   - `pnpm test:cross` → `40/40`（仍主要覆盖 legacy `agent-core` ingress）
