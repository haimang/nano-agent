# Cross-Package Test Suite 02

> 版本: `v0.1`
> 日期: `2026-04-18`
> 作者: `GPT-5.4`
> 范围: `packages/*` + `test/*` 在 after-skeleton 阶段后的测试升级与新增计划
> 更新说明: `基于 A1-A10 code review、当前 root/e2e/package tests reality 与 after-skeleton 收口缺口，提出 suite-02：先升级现有测试，再新增一批直接对应 blocker 的独立测试与跨包 E2E/verification 测试`
> 依据:
> - `docs/eval/cross-packages-test-suite-01.md`
> - `docs/code-review/after-skeleton/A1-reviewed-by-GPT.md`
> - `docs/code-review/after-skeleton/A2-A3-reviewed-by-GPT.md`
> - `docs/code-review/after-skeleton/A4-A5-reviewed-by-GPT.md`
> - `docs/code-review/after-skeleton/A6-A7-reviewed-by-GPT.md`
> - `docs/code-review/after-skeleton/A8-A10-reviewed-by-GPT.md`
> - `test/*.test.mjs` + `test/e2e/*.test.mjs`
> - `packages/*/test/**/*.ts`
> - `context/just-bash/README.md`
> - `context/claude-code/services/tools/toolExecution.ts`
> - `context/codex/codex-rs/tools/src/tool_registry_plan.rs`
> - `context/mini-agent/mini_agent/tools/bash_tool.py`

---

## 0. 综述

`cross-packages-test-suite-01.md` 完成的是 **skeleton 时代的第一轮跨包 E2E 定义**：它先把最核心的 14 条 E2E 链路和一组 root contract suites 建出来，让 nano-agent 至少拥有“像一个 agent 一样跑起来”的测试骨架。

但 after-skeleton 这 10 个阶段走完并经过独立 code review 之后，项目的测试重心已经变了：

1. **问题不再是“完全没有测试”**，而是 **测试已经很多，但有些 guard 只守住 helper/factory，没有守住 live runtime path**。
2. **问题不再是“缺少 E2E 名字”**，而是 **部分现有 E2E / smoke / contract 已经落后于真实 blocker**，需要升级断言强度。
3. **问题不再是“要不要测 fake bash”**，而是 **A8-A10 已经有真实 minimal bash contract，需要把 review 中确认的 correctness gap 变成永不回退的回归测试**。

因此，`suite-02` 的目标不是重写 `suite-01`，而是做一轮 **after-skeleton refresh**：

- **先升级现有 root / package / e2e / verification tests**
- **再补一批 directly review-driven 的新测试**
- **最后把 root contract、E2E、verification 三层 gate 的执行顺序重新排好**

### 0.1 当前测试基线快照

以当前仓库为准：

| 维度 | 当前数量 | 说明 |
|------|----------|------|
| root 独立测试 (`test/*.test.mjs`) | `14` | contract / smoke / verification wrapper |
| root E2E (`test/e2e/e2e-*.test.mjs`) | `14` | `E2E-01` 到 `E2E-14` |
| package test files | `158` | 分布在 10 个包内 |
| 最大 package test 集 | `24` | `capability-runtime` |
| 第二大 package test 集 | `23` | `session-do-runtime` |
| 第三大 package test 集 | `22` | `eval-observability` |

当前数量已经不小，说明 suite-02 的重点应是 **“提高真相密度”**，而不是单纯继续堆数量。

### 0.2 suite-02 的核心目标

1. **把 after-skeleton code review 中确认的 blocker 全部映射成测试项**
2. **把 helper/factory/fixture 级测试升级成 runtime-path 级测试**
3. **把 docs-backed truth（如 session registry、capability inventory）纳入 drift guard，而不是只锁死硬编码 fixture**
4. **让 root contract、E2E、verification 三层 gate 各自承担不同责任，不再互相冒领覆盖范围**

### 0.3 suite-02 的设计原则

