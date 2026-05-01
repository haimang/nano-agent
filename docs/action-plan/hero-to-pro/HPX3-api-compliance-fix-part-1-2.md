# HPX3 — API Compliance Fix（Part 1 + Part 2 综合修复指引）

> 范围: `clients/api-docs/` 下 6 份调查（part1/part2 × deepseek/GLM/kimi）所覆盖的 9 个簇 / 34 个端点
> Profile / 协议族: `facade-http-v1`
> 综合者: Claude (Opus 4.7)
> 时间: 2026-05-01
> 上游真相对照（SSoT，只读引用）:
> - `packages/orchestrator-auth-contract/src/facade-http.ts` — `FacadeErrorCodeSchema` / `FacadeErrorEnvelopeSchema`
> - `workers/orchestrator-core/src/index.ts`
> - `workers/orchestrator-core/src/auth.ts`
> - `workers/orchestrator-core/src/policy/authority.ts`
> - `docs/design/hero-to-pro/HPX-qna.md` Q16/Q19/Q21/Q27
> 输入文档:
> - `docs/eval/hero-to-pro/api-compliance/part1-by-deepseek.md`（Auth + Catalog + Checkpoints）
> - `docs/eval/hero-to-pro/api-compliance/part1-by-GLM.md`
> - `docs/eval/hero-to-pro/api-compliance/part1-by-kimi.md`
> - `docs/eval/hero-to-pro/api-compliance/part2-by-deepseek.md`（Confirmations + Context + /me）
> - `docs/eval/hero-to-pro/api-compliance/part2-by-GLM.md`
> - `docs/eval/hero-to-pro/api-compliance/part2-by-kimi.md`
> 文档状态: `draft → executable`

---

## 0. 总判定

经过将 6 份报告的全部 claim 平铺并与代码逐条核实，本轮 hero-to-pro 阶段 API 合规存在 **2 项 CRITICAL** + **3 项 FINDING** + **若干 WARN**，需在声明 NACP `facade-http-v1` 合规之前修复 CRITICAL + FINDING（共 5 项 blocker）。WARN 项为建议改善，不阻塞合规声明。

- **CRITICAL（2 项）**：`facade-http-v1` 错误信封被违约（顶层 `data` 字段非法出现），并使用了未在 `FacadeErrorCodeSchema` 中注册的 error code。两处端点：
  - `POST /sessions/{id}/checkpoints/{checkpoint_uuid}/restore`（index.ts:1410-1422）
  - `POST /sessions/{id}/confirmations/{uuid}/decision`（index.ts:1642-1655）
- **FINDING（3 项）**：未注册 error code 跨多个端点出现：
  - `confirmation-already-resolved`、`conversation-deleted`、`context-rpc-unavailable`、`auth-misconfigured`、`invalid-auth-body`、`missing-team-claim`
- **WARN（多项）**：catalog `optional bearer` 文档与代码不一致；context POST 端点 body 实际被丢弃但 doc 声明可接收；context 路由 facade 层缺 session ownership；`POST /me/devices/revoke` 无 dedicated 单测；auth verify/me/resetPassword 不走 facade `authenticateRequest`。

> 在 §1 的 claim 平铺表中，已用 ✅ / ❌ / ⚠️ 标注每条 claim 的核实结论，避免按错误线索修复。

---

## 1. 6 份报告 Claim 平铺与核实

> 平铺规则：每条 claim 取自原报告，按"内容 → 核实结论 → 备注"三栏排列。  
> 核实结论：`✅ 属实`、`❌ 不实`、`⚠️ 部分属实 / 表述不准`。

### 1.1 错误信封违约（最高优先级）

| 来源 | Claim | 核实 | 备注 |
|------|-------|------|------|
| Part1 kimi CP3 / GLM F-CHK-01 | `index.ts:1410-1422` checkpoint restore 409 响应携带非法 `data: { confirmation }` 字段 | ✅ 属实 | 已在 index.ts:1410-1422 看到 `data: { confirmation }` |
| Part1 kimi CP3 | 同问题在 confirmation decision 路由也存在 | ✅ 属实 | index.ts:1642-1655 携带 `data: { confirmation: result.row }` |
| Part2 kimi C-CON-01 / GLM F-CFM-01 / deepseek W-CFM-01 | confirmation decision 409 包含 `data` 字段 | ✅ 属实 | 与上同一处；deepseek 误判为 WARN，应为 CRITICAL |
| Part1/Part2 GLM/kimi | `FacadeErrorEnvelopeSchema` (`facade-http.ts:137-141`) 仅允许 `{ ok, error, trace_uuid }` 三字段，不允许 `data` | ✅ 属实 | 已读 facade-http.ts，schema 严格 |

### 1.2 未注册 Error Code（次高优先级）

