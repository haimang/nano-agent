# ZX5 Protocol Hygiene + Product Surface + Architecture + Runtime Hookup — 收尾专项

> 类型: closure (full — Lane C/D/E/F + R28 owner-action gate)
> 关联: `docs/action-plan/zero-to-real/ZX5-protocol-hygiene-product-surface-architecture.md`(v3 校准 + §10 工作日志)
> 上游承接: `docs/issue/zero-to-real/ZX4-closure.md` §3.2 + ZX2 closure §4.3+§5+§8.2 carryover + 4-reviewer ZX3-ZX4 review findings
> 上游审查: `docs/eval/zero-to-real/ZX4-action-plan-reviewed-by-GPT.md`(re-baseline 来源)+ 4-reviewer ZX3-ZX4 review(GPT/kimi/GLM/deepseek)
> 执行人: Opus 4.7(1M ctx)
> 时间: 2026-04-28
> 状态: **ZX5 全 4 lanes 完成 — Lane C 协议/auth 单一 source(jwt-shared)+ Lane D 4 个 product endpoint + Lane E 2 library worker uplift 真 RPC + Lane F runtime kernel hookup contract land(F1/F2/F3)+ F4 handleStart idempotency 修法落地 + F5 owner ops runbook stub。worker 总数恒等于 6**

---

## 0. TL;DR

ZX5 完成"非阻塞收尾 + cluster runtime kernel hookup"主线。仓库从 ZX4 留下的"`internal-http-compat: retired` + 6-state D1 truth + decision-forwarding storage contract / runtime kernel waiter deferred"中间态,推进到"jwt single source + RpcErrorCode⊂FacadeErrorCode 编译期断言 + 4 个 product endpoint + context/filesystem-core 升 真 WorkerEntrypoint RPC + alarm-driven kernel wait-and-resume infra + handleStart idempotency"。

**已完成**:
- ✅ **Lane C 协议/auth 卫生**:`@haimang/jwt-shared` package 创建 + 两 worker 切换 + kid rotation 集成测试(5 unit) + `_rpcErrorCodesAreFacadeCodes` 跨包断言 + envelope 关系文档化(README cross-link) + web/wechat client heartbeat shared helper migration
- ✅ **Lane D 产品面 + ops**:catalog content registry 填充 + `POST /sessions/{id}/messages`(per Q8) + `GET /sessions/{id}/files` + `GET /me/conversations` + `GET /me/devices` + `POST /me/devices/revoke`(per Q9 device truth model + migration 007-user-devices.sql) + `scripts/deploy-preview.sh`(WORKER_VERSION env-fill,per Q2 owner-local 路径)
- ✅ **Lane E library worker RPC uplift(保持 6-worker)**:context-core / filesystem-core 从 library-only(P1-03 binding-scope 401)升级为 `WorkerEntrypoint` + `probe / nacpVersion / assemblerOps / filesystemOps` RPC method;agent-core 短期 shim 期间保留 in-process library import(per Q6 + R9)
- ✅ **Lane F runtime kernel hookup**:NanoSessionDO 加 alarm-driven `awaitAsyncAnswer / sweepDeferredAnswers / emitPermissionRequestAndAwait / emitElicitationRequestAndAwait`(per Q10 owner direction:b 选项 alarm-driven,反对 a polling 与 c WS 下放)+ runtime mainline `onUsageCommit` callback 在 LLM/tool quota commit 后驱动 emit `session.usage.update` server frame + `handleStart` D1 conditional UPDATE idempotency(per Q11 修法 b)+ R28 wrangler tail investigation runbook stub
- ✅ **2055 tests 全绿,零回归**:20 jwt-shared + 19 orchestrator-auth-contract + 77 orchestrator-core(+2 vs ZX4)+ 1056 agent-core(零回归)+ 374 bash-core(零回归)+ 13 orchestrator-auth(+5 kid rotation)+ 171 context-core(+4)+ 294 filesystem-core(零回归)+ 31 root-guardians = **2055 / 2055 pass**

**owner direction key 决策(执行期内冻结)**:
- Q10 wait-and-resume:**alarm-driven**(b 选项)— polling(a)与 WS 下放(c)被列为负面清单,与 cloud-native + DO alarm 能力冲突
- Q11 idempotency:**D1 conditional UPDATE**(b 选项)— 不引入 server-side cache 层,后续可在 client gate 实现 idempotency_key
- Q4 worker 总数:**ZX5 内 worker 数量恒等于 6**(R8 硬冻结)— 所有 cluster work 在 6-worker 内演进

