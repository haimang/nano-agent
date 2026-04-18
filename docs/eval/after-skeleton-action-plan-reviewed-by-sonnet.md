# After-Skeleton Action Plan Review — by Sonnet

> 评审者: `Claude Sonnet 4.5`
> 评审时间: `2026-04-18`
> 评审对象: `docs/action-plan/after-skeleton/A1-A10` (10 份执行计划)
> 评审依据: `packages/` 代码事实 + `context/` 三套 agent-cli + `docs/design/after-skeleton/` 设计文档 + `docs/design/after-skeleton/PX-QNA.md`
> 文档状态: `final`

---

## 0. 总体结论

| 维度 | 评分 | 说明 |
|------|------|------|
| 设计与代码事实对齐度 | `8.5 / 10` | 绝大多数 action-plan 精确锚定了当前 stub reality；少量出现当前代码尚不存在的文件路径引用 |
| 与 PX-QNA 决策的一致性 | `9 / 10` | Q1-Q20 的 owner 结论基本被正确吸收；极少数地方存在 interpretation gap |
| 执行顺序与依赖链合理性 | `8 / 10` | A1→A3→A4→A5→A6→A7 主链清晰；A8/A9/A10 fake bash 三件套的独立性较高，风险可控 |
| 测试策略完备性 | `7.5 / 10` | 每份都有 unit/integration/cross 三层；但部分 integration test 路径尚未真实存在 |
| scope 控制与越界风险 | `9 / 10` | out-of-scope 约束明确；runtime-private wire 的回避意识贯穿始终 |
| **综合就绪度** | **`可启动执行`** | A1 可立即进入 Phase 1；A2 benchmark harness 需先于 A3 启动 |

---

## 1. A1 — Contract & Identifier Freeze（Phase 0）

### 1.1 代码事实对齐

**✅ 对齐良好：**
- `packages/nacp-core/src/envelope.ts` 中的 legacy field 清单（`producer_id / consumer_hint / stamped_by / trace_id / stream_id / span_id / reply_to`）与 A1 描述完全吻合
- `packages/nacp-core/src/compat/migrations.ts` 仍是 placeholder 的事实被准确引用
- `packages/nacp-session/src/messages.ts` 的 7 条 frozen message types 数量准确

**⚠️ 需要注意：**
- A1 把 `stamped_by -> stamped_by_key` 和 `reply_to -> reply_to_message_uuid` 列为 Phase 0 必做项，但代码中这两个字段仍用旧名出现在 `nacp-session/src/frame.ts` 和 `websocket.ts`。这意味着 rename 范围比 A1 目录树里列的更广——frame.ts 行 91 的 `Nacp-session SessionContext` 类型也包含这些字段，**A1 的文件影响清单可能低估了 session layer 的实际改动量**。

**❌ 关键遗漏：**
- A1 正文中完全没有提到 `TraceEventBase` 缺少 `traceUuid` 字段的问题（这是 A3 的事），但 P0 的 canonical envelope 中 `trace_uuid` 在 `NacpAlertPayload` 里仍是 optional。A1 应当在 Phase 2 的 `alert exception guard` 层面至少预设坐标，否则 A3 的 Phase 1 工作需要改动 A1 刚刚稳定的 core contract，产生回头浪费。

### 1.2 与 PX-QNA 对齐

- **Q1（follow-up family 最小 shape）**: A1 正确把它列为 "Q1: 待确认"，并在 Phase 1 P1-03 中设置了 micro-spec prep 工序，设计合理
- **Q2（baseline 版本号 1.1.0）**: 正确标为 pending，留在 Phase 5 拍板，不阻塞早期 phase
- **Q4（provisional baseline 口径）**: A1 把 migration chain 和 provisional baseline 的关系处理正确：先改字段，再在 Phase 5 切 1.1.0

### 1.3 执行风险评估

| 风险 | 级别 | 说明 |
|------|------|------|
| `nacp-session` rename 影响面低估 | `HIGH` | frame.ts / ingress.ts / websocket.ts 里的 `SessionContext` 也包含 legacy fields，A1 的估计偏保守 |
| follow-up family 形状未冻结时 P3-01 编码启动 | `HIGH` | 若 Q1 未在 Phase 1 前收敛，Phase 3 将再次陷入设计讨论 |
| compat layer 变成长期双语 | `MEDIUM` | migrations.ts 从 placeholder 升级为真实 migration chain 时，compat test 覆盖需要足够严格 |

### 1.4 建议

