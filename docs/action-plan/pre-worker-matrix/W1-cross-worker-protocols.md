# W1 — Cross-Worker Protocol Design

> 服务业务簇: `pre-worker-matrix / W1 / cross-worker-protocols`
> 计划对象: `产出 3 份方向性 RFC，而非协议代码`
> 类型: `new`
> 作者: `GPT-5.4`
> 时间: `2026-04-21`
> 文件位置: `docs/action-plan/pre-worker-matrix/W1-cross-worker-protocols.md`
> 关联设计 / 调研文档:
> - `docs/plan-pre-worker-matrix.md`
> - `docs/design/pre-worker-matrix/W1-cross-worker-protocols.md`
> - `docs/rfc/nacp-workspace-rpc.md`
> - `docs/rfc/remote-compact-delegate.md`
> - `docs/rfc/evidence-envelope-forwarding.md`
> - `docs/action-plan/pre-worker-matrix/W5-closure-and-handoff.md`
> 文档状态: `executed`

---

## 0. 执行背景与目标

W1 在经过 review 收窄后，已经不是“新增协议并 ship 代码”的 phase，而是 **RFC-only 的方向冻结 phase**。它的任务是把未来 cross-worker split 需要的 3 条通讯面——workspace RPC、remote compact delegate、evidence forwarding——写成方向性 RFC，明确未来应如何演进，同时明确为什么现在**不**该在 pre-worker-matrix 阶段写代码。

因此，这份 action-plan 的重点不是 schema 落地、matrix 注册或 helper 实装，而是：**把 W0 的既有 truth、今天的 in-process reality、以及 worker-matrix 之后的 remote 方向组织成可直接消费的 RFC baseline。**

- **服务业务簇**：`pre-worker-matrix / W1`
- **计划对象**：`Cross-Worker Protocol Triad RFC Set`
- **本次计划解决的问题**：
  - `future worker split 缺少协议方向基线`
  - `workspace / compact / evidence 三条 seam 还容易被各自私有化`
  - `worker-matrix 后续 phase 若无 RFC baseline 容易重发明协议`
- **本次计划的直接产出**：
  - `3 份 RFC markdown`
  - `W1 closure memo`
  - `对 W0/W3/W5 可直接引用的协议方向基线`

---

## 1. 执行综述

### 1.1 总体执行方式

采用 **先校对现有 contract reality，再对已存在的 3 份 RFC 做 revise / verify，最后做横向一致性核对** 的方式推进。W1 不写任何代码，因此核心是引用关系、边界表述和 deferred rationale 的精确性。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | 现状核对 | `S` | 对齐 W0 / 1.3.0 reality 与 3 条 seam 的当前状态 | `W0 design ready` |
| Phase 2 | RFC 修订与校准 | `M` | 对已存在的 3 份方向性 RFC 做 revise / verify | `Phase 1` |
| Phase 3 | 一致性收口 | `S` | 核对 W0/W3/W5 引用链并写 closure | `Phase 2` |

### 1.3 Phase 说明

1. **Phase 1 — 现状核对**
   - **核心目标**：确认哪些已有 contract 可直接复用，哪些只讨论方向
   - **为什么先做**：W1 的风险在于“凭想象设计协议”
2. **Phase 2 — RFC 修订与校准**
   - **核心目标**：对已存在的 workspace RPC / remote compact / evidence forwarding 三份 RFC 做 reality-driven revise
   - **为什么放在这里**：先有 reality，再校 RFC，才能避免旧 scope 残留和重复发明 family
3. **Phase 3 — 一致性收口**
   - **核心目标**：核对 W0 vocabulary、W3 blueprint、W5 closure predicate
   - **为什么放在这里**：W1 的价值在于成为下游 reference baseline，而不是孤立文档

### 1.4 执行策略说明

- **执行顺序原则**：`先 reality，再 RFC，最后 cross-doc consistency`
- **风险控制原则**：`明确 RFC-only，不偷渡 schema/helper/matrix code`
- **测试推进原则**：`以文档一致性检查替代代码测试`
- **文档同步原则**：`W1 RFC 与 W0/W3/W5 引用关系同步更新`

