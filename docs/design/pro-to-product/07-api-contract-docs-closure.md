# PP6 / API Contract Docs Closure

> 功能簇: `PP6 / API Contract Docs Closure`
> 讨论日期: `2026-05-02`
> 讨论者: `GPT-5.5`
> 关联调查报告:
> - `docs/charter/plan-pro-to-product.md`
> - `docs/design/pro-to-product/01-frontend-trust-contract.md`
> - `docs/design/pro-to-product/02-hitl-interrupt-closure.md`
> - `docs/design/pro-to-product/03-context-budget-closure.md`
> - `docs/design/pro-to-product/04-reconnect-session-recovery.md`
> - `docs/design/pro-to-product/05-hook-delivery-closure.md`
> - `docs/design/pro-to-product/06-policy-reliability-hardening.md`
> 关联 QNA / 决策登记:
> - `docs/charter/plan-pro-to-product.md` §10 T7, §12 Q3
> 文档状态: `draft`

---

## 0. 背景与前置约束

- **项目定位回顾**：前端团队实际按 `clients/api-docs` 开发；因此 pro-to-product 不能在 PP5 直接 closure，必须用 PP6 做 final public contract sweep。
- **本次讨论的前置共识**：
  - `clients/api-docs` 当前是 22-doc pack。
  - PP6 只扫描 frontend-facing public surfaces，不扫描 internal RPC / worker-to-worker binding。
- **本设计必须回答的问题**：
  - PP6 sweep 的边界是什么？
  - 如何判定一条 API docs item 正确？
  - 如何处理 first-wave/schema-live/not-yet-enforced 的诚实标注？
- **显式排除的讨论范围**：
  - 不重写全部文档风格。
  - 不新增 SDK 或 OpenAPI 生成系统。

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`API Contract Docs Closure`
- **一句话定义**：逐项对账 public HTTP/WS/debug/error/runtime surfaces，把 `clients/api-docs` 更新到前端可执行 contract。
- **边界描述**：包含 22-doc pack、facade route registry、session bridge/control/context/runtime/items/files/models/debug/auth/me/catalog、WS frames、error-index、readiness matrix；不包含 internal RPC、worker binding、implementation-only helpers。

| 术语 | 定义 | 备注 |
|------|------|------|
| `authoritative pack` | `clients/api-docs/*.md` | 当前 22 份 |
| `public surface` | 前端可直接 HTTP/WS 调用/订阅的 surface | facade owner |
| `readiness label` | live / first-wave / schema-live / registry-only / not-enforced | PP6 必填 |
| `item-by-item sweep` | 每个 endpoint/frame/code/field 对照真实代码 | 不是抽样 |
| `docs closure` | 文档与代码事实一致，且已标明限制 | 不等于功能全完 |

### 1.2 参考调查报告

- `docs/design/pro-to-product/00-agent-loop-truth-model.md` — 7 truth gates 与 final closure 硬闸。
- `docs/design/pro-to-product/01-frontend-trust-contract.md` — public/internal 边界。
- `clients/api-docs/README.md` — 当前文档包与 endpoint matrix。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

PP6 是 pro-to-product 的 final closure phase。它不负责补新功能，而负责把 PP1-PP5 的真实完成度翻译成前端合同：哪些 endpoint live、哪些 first-wave、哪些 schema-live、哪些 config-only/not-enforced、哪些错误码可稳定处理。它必须坚持“代码事实优先于计划口径”，即便某个设计原本承诺更多，docs 也只能写真实行为。

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|----------|----------|------|
| `01-frontend-trust-contract` | `01 → 07` | 强 | 定义 public/internal 边界 |
| `02-hitl-interrupt-closure` | `02 → 07` | 强 | confirmations/permissions/docs 更新 |
| `03-context-budget-closure` | `03 → 07` | 强 | context manual/auto compact readiness |
| `04-reconnect-session-recovery` | `04 → 07` | 强 | WS replay/degraded/docs |
| `05-hook-delivery-closure` | `05 → 07` | 中 | hook docs/new section |
| `06-policy-reliability-hardening` | `06 → 07` | 强 | runtime enforce matrix/error-index |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`API Contract Docs Closure` 是 **前端合同最终收口层**，负责 **把所有 public API、WS frame、error code、readiness label 与真实代码事实对齐**，对上游提供 **closure evidence**，对下游交付 **可按文档开发的 clients/api-docs**。

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| Internal RPC docs | “扫描全部接口”误解 | 前端不可直接调用 | SDK/admin 阶段 |
| 文档风格重写 | closure 诱因 | PP6 是事实对账，不是文案重构 | docs platform |
| OpenAPI generator | Codex typed protocol precedent | 当前成本高，且代码未准备 | PP6 后评估 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 | 第一版行为 | 未来可能的演进方向 |
|--------|----------|------------|---------------------|
| readiness label | 文档表格/段落 | manual label | generated status |
| error-index | code table | registry + ad-hoc sweep | automated parity test |
| endpoint matrix | README matrix | 手动对账 facade registry | route extractor |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：docs closure 与 feature closure。
- **解耦原因**：一个 endpoint 可以是 schema-live/first-wave，docs 仍可 closure，只要它诚实写明限制。
- **依赖边界**：PP6 不补功能；PP6 发现功能缺口时记录为 handoff，而不是在 docs 中伪装完成。
- **D1 纪律**：PP6 是 docs-only closure phase；若 sweep 暴露出 schema 缺口，只能登记为 retained issue 或回到 charter §4.5 申请例外，不能在 PP6 临时扩表。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：`clients/api-docs`。
- **聚合形式**：所有前端合同最终在该目录表达；design/action-plan/closure 只能作为证据来源，不替代 API docs。
- **为什么不能分散**：前端不能在多个历史文档中拼 contract。

