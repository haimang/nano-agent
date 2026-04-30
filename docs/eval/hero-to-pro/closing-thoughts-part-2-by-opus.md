# hero-to-pro:阶段设想与工作切分(Part 2, by Opus)

> 作者: `Claude Opus 4.7`(实现者,基于 zero-to-real + real-to-hero 全部 25 份 closure 文档的深度审计 + 6 份 hero-to-pro 前置 study + 真实 6-worker 代码碰撞)
> 撰写日期: `2026-04-30`
> 输入材料:
> - `docs/issue/zero-to-real/` 13 份 closure(Z0-Z5、ZX1-ZX5、post-fix-verification、zero-to-real-final-closure)
> - `docs/issue/real-to-hero/` 12 份 closure(RH0-RH6、RH1/RH2 evidence、RHX1-RHX2、RHX2-dual-emit-window)
> - `docs/eval/hero-to-pro/closing-thoughts-part-1-by-opus.md`(Part 1,本文承接)
> - `context/claude-code/`、`context/codex/`、`context/gemini-cli/`(三家 reference agent CLI)
> - 当前 6-worker 真实代码 + `clients/api-docs/` 11 份文档现状
> 文档定位: `Part 1 的承接` — Part 1 聚焦 4 套状态机的前 3 套 + Chat 子集;Part 2 收尾 Tool/Workspace 状态机、跨阶段慢性 deferral、confirmation control plane 完整收拢、文档全面更新、manual evidence pack
> 文档状态: `draft — 待 owner 审阅`

---

## 0. 审计总结:zero-to-real + real-to-hero 全量 deferred 池

对两个文件夹内 25 份 closure 做了逐文件 deep audit,识别出 **105 项** deferred / partial-close / stub / "promised but not delivered" 残留,分布如下:

| 桶 | 项数 | 性质 |
|---|---|---|
| **A. RH0-RH6 阶段 §4 carry-over** | 37 | 每个 phase closure 自报"partial-close"项 |
| **B. RHX2 specific** | 7 | 3-tier observability spike 后还需做的 |
| **C. zero-to-real 残余 stub** | 31 | Z5 priority 1-8 + ZX2-ZX5 R26-R30 |
| **D. clients/api-docs 文档断点** | 10 | 文档与代码不一致 / 缺创建 |
| **E. manual evidence / owner-action** | 9 | 需 owner 配合(部署、真机、tail) |
| **F. 跨阶段慢性 deferral** | 17 | 双层 / 三层 / 五层 carryover,每次 handoff 都给了"plausible deniability" |
| **G. 死代码 / 残骸** | 11 | post-Phase 残存的 method/helper/config |

**最关键的几个观察(决定 Part 2 应该如何切分)**:

1. **Hook dispatcher 真投递断链(F12)** — `emitPermissionRequestAndAwait` / `awaitAsyncAnswer` / alarm sweep 的 wait-and-resume 基础设施在 ZX5 就已落地,但 `hooks/permission.ts` 仍走同步 `verdictOf(outcome)` — 完整 wire 已存在却**至今没有真调用方**,跨 ZX5 → RH1 → RH3 → RH4 → RH6 五阶段无人接通。Part 1 HP3-B 提了 kernel interrupt 真激活,但与"hook dispatcher 实例注入"是两件事,Part 2 必须显式补齐这条链。
2. **`pushServerFrameToClient` 100% 返 `delivered:false`(F13)** — RH1 关闭"wire-contract 完整、e2e-live 未交付";RH3 D6 修了 user_uuid 投影,但 P1-10/P1-11/P1-12 三个 round-trip e2e 测试文件**至今不在 `test/cross-e2e/`**(本机已验证)。Part 2 必须把这三个测试真写出来,否则"permission/elicitation/usage 真投递"始终无 e2e 保护。
3. **`context-core` 三个 RPC 仍 `phase: "stub"`** — Part 1 HP2-A 已计划解 stub。
4. **R29 `resolved-by-deletion-not-fix`(F15 deceptive closure flag)** — verify(check:initial-context) RPC vs HTTP body 双轨 502 在 ZX4 P9 后"不再触发",因为 parity 比较代码被删除,**不是因为 divergence 根因被修复**。这是整个 zero-to-real 留给 hero-to-pro 的最大一笔历史债务。Part 2 必须有专门的 phase 把这个根因验证清楚,或显式承接为"已知容忍风险"。
5. **manual evidence 五阶段 carryover(F1)** — Z5 priority 6 → final-closure §4 row 1 → RH6 §5.2 row 1 → RHX1 §3.2 row 1 → RHX2 §5 row 1。从未交付。
6. **WeChat 真机 smoke 六阶段 carryover(F2)** — ZX2 R17 → ZX3 → ZX4 → ZX5 → RHX1 → RHX2,owner-action 未完成。
7. **Lane E sunset 四阶段 carryover(F4)** — ZX5 短期 shim ≤2 周 → RH4 Phase 4/7 ⚠️/⏸ → RH5 → RH6 → 已显式标 `hero-to-platform inherited issue`。Part 2 应在最终 sunset 前做一次"shim ≥6 个月"事实承认。
8. **`user-do-runtime.ts` 行数回涨**(F5) — RH6 收口时 1049 行,本机当前 **1171 行**(+122)。decomposition 不是一次性赢得的,需要持续护理。
9. **`prod migration apply` 七阶段 carryover(F16)** — ZX4 hard gate → ZX5 → RHX1 reconsolidation → 当前 6 个 migration 文件,prod state 不可知。Part 2 不能直接修(owner-action),但应在 HP9 客户端文档轮次明确登记当前 prod 实际 schema 与 migrations/ 的对齐状态。

Part 2 的命题正是把这些散落在 105 项中**与 hero-to-pro 命题相关**的部分压成 6 个 phase,为最终的"成熟 LLM wrapper"补齐 Part 1 没有覆盖的 4 个面:**Tool/Workspace 状态机、Confirmation 完整收拢、Checkpoint 全模式 revert、Runtime hardening + 文档 + evidence**。

---

## 1. hero-to-pro Part 2 核心命题

Part 1 完成后,nano-agent 已经具备 Model + Context + Chat 三套产品状态机。但仍然不是完整 agent CLI,因为:

- **没有 todo/plan 状态管理** — Claude Code `TodoWrite/TaskCreate`、Codex `plan_tool`、Gemini `WriteTodosTool` 都是核心产品语义。三家全都有,nano-agent 完全空白。
- **没有 workspace temp file CRUD** — Codex 7 个 `fs/*` JSON-RPC、Claude `memdir/`、Gemini `WriteFileTool` + shadow git。nano-agent 的 `filesystem-core` 只是 artifact API,无 scratch / temp 概念。
- **没有 tool call inflight 列表 / 单 tool cancel** — 三家都有,nano-agent 只能 cancel 整个 session。
- **没有 file revert / shadow snapshot** — Gemini `gitService.createCheckpointSnapshot()` + `restoreProjectFromSnapshot()` 是范式;nano-agent Part 1 HP4 只做了 `conversation_only` revert。
- **没有完整 confirmation control plane** — Part 1 HP3-C 只做雏形;model_switch / compact / fallback / restore 五类 confirmation 没收拢。
- **chronic deferrals(F1-F17)需要在产品基线封板前做一次系统性收口** — 不能再让"部分 e2e 缺失 + manual evidence 缺失 + R29 deceptive closure"成为产品事实。
- **`clients/api-docs/` 11 份文档需要全面重写** — Part 1 HP0-HP4 落地 ~30 个新端点 + 10+ 个 schema 改动,文档不更新会再次出现 RHX2 时代"客户端把 stub ack 误读为压缩完成"的隐患。

