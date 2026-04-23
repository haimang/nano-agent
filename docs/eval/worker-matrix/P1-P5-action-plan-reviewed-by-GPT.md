# P1-P5 worker-matrix action plans reviewed by GPT

> Review date: `2026-04-23`
> Reviewer: `GPT-5.4`
> Scope: `docs/action-plan/worker-matrix/P1-P5-*.md`
> Baseline truth:
> - `docs/plan-worker-matrix.md`
> - `docs/eval/worker-matrix/`
> - `docs/eval/worker-matrix/D01-D09-design-docs-reviewed-by-GPT.md`
> - current code under `packages/*` and `workers/*`

---

## 0. Verdict

**Verdict: approve-with-revisions.**

这组 P1-P5 action-plan 的大方向是成立的。它们延续了当前正确的 first-wave posture：

1. `agent.core` 仍是唯一 host / session edge。
2. `agent.core ↔ bash.core` 仍是 first-wave 唯一必须真实激活的 remote loop。
3. `context.core` 与 `filesystem.core` 仍保持 **host-local absorption posture**，没有被误写成“四 worker 全远端对称化”。
4. P5 仍把 cutover / deprecation 放在 hygiene 层，而不是把 release 动作和 runtime closure 混在一起。

但进入实施前，仍有 **5 个需要先吸收的 action-plan 级修订**。其中 **R1 / R2 / R3** 会直接影响 P2-P4 的可执行性；**R4 / R5** 属于执行纪律与 cutover 精度问题，也应在对应 phase 开始前修掉。

---

## 1. 总体评价

### 1.1 成立的部分

这套 action-plan 最大的优点，是它基本守住了设计审查已经确认的真实边界：**worker-matrix 是吸收与装配，不是重新发明 4 个 worker。**  
P1 把 A1-A5 + B1 视为 runtime ownership 迁移，P2 把重点压在 live loop / composition / `initial_context` / binding activation，P3/P4 把 context/filesystem 继续写成 thin substrate owner，P5 则单独处理 published-path 与 deprecation hygiene。这一大框架和当前 charter、W3/W4/W5 真相、以及 live code reality 是一致的。

特别是以下几条，action-plan 写得是对的：

| 项目 | 当前处理 | 评语 |
|---|---|---|
| `bash.core` first-wave 角色 | 唯一必须真实激活的 remote worker | 正确 |
| `context.core` posture | host-local thin substrate + compact opt-in | 正确 |
| `filesystem.core` posture | host-local authority，不抢跑 remote FS RPC | 正确 |
| `skill.core` | 继续 deferred | 正确 |
| P5 deprecation | 只做诚实标注，不强删 Tier B | 正确 |

### 1.2 需要收紧的部分

当前最大的问题不在总体方向，而在 **几个已经写进 phase / DoD / e2e 断言的实现假设，与当前代码真相并不对齐**。这意味着：

1. P1 大体可执行，但有一个测试所有权表述需要回正。
2. P2 里有两个核心断点：`appendInitialContextLayer` 的执行路径，以及 live-loop e2e 的 wire wording。
3. P3/P4 共享一个未冻结的 cross-worker import/package-name 前提。
4. P5 的 release cutover 成功条件应写成“**非 link 的 published-path resolution**”，不应过度绑定某一个 lockfile 表面形态。

---

## 2. 需要吸收的修订

### R1. P2/P3 把 `appendInitialContextLayer` 写成“对 mutable assembler stack append 一个 `initial_context` layer”，但当前代码真相里这个 API 和 layer kind 都不存在

**问题**

P2 把 Phase 1 stub 明确写成：

1. `appendInitialContextLayer(assembler, payload)`
2. 最小实现可以是 `assembler.appendLayer(...)`
3. e2e 里验证 “assembler layers 数 +1”
4. evidence 里出现 `layer_kind: "initial_context"` 或等价标识

但当前 `ContextAssembler` 只有 `assemble(layers)`，没有 `appendLayer()`，也没有内部暴露的 mutable layers stack。当前合法 `ContextLayerKind` 只有：

`system / session / workspace_summary / artifact_summary / recent_transcript / injected`

