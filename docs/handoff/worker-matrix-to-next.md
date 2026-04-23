# Worker-Matrix → Next Phase Handoff

> 阶段: `worker-matrix → 下一阶段(placeholder;待 trigger 激活后命名)`
> 交付日期: `2026-04-23`
> 作者: `Claude Opus 4.7 (1M context)`
> 文档状态: `closed(worker-matrix 全阶段收口;下一阶段等待 trigger 激活)`
> 直接上游: [`docs/issue/worker-matrix/worker-matrix-final-closure.md`](../issue/worker-matrix/worker-matrix-final-closure.md)

---

## 0. 本 handoff 的定位

worker-matrix 阶段(P0-P5)已按 charter §9 的 6 条 primary exit criteria 全部满足完成,state `closed` 于 2026-04-23。当前 **没有** 任一 下一阶段 trigger 被激活,所以下一阶段名字 / scope / 产出都尚未命名 — 本 handoff 是 **"等待 trigger 激活"** 状态的预备 memo,而非对某个具体下阶段的 input pack。

当 trigger 之一被激活,新阶段作者把本 memo 作为 **single truth anchor** kickoff,并在 kickoff PR 内引用本 memo + worker-matrix final closure memo。

---

## 1. 下一阶段触发条件(charter §10)

下一阶段由以下 2 类 trigger 之一启动:

### 1.1 Live loop stability trigger

- **触发条件**:worker-matrix 收口后的 preview live loop 连续稳定 **2-4 周**(监测周期):
  - `https://nano-agent-agent-core-preview.haimang.workers.dev/` 无 5xx / 无 regression
  - `https://nano-agent-bash-core-preview.haimang.workers.dev/` 无 5xx / 无 regression
  - B7 LIVE 5 tests 在 CI / local 持续绿
  - 任何 session.start / tool.call 闭环 e2e 无 regression
- **预期产出(下一阶段 charter 的主题)**:
  - Production env flip:`nano-agent-agent-core-production` + `nano-agent-bash-core-production`
  - Custom domain(如果适用)
  - 可选的 namespace 归属重评(`@nano-agent/*` vs 保持 `@haimang/*` — 取决于 GitHub namespace 纠纷是否已解)
  - Tier B physical delete(9 个 DEPRECATED 包的最终移除节奏)

### 1.2 Scope expansion trigger

- **触发条件**:owner 明确 admit 第 5 个 worker(`skill.core` 或其他)
- **预期产出**:
  - 类 r2 的 clean rewrite `docs/plan-<next>.md`
  - 重新开 design / blueprint / action-plan 链
  - 新 worker 对应的 Tier B → workers 吸收流程(复用本阶段 W3 pattern)

---

## 2. worker-matrix 交付的 truth layers

下一阶段作者在 kickoff 前,**必须读取** 以下文档以获得完整 context。

### 2.1 Charter + closure 顶层

1. `docs/plan-worker-matrix.md`(charter r2;§11.1 列出全部 phase closure link + §11.2 状态标 `closed`)
2. `docs/issue/worker-matrix/worker-matrix-final-closure.md`(final closure;§1 6 条 exit criteria 全绿证据 + §3 handoff 段 + §4 cross-cut 不变量确认)

### 2.2 Phase-level closure memos

1. `docs/issue/worker-matrix/P0-absorption-prep-closure.md`
2. `docs/issue/worker-matrix/P1-closure.md`
3. `docs/issue/worker-matrix/P2-closure.md`
4. `docs/issue/worker-matrix/P3-closure.md`
5. `docs/issue/worker-matrix/P4-closure.md`

### 2.3 Review 文档(GPT ↔ Opus 互审链)

1. `docs/code-review/worker-matrix/P1-P0-reviewed-by-GPT.md`(R1-R3 全 accept + closed)
2. `docs/code-review/worker-matrix/P2-reviewed-by-GPT.md`(R1-R5 全 accept + closed)
3. `docs/code-review/worker-matrix/P3-P4-reviewed-by-opus.md`(R1-R6 全 accept + §7 二次审查 closed;含 P1~P4 4 worker 联合快照)

### 2.4 Runtime canonical ownership

| 层 | 位置 |
|----|------|
| Tier A wire vocabulary(published,**NOT deprecated**)| `packages/nacp-core@1.4.0` / `packages/nacp-session@1.3.0` |
| Worker runtime canonical(P1-P4 吸收)| `workers/agent-core/src/{host,kernel,llm,hooks,eval}/` + `workers/bash-core/src/` + `workers/context-core/src/` + `workers/filesystem-core/src/` |
| Tier B coexistence duplicate(9 包;DEPRECATED banner + R5 / per-worker 节奏,物理保留)| `packages/{session-do-runtime,capability-runtime,agent-runtime-kernel,llm-wrapper,hooks,eval-observability,context-management,workspace-context-artifacts,storage-topology}/` |
| live preview URLs | `https://nano-agent-agent-core-preview.haimang.workers.dev/`(Version `1d423bfc-4d54-4fed-b84c-f47586b79728`) + `https://nano-agent-bash-core-preview.haimang.workers.dev/`(Version `50335742-e9e9-4f49-b6d7-ec58e0d1cfb4`) |
| Released bundle | GitHub Packages `@haimang/nacp-core@1.4.0` + `@haimang/nacp-session@1.3.0`(W2 workflow run `24814439569`) |

### 2.5 Release hygiene artifacts

