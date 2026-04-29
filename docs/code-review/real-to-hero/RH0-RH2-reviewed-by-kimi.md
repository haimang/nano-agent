# Nano-Agent 代码审查 — RH0~RH2 完整审查

> 审查对象: `real-to-hero / RH0 + RH1 + RH2`
> 审查类型: `mixed (code-review + closure-review + cross-phase audit)`
> 审查时间: `2026-04-29`
> 审查人: `kimi (k2p6)`
> 审查范围:
> - `docs/charter/plan-real-to-hero.md` r2
> - `docs/action-plan/real-to-hero/RH{0,1,2}-*.md`
> - `docs/issue/real-to-hero/RH{0,1,2}-{closure,evidence}.md`
> - 实际代码: `workers/{agent-core,orchestrator-core,orchestrator-auth,context-core}/**`
> - 实际测试: 全矩阵 1551 case 本地复跑
> 对照真相:
> - `docs/charter/plan-real-to-hero.md` §7.1/7.2/7.3 + §8.3/8.4 + §9.2 + §10.3
> - 各 action-plan 的收口标准与 DoD
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**: RH0~RH2 主体工程成立，代码与文档口径基本一致，测试矩阵健康（1551 case 全绿），preview deploy 成功。但存在**硬 gate 未完全满足**、**文档与事实口径漂移**、以及**跨阶段关键断点**需正视。
- **结论等级**: `approve-with-followups`
- **是否允许关闭本轮 review**: **yes** — 但需在 RH3 启动前修正以下 blocker 或显式 carry-over
- **本轮最关键的 1-3 个判断**:
  1. `pnpm check:cycles` 未通过（10 cycle），action-plan 自定的 hard gate 事实上未满足；closure 虽修正口径为 "host/do/ 0 cycle"，但 charter/action-plan 文本中的 gate 定义未同步更新，存在文档-事实漂移。
  2. RH1 的 cross-worker WS push 拓扑已 wire 完整，但因 NanoSessionDO 未持有 `user_uuid`，`pushServerFrameToClient` 当前只能返回 `delivered:false` — 这是 RH1→RH3 的关键衔接断点，closure 已诚实标注，但 action-plan 中 "cross-worker frame 投递 ≥1 次成功" 的收口标准在当前事实上无法验证。
  3. RH2 context endpoint tests 仅 9 case，未达 action-plan 承诺的 15 case（5×3）；且 P2-08 schema 校验在 RH1 entrypoint.ts 中缺失，跨阶段补到 RH2 user-do.ts，存在责任归属漂移。

---

## 1. 审查方法与已核实事实

- **对照文档**:
  - `docs/charter/plan-real-to-hero.md` r2 §7.1/7.2/7.3 + §8.3/8.4/9.2/10.3
  - `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md`
  - `docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md`
  - `docs/action-plan/real-to-hero/RH2-models-context-inspection.md`
  - `docs/issue/real-to-hero/RH{0,1,2}-closure.md`
  - `docs/issue/real-to-hero/RH{1,2}-evidence.md`
- **核查实现**:
  - `workers/agent-core/src/host/do/nano-session-do.ts` (1488 行)
  - `workers/agent-core/src/host/do/session-do-verify.ts` (367 行)
  - `workers/agent-core/src/host/do/session-do-persistence.ts` (370 行)
  - `workers/agent-core/src/kernel/scheduler.ts` + `test/kernel/scheduler.test.ts`
  - `workers/agent-core/src/host/runtime-mainline.ts` + `test/host/runtime-mainline.test.ts`
  - `workers/orchestrator-core/src/entrypoint.ts`
  - `workers/orchestrator-core/src/user-do.ts` (emitServerFrame + __forward-frame)
  - `workers/orchestrator-core/src/index.ts` (handleModelsList + context routes)
  - `workers/orchestrator-core/src/frame-compat.ts`
  - `workers/orchestrator-core/migrations/008-models.sql`
  - `workers/context-core/src/index.ts` (3 RPC methods)
  - `workers/orchestrator-core/test/{models,context,usage-strict-snapshot}-route.test.ts`
  - `workers/orchestrator-auth/test/bootstrap-hardening.test.ts`
  - `packages/nacp-session/src/messages.ts` (session.attachment.superseded)
- **执行过的验证**:
  - `pnpm --filter @haimang/jwt-shared test` → 20 passed ✅
  - `pnpm --filter @haimang/orchestrator-core-worker test` → 132 passed ✅
  - `pnpm --filter @haimang/orchestrator-auth-worker test` → 16 passed ✅
  - `pnpm --filter @haimang/agent-core-worker test` → 1062 passed ✅
  - `pnpm --filter @haimang/nacp-session test` → 150 passed ✅
  - `pnpm --filter @haimang/context-core-worker test` → 171 passed ✅
  - `pnpm check:cycles` → **10 circular dependencies, exit code 1** ❌
  - `pnpm install --frozen-lockfile` → passed ✅
- **复用 / 对照的既有审查**:
  - GPT-5.4 对 RH0 closure 的 6 项 finding — 仅作为线索核对，所有结论均独立复现

### 1.1 已确认的正面事实

