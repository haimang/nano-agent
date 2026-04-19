# [B1 / Phase 3 closure] spike-binding-pair 4 V3 probes deployed + real run captured

> **Issue ID**: `B1-phase-3-closure`
> **Action plan**: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md`
> **Phase**: 3 — spike-binding-pair 部署与 probe 实现
> **Status**: ✅ closed (PASSED)
> **Created**: 2026-04-19
> **Closed**: 2026-04-19
> **Owner**: sean.z@haimangtech.cn (CF Account 8b611460403095bdb99b6e3448d1f363)

---

## Summary

`spike-binding-pair` 双 worker 真实部署到 Cloudflare 并跑通 4 个 V3 binding probe，输出 `.out/2026-04-19T08-28-14Z.json`。**已捕获多条对 worker matrix 阶段直接相关的真实 service-binding finding**。

**Live URLs**:
- worker-a (caller): `https://nano-agent-spike-binding-pair-a.haimang.workers.dev` (version `9ef21415`)
- worker-b (callee): `https://nano-agent-spike-binding-pair-b.haimang.workers.dev` (version `122d3049`)

**Cross-binding sanity check**:
```
GET /healthz/binding → {"ok":true,"status":200,"workerB":{...}}
```

**Transport scope**: fetch-based-seam ONLY (handleNacp RPC NOT covered, per design §0)

## Completed work items

| # | Item | Status | Evidence |
|---|---|---|---|
| P3-01 | Deploy worker-b real | ✅ | 6.00 KiB worker；6 env vars；URL live |
| P3-02 | Deploy worker-a real | ✅ | 7.x KiB worker；WORKER_B service binding +  6 env vars；`/healthz/binding` returns worker-b body |
| P3-03 | Implement 4 V3 probes + 5 worker-b handlers | ✅ | latency-cancellation / cross-seam-anchor / hooks-callback / eval-fanin + echo / slow / header-dump / hook-dispatch / eval-emit |
| P3-04 | deploy-both.sh + run-all-probes.sh + extract-finding.ts | ✅ | deploy-both.sh enforces worker-b first; run-all hits 4 routes |

## Probe run summary（4 V3 probes, all success=true）

| Probe ID | Duration | Observations | Notable |
|---|---|---|---|
| V3-binding-latency-cancellation | 0.6s | 4 | p50 = 5ms / p99 = 7ms (1 KiB echo)；1 MiB payload p50 = 13ms；10 concurrent in 12ms wallclock；**cancellation aborted at 300ms confirmed** |
| V3-binding-cross-seam-anchor | 60ms | 6 | **6 anchor headers all survived**；**case normalized to lowercase**；128/1024/8192 byte values preserved；no leak in absent path |
| V3-binding-hooks-callback | 1.6s | 4 | p50 = 4ms；slow 1.5s blocked correctly；throwing hook → HTTP 500 with structured body；**anchors traverse hook path** |
| V3-binding-eval-fanin | 35ms | 4 | order preserved within batch；**dedup REQUIRED at app layer (40/60 dups across 3 rounds with shared seed)**；overflow drop graceful (50/100 dropped) |

## Notable real findings (preview, finding docs to be written in Phase 4)

### 🟢 Confirmed (packages/ assumption holds)

- **CrossSeamAnchor 6 headers transparent**：`x-nacp-trace-uuid` / `session-uuid` / `team-uuid` / `request-uuid` / `source-uuid` / `source-role` 全部在 fetch-based seam 上完整透传
- **No magic header injection**：absent path无意外 anchor 注入
- **Service binding is sub-10ms in same colo**：p50=5ms / p99=7ms 完全够用 nano-agent 跨 worker hot-path 调用
- **Cancellation works**：caller `AbortController.abort()` 后 300ms 内观察到 `"The operation was aborted"`
- **Error envelope preserved**：worker-b throw → caller 收到 HTTP 500 + 结构化 body

### 🟡 Surprising (与 packages/ 假设需要对齐)

- **Header case normalization**：`X-Nacp-Trace-Uuid` → 接收端只能在 `x-nacp-trace-uuid` lowercase 找到；`receivedAsMixed: null`。**这意味着 `packages/session-do-runtime/src/cross-seam.ts` 在 set/get header 时必须始终使用小写**——任何大小写不一致的代码假设都会在跨 worker 时失效。
- **Concurrent 10 req in 12ms wallclock**：service binding 真实并发，**不是 serialized through a queue**——这对 worker matrix 跨 worker 调用模型是好消息（不需要 client-side throttling for typical agent workload）

### 🔴 App-layer responsibility (writeback impact)

- **Eval sink dedup is application's job**：3 rounds × 20 records 用相同 dedupSeed → 总 60 records 但只有 20 unique（40 duplicates）。`applicationLevelDedupRequired: true`。**对 `packages/eval-observability/src/inspector.ts` (`SessionInspector`) 与 `defaultEvalRecords` sink 直接构成 contract 要求**：任何跨 worker fan-in 设计必须显式 messageUuid dedup，不能依赖 transport。
- **Sink overflow needs graceful degradation**：capacity=50 / attempted=100 / dropped=50。**对 `defaultEvalRecords` 的 `DEFAULT_SINK_MAX = 1024` 保留语义提供验证**——Phase 4 hook catalog 扩展时新增的 `ContextPressure` 类 event 必须有 overflow disclosure 路径。

