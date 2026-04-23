# Blueprint — `eval-observability` (runtime residual) → `workers/agent-core/src/eval/`

> 类型：on-demand absorption blueprint(非代表,P0 补齐)
> 状态：draft(worker-matrix P0 Phase 2 产出)
> 直接上游：
> - `docs/design/pre-worker-matrix/W3-absorption-map.md`(A5 归属)
> - `docs/design/pre-worker-matrix/W3-absorption-pattern.md`
> - `docs/design/pre-worker-matrix/TEMPLATE-absorption-blueprint.md`
> - `docs/design/worker-matrix/D01-agent-core-absorption.md`(A5 聚合于 A1-A5)
> 相关原始素材：
> - `packages/eval-observability/package.json`(零 runtime dep)
> - `packages/eval-observability/src/{22 src files}` + `src/sinks/do-storage.ts`
> - `packages/eval-observability/test/{13 unit + 7 integration + 1 scripts + 2 sinks}.test.ts`
> - `packages/eval-observability/scripts/{export-schema,gen-trace-doc,trace-substrate-benchmark}.ts`
> - **相关但不在 A5 scope**:`packages/session-do-runtime/src/eval-sink.ts`(`BoundedEvalSink` — 归 A1 host shell,消费 A5 的 `TraceSink` interface)

---

## 1. 这个 blueprint 解决什么问题

1. `eval-observability` 是 `agent.core` 的 trace taxonomy / sink interface / inspector / timeline / replay / scenario runner 集合。它定义 `TraceEvent` / `TraceSink` / `DurablePromotionRegistry` / `MetricName` 等 canonical 层,被 A1 host shell 的 `BoundedEvalSink` / `tracesReporter` 消费。
2. 它代表的是 **"runtime residual + inspector seam + b7 live contract 间接依赖"** 的 absorption 难度 — 零 runtime dep(类似 A2 / A3),但 `TraceSink` interface 与 A1 host 的 `BoundedEvalSink` 有强运行时耦合;规模 ~2916 src + ~3895 test ≈ 6811 LOC,是 A1-A5 里最大的 residual。
3. 进入 worker-matrix 时,这份 blueprint 让 P1.A / A5 sub-PR 作者少想:
   - 哪些文件归 A5(22 root src + 1 sinks)、哪些 **不归 A5 / 归 A1**(`BoundedEvalSink` 在 `packages/session-do-runtime/src/eval-sink.ts`)
   - **B7 LIVE 5 tests 契约**如何保持不破(详 §6.1)
   - `DurablePromotionRegistry` / evidence-bridge / evidence-streams 的 seam 如何与 D03 / D04 evidence 对齐

---

## 2. 当前代码事实与源路径

### 2.1 package-level 事实

- `package.json` 关键信息:
  - 名称:`@nano-agent/eval-observability`
  - 版本:`0.1.0`
  - scripts:`build / typecheck / test / test:coverage / build:schema / build:docs / bench:trace-substrate`
  - **零 runtime dependency**;`peerDependencies.zod >= 3.22.0`;`devDependencies: tsx / typescript / vitest / zod`
  - `typecheck` 含双 tsconfig(`tsc --noEmit && tsc -p tsconfig.scripts.json`)— scripts/ 用独立 tsconfig
- **实测:`src/**` 与 `src/sinks/**` 零 `@nano-agent/*` 或 `@haimang/*` 跨包 import**(已 grep 验证)
- public surface 由 `src/index.ts`(166 行)汇总 — exports 丰富,约 40+ 项
- 实测 LOC:src ~2916 / test ~3895 / 合计 ~6811

### 2.2 核心源码锚点

