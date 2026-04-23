# D01 — agent.core 吸收设计(A1-A5)

> 功能簇: `worker-matrix / agent-core / host-runtime-absorption`
> 讨论日期: `2026-04-23`
> 讨论者: `Claude Opus 4.7 (1M context)`
> 关联调查报告:
> - `docs/plan-worker-matrix.md` §4.1、§5.3(P1.A sub-phase)、§6.1 P1 DoD
> - `docs/design/pre-worker-matrix/W3-absorption-map.md`(A1-A5 归属表)
> - `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md`(A1 代表 blueprint)
> - `docs/design/pre-worker-matrix/W3-absorption-pattern.md`
> - `docs/design/pre-worker-matrix/TEMPLATE-absorption-blueprint.md`
> - `docs/eval/worker-matrix/agent-core/index.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

pre-worker-matrix W4 已经让 `workers/agent-core/` 物理存在,并完成 real preview deploy(`https://nano-agent-agent-core-preview.haimang.workers.dev`)。但 `workers/agent-core/src/index.ts` 仍是 version-probe shell;真实 host runtime 仍在 `@nano-agent/session-do-runtime@0.3.0`。本设计负责把 A1-A5 这 5 个 absorption units 按顺序吸收进 `workers/agent-core/src/`,让该目录成为 agent host runtime 的真实 owner。

- **项目定位回顾**:nano-agent 的 `agent.core` 是 **host worker**,不是 binding slot;它只在 session edge 上产生 `session.stream.event`,不承担 user memory / intent routing / cross-session state。
- **本次讨论的前置共识**:
  - A1-A5 吸收范围按 W3 map 固化:session-do-runtime host shell / agent-runtime-kernel / llm-wrapper / hooks runtime residual / eval-observability runtime seam
  - Tier B 内部 scope 不改(`@nano-agent/*`);NACP scope 是 `@haimang/*`
  - A1 blueprint 已写(`W3-absorption-blueprint-session-do-runtime.md` optional 代表)
  - A2-A5 没有 detailed blueprint,按 W3 `TEMPLATE-absorption-blueprint.md` 就地 copy-fill
  - `initial_context` host consumer 不在本设计内(另有 D05);`createDefaultCompositionFactory` / `makeRemoteBindingsFactory` 升级不在本设计内(另有 D06);`agent↔bash` binding 活化不在本设计内(另有 D07)
- **显式排除的讨论范围**:
  - `skill.core`(保持 reserved + deferred)
  - per-user DO / cross-session store(架构上反对)
  - 将 `NanoSessionDO` 拆成多 DO 类
  - W1 RFC × 3 升级为 shipped runtime

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**:`agent.core host runtime absorption (A1-A5)`
- **一句话定义**:把 A1-A5 共 5 个 absorption units 的真实 runtime 从 `packages/{session-do-runtime,agent-runtime-kernel,llm-wrapper,hooks,eval-observability}/` 搬进 `workers/agent-core/src/`,并让 `workers/agent-core/src/index.ts` 从 version-probe shell 升级为 live agent host runtime owner。
- **边界描述**:
  - **包含**:A1 host shell(DO class、Worker entry、controllers、composition glue、remote bindings)/ A2 kernel reducer & scheduler / A3 LLM provider & stream adapter / A4 hooks runtime dispatch / A5 eval sink & inspector seam 的 runtime residual 搬家与 import 改写
  - **不包含**:default composition 真实装配(D06)、initial_context consumer 接线(D05)、tool.call 远端激活(D07)、cross-worker service binding 活化、其他 worker 的 absorption
- **关键术语对齐**:

| 术语 | 定义 | 备注 |
|------|------|------|
| A1 | `session-do-runtime` host shell | Worker entry + DO host + controllers + composition;W3 optional 代表 blueprint 存在 |
| A2 | `agent-runtime-kernel` | single-active-turn reducer / scheduler / wait-resume / stream event mapping |
| A3 | `llm-wrapper` | canonical request、provider registry、ChatCompletions adapter、stream normalize |
| A4 | `hooks` runtime residual | matcher / dispatcher / service-binding hook runtime / outcome folding(W0 已抽 wire vocabulary,runtime 留在 packages/hooks)|
| A5 | `eval-observability` runtime residual | trace sink / inspector / timeline read / verdict aggregation 的 runtime use-site(W0 已抽 vocabulary) |
| host shell | Worker 级 fetch 路由 + DO 级业务逻辑 | 薄 Worker + 厚 DO,`idFromName(sessionId)` 路由 |
| runtime residual | 在 W0 吸收 wire vocabulary 之后,原 package 剩下的 runtime 实现部分 | 包含 class / orchestrator / adapter |

### 1.2 参考调查报告

