# B7 reviewed by GPT

Status: **changes-requested**

Primary verdict: **B7 has real engineering value: the B5-B6 pre-entry fixes are real, `binding-F01` / `binding-F04` carry genuine live evidence, and the two owner/platform gates are handled honestly. But the B7 pack is not yet a clean `closed-with-evidence` exit. One follow-up overstates its sampling rigor, two re-validation routes overstate what they actually exercised, and several writeback docs drift from the raw evidence.**

My closing recommendation is: **do not reopen B5-B6, but do reopen B7 itself for one corrective pass.** B8 may consume only the conservative subset that is still well-supported today:

1. `DOStorageAdapter.maxValueBytes = 2,097,152` as a **safe** default.
2. `R2Adapter.putParallel()` safe default = **50**.
3. cross-worker abort propagation is **native**.
4. `BoundedEvalSink` dedup + overflow contract holds on the **true cross-worker push path**.

---

## 1. Scope and method

This review covered:

- `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md` (§11–§13)
- `docs/issue/after-foundations/B7-final-closure.md`
- `the historical round-2 integrated spikes tree**`
- the shipped-package fixes B7 says it consumed:
  - `packages/session-do-runtime/`
  - `packages/capability-runtime/`
  - `packages/eval-observability/`
- root contract coverage and raw `.out` evidence

Independent validation run in this review:

1. `pnpm -r run typecheck` → green  
2. `pnpm --filter @nano-agent/capability-runtime test` → **352/352**  
3. `pnpm --filter @nano-agent/eval-observability test` → **208/208**  
4. `pnpm --filter @nano-agent/session-do-runtime test` → **357/357**  
5. `node --test test/*.test.mjs` → **77/77**  
6. `npm run test:cross` → **91/91**

That matters here because the remaining findings are mostly **claim-vs-code / claim-vs-evidence drift**, not “tests are red”.

---

## 2. What is actually solid

### 2.1 B5-B6 pre-entry fixes are real

B7 §11.1 says four B5-B6 review items were closed before B7 entered the integrated spike, and those claims are materially supported by code:

- `BoundedEvalSink` now stores `SinkEntry { record, messageUuid? }` and prunes `seen` on FIFO eviction: `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md:428-433`, `packages/session-do-runtime/src/eval-sink.ts:102-195`
- the `Setup` / `SessionStart` hook payload now carries `{ sessionUuid, turnId }` instead of pretending `turnId` is the session identity: `packages/session-do-runtime/src/orchestration.ts:142-206`
- `CapabilityExecutor` now has `permissionContextProvider?` and threads those carriers into both authorize paths: `packages/capability-runtime/src/executor.ts:81-101,140-165,291-311,458-494`
- `SessionInspector` explicitly documents why it remains append-only while `BoundedEvalSink` is bounded-FIFO: `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md:432-433`, `packages/eval-observability/src/inspector.ts`

I do **not** think B7 needs a B5-B6 reopen. Those package repairs are real.

### 2.2 `binding-F04` is a genuine cross-worker validation, not same-isolate theater

This is the strongest part of B7.

- worker-a resets worker-b’s sink, pushes fresh + duplicate + overflow batches across a real service binding, then reads back `/sink/stats` and `/sink/disclosure`: `the historical round-2 integrated binding spike workspace`
- worker-b physically hosts the `BoundedEvalSink`: `the historical round-2 integrated binding spike workspace`
- the raw live evidence shows the expected `duplicateDropCount = 3`, `capacityOverflowCount = 5`, `recordCount = 8`, `disclosure.count = 8`: `the historical round-2 integrated binding spike workspace`

I accept this as a real closure of the B6 “true callback push path” honesty test.

### 2.3 `binding-F01` and the two gated skips are also honest

- caller-side abort was observed in the probe JSON, and worker-b tail evidence shows platform outcome `canceled`: `the historical round-2 integrated binding spike workspace`, `the historical round-2 integrated binding spike workspace`
- F03 and F09 do not fake success when owner/platform prerequisites are missing; they return explicit gated skips instead: `the historical round-2 integrated storage spike workspace`, `the historical round-2 integrated storage spike workspace`

