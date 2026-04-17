# Plan After Skeleton — NACP Contract Freeze & Trace-first Runtime Closure Phase

> 文档对象: `nano-agent / post-skeleton phase charter`
> 刷新日期: `2026-04-17`
> 作者: `GPT-5.4`
> 文档性质: `phase charter / execution plan / handoff boundary`
> 前置结论:
> - `docs/plan-after-nacp.md` 已确认当前仓库为 `skeleton-complete, not deployment-complete`
> - 根目录 `README.md` 已冻结项目 vision：Cloudflare-native、DO-centered、WebSocket-first、fake-bash-as-compatibility-surface、typed capability runtime、layered context
> - 当前仓库已具备 8 个 skeleton packages、15 个 root contract tests、14 个跨包 E2E

---

## 0. 为什么要重写这份文档

上一版 `plan-after-skeleton.md` 的主轴是：

> **Worker-native Runtime Closure**

这个方向本身没有错，但经过进一步讨论，我们已经确认它还不够强。  
当前阶段真正缺的，不只是“把 session / seams / storage 做真”，而是要先解决两条更高优先级的问题：

1. **NACP contract 还没有以“已知内容最大冻结”的方式被正式收紧**
2. **observability 还没有被提升为 runtime law：trace_uuid 还不是全系统硬约束，D1 也还没有成为持久观测锚点**

因此，这一阶段不能再被定义成普通的“继续收口 runtime”，而应该被定义成：

> **以 NACP contract freeze 和 trace-first observability law 为前置条件的 runtime closure phase。**

这份重写后的文档，要完成 6 件事：

1. 在开头就明确 **本期 in-scope**
2. 在开头就明确 **本期 out-of-scope，并转入下一阶段 in-scope**
3. 把 **observability** 提升为本阶段前置基础
4. 把 **contract** 提升为一等公民，并按“已知内容最大冻结”推进
5. 重新按执行依赖划分 **workstreams / phases**
6. 明确下一阶段的 handoff：**API design / data model design / richer capability/context expansion**

---

## 1. 当前阶段判断：我们现在到底处于什么状态

今天的仓库现实，不再是“协议完成，设计待写”，而是：

1. **协议地基已成立**
   - `nacp-core`
   - `nacp-session`
2. **8 个 skeleton packages 已存在并通过首轮验证**
   - `agent-runtime-kernel`
   - `capability-runtime`
   - `workspace-context-artifacts`
   - `session-do-runtime`
   - `llm-wrapper`
   - `hooks`
   - `eval-observability`
   - `storage-topology`
3. **跨包 contract 与 E2E 已经形成基础证据**
   - root contract tests
   - package tests
   - cross-package E2E

所以当前阶段的真实起点不是“从零做新系统”，而是：

> **从一个已经成立的 MVP skeleton 出发，把系统推进到 contract 更稳定、trace 更严格、runtime 更接近真实 Cloudflare deployment truth 的状态。**

---

## 2. 本阶段总目标

### 2.1 阶段名称

**NACP Contract Freeze & Trace-first Runtime Closure Phase**

### 2.2 一句话目标

> **冻结 nano-agent 已知边界内的最大 contract surface，把 trace_uuid 提升为全系统的一等协议律，并在此基础上完成 session edge、external seams、storage/context evidence、minimal capability governance 的 runtime closure。**

### 2.3 本阶段结束时必须拿到的成果

| 成果 | 说明 | 价值 |
|------|------|------|
| **NACP contract freeze** | 已知内容最大冻结，不再让核心协议漂移 | 后续 runtime / frontend / expansion 的稳定地基 |
| **trace-first observability law** | trace_uuid 成为硬规则，D1 成为持久观测锚点 | 整个系统具备可追踪、可回放、可恢复能力 |
| **session edge v1 closure** | ingress / replay / ack / resume / fallback 真正收口 | 前端和会话 runtime 才有稳定依附面 |
| **worker-boundary closure** | provider / capability / hook 跨 worker/service-binding 路径真实可跑 | 从 in-process glue 走向真实边界 |
| **storage & context evidence** | placement / compaction / context layering 有运行时证据 | 下一阶段 context / data design 才有依据 |
| **minimal capability governance** | fake bash 最小能力面与 unsupported contract 明确 | LLM 心智可用、系统边界可治理 |

