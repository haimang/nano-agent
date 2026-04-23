# Blueprint — A1-A5 sub-PR Granularity(agent-core sub-PR 切分建议)

> 类型：on-demand blueprint(非代表,P0 补齐;对应 charter Q1c)
> 状态：draft(worker-matrix P0 Phase 2 产出);**建议性 — 最终切分由 P1.A kickoff PR 的 owner 锁定**
> 直接上游：
> - `docs/plan-worker-matrix.md` §7 Q1c(A1-A5 sub-PR 边界给 owner 最终自由度)
> - `docs/design/worker-matrix/D01-agent-core-absorption.md`(A1-A5 聚合设计)
> - `docs/design/worker-matrix/blueprints/{A2,A3,A4,A5}-...-absorption-blueprint.md`(4 份 P0 补齐 blueprint)
> - `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md`(A1 代表 blueprint)
> 相关原始素材：
> - `packages/{session-do-runtime,agent-runtime-kernel,llm-wrapper,hooks,eval-observability}/` 五个源包的 LOC + 耦合事实
> - `workers/agent-core/src/` 当前 shell(W4 已建)

---

## 1. 这个 blueprint 解决什么问题

1. charter §5.3 / §7 Q1c 决定 A1-A5 可以 "**一次大 PR** 或 **2-3 sub-PR 序列**" 两种 execution 形态,由 P1.A kickoff PR 的 owner 最终锁定。但如果 owner 开 kickoff PR 时没有现成的 "可直接选一条执行路径" 方案,会在 kickoff 期被卡 1-2 天做对比。
2. 本 blueprint 提供 **3 种切分方案的对比表 + 每方案的风险 / 价值 / 预估时长 / merge 顺序建议**,让 owner 可在 kickoff PR 内直接选一条并背书。
3. **明确强调:本 blueprint 不拍板**。所有方案都符合 charter 的 A1-A5 交付约束(单 worker,agent-core);最终选择属于 owner 的 execution judgement。

---

## 2. 基础事实(5 个 unit 的 LOC / 耦合)

| Unit | 源 package | src LOC | test LOC | 跨包 dep | 与其它 A-unit 的耦合 |
|------|------------|---------|----------|----------|----------------------|
| A1 | `session-do-runtime`(host shell) | ~1800+ | ~1500+ | `@haimang/nacp-core`、`@haimang/nacp-session`、`@nano-agent/workspace-context-artifacts` | 消费 A2 `KernelRunner`;消费 A5 `TraceSink`;装配 A3 `LLMExecutor` / A4 `HookDispatcher` |
| A2 | `agent-runtime-kernel` | ~1659 | ~1358 | **零** | 被 A1 host 消费(`runner.ts`);`KernelDelegates` 由 A3/A4/A5 实装 |
| A3 | `llm-wrapper` | ~1483 | ~1638 | **零** | 实装 `KernelDelegates` 的 llm 侧;`PreparedArtifactRef` 与 D04 D1 slice 有类型 seam |
| A4 | `hooks` | ~1598 | ~2839 | `@haimang/nacp-core` | 实装 `KernelDelegates` 的 hooks 侧;`catalog.ts` 从 `@haimang/nacp-core` import wire vocab |
| A5 | `eval-observability` | ~2916 | ~3895 | **零** | 提供 `TraceSink` interface;A1 `BoundedEvalSink` 实装之 |

**关键观察**:
- A2 / A3 / A5 零跨包 runtime dep — 可以独立先行搬
- A1 host shell 依赖其他 4 者(kernel runner / llm executor / hook dispatcher / trace sink)
- B7 LIVE 5 tests 间接契约:A1 + A5 的 `BoundedEvalSink ↔ TraceSink` end-to-end — **A5 先合并,A1 后合**可让契约自动保持
- A3 的 `PreparedArtifactRef` 与 D04(filesystem-core)有类型 seam,不影响 agent-core 内部 sub-PR 顺序

---

## 3. 三种切分方案

### 方案 1 — 单大 PR(A1-A5 整组)

| 维度 | 值 |
|------|-----|
| PR 数量 | **1** |
| LOC diff 规模(src+test)| ~23000(5 个 package 全搬)|
| 并发 review | 不可能 — 所有改动集中在一份 PR |
| merge 复杂度 | 单次 merge;回滚只需 revert 一次 |
| B7 LIVE 协调 | 自动 — A1 + A5 同时到位 |
| 适合谁 | execution-speed 优先 / owner 只有单一 review cycle 窗口 |

