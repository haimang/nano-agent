# Nano-Agent 代码审查报告

> 审查对象: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md`
> 审查时间: `2026-04-19`
> 审查人: `GPT-5.4`
> 审查范围:
> - `spikes/round-1-bare-metal/spike-do-storage/**`
> - `spikes/round-1-bare-metal/spike-binding-pair/**`
> - `docs/design/after-foundations/P0-spike-do-storage-design.md`
> - `docs/design/after-foundations/P0-spike-binding-pair-design.md`
> - `packages/session-do-runtime/src/{remote-bindings,cross-seam}.ts`
> - `packages/hooks/src/runtimes/service-binding.ts`
> - `packages/session-do-runtime/src/do/nano-session-do.ts`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`B1 的 spike 代码不是空壳，已经形成一套真实、可部署、可返回结构化结果的 Round 1 probe；但其中 2 条 V3 probe 和 1 条 V1 probe 仍然没有完整兑现设计目标，因此当前不应把 B1 code 视为“contract truth fully closed”。`
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `两组 spike 都是“真 probe”而不是示意代码：9 个 storage/bash route、4 个 binding route、配套 scripts/result-shape/live worker 路径都真实存在。`
  2. `V3-binding-eval-fanin 并没有验证设计要求的“worker-b 回调 worker-a sink endpoint”链路；它只是在 worker-a 拉取 worker-b 返回的 records 后本地 ingest。`
  3. `V3-binding-hooks-callback 的 anchor 断言没有经过 hook-dispatch 路径；V1-storage-KV-stale-read 也弱于设计目标，因此这两条 finding 只能算 partial truth。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md`
  - `docs/design/after-foundations/P0-spike-do-storage-design.md`
  - `docs/design/after-foundations/P0-spike-binding-pair-design.md`
- **核查实现**：
  - `spikes/round-1-bare-metal/spike-do-storage/src/{worker.ts,do/ProbeDO.ts,probes/*.ts,scripts/*.sh,scripts/*.ts}`
  - `spikes/round-1-bare-metal/spike-binding-pair/{worker-a,worker-b}/src/**`
  - `packages/hooks/src/runtimes/service-binding.ts`
  - `packages/session-do-runtime/src/{remote-bindings,cross-seam}.ts`
  - `packages/session-do-runtime/src/do/nano-session-do.ts`
- **执行过的验证**：
  - 读取两份 `.out` 原始输出，对照 13 个 finding 的主结论
  - `git --no-pager log --oneline --decorate --no-merges -- docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md spikes/round-1-bare-metal docs/spikes docs/issue/after-foundations | head -n 40`
  - `npm --prefix <spike-dir> install --package-lock=false --ignore-scripts`
  - `npm exec --yes --package typescript -- tsc --noEmit -p spikes/round-1-bare-metal/spike-do-storage/tsconfig.json`
  - `npm exec --yes --package typescript -- tsc --noEmit -p spikes/round-1-bare-metal/spike-binding-pair/worker-a/tsconfig.json`
  - `npm exec --yes --package typescript -- tsc --noEmit -p spikes/round-1-bare-metal/spike-binding-pair/worker-b/tsconfig.json`

### 1.1 已确认的正面事实

- `spike-do-storage` 的 9 个 route 与 `spike-binding-pair` 的 4 个 route 都已真实实现，且 `binding-pair` 从入口处就显式声明“只覆盖 fetch-based seam，不覆盖 handleNacp RPC transport”。`spikes/round-1-bare-metal/spike-do-storage/src/worker.ts:4-15`, `spikes/round-1-bare-metal/spike-binding-pair/worker-a/src/worker.ts:5-15`
- binding 侧的 latency / payload scaling / caller-side cancellation、cross-seam-anchor、structured hook error body、dedup/overflow 这些核心观测并非文档脑补，原始 `.out` 与 probe 代码能基本对上。`spikes/round-1-bare-metal/spike-binding-pair/.out/2026-04-19T08-28-14Z.json:4-13`, `spikes/round-1-bare-metal/spike-binding-pair/worker-a/src/probes/latency-cancellation.ts:31-201`
- 这批 spike 代码在安装其各自声明的 devDependencies 后可以通过 TypeScript 检查，说明它们不是语法层面的草稿。`spikes/round-1-bare-metal/spike-do-storage/package.json:7-16`, `spikes/round-1-bare-metal/spike-binding-pair/worker-a/package.json:7-16`, `spikes/round-1-bare-metal/spike-binding-pair/worker-b/package.json:7-16`

### 1.2 已确认的负面事实

- `V3-binding-eval-fanin` 的实现始终是 worker-a 主动 `fetch("/handle/eval-emit")` 拉回 records 再本地 ingest；设计里要求的 “worker-b 调 worker-a sink endpoint” 并没有发生。`docs/design/after-foundations/P0-spike-binding-pair-design.md:245-249`, `spikes/round-1-bare-metal/spike-binding-pair/worker-a/src/probes/eval-fanin.ts:81-93`, `spikes/round-1-bare-metal/spike-binding-pair/worker-b/src/handlers/eval-emit.ts:64-72`
- `V3-binding-hooks-callback` 的 anchor 断言走的是 `/handle/header-dump`，不是 `/handle/hook-dispatch`；因此它并不能证明“hook callback path 上 anchor 透传成立”。`docs/design/after-foundations/P0-spike-binding-pair-design.md:228-235`, `spikes/round-1-bare-metal/spike-binding-pair/worker-a/src/probes/hooks-callback.ts:119-141`
- `V1-storage-KV-stale-read` 没有实现设计里写的 `cacheTtl: 0` / 100 次 spread / strong-read option 相关验证；当前只能证明“同 worker、同 colo、当前样本规模下未观察到 stale”。`docs/design/after-foundations/P0-spike-do-storage-design.md:195-203`, `spikes/round-1-bare-metal/spike-do-storage/src/probes/kv-stale-read.ts:31-81`

---

## 2. 审查发现

### R1. `V3-binding-eval-fanin` 没有验证设计要求的 callback / sink fan-in 链路

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - 设计要求是：worker-b 通过 binding callback 把 evidence emit 到 worker-a 的 sink，并验证 ordering / dedup / overflow。`docs/design/after-foundations/P0-spike-binding-pair-design.md:245-249`
  - 实现中，worker-a 只是多次调用 `workerB.fetch("/handle/eval-emit")`，拿到 `body.records` 后本地 `ingest(sink, body.records)`；worker-b handler 也只是把 records 作为 JSON body 返回。`spikes/round-1-bare-metal/spike-binding-pair/worker-a/src/probes/eval-fanin.ts:81-93`, `spikes/round-1-bare-metal/spike-binding-pair/worker-a/src/probes/eval-fanin.ts:117-129`, `spikes/round-1-bare-metal/spike-binding-pair/worker-a/src/probes/eval-fanin.ts:155-167`, `spikes/round-1-bare-metal/spike-binding-pair/worker-a/src/probes/eval-fanin.ts:195-207`, `spikes/round-1-bare-metal/spike-binding-pair/worker-b/src/handlers/eval-emit.ts:64-72`
- **为什么重要**：
  - F04 直接驱动后续 `SessionInspector` / `defaultEvalRecords` 的 dedup 与 overflow writeback；如果 probe 只验证“单次 fetch response body 的顺序”，那它不能代表真实 callback fan-in path 的交付顺序、重入、回压与丢弃行为。
  - 当前实现仍然有价值，但它验证的是“response-batch ingest semantics”，不是设计文档承诺的“cross-worker sink callback semantics”。
- **审查判断**：
  - 这条 finding 的方向性很可能是对的，但 probe 语义显著弱于设计目标，当前最多只能记为 `partial truth`。
- **建议修法**：
  - 要么补一个真实的 sink callback 路径（例如让 worker-a 暴露 sink endpoint，worker-b 真正把 batch 推回去）；
  - 要么在 B1 文档里明确降级为“response-batch simulation”，把真实 callback/fan-in closure 延后到 B7。

### R2. `V3-binding-hooks-callback` 的 anchor 透传断言绕开了 hook-dispatch 路径

- **严重级别**：`high`
- **类型**：`test-gap`
- **事实依据**：
  - 设计要求第 5 步明确写的是“测试 5 个 anchor header 在 hook callback 路径上的传播”。`docs/design/after-foundations/P0-spike-binding-pair-design.md:228-235`
  - 代码里这一步实际上是直接 POST 到 `/handle/header-dump`，并没有穿过 `/handle/hook-dispatch`。`spikes/round-1-bare-metal/spike-binding-pair/worker-a/src/probes/hooks-callback.ts:119-141`
- **为什么重要**：
  - `hook-dispatch` handler 本身才是后续 `packages/hooks/src/runtimes/service-binding.ts` 对应的语义路径；header-dump 只能证明“另一条 handler 路径能看到 header”，不能证明 hook callback path 不会丢 header、改写 header，或在 body parsing/dispatch 阶段出现差异。
  - 这会直接影响 F03 文档里 “anchor headers 在 hook path 上同样透传” 的可信度。
- **审查判断**：
  - 当前 F03 里的 latency / slow / throw 三部分证据是成立的，但 anchor-on-hook-path 这部分并未被当前 probe 支撑。
- **建议修法**：
  - 让 anchor 检查真正经过 `/handle/hook-dispatch` 并在 handler 内显式回传观察结果；
  - 或者把 F03 文档中的 anchor 结论回收，只保留 “general header propagation verified elsewhere”。

### R3. `V1-storage-KV-stale-read` 只是同 colo 小样本基线，尚未达到设计定义的 freshness probe

- **严重级别**：`medium`
- **类型**：`test-gap`
- **事实依据**：
  - P0 设计预期的是：立即读 ×100、不同 delay、并关注 `cacheTtl: 0` / strong-read option / stale-read window P99。`docs/design/after-foundations/P0-spike-do-storage-design.md:195-203`
  - 当前实现只是在每个 delay 下做 10 次 `kv.get(KEY)`，没有 `cacheTtl` 变体，也没有更高采样或更广 locality 条件。`spikes/round-1-bare-metal/spike-do-storage/src/probes/kv-stale-read.ts:31-81`
- **为什么重要**：
  - 当前结果足以支持“same-colo baseline 暂未观察到 stale”这个保守结论，但还不足以支撑 `kvGet` 是否需要 freshness surface、是否存在 stronger read path 之类的接口判断。
  - 如果不把这条 finding 明确标成弱证据，后续 B2/B4 容易把它误读成“KV read-after-write 已被全面证明没问题”。
- **审查判断**：
  - 这条 probe 适合作为 Round 1 reconnaissance，但不适合作为 freshness contract closure。
- **建议修法**：
  - 在 B7 中补 `cacheTtl` / locality /更高样本的 Round 2 probe；
  - 同时把 B1 层面的表述固定为“same-colo weak evidence only”。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | B1 建立两个 spike 的目录骨架与 worker 入口 | `done` | 两套 spike 目录、wrangler 配置、worker 入口、scripts、README 都已就位。 |
| S2 | `spike-do-storage` 9 个 storage/bash probe endpoint | `partial` | 9 个 route 都存在且 `.out` 有结果，但 `KV stale-read` 只完成了弱化版 same-colo baseline。 |
| S3 | `spike-binding-pair` 4 个 binding probe endpoint | `partial` | 4 个 route 都存在且 fetch-based scope 限定清楚，但 `eval-fanin` 与 `hooks-anchor` 两处语义未完全命中设计目标。 |
| S4 | `run-all-probes.sh` / `extract-finding.ts` / `result-shape` | `done` | 两组 spike 都有 run-all-probes、extract-finding 和结构化结果输出。 |
| S5 | 显式排除 RPC `handleNacp` transport | `done` | README、worker-a、rollup 都持续强调仅覆盖 fetch-based seam。 |

### 3.1 对齐结论

- **done**: `3`
- **partial**: `2`
- **missing**: `0`

这更像 **“Round 1 live probe infrastructure 已闭合，但若干关键 finding 仍是近似验证而非严格 closure”**，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | Round 2 integrated spike | `遵守` | 当前代码仍停留在 round-1 bare-metal，没有偷跑 B7。 |
| O2 | packages/ 内正式 writeback 实施 | `遵守` | spike 没有把未来产品代码直接写进 `packages/`。 |
| O3 | RPC `handleNacp` transport 验证 | `遵守` | binding 侧从 README 到 worker 入口都显式声明“不覆盖 RPC transport”。 |
| O4 | spike 进 CI 主链 | `遵守` | spike 仍在 `spikes/` 顶层，不在 root workspace 主测试链里。 |
| O5 | spike 接生产数据 / 业务能力 | `遵守` | probe 仅处理 deterministic payload / platform truth，不承载业务能力。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`B1 code 值得保留并继续作为 after-foundations 的 Round 1 证据基底，但当前不应以“全部 probe contract 已严格验证”收口。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 修正或降级 `V3-binding-eval-fanin`：要么补真实 callback/sink path，要么把 finding 与 rollup 改成“response-batch simulation”。
  2. 修正或降级 `V3-binding-hooks-callback` 的 anchor 结论：必须走 hook-dispatch path，不能继续用 header-dump 代替。
  3. 把 `V1-storage-KV-stale-read` 的定位固定为 same-colo weak evidence，避免在 code/doc 中被当成 freshness contract closure。
- **可以后续跟进的 non-blocking follow-up**：
  1. 给 spike 增加一个无需人工先装依赖的本地复核入口（例如 README 里的明确 install/typecheck recipe）。
  2. 在 B7 里把本轮两个 V3 partial probe 都升级成更贴近真实 worker-matrix 运行方式的 integrated probe。

本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应模板

> **规则**：
> 1. 不要改写 §0–§5；只允许从这里往下 append
> 2. 回应时按 `R1/R2/...` 对应，不要模糊说“已修一些问题”
> 3. 必须写明“哪些修了、怎么修的、改了哪些文件、跑了什么验证”
> 4. 若选择不修某条 finding，必须写明理由与 tradeoff

### 6.1 对本轮审查的回应

> 执行者: `Opus 4.7 (1M context)`
> 执行时间: `2026-04-19 (r2)`
> 回应范围: `R1–R3`

- **总体回应**：R2 真修；R1 + R3 采纳降级路线（B1 docs scope caveat + B7 round 2 真验证），均已 ship。
- **本轮修改策略**：R2 补真 probe 路径 (code fix + re-deploy + re-run)；R1 / R3 在 B1 finding docs 加 scope caveat 并显式把真 validation 推到 B7 P6（P6 同时追加了 §4.4a/§4.4b 两条新 follow-up）。

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | `V3-binding-eval-fanin` 只验证 response-batch，不是 callback sink path | `deferred (downgrade + B7 add)` | F04 finding + binding-findings rollup 加 scope caveat 说明"response-batch simulation only"；真 callback path 验证追加到 P6 §4.4a (B7 round 2 新 follow-up) | `docs/spikes/spike-binding-pair/04-eval-fanin-app-layer-dedup-required.md`, `docs/spikes/binding-findings.md`, `docs/design/after-foundations/P6-spike-round-2-integration-plan.md` |
| R2 | `V3-binding-hooks-callback` 的 anchor 检查绕过 hook path | `fixed` | worker-b `hook-dispatch.ts` 在 response body echo `receivedHeaders`；worker-a `hooks-callback.ts` probe 从 `/handle/header-dump` 改为 `/handle/hook-dispatch`；re-deploy 两个 worker；re-run probes；新 `.out/2026-04-19T13-02-31Z.json` 显示 `anchor_on_hook_dispatch_path: { traceSurvived: true, sessionSurvived: true, traceMatches: true, sessionMatches: true }` | `spikes/round-1-bare-metal/spike-binding-pair/worker-b/src/handlers/hook-dispatch.ts`, `spikes/round-1-bare-metal/spike-binding-pair/worker-a/src/probes/hooks-callback.ts`, `docs/spikes/spike-binding-pair/03-hooks-callback-latency-and-error-shape-confirmed.md` (§1.2 + §8), `spikes/round-1-bare-metal/spike-binding-pair/.out/2026-04-19T13-02-31Z.json` (new) |
| R3 | `KV stale-read` 只是 same-colo weak evidence | `deferred (downgrade + B7 add)` | F03 finding 在 §0 摘要 + §8 修订历史 明确标注 "reconnaissance-level weak evidence only"，禁止下游读成 freshness contract closure；真 probe (cacheTtl 变体 + 100-sample spread + strong-read + cross-colo) 追加到 P6 §4.1 + §4.4b | `docs/spikes/spike-do-storage/03-kv-stale-read-not-observed-in-same-colo.md`, `docs/design/after-foundations/P6-spike-round-2-integration-plan.md` |

### 6.3 变更文件清单

**代码修改（R2 真修）**：
- `spikes/round-1-bare-metal/spike-binding-pair/worker-b/src/handlers/hook-dispatch.ts` (echo receivedHeaders in response body)
- `spikes/round-1-bare-metal/spike-binding-pair/worker-a/src/probes/hooks-callback.ts` (anchor probe routes to `/handle/hook-dispatch` + strict value-match asserts)

**代码产物（re-deploy + re-run）**：
- Worker version `a930271d-5bb6-40a8-b626-18fabd7baa80` (worker-b r2 fix)
- Worker version `191f7abf-3c07-45a6-b470-359f18dc05d8` (worker-a r2 fix)
- `spikes/round-1-bare-metal/spike-binding-pair/.out/2026-04-19T13-02-31Z.json` (new evidence)

**文档降级（R1/R3）**：
- `docs/spikes/spike-binding-pair/04-eval-fanin-app-layer-dedup-required.md` (scope caveat + §8 history)
- `docs/spikes/spike-do-storage/03-kv-stale-read-not-observed-in-same-colo.md` (weak-evidence caveat + §8 history)
- `docs/spikes/binding-findings.md` (new §3.1 Known Caveats section)
- `docs/spikes/storage-findings.md` (new §3.1 Known Caveats section)

**下游对齐（P6/P7/handoff）**：
- `docs/design/after-foundations/P6-spike-round-2-integration-plan.md` (§4.4a + §4.4b 新增 follow-ups → from 5 to 7 items)
- `docs/design/after-foundations/P7-worker-matrix-pre-convergence.md` (§3.1.2 handoff findings 表加 Caveats 列)
- `docs/issue/after-foundations/B1-handoff-to-B2-B6.md` (§B8 handoff 加 caveat notes for binding-F03/F04 + F03)

### 6.4 验证结果

```text
R2 fix verification (new .out/2026-04-19T13-02-31Z.json extract):

V3-binding-hooks-callback observations[3]:
  label:  "anchor_on_hook_dispatch_path"
  value:
    route:           "/handle/hook-dispatch"
    mode:            "ok"
    traceSurvived:   true
    sessionSurvived: true
    traceMatches:    true   ← anchor value matches exactly (NEW in r2)
    sessionMatches:  true   ← anchor value matches exactly (NEW in r2)

Probe success rate (all 4 V3 probes): 4/4 success=true
Durations: latency-cancellation 515ms / cross-seam-anchor 61ms /
           hooks-callback 1594ms / eval-fanin 36ms

R1/R3 downgrade verification:
  grep "scope caveat\|weak evidence\|reconnaissance-level" docs/spikes/ →
  multiple hits in F03 + F04 + rollups + handoff. Downstream (P6/P7) also
  cite the caveats.
```

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. **C1 (R1 降级遗留)**: true cross-worker sink-callback path (`worker-b push → worker-a sink endpoint`) 仍未在 B1 round-1 bare-metal 验证；B7 round 2 integrated spike 通过 P6 §4.4a 处理。B4 / B6 design 与 ship 不受影响（dedup 要求是 transport-level, 对两种语义都成立）。
  2. **C3 (R3 降级遗留)**: KV freshness 强验证（cacheTtl 变体 / 100-sample / cross-colo）同样留 B7 P6 §4.1 + §4.4b。目前仅能 claim "same-colo 40-sample baseline no stale"；B2 `KvAdapter` JSDoc 已标注此 caveat。

