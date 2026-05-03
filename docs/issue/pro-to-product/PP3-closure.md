# PP3 Reconnect & Session Recovery — Closure

> 服务业务簇: `pro-to-product / PP3 — Reconnect & Session Recovery`
> 上游 action-plan: `docs/action-plan/pro-to-product/PP3-reconnect-session-recovery-action-plan.md`
> 上游 design: `docs/design/pro-to-product/04-reconnect-session-recovery.md`
> 冻结决策来源: `docs/design/pro-to-product/PPX-qna.md` Q12-Q14
> 闭环日期: `2026-05-03`
> 文档状态: `closed`

---

## 0. 总体 Verdict

| 维度 | 结论 |
|------|------|
| PP3 当前状态 | `close-with-known-issues` / `closed-with-first-wave-reconnect-recovery` |
| replay guarantee | `best-effort + explicit degraded`：遵守 Q12，不承诺 exactly-once |
| attachment model | `single attachment + supersede`：遵守 Q13，未新增多活动 attachment |
| replay gap | `closed`：WS attach 与 HTTP resume 均显式暴露 replay lost，不允许 silent latest-state fallback |
| helper replay restore | `closed`：agent-core restore path 恢复 helper replay / stream seq state |
| recovery bundle | `closed-as-contract`：前端恢复所需 public surfaces 已登记；不是新增单一聚合 endpoint |
| cross-e2e | `not-claimed`：本 closure 不伪造 live / cross-worker e2e；当前证据为 package tests、worker targeted tests、docs/governance gates 与两轮独立 code review |

---

## 1. Resolved 项

| ID | 描述 | Verdict | 证据 |
|----|------|---------|------|
| `P1-01` | WS replay gap degraded frame | `closed` | `last_seen_seq > relay_cursor` 时，WS attach 后先发 `session.replay.lost`，再进入 replay forwarding |
| `P1-02` | HTTP/WS replay_lost parity | `closed` | HTTP resume 返回 `replay_lost_detail`；WS frame、HTTP response、audit detail 使用同一 reason / degraded / cursor 语义 |
| `P2-01` | Helper replay checkpoint persist | `closed-existing-channel` | 继续使用 `helper.checkpoint(helperStorage)` 写 helper replay / stream seq，不新增 D1 表 |
| `P2-02` | Helper replay restore | `closed` | `restoreFromStorage()` 调用 `helper.restore(helperStorage)`，fresh DO 恢复后 stream seq 连续 |
| `P3-01` | Single attachment tests | `closed-existing-evidence` | User DO tests 覆盖 supersede frame / close 行为；本阶段未扩多端 |
| `P3-02` | Detached / terminal state tests | `closed-existing-evidence` | User DO tests 覆盖 detached reattach 与 ended session typed rejection |
| `P4-01` | Recovery bundle spec | `closed` | `clients/api-docs/session-ws-v1.md` 登记 reconnect flow 与 recovery bundle |
| `P4-02` | Reconnect truth e2e | `not-claimed` | 未新增 live cross-e2e；以 targeted worker/integration tests 作为 PP3 first-wave evidence |
| `P4-03` | PP3 closure | `closed` | 本文件 |

---

## 2. 本轮发现并修复的真实断点

1. **WS attach replay gap silent 断点**：client 提供的 `last_seen_seq` 超过 server `relay_cursor` 时，原 WS attach 路径没有 frontend-visible degraded verdict。现新增 top-level `session.replay.lost` frame，并在转发 replay frames 前发出。
2. **协议 registry 缺口**：`session.replay.lost` 不能只作为临时 lightweight frame 存在。现已进入 `@haimang/nacp-session` schema、message registry、direction matrix、role/phase registry 与 frame compatibility validation。
3. **HTTP/WS replay_lost 形状不对齐**：HTTP resume 原先只有 `replay_lost` boolean 与 `relay_cursor`，前端仍需猜测原因。现新增 additive `replay_lost_detail`，与 WS frame/audit 使用同一 `{ client_last_seen_seq, relay_cursor, reason, degraded }` 语义。
4. **helper replay restore 不对称**：agent-core 已 checkpoint helper replay / stream seq，但 restore path 未恢复 helper storage。现 `restoreFromStorage()` 在读取主 checkpoint 前恢复 helper，fresh DO 后 seq 可继续递增。
5. **docs numbering / reconnect flow drift**：`session-ws-v1.md` 新增 replay lost section 后相邻编号与 HTTP resume 描述需要同步。现已修正 heading 编号，并补充 HTTP/WS parity 与 recovery bundle 刷新规则。

---

## 3. PP3 当前行为矩阵