**优点**:
- 单次 deploy/验证;不存在共存期两份 kernel / eval 的 drift
- A1 的 BoundedEvalSink ↔ A5 TraceSink 契约单步达成
- PR body 可以一次性 reference 全部 blueprints

**缺点**:
- review 负担集中;review 周期可能 3-5 天
- 若 B7 LIVE 中途红,diagnose scope 大
- 不利于 peer review 分工

**预估时长**:执行 3-5 工作日;review 3-5 天;合计 ~2 周

---

### 方案 2 — 2 sub-PR 分离(A1 host shell vs. A2-A5 kernel+delegates)

| 维度 | 值 |
|------|-----|
| PR 数量 | **2** |
| sub-PR 1 | A2 + A3 + A4 + A5(kernel + 3 delegates + eval)— ~15000 LOC |
| sub-PR 2 | A1 host shell(session-do-runtime)— ~5000 LOC + 切换 kernel / delegate / sink 的 import 路径 |
| 并发 review | 中 — sub-PR 1 / sub-PR 2 可串行 review |
| merge 顺序 | **严格**:sub-PR 1 先合 → sub-PR 2 后合 |
| 共存期 | sub-PR 1 merge 后到 sub-PR 2 merge 前,host 仍 import 旧 `@nano-agent/...` 包;共存期 ≤ 1-2 天 |
| B7 LIVE 协调 | sub-PR 2 PR body 附 "B7 LIVE 5 tests 全绿" 证据 block |
| 适合谁 | 平衡 review 负担与 共存期 风险 |

**优点**:
- sub-PR 1 零跨包 dep 全吸收;sub-PR 2 只做 host shell + import 切换
- sub-PR 2 规模小,review 快
- 共存期短(2 sub-PR 同一 sprint 内完成)

**缺点**:
- 需要严格 merge 顺序 — 若 sub-PR 2 在 sub-PR 1 之前合,A1 会 import 不存在的 workers 路径
- sub-PR 1 仍大(~15000 LOC)— 仍然需要 3-5 天 review
- B7 LIVE 在 sub-PR 1 合并瞬间可能临时红(A1 未切换);需 sub-PR 1 PR body 明确 "acceptable drift window"

**预估时长**:sub-PR 1 ~3 天执行 + 3 天 review;sub-PR 2 ~1 天执行 + 1 天 review;合计 ~1.5 周

---

### 方案 3 — 3 sub-PR 递进(A5 先 / A2+A3+A4 / A1 后)

| 维度 | 值 |
|------|-----|
| PR 数量 | **3** |
| sub-PR 1 | A5 eval-observability(含 TraceSink interface)— ~6800 LOC |
| sub-PR 2 | A2 kernel + A3 llm + A4 hooks(3 delegates)— ~11000 LOC |
| sub-PR 3 | A1 host shell — ~3000 LOC + 全量 import 切换 |
| 并发 review | 高 — sub-PR 1 / sub-PR 2 可并行准备,sub-PR 3 串行 |
| merge 顺序 | **严格**:sub-PR 1 先 → sub-PR 2 → sub-PR 3 |
| 共存期 | sub-PR 1 和 sub-PR 2 间 BoundedEvalSink 仍消费旧 A5(共存期几乎无风险,`TraceSink` interface shape byte-identical);sub-PR 2 和 sub-PR 3 间 host shell 仍消费旧 A2/A3/A4(共存期 ≤ 2-3 天)|
| B7 LIVE 协调 | sub-PR 1 合并后必验;sub-PR 3 合并前必验 |
| 适合谁 | review 分工精细 / 希望 B7 LIVE 在每步后都可独立 probe |

**优点**:
- sub-PR 1 A5 先合 — `TraceSink` interface 先 landing;BoundedEvalSink(A1)仍消费旧位置但 interface 不变,B7 LIVE 继续绿
- sub-PR 2 A2+A3+A4 可并行准备(A2/A3 零 dep;A4 需 `@haimang/nacp-core`;但三者与 A1 / A5 无直接 sub-PR-level 耦合)
- sub-PR 3 最小(只 host shell + import 切换)
- review 负担最均匀;每步都可独立 revert

**缺点**:
- PR 数量多(3 份);owner review 开销增加
- merge window 拉长(3 次 merge cycle ≈ 1.5-2 周)
- 需要 3 次 PR body 的 B7 LIVE 证据 block

**预估时长**:sub-PR 1 ~3 天 + 2 天 review;sub-PR 2 ~4 天 + 3 天 review;sub-PR 3 ~1 天 + 1 天 review;合计 ~2 周

