# Plan After Foundations — Spike-Driven Code Hardening, Async Context Engine, and Worker-Matrix Pre-Convergence

> 文档对象：`nano-agent / after-foundations phase charter`
> 刷新日期：`2026-04-19`
> 作者：`Opus 4.7 (1M context)`
> 文档性质：`phase charter / execution plan / scope freeze / spike discipline / worker-matrix handoff`
> 输入依据：
> - `docs/plan-after-nacp.md`
> - `docs/plan-after-skeleton.md`（A1-A10 全部已 land、2nd/3rd round review 已闭合）
> - `docs/eval/new-plan-by-Opus.md`（Opus Phase 8 单 worker 提案，已被替代）
> - `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md`（GPT 5-worker 厚薄方案）
> - `docs/eval/after-foundations/worker-matrix-eval-with-Opus.md`（Opus 3-worker + 2 reserved）
> - `docs/eval/after-foundations/before-worker-matrix-eval-with-GPT.md`（GPT pre-matrix 验证期）
> - `docs/eval/after-foundations/before-worker-matrix-eval-with-Opus.md`（Opus pre-matrix + spike 双轮 + §8 ship code 修正）
> - `docs/eval/after-foundations/context-management-discussion-with-deepseek.md`（Deepseek 7 节功能价值表）
> - `docs/eval/after-foundations/context-management-eval-by-GPT.md`（GPT prepare/commit + hybrid storage）
> - `docs/eval/after-foundations/context-management-eval-by-Opus.md` v2（async compact 核心架构修正）
> - 当前 `packages/**` 真实代码事实（详见 §2）
> - 业主在 4 轮 eval pushback 中给出的 7 条决策事实（详见 §1）

---

## 0. 为什么这份文档要现在写

`plan-after-skeleton.md` 的 A1-A10 与 2nd/3rd round review 已经全部闭合。仓库现实已经从"协议 + 8 包 skeleton"演化为"协议冻结 + 8 包 + trace law + minimal capability + closure evidence"。

但**正因为前一阶段闭合得太成功**，下一阶段的方向出现了**4 轮持续修正**。这份 charter 的产生本身就是这 4 轮修正的最终收口：

```
修正 1：Opus 单 worker Phase 8（new-plan-by-Opus.md）
   ─ 把 KernelRunner 接进 session-do-runtime → 跑通单 worker 内部 turn
   ─ 业主 pushback：太弱，没强迫 NACP cross-worker reality

修正 2：用户 / GPT 5-worker matrix（worker-matrix-eval-with-GPT.md）
   ─ 5 个 Cloudflare worker 同时立项
   ─ Opus pushback：context.core / skill.core 没地基；颗粒度过细

修正 3：Opus 3-worker + 2 reserved binding（worker-matrix-eval-with-Opus.md）
   ─ 只立 agent.core / bash.core / filesystem.core，留 binding 名额
   ─ 业主 pushback：还不到 worker matrix 时点；packages/ 还没在 Cloudflare 真实环境验证

修正 4：业主 spike worker probe + after-foundations phase（本文）
   ─ worker matrix 之前先做 spike 验证 + ship 5 类代码
   ─ 异步全量上下文压缩 + context.core 升格为 first-wave worker
```

也就是说，本阶段的主轴从来不是"做下一个 worker"，而是：

> **在 packages/ 与 Cloudflare runtime reality 之间补一道 spike-driven validation gate，并在这道 gate 期间同步完成 context-management、storage adapters、fake-bash 扩展、hooks/nacp 协议升级 5 类代码 ship，让随后的 worker matrix 实施期成为"组装已验证组件"而不是"边写边验证"。**

简称：

> **After-Foundations Consolidation: Spike-Driven Code Hardening + Async Context Engine + Worker-Matrix Pre-Convergence**

---

## 1. 本轮已经确认的 Owner Decisions（直接生效）

这是本次 charter 的最高优先级输入，全部由业主在 4 轮 eval pushback 中明确给出。

### 1.1 Spike Worker 是核心方法论

1. **Worker matrix 之前必须有一道 spike validation gate**
   - 不能直接进入 worker matrix 实施
   - spike 是 **disposable probe**，不是 product seed
   - 出处：`before-worker-matrix-eval-with-Opus.md` §0 + §6

2. **Spike workers 必须真实部署到 Cloudflare 环境**
   - 不是 dev mode、不是 wrangler dev、是真实 production-shaped deploy
   - 不接生产数据 / 不持有业务数据 / 不实现新业务能力
   - 出处：业主原始 spike worker 提案（"可以部署在 cloudflare 环境的真实 worker"）

### 1.2 本阶段必须 ship 代码，不是 ship docs

3. **after-foundations 阶段的产出物是 shipped code，不只是 design docs**
   - 业主原话："本阶段不仅是做测试，以及文档撰写，而是必须要完成代码的新增，更新内容"
   - 必须 ship 的 5 类：context-management 新包、D1/R2/KV adapters、fake-bash 扩展、hooks 扩展、nacp 1.2.0 升级
   - 出处：业主对 `before-worker-matrix-eval-with-Opus.md` v1 §6.2 "out-of-scope" 的反驳

### 1.3 异步全量上下文压缩是核心能力

4. **异步上下文压缩是 nano-agent 的基石，不是可选项**
   - 业主原话："全量异步压缩式核心功能。是整个 nano-agent 的基石"
   - 业主原话："异步压缩，是 nano-agent 的核心功能"
   - 设计模式：**armed (~70-80%) → prepare (background LLM) → commit (atomic swap on turn boundary) → post**，加 hard-threshold (~95%) sync fallback
   - 已被 GitHub Copilot CLI 80%/20% 模式生产级验证
   - 出处：业主对 `context-management-eval-by-Opus.md` v1 §3.5 "物理不可行"的反驳

5. **Context.core 升格为 worker matrix first-wave worker**
   - 不再作为 reserved binding 名额
   - 异步压缩的 isolation 边界要求独立 worker
   - 出处：`context-management-eval-by-Opus.md` v2 §7.4

### 1.4 NACP 协议升级与 hook 扩展的时机

6. **协议升级与 hook 扩展必须在本阶段完成（spike 之后），不延后到 worker matrix 阶段**
   - 业主原话："保证我们在进入到 worker matrix 阶段，进行最大限度的 surface contract 冻结"
   - 顺序：spike → finding → 设计协议 → 1.2.0 RC → 用 spike 重新跑通 → 1.2.0 final → ship
   - 出处：业主对 `before-worker-matrix-eval-with-Opus.md` v1 §6.2 的反驳

### 1.5 Hybrid Storage + Tagged Conversation 双轨

7. **Context 物理存储走 hybrid（system/memory → KV、transcript → DO storage、tool result → R2 ref），逻辑视图保持单 message[] + tag**
   - 既不是 Deepseek 的"全部塞 KV 分层"，也不是 Opus v1 的"全部进单 message[]"
   - 出处：`context-management-eval-by-GPT.md` §4.3 hybrid storage 表 + `context-management-eval-by-Opus.md` v2 §5.3

---

## 2. 当前仓库的真实起点

今天的仓库现实，不再是"协议 + 8 包 skeleton + closure"，而是：

### 2.1 已经具备的 foundations

1. **协议地基已冻结**
   - `nacp-core` 1.1.0 frozen baseline + 1.0.0 compat shim
   - `nacp-session` 1.1.0 frozen，8 message kinds（含 `session.followup_input`）
