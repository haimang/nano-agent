# Real-to-Hero — RH3 Closure Memo

> 阶段: `real-to-hero / RH3 — Device Auth Gate and API Key`
> 闭合日期: `2026-04-29`
> 作者: `Owner + Copilot`
> 关联 charter: `docs/charter/plan-real-to-hero.md` r2 §7.4 + §8.3
> 关联 design: `docs/design/real-to-hero/RH3-device-auth-gate-and-api-key.md`
> 关联 action-plan: `docs/action-plan/real-to-hero/RH3-device-auth-gate-and-api-key.md`
> 文档状态: `close-with-known-issues`

---

## 0. 一句话 verdict

> **RH3 主目标已闭合**: `migration 009-team-display-and-api-keys.sql` 已 apply 到 preview D1；`device_uuid` 已进入 register / login / refresh / access gate / WS gate / revoke disconnect 全链路；`verifyApiKey` 不再是 stub，`nak_*` bearer 已可穿过 façade；`/me/team` GET+PATCH、`/me/teams` GET、`/me/conversations` cursor 版、`/me/devices` active-only 全部 live；preview 上已完成 009 apply、2 worker deploy、JWT/device/API key/live revoke smoke，以及 3 条 live e2e 通过。

> **本 Phase 仍保留 2 个 inherited known gap**:
> 1. RH1 carry-over 的 `permission / elicitation / usage` 三条 round-trip cross-e2e 文件仍未补齐；本轮只把 RH3 自身的 `device revoke` live e2e 补到位。
> 2. RH2 carry-over 的 WS lifecycle 全量 hardening（normal close / abnormal disconnect / heartbeat miss / replay-after-reconnect + alarm）仍未完整闭合；本轮只把 RH3 必需的 revoke / wrong-device path 做成真实 gate。

---

## 1. Phase 闭合映射

| Phase | verdict | 主要产出 |
|-------|---------|----------|
| Phase 1 — Migration 009 | ✅ closed | `nano_teams.team_name/team_slug`、`nano_team_api_keys.key_salt`、`nano_auth_sessions.device_uuid` 已入 schema；preview remote D1 已 apply |
| Phase 2 — Contract Upgrade | ✅ closed | `AuthTeam` / `AccessTokenClaims` / `AuthSnapshot` / `VerifyApiKeyResult` 升级；`createApiKey` internal RPC 入 contract；`@haimang/orchestrator-auth-contract` 升到 `0.0.1` |
| Phase 3 — Device Mint + Refresh Bind | ✅ closed | register/login 自动 mint 或承接 `device_uuid`；refresh 强绑定同 device；revoked device refresh 失效 |
| Phase 4 — Device Auth Gate | ✅ closed(核心链路) | access path D1 gate + short TTL cache；User DO session 绑定 `device_uuid`；WS attach wrong-device/revoked gate；revoke 后主动 close attachment |
| Phase 5 — API Key Runtime | ✅ closed | `verifyApiKey` 真查 D1；`authenticateRequest` 支持 JWT / `nak_*` 双轨；`/auth/me` 与 `/me/team` live 接受 API key bearer |
| Phase 6 — Team Display + /me/team + /me/teams | ✅ closed | register bootstrap 自动生成 `team_name`/`team_slug`；`/me/team` GET+PATCH live；`/me/teams` GET live |
| Phase 7 — /me/conversations | ✅ closed | façade 改为基于 D1 session truth 聚合，返回 keyset cursor 形状；单测覆盖首屏 / 翻页 / 末页 null / 401 / 隔离 |
| Phase 8 — Validation + Preview Smoke | ✅ partial-plus | worker test 全绿、preview deploy 完成、JWT/API key/device revoke live smoke 完成；但 inherited RH1/RH2 WS/e2e 债务未一并清空 |

---

## 2. RH3 hard gate 验收

| Hard gate | 目标 | 实测 | verdict |
|-----------|------|------|---------|
| migration 009 file + preview remote apply | yes | `009-team-display-and-api-keys.sql` 已 remote apply（9 commands） | ✅ |
| auth-contract 升级后下游不破 | yes | contract/build/test 全绿 | ✅ |
| orchestrator-auth RH3 主链 | yes | typecheck/build/test 全绿 | ✅ |
| orchestrator-core RH3 主链 | yes | `17` test files / `148` tests 全绿 | ✅ |
| `/me/team`、`/me/teams` endpoint test | each ≥5 | 新增 2 个 route test 文件，各 5 case 全绿 | ✅ |
| `nak_*` bearer runtime | yes | package-e2e live smoke 通过（`/auth/me` + `/me/team`） | ✅ |
| revoke 后 access 失效 + WS disconnect | yes | cross-e2e live test 通过（old token 401 + WS close code `4001`） | ✅ |
| preview deploy 后 6 worker health | 6/6 | `/debug/workers/health` = `live: 6 / total: 6` | ✅ |