并不存在 `initial_context` 这个 layer kind。当前 assembly evidence 也只有 `assembledKinds`，并没有 `layer_kind` 这个字段。

**证据**

1. P2 把最小实现写成 `assembler.appendLayer({ kind: "initial_context", ... })`：`docs/action-plan/worker-matrix/P2-live-loop-activation.md:144,176,231,303`
2. P2 的 root e2e #2 断言里写了 “assembler layers 数 +1” 与 `AssemblyEvidence` 含 `initial_context` 标识：`docs/action-plan/worker-matrix/P2-live-loop-activation.md:153,268,400`
3. D03 也把 F4 写成 “push 到 assembler 的 layers stack”：`docs/design/worker-matrix/D03-context-core-absorption-and-posture.md:297-304`
4. 当前 `ContextAssembler` 只暴露 `assemble(layers)`，没有 `appendLayer()`：`packages/workspace-context-artifacts/src/context-assembler.ts:40-48,85-170`
5. 当前合法 `ContextLayerKind` 只有 6 个，不含 `initial_context`：`packages/workspace-context-artifacts/src/context-layers.ts:15-23`
6. 当前 `AssemblyEvidenceRecord` 只有 `assembledKinds / droppedOptionalKinds / orderApplied ...`，没有 `layer_kind` 字段：`packages/workspace-context-artifacts/src/evidence-emitters.ts:48-88`

**判断**

这是当前 action-plan 里最重要的执行级断点。  
P2/P3 不是“实现细节没写完”，而是 **目前把一个并不存在的 API、一个并不存在的内部数据结构、以及一个并不存在的 layer kind，当成了现成前提**。

**建议**

进入 P2 前，先把下面三件事冻结清楚：

1. `appendInitialContextLayer` 到底是：
   - 新增在 `ContextAssembler` 上的正式 mutator；还是
   - 一个独立 helper，维护 assembler 之外的 pending layers，再在 `assemble()` 前合并。
2. `SessionStartInitialContext` 到底映射成哪些**现有** canonical layer kinds（更可能是 `session` / `injected`，而不是发明 `initial_context`）。
3. P2 dedicated e2e 应断言 `assembledKinds` 含 canonical mapped kind，或断言 assembled prompt / layer content 变化；不要再断言不存在的 `layer_kind` 字段。

在这个点修完前，我不建议把 P2 视为可以直接执行的文稿。

---

### R2. P2 的 live-loop e2e 描述还在使用 stale ingress wording，容易把测试写到不存在的 wire 上

**问题**

P2 的 root e2e #1 多处写成 “发起 `session.start` + `turn_input`”。  
但当前 session ingress truth 已经不是“wire 上有一个 `turn_input` family”，而是：

1. 首轮输入：`session.start.body.initial_input`
2. 后续输入：`session.followup_input.body.text`

`turn_input` 只是 runtime 内部抽象，不是当前 `nacp-session` 对外 wire 名字。若 action-plan 照当前 wording 实施，测试作者很容易写出一条不对齐真实 ingress truth 的 case。

**证据**

1. P2 的 root e2e #1 写成 “`session.start` + `turn_input`”：`docs/action-plan/worker-matrix/P2-live-loop-activation.md:152,267`
2. 当前 turn ingress truth 已明确只有 `session.start.initial_input` + `session.followup_input.text`：`packages/session-do-runtime/src/turn-ingress.ts:5-15,53-63`
3. `extractTurnInput()` 当前实际消费的也是 `initial_input` 和 `session.followup_input.text`：`packages/session-do-runtime/src/turn-ingress.ts:83-109`
4. `SessionStartBodySchema` 当前冻结的字段名是 `initial_input`，不是 `turn_input`：`packages/nacp-session/src/messages.ts:18-26`

**判断**

这是一个 **wire wording drift**。它不像 R1 那样会直接卡死实现，但它足够具体，已经进入了 P2 的 task table / test row / DoD，所以应该在实施前改正。

**建议**

把 P2 的 e2e 描述统一改为当前 canonical ingress wording，例如：

1. root e2e #1：发 `session.start`，body 含 `initial_input`
2. 若需要 follow-up case，单独用 `session.followup_input`
3. 文中保留 `turn input` 时，只能作为 runtime 内部概念，不要再写成 wire trigger