1. **review-driven**：每个升级/新增测试都必须能指回 A1-A10 某条真实 review finding。
2. **no fake closure**：如果一个测试只证明 helper 或 fake fixture 可用，文案里必须明确说它不是 live runtime closure。
3. **one claim, one guard**：凡是 action-plan / appendix / inventory / report 声称“已冻结/已闭合”的地方，都需要有对应 guard。
4. **runner honesty**：root commands 要准确反映实际覆盖范围，不能再出现 `test:cross` 实际只跑一半，但日志声称全跑了。
5. **value-tied**：所有新增测试都必须回答一种价值：`稳定性 / 上下文管理 / seam治理 / fake-bash真相 / deploy-shaped验证`。

---

## 1. after-skeleton 阶段的测试缺口矩阵

| 阶段 | 当前已有测试优势 | 当前主要缺口 | suite-02 要补什么 |
|------|------------------|--------------|-------------------|
| A1 | core/session rename + compat tests 已存在 | 公共版本/registry/docs 出口缺少长期 drift guard | root doc-sync / generated-registry drift tests |
| A2-A3 | trace contract / audit codec / inspector tests 已有 | runtime orchestration 可绕过 trace builder；benchmark harness shape 旧；`test:cross` 覆盖口径失真 | root trace runtime contract 升级 + benchmark harness guard + command gate |
| A4-A5 | ingress、controllers、remote adapters、fake workers 已有 | `pendingInputs` 无 drain；WS helper 未成主路径；remote composition 未进入 live runtime；cross-seam headers 是 dead code | session-do runtime integration tests + remote seam E2E |
| A6-A7 | verification ladder、smoke specs、evidence helpers 已有 | L1/L2 仍主要证明 harness/fixture；evidence emitters 未进入 live runtime | deploy-shaped smoke 升级 + live evidence loop |
| A8-A10 | minimal bash 主骨架已存在，package tests 很密 | grep alias 过窄、rg 漏扫 dot-dir、curl byte cap 漂移、inventory drift guard 不看 docs | package regression upgrades + minimal-bash cross-package turn |

---

## 2. 现有独立测试升级计划

本节只讨论 **现有 test/ 目录与 package tests 的升级**，不新增文件名。

### 2.1 root 独立测试升级

| 当前文件 | 当前价值 | 升级原因 | suite-02 升级要求 | 优先级 |
|----------|----------|----------|-------------------|--------|
| `test/trace-first-law-contract.test.mjs` | 守住 trace law contract | 当前只测 builder/codec/helper，自身没有把 `SessionOrchestrator` 的 live emission 纳入 | 新增 `SessionOrchestrator` 真实 emission 路径断言：`turn.begin / turn.end / session.end` 必须走 canonical builder，`session.ended` 不允许再出现 | `P0` |
| `test/observability-protocol-contract.test.mjs` | 守住 inspector/audit/session 形状 | 当前缺少 benchmark harness / README 示例 shape 的现实约束 | 增加对 benchmark fixture/exported examples 的 shape guard，避免 scripts/tests 与 src reality 脱节 | `P1` |
| `test/external-seam-closure-contract.test.mjs` | 守住 binding catalog / fake worker round-trip | 当前主要证明 adapter/factory，不证明 live runtime path 消费 remote handles | 增加：`buildCrossSeamHeaders()` 真的进入请求头；composition/runtime default path 真消费 remote factory 产物 | `P0` |
| `test/l1-smoke.test.mjs` | L1 smoke wrapper | 当前只证明本地 harness 可绿，不证明 remote-dev-l1 | 拆清 `local-l0-harness` 与 `remote-dev-l1`；`baseUrl` 存在时必须验证真实转发而不是只看 `localFallback` flag | `P0` |
| `test/l2-smoke.test.mjs` | L2 smoke wrapper | 当前只证明“缺 env 时会红”，不证明 real provider golden path | 新增 real path 断言：provider 输出、trace、profile 不能还是 `local` | `P0` |
| `test/verification-runner.test.mjs` | 守住 gate bundle / ladder mechanics | 当前没有明确守住 `local-l0 / remote-dev-l1 / deploy-smoke-l2` 三等级区别 | 增加 ladder classification tests，禁止不同证据等级继续混写成同一类 green | `P1` |
| `test/capability-toolcall-contract.test.mjs` | 守住 capability-runtime ↔ nacp-core shape | 当前对 minimal bash 新 contract（grep narrow、curl structured-only、git subset）覆盖不足 | 增加 capability-level shape regression：`grep -i/-n`、structured curl、git subset、ts-exec partial marker | `P1` |
| `test/kernel-session-stream-contract.test.mjs` | 守住 runtime event → session stream mapping | 当前没守住 A4 helper 主路径与 A7 evidence path | 增加 `helper.pushEvent()` / `timeline` / `resume replay` 对同一事件集的等价断言 | `P0` |

