# Orchestration Facade — F0-FX Design Docs Review

> 审查对象: `docs/design/orchestration-facade/` (8 份 design + 1 份 QNA)
> 审查时间: `2026-04-24`
> 审查人: `Claude Opus 4.7 (1M context)`
> 审查范围:
> - `docs/design/orchestration-facade/F0-compatibility-facade-contract.md`
> - `docs/design/orchestration-facade/F0-agent-core-internal-binding-contract.md`
> - `docs/design/orchestration-facade/F0-stream-relay-mechanism.md`
> - `docs/design/orchestration-facade/F0-contexter-absorption-inventory.md`
> - `docs/design/orchestration-facade/F0-user-do-schema.md`
> - `docs/design/orchestration-facade/F0-session-lifecycle-and-reconnect.md`
> - `docs/design/orchestration-facade/F0-live-e2e-migration-inventory.md`
> - `docs/design/orchestration-facade/F4-authority-policy-layer.md`
> - `docs/design/orchestration-facade/FX-qna.md`
> 文档状态: `reviewed`
> 前置参考: `docs/eval/orchestration-facade/F0-FX-design-docs-reviewed-by-deepseek.md`(已有 DeepSeek 初审);本审查不重复已收口 finding,而是在 DeepSeek R1-R4 之外从不同角度补充检查。

---

## 0. 总结结论

- **整体判断**:8 份 design + 1 份 QNA **主体成立,整体结构对标 charter §17.1 精确,2nd-pass 5 个 gap(G1-G5)100% 被设计文档覆盖**,可以作为 F0 freeze 的基础输入进入 F0 action-plan。但仍有 **7 条技术级 gap**(R1-R7)需要在 F0 收口前或 F1 动工前补齐,其中 2 条为 blocker,5 条为 non-blocking follow-up。
- **结论等级**:`approve-with-followups`
- **本轮最关键的 3 个判断**:
  1. 2nd-pass 的 5 个 gap(G1-G5)全部有设计文档落点,**结构性覆盖完整**(详见 §3.3)。这是本轮设计工作最值得肯定的地方。
  2. QNA 8 题中的 **Q1 / Q2 / Q5 是 F1 启动的硬前置**(分别决定 internal auth、stream framing、tenant truth);Q3 / Q7 / Q8 是 F2/F3 的软前置。**Owner 回答 Q1+Q2+Q5 是本轮唯一 blocker**。
  3. Design docs 在**契约细节层**留了若干可预期的 **F1 实现歧义**:internal 路由前缀优先级、relay cursor 的 off-by-one 语义、agent.core `/internal/*` 与现有 `/sessions/*` 路由 parse 顺序、orchestrator probe marker 约定 —— 这些是 `medium` 级 follow-up,不必阻塞收口,但应在 F1 action-plan 里明确处理。

---

## 1. 审查方法与已核实事实

- **对照文档**:
  - `docs/plan-orchestration-facade.md`(r2 charter)
  - `docs/plan-orchestration-facade-reviewed-by-opus.md`(我的 1st-pass)
  - `docs/plan-orchestration-facade-reviewed-by-opus-2nd-pass.md`(我的 2nd-pass §13)
  - `docs/eval/orchestration-facade/F0-FX-design-docs-reviewed-by-deepseek.md`(DeepSeek 初审 R1-R4)
  - `docs/templates/code-review.md`(本文档结构模板)
  - `docs/templates/design.md`(设计文档模板)
- **核查代码**:
  - `workers/agent-core/src/index.ts`(入口 + 路由分发)
  - `workers/agent-core/src/host/routes.ts`(路径 parse 逻辑)
  - `workers/agent-core/src/host/http-controller.ts`(7-action SUPPORTED_ACTIONS)
  - `workers/agent-core/src/host/ws-controller.ts`(UUID gate + WS upgrade)
  - `workers/agent-core/src/host/do/nano-session-do.ts:812-826`(`buildIngressContext` `_unknown` fallback 实锤)
  - `workers/bash-core/src/executor.ts:126` + `packages/capability-runtime/src/executor.ts`(确认 F4.A recheck hook 正确路径)
  - `workers/bash-core/src/index.ts`(internal-only posture 已 true)
  - `test/INDEX.md` + `test/shared/live.mjs`(确认 35 subtests 分布和 live harness)
  - `context/smind-contexter/src/{chat.ts,engine_do.ts}` + `context/smind-contexter/core/jwt.ts`(确认吸收面真相)