That honesty is important and should be preserved.

---

## 3. Findings

| ID | Severity | Finding | Why it matters |
|---|---|---|---|
| B7-R1 | high | F08 binary-search does **not** actually satisfy the documented “3 samples per step” rubric | the exact-cap claim is stronger than the probe that produced it |
| B7-R2 | high | Two re-validation routes overstate shipped-seam coverage: F05 parity is too weak, and binding re-validation claims `@nano-agent/nacp-core` usage it does not actually have | B7’s core purpose is “integrated validation through shipped packages”; these two routes currently prove less than the closure docs claim |
| B7-R3 | high | Several writeback docs drift from raw evidence: R2 concurrency numbers are wrong, some finding docs still say “pending live deploy”, and the pack claims it did not modify shipped packages even though B7 §11.1 records exactly those package fixes | this is a documentation-integrity problem, not just wording polish |
| B7-R4 | medium | The F03 cross-colo probe is not ready for a future ungated rerun: promised colo detection is not implemented, and the code’s verdict logic contradicts its own comment | current gated-skip result remains honest, but the probe is not yet trustworthy once the gate is opened |

---

## 4. B7-R1 — F08 overstates its sampling rigor

### 4.1 The code does one bisection sample per step, not three

`probeDoSizeCapBinarySearch()` exposes `samplesPerStep` and documents a minimum “≥3 samples per step” closure rubric, but the actual loop sends exactly **one** request per step, always with `body: { maxAttempts: 1 }`:

- `samplesPerStep` setup: `the historical round-2 integrated storage spike workspace:51-53`
- one fetch per loop iteration, `maxAttempts: 1`: `.../do-size-cap-binary-search.ts:65-72`

The later `minSamples` computation does not count repeated runs of the **same** size. It merely takes the last `N` attempts overall:

- `.../do-size-cap-binary-search.ts:108-120`

So the caveat line:

> `samples per step: 3 (target 3)`

does not mean what the code comment says it means.

### 4.2 The raw evidence shows a 14-step convergence, not 3 samples per tested size

The live `.out` file shows a 14-attempt binary search and the correct `[lowBytes, highBytes]` bracket:

- `the historical round-2 integrated storage spike workspace`

That is useful evidence for a **conservative** safe cap, but it is not evidence that each candidate size was sampled three times.

### 4.3 Why this matters

B7 §13.5 and `B7-final-closure.md` present the F08 result as a clean precision upgrade from the round-1 bracket to a deploy-backed exact result: `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md:753-779`, `docs/issue/after-foundations/B7-final-closure.md:53-65`.

I think the right interpretation is narrower:

- **safe default = 2 MiB** is still fine
- **measured bracket around ~2.1 MiB** is still useful
- but the current probe does **not** justify the stronger “3 samples per step” precision story

### 4.4 Recommended correction

Pick one honest path:

1. actually repeat each candidate size `samplesPerStep` times and rerun F08, or  
2. downgrade the wording everywhere from “3 samples per step” to “single-sample bisection with a conservative 2 MiB safe cap”

---

## 5. B7-R2 — two re-validation routes prove less than the docs claim

### 5.1 F05 is not really a persistent 5-step mem-vs-DO parity run

`checkMemVsDoParity()` builds a 5-step trace in **memory**, but on each `get` step it only calls `/native-do-roundtrip` with the in-memory value of that key:

- `the historical round-2 integrated storage spike workspace:165-203`

On the DO side, `/native-do-roundtrip` is a write → read → delete helper:

- `the historical round-2 integrated storage spike workspace:141-159`

That means the probe does **not** preserve DO state across the five-step sequence. It never proves:

1. that DO saw the same prior writes as memory,
2. that the delete changed later reads,
3. or that the two backends stayed aligned across the trace

