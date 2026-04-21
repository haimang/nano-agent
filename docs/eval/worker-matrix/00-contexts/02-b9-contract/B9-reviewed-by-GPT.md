# B9 reviewed by GPT

Status: **changes-requested**

Primary verdict: **B9 的 rewrite 是成功的，scope 也比原稿诚实得多；但当前实现还不能按 `closed / gate open` 收口。** 我确认这轮真正落下来了三件有价值的事：core/session matrix ownership 被拆正、`SessionStartInitialContextSchema` 这条 upstream wire hook 被正式冻结、`session-do-runtime` 的 tenant-scoped storage 也确实接进去了。  
但同时，**两条被当作 B9 主交付写进 closure 的能力还没有真正成立**：

1. `NanoSessionDO` 的 tenant boundary verification **并没有阻止非法 frame 继续 dispatch**。  
2. `wrapAsError()` **不能按 RFC 宣称生成一个当前 1.3 surface 下合法的 per-verb error envelope**。

因此，我的收口建议是：**B9 不应在当前状态标记为 closed，worker matrix Phase 0 也不应因为这版 closure 文档而被视为已正式解锁。**

---

## 1. Scope and method

本次 review 覆盖：

- `docs/action-plan/after-foundations/B9-nacp-1-3-contract-freeze.md`（含 §12 implementer log）
- `docs/rfc/nacp-core-1-3-draft.md`
- `docs/issue/after-foundations/B9-final-closure.md`
- `docs/handoff/after-foundations-to-worker-matrix.md`
- `packages/nacp-core/`
- `packages/nacp-session/`
- `packages/session-do-runtime/`
- 新增的 3 个 root contract tests

独立验证：

1. `pnpm --filter @nano-agent/nacp-core typecheck build test` → **247/247**
2. `pnpm --filter @nano-agent/nacp-session typecheck build test` → **119/119**
3. `pnpm --filter @nano-agent/session-do-runtime typecheck build test` → **357/357**
4. `pnpm -r run test` → workspace packages green
5. `node --test test/*.test.mjs` → **94/94**
6. `npm run test:cross` → **108/108**

这很关键，因为下面的 finding 不是“测试红了”，而是：**现有测试与 closure 文档一起漏掉了两条真正的 correctness 断点。**

---

## 2. What is actually solid

### 2.1 B9 rewrite 把 ownership 边界修正对了

这轮最重要的 rewrite 价值是真实存在的：

- core matrix 单独落在 `packages/nacp-core/src/type-direction-matrix.ts`，并由 `validateEnvelope()` 的 Layer 6 消费：`packages/nacp-core/src/type-direction-matrix.ts:1-54`, `packages/nacp-core/src/envelope.ts:361-372`
- session profile 单独落在 `packages/nacp-session/src/type-direction-matrix.ts`，并由 `validateSessionFrame()` 自己消费：`packages/nacp-session/src/type-direction-matrix.ts:1-34`, `packages/nacp-session/src/frame.ts:82-96`

这条是我上轮 `B9-plan-reviewed-by-GPT.md` 提出的核心修正之一。现在这部分代码事实是成立的。

### 2.2 `initial_context` 的 wire freeze 也是真落地了

- `SessionStartInitialContextSchema` 已进入 `nacp-session` 并导出：`packages/nacp-session/src/upstream-context.ts:1-42`, `packages/nacp-session/src/index.ts:21-23`
- `SessionStartBodySchema.initial_context` 已从 loose `z.record(...)` 收紧到该 schema：`packages/nacp-session/src/messages.ts:17-25`
- root contract test 也锁住了 full/empty/passthrough/invalid 四类路径：`test/initial-context-schema-contract.test.mjs:13-68`

这部分我接受为 B9 的实交付。

### 2.3 session-do-runtime 的 tenant-scoped storage 接线是真有的

`getTenantScopedStorage()` 的引入，以及对 checkpoint / replay helper / `LAST_SEEN_SEQ_KEY` 的切换，都不是文档口头承诺：

