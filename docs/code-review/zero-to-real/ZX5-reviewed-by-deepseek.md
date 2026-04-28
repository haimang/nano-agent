# Nano-Agent 代码审查 — ZX5 全阶段 + zero-to-real 跨阶段回顾

> 审查对象: `ZX5 Protocol Hygiene + Product Surface + Architecture Refactor — 全 4 Lane`
> 审查类型: `code-review + closure-review + cross-stage-audit`
> 审查时间: `2026-04-28`
> 审查人: `deepseek`
> 审查范围:
> - `packages/jwt-shared/`、`packages/orchestrator-auth-contract/`（Lane C）
> - `workers/orchestrator-{core,auth}/`、`workers/context-core/`、`workers/filesystem-core/`（Lane C/D/E）
> - `workers/agent-core/src/host/`（Lane F）
> - `clients/web/`、`clients/wechat-miniprogram/`（Lane C）
> - `scripts/deploy-preview.sh`、`docs/runbook/zx5-r28-investigation.md`（Lane D/F）
> 对照真相:
> - `docs/action-plan/zero-to-real/ZX5-protocol-hygiene-product-surface-architecture.md`（执行文件）
> - `docs/issue/zero-to-real/ZX5-closure.md`（收尾文件）
> - `docs/issue/zero-to-real/ZX4-closure.md`（上游衔接）
> - `docs/action-plan/zero-to-real/ZX2-*, ZX3-*, ZX4-*`（zero-to-real 系列全景）
> - Q1-Q11 owner direction answers（行动计划的冻结决策）
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**: ZX5 主体成立，代码产出扎实，2055 测试全绿。但存在 3 个**硬伤级** gap（R1/R3/R5）与若干中等/低等偏差，当前不应标记为"全部 done/零挂账"，而应回归为"核心骨架完成，部分功能链路断裂"。
- **结论等级**: `approve-with-followups`
- **是否允许关闭本轮 review**: `no`（需先处理硬伤，再重打收口标签）
- **本轮最关键的 3 个判断**:
  1. **D3 `/messages` endpoint 仅写 D1，不转发到 agent-core**——这是一个**硬断裂**，该端点成了"只能存不能跑"的数据墓碑。
  2. **`recordUserMessage` 的 role 判定逻辑未随 `message_kind` 扩展同步更新**——导致 `/messages` 写入的所有消息 `role = "system"` 而非 `"user"`。
  3. **`/input` 未按 Q8 冻结归一化为 `/messages` 的 alias**——两个入口各自独立写表，`/input` 用旧 kind `"user.input"`，`/messages` 用新 kind `"user.input.text"`/`"user.input.multipart"`，造成消息分类体系分裂。

---

## 1. 审查方法与已核实事实

- **对照文档**:
  - `docs/action-plan/zero-to-real/ZX5-protocol-hygiene-product-surface-architecture.md`
  - `docs/issue/zero-to-real/ZX5-closure.md`
  - Q8/Q9/Q10/Q11 owner direction answers
- **核查实现**:
  - `packages/jwt-shared/src/index.ts` + `test/jwt-shared.test.ts`
  - `workers/orchestrator-core/src/auth.ts`、`user-do.ts`、`session-truth.ts`、`index.ts`、`catalog-content.ts`
  - `workers/orchestrator-auth/src/jwt.ts` + `test/kid-rotation.test.ts`
  - `packages/orchestrator-auth-contract/src/facade-http.ts` + `README.md`
  - `workers/context-core/src/index.ts`、`workers/filesystem-core/src/index.ts`
  - `workers/agent-core/src/host/do/nano-session-do.ts`、`hooks/permission.ts`、`host/runtime-mainline.ts`
  - `clients/web/src/client.ts`、`clients/web/src/heartbeat.ts`
  - `clients/wechat-miniprogram/utils/nano-client.js`、`heartbeat-adapter.js`
  - `scripts/deploy-preview.sh`
  - `docs/runbook/zx5-r28-investigation.md`
  - `workers/orchestrator-core/migrations/007-user-devices.sql`
- **执行过的验证**:
  - grep 全文搜索 `emitServerFrame`、`onUsageCommit`、`recordUserMessage`、`inferMessageRole`、`user.input`、`handleMessages`、`forwardInternal` 等关键词
  - 交叉对比 action-plan §7.2 收口标准 vs 实际代码
  - 交叉对比 Q8 冻结的三条语义 vs D3 实际实现
- **复用 / 对照的既有审查**: 本审查完全独立，未采纳 GPT/kimi/GLM/deepseek 之前的分析结论作为事实依据。仅将 ZX4 closure + 4-reviewer 报告作为上下游背景理解。

### 1.1 已确认的正面事实

