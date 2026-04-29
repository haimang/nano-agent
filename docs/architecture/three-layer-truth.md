# Nano-Agent three-layer truth 架构冻结

> 状态: RH6 freeze  
> 适用范围: real-to-hero 收口后、hero-to-platform 启动前  
> 代码基线: RH6 megafile decomposition 后的 6-worker 拓扑

## 1. 冻结结论

Nano-Agent 在 real-to-hero 结束时采用三层真相纪律：

1. **Session DO memory** 是单个 live session 的 active loop truth：当前 runner、WebSocket attachment、replay helper、stream seq、临时 trace、当前 in-flight turn 与即时推送能力都属于这一层。
2. **User DO storage** 是用户维度 hot read model 与 hibernation-safe interaction state：`/me/*` 热索引、recent frames、pending permission/elicitation answer、短 TTL cache、WebSocket attach 元信息都属于这一层。
3. **D1 / R2 product durable truth** 是可审计、可回放、跨 DO/worker 一致的业务真相：用户、团队、设备、会话、turn、timeline/history、usage、model catalog、API key、session file metadata 与 R2 bytes 都属于这一层。

这三层可以互相读取或派生视图，但不能互相吸收所有权。任何后续 PR 只要新增 endpoint、缓存、队列或 worker binding，都必须声明它写入的是哪一层，并说明它不会制造第二份 durable truth。

## 2. Session DO memory

### 2.1 拥有内容

Session DO memory 的 owner 是 agent-core 的 `NanoSessionDO` runtime。RH6 后 public 入口为 `workers/agent-core/src/host/do/nano-session-do.ts`，实现下沉到 `workers/agent-core/src/host/do/session-do-runtime.ts`，外部 import 面不变。

代码锚点：

- `workers/agent-core/src/host/do/session-do-runtime.ts:157-230`：`NanoSessionDO` 持有 `OrchestrationState`、`SessionOrchestrator`、`HealthGate`、`WsController`、`HttpController`、`sessionUuid/sessionTeamUuid/sessionUserUuid`、`streamSeq`、`traceUuid` 与 `SessionWebSocketHelper`。
- `workers/agent-core/src/host/do/session-do-runtime.ts:830-1204`：WebSocket message / close / frame dispatch 是 live loop 入口；这些状态不是 D1 truth。
- `workers/agent-core/src/host/do/session-do-runtime.ts:1262-1403`：kernel runner / orchestration deps 在 session actor 内组装，属于 active turn execution。
- `workers/agent-core/src/host/do/session-do-runtime.ts:1408-1414`：`persistCheckpoint()` / `restoreFromStorage()` 只把 replay/checkpoint 所需状态写入 DO storage，不把 product session truth 写入 DO storage。

### 2.2 允许行为

- 可以维护 attached client、heartbeat、ack/replay helper、stream seq 与 transient eval sink。
- 可以把 checkpoint、last_seen_seq、deferred answer 这类 hibernation-safe 状态写入 DO storage。
- 可以读取 D1 model catalog / usage quota 作为执行约束，但不能把 D1 rows 复制成新的 durable product truth。
- 可以通过 service binding 调用 context/filesystem/orchestrator 相关能力，但返回内容必须继续遵守原 owner 层。

### 2.3 禁止行为

- 禁止把 `nano_conversation_sessions`、`nano_usage_events`、`nano_models`、`nano_session_files` 等 D1 表的 durable rows 复制到 Session DO storage 作为长期真相。
- 禁止让 Session DO memory 成为跨设备授权、API key 或 billing 的唯一判断来源。
- 禁止为了避免 D1 查询，把 revoked device、team policy 或 model policy 只缓存在 session actor 内。

## 3. User DO storage

### 3.1 拥有内容

User DO 是用户维度 façade/hot read model owner。RH6 后 public 入口为 `workers/orchestrator-core/src/user-do.ts`，实现下沉到 `workers/orchestrator-core/src/user-do-runtime.ts`，外部 class/type export 不变。

代码锚点：

