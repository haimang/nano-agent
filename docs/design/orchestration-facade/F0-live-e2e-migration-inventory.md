# Nano-Agent 功能簇设计模板

> 功能簇: `F0 Live E2E Migration Inventory`
> 讨论日期: `2026-04-24`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告: `docs/plan-orchestration-facade.md`、`test/INDEX.md`
> 文档状态: `frozen (F0 closed; reviewed + FX-qna consumed)`
>
> **POST-ZX3 NOTE(2026-04-28)**: 本文档中所有对 `test-legacy/` 的引用是历史快照。`test-legacy/` 已在 ZX3 Phase 5 物理删除,有价值的 contract guardians 已迁到 `test/root-guardians/`,fixtures 已迁到 `test/shared/fixtures/`。当前测试结构请读 `test/INDEX.md` v0.4+ 与 `docs/issue/zero-to-real/ZX3-closure.md`。

---

## 0. 背景与前置约束

orchestration-facade 阶段最容易被低估的，不是新 worker scaffold，而是 **live E2E 与 docs/harness 的真实迁移面**。当前 `test/INDEX.md` 已明确：不是所有 35 subtests 都要改，但凡通过 `agent-core /sessions/:id/*` 驱动的测试都需要重新校准。F0 必须把这些文件级迁移面列出来，否则 F3 会再次被误判成“改几个 URL”。

- **项目定位回顾**：本阶段要切 canonical ingress，不是推翻整个测试树。
- **本次讨论的前置共识**：
  - `bash-core` / `context-core` / `filesystem-core` package-e2e 主要保留
  - affected tests 主要来自 `agent-core` session-facing tests 与部分 cross-e2e
  - 需要新增 `orchestrator-core` live surface
- **显式排除的讨论范围**：
  - worker-local unit tests
  - `test-legacy/` contract guardians
  - 一次性补齐所有 WS-only live tests

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`F0 Live E2E Migration Inventory`
- **一句话定义**：定义 orchestration-facade 阶段受 canonical ingress 切换影响的 live tests / harness / docs 清单，以及它们分别该迁移、保留还是新增。
- **边界描述**：本功能簇**包含** file-level inventory、迁移分类、推荐新测试面；**不包含**具体测试实现代码。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| affected tests | 当前默认命中 `agent-core /sessions/:id/*` 的 live tests | F3 主要迁移面 |
| internal verification suite | 仍针对 internal workers / probe 的保留测试 | 不因 façade 引入而删除 |
| migration | 将断言与默认 URL 切到 `orchestrator.core` | 不一定逐字拷贝 |
| replacement suite | 针对新 `orchestrator-core` public surface 的新测试组 | 推荐新增 |

### 1.2 参考调查报告

- `docs/plan-orchestration-facade.md` — §2.3 / §11.4 / §13.2
- `test/INDEX.md`

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **F3 migration truth layer** 的角色。
- 它服务于：
  - F3 action-plan
  - test maintainers
  - docs / README maintainers
- 它依赖：
  - public façade contract
  - `orchestrator.core` live surface design
