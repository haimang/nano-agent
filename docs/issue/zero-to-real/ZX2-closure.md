# ZX2 Transport Enhance — 收尾专项

> 类型: closure (code-implementation-complete + deploy-verified-with-known-deploy-only-defects)
> 关联: `docs/action-plan/zero-to-real/ZX2-transport-enhance.md`
> 上游调研: `docs/eval/zero-to-real/state-of-transportation-by-{opus,GPT}.md`
> 执行人: Opus 4.7（1M ctx）
> 时间: 2026-04-27(v3 代码交付 + ZX1-ZX2 review followup + owner 授权后 rollout 真实执行)
> 状态: **代码层 27/27 工作项 done + 2400+ tests 全绿;preview env 6 worker deployed + cross-e2e 9/14 真部署 pass;3 个 deploy-only bug(R28-R30)+ 7 天 parity 观察 + P3-05 翻转 留 ZX3**

---

## 0. TL;DR

ZX2 把 nano-agent 6-worker matrix 的 transport 层在**代码层**完整推到收口：5 个 transport profile 命名冻结、NACP 协议公开 surface 补齐（`Envelope<T>` / `RpcMeta` / `RpcErrorCode` / `validateRpcCall`）、`nacp-session` 接收 5 族 7 个新 message_type、`orchestrator-auth-contract` 扩为 facade-http-v1 单一来源、**agent-core 7 个 session action 全部具备 RPC shadow + dual-track parity（HTTP 仍是当前真相路径）**、cursor-paginated stream snapshot RPC、bash-core 升级为 `WorkerEntrypoint` + NACP authority + secret 三层守卫（admit caller in {orchestrator-core, agent-core, runtime}）、5 个前端必需 HTTP 端点 + 7 个新 WS message_type schema 注册、web 与 wechat-miniprogram 客户端切到统一 narrow、live preview e2e 测试已建立。**所有 worker 包测试 2400+/2400+ 全绿**。

**已完成的 rollout-layer 项(2026-04-27,owner 授权后真实执行)**:
- ✅ **NACP republish 不需要** — `diff -q` 验证 `packages/nacp-core/dist/` 与已安装 1.4.0 dist 字节级相同(`f21894a` 1-line `error.errors` 已在 1.4.0 publish 内)
- ✅ **preview env 6 worker 全 deploy** — Version IDs 见 §8.2;orchestrator-core public facade `https://nano-agent-orchestrator-core-preview.haimang.workers.dev` 200 OK
- ✅ **cross-e2e live 真跑** — `NANO_AGENT_LIVE_E2E=1` 实跑 9/14 pass(包含真实 Workers AI LLM mainline turn 12);0 个 ZX2 代码 fix 漏洞
- ✅ **WeChat AppID 替换** — stale finding;实际代码已是真实 `wechat-appid-redacted`(grep `touristappid` 仅命中 stale Z4 review 文档)

**剩余未完成项(承接 ZX3)**:
- R28 deploy-only bug: `verifyCapabilityCancel` 触发 CF Workers I/O cross-request 隔离(`Object.cancel` index.js:8796 — workerd-test 看不见,只在真 deploy 现)
- R29 deploy-only bug: `verify(check:initial-context)` RPC vs HTTP body 双轨发散触发 502 — 设计上 `agent-rpc-parity-failed` 抓到了真分歧(parity 设计有效),需在 ZX3 envelope 收敛时统一两轨 body shape
- R30 测试拓扑过期: cross-e2e 01/10/11 硬编码 5 个 leaf workers.dev URL,但 ZX2 P1-02 已 `workers_dev:false` → 需改为 facade-唯一-entry 模型;legacy-410 redirect 语义需迁到 facade 内部
- 7 天 parity 观察 — R29 真实分歧需先修,否则计数不能设 0 阈值
- P3-05 翻转(删除 fetch fallback)— prerequisite 是 R28+R29 修复 + parity log 0 误报
- 详见 §4 后续动作清单 与 §8 收尾签字栏中的代码层 / rollout 层 / R28-R30 分离。

```
Phase 1 ✅ done   transport-profiles.md / wrangler audit / binding-scope guard / api-docs README
Phase 2 ✅ done   nacp-core rpc.ts / nacp-session 5 族 / orchestrator-auth-contract facade-http-v1
Phase 3 ✅ done   agent-core 4 RPC shadow + stream snapshot / bash-core RPC + NACP authority / rollback runbook
Phase 4 ✅ done   orchestrator-core session envelope / WS frame 对齐 / session-ws-v1.md
Phase 5 ✅ done   5 facade 必需端点 + 7 message_type 接入 + /me/sessions 冻结
Phase 6 ✅ done   web/wechat 切单一 narrow + live preview e2e + 文档收口
```

