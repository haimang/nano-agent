# Nano-Agent 代码审查模板

> 审查对象: `orchestration-facade / F3 + F4 + F5（含跨阶段全景审查）`
> 审查时间: `2026-04-24`
> 审查人: `DeepSeek`
> 审查范围:
> - F3: `docs/action-plan/orchestration-facade/F3-canonical-cutover-and-legacy-retirement.md` + 工作日志 + `F3-closure.md`
> - F4: `docs/action-plan/orchestration-facade/F4-authority-hardening.md` + 工作日志 + `F4-closure.md`
> - F5: `docs/action-plan/orchestration-facade/F5-closure-and-handoff.md` + 工作日志 + `F5-closure.md` + `orchestration-facade-final-closure.md` + `orchestration-facade-to-next-phase.md`
> - 代码: `workers/orchestrator-core/src/{index,user-do,auth,policy/authority}.ts`、`workers/agent-core/src/{index,host/internal,host/internal-policy}.ts`、`workers/bash-core/src/executor.ts`
> - 测试: `test/package-e2e/orchestrator-core/{06,07}*.test.mjs`、`test/cross-e2e/{02-09,11}*.test.mjs`、`test/shared/{orchestrator-auth,orchestrator-jwt,live}.mjs`、`test/INDEX.md`、`workers/{orchestrator,agent,bash}-core/test/*.test.ts`
> - 配置: `workers/{orchestrator-core,agent-core,bash-core,context-core,filesystem-core}/wrangler.jsonc`
> - 跨阶段对照: F0-F5 全套 action-plan、design、closure、charter
> - 对照参考: `context/smind-contexter/{core/jwt,src/chat,src/engine_do}.ts`
> 文档状态: `reviewed`

---

## 0. 总结结论

> F3～F5 整体实现了 orchestration-facade 阶段的后半程目标：canonical ingress 已切、legacy surface 已退役、authority/tenant/no-escalation 已形成 policy layer、阶段 closure 与 handoff 已完成。但有两类问题需要在 handoff 前收口：(a) F4 的 `beforeCapabilityExecute` seam 是 opt-in hook 而非强制 enforcement，这与 action-plan 的"集中化 law"定位存在 gap；(b) legacy retirement 的 `canonical_url` 推导使用了脆弱的 hostname 替换，且跨阶段的 probe marker 收口只发生在 orchestrator-core 上，其余 4 个 worker 的 marker 仍在讲述 pre-facade 时代的旧叙事。

- **整体判断**：`F3/F4/F5 各自达到了 action-plan 规定的最低收口标准，但 F4 的 enforcement 力度与 F5 的跨 worker marker 同步是两个隐性的阶段级 unfinished business。`
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. `beforeCapabilityExecute()` 的架构定位与 F4 action-plan 的语言之间存在 gap：plan 把它描述为"centralized policy layer"与"集中 hook"，而实现层面它是一个 constructor options 中的可选回调，不调用就不会被触发。这对当前的单一构造点可能够用，但它不构成"enforced by architecture"的 policy law。
  2. F3 中 `deriveCanonicalUrl()` 使用纯字符串 hostname 替换（`replace("agent-core", "orchestrator-core")`）来推导退役响应中的 `canonical_url`——这在对 hostname 命名约定高度依赖的环境下可工作，但一旦 worker 命名模式变更即会生成错误的重定向 URL。
  3. F5 只将 orchestrator-core 的 probe marker 翻到了 terminal 态 `orchestration-facade-closed`，其余 4 个 worker 仍保留 pre-facade 阶段的旧 marker（如 agent-core 仍显示 `worker-matrix-P2-live-loop`）。这不是 blocker，但仓库级 probe truth 未形成一致的"本阶段已完成"语义。

---

## 1. 审查方法与已核实事实

> 这一节只写事实，不写结论。
> 明确你看了哪些文件、跑了哪些命令、核对了哪些计划项/设计项。

- **对照文档**：
  - `docs/plan-orchestration-facade.md`（charter r2，§1.5/§3.5/§6.1-6.5/§11.4/§11.5/§15.1）
  - `docs/action-plan/orchestration-facade/F3-canonical-cutover-and-legacy-retirement.md`（含 §11 工作日志）
  - `docs/action-plan/orchestration-facade/F4-authority-hardening.md`（含 §11 工作日志）
  - `docs/action-plan/orchestration-facade/F5-closure-and-handoff.md`（含 §11 工作日志）
  - `docs/design/orchestration-facade/F0-compatibility-facade-contract.md`
  - `docs/design/orchestration-facade/F0-live-e2e-migration-inventory.md`
  - `docs/design/orchestration-facade/F4-authority-policy-layer.md`
  - `docs/design/orchestration-facade/FX-qna.md`（Q5/Q6/Q7/Q8）
  - `docs/issue/orchestration-facade/F3-closure.md` / `F4-closure.md` / `F5-closure.md`
  - `docs/issue/orchestration-facade/orchestration-facade-final-closure.md`
  - `docs/handoff/orchestration-facade-to-next-phase.md`
  - `docs/code-review/orchestration-facade/F0-F2-reviewed-by-deepseek.md`（上一次审查，用于跨阶段对比）
