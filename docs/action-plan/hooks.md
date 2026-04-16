# Nano-Agent 行动计划 — Hooks

> 服务业务簇: `Lifecycle Governance`
> 计划对象: `@nano-agent/hooks` — nano-agent 的生命周期事件契约、治理扩展层与 hook runtime
> 类型: `new`
> 作者: `GPT-5.4`
> 时间: `2026-04-16`
> 文件位置: `packages/hooks/`（独立 repo，位于 `packages/` 下）
> 关联设计 / 调研文档:
> - `docs/design/hooks-by-GPT.md`
> - `docs/design/hooks-by-opus.md`
> - `docs/design/agent-runtime-kernel-by-GPT.md`
> - `docs/design/capability-runtime-by-GPT.md`
> - `docs/design/workspace-context-artifacts-by-GPT.md`
> - `docs/design/eval-observability-by-opus.md`
> - `docs/action-plan/agent-runtime-kernel.md`
> - `docs/action-plan/capability-runtime.md`
> - `docs/action-plan/workspace-context-artifacts.md`
> - `docs/action-plan/nacp-core.md`
> - `docs/action-plan/nacp-session.md`
> - `README.md`
> - 参考代码：`packages/nacp-core/`、`packages/nacp-session/`、`context/claude-code/utils/hooks.ts`、`context/codex/`、`context/mini-agent/`
> 文档状态: `draft`

---

## 0. 执行背景与目标

nano-agent 现在已经有了三块明确地基：

1. `nacp-core` 冻结了 `hook.emit` / `hook.outcome` 的内部协议 reality；
2. `nacp-session` 冻结了 `session.stream.event` 的 9 种 client-visible kinds，其中 hook 侧现实只有 **`hook.broadcast`**；
3. `agent-runtime-kernel` 与 `capability-runtime` 已经把主循环与工具执行边界初步钉住。

但系统仍然缺少一个真正把“生命周期节点 → 平台治理 → 受控扩展 → 审计 / 客户端观测”收敛起来的层。  
这就是 `Hooks`：它不是 shell 脚本旁路，也不是客户端回写通道，而是 **主循环关键节点的强类型事件协议 + 受控执行层**。

这份 action-plan 的目标，是先把 hooks 作为独立包落地，冻结 **事件目录、payload schema、outcome allowlist、registry / dispatcher contract、runtime seam、审计与 session 映射**。  
这些 `packages/*` 不是最终 Cloudflare 发布单元；后续会有 deployable Worker / Session DO 组装层把它们拼装起来，并同时服务 **WebSocket-first** 与 **HTTP fallback** 的 session ingress。

- **服务业务簇**：`Lifecycle Governance`
- **计划对象**：`@nano-agent/hooks`
- **本次计划解决的问题**：
  - nano-agent 还没有统一的 lifecycle extension seam，`PreToolUse / PreCompact / SessionStart` 等节点无法被平台治理与扩展稳定消费
  - `hook.emit` / `hook.outcome` 与 `hook.broadcast` 之间还缺少一层结构化映射，容易再次发明错误的 client-visible event kind
  - session hook 的注册、恢复、超时、递归保护、审计，目前都没有系统级 contract
  - skill / policy / session 三类扩展若没有统一 registry 与 dispatcher，很快会把 kernel、capability、session runtime 一起拖脏
- **本次计划的直接产出**：
  - `packages/hooks/` 独立包骨架
  - `HookEventCatalog / HookOutcome / HookRegistry / HookDispatcher / HookRuntime` 类型与实现
  - `local-ts` 与 `service-binding` 两类受控 runtime，配套 timeout / abort / recursion guard
  - 对齐 `hook.emit / hook.outcome / hook.broadcast / audit.record` reality 的适配层
  - 可供 Session DO snapshot/restore 使用的 registry codec 与测试基座

---

## 1. 执行综述

### 1.1 总体执行方式

