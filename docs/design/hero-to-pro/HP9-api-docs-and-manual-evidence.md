# Nano-Agent 功能簇设计

> 功能簇: `HP9 API Docs + Manual Evidence`
> 讨论日期: `2026-04-30`
> 讨论者: `Owner + GPT-5.4`
> 关联基线文档:
> - `docs/charter/plan-hero-to-pro.md`
> 关联源码锚点:
> - `clients/api-docs/README.md:1-33,84-123`
> - `clients/api-docs/session.md:1-27,45-82`
> - `clients/api-docs/permissions.md:10-28,177-186`
> - `clients/api-docs/usage.md:86-107`
> - `clients/api-docs/error-index.md:1-12,75-120,197-201`
> - `package.json:7-17`
> - `workers/orchestrator-core/wrangler.jsonc:33-41,90-97`
> - `docs/issue/zero-to-real/zero-to-real-final-closure.md:99-105`
> - `docs/issue/real-to-hero/RHX2-closure.md:1-9,99-123`
> 关联 QNA / 决策登记:
> - `docs/design/hero-to-pro/HPX-qna.md`（待所有 hero-to-pro 设计文件落地后统一汇总；本设计先冻结 HP9 收口结论）
> 文档状态: `reviewed`

---

## 0. 背景与前置约束

HP9 面对的不是“从零开始写文档”，而是把当前已经部分存在、但仍明显偏 RHX2 阶段的文档库和证据习惯，升级成 hero-to-pro 阶段的冻结包：

1. 当前 `clients/api-docs/` 已经有一套前端可读的 public doc library，但它仍然以 `auth / me-sessions / session / session-ws-v1 / permissions / usage / catalog / worker-health / wechat-auth / error-index` 这一组为中心，README 也是围绕这 10 份专题文档做索引（`clients/api-docs/README.md:84-123`）。连同 README 本身，当前实际是 **11 份** 文档，而不是 hero-to-pro 目标态的 18 份。
2. `session.md` 仍然把 models/context/files 混装在同一份文档里，`permissions.md` 也仍明确写着“WS round-trip 未 live”，`usage.md` 明确写着 `session.usage.update` 还未 live push；这说明当前 docs pack 仍然带着 RHX2 的阶段性妥协，而不是 HP2-HP7 之后的目标文档结构（`clients/api-docs/session.md:1-27,45-82`; `clients/api-docs/permissions.md:10-28,177-186`; `clients/api-docs/usage.md:103-107`）。
3. `error-index.md` 已经比早期成熟得多：它不仅列了 facade codes，还列了 ad-hoc public codes、WS `system.error`、分类与 dedupe 规则，这说明 HP9 不应“重写一切”，而应该把已经成熟的错误索引继续升级成完整文档包的一部分（`clients/api-docs/error-index.md:1-12,75-120,197-201`）。
4. 手工证据仍然是历史 chronic gap。zero-to-real final closure 明确把 manual browser / 微信开发者工具 / 真机证据列为“仍留给下一阶段的事”，这正是 HP9 里 manual evidence pack 必须成为 hard gate 的原因（`docs/issue/zero-to-real/zero-to-real-final-closure.md:99-105`）。
5. 仓库目前也还没有 root-level 文档验证/基线脚本；`package.json` 只有测试与少量 check 脚本，没有 “api docs freeze / evidence index / prod schema baseline” 级别的 helper（`package.json:7-17`）。
6. prod schema baseline 也还没有在仓内形成固定产物。现在能看到的是 orchestrator-core `wrangler.jsonc` 已明确 `migrations_dir: "migrations"`，但这只能说明“本地迁移目录存在”，不能替代 remote/prod baseline 事实（`workers/orchestrator-core/wrangler.jsonc:33-41,90-97`）。