- `workers/orchestrator-core/src/user-do-runtime.ts:137-170`：`NanoOrchestratorUserDO` 维护用户维度 `attachments`，`alarm()` 负责 hot state cleanup。
- `workers/orchestrator-core/src/user-do-runtime.ts:536-615`：conversation index、active pointers、cache、recent frames、hot state trim 与 alarm 是 DO storage hot read model。
- `workers/orchestrator-core/src/user-do-runtime.ts:2486-2494`：`get/put/delete` 直接委托 `state.storage`，说明 User DO storage 的边界是 DO-local key-value，而不是 D1 表。
- `workers/orchestrator-core/src/user-do-runtime.ts:2067-2177`：WebSocket attach / lifecycle 在 User DO 中只负责用户设备连接与 client delivery，不拥有 session runtime execution。

### 3.2 允许行为

- 可以缓存 `/me/sessions`、`/me/conversations` 展示所需的热索引，但必须可从 D1 durable truth 恢复或校正。
- 可以保存 recent frames 作为 reconnect/replay 的热路径辅助。
- 可以保存 permission/elicitation pending answer 的短期 interaction state。
- 可以持有用户当前 WebSocket attachment 并在 device revoke 时主动 close。

### 3.3 禁止行为

- 禁止让 User DO storage 成为会话最终状态、usage 计费、API key、model policy、file metadata 的唯一 durable owner。
- 禁止 `/me/conversations` 只看 D1、`/me/sessions` 只看 KV/DO storage 造成双源不一致；读路径允许双源聚合，但 D1 必须是可回溯主线。
- 禁止在 User DO storage 内长期保存完整 file bytes、LLM transcript 或 billing events。

## 4. D1 / R2 durable truth

### 4.1 D1 拥有内容

D1 是产品 durable truth。代码锚点：

- `workers/orchestrator-core/src/session-truth.ts:121-210`：`D1SessionTruthRepository` 创建 conversation/session/turn durable rows，是 session product truth 的主写入口。
- `workers/orchestrator-core/src/session-truth.ts:845-870`：usage snapshot 从 `nano_usage_events` 聚合，usage 不属于 DO storage truth。
- `workers/orchestrator-core/src/user-do-runtime.ts:327-535`：User DO 通过 `D1SessionTruthRepository` 写 session / turn / activity / snapshot / user message / stream frame durable truth；这些 helper 是 D1 truth 的 façade，不是 DO storage ownership。
- `workers/orchestrator-core/src/user-do-runtime.ts:1783-1825`：`requireAllowedModel()` 查询 `nano_models`，model catalog/policy 属于 D1。
- `workers/orchestrator-core/src/index.ts:909-1055`：device truth 位于 `nano_user_devices`；device revoke 必须回写 D1 并触发 User DO force-disconnect。

D1 表职责冻结：

| 表/领域 | owner 层 | 说明 |
| --- | --- | --- |
| users / teams / memberships | D1 | auth 与 team product truth |
| `nano_user_devices` | D1 | device status、revocation、access/refresh/WS gate |
| `nano_conversations` / `nano_conversation_sessions` / turns / timeline / history | D1 | session durable readback 与审计 |
| `nano_usage_events` | D1 | quota/billing/evidence usage truth |
| `nano_models` | D1 | model catalog、status、capabilities、policy input |
| API keys | D1 | key id、hash、status、team ownership；raw secret 不落库 |
| `nano_session_files` | D1 | file metadata、owner、mime、size、R2 key |

### 4.2 R2 拥有内容

R2 是大对象 / file bytes 的 durable cold store；D1 保存 metadata 与 key。

代码锚点：

- `workers/filesystem-core/src/artifacts.ts:76-140`：`SessionFileStore` 写入 R2 bytes 并插入 `nano_session_files` metadata。
- `workers/filesystem-core/src/artifacts.ts:180-238`：list/read/delete 都通过 D1 metadata + R2 key 配合完成。
- `workers/filesystem-core/src/index.ts:96-120`：filesystem-core service binding 暴露 `writeArtifact/listArtifacts/readArtifact`，并要求 `NANO_AGENT_DB` 与 `NANO_R2` 同时存在。

R2 不能单独成为 product truth。R2 object 没有对应 D1 metadata 时，应视为 orphan/corruption，需要修复或 GC；D1 metadata 指向缺失 R2 object 时，应显式报错，不允许静默返回成功。

## 5. 跨层读写法则