- `@haimang/jwt-shared` package 创建完整，API 设计合理（174 行 src + 20 unit test 全绿），确实将原本在 orchestrator-core/auth.ts 的 73 行与 orchestrator-auth/jwt.ts 的 53 行重复实现收拢到单一源。
- C2 两 worker 切换后 import 关系清晰：orchestrator-core 用 `collectVerificationKeys` + `verifyJwtAgainstKeyring`；orchestrator-auth 用全部 primitive + 保留 worker-specific `AccessTokenClaims` normalization。
- C3 kid-rotation 测试 5 条 case 覆盖 graceful overlap / post-overlap reject / legacy fallback / tampered reject，无遗漏。
- C4 `_rpcErrorCodesAreFacadeCodes` 跨包编译期断言已落位，TS `extends never` 模式正确，确实做 build-time guard。
- C5 envelope 关系 `README.md` 文档化质量高，ASCII 图 + 三种形态表 + helper 说明 + 升级规则完整。
- C6 web/wechat 客户端 heartbeat 迁移采用了 local mirror（TypeScript class + JS 1:1 镜像），符合"运行时不直接 import npm package"的现实约束。
- D1 `scripts/deploy-preview.sh` 120 行完整，6 worker deploy order 正确，GIT_SHA 自动解析 + dirty 后缀合理。
- D2 catalog-content.ts 填了 11 entries × 3 kinds，动态 import 加载，smoke test 已更新。
- D5 `/me/conversations` 完全复用 `D1SessionTruthRepository.listSessionsForUser` + conversation 维度 group by，不新建平行表（per Q5）。
- D6 device 体系：migration 007 中的 `nano_user_devices` + `nano_user_device_revocations` 两表 schema 完整，`GET /me/devices` + `POST /me/devices/revoke` 的 handler 有 ownership check + idempotent（already_revoked）。
- E1/E2 context-core / filesystem-core 升级为 `WorkerEntrypoint` RPC 类完整，minimal seam 设计正确（probe/nacpVersion/assemblerOps/filesystemOps）。
- F4 `claimPendingForStart` 的 D1 `UPDATE WHERE session_status='pending'` 原子争用逻辑正确，两份 unit test 覆盖 winner/loser。
- F5 R28 runbook 模板 140 行完整，步骤清晰（wrangler tail + 复现 + stack trace 抓取 + 根因分类 + 修法三选一）。
- 2055 tests 全绿，worker 数量 = 6（`ls workers/` 不增加），`@haimang/jwt-shared` 作为第 7 个 keep-set package 落位。

### 1.2 已确认的负面事实

- **D3 `/messages` 不转发 agent-core**：`user-do.ts:handleMessages` 在 `recordUserMessage` + `appendDurableActivity` 后直接返回 200（line 1609-1617），未调 `forwardInternalJsonShadow('input', ...)` 或任何 agent-core RPC。对比 `handleInput` 在 line 1002-1013 调 `forwardInternalJsonShadow` 将用户输入送进 agent-core。`/messages` 成了"只存表不跑模型"的端点。
- **`recordUserMessage` role 判定 bug**：`user-do.ts:373` 的 `role: kind === 'user.input' ? 'user' : 'system'` 在用新 kind `'user.input.text'`/`'user.input.multipart'` 时判定失败，消息 `role` 被错误设为 `"system"`。
- **`/input` 未归一化到 `/messages`**：Q8-1 明确要求 `/input` 保留为兼容别名并服务端归一化，但实际代码 `handleInput` 仍有完全独立的 handler 路径，与 `handleMessages` 无任何 alias/转发/归一化关系。
- **`/input` 用旧 kind `'user.input'`**：`user-do.ts:984` 的 `recordUserMessage` 调用的 kind 参数仍为 `'user.input'`，与 `/messages` 的新 taxonomy `'user.input.text'`/`'user.input.multipart'` 不一致。
- **F3 `onUsageCommit` callback 已 invoke 但 `emitServerFrame` wire-up 未完成**：nano-session-do.ts 中无 `emitServerFrame` import 或调用。closure §3.2 已 acknowledge 为"wire-up 留 future PR"。
- **F1/F2 hook dispatcher 集成未完成**：`hooks/permission.ts` 仍是 ZX0/B5 的 `verdictOf(outcome)` 同步 fail-closed 路径，未调 `nanoSessionDo.emitPermissionRequestAndAwait()`。closure §3.2 acknowledge。
- **E1/E2 仅为 minimal seam**：context-core/filesystem-core RPC method 只返回 op 名单，无实际业务体。agent-core 仍通过 in-process library import 调用。closure §3.2/风险表 acknowledge。
- **D4 `/files` 仅返 metadata 无 bytes**：closure 和风险表已 acknowledge R2 binding 缺失，current state 为 by-design。
- **D6 revoke 后 active session 不断开**：仅写入 D1 状态，不触发 best-effort session 断开。closure acknowledge 为"second-half / 第二次 PR"。
- **F5 R28 根因未定位**：runbook 模板存在但 owner 尚未回填实质性 stack trace/根因。closure acknowledge 为 owner-action template。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 全部 Lane 的核心文件逐行阅读，对照 action-plan §1.2/§3/§7.2 的收口标准 |
| 本地命令 / 测试 | yes | `grep` 交叉搜索 `recordUserMessage`、`inferMessageRole`、`emitServerFrame`、`onUsageCommit`、`handleMessages`、`forwardInternal` 等关键符号 |
| schema / contract 反向校验 | yes | 核对 Q8 冻结 vs 实际 code；核对 `recordUserMessage` role 判定逻辑 vs kind 扩展 |
| live / deploy / preview 证据 | no | sandbox 拒 wrangler tail，无 live 证据 |
| 与上游设计 / QNA 对账 | yes | Q8（D3 语义冻结）、Q9（D6 device model freeze）、Q10（alarm-driven）、Q11（D1 conditional UPDATE）均已逐项对账 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | `/messages` 端点仅写 D1 不转发 agent-core，导致消息无法被 LLM 处理 | **critical** | correctness | **yes** | 在 `handleMessages` 内追加 `forwardInternalJsonShadow('input', ...)` 调用 |
| R2 | `recordUserMessage` role 判定逻辑未适配新的 `message_kind` 扩展 | **high** | correctness | **yes** | 将 `kind === 'user.input'` 改为 `kind.startsWith('user.input')` |
| R3 | `/input` 未按 Q8 归一化为 `/messages` 的 alias | high | scope-drift | no | 要么代码归一化 `/input → /messages`，要么 closure 更新承认两者独立并存 |
| R4 | `/input` 与 `/messages` 使用不同的 `message_kind` 分类，`/input` 用旧 `'user.input'` | medium | protocol-drift | no | 统一 `/input` 的 `recordUserMessage` 也使用 `'user.input.text'` |
| R5 | `handleMeConversations` 的 orchestrator-core→User-DO 传参路径依赖 KV 持久化而非请求内 header | medium | correctness | no | User-DO 应在 `/me/conversations` 路径中读取 `x-nano-internal-authority` header |
| R6 | F3 `emitServerFrame('session.usage.update')` wire-up 缺失 | medium | delivery-gap | no | 在 `nano-session-do.ts` 的 `onUsageCommit` 回调中补 `emitServerFrame` |
| R7 | F1/F2 hook dispatcher 未接 `emitPermissionRequestAndAwait` / `emitElicitationRequestAndAwait` | medium | delivery-gap | no | `hooks/permission.ts` 改造为在 `PermissionRequest` 时调 DO 的 wait-and-resume |
| R8 | `claimPendingForStart` 缺少 `started_at` 条件守卫 | low | correctness | no | Q11(b) 原文含 `AND started_at = :minted_at`，当前实现只有 `WHERE session_status='pending'` |