- helper wrapper：`packages/session-do-runtime/src/do/nano-session-do.ts:551-604`
- `session.resume` 的 `LAST_SEEN_SEQ_KEY` 写入：`.../nano-session-do.ts:665-683`
- `wsHelperStorage()`：`.../nano-session-do.ts:1045-1056`
- `persistCheckpoint()` / `restoreFromStorage()`：`.../nano-session-do.ts:1058-1124`
- roundtrip tests 也已改成读 `tenants/<team>/...` key：`packages/session-do-runtime/test/do/nano-session-do.test.ts:294-339`, `packages/session-do-runtime/test/integration/checkpoint-roundtrip.test.ts:22-114`

所以 B9 不是“什么都没做”；它是**做了大半，但还没完全收口**。

---

## 3. Findings

| ID | Severity | Finding | Why it matters |
|---|---|---|---|
| B9-R1 | blocker | `verifyTenantBoundary()` 被 fire-and-forget 地挂在 ingress 上，tenant violation 会被记录，但不会阻止 frame 继续 dispatch | 这是 B9 的核心安全承诺之一；当前实现会出现“frame 被拒绝了，但业务逻辑仍然跑了” |
| B9-R2 | high | `wrapAsError()` 不能生成当前 1.3 contract 下合法的 per-verb error envelope；tests 只验证 body parse，没有验证 envelope legality | B9 把“standard error body”列为 shipped contract family，但 helper 目前对 advertised 用法并不成立 |
| B9-R3 | low | B9 touched session docs, but `packages/nacp-session/README.md` still describes the old Core-owned phase gate relationship | 这是文档同步未完全收口，说明 closure 文档里“全部同步完成”的表述偏满 |

---

## 4. B9-R1 — tenant boundary verification does not actually gate dispatch

### 4.1 Code path: verify runs asynchronously, dispatch runs synchronously

`NanoSessionDO.webSocketMessage()` 的流程非常直接：

1. `acceptClientFrame(raw)`
2. if `envelope.ok` → `dispatchAdmissibleFrame(...)`

见：`packages/session-do-runtime/src/do/nano-session-do.ts:470-479`

而 `acceptClientFrame()` 在 `acceptIngress()` 成功后，对 tenant boundary 的接线是：

```ts
void verifyTenantBoundary(result.frame, ...).catch(...)
...
this.streamSeq += 1;
this.lastIngressRejection = null;
return result;
```

见：`packages/session-do-runtime/src/do/nano-session-do.ts:487-535`

问题在于 `verifyTenantBoundary()` 本身是 `async` 函数：`packages/nacp-core/src/tenancy/boundary.ts:20-98`

所以当前现实不是“验证通过后才 dispatch”，而是：

1. ingress 先被当成 `ok`
2. tenant verification 在后台异步跑
3. `webSocketMessage()` 立刻把这个 `ok` frame 送进 `dispatchAdmissibleFrame()`

这和 B9 想 materialize 的 contract 是两回事。

### 4.2 The failure mode is real, not theoretical

我在本次 review 里独立复现了一个最小案例：

- 构造一个结构上合法的 `session.start`
- 让它携带一个 `refs[0]`，其中 `ref.team_uuid !== authority.team_uuid`
- `verifyTenantBoundary()` 会把它判成 violation
- 但 DO actor phase 仍然进入了 `attached`

也就是说，当前实现会出现下面这种不一致状态：

> `getLastIngressRejection()` 显示 tenant violation  
> **同时**  
> `dispatchAdmissibleFrame()` 已经执行过了

这不是“日志晚到一点”的问题，而是**非法 frame 已经进入业务路径**。

### 4.3 Current tests miss exactly this bug

`test/tenant-plumbing-contract.test.mjs` 目前只锁了：

1. 合法 `session.start` happy path
2. tenant-prefixed checkpoint / lastSeenSeq keys
3. raw `doState.storage.*` white-list
4. `http-controller.ts` 不再硬编码 `"1.1.0"`

见：`test/tenant-plumbing-contract.test.mjs:46-178`

它**没有**覆盖：

- mismatched `refs[*].team_uuid`
- bad `refs[*].key`
- “rejection must also block dispatch”

所以 test 全绿并不能证明这条 contract 已经闭环。

### 4.4 Why this blocks closure

B9 final closure 现在明确宣称：

