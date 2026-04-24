# F0-F5 Action-Plan Review Report

**审查员**: Kimi 2.6  
**审查日期**: 2026-04-24  
**审查范围**: `docs/action-plan/orchestration-facade/F0-F5` 六份执行计划文件  
**审查基准**: 
- 设计文档 (`docs/design/orchestration-facade/` 9份设计文档)
- FX-qna.md (8个核心决策Q&A)
- 现有代码实现 (`workers/agent-core/`, `workers/bash-core/`)

---

## Executive Summary

本审查报告对 GPT-5.4 基于 orchestration-facade 设计文档制作的 F0-F5 执行计划进行系统性审查。总体评估：**执行计划质量较高，与设计文档保持高度一致，但也存在若干需要关注和改进的关键问题**。

| 评估维度 | 评分 (1-5) | 说明 |
|----------|------------|------|
| 与设计一致性 | 4.5 | 9份设计文档核心结论均已正确吸收，QNA冻结答案被准确引用 |
| 执行可行性 | 4.0 | Phase拆分合理，但F1/F3/F4的实现复杂度可能超出预估 |
| 代码现状映射 | 3.5 | 对现有代码债务的认知部分不足，尤其是agent-core改造面 |
| 风险识别 | 4.0 | 主要风险已识别，但部分高风险编号缺乏充分缓解措施 |
| 边界控制 | 4.5 | In/Out-of-Scope界定清晰，有效避免了范围蔓延 |
| **综合评级** | **4.0** | **可执行，但需在F1前补强关键环节** |

---

## 1. 整体架构对齐评估

### 1.1 设计文档覆盖检查

所有9份设计文档的核心冻结点均已在执行计划中得到正确反映：

| 设计文档 | 核心冻结点 | 执行计划吸收情况 | 状态 |
|----------|------------|------------------|------|
| F0-compatibility-facade-contract | canonical public ingress转移、410/426 hard deprecation | F3 Phase 4明确吸收，same-PR翻转纪律已写入 | ✅ |
| F0-agent-core-internal-binding-contract | `/internal/*` route family、x-nano-internal-binding-secret、401 typed rejection | F1 Phase 3明确吸收 | ✅ |
| F0-stream-relay-mechanism | HTTP streaming + NDJSON + meta/event/terminal三类frame、relay cursor语义 | F1 Phase 4/F2 Phase 4分布吸收 | ✅ |
| F0-user-do-schema | 4字段schema、24h+100双上限retention、tenant_source审计 | F2 Phase 1/P1-02明确吸收 | ✅ |
| F0-session-lifecycle-and-reconnect | single active writable attachment、superseded close message、reconnect taxonomy | F2 Phase 3明确吸收 | ✅ |
| F0-contexter-absorption-inventory | adopt/adapt/defer/discard分类、jwt.ts adopt、CICP discard | F1 Phase 2/F3吸收jwt适配，CICP明确丢弃 | ✅ |
| F0-live-e2e-migration-inventory | orchestrator-core suite 7文件骨架、cross-e2e迁移清单 | F3 Phase 1-3完整吸收 | ✅ |
| F4-authority-policy-layer | TEAM_UUID bootstrap law、tenant_source、no-escalation、executor recheck seam | F4 Phase 1-3完整吸收 | ✅ |
| FX-qna | Q1-Q8全部冻结答案 | 各action-plan已正确引用 | ✅ |

### 1.2 代码现状映射差距

**关键发现**: 执行计划对`workers/agent-core/src/host/do/nano-session-do.ts`中`_unknown` fallback现状的引用存在**定位偏差**。

**设计文档引用**: 
- `F4-authority-policy-layer.md` §8.4 明确引用 `workers/agent-core/src/host/do/nano-session-do.ts:812-826` 作为反例
- `FX-qna.md` Q5 引用 `workers/agent-core/src/host/do/nano-session-do.ts:817-819`

**代码实际现状** (已核实):
```typescript
// workers/agent-core/src/host/do/nano-session-do.ts:816-819
const teamUuid =
  typeof envTeamUuid === "string" && envTeamUuid.length > 0
    ? envTeamUuid
    : "_unknown";
```

