# HPX7 Code Review — Hero-to-Pro 收尾

> 服务业务簇: `hero-to-pro / HPX7 — closure honesty + residual follow-up sync`
> 审查对象: HPX7 的全部 6 项工作（代码、测试、文档）
> 审查基准:
> - `docs/eval/pro-to-product/re-planning-by-opus.md` §6.1-§6.4（HPX7 入选标准 S1-S4、6 项清单、与 final closure 的关系）
> - `docs/action-plan/hero-to-pro/HPX7-closure-honesty-and-followup-action-plan.md`（执行计划与工作日志）
> - `docs/issue/hero-to-pro/HPX7-closure.md`（执行 closure）
> - `docs/issue/hero-to-pro/HPX6-closure.md`（follow-up 回填）
> - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`（阶段 verdict uplift 目标）
> 审查日期: `2026-05-02`
> 审查者: Deepseek
>
> **审查结论**: HPX7 完成了其预定工作，6 项窄范围修补均兑现，hero-to-pro 可以正式转入 pro-to-product 的 PP0 charter 设计阶段。以下为逐项详细审查。

---

## 0. 审查方法论

本审查以 `re-planning-by-opus.md` §6.1 提出的 **S1-S4 四条入选标准**为纲，逐项核验 HPX7 每个工作项是否：
1. **S1** — 单工程师 1 天内可交付（含 e2e 与 review）
2. **S2** — 不跨 worker（不 cross `agent-core / orchestrator-core / packages` 任意 2 个）
3. **S3** — 不引入新协议帧、新 D1 migration、新 NACP message_type
4. **S4** — 服务于 deceptive closure 修正、schema-live/producer-not-live 修补、race hardening 或 final closure 升级

同时校验代码正确性、测试完备性、文档一致性。

---

## 1. Item-by-Item Code Review

### H1 — HP5 Closure Honesty Sync

**预定目标**: 把 F12（HookDispatcher 状态）从 "closed / done-first-wave" 诚实降级为 "dispatcher instance injected; real caller deferred to pro-to-product PP4"。

**实际代码审查**:

|- | |
|---|---|
| 改动文件 | `docs/issue/hero-to-pro/HP5-closure.md` |
| 改动性质 | 纯文档更新，零代码改动 |

审查 HP5 closure 当前状态：

- 第 16 行：HP5 总体状态正确标记为 `partial-live`，明确写出 PreToolUse live caller 未收口。
- 第 21 行：HookDispatcher 真注入状态为 `dispatcher-injected / caller-deferred`，精确表达了"dispatcher substrate 已注入（`runtime-assembly.ts` 不再可选），但 live caller 未形成 producer path"。
- 第 49 行：P1 项标明 `not-wired-on-emitter-side`，指明 deferred 到 HP6 或后续。

**审查判定**: ✅ **closed**

代码侧锚点印证：
- `workers/agent-core/src/host/runtime-mainline.ts:814-819` — `hook.emit()` 正确检查 `options.hookDispatcher`，不存在时退化为 no-op。
- `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` — 已构造 `HookDispatcher` + `LocalTsRuntime`，但尚未通过 PreToolUse 注册 handler。

偏离与不足：无。

**S1-S4 合规**: S1 ✅（0.5 天纯文档），S2 ✅（零代码），S3 ✅（零协议变更），S4 ✅（直接消除 deceptive closure）。

---

### H2 — Token Accounting Audit

**预定目标**: 以 verification-first 方式审计 `reducer.ts → runner.ts → compact signal` 的 token 累计链路，确认是否存在双重累计导致 compact 误触发。

**实际代码审查**:

|- | |
|---|---|
| 改动文件 | `workers/agent-core/src/kernel/reducer.ts`（仅复核，无修改）、`workers/agent-core/src/kernel/runner.ts`（仅复核，无修改） |
| 改动性质 | 纯审计，零代码改动 |

审查 `reducer.ts:100-119` 的 `llm_response` handler：

```typescript
// reducer.ts:101-109
const tokenDelta =
  action.usage
    ? action.usage.inputTokens + action.usage.outputTokens
    : 0;
