# Nano-Agent 功能簇设计模板

> 功能簇: `RH6 DO Megafile Decomposition`
> 讨论日期: `2026-04-29`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告:
> - `docs/charter/plan-real-to-hero.md`
> - `docs/charter/review/plan-real-to-hero-reviewed-by-GPT.md`
> 关联 QNA / 决策登记:
> - `docs/design/real-to-hero/RHX-qna.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

RH6 是 real-to-hero 的收口 phase：它不再引入新功能，而是把 RH1-RH5 累积到 `NanoSessionDO` 与 `user-do.ts` 的复杂度切开，同时冻结 `three-layer-truth` 文档，并归档 web / wechat / real-device 的 final evidence。当前两份巨石分别是 2078 行和 2285 行，如果不在 RH6 收口，下一阶段会直接继承维护灾难。

- **项目定位回顾**：RH6 是 `refactor + truth freeze + evidence closure`。
- **本次讨论的前置共识**：
  - RH6 启动前 RH1-RH5 必须都已 merge
  - RH6 不新增新功能 / 新 endpoint / 新 schema
- **本设计必须回答的问题**：
  - 这两份巨石按什么切面拆，才能不制造 import cycle 和重复代码？
  - three-layer truth 文档要冻结哪些边界，才足够给 hero-to-platform 当起跑线？
- **显式排除的讨论范围**：
  - 新产品功能
  - SQLite-DO 引入

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`RH6 DO Megafile Decomposition`
- **一句话定义**：`把 session/user 两个 DO 巨石拆到可维护状态，并冻结三层真相与 final evidence。`
- **边界描述**：这个功能簇**包含** NanoSessionDO 拆分、user-do.ts 按 domain 拆分、`docs/architecture/three-layer-truth.md`、manual evidence pack、残余清理；**不包含**任何新功能面。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| megafile | 承载过多责任、过多 phase 累积逻辑的单文件 | 当前是 `NanoSessionDO` 与 `user-do.ts` |
| three-layer truth | session DO memory / user DO storage / D1 三层职责边界 | RH6 必须文档冻结 |
| evidence pack | web / wechat devtool / real-device 的完整端到端证据 | RH6 final closure 硬闸 |
| cleanup residue | 已废弃 shim / dead import / @deprecated bridge | RH6 同步清理 |

### 1.2 参考调查报告

- `docs/charter/plan-real-to-hero.md` — §7.7、§9.5、§10.1、§12 Q4
- `docs/charter/review/plan-real-to-hero-reviewed-by-GPT.md` — megafile / truth discipline 相关 blocker

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- RH6 在整体架构里扮演 **closure refactor and truth freeze** 的角色。
- 它服务于：
  - long-term maintainability
  - final closure verdict
  - hero-to-platform 启动基线
- 它依赖：
  - RH1-RH5 所有功能都已 merge
  - RHX-qna Q4 关于 evidence 范围的回答
  - 当前两份 megafile 的责任分布现实
- 它被谁依赖：
  - hero-to-platform 所有后续设计
  - real-to-hero final closure 文档

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| RH1-RH5 merged code | RH1-5 -> RH6 | 强 | RH6 必须站在最终代码现实上拆分 |
| architecture docs | RH6 -> docs | 强 | three-layer truth 成为下一阶段起点 |
| evidence pack | RH6 -> closure | 强 | final verdict 直接依赖 evidence 完整性 |
| action-plan cleanup | RH6 <-> residues | 中 | 需要清理前面 phase 遗留 shim |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`RH6 DO Megafile Decomposition` 是 **把功能完成态收束成可维护系统的最后一道工序**，负责 **拆巨石、冻真相、归证据**，对上游提供 **可持续维护的代码边界**，对下游要求 **hero-to-platform 不再从混乱巨石起跑**。"

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| 只把主文件拆薄，不处理 import cycle / 重复代码 | 为了赶 closure 的诱因 | 会制造“假拆分” | 否 |
| 只写 three-layer truth 文档，不核对代码现实 | 文档先行最省事 | 会让真相文档失去约束力 | 否 |
| 只留 happy-path evidence | 节省 owner 时间 | 无法支撑 final closure | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段 / 文档入口) | 第一版行为 | 未来可能的演进方向 |
|--------|--------------------------------------------------|------------|---------------------|
| session-do submodules | `session-do-{bootstrap,identity,ingress,ws,verify,persistence,...}.ts` | 先按职责拆 | 后续继续细化内部类/函数 |
| user-do handlers | `user-do/handlers/*.ts` | 以 domain 切面拆开 | 后续可继续拆 read/write path |
| three-layer truth doc | `docs/architecture/three-layer-truth.md` | 冻结边界与禁令 | 后续为新阶段追加 appendix |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：session DO memory vs user DO storage vs D1
- **解耦原因**：这是整个 real-to-hero 阶段最核心的架构纪律。
- **依赖边界**：三层互相引用可以有，但 ownership 不可混淆、不可复制冷真相。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：会话运行职责、用户 façade 职责、evidence 归档职责
- **聚合形式**：代码拆分与真相文档同步收敛，closure 只接受同批完成
- **为什么不能分散**：如果先拆代码不冻真相，或先冻文档不拆代码，都会留下口径不一致

---

## 4. 参考实现 / 历史 precedent 对比

### 4.1 当前 `NanoSessionDO` 的做法

- **实现概要**：一个文件同时承载 live kernel runner、fetch routing、async waiters、WS lifecycle、verification、persistence 等多层职责。
- **亮点**：
  - 所有关键路径都能在一个文件里追到
- **值得借鉴**：
  - 拆分时要按职责切，不要按“随便抽几段函数”
- **不打算照抄的地方**：
  - 继续往主文件里堆新 phase 逻辑

### 4.2 当前 `user-do.ts` 的做法

- **实现概要**：一个文件同时承担 façade ingress、session lifecycle、history/timeline、permission/elicitation mirror、files、me surface 等多域责任；**ZX5 已有部分 seam 抽出**（`session-lifecycle.ts` / `session-read-model.ts` / `ws-bridge.ts` / `parity-bridge.ts`），types + pure helpers 已分离，但 domain handler 仍堆在 2285 行主文件内。
- **亮点**：
  - façade 责任都集中在一个 owner 文件里
  - 已有 4 个 seam 模块可作为拆分基线，不需要从零起步
- **值得借鉴**：
  - 拆分后仍保留一个薄 façade 入口，而不是把 public contract 打散
  - 在 ZX5 seam 之上**新增** `user-do/handlers/*.ts` 与 infrastructure，**保留**现有 lifecycle/read-model/ws/parity seam，不做重复抽取
- **不打算照抄的地方**：
  - 继续让各个 domain 共居一个 2000+ 行文件
  - 忽视已存在的 seam，把"拆分"从零重做

### 4.3 RH6 的设计倾向

- **实现概要**：先按职责拆文件，再用 truth doc 和 evidence 收口。
- **亮点**：
  - 代码与文档一起冻结
- **值得借鉴**：
  - RH0 已经先切 verify/persistence seam，RH6 在其上完成全拆
- **不打算照抄的地方**：
  - 只以行数达标当作“拆分完成”

### 4.4 横向对比速查表

| 维度 | 当前代码 | RH6 目标 | nano-agent 倾向 |
|------|----------|----------|------------------|
| `NanoSessionDO` | 2078 行巨石 | ≤400 行主入口 + 7 拆分文件 | 职责分层 |
| `user-do.ts` | 2285 行巨石 | ≤500 行 façade + handlers | domain 拆分 |
| truth discipline | 分散在代码和 charter | 单独 architecture doc 冻结 | 可审计 |
| evidence | 零散 | web/wechat/real-device 完整 pack | closure 硬闸 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1]** NanoSessionDO 按职责拆 ≥7 文件 — 包括独立切出 **`session-do-verify`**（覆盖 `nano-session-do.ts:1723-2078` 共 ~355 行的 preview verification subsystem，5 个 verify 方法）与 RH0 已切口的 `session-do-persistence`
- **[S2]** user-do.ts 按 domain 拆 handlers / infrastructure，**在 ZX5 已有 seam（session-lifecycle / session-read-model / ws-bridge / parity-bridge）之上新增**，不重复抽取；同时复核 `user-do.ts:286-500` 的 D1 durable session truth helpers（~215 行）是否独立抽取为 `user-do/durable-truth.ts`
- **[S3]** `docs/architecture/three-layer-truth.md`
- **[S4]** web / wechat-devtool / real-device evidence pack
- **[S5]** dead shim / deprecated bridge / Lane E residue cleanup（覆盖范围：`deploy-fill` 4 个源残留 + 文档残留；`forwardInternalJson @deprecated` 已无活跃调用方；Lane E library import 删除依赖 RH4 sunset）

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1]** 新 endpoint / 新 schema / 新功能 — RH6 是收口 phase；重评条件：无
- **[O2]** SQLite-backed DO — 已在 charter 明确否决；重评条件：hero-to-platform 独立 spike
- **[O3]** 额外产品 polish — RH6 只收口，不扩 scope；重评条件：下阶段

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| 只按行数降下来但有 import cycle | out-of-scope | 假拆分 | RH6 必须避免 |
| three-layer truth 文档与代码不一致 | out-of-scope | 文档失去约束力 | RH6 |
| manual evidence 只有 happy path | out-of-scope | 不满足 closure | RH6 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **按职责拆分** 而不是 **按行数或随机关联度拆文件**
   - **为什么**：只有职责边界清晰，拆分才会真正降低维护成本。
   - **我们接受的代价**：RH6 需要更认真梳理依赖关系，而不只是切粘贴。
   - **未来重评条件**：无。

2. **取舍 2**：我们选择 **同时冻结 three-layer truth 文档** 而不是 **只拆代码**
   - **为什么**：下一阶段最容易再次漂移的是“哪层拥有哪份真相”。
   - **我们接受的代价**：RH6 文档工作量更大。
   - **未来重评条件**：无。

3. **取舍 3**：我们选择 **manual evidence 作为 closure 硬闸** 而不是 **只依赖自动化测试**
   - **为什么**：real-to-hero 的目标是“真实客户端可持续使用”，这件事必须有人机证据。
   - **我们接受的代价**：owner 参与成本更高。
   - **未来重评条件**：无。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| import cycle / duplicated infra | 粗暴拆文件 | 维护性变差；charter §10.3 NOT-成功退出第 1 条已硬纪律化 | **拆前**绘制当前模块依赖图（Madge 或 dpdm 等工具）识别潜在循环；**拆后**运行 `tsc --noEmit` + 循环依赖检测脚本（如 `madge --circular`）；任何循环必须在 PR 内修复 |
| truth doc 只是复述 charter | 不回看代码现实 | 无法指导实现 | 文档必须回绑当前代码 ownership |
| owner evidence 不齐 | 设备/时间不够 | closure 被卡 | 依赖 RHX-qna Q4 提前冻结范围 |
| 重复抽 ZX5 已有 seam | 忽视 `session-lifecycle.ts` 等 4 个已抽 seam | 拆分变成"白做工" + 风险 import cycle | 设计与 action-plan 必须显式列出 ZX5 已有 seam 清单 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：结束“每次都要在 2000+ 行文件里找切口”的维护模式。
- **对 nano-agent 的长期演进**：给 hero-to-platform 一个干净、职责清晰的起跑面。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：三层真相冻结后，后续任何 feature 都更不容易把存储边界搞乱。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | Session DO Decomposition | 拆出 bootstrap/identity/ingress/ws/verify/persistence/orchestration deps | ✅ `NanoSessionDO 主文件回到可读 façade` |
| F2 | User DO Domain Split | 按 start/input/messages/cancel/verify/files/me-* 等 domain 拆 handler | ✅ `user-do.ts 不再是一锅端` |
| F3 | Three-Layer Truth Freeze | 发布 architecture truth 文档 | ✅ `下一阶段有稳定 truth law` |
| F4 | Evidence and Residue Closure | 归档 final evidence 并删除旧 residue | ✅ `real-to-hero 可以诚实收口` |

### 7.2 详细阐述

#### F1: `Session DO Decomposition`

- **输入**：当前 `NanoSessionDO` 全部职责与 RH0 预拆分切口
- **输出**：薄主文件 + 多个职责子模块
- **主要调用者**：agent-core session host
- **核心逻辑**：主文件只保留 façade / composition，具体能力下沉到按职责命名的模块。
- **边界情况**：
  - 不能引入 import cycle，不能把共享 helper 重复拷贝到多个模块。
- **一句话收口目标**：✅ **`NanoSessionDO 从巨石变成清晰 façade`**

#### F2: `User DO Domain Split`

- **输入**：当前 `user-do.ts` 各类 route / lifecycle / me surface 逻辑
- **输出**：domain handlers + shared infrastructure
- **主要调用者**：orchestrator-core façade
- **核心逻辑**：start/input/messages/cancel/verify/files/me-conversations/me-devices 等域逻辑各自归位。
- **边界情况**：
  - public contract owner 仍应由薄 façade 入口统一承接。
- **一句话收口目标**：✅ **`user-do.ts 只保留薄编排，不再承载所有业务细节`**

#### F3: `Three-Layer Truth Freeze`

- **输入**：session DO memory、user DO storage、D1 当前 ownership 现实
- **输出**：明确边界、禁令与常见违规示例的 architecture 文档
- **主要调用者**：后续所有实现者与 reviewer
- **核心逻辑**：把哪层拥有哪种数据、允许何种缓存、禁止何种复制写清楚。
- **边界情况**：
  - 文档不能与当前代码现实相矛盾。
- **一句话收口目标**：✅ **`三层真相第一次成为显式、可审计的架构法`**

#### F4: `Evidence and Residue Closure`

- **输入**：web / wechat / real-device run、旧 shim / deprecated bridge
- **输出**：完整 evidence pack 与清理后的仓库状态
- **主要调用者**：owner、closure reviewer
- **核心逻辑**：用真实端到端证据证明 RH1-RH5 能力成立，同时删除不再需要的过渡残余。
- **边界情况**：
  - evidence 必须覆盖 image / permission / device revoke 三大关键场景。
- **一句话收口目标**：✅ **`final closure 的证据和代码形态同时到位`**

### 7.3 非功能性要求与验证策略

- **性能目标**：拆分不改变现有行为语义与主要热路径
- **可观测性要求**：evidence pack 含截屏、网络日志、WS frame 日志
- **稳定性要求**：所有既有测试矩阵不回归
- **安全 / 权限要求**：三层真相文档明确禁止跨层偷复制冷真相
- **测试覆盖要求**：agent-core / orchestrator-core 既有测试矩阵 + manual evidence 三层
- **验证策略**：通过文件规模、无循环依赖、three-layer truth 文档、web/wechat/real-device evidence 共同证明 RH6 成立

---

## 8. 可借鉴的代码位置清单

### 8.1 Current `NanoSessionDO` megafile

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `workers/agent-core/src/host/do/nano-session-do.ts:159-2078` | 当前 megafile 全貌 | RH6 拆分的起点 | 当前 2078 行 |
| `workers/agent-core/src/host/do/nano-session-do.ts:481-528,721-828,864-1608` | live runner / waiters / websocket 等多职责并存 | RH6 应按职责切，而不是按长度切 | 典型混合责任区 |

### 8.2 Current `user-do.ts` megafile

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `workers/orchestrator-core/src/user-do.ts:1-2285` | 当前 façade megafile | RH6 的第二拆分目标 | 当前 2285 行 |
| `workers/orchestrator-core/src/user-do.ts:755-1180,1262-1540` | start/cancel/verify/read/messages 多域逻辑并存 | RH6 可按 domain handler 切分 | current domain density |
| `workers/orchestrator-core/src/user-do.ts:286-500` | D1 durable session truth helpers (~215 行) | RH6 候选独立抽取目标 `user-do/durable-truth.ts`（GLM R11） | candidate |
| `workers/orchestrator-core/src/{session-lifecycle,session-read-model,ws-bridge,parity-bridge}.ts` | ZX5 已抽出的 4 个 seam 模块 | RH6 必须**保留**这些 seam，并在其上新增 `user-do/handlers/*.ts`，不重复抽取 | already extracted |
| `workers/agent-core/src/host/do/nano-session-do.ts:1723-2078` | preview verification subsystem (~355 行，5 个 verify 方法) | RH6 F1 候选独立切出 `session-do-verify.ts` | candidate |

### 8.3 Truth / evidence anchors

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `docs/charter/plan-real-to-hero.md:258-270` | three-layer truth / evidence 硬纪律 | RH6 文档冻结的 charter 基础 | design must honor |
| `docs/charter/plan-real-to-hero.md:806-815` | Tier-A/B/C evidence 定义 | RH6 evidence pack 的直接验收口径 | closure law |

---

## 9. 多审查修订记录（2026-04-29 design rereview）

| 编号 | 审查者 | 原 finding | 采纳的修订 |
|------|--------|-------------|------------|
| GPT-R6 | GPT | RH6 把 `user-do.ts` 描述为完全单文件巨石，忽视 ZX5 已抽 4 个 seam | §4.2 改写为"在 ZX5 seam 之上新增 handlers"；§8.2 新增 ZX5 seam 引用并标注 already extracted；§6.2 新增"重复抽 seam"风险 |
| GLM-R11 / kimi-R9 共识 | GLM/kimi | 拆分方案遗漏 verification subsystem (1723-2078, 355 行) 与 D1 durable truth helpers (286-500, 215 行)；未提 import cycle 预防步骤 | §5.1 [S1]/[S2] 显式列出这两个候选；§8.1/§8.2 加引用；§6.2 import cycle 缓解方案具体化（拆前依赖图 + 拆后 tsc + madge --circular）|
| deepseek-H6-5/H6-6 | deepseek | `forwardInternalJson @deprecated` 已无活跃调用方；`deploy-fill` residue 范围被低估 | §5.1 [S5] cleanup 范围扩展，含 4 个源残留 + 文档残留 + Lane E |
| kimi-R9 | kimi | 缺 import cycle 预防 | §6.2 风险表新增缓解方案行 |
