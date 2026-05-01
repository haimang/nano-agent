# Nano-Agent API Compliance 调查模板

> 调查对象: `{API_DOC_CLUSTER_OR_PARTITION}`（例：`Auth + Catalog + Checkpoints`）
> 调查类型: `initial | rereview | regression | partial-cluster | full-surface`
> 调查者: `{INVESTIGATOR}`
> 调查时间: `{DATE}`
> 调查范围:
> - `{API_DOC_PATH_1}`（例：`clients/api-docs/auth.md`）
> - `{API_DOC_PATH_2}`
> - `{API_DOC_PATH_N}`
> Profile / 协议族: `{NACP_PROFILE}`（例：`facade-http-v1`）
> 真相对照（SSoT，只读引用）:
> - `{FROZEN_CONTRACT_FILE}`（例：`packages/orchestrator-auth-contract/src/facade-http.ts`）
> - `{DESIGN_OR_CHARTER}`（例：`docs/charter/plan-hero-to-pro.md §X`）
> - `{Q_LAW_REF}`（例：`docs/design/hero-to-pro/HPX-qna.md Q19/Q21/Q27`）
> - `{DRIFT_GATE_SCRIPTS}`（例：`scripts/check-envelope-drift.mjs`、`check-tool-drift.mjs`）
> 复用 / 对照的既有审查:
> - `{PRIOR_COMPLIANCE_REPORT_OR_NONE}` — `{HOW_USED}`（独立复核 / 采纳 / 仅作线索）
> 文档状态: `draft | reviewed | changes-requested | re-reviewed | closed`

---

## 0. 总判定 / Executive Summary

> 先给一句话 verdict，再给簇级总览。  
> 例：`本轮 Auth + Catalog + Checkpoints 调查整体合规，但发现 1 项 CRITICAL（错误信封违约）和 4 项 WARN，不允许声明 fully-compliant，需先修 CRITICAL。`

- **整体 verdict**：`{ONE_LINE_VERDICT}`
- **结论等级**：`compliant | compliant-with-followups | partial-compliance | non-compliant`
- **是否允许声明合规**：`yes | no`
- **本轮最关键的 1-3 个判断**：
  1. `{KEY_JUDGEMENT_1}`
  2. `{KEY_JUDGEMENT_2}`
  3. `{KEY_JUDGEMENT_3}`

### 0.1 簇级总览矩阵

> 一眼能看清哪些簇 OK、哪些不 OK。每个维度填 `✅ PASS / ⚠️ WARN / ❌ FINDING / 🔴 CRITICAL`，不写其它字符。

| 簇 | 端点数 | F1 功能性 | F2 测试覆盖 | F3 形态合规 | F4 NACP 合规 | F5 文档一致性 | F6 SSoT 漂移 | 簇 verdict |
|----|--------|-----------|-------------|-------------|--------------|---------------|--------------|------------|
| `{CLUSTER_1}` | `{N}` | `✅ / ⚠️ / ❌ / 🔴` | `✅ / ⚠️ / ❌ / 🔴` | `✅ / ⚠️ / ❌ / 🔴` | `✅ / ⚠️ / ❌ / 🔴` | `✅ / ⚠️ / ❌ / 🔴` | `✅ / ⚠️ / ❌ / 🔴` | `PASS / PARTIAL / FAIL` |
| `{CLUSTER_2}` | `{N}` | | | | | | | |
| `{CLUSTER_N}` | `{N}` | | | | | | | |

### 0.2 Finding 数量汇总

| 严重级别 | 数量 | 是否 blocker（合规声明前必须修） |
|----------|------|----------------------------------|
| 🔴 CRITICAL | `{N}` | yes |
| ❌ FINDING  | `{N}` | yes |
| ⚠️ WARN     | `{N}` | no（建议修） |
| 📝 OBSERVATION | `{N}` | no（仅记录） |

---

## 1. 调查方法学

### 1.1 六维评估方法

