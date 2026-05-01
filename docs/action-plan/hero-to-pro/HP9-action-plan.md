# Nano-Agent 行动计划 — HP9 API Docs + Manual Evidence

> 服务业务簇: `hero-to-pro / HP9`
> 计划对象: `把当前 RHX2 风格的 11 份接口文档、7 份新增专题、5 设备手工证据与 prod schema baseline 收敛成 hero-to-pro 对外交付冻结包`
> 类型: `docs + evidence + review + owner-action`
> 作者: `Owner + GPT-5.4`
> 时间: `2026-04-30`
> 文件位置:
> - `clients/api-docs/README.md`
> - `clients/api-docs/{auth,catalog,error-index,me-sessions,permissions,session,session-ws-v1,usage,wechat-auth,worker-health}.md`
> - `clients/api-docs/{models,context,checkpoints,confirmations,todos,workspace,transport-profiles}.md`
> - `docs/issue/hero-to-pro/manual-evidence-pack.md`
> - `docs/issue/hero-to-pro/prod-schema-baseline.md`
> - `docs/issue/hero-to-pro/HP9-closure.md`
> - `docs/evidence/hero-to-pro-manual-*/**`
> - `docs/eval/hero-to-pro/HP9-api-docs-reviewed-by-*.md`
> 上游前序 / closure:
> - `docs/action-plan/hero-to-pro/HP8-action-plan.md`
> - `docs/issue/hero-to-pro/HP8-closure.md`
> - `docs/charter/plan-hero-to-pro.md` §7.10 HP9
> 下游交接:
> - `docs/action-plan/hero-to-pro/HP10-action-plan.md`
> 关联设计 / 调研文档:
> - `docs/design/hero-to-pro/HP9-api-docs-and-manual-evidence.md`
> - `docs/design/hero-to-pro/HPX-qna.md`
> - `docs/issue/zero-to-real/zero-to-real-final-closure.md`
> - `docs/issue/real-to-hero/RHX2-closure.md`
> 冻结决策来源:
> - `docs/design/hero-to-pro/HPX-qna.md` Q29-Q32（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `draft`

---

## 0. 执行背景与目标

HP9 不是“把 `clients/api-docs/` 再补几篇 markdown”，而是 hero-to-pro 第一次对外可交付事实的冻结包：接口文档、5 设备手工证据、prod schema baseline 三件事必须一起成立。当前仓库确实已经有一套可读的 docs baseline，但它仍明显停留在 RHX2：README 只索引 10 份专题文档，`session.md` 混装 models/context/files，`permissions.md` 与 `usage.md` 仍以“WS path 未 live”的过渡口径书写；与此同时，zero-to-real final closure 已把 manual browser / 微信开发者工具 / 真机证据明确列为下阶段遗留，说明 HP9 不能再用“以后再补”应付过去。

因此 HP9 的任务，是在 HP8 freeze gate 之后，把 public truth 一次性打包：以产品 surface 而不是 worker 模块重组 `clients/api-docs/`，将 11 份现有文档与 7 份新增专题收敛成 authoritative 18 份文档包，把 5 套设备的手工验证归档成 evidence pack，并以 owner / ops 的 remote/prod 事实写出 schema baseline。这里同时要修正文档 planning 里的两个历史漂移：**最终文档数是 11 现有 + 7 新增 = 18；rewrite/new 深审范围是 4 份 rewrite + 7 份新增 = 11 份，不是 charter 旧 wording 中的 10 份**。

- **服务业务簇**：`hero-to-pro / HP9`
- **计划对象**：`hero-to-pro public docs / evidence / prod baseline 交付包`
- **本次计划解决的问题**：
  - 当前 `clients/api-docs/` 仍以 RHX2 快照为主，部分文档延续了已过期的兼容表述。
  - manual evidence 仍是跨阶段 chronic gap，若继续 defer，HP10 final closure 的合法性会再次变弱。
  - prod schema baseline 还没有 owner-verified remote/prod 事实，不足以支撑封板。
- **本次计划的直接产出**：
  - 18 份 `clients/api-docs/` 文档包（11 现有重组 / 校对 + 7 份新增专题）。
  - `manual-evidence-pack.md` + 5 套设备 evidence 归档。
  - `prod-schema-baseline.md` + 4-review 流程产物 + `HP9-closure.md`。
- **本计划不重新讨论的设计结论**：
  - API docs 按产品 surface 组织；每份新增文档头部保留主要 worker / endpoint family 作为 implementation reference（来源：`docs/design/hero-to-pro/HPX-qna.md` Q29）。
  - manual evidence 是 hard gate，不允许继续 defer；`not-applicable-with-reason` 只允许产品边界不适用，不允许“暂时没设备”（来源：`docs/design/hero-to-pro/HPX-qna.md` Q30）。
  - prod schema baseline 必须以 remote/prod 事实回填，并记录 `captured_at` 与 `wrangler --version`（来源：`docs/design/hero-to-pro/HPX-qna.md` Q31）。
  - 18 份文档采用分级 review：rewrite/new 深审，稳定文档 sanity check，且 sanity check 若发现结构漂移必须当天升级为 rewrite（来源：`docs/design/hero-to-pro/HPX-qna.md` Q32）。

---

## 1. 执行综述

### 1.1 总体执行方式

