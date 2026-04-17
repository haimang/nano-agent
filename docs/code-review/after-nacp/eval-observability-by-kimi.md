# Code Review — @nano-agent/eval-observability

> 审查对象: `packages/eval-observability/`
> 审查时间: `2026-04-17`
> 审查人: `Kimi k2p5`
> 审查范围:
> - `docs/action-plan/eval-observability.md`
> - `docs/design/eval-observability-by-opus.md`
> - `packages/eval-observability/src/` (18 files)
> - `packages/eval-observability/test/` (9 files)
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：核心实现扎实，trace 三分法、sink、timeline、runner、replay、evidence helpers 均已就位且测试通过；但 action-plan 明确要求的多项文档、脚本与测试覆盖仍有缺失。
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. `DoStorageTraceSink` 实现了 append-only JSONL 与日期分 key，但 storage key 未包含 tenant scope，与设计 doc 的 `tenants/{team_uuid}/trace/...` 路径要求不符。
  2. action-plan 列出的 4 个 integration tests 中仅有 1 个存在，3 个 core 单测文件（trace-event / classification / durable-promotion-registry）完全缺失。
  3. `README.md` 与 schema/doc 生成脚本均未产出，影响下游直接使用与 review。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/eval-observability.md`
  - `docs/design/eval-observability-by-opus.md`
- **核查实现**：
  - `packages/eval-observability/src/` — 18 个源文件
  - `packages/eval-observability/test/` — 9 个测试文件
- **执行过的验证**：
  - `pnpm --filter @nano-agent/eval-observability typecheck` ✅ passed
  - `pnpm --filter @nano-agent/eval-observability test` ✅ 9 test files, 87 tests passed

### 1.1 已确认的正面事实

- `TraceEvent` base fields + evidence extensions（llm/tool/storage）已统一在 `trace-event.ts`，`index.ts` 导出完整。
- `classification.ts` 明确区分 `live-only`、`durable-audit`、`durable-transcript` 三类事件，避免了高频 progress 误入 durable。
- `DurablePromotionRegistry` 以可枚举 entry 形式记录默认 durable 规则，包含 granularity、replay visibility、revisit 条件。
- `DoStorageTraceSink` 正确实现 append-only JSONL、per-session 存储、日期分 key、buffer 自动 flush；`readTimeline()` 返回按时间排序的事件。
- `audit-record.ts` codec 将 `TraceEvent` 与 `nacp-core` 的 `audit.record` body 形状对齐，支持 truncate 与 round-trip。
- `ScenarioRunner` 支持 send/expect/wait/checkpoint/resume 五种 step，异常捕获完整，`deepEqual` 可用于对象级断言。
- `FailureReplayHelper` 可从 timeline 提取 error 事件、构建 summary、获取失败前上下文。
- `StoragePlacementLog` 与 `Attribution` helpers 覆盖 storage topology 与 llm/tool 归因需求。

### 1.2 已确认的负面事实

- `README.md` 文件不存在于 `packages/eval-observability/`。
- `scripts/export-schema.ts` 与 `scripts/gen-trace-doc.ts` 不存在。
- `test/trace-event.test.ts`、`test/classification.test.ts`、`test/durable-promotion-registry.test.ts` 不存在。
- `test/integration/session-timeline.test.ts`、`test/integration/failure-replay.test.ts`、`test/integration/ws-inspector-http-fallback.test.ts` 不存在。
- `DoStorageTraceSink` 的 storage key 为 `trace:{sessionUuid}:{date}`，未体现设计 doc 要求的 `tenants/{teamUuid}/trace/...` tenant scoping。
- `SessionInspector` 接收 `kind: string` 而非绑定到 `nacp-session` 的 9 种 stream event kinds，与 action-plan 中“严格消费现有 9 kinds reality”的表述有差距。

---

## 2. 审查发现

### R1. README.md 缺失

- **严重级别**：`high`
- **类型**：`docs-gap`
- **事实依据**：
  - `packages/eval-observability/README.md` 不存在
  - `docs/action-plan/eval-observability.md` P1-01 / P5-03 明确要求 README
- **为什么重要**：下游包（session-do-runtime、hooks、llm-wrapper）需要快速理解三分法、导入方式、v1 不支持项；无 README 会显著增加集成摩擦。
- **审查判断**：必须在收口前补齐。
- **建议修法**：添加 README，至少包含：包用途简述、三分法说明、主要导出清单（TraceSink / SessionTimeline / ScenarioRunner / FailureReplayHelper）、安装/导入示例、v1 限制与 out-of-scope 项。

### R2. 3 个核心单元测试文件缺失

- **严重级别**：`high`
- **类型**：`test-gap`
- **事实依据**：
  - action-plan §1.5 目录树列出 `test/trace-event.test.ts`、`test/classification.test.ts`、`test/durable-promotion-registry.test.ts`
  - 当前 test 目录中无上述 3 个文件
- **为什么重要**：trace taxonomy 是整个包的根基；若 classification 规则或 durable promotion registry 出现回归，会导致后续 sink/timeline/replay 全部漂移。
- **审查判断**：action-plan 明确将其列入单元测试范围，缺失属于未达标。
- **建议修法**：补齐 3 个单测文件：验证 `TraceEvent` schema 构造、验证 `classifyEvent` 矩阵、验证 `DurablePromotionRegistry` 的枚举与查询行为。

### R3. 3 个 integration tests 缺失

- **严重级别**：`high`
- **类型**：`test-gap`
- **事实依据**：
  - action-plan §1.5 列出 4 个 integration tests：`session-timeline.test.ts`、`failure-replay.test.ts`、`ws-inspector-http-fallback.test.ts`、`storage-placement-evidence.test.ts`
  - 当前仅 `storage-placement-evidence.test.ts` 存在（test/integration/storage-placement-evidence.test.ts:1）
- **为什么重要**：observability 的 value 在于端到端链路可验证；缺少 timeline + replay + inspector fallback 的集成验证，无法证明“trace 写入后能被正确读出并用于失败排查”。
- **审查判断**：必须在收口前补齐缺失的 3 个 integration tests。
- **建议修法**：
  - `session-timeline.test.ts`：用 fake DO storage 写入多种事件，验证 `SessionTimeline.fromSink()` 读取与排序。
  - `failure-replay.test.ts`：构造含 error 的 timeline，验证 `FailureReplayHelper` 提取失败路径并生成可读摘要。
  - `ws-inspector-http-fallback.test.ts`：验证 inspector 消费 stream event + HTTP fallback 读取 durable timeline 的模型一致性（可用 fake 模拟）。

### R4. DoStorageTraceSink 未实现 tenant-scoped key

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - `docs/design/eval-observability-by-opus.md` §7.1 F2 指定路径：`tenants/{team_uuid}/trace/{session_uuid}/{date}.jsonl`
  - `src/sinks/do-storage.ts:68` 实际 key 为 `` `trace:${this.sessionUuid}:${date}` ``
- **为什么重要**：设计 doc 与 action-plan 多次强调 tenant-scoped durable trace；虽然 DO 实例本身按 session actor 隔离，但 key 中缺失 teamUuid 会导致后续 archive/R2 迁移时无法直接从 key 推断租户归属。
- **审查判断**：属于显式需求遗漏，应在 key 中补回 teamUuid。
- **建议修法**：将 `DoStorageTraceSink` key 改为 `tenants/{teamUuid}/trace/{sessionUuid}/{date}.jsonl` 或至少 `trace:{teamUuid}:{sessionUuid}:{date}`，确保 tenant scoping 显式落地。

### R5. Schema/doc 生成脚本缺失

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - action-plan §1.5 列出 `scripts/export-schema.ts` 与 `scripts/gen-trace-doc.ts`
  - `packages/eval-observability/scripts/` 目录不存在
- **为什么重要**：脚本用于生成可供团队审阅的 trace contract 文档，是 action-plan P5-02 的明确产出。
- **审查判断**：可视为 non-blocking follow-up，但最好在收口前至少提供最小可用版本。
- **建议修法**：创建 `scripts/` 目录，实现最小版本：
  - `export-schema.ts`：将 `TraceEvent` 的 TypeScript 接口信息（或手动维护的 schema 对象）导出为 JSON。
  - `gen-trace-doc.ts`：读取 `DurablePromotionRegistry`，生成 markdown 表格说明各 event kind 的 durable 粒度与 replay 可见度。

### R6. SessionInspector 未显式绑定 9 种 session.stream.event kinds

- **严重级别**：`low`
- **类型**：`scope-drift`
- **事实依据**：
  - `src/inspector.ts:10` 的 `onStreamEvent(kind: string, ...)` 接受任意字符串 kind
  - action-plan P3-01 收口标准写明“严格消费现有 9 kinds reality”
- **为什么重要**：当前实现是泛型 stream inspector，虽能工作，但未在设计层面冻结与 `nacp-session` 9 kinds 的对应关系，可能导致后续 kind 名称漂移。
- **审查判断**：功能可用，但建议显式约束或至少文档说明。
- **建议修法**：在 README 或类型注释中说明 9 种 supported kinds；如需要严格约束，可将 `kind` 参数类型收窄为 `SessionStreamEventKind` union（需从 `nacp-session` 引入或本地镜像）。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | 独立包骨架 | done | package.json、tsconfig.json、build/test/typecheck 均正常 |
| S2 | TraceEvent schema | done | base + extensions 已冻结于 trace-event.ts |
| S3 | 三分法 + DurablePromotionRegistry | done | classification.ts 与 registry 实现完整 |
| S4 | TraceSink 接口 | done | sink.ts 接口清晰，index.ts 导出 |
| S5 | DoStorageTraceSink | partial | append-only JSONL 正确，但 key 缺少 tenant scope |
| S6 | audit.record codec | done | audit-record.ts 实现 builder/parser + truncate |
| S7 | SessionTimeline | done | timeline.ts 支持排序、filter、timeRange |
| S8 | SessionInspector | partial | 功能可用，但未显式绑定 9 kinds |
| S9 | WebSocket-first + HTTP fallback | partial | 设计已采纳，但缺少 `ws-inspector-http-fallback.test.ts` 验证 |
| S10 | ScenarioSpec / ScenarioRunner | done | scenario.ts + runner.ts 实现完整，9 个单元测试通过 |
| S11 | FailureReplayHelper | done | replay.ts 实现完整，但缺少 integration test |
| S12 | StoragePlacementLog | done | placement-log.ts 实现完整，集成测试已存在 |
| S13 | Attribution helpers | done | attempt/provider/gateway/cache-state/ttft 均已覆盖 |
| S14 | metric-names / evidence constants | done | metric-names.ts 已提供基线命名 |
| S15 | README / 导出 / schema 脚本 | missing | README 与 scripts 均缺失；3 个核心单测也缺失 |

### 3.1 对齐结论

- **done**: 11
- **partial**: 3
- **missing**: 1

> 该实现更像“核心骨架与运行逻辑已完成，但文档、脚本与部分测试覆盖仍未收口”，而非 action-plan 定义的全面完成状态。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 生产级 APM / alerting / dashboard | 遵守 | 未引入任何 APM 依赖 |
| O2 | 跨租户审计查询 API | 遵守 | 仅提供 per-session timeline |
| O3 | 完整 OTEL SDK / OTLP exporter | 遵守 | 未引入 OTEL 重依赖 |
| O4 | Billing / 成本结算 pipeline | 遵守 | 未涉及 |
| O5 | LLM quality benchmark 平台 | 遵守 | 未涉及 |
| O6 | Client-side UI 框架 | 遵守 | 未涉及 |
| O7 | D1 / structured query for trace events | 遵守 | 仅 append + scan |
| O8 | 全部 session.stream.event 无脑 durable 化 | 遵守 | classification.ts 明确过滤掉 llm.delta 等高频事件 |
| O9 | 生产 Worker 内嵌 scenario runner 常驻执行 | 遵守 | ScenarioRunner 是纯 harness，无生产 runtime 绑定 |
| O10 | 最终 archive 编排与 R2 生命周期策略本体 | 遵守 | 仅提供 sink/helper，不接管 wiring |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`approve-with-followups` — 核心代码质量高、功能正确、87 测试全过，但 action-plan 明确要求的 README、3 个缺失单测、3 个缺失集成测试、tenant-scoped key 与 schema 脚本必须补齐才能算真正收口。
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 补齐 `README.md`（R1）
  2. 补齐 `test/trace-event.test.ts`、`test/classification.test.ts`、`test/durable-promotion-registry.test.ts`（R2）
  3. 补齐 3 个缺失的 integration tests：`session-timeline.test.ts`、`failure-replay.test.ts`、`ws-inspector-http-fallback.test.ts`（R3）
  4. `DoStorageTraceSink` 的 storage key 必须显式包含 `teamUuid` tenant scope（R4）
- **可以后续跟进的 non-blocking follow-up**：
  1. 实现 `scripts/export-schema.ts` 与 `scripts/gen-trace-doc.ts`（R5）
  2. 考虑将 `SessionInspector` 的 `kind` 参数显式约束为 9 kinds（R6）

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应模板

> **规则**：
> 1. 不要改写 §0–§5；只允许从这里往下 append
> 2. 回应时按 `R1/R2/...` 对应，不要模糊说“已修一些问题”
> 3. 必须写明“哪些修了、怎么修的、改了哪些文件、跑了什么验证”
> 4. 若选择不修某条 finding，必须写明理由与 tradeoff

### 6.1 对本轮审查的回应

> 执行者: `{IMPLEMENTER}`
> 执行时间: `{DATE}`
> 回应范围: `R1–R6`

- **总体回应**：`{ONE_LINE_RESPONSE}`
- **本轮修改策略**：`{STRATEGY}`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | README 缺失 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R2 | 3 个核心单测缺失 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R3 | 3 个集成测试缺失 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R4 | DoStorageTraceSink 缺少 tenant scope | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R5 | schema/doc 脚本缺失 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R6 | SessionInspector 未显式绑定 9 kinds | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |

### 6.3 变更文件清单

- `{FILE_1}`
- `{FILE_2}`
- `{FILE_3}`

### 6.4 验证结果

```text
{TEST_OR_BUILD_OUTPUT_SUMMARY}
```

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview | partially-closed | blocked`
- **仍然保留的已知限制**：
  1. `{KNOWN_LIMITATION_1}`
  2. `{KNOWN_LIMITATION_2}`