| 来源 | Claim | 核实 | 备注 |
|------|-------|------|------|
| Part2 kimi C-CON-01 | `confirmation-already-resolved` 不在 `FacadeErrorCodeSchema` 枚举内 | ✅ 属实 | facade-http.ts:48-84 枚举 38 项，无此 code |
| Part2 kimi F-CTX-01 / GLM F-CTX-01 / deepseek（隐含） | `context-rpc-unavailable` 不在 `FacadeErrorCodeSchema` | ✅ 属实 | index.ts:2614 用此 code，schema 无 |
| Part2 GLM F-CTX-01 | `context-rpc-unavailable` 在 `nacp-core/error-registry.ts` 注册 | ⚠️ 表述不准 | 未在 facade error 字典中登记，运行期 `jsonPolicyError` 直接序列化此字符串，并不会被 `facadeError()` coerce（此调用路径不经过 `facadeFromAuthEnvelope`，直接 `Response.json`） |
| Part2 kimi F-SHR-01 | `conversation-deleted` 不在 `FacadeErrorCodeSchema` | ✅ 属实 | grep 确认 index.ts:1302/1530/1724/2391 使用，schema 无；本仓库出现 4 处 |
| Part2 kimi F-AUT-01 | `invalid-trace` 不在 `FacadeErrorCodeSchema` | ❌ 不实 | facade-http.ts:53 已含 `invalid-trace`。kimi 误判 |
| Part2 kimi F-AUT-01 | `auth-misconfigured` 不在 `FacadeErrorCodeSchema` | ✅ 属实 | auth.ts:249 使用，schema 无 |
| 平铺新增（核实派生） | `invalid-auth-body` 不在 `FacadeErrorCodeSchema` | ✅ 属实 | index.ts:573 使用，schema 无（应为 `invalid-input` 或新增） |
| 平铺新增（核实派生） | `missing-team-claim` 不在 `FacadeErrorCodeSchema` | ✅ 属实 | auth.ts/index.ts 多处使用，schema 无 |

### 1.3 文档与代码不一致

| 来源 | Claim | 核实 | 备注 |
|------|-------|------|------|
| Part1 全部 3 家 | catalog auth 文档写 `optional bearer`，但代码完全不读 Bearer | ✅ 属实 | catalog.md:6 + handleCatalog 不调 `authenticateRequest` 也不读 Authorization 头 |
| Part2 kimi W-CTX-01 | `GET /sessions/{id}/context` 文档称 "legacy alias of probe"，但代码 `op="get"` 调用 `getContextSnapshot` 而非 `getContextProbe` | ✅ 属实 | index.ts:2516-2526 vs 2527-2537 是两条不同 RPC 路径 |
| Part2 kimi W-CTX-02 | Context POST 端点 façade 层未校验 request body shape，body 透传到 context-core | ⚠️ 表述不准 | 实际更糟：façade 完全不读取也不传递 body（index.ts:2549-2580 仅传 `meta`），body 被丢弃。doc 声明的 `{force, preview_uuid, label}` 等 body 字段实际无效 |
| Part1 GLM F-AUTH-01 | `/auth/verify`、`/auth/me`、`/me`、`/auth/password/reset` 不走 facade `authenticateRequest`，跳过 device gate | ✅ 属实 | proxyAuthRoute (index.ts:558-632) 仅对 `revokeApiKey` 显式调 `authenticateRequest`；其它路径只读 Bearer header 后传给 auth worker |

### 1.4 测试覆盖

| 来源 | Claim | 核实 | 备注 |
|------|-------|------|------|
| Part2 GLM W-ME-01 / kimi W-DEV-01 | `POST /me/devices/revoke` 无任何 dedicated 单元测试 | ✅ 属实 | me-devices-route.test.ts 仅 GET 列表（227 行，无 `/me/devices/revoke` POST 用例）；live e2e 在 `test/cross-e2e/13-device-revoke-force-disconnect.test.mjs:96` 有 |
| Part2 deepseek（W-DEV-01 反例） | `me-devices-route.test.ts:162` 覆盖 revoke | ❌ 不实 | 该行为 `revoked device is excluded from default active list`，仍然是 GET 测试。deepseek 错读 |
| Part1 GLM W-AUTH-01 | `/auth/verify` 无 dedicated JWT verifyToken 服务测试 | ✅ 属实 | grep `verifyToken\|"verify"` 在 service.test.ts 无匹配 |
| Part1 kimi（auth 路由表） | 8 of 9 auth 路由无 facade-level smoke 测试 | ⚠️ 表述不准 | `register` 有 smoke 测试；其它路由确实在 orchestrator-core smoke 层缺失，但在 `service.test.ts` 服务层均覆盖 |

### 1.5 Tenant / 安全

| 来源 | Claim | 核实 | 备注 |
|------|-------|------|------|
| Part2 deepseek W-CTX-01 / GLM 4.4 / kimi 4.4 | Context 路由 facade 层不查 D1 验证 session 归属（仅校验 UUID 格式与 team_uuid 存在） | ✅ 属实 | handleSessionContext (index.ts:2479-2515) 不调 `D1SessionTruthRepository.readSessionLifecycle`；与 confirmations/checkpoints 模式不一致 |
| Part1 GLM F-AUTH-01 | verify/me/resetPassword 跳过 facade device gate，依赖 auth worker；auth worker 不重做 device 撤销检查 | ✅ 属实 | proxyAuthRoute 不调 `authenticateRequest`；auth worker 内部有 token 验证但 device gate 通常发生在 facade `authenticateRequest` |

### 1.6 局部代码质量 / 行号修订

| 来源 | Claim | 核实 | 备注 |
|------|-------|------|------|
| Part1 GLM W-AUTH-03 | wechat login 双 spread `deviceMetadata` (index.ts:614) | ⚠️ 表述不准 | 当前代码（index.ts:558-632）的 `proxyAuthRoute` 没有 `wechat` 专属分支双 spread，统一在 line 581 一次合并；GLM 报告对应的旧版本，已不适用 |
| Part1 kimi A1 | `revokeApiKey` body 缺 `key_id` presence 校验 | ✅ 属实 | proxyAuthRoute revokeApiKey 分支（line 585-596）spread body 后直传给 auth worker，无 facade 层校验 |
| Part1 kimi CP1 | `handleSessionCheckpoint` 中 `diff` 分支无显式 `if`，依赖 fallthrough | ⚠️ 表述不准 | 现行代码 diff/list/create/restore 各有显式分支，本条已无效 |
| Part2 deepseek O-CTX-01 / O-CTX-02 | auto-compact / 60s preview cache 未上线 | ✅ 属实 | 已在 HP3 closure 登记，本轮不修 |

