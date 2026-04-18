# A6. Nano-Agent Deployment Dry-Run and Real Boundary Verification 执行计划

> 服务业务簇: `Deployment Verification / Boundary Smoke`
> 计划对象: `after-skeleton / Phase 5 / deployment-dry-run-and-real-boundary-verification`
> 类型: `modify`
> 作者: `GPT-5.4`
> 时间: `2026-04-18`
> 执行序号: `A6 / 10`
> 上游前序: `A4`, `A5`
> 下游交接: `A7`
> 文件位置: `packages/session-do-runtime/**`, `packages/hooks/**`, `packages/capability-runtime/**`, `packages/llm-wrapper/**`, `test/e2e/**`, `docs/design/after-skeleton/P5-deployment-dry-run-and-real-boundary-verification.md`
> 关键仓库锚点: `packages/session-do-runtime/wrangler.jsonc`, `packages/session-do-runtime/src/{worker,env,composition}.ts`, `packages/llm-wrapper/src/{gateway,executor}.ts`, `test/e2e/*.test.mjs`
> 参考 context / 对标来源: `context/claude-code/services/tools/toolExecution.ts`, `context/codex/codex-rs/tools/src/tool_registry_plan.rs`
> 关联设计 / 调研文档:
> - `docs/plan-after-skeleton.md`
> - `docs/design/after-skeleton/P4-external-seam-closure.md`
> - `docs/design/after-skeleton/P5-deployment-dry-run-and-real-boundary-verification.md`
> - `docs/design/after-skeleton/P6-storage-and-context-evidence-closure.md`
> - `docs/design/after-skeleton/PX-QNA.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

Phase 5 不是“上线生产”，而是把 nano-agent 从 **node-harness 里的假闭环** 推进到 **deploy-shaped Worker/DO/service-binding 边界的可信验证闭环**。当前仓库已经有不少可复用资产：root `test/e2e/` 已存在 14 个 fake-but-faithful 场景，`session-do-runtime` 已有 `worker.ts` / `routeRequest()` / `NanoSessionDO.fetch()` 这些 deploy-oriented 骨架，`llm-wrapper` 也已有真正的 `LLMExecutor + local-fetch` 执行路径。但同一时间，真实 deploy reality 仍明显不完整：仓内只有一份 `packages/session-do-runtime/wrangler.jsonc`，并且只声明了 `SESSION_DO` binding；`WsController` / `HttpController` 仍是 stub；仓内还没有 wrangler profile matrix，也没有可复用的 fake hook / capability / provider worker fixture。

Q10 已确认 Phase 5 是 **verification gate**，不是与 P3/P4 并列推进的实现 phase；Q11 已冻结为 **L1 默认走 `wrangler dev --remote`，L2 必须走 `wrangler deploy + workers.dev smoke`** 的 hybrid 方案；Q12 已冻结 **`gpt-4.1-nano` 为唯一最小真实 provider golden path**。因此这份 action-plan 的目标，是在不把 scope 扩成 prod rollout 的前提下，建立一条从 **L0 in-process → L1 deploy-shaped dry-run → L2 real-boundary smoke** 的验证阶梯，并让每次验证都产出可审阅的 verdict bundle，而不是停留在“脚本退出码 0”。

- **服务业务簇**：`Deployment Verification / Boundary Smoke`
- **计划对象**：`after-skeleton / Phase 5 / deployment-dry-run-and-real-boundary-verification`
- **本次计划解决的问题**：
  - 仓库当前只有 node 侧 contract/E2E reality，还没有真正的 wrangler profile / deploy-shaped verification reality
  - external seams 虽已进入 P4 设计与 action-plan，但 fake workers、real bindings、L1/L2 smoke 还未形成一条可执行验证链
  - real provider / real storage / trace-preserving boundary 还没有统一 verdict bundle 和 gate 语言
- **本次计划的直接产出**：
  - 一套 owner-aligned verification ladder：`L0 in-process / L1 dev --remote / L2 deploy + smoke`
  - 一套 deploy-shaped wrangler profile、fake worker fixture、smoke runner、latency baseline 与 failure record
  - 一份可审阅的 `green / yellow / red` verdict bundle 与 Phase 5 gate pack

---

## 1. 执行综述

### 1.1 总体执行方式

这份 action-plan 采用 **先冻结 gate 与 profile matrix，再补 wrangler/fake-worker 运行面，然后完成 L1 deploy-shaped smoke，最后执行 L2 real-boundary smoke 并产出 verdict bundle** 的推进方式。核心原则是：**Phase 5 不创造新的 runtime 设计，而是验证 P3/P4 已经收口的 runtime truth；L1 用 `wrangler dev --remote` 建快速反馈，L2 用 `wrangler deploy + workers.dev smoke` 建 production-shaped 证据；real provider 只走 `gpt-4.1-nano` 一条最小 golden path。**

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Gate Preconditions & Profile Matrix Freeze | `M` | 冻结 L0/L1/L2 进入条件、wrangler profile、verdict 阈值与 smoke matrix | `Phase 3 / Phase 4` |
| Phase 2 | Deploy-Shaped Runtime Surface Assembly | `L` | 把 wrangler bindings、fake workers、smoke runner、bundle 输出面接成真实 deploy-shaped 运行面 | `Phase 1` |
| Phase 3 | L1 Session / External Seam Dry-Run Closure | `L` | 在 `wrangler dev --remote` 下验证 session edge 与 external seams 的主链 smoke | `Phase 2` |
| Phase 4 | L2 Real Boundary Smoke & Latency Baseline | `M` | 在 `wrangler deploy + workers.dev smoke` 下跑真实 provider / real binding 的最小 golden path | `Phase 3` |
| Phase 5 | Verdict Bundle & Gate Handoff | `S` | 输出 green/yellow/red verdict、failure record、handoff pack，并为 P6 提供真实证据上游 | `Phase 4` |

### 1.3 Phase 说明

1. **Phase 1 — Gate Preconditions & Profile Matrix Freeze**
   - **核心目标**：把 Phase 5 先定义成一套清晰的验证规则，而不是“到时候看着跑”。
   - **为什么先做**：没有 gate/profile matrix，后面的 wrangler/fake-worker/smoke case 很快会各自长出一套验证语言。
2. **Phase 2 — Deploy-Shaped Runtime Surface Assembly**
   - **核心目标**：把当前只有 `SESSION_DO` 的 wrangler skeleton，扩成能真实承载 fake workers、R2/KV、trace sink、bundle 输出的运行面。
   - **为什么放在这里**：L1/L2 还没开始前，必须先有能运行 smoke 的真实外形。
3. **Phase 3 — L1 Session / External Seam Dry-Run Closure**
   - **核心目标**：先在 `wrangler dev --remote` 下证明 deploy-shaped reality 已成立。
   - **为什么放在这里**：L1 是最低成本的真实边界验证层，能最快暴露 worker/DO/WS/service-binding 的接线断点。
4. **Phase 4 — L2 Real Boundary Smoke & Latency Baseline**
   - **核心目标**：用最小真实 provider 与真实 binding 路径，证明 P4 不是“纯 fake world 收口”。
   - **为什么放在这里**：L2 必须建立在 L1 已能稳定运行的前提上，否则只会把调试成本抬到最高层。
5. **Phase 5 — Verdict Bundle & Gate Handoff**
   - **核心目标**：把 L0/L1/L2 的结果收束成可审阅的阶段 verdict，并为 P6 evidence closure 提供上游真实运行证据。
   - **为什么放在这里**：Phase 5 的价值不在于“跑过一次”，而在于留下能被后续 phase 消费的 gate evidence。

### 1.4 执行策略说明

- **执行顺序原则**：`先 gate/profile，再 wrangler/fake-worker surface，再 L1，再 L2，再 verdict bundle`
- **风险控制原则**：`P5 只做 verification gate；L1 默认 dev --remote，L2 必须 deploy + smoke；real provider 只走 gpt-4.1-nano`
- **测试推进原则**：`先保留 L0 contract/E2E 绿线，再补 L1 smoke runner，最后加 L2 real-boundary case 与 latency baseline`
- **文档同步原则**：`P4/P5/P6 设计、PX-QNA、wrangler profile 说明、smoke runner 文档与 verdict 规则必须同口径`

### 1.5 本次 action-plan 影响目录树

```text
deployment-dry-run-and-real-boundary-verification
├── packages/session-do-runtime
│   ├── wrangler.jsonc
│   ├── src/{worker,env,composition,ws-controller,http-controller}.ts
│   └── test/{worker,routes,ws-controller,http-controller}.test.ts
├── packages/hooks
│   └── test/integration/{service-binding-timeout,session-resume-hooks}.test.ts
├── packages/capability-runtime
│   └── test/integration/{service-binding-transport,service-binding-progress}.test.ts
├── packages/llm-wrapper
│   ├── src/{executor,gateway,session-stream-adapter}.ts
│   └── test/integration/{local-fetch-stream,retry-timeout}.test.ts
├── test
│   ├── e2e/{e2e-05,e2e-06,e2e-09,e2e-11,e2e-13,e2e-14}*.test.mjs
│   ├── e2e/fixtures/*.mjs
│   └── verification/{profiles,smokes,verdict-bundles}/**/*
└── docs
    ├── action-plan/after-skeleton/A6-deployment-dry-run-and-real-boundary-verification.md
    └── design/after-skeleton/P5-deployment-dry-run-and-real-boundary-verification.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 冻结 `L0 in-process / L1 deploy-shaped dry-run / L2 real-boundary smoke` 三层验证阶梯与进入条件
