# Nano-Agent 行动计划 — Web-v10 F4 Chat Mainline And Stream

> 服务业务簇: `clients/web / web-v10 / chat-mainline-and-stream`
> 计划对象: `跑通聊天主链、WS stream、resume/timeline/history 对账与运行态展示`
> 类型: `new + modify`
> 作者: `Copilot`
> 时间: `2026-04-28`
> 文件位置:
> - `clients/web/src/pages/ChatPage.tsx`
> - `clients/web/src/components/{ChatComposer,MessageList,StreamStatus}.tsx`
> - `clients/web/src/apis/sessions.ts`
> - `clients/web/src/client.ts`（WS 资产与兼容逻辑）
> - `clients/web/src/{hooks,state}/`
> 上游前序 / closure:
> - `clients/web/docs/action-plan/web-v10/F3-auth-and-session-navigation.md`
> 下游交接:
> - `clients/web/docs/action-plan/web-v10/F5-inspector-and-delivery-hardening.md`
> 关联设计 / 调研文档:
> - `clients/web/docs/charter/web-v10-foundations.md`
> - `clients/web/src/client.ts`
> - `clients/api-docs/{session,session-ws-v1,usage,permissions}.md`
> - `clients/api-docs/README.md`
> 冻结决策来源:
> - `web-v10-foundations.md` §4.1 I3 / §4.2 O2-O4 / §7.5 F4（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `executed`

---

## 0. 执行背景与目标

F4 是 web-v10 从“能进系统”走向“能真实对话”的关键 phase。它不只是发送一条消息，而是要把 `start / input / ws / resume / timeline / history` 组织成真正的聊天主链，并且诚实地把 partial capability 排除在外。

- **服务业务簇**：`clients/web / web-v10`
- **计划对象**：`chat-mainline-and-stream`
- **本次计划解决的问题**：
  - ChatPage 还没有真正的消息 ingress 与流式输出闭环。
  - 只有 happy-path 的 WS 体验不等于 real client，需要 resume/timeline/history 对账。
  - 页面需要能区分 user / assistant / runtime 状态，而不是只打印原始事件。
- **本次计划的直接产出**：
  - Chat composer 与 message list 主链
  - WS stream + ack + seq tracking + resume
  - timeline/history 回补与 reconnect 策略
- **本计划不重新讨论的设计结论**：
  - permission / elicitation modal fully live 不属于 F4（来源：charter §4.2 O3）
  - model/provider 切换控制台不属于 F4（来源：charter §4.2 O2）

### 0.1 开工前必须继承的项目上下文

1. `clients/web/docs/charter/web-v10-foundations.md`
2. `clients/api-docs/session.md`
3. `clients/api-docs/session-ws-v1.md`
4. `clients/api-docs/usage.md`
5. `clients/api-docs/permissions.md`
6. `clients/api-docs/README.md`
7. F3 的 session bootstrap 与 `clients/web/src/client.ts` 中现有 WS 资产

### 0.2 F4 接口参照入口

| F4 子目标 | 直接参考文档 | 执行注意点 |
|---|---|---|
| start / input / cancel / status / timeline / history / resume | `clients/api-docs/session.md` | `start/input/...` 与 `resume` 的成功 shape 不同；`input` 当前字段名是 `session_status` 而不是 `status` |
| public WS live behavior | `clients/api-docs/session-ws-v1.md` | 当前 live server frame 只有 `event` / `session.heartbeat` / `attachment_superseded` / `terminal` |
| usage 展示限制 | `clients/api-docs/usage.md` | 只有 HTTP snapshot，字段数值仍是 placeholder |
| permission truth limit | `clients/api-docs/permissions.md` | HTTP decision path live，但 runtime unblock 未落地；public WS 不会 live 发 `session.permission.request` |

### 0.3 F4 的强限制

1. `clients/api-docs/README.md` 当前把 `POST /sessions/{id}/messages` 列为尚未实现；F4 只能把它当作未来扩展 seam，不能当作主链硬依赖。
2. `session-ws-v1.md` 已明确：当前 public WS 不会 live 发 `session.permission.request` / `session.usage.update` / `session.elicitation.request`。
3. 因此 F4 的 authoritative recovery path 只能是：`last_seen_seq` query + HTTP `resume` + HTTP `timeline/history`。

---

## 1. 执行综述

### 1.1 总体执行方式