Part 2 的硬指标:

> **完成 Part 1 + Part 2 后,nano-agent 与 Claude Code / Codex / Gemini CLI 在 4 套产品状态机上都达到同档位(允许个别 advanced 特性如 sub-agent 仍 out-of-scope);chronic deferrals 全部 explicit-resolve 或 explicit-accept-as-risk;`clients/api-docs/` 与代码 100% 对齐;manual evidence pack 完成。**

---

## 2. Part 2 阶段总览

| 阶段 | 主题 | 预估周数 | 关键 DoD |
|---|---|---|---|
| **HP5** | Tool/Workspace 状态机:todo + temp file CRUD + tool inflight | 3 周 | `/sessions/{id}/todos` GET/POST/PATCH;`/sessions/{id}/workspace/files` 全 CRUD;`/sessions/{id}/tool-calls` GET + 单 tool cancel;NACP 加 todo/plan stream event;DDL `nano_session_todos` + `nano_session_temp_files` |
| **HP6** | Confirmation control plane 完整收拢 + Hook dispatcher 真接通 + F12/F13 closure | 2 周 | `/confirmations` 五类 kind 全部 live(model_switch/compact/fallback/restore + 兼容 permission/elicitation);F12 `hooks/permission.ts` 调 `emit*RequestAndAwait`;F13 `pushServerFrameToClient` 真投递 e2e 三件套(P1-10/P1-11/P1-12) |
| **HP7** | Checkpoint 全模式 revert + file shadow snapshot | 2.5 周 | `/checkpoints/{id}/restore` 支持 `files_only` + `conversation_and_files`;R2-backed file snapshot;Gemini-style restore 流程 |
| **HP8** | Runtime hardening + chronic deferrals 系统收口 | 2 周 | DO heartbeat alarm 升级(F6);R28 root cause(F14)定位或 explicit-accept;R29 root cause(F15)显式审计;NanoSessionDO + user-do-runtime 行数 stop-the-bleed gate;envelope 三型收敛(G);Lane E 终态(F4) |
| **HP9** | `clients/api-docs/` 全面更新 + manual evidence pack | 2 周 | 11 份 doc 全部对齐 Part 1+Part 2 端点;新增 `transport-profiles.md`、`models.md`、`workspace.md`、`todos.md`、`checkpoints.md`、`confirmations.md`;F1/F2 manual evidence pack 完整归档 |
| **HP10** | Final closure:hero-to-pro-final-closure + 残余清理 | 1 周 | dead code 清理(forwardInternalJsonShadow / parity-bridge dead / 14 retired guardians 文档化);hero-to-pro-final-closure.md 收尾;handoff 文档对齐 hero-to-platform 入口 |
| **总计 Part 2** | — | **~12.5 周** | 4 套状态机全部成熟;chronic deferrals 全部 explicit;文档+evidence 完整 |

设计原则:

- **不做 sub-agent / multi-agent**(继续 Part 1 边界)。
- **不做 multi-provider LLM**(Workers AI 持续闭环)。
- **不做 admin plane / billing**(留 hero-to-platform)。
- **F4 Lane E 在 HP8 决断**:要么彻底 sunset(workspace-context-artifacts 物理删除),要么显式记录"持续作为 host-local fallback,因 R28 deploy bug 未消除"。不再无限期 shim。
- **F15 R29 deceptive closure 在 HP8 必须有显式判定**:或验证 divergence 根因已无,或登记为已知容忍风险。不再让"删除检测 = 闭合 bug"成为先例。

---

## 3. HP5:Tool/Workspace 状态机(3 周)

> 这是 Part 2 最大的 phase,工作量与 Part 1 HP2 相当。它要把 6 份 study 共识 K9 + K10 + DeepSeek A1/A2/A6 + GPT 5.4 + GLM B-A1/B-A2 一次关掉。三家 reference 都把 todo + workspace + tool inflight 视为 agent 一等公民,nano-agent 当前完全空白。

### 3.1 HP5-A:Todo/Plan 状态机(K9)

**参考实现碰撞**(已在 6 份 study 中详查,此处提炼范式):

| 维度 | Claude Code | Codex | Gemini CLI |
|---|---|---|---|
| 工具 | `TodoWriteTool`(V1 flat)+ `TaskCreateTool`/`TaskUpdate/List/Get/Stop/Output`(V2 task graph) | `plan_tool` Rust module + `<proposed_plan>` XML parser | `WriteTodosTool` + `CompleteTaskTool` |
| 状态 | pending / in_progress / completed | `StepStatus` (planned / in_progress / done) | pending / in_progress / completed / cancelled / blocked |
| in_progress 约束 | 同时只允许一个 | 同 | 同(at most 1) |

**做法**:

1. migration 014-session-todos.sql:
   ```sql
   CREATE TABLE nano_session_todos (
     todo_uuid TEXT PRIMARY KEY,
     session_uuid TEXT NOT NULL FK,
     conversation_uuid TEXT NOT NULL FK,
     team_uuid TEXT NOT NULL,
     parent_todo_uuid TEXT,  -- 支持 task graph
     content TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('pending','in_progress','completed','cancelled','blocked')),
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     completed_at TEXT
   );
   CREATE INDEX idx_todos_session ON nano_session_todos(session_uuid, status);
   ```

2. NACP 协议加新消息族:
   - `session.todos.write`(client → server,batch update,服从"at most 1 in_progress"约束)
   - `session.todos.update`(server → client,emit on status change)

3. agent-core kernel 加 `WriteTodos` capability(类似 bash-core 的 capability 模式),允许 LLM 调用工具更新 todo list。

4. orchestrator-core 路由:
   | 路由 | 行为 |
   |---|---|
   | `GET /sessions/{id}/todos` | 列出当前 session 全部 todo;cursor + status filter |
   | `POST /sessions/{id}/todos` body `{ content, parent_todo_uuid? }` | 用户主动添加 |
   | `PATCH /sessions/{id}/todos/{todo_uuid}` body `{ status, content? }` | 更新单个 todo;校验 in_progress 约束 |
   | `DELETE /sessions/{id}/todos/{todo_uuid}` | 删除(soft delete via status=cancelled) |

5. `GET /sessions/{id}/timeline` 增加 todo 维度事件,使前端可同步呈现。

