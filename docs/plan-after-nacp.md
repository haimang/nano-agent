# Plan After NACP — Progress Review, Closure Verdict, and Next-Phase Proposal

> 文档对象: `nano-agent / post-NACP skeleton phase review`
> 刷新日期: `2026-04-17`
> 作者: `GPT-5.4`
> 文档性质: `phase review / closure memo / next-phase proposal`
> 证据来源:
> - `docs/action-plan/*.md`
> - `packages/*`
> - `test/*.test.mjs`
> - `test/e2e/*.test.mjs`
> - `docs/progress-report/mvp-wave-2nd-round-fixings.md`
> - `docs/code-review/e2e-test-01.md`

---

## 0. 为什么要重写这份文档

`docs/plan-after-nacp.md` 最初是一份 **post-NACP 阶段的总规划文档**。它的任务不是回顾已经做完什么，而是规定：

1. 先补 design docs
2. 再补 action-plan
3. 再做 cross-doc alignment
4. 再搭测试 / observability / replay 底座
5. 最后再进入 skeleton implementation

现在仓库状态已经明显越过“只是在规划”的阶段：

- 8 个 post-NACP skeleton packages 已经落地到 `packages/`
- 对应 action-plan 已经齐备
- 根目录已有 **15 个 root contract tests**
- `test/e2e/` 已有 **14 个跨包 E2E**
- 我们已经完成多轮 code review、fixing、re-review、E2E bug-log closure

因此这份文档如果继续保持“下一步应该做什么”的口吻，就会和当前仓库 reality 脱节。  
本次刷新要把它改成三件事：

1. **回顾 original plan 到底承诺了什么**
2. **判断这些承诺今天完成了多少、质量如何**
3. **给出是否收口、是否进入下一阶段、以及下一阶段该做什么**

---

## 1. 原始承诺回顾：post-NACP 阶段本来要完成什么

原文的核心承诺，可以压缩成 5 个阶段：

| 阶段 | 原始目标 | 交付物 |
|------|----------|--------|
| **Stage A** | 补齐骨架设计 | 6 份 design docs |
| **Stage B** | 补齐 action-plan | 8 份 post-NACP action-plan |
| **Stage C** | cross-doc go-through | 一轮跨文档对齐与边界核查 |
| **Stage D** | 搭基础设施与观察窗口 | contract tests、scenario runner、trace/timeline/inspector/replay 底座 |
| **Stage E** | 按推荐顺序实现 skeleton | 8 个 skeleton packages 与首轮跨包验证 |

这份原始规划还有两个关键约束：

1. **不要在 runtime reality 还没形成前，提前冻结 DDL / KV / R2 方案**
2. **不要只写单包；必须把跨包 glue、observability、replay、resume 一起验证**

也就是说，这一阶段真正要解决的不是“多写几个 package”，而是：

> **把 nano-agent 从“协议包已完成”推进到“最小 skeleton 已设计、已实现、已验证，但尚未进入真实 Worker-native assembly closure”的状态。**

---

## 2. 当前仓库 reality 快照

今天这份仓库，已经具备如下 reality：

### 2.1 包结构 reality

当前 `packages/` 下已经存在 10 个核心包：

1. `nacp-core`
2. `nacp-session`
3. `agent-runtime-kernel`
4. `capability-runtime`
5. `workspace-context-artifacts`
6. `session-do-runtime`
7. `llm-wrapper`
8. `hooks`
9. `eval-observability`
10. `storage-topology`

其中：

- `nacp-core`、`nacp-session` 是 post-NACP 之前就已收口的协议地基
- 后 8 个包就是这份文档原本要求补齐并实现的 skeleton 层

### 2.2 文档 reality

当前仓库已经具备：

- 对应 8 个 skeleton 包的 design / action-plan
- 多轮 code review 文档
- 1 份跨包 second-round fix report
- 1 份 E2E bug-log closure 文档

这说明项目已经不再停留在“有没有设计”的阶段，而进入了：

> **design → action-plan → implementation → review → re-review → E2E closure**

这条完整链路。

### 2.3 测试 reality

当前根目录测试面已经形成两层：

1. **Root contract tests**：`test/*.test.mjs`
   - 当前 **15 / 15 passing**