---

## 3. Preview 证据摘录

### 3.1 Migration + deploy

| 项 | 结果 |
|---|---|
| preview D1 migration | `009-team-display-and-api-keys.sql` applied |
| `nano-agent-orchestrator-auth-preview` | Version `212b2b22-b372-4bab-952a-19ea1958deae` |
| `nano-agent-orchestrator-core-preview` | Version `b406bb1a-5fa4-4c94-9472-a9e68eb042b0` |
| façade URL | `https://nano-agent-orchestrator-core-preview.haimang.workers.dev` |

### 3.2 Live smoke

| 项 | 结果 |
|---|---|
| `/debug/workers/health` | `200`, `live: 6`, `total: 6` |
| `/auth/register` (device-1) | `200`, snapshot `device_uuid=11111111-1111-4111-8111-111111111111`, team_slug 已生成 |
| `/auth/me` | `200`, 返回 `snapshot.device_uuid` 与注册设备一致 |
| `/auth/refresh` | `200`, rotated token 维持同 `device_uuid` |
| `/auth/login` (device-2) | `200`, 第二设备成功入表 |
| `/me/team` GET/PATCH | `200 / 200`，team_name 成功更新，slug 保持稳定 |
| `/me/teams` | `200`，单团队列表返回正确 |
| `/me/devices` | revoke 前返回 2 个 active device；revoke 后仅剩 device-2 |
| `/me/devices/revoke` | `200`，旧 device token 后续访问 `/me/team` 变 `401` |
| `/auth/me` with `nak_*` | `200`，`snapshot.device_uuid = ""` |
| `/me/team` with `nak_*` | `200` |
| `/me/conversations?limit=1` | `200`；preview 本轮只有 1 行 conversation，cursor 形状与单测一致，未在 live 里触发翻页 |

### 3.3 Live E2E

| 测试文件 | 结果 |
|---|---|
| `test/package-e2e/orchestrator-core/09-api-key-smoke.test.mjs` | ✅ |
| `test/cross-e2e/13-device-revoke-force-disconnect.test.mjs` | ✅ |
| `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs` | ✅（回归确认 shared auth helper 未破） |

---

## 4. 已知未实装 / carry-over

| 项 | 当前状态 | 去向 |
|---|---|---|
| RH1 C2 — permission / elicitation / usage round-trip cross-e2e | 本轮未补 3 个 inherited 文件；RH3 仅补自身 `device revoke` live e2e | RH4 / RH6 e2e harness |
| RH2 C3 — WS lifecycle full hardening + alarm | revoke / wrong-device 已 live；其余 4 scenario + alarm 仍未闭合 | RH4 / RH6 |

---

## 5. RH4 Per-Phase Entry Gate 预核对

| 入口条件 | 状态 |
|---|---|
| RH3 design + action-plan reviewed | ✅ |
| RH3 closure 已发布 | ✅ 本文件 |
| preview D1 已含 migration 009 | ✅ |
| `nak_*` runtime path live | ✅ |
| device 5 链路（mint / refresh / access / WS / revoke）主链 live | ✅ |
| `/me/team`、`/me/teams`、`/me/conversations` surface 就位 | ✅ |

**RH4 可启动；但若要宣称 RH1/RH2 的 inherited realtime debt 同时收口，仍需先处理 §4 两项 carry-over。**

---

## 6. Opus 审核后校正

- 已补上 RH3 两个此前确属遗漏的代码级修正：
  1. `workers/orchestrator-auth/src/service.ts` 现在按 `nak_<keyId>.<secret>` 生成 API key，D1 `nano_team_api_keys.api_key_uuid` 只保存公开 `key_id`，verify 仍对完整 bearer 做 salted hash；历史单段 `nak_*` key 继续兼容。
  2. `workers/agent-core/src/host/do/nano-session-do.ts` 已在 `session.internal` 入口锁存 internal authority 的 `sub`，并通过 `session-do-persistence.ts` 持久化；`pushServerFrameToClient()` 不再依赖恒为空的 `env.USER_UUID`。
- 本节只校正代码与收口口径，不改写 §3 中首轮 RH3 preview/live 证据；若要把这两项修正纳入 live 证据，需要在后续 deploy 轮次重跑对应 smoke / e2e。

---

## 7. 修订历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| `r1` | `2026-04-29` | `Owner + Copilot` | RH3 首轮 closure：记录 migration 009 apply、preview deploy、worker/unit/live-e2e 结果，并显式保留 RH1/RH2 inherited carry-over |
| `r2` | `2026-04-29` | `Copilot` | 根据 Opus 审核补记 API key 存储模型与 NanoSessionDO user routing 的后续代码修正，校正 RH3 收口口径 |
