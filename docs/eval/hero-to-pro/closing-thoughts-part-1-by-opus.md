# hero-to-pro：阶段设想与工作切分(Part 1, by Opus)

> 作者: `Claude Opus 4.7`(实现者,基于 6 份 hero-to-pro 前置 study + 真实 6-worker 代码 + RHX2 closure 现状)
> 撰写日期: `2026-04-30`
> 输入材料:
> - `docs/eval/hero-to-pro/agentic-loop-api-study-by-{deepseek,GLM,GPT}.md`(3 家 API 面 gap 调查,撰写于 2026-04-30)
> - `docs/eval/hero-to-pro/llm-wrapper-study-by-{deepseek,GLM,GPT}.md`(3 家 wrapper 机制 gap 调查,撰写于 2026-04-30)
> - 当前 6-worker 真实代码(本机已验证关键断点位置)
> - `docs/issue/real-to-hero/RHX2-closure.md` 与 RH1-RH6 closure 系列(real-to-hero 阶段刚刚收尾)
> - `docs/eval/real-to-hero/closing-thoughts-by-opus.md`(real-to-hero 阶段同位置 closing thoughts,作为文案体例参考)
> 文档定位: `pre-charter 总结分析` — 非 charter 本身,目的是在写 hero-to-pro 基石文件之前对齐范围与切分,Part 2 拟覆盖 confirmation control plane / workspace 真实化 / checkpoint+revert 三套深水区
> 文档状态: `draft — 待 owner 审阅`

---

## 0. 我对当前真实状态的认定(与 6 份 study 撰写时已变更或需要校正的部分)

6 份 study 全部撰写于 2026-04-30,与本机当前代码基本同步。但仍有少量需要在 hero-to-pro charter 编制前先校正的事实点,避免直接套用旧表述:

| 事项 | study 中的表述 | 当前真实代码 | 证据 |
|---|---|---|---|
| `runtime-assembly.ts` 是否传入 `modelCatalogDb` | DeepSeek `B1` / GLM `B-M5` 标为"未传入,导致 23/25 D1 模型不可用" | **已传入**,D1 25 模型在 LLM 调用前会通过 `loadWorkersAiModelCapabilities()` 加载 | `runtime-assembly.ts:132` `modelCatalogDb: runtimeEnv.NANO_AGENT_DB`;`runtime-mainline.ts:300-301` `options.modelCatalogDb ? await loadWorkersAiModelCapabilities(...)`;GPT 报告 §1 已正确指出此修正 |
| `/start`、`/input` 是否传 `model_id` / `reasoning` | 6 家全部一致标为"丢字段" | **确认仍丢字段** | `session-lifecycle.ts:41-48` `StartSessionBody` 不含 `model_id` / `reasoning`;`session-flow.ts:342-347` `forwardStart()` 仅透传 `initial_input` / `initial_context` / `trace_uuid` / `authority`,不带模型字段 |
| `compactRequired` 信号 | 6 家一致标为"永远 false" | **确认仍永远 false** | `orchestration.ts:296,429` `compactRequired: false` 两处硬写死 |
| `CompactDelegate.requestCompact()` | 6 家一致标为"返回空" | **确认仍 no-op** | `runtime-mainline.ts:518-519` `async requestCompact() { return { tokensFreed: 0 }; }` |
| context-core 三个 RPC | 6 家一致标为"phase: stub" | **确认仍 stub** | `context-core/src/index.ts:156,177,200` 三处 `phase: "stub"` |
| NanoSessionDO 巨石 | DeepSeek RH 时代 study 标为"2078 行" | **已拆完前两个文件**(verify + persistence),主 runtime 文件 `session-do-runtime.ts` 当前 737 行,加 `verify`/`persistence`/`ws-runtime`/`runtime-assembly`/`fetch-runtime` 共 5 文件 2375 行 | `find workers/agent-core/src/host/do -type f \| xargs wc -l`;real-to-hero closing thoughts §3.4 P0-D 已识别此前置工作 |
| user-do.ts 巨石 | RH 时代 study 标为"2285 行" | **已按 domain 拆完**:`session-flow / surface-runtime / message-runtime / durable-truth / ws-runtime / agent-rpc` 共 6 文件 2478 行(增量来自新增 message body 校验等) | `find workers/orchestrator-core/src/user-do -type f \| xargs wc -l` |
| `model_id` per-message 是否被 LLM call infer | DeepSeek `L1` 标为"只从第一条消息取,后续轮次混淆" | **逻辑仍存在**,但实践上 active turn 通常只含当前 turn user message,所以单 turn 内不会混淆;跨 turn 切换确实没有"切换语义"补偿 | `runtime-mainline.ts:179-201` 仍是 first-message infer |
| `GET /sessions/{id}/files` (artifact) | 全部 study 视为已 live | 已 live(filesystem-core artifact API),但**仍非 workspace temp file API**;agentic-loop-api 三家共识此差异 | `workers/orchestrator-core/src/index.ts:1583-1697` |

仍然 missing(以下章节展开):

- 模型选择"四层状态机"中的 3 层(global default / session default / effective+fallback)
- 上下文 4 RPC 全部通电(context-core 解 stub + Lane E 真实 consumer migration)
- 跨 turn 历史进入下一次 LLM prompt 的 cross-turn context manager
- 强制压缩 + 用户确认 + summary 持久化 + 重注入闭环
- 模型切换语义注入(`<model_switch>` developer message + reasoning effort 重新映射 + window 重算)
- DDL 模型 metadata 表达(max_output_tokens / reasoning_efforts / effective_context_pct / auto_compact_token_limit / input_modalities)
- D1 conversation/session/turn 表达 requested/effective model + reasoning audit
- Permission/elicitation kernel interrupt(协议有但 kernel 不暂停)
- 通用 confirmation primitive(覆盖 model_switch / compact / context_loss / fallback / restore)
- Todo/plan 状态机(三家 reference 都有,nano-agent 完全空白)
- Workspace temp file CRUD(三家 reference 都有,nano-agent 完全空白)
- Checkpoint list / restore / rollback / fork(产品级 revert,不是 DO hibernation 内部 checkpoint)
- Session 生命周期补全(close / delete / terminate / archive / continue 与 cancel 拆分)
- Tool call inflight 列表 + 单 tool cancel
- 模型 alias 解析层

---