2. **Cross-package E2E tests**：`test/e2e/*.test.mjs`
   - 当前 **14 / 14 passing**

另外，本轮复核还重新执行了 8 个 skeleton packages 的 package tests，当前全部通过：

- `agent-runtime-kernel`
- `capability-runtime`
- `workspace-context-artifacts`
- `session-do-runtime`
- `llm-wrapper`
- `hooks`
- `eval-observability`
- `storage-topology`

这意味着当前阶段已经不是“写了一堆骨架文件”，而是：

> **有包内测试、根 contract tests、跨包 E2E 三层证据同时成立的 MVP skeleton。**

---

## 3. 按原计划回看：我们完成了多少

下面用 original plan 的 5 个阶段回看当前完成度。

| 阶段 | 原始承诺 | 当前状态 | 完成度判断 | 质量评价 |
|------|----------|----------|------------|----------|
| **Stage A** | 补齐 6 份 skeleton design docs | 已完成 | **100%** | 质量高。后续 action-plan 和实现都确实围绕这些 design 展开。 |
| **Stage B** | 补齐 8 份 post-NACP action-plan | 已完成 | **100%** | 质量高。action-plan 后续被真实执行，而不是只停在文档层。 |
| **Stage C** | 做一次 cross-doc go-through | 已大体完成，但分散在多轮 review / re-review / fixing / E2E closure 中，没有单一 consolidated alignment memo | **80%–85%** | 质量中高。事实上的 cross-doc alignment 已发生，但文档形态比较分散。 |
| **Stage D** | 建立基础设施与观察窗口 | 已形成 contract tests、E2E、trace/timeline/replay/inspector 等验证底座，但很多“基础设施”仍以 in-process fixture / harness 形态存在，而非真实 deployable worker | **75%–80%** | 质量中高。验证能力足够强，但 Worker-native infrastructure 仍未完全实体化。 |
| **Stage E** | 按推荐顺序执行 skeleton implementation | 8 个 skeleton packages 已实现并经多轮 review / fixing / E2E 验证，但 assembly 侧仍有 deferred glue | **80%–85%** | 质量高于一般 skeleton，但还不是 deploy-ready runtime closure。 |

### 3.1 综合完成度判断

如果把这份文档原本约定的工作定义为：

> **“post-NACP skeleton planning + skeleton implementation + first cross-package proof”**

那么当前总体完成度可以判断为：

> **约 85% 左右，且核心路径已经越过‘只有设计、没有证明’的阶段。**

如果把它定义为：

> **“Cloudflare Worker-native runtime 已完成收口”**

那么答案是否定的。  
这个阶段还没有走到那一步。

---

## 4. 从 action-plan 回顾：8 个 skeleton 包完成得怎样

下面按 post-NACP 的 8 个 skeleton 包逐一判断其完成状态与质量。