2. **8 个 skeleton packages 已 closure**
   - `agent-runtime-kernel`、`capability-runtime`、`workspace-context-artifacts`、`session-do-runtime`、`llm-wrapper`、`hooks`、`eval-observability`、`storage-topology`
3. **跨包基础证据已建立**
   - root contract tests、cross-package E2E、deploy-shaped verification（A6 验收）
4. **A1-A10 闭合产物**
   - 包含 capability runtime 12-pack、grep alias、UTF-8 truncation、listDir-probe、git read-only subset、CrossSeamAnchor、`composeWorkspaceWithEvidence`、defaultEvalRecords sink fallback
5. **`KernelRunner` 类完整**（agent-runtime-kernel）
   - 但**从未在 session-do-runtime 实例化**（`composition.ts:95` 与 `remote-bindings.ts:386` 均 `kernel: undefined`）

### 2.2 Cloudflare-runtime 真实事实尚未验证的 gap（spike 必须暴露的 12 项）

| 类别 | 待验证事实 | 当前代码现状 |
|---|---|---|
| Storage | R2 multipart upload + list pagination + cursor 在真实 R2 上的行为 | `NullStorageAdapter` 全抛 "not connected" (`storage-topology/src/adapters/scoped-io.ts:87-127`) |
| Storage | KV stale-read window 与 put-then-get consistency | 同上 |
| Storage | DO storage 的 transactional get/put + 与 KV 协作 | 同上 |
| Storage | `MemoryBackend` vs 真实 DO storage 的语义差异 | `MemoryBackend` 可用、`ReferenceBackend` 全抛 "not connected" (`workspace-context-artifacts/src/backends/reference.ts:19-47`) |
| Storage | `ScopedStorageAdapter` 接口在真实 D1/R2/KV 上是否成立 | 接口仅 typed seam |
| Bash | fake-bash filesystem capabilities 在真实 DO 沙箱里的行为 | 12-pack 仅本地 vitest 验证 |
| Bash | curl 真实 outgoing fetch quota / cpu_ms / subrequest count | `CURL_NOT_CONNECTED_NOTE = "curl-not-connected"` (`capability-runtime/src/capabilities/network.ts:38`) |
| Binding | service binding latency / timeout / cancellation / retry 在真实 deploy 下的行为 | `remote-bindings.ts` 已就绪但未真实跨 worker 验证 |
| Binding | `CrossSeamAnchor` headers 在真实 service-binding 下的传播 | 已定义但未生产验证 |
| Binding | hooks `service-binding` runtime 在真实 binding 下的回调延迟 | 同上 |
| Binding | capability `ServiceBindingTarget` 在真实 binding 下的执行 | 同上 |
| Binding | eval sink fan-in 在跨 worker 下的 ordering 与 dedup | 已设计但未跨 worker 验证 |

### 2.3 Context-management 的真实起点

| 维度 | 当前代码 | 缺口 |
|---|---|---|
| 装配 | `ContextAssembler / CompactBoundaryManager / WorkspaceSnapshotBuilder` 已就绪 (`workspace-context-artifacts/src/index.ts`) | 无独立 strategy 层 |
| Compose | `composeWorkspaceWithEvidence` 已就绪 (`session-do-runtime/src/workspace-runtime.ts:75-101`) | 无 async planner / committer |
| Layer 类型 | `ContextLayerKind` 6 个：system/session/workspace_summary/artifact_summary/recent_transcript/injected | 缺 memory / messages / tool_result tag |
| Compact 协议 | `nacp-core/messages/context.ts` 仅 `compact.request/response` 2 message | 缺 prepare/commit 双阶段 message |
| Hook | `packages/hooks/src/catalog.ts` 仅 8 events，含 PreCompact/PostCompact | 缺 ContextPressure / ContextCompactArmed / ContextCompactPrepareStarted / ContextCompactCommitted |
| Inspector | 无 | 缺 HTTP/WS endpoint + claude-code `get_context_usage` 同款 schema |
| Buffer policy | 无显式 | 缺 soft (~70-80%) + hard fallback (~95%) 双阈值 |

因此，本阶段的起点不是"继续做包内 integration"，而是：

> **在已有 foundations 与 Cloudflare runtime reality 之间，用 2 轮 spike 暴露真相，并基于真相 ship 5 类 code，让 worker matrix 阶段从"边写边验证"降级为"组装已验证组件"。**

---

## 3. 本阶段的一句话目标

> **用 2 轮 disposable spike worker 在真实 Cloudflare 环境验证 packages/ 的 platform-shaped truth；基于 spike findings 同期 ship 5 类代码（新建 `packages/context-management/` 含 async compact 核心、storage-topology 2.0.0 含真实 D1/R2/KV adapter、capability-runtime fake-bash 扩展、hooks 8→18 events、nacp-core/session 1.2.0 升级）；并把 context.core 升格为 worker matrix first-wave worker；产出物是 shipped code + frozen contracts + validated adapters + 2 个 spike findings docs。**

---

## 4. 本阶段边界：In-Scope / Out-of-Scope

这是本文件最重要的部分。**先定边界，再谈 phases。**

### 4.1 In-Scope（本阶段必须完成）

#### A. Spike Round 1 — Bare-metal Cloudflare Truth Probe

1. `spike-do-storage` 单 worker 部署到真实 Cloudflare 环境
2. `spike-binding-pair` 双 worker 部署，service-binding 真实通讯
3. 跑过 §2.2 的 12 个待验证事实
4. 输出 3 份 findings doc：`docs/spikes/storage-findings.md` / `binding-findings.md` / `fake-bash-platform-findings.md`
5. 每个 finding 必须包含：现象 / 根因 / 对 packages/ 的影响 / 对 worker matrix 的影响

#### B. Storage Adapter Hardening

6. ship `storage-topology` 2.0.0：major bump（接口 breaking change）
7. 新增 `D1Adapter / R2Adapter / KvAdapter / DOStorageAdapter`，全部经 spike 验证
8. 修订 `ScopedStorageAdapter` 接口：cursor、multipart、stale-read 显式化
9. `ReferenceBackend` 在 KV / R2 / DO 路径上接通

#### C. Fake-Bash Extension & Just-Bash Port

10. 优先 port 高频文本能力：sed / awk / jq / wc / head / tail / sort / uniq
11. 接通 curl real fetch（spike 验证后），明确 outgoing fetch quota 边界
12. 明确 ts-exec / python 等 not-connected 边界（保持显式标记，不要在 worker 化时偷偷"让它连"）
13. 维持 git read-only subset（write 留给 worker matrix 后）

#### D. Context-Management 新包（含异步压缩核心）

14. 新建 `packages/context-management/` 包
15. 子模块：`budget/` / `strategy/` / `async-compact/` / `storage/` / `lifecycle/` / `inspector/`
16. **`async-compact/` 是核心**：armed → prepare → commit 三阶段 + CoW context fork + atomic swap on turn boundary + hard-threshold sync fallback
17. `inspector/` 提供 HTTP `/inspect/sessions/:id/context/{usage,layers,policy,snapshots}` + WS `/inspect/sessions/:id/context/stream`
18. Buffer policy 含 soft (~70-80%) + hard fallback (~95%) 双阈值，借鉴 claude-code `AUTOCOMPACT_BUFFER_TOKENS = 13_000` 等数字