### 1.5 本次 action-plan 影响目录树

```text
W1 Cross-Worker Protocol Design
├── Phase 1: 现状核对
│   ├── packages/nacp-core/src/messages/
│   ├── packages/nacp-core/src/evidence/
│   └── docs/design/pre-worker-matrix/W1-cross-worker-protocols.md
├── Phase 2: RFC 起草
│   ├── docs/rfc/nacp-workspace-rpc.md
│   ├── docs/rfc/remote-compact-delegate.md
│   └── docs/rfc/evidence-envelope-forwarding.md
└── Phase 3: 一致性收口
    ├── docs/design/pre-worker-matrix/W3-absorption-*.md
    ├── docs/design/pre-worker-matrix/W5-closure-and-handoff.md
    └── docs/issue/pre-worker-matrix/W1-closure.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 核对 `context.compact.*`、`audit.record`、workspace 当前 reality 与 future seam 的关系
- **[S2]** revise / verify `nacp-workspace-rpc.md`
- **[S3]** revise / verify `remote-compact-delegate.md` 与 `evidence-envelope-forwarding.md`
- **[S4]** 核对 RFC 与 W0/W3/W5 的引用一致性并写 W1 closure

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 在 `nacp-core` 新增 workspace message schema、matrix entry、contract tests
- **[O2]** 实装 remote compact delegate helper
- **[O3]** 实装 evidence forwarding helper 或新 family
- **[O4]** 修改 worker shell / deploy / publish / package absorption

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `workspace.fs.*` family code | `out-of-scope` | 当前只冻结方向，不进入代码阶段 | `worker-matrix 后续 remote split phase` |
| `remote compact` 复用现有 family 的判断 | `in-scope` | 这是 RFC 的核心结论 | `W1 执行期` |
| `audit.record` 复用 evidence forwarding | `in-scope` | 这是 RFC 的核心结论 | `W1 执行期` |
| `tool.call.*` 修改 | `out-of-scope` | W1 与 tool path 正交 | `无` |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | compact reality 核对 | `update` | `nacp-core/messages/context.ts` | 证明无需新增 compact family | `medium` |
| P1-02 | Phase 1 | audit reality 核对 | `update` | `nacp-core/messages/system.ts` | 证明 evidence 可包进 audit.record | `medium` |
| P1-03 | Phase 1 | workspace reality 核对 | `update` | `workspace-context-artifacts` | 给 workspace RFC 提供 substrate anchor | `medium` |
| P2-01 | Phase 2 | workspace RFC revise / verify | `update` | `docs/rfc/nacp-workspace-rpc.md` | 冻结未来 workspace seam 方向 | `medium` |
| P2-02 | Phase 2 | compact delegate RFC revise / verify | `update` | `docs/rfc/remote-compact-delegate.md` | 冻结复用现有 compact family 的方向 | `low` |
| P2-03 | Phase 2 | evidence forwarding RFC revise / verify | `update` | `docs/rfc/evidence-envelope-forwarding.md` | 冻结 payload truth 不变的 forwarding 方向 | `low` |
| P3-01 | Phase 3 | cross-doc consistency | `update` | `W1/W3/W5 docs` | 避免主文和 RFC 打架 | `medium` |
| P3-02 | Phase 3 | W1 closure | `add` | `docs/issue/pre-worker-matrix/W1-closure.md` | 为 W5 提供 RFC evidence | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — 现状核对

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | compact reality 核对 | 核对现有 `context.compact.*` family 是否足够 | `nacp-core/src/messages/context.ts` | 明确“不新增 family”的理由 | 文档/代码比对 | RFC 可直接引用 |
| P1-02 | audit reality 核对 | 核对 `audit.record` 与 evidence payload 的兼容性 | `nacp-core/src/messages/system.ts` | 明确 evidence forwarding 走 envelope reuse | 文档/代码比对 | RFC 可直接引用 |
| P1-03 | workspace reality 核对 | 核对当前 workspace substrate 与 future RPC seam | `workspace-context-artifacts` | 为 workspace RFC 提供真实锚点 | 文档/代码比对 | 不脱离现有码面 |

### 4.2 Phase 2 — RFC 修订与校准

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | workspace RFC revise / verify | 在已存在 RFC 上校对 future surface、不支持列表与当前 workspace substrate anchor | `docs/rfc/nacp-workspace-rpc.md` | future workspace seam baseline | 文档 review | RFC-only 立场明确 |
| P2-02 | compact delegate RFC revise / verify | 明确远端 compact 继续复用 canonical `context.compact.request/response` | `docs/rfc/remote-compact-delegate.md` | 避免再造第二套 compact 协议 | 文档 review | 不引入私有 family |
| P2-03 | evidence RFC revise / verify | 明确 remote evidence 继续复用 `audit.record` + 既有 evidence payload truth | `docs/rfc/evidence-envelope-forwarding.md` | 避免 worker-specific evidence schema | 文档 review | 不新增 evidence-forwarding message type |

### 4.3 Phase 3 — 一致性收口

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | cross-doc consistency | 核对 W1 主文、W3 blueprint、W5 predicate | `docs/design/pre-worker-matrix/*` | 下游引用口径统一 | 文档 grep / review | 无 stale wording |
| P3-02 | W1 closure | 写 phase closure | `docs/issue/pre-worker-matrix/W1-closure.md` | W5 可直接引用 | 文档 review | RFC/引用链完整 |

---

## 5. Phase 详情

### 5.1 Phase 1 — 现状核对

- **Phase 目标**：把 W1 从“想象中的新协议工程”拉回到“现实锚点驱动的 RFC”
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `docs/design/pre-worker-matrix/W1-cross-worker-protocols.md`
- **具体功能预期**：
  1. 明确 compact/evidence 哪些已有 family 足够
  2. 明确 workspace 还没有现成 cross-worker wire
  3. 为 RFC 提供真实代码 anchor
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`无代码测试；做文档/代码对照`
  - **手动验证**：`核对 1.3.0 messages 与 W0 vocabulary`
- **收口标准**：
  - reality 判断全部来自当前代码
  - RFC 不建立在旧误判之上
- **本 Phase 风险提醒**：
  - 容易把 future desire 写成 current reality

### 5.2 Phase 2 — RFC 修订与校准

- **Phase 目标**：在已存在文档基础上完成 3 份方向性 RFC 的校准
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `docs/rfc/nacp-workspace-rpc.md`
  - `docs/rfc/remote-compact-delegate.md`
  - `docs/rfc/evidence-envelope-forwarding.md`
- **具体功能预期**：
  1. 每份 RFC 都有目标、边界、推荐方向、defer 理由
  2. 不偷渡 code-ship 口径
  3. 显式写出对现有 `context.compact.*` / `audit.record` 的复用，不重复发明 family
  4. 可作为 worker-matrix 后续 phase 的输入
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`无代码测试`
  - **手动验证**：`owner/reviewer 可直接阅读并引用`
- **收口标准**：
  - 3 份 RFC 齐全
  - 全文保持 RFC-only 口径
- **本 Phase 风险提醒**：
  - 最容易回滑到“顺手把 helper 也做了”

### 5.3 Phase 3 — 一致性收口

- **Phase 目标**：让 W1 成为下游真的可用的 reference baseline
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `docs/issue/pre-worker-matrix/W1-closure.md`
- **本 Phase 修改文件**：
  - `docs/design/pre-worker-matrix/W3-absorption-*.md`
  - `docs/design/pre-worker-matrix/W5-closure-and-handoff.md`
- **具体功能预期**：
  1. W3 blueprint 正确引用 W1 RFC
  2. W5 predicate 能正确检查 RFC 与 W0 的一致性
  3. W1 closure 可被 W5 直接消费
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`文档引用检查`
  - **手动验证**：`grep / 交叉阅读`
- **收口标准**：
  - 无主文/RFC冲突
  - W1 closure 证据完整
- **本 Phase 风险提醒**：
  - 文档之间最容易出现旧 wording 残留

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1

- **影响范围**：`Phase 2`
- **为什么必须确认**：`关系到 future workspace seam 最终是 NACP family 还是更薄的 transport interface`
- **当前建议 / 倾向**：`RFC 保持 NACP-shaped family 倾向，但本阶段不代码化`
- **Q**：`workspace future seam 是否继续以 NACP family 作为默认目标形态？`
- **A**：`是。默认目标仍是 NACP-shaped family，但 W1 只冻结 RFC 方向，不进入代码化。`

#### Q2

- **影响范围**：`Phase 3`
- **为什么必须确认**：`关系到 W5 是否把 W1 当作纯 RFC gate，而非 code gate`
- **当前建议 / 倾向**：`是，W1 只作为 RFC gate`
- **Q**：`W5 是否明确以“RFC shipped + 引用一致”作为 W1 唯一 closure gate？`
- **A**：`是。W1 的 closure gate 是“3 份 RFC 已存在且与 W0/W3/W5 引用一致”，不要求 code-ship。`

### 6.2 问题整理建议

- 只问会改变 future 协议方向的问题
- 不把 helper 落点之类实现细节提前带入

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| RFC 写得过满 | 会重新把 W1 推回 code-ship 路线 | `high` | 强制保持 RFC-only 语言 |
| reality anchor 不足 | RFC 容易脱离当前代码 | `medium` | 每份 RFC 都附代码锚点 |
| W0/W3/W5 不一致 | 会让 W1 失去 baseline 价值 | `medium` | Phase 3 做统一引用检查 |

### 7.2 约束与前提

- **技术前提**：`W0 vocabulary 路径明确`
- **运行时前提**：`1.3.0 current messages reality 已核对`
- **组织协作前提**：`owner 接受 W1 RFC-only 立场`
- **上线 / 合并前提**：`RFC 与设计主文一致`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/pre-worker-matrix/W1-cross-worker-protocols.md`
  - `docs/design/pre-worker-matrix/W5-closure-and-handoff.md`
- 需要同步更新的说明文档 / README：
  - `无`
- 需要同步更新的测试说明：
  - `docs/issue/pre-worker-matrix/W1-closure.md`

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `3 份 RFC 文件存在且内容完整`
  - `W1 主文与 RFC 引用关系正确`
- **单元测试**：
  - `无`
- **集成测试**：
  - `无`
- **端到端 / 手动验证**：
  - `核对 compact/audit/workspace 三条 seam 的当前 reality 与 RFC 结论一致`
- **回归测试**：
  - `grep W1/W3/W5 相关引用`
- **文档校验**：
  - `所有 wording 保持 RFC-only`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. 3 份 RFC 已存在且完成 revise / verify
2. W1 不包含任何代码交付要求
3. RFC 明确复用现有 `context.compact.*` / `audit.record`，不自创新 family
4. RFC 与 W0/W3/W5 引用链一致
5. future remote split 有明确 baseline
6. W1 closure 可被 W5 直接消费

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `3 份 RFC 形成稳定方向基线` |
| 测试 | `通过文档一致性检查` |
| 文档 | `主文、RFC、closure 互相对齐` |
| 风险收敛 | `不再把 W1 误写成 code-ship phase` |
| 可交付性 | `worker-matrix 后续 phase 可直接引用` |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待执行后回填`
- **哪些编号的拆分还不够合理**：`待执行后回填`
- **哪些问题本应更早问架构师**：`待执行后回填`
- **哪些测试安排在实际执行中证明不够**：`待执行后回填`
- **模板本身还需要补什么字段**：`待执行后回填`

---

## 10. 结语

这份 action-plan 以 **冻结 future cross-worker seam 的方向，而不是抢先实装远端协议** 为第一优先级，采用 **先 reality、再 RFC、最后做 cross-doc consistency** 的推进方式，优先解决 **workspace/compact/evidence 三条 seam 后续实现可能各自发明协议** 的问题，并把 **RFC-only、不得偷渡代码、必须引用现有 contract reality** 作为主要约束。整个计划完成后，`pre-worker-matrix / W1` 应达到 **3 份可直接被后续 phase 消费的方向性 RFC baseline**，从而为后续的 **remote split / service binding code path** 提供稳定参考。

---

## 11. GPT 工作日志回填（2026-04-22）

### 11.1 总体结果

- **结论**：W1 已按 action-plan 以 **RFC-only** 方式完成收口。
- **核心变化**：3 份 cross-worker RFC 已基于 W0 `@nano-agent/nacp-core@1.4.0` reality 完成 revise / verify；W1 不新增任何代码、schema、matrix entry 或 helper。

### 11.2 新增文件

1. `docs/issue/pre-worker-matrix/W1-closure.md`

### 11.3 修改文件

1. `docs/rfc/nacp-workspace-rpc.md`
2. `docs/rfc/remote-compact-delegate.md`
3. `docs/rfc/evidence-envelope-forwarding.md`
4. `docs/design/pre-worker-matrix/W1-cross-worker-protocols.md`
5. `docs/design/pre-worker-matrix/W3-absorption-blueprint-and-dryrun.md`
6. `docs/design/pre-worker-matrix/W5-closure-and-handoff.md`
7. `docs/action-plan/pre-worker-matrix/W1-cross-worker-protocols.md`

### 11.4 关键实施点

1. **Phase 1 — reality 核对**
   - 以 `packages/nacp-core/src/messages/context.ts` 确认 remote compact 继续复用 canonical `context.compact.request/response`
   - 以 `packages/nacp-core/src/messages/system.ts` 确认 evidence forwarding 继续复用 `audit.record`
   - 以 `packages/workspace-context-artifacts/src/namespace.ts` 与 `packages/session-do-runtime/src/workspace-runtime.ts` 确认 workspace / evidence 的当前 in-process substrate
2. **Phase 2 — RFC revise / verify**
   - `nacp-workspace-rpc.md` 改为明确的 future `workspace.fs.*` direction baseline，并显式说明为什么 W1 不实装代码
   - `remote-compact-delegate.md` 明确 remote compact 是部署拓扑变化，不是新协议本体；坚持复用现有 compact family
   - `evidence-envelope-forwarding.md` 明确 forwarding 只补 carrier / attribution metadata，EvidenceRecord payload 与 anchor truth 必须保持 W0 shipped shape
3. **Phase 3 — 一致性收口**
   - 创建 `docs/issue/pre-worker-matrix/W1-closure.md`
   - 将 W1 design / action-plan 状态翻转到 executed
   - 修正 W3/W5 对 W1 的引用口径，使其明确消费的是 **3 份 RFC + W1 closure**，而不是任何 W1 code-ship surface

### 11.5 验证与结果

本轮为文档 phase，按 action-plan 约定执行 **文档/代码对照** 与 **cross-doc consistency**，不新增代码测试。实际完成的核对面：

1. `packages/nacp-core/src/messages/context.ts` ↔ `docs/rfc/remote-compact-delegate.md`
2. `packages/nacp-core/src/messages/system.ts` ↔ `docs/rfc/evidence-envelope-forwarding.md`
3. `packages/nacp-core/src/evidence/vocabulary.ts` / `src/transport/cross-seam.ts` ↔ `docs/rfc/evidence-envelope-forwarding.md`
4. `packages/workspace-context-artifacts/src/namespace.ts` ↔ `docs/rfc/nacp-workspace-rpc.md`
5. `packages/session-do-runtime/src/workspace-runtime.ts` ↔ `docs/rfc/evidence-envelope-forwarding.md`
6. `docs/design/pre-worker-matrix/W3-absorption-blueprint-and-dryrun.md` / `W5-closure-and-handoff.md` ↔ W1 RFC-only 口径

### 11.6 最终收口意见

1. W1 的目标已经兑现：3 条 future cross-worker seam 都有可直接引用的方向性 RFC baseline。
2. W1 没有越界：未偷渡 message family、helper、matrix 注册或 contract test。
3. W1 与 W0/W3/W5 的引用关系已成闭环：W0 提供 truth，W1 冻结方向，W3/W5 消费 RFC 与 closure 作为后续输入。
4. 下一阶段可按 DAG 继续进入 `W2-publishing-pipeline`，同时保留 W1 作为 worker-matrix 后续 remote split 的 reference baseline。