- **项目定位回顾**：HP9 负责的不是“再补几个 markdown”，而是把 API docs、manual evidence、prod schema baseline 三件事一起冻结成可对外 handoff 的交付包。
- **本次讨论的前置共识**：
  - HP9 必须建立在 HP8 代码冻结之后；否则文档永远追着代码跑。
  - 当前 `clients/api-docs/` 并不是空白，而是 11 份已有基线；HP9 要在其上重组和扩展。
  - manual evidence 是 hard gate，不是“有空再补的 nice-to-have”。
  - prod schema baseline 是 owner-action 事实校对，不是本地 `migrations/` 的替身。
- **本设计必须回答的问题**：
  - API docs 应该按“前端关心的产品 surface”还是按“worker 内部模块边界”来切文档？
  - 哪些现有文档需要重写，哪些只需要 sanity check？
  - manual evidence pack 的目录、索引与场景矩阵应如何固定？
  - prod schema baseline 与文档冻结的先后顺序是什么？
- **显式排除的讨论范围**：
  - WeChat miniprogram 的完整产品化适配
  - 新 API / 新 runtime 功能
  - hero-to-platform 的 inherited issues 设计

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`HP9 API Docs + Manual Evidence`
- **一句话定义**：`把现有 clients/api-docs、手工多设备验证证据、以及 prod schema baseline 收敛成一个能代表 hero-to-pro 冻结版事实的交付包。`
- **边界描述**：这个功能簇**包含** `clients/api-docs/` 重组与扩展、manual evidence pack、prod schema baseline、review/freeze 流程；**不包含** 新客户端适配、新 API 开发、hero-to-platform 规划。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| api docs pack | `clients/api-docs/` 下供前端/集成方使用的文档库 | 以 public surface 为中心 |
| rewrite | 需要按新事实重写主体结构的文档 | 不是只改几处字段 |
| sanity check | 只做事实核对与小修，不重切结构 | 适用于稳定路由 |
| manual evidence pack | 多设备手工验证的录屏/截图/日志归档 | 是 hard gate |
| prod schema baseline | prod remote D1 实际 schema 与仓内 migrations 的对照记录 | 不是本地迁移目录 |
| documentation freeze | 代码停止变化后再写最终文档 | HP9 的前置 gate |

### 1.2 参考源码与现状锚点

- `clients/api-docs/README.md:84-123` — 当前 api docs index 仍是 10 份主题文档 + README 自身，共 11 份。
- `clients/api-docs/session.md:1-27,45-82` — `session.md` 当前混装了 models/context/files，说明结构仍偏 RHX2 阶段。
- `clients/api-docs/permissions.md:10-28,177-186` — permissions 文档仍然以“HTTP 替代 path / WS 未 live”的兼容层视角书写。
- `clients/api-docs/usage.md:103-107` — usage 文档明确写出 WS live push 仍未 live，说明它需要在 HP9 重新核实而非原样继承。
- `clients/api-docs/error-index.md:1-12,75-120,197-201` — error-index 已经具备比较成熟的索引职责，可作为 HP9 的稳定核心之一。
- `docs/issue/zero-to-real/zero-to-real-final-closure.md:99-105` — manual browser / 微信开发者工具 / 真机证据是历史遗留硬 gap。
- `docs/issue/real-to-hero/RHX2-closure.md:1-9,99-123` — 当前 repo 已经有“closure 绑定 smoke/evidence artifact”的做法，可以作为 HP9 evidence pack 的组织 precedent。
- `package.json:7-17` 与 `workers/orchestrator-core/wrangler.jsonc:33-41,90-97` — 当前还没有 root helper 来产出 doc freeze / prod schema baseline；wrangler 只表明 migrations dir 位置。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- HP9 在整体架构里扮演 **public truth packaging owner**。
- 它服务于：
  - client / frontend / integration 方的接口消费
  - owner 的多设备人工验收
  - HP10 final closure 的证据与 handoff
  - prod schema 与文档事实的一致性确认