- 它被谁依赖：
  - F3 cutover closure
  - §15.1 exit criterion #6

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| public façade contract | contract -> inventory | 强 | 决定哪些 tests 改入口 |
| internal binding contract | new live assertions | 中 | orchestrator tests 最终会间接依赖 |
| session lifecycle | reconnect / attach tests | 中 | F2 后可能新增 WS 类 live tests |
| legacy retirement | migration -> hard deprecation assertions | 强 | F3 exit 需要相应负向测试 |
| docs/index | inventory -> docs truth | 强 | `test/INDEX.md` 必须同步更新 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`F0 Live E2E Migration Inventory` 是 **F3 的文件级迁移地图**，负责 **指出哪些 live tests / harness / docs 需要迁到 `orchestrator.core`，哪些仍保留为 internal verification**，对上游提供 **cutover 的真实工作量边界**，对下游要求 **不再含混使用 `agent.core` 作为默认 public 入口**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 一次性迁所有 live tests | 常见“大搬迁”误区 | 实际受影响面没那么大 | 否 |
| 顺手新增完整 WS live suite | 完整 real-time 测试愿景 | 当前不是 blocker | 是 |
| 删除所有 agent-core package-e2e | 极端 cutover 做法 | probe / internal verification 仍有价值 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| new worker URL env | `NANO_AGENT_ORCHESTRATOR_CORE_URL` | live harness 新增 | prod URL / env split |
| orchestrator package-e2e | `test/package-e2e/orchestrator-core/*` | first-wave new public suite | richer WS/reconnect tests |
| hard-deprecation tests | legacy route negative tests | F3 需要 | sunset tooling |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：internal verification suites vs public ingress migration suite
- **解耦原因**：`bash` / `context` / `filesystem` 的 package-e2e 不是 cutover 对象。
- **依赖边界**：只有 session-facing public tests 迁移；internal posture tests 保留。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：所有 affected test files / docs / harness 清单
- **聚合形式**：单一 inventory 文档
- **为什么不能分散**：否则 F3 closure 无法证明“哪些改了、哪些故意没改”。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：本地单进程测试心智较强，远程 live ingress 迁移问题弱。
- **值得借鉴**：
  - 保持测试面简洁
- **不打算照抄的地方**：
  - 不把 worker topology 当成本地单 agent 测试问题

### 4.2 codex 的做法

- **实现概要**：typed protocol / thread manager / permissions 带来较强测试分层意识。
- **值得借鉴**：
  - 测试要围绕 contract truth，而不是实现细节
- **不打算照抄的地方**：
  - 不复制其庞大的 test matrix

### 4.3 claude-code 的做法

- **实现概要**：StructuredIO / Task / Tool 边界清楚，意味着测试也按边界分层。
- **值得借鉴**：
  - 测试应围绕中央 owner 切分
- **不打算照抄的地方**：
  - 不按本地 CLI/SDK host 模式组织 worker live tests

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| live remote ingress 关注度 | 低 | 中 | 中 | 高 |
| test boundary clarity | 中 | 高 | 高 | 高 |
| 迁移 inventory 显式程度 | 低 | 中 | 中 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1]** affected file inventory
- **[S2]** harness/env 变量变更 inventory
- **[S3]** `test/INDEX.md` 更新项 inventory
- **[S4]** 推荐新增 `orchestrator-core` package-e2e 范围

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1]** 迁移 `bash-core` / `context-core` / `filesystem-core` package-e2e
- **[O2]** 一次性重写 `test-legacy/`
- **[O3]** 一次性新增完整 WS-only live suite

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `test/package-e2e/agent-core/01-preview-probe.test.mjs` | keep | probe 仍属于 agent-core |
| `test/package-e2e/agent-core/02-06` | migrate/replace | 当前都围绕 legacy public session ingress |
| `test/cross-e2e/01` / `07` / `10` | mostly keep | 主要是 topology/probe/posture，不完全依赖 public session owner |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **文件级 inventory** 而不是 **笼统写“affected tests 要迁”**
   - **为什么**：F3 的真实工作量必须落到文件名。
   - **我们接受的代价**：文档较长。
   - **未来重评条件**：无；这是 cutover honesty 的前提。

2. **取舍 2**：我们选择 **新增 orchestrator-core suite** 而不是 **只在 agent-core 原文件上硬改**
   - **为什么**：canonical public owner 已改变，测试目录结构也应表达这一点。
   - **我们接受的代价**：测试树会新增一个 worker 目录。
   - **未来重评条件**：若 owner 明确要求“少改目录、多改文件”。

3. **取舍 3**：我们选择 **保留 internal verification suites** 而不是 **一刀切删除 agent/bash/context/filesystem 旧测试**
   - **为什么**：worker-level posture 仍需验证。
   - **我们接受的代价**：测试树会更分层。
   - **未来重评条件**：若后续 topology 又发生更大重构。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| F3 再次低估 | 不列文件级 inventory | 迁移超期 | 先做 inventory |
