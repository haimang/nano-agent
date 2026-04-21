# B9 plan reviewed by GPT

Status: **changes-requested**

Primary verdict: **B9 这个 phase 本身是成立的，而且仍然应该作为 worker matrix Phase 0 的硬前置；但当前 `B9-nacp-1-3-contract-freeze.md` 还不是可直接执行的 action-plan。它准确抓到了三个真实缺口——`message_type × delivery_kind` 合法性、`session-do-runtime` 的 tenant plumbing、以及 `session.start.body.initial_context` 这条 upstream seam——但同时掺进了几条已经偏离当前代码事实的实现假设。我的建议不是取消 B9，而是先把 B9 重写得更窄、更贴代码，再开工。**

我对 Opus 本轮判断的总体态度是：**方向对，执行稿需要校准。** `smind-contexter` 的 §9/§10 与 B8 review 确实支撑 “在 worker matrix 之前做一次 contract freeze”；但当前文稿把 `nacp-core`、`nacp-session`、`session-do-runtime` 三层的责任边界重新揉混了，且低估了 error-body / naming 这两块的真实改动面。

---

## 1. Scope and method

本次 review 覆盖：

- `docs/action-plan/after-foundations/B9-nacp-1-3-contract-freeze.md`
- `docs/eval/after-foundations/smind-contexter-learnings.md` §9 / §10
- `context/smind-contexter/` 的 gateway / director 实码
- 当前 shipped protocol/runtime truth：
  - `packages/nacp-core/`
  - `packages/nacp-session/`
  - `packages/session-do-runtime/`

独立核查与现状验证：

1. `pnpm --filter @nano-agent/nacp-core typecheck build test` → **231/231**
2. `pnpm --filter @nano-agent/nacp-session typecheck build test` → **115/115**
3. `pnpm --filter @nano-agent/session-do-runtime typecheck build test` → **357/357**
4. `node --test test/*.test.mjs` → **77/77**
5. `npm run test:cross` → **91/91**

这很重要，因为我下面的 finding 主要不是“代码现在是红的”，而是：**B9 文稿里有几条 implementation target、scope estimate、以及 ownership 归属，不再符合当前仓库真相。**

---

## 2. What Opus got right

### 2.1 B9 作为新 phase 是真的有必要

B9 指向的三条主线都不是空想：

1. `delivery_kind` 已经是现有协议的一条明确轴，但 `validateEnvelope()` 现在只做 **message registry / version / body / role** 五层校验，还没有 type × delivery legality 这一层：`packages/nacp-core/src/envelope.ts:250-359`
2. `SessionStartBodySchema.initial_context` 现在确实只是宽松的 `z.record(z.string(), z.unknown()).optional()`，而且仓内只有 schema 槽位、没有任何消费点：`packages/nacp-session/src/messages.ts:17-21`
3. `verifyTenantBoundary` / `tenantDoStorage*` 已在 core 出口存在，但 `NanoSessionDO` 仍然直接从 `env.TEAM_UUID` 取 team、并直接操作 `this.doState.storage`：`packages/nacp-core/src/index.ts:101-104`, `packages/session-do-runtime/src/do/nano-session-do.ts:335-347,609-623,934-1007`

所以，**B9 的问题定义本身成立**。这里我同意 Opus。

### 2.2 `smind-contexter` 确实支撑 “upstream orchestrator → nano-agent runtime” 这条 seam

这条不是文档空转，而是能在实码里看到：

- `chat.ts` 明确是无状态 gateway，并以 `idFromName(user_uuid)` 路由到 user-level DO：`context/smind-contexter/src/chat.ts:13-18,118-125`
- `director.ts::handleUserMessage()` 是 one-shot 的 intent → route → gen 流，不是 agent step loop：`context/smind-contexter/context/director.ts:139-245`
- `smind-contexter-learnings.md` 也把 `initial_context` 注入点和 tenant split 写得很清楚：`docs/eval/after-foundations/smind-contexter-learnings.md:1365-1448,1496-1517`

因此，**B9 把 `initial_context` 和 tenant split 拉进正式 review 范围，是有事实基础的**。

### 2.3 “B9 先于 worker matrix” 仍然是合理顺序

`smind-contexter-learnings.md` §9.5.2 / §9.7 的判断依然成立：如果今天已经知道 contract surface 需要补正交化和合法性校验，那么让四个 first-wave workers 先带着这层 tech debt 开跑，再回头补 freeze，成本只会更高：`docs/eval/after-foundations/smind-contexter-learnings.md:880-903,954-1012`

所以我的结论不是“把 B9 延后”，而是：**保留 B9 的时机判断，但修正 B9 的执行稿。**

---

## 3. Findings