**DoD**:LLM 工具调用 `WriteTodos` 真实写 D1;`/todos` 4 端点 live;e2e 覆盖 in_progress 约束 + parent/child 关系 + cursor pagination。

### 3.2 HP5-B:Workspace temp file CRUD(K10)

**参考实现碰撞**:

| 维度 | Claude Code | Codex | Gemini CLI |
|---|---|---|---|
| 文件读 | `FileReadTool`(line offset/limit + readFileState cache) | `fs/readFile` JSON-RPC | `ReadFileTool`(start_line/end_line + MIME) |
| 文件写 | `FileWriteTool`(read-before-write 校验 + 原子写 + mtime + history tracking) | `fs/writeFile` | `WriteFileTool`(diff 预览 + IDE 集成) |
| 文件编辑 | `FileEditTool`(search/replace) | `apply_patch` | `EditTool`(strict/flexible/regex/fuzzy) |
| 列出 | `glob_files`/`grep_files` | `fs/readDirectory` | `LSTool` |
| 删除 | implicit | `fs/remove`/`fs/copy` | implicit |

**做法**(在 nano-agent 的 6-worker + R2 拓扑下,workspace temp file 必须区别于 artifact:**workspace = session-scoped、retention 短(session.end + 24h 清)、agent 可读写、不进 audit 长尾**;**artifact = 用户上传或 tool generated 的持久产物,进 D1 metadata + R2 长期保留**):

1. migration 015-session-temp-files.sql:
   ```sql
   CREATE TABLE nano_session_temp_files (
     temp_file_uuid TEXT PRIMARY KEY,
     session_uuid TEXT NOT NULL FK,
     team_uuid TEXT NOT NULL,
     virtual_path TEXT NOT NULL,  -- 客户端可见的 path,如 "/workspace/scratch/output.txt"
     r2_object_key TEXT NOT NULL,  -- 实际 R2 路径,含 tenant 前缀
     mime TEXT NOT NULL,
     size_bytes INTEGER NOT NULL,
     content_hash TEXT NOT NULL,  -- read-before-write 用
     last_modified_at TEXT NOT NULL,
     written_by TEXT NOT NULL CHECK (written_by IN ('user','agent','tool')),
     created_at TEXT NOT NULL,
     UNIQUE (session_uuid, virtual_path)
   );
   CREATE INDEX idx_temp_files_session ON nano_session_temp_files(session_uuid);
   ```

2. `filesystem-core` 加 4 个新业务 RPC:
   - `readTempFile(session_uuid, virtual_path)` → `{ content_b64, content_hash, mime, last_modified_at }`
   - `writeTempFile(session_uuid, virtual_path, content_b64, expected_content_hash?)` → mtime 校验,空 hash 表示 create;不空 hash 表示 read-before-write update
   - `listTempFiles(session_uuid, prefix?)` → cursor list
   - `deleteTempFile(session_uuid, virtual_path)`

3. orchestrator-core 路由:
   | 路由 | 行为 |
   |---|---|
   | `GET /sessions/{id}/workspace/files?prefix=` | list temp files |
   | `GET /sessions/{id}/workspace/files/{*path}` | read |
   | `PUT /sessions/{id}/workspace/files/{*path}` body `{ content_b64, expected_content_hash? }` | write w/ mtime check |
   | `DELETE /sessions/{id}/workspace/files/{*path}` | delete |
   | `POST /sessions/{id}/workspace/cleanup` body `{ dry_run: bool }` | 清理整个 workspace(session.end 后自动触发,客户端可显式调用) |

4. R2 命名规范(per RH4 architecture):`tenants/{team_uuid}/sessions/{session_uuid}/workspace/{virtual_path}`,严格 multi-tenant 前缀。

5. agent-core kernel 加 `ReadTempFile` / `WriteTempFile` / `ListTempFiles` 三个 capability,LLM 工具可调用(per Codex `fs/*` 模式)。

6. session.end + 24h cron 清理(复用现有 `cleanupEndedSessions` 路径):同时清理 D1 `nano_session_temp_files` 与 R2 对象。

**DoD**:LLM 可在 turn 内调用 `WriteTempFile("output.txt", "hello")`,下一 turn 调 `ReadTempFile("output.txt")` 拿回内容;客户端通过 `/workspace/files` 端点可看到这些文件;session 结束 24h 后自动清理。

### 3.3 HP5-C:Tool call inflight 列表 + 单 tool cancel(DeepSeek A6 / GPT 5.4)

**问题**:当前 `/cancel` 是整个 session 取消;没有"取消单个慢工具"的 API。

**做法**:

1. agent-core kernel 加 `pendingToolCalls: Map<request_uuid, PendingToolCall>` 状态;`PendingToolCall` 含 `{ tool_name, started_at, capability_handle? }`。

2. NACP `tool.call.progress` stream event 已存在(per RHX2);加新事件 `tool.call.cancelled`(server → client,kind 已在 stream-event registry,只需 emit)。

3. orchestrator-core 路由:
   | 路由 | 行为 |
   |---|---|
   | `GET /sessions/{id}/tool-calls?status=running\|completed\|failed\|cancelled` | 列出本 session tool call,cursor + status filter,从 D1 `nano_conversation_messages` `body_json.tool_call.*` 抓取 |
   | `POST /sessions/{id}/tool-calls/{request_uuid}/cancel` | bash-core / filesystem-core 已有 `capability/cancel` RPC,通过 service binding 调用;成功后 emit `tool.call.cancelled` |

4. bash-core 与 filesystem-core 的 `capability/cancel` 已 wire(per ZX2 R28 调查);本期只是把 orchestrator-core 端点真正接通,不再依赖 R28 deploy bug 旁路。

**DoD**:用户可以 cancel 单个慢 bash 工具(如 `curl` 长链接),不影响 session;e2e 覆盖。

### 3.4 HP5-D:Workspace 文件 promotion 到 artifact(GPT 5.4 边界)

**问题**:用户在 workspace 写入的 `output.txt` 应能 "promote" 为持久 artifact(可下载、跨 session 可引用)。当前没有这个语义。

**做法**:

1. 路由 `POST /sessions/{id}/artifacts/promote` body `{ workspace_path, audience: "user"|"team" }` → 把 R2 workspace 对象 copy 到 artifact 命名空间 + 写 D1 `nano_session_files` metadata + 返回 `artifact_ref`。

2. `GET /sessions/{id}/artifacts/{file_uuid}/provenance` → 返回 `{ source: "user_upload"\|"agent_generated"\|"workspace_promoted"\|"compact_summary", created_by, created_at, original_workspace_path? }`。

**DoD**:LLM 可显式将 workspace 临时文件提升为持久 artifact;前端可显示 provenance。

### 3.5 HP5 退出条件