- `pnpm-lock.yaml` 已重建，jwt-shared importer 存在，6 stale importer 已删除；`pnpm install --frozen-lockfile` 通过。
- `@haimang/jwt-shared` build/typecheck/test 全绿（20 case）。
- 6 worker `wrangler.jsonc` 已声明 `NANO_KV` + `NANO_R2` binding（dev + preview）。
- NanoSessionDO 主文件 2078 → **1488 行**（charter §7.1 ≤1500 hard gate 通过）。
- `session-do-verify.ts`（367 行）+ `session-do-persistence.ts`（370 行）无 import cycle；`host/do/` 子树 0 cycle。
- 7 份 `*-route.test.ts` 存在，共 35 case 全绿。
- `bootstrap-hardening.test.ts` 3 case 存在且通过。
- 6 worker preview deploy 成功，`/debug/workers/health` 返回 `live: 6, total: 6`。
- scheduler.ts Priority 3.5 新增 `hook_emit` drain；4 个 RH1-new test case 全绿。
- runtime-mainline.ts `hook.emit` 改为 dispatcher delegate；2 个 RH1-new test case 全绿。
- agent-core wrangler.jsonc 新增 `ORCHESTRATOR_CORE` service binding。
- orchestrator-core 新建 `entrypoint.ts`，`OrchestratorCoreEntrypoint` 暴露 `forwardServerFrameToClient` RPC。
- user-do.ts 新增 `__forward-frame` 内部路由，调用 `emitServerFrame`。
- NanoSessionDO `pushServerFrameToClient` 通过 ORCHESTRATOR_CORE binding 调 RPC。
- `onUsageCommit` 保留 console.log 同时调用 `pushServerFrameToClient`。
- `handleUsage` no-rows 返回 zero-shape；D1 fail 返回 503 facade error；3 case 全绿。
- `migration 008-models.sql` 存在（nano_models + nano_team_model_policy + 2-row seed）。
- `GET /models` 实现 D1 query + per-team policy filter + ETag + 304；5 case 全绿。
- context-core 新增 3 RPC method（getContextSnapshot / triggerContextSnapshot / triggerCompact）。
- 3 个 context endpoint 通过 CONTEXT_CORE binding 调用；9 case 全绿。
- `emitServerFrame` 调用 `validateLightweightServerFrame` 做 schema gate（RH2 P2-08）。
- runtime-mainline 在 tool 执行前后 emit `onToolEvent`（tool_use_start / tool_call_result）。
- NanoSessionDO 映射 onToolEvent → `pushServerFrameToClient`（llm.delta / tool.call.result）。
- NACP schema 新增 `session.attachment.superseded` + 4 个 registry entry + type-direction-matrix。
- root `package.json` 已添加 `"test": "pnpm -r --workspace-concurrency=1 --if-present test"`。
- 全矩阵 1551 case 本地复跑全绿。

### 1.2 已确认的负面事实

- `pnpm check:cycles` 输出 **10 个 circular dependencies**（非 0），命令 exit code 1。10 cycle 分布在 packages/ 与 context-core/，非 host/do/ 子树引入。
- `bootstrap-hardening.test.ts` 使用 `InMemoryAuthRepository`（非 miniflare/D1），D1 慢响应用 5ms（非 5s），refresh storm 是顺序 50 代（非并发）。
- 7 份 route tests 的断言面与 action-plan 承诺的行为面存在偏离（详见 §2 R3）。
- RH2 context-route.test.ts 仅 9 case，未达 action-plan 承诺的 15 case（5×3）。
- RH1 entrypoint.ts 中 `forwardServerFrameToClient` 未调用 `validateSessionFrame` 做 schema 校验（action-plan P1-06b 承诺）。schema gate 在 RH2 user-do.ts emitServerFrame 中补做。
- NanoSessionDO 未持有 `user_uuid`（从 env.USER_UUID 读取，该字段在 IngressAuthSnapshot 中尚未落地），`pushServerFrameToClient` 当前只能返回 `delivered:false, reason:'no-user-uuid-for-routing'`。
- `me-devices-route.test.ts` 中 "revoked device is included" test 显式锁定当前行为：D1 查询无 `status='active'` filter，revoked device 仍返回列表。
- RH2 P2-14/P2-15 client adapter 仅 audit-only，无真实 UI 升级。
- RH2 P2-17 WS lifecycle e2e 4 scenario 未完整实现，deferred 到 RH3+。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 所有关键文件均已逐行阅读；行号以 2026-04-29 main 为准 |
| 本地命令 / 测试 | yes | 6 个测试套件 + pnpm check:cycles + pnpm install 全部本地复跑 |
| schema / contract 反向校验 | yes | migration 008、NACP schema registry、frame-compat 映射均反向核对 |
| live / deploy / preview 证据 | yes | closure 中的 Version ID 与 URL 已记录；本地无法复现 preview 但凭据链完整 |
| 与上游 design / QNA 对账 | yes | charter r2 §7.1/7.2/7.3 与各 action-plan 的 hard gate 逐项核对 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | `pnpm check:cycles` hard gate 未满足 | high | test-gap | no | 修正 action-plan/charter 中 cycle gate 的口径，或 RH6 前 enforce 0 cycle |
| R2 | bootstrap-hardening 测试强度低于承诺 | medium | test-gap | no | 在 RH3+ 补 miniflare-based stress test，或显式降级 action-plan 口径 |
| R3 | endpoint tests 覆盖偏离 action-plan 行为面 | medium | test-gap | no | RH3 按 action-plan 原承诺补全行为面测试，或显式修正 action-plan |
| R4 | RH2 context endpoint tests 数量不足 | medium | test-gap | no | 补 snapshot/compact 各 3 case，达到每 endpoint ≥5 |
| R5 | RH1 entrypoint.ts 缺少 schema 校验 | medium | protocol-drift | no | 已在 RH2 user-do.ts 补做；建议在 RH3 文档中明确责任归属 |
| R6 | cross-worker push 无法真投递（缺 user_uuid） | high | delivery-gap | **yes** | RH3 D6 必须落地 IngressAuthSnapshot.user_uuid 进入 NanoSessionDO |
| R7 | 大量 "live" 能力实为 wire-only，依赖 RH3 | medium | scope-drift | no | closure 已诚实标注 carry-over，但 action-plan 收口标准应区分 "wire live" vs "e2e live" |
| R8 | RH0 preview smoke 非业务流 smoke | low | docs-gap | no | 修正 post-fix-verification.md 或 action-plan 口径 |

