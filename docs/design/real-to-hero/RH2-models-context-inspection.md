# Nano-Agent 功能簇设计模板

> 功能簇: `RH2 Models Context Inspection`
> 讨论日期: `2026-04-29`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告:
> - `docs/charter/plan-real-to-hero.md`
> - `docs/design/real-to-hero/RH2-llm-delta-policy.md`
> 关联 QNA / 决策登记:
> - `docs/design/real-to-hero/RHX-qna.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

RH2 负责把“客户端第一眼就能感知的断点”一次补齐：`GET /models`、`GET /sessions/{id}/context`、context snapshot/compact 操作、WS full NACP frame、tool call semantic-chunk 与 result frame。它不是为了扩更多 endpoint，而是为了让 web / mini-program / CLI client 第一次真正能观察、选择、恢复和理解 session。

- **项目定位回顾**：RH2 是 `client visibility first wave`。
- **本次讨论的前置共识**：
  - token-level LLM delta streaming 不进 RH2，见专项设计 `RH2-llm-delta-policy.md`
  - RH2 必须继续遵守 façade envelope 与三层真相纪律
- **本设计必须回答的问题**：
  - `/models` 与 `/context` 的真相源分别属于哪一层？
  - WS 协议升级如何做到“full frame 新增 + lightweight 兼容 1 release”？
- **显式排除的讨论范围**：
  - device revoke / API key / team display
  - file upload / R2 持久化

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`RH2 Models Context Inspection`
- **一句话定义**：`给真实 client 提供模型可见性、context 可见性和可消费的 full-frame 流式协议。`
- **边界描述**：这个功能簇**包含** `/models`、`/context`、WS full NACP upgrade、tool semantic-chunk / result frame、heartbeat lifecycle hardening；**不包含** token-level text streaming、device/auth、filesystem、multi-model quota。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| `/models` | 面向客户端的 team-filtered 模型可用性列表 | 真相源在 D1 `nano_models` |
| `/context` | session 当前 context 状态与操作面 | 真相源在 context inspection / snapshot seam |
| full frame | 以 `nacp-session` 为单一真相的 WS frame/body | 兼容 lightweight 1 release |
| semantic-chunk | tool_use_start / delta / stop 与 tool.call.result 级别的流式 | 非 token-level text streaming |

### 1.2 参考调查报告

- `docs/charter/plan-real-to-hero.md` — §7.3、§9.2、§10.1
- `docs/design/real-to-hero/RH2-llm-delta-policy.md` — LLM delta / snapshot-vs-push 决议

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- RH2 在整体架构里扮演 **client-observable read/stream layer** 的角色。
- 它服务于：
  - web / mini-program / CLI client
  - RH5 多模型 / 多模态选择入口
  - RH6 manual evidence 中的可观测客户端体验
- 它依赖：
  - RH1 已闭合的 live runtime
  - D1 `nano_models` 与 context inspection seam
  - `nacp-session` 的 message / stream schema
- 它被谁依赖：
  - RH5 model picker 与 multimodal request path
  - final closure 的 Session 消费闭环 criterion

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| RH1 Lane F | RH1 -> RH2 | 强 | RH2 WS 可见性建立在 live runtime 之上 |
| RH5 Multi-model | RH2 -> RH5 | 强 | RH5 依赖 `/models` 与 WS full frame |
| Context core | RH2 <-> context inspection | 中 | `/context` 读操作与 snapshot/compact 操作都需稳定读模型 |
| Client adapters | RH2 -> clients | 强 | web / wechat WS adapter 需同步升级 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`RH2 Models Context Inspection` 是 **客户端第一次真正能看懂 session 的可见性层**，负责 **暴露模型、context 与 full-frame stream**，对上游提供 **可选择、可恢复、可解释的读模型**，对下游要求 **RH5/RH6 不再依赖临时兼容面**。"

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| token-level text streaming | “做 full stream 就顺手全做” 的诱因 | 会把 RH2 膨胀成协议+性能大工程 | hero-to-platform |
| `/models` 硬编码 2 模型 | 最快可跑路径 | 无法成为多模型入口 | 否 |
| `/context` 静态 stub | 最省 implementation 的做法 | client inspection 没有真实价值 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段 / 文档入口) | 第一版行为 | 未来可能的演进方向 |
|--------|--------------------------------------------------|------------|---------------------|
| `/models` policy | D1 `nano_models` + team policy filter | minimal fields + ETag | hero-to-platform 再加 admin plane |
| `/context` 操作面 | snapshot / compact endpoints | first-wave inspection + manual action | 后续更丰富 context actions |
| WS client -> server | `stream.ack / resume / permission.decision / elicitation.answer` | RH2 固化四类 | 未来可再加 richer control frames |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：WS semantic-chunk vs HTTP snapshot/read model
- **解耦原因**：流式是体验层，HTTP 是严格读模型；二者目的不同。
- **依赖边界**：RH2 只把 policy 写清，不把 HTTP 读模型和 WS 推送混成同一真相层。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：模型可见性、context inspection、WS frame taxonomy
- **聚合形式**：全部收敛到 façade + `nacp-session` 单一 schema 源
- **为什么不能分散**：否则客户端会同时面对 route drift、shape drift 与 frame drift

---

## 4. 参考实现 / 历史 precedent 对比

### 4.1 当前 WS / session schema 的做法

- **实现概要**：`nacp-session` 已有 permission / usage / elicitation / stream-event schema，但 public route 还没升级成 full RH2 目标面。
- **亮点**：
  - session body 与 stream-event 已有清晰 discriminated union
- **值得借鉴**：
  - 继续让 `packages/nacp-session` 作为 frame/body single source
- **不打算照抄的地方**：
  - 维持当前只够 ZX5 的轻量 surface

### 4.2 当前 client-facing session surface 的做法

- **实现概要**：`/start`、`/messages`、`/timeline`、`/resume` 已存在，但 `/models`、`/context` 不存在，WS 仍缺 RH2 所需双向完整面。
- **亮点**：
  - façade 已是单一 public ingress
- **值得借鉴**：
  - 继续在 orchestrator-core 统一暴露 client route
- **不打算照抄的地方**：
  - 把模型和 context 信息散落到别的 endpoint 或只靠内部 route

### 4.3 RH2 的设计倾向

- **实现概要**：严格新增 first-wave 必需的 client 能力，不超 scope。
- **亮点**：
  - 把“可见性”定义成 read model + stream 两类能力
- **值得借鉴**：
  - 轻量兼容一个 release，而不是强行一次切断
- **不打算照抄的地方**：
  - 继续保持“客户端自己猜模型 / context 状态”的现状

### 4.4 横向对比速查表

| 维度 | 当前代码 | RH2 目标 | nano-agent 倾向 |
|------|----------|----------|------------------|
| `/models` | 不存在 | D1 + team filter | 严格真实读模型 |
| `/context` | 不存在 | 可读 + 可触发 snapshot/compact | 最小 inspection 面 |
| WS frame | partial | full frame + 4 类 client message | `nacp-session` 单一真相 |
| LLM delta | partial semantic | semantic-chunk only | 明确不做 token-level |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1]** `/models` team-filtered endpoint — RH5 的模型选择前提必须在 RH2 先成立。
- **[S2]** `/sessions/{id}/context` + snapshot/compact 操作 — client inspection 必须有真实入口。
- **[S3]** WS full frame upgrade — `nacp-session` 要成为客户端的协议单一真相。
- **[S4]** semantic-chunk tool call streaming + tool result frame — 客户端必须看得到工具执行过程。
- **[S5]** heartbeat / reconnect lifecycle hardening — 协议升级不能建立在脆弱 WS 生命周期上。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1]** token-level text streaming — 已由 RH2 delta-policy 否决；重评条件：hero-to-platform
- **[O2]** 13+4+8 全量模型能力上线 — RH2 只建最小 registry/schema；重评条件：RH5
- **[O3]** image upload 与多模态执行 — 依赖 RH4 file pipeline；重评条件：RH5

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| `/models` 返回 2 个硬编码模型 | out-of-scope | 不能成为 RH5 的真实前提 | RH2 必做真实 D1 |
| WS 保留 lightweight 兼容 1 release | in-scope | 兼容策略是 RH2 的设计责任 | RH2 |
| token-level delta | out-of-scope | 明确超出 first-wave 价值 / 成本比 | hero-to-platform |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **先做 semantic-chunk 与 tool result** 而不是 **token-level text streaming**
   - **为什么**：当前 first-wave 客户端最缺的是工具执行与状态可见性，不是更细粒度文本 token。
   - **我们接受的代价**：文本 streaming 体验仍然不是最细。
   - **未来重评条件**：hero-to-platform 确认要投入 token-level stream。

2. **取舍 2**：我们选择 **`nacp-session` 作为 WS single source** 而不是 **在 façade 再发明一套兼容 shape**
   - **为什么**：协议 single source 能显著减少 client drift。
   - **我们接受的代价**：升级时必须同步改 web / wechat adapter。
   - **未来重评条件**：无。

3. **取舍 3**：我们选择 **`/models` 与 `/context` 都经 façade 暴露** 而不是 **直接暴露 leaf worker**
   - **为什么**：保持 6-worker public topology 稳定。
   - **我们接受的代价**：orchestrator-core 要承担更多 route aggregation 责任。
   - **未来重评条件**：无。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| WS 协议升级与 client adapter 脱节 | web/wechat 未同步 | RH6 manual evidence 才暴露 | RH2 同步更新客户端 adapter |
| `/context` 只是 façade stub | inspection 不接真实 seam | client 功能形同虚设 | 明确 context 真相源与操作 owner |
| heartbeat hardening 不足 | 只做 frame 形状不做 lifecycle | reconnect 行为漂移 | 把 4 个 lifecycle case 写成 RH2 必测 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：终于有稳定的 client-facing model/context/stream 契约。
- **对 nano-agent 的长期演进**：RH5/RH6 可以建立在真实的 client protocol 与 inspection 面上。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：提升上下文可见性、工具执行可见性和 WS 稳定性。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | Models Endpoint | 公开 team-filtered 模型目录 | ✅ `client 能真实列出可选模型` |
| F2 | Context Inspection Surface | 公开 context read / snapshot / compact | ✅ `client 能读写 session context 状态` |
| F3 | Full WS Upgrade | 升级到 full frame + 4 类 client message | ✅ `client 不再依赖 drift 的 WS 约定` |
| F4 | Tool Semantic Streaming | 发出 tool_use chunk 与 tool.call.result | ✅ `client 可观察工具执行过程` |

### 7.2 详细阐述

#### F1: `Models Endpoint`

- **输入**：`nano_models` 最小 registry、team policy、ETag 语义
- **输出**：`GET /models` facade envelope
- **主要调用者**：web / mini-program / CLI client
- **核心逻辑**：以 D1 为真实来源，根据 team policy 做 filter，并为客户端提供缓存友好的 ETag。
- **边界情况**：
  - unknown / disabled model 不应被暴露给 client。
- **一句话收口目标**：✅ **`/models 返回的就是当前 team 真正可用的模型清单`**

#### F2: `Context Inspection Surface`

- **输入**：sessionUuid、context inspection seam、snapshot/compact action
- **输出**：`GET /sessions/{id}/context`、`POST .../snapshot|compact`
- **主要调用者**：client context inspector、debug / evidence 脚本
- **核心逻辑**：read model 与 action surface 都经 façade 暴露，但真正的 context truth 仍留在对应层。
- **边界情况**：
  - terminal / missing session 的 context 行为必须与 session lifecycle 对齐。
- **一句话收口目标**：✅ **`client 能看见 context 状态，也能触发 first-wave context 操作`**

#### F3: `Full WS Upgrade`

- **输入**：`nacp-session` frame/body schema、WS attach/reconnect state
- **输出**：full frame server push 与四类 client -> server message
- **主要调用者**：所有 attached client
- **核心逻辑**：full frame 成为新主面，lightweight 兼容 1 release；heartbeat / replay / reconnect 规则与之同时升级。
- **边界情况**：
  - abnormal disconnect / heartbeat miss / replay-after-reconnect 必须有显式行为。
- **一句话收口目标**：✅ **`WS 协议 single source 从文档层变成运行时事实`**

#### F4: `Tool Semantic Streaming`

- **输入**：runtime tool call chunk、tool result、关联 request_uuid
- **输出**：`llm.delta` semantic chunk + `tool.call.result`
- **主要调用者**：client timeline / live renderer
- **核心逻辑**：只做 semantic 粒度，不承诺 token-level text；tool result 必须单独可见。
- **边界情况**：
  - 不同模型的 function-calling SSE 形态不同，必须做归一化。
- **一句话收口目标**：✅ **`client 能看见工具“正在做什么”和“最终结果是什么”`**

### 7.3 非功能性要求与验证策略

- **性能目标**：WS 升级不引入明显 attach/replay 回归；`/models` 支持缓存
- **可观测性要求**：frame 必须可经 `validateSessionFrame` / schema 校验
- **稳定性要求**：heartbeat / reconnect 4 大 case 必须稳定
- **安全 / 权限要求**：`/models` / `/context` 继续经 façade auth 与 session gate
- **测试覆盖要求**：新增 public endpoint ≥5 用例，WS 正反例与 lifecycle case 明确覆盖
- **验证策略**：通过 endpoint-level tests、WS frame validation、cross-worker e2e 和 preview smoke 证明 RH2 成立

---

## 8. 可借鉴的代码位置清单

### 8.1 Session schema single source

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `packages/nacp-session/src/stream-event.ts:10-95` | server push event kind taxonomy | RH2 full-frame 应直接站在此 schema 上 | current 9 kinds |
| `packages/nacp-session/src/messages.ts:53-219` | ack / heartbeat / permission / usage / elicitation body schema | RH2 client->server 四类消息与既有 schema 对齐 | current session profile |

### 8.2 Current façade surface

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `workers/orchestrator-core/src/index.ts:369-455` | 现有 façade route 总入口 | RH2 在此增加 `/models` 与 `/context*` route，而不是开新 public worker | public ingress owner |
| `workers/orchestrator-core/src/user-do.ts:1142-1180,1262-1284` | timeline/status/history/resume current read model | RH2 的 context / replay / reconnect 设计需与现有 read model 口径对齐 | current session reads |

### 8.3 Current model / vision groundwork

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `workers/agent-core/src/llm/registry/models.ts:8-18,23-58` | 模型 capability registry 结构 | RH2 `/models` 与 RH5 multi-model 都可复用此抽象 | current registry seam |
| `workers/agent-core/src/llm/request-builder.ts:33-102` | model capability + vision validation | `/models` 与 RH5 需要与 runtime capability law 对齐 | current capability guard |