- 它依赖：
  - HP8 Documentation Freeze Gate
  - 当前 `clients/api-docs` 基线
  - owner 的多设备/manual/prod remote 配合
  - orchestrator-core migrations / wrangler remote 环境
- 它被谁依赖：
  - HP10 final closure
  - future clients/web 与 wechat 的独立适配专项
  - external integrator / frontend handoff

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| HP8 hardening | HP8 -> HP9 | 强 | HP8 不 freeze，HP9 文档就不应定稿 |
| clients/api-docs | HP9 <-> docs | 强 | HP9 的主要载体 |
| owner manual ops | owner -> HP9 | 强 | 5 套设备 evidence 与 prod baseline 都需 owner 配合 |
| HP10 final closure | HP9 -> HP10 | 强 | HP10 要直接消费 HP9 的文档与证据包 |
| clients/web / wechat | HP9 -> client teams | 中 | HP9 提供冻结接口事实，但不负责客户端产品化 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`HP9 API Docs + Manual Evidence` 是 **对外接口真相与人工验收证据的统一打包 owner**，负责 **把现有 api docs、手工多设备证据和 prod schema 对照统一冻结成一份可 handoff 的交付包**，对上游提供 **文档化、证据化、可核实的 public truth**，对下游要求 **HP10 final closure 不再建立在缺设备、缺现场、缺 prod 对照的模糊前提上**。"

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| 继续把 models/context/files 混在 `session.md` | 当前 RHX2 文档结构 | phase 增长后可读性已经不足 | 否 |
| 把 manual evidence 当作 closure 附件而非 hard gate | zero-to-real 历史 gap | 会再次让证据拖到下一阶段 | 否 |
| 用本地 migrations 目录代替 prod baseline | wrangler local config 已在 | 无法证明 prod remote 真实状态 | 否 |
| 在代码未 freeze 时就开始最终改写文档 | 文档总想抢跑 | 会让 HP9 变成追逐变化的 moving target | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段 / 文档入口) | 第一版行为 | 未来可能的演进方向 |
|--------|--------------------------------------------------|------------|---------------------|
| api-docs 目录结构 | `clients/api-docs/*.md` | 18 份冻结包 | future 可扩 generated schema index |
| manual evidence index | `docs/issue/hero-to-pro/manual-evidence-pack.md` | 5 设备统一索引 | future 可扩更多地区/设备矩阵 |
| prod baseline record | `docs/issue/hero-to-pro/prod-schema-baseline.md` | remote list/diff/dump 记录 | future 可接自动 diff 工具 |
| review workflow | per-doc review checklist | rewrite 与 sanity check 分级 | future 可扩自动 lint / contract smoke |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：manual evidence pack 与客户端产品化开发。
- **解耦原因**：HP9 只要求“验证当前冻结版事实”，不要求完成 web/wechat 的最终产品适配。
- **依赖边界**：evidence pack 记录的是 frozen API truth，不以“客户端已经 fully productized”为前提。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：api docs、manual evidence、prod schema baseline。
- **聚合形式**：统一收敛到 `clients/api-docs/` + `docs/issue/hero-to-pro/` 证据索引。
- **为什么不能分散**：如果接口文档在一处、手工录屏在另一处、prod schema 结论只停留在命令行聊天里，HP10 根本无法做严格收口。

---

## 4. 参考实现 / 历史 precedent 对比

> 本节 precedent **只接受 `context/` 与当前仓库源码锚点**。

### 4.1 当前仓库的 precedent / 反例

- **实现概要**：当前仓库已经有一个能工作的 api docs baseline，也已经在 RHX2 closure 中建立了“closure 绑定 smoke/evidence artifact”的组织习惯；但 manual evidence 仍是上阶段显式遗留缺口（`clients/api-docs/README.md:84-123`; `docs/issue/real-to-hero/RHX2-closure.md:1-9,99-123`; `docs/issue/zero-to-real/zero-to-real-final-closure.md:99-105`）。
- **亮点**：
  - 文档库不是空白，错误索引也已有较强形态
  - 仓内已经接受“closure + evidence artifact”配套方式
