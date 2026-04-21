# Plan Worker Matrix — First-Wave Worker Assembly with Verified Foundations

> 文档对象:`nano-agent / worker-matrix phase charter`
> 刷新日期:`2026-04-21 (r1)`
> 作者:`Claude Opus 4.7 (1M context)`
> 文档性质:`phase charter / scope freeze / worker boundary contract / cross-worker invariants / deferral register`
>
> **修订历史:**
> - **r1 (2026-04-21)**:初版,基于 `docs/eval/worker-matrix/` 上下文束与 B8/B9 shipped reality 编制。
>
> **输入依据:**
> - `docs/plan-after-foundations.md` (r2,已全部 phase 闭合 — 4 轮修正收口与 5 类 ship code 已落地)
> - `docs/handoff/after-foundations-to-worker-matrix.md` (B8 handoff memo,含 §11/§12/§13 post-B9 回填)
> - `docs/handoff/next-phase-worker-naming-proposal.md` (4 first-wave + 1 reserved 命名建议)
> - `docs/issue/after-foundations/B9-final-closure.md` (B9 closed with revision §8)
> - `docs/issue/after-foundations/after-foundations-final-closure.md` (Phase 0 gate OPEN 口径)
> - `docs/rfc/nacp-core-1-3-draft.md` (双侧 matrix + error body provisional helper + initial_context wire hook)
> - `docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md` (rev 2 post-B9-integration)
> - `docs/eval/worker-matrix/agent-core/` 5 份 worker 上下文(index + realized + internal-nacp + external-contract + cloudflare-study)
> - `docs/eval/worker-matrix/bash-core/` 同上 5 份
> - `docs/eval/worker-matrix/context-core/` 同上 5 份(含 §6.1-§6.3 第一波决策锚点)
> - `docs/eval/worker-matrix/filesystem-core/` 同上 5 份(含 §6.1 ReferenceBackend 决策)
> - `docs/eval/worker-matrix/context-space-examined-by-opus.md` (上下文束审查 + 4 项 patch)
> - `docs/eval/worker-matrix/cross-worker-interaction-matrix.md` (patch-2:4×4 交互矩阵)
> - `docs/eval/worker-matrix/worker-readiness-stratification.md` (patch-3:全局 readiness 分层)
> - `docs/eval/worker-matrix/skill-core-deferral-rationale.md` (patch-4:skill.core 延后说明)
> - `docs/eval/after-foundations/smind-contexter-learnings.md` (Contexter 分层架构辩证)
> - 当前 `packages/**` 真实代码事实(详见 §2)

---

## 0. 为什么这份文档要现在写

after-foundations 阶段已经闭合 — B1-B9 全部 shipped,5 类 code(context-management / storage-topology 2.0.0 / capability-runtime 扩展 / hooks / nacp 1.3.0)全部 ship,spike 双轮全部部署并 writeback 完成,B9 contract freeze 的 R1/R2/R3 三项 review finding 已在 2026-04-21 整改闭环。

但**前一阶段建立的 conservative-first 基调意味着 nano-agent 的真实状态是**:

> **foundations 已经典型地"seam-ready, assembly-partial"**——所有 substrate 包都存在,所有 protocol 契约都已冻结,所有 platform law 都已验证;但 **default composition 仍是 empty handle(`kernel: undefined, llm: undefined, …`)**,nano-agent 作为 agent 的主链并未真正跑通。

worker-matrix 阶段要解决的唯一问题就是这个 **substrate-to-assembly 的一次性过渡**。本阶段不再新建 substrate(那是 after-foundations 的事),也不再修改 protocol contract(那是 B9 的事),而是:

> **用 4 个 first-wave worker (`agent.core / bash.core / context.core / filesystem.core`) 把已经 shipped 的 substrate 装配成真实 agent turn loop,并在此过程中建立 cross-worker 的稳定沟通管道。**

简称:

> **Worker Matrix: Substrate-to-Assembly Transition with Frozen Contracts**

---

## 1. 本轮已经确认的基石事实与 Owner Decisions

这是本阶段最高优先级输入,全部来自前一阶段的 shipped reality + eval 讨论的 owner 裁判。

### 1.1 来自 after-foundations 的净产出(frozen truth)

1. **nacp-core 1.3.0 / nacp-session 1.3.0 / session-do-runtime 0.3.0 已 shipped**
   - 出处:`docs/issue/after-foundations/B9-final-closure.md` §1-§3
   - worker-matrix 不得修改 `NACP_CORE_TYPE_DIRECTION_MATRIX` / `NACP_SESSION_TYPE_DIRECTION_MATRIX` / `SessionStartInitialContextSchema`
   - worker-matrix 不得修改 `V1_BINDING_CATALOG`(charter §4.1 H 第 32 项,已是 nano-agent 长期纪律)

2. **tenant plumbing 已在 `NanoSessionDO` 接线**
   - 出处:`packages/session-do-runtime/src/do/nano-session-do.ts:487-535` (acceptClientFrame async + await verifyTenantBoundary);`packages/session-do-runtime/src/do/nano-session-do.ts:551-604` (getTenantScopedStorage)
   - worker-matrix 不得绕过 tenant wrapper;任何新 storage use-site 必须经 `getTenantScopedStorage()` 代理

3. **context-management 0.1.0 已 ship**
   - 出处:`packages/context-management/` 含 `budget/` / `async-compact/` / `inspector-facade/` 三子模块
   - `AsyncCompactOrchestrator` 的 armed → prepare → commit lifecycle 已实现(仅 `restoreVersion` 仍 honest stub)

4. **`initial_context` wire hook 已冻结,consumer 侧 owner 确认归 agent.core host**
   - 出处:`docs/eval/worker-matrix/context-core/index.md` §6.3 + `docs/eval/worker-matrix/agent-core/index.md` §4
   - `SessionStartInitialContextSchema` 的解析由 `nacp-session` 承担;assembler 的 `appendInitialContextLayer(...)` API 由 `context.core` 提供;调用由 `NanoSessionDO.dispatchAdmissibleFrame` 在 `session.start` 分支执行

5. **B7 LIVE deploy 契约仍 load-bearing**
   - 出处:`test/b7-round2-integrated-contract.test.mjs` 5 tests 必须保持 green
   - worker-matrix 对 `NanoSessionDO` 的任何改动必须保留:BoundedEvalSink dedup + overflow disclosure、cross-seam anchor lowercase header、`idFromName(sessionId)` per-session DO 身份

### 1.2 来自 Opus/GPT worker-matrix eval 的 owner 裁判

6. **4 first-wave worker 名单冻结**:`agent.core / bash.core / context.core / filesystem.core`
   - 出处:`docs/handoff/next-phase-worker-naming-proposal.md:67`
   - 这 4 个是 first wave,`skill.core` 明确延后(详见 §1.3 第 10 条)

7. **`context.core` 升格为 first-wave worker,但保持薄做**
   - 出处:`docs/eval/after-foundations/worker-matrix-eval-with-Opus.md` §3 + `context-management-eval-by-Opus.md` v2 §7.4
   - "升格"的含义是 "有独立上下文包 + 独立 charter 章节",**不是** "立即独立部署为 remote worker"
   - 参见 `docs/eval/worker-matrix/context-core/index.md` §0 一句话结论:"薄 context substrate,不是完整 context engine"

8. **`agent.core` 不是 binding slot,是 host worker**
   - 出处:`docs/handoff/after-foundations-to-worker-matrix.md` §4-§6
   - host worker 的物理实体就是 `packages/session-do-runtime/src/do/nano-session-do.ts::NanoSessionDO`;worker-matrix 不应重建 host 壳

9. **Conservative-first 基调贯穿所有 worker**:每个 worker 的第一波都要"薄做",不在 first wave 试图做到位
   - 出处:`docs/eval/worker-matrix/context-space-examined-by-opus.md` §7.3
   - 具体表现:`bash.core != full shell`、`filesystem.core != POSIX FS`、`context.core != semantic memory engine`、`agent.core != 长期记忆 orchestrator`

### 1.3 来自 context-space 审查的 pre-construction 补丁

10. **`skill.core` 明确延后,作为 reserved-name 保留**
    - 出处:`docs/eval/worker-matrix/skill-core-deferral-rationale.md` + `docs/handoff/next-phase-worker-naming-proposal.md:126`
    - 入场条件:(1) first-wave 4 workers 全部 closure;(2) 产品驱动浮现;(3) substrate 存在或 RFC 立项;(4) 下一轮 charter 周期

11. **cross-worker 交互矩阵已作为基线输入**
    - 出处:`docs/eval/worker-matrix/cross-worker-interaction-matrix.md`
    - 4×4 矩阵的 8/12 cells 已 real;2/12 seam(agent↔bash 主链);1/12 partial(agent→context initial_context consumer);这是本 charter §7 的直接前置输入

12. **readiness 分层已做**:4 workers 全部 A- 或更高
    - 出处:`docs/eval/worker-matrix/worker-readiness-stratification.md` §3
    - 唯一 Phase 0 critical path = D2 列(default composition wiring),全部落在**同一个文件**:`packages/session-do-runtime/src/composition.ts`

