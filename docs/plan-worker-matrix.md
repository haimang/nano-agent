# Plan Worker Matrix — Assembly & Absorption Charter

> **状态**:`active charter (r2 fresh rewrite + GPT review pass 2026-04-23)`
> **日期**:`2026-04-23`
> **作者**:`Claude Opus 4.7 (1M context)`
> **审核**:`GPT-5.4 — docs/plan-worker-matrix-reviewed-by-GPT.md (approve-with-followups);R1/R2/R3 已吸收;Q1-Q7 已确认`
> **文档性质**:`phase charter` — worker 边界冻结 / 吸收顺序 / 跨 worker 装配里程碑
>
> **直接输入包(authoritative)**:
> 1. `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md`
> 2. `docs/handoff/pre-worker-matrix-to-worker-matrix.md`
> 3. `docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md`(Revision 4)
> 4. `docs/eval/worker-matrix/index.md`(refreshed root index)
> 5. `docs/eval/worker-matrix/00-contexts/03-evaluations/current-worker-reality.md`
> 6. `docs/design/pre-worker-matrix/W3-absorption-map.md`
> 7. `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md`
> 8. `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`
> 9. `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md`
> 10. `docs/design/pre-worker-matrix/W3-absorption-pattern.md`
> 11. `docs/design/pre-worker-matrix/TEMPLATE-absorption-blueprint.md`
> 12. `docs/rfc/nacp-workspace-rpc.md` / `docs/rfc/remote-compact-delegate.md` / `docs/rfc/evidence-envelope-forwarding.md`
> 13. `docs/eval/worker-matrix/{agent-core,bash-core,context-core,filesystem-core}/index.md`
> 14. `docs/eval/worker-matrix/cross-worker-interaction-matrix.md`
> 15. `docs/eval/worker-matrix/worker-readiness-stratification.md`
> 16. `docs/eval/worker-matrix/skill-core-deferral-rationale.md`
>
> **ancestry-only 参考(不作为直接入口)**:after-foundations final closure / B8 handoff / B9 final closure / 更早的 worker-matrix-eval-with-{GPT,Opus}。

---

## 0. 为什么这份 charter 是 "assembly + absorption" 而不是别的

pre-worker-matrix 阶段(W0-W5)已经闭合。它 **不** 做任何 worker 业务能力,但它把下述 6 件事从纸面冻结成了代码事实:

1. **目录拓扑冻结**:`workers/{agent-core,bash-core,context-core,filesystem-core}/` 物理存在
2. **包策略冻结**:`@haimang/nacp-core` + `@haimang/nacp-session` 是唯二永久外部包;其余 9 个 Tier B packages 是 "absorption 上下文",最终应被吸进 workers
3. **import / publish 策略冻结**:GitHub Packages 已有真实首发(`@haimang/nacp-core@1.4.0` / `@haimang/nacp-session@1.3.0`);`workspace:*` 作为合法 interim 继续存在
4. **方向性 RFC × 3 shipped**:`workspace.fs.*` / remote compact delegate / evidence forwarding — **directional,非 shipped runtime**
5. **最小 scaffold 存在**:`agent-core` real preview deploy 已完成;其余 3 worker dry-run validated
6. **`plan-worker-matrix.md` r2 起跑线被 handoff pack 重写清楚**

因此 worker-matrix 阶段要解决的 **唯一剩余问题** 是:

> **把已 shipped 的 Tier B substrate 按 W3 absorption map 吸收进 `workers/*/src/`,并装配出 live agent turn loop;同时按 W1 RFC 方向激活首波真实需要的 cross-worker 传输,其余保持 host-local 或 deferred。**

简称:

> **Worker Matrix: Assembly + Absorption over Frozen Shells**

本阶段 **不** 做:

- 新建 substrate 包(那是 after-foundations)
- 修改 NACP 协议契约(那是 W0 / B9)
- 重新发明跨 worker 协议 family(W1 RFC 已冻结方向,不升级为 shipped code 直到 live loop 证据需要)
- 重建 `workers/*` 目录或其 deploy shell(W4 已物化)

---

## 1. 继承自 pre-worker-matrix 的冻结事实

### 1.1 协议 / 包 真相层

| 项目 | 当前真相 | 来源 |
|---|---|---|
| NACP core | `@haimang/nacp-core@1.4.0`(已发布到 GitHub Packages) | W2 closure |
| NACP session | `@haimang/nacp-session@1.3.0`(已发布) | W2 closure |
| Publish registry | `https://npm.pkg.github.com`(scope `@haimang`) | W2 pipeline |
| 永久对外包 | 仅 `nacp-core` + `nacp-session`;其余所有包 are absorption inputs | W3 map / charter |
| W1 RFC(workspace-rpc) | `executed directional RFC`,**无 shipped runtime** | `docs/rfc/nacp-workspace-rpc.md` |
| W1 RFC(remote-compact-delegate) | `executed directional RFC`,**继续复用 `context.compact.request/response`** | `docs/rfc/remote-compact-delegate.md` |
| W1 RFC(evidence-forwarding) | `executed directional RFC`,**继续复用 `audit.record` 作 carrier** | `docs/rfc/evidence-envelope-forwarding.md` |
| hooks catalog / evidence vocabulary / storage-law / cross-seam transport | W0 已吸收进 `@haimang/nacp-core` | W0 closure |

### 1.2 部署真相层

| 项目 | 当前真相 | 来源 |
|---|---|---|
| workers 目录 | `workers/{agent-core,bash-core,context-core,filesystem-core}/` 物理存在 | W4 closure |
| agent-core preview deploy | `https://nano-agent-agent-core-preview.haimang.workers.dev` live;Version ID `05baa0b9-2f0a-4982-b036-1855ca97439a` | W4 closure §5.4 |
| 其余 3 workers | dry-run validated,**未真实 deploy** | W4 closure §5.3 |
| CI matrix workflow | `.github/workflows/workers.yml` matrix over 4 workers,`build → test → dry-run` | W4 closure |
| pnpm workspace | `packages/* + workers/*` | W4 closure |
| worker shell 依赖 | `@haimang/nacp-*` 当前走 `workspace:*` interim(故意) | W4 closure §4.3 |
| agent-core service bindings | `SESSION_DO` active;`BASH_CORE / CONTEXT_CORE / FILESYSTEM_CORE` 保持 **注释态 future slots** | W4 closure §2.3 |

### 1.3 W3 absorption map(10 units / 4 workers)

