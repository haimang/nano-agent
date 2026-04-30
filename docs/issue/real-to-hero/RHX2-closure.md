# RHX2 Closure — Observability & Auditability

> 文档状态: `closed-as-web-first-spike`
> 阶段: `real-to-hero / RHX2`
> 设计文件: `docs/design/real-to-hero/RHX2-observability-and-auditability.md`
> 施工文件: `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md`
> Spike 计划: `.tmp/RHX2-P7-P9-web-spike-plan.md`
> Spike 证据: `.tmp/rhx2-p7-p9-spike/smoke-output.json`

## 1. 收口结论

RHX2 已完成从 schema-only observability 到 runtime-wired observability 的主线建设，并完成 Phase 7-9 的 web-first spike 收口。

当前不切 `system.error` 单发。Phase 9 gate 的正确结论是：双发窗口继续保持，原因是原始 Q-Obs11 要求的观察窗口尚未满足，且 `clients/wechat-miniprogram` 的完整产品化适配已按 owner 指令后移到独立客户端专项。此处不是未执行，而是 gate evaluation 后选择安全默认：继续双发，避免旧客户端丢错误提示。

## 2. Phase-by-Phase 状态

| Phase | 状态 | 结果 |
|---|---:|---|
| Phase 1 | done | 扩展 `@haimang/nacp-core` observability/logger 与 error-codes-client 出口，建立包来源与 debug packages 基础。 |
| Phase 2 | done | error registry / client meta 基础完成，给前端提供可消费的 `getErrorMeta()` / `classifyByStatus()`。 |
| Phase 3 | done | D1 error/audit 表与相关写入契约进入主线。 |
| Phase 4 | done | 6-worker logger wiring 主线完成，裸 `console.*` 退出 prod 关键路径。 |
| Phase 5 | done | `system.error`、first-wave audit event、D1/RPC/R2 alert 触发点进入 runtime。 |
| Phase 6 | done | `/debug/logs`、`/debug/recent-errors`、`/debug/audit`、`/debug/packages` 与 cron retention cleanup 完成。 |
| Phase 7 | done | `system.error` + `system.notify(error)` 双发窗口开启，兼容 notify 携带 `code` / `trace_uuid`。 |
| Phase 8 | done-as-spike | `clients/web` 完成 error meta、WS system.error、debug inspector、synthetic trigger 的 spike 适配。 |
| Phase 9 | gate-evaluated | 不提前切单发；closure 记录顺延原因与后续专项边界。 |

## 3. 本轮 Phase 7-9 实际完成内容

### 3.1 双发窗口

`packages/nacp-core/src/observability/logger/system-error.ts` 新增：

1. `DEFAULT_DUAL_EMIT_SYSTEM_NOTIFY_ERROR = true`
2. `dualEmitSystemNotifyError` 开关
3. `SystemErrorFallbackNotify` 兼容 payload
4. 成功 emit `system.error` 后同步 emit `system.notify(severity="error")`
5. fallback notify 与 dual notify 均携带 `code` 和 `trace_uuid`

`packages/nacp-session/src/stream-event.ts` 同步允许 `system.notify` 携带可选 `code` / `trace_uuid`，让双发 dedupe 有稳定依据。

### 3.2 Web error meta

`clients/web/src/apis/transport.ts` 改为使用：

1. `getErrorMeta(code)`
2. `classifyByStatus(status)`
3. 新增 `ApiError.category`
4. 新增 `ApiError.retryable`
5. 保留 `ApiError.kind` 的四类兼容面：`auth.expired` / `quota.exceeded` / `runtime.error` / `request.error`

依赖方式为 `@haimang/nacp-core: file:../../packages/nacp-core`，符合当前 web spike 在 monorepo 内验证真实共享包出口的目标。

### 3.3 Web WS modernization

`clients/web/src/pages/ChatPage.tsx` 已更新：

1. 消费 `payload.kind === "system.error"` 与 top-level `kind === "system.error"`。
2. 按 `trace_uuid + code` 记录 1s 去重窗口，抑制双发的 `system.notify(error)` 重复展示。
3. 识别 `session.attachment.superseded`。
4. 识别 `session.end`。
5. 发送现代 `kind` frame：`session.heartbeat`、`session.resume`、`session.stream.ack`。
6. 增加 `spike error` 按钮触发 synthetic `system.error`。