#### E. Hooks Catalog Expansion (8 → 18)

19. 保留 8：SessionStart / SessionEnd / UserPromptSubmit / PreToolUse / PostToolUse / PostToolUseFailure / PreCompact / PostCompact
20. 新增 6（claude-code 借鉴）：Setup / Notification / Stop / StopFailure / PermissionRequest / PermissionDenied
21. 新增 2（环境）：FileChanged / CwdChanged
22. 新增 4（异步 compact lifecycle）：ContextPressure / ContextCompactArmed / ContextCompactPrepareStarted / ContextCompactCommitted
23. `hooks` 包升级到 1.0.0（catalog 扩张是该包最 load-bearing 的契约）

#### F. NACP Protocol Upgrade

24. `nacp-core` 1.1.0 → 1.2.0：扩展 `context.compact.prepare/commit.*`、新增 `context.budget.exceeded`
25. `nacp-session` 1.1.0 → 1.2.0：新增 `session.context.usage.snapshot`（inspector 走 NACP envelope schema 但走独立 HTTP/WS 路由）
26. 1.0.0 / 1.1.0 compat shim 全部保留
27. **不**新增 `storage.*` 单独 family（storage 内部状态不应穿透到协议层）
28. **不**新增 `context.assemble.*` 等 layer-level message（装配在 worker 内部）

#### G. Spike Round 2 — Integrated Validation

29. 接入第二、三波 ship 出来的 adapter / context-management / 扩展协议
30. 在 spike worker 重跑 end-to-end
31. 输出 `docs/spikes/integrated-findings.md`：验证 ship 的代码是否消化了 Round 1 的真相

#### H. Worker-Matrix Pre-Convergence

32. 在 service-binding 目录中**预留** `agent.core / bash.core / filesystem.core / context.core` 4 个 first-wave worker 的 binding 名额（**注意 context.core 升格**）
33. 在 service-binding 目录中**预留** `skill.core` 名额，但不立项
34. 输出 `docs/handoff/after-foundations-to-worker-matrix.md`：列出所有已 ship、已冻结、已验证的组件

#### I. 收口与下阶段交接

35. 为每个 Phase 产出 closure note
36. 输出当前阶段 closure memo
37. 输出下一阶段（worker matrix）handoff memo

### 4.2 Out-of-Scope（本阶段明确不做）

#### A. Worker Matrix 实施

1. 完整 5-worker matrix implementation
2. agent.core / bash.core / filesystem.core / context.core 真实 worker shell（仅预留 binding 名额）
3. KernelRunner 在 production session-do-runtime 实例化（仍保持 spike-only 验证）

#### B. Skill / Frontend 扩展

4. `skill.core` worker 立项
5. browser / scraping / search productization
6. 完整 frontend-facing API / DDL
7. timeline / artifact business DDL
8. 注册中心 / business data model

#### C. Storage / Context 终态

9. 跨 adapter 的 cross-namespace transactional reference 实现
10. 完整 D1 schema-first ORM
11. 最终 context strategy 全冻结（async compact 第一版即可，策略层留迭代空间）
12. SessionMemory 跨 device 同步

#### D. Just-Bash 全量

13. 完整 just-bash port（仅 port 高频子集）
14. python3 / sqlite3 / 浏览器子集（除非 spike 单独验证 D1 时 sqlite3 也覆盖）
15. shell 复杂 features（管道嵌套 / 重定向 / heredoc / process substitution）

#### E. 生产化

16. production-grade dashboard / alerting platform
17. billing / tenant operations layer
18. SLO / on-call / runbook（这些是 worker matrix 之后）

### 4.3 一个必须写明的例外

虽然本阶段把 worker matrix 实施放到下一阶段，但这不代表本阶段可以回避 worker-shape 工作。

本阶段必须完成的例外是：

1. spike worker shell（disposable，但必须 deploy-shaped）
2. service binding 名额预留（4 first-wave + 1 reserved）
3. wrangler.toml / compatibility_date 模板（worker matrix 阶段直接复用）

所以准确说法是：

> **本阶段不做 worker matrix 实施；但必须完成 spike worker 真实部署、service binding 名额预留、以及 worker matrix 阶段所需的所有已验证组件 ship。**

---

## 5. 本阶段的方法论

### 5.1 Spike 方法论：Disposable Probe Discipline

继承 `before-worker-matrix-eval-with-Opus.md` §4.3 的 5 条纪律 + §8.5.3 的 2 条补充：

1. spike 代码放 `spikes/` 顶级目录（**不进** `packages/`）
2. spike 必须有 expiration date（推荐 2026-08-01 之前删除或转正式 worker）
3. spike 不接 CI 主链
4. spike 的发现必须落到 design doc，**不能只在代码注释里**
5. spike 不接生产数据 / 不持有业务数据 / 不实现新业务能力
6. 两轮 spike 分目录：`spikes/round-1-bare-metal/` 与 `spikes/round-2-integrated/`，互不污染
7. **轮 1 spike 不依赖任何 packages/ 代码** —— 它是 platform reality 探针，必须独立

### 5.2 Sequencing 方法论：Spike-First-Iteration

破"先 spike 再 ship code 还是先 ship code 再 spike"的 chicken-and-egg：

> **轮 1 spike (bare-metal, 不接 packages/) → 暴露 platform truth → ship code (基于 truth) → 轮 2 spike (integrated, 接 ship 后的 packages/) → 验证 truth 已被消化**

```
Phase 0 → 轮 1 spike, 0 dependency on packages/
Phase 1-5 → ship code in 5 categories
Phase 6 → 轮 2 spike, full integration
```

### 5.3 Code Ship 方法论：Maximal Surface Contract Freeze

继承 `plan-after-skeleton.md` §5.1 的 Maximal Known-Surface Contract，扩展为：

> **本阶段所有 ship 的代码必须经过 spike 验证后再 frozen；所有 ship 的协议必须用 spike 重新跑通后再 ship final。**

也就是说：
- ❌ 错误顺序：先猜测协议升级 → ship 1.2.0 → spike 验证 → 发现猜错 → ship 1.3.0
- ✅ 正确顺序：spike → finding → 设计协议 → 1.2.0 RC → 用 spike 重新跑通 → 1.2.0 final → ship

### 5.4 Async Context Compaction 方法论：CoW Fork + Prepare/Commit

异步全量上下文压缩 canonical lifecycle（owner decision §1.3）：

```
[阶段 1 — armed]
  当 token usage 达到 SOFT_THRESHOLD (~70-80%):
    · CompactionScheduler 进入 armed 状态
    · 触发 ContextCompactArmed hook
    · 不立即触发，等下一个 idle window 或 turn boundary

[阶段 2 — prepare]
  在 armed 状态下，找到 background-eligible 时机:
    · CompactionPlanner.fork(currentContext) → ContextCandidate (CoW)
    · ContextCandidate 共享 immutable layers (system/memory)
    · 启 background LLM call (cheaper compact-specific model)
    · 当前 turn 不被影响
    · 触发 ContextCompactPrepareStarted hook

[阶段 2.5 — preparing (期间)]
  · agent 继续用 currentContext 推理 turn N+1, N+2, ...
  · CompactionScheduler 监控：
      - background summary 是否完成
      - currentContext usage 是否逼近 HARD_THRESHOLD (~95%)
  · 如果 currentContext 超过 HARD_THRESHOLD 而 summary 还没好:
      → 强制 fallback synchronous compact (graceful degradation)

[阶段 3 — commit]
  background summary 完成 + 处于 turn boundary / session idle:
    · CompactionCommitter.atomicSwap(currentContext, preparedSummary)
    · 写新 context to KV / DO storage
    · 旧 context 保留为 versioned snapshot (满足 user rollback)
    · 触发 ContextCompactCommitted hook
    · 下一个 turn 用新 context

[阶段 4 — post]
  · 触发 PostCompact hook (已有)
  · 清理 stale candidates
  · 更新 inspection endpoint metrics
```

