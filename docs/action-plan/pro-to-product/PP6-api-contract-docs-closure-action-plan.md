# Nano-Agent 行动计划

> 服务业务簇: `pro-to-product / PP6 — API Contract Sweep + Frontend Docs Closure + Final Closure`
> 计划对象: `扫描全部 frontend-facing public surfaces，逐项更新 clients/api-docs，并完成 pro-to-product final closure`
> 类型: `modify`
> 作者: `GPT-5.5`
> 时间: `2026-05-03`
> 文件位置: `docs/action-plan/pro-to-product/PP6-api-contract-docs-closure-action-plan.md`
> 上游前序 / closure:
> - `docs/action-plan/pro-to-product/PP0-charter-truth-lock-action-plan.md`
> - `docs/action-plan/pro-to-product/PP1-hitl-interrupt-closure-action-plan.md`
> - `docs/action-plan/pro-to-product/PP2-context-budget-closure-action-plan.md`
> - `docs/action-plan/pro-to-product/PP3-reconnect-session-recovery-action-plan.md`
> - `docs/action-plan/pro-to-product/PP4-hook-delivery-closure-action-plan.md`
> - `docs/action-plan/pro-to-product/PP5-policy-reliability-hardening-action-plan.md`
> - `docs/issue/pro-to-product/PP0-closure.md` 至 `PP5-closure.md`
> - `docs/design/pro-to-product/07-api-contract-docs-closure.md`
> 下游交接:
> - `docs/issue/pro-to-product/PP6-closure.md`
> - `docs/issue/pro-to-product/pro-to-product-final-closure.md`
> - 下一阶段 SDK / platform-foundations handoff（若 owner 启动）
> 关联设计 / 调研文档:
> - `docs/design/pro-to-product/00-agent-loop-truth-model.md`
> - `docs/design/pro-to-product/01-frontend-trust-contract.md`
> - `docs/design/pro-to-product/PPX-qna.md` Q21-Q22
> 冻结决策来源:
> - `docs/design/pro-to-product/PPX-qna.md` Q21（PP6 docs closure 只要求 truthful readiness，不要求所有功能 fully complete）
> - `docs/design/pro-to-product/PPX-qna.md` Q22（PP6 不引入 OpenAPI / doc generator，维持人工 item-by-item markdown truth）
> - `docs/design/pro-to-product/PPX-qna.md` Q5（PP6 只扫 frontend-facing public surfaces）
> 文档状态: `draft`

---

## 0. 执行背景与目标

PP6 是 pro-to-product 的最终合同收口阶段。它的任务不是“补功能”，也不是“全仓 architecture re-audit”，而是把 PP1-PP5 已经形成的 public truth 逐项映射到 `clients/api-docs`，让未来前端按文档开发时不会踩到 fake-live、stored-not-enforced、undocumented degraded、WS frame drift 或 error code 漏项。

当前 docs pack 已有 22 份文档，README 也明确 public facade owner 是 `orchestrator-core`，内部 workers 不对客户端暴露（`clients/api-docs/README.md:1-75`）。facade route truth 由 `dispatchFacadeRoute()` 串起 health/debug、auth、catalog、me、models、context、files、runtime、items、control、model、bridge 等 handler（`workers/orchestrator-core/src/facade/route-registry.ts:16-60`）；legacy session actions 仍在 `session-bridge.ts` 中定义（`workers/orchestrator-core/src/facade/routes/session-bridge.ts:14-32`）；confirmations/checkpoints/todos 在 session-control route 中分发（`session-control.ts:664-674`）；WS docs 已有 13-kind stream catalog 与 `system.error` shape（`clients/api-docs/session-ws-v1.md:44-111`）；error-index 已有 ad-hoc public code 表（`clients/api-docs/error-index.md:73-108`）。参考上，Codex 的 app-server-protocol 长期走 typed protocol export（`context/codex/codex-rs/app-server-protocol/src/lib.rs:17-43`），但 Q22 已冻结 PP6 不引入 generator，先以人工 item-by-item 对账完成 markdown truth。

