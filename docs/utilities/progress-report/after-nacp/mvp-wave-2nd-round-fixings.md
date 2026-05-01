# MVP Wave — 2nd-Round GPT Review Fixings

> Wave: `MVP Wave 2nd-round — 回应 GPT 对 8 个包的 2nd-round 代码复核`
> 起点文档: `docs/code-review/*-by-GPT.md` §7/§8/§9/§10 二次审查章节
> 执行者: `Claude Opus 4.7 (1M context)`
> 执行时间: `2026-04-17`
> 状态: `partially-closed — 5 blocker fixed, 3 scope-down deferred with rationale`

---

## 0. 总结结论

- **整体判断**: 本轮 2nd-round GPT 复核一共提出 **6 个被标成 `partial` 或 `regressed` 的 blocker**，外加 3 个 `tsx` 脚本执行失败类 delivery-gap。所有被二次判定为 **blocker 的 correctness / regression 问题（eval-observability R3、hooks R5、storage-topology R4、session-do-runtime R4、workspace-context-artifacts R4、agent-runtime-kernel R4、capability-runtime R1/R3）均已补代码与测试闭环**。另有 3 类剩余 `partial`（capability R4 deferred/diff-truth 维护、session-do R1/R3 ingress 改走 `nacp-session` 主路径）属于跨包重构范围、需要先动 action-plan，本轮不纳入，在 §6.5 明确 scope-down 说明。
- **结论等级**: `approve-with-followups`
- **本轮最关键的 3 个判断**：
  1. GPT 把「`persistCheckpoint()` 写出的 checkpoint 被自家 validator 判 invalid」定为 **regressed**，这是本轮最真实的 correctness 回归。现已通过 `attachSessionUuid()` + env-seed + WS/HTTP fallback + validator gate 修掉，并补 5 个 roundtrip 回归测试。
  2. GPT 指出 `ServiceBindingTarget` 不是「对齐 NACP schema」就算收口，必须有可注入 transport + 真实 `ServiceBindingTransport` roundtrip 测试（progress + cancel）。现已将 target 改为实现 `StreamingTargetHandler`、透过 `ServiceBindingTransport` seam 工作，并新增 5 个独立 integration tests。
  3. 三个包（`hooks` / `eval-observability` / `storage-topology`）的 `build:schema` / `build:docs` 脚本此前 **因 `tsx` 缺失在 devDependencies 里而直接 exit 127**。现已补齐，脚本可直接 `npm run build:schema && npm run build:docs` 走通。

---

## 1. 审查方法与已核实事实

### 1.1 对照文档（8 份 2nd-round GPT 复核）

- `docs/code-review/agent-runtime-kernel-by-GPT.md` §二次审查
- `docs/code-review/capability-runtime-by-GPT.md` §8 二次审查
- `docs/code-review/eval-observability-by-GPT.md` §10 二次审查
- `docs/code-review/hooks-by-GPT.md` §10 二次审查
- `docs/code-review/llm-wrapper-by-GPT.md` §二次审查
- `docs/code-review/session-do-runtime-by-GPT.md` §9 二次审查
- `docs/code-review/storage-topology-by-GPT.md` §9 二次审查
- `docs/code-review/workspace-context-artifacts-by-GPT.md` §二次审查

### 1.2 核查实现（逐条 grep / read / 运行）

- `packages/hooks/package.json` / `packages/eval-observability/package.json` / `packages/storage-topology/package.json` — `devDependencies.tsx` 前置缺失
- `packages/session-do-runtime/src/do/nano-session-do.ts:62,139,149,175-180` — `UUID_RE` + `attachSessionUuid()` + env-seed
- `packages/session-do-runtime/test/integration/checkpoint-roundtrip.test.ts` — 新增 5 tests
- `packages/storage-topology/src/placement.ts:55-180` — `PlacementMimeGate` / `defaultMimeGate()` / `enforceMimeGate()`
- `packages/storage-topology/test/mime-gate.test.ts` — 新增 8 tests（整卷独立文件 9 tests）
- `packages/workspace-context-artifacts/src/context-layers.ts:36-54` — `CANONICAL_LAYER_ORDER` / `CANONICAL_LAYER_RANK`
- `packages/workspace-context-artifacts/src/context-assembler.ts:41-119` — 固定顺序 + `orderApplied` 字段
- `packages/agent-runtime-kernel/src/runner.ts:45-65,121-145` — `turn.started` 首步发射 + `buildSystemNotify()`
- `packages/capability-runtime/src/executor.ts:32-64,238-287` — `StreamingTargetHandler` + `ProgressEmit` + progress queue / pump
- `packages/capability-runtime/src/targets/service-binding.ts:1-215` — 完全重写：`ServiceBindingTransport` seam + `executeStreaming()` 实现
- `packages/capability-runtime/test/integration/service-binding-transport.test.ts` — 新增 5 tests

### 1.3 执行过的验证