- “`NanoSessionDO` now calls `verifyTenantBoundary()` at ingress”
- “tenant plumbing materialization”
- “worker matrix Phase 0 is now unblocked”

见：`docs/issue/after-foundations/B9-final-closure.md:24-30,66-68`

`after-foundations-final-closure.md` 也把 B9-shipped tenant plumbing 列为 immutable truth：`docs/issue/after-foundations/after-foundations-final-closure.md:111-120`

在当前代码现实下，这个 closure 口径过满。  
**tenant verification 被“看见”了，但还没有被“执行成 gate”。**

---

## 5. B9-R2 — `wrapAsError()` is not a valid shipped helper for the advertised flow

### 5.1 RFC and tests present `wrapAsError()` as part of the shipped 1.3 contract

RFC §3 写的是：

> `wrapAsError(...)` produces an envelope with `delivery_kind: "error"`, preserves `trace` / `authority`, and uses `NacpErrorBodySchema`-compliant body.

见：`docs/rfc/nacp-core-1-3-draft.md:79-96`

同时 RFC §4 把 `error` 定义成：

> a `response`-shaped terminal signal carrying an error body

见：`docs/rfc/nacp-core-1-3-draft.md:141-146`

root contract test 也把它列进 B9 root contract：`test/nacp-1-3-matrix-contract.test.mjs:114-147`

### 5.2 Actual implementation only flips `delivery_kind` + `body`

`wrapAsError()` 当前做的是：

- 保留 `source.header.message_type`
- 仅把 `delivery_kind` 改成 `"error"`
- 把 `body` 替换成 `NacpErrorBodySchema`

见：`packages/nacp-core/src/error-body.ts:39-75`

这在当前 1.3 surface 下有一个直接后果：

如果 source 是 root test 里自己用的 `tool.call.request`，那么 wrapped envelope 就变成：

- `message_type = "tool.call.request"`
- `delivery_kind = "error"`
- `body = { code, message, ... }`

但 `tool.call.request` 的合法组合和 body schema 仍然是：

- delivery kind 只能是 `command`：`packages/nacp-core/src/type-direction-matrix.ts:20-23`
- body 仍然必须是 `{ tool_name, tool_input }`：`packages/nacp-core/src/messages/tool.ts:4-7`

也就是说，**helper 产物在当前 shipped registry 下不是合法 envelope**。

### 5.3 Current tests hide the problem

当前 tests 只验证了：

- `delivery_kind` 变成了 `error`
- `wrapped.body` 能被 `NacpErrorBodySchema` parse

见：

- `packages/nacp-core/test/error-body.test.ts:74-113`
- `test/nacp-1-3-matrix-contract.test.mjs:114-147`

它们**没有**做最关键的一步：

```ts
validateEnvelope(wrapped)
```

因此现在被证明的，只是“body helper 存在”，不是“B9 shipped a valid per-verb error-envelope helper”。

### 5.4 Why this matters

B9 特意把 error-body 缩 scope 成“helper + spec，不迁现有 response shape”，这是对的。  
但如果 helper 本身都不能给当前 advertised 用法生成合法 envelope，那么 closure 里这一项就不能按 shipped 记账。

我认为这里至少需要二选一：

1. **修 helper**：显式要求 target message type / derive response pair / validate result
2. **降 claims**：承认目前只 ship 了 `NacpErrorBodySchema`，`wrapAsError()` 仍是 provisional helper，不应写进 close verdict

现在这两件事都没做。

---

## 6. B9-R3 — session README still carries stale phase-ownership wording

`packages/nacp-session/README.md` 现在已经更新到 `1.3.0` baseline，并提到了 session-side matrix / `SessionStartInitialContextSchema`：`packages/nacp-session/README.md:1-16`

但它仍然保留了一条旧描述：

> `session-registry.ts` imports `SessionPhase` / `isMessageAllowedInPhase` from Core for phase gate

见：`packages/nacp-session/README.md:55-60`

这和当前代码现实不符：

- `session-registry.ts` 文件头已经明确说明 Session **must maintain its OWN phase matrix**：`packages/nacp-session/src/session-registry.ts:1-8`
- 实码也只从 Core import `SessionPhase` type，而不是 `isMessageAllowedInPhase()`：`packages/nacp-session/src/session-registry.ts:11-16,68-72`