- `docs/design/pre-worker-matrix/W3-absorption-map.md` §4 A1-A5 落点说明
- `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md` — A1 代表性 blueprint
- `docs/design/pre-worker-matrix/W3-absorption-pattern.md` §2-§11 迁移纪律
- `docs/eval/worker-matrix/agent-core/index.md` §3-§4 冻结判断
- `docs/issue/pre-worker-matrix/W4-closure.md` §2-§5 shell reality

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **架构角色**:把现有 host substrate 从 package 形态升级到 worker 形态 —— **不是新建能力,是搬家**
- **服务于**:worker-matrix P1.A sub-phase 执行者、P2 装配者、后续所有 agent-core consumer
- **依赖**:W0 已 shipped `@haimang/nacp-core@1.4.0` / `@haimang/nacp-session@1.3.0`、W4 已物理存在的 `workers/agent-core/` shell、W3 pattern spec、W3 A1 blueprint、`packages/session-do-runtime` 等 5 个 package 的现有 src/test
- **被谁依赖**:D05(initial_context consumer 需要 host 落位)、D06(default composition 需要在 host shell 里升级)、D07(agent↔bash 激活需要 wrangler service binding 与 host entry 配合)

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|----------|----------|------|
| `bash.core` absorption(D02)| 兄弟并行 | 弱 | P1 两组 PR 独立,不共享文件;但 `tool.call.*` wire 须由 W0 `@haimang/nacp-core` 统一持有 |
| `context.core` absorption(D03)| 下游依赖 | 中 | context.core 吸收后,agent.core 内 workspace/context composition 的 owner 应改为 workers/context-core(staged cut-over)|
| `filesystem.core` absorption(D04)| 下游依赖 | 中 | D1 filesystem substrate 吸收后,agent.core composition 内 workspace 来源变化 |
| `initial_context` consumer(D05)| 同周期 | 强 | D05 需要 host 的 `dispatchAdmissibleFrame` session.start 分支有落脚点 — 本设计提供落脚点 |
| default composition(D06)| 同周期 | 强 | D06 在 `composition.ts` 里升级 kernel/llm/capability/workspace/hooks/eval,运行位置由本设计提供 |
| `agent↔bash` activation(D07)| 同周期 | 强 | D07 需要 `workers/agent-core/wrangler.jsonc` 的 `BASH_CORE` slot,本设计提供 wrangler 结构不漂移 |
| published-path cutover(D08)| 下游 | 弱 | cutover 改 `workers/agent-core/package.json` 依赖版本,本设计保证 import path 已对齐 `@haimang/*` |
| Tier B deprecation(D09)| 下游 | 弱 | 本设计完成后,5 个被吸收 package 进入 deprecation 候选 |

### 2.3 一句话定位陈述

> "在 nano-agent 里,`agent.core host runtime absorption` 是 **worker-matrix P1.A 的核心交付物**,负责 **把 session-do-runtime + agent-runtime-kernel + llm-wrapper + hooks runtime + eval-observability runtime 的所有权从 `packages/` 迁到 `workers/agent-core/src/`,让 host runtime 从 shell 升级为 live owner**,对上游(worker-matrix charter)提供 **host runtime 物理归属** 的真实兑现,对下游(D05/D06/D07)要求 **在同一个 workers/agent-core/src/ 内完成后续装配**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点(哪里可以砍)

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| A2-A5 的 detailed blueprint 预先撰写 | W3 原 v0.1 设想 | W3 已收窄成 map + 2-3 代表;本设计直接按 TEMPLATE 就地 copy-fill | 若执行中某 unit 发现 special-case 再补 |
| 搬家时顺手重构 API | 大规模 monorepo migration | 违反 W3 pattern spec §11 "blueprint only lands, 不 refactor";`byte-identical semantics` 纪律 | 待 worker-matrix 结束、live loop 稳定后另开 refactor charter |
| 把 A5 eval sink 搬到 workers/agent-core 就升级 inspector default ON | inspector facade 全默认 | 违反 `context.core` thin substrate 纪律(inspector facade 在 D03 说明 opt-in)| 否 |
| A1 吸收同时激活 service bindings | W4 closure §2.3 | service bindings 活化在 D07;本设计只搬 shell 代码 | 否(属 D07)|
| 把 5 个 package 的 tests 一次性全部搬完 | "整块搬" | A2-A5 tests 粒度大,一次搬会掩盖回归;按 sub-PR 搬 | 否 |

### 3.2 接口保留点(哪里要留扩展空间)

| 扩展点 | 表现形式 | 第一版行为 | 未来演进 |
|--------|----------|------------|----------|
| A1 wrangler.jsonc `BASH_CORE / CONTEXT_CORE / FILESYSTEM_CORE` service slots | 注释态保留(已由 W4 提供) | 仍保留注释态直到 D07 激活 | D07 激活 `BASH_CORE`;D03/D04 按 posture 决定是否激活另外两个 |
| A5 inspector facade opt-in env gate | `ENABLE_INSPECTOR` env var + auth check | 默认 OFF | 后续 charter 按需开启 |
| A3 provider registry 扩展点 | `registerProvider(id, adapter)` API | 保留 anthropic / openai 两个 adapter(若存在);不扩 Gemini/local | 新 provider 走独立 RFC |
| A4 hook matcher 可扩展 hook families | 保持 `HOOK_EVENT_CATALOG` 来自 `@haimang/nacp-core`(W0 已吸收 wire-level vocabulary)| 不新增 event | 新增 hook family 走 nacp-core additive minor bump |
| A2 kernel SchedulerPolicy interface | 保留现有 `SchedulerPolicy` TS interface shape | 不改签名 | 后续 scheduler 扩展走独立 PR |

