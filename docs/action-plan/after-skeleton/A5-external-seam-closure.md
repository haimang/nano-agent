# A5. Nano-Agent External Seam Closure 执行计划

> 服务业务簇: `Runtime Composition / External Seams`
> 计划对象: `after-skeleton / Phase 4 / external-seam-closure`
> 类型: `modify`
> 作者: `GPT-5.4`
> 时间: `2026-04-18`
> 执行序号: `A5 / 10`
> 上游前序: `A3`, `A4`
> 下游交接: `A6`
> 文件位置: `packages/session-do-runtime/**`, `packages/hooks/**`, `packages/capability-runtime/**`, `packages/llm-wrapper/**`, `packages/nacp-core/src/transport/**`, `docs/design/after-skeleton/P4-external-seam-closure.md`
> 关键仓库锚点: `packages/session-do-runtime/src/{composition,env,worker}.ts`, `packages/hooks/src/runtimes/service-binding.ts`, `packages/capability-runtime/src/targets/service-binding.ts`, `packages/nacp-core/src/transport/service-binding.ts`
> 参考 context / 对标来源: `context/claude-code/services/tools/{toolExecution,toolHooks}.ts`, `context/codex/codex-rs/tools/src/tool_registry_plan.rs`
> 关联设计 / 调研文档:
> - `docs/plan-after-skeleton.md`
> - `docs/design/after-skeleton/P3-session-edge-closure.md`
> - `docs/design/after-skeleton/P4-external-seam-closure.md`
> - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
> - `docs/design/after-skeleton/PX-QNA.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

Phase 4 要解决的问题不是“再多接几个外部服务”，而是把 nano-agent 从 **in-process 假闭环** 推进到 **少数几条 worker/service-binding seam 的真实闭环**。当前代码现实已经暴露出这种不对称：`packages/session-do-runtime/src/composition.ts` 的默认 `CompositionFactory` 只返回 `undefined` handle bag；`SessionRuntimeEnv` 还只有 `SKILL_WORKERS` 这一个模糊 remote slot；`packages/hooks/src/runtimes/service-binding.ts` 仍然是直接抛错的 stub；相对地，`packages/capability-runtime/src/targets/service-binding.ts` 已经具备 `request → progress* → response → cancel` seam，`packages/nacp-core/src/transport/service-binding.ts` 也已经把 `validateEnvelope → verifyTenantBoundary → checkAdmissibility` 三步 precheck 固化下来。换句话说，**transport reality 已经开始成形，但 runtime composition reality 仍未接真**。

Q9 已明确：Phase 4 的 v1 binding catalog **只收 capability / hook / fake provider 三条主 seam**，`SKILL_WORKERS` 继续保留为 reserved seam；Q10 已明确 Phase 5 是 verification gate，不与 P4 并行抢主线；Q12 已明确 P5 的最小真实 provider smoke 将沿 OpenAI-compatible golden path 推进。因此这份 action-plan 的任务，是把 **binding catalog、composition profile、hook/capability remote seam、fake provider worker seam、cross-seam trace/tenant/error law** 拆成可执行批次，并为 Phase 5 留下可 deploy-shaped 验证的基础件。

- **服务业务簇**：`Runtime Composition / External Seams`
- **计划对象**：`after-skeleton / Phase 4 / external-seam-closure`
- **本次计划解决的问题**：
  - `session-do-runtime` 仍没有明确的 external binding catalog 与 composition profile，remote seam 还不是 runtime truth
  - hooks remote runtime 仍是 stub，而 capability/llm 仅有 transport seam 或 local reference path，远端闭环未成
  - cross-worker trace / tenant / timeout / cancel / startup queue 还没有成为统一 law
- **本次计划的直接产出**：
  - 一套以 `CAPABILITY_WORKER / HOOK_WORKER / FAKE_PROVIDER_WORKER` 为核心的 v1 binding catalog 与 composition profile
  - 一条 hook worker、capability worker、fake provider worker 的最小 remote delegate 闭环
  - 一份可直接交给 P5 deploy-shaped verification 使用的 seam contract / test / docs 收口包

---

## 1. 执行综述

### 1.1 总体执行方式

这份 action-plan 采用 **先冻结 binding catalog 与 composition profile，再闭合 hook/capability remote seam，然后补 fake provider worker，之后统一 cross-seam propagation/failure law，最后用 tests/docs/handoff pack 收口** 的推进方式。核心原则是：**保留 local reference path，新增 service-binding-first remote path；所有跨 worker precheck 统一走 `nacp-core` transport；remote seam 的价值是闭合边界，不是立刻把一切远端化。**

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Binding Catalog & Composition Profile Freeze | `M` | 冻结 `CAPABILITY_WORKER / HOOK_WORKER / FAKE_PROVIDER_WORKER` catalog 与 local/remote profile | `Phase 3` |
| Phase 2 | Hook & Capability Worker Seam Closure | `L` | 让 hooks/capability 都拥有真实可注入的 remote runtime，而非仅测试私有 fake | `Phase 1` |
| Phase 3 | Fake Provider Worker & LLM Delegate Closure | `M` | 用 OpenAI-compatible fake provider worker 闭合 remote provider seam，同时保留 local-fetch reference path | `Phase 2` |
| Phase 4 | Cross-seam Propagation, Failure & Startup Closure | `L` | 统一 trace/tenant/request/timeout/cancel/startup queue/fallback law | `Phase 3` |
| Phase 5 | Evidence, Docs & P5 Handoff Pack | `S` | 用 tests/docs/profile 产物把 P4 交接给 P5 deploy-shaped verification | `Phase 4` |

### 1.3 Phase 说明

1. **Phase 1 — Binding Catalog & Composition Profile Freeze**
   - **核心目标**：先把 external seam 的 binding 面固定下来，防止后面每个包各自发明 remote env truth。
   - **为什么先做**：没有 catalog/profile，hooks/capability/provider 的 remote wiring 会全部漂在测试私有构造器里。
2. **Phase 2 — Hook & Capability Worker Seam Closure**
   - **核心目标**：把 hooks/capability 这两条最成熟、最直接的 seam 先接真。
   - **为什么放在这里**：hooks 有明确 `service-binding` runtime slot，capability 已有 `ServiceBindingTarget` transport seam，是最适合先收口的两条路径。
3. **Phase 3 — Fake Provider Worker & LLM Delegate Closure**
   - **核心目标**：用 fake provider worker 闭合 remote provider boundary，但不推翻 `LLMExecutor + local-fetch` 的 reference path。
   - **为什么放在这里**：provider seam 的验证价值高，但不应抢在 hooks/capability seam 之前吞掉全部工程注意力。
4. **Phase 4 — Cross-seam Propagation, Failure & Startup Closure**
   - **核心目标**：把 trace/tenant/error/progress/cancel/startup queue 统一成跨 seam 最低法则。
   - **为什么放在这里**：只有三条主 seam 都出现后，才能抽象出真正稳定的共性 law。
5. **Phase 5 — Evidence, Docs & P5 Handoff Pack**
   - **核心目标**：让 P5 直接拿到可 deploy-shaped 验证的 fake worker set、profile 和 golden-path 准备件。
   - **为什么放在这里**：P4 的闭环价值最终要在 P5 被验证，因此必须有明确 handoff pack。

### 1.4 执行策略说明

- **执行顺序原则**：`先 catalog/profile，再 hooks/capability，再 fake provider，再统一 cross-seam law`
- **风险控制原则**：`保留 local reference path；不把 skill worker 纳入 v1 binding catalog；不把 fake provider 误当产品主路径`
- **测试推进原则**：`先修包内 remote seam tests，再做 session-do-runtime composition/integration，最后跑 root cross tests`
- **文档同步原则**：`P4 design、PX-QNA、session runtime env/profile、相关 package public surface 与 tests 必须同口径`

### 1.5 本次 action-plan 影响目录树

```text
external-seam-closure
├── packages/session-do-runtime
│   ├── src/{env,composition,index,worker}.ts
│   ├── src/do/nano-session-do.ts
│   └── test/{worker,orchestration}.test.ts
│       test/integration/**/*
├── packages/hooks
│   ├── src/runtimes/service-binding.ts
│   ├── src/{dispatcher,core-mapping,index}.ts
│   └── test/integration/{service-binding-timeout,session-resume-hooks}.test.ts
├── packages/capability-runtime
│   ├── src/targets/service-binding.ts
│   ├── src/{executor,index}.ts
│   └── test/integration/{service-binding-transport,service-binding-progress,local-ts-workspace}.test.ts
├── packages/llm-wrapper
│   ├── src/{gateway,executor,session-stream-adapter,index}.ts
│   └── test/integration/{local-fetch-stream,retry-timeout}.test.ts
├── packages/nacp-core
│   ├── src/transport/service-binding.ts
│   └── test/transport/transport.test.ts
├── test/fixtures/external-seams
│   ├── fake-hook-worker.ts
│   ├── fake-capability-worker.ts
│   └── fake-provider-worker.ts
└── docs
    ├── action-plan/after-skeleton/A5-external-seam-closure.md
    └── design/after-skeleton/P4-external-seam-closure.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 冻结 external binding catalog 与 composition profile：`CAPABILITY_WORKER / HOOK_WORKER / FAKE_PROVIDER_WORKER`