### R1. `/messages` 端点仅写 D1 不转发 agent-core

- **严重级别**: critical
- **类型**: correctness
- **是否 blocker**: yes
- **事实依据**:
  - `workers/orchestrator-core/src/user-do.ts:1501-1617`：`handleMessages` 在 `recordUserMessage` + `appendDurableActivity` 后直接 `return jsonResponse(200, {...})`。
  - `workers/orchestrator-core/src/user-do.ts:1002-1013`：`handleInput` 在同等位置调 `forwardInternalJsonShadow(sessionUuid, 'input', {...}, 'input')` 将消息送入 agent-core。
  - grep 确认 `handleMessages` 函数体内无任何 `forwardInternal` 调用。
- **为什么重要**:
  - `/messages` 的业务语义是"多模态消息输入"，调用方期望消息被 agent runtime 处理。当前实现将消息写入 D1 后即返回 200，但消息永不被 agent-core LLM 消费，变成**数据墓碑**。
  - 这直接违反 Q8-3 的"session-running ingress"语义——如果消息不被处理，`/messages` 就等于一个无响应的 write-only sink。
- **审查判断**:
  - 这不是"partial-by-design"或"deferred follow-up"，而是**对 action-plan 收口标准的实质未达成**。ZX5 plan §7.2 Lane D 收口标准第 3 条要求 "`POST /sessions/{id}/messages` 业务实现 + facade-http-v1 envelope 包装"，但"数据写入"不等于"业务实现"。
- **建议修法**:
  - 在 `handleMessages` 的 `recordUserMessage` 之后，仿照 `handleInput` 的 RPC 转发路径，调 `forwardInternalJsonShadow(sessionUuid, 'input', { text: combinedText, ...body on agent-core side }, 'input')`。
  - 对于 multipart 消息，需要先将 text parts 拼接为 `text` 字段（agent-core 当前 `input` RPC 只接受 `{text}` shape），artifact_ref 部分作为 meta 附加。

### R2. `recordUserMessage` role 判定逻辑未适配新的 `message_kind`

- **严重级别**: high
- **类型**: correctness
- **是否 blocker**: yes
- **事实依据**:
  - `workers/orchestrator-core/src/user-do.ts:373`: `role: kind === 'user.input' ? 'user' : 'system'`
  - `workers/orchestrator-core/src/user-do.ts:360`: `kind` 类型为 `'user.input' | 'user.cancel' | 'user.input.text' | 'user.input.multipart'`
  - 当 `kind === 'user.input.text'` 或 `'user.input.multipart'` 时，`kind === 'user.input'` 为 `false`，role 被设为 `'system'`。
  - `/messages` 端点（line 1589-1595）传入的是 `'user.input.text'` / `'user.input.multipart'`。
- **为什么重要**:
  - 消息 role 错标为 `system` 会污染 history read 的正确性（`GET /sessions/{id}/history` 返回的 `message_role` 字段），前端/agent 上下文组装依赖此字段区分 user/assistant/system。
  - 这是一个**在任何测试中都可能未被发现**的回归——因为 D3 相关的集成测试缺失（closure 声称测试通过，但 `/messages`→agent-core→response 的 full-loop 从未被测试覆盖）。
- **审查判断**:
  - 属 kind 类型扩展后未同步更新判定逻辑的典型遗漏。
- **建议修法**:
  - 将 line 373 的 `kind === 'user.input'` 改为 `kind.startsWith('user.input')`：
    ```ts
    role: kind.startsWith('user.input') ? 'user' : 'system',
    ```

### R3. `/input` 未按 Q8 归一化为 `/messages` 的 alias

