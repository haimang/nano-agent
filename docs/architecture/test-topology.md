# Test Topology — hero-to-pro Frozen

> 文档类型: `architecture / test-topology`
> 创建日期: `2026-05-01`
> 关联 phase closure: `docs/issue/hero-to-pro/HP10-closure.md`
> 关联 final closure: `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
> 冻结依据: hero-to-pro `as-of-commit-hash e9287e4523f33075a37d4189a8424f385c540374`
> 文档状态: `frozen — handoff-ready`

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
| `check:observability-drift` | `scripts/check-observability-drift.mjs` | observability inspector kind catalog 与 nacp-session stream-event 同步 |
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

### 1.4 Live cross-e2e Files (HP9 frozen 时点)

`test/cross-e2e/` 当前 15 个文件，覆盖 RHX2 / HP0 / HP1 baseline：

```text
test/cross-e2e/01-baseline-smoke.test.mjs
test/cross-e2e/02-auth-roundtrip.test.mjs
... (14 more)
```

> **Coverage Gap**（已显式登记到 final closure §4）：HP2-HP8 各自的 targeted cross-e2e（model-switch / long-conversation / lifecycle-retry-restore / round-trip / tool-cancel / restore-three-mode / heartbeat-4-scenario）**全部** handed-to-platform。hero-to-platform 阶段补齐。

---

## 2. Retired Guardians

> hero-to-pro 阶段没有发生 retire；以下 placeholder 留给 hero-to-platform 阶段在退役某 guardian 时填写。

| Retired Guardian | Retired Date | Replacement | Reason |
|------------------|--------------|-------------|--------|
| (none) | n/a | n/a | n/a |

---

## 3. Test Layer × Guardian Matrix

| Layer | live | retired | retained-deferred |
|-------|------|---------|-------------------|
| Unit | 8 packages 1922 tests | 0 | 0 |
| Root drift | 5 gates | 0 | 0 |
| Contract | root-guardians + package-e2e | 0 | 0 |
| cross-e2e | 15 baseline | 0 | HP2-HP8 targeted handoff |
| Manual evidence | scaffold + cannot-close | 0 | HP9-D1 handed-to-platform |

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
| `pnpm test` | 1922/1922 全绿 |
| `pnpm test:contracts` | root-guardians 全绿 |
| `pnpm check:cycles` | clean |
| `pnpm check:observability-drift` | clean |
| `pnpm check:megafile-budget` | 5 file 全部 within budget |
| `pnpm check:tool-drift` | 1 tool id (`bash`) registered |
| `pnpm check:envelope-drift` | 1 public file clean |
| `pnpm test:cross-e2e` | 15 baseline files；HP2-HP8 targeted **NOT YET**（handed-to-platform） |

---

## 6. Frozen Decisions

本拓扑由 hero-to-pro HP10 final closure 冻结。hero-to-platform 阶段如要新增 / 退役 guardian，应在本文件 §2 + cleanup register 同步登记，不允许 silent retire。