- **[S2]** 把 hooks `ServiceBindingRuntime` 与 capability `ServiceBindingTarget` 提升为 session runtime 可装配的真实 remote seam
- **[S3]** 提供 deploy-shaped fake provider worker seam，并与现有 OpenAI-compatible path 对齐
- **[S4]** 冻结 cross-seam propagation law：trace / tenant / request / timeout / cancel / error / startup queue
- **[S5]** 保留 `local-ts / local-fetch` reference path，并让 local/remote 两条路共享 typed contract

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** skill worker runtime / registry / discovery plane
- **[O2]** 真正的 inference gateway 平台、真实 provider 全矩阵、商业流量策略
- **[O3]** HTTP callback transport、queue fan-out、复杂 async workflow engine
- **[O4]** browser-rendering / compact worker / OCR worker 等更多 remote worker zoo

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `CAPABILITY_WORKER / HOOK_WORKER / FAKE_PROVIDER_WORKER` catalog | `in-scope` | Q9 已明确这是 v1 binding catalog 的三条主 seam | Phase 4 完成后在 P5/Pnext 扩展时重评 |
| `SKILL_WORKERS` | `out-of-scope` | Q9 已冻结为 reserved seam，不进入本 phase truth | dedicated skill design 出现后重评 |
| `ServiceBindingTransport` precheck pipeline | `in-scope` | 这是所有 cross-worker seam 的最低 contract guard | 仅在 core transport breaking change 时重评 |
| `LLMExecutor + local-fetch` | `in-scope` | 它是当前 reference path，P4 不能推翻它 | 若 remote path 后续全面优于 local path 再重评默认值 |
| fake provider worker | `in-scope` | 它是 remote provider seam 的 boundary proof，而不是产品主路径 | P5/Pnext 可升级为真实 provider / gateway |
| real provider smoke (`gpt-4.1-nano`) | `depends-on-phase` | Q12 已冻结为 P5 golden path 输入，不属于 P4 主体 | Phase 5 action-plan 启动时执行 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | Binding Catalog Freeze | `update` | `packages/session-do-runtime/src/env.ts`, `index.ts`, docs | 把 remote env 从 `SKILL_WORKERS` 单槽升级为清晰 catalog | `high` |
| P1-02 | Phase 1 | Composition Profile Assembly | `update` | `packages/session-do-runtime/src/composition.ts`, `worker.ts`, tests | local/remote profile 成为 runtime truth，而不是测试私有注入 | `high` |
| P1-03 | Phase 1 | Reserved Skill Seam Guard | `update` | `packages/session-do-runtime/src/env.ts`, docs | 保留 `SKILL_WORKERS` reserved seam，但不让其偷渡进 v1 binding truth | `medium` |
| P2-01 | Phase 2 | Hook Worker Runtime Wiring | `update` | `packages/hooks/src/runtimes/service-binding.ts`, `dispatcher.ts`, tests | hooks remote runtime 不再只会抛错 | `high` |
| P2-02 | Phase 2 | Capability Worker Runtime Wiring | `update` | `packages/capability-runtime/src/targets/service-binding.ts`, `executor.ts`, tests | capability remote path 成为 session runtime 可装配 reality | `medium` |
| P2-03 | Phase 2 | Session Runtime Hook/Capability Composition | `update` | `packages/session-do-runtime/src/{composition,do/nano-session-do}.ts`, integration tests | Session DO 能按 profile 调用 remote hook/capability seam | `high` |
| P3-01 | Phase 3 | Fake Provider Worker Contract | `add` | `test/fixtures/external-seams/fake-provider-worker.ts`, `packages/llm-wrapper/src/gateway.ts` | remote provider seam 有 deploy-shaped fake boundary，并附带可被 wrangler/profile 消费的 worker 入口 | `medium` |
| P3-02 | Phase 3 | LLM Remote Delegate Wiring | `update` | `packages/llm-wrapper/src/{executor,gateway,session-stream-adapter}.ts`, tests | fake provider worker 与现有 stream normalization/session stream path 对齐 | `high` |
| P3-03 | Phase 3 | Reference Path Preservation | `update` | `packages/llm-wrapper/test/integration/local-fetch-stream.test.ts`, docs | local-fetch 继续作为 reference path 存在 | `low` |
| P4-01 | Phase 4 | Cross-seam Trace / Tenant / Request Propagation | `update` | `packages/nacp-core/src/transport/service-binding.ts`, session-do-runtime composition, tests | remote delegate 最低必带字段与 precheck law 固定下来 | `high` |
| P4-02 | Phase 4 | Failure / Timeout / Cancel / Fallback Law | `update` | hooks/capability/llm/runtime tests | `not-connected`、`transport-error`、timeout、cancel、local fallback 语义统一 | `high` |
| P4-03 | Phase 4 | Startup Queue / Early Event Guard | `update` | session runtime composition/eval seam, docs/tests | binding/sink 尚未 ready 时关键 early events 不丢失 | `medium` |
| P5-01 | Phase 5 | Boundary Evidence & Test Gate | `update` | all affected packages + root tests | 至少一条完整 session→worker seam 在测试里真实跑通 | `medium` |
| P5-02 | Phase 5 | Docs / Profile / P5 Handoff Pack | `update` | P4 docs, profile docs, worker fixture notes | 为 P5 deploy-shaped verification 提供 profile/golden-path 输入 | `medium` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Binding Catalog & Composition Profile Freeze

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | Binding Catalog Freeze | 把 `SessionRuntimeEnv` 从 `SKILL_WORKERS` 单一 legacy slot 升级为能表达 capability/hook/fake-provider catalog 的 runtime contract | `packages/session-do-runtime/src/env.ts`, `index.ts`, docs | external binding names 不再靠口头约定 | package tests + docs review | remote binding 面被正式冻结，skill seam 仍明确 reserved |
| P1-02 | Composition Profile Assembly | 在 `CompositionFactory` 中引入 local/remote profile，明确某条 seam 走 local 还是 service-binding | `packages/session-do-runtime/src/composition.ts`, `worker.ts`, tests | composition 不再只返回 `undefined` handle bag | `pnpm --filter @nano-agent/session-do-runtime test` | session runtime 可按 profile 组装 remote delegates |
| P1-03 | Reserved Skill Seam Guard | 明确 skill seam 只保留占位，不进入 Phase 4 执行 truth | `packages/session-do-runtime/src/env.ts`, P4 docs | 避免 skill worker scope creep | docs review | P4 不会被 skill runtime/discovery 拖偏 |

