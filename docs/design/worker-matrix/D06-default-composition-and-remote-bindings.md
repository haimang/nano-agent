# D06 — default composition 升级 + remote bindings factory 补全

> 功能簇: `worker-matrix / composition-upgrade`
> 讨论日期: `2026-04-23`
> 讨论者: `Claude Opus 4.7 (1M context)`
> 关联调查报告:
> - `docs/plan-worker-matrix.md` §3 I3/I4、§5.3 P2.C/P2.D、§6.2 P2 DoD
> - `docs/design/worker-matrix/D01-agent-core-absorption.md`(host shell 落点)
> - `docs/design/worker-matrix/D03-context-core-absorption-and-posture.md`(workspace/assembler handle)
> - `docs/design/worker-matrix/D05-initial-context-host-consumer.md`(composition assembler 被 consumer 消费)
> - `docs/design/worker-matrix/D07-agent-bash-tool-call-activation.md`(capability handle 来源 / local-ts fallback)
> 文档状态: `draft`

---

## 0. 背景与前置约束

当前仓库实测事实:

1. `packages/session-do-runtime/src/composition.ts::createDefaultCompositionFactory()` 返回 `{ kernel: undefined, llm: undefined, capability: undefined, workspace: undefined, hooks: undefined, eval: undefined, storage: undefined }`(空 handle bag)
2. `packages/session-do-runtime/src/remote-bindings.ts::makeRemoteBindingsFactory()` 对 `kernel / workspace / eval / storage` 4 个 nullable 未解决

这是 first-wave live agent turn loop 的 **核心阻塞点**。P2 要让 live loop 真跑通,必须把 default composition 升级为真实装配,并给 remote bindings 4 个 nullable 明确处理。

本设计对应 charter I3 + I4 + P2.C + P2.D。

- **项目定位回顾**:agent.core 的 `createDefaultCompositionFactory` 是 host composition 的装配中心;D01-D05 搬完 / D07 激活 service binding 后,composition 是"让所有东西接起来"的那一步。
- **本次讨论的前置共识**:
  - D01 F1 已把 host shell 搬进 `workers/agent-core/src/host/composition/`
  - D03 F1-F4 已把 context 能力搬进 workers/context-core;`appendInitialContextLayer` API shape 已冻结
  - D04 F1-F2 已把 filesystem slice / storage-topology 搬进 workers/filesystem-core
  - D02 F1-F6 已把 capability-runtime 搬进 workers/bash-core 并完成 real preview deploy
  - charter Q2a + `local-ts` fallback 已确认(D07 实施)
  - charter Q3c compact opt-in(不自动装)已确认
  - charter Q4a host-local(不发明 remote filesystem RPC)已确认
- **显式排除的讨论范围**:
  - 任何 handle 的业务逻辑修改(byte-identical)
  - 新增 handle 类型
  - `tool.call.*` remote 激活(D07)
  - `initial_context` consumer 接线(D05)

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**:`default composition upgrade + remote bindings factory completion`
- **一句话定义**:把 `createDefaultCompositionFactory` 从返回空 handle bag 升级为真实装配 `kernel / llm / capability / workspace / hooks / eval` 6 个 handle(来自 D01-D04 已搬 runtime);把 `makeRemoteBindingsFactory` 对 `kernel / workspace / eval / storage` 4 个 nullable 提供显式处理(honest degrade 或真实装配)。
- **边界描述**:
  - **包含**:default composition 真实装配代码、remote bindings 4 nullable 处理、composition handle types 对齐、package-local tests 升级
  - **不包含**:handle 业务逻辑修改、新 handle 类型、tool.call remote 激活、initial_context consumer、service binding wrangler 配置
- **关键术语对齐**:

| 术语 | 定义 |
|------|------|
| default composition | host DO 启动时默认装配的 `kernel / llm / capability / workspace / hooks / eval / storage` 7-tuple |
| remote composition | 当 `CAPABILITY_WORKER / HOOK_WORKER` 等 service bindings 存在时,返回 remote handle 的装配路径 |
| handle | 每个 "能力域" 的 runtime 实例,由 composition 提供给 kernel / ingress 消费 |
| honest degrade | 当某 handle 的 substrate 不可用时,返回一个 "诚实不可用" 的 handle(如 throw on use / empty implementation + evidence),而非 silent undefined |
| 4 nullable | `kernel / workspace / eval / storage` 在 `remote-bindings.ts` 中目前留 null/undefined |

