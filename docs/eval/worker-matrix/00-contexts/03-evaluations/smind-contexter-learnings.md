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

---

## 9. 辩证分析：CICP `msg_type × msg_intent` 双轴 vs NACP 现有 message_type 设计

> **讨论起点（owner 提出 2026-04-20）**：CICP 的 `msg_type + msg_intent` 看起来可拓展空间更大；我们 NACP 似乎是在"一个平面上的 message 类型"，没有"type 路由"的概念。
>
> **本节目标**：辩证地拆解这两种协议设计的真实差异，核对 NACP 代码事实（而不是凭印象），给出可吸收回 NACP 的具体 proposal 与**时机约束**。

---

### 9.1 核对 NACP 当前设计的代码事实（不能凭印象）

读 `packages/nacp-core/src/envelope.ts` 的真实结构（v1.1.0 shipped）：

```ts
// envelope.ts:49-54
export const NacpDeliveryKindSchema = z.enum([
  "command",
  "response",
  "event",
  "error",
]);

// envelope.ts:84-94 (NacpHeaderSchema)
{
  schema_version: NacpSemverSchema,
  message_uuid: z.string().uuid(),
  message_type: z.string().min(1).max(128),   // ← 自由字符串 + 运行时 registry 校验
  delivery_kind: NacpDeliveryKindSchema,      // ← enum: command / response / event / error
  sent_at: ...,
  producer_role: NacpProducerRoleSchema,      // ← 8 种 role 枚举
  producer_key: NacpProducerKeySchema,
  consumer_key: NacpProducerKeySchema.optional(),
  priority: NacpPrioritySchema,
}

// envelope.ts:167 (Control segment)
reply_to_message_uuid: z.string().uuid().optional(),

// envelope.ts:176 (Control segment)
audience: NacpAudienceSchema,  // enum: internal / audit-only / client-visible
```

**关键事实 🔴**：**NACP 已经有 `delivery_kind` 枚举，值是 `command / response / event / error`**，这和 CICP 的 `msg_type`（`COMMAND / REPORT / EVENT / ERROR`）**几乎一一对应**。换言之，**我们协议里已经存在一条和 CICP msg_type 等价的轴**——只是我们在日常讨论中把它忽略了。

NACP 实际上至少有 **5 条正交轴**：

| 轴 | 位置 | 基数 | 对应 CICP 概念 |
|---|---|---|---|
| `message_type` | header | 19+ (字符串 registry) | ≈ `msg_intent`（业务动词） |
| `delivery_kind` | header | 4 (enum) | **= `msg_type`**（交互模式） |
| `producer_role` | header | 8 (enum) | CICP 的 `source` 模块名 |
| `audience` | control | 3 (enum) | CICP 无等价（nano-agent 特有） |
| `reply_to_message_uuid` | control | uuid | CICP 用 `trace_uuid` + intent 配对隐式承载 |

所以 **"NACP 是单平面" 的判断是不准确的**——真实问题是**这些轴彼此不正交，存在信息冗余**。

---

### 9.2 NACP 当前设计的真实痛点：信息冗余而非维度不足

看 `message_type` 字符串的实际形态（摘自 `nacp-core/src/messages.ts` 与 `nacp-session/src/messages.ts`）：

```
tool.call.request       ← "verb=tool.call" + 方向="request"
tool.call.response      ← "verb=tool.call" + 方向="response"
tool.call.result        ← "verb=tool.call" + 方向="result"  (interim/final progress)
hook.broadcast          ← "verb=hook" + 方向="broadcast"
hook.return             ← "verb=hook" + 方向="return"
context.compact.request ← "verb=context.compact" + 方向="request"
context.compact.response
session.stream.event    ← 复合：profile=session + verb=stream.event
session.stream.ack
session.heartbeat
...
```

**痛点诊断**：

1. **方向信息双重编码** 🔴
   - `tool.call.request` 后缀 `.request` 已经说明方向
   - 同一 envelope 里 `delivery_kind: "command"` 又说一遍
   - 如果两者不一致（比如 `tool.call.request` + `delivery_kind: event`），**校验器会不会报错？** 实际上现在 `validateEnvelope()` 里没有交叉检查——这是潜在 bug

2. **业务动词分布不均**
   - `tool.call` / `hook` / `context.compact` — 动词格式各异，`tool.call` 是 `.` 分层，`hook` 是平名，`context.compact` 又是 `.` 分层
   - 方向名约定也不统一：有 `.request/.response`，也有 `.broadcast/.return`，还有 `.event/.ack`

3. **Error 作为一等公民缺位**
   - `delivery_kind: "error"` 存在，但对应什么 `message_type`？我们没有"error 包装 X 业务动词"的标准 pattern
   - 实际写法通常是 body 里塞 `error: {...}`——和 CICP 的 `msg_type: ERROR, msg_intent: PREPARE_CONTEXT` 比起来，我们对**失败版本的同一业务动词**没有显式表达

4. **Registry 校验只看 `message_type`**
   - `envelope.ts:309` 的 `NACP_MESSAGE_TYPES_ALL.has(env.header.message_type)` 只检查字符串在不在白名单
   - 但 `(message_type, delivery_kind)` 二元组的**合法组合矩阵**从未被显式校验（例如 `tool.call.request` 能不能配 `delivery_kind: "event"`？协议上没有答案）

---

### 9.3 CICP 双轴设计的真实优势（辩证地，不是 cheerleading）

**CICP 的优势（客观）**：

- **显式正交**：`msg_type (4) × msg_intent (20+) = 80+ 个交互语义`，但只需定义两条小轴
- **统一 error 包装**：任何 intent 都可以带 `msg_type: ERROR` 出现，错误转发逻辑整齐
- **`same verb, different role`**：`CONTEXT_READY` 这个业务动词，在不同方向都可以出现（COMMAND 下是 "请你准备好"，REPORT 下是 "我准备好了"），**一个字符串走天下**
- **路由表易写**：高基数过滤器先按 `msg_type`（4-way），再按 `msg_intent`（20-way），两级 switch/dispatcher
- **观测性分群自然**：`filter(msg_type === 'EVENT')` 就是所有 push-notification 流；NACP 要维护一个字符串数组去 includes-check

**CICP 的劣势（同样客观）**：

- **双真相源**：`(msg_type, msg_intent)` 必须约束合法组合——例如 `CONTEXT_READY` 不应以 `msg_type: COMMAND` 出现；registry 复杂度变成笛卡尔积
- **Body schema 与 type 的绑定更复杂**：NACP 现在是 `message_type → body schema` 一对一；CICP 里同一 intent 在不同 msg_type 下 payload 可能不同（`PREPARE_CONTEXT` 当 COMMAND 时带 `input_payload`，当 ERROR 时带 `error`），schema 要条件分支
- **CICP 内部并非完全正交**：`CLIENT_MSG_SUBMIT` vs `CLIENT_MSG_PUSH` 这两个 intent **本身就隐含方向**（submit 是上行，push 是下行）——说明即便用双轴，**业务动词里仍会偷偷混进方向信息**
- **CICP 没有单独校验 (msg_type, msg_intent) 合法矩阵的代码**——和我们 NACP 一样
- **向 wire-level 路由（Cloudflare Queues / DLQ）不利**：单字段分区比双字段分区更常见

---

### 9.4 NACP 其他维度 CICP 并没有的优势