### 3.4 Debug / inspector

`clients/web/src/apis/debug.ts` 新增：

1. `logs()`
2. `recentErrors()`
3. `audit()`
4. `packages()`

`clients/web/src/components/inspector/InspectorTabs.tsx` 新增：

1. `files`
2. `logs`
3. `recent`
4. `audit`
5. `packages`

`HealthPage` 与 `SettingsPage` 同步更新 RHX2 事实：debug packages、dual emit window、filesystem-backed files route。

### 3.5 Synthetic trigger

`workers/orchestrator-core/src/user-do-runtime.ts` 新增 preview/spike 保护分支：

```json
{
  "check": "emit-system-error",
  "code": "spike-system-error"
}
```

该分支要求 `NANO_ENABLE_RHX2_SPIKE=true`，且必须有 attached WebSocket client，否则返回 `409 no-attached-client`。`workers/orchestrator-core/wrangler.jsonc` preview vars 已开启该开关。

## 4. 验证证据

已通过：

1. `pnpm --filter @haimang/nacp-core typecheck`
2. `pnpm --filter @haimang/nacp-core test`
3. `pnpm --filter @haimang/nacp-core build`
4. `pnpm --filter @haimang/nacp-session typecheck`
5. `pnpm --filter @haimang/nacp-session test`
6. `pnpm --filter @haimang/nacp-session build`
7. `pnpm --filter @haimang/orchestrator-core-worker typecheck`
8. `pnpm --filter @haimang/orchestrator-core-worker test`
9. `pnpm --filter @haimang/orchestrator-core-worker build`
10. `cd clients/web && npm install --ignore-scripts && npm run build`
11. `node .tmp/rhx2-p7-p9-spike/smoke.mjs`

Spike smoke 固化检查：

1. client error meta import 与 registry fallback。
2. `system.error` dual emit 默认开启，且 code/trace 一致。
3. web WS `system.error` / `system.notify(error)` dedupe。
4. web modern session heartbeat/resume/ack frame。
5. web debug endpoint API 覆盖。
6. orchestrator preview-only synthetic trigger。

## 5. Deferred / 顺延项

| 项目 | 状态 | 原因 | 后续归属 |
|---|---:|---|---|
| `clients/wechat-miniprogram` 完整适配 | deferred | owner 已明确 RHX2 结束后再进入真实 web + 小程序客户端完整适配；本轮只做 web-first spike。 | 独立客户端适配专项 |
| `system.error` 切单发 | deferred-by-gate | Q-Obs11 的观察窗口与完整客户端条件未满足；提前切单发会让旧客户端丢错误提示。 | 双发观察窗口结束后执行 |
| preview live 人工点击 `spike error` 证据截图 | deferred | 当前闭合到代码构建 + smoke 自动化；真实预览环境点击需要部署后的人工验证。 | deploy 验证清单 |
| `/debug/packages` production 现场截图 | deferred | 当前代码与测试通过；生产现场验证需部署后执行，不能在本地 closure 伪造。 | deploy 验证清单 |

## 6. 风险判断

1. 双发窗口保持是安全默认。它增加短期 WS 噪音，但 web 已具备 `trace_uuid + code` 去重，旧客户端仍能收到 `system.notify(error)`。
2. web 依赖 `file:../../packages/nacp-core` 是 spike 合理选择，验证的是真实包出口；后续产品化需要改为发布包版本或 Pages 构建可解析的固定 tarball。
3. Synthetic trigger 被 `NANO_ENABLE_RHX2_SPIKE=true` 保护，且只在 attached WS 下发帧；不应在 production vars 中开启。
4. Phase 9 未切单发不是失败，而是按照 gate 规则避免过早收敛。

## 7. 最终收口判断

RHX2 的后端 observability / auditability 主线已经收口；Phase 7-9 按 owner 最新要求完成 web-first spike 收口。当前可以进入后续 RHX2 实验验证或独立客户端适配专项，但不应宣称 `system.error` 已切单发，也不应宣称小程序已经产品化适配。