1. **在 P1-01（Legacy Field Inventory）阶段**，显式用 `rg` 扫描全仓，包括 `session-do-runtime/src/` 路径，确保遗漏的 consumer 一次性发现
2. **将 `NacpAlertPayload.trace_uuid optional` 的 concern 作为 P2-01 的前置 comment**，即便实际修复属于 A3，也应在 A1 的 core baseline 中留 TODO 锚点
3. **在 P5-02 baseline cut 之前**，明确 `1.1.0` 还是 `2.0.0`（因为 `reply_to -> reply_to_message_uuid` 是 breaking rename，可能不适合次要版本号）

---

## 2. A2 — Trace Substrate Decision Investigation（Phase 1）

### 2.1 代码事实对齐

**✅ 对齐良好：**
- `packages/eval-observability/src/sinks/do-storage.ts` 的 tenant-scoped JSONL + `_index` 设计被准确描述
- `packages/session-do-runtime/src/checkpoint.ts` 作为 DO hot state 承载的事实正确
- `packages/session-do-runtime/wrangler.jsonc` 只有 `SESSION_DO` binding、无 D1 wiring 的事实准确

**⚠️ 需要注意：**
- A2 的 `Phase 2` 要求新建 `packages/eval-observability/scripts/trace-substrate-benchmark.ts`，但当前 `eval-observability/` 的 `package.json` 里并没有 `scripts/` 执行路径。需要确认 `tsx` 是否在 devDependencies 中，否则 `P2-01` 的 runner skeleton 需要先补依赖。
- `packages/session-do-runtime/test/integration/checkpoint-roundtrip.test.ts` 在 A2 中被引用为"已存在"，但需要核实该文件是否真实存在。**如果该文件是空 placeholder，P2-03 的 baseline regression guard 会缺乏基础。**

### 2.2 与 PX-QNA 对齐

- **Q5（DO hot anchor 方向）**: A2 正确把"从设计判断升级为证据判断"作为目标
- **Q20（D1 升格 gate）**: P4-02 中对 D1 升格必须先出 benchmark memo 的处理完全符合 Q20 冻结结论
- **注意**: A2 没有提及 `wrangler` 本身无法在纯本地环境做真实 DO 延迟测试的问题。benchmark runner 在 vitest 环境中跑出的 p50/p99 是内存级别的，不反映真实 Cloudflare Worker 边缘延迟。这应当在 Phase 3 的 limitation 注释里明确写出。

### 2.3 执行风险评估

| 风险 | 级别 | 说明 |
|------|------|------|
| benchmark 结果是 synthetic，无法反映真实 DO 延迟 | `HIGH` | 必须在 artifact 中明确标注"P1 benchmark 是 local simulation；真实 deploy benchmark 属于 P5 scope" |
| runner 依赖的 `checkpoint-roundtrip.test.ts` 可能是 placeholder | `MEDIUM` | 在 P2-03 之前需要先验证该文件是否真实存在且有真实 assertions |
| D1 deferred 被误读为"等 benchmark 结果再说" | `LOW` | A2 对 Q20 gate 说明清楚，风险可控 |

### 2.4 建议

1. **在 P1-01 Reality Inventory 阶段**，显式核实 `checkpoint-roundtrip.test.ts` 是否有真实 assertions
2. **在 Phase 3 benchmark artifact 里**，用一个专门的 `⚠️ Synthetic Limitation` 章节说明：local in-process benchmark 不等于 deploy-shaped latency
3. **A2 是 A3 的前序**，但 A3 的 Phase 1 实际上只需要 substrate decision 的"方向确认"，不需要等待完整 benchmark artifact。可以允许 A3 Phase 1 并行于 A2 Phase 2 启动

---

## 3. A3 — Trace-first Observability Foundation（Phase 2）

### 3.1 代码事实对齐

**✅ 对齐良好：**
- `packages/eval-observability/src/trace-event.ts` 缺少 `traceUuid` 字段的诊断完全准确
- `packages/session-do-runtime/src/traces.ts` 中 `turn.started / turn.completed` 与 current session reality 漂移的问题被精确捕捉
- `packages/nacp-core/src/observability/envelope.ts` 中 `trace_uuid` 仍是 optional 的现实被正确指出

**⚠️ 需要注意（关键）：**
- A3 Phase 1 P1-02 要求给 `TraceEventBase` 新增 `traceUuid`，但 **A1 才是管 `nacp-core/src/observability/envelope.ts` 的 owner**。A3 的 Phase 1 P1-03（Alert Exception Guard）也修改了同一文件。这产生了一个 **双重所有权问题**：A1 的 P2-01 修改了 `envelope.ts` 的 canonical fields，A3 的 P1-02 和 P1-03 也修改了同文件。如果 A1 和 A3 的执行不严格串行，会产生 merge conflict 或回归。
- A3 的 Phase 4 工作量（llm/hook/tool/compact/storage/context seam instrumentation sweep）体量极大，4-01 与 4-02 两条工作项对 5 个邻接包的影响范围描述相对模糊，比其他 phase 的工作项颗粒度明显粗糙。