|  NACP 已有 | CICP 等价 | 说明 |
|---|---|---|
| `producer_role` (8 种) | 无（CICP 用 `source: CicpModule` 字符串） | NACP 做了**强类型**的生产者角色 → 8-role registry 是 nano-agent 特化的产物 |
| `audience: internal/audit-only/client-visible` | 无 | 这是 nano-agent **多租户 / 合规**场景特有的轴；CICP 不需要 |
| `reply_to_message_uuid` | 无显式字段（用 trace_uuid 间接） | NACP 的 request-response pairing 用 uuid 级精确配对，比 CICP 的 intent 字符串配对更严谨 |
| `control.tenant_delegation` + HMAC signature | 无 | B2-B6 的多租户首席合规 API，CICP 完全无 |
| `stream_uuid / stream_seq` 在 trace 里 | 无（CICP 不 stream 化） | 我们 B6 eval sink dedup 依赖这两个字段 |
| `producer_key` 正则约束 `namespace.sub@vN` | 无 | NACP 对 producer identity 有强格式约束 |

**结论**：NACP 在**身份 / 多租户 / stream 协调**维度比 CICP 富得多；CICP 在**交互模式分类 / error 包装统一性**维度比 NACP 整洁。**两者设计优先级不同**，不是谁替代谁。

---

### 9.5 可以吸收回 NACP 的部分（分三档）

> **设计约束**：不 break B1-B7 shipped wire。任何吸收都走**additive, non-breaking** 路径。

#### 9.5.1 🔴 立即可做（docs-only，不改 code，B8 可包含）

**A. 在 nacp-core README / spec 里明确 "`delivery_kind` 是我们的 msg_type 轴"**
- 当前文档只把 `delivery_kind` 描述为"投递语义"
- 应显式写："`delivery_kind` is the **interaction pattern axis**（command = request, response = reply to command, event = one-way push, error = fault wrapper）; `message_type` is the **business verb axis**。Two together form the 2D matrix."
- 这让读者（包括 worker matrix phase 的 charter 作者）一眼看出我们**已经有双轴**，不需要重造

**B. 记录已知的"两轴冗余" tech debt**
- 在 `docs/rfc/nacp-core-1-2-0.md`（或新建 `nacp-core-1-3-draft.md`）里标注：
  > "message_type 的 `.request / .response / .result / .broadcast / .return` 后缀在 v1 里与 `delivery_kind` 语义重叠。v2 考虑把方向信息完全归并到 `delivery_kind`，message_type 只保留业务动词。"
- **不**在 B8 修改 shipped wire；只开 RFC tracking issue

#### 9.5.2 🟠 **nacp-1.3 冻结窗口：在 worker matrix 开工前完成**（owner 修订 2026-04-20）

> **原提议**（被推翻）：本节 C/D/E 推到 "worker matrix 之后" 再做 RFC。
>
> **owner 修订理由**：依据 nano-agent 的**"freeze the biggest cognition range of contract surface"** 纪律——B2-B6 每一个 ship phase 都在进入下一阶段前把 contract 冻结到当时认知的最大范围。nacp-1.3 的 (message_type, delivery_kind) 矩阵是我们**今天就能诚实冻结**的认知（下文 §9.7.2 逐项核验）；**推迟到 worker matrix 之后会让 4 个 first-wave workers 带着旧 wire 跑起来，然后又要全员滚动升级——成本数量级更高**。
>
> **因此**：C/D/E 在 worker matrix **开工前** RFC 定稿、**首 phase 内**实装为 shipped contract，作为 agent.core / bash.core / filesystem.core / context.core 首次 emit envelope 的基准。v1.1 旧字符串保留为 alias 不 break。

**C. 引入 `(message_type, delivery_kind)` 合法组合矩阵校验**（nacp-1.3 normative）
- 现在 `validateEnvelope()` (envelope.ts:309) 只校验 `message_type` 在 `NACP_MESSAGE_TYPES_ALL` 里
- 扩展：新增 `NACP_TYPE_DIRECTION_MATRIX: Record<message_type, Set<delivery_kind>>`，校验 `env.header.delivery_kind ∈ allowed`
- 例子：
  ```ts
  "tool.call.request"    → Set(["command"]),
  "tool.call.response"   → Set(["response", "error"]),
  "tool.call.result"     → Set(["response"]),  // progress interim/final
  "hook.broadcast"       → Set(["event"]),
  "hook.return"          → Set(["response", "error"]),
  "session.stream.event" → Set(["event"]),
  ```
- **价值**：堵住当前 "tool.call.request + delivery_kind=event" 之类的非法组合（此类组合在 v1.1 里运行时绝不会被捕获）
- **落地位置**：`packages/nacp-core/src/envelope.ts` 新增矩阵 + 在 `validateEnvelope()` 第 6 层校验
- **兼容性**：纯加法；现有正确用法全部通过

**D. 引入 "error wrapper for business verb" 的标准 pattern**（nacp-1.3 normative）
- 新增 convention：任何 message_type `X.request` 的错误响应以 `X.response` 发出，`delivery_kind: "error"`，body schema 用统一的 `NacpErrorBodySchema`（`{code, message, retriable?, cause?}`）
- 这样 error forwarding 逻辑和 happy path 共享同一份 message_type；不像 CICP 需要给 error 单独 intent
- **落地位置**：`packages/nacp-core/src/error-body.ts`（新文件）+ 在 message_type registry 里给每个 `X.response` 标注 "accepts error body when delivery_kind=error"
- **价值**：hook dispatcher / inspector / eval sink 可用统一逻辑处理任何 verb 的错误

**E. 业务动词的命名规范**（nacp-1.3 normative for NEW verbs only；旧字符串保留 alias）
- 制定 nacp-1.3 spec 章节 "business verb naming"，**对新增 message_type 强制**：
  - 全部 `<namespace>.<verb>`（两段，不多不少）
  - 方向不进 message_type（依赖 `delivery_kind` 表达）
  - 例：worker-matrix phase 新增的 `context.rerank` / `context.rebalance` / `agent.step` / `agent.turn` 全部按新规
- **旧字符串（tool.call.request / hook.broadcast 等）保留为 alias**，直到 nacp-2.0 breaking bump
- **落地位置**：`packages/nacp-core/src/naming-spec.ts` + message_type registry 注释

**F(new). 补：在 worker matrix 开工前显式确定 Message Class 轴语义（避免 agent.core 首次 emit 就踩错）**
- `delivery_kind` 的 4 个值语义用 nacp-1.3 spec 写死：
  - `command`: 期望 response；接收方必须 ack 或回 error（配合 `reply_to_message_uuid`）
  - `response`: 对某条 command 的回复；必带 `reply_to_message_uuid`；body 可正常或 error（视 delivery_kind=response vs error）
  - `event`: 单向 push；无配对；无 `reply_to_message_uuid`
  - `error`: fault wrapper；结合 `message_type` 表达"哪条 verb 出错"；可能带 `reply_to_message_uuid`（作为对某 command 的失败回复）也可能不带（观察性错误）
- **价值**：B7 binding-F04 验证过 `reply_to` 在跨 Worker push 路径上能走通；nacp-1.3 把这个行为文字化+schema 化

#### 9.5.3 🟢 远期 nacp-2.0（可能不做）

**F. 完全移除 message_type 的方向后缀**
- breaking change；需要客户端、inspector、hook dispatcher 一起升级
- 只在"我们确实因为冗余付出真实代价"时触发（例如有 Worker 因 `.request/.response` 字符串解析出错）
- **预判**：这个代价短期内不会出现；可能一直停在 9.5.2 的 additive approach

**G. 吸收 CICP 的 client-facing intent 空间**
- CICP 有 `CLIENT_HANDSHAKE / CLIENT_MSG_SUBMIT / CLIENT_MSG_PUSH` 一组 client-level 协议动词
- 我们当前 `nacp-session` 的 `session.start / resume / cancel / end` 是等价物，但粒度偏大
- post-worker-matrix 阶段，如果前端 SDK 需要更细粒度的握手/历史/推送协议，再考虑扩充
- **现阶段不做**——`session.*` 八类已经覆盖 B7 LIVE 验证的全部场景

---