**差距分析**:
- 执行计划F4 P2-01提到"`_unknown` fallback只在test/local生效"，但未充分说明改造工作量
- `agent-core`当前是所有session traffic的中心，F1要在其上增加`/internal/*` route family，与现有`routeRequest()`逻辑共存
- 现有`routeRequest()` (routes.ts:49-62) 被F0-agent-core-internal-binding-contract §8.4标记为"现状问题"，但执行计划中F1 P3-01的改造描述过于简化

**建议**: F1 Phase 3应增加"existing route parser coexistence"子任务，明确`/internal/`路径如何从现有router中隔离。

---

## 2. 分阶段审查

### 2.1 F0 — Concrete Freeze Pack

| 审查项 | 评估 | 说明 |
|--------|------|------|
| Phase逻辑 | ✅ | 审计→收口→清单化→Closure的顺序合理 |
| 交付物定义 | ⚠️ | `F0-closure.md`产出定义清晰，但未明确由谁写入FX-qna答案的确认状态 |
| 工作量估计 | ✅ | Phase 1-4均为S/M级，符合纯文档工作 |
| 风险提醒 | ✅ | P1-01/P3-01的风险提醒到位 |

**关键问题**: F0作为freeze pack，其核心产出是"可执行真相层"。但审查发现`docs/eval/orchestration-facade/`目录下已存在DeepSeek和Opus的评审报告（`F0-FX-design-docs-reviewed-by-deepseek.md`、`F0-FX-design-docs-reviewed-by-opus.md`），F0应明确如何处理这些review findings的吸收状态。

### 2.2 F1 — Bring-up and First Roundtrip

| 审查项 | 评估 | 说明 |
|--------|------|------|
| Phase顺序 | ✅ | Scaffold→Ingress→Internal→Relay→Proof的顺序符合依赖关系 |
| In-Scope控制 | ⚠️ | S1-S4合理，但S3的"最小`/internal/*`"未明确是否包含`/internal/sessions/:id/stream` |
| 高风险编号 | 🔴 | P2-01(public start)、P3-01(internal route)、P4-01(relay)均为HIGH风险，但缺乏缓解措施细节 |
| 测试安排 | ⚠️ | P5-01提到package-e2e，但未明确session-start测试如何断言first event |

**关键问题1 — Stream Route范围模糊**:
`F0-agent-core-internal-binding-contract.md` §5.1 S1列举的route family包含`stream`:
```
/internal/sessions/:session_uuid/{start,input,cancel,status,timeline,verify,stream}
```

但F1 2.3边界判定表显示`cancel`是in-scope，对`stream`的判定是defer还是in-scope存在歧义。根据F1 §2.1 S3，应明确包含`start/cancel/stream`三条。

**关键问题2 — relay cursor初始值语义**:
F0-stream-relay-mechanism §7.2 F2定义:
> "初始值视为`-1`，reconnect从`relay_cursor + 1`开始"

但F1 P4-02仅写"对齐`relay_cursor = last_forwarded.seq`"，未明确first event前的初始状态如何处理。这在实现时可能导致off-by-one错误。

**建议**: 
1. F1 P3-01明确列出三条internal route: start/cancel/stream
2. F1 P4-02增加cursor初始化逻辑: "首次forward前cursor为-1，forward后更新为seq号"

### 2.3 F2 — Session Seam Completion

| 审查项 | 评估 | 说明 |
|--------|------|------|
| lifecycle完整化 | ✅ | P1-01覆盖status/last_phase/relay_cursor/ended_at/terminal reason |
| retention策略 | ✅ | P1-02的24h+100双上限与D3一致 |
| WS attachment | ⚠️ | P3-01的"superseded"行为需typed close message，但未明确消息发送时机 |
| reconnect taxonomy | ✅ | P3-02覆盖success/terminal/missing三种结果 |

**关键发现 — Superseded Message时机**:
`F0-session-lifecycle-and-reconnect.md` §7.2 F2要求:
> "新attach到来时，旧attachment必须先收到typed close message，再被server主动关闭"