### 3.3 完全解耦点(哪里必须独立)

- **解耦对象**:A1 host shell 与 A2-A5 runtime residual
- **解耦原因**:A1 涉及 Worker entry + DO class + wrangler shape;A2-A5 是纯 class/function 搬家。混在一个 PR 会让 wrangler / DO class 变更风险掩盖 runtime 搬家的回归
- **依赖边界**:A1 PR 先落 → A2-A5 在同一个 `workers/agent-core/src/` 结构下分 sub-PR 搬(建议 host → kernel → llm → hooks → eval 顺序)

### 3.4 聚合点(哪里要刻意收敛)

- **聚合对象**:`workers/agent-core/src/index.ts` 的 `default export worker`
- **聚合形式**:单一 Worker fetch handler + `export { NanoSessionDO }` + `export type { AgentCoreEnv }`;不允许二个 entry
- **为什么不能分散**:Cloudflare Worker + DO 模型要求单一 Worker entry;wrangler 只认一个 `main`;任何 `src/worker2.ts` / 并存 entry 都会被 wrangler 拒绝

---

## 4. 三个代表实现对比

> 本节原始模板针对 mini-agent / codex / claude-code 的三方对比。本设计是 **nano-agent 内部 runtime 搬家**,无合适外部对标,改为 **三份 nano-agent 内部 precedent** 对比。

### 4.1 B9 tenancy absorption(nano-agent 自身,2026-02)

- **实现概要**:B9 把 `tenantR2* / tenantKv* / tenantDoStorage*` 从各 Tier B 包搬到 `nacp-core/src/tenancy/`,一次 merge,所有 consumer 改 import。
- **亮点**:
  - subdirectory 聚合干净
  - additive semver(不 breaking)
  - 一次 PR + 所有 consumer 同步迁移
- **值得借鉴**:byte-identical semantics 纪律(本设计继承)
- **不照抄的地方**:B9 目标是 **Tier A(nacp-core)**,本设计目标是 **workers/**;共存期处理方式不同(B9 是 cut-over,本设计是 staged)

### 4.2 W0 nacp-core 1.3→1.4 consolidation(nano-agent 自身,2026-04)

- **实现概要**:W0 把 evidence vocabulary / hooks-catalog / storage-law / cross-seam transport 从 4 个 Tier B 包搬进 `nacp-core` 子目录;原 package 保留 runtime class,只迁 wire vocabulary。
- **亮点**:明确区分 "wire shape"(搬) vs "runtime class"(不搬)
- **值得借鉴**:本设计 A4(hooks runtime residual)和 A5(eval-observability runtime residual)严格继承 W0 的 "runtime 留在原 package 而 wire 已经在 nacp-core" 基线,吸收时不需要处理 wire vocabulary
- **不照抄的地方**:W0 在 `packages/nacp-core/` 内聚合;本设计在 `workers/agent-core/src/` 内聚合

### 4.3 W4 workers scaffolding(nano-agent 自身,2026-04)

- **实现概要**:W4 建立了 `workers/{agent-core,bash-core,context-core,filesystem-core}/` 4 个 deploy-shaped shell + wrangler.jsonc + package.json + real preview deploy(agent-core)+ 3 dry-run(其余)。
- **亮点**:shell 结构统一;`SESSION_DO` slot 已激活;service bindings 保留注释态
- **值得借鉴**:本设计直接在这个 shell 内 copy-fill,不改 shell shape
- **不照抄的地方**:W4 是 deploy-shaped 壳,不吸收业务 runtime;本设计是吸收业务 runtime,但 wrangler.jsonc 不漂移

### 4.4 横向对比速查表

| 维度 | B9 tenancy | W0 1.4 consolidation | W4 scaffolding | 本设计(D01)|
|------|-----------|---------------------|----------------|------------|
| 目的地 | nacp-core/src/tenancy | nacp-core/src/{evidence,hooks-catalog,storage-law,transport} | workers/*/(空 shell)| workers/agent-core/src/ |
| 共存期 | 无(cut-over)| 有(wire 在 nacp-core,runtime 在原 package)| 无(shell 只是 stub)| **有(~3 个月)** |
| 一次 PR vs 多 PR | 一次 | 一组(consumer 同步)| 一组(4 shells 齐)| **sub-PR 序列(A1→A2→A3→A4→A5)** |
| 目标结构变化 | 加 subdirectory | 加 subdirectory + re-export | 加顶级目录 | 吸收 runtime |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope(本设计要做)

