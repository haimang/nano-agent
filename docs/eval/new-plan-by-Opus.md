# 下一阶段方向探索 — by Opus

> 文档对象: `nano-agent / 下一阶段方向探索（非正式）`
> 起草日期: `2026-04-19`
> 起草者: `Claude (Opus 4.7)`
> 文档性质: `direction memo / not a charter / not an action-plan`
> 输入依据:
> - `docs/plan-after-nacp.md`（已 100% 落地）
> - `docs/plan-after-skeleton.md`（A1–A10 + 2 轮 review fix + 第 3 轮 R2 default-sink fix 已全部落地）
> - 当前 `packages/**` 真实代码、root `test/*.test.mjs` + `test/e2e/*.test.mjs` reality
> - 第 3 轮 review §8 中刚刚关闭的 default eval sink wiring 真实情况

---

## 0. 这份文档的位置

本文档不是正式 charter，也不是 action-plan。它只是我（Opus）在通读两份历史 plan + 当前真实代码后，对「下一阶段应该做什么」的一份**方向探索**。业主在阅读后会给出自己的想法，再合并成正式 plan。

我把本文档拆成：

1. **§1 — 当前事实快照**：用代码事实判断我们站在哪里
2. **§2 — 已存在 plan 的预期方向**：plan-after-skeleton.md §12 已经写过的下一阶段
3. **§3 — 我对下一阶段的核心判断**：不该照搬 §12 的原因
4. **§4 — 推荐方向：Phase 8 — Real Agent Loop & Worker Realization**
5. **§5 — In-scope / Out-of-scope**
6. **§6 — 实现路径（最小可执行步骤）**
7. **§7 — 替代方向与拒绝理由**
8. **§8 — 一句话结论**

---

## 1. 当前事实快照（不是规划话术，是代码状态）

> 全部基于 2026-04-19 的 HEAD 真实代码与 1953 + 73 测试结果。

### 1.1 已落地的真实能力

| 维度 | 状态 |
|------|------|
| 协议地基 | `nacp-core`（1.1.0 frozen + compat shim 1.0.0）+ `nacp-session`（1.1.0 + 8 message kinds + `session.followup_input`）— 跨包 contract 已被 root contract tests + drift guard 锁住 |
| 8 个 skeleton 包 | 全部 MVP 落地，10 包 typecheck/build/test 全绿 |
| Trace law | `TraceEventBase` 强制 `traceUuid + sourceRole`；`assertTraceLaw()` 在 sink 边界 enforce；alarm.ts 已无 silent swallow |
| Cross-seam anchor | DO `buildCrossSeamAnchor()` + `anchorProvider` 透传到 hooks emit + provider fetcher；live runtime path 出站请求真带 `x-nacp-trace/session/team/request/source-*` headers |
| Workspace evidence | `ContextAssembler / CompactBoundaryManager / WorkspaceSnapshotBuilder` 全部 wired 进 DO 的 `subsystems.workspace`；`persistCheckpoint` 真触发 `snapshot.capture` evidence；DO 内置 bounded in-memory default sink 兜底 |
| Capability runtime | 12-pack（`pwd/ls/cat/write/mkdir/rm/mv/cp/rg/curl/ts-exec/git`）+ `grep -i/-n` alias + UTF-8 byte-aware `curl` truncation + namespace-backed `rg` + git status/diff/log + drift guard 直接读 PX inventory 文档 |
| Verification ladder | `local-l0-harness / remote-dev-l1 / deploy-smoke-l2` 三档 + `WorkerHarness.fetch()` 真 forward 到 baseUrl + `runRealSmoke()` 严格按 profile contract |
| Root test 面 | `test/*.test.mjs` 53 contract suites + `test/e2e/*.test.mjs` 14 e2e + `test:cross` 73/73 全绿 |

### 1.2 仍未落地的关键 reality

这些不是「skeleton 没补齐」，而是「skeleton 已收敛，但没有任何代码实际把它跑起来过」：