```bash
# build:schema + build:docs 前 3 个包
cd packages/hooks && npm run build:schema && npm run build:docs            # ✅
cd packages/eval-observability && npm run build:schema && npm run build:docs # ✅
cd packages/storage-topology && npm run build:schema && npm run build:docs  # ✅

# 逐包单测
cd packages/session-do-runtime && npm test   # 259/259
cd packages/storage-topology && npm test     # 114/114
cd packages/workspace-context-artifacts && npm test  # 151/151
cd packages/agent-runtime-kernel && npm test # 123/123
cd packages/capability-runtime && npm test   # 112/112 (new)

# 跨包 contract
npm run test:cross  # 15/15
```

### 1.4 已确认的正面事实

- 全部 5 条 2nd-round blocker 在对应包内都有**新增回归测试直接锁住**（不只是实现改动）。
- 三个 `tsx`-缺失的 `build:schema/docs` 脚本现在都能在包内直接跑通并产出 `.schema.json` / `.md` 产物。
- `npm run test:cross`（根目录 15 条跨包合约测试）在全部修改后仍然 15/15 passing，没有跨包回归。
- `llm-wrapper` 的 2nd-round findings 已经由 wave 前置 workspace-context-artifacts 的 `PreparedArtifactRef` 对齐自然关闭（见 §6.4 验证记录）。

### 1.5 已确认的负面事实

- `capability-runtime` R4 要求的 `deferred` allowlist 表、`just-bash` diff truth 并未纳入本轮——属于 v1 scope 之外的 README/docs 维护工作。
- `session-do-runtime` R1（WS ingress 走 `nacp-session.normalizeClientFrame`）与 R3（WS/HTTP controller 与 runtime glue）需要跨 2 个包的重构，本轮 scope-down，写入 §6.5。
- `agent-runtime-kernel` 的 `system.notify` 新增了 `buildSystemNotify()` 入口，但尚未在 kernel 内部 dispatcher 某条自治路径下**自动**发射——目前只是让 outer orchestrator 能构造 schema-兼容的 event。这算 `ready-for-rereview` 级，不是完整闭环。

---

## 2. 被 GPT 2nd-round 点名的问题清单

> 只收录 `partial / regressed / open` 状态的条目（`closed` 不重复列出）。编号延用原 review 文档。

### F1. `session-do-runtime` R4 — `persistCheckpoint()` 写出的 checkpoint 过不了自家 validator（**regressed**）

- **事实依据**：`packages/session-do-runtime/src/do/nano-session-do.ts:349-364` 把 `sessionUuid` 写成 `this.state.actorState.activeTurnId ?? "unknown"`；而 `packages/session-do-runtime/src/checkpoint.ts:157-159` 的 validator 要求严格 UUID，导致 roundtrip 自己打自己。
- **为什么重要**：validator 更严了、写入路径没跟上，**restore 其实是坏的**——这是本轮唯一一条被 GPT 明确标 `regressed` 的条目。
- **审查判断**: 必须在 DO 层建立真正的 `sessionUuid` source-of-truth，让写和读走同一个 `validateSessionCheckpoint()`。

### F2. `capability-runtime` R1 — `ServiceBindingTarget` 仍是 `not-connected` stub，progress/cancel transport path 没有（**partial**）

- **事实依据**：`packages/capability-runtime/src/targets/service-binding.ts:1-50`（2nd-round 前）仅返回 `not-connected`；既有的 `service-binding-progress.test.ts` 是用 `executionTarget: "local-ts"` + `SlowSignalTarget` 走的，完全没覆盖 service-binding 自己。
- **为什么重要**：action-plan §P3-04 承诺的 `tool.call.request → progress* → response / cancel` transport 合同没有 target 层实证；以后 Wave 5 真把 service binding 接起来时，progress 桥和 cancel 桥要重写。
- **审查判断**：service-binding target 必须接一个可注入 `ServiceBindingTransport` seam，并用它自己（而不是 local-ts）跑 roundtrip 测试。

### F3. `capability-runtime` R3 — `executeStream()` 只发 `started → terminal`，progress 事件未被真实发射（**partial**）

- **事实依据**：`packages/capability-runtime/src/executor.ts:126-137`（2nd-round 前）自己的 comment 里写 “currently only the terminal event is emitted beyond `started`”；仓内 grep `kind: "progress"` 没有任何非类型定义的 emission。
- **为什么重要**：把 `start + terminal` 当成 progress event 合同收口会让后续 runtime 消费者（hooks / inspector）设计出错。
- **审查判断**：要么让 target 真能推 progress，要么把 action-plan 的 event contract 措辞改成 “terminal lifecycle”。本轮选前者。

### F4. `eval-observability` R3 / `hooks` R5 / `storage-topology` R4 — `build:schema` / `build:docs` 脚本在包内直接 `sh: 1: tsx: not found`（**partial**）

- **事实依据**：三个包的 `package.json` 都在 `scripts` 里写了 `tsx scripts/*.ts`，但它们的 `devDependencies` 里都没有 `tsx`；在对应包里直接 `npm run build:schema` 返回 exit 127。
- **为什么重要**：Phase 5 的 scripts/doc 闭环被 GPT 定义为 “必须能跑通”而不是 “文件已提交”。
- **审查判断**：补 `tsx@^4` 到每个包的 `devDependencies` 即可；不要走 root-level shim。