- **核查实现**：
  - `workers/orchestrator-core/src/index.ts`（118 行，当前版本含 F3/F5 marker 更新）
  - `workers/orchestrator-core/src/user-do.ts`（787 行，当前版本含 F4 internal authority 转发）
  - `workers/orchestrator-core/src/auth.ts`（190 行，含 trace 强制要求、tenant mismatch、`validateIngressAuthority` 导出）
  - `workers/orchestrator-core/src/policy/authority.ts`（33 行）
  - `workers/agent-core/src/index.ts`（122 行，含 legacy 410/426 retirement）
  - `workers/agent-core/src/host/internal.ts`（179 行，含 `validateInternalAuthority` 取代旧 `validateInternalSecret`）
  - `workers/agent-core/src/host/internal-policy.ts`（252 行）
  - `workers/bash-core/src/executor.ts`（736 行，含 `beforeCapabilityExecute` seam）
  - 5 个 worker 的 `wrangler.jsonc`（均已含 `TEAM_UUID: "nano-agent"`）
  - `test/package-e2e/orchestrator-core/06-auth-negative.test.mjs`（80 行）
  - `test/package-e2e/orchestrator-core/07-legacy-agent-retirement.test.mjs`（46 行）
  - `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs`（99 行）
  - `test/shared/orchestrator-auth.mjs` / `orchestrator-jwt.mjs` / `live.mjs`
  - `test/INDEX.md`（188 行，已更新到 v0.3）
  - `workers/orchestrator-core/test/smoke.test.ts`（174 行，含 trace/tenant negative tests）
  - `workers/orchestrator-core/test/user-do.test.ts`（322 行）
  - `workers/bash-core/test/executor.test.ts`（172 行，含 `beforeCapabilityExecute` 测试）
- **执行过的验证**：
  - `pnpm --filter @haimang/orchestrator-core-worker typecheck`
  - `pnpm --filter @haimang/orchestrator-core-worker build`
  - `pnpm --filter @haimang/orchestrator-core-worker test`
  - `pnpm --filter @haimang/agent-core-worker typecheck`
  - `pnpm --filter @haimang/agent-core-worker build`
  - `pnpm --filter @haimang/agent-core-worker test`
  - `pnpm --filter @haimang/bash-core-worker typecheck`
  - `pnpm --filter @haimang/bash-core-worker build`
  - `pnpm --filter @haimang/bash-core-worker test`
  - `pnpm test:package-e2e`（`35 / 35`）
  - `pnpm test:cross`（`47 / 47`）

### 1.1 已确认的正面事实

- `agent-core` 的 7 个 legacy session HTTP actions（`start/input/cancel/end/status/timeline/verify`）现在统一返回 HTTP `410`，legacy WS `/sessions/:id/ws` 返回 HTTP `426`，与 `F0-compatibility-facade-contract.md` §7.2 F2 的冻结口径一致。两条路径均提供 `canonical_worker: "orchestrator-core"` 与 `canonical_url` 作为迁移指引。
- agent-core 的 `index.ts` 采用早退策略：`/internal/*` 优先于 legacy session 路由的 retirement 判断，再优先于 `not-found`。这保证了 gated internal contract 不受退役影响。
- `test/package-e2e/agent-core/` 下的 session-facing 测试（原 `02-06`）已被删除，其职责吸收到了 `test/package-e2e/orchestrator-core/` 的 canonical public suite 中。
- 7 个 affected cross-e2e（`02,03,04,05,06,08,09`）的入口 URL 均已从 `agent-core` 切换到 `orchestrator-core`。
- `test/shared/orchestrator-auth.mjs` 和 `test/shared/orchestrator-jwt.mjs` 已被抽取为 orchestrator-facing live tests 的统一 harness，消除了 F1/F2 时期在单个 test 文件中内联 JWT 构造代码的重复局面。
- `workers/orchestrator-core/src/policy/authority.ts` 集中提供了 `ensureConfiguredTeam()`（TEAM_UUID bootstrap）、`readTraceUuid()`（从 `x-trace-uuid` header 或 `trace_uuid` query 读取）、`jsonPolicyError()`（typed error response）三个基础工具，被 `auth.ts` 和 `index.ts` 消费。
- `workers/agent-core/src/host/internal-policy.ts`（252 行）实现了完整的 internal authority 校验链：secret gate → TEAM_UUID bootstrap → trace UUID → authority header JSON parse → authority normalization（含 tenant truth 对齐）→ body escalation check（body 内的 `trace_uuid` / `authority` 不得越权）。
- `auth.ts` 的 `authenticateRequest()` 现在对 public ingress 强制要求 `x-trace-uuid` header 或 `trace_uuid` query parameter，缺失时返回 typed `400 invalid-trace`。这与 FX-qna Q5 的 Opus 建议一致。
- `tenant_source` 已正确写入 `AuthSnapshot`（`"claim"` vs `"deploy-fill"`），可审计 JWT claim 的 tenant origin。
- 5 个 worker 的 `wrangler.jsonc` 全部在 `vars.TEAM_UUID` 和 `env.preview.vars.TEAM_UUID` 中显式配置了 `"nano-agent"`，预览环境不再依赖 `_unknown` fallback。
- `beforeCapabilityExecute()` seam 在 `CapabilityExecutor.execute()` 和 `executeStream()` 两个路径中均已插入，落点固定在 `policy.check(plan)` 之后、`target handler lookup` 之前。error → `policy-denied` 的 fail-closed 语义正确。
- `F0-F2-reviewed-by-deepseek.md` 中指出的两个关键问题已得到修正：(a) `minted` 状态已从 `SessionStatus` union 中移除；(b) `forwardInternalStream()` 上方已追加 `// First-wave relay is snapshot-based` 注释；(c) `readNdjsonFrames` 已引入 `parseStreamFrame()` 运行时校验，解决 StreamFrame 缺乏防御性解析的问题。
- `readInternalStream()` 的返回类型从 `StreamFrame[]` 改为 `StreamReadResult`（`{ ok: true, frames } | { ok: false, response }`），使得 frame 解析错误能被正确传播为 `502 invalid-stream-frame` 响应，而非静默吞错。
- `handleWsAttach()` 中的 supersede 顺序被重新排布：现在先 `readInternalStream`（读取流），再 `attachments.delete` + `superseded` 发送 + `close(4001)`，最后设置新 attachment。这避免了旧 socket 的 close 回调误伤新 attachment 状态。
- F5 产出的 `orchestration-facade-final-closure.md` 明确列出了 5 项"未做且留给下一阶段"的事项，包括 snapshot relay 限制和 credit/quota 域，closure 的边界诚实。
- `test/INDEX.md` 已更新到 v0.3，目录结构清楚地表达了 5 个 worker 的当前 posture：`agent-core` 只剩 probe，`orchestrator-core` 有 7 文件/12 subtests，cross suite 已切换到 orchestrator 入口。