- **执行过的验证**:
  - `ls workers/` — 确认 `orchestrator-core/` 不存在
  - `grep -n "SUPPORTED_ACTIONS" http-controller.ts` — 确认 7 action
  - `grep -c "session.start\|acceptClientFrame" do/nano-session-do.ts` — 确认 ingress pipeline 未变
  - `sed -n '810,830p' nano-session-do.ts` — 确认 `buildIngressContext` 实际范围是 **lines 812-826**(F4 文档 §8.4 写 `812-825`,差 1 行)

### 1.1 已确认的正面事实

- 9 份文件全部交付,与 charter §17.1 列表 1-to-1 对应,数量无遗漏。
- 8 份 design 遵循 `docs/templates/design.md` 的 9 节结构;FX-qna 使用独立模板,也结构稳定。
- 我 2nd-pass 的 5 个 gap(G1-G5)在设计文档层全部有落点:
  - **G1**(internal transport)→ `F0-agent-core-internal-binding-contract.md` 全文
  - **G2**(tenant identity)→ `F4-authority-policy-layer.md` §6.1 取舍 2 + Q5 + Q6
  - **G3**(WS fate)→ `F0-stream-relay-mechanism.md` §5.3 + §7.1 F5 + Q2
  - **G4**(Deprecation)→ `F0-compatibility-facade-contract.md` §7.1 F3/F4 + Q7
  - **G5**(F1 size)→ 通过 design 硬前置到 F0,F1 scope 压回 M,结构性解决
- `F0-agent-core-internal-binding-contract.md` §7.1 F1 列 internal route 7 条(`start/input/cancel/status/timeline/verify/stream`),与 `F0-compatibility-facade-contract.md` §1.5 的 public 7-action 精准对应,**双向冻结**。
- `F0-user-do-schema.md` §7.2 F1 / F2 给出 4 字段逻辑 schema + physical layout + retention policy,完全采纳我 1st-pass §3.2(B) 的建议。
- `F0-live-e2e-migration-inventory.md` §7.2 F1 给出**文件名级**迁移分类表,和 `test/INDEX.md` + 实际 test tree(26 个文件,35 subtests)对应准确。
- FX-qna 8 题全部有 `影响范围` / `为什么必须确认` / `当前建议` / `Reasoning` / `问题` 5 个填充字段,结构完整,owner 可直接在 `业主回答` 字段回复。
- QNA 通过「业主只在本文件填写回答」+「其他文档不重复填」的规则,避免了 8 份 design 中重复 8 条 QNA 的漂移风险 —— 这是**优于 worker-matrix charter Q1-Q7 散落模式**的改进。
- 代码锚点大量被验证:`ws-controller.ts:47-63` UUID gate 存在;`http-controller.ts:18-26` SUPPORTED_ACTIONS 存在;`nano-session-do.ts:812-826` `_unknown` fallback 存在且与 F4 §8.4 反例表一致。
- `F0-contexter-absorption-inventory.md` §7.1 F1-F4 的 adopt/adapt/defer/discard 四分法对 14 个 contexter 文件做了精细判断,且**明确区分了 `wrapInCicp` 思路可借但代码不可复用**的关键口径。

### 1.2 已确认的负面事实

- FX-qna 8 题的 `Opus的对问题的分解` / `Opus的对GPT推荐线路的分析` / `Opus的最终回答` / `业主回答` **全部空白**(合计 32 个空字段)。这是 F0 freeze 最终收口的必要步骤,DeepSeek R1 已明确此点,此处只登记不重复。
- `F4-authority-policy-layer.md` §8.4 引用 `nano-session-do.ts:812-825`,实际 `buildIngressContext()` 方法范围是 **812-826**(方法体含结束 `}`)。DeepSeek R2 也 catch 了这点,**此处仅在 §1.2 登记,不重复开新 finding**。
- `F0-stream-relay-mechanism.md` §7.2 F1 的 frame shape 仅以示例 JSON 形式给出,没有 TypeScript discriminated union 或 Zod schema(DeepSeek R3)。此处**扩展为 R2**(见下文),要求更具体。
- `F0-agent-core-internal-binding-contract.md` §7.1 F1 声明了 `/internal/sessions/:session_uuid/{start,input,cancel,status,timeline,verify,stream}` 7 条路径,但**没有定义 routing order** — `/internal/*` 前缀是否要在 `workers/agent-core/src/host/routes.ts:51-72` 现有 `/sessions/:id/:action` 之前 match?若未说明,实现者可能漏 match 或顺序颠倒。
- `F0-stream-relay-mechanism.md` §7.2 F2 的 "relay cursor" 未定义 **cursor 值的精确含义**:是"已 forward 的 last_seq",还是"下次期待接收的 next_seq"? F1 实现者会 guess,可能产生 off-by-one。
- `F0-live-e2e-migration-inventory.md` §7.2 F2 推荐新建 5 个 `orchestrator-core` package-e2e 文件(`01-preview-probe` / `02-session-start` / `03-ws-attach` / `04-reconnect` / `05-verify-status-timeline`),但**没有说明** orchestrator probe 应返回什么 marker 证明 façade 已激活(对标 `agent.core` 当前 probe 的 `phase: "worker-matrix-P2-live-loop"`)。

