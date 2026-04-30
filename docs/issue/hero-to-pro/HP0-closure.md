# HP0 Pre-Defer Fixes — Closure

> 服务业务簇: `hero-to-pro / HP0`
> 上游 action-plan: `docs/action-plan/hero-to-pro/HP0-action-plan.md`
> 上游 design: `docs/design/hero-to-pro/HP0-pre-defer-fixes.md`
> 冻结决策来源: `docs/design/hero-to-pro/HPX-qna.md`
> 闭环日期: `2026-04-30`
> 文档状态: `frozen`

---

## 0. 总体 Verdict

| 维度 | 结论 |
|------|------|
| 总体状态 | `complete-with-partial`（仅 `withNanoAgentSystemPrompt` modelId seam 在 HP0 收口为 `partial`，按 Q2 frozen 法律带 `expires-at: HP1 closure`） |
| 三入口模型字段/body law | `done`（Phase 2 P2-01 / P2-02） |
| system prompt seam | `partial-by-design`（Phase 3 P3-01；HP0 不读 D1，HP1 接 `base_instructions_suffix`） |
| Verify-only 项 | `done`（Phase 4 P4-01：`CONTEXT_CORE` / `LANE_E_RPC_FIRST` 当前事实写入 binding-presence test） |
| Cleanup 项 | `done`（Phase 4 P4-02：`docs/runbook/zx2-rollback.md` 已物理删除） |
| Conditional cleanup | `not-needed`（Phase 4 P4-03：`pnpm-lock.yaml` 无 stale importer，13 个 key 全部对应工作树真实目录） |
| Residue 法律 | `frozen`（Q3：`forwardInternalJsonShadow` / `parity-bridge` 留 HP8-B / HP10） |

---

## 1. Resolved 项（HP0 已完成、可终结）

| ID | 描述 | 证据 | 收尾说明 |
|----|------|------|----------|
| `R1` | `StartSessionBody` / `FollowupBody` 接受 `model_id` / `reasoning` | `workers/orchestrator-core/src/session-lifecycle.ts` 中 `StartSessionBody` / `FollowupBody` 的字段；`packages/nacp-session/src/messages.ts:17-20,43-52,119-136` 协议层 schema 仍是单一 authoritative source | 公共入口类型与协议层不再漂移 |
| `R2` | `/start` 透传 `model_id` / `reasoning` 到 agent-core，并复用 `requireAllowedModel()` gate | `workers/orchestrator-core/src/user-do/session-flow.ts` `handleStart` 与 `forwardStart` payload；`workers/orchestrator-core/test/user-do.test.ts` 增加的 `/start model law` 用例 | `/start` 不再静默吞模型字段；非法字段 → 400 |
| `R3` | `/input` 透传 `model_id` / `reasoning` 到 `handleMessages` 同一 law | `workers/orchestrator-core/src/user-do/session-flow.ts` `handleInput`（`messagesBody` 已带模型字段）；现有 `messages-route` 行为依旧是单一 reference | 三入口共享同一 validator；不再发明第二套 |
| `R4` | 共享 `parseModelOptions()` helper | `workers/orchestrator-core/src/session-lifecycle.ts` 新增 `parseModelOptions()`；`workers/orchestrator-core/src/user-do/message-runtime.ts` 改为消费此 helper | 单一 validator/law，避免双语义 |
| `R5` | `CONTEXT_CORE` binding 与 `LANE_E_RPC_FIRST=false` verify-only 证据 | `workers/orchestrator-core/test/binding-presence.test.ts`；`workers/agent-core/wrangler.jsonc:20-23,44-51,78-87,97-101`；`workers/orchestrator-core/wrangler.jsonc:57-63,99-104` | HP0 不改 wrangler，仅以测试钉住事实 |
| `R6` | 删除过期 runbook `docs/runbook/zx2-rollback.md` | `git status` 删除记录 | 仓内不再保留错误回滚指引 |