- **[S1]** A1 host shell 搬进 `workers/agent-core/src/host/`(含 DO class `NanoSessionDO`、Worker entry、HTTP/WS controllers、composition glue、remote-bindings factory、workspace-runtime bridge、turn-ingress)
- **[S2]** A2 `agent-runtime-kernel` 搬进 `workers/agent-core/src/kernel/`(single-active-turn reducer、scheduler、wait-resume、stream event mapping)
- **[S3]** A3 `llm-wrapper` 搬进 `workers/agent-core/src/llm/`(canonical request、provider registry、ChatCompletions adapter、stream normalize)
- **[S4]** A4 `hooks` runtime residual 搬进 `workers/agent-core/src/hooks/`(matcher / dispatcher / outcome folding);wire vocabulary **不搬**(W0 已在 nacp-core)
- **[S5]** A5 `eval-observability` runtime residual 搬进 `workers/agent-core/src/eval/`(trace sink / inspector / timeline / verdict aggregation);wire vocabulary **不搬**(W0 已在 nacp-core)
- **[S6]** `workers/agent-core/src/index.ts` 从 version-probe 升级为 live host entry(但默认 composition 的 full wiring 在 D06;本设计只保证 entry 形状 + DO class 已是吸收后的真实 DO)
- **[S7]** `workers/agent-core/package.json` 的 `@haimang/nacp-*` 保持 `workspace:*`(per Q5c,cutover 由 D08 独立 PR 做)
- **[S8]** A1-A5 各自的 package-local tests 迁入 `workers/agent-core/test/`;root tests 不迁(W3 pattern §6)
- **[S9]** 首批 absorb PR 之一回填 W3 pattern spec:"LOC→时长经验系数" + "可执行流水线样板"(per charter I13)

### 5.2 Out-of-Scope(本设计不做)

- **[O1]** default composition 升级(D06)
- **[O2]** remote bindings factory 补全 4 nullable(D06)
- **[O3]** `initial_context` host consumer 接线(D05)
- **[O4]** `BASH_CORE / CONTEXT_CORE / FILESYSTEM_CORE` service bindings 激活(D07 for BASH_CORE;D03/D04 各自管理)
- **[O5]** 5 个被吸收 package 的 DEPRECATED banner(D09)
- **[O6]** `workspace:*` → published cutover(D08)
- **[O7]** 5 个被吸收 package 的物理删除(下一阶段)
- **[O8]** 新增任何 wire vocabulary 或 NACP family
- **[O9]** 扩展 21-command / new provider / new hook family
- **[O10]** cross-session store / user-level DO / `skill.core` / inspector default ON

### 5.3 边界清单

| 项目 | 判定 | 理由 |
|------|------|------|
| A2 `agent-runtime-kernel` 的 `SchedulerPolicy` interface 小幅改名 | `out-of-scope` | W3 pattern §11 "blueprint only lands, 不 refactor" |
| A5 `BoundedEvalSink` 搬家时顺手加 metric export | `out-of-scope` | 同上;顺手扩面 = silent scope creep |
| A1 host shell 搬家时把 `workspace-runtime.ts` 一并搬 | `in-scope` | A1 blueprint §2.1 已列该文件;它是 host 与 workspace 的 in-process bridge |
| A1 搬家时把 `NanoSessionDO` 拆成多个 DO 类 | `out-of-scope` | charter §4.1 明确禁止 |
| 搬家同时把 hooks wire vocabulary 从 nacp-core 搬回 workers/agent-core/src/hooks | `out-of-scope` | W0 consolidation 反向 — 禁止 |
| A1 host shell 搬家后,保留 `packages/session-do-runtime/` 文件 | `in-scope` | W3 pattern spec §2 Pattern 1 共存期规则 |
| A2-A5 的 detailed blueprint 预先撰写 | `out-of-scope` | 按 TEMPLATE copy-fill 即可 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**:我们选择 **先搬 A1 host shell,再 A2-A5 sub-PR 序列** 而不是 **一次 PR 搬完 A1-A5**
   - **为什么**:A1 涉及 Worker entry + DO class + wrangler;A2-A5 是纯 class/function。混搬会让 wrangler 变更风险掩盖 runtime 回归
   - **代价**:P1.A 完成时间略长;`workers/agent-core/` 在中间态会同时拥有 "已吸收 A1 + 未吸收 A2-A5 import 仍指向 packages/*" 的杂交形态
   - **未来重评条件**:如果 A1 吸收后发现剩余 A2-A5 耦合度极高(实际执行时),可合并 A2+A3 或 A4+A5

2. **取舍 2**:我们选择 **保留 `packages/*` 旧 package 共存 ~3 个月** 而不是 **A1 merge 当日就删旧 package**
   - **为什么**:W3 pattern spec §2 纪律;消费者切换需时间
   - **代价**:仓内有 "package 形态 + worker 形态" 两份 runtime 真相;开发者需分清 "新 bug 修哪边"
   - **落地**:按 W3 pattern §6 — 共存期 bug **先修原包**,再同步到 `workers/agent-core/`

3. **取舍 3**:我们选择 **wire vocabulary 严格不回搬** 而不是 **趁吸收把 W0 的部分 wire 回搬到 workers 内部**
   - **为什么**:W0 consolidation 的价值前提就是 wire 归 nacp-core;回搬等于撤销 W0
   - **代价**:A4 hooks 与 A5 eval-observability 的 runtime 要继续 import `@haimang/nacp-core` 的 catalog / evidence vocabulary;这是 import path 变化点,不是架构变化点

