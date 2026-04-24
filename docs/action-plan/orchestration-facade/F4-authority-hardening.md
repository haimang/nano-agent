# F4 — Authority Hardening

> 服务业务簇: `orchestration-facade / F4 / authority-hardening`
> 计划对象: `把 authority / tenant / no-escalation / executor recheck seam 落成真实 policy layer`
> 类型: `refactor`
> 作者: `GPT-5.4`
> 时间: `2026-04-24`
> 文件位置: `docs/action-plan/orchestration-facade/F4-authority-hardening.md`
> 关联设计 / 调研文档:
> - `docs/plan-orchestration-facade.md`
> - `docs/design/orchestration-facade/F4-authority-policy-layer.md`
> - `docs/design/orchestration-facade/F0-agent-core-internal-binding-contract.md`
> - `docs/design/orchestration-facade/F0-user-do-schema.md`
> - `docs/design/orchestration-facade/FX-qna.md`
> - `workers/bash-core/src/executor.ts`
> 文档状态: `completed`

---

## 0. 执行背景与目标

F4 不是“再做一个权限系统”，而是把当前已经散落在 ingress、runtime、tenant fallback、executor policy 里的 legality 纪律，真正收束成一层 **可实现、可测试、可审计** 的 policy layer。它只做 law，不做 credit/quota/billing/revocation 域。

如果 F4 不单独执行，项目会出现一个很危险的局面：`orchestrator.core` 与 `agent.core` 的 public/internal contract 都存在了，但 legality 仍靠分散判断、隐式 fallback 与代码注释维持。那样既难 review，也难做 negative tests。

- **服务业务簇**：`orchestration-facade / F4`
- **计划对象**：`Authority Hardening`
- **本次计划解决的问题**：
  - `authority / tenant / no-escalation 仍缺少中央 helper`
  - `TEAM_UUID` law 仍未从设计落成 preview/prod 真实行为
  - `CapabilityExecutor` 还没有清晰的 future truth recheck seam
- **本次计划的直接产出**：
  - `validateIngressAuthority()` / `validateInternalAuthority()` 等 policy helper
  - `TEAM_UUID` bootstrap discipline + `tenant_source` 审计落地
  - `CapabilityExecutor` 前置 recheck seam + negative tests + `F4-closure.md`

---

## 1. 执行综述

### 1.1 总体执行方式

采用 **先集中 policy helper，再落 tenant truth law，再接 executor recheck seam，最后补 negative tests 与 closure** 的方式推进。F4 不创造新的业务域，只把合法性判断从“分散事实”变成“中央层事实”。按照 charter，F4 **可以在 F1 internal contract 落地后启动**；只是最终 negative suite / closure 会消费 F3 已完成的 canonical public cutover 真相。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | policy helper 落位 | `L` | public/internal legality 统一入口 | `F1 closed（可与 late F2/F3 部分并行）` |
| Phase 2 | tenant truth hardening | `M` | `TEAM_UUID` bootstrap law + `tenant_source` snapshot | `Phase 1` |
| Phase 3 | executor recheck seam | `M` | `CapabilityExecutor` 前置 hook 与 no-escalation 完整链路 | `Phase 2` |
| Phase 4 | negative tests 与 closure | `M` | 非法输入 / mismatch / misconfig proof + F4 closure | `Phase 3` |

### 1.3 Phase 说明

1. **Phase 1 — policy helper 落位**
   - **核心目标**：把 legality 判断从 scattered code 提取成中央 helper
   - **为什么先做**：没有中央入口，tenant/source/no-escalation 无法稳定复用
2. **Phase 2 — tenant truth hardening**
   - **核心目标**：把 `TEAM_UUID` 从设计变成 preview/prod 真实 deploy law
   - **为什么放在这里**：tenant truth 是 policy helper 最关键的外部事实
3. **Phase 3 — executor recheck seam**
   - **核心目标**：在执行前保留 credit/quota future growth point
   - **为什么放在这里**：先有 legality helper，executor seam 才知道要接什么
4. **Phase 4 — negative tests 与 closure**
   - **核心目标**：证明 F4 不是纸面 law，而是真实 enforceable discipline
   - **为什么放在最后**：negative tests 必须建立在 helper / bootstrap / executor seam 都已存在之后

