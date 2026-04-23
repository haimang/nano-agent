# D01-D09 worker-matrix design docs reviewed by GPT

> Review date: `2026-04-23`
> Reviewer: `GPT-5.4`
> Scope: `docs/design/worker-matrix/D01-D09-*.md`
> Baseline truth:
> - `docs/plan-worker-matrix.md`
> - `docs/eval/worker-matrix/`
> - current code under `packages/*` and `workers/*`

---

## 0. Verdict

**Verdict: approve-with-revisions.**

这组 D01-D09 文档已经基本对齐当前 charter、pre-worker-matrix W3/W4/W5 真相、以及 first-wave 的 4-worker posture。它们已经明确守住了几个最重要的边界:

1. `agent.core` 是唯一 session edge / host worker。
2. `agent.core ↔ bash.core` 是 first-wave 唯一必须真实激活的 cross-worker remote loop。
3. `context.core` 与 `filesystem.core` 首波都保持 **host-local posture**，没有假装做“4 worker 全部对称远端化”。
4. `skill.core`、W1 RFC shipped upgrade、bash maturity 扩面，都仍被诚实地压在 out-of-scope。

但在进入执行前，仍有 **5 个需要吸收的设计级修订**。其中 **R1 / R2 / R3** 会直接影响实现落点或 wire legality，应该先修；**R4 / R5** 属于 P5 hygiene/doc-truth 修订，也应在对应执行前吸收。

---

## 1. 总体评价

### 1.1 成立的部分

这套设计最强的地方，是它已经不再把 worker-matrix 写成“重新发明 4 个 worker”，而是稳定地收敛到了 **assembly + absorption over frozen shells**。这一点与当前代码真相一致：`workers/*/src/index.ts` 还是 W4 shell，真正的业务 runtime 仍主要在 `packages/*`，所以 D01-D04 把核心工作定义为 **runtime ownership 迁移** 是对的。

同时，P2 也不再被写成抽象“中期 glue”，而是被压成三个真实缺口：

1. default composition 现在还是空 handle bag；
2. `initial_context` wire 已 shipped，但 host consumer 仍缺；
3. `agent↔bash` service binding seam 已存在，但还没被默认 transport 激活。

这三个点与当前代码完全一致：`createDefaultCompositionFactory()` 仍返回全 `undefined` handle bag，`makeRemoteBindingsFactory()` 仍把 `kernel/workspace/eval/storage` 留空，`dispatchAdmissibleFrame()` 的 `session.start` 分支当前仍只抽 `turn_input`，不消费 `body.initial_context`。

### 1.2 没有出现的 scope creep

本轮 design set 没有重新引入以下错误方向，这一点值得明确肯定：

| 项目 | 当前 design 处理 | 评语 |
|---|---|---|
| `skill.core` | 保持 reserved + deferred | 正确 |
| W1 RFC shipped 化 | 继续 direction-only | 正确 |
| `context.core` 默认 compact | 明确维持 opt-in | 正确 |
| `filesystem.core` remote RPC | 明确不做 | 正确 |
| bash 扩到 browser/python/sqlite/mutating git | 明确不做 | 正确 |
| “4 worker 全远端对称化” | 明确拒绝 | 正确 |

---

## 2. 需要吸收的修订

### R1. D05 / D06 对 `assembler` 落点写错了，当前 design set 自己内部不一致

**问题**

D05 把 host consumer 写成直接调用 `this.composition.assembler`，D06 也沿用了这一前提；但当前代码真相里，composition bag 只有 `workspace` handle，没有独立 `assembler` handle，而 `assembler` 当前是在 `workspace` 组合对象内部。

**证据**

1. D05 把 consumer 写成“通过 composition 拿到 assembler handle, 调 `appendInitialContextLayer(assembler, body.initial_context)`”，并在示例里直接写 `this.composition.assembler`：`docs/design/worker-matrix/D05-initial-context-host-consumer.md:167-177,261-282`
2. D06 也把 `this.composition.assembler` 当成既定结果：`docs/design/worker-matrix/D06-default-composition-and-remote-bindings.md:189-197`
3. 当前 `SubsystemHandles` 只有 `kernel / llm / capability / workspace / hooks / eval / storage / profile`：`packages/session-do-runtime/src/composition.ts:42-57`
4. 当前 runtime 里真正暴露 `assembler` 的是 `WorkspaceCompositionHandle`，它挂在 `workspace` handle 下面：`packages/session-do-runtime/src/workspace-runtime.ts:32-43,75-100`

**判断**

这是一个 **实现落点级别** 的 design drift。若不修，D05 会把 consumer 接到一个当前 design set 并未一致定义的字段上。

**建议**

两种路径选一种并全套统一：