| ID | Severity | Finding | Why it matters |
|---|---|---|---|
| B9-R1 | high | B9 把 session-profile 的 matrix 主要落在 `nacp-core`，与当前 validator ownership 不符 | `session.*` 并不走 `validateEnvelope()`；如果按现稿实装，session wire 仍会留下未覆盖空洞 |
| B9-R2 | high | error-body + naming/alias 这两项 scope 被低估，且部分依据已落后于当前 registry truth | 这会把一个“补 contract”的 phase 扩成“再造第二套命名/错误体系”的 phase |
| B9-R3 | high | Phase 3 的 runtime 改造目标点写错了：引用了不存在的 seam，也误判了 `NanoSessionDO` 的真实 storage/ingress 形状 | 即使问题判断正确，按这个 diff plan 执行也会打偏 |
| B9-R4 | medium | version baseline 与 update surface 估算不诚实：当前 package/changelog/hardcoded version 自己就还没完全对齐 | 直接承诺 `1.3.0 / 1.3.0 / 0.3.0` 会低估收口工作 |
| B9-R5 | low | 文档路径与 exit criteria 有几处明显 drift | 不影响问题本身，但会误导执行与 closure 判断 |

---

## 4. B9-R1 — core-owned matrix does not match current session ownership

B9 Phase 2 明确写的是：在 `nacp-core` 新增 `NACP_TYPE_DIRECTION_MATRIX`，并且“覆盖全部 `NACP_MESSAGE_TYPES_ALL + SESSION_MESSAGE_TYPES`”：`docs/action-plan/after-foundations/B9-nacp-1-3-contract-freeze.md:266-269`

这和当前仓库真相不一致。

### 4.1 `nacp-core` 与 `nacp-session` 现在是两套 validator ownership

`nacp-core` 文件头已经写得很清楚：Core 是 internal envelope，Session 是单独包：`packages/nacp-core/src/envelope.ts:1-10`

`nacp-session/src/messages.ts` 也明说了：

> These are **NOT** registered in Core's BODY_SCHEMAS — they belong exclusively to the Session profile.

见：`packages/nacp-session/src/messages.ts:9-10`

而 Session profile 的真实 parse path 是：

- `normalizeClientFrame()` 组 authority + session_frame 后，调用 `validateSessionFrame()`：`packages/nacp-session/src/ingress.ts:25-74`
- `validateSessionFrame()` 自己检查 `SESSION_MESSAGE_TYPES`、`SESSION_BODY_REQUIRED`、`SessionStreamEventBodySchema`：`packages/nacp-session/src/frame.ts:56-118`
- `NanoSessionDO.webSocketMessage()` 的 ingress 入口现在走的是 `acceptIngress()` / `dispatchAdmissibleFrame()`：`packages/session-do-runtime/src/do/nano-session-do.ts:459-506`

也就是说，**`session.start / followup_input / resume / ack / heartbeat` 这批消息，根本不经过 `validateEnvelope()`**。  
所以如果只在 `nacp-core` 的第 6 层加 matrix，最多只能保护 core-internal messages，**挡不住 session-profile 的非法组合**。

### 4.2 更合理的 B9 落点

我建议把这项拆成：

1. **Core matrix**：`nacp-core` 只管 core registry 自己的 11 个 internal message types
2. **Session matrix**：`nacp-session` 为自己的 8 个 `session.*` message types 增加 delivery legality
3. 如果真想共用一份 vocabulary，可以做成 shared data module，但**消费点仍要留在两边各自 validator 里**

当前 B9 这一条，不是问题定义错，而是**ownership 放错了包**。

---

## 5. B9-R2 — error-body + naming/alias scope is understated and partly stale

B9 把这两项都放进了 nacp-core 1.3.0 shipped scope：

- `NacpErrorBodySchema` + `wrapAsError()`：`B9 ...:267,904-909`
- `VERB_NAMING_SPEC` + `LEGACY_ALIAS_REGISTRY`：`B9 ...:268,910-917`

我认为这两条都比文稿写得更重。

### 5.1 Error body 不是“再加一个 schema”这么简单

当前 core 里已经同时存在两套 error reality：

1. `system.error` 使用完整 `NacpErrorSchema`：`packages/nacp-core/src/messages/system.ts:3-8,16-27`, `packages/nacp-core/src/error-registry.ts:23-30`
2. `tool.call.response` / `context.compact.response` / `skill.invoke.response` 这些业务 response 仍然是：
   - `status: "ok" | "error"`
   - `error?: { code, message }`

见：

- `packages/nacp-core/src/messages/tool.ts:9-13`
- `packages/nacp-core/src/messages/context.ts:10-16`
- `packages/nacp-core/src/messages/skill.ts:9-13`

所以，B9 如果真的把 “任何 `X.response` 在 `delivery_kind = error` 时都用统一 `NacpErrorBodySchema`” 作为 shipped contract，那么它至少还要回答：