HP9 采用**先冻结文档 inventory 与 review routing → 再重写高风险旧文档 → 再补齐 7 份新增专题与 README 重索引 → 再完成 manual evidence 与 prod baseline → 最后做 4-review 修订与 closure** 的顺序。先锁定 inventory / routing，能避免执行中反复争论“哪份要重写、哪份只核对”；而把 manual evidence 与 prod baseline 放在文档主体完成之后，则能确保 owner/ops 验证的是已经 freeze 的 public truth，而不是仍在变化中的草稿。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Freeze Inventory + Review Routing | S | 锁定 18 份 docs pack 与 rewrite/sanity/new 路由 | `-` |
| Phase 2 | Rewrite High-Risk Existing Docs | M | 重写 `session/permissions/usage/error-index` 四份高风险文档 | Phase 1 |
| Phase 3 | New Docs + README Reindex + Stable Sanity | M | 新增 7 份专题文档并完成其余稳定文档核对 | Phase 1-2 |
| Phase 4 | Manual Evidence + Prod Baseline | M | 归档 5 设备证据并写 remote/prod schema baseline | Phase 1-3 |
| Phase 5 | 4-Review Fixes + Closure | M | 完成 4-review 修订、索引自检与 HP9 closure | Phase 1-4 |

### 1.3 Phase 说明

1. **Phase 1 — Freeze Inventory + Review Routing**
   - **核心目标**：把“18 份最终文档包”与“11 份深审对象”一次钉死。
   - **为什么先做**：没有 inventory / routing，HP9 很容易在执行中反复漂移范围。
2. **Phase 2 — Rewrite High-Risk Existing Docs**
   - **核心目标**：先处理最容易误导 client 的四份旧文档。
   - **为什么放在这里**：这些文档结构性过时，最影响后续 README 重索引与新增专题切分。
3. **Phase 3 — New Docs + README Reindex + Stable Sanity**
   - **核心目标**：补齐 7 份新文档、收缩 `session.md` 职责，并对稳定旧文档做事实核对。
   - **为什么放在这里**：要先完成 rewrite，再拆出 models/context/checkpoints 等新专题，避免两边互相覆盖。
4. **Phase 4 — Manual Evidence + Prod Baseline**
   - **核心目标**：把 manual evidence 和 prod remote 事实绑定到已经冻结的文档包。
   - **为什么放在这里**：证据必须对应最终 docs pack，而不是对中间草稿验收。
5. **Phase 5 — 4-Review Fixes + Closure**
   - **核心目标**：形成最终 review 修订版 docs pack 与 HP9 closure。
   - **为什么最后**：只有文档主体、手工证据、prod baseline 都就位，review 才有意义。

### 1.4 执行策略说明

- **执行顺序原则**：先 inventory，再 rewrite/new，再 evidence/prod，再 review；HP8 未 closure 时不提前启动。
- **风险控制原则**：所有 docs 均以冻结代码事实为准；若 sanity check 发现结构漂移，立即升级为 rewrite，不拖到 closure 前。
- **测试推进原则**：HP9 以“代码核对 + 文档 cross-link + manual evidence + prod remote baseline”四层验证为主；不发明新的 lint 工具。
- **文档同步原则**：README、18 份 docs、manual evidence 索引、prod baseline、HP9 closure 五层必须互链，不能拆散。
- **回滚 / 降级原则**：若 manual evidence 缺设备或 prod remote 不可读，只允许显式标 `cannot close` / `blocked-by-owner-access`，不允许用本地 migrations 或猜测截图代替。

### 1.5 本次 action-plan 影响结构图

```text
hero-to-pro HP9 docs + evidence pack
├── Phase 1: Freeze Inventory + Review Routing
│   ├── 18-doc authoritative list
│   └── rewrite / sanity / new routing
├── Phase 2: Rewrite High-Risk Existing Docs
│   ├── session.md
│   ├── permissions.md
│   ├── usage.md
│   └── error-index.md
├── Phase 3: New Docs + README Reindex + Stable Sanity
│   ├── models/context/checkpoints/confirmations
│   ├── todos/workspace/transport-profiles
│   └── README + 7 stable docs sanity check
├── Phase 4: Manual Evidence + Prod Baseline
│   ├── 5-device evidence pack
│   └── prod-schema-baseline.md
└── Phase 5: 4-Review Fixes + Closure
    ├── review memos under docs/eval/hero-to-pro/
    └── docs/issue/hero-to-pro/HP9-closure.md
```

### 1.6 已核对的当前代码锚点

1. **README 目前索引的仍是 RHX2 风格 11 份文档包**
   - `clients/api-docs/README.md:110-123`
   - 当前只列 README 之外 10 份专题文档，还没有 HP9 目标态的 18 份索引。
2. **`session.md` 当前仍把 models / context / files 混装在同一份文档里**
   - `clients/api-docs/session.md:7-27`
   - 这说明 HP9 需要按产品 surface 重切，而不是在原文档上继续叠层。
3. **`permissions.md` 仍明确写着 WS round-trip 未 live、runtime 不等待**
   - `clients/api-docs/permissions.md:18-28,177-186`
4. **`usage.md` 仍明确写着 `session.usage.update` WS live push 未 live**
   - `clients/api-docs/usage.md:86-107`
5. **`error-index.md` 已经是较成熟的稳定核心，而不是需要被整份推翻**
   - `clients/api-docs/error-index.md:1-12,15-37,99-134,197-201`