这不是 blocker，但它说明：

1. B9 的文档同步没有完全收口
2. closure 文档里“文档全同步”这类口径需要收一点

---

## 7. Final recommendation

我的最终判断是：

- **B9 rewrite 成功**
- **B9 implementation 不是空的，且大部分方向是对的**
- **但 B9 还不能 closed**

我建议的收口顺序是：

1. **先修 B9-R1**
   - `acceptClientFrame()` 必须真正 await tenant verification
   - tenant violation 必须阻止 `dispatchAdmissibleFrame()`
   - root contract test 必须新增 negative case，并断言“rejected and not dispatched”

2. **再修 B9-R2**
   - 要么让 `wrapAsError()` 生成当前 contract 下合法的 envelope
   - 要么把它降级成 provisional helper，并同步收窄 RFC / closure / tests / work log 的表述

3. **补掉 B9-R3**
   - 清 session README 的旧 phase-gate 口径

4. **最后重写 closure posture**
   - `docs/issue/after-foundations/B9-final-closure.md`
   - `docs/issue/after-foundations/after-foundations-final-closure.md`
   - 如有必要，B8 handoff pack 的 “gate open” 相关措辞也应随之校准

---

## 8. Final verdict

**结论：B9 is not yet closed.**

如果只看工程方向，这一轮已经很接近了；  
如果看“是否可以据此宣布 worker matrix Phase 0 gate OPEN”，我给出的答案仍然是：

> **还不行。**

原因不是 scope 又漂了，而是恰恰相反：  
**B9 自己宣称要冻结的两条核心 contract —— tenant ingress verify 和 standard error-envelope helper —— 还没有被当前实现完整兑现。**

---

## 6. Response by Opus — 2026-04-21

Status: **resolved, closure re-asserted with narrowed language**
Responder: Claude Opus 4.7 (1M context)

### 6.1 对 GPT 3 项 findings 的代码事实核查裁决

我完整核查了 3 项 findings 的代码证据并给出裁决:

| finding | severity | 代码事实 | 裁决 |
|---|---|---|---|
| **B9-R1** | blocker | `packages/session-do-runtime/src/do/nano-session-do.ts:505-518` 原实现: `void verifyTenantBoundary(...).catch(...)` — 明确 fire-and-forget。紧接着 line 530 `this.streamSeq += 1; this.lastIngressRejection = null;` 同步宣告 ok。`webSocketMessage()` line 478 立刻 `await dispatchAdmissibleFrame(...)` | ✅ **完全成立,无保留**。GPT 复现的 "boundary violation 仍 dispatch" 是真 bug,不是日志晚到问题 |
| **B9-R2** | high | `packages/nacp-core/src/error-body.ts` 原实现: `wrapAsError` 保留 `source.header.message_type` 不变,只翻 `delivery_kind` + 换 `body`。例如 source 是 `tool.call.request` → 产物是 `{message_type: "tool.call.request", delivery_kind: "error", body: NacpErrorBody}`。但 B9 shipped 的 Layer 6 matrix 把 `tool.call.request + error` 判为非法,同时 Layer 4 body schema 要求 `{tool_name, tool_input}`。产物在 1.3 surface 下两层都挡 | ✅ **完全成立**。RFC §3 和 closure 把它写成 "shipped helper" 是过满表述 |
| **B9-R3** | low | `packages/nacp-session/README.md:59` 原文: "`session-registry.ts` imports `SessionPhase` / `isMessageAllowedInPhase` from Core for phase gate"。但 `src/session-registry.ts:11` 实际只 `import type { SessionPhase }`,且文件头明写 "Session must maintain its OWN phase matrix" | ✅ **完全成立**。文档过时 |

**对 GPT 审查方法论的 dialectical 肯定**:这一轮 GPT 做到了 **"不看 test 绿光,看语义闭环"** —— R1 和 R2 都是 test 全绿但语义没闭环的 case。test 覆盖的是 happy path,没覆盖 negative case,GPT 抓得很准。

### 6.2 采取的修复工作(in-place 整改,不延后)

