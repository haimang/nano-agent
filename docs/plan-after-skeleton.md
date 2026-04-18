# Plan After Skeleton — Owner-aligned Contract Freeze, Trace-first Observability, and Runtime Closure

> 文档对象: `nano-agent / post-skeleton phase charter`
> 刷新日期: `2026-04-17`
> 作者: `GPT-5.4`
> 文档性质: `phase charter / execution plan / scope freeze / handoff boundary`
> 输入依据:
> - `docs/plan-after-nacp.md`
> - 根目录 `README.md`
> - `docs/plan-after-skeleton-reviewed-by-opus.md`
> - 当前 `packages/**`、root contract tests、cross-package E2E
> - 业主本轮补充的 5 条决策事实

---

## 0. 为什么这份文档要再次重写

上一版 `plan-after-skeleton.md` 已经完成了一次方向升级：

> **从“继续补 runtime”升级到“先冻结 contract + 把 observability 升级为 runtime law，再做 runtime closure”。**

这个方向是对的，但 Opus 的审查和业主本轮补充又进一步证明：  
我们还需要把几条**硬性前提**直接写进 charter，而不是留在讨论里。

这次重写后，本阶段的主轴不再只是：

> Worker-native Runtime Closure

而是：

> **Contract Freeze + Identifier Law + Trace-first Observability + Runtime Closure**

也就是说，这一阶段不是“继续补功能”，而是要先把**命名、协议、追踪、观测、恢复、边界**这些会决定整个项目后续形态的东西正式钉死。

---

## 1. 本轮已经确认的 Owner Decisions（直接生效）

这是本次 charter 的最高优先级输入。

### 1.1 命名与身份规则

1. **全面取消旧 trace 命名写法**
   - 统一使用 **`trace_uuid`**
   - `trace_uuid` 是唯一真理和事实
2. **所有内部身份字段一律使用 `*_uuid`**
   - `session_uuid`
   - `request_uuid`
   - `stream_uuid`
   - `span_uuid`
   - `tool_call_uuid`
   - `hook_run_uuid`
   - 以及其他内部 identity-bearing 字段
3. **全面取消 `{业务簇}_id` 的内部写法**
   - 若字段表示 identity，必须改为 `{业务簇}_uuid`
   - 若字段不是 UUID 身份字段，则不能继续叫 `*_id`
   - 应改为 `*_key` / `*_slug` / `*_name` / `*_handle` / `*_label`

### 1.2 多轮输入的阶段归属

4. **多轮 input family / formal follow-up session message family 纳入本阶段的 Phase 0 contract freeze**
   - 必须在 `nacp-session` 层正式扩协议
   - 不允许 `session-do-runtime` 以私有 wire message 先行兜底
5. README 以及其他当前有效文档，必须改口并与该决策保持一致

### 1.3 Trace substrate 处理方式

6. **同意 Opus 的 1-week substrate decision investigation**
   - 本阶段不在 charter 层直接把 D1 永久写死为唯一 substrate
   - 先做一轮 1-week decision investigation
   - 产出 `trace-substrate-decision.md`
7. 但业主对 D1 的偏好依然成立：
   - D1 是当前首选假设
   - 只是必须通过 investigation 正式锁定，而不是在 plan 层直接跳过论证

### 1.4 Phase 重排

8. 当前阶段的 Phase 必须重新拆分
   - 更准确地区分逻辑层次
   - 更准确地暴露风险
   - 更准确地表达依赖关系

---

## 2. 当前仓库的真实起点

今天的仓库现实，不再是“协议包刚完成”，而是：

1. **协议地基已经存在**
   - `nacp-core`
   - `nacp-session`
2. **8 个 skeleton packages 已具备 MVP reality**
   - `agent-runtime-kernel`
   - `capability-runtime`
   - `workspace-context-artifacts`
   - `session-do-runtime`
   - `llm-wrapper`
   - `hooks`
   - `eval-observability`
   - `storage-topology`
3. **已有基础证据**
   - root contract tests
   - package tests
   - cross-package E2E

因此，本阶段的起点不是“做第一版 skeleton”，而是：

> **在已存在 skeleton 的基础上，先完成 contract 与 identifier 的正式冻结，再建立 trace-first observability law，并让 runtime closure 真正有证据可依。**

---

## 3. 本阶段的一句话目标