---

## 2. 当前仓库的真实起点

今天的仓库现实,是 "after-foundations shipped + worker-matrix 尚未开始" 的精确中间态。

### 2.1 当前 readiness 真相:Frozen contracts + seam-complete substrate + assembly undone

#### 2.1.1 已成立的 frozen truth

1. **协议地基 1.3 frozen**
   - `nacp-core 1.3.0` — 11 core types 的 `NACP_CORE_TYPE_DIRECTION_MATRIX` 已冻结并由 `validateEnvelope` Layer 6 强制
   - `nacp-session 1.3.0` — 8 session types 的 `NACP_SESSION_TYPE_DIRECTION_MATRIX` 已冻结并由 `validateSessionFrame` 强制
   - `NacpErrorBodySchema` + `NACP_ERROR_BODY_VERBS`(空 registry)+ `wrapAsError()` provisional helper 已 ship
   - `SessionStartInitialContextSchema` + `SessionStartBodySchema.initial_context` 已冻结并 back-compat

2. **Host tenant plumbing 已 materialize**
   - `NanoSessionDO.acceptClientFrame()` async + `await verifyTenantBoundary()` + typed rejection(B9-R1 修复)
   - 5 个 storage use-site 全部走 `getTenantScopedStorage()`(`wsHelperStorage` / `persistCheckpoint` / `restoreFromStorage` / `LAST_SEEN_SEQ_KEY put`)
   - `http-controller.ts` 硬编码 `"1.1.0"` 已清除(B9-R4 修复)

3. **4 worker substrate 全部 shipped**
   - `agent.core` substrate = `@nano-agent/session-do-runtime 0.3.0` + `@nano-agent/agent-runtime-kernel` + `@nano-agent/llm-wrapper` + `@nano-agent/hooks`
   - `bash.core` substrate = `@nano-agent/capability-runtime`(21-command registry + 6 类 handlers + `ServiceBindingTarget`)
   - `context.core` substrate = `@nano-agent/context-management 0.1.0` + `@nano-agent/workspace-context-artifacts`
   - `filesystem.core` substrate = `@nano-agent/workspace-context-artifacts` + `@nano-agent/storage-topology`

4. **Regression baseline**
   - Package-level:11 packages 共 2242+ tests 全绿
   - Root:98 / 98 绿(含 17 新 B9 tests)
   - Cross:112 / 112 绿
   - B7 LIVE wire:5 / 5 绿

#### 2.1.2 仍待 worker-matrix 完成的 3 处 assembly 缺口

| 缺口 | 证据 | Phase 0 priority |
|---|---|---|
| **默认 composition 未装 kernel/llm/capability** | `packages/session-do-runtime/src/composition.ts:90-106` 仍返回 `{kernel: undefined, llm: undefined, capability: undefined, …}` | **P0 唯一必要里程碑** |
| **Remote composition 未装 kernel/workspace/eval/storage** | `packages/session-do-runtime/src/remote-bindings.ts:385-395` 仍在 4 处 `undefined` | **P0 配套**(与 default 同 PR) |
| **`initial_context` host consumer 未实现** | `packages/session-do-runtime/src/do/nano-session-do.ts:608-645` 当前只抽 turn_input,未读 `body.initial_context` | **P0 配套**(与 default 同 PR) |

**结论**:本阶段的工程量**不是** "4 个独立 worker 的 greenfield implementation",**而是** "用一个焦点 PR 把 default + remote composition factory 升级为真实装配"。4 个 worker 的其他工作都围绕这个 milestone 排布。

### 2.2 Cross-worker interaction matrix 真相(derived from §1.3 第 11 条)

| producer → consumer | `agent.core` | `bash.core` | `context.core` | `filesystem.core` |
|---|---|---|---|---|
| **`agent.core`** | — | `tool.call.*` via CAPABILITY_WORKER → **seam** + P0-required | `context.compact.*` + `initial_context` + in-process compact → **partial** + P0 | in-process `WorkspaceNamespace` → **real** + P0-maintain |
| **`bash.core`** | `tool.call.response` → **seam** + P0 | — | `session.stream.event` (progress) → **real** + P0 | `WorkspaceFsLike` consumer → **real** + P0 |
| **`context.core`** | `hook.outcome` + kernel compact delegate → **real** + P0 | N/A | — | `WorkspaceSnapshotBuilder` → **real** + P0 |
| **`filesystem.core`** | evidence emission → **real** + P0 | N/A | evidence(assembly/artifact/snapshot)→ **real** + P0 | — |

完整版矩阵参见 `docs/eval/worker-matrix/cross-worker-interaction-matrix.md`。

### 2.3 四个 worker 的 readiness 分层真相(derived from §1.3 第 12 条)

| dimension | `agent.core` | `bash.core` | `context.core` | `filesystem.core` |
|---|---|---|---|---|
| D1 核心 package | **real** | **real** | **real** | **real** |
| D2 默认 composition | **seam** | **seam** | **partial** | **real** |
| D3 独立 Worker shell | missing | missing | missing | missing |
| D4 remote service-binding | **seam** | **seam** | not-yet | not-yet |
| D5 regression tests | **real** | **real** | **real** | **real** |
| D6 协议 contract alignment | **real** | **real** | **real** | partial |
| **aggregate** | **A-** | **A-** | **B+** | **A-** |

完整版参见 `docs/eval/worker-matrix/worker-readiness-stratification.md`。

---

## 3. 本阶段的一句话目标

> **用一次焦点性 default-composition 升级,把 `session-do-runtime` 的空柄装成由 `KernelRunner + LLMExecutor + capability transport + workspace + context-management + evidence sink` 组成的真实 agent turn loop;在此过程中冻结 4 个 first-wave worker(`agent.core / bash.core / context.core / filesystem.core`)的**设计特质、沟通管道、in-scope/out-of-scope**;保留 `skill.core` 为 reserved-name 但不做;产出物是 live agent runtime + 4 worker charter-level boundary + `initial_context` consumer + 下一阶段 handoff memo。**

---

## 4. 本阶段边界:In-Scope / Out-of-Scope

### 4.1 In-Scope(本阶段必须完成)

#### A. 默认 Composition 装配(Phase 0 唯一必要里程碑)

1. `packages/session-do-runtime/src/composition.ts::createDefaultCompositionFactory()` 从 `{kernel: undefined, …}` 升级为实例化:
   - `kernel: new KernelRunner(...)` 消费 `@nano-agent/agent-runtime-kernel`
   - `llm: new LLMExecutor(...)` 消费 `@nano-agent/llm-wrapper`
   - `capability: {serviceBindingTransport}` 消费已有 `makeRemoteBindingsFactory` 路径
   - `workspace: composeWorkspaceWithEvidence(...)` 已在默认 DO 路径装配,现在显式进入 composition handle
   - `eval: BoundedEvalSink` 已在默认 DO 路径装配,同上显式化
2. `packages/session-do-runtime/src/remote-bindings.ts::makeRemoteBindingsFactory()` 对 4 处 `undefined`(`kernel / workspace / eval / storage`)给出相应处理
3. `session-do-runtime/package.json` dependencies 显式收齐(目前 `hooks / storage-topology / llm-wrapper / capability-runtime / eval-observability` 不全是 runtime dep)

#### B. `initial_context` Host Consumer 实现

4. `NanoSessionDO.dispatchAdmissibleFrame` 的 `session.start` 分支,在 `extractTurnInput` 之前新增 `body.initial_context` 的消费路径:
   - 验证(已由 `validateSessionFrame` 完成)
   - 转发:`workspaceComposition.assembler.appendInitialContextLayer(body.initial_context)` 或等价 API
   - 失败处理:如果 layer 注入失败,应作为 warning event 而非 fatal(因为 `initial_context` 是 optional)
5. `context.core` 侧新增 `assembler.appendInitialContextLayer(payload: SessionStartInitialContext): void` API,保证 host 不需要感知 context internals

#### C. 4 Worker 边界契约冻结(本 charter §6 内容落地)

6. 每个 worker 的 **design特质、沟通管道、in-scope、out-of-scope** 在本文件 §6 冻结
7. 每个 worker 的 **cross-worker invariants** 在 §7 冻结
8. 冻结的含义:后续 design / action-plan 文档必须引用并服从这里的边界;任何越界提议需要新的 charter 周期

#### D. Worker-Matrix 收口 Handoff

9. 输出 `docs/handoff/worker-matrix-to-skill-core.md`(或同等命名),列出 first-wave 4 worker closure 状态 + `skill.core` 解锁前置条件
10. 回填 `docs/eval/worker-matrix/` 的 `00-contexts/00-current-gate-truth.md` 到 "worker-matrix closure" 状态(再次 rev)
11. 更新 `docs/issue/after-foundations/after-foundations-final-closure.md` §6 的 "Phase 0 gate OPEN" 语句为 "Phase 0 已完成" + 指向新 handoff memo