---

## 2. 审查发现

### R1. QNA 业主回答全部空白 — F0 收口唯一 blocker(继承自 DeepSeek R1,不重复举证)

- **严重级别**:`high`
- **类型**:`delivery-gap`
- **事实依据**:
  - `FX-qna.md` Q1-Q8 的 `业主回答` 字段全部空白
  - Q1-Q8 的 `Opus的...` 三个字段也全部空白(见 §1.2)
- **为什么重要**:
  - DeepSeek R1 已详述。本条仅登记,以保持本 review 的完整逐项对齐。
  - **本 Opus review 新增要点**:8 题不是同等权重,从 F1 启动的硬前置视角看,**Q1 / Q2 / Q5 是必须先答**,Q3 / Q4 / Q6 / Q7 / Q8 属 F2+ 前置。详见 §5。
- **审查判断**:
  - 非设计缺陷,属 F0 freeze 流程的正常收口步骤。保持 DeepSeek 判断。
- **建议修法**:
  - Owner 在 FX-qna 回填 8 条答案,**Q1/Q2/Q5 优先**。
  - 回填后可在本 review 底部追加 §6 实现者回应,或在 FX-qna 自身做 `appendix` 签署。

### R2. NDJSON frame 缺少形式化 TypeScript/Zod schema(扩展 DeepSeek R3)

- **严重级别**:`medium`
- **类型**:`delivery-gap`
- **事实依据**:
  - `F0-stream-relay-mechanism.md` §7.2 F1 给出的 frame 只是注释形式的 JSON literal:
    - `{"kind":"meta","seq":0,"event":"opened","session_uuid":"..."}`
    - `{"kind":"event","seq":1,"name":"session.stream.event","payload":{...}}`
    - `{"kind":"terminal","seq":99,"terminal":"completed|cancelled|error|ended","payload":{...}}`
  - 没有对应 `type StreamFrame = MetaFrame | EventFrame | TerminalFrame` 的 TypeScript discriminant
- **为什么重要**:
  - DeepSeek R3 已说明基本层面。**Opus review 的新增点**:
    - `seq` 是 `number` 还是 `string`? NDJSON 的 `seq` 如果跨 reconnect 传,且 user DO 侧 `relay_cursor` 也存它,two-side 类型不一致会导致 `cursor === frame.seq` 比较失败。设计文档未说明。
    - `terminal` 字段的 4 个值(`completed|cancelled|error|ended`)与 `F0-session-lifecycle-and-reconnect.md` §7.2 F1 的 5 个 lifecycle states(`minted/starting/active/detached/ended`)**不是同一组**词汇。前者是 "stream 结束原因",后者是 "session 状态"。两份 design 对 `ended` 的语义是否相同,未交叉说明。
    - `payload` 类型为 `any`?还是 `session.stream.event` 的 NACP body?若为后者,应 import `@haimang/nacp-session` 相应 schema。
- **为什么重要续**:
  - F1 实现时这三个歧义会同时出现;若在 F0 不冻结,F1 要么 invent、要么回头改 design。
- **审查判断**:
  - 建议 `medium` 优先级补齐。不阻塞 F0 closure,但应在 F1 action-plan 明确列入首批任务。
- **建议修法**:
  1. 在 `F0-stream-relay-mechanism.md` §7.2 追加小节 `7.3 Frame type shape`,给出 TypeScript discriminated union(`kind: "meta" | "event" | "terminal"` 作 discriminator):
     ```typescript
     type StreamFrame =
       | { kind: "meta"; seq: number; event: "opened"; session_uuid: string }
       | { kind: "event"; seq: number; name: string; payload: unknown }
       | { kind: "terminal"; seq: number; terminal: "completed" | "cancelled" | "error" | "ended"; payload?: unknown };
     ```
  2. 同时明确 `seq` 是 `number`(非负整数,单调递增);`ended` 在 stream 语义下 ≠ lifecycle `ended` 状态(后者由 terminal frame 的 lifecycle 映射产生,不是一个 event);`payload` 推荐使用 `@haimang/nacp-session::SessionStreamEventBody` 类型。

### R3. agent-core `/internal/*` 路由顺序 / 优先级未冻结