**❌ 关键遗漏：**
- A3 在 Phase 3 中涉及 `packages/session-do-runtime/src/turn-ingress.ts`，但这个文件同时也出现在 A4（session edge closure）的改动范围里。**A3 Phase 3 P3-03 与 A4 Phase 1 P1-02 在同一文件上存在 overlapping scope**，需要明确谁先、谁后、谁为 master。

### 3.2 与 PX-QNA 对齐

- **Q6（TraceEventBase 必须显式携带 traceUuid）**: A3 P1-02 直接对齐，设计正确
- **Q7（三层 conceptual layering）**: Phase 2 P2-02 的 Layer & Promotion Sync 工作正确映射到 Anchor/Durable/Diagnostic 三层
- **注意**: Q6 的 owner 决策要求"Phase 2 成立的前提"，但当前 A1 还没有完成，`envelope.ts` 还没有新 trace_uuid canonical field。这意味着 **A3 的 Phase 1 实际上对 A1 的完成有隐性依赖**，而 A3 的前序只写了 `A1`, `A2`，没有明确"A1 Phase 2 必须先完成"这个子依赖。

### 3.3 执行风险评估

| 风险 | 级别 | 说明 |
|------|------|------|
| A3 与 A1 在 `envelope.ts` 上的双重所有权 | `HIGH` | 必须在 A1 Phase 2 完成后再启动 A3 Phase 1 |
| A3 Phase 3 与 A4 Phase 1 的 `turn-ingress.ts` overlap | `HIGH` | 需要明确排序：A3 只做 trace wiring，A4 做 ingress pipeline 替换 |
| Phase 4 instrumentation sweep 工作量被低估 | `MEDIUM` | 5 个邻接包的 trace seam 补充，难度高于其他 phase，建议在执行前做一轮更细的 inventory |
| recovery 路径过重会把 A3 拉成 analytics project | `MEDIUM` | Phase 3 需要严格保持"至少一条恢复路径 + 至少一条显式失败路径"的下限，不要扩大 |

### 3.4 建议

1. **明确排序依赖**：在 A3 元信息里补充"A1 Phase 2 已完成"作为硬前置，而不是只写"上游前序: A1"
2. **解决 turn-ingress.ts 双重编辑问题**：在 A3 Phase 3 P3-03 里明确"只做 trace law enforcement，不改 ingress pipeline 结构"，确保 A4 才是 ingress 结构的 master
3. **Phase 4 instrumentation sweep 细化**：启动 Phase 4 前，用 `rg` 先扫各邻接包的 emit seam，比 A3 当前的描述更具体

---

## 4. A4 — Session Edge Closure（Phase 3）

### 4.1 代码事实对齐

**✅ 对齐良好：**
- `WsController` 和 `HttpController` 仍是 stub 的现实被准确描述
- `packages/nacp-session/src/ingress.ts` 已有 `normalizeClientFrame()` 的事实正确
- `turn-ingress.ts` 包含 `future-prompt-family` placeholder note 的描述与实际代码一致
- DO 里直接 `JSON.parse()` 后按 `message_type` 分支的问题被准确识别

**⚠️ 需要注意：**
- A4 Phase 1 P1-01 要求用 P0 widened session truth 替换 `future-prompt-family` placeholder，但这依赖 A1 Phase 3（Session Freeze Completion）的完成。**A4 的上游前序里只写了 `A1`, `A3`，没有明确"A1 Phase 3 必须完成"**，执行会面临"widened session family 还没落地"就开始 A4 Phase 1 的风险。
- A4 Phase 4 P4-02（Health/Alarm/Recovery Closure）的收口标准"heartbeat/ack/backpressure 进入 caller-managed enforcement reality"，这个标准本身没有量化——什么叫"进入"？需要在执行前确认一个可验证的最小 milestone。

### 4.2 与 PX-QNA 对齐

- **Q8（formal follow-up family 必须进入 P0 contract freeze）**: A4 正确地只消费 upstream frozen truth，不在 runtime 私造
- A4 的 no-owner-question 判断合理：Phase 3 确实不需要新的 owner 决策

### 4.3 执行风险评估

| 风险 | 级别 | 说明 |
|------|------|------|
| P0 widened family 在 A4 启动时可能尚未落地 | `HIGH` | A4 Phase 1 的实际前置条件是"A1 Phase 3 已完成"，应明确写入 |
| WS helper 被半装配 | `HIGH` | Phase 2 若只装配部分 helper，会产生"DO logic 一半，helper 一半"的新型漂移 |
| HTTP fallback 变成第二套协议 | `MEDIUM` | Phase 3 的 shared actor constraint 需要集成测试守住，而非仅依赖 design 表述 |

### 4.4 建议