- **值得借鉴**：
  - 延续 README 索引式文档包
  - 延续 closure / evidence 文件的显式挂接
- **不打算照抄的地方**：
  - 继续让 `session.md` 承担过多 surface
  - 继续把 manual evidence 延后到下一阶段

### 4.2 外部 precedent

- **实现概要**：本批次未直接采用 `context/` 外部 agent 的 docs/evidence packaging 源码。
- **亮点**：
  - `N/A`
- **值得借鉴**：
  - `N/A`
- **不打算照抄的地方**：
  - `N/A`

### 4.3 横向对比速查表

| 维度 | 当前 nano-agent | HP9 倾向 |
|------|-----------------|----------|
| api docs 数量/结构 | 11 份，仍偏 RHX2 结构 | 扩到 18 份，按产品 surface 重组 |
| 错误文档 | 已较成熟 | 继续作为稳定核心 |
| manual evidence | 历史 gap | 升级成 hard gate |
| prod schema baseline | 尚无固定产物 | 加 owner-verified baseline 文档 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1]** `clients/api-docs/` 冻结为 18 份文档包。
- **[S2]** rewrite / sanity-check 分级流程。
- **[S3]** 5 设备 manual evidence pack 与索引。
- **[S4]** prod schema baseline 文档。
- **[S5]** 文档冻结与 review gate。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1]** WeChat miniprogram 最终产品化适配 —— 留给客户端专项；重评条件：独立客户端计划启动。
- **[O2]** 新 API surface 的继续扩张 —— 不属于 HP9；重评条件：新 charter。
- **[O3]** 自动化 SDK 生成 —— 留给 hero-to-platform；重评条件：下一阶段 contract 工程化启动。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| `session.md` 是否继续承担 models/context/files | out-of-scope | 结构已过载 | HP9 拆成独立专题文档 |
| manual evidence 是否能缺 1 台设备先 partial close | out-of-scope | 这会重演 zero-to-real gap | HP9 必须完整 5 套 |
| prod baseline 是否可只看 preview | out-of-scope | HP9 目标是 prod remote 事实 | HP9 owner-action gate |
| 4-review pattern 是否对 18 份全量执行 | defer | rewrite 与新增文档更需要深审 | HP9 分级 review 策略 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **按产品 surface 重组文档包**，而不是 **继续沿用 RHX2 的混装结构**
   - **为什么**：`session.md` 当前已经同时覆盖 models/context/files，继续追加只会更难用。
   - **我们接受的代价**：需要一次有组织的目录重切和 cross-link 更新。
   - **未来重评条件**：无。

2. **取舍 2**：我们选择 **manual evidence 作为 hard gate**，而不是 **继续放进“下一阶段再补”的 backlog**
   - **为什么**：zero-to-real 已经证明这样只会永久拖延。
   - **我们接受的代价**：HP9 的 closure 会更强依赖 owner 的线下操作。
   - **未来重评条件**：无。

3. **取舍 3**：我们选择 **prod schema baseline 独立成文档**，而不是 **把它混在 HP9 closure 或 runbook 里**
   - **为什么**：schema baseline 是后续所有 closure 与 handoff 的共同前提。
   - **我们接受的代价**：多一份 owner-action 文档。
   - **未来重评条件**：当 remote schema diff 工具自动化后。

4. **取舍 4**：我们选择 **rewrite / sanity-check 分级 review**，而不是 **对全部 18 份使用同样强度**
   - **为什么**：并非所有文档的风险相同；新/重写文档更需要深审。
   - **我们接受的代价**：需要在 HP9 一开始先冻结 review 分级。
   - **未来重评条件**：文档库规模显著扩大时。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| 文档在代码 freeze 前开始重写 | HP8 未真 closure | 文档与代码再次漂移 | HP9 只在 HP8 freeze 后启动 |