| Unit | 源对象 | 目标 worker | 复杂度 | 有无代表 blueprint |
|---|---|---|---|---|
| A1 | `session-do-runtime` host shell | `agent-core` | 高 | 可选(已写)|
| A2 | `agent-runtime-kernel` | `agent-core` | 中 | 否 |
| A3 | `llm-wrapper` | `agent-core` | 中 | 否 |
| A4 | `hooks` runtime residual | `agent-core` | 中 | 否 |
| A5 | `eval-observability` runtime sink & inspector seam | `agent-core` | 中 | 否 |
| B1 | `capability-runtime` | `bash-core` | 高 | **是(必写)** |
| C1 | `context-management` | `context-core` | 中 | 否 |
| C2 | `workspace-context-artifacts` context slice | `context-core` | 高 | **是(与 D1 成对)** |
| D1 | `workspace-context-artifacts` filesystem slice | `filesystem-core` | 高 | **是(与 C2 成对)** |
| D2 | `storage-topology` residual | `filesystem-core` | 中 | 否 |

7 份非代表 detailed blueprint 由 worker-matrix P0 在对应 absorb PR 开打之前用 `TEMPLATE-absorption-blueprint.md` copy-fill。

### 1.4 当前仓库代码真相(未完成项)

以下是 `plan-worker-matrix` **必须认清** 的硬事实(均有直接代码锚点):

1. `packages/session-do-runtime/src/composition.ts::createDefaultCompositionFactory()` 仍返回空 handle bag — `kernel / llm / capability / workspace / hooks / eval / storage = undefined`
2. `packages/session-do-runtime/src/remote-bindings.ts::makeRemoteBindingsFactory()` 对 `kernel / workspace / eval / storage` 留未解析
3. `packages/session-do-runtime/src/do/nano-session-do.ts::dispatchAdmissibleFrame` 在 `session.start` 分支 **未消费** `body.initial_context`(wire schema 已冻结,但 host 消费路径缺失)
4. `workers/agent-core/src/index.ts` 仍为 version-probe shell,不是 live agent loop
5. `workers/{bash-core,context-core,filesystem-core}/src/index.ts` 均为 version-probe shell,未吸收任何 substrate

### 1.5 `skill.core` 状态

**reserved + deferred**。name 保留在上游 naming / handoff 历史中;`skill.invoke.*` protocol family 已在 NACP;producer role `skill` 已存在;但 **无 substrate 包、无 workers/ shell、无 W3 absorption unit**。worker-matrix **禁止** 把 skill.core 扩成第 5 个 first-wave worker — 详细理由见 `docs/eval/worker-matrix/skill-core-deferral-rationale.md`。

---

## 2. 本阶段 charter 任务

### 2.1 一句话任务

> **按 W3 absorption map 把 10 个 absorption units 吸进 4 个 workers,在吸收过程中装出 live agent turn loop,并激活 first-wave 实际需要的 cross-worker service binding(首要是 `agent.core ↔ bash.core`);不扩 skill.core,不重开拓扑,不升级 W1 RFC 为 shipped runtime 除非 live loop 直接需要。**

### 2.2 一句话产出

- 4 个 workers 的 runtime ownership 已落在 `workers/*/src/`,`packages/*` 不再是 runtime 归属(entrypoint 形状服从各 worker 已选 posture,per GPT R3)
- default composition 装出 live agent turn loop(`kernel + llm + capability + workspace + hooks + eval` 全部接满)
- `initial_context` 已有 host consumer 与 context.core 侧 API,并有 dedicated root e2e 验证
- `agent.core ↔ bash.core` `tool.call.*` service-binding 首波 live(默认远端,`local-ts` 保留为 fallback seam)
- `context.core` / `filesystem.core` 的首波 posture 决策落地(host-local 继续,per Q3c / Q4a)
- `workspace:*` → published path 切换 milestone 经独立 P5 release PR 执行(per Q5c)
- 吸收后的 Tier B packages **per-worker** 打 `DEPRECATED`(per Q6c);物理删除由后续阶段决定
- W3 pattern spec 3 个 placeholder 节被首批 absorb PR 回填

### 2.3 边界约束

1. **不新增 substrate 包**
2. **不修改 NACP wire vocabulary / session message matrix / tenant law**(W0 + B9 契约)
3. **不把 W1 RFC 升级为 shipped cross-worker protocol family** 除非 live loop 证据要求;若要升级,走单独 RFC revision
4. **不重命名 4 个 first-wave workers**
5. **不引入第 5 个 first-wave worker**(`skill.core` 保持 reserved)
6. **不绕过 tenant wrapper**(B9 契约);所有 storage use-site 须经 `getTenantScopedStorage()`
7. **不破坏 B7 LIVE 契约**(5 tests,load-bearing):BoundedEvalSink dedup / overflow disclosure、cross-seam anchor lowercase header、`idFromName(sessionId)` per-session DO 身份

---

## 3. In-Scope / Out-of-Scope

### 3.1 In-Scope

| 编号 | 工作项 | 归属 Phase |
|---|---|---|
| I1 | A1-A5 absorption(`agent.core`) | P1 |
| I2 | B1 absorption(`bash.core`) | P1(可与 I1 并行) |
| I3 | `createDefaultCompositionFactory()` 升级为 live 装配 | P2 |
| I4 | `makeRemoteBindingsFactory()` 对 `kernel / workspace / eval / storage` 补全处理 | P2 |
| I5 | `initial_context` host consumer 接线(`dispatchAdmissibleFrame` → `context.core.appendInitialContextLayer`) | P2 |
| I6 | `agent.core ↔ bash.core` `tool.call.*` service-binding 首波 live | P2 |
| I7 | C1 + C2 absorption(`context.core`) | P3 |
| I8 | `context.core` 默认 compact posture 决策(host-local 保留 / 走远端 delegate / opt-in)| P3 |
| I9 | D1 + D2 absorption(`filesystem.core`) | P4 |
| I10 | `filesystem.core` connected-mode / remote posture 决策 | P4 |
| I11 | `workspace:*` → `@haimang/*` published 切换 milestone | P5 |
| I12 | 吸收完成的 Tier B packages 打 `DEPRECATED` | P5 |
| I13 | W3 pattern spec 3 个 placeholder 回填("LOC→时长系数" / "可执行流水线样板" / "循环引用解决 pattern")| 随首批 absorb PR |
| I14 | agent-core 以外其余 3 worker 升级到 real preview deploy | P2-P4 各自触发 |
| I15 | worker-matrix 阶段 final closure + handoff memo | P5 |

### 3.2 Out-of-Scope