4. **取舍 4**:我们选择 **A1 blueprint 作为代表基线,A2-A5 按 TEMPLATE copy-fill** 而不是 **预写 5 份 detailed blueprint**
   - **为什么**:W3 已冻结 "map + 2-3 代表 + 其余 on-demand";预写违反 narrower scope
   - **代价**:A2-A5 的 sub-PR 需要执行者现场填 8 节 blueprint;但模板已存在,成本低

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解 |
|------|----------|------|------|
| A1 搬家破坏 B7 LIVE 5 tests | DO host 结构被无意改动 | pre-worker-matrix 硬契约破坏 | 每个 A1 sub-PR 跑 `node --test test/*.test.mjs`;红就回滚 |
| A1 吸收后 preview deploy 失败 | wrangler.jsonc 结构漂移 | agent-core 不再 live | A1 PR 前后 `pnpm --filter workers/agent-core run deploy:dry-run`;PR 合并后重新 `pnpm run deploy:preview` |
| A2-A5 中某 unit 发现 special-case 超出 TEMPLATE 覆盖 | 代码耦合远比预期重 | sub-PR 阻塞 | 暂停 sub-PR,为该 unit 补 detailed blueprint,再继续 |
| 共存期 import path 混淆(旧代码 `@nano-agent/session-do-runtime`,新代码 `./host/...` 相对路径) | 开发者同时动两处 | 中间态回归 | PR review checklist:对被吸收 package,禁止新增 consumer 来源 |
| 搬家时把 `@nano-agent/nacp-session` 替换成 `@haimang/nacp-session` 错混进 import | scope 漂移 | build 红 | tsconfig 解析 + `grep -r "from '@nano-agent/nacp-"` 零命中 assertion |
| `workspace:*` interim 被误切到 published 版本 | cutover 被前置 | P5 cutover PR 失去独立性 | charter §7 Q5 已定:cutover 仅由独立 P5 PR 做 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己**:P1 完成后,`workers/agent-core/src/` 成为 host runtime 的单一 owner;后续 bug / 新功能只修一处
- **对 nano-agent 长期演进**:runtime 物理归属与 deploy shell 对齐,准备好接入 D06 / D07 的 live assembly
- **对 "上下文管理 / Skill / 稳定性" 杠杆**:
  - 上下文管理:A4/A5 搬家后,context.core(D03)的 inspector / evidence sink owner 路径清晰
  - Skill:A1 host shell 内天然有 `SESSION_DO` 与未来 skill binding slot,为 skill.core 未来可能入场留余地
  - 稳定性:B7 LIVE + 现有 357+198+224 tests 在 P1 全程 green 被持续 battle-test

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | A1 host shell 搬家 | session-do-runtime → workers/agent-core/src/host/ | ✅ `workers/agent-core/src/host/` 含吸收后的 DO + controllers + composition 结构;B7 LIVE 5 tests 仍绿;agent-core preview redeploy 成功 |
| F2 | A2 kernel 搬家 | agent-runtime-kernel → workers/agent-core/src/kernel/ | ✅ `workers/agent-core/src/kernel/` 含 reducer / scheduler / wait-resume / event mapping;package-local tests 绿 |
| F3 | A3 llm 搬家 | llm-wrapper → workers/agent-core/src/llm/ | ✅ `workers/agent-core/src/llm/` 含 canonical request / provider registry / adapter / stream normalize;package-local tests 绿 |
| F4 | A4 hooks runtime 搬家 | hooks runtime residual → workers/agent-core/src/hooks/ | ✅ `workers/agent-core/src/hooks/` 含 matcher / dispatcher / outcome folding;wire vocabulary 仍 import `@haimang/nacp-core` |
| F5 | A5 eval runtime 搬家 | eval-observability runtime → workers/agent-core/src/eval/ | ✅ `workers/agent-core/src/eval/` 含 sink / inspector / timeline / verdict;inspector 默认 OFF |
| F6 | `workers/agent-core/src/index.ts` 升级 | 从 version-probe 升到 host entry 真实 shape | ✅ `default export` 的 `fetch` 路由 + `export { NanoSessionDO }`;不破坏现有 live probe JSON shape(至少含 nacp_core_version / nacp_session_version / status 字段)|
| F7 | tests 迁移 | A1-A5 各 package-local tests 迁到 `workers/agent-core/test/` | ✅ `pnpm --filter workers/agent-core test` 绿;root cross tests 不受影响 |
| F8 | W3 pattern spec 回填 | 首批 A1 PR 附带回填 W3 pattern spec "LOC→时长系数" + "可执行流水线样板" | ✅ `docs/design/pre-worker-matrix/W3-absorption-pattern.md` 对应节从 placeholder 变成实测数据 |

### 7.2 详细阐述

#### F1: A1 host shell 搬家

