# orchestrator-core / test

> 测试套件文件清单与运行约定。RH0 P0-B 落地后,本目录的纪律是:每个 product
> endpoint 有一份直达 façade 测试,文件命名 `{name}-route.test.ts`(charter §7.1)。

## 文件清单

| 文件 | 覆盖范围 |
|------|----------|
| `auth.test.ts` | `/auth/*` 7 个 RPC proxy 路由 |
| `jwt-helper.ts` | `signTestJwt(payload, secret, [expiresIn], [{kid?}])` test fixture |
| `kid-rotation.test.ts` | JWT kid graceful overlap window |
| `parity-bridge.test.ts` | JSON-pointer body diff + parity check telemetry |
| `smoke.test.ts` | F3 probe / start / ws / history / catalog / 6-worker health aggregation |
| `user-do.test.ts` | NanoOrchestratorUserDO 直调形态 |
| `messages-route.test.ts` | RH0 P0-B1 — `POST /sessions/{uuid}/messages` ≥5 case |
| `files-route.test.ts` | RH0 P0-B2 — `GET /sessions/{uuid}/files` ≥5 case |
| `me-conversations-route.test.ts` | RH0 P0-B3 — `GET /me/conversations` ≥5 case |
| `me-devices-route.test.ts` | RH0 P0-B4 — `GET /me/devices` ≥5 case(含轻量 D1 mock) |
| `permission-decision-route.test.ts` | RH0 P0-B5 — `POST /sessions/{uuid}/permission/decision` ≥5 case |
| `elicitation-answer-route.test.ts` | RH0 P0-B6 — `POST /sessions/{uuid}/elicitation/answer` ≥5 case |
| `policy-permission-mode-route.test.ts` | RH0 P0-B7 — `POST /sessions/{uuid}/policy/permission_mode` ≥5 case |
| `route-tests-audit.md` | RH0 P0-B0 — 7 份新测试上线前 mock env 兼容性审查文档 |

## 运行

```bash
# 全套(115 case)
NODE_AUTH_TOKEN=$NODE_AUTH_TOKEN pnpm --filter @haimang/orchestrator-core-worker test

# 单一文件
NODE_AUTH_TOKEN=$NODE_AUTH_TOKEN \
  pnpm --filter @haimang/orchestrator-core-worker exec vitest run test/messages-route.test.ts
```

## RH1+ Carry-over

GPT 严格审查(2026-04-29)指出 RH0 7 份 route test 在以下行为口径上锁定了"当前真相",但
偏离 action-plan §4.4 列出的"理想行为":
- `messages-route` 4xx/404 case 测的是 `403 missing-team-claim` + `400 empty-body` + `404 unknown sub-route`,而不是 `403 wrong device` + `400 invalid kind` + `404 unknown session`(后者要求 device gate / messages body schema / User-DO 404 — 由 RH3 + RH5 接通)
- `files-route` cross-team 仍是 façade idFromName 路由验证(不是 403),对应 RH3 device gate 的 carry-over
- `me-conversations-route` cursor / next_cursor=null 行为由 RH2 `/me/conversations` 双源对齐时落地(action-plan RH3 §)
- `me-devices-route` revoked filter 由 RH3 device gate 实装时改 `?status=active` query option 后再调
- `permission-decision-route` / `elicitation-answer-route` 的 `unknown request_uuid` / `409 idempotent` 测试由 RH1 P1-C frame emit 完成后才有意义(目前 User-DO RPC 仅 stub)
- `policy-permission-mode-route` `400 invalid mode` + `200 read` 由 RH1 facade 真校验后再补

每条 carry-over 都已在 `docs/issue/real-to-hero/RH0-closure.md` §4 + RH1 action-plan 的
"已知遗留" 章节登记。
