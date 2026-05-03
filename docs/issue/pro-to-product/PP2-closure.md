# PP2 Context Budget Closure — Closure

> 服务业务簇: `pro-to-product / PP2 — Context Budget Closure`
> 上游 action-plan: `docs/action-plan/pro-to-product/PP2-context-budget-closure-action-plan.md`
> 上游 design: `docs/design/pro-to-product/03-context-budget-closure.md`
> 冻结决策来源: `docs/design/pro-to-product/PPX-qna.md` Q9-Q11
> 闭环日期: `2026-05-03`
> 文档状态: `closed`

---

## 0. 总体 Verdict

| 维度 | 结论 |
|------|------|
| PP2 当前状态 | `closed-with-first-wave-runtime-compact` |
| compact jobs 表 | `not-added`：遵守 Q9，未新增 compact 专用表 |
| durable lineage | `closed`：继续复用 context snapshot / session checkpoint / stream-event message lineage |
| runtime no-op compact | `closed`：agent-core 不再把 live compact path 固定为 `{ tokensFreed: 0 }` |
| prompt mutation | `closed`：compact 成功后 active turn messages 被 deterministic compact boundary summary + recent messages 替换 |
| degraded compact | `closed`：bridge missing / commit failed / no eligible saving 都会显式 failed notify + system warning，并结束 turn 避免 loop |
| readiness label | `manual compact = live`；`runtime auto compact = first-wave`；`context_compact confirmation = registry-only` |
| LLM summary | `not-claimed`：PP2 使用 deterministic summary，未声明高质量 LLM summary |
| live e2e | `not-claimed`：本 closure 不伪造 live preview 长对话 e2e；当前证据为 worker targeted tests、context/orchestrator integration tests、build/typecheck、governance gate 与独立 code review |

---

## 1. Resolved 项

| ID | 描述 | Verdict | 证据 |
|----|------|---------|------|
| `P1-01` | Budget owner truth | `closed` | agent-core compact probe 继续读取 orchestrator durable context state，并与 context-core `resolveBudget()` 使用同一阈值语义 |
| `P1-02` | Runtime preflight | `closed-first-wave` | turn-boundary `compactSignalProbe` 触发 kernel compact decision；runtime compact bridge 接入 host `requestCompact()` |
| `P2-01` | Manual compact durable boundary | `closed` | context-core / orchestrator compact tests 覆盖 compact boundary write/read |
| `P2-02` | Lineage classification | `closed` | durable truth 继续使用 `checkpoint_kind="compact_boundary"` 与 `snapshot_kind="compact-boundary"` |
| `P3-01` | Replace no-op `requestCompact()` | `closed` | `runtime-mainline.ts` compact delegate 调用 host bridge；缺 bridge 返回 explicit degraded |
| `P3-02` | Prompt mutation proof | `closed` | reducer `compact_done` 可替换 active turn messages；runtime-mainline test 验证下一轮 prompt mutation |
| `P3-03` | Overflow / degraded contract | `closed` | compact throw / degraded / no token saving 均不会继续 infinite compact loop |
| `P4-01` | Context docs truth sync | `closed-minimum` | `clients/api-docs/context.md` 已更新 PP2 后 readiness 与 limitation；full docs sweep 留给 PP6 |
| `P4-02` | PP2 closure | `closed` | 本文件 |

---

## 2. 本轮发现并修复的真实断点

1. **runtime compact no-op 断点**：`requestCompact()` 原先只能返回 `{ tokensFreed: 0 }`，会把 compactRequired 变成表面动作，既无法证明 prompt mutation，也可能持续触发 compact loop。现改为 host bridge：成功时写 durable compact boundary 并返回 mutated messages；缺失/失败时返回 explicit degraded。
2. **prompt mutation 缺失断点**：kernel reducer 原先只扣 token / 增加 compact count，无法替换 active prompt。现 `compact_done` 支持 `messages`，成功 compact 后 active turn prompt 真实替换为 deterministic `<compact_boundary>` summary + 最近消息。
3. **compact 失败 loop 断点**：当 compactRequired 仍为 true 且 compact 返回 0 时，scheduler 可能反复进入 compact。现 compact throw / degraded / no saving 均发 `compact.notify(status="failed")` 与 `system.notify(severity="warning")`，并显式 `complete_turn`。
4. **token accounting 断点**：初版 deterministic mutation 曾用 message estimate 与 session total 的较大值计算 `tokensFreed`，可能从真实 session total 中多扣。现 `tokensBefore` 严格使用 runtime 传入的 `totalTokens`；如果 deterministic summary 反而不省 token，则不提交 boundary、不替换 prompt。
5. **owner-file budget 断点**：PP1/PP2 累积逻辑让 `runtime-mainline.ts`、`session-do-runtime.ts`、`session-control.ts` 超出 megafile gate。现拆出 capability adapter、confirmation runtime、confirmation route 与 shared session auth helper，并保持原语义。

---

## 3. PP2 当前行为矩阵

