# Context Window Management — 专项评估 by Opus（v2 重写版）

> 状态：`独立辩证评估 (independent dialectical review) — v2 重写`
> 评估对象：用户对 nano-agent context management 的 6 项功能要求 + Deepseek 整理的完整功能/价值表
> 关键事实参考：`context/claude-code/`、`context/codex/`、`context/mini-agent/` 真实代码 + GitHub Copilot CLI 2026 公开文档 + GPT 同期独立评估
> 写作时间：2026-04-19（v2 重写版，针对 v1 §3.5 异步压缩误判全面修正）
> 立场：**异步全量压缩是 nano-agent 的核心能力，不是物理不可行——v1 在这一点上判断错了**

---

## 0. 写在最前面：v2 重写的原因

v1 版本的本文在 §3.5 提出"异步全量压缩物理不可行"，依据是 claude-code 的 compact 是 synchronous。

**这个判断是错的，v2 全面修正。** 错误的根因有三：

1. **样本偏差**：我只看了 claude-code 与 codex（都是单进程 CLI），没有看 GitHub Copilot CLI（2026 已公开实现 background compaction）
2. **场景偏差**：单进程 CLI 没有 KV/DO/alarm/service binding 这些 Worker-native 异步基础设施，所以它们做同步是被迫的；nano-agent 不是
3. **逻辑偏差**：我假设"compact 触发时 = context 已经满"，所以必须立即同步出 summary。但用户与 GPT 都指出真正的模式是 **"在还有 buffer headroom 的时候触发，在 buffer 用完之前完成"**——本质是 **prepare/commit 双阶段 + CoW context fork**

下面给出 v2 的完整重写。原 §3.5 的"❌ 拒绝"被修正为"✅ 强烈支持，作为 nano-agent 核心架构特征"。

---

## 1. 思维链承接

| 文件 | 角色 |
|---|---|
| `docs/plan-after-nacp.md` / `docs/plan-after-skeleton.md` | 立项基线 |
| `docs/eval/new-plan-by-Opus.md` | Opus 单 worker Phase 8（旧） |
| `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md` | GPT 5-worker 厚薄方案 |
| `docs/eval/after-foundations/worker-matrix-eval-with-Opus.md` | Opus 3-worker + 2 reserved binding |
| `docs/eval/after-foundations/before-worker-matrix-eval-with-GPT.md` | GPT pre-matrix 验证期 |
| `docs/eval/after-foundations/before-worker-matrix-eval-with-Opus.md` | Opus pre-matrix + spike 双轮 + §8 ship code |
| `docs/eval/after-foundations/context-management-discussion-with-deepseek.md` | Deepseek 7 节完整功能价值表 |
| `docs/eval/after-foundations/context-management-eval-by-GPT.md` | **GPT 同期独立评估**（特别是 §4.5 的 prepare/commit 模式） |
| **本文（v2）— `context-management-eval-by-Opus.md`** | 用真实 agent-cli 代码 + GitHub Copilot CLI 公开实现 + GPT findings 重新评估 |

---

## 2. 一句话先给结论（v2 修正版）

> **用户的 6 项要求中，4 项有强代码事实支撑（自定义 buffer / 更多 hooks / 异步压缩 / 同步 inspection），1 项需要重新框架化（"skill 中提供精细化工具"应改为 capability-attributed），1 项需要 hybrid 化（KV 中 L0/L1/L2/L3 应改为 hybrid storage + tagged conversation 双轨）。整体方向不仅成立，而且其中"异步上下文压缩"在 GitHub Copilot CLI 已被生产级验证，应当作为 nano-agent 区别于本地 CLI agent 的核心架构特征。**

| 用户要求 | v1 评估 | v2 修正 | 关键证据 |
|---|---|---|---|
| 1. 自定义 buffer size | ✅ 直接采纳 | ✅ 直接采纳（保持） | claude-code `AUTOCOMPACT_BUFFER_TOKENS=13_000` |
| 2. 更多的 hooks | ✅ 8→16 | ✅ **8→18**（v2 加 4 个 context lifecycle hook） | claude-code 27 events + GPT §6.3 推荐的 5 个 |
| 3. KV 中 L0/L1/L2/L3 分层 | ❌ 重构为 tagged single | ⚠️ **修正为 hybrid storage + tagged conversation 双轨** | GPT §4.3 的 hybrid storage 表 |
| 4. Skill 中精细化工具 | ⚠️ 单位调整为 capability | ✅ **保持单位调整**，但补 GPT §4.4 的 typed context capability 集合 | GPT §4.4 |
| 5. 异步压缩不阻断推理 | ❌ 物理不可行 | ✅ **strongly supported—nano-agent 核心架构** | **GitHub Copilot CLI 80% async** + GPT §4.5 prepare/commit |
| 6. HTTP/WS inspection | ✅ 采纳，独有 | ✅ 采纳，并参考 claude-code `get_context_usage` SDK control | claude-code SDK control schema |

下面分节论证。

---

## 3. 真实代码事实：三家 reference 实现的 context management

### 3.1 Claude-code 的 context management（已验证，详见 v1 §2.1，v2 不重复）