> **冻结 nano-agent 已知边界内的最大 contract surface，建立统一的 `*_uuid` identity law 与 `trace_uuid` runtime law，完成 trace substrate 的正式决策，并在此基础上完成 session edge、external seams、storage/context evidence 与最小 capability surface 的 runtime closure。**

---

## 4. 本阶段边界：In-Scope / Out-of-Scope

这是本文件最重要的部分。  
**先定边界，再谈 phases。**

## 4.1 In-Scope（本阶段必须完成）

### A. Contract & Identifier Freeze

1. 冻结 `nacp-core` 已知边界内的核心 envelope 分层
2. 冻结 `nacp-session` v1 的 session edge contract
3. 冻结 internal worker boundary 的已知 contract
4. 冻结 identifier naming law：
   - identity-bearing fields 一律 `*_uuid`
   - non-UUID fields 禁止继续用 `*_id`
5. 明确并制定 legacy trace naming -> `trace_uuid` 的 contract migration 路径
6. 输出 contract versioning / migration policy

### B. Trace-first Observability Law

7. 把 `trace_uuid` 提升为内部 runtime 的硬约束
8. 规定：**任何被系统接纳后的内部消息，都必须携带 `trace_uuid`**
9. 建立 trace recovery model
10. 建立分级 observability model
11. 建立跨 package 的 instrumentation seam
12. 将 `eval-observability` 从配套包升级为系统基础设施

### C. Trace Persistence Substrate Decision

13. 开展 1-week trace persistence substrate decision investigation
14. 比较候选 substrate：
   - D1
   - DO storage
   - R2 + KV index
15. 产出正式 decision memo
16. 在 decision 之后，锁定本阶段 observability persistence substrate

### D. Runtime Closure

17. 完成 `session-do-runtime` 的真实 ingress / controller / replay / resume / ack / fallback closure
18. 完成 `llm-wrapper / capability-runtime / hooks` 的 external seam closure
19. 至少形成一条真实 worker/service-binding boundary 路径

### E. Deployment & Verification

20. 引入 deployment dry-run / wrangler dev shaped verification
21. 至少一条链路在 deploy-shaped 环境下跑通并捕获真实 trace
22. 至少一次 chaos / failure injection 验证 trace recovery path
23. 为 session hot path 建立最小性能基线

### F. Storage & Context Evidence

24. 建立 storage placement evidence
25. 建立 context layering principles
26. 建立 compaction / summary / checkpoint / snapshot evidence
27. 冻结 context layering principles 与 observability requirements

### G. Minimal Capability Governance

28. 冻结 minimal fake bash contract
29. 明确 supported / deferred / risky inventory
30. 补齐对当前 closure 有刚性价值的最小缺口命令
   - `grep`
   - workspace file/search consistency
   - `curl` boundary
   - `ts/js` 执行边界
   - `git subset` 边界

### H. 收口与下阶段交接

31. 为每个 Phase 产出 closure note
32. 输出当前阶段 closure memo
33. 输出下一阶段 handoff memo

## 4.2 Out-of-Scope（本阶段明确不做，并转为下一阶段 In-Scope）

### A. Public / Product API Design

1. 正式前端 API 设计
2. 产品级公共 API 设计
3. richer session-facing interface design

### B. Product / Registry / Business Data DDL

4. registry DDL
5. product data model
6. business analytics query model
7. full context metadata structured schema

### C. Richer Product Capabilities

8. advanced multi-turn queue / replace / merge semantics
9. richer session message family v2（formal follow-up family 之外的进一步扩展）
10. full fake bash / `just-bash` port
11. full context architecture
12. automatic compression / budget management / external compression worker
13. mature frontend adaptation

### D. Full Productization

14. production-grade dashboard / alerting platform
15. billing / tenant operations layer
16. final archive/export product orchestration

## 4.3 一个必须写明的例外

虽然本阶段把 API design 与业务 DDL design 放到下一阶段，但这不代表本阶段可以回避 schema / interface 工作。

本阶段必须完成的例外是：

1. runtime contract
2. observability contract
3. identifier law
4. trace substrate decision
5. 由 substrate decision 导出的最小持久化 schema

所以准确说法是：

> **本阶段不做产品级 API / 业务型 DDL；但必须完成 runtime law、identifier law、observability law、以及 trace persistence 所需的最小 schema。**

---

## 5. 本阶段的方法论

## 5.1 Contract 方法论：Maximal Known-Surface Contract

我们不再使用“先给最小壳子，后面慢慢补”的思路。  
本阶段采用：

