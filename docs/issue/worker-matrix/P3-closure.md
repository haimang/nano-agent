# P3 context-core Absorption — Closure Memo

> 功能簇: `worker-matrix / Phase 3 — context-core Absorption`
> 讨论日期: `2026-04-23`
> 作者: `GPT-5.4`
> 关联 action-plan: `docs/action-plan/worker-matrix/P3-context-absorption.md`
> 文档状态: `closed(P3 absorbed runtime landed; context-core owns initial_context helper; dry-run green; host-local posture preserved)`

---

## 0. 背景

P3 的真实任务不是“发明新的 context worker 协议”，而是把已经存在于 `packages/context-management` 与 `packages/workspace-context-artifacts` context slice 中的 load-bearing 代码，迁入 `workers/context-core`，并把 P2 临时落在 agent-core 里的 `appendInitialContextLayer` owner 归位到 context-core。

本轮完成后，`workers/context-core` 不再只是 W4 shell；它已经成为 **C1 + C2 absorbed runtime** 的真实承载点，同时保持 first-wave host-local posture，不在 P3 越位激活 `CONTEXT_CORE` remote binding。

---

## 1. 本轮完成内容

### 1.1 吸收面

| 组 | 落地结果 |
|----|----------|
| C1 | `workers/context-core/src/{budget,async-compact,inspector-facade}/**` + 对应 tests 已吸收 |
| C2 | `workers/context-core/src/{context-layers,context-assembler,compact-boundary,redaction,snapshot}.ts` 已吸收 |
| mixed helper | 新增 `workers/context-core/src/evidence-emitters-context.ts`，承接 assembly / compact / snapshot evidence helpers |
| API owner | `appendInitialContextLayer` 已迁入 `workers/context-core/src/context-api/append-initial-context-layer.ts` |
| probe truth | `workers/context-core/src/index.ts` 改为 `phase: "worker-matrix-P3-absorbed"` + `absorbed_runtime: true` |

### 1.2 agent-core 对齐

| 文件 | 结果 |
|------|------|
| `workers/agent-core/src/host/do/nano-session-do.ts` | 通过 `@haimang/context-core-worker/context-api/append-initial-context-layer` 消费 helper |
| `workers/agent-core/src/host/context-api/append-initial-context-layer.ts` | 保留 shim re-export，避免 P2 路径立即断裂 |
| `workers/agent-core/package.json` | 增加 `pretypecheck/prebuild/pretest`，先构建 context-core |
| `workers/agent-core/src/context-core-worker.d.ts` | 为 context-core subpath 提供本地声明，避免把 context-core 源码直接拖入 agent-core 编译根 |

### 1.3 posture 显式化

- `createDefaultCompositionFactory()` 的 kernel reason 现在明确写出：**default composition 不自动装 compact delegate**。
- 新增 test 守护这一默认口径。
- 本轮没有引入新的 remote compact delegate / `CONTEXT_CORE` binding activation。

---

## 2. 验证结果

| target | 结果 |
|--------|------|
| `pnpm --filter @haimang/context-core-worker typecheck build test` | **19 files / 170 tests 绿** |
| `pnpm --filter @haimang/context-core-worker run deploy:dry-run` | 绿 |
| `pnpm --filter @haimang/agent-core-worker typecheck build test` | **96 files / 1027 tests 绿** |
| `node --test test/*.test.mjs` | **107 绿** |
| `npm run test:cross` | **121 绿** |

---

## 3. DoD 对齐

| 项 | 状态 | 说明 |
|----|------|------|
| C1 absorbed | ✅ | context-management 三组核心目录已进入 `workers/context-core` |
| C2 absorbed | ✅ | context-layers / assembler / compact / redaction / snapshot 已进入 `workers/context-core` |
| mixed helper context slice 切分 | ✅ | `evidence-emitters-context.ts` 已落地 |
| `appendInitialContextLayer` owner 归位 | ✅ | helper 已由 context-core 拥有，agent-core 改走 package subpath |
| compact posture 显式 | ✅ | kernel default 不自动挂 compact delegate 的口径已进入 composition reason + test |
| worker probe truth 校准 | ✅ | context-core 自报已从 W4 shell 升为 P3 absorbed |
| dry-run | ✅ | `workers/context-core` deploy-shaped 验证已通过 |

---

## 4. 结论

**P3 可以正式收口。** context-core 的 first-wave runtime ownership 已从 packages 转入 worker，agent-core 的 `initial_context` consumer 也已改接 context-core 所有权路径。

同时需要明确：**P3 没有激活 `CONTEXT_CORE` remote binding**。这不是缺口，而是当前 first-wave runtime 的有意 posture；真正的 remote promotion 仍留给后续 charter。
