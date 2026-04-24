# Orchestration-Facade — Final Closure Memo

> 阶段: `orchestration-facade (F0-F5)`
> 闭合日期: `2026-04-24`
> 作者: `GPT-5.4`
> 关联 charter: `docs/plan-orchestration-facade.md`
> 文档状态: `closed`

---

## 0. 一句话 verdict

> **orchestration-facade 正式闭合**：`orchestrator-core` 已成为唯一 public compatibility façade，`agent-core` 已退回 guarded runtime host，authority / tenant / no-escalation 已有真实 policy layer，阶段级 live roundtrip 与 final handoff pack 均已落地。

---

## 1. Phase 闭合映射

| phase | verdict | primary evidence |
| --- | --- | --- |
| F0 | `closed` | `docs/issue/orchestration-facade/F0-closure.md` |
| F1 | `closed` | `docs/issue/orchestration-facade/F1-closure.md` |
| F2 | `closed` | `docs/issue/orchestration-facade/F2-closure.md` |
| F3 | `closed` | `docs/issue/orchestration-facade/F3-closure.md` |
| F4 | `closed` | `docs/issue/orchestration-facade/F4-closure.md` |
| F5 | `closed` | `docs/issue/orchestration-facade/F5-closure.md` |

---

## 2. 阶段级退出条件

### criterion 1 — canonical public owner 已切到 `orchestrator-core`

- **状态**：✅
- **证据**：
  1. `orchestrator-core` 拥有 `start/input/cancel/status/timeline/verify/ws`
  2. `agent-core /sessions/*` live 返回 typed `410/426`
  3. `test/package-e2e/orchestrator-core/07-legacy-agent-retirement.test.mjs` 与 cross suite 持续为绿

### criterion 2 — first-wave session seam 已完整闭环

- **状态**：✅
- **证据**：
  1. user DO 拥有 lifecycle / retention / reconnect / single active attachment
  2. `/internal/*` 已覆盖 `start/input/cancel/status/timeline/verify/stream`
  3. live package-e2e 已持续证明 façade route family 与 ws attach/reconnect

### criterion 3 — authority / tenant / no-escalation 已成为 runtime truth

- **状态**：✅
- **证据**：
  1. public ingress 强制 `trace_uuid` + deploy tenant truth
  2. internal ingress 强制 secret + authority header + trace + no-escalation
  3. `TEAM_UUID` 已在 5 个 worker 的 preview vars 中显式配置
  4. `bash-core` 已具备 `beforeCapabilityExecute()` seam

### criterion 4 — live topology proof 已覆盖 public façade 的真实链路

- **状态**：✅
- **证据**：
  1. `pnpm test:package-e2e` → `35 / 35 pass`
  2. `pnpm test:cross` → `47 / 47 pass`
  3. `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs` 已证明 final `JWT -> orchestrator -> agent -> bash -> stream back` 路径

### criterion 5 — docs / tests / meta state 已与最终现实一致

- **状态**：✅
- **证据**：
  1. `test/INDEX.md` 已按 closed façade truth 更新
  2. `workers/orchestrator-core/README.md` 已翻到 closed posture
  3. charter 顶层状态已改为 closed
  4. probe marker 已切到 `orchestration-facade-closed`

### criterion 6 — next-phase handoff 已可直接消费

- **状态**：✅
- **证据**：
  1. `docs/handoff/orchestration-facade-to-next-phase.md`
  2. 本 memo
  3. `docs/issue/orchestration-facade/F4-closure.md` / `F5-closure.md`

---

## 3. 最重要的最终真相

1. **public owner 固化**：后续所有 public session traffic 都应从 `orchestrator-core` 进入；`agent-core` 不再是合法 public ingress。
2. **runtime host 固化**：`agent-core` 继续拥有 session runtime、guarded `/internal/*` 与 host-local posture。
3. **tenant posture 固化**：first-wave 继续是 `single-tenant-per-deploy + explicit TEAM_UUID`，不是 multi-tenant-per-deploy。
4. **authority posture 固化**：internal secret 只是第一道 gate；authority payload、trace law、no-escalation 才是 F4 后的正式 legality layer。
5. **bash posture 固化**：`bash-core` 仍是 governed fake-bash capability worker；F4 只补 legality seam，没有扩大到 credit / billing 域。
6. **context/filesystem posture 固化**：两者继续维持 probe-only library worker posture，本阶段没有把它们提升为 public business façade。

---

## 4. 明确未做、且仍然留给下一阶段的事

1. credit / quota / billing / revocation domain
2. multi-tenant-per-deploy source migration
3. richer live push stream（当前 `/internal/stream` 仍是 snapshot-over-NDJSON relay）
4. 新 charter 正文
5. 任何第 6 个 worker 或新的 public product surface

---

## 5. 最终 operational notes

1. live preview 验证时，若旋转 `orchestrator-core` 的 `JWT_SECRET`，本地 signer 必须同步使用同值。
2. `NANO_INTERNAL_BINDING_SECRET` 继续是 runtime secret，应作为 ongoing rotation discipline，而不是 checked-in config。
3. `TEAM_UUID` 是非 secret deploy truth；preview/prod 都必须显式配置，不应回退到 `_unknown` 心智。
4. `orchestration-facade-closed` 已是 terminal probe marker；后续阶段不应复用 F1-F4 marker。

---

## 6. 最终 verdict

**orchestration-facade closed.**

这个阶段真正交付的不是“多一个 orchestrator worker”，而是一个可以被下游直接消费的 public façade truth：入口边界、runtime ownership、authority law、single-tenant deploy truth、测试矩阵与文档状态现在都已经对齐。