| manual evidence 缺设备 | owner 设备准备不足 | HP9 无法合法 closure | 设备矩阵先锁定，再开始执行 |
| prod baseline 只做命令输出不成文 | owner 只跑 wrangler 命令 | HP10 无法复核 | baseline 必须落成 markdown 文档 |
| review 范围过大导致节奏失控 | 18 份一刀切深审 | HP9 延迟、噪音上升 | rewrite/new docs 深审，stable docs sanity check |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：以后不必在 session/permissions/error-index 之间反复拼图，接口文档会按产品 surface 直接给到。
- **对 nano-agent 的长期演进**：HP9 把“文档、设备证据、prod schema”第一次绑成同一份 handoff 包。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：没有 HP9，hero-to-pro 再完整也难以被前端、集成方和 closure 审查真正消费。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | api docs pack freeze | 18 份 `clients/api-docs/` 文档包 | ✅ 前端接口文档第一次形成阶段冻结版 |
| F2 | rewrite / sanity-check routing | 重写与轻核对的分级流程 | ✅ 审查强度与风险匹配 |
| F3 | manual evidence pack | 5 设备手工验证与索引 | ✅ 历史 manual gap 第一次被硬闸收口 |
| F4 | prod schema baseline | remote/prod D1 baseline 文档 | ✅ 文档事实不再脱离 prod 真实 schema |
| F5 | documentation freeze gate | freeze / review / closure 顺序 | ✅ HP10 可基于稳定 docs pack 收口 |

### 7.2 详细阐述

#### F1: api docs pack freeze

- **输入**：当前 11 份 api docs 基线、HP2-HP8 冻结代码事实
- **输出**：18 份文档包
- **主要调用者**：clients/web、clients/wechat-miniprogram、外部集成、HP10 final closure
- **核心逻辑**：
  - 现有 11 份保留体系：
    - README
    - auth
    - catalog
    - error-index
    - me-sessions
    - permissions
    - session
    - session-ws-v1
    - usage
    - wechat-auth
    - worker-health
  - HP9 目标新增 7 份：
    - `models.md`
    - `context.md`
    - `checkpoints.md`
    - `confirmations.md`
    - `todos.md`
    - `workspace.md`
    - `transport-profiles.md`
  - 同时把 `session.md` 从“混装入口”收缩回 session lifecycle 主文档
- **边界情况**：
  - 任何文档若引用 HP8 之后已废弃或未 freeze 的 path，必须退回改写
  - README 必须与 18 份最终索引严格一致
- **一句话收口目标**：✅ **API docs 第一次覆盖 hero-to-pro 目标 surface，而不是停留在 RHX2 快照**。

#### F2: rewrite / sanity-check routing

- **输入**：当前 11 份文档现状与 HP2-HP8 新事实
- **输出**：每份文档的 review 强度分类
- **主要调用者**：doc authors、reviewers、HP9 closure
- **核心逻辑**：
  - 第一版分类冻结为：
    - **rewrite**：`session.md`, `permissions.md`, `usage.md`, `error-index.md`
    - **sanity check**：其余现有文档
    - **new**：7 份新增文档
  - rewrite/new 文档走深审；sanity-check 文档只做事实核对与链接修正
- **边界情况**：
  - 若 sanity-check 文档在扫描中发现结构已过时，可升级为 rewrite
  - 不允许因为 review 成本高而降级 new/rewrite 的审查强度
- **一句话收口目标**：✅ **文档工作量第一次按真实风险分级，而不是一刀切**。

#### F3: manual evidence pack