1. `.npmrc`(root,`${NODE_AUTH_TOKEN}` 占位符,与 `dogfood/nacp-consume-test/.npmrc` 同模式;CI 与 local dev 共用)
2. `pnpm-lock.yaml`(4 workers 对 `@haimang/nacp-*` resolution 非 `link:`,而是具体 `1.4.0(zod@...)` / `1.3.0(zod@...)` 形态 — P1-P5 GPT review R5 口径)
3. 4 workers `package.json::dependencies` 的 `@haimang/nacp-*` 精确 pin `"1.4.0"` / `"1.3.0"`(无 `workspace:*` 残留)

### 2.6 Design doc (D01-D09 v0.2 已吸收 GPT R1-R5)

1. `docs/design/worker-matrix/D01-agent-core-absorption.md`
2. `docs/design/worker-matrix/D02-bash-core-absorption.md` v0.2(R3 binding-first)
3. `docs/design/worker-matrix/D03-context-core-absorption-and-posture.md`(R1 helper-pending-layers + `evidence-emitters-context.ts` 单文件 path)
4. `docs/design/worker-matrix/D04-filesystem-core-absorption-and-posture.md`(Q4a + `evidence-emitters-filesystem.ts`)
5. `docs/design/worker-matrix/D05-initial-context-host-consumer.md` v0.2(R1 composition.workspace.assembler + R2 system.notify)
6. `docs/design/worker-matrix/D06-default-composition-and-remote-bindings.md` v0.2(R1 无 top-level assembler)
7. `docs/design/worker-matrix/D07-agent-bash-tool-call-activation.md`
8. `docs/design/worker-matrix/D08-published-path-cutover.md` v0.2(R4 `.npmrc` readiness honesty)
9. `docs/design/worker-matrix/D09-tier-b-deprecation-protocol.md` v0.2(R5 README-only / minimal stub)

### 2.7 Pattern spec

1. `docs/design/pre-worker-matrix/W3-absorption-pattern.md`(10 discipline patterns + Pattern 11 LOC→时长 P1 回填 + Pattern 12 流水线 P1 回填 + §15 第 3 placeholder 循环引用最终清点 "未触发 — WCA split 零循环,是 W3 split 正面成果")

---

## 3. 下一阶段 kickoff 的 first PR body 必须包含

- [ ] 明确 trigger:**live loop stability** 还是 **scope expansion**
- [ ] 引用 `docs/issue/worker-matrix/worker-matrix-final-closure.md` 作为 single truth anchor
- [ ] 引用本 handoff memo(section 号可指引读者快速定位关键 truth layer)
- [ ] 决策 **WCA / context slice / artifact slice 的 one-shot ownership switch 节奏**
- [ ] 决策 **`agent-core` 的 WCA consumer path 是否切到 `@haimang/filesystem-core-worker`**(仅当 live loop stability trigger 时相关)
- [ ] 决策 **Tier B physical delete timeline**(9 包;live loop stability 2-4 周后最早可开始)
- [ ] 决策 **NACP bump 是否进行**(`nacp-core 1.5.0` / `nacp-session 1.4.0`) — 独立 charter,不在 worker-matrix 闭环内
- [ ] 决策 **production env flip** 路径(若 live loop stability trigger)
- [ ] 决策 **skill.core 是否 admit**(若 scope expansion trigger)
- [ ] 决策 **`@nano-agent/*` → `@haimang/*` namespace swap 的 timing**(WCA / storage-topology / hooks / eval-observability / context-management 等是否 follow `@haimang/*`) — 与 GitHub namespace 纠纷的最新状态挂钩

---

## 4. 已知 open questions(非 worker-matrix 内 blocker)

移交给下一阶段决策(见 worker-matrix-final-closure §3.3):

1. **context / artifact slice coexistence duplicate**:currently `packages/workspace-context-artifacts` 保留全部 context/filesystem/artifact 符号的 local 实现;`workers/context-core` + `workers/filesystem-core` 是 worker-side canonical copy;agent-core 主 consumer 仍读 packages 侧 → 一次性切换计划归下一阶段
2. **filesystem-core 当前 0 runtime consumer**:agent-core 未 import `@haimang/filesystem-core-worker`;是否切换归下一阶段
3. **Tenant wrapper CI grep guard**:靠人工 review + P5 memo grep。下一阶段建议固化成 CI check
4. **PX root test tree 重构**:`docs/action-plan/worker-matrix/PX-new-tests.md` 已 draft test tree reset + 新 live-e2e matrix,未完全执行 — 按 owner 节奏决定何时落地

---

## 5. 不得跨本 handoff 边界的事项(worker-matrix 内的 NOT-exit 不变量)

下一阶段 **无条件继承** 以下 worker-matrix 硬约束:

- NACP wire vocabulary 不私修(6 canonical `ContextLayerKind`、`system.notify`、`session.start.initial_input`、等)
- B9 tenant wrapper 不绕过(所有 `storage.put/get/list` 经 `getTenantScopedStorage`)
- `NACP_CORE_TYPE_DIRECTION_MATRIX` / `NACP_SESSION_TYPE_DIRECTION_MATRIX` / `SessionStartInitialContextSchema` 任一私修 → 新阶段需独立 charter
- W1 RFC 保持 direction-only 除非新阶段独立 RFC revision
- Tier B 物理删除需先确认 live loop stability(不是 worker-matrix 收口自动授权)
- skill.core reserved 除非新阶段明确 admit

---

## 6. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-23 | Claude Opus 4.7(1M context)| 初稿;worker-matrix 收口后 ship;下一阶段 trigger + input pack + kickoff checklist + open questions + 不变量硬约束 |