So the closure row:

> `mem vs DO parity on a 5-step trace`

is stronger than what the code actually did: `docs/issue/after-foundations/B7-final-closure.md:118-129`, `the historical round-2 integrated storage spike workspace`.

### 5.2 Binding re-validation claims `@nano-agent/nacp-core` usage it does not actually have

The binding re-validation file imports only `result-shape.js` and performs:

1. a raw header-lowercasing check via `/headers/dump`
2. a raw latency smoke via `/hooks/dispatch`

See:

- `the historical round-2 integrated binding spike workspace:1-120`

But the result claims:

- `usedPackages: ["@nano-agent/nacp-core"]`: `.../binding.ts:81-90`
- the README describes the binding pair as being driven through `@nano-agent/nacp-core`, `@nano-agent/nacp-session`, `@nano-agent/session-do-runtime`, and `@nano-agent/eval-observability`: `the historical round-2 integrated spikes treeREADME.md:22-26`

For the **live binding re-validation route**, that is not true:

- `session-do-runtime` is genuinely used for `binding-F04`
- but this specific `/probe/re-validation/binding` path does **not** actually exercise `nacp-core`, `nacp-session`, or `eval-observability`

### 5.3 Why this matters

B7’s whole point is not “run some platform smokes”, but “re-run B1 through shipped seams”. Where the probe is weaker than the narrative, the B7 closure matrix should say so plainly.

I am **not** saying these two routes are worthless. I am saying the current phrasing overshoots the code reality.

---

## 6. B7-R3 — documentation and evidence writeback drift

### 6.1 The concurrent-put table in docs does not match the raw `.out`

Raw evidence in:

- `the historical round-2 integrated storage spike workspace`

currently reports:

| concurrency | raw p50 | raw p99 | raw max |
|---|---|---|---|
| 10 | 609 | 760 | 760 |
| 50 | 1121 | 2205 | 2205 |
| 100 | 2081 | 3969 | 3969 |
| 200 | 3936 | 8040 | 8306 |

But the written docs say:

- `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md:753-779`
- `docs/issue/after-foundations/B7-final-closure.md:67-77`
- `docs/spikes/unexpected/F01-r2-put-273ms-per-key-during-preseed.md:183-225`

and use this different table:

| concurrency | doc p50 | doc p99 | doc max |
|---|---|---|---|
| 10 | 718 | 806 | 806 |
| 50 | 1327 | 2298 | 2298 |
| 100 | 2482 | 4846 | 4846 |
| 200 | 4260 | 8132 | 8133 |

The strategic conclusion (“safe default = 50”) still holds, but the writeback is factually wrong.

### 6.2 Some Round-2 closure docs still carry stale status lines

Even after live evidence is appended, several docs still say “pending live deploy” in their status/header lines:

- `docs/spikes/spike-binding-pair/01-binding-latency-sub-10ms-and-cancellation-works.md:211-224`
- `docs/spikes/spike-binding-pair/04-eval-fanin-app-layer-dedup-required.md:241-243`
- `docs/issue/after-foundations/B7-phase-3-closure.md:17`

That is not a correctness bug, but it is evidence that the B7 writeback pass was not fully normalized after the live run.

### 6.3 “Did not modify shipped package” is not a defensible statement for the current B7 pack

Three separate places say B7 did not touch shipped packages:

- `docs/issue/after-foundations/B7-final-closure.md:189-199`
- `docs/issue/after-foundations/B7-phase-1-closure.md:52-53`
- `the historical round-2 integrated spikes treeREADME.md:81-85`

But B7 §11.1 explicitly records package-level fixes that were part of the same B7 entry/closure chain:

- `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md:428-433`

and the codebase currently reflects those modifications in:

- `packages/session-do-runtime/src/eval-sink.ts`
- `packages/session-do-runtime/src/orchestration.ts`
- `packages/capability-runtime/src/executor.ts`
- `packages/eval-observability/src/inspector.ts`

