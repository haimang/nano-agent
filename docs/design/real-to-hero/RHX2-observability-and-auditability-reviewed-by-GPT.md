# Nano-Agent 设计审查 — RHX2 Observability & Auditability

> 审查对象: `docs/design/real-to-hero/RHX2-observability-and-auditability.md`
> 审查类型: `docs-review`
> 审查时间: `2026-04-29`
> 审查人: `GPT-5.4（独立审查）`
> 审查范围:
> - `docs/design/real-to-hero/RHX2-observability-and-auditability.md`
> - `docs/design/real-to-hero/RHX-qna.md`
> - `clients/web/src/{apis,components,pages}/**`
> - `clients/wechat-miniprogram/{api,utils,pages}/**`
> - `workers/orchestrator-core/{migrations,src}/**`
> - `workers/agent-core/src/{hooks,llm}/**`
> - `packages/{nacp-core,nacp-session,orchestrator-auth-contract}/src/**`
> 对照真相:
> - `docs/charter/plan-real-to-hero.md`
> - `workers/orchestrator-core/migrations/001-005`
> - `clients/web/docs/api-contract.md`
> - `clients/wechat-miniprogram/docs/new-apis.md`
> 文档状态: `changes-requested`

---

## 0. 总结结论

> 该设计的方向成立，但**还不适合直接冻结为“面向真实 client 的 first-wave 执行蓝图”**。