### 5.5 Context Storage 方法论：Hybrid Tier + Tagged Conversation 双轨

继承 owner decision §1.5：

| 层 | 物理存储 | 逻辑视图 |
|---|---|---|
| system | KV | tag = "system" |
| memory | KV | tag = "memory" |
| active transcript head | DO memory / DO storage | tag = "interaction" |
| tool results / large payloads | artifact refs + R2 / DO storage | tag = "tool_result" |
| compact summaries / manifests | KV 或 D1 manifest | tag = "summary" |
| RAG knowledge chunk | 按需检索（不常驻） | tag = "knowledge_chunk" |

**装配时**：从所有 tier 拉取 → 按 tag filter → 按 priority 排序 → 拼成单 prompt

---

## 6. 重新划分后的 Phases

本阶段 Phase 拆分遵循 3 个原则：

1. **轮 1 spike 必须先于所有 ship code** —— 防止猜测式协议升级
2. **5 类 ship code 按依赖顺序展开** —— storage adapters → fake-bash → context-management → hooks → nacp
3. **轮 2 spike 是所有 ship code 的 verification gate**

| Phase | 名称 | 类型 | 核心目标 | 主要风险 |
|------|------|------|----------|----------|
| **Phase 0** | Spike Round 1: Bare-metal Cloudflare Truth Probe | spike phase | 用 2 个 disposable worker 在真实 Cloudflare 暴露 platform truth | spike 退化为 product / 12 验证项不完整 |
| **Phase 1** | Storage Adapter Hardening | code-ship phase | ship `storage-topology` 2.0.0 with D1/R2/KV/DO adapters | 接口 breaking 影响下游 / R2 multipart 边界未考虑 |
| **Phase 2** | Fake-Bash Extension & Just-Bash Port | code-ship phase | port 高频文本能力 + 接通 curl + 维持 ts-exec/python 边界 | 试图 port 太多导致 worker cpu_ms 上限 / 模糊 not-connected 边界 |
| **Phase 3** | Context-Management New Package (with async compact core) | code-ship phase | ship `packages/context-management/`，async compact 三阶段 + CoW + inspector | async lifecycle bug / hard fallback 缺失导致死锁 |
| **Phase 4** | Hooks Catalog Expansion (8 → 18) | code-ship phase | ship `hooks` 1.0.0 with 18 events including 4 async compact lifecycle | Catalog 扩张破坏现有 outcome reducer / session mapper |
| **Phase 5** | NACP Protocol Upgrade (1.2.0) | code-ship phase | ship `nacp-core` / `nacp-session` 1.2.0 + compat shim | 1.0.0 / 1.1.0 用户 break / 协议过早冻结 |
| **Phase 6** | Spike Round 2: Integrated Validation | spike phase | 用 ship 后的 packages 在 spike worker 重跑 e2e | 集成验证暴露的问题没时间修复 |
| **Phase 7** | Worker-Matrix Pre-Convergence & Handoff | handoff phase | 预留 binding 名额 / 输出 handoff memo | handoff memo 漏掉关键已验证组件 |

> closure / handoff 不再单独占一个 Phase，而作为每个 Phase 的 ritual + 本阶段的最终 exit pack。

---

## 7. 各 Phase 详细说明

### 7.1 Phase 0 — Spike Round 1: Bare-metal Cloudflare Truth Probe

#### 实现目标

用 2 个 disposable spike worker 在真实 Cloudflare 环境暴露 §2.2 的 12 个待验证事实，输出 3 份 findings doc。

#### In-Scope

1. `spike-do-storage` 单 worker（验证 storage + fake-bash platform 行为）
2. `spike-binding-pair` 双 worker（验证 service binding contract）
3. 12 个验证项每项有 finding 文档
4. 5 条 spike 纪律全部立起（§5.1）

#### 交付物

1. `spikes/round-1-bare-metal/spike-do-storage/` 真实部署
2. `spikes/round-1-bare-metal/spike-binding-pair/` 真实部署
3. `docs/spikes/storage-findings.md`
4. `docs/spikes/binding-findings.md`
5. `docs/spikes/fake-bash-platform-findings.md`
6. `docs/spikes/_TEMPLATE-finding.md`（finding 模板）

#### 收口标准

1. 至少一次 wrangler deploy 成功，能从外网访问
2. R2 / KV / DO binding 全部可用
3. 12 验证项每项有 finding 文档
4. 至少 5 个真实 finding 落入 design doc
5. 至少 1 个 packages/ 接口需要修改的发现（证明 spike 抓到了本地测不出的 gap）

### 7.2 Phase 1 — Storage Adapter Hardening

#### 实现目标

基于 Phase 0 的 storage findings，ship `storage-topology` 2.0.0 with 真实 D1 / R2 / KV / DO adapters。

#### In-Scope

1. `ScopedStorageAdapter` 接口修订（cursor、multipart、stale-read 显式化）
2. 新建 `packages/storage-topology/src/adapters/d1-adapter.ts`
3. 新建 `packages/storage-topology/src/adapters/r2-adapter.ts`（multipart + cursor pagination）
4. 新建 `packages/storage-topology/src/adapters/kv-adapter.ts`（显式 stale-read 标注）
5. 新建 `packages/storage-topology/src/adapters/do-storage-adapter.ts`（transactional get/put）
6. `ReferenceBackend` 接通 R2 / KV / DO 路径
7. version bump 到 2.0.0（major，因为接口 breaking）

#### 交付物

1. 4 个新 adapter 文件 + 测试
2. `ScopedStorageAdapter` 接口修订 RFC：`docs/rfc/scoped-storage-adapter-v2.md`
3. `ReferenceBackend` 接通后的 e2e 测试
4. `storage-topology` 2.0.0 changelog

#### 收口标准

1. 4 个 adapter 全部经过 Phase 0 spike 验证后再 finalize
2. `ReferenceBackend` 在真实 KV/R2/DO 上跑通基本 read/write/list
3. `storage-topology` 2.0.0 ship，0.x → 2.0.0 compat note
4. cross-package E2E（依赖 storage 的所有包）全绿

### 7.3 Phase 2 — Fake-Bash Extension & Just-Bash Port

#### 实现目标

基于 Phase 0 的 fake-bash-platform findings，扩展 fake-bash 能力，port 高频 just-bash 子集。

#### In-Scope

1. port sed / awk / jq / wc / head / tail / sort / uniq（高频文本处理）
2. 接通 curl real fetch（`CURL_NOT_CONNECTED_NOTE` 改为可选 stub）
3. 明确 ts-exec / python / sqlite3 / browser 等仍保持 not-connected 标记
4. 维持 git read-only subset
5. 更新 `PX-capability-inventory.md` 反映新增能力
6. inventory drift guard CI test 跟随更新

#### 交付物