- **[S2]** 补齐 wrangler profile、fake hook/capability/provider worker fixtures、trace/timeline/placement/verdict bundle 输出面
- **[S3]** 在 `wrangler dev --remote` 下验证 session edge 与 external seams 的最小 deploy-shaped 主链
- **[S4]** 在 `wrangler deploy + workers.dev smoke` 下验证至少一条真实 Cloudflare binding 路径与一条 `gpt-4.1-nano` real provider path
- **[S5]** 记录 hot-path latency baseline、failure / timeout record，并输出 green/yellow/red verdict

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 正式 CI/CD pipeline、release automation、dashboard
- **[O2]** full production rollout、多区域、多 provider smoke matrix
- **[O3]** capacity benchmark、压测、SLO/SLA 平台
- **[O4]** browser rendering、skill worker、更多 remote worker zoo 的真实 smoke

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `wrangler dev --remote` | `in-scope` | Q11 已冻结它是 L1 默认模式，负责快速 deploy-shaped 反馈 | 仅在 owner 环境无法提供 remote dev 时重评 fallback |
| `wrangler deploy + workers.dev smoke` | `in-scope` | Q11 已冻结它是 L2 必选模式，负责真实 production-shaped smoke | P5 后续可扩 staging/canary profile |
| `gpt-4.1-nano` real smoke | `in-scope` | Q12 已冻结为唯一最小 golden path，与现有 OpenAI-compatible adapter 直接对齐 | P8+ 扩 provider matrix 时重评 |
| node `test/e2e` | `in-scope` | 它仍是 L0 的 contract/harness 基线，但不等于 deploy reality | 长期保留，不作为 P5 终点 |
| full prod launch readiness | `out-of-scope` | Q10 已把 P5 定位成 gate，而不是上线 phase | 未来 release phase 独立设计 |
| multi-provider real smoke | `out-of-scope` | 第一轮只需要证明关键边界成立，不做矩阵爆炸 | golden path 稳定后再重评 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | Verification Ladder Freeze | `update` | `docs/design/after-skeleton/P5-*.md`, `PX-QNA.md`, new verification notes | 固定 L0/L1/L2、green/yellow/red、进入条件与 owner-local assumptions | `high` |
| P1-02 | Phase 1 | Profile & Binding Matrix Freeze | `update` | `packages/session-do-runtime/wrangler.jsonc`, env docs | 冻结 `remote-dev` / `deploy-smoke` 两套 binding manifest 与所需 secrets/bindings | `high` |
| P1-03 | Phase 1 | Smoke Matrix Inventory | `update` | `test/e2e/**`, new verification docs | 把已有 E2E 资产映射成 L0/L1/L2 smoke matrix，而不是重新命名一套世界 | `medium` |
| P2-01 | Phase 2 | Wrangler Surface Expansion | `update` | `packages/session-do-runtime/wrangler.jsonc`, `src/{env,composition,worker}.ts` | 从单 `SESSION_DO` skeleton 升级为 deploy-shaped binding surface | `high` |
| P2-02 | Phase 2 | Fake Worker Fixture Pack | `add` | `test/verification/**`, `test/e2e/fixtures/**` | 提供 fake hook/capability/provider worker 的真实 worker 边界实现 | `high` |
| P2-03 | Phase 2 | Verdict Bundle Output | `add` | `test/verification/{profiles,smokes,verdict-bundles}/**/*` | 每次 L1/L2 都能稳定产出 trace/timeline/placement/summary 证据包 | `high` |
| P3-01 | Phase 3 | Session Edge Dry-Run | `update` | `packages/session-do-runtime/**`, session smoke cases | 在 L1 下验证 WS start/ack/replay/resume/HTTP fallback/cancel/checkpoint | `high` |
| P3-02 | Phase 3 | External Seam Dry-Run | `update` | hooks/capability/llm/session integration surfaces | 在 L1 下验证 remote hook/capability/fake provider 主链 | `high` |
| P3-03 | Phase 3 | L1 Failure Recording | `update` | verification runners, docs | 把 controller stub、binding miswire、startup queue、timeout 变成显式 failure record | `medium` |
| P4-01 | Phase 4 | Real Provider Golden Path | `update` | `packages/llm-wrapper/**`, verification runner | 用 `gpt-4.1-nano` 跑一条真实 OpenAI-compatible smoke | `high` |
| P4-02 | Phase 4 | Real Cloud Binding Spot-check | `update` | wrangler profile, storage/eval/session surfaces | 至少验证一条真实 R2/KV/DO binding path | `high` |
| P4-03 | Phase 4 | Hot-path Latency Baseline | `add` | verification bundle, docs | 记录 WS→DO→provider→stream 的最小 latency baseline | `medium` |
| P5-01 | Phase 5 | Gate Verdict & Blocking List | `update` | verdict docs, reports | 输出 green/yellow/red 与 blocking drift 列表 | `medium` |
| P5-02 | Phase 5 | P6 Handoff Evidence Pack | `update` | docs + bundle manifests | 把 Phase 5 真实运行证据交给 P6 storage/context evidence phase | `medium` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Gate Preconditions & Profile Matrix Freeze

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | Verification Ladder Freeze | 把 Q10/Q11/Q12 转成明确 gate 规则：L0=contract/E2E、L1=`wrangler dev --remote`、L2=`wrangler deploy + workers.dev smoke`、provider=`gpt-4.1-nano` | P5 docs, verification notes | Phase 5 不再是模糊 smoke 行为集合 | docs review | 所有人对 L1/L2/profile/golden path 的说法一致 |
| P1-02 | Profile & Binding Matrix Freeze | 列清 remote-dev / deploy-smoke 需要的 Worker、DO、R2、KV、fake workers、secrets、trace sink bindings | `wrangler.jsonc`, env docs | smoke profile 不再靠口头猜测 | config review | 存在一份可执行 binding manifest matrix |
| P1-03 | Smoke Matrix Inventory | 将 `test/e2e/e2e-05/06/09/11/13/14` 等现有场景映射到 L0/L1/L2，保留哪些复用、哪些需要 deploy-shaped 重写 | root `test/e2e/**` | 现有资产被系统吸收，而非被遗忘 | test inventory review | L0/L1/L2 的场景矩阵完整可审阅 |

