# Hero-to-Pro Manual Evidence Pack — Scaffold + Owner-Action Checklist

> 文档状态: `cannot-close (owner-action-blocked)`
> 服务业务簇: `hero-to-pro / HP9`
> 关联 action-plan: `docs/action-plan/hero-to-pro/HP9-action-plan.md` §4.4 P4-01
> 关联 design: `docs/design/hero-to-pro/HP9-api-docs-and-manual-evidence.md` §7 F3
> 冻结决策来源: `docs/design/hero-to-pro/HPX-qna.md` Q30
> 实施者笔记日期: `2026-05-01`

---

## 0. 当前状态

本文件是 HP9 frozen pack 中的 **manual evidence 总索引**。HPX-Q30 把 manual evidence 冻结为 hard gate，不允许继续 defer。HP9 closure 自身的 `cannot-close` 状态正是源于本文件描述的 owner-action 任一时点未完成；当全部 5 设备 evidence 完成时，本文件升级为 `complete`，HP9 closure 才允许从 `cannot-close` 升级为 `closed`。

**实施者侧已完成**（claude-opus-4-7，2026-05-01）：

- 本索引文件骨架与 owner-action checklist
- evidence 目录结构约定（`docs/evidence/hero-to-pro-manual-<date>/device-<name>/`）
- 5 设备矩阵清单
- per-device step log template
- not-applicable-with-reason 规则（HPX-Q30）

**owner 侧待完成**（5 项）：

- 5 套设备的实际录制 + 截图 + step log + trace UUID 绑定
- evidence artifact 上传到 `docs/evidence/...`
- failure / caveat 现场记录
- HP9 closure §4 中 evidence 表的最终回填

---

## 1. Owner-Action 时间表（Q30 hard gate）

| 时点 | 任务 | 失守即触发 |
|------|------|------------|
| HP9 启动日 | 冻结 5 设备清单 + 录制脚本 owner | `cannot-close` |
| HP9 启动 + 3 日 | 完成脚本与环境（设备就位、账号准备、wrangler env 检查） | `cannot-close` |
| HP9 启动 + 7 日 | 完成 5 设备录制（含截图 / 录屏 / step log） | `cannot-close` |
| HP9 启动 + 10 日 | evidence 索引最终回填本文件 + HP9 closure §4 | `cannot-close` |

任一时点未及时履约，HP9 必须显式标 `cannot-close`，**不允许降级为 `partial-close`**（HPX-Q30 frozen）。

---

## 2. Device Matrix（HPX-Q30 frozen）

| # | Device | Browser / Runtime | 测试角色 |
|---|--------|-------------------|----------|
| 1 | Chrome web (desktop) | Chrome ≥ 120 | 主线 web client |
| 2 | Safari iOS | iOS Safari (latest stable) | iOS PWA / mobile web |
| 3 | Android Chrome | Android Chrome (latest stable) | Android mobile web |
| 4 | WeChat 开发者工具 | 最新版 mp dev tools | 开发态 wechat-mini-program |
| 5 | WeChat 真机 | 实际安装版 wechat | prod 真机验证 |

---

## 3. Evidence Directory Convention

```text
docs/evidence/hero-to-pro-manual-2026-05-XX/
  device-chrome-web/
    01-step-log.md
    02-register-screenshot.png
    03-login-screenshot.png
    04-start-session.mp4
    05-ws-connect-screenshot.png
    06-todo-create.mp4
    07-workspace-readback.png
    08-compact-trigger.mp4
    09-checkpoint-create.png
    10-device-revoke-flow.mp4
    failures.md
    caveats.md
    trace-uuids.txt
  device-safari-ios/
    ...
  device-android-chrome/
    ...
  device-wechat-devtool/
    ...
  device-wechat-real/
    ...
```

每设备目录至少包含：
- `01-step-log.md` — 按本索引 §4 的 step list 逐条记录
- 各步骤的 screenshot / clip references
- `failures.md` — 出现的 failure / regression
- `caveats.md` — `not-applicable-with-reason` 的步骤
- `trace-uuids.txt` — 现场每步 trace UUID（便于 server 端对照）

---

## 4. Per-Device Step List（每台设备都要走完）