1. **在 A4 头部的依赖说明里补充**："A1 Phase 3 Session Freeze Completion 已完成" 作为硬前置
2. **Phase 4 P4-02 的收口标准修订**：改为"heartbeat timeout → alarm.cancel() 已被 integration test 覆盖一次"，使其可验证

---

## 5. A5 — External Seam Closure（Phase 4）

### 5.1 代码事实对齐

**✅ 对齐良好：**
- `packages/session-do-runtime/src/composition.ts` 默认返回 `undefined` handle bag 的问题被精确描述
- `packages/hooks/src/runtimes/service-binding.ts` 仍是直接抛错 stub 的事实正确
- `packages/capability-runtime/src/targets/service-binding.ts` 已有 request/progress/cancel/response seam 的现实准确

**⚠️ 需要注意：**
- A5 Phase 3 要新建 `test/fixtures/external-seams/fake-provider-worker.ts`，这是一个 root 级别的测试 fixture，但当前仓内的目录结构在 root `test/` 下并没有 `fixtures/external-seams/` 子目录。**需要确认这个目录是新建还是与现有 `test/e2e/fixtures/` 合并。**
- A5 Phase 4 P4-01 的描述"remote delegate 最低必带 trace_uuid / tenant / request identity"——但 `trace_uuid` 在 A1 结束前还不是 canonical field，这里存在同样的前置依赖问题。

### 5.2 与 PX-QNA 对齐

- **Q9（capability/hook/fake provider 三条主 seam）**: 完全一致
- **Q10（P5 是 verification gate，不并行）**: A5 正确处理，P4 只到 handoff pack，不抢跑 L1/L2
- **Q12（gpt-4.1-nano golden path）**: A5 Phase 3 的 fake provider 正确地与 real provider 分层

### 5.3 执行风险评估

| 风险 | 级别 | 说明 |
|------|------|------|
| composition no-op 改造后与 session edge 的集成测试缺失 | `HIGH` | A4 与 A5 的集成点（session DO 调用 remote hook/capability）需要有跨包 integration test |
| fake provider worker shape 与 OpenAI-compatible drift | `MEDIUM` | 需要让 fake provider fixture 直接 import openai-chat adapter 的 response shape，而不是手写 mirror |
| startup queue / early event 丢失 | `MEDIUM` | P4-03 的处理是正确的，但需要有真实 failing case 来驱动这个 contract，否则很容易只停留在文字描述 |

### 5.4 建议

1. **在 P3-01 fake-provider-worker.ts 里**，明确让其 response shape go through `openai-chat.ts` 的 `normalizeStreamEvent`，而不是 hardcode，确保两者不分叉
2. **增加 A4→A5 的集成 gate**：至少一条 `session→hook→response` 的真实 composition 路径需要在 A5 Phase 2 P2-03 的收口标准里体现

---

## 6. A6 — Deployment Dry-Run and Real Boundary Verification（Phase 5）

### 6.1 代码事实对齐

**✅ 对齐良好：**
- 仓内只有一份 `wrangler.jsonc` 只绑定 `SESSION_DO` 的事实准确
- root `test/e2e/` 已有 14 个 fake-but-faithful 场景的现实准确
- `WsController / HttpController` 仍是 stub（在 A4 完成前）的依赖关系被正确标注

**⚠️ 需要注意（关键）：**
- A6 Phase 2 P2-01 要扩展 wrangler.jsonc，但当前 `wrangler.jsonc` 里的 binding 格式和 worker 的期望是否可以无缝热扩还需要验证。更重要的是，**L1 `wrangler dev --remote` 要求用户有 Cloudflare 账户和有效 API key**，而这在 CI 环境不一定可用。A6 应该在 Phase 1 里明确说明 L1 smoke 是"owner-local only"而不是"CI pipeline 自动运行"。
- A6 对 `test/e2e/` 里 14 个场景的 L0/L1/L2 映射（P1-03 Smoke Matrix Inventory）非常重要，但这一工作项的描述相当简略，实际操作中需要逐一评估每个 e2e 场景是否依赖 in-process globals（如 in-memory fake storage）而无法直接用于 L1。

### 6.2 与 PX-QNA 对齐

- **Q10（P5 是 verification gate）**: A6 的整体定位正确
- **Q11（L1 = wrangler dev --remote，L2 = wrangler deploy + smoke）**: A6 完整吸收
- **Q12（gpt-4.1-nano golden path）**: A6 Phase 4 P4-01 正确处理

### 6.3 执行风险评估