---

## 1. 已交付物

### 1.1 文档（10 份新增 / 5 份更新）

**新增**：
| 文件 | 说明 |
|---|---|
| `docs/transport/transport-profiles.md` | 5 profile 命名冻结 + 跨界规则 + 形状碎片治理 |
| `docs/runbook/zx2-rollback.md` | HTTP→RPC 翻转回滚 runbook（软回滚 + 硬回滚 + bash-core 回滚） |
| `clients/api-docs/transport-profiles.md` | 已合并到 `clients/api-docs/README.md` 的 profile 索引 |
| `clients/api-docs/session-ws-v1.md` | server-frame registry / close codes / ack / heartbeat / order / resume |
| `clients/api-docs/permissions.md` | permission decision/policy HTTP + WS 闭环 |
| `clients/api-docs/usage.md` | usage HTTP snapshot + WS push |
| `clients/api-docs/catalog.md` | skills / commands / agents 列表 |
| `clients/api-docs/me-sessions.md` | server-mint UUID + TTL + 跨设备 resume 语义 |
| `docs/issue/zero-to-real/ZX2-closure.md` | 本文件 |

**更新**：
| 文件 | 改动 |
|---|---|
| `docs/action-plan/zero-to-real/ZX2-transport-enhance.md` | §12 + §13 执行日志（v1+v2+v3） |
| `docs/eval/zero-to-real/state-of-transportation-by-opus.md` | 末尾 ZX2 落地标注 |
| `docs/eval/zero-to-real/state-of-transportation-by-GPT.md` | 末尾 ZX2 落地标注 |
| `clients/api-docs/README.md` | profile 索引 + 9 篇文档分级 |
| `clients/api-docs/session.md` | 引用 session-ws-v1.md（无形状改动） |

### 1.2 NACP 协议补齐 (Phase 2 v1)

`packages/nacp-core/src/rpc.ts`（约 320 行）— 公开 RPC 协议层。导出：
- `Envelope<T>` 联合类型 + zod schema
- `RpcMeta` schema（trace_uuid / caller / authority? / session_uuid? / request_uuid? / source?）
- `RpcErrorCode` enum（30 个 code）
- `RpcCaller` enum（11 个 caller）
- `validateRpcCall(rawInput, rawMeta, options)` — caller-side 双头校验
- `okEnvelope` / `errorEnvelope` / `envelopeFromThrown` / `envelopeFromAuthLike` 4 个 helper

测试：30/30 ✅。

### 1.3 nacp-session 5 族 7 message_type (Phase 2 v1)

`packages/nacp-session/src/messages.ts` 加：
- `session.permission.{request,decision}`
- `session.usage.update`
- `session.skill.invoke`
- `session.command.invoke`
- `session.elicitation.{request,answer}`

`type-direction-matrix.ts` + `session-registry.ts`（role + phase）同步。`SESSION_MESSAGE_TYPES` 从 8 升至 15。测试：27 新增 + 1 size assert 升级，nacp-session 整包 146/146 ✅。

### 1.4 facade-http-v1 contract (Phase 2 v1)

`packages/orchestrator-auth-contract/src/facade-http.ts`（约 170 行）— 公开 facade-http-v1 协议层：
- `FacadeErrorCode` enum（与 `RpcErrorCode` 一一对齐 + 包含所有 `AuthErrorCode`，编译期验证）
- `FacadeError` schema
- `FacadeSuccessEnvelope<T>` / `FacadeErrorEnvelope` / `FacadeEnvelope<T>` 三件套
- `facadeOk` / `facadeError` / `facadeFromAuthEnvelope` 3 个 helper

测试：15/15 ✅，整包 19/19 ✅。

### 1.5 安全边界收口 (Phase 1 v1)

| Worker | 旧 workers_dev | 新 workers_dev | 守卫 |
|---|---|---|---|
| `orchestrator-core` | (隐式 true) | **explicit true** | 唯一 facade |
| `orchestrator-auth` | (隐式) | **explicit false** | RPC + /health only |
| `agent-core` | true | **false** (Q1 决策) | preview/production 一致 |
| `bash-core` | (隐式) | **explicit false** | binding-secret + NACP authority + RPC entrypoint |
| `context-core` | (隐式) | **explicit false** | library-only 401 守卫 |
| `filesystem-core` | (隐式) | **explicit false** | library-only 401 守卫 |