1. **推荐**：不新增顶层 handle，D05/D06 改为显式依赖 `WorkspaceCompositionHandle.assembler`，即 `this.subsystems.workspace`/等价 workspace handle 内的 `assembler`。
2. 若坚持顶层 `assembler`，则 D06 必须先把 `SubsystemHandles` 与所有 composition 文档统一扩为显式 `assembler` handle，而不是只在 D05 局部假设。

---

### R2. D05 的错误路径写成了 `system.error`，这不符合当前 `nacp-session` 9-kind stream reality

**问题**

D05 多处要求 `appendInitialContextLayer` 失败时回 `system.error`。但当前 `session.stream.event` 合法 kind 里没有 `system.error`，只有 `system.notify` 且 `severity: "error"`。

**证据**

1. D05 边界与功能说明多次写成 `system.error`：`docs/design/worker-matrix/D05-initial-context-host-consumer.md:195-199,250-255,267-274,315-320`
2. 当前 `SessionStreamEventBodySchema` 的 9 个 kind 只包含 `system.notify`，不包含 `system.error`：`packages/nacp-session/src/stream-event.ts:58-81,85-96`
3. 当前 session runtime 的已有错误通知 use-site 也都是 `system.notify`：`packages/session-do-runtime/src/orchestration.ts:324,403,441`

**判断**

这是一个 **wire legality** 问题，不只是表述问题。若照 D05 当前文字实现，会重新引入一个非法 stream kind。

**建议**

把 D05 全文中的 `system.error` 改成合法的 `system.notify` 错误形态，例如：

```ts
{ kind: "system.notify", severity: "error", message: "..." }
```

并把 “honest error” 的重点放在 **不 silent / 不崩 DO / client 可诊断**，而不是自造新 kind。

---

### R3. D02 对 bash-core entry 的 ingress 还留着 `/tool.call.request` 说法，和当前 transport truth 不够对齐

**问题**

D02 的 F3 仍把 `workers/bash-core/src/index.ts` 写成 “`/tool.call.request` POST endpoint 或 service-binding handler”。这和当前 capability remote seam 的真实 transport 约定不够一致，容易把实现带向一个没必要的 HTTP ingress 变体。

**证据**

1. D02 F3 写了 “`/tool.call.request` POST endpoint 或 service-binding handler”：
   `docs/design/worker-matrix/D02-bash-core-absorption.md:281-293`
2. D02 文档自己后面也已经把这件事提成未决问题，并倾向 “仅 through service binding, 不开 HTTP ingress”：
   `docs/design/worker-matrix/D02-bash-core-absorption.md:422`
3. 当前 agent 侧 remote binding glue 实际调用的是 `/capability/call` 与 `/capability/cancel`：
   `packages/session-do-runtime/src/remote-bindings.ts:205-229`
4. 当前 capability runtime 的 `ServiceBindingTransport` 语义是“transport carries `tool.call.*` bodies”，不是“worker 对外暴露 `/tool.call.request` HTTP API”：
   `packages/capability-runtime/src/targets/service-binding.ts:51-84`

**判断**

这不是大范围 scope 问题，但会直接影响 bash-core worker entry 的实现形状。当前 design set 应该把这一点冻结干净，而不是保留两种入口说法。

**建议**

把 D02 明确收口为：

1. **binding-first, no extra public HTTP RPC surface**
2. service-binding worker entry 兼容的内部 path 固定对齐当前 glue：`/capability/call` / `/capability/cancel`
3. `tool.call.*` 仍然是 **body schema**，不是 bash-core 对外 HTTP 路径命名

---

### R4. D08 对 `.npmrc` readiness 的表述过满，当前仓库并没有 root `.npmrc`

**问题**

D08 把 `.npmrc` scope 写成了 “W2 + W4 已就绪”，并多处把 repo root `.npmrc` 当成现成输入。但当前仓库里并没有 `/workspace/repo/nano-agent/.npmrc`。

**证据**

1. D08 把 `.npmrc` scope 写成 “W2 + W4 已就绪”：
   `docs/design/worker-matrix/D08-published-path-cutover.md:52`
2. D08 还把 repo root `.npmrc` 当作输入前提：
   `docs/design/worker-matrix/D08-published-path-cutover.md:164-166,294`
3. 当前仓库没有 root `.npmrc`
4. 当前真实可见的 registry config 来源是：
   - `packages/nacp-core/package.json` / `packages/nacp-session/package.json` 的 `publishConfig.registry`
   - `dogfood/nacp-consume-test/.npmrc`
   - GitHub Actions `setup-node` / `NODE_AUTH_TOKEN`

**判断**

这属于 **P5 hygiene truth** 的过度预设。它不会推翻 D08 的总体方向，但会让 cutover 执行者误以为 root `.npmrc` 已存在。

**建议**

把 D08 改成：

