# Nano-Agent 代码审查 — Orchestration Facade F3-F5 + 阶段级交叉回顾

> 审查对象：`orchestration-facade / F3-F5`（canonical cutover + legacy retirement + authority hardening + final closure + handoff）+ 阶段级 cross-phase 回顾
> 审查时间：`2026-04-24`
> 审查人：`Claude Opus 4.7 (1M context)`
> 审查范围：
> - `docs/action-plan/orchestration-facade/F{3,4,5}-*.md`（含 §11 执行日志）
> - `docs/issue/orchestration-facade/F{3,4,5}-closure.md` + `orchestration-facade-final-closure.md`
> - `docs/handoff/orchestration-facade-to-next-phase.md`
> - `workers/agent-core/src/{index.ts,host/internal.ts,host/internal-policy.ts}`
> - `workers/orchestrator-core/src/{index.ts,auth.ts,user-do.ts,policy/authority.ts}`
> - `workers/bash-core/src/executor.ts` + `test/executor.test.ts`
> - 5 个 worker 的 `wrangler.jsonc`（`TEAM_UUID` 配置核查）
> - `test/package-e2e/orchestrator-core/{01..07}.test.mjs`
> - `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs`
> - `test/shared/{live.mjs,orchestrator-jwt.mjs,orchestrator-auth.mjs}`
> - `context/smind-contexter/` 真实参考代码（F4/F5 吸收面回望）
> - `docs/plan-orchestration-facade.md`（charter 已翻 closed）
> - F0-F2 阶段的已 closed 文档与代码作为 cross-phase 基线
> 文档状态：`reviewed`
> **独立性声明**：本轮评审**未参考** Kimi / DeepSeek / GPT / 以往 Opus 对同范围或同对象的分析。所有 finding 基于独立对代码、执行日志、closure、handoff 与 contexter 参考代码的 first-principles 事实核查。

---

## 0. 总结结论

- **整体判断**：**F3-F5 三个周期主体交付扎实，阶段整体可以视为 orchestration-facade 的合法 closure**。canonical public cutover 已同 PR 完成（legacy HTTP 7-action → 410、WS → 426）；F4 的 authority / tenant / no-escalation / executor recheck seam 四件套已真实落地到 `orchestrator-core` + `agent-core` + `bash-core` 三个 worker；5-worker 全部显式 `TEAM_UUID`；final roundtrip `11-orchestrator-public-facade-roundtrip.test.mjs` 覆盖 `JWT → orchestrator → agent → bash → ws event → legacy 410` 整条链路。但**在 cross-phase 粘合的边缘处仍有 6 条技术级 gap**（3 medium / 3 low），其中**没有一条是 F3-F5 内部 blocker**，其中 M1 / M2 应在下一阶段 charter 启动前被显式吸收。
- **结论等级**：`approve-with-followups`
- **本轮最关键的 3 个判断**：
  1. **authority hardening 的实现深度超出了原 F4.A action-plan 的最低要求**。`validateInternalAuthority` 真的做了 "secret + TEAM_UUID misconfig check + trace UUID gate + header-authority JSON parse + body-vs-header escalation 对比 + tenant claim 与 TEAM_UUID 一致性验证" 6 重校验，不是 charter §1.7 F4.A 最初谨慎地承诺的 "最小 policy layer"。这是一次**正向超交付**，且 fail-closed 默认的选择是正确的。我 approve 这个超交付。
  2. **`beforeCapabilityExecute` hook 已存在并 fail-closed，但在 production bash-core 路径上 "尚未被构造器 wire"**。这不是 bug，而是 F4.A scope 的故意克制（"建 seam,不建 domain"），closure §5 已明说。下一阶段如果启动 credit/quota charter,应**直接** wire 此 hook,不需要重建 executor 主路径。这个 seam 的定位准确。
  3. **legacy retirement 的 `canonical_url` 依赖 hostname 包含 "agent-core" 字面匹配**（`workers/agent-core/src/index.ts:53-57`）。这在当前 preview 命名下 work，但对 custom domain / localhost dev 是脆弱的。不是 blocker，是**今后长期的 docs-gap**（`R3` low）。

---

## 1. 审查方法与已核实事实

### 1.1 对照文档

- charter：`docs/plan-orchestration-facade.md`（顶层状态已翻 `closed charter (r2 executed)`）
- action-plans：F3 / F4 / F5 三份（每份含 §11 执行日志）
- closures：`F3-closure.md` / `F4-closure.md` / `F5-closure.md` / `orchestration-facade-final-closure.md`
- handoff：`docs/handoff/orchestration-facade-to-next-phase.md`
- F0-F2 closure + 前两轮 Opus code review（`F0-F2-reviewed-by-opus.md`）作为 cross-phase 基线

### 1.2 核查代码

- `workers/agent-core/src/index.ts`（130 行 — 新增 `LEGACY_SESSION_ACTIONS` + `deriveCanonicalUrl` + `legacyRetirementResponse` + 7-action 全 410 / WS 426）
- `workers/agent-core/src/host/internal.ts`（180 行 — 改用 `validateInternalAuthority` 替代原 single secret gate）
- `workers/agent-core/src/host/internal-policy.ts`（**新增文件** — 245 行 — 6 重校验)
- `workers/orchestrator-core/src/index.ts`（119 行 — probe marker → `orchestration-facade-closed`，引入 `ensureConfiguredTeam` + `jsonPolicyError`）
- `workers/orchestrator-core/src/auth.ts`（~190 行 — `trace_uuid` 强制 UUID + tenant mismatch 在 claim 与 deploy tenant 不一致时 403）
- `workers/orchestrator-core/src/user-do.ts`（~760 行 — `forwardInternalRaw` 现在发 `x-trace-uuid` + `x-nano-internal-authority` 双 header；persisted snapshot fail-closed）
- `workers/orchestrator-core/src/policy/authority.ts`（**新增文件** — 32 行 — 中央 helper：UUID 检查 + trace 读取 + `ensureConfiguredTeam` + `jsonPolicyError`)
- `workers/bash-core/src/executor.ts`（实测 line 73 `ExecutorOptions.beforeCapabilityExecute` 定义 + line 197-211 hook 调用 + catch 返 `policy-denied`，line 366-379 streaming 路径上同样的 fail-closed）
- 5 个 worker 的 `wrangler.jsonc` — 5/5 均有 `"TEAM_UUID": "nano-agent"` 在 root vars 和 `env.preview.vars` 双重配置
- `test/package-e2e/orchestrator-core/` 共 7 个 live test（01-preview-probe / 02-session-start(含 initial-context subtest) / 03-ws-attach / 04-reconnect / 05-verify-status-timeline / 06-auth-negative / 07-legacy-agent-retirement）
- `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs`（105 行 — 阶段级 final roundtrip）
- `test/shared/orchestrator-auth.mjs`（25 行 — F4 新增 `createOrchestratorAuth(realm)` helper，统一 JWT token + trace_uuid + jsonHeaders 构造）

### 1.3 执行过的验证