> **Maximal Known-Surface Contract**

也就是：

1. 不定义未知
2. 不定义仍需探索的能力面
3. 但对已经确定的内容，做最大限度冻结

这意味着：

- `nacp-core` 已知 envelope 结构要冻结
- `nacp-session` v1 已知 edge contract 要冻结
- internal worker boundary 已知部分要冻结
- observability event base、severity、anchor categories 要冻结
- naming law 要冻结

## 5.2 Identifier 方法论：UUID-only Internal Identity

从本阶段开始，内部 identity 统一遵守下面的规则：

1. **所有 identity-bearing 字段必须是 `*_uuid`**
2. **任何 `*_id` 若表达身份含义，都属于待迁移字段**
3. **任何非 UUID 的命名型字段，不能再使用 `*_id`**

示例：

| 错误类型 | 正确替代 |
|---|---|
| legacy trace field naming | `trace_uuid` |
| `stream_id` | `stream_uuid` |
| `span_id` | `span_uuid` |
| `producer_id`（若表达身份） | `producer_uuid` |
| `producer_id`（若表达名称） | `producer_key` / `producer_name` |

## 5.3 Observability 方法论：Trace-first Runtime Law

observability 不再是辅助层，而是 runtime law。

必须写入的规则如下：

1. 外部 ingress 可以不自带 `trace_uuid`
2. 一旦请求被系统接纳，就必须立刻 mint / bind / anchor `trace_uuid`
3. 从接纳瞬间开始，任何内部 runtime boundary 都必须带 `trace_uuid`
4. 缺失 `trace_uuid` 的内部消息属于 protocol-invalid

## 5.4 Trace Recovery 方法论

trace 丢失时，系统不能直接崩，也不能静默继续。

正确行为是：

1. 优先通过锚点回溯恢复
   - `message_uuid`
   - `request_uuid`
   - `reply_to_message_uuid`
   - `parent_message_uuid`
   - `session_uuid`
   - `stream_uuid`
   - `tool_call_uuid`
   - `hook_run_uuid`
2. 恢复成功：
   - 补回 `trace_uuid`
   - 打 `trace_recovered=true`
   - 记录恢复来源
3. 恢复失败：
   - 进入 reject / quarantine / dead-letter / diagnostic path
   - 不允许静默继续正常业务执行

## 5.5 Observability 分层

本阶段推荐 3 层 observability：

| 层级 | 用途 | 持久化策略 |
|------|------|------------|
| **Level A — Anchor / Mandatory Audit** | trace 起点、恢复、关键状态跃迁、失败 | 由 substrate decision 决定的主 substrate 强制持久化 |
| **Level B — Durable Business Flow** | turn / tool / hook / placement 等核心业务流 | durable persistence |
| **Level C — Verbose Diagnostic** | 高频 delta / progress / debug 级明细 | 采样 / 批量 / 非逐条强持久化 |

---

## 6. 重新划分后的 Phases

本阶段不再使用单一线性粗颗粒结构。  
新的 Phase 拆分遵循两个原则：

1. **把逻辑层面真正不同的工作拆开**
2. **把 greenfield 风险与 integration 风险明确分开**

| Phase | 名称 | 类型 | 核心目标 | 主要风险 |
|------|------|------|----------|----------|
| **Phase 0** | Contract & Identifier Freeze | contract phase | 冻结 contract surface 与 naming law | scope 漂移 / 命名冲突 / versioning 缺失 |
| **Phase 1** | Trace Substrate Decision Investigation | decision phase | 用 1-week investigation 锁定 trace persistence substrate | 过早写死 substrate / 评估不充分 |
| **Phase 2** | Trace-first Observability Foundation | foundation phase | 建立 trace law、instrumentation、recovery、layering | greenfield infra / recovery path 未闭合 |
| **Phase 3** | Session Edge Closure | runtime phase | 完成 session edge v1 主路径 | session helper 未接线 / replay semantics 漂移 |
| **Phase 4** | External Seam Closure | runtime phase | 建立真实 worker/service-binding boundary | 仍停留 in-process / trace 丢失 |
| **Phase 5** | Deployment Dry-run & Real Boundary Verification | verification phase | 用 deploy-shaped 环境与真实依赖做验证 | 只在 test double 成立 / 无真实边界证据 |
| **Phase 6** | Storage & Context Evidence Closure | evidence phase | 建立 storage/context/compaction evidence | 无法支撑下一阶段 data/context design |
| **Phase 7a** | Minimal Bash — Search & Workspace | governance phase | 补 `grep` 与 search/file consistency | command surface 漂移 |
| **Phase 7b** | Minimal Bash — Network & Script | governance phase | 补 `curl` 与 `ts/js` 边界治理 | 网络/执行风险未治理 |
| **Phase 7c** | Minimal Bash — VCS & Policy | governance phase | 收口 `git subset` 与 unsupported contract | inventory 不稳定 / policy 不清 |