本 action-plan 分 **5 个 Phase**，执行策略是 **“先事件目录与结果 contract，再 registry / dispatch，再 runtime 执行，再观测与恢复，最后用场景测试收口”**。  
Hooks 的最大风险不是功能少，而是边界混乱：一旦把 shell hook、客户端回写、自由 JSON outcome、错误的 session event kind 一起拉进来，整个系统会重新失去可验证性。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | 包骨架与 Hook Domain Model | M | 建立独立包，冻结事件目录、payload schema、outcome taxonomy | `-` |
| Phase 2 | Registry / Matcher / Outcome Reduction | L | 建立中央 registry、source 分层、匹配器与结果合并逻辑 | Phase 1 |
| Phase 3 | Dispatcher / Runtime / Safety Guards | L | 实现统一发射入口、`local-ts` / `service-binding` runtime、超时与递归保护 | Phase 1, Phase 2 |
| Phase 4 | NACP 映射 / Audit / Snapshot Restore | M | 对齐 Core/Session reality，完成审计记录与 session hook 恢复 contract | Phase 2, Phase 3 |
| Phase 5 | Fixtures / 测试 / 文档 / 收口 | M | 用 fake kernel/capability/session 场景跑通 hooks，全链路验证并收口 | Phase 1-4 |

### 1.3 Phase 说明

1. **Phase 1 — 包骨架与 Hook Domain Model**
   - **核心目标**：建立独立包，冻结 8 个稳定事件、payload schema、redaction metadata、event-specific outcome allowlist。
   - **为什么先做**：若不先冻结事件与 outcome 真相，后面的 registry / runtime / session adapter 都会被实现反向定义。
2. **Phase 2 — Registry / Matcher / Outcome Reduction**
   - **核心目标**：建立 `HookRegistry`、source 层级、exact/wildcard matcher，以及 `AggregatedHookOutcome` 的统一合并逻辑。
   - **为什么放在这里**：先知道“谁能注册什么、什么事件命中什么 handler、结果如何合并”，再谈执行 runtime。
3. **Phase 3 — Dispatcher / Runtime / Safety Guards**
   - **核心目标**：把所有 hook 发射收敛到 `HookDispatcher.emit()`，并提供 `local-ts` 与 `service-binding` runtime、timeout / abort / recursion guard。
   - **为什么放在这里**：dispatcher 是 hooks 的心脏，必须在审计与 session 适配之前稳定。
4. **Phase 4 — NACP 映射 / Audit / Snapshot Restore**
   - **核心目标**：对齐 `hook.emit / hook.outcome / hook.broadcast / audit.record` reality，并提供 registry snapshot/restore codec。
   - **为什么放在这里**：只有 runtime contract 稳定后，协议映射、观测与恢复边界才不会漂移。
5. **Phase 5 — Fixtures / 测试 / 文档 / 收口**
   - **核心目标**：通过 fake kernel / fake capability / fake service-binding / fake session stream 场景验证 hooks 作为系统级基础设施成立。
   - **为什么放在这里**：hooks 是否靠谱，最终要靠 lifecycle scenario，而不是靠 schema 自信。

### 1.4 执行策略说明

- **执行顺序原则**：`catalog/outcome -> registry/matcher -> dispatcher/runtime -> nacp/audit/snapshot -> fixtures/tests`
- **风险控制原则**：不引入 shell-command runtime、客户端回写、自由 JSON outcome、regex matcher；所有扩展能力都必须显式受控
- **测试推进原则**：先测 schema / registry / outcome reduction，再测 dispatcher/runtime，最后用 session resume 与 blocking hook 场景收口
- **文档同步原则**：实现时同步回填 `hooks-by-GPT.md`、`agent-runtime-kernel-by-GPT.md`、`eval-observability-by-opus.md` 与 `nacp-session` 依赖段落

### 1.5 本次 action-plan 影响目录树