### 1.2 参考调查报告

- `packages/session-do-runtime/src/composition.ts:82-106` — 当前 default composition factory(空 bag)
- `packages/session-do-runtime/src/remote-bindings.ts:324-399` — 当前 remote bindings factory(4 nullable)
- `docs/eval/worker-matrix/agent-core/index.md` §3 当前最大 runtime 缺口判断
- `docs/eval/worker-matrix/00-contexts/03-evaluations/current-worker-reality.md` §4.1 / §4.2 — reality

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **架构角色**:让 host runtime 从"壳完整 + substrate 各自吸收完成"状态升级到"live agent turn loop 可真跑通"
- **服务于**:P2 DoD、charter exit primary #1(live agent turn loop)、后续所有 session 启动
- **依赖**:D01-D04 全部完成(handle 来源物理就绪)、D07 PR 中对 `CAPABILITY_WORKER` binding 的 service name / fetch handler 冻结(D07 与 D06 互相依赖,建议同一 P2 周期内 sequence:D06 先 ship 结构 → D07 激活)
- **被谁依赖**:D05(consumer 需要 composition 提供 assembler handle)、P2 live e2e、live loop 全部真实 session

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|----------|----------|------|
| D01 A1 host shell | 上游 | 强 | composition 在 host shell 内 |
| D02 B1 bash runtime | 上游 | 强 | capability handle 的 **local** 来源;D07 激活后切 remote 默认 |
| D03 C1/C2 context | 上游 | 强 | workspace / assembler handle 来源 |
| D04 D1/D2 filesystem | 上游 | 强 | workspace substrate 来源;host-local posture(Q4a)|
| D05 initial_context consumer | 下游 | 强 | consumer 调 `this.composition.assembler` |
| D07 agent↔bash activation | 同周期 | 强 | capability handle default 从 `local-ts` 切 `serviceBindingTransport`(Q2a);本设计提供 local-ts fallback 路径保留 |
| W0 nacp-core hooks-catalog | 参考 | 中 | hooks handle 的 wire vocabulary import |
| B7 LIVE | 非破坏 | 强 | BoundedEvalSink dedup / overflow disclosure 在 eval handle 内不漂移 |

### 2.3 一句话定位陈述

> "在 nano-agent 里,`default composition upgrade + remote bindings completion` 是 **worker-matrix P2 的核心装配交付物**,负责 **把 createDefaultCompositionFactory 从空 handle bag 升级为真实 kernel/llm/capability/workspace/hooks/eval 6-tuple,并给 remote-bindings.ts 的 kernel/workspace/eval/storage 4 nullable 提供 honest degrade 或真实装配**,对上游(charter exit primary #1)提供 **live agent turn loop 的真实可跑** 的 runtime 保证,对下游(D05 / 所有 session 消费者)要求 **composition handle 类型稳定、honest degrade 明确**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点

| 被砍项 | 来源 | 砍的理由 | 未来回补 |
|--------|------|----------|----------|
| compact 默认装(`createKernelCompactDelegate` 自动挂)| 原 v0.1 想象 | charter Q3c opt-in 保持 | 否 |
| 多 kernel profile(alternate scheduler)| "灵活" | 首波单一 kernel 即可 | 未来按需扩 |
| inspector facade default ON | 对 OBS 的自动兜底 | D03 明确默认 OFF | 否 |
| 把 `storage` handle 升级为 live DO/KV/R2 访问器 | "完成度" | Q4a host-local;tenant wrapper 由 host DO 调 | 否 |
| 本设计内同步改 wrangler.jsonc service bindings | 越界 D07 | 分离 composition vs 配置 | 否 |
| `ReferenceBackend.connected: true` 默认 | 看似 live | D04 `connected: false` default | 否 |
| 重构 `SessionOrchestrator` 机制 | 顺手 | byte-identical | 否 |

### 3.2 接口保留点

| 扩展点 | 表现形式 | 第一版行为 | 未来演进 |
|--------|----------|------------|----------|
| `createDefaultCompositionFactory(env, services)` | factory signature | 保留 signature;内部真实装配 | 未来按 profile 多 factory |
| `makeRemoteBindingsFactory(env)` | factory signature | 保留;4 nullable 改显式处理 | 未来所有 handle 都可 remote |
| `capability` handle 的 transport 选择 | `serviceBindingTransport` vs `local-ts` | Q2a:远端 default + local-ts fallback seam | 未来 env / policy 决定 |
| `eval` handle = BoundedEvalSink | 保持 sink owner 在 host | 不改 | 未来 durable sink 下沉策略需独立 charter |