### 4.2 Phase 2 — Deploy-Shaped Runtime Surface Assembly

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | Wrangler Surface Expansion | 扩展当前只有 `SESSION_DO` 的 wrangler skeleton，引入 fake worker / R2 / KV / trace sink 所需 binding slots 与 profile 说明 | `packages/session-do-runtime/wrangler.jsonc`, `src/{env,composition,worker}.ts` | deploy-shaped runtime surface 真正可启动 | config + build review | 不再只有单 DO skeleton |
| P2-02 | Fake Worker Fixture Pack | 新建可被 wrangler/service-binding 真正调用的 fake hook/capability/provider worker fixtures | `test/verification/**`, `test/e2e/fixtures/**` | L1/L2 不必回退成内存函数调用 | targeted smoke tests | fake workers 通过真实边界被调用 |
| P2-03 | Verdict Bundle Output | 为 smoke runner 统一输出 trace、timeline、placement、summary、failure record | `test/verification/{profiles,smokes,verdict-bundles}/**/*` | P5 结果不再只剩 stdout 或 grep | runner tests | 每次运行都生成 bundle skeleton |

### 4.3 Phase 3 — L1 Session / External Seam Dry-Run Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | Session Edge Dry-Run | 在 `wrangler dev --remote` 下验证 WS upgrade、`session.start`、`session.stream.ack`、resume/replay、HTTP fallback、cancel、checkpoint/restore | `packages/session-do-runtime/**`, session smoke cases | session edge 不再只在 vitest / node E2E 里成立 | L1 smoke | 至少一条 session 主链在真实 Worker/DO 边界跑通 |
| P3-02 | External Seam Dry-Run | 在 L1 下验证 remote hook / capability / fake provider path，保留 trace/tenant propagation | hooks/capability/llm/session smoke surfaces | external seams 不再只是接口级存在 | L1 smoke | 每条主 seam 都能完成一次真实跨 worker smoke |
| P3-03 | L1 Failure Recording | 对 binding miswire、controller stub 残留、startup queue、timeout、retry 记录失败点位与复现条件 | runners + docs | L1 失败能定位，不会变成“再跑一次看看” | failure path review | 每类失败都有明确 record 与 owner |