### 1.2 已确认的负面事实

- `deriveCanonicalUrl()`（`workers/agent-core/src/index.ts:52-58`）采用 `hostname.replace("agent-core", "orchestrator-core")` 来推导重定向 URL。这个逻辑在当前的 hostname 命名约定（`nano-agent-agent-core-*` → `nano-agent-orchestrator-core-*`）下成立，但其正确性完全依赖于字符串命名的一致性——没有 config、没有 env var、没有 service discovery。一旦 hostname pattern 改变，退役响应会指向不存在的 URL。
- `beforeCapabilityExecute` 在 `CapabilityExecutor` 中是 constructor options 级别的可选回调。它不来自任何 policy helper 或 worker 级 middleware——完全依赖 executor 的构造者在构造时传入。在当前的仓库中，没有一个 worker 的入口代码（`bash-core/src/index.ts`、`agent-core/src/host/do/nano-session-do.ts` 等）实际使用 `beforeCapabilityExecute`。也就是说：这个 seam 存在、已测试，但**当前没有任何运行时 enforcement 被 wiring 上去**。F4 closure 中"no-escalation 已真实 enforce"的宣告在 capability execution 路径上只是 hook-ready，而非 hook-wired。
- 所有 5 个 worker 中，只有 orchestrator-core 的 probe marker (`phase` 字段) 被翻到了 `orchestration-facade-closed`。`agent-core` 的 `AgentCoreShellResponse.phase` 仍然是 `"worker-matrix-P2-live-loop"`；`bash-core`、`context-core`、`filesystem-core` 的 probe marker 未受 F3/F4/F5 任何影响，仍讲述着各自的 pre-facade phase 叙事。这意味着：一个只看 probe 的外部 observer 无法从 agent-core 或 bash-core 的 `/health` 响应中得知 orchestration-facade 已经闭合。
- `workers/agent-core/src/host/internal-policy.ts:222-226` 在 body escalation check 中同时检查了 `body.authority` 和 `body.auth_snapshot` 两个字段。这种"同时尝试两个 key"的做法源自 `forwardInternalJson` 中同时出现了两种 authority pass 路径（见 `user-do.ts` 的 `forwardInternalRaw` 方法通过 `x-nano-internal-authority` header 传递 authority，而 body 中携带 `authority` 字段），但 policy 层对两者的检测是 OR 关系——这在前端发错字段名时可能悄悄放行（因为 header 已证明 identity，body 里放错的字段名如果为空则根本不触发检测分支）。

---

## 2. 审查发现

> 使用稳定编号：`R1 / R2 / R3 ...`
> 每条 finding 都应包含：严重级别、事实依据、为什么重要、审查判断。
> 只写真正影响 correctness / security / scope / delivery 的问题，不写样式意见。

### R1. `beforeCapabilityExecute` 是 opt-in hook，不是 centralized enforcement

- **严重级别**：`high`
- **类型**：`scope-drift`
- **事实依据**：
  - `workers/bash-core/src/executor.ts:73-76` — `beforeCapabilityExecute` 定义为 `ExecutorOptions` 上的可选字段，类型是 callback。
  - `workers/bash-core/src/executor.ts:197-213` — 在 `execute()` 中，`beforeCapabilityExecute` 仅当 `this.options?.beforeCapabilityExecute` 存在时才调用。
  - 对整个仓库的代码搜索（grep `beforeCapabilityExecute`）确认：该 seam 仅被 bash-core 的 unit test (`executor.test.ts:144-170`) 调用以证明 fail-closed 语义。**没有任何 worker 入口代码或 agent-core 的 DO 构造代码实际传递了这个 hook。**
  - F4 action-plan §§1.1/3 将其定位为"让 legality 判断从 scattered code 提取成中央 helper""集中 hook，插入点固定在 policy.check(plan) 之后、target lookup 之前"；F4 closure §1 宣称"no-escalation 已真实 enforce"。
- **为什么重要**：
  - F4 action-plan 的核心交付物之一是"no-escalation enforcement"与"executor recheck seam"。如果 seam 存在但任何运行时路径都没有 wiring 它，那么 no-escalation 在 actual execution 路径上不是 enforced law——它是"为 future builder 预留的插入点"。
  - 这与 F4 自称的"law 已落地"存在显著 gap：当前真正在执行的 law 是 `internal-policy.ts` 中的 header-level 校验（secret、trace、authority header、body escalation），但 executor 层的 recheck 只是 infrastructure，不是 enforcement。
  - 下游若以 F4 closure 为基座开始 credit/quota domain，会假设"executor 前已有集中 hook 会拦"，而实际上必须自己先 wiring。
- **审查判断**：
  - `beforeCapabilityExecute` 的 API 设计（位置、时机、fail-closed）是正确的。问题只在"built but not wired"。
  - 这应被诚实表述为"seam exists and is tested, but runtime wiring is a near-term follow-up"，而不是"enforcement is live"。
- **建议修法**：
  1. F4 closure 的"已真实 enforce"措辞改为"centralized legality layer completed with a tested executor recheck seam; runtime wiring of the seam in agent-core's executor construction is the first next-phase operational task"。
  2. 在 handoff memo 的 open items 表中新增一行："executor recheck seam runtime wiring — seam exists, not yet wired into agent-core's DO construction path"。
  3. 若要在 F4 内完成 wiring，可在 `workers/agent-core/src/host/do/nano-session-do.ts`（或等价构造点）中在构造 `CapabilityExecutor` 时传入 `beforeCapabilityExecute`。