### 4.2 Out-of-Scope(本阶段明确不做)

#### A. 独立 Worker Shell / Remote Transport

1. 4 个 worker 的独立 wrangler entry / deploy shell — 本阶段不做;`session-do-runtime` 仍是唯一 deploy-shaped worker
2. `context.compact.*` 的 remote service-binding transport — 本阶段保持 in-process
3. `filesystem.core` 的 remote service-binding — 本阶段保持 host-local workspace mount
4. 为 `bash.core` 单独部署的 wrangler entry(即使 `CAPABILITY_WORKER` 作为 env 绑定名存在,也不创建新的 wrangler project)

#### B. Skill / Reserved Names

5. `skill.core` 的任何 substrate / registry / handler / worker 实装(出处:§1.3 第 10 条)
6. `browser.core` / `scraper.core` / `search.core` 等 reserved 范畴的命名扩展

#### C. Protocol / Schema 扩展

7. 任何 NACP 1.3.0 范围外的新 message type 或 body schema(包括但不限于:`orchestrator.*` namespace 落地、`context.slot.*`、`hook.reranker.*`)
8. `wrapAsError()` provisional helper 的 migration PR(即将 `tool.call.response` / `context.compact.response` / `skill.invoke.response` 的 body 从 `{status, error?}` 迁到 `NacpErrorBodySchema`) — 这需要独立 owner-approved PR,不在 worker-matrix 内夹带
9. `SessionStartInitialContextSchema` 的 4 子字段(`user_memory / intent / warm_slots / realm_hints`)的字段扩展 — 冻结状态,任何扩张需新 nacp RFC

#### D. Context Engine 厚做

10. `context.reranker` 独立 worker 立项(post-worker-matrix,需 eval findings)
11. slot / semantic memory engine 的完整实现(smind-contexter-learnings §10 已明确 defer)
12. `AsyncCompactOrchestrator.restoreVersion()` 的真实实装(honest stub 保留)
13. `context-management` 的 inspector 默认 public mount(`mountInspectorFacade` helper 保留,默认 OFF)

#### E. Filesystem / Storage 终态

14. `ReferenceBackend.connected` mode 作为默认(保持 memory-only,详见 filesystem-core/index.md §6.1)
15. D1 / KV full runtime placement 固定(保持 evidence-driven)
16. `mkdir` / `git diff` / `git log` 从 honest partial 升级为 full(保持 disclosure)
17. `ts-exec` 从 honest partial 升级为真实执行(保持 not-connected 标记)

#### F. 平台 Gate

18. F03(cross-colo KV)/ F09(high-volume curl)两项 platform gate 的 probe 重跑 — owner-side action,非 charter scope
19. `DOStorageAdapter.maxValueBytes` 从 1 MiB 升到 2 MiB — B8 Phase 0 candidate,可在本阶段**顺手**做但不是 charter 核心

#### G. 生产化

20. SLO / on-call / runbook / dashboard(post-worker-matrix)
21. billing / tenant operations / per-tenant rate limiting(post-worker-matrix)
22. 真实 LLM provider 生产对接(本阶段可用 fake provider + service-binding-test harness 验证)

### 4.3 一个必须写明的例外

虽然本阶段不做独立 worker shell,但必须承认:**default composition 升级完成后,`session-do-runtime` 作为 host worker 在事实上已经担当了 `agent.core` 的完整角色**。

所以准确表述是:

> **本阶段不新建 4 个独立 Worker deploy shell;但 `agent.core` 作为 host 角色在 `session-do-runtime` 内部已 live,其余 3 个 worker(`bash.core / context.core / filesystem.core`)通过 in-process 组件或 `CAPABILITY_WORKER` 等 binding seam 参与其中。独立 wrangler entry 是 worker-matrix 后续的演进项,不是本阶段的里程碑。**

---

## 5. 本阶段的方法论

### 5.1 Assembly-First-Iteration — Substrate 已就绪,只做组装

继承 `plan-after-foundations.md` §5.2 "Spike-First-Iteration" 的纪律但调整焦点:

- ❌ 错误姿态:把 worker-matrix 执行成 "继续扩 substrate"(4 个包仓库已经够)
- ❌ 错误姿态:把 worker-matrix 执行成 "边装边改 substrate"(这会污染 B9 冻结的契约)
- ✅ 正确姿态:**substrate 已冻结,worker-matrix 只做 composition wiring + 消费端集成**

具体反模式清单:

1. 反对在 worker-matrix 阶段 bump `nacp-core` / `nacp-session` / `capability-runtime` / `context-management` / `storage-topology` 的 minor version(patch 允许,但不应出现于本阶段 primary 路径)
2. 反对在 worker-matrix 阶段新建 `@nano-agent/*` package(skill.core 的任何雏形、reranker 的 prototyping 都违反此条)
3. 反对把 workspace-context-artifacts / capability-runtime 里已有的 primitive 在 composition 层"重写一份轻量版"(如重写 assembler / re-implement tool-call bridge)
4. 允许并鼓励:在 `session-do-runtime/src/composition.ts` 内做 wiring 级 changes + 在 `do/nano-session-do.ts` 内做 `initial_context` consumer 级 changes

### 5.2 Thin-First Discipline — 每个 worker 都只做能闭合的最小 slice

继承 after-foundations 的 conservative-first 基调:

| worker | 第一波姿态 | 禁止越界 |
|---|---|---|
| `agent.core` | host 装配完整 turn loop | 不引入长期记忆 orchestrator / intent routing |
| `bash.core` | 21-command governed subset + CAPABILITY_WORKER transport seam | 不做 full shell / full POSIX / python / ts-exec 真实执行 |
| `context.core` | assembly + compact boundary + snapshot + evidence,async-compact 保持 opt-in | 不做 slot / reranker / semantic memory engine / restoreVersion 真实实现 |
| `filesystem.core` | host-local workspace + memory/DO backend + fake-bash consumer 一致 | 不做独立远端 FS / POSIX 完整语义 / ReferenceBackend connected 默认 |

这条纪律本身是 `docs/eval/worker-matrix/{agent,bash,context,filesystem}-core/index.md` §1.2 "Out-of-Scope" 表的自然延伸。

### 5.3 Contract-First-Change — Protocol 已冻,改 runtime 不改协议

B9 已建立并冻结了 NACP 1.3 contract surface。worker-matrix 的所有 worker 都必须:

1. 发 envelope 时**不**绕过 `validateEnvelope()` / `validateSessionFrame()`
2. 用已 registered 的 message_type;不自造新 type 即使为了"内部 shortcut"
3. 如果某个需求需要扩展协议,走 **"先写 RFC,再决定是否在 charter 内"** 的节奏,而非先偷偷扩再补文档
4. `wrapAsError()` 作为 provisional helper 使用时,必须显式标记 `target_message_type` 并接受"产物在当前 1.3 surface 下不通过 `validateEnvelope`"的现实;消费者应预期非 validated envelope

### 5.4 Cross-Worker Invariants — 跨 worker 不变量必须 load-bearing

继承 `docs/eval/worker-matrix/cross-worker-interaction-matrix.md` §4 五条不变量,并在本 charter §7 完整列出。所有 worker 的任何 PR 都要经过 "是否违反 §7 不变量" 的 self-check。

---

## 6. 4 个 First-Wave Worker 专属章节

本节是本 charter 的核心。每个 worker 一节,**只讲 charter-level 纲领**(design 特质、沟通管道、in-scope、out-of-scope),不进入 design 或 action-plan 的细节。

每节结构统一为:
- **§x.1 身份定位**
- **§x.2 Design 特质**
- **§x.3 沟通管道 — 入站**
- **§x.4 沟通管道 — 出站**
- **§x.5 In-Scope(本阶段)**
- **§x.6 Out-of-Scope(本阶段)**
- **§x.7 关键代码锚点**

### 6.1 `agent.core` — Host Worker

#### 6.1.1 身份定位

- **host worker,不是 binding slot**
- **物理实体**:`packages/session-do-runtime/src/do/nano-session-do.ts::NanoSessionDO`
- **外层 Worker entry**:`packages/session-do-runtime/src/worker.ts`(薄壳,作 `idFromName(sessionId)` 路由)
- **定位约束**:`agent.core != 上游 orchestrator`;它不承担 user memory / intent routing / cross-session state,这些由 upstream(如 `initial_context` 的 producer)负责
- 依据:`docs/eval/worker-matrix/agent-core/index.md` §0 + §4 第 1 判断

#### 6.1.2 Design 特质

| 特质 | 说明 |
|---|---|
| 单 DO per session | `idFromName(sessionId)` — 每个 session 一个 DO;不做 per-user DO |
| 真实 session actor | `SessionOrchestrator` 驱动 `unattached → attached → turn_running → ...` 状态机 |
| 薄 Worker + 厚 DO | Worker entry 只做路由;所有业务在 `NanoSessionDO` 内 |
| host 负责 upstream 调度 | `dispatchAdmissibleFrame` 在 `session.start` 时调用 `context.core` 的 `appendInitialContextLayer`;consumer 职责归 host |
| host 产生 session.stream.event | 只有 agent.core 向 client 推 `session.stream.event`;其他 worker 通过 host 的 stream seam 参与 |
| honest degrade | 缺 kernel / llm 时用空 `{snapshot, events: [], done: true}` 降级,不 panic — 但 Phase 0 完成后不应再触发此路径 |