### 9.6 明确**不建议**吸收的 CICP 设计

| CICP 设计 | 为什么 nano-agent 不应照搬 |
|---|---|
| `source / target: string enum` 模块名路由 | 我们的 `producer_role` + `reply_to_message_uuid` 是**强类型 + 精确配对**，比 CICP 的字符串对更严谨；不应倒退 |
| `msg_intent` 直接作为 routing 主键 | 我们 `message_type` + `producer_role` 双重 gating（见 `NACP_ROLE_REQUIREMENTS`）比单 intent 更安全 |
| ERROR 作为独立 msg_type 下塞任意 intent | 我们要保持 `message_type → body schema` 一对一的强约束，error 用 `delivery_kind: "error"` + standard error body 就够 |
| Client-in-protocol（把前端 WS 消息也塞 CICP） | 我们通过 `@nano-agent/nacp-session` 已经做到等价；不需要让客户端也学 nacp-core 的复杂度 |
| `EVENT` 作为独立 msg_type | 我们已有 `delivery_kind: "event"`；不需要字符串层再区分 |
| 2-level dispatch | 我们 wire-level 走 Cloudflare Queues 分区按 message_type 单字段更合理；内部 DO 逻辑已用 switch(messageType) 跑通（B7 LIVE 验证） |

---

### 9.7 时机与范围约束（修订版 — owner 2026-04-20 更新）

> **原提议**（我第一版写的）：9.5.2 C/D/E 留到 worker matrix 之后做 RFC；9.7 强调"B8 out-of-scope，一切后置"。
>
> **owner 修订**（本次）：这违反了 nano-agent 既有的 **"freeze the biggest cognition range of contract surface"** 纪律——B2/B3/B4/B5/B6 每一个 ship phase 都在进入下一阶段前把 contract 冻结到当时认知的最大范围；nacp-1.3 的矩阵 + error wrapper + naming spec 是**今天就能诚实冻结的认知**，推迟到 worker matrix 之后相当于让 agent.core / bash.core / filesystem.core / context.core 四个 first-wave workers 带着**已知道是 tech debt**的 v1.1 wire 跑起来，然后再全员滚动升级——**成本数量级更高**。
>
> **因此，时序 flip**：nacp-1.3 在 worker matrix 开工前 RFC 定稿，首 phase 内实装；B8 handoff memo 必须**具名**把这个冻结窗口列出来，而不是模糊提一下。

#### 9.7.1 分层时序（修订版）

| 时机 | 动作 | 状态 |
|---|---|---|
| **B8 期间**（当前） | (a) handoff memo §6 "Binding Catalog Evolution Policy" 明确写："**nacp-1.3 是 worker matrix 开工前的 pre-req**，非 post-matrix 可选项"；<br>(b) 同 memo 附一节 "Two-Axis Matrix Cognition Today"（即本文档 §9.1-§9.4 的浓缩） | **待 B8 Phase 2 执行** |
| **B8 closed 之后，worker matrix Phase 0 之前** | 起草 `docs/rfc/nacp-core-1-3-draft.md`（覆盖 C/D/E/F new）；独立 `B9-nacp-1-3-contract-freeze.md` action-plan | **新 phase**（本文档首次提出） |
| **worker matrix Phase 0** | 实装 C/D/E/F new；加 regression test；bump `NACP_VERSION = "1.3.0"`；老字符串保留 alias | **首 phase 内** |
| **worker matrix 后续 phases** | 4 first-wave workers 用 nacp-1.3 canonical 形式 emit envelope（新 verb 按 §9.5.2 E 规范；老 verb 可继续 alias） | **自然进入** |
| **post-worker-matrix（不确定时点）** | F（breaking 移除 alias）、G（client intent 扩充）视真实业务压力决策 | **仍然保留现状** |

#### 9.7.2 "今天能不能诚实冻结 nacp-1.3" — 逐项核验

对每一项 nacp-1.3 normative 内容，问三个问题：
1. **认知是否已饱和**（B1-B7 已经让我们看到全部边界？）
2. **冻结后我们有没有能力兑现**（能写出通过 regression test 的实装？）
3. **不冻结的代价是否真实存在**（worker matrix 不冻是否会产生 roll-back cost？）

| 项 | Q1 认知饱和 | Q2 实装能力 | Q3 不冻代价 | 冻结决策 |
|---|---|---|---|---|
| **C** (type × delivery_kind matrix) | ✅ B7 LIVE 3 workers 的 wire 样本已覆盖 request/response/event/error 全部 4 种组合 | ✅ `envelope.ts:309` 扩展 1 层校验即可；<50 行代码 | 🔴 若不冻，agent.core 首次 emit 错配组合无校验报警，tech debt 进生产 | **冻** |
| **D** (error body wrapper) | ✅ B5-B6 review 过程中我们已写过多次 ad-hoc error body，pattern 稳定 | ✅ 新 schema + 1 个 validator hook；<80 行 | 🔴 若不冻，每个新 worker 发明自己的 error shape，inspector / eval sink 无法统一解析 | **冻** |
| **E** (verb naming `<namespace>.<verb>`) | ✅ B4/B5/B6 的 lifecycle event / hook event / message_type 都已经是这个结构 | ✅ 纯 naming convention + lint/registry warning；<30 行 | 🔴 若不冻，worker matrix 4 workers 各自定 verb 风格，后期统一极难 | **冻** |
| **F new** (delivery_kind 4 值语义写死) | ✅ B6 `reply_to_message_uuid` 在 B7 binding-F04 cross-worker push path 上 LIVE 验证 | ✅ spec 文档 + 测试 assertion；<40 行 | 🟡 中：今天各模块对 4 值含义已基本共识；不冻短期 OK，长期歧义 | **冻**（趁势一起做） |
| **F 原** (breaking 移除 alias) | ❌ 需要看 worker matrix 时期的真实用量决策 | ❌ 会 break B1-B7 shipped wire | ❌ 目前没有代价 | **不冻** |
| **G** (client-level intent 扩充) | ❌ 前端 SDK 的真实需求还没暴露 | ❌ 需要前后端协商 | ❌ `session.*` 已覆盖 | **不冻** |

**结论**：4 项应冻（C/D/E/F-new），2 项不应冻（F-原/G）。**nacp-1.3 的 scope 明确且可完成**。

#### 9.7.3 对 B8 action-plan 的直接影响

基于上述修订，B8 action-plan 需要：

**加** 1 项 Phase 2 deliverable：
- D7 (NEW): handoff memo §11 "nacp-1.3 Pre-Requisite for Worker Matrix" — 专节说明 worker matrix 不得在 nacp-1.3 ship 前启动 Phase 0；列出 C/D/E/F-new 的冻结清单与 RFC 责任

**不改** 以下（严格守住 B8 doc-phase 纪律）：
- B8 本身**仍然不改 packages/ 代码**
- nacp-1.3 RFC 的起草 + 实装 = **新 phase（B9 or B9.5）**，不塞进 B8

#### 9.7.4 新增 `B9-nacp-1-3-contract-freeze.md` action-plan（proposed）

**Phase 结构**（建议）：
| Phase | 工作量 | 内容 |
|---|---|---|
| P1 | S | RFC 起草：`docs/rfc/nacp-core-1-3-draft.md`（base 本文档 §9.5.2） |
| P2 | M | 实装 C（matrix 校验）+ D（error body schema）+ F-new（4 值语义 spec）|
| P3 | M | 实装 E（verb naming lint + 新 verb registry） |
| P4 | S | 更新 nacp-session / session-do-runtime / hooks / capability-runtime 所有使用点以通过新校验；旧 alias 保留 |
| P5 | S | `NACP_VERSION = "1.3.0"` bump + CHANGELOG + regression test lock |

