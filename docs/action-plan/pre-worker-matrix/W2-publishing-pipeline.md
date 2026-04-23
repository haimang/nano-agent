# W2 — GitHub Packages Publishing Pipeline

> 服务业务簇: `pre-worker-matrix / W2 / publishing-pipeline`
> 计划对象: `建立 NACP 双包的 GitHub Packages 发布与首发路径`
> 类型: `migration`
> 作者: `GPT-5.4`
> 时间: `2026-04-21`
> 文件位置: `docs/action-plan/pre-worker-matrix/W2-publishing-pipeline.md`
> 关联设计 / 调研文档:
> - `docs/plan-pre-worker-matrix.md`
> - `docs/design/pre-worker-matrix/W2-publishing-pipeline.md`
> - `docs/design/pre-worker-matrix/W2-publishing-discipline.md`
> - `docs/action-plan/pre-worker-matrix/W5-closure-and-handoff.md`
> 文档状态: `executed`

---

## 0. 执行背景与目标

W2 的目的不是“为了发布而发布”，而是把 owner 已经确认的长期纪律——**只有 `nacp-core` 与 `nacp-session` 对外发布，其他 Tier B 包都不发布**——变成一条真正可执行的 CI/CD 路径。当前这条路径已经完成第一次真实落地：`@haimang/nacp-core@1.4.0` + `@haimang/nacp-session@1.3.0` 已经发布。

因此，这份 action-plan 要同时覆盖两层：一层是 **mandatory skeleton**，另一层是 **optional first publish**。前者必须在 pre-phase 完成，后者若 owner 选择推迟，也必须留下明确的切换与 closure 口径。

- **服务业务簇**：`pre-worker-matrix / W2`
- **计划对象**：`NACP GitHub Packages Publishing Pipeline`
- **本次计划解决的问题**：
  - `NACP 仍无可执行的官方发布路径`
  - `worker shell / dogfood 缺少 published path 切换基线`
  - `只发 2 个包` 还停留在设计文字层
- **本次计划的直接产出**：
  - `双包 publishConfig + publish workflow skeleton`
  - `publishing discipline 文档与 dogfood 路径`
  - `W2 closure memo（可区分 skeleton complete / first publish optional）`

---

## 1. 执行综述

### 1.1 总体执行方式

采用 **先建 skeleton、再建 dogfood、最后按 owner 决定执行或延后首发** 的方式推进。W2 的关键不是把首发做成强 blocker，而是让 repo 在 pre-phase 结束时已经具备“随时可 tag-publish”的能力。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | 发布元数据与纪律 | `S` | 补双包 publishConfig 与 discipline | `W0 design ready` |
| Phase 2 | workflow 与 dogfood skeleton | `M` | 建 publish workflow 与 consumer proof | `Phase 1` |
| Phase 3 | optional 首发与 closure | `S` | 若 owner 开窗则首发；否则明确 skeleton-only closure | `Phase 2` |

### 1.3 Phase 说明

1. **Phase 1 — 发布元数据与纪律**
   - **核心目标**：把 package metadata 与发布纪律先冻结
   - **为什么先做**：没有元数据和 discipline，workflow 只是空壳
2. **Phase 2 — workflow 与 dogfood skeleton**
   - **核心目标**：让 tag-trigger 路径和 consumer proof 真正存在
   - **为什么放在这里**：先有规则，再有自动化和验证
3. **Phase 3 — optional 首发与 closure**
   - **核心目标**：根据 owner 决定完成首发，或留下 skeleton-ready closure
   - **为什么放在这里**：首发不是 pre-phase 的硬 blocker，但 closure 必须诚实

### 1.4 执行策略说明

- **执行顺序原则**：`先 skeleton，再 first-publish optional`
- **风险控制原则**：`只服务 nacp-core / nacp-session，不扩 scope`
- **测试推进原则**：`先本地/CI 验 skeleton，再做 dogfood，再决定首发`
- **文档同步原则**：`discipline / closure / worker shell import 口径同步`

### 1.5 本次 action-plan 影响目录树