#### 6.1.3 沟通管道 — 入站(agent.core 作为 consumer)

| 来源 | 协议 / 接口 | 当前状态 | 本阶段动作 |
|---|---|---|---|
| client WebSocket frame | `nacp-session` `NacpSessionFrame` + `validateSessionFrame` | real | 不变 |
| client HTTP fallback action | `HttpController` + `acceptIngress` | real | 不变 |
| `tool.call.response` from bash remote | `nacp-core` `ToolCallResponseBodySchema` + `CAPABILITY_WORKER` service-binding reply | seam | **P0 装配:消费 kernel 发起的 tool call 的返回路径** |
| `hook.outcome` from hook remote | `nacp-core` `HookOutcomeBodySchema` + `HOOK_WORKER` service-binding reply | real(已接) | 不变 |
| `context.compact.response` | in-process via `createKernelCompactDelegate` | real(opt-in) | 保持 opt-in,不强制 |
| `initial_context` payload | `SessionStartInitialContextSchema` 嵌在 `session.start.body` | shipped wire + missing consumer | **P0 补 consumer** |

#### 6.1.4 沟通管道 — 出站(agent.core 作为 producer)

| 目标 | 协议 / 接口 | 当前状态 | 本阶段动作 |
|---|---|---|---|
| client(WS) | `session.stream.event` | real | 不变 |
| `bash.core` | `tool.call.request` / `tool.call.cancel` via `serviceBindingTransport` | seam | **P0 装配:kernel tool dispatcher 走 transport** |
| `hook.*` worker(remote) | `hook.emit` via `HOOK_WORKER` | real | 不变 |
| `fake.provider` | direct `Fetcher` binding | real | 不变 |
| DO storage(自身) | `getTenantScopedStorage` + `tenantDoStorage*` | real | 不变 |
| R2(artifact promotion) | via `workspace-context-artifacts` promotion 路径 | seam | 保持 seam;不激活 connected `ReferenceBackend` |

#### 6.1.5 In-Scope(本阶段)

1. `createDefaultCompositionFactory()` 升级为真实装配 kernel / llm / capability / workspace / eval
2. `makeRemoteBindingsFactory()` 对 `kernel / workspace / eval / storage` 给出合理处理(至少统一 null 处理路径或小包装)
3. `session-do-runtime/package.json` dependencies 补齐
4. `initial_context` consumer 接线(见 §4.1 B)
5. `agent.core` charter-level 边界在本 §6.1 冻结

#### 6.1.6 Out-of-Scope(本阶段)

1. 新建独立 `agent-core-worker` 目录 / wrangler entry(host worker 就是 session-do-runtime)
2. 引入 user-level DO 或 cross-session state store(架构上反对)
3. 将 `NanoSessionDO` 拆分为多个 DO 类(保持单 DO 简洁)
4. 自造 session 层 message types(已由 `nacp-session` 冻结)
5. 放宽 tenant wrapper 强制(B9 契约)

#### 6.1.7 关键代码锚点

- `packages/session-do-runtime/src/worker.ts:72-88` — Worker entry
- `packages/session-do-runtime/src/do/nano-session-do.ts:130-280` — DO 构造函数
- `packages/session-do-runtime/src/do/nano-session-do.ts:466-535` — WS ingress + `acceptClientFrame` async
- `packages/session-do-runtime/src/do/nano-session-do.ts:608-645` — `dispatchAdmissibleFrame`(initial_context consumer 落点)
- `packages/session-do-runtime/src/composition.ts:90-106` — P0 主改点
- `packages/session-do-runtime/src/remote-bindings.ts:385-395` — P0 配套改点
- 上下文包:`docs/eval/worker-matrix/agent-core/{index,realized-code-evidence,internal-nacp-compliance,external-contract-surface,cloudflare-study-evidence}.md`

---

### 6.2 `bash.core` — Governed Capability Worker

#### 6.2.1 身份定位

- **governed fake-bash execution engine**,不是 Linux shell,也不是 full just-bash
- **物理形态**:`@nano-agent/capability-runtime` 包内的 `FakeBashBridge + 21-command registry + CapabilityExecutor + handlers + ServiceBindingTarget`
- **远端 seam**:通过 `CAPABILITY_WORKER` binding 向 agent.core 暴露 `tool.call.*` 消费面
- 依据:`docs/eval/worker-matrix/bash-core/index.md` §0 + §4 第 1 判断

#### 6.2.2 Design 特质

| 特质 | 说明 |
|---|---|
| governed subset | 21 commands 注册在 `commands.ts`,每个带 `policy: allow/ask/deny` + `executionTarget: local-ts/service-binding/browser-rendering` |
| no-silent-success | `FakeBashBridge` 的 bridge 层,任何 unsupported / narrow-violation 都走 structured error,不静默通过 |
| bash-narrow | `curl` 与 `ts-exec` 在 bash path 下严格收窄(见 `planner.ts:130-248`) |
| tool.call.* body bridge | 只负责 body 层;envelope(`nacp-core`)不由 bash.core 直接拥有 |
| honest partial | `mkdir` / `git diff|log` / `ts-exec` 均明确标记 partial,不 paper over |
| bash.core 不拥有 session.* | 对 client 无话语权;只与 host/capability transport 交互 |

#### 6.2.3 沟通管道 — 入站

| 来源 | 协议 / 接口 | 当前状态 | 本阶段动作 |
|---|---|---|---|
| agent.core kernel | `ToolCallRequestBodySchema` via `CAPABILITY_WORKER` service-binding | seam | **P0 配套:kernel dispatch 通过 transport 到达** |
| agent.core cancel | `ToolCallCancelBodySchema` via transport | seam | **P0 配套:cancel propagation 打通** |
| workspace | `WorkspaceFsLike` + `resolveWorkspacePath`(in-process) | real | 不变 |
| capability policy gate | `AllowAskDenyPolicy`(`policy.ts`) | real | 不变 |

#### 6.2.4 沟通管道 — 出站

| 目标 | 协议 / 接口 | 当前状态 | 本阶段动作 |
|---|---|---|---|
| agent.core | `ToolCallResponseBodySchema` via `ServiceBindingTarget` | seam | **P0 配套:response 返回闭环** |
| `session.stream.event`(via agent.core) | `tool.call.progress` adapter in `nacp-session/src/adapters/tool.ts` | real | 不变 |
| workspace filesystem | 写路径:`namespace.write(...)` | real | 不变 |
| network(curl) | `fetch` with budget guard | real(low-volume) | 不变;high-volume 由 owner F09 gate |

#### 6.2.5 In-Scope(本阶段)

1. 作为 `agent.core` default composition 的 `capability` handle 被正确装配(通过 `serviceBindingTransport`)
2. 确认 `tool.call.*` 双向闭环在装配后的 runtime 中跑通(`CapabilityRunner` / `ServiceBindingTarget` / `tool-call.ts` bridge)
3. bash.core charter-level 边界在本 §6.2 冻结
4. (可选)对 `@nano-agent/capability-runtime` 的 `executor.ts` 在 runtime 装配中的行为加一个端到端 smoke test,证明 kernel 能经 transport 发起 tool call 并收到 response

#### 6.2.6 Out-of-Scope(本阶段)

1. 新建独立 `bash-core-worker` 目录 / wrangler entry(transport seam 已经足够)
2. 扩展 21-command registry(任何新 verb 需经 capability-runtime RFC)
3. 解除 `curl` low-volume budget 或 `ts-exec` not-connected 标记
4. 引入 `python3 / sqlite3 / browser` 执行 target(保持 not-connected)
5. 把 `bash.core` 做成 "full shell"(管道嵌套 / redirect / heredoc / process substitution 全部 out)
6. 把 `hook.*` / `skill.*` / `context.*` 请求混入 bash.core 的 tool.call 面

#### 6.2.7 关键代码锚点

- `packages/capability-runtime/src/fake-bash/commands.ts:16-315` — 21-command registry
- `packages/capability-runtime/src/fake-bash/bridge.ts:82-167` — no-silent-success bridge
- `packages/capability-runtime/src/tool-call.ts:20-160` — tool.call.* body bridge
- `packages/capability-runtime/src/executor.ts:121-320` — requestId / cancel / timeout / progress
- `packages/capability-runtime/src/targets/service-binding.ts:90-215` — remote transport target
- `packages/capability-runtime/src/policy.ts:17-48` — allow/ask/deny policy
- `packages/session-do-runtime/src/remote-bindings.ts:329-390` — `CAPABILITY_WORKER` 装配入口
- 上下文包:`docs/eval/worker-matrix/bash-core/{index,realized-code-evidence,internal-nacp-compliance,external-contract-surface,cloudflare-study-evidence}.md`

