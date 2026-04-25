# Z2 — Session Truth and Audit Baseline

> 服务业务簇: `zero-to-real / Z2 / session-truth-and-audit-baseline`
> 计划对象: `把 session / message / context / activity truth 从 in-memory façade 提升为 D1 + DO + audit baseline`
> 类型: `migration`
> 作者: `GPT-5.4`
> 时间: `2026-04-25`
> 文件位置: `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md`
> 关联设计 / 调研文档:
> - `docs/charter/plan-zero-to-real.md`
> - `docs/design/zero-to-real/Z2-session-truth-and-audit-baseline.md`
> - `docs/design/zero-to-real/ZX-qna.md`
> - `docs/design/zero-to-real/ZX-binding-boundary-and-rpc-rollout.md`
> - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`
> - `docs/design/zero-to-real/ZX-nacp-realization-track.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

Z1 解决“谁能以真实身份进入系统”，Z2 解决“进入之后，真实 session truth 存在哪里、如何恢复、如何审计”。当前 `workers/orchestrator-core/` 已有 public façade 与 `user-do.ts`，`workers/agent-core/` 已有 session/runtime skeleton 与 `NanoSessionDO`。但这些能力仍主要围绕 preview façade、timeline/status、in-memory or transient state 组织，尚未建立 zero-to-real 所要求的 D1 truth、append-only activity log、DO hot-state 边界与 replay/heartbeat baseline。

因此 Z2 的目标不是简单“补一张会话表”，而是让 session lifecycle、turn/message transcript、context snapshot pointers、activity/audit evidence 与 reconnect/replay truth 都拥有明确 owner：**D1 管 durable truth，DO 管 hot-state，NACP envelope 管 authority/trace，orchestrator façade 管对外兼容 surface**。

- **服务业务簇**：`zero-to-real / Z2`
- **计划对象**：`Session Truth and Audit Baseline`
- **本次计划解决的问题**：
  - 当前 session lifecycle 与 transcript 没有 first-wave D1 durable truth
  - `nano_session_activity_logs` append-only 审计面未真实落地
  - DO hot-state 4 组最小集合与 `every 10m + alarm` snapshot 约束尚未成为 runtime reality
  - `status` / `start` 的 internal RPC-first 路径尚未开始替代 ad-hoc internal surface
