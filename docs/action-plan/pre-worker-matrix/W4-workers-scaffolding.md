# W4 — `workers/` Scaffolding & Cloudflare Deploy Validation

> 服务业务簇: `pre-worker-matrix / W4 / workers-scaffolding`
> 计划对象: `建立 4 个 worker shell，并完成 agent-core 1 real deploy + 3 dry-run`
> 类型: `new`
> 作者: `GPT-5.4`
> 时间: `2026-04-21`
> 文件位置: `docs/action-plan/pre-worker-matrix/W4-workers-scaffolding.md`
> 关联设计 / 调研文档:
> - `docs/plan-pre-worker-matrix.md`
> - `docs/design/pre-worker-matrix/W4-workers-scaffolding.md`
> - `docs/design/pre-worker-matrix/W2-publishing-pipeline.md`
> - `docs/design/pre-worker-matrix/W3-absorption-blueprint-and-dryrun.md`
> - `docs/action-plan/pre-worker-matrix/W5-closure-and-handoff.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

W4 的任务是把 owner 关于 `workers/` 顶级目录的决定变成物理事实，并用最小但真实的方式验证 Cloudflare deploy 链路。在 narrowed design 下，W4 不再要求 4 个真实 deploy，而是收敛成：**建立 4 个 deploy-shaped shell、agent-core 做 1 次真实 deploy，另外 3 个 worker 做 `wrangler deploy --dry-run`。**

因此，这份 action-plan 的重点不是业务实现，而是 **脚手架、目录一致性、import 解析、CI matrix 与 deploy validation**。W4 完成后，worker-matrix P0 不再需要重新造壳，只需要在既定目录里填入业务代码。

- **服务业务簇**：`pre-worker-matrix / W4`
- **计划对象**：`workers/ Scaffolding & Cloudflare Deploy Validation`
- **本次计划解决的问题**：
  - `workers/ 顶级目录还不存在`
  - `4 个 worker 还没有统一 shell 结构`
  - `Cloudflare + wrangler + NACP resolve 链路还没有最小验证`
- **本次计划的直接产出**：
  - `workers/ 目录 + 4 个 shell 项目`
  - `agent-core 1 real deploy + 3 workers dry-run`
  - `workers.yml matrix CI + W4 closure memo`

---

## 1. 执行综述

### 1.1 总体执行方式

采用 **先建统一 shell 结构，再接入 workspace/CI，最后做 deploy validation** 的方式推进。W4 不承载业务逻辑，也不承担 remote service binding 真联通；它只证明目录、构建、解析与 Cloudflare deploy 这条链路已经 ready。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | 目录与 shell 模板 | `M` | 建 `workers/*` 统一骨架 | `W2 skeleton ready` |
| Phase 2 | workspace 与 CI | `S` | 接 `pnpm-workspace.yaml`、matrix workflow、README | `Phase 1` |
| Phase 3 | deploy validation | `M` | agent-core 真实 deploy，其他 3 个 dry-run，并写 closure | `Phase 2` |

### 1.3 Phase 说明

1. **Phase 1 — 目录与 shell 模板**
   - **核心目标**：建立统一 worker shell 结构
   - **为什么先做**：没有统一壳，CI 与 deploy 验证都无从谈起
2. **Phase 2 — workspace 与 CI**
   - **核心目标**：把 `workers/*` 纳入 monorepo，并建立统一验证方式
   - **为什么放在这里**：先有文件结构，再有 workspace/CI 接入
3. **Phase 3 — deploy validation**
   - **核心目标**：完成 narrowed 版最小 deploy 证明
   - **为什么放在这里**：只有前两步稳定后，deploy 证据才有意义

### 1.4 执行策略说明

- **执行顺序原则**：`先 shell，后 CI，最后 deploy`
- **风险控制原则**：`只验证壳与链路，不提前塞业务逻辑`
- **测试推进原则**：`shell smoke + matrix CI + 1 real/3 dry-run`
- **文档同步原则**：`README / closure / W5 handoff 口径同步`

### 1.5 本次 action-plan 影响目录树

```text
W4 workers scaffolding
├── Phase 1: 目录与 shell 模板
│   ├── workers/agent-core/
│   ├── workers/bash-core/
│   ├── workers/context-core/
│   └── workers/filesystem-core/
├── Phase 2: workspace 与 CI
│   ├── pnpm-workspace.yaml
│   └── .github/workflows/workers.yml
└── Phase 3: deploy validation
    ├── wrangler deploy --env preview (agent-core)
    ├── wrangler deploy --dry-run (other 3)
    └── docs/issue/pre-worker-matrix/W4-closure.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 建 `workers/` 顶级目录与 4 个统一 shell 项目
- **[S2]** 更新 `pnpm-workspace.yaml`，建立 matrix CI 与最小 smoke tests
- **[S3]** 让 shell 支持 `workspace:*` 或 published dual-path 的 NACP resolve
- **[S4]** 完成 `agent-core` 1 real deploy、其他 3 workers dry-run、并写 W4 closure

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 吸收任何 Tier B 业务代码到 workers（W3 optional dry-run 例外，不属 W4）
- **[O2]** 打通真实 service binding 对端
- **[O3]** 创建真实 DO/KV/R2/D1 资源与生产 secrets 体系
- **[O4]** 把 4 个 worker 都做成真实业务 deploy

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| 4 个 shell 项目 | `in-scope` | W4 的核心交付 | `W4 执行期` |
| agent-core 真实 deploy | `in-scope` | narrowed design 要求 1 次 real deploy | `Phase 3` |
| 其他 3 个真实 deploy | `out-of-scope` | narrowed design 只要求 dry-run | `worker-matrix 后续` |
| dual-path install reality | `in-scope` | W2/W4/W5 一致性必须靠它 | `Phase 2/3` |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | `workers/` 顶级目录 | `add` | `workers/*` | 建立 4 个 shell 容器 | `low` |
| P1-02 | Phase 1 | 每个 worker 的 shell 文件 | `add` | `wrangler.jsonc package.json src test README tsconfig` | 冻结统一结构 | `medium` |
| P1-03 | Phase 1 | `agent-core` DO slot | `add` | `workers/agent-core/src/nano-session-do.ts` `workers/agent-core/src/index.ts` `workers/agent-core/wrangler.jsonc` | 给唯一 real deploy worker 预留 Durable Object slot | `high` |
| P2-01 | Phase 2 | workspace 接入 | `update` | `pnpm-workspace.yaml` | 让 workers 与 packages 共存 | `medium` |
| P2-02 | Phase 2 | matrix CI | `add` | `.github/workflows/workers.yml` | 统一 build/test 验证 | `medium` |
| P2-03 | Phase 2 | dual-path 依赖说明 | `update` | package/README/closure notes | published / workspace:* 均可解析 | `medium` |
| P3-01 | Phase 3 | agent-core real deploy / fallback | `update` | `workers/agent-core` | 完成最小真实 Cloudflare 验证，或记录 deployable fallback | `high` |
| P3-02 | Phase 3 | bash/context/filesystem dry-run | `update` | 其余 3 workers | 证明 3 个 shell 均 deploy-shaped | `medium` |
| P3-03 | Phase 3 | W4 closure | `add` | `docs/issue/pre-worker-matrix/W4-closure.md` | 为 W5 提供 deploy evidence | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — 目录与 shell 模板

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | `workers/` 顶级目录 | 建 4 个 worker 目录 | `workers/*` | worker 顶级空间成为物理事实 | 目录检查 | 4 目录齐全 |
| P1-02 | shell 文件 | 每个 worker 补 `wrangler.jsonc/package.json/src/test/README` | 各 worker | deploy-shaped shell 统一 | build/test smoke | 结构同构 |
| P1-03 | `agent-core` DO slot | 单独补 `NanoSessionDO` stub export、`durable_objects.bindings` 与 `migrations` block | `workers/agent-core/*` | 唯一 real deploy worker 具备 DO 形态 | build/test smoke | 不会因缺 DO class 导致 deploy 失败 |

### 4.2 Phase 2 — workspace 与 CI

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | workspace 接入 | 把 `workers/*` 纳入 `pnpm-workspace.yaml` | repo root | workers 可被统一构建 | pnpm filter build/test | 不影响 packages/* |
| P2-02 | matrix CI | 建 `workers.yml` 跑 4 worker build/test | `.github/workflows/workers.yml` | 统一验证路径成立 | workflow run | 4 workers green |
| P2-03 | dual-path 依赖说明 | 允许 `workspace:*` 或 published version | worker package.json / docs | 安装路径不被 W2 首发阻塞 | build/install | closure 可说明当前路径 |

### 4.3 Phase 3 — deploy validation

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | agent-core real deploy / fallback | 若凭据可用则真实 deploy 到 preview/workers.dev；否则至少 dry-run 并在 closure 记为 shell-deployable pending credentials | `workers/agent-core` | 至少 1 个 live URL，或 deployable fallback 状态明确 | wrangler deploy + curl / wrangler dry-run | live JSON 可访问，或 fallback 证据完整 |
| P3-02 | 3 workers dry-run | `wrangler deploy --dry-run` | bash/context/filesystem | 其余 3 个 shell 可 bundle/deploy-shaped | wrangler dry-run | 日志可归档 |
| P3-03 | W4 closure | 写 deploy evidence 与 dual-path reality | `docs/issue/pre-worker-matrix/W4-closure.md` | W5 可直接引用 | 文档 review | evidence 完整 |

---

## 5. Phase 详情

### 5.1 Phase 1 — 目录与 shell 模板

- **Phase 目标**：建立 4 个统一的 worker shell
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 新增文件**：
  - `workers/agent-core/*`
  - `workers/bash-core/*`
  - `workers/context-core/*`
  - `workers/filesystem-core/*`
  - `workers/agent-core/src/nano-session-do.ts`
- **本 Phase 修改文件**：
  - `无`
- **具体功能预期**：
  1. 4 个 worker 都有 deploy-shaped 最小结构
  2. 结构保持完全同构
  3. `agent-core` 作为 host worker 会额外预留 DO slot，与另外 3 个 plain fetch shell 拉开边界
- **具体测试安排**：
  - **单测**：`各 worker smoke test`
  - **集成测试**：`build shell`
  - **回归测试**：`pnpm --filter './workers/*' build/test`
  - **手动验证**：`核对目录与命名`
- **收口标准**：
  - 4 个 shell 结构完整
  - `wrangler.jsonc` / package 命名与 design 一致
- **本 Phase 风险提醒**：
  - 最容易把不同 worker 写成不同目录风格，破坏后续 absorb pattern
  - 最容易漏掉 `agent-core` 的 DO slot，直接把 W4 唯一 real deploy 点写残

### 5.2 Phase 2 — workspace 与 CI

- **Phase 目标**：让 4 个 shell 成为真正可统一验证的 monorepo 成员
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - `.github/workflows/workers.yml`
- **本 Phase 修改文件**：
  - `pnpm-workspace.yaml`
  - `workers/*/package.json`
  - `workers/*/README.md`
- **具体功能预期**：
  1. workers 与 packages 并存
  2. CI 统一跑 4 个 shell
  3. dual-path install reality 可被 closure 描述
- **具体测试安排**：
  - **单测**：`shell smoke`
  - **集成测试**：`matrix build/test`
  - **回归测试**：`不破坏 packages/*`
  - **手动验证**：`核对 workspace:* / published 依赖说明`
- **收口标准**：
  - matrix workflow 可运行
  - dual-path 口径明确
- **本 Phase 风险提醒**：
  - 容易不小心把 W4 重新绑定到 W2 首发完成

### 5.3 Phase 3 — deploy validation

- **Phase 目标**：完成 narrowed 版最小 deploy 证明
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
- **本 Phase 新增文件**：
  - `docs/issue/pre-worker-matrix/W4-closure.md`
- **本 Phase 修改文件**：
  - `workers/*`（按 deploy 反馈微调）
- **具体功能预期**：
  1. 若 owner 提供凭据，`agent-core` 至少有 1 个 live URL
  2. 若凭据不可用，`agent-core` 也至少达到 shell-deployable + dry-run 成功的 fallback 状态
  3. 其余 3 workers 至少 dry-run 成功
  4. evidence 能被 W5 与 future charter 使用
- **具体测试安排**：
  - **单测**：`shell smoke`
  - **集成测试**：`wrangler deploy --dry-run`
  - **回归测试**：`pnpm --filter './workers/*' build/test`
  - **手动验证**：`curl agent-core preview URL`
- **收口标准**：
  - `agent-core` 达成 real deploy，或 fallback 为 shell-deployable pending credentials
  - 其余 3 workers dry-run 达成
  - W4 closure 记录 dual-path install reality
- **本 Phase 风险提醒**：
  - owner-side Cloudflare account / token 是外部 gate

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1

- **影响范围**：`Phase 3`
- **为什么必须确认**：`agent-core real deploy 需要 Cloudflare account / token / preview 策略`
- **当前建议 / 倾向**：`使用 preview env 完成 1 次真实 deploy；若凭据不可用则按 shell-deployable fallback closure`
- **Q**：`owner 是否提供 W4 阶段 agent-core preview deploy 所需的 Cloudflare 账户与凭据？`
- **A**：`若能及时提供，则按 preview env 完成 1 次真实 deploy；若不能及时提供，W4 允许按 "agent-core shell deployable, pending owner credentials" 的 fallback 路径 closure。`

#### Q2

- **影响范围**：`Phase 2 / Phase 3`
- **为什么必须确认**：`决定 W4 当前依赖走 workspace:* 还是已发布版本`
- **当前建议 / 倾向**：`优先允许 workspace:*，不阻塞 W4`
- **Q**：`若 W2 首发尚未完成，owner 是否接受 W4 全程使用 workspace:* 作为 interim path？`
- **A**：`是。W4 默认接受全程使用 workspace:* 作为 interim path；published cutover 推迟到 worker-matrix 阶段决定。`

### 6.2 问题整理建议

- 只问影响 deploy 与依赖解析路径的问题
- 不在 W4 提前决策 worker-matrix P0 的 binding 真联通

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| Cloudflare 凭据 | W4 real deploy 受 owner 环境约束 | `high` | 先完成 shell/CI，最后再做 real deploy |
| dual-path 漂移 | W2/W4/W5 口径不一致会误导后续 cutover | `medium` | closure 必写当前解析路径 |
| shell 结构不统一 | 会直接增加 worker-matrix P0 吸收成本 | `high` | Phase 1 统一模板化 |
| `agent-core` DO slot 漏声明 | 会让唯一 real deploy worker 在 wrangler 阶段直接失败 | `high` | Phase 1 单拆 `P1-03`，把 stub export + bindings + migrations 一次写清 |

### 7.2 约束与前提

- **技术前提**：`W2 skeleton 就绪，W1 worker naming 可读`
- **运行时前提**：`agent-core real deploy 只验证最小 hello-world fetch path`
- **组织协作前提**：`owner 可提供 deploy 窗口与账号`
- **上线 / 合并前提**：`matrix CI 与 shell smoke 通过`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/pre-worker-matrix/W4-workers-scaffolding.md`
  - `docs/design/pre-worker-matrix/W5-closure-and-handoff.md`
- 需要同步更新的说明文档 / README：
  - `workers/*/README.md`
- 需要同步更新的测试说明：
  - `docs/issue/pre-worker-matrix/W4-closure.md`

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `workers/*` 四目录与文件齐全
  - `pnpm-workspace.yaml` 已纳入 `workers/*`
- **单元测试**：
  - `workers/*/test/smoke.test.ts`
- **集成测试**：
  - `pnpm --filter './workers/*' build`
  - `pnpm --filter './workers/*' test`
- **端到端 / 手动验证**：
  - `wrangler deploy --env preview`（agent-core）
  - `curl <agent-core-url>`
- **回归测试**：
  - `matrix workflow green`
- **文档校验**：
  - `W4 closure 与 W2/W5 dual-path / deploy wording 一致`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `workers/` 目录成为物理事实
2. 4 个 shell 项目结构统一
3. `agent-core` DO slot 预留完整
4. `agent-core` 完成 1 次真实 deploy，或 fallback 为 shell-deployable pending credentials
5. 其余 3 个 shell 至少 dry-run 成功
6. W5 可直接引用 W4 deploy evidence

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `4 个 worker shell ready for future absorption` |
| 测试 | `shell smoke / build / matrix CI / real+dry-run 验证成立` |
| 文档 | `README / closure / dual-path 描述一致` |
| 风险收敛 | `不再需要在 worker-matrix P0 重建脚手架` |
| 可交付性 | `worker-matrix P0 可直接往现有 shell 填代码` |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待执行后回填`
- **哪些编号的拆分还不够合理**：`待执行后回填`
- **哪些问题本应更早问架构师**：`待执行后回填`
- **哪些测试安排在实际执行中证明不够**：`待执行后回填`
- **模板本身还需要补什么字段**：`待执行后回填`

---

## 10. 结语

这份 action-plan 以 **把 `workers/` 顶级目录与 deploy-shaped shell 从设计文字变成真实仓库结构** 为第一优先级，采用 **先 shell、再 workspace/CI、最后做 1 real + 3 dry-run deploy validation** 的推进方式，优先解决 **目录不存在、壳不统一、Cloudflare 链路未验证** 的问题，并把 **不提前塞业务逻辑、不强绑 W2 首发、不越界到真实 cross-worker wiring** 作为主要约束。整个计划完成后，`pre-worker-matrix / W4` 应达到 **worker-matrix P0 可直接复用的脚手架 ready 状态**，从而为后续的 **真实吸收、cross-worker wiring、live loop 装配** 提供稳定基础。