- **严重级别**:`medium`
- **类型**:`correctness`(潜在实现错误源)
- **事实依据**:
  - `F0-agent-core-internal-binding-contract.md` §7.1 F1 声明 `/internal/sessions/:session_uuid/{start,input,cancel,status,timeline,verify,stream}`
  - `workers/agent-core/src/host/routes.ts:52-72` 当前 parse `/sessions/:sessionId/:action`,使用 `segments[0] !== "sessions"` 作为 not-found 判据
  - 若新增 `/internal/sessions/...`,`segments = ["internal","sessions",...]` → `segments[0] = "internal"`,会落入 not-found 分支
  - **设计文档未说明** `routes.ts` 改造方案(是在 `routes.ts` 头部新增 `/internal/*` 分支,还是在 `workers/agent-core/src/index.ts` `worker.fetch()` 第 44 行前插入 `if (pathname.startsWith("/internal"))` 早退?)
- **为什么重要**:
  - 若实现者在 `routes.ts` 里改 `segments[0]` 判据,会波及现有 public routes;若在 `index.ts` 里早退,`routes.ts` 的 `RouteResult` 类型需要新增第 4 种值(例如 `{ type: "internal-session"; sessionId: string; action: string }`),这也会波及 caller 模式匹配。
  - 两种方案都可,但**没有指定** = F1 实现可能出现 PR 级来回。
- **审查判断**:
  - 建议 `medium` 优先级在 F1.B(JWT middleware + user DO routing)的 companion design note 中明确。
- **建议修法**:
  1. 在 `F0-agent-core-internal-binding-contract.md` §7.2 追加小节 `Routing integration with existing public surface`:
     - **推荐方案**:`agent-core/src/index.ts` `worker.fetch()` 第 44 行后新增 `if (pathname.startsWith("/internal/")) return routeInternal(request, env);` 早退,**不改** `routes.ts`
     - `routeInternal()` 独立 parse `/internal/sessions/:id/:action`,与 `routeRequest()` 共享 `SESSION_DO.idFromName(sessionId)` 但独立 auth gate
  2. 在 F4.A 的 `validateInternalAuthority()` helper 要求 internal path 必须在 parse 成功后、DO stub fetch 之前调用 — 确保 `/internal/*` 与 `/sessions/*` 走不同 gate。

### R4. Relay cursor 语义 off-by-one 未定义

- **严重级别**:`medium`
- **类型**:`correctness`
- **事实依据**:
  - `F0-stream-relay-mechanism.md` §7.2 F2:「orchestrator 在 relay 每个 event frame 后更新 cursor;terminal frame 到达后标记 session terminal」
  - `F0-user-do-schema.md` §7.2 F2 的 SessionEntry 含 `relay_cursor?` 字段,无类型 / 语义定义
  - `F0-session-lifecycle-and-reconnect.md` §7.2 F3 的 reconnect result taxonomy(`success / terminal / missing`)未说明 reconnect 开始时 cursor 的使用方式(是 `stream_offset > relay_cursor` 还是 `>=`?)
- **为什么重要**:
  - 实现者 A:`cursor = last_forwarded.seq` + reconnect 从 `cursor + 1` 恢复 → 跳过 cursor 本身(假设它已送达 client)
  - 实现者 B:`cursor = next_expected.seq` + reconnect 从 `cursor` 恢复 → 期望下一个
  - A 与 B 都合理,但**两个实现者在同一 codebase 里会冲突**。
  - 若 reconnect 偶然丢掉一条 event,off-by-one bug 极难 debug(low-flake,look fine 99% of time)。
- **审查判断**:
  - 建议 `medium` 优先级在 F2.C stream relay stabilization 实现前冻结。但考虑到 F1.C 的 first-event roundtrip 也会创建该字段,**最好在 F0 冻结**。
- **建议修法**:
  1. 在 `F0-stream-relay-mechanism.md` §7.2 F2 明确定义:`relay_cursor = last_forwarded.seq`(即"**已 forward 的最大 seq**");reconnect 时从 `cursor + 1` 恢复;cursor 未设置 = `-1`,此时从 `seq 0` 开始。
  2. 同时在 `F0-user-do-schema.md` §7.2 F2 的 SessionEntry 补充 `relay_cursor?: number /** last_forwarded seq, -1 if none */`。

### R5. Stream `terminal` 语义与 lifecycle `ended` 状态的 mapping 未定义