### 2.2 package tests 升级

| 当前文件 | 当前问题 | suite-02 升级要求 | 对应 review |
|----------|----------|-------------------|-------------|
| `packages/capability-runtime/test/planner-grep-alias.test.ts` | 把 `grep -i` 也当作 reject case | 改成：接受 `-i/-n`，拒绝其余 flags，并断言 canonical input 对齐 `rg` | A8 R1 |
| `packages/capability-runtime/test/capabilities/search-rg-reality.test.ts` | 只测 fake workspace，没守住 dot-directory | 增加 `.config/`、`foo.bar/`、无扩展名文件/目录混排 case；最好增加一组真实 `WorkspaceNamespace` substrate regression | A8 R2 |
| `packages/capability-runtime/test/capabilities/network-egress.test.ts` | 只测 ASCII truncation | 增加 multibyte body case，按 UTF-8 bytes 而不是 JS 字符数断言 | A9 R3 |
| `packages/capability-runtime/test/inventory-drift-guard.test.ts` | 只锁常量 fixture，不锁文档 | 增加对 `PX-capability-inventory.md` 或 checked-in inventory fixture 的 parse/assert | A10 R4 |
| `packages/capability-runtime/test/capabilities/ts-exec-partial.test.ts` | 只测 handler，不测主路径 marker 是否丢失 | 增加跨 planner/bridge/executor/handler 的 integration 断言，确保 `ts-exec-partial-no-execution` 不会在主路径丢失 | A8-A10 follow-up |
| `packages/session-do-runtime/test/do/nano-session-do.test.ts` | 对 `pendingInputs` 只做弱断言 | 改成强断言：`turn_running -> queue -> current turn end -> next turn start` 必须真的发生 | A4 R1 |
| `packages/session-do-runtime/test/integration/ws-http-fallback.test.ts` | 当前还没证明 helper 是 live truth | 增加 helper attach / pushEvent / timeline / resume 读同一 replay buffer 的强断言 | A4 R2 |
| `packages/session-do-runtime/test/remote-bindings.test.ts` | 只测 factory/fixture round-trip | 增加 headers propagation、runtime consumer path、no-local-fallback assertions | A5 R3/R4 |
| `packages/eval-observability/test/scripts/trace-substrate-benchmark.test.ts` | fixture shape 旧，且没守住 `_index` fallback 真假 | 增加 canonical `TraceEventBase` shape、`no-list()` double、Q5 latency 口径降级/显式标注 | A2 R2/R3 |
| `packages/workspace-context-artifacts/test/evidence-emitters.test.ts` | 只测 helper shape | 增加 owner package integration entry expectations，至少守住 emitted record 必须能进入 recorder/sink | A7 R4 |

---

## 3. 现有跨包 E2E / verification 测试升级计划

本节讨论 **现有 `test/e2e/` 与 `test/verification/`** 的升级，而不是新编号。