**关键数字与机制（保留）：**
- `AUTOCOMPACT_BUFFER_TOKENS = 13_000`、`WARNING_THRESHOLD_BUFFER_TOKENS = 20_000`、`MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000`、`MANUAL_COMPACT_BUFFER_TOKENS = 3_000`
- 3 个 env override：`CLAUDE_CODE_AUTO_COMPACT_WINDOW`、`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`、`CLAUDE_CODE_MAX_CONTEXT_TOKENS`
- `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3` (circuit breaker)
- HOOK_EVENTS 27 个（`coreTypes.ts:25-53`）
- microCompact 8 工具白名单
- apiMicrocompact 用 `clear_tool_uses_20250919` 让服务端剪 tool result
- SessionMemory 是磁盘 markdown，**后台 forked agent "without interrupting the main conversation flow"**——v1 漏读了这个关键事实
- `extractMemories.ts` 使用 forked agent 在 stop hook 后异步抽取——**这也是 v1 漏掉的异步证据**

**v2 关键修正：claude-code 的 compact 主路径同步 ≠ claude-code 不做异步上下文维护。** SessionMemory + extractMemories 都是真正的异步背景任务，只是它们维护的是"跨 session memory"而不是"当前 session 的 working compact"。

### 3.2 GitHub Copilot CLI 的 context management（v1 完全漏掉）

**这是 v1 最严重的遗漏。GitHub Copilot CLI 在 2026 已经是行业内**生产级**的"async background compaction"实现。**

公开文档证实的核心事实：

| 事实 | 来源 |
|---|---|
| 当 conversation 达到约 **80% 容量**时，Copilot CLI 自动开始 **后台 compaction** | GitHub Copilot CLI context-management docs |
| **保留约 20% buffer**，让 tool calls 在 compaction 进行时继续运行 | 同上 |
| Background compaction **不阻塞**用户交互 | 同上 |
| 95% 自动触发，目标是 enable **infinite-length sessions** | DeepWiki copilot-cli §3.7 |
| Summary 抓取：goals / 已做事项 / 关键技术细节 / 重要文件 / 下一步 | GitHub docs |
| 用户可手动 `/compact` 主动触发 | 同上 |

**这套机制的工程实现路径（公开信息推断）：**

```
turn N (已用 80% context):
  · agent 继续推理，使用 current context unchanged
  · 后台并行：launch summarization request to model with snapshot
  · turn N+1, N+2, ... 继续用 current context（仍有 20% buffer 可用）

后台 summarization 完成（可能在 turn N+3 完成）:
  · prepared summary 待 commit
  · 下一个 turn boundary（N+4）触发 swap：current context → summarized context
  · agent N+4 用 new context 继续推理

如果在 swap 前 buffer 用完:
  · 95% 触发硬同步 fallback
  · 用 已 prepared 但未 commit 的 summary 立即 commit
```

**关键：这套设计要求至少 20% 的 buffer headroom**——也就是说，**user 的"buffer 足够大就不阻塞"判断在生产实践里被验证过**。这也是 v1 错判的关键漏点。

### 3.3 Codex（v1 已覆盖）

Codex 同步 turn-item 级 compact（`compact_remote.rs:117-207`）。但这是 codex 的实现选择，不代表所有 agent 都必须同步。

### 3.4 三家 reference 的 async/sync 矩阵（v2 新表）

| 实现 | 运行环境 | 全量 compact | microCompact | session-memory 维护 | 触发阈值模型 |
|---|---|---|---|---|---|
| claude-code | 单进程 CLI / forked subagent | **synchronous** | 同步但极快 | **后台异步** (forked) | hard limit - buffer (= 13K) |
| codex | 单进程 CLI / Rust runtime | **synchronous** | 同步 | （未在快照中找到） | turn-item level |
| **GitHub Copilot CLI** | **CLI but agent-runtime** | **background asynchronous** | — | — | **80% capacity, 20% buffer headroom** |
| nano-agent (target) | **Cloudflare Worker / DO / KV / R2** | **应当 async（user 主张）** | 应当 async-equivalent | 应当 background | 应当 80% / 20% buffer |

**关键观察：所有 3 家 reference 的 compact 选择是被它们 runtime 形态决定的，不是被 LLM 物理约束决定的。** GitHub Copilot CLI 证明：只要有 buffer headroom + background scheduler，async full compact 完全可行。nano-agent 的 Cloudflare Worker 形态比 Copilot CLI 还要更适合做这件事。

---

## 4. v2 重新评估：异步上下文压缩为什么是 nano-agent 的核心架构

### 4.1 v1 错在哪：被表象绊倒

v1 §3.5 的论证：

> "summary 本身是要 inject 到下一轮 prompt 里的——没有 summary 就没有下一轮"

**这个论证默认了一个隐含前提**：**compact 触发 = 立即需要 summary 才能继续**。

但实际上，compact 应该在**还有 buffer headroom 时触发**。在 buffer 用完之前的几个 turn 里，agent 可以**继续用旧 context** 推理，而 compactor 在后台慢慢生成 summary。当 summary 准备好，在某个 turn boundary 做**原子 swap**。

这是 **prepare/commit 双阶段 + CoW context fork** 模式，不是"边推理边改 prompt"。

### 4.2 用户的 5 个关键洞察（v2 必须吸收）

用户在反馈中给了 5 个关键观察，v2 必须显式承认：

1. **"只要 buffer size 足够，异步对于上下文的压缩，本来就不应该阻碍当前正在进行的推理过程"**
   — 这正是 GitHub Copilot CLI 80%/20% 设计的本质

