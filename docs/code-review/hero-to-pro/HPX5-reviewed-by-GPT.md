# Nano-Agent 代码审查

> 审查对象: `hero-to-pro / HPX5 + current broader hero-to-pro handoff`
> 审查类型: `mixed`
> 审查时间: `2026-05-02`
> 审查人: `GPT-5.4`
> 审查范围:
> - `docs/action-plan/hero-to-pro/HPX5-wire-up-action-plan.md`
> - `docs/issue/hero-to-pro/HPX5-closure.md`
> - `docs/charter/plan-hero-to-pro.md`
> - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md`
> - `workers/agent-core/**`
> - `workers/orchestrator-core/**`
> - `packages/nacp-session/**`
> - `packages/nacp-core/**`
> - `scripts/check-docs-consistency.mjs`
> - `clients/api-docs/**`
> 对照真相:
> - `docs/charter/plan-hero-to-pro.md`
> - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md`
> - `docs/action-plan/hero-to-pro/HPX5-wire-up-action-plan.md`
> - `docs/issue/hero-to-pro/HPX5-closure.md`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`HPX5 的代码主线已经真实落地，confirmation/todos/model.fallback/first_event_seq 等关键接线大体成立；但当前实现仍不足以支撑 action-plan / closure 对“F2a 已完成、19 份 docs error-free、前端可只依赖 18+1 doc pack 无漏洞实现”的强结论，因此本轮 review 不能关闭。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `HPX5 的 runtime wiring 主体是真的：WriteTodos backend、confirmation/todos emit、model.fallback emit、/start 的 first_event_seq、workspace bytes GET 都已 live，且相关测试与 gate 目前全绿。`
  2. `HPX5 F2a 没有按 action-plan 所写那样完成“模型可见的 tool schema / capability registry 暴露”；当前只看到执行时的 write_todos 短路 backend，没有看到它进入 agent-core 给模型的共享工具表。`
  3. `clients/api-docs 仍有多处把已 live 的能力写成 pending / not-live，docs consistency gate 又只检查 4 个 regex，所以 HPX5 closure 对“19 docs error-free / client-ready”的表述明显过强。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-hero-to-pro.md`
  - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md`
  - `docs/action-plan/hero-to-pro/HPX5-wire-up-action-plan.md`
  - `docs/issue/hero-to-pro/HPX5-closure.md`
  - `docs/templates/code-review.md`
- **核查实现**：
  - `workers/agent-core/src/host/{runtime-mainline.ts,env.ts,do/session-do/runtime-assembly.ts}`
  - `workers/agent-core/src/llm/gateway.ts`
  - `workers/agent-core/test/llm/gateway.test.ts`
  - `workers/orchestrator-core/src/{entrypoint.ts,facade/routes/session-control.ts,user-do/message-runtime.ts,user-do/surface-runtime.ts,user-do/session-flow/start.ts}`
  - `packages/nacp-session/src/{emit-helpers.ts,messages.ts}`
  - `packages/nacp-core/src/tools/tool-catalog.ts`
  - `scripts/check-docs-consistency.mjs`
  - `clients/api-docs/{README,client-cookbook,session,session-ws-v1,todos,confirmations,models}.md`
- **执行过的验证**：
  - `pnpm --filter @haimang/nacp-session test`
  - `pnpm --filter @haimang/orchestrator-core-worker test`
  - `pnpm --filter @haimang/agent-core-worker test`
  - `pnpm --filter @haimang/context-core-worker test`
  - `pnpm check:cycles`
  - `pnpm run check:envelope-drift`
  - `node scripts/check-docs-consistency.mjs`
- **复用 / 对照的既有审查**：
  - `none` — `本文件只基于当前仓库代码、action-plan、closure、charter、design 与 clients/api-docs 的一手事实；没有采纳其他同事的审查结论。`

### 1.1 已确认的正面事实

- `HPX5` 的 emit seam 不是纸面设计：`packages/nacp-session/src/emit-helpers.ts:73-199,203-247` 已提供 top-level / stream-event 两条 emit helper，并在大多数失败路径下回退为 `system.error`。
- `HPX5` 的 confirmation / todos row-first dual-write 已真实存在：`workers/orchestrator-core/src/facade/routes/session-control.ts:418-434` 在 confirmation row commit 后发 `session.confirmation.update`；`session-control.ts:517-533,579-593` 在 todo create / patch 后发 `session.todos.update`。
- `HPX5` 的 WriteTodos backend 真实接通到了 orchestrator-core：`workers/agent-core/src/host/do/session-do/runtime-assembly.ts:171-185` 把 `ORCHESTRATOR_CORE.writeTodos` 注入 runtime；`workers/orchestrator-core/src/entrypoint.ts:143-176,245-260` 实现了 `writeTodos()` 并在成功写入后广播 `session.todos.update`。
- `HPX5` 的 model fallback 与 start→WS attach race 修复都已 live：`workers/orchestrator-core/src/user-do/message-runtime.ts:428-442` 会在 fallback 发生时 emit `model.fallback`；`workers/orchestrator-core/src/user-do/session-flow/start.ts:270-290` 已返回 `first_event_seq`。
- 当前 HPX5 相关 baseline 是绿的：`nacp-session` `207 tests`、`orchestrator-core-worker` `332 tests`、`agent-core-worker` `1072 tests`、`context-core-worker` `178 tests` 均通过；`check:cycles`、`check:envelope-drift`、`check-docs-consistency` 也通过。

### 1.2 已确认的负面事实

- `write_todos` 还没有被证明进入“模型可见的共享工具注册表”：`workers/agent-core/src/llm/gateway.ts:227` 构建工具表时只调用 `buildWorkersAiTools()`；`workers/agent-core/test/llm/gateway.test.ts:93-103` 断言该共享 minimal registry 等于 bash-core 声明；`packages/nacp-core/src/tools/tool-catalog.ts:22-25,52-61` 当前 registry 也只有 `bash`。与之相对，`workers/agent-core/src/host/runtime-mainline.ts:497-587` 只是在工具**已经被模型发出来之后**对 `write_todos` 做执行短路。
- `clients/api-docs` 仍有多处与当前代码事实冲突：`clients/api-docs/todos.md:199-221` 仍写 `session.todos.*` 为 `schema registered / emitter pending`，并宣称 agent-core 还没有 `WriteTodos` capability；`clients/api-docs/confirmations.md:184-193` 仍写 confirmation frames `emitter pending`；`clients/api-docs/models.md:252-260` 仍写 `model.fallback` 是 `schema-live / emitter-not-live`；`clients/api-docs/session.md:102-104` 的 `/start` success shape 仍未文档化 `first_event_seq`。
- `scripts/check-docs-consistency.mjs:23-52` 只检查 4 类字符串级 drift，因此虽然脚本通过，但完全不会拦截上述 “pending / not-live / missing field” 级别的语义漂移。
- `docs/action-plan/hero-to-pro/HPX5-wire-up-action-plan.md:529-532` 写“文档状态从 `draft` → `executed`”，但文档头部仍保留 `文档状态: draft`；这不是 runtime blocker，但说明 action-plan 与 closure 的过程证据没有完全同步。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 直接核查了 HPX5 action-plan / closure / charter / design、agent-core / orchestrator-core / packages 实现、docs script 与 clients/api-docs。 |
| 本地命令 / 测试 | `yes` | 重新执行了 4 个相关包测试和 3 个 drift / consistency gate，确认当前代码树下 HPX5 baseline 为绿。 |
| schema / contract 反向校验 | `yes` | 反查了 `SessionTodosWriteBodySchema`、`model.fallback`、`first_event_seq`、tool registry 与 docs 表述是否一致。 |
| live / deploy / preview 证据 | `no` | 本轮不依赖 preview/live 环境，只以当前仓库代码和本地验证为证据。 |
| 与上游 design / QNA 对账 | `yes` | 以 HPX5 design / action-plan / closure 的 in-scope 与收口口径判断哪些是真的完成、哪些只是部分成立或被夸大。 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | `WriteTodos` 只完成了执行短路，未完成 HPX5 F2a 所宣称的模型可见工具注册 | `high` | `delivery-gap` | `yes` | 把 `write_todos` 真接入 agent-core 的共享工具声明，并补“模型可见 + 可执行”双证据测试 |
| R2 | `clients/api-docs` 仍把多项已 live 能力写成 pending / not-live，HPX5 F7 不能算收口 | `high` | `docs-gap` | `yes` | 回刷 `todos.md` / `confirmations.md` / `models.md` / `session.md` / `session-ws-v1.md` / `README.md` 的 live truth |
| R3 | `check-docs-consistency` 过弱，不能支持“19 docs error-free”的强结论 | `medium` | `test-gap` | `no` | 把语义级 drift 纳入 gate，或从 source-of-truth 生成部分 doc 片段 |
| R4 | HPX5 action-plan / closure 的过程证据仍有状态漂移 | `low` | `scope-drift` | `no` | 同步 action-plan header、closure wording 与真实执行状态 |

### R1. `WriteTodos` 只完成了执行短路，未完成 HPX5 F2a 所宣称的模型可见工具注册

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `workers/agent-core/src/host/runtime-mainline.ts:497-587` 只有当模型已经发出 `tool_use { name: "write_todos" }` 时，才会进入 `writeTodosBackend` 短路执行。
  - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:171-185` 的确把 `ORCHESTRATOR_CORE.writeTodos` 注入了 runtime。
  - 但 `workers/agent-core/src/llm/gateway.ts:227` 的模型工具表仍来自 `buildWorkersAiTools()`；`workers/agent-core/test/llm/gateway.test.ts:93-103` 断言该共享 minimal registry 等于 bash-core 的命令声明。
  - `packages/nacp-core/src/tools/tool-catalog.ts:22-25,52-61` 当前平台 tool catalog 也只有 `bash`，没有 `write_todos`。
  - `packages/nacp-session/src/messages.ts:348-375,417` 只证明了 wire schema 已存在，并不等于 agent-core 已把它暴露给模型。
- **为什么重要**：
  - HPX5 action-plan / closure 对 F2a 的表述不是“backend 预埋”，而是“tool schema / capability registry 已接通”。这直接关系到模型是否能**发现并稳定调用**该能力。
  - 当前状态更像 “F2b backend + F2c emit 已落，F2a tool exposure 未收口”。如果继续按“WriteTodos capability 已完成”对外叙述，会误导后续 client / eval / phase reviewer。
- **审查判断**：
  - 我认可 HPX5 已经把 `write_todos` 的执行面接通了。
  - 但我不认可 `F2a completed` 或 `agent-core WriteTodos capability fully wired` 这个更强结论；准确说法应是：`schema exists + backend exists + model-visible registration not yet proven / not yet implemented`。
- **建议修法**：
  - 在 agent-core 的共享 tool declaration / registry 层显式加入 `write_todos`。
  - 该声明应与 `SessionTodosWriteBodySchema` 保持单一真相来源，避免再造一套手写 JSON schema。
  - 补两类测试：`gateway/tool list` 级测试证明模型侧可见；`runtime/e2e` 级测试证明模型发出 `write_todos` 后能真实走到 orchestrator-core 并返回结果。

### R2. `clients/api-docs` 仍把多项已 live 能力写成 pending / not-live，HPX5 F7 不能算收口

- **严重级别**：`high`
- **类型**：`docs-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `workers/orchestrator-core/src/facade/routes/session-control.ts:418-434` 已 live `session.confirmation.update` emit；但 `clients/api-docs/confirmations.md:184-193` 仍写 confirmation frames 为 `schema registered / emitter pending`。
  - `workers/orchestrator-core/src/entrypoint.ts:245-260` 与 `session-control.ts:517-533,579-593` 已 live `session.todos.update`；但 `clients/api-docs/todos.md:199-221` 仍写 todo frames `emitter pending`，并继续写 “agent-core 当前没有 WriteTodos capability”。
  - `workers/orchestrator-core/src/user-do/message-runtime.ts:428-442` 已 live `model.fallback` emit；但 `clients/api-docs/models.md:252-260` 仍写 `schema-live / emitter-not-live`。
  - `workers/orchestrator-core/src/user-do/session-flow/start.ts:270-290` 已返回 `first_event_seq`；但 `clients/api-docs/session.md:102-104` 的 start success shape 仍缺这个字段。
  - `clients/api-docs/session-ws-v1.md:65` 已把 `model.fallback` 记为 `live (HPX5 F4)`，但同 pack 其他文档仍保留 `not-live / pending` 说法，说明 doc pack 内部也不一致。
- **为什么重要**：
  - HPX5 F7 的价值不只是“多写几篇文档”，而是让 client-facing contract 可以被正确消费。当前这些 drift 会直接影响客户端对 WS attach、fallback 提示、todo/confirmation live 更新的实现方式。
  - HPX5 action-plan 与 closure 都把“18→19 doc pack 可直接支撑客户端实现”当作交付物；在这种前提下，docs drift 不是小瑕疵，而是阶段收口失败。
- **审查判断**：
  - 我认可 HPX5 已经解决了一部分文档断点，例如 `client-cookbook.md` 已开始按 live truth 书写。
  - 但我不认可 “19 docs error-free” 或 “前端可只依赖 18+1 doc pack 无 fallback 漏洞实现” 这类表述；当前 docs pack 最多只能算 `partially refreshed`。
- **建议修法**：
  - 至少同步修正 `todos.md`、`confirmations.md`、`models.md`、`session.md`、`session-ws-v1.md`、`README.md`。
  - 对每一页明确标注 `live / schema-live / first-wave / legacy compat`，不要让不同页面互相打架。
  - 在回刷 docs 后，再重新评估 closure 里“client-ready”与“error-free”的措辞。

### R3. `check-docs-consistency` 过弱，不能支持“19 docs error-free”的强结论

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `scripts/check-docs-consistency.mjs:23-52` 当前只检查 4 项：旧 `index.ts:NNN` 引用、`effective_model_id`、`session_status: "running"`、`content_source.*filesystem-core-leaf-rpc-pending`。
  - `node scripts/check-docs-consistency.mjs` 当前通过。
  - 但与此同时，`clients/api-docs/todos.md:199-221`、`confirmations.md:184-193`、`models.md:252-260`、`session.md:102-104` 这些更关键的语义漂移仍然全部漏检。
- **为什么重要**：
  - 当前 closure 显然把 “docs consistency 脚本通过” 当成 “docs pack 已经 clean”的一部分证据。
  - 如果 gate 只能查极少量字符串级 drift，就会制造一种虚假的安全感：脚本是绿的，但 client-facing 真相仍然是错的。
- **审查判断**：
  - 我认可这个脚本有实际价值，它至少挡住了几类已知的 ref / field 漂移。
  - 但它只能作为“有限 guardrail”，不能作为 “19 docs error-free” 的充分证据。
- **建议修法**：
  - 把 HPX5 这轮真正踩到的 drift 也纳入 gate：`emitter pending`、`emitter-not-live`、`first_event_seq` 缺失、`WriteTodos capability missing` 等。
  - 更稳妥的方向是把 WS event readiness、start success fields、tool capability readiness 从 source-of-truth 生成部分文档或校验表，而不是继续靠人工维护多处重复描述。

### R4. HPX5 action-plan / closure 的过程证据仍有状态漂移

- **严重级别**：`low`
- **类型**：`scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/action-plan/hero-to-pro/HPX5-wire-up-action-plan.md:529-532` 写明“文档状态从 `draft` → `executed`”。
  - 但同一文件头部仍保留 `文档状态: draft`。
  - 本轮同时确认，closure 中对 docs 和 F2a 的若干表述也强于当前真实代码 / 文档状态。
- **为什么重要**：
  - HPX5 已经进入“以 action-plan + closure 作为审计输入”的阶段，过程证据是否同步会直接影响后续 reviewer 对完成度的判断。
  - 这不影响 runtime correctness，但会持续污染阶段历史与 handoff 质量。
- **审查判断**：
  - 这是 process/docs accuracy 问题，不是代码阻断问题。
  - 但它与 R1/R2 一起说明：当前 HPX5 closure 更接近“实现主体成立，但收口措辞过强”，而不是“完全无误地完成所有承诺”。
- **建议修法**：
  - 同步 action-plan header、执行日志、closure verdict 的状态语义。
  - 对尚未完成或仅部分完成的项，统一改写为 `partial-live` / `follow-up required`，避免继续使用 completed 口径。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | F0：统一 emit helper seam | `done` | `emit-helpers.ts` 已存在，top-level 与 stream-event 都有统一 helper。 |
| S2 | F1：confirmation row-first emit | `done` | `session.confirmation.update` 在 row commit 后真实发出。 |
| S3 | F2a：WriteTodos tool schema / capability registry 暴露 | `partial` | wire schema 与 backend 已有，但模型可见 registry 暴露没有证据，当前只看到执行短路。 |
| S4 | F2b：agent-core → orchestrator-core WriteTodos backend | `done` | runtime assembly 已注入 `writeTodosBackend`，执行面接通。 |
| S5 | F2c：`session.todos.update` authoritative emit | `done` | HTTP create / patch 与 backend write 成功后都能广播 authoritative list。 |
| S6 | F3：legacy confirmation dual-write 路径补 emit | `done` | `surface-runtime.ts` 已补 confirmation request / update emit。 |
| S7 | F4：`model.fallback` stream event live | `done` | fallback 发生时确实会 emit。 |
| S8 | F5：workspace bytes GET / content_source live | `done` | binary GET 与文档脚本里冻结的 `content_source: "live"` 已成立。 |
| S9 | F7：`first_event_seq` + docs pack sync + consistency gate | `partial` | `first_event_seq` 与脚本已落，但 docs pack 仍未同步到当前 live truth。 |
| S10 | closure claim：19 docs error-free，前端可只依赖 18+1 doc pack 实现无 fallback 漏洞 client | `stale` | 当前 docs 仍有多处 pending/not-live/missing-field 漂移，不能支撑这个强结论。 |

### 3.1 对齐结论

- **done**: `7`
- **partial**: `2`
- **missing**: `0`
- **stale**: `1`
- **out-of-scope-by-design**: `0`

这更像“HPX5 的 runtime wire-up 主体已完成，但 tool exposure 与 docs truth 仍未收口”，而不是一个可以直接宣称 `completed / error-free / client-ready` 的阶段。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | HPX5 不负责吸收 HP6 全量 workspace CRUD / tool-calls / promotion backlog | `遵守` | 本轮不把 HP6 之后的产品面缺口误判成 HPX5 blocker。 |
| O2 | HPX5 不要求一次性完成 HPX6 的完整 bridging contract | `遵守` | 本轮只按 HPX5 自己承诺的 F0/F1/F2/F3/F4/F5/F7 审核，不把 HPX6 未来项强行前置。 |
| O3 | 把当前 docs 漂移误判为“runtime 没有 live” | `误报风险` | 代码已证明 confirmation/todos/fallback/start fields 多项能力 live，不能因为文档旧口径就倒推出实现不存在。 |
| O4 | 把 `write_todos` 模型可见注册缺口推回 HP6、认定它不属于 HPX5 | `误报风险` | 这不成立；HPX5 action-plan 已把 F2a 明确写进本阶段，所以它缺失就是本轮真实 finding。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`HPX5 代码主线成立，但当前不能按 completed 关闭；需要先补齐 F2a 的模型可见 tool registration，并把 docs pack 回刷到当前 live truth。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. `完成 HPX5 F2a：把 write_todos 真正接入 agent-core 的共享工具声明 / capability registry，并补足模型可见与执行可达的测试证据。`
  2. `修正 clients/api-docs 的核心漂移：至少同步 todos / confirmations / models / session / session-ws-v1 / README，使其不再把已 live 能力写成 pending / not-live，且补齐 first_event_seq。`
- **可以后续跟进的 non-blocking follow-up**：
  1. `扩展 scripts/check-docs-consistency.mjs，让它覆盖本轮已证实的语义级 drift，而不只盯 4 个 regex。`
  2. `同步 HPX5 action-plan header 与 closure wording，避免继续出现 draft / executed / completed 口径互相打架。`
- **建议的二次审查方式**：`same reviewer rereview`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。
