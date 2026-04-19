# Nano-Agent After-Foundations P0 — Spike Binding-Pair Design

> 功能簇：`Spike Worker — Service Binding Pair (Round 1, two-worker)`
> 讨论日期：`2026-04-19`
> 讨论者：`Opus 4.7 (1M context)`
> 关联调查报告：
> - `docs/plan-after-foundations.md` (§2.2 V3 / §4.1 A / §7.1)
> - `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` (§3 纪律 / §4.3 4 项验证项 / §5 writeback)
> - `docs/templates/_TEMPLATE-spike-finding.md`
> - `packages/session-do-runtime/src/env.ts` (`V1_BINDING_CATALOG`、`ServiceBindingLike`)
> - `packages/session-do-runtime/src/remote-bindings.ts` (`makeRemoteBindingsComposition`)
> - `packages/session-do-runtime/src/cross-seam.ts` (`CrossSeamAnchor` / `x-nacp-trace/session/team/request/source-*` headers)
> - `packages/hooks/src/runtimes/service-binding.ts`
> - `packages/capability-runtime/src/targets/service-binding.ts`
> - `packages/eval-observability/src/inspector.ts` (live event sink baseline)
> 文档状态：`draft`

---

## 0. 背景与前置约束

`spike-binding-pair` 是 Round 1 两个 spike 之一——**两个 worker probe**，验证 service binding contract 在真实 Cloudflare 环境下的 latency / cancellation / cross-seam-anchor 传播 / hooks remote dispatch / eval sink fan-in 行为。它不验证 storage 行为（那是 `spike-do-storage` 的职责）。

> **Transport scope 显式声明（GPT review §2.3 修订）**：当前 nano-agent repo 里同时存在**两种** service-binding transport reality：
>
> 1. **Fetch-based seam**（`packages/session-do-runtime/src/remote-bindings.ts:64-77, 282`）—— 通过 `binding.fetch(new Request(...))` + JSON body + HTTP path (`/hooks/emit`, `/capability/call`, `/capability/cancel`) 调用。这是 session-do-runtime **当前 load-bearing 的 remote seam**。
> 2. **RPC handleNacp seam**（`packages/nacp-core/src/transport/service-binding.ts:5,15-16,49,62`）—— 通过 `ServiceBindingTarget.handleNacp(envelope)` 直接 RPC 调用，envelope 经过 `validateEnvelope → verifyTenantBoundary → checkAdmissibility → handleNacp` 流水线。
>
> **本 spike 的 scope**：**只验证 (1) Fetch-based seam**——因为这是 session-do-runtime 当前实际使用的路径。
>
> **本 spike 的非 scope**：**不**验证 (2) RPC handleNacp transport——它的 RPC binding shape、envelope validation 流水线、tenant boundary 行为不在 Round 1 closure 范围内。如果 worker matrix 阶段或 Phase 5 真的需要 RPC transport 的 platform 真相，必须**单独立项**第三个 spike（命名建议 `spike-rpc-transport`），不能默认本 spike 的 finding 覆盖 RPC path。
>
> **为什么这样划界**：避免 spike 结束后产生"我们已经验证过 service binding 了"的危险误解——实际上验证的只是 fetch path，不是 repo 里全部 transport path。

- **项目定位回顾**：nano-agent 的 worker matrix 阶段假设 `agent.core / bash.core / filesystem.core / context.core` 之间通过 service binding 通讯；`packages/session-do-runtime/src/remote-bindings.ts` 已经设计了 remote seam，但**从未跨真实 worker 部署验证**。
- **本次讨论的前置共识**：
  - `V1_BINDING_CATALOG` 当前只 3 项：`CAPABILITY_WORKER / HOOK_WORKER / FAKE_PROVIDER_WORKER`（`env.ts:73-77`）
  - `wrangler.jsonc` 在 packages/session-do-runtime 已声明这 3 binding，但实际跨真实 worker 部署未验证
  - `CrossSeamAnchor` 已定义 5 类 header (`x-nacp-trace/session/team/request/source-*`)，但是否被 worker runtime 完整透传未验证
  - hooks `service-binding.ts` runtime 的回调路径未跨 worker 实测
  - capability `service-binding.ts` target 的执行 latency 未跨 worker 实测
  - 严守 spike 7 条纪律