### 5.1 允许的跨层流动

1. **D1 → User DO storage hot view**：允许把 D1 durable sessions 聚合成 `/me/*` hot index，但该 index 只能作为加速/展示层，必须能被 D1 修正。
2. **Session DO memory → DO storage checkpoint**：允许把 replay/checkpoint/deferred-answer 等 actor recovery state 写入 DO storage。
3. **User DO storage → Session DO / client delivery**：允许根据 attachment map 推送 frame，delivery 结果不是 durable product truth。
4. **D1 metadata → R2 bytes**：允许 filesystem-core 用 D1 row 校验 ownership 后读取 R2 bytes。
5. **D1 policy → runtime gate**：允许 agent-core/orchestrator-core 在执行前读取 D1 model/device/API key policy。

### 5.2 禁止的跨层流动

1. **禁止 D1 → KV/DO storage cold copy**：不能为了快，把 D1 durable rows 原样复制到 KV 或 DO storage 并长期作为另一份 truth。
2. **禁止 KV/DO storage → D1 反向补写**：hot view 不能反向覆盖 D1 主表，除非该写路径本身就是明确的 product mutation 并走 repository。
3. **禁止 R2 → D1 blind success**：不能在 R2 read/write 失败时仍写 D1 success metadata。
4. **禁止 memory-only security gate**：device revoke、team policy、model capability、API key status 不能只靠内存判断。
5. **禁止跨 user/session DO 偷拥有**：User DO 不执行 agent runtime；Session DO 不拥有用户设备列表。

## 6. 常见违规示例

| 违规做法 | 为什么错 | 正确做法 |
| --- | --- | --- |
| `/me/conversations` 只查 D1，而 `/me/sessions` 只查 DO storage，且没有 reconciliation | 同一用户在两个列表看到不同数据 | 以 D1 durable sessions 为主线，DO storage 仅作为 hot index / replay 辅助 |
| Session DO 把 `nano_models` 全量复制到 actor storage 并长期使用 | model status/team policy 变化不会实时生效 | 每次请求或受控 TTL 从 D1 catalog/policy 读取，并保留 fail-closed |
| User DO 在 device revoke 时只 close socket，不写 `nano_user_devices` | refresh/access gate 仍可能放行 | D1 更新 status + User DO force-disconnect 双动作 |
| filesystem-core R2 put 成功前先写 D1 metadata | 客户端看到可下载文件但 R2 object 不存在 | R2 bytes 与 D1 metadata 按当前 `SessionFileStore` 顺序和错误传播处理 |
| agent-core 直接解析 `/sessions/{id}/files/{file}/content` 为 provider URL | Workers AI 无权读取相对 façade URL | 经 filesystem-core `readArtifact` 读取 session-owned bytes，再转换 provider 可用 data URL |

## 7. RH6 审查准则

后续审查遇到以下情况应直接标为 blocker：

1. 新增 worker 或 SQLite-backed DO，违反 real-to-hero 决议 D1/D2。
2. 新 endpoint 未说明写入/读取哪一层 truth。
3. D1、DO storage、R2 之间出现双向同步或 silent fallback。
4. auth/device/API key/model policy 只在 memory/hot cache 判定，没有 DB 回溯或明确 TTL 失效策略。
5. 任何 import cycle 重新出现：`pnpm check:cycles` 必须保持 0 cycle。

## 8. RH6 后的代码形态说明

RH6 将两个 public megafile 的 import 面冻结为薄 façade：

- `workers/agent-core/src/host/do/nano-session-do.ts` 只重导出 `NanoSessionDO` 与 `DurableObjectStateLike`，实现位于 `session-do-runtime.ts`。
- `workers/orchestrator-core/src/user-do.ts` 只重导出 `NanoOrchestratorUserDO` 与 public type，User DO runtime 位于 `user-do-runtime.ts`。

这次拆分的首要目标是切断 public 入口和实现巨石的耦合、让 CI cycle gate 真实可通过，并为后续更细粒度 handler/module extraction 留出稳定入口。行为层不引入新 endpoint、新 schema 或新 product feature；任何 further decomposition 必须保持 façade exports 不变，并继续通过 typecheck/build/test/e2e 与 `pnpm check:cycles`。
