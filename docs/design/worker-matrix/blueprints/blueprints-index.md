# Blueprints Index — worker-matrix Absorption Units

> 类型：index(P0 Phase 2 产出)
> 状态：draft
> 直接上游：
> - `docs/design/pre-worker-matrix/W3-absorption-map.md`(10 units / 4 workers 归属真相)
> - `docs/design/pre-worker-matrix/W3-absorption-pattern.md`(10 disciplines)
> - `docs/design/pre-worker-matrix/TEMPLATE-absorption-blueprint.md`(母本)

---

## 1. 用途

本 index 把 worker-matrix 涉及的 **10 个 absorption units** 映射到它们各自的 detailed blueprint。P1-P5 执行 PR 作者可以按 unit 编号在这里单次查到:

- 哪份 blueprint 是它的机械执行母本
- 该 blueprint 的来源属性(pre-worker-matrix 代表 / P0 补齐)
- 对应 worker 落点
- 关联 action-plan 阶段(P1.A / P1.B / P3 / P4)

---

## 2. 10 units × blueprint × 来源(映射表)

| unit | package 源(Tier B)| 目标 worker | blueprint 源属性 | blueprint link | 关联 action-plan |
|------|---------------------|-------------|------------------|----------------|------------------|
| **A1** | `packages/session-do-runtime`(host shell)| `workers/agent-core/src/host/` | **pre-worker-matrix 代表(optional)** | [`../../pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md`](../../pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md) | P1.A |
| **A2** | `packages/agent-runtime-kernel` | `workers/agent-core/src/kernel/` | **P0 补齐** | [`A2-agent-runtime-kernel-absorption-blueprint.md`](./A2-agent-runtime-kernel-absorption-blueprint.md) | P1.A |
| **A3** | `packages/llm-wrapper` | `workers/agent-core/src/llm/` | **P0 补齐** | [`A3-llm-wrapper-absorption-blueprint.md`](./A3-llm-wrapper-absorption-blueprint.md) | P1.A |
| **A4** | `packages/hooks` | `workers/agent-core/src/hooks/` | **P0 补齐** | [`A4-hooks-residual-absorption-blueprint.md`](./A4-hooks-residual-absorption-blueprint.md) | P1.A |
| **A5** | `packages/eval-observability` | `workers/agent-core/src/eval/` | **P0 补齐** | [`A5-eval-observability-residual-absorption-blueprint.md`](./A5-eval-observability-residual-absorption-blueprint.md) | P1.A |
| **B1** | `packages/capability-runtime` | `workers/bash-core/src/` | **pre-worker-matrix 代表** | [`../../pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md`](../../pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md) | P1.B |
| **C1** | `packages/context-management` | `workers/context-core/src/management/` | **P0 补齐** | [`C1-context-management-absorption-blueprint.md`](./C1-context-management-absorption-blueprint.md) | P3 |
| **C2** | `packages/workspace-context-artifacts` 的 context slice(context-layers / context-assembler / compact-boundary / redaction / snapshot / evidence-emitters 的 context helpers)| `workers/context-core/src/` | **pre-worker-matrix 代表(split-package)** | [`../../pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`](../../pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md) | P3 |
| **D1** | `packages/workspace-context-artifacts` 的 filesystem slice(types / paths / refs / artifacts / prepared-artifacts / promotion / mounts / namespace / backends / evidence-emitters 的 artifact helpers)| `workers/filesystem-core/src/` | **pre-worker-matrix 代表(split-package)** | [`../../pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`](../../pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md) | P4 |
| **D2** | `packages/storage-topology` | `workers/filesystem-core/src/storage/` | **P0 补齐** | [`D2-storage-topology-residual-absorption-blueprint.md`](./D2-storage-topology-residual-absorption-blueprint.md) | P4 |

---

## 3. 附加资产

| 资产 | 目的 | link | 适用阶段 |
|------|------|------|----------|
| A1-A5 sub-PR 切分建议 | P1.A kickoff 锁定 sub-PR 方案(1 PR / 2 PR / 3 PR)| [`A1-A5-sub-pr-granularity.md`](./A1-A5-sub-pr-granularity.md) | P1.A kickoff |
| W3 absorption map | 10 units × 4 workers 归属真相表 | [`../../pre-worker-matrix/W3-absorption-map.md`](../../pre-worker-matrix/W3-absorption-map.md) | P1-P5 随时查 |
| W3 absorption pattern spec | 10 disciplines + 3 placeholder 节(P1 首批回填)| [`../../pre-worker-matrix/W3-absorption-pattern.md`](../../pre-worker-matrix/W3-absorption-pattern.md) | P1.A / P1.B 执行 |
| TEMPLATE absorption blueprint | 母本 | [`../../pre-worker-matrix/TEMPLATE-absorption-blueprint.md`](../../pre-worker-matrix/TEMPLATE-absorption-blueprint.md) | P1-P5 内若需补新 blueprint |

---

## 4. 来源属性与使用建议

### 4.1 "pre-worker-matrix 代表" 类(3 份 + 1 split 双用)

| blueprint | unit 覆盖 | 使用建议 |
|-----------|-----------|----------|
| W3-absorption-blueprint-capability-runtime.md | B1 | 直接机械执行;P0 Phase 1 已做 reality-check §8.1 附 worker-matrix 消费要点 |
| W3-absorption-blueprint-session-do-runtime.md | A1 | 直接机械执行(optional);P0 Phase 1 已做 reality-check §7 附 worker-matrix 消费要点 |
| W3-absorption-blueprint-workspace-context-artifacts-split.md | C2 + D1 | D03 与 D04 作者 pair review;P0 Phase 1 已做 reality-check §9 附 worker-matrix 消费要点 |

### 4.2 "P0 补齐" 类(6 份 + 1 sub-PR 切分建议)

| blueprint | unit 覆盖 | 使用建议 |
|-----------|-----------|----------|
| A2-agent-runtime-kernel-absorption-blueprint.md | A2 | P1.A sub-PR 作者按 §3.2 文件映射机械执行 |
| A3-llm-wrapper-absorption-blueprint.md | A3 | P1.A sub-PR 作者;注意 `PreparedArtifactRef` 与 D04 pair review |
| A4-hooks-residual-absorption-blueprint.md | A4 | P1.A sub-PR 作者;`@haimang/nacp-core` dep 保留 |
| A5-eval-observability-residual-absorption-blueprint.md | A5 | P1.A sub-PR 作者;B7 LIVE 5 tests 协调 |
| C1-context-management-absorption-blueprint.md | C1 | P3 作者;D03 C2 slice 先合并 |
| D2-storage-topology-residual-absorption-blueprint.md | D2 | P4 作者;B9 tenant wrapper 不绕过 |
| A1-A5-sub-pr-granularity.md | A1-A5 切分方案 | P1.A kickoff PR 内由 owner 锁定 |

---

## 5. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-23 | Claude Opus 4.7(1M context) | 初稿;P0 Phase 2 产出;10 units × blueprint 映射 + 附加资产表 + 使用建议 |