- **显式排除的讨论范围**：
  - 不讨论 storage 行为（→ `spike-do-storage`）
  - 不讨论 NACP 协议升级（→ Phase 5）
  - 不讨论 worker matrix 阶段的 4-worker 完整 fabric
  - 不讨论 production observability stack

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`spike-binding-pair`
- **一句话定义**：两个真实 Cloudflare workers（`spike-binding-A` 调用 `spike-binding-B`），通过 service binding 通讯，作为 probe 验证 §4.3 的 4 项 binding 行为。
- **边界描述**：本 spike **包含**两个 worker shell + 一对 service binding + 4 项 binding 验证；**不包含** storage 测试 / DO 沙箱测试 / fake-bash 测试 / 真实 LLM 调用 / 业务数据持有。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|---|---|---|
| **Worker A (caller)** | 发起 service binding 调用的 worker，命名 `spike-binding-A` | 类比 worker matrix 阶段的 agent.core |
| **Worker B (callee)** | 接收 service binding 调用的 worker，命名 `spike-binding-B` | 类比 worker matrix 阶段的 capability.core / hooks.core |
| **Probe call** | 从 Worker A 通过 binding 调用 Worker B 的一次操作 | latency / cancellation / header 传播 / payload size 等维度 |
| **CrossSeamAnchor headers** | 5 类 `x-nacp-*` header（trace/session/team/request/source-uuid + source-role） | `cross-seam.ts` 已定义 |
| **Binding cancellation** | Worker A 在 binding call 进行中放弃等待时 Worker B 是否被通知 | Cloudflare 平台层面行为 |

### 1.2 参考调查报告

- `P0-spike-discipline-and-validation-matrix.md` §4.3 —— 4 项 binding 验证项的来源
- Cloudflare service binding docs（finding 中按需引用）
- `packages/nacp-core/src/transport/service-binding.ts` —— 当前 binding seam 的协议层（spike 不绑架其实现，但对齐 contract）

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 本 spike 的角色：**after-foundations Round 1 的两条 truth-source 之一**（另一条是 spike-do-storage）。
- 它服务于：worker matrix 阶段所有跨 worker 通讯的设计 + Phase 5 NACP 协议升级 + Phase 4 hooks catalog 扩展中 ContextPressure / Setup / Notification 等跨 worker 触发的 hook 设计。
- 它依赖：Cloudflare service binding 在 wrangler dev / wrangler deploy 下的真实可用性。
- 它被谁依赖：`docs/handoff/next-phase-worker-naming-proposal.md` 的可信度直接由本 spike 的 finding 决定。

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| `spike-do-storage` | 同期独立 | 弱 | 不互相依赖，但共享 spike 纪律 |
| Phase 4 hooks catalog | 输出 finding → 输入 spec | 中 | V3-binding-hooks-callback 必须被 Phase 4 消化 |
| Phase 5 NACP 1.2.0 | 输出 finding → 输入 spec | 强 | V3-binding-cross-seam-anchor 决定 NACP envelope 是否需要扩 header 字段 |
| Phase 7 worker naming proposal | 输入 ← finding closure | 强 | 4 worker naming proposal 的 binding cost / latency 假设由本 spike 验证 |
| Phase 6 Round 2 integrated | 输入 ← finding closure | 强 | Round 2 必须验证所有 V3 finding 已被消化 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`spike-binding-pair` 是 after-foundations Round 1 的**两 worker service-binding contract probe**，负责对 service binding 的 latency / cancellation / cross-seam-anchor 传播 / hooks remote dispatch / eval sink fan-in 4 项行为给出 finding，对上游消化 §4.3 验证矩阵，对下游为 Phase 4-7 提供 worker matrix 阶段的跨 worker 通讯真相。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 | 砍的理由 | 未来是否可能回补 |
|---|---|---|---|
| 完整 KernelRunner 集成 | `agent-runtime-kernel` | spike 不验证 turn loop，验证 binding contract | worker matrix 阶段 agent.core 实做 |
| 真实 LLM provider 调用 | `llm-wrapper` | spike 不接 API key（纪律 5）；fake provider response 已足够 | 不在 spike |
| Storage / DO state | `workspace-context-artifacts` | 由 spike-do-storage 覆盖；本 spike 用 in-memory state | 不在 spike |
| 完整 NACP envelope validation | `nacp-core` | spike 用最小 envelope（含 5 个 header + body），不跑完整 zod 校验 | Phase 5 ship 时再上 |