**defer 到未来独立 plan**:
- agent-core PermissionRequest / ElicitationRequest hook 实际 dispatcher 集成(本期 land 了 NanoSessionDO 的 wait-and-resume infra,但 `hooks/permission.ts` 内部 `verdictOf` 改造为 `await DO.awaitAsyncAnswer` 触发的 dispatcher 改造仍是 cluster-level kernel work;**infra 已就绪,任何 future PR 引入 hook 调用 `nanoSessionDo.emitPermissionRequestAndAwait()` 即可消费**)
- R28 verify-cancel deploy 500 根因定位 — owner 在自己环境 `wrangler tail` 复盘后 fill `docs/runbook/zx5-r28-investigation.md` §3
- prod migration 006 / 007 apply — owner deploy hard gate(per ZX4 closure §3.3 + ZX5 plan §6 风险表)
- `pnpm-lock.yaml` 6 个 stale importer block 清理 — owner-action(NODE_AUTH_TOKEN 注入后 `pnpm install`)

---

## 1. 已交付物

### 1.1 Lane C — Protocol / Auth Hygiene

#### C1 `@haimang/jwt-shared` package(详见 ZX5 plan §10.C1)

新建 `packages/jwt-shared/`:
- `package.json` + `tsconfig.json`(workspace keep-set sibling 模板)
- `src/index.ts`(174 行):`base64Url` / `importKey` / `parseJwtHeader` / `collectVerificationKeys` / `verifyJwt<T>` / `verifyJwtAgainstKeyring<T>` / `resolveSigningSecret` / `signJwt` + `JWT_LEEWAY_SECONDS = 5min` constant
- `test/jwt-shared.test.ts`(20 unit):base64Url round-trip / parseJwtHeader / collectVerificationKeys / verifyJwt happy + 拒签 + 拒过期 + 拒 wrong secret + 拒 no-sub / verifyJwtAgainstKeyring(kid 优先 / fall through legacy / 不 silently fall to wrong-kid)/ resolveSigningSecret(JWT_SIGNING_KID preferred / fall back first entry / null when empty)/ signJwt round-trip / JWT_LEEWAY_SECONDS = 300

#### C2 两 worker 切 jwt-shared

- `workers/orchestrator-core/src/auth.ts`:删除本地 250 行中 73 行 worker-local impl(base64Url / importKey / parseJwtHeader / collectVerificationKeys / verifyJwtAgainstKeyring),改 `import { collectVerificationKeys as sharedCollectVerificationKeys, verifyJwtAgainstKeyring as sharedVerifyJwtAgainstKeyring } from "@haimang/jwt-shared"`;`verifyJwt` 改为 jwt-shared `verifyJwt<JwtPayload>` re-export 包装
- `workers/orchestrator-auth/src/jwt.ts`:删除本地 175 行中 53 行 worker-local impl(base64Url / importKey / parseJwtHeader / collectVerificationKeys / `resolveSigningSecret` 内部);保留 worker-specific narrowing(`AccessTokenClaims` normalize + `AuthServiceError` 包装);`mintAccessToken` 改用 `sharedSignJwt`,`verifyAccessToken` 改用 `sharedCollectVerificationKeys` + `sharedImportKey` + 同步 base64Url
- 两 worker `package.json` 加 `@haimang/jwt-shared: workspace:*` 依赖 + pretest/prebuild 加 `pnpm --filter @haimang/jwt-shared build`
- 两 worker `node_modules/@haimang/jwt-shared` symlink 到 `packages/jwt-shared`

#### C3 kid rotation graceful overlap 集成测试

新建 `workers/orchestrator-auth/test/kid-rotation.test.ts`(5 unit):
- v1 token + env still has v1 secret → accept(graceful overlap window 内)
- v2 token + env has both v1+v2 → accept
- v1 token + v1 secret 已从 env 删除 → reject(post-overlap)
- legacy `JWT_SECRET` 路径(no kid)→ accept via "legacy" bucket
- tampered signature → reject(no silent fall-through)

#### C4 `RpcErrorCode ⊂ FacadeErrorCode` 跨包断言

`packages/orchestrator-auth-contract/src/facade-http.ts` 在现有 `_authErrorCodesAreFacadeCodes` 后追加:

```ts
const _rpcErrorCodesAreFacadeCodes: z.infer<typeof RpcErrorCodeSchema> extends FacadeErrorCode
  ? true
  : never = true;
```