| 风险 | 级别 | 说明 |
|------|------|------|
| WsController / HttpController 残留 stub 直接阻塞 L1 | `HIGH` | A6 正确识别了这个风险，但 gate 条件需要明确：A4 Phase 3 必须先完成 |
| L1 环境依赖（Cloudflare 账户、secrets）无文档记录 | `HIGH` | P1-02 Profile Matrix 必须包含一份 owner-local environment setup checklist |
| 现有 e2e 场景中的 in-process global 依赖 | `MEDIUM` | 建议在 P1-03 inventory 时就标注"此场景需要 deploy-shaped rewrite"的 flag |
| real provider smoke 成本失控 | `LOW` | Q12 明确是单 golden path，A6 遵守了这个约束 |

### 6.4 建议

1. **在 A6 Phase 1 P1-02 的收口标准里增加**："存在一份可执行的 `verification/ENVIRONMENT.md`，记录 L1/L2 所需的 Wrangler login 态、secrets 注入方式和 owner-local assumptions"
2. **P1-03 Smoke Matrix Inventory 表格化**：为每条现有 e2e 场景标注 L0/L1/L2 可用性和改写成本评级

---

## 7. A7 — Storage and Context Evidence Closure（Phase 6）

### 7.1 代码事实对齐

**✅ 对齐良好：**
- `StoragePlacementLog` 在 `src/` 下基本只是 vocabulary，未被 runtime 消费的现实准确
- `ContextAssembler / CompactBoundaryManager / WorkspaceSnapshotBuilder` 在 `src/` 下基本只作为导出 seam 存在、未接入主路径的诊断准确
- `packages/eval-observability/src/sinks/do-storage.ts` 已能写入 tenant-scoped JSONL timeline 的叙述正确

**⚠️ 需要注意：**
- A7 Phase 3 P3-01 要记录 `dropped_optional_layers / drop_reason / required_layer_budget_violation`，这些字段在当前 `ContextAssembler` 的实现中并不存在（只有 `assembled / totalTokens / truncated / orderApplied`）。**A7 这里实际上是在给 ContextAssembler 补充新的 evidence fields，而不只是"接线"**——这个工作量应比 A7 当前描述的更重，且需要先修改 workspace-context-artifacts 的 type surface。
- A7 的上游前序包含 `A2`，但 A7 Phase 2 P2-03 的"real storage spot-check"实际上依赖的是 A6（L2 real-boundary smoke），而不只是 A2 的 benchmark artifact。应将"A6 Phase 4 已完成"列为 A7 Phase 4 的前置条件。

### 7.2 与 PX-QNA 对齐

- **Q5（DO hot anchor + R2 + D1 deferred）**: 完全遵从
- **Q13（四档 calibration verdict）**: A7 Phase 1 P1-03 正确把它转成执行 contract
- **Q14（P6 verdict 与 PX maturity 永久分离）**: A7 全程都在强调这条分离，设计合理
- **Q20（D1 升格 gate）**: A7 Sec 7.1 中明确 "D1 进入热路径 out-of-scope"，正确遵从

### 7.3 执行风险评估

| 风险 | 级别 | 说明 |
|------|------|------|
| ContextAssembler evidence fields 需要新建而非只接线 | `HIGH` | 这意味着 A7 Phase 3 P3-01 是一个 API 扩展，而非简单 instrumentation |
| 五类 evidence owner 分工在实际执行时会模糊 | `HIGH` | "谁来 emit"在 session/storage/workspace 交叉时容易产生争议 |
| evidence-only 观察无法支撑量化决策 | `MEDIUM` | A7 的 calibration verdict 更接近定性判断，对于真正的 storage threshold 决策可能不够精确 |

### 7.4 建议

1. **在 A7 Phase 3 P3-01 里明确区分**：哪些字段是"接线已有 seam"，哪些是"新增 evidence API"
2. **在 A7 头部的依赖说明里补充**："A6 Phase 4 L2 real-boundary smoke 至少已有一次执行记录"
3. **evidence 区分 runtime vs synthetic 来源**：在 Phase 4 P4-02 real spot-check 里，明确 evidence 记录要注明其来源（wrangler L2 vs synthetic E2E）

---

## 8. A8 — Minimal Bash Search and Workspace（Phase 7a）

### 8.1 代码事实对齐

**✅ 对齐良好：**
- `registerMinimalCommands()` 已把 12 个命令固定进 registry 的事实准确
- `rg` 当前仍只是 TS scan stub 的诊断正确
- `grep/egrep/fgrep` 还没有任何兼容 alias 的认定准确
- `MountRouter` 已有 `/_platform/` reserved namespace regression guard 的引用正确
- `test/e2e/e2e-07-workspace-fileops.test.mjs` 已证明 `ls/cat/write` 可通过 workspace mount 跑通的现实准确