### 4.2 Phase 2 — Hook & Capability Worker Seam Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | Hook Worker Runtime Wiring | 把 `ServiceBindingRuntime.execute()` 从抛错 stub 升级为真实 remote hook runtime | `packages/hooks/src/runtimes/service-binding.ts`, `dispatcher.ts`, tests | hooks 不再只有 `local-ts` 才是真 runtime | `pnpm --filter @nano-agent/hooks test` | service-binding runtime 能通过 transport 调到 fake/real remote hook worker |
| P2-02 | Capability Worker Runtime Wiring | 将 `ServiceBindingTarget` 真正纳入 session runtime composition，并统一 progress/cancel/response contract | `packages/capability-runtime/src/targets/service-binding.ts`, `executor.ts`, tests | capability remote path 从 test double 过渡到 runtime seam | `pnpm --filter @nano-agent/capability-runtime test` | request/progress/cancel/response 成为 session runtime 可消费的现实 |
| P2-03 | Session Runtime Hook/Capability Composition | 在 `session-do-runtime` 中装配 hook/capability remote delegates，并对接 current session/kernel seams | `packages/session-do-runtime/src/{composition,do/nano-session-do}.ts`, integration tests | Session DO 能真正调用 remote hook/capability worker | package integration tests | 至少一条 session→hook 或 session→capability path 能穿过 real composition seam |