| 当前测试 | 当前状态 | suite-02 升级方向 | 优先级 |
|----------|----------|-------------------|--------|
| `test/e2e/e2e-07-workspace-fileops.test.mjs` | 当前只到 `mkdir/write/cat/ls`，且 `mkdir` 只检查返回成功 | 升级为 `workspace + search` 基线：加入 `rg`、`grep -i/-n`、reserved namespace、`mkdir-partial-no-directory-entity` marker | `P0` |
| `test/e2e/e2e-09-observability-pipeline.test.mjs` | 当前更多证明 sink/timeline/audit 组合存在 | 升级为真正的 runtime-source test：要求事件来自 kernel/session-do builders，而不是手工拼 payload；增加 `session.end` | `P1` |
| `test/e2e/e2e-11-ws-replay-http-fallback.test.mjs` | 目前是可运行 E2E，但还没有守住 helper 主路径真相 | 升级为 A4 gate：HTTP timeline / WS replay / last_seen_seq 必须来自同一 helper truth | `P0` |
| `test/e2e/e2e-12-dirty-resume.test.mjs` | 当前已覆盖 dirty resume 雏形 | 增加 “pending tool only executes once” 和 “pendingInputs queue 不丢不重放” 断言 | `P0` |
| `test/e2e/e2e-14-hooks-resume.test.mjs` | 当前守住 hooks snapshot/restore | 升级为 aggregated outcome + runtime consumer path：block/updatedInput 不能只在 hooks 包内成立，kernel 必须消费同一结果 | `P1` |
| `test/verification/smokes/l1-session-edge.smoke.ts` | 仍主要证明本地 harness | 升级为双模 smoke：`baseUrl` 存在时走真实 remote-dev-l1，否则明确标记仅为 local-l0 | `P0` |
| `test/verification/smokes/l1-external-seams.smoke.ts` | 仍是 in-process fake binding round-trip | 拆成 `fixture-smoke` 与 `remote-seam-smoke` 两类，避免当前名字继续冒领 deploy-shaped seam | `P0` |
| `test/verification/smokes/l2-real-provider.smoke.ts` | 真实路径只看 `/start => 200` | 升级为 real provider output / trace / model route smoke，禁止“provider=local 也算 real-cloud green” | `P0` |
| `test/verification/smokes/gate.ts` | gate bundle 存在，但 handoff 只是 pointer-only | 增加 `handoff consumer/schema` 校验，明确 synthetic bundle 与 real-boundary bundle 的等级 | `P1` |

---

## 4. 新的独立测试提案

这一组测试是 **suite-02 新增的 standalone / package integration tests**，目标是把 review blocker 直接固化成 guard。

### ST-01: Session Registry / Public Version Doc Sync
> **readiness**: `ready`

- **建议文件**:
  - `test/session-registry-doc-sync.test.mjs`
- **范围**:
  - `packages/nacp-session/src/version.ts`
  - `packages/nacp-session/README.md`
  - `docs/nacp-session-registry.md`
- **核心断言**:
  1. `NACP_SESSION_VERSION` 与 registry doc 标题一致
  2. registry doc 的 kind 数量与 exported session kinds 一致
  3. `session.followup_input` 不能再次从 README / generated doc 消失
- **为什么要加**:
  - A1 的问题本质是 exit pack drift；这类问题不能只靠 reviewer 肉眼回看。

### ST-02: Trace Runtime Builder Guard
> **readiness**: `ready`

- **建议文件**:
  - `packages/session-do-runtime/test/integration/orchestration-trace-builder.test.ts`
- **范围**:
  - `session-do-runtime`
  - `eval-observability`
- **核心断言**:
  1. `SessionOrchestrator` 发出的 `turn.begin / turn.end / session.end` 全都 trace-law compliant
  2. `session.ended` 这种非 canonical kind 直接失败
  3. sink 前必须经过 builder/validator，而不是原样转发 `unknown`
- **为什么要加**:
  - A2/A3 的 blocker 不在 helper，而在 live orchestration path。

### ST-03: Benchmark Harness Shape + `_index` Fallback Guard
> **readiness**: `ready`

- **建议文件**:
  - `packages/eval-observability/test/scripts/trace-substrate-benchmark-contract.test.ts`
- **核心断言**:
  1. benchmark fixture 必须使用 canonical `TraceEventBase`
  2. 验证 `_index` fallback 时必须使用 **无 `list()` 能力** 的 storage double
  3. 文档/runner 不得再把 package-local timing 写成 real DO `p50/p99` closure
- **为什么要加**:
  - A2 的问题是 evidence pack 被说重，不是 runner 不存在。

