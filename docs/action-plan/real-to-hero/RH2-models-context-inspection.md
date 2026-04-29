# Nano-Agent 行动计划 — RH2 Models & Context Inspection (含 LLM Delta Policy)

> 服务业务簇: `real-to-hero / RH2`
> 计划对象: `给真实 client 提供模型可见性、context 可见性与 full-frame WS 协议；同时落地 LLM delta streaming policy`
> 类型: `add + update + migration`
> 作者: `Owner + Opus 4.7`
> 时间: `2026-04-29`
> 文件位置:
> - `workers/orchestrator-core/src/index.ts`（路由白名单 + handler）
> - `workers/orchestrator-core/src/user-do.ts`（context inspection + WS upgrade）
> - `workers/orchestrator-core/migrations/008-models.sql`
> - `packages/nacp-session/src/{messages,stream-event,frame}.ts`
> - `workers/context-core/src/inspector-facade/**` + `workers/context-core/src/index.ts`（新增 RPC method）
> - `clients/web/**` + `clients/wechat/**`（adapter 升级）
>
> 📝 **行号引用提示**：行号基于 2026-04-29 main 分支快照；以函数名锚点为准。
>
> 📝 **业主已签字 QNA**：业主同意 Q1-Q5 Opus 路线。
> 上游前序 / closure:
> - `docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md` 完成 closure
> - `docs/charter/plan-real-to-hero.md` r2 §7.3 + §8.4
> 下游交接:
> - `docs/action-plan/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md`（image upload）
> - `docs/action-plan/real-to-hero/RH5-multi-model-multimodal-reasoning.md`（model picker 依赖 `/models`）
> 关联设计 / 调研文档:
> - `docs/design/real-to-hero/RH2-models-context-inspection.md` (主设计，含 §9 修订)
> - `docs/design/real-to-hero/RH2-llm-delta-policy.md` (策略附录)
> 冻结决策来源:
> - `docs/design/real-to-hero/RHX-qna.md`（Q1-Q5 与 RH2 无直接耦合）
> 文档状态: `draft`

---

## 0. 执行背景与目标

ZX5 把 `/start` `/messages` `/timeline` `/resume` 这些路径做成单一 façade ingress 后，client 第一次有了稳定的 session 入口；但仍缺三件 first-wave 客户端可见能力：(1) `GET /models` 不存在；(2) `GET /sessions/{id}/context` 不存在；(3) WS 协议尚未升级到 `nacp-session` full frame，且 orchestrator-core 自发的 `session.heartbeat` / `attachment_superseded` / `terminal` frame 不经 `validateSessionFrame` schema 校验。RH2 把这三件补齐，并同时落地 LLM delta streaming 政策（semantic-chunk only、token-level out-of-scope、`tool_use_stop` 改为 `tool_use_delta + tool.call.result`）。

- **本次计划解决的问题**：
  - `/models` 在 `index.ts` 路由白名单与 handler 都不存在
  - `/sessions/{id}/context` + snapshot/compact 操作面缺失
  - WS frame 升级未落地；orchestrator-core 旁路 NACP schema
  - LLM delta 协议口径未冻结
- **本次计划的直接产出**：
  - `migration 008-models.sql`：`nano_models` 表 + per-team policy 字段
  - `index.ts`：`/models`、`/sessions/{id}/context`、`/sessions/{id}/context/snapshot`、`/sessions/{id}/context/compact` 4 个路由分支
  - `nacp-session` schema：注册 `session.heartbeat` / `attachment_superseded` / `terminal` body schema
  - `user-do.ts`：full WS frame upgrade + heartbeat lifecycle hardening
  - 客户端 adapter 升级（web / wechat）
- **本计划不重新讨论的设计结论**：
  - token-level streaming out-of-scope（来源：`design RH2-llm-delta-policy §5.2 [O1]`）
  - `tool_use_stop` 不进 schema，结束语义由 `tool_use_delta` + `tool.call.result` 表达（`design RH2-llm-delta-policy §1.1`）
  - `/models` D1 是真相源；runtime capability 是执行真相（`design RH2 §3.2`）
  - lightweight WS 兼容 1 release（`design RH2 §3.2`）