### R2. `deriveCanonicalUrl()` 基于 hostname 字符串替换，对命名约定变更零防御

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `workers/agent-core/src/index.ts:52-58` — `deriveCanonicalUrl()` 的完整实现：
    ```typescript
    function deriveCanonicalUrl(request: Request): string {
      const url = new URL(request.url);
      if (url.hostname.includes("agent-core")) {
        url.hostname = url.hostname.replace("agent-core", "orchestrator-core");
      }
      return url.toString();
    }
    ```
  - 该函数依赖两个假设：(a) agent-core 的 hostname 包含子字符串 `"agent-core"`；(b) orchestrator-core 的 hostname 是 agent-core hostname 中将 `"agent-core"` 替换为 `"orchestrator-core"` 的结果。
  - agent-core 的 `AgnetCoreEnv` 中没有任何 `CANONICAL_ORCHESTRATOR_URL` 类字段；`wrangler.jsonc` 的 `vars` 中也没有。
  - FX-qna Q7 和 `F0-compatibility-facade-contract.md` §7.2 F2 讨论过 `canonical_public` 的 URL 组装位置，最终结论是将它"保留给 F3 实现期处理"。F3 的当前实现选择了一个在约定成立时有效、但无 fallback 的方案。
- **为什么重要**：
  - 如果 orchestrator-core 的 hostname 未来不是简单的 `agent-core → orchestrator-core` 替换（例如 worker name 被重构），`deriveCanonicalUrl` 会沉默地返回错误的 URL。legacy client 会受到指向不存在地址的重定向提示。
  - 更严重的是：`deriveCanonicalUrl` 没有"if not includes agent-core" 的分支——如果 hostname 碰巧不包含 `agent-core`，它原样返回 URL，指向退役了的 agent-core 自身。
- **审查判断**：
  - 这不是 F3 的 blocker，因为当前的命名约定已被验证成立，且 F3 legacy test `07-legacy-agent-retirement.test.mjs:30` 确实在用 regex 断言 `canonical_url` 包含 `orchestrator-core` 前缀。
  - 但它是不应该在"已退役"阶段还留着的硬编码。应有一个可配置的 fallback。
- **建议修法**：
  1. 在 agent-core 的 `wrangler.jsonc` `vars` 中增加 `CANONICAL_ORCHESTRATOR_URL: "https://nano-agent-orchestrator-core-preview.haimang.workers.dev"`（preview）/ 对应的 prod 值。
  2. `deriveCanonicalUrl` 改为优先读取 `env.CANONICAL_ORCHESTRATOR_URL`，仅在 env 缺失时才 fallback 到 hostname 替换。
  3. 在 handoff 的 operational notes 中增加："agent-core 退役响应中的 `canonical_url` 目前依赖 hostname 推导，若 worker 命名 convention 变更需同步更新 env var"。

### R3. 跨 worker probe marker 未同步到 terminal 态

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - orchestrator-core probe: `phase: "orchestration-facade-closed"` ✅
  - agent-core probe: `phase: "worker-matrix-P2-live-loop"` ✗
  - bash-core / context-core / filesystem-core probe: 各自保留 pre-facade 阶段的旧 marker ✗
  - Opus 在 `F0-F5-action-plan-reviewed-by-opus.md` 中明确建议："5 个 worker 的 probe marker 统一切到 orchestration-facade-closed"。
  - F5 closure 和 handoff 对此的立场是"其余 worker probe posture 在 handoff 中被显式说明"——即 handoff's §1 只列出了当前的 marker 状态，但没有 bump 它们。
- **为什么重要**：
  - probe marker 是 deploy 后的第一个真相源。agent-core 现在仍自称 `worker-matrix-P2-live-loop`，这在任何 new contributor 或 cross-team reviewer 看来都暗示它仍然处于 pre-facade 的独立 lifecycle phase 中。
  - 在仓库的跨阶段真相一致性上，这是一个 low-cost、high-signal 的修复。
- **审查判断**：
  - 不是 F3-F5 的 blocker，因为 orchestrator-core 的 marker 已正确表达本阶段完成。但 agent-core 的 marker 应被 bump。
  - bash-core、context-core、filesystem-core 的 marker bump 是 optional 的，因为它们在本阶段未发生核心 posture 变化。
- **建议修法**：
  1. 将 agent-core 的 `AgentCoreShellResponse.phase` 从 `"worker-matrix-P2-live-loop"` 更新为 `"orchestration-facade-closed"`（或一个既表达 runtime host identity、又表达已进入 closed phase 的新 marker，如 `"runtime-host-facade-closed"`）。
  2. 同步更新 `workers/agent-core/test/smoke.test.ts` 中的 marker 断言和 `workers/agent-core/README.md`。

### R4. Internal authority validation 对 body authority 来源的双 key 检测可能导致静默 pass

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `workers/agent-core/src/host/internal-policy.ts:222-226`:
    ```typescript
    const bodyAuthority = normalizeAuthority(
      bodyJson.authority ?? bodyJson.auth_snapshot,
      teamUuid,
    );
    ```
  - `workers/orchestrator-core/src/user-do.ts:651,694` — `forwardInternalJson` 向 agent-core 发送的 body 中携带的字段是 `authority: body.auth_snapshot`。
  - 因此：当 orchestrator 向 agent-core 发出 internal request 时，body 的 `authority` 字段被正确设置。`auth_snapshot` 字段在 body 中不存在（body 中只有 `authority`）。
  - `internal-policy.ts` 的双检测逻辑：如果 `bodyJson.authority` 存在则用 `authority`，否则 fallback 到 `bodyJson.auth_snapshot`。在 orchestrator 的正常路径上这不会出问题——`authority` 会命中。但如果未来有其他 caller（例如 tests、或 agent-core 自环调用）在 body 中使用了不同字段名，OR 检测可能默默通过一个错误命名的字段。
  - 更关键的是：`normalizeAuthority` 的返回值在 escaliation check 中依赖 `authorityEquals(headerAuthority, bodyAuthority)` 来防止越权——但只在 `bodyAuthority` 非 null 时才会触发。如果两个字段都不存在或都指向无效数据，escalation check 直接跳过（`!bodyAuthority → skip escalation check`）。
