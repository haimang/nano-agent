# Nano-Agent 行动计划 — Capability Runtime

> 服务业务簇: `Capability Execution`
> 计划对象: `@nano-agent/capability-runtime` — fake bash compatibility surface 背后的 typed capability execution layer
> 类型: `new`
> 作者: `GPT-5.4`
> 时间: `2026-04-16`
> 文件位置: `packages/capability-runtime/`（主仓 monorepo 内的 workspace package）
> 关联设计 / 调研文档:
> - `docs/design/capability-runtime-by-GPT.md`
> - `docs/design/workspace-context-artifacts-by-GPT.md`
> - `docs/design/agent-runtime-kernel-by-GPT.md`
> - `docs/design/hooks-by-GPT.md`
> - `docs/action-plan/agent-runtime-kernel.md`
> - `docs/action-plan/llm-wrapper.md`
> - `docs/action-plan/nacp-core.md`
> - `docs/action-plan/nacp-session.md`
> - `docs/eval/vpa-fake-bash-by-GPT.md`
> - `docs/eval/vpa-fake-bash-by-opus.md`
> - `README.md`
> - 参考代码：`packages/nacp-core/`、`packages/nacp-session/`、`context/just-bash/`、`context/codex/codex-rs/tools/`、`context/codex/codex-rs/exec-server/`、`context/claude-code/`、`context/mini-agent/`
> 文档状态: `draft`

---

## 0. 执行背景与目标

`agent-runtime-kernel` 已经冻结了 **单活跃 turn + delegate-based loop** 的主循环边界，`llm-wrapper` 也已经冻结了 **模型执行边界与附件进入路径**。  
现在缺的，是让 agent 真正“做事”的那层：**如何把 LLM 熟悉的 bash/tool 外形，安全地落到 Worker-native 的声明式能力执行面上。**

Capability Runtime 不是“再造一个 shell”；它的职责是把：

1. fake bash / structured tool input
2. capability registry / policy / approval
3. local-ts / service-binding execution target
4. progress / cancel / result / artifact promotion

收敛成一个稳定、可治理、可测试的执行边界。  
这里对 `context/just-bash` 的态度需要进一步收紧：**它是参考代码与行为基线，不是运行时依赖。nano-agent 需要在自己仓内把相关能力重新实现，而不是直接引用对方库。**

- **服务业务簇**：`Capability Execution`
- **计划对象**：`@nano-agent/capability-runtime`
- **本次计划解决的问题**：
  - nano-agent 已明确需要 fake bash compatibility surface，但还没有 typed capability runtime 作为系统真相
  - `tool.call.*`、`NacpProgressResponse.progress`、`session.stream.event` 之间还缺一个能统一承接的执行层
  - Worker / V8 isolate 下不能依赖真实 bash、真实进程与真实宿主 FS，因此 just-bash 的完整可迁移命令面必须被拆成 allowlist / deferred / OOM-risk 三类，显式映射到 virtual workspace 与受控 fetch / TS 执行
  - hooks / permission / policy 若没有单一 capability gate，会重新散落到各个命令实现与 target handler 中
- **本次计划的直接产出**：
  - `packages/capability-runtime/` 独立包骨架
  - `CapabilityDeclaration / CapabilityPlan / CapabilityEvent / CapabilityResult` 类型体系
  - capability registry、fake bash adapter、policy gate、executor、`local-ts` / `service-binding` target、artifact promotion seam
  - 以 just-bash 完整可迁移命令面为目标，先维护 **allowlist** 与 **OOM-risk / deferred** 两张表，优先跑通无风险命令与 progress/cancel 路径，并对剩余映射面做差分检查

---

## 1. 执行综述

### 1.1 总体执行方式

本 action-plan 分 **5 个 Phase**，执行策略是 **“先 capability 真相，再 fake bash 映射，再 target dispatch，最后用分阶段命令面和场景测试收口”**。  
Capability Runtime 最大的风险不是“代码写不出来”，而是过早把完整 shell 幻觉、宿主进程模型、真实 git/runtime 全部塞进 v1。所以这份计划刻意先冻结：

1. **能力声明与事件 contract**
2. **命令外形与能力真相的分离**
3. **治理入口与 execution target dispatch**
4. **allowlist 命令清单与 OOM-risk / deferred 清单**

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | 包骨架与 Capability Domain Model | M | 建立独立包、冻结 capability 声明 / 计划 / 事件 / 结果 contract | `-` |
| Phase 2 | Registry / Command Planner / Fake Bash Adapter | L | 建出中央 registry，把 bash-shaped command 映射为 capability plan | Phase 1 |
| Phase 3 | Policy Gate / Execution Targets / ToolCall Bridge | L | 完成治理入口、`local-ts` 与 `service-binding` target，以及 NACP tool-call 对齐 | Phase 1, Phase 2 |
| Phase 4 | Result Normalization / Artifact Promotion / Runtime Events | M | 统一 progress / result / cancel / error，并与 workspace/kernel 对齐 | Phase 2, Phase 3 |
| Phase 5 | Command Surface / 测试 / 文档 / 收口 | L | 以 just-bash 完整可迁移映射面为目标，按 allowlist / deferred / OOM-risk 分阶段完成命令层收口并验证 | Phase 1-4 |