1. `packages/capability-runtime/src/capabilities/text-processing.ts`（新）
2. `packages/capability-runtime/src/capabilities/network.ts`（curl 接通 + quota 守卫）
3. `docs/design/after-foundations/P2-fake-bash-extension-policy.md`（哪些 port、哪些不 port、为什么）
4. inventory drift guard test 更新

#### 收口标准

1. 新增能力全部经 Phase 0 spike 在真实 worker 验证（cpu_ms / subrequest 不超限）
2. curl 接通后明确 outgoing fetch quota 边界
3. 仍 not-connected 的能力保持显式标记，不偷偷"让它连"
4. 12-pack 的 governance（unsupported / risky / ask-gated）保持

### 7.4 Phase 3 — Context-Management New Package (with async compact core)

#### 实现目标

新建 `packages/context-management/` 包，**核心是异步全量上下文压缩**（owner decision §1.3）。

#### In-Scope

1. 新建 `packages/context-management/` 包骨架
2. `budget/`：BufferPolicy + soft (~70-80%) + hard fallback (~95%) + 3 env override
3. `strategy/`：tagged-message + compaction-policy + microcompact-planner + api-context-edit + full-compact (sync fallback)
4. **`async-compact/`（核心）**：scheduler + candidate (CoW fork) + planner + prepare-job + committer + version-history + fallback
5. `storage/`：tier-router + kv-tier + do-storage-tier + r2-ref-tier
6. `lifecycle/`：session-memory-extractor (后台 forked agent) + session-memory-loader + prepared-artifact-promoter + file-cache-dedup
7. `inspector/`：http-route + ws-route + usage-report (claude-code `get_context_usage` 同款 schema) + inspector-auth + inspector-redact

#### 交付物

1. `packages/context-management/` 全部子模块
2. `packages/context-management/test/` 含 async lifecycle e2e（fake provider 驱动）
3. `docs/design/after-foundations/P3-context-management-async-compact.md`
4. `docs/design/after-foundations/P3-context-management-inspector.md`
5. `packages/context-management/CHANGELOG.md` 0.1.0 RC

#### 收口标准

1. async lifecycle 4 阶段（armed → prepare → commit → post）能在 fake provider 上跑通
2. CoW fork 不破坏 current turn 推理
3. hard-threshold sync fallback 能在压缩超时时自动接管
4. inspector HTTP/WS endpoint 能返回 claude-code 同款 usage schema
5. 全部 18 hook events 中 4 个 async lifecycle hook 已 wire
6. 通过 Phase 0 spike 确定的 storage tier 路由真实可用

### 7.5 Phase 4 — Hooks Catalog Expansion (8 → 18)

#### 实现目标

把 `packages/hooks/src/catalog.ts` 从 8 events 扩到 18 events，bump 到 1.0.0。

#### In-Scope

1. catalog 新增 10 events：Setup / Notification / Stop / StopFailure / PermissionRequest / PermissionDenied / FileChanged / CwdChanged / ContextPressure / ContextCompactArmed / ContextCompactPrepareStarted / ContextCompactCommitted（实际 +10 个，去重后 18 总）
2. 每个新 event 的 `allowedOutcomes` / `payloadSchema` / `redactionHints` / `blocking` 显式定义
3. outcome reducer 与 session mapper 跟随更新
4. `core-mapping.ts` / `session-mapping.ts` / `audit.ts` 跟随更新

#### 交付物

1. `packages/hooks/src/catalog.ts` 扩张
2. `docs/design/after-foundations/P4-hooks-catalog-expansion.md`
3. `packages/hooks/test/` 增补 10 个新 event 的 contract test
4. `hooks` 1.0.0 changelog

#### 收口标准

1. 18 events 在 outcome reducer / session mapper 全部走通
2. 4 个 async compact lifecycle hook 与 Phase 3 的 `async-compact/` 真实 wire
3. PermissionRequest / PermissionDenied 与 capability-runtime 的 ask-gated governance 真实 wire
4. FileChanged / CwdChanged 与 fake-bash 的 filesystem capability 真实 wire
5. `hooks` 1.0.0 ship，0.x compat note

### 7.6 Phase 5 — NACP Protocol Upgrade (1.2.0)

#### 实现目标

`nacp-core` 1.1.0 → 1.2.0、`nacp-session` 1.1.0 → 1.2.0。

#### In-Scope

1. `nacp-core/messages/context.ts` 扩展：`context.compact.prepare.request/response`、`context.compact.commit.request/response`、`context.budget.exceeded`
2. `nacp-session/messages.ts` 新增：`session.context.usage.snapshot`
3. 1.0.0 / 1.1.0 compat shim 全部保留
4. 协议升级 RFC

#### 交付物

1. `nacp-core` 1.2.0 with 扩展的 context message family
2. `nacp-session` 1.2.0 with 新增的 inspect message
3. `docs/rfc/nacp-core-1.2.0.md` + `docs/rfc/nacp-session-1.2.0.md`
4. compat shim 测试

#### 收口标准

1. 1.2.0 协议在 Phase 0 spike worker 跑通 e2e
2. 1.0.0 / 1.1.0 用户全部不 break（compat test 全绿）
3. 协议 schema 与 Phase 3 / Phase 4 的实现一一对应
4. **不**新增 `storage.*` 单独 family、**不**新增 `context.assemble.*` 等 layer message

### 7.7 Phase 6 — Spike Round 2: Integrated Validation

#### 实现目标

把 Phase 1-5 ship 的代码接入 spike worker，重跑 e2e，验证真相已被消化。

#### In-Scope

1. `spikes/round-2-integrated/` 目录新建
2. 接入 ship 后的 storage adapters / fake-bash 扩展 / context-management / hooks 1.0.0 / nacp 1.2.0
3. 在 spike worker 跑 async compact 完整 lifecycle
4. 在 spike worker 跑 hybrid storage tier 路由
5. 在 spike worker 验证 inspector HTTP/WS endpoint 真实可访问
6. 输出 `docs/spikes/integrated-findings.md`

#### 交付物

1. `spikes/round-2-integrated/` 真实部署
2. `docs/spikes/integrated-findings.md`：列出每个 ship 的代码是否经过 platform 真实验证

#### 收口标准

1. async compact 在真实 Cloudflare 环境跑过完整 armed → prepare → commit → post 一轮
2. hybrid storage tier 在真实 KV / R2 / DO 上验证（每个 tier 至少 1 次成功 read+write）
3. inspector endpoint 能从外网访问并返回正确 schema
4. 18 hook events 中至少 12 个在 spike 中真实触发（剩余 6 个用 unit test 覆盖）

### 7.8 Phase 7 — Worker-Matrix Pre-Convergence & Handoff

#### 实现目标

为 worker matrix 阶段准备所有 prerequisites，输出 handoff memo。

#### In-Scope

1. service binding 名额预留（4 first-wave + 1 reserved）
2. wrangler.toml 模板：`docs/templates/wrangler-worker.toml`
3. composition factory 模板：`docs/templates/composition-factory.ts`
4. handoff memo：列出所有已 ship、已冻结、已验证的组件

#### 交付物

1. `docs/handoff/after-foundations-to-worker-matrix.md`：包含
   - 所有 ship 的代码与 version
   - spike 验证过的能力清单
   - 未验证但已设计的能力清单
   - worker matrix 阶段的 readiness checklist
