# Nano-Agent 功能簇设计模板

> 功能簇: `F0 Compatibility Facade Contract`
> 讨论日期: `2026-04-24`
> 讨论者: `Owner + GPT-5.4（参考 Opus 1st/2nd-pass review）`
> 关联调查报告: `docs/plan-orchestration-facade.md`、`docs/plan-orchestration-facade-reviewed-by-opus.md`、`docs/plan-orchestration-facade-reviewed-by-opus-2nd-pass.md`、`docs/eval/after-foundations/smind-contexter-learnings.md`
> 文档状态: `frozen (F0 closed; reviewed + FX-qna consumed)`

---

## 0. 背景与前置约束

本设计文档讨论的是 **orchestration-facade 阶段 first-wave 的 public façade contract**。触发原因很直接：`agent.core` 当前已经是 session-facing public ingress，但阶段目标要求 **唯一 canonical public ingress 改为 `orchestrator.core`**。如果不先冻结 contract，后续 F1/F3 会在 “兼容旧路由” 与 “重做新产品 API” 之间反复摇摆。

- **项目定位回顾**：nano-agent 当前要先完成 worker-first runtime 的边界收口，让 public ownership 从 runtime 抽离出来，而不是在这个阶段同步重造完整产品 API。
- **本次讨论的前置共识**：
  - `orchestrator.core` 是唯一 canonical public HTTP / WS ingress。
  - `agent.core` 是 downstream session runtime，不再是 canonical public app ingress。
  - first-wave 继续采用 compatibility-first，而不是另造一套全新外部协议。
  - first-wave tenant truth 仍是 single-tenant-per-deploy。
  - legacy `agent.core /sessions/*` 只能是迁移窗口中的临时兼容面，不能长期存活。
- **显式排除的讨论范围**：
  - richer product API
  - multi-tenant-per-deploy
  - full user-memory / billing / credit domain

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`F0 Compatibility Facade Contract`
- **一句话定义**：定义 `orchestrator.core` 对外暴露的 session-facing public contract，以及 legacy `agent.core` public surface 的迁移 / 退役语义。
- **边界描述**：本功能簇**包含** public route shape、canonical ingress owner、compatibility semantics、legacy retirement discipline；**不包含** internal worker-to-worker contract、stream relay framing、tenant-source migration。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| compatibility façade | 对外保留现有 `/sessions/:session_uuid/...` 心智模型，但 owner 改为 `orchestrator.core` | 不是永久兼容层 |
| canonical public ingress | 所有外部 client 默认应该访问的唯一入口 | first-wave 即 `orchestrator.core` |
| legacy ingress | `agent.core` 现有 `/sessions/*` HTTP / WS 路径 | 只允许迁移期短暂保留 |
| hard deprecation | F3 exit 后，legacy session routes 不再继续工作 | HTTP 返回 typed `410`；WS 返回 typed `426` 并拒绝升级 |
| public contract | client 可见的 URL / method / status / body / WS 语义集合 | 不等于 internal API |

### 1.2 参考调查报告

- `docs/plan-orchestration-facade.md` — §1.5 / §6.4 / §11.4 / §15.1
- `docs/plan-orchestration-facade-reviewed-by-opus-2nd-pass.md` — G3 / G4 / M2 / M3 / M6
- `docs/eval/after-foundations/smind-contexter-learnings.md` — gateway / user DO 吸收面

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **public edge contract freeze** 的角色。
- 它服务于：
  - 外部 client / upstream app
  - orchestrator 实现者
  - live e2e / harness 维护者
- 它依赖：
  - `orchestrator.core` user DO
  - JWT ingress
  - `session_uuid` lifecycle law
  - F3 legacy retirement discipline
