# Nano-Agent After-Foundations P3 — Context-Management Inspector Facade

> 功能簇：`packages/context-management/inspector-facade/` (子模块)
> 讨论日期：`2026-04-19`
> 讨论者：`Opus 4.7 (1M context)`
>
> 关联调查报告（B1 finding traceability — backward）：
> - `docs/spikes/spike-binding-pair/02-anchor-headers-survive-but-lowercased.md` (**binding-F02 — header lowercase contract; inspector usage report header constants**)
> - `docs/spikes/spike-binding-pair/04-eval-fanin-app-layer-dedup-required.md` (**binding-F04 — inspector facade MUST dedup messageUuid**)
> - `docs/spikes/spike-do-storage/03-kv-stale-read-not-observed-in-same-colo.md` (F03 — KV freshness for budget metric reads)
> - `docs/spikes/binding-findings.md` (rollup §3 — writeback to inspector facade)
> - `docs/issue/after-foundations/B6-writeback-eval-sink-dedup.md` (open writeback issue — sibling concern)
> - `docs/issue/after-foundations/B1-handoff-to-B2-B6.md` §B4 (this design's input contract)
>
> 上游 charter / spec / eval / 模板：
> - `docs/plan-after-foundations.md` §4.1 D 第 17 项 (inspector-facade 子模块) + §11.1 第 7 项
> - `docs/eval/after-foundations/context-management-eval-by-Opus.md` v2 §3.6 + §5.6 (inspector design source)
> - `docs/eval/after-foundations/context-management-eval-by-GPT.md` §4.6 (inspector control surface)
> - `docs/templates/design.md`
>
> 兄弟 design (P3 family):
> - `docs/design/after-foundations/PX-async-compact-lifecycle-spec.md` (lifecycle events the inspector exposes)
> - `docs/design/after-foundations/P3-context-management-async-compact.md` (event source)
> - `docs/design/after-foundations/P3-context-management-hybrid-storage.md` (metrics source)
>
> 关键 reference (existing code, **wrap don't rewrite**):
> - `packages/eval-observability/src/inspector.ts:78` (`SessionInspector` — existing live stream observer; this design wraps, doesn't rewrite)
>
> Reference (Claude Code SDK pattern):
> - `context/claude-code/entrypoints/sdk/coreSchemas.ts` `get_context_usage` (借鉴 schema shape)
>
> 文档状态：`draft`

---

## 0. 背景与前置约束

`inspector-facade/` 子模块实现 charter §4.1 D 第 17 项：**context-specific HTTP/WS endpoint + usage report schema，包装现有 `SessionInspector`，不重写**。这一设计取向直接来自 GPT review §2.4 (charter r2 修订)：之前 v1 把 inspector 写成"无"，但实际上 `eval-observability/src/inspector.ts:78` 已有 `SessionInspector`；本子模块只做 context-specific 视图层。

- **项目定位回顾**：业主 `context-management-eval-by-Opus.md` v2 §3.6 将 inspector 提出为 "nano-agent multi-worker 形态独有创新" —— 单进程 CLI agent 通常没有 live inspection endpoint。本设计以 **HTTP/WS facade + Claude Code-style usage report schema** 实现.
- **本次讨论的前置共识**：
  - **不**重写 `SessionInspector` (eval-observability 已有 9-event stream 消费层) —— 本子模块 wrap it
  - **必须**严守 binding-F02 evidence: anchor header constants 全 lowercase；usage report 中任何 header field 也必须文档化为 lowercase
  - **必须**严守 binding-F04 evidence: dedup by messageUuid 在 sink 入口 —— 本 facade 调用 `SessionInspector` 时透传 dedup 责任 (B6 writeback 已 open issue)
  - F03 evidence: 用 KV-backed budget metric read 走 same-colo strong; cross-colo stale 风险已 JSDoc 标注 (P3-hybrid-storage §6.8)
  - 业主 `context-management-eval-by-Opus.md` v2 §5.6: 用 claude-code `get_context_usage` SDK control schema 同款 + nano-agent 独有 multi-worker 字段
  - charter §4.1 D 第 17 项 + GPT review §2.3: facade 不在 NACP 协议层；走独立 HTTP/WS endpoint (避免污染 trace)
- **显式排除的讨论范围**：
  - 不重写 SessionInspector (eval-observability 中已有，由 B6 单独修订加 dedup)
  - 不讨论 async compact lifecycle (→ async-compact P3 design)
  - 不讨论 tier router 内部 (→ hybrid-storage P3 design)
  - 不讨论 NACP message family (→ P5; 本 facade 走独立 HTTP/WS)
  - 不讨论 production-grade dashboard (out-of-scope per charter §4.2)
  - 不讨论 RBAC / OAuth (本 facade 默认 dev-only; production hardening 留 worker matrix 后)

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`packages/context-management/src/inspector-facade/`
- **一句话定义**：context-specific HTTP/WS endpoint，包装现有 `SessionInspector` 提供 Claude Code-style `get_context_usage` schema + nano-agent multi-worker 独有字段；不重写 inspector primitives。
- **边界描述**：本子模块**包含**HTTP routes (`/inspect/sessions/:id/context/...`)、WS subscribe stream、usage report schema、auth (bearer + IP allowlist)、redact (secret filter)；**不包含**SessionInspector 重写、stream event capture (那是 eval-observability)、production dashboard、cross-region inspector aggregation。
- **关键术语对齐**：

| 术语 | 定义 |
|---|---|
| `Inspector facade` | 本子模块的对外 endpoint 层 |
| `Usage report` | Claude Code `get_context_usage` 同款 schema 输出 |
| `Stream subscribe` | WS 路由，订阅 SessionInspector 的 9-event canonical kinds |
| `Tag filter` | 按 ContextLayerTag (system/memory/interaction/tool_result/summary/knowledge_chunk) 过滤 |
| `Dedup pass-through` | facade 调 SessionInspector 时不自己 dedup —— 由 B6 ship 的 SessionInspector input-side dedup 处理 (binding-F04) |

### 1.2 参考调查报告

详见 frontmatter B1 findings + claude-code SDK schema reference + Opus v2 §3.6/§5.6.

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 本子模块在整体架构里的角色：**multi-worker context observability surface** —— 单进程 CLI agent 不需要，但 nano-agent multi-worker 形态需要 live inspection。
- 服务于：开发者 (debug)、运维 (incident triage)、未来产品的 inspector UI、testing harness (E2E)
- 依赖：existing `SessionInspector` (`eval-observability/src/inspector.ts:78`)、`session-do-runtime` HTTP/WS edge、tier router (metrics)、async-compact orchestrator (lifecycle state queries)
- 被谁依赖：开发者工具、未来 UI、B7 round 2 integrated spike (验证 inspector endpoint 真实可访问)

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| `packages/eval-observability/src/inspector.ts:78` (`SessionInspector`) | wraps (don't rewrite) | 强 | 只 consume 现有 stream API；dedup 由 B6 修订 SessionInspector 实现 |
| `async-compact/` (sibling) | reads state from | 强 | `getCurrentState()` API 暴露给 facade |
| `hybrid-storage/` (sibling) | reads metrics from | 中 | `TierRouter.getMetrics()` 暴露给 facade |
| `session-do-runtime` HTTP/WS edge | extends routes | 中 | facade routes mounted under `/inspect/...` prefix |
| `B6-writeback-eval-sink-dedup` issue | upstream dependency | 强 | facade 假设 SessionInspector 已 ship dedup (B6 完成); facade 自身不实现 dedup |
| `nacp-session` | independent | none | facade **不**走 NACP envelope; routes 直接 HTTP/WS (charter §4.1 D + GPT §2.3 修订) |
| `context/claude-code/entrypoints/sdk/coreSchemas.ts` | reference | 弱 | 借鉴 `get_context_usage` schema shape; not import |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`inspector-facade/` 是 **multi-worker context observability 的 HTTP/WS 表面层**——包装现有 SessionInspector + 暴露 claude-code 同款 usage schema + nano-agent 独有 multi-worker 字段，对上游消化 binding-F02/F04 contract，对下游为开发者 / 运维 / 未来 UI 提供 live inspection endpoint。

---

## 3. 子模块文件结构

```
packages/context-management/src/inspector-facade/
├── index.ts                  (re-exports + InspectorFacade class entry)
├── types.ts                  (UsageReport / LayerView / PolicyView / SnapshotMetadata types)
├── usage-report.ts           (Claude Code-style usage report builder)
├── http-route.ts             (Express-style route handlers; mounted by session-do-runtime edge)
├── ws-route.ts               (WS subscribe + tag-filter stream)
├── inspector-auth.ts         (bearer token + IP allowlist)
├── inspector-redact.ts       (secret filter; never leak API keys / sensitive payloads)
└── route-mount.ts            (helper to mount facade routes onto session-do-runtime worker entry)
```

---

## 4. HTTP/WS Endpoint Surface

### 4.1 HTTP read-only endpoints

| Method | Path | Returns | Purpose |
|---|---|---|---|
| GET | `/inspect/sessions/:sessionUuid/context/usage` | `UsageReport` (claude-code schema + multi-worker) | overall token / tier breakdown |
| GET | `/inspect/sessions/:sessionUuid/context/layers?tag=system` | `LayerView[]` filtered by tag | per-tag layer dump |
| GET | `/inspect/sessions/:sessionUuid/context/policy` | `PolicyView` (BufferPolicy + CompactPolicy) | per-session policy snapshot |
| GET | `/inspect/sessions/:sessionUuid/context/snapshots` | `SnapshotMetadata[]` (versioned history) | available rollback points |
| GET | `/inspect/sessions/:sessionUuid/context/compact-state` | `CompactStateSnapshot` | current async-compact state machine view |

### 4.2 HTTP control endpoints (cautious subset)

| Method | Path | Body | Purpose |
|---|---|---|---|
| POST | `/inspect/sessions/:sessionUuid/context/snapshot` | `{}` | force one-time snapshot capture |
| POST | `/inspect/sessions/:sessionUuid/context/compact` | `{ mode: "async" \| "sync" }` | trigger compact (manual) |
| POST | `/inspect/sessions/:sessionUuid/context/restore` | `{ snapshotId: string }` | rollback to snapshot |

### 4.3 WS subscribe

| Path | Query params | Stream content |
|---|---|---|
| `/inspect/sessions/:sessionUuid/context/stream` | `?tag=system,memory&events=ContextCompact*` | live stream of canonical 9 session.stream.event kinds + 5 new lifecycle events (per PX spec §7) |

---

## 5. `UsageReport` schema (claude-code 同款 + nano-agent 扩展)

```ts
// types.ts
export interface UsageReport {
  // === Claude Code coreSchemas.ts get_context_usage 同款 ===
  readonly totalTokens: number;
  readonly maxTokens: number;
  readonly rawMaxTokens: number;       // before any per-session override
  readonly percentage: number;          // 0-100
  readonly categories: Array<{
    readonly name: string;              // e.g. "system" / "memory" / "interaction" / ...
    readonly tokens: number;
  }>;
  readonly memoryFiles?: string[];      // memory layer doc paths (placeholder; nano-agent 不强 file-based)
  readonly mcpTools?: string[];         // MCP-related (placeholder; nano-agent 暂不 MCP)
  readonly systemTools?: string[];      // built-in tools registered
  readonly systemPromptSections?: string[];  // logical sections of system prompt

  // === nano-agent multi-worker 扩展 (Opus v2 §5.6) ===
  readonly perWorkerBreakdown?: Array<{
    readonly workerId: string;          // e.g. "agent.core", "context.core"
    readonly tokens: number;
  }>;
  readonly pendingCompactJobs: Array<{
    readonly jobId: string;
    readonly state: "armed" | "preparing" | "committing";
    readonly startedAt: string;
    readonly summarySoFarBytes?: number;
  }>;
  readonly bufferPolicy: {
    readonly hardLimitTokens: number;
    readonly softCompactTriggerPct: number;
    readonly hardCompactFallbackPct: number;
    readonly responseReserveTokens: number;
  };
  readonly versionedSnapshots: SnapshotMetadata[];
  readonly tierRouterMetrics: {
    readonly promotionsThisSession: number;     // count of size-driven DO→R2 promotions (per F08)
    readonly r2RefDereferences: number;
    readonly kvStaleReadAttempts: number;       // future: when readFresh ships per F03 follow-up
  };
}

export interface SnapshotMetadata {
  readonly snapshotId: string;
  readonly version: number;
  readonly createdAt: string;
  readonly reason: "pre-compact" | "user-explicit" | "scheduled";
  readonly sizeBytes: number;
  readonly storageRef: string;          // tier + key OR R2 ref string
}
```

### 5.1 Header naming consistency (binding-F02 evidence)

All HTTP request/response headers used by this facade **must be lowercase** in code constants. Per binding-F02:
- `x-inspector-bearer` (NOT `X-Inspector-Bearer`)
- `x-inspector-ip-allowlist-bypass` (dev-only)
- `x-nacp-trace-uuid` (forwarded if present, lowercase)

---

## 6. 关键决策与证据链

### 6.1 决策：wrap SessionInspector 而非重写 (per GPT review §2.4 修订)

**Evidence**: GPT review §2.3 / §2.4: charter v1 把 inspector 写成"无"，实际上 `eval-observability/src/inspector.ts:78` 已有 `SessionInspector` 消费 9 canonical session.stream.event kinds. charter r2 §4.1 D 第 17 项明确 "**消费** SessionInspector，不重写".

**Decision**:
- `inspector-facade/` 不 implement stream observation primitives
- 直接 import + instantiate `SessionInspector` (B6 ship 后含 dedup)
- facade 只做：HTTP/WS 暴露 + tag filter + auth + redact + claude-code-shape 化输出
- **零重复代码** with eval-observability

### 6.2 决策：dedup 由 SessionInspector 入口处理，facade 透传 (per binding-F04 + B6 issue)

**Evidence**:
- binding-F04 — service binding fetch transport 不 dedup; 应用层必须 dedup
- B6 writeback issue (`B6-writeback-eval-sink-dedup.md`) 已 open: SessionInspector input 侧加 messageUuid dedup

**Decision**:
- inspector-facade **依赖** SessionInspector 已含 dedup (B6 ship 后)
- facade 自己不实现 dedup
- 如果 B6 还没 ship 时 B4 ship 了 facade，facade JSDoc 显式标注 "duplicate events may appear until B6 lands SessionInspector dedup"
- 这是显式的 **soft dependency** with explicit ship ordering: **B6 应 ship before / 同步 with B4 facade**

### 6.3 决策：facade 走独立 HTTP/WS 路由，**不**走 NACP envelope (per GPT review §2.3 + charter §4.1 D)

**Evidence**:
- GPT §2.3: storage / context internal state 不应穿透到 NACP 协议层
- charter §4.1 D 第 17 项: inspector 是 dev tool, not agent behavior; 走 NACP 会污染 trace

**Decision**:
- routes mounted under `/inspect/...` prefix (与 session-do-runtime 现有 `/sessions/...` 路由独立)
- 不引入任何 NACP message kind 给 inspector (P5 NACP 1.2.0 不需要为 inspector 增加 message family)
- inspector traffic **不**进 trace anchor 链路 (避免 trace pollution)

### 6.4 决策：claude-code `get_context_usage` schema + nano-agent 扩展 (per Opus v2 §5.6)

**Evidence**: claude-code SDK `coreSchemas.ts` `get_context_usage` 已是行业 validated 模板; nano-agent multi-worker 形态需要扩展字段。

**Decision**: §5 schema —— 前半 Claude Code-shape 字段 (totalTokens / maxTokens / categories / memoryFiles 等)，后半 nano-agent 独有 (`perWorkerBreakdown` / `pendingCompactJobs` / `bufferPolicy` / `versionedSnapshots` / `tierRouterMetrics`)。

### 6.5 决策：F03 freshness caveat 在 budget metric 读取处文档化

**Evidence**: F03 — KV same-colo strong; cross-colo TBD.

**Decision**:
- `getMetrics()` 内部读 KV-backed budget 状态时走 `KvAdapter.get` (no special freshness)
- `usage-report.ts` 在 build 时给字段加 caveat marker: `tierRouterMetrics.note?: "kv-stale-window-not-validated-cross-colo"` (only present if running cross-colo; actual detect is B7 round 2 work)
- B7 round 2 spike 验证 cross-colo stale 后回填 fresh-read path

### 6.6 决策：Auth 默认 disabled，env flag 启用

**Evidence**: charter §4.1 D 第 17 项: dev-only by default; production hardening 留 worker matrix 后.

**Decision**:
- 默认 `INSPECTOR_FACADE_ENABLED=false`
- 生产部署绝不应用 facade routes (route mount conditionally on env flag)
- Dev/staging 启用时强制 bearer token (`INSPECTOR_BEARER_TOKEN` env)
- IP allowlist 通过 `INSPECTOR_IP_ALLOWLIST` env (CIDR list)
- secrets 永不在 usage report / stream 中泄漏 (`inspector-redact.ts` filter)

### 6.7 决策：5 lifecycle events 透过 WS stream 暴露 (per PX spec §7)

**Evidence**: PX spec §7 表 — `ContextPressure` / `ContextCompactArmed` / `ContextCompactPrepareStarted` / `ContextCompactCommitted` / `ContextCompactFailed`.

**Decision**:
- WS `/inspect/sessions/:id/context/stream` 默认 stream 9 canonical session.stream.event + 5 new lifecycle events (共 14)
- query param `?events=ContextCompact*` 支持 wildcard / explicit list filter
- query param `?tag=system,memory` filter 按 context tag
- 注意：5 lifecycle events 由 `async-compact/events.ts` emit; B5 hooks catalog expansion 注册 metadata 后 dispatcher 自动可达；本 facade 通过 SessionInspector 同款 path 接入

### 6.8 决策：route-mount.ts 让 facade 可选 mount

**Evidence**: charter §4.1 D 第 17 项 "default disabled"。

**Decision**:
- `route-mount.ts` 提供 `mountInspectorFacade(workerEntry, config)` helper
- session-do-runtime worker entry 显式调用 mount 才暴露 routes
- production worker entry 不 call mount → routes 不存在 → 攻击面为零

---

## 7. 与 charter / spike findings 对应关系

| Charter §4.1 D in-scope item | 实现位置 | Evidence |
|---|---|---|
| inspector-facade 子模块 | 本设计 §3 | charter §4.1 D 第 17 项 + r2 修订 |
| HTTP `/inspect/.../{usage,layers,policy,snapshots}` | §4.1 + http-route.ts | charter §4.1 D 第 17 项 |
| WS `/inspect/.../stream` | §4.3 + ws-route.ts | charter §4.1 D 第 17 项 |
| **包装** SessionInspector，不重写 | §6.1 + index.ts wrap | GPT §2.3/§2.4 |
| Claude Code usage schema 同款 + nano-agent 扩展 | §5 schema | Opus v2 §5.6 |
| Header constants lowercase | §5.1 + 全 code base | binding-F02 |
| Dedup pass-through (B6 dependency) | §6.2 | binding-F04 + B6 issue |
| 不走 NACP 协议层 (独立 HTTP/WS) | §6.3 | GPT §2.3 + charter §4.1 D |
| Default disabled + env flag | §6.6 | charter §4.1 D + security note |
| F03 freshness caveat | §6.5 | F03 |

---

## 8. 不在本 design 决策的事项

1. SessionInspector dedup 实现细节 → B6 issue
2. `eval.sink.overflow_drop` event candidate → P4 hooks catalog expansion 议题
3. async-compact lifecycle 实现 → P3-async-compact
4. tier router internal → P3-hybrid-storage
5. NACP 1.2.0 message families → P5 (本 facade 不需要)
6. Production-grade dashboard / Grafana / etc. → out-of-scope per charter §4.2
7. RBAC / OAuth 完整实现 → worker matrix 后
8. Cross-region inspector aggregation → after worker matrix

---

## 9. 收口标准（Exit Criteria）

本 design 的成立标准：

1. ✅ §3 文件结构 7 文件 + 责任划分清楚
2. ✅ §4 endpoints 表完整 (5 read GET + 3 control POST + 1 WS)
3. ✅ §5 UsageReport schema (claude-code 同款 + nano-agent 扩展)
4. ✅ §6 8 个关键决策每个绑定 B1 finding 或 charter 条款
5. ✅ §6.1 + §6.2 明确 wrap-don't-rewrite + dedup 透传
6. ⏳ B4 action plan 引用本 design 写出执行批次
7. ⏳ B6 SessionInspector dedup ship (前置依赖)
8. ⏳ B7 round 2 spike 验证 inspector endpoint 真实可访问 + redact 不泄密 (charter §11.1 第 7 项)

---

## 10. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；wrap-don't-rewrite SessionInspector；claude-code-shape usage report + multi-worker 扩展；8 个决策每个 cite B1 finding / GPT review / charter 条款 |