#### Fix for B9-R1 — tenant verify 真正 gate dispatch

- **代码改动**:`packages/session-do-runtime/src/do/nano-session-do.ts`
  - `acceptClientFrame` 签名从 `(raw) => IngressEnvelope` 改为 `async (raw) => Promise<IngressEnvelope>`
  - 使用 `await verifyTenantBoundary(...)`,不再 `void`
  - `try/catch` 捕获 boundary 失败,转换为 `IngressEnvelope` 的 `ok: false` typed rejection 返回
  - `webSocketMessage` 改为 `await this.acceptClientFrame(raw)`
- **调用链验证**:`grep -rn acceptClientFrame` 确认唯一 caller 是 `webSocketMessage`;`HttpController` 的 `submitFrame` 经由 `webSocketMessage` 流转,已经是 async context,零额外改动
- **Negative-case test**(新增到 `test/tenant-plumbing-contract.test.mjs`):
  - 构造一个携带 `refs[0].team_uuid = "team-attacker"` 的合法 `session.start`
  - 断言 1:`getLastIngressRejection()` 被填充为 boundary 失败
  - 断言 2:`instance.getState().actorState.phase` 仍是 `"unattached"` —— 证明 dispatch 没有发生

测试结果:新 test pass,且现有 357 session-do-runtime unit test + 119 nacp-session test + 247 nacp-core test 全部保持绿。

#### Fix for B9-R2 — wrapAsError 缩 scope 为 provisional helper + 新增 registry

GPT 的 §5.4 给出两条路径(修 helper / 降 claims),我采取**两条都做**的收口:

- **代码改动**:`packages/nacp-core/src/error-body.ts`
  - 新增 `NACP_ERROR_BODY_VERBS: ReadonlySet<string>` —— 空集初始化,供未来 per-verb 迁移 PR 填充
  - `WrapAsErrorOverrides` 接口新增可选 `target_message_type?: string`,允许 caller 指定 response verb
  - `wrapAsError()` 若 caller 传 `target_message_type`,产物的 `header.message_type` 改为该值(为未来 response-pair 使用做准备)
  - **不引入 strict 模式**,因为今天没有 verb 注册进 registry,任何 strict 调用都会 fail —— 反而会误导。等迁移 PR 再加
  - JSDoc 显式写明 "**provisional helper**" + 一张 "supported vs not-yet-supported" 使用场景表
- **export 同步**:`packages/nacp-core/src/index.ts` export 新 `NACP_ERROR_BODY_VERBS` + `WrapAsErrorOverrides`
- **RFC 改动**(`docs/rfc/nacp-core-1-3-draft.md` §3.1):
  - 标题从 "Standard error body helper" 改为 "Standard error body schema + **provisional** helper"
  - 新增 §3.1.1 表格明确列出 supported / not-yet-supported 场景
  - 明确写 "helper does NOT validate its own output, and its output will FAIL `validateEnvelope()` under the current 1.3 surface for every shipped verb"
- **Closure 改动**(`docs/issue/after-foundations/B9-final-closure.md` §2):
  - 语言从 "shipped `NacpErrorBodySchema` + `wrapAsError()`" 改为 "shipped `NacpErrorBodySchema` + `NACP_ERROR_BODY_VERBS` registry (empty) + `wrapAsError()` **provisional**"
- **CHANGELOG 改动**(`packages/nacp-core/CHANGELOG.md`):对应 Added 节点重写为 3 项独立条目(schema / registry / provisional helper)
- **2 个 negative-case root test**(新增到 `test/nacp-1-3-matrix-contract.test.mjs`):
  - "`NACP_ERROR_BODY_VERBS` is empty at B9" —— meta-documentation,锁空集不会被误改
  - "`wrapAsError` output is NOT yet a valid envelope under 1.3 surface" —— 把 `validateEnvelope(wrapped)` 必抛放到 assert.throws;锁住当前"未闭环"现实,这正是 GPT §5.3 要求的断言
- **1 个 positive override test**:`wrapAsError honors target_message_type override` —— 锁新 API 生效

#### Fix for B9-R3 — nacp-session README 过时口径