**Exit criterion**：B9 closure 后才允许 worker matrix Phase 0 启动（即 B9 是 worker matrix 的硬前置）。

---

### 9.8 辩证小结（修订版）

用户的原始判断（"msg_type + msg_intent 双轴可拓展空间更大"）**方向正确，前提略有偏差**：

- ✅ **正确**：双轴设计比"纯单轴字符串"更整洁、更易扩展
- ⚠️ **偏差**：NACP **已经有**双轴（`message_type` + `delivery_kind`），不是"在一个平面上"——只是**这两轴信息重叠 + 缺合法矩阵校验 + 缺 error wrapper 标准**，看起来像单轴
- 🎯 **真正的 action**：不是重造双轴，而是**正交化 + 合法矩阵 + error 统一 + naming 规范**

**时序上的核心修订（owner 2026-04-20）**：
- ❌ 我第一版说"nacp-1.3 放到 post-worker-matrix" —— **错了**
- ✅ 修订后：nacp-1.3 **在 worker matrix 开工前** 完成 RFC 与实装，作为 worker matrix Phase 0 的硬前置
- 🧭 遵循的 nano-agent 纪律：**"freeze the biggest cognition range of contract surface"**；B2-B6 都是这么做的
- 🔒 冻结范围严格限定：C/D/E/F-new 四项；F-原/G 不冻