| 测试职责混乱 | public 与 internal suite 混在一起 | closure 证据不清 | 新增 `orchestrator-core` suite 并保留 internal suites |
| docs truth 漂移 | 只改测试不改 INDEX/harness | 人与文档都混乱 | 把 docs/harness 也放进 inventory |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：F3 不再像黑箱迁移。
- **对 nano-agent 的长期演进**：测试树能够真实反映 canonical public owner。
- **对三大深耕方向的杠杆作用**：stability 依赖高信号 live tests；这份 inventory 是其前置。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Affected file inventory | 列出需要迁移/替换的 tests | ✅ **F3 工作量变成可数清单** |
| F2 | Keep list | 列出明确保留的 internal verification suites | ✅ **哪些不动也有明确理由** |
| F3 | Harness/doc inventory | env / `live.mjs` / `INDEX.md` 更新项 | ✅ **不是只改测试文件** |
| F4 | Replacement suite recommendation | 推荐新增 `orchestrator-core` suite | ✅ **测试目录与新架构 owner 一致** |

### 7.2 详细阐述

#### F1: `Affected file inventory`

- **输入**：当前 `test/INDEX.md` 与实际 test tree
- **输出**：迁移分类
- **建议分类**：
  - **Keep as-is**：
    - `test/package-e2e/agent-core/01-preview-probe.test.mjs`
    - `test/package-e2e/bash-core/*`
    - `test/package-e2e/context-core/*`
    - `test/package-e2e/filesystem-core/*`
    - `test/cross-e2e/01-stack-preview-inventory.test.mjs`
    - `test/cross-e2e/07-library-worker-topology-contract.test.mjs`
    - `test/cross-e2e/10-probe-concurrency-stability.test.mjs`
  - **Migrate or replace into `orchestrator-core`**：
    - `test/package-e2e/agent-core/02-session-edge.test.mjs`
    - `test/package-e2e/agent-core/03-initial-context-smoke.test.mjs`
    - `test/package-e2e/agent-core/04-session-lifecycle.test.mjs`
    - `test/package-e2e/agent-core/05-multi-turn-input.test.mjs`
    - `test/package-e2e/agent-core/06-verify-unknown-check.test.mjs`
  - **Cross-e2e 入口迁移**：
    - `test/cross-e2e/02-agent-bash-tool-call-happy-path.test.mjs`
    - `test/cross-e2e/03-agent-bash-tool-call-cancel.test.mjs`
    - `test/cross-e2e/04-agent-context-initial-context.test.mjs`
    - `test/cross-e2e/05-agent-context-default-compact-posture.test.mjs`
    - `test/cross-e2e/06-agent-filesystem-host-local-posture.test.mjs`
    - `test/cross-e2e/08-session-lifecycle-cross.test.mjs`
    - `test/cross-e2e/09-capability-error-envelope-through-agent.test.mjs`
- **cross-e2e 分类一句话依据**：
  - `01` keep：只做 4-worker probe inventory，不依赖 canonical session ingress
  - `02` migrate：当前经 `agent-core /verify` 进入 agent+bash happy path，需改由 orchestrator 作为 public owner
  - `03` migrate：cancel race 仍是跨 seam，但入口不应再直打 `agent.core`
  - `04` migrate：`initial_context` 是 public session start 行为，必须跟 canonical ingress 走
  - `05` migrate：compact posture 通过 public session surface 暴露，入口应转 orchestrator
  - `06` migrate：filesystem/binding posture 当前通过 agent verify 暴露，canonical owner 切换后也需改入口
  - `07` keep：只验证 context/filesystem 作为 library worker 的 `404` posture，与 session ingress 无关
  - `08` migrate：全生命周期测试天然属于 façade cutover 面
  - `09` migrate：错误 envelope 仍是 cross-worker truth，但 public verify 入口要切到 orchestrator
  - `10` keep：只是并发 probe 稳定性，不依赖 session-facing public owner