- **输入**：5 套设备上的 register/login/start/ws/todo/workspace/compact/checkpoint/device-revoke 流程
- **输出**：`docs/evidence/...` artifact + `manual-evidence-pack.md` 索引
- **主要调用者**：owner、reviewers、HP10 closure
- **核心逻辑**：
  - 设备矩阵冻结为：
    1. Chrome web
    2. Safari iOS
    3. Android Chrome
    4. WeChat 开发者工具
    5. WeChat 真机
  - 统一 evidence 目录建议形态：
    - `docs/evidence/hero-to-pro-manual-<date>/device-<name>/`
    - 每设备至少包含：
      - step log
      - screenshot / clip references
      - failures / caveats
      - trace UUID references
  - `docs/issue/hero-to-pro/manual-evidence-pack.md` 负责做总索引，而不是把所有截图直接堆在 closure 里
- **边界情况**：
  - 缺 1 台设备即不可 closure
  - 如果某步因产品界限不适用，必须写 `not-applicable-with-reason`
- **一句话收口目标**：✅ **manual evidence 从“历史总缺一块”升级为正式交付件**。

#### F4: prod schema baseline

- **输入**：仓内 committed migrations + prod remote `wrangler d1 migrations list ... --remote`
- **输出**：`prod-schema-baseline.md`
- **主要调用者**：owner、reviewers、HP10 final closure、hero-to-platform
- **核心逻辑**：
  - baseline 文档至少记录：
    - remote command
    - remote result
    - committed migrations snapshot
    - 是否一致
    - 若不一致，差异项与补救路径
  - 不允许拿 preview 结果代替 prod
  - 不允许只保留命令输出、不形成文档
- **边界情况**：
  - 若 prod 因权限不可读，必须明确标 `blocked-by-owner-access`
  - 若存在 controlled exception migration，也必须显式登记
- **一句话收口目标**：✅ **HP9 之后，schema 事实第一次经过 prod remote 校对而不是只相信仓内 migrations**。

#### F5: documentation freeze gate

- **输入**：HP8 closure、rewrite/new docs、manual evidence、prod baseline
- **输出**：HP9 closure-ready 状态
- **主要调用者**：HP10 final closure
- **核心逻辑**：
  - 冻结顺序固定为：
    1. HP8 code freeze
    2. 重写/新增 docs
    3. sanity-check docs
    4. manual evidence pack
    5. prod schema baseline
    6. review & fix
    7. HP9 closure
  - 只有完成 1-6，HP9 才能宣称完成
- **边界情况**：
  - 若 manual evidence / prod baseline 缺任一项，HP9 标 `cannot close`
  - 文档 review 发现 critical/high 问题未修，则不能 closure
- **一句话收口目标**：✅ **HP9 的完成定义第一次被 freeze-order 明确锁死**。

### 7.3 非功能性要求与验证策略

- **性能目标**：文档包以人可读性优先，不追求自动生成。
- **可观测性要求**：manual evidence 和 prod baseline 都要有可追溯索引。
- **稳定性要求**：HP9 文档仅基于 freeze 代码事实，不允许边写边变。
- **安全 / 权限要求**：manual evidence 截图/录屏不得泄露 secrets；prod baseline 结果不得贴敏感值。
- **测试覆盖要求**：
  - 文档 cross-link 自检
  - rewrite/new docs 深审
  - sanity-check docs 事实核对
  - manual evidence 5 设备完整性检查
  - prod baseline 一致性记录
- **验证策略**：以“文档事实 + 手工证据 + prod schema”三件套齐备为准。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `N/A` | 本批次未直接采用 mini-agent 源码 | HP9 以当前仓库 docs/evidence 组织为主 | 不再通过二手 markdown 转述 |

### 8.2 来自外部 precedent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `N/A` | 本批次未直接采用 `context/` 外部 agent 的 docs pack 源码 | HP9 以当前仓库 handoff 规则为主 | 保持空缺 |

