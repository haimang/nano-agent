# D02 — bash.core 吸收设计(B1)

> 功能簇: `worker-matrix / bash-core / capability-runtime-absorption`
> 讨论日期: `2026-04-23`
> 讨论者: `Claude Opus 4.7 (1M context)`
> 关联调查报告:
> - `docs/plan-worker-matrix.md` §4.2、§5.3(P1.B sub-phase)、§6.1 P1 DoD
> - `docs/design/pre-worker-matrix/W3-absorption-map.md`(B1 归属)
> - `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md`(B1 代表 blueprint)
> - `docs/design/pre-worker-matrix/W3-absorption-pattern.md`
> - `docs/eval/worker-matrix/bash-core/index.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

W4 已完成 `workers/bash-core/` deploy-shaped shell + dry-run validation,但 `workers/bash-core/src/index.ts` 仍是 version-probe。真实能力面仍在 `@nano-agent/capability-runtime@0.1.0`。本设计负责把 B1(整个 capability-runtime package)一次性吸收进 `workers/bash-core/src/`,保留 **fake-bash 外形 + typed capability runtime 内核 + honest-partial 纪律** 不漂移。

- **项目定位回顾**:`bash.core` 是 **governed fake-bash execution engine**,不是 Linux shell,也不是 full just-bash;首波 remote seam 是 `CAPABILITY_WORKER` service-binding。
- **本次讨论的前置共识**:
  - B1 是 P1.B 的完整单元(Q1c:B1 作为一次 PR,不再拆)
  - capability-runtime 实测 `dependencies: {}`(零跨包 deps),代表性来自 semantic coupling + ~9473 LOC(W3 reality pass)
  - 真实循环引用样本在 `workspace-context-artifacts` split,不在 B1
  - B1 吸收完成后,`workers/bash-core` 需要 real preview deploy(per GPT R1 / P2.E0 prerequisite)
- **显式排除的讨论范围**:
  - `BASH_CORE` service binding 在 agent-core 侧的激活(属 D07)
  - default composition 里把 `capability` handle 接通(D06)
  - bash 成熟度扩面(browser / python / sqlite / mutating git / high-volume curl 仍 out)
  - 21-command registry 扩展

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**:`bash.core capability-runtime absorption (B1)`
- **一句话定义**:把 `packages/capability-runtime/src/**` 与 `test/**` 按 W3 代表 blueprint 搬进 `workers/bash-core/src/` 与 `workers/bash-core/test/`,让 `workers/bash-core` 从 version-probe shell 升级成 governed fake-bash capability worker,并完成 real preview deploy 作为 P2.E0 硬前置。
- **边界描述**:
  - **包含**:planner / registry / policy / permission / executor / tool-call bridge / fake-bash bridge / capability handlers(filesystem/search/text-processing/network/exec/vcs/workspace-truth)/ execution targets(local-ts/service-binding/browser-rendering 保持 not-connected 态)
  - **不包含**:任何新 verb / 成熟度扩面 / 外部 consumer 切换 / agent-core 侧 service binding 激活 / bash-core 以外的吸收
- **关键术语对齐**:

| 术语 | 定义 | 备注 |
|------|------|------|
| B1 | capability-runtime 全包吸收 | W3 map;单一 absorption unit |
| governed subset | 21 commands 带 `policy: allow/ask/deny` + `executionTarget: local-ts/service-binding/browser-rendering` | 纪律不漂移 |
| no-silent-success | 任何 unsupported / narrow-violation 走 structured error | fake-bash bridge 纪律 |
| honest-partial | mkdir / git diff\|log / ts-exec 明确 partial | 不 paper over |
| real preview deploy | `pnpm --filter workers/bash-core run deploy:preview` 成功 + `curl` 返回合法 JSON | P2.E0 硬前置(per GPT R1) |
| `CAPABILITY_WORKER` | agent-core wrangler 中的 service binding name | D07 激活 |

### 1.2 参考调查报告

- `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md` — 本设计执行基线
- `docs/design/pre-worker-matrix/W3-absorption-pattern.md` §5 Pattern 4 — "direct import 少 ≠ 吸收简单"
- `docs/eval/worker-matrix/bash-core/index.md` §3 6 判断表
- `docs/issue/pre-worker-matrix/W4-closure.md` §5 bash-core dry-run 真相
- `packages/capability-runtime/README.md:1-151` — 21-command 治理真相

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **架构角色**:把 fake-bash execution engine 从 package 形态升级到 worker 形态,成为首波唯一 battle-test 的 cross-worker remote execution seam
- **服务于**:D07(agent↔bash activation)、D06(default composition 的 capability handle)、未来所有 bash tool consumer
- **依赖**:W0 shipped `@haimang/nacp-core` 的 `tool.call.*` body schemas、W4 已存在的 `workers/bash-core/` shell、W3 B1 代表 blueprint、`packages/capability-runtime` 当前 runtime + tests
- **被谁依赖**:D07(agent-core 的 `BASH_CORE` binding 需要 bash-core 先 live)、D09(deprecation 触发)、D08(cutover 改 `workers/bash-core/package.json`)

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|----------|----------|------|
| `agent.core` absorption(D01)| 兄弟并行 | 弱 | P1.A / P1.B 各自 PR 独立 |
| `agent↔bash` activation(D07)| 下游 | 强 | **D07 的 P2.E0 硬前置就是本设计 F6 real preview deploy** |
| default composition(D06)| 下游 | 强 | capability handle 来源 = bash-core 侧 tool-call bridge |
| `filesystem.core` absorption(D04)| 同周期潜在耦合 | 中 | bash 的 workspace handlers 当前消费 `workspace-context-artifacts`;D04 后 workspace truth owner 改变,bash 侧 import 需在共存期保持旧路径,D04 merge 后再切 |
| `context.core` absorption(D03)| 无直接耦合 | 弱 | 首波 bash → context 无 worker 级 wire(交互矩阵 §2 defer)|
| Tier B deprecation(D09)| 下游 | 弱 | capability-runtime 吸收稳定后打 DEPRECATED |

### 2.3 一句话定位陈述

> "在 nano-agent 里,`bash.core capability-runtime absorption` 是 **worker-matrix P1.B 的单一 PR 交付物**,负责 **把 capability-runtime 整包搬进 workers/bash-core/src/,保留 governed subset + no-silent-success + honest-partial 三项纪律,并完成 real preview deploy 作为 D07 / P2.E0 硬前置**,对上游(worker-matrix charter)提供 **first-wave 唯一 battle-tested 的 cross-worker remote seam**,对下游(D07 / D06)要求 **直接消费一个已 live 的 bash-core preview URL**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点

| 被砍项 | 来源 | 砍的理由 | 未来是否回补 |
|--------|------|----------|--------------|
| 吸收时顺手引入 python3 / sqlite3 target | "反正都在搬" | 违反 §0 边界 + charter O6 | 否(需独立 RFC)|
| 吸收时解除 `curl` low-volume budget | "吸收干脆清理限制" | governance 纪律 | 否(需 owner gate)|
| 吸收时把 fake-bash bridge 与 tool-call bridge 合并 | 减少文件数 | W3 pattern spec §11 "blueprint only lands";byte-identical | 否 |
| 吸收时拆 B1 为 B1a/B1b 多 PR | 细粒度 | Q1c:B1 是完整独立单元,一次 PR | 否 |
| 提前实装 `browser-rendering` target live | 顺带完成 | charter O6 明确 not-connected | 否 |
| 搬家同时在 bash-core 侧新建 HTTP 路由接 `tool.call.*` | 自造 ingress | bash.core 不拥有 `session.*` wire;ingress 必须经 `CAPABILITY_WORKER` service binding | 否 |

### 3.2 接口保留点

| 扩展点 | 表现形式 | 第一版行为 | 未来演进 |
|--------|----------|------------|----------|
| `ServiceBindingTarget` | `targets/service-binding.ts` | 保留现有 shape;D07 激活时作 transport | 后续可拆 remote / local 策略为 policy-driven |
| `executionTarget: browser-rendering` | command registry 字段 | 保持 not-connected | 需要时单独 target RFC |
| `policy: allow/ask/deny` | `policy.ts` | 不改 | 新 policy 模式需独立 charter |
| `FakeBashBridge` | `fake-bash/bridge.ts` | 不改 surface | — |
| 新增 verb 的扩展点 | `commands.ts` 的 registry | 不扩 | 需独立 RFC |

### 3.3 完全解耦点

- **解耦对象**:`workers/bash-core/src/` 与 `workers/agent-core/src/`
- **解耦原因**:B1 PR 与 D01 A1-A5 PR 互不共享文件;Q1(c)落地要求 P1.A / P1.B 两组 PR 独立
- **依赖边界**:仅在 `wire vocabulary (nacp-core::tool.call.*)` 层共享;源码层无 cross-import

### 3.4 聚合点

- **聚合对象**:`workers/bash-core/src/` 作为 capability runtime 唯一物理归属
- **聚合形式**:严格按 W3 blueprint §3 目标目录(`core/ fake-bash/ capabilities/ targets/`);不另立 `/lib/` / `/utils/` 散落目录
- **为什么不能分散**:command registry 的 completeness 决定治理纪律;分散会让新 verb 的审计路径破损

---

## 4. 三个代表实现对比

> 本设计是内部 runtime 搬家,改为与 **三份内部 precedent** 对比。

### 4.1 W0 1.3→1.4 consolidation

- **实现概要**:W0 把 wire vocabulary 搬入 nacp-core,runtime 留 package
- **亮点**:wire/runtime 分层干净
- **值得借鉴**:本设计 B1 对 `tool.call.*` 的 wire 依赖继续 import `@haimang/nacp-core`,不回搬
- **不照抄的地方**:W0 是 additive minor bump,本设计不 bump;B1 整体搬(runtime + tests),不是抽 wire

### 4.2 W4 workers scaffolding

- **实现概要**:W4 建立 `workers/bash-core/` shell + wrangler + dry-run
- **亮点**:shell 结构 4 workers 一致
- **值得借鉴**:本设计在 W4 shell 内 copy-fill;wrangler.jsonc 不漂移,除非 service name 变更
- **不照抄的地方**:W4 shell 没有 outgoing bindings;本设计结束后 bash-core 仍 **不** 主动调 `agent.core`;agent → bash 方向由 D07 激活

### 4.3 A1 host shell 搬家(D01 F1)

- **实现概要**:D01 F1 把 session-do-runtime 搬进 workers/agent-core/
- **亮点**:host shell sub-PR 首发,保留共存期
- **值得借鉴**:byte-identical / import 改写 / tests 迁移方法论同构
- **不照抄的地方**:D01 是 sub-PR 序列;D02 是单一 PR(B1 无内部拆分)

### 4.4 横向对比速查表

| 维度 | W0 consolidation | W4 scaffolding | D01 A1 | **D02 B1(本设计)** |
|------|-----------------|----------------|--------|---------------------|
| PR 数 | 一组(多 consumer 同步)| 一次(4 shells)| sub-PR 序列(5-7)| **1 次 PR** |
| 共存期 | wire/runtime 分层 | n/a | ~3 个月 | **~3 个月** |
| 是否改 wire | 否 | 否 | 否 | **否** |
| preview deploy 硬要求 | 否 | 1 个(agent-core)| 后续 D06/D07 | **本设计硬要求 F6** |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope

- **[S1]** `packages/capability-runtime/src/**` 按 W3 blueprint §3 目标目录结构搬进 `workers/bash-core/src/`
- **[S2]** `packages/capability-runtime/test/**` 按 W3 blueprint §4 迁到 `workers/bash-core/test/`
- **[S3]** `workers/bash-core/src/index.ts` 从 version-probe 升级为 capability runtime entry(暴露 `tool.call.*` 的 dispatcher;service-binding seam 可接入)
- **[S4]** `workers/bash-core/package.json` 增加 `devDependencies` 中原 capability-runtime 所需 `zod` / `vitest` / `typescript`(`dependencies: {}` 保持)
- **[S5]** `workers/bash-core/wrangler.jsonc` 的 `name: nano-agent-bash-core` 维持不变;不激活 outgoing bindings(无 D07 前提)
- **[S6]** **real preview deploy**:`pnpm --filter workers/bash-core run deploy:preview` 成功;preview URL 活 + `curl` 返回合法 bash-core version-probe JSON(注明 absorbed runtime 已 live)— **这是 P2.E0 硬前置(per GPT R1)**
- **[S7]** W3 pattern spec "LOC→时长系数" 的 B1 实测数据补入(与 D01 F8 合并回填;本设计在 PR 内附带 patch)

### 5.2 Out-of-Scope

- **[O1]** agent-core 侧 `BASH_CORE` binding 激活(D07)
- **[O2]** default composition 的 `capability` handle 真实装配(D06)
- **[O3]** 21-command registry 扩展 / 新 verb
- **[O4]** 成熟度扩面(browser / python3 / sqlite3 / mutating git / ts-exec not-connected 升级 / high-volume curl)
- **[O5]** workspace substrate 来源切换(保持 `packages/workspace-context-artifacts`,等 D04 后再处理共存期 import)
- **[O6]** capability-runtime package DEPRECATED banner(D09)
- **[O7]** 物理删除 `packages/capability-runtime/`
- **[O8]** cross-worker 远端 RPC family(W1 RFC 保持 direction-only)

### 5.3 边界清单

| 项目 | 判定 | 理由 |
|------|------|------|
| B1 PR 作者借搬家清理 `mkdir` partial 表述 | `out-of-scope` | honest-partial 纪律不变;文字性质的 README 升级不属 B1 |
| B1 PR 同时做 wrangler.jsonc 的 service name 改名 | `out-of-scope` | W4 已固化 name |
| B1 PR 搬家后把 `packages/capability-runtime/` DEPRECATE | `out-of-scope` | 归 D09;per Q6c per-worker absorb-stable |
| B1 PR 内部再拆 sub-PR(按 handler 搬)| `out-of-scope` | Q1c:B1 是一次 PR |
| `ServiceBindingTarget` 在 B1 PR 内做 live remote routing 测试 | `partial in-scope` | 允许用 mock remote 做 package-local test;真实 remote 由 D07 做 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**:我们选择 **整包一次 PR** 而不是 **按 handler / target 拆 sub-PR**
   - **为什么**:B1 内部 module 耦合度高;fake-bash bridge 与 tool-call bridge 与 policy 协同演化;一次搬避免中间态 bash-core 部分吸收的 "tool call 不完整" 红网
   - **代价**:PR 大(~9473 LOC + test)
   - **未来重评条件**:若执行中某个 handler 发现单独搬可以过绿,再临时拆

2. **取舍 2**:我们选择 **B1 完成后立刻 real preview deploy** 而不是 **留到 D07 一并做**
   - **为什么**:GPT R1 明确指出这是 P2 硬前置;提前做可以在 B1 PR 内隔离 wrangler / deploy 风险
   - **代价**:B1 PR 结束前多花 5-10 分钟做 `deploy:preview`;preview URL 资源占用
   - **缓解**:preview env 多 URL 本身无额外成本

3. **取舍 3**:我们选择 **保留 `ServiceBindingTarget` 的 local-ts fallback seam** 而不是 **默认远端后删除 local-ts**
   - **为什么**:Q2(a+local-ts)— local-ts 是单测 / 故障回退 / 开发路径
   - **代价**:runtime 仍有两个 target 实现
   - **缓解**:local-ts 保留在 registry 但不作 default;test 保留 local-ts path 回归

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解 |
|------|----------|------|------|
| B1 吸收后 bash-core build 因 `@haimang/nacp-core` import 解析失败 | `workspace:*` path 在 workers/bash-core 里未正确解析 | deploy 失败 | W4 已证 workers/agent-core 的 workspace:* 可 resolve;B1 PR 必须跑 `pnpm --filter workers/bash-core build && deploy:dry-run` |
| B1 搬家破坏 352 tests | 搬家时 import path / vitest config 偏移 | 回归红 | W3 pattern spec §10 Pattern 9;按 handler 逐组运行 `pnpm --filter workers/bash-core test -- path/...` |
| B1 搬家时 workspace 依赖漂移(对 `packages/workspace-context-artifacts` 的 in-process 消费)| 共存期解析错 | 运行时红 | `packages/workspace-context-artifacts` 保持原位;bash-core 的 workspace handler import 仍指旧 package 直到 D04 |
| real preview deploy 因 `SESSION_DO` 误配置在 bash-core 里 | 配置漂移 | deploy 失败 | W4 `workers/bash-core/wrangler.jsonc` 已无 DO;B1 PR 不加 DO |
| 共存期 `packages/capability-runtime` 的 consumer 同时使用新旧两份 runtime 导致 behavior drift | 同一请求被两份 runtime 处理不一致 | silent divergence | W3 pattern §6:共存期 bug 先修原包 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己**:bash-core 成为单一 capability runtime 物理归属;新 bug / 新 verb 路径单一
- **对 nano-agent 长期演进**:首波唯一 battle-tested 的 cross-worker remote seam 有真实 landing
- **对 "上下文管理 / Skill / 稳定性" 杠杆**:
  - 稳定性:real preview deploy + 352 tests 全绿在 P2 执行前就 battle-tested
  - Skill:bash.core 作为 capability worker 的独立性,为未来 skill.core 入场(如果 admit)提供对称模板
  - 上下文管理:context.core 后续若需要 tool calling,bash.core 已经是稳定 remote callee

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | src 搬家 | capability-runtime src → workers/bash-core/src/ | ✅ W3 blueprint §3 目标目录结构完整;byte-identical 语义 |
| F2 | test 搬家 | capability-runtime test → workers/bash-core/test/ | ✅ 352 tests 全部迁移;package-local 运行全绿 |
| F3 | index.ts 升级 | workers/bash-core/src/index.ts 从 probe 升为 capability entry | ✅ 暴露可被 `CAPABILITY_WORKER` 命中的 fetch handler;保留 version-probe shape 兼容(至少 status/worker 字段)|
| F4 | package.json 更新 | workers/bash-core/package.json 补 devDependencies | ✅ `pnpm install` 绿;`dependencies` 保持 `{}` |
| F5 | wrangler 验证 | wrangler.jsonc 不漂移 | ✅ `name: nano-agent-bash-core` 不变;无新 DO / service binding |
| F6 | **real preview deploy** | **D07 / P2.E0 硬前置** | ✅ `pnpm --filter workers/bash-core run deploy:preview` 成功;preview URL live + `curl` 返回合法 JSON(含 nacp_core_version + nacp_session_version + absorbed_runtime: true 或等价 flag)|
| F7 | W3 pattern 回填(随 PR) | 补 B1 实测 LOC / 时长 / 流水线命令 | ✅ `W3-absorption-pattern.md` LOC→时长 / 可执行流水线节有 B1 实测数据 |

### 7.2 详细阐述

#### F1: src 搬家

- **输入**:`packages/capability-runtime/src/**`
- **输出**:`workers/bash-core/src/{index.ts, core/, fake-bash/, capabilities/, targets/}`(按 W3 blueprint §3)
- **主要调用者**:F3(index.ts)、F6(deploy runtime)、D07(远端 binding callee)
- **核心逻辑**:
  1. `cp -r packages/capability-runtime/src/* workers/bash-core/src/`(保留原目录)
  2. 按 W3 blueprint §3 目标目录重组(`planner.ts` 等 runtime core 进 `core/`;`fake-bash/` / `capabilities/` / `targets/` 保持原名)
  3. 改 import:相对 import 保持;对 `@haimang/nacp-core` / `@haimang/nacp-session` import 保持(已与发布 scope 对齐);对 `@nano-agent/*` Tier B 保持直到对应 worker 吸收
- **边界情况**:
  - `workspace-truth.ts` 对 `@nano-agent/workspace-context-artifacts` 的 import 保持(等 D04 后再处理共存期切换)
  - `ServiceBindingTarget` 保留完整,可被 D07 接管
- **一句话收口目标**:✅ **`workers/bash-core/src/` 含 `core/ fake-bash/ capabilities/ targets/` 四个子目录;`workers/bash-core/src/index.ts` 暴露完整 public API;byte-identical 语义**

#### F2: test 搬家

- **输入**:`packages/capability-runtime/test/**`
- **输出**:`workers/bash-core/test/`
- **核心逻辑**:
  1. `cp -r packages/capability-runtime/test/* workers/bash-core/test/`
  2. `vitest.config` 若有则一并迁;fixture / mock / helper 一并搬
  3. 确认 `workers/bash-core/package.json` 的 `scripts.test` 为 `vitest run`
- **边界情况**:
  - root cross / contract tests **不迁**
  - integration tests 内的 `workspace-context-artifacts` fixture 保持 package 原路径
- **一句话收口目标**:✅ **`pnpm --filter workers/bash-core test` 352/352 绿**

#### F3: index.ts 升级

- **输入**:F1 搬后的 src/public API aggregator
- **输出**:`workers/bash-core/src/index.ts`(升级版)
- **核心逻辑**:
  - default export fetch handler:
    - `/health` or `GET /` 返回 version-probe + `absorbed_runtime: true` 标志
    - `/tool.call.request` POST endpoint 或 service-binding handler 路由到 `CapabilityRunner.execute`
  - export `CapabilityRunner` / `FakeBashBridge` 等 public API
- **边界情况**:
  - D07 在本阶段后会通过 service binding 调用 bash-core;本 F3 提供 service binding 可命中的 fetch path
  - 兼容 W4 probe JSON shape(不删字段)
- **一句话收口目标**:✅ **`workers/bash-core/src/index.ts` 升级后,`curl <preview-url>/` 返回含 `worker:"bash-core" absorbed_runtime:true nacp_core_version nacp_session_version status:"ok"` JSON**

#### F4: package.json 更新

- **输入**:`packages/capability-runtime/package.json`(当前 devDeps: typescript / vitest / zod)
- **输出**:`workers/bash-core/package.json` 补齐相同 devDeps
- **核心逻辑**:
  - `dependencies` 保持 `{"@haimang/nacp-core": "workspace:*", "@haimang/nacp-session": "workspace:*"}` + 空(capability-runtime 原本就零 runtime dep)
  - `devDependencies` 增加 `typescript / vitest / zod`(按现有版本号)
  - `scripts` 保留 W4 的 `build / test / typecheck / deploy:preview / deploy:dry-run`
- **一句话收口目标**:✅ **`pnpm install` 绿;`pnpm -r run typecheck` 绿;`dependencies` 中 Tier B 无污染**

#### F5: wrangler 验证

- **输入**:W4 `workers/bash-core/wrangler.jsonc`
- **输出**:不漂移
- **核心逻辑**:verify-only;如果 B1 吸收引入了需要 env var 的部分(如 `OWNER_TAG`),仅补 env 不改结构
- **一句话收口目标**:✅ **`wrangler.jsonc` diff 只允许 env var 增量;`name` / `main` / `compatibility_date` 不变**

#### F6: real preview deploy(P2.E0 硬前置)

- **输入**:F1-F5 完成后的 workers/bash-core
- **输出**:live preview URL
- **核心逻辑**:
  1. `pnpm --filter workers/bash-core run build`
  2. `pnpm --filter workers/bash-core run deploy:preview`(Wrangler OAuth 已就绪,W4 验证过)
  3. 记录 preview URL(预期形状 `https://nano-agent-bash-core-preview.haimang.workers.dev`)
  4. `curl -fsSL <preview-url>/` → 验证 F3 响应
  5. 把 URL + Version ID 补进 D02 的附录 / B1 PR body
- **边界情况**:
  - 若 preview deploy 失败(token / env / binding),**B1 PR 不得 merge**;P2 无法启动
  - 成功后 preview URL 持久存在直到 owner 销毁;agent-core 侧 `BASH_CORE` binding 会在 D07 引用这个 service name
- **一句话收口目标**:✅ **`https://nano-agent-bash-core-preview.haimang.workers.dev` live;Version ID 记录于 PR body;D07 可直接消费**

#### F7: W3 pattern spec 回填

- **输入**:B1 PR 执行期间实测 LOC / 搬家命令序列 / 踩坑
- **输出**:`docs/design/pre-worker-matrix/W3-absorption-pattern.md` "LOC→时长经验系数" + "可执行流水线样板" 两节从 placeholder 升级到 B1 实测
- **一句话收口目标**:✅ **pattern spec 两节首批回填有实测数据(与 D01 F8 合并或各自负责)**

### 7.3 非功能性要求

- **性能目标**:preview URL cold start < 500ms(与 W4 agent-core preview 对标)
- **可观测性要求**:F3 index.ts 必须输出含 `phase: "worker-matrix-P1.B-absorbed"` 或等价字段,让 D07 验证 deploy 是 B1 之后的版本
- **稳定性要求**:B7 LIVE 不直接涉及 bash-core,但 package-local 352 tests 必须全绿
- **测试覆盖要求**:`workers/bash-core/test/**` 覆盖 src/ 所有子目录

---

## 8. 可借鉴的代码位置清单

### 8.1 capability-runtime 内部

| 位置 | 内容 | 借鉴点 |
|------|------|--------|
| `packages/capability-runtime/src/fake-bash/commands.ts:16-315` | 21-command registry | F1 整体搬;不改 registry |
| `packages/capability-runtime/src/fake-bash/bridge.ts:82-167` | no-silent-success bridge | F1 搬 |
| `packages/capability-runtime/src/tool-call.ts:20-160` | tool.call.* body bridge | F1 搬;F3 在 index.ts 暴露入口 |
| `packages/capability-runtime/src/executor.ts:121-320` | requestId / cancel / timeout / progress | F1 搬 |
| `packages/capability-runtime/src/targets/service-binding.ts:90-215` | remote transport target | F1 搬;D07 激活时被消费 |
| `packages/capability-runtime/src/policy.ts:17-48` | allow/ask/deny policy | F1 搬 |
| `packages/capability-runtime/src/capabilities/{filesystem,search,text-processing,network,exec,vcs,workspace-truth}.ts` | 21 命令 handlers | F1 搬 |
| `packages/capability-runtime/test/integration/service-binding-*` | service binding target tests | F2 搬(package-local)|

### 8.2 W3 blueprint 对应节

| 位置 | 内容 | 借鉴点 |
|------|------|--------|
| `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md:57-99` | 建议目标目录 + 文件映射 | F1 直接消费 |
| `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md:148-160` | optional dry-run 如何使用 | F6 借鉴 |

### 8.3 必须避开的 "反例"

| 位置 | 问题 | 避开理由 |
|------|------|----------|
| 在 workers/bash-core 内新建 `src/session-edge/` 或 WS ingress | bash.core 不拥有 `session.*` wire | charter §4.2 禁止 |
| 把 `tool.call.cancel` 改成 body-shape shortcut | 破坏 B7 LIVE 间接契约 | 否 |
| 吸收时把 `workspace-context-artifacts` 某函数内联到 bash-core | 跨 worker 边界污染 | D04 会处理 |
| 在 `targets/service-binding.ts` 中硬编码 `BASH_CORE` service name | 越界 D07 | D07 统一在 agent-core 侧配置 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

B1 是 P1.B 的完整单一 PR 交付物:把 `packages/capability-runtime/` 整包(src ~2400 + test ~4000+ + 原 package metadata)按 W3 代表 blueprint 搬进 `workers/bash-core/src/` 与 `workers/bash-core/test/`,并完成 real preview deploy 作为 P2 / D07 硬前置。预期代码量:合计约 9473 LOC 搬迁 + 小量 package.json / wrangler env 增量。共存期 ~3 个月,期间 `packages/capability-runtime/` 保持原位但进入 "bug 先修原包" 纪律。单 PR 规模大但机械;风险主要在 F6 preview deploy 成功性。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | **5** | bash.core 是首波唯一真实 cross-worker remote loop;物理 ownership 必须先落 |
| 第一版实现的性价比 | **4** | 一次 PR 搬完,机械;preview deploy 边际成本低 |
| 对 "上下文管理 / Skill / 稳定性" 杠杆 | **4** | 稳定性面 battle-tested;skill 未来若入场可对称模板 |
| 对开发者自己的日用友好度 | **4** | bash-core 成为单一 runtime 归属后,命令开发 / 调试路径单一 |
| 风险可控程度 | **4** | 352 tests 作回归网;preview deploy 可回滚 |
| **综合价值** | **4.2** | P1.B 核心;D07 / P2.E0 的硬前提 |

### 9.3 下一步行动

- [ ] **决策确认**:owner approve 本设计;B1 PR 作者 claim
- [ ] **关联 Issue / PR**:B1 PR 开启时同步本文档状态到 `reviewed`
- [ ] **待深入调查的子问题**:
  - `ServiceBindingTarget` 中对 remote service name 的默认值是否需要在 B1 搬家时保持 `CAPABILITY_WORKER` 字符串,供 D07 引用?
  - `targets/browser-rendering.ts` 在 B1 吸收后是否要立刻标 `// intentionally not-connected`?
- [ ] **需要更新的其他设计文档**:
  - `docs/design/pre-worker-matrix/W3-absorption-pattern.md`(F7 回填)
  - `docs/eval/worker-matrix/bash-core/index.md`(B1 merge 后 §3 从 "runtime 在 capability-runtime 包内" 改为 "workers/bash-core/src/")

---

## 附录

### A. 讨论记录摘要

- **分歧 1**:real preview deploy 放在 B1 PR 内还是拆到 D07 PR?
  - **倾向 A(D07 内)**:deploy 与 binding 激活一起
  - **倾向 B(B1 内)**:GPT R1 要求 P2 硬前置;提前 deploy 可隔离风险
  - **最终共识**:B(B1 PR 内),per GPT R1

- **分歧 2**:`ServiceBindingTarget` 在 B1 搬家后是否需要 live 调通远端?
  - **倾向 A(需要)**:验证闭环
  - **倾向 B(mock 即可)**:真实远端由 D07 接入 agent-core 时才验证
  - **最终共识**:B;D07 负责 live 远端回环

### B. 开放问题清单

- [ ] **Q1**:B1 PR 搬家完成后,`packages/capability-runtime/package.json` version 是否要 bump?(建议:否,统一在 D09 做)
- [ ] **Q2**:`workers/bash-core/src/index.ts` 的 `fetch` handler 是否要直接支持 HTTP `POST /tool.call.request`,或者仅通过 service binding `fetch(request)` 接入?(建议:仅 service binding,不开 HTTP ingress)
- [ ] **Q3**:是否在 B1 PR 内给 `workers/bash-core/` 加一个 `README.md` 升级(从 version-probe README 到 absorbed runtime README)?(建议:是,PR 内一并做)

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-23 | Claude Opus 4.7 | 初稿;基于 charter + W3 blueprint + GPT R1 编制 |