执行方式采用 **“先打通消息 ingress，再接 WS stream，再做 resume/timeline/history 对账，最后收口 runtime 状态展示与 partial capability framing”**。F4 只承诺真实聊天主链，不承诺 richer product richness。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Message Ingress Mainline | `M` | 接 `start / input` 主链，必要时为 `messages` 留接口位 | `-` |
| Phase 2 | Stream Runtime Wiring | `M` | 接 WS、heartbeat、seq/ack 与基础流式展示 | `Phase 1` |
| Phase 3 | Resume / Timeline / History Reconciliation | `M` | 掉线恢复、页面刷新恢复与历史回补 | `Phase 2` |
| Phase 4 | Runtime State Framing | `S` | 规范 user/assistant/runtime/reconnect/error 展示，不伪装 partial capability | `Phase 3` |

### 1.3 Phase 说明

1. **Phase 1 — Message Ingress Mainline**
   - **核心目标**：让会话有真实 ingress。
   - **为什么先做**：没有 ingress，WS 也无法承接真实业务。
2. **Phase 2 — Stream Runtime Wiring**
   - **核心目标**：把 WS 从 adapter 能力变成页面主线能力。
   - **为什么放在这里**：它需要依附已存在的 session ingress。
3. **Phase 3 — Resume / Timeline / History Reconciliation**
   - **核心目标**：避免只有 happy-path 流式显示。
   - **为什么放在这里**：只有 stream 已接上，resume 对账才有意义。
4. **Phase 4 — Runtime State Framing**
   - **核心目标**：把 runtime 事件翻译成可理解 UI，而不是原始日志。
   - **为什么放在最后**：它依赖前 3 个阶段已经定义好数据流。

### 1.4 执行策略说明

- **执行顺序原则**：`先 ingress，再 stream，再 reconcile，最后 framing`
- **风险控制原则**：`不把 permission / elicitation / model switch 混进 F4`
- **测试推进原则**：`以真实聊天手动验证、刷新恢复、断线恢复为主`
- **文档同步原则**：`partial capability 限制要与 F5 inspector 文档口径一致`
- **回滚 / 降级原则**：`若 resume/timeline 未稳定，不宣称聊天主链 fully done`

### 1.5 本次 action-plan 影响结构图