- **整体判断**：`RHX2 已经把 error / audit / trace / debug 四条线收拢到一个足够成形的设计框架里；在本轮答复中，Q-Obs2 的 migration 编号漂移已被纠正，但当前文档仍有 2 个 blocker：client 真实消费路径没有被完整纳入 F3 / F7 的交付定义。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `F3 的 runtime registry 只对服务端有意义还不够；web 与微信小程序当前都在手搓错误分类，如果没有 client-safe 映射面，first-wave 仍会继续漂移。`
  2. `F7 的 system.error 不是“定义 kind 就完成”，因为当前两个 client 都还不会消费它；如果不同步补客户端，server 侧接电不会变成真实可用能力。`
  3. `F11 把高频 session lifecycle 排除在外是对的，但 attachment_superseded / replay_lost 这类低频高价值边界事件必须进入 first-wave。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/design/real-to-hero/RHX2-observability-and-auditability.md`
  - `docs/design/real-to-hero/RHX-qna.md`
  - `docs/charter/plan-real-to-hero.md`
- **核查实现**：
  - `workers/orchestrator-core/migrations/{001-005}.sql`
  - `workers/orchestrator-core/src/{index,session-truth,user-do/ws-runtime,user-do/surface-runtime,policy/authority}.ts`
  - `workers/agent-core/src/{hooks/audit,llm/session-stream-adapter}.ts`
  - `packages/nacp-core/src/{error-registry,messages/system,observability/envelope}.ts`
  - `packages/nacp-session/src/stream-event.ts`
  - `clients/web/src/{apis/transport,pages/ChatPage,components/inspector/InspectorTabs}.tsx`
  - `clients/wechat-miniprogram/{utils/{api,nano-client},api/{session,stream},pages/session/index.js}`
- **执行过的验证**：
  - 文件 / schema / route / client 消费路径逐项对账
  - migration 目录与 design 中的 DDL 编号逐项核查
  - web / 微信小程序对错误体、WS kind、调试面、resume/replay 行为逐项核查
- **复用 / 对照的既有审查**：
  - `none` — `本轮判断只基于当前设计文档、当前代码事实和两个 client 的真实消费代码，不以其他 reviewer 的结论作为依据。`

### 1.1 已确认的正面事实

- `RHX2` 已经正确识别：当前 repo 的 public HTTP 错误真相在 `packages/orchestrator-auth-contract/src/facade-http.ts`，NACP 侧的错误/审计真相在 `packages/nacp-core/src/{error-registry,messages/system}.ts`，stream 真相在 `packages/nacp-session/src/stream-event.ts`。
- 设计正确把 `web` 与 `微信小程序` 分开看待：真实代码里，web 侧更靠近 inspector / health / network debug，小程序更依赖统一 envelope、401 刷新、WS reconnect、`last_seen_seq` / `replay_lost`。
- 当前仓库已经有可复用的 durable truth 锚点：`nano_session_activity_logs`、`buildHookAuditRecord()`、`attachment_superseded`、`replay_lost`、`facadeError()`，因此 RHX2 不是“从零发明 observability”。

### 1.2 已确认的负面事实

- RHX2 审查时点曾存在 migration 编号仍停留在 `011/012` 的漂移；本轮已在 Q-Obs2 中纠正为承接 RHX1 SSOT 的 `006-error-and-audit-log.sql`。
- `clients/web/src/apis/transport.ts` 与 `clients/wechat-miniprogram/utils/nano-client.js` 仍各自手搓错误分类；两边都没有消费 `resolveErrorMeta()` 之类的共享映射面。
- `clients/web/src/pages/ChatPage.tsx` 和 `clients/wechat-miniprogram/pages/session/index.js` 当前都只显式处理 `system.notify`，没有把 `system.error` 当作 first-class UX 事件。
- RHX2 原稿的 F11 只列了 6 类 audit event；本轮代答 Q-Obs6 已把它修正为 8 类，但这个缺口本身说明设计确实忽略了真实 client 边界事件。
- 当前 repo 已有 `nano_session_activity_logs` 作为 session-scoped durable activity truth；如果 RHX2 新增 `nano_error_log` / `nano_audit_log`，却不定义三者的职责边界，排障面会变成“三套真相并存”。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 全部判断都来自当前仓库文件事实，尤其是 clients 与 migrations 的直接核查 |
| 本地命令 / 测试 | `no` | 本轮是 design/docs review，没有新增 runtime 变更 |
| schema / contract 反向校验 | `yes` | 对 `FacadeErrorEnvelope`、`NacpErrorSchema`、`AuditRecordBodySchema`、`SessionStreamEventBodySchema` 做了反向对账 |
| live / deploy / preview 证据 | `n/a` | 本轮不涉及 deploy 或 live 行为验证 |
| 与上游 design / QNA 对账 | `yes` | 已对 RHX2 设计稿、RHX-qna、RHX1 后 migration SSOT 逐项对账 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | F3 缺少 client-safe 的错误元数据出口 | `high` | `delivery-gap` | `yes` | 除服务端 registry 外，再定义 web / 微信小程序可直接消费的映射面 |
| R2 | F7 没有把 web / 微信小程序的 `system.error` 消费改造纳入交付 | `high` | `delivery-gap` | `yes` | 把 client rollout 写入 in-scope，或在 client 未更新前维持兼容双发 |
| R3 | F11 的 audit 事件集合漏掉了真实 client 最需要的边界事件 | `high` | `scope-drift` | `no` | first-wave 从 6 类扩成 8 类，补 `session.attachment.superseded` / `session.replay_lost` |
| R4 | `nano_session_activity_logs`、`nano_error_log`、`nano_audit_log` 的职责边界未被说清 | `medium` | `platform-fitness` | `no` | 明确三者分别服务 session 时间线 / cross-trace error / protocol audit |

### R1. F3 缺少 client-safe 的错误元数据出口

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - RHX2 设计把 F3 的核心定义为 `resolveErrorMeta()` + `docs/api/error-codes.md`。
  - `clients/web/src/apis/transport.ts:50-57,108-125` 仍在本地手写 `auth.expired / quota.exceeded / runtime.error / request.error` 分类。
  - `clients/wechat-miniprogram/utils/nano-client.js:11-28,31-35` 也在本地重复做同一套分类。
- **为什么重要**：
  - RHX2 既然声称要服务“真实 web + 微信小程序 client”，那错误元数据就不能只停留在服务端 registry 与人类文档里；否则 first-wave 落地后，两边 client 仍会继续复制、漂移、各自解释 code。
- **审查判断**：
  - 当前 F3 只解决了“服务端与文档如何统一”，没有真正解决“消费方如何统一”。
- **建议修法**：
  - 在 F3 明确再增加一层 **client-safe 映射面**：例如生成 `error-codes.json` / `error-codes.ts` 或一个轻量可前端消费的 package export，并要求 web / 微信小程序改用它，而不是继续各写一套 status/code 分类。

### R2. F7 没有把 web / 微信小程序的 `system.error` 消费改造纳入交付

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - RHX2 F7 计划新增 `system.error` stream-event kind。
  - `clients/web/src/pages/ChatPage.tsx:223-257` 对未知 payload kind 只会当作普通系统消息或 `[kind]` 占位，不存在 `system.error` 专门处理。
  - `clients/wechat-miniprogram/pages/session/index.js:123-155` 只显式处理 `llm.delta` / `tool.call.*` / `turn.*` / `system.notify` / `session.update`，未知类型只记日志。
- **为什么重要**：
  - 如果 server 侧先发 `system.error`，而 client 侧还停留在“只懂 `system.notify`”，RHX2 不会得到“更好的错误 UX”，只会得到“更多未知 kind”。
- **审查判断**：
  - F7 当前是“协议设计完整，交付定义不完整”。
- **建议修法**：
  - 把 web / 微信小程序对 `system.error` 的消费改造明确写入 RHX2 first-wave；或者在两个 client 未更新前，保持 `system.error` + 兼容 `system.notify(severity=error)` 的双发降级策略。

### R3. F11 的 audit 事件集合漏掉了真实 client 最需要的边界事件

- **严重级别**：`high`
- **类型**：`scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - RHX2 原稿的 F11 只列 6 类 `event_kind`，并明确排除了 session lifecycle。
  - `workers/orchestrator-core/src/user-do/ws-runtime.ts:72-83,218-243` 已有 `session.attachment.superseded` 语义。
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:178-188` 已有 `replay_lost` 返回语义。
  - `clients/web/src/pages/ChatPage.tsx:139-156,252-255` 与 `clients/wechat-miniprogram/api/stream.js:137-153,167-181` 都把 reconnect / superseded / replay 衔接当成关键链路。
- **为什么重要**：
  - 真实客户端排障里最常见、最棘手的问题不是“有没有 start/end 事件”，而是“为什么我被顶下线”“为什么这次只能全量补拉 timeline”。
- **审查判断**：
  - RHX2 对“不要把高频 session 生命周期写爆 audit”这个判断是对的，但把所有 session 边界事件一刀切排除，是过度收缩。
- **建议修法**：
  - first-wave 审计集扩成 8 类：在原 6 类基础上补 `session.attachment.superseded` 与 `session.replay_lost`。

### R4. `nano_session_activity_logs`、`nano_error_log`、`nano_audit_log` 的职责边界未被说清

- **严重级别**：`medium`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:107-168` 已有 `nano_session_activity_logs` 与 `view_recent_audit_per_team`。
  - `workers/orchestrator-core/src/session-truth.ts:667-741` 已有 `appendActivity()` durable 写入。
  - RHX2 计划再引入 `nano_error_log` 与 `nano_audit_log` 两张新表。