### 4.4 Phase 4 — L2 Real Boundary Smoke & Latency Baseline

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | Real Provider Golden Path | 通过 `OpenAI-compatible + gpt-4.1-nano` 跑一条最小真实 provider smoke，并保留 stream normalization/session stream truth | `packages/llm-wrapper/**`, runner docs | real provider smoke 与 fake provider mirror 属于同一 contract 世界 | L2 smoke | 至少一条真实 provider trace-preserving path 成立 |
| P4-02 | Real Cloud Binding Spot-check | 至少验证一条真实 R2/KV/DO binding 路径，并确保 storage/eval/session evidence 未断 | wrangler profile, storage/session/eval surfaces | Phase 4 不再只是 fake world 闭环 | L2 smoke | 至少一次真实 cloud binding integration 成立 |
| P4-03 | Hot-path Latency Baseline | 记录 `client → WS → DO → provider → stream` 的最小延迟与 timeout/failure 记录 | verification bundle | 后续阶段不再完全没有 deploy-shaped 性能认知 | bundle review | latency baseline 与 failure record 均已归档 |

### 4.5 Phase 5 — Verdict Bundle & Gate Handoff

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | Gate Verdict & Blocking List | 基于 L0/L1/L2 结果输出 `green / yellow / red` verdict 与 blocking drift 列表 | verdict docs, reports | Phase 5 形成真正的 gate，而不是一次 demo | review | owner/reviewer 能直接据此判断是否进入下一阶段 |
| P5-02 | P6 Handoff Evidence Pack | 将 trace/timeline/placement/summary/failure/latency 输出成 P6 可消费的真实证据输入 | docs + bundle manifests | Phase 6 有真实运行证据，而不是继续靠 synthetic evidence 启动 | handoff review | P6 可直接消费 Phase 5 的 bundle 作为上游输入 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Gate Preconditions & Profile Matrix Freeze

