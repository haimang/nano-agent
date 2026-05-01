# Test Topology — hero-to-pro Frozen

> 文档类型: `architecture / test-topology`
> 创建日期: `2026-05-01`
> 关联 phase closure: `docs/issue/hero-to-pro/HP10-closure.md`
> 关联 final closure: `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
> 冻结依据: hero-to-pro `as-of-commit-hash e9287e4523f33075a37d4189a8424f385c540374`
> 文档状态: `frozen — HPX1 synced`

---

## 0. 范围

本文件描述 hero-to-pro 阶段冻结时点的**测试拓扑**：哪些测试 layer 是 live guardian、哪些是 retired，以及它们如何配合 root drift gate 形成多层守卫。

---

## 1. Live Guardians — Test Layers

### 1.1 Unit Tests (per-package)

总计 **1922 unit tests** 全绿（hero-to-pro 末态）：

| Package | Tests | Test Files | Owner |
|---------|-------|------------|-------|
| `@haimang/orchestrator-core-worker` | 305 | 33 | orchestrator-core |
| `@haimang/agent-core-worker` | 1,077 | 103 | agent-core |
| `@haimang/context-core-worker` | 178 | 20 | context-core |
| `@haimang/bash-core-worker` | (covered) | (incl.) | bash-core |
| `@haimang/filesystem-core-worker` | (covered) | (incl.) | filesystem-core |
| `@haimang/orchestrator-auth-worker` | (covered) | (incl.) | orchestrator-auth |
| `@haimang/nacp-session` | 196 | 19 | packages/nacp-session |
| `@haimang/nacp-core` | 344 | 27 | packages/nacp-core |

`pnpm test` (root) 触发全部包的 `--workspace-concurrency=1 --if-present test`。

### 1.2 Root Drift Gates (HP8)

`package.json:7-19` 注册的三类 drift gate，每次 PR 必跑：

| Gate | Script | 守卫对象 |
|------|--------|----------|
| `check:cycles` | `madge --circular ...` | 12 个 src tree 内禁止循环 import |
| `check:observability-drift` | `scripts/check-observability-drift.mjs` | 6 worker `src/` 树内禁止裸 `console.*` 与跨 worker import（不覆盖 stream-event catalog drift） |
| `check:megafile-budget` | `scripts/check-megafile-budget.mjs` | 5 owner 文件行数 ceiling（HP8 P3-01）|
| `check:tool-drift` | `scripts/check-tool-drift.mjs` | nacp-core tool catalog SSoT；packages/+workers/ 重复 tool literal 拒绝 |
| `check:envelope-drift` | `scripts/check-envelope-drift.mjs` | public orchestrator-core 路由必须用 FacadeEnvelope（Q27） |

### 1.3 Contract Tests

| Suite | Path | 守卫对象 |
|-------|------|----------|
| root-guardians | `test/root-guardians/*.test.mjs` | repo 级别契约（NACP shape / facade envelope / migration freeze） |
| package-e2e | `test/package-e2e/**/*.test.mjs` | 单包对外契约 |
| cross-e2e | `test/cross-e2e/**/*.test.mjs` | 跨 worker 真实链路 |

`pnpm test:contracts` 跑 root-guardians；`pnpm test:cross` / `pnpm test:cross-e2e` 跑 cross-e2e；`pnpm test:e2e` 跑全部 e2e。

### 1.4 cross-e2e Files（当前仓库事实）

`test/cross-e2e/` 当前 15 个文件，覆盖 RHX2 baseline + surviving HP2 live assertions：

```text
test/cross-e2e/01-stack-preview-inventory.test.mjs
test/cross-e2e/02-agent-bash-tool-call-happy-path.test.mjs
...
test/cross-e2e/zx2-transport.test.mjs
```

> **Coverage Fact**：HPX1 已退休 `cross-e2e/07` 与 `16-21` 的 marker / pure-placeholder 文件；当前 surviving cross-e2e 只保留有真实断言的基线链路与 `15-hp2-model-switch` 的模型元数据校验。默认执行仍受 `NANO_AGENT_LIVE_E2E=1` gate 约束，因此 cross-e2e 依旧属于 live-evidence layer，而不是默认环境下的交付完成证明。

---

## 2. Retired Guardians

> HPX1 已把与当前 6-worker 拓扑冲突、或仅靠 marker / `status === 200` 通过的旧 guardian 显式退休并登记如下。

| Retired Guardian | Retired Date | Replacement | Reason |
|------------------|--------------|-------------|--------|
| `test/package-e2e/agent-core/01-preview-probe.test.mjs` | 2026-05-01 | `workers/agent-core/test/smoke.test.ts` | leaf worker direct public probe 已不符合 post-ZX3 topology |
| `test/package-e2e/bash-core/01-06*.test.mjs` | 2026-05-01 | `workers/bash-core/test/smoke.test.ts` + `workers/bash-core/test/http-boundary.test.ts` | bash-core direct package-e2e 与 internal-binding secret 前提冲突；有价值 HTTP 断言已回迁 worker-local |
| `test/package-e2e/context-core/01-02*.test.mjs` | 2026-05-01 | `workers/context-core/test/smoke.test.ts` | library-worker posture 由 worker-local 401 binding-scope 守卫承接 |
| `test/package-e2e/filesystem-core/01-02*.test.mjs` | 2026-05-01 | `workers/filesystem-core/test/smoke.test.ts` | library-worker posture 由 worker-local 401 binding-scope 守卫承接 |
| `test/package-e2e/orchestrator-auth/01-probe.test.mjs` | 2026-05-01 | `workers/orchestrator-auth/test/public-surface.test.ts` + `workers/orchestrator-auth/test/entrypoint-rpc.test.ts` | public route truth 已变为 `401 binding-scope-forbidden`，且缺口实际在 entrypoint adapter |
| `test/package-e2e/orchestrator-core/07-legacy-agent-retirement.test.mjs` | 2026-05-01 | `workers/agent-core/test/smoke.test.ts` | 断言对象是 agent-core legacy retirement，目录层级错误 |
| `test/cross-e2e/07-library-worker-topology-contract.test.mjs` | 2026-05-01 | `workers/{context-core,filesystem-core}/test/smoke.test.ts` + root wrangler audit | 该文件在 ZX3 后已降级为 marker，不再是有效 cross-e2e |
| `test/cross-e2e/16-21*.test.mjs` | 2026-05-01 | no successor | 纯 `status === 200` placeholder 无稳定 live oracle，HPX1 明确退休 |

---

## 3. Test Layer × Guardian Matrix

| Layer | live | retired | retained-deferred |
|-------|------|---------|-------------------|
| Unit | workspace package / worker suites live | 0 | 0 |
| Root drift | 5 gates | 0 | 0 |
| Contract | root-guardians + package-e2e | 0 | 0 |
| cross-e2e | 15 files（HPX1 retired marker / placeholder cohort） | 7 retired files | live deploy evidence gate |
| Manual evidence | scaffold + cannot-close | 0 | owner-action retained |

---

## 4. Retired Guardians Index Convention

未来当某 guardian 退役时，应在 §2 表中追加：

```markdown
| <guardian name> | <YYYY-MM-DD> | <successor or "no successor"> | <retire reason> |
```

并在 cleanup register（hero-to-pro / hero-to-platform）中以 `deleted` 或 `retained-with-reason` 登记对应 fixture / helper / test file 的处理。

---

## 5. Verification

| 命令 | 预期 |
|------|------|
| `pnpm test` | workspace package / worker suites全绿 |
| `pnpm test:contracts` | root-guardians 全绿 |
| `pnpm check:cycles` | clean |
| `pnpm check:observability-drift` | clean |
| `pnpm check:megafile-budget` | 5 file 全部 within budget |
| `pnpm check:tool-drift` | 1 tool id (`bash`) registered |
| `pnpm check:envelope-drift` | 1 public file clean |
| `pnpm test:cross-e2e` | live-gated layer；默认环境仅运行 local-compatible subset，其余按 gate skip |

---

## 6. Frozen Decisions

本拓扑由 hero-to-pro HP10 final closure 冻结。hero-to-platform 阶段如要新增 / 退役 guardian，应在本文件 §2 + cleanup register 同步登记，不允许 silent retire。