### 4.3 Phase 3 — Fake Provider Worker & LLM Delegate Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | Fake Provider Worker Contract | 新建 deploy-shaped fake provider worker fixture 与对应 worker/profile 入口，镜像当前 OpenAI-compatible Chat Completions surface | `test/fixtures/external-seams/fake-provider-worker.ts`, `packages/llm-wrapper/src/gateway.ts` | remote provider seam 有真实 boundary proof | targeted tests | fake provider 输出能被现有 adapter/executor/normalizer 消费，且能被 A6 的 wrangler profile 直接装配 |
| P3-02 | LLM Remote Delegate Wiring | 让 session runtime / llm-wrapper 能在 local-fetch 之外切到 fake provider worker path | `packages/llm-wrapper/src/{executor,gateway,session-stream-adapter}.ts`, tests | remote provider seam 不再停留在 interface-only | `pnpm --filter @nano-agent/llm-wrapper test` | fake provider path 产出的 session stream bodies 仍通过 `nacp-session` schema |
| P3-03 | Reference Path Preservation | 明确并测试 `local-fetch` 仍是 reference path；remote path 只是额外 seam，不是立即替代 | `packages/llm-wrapper/test/integration/local-fetch-stream.test.ts`, docs | dual path contract 稳定 | local-fetch integration + docs review | local/remote 两条路共享同一 typed contract，不互相漂移 |

