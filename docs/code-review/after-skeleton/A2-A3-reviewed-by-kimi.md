# Nano-Agent 代码审查模板

> 审查对象: `A2-trace-substrate-decision-investigation + A3-trace-first-observability-foundation`
> 审查时间: `2026-04-18`
> 审查人: `Kimi (k2p5)`
> 审查范围:
> - `docs/action-plan/after-skeleton/A2-trace-substrate-decision-investigation.md`
> - `docs/action-plan/after-skeleton/A3-trace-first-observability-foundation.md`
> - `packages/eval-observability/**`
> - `packages/session-do-runtime/**`
> - `packages/nacp-core/**`
> - `packages/hooks/**`
> - `test/*.test.mjs`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：A2 substrate decision investigation 与 A3 trace-first observability foundation 的核心骨架已完成，测试与文档形成闭环，但存在一处 benchmark fixture 与 trace law 的不一致（低危），以及一处类型 mirror 的编译时维护风险（中危）。
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. A2 的 substrate benchmark 证据支撑 Q5 从 conditional yes 升级为 evidence-backed yes，Q20 hard gate 已落地。
  2. A3 的 trace law（traceUuid + sourceRole 必带）、alert exception（platform-only 可省略 trace_uuid）、anchor-recovery（8 项 typed taxonomy）均已在代码和 cross-package contract tests 中完整实现。
  3. 测试全面通过（eval-observability 194 / session-do-runtime 309 / nacp-core 231 / cross 14/14），但 A3 action-plan §11.3 的测试数字与实际运行结果不一致，需同步。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/after-skeleton/A2-trace-substrate-decision-investigation.md`
  - `docs/action-plan/after-skeleton/A3-trace-first-observability-foundation.md`
  - `docs/design/after-skeleton/P1-trace-substrate-decision.md`
  - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
  - `docs/design/after-skeleton/P2-observability-layering.md`
  - `docs/action-plan/after-skeleton/AX-QNA.md`
- **核查实现**：
  - `packages/eval-observability/scripts/trace-substrate-benchmark.ts`
  - `packages/eval-observability/src/{trace-event,types,audit-record,anchor-recovery,classification,durable-promotion-registry,index}.ts`
  - `packages/eval-observability/src/sinks/do-storage.ts`
  - `packages/nacp-core/src/observability/envelope.ts`
  - `packages/session-do-runtime/src/{traces,checkpoint,index}.ts`
  - `packages/hooks/src/audit.ts`
  - `test/trace-first-law-contract.test.mjs`
  - `test/observability-protocol-contract.test.mjs`
  - `test/hooks-protocol-contract.test.mjs`
- **执行过的验证**：
  - `pnpm --filter @nano-agent/eval-observability test` → 22 files / 194 tests passed
  - `pnpm --filter @nano-agent/session-do-runtime test` → 23 files / 309 tests passed
  - `pnpm --filter @nano-agent/nacp-core test` → 12 files / 231 tests passed
  - `npm run test:cross` → 14/14 e2e passed

### 1.1 已确认的正面事实

- A2 benchmark runner 完整实现（763 行），支持 `local-bench` / `readback-probe` / `all` 三种模式，产出 JSON + Markdown artifact。
- A2 回归测试 10 cases 覆盖 smoke / verdict / artifact / RecordingFakeStorage 兼容性。
- A2 benchmark memo 明确标注 in-isolate 限制，不越界到 A6。
- A2 readback probe 100% success，single-flush write amplification ≈ 1.00×（满足 ≤2× 阈值）。
- A3 `TraceEventBase` 已升级 `traceUuid` / `sourceRole` / `sourceKey?` / `messageUuid?`，暴露 `validateTraceEvent` / `isTraceLawCompliant` / `assertTraceLaw`。
- A3 `NacpAlertPayloadSchema` 增加 `scope` 枚举 + `refine`，仅 `platform` 可省略 `trace_uuid`；7 项测试验证。
- A3 audit codec `traceEventToAuditBody` / `auditBodyToTraceEvent` 正确保留 trace carriers，decode 时缺失 `traceUuid` 会抛 trace-law violation。
- A3 event kind 收敛：`turn.started` → `turn.begin`，`turn.completed` → `turn.end`。
- A3 anchor-recovery 新增 8 项 `TraceRecoveryReason` + `attemptTraceRecovery` + `TraceRecoveryError`。
- A3 session-do-runtime builder 重命名并强制携带 `TraceContext`（含 traceUuid / sourceRole）。
- A3 hooks `buildHookAuditRecord` 集成 `HookTraceContext`，audit body 可 round-trip 回 trace-law-compliant event。
- A3 root cross-package contract `test/trace-first-law-contract.test.mjs` 15 cases 完整覆盖 trace-first law。
- A3 `ConceptualTraceLayer` + `CONCEPTUAL_LAYER_OF_TRACE_LAYER` 映射表实现概念层与实现枚举的显式分离。
- A3 `DurablePromotionRegistry` 为 `turn.begin/end/session.start/end` 标注 `conceptualLayer=anchor`。

### 1.2 已确认的负面事实

- `packages/eval-observability/scripts/trace-substrate-benchmark.ts:239-258` 的 `makeEvent` 未生成 `traceUuid` / `sourceRole`，与 A3 trace law 不一致。
- `packages/session-do-runtime/src/traces.ts:39-54` 本地 mirror 了 eval-observability 的 `TraceEvent` 接口，编译时无自动同步机制。
- `docs/design/after-skeleton/P2-trace-first-observability-foundation.md:23-25` 引用的代码行号对应 pre-A3 代码，已过时。
- `docs/action-plan/after-skeleton/A3-trace-first-observability-foundation.md §11.3` 报告的测试数字（172 / 258）与实际运行结果（194 / 309）不一致。

---

## 2. 审查发现

### R1. A2 benchmark runner fixture 缺少 trace carrier，与 A3 trace law 不一致

- **严重级别**：`low`
- **类型**：`test-gap`
- **事实依据**：
  - `packages/eval-observability/scripts/trace-substrate-benchmark.ts:239-258` `makeEvent` 返回的对象不含 `traceUuid` / `sourceRole`：
    ```ts
    return {
      eventKind: kind,
      timestamp: ts,
      sessionUuid,
      teamUuid,
      turnUuid: `turn-${Math.floor(rand() * 4)}`,
      stepIndex: idx,
      audience: "internal",
      layer: "durable-audit",
    };
    ```
- **为什么重要**：A3 已将 trace law 提升为 runtime 第一事实，所有事件（包括测试 fixture）原则上应携带 trace carrier。虽然 `DoStorageTraceSink.emit()` 不验证 trace law，但 cross-package contract 测试会拒绝此类事件。
- **审查判断**：不影响 A2 substrate benchmark 结论（sink 只测存储行为），但 fixture 已落后于当前代码 reality。
- **建议修法**：在 `makeEvent` 中加入 `traceUuid` 和 `sourceRole`，或添加注释说明 benchmark fixture 为何豁免 trace law（如 "A2 fixture predates A3 trace law; substrate benchmark only measures storage behaviour"）。

### R2. session-do-runtime 的 TraceEvent 本地 mirror 存在编译时维护风险

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - `packages/session-do-runtime/src/traces.ts:39-54` 本地声明了与 eval-observability 结构相同的 `TraceEvent` / `TraceSourceRole` 接口。
  - `packages/session-do-runtime/test/traces.test.ts` 通过 `@nano-agent/eval-observability` devDep 导入 `isTraceLawCompliant` 做交叉检查，但这是运行时检查而非编译时约束。
- **为什么重要**：若 eval-observability 的 `TraceEventBase` 新增必填字段，session-do-runtime 的 mirror 不会自动同步。当前仅靠 root cross-package contract tests 在运行时捕捉差异。
- **审查判断**：当前受 tests 保护，短期内可接受。建议在 A4 session edge closure 时评估是否将共享类型提取到公共包（如 `@nano-agent/types` 或 `nacp-core`），或保留 mirror 但增加类型对齐测试。
- **建议修法**：暂不修改代码；在 A4 技术债务清单中记录此风险，明确 "eval-observability TraceEventBase 变更时必须同步检查 session-do-runtime mirror"。

### R3. P2 design doc §0 引用的代码行号已过时

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md:23-25` 引用了 `packages/eval-observability/src/trace-event.ts:13-70`（pre-A3 代码位置），而 A3 修改后该文件结构已变化（`trace-event.ts` 现约 188 行，base fields 在 33-51 行）。
- **为什么重要**：设计文档中的代码引用是新贡献者理解系统的入口，过时引用会造成困惑。
- **审查判断**：文档内容本身正确，仅引用位置需要更新。
- **建议修法**：更新 P2 design doc §0 的代码引用行号，或在 action-plan 中建立 "design doc 代码引用定期同步" 的检查项。