- **输入**:`packages/session-do-runtime/src/**`(真实 runtime)、`W3-absorption-blueprint-session-do-runtime.md` §3 目标目录
- **输出**:`workers/agent-core/src/host/{do/,controllers/,composition/,routes/,workspace/,health/,traces/}/`、更新后的 `workers/agent-core/src/index.ts`、更新后的 `workers/agent-core/wrangler.jsonc`(若 DO class 路径变化)
- **主要调用者**:Worker fetch(`workers/agent-core/src/index.ts` default export)、DO dispatch(`NanoSessionDO`)
- **核心逻辑**:
  1. `cp -r packages/session-do-runtime/src/* workers/agent-core/src/host/`(保留原目录结构)
  2. 改 import:`@nano-agent/session-do-runtime` 内部相对 import 改 `./` 相对路径;`@haimang/nacp-*` 不改;其他 `@nano-agent/*` Tier B 保持(D03/D04 前)
  3. 合并 `index.ts` 的 export:old `src/index.ts` 公开 API → new `workers/agent-core/src/index.ts` + 中间层 `host/index.ts` re-export
  4. `wrangler.jsonc` 更新:`main: dist/index.js` 不变;`NanoSessionDO` class 路径继续在 `workers/agent-core/src/host/do/nano-session-do.ts`
- **边界情况**:
  - 若 `packages/session-do-runtime/test/` 有 `fixtures/` / `mocks/` 目录,整体迁到 `workers/agent-core/test/`
  - 若 host shell import 了 `@nano-agent/workspace-context-artifacts`,保持不动(等 D04 处理)
- **一句话收口目标**:✅ **A1 搬家 PR merge 后:`pnpm --filter workers/agent-core test` 绿 + `pnpm run deploy:preview` 成功 + live probe 返回预期 JSON + B7 LIVE 5 tests 全绿**

#### F2: A2 kernel 搬家

- **输入**:`packages/agent-runtime-kernel/src/**`
- **输出**:`workers/agent-core/src/kernel/`
- **主要调用者**:D06 的 `createDefaultCompositionFactory` 升级(本设计不做,但给出落脚点)
- **核心逻辑**:按 TEMPLATE copy-fill;reducer / scheduler / wait-resume / event mapping 一次搬完(不拆)
- **边界情况**:
  - kernel 与 llm 的 stream event 桥接层若存在,保留 import kernel 这一侧;llm 侧在 F3 处理
  - 保持 kernel 对 `@haimang/nacp-session` 的 `SessionStreamEvent*Schema` 依赖
- **一句话收口目标**:✅ **A2 搬家 PR merge 后:`workers/agent-core/test/kernel/**` 全绿;TypeScript 接口 `SchedulerPolicy` / `KernelRunner` 等 shape 字节一致**

#### F3: A3 llm 搬家

- **输入**:`packages/llm-wrapper/src/**`
- **输出**:`workers/agent-core/src/llm/`
- **主要调用者**:D06 / F2(kernel)
- **核心逻辑**:canonical request schema + provider registry + ChatCompletions adapter + stream normalize 整体搬
- **边界情况**:
  - provider adapters 的 secret env 访问仍通过 env bag,不改
  - `registerProvider` 扩展点保留(§3.2)
- **一句话收口目标**:✅ **A3 搬家 PR merge 后:package-local llm tests 全绿,provider registry shape 未改**

#### F4: A4 hooks runtime 搬家

- **输入**:`packages/hooks/src/**` 的 **runtime residual**(W0 已把 catalog vocabulary 搬到 `@haimang/nacp-core/hooks-catalog/`)
- **输出**:`workers/agent-core/src/hooks/`
- **主要调用者**:D06 / F1(host composition)
- **核心逻辑**:
  1. 搬 runtime dispatcher / matcher / service-binding hook runtime / outcome folding
  2. **不** 搬 `HOOK_EVENT_CATALOG` / `HookEventName` union — 这些在 W0 consolidation 中已归 `@haimang/nacp-core`
  3. runtime residual 继续 import `@haimang/nacp-core` 的 catalog vocabulary
- **边界情况**:
  - `HookEventMeta interface` 按 W0 decision 留在 `packages/hooks`(metadata = runtime concern),本设计一并搬进 `workers/agent-core/src/hooks/`
  - hooks 对 service-binding 的调用要保留 factory pattern(D06 接)
- **一句话收口目标**:✅ **A4 搬家 PR merge 后:hooks runtime 全绿 + `HOOK_EVENT_CATALOG` 仍 import 自 `@haimang/nacp-core`(非 local)**

#### F5: A5 eval runtime 搬家

- **输入**:`packages/eval-observability/src/**` 的 **runtime residual**(W0 已把 evidence vocabulary 搬到 `@haimang/nacp-core/evidence/`)
- **输出**:`workers/agent-core/src/eval/`
- **主要调用者**:D06 / F1(host composition);所有 `*Evidence` 发送者(hooks / kernel / workspace bridge)
- **核心逻辑**:
  1. 搬 `BoundedEvalSink` 类 + overflow disclosure + `extractMessageUuid` 的 runtime use-site
  2. 搬 inspector facade runtime(默认 OFF;env gate 仍由 wrangler vars)
  3. 搬 timeline read + verdict aggregation 的 sink owner