- **Phase 目标**：先把验证规则冻结，避免 P5 在执行时变成自由发挥。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 新增文件**：
  - 视需要新增 `test/verification/profiles/*.md|*.json`
  - 视需要新增 verification matrix note
- **本 Phase 修改文件**：
  - `docs/design/after-skeleton/P5-deployment-dry-run-and-real-boundary-verification.md`
  - `packages/session-do-runtime/wrangler.jsonc`
  - 相关 env/profile docs
- **具体功能预期**：
  1. L0/L1/L2 的职责边界明确，且不互相替代
  2. Q11 hybrid 方案被写成可执行 matrix，而不再只是问答结论
  3. Q12 的 `gpt-4.1-nano` golden path 成为唯一最小真实 provider baseline
- **具体测试安排**：
  - **单测**：N/A，以 docs/config 校验为主
  - **集成测试**：N/A
  - **回归测试**：核对现有 package scripts 与 root `test:cross`
  - **手动验证**：逐项核对 profile/binding/secrets/mode 与 PX-QNA 一致
- **收口标准**：
  - P5 gate rules 已固定为单一 truth
  - 存在可审阅的 binding/profile matrix
  - 现有 E2E 资产已映射到验证阶梯中
- **本 Phase 风险提醒**：
  - 如果不先冻结 matrix，后续 smoke case 会持续漂移
  - 如果把 L1/L2 角色混用，最终 verdict 会失真