### 1.4 执行策略说明

- **执行顺序原则**：`先 helper，再 tenant truth，再 executor seam，最后负例证明`
- **风险控制原则**：`严格守住 F4.A，不偷渡 credit/quota/billing domain`
- **测试推进原则**：`negative tests 与 helper 一起落，不把 law 留给 closure 口头描述`
- **文档同步原则**：`wrangler truth、policy docs、closure memo 一次同步`

### 1.5 本次 action-plan 影响目录树

```text
F4 Authority Hardening
├── workers/orchestrator-core/
│   ├── src/policy/*
│   ├── src/ingress/*
│   └── wrangler.jsonc
├── workers/agent-core/
│   ├── src/host/internal/*
│   └── wrangler.jsonc
├── workers/bash-core/
│   ├── src/executor.ts
│   └── wrangler.jsonc
├── workers/{context-core,filesystem-core}/wrangler.jsonc
├── test/
│   ├── package-e2e/orchestrator-core/06-auth-negative.test.mjs
│   └── cross / package tests for negative cases
└── docs/issue/orchestration-facade/F4-closure.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** centralized legality helper：`validateIngressAuthority()` / `validateInternalAuthority()`
- **[S2]** `TEAM_UUID` bootstrap law、preview/prod explicit config、`tenant_source` snapshot
- **[S3]** no-escalation enforcement 与 `CapabilityExecutor` 前置 recheck seam
- **[S4]** negative tests + `F4-closure.md`

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** credit / quota / billing / revocation domain
- **[O2]** multi-tenant-per-deploy source migration
- **[O3]** 重新设计 JWT 体系或引入新的 auth 产品形态
- **[O4]** 让 orchestrator 直接接管 bash/context/filesystem 业务调用路径

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `TEAM_UUID` 缺失时 `503` vs throw | `defer` | law 已冻结，具体实现风格仍属代码层选择 | `F4 实现期` |
| `tenant_source` snapshot | `in-scope` | 这是审计 truth 的一部分，不是 nice-to-have | `F4 执行期` |
| credit ledger | `out-of-scope` | charter 已明确延后 | `下一阶段 credit/quota charter` |
| executor pre-check hook | `in-scope` | future domain 不应再次重构 executor | `F4 执行期` |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | ingress/internal helper | `add` | `orchestrator-core/src/policy/*` `agent-core/*` | legality 有中央入口 | `high` |
| P1-02 | Phase 1 | typed reject taxonomy | `update` | ingress/internal handlers | negative path 可断言 | `medium` |
| P2-01 | Phase 2 | `TEAM_UUID` bootstrap law | `update` | `workers/*/wrangler.jsonc` `src/index.ts` | preview/prod tenant truth 实化，并统一到 `vars` 非 secret 配置 | `high` |
| P2-02 | Phase 2 | auth snapshot `tenant_source` | `update` | `orchestrator-core user DO` | claim vs deploy-fill 可审计 | `medium` |
| P3-01 | Phase 3 | no-escalation enforcement | `update` | policy helper + internal ingress | internal call 不成后门 | `high` |
| P3-02 | Phase 3 | executor recheck seam | `update` | `workers/bash-core/src/executor.ts` | future truth recheck 有落点，并明确 deprecated package consumer 策略 | `medium` |
| P4-01 | Phase 4 | negative tests | `add/update` | package-e2e / worker tests | law 有负例证据，且与 F3 JWT negative 边界清晰 | `medium` |
| P4-02 | Phase 4 | F4 closure + probe rollover | `add/update` | `docs/issue/orchestration-facade/F4-closure.md` `workers/orchestrator-core/src/index.ts` | F4 可正式审计，并把 orchestrator probe marker bump 到 F4 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — policy helper 落位

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | ingress/internal helper | 提取 centralized legality helpers，统一 public/internal authority checks | `orchestrator-core/src/policy/*` `agent-core/*` | law 有中央层 | unit/integration tests | legality 不再散落 |
| P1-02 | typed reject taxonomy | 固定 missing trace / missing authority / tenant mismatch / escalation rejection shapes | ingress/internal handlers | negative path 可被断言 | tests | reject shapes 稳定 |

### 4.2 Phase 2 — tenant truth hardening

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | `TEAM_UUID` bootstrap law | 在 5 个 worker 的 `wrangler.jsonc vars` 中显式提供 `TEAM_UUID`（非 secret），入口处做 misconfigured deploy check；立即 runtime consumer 以 orchestrator/agent 为主，其余 worker 维持同一 single-tenant deploy truth | `workers/*/wrangler.jsonc` `src/index.ts` | tenant truth 成为真实 deploy law | worker tests | preview/prod 缺失不再默默 `_unknown` |
| P2-02 | auth snapshot `tenant_source` | 记录 `claim` / `deploy-fill` 审计来源，并在 claim mismatch 时 typed reject | orchestrator user DO | 审计可区分 claim vs fill | unit/integration tests | snapshot 与 reject 行为对齐 |

### 4.3 Phase 3 — executor recheck seam

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | no-escalation enforcement | internal request 经过 header gate 后仍要做 legality/no-escalation 校验 | policy helper + agent internal ingress | internal path 不成逃逸面 | integration tests | escalation 可被拒绝 |
| P3-02 | executor recheck seam | 在 `CapabilityExecutor` 中 `policy.check(plan)` 之后、target handler lookup 之前放集中 hook；启动前先 grep 确认 `packages/capability-runtime` 无 runtime consumers，若仍有则同步 patch 或先清消费者 | `workers/bash-core/src/executor.ts` | future truth recheck 有正式落点 | unit tests | seam 存在且不破坏当前执行流，且无 deprecated consumer 盲区 |

### 4.4 Phase 4 — negative tests 与 closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | negative tests | 覆盖 missing trace、missing authority、tenant mismatch、preview missing TEAM_UUID、escalation；JWT missing/invalid 继续归 F3 `06-auth-negative` | package-e2e / worker tests | law 有负例 proof | tests | 关键 reject paths 全绿，且与 F3 分工清楚 |
| P4-02 | F4 closure + probe rollover | 汇总 F4.A 完成证据，明确未做的 domain 范围，并把 orchestrator probe marker bump 到 `orchestration-facade-F4` | `docs/issue/orchestration-facade/F4-closure.md` `workers/orchestrator-core/src/index.ts` | F4 闭合且不越权 | 文档 review | closure 可直引，probe marker 已同步 |

---

## 5. Phase 详情

### 5.1 Phase 1 — policy helper 落位

- **Phase 目标**：让 legality 规则拥有单一入口
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 新增文件**：
  - `workers/orchestrator-core/src/policy/*.ts`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/ingress/*.ts`
  - `workers/agent-core/src/host/internal/*.ts`
- **具体功能预期**：
  1. public/internal legality 统一通过 helper
  2. typed reject shape 可被机械断言
  3. helper 成为 future code review 的中央锚点
- **具体测试安排**：
  - **单测**：`policy helper tests`
  - **集成测试**：`ingress/internal negative flows`
  - **回归测试**：`orchestrator-core + agent-core tests`
  - **手动验证**：`检查各入口不再自行拼 legality`
- **收口标准**：
  - legality helper 被各入口消费
  - reject shapes 统一
- **本 Phase 风险提醒**：
  - 最容易只抽 helper 文件，但调用仍散落

### 5.2 Phase 2 — tenant truth hardening

- **Phase 目标**：让 `TEAM_UUID` law 成为部署现实
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `workers/{orchestrator-core,agent-core,bash-core,context-core,filesystem-core}/wrangler.jsonc`
  - `workers/*/src/index.ts`
  - `workers/orchestrator-core/src/user-do/*.ts`
- **具体功能预期**：
  1. preview/prod 通过 `wrangler vars` 显式配置 `TEAM_UUID`（非 secret）
  2. `_unknown` fallback 只在 test/local 生效
  3. `tenant_source` 进入 auth snapshot
- **具体测试安排**：
  - **单测**：`snapshot tests`
  - **集成测试**：`tenant mismatch / deploy-fill`
  - **回归测试**：`relevant worker tests`
  - **手动验证**：`preview env misconfig smoke`
- **收口标准**：
  - tenant truth law 不再停留在纸面
  - 审计可区分 claim 与 deploy-fill
- **本 Phase 风险提醒**：
  - 最容易忘记 5 个 worker 的 wrangler truth 要一起收口

### 5.3 Phase 3 — executor recheck seam

- **Phase 目标**：把 legality 从 ingress 延续到 capability execute 前
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `workers/bash-core/src/executor.ts`
  - `policy helpers`
- **具体功能预期**：
  1. internal call 不得提权
  2. executor 前存在集中 hook，插入点固定在 `policy.check(plan)` 之后、target lookup 之前
  3. future credit/quota 无需重开 executor 主路径，且 deprecated package consumer 不留下盲区
- **具体测试安排**：
  - **单测**：`executor seam tests`
  - **集成测试**：`policy-denied / escalation`
  - **回归测试**：`bash-core tests`
  - **手动验证**：`hook 调用顺序检查`
- **收口标准**：
  - no-escalation 成为真实 enforceable rule
  - executor seam 存在且不会破坏 happy path
- **本 Phase 风险提醒**：
  - 最容易“顺手”把 credit domain 也建起来，越权扩大范围

### 5.4 Phase 4 — negative tests 与 closure

- **Phase 目标**：证明 F4 是 enforceable law，而非文档宣言
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 新增文件**：
  - `docs/issue/orchestration-facade/F4-closure.md`
- **本 Phase 修改文件**：
  - `test/package-e2e/orchestrator-core/06-auth-negative.test.mjs`
  - `相关 worker tests`
- **具体功能预期**：
  1. law 的关键负例全部可测
  2. closure 清楚列出 F4.A 完成与 F4.B 未做边界
  3. orchestrator probe marker 已切到 `orchestration-facade-F4`
  4. 下游不会误以为 credit/quota 已存在
- **具体测试安排**：
  - **单测**：`policy helper / executor seam`
  - **集成测试**：`negative flows`
  - **回归测试**：`relevant package-e2e + worker tests`
  - **手动验证**：`misconfigured preview smoke + probe marker rollover`
- **收口标准**：
  - 关键负例均有证据
  - F4 closure 明确写出“只做 law，不做 domain”
  - orchestrator probe marker 已切到 `orchestration-facade-F4`
- **本 Phase 风险提醒**：
  - 最容易只写 closure，不补负例测试

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 当前结论

本阶段 **无新增 owner-level blocker**。  
Q1/Q5/Q6 对 internal auth、`TEAM_UUID` law、tenant claim 缺失语义已冻结，本计划直接执行。

### 6.2 问题整理建议

- `503` 还是 throw 只影响实现风格，不影响 F4 law
- 若 future 启动 multi-tenant charter，必须显式 revisit 本文所有 deploy-fill 假设

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| legality helper 只存在名义上 | 若入口不统一消费，仍是散落 law | `high` | Phase 1 必须覆盖 public + internal 两侧 |
| `_unknown` fallback 偷活到 preview/prod | tenant truth 失真 | `high` | Phase 2 强制 bootstrap law |
| F4 越权膨胀成 credit domain | 计划失焦 | `medium` | closure 明确 F4.A / F4.B 边界 |

### 7.2 约束与前提

- **技术前提**：`F1 已完成 internal contract 与 public façade 起步；F4 可在 late F2/F3 并行推进，但 closure/negative suite 消费 F3 canonical cutover 结果`
- **运行时前提**：`可修改 5 个 worker 的 wrangler truth 与相关 tests，并先 grep 确认 `packages/capability-runtime` 无 runtime consumers 或已纳入同步策略`
- **组织协作前提**：`团队接受 F4 只做 law，不顺手做 domain`
- **上线 / 合并前提**：`negative tests 与 closure 证据必须齐`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/orchestration-facade/F4-authority-policy-layer.md`
  - `docs/design/orchestration-facade/F0-user-do-schema.md`
- 需要同步更新的说明文档 / README：
  - `workers/orchestrator-core/README.md`
  - `workers/bash-core/README.md`
- 需要同步更新的测试说明：
  - `test/INDEX.md`（若 F4 引入新的 negative live cases）

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `public/internal legality helper 已集中`
  - `TEAM_UUID` law 已成 deploy/runtime truth
- **单元测试**：
  - `policy helper / snapshot / executor seam`
- **集成测试**：
  - `tenant mismatch / invalid internal auth / escalation`
- **端到端 / 手动验证**：
  - `preview misconfig / negative ingress smoke`
- **回归测试**：
  - `relevant worker tests + negative package-e2e`
- **文档校验**：
  - `F4 closure 与 F4 design 边界一致`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `public/internal legality 已有中央 helper`
2. `preview/prod TEAM_UUID` law 已真实 enforced
3. `tenant_source` snapshot 已可审计
4. `CapabilityExecutor` 已存在前置 truth recheck seam
5. `deprecated capability-runtime consumer strategy` 已被检查并收口
6. `F4-closure.md` 已明确 F4.A 完成、F4.B 未做，且 probe marker 已 rollover

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `authority / tenant / no-escalation law 已真实落地` |
| 测试 | `关键负例均有自动化证据` |
| 文档 | `F4 closure 与设计文档保持一致` |
| 风险收敛 | `_unknown` 不再偷活成 preview/prod truth |
| 可交付性 | `future credit/quota 可在既有 seam 上接入` |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`Phase 2 可能因 wrangler/env truth 扩散面而超预期`
- **哪些编号的拆分还不够合理**：`若 no-escalation 与 tenant truth 经常绑在一起返工，可进一步细拆`
- **哪些问题本应更早问架构师**：`若 implementation 层对 503/throw 意见分裂很大，应更早形成 repo 约定`
- **哪些测试安排在实际执行中证明不够**：`若 negative tests 只停留在 package-e2e，应补 worker-unit 粒度`
- **模板本身还需要补什么字段**：`future 可增加 “config truth rollout” 专门 checklist`

---

## 10. 结语

这份 action-plan 以 **把 legality 纪律收束成真实 policy layer** 为第一优先级，采用 **先 helper、再 tenant truth、再 executor seam、最后负例证明** 的推进方式，优先解决 **authority law 分散** 与 **tenant truth 仍停留在 `_unknown` fallback 心智** 两个问题，并把 **不偷渡 credit/quota/billing domain** 作为主要约束。整个计划完成后，`orchestration-facade / F4` 应达到 **authority hardening 已闭合、future truth recheck seam 已就位** 的状态，从而为后续的 **F5 final closure 与下一阶段权限/额度域** 提供稳定基础。

---

## 11. 2026-04-24 执行日志

1. 新增 `workers/orchestrator-core/src/policy/authority.ts`，把 `TEAM_UUID` misconfig、`trace_uuid` 读取与 typed policy reject 统一收束到中央 helper。
2. 更新 `workers/orchestrator-core/src/auth.ts` 与 `src/index.ts`，让 public ingress 强制要求 trace、在 claim/deploy tenant 不一致时 fail-closed，并继续由 orchestrator 作为唯一 public owner。
3. 新增 `workers/agent-core/src/host/internal-policy.ts` 并接入 `src/host/internal.ts`，把 internal secret、authority header、body/header no-escalation、tenant truth 全部变成真实 enforcement。
4. 更新 `workers/orchestrator-core/src/user-do.ts`，对 internal forwarding 显式补上 `x-trace-uuid` 与 `x-nano-internal-authority`，并要求 persisted auth snapshot 缺失时直接拒绝。
5. 在 `workers/bash-core/src/executor.ts` 增加 `beforeCapabilityExecute()` seam，并在 `workers/bash-core/test/executor.test.ts` 固定其 fail-closed 与 happy-path 语义。
6. 将 `TEAM_UUID` 显式加入 `workers/{orchestrator-core,agent-core,bash-core,context-core,filesystem-core}/wrangler.jsonc`，把 single-tenant deploy truth 收口成 preview/runtime 现实。
7. 扩充了 `orchestrator-core` 与 `agent-core` 的 worker tests、`test/shared/orchestrator-auth.mjs`、`test/package-e2e/orchestrator-core/03/04/06`，新增 missing trace、tenant mismatch、internal invalid-authority / escalation 的自动化证据。
8. 完成本地 typecheck/build/test、五个 worker dry-run、五个 preview redeploy，以及 live `pnpm test:package-e2e` (`35/35`) / `pnpm test:cross` (`46/46`)。
9. 补出 `docs/issue/orchestration-facade/F4-closure.md`；由于 F5 在同一执行链中立刻启动，F4 原计划中的短暂 probe marker 过渡态已被终态 marker 吸收，当前 HEAD 直接显示 `orchestration-facade-closed`。