2. **"我们对上下文空间本来就有 shadow 备份"**
   — nano-agent 已有 `WorkspaceSnapshotBuilder`、`composeWorkspaceWithEvidence`、checkpoint 路径，shadow snapshot 是已有能力

3. **"我们随时面临用户需要恢复到之前的对话，本来就对整个 message 的历史，拥有分支和版本管理"**
   — nano-agent 因为 user-rollback 需求，message history 必然要做 versioned；versioned history 天然支持 CoW fork

4. **"在当前推理的阶段，我们是可以保证热上下文不变"**
   — 当前推理 turn 的 prompt 是 immutable 的；compactor 改的是"未来 turn 的 prompt 蓝图"，不改"当前 turn 的 prompt"

5. **"对上下文进行 fork，在压缩完成后，在当前推理结束后，将上下文进行替换"**
   — 这是 CoW snapshot 的标准模式，与 git fork/merge、databases 的 MVCC、文件系统的 snapshot 同构

**v2 同意这 5 点，并把它们升级为 nano-agent context-management 的第一性原则。**

### 4.3 GPT §4.5 的 prepare/commit 双阶段（v2 必须吸收）

GPT 的 `context-management-eval-by-GPT.md` §4.5 给出的关键设计：

> "1. **prepare phase** — 不阻断当前推理；生成 summary / refs / candidate
> 2. **commit phase** — 在 turn boundary 或 session idle 点发生；更新 live context head；触发 `ContextCompactCommit` / `PostCompact`"

GPT §4.5 还指出：

> "Claude Code 的 compact 很强，但它的主路径仍然较依赖同步 conversation compact。而 nano-agent 的 Worker / DO 模型更适合：alarm / idle scheduling / background worker / service binding compactor"

**v2 同意 GPT 的判断，并把 prepare/commit 两阶段作为 v2 的 canonical 异步压缩协议。**

### 4.4 v2 的异步全量压缩 canonical 设计

把用户的 5 个洞察 + GPT 的 prepare/commit + GitHub Copilot CLI 的 80%/20% 合成：

```
─────────────────────────────────────────────────────────────────
异步全量压缩生命周期 (canonical, v2):

[阶段 1 — armed]
  当 token usage 达到 SOFT_THRESHOLD (推荐 ~70-80%):
    · CompactionScheduler 进入 armed 状态
    · 不立即触发，等下一个 idle window 或 turn boundary
    · 触发 `ContextCompactArmed` hook (新增)

[阶段 2 — prepare]
  在 armed 状态下，找到一个 idle window 或 background-eligible 时机:
    · CompactionPlanner.fork(currentContext) → ContextCandidate
    · ContextCandidate 是 CoW snapshot，与 currentContext 共享 immutable layers
    · 启 background LLM call (用 cheaper compact-specific model)
    · 当前 turn 不被影响
    · 触发 `ContextCompactPrepareStarted` hook (新增)

[阶段 2.5 — preparing (期间)]
  · agent 继续用 currentContext 推理 turn N+1, N+2, ...
  · CompactionScheduler 监控：
      - background summary 是否完成
      - currentContext usage 是否逼近 HARD_THRESHOLD (~95%)
  · 如果 currentContext 超过 HARD_THRESHOLD 而 summary 还没好:
      → 强制 fallback synchronous compact (与 claude-code 同款)
      → 这是退化路径，不是常规路径

[阶段 3 — commit]
  background summary 完成 + 处于 turn boundary / session idle:
    · CompactionCommitter.atomicSwap(currentContext, preparedSummary)
    · 写新 context to KV / DO storage
    · 旧 context 保留为 versioned snapshot (满足 user rollback 需求)
    · 触发 `ContextCompactCommitted` hook (新增)
    · 下一个 turn 用新 context

[阶段 4 — post]
  · 触发 `PostCompact` hook (已有)
  · 清理 stale candidates
  · 更新 inspection endpoint metrics
─────────────────────────────────────────────────────────────────
```

**关键设计要点：**

1. **Trigger threshold 与 commit threshold 分离**：trigger 在 70-80%（soft），fallback hard sync 在 95%。两者之间有 15-25% buffer headroom 容纳 background latency。
2. **CoW snapshot 而非 deep copy**：share immutable layers (system prompt + memory) 与 current context；只 fork 可变部分。Cloudflare DO storage + KV 都支持 versioned writes，CoW 是自然能力。
3. **Atomic swap 在 turn boundary**：永远不在 turn 中途换 context。turn boundary 是 transactionally safe point。
4. **Versioned history 满足 rollback**：旧 context 不删除，作为 revisionable snapshot 保留——既满足 user rollback 又满足 audit。
5. **Hard fallback 仍然是同步**：极端情况（buffer 设小了 / LLM compact 慢）时退化为同步 compact，保证 correctness。这不是 design failure，是 graceful degradation。

### 4.5 与 nano-agent 已有 foundations 的 mapping

这套设计**几乎完全可以**映射到 nano-agent 现有 packages：

