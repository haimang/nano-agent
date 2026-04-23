# W1 Closure — Cross-Worker Protocol Design

> 阶段: `pre-worker-matrix / W1`
> 状态: `closed`
> 作者: `GPT-5.4`
> 时间: `2026-04-22`
> 对应 action-plan: `docs/action-plan/pre-worker-matrix/W1-cross-worker-protocols.md`
> 对应 design: `docs/design/pre-worker-matrix/W1-cross-worker-protocols.md`

---

## 1. 结论

W1 已达到 action-plan 约定的关闭条件。

这轮工作没有 ship 任何协议代码；它真正完成的是：**把 future workspace RPC、remote compact delegate、evidence forwarding 三条 cross-worker seam 收束成 3 份 directionally-frozen RFC，并与 W0 shipped truth、W3 blueprint、W5 closure predicate 对齐。**

---

## 2. 实际交付

### 2.1 RFC 交付物

1. `docs/rfc/nacp-workspace-rpc.md`
2. `docs/rfc/remote-compact-delegate.md`
3. `docs/rfc/evidence-envelope-forwarding.md`

### 2.2 关键 reality 结论

1. **workspace seam**：今天存在真实 `WorkspaceNamespace` / mount / backend substrate，但没有已 shipped 的 `workspace.fs.*` NACP family；因此 W1 只冻结未来方向，不提前代码化。
2. **remote compact seam**：未来 remote compact delegate 继续复用 canonical `context.compact.request/response`；执行位置变化不构成新协议 family。
3. **evidence forwarding seam**：远端 evidence forwarding 继续复用 `audit.record` 作为 carrier，payload truth 保持 W0 shipped 的 `EvidenceRecord` / `EvidenceAnchorSchema`。

### 2.3 cross-doc 收口

1. `docs/design/pre-worker-matrix/W1-cross-worker-protocols.md` 已翻转到 executed 状态
2. `docs/action-plan/pre-worker-matrix/W1-cross-worker-protocols.md` 已翻转到 executed 状态
3. `docs/design/pre-worker-matrix/W3-absorption-blueprint-and-dryrun.md` 的 W1 依赖口径已改成 **3 份 RFC shipped**
4. `docs/design/pre-worker-matrix/W5-closure-and-handoff.md` 已把 W1 closure 纳入 future diagonal check 的 evidence input

---

## 3. In-Scope / Out-of-Scope verdict

| 项目 | 结果 | 说明 |
|---|---|---|
| compact reality 核对 | `done` | 已确认复用现有 `context.compact.*` 足够 |
| audit / evidence reality 核对 | `done` | 已确认复用 `audit.record` + W0 EvidenceRecord truth |
| workspace substrate reality 核对 | `done` | 已以 namespace / backend / capability 路径为 RFC anchor |
| workspace RFC revise / verify | `done` | 已形成 executed directional RFC |
| compact delegate RFC revise / verify | `done` | 已明确“不新增 family” |
| evidence forwarding RFC revise / verify | `done` | 已明确“不新增 family / helper” |
| W1 closure | `done` | 已生成本文件 |
| message schema / matrix / helper / code ship | `not-done-by-design` | 明确 out-of-scope |

---

## 4. 验证结果

### 4.1 代码 reality 对照

本轮按 action-plan 的 RFC-only 定位，执行的是 **文档/代码对照**，不是代码测试。实际核对的 shipped reality：

1. `packages/nacp-core/src/messages/context.ts`  
   - 证明 `context.compact.request/response` 已存在，且 role gate 足以支撑 remote compact delegate
2. `packages/nacp-core/src/messages/system.ts`  
   - 证明 `audit.record = { event_kind, ref?, detail? }` 已存在，可作为 evidence forwarding carrier
3. `packages/nacp-core/src/evidence/vocabulary.ts` + `src/evidence/sink-contract.ts`  
   - 证明 W0 已冻结 EvidenceRecord / EvidenceAnchor / sink-facing contract truth
4. `packages/workspace-context-artifacts/src/namespace.ts`  
   - 证明 workspace today 的 substrate 是 namespace/mount/backend truth，而不是 shell/POSIX truth
5. `packages/session-do-runtime/src/workspace-runtime.ts`  
   - 证明 live runtime 已有 workspace evidence wiring，可为 forwarding RFC 提供 current sink anchor

### 4.2 文档一致性对照

已完成以下 cross-doc consistency 核查：

1. W1 RFC ↔ W0 shipped truth  
   - evidence forwarding RFC 不再定义第二套 evidence payload
2. W1 action-plan ↔ W1 design  
   - 二者均保持 RFC-only 口径
3. W1 ↔ W3  
   - W3 只消费 W1 RFC 作为 blueprint reference，不期待 W1 code ship
4. W1 ↔ W5  
   - W5 diagonal check 已显式把 W1 closure 作为 future evidence input

---

## 5. 遗留项与后续交接

### 5.1 已明确不在 W1 收口的项目

1. `workspace.fs.*` message schema / registry / matrix registration
2. `createRemoteCompactDelegate` 或等价 helper
3. `wrapEvidenceAsAudit` / `extractEvidenceFromAudit` helper
4. 任何 root contract tests / e2e tests / deploy activity
5. 任何 version bump / CHANGELOG ship 行为

### 5.2 对下游阶段的直接价值

1. **W2** 不需要等待 W1 协议代码；W1 已明确自己是 RFC gate，不是 publish gate
2. **W3** 可以直接把 3 份 RFC 当成 future cross-worker reference baseline
3. **W4** 不必在 shell/scaffold 阶段猜测 compact/evidence/workspace 的远端语义
4. **W5** 可以把 W1 closure + 3 份 RFC 一起纳入 final handoff pack
5. **worker-matrix 后续 phase** 可以基于 live loop evidence 再决定哪些 RFC 真正代码化

---

## 6. 最终 verdict

W1 可以关闭，并且应被视为 pre-worker-matrix 中**方向冻结而非代码交付**的一环已经兑现：**future cross-worker seam 的 baseline 已明确，但我们没有为了“先有文档”而提前发明第二套 compact、evidence 或 workspace 私有协议。**