**对 B8 的直接影响**：
- 🔴 B8 handoff memo §11 必须**明确写出** "nacp-1.3 contract freeze 是 worker matrix 的硬前置"
- 🔴 B8 同步提出**新 phase `B9-nacp-1-3-contract-freeze`** 的 action-plan（或 §11 内置简化版）
- 🔴 B8 本身 **仍然不改 packages/ 代码**（B8 doc-phase 纪律不变）
- 🔴 B9（新）将**改 packages/**，是 nacp-1.3 的实装 phase

CICP 给我们的**最大启发**从未是"双轴 vs 单轴"，而是：
**"方向信息 command/response/event/error 应该只有一个 source of truth；contract surface 的冻结时机应该是 maximum cognition，不是 minimum commitment"**。

---


---

## 10. 辩证分析：Contexter = 编排器, Nano-agent = Runtime — 分层架构决策（owner 2026-04-20 澄清后重写）

> **📌 文档纪律声明**：本章节**完全替换**先前（同日早些时候）的 §10。先前版本基于错误前提（把 smind-contexter 当成 peer agent system 来对比 per-user vs per-session DO），得出了"nano-agent 应该转向 per-user DO"的结论——那结论是**错误**的。
>
> **owner 2026-04-20 澄清**：
> 1. Contexter 是**对话网关**，主要目标是 intent 判断 + 聊天路由；上下文管理只是其**内部集成**的功能
> 2. Contexter 的本质是**编排器**，不是 agent runtime；因此用 user 作为 DO stub 是合理的
> 3. Nano-agent 到目前是**标准 agent runtime**，负责执行上游命令；因此用 session 作为 DO stub 是**正确**的选择
> 4. 未来应改造 contexter：去掉上下文管理，嵌入 user-based memory，**允许注入 session**；强化 orchestrator / intent / user-based DO 功能
> 5. Nano-agent 应作为 contexter 的**直接下游**，负责 session-based operations
>
> **本章节要做的事**：基于 contexter 与 nano-agent 的真实代码事实，辩证验证这 5 点；把一个**分层架构提议**写清楚；复核本文档其他章节受此澄清影响需要修订的地方。

---

### 10.1 我先前 §10 分析错在哪里 — 溯源

我先前 §10 的核心错误判断：
> "smind-contexter 以 user 为 DO entity 是 '绝对真理'，nano-agent 应切换到 per-user DO"

这个判断是在把**两个不同层级的系统**（orchestrator vs runtime）当成同层 peer 对比。**层级不同，架构约束不同**——smind 的 per-user DO 对它正确，**不构成**对 nano-agent 也正确的论据。

先前 §10 里的有效分析（可以在新 §10 里重用）：
- §10.1 的**代码事实核查**（`verifyTenantBoundary` 在 session-do-runtime 零调用）✅
- §10.2 的**多租户占位清单**（6 项必做 vs 6 项可延后）✅
- §10.3.4 的**"长跑 agent task 并发会在 per-user DO 上被序列化"分析** ✅——这条事实上**更强地论证 per-session DO 是正确的**，只是先前我用它作 "需要 task worker delegation" 的调和，现在重新理解：它直接证明 runtime **应当** per-session

先前 §10 里必须**撤回**的结论：
- ❌ "nano-agent 应该迁移到 per-user DO"
- ❌ "per-user DO + task worker delegation 混合架构"
- ❌ "B1-B7 的 per-session 需要 migration"
- ❌ Q8: 是否接受 per-user DO？（问题前提错了，自动撤回）

这些错误结论的根源是**范畴错误**：把 smind 的经验当成"agent system 通用经验"，而 smind 根本不是 agent system，是 chat orchestrator。

---

### 10.2 核对 owner 澄清的 4 点 — 基于代码事实

#### 10.2.1 Claim 1: "Contexter 是对话网关，主要目标是 intent 判断 + 聊天路由"

**代码证据**：

| 文件 | 职责 | 证据 |
|---|---|---|
| `context/smind-contexter/src/chat.ts` | HTTP/WS 网关；JWT 验证；协议转换 | `plan-chat.ts.txt §1` 明确 "反向代理网关与协议转换器" |
| `context/smind-contexter/ai/intent.ts` | 意图识别（NLU，Local/LLM Hybrid） | `app/design.txt` 行 64 "intent.ts — [NLU] 意图识别" |
| `context/smind-contexter/context/director.ts` | 根据意图路由到不同处理路径 | `director.ts:201-295` 有 `handleRagFlow / handleSmallTalk / handleRejection` 的 switch |
| `context/smind-contexter/context/producer.ts` v1.2 | 上下文管理（Slot / Rerank / Activate） | 这是 contexter **当前** 内嵌的上下文管理；user 要求剥离 |

**核实结果**：✅ Claim 准确。contexter 的 top-level flow 是 **gateway → intent → route**；context 管理是**目前嵌在 orchestration pipeline 里的一个阶段**，不是 contexter 的本质。

#### 10.2.2 Claim 2: "Contexter 本质是编排器，不是 agent runtime"

**代码证据**：

检查 contexter 的"主循环"——`director.ts::handleUserMessage`（行 139 起）：

```
receive CICP packet
  → extract user query
  → intent.analyze(query) → AiIntentResult
  → switch(intent_type):
      'rag_talk'    → handleRagFlow (writer → producer → gen)
      'small_talk'  → handleSmallTalk
      _             → handleRejection
  → stream response back to client
```

**关键观察**：这个 flow 是 **one-shot per user message**。没有：
- 任何 "agent step-by-step loop"
- 任何 "tool call iteration"
- 任何 "planner → step → observation → plan again"
- 任何类似我们 `NanoSessionDO.actorState` 的 `unattached → attached → turn_running → turn_ending` 状态机
- 任何 step budget / max iterations 概念

**对比 nano-agent 的 `SessionOrchestrator`**（`packages/session-do-runtime/src/orchestration.ts`）：

```
startTurn
  → emit Setup / SessionStart / UserPromptSubmit hooks
  → transition actor state → turn_running
  → enter runStepLoop:
      repeat up to maxTurnSteps:
        advanceStep(snapshot, signals)
        push emitted events
        if done: break
      emit turn.end + trace
```

nano-agent **有真正的 agent loop**，有 step counting，有 signals (cancelRequested / timeoutReached / compactRequired / llmFinished)，有可能 5 分钟甚至更长。

**核实结果**：✅ Claim 准确。contexter = 一次意图路由 + 一次 LLM gen；nano-agent = iterative agent-loop runtime。**这两种系统的执行 model 根本不是一个量级**。

#### 10.2.3 Claim 3: "Nano-agent 是标准 agent runtime，使用 session 作 DO stub 是正确的选择"

**代码证据**：
```ts
// packages/session-do-runtime/src/worker.ts:86
const stub = env.SESSION_DO.get(env.SESSION_DO.idFromName(sessionId));
```

**为什么 per-session 对 runtime 是正确的**（现在我必须把先前 §10.3.4 的分析重新定位为主论点而不是折中论据）：

1. **并发 agent task 的刚需**：用户会同时跑多个独立 agent 任务（代码重构 + web research + 数据分析）。每个任务时长可能数分钟到数小时。DO 是 **strongly-serialized**——如果用 per-user DO，3 个任务会排队；per-session DO 才允许真并发。
2. **Agent task 的失败隔离**：一个 task 崩溃不应影响其他 task。per-session 提供**物理级**隔离（不同 DO 实例）；per-user 只能提供**逻辑级**隔离（需要 workspace namespace + 严格访问控制）。
3. **Checkpoint/restore 粒度**：B7 F04 LIVE 验证过 DO 的 transactional storage；单一 task 的 checkpoint 大小合理；per-user DO 需要 checkpoint "所有 workspace" 会显著放大 hibernation 成本。
4. **B1-B7 已 LIVE 验证**：所有 wire protocol、cross-seam anchor、binding-F04 dedup、eval sink、checkpoint/restore 都是 per-session DO 跑出来的。这**不是可以轻易丢弃的投资**。
5. **B5 `Setup` hook 的语义**：`Setup` 是"actor runtime startup"——per-session DO 下，每个 session 启动一次 Setup 自然；per-user DO 下，Setup 语义模糊（user 级启动？还是 workspace 级启动？）

**核实结果**：✅ Claim 准确。Nano-agent per-session DO 是**对的**；我先前 §10.3 的结论必须**完全撤回**。

#### 10.2.4 Claim 4: "Contexter 应改造：去掉上下文管理，嵌入 user-based memory，允许注入 session"

这是 user 的架构**提议**，不是现状核查。我在 §10.7 单独展开。这里先确认两个前置事实：

**代码证据 A**：contexter 当前的 context 管理（`producer.ts`、`writer.ts`、`contexts` 表、`vec_history` 表）确实是**与 orchestration 深度耦合**的。director.ts 行 201-295 的 handleRagFlow 明确串接 writer → producer → gen，三者同属 contexter 进程。

**代码证据 B**：user 提出的 "user-based memory 允许注入 session"——这在 nano-agent 侧**已经有 wire 支持**：
```ts
// packages/nacp-session/src/messages.ts:17-22
export const SessionStartBodySchema = z.object({
  cwd: z.string().max(512).optional(),
  initial_context: z.record(z.string(), z.unknown()).optional(),  // ← 预留字段
  initial_input: z.string().max(32768).optional(),
});
```

`initial_context` 字段**已经存在**在 nano-agent 的 session.start 协议里，类型是任意 `Record<string, unknown>`。这是**为 upstream memory 注入预留的天然入口**。我们 B1-B7 做协议时已经 frame 了这个 hook，只是没想好谁来填——**contexter 来填，刚好合拍**。

**核实结果**：✅ Claim 直接可落地。wire 已经 ready，只缺 upstream 的生产方（contexter 改造后）与 downstream 的消费方（nano-agent 内部 context.core 在 §4 中规划的 ingest 阶段）。

#### 10.2.5 Claim 5: "Nano-agent 应作为 contexter 的直接下游，负责 session-based operations"

这是 **架构归位**的结论。核实路径：

- Contexter 改造后的输出形态：`{ intent, user_memory, realm_hints, …} → dispatch as session.start to downstream runtime`
- Nano-agent 改造后的输入形态：`session.start { initial_context: { memory: …, intent: …, realm: …}, initial_input: user_query }`
- 接口契约：**完全走 nano-agent 已有的 nacp-session wire** —— 不需要新协议

**核实结果**：✅ 在协议层上，nano-agent 作为 contexter 下游是 **零协议修改的自然拼接**。

---

### 10.3 两个系统本质角色的工程学对比

| 维度 | Contexter（编排器） | Nano-agent（agent runtime） |
|---|---|---|
| **核心工作循环** | receive message → classify intent → route → one-shot gen | receive session start → agent-loop (plan/step/observe) → tool calls → checkpoint |
| **执行时长** | 秒级（单个用户消息） | 秒到小时级（单个 agent 任务） |
| **DO 单线程影响** | 同一用户的消息序列化处理是 feature（对话天然 serial） | 同一用户的多 task 序列化是 bug（并发需求刚性） |
| **状态生命周期** | 以用户为单位（跨会话记忆、意图空间、预制菜） | 以 task 为单位（actor state machine、turn checkpoint） |
| **Memory 的位置** | 长期 / 用户级 / 向量化 / 跨对话 | 短期 / 任务级 / 当前 prompt 内 |
| **LLM 调用模式** | 一次 gen（RAG 完成即结束） | 循环 gen（plan → observe → plan），可能数百次 |
| **Checkpoint 语义** | 用户状态持久化（conversations / chats / user_memory 表） | 任务断点续跑（actor state + kernel snapshot） |
| **失败语义** | 一次消息失败 → retry | 任务中任何 step 失败 → recovery / 部分回滚 |
| **DO 身份 (idFromName)** | user_uuid | session_uuid |
| **Hibernation 频率** | 用户下线时休眠 | 任务完成 / 闲置超时休眠 |
| **Wire 协议** | CICP（自创）或 nacp-session 上行 | nacp-session 下行 + nacp-core（跨 worker） |

**关键结论**：两种系统的**每一行都不同**——它们不是"两种 agent 系统"，它们是"完全不同职责的两个系统"。我先前 §10 把它们当 peer 比较是范畴错误。

---

### 10.4 DO 身份选择的重新辩证（结论翻转）

#### 10.4.1 对 Contexter：per-user DO 正确 ✅

smind 选 `idFromName(user_uuid)` 是对的，理由（摘要）：
- 用户的意图空间 / warm preset / 对话历史都是跨对话共享 → 单 DO 便于集中管理
- 对话本质 serial → serialization 不是问题
- 跨对话记忆是核心产品功能（"用户昨天问过什么"） → 单 DO 零成本访问
- Chat UI 用户不会真正并发多个对话 → serialization 不会造成 UX 问题
- Intent vector cache 每用户加载一次 → N 倍成本节省

#### 10.4.2 对 Nano-agent：per-session DO 正确 ✅

我们选 `idFromName(sessionId)` 是对的，理由（摘要）：
- Agent task 是独立工作单元 → 隔离更强
- 并发 task 是刚性需求 → 避免 serialization bottleneck
- B1-B7 已 LIVE 验证 → 零迁移风险
- Task-level checkpoint 比 user-level 小 → hibernation 快
- Failure blast radius 限于单 task → 更好的错误边界
- per-session DO 天然 delete-per-task → 合规友好

#### 10.4.3 对 "两个都正确"的辩证补充

表面上"两个 DO 身份策略都正确"看似折中，但它的**本质是**：

> **DO 身份应当与"这个系统的自然并发单元"一致。**
>
> - Contexter 的自然并发单元是"用户"（每个用户独立一条对话时间线）
> - Nano-agent 的自然并发单元是"task"（每个 task 独立一条 agent-loop 时间线）

这是**一条比 smind/nano-agent 对比更泛化的架构原则**。未来我们立 skill.core / filesystem.core 时，同样要问"这个系统的自然并发单元是什么"——答案可能是 user，也可能是 workspace，也可能是 (user, resource) 元组。

#### 10.4.4 撤回先前结论

先前 §10.3.5 提议的 "per-user DO + per-workspace subprocess + task worker delegation" 混合架构——**作废**。这个架构在分层模型下是不必要的：
- 上层用户身份管理 → contexter 的 per-user DO 已经负责
- 下层 task 执行 → nano-agent 的 per-session DO 已经负责
- 之间通过 nacp-session wire 链接

**我先前硬要在 nano-agent 单侧实现"user-level 记忆"是越权**——那是 contexter 的职责。

---

### 10.5 分层架构提议：Contexter → Nano-agent

#### 10.5.1 架构图

```
┌──────────────────────────────────────────────────────────────────────┐
│ Client App (Web / Mobile / SDK)                                      │
│                                                                       │
│   ▲ user message / WS messages                                       │
│   │ CICP or nacp-session (see §10.5.3)                               │
│   ▼                                                                   │
├──────────────────────────────────────────────────────────────────────┤
│ Contexter = 编排器 (per-user DO)                                     │
│                                                                       │
│  ┌───────────────────────────────────────────────┐                   │
│  │ idFromName(user_uuid) → UserDO                │                   │
│  │                                                │                   │
│  │  • JWT authn / tenant stamping                │                   │
│  │  • Intent classification (ai/intent.ts)       │                   │
│  │  • User memory management (vec_intents /      │                   │
│  │    vec_history / alarm-driven refresh)        │                   │
│  │  • Conversation history across sessions       │                   │
│  │  • **Dispatch decision**: chat gen in-place   │                   │
│  │    OR delegate to nano-agent downstream       │                   │
│  └───────────────────────────────────────────────┘                   │
│                                                                       │
│   ▲                                                                   │
│   │ assemble initial_context { user_memory, intent, realm, … }       │
│   │ then emit session.start                                          │
│   ▼                                                                   │
├──────────────────────────────────────────────────────────────────────┤
│ Nano-agent = Agent Runtime (per-session DO)                          │
│                                                                       │
│  ┌───────────────────────────────────────────────┐                   │
│  │ idFromName(session_uuid) → SessionDO          │                   │
│  │                                                │                   │
│  │  • verifyTenantBoundary(envelope) on ingress  │                   │
│  │  • SessionOrchestrator.startTurn              │                   │
│  │     - ingest initial_context to context.core  │                   │
│  │     - emit Setup / SessionStart / UserPrompt  │                   │
│  │     - runStepLoop (agent loop)                │                   │
│  │  • tool calls, hooks, capability execution    │                   │
│  │  • checkpoint/restore                          │                   │
│  │  • stream session.stream.event back upstream  │                   │
│  └───────────────────────────────────────────────┘                   │
│                                                                       │
│   ▲ stream events                        ▼ service bindings          │
│   │                                                                   │
│   │      ┌─────────────────┐    ┌─────────────────┐                  │
│   │      │ bash.core       │    │ filesystem.core │                  │
│   │      │ (stateless)     │    │ (stateless)     │                  │
│   │      └─────────────────┘    └─────────────────┘                  │
│   │                                                                   │
│   │      ┌─────────────────┐    ┌─────────────────┐                  │
│   │      │ context.core    │    │ context.reranker│                  │
│   │      │ (slot mgmt)     │    │ (§4.4)          │                  │
│   │      └─────────────────┘    └─────────────────┘                  │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

#### 10.5.2 职责严格划分

| 关注点 | Contexter | Nano-agent |
|---|---|---|
| 用户身份 / JWT / tenant stamping | ✅ | ❌（verify only） |
| 跨对话记忆 / user memory | ✅ | ❌ |
| Intent classification | ✅ | ❌（得到已分类的 intent 作 input） |
| 对话历史（conversations / chats） | ✅ | ❌ |
| Warm preset / intent_space vector cache | ✅ | ❌ |
| 决定是否 delegate 到 agent runtime | ✅ | ❌ |
| 简单 chat gen（不需 agent loop） | ✅ | ❌ |
| Session-level actor state machine | ❌ | ✅ |
| Agent loop (plan/step/observe) | ❌ | ✅ |
| Tool calls / capability execution | ❌ | ✅ |
| In-session prompt 管理（slot / compact） | ❌ | ✅（context.core） |
| Checkpoint / restore 单个 task | ❌ | ✅ |
| Hook dispatching（Class A/B/C/D） | ❌ | ✅ |
| Cross-seam anchor / trace propagation | Contexter 起始 stamp | Nano-agent 消费 + 向下游传递 |

#### 10.5.3 通信协议：复用已 ship 的 nacp-session，不造新协议

**从 Contexter 到 Nano-agent 的下行**：
- `session.start` —— 携带 `initial_context` 注入 user memory + intent
- `session.followup_input` —— 后续输入
- `session.cancel` —— 取消 task
- `session.end` —— 终止 session
- `session.resume` —— 断点续跑
- `session.heartbeat` —— 心跳

**从 Nano-agent 到 Contexter 的上行**：
- `session.stream.event` 的 9 种 kind —— 包括 `turn.begin/end`、`tool.call.progress/result`、`hook.broadcast`、`session.update`、`compact.notify`、`system.notify`、`llm.delta`
- `session.stream.ack` —— 确认回执

**关键发现 🔴**：**nacp-session wire 已经是这套分层架构的天然载体**。我们 B5/B6/B7 做协议时的顶层设计已经在为这个分层做准备——只是当时没画出完整分层图，所以看起来像"nano-agent 直接面对 client"。真正的形态是 "nano-agent 面对 upstream orchestrator，orchestrator 面对 client"——**client 到 nano-agent 之间本来就需要有编排层**，B1-B7 的测试只是省略了这一层（B7 spike 里 worker-a 直接 POST `/probe/follow-ups/...` 模拟了一个 minimal orchestrator）。

#### 10.5.4 对 CICP vs nacp-session 的取舍

既然 contexter 要改造、要下对接 nano-agent，它**不应该再坚持 CICP 内部协议**——应当直接采用 nacp-session 作为**上下行双向**的 wire：

- Contexter ↔ Client: nacp-session（`session.start / session.stream.event / …`）
- Contexter ↔ Nano-agent: nacp-session (same)

这意味着 **contexter 改造后要引入 `@nano-agent/nacp-session` 作为依赖**，CICP 退化为 contexter **内部模块通信**的可选约定（不再是 wire）。

**收益**：
- Client 只需实现一套 nacp-session SDK
- Nano-agent 的上游感知不变（反正它只看 nacp-session）
- `trace_uuid / stream_uuid / stream_seq / message_uuid` 这些 B6 投资全部端到端可用

---

### 10.6 User-based memory 注入机制（落到 wire 层）

#### 10.6.1 注入点：`session.start.body.initial_context`

代码事实（重申）：
```ts
// packages/nacp-session/src/messages.ts:17-22
export const SessionStartBodySchema = z.object({
  cwd: z.string().max(512).optional(),
  initial_context: z.record(z.string(), z.unknown()).optional(),  // ← 注入口
  initial_input: z.string().max(32768).optional(),
});
```

**提议的 initial_context schema**（non-breaking addition at nacp-session v1.3 以配合 nacp-1.3 冻结，或更晚在 nacp-session v1.4）：

```ts
interface SessionStartInitialContext {
  readonly user_memory?: {
    readonly recent_intents: string[];       // 最近意图
    readonly preferences: Record<string, unknown>;
    readonly session_summaries: Array<{      // 历史会话摘要（contexter 预制）
      readonly session_uuid: string;
      readonly summary: string;
      readonly ended_at: string;
    }>;
  };
  readonly intent?: {                        // contexter 已分类好的本次意图
    readonly type: "rag" | "agent_task" | "…";
    readonly confidence: number;
    readonly keywords: string[];
  };
  readonly warm_slots?: Array<{              // 可直接放 L3 的冷藏知识
    readonly context_uuid: string;
    readonly content_full: string;
    readonly vector?: number[];              // Float32Array 序列化为 number[]
    readonly meta: Record<string, unknown>;
  }>;
  readonly realm_hints?: {
    readonly realm: string;                  // e.g. "finance" / "code-review"
    readonly source_name?: string;           // tenant scope
  };
}
```

#### 10.6.2 Nano-agent 侧消费点

在 `NanoSessionDO.dispatchAdmissibleFrame('session.start', body)` 处：

```ts
// 现状（B7 shipped）
const turnInput = extractTurnInput(messageType, body);
if (turnInput) {
  this.state = await this.orchestrator.startTurn(this.state, turnInput);
}

// 改造后（§4.1 context.core slot-store 就位之后）
const turnInput = extractTurnInput(messageType, body);
const injectedContext = body.initial_context as SessionStartInitialContext | undefined;
if (turnInput) {
  if (injectedContext) {
    // user memory / warm slots → context.core slot-store 的 L3 ingest
    await this.subsystems.contextCore?.ingestFromUpstream(injectedContext);
  }
  this.state = await this.orchestrator.startTurn(this.state, turnInput);
}
```

`ingestFromUpstream` 就是 smind `producer.ts::ingest` 的**本层适配**——在 nano-agent 侧不做 retrieval（那是 contexter 的事），只做 slot ingest。

#### 10.6.3 对 smind producer.ts 代码的重新归属

先前 §4 我提议 "smind producer.ts 的 L1/L2/L3 模型迁移到 nano-agent `context.core`"。**这个提议现在需要分开理解**：

| smind producer.ts 的能力 | 新归属 | 备注 |
|---|---|---|
| L1 Active / L2 Swap 装配（session 内 prompt 管理） | **nano-agent context.core** | 这是 session 内的短期上下文管理 |
| L3 Storage + cosine 激活（跨会话记忆） | **contexter user memory** | 这属于 user 级长期记忆 |
| ingest 接口 | **nano-agent context.core** 暴露，由 upstream (contexter) 调用 | 通过 `initial_context.warm_slots` 注入 |
| rerank（`applyExternalRerank`） | **nano-agent context.core + context.reranker worker** | §4.4 结论不变 |
| conversations / chats 表 | **contexter** | 对话历史是 user 级 |
| vec_intents 表（intent 预制） | **contexter** | 意图分类是 user 级 |
| contexts 表（L1/L2 slot JSON） | **nano-agent 内部 DO storage** | session 级；用 tenantDoStoragePut 写 |
| vec_history 表 | **跨两层分裂**——contexter 存长期、nano-agent 只在 session 内临时 slot | 需要 careful 设计边界 |

**核心校正**：先前 §4 里我把整个 producer.ts 都往 nano-agent 搬——**过度集中**。现在正确的做法是**按层拆开**：session 短期归 nano-agent，user 长期归 contexter。

---

### 10.7 Contexter 改造提议的具体路径（user Claim 4 展开）

基于 contexter 代码实现 + user 提议方向，改造清单：

#### 10.7.1 移除（当前 contexter 有 → 改造后去掉）

| 组件 | 当前位置 | 为什么移除 |
|---|---|---|
| `context/producer.ts` 的 L1/L2 session 内 slot 管理 | contexter 进程内 | 这是 runtime 责任；移到 nano-agent context.core |
| `contexts` 表 | DO SQLite | 同上 |
| `ai/gen.ts` 的 LLM call（如果用于 agent-like 场景） | contexter 进程内 | agent-loop LLM 归 nano-agent；contexter 只保留"简单 chat gen"的 LLM call |
| `context/director.ts::handleRagFlow` 中的 gen 步骤 | contexter 进程内 | 改成 delegate to nano-agent |

#### 10.7.2 保留并强化（contexter 的核心价值）

| 组件 | 为什么保留 |
|---|---|
| `src/chat.ts` 网关 | 仍是 entry point |
| `ai/intent.ts` 意图识别 | 核心编排器能力 |
| `context/director.ts` 的 routing 逻辑 | 核心编排器能力 |
| `ai/vec.ts` embedding | 给 intent / memory vectorization 用 |
| `ai/topK.ts` RAG 召回 | 给 user memory 检索用 |
| `core/alarm.ts` intent 刷新 | 用户级热表维护 |
| `vec_intents` 表 | 用户级意图路由 |
| `conversations / chats` 表 | 对话历史（user 级） |

#### 10.7.3 新增（改造后的 contexter 需要）

| 组件 | 描述 |
|---|---|
| User Memory 子模块 | 管理 recent_intents / preferences / session_summaries 的跨会话存储 |
| Session dispatch 子模块 | 调用 nano-agent 的 service binding，填充 `initial_context` 发出 `session.start` |
| Nano-agent stream relay | 把 nano-agent 的 `session.stream.event` 中转回 client |
| `@nano-agent/nacp-session` 依赖 | 作为 wire SDK（替代内部 CICP 用于外部通信） |

#### 10.7.4 改造不影响什么（兼容性 guarantees）

- smind 现有用户的 chat flow 不必断——改造可以 **feature-flag**：
  - FLAG=in_process → 维持现状 RAG → gen
  - FLAG=delegate → 新分层：RAG → dispatch to nano-agent
- 先支持 delegate 仅对 "agent_task" intent 生效，其他 intent 仍走内 process

---

### 10.8 多租户边界在分层模型下的重新布置

先前 §10 里关于 tenant 的分析**绝大部分仍然成立**，但**责任划分更清晰**了：

| 阶段 | Contexter 侧职责 | Nano-agent 侧职责 |
|---|---|---|
| **Stamping** | JWT 验证后从 token 提取 `team_uuid / user_uuid`，stamp 到 NACP envelope `authority` | N/A（contexter 已 stamp） |
| **Session dispatch** | 生成 `session.start` envelope，`authority.team_uuid / user_uuid / plan_level` 完整 | N/A |
| **Ingress verify** | N/A | `verifyTenantBoundary(envelope)` 在 `dispatchAdmissibleFrame` 入口强制校验 |
| **Storage scope** | 自己的 user-level storage 走 `tenantKv*` / `tenantR2*` | 所有 DO storage op 走 `tenantDoStorage*`，scope 到 `(team_uuid, session_uuid)` |
| **Hook emission** | N/A | 每个 hook emit 携带 `authority.team_uuid` |
| **Cross-seam anchor** | 生产 anchor 源 | 消费 + 向 bash.core / filesystem.core / context.core 传递 |

**B2/B6 tenant wrapper 的变现路径**：
- Contexter 侧：`tenantKv*` / `tenantR2*` 直接使用
- Nano-agent 侧：把 `NanoSessionDO` 内所有 `state.storage.put/get/delete` **必须**改成 `tenantDoStorage*` 调用；`verifyTenantBoundary` **必须**在 `webSocketMessage` / `fetch` ingress 入口调用

**这部分先前 §10.2 的占位清单仍然完全有效，只是"占位"的边界更具体了**：
- Contexter 负责 "生产正确的 authority"
- Nano-agent 负责 "消费并强制校验 authority"

---

### 10.9 Reranker 归属的重新讨论

先前 §4.4 的结论："reranker 作为独立 `context.reranker` worker，从 `context.core` 通过 hook 唤醒"——**基本不变**，但**服务对象更清晰**：

| rerank 发生位置 | 目的 | 消费者 |
|---|---|---|
| **Contexter 内部** | 对 user memory 的 topK 召回结果做 rerank，选出"注入给 session 的 top-N warm slots" | contexter 在生成 `initial_context` 之前 |
| **Nano-agent 内部（context.core + context.reranker）** | session 内多轮 agent-loop 中，对工具结果 + 注入 memory 混合的 L1/L2 slot 做 rerank | nano-agent 在每轮 rebalance 时 |

**两层 rerank 不矛盾**——它们优化的是不同层级的决策：
- Contexter 层：**哪些 user memory 值得投递给这个 session**
- Nano-agent 层：**当前 turn 的 prompt 里应保留哪些 slot**

**落地提议**：
- `context.reranker` worker（§4.4 定义）**保留原设计**——独立 worker、hook 唤醒、fail-open
- 它**同时服务于** contexter 和 nano-agent（两个 upstream caller，都发相同形状的 hook `ContextRerankRequested`）
- 这是比单独给 contexter 做 reranker 更好的架构（**DRY**）

---

### 10.10 对 §9 nacp-1.3 判断的复核

§9 的核心结论："nacp-1.3 在 worker matrix 开工前冻结 `(message_type, delivery_kind)` 矩阵 + error body 标准 + verb naming"——**完全不受本 §10 澄清影响**，**全部保留**。

仅需**补一条**在 nacp-1.3 RFC 里：

**加一类新 message_type namespace "orchestrator"**（reserved for contexter-class upstreams）：

```
orchestrator.session.dispatch    — contexter → nano-agent 的 session 启动指令
orchestrator.session.relay       — contexter → client 的事件中转
orchestrator.memory.query        — nano-agent → contexter 查询用户记忆（如需要回查）
orchestrator.memory.update       — nano-agent → contexter 回写 session 摘要到用户记忆
```

**这些不需要在 nacp-1.3 首发全部 ship**——只需 RFC 里**预留 namespace**，实际定义在"contexter 改造 + nano-agent 对接"那个 phase 里做。

---

### 10.11 对 B8 / worker matrix 影响的修订

先前 §9.7 + §10 提议给 B8 加 D7/D8/D9 deliverables——**D7/D8 保留，D9 修订，新增 D10**：

| Deliverable | 状态 | 说明 |
|---|---|---|
| **D7** nacp-1.3 pre-requisite note | ✅ 保留 | 不受 §10 影响 |
| **D8** tenant boundary checklist | ✅ 保留（微调） | 只是现在明确分 contexter-stamp / nano-agent-verify 两侧 |
| **D9** DO identity migration path | ❌ **撤回** | nano-agent per-session **不需要**迁移 |
| **D10（NEW）** Upstream orchestrator interface spec | 🆕 加入 | 定义 contexter（或任何上游）如何通过 `initial_context` 给 nano-agent 注入 memory + intent |

先前 Q8/Q9：
- ❌ **Q8 撤回**（是否接受 per-user DO for nano-agent？前提错了，问题作废）
- ✅ **Q9 保留**（nacp-1.3 是否是 worker matrix 硬前置？）
- 🆕 **Q10（NEW）**：是否批准 contexter 改造 + nano-agent 作为直接下游的分层架构作为 worker matrix 之后的 roadmap？
- 🆕 **Q11（NEW）**：`initial_context` 字段的 schema（见 §10.6.1）是否作为 nacp-session v1.4 的一部分冻结？还是留到 contexter-integration phase 再冻？

---

### 10.12 对本文档其他章节受 §10 影响的复核

| 章节 | 是否需修订 | 说明 |
|---|---|---|
| §1-§3 材料审读 | ❌ 不改 | 事实陈述 |
| §4 可吸收内容 | 🟡 微调 | §4.4 reranker 从"仅服务 context.core"改为"同时服务 contexter 和 context.core"；已在 §10.9 反映 |
| §4.1.1 L1/L2/L3 作为 context.core 内部结构 | 🟡 微调 | 限定为"**session 级** L1/L2"；user 级长期记忆归 contexter；已在 §10.6.3 反映 |
| §5 不建议照搬 | ❌ 不改 | |
| §6 整合建议 | 🟡 微调 | §6.2 worker matrix 新增项表需要补一条 "接口支持 upstream initial_context 注入" |
| §7 一句话总结 | 🟡 微调 | 补一句"分层：contexter 编排 + nano-agent runtime" |
| §8 资产清单 | 🟡 微调 | 资产消费者按 contexter vs nano-agent 重新分组 |
| §9 NACP dialectic | ❌ 不改 | §10.10 已覆盖补充项 |
| **§10 本节** | 🆕 新写 | |

**这些微调不在本次 §10 rewrite 的 scope 里**——单独提交另做，避免本 §10 变成"顺手改全文"。

---

### 10.13 §10 辩证小结

| 议题 | 结论 |
|---|---|
| **Contexter 与 nano-agent 的本质区别** | Contexter 是**编排器 + 网关**；Nano-agent 是 **agent runtime**。两者执行 model 不同，DO 身份选择不同 |
| **DO 身份选择** | Contexter per-user ✅；Nano-agent per-session ✅。**我先前 §10 把 nano-agent 往 per-user 推是错的，全部撤回** |
| **先前 §10 的哪些部分仍然有效** | tenant boundary 占位清单（6 + 6 项）；§10.3.4 关于 per-user DO 并发 serialization 的分析（但重新定位为**支持** per-session 的正论据） |
| **User-based memory 注入** | 已有 wire 支持：`SessionStartBodySchema.initial_context` 是预留的注入口（B5-B7 shipped）。contexter 改造只需生产 upstream，nano-agent 只需消费 |
| **smind producer.ts 代码归属** | L1/L2 session 内 slot 管理 → nano-agent；L3 跨会话记忆 → contexter。先前 §4 "整搬"方案需要按层拆 |
| **Reranker** | `context.reranker` worker 独立设计不变；但服务对象扩大为"contexter + nano-agent 两侧 upstream"，更 DRY |
| **nacp-1.3 冻结窗口** | 完全不变；新增预留 `orchestrator.*` message_type namespace 即可 |
| **B8 影响** | D7/D8 保留；D9 撤回；新增 D10（upstream orchestrator interface spec）；Q8 作废、Q9 保留、Q10/Q11 新增 |
| **我先前判断失误的教训** | 没有先确认两个系统的**职责归属**（orchestrator vs runtime）就在架构决策上展开——这是**范畴错误**；未来做类似对比分析必须先画清**层级 / 职责 / 并发单元** |

---

### 10.14 对 owner 5 点澄清的最终辩证表态

| # | owner claim | 我的辩证判断 |
|---|---|---|
| 1 | Contexter 是对话网关 + 内嵌上下文管理 | ✅ 代码事实准确；内嵌的上下文管理是**当前实现**，应改造拆出 |
| 2 | Contexter 是编排器不是 runtime | ✅ 代码事实准确；`director.ts` 的 flow 是 one-shot，无 agent loop |
| 3 | Nano-agent 是标准 agent runtime，per-session DO 正确 | ✅ 代码事实准确；B1-B7 投资完全 validate；我先前 §10 全部撤回 |
| 4 | 改造 contexter：剥离上下文管理，嵌入 user memory，注入 session | ✅ 架构方向正确；wire 已经预留注入点（`initial_context`）；落地路径见 §10.7 |
| 5 | Nano-agent 是 contexter 的直接下游 | ✅ 架构正确；nacp-session wire 天然支持；之前 B1-B7 是"省略了上游"的测试形态 |

**最终立场**：**owner 的 5 点全部站得住；我先前 §10 的错误分析完全撤回**。本次 §10 rewrite 回归到一个**更诚实**的分层理解：

> **Nano-agent 是一个 agent runtime，天然处于 agent 产品栈的下游；它不必也不应该承担 orchestration / user memory / intent routing 的职责——那些是上层（如 contexter 类系统）的事。我们 B1-B7 shipped 的 per-session DO + nacp-session wire + NACP envelope 是这个分层架构的下游基石，不是"缺失"了什么。**