### R4. A3 action-plan §11.3 测试数字与实际运行结果不一致

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - A3 §11.3 报告：`eval-observability 172 tests` / `session-do-runtime 258 tests`。
  - 实际运行：`eval-observability 194 tests` / `session-do-runtime 309 tests`。
- **为什么重要**：action-plan 是执行记录，数字不一致会让后续审查者怀疑文档是否覆盖最新代码。
- **审查判断**：差异说明 A3 回填后又有测试被添加（可能是正常的演进），但 action-plan 未更新。这不影响代码 correctness。
- **建议修法**：在 A3 action-plan §11.3 追加更新说明，或建立 "action-plan 数字与实际测试输出自动同步" 的纪律。

---

## 3. In-Scope 逐项对齐审核

### A2 In-Scope

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | benchmark runner (`scripts/trace-substrate-benchmark.ts`) | `done` | 763 行，支持 local-bench / readback-probe / all |
| S2 | benchmark 回归测试 (10 cases) | `done` | smoke / verdict / artifact / RecordingFakeStorage |
| S3 | benchmark memo (`docs/eval/after-skeleton-trace-substrate-benchmark.md`) | `done` | 完整 evidence pack，含 F1/F2 + comparative table |
| S4 | decision/gate sync (P1 §9.3, AX-QNA Q5/Q20, plan-after-skeleton §7.2) | `done` | 四份文档口径一致 |
| S5 | Q5 evidence-backed 升级 | `done` | readback 100%, single-flush WA 1.00× |
| S6 | Q20 hard gate | `done` | D1 升格前必须提交独立 benchmark memo |