### 3.2 接口精简：两个 spike worker 的最小 HTTP 表面

**Worker A (caller)：**
```
GET  /healthz
POST /probe/binding-latency-cancellation/{n}    — V3-binding-latency-cancellation
POST /probe/binding-cross-seam-anchor           — V3-binding-cross-seam-anchor
POST /probe/binding-hooks-callback              — V3-binding-hooks-callback
POST /probe/binding-eval-fanin                  — V3-binding-eval-fanin
GET  /inspect/last-run                          — debug
```

**Worker B (callee)：**
```
POST /handle/echo                               — 简单 echo（用于 latency 测试）
POST /handle/slow/{ms}                          — 强制延迟（用于 cancellation 测试）
POST /handle/header-dump                        — 返回收到的全部 headers（用于 anchor 验证）
POST /handle/hook-dispatch                      — 模拟 hook callback
POST /handle/eval-emit                          — 模拟 eval evidence emit
GET  /healthz
```

### 3.3 解耦：两个 spike worker 的最小内部结构

```
spikes/round-1-bare-metal/spike-binding-pair/
├── README.md                       # 部署顺序说明
├── worker-a/
│   ├── wrangler.jsonc              # bindings: WORKER_B service binding
│   ├── package.json                # 仅 @cloudflare/workers-types
│   └── src/
│       ├── worker.ts               # fetch handler + 4 probe routes
│       ├── probes/
│       │   ├── latency-cancellation.ts
│       │   ├── cross-seam-anchor.ts
│       │   ├── hooks-callback.ts
│       │   └── eval-fanin.ts
│       └── result-shape.ts
├── worker-b/
│   ├── wrangler.jsonc
│   ├── package.json
│   └── src/
│       ├── worker.ts               # fetch handler + handle routes
│       └── handlers/
│           ├── echo.ts
│           ├── slow.ts
│           ├── header-dump.ts
│           ├── hook-dispatch.ts
│           └── eval-emit.ts
└── scripts/
    ├── deploy-both.sh              # wrangler deploy worker-b 然后 worker-a
    ├── run-all-probes.sh
    └── extract-finding.ts
```

### 3.4 聚合：与 finding template 的对齐

`result-shape.ts`（worker-a 内）必须输出能直接喂 `_TEMPLATE-spike-finding.md` §1.2 + §6.1 的字段：

```ts
export interface BindingProbeResult {
  validationItemId: string;
  callsAttempted: number;
  callsSucceeded: number;
  callsCancelled: number;
  callsErrored: number;
  latencyMs: { p50: number; p99: number; max: number };
  headersObservedAtCallee: Record<string, string>;
  errorBreakdown: { code: string; count: number; sample: string }[];
  rawSamples: unknown[];
}
```

---

## 4. 4 项验证的具体设计

### 4.1 V3-binding-latency-cancellation

**Probe 操作**：

1. **Latency baseline**：worker-a → worker-b `/handle/echo` × 200 次（payload 1KB），统计 p50 / p99 / max
2. **Payload scaling**：1KB / 10KB / 100KB / 1MB payload 各 50 次
3. **Concurrent**：50 个并发 binding call，看是否有 backpressure / queue
4. **Cancellation**：worker-a 启动 `/handle/slow/5000`，500ms 后 abort；观察 worker-b 是否收到 cancellation 信号（用 worker-b 的日志验证）
5. **Timeout**：worker-a 不主动 abort，等 Cloudflare 默认 timeout 触发；记录 timeout 错误形态

**预期 finding 维度**：
- service binding p50 / p99 latency（vs 同一 colo 内进程间调用）
- payload size 上限触发点
- cancellation 是否传播到 callee（关键决定 async compact 的 cancellation 设计）
- 并发上限与 backpressure 行为

### 4.2 V3-binding-cross-seam-anchor

**Probe 操作**：

1. worker-a 在 binding call 时显式设置 5 个 anchor header：
   - `x-nacp-trace-uuid`
   - `x-nacp-session-uuid`
   - `x-nacp-team-uuid`
   - `x-nacp-request-uuid`
   - `x-nacp-source-uuid` + `x-nacp-source-role`