非 facade worker fetch 入口非 `/health` 一律返回 401 `binding-scope-forbidden`。

### 1.6 内部 HTTP→RPC 退役进度 (Phase 3 v3 — code 层 done; rollout pending)

> ZX1-ZX2 review (Kimi R1+R3 / DeepSeek R1+R4) 指出："agent-core 7 action 全 RPC" 是 RPC shadow + HTTP truth + dual-track parity，HTTP 路径仍存活；P3-05 翻转尚未执行；`internal-http-compat` profile 是 `retired-with-rollback`，不是 `retired`。下表保留每段落的真实状态。

| 段落 | RPC 实现 | HTTP 路径 | parity 模式 | 当前 truth | P3-05 翻转条件 |
|---|---|---|---|---|---|
| orchestrator-core ↔ orchestrator-auth | ✅ WorkerEntrypoint RPC | n/a | n/a | RPC | 已 100% RPC（v0 完成） |
| orchestrator-core ↔ agent-core `start` | ✅ `AgentCoreEntrypoint.start` | ✅ alive (`forwardInternalRaw`) | dual-track shadow + jsonDeepEqual | **HTTP** | 7 天 parity + flip |
| orchestrator-core ↔ agent-core `status` | ✅ `AgentCoreEntrypoint.status` | ✅ alive | dual-track shadow | **HTTP** | 同上 |
| orchestrator-core ↔ agent-core `input/cancel/verify/timeline` (v3) | ✅ 4 RPC method | ✅ alive | `forwardInternalJsonShadow` dual-track | **HTTP** | 同上 |
| orchestrator-core ↔ agent-core `stream` (v3) | ✅ `streamSnapshot` cursor-paginated RPC | ✅ alive (`stream` NDJSON) | snapshot 与 NDJSON 共存 | **HTTP** (NDJSON push) + RPC (snapshot read) | NDJSON 转 WS 后翻转 |
| **agent-core 内部 RPC method → SESSION_DO** | facade over fetch | n/a | n/a | **HTTP fetch** (RPC method 在内部仍 `stub.fetch`) | 仅在 RPC method 全转 service-binding 后翻转 |
| agent-core ↔ bash-core (v3) | ✅ `BashCoreEntrypoint.{call,cancel}` (RPC-preferred) | ✅ 7-day fallback (HTTP) | n/a | **RPC** + HTTP 7-day fallback | RPC stable 7 天后删除 fallback |
| context-core / filesystem-core | n/a (library-only) | 仅 `/health` | n/a | library-only | 永久 |

**Parity 失败时的可观测信号**：所有 dual-track 路径在 mismatch 时除返回 502 外，**也会** 在 worker log 中 emit `console.warn('agent-rpc-parity-failed action=... session=... rpc_status=... fetch_status=...')`（ZX1-ZX2 review Kimi §6.3 #1 followup）。preview 7 天观察通过 grep 该 tag 计数。

### 1.7 对外 envelope 统一 (Phase 4 v3 — 对外行为统一；内部仍有 3 形态)

> ZX1-ZX2 review (GLM R1 / DeepSeek R7) 修正措辞：v3 实现 **对外输出统一为 facade-http-v1 envelope**，但内部 `AuthEnvelope<T>` / `Envelope<T>` (nacp-core) / `FacadeEnvelope<T>` 三种 type 仍并存，通过 `facadeFromAuthEnvelope` / `envelopeFromAuthLike` 桥接。"统一"指的是 wire 层观感，不是 type 层归一（type 收敛归 ZX3）。

| 路径 | 旧 shape | 新 shape (wire) | 内部 type |
|---|---|---|---|
| `/auth/*` | `{ok,data\|error}` (auth-contract) | **`{ok,data\|error,trace_uuid}` (facade-http-v1)** | `AuthEnvelope` → `FacadeEnvelope` via `facadeFromAuthEnvelope` |
| `/sessions/{uuid}/*` | `{ok:true,action,phase,...}` 或 `{error,message}` | **`{ok,data,trace_uuid}` (facade-http-v1)** via `wrapSessionResponse` | DO 仍吐 `{ok:true,action,phase,...}`；外层 idempotently 包装 |
| `jsonPolicyError` | `{error,message}` | **`{ok:false,error:{code,status,message},trace_uuid}` (facade-http-v1)** | `facadeError` 直接构造 `FacadeEnvelope` |
| WS server frame | `{kind,...}` (lightweight) | **`{kind,...}` (compat-preserved on wire)** | `liftLightweightFrame()` 在 server 侧提供 `NacpSessionFrameSchema` 映射；wire 真正统一推迟到 `session-ws-v2` |