### 4.4 Phase 4 — Cross-seam Propagation, Failure & Startup Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | Cross-seam Trace / Tenant / Request Propagation | 冻结 remote delegate 最低必带字段，并统一通过 `ServiceBindingTransport` precheck 进入对端 | `packages/nacp-core/src/transport/service-binding.ts`, session runtime composition, tests | trace/tenant/request 不再在跨 seam 时丢失 | `pnpm --filter @nano-agent/nacp-core test`, cross-package tests | 所有主 seam 都经过相同 precheck law |
| P4-02 | Failure / Timeout / Cancel / Fallback Law | 统一 `not-connected` / `transport-error` / timeout / cancel / local fallback 规则 | hooks/capability/llm/runtime code + tests | remote failure 行为不再各包各写一套 | package tests + integration tests | 所有主 seam 的失败 contract 可以被文档和测试同时解释 |
| P4-03 | Startup Queue / Early Event Guard | 处理 binding/sink 尚未 ready 时的 early events / early hook/tool/provider calls | session runtime composition/eval seam, tests/docs | startup 过渡态不再悄悄丢信号 | targeted tests + docs review | 关键 early events 要么被缓存，要么被显式拒绝，不会 silent vanish |

### 4.5 Phase 5 — Evidence, Docs & P5 Handoff Pack

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | Boundary Evidence & Test Gate | 运行 hooks/capability/llm/session/core 全量 relevant tests，并补 boundary integration evidence | all affected packages + root tests | 至少一条完整 session→worker seam 在自动化里跑通 | package tests + root tests | P4 不再只是“看起来能拼起来” |
| P5-02 | Docs / Profile / P5 Handoff Pack | 固定 fake worker set、binding profile、failure contract、P5 golden-path 输入说明 | P4 docs, profile notes, worker fixtures | P5 可以直接拿 profile 和 fake worker set 做 deploy-shaped verification | docs review | P5 不再需要重新定义 external seam contract |

---

## 5. Phase 详情

### 5.1 Phase 1 — Binding Catalog & Composition Profile Freeze

- **Phase 目标**：先让 external seam 的 binding 面与 composition 方式成为 runtime truth。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 新增文件**：
  - 视需要新增 composition profile fixtures / docs
- **本 Phase 修改文件**：
  - `packages/session-do-runtime/src/{env,composition,index,worker}.ts`
  - `packages/session-do-runtime/test/{worker,orchestration}.test.ts`
- **具体功能预期**：
  1. runtime env 能正式表达 capability/hook/fake-provider 三条 seam
  2. `CompositionFactory` 不再默认只产生 `undefined` handles
  3. `SKILL_WORKERS` 继续存在，但不会进入 Phase 4 binding truth
- **具体测试安排**：
  - **单测**：`session-do-runtime` composition/worker tests
  - **集成测试**：如需新增 profile assembly integration tests
  - **回归测试**：`pnpm --filter @nano-agent/session-do-runtime typecheck && pnpm --filter @nano-agent/session-do-runtime test`
  - **手动验证**：人工核对 env/profile 文档与 Q9 口径一致
- **收口标准**：
  - v1 binding catalog 固定下来
  - local/remote composition profile 可被 runtime 直接消费
  - skill seam 没有 scope creep 进入当前实现面
- **本 Phase 风险提醒**：
  - 如果 env/profile 不先固定，后面每个包都会重新定义 remote wiring
  - 如果 skill seam 偷渡进 catalog，P4 范围会迅速失控

### 5.2 Phase 2 — Hook & Capability Worker Seam Closure

- **Phase 目标**：先把最成熟的两条 remote seam 接真。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - 视需要新增 runtime-specific transport adapters / integration fixtures
- **本 Phase 修改文件**：
  - `packages/hooks/src/{runtimes/service-binding,dispatcher,core-mapping}.ts`
  - `packages/capability-runtime/src/{targets/service-binding,executor,index}.ts`
  - `packages/session-do-runtime/src/{composition,do/nano-session-do}.ts`
- **具体功能预期**：
  1. hooks `ServiceBindingRuntime` 能真正通过 transport 调远端 worker
  2. capability remote path 不再只存在于 isolated integration test 中
  3. Session DO 可以按 profile 装配 remote hook/capability delegates