| 编号 | 项目 | 为什么不做 |
|---|---|---|
| O1 | 新建 `skill.core` worker / 任何第 5 个 first-wave worker | 见 §1.5 |
| O2 | 升级 W1 RFC × 3 为 shipped runtime API / helper / message matrix 条目 | RFC-only direction 成立的前提是 live loop 没有直接需要;若证据出现再另起 RFC revision |
| O3 | 修改 NACP wire vocabulary / session message matrix / tenant wrapper 强制 | W0 + B9 契约 |
| O4 | Tier B packages **物理删除** | 本阶段只打 `DEPRECATED` banner;物理删除等消费者全切 + 共存期 ~3 个月 满足后在后续阶段 |
| O5 | Worker-matrix P5 之外的 production env flip | 本阶段 preview 即可;production 升级属于后续 release charter |
| O6 | `browser-rendering` / `python3` / `sqlite3` / mutating git / high-volume curl 等 bash.core 成熟度扩面 | 当前治理真相明确拒绝或延后 |
| O7 | 独立 remote compact worker transport / 独立 remote filesystem RPC family 的 shipped code | first-wave 不需要;`workspace.fs.*` 与 remote-compact 都留在 RFC direction |
| O8 | 对 W3 代表 blueprint 以外的 7 个 units 预先写 detailed blueprint | 按 pattern + map 外推即可;必要时 on-demand 补 |

---

## 4. 4 个 first-wave worker 的 charter-level 定位

> 本节只讲 **charter-level** 纲领:身份、Design 特质、入/出站沟通管道、首波 In-/Out-Scope、关键代码锚点。不进入 design 细节或 action-plan checklist。

### 4.1 `agent.core` — Host Worker

- **身份**:**host worker**,不是 binding slot。物理 DO:`packages/session-do-runtime/src/do/nano-session-do.ts::NanoSessionDO`。Worker entry 壳已在 `workers/agent-core/src/index.ts`,当前只是 version-probe + DO stub。
- **不承担**:user memory / intent routing / cross-session state — 这些由 upstream(`initial_context` 的 producer)负责。
- **Design 特质**:
  - 单 DO per session(`idFromName(sessionId)`),不做 per-user DO
  - 薄 Worker + 厚 DO:Worker entry 只路由;所有业务在 `NanoSessionDO` 内
  - 只有 agent.core 向 client 发 `session.stream.event`;其余 worker 通过 host stream seam 参与
  - host 负责 upstream 调度:`dispatchAdmissibleFrame` 在 `session.start` 时调用 `context.core` 的 `appendInitialContextLayer`
  - honest degrade:缺 kernel / llm 时用空 `{snapshot, events: [], done: true}` 降级,但 P2 完成后不应再触发此路径
- **入站通道(agent.core 作为 consumer)**:

  | 来源 | 协议 | 当前状态 | 本阶段动作 |
  |---|---|---|---|
  | client WS frame | `nacp-session::NacpSessionFrame` + `validateSessionFrame` | real | 不变 |
  | client HTTP fallback | `HttpController` + `acceptIngress` | real | 不变 |
  | `tool.call.response` from bash-core | `nacp-core::ToolCallResponseBodySchema` + `CAPABILITY_WORKER` service-binding reply | seam | **P2 装配活化** |
  | `hook.outcome` | `HookOutcomeBodySchema` + `HOOK_WORKER` service-binding | real | 不变 |
  | `context.compact.response` | in-process via `createKernelCompactDelegate` | real(opt-in)| 保持 opt-in |
  | `initial_context` payload | 嵌 `SessionStartInitialContextSchema` | **shipped wire + missing consumer** | **P2 补 consumer** |

- **出站通道(agent.core 作为 producer)**:

  | 目标 | 协议 | 当前状态 | 本阶段动作 |
  |---|---|---|---|
  | client(WS)| `session.stream.event` | real | 不变 |
  | `bash.core` | `tool.call.request` / `tool.call.cancel` via `serviceBindingTransport` | seam | **P2 kernel dispatcher 走 transport 活化** |
  | `hook.*` worker | `hook.emit` via `HOOK_WORKER` | real | 不变 |
  | `fake.provider` | direct `Fetcher` binding | real | 不变 |
  | DO storage(自身)| `getTenantScopedStorage` + `tenantDoStorage*` | real | 不变 |

- **首波 In-Scope**:A1-A5 absorption + default / remote composition 装配完成 + `initial_context` consumer 接线 + `agent-core service bindings` 活化 + `workers/agent-core/src/` 升级到 live host runtime(非 version-probe)+ charter-level 边界在本 §4.1 冻结
- **首波 Out-of-Scope**:不新建独立 `agent-core-worker` 2nd directory;不引入 user-level DO / cross-session store;不拆 `NanoSessionDO` 为多 DO;不自造 session 层 message types;不放宽 tenant wrapper
- **关键代码锚点**:
  - `packages/session-do-runtime/src/worker.ts:72-88` — Worker entry
  - `packages/session-do-runtime/src/do/nano-session-do.ts:130-280` — DO constructor
  - `packages/session-do-runtime/src/do/nano-session-do.ts:466-535` — WS ingress + `acceptClientFrame` async
  - `packages/session-do-runtime/src/do/nano-session-do.ts:608-645` — `dispatchAdmissibleFrame`(initial_context consumer 落点)
  - `packages/session-do-runtime/src/composition.ts:82-106` — P2 主改点(default composition)
  - `packages/session-do-runtime/src/remote-bindings.ts:324-399` — P2 配套改点(remote composition)
  - `workers/agent-core/src/index.ts` — 本阶段升级目标
  - `workers/agent-core/wrangler.jsonc:26-32` — `BASH_CORE / CONTEXT_CORE / FILESYSTEM_CORE` 注释态 slots,P2 逐步取消注释

### 4.2 `bash.core` — Governed Capability Worker

- **身份**:**governed fake-bash execution engine**,不是 Linux shell 也不是 full just-bash。当前 substrate:`packages/capability-runtime/`。shell:`workers/bash-core/`,dry-run validated。
- **Design 特质**:
  - governed subset:21 commands 在 `commands.ts`,每个带 `policy: allow/ask/deny` + `executionTarget: local-ts/service-binding/browser-rendering`
  - no-silent-success:`FakeBashBridge` 任何 unsupported / narrow-violation 都走 structured error,不静默通过
  - bash-narrow:`curl` 与 `ts-exec` 在 bash path 下严格收窄
  - `tool.call.*` body bridge:只负责 body 层;envelope 在 `nacp-core`
  - honest partial:`mkdir` / `git diff|log` / `ts-exec` 明确标记 partial,不 paper over
  - bash.core 不拥有 `session.*`;对 client 无话语权,只与 host / capability transport 交互
  - capability-runtime 实测 `dependencies: {}`;代表性来自 semantic coupling(fake-bash 外形 + typed runtime + honest-partial 纪律)+ ~9473 LOC,**不是循环引用样本**