| 维度 | 名称 | 核心问题 | 通过条件 |
|------|------|----------|----------|
| **F1** | 功能性（Functionality） | 路由→实现是否真实成链？文档声明的能力是否真的存在？ | route → handler → backing repo / RPC 全链路可达，行为符合 doc |
| **F2** | 测试覆盖（Test Coverage） | 是否有测试在这条路径上跑过？覆盖了 happy path 与关键错误路径？ | 单测 + 集成 + （必要时）E2E / live 任一层有断言 |
| **F3** | 形态合规（Shape Compliance） | 请求/响应/错误形态、auth gate、status code 是否与 doc 与契约对齐？ | request/response 满足 schema；auth 行为与 doc 同；status code 同 |
| **F4** | NACP 协议合规（NACP Compliance） | envelope、authority、trace、tenant boundary、error code 是否符合 NACP profile？ | 信封正族；trace 贯通；authority 翻译合法；tenant 边界守住 |
| **F5** | 文档真相一致性（Doc-Reality Parity） | 文档说的与代码做的是否一致？ | 没有 doc 写了能力但代码没做、或代码做了 doc 没写 |
| **F6** | SSoT 漂移（SSoT Drift） | 是否触发了 drift gate？是否与 frozen contract / 契约表 / Q-law 一致？ | drift gate 全绿；与契约 / Q-law 无背离 |

### 1.2 严重级别定义

| 级别 | 标记 | 定义 | 处置 |
|------|------|------|------|
| **CRITICAL** | 🔴 | 破坏正确性、安全、契约或会让现有客户端解析失败 | **必须修复**才能声明合规 |
| **FINDING** | ❌ | 行为偏离，影响协议合规 / 客户端兼容 / 多租隔离 | **应修复**；如延后，须明确条件与 owner |
| **WARN** | ⚠️ | 轻微偏差、文档不准、测试缺口、代码异味 | 建议修复；不阻塞合规声明 |
| **OBSERVATION** | 📝 | 已知未实现、设计选择、未来工作 | 仅记录，不要求行动 |

### 1.3 已核实的事实

> 这一节只写事实，不写结论。明确读了哪些文件、跑了哪些命令、对照了哪些 SSoT。  
> 如果引用了其它调查结论，必须说明是独立复核、采纳还是仅作线索。

- **对照的 API 文档**：
  - `{API_DOC_PATH_1}`
  - `{API_DOC_PATH_2}`
- **核查的实现**：
  - `{IMPL_PATH_1}`（例：`workers/orchestrator-core/src/index.ts:510-667`）
  - `{IMPL_PATH_2}`
- **核查的契约 / SSoT**：
  - `{CONTRACT_PATH}`（例：`packages/orchestrator-auth-contract/src/facade-http.ts`）
  - `{Q_LAW_LINE}`（例：HPX-qna.md Q27 FacadeEnvelope）
- **执行过的验证**：
  - `{COMMAND_1}`（例：`pnpm --filter @nano-agent/orchestrator-core test:unit`）
  - `{DRIFT_GATE_1}`（例：`pnpm check:envelope-drift`）
  - `{LIVE_OR_E2E}`（例：`pnpm cross-e2e:live` / 或 `n/a`）

### 1.4 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes / no` | `{DETAIL}` |
| 单元 / 集成测试运行 | `yes / no` | `{DETAIL}` |
| Drift gate 脚本运行 | `yes / no` | `{DETAIL}` |
| schema / contract 反向校验 | `yes / no / n/a` | `{DETAIL}` |
| live / preview / deploy 证据 | `yes / no / n/a` | `{DETAIL}` |
| 与上游 design / Q-law 对账 | `yes / no / n/a` | `{DETAIL}` |

### 1.5 跨簇横切观察

> 在进入逐簇分析前，先把对所有簇都成立的事实写在一处，避免每簇重复。

- **架构与路由层**：`{ARCH_NOTE}`（例：所有簇都经 orchestrator-core `dispatchFetch()`）
- **Envelope 契约**：`{ENVELOPE_NOTE}`（例：所有簇都使用 `facade-http-v1` 的 `{ ok, data?, error?, trace_uuid }`）
- **Auth 模式**：`{AUTH_PATTERN_NOTE}`（例：facade-level `authenticateRequest()` vs proxy 内部解析两种）
- **Trace 传播**：`{TRACE_NOTE}`（例：proxy 路由 fallback `crypto.randomUUID()`，session 路由强制 header）
- **NACP authority 翻译**：`{AUTHORITY_NOTE}`（例：JWT claim → `IngressAuthSnapshot`）

---

## 2. 簇级总览矩阵（全端点）

> 一张大表把所有簇所有端点的所有维度评分摊开，便于一眼定位问题。建议端点数过多时再分簇拆。