2. worker-b `/handle/header-dump` 返回收到的全部 headers
3. 测试 header value 长度上限（128 / 1024 / 8192 chars）
4. 测试 header name 大小写（service binding 是否归一化）
5. 测试有 header 与无 header 的 fallback path

**预期 finding 维度**：
- 5 个 anchor header 是否被 service binding 完整透传
- header value 是否有 size 限制
- 大小写归一化行为
- 是否需要在 worker-b 显式 re-emit header（cross-seam-anchor 链路）

### 4.3 V3-binding-hooks-callback

**Probe 操作**：

1. worker-a 模拟 main agent runtime；调用 worker-b `/handle/hook-dispatch` 模拟 hook 跨 worker 派发
2. 测试同步路径：worker-b 同步返回 hook outcome → 测量 dispatch latency
3. 测试 blocking hook：worker-b 长时间不返回（`/handle/slow/3000`）→ 测试 worker-a 的等待行为
4. 测试 fail / cancel：worker-b 抛错 → 观察 worker-a 收到的 error shape
5. 测试 5 个 anchor header 在 hook callback 路径上的传播（与 V3.2 联动）

**预期 finding 维度**：
- 跨 worker hook dispatch latency 是否能容纳 PreToolUse / PreCompact 这类 blocking hook
- hook callback 失败的错误形态是否能被 packages/hooks/src/dispatcher.ts 解释
- 与 hook 1.0.0 catalog 扩展（Phase 4）的兼容性

### 4.4 V3-binding-eval-fanin

**Probe 操作**：

1. worker-b `/handle/eval-emit` 模拟下游 worker 把 evidence 通过 binding callback emit 到 worker-a 的 sink
2. 测试 ordering：worker-b 按顺序 emit 100 条 evidence，worker-a 收到后顺序是否保持
3. 测试 dedup：worker-b 重复 emit 相同 trace_uuid + message_uuid 的 evidence，worker-a 是否需要应用层 dedup
4. 测试 fan-in：3 次模拟（连续从 worker-b 调 worker-a 的 sink endpoint）下 ordering / dedup
5. 测试 sink overflow：超过 `defaultEvalRecords` 的 `DEFAULT_SINK_MAX = 1024` 时的行为

**预期 finding 维度**：
- 跨 worker evidence emit 的 ordering 保证（service binding 可能不保证 strict order）
- dedup 是否必须应用层做
- sink overflow 的 graceful degradation
- 对 `eval-observability/src/inspector.ts` 的 live stream 假设是否成立

---

## 5. wrangler.jsonc 结构（草案）

### 5.1 worker-b 的 wrangler.jsonc

```jsonc
{
  "name": "spike-binding-pair-b",
  "main": "src/worker.ts",
  "compatibility_date": "2026-04-19",
  "vars": {
    "ENVIRONMENT": "spike-r1-bare-metal",
    "ROLE": "callee",
    "EXPIRATION_DATE": "2026-08-01"
  }
}
```

### 5.2 worker-a 的 wrangler.jsonc

```jsonc
{
  "name": "spike-binding-pair-a",
  "main": "src/worker.ts",
  "compatibility_date": "2026-04-19",
  "services": [
    { "binding": "WORKER_B", "service": "spike-binding-pair-b" }
  ],
  "vars": {
    "ENVIRONMENT": "spike-r1-bare-metal",
    "ROLE": "caller",
    "EXPIRATION_DATE": "2026-08-01"
  }
}
```

> **部署顺序**：必须先 deploy worker-b，再 deploy worker-a（service binding 引用 callee 名字）。`scripts/deploy-both.sh` 必须强制此顺序。

---

## 6. Finding 产出流程（与 spike-do-storage 同款 two-tier deliverable）

### 6.1 Per-finding docs（Tier 1）

1. 跑 `scripts/run-all-probes.sh` → 生成 `.out/YYYY-MM-DD.json`（**4 条 required BindingProbeResult** + N 条 optional `unexpected-*`）
2. 跑 `scripts/extract-finding.ts` → 为每个结果生成 `docs/spikes/spike-binding-pair/{NN}-{slug}.md` 草稿（基于 `docs/templates/_TEMPLATE-spike-finding.md`）
3. 人工补全 finding 模板的 §2 root cause / §3 package impact / §4 worker-matrix impact / §5 writeback action
4. 提交 review；通过后 commit
5. Phase 4 / 5 / 7 的 design / action plan 必须显式 reference 对应 finding ID