- **本次计划的直接产出**：
  - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql`
  - `workers/orchestrator-core/src/index.ts` `src/user-do.ts` 的 D1 truth / replay / audit wiring
  - `workers/agent-core/src/host/**` 的 internal `status` smoke 与 `start` kickoff
  - `docs/issue/zero-to-real/Z2-closure.md`

---

## 1. 执行综述

### 1.1 总体执行方式

采用 **先建 Wave B schema，再把 orchestrator façade 写入 durable truth，再提升 DO hot-state 与 replay/heartbeat，最后接 internal RPC kickoff 和 audit closure** 的顺序推进。Z2 的中心不是新 UI，而是把“真实 session 发生了什么”这件事固定到一套可审计、可恢复、可回放的 runtime truth。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Wave B Schema | `M` | 落 `nano_conversations / nano_conversation_sessions / nano_conversation_turns / nano_conversation_messages / nano_conversation_context_snapshots / nano_session_activity_logs` 及索引 | `Z1 closed` |
| Phase 2 | Public Session Durable Truth | `L` | `start / input / history / timeline / verify` 写入并读取 D1 truth | `Phase 1` |
| Phase 3 | DO Hot-State + Replay | `L` | 固定 4 组 DO hot-state、`10m + alarm` snapshot、heartbeat/replay baseline | `Phase 2` |
| Phase 4 | RPC Kickoff | `M` | 先把 internal `status` 做成 smoke，再让 `start` 走 RPC-first seam | `Phase 3` |
| Phase 5 | Audit Closure | `S` | 用 package-e2e / cross-e2e / activity evidence 证明 Z2 收口 | `Phase 4` |

### 1.3 Phase 说明

1. **Phase 1 — Wave B Schema**
   - **核心目标**：建立 session truth 的 durable 表结构与索引。
   - **为什么先做**：不先建表，后续 replay/activity 都只能继续漂在 memory/local state。
2. **Phase 2 — Public Session Durable Truth**
   - **核心目标**：让 orchestrator façade 的 first-wave session routes 从 façade 变成真正的 durable owner。
   - **为什么放在这里**：对外兼容 surface 是最先被 web / mini-program 消费的入口。
3. **Phase 3 — DO Hot-State + Replay**
   - **核心目标**：把 DO 状态压到 design 冻结的 4 组最小集合，并建立 hibernation-safe snapshot/replay。
   - **为什么放在这里**：持久化真相先落地，再优化 hot-state 和恢复链路。
4. **Phase 4 — RPC Kickoff**
   - **核心目标**：开始把 internal `status` / `start` 从 HTTP-ish glue 推向 WorkerEntrypoint RPC-first。
   - **为什么放在这里**：要在 truth 已稳定后再收紧内部 transport。
5. **Phase 5 — Audit Closure**
   - **核心目标**：用 activity logs、timeline、replay 和现有 tests 证明 Z2 是真实 runtime baseline，不是文档宣称。
   - **为什么放在最后**：没有 replay 与 activity evidence，closure 不成立。

### 1.4 执行策略说明

- **执行顺序原则**：`先 D1 truth，再 façade 持久化，再 DO hot-state，再 RPC kickoff，再 closure`
- **风险控制原则**：`D1 只管 durable truth；DO 只保留最小 hot-state，不再继续堆业务永久状态`
- **测试推进原则**：`优先复用 orchestrator-core package-e2e 与现有 cross-e2e；新增 replay/activity coverage`
- **文档同步原则**：`Q5/Q6/Q7 + ZX-D1 + ZX-NACP + ZX-binding 必须一起消费`

### 1.5 本次 action-plan 影响目录树

```text
Z2 Session Truth and Audit Baseline
├── workers/
│   ├── orchestrator-core/
│   │   ├── src/index.ts
│   │   ├── src/user-do.ts
│   │   ├── src/policy/authority.ts
│   │   └── migrations/
│   │       └── 002-session-truth-and-audit.sql   [new]
│   └── agent-core/
│       └── src/host/
│           ├── internal.ts
│           ├── routes.ts
│           ├── session-edge.ts
│           ├── ws-controller.ts
│           ├── checkpoint.ts
│           └── do/nano-session-do.ts
├── test/
│   ├── package-e2e/orchestrator-core/
│   └── cross-e2e/
└── docs/issue/zero-to-real/Z2-closure.md         [new]
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 落 Wave B D1 schema：`nano_conversations / nano_conversation_sessions / nano_conversation_turns / nano_conversation_messages / nano_conversation_context_snapshots / nano_session_activity_logs`
- **[S2]** 让 `orchestration.core` 的 `start/input/history/timeline/verify` 消费 durable truth
- **[S3]** 实现 Q6 冻结的 DO hot-state 4 组最小集合与 `every 10m + alarm` checkpoint
- **[S4]** 建立 heartbeat / replay cursor / reconnect 的 first-wave truth
- **[S5]** 启动 internal `status` RPC smoke，并让 `start` 开始走 RPC-first seam
- **[S6]** append-only `nano_session_activity_logs` 与 redaction discipline 落地

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** real Workers AI provider 与 quota gate
- **[O2]** 完整 client UI 与真机链路
- **[O3]** 丰富的 admin analytics / BI query layer
- **[O4]** HTTP public surface 的全面退役

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| internal `status` RPC smoke | `in-scope` | Q7 已冻结：Z2 可以用 `status` 做 kickoff smoke | `Z2 执行期` |
| internal `start` RPC parity | `in-scope` | ZX-binding 已把 RPC kickoff 定为 Z2 范围 | `Z2 执行期` |
| follow-up 全面 RPC 化 | `out-of-scope` | Z2 只要求 kickoff，不要求一次性全切完 | `Z3/Z4 期间` |
| activity log query/index plane | `out-of-scope` | Z2 只落 append-only truth，不做重 analytics | `后续运维阶段` |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | wave-B migrations | `add` | `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql` `workers/orchestrator-core/wrangler.jsonc` `workers/agent-core/wrangler.jsonc` | 把 conversation/session durable truth 与 shared D1 bindings 建出来 | `high` |
| P2-01 | Phase 2 | public session persistence | `update` | `workers/orchestrator-core/src/index.ts` | façade 真正读写 D1 session truth | `high` |
| P2-02 | Phase 2 | activity log append path | `update` | `workers/orchestrator-core/src/index.ts` `src/policy/authority.ts` | 把审计日志做成 append-only 主路径 | `medium` |
| P3-01 | Phase 3 | DO hot-state compaction | `update` | `workers/orchestrator-core/src/user-do.ts` `workers/agent-core/src/host/do/nano-session-do.ts` | 把 DO state 收敛到 4 组最小集合 | `high` |
| P3-02 | Phase 3 | replay / heartbeat baseline | `update` | `workers/orchestrator-core/src/user-do.ts` `workers/agent-core/src/host/ws-controller.ts` | 让 reconnect / replay / heartbeat 可恢复 | `high` |
| P4-01 | Phase 4 | internal status RPC smoke | `update` | `workers/agent-core/src/host/internal.ts` `workers/orchestrator-core/src/index.ts` | 先把 `status` 做成 RPC-first smoke | `medium` |
| P4-02 | Phase 4 | internal start kickoff | `update` | `workers/agent-core/src/host/internal.ts` `session-edge.ts` | 让 `start` 开始走 RPC-first seam | `high` |
| P5-01 | Phase 5 | replay/activity tests | `update` | `test/package-e2e/orchestrator-core/**` `test/cross-e2e/**` | 证明 durable truth / replay / activity 成立 | `medium` |
| P5-02 | Phase 5 | Z2 closure | `add` | `docs/issue/zero-to-real/Z2-closure.md` | 形成 Z2 runtime truth 证明 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Wave B Schema

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | wave-B migrations | 依据 ZX-D1 逐表落 `nano_conversations / nano_conversation_sessions / nano_conversation_turns / nano_conversation_messages / nano_conversation_context_snapshots / nano_session_activity_logs`，并把 activity log 的 12 列、3 条强制 index、append-only discipline 与 `packages/nacp-session/src/redaction.ts` 写入侧约束一并固定 | `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql` `workers/orchestrator-core/wrangler.jsonc` `workers/agent-core/wrangler.jsonc` | Z2 durable truth 有真实 D1 落点 | migration smoke / schema review | tables、foreign keys、indexes、enum discipline 完整存在；`NANO_AGENT_DB` 在 orchestrator-core/agent-core 上显式绑定 |

### 4.2 Phase 2 — Public Session Durable Truth

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | public session persistence | 让 `start/input/history/timeline/verify` 把 conversation/session truth 落到 D1；若用户无 active conversation，则先建 `nano_conversations` 再建 `nano_conversation_sessions` | `workers/orchestrator-core/src/index.ts` | public session façade 具备 durable owner 身份 | package-e2e / cross-e2e | `history/timeline/verify` 不再只看 transient state；conversation 成为上位聚合中心 |
| P2-02 | activity log append path | 把 auth/session/tool/context 关键事件写入 `nano_session_activity_logs`，并执行 redaction discipline | `workers/orchestrator-core/src/index.ts` `src/policy/authority.ts` | 可追溯 activity truth 建立 | package-e2e / D1 row assertions | activity log 只 append、不 overwrite、敏感字段被 redact |

### 4.3 Phase 3 — DO Hot-State + Replay

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | DO hot-state compaction | 审计当前 `state.storage` keys 的命运，并把 DO 收敛到四组冻结热态：`conversation_index`、`active_pointers`、`recent_replay_window`、`short-lived caches` | `workers/orchestrator-core/src/user-do.ts` `workers/agent-core/src/host/do/nano-session-do.ts` | hot-state 与 Q6 冻结答案一致 | package-e2e / state assertions | `conversation_index<=200`、`recent_frames<=50/session`、`cache TTL<=5m`，且清空 DO storage 后可从 D1 重建 |
| P3-02 | replay / heartbeat baseline | 建 replay cursor、heartbeat ack、`every 10m + alarm` snapshot/recover path，并把 alarm 职责固定为 trim/expire/refresh | `user-do.ts` `ws-controller.ts` `checkpoint.ts` | reconnect / hibernation 恢复可证明 | package-e2e / cross-e2e | reconnect 后 history/replay 可继续，alarm 恢复不丢主状态；cursor>1h 过期，recent frames 超限后可回落 D1 |

### 4.4 Phase 4 — RPC Kickoff

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | internal status RPC smoke | 先把 `status` 做成 WorkerEntrypoint RPC smoke，建立 caller/callee envelope truth，并复用 `packages/nacp-core/src/transport/{service-binding,do-rpc}.ts` 的 precheck primitive | `workers/agent-core/src/host/internal.ts` `workers/orchestrator-core/src/index.ts` `packages/nacp-core/src/transport/service-binding.ts` `packages/nacp-core/src/transport/do-rpc.ts` | internal RPC-first seam 开始成为现实 | package-e2e / smoke | `status` 可经 RPC 返回真实 session state，且 precheck 不在 worker 内重复发明 |
| P4-02 | internal start kickoff | 让 `start` 进入 dual-impl parity 阶段，并保持 public façade contract 不变；同时把 fetch shim 退役 deadline enforce 到 Z2 closure | `internal.ts` `session-edge.ts` `routes.ts` | internal HTTP glue 开始退居兼容层 | package-e2e / cross-e2e | public-via-fetch 与 internal-via-RPC 的返回 envelope deep-equal、关键 D1 row diff=`∅`、`trace_uuid + authority` stamp 一致 |

### 4.5 Phase 5 — Audit Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | replay/activity tests | 覆盖 reconnect、replay cursor、history/timeline readback、activity append-only 负例 | `test/package-e2e/orchestrator-core/**` `test/cross-e2e/**` | Z2 truth 有回归护栏 | `pnpm test:package-e2e` / `pnpm test:cross-e2e` | replay / timeline / activity 都有 green proof |
| P5-02 | Z2 closure | 写 `Z2-closure.md`，说明 Wave B schema、DO hot-state、replay、RPC kickoff 的交付状态 | `docs/issue/zero-to-real/Z2-closure.md` | Z3 可以直接消费 Z2 baseline | 文档 review | closure 列出 durable truth、append-only/redaction/trace-linkage proof、shim residuals 与已知 residuals |

---

## 5. Phase 详情

### 5.1 Phase 1 — Wave B Schema

- **Phase 目标**：把 session runtime 的 durable 真相从“暂存想法”推进到真实 D1 schema
- **本 Phase 对应编号**：
  - `P1-01`
- **本 Phase 新增文件**：
  - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/wrangler.jsonc`
- **具体功能预期**：
  1. conversation / session / turn / message / context / activity truth 都有 durable 落点。
  2. append-only activity log 与 transcript truth 分层明确。
  3. activity log 12 列 + 3 条 index + redaction wrapper 不再依赖实现期自行拼装。
  4. 后续 replay / heartbeat / context snapshot 不再缺 durable owner。
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`migration apply / D1 introspection smoke`
  - **回归测试**：`现有 orchestrator-core package-e2e`
  - **手动验证**：`检查表、索引、FK 与 ZX-D1 对齐`
- **收口标准**：
  - Wave B schema 可 apply
  - 所需索引存在
  - activity append-only、12 列字段集、3 条强制 index 与 redaction wrapper 可表达
- **本 Phase 风险提醒**：
  - 最容易漏掉 read path 必需索引，后续 replay/history 会被性能反噬

### 5.2 Phase 2 — Public Session Durable Truth

- **Phase 目标**：让 public façade 真正拥有可持久验证的 session truth
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/index.ts`
  - `workers/orchestrator-core/src/policy/authority.ts`
- **具体功能预期**：
  1. `start/input/history/timeline/verify` 读写 durable truth。
  2. activity/audit records 与 trace/authority 有固定落点。
  3. `conversation_uuid` 成为上位聚合中心，而不是继续只按 `session_uuid` 思考。
  4. status/timeline 不再只看 process-local state。
- **具体测试安排**：
  - **单测**：`query builders / authority redaction`
  - **集成测试**：`start -> history -> verify -> reconnect`
  - **回归测试**：`01-05 orchestrator-core package-e2e`
  - **手动验证**：`D1 行级核对`
- **收口标准**：
  - 会话读写经 durable layer
  - activity log 有真实 append path
  - verify/status/timeline 对 durable truth 一致
- **本 Phase 风险提醒**：
  - 最容易出现 DO state 与 D1 truth 分叉

### 5.3 Phase 3 — DO Hot-State + Replay

- **Phase 目标**：让 DO 只保留必要热状态，并具备 hibernation-safe replay/recover
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/user-do.ts`
  - `workers/agent-core/src/host/do/nano-session-do.ts`
  - `workers/agent-core/src/host/checkpoint.ts`
  - `workers/agent-core/src/host/ws-controller.ts`
- **具体功能预期**：
  1. DO hot-state 收敛到 Q6 冻结的四组集合：`conversation_index`、`active_pointers`、`recent_replay_window`、`short-lived caches`。
  2. 当前 `state.storage` keys 被分流为：回落 D1、保留热态、彻底废弃 三种命运。
  3. replay cursor/heartbeat/ack 具备 first-wave runtime reality。
  4. `every 10m + alarm` checkpoint 能把 pending delta 写回 durable truth。
- **具体测试安排**：
  - **单测**：`checkpoint / replay helpers`
  - **集成测试**：`disconnect / reconnect / replay cursor`
  - **回归测试**：`04-reconnect.test.mjs` `08-session-lifecycle-cross.test.mjs`
  - **手动验证**：`观察 checkpoint after alarm`
- **收口标准**：
  - `conversation_index<=200`、`recent_frames<=50/session`、`cache TTL<=5m`
  - reconnect/replay 能恢复，且清空 DO storage 后仍能从 D1 恢复 last 50 frames
  - long transcript/context 不再长期占用 DO memory
  - snapshot/recover 具备明确频率与触发点
- **本 Phase 风险提醒**：
  - 最容易把 DO 重新做成 durable truth owner，破坏分层

### 5.4 Phase 4 — RPC Kickoff

- **Phase 目标**：开始把 internal seam 从 HTTP-style glue 推向 RPC-first
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `workers/agent-core/src/host/internal.ts`
  - `workers/agent-core/src/host/session-edge.ts`
  - `workers/agent-core/src/host/routes.ts`
  - `workers/orchestrator-core/src/index.ts`
- **具体功能预期**：
  1. `status` 先成为 RPC smoke。
  2. `start` 进入 dual-impl parity 路径，而不是只停留在“开始接线”。
  3. fetch shim 的 retire deadline 被收口标准显式约束。
  4. 外部 façade contract 不变，但内部 boundary 更清晰。
- **具体测试安排**：
  - **单测**：`internal request validation`
  - **集成测试**：`public start -> internal rpc start -> status`
  - **回归测试**：`02-session-start.test.mjs` `11-orchestrator-public-facade-roundtrip.test.mjs`
  - **手动验证**：`internal status smoke via preview`
- **收口标准**：
  - `status` 经 RPC 返回真实状态
  - 相同 fixtures 下，public-via-fetch 与 internal-via-RPC 的返回 envelope JSON deep-equal
  - `nano_conversation_sessions / nano_conversation_messages / nano_session_activity_logs` 三表 row diff=`∅`
  - `trace_uuid + authority.tenantUuid + authority.userUuid` 一致，且 fetch shim 只允许保留明确过渡 seam
- **本 Phase 风险提醒**：
  - 最容易把 transport 切换做成无 closure 的半状态

### 5.5 Phase 5 — Audit Closure

- **Phase 目标**：证明 Z2 的 runtime truth 真正成立，并把 residual 压到 Z3/Z4
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 新增文件**：
  - `docs/issue/zero-to-real/Z2-closure.md`
- **本 Phase 修改文件**：
  - `test/package-e2e/orchestrator-core/**`
  - `test/cross-e2e/08-session-lifecycle-cross.test.mjs`
  - `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs`
- **具体功能预期**：
  1. replay、timeline、history、activity 具备闭环证据。
  2. Z2 closure 可直接给 Z3/Z4 当 runtime baseline。
  3. residuals 被诚实写出，不在 closure 中夸大。
- **具体测试安排**：
  - **单测**：`无额外要求`
  - **集成测试**：`replay/activity negative cases`
  - **回归测试**：`pnpm test:package-e2e && pnpm test:cross-e2e`
  - **手动验证**：`随机抽样 D1 行与 stream history 对齐`
- **收口标准**：
  - replay/activity/readback 测试全绿
  - 至少 1 条 append-only 负例、1 条 redaction 证明、1 条 trace linkage 证明成立
  - `Z2-closure.md` 存在并列出 known residuals
  - Z3 可直接消费 session/audit baseline
- **本 Phase 风险提醒**：
  - 最容易只证明 stream 可见，不证明 durable truth/readback 可见

---

## 6. 风险与依赖

| 风险 / 依赖 | 描述 | 缓解方式 |
|-------------|------|----------|
| D1 与 DO 双写一致性 | start/input/replay 可能在 durable 与 hot-state 间分叉 | 以 D1 为 truth、DO 为 cache；checkpoint/restore 只做增量恢复 |
| replay cursor 漂移 | `history` 与 live ws `seq` 可能不一致 | 统一从 durable cursor source 生成 `replay_cursor` |
| append-only log 污染敏感字段 | activity log 易误写 payload 原文 | 在 append path 固定 redaction discipline，并加 row-level tests |

---

## 7. 完成后的预期状态

Z2 完成后，系统将具备：

1. first-wave D1 session durable truth
2. append-only activity/audit baseline
3. Q6 约束下的 DO hot-state 与 checkpoint/replay
4. internal RPC-first seam 的实质 kickoff

---

## 8. 本计划完成后立即解锁的后续动作

1. 启动 `Z3-real-runtime-and-quota.md`
2. 让 Workers AI、quota gate、usage persistence 直接消费 Z2 的 session/audit truth
3. 把 Z4 客户端的 replay/heartbeat 交互建立在 Z2 baseline 之上