- **入站通道**:

  | 来源 | 协议 | 当前状态 | 本阶段动作 |
  |---|---|---|---|
  | `agent.core` kernel | `ToolCallRequestBodySchema` via `CAPABILITY_WORKER` service-binding | seam | **P2 活化** |
  | `agent.core` cancel | `ToolCallCancelBodySchema` via transport | seam | **P2 cancel propagation** |
  | workspace | `WorkspaceFsLike` + `resolveWorkspacePath`(in-process)| real | 不变,但由 `filesystem.core` 吸收后 workspace 来源改为 worker-local / shared substrate |
  | capability policy gate | `AllowAskDenyPolicy`(`policy.ts`)| real | 不变 |

- **出站通道**:

  | 目标 | 协议 | 当前状态 | 本阶段动作 |
  |---|---|---|---|
  | `agent.core` | `ToolCallResponseBodySchema` via `ServiceBindingTarget` | seam | **P2 response 闭环** |
  | `session.stream.event`(via agent.core)| `tool.call.progress` adapter | real | 不变 |
  | workspace write | `namespace.write(...)` | real | 不变 |
  | network(curl)| `fetch` + budget guard | real(low-volume)| 不变;high-volume 由 owner 单独 gate |

- **首波 In-Scope**:B1 absorption 进 `workers/bash-core/src/` + 作为 agent.core default composition 的 `capability` handle 被装配 + `tool.call.*` 双向闭环在装配后 runtime 跑通 + charter-level 边界在本 §4.2 冻结
- **首波 Out-of-Scope**:不扩 21-command registry(新 verb 走 capability-runtime RFC);不解除 `curl` budget 或 `ts-exec` not-connected;不引入 python3 / sqlite3 / browser target;不做 "full shell"(管道嵌套 / redirect / heredoc / process substitution);不把 hook.* / skill.* / context.* 混入 bash 的 tool.call 面
- **关键代码锚点**:
  - `packages/capability-runtime/src/fake-bash/commands.ts:16-315` — 21-command registry
  - `packages/capability-runtime/src/fake-bash/bridge.ts:82-167` — no-silent-success bridge
  - `packages/capability-runtime/src/tool-call.ts:20-160` — tool.call.* body bridge
  - `packages/capability-runtime/src/executor.ts:121-320` — requestId / cancel / timeout / progress
  - `packages/capability-runtime/src/targets/service-binding.ts:90-215` — remote transport target
  - `packages/capability-runtime/src/policy.ts:17-48` — allow/ask/deny policy
  - `packages/session-do-runtime/src/remote-bindings.ts:329-390` — `CAPABILITY_WORKER` 装配入口
  - `workers/bash-core/src/index.ts` — B1 absorption 落点
  - W3 代表 blueprint:`docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md`

### 4.3 `context.core` — Thin Context Substrate

- **身份**:**薄 context substrate**,不是 "完整 context engine"。当前 substrate:`packages/context-management/`(C1)+ `packages/workspace-context-artifacts/` 的 context slice(C2)。shell:`workers/context-core/`,dry-run validated。
- **首波运行位置**:**host 进程内**(session DO 的 composition);不独立 Worker 流量,除非 §4.3 In-Scope I8 的 posture 决策选择独立 service。
- **Design 特质**:
  - opt-in async compact:`AsyncCompactOrchestrator` 存在 testable,但 **不默认自动装**
  - in-process compact(首波):`context.compact.*` 在 host 进程内 via `createKernelCompactDelegate`
  - inspector facade opt-in:默认 OFF;env gate + auth 由 deploy-time wrangler 控制
  - honest partial:`restoreVersion` 仍 throw `not implemented`,保留 stub 诚实度
  - evidence vocabulary:4 类 `assembly / compact / artifact / snapshot` 经 `evidence-emitters.ts` 统一发 `BoundedEvalSink`
  - `initial_context` API 归属:schema 由 `nacp-session` 定义,API(`appendInitialContextLayer`)由 context.core 提供,**调用由 agent.core host 承担**
- **入站通道**:

  | 来源 | 协议 | 当前状态 | 本阶段动作 |
  |---|---|---|---|
  | agent.core host(initial_context 调度)| `appendInitialContextLayer(payload)` | **missing** | **P2 新增 API + 被 host 调用** |
  | agent.core kernel(compact 请求)| `createKernelCompactDelegate` → `tryCommit / forceSyncCompact` | real(opt-in)| 保持 opt-in |
  | agent.core host(assembly)| `ContextAssembler.assemble(layers, budget)` | real | 不变 |
  | agent.core host(snapshot)| `WorkspaceSnapshotBuilder.buildFragment()` | real | 不变 |

- **出站通道**:

  | 目标 | 协议 | 当前状态 | 本阶段动作 |
  |---|---|---|---|
  | agent.core kernel(compact 结果)| `{tokensFreed}` return via delegate | real(opt-in)| 保持 opt-in |
  | `BoundedEvalSink` | 4 类 evidence 记录 | real | 不变 |
  | agent.core host(layers)| `AssembledPrompt` | real | 不变 |
  | inspector HTTP/WS(opt-in)| `InspectorFacade` `/inspect/...` | seam(opt-in)| 不启用默认 |

- **首波 In-Scope**:C1 + C2 absorption 进 `workers/context-core/src/` + 新增 `appendInitialContextLayer` API + 作为 host composition 的 `workspace` handle 被装配 + 默认 compact posture 决策(host-local 保留 / 走远端 delegate / opt-in opt-out 哪个做默认)+ charter-level 边界在本 §4.3 冻结
- **首波 Out-of-Scope**:不升级为厚 semantic engine(slot / reranker / intent-routing 不做);不提前冻结完整 remote compact worker protocol(W1 RFC 保持 direction);不默认打开 inspector facade;不 force `restoreVersion` 实装
- **关键代码锚点**:
  - `packages/context-management/src/{budget,async-compact,inspector-facade}/` — C1 三子模块
  - `packages/workspace-context-artifacts/src/{context-layers,context-assembler,compact-boundary,redaction,snapshot}.ts` — C2 context slice
  - `packages/workspace-context-artifacts/src/evidence-emitters.ts` — mixed helper(build/emit × 4 类 + 2 结构类型);C2 拿 assembly/compact/snapshot,D1 拿 artifact
  - `packages/session-do-runtime/src/do/nano-session-do.ts:608-645` — `initial_context` consumer 落点(host side)
  - `workers/context-core/src/index.ts` — C1+C2 absorption 落点
  - W3 代表 blueprint:`docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`