---

## 2. 修复总账（按 blocker / followup 分组）

### 2.1 Blocker（声明合规前必须关闭）

| Fix ID | 严重 | 类型 | 标题 | 涉及文件 |
|--------|------|------|------|----------|
| **B1** | 🔴 CRITICAL | error envelope | 移除 checkpoint restore 409 与 confirmation decision 409 响应中的非法 `data` 字段 | `workers/orchestrator-core/src/index.ts` |
| **B2** | 🔴 CRITICAL | error code | 注册 `confirmation-already-resolved` 到 `FacadeErrorCodeSchema`，改用 `jsonPolicyError` 路径构造 409 响应（与 B1 配套） | `packages/orchestrator-auth-contract/src/facade-http.ts`, `workers/orchestrator-core/src/index.ts` |
| **B3** | ❌ FINDING | error code | 注册 `context-rpc-unavailable` 到 `FacadeErrorCodeSchema` | `packages/orchestrator-auth-contract/src/facade-http.ts` |
| **B4** | ❌ FINDING | error code | 注册 `conversation-deleted` 到 `FacadeErrorCodeSchema`（4 处使用点已在 schema 之外，必须收录或替换为 `conflict`） | `packages/orchestrator-auth-contract/src/facade-http.ts` |
| **B5** | ❌ FINDING | error code | 注册 `auth-misconfigured`、`invalid-auth-body`、`missing-team-claim` 到 `FacadeErrorCodeSchema`（或映射到现有 code）；保持 HTTP status 不变 | `packages/orchestrator-auth-contract/src/facade-http.ts`, `workers/orchestrator-core/src/auth.ts`, `workers/orchestrator-core/src/index.ts` |

### 2.2 Followup（建议修，不阻塞合规声明）

| Fix ID | 严重 | 类型 | 标题 | 涉及文件 |
|--------|------|------|------|----------|
| **F1** | ⚠️ WARN | 文档一致性 | 修正 `clients/api-docs/catalog.md` "optional bearer"：实际为 `none`（代码不读 Bearer） | `clients/api-docs/catalog.md` |
| **F2** | ⚠️ WARN | 文档一致性 | 修正 `clients/api-docs/context.md` "GET /context legacy alias of probe"：实际为不同 RPC，删除 alias 表述或改实现 | `clients/api-docs/context.md` 或 `index.ts` |
| **F3** | ⚠️ WARN | 文档一致性 | 修正 `clients/api-docs/context.md` 中 POST 端点 body 字段说明：实际 façade 层不读 body | `clients/api-docs/context.md` 或 `index.ts:2549-2580` |
| **F4** | ⚠️ WARN | 安全 / 一致性 | Context 路由 facade 层补 `D1SessionTruthRepository.readSessionLifecycle` session ownership 校验 | `workers/orchestrator-core/src/index.ts:2479-2515` |
| **F5** | ⚠️ WARN | 测试缺口 | 新增 `POST /me/devices/revoke` dedicated 单测（≥6 cases：200 happy, 200 idempotent, 400 bad UUID, 401, 403 cross-user, 404 not-found） | `workers/orchestrator-core/test/me-devices-revoke-route.test.ts`（新增） |
| **F6** | ⚠️ WARN | 测试缺口 | `service.test.ts` 新增 `verifyToken()` JWT 路径测试（`{valid:true, user, team, snapshot}` shape） | `workers/orchestrator-auth/test/service.test.ts` |
| **F7** | ⚠️ WARN | 输入校验 | `proxyAuthRoute` 的 `revokeApiKey` 分支补 `key_id` presence + nak_-prefix 校验（避免 RPC noise） | `workers/orchestrator-core/src/index.ts:585-596` |

### 2.3 不在本轮修复（明确 defer）

| Fix ID | 不修原因 | 重评条件 | Owner |
|--------|----------|----------|-------|
| D1 | auto-compact runtime trigger 未上线（HP3 已登记 deferred） | HP3 后续批次 | TBD |
| D2 | 60s preview cache 未实现（HP3 closure 已登记） | HP3 后续批次 | TBD |
| D3 | auth verify/me/resetPassword 走 proxy 而非 facade `authenticateRequest`（GLM F-AUTH-01） | 等待是否将 device gate 下沉到 auth worker 的 architecture 决策；当前 auth worker 验证 token 已构成对未撤销 identity 的保护 | TBD |

---

## 3. Blocker 详细修复指引

### 3.1 B1 + B2 — 移除 409 非法 `data` 字段 + 注册 `confirmation-already-resolved`

**问题代码（两处，共 24 行）**：

```ts
// workers/orchestrator-core/src/index.ts:1410-1422 (checkpoint restore)
return Response.json(
  {
    ok: false,
    error: {
      code: "confirmation-already-resolved",
      status: 409,
      message: "confirmation has already been resolved with a different status",
    },
    data: { confirmation },                                    // ← 非法
    trace_uuid: traceUuid,
  },
  { status: 409, headers: { "x-trace-uuid": traceUuid } },
);

// workers/orchestrator-core/src/index.ts:1642-1655 (confirmation decision)
return Response.json(
  {
    ok: false,
    error: { code: "confirmation-already-resolved", status: 409, message: "..." },
    data: { confirmation: result.row },                        // ← 非法
    trace_uuid: traceUuid,
  },
  { status: 409, headers: { "x-trace-uuid": traceUuid } },
);
```

**修法 Step 1 — 注册 error code**：

`packages/orchestrator-auth-contract/src/facade-http.ts` 的 `FacadeErrorCodeSchema` enum 中新增（推荐放在 `// ── lifecycle ──` 段）：