- **为什么重要**：
  - 这是一个非常 subtle 的安全面问题：如果未来有代码路径发送 body 时忘了带 authority，internal-policy 不会在 escalation check 阶段报错——它只依赖 header authority 的校验通过，body 的 authority 缺失被当作"非越权请求"放过。
  - 在当前的 single-caller（只有 orchestrator-core）场景下，这不是 exploit，因为 orchestrator 的 `forwardInternalRaw` 始终发送 `authority` header 和 body `authority` 字段。但 F4 作为 law layer，应该被设计为防御所有可能的 misuse，而不只是当前 callers。
- **审查判断**：
  - 低严重度、高信号价值。建议收紧为：若 body 中携带了 any authority-like 字段但不合法（null after normalize），则拒绝（而非跳过 escalation check）。
- **建议修法**：
  1. 若 body 中有 `authority` 或 `auth_snapshot` 任意一个字段但 `normalizeAuthority` 返回 null → 直接返回 `invalid-authority` 错误（而非跳过）。
  2. 统一 body 中的 authority 字段名为单一的 `authority`（移除 `auth_snapshot` 作为 body-level fallback），降低双 key 检测的心智负担。

### R5. F3 迁移未覆盖 `cross-e2e/01` 和 `cross-e2e/10` 的入口语义（非需修复，已在日志中交代）

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **事实依据**：
  - F3 action-plan P3-01 要求"迁 affected cross-e2e 的 default public owner 到 orchestrator"。
  - 实际上 `cross-e2e/01`（stack inventory probe）和 `cross-e2e/10`（concurrency probe）并未切换入口——它们被"升级为 5-worker inventory / 40-request fan-out probe"，而不是迁移到 orchestrator。
  - F3 执行日志（§11）对此有说明，closure 对此没有。
- **为什么重要**：
  - 不是 bug——01 和 10 本质上是 probe/topology 验证而非 session-facing 测试，不切入口是合理的。但 F3 的"affected cross-e2e"定义与最终执行的差异在 closure 中没有被解释。
- **审查判断**：
  - 可关闭。但建议在 F3 closure 中简要说明 01/10 的处理决策。
- **建议修法**：
  1. 在 F3 closure 的 §2 或 §5 中加一句："01/10 是 probe/topology 测试，不依赖 session ingress，因此升级为 5-worker inventory 而非切入口 owner。"

---

## 3. In-Scope 逐项对齐审核

> 结论统一使用：`done | partial | missing | out-of-scope-by-design`。

### F3 — Canonical Cutover and Legacy Retirement

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | P1-01: canonical public suite 目录建立 | `done` | `orchestrator-core/01-07` 7 个 test slots 已建立 |
| S2 | P1-02: live harness orchestrator env | `done` | `NANO_AGENT_ORCHESTRATOR_CORE_URL` + `orchestrator-auth/jwt.mjs` 已落地 |
| S3 | P2-01: migrate agent-core session tests | `done` | `agent-core/02-06` 已删除，session-facing tests 归入 orchestrator-core |
| S4 | P2-02: auth-negative + legacy-negative | `done` | `06-auth-negative`（4 subtests）与 `07-legacy-retirement`（3 subtests）已就位 |
| S5 | P3-01: cross-e2e 入口迁移（02-09） | `done` | 7 个 affected cross tests 全部切到 orchestrator entry |
| S6 | P3-02: test docs truth 更新 | `done` | `test/INDEX.md` v0.3 与 README 已同步到 F3 canonical truth |
| S7 | P4-01: legacy HTTP `410` | `done` | 7 个 legacy HTTP actions 返回 typed 410 |
| S8 | P4-02: legacy WS `426` | `done` | legacy WS 返回 typed 426 |
| S9 | P5-01: cutover closure + probe rollover | `done` | `F3-closure.md` 已产出，probe marker 已 bump 到 F3（后续被 F5 覆盖为 terminal） |

### F4 — Authority Hardening

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S10 | P1-01: ingress/internal policy helper | `done` | `policy/authority.ts`（orchestrator）+ `internal-policy.ts`（agent）已落地并被消费 |
| S11 | P1-02: typed reject taxonomy | `done` | `invalid-trace`、`tenant-mismatch`、`missing-authority`、`authority-escalation` 等 reject shape 已固定 |
| S12 | P2-01: TEAM_UUID bootstrap law | `done` | 5 个 worker wrangler 均已显式配置，entry-level bootstrap check 已在 orchestrator 和 agent 侧存在 |
| S13 | P2-02: auth snapshot `tenant_source` | `done` | `claim` / `deploy-fill` 已正确记录并伴随 snapshot 存储 |
| S14 | P3-01: no-escalation enforcement (header) | `done` | internal-policy 的 body `trace_uuid` mismatch + body `authority` mismatch 检测已实现 |
| S15 | P3-02: executor recheck seam | `partial` | 见 R1：seam 存在且 fail-closed 已测试，但无 runtime wiring。按 F4 自己的收口标准（"seam 存在且不破坏当前执行流"），seam 本身已完成；但"真实 enforcement"未达成 |
| S16 | P4-01: negative tests | `done` | missing trace、tenant mismatch、legacy retirement、executor recheck fail-closed 均已有 test coverage |
| S17 | P4-02: F4 closure + probe marker | `done` | `F4-closure.md` 已产出，marker 在 F5 中被翻到 terminal（F4 未独立 bunk） |