> `closure / handoff` 不再单独占一个 Phase，而作为每个 Phase 的 ritual，以及本阶段的最终 exit pack。

---

## 7. 各 Phase 详细说明

## 7.1 Phase 0 — Contract & Identifier Freeze

### 实现目标

把已知 contract surface 与 UUID-only naming law 冻结下来。

### In-Scope

1. `nacp-core` 已知 envelope freeze
2. `nacp-session` v1 edge freeze
3. internal worker boundary known surface freeze
4. `trace_uuid` canonicalization
5. all internal `*_id` -> `*_uuid` / `*_key` / `*_name` migration policy
6. versioning / compatibility / deprecation policy

### 交付物

1. `contract-freeze-matrix.md`
2. `nacp-versioning-policy.md`
3. `identifier-law.md`
4. contract migration checklist
5. contract tests 增补计划

### 收口标准

1. 已知 contract surface 有正式冻结稿
2. `trace_uuid` canonical naming 被正式锁定
3. internal identity naming law 被正式锁定
4. 版本 / 迁移 / 兼容规则有明确 memo

## 7.2 Phase 1 — Trace Substrate Decision Investigation

### 实现目标

在真正开建 persistence 之前，用 1 周级别 investigation 正式决定 trace persistence substrate。

### In-Scope

1. D1 / DO storage / R2 + KV index 方案比较
2. 写入延迟、查询需求、恢复需求、migration cost 比较
3. 与 Cloudflare-native runtime 的配合评估
4. 推荐 substrate 输出

### 交付物

1. `trace-substrate-decision.md`
2. 候选方案对照表
3. 决策理由
4. 后续 Phase 2 的输入约束

### 交付物（2026-04-18 A2 收口追记）

A2 已落地以下产物（替代上一节 “1. trace-substrate-decision.md” 的轻量描述）：

1. `docs/eval/after-skeleton-trace-substrate-benchmark.md` v1（evidence pack，含 4 组实测、F1 sink 发现、R2/D1/KV comparative）
2. `packages/eval-observability/scripts/trace-substrate-benchmark.ts`（可重复执行的 runner，模式 `local-bench` / `readback-probe` / `all`，CLI 提供 `--out` / `--markdown` / `--seed`）
3. `packages/eval-observability/test/scripts/trace-substrate-benchmark.test.ts`（runner 自身的回归 + 阈值守卫）
4. AX-QNA Q5 升格为 evidence-backed yes、Q20 升格为 hard gate
5. `docs/design/after-skeleton/P1-trace-substrate-decision.md` §9.3 已回填执行后状态

### 收口标准

1. trace persistence substrate 被正式决策（DO hot anchor + R2 cold archive + D1 deferred query；A2 evidence-backed yes）
2. 不再在 charter 级别悬空 substrate 争论
3. Phase 2 可以基于该 memo 开工

## 7.3 Phase 2 — Trace-first Observability Foundation

### 实现目标

把 observability 从包级能力，提升为 runtime foundation。

### In-Scope

1. `trace_uuid` law
2. recovery law
3. cross-package instrumentation seam
4. observability layer taxonomy
5. anchor / business / diagnostic 分类
6. recovery failure path design

### 交付物

1. `observability-law.md`
2. `observability-layering.md`
3. trace anchor / recovery helper design
4. event taxonomy / severity taxonomy
5. instrumentation integration plan
6. substrate-specific minimal schema

### 收口标准

1. 系统接纳后的内部消息无 `trace_uuid` 即非法
2. recovery path 已定义且可执行
3. 各核心 packages 都具备 instrumentation seam
4. 至少一次 chaos injection 验证 trace recovery path

## 7.4 Phase 3 — Session Edge Closure

### 实现目标

基于 contract freeze 与 trace law，完成 session edge v1 的真实主路径。

### In-Scope

1. ingress 走 `nacp-session.normalizeClientFrame`
2. `WsController` / `HttpController` 真实接线
3. replay / resume / ack / fallback 收口
4. session edge trace / observability 接线
5. reconnect / replay behavior 固化