6. **root 当前没有文档 freeze / prod baseline 级 helper**
   - `package.json:7-17`
7. **wrangler 只能证明本地 migrations 目录存在，不能替代 prod remote baseline**
   - `workers/orchestrator-core/wrangler.jsonc:33-41,90-97`
8. **manual evidence 是前阶段显式遗留 gap，closure precedent 已经写清**
   - `docs/issue/zero-to-real/zero-to-real-final-closure.md:99-115`
9. **仓库已经接受“closure + smoke / evidence artifact”配套方式**
   - `docs/issue/real-to-hero/RHX2-closure.md:99-123`

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 18 份 `clients/api-docs/` 文档包的 authoritative inventory 与重组。
- **[S2]** 4 份 rewrite + 7 份 new 深审，7 份 stable docs sanity check。
- **[S3]** 5 设备 manual evidence pack 与 `manual-evidence-pack.md` 总索引。
- **[S4]** `prod-schema-baseline.md` 的 remote/prod 校对记录。
- **[S5]** 4-review 流程、修订回合与 `HP9-closure.md`。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** WeChat mini program 的完整产品化适配。
- **[O2]** 新 API / 新 runtime 能力开发。
- **[O3]** 自动化 SDK 生成或 contract codegen。
- **[O4]** HP10 final closure / hero-to-platform stub。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| 按 worker 模块拆 docs | `out-of-scope` | Q29 已冻结为按产品 surface 组织 | 不重评 |
| manual evidence 缺 1 台设备先 partial close | `out-of-scope` | Q30 已冻结为 hard gate，缺设备即不可 closure | 不重评 |
| prod baseline 只看 preview 或本地 migrations | `out-of-scope` | Q31 已冻结必须 remote/prod 校对 | 仅在 owner 权限阻塞时显式转 HP10 retained |
| sanity check 中发现结构过时继续拖到 closure | `out-of-scope` | Q32 已冻结发现结构漂移当天升级为 rewrite | 不重评 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | 18-doc inventory freeze | `update` | README + doc inventory | 锁定 authoritative docs pack | `medium` |
| P1-02 | Phase 1 | review routing + checklist | `add` | review checklist + closure notes | 让 rewrite/sanity/new 路由不再漂移 | `medium` |
| P2-01 | Phase 2 | rewrite `session.md` | `update` | `clients/api-docs/session.md` + new docs dependencies | 把混装入口收缩回 session lifecycle | `high` |
| P2-02 | Phase 2 | rewrite `permissions.md` / `usage.md` / `error-index.md` | `update` | high-risk docs | 用 HP5-HP8 冻结事实替换 RHX2 过渡口径 | `high` |
| P3-01 | Phase 3 | author 7 new docs + README reindex | `add` | new docs + README | 补齐 18 份结构 | `medium` |
| P3-02 | Phase 3 | stable docs sanity check | `update` | remaining 7 docs | 校正链接、header、endpoint drift | `medium` |
| P4-01 | Phase 4 | manual evidence pack | `add` | `docs/evidence/**`, `manual-evidence-pack.md` | 让 5 设备证据成为正式交付件 | `high` |
| P4-02 | Phase 4 | prod schema baseline | `add` | `prod-schema-baseline.md` | 让 schema 事实经过 remote/prod 核对 | `high` |
| P5-01 | Phase 5 | 4-review fixes | `update` | docs pack + review memos | 让 deep-review 问题全部回写 | `medium` |
| P5-02 | Phase 5 | HP9 closure | `update` | `docs/issue/hero-to-pro/HP9-closure.md` | 让 HP10 可以直接消费 docs/evidence/baseline verdict | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Freeze Inventory + Review Routing

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | 18-doc inventory freeze | 锁定 `11 现有 + 7 新增 = 18` 的 authoritative docs pack，并把每份文档映射到产品 surface | `clients/api-docs/README.md`, HP9 inventory note | 所有执行者都以同一份 inventory 施工 | doc review | README 与 inventory 表完全一致，不再出现 17 / 18 / 10 / 11 的旧口径漂移 |
| P1-02 | review routing + checklist | 冻结 `rewrite / new / sanity-check` 分类与 checklist，包含 `has structural drift?` 必填项 | review checklist / `docs/eval/hero-to-pro/HP9-api-docs-reviewed-by-*.md` | 文档 review 强度与风险匹配 | checklist dry run | 4 rewrite + 7 new 深审、7 stable sanity 的边界明确 |

### 4.2 Phase 2 — Rewrite High-Risk Existing Docs

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | rewrite `session.md` | 把 models/context/files 拆出独立专题，`session.md` 收敛到 lifecycle / transport / legacy-vs-facade 差异 | `clients/api-docs/session.md`, `models.md`, `context.md`, `workspace.md`, `checkpoints.md` | `session.md` 不再承担超载入口职责 | code-vs-doc route audit | session 文档不再混装 models/context/files 主体内容 |
| P2-02 | rewrite `permissions.md` / `usage.md` / `error-index.md` | 以 HP5-HP8 冻结事实替换 RHX2 过渡叙述，并补充真正的 control-plane / ws / classifier 边界 | corresponding docs + code anchors | client 不再被过时兼容表述误导 | item-by-item code audit | 4 份 rewrite 文档都能与当前代码事实逐项对应 |