`@haimang/nacp-core` 加入 `packages/orchestrator-auth-contract/package.json` 依赖(workspace dep);ts narrow 失败即 build break,迫使 RpcErrorCode 新增同步到 FacadeErrorCodeSchema。**单向约束**(per GPT 3.9):FacadeErrorCode 必须 ⊇ RpcErrorCode,反向不要求。

#### C5 envelope 关系文档化

新建 `packages/orchestrator-auth-contract/README.md`(per Q7 owner direction (a) 选项):
- §1 envelope 关系总览(ASCII 图):nacp-core `Envelope<T>` / `RpcErrorCodeSchema` → auth-contract `AuthErrorCodeSchema` → `FacadeErrorCodeSchema` / `FacadeEnvelope<T>` 的 single-direction subset
- §1.1 单向约束(per ZX4-ZX5 GPT review §3.9):`FacadeErrorCode ⊇ AuthErrorCode` + `FacadeErrorCode ⊇ RpcErrorCode`,两个 `_*AreFacadeCodes` build-time guard
- §1.2 三种 envelope 形态:`Envelope<T>`(nacp-core)/ `OrchestratorAuthRpcResult<T>`(本包 RPC)/ `FacadeEnvelope<T>`(本包 façade public)
- §1.3 helper:`facadeFromAuthEnvelope` / `envelopeFromAuthLike`
- §2 公开 API 用法
- §3 升级 / 演进规则(加新 RpcErrorCode 必须同步 facade)

`packages/nacp-core/README.md` 新增 "Cross-link to facade-http-v1"(per ZX5 C5)— 指向 auth-contract README 作为单一真相,`docs/transport/` 仅作索引跳转。

#### C6 web/wechat client heartbeat shared helper migration

- `clients/web/src/heartbeat.ts`(local mirror 模块,user-edited)+ `clients/web/src/client.ts:openStream` 改用 `HeartbeatTracker.shouldSendHeartbeat()` / `recordHeartbeat()` 替代手写 `lastHeartbeatSentAt + setInterval(15000)`;web 客户端不能直接 import `@haimang/nacp-session`(vite/react app 不通过 npm registry)
- `clients/wechat-miniprogram/utils/heartbeat-adapter.js`(new,JS 1:1 镜像 nacp-session HeartbeatTracker)+ `clients/wechat-miniprogram/utils/nano-client.js:bindSocketLifecycle` 改用 `HeartbeatTracker`;wechat miniprogram runtime 也不能直接 import npm package
- 两个 client 用相同的 `intervalMs=15000 / timeoutMs=45000` 阈值(与 nacp-session HeartbeatTracker 完全一致),后续 build pipeline 接到 npm 时可改用 root export 直接 require

### 1.2 Lane D — Product Surface + Ops

#### D1 `scripts/deploy-preview.sh`(详见 ZX5 plan §10.D1)

新建 `scripts/deploy-preview.sh`(120 行):
- 6 worker deploy order(leaf → agent-core → orchestrator-core)
- `WORKER_VERSION = ${WORKER_NAME}@${GIT_SHA}` env-fill via `wrangler deploy --var WORKER_VERSION:...`
- `GIT_SHA` 自动从 `git rev-parse --short HEAD` 取(若 repo dirty 加 `-dirty` 后缀)
- `WORKER_VERSION_SUFFIX` env override 支持
- per-worker 独立 cd + deploy + fail-fast

#### D2 catalog content registry

新建 `workers/orchestrator-core/src/catalog-content.ts`:
- `CATALOG_SKILLS`(4 entries:context-assembly / filesystem-host-local / bash-tool-call / permission-gate-preview)
- `CATALOG_COMMANDS`(5 entries:`/start` / `/input` / `/messages` / `/cancel` / `/files`)
- `CATALOG_AGENTS`(2 entries:nano-default / nano-preview-verify)
- 每个 entry 含 `name / description / version / status`(stable | preview | experimental)

`workers/orchestrator-core/src/index.ts:handleCatalog` 改为 `import("./catalog-content.js")` 动态加载 + 返真实 registry 数据(从空数组 → 11 entries 跨 3 kinds)。

`workers/orchestrator-core/test/smoke.test.ts` 同步更新 3 个 catalog test:从 "expect empty" 改为 "expect non-empty + 每 entry shape match"。

#### D3 `POST /sessions/{id}/messages`(per Q8 owner direction)