- **服务业务簇**：`pro-to-product / PP6 — API Contract Sweep + Frontend Docs Closure + Final Closure`
- **计划对象**：`clients/api-docs 22-doc pack + public route/frame/error/readiness matrix + final closure`
- **本次计划解决的问题**：
  - `clients/api-docs` 仍处于 hero-to-pro frozen pack 口径，需要吸收 PP1-PP5 的真实 runtime changes。
  - endpoint matrix、WS frames、error-index、runtime fields、readiness labels 可能与代码事实漂移。
  - final closure 需要用 7 truth gates 对 PP0-PP6 逐项判定，而不是用“文档已更新”替代产品 truth。
- **本次计划的直接产出**：
  - `clients/api-docs/` 22-doc pack 的 item-by-item 更新；若 PP4 形成 public hook surface，则新增 `hooks.md` 或合并 hook contract 到对应专题。
  - `docs/issue/pro-to-product/PP6-closure.md`
  - `docs/issue/pro-to-product/pro-to-product-final-closure.md`
- **本计划不重新讨论的设计结论**：
  - PP6 只要求 truthful readiness，不要求所有功能 fully complete（来源：`PPX-qna.md` Q21）。
  - readiness label 必须可枚举：`live / first-wave / schema-live / registry-only / not-enforced`（来源：`PPX-qna.md` Q21）。
  - PP6 不引入 OpenAPI/doc generator；下一阶段若做 SDK，再登记 type generation handoff（来源：`PPX-qna.md` Q22）。

---

## 1. 执行综述

### 1.1 总体执行方式

PP6 采用 **先 inventory，再 route/frame/error sweep，再 readiness label，再 final closure** 的执行方式。第一步冻结 22-doc pack 与新增 hook docs 判定；第二步以 facade route registry、route parsers、WS frame emitters、error registry 为事实来源逐项对账；第三步把每个 endpoint/frame/error/runtime field 写入 readiness label；第四步汇总 PP0-PP6 closure，输出 final closure verdict。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Docs Pack Inventory | `S` | 确认 22-doc pack、缺失专题、hook docs 是否新增 | `PP5 closure` |
| Phase 2 | Facade Endpoint Matrix Sweep | `L` | README matrix 与 facade route registry/parser 逐项对齐 | `Phase 1` |
| Phase 3 | WS Frame / Error / Readiness Sweep | `L` | 对齐 WS catalog、system.error、error-index 与 readiness labels | `Phase 2` |
| Phase 4 | Docs Update & Consistency Checks | `M` | 更新 clients/api-docs 并运行 docs consistency/diff hygiene | `Phase 3` |
| Phase 5 | PP6 Closure & Final Closure | `M` | 输出 PP6 closure、7 truth gates verdict 与 final closure | `Phase 4` |

### 1.3 Phase 说明

1. **Phase 1 — Docs Pack Inventory**
   - **核心目标**：确认当前 22-doc pack 是否完整，决定是否需要 `hooks.md`。
   - **为什么先做**：没有 inventory，后续 sweep 会漏专题或重复写到不合适文档。
2. **Phase 2 — Facade Endpoint Matrix Sweep**
   - **核心目标**：以 `dispatchFacadeRoute()` 与各 route parser 为 public route truth，更新 README 和各专题 endpoint list。
   - **为什么放在这里**：endpoint 是前端首先依赖的合同骨架。
3. **Phase 3 — WS Frame / Error / Readiness Sweep**
   - **核心目标**：对齐 stream frames、system.error、HTTP error code、runtime field readiness。
   - **为什么放在这里**：前端交互最容易被 frame/error drift 击穿。
4. **Phase 4 — Docs Update & Consistency Checks**
   - **核心目标**：将对账结果写回 `clients/api-docs`，并做一致性检查。
   - **为什么放在这里**：先调查再更新，避免边查边写造成口径漂移。