### 3.3 完全解耦点

- **解耦对象**:composition factory 结构 vs handle 内部实现
- **解耦原因**:D01-D04 提供 handle 实现;本设计只负责"拿来 + 连线";不实装 handle 内部
- **依赖边界**:factory 只 import D01-D04 公开 API

### 3.4 聚合点

- **聚合对象**:`workers/agent-core/src/host/composition/index.ts` 作为 composition 唯一构造中心
- **聚合形式**:单一 `createDefaultCompositionFactory` + 单一 `makeRemoteBindingsFactory`;不另造并行 factory
- **为什么不能分散**:avoiding "两处 composition" 的现实 bug(PR review 时 grep 验证仅一个 `createDefaultCompositionFactory` 定义)

---

## 4. 三个代表实现对比(内部 precedent)

### 4.1 现有 `createDefaultCompositionFactory` 空 bag

- **实现概要**:所有 handle 返回 undefined;kernel / ingress 走 honest degrade 路径
- **亮点**:不 panic
- **借鉴**:honest degrade 不仅现在有;升级后在 handle 缺失时仍保留
- **不照抄**:升级后 6 handle 至少非 undefined

### 4.2 `makeRemoteBindingsFactory` 现状

- **实现概要**:`capability / hooks` 使用 service binding;`kernel / workspace / eval / storage` 留 null
- **借鉴**:已实现的 capability / hooks 路径作为模板
- **不照抄**:新增 4 nullable 处理不意味着都 remote 化(Q4a workspace host-local)

### 4.3 B7 LIVE `BoundedEvalSink`

- **实现概要**:host DO 内实例化 sink;owner 在 host
- **借鉴**:`eval` handle 继续由 host 拥有;不迁到独立 worker
- **不照抄**:本设计不改 sink 内部

### 4.4 横向对比

| 维度 | 当前空 bag | remote factory 现状 | B7 LIVE sink | **D06** |
|------|-----------|--------------------|--------------|---------|
| kernel | undefined | null | n/a | **真实装配(from workers/agent-core/src/kernel)** |
| llm | undefined | n/a | n/a | **真实装配(from src/llm)** |
| capability | undefined | service binding | n/a | **Q2a:service binding default + local-ts fallback** |
| workspace | undefined | null | n/a | **host-local(from workers/filesystem-core)** |
| hooks | undefined | service binding | n/a | **真实装配(from src/hooks)** |
| eval | undefined | null | real | **real BoundedEvalSink(from src/eval)** |
| storage | undefined | null | n/a | **host DO tenant wrapper;honest degrade** |

---

## 5. In-Scope / Out-of-Scope

### 5.1 In-Scope

- **[S1]** `createDefaultCompositionFactory` 升级:
  - `kernel`:从 `workers/agent-core/src/kernel` 实例化 `KernelRunner`
  - `llm`:从 `src/llm` 实例化 `LLMExecutor`(provider registry 来源);env 配置未 ready 时 honest degrade
  - `capability`:Q2a 的 `serviceBindingTransport`(通过 `CAPABILITY_WORKER` env binding)作 default;若 binding 缺失 → fall back `local-ts`(保留 seam,per D07)
  - `workspace`:host-local `composeWorkspaceWithEvidence`(来自 `workers/filesystem-core` via import);tenant wrapper 由 DO 调用点保证
  - `hooks`:从 `src/hooks` 实例化 `HookDispatcher + HookRegistry`;remote hook binding 已 live 不变
  - `eval`:从 `src/eval` 实例化 `BoundedEvalSink`(保留 overflow disclosure / dedup,B7 LIVE 契约)
  - `storage`:保持 handle undefined 或 honest degrade;tenant wrapper 由 host DO 的 `getTenantScopedStorage` 调,不迁到 composition
- **[S2]** `makeRemoteBindingsFactory` 补 4 nullable:
  - `kernel`:host-local only;remote 不激活(返回 `null` + 文档说明 reason:"kernel 始终 host-local")
  - `workspace`:host-local(Q4a);remote null + 文档说明 reason
  - `eval`:host-local(sink owner 在 host);remote null + 文档说明 reason
  - `storage`:host-local(tenant wrapper 在 host DO);remote null + 文档说明 reason