- ✅ Todo 状态机端到端 live(D1 + NACP + 4 路由 + agent capability)。
- ✅ Workspace temp file CRUD live(D1 + R2 + filesystem-core RPC + 5 路由 + agent capability)。
- ✅ Tool call inflight 列表 + 单 tool cancel live。
- ✅ Workspace → artifact promotion 通路 live。
- ✅ E2E 覆盖:LLM 写 todo 推进任务;LLM 写 temp file 后续 turn 读回;cancel 单 tool 不破坏 session;promote 后 artifact 可跨 session 下载。

---

## 4. HP6:Confirmation control plane 完整收拢 + F12/F13 closure(2 周)

### 4.1 HP6-A:F12 Hook dispatcher 实例真注入(慢性 deferral 三阶段)

**问题(F12)**:ZX5 落地了 `emitPermissionRequestAndAwait` / `awaitAsyncAnswer` / alarm sweep 完整 wait-and-resume 基础设施,但 `hooks/permission.ts` 至今走同步 `verdictOf(outcome)` — wire 完整却**无人调用**,跨 ZX5 → RH1 → RH3 → RH4 → RH6 五阶段 silently 漂着。

Part 1 HP3-B 提的"kernel interrupt 真激活"在 kernel 层补了 `approval_pending` setter;HP6-A 是这一链的 hook 层补丁:

**做法**:

1. `hooks/permission.ts` 改造:`PreToolUse` hook 不再返同步 verdict,改为:
   - 检查 capability policy: `policy.shouldAsk(tool_name, tool_input, mode)`。
   - 若 `ask`:调 `dispatcher.requestPermission(decisionUuid, payload)` → dispatcher 内部调 `NanoSessionDO.emitPermissionRequestAndAwait()` → kernel 进入 `approval_pending` interrupt → 等 client 通过 HTTP `/permission/decision` 写入 DO storage → `awaitAsyncAnswer` resolve → hook 拿到 verdict。
   - 若 `allow` / `deny`:直接返同步 verdict(保留快路径)。

2. `createMainlineKernelRunner` 时把 `HookDispatcher` 实例注入(deps 注入,per Part 1 HP3-B 与本节联动)。

3. e2e 覆盖:tool call → policy ask → WS permission request frame → HTTP decision allow → tool exec resume(真实 e2e,不是 mock)。

**DoD**:F12 终结。`emitPermissionRequestAndAwait` 第一次有真实调用方。

### 4.2 HP6-B:F13 `pushServerFrameToClient` 真投递 + e2e 三件套(慢性 deferral 四阶段)

**问题(F13)**:RH1 关闭"wire-contract 完整、e2e-live 未交付";RH3 D6 修了 user_uuid 投影;但 P1-10/P1-11/P1-12 三个 round-trip e2e 测试文件**至今不在** `test/cross-e2e/`(本机当前 14 个测试文件,无 permission/elicitation/usage round-trip)。

**做法**:

1. 写 `test/cross-e2e/15-permission-roundtrip-allow.test.mjs`:启动 session → 触发需要 ask 的工具 → 收 WS `session.permission.request` 帧 → HTTP POST `/permission/decision { allow }` → 收 `tool.call.result` → finish。
2. 写 `test/cross-e2e/16-permission-roundtrip-deny.test.mjs`:同上,decision 改 deny → 收 `turn.end` reason=denied。
3. 写 `test/cross-e2e/17-elicitation-roundtrip.test.mjs`:触发 elicitation → WS request → HTTP answer → 继续 LLM。
4. 写 `test/cross-e2e/18-usage-push-live.test.mjs`:启动 session → 收 LLM stream → 验 WS 收到 `session.usage.update` 帧(commit 后)。
5. 测试基础设施:启动 preview 6 worker stack(沿用 `01-stack-preview-inventory` 套路),用 `wrangler dev` 多端口 stack。

**DoD**:F13 终结。Part 1 HP3-B 与 HP6-A 的 kernel interrupt + hook dispatcher 都有真 e2e 保护。

### 4.3 HP6-C:`/confirmations` 完整收拢(覆盖 5 类 kind)

**问题**:Part 1 HP3-C 落地了 `/confirmations` 雏形,只覆盖 permission + elicitation。HP1-E `<model_switch>`、HP2-E compact preview、HP1-F fallback 都需要"用户确认"语义,但当前用各自端点散布。

**做法**:

1. `nano_session_confirmations` D1 表(migration 016-confirmations.sql):
   ```sql
   CREATE TABLE nano_session_confirmations (
     confirmation_uuid TEXT PRIMARY KEY,
     session_uuid TEXT NOT NULL FK,
     kind TEXT NOT NULL CHECK (kind IN ('tool_permission','elicitation','model_switch','context_compact','fallback_model','checkpoint_restore','context_loss')),
     payload_json TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('pending','allowed','denied','modified','timeout','superseded')),
     decision_payload_json TEXT,
     created_at TEXT NOT NULL,
     decided_at TEXT,
     expires_at TEXT NOT NULL
   );
   ```

2. 各类触发方:
   - tool_permission → HP6-A 的 hook dispatcher
   - elicitation → kernel `elicitation_pending` interrupt
   - model_switch → HP1-E detect 检测到 cross-turn 模型变更时,若新模型 context_window 显著小,先发起 confirmation
   - context_compact → HP2-E preview 后,需要用户确认才执行
   - fallback_model → HP1-F fallback 触发前,可选 confirmation(team policy 决定是否需要)
   - checkpoint_restore → HP4 restore 前必须 confirmation
   - context_loss → 模型切换或 compact 将丢失 N% context 时,显式 warning

3. 路由(替代 Part 1 雏形):
   | 路由 | 行为 |
   |---|---|
   | `GET /sessions/{id}/confirmations?status=pending` | 当前待确认事项列表 |
   | `GET /sessions/{id}/confirmations/{uuid}` | 单项详情(payload + 截止时间) |
   | `POST /sessions/{id}/confirmations/{uuid}/decision` body `{ decision: "allow"\|"deny"\|"modify", payload? }` | 统一确认入口 |

4. permission/elicitation 兼容路径(`/permission/decision`、`/elicitation/answer`)继续保留,**但内部 redirect 到 `/confirmations/{uuid}/decision`**。3 个月后(可选)删除兼容路径;Part 2 内只做 redirect,不删除。

5. NACP `session.confirmation.request` / `session.confirmation.update` 加 server frame;现有 `session.permission.request` / `session.elicitation.request` 继续 emit(双发兼容期)。

**DoD**:5 类 confirmation 都进入统一 D1 表 + 统一端点;permission/elicitation 双发兼容期 e2e。

### 4.4 HP6 退出条件

- ✅ F12 hook dispatcher 真投递,`emitPermissionRequestAndAwait` 有调用方。
- ✅ F13 `pushServerFrameToClient` 真投递,4 个 round-trip e2e 文件就位。
- ✅ `/confirmations` 5 类 kind 全部 live。
- ✅ permission/elicitation 兼容期保留,双发 e2e。

---

## 5. HP7:Checkpoint 全模式 revert + file shadow snapshot(2.5 周)

> Part 1 HP4 只做 conversation_only revert。完整 product checkpoint 需要 file revert,这是 Gemini CLI 的核心范式。