2. `docs/templates/wrangler-worker.toml`
3. `docs/templates/composition-factory.ts`

#### 收口标准

1. handoff memo 涵盖本阶段所有 ship 的 5 类代码
2. worker matrix first-wave 4 worker（agent.core / bash.core / filesystem.core / **context.core**）的 binding 名额已预留
3. skill.core 名额预留但 explicit defer
4. 本阶段 closure note 全部回填

---

## 8. 执行顺序与 DAG

### 8.1 推荐执行顺序

1. **Phase 0** — Spike Round 1: Bare-metal Cloudflare Truth Probe
2. **Phase 1** — Storage Adapter Hardening
3. **Phase 2** — Fake-Bash Extension & Just-Bash Port（与 Phase 1 部分并行）
4. **Phase 3** — Context-Management New Package
5. **Phase 4** — Hooks Catalog Expansion（与 Phase 3 部分并行）
6. **Phase 5** — NACP Protocol Upgrade（必须在 Phase 3 + Phase 4 之后）
7. **Phase 6** — Spike Round 2: Integrated Validation
8. **Phase 7** — Worker-Matrix Pre-Convergence & Handoff

### 8.2 推荐 DAG

```text
Phase 0 (Spike Round 1: Bare-metal)
  ├─→ Phase 1 (Storage Adapter Hardening)
  └─→ Phase 2 (Fake-Bash Extension)

Phase 1
  └─→ Phase 3 (Context-Management new package)
       │  └─ uses storage adapters via tier-router

Phase 1 + Phase 3
  └─→ Phase 4 (Hooks Catalog Expansion)
       │  └─ wires async compact lifecycle hooks

Phase 3 + Phase 4
  └─→ Phase 5 (NACP 1.2.0 Upgrade)
       │  └─ message shapes match Phase 3 + Phase 4 implementations

Phase 1, 2, 3, 4, 5 全部 ship
  └─→ Phase 6 (Spike Round 2: Integrated)

Phase 6
  └─→ Phase 7 (Worker-Matrix Pre-Convergence & Handoff)
```

### 8.3 为什么这样排

1. **Phase 0 必须最先**：所有 ship code 都依赖 Phase 0 暴露的 platform truth；任何在 Phase 0 之前 ship 的代码都是猜测
2. **Phase 1 在 Phase 2 / 3 之前**：context-management 的 hybrid storage tier 路由依赖真实 storage adapters；fake-bash 接通 curl 也需要 Phase 0 暴露 quota 边界
3. **Phase 3 在 Phase 4 之前**：4 个 async compact lifecycle hook 的 producer 在 context-management `async-compact/`；没有 producer 就是死代码
4. **Phase 5 必须最后 ship 协议**：协议形状必须与实际 Phase 3 + Phase 4 的实现一致，不能预先冻结
5. **Phase 6 是所有 ship code 的 verification gate**：进入 worker matrix 前必须有 integrated 验证
6. **Phase 7 是 handoff，不是新建**：纯 documentation + template

### 8.4 估计时长

| Phase | 时长 | 累计 |
|---|---|---|
| Phase 0 | 1-2 周 | 2 周 |
| Phase 1 | 1 周（部分与 Phase 0 重叠） | 2.5 周 |
| Phase 2 | 1 周（与 Phase 1 并行） | 2.5 周 |
| Phase 3 | 2 周（异步 compact 是核心，工作量大） | 4.5 周 |
| Phase 4 | 0.5 周（与 Phase 3 并行末段） | 4.5 周 |
| Phase 5 | 0.5 周 | 5 周 |
| Phase 6 | 1 周 | 6 周 |
| Phase 7 | 0.5 周 | 6 周 |

**总时长：5-6 周。** 比 plan-after-skeleton 阶段短，因为不是 greenfield；但比单纯 spike 多 50-70%，因为产出物从 docs 升级为 shipped code。

---

## 9. 执行方法

### 9.1 每个 Phase 都必须先有 Design Artifact

继承 `plan-after-skeleton.md` §9.1。最低要求：

1. 问题定义
2. in-scope / out-of-scope
3. 与 Phase 0 spike findings 的关系
4. contract 影响面
5. failure paths
6. test matrix
7. closure criteria

### 9.2 每个 Phase 按批次执行

每个 Phase 拆 2-4 个实现批次。每个批次必须：

1. 有明确交付物（文件路径）
2. 有独立测试目标
3. 有 spike 验证 checkpoint（如果适用）
4. 有 observability 埋点要求

### 9.3 每个 Phase 都有三道 Gate（继承 plan-after-skeleton）

#### Start Gate

1. design artifact 已写出
2. scope 已冻结
3. test matrix 已列出
4. **Phase 0 已闭合**（除 Phase 0 自身）

#### Build Gate

1. 批次已拆分
2. contract 影响面已识别
3. observability 接线计划已明确
4. spike 验证窗口已规划

#### Closure Gate

1. phase closure criteria 全部满足
2. tests 已存在
3. closure note 已回填
4. 下游依赖已更新
5. **如适用，Phase 6 spike re-test 已规划**

### 9.4 Spike 双轮的特殊纪律

继承 §5.1 的 7 条 + 补充 1 条：

8. **Phase 6 Round 2 spike 必须在 Phase 1-5 全部 ship 后才启动** —— 防止边 ship 边改 spike 导致 finding 失真

---

## 10. 测试与验证策略

### 10.1 五层测试结构（继承 plan-after-skeleton §10.1）

1. Package tests
2. Root contract tests
3. Cross-package E2E
4. **Spike-shaped real-Cloudflare verification**（本阶段新增）
5. Chaos / failure injection

### 10.2 本阶段必须新增的验证

1. **轮 1 spike**：12 个 platform 验证项（§2.2）
2. **轮 2 spike**：5 类 ship code 的 integrated e2e
3. async compact lifecycle 4 阶段 contract test
4. CoW fork 不破坏 current turn 推理 test
5. hard-threshold sync fallback test
6. hybrid storage tier 路由 test
7. inspector HTTP/WS endpoint test（含 redact）
8. hooks 18 events 全 contract test
9. nacp 1.2.0 + 1.1.0 + 1.0.0 compat shim test
10. storage-topology 2.0.0 cross-adapter consistency test

### 10.3 Spike 验证项与 ship code 的双向 traceability

每个 ship 的代码模块必须能反向追踪到至少 1 个 spike finding；每个 spike finding 必须前向追踪到至少 1 个 ship 的代码模块。

> 这是本阶段最严格的要求 —— 没有 spike 验证的代码不能 ship；没有产生代码影响的 spike 是浪费。

---

## 11. 本阶段的退出条件（Exit Criteria）

只有当下面条件全部成立时，本阶段才可关闭：

1. Phase 0 轮 1 spike 真实部署 + 3 份 findings doc 已 ship
2. `storage-topology` 2.0.0 ship with 4 真实 adapter
3. `capability-runtime` fake-bash 扩展 ship with 高频 just-bash 子集
4. `packages/context-management/` 0.1.0 ship with async compact 核心
5. `hooks` 1.0.0 ship with 18 events
6. `nacp-core` / `nacp-session` 1.2.0 ship with compat shim
7. Phase 6 轮 2 spike 真实部署 + integrated findings doc 已 ship
8. handoff memo 已写完，列出所有已验证 / 已冻结组件
9. service binding 名额（4 + 1）已预留
10. 每个 Phase 的 closure note 已完成
11. 5 类 ship code 全部经过 spike 双向 traceability 验证