---

## 2. Partial 项（HP0 收口但有 expires-at 法律）

| ID | 描述 | 当前完成度 | `expires-at` | 后续 phase | 证据 |
|----|------|-----------|--------------|-----------|------|
| `P1` | `withNanoAgentSystemPrompt(modelId?)` seam — 函数边界已经具备 `modelId?` 形参，但 HP0 不读 D1，suffix 依旧固定 | `seam-only` | `HP1 closure` | HP1 — `base_instructions_suffix` 落表后由 `withNanoAgentSystemPrompt` 直接读取 | `workers/agent-core/src/host/runtime-mainline.ts` 中 `withNanoAgentSystemPrompt` 形参与调用点；`workers/agent-core/test/host/system-prompt-seam.test.ts` 单测 |

---

## 3. Retained 项（HP0 显式不删，留给后续 phase 决议）

| ID | 描述 | 来源 frozen 法律 | 后续 phase | 触发条件 |
|----|------|-----------------|-----------|----------|
| `K1` | `forwardInternalJsonShadow` 的 method 名 + 行为残留 | HPX-qna Q3 | HP8-B postmortem → HP10 final closure | R29 postmortem 给出明确"删除/保留" verdict |
| `K2` | `workers/orchestrator-core/src/parity-bridge.ts` 的 helper / `StreamFrame` 等 | HPX-qna Q3 | HP8-B → HP10 | 同上 |
| `K3` | `LANE_E_RPC_FIRST=false` 的 final-state 决议 | HPX-qna Q3 | HP8-B / HP10 | postmortem 决议 lane-E 是否启用 |

---

## 4. Not-Touched 项（HP0 显式声明不做的范围）

| ID | 描述 | 理由 |
|----|------|------|
| `N1` | 新 D1 migration / 新表 / 新列 | HP0 设计 §5.2 O1，留 HP1 |
| `N2` | session-level model default / current model API | HP2 |
| `N3` | confirmation / checkpoint / context-compact 业务语义 | HP3 / HP5 / HP7 |
| `N4` | wrangler 配置变更（启用 / 切换 binding / lane-E final-state） | HP0 设计 §5.2 O2 |

---

## 5. F1-F17 chronic status 登记（强制）

> 来源：HP0 action-plan §8.1 文档校验要求；F1-F17 为 zero-to-real / real-to-hero 阶段的 chronic deferrals。HP0 必须显式标注，禁止 silent inherit。

| chronic | 说明 | HP0 verdict | 备注 |
|---------|------|-------------|------|
| F1 | 公共入口模型字段透传断裂 | `closed` | Phase 2 P2-01/P2-02 完成；三入口现共享 `parseModelOptions()` |
| F2 | system prompt model-aware suffix 缺失 | `partial` | Phase 3 P3-01 落 seam；真值落表归 HP1 |
| F3 | session-level current model 与 alias resolution | `not-touched` | 归属 HP2 model state machine |
| F4 | context state machine（compact / fork / branch） | `not-touched` | HP3 |
| F5 | chat lifecycle（turn supersede、turn_attempt）| `not-touched` | HP4 |
| F6 | confirmation control plane | `not-touched` | HP5 |
| F7 | tool workspace state machine | `not-touched` | HP6 |
| F8 | checkpoint / revert | `not-touched` | HP7 |
| F9 | runtime hardening（cron / cleanup TTL） | `not-touched` | HP8 |
| F10 | R29 postmortem & residue verdict | `handed-to-platform` | HP8-B / HP10；K1 / K2 / K3 已登记 |
| F11 | API docs + 手工证据 | `not-touched` | HP9 |
| F12 | final closure 与 HP10 cleanup | `not-touched` | HP10 |
| F13 | observability drift / metrics 完整性 | `not-touched` | HP8 / HP9 |
| F14 | tenant-scoped storage 全面落地 | `not-touched` | HP6 / HP7 文件系统层 |
| F15 | DO checkpoint vs product checkpoint registry 解耦 | `not-touched` | HP7 |
| F16 | confirmation_pending kernel wait reason 统一 | `not-touched` | HP5 / HP6 |
| F17 | `<model_switch>` developer message strip-then-recover during compact | `not-touched` | HP3 / HP4 联合 |