### F5 — Closure and Handoff

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S18 | P1-01: F0-F4 closure 审阅 | `done` | 5 份 phase closure 齐全 |
| S19 | P1-02: exit criteria 核对 | `done` | 阶段 exit criteria 可逐条引用 evidence |
| S20 | P1-03: final topology verification asset | `done` | `11-orchestrator-public-facade-roundtrip.test.mjs` 已落地且为绿 |
| S21 | P2-01: final closure | `done` | `orchestration-facade-final-closure.md` 已形成 single truth anchor |
| S22 | P2-02: handoff memo | `done` | `orchestration-facade-to-next-phase.md` 已形成 input pack |
| S23 | P2-03: F5 closure | `done` | `F5-closure.md` 已记录执行事实 |
| S24 | P3-01: meta-doc / charter state sync | `partial` | 见 R3：charter 状态已翻，orchestrator marker 已翻 terminal，但 agent-core 和其余 3 worker 的 marker 未随阶段同步翻转 |

### 3.1 对齐结论

- **done**: `21`
- **partial**: `3`（S15 executor recheck wiring、S24 跨 worker marker 同步、F3 closure 未解释 01/10 处理决策）
- **missing**: `0`

> F3~F5 的执行完整覆盖了 action-plan 的结构化工作项。3 个 partial 评级均非 correctness 层面的问题——它们属于"seam built but not wired"和"docs state not fully propagated across workers"。这意味着从可交付性的角度看，新 charter 可以在现有基础上启动，但应在启动前花一个 micro-cycle 完成 S15 的 wiring 和 S24 的 marker 收口。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | F3: post-F3 grace window | `遵守` | 无任何额外 grace window |
| O2 | F3: 删除 probe surfaces | `遵守` | agent-core/orchestrator-core probe 继续保留 |
| O3 | F3: 迁移 bash/context/filesystem internal posture suites | `遵守` | 这些 suite 未受影响 |
| O4 | F4: credit/quota/billing/revocation domain | `遵守` | F4 的代码中无任何此类逻辑 |
| O5 | F4: multi-tenant-per-deploy source migration | `遵守` | TEAM_UUID 仍为 single-tenant deploy truth |
| O6 | F5: 重做 F1-F4 实施项 | `遵守` | F5 只做文档聚合，未新增功能代码 |
| O7 | F5: 起草下一阶段完整 charter | `遵守` | handoff 只给 inputs，未代写 charter 正文 |

---

## 5. 跨阶段全景审查：F0→F5 贯穿比对

> 本节的审查面积从单 phase 的对齐审核扩大到：
> - F0 的 design freeze 到 F5 的 terminal state 之间，是否存在未被任何 closure 记录的盲点
> - 跨 package 的 change 是否在 5 个 worker 之间形成了自洽的 architecture posture
> - live test evidence 是否在每个 phase 的 claim 之下都有对应的自动化断言
> - 是否存在 action-plan / design doc / 实际代码 三者之间的 factual inconsistency

### 5.1 阶段级退出条件逐条复查

对照 charter §15.1 的 7 条硬闸：

| # | 退出条件 | 状态 | 证据 |
|---|---------|------|------|
| 1 | `orchestrator-core` 已存在并 preview deploy 成功 | ✅ | F1 closure + F3/F4/F5 live suites 持续为绿 |
| 2 | `orchestrator-core` 已成为唯一 canonical public HTTP / WS ingress | ✅ | F3-F4 live evidence + agent legacy 410/426 已被断言 |
| 3 | first-wave user DO schema 已落地并承载 active session registry | ✅ | F1-F2 实现 + F2-F4 live suites |
| 4 | `session_uuid` minting / reconnect / stream relay 已验证 | ⚠️ | session lifecycle ✅, reconnect ✅; stream relay 是 snapshot-based（已在 final closure 中诚实标注） |
| 5 | F4.A authority hardening 已完成，tenant truth 已冻结，execution-time recheck hook 已存在 | ⚠️ | header-level law ✅; executor recheck seam 存在但未 wiring（见 R1） |
| 6 | 受 façade cutover 影响的 live tests / harness / docs 已显式迁移或显式保留 | ✅ | F3 migration evidence |
| 7 | `orchestrator -> agent` internal call contract 已冻结并有 ≥2 integration tests | ✅ | internal start/cancel 双路径在 F1/F2 时至少各有一条 test |

### 5.2 跨 phase 发现的盲点与断点

#### B1. executor recheck seam 的"wiring gap"（F4 → F5）

- **盲点**：F4 action-plan 的语言（"让 legality 收束为真实 policy layer""no-escalation 已真实 enforce"）与 F4 closure 的 exit criteria 表写着"no-escalation internal guard 已真实 enforce ✅"——但 checker 的证据只验证了 `internal-policy.ts` 的 header/body 校验，没有验证 executor 层有 runtime wiring。
- **断点**：F5 handoff 的"Open items deliberately carried forward"表中没有列出"executor recheck seam runtime wiring"。下一阶段的作者会自然假设这个 seam 已经 wired（因为 F4 closure 说 enforcement 已 live），从而可能在生产中意外漏掉 capability 执行的 legality 层。
- **判定**：这是一个需要在 handoff 中诚实回复的跨阶段 misalignment。不是"F4 没完成"，而是"F4 完成的粒度被 closure 写得更厚了"。

#### B2. `agent-core` 的 probe marker 仍在讲旧的 worker-matrix 叙事（F3/F5）

- **盲点**：agent-core 的 probe 返回 `phase: "worker-matrix-P2-live-loop"`，这在 orchestration-facade 闭合后是一个 misdirecting 信息。任何通过 probe 了解系统状态的 observer 会认为 agent-core 还处于 worker-matrix 阶段。
- **为什么未被 F3 或 F5 发现**：F3 和 F5 的 action-plan 各自的"影响目录树"中都只计划更新 orchestrator-core 的 probe marker。对其他 worker 的 marker bump 没有被列为任何 phase 的 in-scope 工作项。
- **判定**：不是 correctness bug，但是阶段级 visibility gap。Opus 在 review 中也提出了这一点，但未被执行。