但F2 P3-01/P3-02未明确这个顺序是在user DO中实现还是在WS handler中实现。考虑到user DO是state owner，这个逻辑应在user DO中完成，但当前F2的Phase 3描述偏向"WS attach"而非"registry update"。

**建议**: F2 P3-01增加子任务: "user DO中实现attachment替换逻辑与superseded消息发送"。

### 2.4 F3 — Canonical Cutover and Legacy Retirement

| 审查项 | 评估 | 说明 |
|--------|------|------|
| 迁移策略 | ✅ | Same-PR翻转纪律明确，符合Q7冻结答案 |
| suite建立 | ✅ | P1-01的7文件骨架符合F0-live-e2e-migration-inventory §7.2 F2 |
| legacy deprecation | ✅ | P4-01/P4-02的410/426语义与D1一致 |
| 测试完整性 | ⚠️ | P2-02提到auth-negative和legacy-410，但未明确06-auth-negative的内容 |

**关键问题 — Auth-Negative测试范围**:
F4 P4-01提到negative tests应覆盖:
- missing trace
- missing authority  
- tenant mismatch
- preview missing TEAM_UUID
- escalation

但F3 P2-02的06-auth-negative是F3的产出，F4的negative tests是F4的产出，存在**测试职责重叠**。06-auth-negative应聚焦在"JWT invalid/missing导致的ingress rejection"，而escalation/tenant mismatch应是F4的重点。

**建议**: F3 P2-02明确06-auth-negative范围: "JWT ingress层面的negative cases (missing/invalid token)"，将authority/escalation负例留给F4。

### 2.5 F4 — Authority Hardening

| 审查项 | 评估 | 说明 |
|--------|------|------|
| policy helper | ✅ | P1-01的centralized helper设计合理 |
| TEAM_UUID law | ⚠️ | P2-01提到5个worker的wrangler truth，但未明确是否包含context/filesystem-core |
| executor seam | ✅ | P3-02的bash-core executor.ts前置hook设计合理 |
| 风险提醒 | ✅ | 5.1风险提醒中"legality helper只存在名义上"识别准确 |

**关键问题 — Worker范围不一致**:
F4 §1.5影响目录树包含:
- orchestrator-core
- agent-core
- bash-core
- context-core, filesystem-core

但在P2-01提到"5个worker"，而1.5列出的是5个worker(orchestrator, agent, bash, context, filesystem)。这是正确的。

但`F4-authority-policy-layer.md` §8.4提到的反例只在agent-core，执行计划应明确context/filesystem-core的wrangler是否也需要TEAM_UUID（它们可能不需要，因为不直接处理session）。

**建议**: F4 P2-01增加判断逻辑: "只有处理session ingress的worker(orchestrator-core, agent-core)强制要求TEAM_UUID，其他worker可沿用现有配置"。

### 2.6 F5 — Closure and Handoff

| 审查项 | 评估 | 说明 |
|--------|------|------|
| Phase顺序 | ✅ | Review→Pack→Sync的顺序合理 |
| 交付物 | ✅ | Final closure + handoff memo + F5 closure三件套设计合理 |
| 约束纪律 | ✅ | "不越位代写下游charter"的约束明确 |

**观察**: F5作为整阶段收口，其质量高度依赖F0-F4的closure质量。建议在F0 action-plan中增加对各phase closure的格式要求。

---

## 3. 跨阶段依赖与冲突检查

### 3.1 依赖图验证

```
F0 (freeze pack)
  ↓
F1 (bringup: orchestrator shell + internal route + first relay)
  ↓
F2 (session seam: lifecycle + WS + reconnect)
  ↓
F3 (cutover: suite migration + legacy retirement)
  ↓
F4 (authority hardening)
  ↓
F5 (closure)
```

**依赖关系合理**，但存在以下**潜在冲突**:

### 3.2 测试文件编号冲突

F1 P5-01计划产出:
- `test/package-e2e/orchestrator-core/01-preview-probe.test.mjs`
- `test/package-e2e/orchestrator-core/02-session-start.test.mjs`

F3 P1-01计划产出7个文件，包含相同的01-02编号:
- `test/package-e2e/orchestrator-core/01-preview-probe.test.mjs`
- `test/package-e2e/orchestrator-core/02-session-start.test.mjs`