---

### 6.3 `context.core` — Thin Context Substrate

#### 6.3.1 身份定位

- **薄 context substrate**,不是 "完整 context engine"
- **物理形态**:`@nano-agent/context-management 0.1.0` 的 3 子模块 + `@nano-agent/workspace-context-artifacts` 的 assembly / compact-boundary / snapshot / evidence
- **运行位置**:host 进程内(session DO 的 composition),不独立 Worker
- **第一波角色**:为 `agent.core` 提供 context assembly + compact boundary + snapshot + evidence 能力,为 `initial_context` 提供 consumer API
- 依据:`docs/eval/worker-matrix/context-core/index.md` §0 + §4 第 1 判断

#### 6.3.2 Design 特质

| 特质 | 说明 |
|---|---|
| opt-in async compact | `AsyncCompactOrchestrator` 存在并 testable,但**不默认自动装**(charter 决策 §6.2 Option A — 见 context-core/index.md §6.2) |
| in-process compact | `context.compact.*` 在 host 进程内 via `createKernelCompactDelegate`,不跨 worker |
| inspector facade opt-in | `mountInspectorFacade` 是显式 helper,默认 OFF;env gate + auth 由 deploy-time wrangler 控制 |
| honest partial | `restoreVersion` 仍 throw `not implemented`,保留 stub 诚实度 |
| evidence vocabulary | 4 类:`assembly / compact / artifact / snapshot`,统一经 `evidence-emitters.ts` 发至 host 的 `BoundedEvalSink` |
| initial_context API 归属 | schema 由 `nacp-session` 定义,API(`appendInitialContextLayer`)由 context.core 提供,**调用由 agent.core host 承担** |

#### 6.3.3 沟通管道 — 入站

| 来源 | 协议 / 接口 | 当前状态 | 本阶段动作 |
|---|---|---|---|
| agent.core host(initial_context 调度) | `assembler.appendInitialContextLayer(payload)` API | **missing** | **P0 新增 API + 被 host 调用** |
| agent.core kernel(compact 请求) | `createKernelCompactDelegate` → `tryCommit / forceSyncCompact` | real(opt-in) | 保持 opt-in |
| agent.core host(assembly 请求) | `ContextAssembler.assemble(layers, budget)` | real | 不变 |
| agent.core host(snapshot 触发) | `WorkspaceSnapshotBuilder.buildFragment()` | real(在 persistCheckpoint 调用) | 不变 |

#### 6.3.4 沟通管道 — 出站

| 目标 | 协议 / 接口 | 当前状态 | 本阶段动作 |
|---|---|---|---|
| agent.core kernel(compact 结果) | `{tokensFreed}` return via delegate | real(opt-in) | 保持 opt-in |
| evidence sink(`BoundedEvalSink`) | 4 类 evidence 记录 | real | 不变 |
| agent.core host(layers 返回) | `AssembledPrompt` | real | 不变 |
| inspector HTTP/WS(opt-in) | `InspectorFacade` 的 `/inspect/...` 路由 | seam(opt-in) | 不变;charter 不启用默认 |

#### 6.3.5 In-Scope(本阶段)

1. 新增 `appendInitialContextLayer(payload: SessionStartInitialContext): void` API(或等价 shape),暴露到 composition factory 可消费的层级
2. 作为 host composition 的 `workspace` handle 被装配(已由 `composeWorkspaceWithEvidence` 事实上装配,本阶段显式化)
3. 配合 agent.core P0 装配 — 如果 kernel 要求 compact delegate,必须能无缝插上(不是 P0 硬要求,但要 ensure 可以接)
4. context.core charter-level 边界在本 §6.3 冻结

#### 6.3.6 Out-of-Scope(本阶段)

1. 独立 `context-core-worker` deploy(post-worker-matrix)
2. `context.compact.*` 的 remote service-binding(保持 in-process)
3. `AsyncCompactOrchestrator` 自动装入默认 composition(保持 opt-in — 见 context-core/index.md §6.2)
4. slot / reranker / semantic memory engine 的实装
5. `restoreVersion` 真实实现(honest stub 保留)
6. inspector facade 默认启用(保持 opt-in — 见 context-core/index.md §6.1)
7. `SessionStartInitialContextSchema` 4 子字段(`user_memory / intent / warm_slots / realm_hints`)的字段扩展
8. 与 smind-contexter 的直接对接 / 借入 `contexts / vec_history / vec_intents` schema(定位:future-direction input,非当前 code)

#### 6.3.7 关键代码锚点

- `packages/context-management/README.md:3-15` — 包 scope
- `packages/context-management/src/async-compact/index.ts:159-245` — orchestrator lifecycle
- `packages/context-management/src/async-compact/kernel-adapter.ts:57-88` — kernel delegate
- `packages/context-management/src/async-compact/index.ts:613-620` — restoreVersion stub
- `packages/context-management/src/inspector-facade/index.ts:313-371` — mount helper
- `packages/workspace-context-artifacts/src/context-assembler.ts:66-167` — assembly truth
- `packages/workspace-context-artifacts/src/compact-boundary.ts:119-213` — compact boundary
- `packages/workspace-context-artifacts/src/snapshot.ts:84-232` — snapshot builder
- `packages/workspace-context-artifacts/src/evidence-emitters.ts:24-282` — 4 类 evidence
- `packages/session-do-runtime/src/workspace-runtime.ts:75-101` — runtime compose
- `packages/nacp-session/src/upstream-context.ts:1-42` — `SessionStartInitialContextSchema`
- 上下文包:`docs/eval/worker-matrix/context-core/{index(含 §6.1/§6.2/§6.3 决策锚点),realized-code-evidence,internal-nacp-compliance,external-contract-surface,cloudflare-study-evidence}.md`

---

### 6.4 `filesystem.core` — Host-Local Workspace Substrate

#### 6.4.1 身份定位

- **mount-based workspace/storage substrate**,不是 POSIX 文件系统,也不是独立的远端文件系统 Worker
- **物理形态**:`@nano-agent/workspace-context-artifacts` 的 `MountRouter + WorkspaceNamespace + Memory/ReferenceBackend` + `@nano-agent/storage-topology` 的 adapters/placement/calibration
- **消费者**:`bash.core` 的 file/search/vcs handlers、`context.core` 的 snapshot builder、`agent.core` 的 workspace composition 出口
- 依据:`docs/eval/worker-matrix/filesystem-core/index.md` §0 + §4 第 1 判断

#### 6.4.2 Design 特质

| 特质 | 说明 |
|---|---|
| longest-prefix mount | `MountRouter.routePath` 是 FS universe 的基础抽象;`_platform/` 为 reserved namespace |
| tenant/key law | 所有 ref / key 必须 `tenants/<team>/...` 前缀(由 `storage-topology/src/keys.ts` + `refs.ts` 强制) |
| memory-only default | 第一波默认用 `MemoryBackend`(与 DO 1 MiB cap 对齐);`ReferenceBackend.connected` mode 保持 opt-in |
| evidence-driven placement | `placement.ts` + `calibration.ts` 仍 provisional;不预先冻结 KV/D1/R2 topology |
| shared workspace truth | fake-bash / snapshot / assembler 共用同一份 workspace truth;无并行实现 |
| honest partial | `mkdir` / `git diff|log` 明确 partial;不 paper over |

#### 6.4.3 沟通管道 — 入站

| 来源 | 协议 / 接口 | 当前状态 | 本阶段动作 |
|---|---|---|---|
| bash.core handlers | `WorkspaceFsLike` + `resolveWorkspacePath`(in-process) | real | 不变 |
| context.core snapshot builder | `listMounts / listDir / artifactStore.list` | real | 不变 |
| agent.core composition | `composeWorkspaceWithEvidence(...)` | real | 不变;**P0 显式化到 composition handle** |
| host(checkpoint restore) | `WorkspaceSnapshotBuilder.restoreFragment` | real | 不变 |

#### 6.4.4 沟通管道 — 出站

| 目标 | 协议 / 接口 | 当前状态 | 本阶段动作 |
|---|---|---|---|
| evidence sink(`BoundedEvalSink`) | `assembly / artifact / snapshot` evidence via emitters | real | 不变 |
| `do storage`(checkpoint 等) | `tenantDoStorage*` via host `getTenantScopedStorage` | real | 不变 |
| R2(artifact promotion) | via `promotion.ts`(only when connected `ReferenceBackend` 启用) | seam(默认 OFF) | 不变 |

#### 6.4.5 In-Scope(本阶段)

1. 作为 `agent.core` default composition 的 `workspace` handle 被装配(从 `composeWorkspaceWithEvidence` 的 eventual handle 升级为显式 composition.workspace 项)
2. 确认 `bash.core` / `context.core` 消费的是同一个 workspace 实例(no divergence)
3. filesystem.core charter-level 边界在本 §6.4 冻结

#### 6.4.6 Out-of-Scope(本阶段)