### ST-04: Follow-up Queue Drain Contract
> **readiness**: `ready`

- **建议文件**:
  - `packages/session-do-runtime/test/integration/followup-queue-drain.test.ts`
- **核心断言**:
  1. `pendingInputs` 在当前 turn 结束后被 FIFO 消费
  2. queued input 只能执行一次
  3. cancel / resume 后 queue 行为仍一致
- **为什么要加**:
  - A4 当前最大 correctness gap 就是“只有入队，没有出队”。

### ST-05: WebSocket Helper Live Path Contract
> **readiness**: `phase-gated`

- **建议文件**:
  - `packages/session-do-runtime/test/integration/ws-helper-live-path.test.ts`
- **核心断言**:
  1. socket attach 到 helper
  2. outbound session events 统一经 `helper.pushEvent()`
  3. HTTP timeline / resume replay 都读到同一事件集
- **为什么要加**:
  - A4 的 replay/timeline/resume 目前没有共享真相源。

### ST-06: Remote Binding Header Propagation Contract
> **readiness**: `ready`

- **建议文件**:
  - `packages/session-do-runtime/test/integration/remote-binding-header-propagation.test.ts`
- **核心断言**:
  1. hook/capability/provider 请求都带 `traceUuid + sessionUuid + teamUuid + requestUuid`
  2. 缺 header 时分类为 seam failure，而不是 silent fallback
  3. fake worker 能回显并验证 anchor
- **为什么要加**:
  - A5 的 `buildCrossSeamHeaders()` 现在还是 dead code 候选。

### ST-07: Live Evidence Emission Contract
> **readiness**: `phase-gated`

- **建议文件**:
  - `packages/eval-observability/test/integration/live-evidence-emission.test.ts`
- **范围**:
  - `workspace-context-artifacts`
  - `eval-observability`
  - `session-do-runtime`
- **核心断言**:
  1. business action 触发 `assembly / compact / artifact / snapshot / placement` evidence
  2. recorder/sink/aggregate 读到的是 runtime emit，而不是手工 `recorder.emit()`
  3. verdict 可被后续 consumer 使用
- **为什么要加**:
  - A7 的缺口是 live runtime wiring，不是 helper vocabulary。

### ST-08: Capability Inventory Doc Guard
> **readiness**: `ready`

- **建议文件**:
  - `packages/capability-runtime/test/inventory-doc-sync.test.ts`
- **核心断言**:
  1. `PX-capability-inventory.md` 中 12-pack、policy、git subset 与 registry/taxonomy 一致
  2. `grep` alias、`mkdir` partial、`curl/ts-exec/git` 等 grade 不能只改代码不改文档
  3. 若采用 checked-in fixture，则 fixture 与 docs 双向校验
- **为什么要加**:
  - A10 的 drift guard 目前只锁代码常量，没有锁文档真相。

---

## 5. 新的跨包 E2E / verification 测试提案

`suite-01` 已有 `E2E-01` 到 `E2E-14`，因此 suite-02 继续从 `E2E-15` 编号。

### E2E-15: Follow-up Queue Drain — `turn_running -> queue -> next turn`
> **readiness**: `ready`

#### 5.1 跨包列表
`session-do-runtime` → `agent-runtime-kernel` → `nacp-session`

#### 5.2 核心场景
1. 当前 turn 正在运行
2. 第二个 user input 进入 `pendingInputs`
3. 当前 turn 结束后，队列中的 follow-up 自动开启下一个 turn
4. `turnCount`、stream events、checkpoint 都反映这一事实

#### 5.3 核心断言
- queued input 被消费且只消费一次
- 新 turn 真的开始，而不是永远留在 actor state
- checkpoint / resume 后队列语义不漂移

#### 5.4 对应 blocker
- A4 R1

---

### E2E-16: Helper-backed Session Stream Truth — WS / Replay / HTTP Timeline 一致
> **readiness**: `phase-gated`

#### 5.1 跨包列表
`session-do-runtime` → `nacp-session` → `eval-observability`