### 交付物

1. session edge design artifact
2. replay / resume state machine
3. session edge test matrix
4. ingress migration checklist

### 收口标准

1. raw parse/switch 不再是主 ingress reality
2. ingress 正式走 `normalizeClientFrame`
3. reconnect + replay 能在目标时间窗口内恢复
4. session edge v1 成为前端最小稳定依附面

## 7.5 Phase 4 — External Seam Closure

### 实现目标

把 provider / capability / hook 从 in-process 组合推进到真实 worker / service-binding boundary。

### In-Scope

1. fake provider worker
2. fake capability worker
3. fake hook worker
4. trace-preserving boundary contract
5. cancel / timeout / retry / progress 闭合

### 交付物

1. worker boundary contract memo
2. fake worker set
3. boundary integration tests
4. trace propagation tests

### 收口标准

1. 至少一条完整主链路经过真实 worker boundary
2. progress / cancel / timeout / retry 跨边界不丢 contract
3. `trace_uuid` 在跨边界路径中保持完整
4. observability 能看见 boundary crossing / failure surfaces

## 7.6 Phase 5 — Deployment Dry-run & Real Boundary Verification

### 实现目标

防止“只在 test double 成立”的假 closure。

### In-Scope

1. `wrangler dev` shaped verification
2. 至少一条真实 deploy-shaped trace path
3. 至少一次真实 provider call 级 smoke verification
4. 至少一次真实 cloud binding integration
5. hot-path latency baseline

### 交付物

1. deployment dry-run report
2. real-boundary trace evidence
3. latency baseline
4. failure / timeout record

### 收口标准

1. 至少一条链路在 deploy-shaped 环境中真实跑通
2. 至少一次真实 provider trace-preserving smoke 成立
3. 性能基线被记录
4. Phase 4 不是“纯 fake world 收口”

## 7.7 Phase 6 — Storage & Context Evidence Closure

### 实现目标

在不提前做完整 context architecture / business DDL 的前提下，把 evidence 做真。

### In-Scope

1. storage placement evidence
2. context layering principles
3. compaction / summary / checkpoint / snapshot evidence
4. real storage integration spot-check
5. context observability requirements

### 交付物

1. `storage-evidence-report.md`
2. `context-layering-principles.md`
3. compaction / summary evidence spec
4. real storage integration evidence

### 收口标准

1. DO / KV / R2 的关键 placement 有运行时证据
2. 至少一次真实 R2 put/get integration 成立
3. context layering principles 已冻结
4. 下一阶段 context architecture 不再靠猜测启动

## 7.8 Phase 7a — Minimal Bash: Search & Workspace

### 实现目标

补对当前 runtime closure 刚性最强的搜索与 workspace surface。

### In-Scope

1. `grep`
2. file/search consistency
3. workspace search policy
4. inventory drift guard

### 收口标准

1. `grep` 成立
2. search / file behavior 不再漂移
3. 对模型与开发者的 supported contract 已明确

## 7.9 Phase 7b — Minimal Bash: Network & Script

### 实现目标

补最关键的网络与脚本执行面，但严格治理边界。

### In-Scope

1. `curl` contract
2. `ts/js` execution contract
3. network policy / failure semantics
4. script execution observability

### 收口标准

1. `curl` 语义稳定
2. `ts/js` 执行路径有明确 contract
3. 网络与执行风险被治理

## 7.10 Phase 7c — Minimal Bash: VCS & Policy

### 实现目标

收口 `git subset` 与整体 unsupported policy。

### In-Scope

1. `git subset` capability boundary
2. unsupported / deferred / risky inventory
3. `capability-inventory.md`
4. policy guardrails

### 收口标准

1. `capability-inventory.md` 产出
2. supported / deferred / risky 三档被冻结
3. 后续 full fake bash expansion 有明确 handoff

---

## 8. 执行顺序与 DAG

## 8.1 推荐执行顺序

1. **Phase 0 — Contract & Identifier Freeze**
2. **Phase 1 — Trace Substrate Decision Investigation**
3. **Phase 2 — Trace-first Observability Foundation**
4. **Phase 3 — Session Edge Closure**
5. **Phase 4 — External Seam Closure**
6. **Phase 5 — Deployment Dry-run & Real Boundary Verification**
7. **Phase 6 — Storage & Context Evidence Closure**
8. **Phase 7a — Minimal Bash: Search & Workspace**
9. **Phase 7b — Minimal Bash: Network & Script**
10. **Phase 7c — Minimal Bash: VCS & Policy**