**冲突分析**: F1的02-session-start是"minimal live evidence"，F3的02-session-start是正式迁移版本。这实际上是**演进关系**而非冲突，但执行计划中未明确说明F1版本是否会被F3版本覆盖或增强。

**建议**: F3 P2-01明确: "F1的01-02测试将在F3中增强或替换，而非保留双份"。

### 3.3 cursor语义跨阶段一致性

- F0-stream-relay-mechanism: `relay_cursor = last_forwarded.seq`
- F1 P4-02: "对齐`relay_cursor = last_forwarded.seq`"
- F2 P1-01: SessionEntry包含`relay_cursor`

**潜在不一致**: F0定义cursor初始值为-1，F1/F2未明确初始值处理。F2的P1-01说"首次forward后写入entry"，但未说初始值是什么。

**建议**: 在F0-concrete-freeze-pack的交付物中增加"cursor语义cross-check"任务，确保F1-F4口径一致。

---

## 4. 代码实现可行性深度分析

### 4.1 agent-core改造面评估

现有`workers/agent-core/src/index.ts:49-62`:
```typescript
const route = routeRequest(request);
if (route.type === "not-found") {
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}
```

F1 P3-01要求:
> "在`agent-core`实现`start/cancel/stream`三条internal path，走index.ts早退，不污染legacy parser"

**实现复杂度被低估**:
1. 需要在index.ts中增加`pathname.startsWith("/internal/")`检查，但要在routeRequest之前
2. `/internal/*`需要全新的router，与现有的`routeRequest`并存
3. `stream` endpoint需要返回HTTP streaming response，与现有DO stub fetch模式不同

**风险**: F1 P3-01的"HIGH"风险评级合理，但缺乏缓解措施。建议增加: "先做internal route的typings和404 skeleton，再填充逻辑"。

### 4.2 orchestrator-core relay实现复杂度

F1 P4-01要求orchestrator user DO能读取NDJSON stream。这需要:
1. `fetch()`调用agent-core的`/internal/sessions/:id/stream`
2. `response.body`通过`TextDecoderStream` + line buffering处理
3. 解析每行的JSON，校验Zod schema
4. 维护relay cursor并写入DO storage

**问题**: F1 Phase 4和F2 Phase 1都涉及cursor写入，但F1的cursor是"初始语义"，F2是"完整语义"。这种分段可能导致F1验收时cursor行为不完整。

**建议**: 将cursor写入统一放在F2 Phase 1，F1只要求"能读取first event"，不要求cursor persistence。

### 4.3 bash-core executor seam兼容性

`workers/bash-core/src/executor.ts`当前已有:
- `CapabilityExecutor`类
- `execute()`和`executeStream()`方法
- Policy check在方法开始处

F4 P3-02要求增加"executor recheck seam"，即"在handler执行前预留集中hook"。

**实现建议**: 
在`execute()`方法中，policy check之后、handler查找之前增加:
```typescript
// F4 recheck seam
const recheckResult = await this.recheckSeam?.check({ plan, requestId });
if (recheckResult?.denied) {
  return { kind: "error", /* ... */ };
}
```

这与当前架构兼容，但F4 action-plan未明确seam的具体插入点。

---

## 5. 风险矩阵与缓解建议

### 5.1 高风险项

| 风险ID | 描述 | 影响阶段 | 缓解措施 |
|--------|------|----------|----------|
| R1 | agent-core internal route改造复杂度超出预估 | F1 P3 | 先实现404 skeleton，再填充；增加integration test覆盖率 |
| R2 | NDJSON framing实现漂移(与design不符) | F1 P4 | F0 freeze pack中增加frame type的Zod schema定义 |
| R3 | cursor语义off-by-one导致reconnect失败 | F2 P3 | F2 Phase 1增加cursor regression test套件 |
| R4 | legacy deprecation被拆分为多次PR | F3 P4 | 在F3入口条件中明确"必须single-PR翻转"纪律 |
| R5 | TEAM_UUID rollout到5个worker导致配置漂移 | F4 P2 | 创建`wrangler.jsonc`模板，要求统一结构 |