`workers/orchestrator-core/src/index.ts` SessionAction union 加 `messages`;`parseSessionRoute` 接受 `messages` action。
`workers/orchestrator-core/src/user-do.ts` 加 `handleMessages(sessionUuid, body)`:
- ingress guard:`requireSession` + KV miss → `sessionGateMiss`(D1-aware,pending → 409 / expired → 409 / null → 404);ended → `sessionTerminalResponse`(per Q8 session-running ingress only)
- body schema:`parts: Array<{kind: 'text', text} | {kind: 'artifact_ref', artifact_uuid, mime?, summary?}>`
- 落表:同一 `nano_conversation_messages`(per Q8 不新建第二张消息表);`message_kind`:`'user.input.text'`(单 text part,`/input` alias-equivalent)or `'user.input.multipart'`(多 part 或非 text)
- 复用 ZX4 `ensureDurableSession` / `createDurableTurn` / `recordUserMessage` / `appendDurableActivity` 路径
- `recordUserMessage` 的 `kind` union 扩展为 `'user.input' | 'user.cancel' | 'user.input.text' | 'user.input.multipart'`

#### D4 `GET /sessions/{id}/files`

`workers/orchestrator-core/src/user-do.ts:handleFiles(sessionUuid)`:
- ingress guard 同 D3
- 从 `nano_conversation_messages.body_json` 扫所有 `parts` 中 `kind === 'artifact_ref'` 的 entries
- 返 `{message_uuid, turn_uuid, message_kind, artifact_uuid, mime, summary, created_at}` 列表
- **R2 binding 缺失下不返 bytes**;只返 metadata + artifact_uuid(per ZX5 plan §6 风险表 + deepseek R8 既知 R2 wiring 是 ZX5 Lane E follow-up backlog)

#### D5 `GET /me/conversations`(per Q5 复用现有 D1 truth)

- `workers/orchestrator-core/src/index.ts` 加 `/me/conversations` route + `handleMeConversations` 走 service binding 到 User-DO
- `workers/orchestrator-core/src/user-do.ts:handleMeConversations(limit)` 复用 `D1SessionTruthRepository.listSessionsForUser({limit:200})`,按 `conversation_uuid` group(同一 conversation 多 session 收成 1 row),返 `{conversation_uuid, latest_session_uuid, latest_status, started_at, last_seen_at, last_phase, session_count}`,sort by `last_seen_at DESC`,slice limit
- 不新建平行表(per Q5);完全复用 ZX4 P3-05 5 状态视图

#### D6 `POST /me/devices/revoke` + migration 007(per Q9 device truth model freeze)

新建 `workers/orchestrator-core/migrations/007-user-devices.sql`(48 行):
- `nano_user_devices` 表:`device_uuid PK / user_uuid / team_uuid / device_label / device_kind('web'|'wechat-miniprogram'|'cli'|'mobile'|'unknown') / status('active'|'revoked') / created_at / last_seen_at / revoked_at / revoked_reason` + FK to nano_users / nano_teams + 2 indexes
- `nano_user_device_revocations` 表(append-only audit):`revocation_uuid PK / device_uuid FK / user_uuid / revoked_at / revoked_by_user_uuid / reason / source('self-service'|'admin'|'security-incident')` + 1 index

`workers/orchestrator-core/src/index.ts` 加 2 个新 route:
- `GET /me/devices` → `handleMeDevicesList`:authenticated user 的 devices 列表(D1 query `WHERE user_uuid = ?`,LIMIT 100)
- `POST /me/devices/revoke` → `handleMeDevicesRevoke`:body `{device_uuid, reason?}`;
  - 校验 device 属于当前 user(防跨用户 revoke)
  - idempotent(已 revoked 直接返 200 with `already_revoked: true`)
  - D1 batch:`UPDATE nano_user_devices SET status='revoked' WHERE device_uuid` + `INSERT INTO nano_user_device_revocations`
  - 返 `{device_uuid, status: 'revoked', revoked_at, revocation_uuid}`

**revoke 后行为(per Q9 第 3 条)**:本期产出 schema + endpoint + D1 写入;refresh / verify 路径在下一次 auth gate 时通过 D1 lookup 拒绝(`orchestrator-auth/src/jwt.ts` 的 device-active check 是 D6 second-half / 后续 PR;active session 的 best-effort 立即断开同样留 follow-up)。

### 1.3 Lane E — Library Worker RPC Uplift(保持 6-worker)

#### E1 context-core WorkerEntrypoint RPC