### 1.3 Phase 说明

1. **Phase 1 — 包骨架与 Capability Domain Model**
   - **核心目标**：建立独立包，冻结 capability declaration、plan、policy、result、event、target 等类型与公开接口。
   - **为什么先做**：若不先冻结 capability 真相，fake bash 与 target executor 很快会倒过来定义系统接口。
2. **Phase 2 — Registry / Command Planner / Fake Bash Adapter**
   - **核心目标**：建立中央 registry，并吸收 `just-bash` 的 browser entry / `defineCommand` / `customCommands` / command routing 心智，在仓内重写 fake bash compatibility layer，把命令外形映射成 capability plan。
   - **为什么放在这里**：必须先有 registry，才知道哪些命令可暴露、哪些命令要拒绝、哪些命令只是一层 planner。
3. **Phase 3 — Policy Gate / Execution Targets / ToolCall Bridge**
   - **核心目标**：建立统一 approval/policy gate，并把 capability plan 分发到 `local-ts` 或 `service-binding` target；同时对齐 `tool.call.request/response/cancel` 与 `NacpProgressResponse`.
   - **为什么放在这里**：治理与 target dispatch 是 capability runtime 的运行时心脏，必须先于分阶段命令面落地。
4. **Phase 4 — Result Normalization / Artifact Promotion / Runtime Events**
   - **核心目标**：统一 progress / cancel / result / error / oversized-output 语义，并与 workspace artifact promotion seam、kernel runtime event 需求对齐。
   - **为什么放在这里**：没有统一输出 contract，progress 与大结果处理会再次散落到各个 target。
5. **Phase 5 — Command Surface / 测试 / 文档 / 收口**
   - **核心目标**：以 just-bash 完整可迁移映射面为目标，先完成 allowlist 命令层与差分检查，再维护 OOM-risk / deferred 清单，并用 fake workspace、fake service-binding、fake policy 场景证明架构成立。
   - **为什么放在这里**：v1 的正确性最终要靠真实工作流与命令层兼容性，而不是靠抽象名词和 schema 自我说服。

### 1.4 执行策略说明

- **执行顺序原则**：`domain model -> in-repo fake-bash reimplementation -> registry/planner -> gate/targets -> normalize/promote -> command surface/tests`
- **风险控制原则**：不把完整 POSIX shell、真实进程管理、真实 git runtime 引入 v1；命令集必须显式分为 allowlist / deferred / OOM-risk，凡是有明显 OOM 风险的命令在 v1 直接禁止
- **测试推进原则**：先测 registry / planner / gate / executor，再用 allowlist 命令集做 fake workspace integration；progress/cancel/oversized result 与 against `context/just-bash` 的差分检查都必须有回归测试
- **文档同步原则**：实现时同步回填 `capability-runtime-by-GPT.md`、`workspace-context-artifacts-by-GPT.md`、`agent-runtime-kernel-by-GPT.md` 的依赖段落

### 1.5 本次 action-plan 影响目录树