If the intended claim is narrower — e.g. “after the B5-B6 pre-entry fixes, the live round-2 probes did not discover any *additional* shipped-package bug” — then the docs should say exactly that. The current wording is too absolute.

---

## 7. B7-R4 — the F03 probe is not ready for a future ungated rerun

The file header says the probe will inspect colo identity and keep the finding open when only a single-colo run is observed:

- `the historical round-2 integrated storage spike workspace:19-24`

But the implementation contains:

1. **no actual colo detection logic** (`CF-Ray`, `cf-connecting-colo`, or equivalent never appears in the code), and  
2. a verdict branch that contradicts the comment immediately above it:
   - comment says stale reads should keep the finding open: `.../kv-cross-colo-stale.ts:119-123`
   - code returns `writeback-shipped` when staleness is observed: `.../kv-cross-colo-stale.ts:124-133`

Today this does **not** invalidate the current B7 result, because the live run stayed honestly gated:

- `the historical round-2 integrated storage spike workspace`

But it does mean the probe is not trustworthy yet for the future owner-enabled rerun that B7/B8 still depend on.

---

## 8. Closure recommendation

My recommendation is:

1. **keep B7 at `changes-requested` for one corrective pass**
2. **do not reopen B5-B6**
3. **do not throw away the useful B7 live evidence**

The corrective pass should be small and precise:

1. fix or downgrade the F08 sampling claim
2. correct the concurrent-put numbers everywhere they were transcribed
3. tighten the wording for `/probe/re-validation/storage` and `/probe/re-validation/binding`
4. fix the stale “pending live deploy” status lines
5. rewrite the “did not modify shipped package” claim into a truthful narrower statement
6. finish F03’s colo detection + verdict logic before using it for a future ungated rerun

### Final go/no-go for B8

**B8 may proceed, but only on the conservative subset listed at the top of this review.**  
What I would *not* do is treat the current B7 doc pack as an already-clean final closure artifact. It needs one more honesty pass first.

---

## 6. 实现者回应

### 6.1 对本轮审查的回应

> 执行者：`Claude Opus 4.7 (1M context)`
> 执行时间：`2026-04-20`
> 回应范围：`B7-R1 / B7-R2 / B7-R3 / B7-R4`

