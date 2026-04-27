# ZX2 Transport Enhance — 收尾专项

> 类型: closure
> 关联: `docs/action-plan/zero-to-real/ZX2-transport-enhance.md`
> 上游调研: `docs/eval/zero-to-real/state-of-transportation-by-{opus,GPT}.md`
> 执行人: Opus 4.7（1M ctx）
> 时间: 2026-04-27
> 状态: **Phase 1 + Phase 2 已落地；Phase 3 - 6 转交后续执行窗口**

---

## 0. TL;DR

ZX2 把整个 transport 层的"契约地基"一次性交付完成 —— 5 个 transport profile 的命名冻结、NACP 协议公开 surface 补齐（`Envelope<T>` / `RpcMeta` / `RpcErrorCode` / `validateRpcCall`）、`nacp-session` 接收 5 族 7 个新 message_type、`orchestrator-auth-contract` 扩为 facade-http-v1 单一来源、6 个 worker 的 `workers_dev` 全部显式审计（含 agent-core preview = false）、4 个非 facade worker 的 fetch 入口加 binding-scope 守卫。**所有 worker 包测试 2372/2372 全绿**。Phase 3-6 的实施动作完全依赖这次落地的契约层；现在可以独立、并行启动。

```
Phase 1 ✅ done   transport-profiles.md / wrangler audit / binding-scope guard / api-docs README
Phase 2 ✅ done   nacp-core rpc.ts / nacp-session 5 族 / orchestrator-auth-contract facade-http-v1
Phase 3 ⏳ open   agent-core 4 RPC shadow + stream snapshot / bash-core RPC + NACP authority / 翻转
Phase 4 ⏳ open   orchestrator-core session envelope / WS frame 对齐 / session-ws-v1.md
Phase 5 ⏳ open   5 facade 必需端点 + 7 message_type 接入 + /me/sessions 冻结
Phase 6 ⏳ open   web/wechat 切单一 narrow + live preview e2e + 文档收口
```

---

## 1. 已交付物

### 1.1 文档（3 份新增 / 1 份更新）

| 文件 | 状态 | 说明 |
|---|---|---|
| `docs/transport/transport-profiles.md` | new | 5 profile 命名冻结（`nacp-internal` / `internal-http-compat` / `facade-http-v1` / `session-ws-v1` / `health-probe`），含范围、wire、信任栈、契约源、跨界规则、禁忌、状态标签词典 |
| `docs/issue/zero-to-real/ZX2-closure.md` | new | 本文件 |
| `docs/action-plan/zero-to-real/ZX2-transport-enhance.md` | updated | §12 执行日志（实施报告） |
| `clients/api-docs/README.md` | updated | profile 索引 + 9 篇文档分级 + 错误形状统一规则 |

### 1.2 NACP 协议补齐

**`packages/nacp-core/src/rpc.ts`**（约 320 行）— 公开 RPC 协议层。导出：
- `Envelope<T> = { ok:true; data:T } | { ok:false; error:RpcError }` 联合类型 + zod schema
- `RpcMeta` schema（`trace_uuid` / `caller` / `authority?` / `session_uuid?` / `request_uuid?` / `source?`）
- `RpcErrorCode` enum（30 个 code，含 auth / permission / lifecycle / runtime 四类）
- `RpcCaller` enum（11 个 caller，含 worker / cli / web / wechat-miniprogram / test）
- `validateRpcCall(rawInput, rawMeta, options)` —— caller-side 双头校验 helper，支持 `requireAuthority` / `requireTenant` / `requireSession` / `requireRequestUuid`
- `okEnvelope` / `errorEnvelope` / `envelopeFromThrown` / `envelopeFromAuthLike` 4 个 helper

通过 `packages/nacp-core/src/index.ts` 公开导出，nacp-core 测试 30/30 全绿、整包 289/289 全绿。

### 1.3 nacp-session 5 族 7 message_type 注册