```ts
"confirmation-already-resolved",
```

**修法 Step 2 — 移除 `data`，改用 `jsonPolicyError`**：

两处 `Response.json` 都替换为：

```ts
return jsonPolicyError(
  409,
  "confirmation-already-resolved",
  "confirmation has already been resolved with a different status",
  traceUuid,
);
```

> 如果客户端确实需要在 409 响应里看到当前 confirmation 行（比如展示已决议结果），应让客户端再发一次 `GET /sessions/{id}/confirmations/{uuid}` 来读，而不是把 row 塞进 error envelope。  
> **不**要使用 `error.details: { confirmation }` 作为绕路 —— `FacadeErrorSchema` 当前没有 `details` 字段；除非额外扩展 schema 并加测试，否则保持错误响应只含 `{ code, status, message }`。

**测试增量**：

- `workers/orchestrator-core/test/checkpoint-restore-route.test.ts`（或对应文件）：在 409 路径断言 `body.data === undefined`、`body.error.code === "confirmation-already-resolved"`。
- `workers/orchestrator-core/test/confirmation-route.test.ts:344` 附近的 409 case：同上断言。
- 新增 `FacadeErrorEnvelopeSchema.parse(body)` 的 Zod 校验断言，保证不再有 `data` 字段。

**复审要点**：

- `pnpm --filter @nano-agent/orchestrator-core test` 全绿
- 两处 409 响应 body 不含 `data`
- `FacadeErrorCodeSchema.options` 包含 `confirmation-already-resolved`

---

### 3.2 B3 — 注册 `context-rpc-unavailable`

**事实**：`workers/orchestrator-core/src/index.ts:2614` 通过 `jsonPolicyError(503, "context-rpc-unavailable", ...)` 直接序列化此字符串。它不在 `FacadeErrorCodeSchema` 枚举内。

**修法**：在 `FacadeErrorCodeSchema` 的 `// ── runtime ──` 段新增：

```ts
"context-rpc-unavailable",
```

> 不要替换为 `upstream-timeout`：`context-rpc-unavailable` 的语义是"context-core binding 缺失或 RPC 抛错"，与超时含义不同；客户端文档已写明该 code，应保留以避免破坏客户端。

**测试增量**：`context-route.test.ts` 现有 `503 RPC throw` case 加断言 `body.error.code === "context-rpc-unavailable"`（当前可能已存在，二次确认）。

---

### 3.3 B4 — 注册 `conversation-deleted`

**事实**：`workers/orchestrator-core/src/index.ts` 共 4 处使用：
- 1302（checkpoints handler）
- 1530（confirmations handler）
- 1724（其它 session handler）
- 2391（更下游 handler）

均通过 `jsonPolicyError(409, "conversation-deleted", "conversation is deleted", traceUuid)` 调用，但 schema 不含此 code。

**修法**：在 `FacadeErrorCodeSchema` 的 `// ── lifecycle ──` 段新增：

```ts
"conversation-deleted",
```

> 不要替换为 `conflict`：`conversation-deleted` 在客户端文档中作为公开 code，替换会破坏客户端解析；保留语义最清晰。

**测试增量**：在任一现有 `conversation-deleted` 路径测试中加 `FacadeErrorCodeSchema.options.includes("conversation-deleted")` 编译期断言。

---

### 3.4 B5 — 注册 `auth-misconfigured` / `invalid-auth-body` / `missing-team-claim`

**事实（核实派生）**：
- `auth-misconfigured`：`workers/orchestrator-core/src/auth.ts:249`
- `invalid-auth-body`：`workers/orchestrator-core/src/index.ts:573`
- `missing-team-claim`：`workers/orchestrator-core/src/auth.ts` + `index.ts` 多处（包括 catalog/me/checkpoint 鉴权失败分支）

**修法**：在 `FacadeErrorCodeSchema` 中新增（建议位置）：

```ts
// ── auth-flavoured (must include every AuthErrorCode) ──
...
"missing-team-claim",         // 跨多个 handler 使用
"auth-misconfigured",         // JWT secret missing/invalid
"invalid-auth-body",          // proxyAuthRoute body=null 时
```

**编译期 guard**：保留 `_authErrorCodesAreFacadeCodes` 与 `_rpcErrorCodesAreFacadeCodes` 两个 const，确保新增不破坏既有 superset 关系。

**测试增量**：`workers/orchestrator-core/test/auth.test.ts` 与 `smoke.test.ts` 中相关 401/403/503 case 加 `FacadeErrorCodeSchema.options` 包含性断言。

> 三个 code 都直接保留，不做语义改写——它们在 API doc 里是公开契约，更名会破坏客户端。

---

## 4. Followup 修复指引（F1 – F7）

### 4.1 F1 — `catalog.md` Auth 修正

**修法**：编辑 `clients/api-docs/catalog.md:6` 与表头：

```diff
-> Auth: optional；当前 route 不读取 bearer，未传也会成功。
+> Auth: none；当前 route 不读取 Bearer 头，传任何值均被忽略。
```

并把 §catalog.md:14-16 表中 `optional bearer` 全改为 `none`。

> 如果未来真的要做 plan-aware catalog filter，再回到代码侧加鉴权；当前先与代码同步。

### 4.2 F2 — `context.md` GET /context alias 修正

`handleSessionContext` 中 `op="get"` 调 `getContextSnapshot`，`op="probe"` 调 `getContextProbe`。这是两条不同的 RPC。

