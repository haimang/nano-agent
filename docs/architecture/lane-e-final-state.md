# Lane E — Final State

> 服务业务簇: `hero-to-pro / HP8`
> 关联 action-plan: `docs/action-plan/hero-to-pro/HP8-action-plan.md`
> 关联 design: `docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md`
> 冻结决策来源: `docs/design/hero-to-pro/HPX-qna.md` Q28
> 文档状态: `frozen`
> 闭环日期: `2026-04-30`

---

## 0. 终态判定

| 项目 | 终态 | 理由 |
|------|------|------|
| Lane E (host-local workspace residue) | **`retained-with-reason`** | filesystem-core leaf RPC 仍仅有 artifact 三件套(`workers/filesystem-core/src/index.ts:47-59,83-125`),HP6 P2 选择只在 orchestrator-core D1 truth + path normalization 层先收敛 workspace temp file;真正的 leaf-RPC 接线是 HP6/HP7 后续批次。在 leaf-RPC 接线之前,`workers/agent-core/src/host/workspace-runtime.ts` 必须继续就地构造 `ContextAssembler` / `CompactBoundaryManager` / `WorkspaceSnapshotBuilder` 三件套。**这是 retained,不是 shim**,有明确移除条件。 |

---

## 1. Retained Scope

| 维度 | 范围 |
|------|------|
| 代码 | `workers/agent-core/src/host/workspace-runtime.ts:1-101`(`composeWorkspaceWithEvidence` + `WorkspaceCompositionHandle`) |
| 引用方 | `workers/agent-core/src/host/do/session-do/runtime-assembly.ts`(每次 session DO 启动时构造一次) |
| 数据流 | `evidenceSink` → eval sink emit;`evidenceAnchor` → DO trace 上下文 |
| package | `@nano-agent/workspace-context-artifacts` 三件业务对象继续暴露给 host |
| owner | `agent-core` 主 host 文件 |

**不在 retained 范围内**(已 closed):

- HP6 P2 已落地 `D1WorkspaceControlPlane`(`workers/orchestrator-core/src/workspace-control-plane.ts`),作为 workspace temp file metadata 的 D1 SSoT。
- HP6 P2 已落地 `normalizeVirtualPath` 与 `buildWorkspaceR2Key`,固化 tenant prefix law。
- HP7 P1 已落地 `D1CheckpointSnapshotPlane`,使 snapshot lineage 不再依赖 host-local in-memory artifact store。

---

## 2. Risk Statement

| 风险 | 影响 | 缓解 |
|------|------|------|
| host-local `InMemoryArtifactStore` 在跨 turn / 跨 worker 场景下不持久 | snapshot/promotion 在 worker hibernation 后可能复活时丢失 | HP6 已把 metadata 真相迁到 D1;HP7 已把 snapshot row 迁到 D1。**真相层不再依赖 host-local**;此 retained scope 只保留 evidence 与 composition 这两件运行时副作用。 |
| evidence sink 与 trace anchor 仍由 host 构造 | 跨 worker observability 一致性看 host runtime,而不是 leaf worker | HP3 closure §4 F13 已把 observability drift 列为 partial;后续 phase 可以把 evidence emission 推到 leaf-RPC 上 |
| 误判为可立即删除 | 删除会让 HP6 P3-P4 / HP7 P1-P4 在 leaf-RPC 接线前直接断链 | 本文件即是对该误判的显式回答 |

---

## 3. Remove Condition

Lane E retained scope 在以下任意一条满足时,可降为 `closed`,**不需要新 charter,只需要新批次的 PR + 本文件 §0 终态翻新为 `closed`**:

1. `filesystem-core` 暴露完整 leaf-RPC(`readTempFile / writeTempFile / listTempFiles / deleteTempFile / readSnapshot / writeSnapshot / copyToFork / cleanup`)。
2. HP6 P2 后续批次 / HP7 P1-P4 后续批次完成 executor 接线,所有 `evidenceSink` 与 `evidenceAnchor` 的真实写入路径都经由 leaf-RPC 完成。
3. `workers/agent-core/src/host/workspace-runtime.ts` 可被删除或仅保留 trace-context shim;此时 `runtime-assembly.ts` 改为 RPC-style 调用 filesystem-core。

满足任何一条后,本文件应同步更新为 `closed`,并在 HP10 final closure 中登记。

---

## 4. Owner / Handoff

| 维度 | 值 |
|------|----|
| HP8 内 owner | hero-to-pro 主线 |
| 后续 owner(满足 §3 条件后) | HP6 / HP7 后续批次或 hero-to-platform 阶段(若 hero-to-pro 关闭时仍未 close) |
| 不允许的 hand-off 形式 | "shim"、"短期妥协"、"以后再说"、隐式 carry |

---

## 5. 与 Q28 的对齐

Q28 允许 chronic 项以 `closed / retained-with-reason / handed-to-platform` 三选一终态存在,但**禁止 silent unresolved**。本文件:

- ✅ 显式声明终态(§0):`retained-with-reason`
- ✅ 显式 scope(§1)、risk(§2)、remove condition(§3)、owner(§4)
- ✅ 写明何时升级为 `closed`,而不是无限期保留
- ✅ 不再使用 "short-term shim" / "暂时 shim" / "未来再说" 等模糊措辞