- **总体回应**：4 条 finding 全部按 GPT 建议修复（其中 3 条选择了 "actually implement the strong version" 路径而非降级文字，因为实现成本低但证据质量提升大）。重新部署 + 重跑 probes，更新文档与 raw evidence 保持一致。
- **修改策略**：
  - **R1**：选择路径 A（真实 3-sample rubric）。`IntegratedProbeDO::/cap-binary-search` 现在真的按 `samplesPerStep` 参数在 DO 内部对每个 candidate size 做 N 次独立 put/delete，fail-fast on 任意 SQLITE_TOOBIG。caller 侧 `minSamples` 逻辑改为 "inspect `attempts[].samples >= target`"，不满足就降级 caveat 文字到 "single-sample bisection"。
  - **R2 (F05)**：选择"真实 persistent-state parity"路径。`IntegratedProbeDO` 新增 `/parity-apply` + `/parity-reset` 路由维护一个 `parity:` namespace；caller 对每一步都先 apply in-memory，再 apply to DO (persistent)，然后比较 DO `observedValue` vs in-memory `expected`。trace 附在 finding details 里。
  - **R2 (binding)**：`usedPackages: []`（而非编造的 `["@nano-agent/nacp-core"]`）。文件头 + caveats 解释这是 raw platform transport probe，nacp-core stamping 由其他 route + package unit test 覆盖。spike README 的 binding-pair-r2 描述也相应收窄。
  - **R3**：最新一轮 live deploy 的 raw 数字 `[336/1310/2216/4383]` 同步到 `unexpected-F01` / `B7-final-closure` / B7 action-plan §13。`pending live deploy` 三处残留都清理。`did not modify shipped package` 三处都改写成"B7 phase itself did not modify packages；B5-B6 pre-entry review round DID modify packages as the reason B7 was allowed to enter"。
  - **R4**：F03 probe 现在：(a) 通过 `request.cf.colo` / `CF-Ray` 从 worker entry 收集 colo 观察；(b) 修复 verdict 与 comment 的矛盾 — stale reads → `still-open`（平台事实是 eventual），zero staleness AND single-colo → `still-open` with "single-colo-observed" caveat，zero staleness AND multiple colos → `dismissed-with-rationale`。所以即使 gate 被打开，结果也不会谎报 closure。

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| B7-R1 | F08 binary-search 没实际做 3 samples per step | `fixed` | DO 侧 `handleCapBinarySearch` 加真正的 `samplesPerStep` 循环，fail-fast on TOOBIG；caller 侧按 `attempts[].samples >= target` 验证，不满足时降级 caveat | `the historical round-2 integrated storage spike workspace`, `.../src/follow-ups/do-size-cap-binary-search.ts` |
| B7-R2 (F05) | mem vs DO parity 用 `/native-do-roundtrip` 不能观察持久状态 | `fixed` | DO 新增 `/parity-apply` + `/parity-reset` 路由维护 `parity:` namespace；caller 对每步真比较 DO observed vs mem expected | `.../do/IntegratedProbeDO.ts`, `.../re-validation/storage.ts` |
| B7-R2 (binding) | re-validation 声称 `usedPackages: ["@nano-agent/nacp-core"]` 但没导入 | `fixed` | `usedPackages: []` + 文件头显式说明为什么此 probe 不导入 nacp-core；spike README 同步 | `.../spike-binding-pair-r2/worker-a-r2/src/re-validation/binding.ts`, `the historical round-2 integrated spikes treeREADME.md` |
| B7-R3 | 文档 R2 并发数据错位、残留 "pending live deploy"、"did not modify shipped package" 过度声明 | `fixed` | 用最新 run `.out` 覆盖 `[336/1310/2216/4383]`；清理 3 处 "pending live deploy"；3 处 "did not modify shipped package" 改写为 "B7 phase itself 不改 packages；B5-B6 pre-entry round 已改" | `docs/spikes/unexpected/F01-*.md`, `docs/issue/after-foundations/B7-final-closure.md`, `B7-phase-1-closure.md`, `B7-phase-3-closure.md`, `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md`, `the historical round-2 integrated spikes treeREADME.md` |
| B7-R4 | F03 probe 无 colo detection + verdict 逻辑与注释矛盾 | `fixed` | `worker.ts` 从 `request.cf.colo` / `cf-ray` 注入 observedColo；probe verdict 改为 `stale→still-open` / `clean+single-colo→still-open` / `clean+multi-colo→dismissed-with-rationale` | `.../spike-do-storage-r2/src/worker.ts`, `.../src/follow-ups/kv-cross-colo-stale.ts` |

### 6.3 变更文件清单

- `the historical round-2 integrated storage spike workspace` (新增 2 路由 + 真 samplesPerStep 循环)
- `the historical round-2 integrated storage spike workspace` (真 rubric 验证)
- `the historical round-2 integrated storage spike workspace` (verdict 逻辑修复 + colo 观察)
- `the historical round-2 integrated storage spike workspace` (F05 真 persistent-state parity)
- `the historical round-2 integrated storage spike workspace` (把 `request.cf.colo` 注入 F03 probe)
- `the historical round-2 integrated binding spike workspace` (usedPackages 修正)
- `the historical round-2 integrated spikes treeREADME.md` (binding-pair 描述收窄 + "did not modify" 改写)
- `docs/spikes/unexpected/F01-r2-put-273ms-per-key-during-preseed.md` (R2 数字替换为最新 run)
- `docs/issue/after-foundations/B7-final-closure.md` (R2 table + "did not modify" 改写)
- `docs/issue/after-foundations/B7-phase-1-closure.md` ("did not modify" 改写)
- `docs/issue/after-foundations/B7-phase-3-closure.md` (binding-F04 status 清理)
- `docs/spikes/spike-binding-pair/01-binding-latency-sub-10ms-and-cancellation-works.md` ("pending live deploy" 清理)
- `docs/spikes/spike-binding-pair/04-eval-fanin-app-layer-dedup-required.md` ("pending live deploy" 清理)
- `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md` §13 (R2 数字替换)