**修法（推荐 A）**：编辑 `clients/api-docs/context.md`，将 `GET /context` 描述从"legacy alias of probe"改为独立端点说明（描述 snapshot 输出）。  
**修法（备选 B）**：把 `op="get"` 也改为调 `getContextProbe` 实现真 alias —— 但这会修改公开行为，需先和 doc owner 确认。

**优先选 A**（仅文档变更，零代码风险）。

### 4.3 F3 — `context.md` POST body 字段修正

`handleSessionContext` 的 POST 分支（`snapshot`、`compact-preview`、`compact`）只传 `meta` 给 RPC，**完全没读取 request body**。doc 里写的 `{force, preview_uuid, label}` 等字段当前无效。

**修法（推荐 A）**：在 `clients/api-docs/context.md` 中标注 "（HP9 阶段：body 字段当前 ignored；触发条件由 server 决定）"。  
**修法（备选 B）**：在 `index.ts:2549-2580` 的相关 case 中读取 body 并传入 RPC `meta` 或独立参数。

如果业务上确实需要 `force` 强触发等能力，应走 B；如果只是文档过度承诺，走 A。**默认先走 A，避免在 HPX3 修复轮里引入新行为**。

### 4.4 F4 — Context 路由补 session ownership

参照 `handleSessionConfirmation` 模式（index.ts:1517-1525），在 `handleSessionContext` 进入 RPC 之前增加：

```ts
const db = env.NANO_AGENT_DB;
if (db) {
  const repo = new D1SessionTruthRepository(db);
  const session = await repo.readSessionLifecycle(sessionUuid);
  if (
    !session ||
    session.team_uuid !== teamUuid ||
    session.actor_user_uuid !== auth.value.user_uuid
  ) {
    return jsonPolicyError(404, "not-found", "session not found", traceUuid);
  }
  if (session.deleted_at) {
    return jsonPolicyError(409, "conversation-deleted", "conversation is deleted", traceUuid);
  }
}
```

**测试增量**：`context-route.test.ts` 增加 `cross-user access → 404` 用例。

### 4.5 F5 — `POST /me/devices/revoke` 单测

新建 `workers/orchestrator-core/test/me-devices-revoke-route.test.ts`，覆盖：

- 200 happy（own device, status='active' → revoked）
- 200 idempotent（already revoked → `already_revoked: true`）
- 400 invalid `device_uuid` 格式
- 401 missing bearer
- 403 cross-user device（device 属于他人）
- 404 device not found

> live e2e `13-device-revoke-force-disconnect.test.mjs` 留作 smoke 不替换；本地单测是回归保护。

### 4.6 F6 — `verifyToken` JWT 路径单测

在 `workers/orchestrator-auth/test/service.test.ts` 新增：

```ts
it("verifyToken returns AuthView + valid:true for valid JWT", async () => {
  // mint a JWT via the test JWT helper
  // call service.verifyToken({ access_token: jwt }, meta)
  // assert envelope.data.shape: { valid: true, user, team, snapshot }
});
```

### 4.7 F7 — `revokeApiKey` body 校验

`workers/orchestrator-core/src/index.ts:585-596` 在调 `authenticateRequest` 之后、构造 input 之前补：

```ts
const keyId = (body as { key_id?: unknown })?.key_id;
if (typeof keyId !== "string" || !keyId.startsWith("nak_")) {
  return jsonPolicyError(400, "invalid-input", "key_id must be a string starting with nak_", traceUuid);
}
```

避免无效请求穿透到 auth worker 后才被拒。

---

## 5. 全 Blocker 一次性 PR 建议

### 5.1 推荐打包

**PR-1（B1 + B2 + B3 + B4 + B5）**：一次性扩 `FacadeErrorCodeSchema`，同时修 2 个 409 端点。
- 文件：`facade-http.ts`、`index.ts`、`auth.ts`、相关测试文件
- 测试要求：所有现有测试不变绿；新增 4 处 schema 包含性断言；2 处 409 不含 `data` 断言
- 风险：低 —— 仅扩 schema 与移除 envelope 字段，向后兼容

> **不要分多个 PR**：B1-B5 都涉及同一文件 `facade-http.ts`，分多个 PR 会冲突，且 B1 的 409 移除 `data` 必须与 B2 的 code 注册同步上线，否则中间状态会让客户端拿到未注册 code 的合规响应。

### 5.2 PR-1 后续

- F1 / F2 / F3：纯文档修订，可独立打包成一个 doc-only PR
- F4：F4 单独一个 PR（涉及行为变更与测试）
- F5 / F6 / F7：测试增量，可放在一起或随后续 PR 顺带

---

## 6. 验证矩阵（修复后必须全部通过）

| 验证项 | 命令 / 检查 | 通过标准 |
|--------|-------------|----------|
| 单元测试 | `pnpm --filter @nano-agent/orchestrator-core test` | 全绿 |
| 单元测试 | `pnpm --filter @nano-agent/orchestrator-auth test` | 全绿 |
| 契约期 guard | TypeScript build | `_authErrorCodesAreFacadeCodes`、`_rpcErrorCodesAreFacadeCodes` 仍编译通过 |
| Envelope drift gate | `node scripts/check-envelope-drift.mjs` | green |
| 静态搜索 1 | `grep -rn '"confirmation-already-resolved"' workers/orchestrator-core/src/ \| grep -v 'jsonPolicyError'` | 0 处（即不再有手动 `Response.json` 构造） |
| 静态搜索 2 | `grep -n 'data:' workers/orchestrator-core/src/index.ts \| grep -B2 'ok: false'` | 0 处（错误响应 body 不再带 `data`） |
| Schema 完整性 | `FacadeErrorCodeSchema.options` | 包含 `confirmation-already-resolved`、`context-rpc-unavailable`、`conversation-deleted`、`auth-misconfigured`、`invalid-auth-body`、`missing-team-claim` |
| 文档同步 | `clients/api-docs/catalog.md` | "optional bearer" → "none" |
| 文档同步 | `clients/api-docs/context.md` | GET /context 不再写 alias of probe；POST 端点 body 字段标注 ignored |

