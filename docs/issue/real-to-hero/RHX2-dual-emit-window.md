# RHX2 Dual Emit Window

> 状态: `active-spike-window`
> 阶段: `RHX2 Phase 7`
> dual_emit_started_at: `2026-04-30T02:59:05.640Z`
> 证据目录: `.tmp/rhx2-p7-p9-spike/`

## 1. 开窗目的

RHX2 Phase 7 启动 `system.error` → `system.notify(severity="error")` 双发窗口，用于保护仍未完整适配 `system.error` 的旧客户端，同时让 `clients/web` spike 可以验证新旧错误事件的去重和 UX 分发。

## 2. 当前代码事实

- 主事件: `system.error`
- 兼容事件: `system.notify`
- 开关位置: `packages/nacp-core/src/observability/logger/system-error.ts`
- 默认状态: `DEFAULT_DUAL_EMIT_SYSTEM_NOTIFY_ERROR = true`
- 一致字段:
  - `trace_uuid`
  - `code`
  - `message`

## 3. Spike 验证入口

本窗口由 web-first spike 验证，不等待 `clients/wechat-miniprogram` 完整产品化适配。

计划中的验证入口：

1. `clients/web` transport 使用 `error-codes-client` 分类 facade error。
2. `clients/web` ChatPage 消费 `system.error`，并按 `trace_uuid + 1s` 去重双发的 `system.notify(error)`。
3. `clients/web` debug console 消费 `/debug/logs`、`/debug/recent-errors`、`/debug/audit`、`/debug/packages`。
4. `.tmp/rhx2-p7-p9-spike/` 保存自动 smoke 输出。

## 4. 切单发准入

在执行 Phase 9 切单发前，必须满足：

1. web spike build/test 通过。
2. synthetic 或真实 `system.error` 能被 web 识别。
3. 双发期间 web 只展示一次用户可见错误。
4. debug endpoints 能关联至少一个 trace。
5. closure 明确登记小程序完整适配转入后续专项计划。

若以上条件不满足，保持双发窗口，不允许静默切单发。