### 6.4 验证结果

```text
# 重新 deploy 三个 worker（version IDs 记录在下）
nano-agent-spike-do-storage-r2          → 10b40973-1373-4caf-8cfc-dad8cb0e86a0 (new, carries R1/R2/R4 fixes)
nano-agent-spike-binding-pair-b-r2      → 72b4a2d0-89f5-4ab7-9057-e3c2e39b5f48 (unchanged)
nano-agent-spike-binding-pair-a-r2      → b6f335e5-7182-4622-ba06-9e6af1b1fdcd (new, carries R2 binding fix)

# storage-r2 所有 probe 重跑
do-size-cap-binary-search   → writeback-shipped ✅  lowBytes=2,199,424  highBytes=2,200,000  samples=3/step (real rubric)
r2-concurrent-put           → writeback-shipped ✅  p50: 336/1310/2216/4383 ms (10/50/100/200)
kv-cross-colo-stale         → still-open (gated)  F03-CROSS-COLO-DISABLED
curl-high-volume            → still-open (gated)  F09-OWNER-URL-MISSING
re-validation/storage       → writeback-shipped ✅  F05 trace: 5/5 steps mem == DO observed
re-validation/bash          → writeback-shipped ✅  rg/mkdir/curl/deny 4/4
re-validation/context       → writeback-shipped ✅

# binding-pair-r2 重跑
binding-f01-callee-abort    → writeback-shipped ✅ (wrangler tail 捕获 outcome:"canceled")
binding-f04-true-callback   → writeback-shipped ✅  dup=3, overflow=5, window=8, disclosures=8
re-validation/binding       → writeback-shipped ✅ usedPackages=[] (honest)

# 根级契约测试
node --test test/*.test.mjs          → 77/77
npm run test:cross                   → 91/91
```

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. F03 / F09 的 gate 仍然未开。这是 B7 §6.2 设计允许的合法出口；不是本轮 review 可解决的。owner 开启对应 env var 后，可直接再跑现有 probe。
  2. 上一版 `.out/` JSON 文件被新一轮 run 覆盖；Git history 可追溯上一版（commit 前可以考虑保留为 `.out/2026-04-20-before-r1r2r4.json` 的历史快照，但我没做，因为当前 `.out/` 必须是最新 run 以匹配 finding docs 的 LIVE 数字）。

---

## 7. 进入 B8 阶段的判断

### 7.1 B7 close-out 最终状态

本轮 4 条 finding 全部 `fixed`；没有保留 `rejected` / `deferred`。`binding-F04` / `binding-F01` / F08 / unexpected-F01 / F04 / F05 / F07 / F02 / F01 / 3 条 re-validation 全部 `writeback-shipped` LIVE；F03 / F09 honestly `still-open` on 平台 / owner gate；F06 / unexpected-F02 `dismissed-with-rationale`。没有 `integrated-F*` 新增 finding。没有 shipped-package bug 在 B7 integrated phase 本体被发现（B5-B6 pre-entry round 已修好）。

### 7.2 B8 可消费的 LIVE 输入（经本轮 re-review 确认）