---

## 4. 参考实现 / 历史 precedent 对比

### 4.1 gemini-cli 的做法

- **实现概要**：Gemini 将 stream event 类型集中在 core turn event catalog，前端/CLI 可以围绕事件类型处理状态。
- **亮点**：
  - event enum 包含 content/tool/confirmation/retry/context overflow/error/blocked 等前端关心状态（`context/gemini-cli/packages/core/src/core/turn.ts:52-71`）。
- **值得借鉴**：nano-agent 的 WS docs 必须有完整 frame/event catalog，而不是分散在实现中。
- **不打算照抄的地方**：Gemini 不是远程 HTTP API，不需要 22-doc REST pack。

### 4.2 codex 的做法

- **实现概要**：Codex app-server-protocol re-export 大量 typed protocol items，并支持 schema/type generation。
- **亮点**：
  - `app-server-protocol/src/lib.rs` 显式 re-export request/response/protocol types（`context/codex/codex-rs/app-server-protocol/src/lib.rs:17-43`）。
- **值得借鉴**：长期应考虑从 schema/types 生成 docs 或至少做 drift checks。
- **不打算照抄的地方**：PP6 不引入 Rust-style schema generator；先完成 markdown truth。

### 4.3 claude-code 的做法

- **实现概要**：Claude Code resume UI 不只列出命令，还对“无会话”“加载失败”“跨项目”给出用户可见文案。
- **亮点**：
  - resume picker 将 no conversations、load failure、cross-project resume 分别处理（`context/claude-code/commands/resume/resume.tsx:107-170`）。
- **值得借鉴**：docs 要写失败/限制路径，不能只写 success shape。
- **不打算照抄的地方**：nano-agent 面向 HTTP/WS 前端，不复制本地 CLI 文案体系。

### 4.4 横向对比速查表

| 维度 | gemini-cli | codex | claude-code | nano-agent 倾向 |
|------|------------|-------|-------------|------------------|
| contract source | event enum | typed protocol exports | app behavior/source | `clients/api-docs` + code sweep |
| errors/limits | stream events | typed responses | user-visible paths | error-index + readiness labels |
| generation | code-driven | schema generation | source-driven | manual now, drift gates later |
| frontend boundary | CLI core | app-server protocol | local UI | orchestrator-core facade |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1] 22-doc pack sweep** — 每份文档必须核对当前代码。
- **[S2] Facade route matrix sweep** — README matrix 与 route-registry/route parser 对齐。
- **[S3] WS frame/error sweep** — top-level frames、stream kind、system.error、replay semantics。
- **[S4] Readiness/enforcement labels** — live/first-wave/schema-live/not-enforced 必须诚实。
- **[S5] Hook contract docs** — 若 PP4 建立 public register surface，PP6 必须新增 `hooks.md` 或将 hook contract 合并回 `runtime`/`session-ws-v1` 等对应专题。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1] internal RPC docs** — 不进入 clients/api-docs。
- **[O2] OpenAPI/SDK generation** — 后续评估。
- **[O3] 新功能实现** — PP6 只记录 drift/handoff。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| debug routes | in-scope if frontend inspector uses | public facade GET | worker-health/error-index |
| `/sessions/{id}/resume` | in-scope | public session bridge | session/session-ws |
| service-binding RPC | out-of-scope | frontend 不直连 | architecture docs only |
| hook docs | in-scope if PP4 exposes public surface | 当前缺专题 | PP6 新增或合并 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **PP6 独立 closure** 而不是 **PP5 顺手改 docs**
   - **为什么**：前端 contract 涉及所有 public surface，必须集中对账。
   - **我们接受的代价**：多一个 phase。
   - **未来重评条件**：自动 drift gate 成熟后可压缩。

