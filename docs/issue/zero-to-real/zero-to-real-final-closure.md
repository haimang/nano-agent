# Zero-to-Real — Final Closure Memo

> 阶段: `zero-to-real (Z0-Z5)`
> 闭合日期: `2026-04-25`
> 作者: `GPT-5.4`
> 关联 charter: `docs/charter/plan-zero-to-real.md`
> 文档状态: `closed`

---

## 0. 一句话 verdict

> **zero-to-real 正式闭合**：nano-agent 已拥有真实 end-user auth foundation、D1 session truth baseline、Workers AI + quota runtime mainline、`orchestrator-core` public façade、web / Mini Program first-wave client baseline，以及可回挂到 D1 usage row 的 live preview evidence。

---

## 1. Phase 闭合映射

| phase | verdict | primary evidence |
| --- | --- | --- |
| Z0 | `closed` | `docs/issue/zero-to-real/Z0-closure.md` |
| Z1 | `closed` | `docs/issue/zero-to-real/Z1-closure.md` |
| Z2 | `closed` | `docs/issue/zero-to-real/Z2-closure.md` |
| Z3 | `closed` | `docs/issue/zero-to-real/Z3-closure.md` |
| Z4 | `closed` | `docs/issue/zero-to-real/Z4-closure.md` |
| Z5 | `closed` | `docs/issue/zero-to-real/Z5-closure.md` |

---

## 2. 阶段级退出条件

### criterion 1 — 完整 end-user auth truth 已成立

- **状态**：✅
- **证据**：
  1. `orchestrator-auth` 已是 internal-only auth owner。
  2. register/login/refresh/me/verify/reset/wechat baseline 已落地。
  3. JWT `HS256 + kid`、refresh rotation、tenant readback 已进入真实 worker path。

### criterion 2 — multi-tenant / NACP compliance 成为 runtime truth

- **状态**：✅
- **证据**：
  1. public/internal 双头校验成立。
  2. `trace_uuid`、authority payload、no-escalation 已进入主线。
  3. review-fix 后 deploy tenant fallback 已不再冒充 runtime tenant truth。

### criterion 3 — session truth 已持久化

- **状态**：✅
- **证据**：
  1. Wave B D1 schema 已包含 conversation/session/turn/message/context/activity baseline。
  2. user DO 已形成最小 hot-state 集合。
  3. `status/start` RPC kickoff 与 durable history/timeline/readback 已成立。

### criterion 4 — real runtime 已成立

- **状态**：✅
- **证据**：
  1. Workers AI 已成为 production mainline provider。
  2. llm/tool shared quota gate 已成立。
  3. `nano_usage_events` 已保留 provider lineage 与 live anchor row。

### criterion 5 — real clients 已闭合

- **状态**：✅（first-wave baseline）
- **证据**：
  1. Web 与 Mini Program 都已拥有真实 auth/session/ws/timeline 消费代码。
  2. review-fix 后，两端都已具备 replay/heartbeat/error baseline。
  3. live public/runtime suite 已证实它们依赖的后端链路不是 mock。

### criterion 6 — 剩余问题已被压成明确 backlog

- **状态**：✅
- **证据**：
  1. Z4 residual inventory 已存在。
  2. Z5 closeout 已把残余项排序成 handoff-ready backlog。

---

## 3. 最重要的最终真相

1. **public owner 固化**：`workers/orchestrator-core` 继续是唯一 public auth/session ingress owner。
2. **auth owner 固化**：`workers/orchestrator-auth` 继续是 internal-only pure RPC auth worker，而不是第二个 public product surface。
3. **runtime host 固化**：`workers/agent-core` 继续拥有 session runtime、LLM mainline、quota preauth 与 guarded internal host posture。
4. **tool owner 固化**：`workers/bash-core` 继续是 governed fake-bash capability worker；它已经进入真实 cross-worker roundtrip，而不是 package-local demo。
5. **durable truth 固化**：identity/session/activity/quota usage 已进入 shared D1 baseline；`agent-core` 不再突破 write ownership 去直写 session activity。
6. **client posture 固化**：`clients/web` 与 `clients/wechat-miniprogram` 现在是 first-wave real-client baseline，不是产品级完成态。
7. **evidence posture 固化**：阶段结论不再靠“看起来能跑”，而是靠 package/cross-e2e、preview deploy、D1 anchor row 与 SQL spot-check 支撑。

---

## 4. 明确未做、且仍然留给下一阶段的事

1. manual browser / 微信开发者工具 / 真机证据
2. token-level live streaming 或更清晰的 snapshot-vs-push 决策
3. dead `deploy-fill` compatibility residue 清理
4. DO websocket heartbeat lifecycle 的 platform-fit hardening
5. tool registry 与 client session helper 的单一真相源抽取
6. richer quota/bootstrap hardening、admin plane、billing/control plane
7. broader multi-tenant-per-deploy 与更深的 internal RPC 演进

---

## 5. 最终 operational notes

1. `NANO_INTERNAL_BINDING_SECRET` 继续是 runtime secret，而不是 checked-in config。
2. `TEAM_UUID` 仍是 deploy truth；preview/prod 都应显式配置，不能回退到 `_unknown` 心智。
3. `NANO_AGENT_ALLOW_PREVIEW_TEAM_SEED=true` 仅是 preview escape hatch，不应漂移成 production baseline。
4. `/sessions/:uuid/ws?access_token=...` 继续只被视为 WS compatibility path，不能扩散到普通 HTTP action。
5. `clients/*` 当前 hand-written session helpers 只是过渡兼容层；后续不应继续复制粘贴出第三套实现。

---

## 6. 最终 verdict

**zero-to-real closed.**

这个阶段真正交付的不是“又补了几组 worker 功能”，而是 nano-agent 第一次拥有了一个可以持续验证、持续演进、并且不再依赖假主路径的真实基线。接下来的工作不再是证明“系统能不能第一次跑起来”，而是围绕已经成立的 baseline 去做 transport/client hardening、registry 收敛、manual evidence 与更深的产品化/运营化扩展。