| 职责 | 源路径 | 备注 |
|------|--------|------|
| public API aggregator | `packages/eval-observability/src/index.ts` | 40+ exports |
| version | `src/version.ts` | `EVAL_VERSION` |
| base types | `src/types.ts` | `TraceLayer / EventAudience / ConceptualTraceLayer / TraceSourceRole` + `CONCEPTUAL_LAYER_OF_TRACE_LAYER` |
| trace event | `src/trace-event.ts` | `TraceEvent` 定义 + `validateTraceEvent / isTraceLawCompliant / assertTraceLaw` + `LlmEvidenceExtension / ToolEvidenceExtension / StorageEvidenceExtension` |
| classification | `src/classification.ts` | `LIVE_ONLY_EVENTS / DURABLE_AUDIT_EVENTS / DURABLE_TRANSCRIPT_EVENTS / classifyEvent / shouldPersist` |
| durable promotion registry | `src/durable-promotion-registry.ts` | `DurablePromotionRegistry / createDefaultRegistry / DurablePromotionEntry` |
| truncation | `src/truncation.ts` | `TRACE_OUTPUT_MAX_BYTES / truncateOutput` |
| metric names | `src/metric-names.ts` | `METRIC_NAMES / MetricName` |
| sink interface | `src/sink.ts` | `TraceSink` interface — 被 A1 host `BoundedEvalSink` 实装 |
| audit record | `src/audit-record.ts` | `traceEventToAuditBody` etc. |
| inspector | `src/inspector.ts` | 315 LOC;inspector seam 主体 |
| anchor recovery | `src/anchor-recovery.ts` | |
| attribution | `src/attribution.ts` | |
| evidence bridge | `src/evidence-bridge.ts` | 与 D03 / D04 evidence 对接的 seam |
| evidence streams | `src/evidence-streams.ts` | 307 LOC |
| evidence verdict | `src/evidence-verdict.ts` | P6 verdict 合成 |
| placement log | `src/placement-log.ts` | |
| replay | `src/replay.ts` | |
| runner | `src/runner.ts` | scenario runner 主体 |
| scenario | `src/scenario.ts` | |
| timeline | `src/timeline.ts` | |
| sinks/do-storage | `src/sinks/do-storage.ts` | 252 LOC;DO-backed sink 实装 |
| unit tests | `test/{13 files}.test.ts` | |
| integration | `test/integration/{7 files}.test.ts` | failure-replay / p6-evidence-verdict / placement-runtime-loop / session-timeline / storage-placement-evidence / trace-recovery / ws-inspector-http-fallback |
| scripts tests | `test/scripts/trace-substrate-benchmark.test.ts` | |
| sinks tests | `test/sinks/{2 files}.test.ts` | |
| build scripts | `scripts/{export-schema,gen-trace-doc,trace-substrate-benchmark}.ts` | tsx;random scripts |

### 2.3 A5 外部 consumer / 耦合锚点

| 事实 | 代码锚点 | 含义 |
|------|----------|------|
| A1 host 实装 `TraceSink` | `packages/session-do-runtime/src/eval-sink.ts::BoundedEvalSink` | `BoundedEvalSink` 实装 A5 的 `TraceSink` interface;B6 dedup + B5-B6 R1 eviction bookkeeping + capacity overflow disclosure 都在 BoundedEvalSink 内 |
| A1 host 默认装配 | `packages/session-do-runtime/src/do/nano-session-do.ts:46,160,172,1246` | `nano-session-do.ts::defaultEvalSink` 默认 new BoundedEvalSink(...) |
| B7 LIVE 5 tests | 根 `test/b7-round2-integrated-contract.test.mjs` 等 | 验证 BoundedEvalSink 与 TraceSink 契约 end-to-end;**A5 sub-PR 合并后必须继续绿** |

---

## 3. 目标落点

### 3.1 建议目录结构

```text
workers/agent-core/
  src/
    eval/
      index.ts                          # A5 public API aggregator
      version.ts
      types.ts
      trace-event.ts
      classification.ts
      durable-promotion-registry.ts
      truncation.ts
      metric-names.ts
      sink.ts                           # TraceSink interface — BoundedEvalSink(A1) 实装
      audit-record.ts
      inspector.ts
      anchor-recovery.ts
      attribution.ts
      evidence-bridge.ts
      evidence-streams.ts
      evidence-verdict.ts
      placement-log.ts
      replay.ts
      runner.ts
      scenario.ts
      timeline.ts
      sinks/
        do-storage.ts
  test/
    eval/
      {13 unit}.test.ts
      integration/
        {7 integration}.test.ts
      scripts/
        trace-substrate-benchmark.test.ts
      sinks/
        {2 sinks}.test.ts
  scripts/
    eval/
      export-schema.ts
      gen-trace-doc.ts
      trace-substrate-benchmark.ts
```