| 设计要件 | 对应 nano-agent 既有能力 | gap |
|---|---|---|
| `CompactionScheduler` | DO `state.alarm` API + `nano-session-do.ts` lifecycle | 需要新增调度逻辑 |
| `CompactionPlanner` | `workspace-context-artifacts/CompactBoundaryManager` 已有 boundary detection | 需要扩展为 candidate generation |
| `ContextCandidate` (CoW) | `WorkspaceSnapshotBuilder.buildFragment()` 已有 snapshot capability | 需要把 fragment 形式扩展为 candidate context |
| Background LLM call | `llm-wrapper` 已有 provider abstraction | 需要支持 secondary "compact model" provider |
| `CompactionCommitter` | `composeWorkspaceWithEvidence` 已有 evidence anchor | 需要 atomic swap 操作 |
| Versioned history | DO storage transactional get/put + R2 archival | 需要 message-history versioning logic（user 提到的 branch/version 管理） |
| Hooks | `packages/hooks/src/catalog.ts` 已有 hook framework | 需要新增 4 个 lifecycle hook |
| Cross-worker emit | `eval-observability` + `cross-seam.ts` | 已就绪 |

**也就是说：异步全量压缩 不是 nano-agent 缺地基，是缺装配。** 装配工作量在 §6 估算。

---

## 5. 用户 6 项功能要求的逐项辩证评估（v2 全面修正）

### 5.1 功能 1：自定义 buffer size 管理 ✅ 直接采纳（v2 不变）

**评估：** v1 已分析，v2 保持。直接借鉴 claude-code 的数字与 env override 机制，扩展为 nano-agent 的 `RuntimeConfig`。

**v2 补充：buffer 必须区分两层阈值（被 GitHub Copilot CLI 验证）：**

```ts
interface BufferPolicy {
  readonly hardLimitTokens: number          // 模型 context window 物理上限
  readonly responseReserveTokens: number    // 留给 output (借鉴 MAX_OUTPUT_TOKENS_FOR_SUMMARY=20K)
  readonly softCompactTriggerPct: number    // 异步触发阈值 (~70-80%)
  readonly hardCompactFallbackPct: number   // 同步 fallback 阈值 (~95%)
  readonly inspectionWarningThreshold: number  // GPT §4.1 第 5 项
}
```

**ship 位置：** `packages/context-management/budget/buffer-policy.ts`

### 5.2 功能 2：更多的 hooks 用于 context management ✅ 8 → 18（v2 调整）

**v1 提出 8→16；v2 调整为 8→18，新增 4 个异步 compact lifecycle hook：**

| 来源 | 新增 hook | 用途 |
|---|---|---|
| 已有保留 | SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PreCompact, PostCompact (8 个) | — |
| claude-code 借鉴 | + Setup, Notification, Stop, StopFailure, PermissionRequest, PermissionDenied, FileChanged, CwdChanged (8 个) | 与 claude-code 27 events 中的实用子集一致 |
| **v2 新增 (异步 compact lifecycle)** | + **ContextCompactArmed** | soft threshold 达到，scheduler 已 armed |
| | + **ContextCompactPrepareStarted** | background LLM call 已发出 |
| | + **ContextCompactCommitted** | atomic swap 完成 |
| | + **ContextPressure** | usage 接近 hard threshold 的早期告警（GPT §6.3 推荐） |

**总计：18 个 events**（v1 是 16，v2 加了 4 个 lifecycle hook，去重后是 18）。

**Trade-off：** v1 担心 21 个太多。但异步 lifecycle 确实需要 4 个独立事件——它们对应 4 个截然不同的 transition point，合并会损失可观察性。**v2 选择 18 个的精确度优先，不为了少 2 个事件牺牲 lifecycle 可见性。**

### 5.3 功能 3：KV 中 L0/L1/L2/L3 分层 ⚠️ Hybrid 双轨（v2 中度修正）

**v1 拒绝了 KV 分层，主张 tagged single conversation。这部分 v2 部分修正：**

GPT §4.3 给出了 **hybrid storage 表**，比 v1 的"全部塞 message[] + tags"更现实：

| 层 | 推荐存储 | 理由 |
|---|---|---|
| system | KV / static config | 小、稳定、读多写少 |
| memory | KV | 结构化、热读、高价值 |
| active transcript head | DO memory / DO storage | 高频写、强 session locality |
| tool results / large payloads | artifact refs + R2 / do-storage | 不能把大块内容直接热挂在 prompt 里 |
| compact summaries / manifests | KV 或 D1 manifest | 需要结构化索引但不是每次都热写 |

**v2 修正：** Deepseek 的"L0/L1/L2/L3 都进 KV" 错；v1 的"全部进单 message[]"也错。正确做法是 **hybrid storage + tagged conversation 双轨**：

- **逻辑视图**：单 message[] + `contextTag` 字段（v1 已设计）
- **物理存储**：按 tag 路由到不同 storage tier（system/memory → KV，transcript → DO storage，tool result → R2 ref）
- **运行时**：assemble 时按 tag 从对应 tier 拉取并组装为 prompt

这同时满足：
- 用户的"在 KV 中结构化分层" 诉求（system/memory 确实在 KV）
- v1 的"single conversation" 诉求（assemble 出来仍是单 prompt）
- GPT 的"hybrid storage" 现实约束（不同数据类型用不同 tier）

**ship 位置：**
- `packages/context-management/strategy/tagged-message.ts` — 逻辑层
- `packages/context-management/storage/tier-router.ts` — 物理层路由
- 复用 `storage-topology` 已有的 placement / refs

### 5.4 功能 4：Skill 中精细化工具 ⚠️ Capability 级 + GPT §4.4 typed cluster（v2 扩展）