```text
packages/hooks/
├── src/
│   ├── version.ts
│   ├── types.ts
│   ├── catalog.ts
│   ├── outcome.ts
│   ├── matcher.ts
│   ├── registry.ts
│   ├── dispatcher.ts
│   ├── guards.ts
│   ├── audit.ts
│   ├── snapshot.ts
│   ├── core-mapping.ts
│   ├── session-mapping.ts
│   ├── runtimes/
│   │   ├── local-ts.ts
│   │   └── service-binding.ts
│   └── index.ts
├── test/
│   ├── catalog.test.ts
│   ├── outcome.test.ts
│   ├── matcher.test.ts
│   ├── registry.test.ts
│   ├── dispatcher.test.ts
│   ├── guards.test.ts
│   ├── core-mapping.test.ts
│   ├── session-mapping.test.ts
│   ├── snapshot.test.ts
│   └── integration/
│       ├── pretool-blocking.test.ts
│       ├── service-binding-timeout.test.ts
│       ├── session-resume-hooks.test.ts
│       └── compact-guard.test.ts
├── scripts/
│   ├── export-schema.ts
│   └── gen-registry-doc.ts
├── package.json
├── tsconfig.json
├── README.md
└── CHANGELOG.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** `@nano-agent/hooks` 独立包骨架
- **[S2]** 8 事件最小集：`SessionStart / SessionEnd / UserPromptSubmit / PreToolUse / PostToolUse / PostToolUseFailure / PreCompact / PostCompact`
- **[S3]** 统一 `HookEventCatalog`：payload schema + redaction metadata + event metadata
- **[S4]** `HookOutcome` 与 `AggregatedHookOutcome`：event-specific allowlist + 合并规则
- **[S5]** `HookRegistry`：至少支持 `platform-policy` / `session` 两层 source，并为 future `skill` source 预留接口
- **[S6]** `HookMatcher`：v1 仅 exact / wildcard / toolName 级条件，不做 regex
- **[S7]** `HookDispatcher.emit()` 作为唯一发射入口
- **[S8]** `local-ts` runtime：trusted in-proc hook handler
- **[S9]** `service-binding` runtime：通过 `@nano-agent/nacp-core` 调远端 hook worker
- **[S10]** timeout / AbortSignal / recursion depth guard
- **[S11]** `hook.emit` / `hook.outcome` Core builder/parser
- **[S12]** `hook.broadcast` Session adapter，严格对齐当前 `@nano-agent/nacp-session` reality，不新增 `hook.started` / `hook.finished` kind
- **[S13]** `audit.record` builder：把 hook lifecycle 证据转成 durable audit event
- **[S14]** session hook snapshot/restore codec，供 Session DO storage 使用
- **[S15]** README、公开导出、schema/doc 生成脚本与测试基座

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** shell-command hook runtime
- **[O2]** `fetch-http` runtime
- **[O3]** `llm-prompt` runtime
- **[O4]** client 回写 blocking handler
- **[O5]** regex matcher / arbitrary condition language
- **[O6]** 25 事件全集与细粒度 hook.started/hook.finished 事件宇宙
- **[O7]** 真实 DO storage / KV / R2 写入编排本体（仅提供 codec / sink builder，不接管 deploy/runtime wiring）
- **[O8]** skill runtime 本体与完整 skill registry
- **[O9]** sub-agent / multi-turn concurrency hooks
- **[O10]** 基于 bash 子命令树的 per-subcommand hooks

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `SessionStart` 用 `source: startup|resume` 表达恢复来源 | `in-scope` | 可避免单独再发明 `SessionResume` 事件 | 默认不重评 |
| `updatedInput` 仅允许在 `PreToolUse` 生效 | `in-scope` | 只开放工具入参规范化，不开放任意 prompt 改写 | 默认不重评 |
| client-visible hook 事件 | `in-scope` | 但必须收敛到现有 `hook.broadcast` reality | 除非 `nacp-session` 扩 kind |
| `hook.broadcast` 作为 Core message | `out-of-scope` | 这是已被 `nacp-core`/`nacp-session` 修正过的错误边界 | 不重评 |
| skill 注册 session hook | `defer / depends-on-decision` | 接口要预留，但是否在 v1 开放需要 owner 冻结 | skill runtime 启动时 |
| `PreCompact` block | `in-scope` | 这是 context governance 的关键安全阀 | 默认不重评 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | package 骨架 | `add` | `package.json`、`tsconfig.json`、`README.md`、`CHANGELOG.md` | 建出独立 hooks package | low |
| P1-02 | Phase 1 | event catalog | `add` | `src/catalog.ts`、`src/types.ts` | 冻结 8 事件与 payload schema | high |
| P1-03 | Phase 1 | outcome taxonomy | `add` | `src/outcome.ts` | 冻结 allowlist 与合并输入 shape | high |
| P2-01 | Phase 2 | registry | `add` | `src/registry.ts` | 所有注册统一进入中心 registry | high |
| P2-02 | Phase 2 | matcher | `add` | `src/matcher.ts` | 统一命中规则，避免 runtime 各写各的 | medium |
| P2-03 | Phase 2 | outcome reduction | `add` | `src/outcome.ts` | 所有 handler 结果可预测合并 | high |
| P3-01 | Phase 3 | dispatcher | `add` | `src/dispatcher.ts` | 所有 hook 发射都走单一入口 | high |
| P3-02 | Phase 3 | local-ts runtime | `add` | `src/runtimes/local-ts.ts` | 为 trusted hook 提供最低成本执行路径 | medium |
| P3-03 | Phase 3 | service-binding runtime | `add` | `src/runtimes/service-binding.ts`、`src/core-mapping.ts` | 跨 worker hook 执行对齐 Core | high |
| P3-04 | Phase 3 | safety guards | `add` | `src/guards.ts` | timeout / abort / recursion 可统一治理 | high |
| P4-01 | Phase 4 | session mapping | `add` | `src/session-mapping.ts` | 对齐 `hook.broadcast` reality | medium |
| P4-02 | Phase 4 | audit builder | `add` | `src/audit.ts` | hook 证据稳定进入 `audit.record` | medium |
| P4-03 | Phase 4 | snapshot / restore codec | `add` | `src/snapshot.ts` | session hook 恢复 contract 成立 | high |
| P5-01 | Phase 5 | fixtures / integration tests | `add` | `test/integration/*.test.ts` | blocking、timeout、resume 场景稳定回归 | high |
| P5-02 | Phase 5 | schema / docs scripts | `add` | `scripts/*.ts` | 导出 schema 与 registry 文档 | low |
| P5-03 | Phase 5 | 文档与导出面 | `update` | `README.md`、`src/index.ts` | 让 kernel / capability / session 直接接入 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — 包骨架与 Hook Domain Model

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | package 骨架 | 参照 `nacp-core` / `nacp-session` 建立独立 package 与基础 scripts | `package.json`、`tsconfig.json`、`README.md`、`CHANGELOG.md` | 包可 `build/typecheck/test` | 基础命令校验 | 结构与多仓约定稳定 |
| P1-02 | event catalog | 定义 8 个事件、payload schema、redaction metadata 与 event metadata | `src/catalog.ts`、`src/types.ts` | 所有发射点共享同一事件真相 | 类型测试 / schema 单测 | 没有未登记事件 |
| P1-03 | outcome taxonomy | 定义基础 outcome 与 event-specific allowlist | `src/outcome.ts` | handler 返回值可验证 | 单测 | 每个事件的允许字段明确 |

### 4.2 Phase 2 — Registry / Matcher / Outcome Reduction

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | registry | 建立 source 分层、注册顺序、优先级与 lookup contract | `src/registry.ts` | 系统能回答“这个事件会命中谁” | registry 单测 | 注册与枚举稳定 |
| P2-02 | matcher | 落 exact / wildcard / toolName 级 matcher，不引入 regex | `src/matcher.ts` | 匹配逻辑可预测 | matcher 单测 | 无隐藏匹配分支 |
| P2-03 | outcome reduction | 实现 block/stop/additionalContext/diagnostics 的统一合并 | `src/outcome.ts` | dispatcher 只消费聚合结果 | outcome 单测 | 多 handler 合并结果稳定 |

### 4.3 Phase 3 — Dispatcher / Runtime / Safety Guards

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | dispatcher | 将匹配、排序、执行、合并、审计事件发射集中进 `emit()` | `src/dispatcher.ts` | 主循环只有一个 hook 入口 | dispatcher 单测 | 无旁路执行 |
| P3-02 | local-ts runtime | 以受控 async function 形式运行 trusted hook | `src/runtimes/local-ts.ts` | 平台内置 hook 可零序列化执行 | 单测 | 非动态代码加载 |
| P3-03 | service-binding runtime | 构造 `hook.emit`、解析 `hook.outcome`，复用 `NacpTransport` reality | `src/runtimes/service-binding.ts`、`src/core-mapping.ts` | 远端 hook worker 有稳定协议 | transport fixture test | 不直接耦合主循环 |
| P3-04 | safety guards | 统一 timeout、AbortSignal、depth 限制、异常分类 | `src/guards.ts` | hook 不会无限拖死 turn | guard 单测 | timeout/recursion 行为可预测 |

### 4.4 Phase 4 — NACP 映射 / Audit / Snapshot Restore

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | session mapping | 将 redacted hook event 统一映射为 `hook.broadcast` | `src/session-mapping.ts` | client-visible 事件不发明新 kind | adapter 单测 | 严格对齐 `nacp-session` |
| P4-02 | audit builder | 生成 `audit.record` 细节与最小 evidence shape | `src/audit.ts` | hook 审计可被 replay/observability 消费 | 单测 | 不泄露未处理敏感字段 |
| P4-03 | snapshot / restore codec | 为 session hooks 提供 serialize/restore contract | `src/snapshot.ts` | DO hibernation 后 hook 行为可恢复 | snapshot 单测 | registry snapshot 稳定兼容 |

### 4.5 Phase 5 — Fixtures / 测试 / 文档 / 收口

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | integration tests | 跑通 blocking、timeout、resume、PreCompact guard 等场景 | `test/integration/*.test.ts` | hooks 在真实链路里成立 | 集成测试 | 关键生命周期场景可回归 |
| P5-02 | schema / docs scripts | 导出 catalog schema 与 registry 文档 | `scripts/export-schema.ts`、`scripts/gen-registry-doc.ts` | 对外契约可审阅 | 脚本测试 | 生成物稳定 |
| P5-03 | 文档与导出面 | 完成 README、public exports、限制说明 | `README.md`、`src/index.ts` | 下游能直接接入 hooks API | 文档校验 | 支持/不支持清单明确 |

---

## 5. Phase 详情

### 5.1 Phase 1 — 包骨架与 Hook Domain Model

- **Phase 目标**：建立 hooks 作为独立包的最小真相层。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 新增文件**：
  - `packages/hooks/src/catalog.ts`
  - `packages/hooks/src/outcome.ts`
  - `packages/hooks/src/types.ts`
- **本 Phase 修改文件**：
  - `packages/hooks/package.json`
  - `packages/hooks/README.md`
- **具体功能预期**：
  1. 8 事件目录成为唯一 hook event truth。
  2. payload schema 与 redaction metadata 集中定义，不散落在 dispatcher/runtime 中。
  3. outcome allowlist 明确哪些事件允许 `block`、`updatedInput`、`stop`、`additionalContext`。
- **具体测试安排**：
  - **单测**：catalog schema、outcome allowlist、compile-only type tests
  - **集成测试**：无
  - **回归测试**：事件目录变更快照测试
  - **手动验证**：对照 `hooks-by-GPT.md` 的 8 事件最小集
- **收口标准**：
  - catalog 与 outcome taxonomy 稳定
  - 无未登记事件 / 无自由 JSON outcome
  - package scripts 与导出面遵循现有 `packages/*` 约定
- **本 Phase 风险提醒**：
  - 事件目录一旦漂移，后续 Phase 全部返工
  - outcome 若过宽，会把 hook 重新变成不可审计旁路

### 5.2 Phase 2 — Registry / Matcher / Outcome Reduction

- **Phase 目标**：冻结注册、匹配、聚合三件事。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - `packages/hooks/src/registry.ts`
  - `packages/hooks/src/matcher.ts`
- **本 Phase 修改文件**：
  - `packages/hooks/src/outcome.ts`
- **具体功能预期**：
  1. 所有 hook 注册都经由 `HookRegistry` 进入系统。
  2. v1 matcher 仅支持 exact / wildcard / toolName，避免 regex 与任意 DSL。
  3. 多 handler 结果通过统一 reducer 合并，block/stop/additionalContext/diagnostics 行为可预测。
- **具体测试安排**：
  - **单测**：registry lookup、source 优先级、matcher 命中、outcome merge
  - **集成测试**：fake registry + fake dispatcher smoke
  - **回归测试**：source 叠加与冲突顺序测试
  - **手动验证**：对照 `context/claude-code/utils/hooks.ts` 的 matcher 心智，但不复制 regex/runtime 全家桶
- **收口标准**：
  - registry 成为唯一注册真相源
  - matcher 不依赖 shell / regex
  - outcome merge 无隐式覆盖路径
- **本 Phase 风险提醒**：
  - source 层级若没写清，会影响 policy / session / skill 后续接线

### 5.3 Phase 3 — Dispatcher / Runtime / Safety Guards

- **Phase 目标**：把 hooks 真正跑起来，但保持边界收窄。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
  - `P3-04`
- **本 Phase 新增文件**：
  - `packages/hooks/src/dispatcher.ts`
  - `packages/hooks/src/guards.ts`
  - `packages/hooks/src/runtimes/local-ts.ts`
  - `packages/hooks/src/runtimes/service-binding.ts`
  - `packages/hooks/src/core-mapping.ts`
- **具体功能预期**：
  1. 主循环只通过 `emit(event, payload, ctx)` 使用 hooks。
  2. `local-ts` runtime 只运行 trusted static handlers，不允许 eval/dynamic load。
  3. `service-binding` runtime 通过 `hook.emit` / `hook.outcome` 参与跨 worker 执行。
  4. timeout / abort / recursion 成为统一 guard，而不是 runtime 自己兜底。
- **具体测试安排**：
  - **单测**：dispatcher、guard、core builder/parser
  - **集成测试**：fake transport + service-binding runtime
  - **回归测试**：timeout、exception、depth overflow
  - **手动验证**：对照 `packages/nacp-core/src/messages/hook.ts` 与 `state-machine.ts`
- **收口标准**：
  - dispatcher 成为唯一执行入口
  - 两类 runtime 都不突破 Worker/V8 假设
  - safety guards 可单独测试
- **本 Phase 风险提醒**：
  - blocking hook 的失败策略若不先冻结，会影响工具执行与 compact 行为
  - service-binding latency 可能放大 turn 时延

### 5.4 Phase 4 — NACP 映射 / Audit / Snapshot Restore

- **Phase 目标**：把 hooks 接到协议 reality、审计与恢复体系上。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
  - `P4-03`
- **本 Phase 新增文件**：
  - `packages/hooks/src/session-mapping.ts`
  - `packages/hooks/src/audit.ts`
  - `packages/hooks/src/snapshot.ts`
- **具体功能预期**：
  1. client-visible hook 事件统一映射到现有 `hook.broadcast`，不新增 `hook.started`/`hook.finished` kind。
  2. 审计证据通过 `audit.record` 进入 durable trace 路径。
  3. session hooks 能被 serialize/restore，供 Session DO 在 hibernation/reconnect 后恢复。
- **具体测试安排**：
  - **单测**：session mapping、audit builder、snapshot codec
  - **集成测试**：session resume hooks 场景
  - **回归测试**：redaction hint 消费、registry 版本兼容
  - **手动验证**：对照 `packages/nacp-session/src/adapters/hook.ts` 与 `redaction.ts`
- **收口标准**：
  - Session adapter 不发明新 kind
  - audit event 结构可被 eval/observability 消费
  - snapshot/restore 不丢 session-level hooks
- **本 Phase 风险提醒**：
  - 若混淆 live stream 与 durable audit，会把 observability 路径重新污染

### 5.5 Phase 5 — Fixtures / 测试 / 文档 / 收口

- **Phase 目标**：证明 hooks 作为系统级基础设施可用。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
  - `P5-03`
- **本 Phase 新增文件**：
  - `packages/hooks/test/integration/pretool-blocking.test.ts`
  - `packages/hooks/test/integration/service-binding-timeout.test.ts`
  - `packages/hooks/scripts/export-schema.ts`
  - `packages/hooks/scripts/gen-registry-doc.ts`
- **本 Phase 修改文件**：
  - `packages/hooks/README.md`
  - `packages/hooks/src/index.ts`
- **具体功能预期**：
  1. blocking hook、observer hook、timeout、resume 都能稳定回归。
  2. README 能明确 hooks 支持/不支持边界。
  3. schema/doc 输出可供 review 与后续 runtime 装配使用。
- **具体测试安排**：
  - **单测**：补齐未覆盖模块
  - **集成测试**：pretool block、posttool failure、precompact block、resume restore
  - **回归测试**：session mapping 与 audit shape 快照
  - **手动验证**：按 `SessionStart -> UserPromptSubmit -> PreToolUse -> PostToolUse -> SessionEnd` 跑通
- **收口标准**：
  - hooks package 可独立 build/typecheck/test
  - 核心生命周期路径有 fixture 覆盖
  - 文档能解释 runtime、协议映射与限制
- **本 Phase 风险提醒**：
  - 若测试只覆盖 happy path，会掩盖 blocking hook 与 timeout 的真实复杂度

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1

- **影响范围**：`Phase 2 / Phase 4 / future skill runtime`
- **为什么必须确认**：这决定 v1 是否允许 skill 向 session 动态注册 hooks，以及 snapshot/restore 要不要承诺持久化它们。
- **当前建议 / 倾向**：`v1 先只落 platform-policy / session 两层真相；skill registration 只保留接口，不承诺默认开放`
- **Q**：`v1 是否允许 skill 在运行时注册会跨 resume 持久化的 session hooks？`
- **A**：通过阅读 `docs/investigation/action-plan-qna-clarification-batch-1.md` 后，业主表示同意采取推荐措施：`v1 先不开放 skill 在运行时注册且跨 resume 持久化 session hooks 的能力，只保留 future seam 与接口。`

#### Q2

- **影响范围**：`Phase 3 / Phase 5`
- **为什么必须确认**：blocking hook 在 service-binding 失败、超时、远端 worker 异常时，到底 fail-open 还是 fail-closed，会直接改变工具调用与 compact 行为。
- **当前建议 / 倾向**：`platform-policy source 默认 fail-closed；session source 与 observer-like hook 默认 fail-open，并写审计`
- **Q**：`对于 PreToolUse / PreCompact 这类 blocking hook，远端 runtime 失败时的默认策略是否采用“平台策略 fail-closed，其余 fail-open”？`
- **A**：通过阅读 `docs/investigation/action-plan-qna-clarification-batch-1.md` 后，业主表示同意采取推荐措施：`platform-policy source 默认 fail-closed；session source 与 observer-like hook 默认 fail-open；所有 fallback 决策必须写审计。`

#### Q3

- **影响范围**：`Phase 4 / eval-observability / security`
- **为什么必须确认**：audit 路径需要足够证据做 replay，但又不能把敏感 payload 原样写入 durable trace。
- **当前建议 / 倾向**：`client stream 永远 redacted；audit 仅保留最小可调试 detail + redaction hint / ref，不直接持久化完整敏感字段`
- **Q**：`hook 审计记录是否同意采用“最小可调试 detail + ref”策略，而不是保留完整未裁剪 payload？`
- **A**：同意。

### 6.2 问题整理建议

- 优先问会改变 runtime 失败语义与持久化语义的问题
- 不把“handler 内部怎么写”这类实现细节塞到架构确认项
- 所有 owner 决策都要同步回填到 `README` 与 hooks package README 的限制说明

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| `nacp-session` reality 漂移 | hooks client-visible kind 当前只有 `hook.broadcast` | high | action-plan 与实现都严格对齐现有 reality，不抢跑新 kinds |
| blocking hook 拖慢 turn | 远端 handler 慢或不稳定 | high | 统一 timeout、source-aware failure policy、审计留痕 |
| session hooks 恢复不完整 | DO hibernation / resume 后 registry 漂移 | high | snapshot/restore codec 进入 v1 in-scope |
| payload 泄露 | client stream 或 audit 持久化未正确 redaction | high | redaction metadata + session adapter + audit 最小 detail 三层收口 |
| capability / compact 与 hooks 双向耦合 | `PreToolUse` / `PreCompact` 很容易侵入下游实现 | medium | kernel / capability 只消费聚合结果，不感知 runtime 细节 |

### 7.2 约束与前提

- **技术前提**：Cloudflare Workers / Durable Objects / TypeScript / 单线程 V8 isolate / 无 shell runtime
- **运行时前提**：single-active-turn、WebSocket-first + HTTP fallback session delivery、hooks 是治理扩展层而不是客户端回写层、client-visible hook 事件必须复用现有 `session.stream.event`
- **组织协作前提**：`packages/*` 为独立 repo；`@nano-agent/hooks` 作为库供 kernel/session/capability/eval 复用；最终 deployable Worker / DO 组装层在后续运行时包中完成
- **上线 / 合并前提**：不得重新引入 shell-command hooks、自由 JSON outcome、错误的 session kind 宇宙；不得把真实 storage wiring 写死进本包

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/hooks-by-GPT.md`
  - `docs/design/eval-observability-by-opus.md`
  - `docs/design/agent-runtime-kernel-by-GPT.md`
- 需要同步更新的说明文档 / README：
  - `README.md`
  - `packages/hooks/README.md`
- 需要同步更新的测试说明：
  - `packages/hooks/test/README.md`（如创建）

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `packages/hooks` 可独立 `build/typecheck/test`
  - schema/doc 脚本可稳定输出
- **单元测试**：
  - catalog / outcome / matcher / registry / dispatcher / guards / adapters 全覆盖
- **集成测试**：
  - local-ts trusted hook
  - service-binding hook.emit/outcome roundtrip
  - session resume registry restore
- **端到端 / 手动验证**：
  - 模拟 `SessionStart -> UserPromptSubmit -> PreToolUse(block?) -> PostToolUse -> SessionEnd`
  - 模拟 `PreCompact` 拦截 compact
- **回归测试**：
  - `hook.broadcast` shape 快照
  - `audit.record` detail shape 快照
  - timeout / recursion / failure policy 回归
- **文档校验**：
  - README、schema、registry doc 与 action-plan / design 文稿一致

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `@nano-agent/hooks` 已形成独立包骨架与稳定导出面
2. hooks event/outcome/registry/dispatcher/runtime contract 已冻结，且不依赖 shell 假设
3. `hook.emit / hook.outcome / hook.broadcast / audit.record` 四条 reality 已被正确接线
4. session hook snapshot/restore 已可支撑 Session DO hibernation / resume
5. blocking、timeout、resume、redaction 四类高风险路径均有稳定回归测试

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | hooks 已具备事件目录、结果校验、registry、dispatcher、两类 runtime、审计与 session 适配 |
| 测试 | catalog/outcome/dispatcher/runtime/snapshot 及关键 integration 场景均可稳定回归 |
| 文档 | action-plan、设计文稿、README、schema/doc 生成物同步完成 |
| 风险收敛 | 不再混淆 Core 与 Session hooks reality，不再依赖 shell hook 心智 |
| 可交付性 | 包可被 kernel / capability / session / eval 直接导入并继续装配 |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待回填`
- **哪些编号的拆分还不够合理**：`待回填`
- **哪些问题本应更早问架构师**：`待回填`
- **哪些测试安排在实际执行中证明不够**：`待回填`
- **模板本身还需要补什么字段**：`待回填`

---

## 10. 结语

> 这份 action-plan 以 **冻结 nano-agent 的 lifecycle governance seam** 为第一优先级，采用 **先事件目录与结果 contract、再 registry/dispatcher/runtime、后协议映射与恢复收口** 的推进方式，优先解决 **主循环关键节点如何被受控扩展、如何被审计、如何被客户端稳定观测**，并把 **不做 shell hooks、不做客户端回写、不发明额外 Session event 宇宙** 作为主要约束。整个计划完成后，`Hooks` 应达到 **能够稳定支撑平台治理、session 扩展、审计回放与 client-visible hook 观测** 的程度，从而为后续的 skill runtime、session-do-runtime 与 eval/observability 提供稳固基础。