### 5.2 Phase 2 — Deploy-Shaped Runtime Surface Assembly

- **Phase 目标**：让 P5 拥有能真正跑 smoke 的 Worker-native 外形。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - `test/verification/**` 下的 fake worker fixtures / smoke runner / bundle writer
- **本 Phase 修改文件**：
  - `packages/session-do-runtime/wrangler.jsonc`
  - `packages/session-do-runtime/src/{env,composition,worker}.ts`
  - 视需要补 session runtime env/profile docs
- **具体功能预期**：
  1. 仓库不再只有 `SESSION_DO` 单 binding skeleton
  2. fake hook/capability/provider workers 能通过真实 worker/service-binding 被调用
  3. smoke runner 可以输出 trace/timeline/placement/summary bundle
- **具体测试安排**：
  - **单测**：配置/runner/unit-level tests
  - **集成测试**：targeted fake worker integration tests
  - **回归测试**：受影响 package 的 `build / typecheck / test`
  - **手动验证**：确认不存在“fake worker 只是内存函数调用”的倒退
- **收口标准**：
  - deploy-shaped runtime surface 已可启动
  - fake workers 已具备真实边界形态
  - bundle skeleton 已可稳定生成
- **本 Phase 风险提醒**：
  - 如果 profile 只是文档不落运行面，P5 仍是假闭环
  - 如果 bundle 只靠日志 grep，后续审阅无法成立

### 5.3 Phase 3 — L1 Session / External Seam Dry-Run Closure

- **Phase 目标**：用最小成本先证明 deploy-shaped reality 已成立。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
- **本 Phase 新增文件**：
  - 视需要新增 L1 smoke manifests / scripts
- **本 Phase 修改文件**：
  - `packages/session-do-runtime/**`
  - hooks/capability/llm/session integration-related surfaces
  - `test/e2e/**` 与 `test/verification/**`
- **具体功能预期**：
  1. WS start/ack/replay/resume/HTTP fallback/cancel/checkpoint 至少一条主链真实跑通
  2. remote hook/capability/fake provider 都有 deploy-shaped smoke
  3. startup queue、binding miswire、controller stub 残留都能被显式记录
- **具体测试安排**：
  - **单测**：保留现有 `session-do-runtime`、hooks、capability、llm-wrapper tests
  - **集成测试**：现有包级 integration + 新增 L1 smoke runner
  - **回归测试**：`pnpm --filter @nano-agent/session-do-runtime test`、hooks/capability/llm relevant tests、`npm run test:cross`
  - **手动验证**：实际跑 `wrangler dev --remote`，确认 trace/timeline/bundle 成立
- **收口标准**：
  - 至少一条 session edge 主链在 L1 跑通
  - 至少一条 external seam 主链在 L1 跑通
  - L1 的失败都能落成结构化记录
- **本 Phase 风险提醒**：
  - `WsController` / `HttpController` 若仍残留 stub，会直接阻塞 L1
  - 如果 external seams 在 L1 silently downgrade，P5 结论将被高估

### 5.4 Phase 4 — L2 Real Boundary Smoke & Latency Baseline

- **Phase 目标**：证明 deploy-shaped 验证不是纯 fake world 演练。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
  - `P4-03`
- **本 Phase 新增文件**：
  - 视需要新增 real-smoke runner / latency record schema
- **本 Phase 修改文件**：
  - `packages/llm-wrapper/**`
  - wrangler deploy-smoke profile
  - verification bundle/report docs
- **具体功能预期**：
  1. `gpt-4.1-nano` real smoke 与当前 OpenAI-compatible adapter 直接对齐
  2. 至少一条真实 R2/KV/DO binding path 成立
  3. latency baseline 与 timeout/failure record 被正式记录
- **具体测试安排**：
  - **单测**：保留受影响 package tests
  - **集成测试**：real-smoke specific runner validations
  - **回归测试**：相关 package `build / typecheck / test`
  - **手动验证**：`wrangler deploy + workers.dev smoke` 实跑，并归档 bundle