---

## 3. 本阶段边界：先定义 In-Scope，再定义 Out-of-Scope

这是本次重写最重要的部分。  
**本阶段做什么、不做什么，必须在开头写死。**

### 3.1 In-Scope（本阶段必须完成）

#### A. NACP Contract Freeze

1. 冻结 `nacp-core` 已知边界内的核心 envelope 分层
   - `header`
   - `authority`
   - `trace`
   - `control`
   - `refs`
   - `body`
   - `extra`
2. 冻结 `nacp-session` v1 的 session edge contract
   - ingress legality
   - stream sequencing
   - replay / resume
   - ack / fallback
   - client-visible vs internal-only 边界
3. 冻结 internal worker boundary 的已知 contract
   - provider
   - capability
   - hook
   - runtime audit / trace handoff
4. 收敛当前 `trace_id / trace_uuid` 的命名漂移，形成统一 contract 与兼容策略

#### B. Trace-first Observability Law

5. 把 `trace_uuid` 提升为内部 runtime 的硬约束
6. 规定：**任何被系统接纳后的内部消息，都必须带有 trace_uuid**
7. 定义 trace recovery model
   - 缺 trace_uuid 时，优先通过 anchor 回溯恢复
   - 恢复成功则显式打标
   - 恢复失败进入受控失败，而不是 silent continue
8. 建立 D1-backed trace anchor 与最小持久化 schema
9. 建立跨 package 的 observability 抽象 seam
10. 建立分级日志 / 事件埋点体系
    - severity / level
    - lifecycle anchors
    - boundary crossings
    - recovery / failure markers
11. 将 `eval-observability` 从“辅助包”提升为“系统基础设施”

#### C. Runtime Closure

12. 完成 `session-do-runtime` 的真实 ingress / controller / replay / resume / ack / fallback closure
13. 完成 `llm-wrapper / capability-runtime / hooks` 的 external seam closure
14. 完成 fake provider / fake capability / fake hook worker 的 deployment-shaped 路径验证

#### D. Storage & Context Evidence

15. 建立 storage placement evidence 的可运行证据链
16. 建立 context layering 的原则与最小可观察实现
17. 建立 compaction / summary / archive 的 evidence hooks
18. 冻结 context layering principles 与 observability requirements

#### E. Capability Governance（仅限最小必要面）

19. 冻结 fake bash 的 minimal supported contract
20. 明确 supported / deferred / risky inventory
21. 补齐对 runtime closure 有刚性价值的最小缺口命令
    - `grep`
    - file/search 基础一致性
    - `curl` / `ts-js` / `git subset` 的边界治理
22. 明确 unsupported contract 与 policy surface

#### F. 测试与收口

23. 补齐 contract / integration / E2E / deployment-shaped tests
24. 对每个 phase 写出 closure note
25. 形成下一阶段的 handoff memo

### 3.2 Out-of-Scope（本阶段明确不做，并转为下一阶段 in-scope）

#### A. Product / Public API Design

1. 正式前端 API 设计
2. 产品级公共接口设计
3. richer session API v2

#### B. Business / Registry / Product Data DDL

4. registry DDL
5. skill / model / capability 的正式数据模型
6. context metadata 的完整 structured schema
7. 业务侧 query model / cross-tenant analytics model

#### C. Richer Product Capabilities

8. multi-round chat 的完整协议与实现
9. richer session message family v2
10. 完整 fake bash / `just-bash` port
11. 完整 context architecture
12. 自动压缩 / budget management / 外部压缩 worker
13. 更成熟的 frontend adaptation

#### D. Production Productization

14. 生产级 APM / dashboard / alerting 平台
15. 最终 archive/export 产品编排
16. 多租户运营与计费层

### 3.3 一个必须写明的例外