## 8.2 推荐 DAG

```text
Phase 0 (Contract & Identifier Freeze)
  -> Phase 1 (Trace Substrate Decision)
  -> Phase 3 design prep

Phase 1
  -> Phase 2 (Observability Foundation)

Phase 2
  -> Phase 3 (Session Edge Closure)

Phase 3
  -> Phase 4 (External Seam Closure)

Phase 4
  -> Phase 5 (Deployment Dry-run)
  -> Phase 6 (Storage & Context Evidence)

Phase 6
  -> Phase 7a / 7b / 7c

Phase 7a / 7b / 7c
  -> Final phase closure pack
```

## 8.3 为什么这样排

1. 命名与 contract 不先冻，后面所有实现都会返工
2. substrate 不先定，observability foundation 会在错误底座上生长
3. session edge 仍是整个 runtime 的 first runtime dependency
4. external seams 需要稳定 session edge 与 trace law
5. deploy-shaped verification 不能再被“埋进测试策略”而没有单独收口
6. storage/context evidence 需要真实 runtime path，但不必等待 minimal bash 全部收口
7. minimal bash 应拆开做，不应再用一个大 Phase 吞掉全部风险

---

## 9. 执行方法

## 9.1 每个 Phase 都必须先有 Design Artifact

每个 Phase 启动前，必须先产出对应 design artifact。  
最低要求：

1. 问题定义
2. in-scope / out-of-scope
3. contract 影响面
4. failure paths
5. test matrix
6. closure criteria

## 9.2 每个 Phase 按批次执行

每个 Phase 拆为 2-4 个实现批次。  
每个批次都必须：

1. 有明确交付物
2. 有独立测试目标
3. 有 observability 埋点要求

## 9.3 每个 Phase 都有三道 Gate

### Start Gate

1. design artifact 已写出
2. scope 已冻结
3. test matrix 已列出

### Build Gate

1. 批次已拆分
2. contract 影响面已识别
3. observability 接线计划已明确

### Closure Gate

1. phase closure criteria 全部满足
2. tests 已存在
3. closure note 已回填
4. 下游依赖已更新

---

## 10. 测试与验证策略

## 10.1 五层测试结构

1. **Package tests**
2. **Root contract tests**
3. **Cross-package E2E**
4. **Deployment-shaped verification**
5. **Chaos / failure injection**

## 10.2 本阶段必须新增的验证

1. `trace_uuid` law tests
2. identifier law tests
3. recovery / anchor tests
4. session edge deploy-shaped tests
5. worker-boundary deploy-shaped tests
6. substrate-specific persistence tests
7. chaos injection for recovery path
8. hot-path latency baseline capture

---

## 11. 本阶段的退出条件（Exit Criteria）

只有当下面条件全部成立时，本阶段才可关闭：

1. `trace_uuid` 成为唯一 canonical trace identity
2. internal identity naming law 被正式冻结
3. trace substrate 有正式 decision memo
4. observability law 已建立并接入核心 packages
5. session edge v1 closure 成立
6. external seam closure 成立
7. 至少一条 deploy-shaped real boundary 证据成立
8. storage/context evidence 成立
9. minimal fake bash contract 成立
10. 每个 Phase 的 closure note 已完成

---

## 12. 下一阶段：什么会成为正式 In-Scope

当前阶段关闭后，下一阶段应切换为：

> **Capability & Context Expansion Phase**

### 12.1 下一阶段的第一个 Workstream

> **API & Data Model Design**

它要正式解决：

1. public / product API design
2. frontend-facing session / timeline / artifact interface design
3. business / registry / context DDL
4. richer session protocol v2 object model

### 12.2 下一阶段应吸收的主题

1. advanced multi-turn queue / replace / merge semantics
2. richer session message family v2（formal follow-up family 之外）
3. broader fake bash / `just-bash` port
4. full context architecture
5. compression / budget management
6. mature frontend adaptation
7. registry / structured data model implementation

### 12.3 为什么这些要放到下一阶段

因为它们都依赖本阶段先完成：

1. contract freeze
2. identifier law
3. trace-first observability
4. session edge v1
5. external seam closure
6. storage / context evidence

没有这些，下一阶段的 API / data model design 仍然会回到猜测。

---