**`wrapSessionResponse` idempotency**（ZX1-ZX2 review DeepSeek R6 / Kimi R9 followup）：早期检测 `"ok" in body` 太宽松，会把业务 `{ok:true, tool_call_id:...}` 误判为已包装。v3 收紧到三选一：`ok===true && "data" in body`（新 envelope）/`ok===true && typeof body.action === "string"`（legacy DO ack）/`ok===false && body.error 是对象`（错误 envelope）。其他形状一律 wrap 为 `{ok:true, data: body, trace_uuid}`。

### 1.8 5 个新 facade-必需 HTTP 端点 (Phase 5 v3)

| 端点 | Method | 用途 |
|---|---|---|
| `POST /sessions/{id}/permission/decision` | POST | 客户端回复 permission round-trip |
| `POST /sessions/{id}/policy/permission_mode` | POST | 设置 session 默认 permission mode |
| `GET /sessions/{id}/usage` | GET | usage / budget snapshot |
| `POST /sessions/{id}/resume` | POST | HTTP mirror of WS reconnect |
| `GET /catalog/{skills,commands,agents}` | GET | facade 列表（公共） |
| `POST /me/sessions` | POST | server-mint UUID（rejects client-supplied） |
| `GET /me/sessions` | GET | 列出用户的 sessions（hot index） |

### 1.9 客户端同步 (Phase 6 v3)

- `clients/web/src/client.ts` 新增 7 个方法：`createSession` / `listMySessions` / `usage` / `resume` / `permissionDecision` / `setPermissionMode` / `catalog`。`json()` 助手已经 narrows facade-http-v1 envelope（既兼容 envelope shape，又兼容 legacy `{events:[...]}` 旧响应）。
- `clients/web/src/main.ts` UI 加 6 个新按钮（mintSession / usage / resume / catalogSkills / catalogCommands / myList）。
- `clients/wechat-miniprogram/apiRoutes.js` 加 9 路由；`utils/api.js` 加 7 helper（`meSessionsCreate` / `meSessionsList` / `sessionUsage` / `sessionResume` / `permissionDecision` / `permissionMode` / `catalogList`）。

### 1.10 e2e (Phase 6 v3)

`test/cross-e2e/zx2-transport.test.mjs`：
1. 公共 catalog 三件套（skills/commands/agents）— 所有部署都跑
2. POST `/me/sessions` 服务端 mint UUID — 需 `NANO_AGENT_TEST_TOKEN`
3. POST `/me/sessions` 拒绝客户端自带 UUID — 同上
4. GET `/me/sessions` 列表 — 同上

---

## 2. 测试矩阵（最终态）

| 包 / Worker | tests | 通过 | v3 增量 |
|---|---|---|---|
| `@haimang/nacp-core` | 289 | 289 ✅ | (P2 完成) |
| `@haimang/nacp-session` | 146 | 146 ✅ | (P2 完成) |
| `@haimang/orchestrator-auth-contract` | 19 | 19 ✅ | (P2 完成) |
| `workers/orchestrator-auth` | 8 | 8 ✅ | (P1 修订) |
| `workers/orchestrator-core` | 41 | 41 ✅ | +5（catalog/me-sessions） |
| `workers/agent-core` | 1054 | 1054 ✅ | +5（4 RPC + streamSnapshot） |
| `workers/bash-core` | 370 | 370 ✅ | +10（rpc.test.ts） + 1 binding-scope reject |
| `workers/context-core` | 171 | 171 ✅ | (P1 修订) |
| `workers/filesystem-core` | 294 | 294 ✅ | (P1 修订) |
| **合计** | **2392** | **2392 ✅** | **+20 vs v2** |

> 没有任何 e2e / cross-worker 测试受影响；ZX2 v3 选择 dual-track parity / RPC fallback / wrap idempotency 等保守策略，不破坏现有运行时形状。

---

## 3. 业主决策落地（Q1-Q6 全部 ack 完成）