**⚠️ 需要注意：**
- A8 Phase 3 P3-01 要把"degraded search stub"升级为"在 namespace 范围内扫描文本"，但 Worker/V8 isolate 环境中做文本扫描的实现需要纯 TS 实现，不能使用 ripgrep 二进制。**A8 没有明确说明 `rg` 的 TS 实现策略**（是 regex sweep + inline match，还是借助什么 Worker-native search primitive）。这个实现细节直接影响 P3-01 的工作量估计。
- `mkdir` 的 partial closure（P2-02）被描述为"要么补最小 backend primitive，要么保留 compatibility ack 但明确 partial"，这是一个二选一决策，但 A8 没有给出偏向哪侧的建议。这个决策应在 Phase 1 P1-02 的 disclosure sync 阶段同时收敛，不应留到 Phase 2 才做。

### 8.2 与 PX-QNA 对齐

- **Q15（`rg` 为 canonical search command）**: A8 完全遵从
- **Q16（`grep -> rg` 兼容 alias 是优先回补项）**: Phase 3 P3-02 正确实现，且限制为"最窄兼容"

### 8.3 执行风险评估

| 风险 | 级别 | 说明 |
|------|------|------|
| `rg` 的 TS 实现策略未定义 | `HIGH` | 在 Worker 环境中实现文本搜索的技术路径必须在 Phase 1 明确，否则 Phase 3 会出现重大返工 |
| `mkdir` partial 决策拖到 Phase 2 | `MEDIUM` | 建议在 Phase 1 P1-02 就给出 `mkdir` 的 capability grade 决定，避免它成为 Phase 2 隐形的 design gate |
| search 输出 bounded strategy 与 promotion seam 的接口未定义 | `MEDIUM` | P3-03 的 bounded search output 需要先确认 promotion/ref 路径已由 A7 建立 |

### 8.4 建议

1. **在 A8 Phase 1 P1-01 里增加一条工作项**：评估并冻结 `rg` 在 V8/Worker 环境中的 TS 实现策略（regex sweep vs 其他方法）
2. **将 `mkdir` partial/supported 决策提前到 Phase 1 P1-02**

---

## 9. A9 — Minimal Bash Network and Script（Phase 7b）

### 9.1 代码事实对齐

**✅ 对齐良好：**
- `capabilities/network.ts` 只是 URL 校验 + stub 文案的诊断准确
- `capabilities/exec.ts` 只是 code length acknowledgement + stub 的事实正确
- `planner.ts` 已把 bash path 收窄为 `curl <url>` 和 `ts-exec <inline code>` 的现实准确
- Q17 冻结"richer curl 选项只走 structured path"被正确吸收

**⚠️ 需要注意（关键）：**
- A9 Phase 3 P3-01（`ts-exec` Substrate Decision）是 **整个 after-skeleton action-plan 集里最大的未解决技术风险**。A9 把"Worker-native V8 isolate 内运行 TypeScript inline code"列为候选路径，但这在 Cloudflare Workers 环境里面临以下硬约束：
  - Workers 不能动态 `eval()` TypeScript（需要先编译）
  - 无法 `import()` 动态 URL（CSP 限制）
  - `Function()` constructor 存在但无法访问宿主 FS 或任意 Node API
  - remote sandbox via service binding 是唯一真正安全的路径，但需要一个独立的 tool-runner Worker
  
  **A9 把这个选择作为"substrate decision"留在 Phase 3 P3-01，但正确的处理应该是在 A9 启动前就完成 substrate decision**，否则 Phase 1 和 Phase 2 的所有 contract 冻结工作都可能因为 Phase 3 的 substrate 决定而返工。

- A9 Phase 4 P4-01（Service-Binding Upgrade Path）引用了 `ServiceBindingTarget` 作为 remote tool-runner 的升级口，但 `ServiceBindingTarget` 的 progress/cancel/response seam 只在 `capability-runtime` 包内定义，真正的 remote tool-runner Worker 还不存在。这个依赖链应当被明确说明。

### 9.2 与 PX-QNA 对齐

- **Q17（richer curl 只走 structured path）**: 完全遵从，A9 Phase 1 P1-01 正确冻结了边界

### 9.3 执行风险评估

| 风险 | 级别 | 说明 |
|------|------|------|
| `ts-exec` substrate 决策被推迟到 Phase 3 | `CRITICAL` | 应在 A9 启动时就明确：v1 是否接受"诚实 partial（ask-gated but no real execution）"的路线 |
| V8 isolate inline code 执行的 CSP/sandbox 约束 | `CRITICAL` | 在 Cloudflare Workers 环境中实现 `ts-exec` 几乎必须走 remote sandbox worker，这会给 A5/A6 增加额外的 worker fixture |
| restricted `curl` 在 Workers 中的 fetch API 行为 | `MEDIUM` | Workers 的 `fetch()` 对私有网络的处理和普通 Node fetch 不同，需要在 Phase 2 验证实际行为 |

### 9.4 建议