| 簇 | 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 关键问题 |
|----|------|----|----|----|----|----|----|--------------|----------|
| `{CLUSTER_1}` | `{METHOD} {PATH_1}` | `✅` | `✅` | `✅` | `✅` | `✅` | `✅` | PASS | — |
| `{CLUSTER_1}` | `{METHOD} {PATH_2}` | `✅` | `⚠️` | `✅` | `✅` | `✅` | `✅` | PASS w/ WARN | `{ONE_LINE}` |
| `{CLUSTER_2}` | `{METHOD} {PATH_3}` | `✅` | `✅` | `❌` | `✅` | `✅` | `✅` | FAIL | `{ONE_LINE}` |

---

## 3. 簇级深度分析

> 每个 API 文档对应一个簇，每簇按以下结构展开。  
> 端点数过多时，可以只展开有 ⚠️/❌/🔴 的端点，全 PASS 的端点放在 §3.x.5 简表里。

### 3.1 簇 — `{CLUSTER_1}`（`{API_DOC_PATH_1}`）

#### 3.1.0 路由轨迹（Route Trace）

> 用代码块画一次 `Client → facade → handler → backing` 的完整链路；多端点共享同一链路时只画一次。

```text
Client
  → {FACADE_WORKER}/dispatchFetch()             {FILE}:{LINE}
  → {ROUTE_PARSER}()                            {FILE}:{LINE}
  → {HANDLER}()                                 {FILE}:{LINE}
  → {AUTH_GATE}()                               {FILE}:{LINE}
  → {BACKING_REPO_OR_RPC}                       {FILE}:{LINE}
  → {ENVELOPE_WRAP}                             {FILE}:{LINE}
```

**链路注记**：`{NOTE_ABOUT_PRIORITY_OR_FALLTHROUGH}`（例：`parseAuthRoute` 排在所有 session 路由之前，避免冲突）

#### 3.1.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| `{METHOD} {PATH_1}` | `✅` | `✅` | `✅` | `✅` | `✅` | `✅` | PASS | — |
| `{METHOD} {PATH_2}` | `✅` | `⚠️` | `✅` | `✅` | `✅` | `✅` | PASS w/ WARN | `W-{CLUSTER}-01` |
| `{METHOD} {PATH_3}` | `✅` | `✅` | `❌` | `✅` | `✅` | `✅` | FAIL | `F-{CLUSTER}-01` |

#### 3.1.2 端点逐项分析

> 每个有问题（⚠️/❌/🔴）的端点至少要有一张 dimension 表；纯 PASS 端点可以合并写在 §3.1.5 简表里。

##### 3.1.2.1 `{METHOD} {PATH}`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | `✅ / ⚠️ / ❌ / 🔴` | route：`{FILE}:{LINE}` → `{HANDLER}` → `{BACKING}`；行为：`{BEHAVIOR}` |
| **F2 测试覆盖** | `✅ / ⚠️ / ❌ / 🔴` | 单测：`{TEST_FILE}:{LINE}`；集成：`{TEST_FILE}:{LINE}`；E2E：`{TEST_FILE_OR_NA}` |
| **F3 形态合规** | `✅ / ⚠️ / ❌ / 🔴` | auth：`{DOC_VS_CODE}`；request：`{SCHEMA}`；response：`{SCHEMA}`；status：`{CODES}`；error：`{CODES}` |
| **F4 NACP 合规** | `✅ / ⚠️ / ❌ / 🔴` | envelope：`{PROFILE}`；trace：`{HOW}`；authority：`{HOW}`；tenant：`{HOW}` |
| **F5 文档一致性** | `✅ / ⚠️ / ❌ / 🔴` | `{DOC_REALITY_DIFF_OR_NONE}` |
| **F6 SSoT 漂移** | `✅ / ⚠️ / ❌ / 🔴` | drift gate：`{GATE_RESULT}`；契约对账：`{CONTRACT_PARITY}` |

**关联 finding**：`{FINDING_ID_OR_NONE}`

##### 3.1.2.2 `{METHOD} {PATH}`

*（同上结构）*