---

### R3. P3/P4 依赖的 cross-worker import / package-name 策略还没冻结，但 action-plan 已把它写成实施路径

**问题**

P3 明确要求把 `appendInitialContextLayer` 从 `workers/agent-core` 迁到 `workers/context-core`，并让 `agent-core` 改 import 指向 `context-core`。  
但它同时承认：当前 pnpm workspace 下这种 cross-worker import 可能不被允许，于是把执行路径写成：

1. 用 `workspace:*` + alias
2. 或改用 `@nano-agent/context-core`
3. 或做其他 owner 决策

问题在于：**这不是一个纯 kickoff 问题，而是 Phase 3 / P4 实施本身的直接前提。** 当前 worker package 的真实名字是 `@haimang/context-core-worker` / `@haimang/filesystem-core-worker`，不是 `@nano-agent/context-core` / `@nano-agent/filesystem-core`。

**证据**

1. P3 直接把 Phase 3 建立在 cross-import 上，并把方案留给 `Q1`：`docs/action-plan/worker-matrix/P3-context-absorption.md:234,238,372-374`
2. P4 也把同一个问题当作 Phase 1-3 的协作前提：`docs/action-plan/worker-matrix/P4-filesystem-absorption.md:404,410`
3. 当前 `workers/context-core/package.json` 名字是 `@haimang/context-core-worker`：`workers/context-core/package.json:1-17`
4. 当前 `workers/filesystem-core/package.json` 名字是 `@haimang/filesystem-core-worker`：`workers/filesystem-core/package.json:1-17`
5. 当前 D03 反而把“可解析的消费路径”写成 `@haimang/context-core-worker` 或等价 in-workspace path：`docs/design/worker-matrix/D03-context-core-absorption-and-posture.md:318`

**判断**

这是 P3/P4 共享的一个 **执行前提未冻结** 问题。  
如果不先定清，Phase 3 的 import 改动与 P4 的后续 split 改动都可能在 typecheck 这一层就卡住。

**建议**

在 P3 kickoff 前先固定一种路径，并把 P3/P4 全文统一：

1. **更稳妥**：直接使用当前真实 package 名 `@haimang/context-core-worker` / `@haimang/filesystem-core-worker`，在消费者侧显式加 `workspace:*` 依赖。
2. 若不希望 worker-to-worker source import，则把共享 API 保持在 `packages/*` / shared seam，避免让 worker package 互相成为 TS import 依赖。
3. 不建议在 action-plan 中继续保留 `@nano-agent/context-core` 这种当前仓库里不存在的 alias 作为默认路径。

在这件事定之前，P3/P4 更准确的状态是 **方向正确，但实施路径还没 fully frozen**。

---

### R4. P1 的测试迁移表述与 D01/root test ownership truth 冲突，容易误导实现者去搬错测试

**问题**

P1 一方面正确要求全程守住 B7 LIVE / root / cross tests；另一方面又在 Phase 1 细节里写成：

1. `packages/*/test/**` → `workers/agent-core/test/{host,kernel}/**`
2. `B7 LIVE 5 tests 在 workers/agent-core/test 下跑绿`

但 design review 已经明确过：**root contract tests 与 cross-package tests 不搬，继续留在 root。** 当前实际的 B7 LIVE 也确实是 root test 文件，而不是 package-local tests。

**证据**

1. P1 把 tests 搬迁写到 `workers/agent-core/test/**`，并直接说 B7 LIVE 在那里跑绿：`docs/action-plan/worker-matrix/P1-agent-bash-absorption.md:181,207,264,270`
2. D01 明确写了 root contract tests / cross-package tests **不搬**：`docs/design/worker-matrix/D01-agent-core-absorption.md:356-357`
3. 当前 B7 LIVE 的实际 root 文件在 `test/` 下：`test/b7-round2-integrated-contract.test.mjs`

**判断**

这是一个 **执行纪律** 问题。  
如果不改，P1 的执行者可能把 root guardians 误搬进 worker package，反而破坏当前“package-local tests vs root contract tests”这条已经很清楚的测试层次。

**建议**

把 P1 的相关表述改成：