2. **取舍 2**：我们选择 **readiness label** 而不是 **只写 endpoint 存在**
   - **为什么**：first-wave/schema-live 对前端行为差异巨大。
   - **我们接受的代价**：文档更长。
   - **未来重评条件**：所有 surface 都 fully live。

3. **取舍 3**：我们选择 **代码事实优先** 而不是 **设计愿景优先**
   - **为什么**：前端按 docs 调接口，不能按愿景开发。
   - **我们接受的代价**：docs 可能暴露未完成项。
   - **未来重评条件**：无；这是永久原则。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| route 漏扫 | 只看 README 不看 facade | endpoint drift | route-registry + parser sweep |
| docs overclaim | 按 action-plan 写“已完成” | 前端踩坑 | readiness label |
| error code 漏记 | ad-hoc route code 未进 error-index | client 无法分类 | error-index sweep + registry parity |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：把长期积累的 docs drift 归零。
- **对 nano-agent 的长期演进**：为 SDK/OpenAPI/drift gate 提供干净 baseline。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：前端可按统一合同消费复杂后端能力。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | Docs Pack Inventory | 22-doc pack 清单与新增/移除判断 | ✅ 文档包完整 |
| F2 | Endpoint Matrix Reconcile | README matrix 与 facade routes 对齐 | ✅ route 不漏不多 |
| F3 | Frame/Error Contract Reconcile | WS/error-index 对齐 schemas/emitters | ✅ client 可分类 |
| F4 | Readiness Closure Notes | 各 surface live 状态诚实记录 | ✅ 不 overclaim |
| F5 | Hook Contract Reconcile | hook public surface 进入 docs pack | ✅ hook contract 不再游离 |

### 7.2 详细阐述

#### F1: Docs Pack Inventory

- **输入**：`clients/api-docs/*.md` 当前文件列表。
- **输出**：authoritative pack 清单与缺失专题。
- **主要调用者**：PP6。
- **核心逻辑**：当前 pack 为 README 中声明的 22 份；PP6 必须逐一核对 `README / auth / catalog / checkpoints / client-cookbook / confirmations / context / error-index / items / me-sessions / models / permissions / runtime / session-ws-v1 / session / todos / tool-calls / transport-profiles / usage / wechat-auth / worker-health / workspace`，并确认是否需要新增 `hooks.md` 或将 hook 合同合并到 runtime/session-ws。
- **边界情况**：新增文档必须服务前端 contract，不能变成设计备忘。
- **一句话收口目标**：✅ **前端知道应该读哪些文档。**

#### F2: Endpoint Matrix Reconcile

- **输入**：`route-registry.ts` 与各 route parser。
- **输出**：README matrix 与各专题文档 endpoint list。
- **主要调用者**：frontend、reviewer。
- **核心逻辑**：`dispatchFacadeRoute()` 的 handler 顺序是 public route truth；session bridge/control/context/runtime/files/items/models/debug/auth/me/catalog 都要逐项对账。
- **边界情况**：legacy DO action 返回 shape 与 facade-http-v1 不同，必须标 profile。
- **一句话收口目标**：✅ **README matrix 与代码路由一致。**

#### F3: Frame/Error Contract Reconcile

- **输入**：`session-ws-v1.md`、`stream-event.ts`、`messages.ts`、`error-index.md`、error registry。
- **输出**：WS frame catalog、system.error、HTTP error code table。
- **主要调用者**：frontend runtime/transport layer。
- **核心逻辑**：outer frame kind 与 payload kind 两层枚举不能混淆；ad-hoc code 必须有分类策略。
- **边界情况**：schema-live/event-live/emit-live 要分开写。
- **一句话收口目标**：✅ **client 能按 code/kind 写稳定分支。**

#### F4: Readiness Closure Notes

- **输入**：PP1-PP5 closure truth。
- **输出**：每个专题的 readiness/limitations 段落。
- **主要调用者**：frontend、owner。
- **核心逻辑**：docs closure 不等于功能 fully semantic complete；例如 restore/fork/retry/context auto compact/hook register 必须按真实状态标注。
- **边界情况**：如果代码与旧 closure 冲突，以当前代码为准。
- **一句话收口目标**：✅ **docs 能承载未完成事实，而不是掩盖它。**

#### F5: Hook Contract Reconcile

- **输入**：PP4 的 public register/list/unregister surface、`hook.broadcast`、runtime/error docs。
- **输出**：`hooks.md` 或等价专题中的 hook contract truth。
- **主要调用者**：frontend、PP6。
- **核心逻辑**：PP4 一旦形成 public hook surface，PP6 就必须把 register/list/unregister、trigger、broadcast、redaction 与 readiness truth 回填到 docs pack，而不是只留在 design/action-plan。
- **边界情况**：若 PP4 最终未形成 public hook surface，则要在相关 docs 中明确写 `registry-only` / `not-live`，而不是新增空专题。
- **一句话收口目标**：✅ **hook contract 不再成为 docs 漏项。**