5. **Phase 5 — PP6 Closure & Final Closure**
   - **核心目标**：用 7 truth gates 判定 pro-to-product 是否 full close / close-with-known-issues / cannot close。
   - **为什么放在最后**：final closure 必须建立在 docs 与代码对齐之后。

### 1.4 执行策略说明

- **执行顺序原则**：inventory → route matrix → frame/error/readiness → docs patch → closure。
- **风险控制原则**：只扫 frontend-facing public surface；service-binding RPC/internal helpers 不进入 client docs。
- **测试推进原则**：docs consistency + route/doc manual matrix + targeted grep；不新增 generator。
- **文档同步原则**：所有 public surface 都写 readiness label，不能只写 endpoint exists。
- **回滚 / 降级原则**：发现 PP1-PP5 功能 truth 不成立时，docs 写当前代码事实，final closure 登记 cannot-close/known issue，不在 PP6 临时补大实现。

### 1.5 本次 action-plan 影响结构图

```text
PP6 API Contract Docs Closure
├── Phase 1: Docs Pack Inventory
│   ├── clients/api-docs/README.md
│   └── clients/api-docs/*.md (22-doc pack)
├── Phase 2: Facade Endpoint Matrix Sweep
│   ├── workers/orchestrator-core/src/facade/route-registry.ts
│   ├── workers/orchestrator-core/src/facade/routes/*.ts
│   └── clients/api-docs/{README,session,runtime,context,...}.md
├── Phase 3: WS Frame / Error / Readiness Sweep
│   ├── clients/api-docs/session-ws-v1.md
│   ├── clients/api-docs/error-index.md
│   ├── packages/nacp-session / packages/nacp-core schemas
│   └── PP1-PP5 closure evidence
├── Phase 4: Docs Update & Consistency Checks
│   ├── clients/api-docs/**
│   └── scripts/check-docs-consistency.mjs
└── Phase 5: PP6 Closure & Final Closure
    ├── docs/issue/pro-to-product/PP6-closure.md
    └── docs/issue/pro-to-product/pro-to-product-final-closure.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 22-doc pack inventory：`README / auth / catalog / checkpoints / client-cookbook / confirmations / context / error-index / items / me-sessions / models / permissions / runtime / session-ws-v1 / session / todos / tool-calls / transport-profiles / usage / wechat-auth / worker-health / workspace`。
- **[S2]** facade route matrix sweep：health/debug/auth/catalog/me/models/context/files/runtime/items/control/model/bridge。
- **[S3]** WS frame sweep：outer frame kind、payload kind、confirmation frames、replay_lost/degraded、hook.broadcast、system.error。
- **[S4]** error-index sweep：facade schema codes、ad-hoc public codes、system.error registry、retryable/category/http_status。
- **[S5]** readiness label sweep：每个 endpoint/frame/error/runtime field 标 `live / first-wave / schema-live / registry-only / not-enforced`。
- **[S6]** hook contract docs：若 PP4 暴露 public hook surface，则新增 `hooks.md` 或把 contract 合并到 runtime/session-ws/permissions。
- **[S7]** PP6 closure 与 pro-to-product final closure。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 不扫描 internal service-binding RPC、worker-to-worker seam、implementation-only helper。
- **[O2]** 不引入 OpenAPI、schema generator、SDK extraction。
- **[O3]** 不为 docs sweep 临时实现 PP1-PP5 未完成的大功能。
- **[O4]** 不重写 6-worker topology 或 facade owner law。
- **[O5]** 不把 readiness label 变成营销文案；必须与代码/closure evidence 对齐。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| public facade HTTP routes | `in-scope` | frontend 直接调用 | 无 |
| public WS frames | `in-scope` | frontend 直接订阅 | 无 |
| debug routes | `in-scope if frontend inspector uses` | public facade GET，可被前端诊断消费；Phase 1 inventory 必须为每条 debug route 标记 `frontend-inspector=yes/no` | 若明确仅内部运维使用，可标 admin/debug-only |
| service binding RPC | `out-of-scope` | 前端不直连 | SDK/admin charter 改边界 |
| OpenAPI generator | `out-of-scope` | Q22 冻结不引入 | 下一阶段 SDK/typegen |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | 22-doc inventory | `update` | `clients/api-docs/README.md` | 文档包完整且入口清晰 | `low` |
| P1-02 | Phase 1 | Hook docs placement | `add/update` | `clients/api-docs/hooks.md` or related docs | PP4 hook contract 不游离 | `medium` |
| P2-01 | Phase 2 | Route registry sweep | `update` | README endpoint matrix + route docs | route 不漏不多 | `high` |
| P2-02 | Phase 2 | Legacy/profile sweep | `update` | `session.md`, `transport-profiles.md` | legacy-do-action 与 facade-http-v1 不混淆 | `medium` |
| P3-01 | Phase 3 | WS frame catalog sweep | `update` | `session-ws-v1.md` | frame kind/payload kind 对齐 | `high` |
| P3-02 | Phase 3 | Error-index sweep | `update` | `error-index.md`, error registry | code/category/retryable 对齐 | `high` |
| P3-03 | Phase 3 | Readiness labels | `update` | all relevant docs | 每个 surface 有可枚举 label | `high` |
| P4-01 | Phase 4 | Docs patch batch | `update` | `clients/api-docs/*.md` | 写回对账结果 | `medium` |
| P4-02 | Phase 4 | Consistency checks | `update` | scripts/tests if needed | docs consistency 通过 | `medium` |
| P5-01 | Phase 5 | PP6 closure | `add` | `docs/issue/pro-to-product/PP6-closure.md` | docs closure 证据完整 | `low` |
| P5-02 | Phase 5 | Final closure | `add` | `docs/issue/pro-to-product/pro-to-product-final-closure.md` | 阶段 verdict 成立 | `medium` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Docs Pack Inventory

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | 22-doc inventory | 对 `clients/api-docs` 当前文件与 README 22-doc index 对账 | `clients/api-docs/README.md` | pack 清单准确 | file list + review | 无缺失/多余未解释文档 |
| P1-02 | Hook docs placement | 根据 PP4 的 public owner file 冻结 docs 位置：若新增 `workers/orchestrator-core/src/facade/routes/session-hooks.ts`，则新增 `hooks.md`；若最终复用既有 route owner，则合并到对应专题 | hook docs | hook contract 有唯一位置 | docs review | PP4 public surface 不游离 |

### 4.2 Phase 2 — Facade Endpoint Matrix Sweep

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | Route registry sweep | 对照 `dispatchFacadeRoute()` 与各 route parser 更新 README matrix | route-registry/routes + README | endpoint matrix 对齐代码 | manual route matrix | 不漏 public route，不写 internal RPC |
| P2-02 | Legacy/profile sweep | 标明 `facade-http-v1`、`legacy-do-action`、`session-ws-v1`、`binary-content` 等 profile | transport docs/session docs | client 知道 envelope shape | docs review | profile 与 route 返回一致 |

### 4.3 Phase 3 — WS Frame / Error / Readiness Sweep

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | WS frame catalog sweep | 对齐 outer frame、payload kind、confirmation、replay_lost、hook、system.error | `session-ws-v1.md`, schemas | frame catalog 可开发 | schema/code review | kind/shape/status 不漂移 |
| P3-02 | Error-index sweep | 对齐 public error codes、system.error、retryable/category/http_status | `error-index.md`, nacp-core | client 可分类错误 | docs tests/grep | 无 undocumented public code |
| P3-03 | Readiness labels | 为 endpoint/frame/error/runtime field 标 readiness label | all docs | truthful readiness | manual checklist | 无 unknown label |

### 4.4 Phase 4 — Docs Update & Consistency Checks

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | Docs patch batch | 按调查结果更新 `clients/api-docs` | docs pack | docs 与代码事实一致 | review | 无 fake-live/stored-not-enforced drift |
| P4-02 | Consistency checks | 运行 docs consistency、diff check、必要 grep | scripts/docs | 格式/一致性通过 | commands | no diff whitespace/consistency errors |

### 4.5 Phase 5 — PP6 Closure & Final Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | PP6 closure | 写 PP6 docs closure，列出 pack sweep、labels、remaining docs gaps | `PP6-closure.md` | PP6 可审查 | docs review | closure evidence 完整 |
| P5-02 | Final closure | 汇总 PP0-PP6 closure，按 7 truth gates 与 PP0 unified evidence shape / `latency_alert.threshold_key / exceeded_count / accepted_by_owner / repro_condition` 给最终 verdict | `pro-to-product-final-closure.md` | 阶段收口诚实 | closure review | full close / known issues / cannot close 判定有证据 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Docs Pack Inventory

- **Phase 目标**：确认文档包边界，避免 PP6 漏扫或扩张。
- **本 Phase 对应编号**：`P1-01`, `P1-02`
- **本 Phase 新增文件**：
  - `clients/api-docs/hooks.md`（仅当 PP4 public hook surface 需要独立专题）。
- **本 Phase 修改文件**：
  - `clients/api-docs/README.md`
- **具体功能预期**：
  1. 22-doc pack 与文件系统一致。
  2. README 说明 pro-to-product baseline 与 readiness label law。
  3. hook docs 位置由 PP4 public owner file 触发：`session-hooks.ts` → 新增 `hooks.md`；否则合并到已有专题并在 README 标明唯一 owner。
- **具体测试安排**：
  - **单测**：无。
  - **集成测试**：无。
  - **回归测试**：docs consistency（如覆盖）。
  - **手动验证**：`find clients/api-docs -maxdepth 1 -type f | sort` 与 README index 对照。
- **收口标准**：
  - pack inventory 无歧义。
  - service-binding/internal docs 不混入 pack。
- **本 Phase 风险提醒**：
  - 不要为了“完整”新增无前端消费意义的专题。

### 5.2 Phase 2 — Facade Endpoint Matrix Sweep

- **Phase 目标**：让 README endpoint matrix 与代码路由一致。
- **本 Phase 对应编号**：`P2-01`, `P2-02`
- **本 Phase 新增文件**：
  - route matrix audit artifact（可写入 closure，不一定新建独立文件）。
- **本 Phase 修改文件**：
  - `clients/api-docs/README.md`
  - 各 endpoint family docs。
- **具体功能预期**：
  1. 每个 public facade route 都有 docs 位置。
  2. route profile 与 response envelope 一致。
  3. legacy routes 标明 legacy/readiness，不被写成主合同。
- **具体测试安排**：
  - **单测**：无。
  - **集成测试**：可选 route extraction script（不引入新工具链）。
  - **回归测试**：docs consistency。
  - **手动验证**：逐个 route parser 与 README matrix 对账。
- **收口标准**：
  - README matrix 不漏 public route。
  - docs 不包含 internal RPC。
- **本 Phase 风险提醒**：
  - handler 顺序也是 contract：早匹配 route 与 fallback 404 都要如实写。

### 5.3 Phase 3 — WS Frame / Error / Readiness Sweep

- **Phase 目标**：让客户端可按 frame/error/label 写稳定分支。
- **本 Phase 对应编号**：`P3-01`, `P3-02`, `P3-03`
- **本 Phase 新增文件**：
  - 无固定新增；hook docs 视 Phase 1 决定。
- **本 Phase 修改文件**：
  - `clients/api-docs/session-ws-v1.md`
  - `clients/api-docs/error-index.md`
  - `clients/api-docs/runtime.md`
  - `clients/api-docs/context.md`
  - `clients/api-docs/confirmations.md`
  - 其他受 PP1-PP5 truth 影响的 docs。
- **具体功能预期**：
  1. outer frame `kind` 与 stream payload `kind` 不混淆。
  2. `system.error`、retryable degraded、replay_lost、hook.broadcast、confirmation frames 被诚实描述。
  3. 所有 runtime fields 与 public surfaces 都有 readiness label。
- **具体测试安排**：
  - **单测**：error registry parity tests（若已有）。
  - **集成测试**：docs consistency。
  - **回归测试**：`pnpm run check:docs-consistency`。
  - **手动验证**：grep public code/kind 与 docs 表格。
- **收口标准**：
  - 无 unknown readiness。
  - 无 undocumented degraded/error path。
- **本 Phase 风险提醒**：
  - `schema-live`、`registry-only`、`not-enforced` 不能混用。

### 5.4 Phase 4 — Docs Update & Consistency Checks

- **Phase 目标**：把 sweep 结果写入 docs，并消除格式/一致性问题。
- **本 Phase 对应编号**：`P4-01`, `P4-02`
- **本 Phase 新增文件**：
  - 仅当 hook docs 需要独立专题。
- **本 Phase 修改文件**：
  - `clients/api-docs/**/*.md`
- **具体功能预期**：
  1. 每份 docs 的 header / scope / readiness 与 code facts 对齐。
  2. docs 不引用 design 愿景作为功能事实。
  3. docs consistency 与 diff check 通过。
- **具体测试安排**：
  - **单测**：无。
  - **集成测试**：docs consistency。
  - **回归测试**：`pnpm run check:docs-consistency`。
  - **手动验证**：`git --no-pager diff --check -- clients/api-docs`.
- **收口标准**：
  - docs pack 无 fake-live。
  - markdown links/anchors 基本可用。
- **本 Phase 风险提醒**：
  - 不要让 docs “为了好看”隐藏 known limitations。

### 5.5 Phase 5 — PP6 Closure & Final Closure

- **Phase 目标**：完成本阶段最终 verdict。
- **本 Phase 对应编号**：`P5-01`, `P5-02`
- **本 Phase 新增文件**：
  - `docs/issue/pro-to-product/PP6-closure.md`
  - `docs/issue/pro-to-product/pro-to-product-final-closure.md`
- **本 Phase 修改文件**：
  - 无固定修改；如 final closure 模板要求可同步 index。
- **具体功能预期**：
  1. PP6 closure 列出 docs pack inventory、route sweep、frame/error sweep、readiness label coverage。
  2. final closure 按 7 truth gates 给出 verdict，并只消费 PP1-PP5 按 PP0 unified evidence shape 输出的证据。
  3. 若下一阶段 SDK/type generation 必要，登记 handoff signal，不在 PP6 实现 generator。
- **具体测试安排**：
  - **单测**：无。
  - **集成测试**：无。
  - **回归测试**：全部必要 docs checks。
  - **手动验证**：PP0-PP5 closure evidence 都被引用，未满足项不会被包装成完成。
- **收口标准**：
  - final closure verdict 可追溯到 PP0-PP6 evidence。
  - 若任一 truth gate 未满足，明确 cannot close 或 close-with-known-issues，不强行 full close。
- **本 Phase 风险提醒**：
  - final closure 是事实裁决，不是阶段宣传稿。

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q5 | `PPX-qna.md` Q5 | 只扫 frontend-facing public surfaces | 若扩 internal RPC，PP6 scope 失控 |
| Q21 | `PPX-qna.md` Q21 | docs closure 要 truthful readiness，不要求 fully complete | 若要求 fully complete，PP6 会重开 PP1-PP5 |
| Q22 | `PPX-qna.md` Q22 | 不引入 OpenAPI/doc generator | 若引入，需要新 action-plan/tooling phase |
| T7 | `plan-pro-to-product.md` §10.1 | frontend contract truth 是 final hard gate | 未满足则 final cannot close |
| PP1-PP5 closure | phase closure docs | docs 写真实完成度 | 若 closure 缺证据，PP6 必须登记 gap |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| PP6 变全仓审计 | internal RPC/service binding 被纳入 | `high` | 严格 facade-only + frontend-facing |
| readiness label 混乱 | live/schema-live/registry-only/not-enforced 混用 | `high` | 每项 surface 强制 5 选 1 |
| route 漏扫 | 只看 README 不看 route parser | `high` | route-registry + parser sweep |
| docs 掩盖未完成 | 为了 full close 写成 live | `high` | Q21 truthful readiness + final closure truth gates |
| generator scope creep | PP6 临时引入 OpenAPI | `medium` | Q22 禁止，本阶段只登记后续 handoff |

### 7.2 约束与前提

- **技术前提**：PP1-PP5 closure 已完成，且各自 truth evidence 可引用。
- **运行时前提**：public facade route registry 与 clients docs 均可访问。
- **组织协作前提**：FE-3 需要对 updated docs 做 integration/readiness review。
- **上线 / 合并前提**：docs 不得含 internal RPC contract 或无法追溯的愿景功能。

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - 原则上无；PP6 是 design 执行层，不改 owner decisions。
  - 若 docs sweep 发现 design/QNA 与代码事实冲突，必须先在本 action-plan 或 `PP6-closure.md` 记录发现，再判断是否回到 `PPX-qna.md` 补充 / 修订答案，并同步通知 final closure reviewer。
- 需要同步更新的说明文档 / README：
  - `clients/api-docs/**/*.md`
  - `docs/issue/pro-to-product/PP6-closure.md`
  - `docs/issue/pro-to-product/pro-to-product-final-closure.md`
- 需要同步更新的测试说明：
  - docs consistency/check commands 与 sweep method 写入 PP6 closure。

### 7.4 完成后的预期状态

1. 前端依赖的 public HTTP/WS/error/runtime/docs surface 与代码事实对齐。
2. 每个 endpoint/frame/error/runtime field 都有 truthful readiness label。
3. `clients/api-docs` 不再保留 hero-to-pro fake-live 或 stored-not-enforced drift。
4. `pro-to-product-final-closure.md` 能诚实判定本阶段是否满足 7 truth gates。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `git --no-pager diff --check -- docs/action-plan/pro-to-product/PP6-api-contract-docs-closure-action-plan.md`
  - `git --no-pager diff --check -- clients/api-docs`
- **单元测试**：
  - 无新增单元测试要求；若 error registry parity 已有，运行对应 package tests。
- **集成测试**：
  - `pnpm run check:docs-consistency`
  - route matrix/manual parser sweep。
- **端到端 / 手动验证**：
  - FE-3 item-by-item docs review：frontend 按 docs 能理解 auth、session、WS、runtime、HITL、context、recovery、hook、policy degraded。
- **回归测试**：
  - 若 docs sweep 发现并修正 contract tests，则运行对应 worker/package tests。
- **文档校验**：
  - README 22-doc index、endpoint matrix、frame catalog、error-index、readiness labels 全部自检。

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. 22-doc pack inventory 与文件系统一致，hook docs 位置明确。
2. README endpoint matrix 与 facade route truth 对齐。
3. WS frames、system.error、error-index 与 schemas/emitters 对齐。
4. 所有 public surface 都有 readiness label，且无 fake-live/stored-not-enforced drift。
5. PP6 closure 与 final closure 都能引用 PP0-PP5 evidence。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | PP6 不补功能，只完成 frontend contract truth |
| 测试 | docs consistency、diff hygiene、manual route/frame/error sweep 完成 |
| 文档 | clients/api-docs 22-doc pack 与代码事实对齐 |
| 风险收敛 | 无 internal RPC 泄漏、无 readiness label unknown、无 generator scope creep |
| 可交付性 | final closure 可判定 pro-to-product 是否正式收口 |