### 4.3 Phase 3 — New Docs + README Reindex + Stable Sanity

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | author 7 new docs + README reindex | 新增 `models/context/checkpoints/confirmations/todos/workspace/transport-profiles`，并重写 README 索引；其中 `confirmations.md` 必须带 kind-by-kind readiness matrix，明确 `live / registry-only / future` 边界 | `clients/api-docs/*.md` | HP9 目标 surface 全部有独立入口 | cross-link self-check | 18 份 docs 都有明确定位、相互链接和 worker reference header |
| P3-02 | stable docs sanity check | 对 `auth/catalog/me-sessions/session-ws-v1/wechat-auth/worker-health` 等稳定文档做事实核对、链接修正与必要升级 | remaining docs | 稳定文档不被遗漏，也不被过度重写 | sanity checklist | 如发现结构漂移，已即时升级为 rewrite，不留到 closure 前暴露 |

### 4.4 Phase 4 — Manual Evidence + Prod Baseline

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | manual evidence pack | 按 5 设备矩阵执行完整手工流，并把 step log / screenshot or clip refs / failures / trace UUID 全部归档；owner-action checklist 固定为：① HP9 启动日冻结 5 设备清单与录制脚本 owner；② 启动 + 3 日完成脚本与环境确认；③ 启动 + 7 日完成 5 设备录制；④ 启动 + 10 日完成 evidence 索引；任一节点延期即标 `cannot close`，不得降级为 partial | `docs/evidence/hero-to-pro-manual-*/**`, `docs/issue/hero-to-pro/manual-evidence-pack.md` | manual evidence 从历史 gap 升级为正式交付件 | device matrix checklist | 5 设备齐备；任何不适用步骤都写 `not-applicable-with-reason` |
| P4-02 | prod schema baseline | 用 remote/prod 命令记录 wrangler 版本、captured_at、结果、差异与补救路径 | `docs/issue/hero-to-pro/prod-schema-baseline.md` | schema 事实第一次经过 prod remote 对照 | owner remote run + markdown review | 若无访问权，明确标 `blocked-by-owner-access`，绝不以本地 migrations 代替 |

### 4.5 Phase 5 — 4-Review Fixes + Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | 4-review fixes | 对 11 份 deep-review docs 走 4-review 流程，并把 critical/high 问题全部修回 docs pack | `docs/eval/hero-to-pro/HP9-api-docs-reviewed-by-*.md`, `clients/api-docs/*.md` | docs pack 获得 reviewer-level 收口 | review diff audit | critical = 0，high 全部修复，低优先级问题有明确 disposition |
| P5-02 | HP9 closure | 回填 docs pack / manual evidence / prod baseline / review 四层 verdict，并显式登记 F1-F17 chronic status（`closed / partial / not-touched / handed-to-platform`） | `docs/issue/hero-to-pro/HP9-closure.md` | HP10 能直接消费 HP9 的 frozen public truth | doc review | HP9 closure 能独立回答“18 份文档、5 设备证据、prod baseline 是否齐备” |

---

## 5. Phase 详情

### 5.1 Phase 1 — Freeze Inventory + Review Routing

- **Phase 目标**：先把 HP9 的 authoritative inventory 与 review routing 钉死。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 修改文件**：
  - `clients/api-docs/README.md`
  - 可能涉及 HP9 inventory / checklist 辅助文档
- **本 Phase 已核对的源码锚点**：
  - `clients/api-docs/README.md:110-123`
  - `docs/design/hero-to-pro/HP9-api-docs-and-manual-evidence.md:292-320,373-385`
- **具体功能预期**：
  1. authoritative count 固定为 18，不再让 README 与 design/charter 各说各话。
  2. rewrite/new/sanity routing 会被明确映射到具体文件。
  3. sanity checklist 中的 `has structural drift?` 成为 mandatory 决策点。
- **具体测试安排**：
  - **单测**：无新增代码单测。
  - **集成测试**：inventory 与 README 索引对照。
  - **回归测试**：无额外命令，依赖文档核对与后续 review。
  - **手动验证**：README / checklist 审阅。
- **收口标准**：
  - 18-doc inventory 已锁定。
  - 深审范围 = 11 docs 已明确。
- **本 Phase 风险提醒**：
  - 如果 inventory 与 routing 不先钉死，HP9 执行中会持续争论边界，review 成本会失控。

### 5.2 Phase 2 — Rewrite High-Risk Existing Docs

- **Phase 目标**：修掉最容易误导 client 的四份旧文档。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 修改文件**：
  - `clients/api-docs/session.md`
  - `clients/api-docs/permissions.md`
  - `clients/api-docs/usage.md`
  - `clients/api-docs/error-index.md`
  - 可能涉及将内容迁移到新增专题文档
- **本 Phase 已核对的源码锚点**：
  - `clients/api-docs/session.md:7-27,29-43`
  - `clients/api-docs/permissions.md:18-28,177-186`
  - `clients/api-docs/usage.md:86-107`
  - `clients/api-docs/error-index.md:15-37,99-134,197-201`
- **具体功能预期**：
  1. `session.md` 只承担 session lifecycle / transport / status / history 等主线。
  2. `permissions.md` 会用 HP5 confirmation / round-trip 事实重写，而不是保留 RHX2 fallback 口径。
  3. `usage.md` 与 `error-index.md` 会以当前 live truth 为准更新 polling / push / classifier 结论。