- **边界情况**:
  - `EvidenceRecord` / `EvidenceAnchorSchema` 不搬,继续 import `@haimang/nacp-core`
  - sink 的 durable owner 仍是 host DO 侧(W3 pattern spec §10)
- **一句话收口目标**:✅ **A5 搬家 PR merge 后:sink dedup + overflow disclosure + inspector seam package-local tests 全绿;B7 LIVE BoundedEvalSink 契约仍绿**

#### F6: `workers/agent-core/src/index.ts` 升级

- **输入**:F1-F5 吸收后的 `workers/agent-core/src/host/index.ts` aggregate exports
- **输出**:升级后的 `workers/agent-core/src/index.ts`
- **主要调用者**:Cloudflare Worker runtime(via `wrangler.jsonc main`)
- **核心逻辑**:
  - default export fetch handler(保留返回版本 probe JSON 的 fallback,但添加 live-loop 路由分发 — D06 接入实际 composition)
  - `export { NanoSessionDO }` 从 `./host/do/nano-session-do.js`
  - `export type { AgentCoreEnv }` 从 `./host/types.js`
- **边界情况**:
  - W4 的 live probe JSON 形状需保留(至少 `worker` / `nacp_core_version` / `nacp_session_version` / `status` 4 个字段);新增字段可,不删字段
- **一句话收口目标**:✅ **`workers/agent-core/src/index.ts` 不再是纯 version-probe,而是 host entry;`curl preview-url` 仍返回合法 JSON;W4 契约不破坏**

#### F7: tests 迁移

- **输入**:5 个 package 的 `test/**`
- **输出**:`workers/agent-core/test/{host,kernel,llm,hooks,eval}/**`
- **核心逻辑**:每个 sub-PR 对应 unit tests 一并迁;fixture / mock 整体搬;vitest config 与 workers/agent-core 对齐
- **边界情况**:
  - root contract tests(`test/b7-*`、`test/*.test.mjs`)**不搬**,保持在 root
  - cross-package tests **不搬**,保持在 root
- **一句话收口目标**:✅ **`pnpm --filter workers/agent-core test` 全绿;`node --test test/*.test.mjs` 98/98 仍绿;`npm run test:cross` 112/112 仍绿**

#### F8: W3 pattern spec 回填

- **输入**:A1 PR 执行期间的实测数据(LOC 实测值 / 搬家命令序列 / 踩坑 / 回归纪录)
- **输出**:`docs/design/pre-worker-matrix/W3-absorption-pattern.md` 两节从 placeholder 变成实测数据
- **核心逻辑**:A1 PR 作者在 PR body 内附带 patch 修改 pattern spec;不开独立 PR
- **一句话收口目标**:✅ **W3 pattern spec "LOC→时长经验系数" + "可执行流水线样板" 节含真实数据,不再是 placeholder**

### 7.3 非功能性要求

- **性能目标**:A1 吸收后 cold start 时延与 W4 preview 相当(preview deploy 后 `curl` 时间 < 500ms)
- **可观测性要求**:A5 BoundedEvalSink 的 overflow disclosure 行为不变;inspector facade 默认 OFF
- **稳定性要求**:B7 LIVE 5 tests 在 F1-F6 每一步全程绿;共存期新 bug 按 W3 pattern §6 "先修原包"
- **测试覆盖要求**:`workers/agent-core/test/**` 覆盖吸收后所有 src/ 子目录;root cross + contract 不降级

---

## 8. 可借鉴的代码位置清单

### 8.1 host shell 相关(A1)

| 位置 | 内容 | 借鉴点 |
|------|------|--------|
| `packages/session-do-runtime/src/worker.ts:1-89` | Worker entry + idFromName 路由 | A1 搬家结构直接照抄 |
| `packages/session-do-runtime/src/do/nano-session-do.ts:130-280` | DO constructor | A1 搬家;保留 B7 LIVE 纪律 |
| `packages/session-do-runtime/src/do/nano-session-do.ts:466-535` | WS ingress + `acceptClientFrame` async | A1 搬家 |
| `packages/session-do-runtime/src/do/nano-session-do.ts:608-645` | `dispatchAdmissibleFrame` | A1 搬;D05 会在此处接 `initial_context` consumer |
| `packages/session-do-runtime/src/composition.ts:82-106` | default composition factory | A1 搬家提供文件位置;D06 在此升级 |
| `packages/session-do-runtime/src/remote-bindings.ts:324-399` | remote bindings factory | A1 搬家提供文件位置;D06 在此补全 |
| `packages/session-do-runtime/src/workspace-runtime.ts` | workspace bridge | A1 随 host shell 搬 |

### 8.2 kernel / llm / hooks / eval(A2-A5)

| 位置 | 内容 | 借鉴点 |
|------|------|--------|
| `packages/agent-runtime-kernel/src/**` | kernel reducer / scheduler / wait-resume | F2 整体搬 |
| `packages/llm-wrapper/src/**` | canonical request / provider registry / stream normalize | F3 整体搬 |
| `packages/hooks/src/**`(runtime residual)| hooks dispatcher / matcher / outcome folding | F4 搬 runtime residual;catalog vocabulary 仍 import nacp-core |
| `packages/eval-observability/src/**`(runtime residual)| BoundedEvalSink / inspector facade / timeline / verdict | F5 搬 runtime residual;evidence vocabulary 仍 import nacp-core |

