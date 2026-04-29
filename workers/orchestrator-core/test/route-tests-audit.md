# Mock Env Audit (P0-B0) — RH0 Phase 4 Prep

> 服务: `orchestrator-core / test/`
> 目的: 在批量新增 7 份 `*-route.test.ts` 之前 audit 现有 mock env 是否能承载新测试模式
> 时间: `2026-04-29`
> 关联 action-plan: `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md` §4.4 P0-B0

## 1. Audit 范围

现有测试文件:
- `auth.test.ts` — auth proxy routes
- `kid-rotation.test.ts` — JWT kid graceful overlap
- `parity-bridge.test.ts` — JSON-pointer body diff
- `smoke.test.ts` — F3 probe + start/ws/history/auth + catalog
- `user-do.test.ts` — User-DO direct call shape
- `jwt-helper.ts` — `signTestJwt(payload, secret, expiresIn?, opts?)`

## 2. 关键 mock pattern

| 模式 | 当前可用性 | 备注 |
|------|------------|------|
| `worker.fetch(req, env, ctx)` 直调 | ✅ | env 形如 `{ JWT_SECRET, TEAM_UUID, ORCHESTRATOR_USER_DO: { idFromName, get } }` |
| `JWT_SECRET` 长度 ≥32 | ✅ | `"x".repeat(32)` |
| `signTestJwt({sub, team_uuid, ...}, secret)` | ✅ | jwt-helper.ts |
| `ORCHESTRATOR_USER_DO` mock | ✅ | `idFromName + get` 2 函数即可,session-bound 路由用 `stub.fetch()` 转发 |
| `NANO_AGENT_DB` mock(D1) | ⚠️ 部分 | `me-devices` 路由会 `db.prepare(...).bind(...).all()`,新测试需提供 D1 mock fixture |
| `parseBody` body 解析 | ✅ | 直接 `JSON.stringify(body)` |
| `x-trace-uuid` header | ✅ | smoke.test.ts 已示范 |
| `needsBody` true 路由 (messages/permission/elicitation) | ✅ | parseBody allowed,空 body → 400 invalid-{action}-body |
| `optionalBody`(cancel/resume) | ✅ | smoke 已涵盖 |
| 4-segment compound 路由 (`permission/decision`/`policy/permission_mode`/`elicitation/answer`)| ✅ | parseSessionRoute 已支持 |

## 3. 新增 fixture 需求

为支持 `me-devices-route.test.ts` 的"已 revoke 不出现"+"跨 user 不可见"两个 case,需要轻量 D1 mock。最小 fixture:

```ts
function createD1Mock(rows: Array<Record<string, unknown>>) {
  return {
    prepare: (_sql: string) => ({
      bind: (..._args: unknown[]) => ({
        all: async () => ({ results: rows }),
        first: async () => rows[0] ?? null,
        run: async () => ({ success: true, meta: { changes: 1 } }),
      }),
    }),
  } as any;
}
```

此 fixture 直接 inline 在 me-devices-route.test.ts(不抽公共 helper,避免在 RH0 引入预设 abstraction;若 RH3 device gate 需要更复杂 mock,届时再抽)。

## 4. 判定

✅ 现有 mock baseline **足以承载** 7 份 `*-route.test.ts` ≥35 case;只需 me-devices-route 自带 D1 fixture。其他 6 份完全复用 jwt-helper + ORCHESTRATOR_USER_DO mock。

## 5. 命名 / 计数

- 文件命名遵循 charter §7.1 `{name}-route.test.ts`(7 份):
  1. `messages-route.test.ts` — ≥5 case
  2. `files-route.test.ts` — ≥5 case
  3. `me-conversations-route.test.ts` — ≥5 case
  4. `me-devices-route.test.ts` — ≥5 case (含 revoke + cross-user)
  5. `permission-decision-route.test.ts` — ≥5 case
  6. `elicitation-answer-route.test.ts` — ≥5 case
  7. `policy-permission-mode-route.test.ts` — ≥5 case

合计 ≥35 case,满足 charter §7.1 hard gate。