```text
W2 Publishing Pipeline
├── Phase 1: 发布元数据与纪律
│   ├── packages/nacp-core/package.json
│   ├── packages/nacp-session/package.json
│   └── docs/design/pre-worker-matrix/W2-publishing-discipline.md
├── Phase 2: workflow 与 dogfood skeleton
│   ├── .github/workflows/publish-nacp.yml
│   ├── the retired historical dogfood tree
│   └── docs/action-plan/pre-worker-matrix/
└── Phase 3: optional 首发与 closure
    ├── git tag / workflow run
    ├── docs/issue/pre-worker-matrix/W2-closure.md
    └── workers/* import path notes
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 给 `nacp-core` / `nacp-session` 补 `publishConfig`
- **[S2]** 创建 `publish-nacp.yml` workflow skeleton 与权限/secret 约定
- **[S3]** 创建最小 dogfood consumer proof
- **[S4]** 根据 owner 决定执行 optional 首发，或写明 skeleton-only closure

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 发布任何 Tier B package
- **[O2]** 引入 beta/rc/canary/tag automation 等复杂 release 体系
- **[O3]** 把 W4 强绑成“只能从 GitHub Packages 安装”
- **[O4]** 改写 W0/W1/W3/W4 的代码或 worker shell 逻辑

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `publishConfig` + workflow skeleton | `in-scope` | 这是 pre-phase mandatory skeleton | `W2 执行期` |
| 首次真实发布 | `done` | 已按 owner-aligned `@haimang` scope 完成 | `已收口` |
| dogfood proof | `in-scope` | 即使不首发，也应留下可消费验证路径 | `W2 执行期` |
| 其他 package 发布 | `out-of-scope` | 违反长期纪律 | `无` |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | 双包 publishConfig | `update` | `packages/nacp-core/package.json` `packages/nacp-session/package.json` | 固化 registry/access truth | `medium` |
| P1-02 | Phase 1 | discipline 收口 | `update` | `docs/design/pre-worker-matrix/W2-publishing-discipline.md` | 固化 publish rules | `low` |
| P2-01 | Phase 2 | publish workflow | `add` | `.github/workflows/publish-nacp.yml` | 让 tag-publish 可执行 | `medium` |
| P2-02 | Phase 2 | dogfood consumer | `add` | `the retired historical dogfood consumer{package.json,.npmrc,tsconfig.json,src/smoke.ts,README.md}` | 证明 consumer path 可走通 | `medium` |
| P2-03 | Phase 2 | auth/permission 文档 | `update` | workflow docs / closure notes | 记录 packages:write 与 token 约定 | `low` |
| P2-04 | Phase 2 | workspace 排除 dogfood | `update` | `pnpm-workspace.yaml` | 明确 dogfood 不进入主 workspace | `medium` |
| P3-01 | Phase 3 | optional 首发 | `update` | git tag / workflow run / registry evidence | 若 owner 开窗则完成首次发布 | `medium` |
| P3-02 | Phase 3 | W2 closure | `add` | `docs/issue/pre-worker-matrix/W2-closure.md` | 明确 skeleton-only 或 first-publish closure | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — 发布元数据与纪律

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | 双包 publishConfig | 补 registry/access metadata | `packages/nacp-core/package.json` `packages/nacp-session/package.json` | 双包具备发布元数据 | package diff 校对 | metadata 完整一致 |
| P1-02 | discipline 收口 | 固化 tag 规则、dual-path、回退策略 | `W2-publishing-discipline.md` | 发布行为纪律稳定 | 文档核对 | 与 narrowed W2 一致 |

### 4.2 Phase 2 — workflow 与 dogfood skeleton

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | publish workflow | 建 tag-trigger workflow skeleton | `.github/workflows/publish-nacp.yml` | 可随时执行首发 | workflow lint / run | 流程完整 |
| P2-02 | dogfood consumer | 建最小 consumer package，显式落 `package.json / .npmrc / src/smoke.ts / README.md` | `historical dogfood consumer files` | published path 有验证入口 | build/install 验证 | 不走 workspace link |
| P2-03 | auth/permission 说明 | 明确 token / packages:write / `.npmrc` 要求 | docs/closure notes | owner 能正确配置环境 | 文档核对 | 配置清晰 |
| P2-04 | workspace 排除 dogfood | 保持 `pnpm-workspace.yaml` 不吸入 `the retired historical dogfood tree`，即使未来加入 `workers/*` 也不污染 dogfood | `pnpm-workspace.yaml` | dogfood 独立 lockfile / install path 成立 | 文档核对 | 不被 workspace link 污染 |

### 4.3 Phase 3 — optional 首发与 closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | optional 首发 | 若 owner 开窗则打 tag 发布并保留 evidence | registry/workflow | 完成首发或明确延期 | workflow run / dogfood | evidence 可回看 |
| P3-02 | W2 closure | 写 skeleton-ready 或 first-publish closure | `docs/issue/pre-worker-matrix/W2-closure.md` | W5 可直接引用 | 文档 review | 路径诚实明确 |

---

## 5. Phase 详情

### 5.1 Phase 1 — 发布元数据与纪律

- **Phase 目标**：把 W2 的“发布纪律”先于自动化落稳
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `packages/nacp-core/package.json`
  - `packages/nacp-session/package.json`
  - `docs/design/pre-worker-matrix/W2-publishing-discipline.md`
- **具体功能预期**：
  1. 只服务 2 个 NACP 包
  2. dual-path（`workspace:*` / published）口径明确
  3. tag-trigger 纪律冻结
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`包元数据与 workflow 预期核对`
  - **回归测试**：`package.json parse / workspace 不受影响`
  - **手动验证**：`核对 scope/registry/access`
- **收口标准**：
  - metadata 无歧义
  - discipline 与 W4/W5 口径一致
- **本 Phase 风险提醒**：
  - 最容易误把 W4 绑成必须 published 才能推进

### 5.2 Phase 2 — workflow 与 dogfood skeleton

- **Phase 目标**：让发布路径从“规则”变成“随时可触发的基础设施”
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
  - `P2-04`
- **本 Phase 新增文件**：
  - `.github/workflows/publish-nacp.yml`
  - `the historical dogfood consumer package manifest`
  - `the historical dogfood consumer npmrc`
   - `the historical dogfood consumer tsconfig`
   - `the historical dogfood consumer smoke entry`
   - `the historical dogfood consumer README`
- **本 Phase 修改文件**：
  - `pnpm-workspace.yaml`
  - `相关文档说明`
- **具体功能预期**：
  1. `nacp-v*` tag 可触发发布
  2. dogfood 可证明 published consumer path
  3. auth/permission 配置方式清楚
  4. dogfood 不会被误吸进主 workspace
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`workflow dry path + dogfood build/install`
  - **回归测试**：`不污染主 workspace`
  - **手动验证**：`确认 dogfood 不使用 workspace link`
- **收口标准**：
  - workflow skeleton 齐全
  - dogfood 具备最小可验证性
- **本 Phase 风险提醒**：
  - dogfood 若进 workspace，会失去验证价值

### 5.3 Phase 3 — optional 首发与 closure

- **Phase 目标**：诚实完成 W2 的 phase 结论
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `docs/issue/pre-worker-matrix/W2-closure.md`
- **本 Phase 修改文件**：
  - `closure / evidence notes`
- **具体功能预期**：
  1. 若首发，则保留 registry + workflow + dogfood evidence
  2. 若不首发，则写明 skeleton 完整、切换延期到 worker-matrix
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`dogfood consumer`
  - **回归测试**：`无额外代码回归`
  - **手动验证**：`registry/closure 证据可回看`
- **收口标准**：
  - closure 明确属于哪一种完成形态
  - W5 能据此判断 skeleton completeness
- **本 Phase 风险提醒**：
  - 最危险的是把“没首发”写成“W2 失败”

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1

- **影响范围**：`Phase 1 / Phase 2`
- **为什么必须确认**：`scope 决定 package 名称、.npmrc、workflow publish target`
- **当前建议 / 倾向**：`沿用统一 owner scope，不拆双 scope`
- **Q**：`NACP 双包最终使用的 GitHub Packages scope 是否就是当前统一组织 scope？`
- **A**：`是。默认沿用当前统一组织 scope，不在 W2 再拆双 scope。`

#### Q2

- **影响范围**：`Phase 3`
- **为什么必须确认**：`影响 W2 的 closure 形态`
- **当前建议 / 倾向**：`已完成首发，后续只维护发布纪律与证据归档`
- **Q**：`owner 是否要求 pre-worker-matrix 阶段内必须完成首次真实发布？`
- **A**：`本轮已完成。后续不再把“是否首发”当开放问题，只保留版本和 namespace 纪律。`

### 6.2 问题整理建议

- 只确认会改变 skeleton / closure 形态的问题
- 不把未来 worker-matrix 的 published cutover 时间提前塞进 W2

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| scope / auth 配置错误 | 会让 workflow 形似完备但实际不能 publish | `high` | 先写清 `.npmrc` / token / permission 纪律 |
| dogfood 失真 | 若走 workspace link，就不能证明 published path | `high` | dogfood 独立于 workspace |
| 首发时机争议 | 容易把 W2 从 parallel 再写回 blocker | `medium` | closure 明确 skeleton mandatory / first publish optional |

### 7.2 约束与前提

- **技术前提**：`W0 code ready 之后才有发布对象`
- **运行时前提**：`W4 允许 workspace:* interim，不强绑 published`
- **组织协作前提**：`owner 可提供 packages:write 权限或等价 token`
- **上线 / 合并前提**：`workflow 与 discipline 一致`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/pre-worker-matrix/W2-publishing-pipeline.md`
  - `docs/design/pre-worker-matrix/W2-publishing-discipline.md`
- 需要同步更新的说明文档 / README：
  - `the historical dogfood consumer README`（若创建）
- 需要同步更新的测试说明：
  - `docs/issue/pre-worker-matrix/W2-closure.md`

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `双包 package.json 含正确 publishConfig`
  - `publish-nacp.yml` 存在且 trigger/permissions 明确
- **单元测试**：
  - `无`
- **集成测试**：
  - `dogfood consumer install/build`
- **端到端 / 手动验证**：
  - `若首发，检查 workflow run 与 registry evidence`
- **回归测试**：
  - `不破坏主 workspace / packages 构建`
- **文档校验**：
  - `discipline / closure / W4 dual-path 口径一致`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. 双包 skeleton 完整
2. dogfood path 存在
3. dogfood `.npmrc` 与 `pnpm-workspace.yaml` 排除策略明确
4. closure 能区分 first publish 是否已完成
5. W4/W5 可直接消费 dual-path 结论
6. 不存在“顺手发布其他包”的 scope 漂移

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `NACP 双包随时可 tag-publish` |
| 测试 | `dogfood path 可验证，workflow skeleton 可执行` |
| 文档 | `discipline / closure / config 一致` |
| 风险收敛 | `首发可延后但不再模糊` |
| 可交付性 | `W4 与后续 worker-matrix 能直接消费该发布策略` |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待执行后回填`
- **哪些编号的拆分还不够合理**：`待执行后回填`
- **哪些问题本应更早问架构师**：`待执行后回填`
- **哪些测试安排在实际执行中证明不够**：`待执行后回填`
- **模板本身还需要补什么字段**：`待执行后回填`

---

## 10. 结语

这份 action-plan 以 **把“只发 2 个 NACP 包”从设计文本变成可执行流水线** 为第一优先级，采用 **先 skeleton、再 dogfood、最后 optional first publish** 的推进方式，优先解决 **发布路径不存在、consumer path 不清、W4/W5 dual-path 口径漂移** 的问题，并把 **不扩大发布范围、不过度阻塞 first-wave、closure 必须诚实** 作为主要约束。整个计划完成后，`pre-worker-matrix / W2` 应达到 **publish-ready skeleton complete** 的状态，从而为后续的 **worker shell 安装路径与未来 published cutover** 提供稳定基础。

---

## 11. GPT 工作日志回填

### 11.1 本轮完成范围

1. 给 `packages/nacp-core/package.json` 与 `packages/nacp-session/package.json` 补齐 GitHub Packages `publishConfig`，冻结 W2 的最小 publish metadata。
2. 新建 `.github/workflows/publish-nacp.yml`，固定 `nacp-v*.*.*` tag-trigger、`packages: write` 权限、双包 typecheck/build/test，以及 bundle-version check。
3. 新建 `the retired historical dogfood consumer` 最小 consumer skeleton，并保持它在 workspace 外部，避免误走 workspace link。
4. 新建 `docs/issue/pre-worker-matrix/W2-closure.md`，并在首发完成后升级为 **first publish completed** 的真实状态。
5. 同步修正 `W2-publishing-pipeline.md` / `W2-publishing-discipline.md` / `W4-workers-scaffolding.md` / `W5-closure-and-handoff.md` 中与 W0 当前版本现实直接冲突的口径。

### 11.2 代码与文档改动清单

- **新增文件**
  - `.github/workflows/publish-nacp.yml`
  - `the historical dogfood consumer package manifest`
  - `the historical dogfood consumer npmrc`
  - `the historical dogfood consumer tsconfig`
  - `the historical dogfood consumer smoke entry`
  - `the historical dogfood consumer README`
  - `docs/issue/pre-worker-matrix/W2-closure.md`
- **修改文件**
  - `.gitignore`
  - `pnpm-workspace.yaml`
  - `packages/nacp-core/package.json`
  - `packages/nacp-session/package.json`
  - `docs/design/pre-worker-matrix/W2-publishing-pipeline.md`
  - `docs/design/pre-worker-matrix/W2-publishing-discipline.md`
  - `docs/action-plan/pre-worker-matrix/W2-publishing-pipeline.md`
  - `docs/design/pre-worker-matrix/W4-workers-scaffolding.md`
  - `docs/design/pre-worker-matrix/W5-closure-and-handoff.md`

### 11.3 关键事实与收口判断

1. W2 当前最重要的 reality 不是“双包同步到 1.4.0”，而是 **`nacp-core@1.4.0` 已 shipped、`nacp-session@1.3.0` 仍未引入新的 published surface**；因此 workflow 的 version gate 必须锚定 `nacp-core`，不能继续假造双包同版本。
2. `.github/` 原先被 `.gitignore` 忽略，若不先解除，W2 的 workflow skeleton 根本无法成为真实仓库资产；这个问题已与 W2 一并修复。
3. `pnpm-workspace.yaml` 当前天然未包含 `the retired historical dogfood tree`，因此 dogfood exclusion 的正确做法不是新增复杂 negate pattern，而是保留 `packages/*` 单路径并补清注释。
4. 当前 repo 已完成 owner-aligned `@haimang/*` 首发；后续 closure 必须围绕真实 package / tag / run / dogfood evidence 维护，不再沿用 deferred 口径。

### 11.4 验证与结果摘要

1. 现有 NACP 双包 validation 与 publish dry-run 通过后，W2 skeleton 可以视为工程上成立。
2. dogfood published-path 安装没有在本轮宣称完成；closure 只记录了 tarball-consumer smoke 与 future published-path gate。
3. W5 后续应把 W2 视为“import/publish skeleton 已完成、真实首发状态已诚实归档”的 phase，而不是“GitHub Packages 已确定对外可安装”的 phase。

### 11.5 最终收口意见

**结论**：W2 已可按 narrowed scope 收口为 **executed + first publish completed**。本阶段要求的 mandatory skeleton（publish metadata / workflow / discipline / dogfood skeleton / closure）已经齐备，且 `@haimang/*` published-path 已真实成立。这一状态足以支撑后续 W4/W5 消费，不需要再把 W2 误写成 pre-worker-matrix 的剩余 blocker。

### 11.6 真实首发补充日志（2026-04-23）

1. owner 决策落到 `@haimang/*` 路线后，我完成了受控 scope migration：
   - `@haimang/nacp-core`
   - `@haimang/nacp-session`
   - workflow `scope: "@haimang"`
   - dogfood `.npmrc` 与 `package.json` 同步到 `@haimang`
2. 首次 release-ready commit：
   - `ff9a03d` — `chore: prepare haimang nacp publish`
3. 首次 tag push：
   - `nacp-v1.4.0`
   - 第一次 run `24814362710` 失败，根因是 CI clean checkout 下 `nacp-session` typecheck 先于 `nacp-core` build
4. workflow 修复：
   - `8da7e6b` — `fix: order nacp publish workflow builds`
   - 调整为 `typecheck+build nacp-core` → `typecheck+build nacp-session` → `test` → `publish` → `dogfood`
5. 删除并重推同名 tag：
   - 删除远端/本地 `nacp-v1.4.0`
   - 重建并重推到 `8da7e6b`
6. 成功首发证据：
   - run: `https://github.com/haimang/nano-agent/actions/runs/24814439569`
   - job: `https://github.com/haimang/nano-agent/actions/runs/24814439569/job/72625731482`
   - `+ @haimang/nacp-core@1.4.0`
   - `+ @haimang/nacp-session@1.3.0`
   - dogfood install/build/smoke 全部成功，smoke 输出：
     ```json
     {
       "nacpCoreVersion": "1.4.0",
       "nacpSessionVersion": "1.3.0",
       "coreTypeCount": 11
     }
     ```
7. 补充结论：
   - W2 已不只是 `skeleton complete`
   - W2 已升级为 **`first publish completed`**