- **严重级别**:`medium`
- **类型**:`correctness`
- **事实依据**:
  - `F0-stream-relay-mechanism.md` §7.2 F1 terminal frame 的 4 个值:`completed / cancelled / error / ended`
  - `F0-session-lifecycle-and-reconnect.md` §7.2 F1 lifecycle 5 states:`minted / starting / active / detached / ended`
  - 两份文档都用 `ended` 词汇,**语义可能不同**:
    - stream `ended` = client 主动发 `session.end`?还是 server 自然结束?
    - lifecycle `ended` = session 的整个生命周期已关闭
  - 没有显式 mapping 表
- **为什么重要**:
  - user DO 接到 `kind: "terminal", terminal: "cancelled"` 时,应把 SessionEntry.status 改为什么?`ended`?`cancelled`(但 lifecycle 没这个状态)?
  - 对外 client 通过 public WS 收到 terminal 时,是否看到原始 `terminal: "cancelled"` 字符串,还是封装为 lifecycle phase?
- **审查判断**:
  - `medium`,在 F0 闭环前最好有 mapping。不补,F1 + F2 实现会出现"`registry.status` 和 `stream.terminal` 到底以哪个为准"的拉扯。
- **建议修法**:
  - 在 `F0-session-lifecycle-and-reconnect.md` §7.2 追加 mapping 表:
    ```
    stream.terminal  → lifecycle.status  → client-visible event.kind
    "completed"      → "ended"            → "session.ended"
    "cancelled"      → "ended"            → "session.cancelled"
    "error"          → "ended"            → "session.error"
    "ended"          → "ended"            → "session.ended"
    ```
  - 或者在 F0-stream-relay 中去掉 `ended`(只保留 completed/cancelled/error)以消除 overload。推荐后者,更干净。

### R6. Orchestrator-core probe marker 未指定

- **严重级别**:`low`
- **类型**:`docs-gap`
- **事实依据**:
  - 现有 `workers/agent-core/src/index.ts:29-35` probe 返回 `phase: "worker-matrix-P2-live-loop"`(作为 phase identifier)
  - 现有 `workers/bash-core/src/index.ts:205-216` probe 返回 `phase: "worker-matrix-P1.B-absorbed"`
  - `F0-compatibility-facade-contract.md` §1.5 / `F0-live-e2e-migration-inventory.md` §7.2 F2 都要求新 `orchestrator-core/01-preview-probe`,但**没有指定** probe marker
  - `docs/plan-orchestration-facade.md` §14.1 Primary Exit #1「orchestrator-core 已真实存在并 preview deploy 成功」要求有 "真实" 证据,但没说什么叫 "真实"
- **为什么重要**:
  - F1/F5 的 preview verification 应检查 probe 返回的 phase 字段;没有约定则实现者任选。
  - 2nd-pass §3.6 我建议过 "probe 要求返回 `phase: "orchestration-facade-cutover"` 或类似 identifier",GPT §12.2.6 已接受,但 design 文档未落地。
- **审查判断**:
  - `low`,可在 F1 action-plan / F0-compatibility-facade-contract 中补。
- **建议修法**:
  - 在 `F0-compatibility-facade-contract.md` §7.1 追加 F5:`probe marker` 字段,要求 orchestrator-core `GET /` / `GET /health` 返回至少:
    ```
    { worker: "orchestrator-core", phase: "orchestration-facade-F1" | "orchestration-facade-F3-cutover", ... }
    ```
  - 或 F0-live-e2e-migration-inventory §7.2 F4 显式写 probe marker 要求。

### R7. `agent-core` 在 F3 exit 后对 legacy `/sessions/*` 的 typed 410 body shape 未定义

- **严重级别**:`low`
- **类型**:`correctness`
- **事实依据**:
  - `F0-compatibility-facade-contract.md` §1.3 术语定义 `hard deprecation`:「HTTP 返回 typed 410;WS 不再升级」
  - §7.2 F2 要求 "F3 exit 后 legacy HTTP/WS session routes 退役"
  - 没有定义 typed 410 body 的 shape — 是 `{ error: "gone", ... }`?还是 `{ type: "deprecation", canonical: "https://orchestrator.../sessions/..." }`?
- **为什么重要**:
  - F3.B 迁移测试会 assert 410 响应;shape 不明则 test 会 assert `response.status === 410` 但不 assert body,给 future drift 留机会。
  - QNA Q7 确认 hard deprecate,但没明确 body shape。
- **审查判断**:
  - `low`,可在 F3.C action-plan 里冻结。