1. 这些现有 `status + error` response bodies 怎么迁移
2. `system.error` 与新的 verb-error wrapper 怎么并存
3. 现有下游 consumer / tests 是继续吃旧 shape，还是要一起更新

当前 action-plan 没把这层迁移写出来，所以我不接受它的 diff estimate。

### 5.2 naming/alias 这条更像 RFC boundary，不像当前必须 shipped 的 runtime work

`smind-contexter-learnings.md` 在 §9.5.2 的老例子里还保留了 `tool.call.result` / `hook.broadcast` / `hook.return` 这样的早期名称：`docs/eval/after-foundations/smind-contexter-learnings.md:888-899`

但当前代码真相已经是：

- `hook.emit` / `hook.outcome`：`packages/nacp-core/src/messages/hook.ts:18-29`
- 没有 `tool.call.result`
- core 侧现在注册的是 tool / hook / skill / context / system 五组消息：`packages/nacp-core/src/messages/index.ts:9-21`

这说明：**B9 如果要做 naming work，必须严格以当前 1.1 registry truth 为基线，而不能直接把 §9.5.2 的示例抄进实现。**

更重要的是，`smind-contexter-learnings.md` 对 naming 的更稳表达，其实是：

> 对 **NEW verbs only** 强制 `<namespace>.<verb>`，旧字符串保留 alias

见：`docs/eval/after-foundations/smind-contexter-learnings.md:910-917`

这意味着更保守、也更贴当前代码的做法是：

1. 在 RFC / README 层冻结 **“new verbs obey naming law”**
2. 如果本 phase 没有新增 canonical verb，就**不要急着把 alias registry 变成 shipped runtime 机制**

否则 B9 会从“contract freeze”滑向“建立一套当前还没有消费者的 second naming system”。

---

## 6. B9-R3 — Phase 3 runtime plan targets the wrong seams

B9 Phase 3 的主要 runtime 落点是：

- 新增 `tenantIngressVerify(env, envelope)`：`B9 ...:283`
- 把所有 `state.storage.put/get/delete` 改走 `tenantDoStorage*`：`B9 ...:284,498`
- 在 `NanoSessionDO` 里接 `this.subsystems.contextCore?.ingestFromUpstream(ctx)`：`B9 ...:284`

这三条都和当前 `NanoSessionDO` 的实码不完全对齐。

### 6.1 `tenantIngressVerify` 不是现有 seam

仓内没有任何 `tenantIngressVerify` 符号；它只出现在 B9 文稿本身。当前真实 ingress 路径是：

- `acceptClientFrame()` → `acceptIngress(...)`：`packages/session-do-runtime/src/do/nano-session-do.ts:480-495`
- `buildIngressContext()` 从 `env.TEAM_UUID` 组 authority：`.../nano-session-do.ts:609-623`

如果 B9 想补 tenant verify，真实改造点更接近：

1. 明确 `TEAM_UUID` / stamped authority 的来源 law
2. 在 `acceptIngress` 前后接上 boundary consistency 检查
3. 让 WS / HTTP fallback / checkpoint / helper construction 统一消费同一份 latched tenant identity

而不是先发明一个抽象 helper 名字。

### 6.2 `NanoSessionDO` 现在也不是 `state.storage.*` reality

B9 的 grep/exit criterion 反复写 `state.storage.put|get|delete = 0`：`B9 ...:498,521`

但当前文件里真实使用的是 `this.doState.storage`，集中在：

- `wsHelperStorage()`：`packages/session-do-runtime/src/do/nano-session-do.ts:934-943`
- `persistCheckpoint()`：`...:945-1000`
- `restoreFromStorage()`：`...:1002-1008`

所以这不是“问题不存在”，而是**plan 写错了靶点**。  
正确表述应是：**消除 `NanoSessionDO` 中未经 tenant scoping 的 raw `doState.storage` use-sites**，而不是写死 `state.storage.*` 这个旧 grep 口径。

### 6.3 `contextCore?.ingestFromUpstream()` 也是 future seam，不是当前代码 reality

仓内既没有 `contextCore` subsystem，也没有 `ingestFromUpstream()` 符号。  
反过来，`smind-contexter-learnings.md` 里这条 seam 本来就是**“改造后”**的 future suggestion：`docs/eval/after-foundations/smind-contexter-learnings.md:1408-1428`

所以 B9 如果要诚实：

- 要么把这条写成 **Phase 3 只保留 `initial_context` 于 validated body / checkpoint seam，不承诺真实 consumer**
- 要么先在 `session-do-runtime` 里定义一个 very small upstream-context handle，再把它交给 future `context.core`

现在这种“如果 context.core 还没 ship，先写 no-op”的写法，太像把一个尚未存在的 subsystem 强行塞进 closure 条件。

---