- **严重级别**: high
- **类型**: scope-drift
- **是否 blocker**: no（可在文档层面更新 closure 声明）
- **事实依据**:
  - Q8-1 owner answer: "`/messages` 是 `/input` 的多模态超集，`/input` 保留为兼容别名并在服务端归一化到 `/messages` 的 text-only 形态，不再走第二套落库路径。"
  - `workers/orchestrator-core/src/user-do.ts:952-1075`：`handleInput` 有完全独立的 handler 路径，包含独立的 `createDurableTurn` + `recordUserMessage` + `forwardInternalJsonShadow('input', ...)`，无任何 forwarding/aliasing 到 `handleMessages`。
  - 两个 handler 各自独立写 `nano_conversation_messages`，但 `/input` 用 kind `'user.input'`，`/messages` 用 kind `'user.input.text'`/`'user.input.multipart'`。
- **为什么重要**:
  - Q8 的决定是"不再走第二套落库路径"，但实际代码维护了两套独立的 handler，各有一套 D1 写入逻辑。这导致：
    - 未来必须同步维护两套 handler 的 D1 schema 变化
    - `/input` 没有 `/messages` 的多模态能力但 API surface 仍存在
    - kind taxonomy 分裂
- **审查判断**:
  - 要么在代码层实现归一化（`handleInput` 构造等效 `{parts: [{kind:'text', text}]}` 后调 `handleMessages`），要么 closure 更新声明承认当前状态为两者的独立并存（而非 alias 归一化）。
- **建议修法**:
  - 推荐前者：`handleInput` 在验证 body.text 后构造 `parts: [{ kind: 'text', text: body.text }]`，然后调用 `handleMessages` 内部共享逻辑（或者直接重定向到 handleMessages）。

### R4. `/input` 与 `/messages` 使用不同的 `message_kind` 分类

- **严重级别**: medium
- **类型**: protocol-drift
- **是否 blocker**: no
- **事实依据**:
  - `user-do.ts:984`: `/input` 调用 `recordUserMessage` 时 kind = `'user.input'`
  - `user-do.ts:1577`: `/messages` 调用 `recordUserMessage` 时 kind = `'user.input.text'` 或 `'user.input.multipart'`
- **为什么重要**:
  - 同一张 `nano_conversation_messages` 表出现两种分类体系，未来按 `message_kind` 过滤查询时必须同时处理 `'user.input'` 和 `'user.input.text'`，增加调用方歧义和维护成本。
- **审查判断**:
  - 若 R3 归一化实现，此问题自然消除。若保持两条路径独立，至少应统一 kind 值。
- **建议修法**:
  - 将 `/input` 的 `recordUserMessage` 调用的 kind 改为 `'user.input.text'`（保持同表同分类）。

### R5. `handleMeConversations` User-DO 路径未读取 orchestrator-core 传入的 authority header

- **严重级别**: medium
- **类型**: correctness
- **是否 blocker**: no
- **事实依据**:
  - `workers/orchestrator-core/src/index.ts:619-626`：`handleMeConversations` 发送 `x-nano-internal-authority` header 到 User-DO
  - `workers/orchestrator-core/src/user-do.ts:137-147`：User-DO 的 `/me/conversations` fetch 路由不读取任何 request header
  - `workers/orchestrator-core/src/user-do.ts:1784-1798`：`handleMeConversations` 通过 `await this.get<IngressAuthSnapshot>(USER_AUTH_SNAPSHOT_KEY)` 获取 authority
- **为什么重要**:
  - 若用户在调用 `/me/conversations` 前未执行任何 session start（即 KV 中无 `USER_AUTH_SNAPSHOT_KEY`），DO 拿不到 authority，返回空 `{conversations: []}`。但 orchestrator-core 已通过 `authenticateRequest` 完成了 JWT 验证，这导致了**不必要的功能静默降级**。`forwardInternalRaw` 等其他路径通过 `x-nano-internal-authority` 头传递 authority 并正确工作，但 `/me/conversations` 路径不一致。
- **审查判断**:
  - 虽然 DO 端有 graceful fallback 到空数组，但这降低了 `/me/conversations` 在首次使用的可用性（例如用户登录后直接看对话列表）。
- **建议修法**:
  - User-DO `/me/conversations` fetch 路由中读取 `x-nano-internal-authority` header 并优先使用（fallback 到 KV 作为无 header 时的兼容路径）。

### R6. F3 `emitServerFrame('session.usage.update')` wire-up 缺失

- **严重级别**: medium
- **类型**: delivery-gap
- **是否 blocker**: no（已在 closure §3.2 acknowledge）
- **事实依据**:
  - `workers/agent-core/src/host/runtime-mainline.ts:246-251,329-339`：`onUsageCommit` callback 被 invoke
  - grep 确认 `workers/agent-core/src/host/do/nano-session-do.ts` 中无 `emitServerFrame` import 或调用
  - `workers/orchestrator-core/src/user-do.ts:1266`：`emitServerFrame` 定义在 orchestrator-core 的 User-DO 中，但 agent-core 的 NanoSessionDO **没有**对应的 `emitServerFrame` 方法
- **为什么重要**:
  - `onUsageCommit` 已正确触发，但 caller（NanoSessionDO）没有接上推送路径。前端仍只能用 `GET /sessions/{id}/usage` 拉取，无法实时收到 usage 推送。F3 的实际目标（ZX5 plan §2.1: "前端 WS attach 后能 live update 预算字段"）**未达成**。
- **审查判断**:
  - closure 已 acknowledge 此状态。但 action-plan §7.2 Lane F 收口标准第 3 条说"runtime emit `session.usage.update` server frame + client live update e2e"，closure 标记为 ✅ 而实际上仅 callback 已接通、emit 未通。建议 closure 修改该条状态为 partial。