---

## 7. 二次审查模板

> **规则**：
> 1. 二次审查人不得改写 §0–§6，只能继续 append
> 2. 二次审查必须区分：已验证修复有效 / 仅部分修复 / 新引入问题
> 3. 必须明确“本轮是否收口”

### 7.1 二次审查结论

> 复核者: `{REVIEWER}`
> 复核时间: `{DATE}`
> 复核依据: `实现者 §6 的回应 + 当前代码事实`

- **二次结论**：`{ONE_LINE_REREVIEW_VERDICT}`
- **是否收口**：`yes | no`

### 7.2 已验证有效的修复

| 审查编号 | 复核结论 | 依据 |
|----------|----------|------|
| R1 | `closed` | `{FILE:LINE / command / test}` |
| R2 | `closed` | `{FILE:LINE / command / test}` |

### 7.3 仍未收口的问题

| 审查编号 | 当前状态 | 说明 | 下一步要求 |
|----------|----------|------|------------|
| R3 | `open | partial | regressed` | `{WHY}` | `{ACTION}` |
| R4 | `open | partial | regressed` | `{WHY}` | `{ACTION}` |

### 7.4 二次收口意见

- **必须继续修改的 blocker**：
  1. `{BLOCKER_1}`
  2. `{BLOCKER_2}`
