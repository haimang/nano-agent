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

- **可用的存储层**（来自 README §3）：
  - **DO storage** (`state.storage`)：per-DO 强一致，~1ms 读写，50GB/DO 上限，key-value API
  - **KV** (`env.KV_*`)：最终一致（~60s TTL），全球边缘读优化，读多写少
  - **R2** (`env.R2_*`)：对象存储，强一致（per-object），无大小上限（5GB/object），~100-500ms
  - **D1** (`env.D1_*`)：SQLite-at-edge，结构化查询，但在 nano-agent v1 中**不是必需前提**
- **多租户 namespace**（来自 NACP §5.4 + §5.8）：所有 R2/KV key 必须以 `tenants/{team_uuid}/` 开头
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

- **存储模型**：pure ephemeral——`Agent.messages` 在内存，`.agent_memory.json` 在本地 FS，log 在 `~/.mini-agent/log/`
- **借鉴**：`.agent_memory.json` 是 nano-agent "session notes" 的 hot state 原型
- **不照抄**：完全无持久化 = 反例

### 4.2 codex

- **存储模型**：
  - Hot: `Session.state` (Mutex 内存) + `TurnContext` (per-turn 临时)
  - Cold: `~/.codex/sessions/rollout-*.jsonl` (JSONL 归档)
  - Shared: `~/.codex/config.toml` + 各种 policy 文件
  - Thread store 介于 hot/cold 之间（resume/fork/archive）
- **借鉴**：
  - **rollout = JSONL 归档**的模式 → 对应 nano-agent 的 "DO audit → R2 archive"
  - **thread-store 的 resume/fork/archive 三态** → 对应 nano-agent 的 "hot(DO) / archived(R2) / shared(KV)"
- **不照抄**：本地 FS 路径（我们用 R2）

### 4.3 claude-code

- **存储模型**：
  - Hot: `AppState` (React store 内存) + DO-equivalent 无（单进程）
  - Cold: `~/.claude/history.jsonl` + per-session transcript
  - Shared: `~/.claude/settings.json` (4 层合并) + `CLAUDE.md`
  - Cache: prompt cache per-block + `promptCacheBreakDetection`
- **借鉴**：
  - **4 层 settings 合并** → nano-agent 的 KV shared config 可以有 platform / project / session 层级
  - **`sessionStorage.ts` 的 `recordTranscript()` + `flushSessionStorage()`** → DO checkpoint + R2 archive
- **不照抄**：本地 FS + React store

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | **nano-agent 倾向** |
|------|-----------|-------|-------------|---------------------|
| Hot state | memory only | Mutex memory | React store | **DO `state.storage`** |
| Cold/archive | none | JSONL files | sessionStorage | **R2 JSONL** |
| Shared config | none | config.toml | settings.json 4 层 | **KV** |
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

### 7.1 三层数据分布表

> 这是本文档最核心的产出——每一条已知数据条目的 placement 决策。

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
| Workspace file (small, <1MB) | DO storage | `workspace:file:{path}` | 按需 | 按需 | < 1MB | hot for active files |
| Workspace file (large, >1MB) | R2 | `tenants/{t}/sessions/{s}/workspace/{path}` | 按需 | 按需 | > 1MB | 大文件天然走 R2 |
| Compact archive (old turns) | R2 | `tenants/{t}/sessions/{s}/archive/{turn_range}.jsonl` | replay 时 | compact 时 | 10KB-10MB | cold, 低频 |
| Session transcript (export) | R2 | `tenants/{t}/sessions/{s}/transcript.jsonl` | export 时 | session end 时 | 10KB-10MB | cold, 一次写 |
| Audit archive (old) | R2 | `tenants/{t}/audit/{date}/{session_uuid}.jsonl` | debug/compliance | 定期 | varies | cold, 归档 |
| Attachment (image/file) | R2 | `tenants/{t}/attachments/{uuid}` | LLM call 时 | upload 时 | varies | cold, 大对象 |
| Provider config | KV | `tenants/{t}/config/providers` | 每 LLM call | 管理面写 | < 10KB | warm, 读多写少 |
| Model registry snapshot | KV | `tenants/{t}/config/models` | 每 LLM call | 管理面写 | < 10KB | warm |
| Skill manifest | KV | `tenants/{t}/config/skills` | session start | 管理面写 | < 50KB | warm |
| Hook config (platform-policy) | KV | `tenants/{t}/config/hooks_policy` | session start | 管理面写 | < 10KB | warm |
| Feature flags | KV | `_platform/config/feature_flags` | 每 request | 管理面写 | < 1KB | warm, 全局共享 |

### 7.2 Checkpoint 格式

Session DO 的 `state.storage` 的 checkpoint 结构：

```typescript
interface SessionCheckpoint {
  version: "1.0.0";
  session_uuid: string;
  team_uuid: string;
  phase: SessionPhase;
  turn_count: number;
  messages: CanonicalMessage[];
  system_prompt_snapshot: string;
  tool_inflight: Record<string, ToolInflightState>;
  hooks_session_config: HookConfig;
  workspace_files: Record<string, string>; // small files inline
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

| 文件 | 借鉴点 |
|------|--------|
| `context/codex/codex-rs/rollout/src/recorder.rs` | JSONL 归档格式 → R2 archive format 的参考 |
| `context/codex/codex-rs/thread-store/src/types.rs` | resume/fork/archive 三态 → DO/R2 的提升/下降心智 |

### 8.4 来自 claude-code

| 文件 | 借鉴点 |
|------|--------|
| `context/claude-code/services/compact/autoCompact.ts` | compact 触发阈值 → demotion trigger 的参考 |
| `context/claude-code/utils/sessionStorage.ts` | `flushSessionStorage()` → session end 时的归档模式 |

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