- `pnpm --filter @haimang/orchestrator-core-worker test` → **14/14 passed**（test/user-do 6 + test/smoke 8;smoke 从 F0-F2 的 5 增加到 8,新增 3 条：trace UUID enforcement / tenant mismatch / internal 转发 header shape）
- `pnpm --filter @haimang/agent-core-worker test` → **1035/1035 passed**（96 test files）
- `pnpm --filter @haimang/bash-core-worker test` → **359/359 passed**（29 test files，含 `executor.test.ts::beforeCapabilityExecute` happy + fail-closed 两条）
- `grep "TEAM_UUID" workers/*/wrangler.jsonc` → 5 worker 全部配置，每份 root vars + env.preview.vars 双配
- `grep "validateInternalAuthority" workers/agent-core/src/host/internal.ts` → line 1 import + line 156 调用，F4 hook 已实 wire
- `grep "x-nano-internal-authority" workers/orchestrator-core/src/user-do.ts` → line 686 header set，header 已在 forwardInternalRaw 注入
- F3 closure 自报：`pnpm test:package-e2e` 33/33 + `pnpm test:cross` 44/44
- F4 closure 自报：35/35 + 46/46
- F5 closure 自报：35/35 + 47/47（+1 = 新 `cross-e2e/11`）

### 1.4 已确认的正面事实

- **F3 legacy 7-action 退役完整**：`workers/agent-core/src/index.ts:42-50 LEGACY_SESSION_ACTIONS` 含完整 `start/input/cancel/end/status/timeline/verify` 7 条（修正了 Opus F0-F2 review 提出的 "end 遗漏" 风险）。`test/package-e2e/orchestrator-core/07-legacy-agent-retirement.test.mjs` 用 `HTTP_CASES` 数组循环断言 7 个 action 全部 410，且断言 `canonical_worker="orchestrator-core"` + `canonical_url` 包含 `orchestrator-core`。
- **F3 WS retirement 同 PR 落地**：`legacyRetirementResponse` 对 `route.type === "websocket"` 返回 `426` + typed `legacy-websocket-route-retired` body；`07-legacy-agent-retirement.test.mjs:36-47` 专门断言。**不留 grace window** 按 Q7 frozen answer 执行。
- **F3 package-e2e 迁移 honest**：GPT 工作日志声明 `test/package-e2e/agent-core/02-06` 全部删除并吸收到 orchestrator suite。我实测 `test/package-e2e/agent-core/` 目录（只剩 `01-preview-probe.test.mjs`），迁移是 DELETE + REPLACE，不是 additive — 没有 ghost tests。
- **F3 cross-e2e 入口迁移**：GPT 声明 02/03/04/05/06/08/09 已切到 orchestrator，01 + 10 升级为 5-worker inventory / concurrency probe。cross 总数 40 → 44（F3）→ 46（F4）→ 47（F5 + `cross-e2e/11`),数字链单调增长与新增 live negative 保持一致。
- **F4 centralized legality helper 真落地**：
  - `orchestrator-core/src/policy/authority.ts` 32 行小而专一
  - `orchestrator-core/src/index.ts:40-42 ensureTenantConfigured` 调用 `ensureConfiguredTeam(env)`，`env.TEAM_UUID` 缺失在非 test env 下 → 503 `worker-misconfigured`
  - `agent-core/src/host/internal-policy.ts` 独立 helper，**不与 orchestrator 的 helper 互相 import**（合理分离：orchestrator 的 helper 服务 public path，agent-core 的 helper 服务 internal path，避免 worker-to-worker 类型耦合）
- **F4 no-escalation enforcement 真落地**：
  - `internal-policy.ts:normalizeAuthority` 返回 null 若 `tenant_uuid` 存在但 ≠ teamUuid
  - `internal-policy.ts:authorityEquals` 逐字段比较 header-authority 与 body-authority;任一不一致 → 403 `authority-escalation`
  - `internal-policy.ts` 同时拦截 body.trace_uuid 与 x-trace-uuid 不一致（line 193）→ 403 `authority-escalation`
  - 这是**三重 escalation 检测**：trace 不一致、authority shape 不一致、tenant claim 超 deploy
- **F4 `TEAM_UUID` 5-worker 全覆盖**：核查全部 5 worker wrangler.jsonc，root + env.preview vars 双配。orchestrator-core 与 agent-core 各自独立做 bootstrap check（`ensureConfiguredTeam` / `validateInternalAuthority` 里的 503 分支）。**不再依赖** `_unknown` fallback 作为 preview/prod 真相。修正了 Opus F0-F2 review 的 R5 延后项。
- **F4 executor recheck seam 正确实现**：
  - `bash-core/src/executor.ts:73-78 ExecutorOptions.beforeCapabilityExecute` 签名 `(ctx: { plan, requestId }) => Promise<void> | void`
  - line 197-211 on synchronous path、line 366-379 on streaming path：两处都 `try { await beforeCapabilityExecute(...); } catch (err) { return {kind:"error", error:{code:"policy-denied", message}} }` — **fail-closed by default**
  - `test/executor.test.ts` 有 happy-path（hook 被调用）+ fail-closed（throw 转为 policy-denied）两条测试
- **F5 final roundtrip test 覆盖完整闭环**：`test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs` 105 行，步骤：
  1. orchestrator start（JWT + trace_uuid + x-trace-uuid header）
  2. WS attach + `waitForMatchingMessage` 等 `session.stream.event`
  3. verify `capability-call` with `toolName:"pwd"` → 断言 `response.status === "ok"`（打通到 bash-core）
  4. cancel → 断言 terminal=cancelled
  5. status/timeline 读取
  6. **legacy agent-core /sessions/:id/status 断言 410 + canonical_worker=orchestrator-core**（闭环包括 retirement 反向证明）
- **contexter 吸收口径在 F3-F5 继续被遵守**：
  - `orchestrator-core/src/policy/authority.ts` 的 JWT-trace-ingress-policy 组合**没有复制** contexter `core/jwt.ts` 的 sign 路径到生产（F0-F2 review R7 要求的 "signJwt 不出现在生产 auth.ts" 在 F3-F5 保持不违反）
  - `handoff/orchestration-facade-to-next-phase.md` §2 明确 "Use the older F0-F3 action-plans only as ancestry, not as the primary truth pack" — 与 contexter inventory 的 "ancestry ≠ absorb" 原则一致
  - F4/F5 没有引入 contexter 的 `director.ts` / `producer.ts` / `db_do.ts`
- **F5 terminal probe marker 与 meta 状态翻转**：
  - `orchestrator-core/src/index.ts:22,33` phase 类型与返回值均固定为 `"orchestration-facade-closed"`
  - `workers/orchestrator-core/test/smoke.test.ts` 8 tests 中有 probe shape 固化断言
  - `test/package-e2e/orchestrator-core/01-preview-probe.test.mjs` 断言 `phase: "orchestration-facade-closed"`
  - `docs/plan-orchestration-facade.md` 顶层状态 `closed charter (r2 executed; see final closure + handoff pack)` — charter 本身已翻 closed
- **handoff memo 有 5 节结构化内容**：§1 可依赖真相、§2 阅读顺序、§3 明确延后项、§4 operational disciplines（5 条,含 secret rotation / TEAM_UUID 显式 / 不再重开 legacy / terminal marker 不复用）、§5 下一阶段建议方向。这比 "just a closure doc" 更负责。
- **F3 test 迁移保持了 initial-context 覆盖**：原 F0-F2 时期 agent-core `03-initial-context-smoke` 作为独立 test,迁移后**没有丢失语义** —— `test/package-e2e/orchestrator-core/02-session-start.test.mjs` 有**第二个 liveTest "orchestrator-core verify exposes initial_context effect"**,发 start with initial_context 后 call `/verify {check: "initial-context"}` 断言 `pendingCount >= 1` + `assembledKinds.includes("session")` + `totalTokens > 0`。这是**同效或更强** 的覆盖。（审查此条时我曾怀疑是 coverage regression,核查后撤回。）

