# Orchestration Facade — F0-F5 Action-Plan Review

> 审查对象: `docs/action-plan/orchestration-facade/F{0-5}-*.md`(6 份 action-plan)
> 审查时间: `2026-04-24`
> 审查人: `Claude Opus 4.7 (1M context)`
> 审查范围:
> - `docs/action-plan/orchestration-facade/F0-concrete-freeze-pack.md`(383 行)
> - `docs/action-plan/orchestration-facade/F1-bringup-and-first-roundtrip.md`(430 行)
> - `docs/action-plan/orchestration-facade/F2-session-seam-completion.md`(415 行)
> - `docs/action-plan/orchestration-facade/F3-canonical-cutover-and-legacy-retirement.md`(423 行)
> - `docs/action-plan/orchestration-facade/F4-authority-hardening.md`(378 行)
> - `docs/action-plan/orchestration-facade/F5-closure-and-handoff.md`(335 行)
> 文档状态: `reviewed`
> **独立性声明**:本审查未参考 DeepSeek / Kimi / 其它同事对同范围的评审报告;所有结论基于本人对 charter、design pack、`workers/` 源码、`context/smind-contexter/` 实现与 `test/` 真实结构的独立事实核查。

---

## 0. 总结结论

- **整体判断**:6 份 action-plan **模板一致、phase 切分合理、与 charter / design pack 大面上对齐**,F0/F5 纯收口 phase 可直接执行,F1-F4 作为实施周期**可作为起跑文档**,但存在 **2 条 high / 9 条 medium / 3 条 low** 共 14 条 finding,其中 high 级 2 条会直接伤及 F1 起跑与 F3 收尾,必须在 action-plan 执行期前修正或纳入首批实现 task。
- **结论等级**:`approve-with-followups`
- **本轮最关键的 3 个判断**:
  1. **F1 的 internal route 覆盖面不完整**(R1) —— design D2 §7.1 F1 列 **7 条** internal path(`start/input/cancel/status/timeline/verify/stream`),但 F1 action-plan P3-01 只承诺 **3 条**(`start/cancel/stream`)。F2 P2-01 会补 `input/cancel/status/timeline/verify`,但 input 在 F1 也会被公共 `start` 之后 follow-up 调用,**如果 F1 不提前给 `input` 的 internal endpoint**,F1 的 first roundtrip 可能需要人工 hack。这是一个真实的 scope 断层。
  2. **F3 legacy 410 rollout 漏掉 `end` action**(R2) —— `workers/agent-core/src/host/http-controller.ts:18-26` 的 `SUPPORTED_ACTIONS` 有 **7 个**(`start/input/cancel/end/status/timeline/verify`)。F3 action-plan P4-01 的 legacy HTTP `410` 翻转目标只枚举了 **6 个**,缺 `end`。`end` 虽是 server-emitted(当前返 405),但仍是 public route;F3 cutover 后若不处理,legacy 面就不是"honest retire"。
  3. **F1 进入条件没有显式检查 FX-qna Q1/Q2/Q5 是否已冻结**(R3) —— F1 P1-01/P3-02 的实现(shared secret header 命名、NDJSON framing、TEAM_UUID 配置)**直接依赖** 业主对 Q1/Q2/Q5 的回答。F1 "entry condition" 只写 `F0 closed`,没有强制检查 QNA 回答已回填。若 F0 closure 时 QNA 仍留空(我 design review R1 指出的风险),F1 可能以错误 baseline 启动。

---

## 1. 审查方法与已核实事实

### 1.1 对照文档

- `docs/plan-orchestration-facade.md`(r2 charter,1046 行)
- `docs/design/orchestration-facade/` 8 份 design + `FX-qna.md`(9 份,~2860 行)
- `docs/templates/action-plan.md`(action-plan 模板骨架)
- `docs/templates/code-review.md`(本文档结构模板)

### 1.2 核查代码

- `workers/agent-core/src/index.ts`(入口路由,67 行)
- `workers/agent-core/src/host/routes.ts`(路径 parse,75 行)
- `workers/agent-core/src/host/http-controller.ts`(SUPPORTED_ACTIONS 7 个)
- `workers/agent-core/src/host/ws-controller.ts`(UUID gate + WS outcome)
- `workers/agent-core/src/host/do/nano-session-do.ts:812-826`(`buildIngressContext` `_unknown` fallback)
- `workers/bash-core/src/executor.ts:126`(`policy.check(plan)` 落点,F4 hook 目标)
- `workers/agent-core/wrangler.jsonc`(`BASH_CORE` binding + preview env)
- `workers/{bash-core,context-core,filesystem-core}/wrangler.jsonc`
- `pnpm-workspace.yaml`(workspace 包含 `workers/*` glob)
- `.github/workflows/workers.yml`(CI matrix 硬编码 4 worker)
- `context/smind-contexter/src/chat.ts:119-126`(`getUserDOStub` + `idFromName(user_uuid)`)
- `context/smind-contexter/src/engine_do.ts:134-236`(WS upgrade + sessions map + accept 模式)
- `context/smind-contexter/core/jwt.ts`(`JwtPayload.{sub,realm,source_name,membership_level}`)
- `test/shared/live.mjs`(4-worker URL + `NANO_AGENT_LIVE_E2E` env gate)

### 1.3 执行过的验证