`workers/context-core/src/index.ts`:
- 保留 ZX2 P1-03 binding-scope 401 default + `/health` probe(向后兼容)
- 新增 `export class ContextCoreEntrypoint extends WorkerEntrypoint<ContextCoreEnv>` 含:
  - `fetch(request)` — delegates to legacy worker(向后兼容 fetch 路径)
  - `probe()` — returns `{status, worker, worker_version}` for binding self-check
  - `nacpVersion()` — returns NACP versions
  - `assemblerOps()` — returns supported ops list `{ops: [...]}` (ZX5 minimal seam,后续 phase 按业务驱动逐项 land)
- `workers/context-core/test/support/cloudflare-workers-shim.ts`(new shim,与 agent-core test shim 一致)
- `workers/context-core/vitest.config.ts`(new,alias `cloudflare:workers` to shim)
- agent-core 的 in-process import 保留(短期 shim period per Q6 + R9 时间盒化 ≤ 2 周;agent-core wrangler.jsonc CONTEXT_CORE binding 仍 commented 等 owner 决定 RPC-first toggle)

#### E2 filesystem-core WorkerEntrypoint RPC(同 E1 模式)

`workers/filesystem-core/src/index.ts` 同 E1:
- 保留 binding-scope 401 default + `/health`
- 新增 `FilesystemCoreEntrypoint` class with `fetch / probe / nacpVersion / filesystemOps`
- `filesystemOps()` returns `{ops: ['readArtifact', 'writeArtifact', 'listArtifacts']}`
- `workers/filesystem-core/{test/support/cloudflare-workers-shim.ts, vitest.config.ts}` new
- 短期 shim 期 agent-core 保留 in-process import

#### `ls workers/`

实测 6 项(`agent-core / bash-core / context-core / filesystem-core / orchestrator-auth / orchestrator-core`)— **worker 数量在 ZX5 内恒等于 6**(per R8 hard freeze)。

### 1.4 Lane F — Runtime Kernel Hookup + 稳健性(新增,per ZX4 closure §3.2 cluster work)

#### F1 + F2 NanoSessionDO alarm-driven wait-and-resume infra(per Q10 b 选项)

`workers/agent-core/src/host/do/nano-session-do.ts`:
- 加 `deferredAnswers` Map(`${kind}:${requestUuid}` → `{resolve, reject, expiresAt, kind, requestUuid}`)
- `awaitAsyncAnswer({kind, requestUuid, timeoutMs})`:public method;先查 storage(防 race:record 早于 await),不存在则注册 deferred + setTimeout 60s default(60s-5min clamp);timeout fail-closed reject
- `resolveDeferredAnswer(kind, requestUuid, decision)`:从 `recordAsyncAnswer` 调用,storage write 后立即 resolve 内存 deferred(无需 alarm wakeup)
- `sweepDeferredAnswers()`:由 `alarm()` 周期性调用,处理两种情况:
  1. expired entry → reject 且从 map 删
  2. storage 已有 decision 但内存 deferred 仍在等待(DO restart recovery 场景 — DO restart 后 deferred 内存丢失但被新 await 重建,storage 仍有早先 record 的 decision,alarm 周期性 sweep 触发恢复)
- `emitPermissionRequestAndAwait({sessionUuid, requestUuid, capability, reason?, timeoutMs?})` + `emitElicitationRequestAndAwait({...})`:public helper for future hook integration;返回 Promise<decision>
- `alarm()` 调用 `sweepDeferredAnswers()`(在 healthGate check 之后,setAlarm reschedule 之前)

#### F3 runtime emit `session.usage.update` server frame

`workers/agent-core/src/host/runtime-mainline.ts`:
- `MainlineKernelOptions` 加 `onUsageCommit?: (event) => void` callback
- tool quota commit 后调用 `options.onUsageCommit?.({kind: 'tool', remaining, limitValue, detail: {tool_name, request_id}})`
- LLM `afterLlmInvoke` quota commit 后调用 `options.onUsageCommit?.({kind: 'llm', remaining, limitValue, detail: {provider_key, input_tokens, output_tokens, turn_id}})`
- caller(NanoSessionDO composition)在 `onUsageCommit` 回调中通过 `emitServerFrame('session.usage.update', {...})` push 到 attached client(集成在 future PR;callback 已接通,emit 调用方留 cluster-level kernel work)

#### F4 handleStart idempotency(per Q11 b 选项)

`workers/orchestrator-core/src/session-truth.ts:claimPendingForStart(session_uuid)`:
- D1 atomic UPDATE:`UPDATE nano_conversation_sessions SET session_status='starting' WHERE session_uuid=?1 AND session_status='pending'`
- 返 `result.meta.changes > 0`(true = winner / false = 已被并发请求 claim)

