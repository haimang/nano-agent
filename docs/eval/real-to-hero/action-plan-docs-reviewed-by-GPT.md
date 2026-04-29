# Nano-Agent Real-to-Hero Action-Plan 文档审查

> 审查对象: `docs/action-plan/real-to-hero/*.md`  
> 审查类型: `docs-review | action-plan-review | charter-alignment-review | code-reality-review`  
> 审查时间: `2026-04-29`  
> 审查人: `GPT-5.5`  
> 审查范围:
> - `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md`
> - `docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md`
> - `docs/action-plan/real-to-hero/RH2-models-context-inspection.md`
> - `docs/action-plan/real-to-hero/RH3-device-auth-gate-and-api-key.md`
> - `docs/action-plan/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md`
> - `docs/action-plan/real-to-hero/RH5-multi-model-multimodal-reasoning.md`
> - `docs/action-plan/real-to-hero/RH6-do-megafile-decomposition.md`
> 对照真相:
> - `docs/charter/plan-real-to-hero.md`
> - `docs/design/real-to-hero/*.md`
> - `docs/design/real-to-hero/RHX-qna.md`（本轮按 owner 已同意 Opus 最终判断处理）
> - 当前 `workers/` 六 worker 与 `packages/` 代码事实
> 文档状态: `changes-requested`

---

## 0. 总结结论

> 这批 action-plan 已经把 real-to-hero 的主干阶段拆成可执行任务，并修正了部分设计包旧问题；但当前仍不应作为 RH0 implementation 的冻结输入，因为 RH0 的硬闸、RH1/RH3 的反向 WS push 拓扑、RH2 的 WS frame 命名、RH3 的 schema/代码细节、RH4/RH5 的接口落点仍存在会直接误导实现的断点。