## 7. B9-R4 — version baseline and update surface are understated

B9 预期把三包 bump 到：

- `nacp-core` → `1.3.0`
- `nacp-session` → `1.3.0`
- `session-do-runtime` → `0.3.0`

见：`docs/action-plan/after-foundations/B9-nacp-1-3-contract-freeze.md:497,518-520`

我不反对这些 version target；但当前 baseline 自己还没完全对齐：

1. `@nano-agent/nacp-core` / `@nano-agent/nacp-session` 现在都是 `1.1.0`：`packages/nacp-core/package.json:1-4`, `packages/nacp-session/package.json:1-4`
2. `@nano-agent/session-do-runtime` 的 `package.json` 还是 `0.1.0`：`packages/session-do-runtime/package.json:1-4`
3. 但它的 `CHANGELOG.md` 头条已经写成 `0.2.0`：`packages/session-do-runtime/CHANGELOG.md:1-5`
4. 此外 `session-do-runtime/src/http-controller.ts` 还硬编码了 `"1.1.0"`：`packages/session-do-runtime/src/http-controller.ts:125-155`

这意味着 B9 的 version work 不是简单 bump number，而要先：

1. 清理 `session-do-runtime` 自己的 version baseline drift
2. 枚举所有 hardcoded `1.1.0` use-sites
3. 再决定 1.3 / 0.3 的最终切点

否则 Phase 4 的“version consistency” closure 看起来很整齐，实际上会漏工。

---

## 8. B9-R5 — there is document drift even before execution

这条不是 blocker，但值得在执行前先修：

### 8.1 B8 review 文档路径写错了

B9 多处引用：

- `docs/code-review/B8-docs-reviewed-by-opus.md`

见：`B9 ...:34,301,526,570`

但仓内真实路径是：

- `docs/code-review/after-foundations/B8-docs-reviewed-by-opus.md`

见文件列表：`docs/code-review/after-foundations/B8-docs-reviewed-by-opus.md`

### 8.2 `state.storage.* = 0` 的 grep 不是当前 closure proof

这一点前面已经说过。  
如果 closure 仍保留这条 grep，它会给执行者一种错误反馈：**文件明明还有 raw `doState.storage`，但 closure grep 可能已经“通过”**。

---

## 9. Recommended rewrite before execution

我建议把 B9 改成下面这个更贴当前代码 reality 的版本：

1. **保留 B9 的时机判断**  
   B9 仍然是 worker matrix Phase 0 的硬前置，不后移。

2. **把 matrix 明确拆成 core/session 两处消费**
   - `nacp-core`: internal message registry legality
   - `nacp-session`: session profile legality
   - 可共享 vocabulary，但不要假装 session 由 core 单点仲裁

3. **把 naming work 缩到 RFC / new-verb law**
   - 本 phase 不强推 canonical rename runtime
   - 不把 `LEGACY_ALIAS_REGISTRY` 当作必须 shipped 的主交付，除非本 phase 同时真的引入新 canonical verb

4. **把 error-body work写成“convergence plan”，不要写成孤立 helper**
   - 先说明 `system.error` 与 per-verb response error 的关系
   - 再决定本 phase 是只加 helper/spec，还是连 `tool/context/skill` response schemas 一起迁

5. **把 runtime phase 改写成真实 use-site 导向**
   - target `buildIngressContext()`
   - target `buildCrossSeamAnchor()` / `ensureWsHelper()`
   - target `persistCheckpoint()` / `restoreFromStorage()` / `wsHelperStorage()`
   - target `initial_context` 的 validated capture seam
   - 不再使用 `tenantIngressVerify` / `state.storage.*` / `contextCore.ingestFromUpstream()` 这类虚构或 future-only 名称作为 closure proof

6. **先修 baseline，再谈 version bump**
   - 先把 `session-do-runtime` 的 `package.json` / `CHANGELOG` baseline 讲清楚
   - 再决定最终是 `0.2.x → 0.3.0` 还是别的 owner-aligned 版本切点

---

## 10. Final recommendation

我的收口意见是：

- **同意 Opus 对 B9 必要性的判断**
- **不同意当前 B9 action-plan 直接进入执行**
- **建议：保留 B9 phase，不 reopen B1-B8；但在执行前先做一次 plan rewrite**

更简洁地说：

> **B9 should proceed, but not as currently written.**

如果只看方向，B9 是对的；  
如果看执行稿，B9 现在更像 **“真实问题 + 旧示例 + future seam + 少量错误 grep/path”** 的混合体。

我认为合理的 gate 是：

1. 先重写 B9，收紧到当前代码真相
2. 再执行 B9
3. **B9 收口后** 再允许 worker matrix Phase 0 开始

这比“现在直接做”更慢半步，但会明显减少一次 protocol/runtime 双层返工。