### 7.3 非功能性要求与验证策略

- **性能目标**：无直接性能目标；但 docs 应记录前端相关 latency alert。
- **可观测性要求**：trace_uuid、system.error、debug routes、audit docs 全覆盖。
- **稳定性要求**：docs 应给出 retry/backoff/409/idempotency handling。
- **安全 / 权限要求**：所有 auth/owner/team/device gate 表述必须与代码一致。
- **测试覆盖要求**：docs consistency check、diff check、可选 route matrix extraction。
- **验证策略**：route parser sweep + docs grep + `pnpm run check:docs-consistency`（若仍存在）+ targeted manual audit。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 gemini-cli

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/gemini-cli/packages/core/src/core/turn.ts:52-71` | event enum covers frontend states | WS catalog 应集中完整 | |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/app-server-protocol/src/lib.rs:17-43` | typed protocol re-exports | 长期 schema/doc generation precedent | |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/commands/resume/resume.tsx:107-170` | resume failures/cross-project paths | docs 要写 failure/limit path | |

### 8.4 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `clients/api-docs/README.md:40-75` | 22-doc pack index | PP6 inventory baseline |
| `clients/api-docs/README.md:76-253` | endpoint matrix | route sweep target |
| `clients/api-docs/permissions.md:1-120` | permission / confirmation client contract | PP1/PP4 交汇的 docs target |
| `clients/api-docs/workspace.md:1-160` | workspace public surface | PP5 `workspace_scope` 相关 target |
| `clients/api-docs/transport-profiles.md:1-120` | HTTP/WS transport discipline | retry/degraded/docs target |
| `clients/api-docs/worker-health.md:1-160` | health/debug surface | latency/error observability target |
| `workers/orchestrator-core/src/facade/route-registry.ts:16-60` | facade route dispatch truth | public route owner |
| `workers/orchestrator-core/src/facade/routes/session-bridge.ts:14-32,148-169` | legacy session action parser | profile/readiness must match |
| `workers/orchestrator-core/src/facade/routes/session-control.ts:664-674` | checkpoint/confirmation/todo control routes | docs matrix source |
| `clients/api-docs/error-index.md:73-108` | current ad-hoc code table | PP6 error sweep baseline |
| `clients/api-docs/session-ws-v1.md:44-111` | WS frame catalog | frame sweep baseline |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

| Q ID / 决策 ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|----------------|------|----------|----------|------|----------|
| D-07-1 | PP6 是否扫描 internal RPC？ | PP6 | 否 | frozen | charter §12 Q3 |
| D-07-2 | docs closure 是否要求功能 fully complete？ | PP6 | 否，要求 truthful readiness | proposed | 本设计 |
| D-07-3 | 是否引入 OpenAPI generator？ | PP6 | 否 | proposed | 本设计 |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. 22-doc pack inventory 完成。
2. README endpoint matrix 与 facade routes 对齐。
3. WS frame/error-index 与 schemas/emitters 对齐。
4. 所有 first-wave/schema-live/not-enforced 限制写入相关 docs。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - `docs/action-plan/pro-to-product/PP6-api-contract-docs-closure-action-plan.md`
- **需要同步更新的设计文档**：
  - 无；PP6 是本批次最终 docs design。
- **需要进入 QNA register 的问题**：
  - 是否新增 `clients/api-docs/hooks.md` 可在 PP6 action-plan 根据 PP4 实现结果决定。

---

## 10. 综述总结与 Value Verdict

### 10.1 功能簇画像

`API Contract Docs Closure` 是 pro-to-product 从后端能力走向前端可用的最后交付层。它的价值不在于写更多文档，而在于把所有 public contract 按代码事实重新归零：endpoint、frame、error、字段、profile、readiness 都必须对得上。

### 10.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 前端开发直接依赖 |
| 第一版实现的性价比 | 5 | 不堆功能，消除 contract drift |
| 对未来上下文管理 / Skill / 稳定性演进的杠杆 | 5 | 提供 SDK/OpenAPI baseline |
| 对开发者自己的日用友好度 | 5 | route/error/frame 一处可查 |
| 风险可控程度 | 4 | 手动 sweep 易漏，需 checklist |
| **综合价值** | 5 | PP6 必要且合理 |

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：PP6 是否只是“更新 docs”。
  - **A 方观点**：docs 可以在各 phase 顺手更新。
  - **B 方观点**：前端合同需要最终全量对账。
  - **最终共识**：PP6 是独立 API contract closure phase，只扫 public surfaces。

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-05-02` | `GPT-5.5` | 初稿 |