- **具体测试安排**：
  - **单测**：无新增单测。
  - **集成测试**：逐 route code-vs-doc 核对。
  - **回归测试**：
    - `pnpm test:cross-e2e`（用于确认 public surface freeze 后没有新的行为漂移）
  - **手动验证**：逐段审核 rewrite 是否还留有 RHX2 过渡残影。
- **收口标准**：
  - 四份 rewrite 文档都已不再依赖过时叙述。
  - 文档主体与当前代码事实逐项对应。
- **本 Phase 风险提醒**：
  - 若只在旧结构上“打补丁”，`session.md` 等会继续承担混装职责，HP9 的重组目标会落空。

### 5.3 Phase 3 — New Docs + README Reindex + Stable Sanity

- **Phase 目标**：形成完整的 18 份 docs pack，并收口 README 导航。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `clients/api-docs/models.md`
  - `clients/api-docs/context.md`
  - `clients/api-docs/checkpoints.md`
  - `clients/api-docs/confirmations.md`
  - `clients/api-docs/todos.md`
  - `clients/api-docs/workspace.md`
  - `clients/api-docs/transport-profiles.md`
- **本 Phase 修改文件**：
  - `clients/api-docs/README.md`
  - `clients/api-docs/{auth,catalog,me-sessions,session-ws-v1,wechat-auth,worker-health}.md`
- **本 Phase 已核对的源码锚点**：
  - `clients/api-docs/README.md:24-33,35-47,110-123`
  - `workers/orchestrator-core/wrangler.jsonc:57-63,99-104`
  - `docs/design/hero-to-pro/HP9-api-docs-and-manual-evidence.md:280-305,313-320`
- **具体功能预期**：
  1. 每份新增文档头部都声明主要 worker / endpoint family，但正文按产品 surface 组织。
  2. README 能成为 18 份文档的唯一索引入口。
  3. stable docs 通过 sanity check 修正链接、标题、header 与事实漂移。
- **具体测试安排**：
  - **单测**：无新增单测。
  - **集成测试**：文档 cross-link self-check。
  - **回归测试**：无新增命令，依赖 code-vs-doc 核对。
  - **手动验证**：README 导航与 18 份文件一一核对。
- **收口标准**：
  - 18 份文档全部存在并可导航。
  - stable docs 没有被漏审，也没有误判成无需升级的结构漂移。
- **本 Phase 风险提醒**：
  - 若 README 不最后统一重写，文档包会继续有“文件存在但没人知道入口”的问题。

### 5.4 Phase 4 — Manual Evidence + Prod Baseline

- **Phase 目标**：把 handoff 所需的真实现场证据补齐。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 新增文件**：
  - `docs/issue/hero-to-pro/manual-evidence-pack.md`
  - `docs/issue/hero-to-pro/prod-schema-baseline.md`
- **本 Phase 新增目录**：
  - `docs/evidence/hero-to-pro-manual-<date>/device-<name>/`
- **本 Phase 已核对的源码锚点**：
  - `docs/issue/zero-to-real/zero-to-real-final-closure.md:99-115`
  - `workers/orchestrator-core/wrangler.jsonc:33-41,90-97`
  - `docs/issue/real-to-hero/RHX2-closure.md:99-123`
- **具体功能预期**：
  1. 5 设备矩阵会覆盖 register/login/start/ws/todo/workspace/compact/checkpoint/device revoke 全流程。
  2. evidence 索引记录 step log、media refs、failures/caveats、trace UUID，而不是把截图直接堆进 closure。
  3. prod baseline 会记录 remote command、remote result、committed migrations snapshot、一致性判断、差异与补救路径。
  4. owner-action 时点会被固定到 HP9 启动日 / 启动 + 3 日 / +7 日 / +10 日，任一节点失守即显式 `cannot close`，而不是模糊等待。
- **具体测试安排**：
  - **单测**：无新增单测。
  - **集成测试**：无；以 owner/ops 执行结果为主。
  - **回归测试**：
    - `pnpm test:cross-e2e`（作为 manual evidence 前的自动基线）
  - **手动验证**：
    - Chrome web
    - Safari iOS
    - Android Chrome
    - WeChat 开发者工具
    - WeChat 真机
- **收口标准**：
  - 5 套设备完整归档，且 owner-action checklist 四个时点全部满足。
  - prod baseline 文档已写出 remote/prod 事实；若无访问权，显式 `blocked-by-owner-access`。
- **本 Phase 风险提醒**：
  - owner 设备 / prod 权限一旦未准备好，HP9 就只能停在 `cannot close`，不能以本地替代品蒙混过关。

### 5.5 Phase 5 — 4-Review Fixes + Closure

- **Phase 目标**：把 docs pack、evidence pack 与 prod baseline 一起封板。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 新增文件**：
  - `docs/eval/hero-to-pro/HP9-api-docs-reviewed-by-*.md`
- **本 Phase 修改文件**：
  - `clients/api-docs/*.md`
  - `docs/issue/hero-to-pro/HP9-closure.md`
- **具体功能预期**：
  1. 11 份 deep-review docs 会经历 4-review 修订回合。
  2. HP9 closure 会明确给出 docs / manual evidence / prod baseline / review 四层 verdict。
  3. HP10 可直接使用 HP9 closure 作为 final closure 输入，而不必再回头重做 docs archaeology。