1. 迁移的是 package-local tests
2. `test/*.test.mjs` 与 `test/e2e/*.test.mjs` 继续留在 root
3. B7 LIVE 继续作为 root gate，不进入 `workers/agent-core/test`

---

### R5. P5 对 lockfile 成功条件写得过于“tarball-specific”，应收紧为“非 `link:` 的 published-path resolution”

**问题**

P5 多处把 cutover 成功条件写成：

1. `pnpm install`
2. `pnpm-lock.yaml` 从 `link:` 切到 **tarball**

但同一份 action-plan 里又有一处把验证写成 “tarball **或 registry**，不是 `link:`”。这说明真正重要的 truth 其实是：**workers 不再走 workspace link，而是真正从 published path resolve NACP**；至于 lockfile 最终表现成 tarball 还是 registry version，是实现工具细节，不应被过度写死。

**证据**

1. P5 多处把 lockfile 目标固定成 tarball：`docs/action-plan/worker-matrix/P5-cutover-and-deprecation.md:10,49,80,113,141,194,273,282,296,406`
2. 但 P5 在具体验证行里又写成 “tarball 或 registry，不是 `link:`”：`docs/action-plan/worker-matrix/P5-cutover-and-deprecation.md:221`
3. 当前 4 个 workers 的 `@haimang/nacp-*` 依赖仍然是 `workspace:*`：`workers/*/package.json`
4. 当前 lockfile 里 workspace importers 的现状确实是 `version: link:...`：`pnpm-lock.yaml:146-156,209-216`

**判断**

这不是方向性错误，但它会制造一个没必要的 false negative：即便 cutover 已经真实走 published path，只要 lockfile 不是计划作者心里的“tarball 形状”，P5 就可能被误判为失败。

**建议**

把 P5 的成功条件改写成：

1. `workers/*/package.json` 不再含 `workspace:*`
2. `pnpm-lock.yaml` 对 `@haimang/nacp-core` / `@haimang/nacp-session` 的 resolution **不再是 `link:`**
3. preview redeploy + live probe + test green 作为主验证

也就是把重点放在 **published-path truth**，而不是某一种 lockfile 外观。

---

## 3. 分阶段审查结论

| 文档 | 结论 | 说明 |
|---|---|---|
| P1 agent + bash absorption | **approve with revisions** | 总体方向正确；需修正测试迁移表述，避免把 root guardians 搬进 worker package |
| P2 live loop activation | **revise** | 当前存在 `appendInitialContextLayer` 执行路径断点与 ingress wording drift |
| P3 context absorption | **revise** | 方向成立，但 `appendInitialContextLayer` owner/migration 依赖未冻结的 cross-worker import strategy |
| P4 filesystem absorption | **approve with prerequisite** | host-local posture 正确；但与 P3 共用 cross-worker import/package-name 前提，应先冻结 |
| P5 cutover + deprecation | **approve with clarification** | published-path / deprecation 整体正确；lockfile success condition 应从 tarball-specific 收紧为 non-link truth |

---

## 4. 对 charter / design / code truth 的总体对齐判断

### 4.1 能否支持 4-worker first-wave 基本架构

**可以。**

因为这套 P1-P5 并没有把目标写成“4 个 worker 全部厚远端化”，而是正确保持了当前最重要的架构不对称：

1. `agent.core` 是唯一 host；
2. `bash.core` 是唯一必须真实 remoteize 的 loop；
3. `context.core` / `filesystem.core` 先完成 runtime ownership absorption；
4. P5 只负责 release hygiene / truth unification。

### 4.2 能否支持基本功能验证

**可以，但前提是先吸收 R1-R5。**

其中最关键的是：

1. **R1** 决定 P2 的 `initial_context` 到底能否按当前代码真相落地；
2. **R2** 决定 P2 的 e2e 是否对准真实 session ingress；
3. **R3** 决定 P3/P4 是否有可执行的 import/package path；
4. **R4 / R5** 则决定 P1/P5 不会被文档自己制造的执行歧义绊住。

---

## 5. 最终结论

这组 P1-P5 action-plan **已经足够接近可执行版本**。它们最重要的价值，在于把 worker-matrix first-wave 的真正工作拆清楚了：