1. 独立 `filesystem-core-worker` deploy(post-worker-matrix)
2. Remote service-binding workspace transport(保持 host-local)
3. `ReferenceBackend.connected` mode 启用 / R2 promotion 默认化(保持 opt-in — 见 filesystem-core/index.md §6.1)
4. `mkdir` / `git diff|log` 从 partial 升级为 full
5. POSIX 语义 / symlink / cross-mount traversal / HTTPFS 等 just-bash FS universe 特性
6. D1 schema / KV production placement 冻结(保持 evidence-driven)
7. `_platform/` namespace 的 scope 扩张(只允许 `KV_KEYS.featureFlags()` 这一极窄 escape hatch)

#### 6.4.7 关键代码锚点

- `packages/workspace-context-artifacts/src/mounts.ts:58-85` — routePath + `_platform/` reserved
- `packages/workspace-context-artifacts/src/namespace.ts:17-120` — WorkspaceNamespace
- `packages/workspace-context-artifacts/src/backends/memory.ts` — MemoryBackend(1 MiB cap)
- `packages/workspace-context-artifacts/src/backends/reference.ts:7-29,58-80,120-140` — ReferenceBackend(connected mode shipped 但不默认)
- `packages/workspace-context-artifacts/src/refs.ts:68-96` — artifact refs
- `packages/workspace-context-artifacts/src/promotion.ts:21-143` — R2 promotion(opt-in)
- `packages/workspace-context-artifacts/src/snapshot.ts:122-232` — snapshot capture
- `packages/storage-topology/src/keys.ts:38-64` — key law + `_platform/` exception
- `packages/storage-topology/src/refs.ts:31-79` — ref law
- `packages/storage-topology/src/placement.ts:22-120` — placement(provisional)
- `packages/storage-topology/src/adapters/do-storage-adapter.ts:73-178` — DO adapter
- `packages/storage-topology/src/adapters/r2-adapter.ts:63-187` — R2 adapter
- `packages/capability-runtime/src/capabilities/filesystem.ts:102-237` — fake-bash consumer
- `packages/capability-runtime/src/capabilities/workspace-truth.ts:11-157` — shared workspace consumer
- `packages/session-do-runtime/src/workspace-runtime.ts:75-101` — runtime compose
- 上下文包:`docs/eval/worker-matrix/filesystem-core/{index(含 §6.1 决策锚点),realized-code-evidence,internal-nacp-compliance,external-contract-surface,cloudflare-study-evidence}.md`

---

## 7. Cross-Worker 不变量与沟通管道汇总

本章把 `docs/eval/worker-matrix/cross-worker-interaction-matrix.md` §4 的 5 条不变量升级为 charter-level 强约束。所有 worker 的任何 PR,若违反这 5 条之一,视为越界。

### 7.1 不变量 1 — Tenant Boundary

- 每一次 cross-seam 调用都必须经 `verifyTenantBoundary()`(B9-R1 已将其从 fire-and-forget 升级为 `await` gate)
- 所有 DO storage 访问都必须走 `getTenantScopedStorage()`(前缀:`tenants/<team>/...`)
- `source-code white-list` 由 `test/tenant-plumbing-contract.test.mjs` 强制:只有 `getTenantScopedStorage / wsHelperStorage / alarm / handleWebSocketUpgrade` 4 个函数允许出现 raw `this.doState.storage.*`
- **违反示例**:在新 worker 代码中直接写 `state.storage.put("foo", bar)` 而不经 wrapper

### 7.2 不变量 2 — Matrix Legality

- 每个向 wire 发出的 envelope 必须通过 `NACP_CORE_TYPE_DIRECTION_MATRIX`(core)或 `NACP_SESSION_TYPE_DIRECTION_MATRIX`(session)
- 不得绕过 `validateEnvelope()` / `validateSessionFrame()`,即便是"临时 shortcut"
- 不得发非法 `(type, delivery_kind)` 组合,例如 `tool.call.request + event`(Layer 6 会 throw `NACP_TYPE_DIRECTION_MISMATCH`)
- **违反示例**:在 worker 内部 send 一条 `session.end + delivery_kind: command` 的帧

### 7.3 不变量 3 — Evidence Dedup + Overflow Disclosure

- `BoundedEvalSink` 按 `messageUuid` 去重;emitter 必须附带 `messageUuid`,否则会落入 overflow ring
- overflow 不得 silent;必须通过 `getDefaultEvalDisclosure()` 可见
- **违反示例**:新 worker 在 emit evidence 时故意不带 `messageUuid`,或自己维护并行 sink

### 7.4 不变量 4 — Stream Replay 单源真相

- `SessionWebSocketHelper` 是 replay / ack / heartbeat 的唯一 source-of-truth
- 其他 worker / subsystem 不得维护并行 replay state 或 ack 计数
- **违反示例**:`context.core` 自建一份 "已收 turn 记录" 来做 compact 判断

### 7.5 不变量 5 — Checkpoint 对称性

- `persistCheckpoint` 拒绝在 `sessionUuid === null` 或 `teamUuid` 为空时写入
- `validateSessionCheckpoint` 对 checkpoint shape 做 symmetry guard,writer 必须先过 validator 才 persist
- **违反示例**:新 worker 通过"侧门"直接写 checkpoint 而不经 DO host 路径

---

## 8. Phase 拆分

本阶段 Phase 极少,因为 scope 非常收敛。

| Phase | 名称 | 核心目标 | 主要产出 |
|---|---|---|---|
| **Phase 0** | Default Composition Assembly + `initial_context` Consumer | 把 `composition.ts` 的空柄升级为真实装配;让 host 消费 `initial_context` | session-do-runtime 0.4.0(shipped),live agent turn loop,`assembler.appendInitialContextLayer` API,P0 regression tests |
| **Phase 1** | 4-Worker Boundary Contract Freeze | 本文件 §6 的 4 个 worker 章节在各 worker 的 `README.md` 或 charter-aligned doc 里得到 cross-link;修订任何与本 charter §6 冲突的下游文档 | doc 同步 PR;若出现冲突需要修 charter 本身,则本 charter r2 |
| **Phase 2** | Worker-Matrix Closure & Handoff | 输出 closure memo;更新 meta-doc 到 "worker-matrix closed" 状态;准备 skill.core 解锁 checklist | `docs/handoff/worker-matrix-to-next-phase.md`、meta-doc rev、after-foundations-final-closure §6 再次更新 |

### 8.1 DAG

```text
Phase 0 (Default Composition Assembly + initial_context consumer)
   │
   ├─ 必要前置:B9 已 closed、context-space 4 patches 已 landed (都已完成)
   │
   └─→ Phase 1 (4-Worker Boundary Contract Freeze)
          │
          └─→ Phase 2 (Worker-Matrix Closure & Handoff)
```

### 8.2 为什么不排更多 Phase

- Phase 0 就是本阶段 99% 的工程量;后续都是 doc-shaped
- 任何试图把 Phase 拆多(如"独立 bash-core worker Phase"、"context async-compact 默认装 Phase")都违反 §5.2 Thin-First Discipline
- 如果 Phase 0 完成后发现某 worker 有 additional 真实需求,应开新 charter 周期,不在本阶段扩

### 8.3 估计时长

| Phase | 时长 | 累计 |
|---|---|---|
| Phase 0 | 1-2 周(composition wiring 是主要工作;regression 面已有 2242+ tests 作支撑) | 2 周 |
| Phase 1 | 0.5 周(大部分文档已在 `docs/eval/worker-matrix/` 就绪,只需 cross-link) | 2.5 周 |
| Phase 2 | 0.5 周(纯 closure) | 3 周 |

**总时长:3 周左右**。远短于 after-foundations 阶段 — 这是 conservative-first 基调的直接回报。

---

## 9. 执行方法

### 9.1 Phase 0 的三道 Gate

#### Start Gate

1. 本 charter 已冻结(r1 已 owner-approved)
2. `docs/eval/worker-matrix/` 13 份文档 + 4 patches 已 landed(已完成)
3. `docs/issue/after-foundations/after-foundations-final-closure.md` §6 已反映"Phase 0 gate OPEN"(已完成)
4. regression baseline:packages 全绿 + root 98/98 + cross 112/112(已核验)

#### Build Gate

1. `composition.ts` 与 `remote-bindings.ts` 的 diff plan 已写出(design doc or action-plan)
2. `assembler.appendInitialContextLayer` API 的 schema/behavior 已在 context-core 侧定义
3. 新增 regression test 清单已列出(至少:turn loop 端到端 smoke + initial_context 消费 smoke + 不变量 1-5 各一条 negative case)
4. B7 LIVE 契约 `test/b7-round2-integrated-contract.test.mjs` 5/5 保留

#### Closure Gate

1. `pnpm -r run test` 全绿
2. `node --test test/*.test.mjs` 保持当前 98+ 通过(允许 delta 为新增 worker-matrix-P0 contract test)
3. `npm run test:cross` 保持当前 112+ 通过
4. B7 LIVE 契约 test 全绿
5. closure note 写入 `docs/issue/worker-matrix/P0-closure.md`
6. `session-do-runtime 0.4.0` shipped(或相应 minor/patch bump)