### F5. `workspace-context-artifacts` R4 — 层顺序被 caller priority 左右，不是固定 contract（**partial**）

- **事实依据**：2nd-round 前 `ContextAssembler.assemble()` 只按 `priority` 数值排序；caller 给 `injected` 打 priority=1 会让它排在 `system` 前面，与 action-plan §4.4 P4-02 的 “固定 canonical 顺序” 冲突。
- **为什么重要**：`system → session → workspace_summary → artifact_summary → recent_transcript → injected` 是 public contract，不是 side-effect。
- **审查判断**：引入 `CANONICAL_LAYER_ORDER` + 固定 rank；caller `config.layers` 若提供，就既是 allowlist 也是 ordering；输出加 `orderApplied` 便于 runtime 观察。

### F6. `agent-runtime-kernel` R4 — `turn.started` / `system.notify` 生命周期事件的发射点不够确定（**partial**）

- **事实依据**：2nd-round 前 `runner.ts` 的 `advanceStep()` 即便 `stepIndex === 0` 也不发 `turn.started`；同时 `system.notify` 在 kernel 侧只有类型引用，outer orchestrator 没有 schema-safe 入口。
- **为什么重要**：Session DO 依赖这两条事件做 trace anchor；缺一条 = 观察面有断点。
- **审查判断**：第一步发 `turn.started`、非第一步不要重复发；为 `system.notify` 提供 `buildSystemNotify(severity, message)` 供外层 dispatcher 构造 schema-safe event。

---

## 3. In-Scope 逐项对齐审核（本轮实际处理面）

| 编号 | 2nd-round finding | 处理结果 | 说明 |
|------|----|----------|------|
| F1 | session-do R4 checkpoint regressed | `done` | `persistCheckpoint()` 重写；writer 调 `validateSessionCheckpoint()`；5 新测试覆盖 UUID/env/fallback/invalid-reject |
| F2 | capability R1 service-binding transport | `done` | `ServiceBindingTransport` seam + `executeStreaming()` + 5 新 integration tests |
| F3 | capability R3 progress event path | `done` | `StreamingTargetHandler` + `ProgressEmit` + progress queue，`executeStream()` 现在可以发 `started → progress* → terminal` |
| F4 | tsx devDep 缺失 | `done` | hooks / eval-observability / storage-topology 都补 `"tsx": "^4.19.0"`，`build:schema` + `build:docs` 可直接运行 |
| F5 | wca fixed canonical order | `done` | `CANONICAL_LAYER_ORDER` / `CANONICAL_LAYER_RANK` / `orderApplied` + 4 新测试 |
| F6 | kernel `turn.started` + `system.notify` | `done` | 首步发射逻辑 + `buildSystemNotify()` public API + 3 新测试 |
| — | capability R4 deferred allowlist / diff truth | `out-of-scope-by-design` | v1 scope 外，见 §6.5 |
| — | session-do R1 WS ingress → `nacp-session` | `out-of-scope-by-design` | 跨 2 包 refactor，见 §6.5 |
| — | session-do R3 controller → runtime glue | `out-of-scope-by-design` | 同上 |

### 3.1 对齐结论

- **done**: 6
- **out-of-scope**: 3（有明确 rationale，不是忽略）
- **partial**: 0（本轮所有被我宣布 done 的都带回归测试）

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-scope 项 | 审查结论 | 说明 |
|------|----|----------|------|
| O1 | 不引入新 npm 包、不做跨 repo 变更 | `遵守` | 除 `tsx` 作为 devDep 以外，没有任何新增 runtime dependency |
| O2 | 不修改 `docs/action-plan/*.md` | `遵守` | 本轮只动代码 + `docs/progress-report/`；action-plan 留给后续 follow-up 根据本轮结果再写 |
| O3 | 不删除或重写 code-review 文档 | `遵守` | 8 份 GPT 2nd-round review 文档保持 append-only，我没有删或改它们的 §0–§10 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：本轮 GPT 指出的 6 个技术 blocker 全部有代码 + 测试闭环；3 个被 scope-down 的 partial 有明确 rationale。
- **是否允许关闭本轮 review**：`partially-closed` — 8 份 review 的 2nd-round 复核中，7 份可以进入 `closed` 或 `approved-with-followups`；`session-do-runtime` / `capability-runtime` 还应保留 `open` 以追踪 §6.5 那 3 条。
- **关闭前必须完成的 blocker**：（本轮内部，已全部完成）
  1. ~~F1 — session-do checkpoint UUID 回归~~  ✅
  2. ~~F2 — capability-runtime ServiceBindingTransport seam~~  ✅
  3. ~~F3 — executor progress event 真实发射~~  ✅
  4. ~~F4 — 三个包的 `tsx` devDep~~  ✅
  5. ~~F5 — wca 固定 canonical layer order~~  ✅
  6. ~~F6 — kernel `turn.started` + `system.notify`~~  ✅

- **可以后续跟进的 non-blocking follow-up**（见 §6.5）：
  1. capability-runtime README 维护 `allowlist / deferred / oom-risk` 三类状态 + `just-bash` diff truth
  2. session-do-runtime 把 WS/HTTP ingress 真正切到 `@nano-agent/nacp-session` 的 `normalizeClientFrame()` 与 phase/role gate
  3. session-do-runtime controller 从 success-shaped stub 推进到真实 runtime glue（Phase 4/6）