| # | 步骤 | 验证要点 | 记录什么 |
|---|------|----------|----------|
| 01 | Register | `POST /auth/register` → 200 | trace UUID, response screenshot |
| 02 | Login (email/password) | `POST /auth/login` → 200 + access_token | trace UUID |
| 03 | (WeChat 设备) WeChat login | `POST /auth/wechat/login` → 200 | trace UUID, openid 是否拿到 |
| 04 | Mint pending session | `POST /me/sessions` → 201 | session UUID |
| 05 | Start session | `POST /sessions/{id}/start` → 200 + `session_status: active` | trace UUID, clip |
| 06 | WS connect + heartbeat | `GET /sessions/{id}/ws` → 收到 `session.heartbeat` | screenshot of devtools network panel |
| 07 | Send text input | `POST /sessions/{id}/input` → LLM `llm.delta` 流式 | clip |
| 08 | Multipart message + image | `POST /sessions/{id}/messages` with image part | clip |
| 09 | Create todo | `POST /sessions/{id}/todos` → 201 + `session.todos.write` WS frame | clip |
| 10 | Update todo to in_progress | `PATCH /sessions/{id}/todos/{uuid}` → `session.todos.update` | screenshot |
| 11 | (尝试) 第二个 todo 也 in_progress | 应得到 `409 in-progress-conflict` | screenshot |
| 12 | Compact preview | `POST /sessions/{id}/context/compact/preview` → 200 | trace UUID |
| 13 | Compact 真实触发 | `POST /sessions/{id}/context/compact` → `compact.notify` WS frame | clip |
| 14 | Create user-named checkpoint | `POST /sessions/{id}/checkpoints` → 201 | screenshot |
| 15 | Checkpoint diff | `GET .../checkpoints/{uuid}/diff` → 三层 delta | screenshot |
| 16 | Permission ask flow（如果触发） | tool ask → `session.confirmation.request{kind:"permission"}` WS frame → `POST /confirmations/{uuid}/decision` | clip |
| 17 | Cancel turn | `POST /sessions/{id}/cancel` → 200 + `session.update phase=ended` | screenshot |
| 18 | Close session | `POST /sessions/{id}/close` → `ended_reason: closed_by_user` | screenshot |
| 19 | Soft delete conversation | `DELETE /sessions/{id}` → tombstone | screenshot |
| 20 | Device revoke from `/me/devices` | `POST /me/devices/revoke` → WS `session.attachment.superseded` reason `revoked` + close code `4001` | clip |

不在 product surface 内的步骤（如 device 没有 WeChat 浏览器）必须在 `caveats.md` 中以 `not-applicable-with-reason: <具体说明>` 形式记录；**禁止写"不适用 / 跳过"** 而无 reason。

---

## 5. Failure / Regression 记录规则

`failures.md` 中每条 failure 至少：

```markdown
## F<N>

- **Device**: chrome-web
- **Step**: 13 compact 真实触发
- **Symptom**: WS 收到 `compact.notify status=failed` 而不是 `started/completed`
- **trace_uuid**: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
- **server-side log line**: (粘贴 wrangler tail 关键行；redact secret)
- **classification**: `regression` | `known-deferred (HP3 auto-compact not-wired)` | `environmental`
- **owner action**: open issue / file P0 / handed-to-platform
```

---

## 6. Final Result Table（owner 回填）

| Device | Steps Pass | Steps NA-w-reason | Failures | Evidence Path |
|--------|-----------|-------------------|----------|---------------|
| Chrome web | (待) | (待) | (待) | `docs/evidence/hero-to-pro-manual-<date>/device-chrome-web/` |
| Safari iOS | (待) | (待) | (待) | `docs/evidence/hero-to-pro-manual-<date>/device-safari-ios/` |
| Android Chrome | (待) | (待) | (待) | `docs/evidence/hero-to-pro-manual-<date>/device-android-chrome/` |
| WeChat 开发者工具 | (待) | (待) | (待) | `docs/evidence/hero-to-pro-manual-<date>/device-wechat-devtool/` |
| WeChat 真机 | (待) | (待) | (待) | `docs/evidence/hero-to-pro-manual-<date>/device-wechat-real/` |

---

## 7. 当前判定

**Verdict**: `cannot-close (owner-action-blocked)`

- 5 设备录制未发生（claude-opus-4-7 没有任何一台物理设备访问权）
- evidence artifact 目录为空
- 本表 §6 所有行为 `(待)`

升级路径：

1. owner 在 HP9 启动日 + 0/+3/+7/+10 四时点完成对应 milestone
2. 把 evidence artifact 落到 `docs/evidence/hero-to-pro-manual-<date>/...`
3. 把本文件 §6 表完整回填
4. HP9 closure §4 中 evidence verdict 行从 `cannot-close` 升级为 `complete`
5. 触发 HP9 整体 verdict 重判（HP10 final closure 阶段会复核）

---

## 8. Frozen Decisions

| Q ID | 内容 | 影响 |
|------|------|------|
| Q30 | manual evidence 是 hard gate，不允许继续 defer | HP9 缺任一设备即 `cannot-close`；不可降级为 `partial-close` |
| Q30 (子条款) | `not-applicable-with-reason` 仅适用产品边界不适用 | 不允许 "暂时没设备" 作为 NA reason |