### 5.2 中风险项

| 风险ID | 描述 | 影响阶段 | 缓解措施 |
|--------|------|----------|----------|
| M1 | F1/F3测试文件演进路径不清 | F1→F3 | F3 Phase 2明确说明"增强而非保留双份" |
| M2 | superseded message发送时机未明确 | F2 P3 | 在user DO中而非WS handler中实现替换逻辑 |
| M3 | auth-negative测试职责与F4重叠 | F3→F4 | F3聚焦JWT层，F4聚焦authority层 |

---

## 6. 关键建议汇总

### 6.1 执行前必须处理 (Blockers)

1. **F1 P3-01**: 明确列出三条internal route (start/cancel/stream)，并增加改造复杂度缓解措施
2. **F1 P4-02**: 明确cursor初始值为-1，但persistence留给F2
3. **F3 P2-02**: 明确06-auth-negative仅覆盖JWT层负例

### 6.2 执行中建议关注 (Watch Items)

1. **F0**: 增加cursor语义cross-check任务，确保F1-F4口径一致
2. **F2 P3-01**: 明确superseded逻辑在user DO中实现
3. **F4 P2-01**: 明确只有session-handling workers强制要求TEAM_UUID

### 6.3 文档改进建议 (Nice-to-have)

1. 在F0 closure中要求各phase closure的格式模板
2. F3文档中说明与F1测试文件的演进关系
3. 增加一张"design frozen answers → action-plan编号"的映射表作为附录

---

## 7. 结论

**总体结论**: F0-F5 action-plan是一份**高质量、高一致性**的执行计划，正确吸收了9份设计文档的核心冻结点，准确引用了FX-qna的8个决策答案。计划结构清晰，边界控制良好，具备可执行性。

**主要关切**:
1. F1的agent-core internal route改造复杂度可能被低估
2. cursor语义在跨阶段衔接中存在off-by-one风险
3. F3/F4测试职责存在轻微重叠

**执行建议**:
- **可通过**: 执行计划在处理上述关切后可进入实施
- **建议**: 在F0 closure中增加"关键语义cross-check"任务
- **必须**: F1开始前明确agent-core改造的具体实施步骤

---

**审查员签名**: Kimi 2.6  
**审查完成时间**: 2026-04-24

---

## Appendix A: 引用代码位置清单

| 引用位置 | 文件路径 | 行号范围 | 用途 |
|----------|----------|----------|------|
| A1 | `workers/agent-core/src/index.ts` | 49-62 | 现有routeRequest调用点 |
| A2 | `workers/agent-core/src/host/do/nano-session-do.ts` | 816-819 | TEAM_UUID fallback现状 |
| A3 | `workers/bash-core/src/executor.ts` | 112-130 | Policy check现状 |
| A4 | `workers/agent-core/src/host/routes.ts` | 44-62 | Session route匹配逻辑 |
| A5 | `workers/agent-core/src/host/ws-controller.ts` | 52-63 | WS upgrade现状 |

## Appendix B: 设计→执行映射速查

| Design冻结点 | Design位置 | Action-Plan吸收位置 |
|--------------|------------|---------------------|
| x-nano-internal-binding-secret header | D2 §7.2 F2 | F1 P3-02 |
| NDJSON meta/event/terminal | D3 §7.2 F1 | F1 P4-01 |
| relay_cursor = -1初始值 | D3 §7.2 F2 | F1 P4-02 (需补强) |
| 24h + 100双上限 | D5 §7.2 F2 | F2 P1-02 |
| single active writable attachment | D6 §7.2 F2 | F2 P3-01 |
| superseded close message | D6 §7.2 F2 | F2 P3-02 |
| 410/426 hard deprecation | D1 §7.2 F2 | F3 P4-01/P4-02 |
| TEAM_UUID bootstrap law | D8 §7.2 F2 | F4 P2-01 |
| tenant_source审计字段 | D8 §7.2 F2 | F4 P2-02 |
| executor recheck seam | D8 §7.2 F4 | F4 P3-02 |

**注**: D1-D8指design文档编号，对应关系见§1.1表格。