虽然本阶段把 **API design** 与 **业务 DDL design** 放到下一阶段，但这不意味着本阶段可以完全不做任何 schema / interface 工作。

本阶段**必须完成**的例外是：

1. **runtime contract freeze**
2. **observability contract**
3. **D1-backed trace anchor 的最小 schema**

所以这里的边界应明确表述为：

> **本阶段不做产品级 API / 业务型 DDL；但必须完成 runtime law 和 observability law 所需的最小 contract 与最小 D1 schema。**

---

## 4. 本阶段的方法论：Contract 不是最小化，而是“已知内容最大冻结”

### 4.1 基本原则

我们不再采用“先给最小 contract 壳子，后面再慢慢补”的思路。  
本阶段改用：

> **Maximal Known-Surface Contract**

也就是：

1. **不定义未知**
2. **不定义仍需探索的功能面**
3. **但对已经确定的内容，用最大限度冻结 contract surface**

### 4.2 为什么要这么做

原因很简单：

1. nano-agent 不是第一次做 agent runtime
2. 我们已经有 3 组 agent-cli 参考
3. 我们已经有 NACP / Session / skeleton / tests / E2E 的现有证据

如果此时还继续“只定最小 contract”，代价会是：

1. 协议长期漂移
2. 每个 package 都长出临时桥接
3. session / frontend / observability 会被迫不断返工

### 4.3 本阶段要优先冻结的 contract surface

| Contract Surface | 本阶段要求 |
|---|---|
| **NACP-Core envelope** | 优先冻结 |
| **NACP-Session edge v1** | 优先冻结 |
| **trace propagation / recovery law** | 优先冻结 |
| **observability event base fields / severity / anchors** | 优先冻结 |
| **worker-boundary runtime contract** | 优先冻结 |
| **frontend public API** | 延后到下一阶段 |
| **business DDL / registry DDL** | 延后到下一阶段 |
| **richer message family v2** | 延后到下一阶段 |

---

## 5. 本阶段的方法论：Observability 不是配套能力，而是 Runtime Law

### 5.1 总原则

本阶段开始后，observability 不再被视为：

- “方便调试的辅助功能”
- “以后接 dashboard 再说”
- “有日志就行”

而要被视为：

> **runtime legality、failure recovery、evidence-driven architecture 的基础层。**

### 5.2 Trace Law

本阶段必须正式写入的规则如下：

1. **外部 ingress 可以不自带 trace_uuid**
2. **但一旦请求被系统接纳，就必须立刻生成 / 绑定 / 落锚 trace_uuid**
3. **从接纳瞬间开始，任何内部 runtime hop 都必须带 trace_uuid**
4. **任何缺失 trace_uuid 的内部消息，都视为 protocol-invalid**

### 5.3 Trace Recovery Law

trace 丢失时，系统不能直接崩，但也不能假装无事发生。

正确行为应为：

1. 优先通过 anchor 回溯恢复
   - `message_uuid`
   - `request_uuid`
   - `reply_to`
   - `parent_message_uuid`
   - `session_uuid`
   - `stream_id`
   - tool / hook / turn 局部标识
2. 恢复成功：
   - 补回 trace_uuid
   - 打 `trace_recovered=true`
   - 记录恢复来源
3. 恢复失败：
   - 进入 reject / quarantine / diagnostic path
   - 不允许正常业务流静默继续

### 5.4 D1 Anchor Law

为了让 trace law 能够落地，本阶段必须建立：

1. **D1 trace anchor**
2. **最小持久化 log schema**
3. **最小 recovery index**

这不是业务数据库设计，而是 runtime survival infrastructure。

### 5.5 Logging & Instrumentation Law

所有核心 packages 都必须预留 observability seam，并在关键业务流转点埋点。

必须覆盖的最小类目：

1. ingress accepted
2. trace minted / recovered
3. session edge lifecycle
4. provider call lifecycle
5. tool lifecycle
6. hook lifecycle
7. compact / summary lifecycle
8. storage placement lifecycle
9. failure / retry / timeout / cancellation

### 5.6 观测分层