### R1. `pnpm check:cycles` hard gate 未满足

- **严重级别**: `high`
- **类型**: `test-gap`
- **是否 blocker**: `no`（因 closure 已修正口径，但 action-plan 未同步）
- **事实依据**:
  - `pnpm check:cycles` 输出 10 cycle: `packages/nacp-core/src/envelope.ts > type-direction-matrix.ts` 等
  - RH0 action-plan §4.5/§5.5/§8.1 均把 `pnpm check:cycles 0 cycle` 列为收口标准
  - RH0 closure §2 硬 gate 表中写 `host/do/ 0 cycle ✅`，但 action-plan 原文写 "0 cycle baseline"（未限定 host/do/）
  - GPT 审查 F1 已发现此问题；closure r2 修正口径为 "host/do/ 0 cycle + RH0 引入 0 个新 cycle"
- **为什么重要**: action-plan 与 closure 的口径不一致会导致后续 reviewer 误以为 cycle gate 已满足；RH6 完整拆分前若新增 cycle 无 baseline 对比，会难以识别。
- **审查判断**: closure 的修正口径（"host/do/ 0 cycle + 不引入新 cycle"）是合理的工程妥协，但 action-plan 正文和 charter §7.1 未同步更新，存在文档级漂移。
- **建议修法**: 
  1. 在 RH0 action-plan §8.2 和 charter §7.1 中显式将 cycle gate 改为 "host/do/ 子树 0 cycle + 全仓不新增 cycle"
  2. RH6 完整拆分前，每次 PR 必须跑 `pnpm check:cycles` 并对比 baseline（10 cycle），确保不新增

### R2. bootstrap-hardening 测试强度低于 action-plan 承诺

- **严重级别**: `medium`
- **类型**: `test-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - action-plan §4.6 承诺: "cold-start 并发 100 register + D1 慢响应 5s + refresh 旋转风暴"
  - 实际 `bootstrap-hardening.test.ts:37-158`: 使用 `InMemoryAuthRepository`（非 miniflare/D1）
  - 实际 case 2 (`test.ts:221-249`): `latencyMs = 5`（5ms，非 5s）
  - 实际 case 3 (`test.ts:253-297`): 顺序 50 代 refresh（非并发 storm）
  - GPT 审查 F2 已发现；closure 修正口径为 "unit-level invariants"
- **为什么重要**: 该测试被 charter §7.1 列为 hard gate，若强度不足则无法发现 cold-start race 或 D1 latency spike 下的真实问题。
- **审查判断**: InMemory 替代和 5ms 替代是 vitest 限制下的工程现实，但 action-plan 和 closure 的口径应一致。当前 closure 的修正口径（"unit-level invariants"）可接受。
- **建议修法**: 
  1. action-plan §4.6 和 §5.6 同步为 closure 的 "unit-level invariants" 口径
  2. 在 RH3+ 新增 miniflare-based integration stress test（标注为 RH1 carry-over）

### R3. endpoint tests 覆盖偏离 action-plan 承诺的行为面

- **严重级别**: `medium`
- **类型**: `test-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `messages-route.test.ts`: action-plan 承诺测 `403 wrong device / 400 invalid kind / 404 unknown session`，实际测 `403 missing-team-claim / 400 empty body / 404 unknown sub-route`
  - `files-route.test.ts`: action-plan 承诺测 `cross-team 403`，实际未断言 403
  - `me-conversations-route.test.ts`: action-plan 承诺测 `cursor 翻页 / 末页 next_cursor=null`，实际只测 `limit` 解析
  - `me-devices-route.test.ts`: action-plan 承诺测 "已 revoke 的不出现"，实际测试显式锁定 "revoked device is included"
  - `permission-decision-route.test.ts`: action-plan 承诺测 `unknown request_uuid / 已答复或超时`，实际测 `empty body / unknown sub-action`
  - GPT 审查 F3 已发现；closure 登记 carry-over 到 RH3+