### 6.2 Rollup index doc（Tier 2，charter §4.1 A 第 4 项交付）

跑完所有 per-finding 后，输出 1 份 rollup：

- `docs/spikes/binding-findings.md` —— 汇总 V3-binding-* 4 项 finding

该 rollup 必须包含 P0-spike-discipline-and-validation-matrix §4.6 规定的 5 段：finding index / severity summary / writeback destination map / unresolved-dismissed summary / per-finding doc links。

> **rollup 必须显式声明 transport scope 为 "fetch-based seam only"**，避免下游 phase 误读为 "service binding 全验证"。

---

## 7. Spike 执行的边界条件

### 7.1 数据隔离

- worker name 必须以 `spike-binding-pair-` 开头
- 不接任何 KV / R2 / DO（本 spike 只测 binding，不测 storage）
- 任何 finding 中如出现 binding payload 含貌似生产数据，立即 review 是否纪律 5 被破坏

### 7.2 销毁条件

满足下面任一条件即销毁 spike-binding-pair：

- 到达 `EXPIRATION_DATE`（2026-08-01）
- Phase 6 Round 2 integrated spike 已闭合
- 全部 V3 4 条 finding（外加 unexpected finding）已 `writeback-shipped` 或 `dismissed-with-rationale`

### 7.3 Cost 约束

- spike 总成本 < $5 / 月（无 storage，仅 worker invocation cost）
- 不接 LLM API key
- 不持有任何业务数据

---

## 8. 与 plan-after-foundations charter 的对应关系

| Charter 章节 | 本 spike 对应 |
|---|---|
| §2.2 binding 4 项 (V3) | §4 全部 |
| §4.1 A 第 2 / 3 项 | spike-binding-pair 真实部署 + 4 验证项跑过 + binding-findings.md |
| §7.1 Phase 0 收口标准 | 至少 1 次 wrangler deploy 成功 + 4 项每项有 finding |
| §10.3 双向 traceability | §6 的 finding 流程强制 forward traceability；Phase 4-7 design 强制 backward traceability |
| §12.1 worker matrix 4 worker 假设 | 本 spike 的 V3-binding-latency 是判断 4 worker 拆分是否经济的真相源 |

---

## 9. 不在本文件冻结的事项

- 4 worker（agent.core / bash.core / filesystem.core / context.core）的具体 service binding catalog → handoff memo + worker matrix 阶段决定
- NACP 1.2.0 是否需要扩 header 字段 → Phase 5 design 决定
- hooks 1.0.0 是否需要新增 cross-worker-specific event → Phase 4 design 决定
- **`nacp-core/src/transport/service-binding.ts` 的 RPC `handleNacp` transport reality** → 显式 out-of-scope；如需验证应单独立项 `spike-rpc-transport`，不在本 spike 的 4 项 V3 验证范围内

---

## 10. 收口标准（Exit Criteria）

本 spike 设计的成立标准：

1. ✅ 4 个 probe endpoint 设计已对齐 §4 验证矩阵
2. ✅ 两个 worker 的 wrangler.jsonc 与部署顺序已可被 implementer 直接读取
3. ✅ 与 `_TEMPLATE-spike-finding.md` 字段对齐
4. ⏳ 实际部署后产出至少 4 条 finding（每项 ≥ 1 条）
5. ⏳ 至少 1 条 finding 触发 packages/ 文件修改或协议层调整
6. ⏳ Round 2 闭合时全部 finding 落入 `writeback-shipped` / `dismissed-with-rationale`

---

## 11. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；定义 worker-a + worker-b 双 worker shell + 4 probe 设计 + 部署顺序 |
| 2026-04-19 (r2) | Opus 4.7 | 基于 P0-reviewed-by-GPT.md §2.3 + §2.5 修订：(1) §0 新增 transport scope 显式声明（仅 fetch-based seam，handleNacp RPC 不在 scope）；(2) §6 改为 two-tier deliverable (per-finding + 1 份 rollup `binding-findings.md`)；(3) §9 显式列出 RPC transport 为 out-of-scope |