- **收口标准**：
  - 至少一次真实 provider trace-preserving smoke 成立
  - 至少一次真实 cloud binding integration 成立
  - latency baseline 已记录且能被后续文档引用
- **本 Phase 风险提醒**：
  - real smoke 范围一旦膨胀，会拖垮调试效率
  - 若 provider 与 fake provider 走两套 schema，L2 结果将无法回到 P4 contract

### 5.5 Phase 5 — Verdict Bundle & Gate Handoff

- **Phase 目标**：让 Phase 5 真正产出可审阅的阶段 verdict。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 新增文件**：
  - 视需要新增 verdict summary / handoff manifest
- **本 Phase 修改文件**：
  - `docs/action-plan/after-skeleton/A6-deployment-dry-run-and-real-boundary-verification.md`
  - 相关 verification / bundle docs
- **具体功能预期**：
  1. `green / yellow / red` 阈值被真正执行，而不是留在设计文稿里
  2. blocking drift 有明确 owner 与重试策略
  3. P6 可以直接消费 P5 的真实运行证据
- **具体测试安排**：
  - **单测**：N/A，以 bundle/verdict review 为主
  - **集成测试**：N/A
  - **回归测试**：汇总 L0/L1/L2 结果
  - **手动验证**：review verdict bundle 是否足以解释 gate 结论
- **收口标准**：
  - owner/reviewer 可基于 bundle 做 gate judgement
  - P6 handoff evidence pack 已完整
  - Phase 5 不再是一次不可复审的 smoke 现场
- **本 Phase 风险提醒**：
  - 如果没有 blocking list，yellow/red verdict 仍会失去执行价值
  - 如果 handoff 不成体系，P6 又会被迫回到 synthetic evidence

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 当前判断

- 当前 **无新增必须拍板的问题**。
- 本 action-plan 直接继承以下已确认答案：
  1. **Q10**：Phase 5 是 verification gate；
  2. **Q11**：L1 默认 `wrangler dev --remote`，L2 必须 `wrangler deploy + workers.dev smoke`；
  3. **Q12**：`gpt-4.1-nano` 为 v1 唯一最小 golden path。
- 执行中若要回到 owner 层，只应针对 **是否扩大 real smoke 范围** 或 **是否改变 hybrid verification 策略** 这类边界问题，而不是具体脚本实现细节。

### 6.2 问题整理建议

- 不把 fake worker 的目录布局升级成 owner 问题
- 不把 smoke runner 的内部脚本命名升级成 owner 问题
- 只把会改变 Q10/Q11/Q12 结论的事项带回给业主

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| 只有一份 wrangler skeleton | 仓内目前只有 `packages/session-do-runtime/wrangler.jsonc`，且只绑定 `SESSION_DO` | `high` | Phase 2 先补 binding/profile matrix，再谈 smoke |
| controller 仍是 stub | `WsController` / `HttpController` 目前还不是 deploy-ready reality | `high` | 只有 P3/P4 先完成最小 closure，P5 才能进入 L1/L2 |
| fake worker fixtures 尚不存在 | 仓内尚无现成 fake hook/capability/provider worker fixture tree | `high` | Phase 2 明确新增 fixture pack |
| provider 路径双轨漂移 | fake provider 与 real provider 若走两套 schema，会破坏 gate 解释力 | `high` | 强制 L2 只走 OpenAI-compatible + `gpt-4.1-nano` |
| deploy smoke 成本过高 | 若过早做多 provider / 多 binding / 多 region，会拖垮反馈循环 | `medium` | 严格保留单 golden path + 单最小 cloud binding spot-check |

### 7.2 约束与前提

- **技术前提**：`P3 session edge 与 P4 external seam 至少具备最小 closure；Phase 5 不重开 runtime 设计`
- **运行时前提**：`wrangler dev --remote` 与 `wrangler deploy + workers.dev smoke` 是两层不同验证 rung，不得互相伪装`
- **组织协作前提**：`owner-local secrets / Wrangler 登录态` 可以手动注入，但必须被 profile 说明明确记录
- **上线 / 合并前提**：Phase 5 的结论必须附带 verdict bundle，而不是单次 smoke 口头结论

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/after-skeleton/P5-deployment-dry-run-and-real-boundary-verification.md`
  - `docs/design/after-skeleton/P4-external-seam-closure.md`
  - `docs/design/after-skeleton/P6-storage-and-context-evidence-closure.md`
  - `docs/design/after-skeleton/PX-QNA.md`