- **建议修法**:
  - 在 `F0-compatibility-facade-contract.md` §7.2 F2 的 "核心逻辑" 补:
    - 推荐 body shape:`{ error: "gone", canonical_public: "https://<orchestrator>/sessions/:id", message: "agent-core session surface retired, please use orchestrator-core canonical public ingress" }`
    - Content-Type: `application/json`
    - HTTP status: `410 Gone`
    - WS upgrade 请求直接 `400` + `invalid-session-id` (沿用 `ws-controller.ts:40-42` 现有 shape)或新增 `426 Upgrade Required` 指引到 orchestrator
  - 或者推到 F3.C action-plan 承接。

---

## 3. In-Scope 逐项对齐审核

### 3.1 Design document 覆盖度(对标 charter §17.1)

| 编号 | Charter 要求的设计文档 | 对应文件 | 行数 | 结论 |
|------|------------------------|----------|------|------|
| D1 | `F0-compatibility-facade-contract.md` | 已交付 | 352 | `done` |
| D2 | `F0-agent-core-internal-binding-contract.md` | 已交付 | 331 | `done` |
| D3 | `F0-stream-relay-mechanism.md` | 已交付 | 336 | `done` |
| D4 | `F0-contexter-absorption-inventory.md` | 已交付 | 322 | `done` |
| D5 | `F0-user-do-schema.md` | 已交付 | 341 | `done` |
| D6 | `F0-session-lifecycle-and-reconnect.md` | 已交付 | 332 | `done` |
| D7 | `F0-live-e2e-migration-inventory.md` | 已交付 | 343 | `done` |
| D8 | `F4-authority-policy-layer.md` | 已交付 | 329 | `done` |
| QNA | `FX-qna.md` | 已交付 | 174 | `done`(结构),`partial`(owner 回答空白) |

### 3.2 Charter §7.1 In-Scope 工作项对齐(14 项)

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| I1 | 冻结 compatibility-first façade strategy | `done` | D1 完整覆盖 |
| I2 | 冻结 first-wave tenant-source truth | `done` | D8 §6.1 取舍 2 + QNA Q5 |
| I3 | 冻结 orchestrator → agent internal binding contract | `done` | D2 完整覆盖 |
| I4 | 冻结 agent → orchestrator stream relay contract | `partial` | D3 已有 frame shape,但 R2/R4/R5 三处细节未冻 |
| I5 | 冻结 contexter absorption inventory | `done` | D4 逐文件 adopt/adapt/defer/discard |
| I6 | 冻结 first-wave user DO schema | `done` | D5 完整 + physical layout + retention |
| I7 | 冻结 session_uuid lifecycle / reconnect | `partial` | D6 covers,但 stream.terminal → lifecycle.status mapping(R5)缺 |
| I8 | 建立 workers/orchestrator-core/ | `pending` | F1 工作,不在 F0 scope |
| I9 | 打通最小 roundtrip | `pending` | F1 工作 |
| I10 | 完成 session seam | `pending` | F2 工作 |
| I11 | 完成 affected live E2E / docs / harness migration | `partial` | D7 file-level inventory done;实际迁移 F3 |
| I12 | agent.core legacy session routes hard deprecate | `partial` | D1 semantic 已定,typed 410 body shape(R7)缺 |
| I13 | F4.A authority hardening | `partial` | D8 已冻结 scope;实现 F4 |
| I14 | 产出 closure / handoff | `pending` | F5 工作 |

### 3.3 2nd-pass gap 覆盖对齐(5 项)

| gap | 建议补丁 | r2 设计文档落点 | 结论 |
|-----|---------|----------------|------|
| G1 internal transport contract | M1 新增 `F0-agent-core-internal-binding-contract.md` | D2 全文 | ✅ `done` |
| G2 tenant identity 源迁移 | M4 写明 single-tenant-per-deploy first-wave | D8 §6.1 取舍 2 + QNA Q5/Q6 | ✅ `done` |
| G3 agent.core WS 归属 | M3 在 stream-relay doc 回答 legacy WS fate | D3 §5.3 + §7.1 F5 + QNA Q2(间接) | ✅ `done`(legacy WS 明确"not internal seam",F3 退役) |
| G4 Deprecation window 语义 | M2 明确 hard deprecation | D1 §7.2 F2 + §1.3 术语 + QNA Q7 | ✅ `done`(语义冻结),细节(R7 body shape)需 F3 补 |
| G5 F1 size | M5 通过 design 硬前置到 F0 | r2 §18 Tier A 设计,现已全部交付 | ✅ `done`(结构性解决) |

### 3.4 对齐结论

- **done**: 11(I1/I2/I3/I5/I6/D1-D8 全 + G1/G2/G3/G4/G5 5 个 2nd-pass gap)
- **partial**: 5(I4/I7/I11/I12/I13,大多是 "设计冻结完成,实现待后续 phase")
- **pending**: 4(I8/I9/I10/I14 属 F1-F5 阶段)