### 1.5 已确认的负面事实

- **`forwardInternalRaw` 的 `body?.auth_snapshot` 分支是死代码路径**。`user-do.ts:672-674` 的 `isAuthSnapshot(body?.auth_snapshot) ? body.auth_snapshot : await this.get<AuthSnapshot>(...)` —— 上游调用者（`handleStart` line 266 / `handleInput` line 311 / `handleCancel` line 347 / `handleVerify` line 388）**全部**使用 `authority:` 字段名而非 `auth_snapshot:` 字段名。因此 `body?.auth_snapshot` 永远是 `undefined`，`isAuthSnapshot` 永远 false，永远 fall through 到持久化 key。功能上没 bug（持久化值就是 body.auth_snapshot 的 refresh 后版本），但**该分支判断从未命中**。
- **legacy `deriveCanonicalUrl` 依赖 hostname 包含字面 "agent-core"**。`workers/agent-core/src/index.ts:52-58` `url.hostname.includes("agent-core") → replace("agent-core", "orchestrator-core")`。在 Cloudflare preview 命名 `nano-agent-agent-core-preview.haimang.workers.dev` 下可用，但对任何自定义域名或 localhost:8787 不 work（canonical_url 会与 request URL 相同，失去指导价值）。
- **SessionEntry lifecycle 与 agent-core DO phase 没有正式 mapping 表**。orchestrator 侧 status（`starting/active/detached/ended`）4 态、agent-core DO phase（`new/authenticated/attached/turn_running/completed/ended`）更多态；orchestrator 用 `extractPhase(body?.phase)` 从 ack body 读 `last_phase`,但对两侧概念的对齐只是 "存下来当字符串",**没有设计 doc 或运行时枚举约束** 来保证对应关系。
- **`beforeCapabilityExecute` hook 在 production bash-core 路径上尚未被构造器 wire**。`workers/bash-core/src/worker-runtime.ts` 构造 `CapabilityExecutor` 时不传 `beforeCapabilityExecute` option（未在本轮改动面）。这与 F4.A scope 一致（只建 seam 不建 domain），F4 closure §5 也明说 "应沿 `beforeCapabilityExecute()` 扩展",但**closure 没显式说 "production path 目前未 wire"** —— 读者可能以为已启用。
- **F5 `cross-e2e/11` 的 `capability-call` verify 路径依赖 `pwd` tool 执行成功**。test line 66-73 发 `check: "capability-call", toolName: "pwd", toolInput: {}` 断言 `response.status === "ok"`。`pwd` 是 bash-core 21 个 allow-gated 命令之一,依赖 `beforeCapabilityExecute` 未 wire（否则会 fail-closed）。**测试存在"hook 必须 no-op 或 absent"的隐式前提**,若未来 wire hook 做真实 recheck（例如 credit check failing for this test session),此测试会断。**需要记录为测试假设**。
- **`orchestrator-core/src/user-do.ts` 的 `handleStart` 不验证 body.auth_snapshot 里的 `tenant_uuid` 是否等于 agent-core 侧 TEAM_UUID**。orchestrator 侧 `auth.ts` 已做 tenant claim vs deploy tenant 的 alignment（line 148-150）,但 user-do.ts 层不再复检。这依赖 "orchestrator 的 auth 一次验证足够",在 single-tenant-per-deploy 模型下正确;但如果未来 orchestrator-core 与 agent-core 分不同部署（不同 TEAM_UUID）,这里的假设会崩。F4.A 没处理（不在 scope）,handoff §3 已列为 next-phase item。

---

## 2. 审查发现

### R1. `legacyRetirementResponse` 的 `canonical_url` 依赖 hostname 字面匹配(**medium**)

- **严重级别**：`medium`
- **类型**：`correctness`（边缘部署环境的 docs-gap）
- **事实依据**：
  - `workers/agent-core/src/index.ts:52-58`：
    ```ts
    function deriveCanonicalUrl(request: Request): string {
      const url = new URL(request.url);
      if (url.hostname.includes("agent-core")) {
        url.hostname = url.hostname.replace("agent-core", "orchestrator-core");
      }
      return url.toString();
    }
    ```
  - `test/package-e2e/orchestrator-core/07-legacy-agent-retirement.test.mjs:27-28`：
    ```js
    assert.match(res.json.canonical_url, /orchestrator-core/);
    assert.match(res.json.canonical_url, new RegExp(`/sessions/${sessionId}/${action}$`));
    ```
    —— 只通过 include `"orchestrator-core"` 字符串,依赖当前 preview 命名。
  - 若 agent-core 将来部署到 custom domain `agent.mycompany.com`,`hostname` 不含 "agent-core" 字面,`deriveCanonicalUrl` 返回的 URL 将**等于原始 request URL**(意味着 client 被指引回 legacy URL,循环告知自己被 retire)
- **为什么重要**：
  - `canonical_url` 是 legacy retirement body 给 client 的**唯一重定向线索**。在 production 或 custom-domain 部署下 broken 意味着 client 拿到一个指向自己的 "canonical_url",无法跟随。
  - 这不影响 410 status 本身的正确性(client 仍知道 legacy 已退役),但 UX + 可观测性降级。
  - 测试 07 无法捕捉此问题 —— 因为测试只打 preview,preview 命名刚好含 "agent-core" 字面。
- **审查判断**：
  - 不是 F3 blocker(实际 preview 可用),但是**一个设计依赖假设**,handoff 中未提。
- **建议修法**：
  1. 改用 env 变量 `ORCHESTRATOR_CANONICAL_HOST`(在 wrangler 配置 preview/prod 各自显式指向 orchestrator host),`deriveCanonicalUrl` 从 env 读,fallback 到当前的 hostname replace 作最后保底。
  2. 或者,`agent-core/wrangler.jsonc` 的 preview `vars` 加一条 `ORCHESTRATOR_PUBLIC_URL = "https://nano-agent-orchestrator-core-preview.haimang.workers.dev"`,代码直接读该值构造 canonical_url,不做 hostname 字符串魔法。
  3. 测试 07 相应断言完整 URL 而非 `include("orchestrator-core")` substr match。
  4. 至少在 handoff memo §4 operational disciplines 追加一条"agent-core legacy retirement 当前假设 preview hostname 含 `agent-core` 字面,custom domain 前需 revisit"。

### R2. SessionEntry lifecycle 与 agent-core DO phase 无正式 mapping(**medium**)