## 13. 最终 Verdict

### 13.1 对当前阶段的最终定义

本阶段不应再被表述为：

> “继续补 skeleton”

而应被表述为：

> **“在已存在 skeleton 的基础上，先冻结 contract 与 identifier law，建立 trace-first observability 与 substrate decision，再完成 runtime closure，并为下一阶段的 API / data model / richer capability expansion 提供稳定前提。”**

### 13.2 一句话总结

> **After skeleton, the next job is not feature expansion. The next job is to freeze the known contracts, lock UUID-only internal identity, establish trace-first observability on a formally chosen substrate, and make the runtime real enough that the next phase can safely design APIs, data models, and richer product capabilities.**

---

## 14. 后续文档生产清单与撰写顺序

本阶段不应在没有设计文档的前提下直接进入实现。  
推荐方法是：

1. **先写 phase-level design / decision / policy memo**
2. **待对应 design 冻结后，再写 action-plan**
3. **再进入具体实现批次**

这里需要明确的是：  
并不是每个 Phase 都应该写成同一种重型 design 文档。

- 有些更适合写成 **正式 design doc**
- 有些更适合写成 **decision memo / policy memo / matrix memo**

### 14.1 推荐的 design / memo 文件列表

建议统一放在：

> `docs/design/after-skeleton/`

并统一采用：

> `P{phase}-...` / `P{phase}{suffix}-...` / `PX-...`

| 对应 Phase | 文件路径 | 类型 | 说明 |
|---|---|---|---|
| **Phase 0** | `docs/design/after-skeleton/P0-contract-and-identifier-freeze.md` | Design | 本阶段总入口，冻结 contract surface 与 `*_uuid` law |
| **Phase 0** | `docs/design/after-skeleton/P0-nacp-versioning-policy.md` | Policy memo | 版本、兼容、deprecation、migration 规则 |
| **Phase 0** | `docs/design/after-skeleton/P0-identifier-law.md` | Policy memo | `trace_uuid` 与全部内部 `*_uuid` 命名法则 |
| **Phase 0** | `docs/design/after-skeleton/P0-contract-freeze-matrix.md` | Matrix memo | 哪些 contract 已冻结 / 可变 / 实验态 |
| **Phase 1** | `docs/design/after-skeleton/P1-trace-substrate-decision.md` | Decision memo | 1-week investigation 输出，比较 D1 / DO / R2+KV |
| **Phase 2** | `docs/design/after-skeleton/P2-trace-first-observability-foundation.md` | Design | trace law、recovery、instrumentation、layering |
| **Phase 2** | `docs/design/after-skeleton/P2-observability-layering.md` | Supporting memo | Anchor / Durable / Diagnostic 三层观测 |
| **Phase 3** | `docs/design/after-skeleton/P3-session-edge-closure.md` | Design | ingress、replay、resume、ack、fallback、controller 接线 |
| **Phase 4** | `docs/design/after-skeleton/P4-external-seam-closure.md` | Design | fake provider / capability / hook worker，service binding boundary |
| **Phase 5** | `docs/design/after-skeleton/P5-deployment-dry-run-and-real-boundary-verification.md` | Design | wrangler dev / deploy-shaped verification、real boundary smoke |
| **Phase 6** | `docs/design/after-skeleton/P6-storage-and-context-evidence-closure.md` | Design | placement evidence、context layering、compaction evidence |
| **Phase 7a** | `docs/design/after-skeleton/P7a-minimal-bash-search-and-workspace.md` | Design | `grep`、workspace search、file/search consistency |
| **Phase 7b** | `docs/design/after-skeleton/P7b-minimal-bash-network-and-script.md` | Design | `curl`、`ts/js` execution、network policy |
| **Phase 7c** | `docs/design/after-skeleton/P7c-minimal-bash-vcs-and-policy.md` | Design | `git subset`、unsupported/deferred/risky inventory |
| **跨阶段** | `docs/design/after-skeleton/PX-capability-inventory.md` | Inventory memo | 最终 supported / deferred / risky 总表 |

### 14.2 推荐的 action-plan 文件列表

建议统一放在：

> `docs/action-plan/after-skeleton/`