> **F0 design freeze 层面的 I1-I7 已经交付 7/7,只剩 I4 / I7 各有一两处细节(R2/R4/R5)需补**。整体状态更像「已到达 frozen edge,只差 2-3 处技术细节 + 8 条业主回答」,而不是 "done"。符合 DeepSeek 的 `approve-with-followups` 判断,Opus 补齐后更精准。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 重造全新 public product API | `遵守` | D1/D2 反复强调 compatibility-first |
| O2 | multi-tenant-per-deploy | `遵守` | D8 §6.1 取舍 2 明确延后;QNA Q5 锁定 single-tenant |
| O3 | full user-memory / history / retrieval domain | `遵守` | D5 §5.2 O1/O2 禁止;D4 明确 defer `db_do.ts`;D4 §5.2 O2/O3 禁止 SQLite |
| O4 | concrete credit ledger / quota / billing | `遵守` | D8 §5.2 O1/O2 明确禁止 |
| O5 | WorkerEntrypoint RPC / custom transport rewrite | `遵守` | D2 §3.1 砍点 + D3 §3.1 砍点 |
| O6 | orchestrator direct binding context/filesystem | `遵守` | D1 §5.2 O3 + D5 §3.3 解耦声明 |
| O7 | 第 6+ worker | `遵守` | 无任何文档涉及新 worker |
| O8 | 删除 probe surfaces | `遵守` | D1 §5.3 + D7 §5.3 保留 probe 作为 internal verification |

> **8 条 Out-of-Scope 全部遵守。无偷渡风险。**

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**:9 份文档结构完整、与 charter 对齐、2nd-pass 5 个 gap 全部被设计文档覆盖;可进入 F0 action-plan 阶段,并在 F0 freeze 最终收口前回填 QNA + 补齐 R2/R3/R4 三个 medium 级技术细节。
- **是否允许关闭本轮 review**:**conditional yes** — 条件为 R1(QNA 回填)+ R2/R3/R4 三项 medium 补丁。
- **关闭前必须完成的 blocker**:
  1. **R1 QNA 业主回答回填** — 至少 Q1 / Q2 / Q5 为 F1 硬前置,必须先答。Q3 / Q7 / Q8 为 F2/F3 软前置,可稍晚回答但不应拖到 F3 启动后。
  2. **R2 NDJSON frame 加 TS discriminated union + `seq` 类型 + `payload` 类型** — 这会在 F1.C first-event roundtrip 实现时暴露,应 F0 补齐。
  3. **R3 agent-core `/internal/*` 路由整合方案** — 推荐用 `index.ts` 早退,不改 `routes.ts`;在 D2 §7.2 补一小节即可。
  4. **R4 relay cursor 精确语义** — 明确 `cursor = last_forwarded.seq`,reconnect 从 `cursor + 1` 开始;在 D3 §7.2 + D5 §7.2 各加一行。
- **可以后续跟进的 non-blocking follow-up**:
  1. **R5 stream.terminal ↔ lifecycle.status mapping** — 在 D6 加 mapping 表,或 D3 去掉 `ended` terminal(推荐后者,更干净)。
  2. **R6 orchestrator-core probe marker** — 可以在 F1 action-plan 里定;D1 补 `phase` 字段约定也可。
  3. **R7 legacy 410 body shape** — 可以推到 F3.C action-plan 细化。
  4. DeepSeek R2(`nano-session-do.ts:812-825` → `812-826`)— 行号偏移 1 行,顺手修即可。
  5. DeepSeek R4(cross-e2e 分类补一行注释)— 纯文档可读性优化。

> **本轮 review 不立即收口,但可进入 F0 action-plan 阶段的并行启动**。
> **F0 action-plan 应吸收 R2/R3/R4 三项作为首批 task,QNA 回填作为 freeze signoff 的前置。**

---

## 6. 本审查与 DeepSeek 初审的关系

本 review 与 `docs/eval/orchestration-facade/F0-FX-design-docs-reviewed-by-deepseek.md` 的关系:

| DeepSeek 的 finding | Opus 的处理 |
|---|---|
| R1 QNA 全部空白 | Opus 继承为 R1,**但把 Q1/Q2/Q5 与 Q3/Q4/Q6/Q7/Q8 分层**(F1 硬前置 vs F2/F3 软前置) |
| R2 行号偏移 812-825 vs 812-826 | Opus 不重复立 finding,在 §1.2 登记,在 §5 follow-up 清单收录 |
| R3 NDJSON 缺 TS/Zod | Opus 扩展为 R2,**额外发现 `seq` 类型、`payload` 类型、`ended` 词汇重叠**三个子 gap |
| R4 cross-e2e 分类补注释 | Opus 不重复立 finding,§5 follow-up 收录 |
| — | Opus 新发现 **R3 routing order**、**R4 cursor off-by-one**、**R5 terminal↔status mapping**、**R6 orchestrator probe marker**、**R7 410 body shape** 5 条 |