---

## 1. 执行综述

### 1.1 总体执行方式

RH2 采用**先 schema 冻结 → 再 migration → 再服务端 → 末客户端**：先把 `nacp-session` 中需要新注册的 frame body 写进 schema 并配测试；migration 008 落 D1；orchestrator-core 加 4 个路由分支与 WS upgrade；最后 web/wechat adapter 同步升级。每步都保留 lightweight WS 兼容 1 release 的回退面。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | NACP Schema Freeze (P2-E) | S | semantic-chunk 政策 + heartbeat/terminal 等 frame schema 注册 | RH1 closure |
| Phase 2 | Migration 008 + Models Endpoint (P2-A) | M | `nano_models` 表 + `GET /models` | Phase 1 |
| Phase 3 | Context Inspection Surface (P2-B) | M | `GET /context` + snapshot/compact | Phase 1 |
| Phase 4 | WS Full Frame Upgrade (P2-C) | L | full frame + 4 类 client message + heartbeat hardening | Phase 1 |
| Phase 5 | Tool Semantic Streaming (P2-D) | M | `llm.delta` + `tool.call.result` 流式语义在 runtime 与 client 两层落实 | Phase 4 |
| Phase 6 | Client Adapter Sync | M | web / wechat adapter 升级到 full frame | Phase 4-5 |
| Phase 7 | E2E + Preview Smoke | S | 跨链 e2e + preview smoke | Phase 2-6 |

### 1.3 Phase 说明

1. **Phase 1**：schema 是 single source，必须先冻
2. **Phase 2**：models endpoint 是 RH5 的硬前置
3. **Phase 3**：context inspection 与 models 平行可做，但都依赖 Phase 1
4. **Phase 4**：WS upgrade 是 client visibility 的核心
5. **Phase 5**：tool streaming 在 WS upgrade 之上跑通
6. **Phase 6**：客户端必须同步，否则 visibility 失效
7. **Phase 7**：preview smoke 必须含 web + wechat-devtool

### 1.4 执行策略说明

- **执行顺序原则**：schema → 数据 → 服务端 → 客户端 → e2e
- **风险控制原则**：lightweight WS 至少兼容 1 release；新 frame schema 加 negative test
- **测试推进原则**：每个 endpoint ≥ 5 直达 case；WS 4 lifecycle scenario
- **文档同步原则**：API doc 同步更新（`docs/api/session-frame-protocol.md`）
- **回滚 / 降级原则**：full frame 失败时 client 应能 fallback 到 lightweight；server 必须保留 lightweight emit path 至少 1 release

### 1.5 影响结构图