### 4.4 `filesystem.core` — Typed Workspace / Storage Substrate Worker

- **身份**:**typed workspace / path / ref / storage substrate**,不是 Linux/POSIX 文件系统。当前 substrate:`packages/workspace-context-artifacts/` 的 filesystem slice(D1)+ `packages/storage-topology/`(D2)。shell:`workers/filesystem-core/`,dry-run validated。
- **首波运行位置**:**host 进程内**(通过共享 workspace truth 参与 composition);独立 remote service 延后,不是首波硬要求。
- **Design 特质**:
  - `MountRouter + WorkspaceNamespace + backends + refs + promotion + adapters` 已是真实 substrate
  - workspace truth 单一源:agent.core / bash.core / context.core / filesystem.core **共用同一套 workspace law**,不得 fork
  - `ReferenceBackend.connected` mode 默认保持 memory-only(`connected: false`);切换到 connected 由 owner gate
  - honest partial:`mkdir` / 跨 backend 某些特殊路径保持 partial;不 paper over
  - storage law 遵守 `storage-topology::tenant*` 全局约束(B9 契约);吸收后 tenant wrapper 不得绕过
  - evidence vocabulary:`artifact` 类 build/emit helper 归 filesystem.core
- **入站通道**:

  | 来源 | 协议 | 当前状态 | 本阶段动作 |
  |---|---|---|---|
  | agent.core host workspace use-site | `WorkspaceNamespace` / `MountRouter` / `backends/*` API(in-process)| real | 吸收后改为 worker-local,但 API shape 不漂移 |
  | bash.core workspace consumer | 同上(共用 substrate)| real | 不变;**不引入 filesystem→bash 反向 wire** |
  | context.core workspace / snapshot / artifact 消费 | 同上 | real | 不变 |
  | storage backends(DO/KV/R2)| `storage-topology::tenant*` | real | 不变 |

- **出站通道**:

  | 目标 | 协议 | 当前状态 | 本阶段动作 |
  |---|---|---|---|
  | agent.core eval sink | `artifact` evidence | real | 不变 |
  | context.core snapshot / compact 消费路径 | `WorkspaceSnapshotBuilder` / `CompactBoundaryManager` 输入 | real | 不变 |

- **首波 In-Scope**:D1 + D2 absorption 进 `workers/filesystem-core/src/` + connected-mode / remote posture 决策(host-local 继续 / 局部 remoteize / 全部 host-local 保留 host 进程内)+ `evidence-emitters.ts` mixed helper 的 filesystem slice 归 filesystem-core + charter-level 边界在本 §4.4 冻结
- **首波 Out-of-Scope**:不写 "完整 Linux/POSIX 文件系统";不提前冻结 `workspace.fs.*` remote family 为 shipped runtime(继续保持 W1 RFC direction);不新建独立 `filesystem-core-worker` remote live path 除非 posture 决策明确要求;不 fork workspace law
- **关键代码锚点**:
  - `packages/workspace-context-artifacts/src/{types,paths,refs,artifacts,prepared-artifacts,promotion,mounts,namespace}.ts`
  - `packages/workspace-context-artifacts/src/backends/{memory,reference,types}.ts`
  - `packages/storage-topology/src/{tenant*,placement,adapters,calibration}/**`
  - `packages/workspace-context-artifacts/src/evidence-emitters.ts`(filesystem slice:artifact)
  - `workers/filesystem-core/src/index.ts` — D1+D2 absorption 落点
  - W3 代表 blueprint:`docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`

---

## 5. Phase 规划

### 5.1 Phase 总表

| Phase | 名称 | 目标一句话 | 预估工作量 | 依赖前序 |
|---|---|---|---|---|
| **P0** | Absorption Prep & Charter Freeze | 固化代表性 blueprint 外的 7 份 detailed blueprint、owner 决策、代表性 blueprint reality check | `S` | pre-worker-matrix closed |
| **P1** | A1-A5 + B1 Absorption | `agent.core` 与 `bash.core` 的 src/ 变成真实吸收后的 runtime(未 wire)| `L`(可并行)| P0 |
| **P2** | Live Turn Loop + `initial_context` + agent↔bash Binding | default composition 装出真正的 live agent turn loop;补 `initial_context` consumer;激活 `CAPABILITY_WORKER` service-binding | `L` | P1 |
| **P3** | C1+C2 Absorption + Context Posture | `context.core` src/ 吸收完成;首波 compact / assembly posture 落地 | `M` | P2 |
| **P4** | D1+D2 Absorption + Filesystem Posture | `filesystem.core` src/ 吸收完成;首波 connected-mode / remote posture 落地 | `M` | P2(可与 P3 并行)|
| **P5** | Cutover + Deprecation + Closure | `workspace:*` → published 切换 milestone;吸收完成的 Tier B 打 `DEPRECATED`;worker-matrix closure | `M` | P3 + P4 |

### 5.2 Phase 推进原则

- **P0 是 design-only**:不改任何 `packages/*` 或 `workers/*` 代码。目的是让 P1 可以机械执行。
- **P1 中 A1-A5 与 B1 可并行**(两组 PR 独立),但 **A1-A5 内部不拆成 5 个完全独立 PR**(per Q1c):A1-A5 作为 `P1.A agent-core absorption PR sequence`,必要时在内部再细分 2-3 个 PR,避免 5 unit PR 产生的中间态噪音;B1 作为 `P1.B bash-core absorption 一次 PR`,严格按 `W3-absorption-blueprint-capability-runtime.md` 执行
- **P2 必须在 P1 全绿后开始**:因为 default composition 需要 kernel / llm / capability / workspace / hooks / eval 都已物理吸收
- **P3 / P4 可并行**:C 与 D 的 split 已经在 W3 blueprint 中明确分清;mixed helper(evidence-emitters.ts)按 C2 / D1 owner 表分配
- **P5 要求 P3+P4 全绿 + P2 活锁回归通过**

### 5.3 Phase 内部 sub-phase 建议

