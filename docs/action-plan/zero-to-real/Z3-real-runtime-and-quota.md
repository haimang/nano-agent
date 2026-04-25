# Z3 — Real Runtime and Quota

> 服务业务簇: `zero-to-real / Z3 / real-runtime-and-quota`
> 计划对象: `把 agent loop 从 fake/local reference path 推到 Workers AI mainline + quota-gated runtime`
> 类型: `migration`
> 作者: `GPT-5.4`
> 时间: `2026-04-25`
> 文件位置: `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md`
> 关联设计 / 调研文档:
> - `docs/charter/plan-zero-to-real.md`
> - `docs/design/zero-to-real/Z3-real-runtime-and-quota.md`
> - `docs/design/zero-to-real/ZX-qna.md`
> - `docs/design/zero-to-real/ZX-llm-adapter-and-secrets.md`
> - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`
> - `docs/design/zero-to-real/ZX-nacp-realization-track.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

Z2 之后，系统已经拥有真实 auth/session/audit baseline，但 agent loop 仍可能停留在 local reference path、fake provider、没有 quota owner 的状态。zero-to-real 的真正价值并不在“session 能建立”，而在“session 能真实执行一轮 LLM + tool loop，并且这个 loop 受账户余额、usage 持久化、NACP envelope 与 activity evidence 共同约束”。

因此 Z3 的目标是一次性完成 3 件关键事情：**冻结并接入 Workers AI mainline、建立 LLM+tool 双 gate 的 quota discipline、把 usage/balance/runtime evidence 写入 durable truth**。没有这一步，Z4 的 web / Mini Program 实验只能停留在 mock/happy path。

- **服务业务簇**：`zero-to-real / Z3`
- **计划对象**：`Real Runtime and Quota`
- **本次计划解决的问题**：
  - `workers/agent-core/src/llm/**` 仍未以 `AI` binding 成为唯一 mainline provider
  - tool 与 llm 都没有账户余额驱动的统一 gate
  - usage / balance / quota decisions 尚未成为 D1 truth
  - agent loop 的 runtime evidence 还没有与 Z2 session/audit truth 真正闭环
- **本次计划的直接产出**：
  - `workers/agent-core/` 的 Workers AI mainline wiring
  - `workers/orchestrator-core/migrations/003-usage-and-quota.sql`
  - `workers/agent-core/**` 与 `workers/bash-core/**` 的 dual-gate runtime
  - `docs/issue/zero-to-real/Z3-closure.md`

---

## 1. 执行综述

### 1.1 总体执行方式

采用 **先 provider freeze + binding 接线，再接 real execution path，再加 quota dual gate，最后补 usage/audit/evidence closure** 的方式推进。Z3 不再讨论 provider 抽象哲学，而是把 Q8/Q9 凝固成具体运行面：`AI` binding + Workers AI model ID + durable usage/balance + tool/llm shared rejection law。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Workers AI Freeze | `M` | 把 `AI` binding、model registry、preview secrets/bindings 冻结到代码与 wrangler | `Z2 closed` |
| Phase 2 | Real LLM Execution Path | `L` | 让 agent loop 真正走 Workers AI，而不是 local-only reference path | `Phase 1` |
| Phase 3 | Quota Dual Gate | `L` | 为 llm 与 tool 建统一 quota authorizer / rejection path | `Phase 2` |
| Phase 4 | Usage + Audit Evidence | `M` | 把 usage/balance/quota decisions 写入 D1 与 session activity/eval evidence | `Phase 3` |
| Phase 5 | Runtime Closure | `S` | 用真实 loop / quota negative tests / closure 证明 Z3 成立 | `Phase 4` |

### 1.3 Phase 说明

1. **Phase 1 — Workers AI Freeze**
   - **核心目标**：把 Z3 的 provider mainline 真正定死在代码层。
   - **为什么先做**：没有 provider freeze，runtime、tests、client evidence 都没有稳定 target。
2. **Phase 2 — Real LLM Execution Path**
   - **核心目标**：让 agent loop 从 preview scaffolding 进入真实 inference path。
   - **为什么放在这里**：先有 binding/model truth，才能接 runtime。
3. **Phase 3 — Quota Dual Gate**
   - **核心目标**：把“余额不足不可继续 LLM 或 tool 调用”变成系统级 law。
   - **为什么放在这里**：必须建立在真实 execution path 之上。
4. **Phase 4 — Usage + Audit Evidence**
   - **核心目标**：确保 every accepted/rejected call 都能被 durable truth 与 evidence 看见。
   - **为什么放在这里**：quota 如果只存在于 runtime memory，就不能称为 zero-to-real。
5. **Phase 5 — Runtime Closure**
   - **核心目标**：拿出真实 loop + negative proof + closure 文档。
   - **为什么放在最后**：只有真实 path 跑通并被 durable evidence 捕获后才能收口。

