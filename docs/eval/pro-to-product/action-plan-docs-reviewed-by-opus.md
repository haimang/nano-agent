# Pro-to-Product Action-Plan 审查 — Opus

> 审查对象: `docs/action-plan/pro-to-product/PP0–PP6 (7 份 action-plan)`
> 审查类型: `docs-review`
> 审查时间: `2026-05-03`
> 审查人: `Opus 4.7 (1M context)`
> 审查范围:
> - `docs/action-plan/pro-to-product/PP0-charter-truth-lock-action-plan.md`
> - `docs/action-plan/pro-to-product/PP1-hitl-interrupt-closure-action-plan.md`
> - `docs/action-plan/pro-to-product/PP2-context-budget-closure-action-plan.md`
> - `docs/action-plan/pro-to-product/PP3-reconnect-session-recovery-action-plan.md`
> - `docs/action-plan/pro-to-product/PP4-hook-delivery-closure-action-plan.md`
> - `docs/action-plan/pro-to-product/PP5-policy-reliability-hardening-action-plan.md`
> - `docs/action-plan/pro-to-product/PP6-api-contract-docs-closure-action-plan.md`
> 对照真相:
> - `docs/charter/plan-pro-to-product.md`(基石)
> - `docs/design/pro-to-product/PPX-qna.md`(Q1–Q22 owner answers)
> - `docs/design/pro-to-product/{00…07}.md`(8 份 design)
> - 仓库代码事实(`workers/`、`packages/`、`clients/api-docs/`)
> 文档状态: `reviewed`

---

## 0. 总结结论

> 7 份 action-plan 在结构、phase 拆分、charter/QnA 引用上整体成立,可以作为 pro-to-product 阶段开发的执行基线。但存在 3 处需要修正才能进入实施(R1 / R2 / R7),以及若干文档纪律/口径补强项(R3–R6、R8–R12)。

- **整体判断**:`7 份 action-plan 主体可执行,charter/QnA 引用准确,但有 3 处会影响实施正确性的调整必须先修(包括 PP4 dep drift、PP3 现状口径、PP4 register surface 未定 owner)。`
- **结论等级**:`changes-requested`
- **是否允许关闭本轮 review**:`no`(需先 apply R1-R3 并复核)
- **本轮最关键的 1-3 个判断**:
  1. `PP4 在 §1.2 Phase 总览中把"Phase 1 依赖前序"写成 "PP1 + PP3 closure",**收紧了 charter §8.1 的 PP1→{PP2,PP3,PP4} 并行 DAG**;若不修,会在执行期把 PP4 错误串联到 PP3 之后。`
  2. `PP3 §0 描述 "agent-core persistence 里 replayFragment 仍 hard-code 为 null,restore 也没有恢复 helper replay 状态" 现状已部分变化 — 该文件 line 156-160 已增加 buildWsHelperStorage + helper.checkpoint() 路径,但 line 176 的 replayFragment: null 与 restoreFromStorage 不调用 helper.restoreFromStorage 仍成立。原文叙述需更新为 "WS helper persist 已存在,但 (a) checkpoint 内嵌的 replayFragment 仍为 null (b) restore 路径不对称",否则 P2-01/P2-02 的工作前提会被读者误解为"全部尚未开始"。`
  3. `PP4 §1.2 Phase 1 与 §3 P1-01 都说"session-scoped register/list/unregister",但全 7 份 action-plan 中唯一没有命名 owner file (例如 facade 中具体新 route 路径或现有 session-control.ts 何处加 handler)。这使得 PP4 启动时仍要做一次 owner-decision 才能继续,违背 charter §6.3 "每个 Phase action-plan 必须 owner file 明确" 的纪律。`

---

## 1. 审查方法与已核实事实

> 本节只写事实,不写结论。

- **对照文档**:
  - `docs/charter/plan-pro-to-product.md` v0.active.2(2026-05-02)
  - `docs/design/pro-to-product/PPX-qna.md`(Q1–Q22 已 reviewed,业主拍板)
  - `docs/design/pro-to-product/00-agent-loop-truth-model.md` … `07-api-contract-docs-closure.md`
  - `docs/templates/code-review.md`
  - `docs/eval/pro-to-product/design-docs-reviewed-by-opus.md`(本人前一轮 design 审查 + GPT 修复 + 二审)