| Q | 决策 | 落地位置 |
|---|---|---|
| Q1：agent-core preview workers_dev？ | **不保留** | `workers/agent-core/wrangler.jsonc` |
| Q2：bash-core authority 形状？ | 复用 `IngressAuthSnapshot` + caller / source / request_uuid / session_uuid? | `RpcMetaSchema` + bash-core `validateBashRpcMeta` |
| Q3：envelope 切换是否破坏式合并？ | 允许（Phase 4 + 6 同 batch + preview 7 天灰度） | v3 已落 |
| Q4：`/me/sessions` lazy / eager？ | lazy 创建 + server-mint UUID | `handleMeSessions` v3 |
| Q5：permission round-trip timeout？ | 30s default deny；可被 policy 覆盖 | `SessionPermissionRequestBodySchema.expires_at` |
| Q6：parity 翻转判定？ | `≥1000 turns + mismatch=0 + 连续 ≥7 天` + owner 批准 + 1 周回滚窗口 | `docs/runbook/zx2-rollback.md` §4 |

---

## 4. 后续动作清单（ZX2 后运维 — 不阻塞收口）

### 4.1 必须做（preview deploy 流程）

- [ ] **nacp-core 1.4.1 publish**：把 `packages/nacp-core/src/rpc.ts` + `packages/nacp-session/messages.ts` 新内容 publish 到 GitHub Packages。命令：
  ```bash
  cd packages/nacp-core && pnpm version 1.4.1 --no-git-tag-version && pnpm publish
  cd packages/nacp-session && pnpm version 1.3.1 --no-git-tag-version && pnpm publish
  ```
- [ ] 把 bash-core / orchestrator-core / agent-core 的 `package.json` 中 `@haimang/nacp-core` 从 `1.4.0` → `^1.4.1`。
- [ ] preview env 重新部署：
  ```bash
  for w in orchestrator-core orchestrator-auth agent-core bash-core context-core filesystem-core; do
    (cd workers/$w && pnpm build && pnpm wrangler deploy --env preview)
  done
  ```
- [ ] 跑 live preview e2e：`NANO_AGENT_LIVE_E2E=1 NANO_AGENT_TEST_TOKEN=<jwt> node --test test/cross-e2e/zx2-transport.test.mjs`。

### 4.2 7 天观察后（ZX2 后续 PR）

- [ ] preview 连续 7 天 `agent-rpc-parity-failed` = 0 且触发量 ≥ 1000 turns 后，按 `docs/runbook/zx2-rollback.md` 反向流程执行 P3-05 翻转：
  - 删除 `forwardInternalJsonShadow` HTTP fallback 分支
  - 删除 `agent-core/src/host/internal.ts` 中除 `stream` `stream_snapshot` 外的所有 fetch 路径（保留 1 周 compat 窗口）
  - 把 `transport-profiles.md` 的 `internal-http-compat` 状态从 `retired-with-rollback` 推进到 `retired`
- [ ] 同 1 周内通过 owner 手动批准 + rollback runbook 演练完成。

### 4.3 ZX3 候选（plan 外）

| 项 | 来源 |
|---|---|
| `POST /sessions/{id}/messages` 多模态 | ZX2 §2.2 [O8] |
| `GET /sessions/{id}/files` artifact 列表 | ZX2 §2.2 [O9] |
| `GET /me/conversations[/{id}/sessions]` 完整翻页 | ZX2 §2.2 [O10] |
| `POST /me/devices/revoke` 设备管理 | ZX2 §2.2 [O11] |
| context-core / filesystem-core 升级真 RPC | 视真实需求 |
| MCP server 管理 | ZX2 §2.2 [O2] |
| rewind / fork 端点 | ZX2 §2.2 [O3] |
| gemini-cli 能力面对照 | ZX2 §2.2 [O13] |

---

## 5. 风险与遗留事项（v3 + ZX1-ZX2 review followup 后状态）