| 缺口 | 当前事实 |
|------|----------|
| **没有真实 agent loop 跑过** | `composition.ts:90-105` 与 `remote-bindings.ts:380-395` 都返回 `kernel: undefined`。`KernelRunner` 在 `agent-runtime-kernel` 里完整存在（runner.ts 含 llm_call / tool_exec / hook_emit / compact / wait / finish 6 类 decision），但 **session-do-runtime 没有任何代码把它装进 `subsystems.kernel`**。所有 E2E 都注入 mock advanceStep。这意味着 nano-agent **从未作为 agent 跑过一个真实 turn**。 |
| **没有真实 LLM provider 接通** | `llm-wrapper` 的 OpenAI adapter 完整，但 `session-do-runtime` 默认 composition 返回 `llm: undefined`。`l2-real-provider.smoke.ts` 即便拿到 `OPENAI_API_KEY` 也会 RED——因为 deploy-smoke-l2.json 的 profile 仍是 `provider: "local"`，且 worker.ts 没有路由 prompt 到 LLM 的代码。 |
| **没有真实 Worker entrypoint composition** | `worker.ts:72-88` 只是把 request forward 给 DO stub。production 部署需要的 `wrangler deploy` 入口 — 装配 `DoStorageTraceSink` 替代 in-memory default sink、装配 R2/KV bindings、装配 KernelRunner — 全部没有。 |
| **没有 deploy-shaped real boundary 证据** | A6 verification ladder 的 L1 external-seams 仍是 fixture-contract（self-blocked RED），L2 real-cloud 因为 provider 没接通也 RED。`p6-handoff.json` 是 pointer 文件，没有 reader。 |
| **没有公开 surface** | 没有任何前端 SDK、HTTP API spec、frontend client。整个系统目前只能从 vitest / `node --test` 内部触达。 |
| **没有 skill / extension 系统** | `SKILL_WORKERS` slot 在 `env.ts:67` 被显式标记 reserved；没有任何 design 或代码。 |
| **没有性能基线** | `SmokeRecorder.setLatency` 字段存在但从未在真实 wrangler dev 运行下捕获过。 |

### 1.3 一句话定位

> **nano-agent 现在是一台 engine 已经装配完成、所有 subsystem 单测通过、但钥匙还没插进点火孔的车。所有 protocol / runtime / observability / capability 都已 frozen 并 testable，但作为 agent，它从未真正完成过一个端到端任务。**

---

## 2. 已存在 plan 的预期方向

`plan-after-skeleton.md §12` 在 2026-04-17 已经预定义了下一阶段：

> **Capability & Context Expansion Phase**
>
> - 第一个 workstream: **API & Data Model Design**
> - 吸收主题：advanced multi-turn queue / richer session message family v2 / broader fake bash / full context architecture / compression / mature frontend / registry DDL

§12.3 给出的理由是「这些都依赖本阶段先完成 contract freeze + identifier law + trace-first observability + session edge v1 + external seam closure + storage/context evidence」。

**这个判断在 2026-04-17 是对的。但今天它有一个隐含错误前提：它假设我们做完 A1-A10 就等于「agent 已经会跑」，所以下一步直接做 API 与扩展。事实并非如此。**

---

## 3. 我对下一阶段的核心判断

### 3.1 不该直接跳到 API & Data Model Design

照搬 §12 的方向有三个具体问题：

1. **API 是给一个还没运行过的 agent 设计的接口**。今天 nano-agent 没有跑过一个真实 turn，没有 latency 基线，没有 token 预算的真实数据，没有 tool routing 的真实 trace。在这种状态下设计公开 API 等于在猜测——猜 API 的颗粒度、猜错误码的覆盖、猜哪些字段是 stable 的。
2. **API design 的反馈环太长**。frontend 接 API → 发现 API shape 不对 → 改 API → frontend 重写。如果先把 agent loop 跑通，API design 就有真实交互轨迹作为输入——成本远低。
3. **§12 列的 7 个吸收主题（multi-turn queue / fake bash 全量 / context architecture / compression / frontend / registry DDL）每一个都是大工程**。在 agent 还没跑通的状态下并行启动其中任何一个，都会把不确定性叠在不确定性之上。

### 3.2 我们真正缺的是「能跑」

A1-A10 的全部努力解决的是**「跑起来之后每个零件是否符合契约」**。现在缺的是**「先跑一次给我看」**。

更具体地说，我们需要回答这三个问题，才有资格谈 API design / 扩展：

1. **agent 真的能完成一个最小有用任务吗？** — 比如 "在 workspace 里搜索 'TODO'，把所有结果列成一个总结"
2. **production deploy path 真的端到端通吗？** — 比如 `wrangler deploy` + `wrangler secret put OPENAI_API_KEY` + 一个 HTTP `/start` 请求 + 真的看到 stream 出 OpenAI tokens
3. **observability 真的能在 deploy 之后可读吗？** — 不是 in-memory bounded sink，而是 R2-backed 的 trace + evidence，能用 `wrangler tail` 或简单 query 复盘