### 5.1 HP7-A:R2 backed file snapshot(Gemini-style shadow git 改造)

**参考**:Gemini `gitService.createCheckpointSnapshot()` + `restoreProjectFromSnapshot()` — 用 shadow git repo 在 checkpoint 时 add+commit 文件,restore 时 git restore + clean。nano-agent 没有本地 filesystem,需在 R2 上做等效。

**做法**:

1. R2 命名规范扩展:`tenants/{team_uuid}/sessions/{session_uuid}/snapshots/{checkpoint_uuid}/{virtual_path}`。

2. `filesystem-core` 加 RPC:
   - `createFileSnapshot(session_uuid, checkpoint_uuid)` → 复制当前 workspace + artifacts 到 snapshot 路径;返回 `{ file_count, total_bytes }`。
   - `restoreFileSnapshot(session_uuid, checkpoint_uuid)` → 把 snapshot 内容 copy 回 workspace + artifacts(覆盖)。

3. checkpoint 创建钩子(扩展 Part 1 HP4):每个 turn end 自动触发 lazy snapshot(标记为"待物化"),用户主动 `POST /checkpoints` 时才真创建 R2 副本(避免每个 turn 都 R2 copy 浪费)。

4. checkpoint TTL 策略:
   - turn-end checkpoints:保留最近 10 个(rotate)。
   - user-named checkpoints:保留 30 天。
   - compact-boundary checkpoints:与 compact summary 同 TTL。

5. session.end + 90d cron 清理 snapshot R2 对象。

**DoD**:`POST /checkpoints` 后 R2 上有 snapshot;`restoreFileSnapshot` 测试覆盖 add/modify/delete 三类文件变更。

### 5.2 HP7-B:`/checkpoints/{id}/restore` 三模式

**做法**:

1. Part 1 HP4 已有 `mode: "conversation_only"`;HP7 加:
   - `mode: "files_only"` → 只调 `restoreFileSnapshot`,不动 D1 message 和 DO kernel。
   - `mode: "conversation_and_files"` → 先 conversation_only,再 file restore。

2. confirmation gate(per HP6-C):restore 前必触发 `kind: "checkpoint_restore"` confirmation,显示 diff。

3. `GET /sessions/{id}/checkpoints/{id}/diff` 扩展:除 message diff 外,加 file diff(列出 add / modify / delete 的 virtual_path + size 变化)。

**DoD**:三模式 e2e 通过;restore 前必有 confirmation;diff 端点显示完整变更。

### 5.3 HP7-C:Session fork(GPT 5.3 / DeepSeek S3)

**做法**:`POST /sessions/{id}/fork` body `{ from_checkpoint_uuid, new_session_label? }` → 创建新 session,复制 D1 messages 到该 checkpoint 为止 + R2 file snapshot copy 到新 session 路径 + 启动新 DO kernel。

**DoD**:用户可以从历史 turn N 分叉新 session 并行探索。

### 5.4 HP7 退出条件

- ✅ R2-backed file snapshot live。
- ✅ Restore 三模式 e2e 通过。
- ✅ Confirmation gate 在 restore 前强制触发。
- ✅ Session fork 端点 live。

---

## 6. HP8:Runtime hardening + chronic deferrals 系统收口(2 周)

> 这是把 7 项跨阶段 chronic deferrals(F4/F5/F6/F8/F14/F15 + envelope 三型 G99)集中收口的 phase。每项都不复杂,但必须同期处理避免再次散落到下一阶段。

### 6.1 HP8-A:F14 R28 verify-cancel deploy 500 root cause 定位(慢性三阶段)

**历史**:ZX2 R28 deploy-only;ZX4 §3.1 'pending ZX5 Lane E';ZX5 F5 wrangler tail runbook stub(owner-action,未回填)。

**做法**:

1. owner 在 preview 跑 `wrangler tail nano-agent-orchestrator-core-preview`,触发 `verify {check: "capability-cancel"}`,抓 stack trace。
2. 根据 trace 定位 RPC 调用栈层位置。最可能的根因(基于 ZX2/ZX4 调查):某个 capability `cancel` 的实例在跨 worker RPC 调用时引用了 outer request 的对象,违反 CF Workers I/O cross-request isolation。
3. 修复或显式 try/catch 隔离;e2e 覆盖。

**DoD**:`docs/runbook/zx5-r28-investigation.md` §3 真实回填 root cause;`/verify {check:"capability-cancel"}` 在 preview 不再 500。若 owner 不能定位(2 周内),HP8 不再放行 — 显式登记为 hero-to-platform inherited issue 而非 silent 漂移。

### 6.2 HP8-B:F15 R29 verify-initial-context 502 显式审计(deceptive closure flag)

**历史**:ZX2 R29;ZX4 P9 把 parity 比较代码删除 — divergence 即使存在也不再被检测,**resolved-by-deletion-not-fix**。这是整个 zero-to-real 留给 hero-to-pro 的最大笔历史债务。

**做法**:

1. 写一个 one-off `scripts/verify-initial-context-divergence.mjs`:对当前 session DO 与 D1 的 initial_context 做完整 diff(类似 ZX4 P9 删除前的 parity 检测,但只在调试时手动跑)。
2. 在 preview 跑:取 5 个真实 session,逐个跑 diff。
3. 三种结果:
   - **零 diff** → root cause 早已被无关修复消除(可能是 ZX5 Lane E 的某个 side effect)→ 显式登记"由后续修复无意中根治";
   - **有 diff** → 真实存在 divergence → 必须修;
   - **无法跑(env 缺失)** → 显式登记"不可验证,作为 hero-to-platform 已知风险继承"。

**DoD**:`docs/issue/zero-to-real/R29-postmortem.md` 写出真实判定;不允许"silently resolved"再传一站。

### 6.3 HP8-C:F6 DO heartbeat alarm 升级(慢性三阶段)

**历史**:Z5 priority 2 → final-closure §4 row 4 → RHX1 §3.2 row 3 → hero-to-platform。

**做法**:

1. 当前 `NanoSessionDO` heartbeat 用 attachment-lifetime timer(15s)。改造为 DO `alarm()` 调度,attach 时 `setAlarm(now + 15s)`,detach 时 cancel。
2. 处理重连:`alarm` fire 时若 attachment 仍 active 且 last_seen 超时,emit `system.notify { kind: "heartbeat-timeout", ... }` + 主动 close attachment。
3. 与 RHX2 dual-emit 兼容(双发期内仍走 `system.error` + `system.notify`)。

**DoD**:DO 在 hibernation 醒来后 alarm 仍可 fire;cross-e2e 覆盖 abnormal disconnect 4 scenario(per RH2 §3 row 5)。

### 6.4 HP8-D:F4 Lane E 终态判定(慢性四阶段)

**历史**:ZX5 短期 shim ≤2 周(已超 ~6 个月)→ RH4 Phase 4/7 ⚠️/⏸ → RH5/RH6 → "hero-to-platform inherited issue"。