#### 3.1.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `{PROFILE}` | `✅ / ⚠️ / ❌` | `{FILE}:{LINE}` |
| `x-trace-uuid` 在 response 头里 | `✅ / ⚠️ / ❌` | `{FILE}:{LINE}` |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | `✅ / ⚠️ / ❌` | 编译期 guard `{FILE}:{LINE}` |
| Tenant 边界 5 规则被守住 | `✅ / ⚠️ / ❌ / n/a` | `{FILE}:{LINE}` |
| Authority 翻译合法（HTTP claim → server-stamped） | `✅ / ⚠️ / ❌` | `{FILE}:{LINE}` |

#### 3.1.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| `F-{CLUSTER}-01` | 🔴 | F4 | `{TITLE}` | `{IMPACT}` |
| `W-{CLUSTER}-01` | ⚠️ | F2 | `{TITLE}` | `{IMPACT}` |

#### 3.1.5 全 PASS 端点简表（合并展示）

| 端点 | 备注 |
|------|------|
| `{METHOD} {PATH}` | 无异常，按 doc 实链 |
| `{METHOD} {PATH}` | 无异常 |

### 3.2 簇 — `{CLUSTER_2}`（`{API_DOC_PATH_2}`）

*（同 §3.1 结构）*

### 3.N 簇 — `{CLUSTER_N}`

*（同 §3.1 结构）*

---

## 4. 跨簇 NACP 协议合规

> 这一节专门跨簇横切复核，避免每簇重复。

### 4.1 Authority 翻译（Client → Facade → Internal）

| 路由类别 | Authority 来源 | 翻译机制 | NACP 合规 |
|----------|----------------|----------|-----------|
| `{ROUTE_TYPE_1}` | `{SOURCE}` | `{MECHANISM}` | `✅ / ⚠️ / ❌` |
| `{ROUTE_TYPE_2}` | `{SOURCE}` | `{MECHANISM}` | `✅ / ⚠️ / ❌` |

### 4.2 Trace UUID 传播

| 路由类别 | Trace 来源 | 传播路径 | 强制 vs 可选 | 状态 |
|----------|------------|----------|--------------|------|
| `{ROUTE_TYPE_1}` | `{SOURCE}` | `{PROPAGATION}` | `required / optional` | `✅ / ⚠️ / ❌` |

### 4.3 Error Code 字典对齐

- `FacadeErrorCodeSchema` 是否为 `AuthErrorCodeSchema` / `RpcErrorCodeSchema` 的超集：`✅ / ❌`
- 编译期 guard：`{FILE}:{LINE}` —— `{NAME}`
- 运行期回退：未知 code → `{FALLBACK_CODE}`（例：`internal-error`）

### 4.4 Tenant 边界

| 路由 | tenant 检查方式 | 5 规则覆盖度 | 状态 |
|------|-----------------|--------------|------|
| `{ROUTE_OR_CLUSTER}` | `{HOW}` | `5/5 / 部分 / 0/5` | `✅ / ⚠️ / ❌` |

### 4.5 Envelope 漂移与 Drift Gate

| 检查 | 结果 |
|------|------|
| `pnpm check:envelope-drift` | `✅ green / ❌ failed at {WHERE}` |
| `pnpm check:tool-drift` | `✅ / ❌` |
| `pnpm check:cycles` | `✅ / ❌` |
| `pnpm check:megafile` | `✅ / ❌` |
| 错误信封 drift（人工核查） | `✅ / 列出违例：{LIST}` |

---

## 5. Findings 总账

> 全部 finding 集中到这一张表，便于跨轮追踪。  
> 编号规则：`{级别前缀}-{簇短码}-{两位序号}`。  
> 级别前缀：`C` = CRITICAL，`F` = FINDING，`W` = WARN，`O` = OBSERVATION。  
> 例：`C-CHK-01`、`F-AUTH-01`、`W-CAT-01`、`O-CHK-01`。

### 5.1 Finding 汇总表

| ID | 严重 | 簇 | 端点 | 维度 | 标题 | 影响 | 是否 blocker | 行动项编号 |
|----|------|----|------|------|------|------|--------------|------------|
| `C-{CLUSTER}-01` | 🔴 | `{CLUSTER}` | `{ENDPOINT}` | F4 | `{TITLE}` | `{IMPACT}` | yes | A1 |
| `F-{CLUSTER}-01` | ❌ | `{CLUSTER}` | `{ENDPOINT}` | F3 | `{TITLE}` | `{IMPACT}` | yes | A2 |
| `W-{CLUSTER}-01` | ⚠️ | `{CLUSTER}` | `{ENDPOINT}` | F2 | `{TITLE}` | `{IMPACT}` | no | A3 |
| `O-{CLUSTER}-01` | 📝 | `{CLUSTER}` | `{ENDPOINT}` | F5 | `{TITLE}` | `{NOTE}` | no | — |