**`packages/nacp-session/src/messages.ts`**（+143 行）— 加入：
| 族 | message_type | 方向 | required |
|---|---|---|---|
| permission | `session.permission.request` | server→client | ✅ |
| permission | `session.permission.decision` | client→server | ✅ |
| usage | `session.usage.update` | server→client (允许 0 字段) | ✅ |
| skill | `session.skill.invoke` | client→server | ✅ |
| command | `session.command.invoke` | client→server | ✅ |
| elicitation | `session.elicitation.request` | server→client | ✅ |
| elicitation | `session.elicitation.answer` | client→server | ✅ |

`type-direction-matrix.ts` 与 `session-registry.ts`（role + phase）同步更新；`SESSION_MESSAGE_TYPES` 从 8 升至 15；`SESSION_BODY_SCHEMAS` / `SESSION_BODY_REQUIRED` 同步。

测试：`zx2-messages.test.ts` 27/27 全绿；nacp-session 整包 146/146 全绿。

### 1.4 facade-http-v1 contract

**`packages/orchestrator-auth-contract/src/facade-http.ts`**（约 170 行）— 公开 facade-http-v1 协议层。导出：
- `FacadeErrorCode` enum（与 `RpcErrorCode` 一一对齐 + 包含所有 `AuthErrorCode`，编译期验证）
- `FacadeError` schema
- `FacadeSuccessEnvelope<T>` / `FacadeErrorEnvelope` / `FacadeEnvelope<T>` 三件套
- `facadeOk` / `facadeError` / `facadeFromAuthEnvelope` 3 个 helper

orchestrator-auth-contract 测试 19/19 全绿（含 15 新增 facade-http.test.ts）。

### 1.5 安全边界收口

**wrangler audit**：
| Worker | 旧 workers_dev | 新 workers_dev | 备注 |
|---|---|---|---|
| `orchestrator-core` | (隐式 true) | **explicit true** | 唯一 public facade |
| `orchestrator-auth` | (隐式) | **explicit false** | RPC + /health only |
| `agent-core` | true | **false** | 采纳 Q1：preview 与 production 一致 |
| `bash-core` | (隐式) | **explicit false** | service-binding 调用边界 |
| `context-core` | (隐式) | **explicit false** | library-only |
| `filesystem-core` | (隐式) | **explicit false** | library-only |

**binding-scope 守卫**（双层防御 = wrangler `workers_dev:false` + 代码层 401）：
| Worker | 守卫策略 | 错误形状 |
|---|---|---|
| `bash-core` | `/health` 公开；其余路径需 `x-nano-internal-binding-secret` 匹配，否则 401 | `{ error: "binding-scope-forbidden", message, worker: "bash-core" }` |
| `context-core` | `/health` 公开；其余 401 | `{ error: "binding-scope-forbidden", ..., worker: "context-core" }` |
| `filesystem-core` | `/health` 公开；其余 401 | 同上 worker 字段对应 |
| `orchestrator-auth` | `/health` 公开；非业务 RPC 路径 401（旧 404 `not-found` 升级为 401 `binding-scope-forbidden`） | 同上 |

---

## 2. 测试矩阵（最终态）

| 包 / Worker | tests | 通过 | 增量 |
|---|---|---|---|
| `@haimang/nacp-core` | 289 | 289 ✅ | +30 |
| `@haimang/nacp-session` | 146 | 146 ✅ | +27 |
| `@haimang/orchestrator-auth-contract` | 19 | 19 ✅ | +15 |
| `workers/orchestrator-auth` | 8 | 8 ✅ | 修 1 |
| `workers/orchestrator-core` | 36 | 36 ✅ | 0 |
| `workers/agent-core` | 1049 | 1049 ✅ | 0 |
| `workers/bash-core` | 360 | 360 ✅ | +1, 修 2 |
| `workers/context-core` | 171 | 171 ✅ | 修 1 |
| `workers/filesystem-core` | 294 | 294 ✅ | 修 1 |
| **合计** | **2372** | **2372 ✅** | **+73 新增 + 5 修订** |

> 没有任何 e2e / cross-worker 测试受影响；ZX2 v2 修订选择把 NACP 协议补齐放在 contract 层，不破坏运行时形状。