```text
RH2 Client Visibility
├── Phase 1: Schema Freeze
│   └── packages/nacp-session/src/{messages,stream-event,frame}.ts
├── Phase 2: Models
│   ├── workers/orchestrator-core/migrations/008-models.sql
│   └── workers/orchestrator-core/src/index.ts (/models)
├── Phase 3: Context
│   └── workers/orchestrator-core/src/index.ts + user-do.ts
├── Phase 4: WS Upgrade
│   └── workers/orchestrator-core/src/user-do.ts (handleWsAttach + emitServerFrame)
├── Phase 5: Tool Streaming
│   ├── workers/agent-core/src/host/runtime-mainline.ts
│   └── packages/nacp-session/src/stream-event.ts (consumer)
├── Phase 6: Client Adapters
│   ├── clients/web/src/**
│   └── clients/wechat/src/**
└── Phase 7: E2E + Smoke
    └── docs/issue/real-to-hero/RH2-evidence.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope

- **[S1]** `nacp-session` schema 拆为三类不同工作量：
  1. **`session.heartbeat`**：body schema 与 frame discriminator **均已存在**（`messages.ts:60-64` + `messages.ts:209` + `type-direction-matrix.ts`）；本 phase 仅 (a) 把 orchestrator-core 自发的 heartbeat 走 `validateSessionFrame`、(b) 加 negative test
  2. **terminal**：明确**复用现有 `session.end` message type**（`frame-compat.ts:95-105` 已映射 lightweight `terminal` → `session.end`），不新增 `session.terminal`
  3. **`session.attachment.superseded`**：**新增** body schema + 注册到 `SESSION_BODY_SCHEMAS` / `SESSION_BODY_REQUIRED` / `SESSION_MESSAGE_TYPES` / `type-direction-matrix.ts`；同步更新 `frame-compat.ts` 把 lightweight `attachment_superseded` 映射到新 message type
- **[S2]** `migration 008-models.sql` + `GET /models` team-filtered 路由 + handler + ETag
- **[S3]** `GET /sessions/{id}/context` + `POST /sessions/{id}/context/snapshot` + `POST /sessions/{id}/context/compact`
- **[S4]** `user-do.ts` `emitServerFrame` 与 `handleWsAttach` 全部经 `validateSessionFrame` 校验
- **[S5]** WS client → server 4 类消息（`stream.ack` / `resume` / `permission.decision` / `elicitation.answer`）schema 与 ingress
- **[S6]** Heartbeat lifecycle 4 scenario（abnormal disconnect / heartbeat miss / replay-after-reconnect / attachment supersede）
- **[S7]** Tool semantic-chunk + `tool.call.result` 在 runtime mainline → WS frame 全链
- **[S8]** web + wechat adapter 升级到 full frame，保留 lightweight fallback 1 release
- **[S9]** LLM delta policy 落到 `docs/api/llm-delta-policy.md`

### 2.2 Out-of-Scope

- **[O1]** Token-level text streaming（hero-to-platform）
- **[O2]** 13+4+8 全模型上线（RH5）
- **[O3]** image_url 真实执行（RH5）
- **[O4]** Provider raw SSE 透传（无）

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| `/models` 返回硬编码 2 模型 | out-of-scope | charter 要求 D1 真相源 | 无 |
| `tool_use_stop` 进 schema | out-of-scope | 已选方案 B（`tool_use_delta + tool.call.result`）| 无 |
| WS lightweight 完全切断 | out-of-scope | 必须兼容 1 release | RH3 完成后 |
| 提前做 model_id ingress | out-of-scope | RH5 | 无 |

---

## 3. 业务工作总表

| 编号 | Phase | 工作项 | 类型 | 涉及文件 | 目标 | 风险 |
|------|-------|--------|------|----------|------|------|
| P2-01a | 1 | NACP heartbeat schema 复用 | audit-only | `nacp-session/src/messages.ts:60-64` 已有 + `type-direction-matrix.ts` 已注册 | 仅加 negative test + orchestrator-core emit 走 validateSessionFrame | low |
| P2-01b | 1 | terminal 复用 session.end | audit-only | `frame-compat.ts:95-105` 已映射 | lightweight `terminal` → `session.end`；不新增 `session.terminal` | low |
| P2-01c | 1 | NACP `session.attachment.superseded` 新增 | add | `nacp-session/src/messages.ts` + `frame.ts` + `type-direction-matrix.ts` + `frame-compat.ts` | 新 body schema + discriminator + 兼容映射 | medium |
| P2-02 | 1 | LLM delta policy doc | add | `docs/api/llm-delta-policy.md` | 政策落档 | low |
| P2-03 | 2 | migration 008 | add | `orchestrator-core/migrations/008-models.sql` | `nano_models` 表 + policy 字段 | medium |
| P2-04 | 2 | `/models` route + handler | add | `orchestrator-core/src/index.ts` + `user-do.ts` | endpoint 200 + ETag + team filter | medium |
| P2-05 | 3 | `/sessions/{id}/context` GET | add | `index.ts` + `user-do.ts` | context inspection | medium |
| P2-06 | 3 | `/sessions/{id}/context/snapshot` POST | add | 同上 | snapshot 触发 | medium |
| P2-07 | 3 | `/sessions/{id}/context/compact` POST | add | 同上 | compact 触发 | medium |
| P2-08 | 4 | emitServerFrame 走 validateSessionFrame | update | `user-do.ts:1196-1212` | NACP schema 校验 | high |
| P2-09 | 4 | handleWsAttach 升级到 full frame | update | `user-do.ts:1905-1981` | 4 lifecycle scenario | high |
| P2-10 | 4 | client → server 4 类消息 ingress | add | `user-do.ts` + `nacp-session/messages.ts` | stream.ack/resume/permission/elicitation | medium |
| P2-11 | 4 | heartbeat lifecycle hardening | update | `user-do.ts` + DO alarm | abnormal disconnect 等 4 case | medium |
| P2-12 | 5 | runtime tool semantic chunk emit | update | `agent-core/runtime-mainline.ts:148-187` | `llm.delta tool_use_*` + `tool.call.result` | medium |
| P2-13 | 5 | NormalizedLLMEvent 与 WS frame 对齐 | update | `agent-core/runtime-mainline.ts` + `nacp-session/stream-event.ts` | 消除两层归一化 drift | medium |
| P2-14 | 6 | web adapter 升级 | update | `clients/web/src/**` | full frame 渲染 + tool timeline | medium |
| P2-15 | 6 | wechat adapter 升级 | update | `clients/wechat/src/**` | 同上 | medium |
| P2-16 | 7 | endpoint test ≥5 case × 4 endpoint | add | test files | 20 case 全绿 | low |
| P2-17 | 7 | WS lifecycle e2e | add | `test/cross-e2e/ws-lifecycle.e2e.test.ts` | 4 scenario 各 1 | medium |
| P2-18 | 7 | preview smoke + 归档 | manual | `docs/issue/real-to-hero/RH2-evidence.md` | web + wechat-devtool 各 1 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — NACP Schema Freeze

| 编号 | 工作项 | 工作内容 | 涉及文件 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|----------|----------|----------|----------|
| P2-01a | heartbeat 复用 | `SessionHeartbeatBodySchema` 与 `session.heartbeat` discriminator 均已注册（messages.ts:60-64 + 209 + type-direction-matrix）；本 phase 不新增；仅给 orchestrator-core 自发的 heartbeat 走 `validateSessionFrame` 校验 + 加 negative test | `messages.ts`（read-only check）+ `user-do.ts` emit 路径 | heartbeat 经 schema 校验 | schema test + negative case | heartbeat ≥1 negative case；orchestrator-core emit 0 schema bypass |
| P2-01b | terminal 复用 session.end | 不新增 `session.terminal`；保留 `frame-compat.ts:95-105` 的 lightweight `terminal` → `session.end` 映射；docs 显式说明 | `frame-compat.ts`（read-only check）+ `docs/api/session-frame-protocol.md` | docs 写明 | docs review | API doc 含此决议 |
| P2-01c | attachment.superseded 新增 | 在 `messages.ts` 新增 `SessionAttachmentSupersededBodySchema`；注册到 `SESSION_BODY_SCHEMAS` / `SESSION_BODY_REQUIRED` / `SESSION_MESSAGE_TYPES` / `type-direction-matrix.ts`；更新 `frame-compat.ts` 让 lightweight `attachment_superseded` 映射到新 message type | `messages.ts` + `frame.ts` + `type-direction-matrix.ts` + `frame-compat.ts` | 新 schema + 双向兼容 | schema test + negative case + lightweight↔NACP 双向 round-trip | ≥3 case |
| P2-02 | LLM delta policy doc | 把 `RH2-llm-delta-policy.md` §1.1 / §5 / §6 的口径落到 API doc | `docs/api/llm-delta-policy.md` | 公共可读 | 文档 review | 文档 ≥ 2KB，含 `tool_use_stop` 决议说明 |

### 4.2 Phase 2 — Models Endpoint

| 编号 | 工作项 | 工作内容 | 涉及文件 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|----------|----------|----------|----------|
| P2-03 | migration 008 | DDL：`nano_models(model_id PK, family, is_reasoning, is_vision, context_window, ...)` + `nano_team_model_policy(team_uuid, model_id, allowed)`；seed 当前 2 个 Workers AI 模型 | `migrations/008-models.sql` | D1 表存在 | `wrangler d1 migrations apply` 全绿 | 表 + 至少 2 行 seed |
| P2-04 | `/models` | route + handler：D1 query + team policy filter + ETag (sha256(json))；返回 `{models: [{model_id, family, capabilities, context_window}]}` | `index.ts` route 白名单 + `user-do.ts` 或独立 handler | 200 with ETag | endpoint test ≥5（401, 200, ETag 304, team filter, empty team policy）| 5 case 全绿 |

### 4.3 Phase 3 — Context Inspection

| 编号 | 工作项 | 工作内容 | 涉及文件 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|----------|----------|----------|----------|
| P2-05 | GET /context | (1) **先在 context-core 新增 RPC method `getContextSnapshot(sessionUuid, teamUuid)`**（当前 inspector facade 是 library 层，没暴露此 RPC）；(2) `orchestrator-core` 通过现有 `CONTEXT_CORE` service binding 调；(3) 返回 `{session_uuid, status, summary, artifacts_count, need_compact}` | `context-core/src/index.ts` 新增 RPC + `inspector-facade/index.ts` 内部实现 + `orchestrator-core/src/index.ts` route + `user-do.ts` handler | 200 with shape | endpoint test ≥5 | 5 case 全绿；context-core RPC unit test ≥3 |
| P2-06 | POST /context/snapshot | 同 P2-05 模式：context-core 新增 `triggerContextSnapshot(sessionUuid, teamUuid)` RPC；orchestrator-core 调用 | 同上 | 200 with `{snapshot_id, created_at}` | endpoint test ≥5 | 同上 |
| P2-07 | POST /context/compact | context-core 新增 `triggerCompact(sessionUuid, teamUuid)` RPC（**不**直接复用 ZX4 P5 内部 compact path：那是 library 调用，没经 RPC + auth gate）；orchestrator-core 调用 | 同上 | 200 with `{compacted, before_size, after_size}` | endpoint test ≥5 | 同上 |

### 4.4 Phase 4 — WS Full Frame Upgrade

| 编号 | 工作项 | 工作内容 | 涉及文件 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|----------|----------|----------|----------|
| P2-08 | emitServerFrame schema | 让 emitServerFrame 在发出前调 `validateSessionFrame(frame)`；如果 frame 不符 schema → throw + log error，不允许 silent drop | `user-do.ts:1196-1212` | 所有 server emit 都通过 schema | unit test：构造非法 frame 验证 throw | 非法 frame throw；合法不破 |
| P2-09 | handleWsAttach 升级 | attach handshake 改为 full NACP frame；保留 lightweight 兼容；replay-after-reconnect 用 `last_seen_seq` | `user-do.ts:1905-1981` | full frame 是新主面，lightweight 可识别 | WS lifecycle e2e | 4 lifecycle scenario 全绿 |
| P2-10 | client → server 4 类 | `stream.ack` / `resume` / `permission.decision` / `elicitation.answer` body schema + ingress；与 RH1 P1-03/04 配合 | `nacp-session/messages.ts` + `user-do.ts` ingress | 4 类消息可被解析 | unit + e2e | 4 类各 ≥1 e2e 用例 |
| P2-11 | heartbeat lifecycle | DO alarm 调 `emitServerFrame({kind:'session.heartbeat'})` 周期；client miss N 次后 `attachment_superseded` 或 `terminal` | `user-do.ts` + DO alarm | abnormal disconnect / miss / replay-after-reconnect / supersede 4 case 行为正确 | WS lifecycle e2e | 4 case 全绿 |

### 4.5 Phase 5 — Tool Semantic Streaming

| 编号 | 工作项 | 工作内容 | 涉及文件 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|----------|----------|----------|----------|
| P2-12 | runtime emit semantic chunk | runtime-mainline `delta`/`tool_call`/`finish` 事件转换为 `llm.delta {content_type ∈ tool_use_start | tool_use_delta}` + 独立 `tool.call.result` frame；不引入 `tool_use_stop` | `runtime-mainline.ts:148-187` + `nacp-session/stream-event.ts` consumer | tool 执行可见 | runtime unit + cross-worker e2e | tool round-trip 时 client 收 ≥1 `tool_use_start` + ≥1 `tool_use_delta` + 1 `tool.call.result` |
| P2-13 | 两层归一化对齐 | 消除 `LlmChunk` 与 `NormalizedLLMEvent` 在 frame body shape 上的 drift（GLM R10）；在 runtime-mainline 出口处统一 frame 形态 | 同上 | 单一 source frame body | schema test | frame body 通过 `validateSessionFrame` |

### 4.6 Phase 6 — Client Adapter Sync

| 编号 | 工作项 | 工作内容 | 涉及文件 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|----------|----------|----------|----------|
| P2-14 | web adapter | 新增 full frame parser；tool timeline 渲染 `tool_use_start/delta/result`；保留 lightweight fallback；调 `/models` 与 `/context`；**实施前先 audit `clients/web/` 现有 React 应用代码量与 WS adapter 复杂度**（当前为完整 React app；工作量可能 = M-L 而非原估 S-M）| `clients/web/src/**` | 浏览器看到 tool 执行过程 | manual + jest | preview smoke：web 浏览器内看见 tool stream |
| P2-15 | wechat adapter | 同 web，对 mini-program runtime 做 fallback：image 渲染推迟到 RH5；先做 text/tool stream；**实施前先 audit `clients/wechat-miniprogram/` 现有代码与 mini-program WS API 兼容性**；不支持的 API 直接降级到 lightweight | `clients/wechat-miniprogram/src/**` | wechat-devtool 内看到 tool 执行 | manual | preview smoke：wechat-devtool 看见 tool stream |

### 4.7 Phase 7 — E2E + Preview Smoke

| 编号 | 工作项 | 工作内容 | 涉及文件 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|----------|----------|----------|----------|
| P2-16 | endpoint test ≥5×4 | 4 个 endpoint × 5 case | test files | 20 case 全绿 | jest | 全绿 |
| P2-17 | WS lifecycle e2e | 4 scenario | `ws-lifecycle.e2e.test.ts` | 4 case | miniflare | 4 case 全绿 |
| P2-18 | preview smoke | preview deploy → web + wechat-devtool 各 1 完整 chat session（含 tool 调用） | `docs/issue/real-to-hero/RH2-evidence.md` | 2 端 evidence 截图 | manual | 文档 ≥1KB |

---

## 5. Phase 详情

### 5.1 Phase 1 — NACP Schema Freeze

- **核心目标**：schema single source 不再有 drift
- **新增文件**：`docs/api/llm-delta-policy.md`
- **修改文件**：`nacp-session/src/{messages,frame}.ts`
- **测试**：schema unit + negative case ≥6 各
- **收口**：`validateSessionFrame` 对 3 个新 frame 通过

### 5.2 Phase 2 — Models Endpoint

- **核心目标**：D1 真相源 + ETag 缓存
- **新增**：`migration 008`、route 与 handler
- **测试**：endpoint ≥5 case
- **收口**：5 case 全绿

### 5.3 Phase 3 — Context Inspection

- **核心目标**：3 个 context endpoint
- **测试**：每 endpoint ≥5
- **风险**：context-core inspector facade 可能要补 RPC method；如有缺，列入本 phase scope

### 5.4 Phase 4 — WS Full Frame Upgrade

- **核心目标**：协议 single source 落地；orchestrator-core 不再 bypass schema
- **风险**：WS lifecycle 4 case 是 RH2 最大风险面；preview deploy 后必须真 client 复测
- **回滚**：lightweight 兼容路径必须保留至 RH3 完成

### 5.5 Phase 5 — Tool Semantic Streaming

- **核心目标**：tool 执行过程可见
- **测试**：cross-worker e2e

### 5.6 Phase 6 — Client Adapter Sync

- **核心目标**：客户端能消费 full frame
- **风险**：wechat mini-program 兼容性；先 fallback lightweight，full frame 失败不阻塞业务

### 5.7 Phase 7 — E2E + Preview Smoke

- **核心目标**：4 个 endpoint + WS lifecycle 4 + 2 端 evidence 全收口

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 | 来源 | 影响 | 不成立处理 |
|------|------|------|------------|
| token-level out-of-scope | `RH2-llm-delta-policy §5.2` | Phase 1 / 5 不引入 token-level frame | 推翻则重设 streaming 协议 |
| `tool_use_stop` 不进 schema | `RH2-llm-delta-policy §1.1` | Phase 1 schema 不加 stop 枚举 | 推翻则需 schema migration |
| migration 008 = `nano_models`，**不**含 team_name/team_slug | `charter §1.2` migration allocation rule（per R2 review）| Phase 2 migration 008 内不写 team display 列；team display 列在 RH3 migration 009 | 推翻则 RH2/RH3 并发风险 |
| WS lightweight 兼容 1 release | `design RH2 §3.2` | Phase 4 / 6 同时保留 fallback | 推翻则需硬切协议 |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 | 描述 | 判断 | 应对 |
|------|------|------|------|
| WS heartbeat 4 case 误差 | DO alarm 与 client miss 检测的时间窗口设置不当导致误杀 | high | 单独 design tuning + e2e 4 scenario gate |
| context-core inspector facade RPC 缺失 | snapshot/compact/getContextSnapshot 三个 RPC 当前未暴露 | high | Phase 3 必含 context-core PR：新增 3 个 RPC method + RPC unit test ≥3 |
| client adapter wechat 兼容差 | mini-program runtime 不支持某些 WS API | medium | lightweight fallback 兜底 |
| schema 注册影响 ZX4/ZX5 既有 frame parsing | 新增 discriminator 可能影响旧 client | medium | negative test 全跑；版本 bump |

### 7.2 约束与前提

- **技术前提**：RH1 closure；`forwardServerFrameToClient` RPC 可用
- **运行时前提**：D1 schema 008 部署；context-core RPC 可用
- **组织协作前提**：业主在 Phase 7 提供 web + wechat-devtool evidence

### 7.3 文档同步要求

- `docs/api/session-frame-protocol.md`（新建或更新）
- `docs/api/llm-delta-policy.md`
- `docs/api/models-endpoint.md`

### 7.4 完成后预期状态

1. `/models`、`/sessions/{id}/context*` 4 个新 endpoint 都 200，含 ETag
2. WS 协议 single source 真实成立；orchestrator-core 与 agent-core 双侧都过 NACP schema
3. tool 执行在客户端可见
4. web + wechat-devtool 在 preview 真实可用
5. RH3/RH5 可基于 RH2 closure 启动

---

## 8. 整体测试与收口

### 8.1 整体测试

- **基础**：6 worker dry-run + RH0/RH1 既有测试不回归
- **单测**：schema 6+；handler 4×5；emit/attach/lifecycle 单测
- **集成**：WS lifecycle 4 e2e；tool stream 1 e2e
- **端到端**：preview deploy + web/wechat-devtool 各 1 chat session
- **文档**：`RH2-evidence.md` ≥1KB

### 8.2 整体收口

1. NACP schema 含 3 个新 body 且全部经 `validateSessionFrame`
2. migration 008 落 D1，`/models` 5 case 全绿 + ETag 304 验证
3. `/sessions/{id}/context*` 3 endpoint 各 5 case 全绿
4. WS full frame 上线 + lightweight 兼容；4 lifecycle scenario 全绿
5. tool semantic chunk + result 在 cross-worker e2e 可见
6. web + wechat-devtool preview evidence 归档
7. RH3 / RH5 Per-Phase Entry Gate 满足

### 8.3 DoD

| 维度 | 完成定义 |
|------|----------|
| 功能 | 4 endpoint + WS upgrade + tool stream live |
| 测试 | 20 endpoint case + 4 WS e2e + tool e2e 全绿 |
| 文档 | API doc 3 份；RH2 design §9 状态 update |
| 风险收敛 | WS lifecycle 4 scenario 0 误杀；schema 0 drift |
| 可交付性 | 客户端在 preview 真可用 |