DeepSeek 偏**整体结构性 + 对齐度**判断,Opus 偏**技术细节 + F1 实现歧义**判断。两份 review 组合起来覆盖了 design freeze 从宏观到 F1 实现边界的两个层面。

---

## 7. 文档质量评估(与 DeepSeek 一致维度对照)

| 评估维度 | Opus 评级(1-5) | DeepSeek 评级 | 说明 |
|----------|:--:|:--:|------|
| Charter 对齐度 | 5 | 5 | 一致 |
| 内部一致性 | 4 | 5 | Opus 发现 stream `ended` 与 lifecycle `ended` 词汇重叠(R5) |
| 代码锚点准确性 | 4 | 5 | Opus 额外发现 F4.A recheck hook 的 canonical path 应是 `workers/bash-core/src/executor.ts:126`(DeepSeek 提到 `packages/capability-runtime`,但 `workers/bash-core` 已是 canonical copy) |
| 可执行性(能直接指导 F1-F4) | 3 | 4 | Opus 发现 R3 routing order、R4 cursor、R5 terminal mapping、R6 probe marker 共 4 条 F1 歧义,扣 1 分 |
| Scope discipline | 5 | 5 | 一致 |
| 结构规范性 | 5 | 5 | 一致 |
| QNA 完整性(结构) | 5 | — | QNA 结构(Reasoning + 影响范围 + 问题)优于 worker-matrix charter Q1-Q7 |
| QNA 完整性(owner 回答) | 0 | 2 | 全空白 → 0 分;DeepSeek 给 2 分是因考虑到 "结构已完整" |

---

## 8. 推荐下一步执行顺序

1. **先回填 FX-qna Q1/Q2/Q5** — F1 硬前置
2. **补 D3(stream-relay) R2 + R4 的 schema / cursor 细节** — F0-closure 前
3. **补 D2(internal-binding) R3 的 routing 方案** — F0-closure 前
4. **F0 action-plan 起草并吸收 R2/R3/R4 作为首批 task**
5. **回填 FX-qna Q3/Q4/Q6/Q7/Q8** — 与 F0 action-plan 平行(不阻塞 F1 kickoff,但 F2/F3 启动前必须完成)
6. **F1 kickoff**,实现 `workers/orchestrator-core/` scaffold + first roundtrip
7. 处理 non-blocking follow-up(R5/R6/R7 + DeepSeek 的两个 low 级)在 F1/F2/F3 对应 phase 的 action-plan 内顺手完成

---

## 9. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-24 | Claude Opus 4.7 (1M context) | 独立 2nd-opinion 审查,与 DeepSeek 初审互补。新增 R2-R7 6 条技术级 finding;确认 2nd-pass 5 gap 全部被设计文档覆盖;把 QNA 8 题分层为 F1 / F2-F3 两档前置;给出 8 条 Out-of-Scope 全部遵守结论。判决 `approve-with-followups`。


---

## Appendix — F0 close-out status（2026-04-24，GPT-5.4）

### 当前结论

- **R1 blocker 已解决**：`docs/design/orchestration-facade/FX-qna.md` 的 Q1-Q8 `业主回答` 现已全部回填，F0 freeze 不再受 owner-answer 缺失阻塞。
- 原文对“审查当时仍有 blocker / 仍需 close 前收口”的判断在当时成立；F0 执行后的当前真相，应以 `docs/issue/orchestration-facade/F0-closure.md` 为准。

### finding disposition

1. **R1**：`resolved` — 由 QNA 回填 + F0 closure 消解。
2. **R2**：`downgraded-to-F1-follow-up` — NDJSON frame 的 TS/Zod 形式化保留为实现期细化，不再作为 F0 gate。
3. **R3 / R4 / R6 / R7**：`absorbed-into-action-plan-pack` — internal route integration、cursor semantics、probe marker、legacy retirement body shape 已在修订后的 F1-F5 action-plan 中明确承接。
4. **R5**：`implementation-facing follow-up` — stream terminal 与 lifecycle mapping 继续归 F1/F2 流式实现细化，不再冒充 F0 blocker。

### close-out verdict

Opus 这轮 review 的“主体成立、approve-with-followups”判断已经被事实兑现：F0 现在可以正式关闭，并直接解锁 F1。