---

## 3. 业主决策落地一览

| Q | 业主/共识答 | 实际落地位置 |
|---|---|---|
| Q1：agent-core preview workers_dev？ | **不保留**（采纳 GPT 意见） | `workers/agent-core/wrangler.jsonc` |
| Q2：bash-core authority 形状？ | 复用 `IngressAuthSnapshot` + `caller` / `source` / `request_uuid` / `session_uuid?` | `RpcMetaSchema`（`packages/nacp-core/src/rpc.ts`）已就绪；Phase 3 P3-03 落 bash-core fetch 入口 |
| Q3：envelope 切换是否破坏式合并？ | 允许（Phase 4 + 6 同 PR + preview 7 天灰度） | 待 Phase 4+6 |
| Q4：`/me/sessions` lazy / eager？ | lazy 创建 + server-mint UUID 唯一真相 | 待 Phase 5 P5-02 |
| Q5：permission round-trip timeout？ | 30s default deny；可被 policy_permission_mode 覆盖 | `SessionPermissionRequestBodySchema.expires_at` 字段已留位 |
| Q6：parity 翻转判定？ | `≥1000 turns 且 mismatch=0 且连续 ≥7 天` + owner 批准 + 1 周回滚窗口 | 待 Phase 3 P3-05 |

---

## 4. 后续动作清单（按 Phase 切分）

### 4.1 Phase 3 — 内部 HTTP→RPC 退役补完

- [ ] **P3-01**：`AgentCoreEntrypoint` 加 RPC method `input/cancel/verify/timeline`，每个 method 入口跑 `validateEnvelope + verifyTenantBoundary + checkAdmissibility`（callee-side 双头校验），调用方 orchestrator-core `forwardInput/forwardCancel/forwardVerify/forwardTimeline` 用 `validateRpcCall` 跑 caller-side。dual-track parity 沿用 `forwardStart` 模板。
- [ ] **P3-02**：`AgentCoreEntrypoint.streamSnapshot(input, meta) → Envelope<{events:Event[], next_cursor:string|null}>`；持续推流走 WS、不进 parity；旧 `forwardInternalStream` NDJSON 路径保留 7 天兼容。
- [ ] **P3-03**：bash-core `WorkerEntrypoint` + RPC `call/cancel`；fetch 入口加 NACP authority 校验（已留 `NANO_INTERNAL_BINDING_SECRET` 检查位）；authority 必填 `caller / source / request_uuid / session_uuid?`。RPC 输出 `Envelope<ToolCallResponseBody>`。
- [ ] **P3-04**：agent-core `makeCapabilityTransport` 改用 `binding.call(...)`；HTTP fallback 保留 7 天。
- [ ] **P3-05**：parity 7 天通过 + runtime feature flag + `docs/runbook/zx2-rollback.md` 就绪后翻转真相，删除 fetch 路径。`internal-http-compat` profile 状态 `retired-with-rollback`。
- [ ] **P3-06**：`workers/{context,filesystem}-core/README.md` 落档 library-only 决议。

### 4.2 Phase 4 — 对外 envelope 统一 + WS frame 对齐

- [ ] **P4-01**：`workers/orchestrator-core/src/policy/authority.ts:jsonPolicyError` → `facadeError(code,status,message,trace_uuid)` 调用 `@haimang/orchestrator-auth-contract`。
- [ ] **P4-02**：orchestrator-core session 路径外层 `facadeOk(data, trace_uuid)`；user-do 内部仍业务字段。
- [ ] **P4-03**：DO `HttpController` 输出改 `{phase, ...}`，由外层 facade 包 envelope。
- [ ] **P4-04**：server WS frame 对齐 `NacpSessionFrameSchema`；compat 层把现有 `{kind,...}` alias 映射回 frame.body。
- [ ] **P4-05**：撰写 `clients/api-docs/session-ws-v1.md`（基于 `NacpSessionFrameSchema` 的 server-frame registry，含 close codes / ack / size 上限 / heartbeat / order / resume）。