---

## 6. 实现者回应

### 6.1 对本轮 2nd-round 审查的回应

- **总体回应**：按 blocker 粒度逐条修了代码并补回归测试；没打算把 3 个跨包 refactor 塞进本轮。
- **本轮修改策略**：
  - 对每条 finding 都先在**真实代码里 grep/read 复现**，而不是只信 GPT 的描述，确认属实才动手。
  - `done` 的条目都必须同时新增**回归测试**（不是只改实现），这样 3rd-round 复核只要 run test 就能验证。
  - `out-of-scope` 的条目给明确 rationale + 下一轮具体 acceptance criteria，不留模糊空间。

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| F1 (session-do R4) | persistCheckpoint 写出 invalid checkpoint | `fixed` | 新增 `UUID_RE` + `sessionUuid: string \| null` 字段 + `attachSessionUuid(candidate)`（验 UUID 才写）；构造时 env-seed；WS upgrade 与 HTTP fallback 都主动 attach；`persistCheckpoint()` 改为 build → `validateSessionCheckpoint()` → 只在 valid 时才写 | `packages/session-do-runtime/src/do/nano-session-do.ts`, `packages/session-do-runtime/test/integration/checkpoint-roundtrip.test.ts` |
| F2 (capability R1) | ServiceBindingTarget 是 not-connected stub | `fixed` | 新增 `ServiceBindingTransport` interface（`call(input)` + optional `cancel(input)`），`ServiceBindingProgressFrame` / `ServiceBindingCallInput` / `ServiceBindingCancelInput` 类型；`ServiceBindingTarget` 改为实现 `StreamingTargetHandler`；signal pre-abort → cancelled；abort mid-flight → 调 `transport.cancel()`；无 transport 时仍然返回 `not-connected`（保留旧 API 行为） | `packages/capability-runtime/src/targets/service-binding.ts`, `packages/capability-runtime/test/integration/service-binding-transport.test.ts` |
| F3 (capability R3) | executeStream 只发 started + terminal | `fixed` | 新增 `StreamingTargetHandler` interface + `ProgressEmit` type + `isStreamingHandler()` 判别；在 `executeStream()` 里用 progress queue + `resolveProgress` promise 桥把 handler 推来的 progress 转成 `kind: "progress"` capability event；`runHandlerStreaming()` 在判别出 streaming handler 时用 `executeStreaming()`，否则 fallback 到 `execute()` | `packages/capability-runtime/src/executor.ts`, `packages/capability-runtime/src/targets/service-binding.ts`, `packages/capability-runtime/test/integration/service-binding-transport.test.ts` |
| F4 (hooks R5 / eval-obs R3 / storage R4) | build:schema / build:docs `sh: 1: tsx: not found` | `fixed` | 三个包的 `devDependencies` 各补 `"tsx": "^4.19.0"`；`npm install tsx@4.19.0 --save-dev` 逐包跑过；`npm run build:schema && npm run build:docs` 三包都产出正确 artifacts | `packages/hooks/package.json`, `packages/eval-observability/package.json`, `packages/storage-topology/package.json` |
| F5 (wca R4) | canonical layer order 被 caller priority 左右 | `fixed` | 在 `context-layers.ts` 暴露 `CANONICAL_LAYER_ORDER` + `CANONICAL_LAYER_RANK`；`ContextAssembler.assemble()` 改为 (appliedIndex, priority, canonicalRank) 复合排序；`AssemblyResult` 新增 `orderApplied: readonly ContextLayerKind[]`；`config.layers` 非空时既是 allowlist 也是 ordering，空数组 fallback 到 canonical | `packages/workspace-context-artifacts/src/context-layers.ts`, `packages/workspace-context-artifacts/src/context-assembler.ts`, `packages/workspace-context-artifacts/src/index.ts`, `packages/workspace-context-artifacts/test/context-assembler.test.ts` |
| F6 (kernel R4) | turn.started 缺失 + system.notify 无 public 入口 | `fixed` | `KernelRunner.advanceStep()` 在 `stepIndex === 0` 时优先发 `turn.started`（timestamp ISO、带 turnId）；非首步不重复发；新增 public `buildSystemNotify(severity, message): RuntimeEvent` 方法 —— schema-兼容的 `system.notify` 构造器，供 outer orchestrator 在 budget/health 等场景使用 | `packages/agent-runtime-kernel/src/runner.ts`, `packages/agent-runtime-kernel/test/runner.test.ts` |
| capability R4 | allowlist / deferred / just-bash diff truth | `deferred` | 见 §6.5 scope-down 理由 | — |
| session-do R1 | WS ingress 绕开 `nacp-session.normalizeClientFrame` | `deferred` | 见 §6.5 scope-down 理由 | — |
| session-do R3 | WS/HTTP controller 只是 success-shaped stub | `deferred` | 见 §6.5 scope-down 理由 | — |

### 6.3 变更文件清单