## Files created (Phase 3)

```
spikes/round-1-bare-metal/spike-binding-pair/
├── worker-a/
│   ├── src/
│   │   ├── result-shape.ts                   (NEW, BindingProbeResult shape)
│   │   ├── probes/
│   │   │   ├── latency-cancellation.ts       (NEW, 167 lines)
│   │   │   ├── cross-seam-anchor.ts          (NEW, 142 lines)
│   │   │   ├── hooks-callback.ts             (NEW, 132 lines)
│   │   │   └── eval-fanin.ts                 (NEW, 192 lines)
│   │   └── worker.ts                         (UPGRADED 80→125 lines, 4 probe routes)
├── worker-b/
│   ├── src/
│   │   ├── handlers/
│   │   │   ├── echo.ts                       (NEW)
│   │   │   ├── slow.ts                       (NEW, AbortSignal-aware)
│   │   │   ├── header-dump.ts                (NEW)
│   │   │   ├── hook-dispatch.ts              (NEW, 3 modes: ok/throw/slow)
│   │   │   └── eval-emit.ts                  (NEW, deterministic uuid for dedup test)
│   │   └── worker.ts                         (UPGRADED 47→103 lines, 5 handler routes)
├── scripts/
│   ├── deploy-both.sh                        (NEW, executable, enforces worker-b first)
│   ├── run-all-probes.sh                     (NEW, executable)
│   └── extract-finding.ts                    (NEW, executable)
└── .out/2026-04-19T08-28-14Z.json            (NEW: combined run output)
```

## Discipline check (Phase 3)

| 纪律 | 状态 | Evidence |
|---|---|---|
| 1. spikes/ 顶级，不进 packages/ | ✅ | 仍在 `spikes/round-1-bare-metal/` |
| 2. expiration date | ✅ | 两个 wrangler.jsonc + worker env 都含 `EXPIRATION_DATE=2026-08-01` |
| 3. 不接 CI 主链 | ✅ | spike 不在 pnpm workspace |
| 4. finding → design doc | ⏳ | Phase 4 才产出 per-finding docs；本 issue 是 Phase 3 closure |
| 5. 不接生产数据 / 业务能力 | ✅ | spike 仅 echo / slow / header-dump / 假 hook outcome / 假 evidence；零业务 logic |
| 6. round-1 与 round-2 分目录 | ✅ | 仍只有 round-1 |
| 7. round-1 不依赖 packages/ runtime；回写对齐 packages/ seam | ✅ | spike 代码 0 个 `import "@nano-agent/*"`；hook-dispatch.ts 注释引用 `packages/hooks/src/runtimes/service-binding.ts` 作为 contract 来源 |

## Phase 3 closure gate verdict

✅ **PASSED** —
- 4/4 V3 probes deployed and runnable
- 4/4 probes returned `success=true` with real platform observations
- 双 worker 都 live；service binding sanity 跑通
- 至少 4 条 surprising/app-layer-responsibility findings 已发现
- 7/7 spike disciplines satisfied (or process-deferred to Phase 4-6)

## Next: Phase 4 (P4-01..03)

Phase 1-3 已经累积了 9 + 4 = **13 个 required validation item 的 ProbeResult JSON**（`.out/` × 2）。Phase 4 把它们转成 13 条 per-finding doc：

- **P4-01**: 撰写 9 条 spike-do-storage required per-finding doc (`docs/spikes/spike-do-storage/{01..09}-{slug}.md`)
- **P4-02**: 撰写 4 条 spike-binding-pair required per-finding doc (`docs/spikes/spike-binding-pair/{01..04}-{slug}.md`)
- **P4-03**: 撰写 N 条 optional `unexpected-F*` per-finding doc

每条 finding 必须含 §3 Package Impact (具体文件路径+行号) + §5 Writeback Action (target phase B2-B6)。

## Owner-facing notes

- **两个 worker 已 live**（业主 Q1 双标签隔离）：
  - `nano-agent-spike-binding-pair-a` (caller)
  - `nano-agent-spike-binding-pair-b` (callee)
- **可在 dashboard 查看**：每个 worker 的 invocation count + cpu_ms（spike 至今总开销 < 100 invocations）
- **AbortSignal 传播验证**：`wrangler tail nano-agent-spike-binding-pair-b` 时调用 latency-cancellation probe，可在 worker-b 日志看到 `[slow] abort observed t=300ms`，进一步确认平台层 abort propagation 行为

## References

- Charter: `docs/plan-after-foundations.md`
- Action plan: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md`
- Design (binding-pair): `docs/design/after-foundations/P0-spike-binding-pair-design.md` (r2)
- Tracking policy: `docs/issue/README.md`
- Previous issues: `B1-phase-1-closure.md`, `B1-phase-2-closure.md`
- Combined run output: `spikes/round-1-bare-metal/spike-binding-pair/.out/2026-04-19T08-28-14Z.json`