## 1. hero-to-pro 核心命题

real-to-hero 已经把 nano-agent 推到"6-worker + NACP + Workers AI live loop + D1 truth + DO checkpoint + RHX2 observability"的水平,first-wave 客户端可以启动一条会话、收 stream、看 history。但是 6 份 study 的共识非常一致:

> **当前 API 适合"启动一条会话并读回流",不适合"用户可控、可回滚、可审计、可跨模型切换、可主动压缩、可管理工具与临时工作区"的成熟 agentic loop 产品。**

hero-to-pro 的命题不是再做一次"端到端能跑得更稳",而是让 nano-agent 第一次具备 Claude Code / Codex / Gemini CLI 同档位的 **LLM wrapper 控制平面**。衡量这个命题完成的硬指标,6 份 study 收敛在 4 套必须冻结的产品状态机:

| 状态机 | 对应 study 共识 | 一句话边界 |
|---|---|---|
| **Model state machine** | DeepSeek M1-M6 + GLM B-M1~B-M5 + GPT 5.1 + LLM-wrapper §2.1-2.3,§3 | default → session → turn → effective/fallback → audit,客户端可见、D1 可审计 |
| **Context state machine** | DeepSeek C1-C6 + GLM B-C1~B-C6 + GPT 5.2 + LLM-wrapper §3,§4,§5 | probe → risk → preview compact → user confirm → compact job → checkpoint → restore |
| **Chat state machine** | DeepSeek S1-S6 + GLM B-S1~B-S4 + GPT 5.3 + LLM-wrapper §7 | conversation → session → turn → message/event → retry/rollback/fork/close/delete |
| **Tool/Workspace state machine** | DeepSeek A1-A8 + GLM B-A1~B-A5 + GPT 5.4 | todo → tool request → permission → execution → artifact/temp file → promotion/cleanup |

这 4 套状态机是 hero-to-pro 的"必做"。任何一条没有关闭,nano-agent 仍只是一个"能跑的 chatbot 底座",不是"成熟 LLM wrapper"。

**Part 1 文档(本文)** 聚焦前两套 + Chat 状态机的最小子集。Confirmation control plane、Workspace 真实化、Checkpoint+Revert 三套深水区的细化,以及 hero-to-platform 临界的 admin/billing/multi-provider/sub-agent 边界,留给 Part 2。

---

## 2. 6 份 study 的共识与分歧汇总

### 2.1 强共识(6 家全部命中)

| 编号 | 共识 | 严重性 | 直接证据 |
|---|---|---|---|
| K1 | context-core 3 个 RPC 全部 stub,且 compactRequired/compact delegate 主链全部断 | **critical** | `context-core/src/index.ts:156,177,200`;`orchestration.ts:296`;`runtime-mainline.ts:518-519` |
| K2 | `/start`、`/input` public 路径丢失 `model_id`/`reasoning` | **high** | `session-lifecycle.ts:41-48`;`session-flow.ts:342-347` |
| K3 | DDL `nano_models` 字段太薄,无法表达 max_output_tokens / reasoning_efforts / effective_context_pct / auto_compact / input_modalities / fallback chain | **high** | `migrations/003-usage-quota-and-models.sql:56-128` |
| K4 | 没有跨 turn 历史进入 LLM prompt 的稳定路径(LLM 看到的是当前 turn 局部消息) | **high** | `runtime-mainline.ts:286-307` 直接走 active turn messages,不读 D1 history |
| K5 | 没有 checkpoint revert / rollback 的产品 API,DO `session:checkpoint` 是 hibernation 内部状态 | **high** | `session-do-persistence.ts:142-187` 单 blob;无 `/checkpoints/{id}/restore` 端点 |
| K6 | NACP permission/elicitation 协议完整但 kernel 不暂停(`approval_pending` 枚举存在但永不触发) | **high** | `interrupt.ts:12` 存在但搜不到 setter;`runtime-mainline.ts` 工具执行前无 gate |
| K7 | 模型切换无语义事件(无 `<model_switch>` developer message、无 reasoning effort 重映射、无 context window 重算) | **medium** | `runtime-mainline.ts` 只 infer 单个 model_id;无切换检测 |
| K8 | `compact.notify` stream event schema 存在但永无触发方 | **medium** | `stream-event.ts:52` 存在;全代码库无 emit 调用方 |
| K9 | 没有 todo/plan 管理 API(三家 reference 都有,nano-agent 完全空白) | **high (产品分类)** | grep 无 `nano_todos` / `/sessions/.*/todos` |
| K10 | 没有 workspace temp file CRUD API(filesystem-core 是 artifact,不是 scratch) | **high (产品分类)** | filesystem-core RPC 只有 `writeArtifact / listArtifacts / readArtifact` |

### 2.2 中度共识(4-5 家命中)

| 编号 | 共识 | 备注 |
|---|---|---|
| K11 | 没有 session 终止 / 删除 / 重命名 / fork API | DeepSeek S1-S3、GPT 5.3、LLM-wrapper §7 |
| K12 | system prompt 对所有模型硬编码同一字符串 | DeepSeek B7、GLM 2.4、LLM-wrapper §2.4 |
| K13 | budget/policy.ts maxTokens=32K 硬编码,不感知 model context_window | DeepSeek B6、GLM B-C2,GPT LLM-wrapper §3 |
| K14 | 没有上下文使用率 probe API(`/context` 路由存在但 stub) | 6 家全部命中,与 K1 同源 |
| K15 | tool call result frame 当前不发到 client(RH 残留) | RHX2 closure §4 + agentic-loop API §5 共识 |
| K16 | turn_index UNIQUE 约束阻止 retry/重试 | DeepSeek B20 独家点出,但 GLM、GPT LLM-wrapper §6.4 印证 |

### 2.3 分歧 / 独家 / 不收敛点