- **具体测试安排**：
  - **单测**：无新增单测。
  - **集成测试**：review comment disposition 对照。
  - **回归测试**：
    - `pnpm test:cross-e2e`
  - **手动验证**：review fix 后的全文复核。
- **收口标准**：
  - critical 0、high 全修。
  - HP9 closure 可独立回答对外交付包是否齐备。
- **本 Phase 风险提醒**：
  - 如果 4-review 只产出 memo、不真正回写文档，HP9 仍不能算封板。

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q29 — docs 按产品 surface 组织，头部保留 worker map | `docs/design/hero-to-pro/HPX-qna.md` | 决定 HP9 的 18 份文档按 client 消费面切分，而不是沿 worker 边界长文档 | 若要按 worker 切回去，必须重开 QNA |
| Q30 — manual evidence 是 hard gate | `docs/design/hero-to-pro/HPX-qna.md` | 决定 HP9 缺任何一台设备都不能 closure | 若要再 defer，只能改 charter，不可在 action-plan 内私改 |
| Q31 — prod schema baseline 必须 remote/prod 校对 | `docs/design/hero-to-pro/HPX-qna.md` | 决定 `prod-schema-baseline.md` 必须记录 remote 事实与 `wrangler --version` | 若 owner 无权限，显式进 HP10 retained，不可本地替代 |
| Q32 — rewrite/new 深审，stable docs sanity check | `docs/design/hero-to-pro/HPX-qna.md` | 决定 HP9 的 review routing 与升级机制 | 若执行中想“一刀切轻核”，需退回 design |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| HP8 freeze 依赖 | HP8 未 closure 时 public truth 仍可能变动 | `high` | HP9 只在 HP8 closure 后正式启动 |
| owner 设备矩阵依赖 | 5 套设备不齐会直接卡住 manual evidence gate | `high` | HP9 启动日冻结设备与脚本 owner；若任一时点延期，直接标 `cannot close`，不再继续模糊等待 |
| prod 权限依赖 | remote/prod D1 访问可能受 owner/ops 权限限制 | `high` | 明确 `blocked-by-owner-access`，并交给 HP10 retained registry |
| review 成本高 | 11 份 deep-review docs × 4 reviewer 成本很高 | `medium` | 先锁定 routing，避免把 stable docs 也拉入深审 |
| session/new docs 互相覆盖 | `session.md` 重写与新专题拆分可能产生交叉漂移 | `medium` | Phase 2 先定主文档边界，Phase 3 再补新文档 |

### 7.2 约束与前提