1. P1 = ownership absorption
2. P2 = live loop closure
3. P3/P4 = context/filesystem posture absorption
4. P5 = published-path + deprecation closure

所以我的结论不是 `changes-requested` 级别的整体否决，而是更精确的：

> **这组 P1-P5 可以作为 worker-matrix 实施输入，但应先吸收 R1-R5 五个定点修订，再进入正式执行。**

在这五点里，**R1 / R2 / R3** 建议视为实施前必须先修的 blockers；**R4 / R5** 则应在对应 phase 开始前修正，以避免执行歧义与不必要的 false negative。

---

## 6. 作者回应(Opus 4.7 吸收与更新日志)

> **Response date**:`2026-04-23`
> **Responder**:`Claude Opus 4.7 (1M context)`
> **Verdict**:**all-5-accepted**。对 R1/R2/R3/R4/R5 逐条做了代码层级事实核查,结果与 GPT 引用完全一致;随后按 item-by-item 更新了全部 P1-P5 action-plan 以及 D03 design(因 R1 同时影响 D03 F4 原文)。本 phase 执行文稿由 revise 升为 approved-for-execution。

### 6.1 代码事实核查结果(5/5 confirmed)

| R | 事实核查命令 / 位置 | 结论 |
|---|---|---|
| R1 | `packages/workspace-context-artifacts/src/context-assembler.ts:63-180` | `ContextAssembler` 仅 `assemble(layers) / setEvidenceWiring()`,**无** `appendLayer()` — confirmed |
| R1 | `packages/workspace-context-artifacts/src/context-layers.ts:15-23` | `ContextLayerKindSchema` = `system/session/workspace_summary/artifact_summary/recent_transcript/injected` 6 个;**无** `initial_context` kind — confirmed |
| R1 | `packages/workspace-context-artifacts/src/evidence-emitters.ts:34-55` | `AssemblyEvidenceRecord` 字段 = `stream/anchor/assembledKinds/droppedOptionalKinds/orderApplied/totalTokens/truncated/requiredLayerBudgetViolation/preparedArtifactsUsed/dropReason`;**无** `layer_kind` 字段 — confirmed |
| R2 | `packages/session-do-runtime/src/turn-ingress.ts:5-15,83-109` | 两条 ingress 口径 = `session.start.body.initial_input` 与 `session.followup_input.body.text`;`turn_input` 仅为 runtime `TurnInput` 类型,不是 wire — confirmed |
| R2 | `packages/nacp-session/src/messages.ts:14-27` | `SessionStartBodySchema` 字段真相 = `cwd / initial_context / initial_input`;**无** `turn_input` — confirmed |
| R3 | `workers/{agent,bash,context,filesystem}-core/package.json::name` | 4 worker 真实 name = `@haimang/{agent/bash/context/filesystem}-core-worker`;**无** `@nano-agent/context-core` / `@nano-agent/filesystem-core` — confirmed |
| R4 | `test/` 下 21+ `.test.mjs`(含 `b7-round2-integrated-contract.test.mjs` / `capability-toolcall-contract.test.mjs` / `trace-first-law-contract.test.mjs` ...) + `test/e2e/` + `test/verification/` | root guardians 成立;D01 §8 也明确 "root contract tests 与 cross-package tests 不搬" — confirmed |
| R5 | `pnpm-lock.yaml:209-216`(workers/agent-core 节) | 当前 resolution 真相 = `version: link:../../packages/nacp-core`;cutover 后 "非 `link:`" 是可检测真相,tarball / registry version 均为可能表面 — confirmed |

### 6.2 逐条更新日志

#### R1 吸收(P2 + D03)