- **P1.A** A1-A5 按 W3 map 顺序(host shell → kernel → llm → hooks → eval)
- **P1.B** B1 一次到位
- **P2.A** `appendInitialContextLayer` API shipped(即使 host 还没开始 call)
- **P2.B** `dispatchAdmissibleFrame` consumer 补全
- **P2.C** `createDefaultCompositionFactory()` 升级
- **P2.D** `makeRemoteBindingsFactory()` 补全 4 个 nullable
- **P2.E0** `workers/bash-core` real preview deploy(`pnpm --filter workers/bash-core run deploy:preview`)— **显式前置,per GPT R1**;没有真实上线的 bash-core,agent-core 侧激活 `BASH_CORE` binding 只能得到 "架构没错但目标 worker 不存在" 的假红
- **P2.E** `CAPABILITY_WORKER` service-binding wrangler 激活(`workers/agent-core/wrangler.jsonc` 注释态 slot 开启,`service: nano-agent-bash-core`)+ agent-core preview redeploy
- **P2.F1** live `tool.call.*` 闭环验证(root e2e test 新增):`session.start → kernel tool_call → CAPABILITY_WORKER transport → bash-core response → session.stream.event 回到 client`
- **P2.F2** `initial_context` **dedicated** root e2e(per GPT R2):`session.start` 带 `initial_context` payload → host 调 `appendInitialContextLayer` → assembled prompt / context evidence / downstream 行为出现可验证变化
- **P2.F3** `local-ts` fallback 仍 testable(per Q2):显式 test seam 证明 `local-ts` 可作为 tool.call.* 的 opt-in 开发/回退路径,不被 default 远端决策删除
- **P3.A** C1 吸收
- **P3.B** C2 context slice 吸收(WCA split)
- **P3.C** 默认 compact posture 决策 PR
- **P4.A** D1 filesystem slice 吸收(WCA split)
- **P4.B** D2 storage-topology residual 吸收
- **P4.C** connected-mode / remote posture 决策 PR
- **P5.A** **独立 release PR**(per Q5c):前置条件 = P2/P3/P4 DoD 全绿;内容 = 4 个 worker `package.json` 的 `@haimang/nacp-*` 从 `workspace:*` 切到 `1.4.0` / `1.3.0`,重跑 build/test/dry-run,redeploy agent-core 并 live probe 验证
- **P5.B** 已完成 absorb 的 Tier B packages(先 capability-runtime 与 workspace-context-artifacts,再 context-management 与 storage-topology)打 `DEPRECATED` banner + CHANGELOG
- **P5.C** worker-matrix final closure + handoff memo(若有下一阶段)

---

## 6. Milestones & Definition of Done

### 6.1 P1 DoD

- `workers/agent-core/src/` 含吸收后的 host / kernel / llm / hooks / eval runtime(非 version-probe);`pnpm --filter workers/agent-core test` 全绿
- `workers/bash-core/src/` 含吸收后的 capability-runtime;`pnpm --filter workers/bash-core test` 全绿
- 两个 worker 的 `deploy:dry-run` 全绿
- 全仓 `pnpm -r run test` 绿;root `test/*.test.mjs` 98/98 绿;`npm run test:cross` 112/112 绿
- 首批 absorb PR 的其中一个已回填 W3 pattern spec "LOC→时长系数" + "可执行流水线样板" 两节
- 被吸收的 Tier B packages(`session-do-runtime` / `agent-runtime-kernel` / `llm-wrapper` / `hooks` / `eval-observability` / `capability-runtime`)保留物理存在,**未打 DEPRECATED**(P5 才打)

### 6.2 P2 DoD

- **P2 prerequisite(per GPT R1)**:`workers/bash-core` **real preview deploy** 完成(URL live + `curl` 返回预期 version-probe JSON),且其 wrangler service name(`nano-agent-bash-core`)可被 agent-core 的 `BASH_CORE` binding 引用。这是 P2 开启的硬条件,不是风险提示
- `createDefaultCompositionFactory()` 不再返回空 handle bag;`kernel / llm / capability / workspace / hooks / eval` 全部非 `undefined`
- `makeRemoteBindingsFactory()` 对 `kernel / workspace / eval / storage` 4 个 nullable 有显式处理(不 panic,honest 降级或真实装配)
- `SessionStartBodySchema.initial_context` 的 host consumer 接线完成:`dispatchAdmissibleFrame` 在 `session.start` 分支消费 body.initial_context 并调 `context.core.appendInitialContextLayer`
- `workers/agent-core/wrangler.jsonc` 中 `BASH_CORE` service binding 取消注释并 active
- `agent-core` preview redeploy 成功;live probe 返回包含 `live_loop: true`(或类似 non-version-probe 判断键)的 JSON
- **Root e2e #1(tool.call 闭环)**:发起 `tool.call.request` → 经 `CAPABILITY_WORKER` transport 到 bash-core → response 返回 agent-core → stream back to client
- **Root e2e #2(`initial_context` dedicated,per GPT R2)**:`session.start` 带 `initial_context` payload,host `dispatchAdmissibleFrame` 调 `appendInitialContextLayer`,后续 assembled prompt / context evidence / downstream 行为出现可验证变化(即不是只验证 API shape,而是验证 payload 真被消费且影响了 context layer stack)
- **Fallback seam testable(per Q2)**:`local-ts` transport 仍可通过显式 opt-in(test env 或 local dev 配置)跑 `tool.call.*`,证明默认 `serviceBindingTransport` 不是唯一合法路径
- B7 LIVE 5 tests 仍全绿

### 6.3 P3 DoD

- `workers/context-core/src/` 含吸收后的 C1 + C2 runtime
- `appendInitialContextLayer` API 在 context-core 可调;P2 的 host consumer 仍绿
- compact posture PR merged:选项 A(host-local 保留 opt-in)/ 选项 B(remote delegate helper + opt-in env flag)/ 选项 C(其他)之一明确落地
- `context-core` preview deploy 成功(或明确记录 defer 到 P5)
- `packages/workspace-context-artifacts` context slice(assembly / compact-boundary / redaction / snapshot + mixed helper 的 context 部分)在 workers/context-core 内成立;package 版本内 slice 仍 re-export 直到 P5 deprecation

### 6.4 P4 DoD

- `workers/filesystem-core/src/` 含吸收后的 D1 + D2 runtime
- connected-mode / remote posture 决策 PR merged:host-local 继续 / 局部 remoteize / 全部 host-local 明确三选一
- workspace truth 仍单一:bash.core / context.core / filesystem.core / agent.core 均消费同一套 `WorkspaceNamespace` 行为,无 fork
- `filesystem-core` preview deploy 成功(若 posture 选择真 remote)或明确记录 defer
- `storage-topology::tenant*` 仍 load-bearing;tenant wrapper 约束未被绕过

### 6.5 P5 DoD