- `ls workers/` — 确认 `orchestrator-core/` **不存在**(F1 要新建)
- `grep -n "TEAM_UUID" workers/*/wrangler.jsonc` — 确认当前 5 个 wrangler **没有**任何 `TEAM_UUID` 显式配置(F4 要补)
- `grep -n "SUPPORTED_ACTIONS" http-controller.ts` — 确认 **7 个** action(F3 漏 1 个)
- `grep "workers.yml" matrix` — 确认 CI matrix 硬编码 4 worker,需要 F1 扩为 5
- `wc -l context/smind-contexter/{src,core,context,ai,rag}/*.ts` — 确认 contexter 总量 ~6k,其中 F1 计划吸收的 `jwt.ts` 161 行、`chat.ts:74-126` middleware 模式 ~90 行

### 1.4 已确认的正面事实

- **pnpm workspace 结构** — `pnpm-workspace.yaml` 包含 `workers/*` glob,新 `orchestrator-core` 会自动被纳入,不需要额外 workspace 声明。F1 P1-01 不需要单独更新 `pnpm-workspace.yaml` ✓
- **CI matrix 更新** — F1 P1-01 显式列 `.github/workflows/workers.yml` 为 Phase 1 修改文件,**正确**。现有 matrix 是硬编码的 4 名字 string 列表(非 glob),必须手动加 `orchestrator-core` ✓
- **agent-core 早退方案可行性** — `workers/agent-core/src/index.ts:39-63` 的 `worker.fetch` 结构允许在 line 44 后插入 `if (pathname.startsWith("/internal/")) return routeInternal(...)`,不污染 `routes.ts`。F1 P3-01 的方案与代码现实一致 ✓
- **F4 executor hook 落点正确** — `workers/bash-core/src/executor.ts:126` 存在 `policy.check(plan)`,F4 P3-02 的 hook 前置完全可落 ✓
- **contexter 吸收方向准确** — F1 提到 `getUserDOStub` / `withTrace`/`withAuth`、WS sessions map 模式、JWT verify 模式,每条都能在 contexter 代码中找到精确对应 ✓
- **F3 同 PR 纪律** — F3 §1.4 执行策略原则明确写"同一个 PR 完成 legacy session routes 的 hard deprecation,拒绝长 grace window",与 FX-qna Q7 frozen answer + 我 Opus 对 Q7 的进一步细化(立即 hard,不分 2 次 PR)一致 ✓
- **F4 scope 克制** — F4 §2.2 O1-O4 明确拒绝 credit/quota/billing/revocation/multi-tenant migration,符合 charter §1.9 F4.A / F4.B 拆分 ✓
- **F5 不越位代写** — F5 §2.2 O1-O4 明确拒绝"重做 F1-F4 实施项"、"直接起草下一阶段完整 charter",discipline 良好 ✓

### 1.5 已确认的负面事实

- **`TEAM_UUID` 当前完全不存在** — 5 个 wrangler.jsonc 都没有这个字段,只有 `ENVIRONMENT` 和 `OWNER_TAG`。F4 P2-01 的工作是从零新增,不是修改现有值。
- **`end` action 是 public 已有 route** — `http-controller.ts:17-26` 明确把 `end` 放进 `SUPPORTED_ACTIONS`,F3 P4-01 的 410 列表遗漏它。
- **F1 只明确 3 条 internal path** — P3-01 表述为"至少 `start + cancel + stream`",其它 4 条(input/status/timeline/verify)推到 F2,但 F1 的 first roundtrip(`start → first event`)在客户端发 follow-up `input` 时是否需要 internal `input` 路径,plan 没交代。
- **F1/F2 SessionEntry 边界模糊** — F1 P2-02 "最小 SessionEntry 写入" + P4-02 "relay_cursor = last_forwarded.seq" 已要求 entry 至少含 `user_uuid / session_uuid / created_at / relay_cursor`;F2 P1-01 "SessionEntry 完整化" 又说要补 `status/last_phase/ended_at/terminal reason`。两个 phase 之间的 schema 版本化不清楚。

---

## 2. 审查发现

### R1. F1 internal route 覆盖面与 first roundtrip 需求不匹配(**high**)

- **严重级别**:`high`
- **类型**:`scope-drift`
- **事实依据**:
  - `F1-bringup-and-first-roundtrip.md` P3-01:"在 `agent-core` 实现 `start/cancel/stream` 三条 internal path"
  - `F0-agent-core-internal-binding-contract.md` §7.1 F1 InternalRouteFamily 列 **7 条**:`start/input/cancel/status/timeline/verify/stream`
  - `F1` §2.1 S1 / S2 / S3 / S4 明确列 first roundtrip 是"public `start` → internal → first event → 回传"
  - F1 虽然没承诺 `input`,但 first roundtrip 真正跑时,客户端发 start → agent 开 turn → turn 中若需要 follow-up input 就会触发 internal `input`;**如果 internal `input` 在 F2 才落地**,F1 的 first roundtrip 是 **start-once-and-wait-for-completion**,不能测试 mid-turn input
- **为什么重要**:
  - 如果 F1 只实现 3 条 path,F1.Phase 5 的 preview proof 只能跑 "start → first event" 单向,无法证明 orchestrator 真的能驱动一个多 turn session。
  - F1 closure 的 "first roundtrip 成立" 会存在歧义:**哪种 roundtrip?** single-event?multi-step?
  - 设计 D2 的 7 条 path 是一组 contract,拆成 3+4 可能让 F2 实现时再发明一次 route pattern(例如不同 error shape)。
- **审查判断**:
  - F1 应至少增加 `input` 到 Phase 3 explicit 列表,变成 `start/input/cancel/stream` 4 条;其它 3 条(`status/timeline/verify`)确实 F2 level 合理(read-only / preview-only,不影响 roundtrip 证明)。
  - 或者 F1 P5-01 明确 minimal live 只验证 `start → first event → terminal`(单轮会话),由 F2 补 multi-turn live evidence。两者选一,不能混。