```text
packages/capability-runtime/
├── src/
│   ├── version.ts
│   ├── types.ts
│   ├── registry.ts
│   ├── planner.ts
│   ├── policy.ts
│   ├── events.ts
│   ├── result.ts
│   ├── artifact-promotion.ts
│   ├── tool-call.ts
│   ├── executor.ts
│   ├── fake-bash/
│   │   ├── bridge.ts
│   │   ├── commands.ts
│   │   └── unsupported.ts
│   ├── targets/
│   │   ├── local-ts.ts
│   │   └── service-binding.ts
│   ├── capabilities/
│   │   ├── filesystem.ts
│   │   ├── search.ts
│   │   ├── network.ts
│   │   ├── exec.ts
│   │   └── vcs.ts
│   └── index.ts
├── test/
│   ├── registry.test.ts
│   ├── planner.test.ts
│   ├── fake-bash-bridge.test.ts
│   ├── policy.test.ts
│   ├── executor.test.ts
│   ├── tool-call.test.ts
│   ├── result.test.ts
│   ├── artifact-promotion.test.ts
│   └── integration/
│       ├── local-ts-workspace.test.ts
│       ├── service-binding-progress.test.ts
│       └── command-surface-smoke.test.ts
├── package.json
├── tsconfig.json
├── README.md
└── CHANGELOG.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** `@nano-agent/capability-runtime` 独立包骨架
- **[S2]** `CapabilityDeclaration / CapabilityPlan / CapabilityEvent / CapabilityResult / ExecutionTarget` 类型体系
- **[S3]** 中央 `CapabilityRegistry`
- **[S4]** `CommandPlanner`：bash-shaped command / structured tool -> capability plan
- **[S5]** `FakeBashBridge`：吸收 `just-bash` browser/command 思路后在仓内重写的命令适配层
- **[S6]** `CapabilityPolicyGate`：allow / ask / deny / hook-gated
- **[S7]** `CapabilityExecutor` façade
- **[S8]** `local-ts` execution target
- **[S9]** `service-binding` execution target（复用 `@nano-agent/nacp-core` transport reality）
- **[S10]** `tool.call.request/response/cancel` 对齐 helper 与 `NacpProgressResponse.progress` 消费逻辑
- **[S11]** progress / cancel / result / error / timeout / oversized-output 统一 contract
- **[S12]** artifact promotion seam（不负责物理存储）
- **[S13]** just-bash-compatible command surface 的仓内重写与 capability 映射：以 just-bash 完整可迁移命令面为目标，v1 明确维护 allowlist 与 OOM-risk / deferred 两张表，优先实现无风险命令，再持续补齐剩余可迁移面
- **[S14]** virtual git subset 接口占位（至少 `status/diff` seam，不要求完整实现）
- **[S15]** fake workspace / fake transport / fake policy 测试基座
- **[S16]** README、公开导出与 package scripts

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 完整 POSIX shell / shell language runtime
- **[O2]** 真实子进程 / 后台 shell / daemon / watch mode
- **[O3]** Python-first runtime 与任意多语言 child process
- **[O4]** 完整 git 实现与真实仓库 plumbing
- **[O5]** apt / npm / pip 等宿主级包管理
- **[O6]** browser automation DSL 本体
- **[O7]** 任意 socket / long-lived server process 管理
- **[O8]** workspace / artifact 的物理持久化细节
- **[O9]** client-visible `session.stream.event` 最终映射（由 kernel / session runtime 收敛）
- **[O10]** 直接把 `just-bash` 作为 runtime dependency 引入产物
- **[O11]** `tar/gzip` 等存在明显 OOM 风险的 archive / bulk buffer 命令在 v1 的启用

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| fake bash 作为 compatibility surface | `in-scope` | 这是吸收 LLM bash 先验的必要层 | 不重评 |
| just-bash 源码行为吸收后仓内重写 | `in-scope` | 这是当前明确冻结的新约束，避免产物直接依赖外部库 | 不重评 |
| 完整 shell runtime | `out-of-scope` | 会把 v1 重新拖回 Linux 心智 | 默认不重评 |
| `local-ts` target | `in-scope` | 这是 Worker/V8 isolate 下最自然的主执行路径 | 不重评 |
| `service-binding` target | `in-scope` | 浏览器/重能力/远端搜索都需要它 | 不重评 |
| `browser-rendering` 真正命令面 | `defer / depends-on-decision` | target seam 应预留，但 v1 不宜抢跑完整 DSL | browser capability 启动时 |
| virtual git subset 完整实现 | `defer / depends-on-decision` | 需要先知道 v1 最常见工作流只需要多少 | fake repo workflows 明确后 |
| `rg` 原生二进制语义 | `out-of-scope` | isolate 内无原生 ripgrep，必须明确降级为 TS scan / service-binding search | 默认不重评 |
| `tar/gzip` 等 archive/bulk commands | `out-of-scope` | 在 128MB isolate 下有明显 OOM 风险，v1 必须直接禁止并写明回退策略 | 待具备流式/分块实现后 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | package 骨架 | `add` | `package.json`、`tsconfig.json`、`README.md`、`CHANGELOG.md` | 建出独立 capability-runtime package | low |
| P1-02 | Phase 1 | capability domain types | `add` | `src/types.ts`、`src/events.ts`、`src/result.ts` | 冻结执行层真相 | high |
| P1-03 | Phase 1 | registry interfaces | `add` | `src/registry.ts` | 集中声明全部 capability metadata | medium |
| P2-01 | Phase 2 | command planner | `add` | `src/planner.ts` | 命令外形与 capability 真相分离 | high |
| P2-02 | Phase 2 | fake bash bridge | `add` | `src/fake-bash/bridge.ts`、`src/fake-bash/commands.ts` | 在仓内重写 just-bash compatibility surface | high |
| P2-03 | Phase 2 | unsupported command handling | `add` | `src/fake-bash/unsupported.ts` | 对不支持命令显式拒绝 | medium |
| P3-01 | Phase 3 | policy gate | `add` | `src/policy.ts` | 执行前治理只有一个入口 | high |
| P3-02 | Phase 3 | executor façade | `add` | `src/executor.ts` | 统一 dispatch / timeout / cancel | high |
| P3-03 | Phase 3 | local-ts target | `add` | `src/targets/local-ts.ts` | 在 Worker/TS 宿主执行最小能力集 | high |
| P3-04 | Phase 3 | service-binding target | `add` | `src/targets/service-binding.ts`、`src/tool-call.ts` | 对齐 NACP tool-call + progress stream | high |
| P4-01 | Phase 4 | result normalization | `add` | `src/result.ts` | 统一 progress/result/error/cancel | medium |
| P4-02 | Phase 4 | artifact promotion seam | `add` | `src/artifact-promotion.ts` | 大结果可提升为 artifact ref | medium |
| P4-03 | Phase 4 | runtime event emission | `add` | `src/events.ts` | 为 kernel 提供稳定 capability events | medium |
| P5-01 | Phase 5 | command surface pack | `add` | `src/capabilities/*.ts`、`src/fake-bash/commands.ts` | 先完成 allowlist 命令面，并以 just-bash 完整可迁移映射面为目标持续收口 | high |
| P5-02 | Phase 5 | tests | `add` | `test/*.test.ts`、`test/integration/*.test.ts` | 用 fake workspace / fake transport 收口 | medium |
| P5-03 | Phase 5 | 文档与导出面 | `update` | `README.md`、`src/index.ts` | 给 kernel/hook/llm 直接接入 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — 包骨架与 Capability Domain Model

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | package 骨架 | 参照 `nacp-core` / `nacp-session` 脚本与导出约定建立独立 package | `package.json`、`tsconfig.json`、`README.md`、`CHANGELOG.md` | 包可 `build/typecheck/test` | 基础命令校验 | 包结构与多仓约定稳定 |
| P1-02 | capability domain types | 定义 declaration、plan、policy、event、result、target、approval 相关类型 | `src/types.ts`、`src/events.ts`、`src/result.ts` | 执行层真相稳定 | 类型测试 / compile-only | 后续 Phase 不再重写 public types |
| P1-03 | registry interfaces | 定义 `CapabilityRegistry`、`CapabilityKind`、`CapabilityMetadata` 等 | `src/registry.ts` | 所有 capability 都可集中查询与枚举 | registry 单测 | metadata 字段足以支撑 v1 |

### 4.2 Phase 2 — Registry / Command Planner / Fake Bash Adapter

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | command planner | 把 bash command / structured tool 调用解析成 capability plan | `src/planner.ts` | 命令与 runtime 真相分离 | planner 单测 | planner 成为唯一命令进入口 |
| P2-02 | fake bash bridge | 复用 `Bash`、`defineCommand`、`customCommands` 建立命令桥 | `src/fake-bash/bridge.ts`、`src/fake-bash/commands.ts` | bash 只负责外形兼容 | bridge 单测 | 不支持命令不会隐式回退 |
| P2-03 | unsupported handling | 明确 unsupported / partially-supported / degraded commands 行为 | `src/fake-bash/unsupported.ts` | prompt 与 runtime 边界一致 | 单测 | 拒绝路径稳定可预测 |

### 4.3 Phase 3 — Policy Gate / Execution Targets / ToolCall Bridge

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | policy gate | 实现 allow / ask / deny / hook-gated 判定 | `src/policy.ts` | 执行治理集中化 | policy 单测 | 无 capability 私藏 approval 逻辑 |
| P3-02 | executor façade | 聚合 dispatch、timeout、abort、cancel、error normalization | `src/executor.ts` | 上游只调一个执行入口 | executor 单测 | execution lifecycle 集中管理 |
| P3-03 | local-ts target | 基于 virtual workspace 与受控 APIs 执行本地目标 | `src/targets/local-ts.ts` | v1 主路径跑通 | integration 单测 | 不依赖真实宿主进程 |
| P3-04 | service-binding target | 构造 `tool.call.request`、消费 `NacpProgressResponse.progress`、发 `tool.call.cancel` | `src/targets/service-binding.ts`、`src/tool-call.ts` | 远端能力与本地 contract 一致 | transport/mock tests | 与 `nacp-core` reality 对齐 |

### 4.4 Phase 4 — Result Normalization / Artifact Promotion / Runtime Events

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | result normalization | 统一 progress/result/error/cancel/timeout/oversized-output shape | `src/result.ts` | 上游不处理 target-specific 输出 | result 单测 | 所有 target 输出进同一合同 |
| P4-02 | artifact promotion seam | 定义大结果 -> artifact ref 升级接口 | `src/artifact-promotion.ts` | 大结果不必永远内联 | seam 单测 | 与 workspace package 责任边界清楚 |
| P4-03 | runtime event emission | 产出 kernel 可消费的 capability events | `src/events.ts` | kernel 不需猜测 capability 生命周期 | event 单测 | start/progress/end/error/cancel 均有统一事件 |

### 4.5 Phase 5 — Minimal Capability Pack / 测试 / 文档 / 收口

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | command surface pack | 维护 allowlist 与 OOM-risk / deferred 两张表，优先落地无风险命令并对 just-bash 注册表做差分检查 | `src/capabilities/*.ts`、`src/fake-bash/commands.ts` | v1 命令面按阶段稳定扩展 | smoke tests + diff tests | allowlist 可执行、剩余映射面有明确状态、OOM-risk 命令被显式禁止 |
| P5-02 | tests | 用 fake workspace、fake service-binding、fake policy 跑关键路径 | `test/*.test.ts`、`test/integration/*.test.ts` | 能回归治理与 target 行为 | `vitest run` | 高风险路径覆盖充足 |
| P5-03 | 文档与导出面 | 更新 README、导出 registry/planner/executor API | `README.md`、`src/index.ts` | 下游可直接接入 | 文档检查 | 用法、边界、不支持项写清楚 |

---

## 5. Phase 详情

### 5.1 Phase 1 — 包骨架与 Capability Domain Model

- **Phase 目标**：把 capability runtime 从“设计概念”变成一个可导入、可 typecheck 的独立包。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 新增文件**：
  - `packages/capability-runtime/package.json`
  - `packages/capability-runtime/tsconfig.json`
  - `packages/capability-runtime/src/types.ts`
  - `packages/capability-runtime/src/events.ts`
  - `packages/capability-runtime/src/result.ts`
  - `packages/capability-runtime/src/registry.ts`
- **本 Phase 修改文件**：
  - `packages/capability-runtime/README.md`
  - `packages/capability-runtime/src/index.ts`
- **具体功能预期**：
  1. `CapabilityDeclaration` 至少包含 `name`、`kind`、`input_schema`、`execution_target`、`policy`、`defer_loading` 等字段。
  2. `CapabilityEvent` 只描述内部执行语义，不直接绑定 client-visible `session.stream.event`.
  3. `CapabilityResult` 明确区分小结果内联、大结果 promotion 建议、以及 transport-level progress stream。
- **具体测试安排**：
  - **单测**：类型 guard、union exhaustiveness、默认值
  - **集成测试**：无
  - **回归测试**：compile-only contract tests
  - **手动验证**：逐项对照 `capability-runtime-by-GPT.md` 的 F1-F6
- **收口标准**：
  - 包骨架与现有 `packages/*` 约定一致
  - capability 真相源不依赖 fake bash、transport 或 workspace 的具体实现
  - 后续 Phase 不需要重写核心 public types
- **本 Phase 风险提醒**：
  - 如果 metadata 过少，后面 policy / planner 会被迫补丁式回填
  - 如果 metadata 过多，v1 会提前长成半个控制平面

### 5.2 Phase 2 — Registry / Command Planner / Fake Bash Adapter

- **Phase 目标**：把 LLM 熟悉的命令外形，变成受控 capability plan，而不是变成系统内核。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - `packages/capability-runtime/src/planner.ts`
  - `packages/capability-runtime/src/fake-bash/bridge.ts`
  - `packages/capability-runtime/src/fake-bash/commands.ts`
  - `packages/capability-runtime/src/fake-bash/unsupported.ts`
- **本 Phase 修改文件**：
  - `packages/capability-runtime/src/registry.ts`
- **具体功能预期**：
  1. planner 成为 `command string -> capability plan` 与 `structured tool -> capability plan` 的唯一入口。
  2. fake bash bridge 应以 `context/just-bash` 为行为参考，在我们仓内重写 parser/command bridge/registration seam；`context/just-bash` 只作为参考与差分测试基线，不作为 runtime dependency。
  3. unsupported / degraded commands 明确失败，不允许模糊 fallback 成“看起来成功”的行为。
  4. registry / planner 需要能表达 allowlist、partially-supported、deferred、OOM-risk 四类命令状态，避免“全量迁移”的 owner 决策在正文里再次被缩回最小命令集。
- **具体测试安排**：
  - **单测**：planner parse、registry lookup、unsupported 规则
  - **集成测试**：in-repo fake bash bridge + differential fixtures against `context/just-bash`
  - **回归测试**：被拒绝命令、参数缺失、危险命令面
  - **手动验证**：对照 `vpa-fake-bash-by-GPT.md` 的 allowlist / 不支持 / OOM-risk 清单
- **收口标准**：
  - 命令外形与能力真相完全分离
  - allowlist / deferred / OOM-risk 三类命令状态可被 registry 明确枚举
  - 命令适配层不会泄漏完整 Linux 幻觉
- **本 Phase 风险提醒**：
  - 若 planner 偷偷携带执行逻辑，会重新让 fake bash 变成内核
  - 若命令集一次铺太大，approval/policy 将难以及时跟上

### 5.3 Phase 3 — Policy Gate / Execution Targets / ToolCall Bridge

- **Phase 目标**：让 capability 真正可执行，并且执行前后都走统一治理与 transport contract。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
  - `P3-04`
- **本 Phase 新增文件**：
  - `packages/capability-runtime/src/policy.ts`
  - `packages/capability-runtime/src/executor.ts`
  - `packages/capability-runtime/src/tool-call.ts`
  - `packages/capability-runtime/src/targets/local-ts.ts`
  - `packages/capability-runtime/src/targets/service-binding.ts`
- **具体功能预期**：
  1. policy gate 作为执行前唯一治理入口，统一消费 hook / permission / runtime policy 决策。
  2. local-ts target 直接操作 virtual workspace、受控 fetch 与 TS-first execution，不假设真实 child process，并为后续 deployable Worker 的 WebSocket/HTTP 双入口提供同一执行合同。
  3. service-binding target 通过 `@nano-agent/nacp-core` 的 transport reality 执行，并消费 `ReadableStream<NacpEnvelope>` 形态的 progress。
- **具体测试安排**：
  - **单测**：policy matrix、executor dispatch、tool-call envelope build
  - **集成测试**：mock service-binding target + progress stream
  - **回归测试**：cancel、timeout、deny、hook veto、transport error
  - **手动验证**：对照 `packages/nacp-core/src/messages/tool.ts` 与 `transport/service-binding.ts`
- **收口标准**：
  - `tool.call.request/response/cancel` 与 `NacpProgressResponse` 的使用边界清楚
  - 任何 target 切换都不破坏上层 capability contract
  - 治理逻辑不再散落在 handler 内
- **本 Phase 风险提醒**：
  - 若 local-ts target 偷偷长出真实进程管理，就会破坏 Worker 假设
  - 若 service-binding target 自己重新定义 progress 协议，会与 NACP reality 脱节

### 5.4 Phase 4 — Result Normalization / Artifact Promotion / Runtime Events

- **Phase 目标**：把 target-specific 输出统一成 kernel 与 workspace 能消费的标准能力事件。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
  - `P4-03`
- **本 Phase 新增文件**：
  - `packages/capability-runtime/src/result.ts`
  - `packages/capability-runtime/src/artifact-promotion.ts`
  - `packages/capability-runtime/src/events.ts`
- **本 Phase 修改文件**：
  - `packages/capability-runtime/src/executor.ts`
- **具体功能预期**：
  1. 所有能力输出统一进入 `start/progress/end/error/cancel` 这条内部事件链。
  2. 大结果不由 capability runtime 自己持久化，而是通过 artifact promotion seam 交给 workspace/artifact layer。
  3. 结果 normalization 要显式区分 transport-level progress 与最终逻辑结果，避免把 progress 误当最终 response。
- **具体测试安排**：
  - **单测**：result mapping、artifact promotion decision、event emission
  - **集成测试**：大结果 promotion + continued progress
  - **回归测试**：partial output、oversized output、remote error normalization
  - **手动验证**：对照 `claude-code/utils/toolResultStorage.ts` 的反向借鉴点
- **收口标准**：
  - 任意 capability 都能走同一套结果 contract
  - artifact promotion 责任边界与 workspace package 对齐
  - kernel 可以只依赖 capability events，而不理解 target 私有细节
- **本 Phase 风险提醒**：
  - 若大结果仍以内联字符串为主，会直接冲击上下文与 session stream
  - 若 event 命名漂移，会破坏与 kernel action-plan 的对齐

### 5.5 Phase 5 — Command Surface / 测试 / 文档 / 收口

- **Phase 目标**：证明 capability runtime 不只是抽象层，而是真能支撑第一轮 agent skeleton 验证。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
  - `P5-03`
- **本 Phase 新增文件**：
  - `packages/capability-runtime/src/capabilities/filesystem.ts`
  - `packages/capability-runtime/src/capabilities/search.ts`
  - `packages/capability-runtime/src/capabilities/network.ts`
  - `packages/capability-runtime/src/capabilities/exec.ts`
  - `packages/capability-runtime/src/capabilities/vcs.ts`
  - `packages/capability-runtime/test/registry.test.ts`
  - `packages/capability-runtime/test/planner.test.ts`
  - `packages/capability-runtime/test/fake-bash-bridge.test.ts`
  - `packages/capability-runtime/test/policy.test.ts`
  - `packages/capability-runtime/test/executor.test.ts`
  - `packages/capability-runtime/test/tool-call.test.ts`
  - `packages/capability-runtime/test/result.test.ts`
  - `packages/capability-runtime/test/artifact-promotion.test.ts`
  - `packages/capability-runtime/test/integration/local-ts-workspace.test.ts`
  - `packages/capability-runtime/test/integration/service-binding-progress.test.ts`
  - `packages/capability-runtime/test/integration/command-surface-smoke.test.ts`
- **本 Phase 修改文件**：
  - `packages/capability-runtime/README.md`
  - `packages/capability-runtime/src/index.ts`
- **具体功能预期**：
  1. v1 命令面以 just-bash 完整可迁移映射面为目标，但先用 allowlist 落地无风险命令；如 `pwd/ls/cat/write/rg/curl/ts-exec` 之外，`mkdir/mv/cp/rm` 等 filesystem-like 命令也必须按 namespace/backend 真实语义逐步纳入，而不是永远停留在“最小命令集”。
  2. `rg` 明确采用 TS namespace scan 或 service-binding search worker 的降级路径，而非承诺真实 ripgrep 二进制；支持 flag 子集、性能边界与自动切换条件必须文档化。
  3. virtual git subset 至少预留 `status/diff` seam，使 LLM 的版本工作流先验有落点但不制造完整 git 幻觉。
  4. `tar/gzip` 等明显 OOM-risk 命令在 v1 明确列入禁止清单，并要求 README 与 unsupported/deferred tables 写出原因与后续回退方向。
- **具体测试安排**：
  - **单测**：命令映射、schema / planner / result，以及 against `context/just-bash` 的差分 fixture
  - **集成测试**：fake workspace、fake artifact seam、fake service-binding worker
  - **回归测试**：拒绝写危险路径、拒绝不支持命令、progress/cancel 正确收尾
  - **手动验证**：README 提供最小 `plan -> execute -> consume events` 示例
- **收口标准**：
  - 仓内 fake bash 实现与 capability 映射关系已稳定，不直接依赖外部 just-bash 产物
  - allowlist 与 OOM-risk / deferred 两张表都已建立，并与 just-bash 注册表差分状态保持同步
  - v1 命令面足以支撑 session skeleton 验证，并为后续继续补齐 just-bash 映射面留下清晰路径
  - 不支持项、OOM-risk 禁止项与 `rg` 降级行为在 README 中写明
  - 下游可直接 import registry / planner / executor / capability pack
- **本 Phase 风险提醒**：
  - 若 smoke tests 只覆盖 happy path，后续 hooks/session 对接一定返工
  - 若 TS execution 过度开放，将直接放大宿主与安全风险

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1

- **影响范围**：`Phase 2 / Phase 5`
- **为什么必须确认**：命令迁移范围与 allowlist / OOM-risk 划分直接决定 fake bash 的暴露面、测试范围与 prompt 约束。
- **当前建议 / 倾向**：`v1 以 just-bash 完整可迁移命令面为目标，但采用 allowlist / OOM-risk / deferred 分阶段推进；无风险命令优先实现`
- **Q**：`v1 是否确认以 just-bash 完整可迁移命令面为目标，同时维护允许清单与 OOM 风险清单，并优先实现无风险命令？`
- **A**：v1 完整实现 just-bash 的移植工作，支持 just-bash 提供的全部映射面。但我们必须认识到 worker v8-isolate 的限制：任何存在明显 OOM 风险的命令都必须有额外风险提示与回退策略。请维护两张表：允许的清单，以及 OOM 风险清单。优先实现无风险的允许命令；像 `tar` 这类明显有 OOM 风险的命令，v1 阶段明确禁止。filesystem-like 命令（如 `mkdir`、`mv`）必须对齐真实 mount/backend 语义，而不是做 shell 幻觉。

#### Q2

- **影响范围**：`Phase 3 / Phase 5`
- **为什么必须确认**：它决定是否需要在 v1 同时打开 browser-rendering 这类更重 execution target。
- **当前建议 / 倾向**：`v1 只稳定 local-ts 与 service-binding，browser-rendering 只预留 target 名称与接口槽位`
- **Q**：`v1 是否确认只稳定 local-ts 与 service-binding 两类 target，而不同时实现 browser-rendering 命令面？`
- **A**：v1 中甚至不需要这些功能，但 v1 中一定要做好接口， 并测试接口， browser-rendering 可以说尽力而为，不是为了实现功能，而是把这些实践作为非常简单，非常可靠的测试对象，用于检查我们的service binding 与内部 bash 命令的耦合，并验证我们的 nacp 协议通讯是否正常。

#### Q3

- **影响范围**：`Phase 4 / Phase 5`
- **为什么必须确认**：它决定大 capability 结果是默认 promotion，还是允许更大范围的 transcript inline。
- **当前建议 / 倾向**：`一旦结果超出阈值，默认走 artifact promotion seam，而不是继续强行内联`
- **Q**：`v1 是否确认 capability 大结果默认提升为 artifact/ref，而不是继续追求 transcript inline？`
- **A**：超出阈值，或者在注册表范围内的 mime_type 文件类型，可以直接提升。必须要随时注意避免 OOM 错误。

### 6.2 问题整理建议

- 当前最关键的是 **Q1**，它会直接改变命令面与测试面。
- `Q2` 若不拍板，execution target 会提前膨胀。
- `Q3` 必须与 `workspace-context-artifacts` 包一起定稿，避免两边各自定义 promotion 规则。

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| `@nano-agent/nacp-core` tool-call reality | service-binding target 不能发明新 tool 协议 | high | 直接对齐 `messages/tool.ts` 与 `transport/types.ts` |
| `@nano-agent/nacp-session` event catalog | capability runtime 不应自己定义 client-visible kind | medium | 只输出内部 capability events，交给 kernel/session mapping |
| `Workspace / Context / Artifacts` 尚未实现 | local-ts target 与 artifact promotion 依赖 workspace contract | high | 先冻结 seam，并以 fake workspace 测试替代 |
| fake bash 心智容易失控 | just-bash 自带命令面很宽，且用户已要求仓内重写 | high | 以分层迁移 + 差分测试吸收其可迁移面，unsupported 显式拒绝 |

### 7.2 约束与前提

- **技术前提**：Cloudflare Workers / Durable Objects / TypeScript / 单线程 V8 isolate / 无真实宿主进程
- **运行时前提**：single-active-turn、caller-managed session health、fake bash 是 compatibility surface、service-binding 可作为远端能力执行 seam；后续 deployable Worker 会同时暴露 WebSocket-first 与 HTTP fallback ingress，但 capability contract 不应区分两种入口
- **组织协作前提**：`packages/*` 现由主仓 monorepo 统一跟踪；Capability Runtime 作为 workspace package 供 kernel/hook/llm 复用；最终 deployable Worker / DO 组装层在后续运行时包中完成
- **上线 / 合并前提**：不得重新引入 Linux-first / shell-first 假设；不得突破当前 `nacp-core` / `nacp-session` 已冻结边界；不得把 `context/just-bash` 直接作为 runtime dependency 打进产物

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/capability-runtime-by-GPT.md`
  - `docs/design/workspace-context-artifacts-by-GPT.md`
  - `docs/design/agent-runtime-kernel-by-GPT.md`
- 需要同步更新的说明文档 / README：
  - `packages/capability-runtime/README.md`
  - 根目录 `README.md`（如最小 capability pack 与包名需要回填）
- 需要同步更新的测试说明：
  - `docs/plan-after-nacp.md` 中的 fake capability / scenario runner / service-binding harness 说明

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `pnpm --filter @nano-agent/capability-runtime build`
  - `pnpm --filter @nano-agent/capability-runtime typecheck`
- **单元测试**：
  - registry / planner / fake bash bridge / policy / executor / result normalization
- **集成测试**：
  - fake workspace + local-ts target
  - mock service-binding + progress stream + cancel
- **端到端 / 手动验证**：
  - 手动构造一次 `bash-shaped command -> capability plan -> execute -> capability events`
  - 手动构造一次 `service-binding progress -> cancel -> normalized result`
- **回归测试**：
  - unsupported command、deny rule、timeout、artifact promotion、oversized result
- **文档校验**：
  - README 中明确列出支持/不支持的命令与 execution target

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `@nano-agent/capability-runtime` 能以独立包形式 build、typecheck、test
2. fake bash 与 capability 真相已被清晰分离，registry 成为唯一能力真相源
3. `local-ts` 与 `service-binding` 两类 target 都能在同一 contract 下被调度
4. progress / result / cancel / error / oversized-output 已被统一规范化
5. 仓内 fake bash command surface 已形成稳定基线，足以支撑 nano-agent 第一轮端到端 session skeleton 验证，并继续吸收 just-bash 的可迁移映射面

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | capability runtime 已具备 registry、planner、policy gate、executor、target dispatch、result normalization 与仓内 fake bash command surface |
| 测试 | registry/planner/executor/promotion 与 fake workspace / service-binding 场景均可稳定回归 |
| 文档 | README、公开导出面、支持/不支持清单与 Q/A 同步完成 |
| 风险收敛 | v1 不再被完整 shell / child process / full git 幻觉牵着走，也不再把 fake bash 建立在外部 runtime 依赖之上 |
| 可交付性 | kernel、hooks、future session runtime 可直接 import capability package 并接入 fake/real targets |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待回填`
- **哪些编号的拆分还不够合理**：`待回填`
- **哪些问题本应更早问架构师**：`待回填`
- **哪些测试安排在实际执行中证明不够**：`待回填`
- **模板本身还需要补什么字段**：`待回填`

---

## 10. 结语

> 这份 action-plan 以 **冻结 nano-agent 的受控能力执行边界** 为第一优先级，采用 **先 capability 真相、再仓内 fake bash 重写、后 target dispatch、最后命令层收口** 的推进方式，优先解决 **命令外形与系统真相分离、Worker-native 执行路径建立、治理与 progress 合同统一**，并把 **不做完整 shell、不做真实进程管理、不直接引用 just-bash 运行时** 作为主要约束。整个计划完成后，`Capability Runtime` 应达到 **能够支撑 fake bash、hooks、kernel、workspace 四者稳定接线** 的程度，从而为后续更高级别的 session 验证、browser/service 扩展与 skill runtime 提供稳定基础。