回答这三个问题不需要新的 design phase，需要的是**装配 + 验证**。

### 3.3 如果跳过这一步会发生什么

最大的风险是：我们继续按 §12 推进 → 写一份 API design → 写一份 data model design → 写一份 frontend SDK → 在某次 deploy 时发现某个 trace recovery 路径其实从来没在真实 DO 实例化过，或某个 evidence 写入路径在 R2 真实 region 下 latency 过高，于是 API/SDK 的若干字段必须重做。这是**典型的 skeleton-complete-but-not-running 陷阱**。

---

## 4. 推荐方向：Phase 8 — Real Agent Loop & Worker Realization

### 4.1 一句话目标

> **把已经 frozen 的所有 contract / runtime / observability / capability 装配成一个真的能在 Cloudflare Worker 上完成端到端 agent task 的可执行系统，并捕获第一份真实的 deploy-shaped 证据。**

### 4.2 这个阶段的本质

这不是新的 build phase，而是 **integration / realization phase**。它做的事是：

| 已有 | 缺 | 本阶段做的事 |
|------|-----|--------------|
| `KernelRunner` 类完整 | 没人在 production 装配它进 DO | 把 KernelRunner 接进 `composition.ts` 的 `kernel` slot |
| `LLMExecutor` 完整 + OpenAI adapter | session-do-runtime 不消费 | 同上接 `llm` slot |
| `CapabilityExecutor` 完整 + 12-pack | 接了但 turn loop 没真实调用 tool | 让 KernelRunner 的 tool_exec decision 真路由到 capability |
| `ContextAssembler` wired but only emits at checkpoint | 真实 turn loop 没 assemble | 让 KernelRunner 在 llm_call 前调 `assembler.assemble()` |
| `DoStorageTraceSink` 完整 | session-do-runtime 默认用 in-memory bounded sink | worker.ts 注入 `DoStorageTraceSink` 替代 |
| L2 verification ladder + smokeAssertionContract | provider=local，real-cloud 永远 RED | 让 deploy-smoke-l2 的 worker 真的把 prompt 路由到 OpenAI |
| `wranglers/*` 在 wrangler.jsonc 声明 | 实际 worker 包不存在 | 至少建 1 个 production-shaped wrangler deploy |

### 4.3 成功标志（不是单测，而是可演示的事实）

1. 在 `wrangler dev --remote`（或本地 + service binding 模拟）下，发一个 `POST /sessions/:uuid/start` 携带 `{ initial_input: "search workspace for the word 'needle' and summarize matches" }`，能看到：
   - 真实 OpenAI token stream 通过 `session.stream.event` 流回客户端
   - `rg` 真的被调用，结果真的回到下一轮 LLM call
   - 最终一段 summary 输出
2. 同一次 turn 在 R2/DO 中写下 trace + evidence，能用 `wrangler tail` 或简单脚本复盘
3. L2 real-provider smoke 在 wrangler deploy + `wrangler secret put OPENAI_API_KEY` 后真的 GREEN，profile contract `status === 'ok' && output.length > 0` 真的成立
4. 跨 worker 边界（hook / capability / provider）至少一条真实 service-binding 调用产生 `x-nacp-trace-uuid` header 落到 receiving worker 的 log

---

## 5. In-Scope / Out-of-Scope

### 5.1 In-Scope（本阶段必须做）