### 8.3 必须避开的 "反例"

| 位置 | 问题 | 避开理由 |
|------|------|----------|
| 把 `HOOK_EVENT_CATALOG` 复制回 `workers/agent-core/src/hooks/` | 回搬 W0 consolidation | W0 价值前提是 wire 归 nacp-core |
| 在 A1 PR 内同时激活 `BASH_CORE` service binding | 越界到 D07 | P2 激活由 D07 统一管 |
| `workers/agent-core/src/` 新建 `src/worker2.ts` | 破坏单 entry 聚合 | wrangler 只认 `main` |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

A1-A5 吸收是 P1.A 的核心交付物:一个 sub-PR 序列(host → kernel → llm → hooks → eval),让 `workers/agent-core/src/` 从 W4 交付的 version-probe shell 升级为 5 个 Tier B package runtime 的真实物理 owner。本设计不负责 composition 升级、不负责 initial_context 接线、不负责 service binding 活化;它只负责 "搬家 + 让 `src/` 成为 runtime 归属"。预期代码量:5 个 package src+test 合计搬家约 15000-20000 LOC(基于 session-do-runtime ~3000 src + 其余按比例),共存期 ~3 个月,sub-PR 数 5-7 个。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | **5** | host runtime 从 package 形态迁到 worker 形态,与 W4 shell 对齐是 worker-matrix 的第一要务 |
| 第一版实现的性价比 | **4** | 搬家成本大但机械;难点只在 A1 host shell 的 wrangler / DO 结构不漂移 |
| 对未来 "上下文管理 / Skill / 稳定性" 演进的杠杆 | **5** | D05/D06/D07 都要求 host 落在 workers/agent-core/;本设计是一切后续的落脚点 |
| 对开发者自己的日用友好度 | **4** | 搬家完成后 debug / 修 bug 路径单一(不再同时存在 packages + workers 两处 host 语义)|
| 风险可控程度 | **4** | B7 LIVE / root cross 作回归网;按 sub-PR 搬可以精准回滚 |
| **综合价值** | **4.4** | P1.A 的唯一主线,不可替代 |

### 9.3 下一步行动

- [ ] **决策确认**:Owner approve 本设计;A1 先行 PR 作者 claim
- [ ] **关联 Issue / PR**:待 P1.A 启动时新建 sub-PR 序列
- [ ] **待深入调查的子问题**:
  - A2 kernel `SchedulerPolicy` interface 是否真的零 consumer 侧修改?(sub-PR 执行时 grep 验证)
  - A4 hooks runtime 内 `HookDispatcher` 对 `HookEventMeta` 的 runtime 依赖,是否与 W0 的 wire/runtime split 边界完全吻合?
- [ ] **需要更新的其他设计文档**:
  - `docs/design/pre-worker-matrix/W3-absorption-pattern.md`(首批 A1 PR 后回填 2 节 placeholder)
  - `docs/eval/worker-matrix/agent-core/index.md`(A1 PR merge 后 §3 判断表中 "runtime 位置" 从 `packages/session-do-runtime` 改 `workers/agent-core/src/host`)

---

## 附录

### A. 讨论记录摘要

- **分歧 1**:A1-A5 是一次大 PR 还是 sub-PR 序列?
  - **倾向 A(一次大 PR)**:一次完成,共存期短
  - **倾向 B(sub-PR 序列)**:风险隔离好,B7 LIVE 回归易诊断
  - **最终共识**:sub-PR 序列(host → kernel → llm → hooks → eval),对齐 charter §7 Q1(c)

- **分歧 2**:`workers/agent-core/src/index.ts` 是否保留 W4 的 version-probe JSON 形状?
  - **倾向 A(保留)**:live probe 对 W4 DoD 仍有价值
  - **倾向 B(替换为 live loop response)**:已经升级就应该让 `fetch` 返回真实 loop 的结果
  - **最终共识**:保留 shape(至少 4 字段),可加字段不删字段;真实 loop 由 D06 接入后的 `/invoke` 或等价路由处理

### B. 开放问题清单

- [ ] **Q1**:A1 PR 完成后,`packages/session-do-runtime` 是否立刻 bump 为 `0.4.0` 以表明 "host ownership moved"?(建议 no,bump 留到 D09 deprecation PR;共存期保持 0.3.0)
- [ ] **Q2**:sub-PR 之间如何处理 "host 已迁但 kernel 未迁" 的中间态?是否需要每个 sub-PR 独立跑 preview deploy?(建议:每个 sub-PR 跑 dry-run;preview deploy 只在 F6 / P2 里做)
- [ ] **Q3**:A1 host 搬家时,`packages/session-do-runtime/src/workspace-runtime.ts` 在 D04 filesystem.core 吸收后需二次调整;本设计是否预埋 staged cut-over 标记?

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-23 | Claude Opus 4.7 | 初稿;基于 charter + W3 blueprint + W4 closure 编制 |