- **agent-core package-e2e 去留补充**：
  - `03-initial-context-smoke` 建议合并进 `orchestrator-core/02-session-start`
  - `02/04/05/06` 建议迁入新目录后删除旧 agent-core 对应文件，不留 ghost
- **一句话收口目标**：✅ **F3 affected files 已具象化到文件名级**

#### F2: `Harness/doc inventory`

- **输入**：live harness 与索引文档
- **输出**：待修改对象
- **必须纳入 inventory**：
  - `test/shared/live.mjs`
  - `test/INDEX.md`
  - 新 env：`NANO_AGENT_ORCHESTRATOR_CORE_URL`
  - 相关 README / preview truth
- **replacement suite 建议**：
  - 新建 `test/package-e2e/orchestrator-core/`
  - 最小包含：
    - `01-preview-probe`
    - `02-session-start`
    - `03-ws-attach`
    - `04-reconnect`
    - `05-verify-status-timeline`
    - `06-auth-negative`
    - `07-legacy-agent-retirement`
  - `test/shared/live.mjs` 增加 `NANO_AGENT_ORCHESTRATOR_CORE_URL`
  - `test/cross-e2e/*` 仍保留在 `cross-e2e/` 目录，但 affected cases 的默认入口 URL 统一切到 `orchestrator-core`
  - `test/INDEX.md` 在 cutover 后应整体更新为新 public owner 口径
- **一句话收口目标**：✅ **测试迁移不只改 URL，还会同步改 harness 与索引**

### 7.3 非功能性要求

- **性能目标**：迁移后 live suite 仍保持 opt-in / low-flake。
- **可观测性要求**：能从目录结构看出 canonical public owner 已切换。
- **稳定性要求**：不允许留下 ghost tests。
- **测试覆盖要求**：F3 closure 必须对照本 inventory 逐项回填。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/mini_agent/agent.py:86-98` | 明确取消检查边界 | 测试也应围绕清晰边界，而不是模糊行为 | |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/core/src/event_mapping.rs:135-208` | 围绕 typed event，而不是实现细节测试 | 测试迁移也应围绕 contract truth | |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/Task.ts:22-29` | terminal 状态有明确定义 | live tests 的 negative/terminal 行为也要明确分类 | |

### 8.4 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `test/INDEX.md:66-116` | 当前大量条目以 `agent-core /sessions/:id/*` 为默认 public 入口描述 | 这正是 F3 要迁移的文档真相，不可继续沿用 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`F0 Live E2E Migration Inventory` 是一份典型的“工程诚实文档”。它不创造新能力，但它决定我们会不会再次低估 F3。它的价值在于把 test migration 从抽象任务变成文件清单，并明确推荐新 `orchestrator-core` suite 作为 canonical public ingress 的测试承载点。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | canonical ingress 切换必须有测试迁移地图 |
| 第一版实现的性价比 | 5 | 一份 inventory 能显著降低 F3 风险 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 4 | 稳定的 live suite 是长期资产 |
| 对开发者自己的日用友好度 | 5 | 迁移工作边界终于可数 |
| 风险可控程度 | 5 | 最大风险就是低估；这份文档直接缓解它 |
| **综合价值** | **5** | **是 F3 的先决地图** |

### 9.3 下一步行动

- [x] **设计冻结回填**：已把 orchestrator-core 7 文件骨架与 cross-e2e 逐文件迁移说明吸收到 F3 action-plan，并在 F3 执行中按此完成迁移。
- [ ] **关联 Issue / PR**：`docs/action-plan/orchestration-facade/F3-canonical-cutover-and-legacy-retirement.md`
- [ ] **待深入调查的子问题**：
  - WS live suite 是否在本阶段新增最小覆盖
- [ ] **需要更新的其他设计文档**：
  - `F0-compatibility-facade-contract.md`
  - `F0-session-lifecycle-and-reconnect.md`

---

## 附录

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-24 | GPT-5.4 | 初稿 |
| v0.2 | 2026-04-24 | GPT-5.4 | 吸收 review + FX-qna，细化 cross-e2e 分类依据与 orchestrator-core replacement suite |