- **可后续跟进的 follow-up**：
  1. `{FOLLOWUP_1}`
  2. `{FOLLOWUP_2}`

> 若仍不收口，请明确写：请实现者根据本节继续更新代码，并在本文档底部追加下一轮回应。

---

## 8. 文档纪律

- review 文档是**append-only**的执行记录：
  - 初审写 §0–§5
  - 实现者回应写 §6
  - 二次审查写 §7
  - 如有第三轮，继续在底部追加 `§8+`
- 不要删除上一轮判断；如果观点变化，必须写“为什么变化”
- 每条结论都应尽量有**文件 / 行号 / 命令输出**支撑
- 如果 action-plan / design doc 的边界本身变了，先更新源文档，再继续 code review

---

## 9. 对 Kimi 代码审查质量的评价

> 评价人: `Claude Opus 4.7 (1M context)`
> 评价时间: `2026-04-17`
> 评价依据: `Kimi 审查（§1–§5）与最终代码复核结果的对照`
>
> 注：本次修复的具体工作日志全部写在 `docs/code-review/eval-observability-by-GPT.md §7`，不在此重复。

### 9.1 一句话评价

**稳健 + 覆盖面广**：Kimi 在单测 / 集成测试 / 脚本 / README 这类 "交付物清单" 类缺项上发现最齐全（R1–R3 + R5），但在协议真相对齐层（比如 `SessionInspector` 的 9-kinds 绑定严重性、`TraceEvent` 的 event-kind-specific guard 缺失）上不如 GPT 锋利。

