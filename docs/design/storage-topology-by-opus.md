# Nano-Agent 功能簇设计 — Storage Topology

> 功能簇: `Storage Topology`
> 讨论日期: `2026-04-16`
> 讨论者: `Claude Opus 4.6 (1M context)`
> 关联调查报告:
> - `docs/investigation/codex-by-opus.md` (rollout JSONL / thread-store / DO storage analogy)
> - `docs/investigation/claude-code-by-opus.md` (sessionStorage / AppState / compact layers)
> - `docs/investigation/mini-agent-by-opus.md` (ephemeral memory / .agent_memory.json)
> - `docs/nacp-by-opus.md` v2 §5.4 (multi-tenant storage rules) + §5.8 (refs namespacing)
> - `docs/action-plan/nacp-core.md` (tenancy/scoped-io.ts / refs `tenants/{team_uuid}/`)
> - `docs/action-plan/nacp-session.md` (replay buffer checkpoint → DO storage)
> - `docs/design/session-do-runtime-by-opus.md` (DO as hot state / checkpoint format)
> - `docs/design/eval-observability-by-opus.md` (trace sink → storage placement evidence)
> - `docs/plan-after-nacp.md` §7 (验证反推 storage 方向)
> - `README.md` §3 (KV / R2 / DO storage / D1 技术栈)
> 文档状态: `draft`

---

## 0. 背景与前置约束

### 0.1 为什么 Storage Topology 是最后设计的

`docs/plan-after-nacp.md` §4.2 明确指出：storage topology 必须**排在最后**设计，因为"只有知道'谁在什么时候读写什么'，才能真正决定 DO / KV / R2 边界"。这一观点被本文完全采纳——这份文档不是"先拍一个 schema 再实现"，而是"基于前面所有功能簇的读写模式，反推最小可行的 storage 分层"。

更重要的是：**这不是数据库 schema 设计文档**。这是 **storage semantics 设计文档**——回答的不是"表结构怎么建"，而是"什么数据住在哪一层、为什么"。

### 0.2 前置共识

- **可用的存储层**（来自 README §3 的当前技术栈承诺）：
  - **DO storage** (`state.storage`)：per-DO 强一致，~1ms 读写，50GB/DO 上限，key-value API
  - **KV** (`env.KV_*`)：最终一致（~60s TTL），全球边缘读优化，读多写少
  - **R2** (`env.R2_*`)：对象存储，强一致（per-object），无大小上限（5GB/object），~100-500ms
  - **D1**：Cloudflare 平台提供的 SQLite-at-edge，**但 README 当前技术栈表未将 D1 列为已承诺层**——v1 不引入 D1，仅作为未来可能的扩展层（当 eval-observability 验证表明需要结构化查询时才评估）
- **多租户 namespace**（来自 NACP §5.4 + §5.8）：所有 R2/KV key 必须以 `tenants/{team_uuid}/` 开头。**显式例外**：`_platform/` 前缀用于 platform-global 数据（如 feature flags），不属于任何特定租户——这是多租户 namespace 规则的唯一例外，必须在 `scoped-io.ts` 和 `storage-keys.ts` 中显式标记
- **Session = DO 实例**（来自 session-do-runtime design）：一个 session 的 hot state 全在一个 DO 的 `state.storage` 里
- **"DDL 不是第一步"**（来自 plan-after-nacp §7.3）：D1/DDL 只在"验证表明需要结构化查询"后才引入

### 0.3 显式排除的讨论范围