- **建议修法**:
  1. 修改 F1 P3-01 工作内容为:"实现 `start/input/cancel/stream` 4 条 internal path"。
  2. 修改 F1 §2.1 S3 包括 `input`。
  3. 或者在 F1 §2.3 边界判定表把 "`input` internal path" 从隐式推给 F2 改为显式 "F1 也实现,视为 start 的 follow-up base"。

### R2. F3 legacy HTTP `410` rollout 遗漏 `end` action(**high**)

- **严重级别**:`high`
- **类型**:`correctness`
- **事实依据**:
  - `workers/agent-core/src/host/http-controller.ts:17-26`:
    ```typescript
    const SUPPORTED_ACTIONS = new Set([
      "start", "input", "cancel", "end", "status", "timeline", "verify",
    ] as const);
    ```
    共 **7 个 action**
  - `F3-canonical-cutover-and-legacy-retirement.md` P4-01:"让 `agent-core /sessions/:id/{start,input,cancel,status,timeline,verify}` 返回 typed `410`"
  - 遗漏 `end`
  - `test/package-e2e/agent-core/04-session-lifecycle.test.mjs`(根据 INDEX.md v0.2 记录的子测试)含"`/end` → HTTP 405 + error `/server-emitted/`" 断言,说明 `end` 是 currently-handled public route
- **为什么重要**:
  - F3 要 honest retire legacy,缺一个 action 意味着 **legacy 入口没全关**,cutover 不彻底。
  - 若 `end` 继续返 405 而其它 6 个返 410,body shape 不一致(5xx vs 410 + canonical hint),观察者难以判断系统状态。
  - F3 closure §5.5 要求 "legacy negative tests 绿",但 negative test suite 若只测 6 个 action,`end` 会遗漏。
- **审查判断**:
  - 必须补 `end`。可以有两种处理方式:
    - (a) `end` 与其它 6 个统一改为 410(最 clean)
    - (b) `end` 因是 server-emitted 的特殊语义,保持 405 但加 `Deprecation: true` header + canonical hint body(explicit 化当前行为)
  - 我推荐 (a) 统一。现有 405 behavior 本就不是客户端正常使用路径,改为 410 对客户端行为无实质差别。
- **建议修法**:
  1. 修改 F3 P4-01 工作内容为:"让 `agent-core /sessions/:id/{start,input,cancel,end,status,timeline,verify}` 返回 typed `410`"(7 个,不遗漏)。
  2. F3 §1.5 目录树 + §5.4 具体测试安排应覆盖 7 个 action 的 negative assertion。
  3. `test/package-e2e/orchestrator-core/07-legacy-410-assertion.test.mjs` 应循环断言 7 个 action 全部 410。

### R3. F1 起跑条件未显式检查 FX-qna Q1/Q2/Q5 已 frozen(**high**)

- **严重级别**:`high`
- **类型**:`delivery-gap`
- **事实依据**:
  - F1 §7.2 "技术前提":"F0 已 closure,D1/D2/D3/D5/D6 与 FX-qna 为 F1 SSOT"
  - F0-concrete-freeze-pack.md §6.1 "当前结论":"本阶段无新增 owner-level blocker。F0 直接消费 `FX-qna.md` 中已冻结的 Q1-Q8 答案"
  - `docs/design/orchestration-facade/FX-qna.md` 8 题当前 `业主回答` 字段已有 Opus 推荐答案,owner 已对 Q1/Q2/Q3 回复 "同意,与 Opus 的建议相同"(见已验证的 2026-04-24 最新状态),**但 Q4-Q8 `业主回答` 字段仍需 owner 最终确认或留空**
  - F1 P3-02 (internal auth gate) 的 "shared secret header 命名 `x-nano-internal-binding-secret`" 直接来自 Q1 frozen answer
  - F1 P4-01 (NDJSON relay) 的 framing 直接来自 Q2 frozen answer
  - F4 P2-01 (TEAM_UUID bootstrap law) 直接来自 Q5 frozen answer
- **为什么重要**:
  - 如果 Q1 被最终调整为 "signed token" 而非 "shared secret",F1 P3-02 的实现需要返工。
  - F0 closure 本身没有硬要求"QNA 全部已签",仅说"消费已冻结答案"。若 F0 closure 在 Q1/Q2/Q5 未回填完成时就签发(F0 closure 是文档 review-only),F1 会以不完整 baseline 启动。
- **审查判断**:
  - F0 closure 必须显式要求 FX-qna Q1-Q8 的 `业主回答` 字段已全部回填(至少 F1 硬前置的 Q1/Q2/Q5)。
  - F1 §7.2 技术前提应明确加一条 "FX-qna Q1/Q2/Q5 `业主回答` 字段已由 owner 回填"。
- **建议修法**:
  1. F0 action-plan P4-01 closure memo 增加 explicit check: "FX-qna Q1-Q8 `业主回答` 字段全部非空"(或至少 Q1/Q2/Q5 三条硬前置)。
  2. F1 §7.2 技术前提增加一条 "FX-qna Q1/Q2/Q5 已由 owner frozen";若 Q3/Q4/Q6/Q7/Q8 尚未回填,F1 仍可启动,但 F2/F3 对应 phase 进入前必须补上。
  3. 这条 check 可通过 `grep -A1 "业主回答" FX-qna.md | grep -v "^$\|^---"` 自动化验证。

### R4. F1/F2 SessionEntry schema 版本化边界模糊(**medium**)