- **建议修法**:
  - 不在本次强制修复。closure 将该条标记从 ✅ done 改为 partial，纳入 ZX5+ follow-up。

### R7. F1/F2 hook dispatcher 未接 wait-and-resume infra

- **严重级别**: medium
- **类型**: delivery-gap
- **是否 blocker**: no（已在 closure §3.2 acknowledge）
- **事实依据**:
  - `workers/agent-core/src/hooks/permission.ts:50-58`：`verdictOf(outcome)` 仍是同步 fail-closed 路径
  - `workers/agent-core/src/host/do/nano-session-do.ts:771-803`：`emitPermissionRequestAndAwait` / `emitElicitationRequestAndAwait` 已实现
  - 二者之间无调用关系
- **为什么重要**:
  - ZX5 plan Lane F 的原始目标（§3 工作总表 F1-02/F2-01）是"PermissionRequest hook 改用 wait-and-resume"，但 closure `§1.4 Lane F` 和 `§3.2` 明确 acknowledge "infra 已就绪, hook 改造留后续 PR"。closure §0 TL;DR 的表述 "F1/F2 hook await/resume" 可能误导读者以为 hook 已改造完成。
- **审查判断**:
  - 与 R6 类似：closure 用词应精确。"infra 已 land，dispatcher 未集成"与"F1/F2 done"有本质差异。
- **建议修法**:
  - closure 的 §0 TL;DR 中"F1/F2 hook await/resume"改为"F1/F2 wait-and-resume infra land（hook dispatcher 集成留 follow-up）"。

### R8. `claimPendingForStart` 缺少 `started_at` 条件守卫

- **严重级别**: low
- **类型**: correctness
- **是否 blocker**: no
- **事实依据**:
  - ZX5 plan §5 Q11 (b) 原文：`UPDATE ... WHERE session_uuid = ?1 AND session_status = 'pending' AND started_at = ?2`
  - `workers/orchestrator-core/src/session-truth.ts:282-287`：实际 SQL 只有 `WHERE session_uuid = ?1 AND session_status = 'pending'`，无 `started_at` 条件
- **为什么重要**:
  - Q11 的 owner answer 说 "先不要进行这个 cache 层,同意在 D1 上复用"，但 Q11(b) 的 `started_at` 条件**不是 cache 层**，而是利用 D1 原子性的幂等守卫。没有它，重发请求只需命中"同 session_uuid + pending"即可，但不同时间 mint 的同 UUID（在非并发场景下不可能，但在并发场景下不提供额外的精确匹配保护）。这个缺失不会造成现有场景下的 bug（因为 `mintPendingSession` 写入的 `started_at` 不会变），但不完整。
- **审查判断**:
  - 低风险，不加 `started_at` 在当前场景下实际行为等价。
- **建议修法**:
  - 非必须修复。建议在 ZX5+ 时加上以完整对齐 Q11(b) 规范。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | C1 `@haimang/jwt-shared` package | done | 174 行 + 20 tests，API 完整 |
| S2 | C2 两 worker 切 jwt-shared | done | import 正确，保留 worker-specific narrowing |
| S3 | C3 kid rotation 集成测试 | done | 5 cases 覆盖 overlap/reject/legacy/tampered |
| S4 | C4 RpcErrorCode ⊂ FacadeErrorCode 跨包断言 | done | build-time guard 正确落地 |
| S5 | C5 envelope 关系文档化 | done | README 127 行 + nacp-core cross-link |
| S6 | C6 client heartbeat 切 shared helper | done | web/wechat 均用 local mirror 接入 |
| S7 | D1 deploy-preview.sh | done | 120 行，6 worker deploy order 合理 |
| S8 | D2 catalog content | done | 11 entries × 3 kinds |
| S9 | D3 POST /sessions/{id}/messages | **partial** | R1: 消息写 D1 但不转发 agent-core；R2: role 判定 bug |
| S10 | D4 GET /sessions/{id}/files | partial-by-design | metadata-only, R2 binding 需 owner 创建 |
| S11 | D5 GET /me/conversations | done | 复用 D1 listSessionsForUser，R5 为 minor gap |
| S12 | D6 /me/devices + /me/devices/revoke | partial-by-design | schema + endpoint 完成，active session 强断留 follow-up |
| S13 | E1 context-core WorkerEntrypoint RPC | partial-by-design | minimal seam only（per Q6 short-term shim） |
| S14 | E2 filesystem-core WorkerEntrypoint RPC | partial-by-design | 同上 |
| S15 | F1 PermissionRequest hook await/resume | **partial** | infra land，dispatcher 未集成（per closure §3.2） |
| S16 | F2 ElicitationRequest hook await/resume | **partial** | 同上 |
| S17 | F3 runtime emit session.usage.update | **partial** | onUsageCommit callback 已 invoke，emitServerFrame 未 wire |
| S18 | F4 handleStart idempotency | done | D1 conditional UPDATE 原子争用 + 2 tests |
| S19 | F5 R28 root cause investigation | partial-by-design | runbook template done，owner 未回填 |
| S20 | worker 总数 = 6 | done | `ls workers/` = 6 |

### 3.1 对齐结论

- **done**: 12
- **partial**: 6
- **partial-by-design**: 4
- **missing**: 0
- **stale**: 0
- **out-of-scope-by-design**: 0