- 不讨论 D1 DDL / table schema（v1 不引入 D1）
- 不讨论 Analytics Engine pipeline
- 不讨论跨区域数据复制策略
- 不讨论数据保留与合规策略（GDPR / data deletion 属于运维）
- 不讨论 billing / metering schema

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Storage Topology`
- **一句话定义**：Storage Topology 定义 nano-agent 的**数据分层语义**——什么数据住在 DO storage（hot）、什么数据住在 KV（warm/shared）、什么数据住在 R2（cold/large）、以及这三层之间的**提升/下降/引用**规则。
- **边界描述**：
  - **包含**：hot/warm/cold 分层定义、per-layer 数据清单、key schema 约定、提升/下降触发条件、tenant namespace 规则、checkpoint format、archive/export path
  - **不包含**：D1 DDL、Analytics Engine schema、billing pipeline、具体的 compact 算法（那是 workspace-context 的范畴）

### 1.2 关键术语对齐

| 术语 | 定义 | 备注 |
|------|------|------|
| **Hot State** | 当前 session 正在使用的、需要亚毫秒读取的数据 | 住在 DO `state.storage` |
| **Warm State** | 跨 session 共享的、读多写少的配置/元数据 | 住在 KV |
| **Cold State** | 归档的、体积大的、低频访问的数据 | 住在 R2 |
| **Promotion** | 数据从冷层移到热层（例如 restore 时从 R2 读回 DO storage） | 触发条件：session resume / context recall |
| **Demotion** | 数据从热层移到冷层（例如 compact 后把旧 turn 归档到 R2） | 触发条件：context compact / session archive |
| **Ref** | NACP `NacpRef` 结构——指向外部存储位置的指针 | `{kind, binding, team_uuid, key, role}` |

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

Storage Topology 是**数据架构的"交通规则"**——它不自己持有数据，但它定义"这条数据应该走哪条路、住在哪栋楼"。

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|---------|---------|------|
| **Session DO Runtime** | Session DO 的 checkpoint/restore 格式由 topology 定义 | 强 | hot state = DO storage |
| **NACP-Core** | `NacpRef` 的 `kind` / `key` schema 由 topology 约定 | 强 | refs = cold state 引用 |
| **NACP-Session** | replay buffer checkpoint 格式 | 中 | 在 DO storage 里 |
| **Workspace / Context** | 工作区文件在 R2，context layers 的提升/下降策略 | 强 | R2 = workspace backing |
| **LLM Wrapper** | attachment staging 在 R2，provider config 在 KV | 中 | warm = shared config |
| **Hooks** | hook config 在 KV（platform policy），audit log 在 DO → R2 | 中 | audit demotion path |
| **Eval / Observability** | trace events 在 DO storage JSONL，归档到 R2 | 中 | storage placement inspector 观察 |
| **Capability Runtime** | skill manifest 在 KV，skill asset 在 R2 | 中 | warm + cold |

### 2.3 一句话定位陈述

> "Storage Topology 是 nano-agent 的**数据分层规则**，负责**定义 DO storage / KV / R2 三层各自持有什么数据、以什么 key schema 存储、何时提升/下降、如何被 `NacpRef` 引用**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点

| 被砍项 | 砍的理由 | 未来是否回补 |
|--------|---------|-------------|
| D1 DDL / SQLite tables | v1 不需要结构化查询；所有 hot state 走 DO storage KV API | 按需（analytics / registry index） |
| 跨 DO 数据 join | v1 一 session 一 DO，不 join | 按需 |
| Data lake / Analytics Engine | v1 不需要聚合分析 | v2 |
| 数据保留策略 (TTL / auto-delete) | v1 手动管理 | 运维工具 |

### 3.2 接口保留点

| 扩展点 | v1 行为 | 未来可能演进 |
|--------|---------|-------------|
| `StorageAdapter` interface | v1 直接调 DO storage / R2 / KV via scoped-io | 可替换为 D1-backed adapter |
| `demote(session_uuid, from, to)` | v1 只有 "DO → R2" 的 archive 路径 | 可扩展为 "KV → R2" / "DO → KV" |
| `promote(ref)` | v1 只有 "R2 → DO" 的 restore 路径 | 可扩展为 "KV → DO" / "R2 → KV" |

### 3.3 解耦点

- **topology rules 与 storage implementation 分离**：`storage-topology.ts` 定义"这条数据该去哪"；`scoped-io.ts` 负责"怎么写到那里"
- **demotion trigger 与 compact algorithm 分离**：compact 决定"哪些 turn 可以归档"；topology 决定"归档到哪里、key 格式是什么"

### 3.4 聚合点

- **所有 storage key schema 在一份 constant 文件里定义**：`storage-keys.ts` 或类似物
- **所有 `NacpRef` 的构建走统一 builder**：`buildRef(kind, team_uuid, path) → NacpRef`

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent

- **存储模型**（从代码事实）：
  - **Hot**：`Agent.messages: list[Message]`（`agent.py:76`，纯内存）+ `self.api_total_tokens: int`（`agent.py:82`）
  - **Warm/config**：三层 config 解析（`config.py:191-206`）：dev `./mini_agent/config/` → user `~/.mini-agent/config/` → package dir，加载 `config.yaml` 含 `api_key / api_base / model / provider / retry / max_steps / workspace_dir / system_prompt_path`（`config.py:66-164`）。MCP config 有 fallback 到 `mcp-example.json`（`mcp_loader.py:299-327`）
  - **Cold/persistent**：`SessionNoteTool` 写 `<workspace>/.agent_memory.json`（`note_tool.py:31`），格式 = JSON array of `{timestamp(ISO), category, content}`（`note_tool.py:105-110`），lazy init（`note_tool.py:69-89`）
  - **Log**：`~/.mini-agent/log/agent_run_{YYYYMMDD_HHMMSS}.log` plain-text（`logger.py:30-39`）
- **值得借鉴**：
  - **三层 config 的 priority 搜索**（dev → user → package）直接对应 nano-agent 的 "platform policy → team config → session override" 三层 KV 读取
  - **`.agent_memory.json` 的 lazy init**（不写就不创建文件）→ DO storage 可以 "不 checkpoint 就不写"
- **不照抄的**：纯内存 messages 无法恢复；plain-text log 不可程序化查询

### 4.2 codex

- **存储模型**（从代码事实）：
  - **Hot**：`CodexThread` 包裹 `Codex` 实例（`codex_thread.rs:51-71`），持有 `rollout_path`、`out_of_band_elicitation_count`。内部 `Session` 含 `Mutex<SessionState>`。`ThreadConfigSnapshot`（`codex_thread.rs:37-49`）是 per-turn 的临时快照（model / provider / approval / sandbox / reasoning_effort / personality）。
  - **Warm/config**：`~/.codex/config.toml` 多层加载（`config_loader/mod.rs:89-112`）：CLI overrides → project/repo → directory tree → user → system `/etc/codex/config.toml` → managed cloud。字段含 model / provider / approval_policy / sandbox_mode / permissions / mcp_servers / memories / skills / plugins（`config_toml.rs:66-395`）。Project instructions 从 `AGENTS.md` 加载，截断到 32 KiB（`config/mod.rs:123`）。
  - **Cold/persistent**：rollout JSONL 在 `~/.codex/sessions/YYYY/MM/DD/`（`recorder.rs:776-797`），filename = `timestamp_uuid.jsonl`。每行一个 `RolloutItem` enum（5 variants）。`RolloutRecorder`（`recorder.rs:74-81`）通过 async channel `tx: Sender<RolloutCmd>` 驱动写入。Output 截断到 10KB（`recorder.rs:189-212`）。
  - **Index/state DB**：可选 SQLite（`config_toml.rs:229-231` 的 `sqlite_home` 字段），用于 `StoredThread` 元数据索引（22 个字段，`thread-store/types.rs:135-178`），支持 backfill scan（`metadata.rs:136-355`，batch=200）。
- **值得借鉴（直接复用模式）**：
  - **`StoredThread` 的 22 字段**（`types.rs:135-178`）：`thread_id / forked_from_id / preview / name / model / model_provider / cwd / source / agent_nickname / git_info / approval_mode / sandbox_policy / token_usage / first_user_message`——nano-agent 的 DO checkpoint 字段集直接参考此表
  - **Config 多层加载**（`config_loader/mod.rs:89-112`）：CLI → project → user → system → managed。对应 nano-agent 的 KV 层级模型
  - **Rollout 的 date-partitioned 目录结构**（`sessions/YYYY/MM/DD/`）→ R2 archive 的 key prefix
  - **`ThreadEventPersistenceMode` 的 Limited vs Extended 两档**（`thread-store/types.rs:20-26`）→ nano-agent 可以有 `compact` vs `full` 两种审计深度
- **不照抄的**：SQLite state DB（v1 不引入 D1）；FS-based rollout path（我们用 R2）

### 4.3 claude-code

- **存储模型**（从代码事实）：
  - **Hot**：`AppState`（`AppStateStore.ts:89-452`）= `DeepImmutable` store + mutable `tasks / agentNameRegistry / fileHistory / mcp / sessionHooks / speculation / denialTracking / teamContext`。Store 接口（`store.ts:4-8`）= `getState() / setState(updater) / subscribe(listener)`。
  - **Warm/config**：4 层 settings cascade（`settings.ts:58-199`）：managed `/etc/claude-code/managed-settings.json` + drop-ins → user `~/.claude/settings.json` → project → local。`parseSettingsFile()` 缓存 + clone-on-return 防 mutation。CLAUDE.md 层级：managed → user → project（`claudemd.ts:1-26`）含 `@include` 递归。
  - **Cold/persistent**：`~/.claude/history.jsonl`（`history.ts:115`）全局共享，每行 = `LogEntry { sessionId, timestamp, project, display, pastedContents }`（`history.ts:102-143`）。大 paste inline < 1024 bytes，否则 hash reference（`history.ts:25-31`）。`readLinesReverse()` 反向读取（`history.ts:145-179`）。Session transcript 通过 `recordTranscript()` → `getTranscriptPath()` 按 session 写 JSONL。`flushSessionStorage()` 锁定后批量追加。Tombstone rewrite limit = 50MB（`sessionStorage.ts:123`）。
  - **Session memory**：`SessionMemory` 服务，threshold = 10k tokens 初始化，每 5k tokens 或 3 tool calls 更新（`sessionMemoryUtils.ts:32-36`）。Compact config 从 GrowthBook 远端读取（`sessionMemoryCompact.ts:57-130`）。
  - **Cost tracking**：`cost-tracker.ts:71-174` 持久化 `lastCost / lastAPIDuration / lastToolDuration / lastLinesAdded/Removed` 到 project config。Per-model usage：`input/output/cache tokens + cost USD + web search requests`。`restoreCostStateForSession()` 在 resume 时水合。
  - **Cache paths**：project-scoped（`cachePaths.ts:25-37`）= `${XDG_CACHE_HOME}/claude-cli/<sanitized_cwd>/`；非字母数字字符替换为 `-`；路径 >200 字符做 DJB2 hash（`cachePaths.ts:4-19`）。
- **值得借鉴（直接复用模式）**：
  - **Session memory 的 token 阈值 + update 频率策略**（`sessionMemoryUtils.ts:32-76`）→ nano-agent 的长时记忆抽取策略
  - **Cost tracking 的 per-model usage 结构**（`cost-tracker.ts:160-174`）→ DO checkpoint 应含等价字段
  - **History JSONL 的 "大 paste hash reference" 模式**（`history.ts:25-31`）→ DO storage 里大对象应只存 `NacpRef`，原文放 R2
  - **Settings 4 层 cascade + parseSettingsFile 缓存**（`settings.ts:58-199`）→ KV config 的读取层级与缓存策略
  - **Cache path sanitization**（DJB2 hash for > 200 chars）→ R2 key 的长路径处理
- **不照抄的**：React `DeepImmutable` store；XDG 本地缓存路径；GrowthBook 远端 config

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | **nano-agent 倾向** |
|------|-----------|-------|-------------|---------------------|
| Hot state | `Agent.messages` 内存 | `Mutex<SessionState>` + `ThreadConfigSnapshot` | `AppState` 400+ 字段 store | **DO `state.storage` checkpoint** |
| Cold/archive | `.agent_memory.json` 只 | rollout JSONL `~/.codex/sessions/YYYY/MM/DD/` | `~/.claude/history.jsonl` + transcript | **R2 JSONL，key = `tenants/{t}/sessions/{s}/archive/`** |
| Shared config | 3 层 yaml（`config.py:191`） | 多层 toml（`config_loader/mod.rs:89`） | 4 层 json（`settings.ts:58`） | **KV 多层 cascade** |
| 大对象 | 无 | rollout output 10KB 截断 | paste hash ref（`history.ts:25`） | **DO inline < 1MB；大对象 → R2 `NacpRef`** |
| Resume | 无 | `LoadThreadHistoryParams`（`types.rs:67`） | `restoreCostStateForSession`（`cost-tracker.ts:87`） | **DO checkpoint / restore** |
| Session memory | `.agent_memory.json` | 无 | `SessionMemory` 10k token 阈值 | **待 workspace-context 设计** |
| Index/query | 无 | SQLite state DB（`config_toml.rs:229`） | 无 | **v1 不引入 D1** |
| Resume 能力 | none | rollout replay | none | **DO checkpoint + restore** |
| 多租户 | none | none | none | **`tenants/{team_uuid}/` namespace in all layers** |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope

- **[S1]** 三层分类定义：DO storage (hot) / KV (warm) / R2 (cold) 各自持有什么数据
- **[S2]** Key schema 约定：每一层的 key 格式规范（含 `tenants/{team_uuid}/` 前缀）
- **[S3]** Per-data-item placement table：所有已知数据条目（session state / replay buffer / config / audit / workspace files / skill manifest / attachment / compact archive）的 placement 决策
- **[S4]** Checkpoint format：Session DO 的 `state.storage` checkpoint 的 JSON 结构定义
- **[S5]** Demotion path：DO audit log → R2 archive 的触发条件与 key 格式
- **[S6]** Promotion path：R2 → DO restore 的触发条件（session.resume）
- **[S7]** `NacpRef` builder：统一的 ref 构造 helper
- **[S8]** Storage key constants：集中定义所有 key pattern
- **[S9]** `scoped-io.ts` 对齐验证：确保所有读写都走 tenant-scoped wrapper

### 5.2 Out-of-Scope

- **[O1]** D1 DDL / table schema
- **[O2]** Analytics Engine pipeline
- **[O3]** Data retention / TTL / GDPR compliance
- **[O4]** Billing / metering storage
- **[O5]** Cross-region replication

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **"DO storage 作为唯一 hot state"** 而不是 **"部分 hot state 放 KV"**
   - **为什么**：DO storage 是 per-actor 强一致；KV 是全局最终一致。turn-by-turn 的 session state 必须强一致。
   - **代价**：单 DO 50GB；需要 compact + archive 策略防止膨胀
   - **重评条件**：如果 session state 超过 DO 限制

2. **取舍 2**：我们选择 **"KV 只放读多写少的 shared config"** 而不是 **"KV 放 session metadata"**
   - **为什么**：KV 的最终一致性（~60s TTL）不适合 session 级别的"这个 session 在不在"判断
   - **代价**：session discovery 需要走 DO 级别的 lookup（`idFromName`），不能走 KV scan
   - **重评条件**：如果需要"列出所有活跃 session"的功能

3. **取舍 3**：我们选择 **"v1 不引入 D1"** 而不是 **"先建 DDL 再开发"**
   - **为什么**：plan-after-nacp 明确要求"DDL 是验证结果的收敛，不是前置条件"
   - **代价**：不支持 SQL 查询（trace / audit / registry）；查询只能 scan DO storage / R2
   - **重评条件**：当 eval-observability 的 trace timeline 查询性能不可接受时

---

## 7. In-Scope 功能详细列表

### 7.1 三层数据分布表（Provisional Placement Hypotheses）

> ⚠️ **这是候选分层假设，不是最终基线。** 遵循 `plan-after-nacp.md` "由验证反推 storage" 的原则，以下 placement 决策在 eval-observability 的 `StoragePlacementLog` 采集到真实读写频率 / 大小分布证据之前，均为**暂定假设**。具体阈值（如 1MB workspace file 分界线）需要等 workspace runtime 和 eval harness 落地后校准。

| 数据条目 | 层 | Key Schema | 读频率 | 写频率 | 大小预估 | 理由 |
|---------|-----|-----------|--------|--------|---------|------|
| Session phase + turn count | DO storage | `session:phase` / `session:turn_count` | 每 turn | 每 turn | < 1KB | hot, 强一致, 高频 |
| Message history (current) | DO storage | `session:messages` | 每 LLM call | 每 turn | 10KB-500KB | hot, 核心数据 |
| Replay buffer checkpoint | DO storage | `nacp_session:replay` | resume 时 | detach/hibernate 时 | 1KB-100KB | 已被 nacp-session 定义 |
| Stream seq counters | DO storage | `nacp_session:stream_seqs` | resume 时 | detach/hibernate 时 | < 1KB | 已被 nacp-session 定义 |
| Tool call in-flight state | DO storage | `tool:inflight:{request_uuid}` | 每 step | tool start/end | < 10KB | hot, 需要 cancel/timeout |
| Hook config (session-level) | DO storage | `hooks:session_config` | 每 hook emit | session start | < 10KB | session-scoped |
| Audit trail (current session) | DO storage | `audit:{date}` | debug/replay | 每 event | 10KB-1MB/day | 定期 archive 到 R2 |
| System prompt snapshot | DO storage | `context:system_prompt` | 每 LLM call | session start | < 50KB | hot, 不常变 |
| Workspace file (small, <1MB†) | DO storage | `workspace:file:{path}` | 按需 | 按需 | < 1MB | hot for active files；**†1MB 阈值待 eval 校准** |
| Workspace file (large, >1MB†) | R2 | `tenants/{t}/sessions/{s}/workspace/{path}` | 按需 | 按需 | > 1MB | 大文件天然走 R2；具体 materialization 由 workspace namespace (mount-based) 决定 |
| Compact archive (old turns) | R2 | `tenants/{t}/sessions/{s}/archive/{turn_range}.jsonl` | replay 时 | compact 时 | 10KB-10MB | cold, 低频 |
| Session transcript (export) | R2 | `tenants/{t}/sessions/{s}/transcript.jsonl` | export 时 | session end 时 | 10KB-10MB | cold, 一次写 |
| Audit archive (old) | R2 | `tenants/{t}/audit/{date}/{session_uuid}.jsonl` | debug/compliance | 定期 | varies | cold, 归档 |
| Attachment (image/file) | R2 | `tenants/{t}/attachments/{uuid}` | LLM call 时 | upload 时 | varies | cold, 大对象 |
| Provider config | KV | `tenants/{t}/config/providers` | 每 LLM call | 管理面写 | < 10KB | warm, 读多写少 |
| Model registry snapshot | KV | `tenants/{t}/config/models` | 每 LLM call | 管理面写 | < 10KB | warm |
| Skill manifest | KV | `tenants/{t}/config/skills` | session start | 管理面写 | < 50KB | warm |
| Hook config (platform-policy) | KV | `tenants/{t}/config/hooks_policy` | session start | 管理面写 | < 10KB | warm |
| Feature flags | KV | `_platform/config/feature_flags` | 每 request | 管理面写 | < 1KB | warm, 全局共享 |

### 7.2 Checkpoint 格式（候选字段集）

> ⚠️ **以下是候选字段集，不是冻结结构。** runtime kernel action-plan、workspace runtime 和 observability harness 均未落地，因此具体字段（尤其是 `workspace_files` 的 inline 策略和 `messages` 的 compact 后结构）需要在实装阶段根据实际情况确认。

Session DO 的 `state.storage` 的 checkpoint 结构：

```typescript
interface SessionCheckpoint {
  version: "1.0.0";
  session_uuid: string;
  team_uuid: string;
  phase: SessionPhase;
  turn_count: number;
  // compact 前：CanonicalMessage[]（完整历史）
  // compact 后：被 CompactBoundaryManager 替换为
  //   [...recentMessages, CompactBoundaryRecord]
  //   其中旧 turn 的完整内容通过 NacpRef 指向 R2 archive
  messages: CanonicalMessage[];
  system_prompt_snapshot: string;
  tool_inflight: Record<string, ToolInflightState>;
  hooks_session_config: HookConfig;
  workspace_files: Record<string, string>; // small files inline（阈值待校准）
  workspace_refs: NacpRef[];               // large files as R2 refs
  audit_buffer: string[];                  // pending audit events
  nacp_session_replay: Record<string, { events: unknown[]; baseSeq: number }>;
  nacp_session_stream_seqs: Record<string, number>;
  created_at: string;
  last_checkpoint_at: string;
}
```

### 7.3 Key Schema Constants

```typescript
// storage-keys.ts
export const DO_KEYS = {
  SESSION_PHASE: "session:phase",
  SESSION_MESSAGES: "session:messages",
  SESSION_SYSTEM_PROMPT: "context:system_prompt",
  SESSION_HOOKS_CONFIG: "hooks:session_config",
  SESSION_REPLAY: "nacp_session:replay",
  SESSION_STREAM_SEQS: "nacp_session:stream_seqs",
  TOOL_INFLIGHT_PREFIX: "tool:inflight:",
  AUDIT_PREFIX: "audit:",
  WORKSPACE_FILE_PREFIX: "workspace:file:",
} as const;