### 3.2 文件映射表

| 源文件 / 目录 | 目标文件 / 目录 | 搬迁方式 | 备注 |
|---------------|------------------|----------|------|
| `src/index.ts` | `workers/agent-core/src/eval/index.ts` | 重建 exports;40+ 项保持 byte-identical | |
| `src/{22 root files}` | `eval/{同名}` | 原样迁移 | |
| `src/sinks/do-storage.ts` | `eval/sinks/do-storage.ts` | 原样迁移 | |
| `test/{13 unit}.test.ts` | `test/eval/{同名}` | 调整相对 import | |
| `test/integration/{7 files}.test.ts` | `test/eval/integration/{同名}` | 调整相对 import | |
| `test/scripts/trace-substrate-benchmark.test.ts` | `test/eval/scripts/{同名}` | 调整相对 import | |
| `test/sinks/{2 files}.test.ts` | `test/eval/sinks/{同名}` | 调整相对 import | |
| `scripts/{3 tsx scripts}` | `workers/agent-core/scripts/eval/{同名}` | 原样迁移 | |
| `tsconfig.scripts.json` | `workers/agent-core/tsconfig.scripts.json` | 可选;视 worker-level scripts/ 结构决定 | |

---

## 4. 依赖与 import 处理

### 4.1 保留为 package dependency

- `zod`:保持 peerDependency
- 无其他外部 runtime dep

### 4.2 跟随 absorb 一起内化

- 全部 23 src + 23 test 文件(13 unit + 7 integration + 1 scripts + 2 sinks)+ 3 tsx scripts
- `TraceEvent` / `TraceSink` interface / `MetricName` 全 canonical 层内化

### 4.3 非迁移项(明确不归 A5)

1. **`BoundedEvalSink`(在 `packages/session-do-runtime/src/eval-sink.ts`)** — 归 A1 host shell absorption,作为 `TraceSink` 的实装;A5 sub-PR 不得把 BoundedEvalSink 移入 `src/eval/`
2. **`defaultEvalSink` 默认装配(在 `nano-session-do.ts::defaultEvalSink`)** — 归 A1
3. **B7 LIVE 5 tests(在根 `test/b7-round2-integrated-contract.test.mjs` 等)** — 继续作为 root guardians,不迁(per P1-P5 GPT review R4)

### 4.4 不在本 blueprint 内解决

- `DO-backed sink` 的真实 DO binding 装配(归 D06 default composition)
- `WsInspectorHttpFallback` 的远端 inspector worker(非 scope)
- `scenario runner` 的 live agent loop(需 A1 / A2 / A3 / A4 全搬完后才真正 active)

---

## 5. 测试与验证继承

| 当前测试面 | 进入 worker 后如何继承 |
|------------|------------------------|
| 13 unit tests | 1:1 迁到 `test/eval/` |
| 7 integration tests | 1:1 迁到 `test/eval/integration/`;注意 `ws-inspector-http-fallback` 保持 local fake 不接 live worker |
| 1 scripts benchmark test | 1:1 迁到 `test/eval/scripts/` |
| 2 sinks tests(`do-storage*`)| 1:1 迁到 `test/eval/sinks/` |
| **B7 LIVE 5 tests(root)** | **不迁** — 继续在根 `test/b7-round2-integrated-contract.test.mjs` 等位置跑绿;A5 sub-PR merge 后 `node --test test/*.test.mjs` 必须全部绿(per P1-P5 GPT review R4) |
| session-do-runtime::eval-sink.test.ts | **不归 A5** — 归 A1 host shell 搬家 |

---

## 6. 风险与禁止事项

### 6.1 主要风险