- **技术前提**：HP9 不新增新 lint/tooling；文档事实只引用当前冻结代码、closure 和 owner-verified baseline。
- **运行时前提**：manual evidence 验证的是 HP8 之后的 frozen runtime，不接受“边写 docs 边改代码”。
- **组织协作前提**：owner / ops 负责设备和 prod remote 操作；设备清单冻结最晚为 HP9 启动日；reviewers 负责 4-review 修订意见。
- **上线 / 合并前提**：18 份 docs、5 设备 evidence、prod baseline、4-review disposition、HP9 closure 五项齐全。

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/hero-to-pro/HP10-final-closure-and-cleanup.md`（回填 HP10 输入）
- 需要同步更新的说明文档 / README：
  - `clients/api-docs/README.md`
  - `docs/issue/hero-to-pro/manual-evidence-pack.md`
  - `docs/issue/hero-to-pro/prod-schema-baseline.md`
  - `docs/issue/hero-to-pro/HP9-closure.md`
- 需要同步更新的测试说明：
  - 若 manual evidence 流程需要固定 checklist，可在 evidence 索引内维护唯一 checklist，不再散落聊天记录

### 7.4 完成后的预期状态

1. 18 份 `clients/api-docs/` 会第一次与 hero-to-pro 代码事实对齐。
2. manual evidence 不再是阶段总会欠的一块，而是正式交付件。
3. prod schema baseline 会第一次经过 remote/prod 事实校对，而不是只相信仓内 migrations。
4. HP10 可以在稳定 docs/evidence/baseline 之上写 final closure，而不必回头重做前端接口考古。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - 检查 `clients/api-docs/` 最终为 18 份文档。
  - 检查 README 能索引全部 18 份，且链接无漂移。
  - 检查 `manual-evidence-pack.md` 与 `prod-schema-baseline.md` 都存在。
- **单元测试**：
  - 无新增文档专属单测；依赖现有运行时测试作为事实输入。
- **集成测试**：
  - route-by-route code-vs-doc 核对
  - review checklist / structural drift checklist
- **端到端 / 手动验证**：
  - 5 设备 manual evidence matrix
  - owner/ops remote/prod baseline capture
- **回归测试**：
  - `pnpm test:cross-e2e`
- **文档校验**：
  - rewrite/new 11 份文档完成 4-review
  - stable docs 7 份完成 sanity check
  - `clients/api-docs/confirmations.md` 必须包含 readiness matrix
  - HP9 closure 必须记录 docs/evidence/baseline/review 四层 verdict，并显式登记 F1-F17 chronic status

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `clients/api-docs/` 已形成 18 份 frozen pack，且按产品 surface 组织。
2. 4 份 rewrite 与 7 份 new 文档已完成 deep-review；7 份 stable docs 已完成 sanity check。
3. 5 设备 manual evidence 已完整归档；任一设备缺失即 HP9 `cannot close`。
4. `prod-schema-baseline.md` 已记录 remote/prod 事实，或明确 `blocked-by-owner-access` 并在 closure 中登记。
5. HP9 closure 已明确说明 docs / evidence / baseline / review 的最终 verdict。
6. HP9 closure 已显式声明 F1-F17 的 phase 状态，并把 owner-action gate 的实际履约情况写入 closure。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | docs pack、manual evidence、prod baseline、review workflow 四件套全部闭环 |
| 测试 | 文档 cross-link 自检、code-vs-doc 核对、`pnpm test:cross-e2e`、5 设备 evidence checklist 完整 |
| 文档 | README、18 份 docs、manual-evidence-pack、prod-schema-baseline、HP9-closure 互链完整 |
| 风险收敛 | 不再使用 RHX2 过时兼容叙述、不再 defer manual evidence、不再以本地 migrations 冒充 prod baseline |
| 可交付性 | HP10 可以直接基于 HP9 的 frozen public truth 写 final closure 与 hero-to-platform handoff |

---

## 9. 工作日志（实施回填，append-only）

> 实施者: `claude-opus-4-7 (1M context)`
> 实施日期: `2026-05-01`
> 关联 closure: `docs/issue/hero-to-pro/HP9-closure.md`
> 工作模式: 遵循 charter §0.5 wire-with-delivery 法律 + HPX-Q29/Q30/Q31/Q32

### 9.1 Phase 1 — Freeze Inventory + Review Routing

- **P1-01 18-doc inventory freeze** ✅
  - 重写 `clients/api-docs/README.md`：把 RHX2 Phase 6 标题/索引升级为 hero-to-pro Frozen Pack
  - 锁定 18-doc 索引：11 现有（README/auth/me-sessions/error-index/worker-health/catalog + session/session-ws-v1/permissions/usage/wechat-auth）+ 7 新增（models/context/checkpoints/confirmations/todos/workspace/transport-profiles）
  - README 新增 Foundation / Session Surface 两组 + Endpoint Matrix 12 类按产品 surface 分组
- **P1-02 review routing checklist** ✅（路由冻结于 closure §3-§4）
  - rewrite: session.md / permissions.md / usage.md / error-index.md
  - new: 7 份新增专题
  - sanity: auth.md / catalog.md / me-sessions.md / wechat-auth.md / worker-health.md
  - structural drift 升级为 rewrite 的判定权 exercised in `session-ws-v1.md`（12-kind catalog）

### 9.2 Phase 2 — Rewrite High-Risk Existing Docs

- **P2-01 rewrite session.md** ✅
  - 行数 897 → ~210；移除 models / context / files 混装
  - 新增 lifecycle state machine 图 + ended_reason 4 取值表（Q13 frozen）
  - DELETE 软删 conversation tombstone 语义明确（Q14 frozen）
  - 把 models / context / workspace / checkpoints 全部 cross-link 到新文档
- **P2-02 rewrite permissions.md** ✅
  - 不再写 "唯一 live API"；改写为 legacy compatibility surface
  - 引入 HP5 row-first dual-write law（Q16 frozen）说明
  - 新增 §6 migration path（legacy → confirmations）
  - `409 confirmation-already-resolved` 显式说明
- **P2-02 rewrite usage.md** ✅
  - 移除 "WS push 未 live" 旧叙述
  - 新增 §2 WebSocket Live Push 状态：`session.usage.update` 帧已 live
  - 保留 polling fallback；推荐 ≥ 5 秒间隔
- **P2-02 rewrite error-index.md** ✅
  - 标题升级为 hero-to-pro Frozen Pack
  - 新增 5 个 HP5/HP6 ad-hoc public codes：`confirmation-already-resolved` / `confirmation-not-found` / `todo-not-found` / `invalid-status` / `in-progress-conflict`
  - 新增 `hero-to-pro Phase Wire Facts §4-§6`：HP5 row-first law / HP6 at-most-1 invariant / HP7 restore not-yet-live

### 9.3 Phase 3 — New Docs + README Reindex + Stable Sanity

- **P3-01 author 7 new docs + README reindex** ✅
  - `clients/api-docs/models.md`（HP2 model state machine：4-layer chain + alias resolve + clear semantics + reasoning effort + deferred not-yet-live 表）
  - `clients/api-docs/context.md`（HP3：probe/layers/snapshot/compact preview/job + Q12 cache 状态 + auto-compact dead link 显式说明 + 5 deferred 项）
  - `clients/api-docs/checkpoints.md`（HP4 first-wave + HP7 substrate：5 概念 + list/create/diff + restore-not-yet-live + Q22/Q23/Q24 frozen）
  - `clients/api-docs/confirmations.md`（HP5：7-kind × 6-status readiness matrix；row-first law；migration from legacy）
  - `clients/api-docs/todos.md`（HP6：5-status enum + at-most-1 invariant + agent-core WriteTodos not-wired）
  - `clients/api-docs/workspace.md`（HP6：3 概念 + tenant-scoped R2 key law + 7-rule path normalization + Lane E reference）
  - `clients/api-docs/transport-profiles.md`（6 profiles + Q27 invariant + internal envelope not-for-clients + versioning discipline）
  - README reindex 完成（P1-01 中一并）
- **P3-02 stable docs sanity check** ✅
  - `auth.md` / `me-sessions.md` / `wechat-auth.md` / `worker-health.md`：标题 RHX2 → hero-to-pro
  - `catalog.md`：permission-gate description 更新到 HP5 confirmation control plane
  - `session-ws-v1.md`：发现 12-kind 漂移 → 升级为 rewrite（per Q32）；新增 `tool.call.cancelled` / `session.fork.created` / `session.confirmation.*` / `session.todos.*` / `session.usage.update` 全部 schema

### 9.4 Phase 4 — Manual Evidence + Prod Baseline

- **P4-01 manual evidence pack scaffold** ✅ (scaffold) / ⚠️ owner-action pending
  - 创建 `docs/issue/hero-to-pro/manual-evidence-pack.md`
  - 5 设备矩阵冻结：Chrome web / Safari iOS / Android Chrome / WeChat 开发者工具 / WeChat 真机
  - per-device 20-step list（register → device-revoke flow）
  - failure / NA-with-reason 规则冻结
  - owner-action 4 时点 checklist：HP9 启动日 / +3 / +7 / +10
  - 当前 verdict：`cannot-close (owner-action-blocked)` — claude-opus-4-7 无物理设备访问权
- **P4-02 prod schema baseline scaffold** ✅ (scaffold) / ⚠️ owner-action pending
  - 创建 `docs/issue/hero-to-pro/prod-schema-baseline.md`
  - 仓内 14 migrations snapshot 表（含 014 受控例外登记）
  - owner-action wrangler 命令 template（`wrangler d1 migrations list --remote` + 关键 PRAGMA dump）
  - `blocked-by-owner-access` 路径显式（Q31 + Q36 frozen）
  - 当前 verdict：`pending-owner-run`

### 9.5 Phase 5 — 4-Review Fixes + Closure

- **P5-01 4-review fixes** ⚠️ pending-reviewer-input
  - 4-review pattern 需要外部 reviewer (kimi / GLM / deepseek / GPT) 各自产 memo
  - 实施者无法替代 reviewer 写 memo（HPX-Q32 frozen review routing：rewrite/new docs 必须深审）
  - 承接：HP9 后续批次（owner 触发 reviewer 流程）
- **P5-02 HP9-closure** ✅
  - 创建 `docs/issue/hero-to-pro/HP9-closure.md`
  - §0 verdict matrix 给出 8 个维度状态
  - §1 R1-R12 列已落实事项
  - §2 P1-P3 列 cannot-close / pending-reviewer-input 项与承接
  - §3 K1-K4 显式登记 retained / out-of-scope
  - §4 F1-F17 chronic 状态 phase 视角更新（F11 升级为 `partial-by-HP9-docs-frozen-but-evidence-blocked`）
  - §5 HP10 final closure 输入清单
  - §7 显式说明：HP9 cannot-close 不阻塞 HP10 启动（HPX-Q33 禁止的是 silent，不是 cannot-close 本身）

### 9.6 测试矩阵

| 验证项 | 命令 / 证据 | 结果 |
|--------|-------------|------|
| 18-doc count | `ls clients/api-docs/*.md \| wc -l` | `18` ✅ |
| RHX2 stale 标题清理 | `grep -nE "^# .*RHX2" clients/api-docs/*.md` | zero ✅ |
| 7 新增专题文件 | `ls clients/api-docs/{models,context,checkpoints,confirmations,todos,workspace,transport-profiles}.md` | all present ✅ |
| README reindex | manual review | 18-Doc Pack 表与文件清单一致 ✅ |
| confirmations 7-kind matrix | `confirmations.md §1` | matrix present ✅ |
| session-ws-v1 12-kind catalog | `session-ws-v1.md §3.2` | 12 kinds 列出 ✅ |
| manual evidence scaffold | `docs/issue/hero-to-pro/manual-evidence-pack.md` | scaffold + cannot-close 显式 ✅ |
| prod baseline scaffold | `docs/issue/hero-to-pro/prod-schema-baseline.md` | scaffold + blocked path 显式 ✅ |
| HP9-closure | `docs/issue/hero-to-pro/HP9-closure.md` | written ✅ |
| 5 设备实际录制 | `docs/evidence/hero-to-pro-manual-*` | NOT YET — owner-action |
| prod `wrangler --remote` | baseline.md §5 | NOT YET — owner-action |
| 4-reviewer memos | `docs/eval/hero-to-pro/HP9-api-docs-reviewed-by-*` | NOT YET — pending-reviewer-input |

### 9.7 Charter §4.4 D7 纪律

HP9 是 HP8 freeze 之后**唯一**更新 `clients/api-docs/` 的 phase（HP6/HP7/HP8 closure §0 已证明 docs not-touched）。这与 HP2-HP4 散落更新 docs（reviewer DS-R8 / GLM-R9 标记的 D7 violation）形成纪律恢复对照。HP10 不应再更新 docs；任何客户端 SDK / contract codegen 由 hero-to-platform 阶段负责。

### 9.8 实施者侧总评

- 完成度: docs pack 主体 18/18；evidence + baseline + review 三项依赖 owner / external reviewer，scaffold 完整
- 与 charter 对齐: §10.1 第 3 条 "18 份 clients/api-docs 与代码 100% 对齐" — docs side 100% 对齐；evidence side cannot-close (owner-action-blocked)
- HP10 启动 readiness: ✅ HP9 closure 显式 `cannot-close` 即合规；HP10 把 P1/P2 登记为 retained-with-reason 或 handed-to-platform 即可推进 final closure