| 对应 Phase | 文件路径 | 说明 |
|---|---|---|
| **Phase 0** | `docs/action-plan/after-skeleton/A1-contract-and-identifier-freeze.md` | 把 contract freeze / rename / migration 分批执行 |
| **Phase 1** | `docs/action-plan/after-skeleton/A2-trace-substrate-decision-investigation.md` | 1-week investigation 的执行计划 |
| **Phase 2** | `docs/action-plan/after-skeleton/A3-trace-first-observability-foundation.md` | instrumentation、recovery、schema、tests |
| **Phase 3** | `docs/action-plan/after-skeleton/A4-session-edge-closure.md` | normalizeClientFrame 接线、controller、replay/fallback |
| **Phase 4** | `docs/action-plan/after-skeleton/A5-external-seam-closure.md` | fake workers、service binding、trace propagation |
| **Phase 5** | `docs/action-plan/after-skeleton/A6-deployment-dry-run-and-real-boundary-verification.md` | wrangler dev、real provider smoke、latency baseline |
| **Phase 6** | `docs/action-plan/after-skeleton/A7-storage-and-context-evidence-closure.md` | real R2/KV/DO evidence、context principles |
| **Phase 7a** | `docs/action-plan/after-skeleton/A8-minimal-bash-search-and-workspace.md` | `grep` 与 workspace consistency |
| **Phase 7b** | `docs/action-plan/after-skeleton/A9-minimal-bash-network-and-script.md` | `curl`、脚本执行边界 |
| **Phase 7c** | `docs/action-plan/after-skeleton/A10-minimal-bash-vcs-and-policy.md` | `git subset`、inventory、unsupported policy |

### 14.3 推荐的撰写顺序

不建议按文件名顺序机械写作，而建议按依赖顺序推进。

#### 第一批：必须先写

这批是整个阶段的前置文档，决定后续所有实现边界。

1. `docs/design/after-skeleton/P0-contract-and-identifier-freeze.md`
2. `docs/design/after-skeleton/P0-nacp-versioning-policy.md`
3. `docs/design/after-skeleton/P0-identifier-law.md`
4. `docs/design/after-skeleton/P0-contract-freeze-matrix.md`
5. `docs/design/after-skeleton/P1-trace-substrate-decision.md`

#### 第二批：当前阶段最关键的 runtime design

这批决定本阶段最核心的 runtime closure 是否成立。

6. `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
7. `docs/design/after-skeleton/P2-observability-layering.md`
8. `docs/design/after-skeleton/P3-session-edge-closure.md`

#### 第三批：真实边界与部署验证

这批决定系统是否真正走出 in-process 假 closure。

9. `docs/design/after-skeleton/P4-external-seam-closure.md`
10. `docs/design/after-skeleton/P5-deployment-dry-run-and-real-boundary-verification.md`
11. `docs/design/after-skeleton/P6-storage-and-context-evidence-closure.md`

#### 第四批：最小 capability surface 治理

这批应放在前面几层 runtime truth 更稳定后再写。

12. `docs/design/after-skeleton/P7a-minimal-bash-search-and-workspace.md`
13. `docs/design/after-skeleton/P7b-minimal-bash-network-and-script.md`
14. `docs/design/after-skeleton/P7c-minimal-bash-vcs-and-policy.md`
15. `docs/design/after-skeleton/PX-capability-inventory.md`

### 14.4 对应的 action-plan 撰写顺序

规则应为：

> **对应 design 完成并冻结后，再写对应 action-plan。**

推荐顺序：

1. `A1-contract-and-identifier-freeze.md`
2. `A2-trace-substrate-decision-investigation.md`
3. `A3-trace-first-observability-foundation.md`
4. `A4-session-edge-closure.md`
5. `A5-external-seam-closure.md`
6. `A6-deployment-dry-run-and-real-boundary-verification.md`
7. `A7-storage-and-context-evidence-closure.md`
8. `A8-minimal-bash-search-and-workspace.md`
9. `A9-minimal-bash-network-and-script.md`
10. `A10-minimal-bash-vcs-and-policy.md`

### 14.5 如果要先控制文档数量，优先看哪几份

如果当前希望先收敛文档数量、集中火力，我推荐先只看下面 5 份最关键 design：

1. `docs/design/after-skeleton/P0-contract-and-identifier-freeze.md`
2. `docs/design/after-skeleton/P1-trace-substrate-decision.md`
3. `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
4. `docs/design/after-skeleton/P3-session-edge-closure.md`
5. `docs/design/after-skeleton/P4-external-seam-closure.md`

这 5 份基本决定了整个阶段的成败。  
后面的 storage/context 与 minimal bash，更像建立在这些基础之上的扩展设计。