### 8.3 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `clients/api-docs/README.md:84-123` | 当前已有 11 份 docs pack 索引 | HP9 在其上扩展到 18 份，而不是另起一套目录 |
| `clients/api-docs/session.md:1-27` | session/models/context/files 混装 | 是 HP9 要拆分的直接反例 |
| `clients/api-docs/permissions.md:10-28,177-186` | 仍以 HTTP fallback / WS 未 live 兼容层视角书写 | 说明 HP9 必须用 HP5-HP7 冻结事实重写 |
| `clients/api-docs/usage.md:103-107` | 仍明确 usage WS push 未 live | HP9 必须重新核实而非盲继承 |
| `clients/api-docs/error-index.md:1-12,75-120,197-201` | 错误索引已相对成熟 | 可作为 HP9 文档包的稳定核心 |
| `docs/issue/zero-to-real/zero-to-real-final-closure.md:99-105` | manual evidence 是历史遗留 gap | HP9 不允许再 defer |
| `docs/issue/real-to-hero/RHX2-closure.md:1-9,99-123` | closure 已绑定 spike/evidence artifact | HP9 可以延续“文档 + 证据索引”模式 |
| `package.json:7-17` | 当前没有文档冻结 / prod baseline helper | HP9 需要显式流程而不能指望现成脚本 |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

| Q ID / 决策 ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|----------------|------|----------|----------|------|----------|
| `HP9-D1` | api docs 应按 worker 模块切还是按产品 surface 切？ | HP9 / clients | 按产品 surface 切 | `frozen` | 当前 `session.md` 已因混装 models/context/files 而过载，说明 phase 成熟后必须拆开：`clients/api-docs/session.md:1-27` |
| `HP9-D2` | manual evidence 是否仍允许继续 defer？ | HP9 / HP10 | 否；hard gate | `frozen` | zero-to-real final closure 已把 manual evidence 列为明确遗留 gap，HP9 不应重演：`docs/issue/zero-to-real/zero-to-real-final-closure.md:99-105` |
| `HP9-D3` | prod schema baseline 是否可只依赖仓内 migrations？ | HP9 / HP10 | 否；必须 remote/prod 校对 | `frozen` | `wrangler.jsonc` 只说明 migrations dir，不代表 prod remote 真实状态：`workers/orchestrator-core/wrangler.jsonc:33-41,90-97` |
| `HP9-D4` | 18 份 docs 是否全部走同样强度 review？ | HP9 / reviewers | 否；rewrite/new 深审，稳定 docs sanity check | `frozen` | 当前文档成熟度明显不均：`error-index.md` 已较成熟，而 `session.md` 明显过载：`clients/api-docs/error-index.md:1-12`, `clients/api-docs/session.md:1-27` |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. 18 份 docs pack 的结构与分类已写清。
2. manual evidence 设备矩阵与索引形态已写清。
3. prod schema baseline 的 owner-action 边界已写清。
4. freeze/review/closure 顺序已写清。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - `docs/action-plan/hero-to-pro/HP9-action-plan.md`
- **需要同步更新的设计文档**：
  - `docs/design/hero-to-pro/HP5-confirmation-control-plane.md`
  - `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md`
  - `docs/design/hero-to-pro/HP7-checkpoint-revert.md`
- **实现前额外提醒**：
  - HP9 不应在 HP8 closure 之前提前开始 rewrite；否则最终一定要返工。

---

## 10. Value Verdict

### 10.1 价值结论

`HP9 API Docs + Manual Evidence` 是 hero-to-pro 真正对外可交付的门槛之一。因为没有这一步，前面的所有 runtime/contract 能力都仍停留在“仓内自己知道”的状态。

### 10.2 对 charter 目标的支撑度

它直接支撑：

1. hero-to-pro 对 public truth / manual evidence / prod baseline 的收口要求
2. HP10 final closure 的证据基础
3. 后续客户端专项的接口冻结基线

### 10.3 当前建议

- **建议状态**：`approved-for-action-plan`
- **原因**：当前 docs pack 现状、manual gap、prod baseline 缺口和冻结顺序都已经足够清楚，可以进入 action-plan。