- **严重级别**:`medium`
- **类型**:`scope-drift`
- **事实依据**:
  - F1 P2-02:"user DO 写入最小 SessionEntry"
  - F1 P4-02:"cursor 写入 entry"
  - F2 P1-01:"SessionEntry 完整化,补 `status/last_phase/relay_cursor/ended_at/terminal reason`"
  - F0-user-do-schema.md §7.2 F2 定义的 SessionEntry 完整版含:`created_at / last_seen_at / status / last_phase? / relay_cursor? / ended_at?`(6 字段)
  - 但 F1 已必须写 `created_at + session_uuid(key) + relay_cursor` 至少 3 字段
- **为什么重要**:
  - F1 "最小" 到底 = 哪几个字段?plan 没说。
  - 若 F1 只写 3 字段,F2 P1-01 时扩到 6 字段,可能触发 storage migration:老 entry 缺字段,需要 default fill 或 re-mint。
  - 对于 `active_sessions: Map<session_uuid, SessionEntry>`,JSON 读取时 missing field 默认 `undefined`,TypeScript 可容忍但运行时逻辑可能把 `undefined` 当 "ended" 误判。
- **审查判断**:
  - F1 应直接写入**完整 6 字段** entry(非 F1 写不到的值用 placeholder,例如 `status: "minted"`、`ended_at: null`)。这样 F2 只是"扩大 status 集 + 写入 ended metadata",不是 schema 扩列。
  - 或者 F2 P1-01 明确写 migration 策略(无感默认填充)。
- **建议修法**:
  1. 修改 F1 P2-02 工作内容:"写入完整 SessionEntry 6 字段;F1 阶段 `status = 'minted' | 'starting' | 'active'`,`ended_at / last_phase` 保留字段但 `null`"。
  2. F2 P1-01 工作内容改为:"扩展 SessionEntry `status` 集合至 `detached / ended`,填充 `ended_at / terminal reason`;不新增字段"。

### R5. F2 WS phase 排序偏靠后,可能延后 WS live evidence(**medium**)

- **严重级别**:`medium`
- **类型**:`scope-drift`
- **事实依据**:
  - F2 Phase 总览:Phase 1 lifecycle → Phase 2 public HTTP routes → **Phase 3 WS attach** → Phase 4 terminal → Phase 5 tests
  - 根据 charter §1.5,compatibility façade 是 `GET /sessions/:id/ws`(WS) + 6 个 HTTP action,WS 是 day-1 的 canonical ingress
  - 当前 live harness `test/shared/live.mjs:62-63` 和 `ws-controller.ts:30-63` 都已是 WS-first 心智
  - F1 只做 HTTP start,不做 WS
- **为什么重要**:
  - 如果 F2 Phase 3 才接 WS,意味着 F1 交付后 2 个 phase 系统 WS surface 仍不可用(≈ 一周+级别延迟,视执行者节奏)。
  - "public WS upgrade" 是 charter §10.2 F1 DoD 中提到的硬条件之一(§1.5 route 列第 7 条),但 F1 plan P1-01 probe marker 以外没有 WS 相关任务。
- **审查判断**:
  - 并非错误,但 phase 排序让 "WS-first" 心智被 2 个 phase 后置。建议:
    - (a) 把 F2 Phase 3 和 Phase 2 对调 —— WS 接管先于 HTTP full family
    - (b) 或 F1 Phase 2 "public ingress + user DO 起步" 至少增加 WS upgrade stub(不实现 attach owner,先让 upgrade 不 404)
  - 我倾向 (b),理由:F2 的 WS 完整实现仍在 Phase 3 做,但 F1 先留一个 `/sessions/:id/ws` 的 WS upgrade 入口(早期 stub),避免 F1 结束时 WS 路径仍 404。
- **建议修法**:
  1. F1 P2-01 工作内容补一句:"同时为 WS upgrade 提供最小 stub(返回 400 + `wait-for-f2-attach` 或直接 101 不挂载 logic)"。
  2. 或 F2 把 WS phase 前置到 Phase 2(与 public route family 并行)。

### R6. F2 `verify` route 在 orchestrator 的语义未澄清(**medium**)

- **严重级别**:`medium`
- **类型**:`docs-gap`
- **事实依据**:
  - `workers/agent-core/src/host/http-controller.ts` 支持 `verify` action
  - `test/package-e2e/agent-core/06-verify-unknown-check.test.mjs` 验证 verify drift guard(5 个 canonical check names)
  - F2 P2-02 "façade status/timeline/verify" 只一行提及,没有说 orchestrator 怎么代理 verify
  - `F0-compatibility-facade-contract.md` §1.5 列 `verify` 但没定义语义
- **为什么重要**:
  - `verify` 是 preview-only 诊断 seam,它的行为是 **agent.core 侧运行 5 个 canonical check**。orchestrator 代理它时:
    - (a) 透传 request body 到 agent.core 内部,origin passthrough
    - (b) 在 orchestrator 做 JWT + authority translation 后,把结果 body 给 agent.core
    - (c) orchestrator 增加一层自己的 verify(例如 user DO registry 健康)
  - 三种行为对测试有不同影响。F2 plan 没选。
- **审查判断**:
  - 推荐 (b) —— orchestrator 不做自己的 verify logic,只 authority-translate 后 forward。这与其它 5 个 action 的行为模式一致,不引入 orchestrator 特殊 verify surface。
- **建议修法**:
  1. F2 P2-02 工作内容补一句:"`verify` 的 orchestrator 行为 = JWT ingress + authority translation 后 forward 到 agent-core `/internal/sessions/:id/verify`,不增加 orchestrator 独立 check 集合"。
  2. 或者新增 `F0-compatibility-facade-contract.md` 7.1 里对 verify 的一行定义。

### R7. F2 "missing" reconnect 结果与 ended retention purge 交互未定义(**medium**)