```text
web-v10 / F4 chat-mainline-and-stream
├── Phase 1: Message Ingress Mainline
│   ├── src/apis/sessions.ts
│   └── ChatComposer
├── Phase 2: Stream Runtime Wiring
│   ├── src/client.ts (WS assets)
│   ├── hooks/useSessionStream.*
│   └── MessageList
├── Phase 3: Resume / Timeline / History Reconciliation
│   └── ChatPage session recovery flow
└── Phase 4: Runtime State Framing
    ├── StreamStatus
    └── runtime event rendering
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** `POST /sessions/{id}/start`
- **[S2]** `POST /sessions/{id}/input`
- **[S3]** `GET /sessions/{id}/ws` 与 seq/ack/heartbeat
- **[S4]** `POST /sessions/{id}/resume`
- **[S5]** `GET /sessions/{id}/timeline` / `history` 回补
- **[S6]** user / assistant / runtime / reconnect / error 的基础 UI 呈现

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 实时 permission modal fully live
- **[O2]** 实时 elicitation modal fully live
- **[O3]** model/provider selector
- **[O4]** 完整附件上传/下载/预览

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| `POST /sessions/{id}/messages` | `defer / depends-on-reality-audit` | `clients/api-docs/README.md` 当前仍列为未实现；F4 只能预留 seam，不可无条件依赖 | 当 docs 与 façade 代码在同一变更中收敛时 |
| `session.permission.request` / `session.usage.update` WS live UI | `out-of-scope` | `session-ws-v1.md` 已明确当前 public WS 不会 live 发这些 frame | 后端 wire 真落地后重评 |
| timeline/history/resume | `in-scope` | 没有对账就不是 real client | 无 |
| permission / elicitation UI | `out-of-scope` | 目前会制造错误能力预期 | 后端 fully live 后重评 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | wire start/input mainline | `update` | `src/apis/sessions.ts` `ChatComposer` | 建立会话消息 ingress；`messages` 仅保留未来 seam，不作为本 phase 硬依赖 | `medium` |
| P2-01 | Phase 2 | wire ws runtime | `update` | `src/client.ts` `hooks/useSessionStream.*` | 把 stream 接到 UI 主线 | `high` |
| P3-01 | Phase 3 | add resume/timeline/history recovery | `update` | `ChatPage` `src/apis/sessions.ts` | 页面刷新与掉线后可恢复 | `high` |
| P4-01 | Phase 4 | render runtime states | `update` | `MessageList` `StreamStatus` | 流式事件变成可理解 UI | `medium` |
| P4-02 | Phase 4 | mark partial capabilities honestly | `update` | `ChatPage` `components/*` | 不伪装未完成能力 | `medium` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Message Ingress Mainline

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | wire start/input mainline | 让首消息走 `start`、后续消息走 `input`，必要时为 `messages` 保留扩展口位 | `src/apis/sessions.ts` `ChatComposer` | ChatPage 有真实 ingress | `manual chat send` | 消息可从 UI 发起到后端 |

### 4.2 Phase 2 — Stream Runtime Wiring

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | wire ws runtime | 把 `NanoClient` 中的 WS heartbeat/ack/seq 经验接入 ChatPage runtime，并严格以 `session-ws-v1.md` 当前 4 类 live frame 为准 | `src/client.ts` `hooks/useSessionStream.*` | 页面可看到真实流式输出 | `manual ws flow` | WS 不再只是底层能力，也不假设不存在的 live frame |

### 4.3 Phase 3 — Resume / Timeline / History Reconciliation

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | add resume/timeline/history recovery | 刷新/掉线后基于 resume/timeline/history 重建页面状态 | `ChatPage` `src/apis/sessions.ts` | 页面具备恢复能力 | `refresh/reconnect checks` | 不是单纯 happy-path stream |

### 4.4 Phase 4 — Runtime State Framing

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | render runtime states | 区分 user、assistant、runtime、terminal、error、reconnect 等状态 | `MessageList` `StreamStatus` | 用户能理解对话状态 | `preview manual check` | UI 不再只是打印事件 JSON |
| P4-02 | mark partial capabilities honestly | 对未 fully live 的能力给出诚实 UI 口径，不做假 modal | `ChatPage` `components/*` | 不制造错误产品事实 | `manual UX review` | 不出现假 permission/elicitation/full-file UI |

---

## 5. Phase 详情

### 5.1 Phase 1 — Message Ingress Mainline

- **Phase 目标**：让聊天页能发起真实会话消息。
- **本 Phase 对应编号**：
  - `P1-01`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `src/apis/sessions.ts`
  - `src/components/ChatComposer.tsx`
- **具体功能预期**：
  1. 首次消息与 follow-up 路径明确
  2. UI 不再依赖调试按钮触发消息
  3. `messages` 仅作为未来 seam 预留，不进入 F4 主链
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`build`
  - **回归测试**：`多轮输入检查`
  - **手动验证**：`start → input`
- **收口标准**：
  - 聊天页可以真实发消息
  - ingress 路径与会话状态对齐
- **本 Phase 风险提醒**：
  - 不能继续沿用 debug panel 的操作模型

### 5.2 Phase 2 — Stream Runtime Wiring

- **Phase 目标**：接上 WS stream 主链。
- **本 Phase 对应编号**：
  - `P2-01`
- **本 Phase 新增文件**：
  - `src/hooks/useSessionStream.*`
- **本 Phase 修改文件**：
  - `src/client.ts`
  - `src/components/MessageList.tsx`
- **具体功能预期**：
  1. 页面能订阅 session stream
  2. seq/ack/heartbeat 成为 UI 运行时的一部分
  3. 只消费 `session-ws-v1.md` 当前真实存在的 server frame
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`build`
  - **回归测试**：`stream 中断/恢复 smoke`
  - **手动验证**：`连接 WS 后看到事件与消息渲染`
- **收口标准**：
  - WS 已被页面消费
  - 流式输出不再只存在于调试日志
- **本 Phase 风险提醒**：
  - 不能只接 open/close，不处理 seq/ack 语义

### 5.3 Phase 3 — Resume / Timeline / History Reconciliation

- **Phase 目标**：让会话具备可恢复性。
- **本 Phase 对应编号**：
  - `P3-01`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `src/pages/ChatPage.tsx`
  - `src/apis/sessions.ts`
- **具体功能预期**：
  1. 刷新页面后可以恢复会话
  2. 断线重连后可以用 timeline/history 做对账
  3. recovery path 与 `session-ws-v1.md` 的 authoritative recommendation 一致
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`build`
  - **回归测试**：`refresh / reconnect`
  - **手动验证**：`进行一轮对话后刷新页面并恢复`
- **收口标准**：
  - resume/timeline/history 已形成闭环
  - 真实客户端体验不再只依赖单次 WS 连接
- **本 Phase 风险提醒**：
  - 若对账缺失，F4 不能算完成

### 5.4 Phase 4 — Runtime State Framing

- **Phase 目标**：把运行态变成可理解 UI，同时保持诚实边界。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 新增文件**：
  - `src/components/StreamStatus.tsx`
- **本 Phase 修改文件**：
  - `src/components/MessageList.tsx`
  - `src/pages/ChatPage.tsx`
- **具体功能预期**：
  1. user/assistant/runtime/reconnect/error 状态能被用户读懂
  2. 未 fully live 的能力不会被假装成完整产品功能
  3. permission / usage / elicitation 的当前限制与 `permissions.md` / `usage.md` / `session-ws-v1.md` 一致
- **具体测试安排**：
  - **单测**：`不适用`
  - **集成测试**：`build`
  - **回归测试**：`异常与 reconnect 状态检查`
  - **手动验证**：`观察多种运行态的展示`
- **收口标准**：
  - 页面可解释当前 runtime 状态
  - 不出现假 modal / 假 live usage / 假 file preview
- **本 Phase 风险提醒**：
  - F4 最容易被“能看到字了”误判为完成

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| F4 must include resume/timeline/history | `web-v10-foundations.md` §7.5 | 这是 non-happy-path 的硬闸 | 若改变，real client 定义会被削弱 |
| permission/elicitation/model chooser are out-of-scope | `web-v10-foundations.md` §4.2 | F4 必须保持 honest capability framing | 若改变，需要新 charter 或设计补充 |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| 只有 happy-path stream | 刷新/掉线无法恢复 | `high` | 强制做 resume/timeline/history |
| 将 partial capability 伪装成 fully live | UI 看似完整但事实错误 | `high` | Phase 4 强制 truth framing |

### 7.2 约束与前提

- **技术前提**：`F3 已提供稳定 session bootstrap`
- **运行时前提**：`session start/input/ws/resume/timeline/history facade 可用`
- **组织协作前提**：`F5 基于 F4 的 runtime state 和会话页面继续扩 inspector`
- **上线 / 合并前提**：`至少一轮真实对话 + 刷新恢复 + 断线恢复可走通`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `clients/web/docs/charter/web-v10-foundations.md`（若 F4 主线范围变化）
- 需要同步更新的说明文档 / README：
  - `留给 F5 的 api-contract.md`
- 需要同步更新的测试说明：
  - `无`

### 7.4 完成后的预期状态

1. ChatPage 已具备真实 ingress + stream + recovery 主链。
2. 用户可以在刷新或掉线后恢复会话。
3. 页面能够诚实展示 runtime 状态而不是原始日志。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `clients/web build`
  - `确认 ChatPage 已接 start/input/ws/resume/timeline/history`
- **单元测试**：
  - `不适用`
- **集成测试**：
  - `真实聊天主链 smoke`
- **端到端 / 手动验证**：
  - `new session → start → stream → input → refresh → resume`
- **回归测试**：
  - `断线重连 / 历史回补 / 异常展示`
- **文档校验**：
  - `确认 F4 不把 partial capability 写成已 fully live`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. ChatPage 已具备真实消息 ingress。
2. WS stream 已接入 UI 主线。
3. resume/timeline/history 已形成恢复闭环。
4. 运行态展示与 partial capability 口径一致。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `真实聊天主链成立` |
| 测试 | `至少一轮对话 + 刷新恢复 + 断线恢复可验证` |
| 文档 | `F4 边界与 charter 一致` |
| 风险收敛 | `不再只有 happy-path 流式展示` |
| 可交付性 | `F5 可直接在 ChatPage 上扩 inspector 与 delivery docs` |

---

## 9. 执行日志回填（仅 `executed` 状态使用）

| 编号 | 工作项 | 状态 | 证据 |
|------|--------|------|------|
| P1-01 | wire start/input mainline | ✅ | `ChatPage` 中 `handleSend` 区分首消息 `startSession` 与后续 `sendInput`，`messages` 仅预留 seam |
| P2-01 | wire ws runtime | ✅ | `ChatPage` 中 WS 连接、heartbeat（`src/heartbeat.ts`）、seq/ack 已接入 UI；严格消费 `event`/`session.heartbeat`/`attachment_superseded`/`terminal` 四类帧 |
| P3-01 | add resume/timeline/history recovery | ✅ | `ChatPage` useEffect 中加载 `sessionStatus` + `timeline` 重建消息历史；`last_seen_seq` 已对接 |
| P4-01 | render runtime states | ✅ | `MessageList` 内联于 `ChatPage`，区分 user/assistant/system 角色；WS 状态指示器（connected/connecting/disconnected）已展示 |
| P4-02 | mark partial capabilities honestly | ✅ | `SettingsPage` 明确列出 usage/permission/files/model selector 等限制；`InspectorTabs` 中 usage 标注为 snapshot |

**F4 收口判定**: `full close` — 真实聊天主链（start/input/ws/timeline/resume）成立，truth framing 已落实。