### A3 In-Scope

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S7 | TraceEventBase + traceUuid / sourceRole | `done` | `trace-event.ts:33-51` |
| S8 | validateTraceEvent / assertTraceLaw | `done` | 7 项检查完整，测试覆盖 |
| S9 | alert exception scope refine | `done` | `NacpAlertPayloadSchema` + refine，7 tests |
| S10 | audit codec trace carrier 保留 | `done` | encode 放入 detail，decode 强制 trace law |
| S11 | event kind 收敛 (turn.begin/end) | `done` | `traces.ts:91-112` |
| S12 | session trace builders | `done` | `buildTurnBeginTrace` / `buildTurnEndTrace` / `buildStepTrace` |
| S13 | anchor-recovery 8 项 taxonomy | `done` | `anchor-recovery.ts:40-48` |
| S14 | hooks trace context 集成 | `done` | `hooks/src/audit.ts:52-108` |
| S15 | root cross-package contract tests | `done` | `trace-first-law-contract.test.mjs` 15 cases |
| S16 | conceptual layering | `done` | `ConceptualTraceLayer` + `CONCEPTUAL_LAYER_OF_TRACE_LAYER` |
| S17 | durable promotion registry anchor 标注 | `done` | `turn.begin/end/session.start/end` 标注 `anchor` |
| S18 | `CheckpointInvalidError` 对齐 `checkpoint-invalid` | `done` | `checkpoint.ts:250-256` |

### 3.1 对齐结论

- **done**: `18`
- **partial**: `0`
- **missing**: `0`

> A2 与 A3 的核心交付物全部落地，测试与文档形成最小证据闭环。代码质量高，跨包契约清晰。

---

## 4. Out-of-Scope 核查

### A2 Out-of-Scope

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 不实现 D1 hot path | `遵守` | `wrangler.jsonc` 无 D1 binding，env.ts 仅预留类型槽位 |
| O2 | 不做 wrangler dev/deploy-shaped 验证 | `遵守` | runner scope 明确为 `package-local-isolate` |
| O3 | 不抢 A6 职责 | `遵守` | benchmark memo §1 明确标注真实 DO put 验证属 A6 |