- **严重级别**:`medium`
- **类型**:`correctness`
- **事实依据**:
  - `F0-session-lifecycle-and-reconnect.md` §7.2 F3:reconnect result taxonomy = `success / terminal / missing`
  - `F0-user-do-schema.md` §7.2 F2 retention:24h + 100 双上限(我 QNA Q4 回答)
  - F2 P4-02 "terminal attach rejection":"ended session 不再 live attach"
  - 但 F2 plan 没说 reconnect 对一个 **已被 purge**(超过 retention 窗口)的 session_uuid 返回什么
- **为什么重要**:
  - 场景:client 断线 48 小时后试图 reconnect 一个 session_uuid,该 session 24h 前已 ended 且已被 purged。
  - orchestrator user DO registry 查询 → `active_sessions[session_uuid]` 为 `undefined`。
  - 按 D6 §7.2 F3 应返 `missing`,但 F2 plan P4-02 统一写 "ended session typed reject"。purged session 是 ended 还是 missing?
- **审查判断**:
  - 语义应为:
    - `terminal` = 仍在 retention 窗口内的 ended session(registry 还有 entry)
    - `missing` = registry 无 entry(从未 mint 或 已被 purge)
  - F2 P4-02 需要区分这两种。
- **建议修法**:
  1. F2 P4-02 工作内容改为:"terminal session(retention 窗口内)→ typed `session_terminal`;purged session(registry 无 entry)→ typed `session_missing`"。
  2. `05-verify-status-timeline.test.mjs` 或 `04-reconnect.test.mjs` 应覆盖 "reconnect purged session → missing" negative case。

### R8. F4 `TEAM_UUID` 是 wrangler `vars` 还是 `secret` 未定义(**medium**)

- **严重级别**:`medium`
- **类型**:`correctness`
- **事实依据**:
  - F4 P2-01:"在 preview/prod 配置中显式提供 `TEAM_UUID`"
  - `workers/agent-core/wrangler.jsonc` 的现有写法:`"vars": { "ENVIRONMENT": "preview", "OWNER_TAG": "nano-agent" }` —— 都是 public 非敏感值
  - `TEAM_UUID` 字段语义是 tenant 识别,**不是 secret**,但也不适合放 `OWNER_TAG` 那种 public marker
  - F4 §7.3 文档同步列表中未说明
- **为什么重要**:
  - 如果 `TEAM_UUID` 放在 `vars`,则进入代码仓库(wrangler.jsonc 会被 git tracked)
  - 如果放在 `secrets`(`wrangler secret put TEAM_UUID`),则 CI 需要 secret 注入
  - 两种实现方式差异大,F1/F4 的 bootstrap check(`if (!env.TEAM_UUID)`)行为一样,但配置 / CI 操作完全不同
- **审查判断**:
  - 推荐 `vars` —— 因为 `TEAM_UUID` 对同一个 tenant 的所有 worker 是同一个可预测值,不是机密(机密是 `NANO_INTERNAL_BINDING_SECRET`,那是 Q1 规定的)。
  - 这不影响 fail-fast bootstrap check,但影响 preview deploy 的 setup 步骤。
- **建议修法**:
  1. F4 P2-01 工作内容补一句:"`TEAM_UUID` 作为 `vars`(非 secret),需要在 5 个 wrangler.jsonc 的 `vars` 与 `env.preview.vars` / `env.prod.vars` 中显式配置"。
  2. 文档同步列表加一行 wrangler config change。

### R9. F4 对 `packages/capability-runtime/src/executor.ts` 的处理策略缺失(**medium**)

- **严重级别**:`medium`
- **类型**:`correctness` / `scope-drift`
- **事实依据**:
  - F4 P3-02 明确写 "`workers/bash-core/src/executor.ts`" 作为 recheck hook 落点 —— 正确 canonical path
  - 但 `packages/capability-runtime/src/executor.ts` **也仍然存在**(worker-matrix P5 closure 打了 DEPRECATED banner 但保留物理文件)
  - 如果任何消费者仍 `import { CapabilityExecutor } from "@nano-agent/capability-runtime"`,hook 不会生效
- **为什么重要**:
  - `packages/capability-runtime` 是 DEPRECATED 但未删除 —— 这是 worker-matrix Q6c 的 honest design(逐 worker 稳定后删)
  - F4 只改 worker-side,deprecated package 的 executor 如果还被任何路径引用,authority law 有盲区
- **审查判断**:
  - F4 应确认 `packages/capability-runtime` 当前是否有任何外部消费者:
    - 查询 `grep -rn "@nano-agent/capability-runtime" workers/ packages/` 的结果
    - 若结果只有 `packages/capability-runtime` 自身,则 F4 只改 `workers/bash-core` 即足够
    - 若仍有引用,F4 要么在 deprecated package 也同步加 hook,要么 F4 把移除消费者路径作为前置
- **建议修法**:
  1. F4 §7.2 约束与前提增加一条:"F4 启动前 grep 确认 `packages/capability-runtime` 无 runtime import;若有,先消除消费者"。
  2. 或 F4 P3-02 工作内容补一句:"同步检查 `packages/capability-runtime/src/executor.ts`,若仍有消费者,hook 需要在两处都加"。

### R10. 所有 phase 都缺 probe marker rollover 纪律(**medium**)

- **严重级别**:`medium`
- **类型**:`docs-gap`
- **事实依据**:
  - F1 P1-02 probe marker:`phase:"orchestration-facade-F1"`
  - F2 / F3 / F4 plan 中没有提到更新 orchestrator-core probe marker
  - F5 plan 也没有提到 final probe marker(例如 `phase: "orchestration-facade-closed"`)
  - 参照 worker-matrix 做法:agent-core 当前 probe 返 `phase:"worker-matrix-P2-live-loop"`、bash-core 返 `phase:"worker-matrix-P1.B-absorbed"`