- **具体测试安排**：
  - **单测**：`pnpm --filter @nano-agent/hooks test`, `pnpm --filter @nano-agent/capability-runtime test`
  - **集成测试**：`hooks/test/integration/{service-binding-timeout,session-resume-hooks}.test.ts`, `capability-runtime/test/integration/{service-binding-transport,service-binding-progress}.test.ts`
  - **回归测试**：`pnpm --filter @nano-agent/session-do-runtime test`
  - **手动验证**：人工确认 remote path 与 local path 共享同一 typed input/output contract
- **收口标准**：
  - hooks remote runtime 不再只是 throw stub
  - capability service-binding seam 可被 session runtime 真实装配
  - 至少一条 session→hook/capability 路径完成 composition-level 闭环
- **本 Phase 风险提醒**：
  - 如果 hooks/capability 各自发明 transport wrapping，会很快绕开 core transport law
  - 如果只在包内 fake double 中成立而不进入 session runtime composition，P4 仍是假闭环

### 5.3 Phase 3 — Fake Provider Worker & LLM Delegate Closure

- **Phase 目标**：闭合 remote provider boundary，但不破坏现有 local reference path。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
- **本 Phase 新增文件**：
  - `test/fixtures/external-seams/fake-provider-worker.ts`
  - 视需要补 `test/verification/profiles/**` 中的 fake-provider worker profile / manifest
  - 视需要新增 fake hook/capability worker fixtures
- **本 Phase 修改文件**：
  - `packages/llm-wrapper/src/{gateway,executor,session-stream-adapter,index}.ts`
  - `packages/llm-wrapper/test/integration/{local-fetch-stream,retry-timeout}.test.ts`
- **具体功能预期**：
  1. fake provider worker 镜像当前 OpenAI-compatible Chat Completions shape，且不是只停留在测试目录中的 `.ts` fixture；它必须拥有可被 `wrangler` / service-binding 消费的 deploy-shaped worker 入口
  2. remote provider path 与 `StreamNormalizer` / `session-stream-adapter` 共享同一 output truth
  3. `local-fetch` 继续作为 reference path 存在，不被 Phase 4 消灭
- **具体测试安排**：
  - **单测**：`pnpm --filter @nano-agent/llm-wrapper test`
  - **集成测试**：`local-fetch-stream.test.ts` + 新增 fake-provider integration tests
  - **回归测试**：`pnpm --filter @nano-agent/llm-wrapper typecheck && pnpm --filter @nano-agent/llm-wrapper build`
  - **手动验证**：人工确认 fake provider path 没有引入新的 session stream kind 漂移
- **收口标准**：
  - fake provider worker 成为 remote provider boundary proof
  - remote path 与 local path 输出同构
  - P5 能直接在此基础上接 `gpt-4.1-nano` golden path
- **本 Phase 风险提醒**：
  - 如果 fake provider worker shape 与 OpenAI-compatible reality 不同，P5 会重新返工 adapter/mirror
  - 如果 remote path 试图直接替代 local path，会损害回归与诊断能力

### 5.4 Phase 4 — Cross-seam Propagation, Failure & Startup Closure

- **Phase 目标**：把三条主 seam 共同依赖的 law 固定下来。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
  - `P4-03`
- **本 Phase 新增文件**：
  - 视需要新增 propagation/failure matrix docs/tests
- **本 Phase 修改文件**：
  - `packages/nacp-core/src/transport/service-binding.ts`
  - `packages/nacp-core/test/transport/transport.test.ts`
  - hooks/capability/llm/session runtime 相关 integration tests
- **具体功能预期**：
  1. remote delegate 最低必带 `trace_uuid / tenant / request identity / timeout / cancel` 规则被统一
  2. `not-connected`、`transport-error`、timeout、cancel、local fallback 语义在三条 seam 上一致
  3. binding/sink 未 ready 时的关键 early events 不会 silent 丢失
- **具体测试安排**：
  - **单测**：`pnpm --filter @nano-agent/nacp-core test`
  - **集成测试**：hooks/capability/llm/session runtime 相关 remote seam integration tests
  - **回归测试**：`npm run test:cross`
  - **手动验证**：人工检查三条 seam 的错误/trace/tenant 语义能被统一解释
- **收口标准**：
  - 所有主 seam 都走同一套 transport precheck law
  - failure / timeout / cancel / fallback semantics 清晰且稳定
  - startup 过渡态不再无声吞掉关键事件
- **本 Phase 风险提醒**：
  - 如果 propagation law 写得太松，trace-first 会在 external seam 处断裂
  - 如果 startup 过渡态不处理，deploy-shaped 验证会先暴露“early event missing”类假阴性

### 5.5 Phase 5 — Evidence, Docs & P5 Handoff Pack

- **Phase 目标**：让 Phase 4 的输出可以被 P5 直接拿来做 deploy-shaped verification。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 新增文件**：
  - 视需要新增 boundary evidence note / fake worker fixture docs