- **P2 action-plan** 修改:
  - §0 metadata "计划对象" 加入 "R1(不发明 initial_context layer kind / 不扩 assembler public API / 断言 assembledKinds 含 canonical mapped kind)"
  - §2.1 S1 重写:显式写 "不在 ContextAssembler 上加 appendLayer 方法;不新增 initial_context kind;helper 维护 assembler 之外的 pending layers list;映射到现有 6 canonical kinds(首选 session / injected);host 在 assemble 前合并 pending list 与既有 turn-level layers"
  - §2.1 S10 e2e #2 断言改口径:(a) no throw (b) `AssemblyEvidenceRecord.assembledKinds` 含 helper 映射到的 canonical kind (c) 对比 negative case 同一 kind 的 layer 内容 / token 数出现差异;**删除** "layers 数 +1" 与 "`layer_kind: initial_context`" 两条暗合假设
  - §2.3 边界判定表 `appendInitialContextLayer 实装深度` 条目改为 "helper-maintained pending layers(不改 assembler API,不发明 layer kind)"
  - §4.2 P1-01 任务条目:最小实现写成 "helper 维护 per-DO / per-assembler pending layers map;映射到 canonical ContextLayer(首选 session 或 injected)"
  - §4.6 P5-02 任务条目 e2e #2 断言改口径(同 S10)
  - §5.2 Phase 1 功能预期 3 款改对应口径;§5.6 Phase 5 风险提醒 "e2e #2 依赖 ..." 改为不基于 `layer_kind`
- **D03 design** 修改(因 GPT 在 R1 证据中直接引用 `D03:297-304`):
  - §7.2 F4 章节整改为 R1 校准版:明确 `ContextAssembler` public API 仅 `assemble(layers)`;明确 6 canonical kinds 枚举真相;helper 策略为 "pending list 合并 at assemble 时";pending 推荐 per-session 持久
  - §C 版本历史追加 v0.2 条目
  - 未改 F4 API 签名(`appendInitialContextLayer(assembler, payload)`),因 consumer 可见形状对 D05 依然有效

#### R2 吸收(P2)

- **P2 action-plan** 修改:
  - §0 metadata "计划对象" 加入 "R2(wire 上只有 session.start.initial_input / session.followup_input.text,`turn_input` 仅为 runtime 内部概念)"
  - §2.1 S9 e2e #1 描述:`session.start + turn_input` → `session.start` body 含非空 `initial_input` 字符串;follow-up case 用 `session.followup_input`(body `text` 字段);显式标 "`turn_input` 仅为 runtime 内部 `TurnInput` 类型"
  - §4.6 P5-01 任务条目同步改口径

#### R3 吸收(P3 + P4)

- **P3 action-plan** 修改:
  - §4.3 P3-02/P3-03 注文:否定 `@nano-agent/context-core`(仓库里不存在);列出两条合法落地路径:(A) 使用真实 `@haimang/context-core-worker` + `workspace:*` 依赖;(B) helper 留 `packages/*` 作 shared seam,不做 worker-to-worker source import
  - §4.3 P2-03 注文 workspace boundary 提醒:更新为"通过真实 worker package name + workspace:* 声明;不使用 `@nano-agent/*` 仓库不存在的 alias"
  - §5.4 Phase 3 风险提醒:对齐 R3 两条路线
  - §6 Q1 重写:**不再**建议把 context-core 的 name 改成 `@nano-agent/context-core`;改为两选一(A/B),明确 "不得使用 @nano-agent/context-core — 该 name 不存在"
- **P4 action-plan** 修改:
  - §7.1 风险表 `workspace cross-import 限制` 行:明确真实 name `@haimang/filesystem-core-worker` / `@haimang/context-core-worker`;删除 `@nano-agent/filesystem-core` / `@nano-agent/context-core` 占位名
  - §7.2 组织协作前提 行同步改口径

#### R4 吸收(P1)

- **P1 action-plan** 修改:
  - §0 metadata "文件位置" 行:workers/agent-core/test 的注解加 "package-local only;root contract / cross tests 不迁(per R4)"
  - §2.1 S1 / S2:显式标 "package-local tests 随 src 搬;root `test/*.test.mjs` 与 `test/e2e/**` 不搬"
  - §2.1 S6:原 "跑 98 root + 112 cross" 改为 "跑 root 侧 `node --test test/*.test.mjs`(含 B7 LIVE 5 tests,继续作 root gate) + cross tests + package-local tests + dry-run"
  - §3 业务工作总表 P1-03:work item 加 "(per R4)";涉及文件分出 "package-local → workers/test" 与 "root test 原位不搬" 两栏
  - §3 P4-02:`packages/capability-runtime/test/**` → `workers/bash-core/test/**` 改为 "package-local only";`test/capability-toolcall-contract.test.mjs` 等 root contract guardians 不搬
  - §4.1 P1-03 / §4.2 P2-03 表格行同步改口径
  - §5.1 Phase 1 功能预期 "B7 LIVE 5 tests 在 workers/agent-core/test 下跑绿" 改为 "B7 LIVE 5 tests 继续作 root gate,在 root `test/b7-round2-integrated-contract.test.mjs` 跑绿;workers/agent-core/test 只含 package-local 单测"
  - §5.1 / §5.2 "本 Phase 新增文件" 加 "(均为 package-local;per R4 root test/ 不搬)"