### 9.2 Phase 1 的执行姿态

- 仅做**文档同步**,不做代码变更
- 对下游文档做 cross-link(从 per-worker README / CHANGELOG 引用 charter §6 相应小节)
- 若出现"下游文档与 charter §6 冲突"的情况,**修 charter**(r2 revision)而不是 silently 让下游漂移

### 9.3 Phase 2 的执行姿态

- 收口 ritual:每个 Phase 出 closure note;最终 handoff memo
- 更新 meta-doc + after-foundations-final-closure
- 为 `skill.core` 写一份 "unlock checklist"(入场条件已由 `docs/eval/worker-matrix/skill-core-deferral-rationale.md` §4 定义,此处做可执行化)

---

## 10. 测试与验证策略

### 10.1 继承 plan-after-foundations §10 的五层测试结构

1. Package tests — 保持 all green
2. Root contract tests — 扩展新 worker-matrix contract
3. Cross-package E2E — 扩展 live turn loop end-to-end
4. Spike-shaped real-Cloudflare verification — **不新做 spike**;继承 B7 LIVE findings
5. Chaos / failure injection — 不在本阶段

### 10.2 本阶段必须新增的验证(最小集)

| 验证项 | 测试位置 | 说明 |
|---|---|---|
| default composition 装配成功 | `packages/session-do-runtime/test/integration/` | 断言 `kernel / llm / capability / workspace / eval` 全部 non-undefined |
| live turn loop smoke | `test/worker-matrix-live-turn-contract.test.mjs`(新) | 一次完整 `session.start → kernel advance step → tool.call.request → response → session.stream.event → session.end` |
| `initial_context` consumer | `test/worker-matrix-initial-context-consumer.test.mjs`(新) | 构造带 `body.initial_context` 的 session.start,断言 assembler 收到 layer |
| tenant violation 仍 gate | 已在 `test/tenant-plumbing-contract.test.mjs`(保持 green) | 回归保护 |
| matrix legality 仍 gate | 已在 `test/nacp-1-3-matrix-contract.test.mjs`(保持 green) | 回归保护 |

### 10.3 拒绝的验证项

- 不做 production-grade 性能测试(post-worker-matrix)
- 不做 chaos / fault injection(post-worker-matrix)
- 不做新的 Cloudflare LIVE deploy(继承 B7);如 Phase 0 出现真实需要再 owner-approve

### 10.4 Spike / LIVE 续验证策略

- B7 LIVE deploy 已 shipped,本阶段**不要求 re-deploy**
- 如果 Phase 0 改动触及 `NanoSessionDO` 的 wire-level 行为,需在 PR 里证明 `test/b7-round2-integrated-contract.test.mjs` 仍 green;这已足够
- owner 可以选择性 re-deploy(完全 out of charter scope)

---

## 11. 本阶段的退出条件(Exit Criteria)

本阶段 exit criteria 必须同时满足,否则本阶段 NOT 成功关闭。

### 11.1 Primary Exit Criteria(能力成熟度)

1. **Default composition 已真实装配**:`createDefaultCompositionFactory()` 与 `makeRemoteBindingsFactory()` 均能产出 `kernel / llm / capability / workspace / eval` 的真实实例,`undefined` 从 5 个减少到 ≤ 1(storage 允许保留 undefined)
2. **live turn loop 已跑通**:至少一个 end-to-end smoke test 证明 `session.start → kernel → LLMExecutor → tool.call → response → session.stream.event → session.end` 在默认 composition 下成立
3. **`initial_context` consumer 已接线**:`NanoSessionDO.dispatchAdmissibleFrame` 的 `session.start` 分支消费 `body.initial_context`;`context.core` 侧提供 `assembler.appendInitialContextLayer` API;有 smoke test 证明 layer 到达
4. **4 worker charter-level 边界已冻结**:本 charter §6 的 4 小节被下游 per-worker 文档 cross-link;任何后续与 §6 冲突的提议视为 out-of-scope
5. **cross-worker 5 条不变量**被新 regression tests 锁住;已有的 9 条 contract tests(`tenant-plumbing / nacp-matrix / initial-context-schema`)保持 green
6. **B9 契约无回退**:`nacp-core 1.3.0` / `nacp-session 1.3.0` / `session-do-runtime ≥ 0.3.0` 保持;`V1_BINDING_CATALOG` 未改
7. **B7 LIVE 契约无回退**:`test/b7-round2-integrated-contract.test.mjs` 全绿
8. **`skill.core` 保持 reserved**:没有引入任何 `skill.*` 新 substrate、registry、worker shell、env binding
9. **Closure ritual 已完成**:3 个 Phase 的 closure note 已写回;下一阶段 handoff memo 已输出

### 11.2 Secondary Outcomes(结果非锚点)

- `session-do-runtime` 0.3.0 → 0.4.0 或适当 minor/patch bump
- `agent-runtime-kernel` / `llm-wrapper` / `context-management` / `workspace-context-artifacts` / `capability-runtime` 可能出现小 patch(bug fix 级),不要求 minor bump
- 若 Phase 0 发现某个不变量需要新 regression test,新增 test 是合理产物但不强制 bump

### 11.3 NOT-成功退出的识别

若出现以下任一,本阶段 NOT 退出:

- primary 1-9 任一未满足
- 任一 worker 出现 "独立 deploy shell"(out-of-scope A.1-4 violation)
- 任一 worker 出现 NACP / matrix / binding catalog 修改(out-of-scope C.7-9 violation)
- 任一 `skill.*` 代码实体出现(out-of-scope B.5-6 violation)
- `wrapAsError()` 在任何非 provisional 用法下被调用(违反 §5.3 Contract-First-Change)

---

## 12. 下一阶段:什么会成为正式 In-Scope

worker-matrix 关闭后,**下一阶段**候选切换为:

> **Skill-Core Opening Phase** OR **Reranker / Semantic Memory Phase** OR **Remote-Worker Split Phase**

哪个成为下一阶段,取决于本阶段闭合时的真实发现与 owner 决策。

### 12.1 下一阶段的三条候选路径

#### 路径 A — `skill.core` 入场

- 触发条件:本阶段闭合 + 产品驱动浮现 + substrate RFC 提出
- 前置输入:`docs/eval/worker-matrix/skill-core-deferral-rationale.md` §4 四条
- 工作内容:定义 "什么是 skill"、ship `@nano-agent/skill-runtime`、打开 `SKILL_WORKER` binding

#### 路径 B — `context.reranker` / semantic memory engine

- 触发条件:本阶段完成 + compact / assembly 在真实 turn loop 下暴露语义层真实需求
- 前置输入:`docs/eval/after-foundations/smind-contexter-learnings.md` §4.4 / §10
- 工作内容:把 context.core 从薄 substrate 升级为 "slot-aware context engine"

#### 路径 C — Remote-Worker Split

- 触发条件:本阶段完成 + LIVE deploy 真实压力数据表明 in-process assembly 过重
- 前置输入:本阶段 P0 composition 的性能数据 + `docs/issue/after-foundations/B8-phase-1-closure.md` platform cap
- 工作内容:把 `bash.core` / `context.core` / `filesystem.core` 中的一个或多个独立为 remote worker(有独立 wrangler entry)

### 12.2 为什么不预先承诺

- 本阶段 exit 之前所有路径都是投机;必须先让 turn loop 真跑起来,才能有 evidence 驱动选择
- nano-agent 一贯的 "freeze biggest cognition range" 纪律不支持在 substrate 之外预先冻结下一阶段

---

## 13. 最终 Verdict

### 13.1 对当前阶段的最终定义

本阶段不应被表述为:

> "实现 4 个 worker"

而应被表述为:

> **"在 after-foundations 阶段已冻结的 substrate 与协议之上,用一次焦点性 default composition 升级把空柄装成真实 agent turn loop;在此过程中冻结 4 个 first-wave worker 的 charter-level 边界(design 特质 + 沟通管道 + in-scope + out-of-scope);保留 `skill.core` 为 reserved-name 但不做;产出物是 live agent runtime + 4 worker charter-level boundary + `initial_context` consumer + 下一阶段 handoff memo。"**

### 13.2 一句话总结

> **Worker-matrix is not about building workers. It is about completing the one focused assembly pass that turns the shipped substrate into a live agent turn loop, while freezing the cross-worker boundary contract that governs everything built on top of it after the closure.**

### 13.3 对前一阶段 after-foundations 的承接关系

after-foundations 给 worker-matrix 留下了:

- 11 个 shipped package(全绿 2242+ tests)
- NACP 1.3 frozen contract surface(双侧 matrix + error body provisional + initial_context wire hook)
- tenant plumbing materialized(B9-R1 post-fix)
- B7 LIVE wire contract(5 tests 锁住 platform 真实行为)
- 13 份 `docs/eval/worker-matrix/` 上下文 + 4 份 patch 文档
- 1 份 pre-construction 审查(`context-space-examined-by-opus.md`)