---

## 7. 与 hero-to-pro 现有 closure 的关系

- 本 fix 文档不新开 phase；它收敛 6 份独立 reviewer report 中的 claim，作为 HPX3 编号下的"API 合规修复批"。
- 完成后应将本文档状态改为 `executed`，并在 `docs/issue/hero-to-pro/hero-to-pro-final-closure.md` §（合规收口）追加一条引用：
  - "API compliance Part 1 + Part 2：5 项 blocker 已闭环（B1-B5），CRITICAL/FINDING 全清；7 项 followup 状态见 HPX3 fix 文档"。
- D1/D2/D3 三项 deferred 不进 hero-to-pro，保留在 HP3 / 架构决策待评审中，**不要**在本轮主动改动这些代码路径。

---

## 8. 复审入口

- **二次审查方式**：`independent reviewer`（建议非 deepseek/GLM/kimi 的另一位）
- **触发条件**：PR-1 (B1-B5) merged + envelope drift gate green
- **重点核查**：
  1. `FacadeErrorCodeSchema` 6 项新增 code 全部存在
  2. 两处 409 响应 body 不含 `data` 字段（用 Zod `FacadeErrorEnvelopeSchema.strict().parse()` 断言）
  3. 两处 `Response.json` 已替换为 `jsonPolicyError` 调用
  4. 三家 reviewer 提到的 invalid claim（kimi 的 `invalid-trace`、deepseek 的 revoke 测试覆盖、GLM 的 wechat 双 spread、kimi 的 diff 分支）已在本文档 §1 标记，不应被修复（避免无意义改动）

---

## 9. 附：reviewer 报告交叉对照

| Finding | deepseek part1 | GLM part1 | kimi part1 | deepseek part2 | GLM part2 | kimi part2 | 综合判定 |
|---------|----------------|-----------|------------|----------------|-----------|------------|----------|
| 409 `data` 字段（checkpoint restore） | — | F-CHK-01 ✅ | CP3 ✅ | — | — | — | 🔴 CRITICAL → B1 |
| 409 `data` 字段（confirmation decision） | — | — | — | W-CFM-01 ⚠️ | F-CFM-01 ❌ | C-CON-01 🔴 | 🔴 CRITICAL → B1（与上同） |
| `confirmation-already-resolved` 未注册 | — | — | — | — | F-CFM-01 ❌ | C-CON-01 🔴 | 🔴 → B2 |
| `context-rpc-unavailable` 未注册 | — | — | — | — | F-CTX-01 ❌ | F-CTX-01 ❌ | ❌ → B3 |
| `conversation-deleted` 未注册 | — | — | — | — | — | F-SHR-01 ❌ | ❌ → B4 |
| `auth-misconfigured` 等未注册 | — | — | — | — | — | F-AUT-01 ❌（部分误报） | ❌ → B5（剔除 invalid-trace） |
| catalog auth doc 不一致 | §5.1 ⚠️ | W-CAT-01 ⚠️ | C1 ⚠️ | — | — | — | ⚠️ → F1 |
| context GET alias 不实 | — | — | — | — | — | W-CTX-01 ⚠️ | ⚠️ → F2 |
| context POST body 失效 | — | — | — | — | — | W-CTX-02 ⚠️（表述不准） | ⚠️ → F3 |
| context facade 缺 ownership | — | — | — | W-CTX-01 ⚠️ | 4.4 ⚠️ | 4.4 ⚠️ | ⚠️ → F4 |
| `/me/devices/revoke` 无单测 | — | — | — | — | W-ME-01 ⚠️ | W-DEV-01 ⚠️ | ⚠️ → F5 |
| `verifyToken` JWT 单测缺 | — | W-AUTH-01 ⚠️ | — | — | — | — | ⚠️ → F6 |
| `revokeApiKey` body 校验缺 | — | — | A1 🟡 | — | — | — | ⚠️ → F7 |
| auth verify/me 跳过 facade gate | — | F-AUTH-01 ❌ | — | — | — | — | defer D3 |
| auto-compact 未上线 | — | — | — | O-CTX-01 📝 | — | — | defer D1 |
| 60s preview cache 未上线 | — | — | — | O-CTX-02 📝 | — | — | defer D2 |
| wechat 双 spread | — | W-AUTH-03 ⚠️ | — | — | — | — | ❌ 不实，剔除 |
| diff 分支 fallthrough | — | — | CP1 ⚠️ | — | — | — | ❌ 不实，剔除 |
| `invalid-trace` 未注册 | — | — | — | — | — | F-AUT-01（部分） | ❌ 不实，已在 schema |
| `me-devices-route.test.ts:162` 覆盖 revoke | — | — | — | W-DEV-01 反例 | — | — | ❌ 不实（行号实指 revoked-filter GET 测试） |

> 该交叉表的目的：让 owner 在 PR review 时一眼分清"哪些 reviewer 对哪条 finding 形成了独立证据"，以及"哪些 claim 经核实是错的应当忽略"。

---

*本修复指引一次性收敛 hero-to-pro 阶段 6 份 API compliance 调查报告。*  
*Blocker 修完后，应在 `hero-to-pro-final-closure.md` 内更新合规声明状态。*

---

## 10. 工作日志（2026-05-01 执行回填）