本阶段推荐把 observability 分成 3 层：

| 层级 | 用途 | 持久化策略 |
|------|------|------------|
| **Level A — Anchor / Mandatory Audit** | trace 起点、恢复、关键状态跃迁、失败 | 必入 D1 |
| **Level B — Durable Business Flow** | turn / tool / hook / placement 等核心业务流 | 入 D1 或批量持久化 |
| **Level C — Verbose Diagnostic** | 高频 delta / progress / debug 级明细 | 可采样 / 可批量 / 不要求逐条同步入 D1 |

### 5.7 三分法仍然成立，但要升级

此前已经成立的三分法仍保留：

1. **Live Session Stream**
2. **Durable Audit Trace**
3. **Durable Transcript**

但本阶段要进一步升级为：

> **三分法 + trace law + D1 anchor + recovery model**

---

## 6. 本阶段 Workstreams / Phases 总览

本阶段不再按“主题并列”组织，而按**执行依赖**组织。

| Phase | Workstream | 类型 | 实现目标 | 收口目标 | 依赖 |
|------|------------|------|----------|----------|------|
| **Phase 0** | **NACP Contract Freeze** | contract phase | 冻结已知 contract surface | 核心协议边界不再漂移 | `-` |
| **Phase 1** | **Trace-first Observability Foundation** | foundation phase | 建立 trace law / D1 anchors / instrumentation seam | observability 成为 runtime law | Phase 0 |
| **Phase 2** | **Session Edge Closure** | runtime phase | 完成 session edge v1 真实主路径 | session edge v1 成为稳定依附面 | Phase 0, 1 |
| **Phase 3** | **External Seam Closure** | runtime phase | 让 provider / capability / hook 跑过真实 worker boundary | in-process glue 不再是主要证据 | Phase 0, 1, 2 |
| **Phase 4** | **Storage & Context Evidence Closure** | evidence phase | 完成 storage placement / context layering / compaction evidence | 下一阶段 context/data design 有证据输入 | Phase 0, 1, 2, 3 |
| **Phase 5** | **Capability Governance & Minimal Bash Completion** | governance phase | 冻结 minimal bash contract 并补关键缺口 | LLM-compatible minimum surface 稳定 | Phase 0, 1, 2, 4 |
| **Phase 6** | **Phase Closure & Expansion Handoff** | closure phase | 输出 closure memo 与下阶段 handoff | 当前阶段正式关闭，下一阶段可启动 | Phase 0-5 |

---

## 7. 各 Phase 详细说明

## 7.1 Phase 0 — NACP Contract Freeze

### 实现目标

把 nano-agent 当前已经知道的协议边界，最大限度冻结下来。

### 本 Phase In-Scope

1. `nacp-core` envelope 分层冻结
2. `nacp-session` edge v1 冻结
3. `trace_id / trace_uuid` 命名统一策略
4. worker boundary contract 的已知部分冻结
5. observability base event contract 冻结

### 交付物

1. contract freeze memo
2. contract matrix
3. drift / migration rules
4. contract tests 增补

### 收口标准

1. 已知 contract surface 有正式冻结稿
2. 命名漂移与兼容规则已明确
3. contract tests 可以阻止核心协议继续漂移

---

## 7.2 Phase 1 — Trace-first Observability Foundation

### 实现目标

把 observability 从 package 配套层，升级为 runtime foundation。

### 本 Phase In-Scope

1. trace_uuid law
2. trace recovery law
3. D1 anchors / recovery index / minimal persistence schema
4. package-level instrumentation seam
5. severity / level / anchor event catalog
6. audit / live / transcript 三分法升级

### 交付物

1. observability law spec
2. D1 schema（仅 observability 最小面）
3. anchor / recovery helpers
4. event taxonomy / level taxonomy
5. 跨包埋点接线计划

### 收口标准

1. 系统接纳后的内部消息无 trace_uuid 即非法
2. trace 缺失有 recovery path，而不是 uncontrolled crash
3. D1 成为持久观测锚点
4. 各核心 package 已具备标准化 observability seam

---