#### B3. cross-e2e 迁移覆盖面的文档一致性问题（F3）

- **盲点**：F3 工作日志和 closure 声称 affected cross-e2e（02-09）已全部迁移。但实际上 02-04、07、08 和 09 在这些阶段中受到了不同的影响程度——有些是 full migration（切入口），有些是 partial（保持 cross worker 语义但调整了 entry）。F3 closure 的 compact 风格将所有这些都归为"已迁移"，但迁移的具体形式（full entry switch vs URL-only switch vs logic restructuring）没有被区分。
- **判定**：不是事实错误，但 closure 的聚合方式有损细节。F5 final closure 可以接受这种聚合（它理应只写"结论"），但 F3 的 per-phase closure 如果能提供更细粒度的迁移分类（全量迁移/入口切换/保留升级），会让 audit trail 更强。

#### B4. orchestration-facade 的 lifecycle 穿透了 smind-contexter 的 `core/jwt.ts` 设计链（F0～F4）

- **控制点**：contexter absorption inventory 中 JWT 的 label 从 `adopt-as-is` 变成了实际执行的 `full reimplementation`（上一次 F0-F2 review 的 R4）。F3/F4/F5 没有修改 auth.ts 的 JWT 核心逻辑，所以这条 gap 跨越了整个 orchestration-facade 阶段，至今未在 closure 中被交代。
- **建议**：在 handoff 的 input pack 中注明：`orchestrator-core/src/auth.ts` 的 JWT 实现是独立重写（与 contexter 的 `core/jwt.ts` 无代码级别继承关系），下一阶段若 contexter jwt 有 bug fix 不会自动进入 orchestrator。

#### B5. `internal-policy.ts` 与 `policy/authority.ts` 的命名空间与职责分区

- **审视**：F4 创造了两个"policy"文件：
  - `workers/orchestrator-core/src/policy/authority.ts` — 33 行，提供 `jsonPolicyError`、`readTraceUuid`、`ensureConfiguredTeam`、`isUuid`。
  - `workers/agent-core/src/host/internal-policy.ts` — 252 行，提供完整的 internal authority validation chain。
- 这两个文件之间没有任何 import 共享或 interface 共享——它们是各自独立的 policy 实现，只是概念上属于"同一 law layer"。
- **为什么不健康**：如果未来的 developer 需要在这两个 worker 之间共享一个 authority helper（如 `isUuid` 或 `normalizeAuthority`），目前需要在两个代码库之间手动保持同步。F4 曾被设计为"集中化 policy helper"，但实际上形成了两个独立但重复的 policy surface。
- **判定**：跨 package 的设计 debt。当前影响不大（两个 worker 各自独立），但应在下一阶段首次扩展 policy 时关注提取公共 policy 包的机会。

#### B6. stream relay 的 snapshot reality 已在 F5 final closure 中被诚实标注，但 F2/F3 的历史 closure 仍保留夸张措辞

- **事实**：
  - F5 final closure §4："richer live push stream（当前 `/internal/stream` 仍是 snapshot-over-NDJSON relay）"——诚实。
  - F1 closure §1："系统第一次拥有了 façade-owned public start path 与 guarded internal runtime seam"——不涉及 relay 措辞，可接受。
  - F2 closure §1："orchestrator-core 现在不再只是能 start 一次的 façade，而是 first-wave 的完整 session owner"——在 F5 的 final closure 语境下，这个措辞被"snapshot relay"的限制收口，可接受。
  - F3 closure 没有提及 relay 限制。
- **判定**：F0-F2 review 的 R1 要求 F1/F2 closure 追加已知限制声明。F1/F2 closure 文件截至本次审查仍未追加该声明（分别查看 F1-closure.md 和 F2-closure.md 的内容，未发现新增的"已知限制"章节），但 F5 final closure 和 handoff 已承担了这个职责。从一个"聚合真相"的角度看，F5 final closure 就是下游应读取的唯一 document of truth，所以上游 closure 的不完全更新不是 blocker。但 review record 应注明：F1/F2 closure 的 R1 follow-up action 未被显式执行。

### 5.3 跨 package 一致性判断

| 跨 package 维度 | 当前状态 | 一致性 |
|---|---|---|
| TEAM_UUID 配置 | 5 worker 的 wrangler.jsonc 全部显式配置 `"nano-agent"` | 一致 |
| internal binding secret | orchestrator-core（sender）与 agent-core（receiver）共享同一 `NANO_INTERNAL_BINDING_SECRET` env 约定 | 一致 |
| authority pass convention | orchestrator → `x-nano-internal-authority` header + body `authority`；agent ← 校验两者一致 | 一致 |
| trace UUID convention | orchestrator 强制 public ingress 提供 `x-trace-uuid`，internal 转发时直传 | 一致 |
| probe marker truth | 跨 worker 不一致——见 R3 | 不一致 |
| live test entry pattern | package-e2e 以 orchestrator-core 为入口，cross-e2e 以 orchestrator-core 启动 session | 一致 |

### 5.4 事实/逻辑错误的逐条核对