- **核查实现 / 仓库事实**:
  - `package.json`(scripts 区段)
  - `workers/agent-core/src/host/runtime-mainline.ts`
  - `workers/agent-core/src/host/do/session-do-persistence.ts`
  - `workers/agent-core/src/host/do/session-do-runtime.ts`
  - `workers/agent-core/src/kernel/runner.ts`
  - `workers/agent-core/src/llm/executor.ts`
  - `workers/orchestrator-core/src/entrypoint.ts`
  - `workers/orchestrator-core/src/user-do/ws-runtime.ts`
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts`
  - `workers/orchestrator-core/migrations/`(001-017)
  - `clients/api-docs/`(22 份)
- **执行过的验证**:
  - `cat package.json | head -50`(确认 `test:package-e2e / test:cross-e2e / test:e2e` scripts 存在)
  - `ls clients/api-docs/`(确认 22-doc pack 与 PP6 §2.1 S1 列表完全一致)
  - `ls workers/orchestrator-core/migrations/`(确认 last migration `017`,与 charter §1.2 / §4.5 一致)
  - `grep -n "replayFragment" workers/agent-core/src/host/do/session-do-persistence.ts`(确认 line 176 仍为 `replayFragment: null`)
  - `grep -n "approval_policy\|tool-permission-required\|emit.*AndAwait" workers/agent-core/src/host/do/session-do-runtime.ts`(确认 `emitPermissionRequestAndAwait`@378 / `emitElicitationRequestAndAwait`@399 substrate 仍存在)
  - 行号反查:`runtime-mainline.ts:235-261` ask error-out;`runtime-mainline.ts:833-836` `requestCompact() => { tokensFreed: 0 }`;`entrypoint.ts:349` `decision: "ask", source: "unavailable"`;`ws-runtime.ts:60-145` attach + supersede;`surface-runtime.ts:280-319` `replay_lost`;`executor.ts:134-198` stream 无 retry;`kernel/runner.ts:412-428` 通用 `hook_emit` → `hook.broadcast`(均 confirmed)。
- **复用 / 对照的既有审查**:
  - `docs/eval/pro-to-product/design-docs-reviewed-by-opus.md`(本人写) — 用作 Q17 / Q19 / Q20 与 design 修订状态背景,**独立复核**了 action-plan 是否吸收 RR1-RR6 修订。
  - GPT closing-thoughts、deepseek/kimi design reviews — 仅作背景线索,本轮 verdict 全部独立得出。

### 1.1 已确认的正面事实

- **action-plan 总数 / 命名 / 编号** 与 charter §13.2 完全一致(PP0-PP6,7 份),无错位。
- **每份 action-plan 都引用了对应的 charter §6.1 phase 定义、PPX-qna 题号、design 文档**(`PP0-charter-truth-lock`@9-26、`PP1`@9-26、`PP2`@9-26 等);冻结来源标注链路诚实,无虚引用。
- **truth gate 对账**:
  - PP1 → T1(charter §10.1)
  - PP2 → T2
  - PP3 → T3 + T4
  - PP4 → T5
  - PP5 → T6
  - PP6 → T7 + final 7-gate verdict
  - 7 truth gates 与 7 phase 一一覆盖,无 gate 遗漏(PP0 negotiates 7-gate registry)。
- **Phase DAG**(charter §8.1):`PP0 → PP1 → {PP2 ∥ PP3 ∥ PP4} → PP5 → PP6` — 7 份 action-plan 的 `上游前序 / closure` 字段大体保持此 DAG,**唯一例外见 R1**。
- **代码引用准确性 spot check**(8/8 通过):
  - PP1@32 `runtime-mainline.ts:235-261` ask error-out → 实测 line 253 `decision === "ask" ? "tool-permission-required"`;✅
  - PP2@32 `runtime-mainline.ts:833-836` `requestCompact() => { tokensFreed: 0 }` → 实测 line 833-836;✅
  - PP3@34 `surface-runtime.ts:280-319` `replay_lost` → 实测 line 280-319 `handleResume` 内 `replayLost` 决策;✅
  - PP3@34 `ws-runtime.ts:72-145` attach + supersede → 实测 line 60-145 `current.socket.close(4001, "attachment_superseded")` 等成立;✅
  - PP3@34 `session-do-persistence.ts:154-222` 不对称 — **部分准确,见 R2**。
  - PP4@33 `kernel/runner.ts:412-428` 通用 `hook_emit` → `hook.broadcast` → 实测 line 405-430,✅
  - PP5@36 `entrypoint.ts:330-360` ask/unavailable → 实测 line 349 `decision: "ask", source: "unavailable", reason: "db-missing"`;✅
  - PP5@36 `executor.ts:134-198` stream 无 retry → 实测 line 134+ `executeStream` 无 retry/rotation 循环,主 throw;✅
- **22-doc pack 完整性**:`clients/api-docs/` 实际文件与 PP6 §2.1 S1 列表 100% 匹配(`README + auth + catalog + checkpoints + client-cookbook + confirmations + context + error-index + items + me-sessions + models + permissions + runtime + session-ws-v1 + session + todos + tool-calls + transport-profiles + usage + wechat-auth + worker-health + workspace`)。
- **migration 编号 anchoring**:`001-identity-core.sql … 017-team-permission-rules.sql`,17 份连续无缺口,与 charter §1.2 / §4.5 "若新增必须从 018 起顺延" 完全一致。
- **PPX-qna Q1-Q22 owner answer 反向引用**:
  - PP0 ↔ Q1-Q5;PP1 ↔ Q6-Q8;PP2 ↔ Q9-Q11;PP3 ↔ Q12-Q14;PP4 ↔ Q15-Q17;PP5 ↔ Q18-Q20;PP6 ↔ Q21-Q22 + Q5(回引);
  - 7 份 action-plan 在 §0 "本计划不重新讨论的设计结论" 段落都正确引用了对应 Q-编号,**没有改写已 frozen 的 owner answer**。
- **D1 例外 law 纪律**:PP2 §6 / PP3 §6 / PP5 §6 都引用 charter §4.5 D1 exception law,且 PP2 §1.4 风险控制原则 "如确需 schema 例外,必须满足 charter D1 exception law 并从 migration `018` 起顺延" 与 charter §4.5 第 6 条编号纪律完全一致。
- **out-of-scope 防线**:每份 action-plan 都有明确 §2.2 Out-of-Scope 列表,且与 charter §4.2 全局 out-of-scope(O1-O5)+ 各 phase §7.x out-of-scope 一致,无静默扩张。
- **Q17 fail-closed reversal 已吸收**:PP4 @133 / @306 / @378 都明确 "PermissionRequest 无 handler 默认 fail-closed,不 fallback confirmation"(与 PPX-qna Q17 业主已同意 Opus 意见一致)。
- **Q19 单一路径 freeze 已吸收**:PP5 @51 / @133 / @183-186 都把 stream first-wave 锁为 "显式 degraded + client retry",与 Q19 owner-answer + RR2 一致;不再保留 "内部 retry" open option。
- **Q20 unavailable 三态 已吸收**:PP5 §3 P2-02 "Unavailable tri-state/degraded" + §5.2 §具体功能预期 第 2 条 "将 db/control-plane missing 从 ask 改为 independent unavailable/degraded" + §6 Q20 表格,与 Opus 在 Q20 的"建议新增 `unavailable` 三态"具体实现化建议同步。
- **package.json scripts 已存在**:PP0 §1.5 / PP1 §8.1 / PP2 §8.1 / PP3 §8.1 / PP4 §8.1 / PP5 §8.1 / PP6 §8.1 引用的 `pnpm test:package-e2e` / `test:cross-e2e` / `test:e2e` / `check:docs-consistency` / `--filter @haimang/*-worker test` 全部已在 root `package.json` `scripts` 区段定义。
- **Frontend Engagement Schedule 同步**:PP0 §1.3 → FE-1;PP1 / PP3 → FE-2;PP6 §7.2 → FE-3 — 与 charter §6.4 三时点完全一致。
- **batch-review 纪律未被违反**:7 份 action-plan 的 §1.4 都使用 "回归测试" / "docs consistency" / "targeted tests" 等批量验证,无 per-doc review chain 出现。

### 1.2 已确认的负面事实

- **PP4 Phase 1 依赖前序 = `PP1 + PP3 closure`**(`PP4-hook-delivery-closure-action-plan.md` §1.2 Phase 总览 line 64),**与 charter §8.1 推荐执行顺序 "PP1 稳定后并行推进 PP2 / PP3 / PP4" 不一致**。charter 与 design 05 都未要求 PP4 在 PP3 closure 之后。这是**dependency drift**,会在执行期错误地把 PP4 串联到 PP3 之后,延长 critical path。详见 R1。
- **PP3 §0 现状描述部分过期**:`PP3-reconnect-session-recovery-action-plan.md` §0(line 34)说 "agent-core persistence 里 `replayFragment` 仍 hard-code 为 `null`,restore 也没有恢复 helper replay 状态(`workers/agent-core/src/host/do/session-do-persistence.ts:154-222`)"。**实测**:line 156-160 已增加 `buildWsHelperStorage + helper.checkpoint(helperStorage)` 持久化;但 line 176 `replayFragment: null` 与 line 193+ `restoreFromStorage` 不调用 `helper.restoreFromStorage()` 仍成立。叙述需更新为"persist 端已部分写入,但 (a) in-checkpoint replayFragment 仍 null (b) restore 端无对称恢复"。详见 R2。
- **PP4 register surface 缺 owner file**:`PP4-hook-delivery-closure-action-plan.md` §3 P1-01 / §4.1 P1-01 / §5.1 修改文件列表都写 `agent-core/orchestrator facade seam` 与 "可能的 `orchestrator-core` facade route 或 session-control seam"(line 151 / 170 / 207)— **唯一一份 action-plan 在 owner file 上保持模糊**。其他 6 份(PP1-PP3 / PP5)都给出 `workers/.../*.ts` 精确文件路径。详见 R3。
- **PP6 readiness label 与 design 07 / charter 不完全 1:1**:design 07 §5 / charter §0.5 (按 design-docs-reviewed-by-opus.md 二审)冻结的 5-label 集为 `live / first-wave / schema-live / registry-only / not-enforced`;PP6 §2.1 S5 line 133 写法一致 ✅,但 PP5 §2.1 S2 line 122 写 "明确 readiness 与 enforce/sunset window",未直接复用同一 5-label 集 — 不会破坏闭合,但跨 phase 表述不统一。详见 R4。
- **PP4 P3-02 `hook.broadcast` 与 generic `hook_emit` 路径关系未澄清**:当前 `kernel/runner.ts:412-428` 中 `handleHookEmit` 已经会发 `hook.broadcast` runtime event;PP4 §4.3 P3-02 / §5.3 §具体功能预期 line 261 说"frontend 可见 `hook.broadcast` 或等价 frame",但**未澄清 PreToolUse 的 dispatcher.emit 是否复用同一 `hook.broadcast` event,还是新增 frame 类型**。这是 frame catalog drift 风险点,PP6 sweep 时会撞上。详见 R5。
- **PP1 P3-01 "Pending read-model verification" 路由名未冻结**:`PP1-hitl-interrupt-closure-action-plan.md` §4.3 P3-01 line 176 说 "验证 `/confirmations?status=pending` 或等价 route 能恢复 pending UI",但**未冻结具体 route 路径**,而 design 02 / PP6 sweep 又要求 client-facing route 必须有唯一名。这会让 PP1 closure / PP6 docs sweep 出现两套口径。详见 R6。
- **PP2 "shared budget helper" 抽取归属未定**:`PP2-context-budget-closure-action-plan.md` §3 P1-01 / §4.1 P1-01 / §5.1 line 149 / 167 / 200-204 说 "审计 `resolveBudget()` 与 runtime request-builder,必要时抽共享 helper",但**未指明 helper 落在 `packages/` 还是某个 worker 内部**。charter §1.3 § "本阶段不新增 worker、不重写 6-worker topology" 不影响 helper 归属,但 helper 若放 `packages/`,则触发 `packages/` 公共表面变更,需 PP6 docs/contract 评估。详见 R7。
- **PP5 P2-02 三态 enum 改动 cross-package 影响未登记**:`workers/orchestrator-core/src/entrypoint.ts:347-349` 中 `authorizeToolUse` 返回类型 `decision: "allow" | "deny" | "ask"`,新增 `"unavailable"` 必须同步:(a) agent-core `authorizeToolPlan()` (`runtime-mainline.ts:235-261`) 的 `result.decision` 处理;(b) `packages/nacp-session/` 或共享 contract types 中所有 `decision` 引用;(c) PPX-qna Q8 7-kind freeze 不受影响(confirmation kind ≠ tool decision enum,Opus 二审已 cross-check)。PP5 §3 P2-02 / §5.2 line 154 / 235-237 没有展开此 cross-package change list。详见 R8。
- **PP6 readiness label 缺 hook 专题位置硬决策**:PP6 §3 P1-02 / §4.1 P1-02 / §5.1 line 162 / 182 / 222 都说 "Hook docs placement … 决定新增 `hooks.md` 或合并到现有专题"。这是合理 JIT,但未给出 PP4 closure 必须 input 的"是 / 否"判定 trigger。详见 R9。
- **PP4 `hook.broadcast` redaction 与 audit redaction 同源性未明**:PP4 §3 P3-02 / §5.3 line 158 / 261-263 说 "按 catalog redaction hints 处理,不把敏感 payload 原样广播"。`kernel/runner.ts:415-418` 当前的 `payloadRedacted: payload` 是 placeholder(并未做 redaction)。这是 design 05 已 cover 的话题,但 action-plan 没明确 redaction logic 的 owner module 与 test 覆盖位置。详见 R10。
- **PP5 latency baseline registration 落点缺一致约定**:Q2 + Opus 二审强调 "alert threshold 持续超阈值时,必须在 final closure 中显式登记"。PP5 §2 S6 line 127 提到 "retry 首个前端可见响应 ≤1s 为 alert threshold,不是 hard gate",但**未同步说"超阈值次数 / 接受 / 复现条件" 这三项必须落 PP5 closure §X" 这一具体 evidence shape**。其他 phase action-plan(PP1 §3 P3-03 / PP3 §4.4 P4-03)同样未细化。这是跨 phase 文档纪律,而非单 phase blocker。详见 R11。
- **PP0 e2e skeleton owner test 名称未冻结**:PP0 §3 P2-01 / §4.2 P2-01 / §5.2 line 144 / 165 / 207 说"在现有 `test/package-e2e` 或 `test/cross-e2e` 下选择最小 owner file"。PP0 是 charter §7.1 关键 phase,首个 skeleton **必须** 在 PP0 内冻结具体 owner test 名,否则 PP1-PP6 引用 "PP0 skeleton" 时无法对账。详见 R12。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 8 处关键代码 anchor 全部 spot-check;line 数与 action-plan 引用基本对齐(±5 行误差) |
| 本地命令 / 测试 | `yes` | `ls`、`cat`、`grep`、`sed -n` 反查 |
| schema / contract 反向校验 | `yes` | `clients/api-docs` 22-doc pack 与 PP6 §2.1 S1 比对;migration `001-017` 与 charter §1.2 / §4.5 比对;package.json scripts 与 7 份 action-plan §8.1 比对 |
| live / deploy / preview 证据 | `n/a` | 本审查针对 action-plan 文档,不涉及 deploy |
| 与上游 design / QNA 对账 | `yes` | 22 题 owner answer + 8 份 design + charter §1-§14 全文与 7 份 action-plan §0 / §6 / §2.1 / §2.2 / §10 / §13 直接对账 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | PP4 Phase 1 依赖前序串联到 PP3,违背 charter §8.1 并行 DAG | `high` | `scope-drift` | `yes` | 改为 "PP1 closure" only,移除 PP3 依赖 |
| R2 | PP3 §0 现状描述部分过期(persist 端已部分实现) | `medium` | `correctness` | `yes` | 重写 §0 line 34 为"persist 已部分写,但 in-checkpoint replayFragment + restore 端仍不对称" |
| R3 | PP4 register surface 缺 owner file | `high` | `delivery-gap` | `yes` | 在 PP4 §3 P1-01 + §5.1 修改文件列表,冻结具体 facade route 路径或 session-control 加 handler 位置 |
| R4 | readiness label 5-集在 PP5 / PP6 表述不统一 | `low` | `docs-gap` | `no` | PP5 §2.1 S2 直接复用 5-label 集名 |
| R5 | PP4 `hook.broadcast` 与 generic `hook_emit` 路径关系未澄清 | `medium` | `protocol-drift` | `no` | PP4 §4.3 P3-02 显式说明 PreToolUse 是否复用同 frame |
| R6 | PP1 P3-01 pending route 名未冻结 | `medium` | `delivery-gap` | `no` | PP1 §4.3 P3-01 冻结 `/sessions/{id}/confirmations?status=pending` 或等价路径 |
| R7 | PP2 shared budget helper 归属未定 | `low` | `docs-gap` | `no` | PP2 §3 P1-01 注明"若抽 helper 落 packages/budget,需 PP6 评估" |
| R8 | PP5 三态 enum cross-package 改动 list 未登记 | `medium` | `protocol-drift` | `no` | PP5 §3 P2-02 + §7.3 文档同步要求,枚举受影响 packages/types |
| R9 | PP6 hook docs placement 决策 trigger 未明 | `low` | `docs-gap` | `no` | PP6 §3 P1-02 注明"由 PP4 closure §X 决定" |
| R10 | PP4 hook.broadcast redaction owner 未明 | `low` | `delivery-gap` | `no` | PP4 §3 P3-02 指定 redaction helper 落点 |
| R11 | latency baseline 登记 evidence shape 跨 phase 不一致 | `low` | `docs-gap` | `no` | 各 phase closure 模板写明"超阈值次数 / 接受 / 复现条件" 三项 |
| R12 | PP0 e2e skeleton owner test 文件名未冻结 | `medium` | `delivery-gap` | `no` | PP0 §4.2 P2-01 冻结具体 test owner file 名,例如 `test/cross-e2e/pro-to-product/baseline-skeleton.test.mjs` |

### R1. PP4 Phase 1 依赖前序串联到 PP3,违背 charter §8.1 并行 DAG

- **严重级别**:`high`
- **类型**:`scope-drift`
- **是否 blocker**:`yes`
- **事实依据**:
  - `PP4-hook-delivery-closure-action-plan.md` §1.2 Phase 总览 line 64:`Phase 1 ... 依赖前序: PP1 + PP3 closure`
  - `PP4-hook-delivery-closure-action-plan.md` §7.2 line 325:`PP1 HITL 与 PP3 recovery 已稳定;hook e2e 可使用 PP0 evidence skeleton`
  - `plan-pro-to-product.md` §8.1 line 550-551:`PP1 稳定后并行推进 PP2 / PP3 / PP4`
  - `plan-pro-to-product.md` §8.2 line 557-567:DAG 中 `PP1 → {PP2, PP3, PP4}` 并行,`PP4` 仅有从 `PP1` 的入边
  - `plan-pro-to-product.md` §6.2 line 232:`PP4 ... 进入条件: PP1 confirmation / interrupt substrate 已可复用`(只提 PP1,无 PP3)
  - `plan-pro-to-product.md` §6.3 line 240:`PP3 可与后续 Phase 并行,但不得与 PP1 在同一 owner file 的高频改动窗口重叠。`(明确 PP3 是与"后续 Phase" 并行,不阻塞 PP4)
- **为什么重要**:
  - charter §8.1/§8.2/§6.2/§6.3 四处独立来源都明确 PP4 只依赖 PP1。把 PP4 串联到 PP3 closure 之后会:(a) 把 critical path 从 ~`PP0+PP1+max(PP2,PP3,PP4)+PP5+PP6` 拉长到 `PP0+PP1+PP3+PP4+PP5+PP6`,可能增加 30-50% 工期;(b) 让 PP4 owner 误以为"hook 必须在 reconnect/recovery 完成后才能开工",**人为创造一个 charter 没有的 dependency**,违背 charter §15.4 "若某项由 in-scope 改为 out-of-scope(或反向),必须同步更新 §4、§7、§10、§11" 治理纪律。
  - 这是 charter 与 action-plan 之间的事实漂移,不是合理的设计 narrowing(对比 RR6:design 05 主动从 charter T5 三选一收窄为 PreToolUse-only,是合理 narrowing,因为它**收紧** scope 而不是**扩大** dependency)。
- **审查判断**:
  - 这是 dependency drift 而非合理收窄。PP4 e2e 的确"可以"复用 PP0 skeleton + PP1 confirmation substrate,但**不需要**等 PP3 reconnect / recovery 完成。
  - 唯一的合理理由可能是"PP4 hook session-scoped register 的持久化与 PP3 helper.checkpoint 路径共享 owner file",但 PP4 §1.5 影响结构图 line 96-110 中 hook owner file 是 `workers/agent-core/src/hooks/registry.ts` + dispatcher + audit,与 PP3 owner file `session-do-persistence.ts` 不同,无 shared owner file 冲突。
- **建议修法**:
  1. PP4 §1.2 Phase 总览 line 64:把 `PP1 + PP3 closure` 改为 `PP1 closure`。
  2. PP4 §7.2 line 325:把 "PP1 HITL 与 PP3 recovery 已稳定" 改为 "PP1 HITL 已稳定;hook e2e 可使用 PP0 evidence skeleton 与 PP1 confirmation substrate(PP3 reconnect 与 PP4 可并行)"。
  3. PP4 §0 上游前序 line 11-13:从依赖列表中移除 `PP3-reconnect-session-recovery-action-plan.md` 与 `PP3-closure.md`,只保留 PP1 / PP0 / 05 design。
  4. 同步 PP3 §0 下游交接 line 16:确认未把 PP4 列为依赖 PP3 closure 的 phase(实测 PP3 §0 line 14-19 列出 `PP4 / PP5 / PP6`,这只是 handoff target 顺序,不是 dependency,但 PP3 §1.4 line 87-92 风险控制原则 "PP1 与 PP3 共享 `session-do-runtime.ts` 改动面" 也无 PP4 dep — 一致 OK)。

### R2. PP3 §0 现状描述部分过期

- **严重级别**:`medium`
- **类型**:`correctness`
- **是否 blocker**:`yes`(读者 / PP3 owner 会误读现状基线)
- **事实依据**:
  - `PP3-reconnect-session-recovery-action-plan.md` §0 line 34:`agent-core persistence 里 replayFragment 仍 hard-code 为 null,restore 也没有恢复 helper replay 状态(workers/agent-core/src/host/do/session-do-persistence.ts:154-222)`
  - 实测 `session-do-persistence.ts:154-160`:
    ```
    // A4 P2-03: persist the WS helper's replay + stream seq state so a fresh
    // DO instance can reconstruct the buffer after hibernation.
    const helperStorage = buildWsHelperStorage(ctx);
    const helper = ctx.getWsHelper();
    if (helper && helperStorage) {
      await helper.checkpoint(helperStorage);
    }
    ```
  - 实测 `session-do-persistence.ts:176`:`replayFragment: null,`(确实仍 null)
  - 实测 `session-do-persistence.ts:193-222` `restoreFromStorage()`:只恢复 `actorPhase / kernelSnapshot / turnCount`,**未调用 `helper.restoreFromStorage()`**(确实不对称)
  - `grep -n "buildWsHelperStorage\|restoreFromStorage" workers/agent-core/src/host/do/session-do-runtime.ts`:line 619 `buildWsHelperStorage(...)`、line 626 `private async restoreFromStorage()` — 但 restore 路径未联回 helper restore
- **为什么重要**:
  - 当前 §0 描述会让 PP3 owner 误以为"persist 与 restore 都未开始"。事实是:**persist 端有了 `helper.checkpoint(helperStorage)` 通道**(line 156-160),但 (a) 主 checkpoint object 内嵌的 `replayFragment` 仍 hardcoded null;(b) restore 端无对称恢复。
  - 这影响 P2-01 "Helper replay checkpoint persist" 的工作量估计 — 实际工作不是"从零写 persist",而是"决定 in-checkpoint replayFragment 字段是否仍保留,或全靠独立 helperStorage 通道",这是**两条不同设计选择**,需要在 P2-01 内被显式选择。
  - 现状误读会导致 PP3 重复造轮子 / 错误推翻已存在的 helperStorage 通道。
- **审查判断**:
  - 这是 docs/code 时序漂移,非概念错误。fix 简单,但若不修,执行期一定会撞上。
  - 建议在 fix 中显式给 PP3 owner 一个**两选一**的 design decision question(可写入 §6 依赖的冻结决策 / §7.3 文档同步要求):"主 checkpoint object 内 replayFragment 字段是否保留"。
- **建议修法**:
  1. PP3 §0 line 34 重写:
     ```
     当前 nano-agent 已具备 first-wave substrate:WS attach 解析 last_seen_seq,single
     attachment 会发 session.attachment.superseded 并关闭旧 socket
     (workers/orchestrator-core/src/user-do/ws-runtime.ts:72-145),socket close 会
     标记 detached(ws-runtime.ts:237-245),HTTP resume 已能返回 replay_lost 并写
     audit(surface-runtime.ts:280-319);agent-core persistence 已通过
     buildWsHelperStorage + helper.checkpoint() 写入 helper replay 状态
     (session-do-persistence.ts:154-160)。但仍有两个关键断点:(1) WS attach 的
     replay gap 不能 silent;(2) 主 checkpoint object 内 replayFragment 仍硬编码
     为 null(session-do-persistence.ts:176),且 restoreFromStorage 不调用
     helper.restoreFromStorage(session-do-persistence.ts:193-222),persist/restore
     仍不对称。
     ```
  2. PP3 §3 P2-01 工作内容(line 153)增补:"决定主 checkpoint object 内 `replayFragment` 字段去留 — 保留(与 helperStorage 通道双写)或废弃(只走 helperStorage 通道)。在 PP3 implementation 期作为 design decision 登记。"
  3. PP3 §4.2 P2-01 收口标准:把 "checkpoint schema 验证通过且非空" 改为更精确 — "persist 路径中 helperStorage 通道已写入 helper replay 状态,且主 checkpoint object 的 `replayFragment` 字段去留有明确决策"。

### R3. PP4 register surface 缺 owner file

- **严重级别**:`high`
- **类型**:`delivery-gap`
- **是否 blocker**:`yes`(PP4 启动前必须冻结)
- **事实依据**:
  - `PP4-hook-delivery-closure-action-plan.md` §3 line 151:`P1-01 ... 涉及模块 / 文件: agent-core/orchestrator facade seam`
  - `PP4-hook-delivery-closure-action-plan.md` §4.1 line 170:`P1-01 ... 涉及文件 / 模块: agent-core/orchestrator facade seam`
  - `PP4-hook-delivery-closure-action-plan.md` §5.1 line 207:`本 Phase 修改文件: ... 可能的 orchestrator-core facade route 或 session-control seam`
  - 对比其他 6 份 action-plan(PP1 §5.1 修改文件、PP2 §5.1、PP3 §5.1、PP5 §5.1)都给出 `workers/.../*.ts` 精确路径
  - charter §6.3 line 238:`PP1 先提供 interrupt substrate;PP2 与 PP4 只能建立在它的稳定输出上。`(暗示 PP4 是 implementation,不是 owner-decision phase)
  - 实测 `workers/orchestrator-core/src/facade/route-registry.ts:16-60` 列出现有 facade route handler;新 hook register route 如 `/sessions/{id}/hooks` 或 `/runtime/hooks` 必须在 register 注入,且 design 05 §6.1 已有"PreToolUse-only" 收窄但未指定 facade owner
- **为什么重要**:
  - PP4 是 implementation phase,不是 design phase。owner file 模糊会导致:(a) 启动前必须再做一次 design decision(谁加 route);(b) PP6 docs sweep 时无法对账"hook register 走哪条 route";(c) 与 charter §4.4 硬纪律 "每个 Phase 的 action-plan 与 closure 都必须以 truth gate 为对账单" 冲突 — owner file 不冻结意味着"无 owner file 可对账"。
  - 这与 PP4 §1.4 风险控制 "不做 full hook editor / admin plane / org policy UI" 不矛盾;最小 register surface 仍需要一个具体 entry。
- **审查判断**:
  - PP4 owner 在启动前必须先选择具体 owner:
    - **选项 A**:在 `workers/orchestrator-core/src/facade/routes/session-runtime.ts` 内增加 hook subroute(复用 runtime config 的 ETag/If-Match law)
    - **选项 B**:在 `workers/orchestrator-core/src/facade/routes/session-control.ts` 内增加(复用 confirmation control plane 的 row-first 模式)
    - **选项 C**:新建 `workers/orchestrator-core/src/facade/routes/session-hooks.ts`(独立 owner file,与 design 05 §6.1 PreToolUse-only 收窄一致)
  - Opus 倾向选项 C(新文件):理由 — hook contract 与 confirmation / runtime 各自语义不同,分文件可避免混入 session-control(已较拥挤);独立文件也方便 PP6 docs sweep 时建立 `clients/api-docs/hooks.md` 的 1:1 mapping。
- **建议修法**:
  1. PP4 §3 P1-01 line 151:把 `agent-core/orchestrator facade seam` 改为具体路径(建议 `workers/orchestrator-core/src/facade/routes/session-hooks.ts`(新建)+ `workers/agent-core/src/hooks/registry.ts`)。
  2. PP4 §4.1 P1-01 / §5.1 修改文件列表 同步。
  3. PP4 §1.5 影响结构图 line 99 加入新 owner file 节点。
  4. 若 owner 选择 A 或 B,在 PP4 §6 依赖的冻结决策表加入一条 "facade route owner = ..." 并解释理由。

### R4. readiness label 5-集在 PP5 / PP6 表述不统一

- **严重级别**:`low`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - PPX-qna Q21 owner answer line 329:`live / first-wave / schema-live / registry-only / not-enforced`(5-label 集已 frozen)
  - PP6 §2.1 S5 line 133:`每个 endpoint/frame/error/runtime field 标 live / first-wave / schema-live / registry-only / not-enforced`(✅ 与 Q21 一致)
  - PP5 §2.1 S2 line 122:`对 not-enforced/stored-only 字段保留 public shape,但在 API/docs/closure 中明确 readiness 与 enforce/sunset window`(未直接复用 5-label 集)
  - PP2 §2.1 S6 line 124:`auto compact 未接线前在 closure/docs 中标 registry-only;接线后再按代码事实升级`(✅ 用 5-label 集)
- **为什么重要**:
  - PP5 是 PP6 docs sweep 的直接 input,如果 PP5 closure 用了 "not-enforced/stored-only" 二选一,而 PP6 用 5-label 集,PP6 sweep 时仍需要做一次 label 翻译。
  - 这不是 blocker(label 子集是 5-label 集的一部分),但 docs 一致性会更稳。
- **审查判断**:
  - 复用同一 label 集成本极低,且 Q10/Q21 Opus 二审都已强调 "由 PP6 readiness label 法律决定具体标签,统一使用 5 选 1 标签集,不再有自由文本"。PP5 应直接对齐。
- **建议修法**:
  1. PP5 §2.1 S2 line 122 改为:`对 not-enforced 字段保留 public shape,但在 API/docs/closure 中明确按 5-label 集(live / first-wave / schema-live / registry-only / not-enforced)标注 readiness 与 enforce/sunset window`。
  2. PP5 §3 P1-02 工作项目标更新同步。

### R5. PP4 `hook.broadcast` 与 generic `hook_emit` 路径关系未澄清

- **严重级别**:`medium`
- **类型**:`protocol-drift`
- **是否 blocker**:`no`(可在 PP4 closure 前澄清)
- **事实依据**:
  - 实测 `workers/agent-core/src/kernel/runner.ts:412-428`:已存在 `handleHookEmit` 函数,处理 generic `hook_emit` step decision,emit `type: "hook.broadcast"` runtime event
  - `PP4-hook-delivery-closure-action-plan.md` §4.3 P3-02 line 158:`Frontend broadcast/redaction ... 发 hook.broadcast 或等价 frame,并按 redaction hints 脱敏`
  - `PP4-hook-delivery-closure-action-plan.md` §5.3 line 261:`frontend 可见 hook.broadcast 或等价 frame`
  - `PP4-hook-delivery-closure-action-plan.md` §0 line 33:`generic hook_emit 只会广播,不证明工具执行前 outcome 真生效`
- **为什么重要**:
  - 当前 `kernel/runner.ts:412-428` 的 `hook.broadcast` 来自 generic `hook_emit` step decision,即 LLM 决定的"显式 emit a hook"。PP4 PreToolUse caller 是**runtime mainline 在工具执行前主动 emit**,语义不同。
  - 如果两者复用同一 `hook.broadcast` event 类型,前端无法区分"是 LLM 显式 emit"还是"是 PreToolUse caller 触发"。如果新增 frame 类型,则 PP6 docs sweep 必须扩展 frame catalog。
  - charter §10.1 T5 要求 "register → emit → outcome → frontend visible + audit visible" 的 minimal loop,前端 visibility 要可分类。
- **审查判断**:
  - Opus 倾向**复用 `hook.broadcast` event 类型,但 payload 中加 `caller: "pre-tool-use" | "step-emit"` 字段**(或等价 source 字段),可在不增加 frame catalog 复杂度的前提下让前端区分。
  - 也可由 dispatcher 单独 emit `hook.outcome`(已存在于 NACP 协议族?)— 需 design 05 反查确认。
- **建议修法**:
  1. PP4 §3 P3-02 工作内容(line 158)增补:`PreToolUse outcome 复用 hook.broadcast event 类型,payload 内 caller 字段区分 pre-tool-use vs step-emit;若 design 05 已有专门 frame(hook.outcome 等),按 design 优先`。
  2. PP4 §4.3 P3-02 / §5.3 §具体功能预期 line 261 同步。
  3. 在 PP4 §3 工作总表加一条 P3-03 "Frame catalog placement decision":显式登记是否新增 frame 类型,以便 PP6 sweep 时直接吸收。

### R6. PP1 P3-01 pending route 名未冻结

- **严重级别**:`medium`
- **类型**:`delivery-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - `PP1-hitl-interrupt-closure-action-plan.md` §4.3 P3-01 line 176:`验证 /confirmations?status=pending 或等价 route 能恢复 pending UI`
  - `PP1-hitl-interrupt-closure-action-plan.md` §5.3 line 247:`前端刷新/重连后能通过 read model 找回 pending confirmation`
  - `clients/api-docs/confirmations.md` 现状(实测存在,内容未读)
- **为什么重要**:
  - "或等价 route" 留余地,但 PP6 docs sweep 时会撞 — PP6 §2.1 S1 22-doc list 中 `confirmations.md` 必须有唯一 pending route;PP1 closure 与 PP6 sweep 的 route 名必须一致。
- **审查判断**:
  - 不影响 PP1 闭合,但建议 PP1 在 P3-01 实现时直接选定 route 名(`GET /sessions/{id}/confirmations?status=pending` 或 `GET /sessions/{id}/confirmations/pending`),避免 PP6 时再改一次。
- **建议修法**:
  1. PP1 §4.3 P3-01 工作内容:`验证 GET /sessions/{id}/confirmations?status=pending 能恢复 pending UI`(去掉"或等价")。

### R7. PP2 shared budget helper 归属未定

- **严重级别**:`low`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - `PP2-context-budget-closure-action-plan.md` §3 P1-01 line 149:`Budget helper audit/extract ... possible shared helper`
  - `PP2-context-budget-closure-action-plan.md` §5.1 line 200-204:`Phase 新增文件: 可能的 shared budget helper test ... 修改文件: workers/context-core/src/control-plane.ts ... workers/agent-core/src/llm/request-builder.ts ... workers/agent-core/src/host/runtime-mainline.ts`
- **为什么重要**:
  - 若 helper 被抽到 `packages/`(例如 `packages/context-budget/`),会触发新 package 创建 + `packages/storage-topology` 类似的 cross-worker package contract;若留在 `workers/context-core/src/`,则继续 worker-local 但 agent-core 引用需要 service binding 或 deepImport(后者需评估)。
- **审查判断**:
  - PP2 owner 在 P1-01 实施时显式选择即可,不影响 PP2 主线。
- **建议修法**:
  1. PP2 §3 P1-01 工作内容增补:`若选择抽 helper 到 packages/,需在 PP2 closure 登记新 package 名,并 PP6 决定是否在 docs pack 增补条目`。
  2. 默认建议:**helper 留在 `workers/context-core/src/`**,agent-core 通过现有 `ContextRpc` service binding 调用(避免新 package);若需要 fallback 到本地估算,在 agent-core 内复制最小 token 估算逻辑。

### R8. PP5 三态 enum cross-package 改动 list 未登记

- **严重级别**:`medium`
- **类型**:`protocol-drift`
- **是否 blocker**:`no`
- **事实依据**:
  - 实测 `workers/orchestrator-core/src/entrypoint.ts:339-349`:`authorizeToolUse` 返回 `decision: "allow" | "deny" | "ask"`,新增 `"unavailable"` 三态需扩 enum
  - 实测 `workers/agent-core/src/host/runtime-mainline.ts:235-261`:`authorizeToolPlan` 接受 `result.decision` 然后 mapping 成 `tool-permission-required` / `tool-permission-denied`;新 `"unavailable"` 需新分支
  - `PP5-policy-reliability-hardening-action-plan.md` §3 P2-02 line 154:`Unavailable tri-state/degraded ... 涉及模块 / 文件: entrypoint.ts, runtime-mainline.ts ... db/control-plane missing 不再 ask`
  - `PP5-policy-reliability-hardening-action-plan.md` §5.2 line 235-237:`unavailable 不再返回 ask;优先新增 decision: "unavailable" 或等价 degraded branch`
  - PP5 §7.3 文档同步要求 line 327-336 仅提 `runtime.md / error docs`,**未列出 contract types 同步**
- **为什么重要**:
  - `decision` enum 是 cross-package contract(orchestrator-core ↔ agent-core);新增 `"unavailable"` 必须同步:(a) `workers/agent-core/src/host/runtime-mainline.ts` mapping;(b) 任何共享 types(可能在 `packages/orchestrator-auth-contract/` 或 `packages/nacp-core/`);(c) `clients/api-docs/permissions.md` / `error-index.md` 公开表述。
  - 若 PP5 不在 action-plan 阶段登记 cross-package change list,实施时可能漏一处。
- **审查判断**:
  - 这是 contract change,不是单 worker 实现细节。需要在 PP5 §3 / §5.2 / §7.3 显式 enumerate 所有受影响文件。
- **建议修法**:
  1. PP5 §3 P2-02 涉及模块 / 文件 line 154:从 `entrypoint.ts, runtime-mainline.ts` 扩为 `entrypoint.ts, runtime-mainline.ts, packages/(共享 decision enum 所在文件) , clients/api-docs/permissions.md`。
  2. PP5 §5.2 §具体测试安排 line 240-241:增补 `cross-package contract test:确保 agent-core 与 orchestrator-core 对 "unavailable" 三态语义一致`。
  3. PP5 §7.3 文档同步要求:增补 `clients/api-docs/permissions.md` 与 `error-index.md`(若新增 `tool-permission-unavailable` code)。

### R9. PP6 hook docs placement 决策 trigger 未明

- **严重级别**:`low`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - `PP6-api-contract-docs-closure-action-plan.md` §3 P1-02 line 162:`Hook docs placement ... 根据 PP4 closure 决定新增 hooks.md 或合并到现有专题`
  - `PP6-api-contract-docs-closure-action-plan.md` §5.1 line 222:`本 Phase 新增文件: clients/api-docs/hooks.md(仅当 PP4 public hook surface 需要独立专题)`
- **为什么重要**:
  - "根据 PP4 closure 决定" 缺具体 trigger — 例如 "如果 PP4 PreToolUse register surface 是独立 facade route,则新建 hooks.md;否则合并到 runtime.md 或 permissions.md"。
- **审查判断**:
  - 不影响 PP6 主线,但澄清后可减少 PP6 启动时再做一次 owner-decision。
- **建议修法**:
  1. PP6 §3 P1-02 工作内容:`根据 PP4 closure 中的 register surface owner file 决定 — 若为独立新 facade route(如 session-hooks.ts),新建 hooks.md;若复用 session-runtime.ts 或 session-control.ts,合并到对应 docs`。
  2. 与 R3 联动:PP4 owner file 一旦冻结,PP6 hook docs placement 即可同步冻结。

### R10. PP4 hook.broadcast redaction owner 未明

- **严重级别**:`low`
- **类型**:`delivery-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - `PP4-hook-delivery-closure-action-plan.md` §3 P3-02 line 158:`Frontend broadcast/redaction ... 按 redaction hints 处理,不把敏感 payload 原样广播`
  - 实测 `workers/agent-core/src/kernel/runner.ts:415-418`:`payloadRedacted: payload`(当前 placeholder,直接传 payload,**未做实际 redaction**)
  - `PP4-hook-delivery-closure-action-plan.md` §5.3 line 261-263:仅说"按 redaction hints 脱敏",未指定 redaction helper 落点
- **为什么重要**:
  - "redaction hints" 在 design 05 已 frame 定义,但 action-plan 应指明 helper 落 `workers/agent-core/src/hooks/redaction.ts`(新文件)还是复用某个现有 helper。
  - 若不指明,P3-02 实施时可能写成内联 redaction,增加 review 难度。
- **建议修法**:
  1. PP4 §3 P3-02 涉及模块 / 文件 line 158:增补 `workers/agent-core/src/hooks/redaction.ts(新建,封装 catalog redaction hints)`。

### R11. latency baseline 登记 evidence shape 跨 phase 不一致

- **严重级别**:`low`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - PPX-qna Q2 Opus answer line 44:`必须显式登记 "超阈值次数 / 是否接受 / 复现条件"`
  - PP1 §3 P3-03 line 150:`PP1 closure ... 记录三态证据与 latency alert`(未细化字段)
  - PP3 §4.4 P4-03 line 192:`PP3 closure ... 写 truth verdict、latency alert、known issues 与 PP5/PP6 handoff`(未细化)
  - PP5 §2.1 S6 line 127:`latency alert evidence:retry 首个前端可见响应 ≤1s 为 alert threshold,不是 hard gate`(只提阈值,未提登记 schema)
  - PP0 §1.4 line 87:`如果首个 skeleton 无法覆盖完整 HTTP+WS+durable 三件套,允许先标记 partial skeleton`(对 latency 未提)
- **为什么重要**:
  - charter §9.2 & PPX-qna Q2 都要求 closure 显式登记 latency alert evidence,但各 phase action-plan 都用 "登记 latency alert" 抽象表述。各 PP*-closure.md 写出来时可能 schema 不一致,PP6 sweep 难对齐。
- **审查判断**:
  - 这是 closure docs schema 一致性,可在 PP0 §3 P1-01 truth gate 对账表内同步定义 latency evidence shape(三字段:`exceeded_count / accepted_by_owner / repro_condition`),所有 PP*-closure 复用。
- **建议修法**:
  1. PP0 §3 P1-01 / §4.1 P1-01 工作内容(line 142 / 158)增补:`同步定义 latency alert evidence shape:每条 phase closure 必须包含 exceeded_count / accepted_by_owner / repro_condition 三字段`。
  2. PP1 / PP3 / PP5 closure 工作项目同步引用此 shape。

### R12. PP0 e2e skeleton owner test 文件名未冻结

- **严重级别**:`medium`
- **类型**:`delivery-gap`
- **是否 blocker**:`no`(PP0 内部即可解决)
- **事实依据**:
  - `PP0-charter-truth-lock-action-plan.md` §3 P2-01 line 144:`E2E skeleton owner file 定位 ... 选择最小可扩展测试入口,不新增框架`
  - `PP0-charter-truth-lock-action-plan.md` §4.2 P2-01 line 165:`在现有 test/package-e2e 或 test/cross-e2e 下选择最小 owner file`
  - `PP0-charter-truth-lock-action-plan.md` §5.2 line 207:`本 Phase 新增文件: test/package-e2e/**/pro-to-product-*.test.mjs 或 test/cross-e2e/**/pro-to-product-*.test.mjs`
  - 后续 PP1 §4.3 P3-02 / PP3 §4.4 P4-02 / PP4 §4.4 P4-01 都引用 "PP0 skeleton" 作为扩展起点
- **为什么重要**:
  - PP1-PP6 的 e2e 引用 "PP0 skeleton",若 PP0 不冻结具体 owner test 文件名,后续 phase 各自创建新 owner file → PP0 skeleton 失去 anchor 价值。
- **审查判断**:
  - PP0 §3 P2-01 应在 PP0 实施时直接选定 owner file 名(例如 `test/cross-e2e/pro-to-product/baseline-skeleton.test.mjs`),并在 §1.5 影响结构图标注。
- **建议修法**:
  1. PP0 §3 P2-01 / §4.2 P2-01 / §5.2 line 207:把 "或" 改为具体路径,建议 `test/cross-e2e/pro-to-product/baseline-skeleton.test.mjs`(理由:cross-e2e 比 package-e2e 更接近 frontend trust 边界,符合 charter §3.1 "前端可信" 主题)。

---

## 3. In-Scope 逐项对齐审核

> 本节按 charter §6.1 phase 总表与 §13.1/13.2 doc 清单逐项对齐。

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | PP0 charter & truth lock action-plan | `done` | 文件存在,§0 / §1 / §3 / §10 完整,但 P2-01 owner file 名待冻结(R12) |
| S2 | PP1 HITL interrupt closure action-plan | `done` | 主线扎实,引用 Q6/Q7/Q8 准确;P3-01 route 名待冻结(R6) |
| S3 | PP2 context budget closure action-plan | `done` | 引用 Q9/Q10/Q11 准确;helper 归属待定(R7) |
| S4 | PP3 reconnect & session recovery action-plan | `partial` | §0 现状描述部分过期(R2),需 update 后才能 OK |
| S5 | PP4 hook delivery closure action-plan | `partial` | dependency drift(R1)+ register surface 未冻结(R3)+ hook.broadcast 路径未澄清(R5)+ redaction owner 未明(R10) |
| S6 | PP5 policy & reliability hardening action-plan | `done` | 主线扎实,Q17/Q19/Q20 已吸收;cross-package change list 待补(R8) |
| S7 | PP6 API contract docs closure action-plan | `done` | 22-doc pack inventory 准确;hook docs placement trigger 待明(R9) |
| S8 | charter §10.1 7 truth gates 对账 | `done` | 7 phase 与 7 truth gate 一对一,无遗漏 |
| S9 | charter §4.5 D1 例外 law 引用 | `done` | PP2 / PP3 / PP5 都引用,migration 编号 anchor 准确 |
| S10 | charter §6.4 Frontend Engagement Schedule(FE-1/FE-2/FE-3) | `done` | 三时点 mapping 完整 |
| S11 | charter §13.4 JIT design freeze 纪律 | `done` | 7 份 action-plan 都正确假设 design 已 frozen 才进 implementation |
| S12 | PPX-qna Q1-Q22 owner answer 反向引用 | `done` | 22 题全部被对应 phase action-plan 引用,无 stale ref |
| S13 | charter §9.2 latency baseline 登记纪律 | `partial` | latency alert evidence shape 跨 phase 不一致(R11) |
| S14 | charter §4.4 batch-review 纪律 | `done` | 7 份 action-plan §1.4 全部使用 batch / targeted / regression test 节奏,无 per-doc review chain |
| S15 | PP4 §3 register surface owner file | `missing` | R3 |
| S16 | PP3 §0 现状基线诚实性 | `partial` | R2 |
| S17 | PP4 §1.2 dependency DAG | `missing` | R1(写错了 dep,需要修) |
| S18 | PP5 三态 enum cross-package change list | `partial` | R8 |
| S19 | PP6 hook docs placement decision trigger | `partial` | R9 |
| S20 | PP4 hook.broadcast frame catalog placement | `partial` | R5 |
| S21 | latency closure evidence shape 同步 | `partial` | R11 |
| S22 | PP0 e2e skeleton owner test 文件名 | `partial` | R12 |
| S23 | PP1 pending confirmation route 名 | `partial` | R6 |
| S24 | PP2 budget helper 归属 | `partial` | R7 |
| S25 | PP4 hook.broadcast redaction helper owner | `partial` | R10 |
| S26 | PP5 readiness label 5-集复用 | `partial` | R4 |

### 3.1 对齐结论

- **done**: 12
- **partial**: 12
- **missing**: 2(R1 dep drift / R3 owner file 未定)
- **stale**: 0
- **out-of-scope-by-design**: 0

> 总体看,**主线骨架已成立**:7 份 action-plan 与 charter §6/§7/§8/§10/§13 一一对齐,Q1-Q22 owner answer 全部被吸收,代码 anchor 引用准确。但 PP4 dependency drift(R1)与 PP4 register surface owner file 未冻结(R3)两项是必须修才能进入实施的 blocker;PP3 §0 现状描述部分过期(R2)是必须修才能让读者正确理解 baseline 的诚实性问题。其他 partial 项不阻塞实施,但建议在 R1-R3 修复同时一次性吸收。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | Multi-provider routing / provider abstraction(charter §4.2 O1) | `遵守` | 无任何 action-plan 涉及 multi-provider |
| O2 | Sub-agent / multi-agent(charter §4.2 O2) | `遵守` | 无涉及 |
| O3 | Admin plane / billing / SDK extraction(charter §4.2 O3) | `遵守` | PP4 §2.2 O3 / PP6 §2.2 O2 都明确 not in scope |
| O4 | Full hook catalog 14/18 全接通(charter §4.2 O4) | `遵守` | PP4 §2.2 O1 明确 minimal loop |
| O5 | Sandbox / bash streaming progress / WeChat 完整产品化(charter §4.2 O5) | `遵守` | 无涉及 |
| O6 | exactly-once replay(PPX-qna Q12 owner answer) | `遵守` | PP3 §2.2 O1 / §6 Q12 明确 |
| O7 | 多活动 attachment(PPX-qna Q13) | `遵守` | PP3 §2.2 O2 明确 |
| O8 | LLM-based summary(PPX-qna Q11) | `遵守` | PP2 §2.2 O1 / §6 Q11 明确 |
| O9 | 新增 D1 表(charter §4.5 + PPX-qna Q9) | `遵守` | PP2 §2.2 O2 / §6 D1 exception law 引用准确;migration `001-017` 与 §4.5 第 6 条 "新 migration 必须从 018 起顺延" 对齐 |
| O10 | shell hook(PPX-qna Q16) | `遵守` | PP4 §2.2 O2 / §6 Q16 明确 |
| O11 | OpenAPI / doc generator(PPX-qna Q22) | `遵守` | PP6 §2.2 O2 / §6 Q22 明确 |
| O12 | full hook editor / admin UI / org policy UI | `遵守` | PP4 §2.2 O3 明确 |
| O13 | stream 内部 retry(PPX-qna Q19 + RR2) | `遵守` | PP5 §2.2 O3 / §6 Q19 锁定为 "显式 degraded + client retry" 单一路径 |
| O14 | network proxy / sandbox worker | `遵守` | PP5 §2.2 O2 明确 |
| O15 | 重写 6-worker topology(charter §1.3 第 1 条) | `遵守` | 无 action-plan 涉及拓扑变更 |
| O16 | 新增 worker(charter §1.3) | `遵守` | 无新增 worker;唯一 R3 提到的"新 facade route owner file" 仍在 orchestrator-core 内 |
| O17 | PP4 PostToolUse 作为 hard gate(PPX-qna Q15 / RR6) | `遵守` | PP4 §2.2 O5 / §3 边界判定表明确 PostToolUse = secondary |
| O18 | PP4 PermissionRequest fallback confirmation(PPX-qna Q17) | `遵守` | PP4 §2.2 O4 / §6 Q17 明确 fail-closed |
| O19 | PP5 把 PP1/PP4 主线 leftover 塞回 PP5 | `遵守` | PP5 §2.2 O5 明确 "不重开 PP1/PP4 主线" |
| O20 | PP6 internal RPC / worker-to-worker seam 普查(PPX-qna Q5) | `遵守` | PP6 §2.2 O1 / §6 Q5 / §2.3 边界判定明确 |
| O21 | Debug routes(PPX-qna Q5 灰区) | `误报风险` | PP6 §2.3 line 152 写 `debug routes ... in-scope if frontend inspector uses`,与 design 07 §5.3 一致,但**未明确 worker-health.md / error-index.md 等 debug docs 是否属 frontend inspector 使用**。建议 PP6 §3 P1-01 对每个 debug route 单独标 inspector-uses(yes/no),避免最终对账时漂移。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**:`changes-requested`
- **是否允许关闭本轮 review**:`no`
- **关闭前必须完成的 blocker**:
  1. **R1 — PP4 §1.2 / §7.2 / §0 移除 PP3 dependency,改为 PP1 only**(charter §8.1 已明确 PP1 → {PP2,PP3,PP4} 并行)
  2. **R2 — PP3 §0 line 34 重写现状基线**(承认 `helper.checkpoint(helperStorage)` 已存在,但 in-checkpoint replayFragment + restore 端仍不对称),并在 §3 P2-01 增补"主 checkpoint object replayFragment 字段去留" decision question
  3. **R3 — PP4 §3 P1-01 + §5.1 修改文件列表 + §1.5 影响结构图,冻结具体 facade route owner file**(建议新建 `workers/orchestrator-core/src/facade/routes/session-hooks.ts`,理由见 R3 审查判断)
- **可以后续跟进的 non-blocking follow-up**:
  1. R4 — PP5 §2.1 S2 复用 5-label 集名
  2. R5 — PP4 §3 P3-02 澄清 hook.broadcast 复用还是新增 frame
  3. R6 — PP1 §4.3 P3-01 冻结 pending route 名
  4. R7 — PP2 §3 P1-01 注明 budget helper 归属
  5. R8 — PP5 §3 P2-02 + §7.3 列出 cross-package change list
  6. R9 — PP6 §3 P1-02 增补 hook docs placement decision trigger
  7. R10 — PP4 §3 P3-02 指定 redaction helper 落点
  8. R11 — PP0 §3 P1-01 同步定义 latency alert evidence shape(`exceeded_count / accepted_by_owner / repro_condition`)
  9. R12 — PP0 §3 P2-01 冻结 e2e skeleton owner test 文件名
- **建议的二次审查方式**:`same reviewer rereview`(R1 / R2 / R3 修复 + 至少 R5 / R8 / R12 中一项的承诺即可关闭本轮)
- **实现者回应入口**:`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应,不要改写 §0–§5。`

> **本轮 review 不收口,等待 GPT/owner 按 §6 修复 R1 / R2 / R3 后再次审查。**
>
> **判断本质**:7 份 action-plan 在结构、引用、owner answer 吸收上整体已成立 — 这是一个**进入实施前最后一公里**的状态,不是设计层面的 redesign。R1 是 charter dependency drift(单点 1 行修),R2 是现状描述时序漂移(单段重写),R3 是 PP4 owner file 选定(三选一)。其余 partial 项可与 R1-R3 一次性 PR 同步吸收,也可分批跟进。一旦修复,即可进入 PP0 实施。