- **为什么重要**:
  - Probe marker 是 deploy verification 的核心 signal。没有 rollover 纪律,probe 会一直卡在 `orchestration-facade-F1`,即使系统已到 F5 closure。
  - 外部监控 / live harness 若依赖 probe.phase 判断系统状态,会得到误导信息。
- **审查判断**:
  - 每个 phase 应在 closure 时 bump probe marker:`F1 → F2 → F3 → F4 → final`。
- **建议修法**:
  1. F2/F3/F4 的 Phase 5(或最后一个 closure phase)增加一个 task:"bump orchestrator-core probe marker 到 `orchestration-facade-F{N}`"。
  2. F5 plan Phase 2 增加 task:"orchestrator-core + agent-core + 其它 3 个 worker 的 probe marker 统一切到 `orchestration-facade-closed`(或类似 terminal marker)"。

### R11. Internal binding secret 的 rotation / lifecycle 纪律缺失(**medium**)

- **严重级别**:`medium`
- **类型**:`security` / `docs-gap`
- **事实依据**:
  - FX-qna Q1 frozen:"shared secret header + `wrangler secret put` 来源"
  - F1 P3-02 实现 gate
  - F4 / F5 均未提到 secret rotation
- **为什么重要**:
  - Shared secret 的安全性强依赖于它不泄漏。工程上常见做法是定期 rotate(例如每季度一次)。
  - 没有 rotation checklist,secret 永远不会 rotate,一旦泄漏(例如历史 log / error trace)即成为 permanent hole。
- **审查判断**:
  - 不是 F1 blocker,但 F5 handoff 应把 secret rotation 纳入 ongoing operation checklist。
- **建议修法**:
  1. F5 P2-02 handoff memo 应含一节 "ongoing operational disciplines",列出:`NANO_INTERNAL_BINDING_SECRET` rotation(建议 quarterly)+ `TEAM_UUID` single-tenant re-validation 等。

### R12. F2 `initial_context seed` 生产逻辑太简略(**medium**)

- **严重级别**:`medium`
- **类型**:`delivery-gap`
- **事实依据**:
  - F2 P2-02 只说 "initial_context/seed 贯穿 façade owner"
  - `F0-user-do-schema.md` §4.2 定义 `initial_context_seed: { realm_hints?, source_name?, default_layers?, user_memory_ref? }`
  - charter §4.1 列 orchestrator first-wave 6 项职责,#5 是 "`initial_context` seed 生产" —— 这不是 nice-to-have
  - contexter 有 `director.ts / producer.ts / writer.ts` 做完整 RAG 上下文 —— r2 charter 明确 discard 这些 ——  所以 orchestrator 的 seed 是 **从零写**
- **为什么重要**:
  - F2 只给一行,实现者会面临:seed 从哪里来?是 JWT claims 直接映射,还是 user DO 存的配置,还是都是空?
  - 若只做 JWT claim → seed 直接映射(最简单),这是"first-wave user-memory domain 的替代品",需要设计文档明确。
  - 若留空,orchestrator 发给 agent-core 的 `initial_context` 是空 object,agent-core `appendInitialContextLayer` 调用的行为也需要确认(见 `workers/agent-core/src/host/do/nano-session-do.ts:676-705`)。
- **审查判断**:
  - first-wave 最保守方案:seed 直接 = JWT claims 映射(`realm/source_name/membership_level`),不引入任何外部查询
  - F2 需要把这条写清。
- **建议修法**:
  1. F2 P2-02 工作内容补一小节:"`initial_context` seed builder = JWT claim 直接映射(`realm_hints ← claim.realm`;`source_name ← claim.source_name`;`default_layers ← []`;`user_memory_ref ← null`),不引入额外存储查询"。
  2. 或在 `F0-user-do-schema.md` §4.2 加一行 "first-wave seed source = JWT claim snapshot"。

### R13. F5 preview topology final verification 缺具体验证资产(**low**)

- **严重级别**:`low`
- **类型**:`test-gap`
- **事实依据**:
  - F5 Phase 1 "F0-F4 evidence review" 是文档层
  - F5 Phase 2/3 全是文档写作
  - charter §10.6 F5 DoD 含 "preview topology final verification" —— plan 未落地
- **为什么重要**:
  - 5-worker 的完整 topology(orchestrator / agent / bash / context / filesystem)在 F3 结束后理论上已 live,但没有一个 end-to-end smoke 证明整条链同时 green
  - F5 closure 仅靠文档评审会漏 "preview deploy 实际状态" 的真实 signal
- **审查判断**:
  - F5 应增加一个 cross-e2e 新测试:例如 `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs`,覆盖 `JWT → orchestrator → agent → bash → stream back` 全路径(包括 `tool.call.*` 一次)
- **建议修法**:
  1. F5 Phase 1 增加 task P1-03:"新增 `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs`,作为 final live evidence"。
  2. F5 §8.2 收口标准增加一条:"新 final roundtrip cross-e2e 为绿"。

### R14. F3 legacy-410 test 位置归属(**low**)

- **严重级别**:`low`
- **类型**:`docs-gap`
- **事实依据**:
  - F3 P1-01 / P5-01 把 `07-legacy-410-assertion.test.mjs` 放在 `test/package-e2e/orchestrator-core/`
  - 但该测试的 target worker 是 `agent-core`(验证 agent-core 旧入口已 410)
- **为什么重要**:
  - 纯分类学问题 —— 测试命中 agent-core 但放在 orchestrator-core 目录,逻辑上不一致
  - 也可以理解为 "canonical public suite assert the OLD canonical has been retired",此时放 orchestrator-core 合理