1. 当前事实是 **root `.npmrc` 未落仓**
2. cutover PR 需要验证 **pnpm/CI 现有 registry resolution 是否已足够**
3. 仅当实际安装路径需要时，才在 root 或 worker 侧补 `.npmrc`

不要把“可能需要补 `.npmrc`”写成“已经就绪”。

---

### R5. D09 假设每个 Tier B package 都能做 README + CHANGELOG 双改，但当前并不成立

**问题**

D09 把 deprecation PR 固定成“每个 package 只改 README + CHANGELOG”。但当前并不是所有 Tier B package 都有 `CHANGELOG.md`。

**证据**

1. D09 明确把 deprecation surface 固定成 README + CHANGELOG：`docs/design/worker-matrix/D09-tier-b-deprecation-protocol.md:45-46,119,192-199`
2. 当前 packages 下确实都有 README，但并不是每个 Tier B 都有 CHANGELOG：
   - 有 CHANGELOG：`session-do-runtime / hooks / eval-observability / storage-topology / workspace-context-artifacts / context-management / llm-wrapper`
   - 缺 CHANGELOG：`agent-runtime-kernel / capability-runtime`

**判断**

这是一个 **protocol completeness** 问题。若不修，D09 的“一包一 PR 模板”会在首批 agent-runtime-kernel / capability-runtime deprecation 时卡住。

**建议**

把 D09 改成以下二选一之一：

1. **更稳妥**：允许 README-only deprecation，对缺 `CHANGELOG.md` 的包不强制补历史 changelog。
2. 若坚持双改，则先在 protocol 里写清：**没有 CHANGELOG 的包先补最小 CHANGELOG stub，再执行 deprecation PR**。

---

## 3. 分文档审查结论

| 文档 | 结论 | 说明 |
|---|---|---|
| D01 agent-core absorption | **approve** | P1.A 的 owner/migration posture 清楚，和 W3/W4/W5 truth 对齐良好 |
| D02 bash-core absorption | **approve with clarification** | 整体方向正确，但 ingress/path 应冻结到 binding-first / `/capability/call` truth |
| D03 context-core absorption | **approve** | C1+C2 + compact opt-in + thin substrate 判断都正确 |
| D04 filesystem-core absorption | **approve** | D1+D2 + host-local posture + tenant-law 保持都正确 |
| D05 initial_context consumer | **revise** | `assembler` 落点与错误 stream kind 都需修 |
| D06 composition + remote bindings | **revise** | 与 D05 的 assembler seam 需要统一；其余核心判断正确 |
| D07 agent↔bash activation | **approve** | first-wave 唯一 remote loop 的定位正确，P2.E0 / fallback seam 也对 |
| D08 published-path cutover | **revise** | `.npmrc` readiness 需要按当前仓库事实收紧 |
| D09 tier-b deprecation | **revise** | deprecation protocol 需覆盖“无 CHANGELOG 的包” |

---

## 4. 对 charter / code truth 的总体对齐判断

### 4.1 可以支持 4-worker 基本架构吗

**可以。**

原因不是它让 4 个 worker 在 P1-P5 全部变成“对等远端服务”，而是它正确支持了当前 charter 真正要证明的 first-wave 架构：

1. `agent.core` 作为唯一 host/session edge；
2. `bash.core` 作为唯一必须 battle-test 的 remote execution seam；
3. `context.core` / `filesystem.core` 作为真实吸收目标与 owner，而不是强行 remoteize；
4. P5 把 cutover / deprecation 明确留在 hygiene 层，不和 runtime closure 搅在一起。

### 4.2 可以支持基本功能验证吗

**可以，但前提是先吸收 R1-R5。**

其中最关键的是：

1. **R1** 关系到 `initial_context` 到底接到哪里；
2. **R2** 关系到 session stream legality；
3. **R3** 关系到 bash-core entry 的实际实现路径；
4. **R4 / R5** 则关系到 P5 执行时不会被文档自身的假设绊住。

---

## 5. 最终结论

这组 D01-D09 design docs 的大方向是 **成立的**，而且比旧 worker-matrix 口径更接近当前代码现实：它们已经接受了 **非对称 first-wave**、**host-local context/filesystem**、**agent↔bash 唯一 remote seam**、以及 **P5 hygiene 独立化** 这些关键 trade-off。

因此，我不给出 `changes-requested` 级别的整体否决；但我也不建议把它们原样视为可直接执行的最终版本。更准确的结论是：

> **可以作为 worker-matrix 执行输入，但应先吸收 R1-R5 五个定点修订，再进入按 D01-D09 拆 phase 实施。**

吸收完这五点后，我认为这套 design set 已足以支撑：

1. 4-worker first-wave 基本架构落地；
2. `initial_context` + `tool.call` 两条 P2 关键闭环验证；
3. P3/P4 posture 的诚实实现；
4. P5 cutover / deprecation 的 release hygiene 收口。