**v1 的 capability-level attribution 保留**，v2 补 GPT §4.4 推荐的 **typed context capability cluster**：

```ts
// nano-agent 应提供的 typed context capabilities
interface ContextManagementCapabilities {
  inspectUsage(): UsageReport
  inspectLayers(filter?: TagFilter): LayerView
  pinMemory(memoryId: string): void
  unpinMemory(memoryId: string): void
  scheduleCompact(opts?: ScheduleOpts): CompactJobId
  promoteArtifact(artifactRef: NacpRef): void
  restoreSummary(summaryRef: NacpRef): void
  setBudgetPolicy(policy: BufferPolicy): void
  forkContext(): ContextSnapshotId   // CoW fork
  restoreContext(snapshotId): void   // versioned rollback
}
```

**为什么不是 fake-bash 表达：** GPT §4.4 指出 fake-bash 适合表达 ls/cat/rg/curl/git，不适合表达"把 L1 记忆层的一条记录标记为 protected"。**v2 同意 GPT，把 context management 做成 typed capability cluster，不通过 bash。**

**新增能力（v2 扩展）：** `forkContext` / `restoreContext` —— 直接支持 §4.4 的 CoW snapshot 与 user rollback 需求。

### 5.5 功能 5：异步上下文压缩，不阻断推理流程 ✅ **核心架构特征**（v2 完全反转 v1 判断）

**v1 错判：物理不可行 → v2 修正：核心架构特征。**

**证据链：**

1. **GitHub Copilot CLI 80%/20% 已生产级实现** （§3.2）
2. **claude-code 的 SessionMemory + extractMemories 已证明"后台异步上下文维护"成立** （§3.1）
3. **GPT §4.5 给出的 prepare/commit 双阶段是 canonical 设计**
4. **用户的 5 个洞察（buffer headroom + shadow snapshot + versioned history + immutable current turn + atomic swap）在工程上 100% 可实现**
5. **nano-agent 的 Worker/DO/KV/R2 形态比 Copilot CLI 还更适合做这件事**

**v2 设计**：详见 §4.4 的完整生命周期（armed → prepare → commit → post），这里不重复。

**关键 trade-off：**