#### 5.2 核心场景
1. 真实 turn 产生一串 session stream events
2. 这些 events 统一通过 `SessionWebSocketHelper.pushEvent()` 发出
3. 客户端 ack 一部分后断线
4. `session.resume(last_seen_seq)` 与 HTTP timeline 恢复出同一结果

#### 5.3 核心断言
- replay 只补缺失区间，不重复已 ack 数据
- HTTP timeline 不混入 live-only / helper-external 数据
- helper replay buffer 是唯一 truth

#### 5.4 对应 blocker
- A4 R2

---

### E2E-17: Remote Composition Turn — default Worker/DO path 真正消费 remote handles
> **readiness**: `phase-gated`

#### 5.1 跨包列表
`session-do-runtime` → `hooks` → `capability-runtime` → `llm-wrapper`

#### 5.2 核心场景
1. Worker 提供 `HOOK_WORKER / CAPABILITY_WORKER / FAKE_PROVIDER_WORKER`
2. DO 启动时选择 remote composition profile
3. 一个真实 turn 分别命中 remote hook / remote capability / remote provider
4. 中间不允许 silent local fallback

#### 5.3 核心断言
- profile flip 不是只停在 factory，而是真进入 runtime handles
- remote 请求带完整 cross-seam headers
- event / trace 中能分辨 seam 来源

#### 5.4 对应 blocker
- A5 R3 / R4

---

### E2E-18: Remote-dev L1 Session Edge Smoke
> **readiness**: `env-gated`

#### 5.1 范围
`test/verification/smokes/remote-dev-l1-session-edge.smoke.ts`

#### 5.2 核心场景
1. 提供 `NANO_AGENT_WRANGLER_DEV_URL`
2. `WorkerHarness` 或后继 remote runner 真正通过网络请求远端 worker
3. `baseUrl` 不再只是字符串标签

#### 5.3 核心断言
- 远端 path 被消费
- `profileLadder` = `remote-dev-l1`
- 输出 bundle 与本地 harness bundle 明确区分

#### 5.4 对应 blocker
- A6 R1

---

### E2E-19: Real Provider Golden Path — provider output + trace，而不是 `/start => 200`
> **readiness**: `env-gated`

#### 5.1 跨包列表
`session-do-runtime` → `llm-wrapper` → `eval-observability`

#### 5.2 核心场景
1. 提供 real provider env
2. session.start 触发真实 provider call
3. 返回可识别输出（文本/stream delta/trace）

#### 5.3 核心断言
- provider 不再是 `local`
- 输出内容与 trace 可被识别
- golden model route 真正发生

#### 5.4 对应 blocker
- A6 R3

---

### E2E-20: Live Evidence Loop — Business Action → Emitters → Recorder/Sink → Verdict
> **readiness**: `phase-gated`

#### 5.1 跨包列表
`workspace-context-artifacts` → `eval-observability` → `session-do-runtime` → `storage-topology`

#### 5.2 核心场景
1. 一条真实业务链路发生 compact / artifact promotion / snapshot / placement
2. owner package 的 runtime entry 直接触发 emitters
3. recorder/sink 聚合后产出 verdict
4. 下游 consumer 读取该 verdict / handoff bundle

#### 5.3 核心断言
- evidence 来源于 runtime action，不是手工组装
- `aggregateEvidenceVerdict()` 真能消费 live evidence
- `p6-handoff` 不再只是 pointer-only

#### 5.4 对应 blocker
- A7 R4 / R5

---

### E2E-21: Minimal Bash Session Turn — Search / Network / VCS 真相进入 session stream
> **readiness**: `ready`

#### 5.1 跨包列表
`agent-runtime-kernel` → `capability-runtime` → `workspace-context-artifacts` → `session-do-runtime` → `nacp-session` → `eval-observability`

#### 5.2 核心场景
1. fake LLM 依次请求 `grep -i`, `rg`、`curl`、`git status`
2. workspace 中含 `.config/`、`foo.bar/` 等路径
3. network 返回 multibyte body
4. git/status 与 inventory/prompt disclosure 一起进入结果流