| 包 | 原始角色 | 当前状态 | 证据 | 质量判断 |
|----|----------|----------|------|----------|
| `agent-runtime-kernel` | 主循环、step scheduler、event emission、cancel/wait seam | **MVP skeleton 已成立** | package tests 通过；root contract 覆盖 session stream shape；E2E-01/06/11 触达其主路径 | 核心 turn-loop 骨架成立，但仍更偏“runtime kernel correctness”而非完整 orchestration 平台 |
| `capability-runtime` | fake bash compatibility surface、typed capability execution、service-binding seam | **MVP skeleton 已成立，仍有治理类 follow-up** | package tests 通过；root contract 覆盖 tool-call schema；E2E-01/07 覆盖实际执行与 workspace fileops | execution seam 和 progress/cancel 已真实化；但 command inventory / just-bash diff truth / allowlist 仍未完全 productized |
| `workspace-context-artifacts` | workspace namespace、artifact refs、compact/context layering、snapshot seam | **MVP skeleton 已成立** | package tests 通过；root contract 覆盖 artifact/prepared ref；E2E-03/04/08/13 触达 compact / attachment / promotion / consistency | 是当前最稳定的数据平面骨架之一 |
| `session-do-runtime` | session actor、WebSocket/HTTP ingress、checkpoint/restore、assembly glue | **主体已成立，但仍有关键 deferred glue** | package tests 通过；root contract 覆盖 orchestrator/checkpoint；E2E-05/11/12/14 验证 resume / replay / hooks resume | checkpoint / restore 主体成立；但 ingress 仍未完全切到 `nacp-session` helper，controller 仍偏 stub-level |
| `llm-wrapper` | canonical request/response、provider/model registry、stream normalization、prepared artifact seam | **foundation 已成立** | package tests 通过；root contract 覆盖 session mapping；E2E-01/08/11 触达 request/build/context assembly/live stream | foundation 强，但离真实 provider worker / gateway closure 还有一段距离 |
| `hooks` | registry、dispatcher、guard、audit + session mapping | **MVP skeleton 已成立** | package tests 通过；root contract 覆盖 core/session/audit shape；E2E-02/14 覆盖 blocking 与 cross-resume persistence | 协议对齐与 runtime outcome contract 已明显成熟 |
| `eval-observability` | trace taxonomy、sink、timeline、inspector、replay、scenario/evidence helpers | **MVP skeleton 已成立** | package tests 通过；root contract 覆盖 audit/session protocol；E2E-09/10/11 覆盖 trace → durable → replay / placement evidence | 已从“字段骨架”升级为真正能服务 E2E 判定的 observability layer |
| `storage-topology` | placement hypotheses、mime gate、evidence-backed storage semantics | **MVP skeleton 已成立** | package tests 通过；root contract 覆盖 ref compatibility / calibration；E2E-10/13 触达 placement recommendation 与 artifact consistency | semantics 层已经能工作，但真实 Cloudflare storage adapters 还没有完全落地 |

### 4.1 这一轮真正做成了什么

从 action-plan 角度看，我们现在已经不是“有 8 个包”而已，而是已经形成了：

1. **主循环骨架**：`agent-runtime-kernel`
2. **能力执行骨架**：`capability-runtime`
3. **工作区 / artifact 数据平面**：`workspace-context-artifacts`
4. **session actor skeleton**：`session-do-runtime`
5. **模型抽象层**：`llm-wrapper`
6. **治理 / hook runtime**：`hooks`
7. **trace / replay / timeline 观察层**：`eval-observability`
8. **storage semantics 层**：`storage-topology`

这正是原文所定义的 **最小 skeleton 图**。

---

## 5. `test/` 目录的测试项评价：完成度与质量如何

这次评估不能只看“测试是否全绿”，更重要的是看：

1. 测到了什么层次
2. 是否真的覆盖到了 original plan 最在意的 seam
3. 还缺什么

### 5.1 Root contract tests：它们测得很对

当前 `test/*.test.mjs` 的 15 个 contract tests，主要价值不是功能回归，而是 **跨包协议 truth 锁定**。

| 测试簇 | 代表文件 | 覆盖价值 | 质量判断 |
|--------|----------|----------|----------|
| capability ↔ nacp-core | `capability-toolcall-contract.test.mjs` | 锁 tool request/cancel/response body compatibility | 强 |
| hooks ↔ nacp-core/nacp-session | `hooks-protocol-contract.test.mjs` | 锁 `hook.outcome` / `hook.broadcast` / audit body 真相 | 强 |
| kernel ↔ nacp-session | `kernel-session-stream-contract.test.mjs` | 锁 runtime event 到 session stream body 的 shape | 强 |
| llm-wrapper ↔ nacp-session | `llm-wrapper-protocol-contract.test.mjs` | 锁 LLM stream normalization 到 session reality | 强 |
| eval-observability ↔ nacp-core/nacp-session | `observability-protocol-contract.test.mjs` | 锁 audit body 与 inspector 对 session event reality 的消费 | 强 |
| session-do-runtime ↔ public orchestrator/checkpoint | `session-do-runtime-contract.test.mjs` | 锁 orchestrator/checkpoint 的 public seam | 强 |
| storage-topology ↔ refs/evidence | `storage-topology-contract.test.mjs` | 锁 ref compatibility、calibration、mime policy | 强 |
| workspace ↔ llm-wrapper / compact | `workspace-context-artifacts-contract.test.mjs` | 锁 artifact refs、prepared refs、compact boundary compatibility | 强 |