- **[S3]** composition handle types 对齐:在 `types.ts` 里明确 6 handle 的 TS interface;4 个 remote null 有显式 `null` 类型标注
- **[S4]** local-ts fallback seam 保留:`capability` handle factory 保留一个 opt-in 路径,让 env(e.g. `CAPABILITY_TRANSPORT=local-ts`)或 test 显式切到 local-ts;仅 D07 默认切远端
- **[S5]** package-local tests:
  - 单元测试覆盖 `createDefaultCompositionFactory` 返回 6 handle 都非 undefined(storage 显式 null)
  - `makeRemoteBindingsFactory` 返回 4 nullable 都有显式处理(非隐式 undefined)
  - `local-ts` opt-in 可通过 env 切换
  - `compact` 保持 opt-in(default composition 不自动挂 `createKernelCompactDelegate`)
- **[S6]** `packages/session-do-runtime/src/composition.ts` 与 `workers/agent-core/src/host/composition/index.ts` 共存期两处保持一致;diff 在 PR 内 pair
- **[S7]** 与 D05 F1 协调:`this.composition.assembler` 在 composition 升级后非 undefined(workspace handle 提供 assembler),让 D05 consumer 路径真实生效

### 5.2 Out-of-Scope

- **[O1]** tool.call remote 激活配置(D07)
- **[O2]** initial_context consumer(D05)
- **[O3]** handle 业务逻辑修改
- **[O4]** 新增 handle 类型
- **[O5]** compact 默认装(违反 Q3c)
- **[O6]** workspace remoteize(违反 Q4a)
- **[O7]** wrangler.jsonc 修改
- **[O8]** new provider / new hook family
- **[O9]** inspector facade default ON
- **[O10]** `ReferenceBackend.connected: true`

### 5.3 边界清单

| 项目 | 判定 | 理由 |
|------|------|------|
| `capability` handle 缺 `CAPABILITY_WORKER` binding 时的 behavior | `in-scope 明确 fall back local-ts + 记 evidence` | 不 silent |
| `eval` sink overflow disclosure 阈值调整 | `out-of-scope` | B7 LIVE 契约 |
| composition 升级时同步改 `HookDispatcher` 的 matcher 规则 | `out-of-scope` | byte-identical |
| `storage` handle 改为 "返回 host DO storage facade" | `out-of-scope` | tenant wrapper 在 DO 调用点;composition 不管 |
| compact 在 env flag 下 opt-in 挂载 | `in-scope(documented hook)` | Q3c opt-in 纪律;env flag 属 opt-in |
| PR 内直接删 `packages/session-do-runtime/src/composition.ts` | `out-of-scope` | 共存期保留;D09 deprecate 时删 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**:`capability` default = `serviceBindingTransport`(远端),`local-ts` 保留为显式 fallback(Q2a)
   - **为什么**:first-wave 唯一 battle-test cross-worker loop
   - **代价**:`CAPABILITY_WORKER` binding 缺失时 fall back 增加 1 条路径;需要 evidence 标记
   - **缓解**:env flag `CAPABILITY_TRANSPORT=local-ts` 可显式切;missing binding 时 fall back + evidence

2. **取舍 2**:`remote bindings` 4 nullable(kernel/workspace/eval/storage)**显式返回 null + 文档 reason**,不 throw
   - **为什么**:honest degrade;现有消费者对 null 有容忍
   - **代价**:需要消费者 check null;但既有代码已 handle
   - **缓解**:TS types 显式 `null`;runtime path 不 throw

3. **取舍 3**:共存期 `packages/session-do-runtime/src/composition.ts` 与 `workers/agent-core/src/host/composition/index.ts` 两处保持一致
   - **为什么**:P1 共存期原包仍被消费者 import;不改原包会让 P2 live loop 依旧空 bag
   - **代价**:两处 duplicate
   - **缓解**:D09 deprecate 时清理 packages 侧