**做法**:Part 2 必须做出二选一终态:

- **路径 A:彻底 sunset** — `workspace-context-artifacts` host-local consumer 物理删除;agent-core CONTEXT_CORE binding 变成唯一路径;`LANE_E_RPC_FIRST` config 删除。前提:HP8-A R28 root cause 已消除,deploy 不再 500。
- **路径 B:显式接受为永久 fallback** — 在 `docs/architecture/lane-e-fallback.md` 显式登记:host-local consumer 作为 R28 deploy bug 的 permanent fallback,直至 R28 root cause 消除;`LANE_E_RPC_FIRST=false` 改为 documented permanent setting,不再标 `dead config`。

**DoD**:不再"shim 期 ≤2 周"。两条路径中选一,文档化。

### 6.5 HP8-E:F5 NanoSessionDO + user-do-runtime 行数 stop-the-bleed gate

**历史**:RH0 §4 ≤1500 line(unit-stripped)→ RH6 user-do-runtime 1049 → 当前 1171(+122 regrowth)→ RHX1 'deferred-refactor'。

**做法**:

1. 加 CI gate(`scripts/check-megafile-budget.mjs`):
   - `nano-session-do.ts`(及其 session-do/* 子文件中任一)≤ 800 行
   - `user-do.ts` 主 facade ≤ 200 行
   - `user-do-runtime.ts` ≤ 1100 行(承认现状,设软上限不再回涨)
   - 各 session-do/* 子文件 ≤ 500 行
2. 不做激进 decomposition(避免与 HP5/HP6/HP7 改动撞);只是"行数 stop-the-bleed",不允许进一步增长。
3. 真正 handler-granularity decomposition 推迟到 hero-to-platform 或独立 refactor PR。

**DoD**:CI gate live;每个新 PR 不能让上述文件进一步增长。

### 6.6 HP8-F:Envelope 三型收敛(G99)

**历史**:`AuthEnvelope` / `Envelope`(nacp-core)/ `FacadeEnvelope` 三型 type-level drift,跨 ZX3 → ZX5 持续 defer "envelope refactor 一并做"。

**做法**:

1. type-level 收敛到 `FacadeEnvelope` 为唯一对外形状(本机 RHX2 review 阶段已落地),`AuthEnvelope` 与 `Envelope` 改为 internal alias,不再对外暴露。
2. 物理删除 `forwardInternalJsonShadow` method(post-P9 dead code,G95);删除 `parity-bridge.ts` 中 `logParityFailure` / `computeBodyDiff`(G96)。
3. 删除 `runbook/zx2-rollback.md`(per ZX5 §5.3 row 3 archive at 2026-05-12 — 该日期已过)。

**DoD**:envelope 单一对外类型;dead code 物理删除;archive runbook 物理删除。

### 6.7 HP8-G:F8 tool registry single source of truth(慢性三阶段)

**历史**:Z5 priority 4 → final-closure §4 row 5 → RHX1 'hero-to-platform / SDK extraction'。

**做法**(最小路径,避免引入 SDK extraction 工程):

1. 在 `packages/nacp-core/src/tools/` 下新建 `tool-catalog.ts`,集中定义所有 tool 的 schema + description + capability bindings。
2. agent-core 与 bash-core 改为从 catalog 读取;现有 `name-level drift guard` 升级为 `schema-level drift guard`(`scripts/check-tool-drift.mjs`,加入 `pnpm check:tool-drift`)。
3. 不抽 SDK package(SDK extraction 留 hero-to-platform)。

**DoD**:tool 定义单一源;drift guard 在 CI 拦截 schema-level 漂移。

### 6.8 HP8 退出条件

- ✅ F14 R28 root cause 定位 OR 显式登记。
- ✅ F15 R29 显式 postmortem,不再"deletion = resolution"。
- ✅ F6 DO heartbeat alarm 升级。
- ✅ F4 Lane E 终态判定(sunset 或 permanent fallback)。
- ✅ F5 行数 CI gate live,不再 silent regrowth。
- ✅ G99 envelope 三型收敛 + dead code 删除。
- ✅ F8 tool registry SSoT(catalog + drift guard)。

---

## 7. HP9:`clients/api-docs/` 全面更新 + manual evidence pack(2 周)

> 文档更新放在晚期,符合 owner 预期"那大概是比较晚的阶段了"。这里要做一次系统性的客户端文档对齐。

### 7.1 HP9-A:文档全面对齐(11 现有 + 6 新增)

**当前现状**(本机已确认 11 份):
- README.md / auth.md / catalog.md / error-index.md / me-sessions.md / permissions.md / session-ws-v1.md / session.md / usage.md / wechat-auth.md / worker-health.md

**Part 1 + Part 2 落地后,需要新增 / 重写**:

| 文件 | 用途 | 内容来源 |
|---|---|---|
| `models.md`(新增) | Model state machine + alias + fallback + reasoning | Part 1 HP1 |
| `context.md`(新增) | Context probe / compact preview/job / layers | Part 1 HP2 |
| `checkpoints.md`(新增) | Checkpoint list / diff / restore 三模式 / fork | Part 1 HP4 + Part 2 HP7 |
| `confirmations.md`(新增) | 7 类 confirmation kind 统一描述 + permission/elicitation 双发兼容期 | Part 2 HP6 |
| `todos.md`(新增) | Todo state machine + parent/child + cursor | Part 2 HP5 |
| `workspace.md`(新增) | Workspace temp file CRUD + cleanup + promotion | Part 2 HP5 |
| `transport-profiles.md`(新增,补 D77 历史 bookkeeping) | NACP frame profile + retired profile audit | 全阶段历史 |

**重写**:
- `session.md` — 删除当前 stub-warning(`/context/compact` 返 `compacted:true` but 实际 stub 等);加完整 model_id / reasoning 流转说明 + cross-turn history 行为。
- `permissions.md` — 删除"runtime 不等待 decision/answer"声明;改为引导到 `confirmations.md`(双发期保留兼容)。
- `usage.md` — 真实 token/cost 数据(非 null placeholder per Part 1 HP1)。
- `error-index.md` — 加 Part 1+Part 2 新错误码(Workspace、Todo、Confirmation、Checkpoint 类)。
- `worker-health.md` — Part 1 HP0-D 已解封 CONTEXT_CORE binding,加 Lane E live 字段;Part 2 HP8-D 终态后更新。
- `session-ws-v1.md` — 加 Part 1 HP1 `model.fallback` event、HP2 `compact.notify` 真触发说明、HP6 `session.confirmation.request` family。
- `me-sessions.md` — Part 1 HP3-D cursor pagination + HP3-A close/delete/title/retry 端点。

**做法**:本 phase 内逐文件 rewrite,每文档对应一个 reviewer 来源(三家 reference + study consensus 反查)。

**DoD**:`clients/api-docs/` 17 份文档(11 已存在 + 6 新增 + 全部 rewrite),与代码 100% 对齐;review 流程跑一次(可选 GPT/kimi/GLM/deepseek 各审一遍,沿用 RHX2 review pattern)。

### 7.2 HP9-B:F1/F2 manual evidence pack 完整归档(慢性五/六阶段)

**历史**:F1 manual evidence 五阶段 carryover;F2 WeChat 真机 smoke 六阶段 carryover。owner 必须配合。

**做法**:

1. owner 在以下平台做完整 e2e 录制:
   - Chrome web 客户端(`clients/web` Vite app)
   - Safari iOS(真机)
   - Android Chrome(真机)
   - WeChat 开发者工具(`clients/wechat-miniprogram`)
   - WeChat iOS / Android 真机(F2 慢性 carryover)
2. 每平台覆盖:register → login → start session → send message → receive WS frames → use todo/workspace tool(Part 2 新增)→ trigger compact(Part 2 新增)→ trigger checkpoint restore(Part 2 新增)→ revoke device → 重 attach 被拒。
3. 录像 + console + network HAR + WS log,归档至 `docs/evidence/hero-to-pro-manual-2026-XX/`。
4. 在 `docs/issue/hero-to-pro/manual-evidence-pack.md` 写完整索引。

**owner-action 依赖**:HP9 必须由 owner 至少配合 5 套设备。

**DoD**:F1 + F2 终结。manual evidence 完整归档,不再传给 hero-to-platform。

### 7.3 HP9-C:F16 prod migration apply 状态对齐(慢性七阶段)

**问题**:ZX4 hard gate 起,migrations 006/007 应在 prod apply。RHX1 重新 consolidate 到 5 文件,本机当前 6 个 migration 文件。prod 实际 schema 状态不可知。

**做法**:

1. owner 跑 `wrangler d1 migrations list nano-agent-orchestrator-core --env prod --remote`,确认已 apply 状态。
2. 与 `migrations/` 目录对齐;不一致则按"先 apply 缺失"。
3. 在 `docs/issue/hero-to-pro/prod-schema-baseline.md` 记录当前 prod schema 真实状态(每张表的 schema dump)。

**DoD**:prod schema 与 migrations/ 一致;baseline 文档化。F16 终结。

### 7.4 HP9 退出条件

- ✅ 17 份 `clients/api-docs/` 文档全部 live + review 通过。
- ✅ F1 + F2 manual evidence 完整归档(5 套设备 × 完整 e2e)。
- ✅ F16 prod schema baseline 文档化。

---

## 8. HP10:Final closure + 残余清理(1 周)

### 8.1 HP10-A:残余 dead code 清理

| 项 | 来源 | 做法 |
|---|---|---|
| `forwardInternalJsonShadow` 方法名 | G95 / ZX4 §4 risk row 7 | 物理删除 |
| `parity-bridge.ts` `logParityFailure` / `computeBodyDiff` | G96 / ZX4 §4 risk row 8 | 物理删除(已在 HP8-F 处理,HP10 verify) |
| `runbook/zx2-rollback.md` archive | G97 / ZX5 §5.3 row 3 | 物理删除(archive date 已过) |
| C2 jwt-shared dynamic import in user-do.ts | G98 / ZX5 §4 risk row 8 | 评估能否换回 static import(取决于 worker bundling 现状) |
| `dead deploy-fill` enum/type | G100 / RHX1 §3.1 closed-by-prior-phase | grep 验证已无残骸 |
| 14 retired guardians 文档化 | G102 / ZX3 §4 risk row 2 | 在 `docs/architecture/test-topology.md` 显式列出已迁到 worker-local 的 14 项契约 |
| WORKER_VERSION 静态 vs git-sha | G103 / ZX2 R25 + ZX5 D1 | 评估是否进入 hero-to-pro CI 切换;若不,显式 defer 到 hero-to-platform |

### 8.2 HP10-B:`hero-to-pro-final-closure.md`

**做法**:沿用 `zero-to-real-final-closure.md` 体例,写完整 final closure:

- §1 阶段总览(Part 1 + Part 2 全部 phase 状态)
- §2 4 套状态机最终状态
- §3 105 项 deferred 的逐项归集(closed / accepted-as-risk / handed-to-hero-to-platform)
- §4 慢性 deferral F1-F17 的最终判定
- §5 与 hero-to-platform 衔接清单(明确 inherited issues)

### 8.3 HP10-C:hero-to-platform 入口清理

**做法**:在 `docs/charter/` 下创建 `plan-hero-to-platform.md` 框架(具体内容由 hero-to-platform 阶段写),仅登记 hero-to-pro inherited issues:

- multi-provider LLM routing
- admin plane(api-key list/create/revoke UI)
- billing / cost-aware quota
- sub-agent / multi-agent
- WORKER_VERSION CI 切换
- SDK extraction(F8 升级路径)
- 完整 handler-granularity refactor(F5 升级路径)

**DoD**:hero-to-platform 入口文档存在但 stub;不替 hero-to-platform 写实质内容。

### 8.4 HP10 退出条件

- ✅ 残余 dead code 清理完成。
- ✅ `hero-to-pro-final-closure.md` 写完。
- ✅ `plan-hero-to-platform.md` 入口 stub 创建。

---

## 9. 跨阶段 carryover 全量映射

| chronic deferral | Part 2 phase | 终态 |
|---|---|---|
| F1 manual browser/wechat/真机 evidence(5 阶段) | HP9-B | 终结 — 完整归档 |
| F2 WeChat 真机 smoke (R17,6 阶段) | HP9-B | 终结 — F2 evidence pack 一并 |
| F3 permission/elicitation/usage round-trip e2e(4 阶段) | HP6-B | 终结 — 4 个 cross-e2e 文件就位 |
| F4 Lane E sunset(4 阶段) | HP8-D | 二选一终态(sunset OR permanent fallback) |
| F5 NanoSessionDO+user-do 行数(3 阶段) | HP8-E | 行数 CI gate(stop-the-bleed,不做 full refactor) |
| F6 DO heartbeat alarm(3 阶段) | HP8-C | 终结 — alarm 化 |
| F7 WS lifecycle 4 scenarios(3 阶段) | HP6-B + HP8-C | 终结 — round-trip e2e + alarm 一并 |
| F8 tool registry SSoT(3 阶段) | HP8-G | 部分终结(catalog 化,SDK extraction 留 platform) |
| F9 snapshot vs continuous push 决策(3 阶段) | Part 1 HP2(已涵盖,Part 2 不重做) | Part 1 HP2-D `/context/probe` + WS push live = 实质决策完成 |
| F10 multi-tenant per-deploy(4 阶段) | **out-of-scope**,留 hero-to-platform | 显式 handoff |
| F11 client package extraction | **out-of-scope**,留 hero-to-platform | 显式 handoff |
| F12 hook dispatcher integration(3 阶段) | HP6-A | 终结 |
| F13 onUsageCommit WS push e2e(3 阶段) | HP6-B(测试 18) | 终结 |
| F14 R28 verify-cancel root cause(3 阶段) | HP8-A | 定位 OR 显式 hero-to-platform handoff |
| F15 R29 deceptive closure | HP8-B | 显式 postmortem |
| F16 prod migration apply(7 阶段) | HP9-C | 终结 — baseline 文档化 |
| F17 docs/api/files-api.md / r2-namespace.md / lane-e-sunset.md(2 阶段) | HP9-A | 终结 — 17 份 `clients/api-docs/` 一并写 |

---

## 10. Out-of-scope(显式留给 hero-to-platform)

Part 2 不做的:

1. **Multi-provider LLM routing** — DeepSeek / OpenAI / Anthropic adapter,需要 4 套状态机 × N provider 重新做边界;hero-to-platform 第一优先。
2. **Sub-agent / multi-agent** — Codex `Op::MultiAgentsSpawnV2`、Gemini sub-agent。需要新 worker 或 spawn DO,与 6-worker 边界冲突。
3. **Admin plane** — API key list/create/revoke UI、模型 catalog 管理、team management。
4. **Billing / cost-aware quota** — per-model pricing、token 单价、配额预警。
5. **Remote ThreadStore API** — Codex-style 跨设备 session resume。当前 D1 truth + DO restoreFromStorage 已部分覆盖。
6. **完整 SDK extraction** — F8 升级路径;tool catalog 已收(HP8-G),发布 SDK 包是 platform 工程。
7. **完整 handler-granularity refactor** — F5 升级路径;Part 2 只做 stop-the-bleed gate。
8. **WORKER_VERSION CI 切换** — G103 / ZX5 §3.3 row 2 留 platform。
9. **3-tier observability spike → 单发切换(F39 RHX2)** — 等真实客户端数据观察;hero-to-pro 内继续 dual-emit。
10. **prompt caching / structured output** — provider-specific 特性,依赖 multi-provider 路由先到。
11. **Sandbox 隔离 / streaming progress for bash** — bash-core 当前 fake 实现已能支撑 demo;sandbox 是 hardening 工程。

---

## 11. 风险与不确定性

1. **HP5(Tool/Workspace)与 RH4 R2 binding 的 multi-tenant 安全性** — Part 1 已注 multi-tenant 边界 bug 在 R2 真实接线后可能暴露。HP5 引入 `tenants/{team_uuid}/` 强制前缀,但需要严格审查 path traversal、bucket policy。建议 HP5 完成后做一次 owner/security review pass。
2. **HP6-A hook dispatcher 改造与 Part 1 HP3-B kernel interrupt 的合并冲突** — 两者都改 `runtime-mainline.ts` 与 `hooks/permission.ts`。强烈建议 HP6 在 Part 1 全部 merge 后启动。
3. **HP7-A R2 backed file snapshot 的成本** — 长 session 多个 checkpoint 会大量复制 R2 对象。`turn-end checkpoint rotate=10` 可能仍偏多;需观察成本后调整。
4. **HP8-A R28 owner-action 依赖** — owner 必须配合跑 wrangler tail;如 owner 无法 2 周内提供,HP8-A 退化为 explicit handoff(本质是 hero-to-platform inherited)。
5. **HP8-D Lane E 终态判定** — 选 sunset 路径需 HP8-A R28 已修;若 R28 未修,只能选 permanent fallback。两条路径都有技术成本,owner 需在 HP8 启动时决断。
6. **HP9 文档轮次的 review 成本** — 17 份文档若沿用 RHX2 4 家 review 模式,会非常耗时。建议 review 范围只覆盖新增 6 份 + rewrite 4 份,其余 7 份只做 sanity check。
7. **F2 WeChat 真机 smoke 六阶段 carryover** — owner 反复未交付的根因可能是物理设备 / 测试环境约束。HP9-B 必须 owner 配合;若仍无法,Part 2 不能放行 — HP10 final closure 需登记为 unresolvable。
8. **F15 R29 postmortem 可能无法完整定论** — 删除检测代码后再回查根因是反向工程,不一定能复现。HP8-B 接受三种判定(零 diff / 有 diff / 不可验证),不强求"找到根因",但禁止"silently inherit"。

---

## 12. 最终判断

Part 2 把 zero-to-real + real-to-hero 全部 25 份 closure 中识别出的 105 项 deferred 残留,与 Part 1 未覆盖的"Tool/Workspace 状态机 + Confirmation 完整 + File revert + manual evidence + 文档"压成 6 个 phase。完成后,nano-agent 的 4 套产品状态机全部成熟,跨阶段 chronic deferrals 全部 explicit-resolve 或 explicit-handoff。

**为什么 Part 2 必须做**:

- Part 1 完成后 nano-agent 仍是"无 todo / 无 workspace / 无 file revert / 无完整 confirmation / 无 manual evidence / 文档不对齐"的半成品;
- F1/F2 manual evidence 已经五/六阶段 carryover,不能再传一站;
- F12 hook dispatcher / F13 round-trip e2e 已经 wire 完整但**至今无调用方 / 无测试覆盖**,这是产品事实层面的 silent gap;
- F15 R29 deceptive closure 不能成为先例 — 删除检测 ≠ 修 bug;
- `clients/api-docs/` 11 份文档与 ~30 个新端点全部不同步,客户端开发者会再次在 stub 与真实之间被误导。

**为什么 Part 2 不进 hero-to-platform 边界**:

- multi-provider / sub-agent / admin / billing 都是产品形态变化(从 single-tenant Workers AI agent 变 SaaS),不是 wrapper 控制面收口;
- 这些工作的边界与 6-worker 拓扑、bash/filesystem/context worker 的现有 capability 都会再次大改,不应与 wrapper 收口混在一起;
- hero-to-platform 自己应有完整 charter,Part 2 留好入口而不替它写。

**预期效果**:完成 Part 1 + Part 2(~23.5 周)后,nano-agent 第一次:

- 与 Claude Code / Codex / Gemini CLI 在 4 套状态机上同档位(Model / Context / Chat / Tool-Workspace)。
- 105 项 deferred 残留全部 explicit:closed / accepted-as-risk / handed-to-platform,无 silent 漂移。
- 17 份 `clients/api-docs/` 完整对齐代码,客户端开发者第一次能可靠依赖文档构建产品。
- F1+F2 manual evidence 完整归档,5 套设备 × 完整 e2e。
- F15 R29 显式 postmortem,deceptive closure 不再传站。
- DO heartbeat alarm + R28 root cause + Lane E 终态判定 + envelope 收敛 + 行数 stop-the-bleed 全部进入产品基线。

到这一步,"hero-to-pro" 不再只是 charter,而是 nano-agent 第一次具备完整 LLM wrapper 产品形态的真实落点;hero-to-platform 可以从一个干净 baseline 出发,而非继续修补 zero-to-real / real-to-hero 的历史债务。

Part 2 与 Part 1 同期 review;HP5/HP6 的 charter 在 Part 1 HP1-HP2 完成后写,可吸收 Part 1 实施反馈,避免任何 Part 2 phase 在执行时被 Part 1 计划反向约束。
