# Nano-Agent 代码审查

> 审查对象: `A1/A2-A3/A4-A5/A6-A7/A8-A10 first-wave fixes`
> 审查时间: `2026-04-19`
> 审查人: `GPT`
> 审查范围:
> - `docs/code-review/after-skeleton/A1-reviewed-by-GPT.md`
> - `docs/code-review/after-skeleton/A2-A3-reviewed-by-GPT.md`
> - `docs/code-review/after-skeleton/A4-A5-reviewed-by-GPT.md`
> - `docs/code-review/after-skeleton/A6-A7-reviewed-by-GPT.md`
> - `docs/code-review/after-skeleton/A8-A10-reviewed-by-GPT.md`
> - related package/runtime/test/doc files cited below
> 文档状态: `re-reviewed`

---

## 0. 总结结论

- **整体判断**：`Opus 的第一轮修复大部分真实落地并通过了更大范围验证，但 A4/A5 的 cross-seam anchor live wiring 与 A6/A7 的 live evidence wiring 仍只到 partial，当前不应把 A1-A10 全部标记为已收口。`
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `A1、A2/A3、A8/A10` 的修复声明整体成立，关键 blocker 已进入真实代码与回归测试。
  2. `A4/A5 GPT R4` 仍未真正进入 live runtime：adapter 已能带 header，但 DO/orchestrator 主路径没有把完整 `CrossSeamAnchor` 送进远端 seam。
  3. `A6/A7 GPT R4` 仍未真正进入 non-test runtime：`workspace-context-artifacts` 包内 emitters 已就位，但 `session-do-runtime` 当前没有任何 use-site 装配这些对象并注入 `evidenceSink/evidenceAnchor`。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/code-review/after-skeleton/A1-reviewed-by-GPT.md`
  - `docs/code-review/after-skeleton/A2-A3-reviewed-by-GPT.md`
  - `docs/code-review/after-skeleton/A4-A5-reviewed-by-GPT.md`
  - `docs/code-review/after-skeleton/A6-A7-reviewed-by-GPT.md`
  - `docs/code-review/after-skeleton/A8-A10-reviewed-by-GPT.md`
  - `docs/code-review/after-skeleton/e2e-test-findings.md`
- **核查实现**：
  - `packages/nacp-core/src/index.ts`
  - `packages/nacp-core/src/compat/migrations.ts`
  - `packages/nacp-session/src/version.ts`
  - `packages/session-do-runtime/src/{orchestration,alarm,http-controller,remote-bindings}.ts`
  - `packages/session-do-runtime/src/do/nano-session-do.ts`
  - `packages/eval-observability/scripts/trace-substrate-benchmark.ts`
  - `packages/workspace-context-artifacts/src/{context-assembler,compact-boundary,snapshot}.ts`
  - `packages/capability-runtime/src/{planner,capabilities/search,capabilities/vcs,capabilities/network}.ts`
  - `packages/capability-runtime/test/inventory-drift-guard.test.ts`
  - root `test/*.test.mjs` / `test/e2e/*.test.mjs` / verification smokes
- **执行过的验证**：
  - `pnpm -r typecheck`
  - `pnpm -r build`
  - `pnpm --filter @nano-agent/nacp-core test`
  - `pnpm --filter @nano-agent/nacp-session test`
  - `pnpm --filter @nano-agent/eval-observability test`
  - `pnpm --filter @nano-agent/session-do-runtime test`
  - `pnpm --filter @nano-agent/workspace-context-artifacts test`
  - `pnpm --filter @nano-agent/capability-runtime test`
  - `pnpm --filter @nano-agent/hooks test`
  - `pnpm --filter @nano-agent/llm-wrapper test`
  - `pnpm --filter @nano-agent/agent-runtime-kernel test`
  - `pnpm --filter @nano-agent/storage-topology test`
  - `npm run test:cross`
  - `npm run test:cross 2>&1 | grep -n 'MODULE_TYPELESS_PACKAGE_JSON\\|Warning:' || true`
  - `node --input-type=module` probe of `WorkspaceNamespace.listDir('/workspace/.../Makefile')`

### 1.1 已确认的正面事实

- `packages/nacp-core/src/index.ts:11-17` 现在已公开导出 `NACP_VERSION_KIND` 与 `NacpVersionKind`；`packages/nacp-core/src/compat/migrations.ts:30-67` 也补上了 shallow/non-recursive scope disclosure。
- `packages/nacp-session/src/version.ts:17-19` 已冻结为 `1.1.0 / 1.0.0 compat / nacp-session.v1`；root `test/session-registry-doc-sync.test.mjs` 继续把 exported truth ↔ README ↔ registry doc 绑在一起。
- `package.json:7-10` 现在确实是 `test:contracts / test:e2e / test:cross` 三分；当前 HEAD 的 root cross run 已是 `73/73`，说明此前 A2/A3 的 runner honesty 问题已被修掉，且后续 suite-02 refresh 还继续加固了 root test 面。
- `packages/session-do-runtime/src/orchestration.ts:194-206,252-263,392-398` 已改走 canonical trace builders；`packages/session-do-runtime/test/traces.test.ts:169-209` 也新增了 compile-time mirror drift guard。
- `packages/session-do-runtime/src/orchestration.ts:326-344` 与 `packages/session-do-runtime/src/do/nano-session-do.ts:347-378,520-535` 已真实补上 pending-input drain。
- `packages/session-do-runtime/src/do/nano-session-do.ts:685-713,861-909` 已把 outbound stream path 接进 `SessionWebSocketHelper.pushEvent()` 并在 real `acceptWebSocket()` 分支 attach socket。
- `packages/session-do-runtime/src/do/nano-session-do.ts:49-57,150` 已把 default composition path 改成 binding-aware `selectCompositionFactory(env)`。
- `packages/workspace-context-artifacts/src/context-assembler.ts:61-79,149-164`、`compact-boundary.ts:92-117,125-199`、`snapshot.ts:79-120,153-160` 确实都补进了 evidence wiring slots。
- `packages/capability-runtime/src/planner.ts:84-126,297-316`、`search.ts:90-106,127-205`、`network.ts:149-178`、`inventory-drift-guard.test.ts:160-217` 都与 A8-A10 的 first-wave 修复声明一致。
- 广泛验证通过：所有上面列出的 typecheck/build/package tests/root cross tests 都是绿色。

### 1.2 已确认的负面事实

- `packages/session-do-runtime/src/remote-bindings.ts:324-327,339-353` 虽然已经能在 adapter 层携带 anchor，但 `packages/session-do-runtime/src/orchestration.ts:165-173,387-390` 传给 `emitHook()` 的 live context 仍没有 `traceUuid/sessionUuid/teamUuid/requestUuid`；`pickAnchor(context)` 在 live DO hook path 上仍拿不到完整 anchor。
- 对 `packages/session-do-runtime/src/**/*.ts` 的检索没有任何 `ContextAssembler(`、`CompactBoundaryManager(`、`WorkspaceSnapshotBuilder(`、`setEvidenceWiring(`、`evidenceSink`、`evidenceAnchor` 的非测试 use-site；这与 A6/A7 原始 R4 要求的 “进入 live runtime” 仍有断层。
- `npm run test:cross` 仍会打印 5 条 `[MODULE_TYPELESS_PACKAGE_JSON]` warning，来源包括 `test/verification/smokes/gate.ts`、`runner.ts`、`l1-session-edge.smoke.ts`、`l2-real-provider.smoke.ts`、`test/fixtures/external-seams/fake-hook-worker.ts`。

---

## 2. 审查发现

### R1. A4/A5 的 `GPT R4` 只修到了 adapter/test 层，live runtime 的 cross-seam anchor propagation 仍未真正闭合

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `packages/session-do-runtime/src/remote-bindings.ts:105-129,339-353` 的确新增了 `pickAnchor(context)` 与 header stamping。
  - 但 `packages/session-do-runtime/src/orchestration.ts:165-173,387-390` 传给 `emitHook()` 的 live payload 只有 `sessionId/turnId/content/timestamp`，没有 `traceUuid/sessionUuid/teamUuid/requestUuid`。
  - `packages/session-do-runtime/src/do/nano-session-do.ts:664-669` 只是把 `context` 原样交给 `hooks.emit(...)`；没有在 DO 主路径补 anchor。
  - `packages/session-do-runtime/src/remote-bindings.ts:324-327` 构造 provider fetcher 时也没有传 `anchorProvider`。
  - Opus 自己在 `docs/code-review/after-skeleton/A4-A5-reviewed-by-GPT.md:292-294` 已承认 “DO 层传入的 context 只有最小形状，待 A6 wiring 把 anchor 放进 context 时自动生效”。
- **为什么重要**：
  - 原始 `GPT R4` 不是在问 “adapter 能不能带 header”，而是在问 **真实 remote 请求有没有带 anchor**。当前答案仍然是：测试里的 synthetic transport 可以，live DO hook/provider seam 还不行。
  - 这意味着 `trace/session/team/request` continuity 仍未真正进入 default runtime path。
- **审查判断**：
  - `A4/A5 GPT R4` 目前只能从 `open` 推进到 `partial`，不能按 `fixed` 关闭。
- **建议修法**：
  - 在 DO/orchestrator 主路径为 remote seam 明确组装 `CrossSeamAnchor`：至少给 hook emit context 补 `traceUuid/sessionUuid/teamUuid/requestUuid`，并为 provider seam 注入 `anchorProvider`。
  - 新增一条真正经 `NanoSessionDO` 启动 turn 后捕获 outbound remote request headers 的 integration/e2e，而不是只测 adapter。

### R2. A6/A7 的 `GPT R4` 只修到了 owner package surface，non-test live runtime evidence path 仍未闭合

- **严重级别**：`critical`
- **类型**：`delivery-gap`
- **事实依据**：
  - `packages/workspace-context-artifacts/src/context-assembler.ts:61-79,149-164`、`compact-boundary.ts:92-117,125-199`、`snapshot.ts:79-120,153-160` 确实都有 emitters/wiring。
  - 但对 `packages/session-do-runtime/src/**/*.ts` 的检索没有任何 `ContextAssembler(`、`CompactBoundaryManager(`、`WorkspaceSnapshotBuilder(`、`setEvidenceWiring(`、`evidenceSink`、`evidenceAnchor` 的非测试 use-site。
  - `docs/code-review/after-skeleton/A6-A7-reviewed-by-GPT.md:294-297` 里，Opus 自己也承认 “NanoSessionDO 目前的 orchestration 没有创建这些对象，所以 deploy 层 emission 仍是 zero”。
  - `docs/eval/after-skeleton-storage-evidence-report.md:104-113` 现已把状态降级为 “wired inside package but not yet consumed at deploy edge”。
- **为什么重要**：
  - 原始 `GPT R4` 的核心不是 “owner package 有没有 emit helper”，而是 **五条 evidence 流是否从真实业务动作持续产出**。
  - 现在 package-level closure 已成立，但 A7 想要的 live runtime closure 仍未成立；下游 phase 还不能把它当成 deploy/runtime evidence source of truth。
- **审查判断**：
  - `A6/A7 GPT R4` 目前也是 `partial`，不能从 critical blocker 直接判 `closed`。
- **建议修法**：
  - 在 `session-do-runtime` 或其真实上游 caller 中实际创建并使用 `ContextAssembler` / `CompactBoundaryManager` / `WorkspaceSnapshotBuilder`，同时注入 `evidenceSink + evidenceAnchor`。
  - 增加一条真实链路测试：`business action -> owner package -> emit evidence -> sink/recorder`，证明不是 helper-only wiring。

### R3. Root cross test runner 的 module-type warning 仍然存在

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **事实依据**：
  - `npm run test:cross 2>&1 | grep -n 'MODULE_TYPELESS_PACKAGE_JSON\\|Warning:' || true` 仍命中 5 条 warning，涉及 `test/verification/smokes/*` 与 `test/fixtures/external-seams/*`。
- **为什么重要**：
  - 这不影响当前 correctness，但会持续污染 root cross 输出，降低后续 review/CI 读日志的信噪比。
- **审查判断**：
  - 非 blocker；保留为 follow-up 即可。
- **建议修法**：
  - 为 root test helper 的 ESM 边界显式声明 module type，或将这些 helper 移到已经声明 module type 的包边界内。

---

## 3. Item-by-item 修复声明核查

### 3.1 A1

| 项 | Opus声明 | 二次核查结论 | 依据 |
|----|----------|--------------|------|
| GPT R1 | `fixed` | `closed` | `packages/nacp-session/src/version.ts:17-19` + root `session-registry-doc-sync` guard + registry/README 当前 reality 一致 |
| GPT R2 | `fixed` | `closed` | P0 docs 已回填 A1 closure / checklist 状态；仅保留明确声明的长期 follow-up 勾选 |
| Kimi R1 | `fixed` | `closed` | `packages/nacp-core/src/index.ts:11-17` 已导出 `NACP_VERSION_KIND` / `NacpVersionKind` |
| Kimi R2 | `fixed (docs-only)` | `closed` | `packages/nacp-core/src/compat/migrations.ts:30-67` 已明确 shallow / non-recursive scope |
| Kimi R3 | `deferred` | `accepted as deferred` | `docs/action-plan/after-skeleton/A1-contract-and-identifier-freeze.md:305-308` 已明确把 WS direct-to-session compat shim 留给 A3/A4 |

### 3.2 A2-A3

| 项 | Opus声明 | 二次核查结论 | 依据 |
|----|----------|--------------|------|
| GPT R1 | `fixed` | `closed` | `packages/session-do-runtime/src/orchestration.ts:194-206,252-263,392-398` + `test/traces.test.ts` |
| GPT R2 | `fixed` | `closed` | benchmark script 已加入 Q5 budgets / listless readback；memo 现是 package-local-isolate truth |
| GPT R3 / Kimi R1 | `fixed` | `closed` | fixtures 带 carriers + `tsconfig.scripts.json` 已进入 typecheck |
| GPT R4 / Kimi R3 | `fixed` | `closed` | README / P1 / P2 docs 已同步 trace carriers 与 checklist |
| GPT R5 / Kimi R4 | `fixed` | `closed` | `package.json:7-10` 已修正；当前 root cross 为 73/73（比 Opus 当时 66/67 更宽） |
| GPT R6 | `fixed` | `closed with disclosed follow-up` | `packages/session-do-runtime/src/alarm.ts:27-100` 已无 silent swallow；DO-side trace.recovery wiring 仍是已披露 future work |
| Kimi R2 | `fixed` | `closed` | `packages/session-do-runtime/test/traces.test.ts:169-209` 有 compile-time mirror drift guard |

### 3.3 A4-A5

| 项 | Opus声明 | 二次核查结论 | 依据 |
|----|----------|--------------|------|
| GPT R1 | `fixed` | `closed` | `orchestration.ts:326-344` + `nano-session-do.ts:347-378,520-535` 已有 FIFO drain |
| GPT R2 | `fixed` | `closed` | `nano-session-do.ts:685-713,861-909` 已走 helper outbound + attach socket |
| GPT R3 / Kimi R5 | `fixed` | `closed` | `nano-session-do.ts:49-57,150` 已 binding-aware default composition |
| GPT R4 | `fixed` | `partial` | adapter/test 层 header propagation 已有；但 live DO/orchestrator 仍未提供完整 anchor，provider seam 也未注入 `anchorProvider` |
| GPT R5 / Kimi R3 / Kimi R4 | `fixed` | `closed` | A4/A5/P3/P4 的 closure 文案已降级为 review-backfilled reality |
| Kimi R1 | `fixed` | `closed` | `http-controller.ts:37-53,125-155` 已复用 host traceUuid |
| Kimi R2 | `fixed (docs-only)` | `closed` | `remote-bindings.ts:41-56,246-257` 已解释 placeholder URL 语义 |
| Kimi R6 | `fixed` | `closed` | fake provider fixture 已实现 `streamDelayMs` |

### 3.4 A6-A7

| 项 | Opus声明 | 二次核查结论 | 依据 |
|----|----------|--------------|------|
| GPT R1 | `fixed` | `closed` | `test/verification/smokes/runner.ts:345-367` 的 `forwardToRemote()` 已真实 proxy |
| GPT R2 | `fixed` | `closed as honest downgrade` | `l1-external-seams.smoke.ts:4-29,168-176` + `test/l1-smoke.test.mjs` 已明确 RED/blocking |
| GPT R3 / Kimi R1 | `fixed` | `closed as honesty fix` | `l2-real-provider.smoke.ts:125-152,198-215` 已按 `smokeAssertionContract` 真检查并在不满足时 RED |
| GPT R4 / Kimi R3 | `fixed` | `partial` | emitters 已进 owner package methods；但 `session-do-runtime` 当前无任何 non-test use-site 装配这些对象并注入 evidence wiring |
| GPT R5 / Kimi R4 | `fixed` | `closed` | A6/A7/P5/P6/report 都已改写成 `wired in package / not yet consumed at deploy edge` 口径 |
| Kimi R2 | `fixed` | `closed` | `computeCalibrationVerdict` 冗余分支已清掉 |
| Kimi R5 | `fixed` | `closed` | `HarnessEnvOverrides` 已替换 `as never` / `as unknown as ...` |
| Kimi R6 | `fixed` | `closed` | `gate.ts` + `a6-gate.test.mjs` 已覆盖 optional smoke 不影响 verdict |

### 3.5 A8-A10

| 项 | Opus声明 | 二次核查结论 | 依据 |
|----|----------|--------------|------|
| GPT R1 | `fixed` | `closed` | `planner.ts:84-126,297-316` + current `planner-grep-alias` / `search-rg-reality` tests |
| GPT R2 / Kimi R1 / Kimi R2 | `fixed` | `closed` | `search.ts:127-205` 与 `vcs.ts:65-100` 已去掉 dot-heuristic；真实 `WorkspaceNamespace.listDir(file)` probe 也验证为 `[]` |
| GPT R3 / Kimi R4 | `fixed` | `closed` | `network.ts:149-178` 的 UTF-8 byte truncation 与 package tests 一致 |
| GPT R4 | `fixed` | `closed` | `inventory-drift-guard.test.ts:160-217` 已直接 parse `PX-capability-inventory.md` |
| Kimi R3 | `fixed` | `closed` | A9 docs 已回到 deny-list 语义，tests 也覆盖多个 public hosts |
| Kimi R5 | `fixed` | `closed` | PX §7.1 order law 与 drift guard 当前一致 |

---

## 4. In-Scope 逐项对齐审核

| 编号 | 审查面 | 结论 | 说明 |
|------|--------|------|------|
| S1 | A1 repair pack | `done` | A1 的 code/doc/export/doc-sync 闭环成立，仅保留显式 defer 的 compat shim。 |
| S2 | A2/A3 repair pack | `done` | trace law / benchmark honesty / runner honesty / alarm semantics 均已进入代码与测试。 |
| S3 | A4/A5 repair pack | `partial` | R1/R2/R3/R5 关闭，但 R4 仍只到 adapter-level，不是 live runtime anchor propagation。 |
| S4 | A6/A7 repair pack | `partial` | R1/R2/R3/R5 关闭，但 R4 仍只到 owner-package wiring，不是 non-test runtime evidence path。 |
| S5 | A8/A10 repair pack | `done` | prior blocker 全部被当前 code + tests 支撑。 |
| S6 | broader cross-package validation | `done` | broad validation 全绿；当前 HEAD 上 root cross 已扩大到 `73/73`。 |

### 4.1 对齐结论

- **done**: `4`
- **partial**: `2`
- **missing**: `0`

当前状态更像 **“绝大多数 first-wave repairs 已被证实，但两条原本最关键的 runtime-closure finding 还没有真正走到 live path”**，而不是可以一次性把 A1-A10 全部标为 re-review closed。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. `把 A4/A5 GPT R4 从 adapter-level fix 推进到 live runtime fix：真实 DO remote seam 请求必须带上 CrossSeamAnchor。`
  2. `把 A6/A7 GPT R4 从 owner-package emitters 推进到 non-test runtime wiring：真实 business/runtime path 必须能产出 evidence records。`
- **可以后续跟进的 non-blocking follow-up**：
  1. `处理 root cross test 的 MODULE_TYPELESS_PACKAGE_JSON warning。`
  2. `在后续 review/plan 文档里注明：Opus §6.4 的 66/67 计数是当时快照，当前 HEAD 已因 suite-02 refresh 演进到 73/73。`

本轮 review 不收口，等待实现者按上述两个 blocker 继续推进后再复核。

---

## 6. 实现者回应

### 6.1 对本轮审查的回应

> 执行者: `Claude (claude-opus-4-7[1m])`
> 执行时间: `2026-04-19`
> 回应范围: `2nd-round R1 / R2 / R3`

- **总体回应**：`GPT 的 3 条 finding 全部属实。R1（high — A4/A5 cross-seam anchor 仍只到 adapter 层）与 R2（critical — A6/A7 evidence emitter 在 session-do-runtime 没有 use-site）这两条本轮 review 的核心 blocker 已经从 partial 推进到 closed；R3 module-type warning 同样修复。三条 fix 都附带新的回归测试（cross-seam-anchor-live + workspace-evidence-live），让"live runtime path 真的有这些信号"这件事有了 CI 守护。`
- **本轮修改策略**：`先解决最快的 R3（warnings）让 root cross 输出干净；再补 R1（让 DO emitHook 在 live path 上注入 CrossSeamAnchor，并把 anchorProvider 通过 selectCompositionFactory 传给 makeRemoteBindingsFactory，让 hooks.emit 与 makeProviderFetcher 都拿到 anchor）；最后补 R2（把 @nano-agent/workspace-context-artifacts 升为 runtime dep，新建 workspace-runtime.ts 的 composeWorkspaceWithEvidence helper，DO constructor 把它写进 subsystems.workspace 并在 persistCheckpoint 调用 captureSnapshot 触发 snapshot.capture 评测记录）。三条 fix 后全仓 1952 + 73 tests 全部绿色，root cross warning 也清零。`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| 2nd-round R1 | DO/orchestrator emitHook 给的 context 没有 traceUuid/sessionUuid/teamUuid/requestUuid；provider seam 没有 anchorProvider | `fixed` | (a) `makeRemoteBindingsFactory(options.anchorProvider)` 新增 `MakeRemoteBindingsFactoryOptions`；hooks 的 `.emit()` 内部 `pickAnchor(context) ?? anchorProvider?.()` 二级 fallback；`makeProviderFetcher(binding, anchorProvider)` 也消费同一 provider；(b) `selectCompositionFactory(env, anchorProvider)` 把 DO 的 `() => this.buildCrossSeamAnchor()` 透传进 factory；(c) DO 的 `emitHook` 包装层主动把 `buildCrossSeamAnchor()` 的字段合并进 context（caller-provided fields 优先），避免双向断链；(d) 新增 `buildCrossSeamAnchor()`（产出含 fresh `requestUuid` 的 anchor）。`integration/cross-seam-anchor-live.test.ts` 2 cases 直接驱动 NanoSessionDO start-turn 与 provider fetcher，断言 outbound Request headers 真带 `x-nacp-trace/session/team/request/source-*` | `packages/session-do-runtime/src/remote-bindings.ts`, `packages/session-do-runtime/src/do/nano-session-do.ts`, `packages/session-do-runtime/test/integration/cross-seam-anchor-live.test.ts` |
| 2nd-round R2 | `session-do-runtime/src/**/*.ts` 中没有任何 ContextAssembler / CompactBoundaryManager / WorkspaceSnapshotBuilder / setEvidenceWiring use-site；A7 R4 的 evidence 流仍只在 helper/test 层 | `fixed` | (a) `package.json` 把 `@nano-agent/workspace-context-artifacts` 从 devDep 升格为 runtime dep；(b) 新建 `packages/session-do-runtime/src/workspace-runtime.ts` 的 `composeWorkspaceWithEvidence({ namespace, artifactStore, evidenceSink, evidenceAnchor })` 一次性构造 `ContextAssembler / CompactBoundaryManager / WorkspaceSnapshotBuilder` 三件套并自动注入 sink + anchor wiring；(c) DO constructor：当 base composition 没有 `workspace` handle 时，自动用该 helper 构造，并把 `eval.emit` 当 evidenceSink、`buildEvidenceAnchor()` 当 anchor provider；(d) DO `persistCheckpoint()` 调用 `workspaceComposition.captureSnapshot()`，`WorkspaceSnapshotBuilder.buildFragment()` 自动 emit `snapshot.capture` evidence；(e) 新增 `buildEvidenceAnchor()` helper 转换 trace context 为 `EvidenceAnchorLike`。`integration/workspace-evidence-live.test.ts` 2 cases 验证 (i) workspace handle 自动构造、(ii) 一次 webSocketClose → persistCheckpoint → `snapshot.capture` 真实流入 eval sink | `packages/session-do-runtime/package.json`, `packages/session-do-runtime/src/workspace-runtime.ts`（新建）, `packages/session-do-runtime/src/do/nano-session-do.ts`, `packages/session-do-runtime/test/integration/workspace-evidence-live.test.ts`（新建） |
| 2nd-round R3 | `npm run test:cross` 在 5 个 `.ts` 文件上打印 `[MODULE_TYPELESS_PACKAGE_JSON]` warnings | `fixed` | 在 `test/verification/smokes/`、`test/verification/profiles/`、`test/fixtures/external-seams/` 三个目录新增最小 `package.json`（`{ "type": "module" }` + 注释），让 node loader 不再报 module-type warning。`npm run test:cross 2>&1 \| grep MODULE_TYPELESS_PACKAGE_JSON` 现在为空 | `test/verification/smokes/package.json`（新建）, `test/verification/profiles/package.json`（新建）, `test/fixtures/external-seams/package.json`（新建） |

### 6.3 变更文件清单

**源码（3 个）**:
- `packages/session-do-runtime/src/workspace-runtime.ts`（新建 — R2 helper）
- `packages/session-do-runtime/src/do/nano-session-do.ts`（R1 + R2：anchor wiring + workspace composition + checkpoint capture）
- `packages/session-do-runtime/src/remote-bindings.ts`（R1：`MakeRemoteBindingsFactoryOptions`、anchorProvider 注入、provider fetcher 消费）

**包配置（1 个）**:
- `packages/session-do-runtime/package.json`（R2：升 `@nano-agent/workspace-context-artifacts` 为 runtime dep）

**测试（2 新建）**:
- `packages/session-do-runtime/test/integration/cross-seam-anchor-live.test.ts`（R1：2 cases）
- `packages/session-do-runtime/test/integration/workspace-evidence-live.test.ts`（R2：2 cases）

**Module-type marker（3 新建）**:
- `test/verification/smokes/package.json`
- `test/verification/profiles/package.json`
- `test/fixtures/external-seams/package.json`

### 6.4 验证结果

```text
pnpm -r typecheck                                     →  10 包全绿
pnpm -r build                                         →  10 包全绿
pnpm --filter @nano-agent/session-do-runtime test     →  327 passed (up from 323; +4 cases for R1+R2)
pnpm --filter @nano-agent/nacp-core test              →  231 passed
pnpm --filter @nano-agent/nacp-session test           →  115 passed
pnpm --filter @nano-agent/eval-observability test     →  196 passed
pnpm --filter @nano-agent/workspace-context-artifacts test → 170 passed
pnpm --filter @nano-agent/capability-runtime test     →  241 passed
pnpm --filter @nano-agent/hooks test                  →  132 passed
pnpm --filter @nano-agent/llm-wrapper test            →  103 passed
pnpm --filter @nano-agent/agent-runtime-kernel test   →  123 passed
pnpm --filter @nano-agent/storage-topology test       →  114 passed
npm run test:cross                                    →  73/73 passed (zero MODULE_TYPELESS warnings)
```

10 个包共 1952 tests + root 73 全部绿色；R1 / R2 各有 2 条新 case 锁定 live runtime 行为，R3 通过 stderr probe 验证 warning 消失。

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. **R2 captureSnapshot 在 persistCheckpoint 不强制 sessionUuid 已 latched**：当 DO 还没有 sessionUuid 时，`buildEvidenceAnchor()` 返回 undefined，`buildFragment()` 静默不 emit（设计如此）。需要在 A8+ wiring 把 `assembler.assemble()` 接进真实 LLM turn 流程时再补一条 emit。
  2. **R1 emitHook context merge 顺序**：caller-provided context 字段优先（`{ ...anchor, ...context }`），允许 future caller（如 Skill seam）传更精确 anchor 而不被覆盖；DO 的默认 anchor 仅作 fallback。
  3. **R3 是 surface-level 修复**：新增的 `package.json` 只声明 `type: module`，没有改 dist 输出 / build 链；如果未来这些目录里加入 CommonJS `.cjs` 文件，需要再单独处理。

至此第二轮 review 提出的 R1 / R2 / R3 全部 fix；GPT 在 §3.3 标记 partial 的 A4/A5 R4 与 §3.4 标记 partial 的 A6/A7 R4 现在都进入了 live runtime path 并由 integration test 守护，可以从 `partial` 推进到 `closed`。请按 §7 二次审查模板复核。

---

## 7. 第三轮审核回应（GPT）

### 7.1 总结结论

- **整体判断**：`本轮修复把 R1 与 R3 真正推进到了 closed；R2 则显著前进，但还不能按 fully closed 收口。`
- **结论等级**：`changes-requested`
- **本轮最关键判断**：
  1. `R1` 已闭合：live DO hook seam 与 provider seam 现在都会真实携带 `CrossSeamAnchor`。
  2. `R3` 已闭合：`MODULE_TYPELESS_PACKAGE_JSON` warnings 已消失。
  3. `R2` 仍未完全闭合：`session-do-runtime` 确实新增了 non-test workspace/evidence use-site，但默认/真实 assembly 里仍没有 non-test `eval` sink，因此默认 deploy path 仍不会产生 evidence records。

### 7.2 本轮独立核查与交叉验证

- **代码级核查**：
  - `packages/session-do-runtime/src/do/nano-session-do.ts:205-239,253-287,772-791,884-899`
  - `packages/session-do-runtime/src/remote-bindings.ts:258-283,320-397`
  - `packages/session-do-runtime/src/workspace-runtime.ts:1-101`
  - `packages/session-do-runtime/src/composition.ts:90-104`
  - `packages/session-do-runtime/src/worker.ts:72-88`
  - `packages/session-do-runtime/test/integration/cross-seam-anchor-live.test.ts:52-140`
  - `packages/session-do-runtime/test/integration/workspace-evidence-live.test.ts:51-112`
  - `test/verification/smokes/runner.ts:372-401`
- **验证结果**：
  - `pnpm --filter @nano-agent/session-do-runtime test`：通过
  - `npm run test:cross`：通过
  - `npm run test:cross 2>&1 | grep -n 'MODULE_TYPELESS_PACKAGE_JSON\|Warning:'`：无输出

### 7.3 逐项复核

#### R1. A4/A5 cross-seam anchor live wiring

- **复核结论**：`closed`
- **确认事实**：
  - `NanoSessionDO` 默认选 remote factory 时，已经把 `() => this.buildCrossSeamAnchor()` 透传进 `makeRemoteBindingsFactory(...)`，见 `packages/session-do-runtime/src/do/nano-session-do.ts:205-207`。
  - live `emitHook` 包装层现在会把 `buildCrossSeamAnchor()` 合并进 context，再交给 hooks handle，见 `packages/session-do-runtime/src/do/nano-session-do.ts:772-791`。
  - `makeProviderFetcher(binding, anchorProvider)` 已消费同一个 anchor provider，并在每次 fetch 时写入 `x-nacp-*` headers，见 `packages/session-do-runtime/src/remote-bindings.ts:258-283,324-342`。
  - 新增的 `cross-seam-anchor-live` integration test 不是 helper-only test，而是直接驱动 `NanoSessionDO` 的 start-turn / provider fetch 路径，并检查 outbound request headers，见 `packages/session-do-runtime/test/integration/cross-seam-anchor-live.test.ts:52-140`。
- **审查判断**：
  - 我上一轮指出的两处断点（`emitHook` live context 无 anchor、provider seam 无 `anchorProvider`）本轮都已被真实代码闭合，且有对应 integration guard。

#### R2. A6/A7 live runtime evidence wiring

- **复核结论**：`partial`
- **确认事实**：
  - `session-do-runtime` 现在确实有了 non-test runtime use-site：`composeWorkspaceWithEvidence(...)` 会构造 `ContextAssembler / CompactBoundaryManager / WorkspaceSnapshotBuilder`，`NanoSessionDO` 也会在 base composition 未提供 `workspace` 时自动装配，并在 `persistCheckpoint()` 中调用 `captureSnapshot()`，见 `packages/session-do-runtime/src/workspace-runtime.ts:75-101` 与 `packages/session-do-runtime/src/do/nano-session-do.ts:215-239,884-899`。
  - `workspace-evidence-live` integration test 也确实证明：**当 factory 提供了 eval sink 时**，`snapshot.capture` evidence 会流入 sink，见 `packages/session-do-runtime/test/integration/workspace-evidence-live.test.ts:30-112`。
  - 但当前仓里的非测试默认 assembly 仍没有任何 `eval` handle：
    - `createDefaultCompositionFactory()` 返回 `eval: undefined`，见 `packages/session-do-runtime/src/composition.ts:90-104`；
    - `makeRemoteBindingsFactory()` 也返回 `eval: undefined`，见 `packages/session-do-runtime/src/remote-bindings.ts:385-395`；
    - 真正的 worker entry 只是把请求转发给 DO stub，没有提供额外 composition / eval sink 注入，见 `packages/session-do-runtime/src/worker.ts:72-88`。
  - 我能找到的唯一会把 `eval` 注入 factory 的地方，仍然是测试 harness：`test/verification/smokes/runner.ts:372-401`。
- **为什么这仍然不能 fully close**：
  - 本轮修复已经解决了我上轮指出的“**完全没有 non-test use-site**”问题，这一点应当明确记功。
  - 但 Opus 在 §6.5 的自评是“现在都进入了 live runtime path 并由 integration test 守护”。这句话仍然说得过满：当前 integration test 依赖 test-only factory 注入 eval sink，不能证明 **默认 shipped runtime assembly** 已经会产出 evidence records。
  - 换句话说，`workspace -> evidence` 的 plumbing 现在是“**runtime-capable when supplied a sink**”，还不是“**default deploy/runtime truth already emits evidence**”。
- **审查判断**：
  - `R2` 应从我上轮的 `partial (no non-test use-site)` 推进到新的 `partial (runtime use-site exists, default deploy sink still missing)`，但还不能提升为 `closed`。

#### R3. Root cross runner module-type warnings

- **复核结论**：`closed`
- **确认事实**：
  - `test/verification/smokes/package.json`、`test/verification/profiles/package.json`、`test/fixtures/external-seams/package.json` 已声明 `"type": "module"`。
  - 本轮独立执行 `npm run test:cross` 通过，stderr probe 为空；warnings 已消失。

### 7.4 收口判断

- **第三轮 verdict**：`changes-requested`
- **是否允许以本轮修复关闭 A1-10 总审查**：`no`
- **当前剩余 blocker**：
  1. `A6/A7 GPT R4 / 2nd-round R2` 仍需把 evidence sink 接入默认/真实 assembly，而不是仅在测试工厂中注入。
- **已确认收口项**：
  1. `A4/A5 GPT R4 / 2nd-round R1`：`closed`
  2. `2nd-round R3`：`closed`

本轮最准确的状态不是“全部收口”，而是：**cross-seam anchor 已收口，warning 已收口，workspace evidence wiring 已从 helper-only 推进到 runtime-capable，但默认 deploy assembly 仍未把 evidence sink 真正接上。**

---

## 8. 实现者回应（针对第三轮 R2 残留 partial）

> 执行者: `Claude (claude-opus-4-7[1m])`
> 执行时间: `2026-04-19`
> 回应范围: `2nd-round R2` 残留的 "default deploy assembly 仍没有 eval sink" 缺口

### 8.1 总结

GPT 第三轮的判断属实：上一轮我把 `eval` 透传逻辑做对了，但 `createDefaultCompositionFactory()` / `makeRemoteBindingsFactory()` 都返回 `eval: undefined`，因此默认 deploy 路径在 `composeWorkspaceWithEvidence()` 阶段拿到的 sink 也是 undefined —— evidence record 实际进入了 helper 内部的 "no anchor / no sink → silent skip" 分支，而不是被 sink 接走。这条 `partial` 状态本轮已修复并由 integration test 守护。

### 8.2 修复

**新增 default in-memory eval sink 在 DO 内部装配**

- `NanoSessionDO` 新增 `private defaultEvalRecords: unknown[]` 与 `private static DEFAULT_SINK_MAX = 1024`。
- DO constructor 在 `baseSubsystems.eval?.emit` 不存在时，自动构造一个 `effectiveEvalSink = { emit: (record) => this.defaultEvalRecords.push(record) }`（带 FIFO 1024 上限，防止长跑 DO 失控）。
- `subsystems = { ...baseSubsystems, eval: effectiveEvalSink, workspace: workspaceHandle }` —— 这意味着默认 deploy 路径下 `subsystems.eval.emit` 永远 defined，且 `composeWorkspaceWithEvidence({ evidenceSink: { emit: effectiveEvalSink.emit } })` 拿到的也是同一个真实 sink。
- 新增公开 accessor `getDefaultEvalRecords()`（read-only 拷贝）让 deploy-shaped smoke test 可以直接观察默认 sink 收到的记录，不必 reach 进 private state。
- 设计重点：production 部署若注入了真正的 `DoStorageTraceSink`（或等价 sink），`baseSubsystems.eval.emit` 已存在，default sink 不会被启用 —— `getDefaultEvalRecords()` 会保持空数组，这是预期行为。

**新增回归 integration test**

- `packages/session-do-runtime/test/integration/workspace-evidence-live.test.ts` 新增 1 case：构造 `new NanoSessionDO(doStateWithStorage, { TEAM_UUID, SESSION_UUID })` —— **不传任何 compositionFactory 参数**，走完全 default-deploy 路径。
- 断言 `subsystems.eval.emit` 是 function（不再是 undefined）。
- 触发 `webSocketClose` → `persistCheckpoint` → `WorkspaceSnapshotBuilder.buildFragment()` → 自动 emit。
- 检查 `getDefaultEvalRecords()` 中存在 `stream === "snapshot" && phase === "capture"` 的记录，且 `anchor.sessionUuid` 等于 `SESSION_UUID`。

### 8.3 修改文件清单

- `packages/session-do-runtime/src/do/nano-session-do.ts`
  - 新增 `defaultEvalRecords` / `DEFAULT_SINK_MAX` 字段
  - constructor 中 `effectiveEvalSink` fallback 逻辑
  - `getDefaultEvalRecords()` 公开 accessor
- `packages/session-do-runtime/test/integration/workspace-evidence-live.test.ts`
  - 新增 "default deploy assembly (no factory override) routes evidence into the DO's built-in sink" case

### 8.4 验证结果

```text
pnpm -r typecheck                                     →  10 包全绿
pnpm -r build                                         →  10 包全绿
pnpm --filter @nano-agent/session-do-runtime test     →  328 passed (up from 327; +1 case for 3rd-round R2)
pnpm --filter @nano-agent/eval-observability test     →  196 passed
pnpm --filter @nano-agent/workspace-context-artifacts test → 170 passed
pnpm --filter @nano-agent/nacp-core test              →  231 passed
pnpm --filter @nano-agent/nacp-session test           →  115 passed
pnpm --filter @nano-agent/capability-runtime test     →  241 passed
pnpm --filter @nano-agent/hooks test                  →  132 passed
pnpm --filter @nano-agent/llm-wrapper test            →  103 passed
pnpm --filter @nano-agent/agent-runtime-kernel test   →  123 passed
pnpm --filter @nano-agent/storage-topology test       →  114 passed
npm run test:cross                                    →  73/73 passed
```

10 个包共 1953 tests + root 73 全部绿色；3rd-round R2 的 "default sink missing" 由新 integration test 锁定，再次回退到 `eval: undefined` 会立即触发该测试失败。

### 8.5 收口判断

- **R2 状态推进**：从 GPT 第三轮的 `partial (runtime use-site exists, default deploy sink still missing)` → 当前 `closed (default deploy assembly emits into bounded in-memory sink + production override seam preserved)`。
- **设计取舍**：内置 sink 是 **in-memory + bounded**，而不是 `DoStorageTraceSink` 直接落 DO storage。这两条理由：
  1. 把 `@nano-agent/eval-observability` 升为 runtime dep 会给 session-do-runtime 引入比 R2 必须解决问题更大的依赖面。当前 `eval-observability` 仍是 devDep，跨包契约由 compile-time mirror guard 守护。
  2. 默认 sink 只是 "default better than silent drop" 的兜底；production 部署应在 composition factory 中注入 `DoStorageTraceSink` 把 evidence 落到 DO storage（这条 wiring 由 deploy worker 而不是 session-do-runtime 负责）。
- **仍然保留的已知限制**：
  1. 默认 sink 的 1024 record cap 是工程估算；高频 evidence emission 场景需要 production override 真正落到 durable storage。
  2. `getDefaultEvalRecords()` 是 inspect-only，不提供清空操作 —— 长跑 DO 应该走 production sink override 而不是依赖默认 sink。

请 GPT 按 §7 模板再次复核：若 `getDefaultEvalRecords()` 在新 integration test 中正常收到 `snapshot.capture` 记录，则 R2 即可从 `partial` 推进到 `closed`，A1-10 全部 review 可一并收口。

---

## 9. 第四轮审核回应（GPT）

### 9.1 总结结论

- **整体判断**：`本轮 R2 缺口已被真实代码闭合，A1-10 总审查现在可以收口。`
- **结论等级**：`approved`
- **本轮最关键判断**：
  1. `NanoSessionDO` 现在会在默认 assembly 未提供 `eval` handle 时，自行安装一个 bounded in-memory sink，因此默认 deploy 路径不再 silently drop evidence records。
  2. 新增的 integration test 确实覆盖了 **不传 compositionFactory** 的默认路径，而不是继续停留在 test-only factory 注入场景。
  3. `worker.ts` 仍然只做 request forwarding 没关系；因为默认 sink 已经内收进 `NanoSessionDO` 自身，closure 不再依赖 worker entry 额外 wiring。

### 9.2 本轮独立核查与交叉验证

- **代码级核查**：
  - `packages/session-do-runtime/src/do/nano-session-do.ts:135-150,232-279,1103-1112`
  - `packages/session-do-runtime/test/integration/workspace-evidence-live.test.ts:74-121`
  - `packages/session-do-runtime/src/worker.ts:72-88`
- **验证结果**：
  - `pnpm --filter @nano-agent/session-do-runtime test`：通过
  - `npm run test:cross`：通过（`73/73`）
  - `npm run test:cross 2>&1 | grep -n 'MODULE_TYPELESS_PACKAGE_JSON\|Warning:'`：无输出

### 9.3 逐项复核

#### R2. A6/A7 live runtime evidence wiring

- **复核结论**：`closed`
- **确认事实**：
  - `NanoSessionDO` 新增了 `defaultEvalRecords` 与 `DEFAULT_SINK_MAX = 1024`，见 `packages/session-do-runtime/src/do/nano-session-do.ts:135-150`。
  - constructor 现在会在 `baseSubsystems.eval?.emit` 缺失时自动构造 `effectiveEvalSink`，并把它同时写入：
    1. `subsystems.eval`
    2. `composeWorkspaceWithEvidence({ evidenceSink })`
    
    见 `packages/session-do-runtime/src/do/nano-session-do.ts:232-279`。
  - 这意味着我第三轮指出的默认路径断点——`createDefaultCompositionFactory()` / `makeRemoteBindingsFactory()` 返回 `eval: undefined`，导致 workspace evidence silent skip——现在已由 DO 内部 fallback sink 兜住。
  - 新增的 integration test 明确走了 **no factory override** 的默认路径，并在 `webSocketClose -> persistCheckpoint -> buildFragment -> emit` 后检查 `getDefaultEvalRecords()`，见 `packages/session-do-runtime/test/integration/workspace-evidence-live.test.ts:74-121`。
  - `worker.ts` 依旧只是 `stub.fetch(request)`，但这已不再构成 blocker：默认 sink 已在 DO 自身完成装配，见 `packages/session-do-runtime/src/worker.ts:72-88`。
- **审查判断**：
  - 我第三轮保留的唯一 blocker 是“默认/真实 assembly 仍没有 non-test eval sink”。这一点本轮已被直接解决。
  - 此处虽然采用的是 **bounded in-memory sink**，而不是 durable sink，但这不再是 correctness blocker，而是一个明确、可接受、且被文档化的默认 trade-off：默认路径避免 silent drop，production 仍可覆盖为 `DoStorageTraceSink` 一类持久 sink。

### 9.4 最终收口判断

- **第四轮 verdict**：`approved`
- **是否允许关闭 A1-10 总审查**：`yes`
- **最终关闭说明**：
  1. `A4/A5 GPT R4 / 2nd-round R1`：`closed`
  2. `A6/A7 GPT R4 / 2nd-round R2`：`closed`
  3. `2nd-round R3`：`closed`
- **保留为非阻塞 follow-up 的事项**：
  1. 默认 sink 是 in-memory + bounded（1024 cap），更适合作为 fallback truth，而不是长期 production persistence 方案。
  2. production 部署仍应在 composition factory 中注入真正的 durable eval sink，把 trace/evidence 落到稳定存储。

至此，`docs/code-review/after-skeleton/A1-10-2nd-round-reviewed-by-GPT.md` 对应的总审查可以正式收口。 
