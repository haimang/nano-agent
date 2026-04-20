# smind-contexter Learnings — Evaluation for Nano-Agent Context Management

> **审阅对象**: `context/smind-contexter/` (smind 家族的 RAG 对话核心 v4.4)
> **审阅时间**: 2026-04-20
> **审阅者**: Claude Opus 4.7 (1M context)
> **审阅依据**:
> - `context/smind-contexter/app/design.txt` (v1.1 工程总纲)
> - `context/smind-contexter/app/memo-DDL.txt` (持久化 schema 蓝图)
> - `context/smind-contexter/app/memo-cicp.ts.txt` (Contexter Internal Communication Protocol v1.2)
> - `context/smind-contexter/app/memo_coldstart_prefill.txt` (Semantic Intent Routing 预制菜机制 v2.0)
> - `context/smind-contexter/app/plan-chat.ts.txt` (Gateway 开发备忘)
> - `context/smind-contexter/app/plan-engine_do.ts.txt` (EngineDO 开发备忘)
> - `context/smind-contexter/app/contexter-v1.1.png` (蓝图说明 v1.1)
> - `context/smind-contexter/app/contexter-v1.2.png` (蓝图说明 v1.2，本次核心解读对象)
> - **代码实现**:
>   - `context/smind-contexter/core/db_do.ts`
>   - `context/smind-contexter/context/director.ts` (v1.1)
>   - `context/smind-contexter/context/writer.ts` (v1.4)
>   - `context/smind-contexter/context/producer.ts` (v1.2, L3 已实装)
>   - `context/smind-contexter/ai/topN.ts` (Reranker)
> - **对照 nano-agent 实况**:
>   - `packages/context-management/` (B4 ship)
>   - `packages/workspace-context-artifacts/`
>   - `docs/action-plan/after-foundations/B4-context-management-package-async-core.md`
>   - `docs/issue/after-foundations/B7-final-closure.md`

---

## 0. 执行摘要（1 段 + 1 张图）

smind-contexter 是一个**已经量产**的 RAG 对话核心，其最高价值的工程资产是：
**三级槽位（L1 Active / L2 Swap / L3 Storage）+ 每轮 rebalance + BGE reranker + cosine 激活**
组合起来的**上下文热更新引擎**。这套引擎在 nano-agent 当前的 `@nano-agent/context-management` 里**并不存在**——我们只有基于 token 预算触发的一次性 compact（B4 `AsyncCompactOrchestrator`），没有 relevance-aware 的每轮再平衡。

对照我们 after-foundations 阶段的整体定位（`docs/plan-after-foundations.md`），smind 的 L1/L2/L3 slot 模型可以直接作为 worker matrix 阶段 `context.core` worker 的**内部结构起点**，省下一到两个迭代周期。

**本文档核心架构决策（2026-04-20 owner 拍板）**：

- **Reranker 不进 worker matrix first-wave**，推迟到 post-worker-matrix 阶段单独立项
- **Reranker 不作为 `context.core` 的组件**，而是**独立 `context.reranker` worker**
- **Reranker 的唤醒走 hook + service binding 路径**（利用 B5 Class D hook + B6 `reply_to` 字段），而非 `context.core` 直接 `await reranker.rerank()` 调用
- 这三条决策让 `context.core` 在 worker matrix 首 phase 可以**只关注 token budget + slot 装配**，延迟控制在 10ms 量级，不被 AI 推理拖累；rerank 能力作为**可插拔、fail-open、跨 Worker 订阅者**的模式引入，符合我们 nano-agent 既有的 hook 事件体系和 NACP `reply_to` 协议

本文档用 item-by-item 的方式审查 `app/` 下全部 8 项材料（5 txt + 2 png + 1 design），并给出逐项的"是否借鉴 / 如何借鉴 / 落到 nano-agent 哪里"决策。

---

## 1. 材料清单与审读进度

| 顺序 | 材料 | 字节 | 材料性质 | 是否审读 | 对 nano-agent 的重要度 |
|---|---|---|---|---|---|
| 1 | `app/design.txt` | 17 342 | 工程总纲 + 3 阶段演进路线 | ✅ 已完整阅读 | 🔴 高 |
| 2 | `app/memo-DDL.txt` | 6 780 | 5-module 持久化 schema | ✅ 已完整阅读 | 🔴 高 |
| 3 | `app/memo-cicp.ts.txt` | 7 535 | CICP 协议（含 client-gateway 统一） | ✅ 已完整阅读 | 🟡 中 |
| 4 | `app/memo_coldstart_prefill.txt` | 6 446 | 意图路由 + DO 本地向量预制 | ✅ 已完整阅读 | 🔴 高 |
| 5 | `app/plan-chat.ts.txt` | 5 563 | Gateway 无状态 worker 方案 | ✅ 已完整阅读 | 🟢 低（nano-agent 已有等价层） |
| 6 | `app/plan-engine_do.ts.txt` | 5 628 | 用户级 DO Orchestrator 方案 | ✅ 已完整阅读 | 🟡 中 |
| 7 | `app/contexter-v1.1.png` | 1.37 MB | 蓝图 v1.1 | ✅ 已解读 | 🟡 中（与 v1.2 对比看演进） |
| 8 | `app/contexter-v1.2.png` | 1.57 MB | **蓝图 v1.2（核心解读对象）** | ✅ 已解读 | 🔴 高 |

代码实现交叉验证 ✅ 已完成 `producer.ts / writer.ts / topN.ts / director.ts / db_do.ts`。

---

## 2. `app/contexter-v1.2.png` — 蓝图 v1.2 逐区解读

### 2.1 图面整体布局