---

## 12. 下一阶段：什么会成为正式 In-Scope

当前阶段关闭后，下一阶段切换为：

> **Worker Matrix Implementation Phase**

### 12.1 下一阶段的 4 个 first-wave worker

1. **agent.core** — `session-do-runtime` + `nacp-session` + KernelRunner + llm-wrapper + hooks 真实组装
2. **bash.core** — `capability-runtime` 12-pack + 高频 just-bash 子集 + ServiceBindingTarget
3. **filesystem.core** — `WorkspaceNamespace` + storage-topology 2.0.0 真实 adapter（KV + DO + R2）
4. **context.core** — `packages/context-management/` 全部子模块，**async compact engine 是独立 worker 的根本理由**

### 12.2 下一阶段的 1 个 reserved 名额

5. **skill.core** — 仅预留 binding 名额，待真实产品需求出现时再立项；甚至可拆为 browser-worker / search-worker / scrape-worker，避免 monolith creep

### 12.3 为什么这些要放到下一阶段

因为它们都依赖本阶段先完成：

1. spike 双轮验证
2. storage-topology 2.0.0 真实 adapter
3. fake-bash 扩展后的 capability surface
4. context-management 异步 compact engine
5. hooks 1.0.0 with 18 events
6. nacp 1.2.0 协议升级

没有这些已 ship + 已验证的组件，worker matrix 阶段就会回到"边写边验证"，违反本阶段建立的 spike-first-iteration 原则。

---

## 13. 最终 Verdict

### 13.1 对当前阶段的最终定义

本阶段不应再被表述为：

> "继续做 worker"

而应被表述为：

> **"在已存在 foundations 的基础上，用 2 轮 disposable spike 在真实 Cloudflare 环境暴露 platform truth，并基于 truth 同期 ship 5 类代码（context-management 含 async compact 核心、storage-topology 2.0.0 with 真实 adapter、fake-bash 扩展、hooks 1.0.0 with 18 events、nacp 1.2.0），让随后的 worker matrix 实施期成为‘组装已验证组件’而不是‘边写边验证’。"**

### 13.2 一句话总结

> **After foundations, the next job is not building workers. The next job is to validate the foundations against Cloudflare runtime reality with disposable spike workers, then ship a hardened context-management package with async compact engine, real storage adapters, extended fake-bash, expanded hook taxonomy, and an upgraded NACP protocol — so that the subsequent worker-matrix phase becomes assembling verified components instead of writing-while-discovering.**

---

## 14. 后续文档生产清单与撰写顺序

本阶段不应在没有设计文档的前提下直接进入实现。继承 `plan-after-skeleton.md` §14 的方法：

1. **先写 phase-level design / decision / policy memo**
2. **待对应 design 冻结后，再写 action-plan**
3. **再进入具体实现批次**

### 14.1 推荐的 design / memo 文件列表

建议统一放在：

> `docs/design/after-foundations/`

并统一采用：

> `P{phase}-...` / `PX-...`

| 对应 Phase | 文件路径 | 类型 | 说明 |
|---|---|---|---|
| **Phase 0** | `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` | Design + Policy | spike 5+2+1 纪律 + 12 验证项矩阵 |
| **Phase 0** | `docs/design/after-foundations/P0-spike-do-storage-design.md` | Design | spike-do-storage 单 worker 设计 |
| **Phase 0** | `docs/design/after-foundations/P0-spike-binding-pair-design.md` | Design | spike-binding-pair 双 worker 设计 |
| **Phase 1** | `docs/design/after-foundations/P1-storage-adapter-hardening.md` | Design | 4 adapter 设计 + 接口修订 |
| **Phase 1** | `docs/rfc/scoped-storage-adapter-v2.md` | RFC | 接口 breaking change 详情 |
| **Phase 2** | `docs/design/after-foundations/P2-fake-bash-extension-policy.md` | Design + Policy | 哪些 port、哪些不 port、为什么 |
| **Phase 3** | `docs/design/after-foundations/P3-context-management-async-compact.md` | Design | armed → prepare → commit + CoW + fallback |
| **Phase 3** | `docs/design/after-foundations/P3-context-management-hybrid-storage.md` | Design | tier router + 6 tag layout |
| **Phase 3** | `docs/design/after-foundations/P3-context-management-inspector.md` | Design | HTTP/WS schema + auth + redact |
| **Phase 4** | `docs/design/after-foundations/P4-hooks-catalog-expansion.md` | Design | 18 events 详情 + outcome reducer 影响 |
| **Phase 5** | `docs/design/after-foundations/P5-nacp-1-2-0-upgrade.md` | Design | nacp-core / session 1.2.0 协议详情 |
| **Phase 5** | `docs/rfc/nacp-core-1-2-0.md` | RFC | 同上正式 RFC |
| **Phase 5** | `docs/rfc/nacp-session-1-2-0.md` | RFC | 同上正式 RFC |
| **Phase 6** | `docs/design/after-foundations/P6-spike-round-2-integration-plan.md` | Design | 轮 2 spike 接入 + 验证项 |
| **Phase 7** | `docs/design/after-foundations/P7-worker-matrix-pre-convergence.md` | Design | binding 名额 + template 设计 |
| **跨阶段** | `docs/design/after-foundations/PX-async-compact-lifecycle-spec.md` | Spec | armed/prepare/commit lifecycle 完整 spec（被 P3/P4/P5 共同引用） |

### 14.2 推荐的 action-plan 文件列表

建议统一放在：

> `docs/action-plan/after-foundations/`

为避免与 `after-skeleton/A1-A10` 命名冲突，本阶段使用 `B{n}` 前缀：

| 对应 Phase | 文件路径 | 说明 |
|---|---|---|
| **Phase 0** | `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md` | 双 spike 部署 + 12 验证项执行 |
| **Phase 1** | `docs/action-plan/after-foundations/B2-storage-adapter-hardening.md` | 4 adapter 实现 + ReferenceBackend 接通 |
| **Phase 2** | `docs/action-plan/after-foundations/B3-fake-bash-extension-and-port.md` | sed/awk/jq 等 port + curl 接通 |
| **Phase 3** | `docs/action-plan/after-foundations/B4-context-management-package-async-core.md` | 全部子模块 + async lifecycle |
| **Phase 4** | `docs/action-plan/after-foundations/B5-hooks-catalog-expansion-1-0-0.md` | 18 events + outcome reducer 更新 |
| **Phase 5** | `docs/action-plan/after-foundations/B6-nacp-1-2-0-upgrade.md` | nacp-core / session 1.2.0 + compat shim |
| **Phase 6** | `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md` | 轮 2 spike 部署 + integrated findings |
| **Phase 7** | `docs/action-plan/after-foundations/B8-worker-matrix-pre-convergence.md` | handoff memo + template |

### 14.3 推荐的撰写顺序

不建议按文件名顺序机械写作，建议按依赖顺序推进。

#### 第一批：必须先写（决定整个阶段的 spike 目标）

1. `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md`
2. `docs/design/after-foundations/P0-spike-do-storage-design.md`
3. `docs/design/after-foundations/P0-spike-binding-pair-design.md`
4. `docs/spikes/_TEMPLATE-finding.md`

#### 第二批：在 Phase 0 spike 跑出 finding 之后写