- 它被谁依赖：
  - F1 bring-up
  - F3 canonical cutover
  - 所有 public-facing docs / tests / README truth

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| `agent.core` internal binding | façade → runtime | 强 | public contract 决定 internal action coverage |
| stream relay | façade ← runtime | 强 | WS / HTTP consumer 语义必须与 contract 对齐 |
| user DO schema | façade ↔ registry | 强 | session lookup / reconnect 依赖 public contract |
| authority policy | ingress → policy | 中 | JWT preflight 与 public route behavior 耦合 |
| live E2E | contract → tests | 强 | F3 迁移完全依赖本 contract |
| context / filesystem | façade → none | 弱 | 本阶段显式不 direct bind |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`F0 Compatibility Facade Contract` 是 **public edge freeze layer**，负责 **把现有 session-facing surface 从 `agent.core` 迁移到 `orchestrator.core` 并定义 legacy retirement 语义**，对上游提供 **稳定的 first-wave public contract**，对下游要求 **single canonical ingress 与非永久 dual-ingress**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| richer CRM/product API | Codex / Claude 的更厚 session / task surface | 当前目标是 cutover，不是产品化重构 | 是 |
| direct public `context` / `filesystem` surface | service mesh / admin API 常见做法 | 会把 façade 变成超级路由器 | 低 |
| 永久 additive dual-ingress | 迁移型系统常见折中 | 会让 `session_uuid` owner 与 public truth 长期双轨 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| public route family | `/sessions/:session_uuid/*` | compatibility-first | richer `/v2/*` façade |
| legacy retirement policy | typed deprecation body | F3 exit 后 hard deprecate | 更正式 sunset 管理 |
| JWT ingress metadata | `last_auth_snapshot` | minimal auth snapshot | richer tenant / plan / org metadata |
| public WS semantics | `/sessions/:id/ws` | attach / reconnect only | richer event subscription model |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：public façade contract vs internal binding contract
- **解耦原因**：client-facing compatibility 语义与 worker-to-worker internal route family 不是同一层协议。
- **依赖边界**：public contract 只定义 client 可见 surface；internal binding 在独立 design doc 中冻结。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：canonical public ingress ownership、`session_uuid` ownership、legacy retirement semantics
- **聚合形式**：由 `orchestrator.core` 集中承担
- **为什么不能分散**：如果 `agent.core` 继续被默认视为可打入口，所有测试、docs、auth translation 都会漂移。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：更接近单进程 agent loop，没有独立 public façade / runtime mesh 分层。
- **亮点**：
  - 入口非常简单
  - system prompt 与 workspace 注入集中
- **值得借鉴**：
  - public contract 不要过度铺面
- **不打算照抄的地方**：
  - 把公共入口和执行体做成同一进程/同一对象

### 4.2 codex 的做法

- **实现概要**：typed protocol、thread/session 管理、event mapping、permission/sandbox 语义分层明确。
- **亮点**：
  - contract vocabulary 明确
  - event 与 thread 生命周期分层
- **值得借鉴**：
  - 先冻结 typed contract，再扩实现
- **不打算照抄的地方**：
  - first-wave 不需要引入 codex 级别的完整 protocol surface

### 4.3 claude-code 的做法

- **实现概要**：Structured IO、Task、ToolPermissionContext 把交互协议、任务状态、权限上下文拉成中心层。
- **亮点**：
  - canonical control plane 明确
  - tool / task / permission 之间关系清晰
- **值得借鉴**：
  - client-facing ingress 要有唯一控制面
- **不打算照抄的地方**：
  - 本阶段不复制其完整本地 CLI / SDK surface

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| 抽象层次 | 低 | 高 | 中高 | 中 |
| public contract 显式程度 | 低 | 高 | 中高 | 中高 |
| session/task 中央 owner | 弱 | 强 | 强 | 强 |
| dual-ingress 容忍度 | 高 | 低 | 低 | 低 |
| 对新贡献者友好度 | 高 | 中 | 中 | 中高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1]** 定义 `orchestrator.core` 为唯一 canonical public HTTP / WS ingress。
- **[S2]** 保留 compatibility-first `/sessions/:session_uuid/...` route family。
- **[S3]** 明确 legacy `agent.core` HTTP / WS session routes 的 bounded migration overlap 与 hard deprecation。
- **[S4]** 明确 docs / tests / harness 必须围绕 canonical ingress 迁移。
- **[S5]** 明确 `orchestrator.core` probe marker 作为 live deploy truth。

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1]** 新发明一整套产品级 public API。
- **[O2]** 长期保留 `agent.core` 作为同等 public ingress。
- **[O3]** 让 public façade 直接承担 context/filesystem 子系统路由。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| 迁移窗口中的 legacy `/sessions/*` | in-scope | 只作为 cutover 执行工具 |
| legacy path 长期继续服务 | out-of-scope | 与 canonical ingress 目标冲突 |
| public probe on internal workers | in-scope | 诊断 / deploy proof 仍需要 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **compatibility-first façade** 而不是 **first-wave 重造产品 API**
   - **为什么**：F3 的测试与 docs cutover 成本可控。
   - **我们接受的代价**：first-wave contract 看起来没有“新产品感”。
   - **未来重评条件**：当 canonical ingress 已稳定，且 richer orchestrator 启动时。