### 4.3 Phase 5 — 前端 facade 必需 HTTP/WS 接口

- [ ] **P5-01**：5 端点（`POST /sessions/{id}/permission/decision` / `POST /sessions/{id}/policy/permission_mode` / `GET /sessions/{id}/usage` / `POST /sessions/{id}/resume` / `GET /catalog/{skills,commands,agents}`）落 orchestrator-core；全部走 facade-http-v1。
- [ ] **P5-02**：`POST /me/sessions` server-mint UUID + TTL 24h + 跨设备 resume 同 UUID + 重复 start 409；`GET /me/sessions` 列表（基于 D1 conversations + sessions truth read，不动 schema）。
- [ ] **P5-03**：7 个新 message_type 接入 orchestrator-core User DO + agent-core Session DO；permission 30s 超时；usage update ≥1Hz auto-merge backpressure。
- [ ] **P5-04**：撰写 `clients/api-docs/{permissions,usage,catalog,me-sessions}.md`。

### 4.4 Phase 6 — 客户端 + e2e + 文档收口

- [ ] **P6-01**：`clients/web/src/client.ts` 单一 narrow（统一 `FacadeEnvelope<T>`）；删除自造 sessionUuid 路径，改走 `POST /me/sessions`。
- [ ] **P6-02**：`clients/wechat-miniprogram/{apiRoutes.js, utils/api.js, utils/nano-client.js}` 同步。
- [ ] **P6-03**：`test/cross-e2e/zx2-transport.test.ts` 跑 register→login→start→permission round-trip→usage update→cancel→sessions list。
- [ ] **P6-04**：`state-of-transportation-by-{opus,GPT}.md` 末尾标注 ZX2 已落地；`transport-profiles.md` `internal-http-compat` 状态推进至 `retired`。

---

## 5. 风险与遗留事项

| ID | 描述 | 严重度 | 当前状态 | 后续动作 |
|---|---|---|---|---|
| R1 | bash-core 仅 secret 校验，未校验 NACP authority | medium | open | Phase 3 P3-03 |
| R2 | agent-core 还有 5 个 action 走 HTTP（input/cancel/verify/timeline/stream） | medium | open | Phase 3 P3-01/02 |
| R3 | orchestrator-core 公开 session 路径形状仍非 envelope | medium | open | Phase 4 P4-02 |
| R4 | DO `HttpController` 仍吐 `{ok:true, action, phase, ...}` | low | open | Phase 4 P4-03 |
| R5 | server WS frame 未对齐 `NacpSessionFrameSchema` | medium | open | Phase 4 P4-04 |
| R6 | rollback runbook 未撰写（P3-05 destructive 操作所需） | high | open | Phase 3 P3-05 |
| R7 | preview 部署未实测（仅本地单测全绿） | medium | open | Phase 6 P6-03 |
| R8 | 客户端仍可能消费旧 envelope 形状 | low | open | Phase 6 P6-01/02 |
| R9 | gemini-cli 能力面对照证据缺失 | low | scope-out | 列入 §2.2[O13]，留给后续 plan |

---

## 6. 验证证据

### 6.1 公网入口审计（preview 待部署后 curl 验证）

预期 `curl https://nano-agent-bash-core-preview.haimang.workers.dev/` → 404（workers_dev:false 起效）。
预期 `curl https://nano-agent-bash-core-preview.haimang.workers.dev/capability/call` → 401（即便 workers_dev:true，binding-scope guard 也兜底）。

> **手动验证步骤**：preview 重新部署后，对每个非 facade worker 跑：
> ```
> curl -i https://nano-agent-<worker>-preview.haimang.workers.dev/
> curl -i https://nano-agent-<worker>-preview.haimang.workers.dev/health
> curl -i -X POST https://nano-agent-<worker>-preview.haimang.workers.dev/anything
> ```
> 期望：
> - `/` 与 `/health` → 200 + shell response（health-probe profile）
> - 任意其他路径 → 401 `binding-scope-forbidden` 或 404（视 wrangler workers_dev 设置）