| 编号 | 工作项 | 为什么是 in-scope |
|------|--------|-------------------|
| **S1** | 在 `composition.ts` 的 default factory 里装配真实 `KernelRunner` 进 `subsystems.kernel`，配上 `KernelDelegates`（llm/tool/hook/compact 四个 delegate） | 没有这一步，DO 永远是 stub kernel |
| **S2** | DO 的 orchestrator `advanceStep` 真正调用 `kernel.advanceStep(snapshot, signals)`，让 turn loop 走 real LLM call → tool detection → tool exec → loop until finish | 闭合 S1，让 turn 真能跑 |
| **S3** | 把 `ContextAssembler.assemble()` 接进 KernelRunner 的 `llm_call` 前置步骤；assembler 现在只在 checkpoint 触发 snapshot evidence，应该 ALSO 在每次 LLM 调用时 emit `assembly` evidence | 让 5 条 evidence 流（placement / assembly / compact / artifact / snapshot）每条都有 deploy-time emission |
| **S4** | 在 worker.ts 里搭一个 production-shape `composition factory`，注入 `DoStorageTraceSink`（真实 R2-backed 持久化）替代 DO 的 in-memory bounded fallback；同时装 `R2_ARTIFACTS / KV_CONFIG` 真实 bindings 给 `WorkspaceNamespace + ArtifactStore` | 让 evidence + workspace 真的写 R2/KV 而不是丢内存 |
| **S5** | 至少 1 个真实 `wranglers/{fake-hook,fake-capability,fake-provider}` 包并 `wrangler deploy` 它们；让 L1 external-seams smoke 能切到 real service-binding 边界 | 关闭 GPT R2 残留的 fixture-contract-only blocker |
| **S6** | 把 `deploy-smoke-l2.json` 的 `provider: "local"` 升级为 `"remote"`，真接 OpenAI/openai-compatible 上游；让 `runRealSmoke()` 的 contract 真满足 | 兑现 A6 P4-01 写但从未达成的 "real provider golden path" |
| **S7** | 1 条「真实 task」E2E：用户输入一句自然语言 → KernelRunner 决定 tool_exec(rg) → 工具结果回到 LLM → LLM 决定 finish → 完整 trace + evidence 落 R2 | 这是本阶段唯一不可缺的 demo |
| **S8** | 性能基线第一次实际捕获：在 wrangler dev/deploy 下记录 `wsAttachMs / firstByteMs / fullTurnMs` 与 `placement.do.write` 的 p50/p99 | 给 §12 下一阶段（API design / capability expansion）一个真实数据起点 |
| **S9** | closure memo + handoff：明确说明"agent loop 真实成立"作为下一阶段的前提 | 防止下一阶段再次在猜测中启动 |

### 5.2 Out-of-Scope（本阶段明确不做）

| 编号 | 工作项 | 为什么放后面 |
|------|--------|--------------|
| **O1** | 公开 HTTP / RPC API 设计 | 应该在本阶段产出真实 turn trace 之后再设计；过早 freeze API 会被真实 trace 形态 invalidate |
| **O2** | Frontend SDK / TypeScript client | 等 O1 |
| **O3** | UI / Observability dashboard | 等 trace + evidence 真实落 R2 后再做查询面 |
| **O4** | richer session message family v2（queue/replace/merge 调度语义） | A1 Phase 0 有意冻结为最小 followup_input；扩张应等真实多轮交互产生具体需求 |
| **O5** | broader fake bash / `just-bash` 全量 port | 12-pack 在真实 task 里跑通后，再决定哪些命令真的 missing |
| **O6** | full context architecture（retrieval / embeddings / ranking） | 应等本阶段 `assembly` evidence 积累出真实瓶颈再设计 |
| **O7** | compression / budget management worker | 等 `compact` evidence 在真实 task 中触发后再规划 |
| **O8** | Skill worker / SKILL_WORKERS slot 实现 | A5 / A10 都明确把 `SKILL_WORKERS` 列为 reserved；本阶段不开 |
| **O9** | Browser rendering capability 实现 | A8 / A9 已明确 reserved slot；本阶段不开 |
| **O10** | Multi-tenant ops / billing / quota / auth 完整体系 | 本阶段只需最小 `wrangler secret put OPENAI_API_KEY` + `TEAM_UUID` env，不做完整 tenant 控制面 |
| **O11** | 多 provider 矩阵（Anthropic / Gemini / Bedrock 等） | 单一 golden path（OpenAI gpt-4.1-nano）即可；多 provider 是产品扩张工作 |
| **O12** | DDL / structured registry / business data store | `plan-after-skeleton.md §12` 已经把这条放下一阶段；本阶段不做，但本阶段产生的 evidence 才是它真正的输入 |
| **O13** | D1 升格 | AX-QNA Q20 hard gate 不变：D1 升格前必须先有独立 substrate-benchmark memo；本阶段不解锁 |

### 5.3 边界判定表

| 项 | 判定 | 理由 |
|----|------|------|
| 装配真实 KernelRunner 到 DO | `in-scope` | 让 agent 能跑的前置 |
| 改 KernelDelegates 的 LLMDelegate 实现 | `in-scope`（只接 OpenAI） | 但只接 1 个 provider，其他 deferred |
| 改 KernelRunner 的 advanceStep 内部逻辑 | `out-of-scope` | runner 已存在并测过，本阶段只是装配 |
| 设计 `/api/v1/sessions/...` REST surface | `out-of-scope` | 见 O1 |
| 在 worker.ts 里塞一个 admin endpoint 看 trace | `in-scope`（最小工程版本，不当 API 用） | 用于本阶段 demo |
| 实现 R2 archive scheduler | `out-of-scope` | A7 已明确 deferred |