2. **取舍 2**：我们选择 **bounded migration overlap + F3 exit hard deprecation** 而不是 **永久 additive compatibility**
   - **为什么**：必须形成单一 canonical ingress。
   - **我们接受的代价**：迁移窗口内要一次性改 tests / harness / docs。
   - **未来重评条件**：仅当 owner 明确要求长期兼容老 client。

3. **取舍 3**：我们选择 **public contract 与 internal contract 分离** 而不是 **直接让 façade 复用 legacy agent public routes**
   - **为什么**：否则 internal API 永远被 legacy public surface 绑住。
   - **我们接受的代价**：需要额外设计 internal route family。
   - **未来重评条件**：无；这是当前阶段的结构性前提。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| legacy path 活太久 | F3 只加 header 不退役 | canonical ingress 失真 | F3 exit hard deprecation |
| façade 空心化 | 只迁 URL，不迁 ownership | tests/docs 继续漂移 | 把 `session_uuid` owner 与 registry 一并迁走 |
| public contract 漂移 | F1 先写代码，F0 不冻结 | F3 大规模返工 | 先完成 F0 design freeze |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：public routing、JWT ingress、session registry 有唯一入口。
- **对 nano-agent 的长期演进**：为 richer orchestrator 奠定稳定 public edge。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：把这些能力从 runtime edge 中抽离，避免每次演进都碰 client contract。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Canonical route family | `orchestrator.core` 对外承接 `/sessions/:session_uuid/...` | ✅ **客户端默认不再需要直打 `agent.core`** |
| F2 | Canonical owner shift | `session_uuid` / attach / reconnect owner 转到 façade | ✅ **public ownership 从 runtime 边界剥离** |
| F3 | Legacy migration overlap | 仅在 F3 执行期短暂允许 legacy path 存活 | ✅ **迁移窗口有边界，不是长期兼容层** |
| F4 | Hard deprecation | F3 exit 后 legacy HTTP/WS session routes 退役 | ✅ **dual-ingress 不再成立** |
| F5 | Probe marker discipline | `GET /` / `GET /health` 返回稳定 `worker/phase` 真相 | ✅ **preview deploy proof 不再依赖口头说明** |

### 7.2 详细阐述

#### F1: `Canonical route family`

- **输入**：client HTTP / WS request
- **输出**：由 façade 接住并路由到 user DO / internal binding
- **主要调用者**：external app / live E2E / docs examples
- **核心逻辑**：保持 first-wave surface 兼容，但 canonical owner 改为 `orchestrator.core`。
- **边界情况**：
  - 非 session 路径不自动迁移
  - probe 不等于 business ingress，但仍需返回稳定 identity marker
- **probe marker 要求**：
  - `GET /` / `GET /health` 必须返回 `worker: "orchestrator-core"`
  - `phase` 应采用 `orchestration-facade-F1` / `orchestration-facade-F3-cutover` 这一类显式阶段标识
- **一句话收口目标**：✅ **`/sessions/:id/*` 的 canonical owner 已改为 `orchestrator.core`**

#### F2: `Hard deprecation`

- **输入**：legacy `agent.core` public session request
- **输出**：迁移窗口内仍可工作；F3 exit 后 HTTP/WS 都返回 typed rejection
- **主要调用者**：旧 harness / 旧 docs / 遗留 client
- **核心逻辑**：
  - F3 exit 的判定 = `F3-closure memo` 产出 + `orchestrator-core` live E2E 全绿 + legacy negative tests 全绿
  - legacy session routes 的翻转必须在**同一个 PR**中完成，不允许先加 deprecation disclosure、后续再单独翻 410
  - legacy HTTP session routes 统一返回：
    ```json
    {
      "error": "legacy-session-route-retired",
      "canonical_worker": "orchestrator-core",
      "canonical_url": "https://<orchestrator>/sessions/:session_uuid/<action>",
      "message": "agent-core session surface retired, please use orchestrator-core canonical public ingress"
    }
    ```
  - legacy WS `/sessions/:session_uuid/ws` 返回 HTTP `426` + `{ error: "legacy-websocket-route-retired", canonical_worker, canonical_url, message }`，不进行 upgrade