- 4 个 worker 的 `package.json` 中 `@haimang/nacp-core` / `@haimang/nacp-session` 从 `workspace:*` 切到 `1.4.0` / `1.3.0`;`deploy:dry-run` 仍绿;agent-core preview redeploy 成功
- 已吸收的 Tier B packages(至少:`capability-runtime` / `session-do-runtime` / `workspace-context-artifacts` / `storage-topology` / `context-management` / `hooks` / `agent-runtime-kernel` / `llm-wrapper` / `eval-observability`)READMEs 顶部加 `⚠️ DEPRECATED — absorbed into workers/<dest>/`;CHANGELOG 更新
- Tier B packages **物理保留**(不删文件);物理删除由后续 charter 决定 trigger
- `docs/issue/worker-matrix/worker-matrix-final-closure.md` shipped
- `docs/handoff/worker-matrix-to-<next>.md` shipped(若有下一阶段)

---

## 7. Owner decisions(必须在 P0 / 对应 Phase 开工前落)

> **口径说明**:以下 7 问已经过 GPT review(`docs/plan-worker-matrix-reviewed-by-GPT.md` §5)+ owner confirmation,全部 `confirmed`。保留问答结构作为执行期 audit trail。

### Q1 — absorption 首批 PR 粒度

- **影响范围**:P1
- **候选**:(a) 每个 absorption unit 一个 PR(10 PRs)/ (b) 按 worker 组 PR(4 PRs)/ (c) 按 sub-phase 序列 PR(P1.A / P1.B)
- **最终决策**:**(c) — 按 sub-phase / worker 组**(per GPT §5.1)
- **理由**:
  1. `A1-A5` 之间天然耦合,拆成 5 个完全独立 PR 会带来大量中间态噪音
  2. `B1` 本身是一个完整、边界清晰的单元,适合独立 PR
  3. first-wave 的真实粒度诉求是 "每个 worker / 每个子阶段可验证",不是 "每个 unit 都独立 PR"
- **落地**:
  - `P1.A = agent-core absorption PR sequence`(必要时在 A1-A5 内部再细分 2-3 个 PR,而不是 5 个 unit PR)
  - `P1.B = bash-core absorption 一次 PR`
- **状态**:`confirmed`

### Q2 — `tool.call.*` default transport 选择

- **影响范围**:P2
- **候选**:(a) 默认走 `serviceBindingTransport`(远端)/ (b) 默认走 `local-ts` + 远端作 opt-in / (c) 按 command policy 分流
- **最终决策**:**(a) + `local-ts` 显式 fallback seam 保留**(per GPT §5.2)
- **理由**:
  1. 如果 first-wave 不默认走远端,worker-matrix 就没有真正 battle-test 最关键的 cross-worker loop
  2. `local-ts` 仍有价值(单测 / 故障回退 / preview 之外的开发路径)— 不得因 "默认远端" 而被删除
  3. 正确表述是 "**远端是默认真相,本地是显式 fallback**"
- **落地**:
  - `serviceBindingTransport` 成为默认 `tool.call.*` 路径
  - `local-ts` 继续作为 test seam / opt-in dev path,保留在 registry 但不作默认
  - P2.F3 / P2 DoD "Fallback seam testable" 要求 `local-ts` 仍可 opt-in 运行
- **状态**:`confirmed`

### Q3 — 默认 compact posture

- **影响范围**:P3
- **候选**:(a) host-local compact + opt-in remote delegate / (b) remote compact delegate helper shipped 作默认 / (c) 保持当前 opt-in 不默认装
- **最终决策**:**(c) — 保持当前 opt-in,首波不自动装**(per GPT §5.3)
- **理由**:
  1. compact 不是 first-wave 唯一关键闭环;`agent↔bash` 才是
  2. 保持 opt-in 能让 `context.core` 吸收范围维持在 "assembly + boundary + evidence + API ownership"
  3. 最符合 conservative-first,最不容易把 `context.core` 拉成厚引擎
- **状态**:`confirmed`

### Q4 — filesystem first-wave remote posture

- **影响范围**:P4
- **候选**:(a) host-local 继续(默认不 remoteize)/ (b) 局部 remoteize(artifact promotion / reference backend 到 `filesystem-core` remote,其余 host-local)/ (c) 全部 remoteize(在首波做完整 filesystem RPC)
- **最终决策**:**(a) — host-local 继续**(per GPT §5.4)
- **理由**:
  1. 符合 workspace truth 单一源要求
  2. 允许先完成 D1+D2 absorption + connected-mode 决策,不引入不必要的 RPC
  3. 把 `filesystem.core` 当作 typed substrate 而非 full FS service 的正确写法
- **状态**:`confirmed`

### Q5 — `workspace:*` → published cutover trigger

- **影响范围**:P5
- **候选**:(a) 首批 absorb merge 并稳定 1 周后 / (b) 4 workers 全部完成 preview deploy 升级后 / (c) 独立 release PR schedule
- **最终决策**:**(c) — 独立 release PR schedule**(per GPT §5.5,**不是** (a) 的日历化触发)
- **理由**:
  1. published-path cutover 是 **closure / release hygiene**,不是 first-wave 架构证明的一部分
  2. 应绑定在显式 release checklist,不是 "稳定 1 周" 这种模糊时间条件
  3. 能同时避免 `workspace:*` interim 漂成 permanent,以及过早 cutover 把 P2/P3/P4 验证噪音带进包版本管理
- **落地**:
  - P5.A 改写为 "P2/P3/P4 DoD **全绿后**,开独立 P5 release PR 执行 published-path cutover"
  - 该独立 PR 含:4 个 worker `package.json` 从 `workspace:*` 切到 `1.4.0` / `1.3.0`、build/test/dry-run 回归、agent-core preview redeploy 验证
- **状态**:`confirmed`

### Q6 — Tier B deprecation banner 时机

- **影响范围**:P5
- **候选**:(a) 对应 absorb PR merge 当日 / (b) P5 统一一次打 / (c) 每 worker 完成后逐个打
- **最终决策**:**(c) — 逐 worker 逐个打 deprecated**(per GPT §5.6)
- **理由**:
  1. 最诚实:哪个 worker 先稳定,对应 package 先贴 banner
  2. 避免过早贴 deprecated 误伤现有消费者,也避免最后统一贴导致 "吸收完成但 repo 口径仍旧"
  3. 最方便把 deprecation 与对应 absorb PR / CHANGELOG 绑定
- **状态**:`confirmed`

### Q7 — skill.core 是否在 worker-matrix 内被 admit

- **影响范围**:全阶段
- **最终决策**:**否 — 保持 reserved + deferred**(per GPT §5.7)
- **理由**:
  1. admit `skill.core` 会把 4-worker charter 变成 5-worker charter
  2. 没有 substrate 可吸收,等于把 greenfield invention 混进 assembly phase
  3. 会直接破坏整个计划的 conservative-first 边界
- **状态**:`confirmed`

---

## 8. 风险 & 依赖

