# P2 — Live Turn Loop Activation(initial_context + composition + agent↔bash tool.call)

> 服务业务簇: `worker-matrix / Phase 2 — Live Turn Loop Activation`
> 计划对象: `D05(initial_context host consumer,已吸收 D01-D09 GPT review R1+R2)+ D06(default composition + remote-bindings 4 nullable,已吸收 D01-D09 GPT review R1)+ D07(BASH_CORE canonical binding 激活 + local-ts fallback 保留)+ P1-P5 GPT review R1(appendInitialContextLayer 不作 mutator / 不发明 layer kind / 断言 assembledKinds 含 canonical mapped kind)+ R2(wire 上只有 session.start.initial_input / session.followup_input.text,`turn_input` 仅为 runtime 内部概念)`
> 类型: `new`(host consumer / composition handle / binding 激活) + `upgrade`(empty bag → live composition;seam → active service-binding) + `modify`(wrangler 取消注释)
> 作者: `Claude Opus 4.7 (1M context)`
> 时间: `2026-04-23`
> 文件位置:
> - `workers/agent-core/src/host/do/nano-session-do.ts`(`dispatchAdmissibleFrame` session.start 分支新增 consumer)
> - `packages/session-do-runtime/src/do/nano-session-do.ts`(共存期两处落,D05 S2)
> - `workers/agent-core/src/host/composition/index.ts`(升级 createDefaultCompositionFactory)
> - `workers/agent-core/src/host/composition/remote-bindings.ts`(补 4 nullable)
> - `workers/agent-core/wrangler.jsonc`(`BASH_CORE` 取消注释 + service 名对齐 `nano-agent-bash-core`)
> - `test/initial-context-live-consumer.test.mjs`(root e2e #2)
> - `test/tool-call-live-loop.test.mjs` 或等价(root e2e #1)
> 关联设计 / 调研文档:
> - `docs/plan-worker-matrix.md` §5.3 P2.A-F3 / §6.2 P2 DoD
> - `docs/design/worker-matrix/D05-initial-context-host-consumer.md` v0.2(已吸收 R1+R2)
> - `docs/design/worker-matrix/D06-default-composition-and-remote-bindings.md` v0.2(已吸收 R1)
> - `docs/design/worker-matrix/D07-agent-bash-tool-call-activation.md` v0.1
> - `docs/issue/worker-matrix/P1-closure.md`(P2 kickoff gate)
> 文档状态: `draft`

---

## 0. 执行背景与目标

P1 结束时,`workers/agent-core/src/` 已吸收 host/kernel/llm/hooks/eval runtime,`workers/bash-core/src/` 已吸收 capability-runtime + real preview deploy URL live。但现在两个 worker 之间仍然 **不联通**:

1. `createDefaultCompositionFactory()` 返回空 handle bag,kernel/llm/capability/workspace/hooks/eval 全是 undefined — turn loop 无法跑
2. `makeRemoteBindingsFactory()` 对 kernel/workspace/eval/storage 4 nullable 未处理 — silent undefined 漂到下游
3. `dispatchAdmissibleFrame` session.start 分支**未消费** `body.initial_context` — wire schema 冻结了一年,host 仍不读
4. `workers/agent-core/wrangler.jsonc` 的 `BASH_CORE` service binding 仍是注释态 — agent↔bash 远端 loop 没有激活

P2 的唯一任务是把上述 4 件事按**显式序列**解决,在 preview env 中把 **host consumer + BASH_CORE capability binding seam** 接到真实 worker identity 上,并由 **两个** root tests(binding seam guard + initial_context dedicated)固化为持续守护的契约。

P2 的执行顺序 **非**组间并行;因为 D07 的 binding 激活依赖 D06 的 capability handle 就位,D05 的 consumer 依赖 D06 的 workspace.assembler 非 undefined(per R1)。

P2 **要求** 在开始之前 `workers/bash-core` preview URL 已 live(P2.E0 per GPT R1)—— 这条 hard prerequisite 已在 P0 Q3 + P1 Phase 5 落地,本 action-plan 在 Phase 0 gate check 再次 enforce。

- **服务业务簇**:`worker-matrix / Phase 2 — live-loop-activation`
- **计划对象**:composition 升级 + remote-bindings 补 4 + initial_context host consumer + BASH_CORE binding 激活 + local-ts fallback seam 保留 + 2 条 root tests
- **本次计划解决的问题**:
  - `createDefaultCompositionFactory()` 返回空 handle bag,turn loop 不跑`
  - `makeRemoteBindingsFactory()` 4 nullable silent undefined`
  - `initial_context` wire 冻结但 host 无 consumer`
  - `agent↔bash tool.call` seam 存在但 binding 注释态`
  - 本地 `local-ts` transport 若因"默认远端"被误删,失去单测 / 故障回退 / preview 外开发路径`
- **本次计划的直接产出**:
  - `createDefaultCompositionFactory` 返回 6 handle 全部非 undefined(storage 显式 null 也算非 undefined)
  - `makeRemoteBindingsFactory` 4 nullable 有显式处理(null + 文档说明 reason)
  - `NanoSessionDO.dispatchAdmissibleFrame` session.start 分支消费 `body.initial_context` 并调 `appendInitialContextLayer(workspace.assembler, ...)`(R1 口径)
  - 异常时走合法 `system.notify severity=error` 而非自造 `system.error`(R2 口径)
  - `workers/agent-core/wrangler.jsonc` `BASH_CORE` 取消注释 + service 名 `nano-agent-bash-core`
  - `CAPABILITY_TRANSPORT` env 切换:default = service-binding;`local-ts` 保留 opt-in seam(Q2a)
  - agent-core preview redeploy + live probe 含 `live_loop: true`(或等价非 version-probe 字段)
  - root e2e #1 `tool.call` 闭环 + root e2e #2 `initial_context` dedicated 全绿
  - B7 LIVE 5 tests 仍全绿

---

## 1. 执行综述

### 1.1 总体执行方式

**严格显式序列**,因 D06 / D05 / D07 存在硬依赖:

```
Phase 0 gate check (P1 closed + bash-core preview live)
  ↓
Phase 1 D03 F4 API shape freeze (appendInitialContextLayer 签名落盘,空 stub 也可)
  ↓
Phase 2 D06 composition factory 升级(workspace.assembler 可被拿到)
  ↓
Phase 3 D05 host consumer 接线 + packages 侧对称落(共存期两处)
  ↓
Phase 4 D07 BASH_CORE canonical binding 激活 + wrangler 取消注释 + env switch
  ↓
Phase 5 root e2e #1(tool.call 闭环)+ #2(initial_context dedicated)
  ↓
Phase 6 agent-core preview redeploy + live probe + 全仓回归 + P2 closure
```

每 Phase 独立 PR 可 revert;Phase 2/3 之间存在"D06 先 merge,D05 再 merge"硬序。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 0 | P2 kickoff gate check | `XS` | 确认 P1 closed + bash-core preview URL live + Version ID 记录 | P1 closed |
| Phase 1 | D03 F4 `appendInitialContextLayer` API shape 冻结(stub)| `XS` | API 签名 + 实现 stub(可以空函数 / no-op push)落在 `workers/agent-core/src/host/context-api/` 或临时 `src/context/` 下(由 P3 迁到 context-core)| Phase 0 |
| Phase 2 | D06 composition factory 升级 | `L` | `createDefaultCompositionFactory` 返回 6 handle(含 workspace.assembler 非 undefined);`makeRemoteBindingsFactory` 补 4 nullable;local-ts fallback seam 保留 | Phase 1 |
| Phase 3 | D05 host consumer 接线 | `M` | `NanoSessionDO.dispatchAdmissibleFrame` session.start 分支消费 initial_context;packages/workers 两处对称落 | Phase 2 |
| Phase 4 | D07 binding 激活 + wrangler 取消注释 | `M` | `workers/agent-core/wrangler.jsonc` `BASH_CORE` 激活;`CAPABILITY_TRANSPORT` env switch;local-ts 保留 opt-in | Phase 3 |
| Phase 5 | 两条 root e2e 落盘 | `M` | `test/tool-call-live-loop.test.mjs` 新增;`test/initial-context-live-consumer.test.mjs` 新增 | Phase 4 |
| Phase 6 | agent-core preview redeploy + 全仓回归 + P2 closure | `S` | preview URL live + `live_loop: true`;B7 LIVE 5 + 98 root + 112 cross 全绿 | Phase 5 |

### 1.3 Phase 说明

1. **Phase 0 — kickoff gate check**:P2 kickoff PR body 必须引用 P1 closure memo + bash-core preview URL + Version ID;若 bash-core preview URL 不可 curl,P2 block,回 P1
2. **Phase 1 — D03 F4 API shape 冻结**:`appendInitialContextLayer(assembler, payload)` 签名在 P2 开头就 ship 出去(即使内部是 no-op),让 D06/D05 的代码有目标 API 可调。物理落点暂在 `workers/agent-core/src/host/context-api/append-initial-context-layer.ts`(或临时 `src/context/`);P3 执行 C1 吸收时迁到 `workers/context-core/src/`
3. **Phase 2 — D06 composition**:`createDefaultCompositionFactory` 从空 bag 升到 live 装配 — kernel 从 `src/kernel` 实例化;llm 从 `src/llm`;capability 用 `serviceBindingTransport`(Q2a 远端默认);workspace 用 `composeWorkspaceWithEvidence`(host-local,Q4a);hooks 从 `src/hooks`;eval 用 `BoundedEvalSink`。`makeRemoteBindingsFactory` 对 kernel/workspace/eval/storage 显式返回 null + reason 文档。local-ts fallback:capability handle factory 保留 opt-in 路径(env `CAPABILITY_TRANSPORT=local-ts` 切回本地)
4. **Phase 3 — D05 host consumer**:`dispatchAdmissibleFrame` session.start 分支在 `extractTurnInput` **之前** 消费 `body.initial_context`;拿 `this.composition?.workspace?.assembler`(R1);异常走 `system.notify severity=error`(R2)。packages/ 和 workers/ 两份对称落(共存期)
5. **Phase 4 — D07 binding 激活**:`workers/agent-core/wrangler.jsonc` 取消注释 `BASH_CORE = { service = "nano-agent-bash-core" }`;`CAPABILITY_TRANSPORT` env 默认空(= service-binding) / `local-ts` 为 opt-in;P2.F3 fallback seam 明确 testable(开 env 就切回 local)
6. **Phase 5 — root tests**:新增 #1 `tool-call-live-loop.test.mjs`(wrangler `BASH_CORE` 激活 / default composition remote path / NanoSessionDO 默认 remote selection / transport seam / R2 wire truth)+ #2 `initial-context-live-consumer.test.mjs`(3 positive + 1 negative,只断言 canonical assembled kind 与 consumer observable diff)
7. **Phase 6 — redeploy + closure**:agent-core preview redeploy;live probe JSON 含 `live_loop: true`(或等价非 probe 字段);B7 LIVE + 98 root + 112 cross + 两 workers test + dry-run 全绿;`docs/issue/worker-matrix/P2-closure.md`

### 1.4 执行策略说明

- **执行顺序原则**:严格序列 Phase 0→1→2→3→4→5→6;任一 Phase 红则 block 下一个
- **风险控制原则**:每 Phase 独立 PR 可 revert;bash-core preview URL live 是 P2 硬前置
- **测试推进原则**:Phase 2-4 每 PR 跑 B7 LIVE + 全仓 tests;Phase 5 根上两条 e2e 跑 + dry-run;Phase 6 跑全部 + preview live probe
- **文档同步原则**:P2 closure memo 引用 D05/D06/D07 v0.x 对齐的事实锚点

### 1.5 本次 action-plan 影响目录树

```text
worker-matrix/P2/
├── Phase 1 — D03 F4 API stub/
│   └── workers/agent-core/src/host/context-api/
│       └── append-initial-context-layer.ts       [新建 API stub;P3 迁 context-core]
├── Phase 2 — D06 composition upgrade/
│   ├── workers/agent-core/src/host/composition/index.ts   [createDefaultCompositionFactory 升级]
│   └── workers/agent-core/src/host/composition/remote-bindings.ts  [补 4 nullable]
├── Phase 3 — D05 host consumer/
│   ├── workers/agent-core/src/host/do/nano-session-do.ts  [+ session.start initial_context consumer]
│   └── packages/session-do-runtime/src/do/nano-session-do.ts  [共存期对称落]
├── Phase 4 — D07 binding activation/
│   └── workers/agent-core/wrangler.jsonc  [BASH_CORE 取消注释]
├── Phase 5 — root e2e/
│   ├── test/tool-call-live-loop.test.mjs            [新建 root e2e #1]
│   └── test/initial-context-live-consumer.test.mjs  [新建 root e2e #2]
├── Phase 6 — redeploy + closure/
│   ├── agent-core preview redeploy (URL live + live_loop: true)
│   └── docs/issue/worker-matrix/P2-closure.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope

- **[S1]** D03 F4 `appendInitialContextLayer(assembler, payload)` API stub 落在 `workers/agent-core/src/host/context-api/`(临时位置;P3 迁 context-core)。**实现形态(per P1-P5 GPT review R1)**:不在 `ContextAssembler` 上新增 `appendLayer()` mutator;**不**发明 `initial_context` 这个 layer kind(当前 `ContextLayerKindSchema` 仅 `system / session / workspace_summary / artifact_summary / recent_transcript / injected` 6 个,`initial_context` 不存在);改为 helper **维护 assembler 之外的 pending layers** — 每次 consumer 调 `appendInitialContextLayer(assembler, payload)`,helper 把 payload 映射成现有 canonical layer kinds(以 `session` / `injected` 为首选,由 helper 内部根据 payload 形态选),合并入 helper 维护的 pending list;下次 DO 调 `assembler.assemble(layers)` 时,host 把 pending list 与既有 turn-level layers 合并传入 — `assembler.assemble()` API **保持 byte-identical,不改公共 API shape**
- **[S2]** D06 `createDefaultCompositionFactory` 升级:6 handle 全非 undefined;workspace 用 `composeWorkspaceWithEvidence`(含 `ContextAssembler` 实例);capability 用 `serviceBindingTransport` 作 default;local-ts fallback seam 保留(env `CAPABILITY_TRANSPORT=local-ts` 可切回)
- **[S3]** D06 `makeRemoteBindingsFactory` 对 kernel/workspace/eval/storage 4 nullable 显式处理:返回 null + 附 reason 文档注释("kernel 始终 host-local"/"workspace host-local per Q4a"/"eval sink owner 在 host"/"storage tenant wrapper 在 host DO")
- **[S4]** D06 `SubsystemHandles` 保持现有 8 槽位(`kernel/llm/capability/workspace/hooks/eval/storage/profile`);**不**新增 top-level `assembler`(R1 口径;assembler 继续挂在 `WorkspaceCompositionHandle.assembler` 下)
- **[S5]** D05 host consumer:`NanoSessionDO.dispatchAdmissibleFrame` session.start 分支在 `extractTurnInput` 之前新增 ~10-25 行:读 `body.initial_context`,取 `const assembler = this.composition?.workspace?.assembler`(R1),若 assembler + payload 均在则调 `appendInitialContextLayer`,异常走 `pushStreamEvent({kind:"system.notify", severity:"error", message:"initial_context_consumer_error: ..."})`(R2),不 abort turn
- **[S6]** D05 共存期对称:同 logic 落 `packages/session-do-runtime/src/do/nano-session-do.ts`(P5/D09 deprecate 时清理)
- **[S7]** D07 `workers/agent-core/wrangler.jsonc` `BASH_CORE` 取消注释,service 名 `nano-agent-bash-core`
- **[S8]** D07 env switch:`CAPABILITY_TRANSPORT` 默认空(= service-binding);`local-ts` 保留为 opt-in(test / dev / 故障回退)
- **[S9]** root guard #1 `test/tool-call-live-loop.test.mjs`(per P1-P5 GPT review R2):不再过宣称 kernel/llm live loop,而是守住 5 条真实 contract: (a) wrangler 已声明未注释的 `BASH_CORE`; (b) `createDefaultCompositionFactory()` 在 `BASH_CORE` 存在时默认选 `service-binding`; (c) `NanoSessionDO` 默认 composition selection 在仅有 `BASH_CORE` 时切到 remote capability seam; (d) transport seam 能实际 reach mock binding `/capability/call`; (e) `turn_input` 不会被误写成 wire kind。follow-up case(若有)继续用 `session.followup_input.body.text`
- **[S10]** root e2e #2 `test/initial-context-live-consumer.test.mjs`(per P1-P5 GPT review R1):发起 `session.start` 带 `initial_context` payload(以及非空 `initial_input` 以触发 turn)→ consumer 调 `appendInitialContextLayer`(helper 合并 pending layer)→ 在 kernel 随后首次 `assemble()` 时 payload 真被纳入 layers。**断言改口径**:(a) no throw;(b) `AssemblyResult.assembled` 或等价 BoundedEvalSink `AssemblyEvidenceRecord.assembledKinds` **含 consumer 映射到的 canonical kind**(预期 `session` 或 `injected`,由 D03 F4 最终映射决定);(c) 对比 negative case(`session.start` 不传 `initial_context`),同一 kind 的 layer 内容 / token 数出现差异;**不**再断言 "layers 数 +1" 这种暗合假设(layers 数量受 budget / required 过滤影响,不是可靠 observable);**不**再断言 `layer_kind: "initial_context"` 这种不存在的字段(`AssemblyEvidenceRecord` 仅含 `assembledKinds / droppedOptionalKinds / orderApplied / totalTokens / truncated / requiredLayerBudgetViolation / preparedArtifactsUsed / dropReason`)
- **[S11]** Phase 2-4 每 PR 跑 B7 LIVE + 全仓回归 + 两个 workers test + dry-run
- **[S12]** Phase 6 agent-core preview redeploy + 写 `docs/issue/worker-matrix/P2-closure.md`

### 2.2 Out-of-Scope

- **[O1]** D03 F4 最终实现搬到 context-core(归 P3)
- **[O2]** C1 / C2 / D1 / D2 吸收(归 P3 / P4)
- **[O3]** `workspace:*` → `@haimang/*` 切换(归 P5 D08)
- **[O4]** Tier B DEPRECATED banner(归 P5 D09)
- **[O5]** 新增 `session.error` kind(R2 已明确禁止自造)
- **[O6]** 新增 top-level `assembler` handle(R1 已明确禁止)
- **[O7]** 升级 W1 RFC 为 shipped(O2 charter)
- **[O8]** compact 默认 wire(Q3c 保持 opt-in)
- **[O9]** 新增 top-level `CONTEXT_CORE` / `FILESYSTEM_CORE` binding(归 P3/P4 posture 决策决定是否取消注释)
- **[O10]** 改 NACP wire / schema / tenant wrapper(B9 / W0)
- **[O11]** 扩 21-command registry(D02 §5.2 O)
- **[O12]** 绕过 B7 LIVE dedup / overflow 契约

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `appendInitialContextLayer` 实装深度 | `in-scope helper-maintained pending layers(不改 assembler API,不发明 layer kind)` | R1:`ContextAssembler` 只有 `assemble(layers)`,无 `appendLayer()`;helper 维护 pending list,合并进 `assemble()` 入参 | P3 C1 吸收 |
| host consumer 物理落点 | `in-scope workers + packages 两处` | 共存期纪律 W3 pattern §6 | P5 D09 deprecate |
| top-level `assembler` handle | `out-of-scope` | R1;SubsystemHandles 保持 8 槽 | NOT revisit |
| `system.error` kind | `out-of-scope` | R2;不自造 schema 外 kind | NOT revisit |
| `/tool.call.request` public HTTP | `out-of-scope` | R3;D02 已 binding-first | NOT revisit |
| `CONTEXT_CORE` binding 同时激活 | `out-of-scope P2` | P3 posture 决策;context-core host-local first | P3 |
| `FILESYSTEM_CORE` binding 同时激活 | `out-of-scope P2` | P4 posture 决策 | P4 |
| root e2e 使用 preview deploy 还是 in-process mock | `in-scope in-process`(D05 §5.3 / D07 §5.3)| CI 快 + 不依赖 live env | — |
| `CAPABILITY_TRANSPORT=local-ts` 默认 | `out-of-scope` | Q2a 明确 default = remote | NOT revisit |
| B7 LIVE 任一红 | `block` | P2 硬闸 | — |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P0-01 | Phase 0 | kickoff gate check | check | P1 closure memo + bash-core preview curl | P1 closed + bash-core URL curl 5 字段合法 | low |
| P1-01 | Phase 1 | D03 F4 API stub | new | `workers/agent-core/src/host/context-api/append-initial-context-layer.ts` | `appendInitialContextLayer(assembler, payload)` 签名 + 最小实现 | medium |
| P1-02 | Phase 1 | API stub unit test | new | `workers/agent-core/test/host/context-api/append-initial-context-layer.test.ts` | 3 cases:normal / missing / throw | low |
| P2-01 | Phase 2 | `createDefaultCompositionFactory` 升级 | upgrade | `workers/agent-core/src/host/composition/index.ts` | 6 handle 非 undefined;capability = serviceBindingTransport;workspace = composeWorkspaceWithEvidence | high |
| P2-02 | Phase 2 | `makeRemoteBindingsFactory` 补 4 nullable | upgrade | `workers/agent-core/src/host/composition/remote-bindings.ts` | kernel/workspace/eval/storage 显式 null + reason | medium |
| P2-03 | Phase 2 | `SubsystemHandles` type 守护 | check | `workers/agent-core/src/host/composition/composition.ts` | 仍 8 槽位;不新增 top-level assembler(R1) | medium |
| P2-04 | Phase 2 | local-ts fallback seam | upgrade | `workers/agent-core/src/host/composition/index.ts` capability factory | env `CAPABILITY_TRANSPORT=local-ts` 可切 local | medium |
| P2-05 | Phase 2 | packages 侧对称 | update | `packages/session-do-runtime/src/composition.ts` + `remote-bindings.ts` | 两处对齐(共存期)| medium |
| P2-06 | Phase 2 | composition unit tests | new | `workers/agent-core/test/host/composition/**` | 6 handle 非 undefined;4 nullable 显式;local-ts opt-in;compact 不默认装 | medium |
| P3-01 | Phase 3 | host consumer 接线(workers 侧)| new | `workers/agent-core/src/host/do/nano-session-do.ts::dispatchAdmissibleFrame` | session.start 分支 consumer ~10-25 行(R1 + R2)| high |
| P3-02 | Phase 3 | host consumer 对称(packages 侧)| new | `packages/session-do-runtime/src/do/nano-session-do.ts::dispatchAdmissibleFrame` | byte-identical logic | high |
| P3-03 | Phase 3 | honest error 走 system.notify | check | consumer catch 分支 | R2:`pushStreamEvent({kind:"system.notify", severity:"error", ...})` | medium |
| P3-04 | Phase 3 | consumer unit tests | new | `workers/agent-core/test/host/do/initial-context-consumer.test.ts` + packages 侧同名 | 3 cases × 2 处 | medium |
| P4-01 | Phase 4 | wrangler `BASH_CORE` 取消注释 | update | `workers/agent-core/wrangler.jsonc:26-32` | `BASH_CORE = { service = "nano-agent-bash-core" }` 激活 | medium |
| P4-02 | Phase 4 | env switch default | update | wrangler env / composition factory | `CAPABILITY_TRANSPORT` default = service-binding | low |
| P4-03 | Phase 4 | local-ts fallback testable | check | composition factory + test | env `CAPABILITY_TRANSPORT=local-ts` 可 runtime 切回 | medium |
| P5-01 | Phase 5 | root guard #1 BASH_CORE binding seam | new | `test/tool-call-live-loop.test.mjs` | wrangler activation + default composition remote path + NanoSessionDO remote selection + transport seam + wire-truth guard | high |
| P5-02 | Phase 5 | root e2e #2 initial_context | new | `test/initial-context-live-consumer.test.mjs` | 3 positive 断言 + 1 negative case | medium |
| P6-01 | Phase 6 | agent-core redeploy preview | new | `workers/agent-core` deploy:preview | URL live + `live_loop: true`(或等价)| medium |
| P6-02 | Phase 6 | 全仓回归 | test | 全仓 | B7 LIVE 5 + 98 root + 112 cross + 两 workers test + dry-run 全绿 | medium |
| P6-03 | Phase 6 | P2 closure memo | add | `docs/issue/worker-matrix/P2-closure.md` | 全 DoD 证据 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 0 — kickoff gate check

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P0-01 | P1 closed 校验 | 读 `docs/issue/worker-matrix/P1-closure.md` + grep DoD 全 checked | closure memo | DoD 5 条全 ✓ | 目视 | P1 closure DoD 全绿 |
| P0-02 | bash-core preview URL 校验 | `curl -fsSL <bash-core-preview-url>/` | bash-core preview | JSON 5 字段合法(status/worker/absorbed_runtime/nacp_core_version/nacp_session_version)| jq | curl 成功 + 字段全对 |
| P0-03 | Version ID 记录 | 验证 P1 closure memo 内 Version ID 存在 | closure memo §preview | Version ID UUID 格式 | grep UUID | Version ID 落盘 |

### 4.2 Phase 1 — D03 F4 API stub

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | API stub 写入(R1 口径)| `export function appendInitialContextLayer(assembler: ContextAssembler, payload: SessionStartInitialContext): void`(签名保留,consumer 可见形状不变)+ 最小实现:helper 维护 **模块级 / per-DO pending layers map**(keyed by assembler ref 或 DO instance),把 `payload` 映射成 1 条 canonical `ContextLayer`(`kind: "session"` 或 `"injected"`,按 payload 内容决策),push 到 pending list;**不**调 `assembler.appendLayer`(该方法不存在);host 在 `assemble()` 前合并 pending list;P3 迁到 context-core 时 helper 可以改为 namespace/anchor-scoped 存储 | `workers/agent-core/src/host/context-api/append-initial-context-layer.ts` | 签名 + helper 存储 + 映射到 canonical kind | `pnpm --filter workers/agent-core typecheck` 绿 | export 存在;映射到 6 canonical kinds 之一;P3 可直接迁 |
| P1-02 | unit test | 3 cases:(a) normal payload;(b) missing field 用 default;(c) throw 上抛 | `workers/agent-core/test/host/context-api/append-initial-context-layer.test.ts` | 3 cases 绿 | `pnpm --filter workers/agent-core test` | 3 cases 全绿 |

### 4.3 Phase 2 — D06 composition factory 升级

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | `createDefaultCompositionFactory` 升级 | kernel 从 `src/kernel/` 实例化 `KernelRunner`;llm 从 `src/llm/` `LLMExecutor`;capability 用 canonical `BASH_CORE` service binding(legacy `CAPABILITY_WORKER` alias 仅作 closeout compat);workspace 用 `composeWorkspaceWithEvidence({namespace, artifactStore, evidenceSink: eval.emit, evidenceAnchor})`;hooks 从 `src/hooks/`;eval 用 `BoundedEvalSink`;storage 保持 undefined / honest-degrade | `workers/agent-core/src/host/composition/index.ts` | 6 handle 非 undefined | unit test `createDefaultCompositionFactory(env, cfg)` 返回对象每 field 非 undefined;`obj.workspace.assembler` 是 `ContextAssembler` 实例 | 6 handle 检查;workspace.assembler 非 undefined |
| P2-02 | `makeRemoteBindingsFactory` 补 4 nullable | kernel → null + reason "始终 host-local";workspace → null + reason "Q4a host-local";eval → null + reason "sink owner 在 host";storage → null + reason "tenant wrapper 在 host DO";文档 comment 落在各 field | `workers/agent-core/src/host/composition/remote-bindings.ts` | 4 field 显式 null | unit test | 4 null 有 comment |
| P2-03 | SubsystemHandles type 守护 | grep `SubsystemHandles` interface;保持 8 槽位 | `workers/agent-core/src/host/composition/composition.ts`(从 A1 搬过来的版本) | 仍 8 槽;无 top-level assembler 新增 | `grep -c "assembler" composition.ts` 仅在 doc comment | 8 槽;R1 守护 |
| P2-04 | local-ts fallback seam | capability factory 读 `env.CAPABILITY_TRANSPORT`;"local-ts" → local;其余(包括 undefined / "service-binding")→ remote default | `workers/agent-core/src/host/composition/index.ts` | env switch 工作 | unit test:set env = "local-ts" → capability handle 类型是 local | test 断言 2 cases |
| P2-05 | packages 对称 | 同 logic 落 `packages/session-do-runtime/src/composition.ts` + `remote-bindings.ts` | packages 侧 | byte-identical | `diff` packages vs workers 的 factory 应只在 import path 上 | 两处一致 |
| P2-06 | composition unit tests | 覆盖:6 handle 非 undefined;4 nullable 显式;local-ts opt-in;compact 不默认装(Q3c)| `workers/agent-core/test/host/composition/**` | tests 全绿 | `pnpm --filter workers/agent-core test` | 0 failure |

### 4.4 Phase 3 — D05 host consumer 接线

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | workers 侧 consumer | 在 `dispatchAdmissibleFrame` session.start 分支,**在 `extractTurnInput` 之前** 新增:`const assembler = this.composition?.workspace?.assembler; if (body.initial_context && assembler) try { appendInitialContextLayer(assembler, body.initial_context) } catch { pushStreamEvent(system.notify severity=error ...) }` | `workers/agent-core/src/host/do/nano-session-do.ts` | ~10-25 行;顺序在 extractTurnInput 之前 | grep 行号比较;unit test | 行号顺序 + consumer 行为 |
| P3-02 | packages 侧对称 | 同 logic 落 `packages/session-do-runtime/src/do/nano-session-do.ts` | packages 侧 | byte-identical | diff | 两处一致 |
| P3-03 | honest error 走 system.notify | catch 分支使用 `pushStreamEvent({kind:"system.notify", severity:"error", message:"initial_context_consumer_error: ..."})`;**不**自造 `system.error` kind | 两处 consumer | R2 口径 | `grep "system.error" workers/agent-core/src/host/` == 0(除注释)| 无非法 kind |
| P3-04 | unit test | 3 cases × 2 处:normal / missing field / throw;validate catch 分支走 system.notify | `workers/agent-core/test/host/do/initial-context-consumer.test.ts` + packages 侧同名 | 6 cases 绿 | `pnpm -r run test` | 0 failure |

### 4.5 Phase 4 — D07 binding 激活

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | wrangler 取消注释 | `workers/agent-core/wrangler.jsonc:26-32`(BASH_CORE slot)取消注释;`service = "nano-agent-bash-core"`;environment name 对齐 preview | `workers/agent-core/wrangler.jsonc` | binding 激活 | `pnpm --filter workers/agent-core run deploy:dry-run` 绿 | dry-run 绿;BASH_CORE 非注释 |
| P4-02 | env switch default | default `CAPABILITY_TRANSPORT` 为空(= service-binding);opt-in 值 `local-ts` | wrangler env + composition factory | switch 工作 | env 置 local-ts → capability 走 local;env 空 → 走 binding | 两种模式都跑绿 |
| P4-03 | fallback seam testable | 加一条 unit test 验证 env = "local-ts" 时 capability handle 类型是本地 | `workers/agent-core/test/host/composition/local-ts-fallback.test.ts` | 1 case 绿 | — | 断言通过 |
| P4-04 | dry-run | `deploy:dry-run` 在 binding 激活后仍绿 | workers/agent-core | 绿 | wrangler dry-run | 0 error |

### 4.6 Phase 5 — root e2e

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | root guard #1 BASH_CORE binding seam(R2)| in-process guard;不再假装 full turn loop。断言:(a) wrangler `BASH_CORE` 未注释激活;(b) `createDefaultCompositionFactory()` 在 `BASH_CORE` 存在时选择 `service-binding`;(c) `NanoSessionDO` 默认 composition selection 在仅有 `BASH_CORE` 时给出 remote capability seam;(d) transport seam reach `/capability/call` mock binding;(e) 源码不存在 `turn_input` wire kind value | `test/tool-call-live-loop.test.mjs` | 5 断言绿 | `node --test test/tool-call-live-loop.test.mjs` | 5/5 绿 |
| P5-02 | root e2e #2 initial_context(R1)| 发 `session.start { initial_input: "<non-empty>", initial_context: {...} }` → consumer 调 `appendInitialContextLayer` → kernel assemble 合并 pending → 断言:(a) no throw;(b) `AssemblyEvidenceRecord.assembledKinds` **含 helper 映射到的 canonical kind**(预期 `session` 或 `injected`);(c) 与 negative case(不传 `initial_context`)对比,**同一 canonical kind 的 layer content 或 totalTokens 有可观测差异**;不再断言 "layers 数 +1" / `layer_kind` 字段 | `test/initial-context-live-consumer.test.mjs` | 3 positive + 1 negative | `node --test test/initial-context-live-consumer.test.mjs` | 4/4 绿 |

### 4.7 Phase 6 — redeploy + 全仓回归 + closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P6-01 | redeploy preview | `pnpm --filter workers/agent-core run build && run deploy:preview` | workers/agent-core | URL live | wrangler 输出 + `curl <preview-url>/` JSON 含 `live_loop: true`(或等价字段)| 字段确认 |
| P6-02 | 全仓回归 | `pnpm -r run typecheck && pnpm -r run test && pnpm --filter './workers/*' run deploy:dry-run && node --test test/*.test.mjs && npm run test:cross` | 全仓 | 全绿 | 该命令组 | 0 failure;B7 LIVE 5 绿;98 + 112 + 新增 e2e 绿 |
| P6-03 | P2 closure memo | 写 `docs/issue/worker-matrix/P2-closure.md`:含 D05/D06/D07 DoD 证据 + e2e link + preview URL + Version ID | `docs/issue/worker-matrix/P2-closure.md` | 300-600 行 | grep DoD × P2.A-F3 各出现 | §DoD 全 checked |

---

## 5. Phase 详情

### 5.1 Phase 0 — kickoff gate check

- **Phase 目标**:P2 开工前 hard prerequisite 全部满足
- **本 Phase 对应编号**:`P0-01` `P0-02` `P0-03`
- **本 Phase 新增文件**:无
- **本 Phase 修改文件**:无
- **具体功能预期**:P1 closure DoD 全绿;bash-core preview URL curl 合法 JSON;Version ID 记录
- **具体测试安排**:目视 + curl
- **收口标准**:3 条 check 全 ✓;否则 block
- **本 Phase 风险提醒**:若 curl 红,回 P1 Phase 5 排错,不在 P2 Phase 1 启动

### 5.2 Phase 1 — D03 F4 API stub

- **Phase 目标**:`appendInitialContextLayer` 签名 + 最小实现落盘,供 D06 / D05 可调
- **本 Phase 对应编号**:`P1-01` `P1-02`
- **本 Phase 新增文件**:
  - `workers/agent-core/src/host/context-api/append-initial-context-layer.ts`
  - `workers/agent-core/test/host/context-api/append-initial-context-layer.test.ts`
- **本 Phase 修改文件**:无
- **具体功能预期**:
  1. 签名 `appendInitialContextLayer(assembler: ContextAssembler, payload: SessionStartInitialContext): void`
  2. 最小实现(per R1):helper 维护 **pending layers list**(不调不存在的 `assembler.appendLayer`);每次 consumer 调 `appendInitialContextLayer(assembler, payload)`,helper 把 payload 映射成 1 条 canonical `ContextLayer`(`kind: "session"` 或 `"injected"`,按 payload 形态),push 到 pending list;host 在 kernel turn 组装入参时把 pending list 与既有 turn-level layers 合并传给 `assembler.assemble(layers)` — `assemble()` API 不改
  3. 异常上抛(consumer 侧 catch)
- **具体测试安排**:
  - **单测**:3 cases(normal / missing field / throw)
  - **集成测试**:`pnpm --filter workers/agent-core test` 绿
- **收口标准**:签名落盘 + 3 cases 绿
- **本 Phase 风险提醒**:
  - 最小实现不得额外 emit evidence(归 P3 C1 吸收时决策);否则 consumer unit test 会多一条 emission

### 5.3 Phase 2 — D06 composition factory 升级

- **Phase 目标**:`createDefaultCompositionFactory` 返回 6 handle 全非 undefined;`makeRemoteBindingsFactory` 显式 4 null + reason;local-ts fallback seam 保留;SubsystemHandles 不扩 top-level assembler
- **本 Phase 对应编号**:`P2-01` 至 `P2-06`
- **本 Phase 新增文件**:`workers/agent-core/test/host/composition/{createDefault.test.ts, remoteBindings.test.ts, localTsFallback.test.ts, compactOptIn.test.ts}`(或合并)
- **本 Phase 修改文件**:
  - `workers/agent-core/src/host/composition/index.ts`
  - `workers/agent-core/src/host/composition/remote-bindings.ts`
  - `packages/session-do-runtime/src/composition.ts`
  - `packages/session-do-runtime/src/remote-bindings.ts`
- **具体功能预期**:
  1. 6 handle 非 undefined(`workspace.assembler` 是 `ContextAssembler` 实例)
  2. 4 nullable 显式 null + comment reason
  3. local-ts seam 可通过 env switch
  4. SubsystemHandles 仍 8 槽(R1)
  5. packages/workers 对称
- **具体测试安排**:
  - **单测**:6 handle × not undefined;4 nullable × explicit null;local-ts opt-in;compact 不默认装
  - **集成测试**:`pnpm --filter workers/agent-core test` 绿
  - **回归测试**:B7 LIVE 5 + 全仓
  - **手动验证**:`grep "assembler" workers/agent-core/src/host/composition/composition.ts` 仅在注释
- **收口标准**:全测试绿;R1 守护
- **本 Phase 风险提醒**:
  - workspace handle 改用 `composeWorkspaceWithEvidence` 时,`evidenceSink` / `evidenceAnchor` 必须对齐 host DO 已有 wiring,否则 B7 LIVE 会红
  - `BASH_CORE` binding 若在此 Phase 还未取消注释(Phase 4 才改),capability handle 工厂会在 preview env 拿不到 binding —— default factory 必须 honest-degrade 到 `unavailable`(而不是伪装 local success);避免 Phase 2 PR merge 后 preview 炸掉

### 5.4 Phase 3 — D05 host consumer 接线

- **Phase 目标**:`dispatchAdmissibleFrame` session.start 分支消费 `initial_context`(R1 + R2)
- **本 Phase 对应编号**:`P3-01` 至 `P3-04`
- **本 Phase 新增文件**:
  - `workers/agent-core/test/host/do/initial-context-consumer.test.ts`
  - `packages/session-do-runtime/test/do/initial-context-consumer.test.ts`
- **本 Phase 修改文件**:
  - `workers/agent-core/src/host/do/nano-session-do.ts`
  - `packages/session-do-runtime/src/do/nano-session-do.ts`
- **具体功能预期**:
  1. consumer 约 10-25 行,调用顺序在 extractTurnInput 之前
  2. `const assembler = this.composition?.workspace?.assembler`(R1)
  3. catch 走 `pushStreamEvent({kind:"system.notify", severity:"error", ...})`(R2)
  4. packages 对称落
- **具体测试安排**:
  - **单测**:3 cases × 2 处
  - **集成测试**:B7 LIVE 5 / 98 root / 112 cross 全绿
  - **手动验证**:
    - `grep -n "appendInitialContextLayer\|extractTurnInput" workers/agent-core/src/host/do/nano-session-do.ts` 确认顺序
    - `grep "system.error" workers/agent-core/src/host/` == 0(除注释)
- **收口标准**:6 cases 全绿 + 顺序正确 + R2 合法 kind
- **本 Phase 风险提醒**:
  - 两处对称若只改一处,下次重连 session 可能命中未改的那份;PR review 时双修保证
  - assembler 可能为 undefined(composition 还没升级就 merge 了 consumer)— F1 degrade 路径必须 no-op + evidence,不能 throw

### 5.5 Phase 4 — D07 binding 激活

- **Phase 目标**:`BASH_CORE` service binding 激活 + local-ts fallback testable
- **本 Phase 对应编号**:`P4-01` 至 `P4-04`
- **本 Phase 新增文件**:`workers/agent-core/test/host/composition/local-ts-fallback.test.ts`
- **本 Phase 修改文件**:
  - `workers/agent-core/wrangler.jsonc`
  - `workers/agent-core/src/host/composition/index.ts`(env switch 逻辑,如 Phase 2 未完全写完)
- **具体功能预期**:
  1. wrangler BASH_CORE 非注释
  2. default transport = service-binding
  3. `CAPABILITY_TRANSPORT=local-ts` 可 runtime 切 local
- **具体测试安排**:
  - **单测**:local-ts fallback 断言
  - **集成测试**:`pnpm --filter workers/agent-core run deploy:dry-run` 绿
  - **手动验证**:`grep -v "^//" workers/agent-core/wrangler.jsonc | grep BASH_CORE` ≥ 1
- **收口标准**:dry-run 绿 + local-ts seam 跑得通
- **本 Phase 风险提醒**:
  - wrangler service 名打错(例如 `bash-core` 而非 `nano-agent-bash-core`)会让 binding 指向不存在的 worker;必须与 `workers/bash-core/wrangler.jsonc` name 交叉核对

### 5.6 Phase 5 — root e2e

- **Phase 目标**:两条 e2e 作为持续守护
- **本 Phase 对应编号**:`P5-01` `P5-02`
- **本 Phase 新增文件**:
  - `test/tool-call-live-loop.test.mjs`
  - `test/initial-context-live-consumer.test.mjs`
- **本 Phase 修改文件**:无(除非 `test/_harness.mjs` 需要 shared mock binding)
- **具体功能预期**:
  1. e2e #1 4 断言(request 到达 / response 返回 / stream 回 / cancel 路径可跑)
  2. e2e #2 3 positive + 1 negative 断言
- **具体测试安排**:
  - **手动验证**:`node --test test/tool-call-live-loop.test.mjs test/initial-context-live-consumer.test.mjs` 全绿
- **收口标准**:两 e2e 全绿;不依赖 live preview deploy(in-process mock 足矣)
- **本 Phase 风险提醒**:
  - e2e 若依赖 live preview URL,CI 会脆;用 Miniflare / mock binding
  - e2e #2 断言 **不**基于 `layer_kind` 字段(该字段不存在);断言基于 `AssemblyEvidenceRecord.assembledKinds` 是否含 helper 映射到的 canonical kind,以及 negative-vs-positive case 的 content / totalTokens 差异。若 negative 与 positive 出现 **0 可观测差异**,说明 helper 未把 payload 成功挂到 pending list 或 host 未合并 pending → 修 Phase 1 helper;若 `assembledKinds` 缺 mapped kind 但 layer 进入了,说明 kind 映射选择(`session` vs `injected`)错误 → 调 D03 F4 映射策略

### 5.7 Phase 6 — redeploy + 全仓回归 + closure

- **Phase 目标**:preview URL `live_loop: true`;全仓全绿;closure memo shipped
- **本 Phase 对应编号**:`P6-01` 至 `P6-03`
- **本 Phase 新增文件**:`docs/issue/worker-matrix/P2-closure.md`
- **本 Phase 修改文件**:无
- **具体功能预期**:
  1. preview URL `curl` JSON 含 `live_loop: true`(或等价字段)
  2. `pnpm -r run test` / root / cross / workers test / dry-run 全绿
  3. closure memo 含 D05/D06/D07 DoD + Version ID + 两 e2e link
- **具体测试安排**:
  - **手动验证**:closure §DoD 全 checked
- **收口标准**:charter §6.2 P2 DoD 全 checked
- **本 Phase 风险提醒**:
  - preview URL 字段漂移若影响 W4 probe 回归,W4 CI 的 probe 校验可能红;保留原字段 + 新增 `live_loop` 即可

---

## 6. 需要业主 / 架构师回答的问题清单

### Q1 — D03 F4 stub 物理落点

- **影响范围**:Phase 1
- **为什么必须确认**:P2 阶段 context-core 未吸收,stub 暂放 agent-core;P3 要迁到 context-core。暂放路径可以是 `workers/agent-core/src/host/context-api/` 或 `workers/agent-core/src/context-stub/`
- **当前建议 / 倾向**:`workers/agent-core/src/host/context-api/`(host 领域语义清楚;P3 迁出时名字就能体现"这是 context-core API")
- **Q**:暂放路径?
- **A**:_pending_

### Q2 — P2 PR 节奏

- **影响范围**:全 Phase
- **为什么必须确认**:Phase 1-6 可以 1 PR 合拢或按 Phase 拆;影响 review 成本
- **当前建议 / 倾向**:**按 Phase 拆 6 PR**(序列强依赖;小 PR 易回滚)
- **Q**:PR 数?
- **A**:_pending_

### Q3 — `live_loop: true` 字段命名

- **影响范围**:Phase 6 preview probe
- **为什么必须确认**:字段名是 P2 完成的 observable anchor;若命名漂移,未来 P3/P4/P5 的 preview probe 难对齐
- **当前建议 / 倾向**:`live_loop: true`(与 W4 probe `absorbed_runtime: true` 风格对齐)
- **Q**:字段名?
- **A**:_pending_

### Q4 — root e2e harness 选型

- **影响范围**:Phase 5
- **为什么必须确认**:Miniflare / node --test 内置 / 其他 mock 方式各有代价
- **当前建议 / 倾向**:**复用 B7 LIVE harness**(node --test + in-process mock binding);与 98 root tests 保持同构
- **Q**:harness 选型?
- **A**:_pending_

### 6.2 问题整理建议

- Q1 / Q3 低风险 + 影响持续多 phase,建议 P2 kickoff 前确定
- Q2 影响 review 成本,但不影响技术执行
- Q4 明确 B7 LIVE harness 复用即可

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| Phase 2 composition 升级破坏 B7 LIVE | workspace.assembler 的 evidence wiring 漂移 | `high` | 单测 dedup / overflow disclosure 行为;评估 ContextAssembler 初始化参数对齐 |
| assembler 仍 undefined(D06 晚 merge)| D05 consumer 在 composition 升级前 merge | `medium` | F1 degrade 路径已覆盖;但 PR sequence 强制 D06 先 merge |
| wrangler BASH_CORE service 名拼错 | Phase 4 | `high` | 交叉核对 bash-core wrangler name;dry-run 必须绿 |
| local-ts fallback 被误删 | P2 kickoff 后紧张时间压力 | `medium` | 独立 unit test + PR review gate;Q2a 口径反复强调 |
| root guard #1 对 BASH_CORE binding 的 mock 与真实 glue 漂移 | in-process mock 写错 | `medium` | mock 对照 `packages/capability-runtime/src/targets/service-binding.ts` 的 transport 签名 |
| B7 LIVE 任一红 | 任一 Phase PR | `high` | block merge;先修 B7 LIVE 后再推进 |
| preview URL 字段破坏 W4 probe 兼容 | Phase 6 | `medium` | 保留原字段;仅新增 `live_loop: true` |
| packages 侧改动漏改 | Phase 2/3 | `medium` | PR review gate;`diff` 对称检查 |

### 7.2 约束与前提

- **技术前提**:P1 closed;bash-core preview URL live + Version ID 落盘(P0 Q3 owner)
- **运行时前提**:Cloudflare preview deploy 凭证就绪;`BASH_CORE` binding 在 preview env 可寻址
- **组织协作前提**:D03 F4 API shape owner(建议由 D05 同一作者或 P3 owner 预先 claim)
- **上线 / 合并前提**:每 Phase 独立 PR;B7 LIVE 红则 block

### 7.3 文档同步要求

- 需要同步更新的设计文档:
  - 若 D05/D06/D07 在执行中发现进一步漂移,v0.3 补;否则 v0.2 保持
- 需要同步更新的说明文档 / README:
  - `workers/agent-core/README.md`(若存在):新增 `live_loop` 段
- 需要同步更新的测试说明:
  - `test/README.md`(若存在):新增两条 e2e 描述

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**:
  - `grep -c "workspace?.assembler\|workspace?.\\s*assembler" workers/agent-core/src/host/do/nano-session-do.ts` ≥ 1
  - `grep "system.error" workers/agent-core/src/host/` 0(除注释)
  - wrangler grep BASH_CORE 非注释
- **单元测试**:`pnpm -r run test` 全绿
- **集成测试**:`pnpm --filter './workers/*' run deploy:dry-run` 全绿
- **端到端 / 手动验证**:
  - 两条 root e2e:`node --test test/tool-call-live-loop.test.mjs test/initial-context-live-consumer.test.mjs`
  - preview URL `curl` 含 `live_loop: true`
- **回归测试**:B7 LIVE 5 / 98 root / 112 cross 全绿
- **文档校验**:P2 closure memo 全 DoD checked

### 8.2 Action-Plan 整体收口标准(= charter §6.2 P2 DoD)

1. **P2 prerequisite(GPT R1)**:`workers/bash-core` real preview deploy 完成 + URL live + Version ID 记录(P1 Phase 5 + Phase 0 check)
2. `createDefaultCompositionFactory` 6 handle 全非 undefined
3. `makeRemoteBindingsFactory` 4 nullable 显式处理
4. `initial_context` host consumer 接线完成(R1 + R2)
5. `workers/agent-core/wrangler.jsonc` `BASH_CORE` 激活
6. agent-core preview redeploy live + `live_loop: true`
7. Root guard #1 BASH_CORE binding seam 绿
8. Root e2e #2 initial_context dedicated 绿
9. Fallback seam testable(local-ts opt-in 跑通)
10. B7 LIVE 5 tests 全绿

### 8.3 完成定义(Definition of Done)

| 维度 | 完成定义 |
|------|----------|
| 功能 | `initial_context` 被真实消费;preview env 具备 canonical `BASH_CORE` binding;default composition 与 NanoSessionDO 默认路径都能切到 remote capability seam |
| 测试 | targeted validation suite 全绿: agent-core 1026 / session-do-runtime 367 / root 107 / cross 121 + 两 workers dry-run |
| 文档 | closure memo shipped;D05/D06/D07 v0.x 与执行事实一致 |
| 风险收敛 | R1/R2/R3 口径在代码落实;Q2a local-ts fallback 保留 |
| 可交付性 | P3 / P4 可 kickoff — context-core / filesystem-core 吸收不再被 live loop 缺位阻挡 |

---

## 9. 执行后复盘关注点

- Phase 2 的 ContextAssembler 默认 config 是否合理(`maxTokens: 32000 / reserveForResponse: 1024`);real use-site 是否需要调
- D07 wrangler 激活后,preview binding 是否在 Cloudflare 侧真实命中 nano-agent-bash-core
- e2e #1 的 mock binding 与真实 service-binding 的 behavior 差距
- local-ts fallback 是否被开发者在 P2 结束后真的用过

---

## 10. 结语

这份 P2 action-plan 以 **"把 preview env 的 host consumer + BASH_CORE capability binding seam 接成真实 truth,并由两条 root tests 持续守护"** 为第一优先级,采用 **"严格 Phase 序列(gate → API stub → composition → consumer → binding → e2e → redeploy + closure)"** 的推进方式,优先解决 **"空 handle bag / 4 nullable silent / initial_context 无 consumer / BASH_CORE 注释态 / local-ts fallback 若被删"** 五件阻挡 P2 收口的缺位,并把 **"R1 assembler 落点不扩 top-level / R2 不自造 system.error kind / R3 binding-first 口径不漂 / Q2a local-ts 保留 / B7 LIVE 不破 / 共存期 packages 对称落"** 作为主要约束。整个计划完成后,`agent.core + bash.core` 达到的是真实而克制的状态: **`initial_context` payload 真被消费且影响 assembled prompt;canonical `BASH_CORE` binding 在 preview env live;tool.call 的 service-binding path 与 DO 默认 remote selection 被持续守住**。完整 kernel/llm live turn loop 仍归后续 charter。

---

## 11. P2 执行工作报告(Claude Opus 4.7, 2026-04-23)

### 11.1 执行综述

- **判断结果**:P2 可以进入 — 已全部完成 Phase 0-6 含 agent-core preview redeploy
- **Phase 序列**:Phase 0 gate check → Phase 1 D03 F4 stub → Phase 2 D06 composition upgrade → Phase 3 D05 consumer wiring → Phase 4 D07 BASH_CORE 激活 → Phase 5 两条 root e2e → Phase 6 redeploy + regression + closure
- **总规模**:新增 ~10 文件、修改 ~10 文件;targeted validation suite 1026 / 367 / 107 / 121 全绿;agent-core Version ID `2f1c16e4-dc14-4935-ae84-7af19b5cad9f` + bash-core Version ID `50335742-e9e9-4f49-b6d7-ec58e0d1cfb4` 双 preview live
- **执行模式**:单 session 连续完成;所有 owner decisions 基于 memory(`reference_local_tooling.md`)授权;deploy 由 Claude 使用 local wrangler OAuth 执行
- **在此之前的 GPT P1-P0 review 修复**:R1/R2/R3 在本 session 前半段已全部 accept + 修复(agent-core index.ts entry routing / P0 closure 批准 + E3/E6 勾绿 / P1 closure §0 文字清理 + 4 条 entry-level routing smoke 测试)

### 11.2 全部新增文件清单(列表展开)

**workers/agent-core/src/ 新增**:
- `src/host/context-api/append-initial-context-layer.ts` — D03 F4 stub;WeakMap pending list;映射 canonical `session` kind;export 5 API(`appendInitialContextLayer` / `buildInitialContextLayers` / `drainPendingInitialContextLayers` / `peekPendingInitialContextLayers` + re-used types)

**workers/agent-core/test/ 新增**:
- `test/host/context-api/append-initial-context-layer.test.ts` — 9 unit tests
- `test/host/composition-p2-upgrade.test.ts` — 7 tests(6 handle 非 undefined / workspace.assembler 真 ContextAssembler / capability 3 transport 模式 / 4-nullable 显式 / R1 守护)
- `test/host/composition-local-ts-fallback.test.ts` — 4 tests(default / opt-in / honest-degrade / explicit-service-binding-without-binding)
- `test/host/do/initial-context-consumer.test.ts` — 6 tests(consumer path × 4 + R2 source-scan guard)

**packages/session-do-runtime/ 镜像新增**(per W3 pattern §6 coexistence):
- `src/context-api/append-initial-context-layer.ts` — helper 镜像
- `test/context-api/append-initial-context-layer.test.ts` — 9 unit tests 镜像

**root test 新增**:
- `test/tool-call-live-loop.test.mjs` — 5 subtests(wrangler 激活 / composition 路由 / NanoSessionDO remote selection / transport seam / R2 wire truth guard)
- `test/initial-context-live-consumer.test.mjs` — 4 subtests(positive / assembledKinds canonical / negative / diff)

**docs 新增**:
- `docs/issue/worker-matrix/P2-closure.md` — 本 memo,~280 行,DoD 10/10 绿

### 11.3 全部修改文件清单(列表展开)

**workers/agent-core**:
- `src/index.ts` — probe shape `phase: "worker-matrix-P2-live-loop"` + `live_loop: true` + `capability_binding: Boolean(env.BASH_CORE)`(新字段)
- `src/host/composition.ts` — `createDefaultCompositionFactory` 升级:
  - imports 新增 `BoundedEvalSink` / `extractMessageUuid` / `composeWorkspaceWithEvidence` / `WorkspaceCompositionHandle` / `MountRouter` / `InMemoryArtifactStore`
  - 新增 type exports `CapabilityCompositionHandle` / `EvalCompositionHandle` / `KernelCompositionHandle` / `LlmCompositionHandle` / `HooksCompositionHandle` / `StorageCompositionHandle`
  - factory 返回 6 live handles(workspace 调用 `composeWorkspaceWithEvidence` 产出含 `compactManager` / `snapshotBuilder` / `captureSnapshot` 的完整 handle;eval 包装 BoundedEvalSink + adapter;capability 按 `CAPABILITY_TRANSPORT` env 选择 service-binding / local-ts / unavailable)
- `src/host/remote-bindings.ts` — `makeRemoteBindingsFactory` 的 kernel/workspace/eval/storage 4 槽位由 `undefined` 改 `null` + 每个字段附详细 block-comment reason
- `src/host/do/nano-session-do.ts` —
  - import `appendInitialContextLayer`(from `../context-api/append-initial-context-layer.js`)
  - `defaultEvalSink` 去 `readonly`(为 adopt 留路径)
  - 构造函数在 `baseSubsystems.eval` 是 `EvalCompositionHandle` 时 adopt `.sink` 为 `defaultEvalSink`
  - 构造函数对 composition 提供的完整 workspace handle 调用 `setEvidenceWiring(...)` retrofit 到 assembler/compactManager/snapshotBuilder(evidence sink 统一到 `effectiveEvalSink.emit`)
  - `dispatchAdmissibleFrame` 在 switch 前新增 ~40 行 D05 consumer:仅 `messageType === "session.start" && body.initial_context` 时触发;R1 `(this.subsystems.workspace).assembler` 读取;R2 catch → `helper.pushEvent({kind:"system.notify", severity:"error", message})`
- `wrangler.jsonc` — `services` 取消注释;顶层 `BASH_CORE` → `nano-agent-bash-core`;`env.preview.services` 绑 `nano-agent-bash-core-preview`;CONTEXT_CORE / FILESYSTEM_CORE 仍注释态(P3/P4 决策)
- `test/smoke.test.ts` — 3 条 probe 断言新增 `live_loop: true` + `capability_binding: false`(test 无 BASH_CORE)+ phase 字段更新
- `test/host/composition-profile.test.ts` — `returns undefined` 测试改 `returns 6 non-undefined` + 新增 workspace.assembler + eval shape 2 条
- `test/host/integration/remote-composition-default.test.ts` — `s.hooks).toBeUndefined()` 改 `s.hooks.phase === "P2-stub"`

**packages/session-do-runtime**(镜像):
- `src/do/nano-session-do.ts` — D05 consumer ~40 行镜像;import `appendInitialContextLayer`

**docs 修改**:
- `docs/issue/worker-matrix/P2-closure.md` — 新建(见 §11.2)
- (本文件)`docs/action-plan/worker-matrix/P2-live-loop-activation.md` — §11 工作报告

### 11.4 测试汇总

| 层 | tests | Δ |
|----|-------|---|
| workers/agent-core | 1026 | +30(从 996)|
| packages/session-do-runtime | 367 | +10(镜像 + binding alias closeout)|
| root `node --test test/*.test.mjs` | 107 | +9(5 + 4)|
| `npm run test:cross` | 121 | +9 |
| 4 workers `deploy:dry-run` | 全绿 | agent-core 现含 BASH_CORE binding |

### 11.5 Live deploy 证据

| Worker | Preview URL | Version ID | 关键 JSON 字段 |
|--------|-------------|------------|----------------|
| agent-core | `https://nano-agent-agent-core-preview.haimang.workers.dev` | `2f1c16e4-dc14-4935-ae84-7af19b5cad9f` | `phase: "worker-matrix-P2-live-loop"`, `live_loop: true`, `capability_binding: true` |
| bash-core | `https://nano-agent-bash-core-preview.haimang.workers.dev` | `50335742-e9e9-4f49-b6d7-ec58e0d1cfb4`(P1.B 保持) | `phase: "worker-matrix-P1.B-absorbed"`, `absorbed_runtime: true` |

实测 `curl /sessions/probe-demo/status` 返回 `{"ok":true,"action":"status","phase":"unattached"}` HTTP 200 — **证明**:index.ts routing fix(R1 from P1-P0 review)已 live + SESSION_DO forwarding 真实经过 DO fetch。

### 11.6 DoD 结果(charter §6.2 / action-plan §8.2)

**10/10 全绿**:prerequisite / 6 handle / 4 nullable / initial_context consumer / BASH_CORE 激活 / agent-core redeploy + live_loop / e2e #1 / e2e #2 / fallback seam / B7 LIVE。详见 closure memo §5。

### 11.7 R1/R2/R3 守护验证

- R1:`appendInitialContextLayer` helper-maintained pending layers + canonical kind mapping;SubsystemHandles 8 keys 无 `assembler`;D05 consumer 走 `composition?.workspace?.assembler`。三重守护(unit / composition / e2e)
- R2:`system.notify severity=error`;源码扫描断言 `kind: "system.error"` 作为 value 用了 0 次 / `turn_input` 作为 kind-value 用了 0 次 / canonical wire kinds `session.start` + `session.followup_input` 保留
- R3:agent-core index.ts 无 `/tool.call.request` 公共路径(e2e #1 a 扫描断言);bash-core 保持 binding-first

### 11.8 复盘关注点

1. D06 composition 升级过程中踩过的坑:(a) duplicate `WorkspaceCompositionHandle` 类型定义(composition.ts 新增 + workspace-runtime.ts 已有)→ 统一 import 自 workspace-runtime;(b) `BoundedEvalSink.emit` 签名是 `{record, messageUuid}` 而非 raw record,需用 `EvalCompositionHandle` 包装 adapter;(c) composition 提供 workspace handle 时 evidence 不自动 wire,需 DO 层 retrofit `setEvidenceWiring`
2. D05 consumer 的顺序约束:在 `extractTurnInput` **之前** 调用 — pending list 必须先于 turn 产生的其他 layers 就位。实测落位正确(`dispatchAdmissibleFrame` switch case 之前独立 if 块)
3. packages/ 镜像不自动 build dist(pnpm 需单独运行)— 对 node --test 消费 dist 文件的 root e2e 无影响,e2e 只 import workers/agent-core/dist/,但需要记住 packages 侧 dist 下次变更需主动 build
4. Q1/Q3/Q4 P2 action-plan owner decisions:Q1 (F4 stub 物理落点) = `workers/agent-core/src/host/context-api/` 按建议值落 / Q3 (live_loop 字段名) = `live_loop: true` 按建议值落 / Q4 (e2e harness) = node --test + in-process mock 按建议值落;Q2 (PR 节奏) 单 session 合并执行
5. pre-existing `EvidenceAnchorLike` deprecation 警告(2 处)未清理 — 归 P3 C2 slice 吸收时统一处理

### 11.9 对 P3 / P4 / P5 的直接影响

- P3 kickoff unblocked:C1 吸收可消费 P2 D03 F4 stub(WeakMap design 保 migration-ready);D03 C2 slice 可替代 host 的 `composeWorkspaceWithEvidence` 调用
- P4 kickoff unblocked:D04 D1 slice 的 artifact helpers 可替代 `InMemoryArtifactStore`;D2 storage 保持 host-local(Q4a)
- P5 kickoff unblocked:cutover rollback 基线 = 双 Preview Version ID;D09 deprecation absorb-stable 门控满足(P2 的 binding seam / host consumer 证明 absorb 稳定)
- D07 完整闭环(kernel/llm live)归后续 charter(非 worker-matrix scope)

### 11.10 结论

P2 Phase 0-6 全部完成;preview env 已具备真实 `BASH_CORE` binding + `initial_context` host consumer + 默认 remote capability selection;两条 root tests 持续守护 R1/R2/R3 口径;双 Preview URL live + binding 互通。**P2 100% closed,worker-matrix 可以进入 P3/P4/P5 的 final 3-phase 冲刺。**