| 议题 | 各家立场 | hero-to-pro 取向 |
|---|---|---|
| 是否要建独立 `nano_model_capabilities` 表 vs 扩展 `nano_models` | DeepSeek 倾向新表,GPT LLM-wrapper §5.2 也提建表;GLM §5.2 倾向 ALTER 现有表 | **倾向扩展现有表 + 关键 JSON 字段**:增加 `max_output_tokens / reasoning_efforts_json / input_modalities_json / auto_compact_token_limit / effective_context_pct / fallback_model_id / provider_key / base_instructions_suffix`,避免引入第二张 catalog;独立表是 hero-to-platform multi-provider 才需要 |
| 是否要在 hero-to-pro 引入 `<model_switch>` developer message | Codex-style,DeepSeek M3、GLM B-M2、GPT LLM-wrapper §3、agentic-loop §2.3 都建议 | **建议引入**(Phase 2 内),因 reasoning model 切换不注入会让 LLM 误解上下文;实现成本不高(在 turn ingress detect 模型变更后注入即可) |
| Per-model `instructions_template` | DeepSeek B7、GLM 2.4 提到;GPT LLM-wrapper 也提到但放 P2 | **hero-to-pro 阶段只做 base_instructions_suffix**(per-model 追加,而非完整模板替换),避免引入 template engine。完整 template 留 Pro-to-Platform |
| user-do KV 是否升 SQLite-backed DO | runtime-session-study(real-to-hero 时期)否决 | **维持否决**,此为 hero-to-platform issue;hero-to-pro 用 KV cursor + D1 keyset pagination 即可 |
| Sub-agent / multi-agent | Codex 有 `Op::MultiAgentsSpawnV2`,DeepSeek 提到 | **out-of-scope**:hero-to-pro 不做 sub-agent,会爆增 6 worker 边界设计 |
| 远程 `ThreadStore` API | DeepSeek 提到 Codex 同款 | **out-of-scope**:cross-device session resume 已通过 D1 truth + DO restoreFromStorage 部分覆盖,完整 API 是 hero-to-platform |
| Multi-provider(DeepSeek / OpenAI / Anthropic adapter) | LLM-wrapper 三家都提到,但优先级低 | **out-of-scope first-wave**:Workers AI 13 模型已覆盖 LLM 多样性需求;先做 wrapper 控制面,provider 扩展是 hero-to-platform |

---

## 3. hero-to-pro Part 1 阶段总览

| 阶段 | 主题 | 预估周数 | 关键 DoD |
|---|---|---|---|
| **HP0** | 前置修复:`/start`/`/input` 模型字段 + DDL 扩展 + system prompt 模板 + Lane E binding 解封 | 1.5 周 | `/start`/`/input` 透传 model_id+reasoning;DDL 加 7 字段;agent-core CONTEXT_CORE binding 启用;system prompt 支持 per-model suffix |
| **HP1** | Model state machine 闭环 | 2 周 | 4 层模型状态(default/session/turn/effective)端到端可见;`/sessions/{id}/model` GET/PATCH;`/models/{id}` detail;模型 alias;`<model_switch>` developer message;D1 conversation/session/turn 持久化 requested/effective model |
| **HP2** | Context state machine — probe + 主动压缩 + 跨 turn history | 3 周 | context-core 3 个 RPC 解 stub;`/context/probe` 真实 token usage;cross-turn history 进入 LLM prompt;compact 真实 LLM 摘要;compact preview/job/result;auto-compact 阈值由 model metadata 驱动 |
| **HP3** | Chat state machine — 生命周期补全 + 通用 confirmation 雏形 | 2.5 周 | `/sessions/{id}/close`、`DELETE /sessions/{id}`、`PATCH /sessions/{id}/title`、`POST /sessions/{id}/retry`、`/me/conversations` 与 `/me/sessions` 统一 cursor;permission/elicitation kernel interrupt 真实激活(`approval_pending` 设入并恢复);通用 `/confirmations` 端点雏形(覆盖 permission + elicitation,留 model_switch/compact 接入位) |
| **HP4** | Context state machine — checkpoint list + 简易 revert | 2 周 | D1 中 message 加 `superseded_at` / `superseded_by_turn_attempt`;`turn_index` 约束改 `(session_uuid, turn_index, turn_attempt)`;`/sessions/{id}/checkpoints` GET;`/sessions/{id}/checkpoints/{id}/restore` 仅支持 `conversation_only` 模式(file revert 推到 Part 2);DO checkpoint 与 D1 history 一致性测试 |
| **总计 Part 1** | — | **~11 周** | 4 套状态机的前两套 + 第三套基本闭合;Chat 第四套机件(workspace/todo/file revert)留 Part 2 |

设计原则与 real-to-hero closing thoughts 一致并加固:

- **不新增 worker**(继续保持 6-worker 拓扑)
- **不引入 SQLite-backed DO**(per real-to-hero 决议)
- **不做 multi-provider LLM**(仅 Workers AI;adapter 扩展留 hero-to-platform)
- **不做 sub-agent / multi-agent**(单 agent loop 闭环优先)
- **每阶段必须有产品级 e2e 测试**(避免 RHX 时代 stub 端点被误读为已落地)
- **D1 是 product durable truth 唯一来源,DO storage = hot/runtime 状态**(三层真相在 real-to-hero Phase 6.3 已冻结,本阶段继承)

---

## 4. HP0:前置修复(1.5 周)

> HP0 不是 hero-to-pro 的核心命题,而是"在动 4 套状态机之前,把所有 review 都同意但还没修的 K2 / K3 / K12 类 high-yield 改动先打掉",避免后续每个 Phase 都被同一种泥泞拖慢。

### 4.1 HP0-A:`/start`、`/input` public 路径透传 model_id + reasoning(K2)

**问题**:6 家共识,3 行代码改动级别。

**做法**:

1. `session-lifecycle.ts:41-48`:`StartSessionBody` 加 `model_id?: string` 与 `reasoning?: { effort: "low"|"medium"|"high" }`;同样改 `FollowupBody`。
2. `session-flow.ts:342-347`:`forwardStart()` 透传 `body.model_id` / `body.reasoning`(可选字段,缺则不传)。
3. `handleInput()` 归一化为 `/messages` 的代码路径同样补字段。
4. 测试:扩展 `messages-route.test.ts` 风格,新增 `start-route.test.ts` 与 `input-route.test.ts`,各 3 用例(无 model_id / 有 model_id / 含 reasoning effort)。

**DoD**:`/start` 与 `/input` 也能选模型,与 `/messages` 三入口对齐。

### 4.2 HP0-B:DDL `nano_models` metadata 扩展(K3)

**做法**:migration 010-model-metadata-enrichment.sql:

```sql
ALTER TABLE nano_models ADD COLUMN max_output_tokens INTEGER NOT NULL DEFAULT 4096;
ALTER TABLE nano_models ADD COLUMN effective_context_pct REAL NOT NULL DEFAULT 0.95;
ALTER TABLE nano_models ADD COLUMN auto_compact_token_limit INTEGER;  -- nullable; 计算时按 effective_context_pct 兜底
ALTER TABLE nano_models ADD COLUMN supported_reasoning_levels TEXT;   -- JSON: ["low","medium","high"]
ALTER TABLE nano_models ADD COLUMN input_modalities TEXT;             -- JSON: ["text","image"]
ALTER TABLE nano_models ADD COLUMN provider_key TEXT NOT NULL DEFAULT 'workers-ai';
ALTER TABLE nano_models ADD COLUMN fallback_model_id TEXT;            -- nullable
ALTER TABLE nano_models ADD COLUMN base_instructions_suffix TEXT;     -- nullable; per-model system prompt 追加
ALTER TABLE nano_models ADD COLUMN description TEXT;                  -- 面向用户的说明
ALTER TABLE nano_models ADD COLUMN sort_priority INTEGER NOT NULL DEFAULT 0;
```

re-seed 13 个 Workers AI 模型(数据来自 real-to-hero closing thoughts §8.1 P5-A 列表):

- granite-4.0-h-micro:131K,no reasoning,no vision,8192 max_out
- llama-4-scout-17b:131K,reasoning + vision,8192 max_out,可作为 default fallback
- gemma-4-26b-a4b-it:256K,reasoning,8192 max_out
- gpt-oss-120b:128K,reasoning,8192 max_out
- gpt-oss-20b:128K,reasoning,4096 max_out
- qwen3-30b-a3b-fp8:32K,reasoning,4096 max_out
- kimi-k2.6:262K,reasoning,16K max_out
- nemotron-3-120b-a12b:256K,reasoning,8192 max_out
- glm-4.7-flash:131K,reasoning,8192 max_out
- llama-3.3-70b-instruct-fp8-fast:24K,no reasoning,4096 max_out
- mistral-small-3.1-24b-instruct:128K,no reasoning,8192 max_out
- hermes-2-pro-mistral-7b:24K,no reasoning,4096 max_out

**DoD**:`/models` 返回新字段;`gateway.ts:loadWorkersAiModelCapabilities()` 不再硬补 `["low","medium","high"]`,改读 `supported_reasoning_levels`。

### 4.3 HP0-C:Per-model system prompt suffix(K12)

**做法**:

1. `runtime-mainline.ts:withNanoAgentSystemPrompt()` 接受可选 `modelId`,若该模型 `base_instructions_suffix` 非空,prepend NANO_AGENT_SYSTEM_PROMPT 后追加该 suffix。
2. 不引入 `{{variable}}` template engine(per §2.3 取舍)。

**DoD**:reasoning model 与 non-reasoning model 可以拥有不同的 system prompt 末尾段。

### 4.4 HP0-D:agent-core CONTEXT_CORE binding 解封(Lane E real-to-hero 残留)

**问题**:real-to-hero closing thoughts §7.4 P4-D 已识别此项,但被推到 Phase 4。hero-to-pro Phase HP2 必须依赖此 binding,因此 HP0 先解封 binding(不立即切流)。

**做法**:

1. `workers/agent-core/wrangler.jsonc` 解开 `CONTEXT_CORE` binding 注释。
2. 添加 env flag `NANO_AGENT_CONTEXT_RPC_FIRST=false`(preview)/`false`(prod)。
3. agent-core 引入 `contextCoreClient` wrapper,flag=true 走 RPC,flag=false 走 library import(短期 shim)。
4. 暂不做业务切换,仅完成布线。

**DoD**:`wrangler deploy --dry-run` 通过;binding 在 worker 启动时可见;现有 1056 测试全绿。

### 4.5 HP0 退出条件

- ✅ `/start`、`/input`、`/messages` 三入口模型字段一致。
- ✅ `nano_models` 新字段落地,13 模型 seed 校准。
- ✅ Per-model system prompt suffix 通电。
- ✅ agent-core CONTEXT_CORE binding 解封(空载)。
- ✅ 现有测试全绿(orchestrator-core ~700+,agent-core 1056,packages 全部)。

---

## 5. HP1:Model state machine 闭环(2 周)

> 4 层模型状态:**global default → session default → turn override → effective+fallback**。当前只有 turn override 一层(且 `/start`/`/input` 在 HP0 后才补齐),其余 3 层完全空白。

### 5.1 HP1-A:Session-level 默认模型(D1 audit 列)

**做法**:

1. migration 011-session-model-state.sql:`ALTER TABLE nano_conversation_sessions ADD COLUMN default_model_id TEXT;` `ADD COLUMN default_reasoning_effort TEXT;`;`ALTER TABLE nano_conversation_turns ADD COLUMN requested_model_id TEXT;` `ADD COLUMN requested_reasoning_effort TEXT;` `ADD COLUMN effective_model_id TEXT;` `ADD COLUMN effective_reasoning_effort TEXT;` `ADD COLUMN fallback_used INTEGER NOT NULL DEFAULT 0`。
2. `recordTurnStart()` 写 requested 字段;`recordTurnEnd()` 写 effective 字段。
3. session start 时,若 body 含 `model_id`,写入 `default_model_id`;后续 turn 缺省即沿用 session 默认。

**DoD**:同一 session 不同 turn 可审计真实选择历史。

### 5.2 HP1-B:`GET/PATCH /sessions/{id}/model` 端点

**做法**:

| 路由 | 行为 |
|---|---|
| `GET /sessions/{id}/model` | 返回 `{ default_model_id, default_reasoning_effort, last_effective_model_id, last_effective_reasoning_effort, last_fallback_used, last_switched_at }` |
| `PATCH /sessions/{id}/model` | body `{ model_id, reasoning_effort }`,写 `nano_conversation_sessions.default_*`;不影响当前正在执行的 turn,仅影响后续 turn |

**DoD**:客户端可以查看与修改 session 默认模型,无需每个 turn 都带字段。

### 5.3 HP1-C:`GET /models/{id}` 单模型 detail 端点

**做法**:复用 `nano_models` 单行查询 + team policy gate;返回 HP0-B 落地的全部 metadata 字段。

**DoD**:客户端可以查 max_output_tokens、reasoning_efforts、effective_context_pct、auto_compact_token_limit、fallback、description。