1. **B7 LIVE 5 tests 破裂**:`BoundedEvalSink`(归 A1)与 `TraceSink` interface(归 A5)分别由两个 sub-PR 搬家;合并顺序错位会导致 B7 LIVE 契约临时红。**缓解**:A5 sub-PR 合并 **前** 必须验证 `node --test test/b7-round2-integrated-contract.test.mjs` + 其余 4 个 B7 LIVE tests 全绿;A1 sub-PR 合并 **前** 同样验证。顺序建议:A5 先合并(A1 消费 A5 interface);任一 sub-PR 开 PR 时 body 明确注明 "B7 LIVE 绿" 证据 block
2. **`TraceSink` interface shape 被误改**:搬家 ≠ 重构;shape 保持 byte-identical
3. **`DurablePromotionRegistry` consumer 切换漂移**:A5 合并后,其他 package consumer(如 session-do-runtime)必须同期改 import 路径
4. **inspector seam 被误判为 root cross-test 而搬走**:A5 的 inspector tests 归 package-local,搬;root `test/verification/*` 与 B7 LIVE 不归 A5
5. **scripts/ 的 tsconfig 漂移**:`tsconfig.scripts.json` 必须随 3 tsx scripts 一起迁;否则 `pnpm typecheck` 会断

### 6.2 明确禁止

1. A5 sub-PR 内改 `TraceEvent` shape / `TraceSink` interface(保持 byte-identical)
2. A5 sub-PR 内把 `BoundedEvalSink` 从 A1 境内移入 A5(violates ownership)
3. A5 sub-PR 内修改 B7 LIVE 5 tests 来 "适应" 新路径(应先保 interface 不变,让 B7 LIVE 自动绿)
4. A5 sub-PR 内删除 `packages/eval-observability/`(归 D09)

---

## 7. 收口证据

1. **源路径列表**:`packages/eval-observability/src/{22 root + 1 sinks}` + `test/{13 + 7 + 1 + 2}` + `scripts/{3 tsx}` + `tsconfig.scripts.json`
2. **目标路径列表**:`workers/agent-core/src/eval/{22 + sinks/}` + `test/eval/{...}` + `workers/agent-core/scripts/eval/{3 tsx}`
3. **依赖处理说明**:零 runtime dep;`zod` 保持 peerDependency;`BoundedEvalSink`(A1 ownership)消费 `TraceSink` interface(A5 ownership)
4. **测试迁移说明**:23 test 1:1 迁;B7 LIVE 5 tests 继续作为 root guardians
5. **optional / deferred 项声明**:
   - live inspector remote worker 归后续 charter
   - scenario runner live agent loop 需 A1-A5 全搬完后 active

---

## 8. LOC 与工作量估算

| 维度 | 估算值 | 依据 |
|------|--------|------|
| 源 LOC | ~2916 | 22 root + 1 sinks |
| 测试 LOC | ~3895 | 13 unit + 7 integration + 1 scripts + 2 sinks |
| 搬家工作量 | **M-L** | 23 src 含 sinks/;23 test 含 integration / scripts / sinks;B7 LIVE 协调 |
| 预估时长 | 3-4 工作日 | A1-A5 中体量最大 residual;interface shape freeze + B7 LIVE 验证是额外协调成本 |
| 关键风险项 | B7 LIVE 5 tests 协调 / `TraceSink` interface freeze | 需与 A1 sub-PR 作者 pair review |

---

## 9. 一句话 verdict

A5 是 P1.A sub-PR 序列中 **体量最大 / 与 A1 耦合最强 / B7 LIVE 协调最重** 的 residual 样本:23 src(含 sinks/ 子目录)+ 3 tsx scripts + 23 test(含 4 层子目录)+ 零 runtime dep。A5 合并顺序建议在 A1 **之前**(A1 的 BoundedEvalSink 消费 A5 的 TraceSink);A5 sub-PR 必须在 PR body 明确注明 "B7 LIVE 5 tests 全绿" 证据,以满足 P2.E0 前 `tool.call` 无 regression。