这些 tests 的质量很高，因为它们测的不是“一个函数返回 42”，而是：

> **跨包之间是否在同一个协议宇宙里说话。**

这正好对应了 original plan 对 Stage C / D 的要求。

### 5.2 Cross-package E2E：它们已经能证明 skeleton 在跑

`test/e2e/*.test.mjs` 的 14 个 E2E，已经形成了比较完整的业务簇覆盖：

| E2E 簇 | 代表测试 | 主要覆盖的包 | 价值判断 |
|--------|----------|--------------|----------|
| 最小完整 turn | `e2e-01-full-turn` | kernel / llm-wrapper / capability-runtime / nacp-session | 证明最小主链路可跑 |
| blocking hooks | `e2e-02-blocking-hook` | hooks / kernel / nacp-session | 证明治理逻辑能短路主流程 |
| compact / context boundary | `e2e-03-compact-boundary` | workspace / storage / kernel | 证明 compact seam 不是静态设想 |
| large result promotion | `e2e-04-large-result-promotion` | capability / workspace / storage | 证明 artifact-first path 能工作 |
| resume / restore | `e2e-05-session-resume`, `e2e-12-dirty-resume` | session-do / workspace / kernel | 证明 checkpoint/replay 主路径成立 |
| cancel / reconnect | `e2e-06-cancel-midturn`, `e2e-11-ws-replay-http-fallback` | kernel / session-do / eval | 证明中断与 replay 不只是文档语义 |
| workspace fileops | `e2e-07-workspace-fileops` | capability / workspace | 证明 capability runtime 与 workspace seam 已真正接线 |
| attachments / content consistency | `e2e-08-attachment-context`, `e2e-13-content-replacement-consistency` | llm-wrapper / workspace / storage | 证明 prepared artifact 与 content replacement contract 成立 |
| observability pipeline | `e2e-09-observability-pipeline` | eval / kernel / storage | 证明 trace → durable → replay 的路径成立 |
| storage calibration | `e2e-10-storage-calibration` | storage-topology / eval / workspace | 证明 placement recommendation 已有 evidence-backed 基线 |
| hooks cross-resume | `e2e-14-hooks-resume` | hooks / session-do / kernel | 证明 runtime-registered hooks 不是单 turn 幻觉 |

### 5.3 测试体系的真实优点

当前 `test/` 体系最大的优点有三个：

1. **不是单包自证**
   - root contract + E2E 都在逼不同 package 对齐同一 reality
2. **不是只测 happy path**
   - 有 resume、cancel、blocking、compact、promotion、replay、fallback
3. **已经能反哺架构判断**
   - 最近的 `e2e-test-01` bug-log closure 就说明，测试不只是验收，还能反推 package seam 是否真实

### 5.4 测试体系仍然缺什么

虽然当前测试质量已经不错，但仍有四个明显缺口：

1. **还偏 in-process**
   - 很多路径验证的是 package composition，而不是 deployable Worker / DO / service-binding reality
2. **Cloudflare-native reality 还不够强**
   - 还没有真实覆盖 KV、R2、DO hibernation、service binding network hop
3. **fake bash 治理面还不够完整**
   - 还没有把 `just-bash` 差异、supported/deferred/oom-risk inventory 收成长期 contract
4. **browser / external worker seams 还弱**
   - `curl`、browser rendering、真实 provider worker 这类外部能力 עדיין更像 seam 预留，而不是已验证 reality

### 5.5 测试质量结论

对这一阶段来说，`test/` 的完成质量可以判断为：

> **高于一般 skeleton 项目。**

它已经足以支撑：

- package seam correctness
- cross-package protocol compatibility
- first-wave E2E confidence

但它还不足以直接宣称：

> **Worker-native deployment reality 已经被充分证明。**

---

## 6. 哪些工作已经可以算“完成”，哪些还不能

### 6.1 可以明确记为已完成的部分

以下内容已经可以明确视为当前阶段完成：

1. **post-NACP skeleton 的 design 层**
2. **对应 skeleton 的 action-plan 层**
3. **8 个 skeleton packages 的首轮实现层**
4. **root contract tests 与 first-wave E2E 验证层**
5. **多轮 review / fixing / re-review / E2E bug-log closure**