## 7.3 Phase 2 — Session Edge Closure

### 实现目标

基于已冻结 contract 与 trace law，完成 `session edge v1` 的真实主路径。

### 本 Phase In-Scope

1. `nacp-session` 成为 ingress legality source of truth
2. `WsController / HttpController` 真正承担 edge orchestration
3. replay / resume / ack / fallback 收口
4. session edge 埋点与 trace 接线
5. deployment-shaped session tests

### 收口标准

1. 本地 parse/switch 不再是主 ingress reality
2. replay / resume / ack / fallback 已有真实行为定义
3. edge 生命周期全程具备 traceable evidence
4. session edge v1 可作为前端最小依附面

---

## 7.4 Phase 3 — External Seam Closure

### 实现目标

把 provider / capability / hook 从 in-process 组合，推进到真实 worker / service-binding boundary。

### 本 Phase In-Scope

1. fake provider worker
2. fake capability worker
3. fake hook worker
4. trace-preserving boundary contract
5. cancel / retry / timeout / progress 的跨边界闭合

### 收口标准

1. 至少一条完整主链路经过真实 worker boundary
2. progress / cancel / timeout / retry 跨边界不丢 contract
3. trace_uuid 在跨边界路径中保持完整
4. observability 能看见 boundary crossing 与 failure surfaces

---

## 7.5 Phase 4 — Storage & Context Evidence Closure

### 实现目标

在不提前做完整 context architecture / business DDL 的前提下，先把 evidence 做真。

### 本 Phase In-Scope

1. storage placement evidence
2. context layering principles
3. compaction / summary evidence
4. archive / snapshot / checkpoint 的证据链
5. context observability requirements

### 收口标准

1. DO / KV / R2 的关键 placement 有运行时证据
2. context layering principles 已冻结
3. compaction / summary 不再只是概念，而有可追踪 evidence
4. 下一阶段 context architecture 不再是拍脑袋设计

---

## 7.6 Phase 5 — Capability Governance & Minimal Bash Completion

### 实现目标

在本阶段只完成“最小必要的 LLM-compatible capability surface”，不抢跑完整 fake bash 扩面。

### 本 Phase In-Scope

1. minimal supported bash contract
2. supported / deferred / risky inventory
3. `grep` 与关键 file/search consistency
4. `curl` / `ts-js` / `git subset` 的边界治理
5. unsupported contract

### 收口标准

1. fake bash 的最小支持面被正式冻结
2. 高价值缺口命令已补齐到可用程度
3. unsupported / risky 面不再悬空
4. 后续 expanded fake bash profile 有明确 handoff

---

## 7.7 Phase 6 — Phase Closure & Expansion Handoff

### 实现目标

明确本阶段已经完成什么、明确把什么正式交给下一阶段。

### 本 Phase In-Scope

1. closure memo
2. open-items ledger
3. next-phase handoff memo
4. API / data model design 的启动约束

### 收口标准

1. 本阶段工作可被正式关闭
2. 下一阶段第一 workstream 已被定义
3. 不再出现“哪些问题本阶段是否完成”这种边界混乱

---

## 8. 执行顺序与依赖

### 8.1 推荐执行顺序

1. **Phase 0 — NACP Contract Freeze**
2. **Phase 1 — Trace-first Observability Foundation**
3. **Phase 2 — Session Edge Closure**
4. **Phase 3 — External Seam Closure**
5. **Phase 4 — Storage & Context Evidence Closure**
6. **Phase 5 — Capability Governance & Minimal Bash Completion**
7. **Phase 6 — Phase Closure & Expansion Handoff**

### 8.2 为什么这样排

1. 不先冻结 contract，后续所有 closure 都会漂
2. 不先建 trace-first observability，所有“closure”都只是感觉成立
3. session edge 是整个系统的 first runtime dependency
4. external seams 必须建立在 session edge 和 trace law 之上
5. storage / context evidence 必须建立在真实 runtime path 之上
6. minimal bash completion 应建立在已有 observability 与 runtime evidence 上，而不是先拍脑袋扩面