| 场景 | 当前行为 | 终态 |
|------|----------|------|
| manual `POST /sessions/{id}/context/compact` | context-core 通过 orchestrator RPC 写 compact boundary | durable lineage live |
| turn-boundary budget 未超阈值 | runtime 继续正常 LLM/tool loop | no compact |
| turn-boundary budget 超阈值且 bridge 可用 | 构造 deterministic summary，提交 compact boundary，替换 active prompt messages | compact completed |
| deterministic summary 无 token saving | 不提交 compact boundary，不替换 prompt | compact degraded + turn completed |
| `ORCHESTRATOR_CORE.commitContextCompact` 缺失 | 不伪成功，返回 `context-compact-unavailable` | compact degraded + turn completed |
| compact boundary commit failed / blocked | 不替换 prompt，返回 `context-compact-commit-failed` | compact degraded + turn completed |
| bridge throw | `compact.notify failed` + `system.notify warning` | compact failed + turn completed |
| protected fragments | deterministic scan 记录 `<model_switch>` / `<state_snapshot>` fragment kind | limitation registered |

---

## 4. Validation Evidence

| 命令 / 操作 | 结果 |
|-------------|------|
| `pnpm --filter @haimang/agent-core-worker typecheck` | pass |
| `pnpm --filter @haimang/agent-core-worker build` | pass |
| `pnpm --filter @haimang/agent-core-worker test -- test/host/do/runtime-assembly.compact.test.ts test/host/runtime-mainline.test.ts test/kernel/scenarios/compact-turn.test.ts test/host/do/nano-session-do.test.ts` | pass，52 tests |
| `pnpm --filter @haimang/orchestrator-core-worker typecheck` | pass |
| `pnpm --filter @haimang/orchestrator-core-worker build` | pass |
| `pnpm --filter @haimang/orchestrator-core-worker test -- test/confirmation-route.test.ts test/context-route.test.ts` | pass，27 tests |
| `pnpm --filter @haimang/context-core-worker test -- test/compact-boundary.test.ts test/integration/compact-reinject.test.ts` | pass，14 tests |
| `pnpm run check:docs-consistency` | pass |
| `pnpm run check:megafile-budget` | pass，16 owner files within budget |
| `git --no-pager diff --check` | pass |
| Independent PP2 code review | 第一轮发现 token accounting issue；已修复 |
| Independent PP2 fix review | 发现 no-saving compact boundary issue；已修复 |

---

## 5. Shared Owner Files / 下游交接

| 文件 | PP2 后稳定职责 | 下游注意 |
|------|----------------|----------|
| `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` | runtime compact mutation + `commitContextCompact()` bridge | PP5 如加强可靠性，应在此处加 breaker/alert，不新增 compact jobs 表 |
| `workers/agent-core/src/host/runtime-mainline.ts` | mainline runner 构造与 compact bridge seam | 已拆 capability adapter；后续不应重新堆回 megafile owner |
| `workers/agent-core/src/kernel/runner.ts` | compact decision handling、degraded terminal behavior | PP3 reconnect 不应把 degraded compact 当 completed compact replay |
| `workers/agent-core/src/kernel/reducer.ts` | `compact_done` token accounting + active prompt mutation | `tokensFreed` 必须以 session total 为会计基准 |
| `workers/orchestrator-core/src/context-control-plane.ts` | compact boundary durable truth | 保持 `checkpoint_kind` / `snapshot_kind` 分类，供 PP3/PP6 消费 |
| `clients/api-docs/context.md` | PP2 minimum docs truth | PP6 需要做全量接口扫描，不以本次最小同步替代 |

---

## 6. Known Issues / Not-Touched

1. PP2 不声明 LLM-based summary 已完成；deterministic summary 只满足 first-wave prompt mutation 与 boundary evidence，不保证语义质量。
2. PP2 不声明 browser live preview 长对话 e2e 已完成；当前 closure 是本地 targeted evidence + integration evidence。
3. `context_compact` confirmation kind 仍是 registry-only / future caller substrate；PP2 未把 compact 接入 HITL confirmation 主线。
4. Review follow-up 已修复：compact breaker 现在包含 7 分钟 cool-down，连续失败不会永久自锁；PP5 reliability hardening 仍需处理 no-saving / failed notify 的 alert-rate 噪音。
5. PP2 runtime compact error codes `context-compact-not-enough-input` / `context-compact-unavailable` / `context-compact-commit-failed` 已在 `clients/api-docs/error-index.md` 登记；PP6 仍需做全量 sweep。
6. PP2 只做 `clients/api-docs/context.md` 最小事实同步；PP6 负责全量 clients/api-docs 对账。

---

## 7. 收尾签字

- PP2 已关闭 Context Budget Closure 的 first-wave runtime loop：budget signal → compact bridge → durable boundary → prompt mutation / explicit degraded。
- PP2 未新增 D1 表，未 overclaim LLM summary，未把 auto compact 写成 fully product-live。
- `p2p-pp3-code` 可以在 `p2p-pp2-closure` 完成后按串行 todo 启动。