---

## 6. 实现路径（最小可执行步骤）

不写正式 action-plan，只列**最少必要步骤**。

### Step 1 — 让 DO 装配真 KernelRunner（约 1-2 周）

1. 在 `packages/session-do-runtime/src/composition.ts` 与 `remote-bindings.ts` 的 factory 中，把 `kernel: undefined` 改为 `kernel: new KernelRunner(makeDelegates({...}))`
2. `makeDelegates(...)` 传入 LLM delegate（消费 `subsystems.llm`）、Tool delegate（消费 `subsystems.capability`）、Hook delegate（消费 `subsystems.hooks`）、Compact delegate（消费 `subsystems.workspace.compactManager`）
3. DO 的 `OrchestrationDeps.advanceStep` 真路由到 `kernel.advanceStep(...)`
4. 1 条 vitest integration test：mock LLM delegate 返回 `{ text: "TOOL_CALL: rg needle" }` → 期待 advanceStep 真触发 tool_exec → 真调到 capability runtime 的 rg

**收口标志**：`session-do-runtime/test/integration/` 有 1 条不再 mock advanceStep 的 test

### Step 2 — 接 OpenAI provider（约 1 周）

1. 在 `worker.ts` 里读 `env.OPENAI_API_KEY`，构造 `LLMExecutor` 的真实 OpenAI fetch
2. `composition factory` 把它装进 `subsystems.llm`
3. KernelRunner 的 LLMDelegate 调用它
4. L2 deploy-smoke-l2.json 的 `provider` 改为 `"remote"`
5. 1 条 vitest integration（用 nock-style mock）+ 1 条 wrangler dev 手动 smoke

**收口标志**：`l2-real-provider.smoke.ts` 在 `OPENAI_API_KEY` 存在时不再 RED

### Step 3 — 让 ContextAssembler 真在 LLM call 前 assemble（约 3 天）

1. `KernelDelegates.LLMDelegate` 在调 LLM 前调 `subsystems.workspace.assembler.assemble(layers)`
2. 把 `assembler` 的 `evidenceSink` / `evidenceAnchor` 已 wired（DO 已经做了）：现在每次 turn 都会 emit `assembly` evidence
3. 1 条 vitest integration：跑一个 turn，期待 default eval sink 收到 `stream === "assembly"` 记录

**收口标志**：5 条 evidence 流中的 `assembly` 真的在 deploy-time 产生（之前只 emit 在 unit test）

### Step 4 — 真实 DoStorageTraceSink 替代 in-memory default（约 3 天）

1. 在 worker.ts 的 production composition factory 里 `import { DoStorageTraceSink } from "@nano-agent/eval-observability"`
2. `subsystems.eval = new DoStorageTraceSink(doStorage, teamUuid, sessionUuid)`
3. DO 的 default in-memory sink fallback 路径在 production 下不被启用（验证 `getDefaultEvalRecords()` 始终空）
4. 1 条 deploy-shaped smoke：跑 turn 后用 `storage.list("tenants/...")` 验证 trace JSONL 真落了

**收口标志**：trace + evidence 真写 DO storage（之前只写 in-memory bounded buffer）

### Step 5 — 真实 task golden-path E2E（约 1 周）

1. `test/e2e/e2e-15-real-agent-loop.test.mjs`（或 wrangler script）：
   - 输入 `"search workspace for the word 'needle' and summarize matches"`
   - 期待 LLM 决定调 `rg`，结果回到 LLM
   - LLM 输出 summary
   - 整个 turn 的 trace 在 R2/DO 中可读
2. 这是本阶段**唯一不可缺**的 demo

**收口标志**：能给业主 demo 一次完整 agent task

### Step 6 — 至少 1 条真实 service-binding 边界（约 1 周）

1. `wranglers/fake-hook-worker/`（或 `wranglers/fake-capability-worker/`）真实 wrangler deploy
2. 主 worker.ts 的 `HOOK_WORKER` binding 指向它
3. L1 external-seams smoke 改成"如果 baseUrl 有 wrangler dev URL，用真 service binding；否则保留 fixture-contract"双模式
4. 验证 receiving worker 的 log 真带 `x-nacp-trace-uuid`

**收口标志**：GPT R2 的 "fixture-contract only" blocker 在 deploy-shaped 模式下被关闭

### Step 7 — 性能基线 + closure（约 3 天）