ZX5 更接近"**核心骨架完整，但 `/messages` 的业务闭环在 agent-core forwarding 和 role 判定上有两处硬伤**"。Lane F 的 3 个 partial 项（F1/F2 dispatcher 未集成、F3 emit 未 wire）虽已在 closure 中 acknowledge，但它们使 Lane F 的收口字面偏差较大。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | 新 worker / 7-worker 拓扑 | **遵守** | `ls workers/` = 6，无 `workers/session-do/` 目录 |
| O2 | NanoSessionDO 提取 | **遵守** | R24 未触碰 |
| O3 | prod migration 006 / 007 apply | **遵守** | 不在 ZX5 phase 内，closure 标为 owner-action |
| O4 | D1 schema 大改动 / 新建平行表 | **遵守** | D3/D5 复用 `nano_conversation_messages` / `nano_conversation_sessions`；D6 建新表 `nano_user_devices` 符合 Q9 的"device truth 放 D1 表"决策，属允许范围内新建 |
| O5 | GitHub Actions deploy pipeline | **遵守** | 坚持 owner-local 路径，D1 为 `scripts/deploy-preview.sh`，未创建 `.github/workflows/deploy-preview.yml` |
| O6 | `pnpm-lock.yaml` stale importer block 清理 | **遵守** | closure 标 owner-action |
| O7 | WeChat 真机 smoke (R17) | **遵守** | carryover 状态不变 |
| O8 | `forwardInternalJsonShadow` 重命名 | **遵守** | 未触碰 |
| O9 | R2 bucket 创建 (D4 bytes) | **遵守** | closure 标 owner-action |

Out-of-Scope 各项全部遵守。

---

## 5. 跨阶段 / 跨包深度分析

### 5.1 zero-to-real 系列全景回顾

回顾 zero-to-real 从 ZX2 到 ZX5 的演进：

| 阶段 | 核心产出 | 当前状态 |
|------|----------|----------|
| ZX2 | auth + session truth + D1 baseline | done，保持 |
| ZX3 | 历史 package + test-legacy 物理删除 | done，保持 |
| ZX4 | transport 真收口 + session 语义 storage contract | done，保持 |
| ZX5 | proto/auth single source + product endpoints + runtime kernel hookup | **本文审查中** |

**跨阶段一致性判断**:
- ZX5 成功收束了 ZX2-ZX4 散落的 jwt 重复实现（R20/R21），这是系列中**最实质的代码质量提升**。
- 但 ZX4 的 session 语义 storage contract（P4/P5/P6）在 ZX5 Lane F 中**只完成了"存储侧"（ZX4 已 land）+"等待基础设施侧"（F1/F2 infra land），未完成真正的"运行时闭环"**——hook dispatcher 仍用同步 fail-closed 路径，usage emit 的 push 路径未通。
- D3 `/messages` 是系列中第一个"多模态入口"，但它的断裂意味着 zero-to-real 系列的产品面**从 `/input` 走到 `/messages` 时，在数据路径上有了回退**（`/input` 虽然 monomodal，但至少能把用户输入送进 agent-core）。

### 5.2 命名规范与执行逻辑

#### 5.2.1 `message_kind` taxonomy 不一致（跨包）
- `orchestrator-core`: `/input` 写入 `kind = 'user.input'`，`/messages` 写入 `kind = 'user.input.text'` / `'user.input.multipart'`
- `session-truth.ts:inferMessageRole` 只匹配 `kind === 'user.input'`，导致新 kind 误判为 `'system'`
- **结论**: message_kind 分类体系在 ZX5 内形成了"旧路径(用户.startsWith) + 新路径(.text/.multipart)"的分裂，缺乏统一的 message_kind 枚举定义。

#### 5.2.2 `emitServerFrame` 定义位置与调用关系
- `emitServerFrame` 定义在 `orchestrator-core/src/user-do.ts:1266` — 这个是 orchestrator User-DO 的实例方法，用于给 attached WS client 发 server→client frame
- `nano-session-do.ts`（agent-core 的 NanoSessionDO）**没有**对应的 `emitServerFrame` 方法
- 这意味着 agent-core 侧无法直接给 client 推送 `session.usage.update` / `session.permission.request` 帧
- 当前推送路径是：agent-core → (RPC) → orchestrator-core User-DO → `emitServerFrame` → attached client
- **结论**: F3 的 `onUsageCommit` callback 需要通过跨 worker RPC 或 shared facilitator 回传到 orchestrator-core，但这层 plumbing 未接通。closure §3.2 称"wire-up 留 future PR"是准确的。

#### 5.2.3 `handleMeConversations` 的读/写 authority 路径不对称
- 写路径（`/start`, `/input`, `/messages`）: orchestrator-core 通过 `x-nano-internal-authority` header 传 authority 给 User-DO，但 User-DO 并不读取 header，而是依赖 KV 中的 `USER_AUTH_SNAPSHOT_KEY`
- 读路径（`/me/sessions`, `/me/conversations`, `/status`, `/history`）: 同样不读取 header
- 但 `forwardInternalRaw` (user-do.ts:2058-2098) **确实**读取 `x-nano-internal-authority` header
- **结论**: `fetch` handler 对于不同路由有不一致的 authority 获取策略。`/me/conversations` 应统一使用与 `forwardInternalRaw` 相同的 header-reading 策略，或由 orchestrator-core 在首次 fetch 前设置 authority（如通过 `x-nano-internal-authority` 头在所有 session 路由上统一切入）。

### 5.3 测试覆盖盲点