---

### 3.4 方案对比速查表

| 维度 | 方案 1(1 PR)| 方案 2(2 PR)| 方案 3(3 PR)|
|------|---------------|---------------|---------------|
| PR 数 | 1 | 2 | 3 |
| 最大单 PR LOC | ~23000 | ~15000 | ~11000 |
| review 分工 | 差 | 中 | 好 |
| 共存期风险 | 无 | 低 | 低 |
| B7 LIVE 协调复杂度 | 低 | 中 | 中-高 |
| owner 工作总时长 | ~2 周 | ~1.5 周 | ~2 周 |
| 可回滚粒度 | 粗(只能全回滚)| 中(可回滚 sub-PR 2)| 细(可回滚任 1 份)|
| 推荐优先级 | P2 | **P1** | P2 |

**默认推荐**:**方案 2(2 sub-PR)**。理由:
1. sub-PR 1 把所有零跨包 dep 或与 A1 弱耦合的 unit 一次搬完,最大化机械吸收效率
2. sub-PR 2 只做 host shell + import 切换,review 快,可在 sub-PR 1 merge 后 1-2 天内 ship
3. 共存期短;B7 LIVE 只需在 sub-PR 2 合并时验证一次
4. 适合 worker-matrix 的 P1.A 预算(~1.5 周)

**但**:方案 1 / 方案 3 都合法 — 由 P1.A owner 按实际 bandwidth / review cycle 锁定。

---

## 4. P1.A kickoff PR 的最终锁定职责

P1.A kickoff PR body 必须包含:

- [ ] 锁定方案选择(方案 1 / 方案 2 / 方案 3)
- [ ] sub-PR 编号映射(若选方案 2 或方案 3,列出每份 sub-PR 包含哪些 A-unit)
- [ ] merge 顺序(若 > 1 PR,列出严格顺序)
- [ ] B7 LIVE 5 tests 证据 block 的计划(哪个 sub-PR 附,验证 baseline)
- [ ] 共存期 window 声明(若 > 1 PR,声明 sub-PR i merge 后多少天内必须 ship sub-PR i+1)
- [ ] owner 姓名 / role 背书

**P0 blueprint 的职责到此为止** — 不替代 owner 的 execution judgment。

---

## 5. 风险与禁止事项

### 5.1 全方案通用风险

1. **`KernelDelegates` interface shape 被中途改**:无论方案 1/2/3,A2 kernel 的 delegates interface 必须在 sub-PR 序列内保持 byte-identical;一旦某 sub-PR 改 shape,后续 sub-PR 的 import 会硬崩
2. **共存期超预算**:若选方案 2/3,sub-PR i 与 sub-PR i+1 间隔超过 1 周,旧 `@nano-agent/*` Tier B 包与新 `workers/agent-core/src/` 并存期 bug 会开始分叉 — 必须定期 sync
3. **B7 LIVE 红 window**:方案 2/3 的合并瞬间可能有几分钟 B7 LIVE 红;需在 PR body 明确 "acceptable drift window"
4. **`TraceSink` interface 被误改**:A5 作为 first sub-PR(方案 3)搬家时必须保持 interface shape;否则 BoundedEvalSink 会硬崩

### 5.2 全方案通用禁止

1. 任一 sub-PR 内 refactor public API(kernel / llm executor / hook dispatcher / trace sink / host shell)
2. 任一 sub-PR 内新增 wire vocabulary
3. 任一 sub-PR 内 bump 版本号(归 D08 / D09)
4. 任一 sub-PR 内删除 `packages/{session-do-runtime,agent-runtime-kernel,llm-wrapper,hooks,eval-observability}/`(归 D09)

---

## 6. 收口证据

1. **方案 1/2/3 的 LOC + PR 数 + review 时长 + B7 LIVE 协调复杂度表格**(§3.4)
2. **默认推荐方案 2 的理由**(§3.4)
3. **P1.A kickoff PR body 必须包含的 6 项 checklist**(§4)
4. **全方案通用风险与禁止事项**(§5)

---

## 7. 一句话 verdict

A1-A5 sub-PR granularity 是 **owner execution judgment call**;本 blueprint 提供 3 种方案的对比(1 PR / 2 PR / 3 PR)+ 默认推荐(方案 2);最终锁定由 P1.A kickoff PR 内的 owner 决定并背书。无论选哪条路径,`KernelDelegates` / `TraceSink` / host shell 的 interface shape 必须 byte-identical,B7 LIVE 5 tests 必须在最终 merge window 内保持绿。