### 5.4 HP1-D:模型 alias 解析层

**做法**:

1. seed 4 个 alias:`@alias/fast` → granite-4.0-h-micro;`@alias/balanced` → llama-4-scout-17b;`@alias/reasoning` → gpt-oss-120b;`@alias/vision` → llama-4-scout-17b。
2. migration 012-model-aliases.sql:`CREATE TABLE nano_model_aliases (alias_id TEXT PK, target_model_id TEXT NOT NULL FK, ...)`。
3. `requireAllowedModel()` 在 D1 lookup 前先尝试 alias resolve。
4. `GET /models` response 增加 alias 节,告知客户端可用 alias。

**DoD**:客户端可以用 `model_id: "@alias/reasoning"` 而不是完整 `@cf/openai/gpt-oss-120b`。

### 5.5 HP1-E:模型切换语义注入(`<model_switch>` developer message)

**做法**:

1. 在 `extractTurnInput()` 与 active turn message 之间,detect:本 turn `requestedModelId` !== 上一 turn `effective_model_id`(读 D1 turn 表)。
2. 若不同,在 active turn messages 前插入 `{ role: "developer", content: "<model_switch>You were previously using ${prevModel}. Continue under ${currentModel} per its instructions: ${baseInstructionsSuffix}</model_switch>" }`。
3. compact 时(HP2 落地后)需要剥离 `<model_switch>` 片段,压缩后重新注入。
4. Reasoning effort 重映射:若新模型 `supported_reasoning_levels` 不含 client 请求的 effort,降级到该模型 default(不静默 ignore)。

**DoD**:cross-turn 模型切换时 LLM 看到清晰的语义提示;reasoning model → non-reasoning model 不再 silently drop effort。

### 5.6 HP1-F:Fallback chain 执行 + 审计

**做法**:

1. `gateway.ts` 当前的 serial fallback 只读硬编码 const,改为读 `nano_models.fallback_model_id`(单层链即可,不做无穷级联)。
2. fallback 触发后写 `nano_conversation_turns.fallback_used = 1`,并 emit `model.fallback` stream event(NACP 加新 kind)。
3. `/sessions/{id}/usage` 与 `/sessions/{id}/timeline` 都能反映 fallback 事件。

**DoD**:fallback 是显式可审计的,不再是 silent retry。

### 5.7 HP1 退出条件

- ✅ 4 层模型状态完整(default/session/turn/effective+fallback)。
- ✅ `/sessions/{id}/model` GET/PATCH live。
- ✅ `/models/{id}` detail live。
- ✅ Alias 解析 live。
- ✅ `<model_switch>` developer message 在 cross-turn 切换时注入。
- ✅ Fallback 写 D1 audit + emit stream event。
- ✅ E2E 测试覆盖:同 session 切换 reasoning↔non-reasoning、vision↔non-vision、131K↔24K window。

---

## 6. HP2:Context state machine — probe + 压缩 + 跨 turn history(3 周)

> 这是 hero-to-pro 体量最大的一个 phase,工作量预计是 HP1 的 1.5 倍。它要把 6 份 study 共识 K1 / K4 / K8 / K13 / K14 一起关掉,并真正激活 real-to-hero 一直推迟的 Lane E。

### 6.1 HP2-A:context-core 3 个 RPC 解 stub(K1)

**做法**:

1. `getContextSnapshot(sessionUuid)`:从 agent-core Session DO 拉 `kernelSnapshot.activeTurn.messages` + `nano_conversation_messages` 历史 + workspace assembler pending layer,返回 `{ context_window, total_tokens, free_tokens, layers: [{ kind, source_count, token_count, droppable }], compact_state: { last_compact_at?, compact_count, summary_token_count } }`。
2. `triggerContextSnapshot(sessionUuid)`:实写 `nano_conversation_context_snapshots`,`snapshot_kind = "user-triggered"`,payload 含上述结构。
3. `triggerCompact(sessionUuid, options)`:实调 LLM 摘要(用同一 session model)、产生 replacement history、写 D1 boundary snapshot、emit `compact.notify` stream event。

**DoD**:三个端点不再返回 `phase: "stub"`;orchestrator-core `/context/*` 路由透传真实数据;客户端文档同步去掉 stub 警告。

### 6.2 HP2-B:Cross-turn history 进入 LLM prompt(K4)

**问题**:当前 active turn messages 只含本 turn 的 user message;LLM 看不到上一 turn 的 assistant reply / tool result。这是导致 chat 体验"看起来像 chat 但其实每次都是 single-turn"的根因。

**做法**:

1. 引入 `CrossTurnContextManager`(放在 agent-core,不放 context-core,避免 RPC 跨 worker 在每次 LLM call 都触发)。
2. `runtime-mainline.ts` LLM call 之前:从 D1 `readHistory()` 读取本 session 的最近 N 个 message(N 由模型 `effective_context_pct * context_window / avg_message_tokens` 估算),与当前 turn user message 合并。
3. 已 compact 过的历史:用 D1 `nano_conversation_context_snapshots` 中 `snapshot_kind = "compact-boundary"` 的 summary_ref 替代被 compact 的旧消息。
4. `<model_switch>` 与 `<state_snapshot>` 片段在 compact 时按 Codex/Gemini 套路剥离再恢复。

**DoD**:同 session 第二个 turn 的 LLM 能引用第一个 turn 的内容;evidence 通过 e2e:turn1 "我叫张三" → turn2 "我叫什么" → assistant 回 "张三"。

### 6.3 HP2-C:`compactRequired` 信号生成 + auto-compact

**做法**:

1. 在 `runtime-mainline.ts` LLM call 之前累计 `estimatedPromptTokens`(字节启发式,不调 LLM)。
2. 若 `estimatedPromptTokens > model.auto_compact_token_limit`(HP0 已 seed),scheduler signals 写 `compactRequired: true`。
3. kernel runner 拿到 `compact` decision 后调 `delegates.compact.requestCompact()`;改为 emit `context.compact.preview` stream event,然后(可选用户确认或直接执行)调 context-core RPC 真实压缩。
4. compact 完成后写 D1 boundary snapshot,scheduler 下一轮回到 `tool_exec` 或 `llm_call`。
5. 失败 3 次后 circuit breaker(per Codex)。