- **严重级别**：`medium`
- **类型**：`docs-gap` + `correctness`(潜在漂移源)
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:16` `SessionStatus = 'starting' | 'active' | 'detached' | 'ended'`(4 态)
  - `workers/agent-core/src/host/actor-state.ts` 的 `ActorPhase` 更多态(`new/authenticated/attached/turn_running/completed/ended`,具体取决于 host/actor-state.ts 当前定义)
  - `user-do.ts:extractPhase` 只是 `body?.phase` 字段原样保存到 `last_phase`,orchestrator 不对其做语义约束
  - 现有设计 doc `F0-session-lifecycle-and-reconnect.md` §7.2 F1 定义了 4 态 lifecycle,但**没有跨 worker mapping 表**
- **为什么重要**：
  - 当 agent-core DO phase = `turn_running` 但 orchestrator status = `active` 时是一致的;如果 agent DO phase = `completed` 但 orchestrator status 仍 `active`(例如 ack 丢失或 cancel response 超时),两侧状态**永久漂移**。
  - handleCancel `user-do.ts:341-381` 直接标 `status:"ended"` 不等 agent 确认,假定 cancel forward 成功 = session 真 ended;若 agent DO 自行在 cancel 前已 completed 但 ack 没回来,orchestrator 仍会进入 `"ended"` + `terminal:"cancelled"`,这与 agent DO 真实状态(已 `completed`)冲突。
  - 冲突在当前架构下**不会被观察到**(client 看不到 agent DO 内部 phase),但后续 replay / debugging / audit trail 会出现 "orchestrator 说 cancelled,agent timeline 说 completed"。
- **审查判断**：
  - 不是 F3-F5 blocker。first-wave single-writable-attachment + short session 模型下概率低。但若下一阶段引入 reconnect 恢复 long-lived session 或 billing 要求精确 session reason,此 gap 会上升为 bug。
- **建议修法**：
  1. F0-session-lifecycle-and-reconnect.md 增加一节 "§7.3 Agent phase ↔ orchestrator status mapping 表",列:
     - agent `new/authenticated` → orchestrator `starting`
     - agent `attached/turn_running` → orchestrator `active` or `detached`(基于 attachment 存在)
     - agent `completed/ended` → orchestrator `ended`(terminal 类型由 orchestrator 自行追加 `completed/cancelled/error`)
  2. `user-do.ts:extractPhase` 增加白名单(只接受已知 phase 字符串),未知 phase 记 `last_phase=null` + warn log,避免静默保存未来新 phase 名。
  3. (optional)`handleCancel` 可以读 `cancelAck.body.phase`,若 agent 侧已 `completed` 应覆盖 terminal 为 `"completed"` 而非 `"cancelled"`。

### R3. `forwardInternalRaw` 的 `body?.auth_snapshot` 分支为死代码(**low**)

- **严重级别**：`low`
- **类型**：`correctness`(代码 smell,非 bug)
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:672-674`:
    ```ts
    const authority = isAuthSnapshot(body?.auth_snapshot)
      ? body.auth_snapshot
      : await this.get<AuthSnapshot>(USER_AUTH_SNAPSHOT_KEY);
    ```
  - 上游 4 个调用者`(handleStart line 266 / handleInput line 311 / handleCancel line 347 / handleVerify line 388)`统一使用 `authority:` 字段名而非 `auth_snapshot:`,因此 `body.auth_snapshot` 永远 undefined。
  - `isAuthSnapshot(undefined)` 返回 false,永远 fall through 到持久化 key。
- **为什么重要**：
  - 非 bug —— 持久化 `USER_AUTH_SNAPSHOT_KEY` 在 `handleStart` 调用 `refreshUserState` 后已写入,后续 action 读到的就是 orchestrator 最新 snapshot。功能正确。
  - 但对代码阅读者,`body?.auth_snapshot` 检查看似一个 branch,实际永不触发。次 future 维护者可能以为 orchestrator 允许调用方覆盖 authority,增加错误改动面。
- **审查判断**：
  - `low`,可在下一次 user-do.ts 重构时顺手清理。
- **建议修法**：
  1. 要么改为 `body?.authority`(与 forward 时使用的字段名对齐)
  2. 要么直接删除 `isAuthSnapshot(body?.auth_snapshot) ?` 分支,简化为 `const authority = await this.get<AuthSnapshot>(USER_AUTH_SNAPSHOT_KEY);`
  3. 本轮 low priority,无需在 F3-F5 内 re-open PR。

### R4. `F5 final-closure` 未显式说明 bash-core `beforeCapabilityExecute` hook 在 production 路径上尚未 wire(**low**)

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `workers/bash-core/src/executor.ts` 有 hook 定义和调用实现,但 `workers/bash-core/src/worker-runtime.ts`(production 入口)构造 `CapabilityExecutor` 时**未传** `beforeCapabilityExecute` option(本轮代码未 touch worker-runtime.ts)
  - `docs/issue/orchestration-facade/F4-closure.md:92` "future 若要引入 credit / quota / revocation,应沿 `beforeCapabilityExecute()` 扩展" —— 未说明 "当前尚未 wire"
  - `docs/issue/orchestration-facade/orchestration-facade-final-closure.md:55` "`bash-core` 已具备 `beforeCapabilityExecute()` seam" —— 字面上正确(seam 已存在),但读者易误以为运行时已 active
- **为什么重要**：
  - 下一阶段作者若预期 "这个 seam 已经 wired,我只需把 credit check 注入即可",会发现需要先做 wiring 这一步。handoff memo 未明确这一步。
- **审查判断**：
  - `low`,是 closure wording 精度问题,不是代码漏洞。
- **建议修法**：
  1. 在 `orchestration-facade-final-closure.md` §3 item 5 或 handoff memo §3 追加一行 "`beforeCapabilityExecute` seam exists in `CapabilityExecutor` class but is **not yet wired in `bash-core/src/worker-runtime.ts`;** next-phase credit/quota charter will need to thread the option through on construction"。
  2. 或在 bash-core README 加一条 known limitation。

### R5. `cross-e2e/11` 依赖 "hook 未 wire" 作为隐式前提(**low**)

- **严重级别**：`low`
- **类型**：`test-gap`(隐性假设未文档化)
- **事实依据**：
  - `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs:66-73` 发 `verify { check:"capability-call", toolName:"pwd" }` 断言 `response.status === "ok"`
  - 当 F4 后续真实 wire `beforeCapabilityExecute` 做 credit check,pwd capability 执行前 hook 若 deny → 返 `policy-denied` → verify response.status ≠ "ok" → 测试断
  - 测试本身不 mention 这个假设
- **为什么重要**：
  - 本阶段正确,但下一阶段 credit wire 第一次启动时**最先断的测试是这条**。无文档说明会让 diff 阅读者困惑 "为什么 cross 11 挂了"。
- **审查判断**：
  - `low`,known limitation not a bug。
- **建议修法**：
  1. 在 cross-e2e/11 test 顶部加一条注释:`// ASSUMPTION: bash-core beforeCapabilityExecute seam is not wired at this phase; future credit/quota charter 将使 this test 需要额外 context (e.g., funded tenant)`
  2. 或在 test/INDEX.md 对应 cross-e2e/11 条目加注。

### R6. orchestrator-core 的 `x-nano-internal-authority` header 传输整个 authority JSON,无大小限制(**low**)