1. 用 Step 5 的 E2E 跑 50 次，捕获 `wsAttachMs / firstByteMs / fullTurnMs / placement-write p50 p99`
2. 写 closure memo 与 handoff：明确"agent loop 已成立、deploy 路径已通、第一份 deploy-shaped evidence 已产出"
3. 该 memo 成为下一阶段 API design 的输入

**收口标志**：第一份 nano-agent deploy-shaped performance baseline

### 6.1 总工期估计

约 **5-6 周** —— 比之前任何一个 A1-A10 phase 都更短，因为本阶段不写新 design / 不写新 contract / 不动 protocol。它只是装配。

### 6.2 关键风险与缓解

| 风险 | 缓解 |
|------|------|
| KernelRunner 的 delegate 协议与现有 capability/llm-wrapper API 不完全契合 | Step 1 先做 vitest integration，在 mock 层暴露 mismatch；可能需要给 delegates 加 1 层薄 adapter |
| OpenAI rate limit / pricing 在 demo 阶段失控 | 用 `gpt-4.1-nano` + 严格 maxTokens cap；测试用 mock，demo 用真 key |
| DoStorageTraceSink 在真实 DO 上的 R2 latency 不在预期 | A2 benchmark 已经预测了 package-local p50≤20ms；Step 7 的基线就是验证这一点；超出预期不是阻塞，是数据 |
| wrangler 部署的 service binding 配置出错 | Step 6 用最小 1 个 fake worker；不一次铺三个 |

---

## 7. 替代方向与拒绝理由

讨论几个被 §12 暗示但我建议**不**作为下一阶段起点的方向：

### 7.1 Direction B — Public API & Frontend SDK

**为什么吸引人**：能让外部开发者使用 nano-agent。
**为什么我不推荐先做**：API 是 agent 行为的投影。在 agent 没真跑过 1 次 task 的情况下设计 API，会把 API surface 押在猜测的轨迹上。Step 5 跑通后，API 设计就有真实交互模式作为输入，工作量更小、错得更少。

### 7.2 Direction C — Capability Expansion（broader bash / skill workers / browser rendering）

**为什么吸引人**：能让 agent 能力面更宽。
**为什么我不推荐先做**：12-pack 命令在真实 task 里有没有真的"够用"，今天没数据。先跑 Step 5，看 LLM 实际想调什么，再决定补哪些。

### 7.3 Direction D — Full Context Architecture（retrieval / embeddings / re-ranking）

**为什么吸引人**：业界共识是"context is everything"。
**为什么我不推荐先做**：当前 `assembly` evidence 在 deploy-time 没数据；compact 也没真实触发过。先跑通 turn loop，看真实 token 占用与 truncation 频率，再设计 retrieval。

### 7.4 Direction E — Hardening / Security / Multi-tenant ops

**为什么吸引人**：production 必备。
**为什么我不推荐先做**：还没有 production 来 harden。Step 5 + Step 7 之后，可以看到真实威胁面（prompt injection 模式、tool 越权、quota 失控）再 harden。

### 7.5 Direction F — Trace / Evidence Query Layer（query API for stored evidence）

**为什么吸引人**：产生的 trace + evidence 需要被"看到"才有价值。
**为什么我可以接受这个作为 next-next phase**：但首先需要 trace 真实存进 R2/DO（Step 4），才有东西可查；query layer 是 Phase 8 之后的自然扩展。

---

## 8. 一句话结论

> **下一阶段最高 leverage 的工作不是再写 design / contract / API spec，而是把 A1-A10 装配起来跑一次真实 agent task。完成 Phase 8 后，nano-agent 第一次作为 agent 被验证；同时为 plan-after-skeleton.md §12 设想的 API & Data Model Design 提供真实交互轨迹作为输入，避免在猜测中启动下一阶段。**

具体推荐：

- **下一阶段名称**：`Phase 8 — Real Agent Loop & Worker Realization`
- **核心目标**：让 nano-agent 第一次跑通端到端真实 agent task
- **预估工期**：5-6 周
- **不引入**：新 contract、新 design memo、新 protocol
- **必须产出**：1 条可演示的 real agent task + deploy-shaped trace + 第一份性能基线 + closure memo
- **作为下一阶段的入场前提**：Phase 8 closure memo 会是「Capability & Context Expansion」(plan-after-skeleton.md §12) 的真实输入，而不是猜测

等业主给出想法后，再把分歧 / 共识合并成正式的 charter 与 action-plan。