### 8.3 依赖图

```text
Phase 0 (Contract Freeze)
  -> Phase 1 (Observability Foundation)
      -> Phase 2 (Session Edge Closure)
          -> Phase 3 (External Seam Closure)
              -> Phase 4 (Storage & Context Evidence)
                  -> Phase 5 (Minimal Bash Completion)
                      -> Phase 6 (Closure & Handoff)
```

---

## 9. 工作执行方法

### 9.1 每个 Phase 都必须先有 Design Artifact

本阶段不再采用“一次性把所有 workstreams 写成重型 design”的方式，但也不能无设计开工。

规则是：

1. 当前要启动的 Phase，必须先有对应 design artifact
2. design artifact 必须覆盖：
   - 问题定义
   - in-scope / out-of-scope
   - contract 影响面
   - failure paths
   - test matrix
   - closure criteria

### 9.2 每个 Phase 按批次执行

每个 Phase 应拆为 2-4 个实现批次，每批次都应能被独立验证。

### 9.3 每个 Phase 都有三道 Gate

#### Start Gate

1. design artifact 已写出
2. in-scope / out-of-scope 已冻结
3. test matrix 已列出

#### Build Gate

1. 批次拆分已完成
2. contract 影响面已识别
3. observability 埋点计划已明确

#### Closure Gate

1. 该 Phase 的 closure criteria 全部满足
2. 对应 tests 已存在
3. 遗留项与 handoff 已记录

---

## 10. 测试策略

本阶段不是“改完代码再跑一下 tests”，而是 **以测试作为 phase 证据**。

### 10.1 四层测试结构

1. **Package tests**
   - 锁 package 内部 contract
2. **Root contract tests**
   - 锁跨包协议 truth
3. **Cross-package E2E**
   - 锁 skeleton 主链路
4. **Deployment-shaped tests**
   - 锁真实 worker / DO / service-binding / D1 / storage path

### 10.2 本阶段新增重点

本阶段若没有下面 4 类测试，就不能说完成：

1. trace law tests
2. recovery / anchor tests
3. session edge deployment-shaped tests
4. worker-boundary deployment-shaped tests

---

## 11. 下一阶段预告：什么会成为下一个阶段的 In-Scope

当前阶段关闭后，下一阶段应切换为：

> **Capability & Context Expansion Phase**

### 11.1 下一阶段的第一个 Workstream

下一阶段的第一个 workstream 应明确为：

> **API & Data Model Design**

它要正式解决：

1. product/public API design
2. frontend-facing session / timeline / artifact interface design
3. business/registry/context DDL / data model design
4. richer session protocol v2 的对象模型

### 11.2 下一阶段应吸收的主题

1. multi-round chat
2. richer message family v2
3. broader fake bash / `just-bash` port
4. context architecture
5. compression / budget management
6. richer frontend adaptation
7. registry / structured data model implementation

### 11.3 为什么这些要放到下一阶段

因为这些主题都依赖本阶段先完成：

1. contract freeze
2. trace-first observability
3. session edge v1
4. worker-boundary closure
5. storage / context evidence

没有这些，下一阶段的 API / DDL 设计就会再次回到猜测。

---

## 12. 最终 Verdict

### 12.1 对当前阶段的最终定义

本阶段不应再被表述为：

> “继续补 skeleton”

而应被表述为：

> **“在已存在 skeleton 的基础上，优先冻结 NACP 已知 contract surface，并建立 trace-first observability law，再完成 runtime closure。”**

### 12.2 对本阶段边界的最终判断

1. **本阶段要做**
   - contract freeze
   - trace-first observability
   - runtime closure
   - storage/context evidence
   - minimal bash completion
2. **本阶段不做**
   - product/public API design
   - business/registry DDL design
   - richer session v2
   - full fake bash expansion
   - full context architecture

### 12.3 一句话总结

> **After skeleton, the next job is not feature expansion. The next job is to freeze the known contracts, enforce trace-first runtime law, and make the current runtime real enough that the next phase can safely design APIs, data models, and richer product capabilities.**