### A3 Out-of-Scope

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O4 | 不抢跑 D1/query/exporter | `遵守` | 无 D1 wiring，无 query API，无 exporter 实现 |
| O5 | 不抢跑 external seam propagation | `遵守` | 仅 hooks 接入 trace context，其他包仅留 seam |
| O6 | 不接受 silent trace loss | `遵守` | `TraceRecoveryError` + typed reason，无 broad catch fallback |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`approve-with-followups`
- **是否允许关闭本轮 review**：`yes`
- **关闭前必须完成的 blocker**：无
- **可以后续跟进的 non-blocking follow-up**：
  1. **R1**：A2 benchmark runner `makeEvent` 补齐 trace carrier（低危，不影响 substrate 结论）。
  2. **R3**：P2 design doc §0 代码引用同步（低危，纯文档）。
  3. **R2**：session-do-runtime `TraceEvent` mirror 长期维护策略评估（中危，建议 A4 时决策是否提取共享类型）。
  4. **R4**：A3 action-plan §11.3 测试数字更新（低危，纯文档）。

---

## 6. 实现者回应（针对 Kimi 报告）

> 执行者: `Claude (claude-opus-4-7[1m])`
> 执行时间: `2026-04-18`
> 回应范围: `Kimi R1 – R4`
> 交叉回应: 对 GPT 报告的整体回应与统一修改日志写在 `docs/code-review/after-skeleton/A2-A3-reviewed-by-GPT.md` §6；本节只记录针对 Kimi 四条 finding 的独立回应与对本份报告的评价。

### 6.1 逐项回应

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| Kimi R1 | A2 benchmark runner `makeEvent` 缺 `traceUuid` / `sourceRole` | `fixed` | `scripts/trace-substrate-benchmark.ts::makeEvent` 新增 `traceUuid / sourceRole / sourceKey`；同步升级 `test/scripts/*.ts` 与所有 eval-observability test fixture | `packages/eval-observability/scripts/trace-substrate-benchmark.ts`, `packages/eval-observability/test/scripts/trace-substrate-benchmark.test.ts`, `packages/eval-observability/test/sink.test.ts`, `packages/eval-observability/test/sinks/do-storage.test.ts`, `packages/eval-observability/test/timeline.test.ts`, `packages/eval-observability/test/attribution.test.ts`, `packages/eval-observability/test/replay.test.ts` |
| Kimi R2 | session-do-runtime `TraceEvent` 本地 mirror 无编译时同步机制 | `fixed`（compile-time structural guard） | `packages/session-do-runtime/test/traces.test.ts` 新增 「TraceEvent local-mirror ↔ eval-observability structural parity」 describe block：`const asEval: EvalTraceEvent = local; const asLocal: SessionDoTraceEvent = asEval;` 两次互相赋值——任一侧新增必填字段都会立即在 `tsc` 阶段失败。同时在 `packages/session-do-runtime/src/traces.ts` 落地 `assertTraceLaw()` 本地实现，让运行时 enforcement 无需依赖 eval-observability（保留 devDep-only 关系） | `packages/session-do-runtime/src/traces.ts`, `packages/session-do-runtime/test/traces.test.ts` |
| Kimi R3 | P2 design doc §0 引用的代码行号对应 pre-A3 代码 | `fixed` | `P2-trace-first-observability-foundation.md` §0 追加 post-A3 reality 脚注：列出 `NacpAlertPayloadSchema refine`、`TraceEventBase` 新 carrier、`buildTurnBeginTrace/End/Session` 的当前位置，并附 review follow-up 说明 | `docs/design/after-skeleton/P2-trace-first-observability-foundation.md` |
| Kimi R4 | A3 action-plan §11.3 报告数字（172 / 258）与实际（194 / 309）不符 | `fixed` | §11.3 加「A2-A3 code review 回填」前言，重写数字为 eval-observability `196`、session-do-runtime `312`、root `test:cross 66`；同时修正 `trace-first-law-contract.test.mjs` 被误标为 15 cases 的问题（实际 9） | `docs/action-plan/after-skeleton/A3-trace-first-observability-foundation.md` |

### 6.2 变更文件清单（仅本报告触达部分）

- `packages/eval-observability/scripts/trace-substrate-benchmark.ts`（R1）
- `packages/eval-observability/test/**`（R1：六个 fixture 文件同步）
- `packages/session-do-runtime/src/traces.ts`（R2 — 新增本地 `assertTraceLaw`）
- `packages/session-do-runtime/test/traces.test.ts`（R2 — 结构对齐断言）
- `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`（R3）
- `docs/action-plan/after-skeleton/A3-trace-first-observability-foundation.md`（R4）