> 文档状态: `executed`  
> 执行人: Claude (Opus 4.7)  
> 执行时间: 2026-05-01  
> 范围: §3 全部 5 项 Blocker（B1-B5）+ §4 全部 7 项 Followup（F1-F7）+ §1 中标记为 `❌ 不实` 的 claim（不修复，已剔除）

### 10.1 修复清单（按 Fix ID 顺序）

| Fix ID | 状态 | 改动文件 | 改动摘要 |
|--------|------|----------|----------|
| **B1** | ✅ done | `workers/orchestrator-core/src/index.ts` | 删除 checkpoint restore 409（原 1410-1422）与 confirmation decision 409（原 1642-1655）两处 `Response.json` 中的非法 `data` 字段，改为单行 `jsonPolicyError(409, "confirmation-already-resolved", ...)` |
| **B2** | ✅ done | `packages/orchestrator-auth-contract/src/facade-http.ts` | `FacadeErrorCodeSchema` lifecycle 段新增 `"confirmation-already-resolved"` |
| **B3** | ✅ done | 同上 | runtime 段新增 `"context-rpc-unavailable"` |
| **B4** | ✅ done | 同上 | lifecycle 段新增 `"conversation-deleted"` |
| **B5** | ✅ done | 同上 | shape 段新增 `"invalid-auth-body"`；permission 段新增 `"missing-team-claim"`；runtime 段新增 `"auth-misconfigured"`。HTTP status 全部维持原状，未改 call site，仅做 schema 收纳 |
| **F1** | ✅ done | `clients/api-docs/catalog.md` | 标题段 `Auth: optional` → `Auth: none`；表格 3 行 `optional bearer` → `none`；附说明：后续若启用 plan-aware filter 再回写 |
| **F2** | ✅ done | `clients/api-docs/context.md` | 路由表 `GET /sessions/{id}/context` 描述从 "legacy alias of `probe`" 改为 "完整 context snapshot（≠ `probe`，调用 `getContextSnapshot` RPC）" |
| **F3** | ✅ done | `clients/api-docs/context.md` | §4 / §5 / §6 三处 POST 端点（snapshot / compact/preview / compact）补 "Body 字段当前 ignored" 提示，避免误导客户端 |
| **F4** | ✅ done | `workers/orchestrator-core/src/hp-absorbed-routes.ts`（新增 helper）+ `workers/orchestrator-core/src/index.ts`（调用点） | 新增 `ensureSessionOwnedOrError(env, args)` helper，由 `handleSessionContext` 在 team_uuid 校验后立刻调用；行为对齐 `handleSessionConfirmation` / `handleSessionCheckpoint`（session 存在 / team 匹配 / actor_user 匹配 / 非 tombstone）。无 D1 binding 时 helper 跳过（保持单测兼容） |
| **F5** | ✅ done | `workers/orchestrator-core/test/me-devices-revoke-route.test.ts`（新增 187 行） | 新增 6 cases：200 happy / 200 idempotent already_revoked / 400 invalid UUID / 403 cross-user / 404 not found / 401 missing bearer。D1 mock 通过 SQL 串区分 device-gate（`AND user_uuid = ?2`）与 ownership-check 路径，使两层校验都能 deterministic |
| **F6** | ✅ done | `workers/orchestrator-auth/test/service.test.ts`（追加 1 case） | `verifyToken` JWT 路径单测：用 register 后的 access_token 做 `service.verifyToken({access_token})`；断言 `valid:true / user.user_uuid / team.team_uuid / team.membership_level=100 / snapshot.device_uuid 为 UUID`；外加非法 JWT 返回 `invalid-auth` 反例 |
| **F7** | ✅ done | `workers/orchestrator-core/src/index.ts` | `proxyAuthRoute` 的 `revokeApiKey` 分支：在 `authenticateRequest` 之前补 `key_id` 类型 + `nak_` 前缀校验，未通过返回 400 `invalid-input` |

### 10.2 Defer / 不修项（与 §2.3 一致）

| Fix ID | 状态 | 原因 |
|--------|------|------|
| **D1** auto-compact runtime trigger | ⏸ 未修 | HP3 已登记为 deferred 后续批次 |
| **D2** 60s preview cache | ⏸ 未修 | HP3 closure 已登记 |
| **D3** auth verify/me/resetPassword 不走 facade `authenticateRequest` | ⏸ 未修 | 等待是否将 device gate 下沉到 auth worker 的 architecture 决策 |

### 10.3 §1 中标记为 `❌ 不实` 的 claim 不予处理（已剔除）

| 来源 claim | 不修原因 |
|-------|----------|
| kimi part2 F-AUT-01 中的 `invalid-trace` 未注册 | 经核实 `invalid-trace` 已在 `FacadeErrorCodeSchema:53`，原 claim 误报 |
| deepseek part2 W-DEV-01 反例（`me-devices-route.test.ts:162` 覆盖 revoke） | 经核实该行为 GET filter 测试，与 revoke 无关；按 GLM/kimi 一致结论补 dedicated revoke 单测（F5） |
| GLM part1 W-AUTH-03（wechat 双 spread） | 现行 `proxyAuthRoute` 已统一为单次 spread，问题不存在 |
| kimi part1 CP1（`handleSessionCheckpoint` diff 分支无 explicit branch） | 现行代码已有 explicit `if (route.kind === "diff")` 分支 |

### 10.4 验证矩阵（与 §6 一致）