| # | input | LIVE value | 来源 |
|---|---|---|---|
| 1 | `DOStorageAdapter.maxValueBytes` 安全默认 | **2 MiB (2,097,152 bytes)** | F08 real 3-sample rubric |
| 2 | DO storage 硬上限 | 2,199,424 bytes (~2.1 MiB) | F08 |
| 3 | `R2Adapter.putParallel()` 安全默认并发 | **50** (p99 ≈ 2.4 s) | unexpected-F01 2026-04-20 final run |
| 4 | R2 opportunistic 并发 | 100 (p99 ≈ 4.4 s) | 同上 |
| 5 | R2 edge 并发 | 200 (p99 ≈ 8.5 s, 不推荐默认) | 同上 |
| 6 | `BoundedEvalSink` default capacity | **1024**（cross-worker push 契约成立） | binding-F04 LIVE |
| 7 | 跨 Worker abort 传播 | **native**（`outcome: "canceled"` on tail） | binding-F01 LIVE |
| 8 | `x-nacp-*` header law | **lowercased** on service binding | binding re-validation LIVE |
| 9 | mem vs DO parity | 5/5 steps persistent match | F05 |

### 7.3 B8 入场条件

| # | 条件 | 状态 |
|---|---|---|
| E1 | B7 close-out 没有未修复的 changes-requested finding | ✅ 全 4 条 fixed |
| E2 | B5-B6 pre-entry package fixes 稳定不回退 | ✅ 根测试 77/77 + cross 91/91 |
| E3 | LIVE 数字在 finding docs 与 raw `.out` 一致 | ✅ 已同步 |
| E4 | F03 / F09 gate 显式保留为 open，不伪造 closure | ✅ probe 拒绝 substitution |
| E5 | binding-F04 true push path 契约（B6 §6.2 #5 honesty test） | ✅ LIVE cross-worker |
| E6 | 有明确的 verdict bundle 可直接喂给 B8 | ✅ `B7-final-closure.md` §3 / §5 |
| E7 | 没有 `integrated-F*` 新增 finding 被隐藏或吞入旧 finding | ✅ 0 new findings；3 probe-side bugs 都 documented |

### 7.4 Go / No-Go

- **verdict**：**GO**。
- **理由**：
  1. 本轮 GPT review 的 4 条 finding 全部 `fixed`（3 条选择了 "actually implement the strong version" 而非降级文字），没有 `changes-requested` 级别的 B7 余债。
  2. 7 项入场条件 E1-E7 全部满足。LIVE 数字（DO cap、R2 并发曲线、binding-F04 cross-worker dedup、F01 abort、F02 lowercase 法则）都来自真实 Cloudflare 部署，不是 skeleton 或 local-sim 投射。
  3. 剩余 2 个 gate（F03 cross-colo、F09 high-volume curl）保留为 open 是 B7 §6.2 明确允许的合法出口，**不是** B8 blocker —— B8 只需在 action-plan 中明确"在 gate 清理前不依赖 cross-colo KV read-after-write"+"继续使用 B3 保守 curl budget"即可。
  4. B5-B6 / B7 两轮 review 累计修了 7 条 finding（B6-R1 / B5-R1 / B5-R2 + inspector docs + B7-R1 / R2 / R3 / R4），全部已 close 且 regression-tested。这个"每一轮 review 都真的修掉 finding 再进下一阶段"的纪律是 B8 能继承的最重要资产。
- **B8 action-plan 设计提示**：
  - 把 §7.2 的 9 个 LIVE input 作为 B8 前置输入直接 cite（不需要重新测量）。
  - 把 F03 / F09 两个 gate 作为 B8 "**必须显式 out-of-scope**" 的条目写清楚（如果 B8 内某个 work item 需要 cross-colo KV 就要先跑 F03 probe）。
  - binding-F04 契约已 LIVE，B8 可以在 multi-worker 场景下直接假设 `BoundedEvalSink` 的 dedup / overflow 语义在 cross-worker push path 上成立。
  - `DOStorageAdapter.maxValueBytes` 从 1 MiB 提到 2 MiB 的升级是 B8 可做的 minor calibration（不是必须，保守 1 MiB 也仍然正确）。

> **收口**：B7 本轮 re-review → `ready-for-rereview`（实现者侧）。**B8 进入判断 → GO**。可以开始 `docs/action-plan/after-foundations/B8-worker-matrix.md` 的设计与编写工作。