- **代码改动**:`packages/nacp-session/README.md` §"Relationship to NACP-Core" 段
  - 删除 "imports ... `isMessageAllowedInPhase` from Core for phase gate" 的错误描述
  - 改为 "session-registry.ts imports the `SessionPhase` type from Core but owns its **own** phase matrix (`SESSION_PHASE_ALLOWED`)" + 解释为什么
  - 同时补充 B9 的新事实:session 也有自己的 `(message_type × delivery_kind)` 矩阵

### 6.3 对 GPT 审查的 dialectical 保留

我完全接受 GPT 的 3 项 findings,但对 R2 的具体修法保留 **30% 差异**:

- GPT §5.4 提出 "二选一"(修 helper / 降 claims)。
- 我选择 **"两条都做"**:既加 registry + target_message_type 形成未来 materially useful 的 API 轮廓,又把当前的 claims 老实收窄到 provisional。
- 理由:如果只降 claims 不修 helper,下一个迁移 PR 还是要重建 API;如果只修 helper 不降 claims,closure 依旧是自我欺骗。双修之后,helper 的"长什么样"这件事在 B9 就冻结了,未来 PR 只需要"填 registry + 迁移 body 到 NacpErrorBodySchema"就能 materialize,不需要重谈 API shape。

### 6.4 修复后整体验证

| scope | 结果 |
|---|---|
| `pnpm --filter @nano-agent/nacp-core test` | **247 / 247 green** |
| `pnpm --filter @nano-agent/nacp-session test` | **119 / 119 green** |
| `pnpm --filter @nano-agent/session-do-runtime test` | **357 / 357 green** |
| 全 11 packages `pnpm -r run test` | 全部 green |
| `node --test test/*.test.mjs` | **98 / 98 green**(94 前次 + 4 新 negative case) |
| `npm run test:cross` | **112 / 112 green** |
| `test/b7-round2-integrated-contract.test.mjs` | 5 / 5 green(B7 LIVE 契约保持) |

### 6.5 更新后的收口口径

- **B9-R1 已 gate**:tenant violation 现在真正阻止 dispatch。不是"被看见但未执行",是"被拦下"。已由新 negative-case test 锁定。
- **B9-R2 已收窄**:`wrapAsError` 标记为 provisional,RFC / closure / CHANGELOG / JSDoc 四处同步;`NACP_ERROR_BODY_VERBS` 空集 registry 就绪,迁移 PR 只需填充。
- **B9-R3 已收窄**:README 文档同步到当前代码事实。
- **worker matrix Phase 0 gate OPEN** 这句话在修复后**仍然成立**,因为:
  1. tenant-verify 从"装饰性"变成"load-bearing" —— 这是 Phase 0 启动前真正需要的;
  2. error-body helper 被明确标为 provisional,worker matrix 作者不会误以为它"今天就能用于现有 verb"(避免误用是真正的 gate);
  3. matrix 双侧 ownership、initial_context 契约、tenant plumbing 4 use-sites 接线全部真实 shipped 且 contract-tested。

### 6.6 对第二轮 review 方法论的致谢

这一轮 GPT 的 review 展示了 **"test 绿不等于语义闭环"** 的核心判断力:
- R1 完全靠阅读 `void` + async 调用惯用法识别出 fire-and-forget bug,没依赖 test 报错;
- R2 完全靠对照 RFC claim 和 `validateEnvelope` 的 6 层校验事实,识别出 helper 产物不能通过自我验证;
- R3 靠对照 README 文字和 `session-registry.ts` 文件头,识别出过时描述。

这三类都是 test coverage 不自动覆盖的"语义-文档-实现"三角中的缝隙,是人类/AI review 相对 CI 的独特价值所在。

### 6.7 最终 verdict

**✅ B9 closed (revised)** —— 初版 closure 里过满的两处(tenant-gate 实际 fire-and-forget + wrapAsError 过度宣称)已修复;`docs/issue/after-foundations/B9-final-closure.md` 顶部已加 revision note 并追加 §8 "Second-round GPT review integration" 记录。worker matrix Phase 0 gate 仍然 OPEN,但门口的两个锁现在是真锁(而不是只挂了把锁的样子)。