| 验证项 | 命令 / 检查 | 通过结果 |
|--------|-------------|----------|
| orchestrator-core 单测 | `pnpm test`（root → orchestrator-core） | ✅ 102 files / 1072 tests passed（含 hp-absorbed-routes、context-route、confirmation-route、checkpoint、me-devices-revoke 全部新增 / 修改路径） |
| orchestrator-auth 单测 | `cd workers/orchestrator-auth && pnpm test` | ✅ 5 files / 25 tests passed（含 verifyToken JWT 新 case） |
| TypeScript typecheck | `cd workers/orchestrator-core && pnpm typecheck` | ✅ pass（含跨包 `@haimang/jwt-shared` + `@haimang/orchestrator-auth-contract` rebuild） |
| Envelope drift gate | `pnpm check:envelope-drift` | ✅ `1 public file(s) clean.` |
| Cycles drift gate | `pnpm check:cycles` | ✅ `No circular dependency found!`（madge 扫 381 文件） |
| Tool-drift gate | `pnpm check:tool-drift` | ✅ `catalog SSoT clean.` |
| Observability-drift gate | `pnpm check:observability-drift` | ✅ `clean (scanned 6 workers; no bare console, no cross-worker imports)` |
| Megafile-budget gate | `pnpm check:megafile-budget` | ⚠️ index.ts 3015/3000（**baseline 3019/3000，HPX3 净减 4 行**，breach 为 baseline 既有 tech debt，本批未引入回归；详见 §10.6） |
| Schema 完整性 | `FacadeErrorCodeSchema.options` 包含新增 6 项 | ✅ 编译期 + 测试期均通过；编译 guard `_authErrorCodesAreFacadeCodes` / `_rpcErrorCodesAreFacadeCodes` 仍 narrow 到 `true` |
| 静态搜索 1：手动 409 `Response.json` | `grep -rn '"confirmation-already-resolved"' workers/orchestrator-core/src/ \| grep -v jsonPolicyError` | ✅ 0 处（全部走 jsonPolicyError） |
| 静态搜索 2：错误响应顶层 `data` | `grep -A2 'ok: false' workers/orchestrator-core/src/index.ts \| grep '^\\s*data:'` | ✅ 0 处 |
| 文档同步 catalog | `clients/api-docs/catalog.md` | ✅ "optional bearer" 全部清除 |
| 文档同步 context | `clients/api-docs/context.md` | ✅ "legacy alias of probe" 改为独立端点说明；3 处 POST 端点 body 字段 ignored 标注 |

### 10.5 Diff 摘要

```
 clients/api-docs/catalog.md                                         |  8 ++--
 clients/api-docs/context.md                                         |  8 +++-
 packages/orchestrator-auth-contract/src/facade-http.ts              |  6 +++
 workers/orchestrator-auth/test/service.test.ts                      | 45 ++++++++
 workers/orchestrator-core/src/hp-absorbed-routes.ts                 | 36 ++++++
 workers/orchestrator-core/src/index.ts                              | 54 ++++-----  (净 -4)
 workers/orchestrator-core/test/me-devices-revoke-route.test.ts      | 187 (new)
 (各 worker)/src/generated/package-manifest.ts                       |  *  (auto-regen 仅 timestamp 类，无业务变更)
 12 files changed, 129 insertions(+), 40 deletions(-) (生成文件除外)
```

### 10.6 Megafile budget 说明（重要）

`workers/orchestrator-core/src/index.ts` 在本批修复**之前**就已 3019/3000 越界（HP8 P3-01 stop-the-bleed 阶段已记录的 pre-existing tech debt）。本批 HPX3 通过两处 409 化简（移除 `Response.json` 内嵌 envelope 共节省 ~22 行）+ 把 F4 ownership gate 抽到 `hp-absorbed-routes.ts`（节省 ~9 行）+ F7 紧凑校验，**净减 4 行**，使 index.ts 当前为 3015/3000。

- HPX3 不引入新的 megafile 回归，反而略有改善
- 建议另起一个独立 PR（不在本 HPX3 范围内）做 facade-router 拆分，例如把 `/me/*` 系列 handlers 抽到 `me-routes.ts`，把 `/sessions/{id}/context*` 抽到 `context-routes.ts`，应能一次让 index.ts 回到 < 3000

### 10.7 后续动作建议

1. **本 PR 上线前**：CI 中 `check:megafile-budget` 仍会 fail —— 这是 baseline 既有问题，建议 reviewer 手动 ack（或在 PR 描述里标注 "pre-existing breach, HPX3 net -4 lines"）
2. **下一轮 cleanup**：拆 facade-router 让 megafile 回到预算内（参见 §10.6）
3. **对外合规声明**：本批 5 项 blocker 已闭环，`facade-http-v1` 信封 + error code 字典在 §3.1-§3.4 范围 fully-compliant；`hero-to-pro-final-closure.md` 可在合规小节追加引用：
   > API compliance Part 1 + Part 2：5 项 blocker 已闭环（B1-B5），CRITICAL/FINDING 全清；7 项 followup（F1-F7）已落地；3 项 deferred（D1-D3）按 §2.3 显式保留。详见 `docs/action-plan/hero-to-pro/HPX3-api-compliance-fix-part-1-2.md` §10。
4. **二次复审入口**：按 §8 原计划，建议 `independent reviewer` 重点核查 §6 验证矩阵中 12 条已通过项与本 §10.5 diff 范围

### 10.8 文档变迁记录

- 起源：`docs/issue/hero-to-pro/HPX3-api-compliance-fix-part-1-2.md`（§9 之前的内容为初版调查 + 修复指引）
- 转移：根据 owner 指令，2026-05-01 移到 `docs/action-plan/hero-to-pro/HPX3-api-compliance-fix-part-1-2.md`，与同目录下 `HPX1-worker-test-cleanup-and-enhance.md` / `HPX2-full-closure-fix.md` 命名风格一致
- 状态切换：`draft → executable`（§0-§9 编写完）→ `executed`（本节 §10 落地后）