- **严重级别**：`low`
- **类型**：`correctness`(future 扩展性)
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:686` `'x-nano-internal-authority': JSON.stringify(authority)` 无长度约束
  - 当前 `AuthSnapshot` 字段少(`sub / realm? / tenant_uuid? / tenant_source / membership_level? / source_name? / exp?`),序列化后通常 < 200 字节
  - HTTP header size 限制因 CDN / proxy 而异,常见限制 8KB;Cloudflare Workers 允许较大但有实际限制
  - 如果未来 AuthSnapshot 扩字段(e.g. `roles: string[]`, `quotas: {...}`)到数千字节,header 可能被拒
- **为什么重要**：
  - 当前不构成问题,但 F4 handoff 未对此 header 大小做约束,未来可能悄悄扩大。
- **审查判断**：
  - `low`,future-proofing 提醒,非当前 bug。
- **建议修法**：
  1. `internal-policy.ts:validateInternalAuthority` 在 parse `x-nano-internal-authority` 时加大小护栏(例如限制 header value < 4KB),超过返 400 `authority-too-large`。
  2. 或 F4 design doc 明确 "AuthSnapshot first-wave 最大字段 N,超过该 budget 需重新设计 transport"。

---

## 3. In-Scope 逐项对齐审核

### 3.1 F3 In-Scope 对照

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| P1-01 | orchestrator package-e2e 目录建立(7 slot) | `done` | 01-07 全齐 |
| P1-02 | live harness 新 env | `done` | `NANO_AGENT_ORCHESTRATOR_CORE_URL` + `NANO_AGENT_ORCHESTRATOR_JWT_SECRET` 已纳入 |
| P2-01 | agent-core/02-06 迁移到 orchestrator-core | `done` | 原文件已删除,职责已吸收到 orchestrator 02/05/06/07 |
| P2-02 | auth-negative + legacy-410 | `done` | 06 + 07 已新增 |
| P3-01 | cross-e2e 02-09 入口迁移 | `done`(声明) | GPT 工作日志声明 02,03,04,05,06,08,09 入口切到 orchestrator;未逐行核对每个测试文件,接受声明 |
| P3-02 | test/INDEX.md + README 更新 | `done`(声明) | 本轮未逐行 diff |
| P4-01 | legacy HTTP 410 | `done` | 7-action 全覆盖(含 `end`),body shape typed(`error/message/canonical_worker/canonical_url`) |
| P4-02 | legacy WS 426 | `done` | 同 PR 完成 |
| P5-01 | F3 closure | `done` | `F3-closure.md` 已产出 |

### 3.2 F4 In-Scope 对照

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| P1-01 | ingress/internal helper 落位 | `done` | `orchestrator-core/src/policy/authority.ts` + `agent-core/src/host/internal-policy.ts` 分别到位 |
| P1-02 | typed reject taxonomy | `done` | 明确:`invalid-auth / invalid-trace / tenant-mismatch / invalid-internal-auth / worker-misconfigured / missing-authority / invalid-authority / authority-escalation / invalid-internal-body` |
| P2-01 | `TEAM_UUID` bootstrap law | `done` | 5 worker wrangler.jsonc 全配 + orchestrator + agent-core 各自 bootstrap check → 503 |
| P2-02 | `tenant_source` snapshot 审计 | `done` | `auth.ts:160 tenant_source: claimTenant ? "claim" : "deploy-fill"` |
| P3-01 | no-escalation enforcement | `done` | `internal-policy.ts:193 (trace)` + `line 230 (authority)` 双重 escalation 检测 |
| P3-02 | executor recheck seam | `done` | `bash-core/src/executor.ts:73,197-211,366-379`,fail-closed,worker unit tests 覆盖 |
| P4-01 | negative tests | `done` | `orchestrator-core/test/smoke.test.ts` 新增 3 条;package-e2e 06-auth-negative 4 条 negative;agent-core smoke 新增 internal 无 secret / 错 secret |
| P4-02 | F4 closure | `done` | `F4-closure.md` 已产出 |

**F4 观察**:实现深度**超出** action-plan 最低要求 —— internal-policy.ts 的 body vs header authority equality 检查是 action-plan 未强制的,这条主动加固让 no-escalation law 真实 enforceable。**正向超交付**。

### 3.3 F5 In-Scope 对照

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| P1-01 | F0-F4 closure 审阅 | `done` | final-closure memo §1 有 6 个 phase 的 `closed` 状态映射表 |
| P1-02 | exit criteria 核对 | `done` | final-closure §2 有 6 条 criterion 逐条 evidence |
| P2-01 | final closure memo | `done` | `orchestration-facade-final-closure.md` 已产出 |
| P2-02 | handoff memo | `done` | `docs/handoff/orchestration-facade-to-next-phase.md` 已产出,5 节结构化 |
| P2-03 | F5 closure | `done` | `F5-closure.md` 已产出 |
| P3-01 | meta-doc + charter state sync | `done` | `docs/plan-orchestration-facade.md` 顶部状态 `closed charter (r2 executed)`,probe marker `orchestration-facade-closed` |
| P3-02 | final roundtrip cross-e2e | `done` | `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs` 覆盖 JWT→orchestrator→agent→bash→ws event→legacy 410 闭环 |

### 3.4 阶段级 Exit Criteria 对照(charter §15)

| charter exit criterion | 审查结论 | 证据 |
|------------------------|----------|------|
| canonical public owner = orchestrator-core | ✅ | legacy 7-action + WS 全 410/426;orchestrator 接管 7-action + ws |
| first-wave session seam 完整闭环 | ✅ | user DO lifecycle 4 态 + retention + reconnect + single writable attachment |
| authority/tenant/no-escalation runtime truth | ✅ | orchestrator-core/policy/authority.ts + agent-core/host/internal-policy.ts + bash-core executor hook + 5-worker TEAM_UUID |
| live topology proof | ✅ | package-e2e 35/35 + cross 47/47(含 `cross-e2e/11` JWT→orchestrator→agent→bash→stream→legacy 410 全链路)|
| docs/tests/meta state 一致 | ✅ | charter closed,probe marker closed,test/INDEX.md 同步,7 个 orchestrator package-e2e slot 对齐架构 |
| next-phase handoff 可消费 | ✅ | handoff memo 5 节 + operational disciplines + 推荐下阶段方向 |

**全 6 条硬门槛通过**。

### 3.5 对齐结论

- **done**: 100% (F3 9/9 + F4 8/8 + F5 7/7 + 阶段 exit 6/6)
- **partial**: 0
- **missing**: 0
- **超出计划项**:F4 `internal-policy.ts` 的 body-vs-header authority equality + trace equality 双重校验(action-plan 只要求 "no-escalation enforcement",实现更严)

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项(charter §6.2)| 审查结论 | 说明 |
|------|---|----------|------|
| O1 | 重造全新 public product API | `遵守` | 仍 compatibility surface,无新 v2 路径 |
| O2 | multi-tenant-per-deploy | `遵守` | 5 worker TEAM_UUID 同值 "nano-agent",single-tenant |
| O3 | full user-memory / history / RAG | `遵守` | user DO 仍 4 字段 schema,无 SQLite / RAG |
| O4 | credit/quota/billing domain | `遵守` | `beforeCapabilityExecute` 只有 seam,未 wire domain |
| O5 | WorkerEntrypoint RPC / transport rewrite | `遵守` | 全程 fetch-backed service binding |
| O6 | orchestrator direct bind context/filesystem | `遵守` | orchestrator wrangler.jsonc services 只有 `AGENT_CORE`,无 CONTEXT/FILESYSTEM |
| O7 | 第 6+ worker | `遵守` | 5-worker topology 稳定 |
| O8 | 删除 probe surfaces | `遵守` | `GET /` + `/health` 在 agent-core / orchestrator-core 都保留 |

**8 条 Out-of-Scope 全部遵守**。无 scope creep。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**:**F3-F5 三个周期完成度高,阶段级 orchestration-facade 可正式视为 closed**。authority hardening 实际深度超出原 scope 最低要求,final roundtrip test 真实覆盖整条 public path,handoff memo 包含可执行 operational disciplines。识别出 6 条 follow-up(3 medium / 3 low),**无一条是 F3-F5 blocker**。
- **是否允许关闭本轮 review**:`yes`(本轮收口)
- **阶段是否允许 closed**:**yes** — orchestration-facade 可以正式声明 closed。
- **下一阶段启动前必须完成的 blocker**:**无**
- **强烈建议在下一阶段首批任务处理的 followup**:
  1. **R1**(canonical_url 脆弱性):custom domain / production deploy 前必须处理,不然 client 指引错误。建议加到 handoff memo §4 operational disciplines。
  2. **R2**(lifecycle mapping):下一阶段若涉及 richer session / billing / audit,mapping 表**必须先写**。
- **可 later 处理的 low follow-up**:
  1. R3 dead code branch 清理
  2. R4 closure wording(bash-core hook 未 wire 显性说明)
  3. R5 cross-e2e/11 测试假设注释
  4. R6 header size 护栏

---

## 6. 阶段级交叉回顾(cross-phase deeper analysis)

本节突破 F3-F5 边界,对整个 orchestration-facade 阶段(F0-F5)做跨包、跨阶段的事实性深度审视。这是对 closure memo 的**补充性独立判断**,不是对 closure 本身的否定。

### 6.1 阶段整体演化曲线

| Phase | 主要交付 | LOC 增量(代码) | 测试增量 | 阶段性质 |
|---|---|---|---|---|
| F0 | design freeze + FX-qna | ~0(仅文档) | 0 | pure design |
| F1 | orchestrator scaffold + `/internal/*` 7 路径 + first roundtrip | ~850(orchestrator-core 首次)+ ~180(agent-core internal.ts)| 10 vitest + 2 live package-e2e | scaffold + bring-up |
| F2 | 补 WS / retention / reconnect / terminal / missing | +200 user-do.ts | +3 live(03/04/05)| session owner 充实 |
| F3 | legacy 410/426 + cross migration + canonical suite | +80(agent-core index.ts legacy)+ 2 package-e2e 文件 | +2 live(06/07)+ cross 入口迁移 | surface cutover |
| F4 | policy layer × 2 + executor seam + TEAM_UUID 5-worker | +32(policy/authority.ts)+ 245(internal-policy.ts)+ ~40(executor hook)+ 5 wrangler edit | +3 orchestrator smoke + ~10 unit + 多条 live negative | law hardening |
| F5 | final closure + handoff + cross-e2e/11 + terminal probe | +105(cross-e2e/11)+ 小改 probe marker | +1 cross(11)| phase closeout |

**观察**:F1 的实际交付 **超出** 原计划 —— action-plan F1 P3-01 只承诺 `start/cancel/stream` 3 条 internal path,实际实现 7 条全集。这让 F2 原计划的"扩 internal route 到 full set"工作部分前置完成。类似地,F4 `internal-policy.ts` 在 245 行的实现深度明显超过 action-plan 最低要求。

**这不是坏事** —— 多数超交付都是"看到实现现场发现某条校验早做比后做代价更低",GPT 做出了工程上正确的权衡。但它也意味着**后续 review 需要独立核查每个 phase 的实际交付面而不是只参考 action-plan checkbox**。

### 6.2 跨包耦合分析

#### 6.2.1 Authority payload 跨 worker 的一致性

- **orchestrator-core/auth.ts:authenticateRequest** 构造 `AuthSnapshot` (sub/realm/tenant_uuid/tenant_source/membership_level/source_name/exp)
- **orchestrator-core/user-do.ts:forwardInternalRaw** 序列化为 `x-nano-internal-authority` header + body `authority`
- **agent-core/host/internal-policy.ts:normalizeAuthority** 反序列化,做 tenant 检查
- **agent-core DO** 的 `buildIngressContext` 仍然使用 `env.TEAM_UUID`,**不消费** orchestrator forward 过来的 authority payload

**这就是 Opus F0-F2 review R5 的底层事实** —— 我当时判断 "F3 前必须同步 TEAM_UUID",GPT 当时 defer。二次复核时我撤回判断(因为 internal 通道不走 `verifyTenantBoundary`)。现在 F4 **补齐了 TEAM_UUID 5-worker 同步**,但 agent-core DO 的 `buildIngressContext` 仍然只读 env.TEAM_UUID,不消费 forwarded authority。这意味着:

> **下一阶段 credit/billing charter 若想"按 user/tenant 收费",必须让 agent-core DO 真正消费 forwarded authority(目前它只用 env)。F5 handoff §3 第 1 条"credit / quota / billing"暗含这一要求,但未显式列 `buildIngressContext` 改造。**

**Finding implicit**:F5 handoff memo 对下一阶段"credit charter 需要改 agent-core buildIngressContext"这个具体 trigger 点没显式说。可加到 memo §3。

#### 6.2.2 NDJSON stream frame 的生产-消费不对称

- **生产者**:agent-core `internal.ts:forwardInternalStream` —— snapshot-based,每次调用合成全量 NDJSON 一次性返回
- **消费者**:orchestrator-core `user-do.ts:readNdjsonFrames + parseStreamFrame` —— 真实 reader with buffer,能消费持续 stream

**不对称的结果**:orchestrator-core 具备消费 "真 live stream" 的能力,但 agent-core 不生产。下一阶段若 wire 真 live stream(F4 beyond 或 richer orchestrator),**只需要改 agent-core 的 producer,orchestrator 侧不用大改**。这是架构对称性好的表现。F0-F2 review R1 提出的 "snapshot transform" 问题仍然存在,但**消费侧已 future-ready**。

#### 6.2.3 probe marker 贯穿阶段

| Phase | orchestrator probe phase | agent probe phase | 是否对称 |
|---|---|---|---|
| F1 | `orchestration-facade-F1` | `worker-matrix-P2-live-loop`(不变) | 否(各自生命周期不同)|
| F2 | `orchestration-facade-F2` | 不变 | 否 |
| F3 | `orchestration-facade-F3` | 不变 | 否 |
| F5 | `orchestration-facade-closed` | 不变 | 否 |

**观察**:agent-core probe phase 在整个 orchestration-facade 阶段**没变**(仍然是 `worker-matrix-P2-live-loop`)。这在当前语义下是合理的 —— orchestration-facade 阶段主要修改 orchestrator,agent-core runtime 本身没新阶段标识。但它让读者**单纯看 agent-core probe 不知道 orchestration-facade 已经 cutover**。

**Finding implicit**:agent-core probe 在 orchestration-facade closed 后是否应该有一个 marker 表示"已被 orchestrator 接管"?handoff 没说。不是 blocker,属"阶段存量"。

### 6.3 跨阶段语义统一性

#### 6.3.1 `x-trace-uuid` 的出现时机

- **F1**:`x-trace-uuid` 不存在,trace 只在 body 里(`trace_uuid` 字段)
- **F2**:同 F1
- **F3**:同 F2
- **F4**:**新增 `x-trace-uuid` header** 作为 public ingress 硬要求(orchestrator `auth.ts:139-145`)+ internal contract 硬要求(`internal-policy.ts:147-156`)
- **F5**:no change

这是 F4 的**协议层升级**,不是纯 hardening。原计划的"authority/trace/no-escalation"三件套里,trace 的 "UUID 格式 + header 强制" 是本轮才真正落地。Pre-F4 的 orchestrator 只从 header 读 `x-trace-uuid` 做 optional fallback(`auth.ts pre-F4` 版本),F4 改成 required + UUID 格式。

**这是 breaking change**,但客户端当前只有测试,test harness `orchestrator-auth.mjs` 已同步加了 `x-trace-uuid` 注入。**无残留 client code 破损**。

#### 6.3.2 authority payload 从"body field"演进到"header + body"冗余传递

- **F1-F3**:`auth_snapshot` 只在 body
- **F4 后**:`x-nano-internal-authority` header + body `authority` 同时传,由 `internal-policy.ts:authorityEquals` 强制一致

**这是 authority transport 的显式化** —— header 版本让 agent-core 在 parse body 前就能 reject(早 reject 比晚 reject 好),body 版本保持 NACP envelope 心智。两者冗余 + 强制一致是正确的 belt-and-suspenders 设计。

但也要诚实记录:**这让 orchestrator 和 agent-core 之间的 internal contract 更"长"了**。下一阶段任何扩字段都要同时改 header schema 和 body schema,耦合面扩大。

### 6.4 测试覆盖深度

#### 6.4.1 正面路径覆盖

- **package-e2e/orchestrator-core**:7 个文件,覆盖 probe / start+initial-context / ws attach / reconnect / full route family / auth negative / legacy retirement
- **cross-e2e**:02-06/08/09 通过 orchestrator 入口 + 10 probe concurrency + 11 final roundtrip
- **vitest unit**:orchestrator-core 14/14,agent-core 1035/1035,bash-core 359/359

正面路径**完整覆盖**。

#### 6.4.2 Negative 路径覆盖

- **public ingress**:missing bearer / malformed token / missing trace / tenant mismatch — 4 条 live
- **internal ingress**:worker-unit(agent-core smoke)覆盖 invalid secret / missing secret;package-e2e **没有直接测 internal negative**(internal 不对外,正常)
- **executor recheck**:unit 覆盖 happy + fail-closed
- **legacy retirement**:7 HTTP action × 410 + 1 WS × 426 全覆盖

**观察**:没有**"orchestrator 构造了合法 header,但 body authority 与 header 不一致"的 live negative test**。这条路径只在 agent-core smoke 里测了 `authority-escalation` 的 worker 单测版本,没 live 路径。F5 final roundtrip 走正常路径,不做这个。这是一个小的 coverage gap,**不是 blocker**(恶意 orchestrator 不是 first-wave 威胁模型),但可作为下阶段补齐项。

### 6.5 contexter 吸收的长期遵守度

从 F0(contexter inventory freeze)到 F5(closure),对 contexter 的吸收口径**严格守住**:

- `jwt.ts` → `orchestrator-core/src/auth.ts:verifyJwt` 是重写不是 copy(符合 F0-F2 review R8 调整后的 "adapt-pattern (reimplemented from reference)")
- `chat.ts` middleware(withTrace / withAuth / getUserDOStub / wrapInCicp)→ F1 吸收 pattern,F4 强化为真实 policy helper,**没有** 扩到 wrapInCicp 或 CICP packet
- `engine_do.ts` WS sessions map → user-do.ts `attachments: Map<session_uuid, AttachmentState>`
- `db_do.ts` → **全程未吸收**,user-do.ts 始终走 DO storage KV
- `context/director.ts` / `ai/*` / `rag/*` → **全程未吸收**,orchestrator-core 没有 RAG / intent / generation 逻辑

**阶段级 contexter 吸收 discipline 维持良好**,没有偷渡 first-wave 边界外的内容。这是 FX-qna Q4 frozen answer 的直接落地。

### 6.6 known limitations(接受为下一阶段输入)

按 handoff memo §3 + 我独立核查,下一阶段必须清楚继承的 4 条 known limitations:

1. **`/internal/stream` 仍是 snapshot-based finite NDJSON**(F0-F2 R1 延续) —— handoff 已列
2. **`beforeCapabilityExecute` seam 存在但未 wire** —— handoff 暗含(R4 要求显式说)
3. **`agent-core DO buildIngressContext` 仍读 env.TEAM_UUID,不消费 forwarded authority** —— handoff §3 credit charter 隐含但未显式
4. **orchestrator ↔ agent session lifecycle 无正式 mapping 表**(R2) —— handoff 未提

### 6.7 阶段级工程质量评估

| 维度 | 评级(1-5)| 说明 |
|------|:--:|------|
| Design → Code 贯通 | 5 | FX-qna 8 题 frozen answer 在 F1-F5 代码里全部能找到精确映射 |
| Scope discipline | 5 | 8 条 Out-of-Scope 在整个阶段(不只 F3-F5)都守住 |
| 测试覆盖面 | 4 | 正面 + legacy negative + auth negative 都覆盖;body-vs-header escalation live 缺(§6.4.2)|
| 阶段间粘合度 | 4 | F1 超交付 7 条 internal path 反而让 F2 更顺;F4 authority 向上层 tenant mapping 仍有 gap(§6.2.1)|
| 文档叙事精度 | 4 | closure 多数准确,但 bash hook 未 wire / lifecycle mapping / canonical_url 假设未显式说 |
| 超交付合理性 | 5 | F4 authority 实现深度超出 scope 是正确的工程判断 |

### 6.8 阶段级 final verdict

**orchestration-facade 阶段作为独立工程单位,可视为 closed**。

以下 4 点是下一阶段 charter 作者的**必读清单**(不等于 blocker,但一开工就要消费):

1. R1(canonical_url 脆弱) + R2(lifecycle mapping) 在下阶段第一个 design doc 就应处理
2. agent-core DO `buildIngressContext` 改造(让其消费 forwarded authority)是 credit charter 的真正起点
3. `/internal/stream` 的 "snapshot → live push" 升级是下一阶段唯一可能重开 runtime transport 的议题
4. `beforeCapabilityExecute` hook wiring 是 credit domain 启动的**第一步**(先 wire 再填逻辑,不是反过来)

---

## 7. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-24 | Claude Opus 4.7 (1M context) | F3-F5 + 阶段级完整独立审查。基于 3 份 action-plan(含执行日志 §11)+ 4 份 closure(F3/F4/F5/final)+ handoff memo + 实际源码(orchestrator-core 4 文件 / agent-core 3 文件 / bash-core executor.ts)+ 5 worker wrangler.jsonc 配置 + 7 package-e2e + cross-e2e/11 + contexter 参考代码。识别 6 条 follow-up(3 medium / 3 low),无 blocker。阶段 exit 6/6 硬门槛通过,orchestration-facade 可正式 closed。独立完成,未参考其他 reviewer(Kimi/DeepSeek/GPT/早期 Opus)对同范围的分析。cross-phase §6 覆盖 F0-F5 整条演化曲线 + 跨包耦合 + 跨阶段语义统一性 + 测试覆盖深度 + contexter 吸收守纪。 |

---

## 8. 实现者回应

### 8.1 对本轮审查的回应

> 执行者: `GPT-5.4`
> 执行时间: `2026-04-24`
> 回应范围: `R1-R6`

- **总体回应**：`已修掉本轮确认成立的代码/文档问题；将两个更适合下一阶段处理的事项显式保留为 deferred。`
- **本轮修改策略**：`先修 runtime truth（bash-core executor path、orchestrator user-do error path、agent-core canonical redirect），再补 smoke/live 文档与 handoff truth。`

### 8.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | `canonical_url` 依赖 hostname 字面匹配 | `fixed` | 新增 `ORCHESTRATOR_PUBLIC_BASE_URL`，`deriveCanonicalUrl()` 现优先用显式 public base URL 生成 canonical redirect，仅在 env 缺失时 fallback 到旧 hostname replace。 | `workers/agent-core/src/index.ts`, `workers/agent-core/wrangler.jsonc`, `workers/agent-core/test/smoke.test.ts` |
| R2 | SessionEntry lifecycle 与 agent-core DO phase 无正式 mapping | `deferred` | 当前 first-wave 仍是 snapshot-over-NDJSON internal relay，`last_phase` 继续只作为 façade audit string 保存；本轮不发明并不被当前 wire truth 支撑的 formal mapping，而是把它写入 handoff open items。 | `docs/handoff/orchestration-facade-to-next-phase.md` |
| R3 | `forwardInternalRaw` 的 `body?.auth_snapshot` 分支为死代码 | `fixed` | `user-do.ts` 现改为读取 `body?.authority`，与真实 caller 形状对齐。 | `workers/orchestrator-core/src/user-do.ts` |
| R4 | closure 未说明 `beforeCapabilityExecute` 在 production 路径上尚未 wire | `fixed` | 不只是补文档：`bash-core` production runtime 现在实际通过 `CapabilityExecutor` 执行 request/cancel；同时 closure/handoff 明确写出“当前尚无额外 provider 配置”。 | `workers/bash-core/src/executor.ts`, `workers/bash-core/src/worker-runtime.ts`, `docs/issue/orchestration-facade/F4-closure.md`, `docs/issue/orchestration-facade/orchestration-facade-final-closure.md`, `docs/handoff/orchestration-facade-to-next-phase.md` |
| R5 | `cross-e2e/11` 依赖 “hook 未 wire” 作为隐式前提 | `fixed` | 在 cross test 与 closure/handoff 文档中补出这一假设，避免 future credit/quota phase 首次触线时变成“无注释断测”。 | `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs`, `docs/issue/orchestration-facade/F4-closure.md`, `docs/handoff/orchestration-facade-to-next-phase.md` |
| R6 | `x-nano-internal-authority` header 传整个 authority JSON、无大小限制 | `deferred` | 当前 `AuthSnapshot` 仍是 first-wave 小 payload；本轮未引入 ad-hoc truncation / clipping，以避免在未冻结预算前制造 transport drift。 | `docs/code-review/orchestration-facade/F3-F5-reviewed-by-opus.md` |

### 8.3 变更文件清单

- `workers/bash-core/src/executor.ts`
- `workers/bash-core/src/worker-runtime.ts`
- `workers/orchestrator-core/src/user-do.ts`
- `workers/orchestrator-core/test/user-do.test.ts`
- `workers/agent-core/src/index.ts`
- `workers/agent-core/wrangler.jsonc`
- `workers/agent-core/test/smoke.test.ts`
- `workers/agent-core/README.md`
- `test/package-e2e/agent-core/01-preview-probe.test.mjs`
- `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs`
- `test/INDEX.md`
- `docs/issue/orchestration-facade/F3-closure.md`
- `docs/issue/orchestration-facade/F4-closure.md`
- `docs/issue/orchestration-facade/F5-closure.md`
- `docs/issue/orchestration-facade/orchestration-facade-final-closure.md`
- `docs/handoff/orchestration-facade-to-next-phase.md`

### 8.4 验证结果

```text
pnpm --filter @haimang/orchestrator-core-worker test
  Test Files  2 passed (2)
  Tests       16 passed (16)

pnpm --filter @haimang/agent-core-worker typecheck
pnpm --filter @haimang/agent-core-worker build
pnpm --filter @haimang/agent-core-worker test
  exit code 0

pnpm --filter @haimang/bash-core-worker typecheck
pnpm --filter @haimang/bash-core-worker build
pnpm --filter @haimang/bash-core-worker test
  Test Files  29 passed (29)
  Tests       359 passed (359)

pnpm test:cross
  tests 47
  skipped 47
  (expected without NANO_AGENT_LIVE_E2E=1)
```

### 8.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. `SessionEntry` ↔ agent DO `phase` 仍未冻结 formal mapping；当前 handoff 只把它作为 next-phase streaming/runtime charter 的 open item。
  2. `x-nano-internal-authority` 的 first-wave payload budget 仍未显式写成 hard cap；若 authority 未来膨胀，需要在下一阶段同时冻结字段预算与 transport strategy。

---

## 9. 对 Claude Opus 4.7 代码审查质量的评价

> 评价人: `GPT-5.4`
> 评价时间: `2026-04-24`
> 评价依据: `workers/agent-core/src/index.ts`, `workers/orchestrator-core/src/user-do.ts`, `workers/bash-core/src/{executor,worker-runtime}.ts`, `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs`, `docs/issue/orchestration-facade/{F4-closure,orchestration-facade-final-closure}.md`

### 9.1 一句话评价
Opus 这轮审查证据链最完整、对 runtime 与 docs 之间的语义缝隙最敏感，能抓到真正值得修的 F3-F5 边缘问题，但个别 finding 已开始越过当前 first-wave truth，进入“下一阶段应冻结什么”的设计提醒。

### 9.2 优点
1. 能把 `canonical_url`、dead branch、cross-e2e/11 测试假设、final closure wording 这些低噪音但真实重要的问题分层拆开，不把所有问题都膨胀成 blocker。
2. 对 bash-core executor seam 的观察很有价值；它直接推动了这轮把 production `worker-runtime` 接回 `CapabilityExecutor` 主路径，而不是只做 closure wording 修补。

### 9.3 事实确认 - 审核文档中，所有真实存在的问题
1. R1 成立：`legacyRetirementResponse` 的 canonical redirect 原先确实依赖 hostname string replacement，现已改为优先消费 `ORCHESTRATOR_PUBLIC_BASE_URL`。
2. R3 成立：`forwardInternalRaw()` 原先读取 `body?.auth_snapshot`，与真实 caller 使用的 `authority` 字段不一致。
3. R4 成立：closure/handoff 原先没有把 executor seam 的 runtime wiring truth 讲清；本轮同时补了 runtime path 与文档。
4. R5 成立：`cross-e2e/11` 对 `pwd` happy-path 的假设原先未显式落盘。

### 9.4 事实错误 - 审核文档中，所有的事实错误
1. R2 把“尚无 formal mapping”上升成当前阶段 defect 有些过满。当前 first-wave façade 只承诺保存 `last_phase` 作为 audit string，并未宣称已经拥有严格的 cross-worker lifecycle law。
2. R6 更像 future-proofing 提醒，而不是当前 F3-F5 的真实 defect；现阶段 `AuthSnapshot` payload 很小，也没有 evidence 显示 header budget 已逼近上限。

---
以上内容均不局限于只有2个，如果多个请一一列举。
---

### 9.5 评分 - 总体 **4.5 / 5**

| 维度 | 评分（1–5） | 说明 |
|------|-------------|------|
| 证据链完整度 | 5 | 大部分 finding 都能落到具体文件、测试与 closure/handoff 语句。 |
| 判断严谨性 | 4 | 总体很稳，但 R2/R6 稍微越过了当前 first-wave reality。 |
| 修法建议可执行性 | 5 | R1/R3/R4/R5 的建议都能直接转成本轮 patch。 |
| 对 action-plan / design 的忠实度 | 5 | 很擅长把 review 结论回扣到 F3/F4/F5 的 charter 与 action-plan 语言。 |
| 协作友好度 | 4 | 语气直接但可操作，少量结论略偏“下一阶段设计要求”而非“当前阶段真实 bug”。 |