- **本 Phase 修改文件**：
  - `docs/design/after-skeleton/P4-external-seam-closure.md`
  - `docs/action-plan/after-skeleton/A5-external-seam-closure.md`
  - 相关 profile / fixture 说明
- **具体功能预期**：
  1. hooks/capability/fake-provider 三条主 seam 在测试中至少各有一条可信 evidence
  2. binding profile、fake worker set、failure contract 能直接供 P5 使用
  3. P5 hybrid validation（L1 `wrangler dev --remote` / L2 deploy smoke）与 `gpt-4.1-nano` golden path 已有明确上游输入
- **具体测试安排**：
  - **单测**：受影响 packages 全量 tests
  - **集成测试**：hooks/capability/llm/session runtime remote seam integrations
  - **回归测试**：`pnpm --filter @nano-agent/hooks build && pnpm --filter @nano-agent/capability-runtime build && pnpm --filter @nano-agent/llm-wrapper build && pnpm --filter @nano-agent/session-do-runtime build && npm run test:cross`
  - **手动验证**：核对 P4 docs / PX-QNA / future P5 输入说明完全一致
- **收口标准**：
  - 至少一条完整 session→worker boundary 有自动化证据
  - fake worker set 和 profile 可直接交给 P5
  - P4 不再只是“包级 seam 看起来有接口”
- **本 Phase 风险提醒**：
  - 若只停留在包内 integration 而无 composition-level evidence，P5 仍会发现“拼不起来”
  - 若 handoff pack 不写清楚，P5 仍需重新定义 fake worker / profile / golden path

---

## 6. 需要业主 / 架构师回答的问题清单

> **统一说明**：与本 action-plan 相关的业主 / 架构师问答，统一收录于 `docs/action-plan/after-skeleton/AX-QNA.md`；请仅在该汇总文件中填写答复，本文不再逐条填写。

### 6.1 当前判断

- 当前 **无新增必须拍板的问题**。
- Phase 4 直接继承并依赖以下已确认输入：
  1. **Q9**：v1 binding catalog 只覆盖 capability / hook / fake provider，`SKILL_WORKERS` 继续 reserved；
  2. **Q10**：P5 是 verification gate，不与 P4 并列推进；
  3. **Q12**：P5 real smoke 将沿 OpenAI-compatible golden path 推进，优先 `gpt-4.1-nano`。
- 若后续需要回到业主层，只应针对 **是否扩大 v1 binding catalog** 或 **是否改变 reference-vs-remote 双路径策略** 这类边界问题，而不是 transport adapter 的技术细节。

### 6.2 问题整理建议

- 不要把某个 fake worker 的实现位置升级成 owner 问题
- 不要把 local/remote profile 的内部命名细节升级成 owner 问题
- 只把会改变 Q9/Q10/Q12 已冻结边界的事项带回给业主

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| composition 仍停在 no-op handle bag | remote seam 只能在 isolated tests 中成立 | `high` | P1 先固定 profile，并让 session runtime 真正消费它 |
| hooks remote runtime 仍为 stub | P4 三条主 seam 会出现成熟度断层 | `high` | P2 优先闭合 hooks service-binding runtime |
| fake provider seam 与 OpenAI-compatible reality 漂移 | P5 golden path 会再次返工 | `high` | fake provider worker 明确 mirror 当前 Chat Completions shape |
| local/remote 双路径合同漂移 | 两条路各自演进，回归混乱 | `medium` | 强制 local/remote 共享 typed input/output contract 与 session stream truth |
| startup/early event 丢失 | real deploy 初始化顺序复杂 | `medium` | 在 Phase 4 明确 startup queue / explicit refusal contract |

### 7.2 约束与前提