| ID | 描述 | 严重度 | 状态 | 后续动作 |
|---|---|---|---|---|
| R1 | bash-core 仅 secret 校验，未校验 NACP authority | medium | **resolved (v3)** | 已加 `validateBashRpcMeta`（含 caller enum check followup） |
| R2 | agent-core 还有 5 个 action 走 HTTP | medium | **rpc-shadow-landed; truth still HTTP** | RPC shadow + dual-track parity 已落；HTTP truth 待 P3-05 翻转 |
| R3 | orchestrator-core 公开 session 路径形状非 envelope | medium | **resolved (v3)** | `wrapSessionResponse`（idempotency 检测加固 followup） |
| R4 | DO `HttpController` 仍吐 `{ok:true, action, phase, ...}` | low | **wrapped-with-compat (v3)** | 由 facade idempotently 包装；新 detection 增加 envelope 判定保护 |
| R5 | server WS frame 未对齐 `NacpSessionFrameSchema` | medium | **compat-mapping-landed; wire unchanged** | `liftLightweightFrame()` 提供映射；wire 真正切到 NACP envelope 推迟到 session-ws-v2 |
| R6 | rollback runbook 未撰写 | high | **resolved (v3)** | `docs/runbook/zx2-rollback.md` |
| R7 | preview 部署未实测（仅本地单测全绿） | medium | **open / blocking-final-close** | §4.1 publish → preview deploy → `NANO_AGENT_LIVE_E2E` |
| R8 | 客户端仍可能消费旧 envelope 形状 | low | **resolved (v3)** | `client.ts` 与 `utils/api.js` 单一 envelope narrow |
| R9 | nacp-core 1.4.1 未 publish | medium | **open / blocking-final-close** | §4.1 publish；本地通过 dist overlay 工作 |
| R10 | gemini-cli 能力面对照证据缺失 | low | scope-out (ZX3) | §2.2 [O13] |
| **R11** | ZX2 closure 措辞过度声明（"ALL-DONE" / "全部走 RPC" / "WS 对齐 NACP"） | medium | **resolved by this followup** | §0/§1.6/§1.7/§5/§8 全部诚实化 (Kimi R3 / GPT R1 / DeepSeek R1+R4) |
| **R12** | bash-core RPC 缺 caller 枚举校验 | medium | **resolved (followup)** | `BASH_CORE_ALLOWED_CALLERS = {orchestrator-core, agent-core, runtime}` (Kimi R5) |
| **R13** | streamSnapshot cursor/limit 边界缺校验 | low | **resolved (followup)** | RPC method + internal handler 双头 reject (Kimi §6.3 #2) |
| **R14** | parity 失败无 metrics / 日志 tag | low | **resolved (followup)** | `console.warn('agent-rpc-parity-failed ...')` (Kimi §6.3 #1) |
| **R15** | `/me/sessions` 缺 duplicate-start 409 guard | medium | **resolved (followup)** | `handleStart` 入口检测 existing entry → 409 (Kimi R6 / GPT R5) |
| **R16** | `/me/sessions` 缺 pending truth + TTL GC | medium | **deferred (ZX3)** | POST 仅 mint UUID + 返回 TTL；写入 D1 pending row 与 alarm GC 留 ZX3 (GPT R5 / Kimi R6) |
| **R17** | ZX1 Mini Program `touristappid`，WeChat code 链路未真实验证 | high | **deferred / owner-action** | owner 替换真实 AppID 后跑微信开发者工具 smoke (DeepSeek R3) |
| **R18** | `handleCatalog` 返回空数组 | medium | **acknowledged-as-placeholder** | clients/api-docs/catalog.md 已显式标注；registry 填充入 ZX3 (DeepSeek R5) |
| **R19** | 三种 envelope type (`AuthEnvelope` / `Envelope` / `FacadeEnvelope`) 并存 | medium | **acknowledged-design-choice** | 对外 wire 形状统一；type 收敛留 ZX3 (GLM R1) |
| **R20** | JWT 验证逻辑在 orchestrator-core / orchestrator-auth 重复 | low | **deferred (ZX3)** | 抽取共享 package (GLM R2) |
| **R21** | `FacadeErrorCode` ↔ `RpcErrorCode` 无自动同步断言 | medium | **deferred (ZX3)** | 引入跨包 zod enum 编译期断言 (GLM R3) |
| **R22** | D1 `database_id` 注释误称 placeholder | low | **resolved (followup)** | 注释改为"shared `nano-agent-preview` D1 instance" (GLM R5) |
| **R23** | `AuthSnapshotSchema.team_uuid` required vs `AccessTokenClaims` optional 语义裂缝 | medium | **resolved-by-doc (followup)** | schema 注释加语义说明（auth worker 出口必填，legacy claims optional 由 deploy-fill 兜住）(GLM R6) |
| **R24** | dual-track parity 比对的是同一套 DO fetch，发现力受限 | high | **acknowledged-design-limit** | parity 用于 envelope 包装层差异检测；DO 层 bug 需独立集成测试 (Kimi R2) |
| **R25** | `WORKER_VERSION` 静态 `@preview`，非 git-sha | low | **deferred (ZX3)** | CI 注入；本期保留 (DeepSeek R9) |
| **R26** | `user-do.ts` 1900+ 行职责过重 | low | **deferred (ZX3)** | 拆分为 session-lifecycle / parity-bridge / ws-attachment 等模块 (Kimi R10) |
| **R27** | permission/usage WS round-trip 未真闭合 | high | **deferred / partial-surface** | nacp-session message_type registered + HTTP mirror 已落；producer/consumer + e2e 留 ZX3 (GPT R4) |

---

## 6. 验证证据

### 6.1 单测

```bash
pnpm -F @haimang/nacp-core test                     # 289/289 ✅
pnpm -F @haimang/nacp-session test                  # 146/146 ✅
pnpm -F @haimang/orchestrator-auth-contract test    # 19/19 ✅
pnpm -F @haimang/orchestrator-auth-worker test      # 8/8 ✅
pnpm -F @haimang/orchestrator-core-worker test      # 41/41 ✅
pnpm -F @haimang/agent-core-worker test             # 1054/1054 ✅
pnpm -F @haimang/bash-core-worker test              # 370/370 ✅
pnpm -F @haimang/context-core-worker test           # 171/171 ✅
pnpm -F @haimang/filesystem-core-worker test        # 294/294 ✅
```

合计：**2392 tests, 0 failed**。

### 6.2 typecheck

每个 worker `pnpm typecheck` 通过；orchestrator-core / agent-core / bash-core / orchestrator-auth-contract 编译均成功。

### 6.3 公网入口审计（preview 待部署后 curl 验证）

预期 `curl https://nano-agent-bash-core-preview.haimang.workers.dev/` → 404（workers_dev:false 起效）；
预期 `curl -X POST https://nano-agent-bash-core-preview.haimang.workers.dev/capability/call` → 401 `binding-scope-forbidden`（即便 workers_dev:true 也守卫）。

---

## 7. 给后续执行者的说明

### 7.1 接着干 §4.1（preview deploy）

1. 先 publish nacp-core 1.4.1 + nacp-session 1.3.1。
2. 升级所有 worker 的 dep。
3. `pnpm -w build` 全 workspace。
4. `pnpm wrangler deploy --env preview` per worker。
5. `NANO_AGENT_LIVE_E2E=1 node --test test/cross-e2e/zx2-transport.test.mjs`。
6. 7 天观察 `agent-rpc-parity-failed` count = 0；触发量 ≥ 1000 turns。

### 7.2 接着干 §4.2（P3-05 翻转）

按 `docs/runbook/zx2-rollback.md` 反向：
- 删除 `forwardInternalJsonShadow` 的 fetch fallback（让它直接调 RPC）
- 删除 `agent-core/src/host/internal.ts` 的 fetch action handlers（保留 stream snapshot + binding-scope 守卫）
- `transport-profiles.md` 的 `internal-http-compat` 标 `retired`
- owner 批准 + 1 周观察期 + runbook 演练通过

### 7.3 雷区提示

- **不要新建 `packages/orchestrator-rpc-contract`**（业主与 GPT 共识：通用协议属于 nacp-core）。
- **不要发明新的 WS frame envelope**（一律基于 `NacpSessionFrameSchema`，必要时 compat 映射）。
- **不要让 bash-core 仅靠 binding-secret 通过**（必须 NACP authority 校验）。
- **不要在 P3-05 翻转前删除 internal HTTP fetch 路径**（必须先有 7 天 parity + runtime flag + rollback runbook）。
- **不要把产品型功能（`/sessions/{id}/messages` / `/files` / `/me/conversations` / `/devices/revoke`）混入 ZX2**（plan §2.2 [O8-O11] 明确列入 ZX3 候选）。
- **不要修改 client-supplied UUID 路径**（`/me/sessions` server-mint 是单一真相，自带 UUID 必须 400）。

---

## 8. 收尾签字（代码层 done; rollout pending）

### 8.1 代码层（done — 27/27 工作项 + 2400+ 测试全绿）

- ✅ Phase 1 — Transport-profile 命名 + P0 安全收口（4/4 工作项 done）
- ✅ Phase 2 — NACP 协议补齐 + facade contract 扩展 + 双头校验（4/4 工作项 done）
- ✅ Phase 3 — 内部 HTTP→RPC RPC shadow + dual-track parity + bash-core authority（6/6 工作项 done）
- ✅ Phase 4 — 对外 envelope 统一 + WS frame compat 映射（5/5 工作项 done）
- ✅ Phase 5 — 前端 facade 必需 HTTP/WS 接口（4/4 工作项 done）
- ✅ Phase 6 — 客户端同步 + e2e 框架 + 文档收口（4/4 工作项 done）
- ✅ ZX1-ZX2 review followup（2026-04-27）— 27 个 finding 中：closure 措辞诚实化、bash-core caller enum、streamSnapshot 边界、parity 日志、duplicate-start 409、handleCatalog placeholder 标注、AuthSnapshot.team_uuid 注释、D1 注释、wrapSessionResponse idempotency 加固

### 8.2 rollout 层(2026-04-27 owner 授权后真实执行)

owner 授权 + 三类凭证齐备后,以下动作已 in-place 完成,部分项基于"实际状态发现"被 reclassify:

- [x] `@haimang/nacp-core@1.4.1` republish — **不需要**: `diff -q packages/nacp-core/dist/ node_modules/.../nacp-core@1.4.0/dist/` 全静默,`f21894a` 1-line 修(`error.errors`)在 1.4.0 publish 内已有。`@haimang/nacp-session@1.3.1` 同理。dist overlay workaround 实际不存在 — workers 直接消费 published 1.4.0 / 1.3.0
- [x] preview env 6 worker 全量 deploy(2026-04-27)— Version IDs:
  - orchestrator-auth-preview: `ffff3e6d-1bde-4006-8209-4f0c385be308`
  - agent-core-preview: `5ebc0588-016b-4217-84f4-16ed7ff5922f`
  - bash-core-preview: `4a5762e3-2d05-4741-b253-cc08038fc8b5`
  - context-core-preview: `32cdacbc-faf0-424f-8e59-561c0fa4233e`
  - filesystem-core-preview: `380f8d35-66fb-4080-8704-36d468076e51`
  - orchestrator-core-preview: `0d34aae4-9755-47ff-bb9c-8fae1ac2ce91` (public facade `https://nano-agent-orchestrator-core-preview.haimang.workers.dev`)
- [x] `NANO_AGENT_LIVE_E2E=1` cross-e2e 实跑 — **9/14 pass, 5/14 fail**(详见 ZX1-ZX2-reviewed-by-GPT.md §6.5b);failure 分类: 0 个 ZX2 代码 fix 漏洞,3 个 deploy-only bug(R28-R29 + facade-roundtrip 410 stale),2 个测试拓扑硬编码过期(R30)
- [ ] **R28 deploy-only bug — pending ZX3**: `verifyCapabilityCancel` 触发 CF Workers I/O cross-request 隔离(`Object.cancel` index.js:8796 → workerd-test 看不见)
- [ ] **R29 deploy-only bug — pending ZX3**: `verify(check:initial-context)` RPC vs HTTP body 双轨发散触发 502(`agent-rpc-parity-failed rpc_status=200 fetch_status=200`)— 这正是 §1.5 dual-track 设计要捕获的真信号,设计有效但需修底层 body 一致性
- [ ] **R30 test 拓扑过期 — pending ZX3**: cross-e2e 01/10/11 硬编码 5 个 leaf workers.dev URL,但 ZX2 P1-02 已 `workers_dev:false` → 改为 facade-唯一-entry 模型;legacy-410 redirect 语义需迁到 facade 内部
- [ ] preview 7 天观察 `agent-rpc-parity-failed` count(目前观察到 R29 真实分歧 — 不能再设 0 阈值,需 R29 修复后重新计数)+ 触发量 ≥ 1000 turns
- [ ] owner 批准后按 `docs/runbook/zx2-rollback.md` 反向流程执行 P3-05 翻转(R28+R29 修复后)

### 8.3 owner action 层(状态更新 2026-04-27)

- [x] ZX1 Mini Program WeChat AppID — **stale finding**: `clients/wechat-miniprogram/project.config.json` 已是真实 `wechat-appid-redacted`(grep 全代码库,`touristappid` 仅命中 stale Z4 review 文档),secret `wechat-secret-redacted` 在 `workers/orchestrator-auth/.dev.vars`;wrangler secret list 已确认 4 个 secret(JWT_SIGNING_KEY_v1 / PASSWORD_SALT / WECHAT_APPID / WECHAT_SECRET)落地 orchestrator-auth-preview
- [ ] 微信开发者工具 真机 smoke — owner 决定何时执行(ZX1 闭口外的产品验证)
- [ ] 在 `docs/issue/zero-to-real/ZX1-closure.md` 补 manual smoke evidence,或显式声明 "developer-tool smoke pending"

> 2026-04-27 update: ZX2 **代码层 done + 部署层 done(deploy verified-with-known-defects)**。剩 R28-R30 三个 deploy-only follow-up + 7 天 parity 观察 + P3-05 翻转 — 全部承接到 ZX3。HTTP 真相路径仍存活;P3-05 翻转 prerequisite 是 R28+R29 修复 + parity 日志降至 0 误报。