- **D3 `/messages` full-loop**: 没有测试覆盖 `/messages` → agent-core → response 的完整链路。所有测试都是单元级（jwt-shared 20 / auth-contract 19 / orchestrator-core 77），`handleMessages` 的 D1 写入 + RPC 转发全链路未被 cross-e2e 覆盖。
- **F1/F2 hook dispatcher 集成**: 无测试覆盖 `hooks/permission.ts` 通过 `emitPermissionRequestAndAwait` 调用 DO wait-and-resume 的路径。当前 hooks/permission.ts 的测试（若存在）仍只测 synch `verdictOf`。
- **F3 `onUsageCommit → emitServerFrame`**: 无测试覆盖 usage live push 端到端。closure 声称存在 `zx5-usage-live-push.test.mjs`（plan §3 F3-02），但实际 cross-e2e 目录值得复核。
- **`recordUserMessage` role bug 的测试盲点**: 没有测试覆盖 `kind = 'user.input.text'` 时 `role = 'user'` 的断言。这是 R2 bug 逃逸的直接原因。

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**: ZX5 主体架构成立，代码质量扎实（jwt-shared 化、catalog、device migration、wait-and-resume infra 均属正向演进），但 `/messages` 端点的两个硬伤（R1/R2）使得"Lane D complete"的收口声明不正确。Lane F 的三个 partial-by-design 项在 closure 中已 acknowledge，但 closure 总述（TL;DR）的措辞有误导。
- **是否允许关闭本轮 review**: `no`
- **关闭前必须完成的 blocker**:
  1. **修复 R1**：`handleMessages` 补上 `forwardInternalJsonShadow` 调用，使 `/messages` 的消息能进入 agent-core 处理。
  2. **修复 R2**：`recordUserMessage` 的 role 判定改为 `kind.startsWith('user.input') ? 'user' : 'system'`。
  3. **更新 closure §0 / §5.1**：将 D3 状态从 ✅ done 改为 partial，将 Lane F 的状态描述从"F1/F2 hook await/resume"改为"F1/F2 wait-and-resume infra land（hook dispatcher 未集成）"。
- **可以后续跟进的 non-blocking follow-up**:
  1. **R3/R4**: `/input` alias 归一化 + `message_kind` 统一（建议 ZX5+ 或下一个 zero-to-real supplement plan）
  2. **R5**: `handleMeConversations` authority header 读取（建议 ZX5+）
  3. **R6/R7**: F3 emitServerFrame wire-up + F1/F2 hook dispatcher 集成（已在 closure §3.2 列为 follow-up）
  4. **R8**: `claimPendingForStart` 补 `started_at` 条件（低优先级）
  5. **D3 full-loop cross-e2e**：为 `/messages` → agent-core → response 路径补充集成测试
- **建议的二次审查方式**: `same reviewer rereview`（修复 R1/R2 后单点复核，无需全量重审）
- **实现者回应入口**: `请按 docs/templates/code-review-respond.md 在本文档 §7 append 回应，不要改写 §0–§6。`

---

> 2026-04-28 — deepseek 独立审查。ZX5 的整体工程水平令人满意，但 `/messages` 的断裂和 role 判定 bug 需要在收口前修复。zero-to-real 系列走到了真正的终章门口，但"业务可用"这个门还没完全推开。

---

## 7. 审查质量评价（Opus 4.7 修复后回填）

> 评价对象: `deepseek ZX5 全 4 lane review`
> 评价人: `Opus 4.7 (1M ctx)`
> 评价时间: `2026-04-28`

---

### 7.0 评价结论

- **一句话评价**:**严谨偏紧、最早识破"`/messages` 写完就 200 但不驱动 runtime"这条 ZX5 唯一的 critical 业务断裂**;在所有 4 位 reviewer 中证据链最具体、blocker 列表最克制、finding 数量最少但命中率最高。
- **综合评分**:**9.0 / 10**
- **推荐使用场景**:business-loop correctness 类的 closure / business-flow 收口审查;需要"逐行核查 + 跨阶段对账 + Q1-Q11 frozen direction 反向校验"的硬伤识别。
- **不建议单独依赖的场景**:不擅长 docs-truth / clients-api-docs 漂移类的"代码与发布契约不一致"问题(GPT R3 的客户端 contract truth 漂移完全没被它识别);也不会扩展到 platform-fitness / 命名一致性类的低优先级建议。

---

### 7.1 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | **business-loop correctness + Q1-Q11 frozen direction 反向校验** | R1/R2/R3/R4 都围绕 D3 `/messages` 与 Q8(`/input` alias 归一化)冻结契约对账,直接命中"消息墓碑"业务断裂 |
| 证据类型 | **行号 + 跨文件 grep + Q owner answer 引用** | R1 同时引 `user-do.ts:1501-1617` 写完即 200 + `user-do.ts:1002-1013` `handleInput` 转发对照 + Q8 owner answer 原文 |
| Verdict 倾向 | **strict-but-fair** — 提出 critical 时给 close-out blocker 列表,partial-by-design 项 acknowledge 不重复扣分 | §6 close-out 仅列 R1+R2+closure §0/§5.1 措辞 3 项 blocker;deferred 项明确归入 non-blocker |
| Finding 粒度 | **balanced(8 findings,但 critical 严重程度分布极合理)** | R1=critical / R2=high / R3=high / R4=medium / R5=medium / R6+R7=medium(closure 已 ack)/ R8=low,严重级别校准最准 |
| 修法建议风格 | **actionable + 含具体代码片段 + 给出 ZX5+ deferred 路径** | R2 修法直接给 "`role: kind.startsWith('user.input') ? 'user' : 'system'`" 完整 TS 代码 |