---

## 6. 下游 phase 交接 (handoff)

| 接收 phase | 交接物 | 形式 | HP0 内引用 |
|-----------|--------|------|------------|
| HP1 | `withNanoAgentSystemPrompt` 真 suffix 接线、`base_instructions_suffix` 字段落表 | 必修；`expires-at: HP1 closure` 触发 | §2 P1 |
| HP2 | session-level model state（default / current / alias / fallback）；HP0 已保证三入口能可靠透传到 runtime | 顺接；以 `parseModelOptions()` 为单一 ingress validator | §1 R1-R4 |
| HP8-B | R29 postmortem & residue verdict | 强依赖；HP0 不删 `forwardInternalJsonShadow` / parity helper | §3 K1-K3 |
| HP10 | final cleanup + closure | HP8-B verdict 完成后才能消费 | §3 K1-K3 |

---

## 7. 测试与证据矩阵

| 类型 | 命令 / 路径 | 状态 |
|------|-------------|------|
| typecheck (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker typecheck` | ✅ pass |
| build (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker build` | ✅ pass |
| test (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker test` | ✅ 20 files / 179 tests pass（HP0 前 170,新增 9 = 6 binding-presence + 3 HP0 model law） |
| typecheck (agent-core) | `pnpm --filter @haimang/agent-core-worker typecheck` | ✅ pass |
| build (agent-core) | `pnpm --filter @haimang/agent-core-worker build` | ✅ pass |
| test (agent-core) | `pnpm --filter @haimang/agent-core-worker test` | ✅ 102 files / 1072 tests pass（含新增 3 个 system-prompt seam case） |
| binding-presence verify | `workers/orchestrator-core/test/binding-presence.test.ts` | ✅ 新增 6 cases |
| `/start` model law regression | `workers/orchestrator-core/test/user-do.test.ts`（HP0 P2-02 共 3 cases:happy / 400 reasoning / `/input` forward） | ✅ |
| system prompt seam regression | `workers/agent-core/test/host/system-prompt-seam.test.ts` | ✅ 新增 3 cases |
| frozen install (lockfile) | not run（pnpm-lock.yaml 13 个 importer key 全部对应工作树真实目录,无 stale drift） | n/a |
| grep baseline — alias / binding / residue | inline 证据见各项条目 | ✅ |

---

## 8. 与 frozen QNA 一一对照

| QNA | HP0 落点 |
|-----|----------|
| Q1 — 三入口字段/body law 统一 | §1 R1-R4；§7 测试矩阵 |
| Q2 — `withNanoAgentSystemPrompt(modelId?)` 允许先 partial | §2 P1（明确 `expires-at: HP1 closure`） |
| Q3 — verify-only / parity 不强删 | §1 R5、§3 K1-K3 |

---

## 9. 已知 follow-up（不阻塞 HP0 闭合）

- `withNanoAgentSystemPrompt` 在 HP1 接线时若需要重命名 `modelId` → `model_id`，必须同步修 `runtime-mainline.ts` 调用点 + 单测；HP0 已留 seam，不会再触发 helper 边界变更。
- HP1 落 `nano_models.base_instructions_suffix` 时，应在 closure 中补一条 `clear-partial: HP0/P1` 的回填记录。

---

## 10. 收尾签字

- HP0 的 in-scope 项已全部落地，partial / retained / not-touched 项均带去向。
- HP1 可立即基于本 closure 启动；不需重新审计 HP0 的前置项。
- 任何后续 phase 若试图再触碰 K1-K3，必须显式援引本 closure 段并在新 phase closure 中给出新 verdict。