worker-matrix 阶段不需要再回头问 "substrate 是否成立"——after-foundations 已经答完。worker-matrix 阶段只需做一件事:**把 substrate 组装成 live agent,并把此时能冻结的所有 boundary 冻结干净**。

---

## 14. 后续文档生产清单与撰写顺序

本阶段文档产出非常收敛(Phase 数量只有 3),但仍保持"design → action-plan → closure"的节奏。

### 14.1 Design / Decision 文档

路径:`docs/design/worker-matrix/`

| 对应 Phase | 文件路径 | 类型 | 说明 |
|---|---|---|---|
| Phase 0 | `docs/design/worker-matrix/W0-default-composition-assembly.md` | Design | 4 subsystem(kernel / llm / capability / workspace / eval)装配细节、env gating、local vs remote profile 决策 |
| Phase 0 | `docs/design/worker-matrix/W0-initial-context-consumer.md` | Design | host 消费 `initial_context` 的时序、`assembler.appendInitialContextLayer` API shape、失败降级策略 |
| Phase 1 | `docs/design/worker-matrix/W1-boundary-crosslink-plan.md` | Design | 哪些下游文档要反向 cross-link 本 charter §6、冲突解决 |
| 跨阶段 | `docs/design/worker-matrix/WX-cross-worker-invariants-enforcement.md` | Spec | §7 五条不变量的 test 执行计划 |

### 14.2 Action-Plan 文档

路径:`docs/action-plan/worker-matrix/`

| 对应 Phase | 文件路径 | 说明 |
|---|---|---|
| Phase 0 | `docs/action-plan/worker-matrix/C1-default-composition-assembly.md` | 装配的 Phase 内多批次执行 |
| Phase 0 | `docs/action-plan/worker-matrix/C2-initial-context-consumer.md` | 消费路径的多批次执行 |
| Phase 1 | `docs/action-plan/worker-matrix/C3-boundary-crosslink-execution.md` | 文档同步 PR 清单 |
| Phase 2 | `docs/action-plan/worker-matrix/C4-closure-and-handoff.md` | closure memo + handoff memo |

### 14.3 撰写顺序建议

1. 先写 `W0-default-composition-assembly.md` + `W0-initial-context-consumer.md`(决定 Phase 0 scope)
2. 再写 `WX-cross-worker-invariants-enforcement.md`(决定 test 补足范围)
3. 再写 `C1 + C2`(动代码前)
4. 动完代码后 Phase 1 的 `W1 + C3` 几乎是机械的 cross-link 工作
5. Phase 2 的 closure + handoff 是最后产出

### 14.4 如果要先控制文档数量,优先看哪几份

如果希望先收敛产出密度,优先推进下面 3 份:

1. `W0-default-composition-assembly.md` — 决定 Phase 0 能否按计划闭合
2. `W0-initial-context-consumer.md` — 决定 orphan 责任是否真落地
3. `WX-cross-worker-invariants-enforcement.md` — 决定 charter §7 是否有 test 背书

这 3 份基本决定本阶段成败;其他文档都是 cross-link / closure 型,依赖这 3 份。

---

## 15. 思维链承接表(Reference Traceability)

为了让本 charter 的每个决策都能反向追溯到原始上下文,下面给出 traceability:

| 本 charter 章节 | 决策内容 | 来源文档 | 来源章节 / 行 |
|---|---|---|---|
| §0 | worker-matrix 定位是 substrate-to-assembly | `docs/eval/worker-matrix/worker-readiness-stratification.md` §4;`docs/eval/worker-matrix/context-space-examined-by-opus.md` §7.3 | 全文 |
| §1.1 第 1 条 | nacp 1.3.0 frozen | `docs/issue/after-foundations/B9-final-closure.md` | §1-§3 + §8 |
| §1.1 第 2 条 | tenant plumbing materialized | B9-R1 post-fix | `nano-session-do.ts:487-535` |
| §1.1 第 4 条 | `initial_context` consumer 归 agent.core | `docs/eval/worker-matrix/context-core/index.md` §6.3 + `agent-core/index.md` §4 | 两侧交叉 |
| §1.2 第 6 条 | 4 first-wave 名单 | `docs/handoff/next-phase-worker-naming-proposal.md:67` | naming proposal |
| §1.2 第 7 条 | context.core 升格但薄做 | `worker-matrix-eval-with-Opus.md` §3 + context-management-eval-by-Opus v2 §7.4 | 两份 eval |
| §1.2 第 8 条 | agent.core 是 host worker | `docs/handoff/after-foundations-to-worker-matrix.md` §4-§6 | handoff memo |
| §1.3 第 10 条 | skill.core 延后 | `docs/eval/worker-matrix/skill-core-deferral-rationale.md` | 整份 |
| §1.3 第 11-12 条 | 4×4 matrix + readiness | `cross-worker-interaction-matrix.md` + `worker-readiness-stratification.md` | 整份 |
| §2.1 | foundations 现状 | 4 份 per-worker `realized-code-evidence.md` | 逐份 |
| §4.1 A | default composition 升级 | `agent-core/index.md` §4(升级后的 Phase 0 唯一必要里程碑口径)+ `worker-readiness-stratification.md` §2.2 | 两份 |
| §4.1 B | `initial_context` consumer | `context-core/index.md` §6.3 + `agent-core/index.md` §6 | 两份 |
| §4.2 | out-of-scope | 4 份 per-worker `index.md` §1.2 + context-space §4.2 | 逐份 |
| §5.1 | assembly-first-iteration | `context-space-examined-by-opus.md` §7.3 | context-space review |
| §5.2 | thin-first | `context-space-examined-by-opus.md` §7.3 | context-space review |
| §5.3 | contract-first-change | `docs/rfc/nacp-core-1-3-draft.md` §3.1.1 consumer guidance | RFC |
| §6.1 | agent.core 细则 | `docs/eval/worker-matrix/agent-core/` 5 份 | 整个目录 |
| §6.2 | bash.core 细则 | `docs/eval/worker-matrix/bash-core/` 5 份 | 整个目录 |
| §6.3 | context.core 细则 | `docs/eval/worker-matrix/context-core/` 5 份(含 §6.1-§6.3 决策锚点) | 整个目录 |
| §6.4 | filesystem.core 细则 | `docs/eval/worker-matrix/filesystem-core/` 5 份(含 §6.1 决策锚点) | 整个目录 |
| §7 | 5 条不变量 | `cross-worker-interaction-matrix.md` §4 | matrix §4 |
| §11 | exit criteria | 继承 `plan-after-foundations.md` §11 方法论,内容基于本 charter | — |
| §12 | 下一阶段候选 | `skill-core-deferral-rationale.md` §4 + smind-contexter-learnings §10 | 两份 |

每一条决策都可以从本 charter 反向追溯到原始上下文或代码事实,确保**没有未经辩证的设计选择被塞进 charter**。

---

## 16. 结语

本 charter 的诞生本身是 nano-agent 项目 "先思考后执行" 纪律的又一轮体现。从 after-foundations 的 spike-driven validation,到 B9 post-review integration,再到 `docs/eval/worker-matrix/` 4 worker × 5 doc 的上下文准备,再到 Opus 的 pre-construction 审查与 4 项 patch,再到本 charter——每一步都把下一阶段的起点推得更稳一点。

> **Worker Matrix 不是 after-foundations 的下一个阶段;它是 after-foundations 与真实 agent 运行之间的最后一道组装 gate。它不引入新能力,但它把 substrate 与 contract 组装成一个真正能跑 agent turn 的 runtime。**

进入下一阶段(skill.core / reranker / remote-worker split 中的某一条路径),我们将拥有:

- 已装配的 default composition(kernel + llm + capability + workspace + eval 全部 live)
- 已消费的 `initial_context`(upstream orchestrator 的 seam 真实闭合)
- 已冻结的 4 worker charter-level 边界(任何下游 design 都必须守住 §6 + §7)
- 已 reserved 的 `skill.core` 与已记录的 unlock checklist
- 已保留的 after-foundations 所有 substrate + contract 不回退

worker-matrix 阶段不会再问 "substrate 是否成立"——after-foundations 已经答完。worker-matrix 阶段只回答一件事:**把 substrate 装成 live agent 的那一次焦点组装,是否干净闭合了**。

---

## 17. 维护约定

- 本 charter 一旦 owner-approved 后不再频繁修订;任何修订需明确触发源(owner decision / patch doc / downstream conflict)
- 修订时必须在顶部 "修订历史" 列出(r1 → r2 → ...)
- 下游文档若与本 charter 冲突,以本 charter 为准;除非下游文档是 owner 新决策的载体,此时应修本 charter
- 本 charter 是 `docs/eval/worker-matrix/` 上下文束的 charter-level 投影;`docs/eval/worker-matrix/` 是代码级 truth,本 charter 是边界级 truth
- 本 charter closure 条件之一:Phase 2 的 handoff memo 落地时,meta-doc `docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md` 应再次 rev 到 "worker-matrix closed" 状态