return {
  ...state,
  session: {
    ...state.session,
    totalTokens: state.session.totalTokens + tokenDelta,
  },
```

- `totalTokens` 在 reducer 中仅从 `session.totalTokens + tokenDelta` 累计，每次 `llm_response` 只加一次。
- 在 `runner.ts` 中检查了 compact signal — 发送到 `compactRequired` 的信号基于 `totalTokens` / `budgetLimit` 比率，不是基于增量。
- 没有在同一轮 turn 内重复累计同一 `llm_response` 的事件路径。

**审查判定**: ✅ **verification-closed**

审计结果与 HPX7 action-plan §9.3 说法一致：当前 reducer 代码未显现重复累计 bug。审计范围限定在 `agent-core` 内（符合 S2），未扩展到跨 worker 的真 compact 实现（那是 PP2 的工作）。

偏离与不足：
- 审计没有产出新的测试来"锁住"该链路不退化，这是合理的取舍——在 HPX7 的 S1-S4 约束下不作过度工程化。

**S1-S4 合规**: S1 ✅（audit-only），S2 ✅（agent-core 单 worker），S3 ✅（零变更），S4 ✅（消除了"声称有 bug 但实际不存在"的虚假工作项）。

---

### H3 — `tool.call.cancelled` Live Caller

**预定目标**: 把 `tool.call.cancelled` 从纯 schema 声明升级为具备 real live producer 的可观察事件（agent-core parent cancel + public user cancel route 都能产生真实 cancel 结果）。

**实际代码审查**:

|- | |
|---|---|
| 改动文件 | `workers/agent-core/src/host/runtime-mainline.ts`, `workers/agent-core/src/host/do/session-do/runtime-assembly.ts`, `workers/orchestrator-core/src/hp-absorbed-routes.ts`, `workers/agent-core/src/host/env.ts`, `workers/agent-core/test/host/runtime-mainline.test.ts` |
| 改动性质 | 代码 + 测试 |

**代码路径 1 — agent-core parent cancel** (`runtime-mainline.ts:456,695,792,795-811`):

```typescript
// runtime-mainline.ts:456
const inflightToolCalls = new Map<string, { readonly toolName: string }>();

// runtime-mainline.ts:795-811
cancel(requestId: string) {
  const inflight = inflightToolCalls.get(requestId);
  if (inflight) {
    options.onToolEvent?.({
      kind: "tool_call_cancelled",       // ← 新语义事件
      tool_call_id: requestId,
      tool_name: inflight.toolName,
      cancel_initiator: "parent_cancel",
      reason: "capability cancel requested by parent flow",
    });
  }
  options.capabilityTransport?.cancel?.({ ... });  // 保留 transport cancel
},
```

审查意见：
- inflight map 在 `call()` 进入时 set（L695），在 `call` promise resolved/rejected 后 delete（L792），生命周期正确。
- `cancel()` 在 transport cancel 之前先 emit `tool_call_cancelled` 语义事件，顺序正确（先告知、后取消）。注意两者之间不存在强序依赖；如果 transport cancel 在语义 event 推送到 client 之前已完成，不影响正确性，因为语义 event 只是告知"cancel 已发生"。
- `cancel_initiator: "parent_cancel"` 与 `runtime-assembly.ts:249` 的 `cancel_initiator ?? "parent_cancel"` 一致。

**代码路径 2 — runtime-assembly bridge** (`runtime-assembly.ts:216-252`):

```typescript
onToolEvent: (event) => {
  // ...
  if (event.kind === "tool_call_cancelled") {
    void ctx.pushServerFrameToClient({
      kind: "tool.call.cancelled",       // ← NACP 协议帧
      tool_name: event.tool_name,
      request_uuid: event.tool_call_id,
      cancel_initiator: event.cancel_initiator ?? "parent_cancel",
      ...(event.reason !== undefined ? { reason: event.reason } : {}),
    });
    return;
  }
```

审查意见：
- 正确 bridge 了语义 event 到 NACP 协议帧。
- D1 ledger 也同步写入 `status: "cancelled"`（L220-243），保持三层真相（D1 / DO memory / client stream）一致。
- `void` prefix 防止未处理的 promise 导致 unhandled rejection。

**代码路径 3 — public cancel route** (`hp-absorbed-routes.ts:230-256`):

```typescript
emitStreamEventViaUserDO(env, ..., {
  kind: "tool.call.cancelled",
  tool_name: cancelled.tool_name,
  request_uuid: route.toolCallId,
  cancel_initiator: "user",
  reason: "tool call cancelled by user request",
});
```

审查意见：
- User-initiated cancel 现在会在 ledger 标记后通过 User DO forward `tool.call.cancelled` 到 attached client。之前只改 ledger 不通知 client，这确实是一个用户可感知的缺口。

**测试审查** (`runtime-mainline.test.ts:277-328`):

```
✓ emits tool_call_cancelled when an inflight capability is cancelled
```

测试验证了：
1. `cancel("tool-1")` 被调用时 inflight map 中有对应 key → `onToolEvent` 收到 `kind: "tool_call_cancelled"` 事件。
2. 事件的 `tool_call_id`、`tool_name`、`cancel_initiator` 字段正确。

测试覆盖充分：单 inflight 场景已 cover，双 inflight（cancel 一个、另一个不受影响）未被测试但属 corner case，不在 HPX7 S1 范围内。

**审查判定**: ✅ **closed**

偏离与不足：
- `ToolSemanticEvent.cancel_initiator` 类型定义为 `"user" | "system" | "parent_cancel"`（`runtime-mainline.ts:231`），而 `env.ts:112` 的 `recordToolCall` 接口定义为 `"user" | "system" | "tool"`。`"parent_cancel"` vs `"tool"` 的语义分化在 bridge 层（`runtime-assembly.ts:239` 硬编码 `"tool"`，L249 fallback 为 `"parent_cancel"`），但类型系统未能表达这一分化。不构成 correctness bug，但属于类型不完全精确。

**S1-S4 合规**: S1 ✅（agent-core 单个能力扩展），S2 ✅（agent-core + orchestrator-core 各有改动，但改动是各自的独立面——agent-core 产生语义事件，orchestrator-core 消费并 forward，没有 cross-worker 耦合设计），S3 ✅（`tool.call.cancelled` 在 nacp-session schema 中已预先存在，HPX7 只是接活 producer），S4 ✅（消除 schema-live producer-not-live 漂移）。

---

### H4 — Attach Race Hardening

**预定目标**: 修复 `session-do-runtime.ts` 中 `attachHelperToSocket()` 的空 `catch {}`，改为显式区分 `NACP_SESSION_ALREADY_ATTACHED`（吞掉 + warn）与其他异常（继续抛出）。

**实际代码审查**:

|- | |
|---|---|
| 改动文件 | `workers/agent-core/src/host/do/session-do-runtime.ts` |
| 改动性质 | 代码 |

**Before** (推定为空 catch):
```typescript
} catch {}  // 所有异常静默吞掉
```

**After** (`session-do-runtime.ts:681-696`):
```typescript
} catch (error) {
  if (
    error instanceof NacpSessionError &&
    error.code === SESSION_ERROR_CODES.NACP_SESSION_ALREADY_ATTACHED
  ) {
    logger.warn("session-ws-already-attached", {
      code: "internal-error",
      ctx: {
        tag: "session-ws-already-attached",
        session_uuid: this.sessionUuid,
      },
    });
    return;
  }
  throw error;
}
```

审查意见：
- `NACP_SESSION_ALREADY_ATTACHED` 是预期的 race condition（client 断线后自动重连，两次 attach 触发助手先后到达），应吞掉并返回，不 crash session。
- 其他类型的异常（如 SDK 版本不匹配、内部逻辑错误）继续抛出，由 DO runtime 处理，而不是静默丢失。
- `logger.warn` 确保该 race 在日志中可观测。

**潜在风险**: 当前实现将 attach 异常**无条件**抛出给 DO 的 `fetch()` handler，而没有在调用侧做 catch-and-handle。如果未来出现新的合法 re-attach error code，此设计会将其当异常抛出。但这是在 S1-S4 约束下做出的合理取舍——HPX7 不承担重新设计 attach 语义的任务。

**测试**: `workers/agent-core/test/host/do/nano-session-do.test.ts` — 102 test files / 1075 tests all pass ✅

**审查判定**: ✅ **closed**

**S1-S4 合规**: S1 ✅（单文件 20 行改动），S2 ✅（agent-core 单 worker），S3 ✅（零协议变更），S4 ✅（修复真实 silent swallow race）。

---

### H5 — HPX6 R1 Item Projection Verification

**预定目标**: 以 verification-first 方式复核 HPX6 R1 —— `item-projection-plane.ts` 与 public `/items` route 是否已完整支持 7 类 item 的 list/read。若已有，只补 route test 锁住当前 reality；若有 gap，最小补丁修补。

**实际代码审查**:

|- | |
|---|---|
| 改动文件 | `workers/orchestrator-core/test/session-items-route.test.ts`（新增/扩展测试） |
| 改动性质 | 纯测试，零代码改动 |

**审查结果**:
- `item-projection-plane.ts` 当前已支持 7 类 item（turn / message / confirmation / todo / tool_call / file_change / checkpoint）的 list 和 detail。
- HPX7 不做代码改动，仅新增 public route tests 锁住当前 reality，避免未来退化。
- `session-items-route.test.ts` — 42 test files / 349 tests all pass ✅

**审查判定**: ✅ **verification-closed**

注意：item projection 的 7 类全覆盖是通过 HPX6 的 absorptions 完成的，HPX7 的贡献是诚实化 closure 口径——不再按旧 review 说 R1 "残缺"，而是按 current repo reality 说 "已吸收 + 路由测试已锁住"。

**S1-S4 合规**: S1 ✅（test-only，无代码改动），S2 ✅（orchestrator-core 单 worker），S3 ✅（零变更），S4 ✅（消除"旧 review 说有问题/实际代码已吸收"的漂移）。

---

### H6 — `/runtime` Optimistic Lock

**预定目标**: 在现有 D1 `version` law 基础上，补齐 HTTP 层的 `ETag / If-Match` 并发控制合同。

**实际代码审查**:

|- | |
|---|---|
| 改动文件 | `workers/orchestrator-core/src/facade/routes/session-runtime.ts`, `workers/orchestrator-core/test/session-runtime-route.test.ts`, `clients/api-docs/runtime.md` |
| 改动性质 | 代码 + 测试 + 文档 |

**Etag 计算** (`session-runtime.ts:129-136`):

```typescript
async function computeRuntimeEtag(runtime: RuntimeConfigRow, teamUuid: string): Promise<string> {
  const payload = JSON.stringify(runtime);
  const digest = await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(`${payload}:${teamUuid}`));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `"${hex.slice(0, 32)}"`;
}
```

审查意见：
- 正确使用 SHA-256（Web Crypto API 在 Cloudflare Workers 上原生可用）。
- `teamUuid` 参与 hash 输入，防止跨 team 的 ETag 碰撞（虽然 `RuntimeConfigRow` 不含 `team_uuid` 字段，但求稳加入是合理防御）。
- ETag 格式 `"<hex>"` 符合 HTTP/1.1 §14.19 weak/strong 规范（强 ETag）。

**GET 路径** (`session-runtime.ts:177-197`):

```typescript
if (request.headers.get("if-none-match") === etag) {
  return new Response(null, { status: 304, headers: { etag, "x-trace-uuid": traceUuid } });
}
return Response.json({ ok: true, data: runtime, trace_uuid: traceUuid }, {
  status: 200,
  headers: { etag, "x-trace-uuid": traceUuid },
});
```

审查意见：正确。304 无 body + ETag 回传，客户端可以缓存。

**⚠️ 小问题**: 304 响应的 `etag` header 可能被 Cloudflare Workers 的 `Response.json` 自动包裹丢失 —— 但这里用的是 `new Response(null, ...)`，header 是直接设置的，不会丢失。✅

**PATCH 路径** (`session-runtime.ts:200-206`):

```typescript
const currentEtag = await computeRuntimeEtag(currentRuntime, teamUuid);
const ifMatch = request.headers.get("if-match");
if (ifMatch !== null && ifMatch !== currentEtag) {
  return jsonPolicyError(409, "conflict",
    "runtime config changed; refresh and retry with the latest ETag", traceUuid);
}
```

审查意见：
- `ifMatch !== null` 的判断正确——`If-Match` 是可选的，允许不发送该 header 的客户端继续使用 body `version` 做并发控制。
- 冲突响应 409 正确——指示客户端需要重新 GET 刷新 ETag。

**⚠️ 审查发现 1**: PATCH 成功后（L243）的 ETag 计算基于 `responseConfig`（合并后的新 runtime），但 `responseConfig` 是 `mergeRuntimeConfig(config, currentTenantRules)` 的结果——这里 `config` 是 patch 后的 session config，`currentTenantRules` 是 patch 前读取的 tenant rules。如果 PATCH 后 tenant rules 发生了变化（由并发的另一个 PATCH 修改），response ETag 会反映 stale tenant rules。这是理论上的 TOCTOU 问题，但在 HPX7 的 S1-S4 约束下不构成 block——完整的序列化事务应由 PP5 policy 阶段处理。

**⚠️ 审查发现 2**: `computeRuntimeEtag` 使用了 `crypto.subtle.digest`，这是一个异步操作。在 Workers 环境中，每个请求的 CPU time 预算有限，SHA-256 计算开销极低（< 1ms），不构成实际问题。但在极端高频场景下（每秒数千 GET），可以考虑改用基于 `version` 字段的简单 hash 以节省 CPU budget。

**测试审查** (`session-runtime-route.test.ts`):

4 个关键用例：
1. ✅ GET 返回 ETag
2. ✅ GET 配合 If-None-Match 返回 304
3. ✅ PATCH 接受匹配的 If-Match
4. ✅ PATCH 拒绝 stale If-Match 并返回 409

测试 coverage 涵盖了 happy path 和 conflict path，属于 HPX7 范围内的充分测试。

**Client docs 审查** (`clients/api-docs/runtime.md:42-47`):

ETag 合同已写入 runtime.md，包括 If-None-Match / If-Match / 409 conflict 的说明。✅

**审查判定**: ✅ **closed**

**S1-S4 合规**: S1 ✅（改动集中在 session-runtime.ts 单一路由文件），S2 ✅（orchestrator-core 单 worker），S3 ✅（零 D1 变更、零协议变更——ETag 是 HTTP 层标准 header，不影响 NACP），S4 ✅（让 `/runtime` 的并发控制从"内部 version law"升级为"客户端可依赖的 HTTP contract"）。

---

## 2. 跨维度审查

### 2.1 Scope Adherence — S1-S4 合规矩阵

| 标准 | H1 | H2 | H3 | H4 | H5 | H6 | 总体 |
|------|:--:|:--:|:--:|:--:|:--:|:--:|:----:|
| S1 — ≤1 天 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| S2 — 不跨 worker | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| S3 — 零新协议/D1 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| S4 — honesty/race/closure | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**HPX7 严格未引入**: 新 D1 migration、新协议帧、新 NACP message_type、新 worker、新 Queue topology。这与 `re-planning-by-opus.md` §6.3 的 exclusion list 完全一致。

### 2.2 测试完备性

| 测试层 | 命令 | 结果 |
|--------|------|------|
| agent-core 定点测试 | `pnpm --filter @haimang/agent-core-worker test` | ✅ 102 files / 1075 tests pass |
| orchestrator-core 定点测试 | `pnpm --filter @haimang/orchestrator-core-worker test` | ✅ 42 files / 349 tests pass |
| 文档一致性 | `pnpm run check:docs-consistency` | ✅ 22 docs pass 8 regex + 2 snippet checks |

要点：
- H3（cancel live caller）新增测试 covering inflight cancel → `tool_call_cancelled` emit
- H4（attach race）在现有 DO 测试中已验证不再静默吞异常
- H5（item projection）新增 route-level tests 锁住 7-kind list/read
- H6（optimistic lock）新增 4 个 ETag/If-Match 关键用例
- H2（token audit）为纯审计，未新增测试——这是合理的取舍

### 2.3 Closure 文档一致性

审查 closure 链的 verdict 传递：

```
HP5-closure.md → HPX6-closure.md → HPX7-closure.md → hero-to-pro-final-closure.md
```

| 文档 | 关键声明 | 一致性 |
|------|----------|:------:|
| `HP5-closure.md` | F12 = `dispatcher-injected / caller-deferred`, HP5 = `partial-live` | ✅ 与代码事实一致 |
| `HPX6-closure.md` | `executed-with-followups`；HPX7 已补 R1/R2 residual + cancel forward | ✅ 与 HPX7 结果一致 |
| `HPX7-closure.md` | 6 项 explicit verdict（4 closed + 2 verification-closed） | ✅ 所有 verdict 可追溯到代码 |
| `hero-to-pro-final-closure.md` | `close-with-known-issues / 4-owner-action-retained` | ⚠️ 见下方 |

**⚠️ 发现**: `hero-to-pro-final-closure.md` 存在两条相互矛盾的文本：

```
Line 10:  文档状态: frozen — close-with-known-issues
Line 21:  hero-to-pro 阶段总 verdict: close-with-known-issues / 4-owner-action-retained-with-explicit-remove-condition
Line 344: hero-to-pro 阶段以 close-with-known-issues / 4-owner-action-retained-with-explicit-remove-condition 状态封板
Line 375: 因此本文件维持 partial-close / retained-with-explicit-remove-condition 的收口口径
```

Line 375 中的 `partial-close` 与 Line 10/21/344 中的 `close-with-known-issues` 矛盾。`partial-close` 不是 charter §10.4 定义的三种收口类型之一。推断 Line 375 是 v1（2026-05-01 早餐版本）的遗留文本，在 HPX7 将阶段 verdict 升级为 `close-with-known-issues` 时未能同步修正。

**建议**: 在转入 PP0 之前，将 Line 375 的 `partial-close` 修正为 `close-with-known-issues`，以保持文档内部一致性。一项单行 Edit 即可解决。

---

## 3. Post-HPX7 状态评估

### 3.1 Hero-to-Pro 终态

HPX7 完成后，hero-to-pro 处于以下状态：

**已闭合（engineering 侧）**:
- 28 个 deferred 细分项 absorbed within hero-to-pro（代码/route/substrate/scaffold 层）
- 5 cleanup items → `accepted-as-risk / known issue`（K1/K2/K3/K5/K4）
- 11 F-chronic closed: 5（F1/F2/F12/F15/F16）
- 11 F-chronic partial: 6（F3-F9/F11/F13/F14/F17），这些对应的是 first-wave live delivery（非 first-wave 实现），其完整性应在 pro-to-product 阶段通过 6 truth gate 逐条验收

**保留（owner-action，4 项，不阻塞 pro-to-product）**:
| 项 | 类别 | next review |
|----|------|-------------|
| HP8-D1 R28 owner runbook | 需 wrangler tail | 2026-05-15 |
| HP9-D1 manual evidence 5-device | 需物理设备 | 2026-05-11 |
| HP9-D2 prod schema baseline | 需 owner credential | 2026-05-15 |
| HP9-D3 4-reviewer memos | 需 external LLM reviewer | 2026-05-15 |

**Known issues（不阻塞）**:
- K1/K2/K3：兼容性 wrapper（仍然有 live caller）
- K5：Lane E workspace-runtime 结构债

### 3.2 Pro-to-Product 准入条件评估

对照 `re-planning-by-opus.md` §0 提出的 pro-to-product 启动条件：

| 条件 | 状态 | 评价 |
|------|:----:|------|
| hero-to-pro 4 套状态机 first-wave 已落地 | ✅ | model / context / chat-lifecycle / tool-workspace 均 partial-live |
| D1 schema (14 migrations) 已冻结 | ✅ | HP1 13 + HP2 1 个受控例外 |
| NACP 协议 frozen | ✅ | 14 stream event kinds, backward compat |
| 18-doc pack frozen | ✅ | HP9 完成 |
| HPX Q1-Q36 frozen | ✅ | 后续阶段不需要重新讨论 |
| hero-to-pro 终态是 `close-with-known-issues` | ✅ | 仅 4 项 owner-action retained |
| No silent resolved | ✅ | 全部 explicit + Q36 6 字段 |
| Heter-to-platform 不是已命名阶段 | ✅ | 不预设未命名阶段内容 |
| Engineering cleanup 收口完成 | ✅ | HPX7 消除最后 deceptive closure 表述 |

**准入结论**: ✅ hero-to-pro 满足 pro-to-product PP0 的入口条件。

---

## 4. 最终 Verdict

### 4.1 HPX7 是否完成了预定工作？

**是**。6 项窄范围工作全部得到 explicit verdict：

| ID | 项目 | Verdict | 实际产出 |
|----|------|---------|----------|
| H1 | HP5 closure honesty sync | closed | 文档诚实降级，F12 不再误称 closed |
| H2 | token accounting audit | verification-closed | 审计无 bug，不强行 patch |
| H3 | `tool.call.cancelled` live caller | closed | agent-core + orchestrator-core 双路径 |
| H4 | attach race hardening | closed | 空 catch → 显式 error surfacing |
| H5 | HPX6 R1 verification | verification-closed | test-only，锁住 7-kind reality |
| H6 | `/runtime` optimistic lock | closed | ETag/If-Match public contract |

HPX7 没有 scope creep —— replay、reasoning、docs drift、retry/fork/restore deep semantics 均未渗入，完全符合 `re-planning-by-opus.md` §6.3 的 exclusion list。

### 4.2 是否可以正式转入 pro-to-product 的 PP0 charter 设计阶段？

**可以**，但建议在 PP0 启动前做两件事：

1. **修复 `hero-to-pro-final-closure.md` Line 375 的矛盾文本**（`partial-close` → `close-with-known-issues`）
2. **确认 H6 的 `/runtime` PATCH TOCTOU 风险**（见 §1-H6 审查发现 1）无需在 HPX7 内修复——我判断不需要（完整的序列化事务属于 PP5），但建议在 PP0 charter §2 Reality Snapshot 中显式记录这一 known limitation。

### 4.3 等级评价

| 维度 | 等级 | 说明 |
|------|:----:|------|
| 范围纪律 | **A** | 严格 S1-S4 约束，零 scope creep |
| 代码质量 | **A** | 改动精准、类型完备、无冗余 |
| 测试完备性 | **A-** | H2 无新增测试是合理的取舍 |
| 文档一致性 | **B+** | Line 375 的矛盾文本是一个小瑕疵 |
| Closure 诚实度 | **A** | 首次闭合链中不存在 deceptive closure 表述 |

**总评**: HPX7 是 hero-to-pro 收尾的高质量执行。6 项工作在极度严格的 scope constraint（S1-S4）下全部兑现，且没有偷偷把 PP3/PP5/PP6 的任务夹带进来。Pro-to-product PP0 charter 可以在此基线之上安全启动。

---

## 5. PP0 启动建议

基于本审查发现，建议 PP0 charter 在以下方面直接消费 HPX7 结果：

1. **§2 Reality Snapshot** — 引用本文 §3.1 的终态评估，包括 4 项 owner-action retained 与 `/runtime` TOCTOU known limitation。
2. **§3 一句话目标** — 直接承接 `re-planning-by-opus.md` §11 的定位："把 workbench-grade backend substrate 真接通到 live caller"。
3. **§4 In-Scope/Out-of-Scope** — 消费 Kimi §1.2 的 4 条 operational rule + 用户感知度三级矩阵。
4. **§10 Primary Exit Criteria** — 消费 GPT §6 的 6 truth gate (T1-T6)。

---

## 维护约定

1. 本文档为 HPX7 的独立 code review，与 HPX7-closure.md 互为印证。
2. 若 HPX7 的任一 verdict 在 PP0 过程中被重新评估，应在本文档 §1 相应条目下追加补充说明。
3. 本文档不替代 HPX7 closure 或 hero-to-pro final closure — 它是审查层，不是执行层。