**DoD**:131K context_window 模型在 prompt 估算 ~118K token(90%)时自动触发 compact;24K context_window 模型在 ~22K 时触发;不再 silently 溢出。

### 6.4 HP2-D:`/sessions/{id}/context/probe` 端点

**做法**:替代当前 stubbed `/context` 的部分语义,新增专门的轻量 probe:

```http
GET /sessions/{id}/context/probe
→ {
  "model_id": "@cf/.../llama-4-scout-17b...",
  "context_window": 131072,
  "effective_context_window": 124518,  // pct=0.95
  "auto_compact_token_limit": 110000,
  "estimated_prompt_tokens": 38421,
  "free_tokens": 86097,
  "usage_pct": 0.31,
  "risk": "low" | "medium" | "high" | "overflow",
  "need_compact": false,
  "last_compact_at": null
}
```

**DoD**:客户端可以在每个 turn 之前 quick check;前端可显示进度条。

### 6.5 HP2-E:`/sessions/{id}/context/compact/preview` + `/compact` job

**做法**:分离 preview 与 execute:

| 路由 | 行为 |
|---|---|
| `POST /context/compact/preview` body `{ instructions? }` | 返回 `{ before_tokens, after_tokens_estimate, will_keep: [{message_uuid, role, kind}], will_summarize: [...], requires_user_confirmation: boolean }` |
| `POST /context/compact` body `{ confirmation_token, instructions? }` | 真实执行,返回 `{ job_id, status: "running" }` |
| `GET /context/compact/jobs/{job_id}` | 返回 `{ status, before_tokens, after_tokens, summary_ref, completed_at? }` |

**DoD**:Claude Code `/compact [instructions]` 同档体验;preview 与 execute 不需要锁同一 session。

### 6.6 HP2-F:Context layer probe(K14 收尾)

**做法**:`GET /sessions/{id}/context/layers` 返回 `ContextAssembler` 的 6 层细节(system / session / workspace_summary / artifact_summary / recent_transcript / injected),各层 token 数与是否 droppable。

**DoD**:debug 客户端可以看到 prompt 由哪些 layer 组成。

### 6.7 HP2 退出条件

- ✅ context-core 3 RPC 解 stub。
- ✅ Cross-turn history 进入 LLM prompt(e2e 验证)。
- ✅ Auto-compact 由 model metadata 驱动,131K 与 24K 模型阈值不同。
- ✅ `/context/probe` 真实 token usage。
- ✅ `/context/compact/preview` + `/compact` + `/jobs/{id}` 三段式。
- ✅ `/context/layers` 暴露 6 层组装细节。
- ✅ E2E 覆盖:长对话自动 compact 不溢出;切换到小窗口模型先压缩。

---

## 7. HP3:Chat state machine — 生命周期补全 + Confirmation 雏形(2.5 周)

### 7.1 HP3-A:Session 生命周期补全(K11)

**做法**:

| 路由 | 语义 |
|---|---|
| `POST /sessions/{id}/close` | 正常结束(区别于 cancel:不是中断当前 turn,是关闭 session) |
| `DELETE /sessions/{id}` | tombstone(不物理删 D1 history,标 `deleted_at`,从 list 中隐藏) |
| `PATCH /sessions/{id}/title` | 写 `nano_conversations.title`(D1 字段已存在) |
| `POST /sessions/{id}/retry` | 重试最近失败 turn(依赖 HP4 turn_attempt) |

**DoD**:session 可以被关闭、删除、重命名、重试;不再压成单一 `/cancel`。

### 7.2 HP3-B:Permission/Elicitation kernel interrupt 真实激活(K6)

**问题**:NACP 协议完整,HTTP 路由存在,kernel `approval_pending` 枚举存在,但 setter 路径完全空白——这是 6 家 study 都点出的 high gap。

**做法**:

1. 在 `runtime-mainline.ts` `handleToolExec` 之前加 capability policy gate:`policy.shouldAsk(toolName, toolInput, mode)` 返回 `ask` 时,kernel emit `session.permission.request` WS frame,并设置 interrupt `approval_pending` + checkpoint。
2. KernelRunner 不再 advanceStep,直到 `awaitAsyncAnswer(decisionUuid)` 在 DO storage 收到 client 端通过 `POST /permission/decision` 写入的答复。
3. 收到 `allow` → 继续 tool exec;`deny` → finish + audit;`timeout` → finish + system.error。
4. Elicitation 走完全相同的 `elicitation_pending` interrupt 模式(kernel 加新枚举)。

**DoD**:tool call 在 ask policy 下真实暂停;client 通过 HTTP `permission/decision` 端点恢复 kernel;e2e 覆盖 allow/deny/timeout 三态。

### 7.3 HP3-C:通用 `/confirmations` API 雏形

**问题**:permission/elicitation 各自为政;HP1 引入的 `<model_switch>` 与 HP2 引入的 compact preview 也需要"用户确认"语义。GPT 报告 §7.4 提议统一 confirmation primitive。

**做法**(雏形,不强求一次替换 permission/elicitation):

| 路由 | 行为 |
|---|---|
| `GET /sessions/{id}/confirmations` | 列出当前所有 pending confirmation,kind ∈ `{tool_permission, elicitation, model_switch, context_compact, fallback_model}` |
| `POST /sessions/{id}/confirmations/{request_uuid}/decision` body `{ decision: "allow"\|"deny"\|"modify", payload? }` | 统一确认入口 |

permission/elicitation 现有路径继续保留兼容(双发期);新增的 model_switch / context_compact / fallback 走新路径,避免再分裂出 4 个端点。

**DoD**:客户端可以用一个 endpoint 处理所有 confirmation 类型;permission/elicitation 兼容期不破坏。

### 7.4 HP3-D:`/me/conversations` 与 `/me/sessions` 统一 cursor pagination

**问题**:real-to-hero closing thoughts §6.4 P3-D 已识别 KV+D1 双源不一致 + 无 cursor。

**做法**:

1. 与 `handleMeSessions` 对齐读取策略:KV(hot)优先 → D1(cold)兜底 → merge。
2. cursor 基于 `latest_session_started_at` keyset,limit 默认 50。
3. `GET /conversations/{conversation_uuid}` 新增,返回 conversation-level 视图(含其下所有 session 列表 + last_active_session_uuid + total_turn_count)。