| 场景 | 当前行为 | 终态 |
|------|----------|------|
| fresh WS attach，不带 `last_seen_seq` | 使用 stored `relay_cursor`，不声明 replay gap | normal attach |
| client `last_seen_seq <= relay_cursor` | 从 client cursor 后 best-effort replay，避免重复已确认帧 | replay attempted |
| client `last_seen_seq > relay_cursor` | WS 先发 `session.replay.lost`，audit 写 `session.replay_lost` | degraded attach |
| HTTP resume `last_seen_seq > relay_cursor` | response `replay_lost: true` + `replay_lost_detail`，audit 同步记录 | degraded ack |
| second WS attachment | old socket 收到 `session.attachment.superseded` 并关闭 | single attachment maintained |
| socket close | session 可进入 detached，后续 reattach 可恢复 active | detached recovery |
| ended / missing session attach | typed error，不恢复成 active | terminal protected |
| fresh DO restore after helper checkpoint | helper replay / stream seq restored before main checkpoint hydration | persistence symmetry |

---

## 4. Recovery Bundle Contract

PP3 不新增单一 `/recovery-bundle` endpoint；前端在 reconnect 后应组合已有 public surfaces：

| Surface | 用途 | PP3 约束 |
|---------|------|----------|
| WS attach `?last_seen_seq=` | best-effort replay 与 early degraded verdict | `session.replay.lost` 必须优先可见 |
| `POST /sessions/{id}/resume` | HTTP recovery ack / replay_lost detail | 与 WS 使用同一 degraded reason 语义 |
| `GET /sessions/{id}/status` / runtime read model | session phase、status、usage、durable truth | 用于重建 active/detached/terminal UI |
| confirmations routes | pending permission / elicitation | 消费 PP1 interrupt truth |
| context probe / context docs surfaces | context budget / compact boundary posture | 消费 PP2 compact truth；不伪造 LLM summary |
| todos / items / tool-call read models | 前端列表与 tool outcome reconciliation | replay lost 后必须刷新 |
| timeline | degraded reconciliation | 当 replay lost 时作为补偿性 read model |

---

## 5. Validation Evidence

| 命令 / 操作 | 结果 |
|-------------|------|
| `pnpm --filter @haimang/nacp-session typecheck` | pass |
| `pnpm --filter @haimang/nacp-session build` | pass |
| `pnpm --filter @haimang/nacp-session test` | pass，21 files / 217 tests |
| `pnpm --filter @haimang/orchestrator-core-worker typecheck` | pass |
| `pnpm --filter @haimang/orchestrator-core-worker test -- test/user-do.test.ts test/observability-runtime.test.ts` | pass，43 tests |
| `pnpm --filter @haimang/agent-core-worker typecheck` | pass |
| `pnpm --filter @haimang/agent-core-worker test -- test/host/integration/checkpoint-roundtrip.test.ts` | pass，7 tests |
| `pnpm run check:docs-consistency` | pass |
| `pnpm run check:megafile-budget` | pass |
| `pnpm run check:envelope-drift` | pass |
| `git --no-pager diff --check` | pass |
| Independent PP3 code review | 未发现重大问题 |
| Independent PP3 parity review | 未发现重大问题 |

---

## 6. Known Issues / Not-Touched

1. PP3 不声明 exactly-once、永久 replay 或 event-store v2；当前是 best-effort replay + explicit degraded。
2. PP3 不支持多活动 attachment；第二客户端 attach 会 supersede 第一客户端。
3. PP3 不声明 live preview / browser cross-e2e 已完成；当前 closure 是 local package/worker evidence。
4. Recovery bundle 是前端组合 public surfaces 的 contract，不是一个新的聚合 API；PP6 需要把全量 clients/api-docs 做最终对账。
5. replay lost latency `≤2s` 仅作为 alert/UX 目标登记，本阶段未建设专门 latency SLO monitor。
6. Recovery bundle 已补入 `clients/api-docs/client-cookbook.md`，但 PP6 final closure 仍需按全部 public surface 做 item-by-item 对账。

---

## 7. 下游交接

| 下游 | 交接事项 |
|------|----------|
| PP4 Hook Delivery Closure | Hook outcome / degraded frame 不应绕过 PP3 recovery bundle；WS reconnect 后前端需要重新拉取 hook-visible read models |
| PP5 Policy & Reliability Hardening | stream failure 应沿用 explicit degraded + client retry 思路，不能 silent success |
| PP6 API Contract Docs Closure | 全量核对 `session.md`、`session-ws-v1.md`、transport profiles、worker health docs 中的 replay/recovery wording |

---

## 8. 收尾签字

- PP3 已关闭 first-wave reconnect recovery 主线：WS/HTTP replay gap 不 silent，helper replay restore 对称，single attachment 范围未扩大。
- PP3 的 T3/T4 证据来自真实 runtime code + targeted worker/integration tests；未用 PP6 docs 或 live e2e 名义替代。
- `p2p-pp4-code` 可以在 `p2p-pp3-closure` 完成后按串行 todo 启动。