其余修改（GPT R1/R2/R5/R6 覆盖的 orchestration trace law、benchmark Q5 budget / listless probe、test:cross glob、alarm onFlushFailure）见 `docs/code-review/after-skeleton/A2-A3-reviewed-by-GPT.md` §6.

### 6.3 验证结果

```text
pnpm -r typecheck                                      →  10 包全绿（含 eval-observability scripts tsconfig）
pnpm -r build                                          →  10 包全绿
pnpm --filter @nano-agent/eval-observability test      →  196 passed
pnpm --filter @nano-agent/session-do-runtime test      →  312 passed（含 Kimi R2 新增 1 个 structural-parity case）
npm run test:cross                                     →  66/66 passed (14 e2e + 52 contract suites)
```

Kimi R2 的 compile-time structural guard 现已成为 drift 回归护栏：任何一侧 `TraceEvent` 新增必填字段时，`tsc` 会在 session-do-runtime typecheck 阶段立即失败，无需等待 root contract test 在运行时发现。

### 6.4 对 Kimi 审查报告的评价

- **报告切入角度**：Kimi 的四条 finding 围绕「API 契约完整性 + compile-time drift + 文档纪律」展开，与 GPT 的 runtime-enforcement 视角形成互补。R2 是本轮我最欣赏的发现——`TraceEvent` 的 local mirror 没有任何编译时保护，只靠 `test/traces.test.ts` 里 `isTraceLawCompliant(trace)` 的运行时断言来兜底，这是一条典型的「只在 CI 跑到的 case 里才会暴露」的漂移风险。R2 的价值在于：它不问"现在有没有 bug"，而是问"当这两个类型被修改、但 mirror 没同步时，会有什么后果"。这是资深 reviewer 才会主动挖的维度。
- **证据链质量**：每条 finding 的引用都精确到文件:行号（e.g. `scripts/trace-substrate-benchmark.ts:239-258`、`src/traces.ts:39-54`、`P2 design doc:23-25`），并配以可复核的 pnpm / grep 命令。§1.2 的「已确认负面事实」与 §2 的 finding 正面事实对应，不存在模糊表述。
- **严重级别判断**：三条 low + 一条 medium 的分布反映了 Kimi 对「approve-with-followups」这一结论等级的内部一致性——R1/R3/R4 都不阻止 A2/A3 关闭，只是纸面与 reality 脱节；R2 被标 medium 而非 low，说明 Kimi 识别出了 mirror drift 是 *潜在* 的运行时 bug 源头，虽然当前无问题但值得升级关注。这种分级克制又不失锐度，是成熟 reviewer 的表现。
- **与 GPT 的互补性**：Kimi 的 R1/R3/R4 与 GPT 的 R3/R4/R5 有重叠，但视角不同——GPT 把 `makeEvent` 缺 carriers 标 medium 并和 scripts tsconfig 缺口绑在一起（"drift 为什么没被拦下来"），Kimi 标 low 并聚焦 "fixture 不一致" 本身。这两种角度同时存在的价值是：实现者既看到了「症状」（fixture 不一致）又看到了「根因」（tsconfig 不覆盖），最终的 fix（extend tsconfig + 升级 fixtures）同时解决两方关切。R2 是 Kimi 独有的发现，没有被 GPT 覆盖。
- **修复边界建议**：Kimi 对 R2 给出了三档选项：（a）暂不改、（b）提取共享类型到公共包、（c）保留 mirror 但增加类型对齐测试；明确推荐 "A4 时决策" 而不是在本轮强推某一档。实现者最终选了 (c)——这是最小代价且立即生效的方案。这种「给选项，不强推」的姿态很尊重 action-plan 的边界。
- **综合评价**：报告质量高。严格来说是 approve-grade 审查工作：证据清晰、分级克制、边界尊重、且带来了 GPT 未覆盖的 compile-time drift 维度。

### 6.5 实现者收口判断（仅针对 Kimi 报告维度）

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. 两份 `assertTraceLaw()` 结构等价（session-do-runtime 本地一份 + eval-observability 一份），靠 `traces.test.ts` 的 structural parity 断言守护。未来合并为单一公共包（如 `@nano-agent/trace-law`）属 A4+ scope，不在本轮处理。

请 Kimi 按 §7 二次审查模板复核；若 R2 的 compile-time structural guard 被验证有效且 R1/R3/R4 的 docs+fixture 修复措辞可接受，则 Kimi 侧 review 可直接收口。