- **边界情况**：
  - `GET /` probe 继续保留
  - internal `/internal/*` 不属于 legacy public path
- **一句话收口目标**：✅ **legacy public session ingress 在 F3 exit 后不再继续工作**

### 7.3 非功能性要求

- **性能目标**：compatibility façade 不得明显增加 session start 的 cold path 抖动。
- **可观测性要求**：必须能区分 canonical ingress 与 legacy ingress 命中情况。
- **稳定性要求**：不得长期依赖 dual-ingress 才能保持测试为绿。
- **测试覆盖要求**：F3 结束前，受影响 live E2E 全部迁移或显式留作 internal verification。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/mini_agent/agent.py:45-76` | 单一 Agent owner 持有 system prompt / tools / workspace / message history | 中央 owner 要清晰 | 我们借鉴“入口 owner 单一化”，不借鉴单进程形态 |
| `context/mini-agent/mini_agent/agent.py:86-121` | 用户消息与取消清理逻辑 | session-facing state 不应分散 | 说明 façade owner 要稳定 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/core/src/thread_manager.rs:134-218` | thread/session 中央 owner 与 in-memory manager | canonical session owner 需要中心化 | 很适合对照 `orchestrator.core` |
| `context/codex/codex-rs/core/src/event_mapping.rs:135-208` | typed response item -> turn item 映射 | public surface 与内部事件层要分层 | 借鉴“外层 contract 明确，内层事件再映射” |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/cli/structuredIO.ts:126-163` | Structured IO 作为唯一 control plane writer | client-facing protocol 要有单一出口 | 对应我们要有唯一 canonical ingress |
| `context/claude-code/Task.ts:6-29` | task type / task status 明确枚举 | 生命周期与 ownership 先枚举清楚 | 对应 façade cutover 阶段的 route/phase truth |
| `context/claude-code/Tool.ts:123-148` | permission context 中央化 | public contract 与 permission/approval 不应散落 | |

### 8.4 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `context/smind-contexter/src/chat.ts:166-210` | gateway 直接以现有协议 shape 转发到 DO，很容易把 ingress 与内部协议耦死 | 我们要保留 compatibility surface，但不能让 public contract 直接等于内部实现路径 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`F0 Compatibility Facade Contract` 在 nano-agent 中会以 **public edge freeze 文档** 的形式存在。它覆盖的是 first-wave 对外 session contract，不覆盖 internal binding 与 richer API。代码复杂度不在“算法”，而在 **owner 切换、legacy retirement、tests/docs 一致性**。它与 F3 的耦合极强，是整个 orchestration-facade 阶段的入口真相层。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 这是 public ownership 切换的基础 |
| 第一版实现的性价比 | 5 | 不先冻住，后续 F1-F3 一定返工 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 4 | 先清边界，再扩能力 |
| 对开发者自己的日用友好度 | 4 | 上游对接路径会清晰很多 |
| 风险可控程度 | 4 | 风险主要在迁移量，不在方案不可行 |
| **综合价值** | **5** | **是本阶段必须先完成的 freeze 文档** |

### 9.3 下一步行动

- [x] **设计冻结回填**：legacy HTTP `410` / WS `426` body shape 已吸收到 F3 action-plan，并由 `orchestrator-core/07-legacy-agent-retirement.test.mjs` 锁定 live negative proof。
- [ ] **关联 Issue / PR**：`docs/action-plan/orchestration-facade/F0-concrete-freeze-pack.md`
- [ ] **待进入实现阶段的子问题**：
  - `canonical_public` 字段在 preview / prod / local 三种环境下的具体 URL 组装位置
- [ ] **需要更新的其他设计文档**：
  - `F0-agent-core-internal-binding-contract.md`
  - `F0-live-e2e-migration-inventory.md`

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：compatibility-first 是否会拖慢产品化
  - **A 方观点**：应该直接换新 public API
  - **B 方观点**：先 cutover，再 productize
  - **最终共识**：本阶段先解决 ownership，不把 API 重造绑进来

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-24 | GPT-5.4 | 初稿 |
| v0.2 | 2026-04-24 | GPT-5.4 | 吸收 DeepSeek/Opus review 与 FX-qna，冻结 probe marker 与 hard-deprecation body shape |