| 风险 / 依赖 | 当前判断 | 应对 |
|---|---|---|
| A1 host shell 吸收破坏 B7 LIVE 5 tests | `high` | 每个 A1 sub-PR 都跑 `node --test test/*.test.mjs`;若红,回滚 sub-PR |
| `workspace:*` interim 漂移成 permanent | `medium` | P5 DoD 含明确 cutover;Q5 owner 决策锁 trigger |
| `initial_context` consumer 装错层导致 schema 解析泄漏到 agent-core | `medium` | consumer API 由 context.core 拥有;agent-core 只 call;P2.A 先 ship context 侧 API 再改 host |
| WCA split 时 mixed helper 归属被误判 | `high` | 严格遵循 W3 blueprint §3.3 的 helper owner 表;context / filesystem evidence helpers 分别归 C2 / D1 |
| B1 吸收时误扩 21-command registry | `medium` | PR review gate:任何新 verb 触发 capability-runtime RFC,不得搭车 B1 absorption |
| `packages/` 与 `workers/` 共存期 bug 双修漂移 | `medium` | 按 W3 pattern spec §6 纪律:共存期 bug 先修原包,再同步 workers 侧;P5 cutover 后 flip |
| agent-core preview deploy 因 `CAPABILITY_WORKER` binding 活化失败(bash-core 未 deploy)| `high` | P2.E 前必须先把 bash-core real preview deploy 完成,再在 agent-core 激活该 binding |
| W1 RFC 被误升级为 shipped code 以"方便"first-wave | `medium` | charter §2.3 / §3.2 O2 硬约束:除非 live loop 直接要求,否则保持 direction-only;升级走独立 RFC revision |
| skill.core 在 PR review 中被偷偷 admit | `low` | charter §1.5 / §3.2 O1 硬约束 + `skill-core-deferral-rationale.md` 引用 |

---

## 9. Exit Criteria(primary,本阶段 6 条硬闸)

本阶段 **NOT** 退出若以下任一未满足:

1. **live agent turn loop 端到端运行**:从 client WS `session.start` 开始,经 `initial_context` consumer → context.core assembly → kernel tool_call → bash-core service-binding → response → session.stream.event 回到 client 的完整链路在 preview env 真实跑通(含 P2 DoD 的 **两个** root e2e:tool.call 闭环 + `initial_context` dedicated)
2. **4 workers 的 runtime ownership 已吸收到 `workers/*/src/`**(per GPT R3 重述):`packages/*` 不再是主要运行归属;各自的 `src/` entrypoint **形状服从其已选 posture**:
   - `agent.core` / `bash.core` — live runtime(非 version-probe)
   - `context.core` / `filesystem.core` — 形状由 Q3/Q4 确认的 host-local posture 决定(可以继续以薄 entrypoint 形式存在,只要 **ownership 不再归 `packages/*`**,且共享 substrate 已实际被 `workers/<name>/src/` 拥有)
3. **`@haimang/nacp-*` published path cutover 完成**:4 个 worker `package.json` 的 nacp 依赖从 `workspace:*` 切到具体版本号(`1.4.0` / `1.3.0`);agent-core preview 仍绿(via 独立 P5.A release PR,per Q5c)
4. **已吸收 Tier B packages 全部打 `DEPRECATED`**:README + CHANGELOG;物理保留;打 banner 的节奏是 **per-worker absorb-stable**(per Q6c)
5. **B7 LIVE 5 tests 仍全绿**;`pnpm -r run test` 仍全绿;`npm run test:cross` 仍全绿
6. **worker-matrix final closure + handoff memo shipped**:含 4 workers 最终状态、3 个 W3 pattern placeholder 回填状态、下一阶段 rewrite trigger

### Secondary outcomes(非硬闸,但属 charter 价值)

- W3 pattern spec 3 个 placeholder 节全部已回填
- 其余 3 workers(bash / context / filesystem)各自至少 1 次 real preview deploy
- `docs/design/worker-matrix/` 新增 charter-level boundary 子 design(可选)

### NOT-成功退出识别

若出现以下任一,本阶段 NOT 退出:

- primary 1-6 任一未满足
- tenant wrapper 被绕过(B9 契约破坏)
- `NACP_CORE_TYPE_DIRECTION_MATRIX` / `NACP_SESSION_TYPE_DIRECTION_MATRIX` / `SessionStartInitialContextSchema` 任一被私修
- 出现第 5 个 first-wave worker
- W1 RFC 被升级为 shipped code 而无独立 RFC revision
- Tier B packages 在 absorb 未稳定前就物理删除

---

## 10. 下一阶段触发条件

worker-matrix 结束后,下一阶段应由以下 2 类 trigger 之一启动:

1. **live loop stability trigger**:worker-matrix 收口后的 preview live loop 连续稳定 2-4 周 → 触发 production env flip 的 release charter
2. **scope expansion trigger**:owner 明确 admit `skill.core` 或其他第 5 个 worker → 触发 `plan-<next>.md` rewrite(类似本次 r2 的 clean rewrite)

在 worker-matrix 内 **不** 触发 production flip / 第 5 worker 扩 scope。

---

## 11. 维护规则

本 charter 在以下任一发生时必须在 **同 PR** 内同步修订:

1. 4 个 worker 中任一完成 real preview deploy 或 production flip
2. `@haimang/nacp-core` / `@haimang/nacp-session` 任一发新版
3. W3 pattern spec 有 placeholder 节被回填
4. owner 决策 Q1-Q7 的任一回答
5. W1 RFC 任一升级为 shipped code(需独立 RFC revision 作前置)
6. `workspace:*` → published cutover 触发
7. `skill.core` scope posture 改变(从 reserved 变为 admitted)

### 11.1 已收口 Phase 索引

- **P0 Absorption Prep**(2026-04-23 收口) — 见 [`docs/issue/worker-matrix/P0-absorption-prep-closure.md`](./issue/worker-matrix/P0-absorption-prep-closure.md)。含 P2.E0 owner decision、P1.A/P1.B kickoff checklist、D01-D09 R1-R5 吸收索引、10 units 映射 index。P1 kickoff PR 的 body 直接引用本 memo。

---

## 12. 一句话总结

> **Worker-matrix 不是 "worker 的重新定义阶段",而是 "用已冻结的拓扑 + 已发布的协议包 + 已写好的 absorption map,把 Tier B substrate 吸进 4 个 worker 壳,装出 live agent turn loop,激活 first-wave 真实需要的 cross-worker 服务绑定,并把 `workspace:*` interim 切换到 published path" 的一次性装配 + 吸收阶段。skill.core 保持 reserved;W1 RFC 保持 direction-only;Tier B packages 保持物理存在直到下一个阶段决定删除时机。**