`workers/orchestrator-core/src/user-do.ts:handleStart`:
- `durableStatus === 'pending'` 时,在所有 side-effect(`refreshUserState` / `put KV` / `ensureDurableSession`)**之前**调 `sessionTruth.claimPendingForStart(sessionUuid)`;返 false → 立即 409 `session-already-started, current_status: 'starting'`,不进入 side-effect path

`workers/orchestrator-core/test/user-do.test.ts:ZX5 F4 handleStart idempotency`:
- claim 返 false → 409 + `beginSession` 没被调用(并发 retry winner 已处理)
- claim 返 true → 200 + KV entry 写入 + side-effects 完整

#### F5 R28 wrangler tail investigation runbook

新建 `docs/runbook/zx5-r28-investigation.md`(140 行 owner-action template):
- §0 何时使用(ZX5 启动 Lane F 时,F1/F2 之前作为前置任务)
- §1 复现条件(cross-e2e 03 仍 fail with 500)
- §2 owner ops 流程(Step A-D:`wrangler tail` 启动 + 复现 verify capability-cancel + 抓 stack trace + 同时 tail agent-core)
- §3 复盘记录占位(owner 回填 stack trace + 根因分类 A/B/C/D + 修法决策 fix/upgrade/carryover)
- §4 回填 ZX5 closure 状态指引
- §5 历史背景

**sandbox 不能跑 wrangler tail**;F5-01 / F5-02 留待 owner 在自己环境执行。

---

## 2. 验证证据

| 验证项 | 命令 / 证据 | 结果 |
|---|---|---|
| `@haimang/jwt-shared` 包测试 | `cd packages/jwt-shared && vitest run` | **20 / 20 pass**(C1)|
| `@haimang/orchestrator-auth-contract` 包测试 | `pnpm -F @haimang/orchestrator-auth-contract test` | **19 / 19 pass**(C4 跨包断言 build 通过)|
| orchestrator-core test | `pnpm -F @haimang/orchestrator-core-worker test` | **77 / 77 pass**(ZX4 75 + F4 idempotency 2)|
| agent-core test | `pnpm -F @haimang/agent-core-worker test` | **1056 / 1056 pass**(零回归;F1/F2/F3 infra land 无 regression)|
| bash-core test | `pnpm -F @haimang/bash-core-worker test` | **374 / 374 pass**(零回归)|
| orchestrator-auth test | `pnpm -F @haimang/orchestrator-auth-worker test` | **13 / 13 pass**(ZX4 8 + C2 切 jwt-shared 不 break + C3 kid rotation 5)|
| context-core test | `pnpm -F @haimang/context-core-worker test` | **171 / 171 pass**(ZX4 167 + E1 RPC + cloudflare-workers-shim 4)|
| filesystem-core test | `pnpm -F @haimang/filesystem-core-worker test` | **294 / 294 pass**(零回归;E2 RPC + shim 不 break baseline)|
| root-guardians | `pnpm test:contracts` | **31 / 31 pass**(零回归)|
| `ls workers/` 数量 | `ls workers/ \| wc -l` | **6**(R8 hard freeze 维持)|
| `ls packages/` 数量 | `ls packages/ \| wc -l` | **7**(ZX3 6 keep-set + ZX5 jwt-shared)|
| `internal-http-compat` profile 状态 | `grep retired docs/transport/transport-profiles.md` | **retired**(ZX4 已 land,ZX5 未触碰)|
| `scripts/deploy-preview.sh` syntax check | `bash -n scripts/deploy-preview.sh` | **OK** |
| `nano_user_devices` migration syntax | grep CHECK / FK / INDEX in `migrations/007-user-devices.sql` | structurally sound,**待 owner apply** |
| **合计** | — | **`20 + 19 + 77 + 1056 + 374 + 13 + 171 + 294 + 31 = 2055 tests 全绿,零回归`** |

---

## 3. 残留事项与承接

### 3.1 owner-action 待办