- **技术前提**：`Phase 3 session edge 已收口，Phase 2 trace-first carrier 已可作为 external seam 上游输入`
- **运行时前提**：`local-ts / local-fetch` 继续作为 reference path 存在；remote path 不得 silently rewrite contract`
- **组织协作前提**：`ServiceBindingTransport` 的 precheck pipeline 是所有 cross-worker seam 的唯一最低 transport law`
- **上线 / 合并前提**：hooks/capability/llm/session/core 相关 tests、profile docs、fixture notes 与 P4 doc sync 必须一起过线

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/after-skeleton/P4-external-seam-closure.md`
  - `docs/design/after-skeleton/P3-session-edge-closure.md`
  - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
  - `docs/design/after-skeleton/PX-QNA.md`
- 需要同步更新的说明文档 / README：
  - 相关 runtime env/profile / golden-path 说明
- 需要同步更新的测试说明：
  - `packages/hooks/test/**`
  - `packages/capability-runtime/test/**`
  - `packages/llm-wrapper/test/**`
  - `packages/session-do-runtime/test/**`
  - `packages/nacp-core/test/transport/**`

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - 确认 `SessionRuntimeEnv` / `CompositionFactory` 已正式表达 capability/hook/fake-provider 三条 seam
  - 确认 `SKILL_WORKERS` 没有被偷渡成 v1 binding truth
- **单元测试**：
  - `pnpm --filter @nano-agent/hooks test`
  - `pnpm --filter @nano-agent/capability-runtime test`
  - `pnpm --filter @nano-agent/llm-wrapper test`
  - `pnpm --filter @nano-agent/session-do-runtime test`
  - `pnpm --filter @nano-agent/nacp-core test`
- **集成测试**：
  - `packages/hooks/test/integration/{service-binding-timeout,session-resume-hooks}.test.ts`
  - `packages/capability-runtime/test/integration/{service-binding-transport,service-binding-progress,local-ts-workspace}.test.ts`
  - `packages/llm-wrapper/test/integration/{local-fetch-stream,retry-timeout}.test.ts`
  - session runtime composition-related integration tests
- **端到端 / 手动验证**：
  - 手工检查 remote seam 的 trace/tenant/error/progress/cancel contract 是否能被统一解释
  - 手工检查 fake provider worker 与 local-fetch reference path 输出同构
- **回归测试**：
  - `pnpm --filter @nano-agent/hooks typecheck && pnpm --filter @nano-agent/hooks build`
  - `pnpm --filter @nano-agent/capability-runtime typecheck && pnpm --filter @nano-agent/capability-runtime build`
  - `pnpm --filter @nano-agent/llm-wrapper typecheck && pnpm --filter @nano-agent/llm-wrapper build`
  - `pnpm --filter @nano-agent/session-do-runtime typecheck && pnpm --filter @nano-agent/session-do-runtime build`
  - `pnpm --filter @nano-agent/nacp-core typecheck && pnpm --filter @nano-agent/nacp-core build`
  - `npm run test:cross`
- **文档校验**：
  - P4 design、action-plan、PX-QNA、binding profile docs、fixture notes 对 Q9/Q10/Q12 与 seam contract 的表述必须一致

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `CAPABILITY_WORKER / HOOK_WORKER / FAKE_PROVIDER_WORKER` 已成为正式 binding catalog truth。
2. hooks 与 capability 都拥有 session runtime 可装配的真实 remote seam。
3. fake provider worker 已闭合 remote provider boundary，且不破坏 local-fetch reference path。
4. cross-seam trace / tenant / timeout / cancel / error law 被统一并受 tests 保护。
5. P5 可以直接使用 fake worker set、profile 与 golden-path 输入做 deploy-shaped verification。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `binding catalog + composition profile + hook/capability remote seam + fake provider seam + cross-seam law` 全部落地 |
| 测试 | hooks/capability/llm/session/core tests 与 root cross tests 形成最小闭环 |
| 文档 | P4 design、action-plan、env/profile docs、fixture notes 与 PX-QNA 口径一致 |
| 风险收敛 | 不再存在 remote seam 只停留在 stub、skill scope creep、local/remote 合同漂移、cross-worker trace blind spot |
| 可交付性 | P5 deploy-shaped verification 可直接接手 P4 产物，无需重新定义 worker boundary contract |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待回填`
- **哪些编号的拆分还不够合理**：`待回填`
- **哪些问题本应更早问架构师**：`待回填`
- **哪些测试安排在实际执行中证明不够**：`待回填`
- **模板本身还需要补什么字段**：`待回填`

---

## 10. 结语

这份 action-plan 以 **把 Session DO 对外能力边界从“包内有 seam”推进到“runtime 中可装配、可测试、可交接的真实 worker seam”** 为第一优先级，采用 **先冻结 binding catalog/profile、再闭合 hook/capability、再补 fake provider、再统一 propagation/failure law、最后用 tests/docs/handoff pack 封箱** 的推进方式，优先解决 **composition no-op、hooks remote stub、provider remote path 只有 interface 没有 boundary proof** 这三类问题，并把 **不扩大到 skill worker、不破坏 local reference path、不把 fake provider 误当产品主路径** 作为主要约束。整个计划完成后，`Runtime Composition / External Seams` 应达到 **hook / capability / fake provider 三条主 seam 都有稳定 contract、稳定 profile、稳定 tests 和可交付 handoff** 的状态，从而为后续的 **deploy-shaped verification、真实 provider smoke、future skill / browser / compactor seam 扩展** 提供稳定基础。