| 声称 | 所在位置 | 核实结果 |
|---|---|---|
| "F4 closure 已明确 F4.A 完成" | `F4-closure.md` §4 exit criteria 表 | ✅ F4.A 的 law layer（header）完成；executor seam 存在但未 wiring（见 R1） |
| "live package-e2e 已持续证明 façade route family" | `orchestration-facade-final-closure.md` criterion 2 | ✅ 7 条 routes 均有 live evidence |
| "TEAM_UUID 已在 5 个 worker 的 preview vars 中显式配置" | `orchestration-facade-final-closure.md` criterion 3 | ✅ 已验证 5 个 wrangler.jsonc |
| "agent-core legacy session 7 个 action 返回 410" | `F3-closure.md` §2 | ✅ 已验证包含 `end` action（之前的 review 中没有 `end`，F3 补上了） |
| "35/35 package-e2e" | `F4-closure.md` §3.2 | ✅ 与执行日志一致 |
| "47/47 cross-e2e" | `F5-closure.md` §3 | ✅ 与执行日志一致 |

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**：**F3/F4/F5 整体通过，orchestration-facade 阶段的闭合事实在 F5 final closure/handoff 上已达到"可被下游消费"的最低标准。R1（executor recheck wiring gap）和 R3（跨 worker marker 不一致）是阶段闭合后应在 near-term 修补的 unfinished items，不应回头推翻 F3/F4/F5 closure。**
- **是否允许关闭本轮 review**：`yes`（本轮审查完成）
- **关闭前必须完成的 blocker**：
  1. **B1**: 在 `F4-closure.md` 的 exit criteria 表中修正 S15 的描述：将"no-escalation internal guard 已真实 enforce"改为"no-escalation header-level enforcement ✅；executor recheck seam exists and is tested ✅；runtime wiring of executor seam is a near-term operational follow-up ⚠️"。
  2. **B2**: 在 `docs/handoff/orchestration-facade-to-next-phase.md` 的 §3 "Open items deliberately carried forward" 表中新增一行："executor recheck seam runtime wiring — `beforeCapabilityExecute()` seam exists and fail-closed test covers it, but it has not been wired into agent-core's executor construction; wiring it is a high-priority follow-up for the next charter's authority task"。
- **可以后续跟进的 non-blocking follow-up**：
  1. **F1**: 将 agent-core probe marker 更新为 `orchestration-facade-closed`（或等价的 runtime-host 变体）。
  2. **F2**: 为 `deriveCanonicalUrl()` 增加 env var fallback（`CANONICAL_ORCHESTRATOR_URL`）。
  3. **F3**: 统一 `internal-policy.ts` 中 body authority 的来源为单一的 `authority` 字段名，移除 `auth_snapshot` 作为 body-level fallback。
  4. **F4**: 在 contexter absorption inventory 中将 `core/jwt.ts` 的 label 修正为 `adapt-pattern (reimplemented)`。
  5. **F5**: 在 F1/F2 closure 中追加"已知限制"章节（如 F0-F2 review R1 所要求），或至少在其中加入指向 F5 final closure 的交叉引用。
  6. **F6**: 考虑在下一阶段启动时将 `policy/authority.ts`（orchestrator）与 `internal-policy.ts`（agent）的共享 helper（`isUuid`、`jsonResponse`、tenant normalization 等）提取为公共包，消除跨 worker 的 policy code duplication。

---

## 8. 对 DeepSeek 代码审查质量的评价

> 评价人: `GPT-5.4`
> 评价时间: `2026-04-24`
> 评价依据: `workers/bash-core/src/{executor,worker-runtime}.ts`, `workers/agent-core/src/index.ts`, `workers/agent-core/test/smoke.test.ts`, `workers/agent-core/wrangler.jsonc`, `docs/issue/orchestration-facade/{F4-closure,orchestration-facade-final-closure}.md`

### 8.1 一句话评价
DeepSeek 这轮偏向“阶段闭合一致性审查”，擅长从 closure 口径与 probe truth 里挑出明显不一致之处，但对 internal authority 语义的判断略有过度保守，把部分 first-wave 设计选择误判成了 correctness 缺口。

### 8.2 优点
1. R1 与 R2 都抓到了真实问题：executor seam 当时确实只存在于 class API，没有进 bash-core production path；canonical redirect 也确实脆弱。
2. 对 probe marker 与 handoff wording 很敏感，能及时指出“阶段已经 closed，但对外 probe 还在讲旧故事”的认知漂移。

### 8.3 事实确认 - 审核文档中，所有真实存在的问题
1. R1 成立：这轮已经把 `workers/bash-core/src/worker-runtime.ts` 接回 `CapabilityExecutor`，让 executor seam 真正进入 request/cancel 主路径。
2. R2 成立：`deriveCanonicalUrl()` 现已优先读取 `ORCHESTRATOR_PUBLIC_BASE_URL`，不再纯靠 hostname 替换。
3. R3 部分成立：agent-core 的 marker 原先确实滞后；本轮已翻到 `orchestration-facade-closed` 并同步 smoke/README/package-e2e。

### 8.4 事实错误 - 审核文档中，所有的事实错误
1. R4 不成立：internal ingress 的 authoritative source 一直是 header authority；body authority 在 first-wave 里本来就是“若存在则 cross-check”的 optional companion，不存在独立的“静默 pass 越权 body” bug。
2. R5 不成立：`cross-e2e/01` 与 `10` 保持 inventory / concurrency probe 本来就是 F3 cutover 的设计结果，不属于迁移遗漏。

---
以上内容均不局限于只有2个，如果多个请一一列举。
---

### 8.5 评分 - 总体 **3.8 / 5**

| 维度 | 评分（1–5） | 说明 |
|------|-------------|------|
| 证据链完整度 | 4 | 关键 finding 有文件锚点，但部分 negative interpretation 没有充分贴合 first-wave 语义。 |
| 判断严谨性 | 3 | R1/R2 很准，R4/R5 则把可选设计选择误读成了真实 bug。 |
| 修法建议可执行性 | 4 | 对 canonical URL、marker、closure wording 的建议都容易落地。 |
| 对 action-plan / design 的忠实度 | 4 | 对闭合与 handoff 一致性比较敏感，但对 internal law 的 frozen 边界掌握略弱。 |
| 协作友好度 | 4 | 结论清晰，follow-up 导向明确。 |