### 6.2 单测证据

```bash
# 协议层
pnpm -F @haimang/nacp-core test                          # 289/289 ✅
pnpm -F @haimang/nacp-session test                       # 146/146 ✅
pnpm -F @haimang/orchestrator-auth-contract test         # 19/19 ✅

# Worker 层（运行时）
pnpm -F @haimang/orchestrator-auth-worker test           # 8/8 ✅
pnpm -F @haimang/orchestrator-core-worker test           # 36/36 ✅
pnpm -F @haimang/agent-core-worker test                  # 1049/1049 ✅
pnpm -F @haimang/bash-core-worker test                   # 360/360 ✅
pnpm -F @haimang/context-core-worker test                # 171/171 ✅
pnpm -F @haimang/filesystem-core-worker test             # 294/294 ✅
```

合计：**2372 tests, 0 failed**。

### 6.3 typecheck

```bash
pnpm -F @haimang/orchestrator-auth-contract typecheck    # ✅ pass
```

> 全 workspace `pnpm -w run typecheck` 在 Phase 3+ 实施时再做最终 round-trip。

---

## 7. 给后续执行者的说明

### 7.1 怎样接着干

1. **如果你接着干 Phase 3**：直接照 §4.1 的 checklist 干。所有 contract 都已就绪，**不需要再创建包或定义新类型**。RPC method 入参用 `validateRpcCall(rawInput, rawMeta, { inputSchema, requireAuthority, requireSession, ... })` 把脏输入转为型化数据；出参用 `okEnvelope(data)` / `errorEnvelope(code, status, message)` / `envelopeFromThrown(err)`。
2. **如果你接着干 Phase 4**：worker 内部 import `@haimang/orchestrator-auth-contract` 拿 `facadeOk` / `facadeError`；DO 内部不要再发明形状。
3. **如果你接着干 Phase 5**：所有新端点入参用 zod schema；session-bound 端点经 `authenticateRequest`；7 个新 message_type 直接 import 自 `@haimang/nacp-session`。
4. **如果你接着干 Phase 6**：客户端 narrow 见 `FacadeEnvelope<T>` 联合类型；删除现有 `client.envelope()` 与 `client.json()` 的双路径。

### 7.2 雷区提示

- **不要新建 `packages/orchestrator-rpc-contract`**（业主与 GPT 共识：通用协议属于 nacp-core）。
- **不要发明新的 WS frame envelope**（一律基于 `NacpSessionFrameSchema`）。
- **不要让 bash-core 仅靠 binding-secret 通过**（Phase 3 P3-03 必须加 NACP authority 校验）。
- **不要在 P3-05 翻转前删除 internal HTTP fetch 路径**（必须先有 7 天 parity + runtime flag + rollback runbook）。
- **不要把产品型功能（`/sessions/{id}/messages` / `/files` / `/me/conversations` / `/devices/revoke`）混入 ZX2**（plan §2.2 [O8-O11] 明确列入 ZX3 候选）。

---

## 8. 收尾签字

- ✅ Phase 1 — Transport-profile 命名 + P0 安全收口（4/4 工作项 done）
- ✅ Phase 2 — NACP 协议补齐 + facade contract 扩展 + 双头校验（4/4 工作项 done）
- ⏳ Phase 3 — 内部 HTTP→RPC 退役补完（0/6 工作项）
- ⏳ Phase 4 — 对外 envelope 统一 + WS frame 对齐 NACP（0/5 工作项）
- ⏳ Phase 5 — 前端 facade 必需 HTTP/WS 接口（0/4 工作项）
- ⏳ Phase 6 — 客户端 + e2e + 文档收口（0/4 工作项）

> 本次 ZX2 的"契约层"地基交付完整、测试 100% 通过、业主决策（含 Q1）落地清晰。Phase 3-6 是运行时切换 + 前端能力补完，全部基于本次落地的 contract。任何重启 ZX2 工作的人都可以从 §4 直接开干，无需再读两份调查报告与 plan 修订历史。