- **为什么重要**：
  - 如果三套 durable 记录都能描述“同一次错误 / 同一次边界事件”，却没有固定职责边界，排障面会从“信息太少”变成“信息太散”。
- **审查判断**：
  - RHX2 目前默认读者会自行理解三者差异，但这在真实支持链路里不够。
- **建议修法**：
  - 在设计中显式冻结：
    1. `nano_session_activity_logs` = session-scoped、按 `event_seq` 排序的时间线真相；
    2. `nano_error_log` = cross-trace / cross-worker 的 durable error 索引；
    3. `nano_audit_log` = protocol / security / owner-facing 审计真相。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | F1 共享 `worker-logger` seam | `done` | 方向清楚，接口边界和 fallback 责任已经成型 |
| S2 | F2 统一 facade error envelope | `done` | 与当前 `facadeError()` / client transport 需求对得上 |
| S3 | F3 runtime registry + docs 镜像 | `partial` | 只对服务端闭环；还没闭到真实 client |
| S4 | F4 `nano_error_log` + durable write | `partial` | durable 写入骨架成立，但仍需与现有 session activity truth 的职责边界对齐 |
| S5 | F5 `/debug/logs` / `/debug/recent-errors` | `partial` | operator 面合理，但仍需 session-centric 使用口径更清楚 |
| S6 | F6 `Server-Timing` | `done` | 作为 web dev-only 增益合理，但优先级应低于 F2/F3/F7 |
| S7 | F7 `system.error` stream kind | `partial` | 协议设计完整，但 client rollout 未纳入交付 |
| S8 | F8 critical alert / observability envelope | `done` | 方向清晰，克制地只做 critical |
| S9 | F9 bash-core / orchestrator-auth 接 logger | `done` | 符合当前 0 console/弱结构化现状的真实需求 |
| S10 | F10 ESLint 防漂移 | `done` | 与当前 packages/workers 双份实现的治理需求相符 |
| S11 | F11 `nano_audit_log` + audit.record | `partial` | 主体成立，但 first-wave 事件集合对 client 边界事件收得过窄 |

### 3.1 对齐结论

- **done**: `6`
- **partial**: `5`
- **missing**: `0`
- **stale**: `0`
- **out-of-scope-by-design**: `0`

> 当前 RHX2 更像“**核心框架已成形，但还没有完全对上真实 client 消费面与 RHX1 后的当前仓库真相**”，而不是可以直接冻结的最终执行蓝图。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | 第三方 APM / OTel 全量接入 | `遵守` | 设计保持 seam，不把 RHX2 扩成平台 telemetry 工程 |
| O2 | user-level telemetry / growth analytics | `遵守` | 文档没有把产品分析误塞进 observability first-wave |
| O3 | 自动 PII 脱敏框架 | `遵守` | 仍按 first-wave 人工纪律约束，不越界到复杂平台能力 |
| O4 | billing/admin 审计面板 | `遵守` | 设计把 `/debug/audit` 定位为 owner/internal 调试面，没有伪装成完整 control plane |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`本轮 review 不收口。RHX2 方向正确，但要进入 frozen，至少还要补齐 client-safe error meta 出口，以及 system.error 的 client rollout。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. `在 F3 中增加 web / 微信小程序可直接消费的错误元数据出口，不再只停留在服务端 registry + markdown。`
  2. `把 F7 的 web / 微信小程序消费改造纳入 in-scope，或在 client 未更新前维持兼容双发策略。`
- **可以后续跟进的 non-blocking follow-up**：
  1. `把 F11 audit 集合固定成 8 类，并在 action-plan 中补 attachment_superseded / replay_lost 的测试与查询样例。`
  2. `在 RHX2 中补一段“三套 durable 记录的职责边界”，避免 session activity / error log / audit log 混读。`
- **建议的二次审查方式**：`same reviewer rereview`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

> 本轮 review 不收口，等待设计稿按上述 blocker 修订后再进入 rereview。