### 1.4 执行策略说明

- **执行顺序原则**：`先 mainline provider，再 runtime path，再 quota gate，再 evidence`
- **风险控制原则**：`继续保留 DeepSeek skeleton，但不允许与 Workers AI 争夺 mainline`
- **测试推进原则**：`优先扩现有 agent-core / bash-core package-e2e 与 cross-e2e，不另建 runtime test tree`
- **文档同步原则**：`Q8/Q9 + ZX-LLM + ZX-D1 + Z2 closure 一起消费`

### 1.5 本次 action-plan 影响目录树

```text
Z3 Real Runtime and Quota
├── workers/
│   ├── agent-core/
│   │   ├── wrangler.jsonc
│   │   └── src/
│   │       ├── llm/**
│   │       ├── kernel/**
│   │       ├── hooks/**
│   │       ├── eval/**
│   │       └── host/**
│   ├── bash-core/
│   │   ├── wrangler.jsonc
│   │   └── src/
│   │       ├── executor.ts
│   │       ├── tool-call.ts
│   │       ├── policy.ts
│   │       └── capabilities/**
│   └── orchestrator-core/
│       └── migrations/
│           └── 003-usage-and-quota.sql         [new]
├── test/
│   ├── package-e2e/agent-core/
│   ├── package-e2e/bash-core/
│   └── cross-e2e/
└── docs/issue/zero-to-real/Z3-closure.md       [new]
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 把 `AI` binding 与 Workers AI first-wave model 变成 mainline provider
- **[S2]** 让 agent loop 真实走 `workers/agent-core/src/llm/**` + `kernel/**`
- **[S3]** 为 llm 与 tool 建统一 quota dual gate
- **[S4]** 落 usage/balance/quota tables 与 writeback truth
- **[S5]** 把 accepted/rejected runtime evidence 写入 activity/audit/eval stream

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 多 provider GA 与复杂路由
- **[O2]** 细粒度 billing/statement/finance admin UI
- **[O3]** 完整 browser-rendering productization
- **[O4]** 大规模 client hardening 与产品包装

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| Workers AI = mainline | `in-scope` | Q8 已冻结必须成为 Z3 主路径 | `Z3 执行期` |
| DeepSeek skeleton | `in-scope` | Q8 明确保留 skeleton，不做 mainline | `未来 provider 扩展阶段` |
| llm + tool 双 gate | `in-scope` | Q9 已冻结两者都要受 quota 约束 | `Z3 执行期` |
| 多租户计费中心 / 发票化 | `out-of-scope` | Z3 先做 runtime gating，不做完整财务系统 | `后续商业化阶段` |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | AI binding freeze | `update` | `workers/agent-core/wrangler.jsonc` `src/llm/registry/**` | 把 Workers AI mainline 固定进配置与 registry | `medium` |
| P2-01 | Phase 2 | real llm execution path | `update` | `workers/agent-core/src/llm/**` `src/kernel/**` | 让真实 loop 走 Workers AI | `high` |
| P2-02 | Phase 2 | session stream/runtime mapping | `update` | `workers/agent-core/src/llm/session-stream-adapter.ts` `src/kernel/session-stream-mapping.ts` | 把真实 llm 执行映到 session truth | `high` |
| P3-01 | Phase 3 | quota authorizer | `update` | `workers/agent-core/src/host/**` `src/kernel/**` | 统一 llm/tool 额度门禁 | `high` |
| P3-02 | Phase 3 | bash-core gate integration | `update` | `workers/bash-core/src/executor.ts` `tool-call.ts` `policy.ts` | tool call 真实受 quota 约束 | `high` |
| P4-01 | Phase 4 | usage/quota migrations | `add` | `workers/orchestrator-core/migrations/003-usage-and-quota.sql` | 落 usage/balance/quota durable truth | `medium` |
| P4-02 | Phase 4 | audit/eval evidence | `update` | `workers/agent-core/src/eval/**` `src/hooks/**` | accepted/rejected runtime evidence 可读 | `medium` |
| P5-01 | Phase 5 | runtime/quota tests | `update` | `test/package-e2e/agent-core/**` `test/package-e2e/bash-core/**` `test/cross-e2e/**` | 证明真实 loop 与 dual gate 成立 | `medium` |
| P5-02 | Phase 5 | Z3 closure | `add` | `docs/issue/zero-to-real/Z3-closure.md` | 形成 runtime 收口文档 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Workers AI Freeze

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | AI binding freeze | 把 `AI` binding、Workers AI first-wave model、preview/local env contract 写入 `agent-core` | `workers/agent-core/wrangler.jsonc` `src/llm/registry/providers.ts` `models.ts` | provider mainline 进入可执行代码 | package-e2e / preview probe | 不再存在“mainline provider 未定”的口径 |

### 4.2 Phase 2 — Real LLM Execution Path

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | real llm execution path | 让 `LLMExecutor` / `request-builder` / adapter 真正调 Workers AI | `workers/agent-core/src/llm/**` `src/kernel/runner.ts` | loop 进入真实推理路径 | package-e2e / integration | preview 上可完成真实 prompt -> delta/result |
| P2-02 | session stream/runtime mapping | 把真实 llm execution events 正规映到 session stream / timeline / activity | `session-stream-adapter.ts` `kernel/session-stream-mapping.ts` | session truth 与 llm path 一致 | package-e2e / cross-e2e | no invented event kind，timeline 可读 |

### 4.3 Phase 3 — Quota Dual Gate

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | quota authorizer | 在 agent-core runtime 入口为 llm/tool 统一做余额校验、authorize、deduct/reject | `workers/agent-core/src/host/**` `src/kernel/**` | llm 与 tool 共用一套额度 law | package-e2e / negative tests | insufficient balance 会阻止 llm 与 tool |
| P3-02 | bash-core gate integration | `bash-core` 执行前消费 quota decision，并把拒绝/执行结果映回 session | `workers/bash-core/src/executor.ts` `tool-call.ts` `policy.ts` | tool gate 与 llm gate 行为一致 | package-e2e / cross-e2e | tool reject 具备 typed reason 与 audit trail |

### 4.4 Phase 4 — Usage + Audit Evidence

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | usage/quota migrations | 落 `nano_usage_ledger`、quota balance/read model 等 durable tables | `workers/orchestrator-core/migrations/003-usage-and-quota.sql` | quota 不再只存在 memory | migration smoke / D1 assertions | accepted/rejected 调用都能留下 durable 记录 |
| P4-02 | audit/eval evidence | 将 llm/tool accepted/rejected、usage delta、quota reason 写入 activity/eval evidence | `workers/agent-core/src/eval/**` `src/hooks/**` | runtime evidence 闭环 | package-e2e / audit row assertions | replay/history 可看到关键 runtime 决策 |

### 4.5 Phase 5 — Runtime Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | runtime/quota tests | 覆盖 real llm run、tool happy path、quota exhausted、quota recover 等场景 | `test/package-e2e/agent-core/**` `test/package-e2e/bash-core/**` `test/cross-e2e/**` | Z3 具备真实 loop proof | `pnpm test:package-e2e` / `pnpm test:cross` | 至少一轮真实 prompt->tool->response 成功，负例 reject 正常 |
| P5-02 | Z3 closure | 写 `Z3-closure.md`，记录 provider freeze、dual gate、usage/audit/evidence 真相 | `docs/issue/zero-to-real/Z3-closure.md` | Z4 能在真实 loop 上做 client 实验 | 文档 review | closure 诚实写出 mainline / skeleton / residuals |

---

## 5. Phase 详情

### 5.1 Phase 1 — Workers AI Freeze

- **Phase 目标**：把 provider 选择从设计判断变成 runtime truth
- **本 Phase 对应编号**：
  - `P1-01`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `workers/agent-core/wrangler.jsonc`
  - `workers/agent-core/src/llm/registry/providers.ts`
  - `workers/agent-core/src/llm/registry/models.ts`
- **具体功能预期**：
  1. `AI` binding 真正进入 `agent-core` 环境契约。
  2. Workers AI first-wave model 成为 canonical mainline。
  3. DeepSeek 仅保留 skeleton position。
- **具体测试安排**：
  - **单测**：`provider/model registry`
  - **集成测试**：`AI binding smoke`
  - **回归测试**：`agent-core package-e2e probe`
  - **手动验证**：`preview env binding 检查`
- **收口标准**：
  - provider/model truth 固定
  - env contract 可运行
  - 文档/代码不再分叉
- **本 Phase 风险提醒**：
  - 最容易停留在文档冻结，不完成 wrangler/runtime wiring

### 5.2 Phase 2 — Real LLM Execution Path

- **Phase 目标**：让真实 LLM 执行接管 session 主链
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `workers/agent-core/src/llm/**`
  - `workers/agent-core/src/kernel/runner.ts`
  - `workers/agent-core/src/kernel/session-stream-mapping.ts`
- **具体功能预期**：
  1. prompt 真正调用 Workers AI。
  2. delta/result/toolcall 事件映到现有 session truth。
  3. local reference/fake provider 不再是 mainline。
- **具体测试安排**：
  - **单测**：`stream normalization / adapter`
  - **集成测试**：`real prompt completion`
  - **回归测试**：`agent-core package-e2e + cross-e2e`
  - **手动验证**：`preview agent loop smoke`
- **收口标准**：
  - 至少一轮真实 inference 成功
  - session history/timeline 能看见 llm 执行
  - no invented wire/event drift
- **本 Phase 风险提醒**：
  - 最容易在 adapter 成功但 session stream 映射仍旧漂移

### 5.3 Phase 3 — Quota Dual Gate

- **Phase 目标**：把 runtime 资源消耗正式纳入商业/安全门禁
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `可新增 workers/agent-core/src/host/quota/**`
- **本 Phase 修改文件**：
  - `workers/agent-core/src/host/**`
  - `workers/agent-core/src/kernel/**`
  - `workers/bash-core/src/executor.ts`
  - `workers/bash-core/src/tool-call.ts`
  - `workers/bash-core/src/policy.ts`
- **具体功能预期**：
  1. llm 与 tool 都要先过 quota authorizer。
  2. rejected path 带 typed reason 和 audit trail。
  3. accepted path 带 usage delta 与余额写回。
- **具体测试安排**：
  - **单测**：`quota decision helpers`
  - **集成测试**：`llm reject / tool reject / balance recover`
  - **回归测试**：`02-agent-bash-tool-call-happy-path` `09-capability-error-envelope-through-agent`
  - **手动验证**：`余额耗尽后重试`
- **收口标准**：
  - dual gate 可见
  - reject reason 稳定
  - balance/usage 写回路径存在
- **本 Phase 风险提醒**：
  - 最容易只 gate LLM，忘记工具调用

### 5.4 Phase 4 — Usage + Audit Evidence

- **Phase 目标**：把 quota/runtime 决策变成 durable 证据
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 新增文件**：
  - `workers/orchestrator-core/migrations/003-usage-and-quota.sql`
- **本 Phase 修改文件**：
  - `workers/agent-core/src/eval/**`
  - `workers/agent-core/src/hooks/**`
  - `workers/agent-core/src/host/eval-sink.ts`
- **具体功能预期**：
  1. usage/balance 不再只是 runtime memory。
  2. accepted/rejected runtime decisions 可回放。
  3. Z4 client 端能观察到真实失败原因与余额状态。
- **具体测试安排**：
  - **单测**：`usage ledger writers`
  - **集成测试**：`audit/eval evidence writeback`
  - **回归测试**：`cross-e2e + D1 assertions`
  - **手动验证**：`timeline/history 查看 quota 相关事件`
- **收口标准**：
  - ledger tables 可读
  - audit/eval stream 可见 quota 决策
  - Z4 可以消费这些 runtime signals
- **本 Phase 风险提醒**：
  - 最容易只有 DB 写入、没有 session/audit 层可见性

### 5.5 Phase 5 — Runtime Closure

- **Phase 目标**：证明系统第一次拥有真实 agent loop
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 新增文件**：
  - `docs/issue/zero-to-real/Z3-closure.md`
- **本 Phase 修改文件**：
  - `test/package-e2e/agent-core/**`
  - `test/package-e2e/bash-core/**`
  - `test/cross-e2e/02-agent-bash-tool-call-happy-path.test.mjs`
  - `test/cross-e2e/09-capability-error-envelope-through-agent.test.mjs`
- **具体功能预期**：
  1. 至少一轮真实 loop 成功。
  2. quota 负例成立。
  3. closure 诚实写清 Workers AI mainline 与 skeleton provider 的边界。
- **具体测试安排**：
  - **单测**：`无额外要求`
  - **集成测试**：`real loop + quota negatives`
  - **回归测试**：`pnpm test:package-e2e && pnpm test:cross`
  - **手动验证**：`preview 真实一轮执行`
- **收口标准**：
  - real loop 成功
  - insufficient balance 阻止 llm/tool
  - `Z3-closure.md` 存在
- **本 Phase 风险提醒**：
  - 最容易只完成 provider wiring，而没有拿出真实 loop 证据

---

## 6. 风险与依赖

| 风险 / 依赖 | 描述 | 缓解方式 |
|-------------|------|----------|
| Workers AI 配置与配额不稳定 | preview/live 可能表现不一 | 把 model freeze、fallback policy、known residual 写进 closure |
| quota 决策分叉 | llm 与 tool 走不同 gate 逻辑 | 用 shared authorizer / shared error taxonomy 收敛 |
| durable usage 写入滞后 | runtime 成功但 ledger 丢写 | 以 activity/eval evidence + D1 assertions 双重护栏证明 |

---

## 7. 完成后的预期状态

Z3 完成后，系统将具备：

1. Workers AI mainline 真实 agent loop
2. llm + tool 双 quota gate
3. durable usage/balance/quota truth
4. 可被 Z4 客户端真实消费的失败/恢复/runtime evidence

---

## 8. 本计划完成后立即解锁的后续动作

1. 启动 `Z4-real-clients-and-first-real-run.md`
2. 用 web / Mini Program 在真实 quota/runtime 基线之上找 gap
3. 把 residual 归档为 Z4/Z5 closure 输入