**源代码（8 files）**:
- `packages/session-do-runtime/src/do/nano-session-do.ts` — `UUID_RE` + `attachSessionUuid()` + env-seed + validator-gated persist
- `packages/storage-topology/src/placement.ts` — `PlacementMimeGate` + `defaultMimeGate()` + `enforceMimeGate()`
- `packages/storage-topology/src/index.ts` — 导出上述 3 个新 API
- `packages/workspace-context-artifacts/src/context-layers.ts` — `CANONICAL_LAYER_ORDER` + `CANONICAL_LAYER_RANK`
- `packages/workspace-context-artifacts/src/context-assembler.ts` — 固定顺序排序 + `orderApplied`
- `packages/workspace-context-artifacts/src/index.ts` — 导出 canonical order 常量
- `packages/agent-runtime-kernel/src/runner.ts` — `turn.started` 首步发射 + `buildSystemNotify()`
- `packages/capability-runtime/src/executor.ts` — `StreamingTargetHandler` + `ProgressEmit` + queue/pump
- `packages/capability-runtime/src/targets/service-binding.ts` — 完整重写：`ServiceBindingTransport` seam

**测试（5 files，其中 1 new）**:
- `packages/session-do-runtime/test/integration/checkpoint-roundtrip.test.ts` — NEW，5 tests
- `packages/storage-topology/test/mime-gate.test.ts` — +8 tests（此前 1 smoke）
- `packages/workspace-context-artifacts/test/context-assembler.test.ts` — +4 tests
- `packages/agent-runtime-kernel/test/runner.test.ts` — +3 tests
- `packages/capability-runtime/test/integration/service-binding-transport.test.ts` — NEW，5 tests

**package.json（3 files）**:
- `packages/hooks/package.json` — `"tsx": "^4.19.0"`
- `packages/eval-observability/package.json` — `"tsx": "^4.19.0"`
- `packages/storage-topology/package.json` — `"tsx": "^4.19.0"`

### 6.4 验证结果

```text
cd packages/session-do-runtime && npm test            → 19 files / 259 tests passed
cd packages/storage-topology && npm test              → 10 files / 114 tests passed
cd packages/workspace-context-artifacts && npm test   → 14 files / 151 tests passed
cd packages/agent-runtime-kernel && npm test          → 12 files / 123 tests passed
cd packages/capability-runtime && npm test            → 11 files / 112 tests passed
cd packages/hooks && npm run build:schema && npm run build:docs           ✅
cd packages/eval-observability && npm run build:schema && npm run build:docs ✅
cd packages/storage-topology && npm run build:schema && npm run build:docs  ✅
npm run test:cross                                    → 15/15 cross-package
```