**DoD**:列表分页稳定;conversation-level 视图存在。

### 7.5 HP3 退出条件

- ✅ session close / delete / title / retry 全部 live。
- ✅ Permission/elicitation kernel interrupt 真实暂停 → 恢复。
- ✅ `/confirmations` 雏形覆盖 5 种 confirmation kind。
- ✅ `/me/conversations` cursor pagination + 双源对齐。
- ✅ `/conversations/{uuid}` conversation-level 视图。

---

## 8. HP4:Checkpoint list + 简易 revert(2 周)

> 完整 product checkpoint/revert 是 hero-to-pro 最重的设计点。Part 1 仅做 **conversation_only revert**;file-revert(用 git shadow 做 Gemini 风格快照)与 sub-agent state restore 留 Part 2 / hero-to-platform。

### 8.1 HP4-A:turn_index UNIQUE 约束改造(K16)

**问题**:`UNIQUE(session_uuid, turn_index)` 阻止 retry/重试,因为重试会复用同 turn_index。

**做法**:migration 013-turn-attempt.sql:

1. `ALTER TABLE nano_conversation_turns ADD COLUMN turn_attempt INTEGER NOT NULL DEFAULT 1;`
2. 删除 `UNIQUE(session_uuid, turn_index)` 约束(SQLite 需 rebuild 表),改为 `UNIQUE(session_uuid, turn_index, turn_attempt)`。
3. retry 时 `turn_attempt += 1`,上一次 turn 不删除,标 `superseded_at` + `superseded_by_turn_attempt`。

**DoD**:retry 不再触发 UNIQUE 冲突;历史可审计每次 attempt。

### 8.2 HP4-B:Message superseded marker

**做法**:

1. `ALTER TABLE nano_conversation_messages ADD COLUMN superseded_at TEXT;` `ADD COLUMN superseded_by_turn_attempt INTEGER;`
2. revert 操作不删 message,只标 superseded(per Codex rollout reconstruction 思路)。
3. `readHistory()` 默认过滤 `superseded_at IS NULL`;新增 `?include_superseded=1` 参数显示历史。

**DoD**:revert 后 history 干净,但 audit 可见。

### 8.3 HP4-C:Checkpoint list / restore API

**做法**:

| 路由 | 行为 |
|---|---|
| `GET /sessions/{id}/checkpoints` | 列出可 revert 锚点:每个 turn end / 每次 user-triggered snapshot / 每次 compact boundary;返回 `[{ checkpoint_id, kind: "turn-end"\|"user"\|"compact-boundary", turn_index, turn_attempt, message_count_at, created_at, summary }]` |
| `POST /sessions/{id}/checkpoints` body `{ note? }` | 用户主动创建命名 checkpoint(写 `nano_conversation_context_snapshots` `snapshot_kind = "user-named"`) |
| `GET /sessions/{id}/checkpoints/{id}/diff` | 返回从该 checkpoint restore 后会被 superseded 的 message/turn 列表 |
| `POST /sessions/{id}/checkpoints/{id}/restore` body `{ mode: "conversation_only", confirmation_token }` | 标 turn/message superseded;DO `kernelSnapshot` reset 到 checkpoint 对应的消息集 |

**重要边界**:Part 1 仅支持 `mode: "conversation_only"`;`files_only` 与 `conversation_and_files` 留 Part 2(需要 R2 + git shadow 设计)。

**DoD**:用户可以从 turn N 回到 turn M;后续 turn 进入 turn_attempt 2;LLM prompt 不再看到 superseded 的内容。

### 8.4 HP4-D:DO checkpoint 与 D1 history 一致性测试

**问题**:DO `session:checkpoint` 单 blob 与 D1 `nano_conversation_messages` 双源,revert 时容易漂移。

**做法**:

1. revert 操作:先标 D1 messages superseded → 再 DO `restoreFromStorage()` 到对应 turn 的 `kernelSnapshot`。
2. 一致性校验:revert 后 `kernelSnapshot.activeTurn` 与 D1 当前活跃 turn 必须一致(turn_index + turn_attempt)。
3. 测试:e2e 覆盖 revert + 继续对话 + 再 revert;每步都校验两源一致。

**DoD**:revert 后两源不漂移;有自动化 e2e 保护回归。

### 8.5 HP4 退出条件

- ✅ turn_attempt 改造完成,retry 不冲突。
- ✅ Message superseded 标记 + filter 默认。
- ✅ Checkpoint list / diff / restore(conversation_only)live。
- ✅ DO + D1 一致性 e2e 通过。

---

## 9. 与 6 份 study 共识的全量映射

| study 共识编号 | 在 hero-to-pro Part 1 中的承接 |
|---|---|
| K1 (context-core stub) | HP2-A |
| K2 (start/input 丢字段) | HP0-A |
| K3 (DDL 字段薄) | HP0-B |
| K4 (cross-turn history 不进 prompt) | HP2-B |
| K5 (无 product checkpoint/revert) | HP4-C(conversation_only)+ Part 2(file revert) |
| K6 (permission/elicitation kernel 不暂停) | HP3-B |
| K7 (无模型切换语义) | HP1-E |
| K8 (compact.notify 永无触发) | HP2-C |
| K9 (无 todo/plan API) | **Part 2**(workspace+todo 状态机) |
| K10 (无 workspace temp file) | **Part 2** |
| K11 (无 session 终止/删除/重命名/fork) | HP3-A(close/delete/title/retry);fork 推 Part 2 |
| K12 (system prompt 一刀切) | HP0-C |
| K13 (budget hardcoded 32K) | HP2-A 内随 context-core 解 stub 一并修(改读 model.auto_compact_token_limit) |
| K14 (无 context probe) | HP2-D + HP2-F |
| K15 (tool result frame 不发 client) | **应在 RHX2 Phase 2.4 已完成,需 hero-to-pro 启动前 verify**;若仍缺,HP2-A 内顺带补 |
| K16 (turn_index UNIQUE 阻 retry) | HP4-A |