4. **取舍 4**:不在本设计内 flip composition 默认触发 compact(Q3c)
   - **为什么**:纪律不漂移
   - **代价**:首波 live loop 无 compact
   - **缓解**:opt-in env flag 可启用(但默认 OFF)

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解 |
|------|----------|------|------|
| composition 升级后 B7 LIVE 5 tests 红 | eval sink / BoundedEvalSink 接线错 | pre-worker 硬契约破坏 | PR 前跑 `node --test test/*.test.mjs`;红则立即回滚 |
| `CAPABILITY_WORKER` binding 缺失,silent undefined capability | remote binding 未配 + 无 fallback | tool.call 死循环 / silent success | honest degrade path + evidence `capability_missing_binding_fell_back_local_ts` |
| workspace handle 与 D04 host-local import 漂移 | D04 共存期 re-export 断裂 | composition 找不到 workspace | 共存期保持 WCA / workers/filesystem-core 双 import;grep 验证 |
| local-ts fallback 被意外激活 | env flag 默认值 | 远端路径未 battle-test | env flag default = `serviceBinding`;flag 缺失也 default 远端 |
| D06 merge 时 D05 consumer 刚好 composition.assembler 为 undefined | D05 先于 D06 merge | initial_context consumer 被 degrade 跳过 | D05 F1 degrade 路径已覆盖;但建议 D06 先于 D05 merge |
| compact 被 env flag 开启后 silent memory leak | opt-in 但不清理 | 长 session 内存膨胀 | 保留现有 compact 治理;不在本设计内扩散 |

### 6.3 价值

- **对开发者自己**:live loop 的装配路径清晰;handle 出处可 grep;debug 容易
- **对 nano-agent 长期演进**:composition 作为 configurable profile center,为未来 production env flip / multi-profile 留结构
- **对 "上下文管理 / Skill / 稳定性" 杠杆**:
  - 稳定性:honest degrade 把 silent undefined 转成显式 fallback + evidence
  - 上下文管理:workspace / assembler handle 接通后,D05 initial_context consumer 才能真消费
  - Skill:未来 skill handle 加入时,有清晰的 composition 扩展点

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | `createDefaultCompositionFactory` 升级 | kernel/llm/capability/workspace/hooks/eval 6 handle 真实装配;storage honest degrade | ✅ 返回对象的 6 字段非 undefined(storage 显式 null/degrade);`typeof composition.kernel === "object"` 等断言绿 |
| F2 | `makeRemoteBindingsFactory` 4 nullable 补全 | kernel/workspace/eval/storage 显式 null + 文档 reason | ✅ 返回对象里 4 字段有显式 null 或 honest degrade;types 对齐 |
| F3 | `capability` handle Q2a 装配 | service binding default + local-ts fallback | ✅ default 走远端;env flag `CAPABILITY_TRANSPORT=local-ts` 切 local-ts;缺 binding 时 fall back local-ts + evidence |
| F4 | `workspace` handle host-local 装配(Q4a)| 从 workers/filesystem-core 的 MountRouter/WorkspaceNamespace in-process 组装 | ✅ composition.workspace 是真实 WorkspaceNamespace;remote null |
| F5 | `eval` handle real BoundedEvalSink | from src/eval;保留 overflow disclosure / dedup | ✅ B7 LIVE 5 tests 全绿 |
| F6 | compact posture 遵守 Q3c | default 不自动装 `createKernelCompactDelegate` | ✅ grep: `createDefaultCompositionFactory` 内不调 `createKernelCompactDelegate`(除非 env flag 明确 opt-in)|
| F7 | 共存期 packages/composition 同步改 | byte-identical | ✅ packages vs workers 两处 diff pair |
| F8 | package-local + 共存期 tests | 覆盖 6 handle 非 undefined、Q2a fallback、Q3c opt-in 纪律 | ✅ `pnpm --filter workers/agent-core test` / `pnpm --filter @nano-agent/session-do-runtime test` 全绿 |

### 7.2 详细阐述

#### F1: `createDefaultCompositionFactory` 升级

- **输入**:`env`(Worker env bag)、`services`(service bindings)
- **输出**:`{ kernel, llm, capability, workspace, hooks, eval, storage }` 7-tuple
- **核心逻辑**:
  - `kernel` = new `KernelRunner({ ... })`(args from D01 F2 类型)
  - `llm` = new `LLMExecutor({ env.LLM_PROVIDER, ... })`;provider 缺时 honest degrade
  - `capability` = resolveCapability(env, services)
  - `workspace` = `composeWorkspaceWithEvidence({ mounts, namespace, backend, evidenceSink })`
  - `hooks` = new `HookDispatcher(new HookRegistry(), services.HOOK_WORKER)`
  - `eval` = new `BoundedEvalSink({ capacity, overflowDisclosure })`
  - `storage` = null(host DO 直接 via `getTenantScopedStorage`)