- 需要同步更新的说明文档 / README：
  - wrangler profile / verification ladder / real-smoke notes
- 需要同步更新的测试说明：
  - root `test/e2e/**`
  - 相关 packages 的 integration tests
  - `npm run test:cross`

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - 确认仓库已有的 L0 E2E 资产被正确映射到 verification ladder
  - 确认 L1/L2 profile、bindings、secrets、provider decision 与 PX-QNA 一致
- **单元测试**：
  - `pnpm --filter @nano-agent/session-do-runtime test`
  - `pnpm --filter @nano-agent/hooks test`
  - `pnpm --filter @nano-agent/capability-runtime test`
  - `pnpm --filter @nano-agent/llm-wrapper test`
- **集成测试**：
  - hooks/capability/llm/session 既有 integration tests
  - root `test/e2e/e2e-05-session-resume.test.mjs`
  - root `test/e2e/e2e-06-cancel-midturn.test.mjs`
  - root `test/e2e/e2e-09-observability-pipeline.test.mjs`
  - root `test/e2e/e2e-11-ws-replay-http-fallback.test.mjs`
  - root `test/e2e/e2e-13-content-replacement-consistency.test.mjs`
  - root `test/e2e/e2e-14-hooks-resume.test.mjs`
- **端到端 / 手动验证**：
  - L1：`wrangler dev --remote`
  - L2：`wrangler deploy + workers.dev smoke`
  - 每次运行都归档 trace / timeline / placement / summary / failure record
- **回归测试**：
  - `npm run test:cross`
  - 相关 packages `typecheck / build / test`
- **文档校验**：
  - P5 design、action-plan、wrangler profile docs、verdict rules、P6 handoff notes 必须口径一致

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. verification ladder 已明确分层，且 L0/L1/L2 都有单一 truth。
2. 至少一条 session edge 主链在 deploy-shaped Worker/DO 边界跑通。
3. 至少一条 external seam 主链在 deploy-shaped worker/service-binding 边界跑通。
4. 至少一次 `gpt-4.1-nano` real smoke 与至少一次真实 cloud binding spot-check 成立。
5. 每次关键验证都能留下可审阅的 verdict bundle。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `verification ladder + wrangler profiles + fake worker fixtures + L1 smoke + L2 smoke + verdict bundle` 全部落地 |
| 测试 | L0/L1/L2 共同构成最小验证闭环，且相关 package/root tests 保持可运行 |
| 文档 | P5 design、action-plan、profile docs、bundle/verdict 说明与 PX-QNA 口径一致 |
| 风险收敛 | 不再把 node harness 误当 deploy reality；不再把 fake smoke 误当 real-boundary conclusion |
| 可交付性 | Phase 6 可直接以 Phase 5 bundle 为上游真实证据输入 |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待回填`
- **哪些编号的拆分还不够合理**：`待回填`
- **哪些问题本应更早问架构师**：`待回填`
- **哪些测试安排在实际执行中证明不够**：`待回填`
- **模板本身还需要补什么字段**：`待回填`

---

## 10. 结语

这份 action-plan 以 **把 nano-agent 从“node 里看起来能跑”推进到“Worker/DO/service-binding 边界上被真实见证过”** 为第一优先级，采用 **先冻结 gate/profile，再补 deploy-shaped 运行面，再完成 L1/L2 smoke，最后以 verdict bundle 收口** 的推进方式，优先解决 **wrangler profile 缺失、fake worker fixture 缺失、real provider/binding 还没有最小可信 smoke** 这三类问题，并把 **Phase 5 只做 gate、不重开 runtime 设计、real provider 只走 `gpt-4.1-nano`、L1/L2 必须分层表达** 作为主要约束。整个计划完成后，`Deployment Verification / Boundary Smoke` 应达到 **任何 after-skeleton closure 都不再只靠 test double 自证，而是有 deploy-shaped 与 real-boundary 两级证据支撑** 的状态，从而为后续的 **storage/context evidence、minimal bash、以及更深的 API / data / frontend 演进** 提供可信上游。