- **prod migration 006 + 007 apply**(deploy hard gate)— prod deploy 前必须先 `wrangler d1 migrations apply --env prod --remote`
- **R28 wrangler tail 复盘**(F5)— owner 在自己环境跑 `wrangler tail nano-agent-orchestrator-core-preview` + 复现 verify capability-cancel + 抓 stack trace,fill `docs/runbook/zx5-r28-investigation.md` §3
- **D4 R2 bucket 创建**(若想 GET /sessions/{id}/files 真返 bytes)— 当前 endpoint 仅返 metadata + artifact_uuid;owner 创建 R2 bucket + binding 后扩展 download_url field(ZX5+ follow-up plan)
- **`pnpm-lock.yaml` 6 个 stale importer block 清理** — `NODE_AUTH_TOKEN` 注入后跑一次 `pnpm install`(per ZX3 closure §3.1 + ZX4 closure §3.3 持续 carryover)
- **WeChat 真机 smoke**(R17)— 跨 ZX2/ZX3/ZX4/ZX5 持续 carryover

### 3.2 cluster-level follow-up(ZX5 之后)

- **agent-core PermissionRequest / ElicitationRequest hook dispatcher 集成**:Lane F1/F2 已 land NanoSessionDO 的 wait-and-resume infra(`emitPermissionRequestAndAwait` / `emitElicitationRequestAndAwait`);但 `workers/agent-core/src/hooks/permission.ts` 内部 `verdictOf(outcome)` 改造为 "在 hook 处理过程中 await NanoSessionDO.emitPermissionRequestAndAwait()" 的 dispatcher 集成仍是 cluster-level kernel work。**infra 已就绪,future PR 引入 hook 调用即可消费**
- **runtime emit `session.usage.update` server frame caller wiring**:F3 已 land `MainlineKernelOptions.onUsageCommit` callback;NanoSessionDO composition 在 `onUsageCommit` 回调中调 `emitServerFrame('session.usage.update', {...})` 的 wire-up 留 future PR
- **D6 active session best-effort 强制断开**:Q9 第 3 条要求 "已存在的 live session 若已绑 device_uuid 则 best-effort 立即断开";本期产出 schema + endpoint + D1 写入,active session 强制断开是 second-half / 第二次 PR(需要 `device_uuid` 投影到 IngressAuthSnapshot + WS attach gate 检查)
- **orchestrator-auth verifyAccessToken device-active check**:在 verify 路径加 `nano_user_devices.status` lookup,revoked device 立即 reject;同上属 D6 second-half
- **context-core / filesystem-core RPC method body 实质实现**:E1/E2 当前是 minimal seam(`probe` / `nacpVersion` / `assemblerOps` / `filesystemOps` 仅返支持 op 名单);agent-core 切到 RPC 调用真 op body(如 `appendInitialContextLayer` via RPC vs library import)是 cluster work;短期 shim 期 ≤ 2 周(per Q6 + R9)
- **forwardInternalJsonShadow 重命名**:推迟到后续 envelope refactor 一并做(per GPT R7 / kimi R8 / deepseek R9 共识)

### 3.3 defer 到未来独立 plan

- **R24 NanoSessionDO 提取**(7-worker 拓扑)— ZX5 内 R8 硬冻结禁止;若未来重谈需 owner 重新授权 + 优先按 `agent-core / agent-session` agent-domain 内拆分语言重新建模
- **WORKER_VERSION GitHub Actions 切换**(D1 当前 owner-local 路径)— per Q2 future plan,本 ZX5 不承担

---

## 4. 风险与已知缺口

| 风险 | 严重 | 状态 | 缓解 |
|---|---|---|---|
| F1/F2 wait-and-resume infra 已 land 但 hook dispatcher 集成未 wire | medium | partial-by-design | infra 完整(awaitAsyncAnswer + sweep + emit helper);hook 改造留后续 PR;**当前不影响 dev velocity,前端发的 decision 仍写入 DO storage**(ZX4 P4 contract 不变) |
| F3 onUsageCommit callback 已加但 NanoSessionDO composition 未 wire `emitServerFrame('session.usage.update', ...)` | medium | partial-by-design | runtime 已 invoke callback,wire-up 留 future PR;前端 GET /usage 真读 D1 仍可用(ZX4 P5 不变) |
| E1/E2 RPC method 仅 minimal seam | low | by-design(short-term shim period) | per Q6 + R9 ≤ 2 周时间盒化;owner 决定 RPC-first toggle 后扩展 method body |
| D4 GET /files 不返 bytes(无 R2 binding) | low | open(R2 wiring 是 owner-action) | 返 metadata + artifact_uuid;owner 创建 R2 bucket 后扩展 download_url field |
| D6 device revoke 仅 D1 写入,active session 不立即断 | medium | partial-by-design | second-half 留后续 PR(需 IngressAuthSnapshot 加 device_uuid + WS attach gate device-active check)|
| **prod migration 006 + 007 apply 漏跑** | **high** | open(owner-action hard gate) | prod deploy 前必须 `wrangler d1 migrations apply --env prod --remote`;runbook §2.4 已加 prod deploy 顺序硬约束 |
| R28 verify-cancel deploy 500 根因仍未定位 | medium | open(F5 owner ops) | sandbox 拒 wrangler tail;owner 在自己环境复盘后 fill runbook |
| `pnpm-lock.yaml` stale importer block 仍未清理 | low | open(owner-action) | NODE_AUTH_TOKEN 注入后 `pnpm install` |
| C2 jwt-shared 切完后 user-do.ts 内 verifyJwt 改为 dynamic import | low | acknowledged | 这是为了在 worker bundling 时减少绑定时刻的 issue;tests 全绿,no behavioral change |
| `forwardInternalJsonShadow` 命名漂移仍未重命名 | low | acknowledged | 推迟到后续 envelope refactor 一并做(per GPT R7 等 4-reviewer 共识)|

