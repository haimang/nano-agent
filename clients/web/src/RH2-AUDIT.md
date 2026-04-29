# RH2 P2-14 Web Client Adapter Audit

> 状态: `audit-only — full upgrade carried over to RH3+`
> 日期: `2026-04-29`
> 关联 action-plan: `docs/action-plan/real-to-hero/RH2-models-context-inspection.md` §5.6
> 预估升级工作量: **M-L**(原 plan §4.6 估 S-M;§5.6 即已 flag 需先 audit 再决断)

## 1. 现状

- React app(`App.tsx` + `pages/ChatPage.tsx` + `client.ts` 等),~3 KLoC
- ChatPage.tsx 已处理 lightweight 的 `llm.delta { content_type:"text" }` 与 `attachment_superseded`
- 未处理 `tool_use_start` / `tool_use_delta` / `tool.call.result` / `session.usage.update` / `session.permission.request` / `session.elicitation.request` 6 类 frame

## 2. 需要的最小升级

| 项 | 改动位置 | 工作量 |
|---|---|---|
| WS frame 解析:在 `pages/ChatPage.tsx:225` 那条 switch 链中,加入 6 类新 kind 分支 | ChatPage.tsx | S |
| Tool timeline UI:挂出 `tool_call_id → {tool_name, status, output}` 状态机,渲染 `tool_use_start` spinner、`tool_use_delta` args 增量、`tool.call.result` 终态 | 新组件 `ToolTimeline.tsx` + ChatPage 嵌入 | M |
| Permission UI:`session.permission.request` 弹出 modal,client 发回 `session.permission.decision` | 新组件 `PermissionDialog.tsx` + WS send 路径 | M |
| Elicitation UI:`session.elicitation.request` 同 permission 形式 | 新组件 + WS send | M |
| Usage panel:`session.usage.update` 实时 token / cost 计数 | `UsageBadge.tsx` | S |
| `attachment.superseded` full NACP frame:除 lightweight `attachment_superseded` 外,还需识别 NACP `session.attachment.superseded` 形态 | client.ts WS dispatch | S |
| `/models` 拉取 + model picker | `apis/models.ts` 新文件 + `ModelPicker.tsx` | S(RH5 真消费 model_id 后才载入)|
| `/sessions/{uuid}/context*` 调用入口 | `apis/context.ts` | S |

## 3. 推迟到 RH3+ 的理由

1. **本环境无 web 浏览器**:无法 manual smoke 验证 React UI 行为;preview deploy 后用户需自己 in-browser 测试
2. **RH3 D6 device gate 落地后,user_uuid 才会真正出现在 IngressAuthSnapshot**:在那之前,RH1 P1-08 的 cross-worker push 无法 deliver(`reason:"no-user-uuid-for-routing"`),所以 client 看不到 tool / permission / usage frame 的真实抵达 — UI 改了也观察不到 live 行为
3. **Charter §8.3 明文允许 RH2 不阻塞在 client UI**:Per-Phase Entry Gate 的 RH2 退出条件是"GET /models + /sessions/{id}/context 可达 + WS NACP schema 校验生效",不是"客户端 UI 已展示新帧"
4. **Wechat miniprogram 比 web 风险更高**:无 WeChat DevTool 模拟器在本环境;`api/stream.js` 改动需要真机或 devtool 验证

## 4. RH3+ 的 owner-action

- 在 RH3 D6 device gate 完成后,把以下 6 frame 接到 web ChatPage:`llm.delta tool_use_start/delta`、`tool.call.result`、`session.permission.request`、`session.elicitation.request`、`session.usage.update`、NACP-shaped `session.attachment.superseded`
- 在 RH4 file pipeline live 之后,把 wechat 的 image upload + tool stream 同样升级
- 业主自检并 owner-sign:`docs/owner-decisions/rh2-client-adapter-acceptance.md`

## 5. RH2 closure 的口径

RH2 P2-14 + P2-15 在本阶段为 **audit-only**;RH3+ phase 落地真升级。RH2 closure 把这两项显式登记为已知 carry-over,不阻塞 RH2 PASS。