| study 独家发现 | 在 hero-to-pro Part 1 中的承接 |
|---|---|
| DeepSeek M1 (`GET /models/{id}` detail) | HP1-C |
| DeepSeek M5 / GLM B-M1 (model alias) | HP1-D |
| GLM B-A2 (no temp file management) | **Part 2** |
| GLM B-S3 (elicitation 缺 kernel interrupt) | HP3-B 一并 |
| GPT 7.4 (统一 confirmation API) | HP3-C 雏形 |
| GPT 5.4-A6 (tool call 历史 API) | **Part 2**(随 workspace 状态机) |
| LLM-wrapper §3 (token counting) | HP2-C(estimatedPromptTokens) |
| LLM-wrapper §6 (D1 conversation truth 不存 model setting) | HP1-A(turn 表加 requested/effective model 列) |

---

## 10. 与 RHX2 closure / real-to-hero closing thoughts 的衔接

real-to-hero 已经把以下事项收口,hero-to-pro 不应重复:

| real-to-hero 已落地 | hero-to-pro Part 1 的依赖关系 |
|---|---|
| RHX2 observability + audit pipeline | HP1 fallback event、HP2 compact event 都直接复用现有 system.error / system.notify dual-emit |
| 6-worker 拓扑 + RPC + auth | hero-to-pro Part 1 不动 worker 边界 |
| D1 truth + DO storage 三层真相冻结 | HP4 严格遵守,不向 DO storage 倾倒 D1 truth,也不向 D1 倾倒 runtime state |
| `/me/conversations`、`/me/devices`、`/messages`、`/files` 已通电 | HP3-D 仅做 cursor pagination + KV/D1 对齐,不重做端点 |
| jwt-shared lockfile 修复 | hero-to-pro 不再担心 standalone build |
| KV/R2 binding 已落 wrangler | HP2-A 的 context-core 解 stub 可以读 R2 artifact summary |

real-to-hero closing thoughts §10 中标为 out-of-scope first-wave 的事项(admin plane / billing / multi-deploy / multi-provider),hero-to-pro Part 1 **继续保持 out-of-scope**,留 hero-to-platform 处理。

---

## 11. 风险与不确定性

1. **HP2-B (cross-turn history)的最大风险:token estimation 不准** — 当前没有真正的 tokenizer。字节启发式(chars/4)在中文场景误差可达 30%。Part 1 接受此误差,在 `effective_context_pct = 0.95` 与 `auto_compact_token_limit < context_window` 两层缓冲下,溢出概率应可控;Part 2 考虑接入更精确的 tokenizer 或 Workers AI usage feedback。
2. **HP2-C (auto-compact)与 HP1-E (`<model_switch>`)的耦合** — compact 时如何处理已注入的 `<model_switch>` 片段是 Codex 已踩过的坑。建议 compact 流程显式扫描 developer message,剥离再恢复。
3. **HP3-B (kernel interrupt)与 RHX2 dual-emit 的冲突** — kernel interrupt + checkpoint 路径会不会与 system.error 双发窗口产生 race?预估不会,但需要专门 e2e 验证 ask policy 下的 timeout + system.error 双发。
4. **HP4-D (DO + D1 一致性)的最大风险:revert 中途 worker 重启** — DO restore + D1 标 superseded 不是事务。建议:先标 D1 superseded(可幂等),失败重试;DO restoreFromStorage 在 worker 启动时自动触发,从 D1 最新非 superseded 状态重建。
5. **migration 010-013 的回滚策略** — Cloudflare D1 不支持 ALTER COLUMN DROP DEFAULT;新加列必须 nullable 或带 default。已在所有 ALTER 中预留 default。
6. **Owner-action 依赖**:HP0-D 需 wrangler 部署测试 binding;HP4-D 一致性 e2e 需要双源 fixture,owner 应配合在 preview 上跑一次。

---

## 12. 最终判断

hero-to-pro 不是 real-to-hero 的延续抛光,而是把 nano-agent 第一次推到"成熟 LLM wrapper"档位。6 份 study 的共识非常一致:**当前不缺基础设施,缺的是把基础设施按 4 套产品状态机组织起来**。

**为什么 Part 1 只覆盖 Model + Context + Chat 三套,Workspace 状态机推 Part 2**:

- 这三套关停 K1 / K2 / K4 / K6 / K7 / K8 等"用户立刻可感知"的差距,可以让 nano-agent 在 11 周后第一次具备"稳定多轮对话 + 模型切换 + 主动压缩 + 简易 revert"的产品体感;
- Workspace 状态机(todo/plan + temp file CRUD + tool inflight + file revert)涉及 filesystem-core 大改 + R2 R/W pipeline 真实化 + git shadow snapshot,工作量与三套相当甚至更大,放一起会让 hero-to-pro 像一次 big bang;
- Part 2 还可以承接 confirmation 完整收拢(model_switch / compact / fallback / restore 全部落 `/confirmations`)、cross-stage 残留项(RHX2 deferred)、性能 hardening。

**为什么不做 multi-provider / sub-agent / SQLite-DO**:

- multi-provider 在 wrapper 控制面没收口前做,会让 4 套状态机 × N provider 爆增到不可控;
- sub-agent 引入会改变 6-worker 拓扑事实(可能需要 spawn DO),与 real-to-hero "不新增 worker" 的边界冲突;
- SQLite-DO 在 Part 1 没有实际驱动需求(D1 已是 product truth,DO storage 已支撑 hibernation),per real-to-hero 决议继续否决。

**预期效果**:完成 hero-to-pro Part 1 后,nano-agent 第一次具备:

- 真实 4 层模型状态机(default → session → turn → effective+fallback,全部 D1 audit)。
- 真实跨 turn 上下文(LLM 看到完整历史,不再单 turn 失忆)。
- 真实 auto-compact + manual compact preview/job(per-model 阈值,不再溢出 crash)。
- 真实 permission/elicitation 工具暂停 + 恢复(NACP 协议第一次端到端通电)。
- 简易 conversation-level revert(用户可以回到 turn N 重做)。
- 通用 confirmation primitive 雏形(为 Part 2 model_switch/compact 显式确认留接入位)。

到这一步,nano-agent 不再只是"端到端能跑的 chatbot 底座",而是 Claude Code / Codex / Gemini CLI 同档位的 LLM wrapper —— 但前提是 Part 2 也要交付,否则 todo/workspace/file revert 的产品空白会让"成熟"二字打折。

Part 2 的草稿留待 Part 1 charter 执行约 1/3 后(预估 HP1 完成)再写,届时可以把 HP0-HP4 的实施反馈纳入,避免 Part 1 任何 phase 在执行时被 Part 2 计划反向约束。