### 5.2 Finding 详情

> 每条 finding 都用统一结构展开，便于实现者按编号修复、reviewer 按编号复核。

#### `C-{CLUSTER}-01` — `{TITLE}`

- **严重级别**：🔴 CRITICAL
- **簇 / 端点**：`{CLUSTER} / {METHOD} {PATH}`
- **维度**：`F1 / F2 / F3 / F4 / F5 / F6`
- **是否 blocker**：yes
- **事实依据**：
  - `{FILE}:{LINE}` —— `{CITED_CODE_OR_BEHAVIOR}`
  - `{API_DOC_PATH}:{LINE}` —— `{DOC_CLAIM}`
  - 契约对照：`{CONTRACT_FILE}:{LINE}`
- **为什么重要**：
  - `{WHY_MATTERS}`（破坏什么、影响哪些客户端、违反哪条 Q-law / 契约）
- **修法（What + How）**：
  - **改什么**：`{WHAT_TO_CHANGE}`（例：从错误响应中移除 `data` 字段）
  - **怎么改**：`{HOW_TO_CHANGE}`（例：把 `confirmation` 移入 `error.details`，或直接删除）
  - **改完后的形态**：`{TARGET_SHAPE}`（贴 schema 或代码片段）
  - **测试增量**：`{NEW_TESTS}`（例：补 409 错误响应不带 `data` 的断言）
- **建议行动项**：`A{N}`（与 §6 对齐）
- **复审要点**：`{WHAT_REREVIEWER_SHOULD_VERIFY}`

#### `F-{CLUSTER}-01` — `{TITLE}`

*（同上结构）*

#### `W-{CLUSTER}-01` — `{TITLE}`

*（同上结构）*

---

## 6. 行动建议（按优先级）

> 把 Findings 转成可直接转入 action-plan 的工作项。Owner 可以照这一张表立刻开工。  
> 优先级：`P0` = 必须修才能声明合规；`P1` = 应修且影响协议正确性；`P2` = 建议修。

| # | 优先级 | 关联 Finding | 簇 / 端点 | 行动项 | 涉及文件 | 测试要求 | 工作量 |
|---|--------|--------------|-----------|--------|----------|----------|--------|
| **A1** | P0 | `C-{CLUSTER}-01` | `{CLUSTER}/{ENDPOINT}` | `{ACTION}` | `{FILES}` | `{TESTS}` | `XS / S / M / L` |
| **A2** | P1 | `F-{CLUSTER}-01` | `{CLUSTER}/{ENDPOINT}` | `{ACTION}` | `{FILES}` | `{TESTS}` | `XS / S / M / L` |
| **A3** | P2 | `W-{CLUSTER}-01` | `{CLUSTER}/{ENDPOINT}` | `{ACTION}` | `{FILES}` | `{TESTS}` | `XS / S / M / L` |

### 6.1 整体修复路径建议

> 用一段话给出推荐的修复顺序与节奏（先改 envelope 还是先补测试、能否合并 PR 等）。  
> 避免每条 action 都开独立 PR 导致 churn，但也避免一个 PR 把多个语义混在一起。

`{INTEGRATION_STRATEGY}`

### 6.2 不在本轮修复的项（defer 与原因）

| Finding ID | 不修原因 | 重评条件 | Owner | 下次复审日期 |
|------------|----------|----------|-------|--------------|
| `{ID}` | `{REASON}` | `{REVISIT_CONDITION}` | `{OWNER}` | `{DATE}` |

---

## 7. 测试覆盖矩阵

> 按端点 × 测试层把覆盖度可视化，便于一眼看出 F2 缺口在哪里。

| 端点 | 单元测试 | 集成 / 路由测试 | E2E / live 测试 | 错误路径覆盖 | 覆盖度评级 |
|------|----------|-----------------|------------------|--------------|------------|
| `{METHOD} {PATH}` | `{FILE_OR_DASH}` | `{FILE_OR_DASH}` | `{FILE_OR_DASH}` | `happy / +400 / +401 / +404 / +409 / +503` | `✅ / ⚠️ / ❌` |
| `{METHOD} {PATH}` | | | | | |