export const KV_KEYS = {
  PROVIDER_CONFIG: (teamUuid: string) => `tenants/${teamUuid}/config/providers`,
  MODEL_REGISTRY: (teamUuid: string) => `tenants/${teamUuid}/config/models`,
  SKILL_MANIFEST: (teamUuid: string) => `tenants/${teamUuid}/config/skills`,
  HOOKS_POLICY: (teamUuid: string) => `tenants/${teamUuid}/config/hooks_policy`,
  FEATURE_FLAGS: "_platform/config/feature_flags",
} as const;

export const R2_KEYS = {
  WORKSPACE_FILE: (teamUuid: string, sessionUuid: string, path: string) =>
    `tenants/${teamUuid}/sessions/${sessionUuid}/workspace/${path}`,
  COMPACT_ARCHIVE: (teamUuid: string, sessionUuid: string, range: string) =>
    `tenants/${teamUuid}/sessions/${sessionUuid}/archive/${range}.jsonl`,
  SESSION_TRANSCRIPT: (teamUuid: string, sessionUuid: string) =>
    `tenants/${teamUuid}/sessions/${sessionUuid}/transcript.jsonl`,
  AUDIT_ARCHIVE: (teamUuid: string, date: string, sessionUuid: string) =>
    `tenants/${teamUuid}/audit/${date}/${sessionUuid}.jsonl`,
  ATTACHMENT: (teamUuid: string, uuid: string) =>
    `tenants/${teamUuid}/attachments/${uuid}`,
} as const;
```

### 7.4 Demotion / Promotion Paths

**Demotion (hot → cold)**：
1. **Audit demotion**：Session DO 的 `audit:{date}` 在 session end / daily alarm 时，被批量写到 R2 `tenants/{t}/audit/{date}/{s}.jsonl`
2. **Context compact demotion**：compact 把旧 turn 的 messages 从 DO `session:messages` 移到 R2 `tenants/{t}/sessions/{s}/archive/{range}.jsonl`
3. **Workspace large file demotion**：当文件超过 1MB threshold，从 DO `workspace:file:{path}` 移到 R2 `tenants/{t}/sessions/{s}/workspace/{path}`，DO 里只留一个 `NacpRef`

**Promotion (cold → hot)**：
1. **Session resume**：从 DO storage restore checkpoint（DO → DO，不是 promotion）
2. **Context recall**：compact archive 从 R2 读回关键 turn 到 DO `session:messages`
3. **Attachment inline**：attachment URL 在 LLM request 构建时被解析（R2 → 短时 URL，不是真 promotion）

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 nacp-core

| 文件 | 借鉴点 |
|------|--------|
| `packages/nacp-core/src/envelope.ts` | `NacpRefSchema` — refs 的 kind/key/team_uuid 约束 |
| `packages/nacp-core/src/tenancy/scoped-io.ts` | `tenantR2Put/Get/List` + `tenantKvGet/Put` + `tenantDoStoragePut/Get` — 所有 I/O 的 tenant-scoped 包装 |

### 8.2 来自 nacp-session

| 文件 | 借鉴点 |
|------|--------|
| `packages/nacp-session/src/websocket.ts` | `checkpoint()` / `restore()` — DO storage checkpoint 的现有实现 |
| `packages/nacp-session/src/replay.ts` | `ReplayBuffer.checkpoint()` — replay buffer 的序列化格式 |

### 8.3 来自 codex

| 文件:行 | 借鉴点 | 怎么用 |
|---------|--------|--------|
| `codex-rs/thread-store/src/types.rs:135-178` | `StoredThread` 的 22 字段（thread_id / model / cwd / git_info / token_usage / approval_mode / sandbox_policy / first_user_message...） | DO checkpoint 字段集的直接参考 |
| `codex-rs/thread-store/src/types.rs:20-26` | `ThreadEventPersistenceMode: Limited \| Extended` | nano-agent 的审计深度两档：`compact` vs `full` |
| `codex-rs/rollout/src/recorder.rs:776-797` | 归档目录 `sessions/YYYY/MM/DD/` + filename `timestamp_uuid.jsonl` | R2 archive key 的 date-partitioned 结构 |
| `codex-rs/rollout/src/recorder.rs:189-212` | Output 截断到 10,000 bytes | audit event 的 truncation 策略 |
| `codex-rs/core/src/config_loader/mod.rs:89-112` | Config 多层加载：CLI → project → directory tree → user → system → managed | KV config cascade 的层级模型 |
| `codex-rs/config/src/config_toml.rs:66-395` | config.toml 的字段全集（model / provider / approval / sandbox / mcp / skills / plugins / memories） | KV 需要存的 config 字段清单 |
| `codex-rs/instructions/src/user_instructions.rs:12-34` | `UserInstructions { directory, text }`，AGENTS.md 截断到 32 KiB | KV 里的 project instructions 大小上限参考 |
| `codex-rs/config/src/config_toml.rs:229-235` | `sqlite_home` / `log_dir` 可配置路径 | v2 如果引入 D1，config 里应有 `d1_database_id` |

### 8.4 来自 claude-code

| 文件:行 | 借鉴点 | 怎么用 |
|---------|--------|--------|
| `claude-code/utils/settings/settings.ts:58-199` | 4 层 cascade（managed → user → project → local）+ `parseSettingsFile()` 缓存 + clone-on-return | KV config 读取策略：`_platform/ → tenants/{t}/config/ → session-local`，cache 后 clone 防 mutation |
| `claude-code/utils/claudemd.ts:1-26` | CLAUDE.md 层级：managed → user → project + `@include` 递归 + 循环检测 | KV 里的 instructions 多层叠加策略 |
| `claude-code/history.ts:25-31,102-143` | 大 paste inline < 1024 bytes，否则 hash reference；`readLinesReverse()` 反向读取 | DO inline < 1MB，大对象存 R2 只留 `NacpRef`；history 从尾部读取最新 |
| `claude-code/services/compact/autoCompact.ts:72-239` | `effectiveContextWindow - 13000` 阈值 + circuit breaker（3 次失败后停止） | compact demotion 的触发条件 |
| `claude-code/services/compact/sessionMemoryCompact.ts:57-130` | GrowthBook 远端读取 compact 配置（minTokens: 10k, maxTokens: 40k） | KV 里存的 compact policy 字段参考 |
| `claude-code/cost-tracker.ts:71-174` | Per-session per-model usage tracking + `restoreCostStateForSession()` resume | DO checkpoint 应含 usage 字段；resume 时水合 |
| `claude-code/utils/cachePaths.ts:4-19` | 路径 >200 字符做 DJB2 hash | R2 key 的长路径 hash 策略 |
| `claude-code/utils/sessionStorage.ts:123` | Tombstone rewrite 50MB 上限 | DO storage 的归档阈值参考（超过某值就 demote 到 R2） |

### 8.5 来自 mini-agent

| 文件:行 | 借鉴点 | 怎么用 |
|---------|--------|--------|
| `mini_agent/config.py:191-206` | 3 层 config priority：dev → user → package | KV config 最小层级模型 |
| `mini_agent/tools/note_tool.py:31,69-89` | `.agent_memory.json` lazy init（不写不创建）| DO storage 的 "不 checkpoint 就不写" 策略 |
| `mini_agent/tools/mcp_loader.py:299-327` | MCP config fallback 到 example 文件 | KV config 的 "fallback to default" 策略 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

Storage Topology 是 nano-agent 的**数据分层规则**，把 Cloudflare 的三层存储（DO storage / KV / R2）映射到 agent 的数据语义上：

- **DO storage** = session hot state（phase / messages / replay / inflight / small workspace files / audit buffer）
- **KV** = shared warm config（provider / model / skill / hooks policy / feature flags）
- **R2** = cold archive + large objects（compact archive / transcript / audit archive / attachment / large workspace files）

v1 不引入 D1——DO storage 的 KV API + R2 的对象 API 足以覆盖 agent runtime 的全部读写模式。D1 只在"验证表明需要 SQL 查询"后才引入。

核心约束是**多租户 namespace**（`tenants/{team_uuid}/`）和**提升/下降触发条件**（compact / session end / file size threshold）。所有读写走 `scoped-io.ts` 包装层，key schema 集中在 `storage-keys.ts` 常量文件。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 三层分层完美对齐 CF 原生存储 |
| 第一版实现的性价比 | 5 | 不做 D1 = 省掉大量 DDL 工程；DO + KV + R2 足够 |
| 对 eval-observability 的杠杆 | 5 | storage placement inspector 直接消费 key schema |
| 对 context / compact 的杠杆 | 5 | demotion path 定义了 compact 归档到哪里 |
| **综合价值** | **5** | **"不拍脑袋定存储，用规则定存储"** |

### 9.3 下一步行动

- [ ] 等 eval-observability 的 trace evidence 验证后，确认三层分布表是否需要调整
- [ ] 等 workspace-context 设计完成后，确认 workspace file 的 1MB threshold 是否合适
- [ ] `storage-keys.ts` 应在 Session DO runtime 的 action-plan 中被实装
- [ ] 所有 storage 读写的 lint 规则已在 nacp-core 的 `scoped-io.ts` 中建立

---

## 附录

### A. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-16 | Opus 4.6 | 初稿 |
| v0.2 | 2026-04-16 | Opus 4.6 | 基于 GPT + Kimi review 修订：数据分布表降级为 provisional hypotheses(#3)、修 D1 为"未列入当前技术栈"(#9)、声明 `_platform/` 为 tenant namespace 显式例外(#10)、types.ts→types.rs(#13)、加 compact 后 messages 结构说明(#14)、checkpoint 标记为候选字段集 |