- `llm-wrapper` 不在列表中的原因：2nd-round GPT 对它的 R3/R4 findings 实际在前置 `workspace-context-artifacts` 的 `PreparedArtifactRef` 对齐后就被关闭了——当前 `cd packages/llm-wrapper && npm test` 仍是 100/100 passing，本轮无需再动。

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`（6 个 blocker 全绿）+ `partially-closed`（3 个 scope-down）
- **仍然保留的已知限制**：
  1. **`capability-runtime` R4（deferred allowlist / `just-bash` diff truth）** —— 需要在 README 里建立 `supported / deferred / oom-risk` 三列维护表，并把 `context/just-bash` 的 handler 列表做一次 diff 钉到测试里。这是 **文档 + 工程纪律层** 的工作，不是 correctness 问题；建议作为 `docs/action-plan/capability-runtime.md` 的 Phase 5.5 单独 action-plan item。
  2. **`session-do-runtime` R1（WS ingress → `nacp-session.normalizeClientFrame`）** —— 目前 `nano-session-do.ts:169-224` 仍是本地 `JSON.parse` + `message_type` switch；把它真正接到 `@nano-agent/nacp-session` 的 phase gate / role gate 需要 `nacp-session` 暴露一个 stateless `normalizeClientFrame(raw, ctx)` 公共 API（目前它还和 session actor state 耦合）。这个 refactor 跨 2 个包，本轮不动；下一轮单独起一个 `docs/investigation/nacp-session-ingress-seam.md` 评估。
  3. **`session-do-runtime` R3（controller → runtime glue）** —— `ws-controller.ts` / `http-controller.ts` 仍是 controller-level stub；让它们承载真实 runtime glue 依赖的是 §6.5.2 的 ingress seam + `SessionOrchestrator` 的 controller 适配器。同样跨两包，本轮不动。

---

## 7. 对 GPT 本轮 2nd-round 代码复核质量的评价

### 7.1 总体评价

**综合评分：⭐⭐⭐⭐⭐ (5/5)** —— GPT 在 2nd-round 里**没有放水**，几乎每一条 `partial` 都伴随 `我实际跑了 X 命令 / 我 grep 了 Y / 我 read 了 file:line` 这种可复现证据，而不是靠直觉批注。把 1st-round 被 Opus 标成 `fixed` 的条目真实地打开复验，并且**明确拒绝把 “schema 对齐” 或 “文件已提交” 当收口**，这是很高水准的 reviewer discipline。

### 7.2 做得极好的地方

1. **`session-do-runtime` R4 标成 `regressed` 的那一刀下得非常干净**。
   GPT 没有走 “validator 更严了，writer 老了” 的模糊说法，而是写道：「我实际做了一次性验证：实例化 `NanoSessionDO` 后直接触发 `webSocketClose()`，写入 storage 的 checkpoint 为 `{ sessionUuid: "unknown", valid: false }`。」
   这种 **“我真的 run 过，结果就是它”** 的证据型判断是 2nd-round review 的黄金标准。

2. **拒绝把 `service-binding-progress.test.ts` 当成 `ServiceBindingTarget` 覆盖的证据**。
   GPT 精准地指出 “该测试实际 `executionTarget: "local-ts"` + `SlowSignalTarget`，根本没有覆盖 `ServiceBindingTarget`”。这对 integration test 的 **命名 vs 实际覆盖** 做了一次打假；如果放过去了，3rd-round 再挖出来就太贵。

3. **对 “`executeStream()` 只发 started + terminal” 的证据最硬**。
   GPT 直接引用了 executor.ts:126-137 **我们自己代码里的 comment** —— `"currently only the terminal event is emitted beyond started"`，这是无法抵赖的事实级证据。这种 **让实现者自家注释作证** 的做法是最高效的 review 技巧。

4. **`tsx` devDep 问题跨 3 个包都精确复现 exit 127**。
   没有放过 “脚本在根目录 CI 里可能能跑” 的模糊情况，坚持 “在包内 `npm run` 必须能直接走通”。这个 “包即单元” 的严谨度和后续 Phase 5 Exit Criteria 一致。

5. **为每条 `partial` 给出具体可验证的 acceptance criteria**。
   不是 “看起来还有问题”，而是 “给 `ServiceBindingTarget` 接上真实或 mock 的 NACP transport seam，并补真正针对 `service-binding` target 的 request/progress/cancel/response roundtrip 测试”。这种 acceptance criteria 对 3rd-round 是否 closed 判定没有解释空间。

### 7.3 可以更好的地方

1. **`capability-runtime` R4 的建议偏 “记账层” 而非 correctness**。
   GPT 要求的 `allowlist / oom-risk / deferred` 三类状态维护 + `just-bash` diff truth 其实是 **docs/工程纪律** 的事情，不是代码 correctness。把它和 R1/R3（真正的 transport/event contract）并列成 `partial` 容易误导 scope 判断；更准的做法是拆成 R4a（delivery-gap blocker）+ R4b（docs followup）。

2. **`session-do-runtime` R1/R3 的 “跨包 refactor 深度” 没有明确估价**。
   GPT 写 “把 WS ingress 真正接到 `nacp-session` 的 phase gate / role gate”，但 `normalizeClientFrame()` 目前不是 stateless public API，要让 R1 真实可做需要先改 `nacp-session` 的公共接口。review 文档里如果加一句 “该修复需要跨包 refactor 的前置 work（`nacp-session` 需要 export stateless ingress helper）”，对实现者判断 scope 会更有用。

3. **没有把 `llm-wrapper` 的 R3/R4 “自然关闭” 这条写清楚**。
   1st-round llm-wrapper R3/R4 指向的 `PreparedArtifactRef` 对齐问题，在 `workspace-context-artifacts` 本轮 F5 / F1（fixed canonical order + `prepareForLlm`）完成后就自然闭合；2nd-round 文档里没说明这种 **跨包依赖关闭** 的情况，容易让实现者误以为还要动 llm-wrapper 代码。3rd-round 建议明确写 “由于 wca 的 X 修复，llm-wrapper 的 R3/R4 已被自然关闭”。

4. **对 `workspace-context-artifacts` R4 的固定顺序 contract，建议的测试粒度偏粗**。
   GPT 的 “caller priority 不能翻动 canonical 顺序” 是对的，但没有单独强调 **“allowlist 为空 vs allowlist 为 `[]` array 但存在” 的 edge case**（我本轮在测试里专门 cover 了 `[]` = accept-all 的 backwards compat）。3rd-round 如果继续细化这块，建议直接提出这类 edge case。

### 7.4 总结

- GPT 的 2nd-round 复核**没有走形式**，把 1st-round 实现者过度乐观的收口（“helper 对齐 = 收口”、“started + terminal = progress 合同”）都点出来了。
- 6 个 blocker 的 acceptance criteria 写得极准，本轮实现者可以直接照着 run 测试对号，不存在解释空间。
- 可以更好的地方主要是 `capability R4` 的 correctness-vs-docs 拆分、`session-do R1/R3` 的跨包前置工作识别、以及 `llm-wrapper` 自然关闭的追踪；这些都是 2.5 阶 reviewer 的进阶工作，不影响本轮结论的准确性。

---

## 8. 工作日志

| 时间 (2026-04-17) | 动作 | 结果 |
|---|---|---|
| morning | 读取 8 份 GPT 2nd-round review doc，按 `仍未收口的问题` 表逐条提取 findings | 汇总出 F1–F6 + 3 个 scope-down |
| — | 对 session-do R4 在真实代码中复现：grep `persistCheckpoint` + read `checkpoint.ts:157`，确认 validator 严格于 writer | 确认 regressed |
| — | 对 capability R1 复现：read `service-binding.ts` 发现仍是 `not-connected`；read `service-binding-progress.test.ts` 确认它 `executionTarget: "local-ts"` | 确认 partial 成立 |
| — | 对 capability R3 复现：grep `kind: "progress"` 仓内只在 type 定义出现；read executor.ts comment 自白 | 确认 partial 成立 |
| — | 对 tsx findings：三个包 `npm run build:schema` 直接 `sh: 1: tsx: not found` | 确认 partial 成立 |
| — | 对 wca R4 复现：read `context-assembler.ts` 仅 priority 排序 | 确认 partial 成立 |
| — | 对 kernel R4 复现：grep `turn.started` 在 runner.ts 找不到 emission | 确认 partial 成立 |
| noon | 修 F4（3 个 `tsx`）：各自 `npm install tsx@4.19.0 --save-dev` + 跑 `build:schema` / `build:docs` | ✅ 全绿 |
| — | 修 F1（session-do checkpoint）：加 `UUID_RE` + `attachSessionUuid()` + env-seed + WS/HTTP fallback + validator gate + 5 回归测试 | 259/259 |
| afternoon | 修 F5（wca 固定 order）：加 `CANONICAL_LAYER_ORDER` + `orderApplied` + 4 回归测试 | 151/151 |
| — | 修 F6（kernel turn.started + system.notify）：首步发射 + `buildSystemNotify()` + 3 回归测试 | 123/123 |
| — | 修 F3（capability progress path）：重写 `executor.ts` 引入 `StreamingTargetHandler` + `ProgressEmit` + queue/pump | typecheck 绿 |
| — | 修 F2（capability service-binding transport）：重写 `service-binding.ts` + 5 integration tests | 112/112 |
| — | 跑 `npm run test:cross` 确认无跨包回归 | 15/15 |
| evening | 撰写本报告 | 本文件 |

---

## 9. 文档纪律

- 8 份 `docs/code-review/*-by-GPT.md` 本轮**未做任何删改**，完全保持 append-only（1st round + 实现者 §6 + GPT §8/§9/§10 2nd-round + 本报告）。
- 若后续 GPT 进入第 3 轮复核，应直接在对应 review 文档底部追加 `§8+ / §10+` 而不是新开文件；本报告的角色仅是 **本轮（2nd-round）跨 8 包统一 fixing 记录**，不替代单包 review 文档本身。
- `docs/action-plan/capability-runtime.md` 与 `docs/action-plan/session-do-runtime.md` 需要在接下来的 follow-up round 同步更新（§6.5 的 3 条），本报告只记录 “本轮不动” 的决定，不代替 action-plan 的口径调整。

---

## 10. GPT 第三轮核查（E2E 前最终核查）

### 10.1 第三轮结论

> 核查者: `GPT-5.4`
> 核查时间: `2026-04-17`
> 核查依据: `Opus §0–§9 的声明 + 当前代码事实 + 重新执行的测试/脚本`

- **一句话 verdict**：本轮 Opus 声称已修的 6 条 blocker，我已按代码与验证结果逐项复核，**结论成立**；但 `session-do-runtime` 的 ingress/runtime glue 与 `capability-runtime` 的 allowlist/diff-truth 仍是明确保留项，**不能被重新表述为已收口**。
- **结论等级**：`approve-with-followups`
- **是否允许进入 E2E 阶段**：`yes`
- **本轮最关键的 3 个判断**：
  1. `session-do-runtime` 的 checkpoint regression 已真实修复，writer 与 validator 不再自相矛盾。
  2. `capability-runtime` 的 service-binding / progress path 已从“stub + 命名型测试”提升为“真实 transport seam + roundtrip integration tests”。
  3. 仍保留的 3 条 scope-down 是**诚实保留**，不是隐藏回归；但其中 `session-do-runtime` 的文件头注释对 ingress reality 仍有轻微表述过满，E2E 前应按 deferred 事实理解，而不是按注释理解。

### 10.2 核查方法与已核实事实

- **对照文档**：
  - `docs/progress-report/mvp-wave-2nd-round-fixings.md`
  - 8 份 `docs/code-review/*-by-GPT.md` 的二次审查章节
- **重点复核实现**：
  - `packages/session-do-runtime/src/do/nano-session-do.ts`
  - `packages/capability-runtime/src/executor.ts`
  - `packages/capability-runtime/src/targets/service-binding.ts`
  - `packages/workspace-context-artifacts/src/context-layers.ts`
  - `packages/workspace-context-artifacts/src/context-assembler.ts`
  - `packages/agent-runtime-kernel/src/runner.ts`
  - `packages/storage-topology/src/placement.ts`
  - `packages/{hooks,eval-observability,storage-topology}/package.json`
- **重新执行的验证**：
  - `cd packages/session-do-runtime && npm test`
  - `cd packages/storage-topology && npm test`
  - `cd packages/workspace-context-artifacts && npm test`
  - `cd packages/agent-runtime-kernel && npm test`
  - `cd packages/capability-runtime && npm test`
  - `cd packages/llm-wrapper && npm test`
  - `cd packages/hooks && npm run build:schema && npm run build:docs`
  - `cd packages/eval-observability && npm run build:schema && npm run build:docs`
  - `cd packages/storage-topology && npm run build:schema && npm run build:docs`
  - `npm run test:cross`

### 10.3 已验证有效的修复

| 编号 | 第三轮复核结论 | 依据 |
|------|----------------|------|
| F1 | `closed` | `packages/session-do-runtime/src/do/nano-session-do.ts:61-179,379-413` 已建立 `sessionUuid` source-of-truth + validator gate；`test/integration/checkpoint-roundtrip.test.ts:43-110` 覆盖 env / route attach / reject / roundtrip；`npm test` 为 `259 passed` |
| F2 | `closed` | `packages/capability-runtime/src/targets/service-binding.ts:90-192` 已不再是 permanent stub，而是 `ServiceBindingTransport` seam + cancel forwarding；`test/integration/service-binding-transport.test.ts:63-255` 覆盖 not-connected / progress / reject / cancel / requestId patch；`npm test` 为 `112 passed` |
| F3 | `closed` | `packages/capability-runtime/src/executor.ts:23-64,183-330,349-372` 已真实发射 `progress`，不再只是 `started → terminal`；integration tests 中 progress case 通过 |
| F4 | `closed` | `packages/hooks/package.json:17-33`、`packages/eval-observability/package.json:17-33`、`packages/storage-topology/package.json:17-33` 都已补 `tsx`；三包 `build:schema` / `build:docs` 重新执行通过 |
| F5 | `closed` | `packages/workspace-context-artifacts/src/context-layers.ts:25-54` 冻结 `CANONICAL_LAYER_ORDER`；`src/context-assembler.ts:57-120` 实现 allowlist + ordering + `orderApplied`；`test/context-assembler.test.ts:198-250` 复核固定顺序与 caller ordering；`npm test` 为 `151 passed` |
| F6 | `closed` | `packages/agent-runtime-kernel/src/runner.ts:38-63,121-131` 已有首步 `turn.started` 与 `buildSystemNotify()` seam；`test/runner.test.ts:231-260` 锁住首步发射与 schema-compatible helper；`npm test` 为 `123 passed` |
| llm-wrapper 自然关闭 | `confirmed` | `cd packages/llm-wrapper && npm test` 为 `100 passed`；根目录 `npm run test:cross` 继续通过跨包 prepared-ref / workspace seam contract |

### 10.4 仍保留、且不应被误读为已关闭的项

| 编号 | 当前状态 | 说明 | 第三轮判断 |
|------|----------|------|------------|
| D1 | `open-by-design` | `session-do-runtime` 当前仍是本地 `JSON.parse` + `message_type` switch，未真正接入 `@nano-agent/nacp-session` ingress helper；见 `packages/session-do-runtime/src/do/nano-session-do.ts:198-257` | Opus 在 §6.5 的 scope-down 说明是诚实的，这条不能算关闭 |
| D2 | `open-by-design` | `WsController` / `HttpController` 仍是 controller-level stubs；见 `packages/session-do-runtime/src/ws-controller.ts:18-55`、`src/http-controller.ts:32-101` | 这意味着部分 E2E 场景仍需按 “phase-gated” 理解，而不是假设 runtime glue 已齐 |
| D3 | `open-by-design` | `capability-runtime` 的 allowlist / deferred / `just-bash` diff-truth 维护仍未进入代码闭环，本轮也未宣称已修 | 作为 docs / delivery 跟进项保留是合理的，但不能在后续报告里被改写成 “全部收口” |
| D4 | `low docs-gap` | `nano-session-do.ts` 文件头第 13-17 行写成 “WebSocket ingress goes through nacp-session reality”，但当前真实实现仍是本地 parse/switch | 不构成当前 correctness blocker，但文案比实现更乐观；E2E 撰写时应以 D1 的 deferred reality 为准 |

### 10.5 第三轮最终收口意见

- **最终判断**：Opus 这份跨包 fixing 报告的主声明，经第三轮复核后**基本成立**；被其标成 `done` 的 6 条 blocker 已有代码与测试双重支撑。
- **是否建议把本报告作为 E2E 前最终核查记录发送给 Opus**：`yes`
- **进入 E2E 前应保持的边界**：
  1. 不要把 `session-do-runtime` 的 ingress / controller glue 当成已完成能力；相关 E2E 需标注 phase-gated 或改走当前 public seam。
  2. 不要把 `capability-runtime` 的 command-surface diff truth 当成已完成治理面；当前收口的是 transport/progress correctness，不是 just-bash inventory 完成。
  3. 若后续 E2E 失败落在 D1/D2/D3 范围，应回到对应 action-plan，而不是回溯性地声称这轮已经关闭。
- **第三轮新增回归判断**：
  1. 未发现新的 correctness regression。
  2. `npm run test:cross` 继续通过，当前 cross-package 契约面未因本轮修复而破坏。

> 结论收口：  
> **本轮 third-round verification 通过，可以进入 E2E；但只应以“6 个 blocker 已闭合 + 3 个 deferred 仍显式保留”的状态进入，而不是以“全部问题已清零”的状态进入。**