### 7.1 测试缺口清单（按优先级）

| 端点 | 缺什么 | 建议补在哪 | 关联 Finding |
|------|--------|------------|--------------|
| `{METHOD} {PATH}` | `{MISSING_TEST}` | `{TEST_FILE}` | `{ID}` |

---

## 8. 文件 & 引用索引

| 文件 | 行号范围 | 角色 |
|------|----------|------|
| `{FACADE_ENTRY}` | `{LINES}` | 路由解析 / 调度入口 |
| `{HANDLER_FILE}` | `{LINES}` | 业务 handler |
| `{AUTH_FILE}` | `{LINES}` | 鉴权 / 设备 gate / authority 翻译 |
| `{REPO_FILE}` | `{LINES}` | D1 / R2 / RPC 后端 |
| `{CONTRACT_FILE}` | `{LINES}` | Frozen contract / envelope schema |
| `{TEST_FILE}` | `{LINES}` | 测试覆盖 |
| `{API_DOC_PATH}` | `{LINES}` | 受查文档 |

---

## 9. 复审与回应入口

### 9.1 实现者回应入口

> 实现者应按 `docs/templates/code-review-respond.md` 的形式在本文档 §10 append 回应；**不要改写 §0 – §8**。回应应逐条引用 Finding ID 给出处理结果（已修 / 不修 / 推迟），并贴出 PR / commit 链接。

### 9.2 二次审查方式

- **建议方式**：`same reviewer rereview | independent reviewer | no rereview needed`
- **二次审查触发条件**：
  - `{TRIGGER_1}`（例：`A1` PR merged）
  - `{TRIGGER_2}`（例：drift gate 重新跑过且全绿）
- **二次审查应重点核查**：
  1. `{REREVIEW_FOCUS_1}`
  2. `{REREVIEW_FOCUS_2}`

### 9.3 合规声明前的 blocker

> 在以下 blocker 全部关闭前，**不得**对外声明本批 API 已 NACP 合规。

1. `{BLOCKER_1}` — Finding `{ID}` —— Action `A1`
2. `{BLOCKER_2}` — Finding `{ID}` —— Action `A2`

---

## 10. 实现者回应（仅在 `re-reviewed` 状态使用）

> 文档状态切到 `changes-requested` 后，实现者把修复结论 append 在这一节，按 Finding ID 一条一条回。

### 10.1 回应汇总表

| Finding ID | 处理结果 | PR / Commit | 验证证据 | reviewer 复核结论 |
|------------|----------|-------------|----------|-------------------|
| `C-{CLUSTER}-01` | `已修 / 不修-defer / 不接受` | `{LINK}` | `{TEST_OR_GATE}` | `accepted / rejected / pending` |
| `F-{CLUSTER}-01` | | | | |

### 10.2 逐条回应

#### 回应 `C-{CLUSTER}-01`

- **处理决定**：`已修 / 不修-defer / 不接受`
- **改了什么**：`{WHAT_CHANGED}`
- **PR / Commit**：`{LINK}`
- **新增 / 改动测试**：`{TESTS}`
- **drift gate 结果**：`{GATE_RESULT}`
- **reviewer 复核意见**：`{REVIEW_VERDICT}`

*（按需展开其它 Finding）*

---

## 附：模板使用说明（写完后可删）

1. **文件命名建议**：`docs/eval/{phase}/api-compliance/part{N}-by-{evaluator}.md`，与已有 `part1-by-deepseek.md` 等保持一致。
2. **多评审者并行**：每位评审者各自填一份；汇总报告（如有）可在 §0 引用每份的 Finding ID。
3. **轻量场景**：单簇调查可省略 §4（跨簇 NACP），但 §0 / §1.1 / §2 / §3 / §5 / §6 / §9 必填。
4. **重审场景**：复审只需新建 §10，并在 §0 verdict 处更新结论；§0 – §8 保持原文不动以留存历史。
5. **与现有体系对齐**：所有 SSoT 引用必须指向 frozen contract（`packages/*-contract`）或 design / Q-law（`docs/design/`、`docs/charter/`）。代码引用必须带 `file:line`。