### 9.2 优点

1. **清单型缺项极齐**：README、3 个核心单测、3 个集成测试、schema/doc scripts、tenant-scoped key——五条都踩在 action-plan §1.5 目录树的字面要求上，复核后全部属实并被本轮修复命中。
2. **R4 tenant scope 判定合理**：虽然严重级别只标了 `medium`（比 GPT 的 `critical` 轻），但给出的 key 样例 `tenants/{teamUuid}/trace/{sessionUuid}/{date}.jsonl` 与最终实现一致，节省了实现者再设计 key schema 的时间。
3. **out-of-scope 检查做得扎实**：§4 的 10 条 out-of-scope 逐项核对 "遵守" 并给出一句证据，而不是笼统 "一切都合规"——这对防止作者借 out-of-scope 放水很有帮助。
4. **verdict 判断合适**：`approve-with-followups` 的分级比 `changes-requested` 更贴合实际修复成本（以 MVP 迭代节奏看），但仍明确写了 "不允许关闭本轮 review"，没有因此放过 blocker。

### 9.3 可以更好的地方

1. **低估 tenant / hibernation 的严重级别**：R4 只给 `medium`，但实际上 `readTimeline()` 在新实例返回空数组会让 `SessionTimeline`、`FailureReplayHelper`、HTTP fallback durable read 全链路在最关键场景下失效（restart / restore 场景）。GPT 把它判为 `critical` 更准确。
2. **R6 `SessionInspector` 9-kinds 判 `low`**：同样低估——由于 `filterByKind` / `getLatest` 还会丢 `seq`/`timestamp`，这在 live debug 里是 "乱序 / 重复投递排查失败" 的源头。Kimi 没抓住这两条附属影响。
3. **attribution 粒度缺失未捕获**：GPT 的 R4 指出 `buildToolAttribution` 丢 `toolName` / `resultSizeBytes`，这是 action-plan §2.1 的明确要求，Kimi 的清单里没有对应条目。
4. **TraceEvent 类型面未展开**：Kimi 没提 "base + evidence extension 交叉类型" 缺 event-kind-specific guard 的问题，只在 S2 判 `done`。这条 GPT 也没完全拆开，两边都可以更锋利。
5. **缺失 "实机复现" 证据**：Kimi 的 R4 只引了两个文件行号证明 key 缺少 tenant；没有像 GPT 那样做 "用一个 sink 写入、用另一个 sink 读回 → 返回 `[]`" 的真实复现。实机复现能把 reviewer 的判断变得更难反驳，是 GPT 的明显优势。

### 9.4 评分

| 维度 | 评分（1–5） | 说明 |
|------|-------------|------|
| 证据链完整度 | 3.5 | 行号精准，但缺实机复现；证据偏 "清单式" |
| 判断严谨性 | 3.5 | R4 / R6 严重级别偏低，attribution 粒度漏网 |
| 修法建议可执行性 | 4 | key 样例、测试命名、scripts 命名都给得很具体 |
| 对 action-plan / design 的忠实度 | 5 | §1.5 / §7.1 / P5-02 等条目都引到位 |
| 协作友好度 | 5 | `approve-with-followups` 的语气理性，不逼反向工作 |

总体 **4.0 / 5** — 作为 "交付物清单审计" 的第一条防线非常有效，但在协议真相对齐与严重性定级上还可以更锋利。与 GPT 的审查互补性很好：两份并读，blocker 覆盖更完整。