#### 5.3 核心断言
- `grep -i/-n` 走 canonical `rg`
- `rg` 不漏扫 dot-directories
- `curl maxOutputBytes` 真按 UTF-8 bytes 工作
- `git` 仍只允许 `status/diff/log`
- session stream / trace 中保留 typed partial markers

#### 5.4 对应 blocker
- A8 R1 / R2 / A9 R3 / A10 R4

---

## 6. 执行顺序与 gate 重排

### 6.1 建议的测试推进顺序

| Phase | 目标 | 测试集合 |
|-------|------|----------|
| Phase 1 | 先修 runner honesty 与 docs-backed truth | ST-01, ST-03, ST-08 + root command matrix 调整 |
| Phase 2 | 收紧 trace/session runtime glue | ST-02, ST-04, ST-05, E2E-15, E2E-16 |
| Phase 3 | 收紧 remote seam / deploy-shaped verification | ST-06, E2E-17, E2E-18, E2E-19 |
| Phase 4 | 收紧 live evidence loop | ST-07, E2E-20 |
| Phase 5 | 收紧 minimal bash correctness | package test upgrades + E2E-21 + E2E-07 升级 |

### 6.2 建议的命令层重排

`suite-02` 建议把根级 gate 从单一 `test:cross` 拆成三层：

| 命令 | 责任 |
|------|------|
| `test:contracts` | 跑 `test/*.test.mjs`，守 root contract / smoke wrapper / protocol reality |
| `test:e2e` | 跑 `test/e2e/e2e-*.test.mjs` |
| `test:verification` | 跑 `test/verification/**` 对应的 node wrapper / gate checks |
| `test:cross` | 显式串联 `test:contracts && test:e2e && test:verification`，不再使用会丢 root suites 的 glob |

> **关键点**：suite-02 不是要求一定保留这 4 个命令名，而是要求 **默认 gate 的覆盖范围必须与文档和执行日志完全一致**。

---

## 7. suite-02 的完成标准

只有满足下面 5 条，suite-02 才算真正落地：

1. **现有 root/package/E2E tests 的升级项全部完成**
2. **新增 standalone tests 至少覆盖 A1/A2-A3/A4-A5/A6-A7/A8-A10 每组一个 blocker**
3. **新增 E2E/verification tests 至少补齐 session queue、WS helper、remote composition、live evidence、minimal bash truth 五类链路**
4. **root command coverage 与实际运行集合一致，不再出现脚本只跑一半但日志写全绿**
5. **suite-02 中所有 docs-backed guard 都不是只锁硬编码常量，而是至少能对拍真实文档或 generated artifact**

---

## 8. 结语

`suite-01` 解决的是 “nano-agent 有没有跨包测试骨架”；`suite-02` 要解决的是 **“这些测试骨架是否真的守住了 after-skeleton 阶段最关键的工程真相”**。

它的价值不在于再多造几份 `.test.ts`，而在于把 after-skeleton review 里已经确认的 4 类风险永久收口：

1. **runner/文档口径与真实覆盖范围不一致**
2. **helper/factory 测试冒领 live runtime closure**
3. **deploy-shaped / live-evidence / remote-seam 仍缺少真正的端到端证明**
4. **minimal bash 的 correctness / docs truth 还没有被 root-level guard 固化**

如果 suite-02 能落下去，那么 after-skeleton 阶段留下来的主要不确定性，就不再是“大家知道有问题，但靠 review 记忆去守”，而会变成 **“任何回退都会在 CI 里直接爆炸”**。

---

## 9. 与 suite-01 的关系说明

- `suite-01` **不废弃**：它仍然是 nano-agent 第一轮跨包 E2E 命名与价值映射的基础。
- `suite-02` **不重复列出原有 14 个 E2E 的完整正文**：只对需要升级的旧测试做 refresh，并补新增测试。
- 若未来进入下一阶段（post-after-skeleton implementation wave），建议再产出：
  - `cross-packages-test-suite-03.md`
  - 专门处理 **real cloud / real worker / real provider / real storage topology** 的 release-grade gate