v1.2 蓝图按照 **"左→中→右"** 的阅读顺序组织，自成一个**完整的一次 RAG 流水线**：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  SourceMind Contexter 蓝图说明 v1.2                                     │
│  (右上角：SourceMind 生态总览)                                          │
├─────────────────────────────┬───────────────────────────────────────────┤
│ [Left]                      │ [Right]                                   │
│ DO 内部 SQLite 的 5 张表     │ Token 经济学的可视化（竖条形图）           │
│ (conversations/chats/       │                                           │
│  contexts/vec_history/      │ MAX TOKEN BUDGET -------- (水平红线)      │
│  vec_intents)               │  ▇▇▇▇▇  ← Active Slot 1 (score=0.92)      │
│                             │  ▇▇▇▇   ← Active Slot 2 (score=0.87)      │
│ [Middle — 执行主链]          │  ▇▇▇    ← Active Slot 3 (score=0.71)      │
│                             │  ▇▇     ← Active Slot 4 (score=0.55)      │
│ Client APP                  │ ──────── (Active ↔ Swap 边界)             │
│   │                         │  ▇▇▇    ← Swap Slot A                     │
│   ▼                         │  ▇▇     ← Swap Slot B                     │
│ src/chat.ts (网关)          │  ▇      ← Swap Slot C                     │
│   │                         │ ──────── (Swap ↔ Storage 边界)            │
│   ▼                         │  ░░░    ← Cold Storage 中的 80+ 项        │
│ src/engine_do.ts (Actor)    │  ░░░░                                     │
│   │                         │  ░░                                       │
│   ▼                         │                                           │
│ context/director.ts         │ [Right-bottom 注释]                       │
│   │                         │ "Context 管理机关"                         │
│   ├─ ai/intent.ts           │                                           │
│   ├─ ai/vec.ts              │ Writer (编剧):                            │
│   ├─ ai/topK.ts             │  - 感知 ColdStart                          │
│   ├─ ai/topN.ts             │  - Hot/Warm/Async 三路采购                 │
│   │                         │                                           │
│   ▼                         │ Producer (制作):                          │
│ context/writer.ts           │  - Ingest 三路弹药                         │
│   │                         │  - Activate L3 (余弦)                     │
│   ▼                         │  - Rerank L1+L2                           │
│ context/producer.ts         │  - 组装 Active → LLM                      │
│   │                         │                                           │
│   ▼                         │                                           │
│ (LLM Gen + Stream)          │                                           │
└─────────────────────────────┴───────────────────────────────────────────┘
```

### 2.2 图中隐含的工程事实（我读到了什么）

**事实 1 — 槽位是"内容"而不是"指针"**
每个 Active / Swap Slot 在图中都画成一个**带长度的竖条**，条的长度 ≈ slot 实际消耗的 token。这说明 smind 的 Slot 是**完整内容驻留内存**的，不是 lazy-load 指针。Producer 每轮直接决定哪些内容进入 LLM prompt。

**事实 2 — MAX TOKEN BUDGET 是水平切断线**
红色的 `MAX TOKEN BUDGET` 线画在 Active 区内部，这意味着即使 Slot 入选了 Active（8 个上限），**也不一定全部能进入 LLM prompt**——由上至下累加字符数，一旦跨过红线就停止。`producer.ts::produceAssembly` 的代码 100% 对应这张图：

```ts
// producer.ts:328-357 (produceAssembly)
this.activeSlots.sort((a, b) => b.score - a.score);
for (const slot of this.activeSlots) {
    if (totalChars + slot.content_full.length > MAX_CONTEXT_CHARS) break;
    fullText += `[Reference: ${slot.meta.title}]\n${slot.content_full}\n\n`;
    totalChars += slot.content_full.length;
}
```

**事实 3 — L3 不占 token 预算**
图的 Storage 区画在 token budget 线**下方**并且是**虚线虚填**（表示冷藏），说明 L3 中的 80+ 项**默认不消耗 prompt token**——只有被 `activateStorage()` 升入 L2 并在 `rebalance()` 中胜出进 L1 之后，才会去排队分配 token 预算。这是 **"大池子 + 小窗口"** 的经典工程权衡。

**事实 4 — "DO 内部 5 张表"的读写分离**
左侧的 5 张 SQLite 表按**冷热**区分：
- `conversations / chats` — 会话 + 消息主干（高频读 / 低频整体）
- `contexts` — L1/L2 JSON + L3 ID 列表（**每轮** RW）
- `vec_history` — L3 完整 blob（**每轮** 批读，偶尔 W）
- `vec_intents` — alarm 刷新的意图路由（低频 RW）

这是**"热状态小而密 / 冷数据大而稀"**的明确物理分层，和我们 B7 F08 测出的 DO 2.1 MiB cap 吻合得非常好——小的热表绝不会超标，大 blob 全在专表。

**事实 5 — Producer 是决策终点**
所有流水线的线都从四面八方汇入 `context/producer.ts`，再从 Producer 出到 LLM Gen。这把"**谁进 prompt 的最终仲裁权**"锁定在一个单一模块里，责任边界极清。

### 2.3 v1.1 → v1.2 演进观察

两张图的大体骨架一致。v1.2 相较 v1.1 的差异（目测 + 对照 memo-cicp.ts.txt 的 v1.2 字段）：
- Token 经济学右侧面板**更突出**（可视化条形图更清晰）
- 客户端层（Client APP）在 v1.2 里被**明确纳入 CICP 协议范围**（memo-cicp 说的 "CICP Everywhere"）
- Director / Writer / Producer 三角在 v1.2 的注释里更像"感知-采购-裁决"三职分立

结论：v1.1 → v1.2 的演进主要是**协议边界推外 + 可视化表达**，底层架构没有大变动。

---

## 3. 逐份文档项目级分析

### 3.1 `app/design.txt` (17 342 字节) — 工程总纲 + 三阶段演进路线

#### 3.1.1 四大工程原则

| 原则 | smind 的做法 | nano-agent 当前状况 | 值不值得借鉴 |
|---|---|---|---|
| Zod as SSOT | 所有契约（API / DO 状态 / SMCP）都由 Zod schema 单一定义，TS 类型由 `z.infer` 推断 | 我们已是 Zod-first 风格（nacp-core / nacp-session / capability-runtime / context-management 都是）。**已对齐**。 | ✅ 已对齐 |
| Edge-native & Stateful | 所有核心在 Cloudflare Workers 边缘跑；会话即 Actor，DO 承载 | 我们 B1-B7 已验证的 `NanoSessionDO` 正是这个模式。**已对齐**。 | ✅ 已对齐 |
| 分层解耦（洋葱架构 Core → AI/RAG → Context → Src） | 严格分层，内层对外无感知，组合由外层做 | 我们的 `@nano-agent/*` 包的分层已经非常接近（nacp-core → nacp-session → session-do-runtime → 使用者）。**已对齐**。 | ✅ 已对齐 |
| 可观测性优先 | `trace_uuid` 强制携带 + 结构化 `log_code` | 我们的 eval-observability 已有 trace carrier + `SessionInspector` dedup，基本对齐。smind 的 `log_code` 离散枚举（`HOT_HIT`/`WARM_SKIP`/`REBALANCE_DONE` 等）可以**增量借鉴**——我们可以给 `@nano-agent/hooks` 的 audit mapping 增加一套 "stage code"。 | 🟡 部分借鉴：log_code 枚举思路 |

#### 3.1.2 三阶段演进路线（Phase I/II/III）

**Phase I: Genesis — 功能性基石**
- 目标：全链路延迟基准 + 持久化会话 Actor
- nano-agent 对照：B1-B7 已经跨过相当于 smind Phase I 的门槛（B1/B7 spike 给出了平台延迟基线；NanoSessionDO 已 ship）。**无借鉴项**。

**Phase II: Evolution — 精度与体验飞跃**（🔴 **最重要的借鉴目标**）
- 3.1 **Context Slotting & Dynamic Management** — 废弃"上下文块"概念，引入 `Context Slot` + 动态替换
- 3.2 **Multi-Channel Retrieval & Fused Reranking** — Writer 生成多个并行查询假设 → 汇聚 → Reranker 权威排序
- nano-agent 对照：我们 B4 的 `AsyncCompactOrchestrator` 只做"token 超了就压缩"，没有 slot 模型，没有 rerank。**这就是我们最主要的借鉴点**，详见 §4。

**Phase III: Singularity — 协作与智能重定义**
- 强一致协作空间（DO 作 WebSocket broadcast）
- Host-centric 意图追踪（多人对话中的主导权加权）
- 动态加权集体意图向量（监控整段对话的焦点偏移）
- Sidecar 架构解耦大规模场景
- nano-agent 对照：我们目前还没有协作式多用户场景（agent-loop 是单用户 + 多工具）。**不直接借鉴，但 "Host + 动态加权意图向量" 的数学模型可以启发未来 multi-agent 协作**——属于 post-worker-matrix 范畴。

---

### 3.2 `app/memo-DDL.txt` (6 780 字节) — 5-module SQLite DDL

这是 DO 内部 SQLite 的**生产级 schema**。item-by-item 审查：

| # | 表 | 用途 | 关键字段 | 对 nano-agent 的启发 |
|---|---|---|---|---|
| M1 | `conversations` | 会话主干；host/guest 区分 → 协作 | `host_user_uuid`, `guest_user_uuids (JSON)`, `round_id`, `token_count_total` | `round_id` 作为全局轮次计数器 + `token_count_total` 作为累计计费维度，nano-agent 目前没有同等概念，**可以借鉴到 session-do-runtime 的 checkpoint 中** |
| M2 | `chats` | 对话历史 + 心跳 | `ack_status ('pending'→'read')`, `msg_type ('text'/'image'/'mixed'/'ark')`, `round_index` | `ack_status` 的 5 态机 + **`msg_type: 'ark'` 方舟消息**（系统事件消息）概念很新颖——相当于把 "context is ready" 之类的系统事件也存到对话历史里，**这给我们 hook event 的用户可见性提供了参考** |
| M3 | `contexts` | L1/L2/L3 虚拟内存 | `context_active (JSON Array)`, `context_swap (JSON Array)`, `context_storage_meta (JSON Array)`, `active_intent`, `swapping_status ('idle'/'retrieving'/'swapping')` | **🔴 核心借鉴目标**。我们没有这张表。**建议在 B8 之后的阶段**（B9 或 worker matrix 首 phase）新增 `packages/context-management/src/slot-store/` 实现同款 3 列 JSON + 状态机 |
| M4 | `vec_history` | L3 冷藏 blob | `vector_blob (BLOB, Float32Array 字节流)`, `content_text`, `content_context_meta`, `round_index`, `token_count` | **🔴 核心借鉴目标**。向量 blob 存 BLOB 而非 JSON 字符串是**硬性经验**——smind 的 `plan-engine_do.ts.txt §5.2` 明确写了 "严禁 将向量存为 JSON 字符串"。这条经验应直接进入我们的 `DOStorageAdapter` 使用约定 |
| M5 | `vec_intents` | 预制意图路由（alarm 刷新） | `vector_blob`, `payload_json (slots 定义/指令)`, `score_threshold`, `realm` | 🟡 中等借鉴价值。类似"租户级冷启动预制包"——如果我们 worker matrix 阶段有多租户 / 多 realm 场景，这个模式很合适；当前 nano-agent 单用户下不急 |

#### 3.2.1 Float32Array ↔ BLOB 的工程细节

`producer.ts` 和 `db_do.ts` 里有配对的 helper：

```ts
// db_do.ts (推测签名)
static float32ToBlob(vec: number[] | Float32Array): Uint8Array
static blobToFloat32(blob: Uint8Array): Float32Array
```

这是一个简单但关键的优化：1024 维向量用 JSON 字符串存是 ~10-15 KiB；用 Float32Array Blob 存是 **4 KiB 固定**，而且**不需要 JSON.parse**。我们 B7 F08 测出 DO value cap ≈ 2.1 MiB——即使一个 session 热存 100 个向量也才 400 KiB，完全在安全线内。**这条直接进 B8 的 composition factory 注释**。

---

### 3.3 `app/memo-cicp.ts.txt` (7 535 字节) — CICP 协议 v1.2

#### 3.3.1 CICP 与 nano-agent NACP 的对比

| 维度 | CICP (smind) | NACP (nano-agent) |
|---|---|---|
| **范围** | DO 内部模块通信 + client↔gateway | 跨 Worker + WebSocket session + DO 通信（更大） |
| **载荷包装** | `CicpPacket { source, target, msg_type, msg_intent, input_payload?, data_payload?, authority_payload?, error? }` | `NacpEnvelopeBase { header, authority, trace, control, ref, body }` |
| **msg_type** | `COMMAND / REPORT / EVENT / ERROR`（4 种） | NACP 用 `message_type` 字符串列表（11 个 Core + 8 个 Session） |
| **msg_intent** | 20+ 种业务 intent（CLIENT_HANDSHAKE / PREPARE_CONTEXT / CONTEXT_READY / ...） | NACP 的 `message_type` 已经涵盖这类区分 |
| **鉴权位置** | `authority_payload` 内嵌于每个 packet | NACP `authority` 区块由 server 侧 stamp |
| **Zod SSOT** | ✅ | ✅ |

**借鉴结论**：
- CICP 和 NACP 是**两个抽象层级**，不替代不重叠——CICP 是 DO 内部的"分模块通信总线"（模块间打 packet），NACP 是 Worker ↔ Worker / Session 的"网络协议"。
- 我们**不需要**再造一份 CICP；但 smind 把 `CLIENT_HANDSHAKE` / `CLIENT_CONV_SWITCH` 作为 `msg_intent` 字符串常量统一管理的方式，可以**反过来启发**我们在 `session-do-runtime` 内部也建立一套 "内部编排 intent" 字符串常量表（目前 `SessionOrchestrator` 是隐式的）。

#### 3.3.2 `CICP Everywhere` (v1.2 新增)

v1.2 的新口径是：连前端 WebSocket 消息也要**强制包进 CICP 包**。这是为了：
- 追踪 `trace_uuid` 端到端
- 前端 SDK 和后端共享同一份 Zod schema

对照我们的现状——nano-agent 的前端协议就是 `nacp-session` 的 `session.stream.event` 系列，**本质上已经是 "NACP Everywhere"**。所以这一条**对我们不是 new learning，而是确认我们的方向正确**。

---

### 3.4 `app/memo_coldstart_prefill.txt` (6 446 字节) — Semantic Intent Routing

#### 3.4.1 核心机制

DO 在创建或 alarm 时，把"领域相关的核心意图向量集"**卸载到本地 SQLite**。当用户提问时：
1. Query → embedding → Q_Vec
2. **DO 内部 JS 计算** 与本地 100-500 个意图向量的 cosine
3. 命中 → 立即加载预制 slot 数据 → LLM 秒回
4. 不命中 → 走正常 RAG async path

#### 3.4.2 为什么这条很重要

这是一个**"把外部 IO 内化为边缘计算"**的经典模式：
- 传统 RAG: Query → 远端 Vector DB (TopK) → 远端 Rerank → 远端文档 → LLM
- Intent Routing: Query → **本地 cosine 扫 500 个意图** → 命中则 0-IO → LLM

因为 DO 是**粘性 Actor**（同一用户总路由到同一 DO 实例），本地缓存是天然的 per-session 热数据。

#### 3.4.3 对 nano-agent 的启发

我们的 agent-loop 并不是 chat-turn 模式，所以"用户意图路由到预制答案"不能直接借用。但**核心机制（"把外部 IO 内化为 DO 内 cosine 计算"）可以抽象为**：

> **DO 内本地向量搜索** 作为一条"低延迟路径"——任何时候 agent 需要回忆"这个会话过去是否见过类似的东西"，都可以直接在 DO 的 SQLite 里算 cosine，无须走远端 Vectorize。

这对我们**未来的 "session memory / semantic recall" 能力**非常有价值——属于 worker matrix 之后的能力，但 B8 handoff memo 可以点一下。

#### 3.4.4 Alarm-driven 刷新 intent 向量表

`plan-engine_do.ts §4D` + `memo_coldstart_prefill §3C` 描述的刷新策略：
- DO 的 `alarm()` 方法定时（每小时）拉取最新的意图向量集 off-load 到本地
- 使用 `filter_meta: { realm, channel, type: "intent_marker" }` 筛选

**nano-agent 对照**：我们的 `NanoSessionDO.alarm()` 目前只做 heartbeat / health check，**没有用于"刷新外部派生状态"**。这是一个可考虑的扩展方向——属于 post-worker-matrix。

---

### 3.5 `app/plan-chat.ts.txt` (5 563 字节) — Gateway

#### 3.5.1 核心模式：User-Level DO 路由

```ts
const id = env.DO.idFromName(verified_user_uuid);  // 用户UUID → DO ID
const stub = env.DO.get(id);
await stub.fetch(cicp_packet);
```

同一个用户的所有请求**始终落到同一个 DO**。这是多租户隔离的基石。

#### 3.5.2 对 nano-agent 的对比

我们的 `NanoSessionDO` 用 `idFromName(sessionId)` 做路由，**每个会话一个 DO**（粒度比 smind 更细——smind 是 per-user，我们是 per-session）。两种都合理，差异在于：
- smind: 同一用户跨多个对话共享 intent_space / conversation 列表 → 适合 chat 场景
- nano-agent: 每个会话独立 → 适合 agent-loop 单次任务场景

**结论**：两种粒度都正确，**不需互相替代**。但 smind 的 `idFromName(user_uuid)` + `conversations` 表的"多对话管理"模式，可以启发**当我们未来做 "multi-session agent memory" 时**应该选 per-user 粒度，而不是重新造。

#### 3.5.3 借鉴价值

**低**。这一层我们已经通过 B1-B7 的 binding/worker 实测验证过（binding-F02 x-nacp-* 头部小写法则 + binding-F01 abort 传播 + binding-F04 true push path），不需要再学 smind 的 gateway 设计。

---

### 3.6 `app/plan-engine_do.ts.txt` (5 628 字节) — EngineDO Actor

#### 3.6.1 四大功能模组

| 模组 | smind 的实现 | nano-agent 对照 |
|---|---|---|
| A. Memory Vault | `private sql: DB_DO` 封装 SQLite RW | 我们 B2 的 `DOStorageAdapter` + B7 验证过的 sqlite put/get/delete 路径已对齐 |
| B. State Container | `active_conversation_uuid` + `intent_space` + `clients: Set<WebSocket>` | 我们 NanoSessionDO 有 `actorState` + `sessionUuid`，**没有等价的 `intent_space`**（因为 agent-loop 不是 chat-turn） |
| C. Logic Dispatcher | 根据 `msg_intent` switch-case 分发 | 我们有 `dispatchAdmissibleFrame(messageType, body)` 做类似事 |
| D. Async Scheduler | `alarm()` 做 intent 刷新 + context swap | 我们 `alarm()` 只做 heartbeat（见 §3.4.4） |

#### 3.6.2 工程注意事项 (§5)

smind `plan-engine_do §5` 列的 6 条注意事项，与我们 B2-B7 交付的教训高度吻合：

| smind §5 | 我们的等价/教训 |
|---|---|
| 1. SQLite 连接单例化 | ✅ 我们 DOStorageAdapter 也是 singleton |
| 2. 向量存 BLOB 不存 JSON | ⚠️ **我们没有 formal guideline**——B8 应该写进 composition factory 注释 |
| 3. 并发控制（同一 DO 的逻辑锁） | ✅ 我们 B5-B7 的 "turn_running" 门已对齐 |
| 4. 错误边界（dispatch 外层 try-catch） | ✅ 我们的 webSocketMessage 已有 |
| 5. CORS 处理 | N/A（后端到后端） |
| 6. Phase I 裁剪（忽略 ack / seq / TopN 简化） | 对应我们的 MVP 分 phase 思路 |

**核心借鉴**：第 2 条 **"向量存 BLOB 不存 JSON"** 应正式进入我们的 storage-topology 使用约定。

---

### 3.7 `contexter-v1.1.png` — 蓝图 v1.1（对照图）

v1.1 是 v1.2 的**前一版**，差异不大。主要用来看**演进迹象**：

| 区域 | v1.1 | v1.2 | 演进含义 |
|---|---|---|---|
| Client APP | 存在但不强调协议 | **明确纳入 CICP 协议范围** | v1.2 把客户端拉进 protocol SSOT |
| Token 经济学面板 | 有但较小 | **放大到右侧主面板** | Token 预算可视化升级为一等公民 |
| Context 管理机关 | 注释较简 | **Writer/Producer/Context 三职分立注释完整** | 责任边界更清晰 |
| DO 状态区 | 5 张表 | **5 张表（无变化）** | 数据模型稳定 |

**结论**：v1.1 → v1.2 没有底层 breaking change，主要是**可视化和协议边界的精修**。

---

### 3.8 代码实现交叉验证（已在前一轮回应中完成）

- `context/producer.ts` v1.2 (L3 已实装) — 100% 实现了蓝图中的 L1/L2/L3 + activate + rebalance
- `context/writer.ts` v1.4 (Warm Path Vector Hydration) — 实现 Hot/Warm/Async 三路采购 + 双源并行 fetch
- `ai/topN.ts` v1.0 — BGE reranker + Zod 校验 + fail-open 降级
- `core/db_do.ts` — 5 张表 DDL + Float32↔BLOB helper
- `context/director.ts` v1.1 — CICP 中心路由 + 编排 Intent→Writer→Producer→Gen

**核心事实**：**`design.txt` Phase II 的 3.1 / 3.2 两大目标已经实装到代码里**（不是 draft）。

---

## 4. 可吸收到 nano-agent 的内容（按优先级）

### 4.1 P0 — 立即可吸收，进 B8 文档（零代码）

#### 4.1.1 L1/L2/L3 槽位模型作为 `context.core` worker 的内部结构起点

**落地位置**：B8 handoff memo `§10 Recommended First Phase of Worker Matrix` + `docs/templates/composition-factory.ts` 注释

**内容**：
> "参考 `context/smind-contexter/context/producer.ts` 的三级 Slot 模型（L1 Active 8 slots / L2 Swap 3 slots / L3 Storage 80 slots），作为 worker matrix 阶段 `context.core` worker 的内部结构起点。smind 已量产的 pipeline 是：ingest Writer 候选 → activateStorage（cosine 激活 L3）→ rebalance（rerank L1+L2）→ produceAssembly（按 score 降序 + token 预算截断）。
>
> **本 phase 适配**：worker matrix 首 phase 的 `context.core` 只实装**前三步 + 最后一步**（ingest / activate / produceAssembly），**rebalance 的 rerank 能力由独立的 `context.reranker` worker 通过 hook + service binding 提供**（见 §4.4）。如果 `context.reranker` 未部署或超时，`context.core` 自动 fail-open 到 "按 ingest 顺序 + score 装配" 的默认排序，保证主路径不被阻塞。"

#### 4.1.2 向量存 BLOB 不存 JSON（硬指导）

**落地位置**：B8 `composition-factory.ts` 模板注释 + `storage-topology` 使用约定

**内容**：
```ts
// 硬指导（参照 smind-contexter plan-engine_do §5.2）：
// 向量数据必须用 Float32Array → Uint8Array BLOB 存 SQLite，
// 严禁 JSON.stringify(Array)。1024 维向量：BLOB 4 KiB vs JSON 10-15 KiB。
// 在 DO 2.1 MiB cap (B7 F08) 下，BLOB 允许每会话 ~500 个向量，JSON 只允许 ~100。
```

#### 4.1.3 Split persistence 原则（小热状态 JSON / 大冷数据分表 blob）

**落地位置**：B8 handoff memo `§6 Binding Catalog Evolution Policy` + `§8 Templates`

**内容**：
> "热状态（L1/L2 / actor state / checkpoint header）以小 JSON 存在一张 `contexts` 风格的表里；冷数据（历史向量 / 归档 trace / 大 blob）存独立表 + ID 列表引用。这是 smind 在 DO 2.1 MiB cap（我们 B7 F08 实测）下得出的工程约束。"

#### 4.1.4 log_code 枚举体系

**落地位置**：B9 或 worker matrix 阶段的 hooks audit 增强

**内容**：建议 `@nano-agent/hooks` 增加一套"阶段代码"（类似 smind 的 `HOT_HIT`/`WARM_SKIP`/`REBALANCE_DONE`/`TOPN_SUCCESS`/`L3_ACTIVATED`）作为**观测性的离散词汇表**，方便 dashboard 聚合。**不进 B8**（B8 不改 packages）。

---

### 4.2 P1 — worker matrix 阶段吸收（代码实装，进 `context.core` 内部）

> **架构不变量（owner decision 2026-04-20）**：以下三条**都在 `context.core` 内部**完成，不跨 Worker。rerank 能力不在此清单——详见 §4.4。

#### 4.2.1 L1/L2/L3 Slot 数据结构 + ingest / produceAssembly

**落地位置**：新增 `packages/context-management/src/slot-store/`（参照 `producer.ts` Section 2-3）

**核心 API**：
```ts
export interface ContextSlot {
  slotId: string;
  contextUuid: string;
  contentFull: string;
  score: number;
  source: 'hot' | 'warm' | 'async' | 'reranked';
  meta: Record<string, unknown>;
}

export class SlotStore {
  ingest(args: { hot?: SlotInput[]; warm?: SlotInput[]; async?: SlotInput[] }): void;
  getActive(): ContextSlot[];            // L1 snapshot
  getSwap(): ContextSlot[];              // L2 snapshot
  getStorageIds(): string[];              // L3 ID list
  produceAssembly(budget: TokenBudget): AssemblyResult;  // 按 score 降序 + token 截断
  applyExternalRerank(ranked: { contextUuid: string; score: number }[]): void;  // §4.4 写回点
  persistState(adapter: StorageAdapter): Promise<void>;
  restoreState(adapter: StorageAdapter): Promise<void>;
}
```

**`applyExternalRerank` 是关键插槽**：`context.reranker` worker 完成 rerank 后，通过 hook 回调把新分数写进来；`SlotStore` 据此重排 L1/L2。如果从未被调用，`produceAssembly` 用 ingest 时的初始 score 做 fallback。

#### 4.2.2 Cosine 激活（L3 → L2）

**落地位置**：`packages/context-management/src/slot-store/activate.ts`（参照 `producer.ts::activateStorage`）

**为什么这步留在 `context.core` 内部**：cosine 计算**没有 AI 推理调用**，只是本地向量点积——100-500 个向量在 DO 内部计算 <5ms。拆到独立 worker 反而增加 binding RTT。

**伪代码**：
```ts
async activate(queryVec: Float32Array, l3Ids: string[]): Promise<SlotEntry[]> {
  const candidates = await this.storage.getBatchByIds(l3Ids);
  const activated: SlotEntry[] = [];
  for (const cand of candidates) {
    const candVec = blobToFloat32(cand.vectorBlob);
    if (cosineSimilarity(queryVec, candVec) > ACTIVATION_THRESHOLD) {
      activated.push(this.toSlot(cand, 'warm'));
    }
  }
  return activated;
}
```

**阈值选择**：smind v1.2 升到 0.78（原 0.75）——我们 start with 0.78，后续校准。

#### 4.2.3 `ContextRebalance` 生命周期事件

**落地位置**：`packages/context-management/src/async-compact/` 扩展新增 lifecycle 名

**提议的新 5 个事件名**（与 B4 现有 5 个 `COMPACT_LIFECYCLE_EVENT_NAMES` 互补）：
```
ContextRebalanceArmed            ← 每轮（非 pressure-driven）
ContextSlotActivated             ← L3 → L2 cosine 激活完成
ContextRerankRequested           ← 向 context.reranker 发 hook（见 §4.4）
ContextRerankCompleted           ← 收到 reranker 回调（或超时降级）
ContextRebalanceCommitted        ← 新 L1/L2 落盘
```

**职责划分**：
- `ContextPressure` / `ContextCompact*`（现有 5 个）：管**"池子满了怎么办"**
- `ContextRebalance*`（新增 5 个）：管**"每轮如何重新分配 prompt 空间"**

**与 §4.4 `context.reranker` 的连接**：
- `ContextRerankRequested` 是 B5 Class D hook（cross-worker），payload 里带 `candidates[]` + `query` + NACP header `reply_to`
- `context.reranker` worker 订阅此事件 → 推理 → 通过 `reply_to` 回写 `ContextRerankCompleted`
- 如果 reranker 未订阅 / 超时 / 报错：`context.core` fail-open 到 "按初始 score 装配"

---

### 4.3 P2 — 更远期借鉴（post-worker-matrix）

| # | 借鉴点 | 落地阶段 | 价值 |
|---|---|---|---|
| 1 | **Intent 预制向量表**（vec_intents + alarm 刷新） | 多租户场景出现后 | 0-IO 冷启动路径 |
| 2 | **Warm-path 租户预制包**（smind_context_presets） | SaaS 多租户化 | 每租户注入背景知识 |
| 3 | **msg_type: 'ark' 方舟系统消息** | UX 阶段 | 系统事件可在对话历史里被"看见" |
| 4 | **alarm()-driven 外部状态刷新** | 任何需要 "定期派生缓存" 的场景 | DO 粘性 + 定时刷新 |
| 5 | **Host-centric 意图加权** / **动态加权集体意图向量** | multi-agent 协作 | 多智能体协作决策 |
| 6 | **Sidecar Pattern** for 大规模分析任务 | 500+ 并发会话 | 主路径延迟保护 |

---

### 4.4 `context.reranker` — 独立 worker，post-worker-matrix 立项 🔴 专节

> **owner decision (2026-04-20)**：rerank 能力是**重要但非首发**的功能。它**不进 worker matrix first-wave**，也**不作为 `context.core` 的内部组件**。它是一个**独立的 `context.reranker` worker**，通过 hook + service binding 与 `context.core` 解耦通信。

#### 4.4.1 为什么要这样拆

| 维度 | 如果合并在 `context.core` | 如果独立 `context.reranker` worker |
|---|---|---|
| **延迟 profile 隔离** | ❌ context.core 的 p99 会被 rerank 50-200ms 拉高；每个 agent-loop 步骤都走 context.core，累积影响巨大 | ✅ context.core 稳定在 10ms 量级；rerank 延迟只在 "rebalance step" 有感 |
| **Fail-open 边界** | ❌ 代码级 try/catch；reranker 报错可能污染 context.core 的 state | ✅ 进程级隔离；reranker worker 挂了 / 不存在 / 超时，`context.core` 直接 skip，**零额外代码** |
| **Multi-provider rerank** | ❌ llm-wrapper 改造必须先于 context.core 首版 | ✅ 首版 `context.reranker` 可以先写死一个 provider；后期替换不影响 `context.core` |
| **Per-tenant 差异化** | ❌ 同一份 code 要做租户分叉 | ✅ 不同租户可绑不同 reranker worker（BGE / Cohere / 自研 / 关闭） |
| **资源扩缩** | ❌ context.core 被迫按 rerank 峰值规划 | ✅ 两个 worker 独立 scaling |
| **service binding 成本** | N/A | 仅 ~7ms p99（B7 binding-F01 LIVE 实测），远小于 rerank 本身的 50-200ms |
| **worker matrix 首 phase scope** | ❌ 必须包含 rerank → scope 膨胀 | ✅ rerank 不在首 phase → scope 可控 |

#### 4.4.2 hook + service binding 调用架构

**整体调用链**：

```
┌─────────────────────────────────────────────────────────────────────┐
│                       agent-loop turn                                │
│                                                                      │
│   [ context.core worker ]                                            │
│                                                                      │
│   1. ingest Writer 候选 → L1/L2/L3                                   │
│   2. activateStorage (L3 cosine) → L2 （本地 DO 内计算，<5ms）        │
│   3. emit hook `ContextRerankRequested`                              │
│        ↓ (Class D: cross-worker hook)                                │
│   ┌──────────────────────────────────────────────────────────┐       │
│   │  [ hook dispatcher ]                                     │       │
│   │  - 订阅者检查：有 context.reranker 订阅吗？              │       │
│   │  - 无订阅 → skip（fail-open，走 default 排序）           │       │
│   │  - 有订阅 → 走 service binding 到 reranker worker        │       │
│   └──────────────────────────────────────────────────────────┘       │
│                                                                      │
│                                          [ context.reranker worker ] │
│                                                                      │
│                                          - 收到 hook payload:        │
│                                            { candidates[], query,    │
│                                              header.reply_to }       │
│                                          - 调 BGE / 其他 AI 推理     │
│                                          - 通过 reply_to 回调        │
│                                          - 返回 ranked uuids + score │
│                                                                      │
│   4. 收到回调 → SlotStore.applyExternalRerank(ranked)                │
│      超时（~100ms）→ fail-open，走默认排序                            │
│   5. produceAssembly → LLM prompt                                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

#### 4.4.3 关键协议点（落地到 NACP + hook catalog）

| # | 设计点 | 实装方式 |
|---|---|---|
| **1** | `ContextRerankRequested` hook 加入 catalog | B5 `packages/hooks/src/catalog.ts` 扩张至 19/20 events（Class D） |
| **2** | Hook payload schema | `{ query: string; candidates: Array<{contextUuid, contentFull, meta}>; topN?: number; scoreThreshold?: number }`，受 Zod 校验 |
| **3** | 请求 / 响应关联 | 利用 B6 已 ship 的 NACP `header.reply_to` 字段 + `message_uuid` dedup |
| **4** | 响应事件 | `ContextRerankCompleted` hook，payload `{ requestMessageUuid: string; ranked: Array<{contextUuid, score}> }` |
| **5** | Fast-timeout | context.core 侧 100ms 超时（reranker 本身预算 50-200ms，给 50ms buffer 网络/排队）；超时 = fail-open |
| **6** | Observability | `BoundedEvalSink` 自动捕获两事件（B7 binding-F04 LIVE 验证过 cross-worker dedup/disclosure 已成立） |
| **7** | 无订阅者时的行为 | hook dispatcher 返回 `{dispatched: 0}` → context.core 立即 fail-open（不等超时） |
| **8** | reranker worker 形态 | stateless worker（不需要 DO）；per-request；无 session 粘性 |

#### 4.4.4 落地阶段规划（post-worker-matrix）

| Phase | 工作量 | 内容 |
|---|---|---|
| **Pre-req** | — | worker matrix 首 phase 完成；4 first-wave workers (`agent/bash/filesystem/context`) LIVE |
| **Pre-req** | — | `llm-wrapper` 完成 multi-provider 抽象（或至少支持 Workers AI binding） |
| **Rerank-1** Catalog & schema | S | 扩 `packages/hooks/src/catalog.ts` 添加 `ContextRerankRequested` / `ContextRerankCompleted`（Class D） + payload Zod schema |
| **Rerank-2** `context.core` 侧集成 | M | `SlotStore.applyExternalRerank` + fast-timeout fail-open + lifecycle event 连接 |
| **Rerank-3** `context.reranker` worker | M | 新建 worker（参照 smind `ai/topN.ts`）：硬截断 1024 字符 / Zod 响应校验 / top_score 观测 / 多 provider switch |
| **Rerank-4** deploy + binding | S | wrangler.jsonc 加 `CONTEXT_RERANKER` service binding 声明 |
| **Rerank-5** LIVE 验证 | M | 跑 spike 测 p50/p99 延迟；加 root contract test 锁 fail-open 语义 |

**总估算**：3-5 周工作量（取决于 llm-wrapper multi-provider 完成时点）。

#### 4.4.5 对 `context.core` 的 API 稳定性承诺

`context.core` 的对外 API **不依赖** `context.reranker` 是否存在：
- 部署时无 reranker worker → `SlotStore.produceAssembly` 返回按 ingest score 排序的结果
- 部署时有 reranker worker → `applyExternalRerank` 被调用后 `produceAssembly` 返回按 rerank score 排序的结果
- 两种情况下**返回结构完全一致**，只是排序不同

这保证了 `context.reranker` 的**可选性**——任何时候可以独立部署 / 下线 / 替换实现，不破坏 `context.core` 的客户。

---

## 5. 明确**不建议**直接照搬的部分

| smind 设计 | 不适合 nano-agent 的原因 |
|---|---|
| Intent → Writer → Producer → Gen 线性 pipeline | 我们是 agent-loop（工具调用循环），不是单轮 chat。意图识别节点在我们这里由 LLM planner + hook 承担 |
| BGE reranker 锁死 Cloudflare Workers AI binding | `context.reranker` worker 首版可以先用任意一个 provider，但 API 必须设计成 multi-provider 可切换（详见 §4.4 post-worker-matrix 立项） |
| **Rerank 作为 `context.core` 内部组件** | owner 2026-04-20 明确决定：rerank **必须**是独立 `context.reranker` worker，通过 hook + service binding 唤醒；理由见 §4.4.1 六维度对比表 |
| Hot path 只在 coldStart 触发 | 我们 agent 初始化没有等价 "cold start detection"；可用 `Setup` hook 替代，但语义不完全对齐 |
| CICP packet `source/target` 字符串 routing | 我们已有 NACP envelope，两层 protocol 没必要并存；CICP 的思想可以用来组织 DO 内部模块通信**约定**，但不必二次开发 |
| 前端 WS 消息强制 CICP 包 | 我们的前端协议已经是 `nacp-session`，功能等价（不是 new learning） |
| `idFromName(user_uuid)` user-level DO 路由 | 我们 per-session 粒度更细，两者都正确；不强行切换 |
| Phase III "集体意图加权向量" | agent-loop 单用户场景下不适用；需等 multi-agent 协作场景出现 |

---

## 6. 与 nano-agent 当前阶段的整合建议

### 6.1 进 B8（不改代码）

以下内容直接写进 **B8 Phase 2 handoff memo**：

**handoff memo §10 新增段落：**
> **"下一 phase 的 context.core worker 内部结构参考"**：
> 建议参考 `context/smind-contexter/context/{producer.ts, writer.ts}` 的三级槽位模型（L1 Active 8 / L2 Swap 3 / L3 Storage 80）作为 worker matrix 阶段 `context.core` worker 的内部结构起点。smind 的 pipeline 是 ingest → activateStorage (cosine) → rebalance (rerank) → produceAssembly。**本 phase 只实装前三步 + 第四步的 default 排序**；rebalance 中的 rerank 由独立的 `context.reranker` worker 通过 hook + service binding 提供（后续 phase 立项）。如果 `context.reranker` 未部署，`context.core` 自动 fail-open。
>
> **明确不在 worker matrix 首 phase 范围内的 smind 借鉴点**：
> - `ai/topN.ts` 的 BGE reranker 量产代码 —— 参考价值高，但作为 `context.reranker` 独立 worker 的蓝本，不在首 phase。
> - `llm-wrapper` 的 multi-provider 改造 —— reranker 的 AI 推理 provider 抽象必须先于 `context.reranker` 立项，但不是 worker matrix 首 phase 的 blocker。

**composition-factory.ts 注释段落：**
> ```ts
> // 向量存储约定（参照 smind-contexter plan-engine_do §5.2 + nano-agent B7 F08 evidence）：
> // - 向量必须以 Float32Array → Uint8Array BLOB 存入 SQLite，不可 JSON 序列化数组
> // - 热状态（checkpoint / actor state / L1+L2 slots）以小 JSON 存在一张表
> // - 冷数据（vec_history / 归档 trace）存独立表 + ID 列表引用
> // - 单条记录上限 2 MiB（见 B7 F08 实测 DO cap 2,199,424 bytes）
> ```

### 6.2 进 B9 / worker matrix 首 phase（代码实装）

**`context.core` 内部**新增包 / 新增子模块清单（**不含 rerank**）：
1. `packages/context-management/src/slot-store/` — L1/L2/L3 slot 管理（参照 producer.ts §2-§3）
2. `packages/context-management/src/slot-store/activate.ts` — cosine 激活（本地计算，不调 AI）
3. `packages/context-management/src/async-compact/` 新增 5 个 `ContextRebalance*` 生命周期事件名
4. `packages/storage-topology/` 新增 `BlobVectorCodec` helper（Float32 ↔ Uint8Array）
5. `packages/hooks/src/catalog.ts` 新增 `ContextRerankRequested` / `ContextRerankCompleted` **hook 事件定义**（Class D），**但不立项 reranker worker 本身** —— 让 `context.core` 具备"当有 reranker 时会用它"的能力，reranker worker 的实装推迟

### 6.3 post-worker-matrix 独立 phase（`context.reranker` worker）

**在 worker matrix 首 phase closed 之后立项**（需先 llm-wrapper multi-provider 改造完成）：
1. 新 worker：`nano-agent-context-reranker` (stateless worker，不需要 DO)
2. 新包（或子模块）：`packages/context-reranker/`（参照 smind `ai/topN.ts` 实装风格）
3. wrangler.jsonc 新增 `CONTEXT_RERANKER` service binding
4. `context.core` 侧加入 fast-timeout (100ms) fail-open 逻辑
5. spike 验证 LIVE p50/p99 + 跨 worker hook dispatch 路径
6. root contract test 锁 fail-open 语义（未订阅 / 超时 / 错误三种情况下 `context.core` 都返回合法结果）

### 6.4 Q 给业主（进 B8 §6.1）

> **Q5 — owner decision 已 close**：reranker 不进 worker matrix first-wave，作为独立 `context.reranker` worker 在 post-worker-matrix 阶段立项，通过 hook + service binding 与 `context.core` 解耦。
> - A：**已确定** (2026-04-20 owner)。
> - 落地影响：B8 handoff memo §10 只建议 `context.core` 的内部结构，不提前冻结 rerank worker 命名或 binding slot；`context.reranker` 作为 "reserved-binding (likely)" 在 handoff memo §6 binding catalog evolution policy 中提及即可（类似 `skill.core` 的 reserve 模式）。
>
> **Q6（新增）— `ContextRerankRequested` hook 事件在 worker matrix 首 phase 是否已加入 catalog？**
> - 影响范围：worker matrix 首 phase `context.core` 实装是否能在未来某个时点"无代码变更接入 reranker"
> - 为什么必须确认：如果首 phase 不加该 hook event，reranker 上线时要回改 `context.core` + `hooks` 两个包；如果首 phase 就加入（event 定义 only，无订阅者），则 reranker 只是订阅一个已存在的 event
> - 当前建议：**首 phase 就加入 hook event 定义**（`ContextRerankRequested` + `ContextRerankCompleted`），即便暂无订阅者也能被 dispatcher 安全跳过；这让 reranker 未来上线是"纯加法"
> - A：待业主确认
>
> **Q7（新增）— reranker worker 的 AI provider 抽象是否纳入 worker matrix 首 phase？**
> - 影响范围：`llm-wrapper` 的 multi-provider 改造时点
> - 为什么必须确认：reranker 所需的 provider 抽象（不锁 Cloudflare AI binding / 可换 BGE / Cohere / 自研）**不一定** 必须在 worker matrix 首 phase 完成；可以推迟到 reranker 立项前夕
> - 当前建议：**推迟**。worker matrix 首 phase 不改 `llm-wrapper`；在 reranker 立项前再做 provider 抽象
> - A：待业主确认

---

## 7. 一句话总结

**smind-contexter 是一个我们可以直接学习的"未来自己"**——它证明了 "三级槽位 + 每轮 rerank + cosine 激活 + fail-open" 这套组合在 Cloudflare Workers 上**真能量产跑起来**。但 nano-agent **不照搬 smind 的 monolithic worker 模式**：我们把 rerank 从 `context.core` 中分离出去，变成独立的 `context.reranker` worker，通过 hook + NACP `reply_to` 解耦，后续 phase 立项。

本文档（`smind-contexter-learnings.md`）的核心产出：
- **3 条 P0 立即可吸收**（向量 BLOB 约定 / split persistence / log_code 思路）
- **3 条 P1 worker-matrix 首 phase 吸收**（`context.core` 内部 Slot / cosine 激活 / Rebalance 生命周期事件）
- **1 节 §4.4 专论 `context.reranker` 独立 worker**（post-worker-matrix 立项；hook + service binding 唤醒）
- **6 条 P2 远期参考**
- **7 条不应直接照搬的边界**

**核心架构决策**（owner 2026-04-20）：
- ✅ `context.core` 在 worker matrix 首 phase 实装 Slot 管理 + cosine 激活 + rebalance lifecycle **事件定义**
- ✅ Rerank **不是**首 phase scope；独立 `context.reranker` worker 在 post-worker-matrix 立项
- ✅ 唤醒路径：`ContextRerankRequested` hook (Class D) → service binding → reranker worker → `reply_to` 回调 → `ContextRerankCompleted` → `SlotStore.applyExternalRerank()`
- ✅ `context.core` 对 reranker **不做硬依赖**：无订阅 / 超时 / 报错都 fail-open 到默认 score 排序

**对 B8 的直接动作**：在 Phase 2 handoff memo §10 引用本文档；Phase 3 composition-factory.ts 注释写 BLOB vector 约定 + split persistence；handoff memo §6 binding catalog evolution policy 把 `CONTEXT_RERANKER` 标为 "future reserved binding (post-worker-matrix)"；Q5 已 close，Q6/Q7 待业主确认。**不改** B8 action-plan 骨架（handoff phase 不碰代码）。

---

## 8. 附录：smind 已实装的工程资产清单（按 nano-agent 消费时机分组）

### 8.1 进 `context.core` worker matrix 首 phase

| 功能 | smind 源码位置 | LoC | nano-agent 消费方式 |
|---|---|---|---|
| 三级槽位 L1/L2/L3 | `context/producer.ts` Section 2-4 | ~250 | `packages/context-management/src/slot-store/` 新模块 |
| Cosine 激活 | `context/producer.ts::activateStorage` | ~40 | `slot-store/activate.ts`（本地计算，不调 AI） |
| produceAssembly 的 token 预算截断 | `context/producer.ts::produceAssembly` | ~30 | `slot-store/assembly.ts` |
| Float32↔BLOB codec | `core/db_do.ts` | ~20 | `packages/storage-topology/src/codecs/blob-vector.ts` |
| 5-table split persistence 原则 | `core/db_do.ts` + `app/memo-DDL.txt` | N/A（原则） | `DOStorageAdapter` 使用约定 |

### 8.2 进 `context.reranker` 独立 worker（post-worker-matrix）

| 功能 | smind 源码位置 | LoC | nano-agent 消费方式 |
|---|---|---|---|
| BGE Reranker 调用 + Zod 校验 | `ai/topN.ts` | ~275 | 整体作为新 worker `nano-agent-context-reranker` 的蓝本 |
| 硬截断 1024 字符保护模型 | `ai/topN.ts:125-134` | ~10 | 同上移植 |
| Fail-open Top-N 降级 | `ai/topN.ts:203-219` | ~20 | 在新 worker 内部实装；**另外** `context.core` 侧也有外部 fail-open（超时/无订阅） |

### 8.3 hooks catalog 扩展（worker matrix 首 phase 定义事件，post-matrix 立 producer）

| 功能 | 定义时机 | 落地位置 |
|---|---|---|
| `ContextRerankRequested` (Class D) | worker matrix 首 phase（事件定义 only） | `packages/hooks/src/catalog.ts` |
| `ContextRerankCompleted` (Class D) | 同上 | 同上 |
| hook payload schema | 同上 | `packages/hooks/src/schemas/context-rerank.ts`（新增） |
| Reranker 作为 hook producer | post-worker-matrix | `context.reranker` worker 内部 |
| `SlotStore.applyExternalRerank` 作为 hook consumer | worker matrix 首 phase | `packages/context-management/src/slot-store/` |

### 8.4 post-worker-matrix P2 远期（不立即规划）

| 功能 | smind 源码位置 | LoC | 消费时机 |
|---|---|---|---|
| Hot/Warm/Async 三路采购 | `context/writer.ts` | ~415 | multi-source retrieval 场景出现后 |
| CICP Zod schema 内部模块总线 | `core/schemas_cicp.ts` + `app/memo-cicp.ts.txt` | ~140 | 作为"内部模块编排"参考，不重造（我们有 NACP） |
| Director 编排 | `context/director.ts` | ~400 | 参考 agent.core 内部编排模式 |
| Intent 预制向量表 + alarm 刷新 | `core/alarm.ts` + `memo_coldstart_prefill.txt` | 未详查 | 多租户场景出现后 |

### 8.5 消费时机总览

| 阶段 | smind 借鉴总量 |
|---|---|
| **B8 handoff（本阶段）** | 只引用文档，不消费代码 |
| **worker matrix 首 phase (`context.core`)** | ~340 行（slot-store + activate + BLOB codec + 5-table 约定） |
| **worker matrix 首 phase (hooks catalog)** | ~20 行（新增 2 个 Class D event + schema） |
| **post-worker-matrix (`context.reranker` worker)** | ~300 行（topN.ts 整体移植 + multi-provider 抽象） |
| **远期可选** | ~1 000 行（Writer 多路采购 / Director 编排 / Intent 预制） |

**总结**：smind 可参考的代码量约 **1 600-2 000 行 TypeScript**，分两轮消化——worker matrix 首 phase 吸收 **~360 行**（纯 `context.core` 内部 + hook 事件定义），post-worker-matrix 吸收 **~300 行**（独立 reranker worker）。这两轮都是**"组装已验证组件"** 而不是"边写边验证"，大幅降低 worker matrix 首 phase 的 scope 风险。