也就是说，这个阶段最核心的目标：

> **把 nano-agent 从“协议地基已完成”推进到“最小 skeleton 已被实现并被跨包验证”**

已经成立。

### 6.2 仍然不能算已完成的部分

以下部分还不能被误读为“已经完成”：

1. **真实 Worker-native assembly closure**
   - `session-do-runtime` ingress 仍未完全切到 `@nano-agent/nacp-session` helper 主路径
   - `WsController` / `HttpController` 仍是偏 stub-level glue
2. **capability surface 的长期治理闭环**
   - supported / deferred / oom-risk inventory
   - `just-bash` diff truth
3. **真实 Cloudflare storage reality**
   - DO / KV / R2 的 runtime adapters 还没有形成充分的 deployment-grade integration proof
4. **registry / DDL 决策**
   - 按 original plan，本来就不该在这一阶段完成

### 6.3 当前阶段的最准确定位

所以这阶段最准确的定位不是：

> “nano-agent 已经完成”

而是：

> **“nano-agent 的 post-NACP skeleton phase 已基本完成；MVP skeleton 已建立、已测通、已复核，但 deployment/assembly/native-infra closure 仍在下一阶段。”**

---

## 7. 我们是否可以收口这个阶段

### 7.1 如果按原文 scope 判断

如果按这份文档原本约定的 scope 来看：

- 补 design
- 补 action-plan
- 做 cross-doc alignment
- 建测试 / 观察窗口
- 推到 skeleton implementation

那么我的判断是：

> **可以收口。**

原因很明确：

1. Stage A / B 已 100% 完成
2. Stage C / D 已不是“没有做”，而是已经以 review + contract + E2E 的方式实质完成
3. Stage E 已经完成到 “8 个 skeleton packages + 多轮验证 + bug-log closure” 的程度

### 7.2 但必须带着正确的标签收口

这个阶段只能按下面这个标签收口：

> **skeleton-complete, not deployment-complete**

也就是：

1. 可以结束这轮“post-NACP skeleton planning / implementation”阶段
2. 可以进入下一阶段
3. 但不能把这种收口误读为“Cloudflare Worker-native runtime 已 fully closed”

---

## 8. 下一阶段应该做什么：初步分析

我认为下一阶段不该再叫“继续补骨架”，而应该明确切换为：

> **Worker-native Runtime Closure Phase**

这一阶段的目标，不是再新增更多 package，而是把当前已经形成的 skeleton 拉到 **真实 assembly / external seam / Cloudflare-native reality** 上。

### 8.1 为什么现在该切换到这个阶段

因为当前剩余问题已经明显不再是“某个包有没有类型/结构”，而是：

1. **session edge 还不够真实**
2. **external workers / service bindings 还不够真实**
3. **Cloudflare-native storage / hibernation reality 还不够真实**
4. **fake bash 的治理面和 inventory 还不够稳定**

这些问题都不应该再通过“多写一个抽象 package”来解决，而要通过：

> **assembly closure + runtime reality + deployment-shaped tests**

来解决。

### 8.2 我建议的下一阶段 5 个工作流

#### Workstream 1 — Session Edge Closure

目标：把 `session-do-runtime` 从“可验证 skeleton”推进到“真实 session actor edge”。

应优先做的事：

1. 让 WebSocket ingress 真正走 `@nano-agent/nacp-session` helper 主路径
2. 收口 `WsController` / `HttpController`，不再保持 stub-level glue
3. 明确 attach / resume / replay / ack / fallback 的 edge contract
4. 增加强化测试：
   - reconnect after partial stream
   - ack gap replay
   - invalid client frame rejection
   - HTTP fallback after WS detach

为什么它最优先：

- 当前剩余最大的不确定性集中在这里
- 它是所有 Cloudflare-native assembly 的入口

#### Workstream 2 — External Seam Realization

目标：把当前的 in-process seam，推进到更接近真实 Worker/service-binding reality。

应推进的内容：

1. **Fake Provider Worker**
   - 用 service binding / worker boundary 跑流式输出、错误、超时、tool-call 路径