#### R5 吸收(P5)

- **P5 action-plan** 修改:
  - §0 metadata "文件位置" 行:pnpm-lock.yaml 注解改为 "resolution 从 `link:` 切到非 `link:` published-path;per R5:真相是非 `link:`,tarball / registry version 均为合法表面"
  - §0 "直接产出" + §1.2 Phase 总览 + §1.3 Phase 2 说明 + §1.5 影响目录树 + §2.1 S3 + §2.1 S5 + §3 业务工作总表 P1-03 + §4.2 P1-03 行 + §5.2 Phase 目标 + §5.2 功能预期 2 条 + §5.2 风险提醒 + §7.1 风险 `lockfile resolution 未切 tarball` 行 + §7.1 风险 `nacp_core_version 字段源头漂移` 行 + §9 复盘关注点:**全部**统一改为 "成功条件 = 对 `@haimang/nacp-*` 条目的 resolution 不再是 `link:`;tarball descriptor 与 registry version 均为合法表面形态"
  - 保留一条工具层 verify 命令:`grep "resolution.*link:" pnpm-lock.yaml` 对 nacp-* 行数 == 0(从 "必须是 tarball" 改为 "必须非 link:")

### 6.3 影响文件清单

| 文件 | 改动类型 | 主要 diff |
|---|---|---|
| `docs/action-plan/worker-matrix/P1-agent-bash-absorption.md` | R4 应用 | 8 处 |
| `docs/action-plan/worker-matrix/P2-live-loop-activation.md` | R1 + R2 应用 | 8 处 |
| `docs/action-plan/worker-matrix/P3-context-absorption.md` | R3 应用 | 4 处 |
| `docs/action-plan/worker-matrix/P4-filesystem-absorption.md` | R3 应用 | 2 处 |
| `docs/action-plan/worker-matrix/P5-cutover-and-deprecation.md` | R5 应用 | 12 处(`replace_all` + per-line) |
| `docs/design/worker-matrix/D03-context-core-absorption-and-posture.md` | R1 follow-up | F4 章节重写 + v0.2 版本历史 |

### 6.4 未触动的部分(GPT 未要求改,且现状对齐)

- **charter §6 / §7 Q1-Q7**:不改(GPT 没要求;Q1-Q7 已在 D01-D09 review round 吸收过)
- **D01-D09 v0.2 条目**:除 D03 follow-up 外其余不动(本轮 GPT review 聚焦 action-plan 执行口径,D01-D09 已在前一轮吸收 D01-D09 GPT review R1-R5)
- **P0-absorption-prep action-plan**:未触动(GPT 未评 P0;P0 本身是 design-only 前置)

### 6.5 下一步

- **R1-R5 吸收完成**;本 phase action-plan 由 "approve with revisions / revise" 升为 **approved-for-execution**
- 等待 owner 对以下未冻结 Q 的最终决策:
  - **P3 Q1**(cross-worker import 选 A / B)— 在 P3 kickoff 前 must answer
  - **P5 Q1**(9 per-worker deprecation PR 节奏)+ **Q2**(capability-runtime / agent-runtime-kernel 走 README-only 还是 minimal stub,R5 已不涉及,R5 属于不同维度)— 在 P5 kickoff 前 must answer

- **一句话闭环**:GPT R1-R5 全部 accept;代码事实核查 100% 对齐;更新已逐点回填 P1-P5 + D03 v0.2;P1-P5 action-plan 现处于 "可执行最终版本" 状态。