- **审查判断**:
  - 两种选择都 OK,F3 plan 已选一种,只需在 `test/INDEX.md` v0.3 里注释一行 "此测试实际目标是 agent-core,因 canonical suite 声明 legacy 已退役而放 orchestrator-core" 即可。
- **建议修法**:
  1. F3 P3-02 (INDEX 更新) 增加一行 "legacy-410 test 位置说明"。

---

## 3. In-Scope 逐项对齐审核

### 3.1 6 份 action-plan 与 charter Phase 对齐

| charter phase | 对应 action-plan | 预估 size | 行数 | 对齐 |
|---|---|---|---|---|
| F0 Concrete Freeze Pack | F0-concrete-freeze-pack.md | `S` | 383 | ✅ (纯文档, scope 合理) |
| F1 Orchestrator Scaffold + First Roundtrip | F1-bringup-and-first-roundtrip.md | `M` | 430 | ⚠️ (R1 internal route 覆盖不全) |
| F2 Session Seam Completion | F2-session-seam-completion.md | `M` | 415 | ⚠️ (R4 schema 边界 / R5 WS 排序 / R6 verify / R7 missing 语义 / R12 seed) |
| F3 agent.core Public Surface Cutover | F3-canonical-cutover-and-legacy-retirement.md | `L` | 423 | ⚠️ (R2 missing `end` action) |
| F4 Authority Policy Hardening | F4-authority-hardening.md | `S` | 378 | ⚠️ (R8 TEAM_UUID vars/secret / R9 deprecated package hook) |
| F5 Closure & Handoff | F5-closure-and-handoff.md | `M` | 335 | ⚠️ (R13 缺 final verification asset) |

### 3.2 charter §6.1 I1-I12 In-Scope 对齐

| 编号 | In-Scope 项 | 对应 action-plan task | 审查结论 |
|---|---|---|---|
| I1 | 冻结 first-wave façade strategy | F0 全阶段 | `done` |
| I2 | 冻结 contexter absorption inventory | F0 通过消费 D4 | `done` |
| I3 | 冻结 first-wave user DO schema | F0 通过消费 D5 | `done` |
| I4 | 冻结 `session_uuid` lifecycle / reconnect / stream relay | F0 通过消费 D3/D6 | `partial`(见 R10/R7) |
| I5 | 建立 `workers/orchestrator-core/` | F1 Phase 1 | `done`(subject to R1) |
| I6 | 打通最小 roundtrip | F1 Phase 2-5 | `partial`(R1 route 覆盖 / R3 QNA 前置) |
| I7 | 完成 `initial_context` seed + 注入 | F2 P2-02 | `partial`(R12) |
| I8 | 完成 attach / reconnect / cancel / status / timeline / verify | F2 Phase 2-4 | `partial`(R5/R6/R7) |
| I9 | agent.core public surface cutover + migration | F3 全阶段 | `partial`(R2 missing `end`) |
| I10 | legacy deprecation discipline | F3 Phase 4 | `partial`(R2 only) |
| I11 | F4.A authority hardening | F4 全阶段 | `partial`(R8/R9) |
| I12 | 5-worker closure + handoff | F5 全阶段 | `partial`(R13) |

### 3.3 对齐结论

- **done**: 4(I1/I2/I3/I5)
- **partial**: 8(I4/I6/I7/I8/I9/I10/I11/I12)
- **missing**: 0

> 8 条 I 层面条目 partial 并不意味着 action-plan 有系统性设计错误 —— partial 大多是 sub-task 粒度的 follow-up(R1-R14 共 14 条),其中 **R1/R2/R3 3 条是 high,必须在 F1/F3 动工前修正;R4-R12 共 9 条是 medium,建议作为各自 phase 的首批实现 task 或 checklist 列入。R13/R14 为 low,可在 F5 执行期处理**。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项(charter §6.2)| 审查结论 | 说明 |
|---|---|---|---|
| O1 | 重造全新 public product API | `遵守` | F1 P2-01 明确 compatibility-first |
| O2 | full user-memory / conversation / RAG engine | `遵守` | F2 P2-02 `initial_context seed` thin(虽 R12 建议 concrete 化,仍不扩 memory domain)|
| O3 | concrete credit ledger / quota / billing domain | `遵守` | F4 §2.2 O1/O2 explicitly rejected |
| O4 | transport 升级到 WorkerEntrypoint / custom RPC | `遵守` | F1 sticks to fetch-backed service binding |
| O5 | orchestrator direct binding context/filesystem | `遵守` | F1/F2/F3/F4 全无 context/filesystem direct binding |
| O6 | 第 6+ worker | `遵守` | 5-worker topology 稳定 |
| O7 | 删除 probe surfaces | `遵守` | F3 P4-02 明确保留 `GET /` / `GET /health` |

> 7 条 Out-of-Scope 全部遵守。6 份 action-plan 在 scope discipline 上表现良好,未出现偷渡 credit domain / RAG domain / multi-tenant 的尝试。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**:6 份 action-plan **结构扎实、模板一致、与 charter/design pack 大面对齐,Scope discipline 良好**,**可作为 orchestration-facade 阶段执行起跑文档**。但存在 14 条 findings(2 high / 9 medium / 3 low),其中 R1/R2/R3 是 high-priority 的 actionable gap,必须在对应 phase 动工前修正。
- **是否允许关闭本轮 review**:`conditional yes` — 条件为 R1/R2/R3 3 条 high 级 finding 纳入 action-plan 修订。
- **关闭前必须完成的 blocker**:
  1. **R1** — F1 P3-01 internal route 列表扩展为 `start/input/cancel/stream` 4 条(`input` 是关键 follow-up path)
  2. **R2** — F3 P4-01 legacy 410 rollout 覆盖 7 个 action(补 `end`)
  3. **R3** — F0 closure 显式检查 FX-qna 全部 `业主回答` 已回填(至少 Q1/Q2/Q5)