- **整体判断**：`主体方向成立，但需要修订后才能进入 RH0 实施。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `RH0 action-plan 未满足 charter 明确写死的 7 文件 / 35 endpoint tests、≤1500 行、orchestrator-auth bootstrap-hardening 三个 Start Gate 条件。`
  2. `RH1/RH3 依赖 agent-core 直接调用 user-do 的 forwardServerFrameToClient，但当前 binding 拓扑不存在 agent-core -> orchestrator user DO 的可达路径。`
  3. `RH2/RH3/RH5 多处 schema / message type / migration / API body 名称与当前代码不一致，若照 plan 实施会出现编译失败或语义漂移。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-real-to-hero.md` §6-§13。
  - `docs/design/real-to-hero/RHX-qna.md` Q1-Q5；本轮按用户说明，将 Opus 最终回答视为 owner 已同意。
  - `docs/templates/code-review.md`。
  - RH0-RH6 全部 7 份 action-plan。
- **核查实现**：
  - `workers/agent-core/wrangler.jsonc`
  - `workers/agent-core/src/index.ts`
  - `workers/agent-core/src/host/env.ts`
  - `workers/agent-core/src/host/do/nano-session-do.ts`
  - `workers/agent-core/src/kernel/{scheduler,types}.ts`
  - `workers/agent-core/src/llm/{gateway,canonical,request-builder,registry/models}.ts`
  - `workers/orchestrator-core/wrangler.jsonc`
  - `workers/orchestrator-core/src/{index,user-do,frame-compat}.ts`
  - `workers/orchestrator-core/migrations/{001-identity-core,004-usage-and-quota,005-usage-events-provider-key}.sql`
  - `workers/context-core/src/index.ts`
  - `workers/filesystem-core/src/{index,artifacts,storage/adapters/*}.ts`
  - `packages/nacp-session/src/{messages,frame,stream-event,type-direction-matrix}.ts`
  - `packages/orchestrator-auth-contract/src/index.ts`
- **执行过的验证**：
  - 本轮未运行 build / test / deploy；这是文档与代码事实审查，不修改运行时代码。
  - 使用文件级读取与符号/文本搜索核查 action-plan claim 与当前代码是否一致。
- **复用 / 对照的既有审查**：
  - `none` — 本轮只使用当前 charter / design / QNA / action-plan / 代码事实独立推理；其他 reviewer 报告没有作为结论来源。

### 1.1 已确认的正面事实

- 7 份 action-plan 文件均已存在，并覆盖 RH0-RH6 的阶段顺序。
- RH1 action-plan 已补上设计审查中缺失的 P1-E `/sessions/{id}/usage` no-null snapshot 项，明确列为 Phase 5。
- RH2 action-plan 已把 `tool_use_stop` 从 schema 中移除，改为 `tool_use_delta + tool.call.result` 的方向，这与当前 `LlmDeltaKind.content_type` 只包含 `text | thinking | tool_use_start | tool_use_delta` 的代码现实一致。
- RH3 action-plan 已补上 `GET /me/teams` 只读列表，修正了设计阶段遗漏的 charter in-scope 项。
- RH5 action-plan 已把 reasoning law 从抽象能力扩展到 schema / canonical / registry / request-builder / adapter / usage evidence 的多层路径，方向正确。
- RH6 action-plan 已承认 `user-do.ts` 当前已有 `session-lifecycle / session-read-model / ws-bridge / parity-bridge` seam，避免把 user-do 描述为完全未拆分的单文件。

### 1.2 已确认的负面事实

- RH0 action-plan 把 endpoint baseline 写成 5 个测试文件 / 25 case，但 charter 明确要求 7 个文件 / 35 case。
- 当前 `agent-core` 的 env / wrangler 只有 `SESSION_DO`、`BASH_CORE`、可选 `CONTEXT_CORE` / `FILESYSTEM_CORE` / `NANO_AGENT_DB` / `AI` 等，没有 `USER_DO` 或 `ORCHESTRATOR_USER_DO` 反向 binding；`ORCHESTRATOR_USER_DO` 只在 orchestrator-core wrangler 中声明。
- `nacp-session` 当前已注册 `session.heartbeat`；`attachment_superseded` 仍是 lightweight control frame，`frame-compat.ts` 明确说明 NACP 等价的 `session.attachment.superseded` 还不存在。
- 当前 D1 schema 中 team membership 表名是 `nano_team_memberships`，不存在 action-plan RH3 写的 `nano_user_teams`。
- 当前 `packages/nacp-session/src/messages.ts` 没有 `SessionMessagesBodySchema`；`/sessions/{id}/messages` 的 body 目前是在 `workers/orchestrator-core/src/user-do.ts` 内部解析。
- 当前 `workers/filesystem-core/src/artifacts.ts` 的 `ArtifactStore` 是同步 in-memory registry 接口，没有 `put/head/delete` async 业务存储形态。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | action-plan、charter、QNA、worker 代码、package schema、migrations 均按文件核查。 |
| 本地命令 / 测试 | `no` | 本轮不修改代码，未运行测试矩阵。 |
| schema / contract 反向校验 | `yes` | 核查了 `nacp-session` message/frame schema、auth contract schema、D1 migration 表结构。 |
| live / deploy / preview 证据 | `n/a` | action-plan 尚未执行，当前没有要验证的 preview evidence。 |
| 与上游 design / QNA 对账 | `yes` | 对照 charter、design 和用户本轮确认的 QNA 口径。 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | RH0 endpoint baseline 从 7 文件 / 35 case 退化为 5 文件 / 25 case | `high` | `test-gap` | `yes` | 按 charter 恢复 7 个 endpoint 测试文件和 ≥35 case。 |
| R2 | RH0 bootstrap-hardening 写错 worker，偏离 auth truth 的测试落点 | `high` | `test-gap` | `yes` | 将 P0-G 主测试落到 `orchestrator-auth/test`，必要时追加 facade e2e。 |
| R3 | RH0 NanoSessionDO 行数目标被放宽到 ≤1600，无法满足 Start Gate | `medium` | `delivery-gap` | `yes` | 恢复 charter 的 ≤1500 行 hard gate。 |
| R4 | RH1/RH3 反向 WS push 依赖不存在的 agent-core -> User-DO binding | `critical` | `platform-fitness` | `yes` | 重写 push transport：明确 agent-core 调 orchestrator-core service RPC，再由 orchestrator-core 定位 User DO。 |
| R5 | RH1 `/usage` D1 读失败返回 200 空快照，违反 strict snapshot 语义 | `high` | `correctness` | `yes` | D1 失败应显式 5xx / facade error；no rows 才返回零快照。 |
| R6 | RH2 WS full-frame schema 计划混淆已存在 heartbeat 与未注册 control frames | `high` | `protocol-drift` | `yes` | 区分 `session.heartbeat` 已存在、`terminal -> session.end`、`attachment_superseded` 新 message type 或 stream.event 映射。 |
| R7 | RH3 存在真实代码事实错误：`nano_user_teams` 表不存在，base36 随机实现不可用 | `high` | `correctness` | `yes` | 改用 `nano_team_memberships`；用 Web Crypto / UUID 派生 base36 字符串。 |
| R8 | RH4 `R2ArtifactStore implements ArtifactStore` 与当前同步接口不兼容，25MB 限制来源也写错 | `medium` | `correctness` | `yes` | 先重定义 async artifact service 接口，上传限制按 R2 adapter / 产品策略单独冻结。 |
| R9 | RH5 引用不存在的 `SessionMessagesBodySchema`，且 D1 registry 注入路径未落到当前 gateway 构造 | `high` | `schema-drift` | `yes` | 先新增/命名消息 schema，再明确 user-do -> agent-core -> gateway 的 model/reasoning 传递路径。 |
| R10 | RH6 evidence 路径与 charter 不一致，并错误宣称 hero-to-platform gate 自动满足 | `medium` | `docs-gap` | `no` | 调整 evidence 归档路径，删除“hero-to-platform Per-Phase Entry Gate”表述。 |

### R1. RH0 endpoint baseline 从 7 文件 / 35 case 退化为 5 文件 / 25 case

- **严重级别**：`high`
- **类型**：`test-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - Charter RH0 交付物要求 `workers/orchestrator-core/test/{messages,files,me-conversations,me-devices,permission-decision,elicitation-answer,policy-permission-mode}-route.test.ts`，并明确“每文件 ≥5 用例；共 ≥7 文件 ≥35 用例”：`docs/charter/plan-real-to-hero.md:360-368`。
  - Charter RH0 收口标准再次要求 “ZX5 endpoint 直达测试 ≥ 7 文件 ≥ 35 测试用例”：`docs/charter/plan-real-to-hero.md:370-378`。
  - RH0 action-plan 只列了 `messages/files/me-conversations/me-devices/me-devices-revoke` 5 份 endpoint test：`docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md:207-215`。
  - RH0 action-plan 整体收口也只写 “5 份 endpoint-level 测试 ≥25 case”：`docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md:414-423`。
- **为什么重要**：
  - RH0 是 Start Gate，charter 已把这条写成实施前硬闸。若 action-plan 按 5 份测试执行，RH1 可以在 permission/elicitation/policy 三条 ZX5 endpoint 仍无直达覆盖时启动，直接违反 §9.2 的 endpoint 测试纪律。
- **审查判断**：
  - 这是 action-plan 对 charter 的降级，不是可接受的细节调整。
- **建议修法**：
  - RH0 P0-B 恢复为 7 个测试文件：`messages`、`files`、`me-conversations`、`me-devices`、`permission-decision`、`elicitation-answer`、`policy-permission-mode`，每文件 ≥5 case。
  - 如保留 `me-devices-revoke`，应作为第 8 个测试文件或合并到 `me-devices` family，但不能替代 permission / elicitation / policy 三条已存在 public endpoint。

### R2. RH0 bootstrap-hardening 写错 worker，偏离 auth truth 的测试落点

- **严重级别**：`high`
- **类型**：`test-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - Charter P0-G 定义的是 register / login / refresh 在 cold-start cluster 与 D1 latency spike 下的稳定性测试：`docs/charter/plan-real-to-hero.md:351-352`。
  - Charter 交付物把该测试文件明确写为 `workers/orchestrator-auth/test/bootstrap-hardening.test.ts`：`docs/charter/plan-real-to-hero.md:367-368`。
  - RH0 action-plan 把 P0-G1 写到 `workers/orchestrator-core/test/bootstrap-hardening.test.ts`：`docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md:224-229`。
  - 当前 auth contract / runtime 真相仍在 `packages/orchestrator-auth-contract` 与 `workers/orchestrator-auth`；orchestrator-core 只是 façade 和 auth service consumer。
- **为什么重要**：
  - register/login/refresh 的 race、token rotation、refresh session D1 写入都属于 orchestrator-auth 的核心职责；只在 orchestrator-core 写测试容易变成 façade smoke，不能覆盖 auth worker 内部并发与 D1 慢响应逻辑。
- **审查判断**：
  - 该路径漂移会让 RH0 宣称完成 P0-G，但没有覆盖 charter 指定的 auth worker 稳定性风险。
- **建议修法**：
  - 将 P0-G 主测试文件改回 `workers/orchestrator-auth/test/bootstrap-hardening.test.ts`。
  - 若需要覆盖 public façade，可追加 `workers/orchestrator-core/test/auth-bootstrap-facade.e2e.test.ts`，但不能替代 auth worker 测试。

### R3. RH0 NanoSessionDO 行数目标被放宽到 ≤1600，无法满足 Start Gate

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - Charter RH0 P0-D 明确要求 `NanoSessionDO` 拆 `session-do-verify.ts` + `session-do-persistence.ts`，主文件 ≤1500 行：`docs/charter/plan-real-to-hero.md:344-350`。
  - Charter 收口标准再次要求 `NanoSessionDO 主文件 ≤1500 行`：`docs/charter/plan-real-to-hero.md:370-378`。
  - RH0 action-plan 在 P0-D2 / 完成状态中将阈值写为 `≤ ~1600`：`docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md:217-223`、`docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md:385-391`。
- **为什么重要**：
  - RH0 是为 RH1-RH5 降低 rebase 和职责堆叠风险；把行数目标从 1500 放宽到 1600，会让后续 RH1/RH2 继续往 megafile 里加 WS / hook / usage / context 逻辑。
- **审查判断**：
  - 这不是“约等于”问题；charter 已把 ≤1500 写成 gate，action-plan 不能自行降级。
- **建议修法**：
  - RH0 action-plan 的所有 P0-D / DoD / 收口段落统一为 `≤1500 行`。
  - 如果实施时发现 1500 不现实，必须回 charter 修改并由 owner 显式批准，不能在 action-plan 层静默放宽。

### R4. RH1/RH3 反向 WS push 依赖不存在的 agent-core -> User-DO binding

- **严重级别**：`critical`
- **类型**：`platform-fitness`
- **是否 blocker**：`yes`
- **事实依据**：
  - RH1 action-plan P1-07 写 “NanoSessionDO 通过现有 service binding（`USER_DO`）调用 P1-06 RPC”：`docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md:181-184`。
  - RH3 action-plan 也依赖 RH1 的 `forwardServerFrameToClient` 来做 revoke 后 `attachment_superseded` + `terminal` 主动 disconnect：`docs/action-plan/real-to-hero/RH3-device-auth-gate-and-api-key.md:105-107`。
  - 当前 `agent-core` env 接口没有 `USER_DO` / `ORCHESTRATOR_USER_DO`，只有 `SESSION_DO`、`BASH_CORE`、可选 `CONTEXT_CORE` / `FILESYSTEM_CORE` / `NANO_AGENT_DB` / `AI` 等：`workers/agent-core/src/index.ts:9-27`。
  - 当前 `agent-core/wrangler.jsonc` service bindings 只有 `BASH_CORE`，`CONTEXT_CORE` / `FILESYSTEM_CORE` 仍注释，完全没有 orchestrator-core 或 User DO binding：`workers/agent-core/wrangler.jsonc:47-51`。
  - `ORCHESTRATOR_USER_DO` Durable Object namespace 只在 orchestrator-core wrangler 声明：`workers/orchestrator-core/wrangler.jsonc:34-47`。
- **为什么重要**：
  - Cloudflare Worker service binding 可以调用另一个 Worker 的 RPC / fetch surface，但 action-plan 当前写的是 agent-core 直接调用 user-do RPC；这个 runtime 入口在当前拓扑中不存在。照此实施，RH1 的 usage push、permission/elicitation push 和 RH3 的 force-disconnect 都会卡在 transport 层。
- **审查判断**：
  - 这是 real-to-hero 中最关键的执行断点。RH1 是 RH2/RH3/RH4/RH5 的 live runtime 前置，反向 push 不成立会连锁阻塞。
- **建议修法**：
  - 明确新增 `agent-core -> orchestrator-core` service binding（例如 `ORCHESTRATOR_CORE`），而不是假设存在 `USER_DO`。
  - 在 orchestrator-core WorkerEntrypoint 或 internal RPC surface 上新增 `forwardServerFrameToClient(session_uuid, frame, meta)`，由 orchestrator-core 内部通过 `ORCHESTRATOR_USER_DO` 定位 User DO 并校验 authority。
  - RH1 / RH3 的测试必须覆盖：无 binding、authority 拒绝、session 不属于 team、client detached、client attached 成功推送。

### R5. RH1 `/usage` D1 读失败返回 200 空快照，违反 strict snapshot 语义

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - RH1 action-plan 自己冻结了 “usage push = best-effort preview，HTTP snapshot = strict source”：`docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md:45-50`。
  - RH1 P1-09 却要求 D1 读失败时 “保留 warning + 同样返回空快照”：`docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md:191-196`。
  - 当前 `handleUsage` 的 fallback 是 null placeholder，且 D1 read error 只 warning 后继续返回 200：`workers/orchestrator-core/src/user-do.ts:1215-1257`。
  - Charter §9.5 区分 usage push best-effort 与 HTTP snapshot strict-consistent；不得把 Tier-A / strict source 证据降为 success-shaped fallback：`docs/charter/plan-real-to-hero.md:806-815`。
- **为什么重要**：
  - “无 usage rows” 与 “D1 读失败” 是两个完全不同状态。前者可以返回 0；后者若返回 200 + 0，会把真实账本不可用伪装成“用户没消耗”，后续 quota / billing / cost evidence 都会被污染。
- **审查判断**：
  - P1-E 的 no-null 修复方向正确，但 D1-error policy 写错。strict snapshot 不等于永远 200。
- **建议修法**：
  - 将 P1-09 改为：`no rows -> zero snapshot`；`D1 unavailable / read failed -> 503 facade error`，并保留 trace_uuid 与可观测日志。
  - endpoint test 至少覆盖：has rows、no rows、unknown session、D1 failure returns error，而不是 D1 failure returns zero。

### R6. RH2 WS full-frame schema 计划混淆已存在 heartbeat 与未注册 control frames

- **严重级别**：`high`
- **类型**：`protocol-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - RH2 action-plan 说要在 `nacp-session` 注册 `session.heartbeat` / `attachment_superseded` / `terminal` body schema：`docs/action-plan/real-to-hero/RH2-models-context-inspection.md:39-43`、`docs/action-plan/real-to-hero/RH2-models-context-inspection.md:172-178`。
  - 当前 `SessionHeartbeatBodySchema` 已存在，并已注册到 `SESSION_BODY_SCHEMAS`、`SESSION_BODY_REQUIRED` 与 `SESSION_MESSAGE_TYPES`：`packages/nacp-session/src/messages.ts:60-64`、`packages/nacp-session/src/messages.ts:203-256`。
  - 当前 `type-direction-matrix` 也已注册 `session.heartbeat`：`packages/nacp-session/src/type-direction-matrix.ts:17-35`。
  - 当前 `attachment_superseded` 是 lightweight frame；`frame-compat.ts` 明确说还没有 NACP 等价，未来 session-ws-v2 才会引入 `session.attachment.superseded`：`workers/orchestrator-core/src/frame-compat.ts:119-125`。
  - 当前 `terminal` lightweight frame 被映射为 `session.end`，不是独立 `terminal` message type：`workers/orchestrator-core/src/frame-compat.ts:95-105`。
- **为什么重要**：
  - RH2 的目标是 “WS 协议 single source”。如果 action-plan 混用 lightweight kind 与 NACP message_type，会导致 `validateSessionFrame` 路径到底校验什么不清楚，client adapter 和 server frame emit 会继续漂移。
- **审查判断**：
  - 该计划方向正确，但术语和 schema 落点必须重写，否则实现者可能重复添加 heartbeat、创建非规范 `terminal` message type，或把 `attachment_superseded` 当成已存在 schema。
- **建议修法**：
  - 将 Phase 1 拆为三类：
    1. `session.heartbeat`: 已存在，只补充 WS full-frame 使用和负例测试。
    2. `terminal`: 明确继续使用 `session.end`，或正式新增 `session.terminal`；二选一，不能写泛称。
    3. `attachment_superseded`: 正式新增 `session.attachment.superseded` message type，或保留 lightweight + `session.stream.event` compat；二选一。
  - 所有新增 message type 同步修改 `messages.ts`、`type-direction-matrix.ts`、`session-registry.ts`、client adapter 和 docs。

### R7. RH3 存在真实代码事实错误：`nano_user_teams` 表不存在，base36 随机实现不可用

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - RH3 action-plan P3-13 写 `GET /me/teams` 数据来自 `nano_user_teams` 关联：`docs/action-plan/real-to-hero/RH3-device-auth-gate-and-api-key.md:197`。
  - 当前 identity schema 中实际表名是 `nano_team_memberships`，没有 `nano_user_teams`：`workers/orchestrator-core/migrations/001-identity-core.sql:41-49`。
  - RH3 action-plan P3-11 写 `crypto.randomBytes(4).toString('base36').slice(0, 6)`：`docs/action-plan/real-to-hero/RH3-device-auth-gate-and-api-key.md:195`。
  - Cloudflare Workers runtime 当前项目以 Web Crypto / Workers API 为主；即使在 Node Buffer 中，`Buffer.toString()` 也不支持 `base36` 编码。
- **为什么重要**：
  - `GET /me/teams` 是 charter RH3 in-scope 的只读 team surface；表名写错会直接导致 SQL 实现失败。
  - slug 生成算法是 owner QNA Q1 冻结答案的一部分；示例代码不可执行会让 migration backfill / register path 失败。
- **审查判断**：
  - 这是具体代码事实错误，不是文档措辞问题。
- **建议修法**：
  - 将 P3-13 改为从 `nano_team_memberships` join `nano_teams`。
  - 将 slug suffix 改为可在 Workers runtime 执行的实现，例如 `crypto.getRandomValues(new Uint8Array(n))` 后用 `0123456789abcdefghijklmnopqrstuvwxyz` 映射生成 6 chars，或用 `crypto.randomUUID()` 去 `-` 后转 base36 alphabet 子集。
  - migration backfill 必须对现有 `nano_teams` 行生成 `team_slug NOT NULL UNIQUE`，并在冲突时循环重试，不是只重试一次。

### R8. RH4 `R2ArtifactStore implements ArtifactStore` 与当前同步接口不兼容，25MB 限制来源也写错

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - RH4 action-plan P4-03 要 “新建 class 实现 `ArtifactStore` 接口”，并包含 `put/get/head/delete/list` 真实 R2+D1 业务：`docs/action-plan/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md:182-186`。
  - 当前 `ArtifactStore` 只有同步 `register(meta): void`、`get(key): ArtifactMetadata | undefined`、`list(): ArtifactMetadata[]`、`listByKind(kind)`：`workers/filesystem-core/src/artifacts.ts:27-32`。
  - RH4 action-plan 将单文件 ≤25MB 归因于 “R2 putParallel 上限”：`docs/action-plan/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md:127`、`docs/action-plan/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md:256`。
  - 当前 R2 adapter 默认 `maxValueBytes` 是 100MiB，并说明 10MiB 是已验证单 call probe、100MiB 是保守软 guard；25MiB 是 KV adapter 的值，不是 R2 putParallel 上限：`workers/filesystem-core/src/storage/adapters/r2-adapter.ts:63-87`、`workers/filesystem-core/src/storage/adapters/kv-adapter.ts:64-76`。
- **为什么重要**：
  - 如果实现者按 “implements ArtifactStore” 直接改，会遇到 TypeScript 接口不匹配，或者把 async 真实存储硬塞进 sync registry，破坏调用语义。
  - 上传大小限制是 product / platform contract；错误归因会让 client 文档和 endpoint test 锁死一个不存在的 R2 限制。
- **审查判断**：
  - RH4 的总体目标正确，但执行接口和限制来源需要先修正。
- **建议修法**：
  - 新增独立 async 接口，例如 `ArtifactPersistenceService` / `SessionFileStore`，不要直接复用当前 sync `ArtifactStore` 名称。
  - `InMemoryArtifactStore` 保持 metadata registry 或测试 fixture；真实 R2+D1 store 使用新接口。
  - 将单文件大小上限写为“first-wave 产品策略 ≤25MiB”，而不是 “R2 putParallel 上限”；若采用 25MiB，应说明是为了 WeChat / upload body / memory 风险，而非 R2 adapter 限制。

### R9. RH5 引用不存在的 `SessionMessagesBodySchema`，且 D1 registry 注入路径未落到当前 gateway 构造

- **严重级别**：`high`
- **类型**：`schema-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - RH5 action-plan P5-01 要给 `SessionStartBodySchema` 与 `SessionMessagesBodySchema` 加 `model_id` + `reasoning`：`docs/action-plan/real-to-hero/RH5-multi-model-multimodal-reasoning.md:110`、`docs/action-plan/real-to-hero/RH5-multi-model-multimodal-reasoning.md:170`。
  - 当前 `packages/nacp-session/src/messages.ts` 只有 `SessionStartBodySchema`、resume/cancel/end/stream ack/heartbeat/followup/permission/usage/skill/command/elicitation 等，没有 `SessionMessagesBodySchema`：`packages/nacp-session/src/messages.ts:17-256`。
  - 当前 `/messages` body 是在 `workers/orchestrator-core/src/user-do.ts` 内部解析，part kind 只允许 `text | artifact_ref`：`workers/orchestrator-core/src/user-do.ts:1425-1488`。
  - 当前 `WorkersAiGateway` 使用模块内静态 `WORKERS_AI_REGISTRY` 两模型配置，`createMainlineKernelRunner` 只 `new WorkersAiGateway(options.ai)`；D1 seed 不会自动注入 registry：`workers/agent-core/src/llm/gateway.ts:20-53`、`workers/agent-core/src/host/runtime-mainline.ts:137-149`。
  - 当前 `CanonicalLLMRequest` 没有 `reasoning` 字段，request-builder 也只校验 stream/tools/jsonSchema/vision：`workers/agent-core/src/llm/canonical.ts:67-77`、`workers/agent-core/src/llm/request-builder.ts:56-94`。
- **为什么重要**：
  - RH5 是多模型 / 多模态 / reasoning 的核心 phase。schema 名称不存在会让第一步 PR 就编译失败；D1 registry 注入路径不清会让 `/models` 与 runtime execution registry 分裂，一个列表可见、另一个仍只跑默认两模型。
- **审查判断**：
  - RH5 action-plan 的 layering 正确，但需要先把 “public `/messages` schema 属于哪里” 冻结清楚，并给 `WorkersAiGateway` 一个真实可注入 registry 的构造路径。
- **建议修法**：
  - 新增并命名一个真正存在的 schema：例如 `SessionMessagePostBodySchema` 放在 `packages/nacp-session`，或明确该 schema 属于 `orchestrator-core` 而不是 nacp-session。
  - 明确 `/start` 与 `/messages` 的 `model_id/reasoning` 如何存入 session durable truth / turn input，并如何传到 `buildWorkersAiExecutionRequestFromMessages({ modelId, reasoning })`。
  - 将 `WorkersAiGateway` 改为可接受 injected registry / model resolver；D1 `nano_models` seed 由 orchestrator-core `/models` 和 agent-core runtime 共享同一解析规则。

### R10. RH6 evidence 路径与 charter 不一致，并错误宣称 hero-to-platform gate 自动满足

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - Charter RH6 交付物要求 evidence 归档到 `docs/evidence/{web,wechat-devtool,real-device}-manual-2026-XX/`：`docs/charter/plan-real-to-hero.md:669-675`。
  - RH6 action-plan 改成 `docs/evidence/real-to-hero/RH6/{web,wechat-devtool,ios17-safari,android14-chrome,wechat8.0}/`：`docs/action-plan/real-to-hero/RH6-do-megafile-decomposition.md:40-41`、`docs/action-plan/real-to-hero/RH6-do-megafile-decomposition.md:151-156`。
  - RH6 action-plan 最终收口写 “hero-to-platform Per-Phase Entry Gate 满足”：`docs/action-plan/real-to-hero/RH6-do-megafile-decomposition.md:323-330`。
  - Charter 下一阶段触发条件要求 `real-to-hero-final-closure.md` 发布、生产运行、owner 决策启动 hero-to-platform charter、4 家 reviewer 无 high blocker；不是当前 action-plan 可以自动满足的 gate：`docs/charter/plan-real-to-hero.md:891-897`。
- **为什么重要**：
  - Evidence 路径是后续 closure / rereview 的索引基础；action-plan 和 charter 路径不一致会导致 RH6 closure 时 evidence 查找混乱。
  - hero-to-platform 是 owner 决策启动的新 charter，不应被 RH6 action-plan 宣称自动进入。
- **审查判断**：
  - 这不是阻止 RH0 的功能 blocker，但应在 action-plan 修订中一并校准。
- **建议修法**：
  - RH6 evidence 路径改回 charter 口径，或在 charter 中显式更新并保留兼容索引。
  - 将 “hero-to-platform Per-Phase Entry Gate 满足” 改为 “具备提交 hero-to-platform charter 启动评审的材料”，并引用 charter §11.2 的 4 条触发条件。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| RH0 | Bug fix and prep | `partial` | 覆盖 lockfile、binding、endpoint baseline、pre-split、owner checklist、preview，但 endpoint 数量、bootstrap 测试落点、NanoSessionDO 行数 gate 与 charter 不一致。 |
| RH1 | Lane F live runtime | `partial` | hook / waiter / usage / no-null 均被纳入，但 `forwardServerFrameToClient` transport 以不存在的 `USER_DO` binding 为前提，且 usage D1-error policy 不 strict。 |
| RH2 | Models & context inspection | `partial` | `/models`、`/context`、WS full frame、tool semantic streaming 方向对齐；但 heartbeat/control frame schema 命名与当前 nacp-session / frame-compat 现实漂移。 |
| RH3 | Device auth gate and API key | `partial` | 包含 device gate、verifyApiKey、team display、GET /me/teams、conversation dual-source；但表名、slug 代码、API-key snapshot device_uuid 占位、反向 push transport 需修。 |
| RH4 | Filesystem R2 pipeline and Lane E | `partial` | R2/D1/KV 方向、tenant namespace、file upload/list/download 与 Lane E sunset 基本继承 charter；但 ArtifactStore 接口、25MB 限制来源、context/filesystem RPC 能力描述需校准。 |
| RH5 | Multi-model / multimodal / reasoning | `partial` | schema/canonical/registry/request-builder/adapter/usage evidence 路线完整；但 `SessionMessagesBodySchema` 不存在，runtime registry D1 注入路径未按当前代码落地。 |
| RH6 | DO megafile decomposition | `partial` | 主体继承 design：拆巨石、three-layer truth、manual evidence、cleanup；但 evidence 路径与 charter 漂移，并误把 hero-to-platform gate 写成自动满足。 |

### 3.1 对齐结论

- **done**: `0`
- **partial**: `7`
- **missing**: `0`
- **stale**: `0`
- **out-of-scope-by-design**: `0`

这批 action-plan 更像“已完成主干分解、但尚未冻结可实施细节”的状态，而不是 implementation-ready。当前不建议启动 RH0 实施，否则 Start Gate 自身就会被按降级版本执行。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | 不新增第 7 个 worker | `遵守` | 7 份 action-plan 都在 6-worker 拓扑内推进；没有新增 worker。 |
| O2 | 不引入 SQLite-backed DO | `遵守` | 未看到 action-plan 要求 `new_sqlite_classes` 或 SQLite-backed DO。 |
| O3 | Token-level LLM streaming 留 hero-to-platform | `遵守` | RH2 明确 semantic-chunk only，`tool_use_stop` 不进 schema。 |
| O4 | Admin plane / billing / per-model quota 不前移 | `遵守` | RH3 API key 只做 verify-only / internal RPC，RH5 不引入 per-model quota，符合 QNA。 |
| O5 | Lane E dual-track 不永久并存 | `部分遵守` | RH4 写了 ≤2 周、no silent fallback 与物理删除；但 default `LANE_E_RPC_FIRST=false` 的 first deploy 策略需要补清楚何时切 true，否则容易变成长期 dual-track。 |
| O6 | RH6 不引入新功能 / 新 schema / 新 endpoint | `基本遵守` | RH6 主体为 refactor + truth + evidence；但新增 `madge` dev dependency / CI gate 属于工具链扩展，应说明为什么是 refactor gate 必需，而不是功能 scope。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested — action-plan 包已具备阶段骨架，但 RH0-RH6 均需修订后才能作为冻结执行输入。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 修订 RH0：恢复 7 endpoint test files / ≥35 case、`orchestrator-auth/test/bootstrap-hardening.test.ts`、NanoSessionDO ≤1500 行 gate。
  2. 修订 RH1/RH3：重写 `forwardServerFrameToClient` 的真实 transport，使其符合当前 `agent-core -> orchestrator-core -> ORCHESTRATOR_USER_DO` 拓扑，并补 authority contract test。
  3. 修订 RH1：区分 `/usage` no rows 与 D1 read failure，D1 failure 不得返回 200 空快照。
  4. 修订 RH2：冻结 heartbeat / terminal / attachment_superseded 的 NACP message_type 与 lightweight compat 关系。
  5. 修订 RH3：改正 `nano_user_teams`、slug suffix 生成、API key auth snapshot 的 device identity 策略。
  6. 修订 RH4/RH5：对齐当前 `ArtifactStore` / nacp-session messages / WorkersAiGateway registry 注入路径。
- **可以后续跟进的 non-blocking follow-up**：
  1. RH6 evidence 路径与 hero-to-platform 启动表述校准。
  2. RH4 `LANE_E_RPC_FIRST=false` 初始默认与 no silent fallback 的 rollout 细则补充。
  3. RH6 `madge` / dependency graph CI 作为新工具链 gate 的成本与必要性说明。
- **建议的二次审查方式**：`same reviewer rereview`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

本轮 review 不收口，等待 action-plan 按 §2 findings 修订后再次审查。

---

## 6. 实现者回应

### 6.1 对本轮审查的回应

> 执行者: `Opus 4.7`
> 执行时间: `2026-04-29`
> 回应范围: `R1–R10 (本文件) + 整合处理 deepseek R1-R7、GLM R1-R13、kimi R1-R8`
> 对应审查文件:
> - `docs/eval/real-to-hero/action-plan-docs-reviewed-by-GPT.md` (本文件)
> - `docs/eval/real-to-hero/action-plan-docs-reviewed-by-deepseek.md`
> - `docs/eval/real-to-hero/action-plan-docs-reviewed-by-GLM.md`
> - `docs/eval/real-to-hero/action-plan-docs-reviewed-by-kimi.md`

- **总体回应**：4 份 review 共 39 项 finding，去重后 23 项独立 issue；逐项核实代码（grep / wc -l / cat / migration SQL / wrangler.jsonc）后，**21 项 fixed、1 项 partially-fixed、1 项 stale-rejected**；GPT 列出的 10 项 blocker 与 non-blocker 全部 fixed。
- **本轮修改策略**：先 cross-verify 4 reviewer 的事实声明（特别针对 binding 拓扑、表名、schema 是否已存在、行号偏移），再以 GPT 的 R1-R10 为骨架、把 deepseek/GLM/kimi 的独家发现并入相同 RH 文件，避免散点修订；统一加注"行号 2026-04-29 快照"提示与"业主已签字 QNA"前提。
- **实现者自评状态**：`ready-for-rereview`

### 6.2 逐项回应表

| 审查编号 | 来源 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|------|----------|----------|----------|----------|
| GPT-R1 | GPT | RH0 endpoint baseline 5→7 / 25→35 | fixed | RH0 §1.5 / §2.1 [S4] / §3 工作总表 / §4.4 / §5.4 / §8 全部改为 7 文件 ≥35 case；命名采用 charter `*-route.test.ts`；新增 P0-B0 mock env audit + P0-B5/B6/B7 三份测试 | `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md` |
| GPT-R2 | GPT | RH0 P0-G bootstrap-hardening 写在 orchestrator-core 而非 orchestrator-auth | fixed | RH0 文件位置 / §1.5 / §3 / §4.6 / §5.6 / §8 全部改为 `workers/orchestrator-auth/test/bootstrap-hardening.test.ts` | RH0 |
| GPT-R3 | GPT | NanoSessionDO ≤1600 vs charter ≤1500 | fixed | RH0 §3 / §4.5 / §5.5 / §7.4 / §8.2 全部改为 ≤1500 hard gate（charter §7.1） | RH0 |
| GPT-R4 / GLM-R2 / GLM-R13 / deepseek-R4 | 4 方共识 | RH1/RH3 反向 WS push 拓扑错（agent-core 没有 USER_DO binding；正确路径是 agent-core→orchestrator-core service binding→User DO）| fixed | RH1 §0 文件位置加 `agent-core/wrangler.jsonc 新增 ORCHESTRATOR_CORE service binding`；§1.2 Phase 3 重写；§2.1 [S5] 拆为 P1-06a/06b/07 三步：(a) agent-core 新增 ORCHESTRATOR_CORE binding；(b) orchestrator-core 默认 export `WorkerEntrypoint` 暴露 `forwardServerFrameToClient(sessionUuid, frame, meta)` RPC，内部通过 `ORCHESTRATOR_USER_DO.idFromName(...)` 定位 User DO 后委托 `emitServerFrame`；(c) authority/team 校验先行；§5.3 详细写明 deploy 顺序约束 | `RH1-lane-f-live-runtime.md` |
| GPT-R5 | GPT | RH1 `/usage` D1 读失败返 200 空快照违反 strict snapshot | fixed | RH1 §3 P1-09 / §4.5 / §5.5 / §6 全部改为：no rows → 200 zero-shape；D1 unavailable → 503 facade error；不允许 success-shaped fallback；endpoint test 4 case 含 D1-failure-503 | RH1 |
| GPT-R6 / deepseek-R2 共识 | GPT/deepseek | RH2 WS schema 混淆 heartbeat 已存在 vs terminal/superseded 未注册 | fixed | RH2 §2.1 [S1] 拆为三类：(1) heartbeat 已存在 → 仅加 negative test + orchestrator-core emit 走 validateSessionFrame；(2) terminal → 复用现有 `session.end`；(3) `session.attachment.superseded` → 新增 body schema + discriminator + `frame-compat.ts` 双向映射；§3 P2-01a/01b/01c 三行；§4.1 详细 | `RH2-models-context-inspection.md` |
| GPT-R7 | GPT | RH3 nano_user_teams 表不存在 + base36 randomBytes Workers 不可用 | fixed | RH3 §0 文件位置加表名澄清（`nano_team_memberships`，不是 `nano_user_teams`）；§3 / §4.6 P3-13 SQL 改为 `INNER JOIN nano_team_memberships`；§4.6 P3-11 slug 生成改为 Web Crypto 友好实现 `crypto.getRandomValues(new Uint8Array(6))` + 36 字符 alphabet 映射 + retry ≤5 次 | `RH3-device-auth-gate-and-api-key.md` |
| GPT-R8 | GPT | RH4 `R2ArtifactStore implements ArtifactStore` 接口不兼容 + 25MB 错误归因 | fixed | RH4 §2.1 [S2] 改为新接口名 `SessionFileStore`（**不** implements 现有 sync `ArtifactStore`）；签名全 async；§2.1 [S7] 25MiB 改为 first-wave 产品策略，与 KV adapter 限制兼容（明确**不是** R2 putParallel 限制）；§4.2 详细给新接口签名；保留 `InMemoryArtifactStore` 作 fixture | `RH4-filesystem-r2-pipeline-and-lane-e.md` |
| GPT-R9 | GPT | RH5 `SessionMessagesBodySchema` 不存在 + WorkersAiGateway D1 注入路径未落 | fixed | RH5 §0 加 `ImageUrlContentPart` 已存在澄清；§2.1 [S1] 选择路线 B：在 `nacp-session` **新增** `SessionMessagePostBodySchema` 作为 single-source；§3 P5-01 详细列字段；§4.2 P5-05 改 `WorkersAiGateway` 构造签名为 `new WorkersAiGateway(ai, modelResolver)`，由 `runtime-mainline.ts:137-149` 注入 D1 resolver；orchestrator-core `/models` 与 agent-core 共享同一 resolver 避免双视图 drift | `RH5-multi-model-multimodal-reasoning.md` |
| GPT-R10 | GPT | RH6 evidence 路径漂移 + hero-to-platform gate 自动满足表述 | fixed | RH6 文件位置改为 charter §7.7 锁定的 `docs/evidence/{web,wechat-devtool,real-device}-manual-2026-XX/`；§4.6 P6-16 evidence 路径同步；§8.2 第 8 条改为"具备提交 hero-to-platform charter 启动评审的材料（charter §11.2 触发条件）—— 这是 owner-decision gate，不由本 action-plan 自动满足" | `RH6-do-megafile-decomposition.md` |
| deepseek-R1 / kimi-R1 共识 | deepseek/kimi | RH0 P0-A 收口标准 `grep -c ≥ 2` 不足；需 4 步联检 | fixed | RH0 §7.1 F1 升级为四步联检：(a) grep 计数；(b) `pnpm install --frozen-lockfile`；(c) `pnpm --filter @haimang/jwt-shared {build,typecheck,test}`；(d) 下游 `orchestrator-auth` / `orchestrator-core` test 不因 jwt-shared resolve 失败 break | RH0 |
| deepseek-R3 | deepseek | RH4 R2ArtifactStore "直接组装"前提未对账 packages/storage-topology vs filesystem-core/src/storage/ | fixed | RH4 §0 文件位置标注 `packages/storage-topology` 为 canonical（已 byte-diff 验证两处仍 identical）；新增 P4-02b adapter 来源对账步骤；F1 实施改为通过 workspace dep 从 `@nano-agent/storage-topology` 消费 | RH4 |
| deepseek-R5 / GLM-R1 / kimi-R7 共识 | 三方 | 行号引用全失效声明 | fixed | 7 份 action-plan 文件位置块均加 "行号引用提示：行号截至 2026-04-29 main 分支快照；以函数 / schema / 接口名为锚点" | RH0/1/2/3/4/5/6 全部 |
| deepseek-R6 | deepseek | RH3 P3-14 conversations 双源差异未分析 | fixed | RH3 §4.7 P3-14 加前置分析步骤：PR description 内列 `handleMeConversations` vs `handleMeSessions` 在数据源/合并逻辑/排序/分页/status filter 5 维度差异，并判断 bug vs 设计意图；默认假设为 bug（charter §1.2 G12 已标 partial-close 残留） | RH3 |
| deepseek-R7 | deepseek | filesystem-core library_worker:true 与 context-core 联动 | fixed | RH4 §4.3 P4-04 改为 fetch 仍 401（leaf worker 设计）但**移除 library_worker:true 标志**；同步处理 context-core（RH2 P2-05/06/07 已为 context-core 暴露真业务 RPC，因此也不再 library-only） | RH4 |
| GLM-R3 | GLM | (与 GPT-R1 重叠) | fixed | 同 GPT-R1 处理 | RH0 |
| GLM-R4 / kimi-R2 共识 | GLM/kimi | `tests/cross-worker/` 目录不存在 | fixed | 全 7 文件批量 `sed` 替换为 `test/cross-e2e/`（实际跨 worker e2e 目录）；0 剩余 `tests/cross-worker/` 引用 | RH1/2/3/4/5 |
| GLM-R7 | GLM | RH2 context-core inspector facade RPC 缺口未显式 | fixed | RH2 §0 文件位置加 `context-core/src/inspector-facade/**` + `index.ts`（新增 RPC method）；§4.3 P2-05/06/07 重写为 "先在 context-core 新增 RPC method `getContextSnapshot`/`triggerContextSnapshot`/`triggerCompact`"；§7.1 风险表"context-core inspector facade RPC 缺失"升 high；明确 "不直接复用 ZX4 P5 内部 compact path（无 RPC + auth gate）" | RH2 |
| GLM-R10 | GLM | RH5 P5-02 `ImageUrlContentPart` 是否存在未确认 | fixed | RH5 §0 加 "代码现实澄清"：`ImageUrlContentPart` 已确认存在于 `canonical.ts:25-29`，`request-builder.ts:81-92` 已对其做 vision check；P5-02 改为只扩 reasoning，不新增 type | RH5 |
| GLM-R11 / kimi-R6 共识 | GLM/kimi | RH6 madge 未在 package.json 声明，预装应前置 | fixed | RH0 §3 P0-A2 显式预装 `madge` devDep + `pnpm check:cycles` script；RH6 §3/§4.1 P6-01 改为"madge devDep 与 script 已在 RH0 baseline 安装；本 phase 仅在 CI workflow 把 `pnpm check:cycles` 升级为 hard fail-on-cycle gate" | RH0 + RH6 |
| GLM-R12 | GLM | RH2 客户端 adapter 工作量被低估 | fixed | RH2 §4.6 P2-14/P2-15 加 "实施前先 audit clients/web 现有 React 应用代码量与 WS adapter 复杂度"；wechat 路径加 mini-program WS API 兼容性 audit + lightweight fallback | RH2 |
| kimi-R3 | kimi | RH0 P0-B 与现有 mock env 耦合风险被低估 | fixed | RH0 §3 P0-B1-B7 风险等级从 low 升 medium；新增 P0-B0 mock env audit 步骤（先验证现有 jwt-helper/parity-bridge/smoke 是否能承载 needsBody + route-param 解析），audit 结果入 PR description | RH0 |
| kimi-R4 | kimi | RH3 migration 009 slug data fill SQL 未细化 | fixed | RH3 §4.1 P3-01 给出完整 forward-only SQL 序列：(1) ADD COLUMN team_name NOT NULL DEFAULT ''；(2) ADD COLUMN team_slug TEXT (允 NULL)；(3) UPDATE 现有行 fill slug = `lower(substr(replace(team_name,' ','-'),1,25)) \|\| '-' \|\| lower(hex(randomblob(3)))`；(4) CREATE UNIQUE INDEX；(5) D1 不支持 ALTER COLUMN NOT NULL，由 application layer 保证后续行非空 | RH3 |
| kimi-R5 | kimi | RH5 模型 catalog 验证手段缺失 | fixed | RH5 §4.2 P5-04 加 "seed 前置验证"：`wrangler ai models --json \| jq -r '.[].name'` 比对 25 model_id；任何 catalog 缺的 model_id 在 migration 内标 `disabled=1`（不省略，留可观测） | RH5 |
| GLM-R5/R6/R8/R9 | GLM | 各类行号偏移 | partially-fixed | 通过 R1/R5/R7 的"行号 2026-04-29 快照"全局声明覆盖；不逐处校正（RH0 拆分会让所有行号漂移，逐处校对 ROI 低） | RH0-RH6 |
| kimi-R1（QNA 业主回答空白部分）| kimi | RHX-qna 5 道业主答全空白 | stale-rejected | 业主已在 design rereview 阶段（2026-04-29 早些时段）显式签字同意 Opus Q1-Q5 全部判断（含 Opus 在 Q1 加的 NOT NULL UNIQUE 约束、Q2 4 项限定、Q3 usage event 完整字段集、Q4 4 项限定、Q5 8 步 + 失败处置政策）。本轮 7 份 action-plan header 已加 "业主已签字 QNA" 前提声明；本 finding 是审查时序（kimi review 时刻 RHX 文件未回填业主答）造成的，本轮不需修订 |
| kimi-R8 | kimi | RH4 sunset 触发依赖 Q2 未回答 | stale-rejected | 同 kimi-R1：Q2 已签字（≤2 周 + 4 限定全部采纳）；RH4 §0 / §6 已显式声明业主同意 Q2 |

### 6.3 Blocker / Follow-up 状态汇总

| 分类 | 数量 | 编号 | 说明 |
|------|------|------|------|
| 已完全修复 | 21 | GPT R1-R10 全部 / deepseek R1/R3/R5/R6/R7 / GLM R2/R4/R7/R10/R11/R12 / kimi R3/R4/R5 | 21 项 finding 各对应一段 in-place edit |
| 部分修复 | 1 | GLM R1/R5/R6/R8/R9 行号偏移 | 通过全局声明覆盖；不逐处校对 |
| 拒绝 / stale-rejected | 2 | kimi R1（QNA 业主答空白） / kimi R8（Q2 依赖）| 业主已签字；审查时序差 |
| 仍 blocked | 0 | — | — |

### 6.4 变更文件清单

- `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md` — 7 份 endpoint test (charter 命名) + bootstrap-hardening 移到 orchestrator-auth + ≤1500 hard gate + lockfile 4 步联检 + madge 预装 + mock env audit
- `docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md` — 跨 worker push 拓扑修正（agent-core 新增 ORCHESTRATOR_CORE binding；RPC 在 orchestrator-core 默认 export WorkerEntrypoint）+ /usage strict snapshot D1 失败 503
- `docs/action-plan/real-to-hero/RH2-models-context-inspection.md` — heartbeat schema 复用澄清 + terminal 复用 session.end + attachment.superseded 新增 + context-core 3 RPC method 显式新增 + client adapter audit
- `docs/action-plan/real-to-hero/RH3-device-auth-gate-and-api-key.md` — `nano_team_memberships` 表名修正 + Web Crypto base36 实现 + migration 009 forward-only data-fill SQL + conversations 双源差异分析步骤
- `docs/action-plan/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md` — `SessionFileStore` 新接口（不复用 sync ArtifactStore）+ 25MiB 归因修正 + adapter canonical 来源对账 + context-core library_worker 联动
- `docs/action-plan/real-to-hero/RH5-multi-model-multimodal-reasoning.md` — `SessionMessagePostBodySchema` 新增 + WorkersAiGateway 注入路径 + ImageUrlContentPart 澄清 + Workers AI catalog 验证命令
- `docs/action-plan/real-to-hero/RH6-do-megafile-decomposition.md` — evidence 路径对齐 charter §7.7 + hero-to-platform gate 表述修正 + madge 移到 RH0 baseline
- 全局：行号声明 + 业主已签字 QNA 前提 + tests/cross-worker → test/cross-e2e

### 6.5 验证结果

| 验证项 | 命令 / 证据 | 结果 | 覆盖的 finding |
|--------|-------------|------|----------------|
| 表名核实 | `grep "nano_user_teams\|nano_team_memberships" workers/orchestrator-core/migrations/001-identity-core.sql` | pass — 仅 `nano_team_memberships` 存在；`nano_user_teams` 0 匹配 | GPT-R7 |
| ImageUrlContentPart 核实 | `grep "ImageUrlContentPart\|image_url" workers/agent-core/src/llm/canonical.ts` | pass — `kind: "image_url"` 在 ContentPartKind:18；`ImageUrlContentPart` 在 :25 | GLM-R10 |
| heartbeat schema 核实 | `grep "SessionHeartbeatBodySchema\|session.heartbeat" packages/nacp-session/src/messages.ts` | pass — `SessionHeartbeatBodySchema` 在 :61-64；已注册 SESSION_BODY_SCHEMAS / SESSION_BODY_REQUIRED / SESSION_MESSAGE_TYPES | GPT-R6 |
| ORCHESTRATOR_USER_DO binding 核实 | `grep "ORCHESTRATOR_USER_DO\|services" workers/{agent-core,orchestrator-core}/wrangler.jsonc` | pass — agent-core 仅 BASH_CORE active；ORCHESTRATOR_USER_DO 仅在 orchestrator-core；agent-core 必须新增 ORCHESTRATOR_CORE service binding（不能直接绑 ORCHESTRATOR_USER_DO） | GPT-R4 |
| charter §7.1 endpoint baseline 数 | `grep "≥7 文件\|≥35 用例" docs/charter/plan-real-to-hero.md` | pass — line 193 + 363 + 376 全部 ≥7 / ≥35 | GPT-R1 |
| charter §7.1 bootstrap 路径 | `grep "orchestrator-auth/test/bootstrap-hardening" docs/charter/plan-real-to-hero.md` | pass — line 368 锁定 orchestrator-auth | GPT-R2 |
| charter ≤1500 行 gate | `grep "≤1500\|≤ 1500" docs/charter/plan-real-to-hero.md` | pass — line 99/320/349/376 全 ≤1500 | GPT-R3 |
| evidence path 核实 | `grep "evidence/{web,wechat-devtool,real-device}-manual" docs/charter/plan-real-to-hero.md` | pass — line 179/674/326 全部 charter §7.7 路径 | GPT-R10 |
| storage adapter 双源 byte-diff | `diff packages/storage-topology/src/adapters/r2-adapter.ts workers/filesystem-core/src/storage/adapters/r2-adapter.ts` | pass — 0 差异（截至 2026-04-29 byte-identical） | deepseek-R3 |
| tests/cross-worker 残留 | `grep -rn "tests/cross-worker" docs/action-plan/real-to-hero/` | pass — 0 匹配（已全替换为 `test/cross-e2e`） | GLM-R4 / kimi-R2 |

```text
所有 10 项验证 = pass。无 build / test 命令执行（本轮仅文档修订）。
代码层验证以 grep / diff / cat / wc -l 为主，所有事实声明均经核查。
```

### 6.6 未解决事项与承接

| 编号 | 状态 | 不在本轮完成的原因 | 承接位置 |
|------|------|--------------------|----------|
| GLM R1/R5/R6/R8/R9 行号偏移 | partial-fix | 全局声明已覆盖；逐处校对 ROI 低（RH0 拆分本身会让所有行号漂移）| 各 phase action-plan 实施 PR 时以 grep / 函数名重新定位 |
| kimi R1 (QNA 业主答空白时序) | stale-rejected | 业主已显式签字同意 Opus Q1-Q5 路线 | RHX-qna.md（已含业主回答内容）|
| kimi R8 (Q2 依赖) | stale-rejected | 同上 | 同上 |

### 6.7 Ready-for-rereview gate

- **是否请求二次审查**：`yes`
- **请求复核的范围**：`all GPT R1-R10 findings + 本回应 §6.2 表中 fixed 的 21 项`
- **实现者认为可以关闭的前提**：
  1. 同 reviewer 重读 RH0-RH6 7 份 action-plan，确认 GPT R1-R10 全部 fixed
  2. 同时核验 deepseek/GLM/kimi 独家发现的 11 项也已并入对应 RH 文件
  3. 对 kimi R1/R8 的 stale-rejected 决议确认（业主签字证据见 RHX-qna §Q1-Q5 业主回答栏）

> **修订后 7 份 action-plan 已 ready-for-rereview**：请同 reviewer 复核 §6.2 / §6.4 列出的修改是否真正解决 §2 列出的 10 项 finding；如确认无新 blocker，本轮 review 可关闭，进入 RH0 implementation。

---

## 7. 审查质量评估（appended by Opus 4.7, 2026-04-29）

> 本附录由 implementer 在完成 4 份 action-plan review 全部 finding 核实与修订后回填，依据 `docs/templates/code-review-eval.md`。

### 7.0 评价结论

- **一句话评价**：4 份 action-plan review 中"治理纪律最强 + 全部命中 charter hard gate + 0 false-positive"的一份；R1-R10 全部 true-positive 且各对应一处 charter / code-reality 的真实漂移，是 4 份 review 中可直接落到 RH0 implementation 之前必修清单的唯一一份。
- **综合评分**：`9.5 / 10`
- **推荐使用场景**：action-plan 进入 implementation 前的最后一道 gate；charter alignment hard-gate 复核；schema / migration / RPC topology 漂移探测。
- **不建议单独依赖的场景**：纯流程改进（lockfile 验证多步、行号有效期）由 deepseek 补强；客户端 adapter 工作量评估由 GLM 补强。

### 7.1 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | charter hard-gate alignment + RPC topology + schema reality | R1（§7.1 7-file 35-case）、R2（§7.1 orchestrator-auth path）、R3（≤1500 hard gate）、R4（agent-core 不存在 USER_DO binding）|
| 证据类型 | charter line:N + worker file:line + 反向 grep | "charter line 368 锁定 orchestrator-auth"+"agent-core wrangler 仅 BASH_CORE active" |
| Verdict 倾向 | strict + 严谨 verdict 校准 | 10 finding 中 8 标 yes blocker；高/中/低 = 6/3/1 分布合理 |
| Finding 粒度 | balanced，但偏向"实施阶段必爆"的真实漂移 | R7（base36 randomBytes 不可用 + 表名错）、R8（implements 接口不兼容）|
| 修法建议风格 | actionable + 给"两条路决议结构" | R8 给"不复用 ArtifactStore 接口 → 新接口"+ "25MB 改为 first-wave 产品策略而非 R2 限制"|

### 7.2 优点与短板

#### 7.2.1 优点

1. **R1-R10 100% true-positive，0 false-positive**：每条 finding 都有 charter / 代码双向证据；实施时可直接信任，不需 implementer 二次验证。
2. **4 reviewer 中唯一覆盖 4 类 charter hard-gate**：R1（≥7 文件 ≥35 case）、R2（orchestrator-auth bootstrap path）、R3（≤1500 行）、R10（charter §7.7 evidence path）—— 这 4 项如果不修，RH0 closure 会被 charter 自身的 §10.3 NOT-成功退出条款卡住。
3. **R4 是 4 份 review 中最高价值的单一 finding**：跨 worker push 拓扑错误（agent-core 直接绑 USER_DO 不可达）—— 不只是 binding 命名问题，而是把 owner 同意的 RPC 路径完全重写。这条若不修，RH1 P1-D 会在实施一半时才暴露 transport 不可达。
4. **修法建议保持设计层次**：例如 R8 给出"新接口 SessionFileStore 而非 implements ArtifactStore"+"25MB 改为产品策略"，让 implementer 理解 *为什么* 改，不只是改什么。
5. **owner QNA 处理正确**：明确写 "不要把 owner 尚未回答 QNA 当 blocker；真正 blocker 是设计文档自身对 charter / code reality 的少数漏承接" —— 这是用户在审查指令中的要求；GPT 严格遵守，对照 kimi R1/R8 的 QNA 误判形成鲜明对比。

#### 7.2.2 短板 / 盲区

1. **adapter 来源对账缺失**：deepseek R3 独家发现 `packages/storage-topology/src/adapters/` 与 `workers/filesystem-core/src/storage/adapters/` 同时存在；GPT R8 只说接口不兼容，未发现这层 canonical-source 漂移。
2. **行号有效期免责声明未提**：deepseek R5 / kimi R7 提；GPT 未提。这条不是错，但作为"上线前最后一道 gate"应该想到。
3. **客户端 adapter 工作量评估未提**：GLM R12 独家。GPT 关注协议正确性，未关注客户端实施工作量。
4. **slug data fill SQL 未细化**：kimi R4 独家给出完整 forward-only SQL 序列；GPT R7 只说 base36 实现要改，未给可执行 SQL。

### 7.3 Findings 质量清点

| 编号 | 原始严重 | 事后判定 | Finding 质量 | 分析 |
|------|---------|----------|--------------|------|
| R1 | high | true-positive | excellent | charter §7.1 line 360-378 三处明确 ≥7 文件 ≥35 case；命名 `*-route.test.ts`；本 finding 直接驱动 RH0 §1.5/§2.1 [S4]/§3 工作总表/§4.4/§5.4/§8 全部重写 |
| R2 | high | true-positive | excellent | charter §7.1 line 368 锁定 `workers/orchestrator-auth/test/`；directly blocking |
| R3 | medium | true-positive | excellent | charter line 99/320/349/376 全部 ≤1500；不允许在 action-plan 静默放宽到 1600 |
| R4 | critical | true-positive | excellent | 4 份 review 中**最高价值 finding**；reverse-correctness 级别 |
| R5 | high | true-positive | excellent | strict snapshot vs success-shaped fallback；charter §9.5 直接对应 |
| R6 | high | true-positive | excellent | heartbeat schema 实际已存在但 terminal/superseded 未注册 —— 拆三类工作量分配是关键洞察 |
| R7 | high | true-positive | excellent | 双重 finding：表名错（`nano_user_teams` 不存在；`nano_team_memberships` 是真名）+ `Buffer.toString('base36')` Workers runtime 不可用；任一未修都会让 PR 编译失败 |
| R8 | medium | true-positive | excellent | TypeScript implements 不兼容 + 25MB 错误归因（KV adapter 限制不是 R2 putParallel）|
| R9 | high | true-positive | excellent | schema 不存在 + WorkersAiGateway 注入路径未落；本 finding 让 RH5 P5-01/P5-05 重写 |
| R10 | medium | true-positive | good | evidence 路径 + hero gate 表述；非 blocker 标记合理 |

### 7.4 多维度评分

| 维度 | 评分 | 说明 |
|------|------|------|
| 证据链完整度 | 10 | charter line:N + 代码 file:line + 反向 grep 三向证据全配套 |
| 判断严谨性 | 10 | 0 false-positive；critical/high/medium 分布与实际修订成本对齐 |
| 修法建议可执行性 | 9 | 多数给"两条路决议结构"；R10 略简 |
| 对 action-plan / design / QNA 的忠实度 | 10 | 明确遵守用户"owner QNA 不阻断"指令；charter 段落引用全部正确 |
| 协作友好度 | 9 | 10 finding 数量恰当；不过度 prescribe |
| 找到问题的覆盖面 | 9 | charter hard-gate + RPC topology 全覆盖；adapter 来源对账与客户端工作量缺位 |
| 严重级别 / verdict 校准 | 10 | changes-requested + 8 yes blocker / 2 medium / 1 low 校准准确 |

**综合**：`9.5 / 10`。GPT 是 4 份 review 中**唯一可被业主直接转发给 implementer 当作"上线前最后一道 hard gate"** 的版本——10 项 finding 全部 true-positive、charter alignment 完整、RPC 拓扑级 critical 独家。配合 deepseek 的 adapter 对账 / kimi 的 SQL 模板 / GLM 的 context-core RPC，4 份合用价值远超单份。