- **为什么重要**: "endpoint-level 直达测试 ≥5 case" 是 charter §9.2 的硬纪律，其目的是防 DS R1 needsBody silent-drop 类回归。若测试仅覆盖 façade routing 而非行为面，则无法捕获真实行为回归。
- **审查判断**: 35 case 的数量 gate 已满足，但质量 gate（覆盖 action-plan 承诺的行为面）未满足。这是 "测了数量，没测到点"。
- **建议修法**: 
  1. RH3 按 action-plan 原承诺补全行为面测试
  2. 若某些行为面因前置条件未满足（如 device-revoke gate 未实装），在测试中显式 TODO 注释，不掩盖未实装事实

### R4. RH2 context endpoint tests 数量不足

- **严重级别**: `medium`
- **类型**: `test-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - action-plan §4.3 / §8.2 承诺: "3 个 context endpoint 各 ≥5 case = 15 case"
  - 实际 `context-route.test.ts`: 5 case (GET) + 2 case (snapshot) + 2 case (compact) = **9 case**
  - RH2 closure §2 硬 gate 表写 "15 case" 目标但实测 "9"，verdict 为 ✅，理由是 "符合 charter §7.1 '≥35 case 总线'约束"
  - 但 charter §9.2 明确: "每个新增 public endpoint ≥5 endpoint-level 用例"
- **为什么重要**: charter §9.2 是各 Phase DoD 引用的 single source，不应被 "总线约束" 替代。3 个 endpoint 中 2 个未达到 ≥5。
- **审查判断**: 这是 charter 硬纪律与 closure 灵活解释之间的冲突。snapshot 和 compact 各仅 2 case，明显低于 5。
- **建议修法**: 
  1. 补 snapshot-route test 和 compact-route test 各 3 case，达到每 endpoint ≥5
  2. 或在 closure 中显式说明 "snapshot/compact 因 stub-shaped 实现，测试降级为 2 case"，并获 owner 批准

### R5. RH1 entrypoint.ts 缺少 schema 校验

- **严重级别**: `medium`
- **类型**: `protocol-drift`
- **是否 blocker**: `no`
- **事实依据**:
  - action-plan P1-06b 承诺: "`validateSessionFrame(frame)` schema 校验失败 → reject"
  - 实际 `entrypoint.ts:41-93`: 仅检查 `sessionUuid` UUID 格式、`frame.kind` string 类型、`meta.userUuid` 存在性，**未调用 validateSessionFrame**
  - RH2 P2-08 在 `user-do.ts:1238` 补做 `validateLightweightServerFrame`（在 `emitServerFrame` send 前调用）
- **为什么重要**: 跨 worker RPC 入口的 schema 校验是第一道防线；若 entrypoint 不校验，非法 frame 可能穿透到 User DO 内部。
- **审查判断**: RH2 的补救措施（在 emitServerFrame 中校验）在功能上等价，但责任归属从 RH1 P1-06b 漂移到 RH2 P2-08，应在文档中明确。
- **建议修法**: 
  1. 在 RH1 action-plan §9.2 中追加注释："schema 校验在 RH2 P2-08 补做，因 validateSessionFrame 库在 RH1 时未暴露 lightweight 兼容接口"
  2. 或考虑在 entrypoint.ts 中前置轻量校验（仅 kind 白名单检查）

### R6. cross-worker push 无法真投递（缺 user_uuid）

- **严重级别**: `high`
- **类型**: `delivery-gap`
- **是否 blocker**: **yes**（对 "Lane F live runtime 成立"而言）
- **事实依据**:
  - `nano-session-do.ts:751`: `const userUuid = (this.env as { USER_UUID?: string })?.USER_UUID;`
  - `nano-session-do.ts:752-755`: `if (!userUuid) return { ok: false, delivered: false, reason: "no-user-uuid-for-routing" };`
  - RH1 closure §3 明确: "wire 完整，缺 user_uuid 解析"
  - RH1 evidence §2 Link 2: "`pushServerFrameToClient` 返 `{delivered:false, reason:'no-user-uuid-for-routing'}`"
  - RH1 action-plan §4.3 收口标准: "cross-worker frame 投递 ≥1 次成功"
- **为什么重要**: 这是 Lane F 4 链全通的核心路径。若 permission/usage/elicitation frame 无法真投递到 client，则 "live runtime 成立"不真正成立。
- **审查判断**: 这是预期中的 best-effort 降级行为，不破坏现有功能（不影响 session loop）。但 "live runtime 成立"的收口标准在当前事实上未满足。
- **建议修法**: 
  1. **RH3 D6 必须优先落地**：把 `user_uuid` 写进 `IngressAuthSnapshot`，让 NanoSessionDO 在 create/attach 时持有
  2. RH1 closure 收口标准应改为: "wire 完整 + best-effort skip 行为正确"，而非 "frame 投递 ≥1 次成功"

### R7. 大量 "live" 能力实为 wire-only，依赖 RH3

- **严重级别**: `medium`
- **类型**: `scope-drift`
- **是否 blocker**: `no`
- **事实依据**:
  - RH1 closure 声称 "4 链 live"，但实际:
    - permission round-trip: 单元覆盖 wire，真 e2e 待 RH3 D6
    - elicitation round-trip: 同上
    - usage push: 同上
    - HookDispatcher 实例: seam 就位，注入 deferred
  - RH2 closure 声称 "WS NACP frame upgrade"，但实际:
    - handshake 仍 lightweight
    - heartbeat alarm + 4 lifecycle scenario deferred
    - client → server 4 类消息 ingress unit test 待补
- **为什么重要**: "wire live" 与 "e2e live" 的混淆会导致下游 Phase（RH3/RH4）在错误前提下施工，或在阶段收口时误判完成度。
- **审查判断**: closure 已诚实标注 carry-over，但 action-plan 收口标准中的措辞（如 "live"、"e2e 通过"）应更严格区分 "wire" vs "end-to-end"。
- **建议修法**: 
  1. 在 charter §9.5 evidence 三层定义中新增一层："Tier-0: wire contract test"（单元/合同测试覆盖）
  2. 各 closure 的 "live" 声明前必须加限定词："wire-live" vs "e2e-live" vs "preview-live"

### R8. RH0 preview smoke 非业务流 smoke

- **严重级别**: `low`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - action-plan §4.7 承诺: "跑 5-10 个手动 smoke：register → start session → message text → list me/sessions → revoke device → re-register"
  - 实际 `docs/issue/zero-to-real/post-fix-verification.md`: 记录 `/` 探针、`/catalog/skills`、`/debug/workers/health`、binding visibility、RPC reachability
  - RH0 closure §6 F4 声称已补做 "7-step 真实业务流"，但 evidence 文档中无详细 curl log 或截图
- **为什么重要**: preview smoke 的目的是验证产品路径真实走通，而非仅验证服务存活。
- **审查判断**: 这是文档归档不完整的问题，不是运行时 blocker。但 action-plan 与 evidence 之间的一致性应修正。
- **建议修法**: 
  1. 在 post-fix-verification.md 中补录业务流 smoke 的详细 curl 命令与输出
  2. 或修正 action-plan §4.7 的口径为 "deploy/health smoke"，与 evidence 对齐

---

## 3. In-Scope 逐项对齐审核

### 3.1 RH0 In-Scope 对齐

| 编号 | 计划项 / closure claim | 审查结论 | 说明 |
|------|------------------------|----------|------|
| S1 | jwt-shared lockfile 重建 + stale importer 删除 | done | pnpm-lock.yaml 重建通过；6 stale importer 已删除 |
| S2 | jwt-shared 独立 build/typecheck/test 全绿 | done | 20 case 全绿 |
| S3 | 6 worker KV/R2 binding 占位声明 | done | wrangler.jsonc 已声明；dry-run 通过 |
| S4 | ≥7 份 endpoint route tests / ≥35 case | done | 7 文件 35 case 全绿；但质量偏离行为面（见 R3） |
| S5 | NanoSessionDO 拆 verify + persistence | done | 1488 行 ≤1500；0 cycle in host/do/ |
| S6 | bootstrap-hardening 3 case | partial | 3 case 通过但强度低于承诺（见 R2） |
| S7 | preview deploy + smoke 归档 | partial | deploy 成功；smoke 证据为 health probe 非业务流（见 R8） |
| S8 | P0-F 8 步 checklist | done | 业主已执行并归档 |

### 3.2 RH1 In-Scope 对齐

| 编号 | 计划项 / closure claim | 审查结论 | 说明 |
|------|------------------------|----------|------|
| S1 | scheduler hook_emit 决策 | done | 4 case 全绿；Priority 3.5 正确 |
| S2 | runtime-mainline dispatcher delegate | done | 2 case 全绿；no dispatcher 时 backward-compat |
| S3 | emitPermission/emitElicitation 真 emit | done | 代码已 wire；因缺 user_uuid 当前为 best-effort skip |
| S4 | cross-worker WS push RPC | done | entrypoint.ts + __forward-frame 已 deploy |
| S5 | onUsageCommit WS push | done | 代码已 wire；同 S3 为 best-effort skip |
| S6 | handleUsage strict snapshot no-null | done | 3 case 全绿；zero-shape + 503 区分正确 |
| S7 | 4 链 cross-worker e2e | partial | 单元覆盖 wire；真 e2e 待 RH3 D6（见 R6/R7） |
| S8 | preview smoke + evidence | done | evidence.md 已归档；health + usage zero-shape verified |

### 3.3 RH2 In-Scope 对齐

| 编号 | 计划项 / closure claim | 审查结论 | 说明 |
|------|------------------------|----------|------|
| S1 | NACP schema session.attachment.superseded | done | 4 registry + matrix entry + frame-compat 映射 |
| S2 | migration 008-models.sql | done | 文件存在；未 apply 到 preview D1（owner-action carry-over） |
| S3 | GET /models endpoint | done | D1 query + policy filter + ETag + 304；5 case 全绿 |
| S4 | 3 个 context endpoint | done | stub-shaped；cross-worker RPC 真实可达 |
| S5 | emitServerFrame schema gate | done | validateLightweightServerFrame 在 send 前调用 |
| S6 | WS lifecycle hardening 4 scenario | partial | scheme 就位；DO alarm + 4 case deferred（见 R7） |
| S7 | tool semantic streaming | done | onToolEvent → pushServerFrameToClient 已 wire |
| S8 | client adapter 升级 | partial | audit-only；UI 升级 deferred（见 R7） |
| S9 | LLM delta policy doc | done | docs/api/llm-delta-policy.md 已落档 |
| S10 | endpoint tests ≥5×4 | partial | models 5 ✅；context 仅 9（目标 15，见 R4） |

### 3.4 对齐结论

- **done**: 22 项
- **partial**: 7 项
- **missing**: 0 项
- **stale**: 0 项
- **out-of-scope-by-design**: 0 项

> 用一到两句话总结：RH0~RH2 更像 "核心 wire 与基础设施完成，但 e2e live 验证和测试质量 gate 仍有缺口"。不应标记为 "所有 hard gate 严格满足"，而应标记为 "wire-complete with known gaps"。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | RH0 不做 Lane F wiring | 遵守 | 无 RH0 代码触及 scheduler/hook/permission |
| O2 | RH0 不做 NanoSessionDO 完整拆分 | 遵守 | 仅拆 verify+persistence，剩余 deferred 到 RH6 |
| O3 | RH1 不做 token-level streaming | 遵守 | 明确 out-of-scope，符合 charter §4.2 O1 |
| O4 | RH1 不做新 public endpoint | 遵守 | 仅内部 RPC + HTTP fix |
| O5 | RH2 不做 13+4+8 全模型 | 遵守 | 仅 2-row seed，RH5 扩展 |
| O6 | RH2 不做 image_url 真实执行 | 遵守 | 仅 schema 准备，RH4/RH5 真实化 |
| O7 | RH2 不做 WS lightweight 切断 | 遵守 | 保留兼容路径 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**: RH0~RH2 主体工程成立，代码基线稳定，测试矩阵 1551 case 全绿，preview deploy 成功。但存在 **1 个 high blocker（R6: cross-worker push 缺 user_uuid 导致无法真投递）** 和 **3 个 medium 缺口（R1 cycle gate、R3 test 质量、R4 test 数量）**。closure 已诚实标注大部分 carry-over，但 action-plan 与 charter 中的硬 gate 定义未完全同步修正。
- **是否允许关闭本轮 review**: **yes** — 在以下条件下：
  1. RH3 action-plan 必须显式继承 R6 作为首项 blocker（IngressAuthSnapshot.user_uuid 进入 NanoSessionDO）
  2. RH3 前修正 action-plan/charter 中 R1/R2/R3 的口径
  3. RH3 中补 snapshot/compact 各 3 case（R4）
- **关闭前必须完成的 blocker**:
  1. **R6**: RH3 D6 必须让 NanoSessionDO 持有 user_uuid，使 cross-worker push 从 "best-effort skip" 升级为 "真投递"
- **可以后续跟进的 non-blocking follow-up**:
  1. **R1**: 在 RH6 前 enforce `pnpm check:cycles` 0 cycle（或显式接受 10 cycle baseline）
  2. **R2**: RH3+ 补 miniflare-based stress test
  3. **R3**: RH3 中按 action-plan 原承诺补全 endpoint tests 行为面
  4. **R4**: 补 context endpoint tests 至每 endpoint ≥5 case
  5. **R5**: 在 entrypoint.ts 中前置轻量 frame 校验（kind 白名单）
  6. **R8**: 补录 RH0 preview 业务流 smoke 证据
- **建议的二次审查方式**: `independent reviewer` — 建议 RH3 完成后由独立 reviewer 对 cross-worker e2e 做专项审查
- **实现者回应入口**: 请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。

> 本轮 review 可收口，但 RH3 启动前必须修正 action-plan 口径并明确 R6 为 RH3 首项 blocker。

---

## 6. 修订历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| r1 | 2026-04-29 | kimi (k2p6) | 初版审查：基于独立代码/测试/文档复核，8 项 finding（1 high blocker + 3 medium + 4 low）|

---

## 附录 A — 审查质量评估(by Opus 4.7,实施者反向评价)

> 评价对象: `Kimi (k2p6) 对 real-to-hero / RH0-RH2 三阶段的代码审查`
> 评价人: `Opus 4.7(实施者,基于 4 reviewer 整体回应中实际验证的 finding 真伪 + 修复成本)`
> 评价时间: `2026-04-29`

### A.0 评价结论

- **一句话评价**:命令证据 / 本地复跑最扎实的 reviewer(全部 6 个测试套独立复跑 + check:cycles + frozen-lockfile 全部本地验证),且唯一捕捉到 RH1 entrypoint.ts 的 schema 责任 shift 这种 protocol-drift 之外的"跨阶段责任归属漂移";verdict 平衡(approve-with-followups,但点名 1 个 high blocker)。
- **综合评分**:**8.5 / 10**
- **推荐使用场景**:对"阶段间责任归属漂移"或"测试矩阵真实性"敏感的场景;以及实施者声称"全绿"时做独立本地复跑校验。Kimi 是 4 reviewer 中最擅长做 reproducibility audit。
- **不建议单独依赖的场景**:寻找 critical 代码 fix 时,kimi 倾向于把 schema-drift 类问题归类为 medium protocol-drift 而非 critical;verdict 与 GLM 类似偏 approve,可能延迟 critical blocker 浮现。

### A.1 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | reproducibility(独立复跑)+ 责任归属漂移 + charter §9.2 命纪律 | §1.2 写 "执行过的验证" 列出所有 6 个 pnpm filter test + check:cycles + install --frozen-lockfile,4 reviewer 中独立复跑命令最完整 |
| 证据类型 | 命令实测输出 + 行号引用 + charter 章节 | R1 用 `pnpm check:cycles` 实际输出 "10 circular dependencies, exit code 1" + RH0 action-plan §4.5/§5.5/§8.1 / closure §2 三处对照 |
| Verdict 倾向 | balanced(approve-with-followups + 1 high blocker)| §0 写 "yes — 但需在 RH3 启动前修正以下 blocker 或显式 carry-over",明确 R6 是 RH3 启动 blocker |
| Finding 粒度 | balanced(8 项,severity 阶梯均匀:1 high + 3 medium + 4 low)| §2.1 finding 表 severity 阶梯清晰,无单点观察混入 |
| 修法建议风格 | actionable + 双轨(改文档 / 补测试 / 加 defense)| R5 给出 "在 RH1 action-plan §9.2 中追加注释...或考虑在 entrypoint.ts 中前置轻量校验" 二选一 |

### A.2 优点与短板

#### A.2.1 优点

1. **本地复跑最扎实** — 4 reviewer 中唯一在 §1.2 详细列出 "执行过的验证" 全部 8 条命令(6 个 pnpm filter test + check:cycles + install --frozen-lockfile)且各自给出实测输出。这是阶段闭合 reproducibility audit 的标杆 — 实施者声称的 1551 case 全绿能不能在 reviewer 自己的 sandbox 里复现?kimi 答是。
2. **唯一捕捉 R5 entrypoint.ts schema 责任 shift** — RH1 action-plan P1-06b 原文要求 "validateSessionFrame schema 校验失败 → reject",但实施者在 RH1 时只做了 sessionUuid UUID + frame.kind string + meta.userUuid 三层 lightweight check,真正 schema 校验放到了 RH2 P2-08 在 user-do.ts emitServerFrame 中补做。这种"phase 间责任漂移"是其他 reviewer 都没追到的层次 — GPT R3 关注 outbound emit 但没追 inbound RPC 入口;deepseek/GLM 都没专门看 entrypoint.ts。修复:RH1 action-plan §9.6 r2 注释显式登记责任 shift + RH3 §2.1.1 C5 吸纳轻量 kind-whitelist defense-in-depth。
3. **R4 charter §9.2 严判最直接** — kimi 写 "charter §9.2 是各 Phase DoD 引用的 single source,不应被 '总线约束' 替代。3 个 endpoint 中 2 个未达到 ≥5"。这是本轮所有 reviewer 中对 charter §9.2 ≥5/endpoint 纪律最严格的解读。GLM R10 也指出此点但措辞较温和。本轮回应直接补 6 case → 15 case 闭合此 finding,部分原因就是 kimi 与 GLM 的双重 cross-validation 让"总线约束 35"的口径站不住。

#### A.2.2 短板 / 盲区

1. **未捕捉 GPT R3 critical protocol drift** — 同 deepseek/GLM,kimi R5 指出 entrypoint 缺 schema 校验,但没下到 zod safeParse 字段级反向校验 superseded payload 与冻结 schema 不符。kimi 的 schema 视角偏"哪里没接 schema gate",没到"已接 gate 但 payload 不符"的层次。
2. **R8(RH0 preview smoke 非业务流)严重级别偏低且 finding 价值有限** — GPT F4 在 RH0 closure §6 已声明业主同日补做 7-step 业务流 smoke,evidence 已归档。kimi R8 重新提出此问题但没看到 RH0 closure §6 的 GPT 审查 carry-over,这是漏读 closure r2 的痕迹。
3. **R3 (route test 行为面漂移)+ R5 (entrypoint schema shift)的修法建议略保守** — kimi 给出 "在 RH3 按 action-plan 原承诺补全行为面测试" 是 actionable 的,但没像 deepseek R10 那样评估"RH3 还能不能装下这么多 carry-over"。kimi 的 finding 严谨但缺 cross-phase capacity 视角。

### A.3 Findings 质量清点

| 问题编号 | 原始严重程度 | 事后判定 | Finding 质量 | 分析与说明 |
|----------|--------------|----------|--------------|------------|
| R1(check:cycles 未满足)| high | true-positive | excellent | 与 deepseek R5 / GLM R8 / GPT R1 隐含 cross-validation;kimi 在 §1.2 列出独立复跑实测 "10 circular dependencies, exit code 1",证据最直接。修复:RH0 closure §4 + action-plan §5.5 口径同步。|
| R2(bootstrap 强度不足)| medium | true-positive | good | 与 GPT R2 隐含 / deepseek R6 / GLM R4 cross-validation;kimi 给出具体 fixture path "test.ts:221-249 latencyMs = 5"(精确到行号)。修复:口径降级 + RH6 carry-over。|
| R3(endpoint test 行为面漂移)| medium | true-positive | good | 与 GPT F3 / GLM R5 cross-validation;kimi 列出 6 项具体偏离(messages-route / files-route / me-conversations-route / me-devices-route / permission-decision-route / policy-permission-mode-route)。修复:RH3 §2.1.1 C7 吸纳。|
| R4(context tests 9 vs 15)| medium | true-positive | excellent | charter §9.2 严判;GLM R10 也提出但 kimi 措辞最直接 "charter §9.2 是 single source"。本轮回应直接补 6 case 至 15。修复:fixed。|
| R5(entrypoint.ts schema 责任 shift)| medium | true-positive(**missed-by-others**)| **excellent** | 4 reviewer 中唯一捕捉到 RH1 P1-06b → RH2 P2-08 的责任归属漂移;GPT R3 关注 outbound 但没追这个 inbound RPC 入口。这是 reviewer 必须把 RH1 action-plan + RH1 实施 + RH2 实施 三方对照才能产生的 finding。修复:RH1 action-plan §9.6 r2 注释 + RH3 §2.1.1 C5 吸纳轻量 kind-whitelist。|
| R6(cross-worker push 缺 user_uuid)| **high (blocker)** | true-positive(blocker)| excellent | 与 GPT R2 / deepseek R1 / GLM R2 cross-validation;kimi 是 4 reviewer 中唯一明确 verdict "yes 关闭本轮 review,但 R6 是 RH3 启动 blocker" 的 reviewer,既不像 GPT/deepseek 直接 changes-requested 阻塞收口,也不像 GLM 把它降到 follow-up — kimi 的 verdict 校准最贴近实际"RH2 工程可收口,但 RH3 必须立即解封"。修复:RH3 §2.1.1 C1 吸纳。|
| R7(wire-only vs e2e-live 措辞混淆)| medium | true-positive | good | 与 deepseek R9 / GLM R2 措辞 cross-validation;kimi 提出在 charter §9.5 evidence 三层中新增 "Tier-0: wire contract test" 一档,这个方法论建议很有前瞻性。修复:RH1/RH2 closure §0 重写时引入 wire-contract / facade-live / inspector-stub / data-live 多层措辞。|
| R8(RH0 preview smoke 非业务流)| low | partial(已被 GPT F4 闭合)| weak | RH0 closure §6 的 GPT 审查 carry-over 表中 F4 已声明业主同日补做 7-step 业务流 smoke + evidence 归档。kimi 未读到此点重新提出,显示 kimi 漏读了 RH0 closure r2 §6。但严格说 finding 本身有效,只是已闭合。|

**总计**:8 个 finding,3 excellent(R1 命令证据 + R4 charter §9.2 严判 + R5 责任归属漂移)+ 4 good + 1 weak(R8 漏读 RH0 closure §6)+ 0 false-positive。命中率 ~88%(R8 减分),excellence 率 38%。

### A.4 多维度评分(单向总分 10 分)

| 维度 | 评分 | 说明 |
|------|------|------|
| 证据链完整度 | 10 | §1.2 列出全部命令实测;§1.3 证据可信度说明 4 项中 4 项 yes;命令证据是 4 reviewer 中最完整 |
| 判断严谨性 | 9 | severity 阶梯均匀;R6 vergeerdict 校准最贴近实际;R8 是漏读 closure r2 的小瑕疵 |
| 修法建议可执行性 | 9 | R5 给出具体 §9.2 注释建议 + R7 给出 charter §9.5 新增 Tier-0 的方法论提议;R3/R5 修法略保守(都说 "在 RH3 中补") |
| 对 action-plan / design / QNA 的忠实度 | 10 | charter §7.1/7.2/7.3 + §8.3/8.4 + §9.2 + §10.3 引用全面;R5 把 RH1 action-plan P1-06b 原文与实际实施对照,忠实度极高 |
| 协作友好度 | 9 | 8 项 finding 阶梯清晰;§3 对齐表 22+7+0 done/partial/missing 易读;但 §1.1/§1.2 列表太长 |
| 找到问题的覆盖面 | 9 | 8 项覆盖 RH0/RH1/RH2 各 2-3 项 + 跨阶段责任漂移;唯一漏 GPT R3 critical 与 deepseek R10 容量评估 |
| 严重级别 / verdict 校准 | 9 | R6 high blocker + R1/R4 medium + R8 low 阶梯校准准确;verdict approve-with-followups 但点名 1 个 RH3 blocker,平衡感最佳 |

**综合**:**8.5 / 10**

> Kimi (k2p6) 是 4 reviewer 中"reproducibility 最扎实 + 责任归属漂移检测最敏锐 + verdict 校准最平衡"的 reviewer。最适合做"实施者声称全绿时的独立本地复跑校验" 以及 "phase 间责任归属一致性审计"。短板与 GLM 类似(verdict 偏宽 + 缺 cross-phase capacity 视角),但 kimi 的命令证据严谨度高于 GLM,且 R5/R6 校准更精准。如果只能选两个 reviewer,选 GPT(critical drift)+ Kimi(reproducibility + 责任归属)是非常互补的组合。