- **边界情况**:
  - 任一 handle 无法装配 → honest degrade + evidence + 不 panic
  - compact 不默认挂(Q3c)
- **一句话收口目标**:✅ **composition 6 handle 非 undefined;B7 LIVE 全绿;D05 consumer 能 `composition.assembler` 拿到**(`workspace` 含 assembler 引用)

#### F2: `makeRemoteBindingsFactory` 4 nullable 补全

- **输入**:`env`(含可能 missing 的 `CAPABILITY_WORKER` / `HOOK_WORKER`)
- **输出**:remote bindings `{ kernel, workspace, eval, storage, capability, hooks }` 7-tuple
- **核心逻辑**:
  - `kernel` = `null`(host-local only;注释说明 reason)
  - `workspace` = `null`(Q4a;注释说明)
  - `eval` = `null`(sink owner host;注释说明)
  - `storage` = `null`(tenant wrapper 在 host DO;注释说明)
  - `capability` = Q2a:优先 `services.CAPABILITY_WORKER` + `serviceBindingTransport`;缺失 → null + evidence(F1 resolveCapability 再 fall back)
  - `hooks` = 现有 `services.HOOK_WORKER`
- **边界情况**:env 格式异常 → honest degrade
- **一句话收口目标**:✅ **remote bindings 4 nullable 显式 null + 文档;TS types 标注 `| null`**

#### F3: `capability` handle Q2a 装配

- **输入**:`env.CAPABILITY_WORKER`(service binding)、`env.CAPABILITY_TRANSPORT`(env flag, default `serviceBinding`)
- **输出**:capability handle
- **核心逻辑**:
  ```ts
  function resolveCapability(env, services) {
    const mode = env.CAPABILITY_TRANSPORT ?? "serviceBinding";
    if (mode === "local-ts") {
      return new LocalTsCapability(...);
    }
    if (services.CAPABILITY_WORKER) {
      return new ServiceBindingCapability(services.CAPABILITY_WORKER);
    }
    // fallback
    sink.emit(evidence("capability_missing_binding_fell_back_local_ts"));
    return new LocalTsCapability(...);
  }
  ```
- **边界情况**:env flag 明确 local-ts → 一定用 local-ts(测试 / 开发)
- **一句话收口目标**:✅ **default 远端;fallback / opt-in local-ts 路径 testable**

#### F4: `workspace` handle host-local

- **输入**:`workers/filesystem-core` 的 public API
- **输出**:composition.workspace 是真实 `WorkspaceNamespace` / `ContextAssembler` 复合体
- **核心逻辑**:`composeWorkspaceWithEvidence({ ...D04 outputs..., evidenceSink })`;共存期从 `packages/workspace-context-artifacts` 或 `workers/filesystem-core` 任一 resolve 均可,D04 merge 后优先 workers 侧
- **边界情况**:共存期 import path 灵活
- **一句话收口目标**:✅ **composition.workspace.namespace 真实对象;workspace truth 单一**

#### F5: `eval` handle

- **输入**:env.EVAL_SINK_CAPACITY 等
- **输出**:`BoundedEvalSink` 实例
- **核心逻辑**:byte-identical;B7 LIVE 契约保持
- **一句话收口目标**:✅ **B7 LIVE 5 tests 全绿;overflow disclosure 不变**

#### F6: compact posture(Q3c)

- **输入**:charter Q3c
- **输出**:代码层 grep 验证
- **核心逻辑**:`createDefaultCompositionFactory` 内 **不调** `createKernelCompactDelegate`;仅当 `env.ENABLE_COMPACT === "true"` 时 opt-in 挂(代码层显式标注 opt-in)
- **一句话收口目标**:✅ **default 不自动装;opt-in path 存在但默认 OFF**

#### F7: 共存期 packages/composition 同步改

- **输入**:F1-F6 workers 侧实现
- **输出**:packages/session-do-runtime/src/composition.ts byte-identical 补丁
- **核心逻辑**:两处 PR 同步;D09 deprecate 时清
- **一句话收口目标**:✅ **两处 composition 行为一致;grep 验证**

#### F8: tests

- **输入**:F1-F7
- **输出**:
  - workers/agent-core/test/host/composition/{default,remote}.test.ts
  - packages/session-do-runtime/test/composition.test.ts