- **可以后续跟进的 non-blocking follow-up**:
  1. R4 — F1/F2 SessionEntry schema 版本化收口
  2. R5 — F2 WS phase 排序或 F1 WS stub(改善 WS-first 心智)
  3. R6 — F2 `verify` 的 orchestrator 语义澄清
  4. R7 — F2 "missing" reconnect 与 purged session 语义
  5. R8 — F4 `TEAM_UUID` vars/secret 选择
  6. R9 — F4 `packages/capability-runtime` 对应 hook 策略
  7. R10 — F2/F3/F4/F5 probe marker rollover 纪律
  8. R11 — F5 handoff 加 secret rotation checklist
  9. R12 — F2 seed builder concrete(JWT claim 映射建议)
  10. R13 — F5 新增 final roundtrip cross-e2e test
  11. R14 — F3 legacy-410 test 位置注释

> **本轮 review 不立即收口**。要求 action-plan 作者按 §5 blocker 清单修订 R1-R3,并把 R4-R14 视情况纳入各 phase 首批 task 或 checklist。

---

## 6. 与 design doc review 的交叉引用

本轮 action-plan review 与 `docs/eval/orchestration-facade/F0-FX-design-docs-reviewed-by-opus.md` (design 层评审)的关系:

| design review finding | action-plan 是否消费 | 说明 |
|---|---|---|
| Design R2(NDJSON TS schema 未冻结)| 未消费,但 F1 plan 不受阻 | F1 实现者可在 P4-01 时补 schema;若 design 层不更新,F1 会"自己选"类型 |
| Design R3(agent-core `/internal/*` routing order)| **已消费** —— F1 P3-01 明确 `index.ts` 早退 + `routeInternal()` | ✅ |
| Design R4(relay cursor off-by-one)| 部分消费 —— F1 P4-02 说 "cursor = last_forwarded.seq" 与 design 对齐 | ✅(design 仍需更新,但 plan 已前瞻性写对) |
| Design R5(stream `ended` / lifecycle `ended` 词汇重叠)| 未消费 | F2 P4-01 "terminal mapping" 会撞上这个问题 |
| Design R6(orchestrator probe marker)| F1 P1-02 消费 | ⚠️ 但 F2/F3/F4/F5 未 rollover(Opus R10) |
| Design R7(legacy 410 body shape)| F3 P4-01 一句提及 "typed 410 + canonical hint",未 concrete 化 | 留给 F3 实现期 |

> design review 的 7 条 findings 大部分已被 action-plan 消费,唯一实质 gap 是 **Design R5 stream/lifecycle `ended` 词汇重叠** 未在 F2 plan 中显式处理 —— 建议 F2 P4-01 工作内容补一句 "消除 stream `terminal: ended` 与 lifecycle `status: ended` 的词汇重叠,terminal 改 `completed/cancelled/error` 三选"。

---

## 7. 文档质量评估

| 评估维度 | Opus 评级(1-5)| 说明 |
|----------|:--:|------|
| 模板一致性 | 5 | 6 份 plan 都遵循 action-plan.md 模板(§0-§10)|
| Charter / Design 对齐度 | 4 | 大面对齐,14 条 finding 大多是 sub-task 粒度细节 |
| Scope discipline | 5 | 7 条 out-of-scope 全部遵守,无 scope creep |
| Phase 切分合理性 | 4 | F2 Phase 3 WS 偏后(R5);其它 phase 划分合理 |
| 代码锚点准确性 | 5 | F1 `index.ts` 早退 / F4 `workers/bash-core/src/executor.ts` 等锚点与实际代码位置一致 |
| 可执行性 | 3 | R1/R2/R3 需要修订后才能 fully actionable,R4-R12 需要实现者做判断 |
| 风险识别 | 4 | 每份 plan 的 §7.1 风险表质量良好,但跨 plan 的系统性风险(R10 probe / R11 secret rotation)未被识别 |
| 收口标准 | 4 | §8.2 收口标准清晰,但 F5 缺 live verification asset(R13)|

---

## 8. 推荐下一步执行顺序

1. **立即修订 R1/R2/R3 三条 high 级 finding**:
   - F1 P3-01 internal route 列表 `+input`
   - F3 P4-01 legacy 410 列表 `+end`
   - F0 closure memo 加 FX-qna frozen check
2. **R4-R12 medium finding 作为各自 phase action-plan 的首批 checklist,或明确 defer 到实现期**
3. **R13/R14 low finding 在 F5 执行期处理**
4. **基于修订后的 F0 plan,owner 先回填 FX-qna Q4/Q6/Q7/Q8 剩余答案(Q1/Q2/Q3 已 signed)**
5. **F0 closure(文档 sign-off)— 解锁 F1 启动**
6. **F1 启动,按 `先 scaffold → CI matrix 更新 → WS stub(R5 建议)→ public start ingress → internal routes(4 条,R1)→ first event relay → preview proof`**

---

## 9. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-24 | Claude Opus 4.7 (1M context) | 独立 action-plan 评审(F0-F5 共 6 份);基于 charter + design pack + `workers/` 源码 + `context/smind-contexter/` 代码事实。识别 14 条 findings(2 high / 9 medium / 3 low);判决 `approve-with-followups`;blockers = R1/R2/R3 三条。独立完成,未参考其它 reviewer(DeepSeek/Kimi/GPT)对同范围的评审报告。