---

### 7.2 优点与短板

#### 7.2.1 优点

1. **唯一识破 R2 的 reviewer** — `recordUserMessage` 的 `kind === 'user.input'` 在 D3 扩展 kind taxonomy 后 silently mistag 为 `'system'`,这是一个**所有现有测试都覆盖不到的 latent bug**(因为 `/messages` full-loop 测试不存在),deepseek 通过 grep `inferMessageRole` + 跨阶段比对 kind 扩展点,精准捕到。
2. **Q1-Q11 反向校验做得最深** — Q8(D3 语义冻结)、Q9(D6 device truth)、Q11(D1 conditional UPDATE) 全部逐项对账(R3 引 Q8 原文,R8 引 Q11(b) 原文),其它 reviewer 多是引 closure 文档而非 owner direction 文档作为对照真相。
3. **§5 跨阶段 / 跨包深度分析章节是 4 份 review 中最有架构价值的部分** — 5.2.1 message_kind taxonomy 分裂、5.2.2 emitServerFrame 跨 worker plumbing 缺失、5.2.3 authority 路径读/写不对称,这三条都在揭示**ZX5 后续 cluster work 的真实 backlog 形状**,远比单点 finding 列表有价值。

#### 7.2.2 短板 / 盲区

1. **完全没识别 GPT R3 的 clients/api-docs 漂移问题** — `/messages` `/files` `/me/conversations` `/me/devices*` 在 README 中仍写 "尚未实现",这是一个**比 R1 更影响外部消费者**的 contract truth 漂移,deepseek 全程未涉及。说明它的 scope 锁在 worker 代码内部,client-facing docs / public contract 的对账不在 radar 上。
2. **未识别 GLM R3 的 deploy gate 问题** — `deploy-preview.sh` 缺 `wrangler d1 migrations apply`,migration 007 不会自动 apply,deploy 后 D6 endpoint 立即 500。这是一条 high-severity ops 问题,deepseek 完全没看脚本层。
3. **未捕到 GLM R5 的 orchestrator-core kid rotation 测试盲区** — orchestrator-auth 有 5 个 kid rotation 测试但 orchestrator-core 一个都没有(走的是不同的 verifyJwtAgainstKeyring 路径),deepseek 在 §1.1 把 C3 标 done 时未识别这个非对称覆盖。

---

### 7.3 Findings 质量清点

| 问题编号 | 原始严重程度 | 事后判定 | Finding 质量 | 分析与说明 |
|----------|--------------|----------|--------------|------------|
| R1 | critical | **true-positive** | excellent | `/messages` 不 forward agent-core 是 ZX5 唯一的 business-loop critical 缺口;deepseek 第一个识破,fix 已 land |
| R2 | high | **true-positive (latent)** | excellent | role 判定 bug 是 silently 的 latent regression(测试覆盖不到),只有 deepseek 抓到 |
| R3 | high | **true-positive** | excellent | Q8 frozen direction 反向校验;`/input` 现已 fix 为 `/messages` thin alias |
| R4 | medium | **true-positive (auto-resolved by R3 fix)** | good | 单独看是独立 finding,但 R3 fix 实施后 R4 自动消除 |
| R5 | medium | **true-positive** | good | first-time user 的 `/me/conversations` 静默降级是真实 bug,fix 已 land |
| R6 | medium | **true-positive (closure-only)** | good | F3 wiring 缺失是 closure 措辞过度,实际代码已 acknowledge,deepseek 准确指出 |
| R7 | medium | **true-positive (closure-only)** | good | 同 R6,F1/F2 hook dispatcher 整合 |
| R8 | low | **true-positive (deferred-with-rationale)** | mixed | 字面 Q11(b) 合规,但 deepseek 自己也判 "当前场景下行为等价";建议 deferred 的判断准确,但作为单独 finding 价值不高 |

---

### 7.4 多维度评分 - 单项总分 10 分

| 维度 | 评分(1–10)| 说明 |
|------|-------------|------|
| 证据链完整度 | **10** | 行号 + grep + Q answer 三源对照,§1.1/§1.2 正负事实清单是 4 份 review 中最完整的 |
| 判断严谨性 | **9** | R8 自己 acknowledge "当前场景行为等价" 但仍开了 finding,稍微偏紧;其它判断校准都准 |
| 修法建议可执行性 | **10** | 每个 high/critical finding 都给出代码片段或精准 fix 路径 |
| 对 action-plan / design / QNA 的忠实度 | **10** | Q8 / Q9 / Q11 反向校验最深,远超其它 reviewer |
| 协作友好度 | **8** | verdict `approve-with-followups` + close-out blocker 列表克制,但 critical 词强烈,实现者第一眼会以为 ZX5 全废 |
| 找到问题的覆盖面 | **7** | worker 内部代码覆盖完美,但 deploy 脚本 / client docs / cross-worker test gap 全都没看 |
| 严重级别 / verdict 校准 | **10** | critical(R1)/ high(R2/R3)/ medium(R4-R7)/ low(R8) 严重程度梯度最合理,无虚高/虚低 |

**加权总分:9.0 / 10**(critical-bug 识别 + Q-direction 反向校验 = ZX5 收口最关键的两个能力,deepseek 都做到极致;扣分主要来自 scope 偏窄 — deploy/docs/cross-worker test 三层都不覆盖)