2. **Fake Capability Worker**
   - 用真实 transport seam 跑 progress / cancel / timeout
3. **Hook Worker Boundary**
   - 把 hooks runtime 的 service-binding reality 再推进一层

为什么重要：

- 现在大部分 correctness 已经被证明
- 接下来最大的风险是“跨边界以后 shape 还是不是那个 shape”

#### Workstream 3 — Cloudflare-native Storage Reality

目标：把 `storage-topology` 与 `workspace-context-artifacts` 从 semantics 层推进到更真实的 placement reality。

建议做的事：

1. 做更真实的 DO / KV / R2 adapters 或 integration fixtures
2. 让 observability placement log 真正服务 storage decision
3. 验证：
   - workspace snapshot 何时落 R2
   - replay checkpoint 何时留 DO
   - shared manifests 何时进入 KV

为什么现在不该直接做 DDL：

- original plan 的判断仍然成立：structured store 必须是 evidence-driven decision
- 现在更应该补足的是 placement proof，不是 schema 先行

#### Workstream 4 — Capability Surface Governance

目标：把 `capability-runtime` 从“能跑”推进到“可维护、可治理、可对外声明”。

建议优先补的内容：

1. `supported / deferred / oom-risk` 三类 command inventory
2. 与 `context/just-bash` 的 diff truth
3. `fake bash` 最小命令集与明确不支持项的长期测试
4. 对 `curl` / `git` / `ts-exec` / browser seam 的 product-level 边界说明

为什么这一块重要：

- 当前 capability execution correctness 已经比以前强很多
- 但长期维护会卡在“现在到底支持哪些命令、哪些只是 seam”

#### Workstream 5 — Registry / DDL Decision Phase

目标：不是立刻实现，而是把“需不需要 DDL、哪里需要 registry、什么该放 KV”变成下一阶段末尾的决策输出。

建议做法：

1. 先从 observability / placement evidence 总结访问模式
2. 再判断：
   - model registry 是否只要 KV snapshot
   - skill registry 是否需要 structured query
   - capability registry 是否只需静态 manifest + snapshot
3. 最后再决定是否引入 structured store

这里要特别强调：

> **这仍然不应该是下一阶段的起点，而应该是下一阶段的收束点。**

### 8.3 我建议的下一阶段执行顺序

我建议按下面顺序推进下一阶段：

1. **Session Edge Closure**
2. **External Seam Realization**
3. **Cloudflare-native Storage Reality**
4. **Capability Surface Governance**
5. **Registry / DDL Decision**

这个顺序的原因是：

1. 先把 session edge 做真实，后面所有 worker-native 验证才有意义
2. 再把 provider / capability / hook worker 的跨边界 reality 做真实
3. 再让 storage decisions 依据真实 runtime evidence 收敛
4. 最后再讨论 registry / DDL，避免过早固化

---

## 9. 最终 verdict

### 9.1 对当前阶段的判断

我的最终判断是：

> **`docs/plan-after-nacp.md` 原本约定的 post-NACP skeleton phase，今天已经可以收口。**

更准确地说：

- **完成度**：约 **85%**
- **阶段性质**：`skeleton-complete`
- **收口状态**：`yes`
- **能否进入下一阶段**：`yes`

### 9.2 为什么可以收口

因为 original plan 最关键的目标已经被满足：

1. design docs 已补齐
2. action-plan 已补齐
3. 8 个 skeleton packages 已真实实现
4. package tests / root contract / cross-package E2E 已形成三层验证
5. 多轮 review、fixing、re-review、bug-log closure 已把“纸面骨架”推进为“可证明骨架”

### 9.3 但必须带着什么边界进入下一阶段

进入下一阶段时必须明确：

1. 当前收口的是 **post-NACP skeleton phase**
2. 不是 **Cloudflare-native deployment closure**
3. 剩余风险已经从“包内 correctness”转移到：
   - session edge reality
   - service-binding / external worker reality
   - Cloudflare storage reality
   - capability governance reality

### 9.4 一句话结论

> **这一阶段可以收口；我们不该继续停留在“补骨架”的心智里，而应该转入“Worker-native runtime closure”阶段，把 session edge、external seams、storage reality 与 capability governance 做成真正的运行时现实。**