1. **在 A9 执行前，先做一个 `ts-exec` substrate pre-decision**：明确 v1 是"local in-process sandbox（Function constructor）"、"remote tool-runner worker"还是"诚实 partial（不执行，只记录意图）"。这个决策应当由 owner 在 A9 Phase 1 之前确认，而不是在 Phase 3 才"决定"
2. **如果决定走 remote tool-runner worker 路线**，应在 A5 的 fake worker fixture pack 里就预留一个 `fake-toolrunner-worker.ts`
3. **在 A9 Phase 1 P1-02 的 unsupported freeze 里**，明确把当前阶段的 `ts-exec` 列为 `Partial (ask-gated, no real execution)` 直到 substrate 决策完成

---

## 10. A10 — Minimal Bash VCS and Policy（Phase 7c）

### 10.1 代码事实对齐

**✅ 对齐良好：**
- `capabilities/vcs.ts` 已把 v1 git subset 明确为 `status/diff/log` 的事实准确
- `fake-bash/unsupported.ts` 已把 `UNSUPPORTED_COMMANDS` 与 `OOM_RISK_COMMANDS` 分开维护的现实正确
- `FakeBashBridge` 已有 hard-fail contract（unsupported/unknown/oom-risk/no-executor）的具体描述准确
- Q18（`git` v1 只保留 `status/diff/log`）和 Q19（五级 inventory 口径）被正确吸收

**⚠️ 需要注意：**
- A10 Phase 2 P2-01（Virtual Git Handler Baseline）要求 `git status/diff/log` 在"workspace truth 上有 deterministic 输出"，但当前 `WorkspaceNamespace` 并不维护 VCS metadata（staged changes、commit history）。**Virtual git 的 output 需要从哪里来？** 除非 session 里有真实的 git 历史跟踪，否则 `git status` / `git log` 只能是 fabricated deterministic output（比如"no changes"、"empty history"），这需要在 A10 Phase 1 里提前说明，避免 Phase 2 实现时产生歧义。
- A10 Phase 4 P4-01（Inventory Drift Guard）要建立"新命令必须同步更新 inventory"的守卫，但具体的守卫形式（TS 类型 narrowing、测试 fixture、还是 linting rule）没有说明。

### 10.2 与 PX-QNA 对齐

- **Q18（git v1 = status/diff/log only）**: 完全遵从
- **Q19（五级 inventory + ask-gated 正交）**: A10 Phase 1 P1-02 正确处理，且把 ask-gated 作为显式维度进入 inventory

### 10.3 执行风险评估

| 风险 | 级别 | 说明 |
|------|------|------|
| virtual git output 的数据来源未定义 | `HIGH` | `git status/diff/log` 的 deterministic output 需要一个清晰的"数据模型"，不能只是空 stub |
| inventory drift guard 的实现形式未定 | `MEDIUM` | 建议明确为"TS const `SUPPORTED_COMMANDS` 数组 = registry 唯一真相，tests 断言两者一致" |

### 10.4 建议

1. **在 A10 Phase 1 P1-01（Git Subset Freeze）里明确**：v1 `git status` 返回"workspace-scoped change log"（来自已有的 workspace namespace diff），还是简单返回"no git repo detected"。这个 design decision 决定了 Phase 2 P2-01 的实现路径
2. **drift guard 形式建议**：使用 TypeScript `const MINIMAL_COMMANDS = [...] as const` + `type MinimalCommand = typeof MINIMAL_COMMANDS[number]`，让 registry 和 inventory 共享同一类型定义，使 "inventory drift" 变成编译错误而非运行时测试

---

## 11. 跨文件综合评估

### 11.1 全局依赖链

```
A1 (P0-Phase 2) 完成
    ↓
A3 (P2-Phase 1) 启动 [BlockedBy: A1 envelope.ts 稳定]
    ↓
A3 (P2-Phase 3) 完成
    ↓
A4 (P3-Phase 1) 启动 [BlockedBy: A1 Phase 3 session freeze + A3 trace carrier]
    ↓
A4 (P3) 完成
    ↓
A5 (P4) 启动 [BlockedBy: A4 session edge baseline]
    ↓
A5 (P4) 完成
    ↓
A6 (P5) 启动 [BlockedBy: A5 external seams + A4 session edge]
    ↓  ↓
A2 (P1 benchmark) 可并行于 A1-A3
A7 (P6) 依赖 A6 Phase 4 L2 smoke 至少一次
A8/A9/A10 依赖 A7 的 evidence closure，但可以较早并行启动
```

### 11.2 最紧迫的 3 个全局 Blocker