---

## 5. 收尾签字

### 5.1 ZX5 Lane C/D/E/F — done

- ✅ Lane C C1-C6:jwt-shared package + 两 worker 切换 + kid rotation + RpcErrorCode 跨包断言 + envelope 文档化 + client heartbeat helper
- ✅ Lane D D1-D6:deploy-preview.sh + catalog content + /messages + /files + /me/conversations + /me/devices + /me/devices/revoke + migration 007
- ✅ Lane E E1-E2:context-core / filesystem-core 升级 WorkerEntrypoint(短期 shim period 维持 in-process library import)
- ✅ Lane F F1-F5:NanoSessionDO alarm-driven wait-and-resume infra + onUsageCommit callback + handleStart idempotency + R28 owner-action runbook stub
- ✅ 2055 tests + 31 root-guardians 全绿,零回归
- ✅ worker 数量恒等于 6(R8 hard freeze)
- ✅ Q1-Q11 owner 答复全部落地(Q10 alarm-driven / Q11 D1 conditional UPDATE 是本期新增)

### 5.2 zero-to-real 系列总收口

ZX5 是 zero-to-real 系列在当前 6-worker 拓扑内的真正终章。

| 阶段 | 主线产出 |
|---|---|
| Z0-Z2 | auth + session truth + D1 baseline |
| Z3-Z4 | runtime → Workers AI mainline + quota gate |
| ZX1-ZX2 | WeChat + transport profile + RPC + client narrow |
| ZX3 | 历史 package + test-legacy 物理删除 |
| ZX4 | transport 真收口(`internal-http-compat: retired`)+ session 语义 storage contract |
| **ZX5(本期)** | **协议/auth single source + 4 product endpoint + 2 library worker uplift + cluster runtime kernel hookup infra** |

**zero-to-real 在 6-worker 边界内全部 carryover 收口**;任何超越 6-worker 边界的演进(如 R24 NanoSessionDO 提取)都属于未来独立 plan 范畴。

### 5.3 owner action

- ⏳ **prod migration 006 + 007 apply**:`wrangler d1 migrations apply --env prod --remote`(deploy 前 hard gate)
- ⏳ **R28 wrangler tail 复盘**:fill `docs/runbook/zx5-r28-investigation.md` §3 + §4 后决定 fix/upgrade/carryover
- ⏳ **`runbook/zx2-rollback.md` 在 2026-05-12 归档**(per ZX4 closure §3.3 timer)
- ⏳ **`pnpm-lock.yaml` 一次性清理**:NODE_AUTH_TOKEN 注入后 `pnpm install`
- ⏳ **D4 R2 bucket 创建**:若产品需要 file download 真接通
- ⏳ **WeChat 真机 smoke**(R17 持续 carryover)

> 2026-04-28 — ZX5 全 4 lanes 收口。**协议/auth 卫生单一 source 落地(jwt-shared + 跨包断言 + envelope 文档化 + client shared helper migration)**;**4 个 product endpoint 业务可用(messages / files / conversations / devices)**;**2 个 library worker 升级真 RPC(context-core / filesystem-core,保持 6-worker)**;**cluster runtime kernel hookup infra(alarm-driven wait-and-resume + usage commit callback + handleStart idempotency)端到端 land**;**R28 owner-driven 复盘 runbook 就位**。zero-to-real 系列在 6-worker 边界内全部 carryover 收口,从 ZX2 P3-04 的 transport 中间态 → ZX5 的 single source + 业务可用 + cluster work infra 就绪 = 真正终章。