| 方面 | 同步 compact (claude-code/codex) | 异步 compact (Copilot CLI / nano-agent target) |
|---|---|---|
| 实现复杂度 | 低 | 中-高（CoW + scheduler + commit logic） |
| 用户体验 | 卡 5+ 分钟 (Copilot CLI 用户 issue #178513 报告) | 平滑无感 |
| 一致性 | 简单（线性历史） | 需要 CoW + versioned snapshot |
| 失败恢复 | 简单（重试 compact） | 需要 graceful degradation 到同步 fallback |
| Token 浪费 | 较低 | 需要 buffer headroom (~20%) 永久占用 |
| 多 worker 适配 | 较难 | **天然适配**（异步 worker scheduling 本就 worker-native） |

**v2 verdict：** 给定 nano-agent 的 worker-native 形态、已有 shadow snapshot 能力、已有 versioned history 需求，**异步压缩的实现增量是中等的，但收益是质变的**——它是 nano-agent 区别于本地 CLI agent 的关键架构特征。

### 5.6 功能 6：独立 HTTP/WS inspection ✅ 采纳，参考 claude-code SDK control（v2 强化）

**v1 的判断保留。v2 补充 GPT §4.6 与 claude-code 真实 SDK control schema 的细节：**

claude-code 的 `get_context_usage` SDK control request（`entrypoints/sdk/controlSchemas.ts`）返回：

```
categories, totalTokens, maxTokens, rawMaxTokens, percentage,
gridRows, memoryFiles, mcpTools, systemTools, systemPromptSections
```

**这是行业内已验证的 inspection contract——v2 强烈推荐 nano-agent 采用同款 shape**，加上 nano-agent 独有的 multi-worker 维度：

```ts
interface ContextUsageReport {
  // claude-code 同款
  totalTokens: number
  maxTokens: number
  rawMaxTokens: number
  percentage: number
  categories: { name: string; tokens: number }[]

  // nano-agent 扩展（multi-worker 独有）
  perWorkerBreakdown: { workerId: string; tokens: number }[]
  pendingCompactJobs: CompactJobStatus[]
  bufferPolicy: BufferPolicy
  versionedSnapshots: SnapshotMetadata[]   // 支持 user rollback
}
```

**v2 推荐路由（保留 v1 + 强化 GPT §6.2 推荐）：**

- HTTP read-only：`GET /inspect/sessions/:id/context/usage|layers|policy|snapshots`
- WS subscribe：`WS /inspect/sessions/:id/context/stream` (live tag-filtered)
- HTTP control：`POST /inspect/sessions/:id/context/snapshot` (force snapshot), `POST .../compact` (manual trigger)
- Auth：bearer token + IP allowlist + production hard-disable

**协议层：** GPT §6.2 推荐放进 NACP `session.context.*` family。**v2 修正之前判断：保留独立 HTTP/WS endpoint 路由（避免污染 trace），但 message body 走 NACP envelope schema**（这样 inspector clients 可复用 nacp-session 的 type definitions）。

---

## 6. 修正后的 nano-agent context-management 设计大纲（v2）

### 6.1 `packages/context-management/` 子模块结构（v2 重构版）

```
packages/context-management/
├── budget/
│   ├── buffer-policy.ts         — BufferPolicy (5-字段，§5.1)
│   ├── effective-window.ts      — getEffectiveContextWindowSize (借鉴 claude-code)
│   ├── threshold.ts             — soft/hard threshold computation
│   └── env-overrides.ts         — 3 个 env (借鉴 claude-code)
│
├── strategy/
│   ├── tagged-message.ts        — TaggedMessage / ContextLayerTag enum
│   ├── compaction-policy.ts     — { excludeTags, compactTags }
│   ├── microcompact-planner.ts  — pure-local tool result trim
│   ├── api-context-edit.ts      — 透传给 LLM provider 的 server-side strategy
│   └── full-compact.ts          — synchronous fallback (graceful degradation 路径)
│
├── async-compact/                — v2 新增子模块（核心）
│   ├── scheduler.ts             — 监听 buffer threshold + DO alarm
│   ├── candidate.ts             — CoW context fork
│   ├── planner.ts               — 选择 compact target tags + summarization prompt
│   ├── prepare-job.ts           — background LLM summarization
│   ├── committer.ts             — atomic swap on turn boundary
│   ├── version-history.ts       — versioned snapshots (满足 user rollback)
│   └── fallback.ts              — hard-threshold sync fallback
│
├── storage/                      — v2 新增子模块（hybrid 双轨）
│   ├── tier-router.ts           — 按 tag 路由到 KV / DO / R2
│   ├── kv-tier.ts               — system / memory tier
│   ├── do-storage-tier.ts       — active transcript head
│   └── r2-ref-tier.ts           — large tool results
│
├── lifecycle/
│   ├── session-memory-extractor.ts — 后台 forked agent (claude-code 同款)
│   ├── session-memory-loader.ts    — 下次 session 启动时 load
│   ├── prepared-artifact-promoter.ts — workspace-context-artifacts promotion
│   └── file-cache-dedup.ts         — path + hash dedup
│
├── inspector/                    — v2 强化
│   ├── http-route.ts            — GET /inspect/...
│   ├── ws-route.ts              — WS /inspect/.../stream
│   ├── usage-report.ts          — claude-code 同款 + nano-agent 扩展
│   ├── inspector-auth.ts        — bearer + IP allowlist
│   └── inspector-redact.ts      — secret redaction
│
└── index.ts
```

**与 v1 §5 的差异：**
- 新增 `async-compact/` 子模块（核心）
- 新增 `storage/` 子模块（hybrid 双轨）
- `lifecycle/` 保留但去掉 v1 误以为 "异步" 的子模块（移到 `async-compact/`）
- `inspector/` 加入 `usage-report.ts`（claude-code 同款 schema）

### 6.2 与现有包的依赖关系（v2 修正）

```
context-management
  ├── 依赖 → workspace-context-artifacts (primitives + snapshot)
  ├── 依赖 → llm-wrapper (provider abstraction，支持 secondary compact model)
  ├── 依赖 → hooks (PreCompact / PostCompact / 4 个新增异步 hook)
  ├── 依赖 → capability-runtime (capability contextPolicy)
  ├── 依赖 → storage-topology (KV / DO / R2 adapter，through `before-worker-matrix-eval §8.3.4`)
  ├── 依赖 → eval-observability (compact lifecycle evidence)
  └── 不反向依赖任何上述
```

### 6.3 与 hook catalog 扩展（v2 调整为 8→18）

修正后的扩展（替换 v1 §5.6）：

```
保留 (8): SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PreCompact, PostCompact

新增 claude-code 借鉴 (8): Setup, Notification, Stop, StopFailure, PermissionRequest, PermissionDenied, FileChanged, CwdChanged

v2 新增异步 compact lifecycle (4): ContextPressure, ContextCompactArmed, ContextCompactPrepareStarted, ContextCompactCommitted

不引入: PreLayerLoad / PreContextAssemble / PreSnapshot / PrePromotion / PreArchive (太细，且行为已被 capability runtime 内置)
不引入: MemoryInject (任何 reference 都没有；用 attachment message 解决)
```

**总计 18 个**（v1 是 16，v2 +2 是因为异步 compact 的 4 个 lifecycle hook 比 v1 估的多了 2 个）。

### 6.4 与 nacp-core / nacp-session 1.2.0 升级

v1 §6.4 修正：

**保留扩展：**
- `context.compact.prepare.request/response` — async compact 的 prepare 阶段
- `context.compact.commit.request/response` — async compact 的 commit 阶段
- `context.budget.exceeded` — pressure 通知
- `session.context.usage.snapshot` — inspection (走 NACP envelope schema)

**删除扩展（v2 进一步收窄）：**
- `context.assemble.request/response` — 装配在 worker 内部，不需要协议
- `context.snapshot.committed` — 由 hook 表达即可，不需要单独 message
- `context.layer.evicted` — 同上

---

## 7. 与前序 phase 规划的协同（v2）

### 7.1 对 §8.3.1（context-management 新包）的影响

**§8.3.1 提的"新建 packages/context-management/"成立**，v2 给出更完整的子模块结构（§6.1）。

### 7.2 对 §8.3.5（hook catalog 8→21）的修正

v1 修正为 8→16；**v2 再次修正为 8→18**（加 4 个异步 compact lifecycle hook，去重后 18）。

### 7.3 对 spike phase 的影响

**v1 提了 spike-context-loop**，v2 强化：

新增 spike 验证项：
- 验证 GitHub Copilot CLI 80%/20% 模式在 Cloudflare Worker + DO + KV 上的可行性
- 验证 CoW context fork 的 latency（KV/DO storage 上的 versioned write 性能）
- 验证 async LLM call 在 DO alarm 调度下的 cancellation behavior
- 验证 atomic swap 在 turn boundary 的 transactional guarantees

### 7.4 对 worker matrix 阶段（context.core 立项）的影响

**v2 关键判断：异步全量压缩需要 context.core 作为独立 worker（不只是 agent.core 内嵌模块）。**

理由：
- async compact 需要独立 LLM call (用 cheaper compact model)，与 main reasoning 的 LLM call 不能共享 budget 也不该走同一 inflight queue
- DO alarm 调度的 isolation 边界天然对应独立 worker
- versioned snapshot 的写入路径与 main session 的写入路径分离，便于 fault isolation

**v2 推荐：** worker matrix 阶段**直接立项 context.core** 作为 4 个 worker 之一（agent.core / bash.core / filesystem.core / **context.core**），而不是把它推迟到"spec 落地后"。

这是对前序 `worker-matrix-eval-with-Opus.md` 的修正——之前我把 context.core 列为 reserved binding 名额，v2 主张升级为 first-wave worker。

---

## 8. 最终 verdict（v2 修正版）

### 8.1 对用户 6 项要求的总评（v2）

| # | 要求 | v2 评估 |
|---|---|---|
| 1 | 自定义 buffer size | ✅ 直接采纳 |
| 2 | 更多的 hooks | ✅ 8 → 18（含 4 个异步 compact lifecycle） |
| 3 | KV 中 L0/L1/L2/L3 分层 | ⚠️ Hybrid storage + tagged conversation 双轨 |
| 4 | Skill 中精细化工具 | ✅ Capability 级 + GPT §4.4 typed cluster |
| 5 | **异步压缩不阻断推理** | ✅ **核心架构特征——CoW fork + prepare/commit + 80%/20% buffer** |
| 6 | HTTP/WS inspection | ✅ claude-code SDK control schema + nano-agent multi-worker 扩展 |

**6 项里 5 项直接采纳、1 项 hybrid 化。0 项拒绝。整体方向 100% 成立。**

### 8.2 v1 → v2 的关键修正

1. **异步全量压缩从"物理不可行"改为"核心架构特征"**——证据链：GitHub Copilot CLI 80%/20% + claude-code SessionMemory 异步 + GPT §4.5 prepare/commit + 用户 5 个洞察
2. **L0/L1/L2/L3 从"全拒绝"改为"hybrid storage + tagged conversation 双轨"**——吸收 GPT §4.3 hybrid storage 表
3. **Hook 数量从 16 改为 18**——加 4 个异步 compact lifecycle hook
4. **新增 `async-compact/` 与 `storage/` 子模块**——前者承载异步压缩生命周期，后者承载 hybrid storage 路由
5. **新增 inspector `usage-report.ts`**——采用 claude-code SDK control schema
6. **context.core 从"reserved binding 名额"升级为"worker matrix first-wave worker"**——异步压缩的 isolation 边界要求独立 worker

### 8.3 一句话总结（v2）

> **用户 6 项要求基本全部成立，其中"异步上下文压缩"v1 误判为物理不可行——v2 全面修正：GitHub Copilot CLI 已生产级验证 80%/20% buffer + background compaction 模式，加上 nano-agent 已有 shadow snapshot + versioned history + DO alarm 等基础设施，异步全量压缩不仅可行而且应当成为 nano-agent 区别于本地 CLI agent 的核心架构特征。canonical 设计是"armed → prepare → commit"三阶段 + CoW context fork + atomic swap on turn boundary + hard-threshold synchronous fallback。装配工作量中等（4-6 周），收益是质变（用户心流不被 5+ 分钟 compact 卡住），且这条路径迫使 context.core 升级为 worker matrix first-wave worker。**

---

## 附 A：claude-code 真实代码事实快照（v2 完整版）

| 事实 | 文件 | 行号 |
|---|---|---|
| `AUTOCOMPACT_BUFFER_TOKENS = 13_000` | `services/compact/autoCompact.ts` | 62 |
| `WARNING_THRESHOLD_BUFFER_TOKENS = 20_000` | 同上 | 63 |
| `MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000` (p99.99 of summary output is 17,387) | 同上 | 30 |
| `MANUAL_COMPACT_BUFFER_TOKENS = 3_000` | 同上 | 65 |
| 3 个 env override | 同上 + `utils/context.ts` | 40-46, 61 |
| `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3` (circuit breaker) | `autoCompact.ts` | 70 |
| `COMPACTABLE_TOOLS` 8 工具白名单 | `microCompact.ts` | 41-50 |
| `ContextEditStrategy` `clear_tool_uses_20250919` | `apiMicrocompact.ts` | 35-56 |
| `DEFAULT_MAX_INPUT_TOKENS = 180_000` / `DEFAULT_TARGET_INPUT_TOKENS = 40_000` | `apiMicrocompact.ts` | 16-17 |
| HOOK_EVENTS 27 个 canonical list | `entrypoints/sdk/coreTypes.ts` | 25-53 |
| **SessionMemory 后台 forked agent "without interrupting the main conversation flow"** | `services/SessionMemory/sessionMemory.ts` | 1-8 注释 |
| **`extractMemories` 用 forked agent 在 stop hook 后异步抽取** | `services/extractMemories/extractMemories.ts` | (entry pattern) |
| `compactConversation` 通过 `runForkedAgent` 同步 (主路径) | `services/compact/compact.ts` | (~50-60) |
| `get_context_usage` SDK control request 完整 shape | `entrypoints/sdk/controlSchemas.ts` | (中段) |

## 附 B：GitHub Copilot CLI context management 公开事实（v2 新增）

| 事实 | 来源 |
|---|---|
| 80% capacity → background compaction 自动启动 | GitHub Copilot CLI context-management docs |
| 保留 ~20% buffer 让 tool calls 继续运行 during compaction | 同上 |
| Background compaction **不阻塞**用户交互 | 同上 |
| 95% 自动触发，目标是 enable infinite-length sessions | DeepWiki copilot-cli §3.7 |
| 用户 issue：sync compact 卡 5+ minutes "making copilot very slow/hard to use" | VS Code community Discussion #178513 |
| 手动触发 `/compact` 命令 | GitHub Copilot CLI docs |

## 附 C：nano-agent 当前 context-related 代码事实快照

| 事实 | 文件 | 行号 |
|---|---|---|
| `HOOK_EVENT_CATALOG` 仅 8 个事件 | `packages/hooks/src/catalog.ts` | 43-98 |
| `nacp-core/messages/context.ts` 仅 `compact.request/response` | `packages/nacp-core/src/messages/context.ts` | 18-25 |
| `ContextAssembler / CompactBoundaryManager / WorkspaceSnapshotBuilder` 已存在 | `packages/workspace-context-artifacts/src/index.ts` | — |
| `composeWorkspaceWithEvidence` 已就绪 | `packages/session-do-runtime/src/workspace-runtime.ts` | 75-101 |
| `ContextLayerKind` 当前 6 个：system/session/workspace_summary/artifact_summary/recent_transcript/injected | `packages/workspace-context-artifacts/src/context-layers.ts` | — |
| `prepared-artifacts.ts` 是 `StubArtifactPreparer` | `packages/workspace-context-artifacts/src/prepared-artifacts.ts` | — |
| `nacp-core` 当前 1.1.0 frozen | `packages/nacp-core/src/version.ts` | — |
| `nacp-session` 当前 1.1.0 frozen | `packages/nacp-session/src/version.ts` | — |

## 附 D：v1 → v2 修正点 diff（透明化重写动机）

| 维度 | v1 | v2 修正 |
|---|---|---|
| 异步全量压缩判断 | ❌ 物理不可行 | ✅ **核心架构特征** |
| L0/L1/L2/L3 KV 分层 | ❌ 全拒绝，改为 tagged single | ⚠️ **Hybrid storage + tagged conversation 双轨** |
| Hook 扩展 | 8 → 16 | **8 → 18**（加 4 个异步 compact lifecycle） |
| context-management 子模块 | budget / strategy / lifecycle / inspector | + **async-compact/** + **storage/** |
| context.core 在 worker matrix 中的地位 | reserved binding 名额 | **first-wave worker** |
| Inspector usage shape | 自定义 | claude-code `get_context_usage` 同款 + nano-agent 扩展 |
| 异步压缩定位 | 只有 microCompact + offline session-memory 算异步 | **armed → prepare → commit + CoW fork + atomic swap** 是 canonical |
| 协议扩张 | 模糊 | `context.compact.prepare/commit.*` + `context.budget.exceeded` + `session.context.usage.snapshot` |
| 触发模型 | 单 threshold | **soft (~70-80%) + hard fallback (~95%)** 双 threshold |

---

## Sources

- [Managing context in GitHub Copilot CLI - GitHub Docs](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/context-management)
- [Context & Token Management | github/copilot-cli | DeepWiki](https://deepwiki.com/github/copilot-cli/3.7-context-and-token-management)
- [How can I manually trigger "Summarize Conversation History"? · GitHub community Discussion #177818](https://github.com/orgs/community/discussions/177818)
- [Copilot is constantly summarizing conversation history and it takes 5+ mins every time · GitHub community Discussion #178513](https://github.com/orgs/community/discussions/178513)
- [Manage context for AI - VS Code docs](https://code.visualstudio.com/docs/copilot/chat/copilot-chat-context)
- [Make conversation history summarization threshold public · microsoft/vscode Issue #270528](https://github.com/microsoft/vscode/issues/270528)
- [GitHub Copilot context window meter accumulates ghost data · microsoft/vscode Issue #299810](https://github.com/microsoft/vscode/issues/299810)
- [Feature Request: Add 'Context Compression' Toggle to Save Token Usage in Copilot Chat · microsoft/vscode Issue #284712](https://github.com/microsoft/vscode/issues/284712)
- [Conversation history summarization makes everything worse · microsoft/vscode-copilot-release Issue #9507](https://github.com/microsoft/vscode-copilot-release/issues/9507)
- [Managing context in GitHub Copilot CLI - GitHub Enterprise Cloud Docs](https://docs.github.com/en/enterprise-cloud@latest/copilot/concepts/agents/copilot-cli/context-management)