| # | Blocker | 影响范围 | 建议行动 |
|---|---------|----------|----------|
| 1 | **`trace_uuid` 从 optional 升级为 required 的 A1/A3 双重所有权** | A1, A3, A4, A5 全链路 | 明确 A1 Phase 2 必须先于 A3 Phase 1 完成，且 alert exception 的 optional 语义在 A1 里做最小预坐标 |
| 2 | **`ts-exec` substrate 决策未在 A9 启动前明确** | A9, A5 fake worker, A6 L1/L2 | 由 owner 在 A9 Phase 1 之前明确 v1 `ts-exec` 的执行路线 |
| 3 | **A4 Phase 1 依赖 A1 Phase 3 完成，但依赖链没有写清** | A4, A5, A6 | 在 A4 文档里补充明确的 phase-level 前置条件 |

### 11.3 命名约定一致性

所有 A1-A10 都在 out-of-scope 中明确不进行 camelCase/snake_case 的形式化规定（这属于 linting 层）。这是合理的——naming convention 的统一应当在 A1 Phase 4 P4-03（Review Blocker & Checklist Sync）中以 checklist 形式明确，而不是每份 action-plan 各自声明。**建议在 A1 Phase 4 P4-03 明确约定：所有公共 TypeScript interface 字段使用 camelCase，而所有 protocol wire format 字段使用 snake_case，并在 checklist 里固定这条规则。**

### 11.4 SMCP / Safe Protocol 遵从程度

所有 10 份 action-plan 对"不私造 protocol"、"upstream truth 优先"、"local reference path 保留"的约束都有明确的 out-of-scope 声明。A9 的 `curl` restricted path 和 `ts-exec` worker-native constraint 也展现了对 Worker 安全边界的尊重。整体的 SMCP 遵从度高。

### 11.5 Identifier Law 执行情况

A1 是 Identifier Law 的 owner，其余 9 份 action-plan 基本上都在"使用 renamed fields（`trace_uuid`, `producer_key` 等）"的前提下描述后续工作，体现了对 A1 的依赖意识。唯一需要注意的是 **A3 Phase 2 P2-03 引用了新 field name `traceUuid`**（camelCase），而 A1 在 core 层使用的是 `trace_uuid`（snake_case）。需要确认 TypeScript interface（camelCase `traceUuid`）和 wire format（snake_case `trace_uuid`）的映射在哪个层发生，并在 A1/A3 里统一说明。

---

## 12. 执行就绪度评级

| Action Plan | 就绪度 | 阻塞项 |
|-------------|--------|--------|
| A1 | ✅ `可立即启动 Phase 1` | 无 |
| A2 | ✅ `可并行于 A1 Phase 1 启动` | 需先核实 checkpoint-roundtrip.test.ts 真实性 |
| A3 | ⚠️ `等待 A1 Phase 2 完成` | A1 Phase 2 必须先稳定 envelope.ts |
| A4 | ⚠️ `等待 A1 Phase 3 + A3 Phase 2 完成` | 两个前置条件 |
| A5 | ⚠️ `等待 A4 完成` | session edge baseline 必须先稳定 |
| A6 | ⚠️ `等待 A4 + A5 完成` | stub controllers 必须先被替换 |
| A7 | ⚠️ `等待 A6 Phase 4 完成` | 需要 L2 real smoke 作为 evidence 上游 |
| A8 | ✅ `可在 A7 Phase 1 完成后启动` | rg TS 实现策略需在 Phase 1 明确 |
| A9 | 🚫 `需要先完成 ts-exec substrate pre-decision` | CRITICAL 技术决策未完成 |
| A10 | ⚠️ `等待 A8 + A9 完成` | 需要 virtual git output 设计先决定 |

---

## 13. 最终建议摘要

1. **立即行动（今天）**：
   - A1 Phase 1 启动：执行 `rg` 全仓 legacy field inventory
   - A9 substrate pre-decision：owner 在 A9 启动前明确 `ts-exec` v1 的执行路线（推荐：诚实 partial + ask-gated，不延迟整个 A9 的 Phase 1/2）

2. **A1 完成后**：
   - A3 Phase 1 立即跟进
   - A2 可并行，但 benchmark artifact 要有 synthetic limitation 说明

3. **A1 Phase 3 + A3 Phase 2 完成后**：
   - A4 进入，与 A8 Phase 1 并行

4. **A4 完成后**：
   - A5 进入，fake worker fixtures 要包含 toolrunner slot（为 A9 预留）

5. **A5 + A4 完成后**：
   - A6 进入，重点是 wrangler profile matrix 和 environment checklist

6. **A6 Phase 4 完成后**：
   - A7 进入，evidence closure 以 real storage spot-check 为 anchor

7. **A7 完成后 + A9 substrate 确认后**：
   - A8/A9/A10 可并行推进 Phase 2/3

---

*本评审报告基于对 A1-A10 全量文本、packages/ 代码事实、context/ 工具约束以及 PX-QNA.md owner 决策的综合比对，采用 evidence-first 评审模型输出。*