这批等 Phase 0 真实 finding 出来后再写——因为它们的设计依赖 finding。

5. `docs/design/after-foundations/P1-storage-adapter-hardening.md`（依赖 storage-findings）
6. `docs/rfc/scoped-storage-adapter-v2.md`（依赖 storage-findings）
7. `docs/design/after-foundations/P2-fake-bash-extension-policy.md`（依赖 fake-bash-platform-findings）

#### 第三批：context-management 是本阶段最重要的设计

这批决定 nano-agent 是否能拥有"区别于本地 CLI agent"的核心能力。

8. `docs/design/after-foundations/PX-async-compact-lifecycle-spec.md`
9. `docs/design/after-foundations/P3-context-management-async-compact.md`
10. `docs/design/after-foundations/P3-context-management-hybrid-storage.md`
11. `docs/design/after-foundations/P3-context-management-inspector.md`

#### 第四批：协议与 hook 扩展（依赖 context-management 设计）

12. `docs/design/after-foundations/P4-hooks-catalog-expansion.md`
13. `docs/design/after-foundations/P5-nacp-1-2-0-upgrade.md`
14. `docs/rfc/nacp-core-1-2-0.md`
15. `docs/rfc/nacp-session-1-2-0.md`

#### 第五批：轮 2 spike + handoff

16. `docs/design/after-foundations/P6-spike-round-2-integration-plan.md`
17. `docs/design/after-foundations/P7-worker-matrix-pre-convergence.md`

### 14.4 对应的 action-plan 撰写顺序

规则：**对应 design 完成并冻结后，再写对应 action-plan。**

推荐顺序：

1. `B1-spike-round-1-bare-metal.md`（依赖第一批 design）
2. `B2-storage-adapter-hardening.md`（依赖 P1 + RFC）
3. `B3-fake-bash-extension-and-port.md`（依赖 P2）
4. `B4-context-management-package-async-core.md`（依赖第三批全部）
5. `B5-hooks-catalog-expansion-1-0-0.md`（依赖 P4）
6. `B6-nacp-1-2-0-upgrade.md`（依赖 P5 + 2 RFC）
7. `B7-spike-round-2-integrated.md`（依赖 B2-B6 全部 ship）
8. `B8-worker-matrix-pre-convergence.md`（依赖 B7 closure）

### 14.5 如果要先控制文档数量，优先看哪几份

如果当前希望先收敛文档数量、集中火力，推荐先只看下面 5 份最关键 design：

1. `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` — 决定 spike 是否成立
2. `docs/design/after-foundations/PX-async-compact-lifecycle-spec.md` — 决定 nano-agent 核心能力是否成立
3. `docs/design/after-foundations/P3-context-management-async-compact.md` — 决定 context.core 是否能升格
4. `docs/design/after-foundations/P1-storage-adapter-hardening.md` — 决定 hybrid storage 是否能落地
5. `docs/design/after-foundations/P5-nacp-1-2-0-upgrade.md` — 决定 worker matrix 阶段的协议契约

这 5 份基本决定了整个阶段的成败。后面的 fake-bash 扩展、hooks 扩展、handoff 等，更像建立在这些基础之上的扩展设计与收口工作。

---

## 15. 思维链承接表（Reference Traceability）

为了让本 charter 的每一个决策都能反向追溯到原始 eval 讨论，下面给出完整的 reference traceability：

| 本 charter 章节 | 决策内容 | 来源文档 | 来源章节 |
|---|---|---|---|
| §0 | 4 轮修正历程 | `new-plan-by-Opus.md` + `worker-matrix-eval-with-{GPT,Opus}.md` + `before-worker-matrix-eval-with-{GPT,Opus}.md` | 全文 |
| §1.1 | spike worker 是核心方法论 | `before-worker-matrix-eval-with-Opus.md` | §0 + §6 |
| §1.2 | 必须 ship 代码 | `before-worker-matrix-eval-with-Opus.md` | §8（业主反驳后追加章节） |
| §1.3 | 异步压缩是核心 | `context-management-eval-by-Opus.md` v2 | §0 + §4 |
| §1.4 | context.core 升格 first-wave worker | `context-management-eval-by-Opus.md` v2 | §7.4 |
| §1.5 | 协议升级时机 | `before-worker-matrix-eval-with-Opus.md` | §8.3.2 |
| §1.6 | hybrid storage + tagged conversation | `context-management-eval-by-GPT.md` + `context-management-eval-by-Opus.md` v2 | GPT §4.3 + Opus §5.3 |
| §2.2 | 12 个 platform 验证项 | `before-worker-matrix-eval-with-Opus.md` | §6.2 |
| §2.3 | context-management 缺口 | `context-management-eval-by-Opus.md` v2 | §3.4 + §6.1 |
| §4.1 D | context-management 子模块结构 | `context-management-eval-by-Opus.md` v2 | §6.1 |
| §4.1 E | 18 hook events | `context-management-eval-by-Opus.md` v2 | §5.2 + §6.3 |
| §4.1 F | NACP 1.2.0 message families | `context-management-eval-by-Opus.md` v2 | §6.4 |
| §5.1 | spike 5+2 纪律 | `before-worker-matrix-eval-with-Opus.md` | §4.3 + §8.5.3 |
| §5.4 | async compact lifecycle | `context-management-eval-by-Opus.md` v2 | §4.4 |
| §5.5 | hybrid storage 表 | `context-management-eval-by-GPT.md` | §4.3 |
| §7.4 | Phase 3 子模块详情 | `context-management-eval-by-Opus.md` v2 | §6.1 |
| §12.1 | 4 first-wave worker | `worker-matrix-eval-with-Opus.md` + `context-management-eval-by-Opus.md` v2 | Opus §3 + v2 §7.4 |
| §12.2 | skill.core reserved | `worker-matrix-eval-with-Opus.md` | §2.4 + §6 |

每一条决策都可以从本 charter 反向追溯到原始 eval 讨论，确保**没有未经辩证的设计选择被悄悄塞进 charter**。

---

## 16. 结语

本 charter 的诞生本身就是 nano-agent 项目"先思考后执行"方法论的体现。从 Opus 的单 worker 提案，到用户的 5-worker matrix，到 Opus 的 3-worker 修正，到用户的 spike worker probe，再到本 charter 的 spike-driven code hardening——每一轮修正都让方向更稳。

> **After Foundations 不是 plan-after-skeleton 的下一个 phase；它是 plan-after-skeleton 与 worker matrix 之间的一道关键校准 gate。它不产生新功能，但它产生 nano-agent 区别于本地 CLI agent 的核心能力（async context engine）+ 区别于猜测式实现的工程纪律（spike-first-iteration）。**

进入下一阶段（worker matrix implementation），我们将拥有：

- 已 ship + 已 spike 验证的 storage adapters
- 已 ship + 已 spike 验证的 fake-bash 扩展
- 已 ship + 已 spike 验证的 context-management 包（含 async compact engine）
- 已 ship + 已 spike 验证的 hooks 1.0.0 + nacp 1.2.0
- 4 个 first-wave worker 的 binding 名额已预留
- handoff memo 列出所有 readiness checklist

worker matrix 阶段不会再问"这个 adapter 在 Cloudflare 上行不行"或"async compact 物理可行吗"——这些问题在本阶段已经被 spike + ship code 答了。worker matrix 阶段只需要做一件事：**把已验证的组件组装成 4 个真实 worker**。