- **覆盖**:
  - 6 handle 都非 undefined(storage 可 null)
  - Q2a:default 远端 + env flag local-ts 切换 + 缺 binding 时 fall back + evidence
  - Q3c:default 不装 compact;opt-in 可装
  - B7 LIVE 5 tests 全绿(root)
- **一句话收口目标**:✅ **package-local tests 全绿 + root tests 全绿**

### 7.3 非功能性要求

- **性能目标**:composition 初始化时间 < 50ms(host-local 组件)
- **可观测性要求**:honest degrade 有 evidence;silent undefined 零命中
- **稳定性要求**:B7 LIVE 全程绿;D05 consumer 可拿到 assembler
- **测试覆盖要求**:F8 覆盖所有 handle + fallback + opt-in

---

## 8. 可借鉴的代码位置清单

### 8.1 现有代码

| 位置 | 内容 | 借鉴点 |
|------|------|--------|
| `packages/session-do-runtime/src/composition.ts:82-106` | 当前空 bag factory | F1 起点 |
| `packages/session-do-runtime/src/remote-bindings.ts:324-399` | 当前 remote factory | F2 起点 |
| `packages/agent-runtime-kernel/src/*` | KernelRunner | F1 kernel 装配 |
| `packages/llm-wrapper/src/*` | LLMExecutor | F1 llm 装配 |
| `packages/capability-runtime/src/targets/service-binding.ts` | serviceBindingTransport | F3 |
| `packages/workspace-context-artifacts/src/*` + `packages/storage-topology/src/*` | workspace substrate | F4(共存期)|
| `packages/hooks/src/*` | HookDispatcher / HookRegistry | F1 hooks 装配 |
| `packages/eval-observability/src/*` | BoundedEvalSink | F5 |

### 8.2 W0 / B7 LIVE precedent

| 位置 | 内容 | 借鉴点 |
|------|------|--------|
| B7 LIVE sink 契约 | sink dedup / overflow disclosure | F5 必守 |
| W0 `audit.record` / `EvidenceRecord` | evidence vocabulary | honest degrade evidence 发送格式 |

### 8.3 必须避开的反例

| 位置 | 问题 | 避开理由 |
|------|------|----------|
| silent `return undefined` for a missing handle | 违反 honest degrade | 必须 evidence |
| 在 `createDefaultCompositionFactory` 内 hardcode `createKernelCompactDelegate` | 违反 Q3c | 否 |
| 两处 composition(packages / workers)drift | 共存期 bug | PR pair diff |
| `capability` fallback 到 local-ts 后 silent | silent success 违规 | 必发 evidence |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

D06 是 P2 核心装配交付物:把 composition 从空 bag 升级到真实 6-tuple handle,给 remote bindings 4 nullable 显式处理。代码量小(~200-400 行修改 + 测试),但是 first-wave live loop 的关键节点 — charter exit primary #1 完全依赖 D06。共存期 packages / workers 两处同步修。主要风险在 B7 LIVE 契约守护 + honest degrade evidence 完整性。

### 9.2 Value Verdict

| 维度 | 评级 | 说明 |
|------|------|------|
| 贴合度 | **5** | live loop 骨干 |
| 性价比 | **5** | 代码量小 + 高杠杆 |
| "上下文 / Skill / 稳定性" 杠杆 | **5** | 上下文(workspace)直接受益;稳定性(honest degrade)显式化;未来 skill handle 有扩展点 |
| 开发者友好度 | **4** | handle 出处可 grep;共存期需看双份 |
| 风险可控 | **4** | B7 LIVE 网 + package-local tests |
| **综合价值** | **4.6** | P2 必做 |

### 9.3 下一步行动

- [ ] **决策确认**:owner approve;D06 PR 作者 claim
- [ ] **关联 PR**:D01-D04 先 merge → D06 PR(建议与 D05 同期,D06 先 merge)→ D07 激活 wrangler binding
- [ ] **待深入调查**:
  - `storage` handle 是否需要 "return null" 还是 "throw on use"?(建议:`null` + runtime 消费者 check;tenant wrapper 在 DO 直接拿 state.storage)
  - `capability` fallback 到 local-ts 时,是否要同时打 `capability_degraded: true` 的 env tag?(建议:evidence 足矣,env 不改)

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-23 | Claude Opus 4.7 | 初稿;基于 charter I3/I4 + Q2a/Q3c/Q4a 编制 |
