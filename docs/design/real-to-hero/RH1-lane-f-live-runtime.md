# Nano-Agent 功能簇设计模板

> 功能簇: `RH1 Lane F Live Runtime`
> 讨论日期: `2026-04-29`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告:
> - `docs/charter/plan-real-to-hero.md`
> - `docs/charter/review/plan-real-to-hero-reviewed-by-GPT.md`
> 关联 QNA / 决策登记:
> - `docs/design/real-to-hero/RHX-qna.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

RH1 的使命是把 zero-to-real 里“已经有 contract、还没有 live wiring”的 Lane F 一次性闭上：`hook.emit` 不再是 no-op，scheduler 能真正消费 `hook_emit`，permission / elicitation 不再只是存储契约，`onUsageCommit` 不再只打日志。RH1 成功与否，直接决定后续 RH2/RH3 客户端能力是否能站在真实 runtime 上。

- **项目定位回顾**：RH1 是 `live runtime closure`，不是新的产品面。
- **本次讨论的前置共识**：
  - 不新增 worker，所有活化都在现有 6-worker 内完成。
  - internal RPC 必须继续带 authority / trace，不允许为了快再开 legacy fetch 面。
- **本设计必须回答的问题**：
  - Lane F 四链怎样接成一条真实可验证路径？
  - usage / permission / elicitation 的“push vs snapshot”责任如何划分？
- **显式排除的讨论范围**：
  - `/models`、`/context` 等客户端可见性新 endpoint
  - device revoke / API key / filesystem / 多模型

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`RH1 Lane F Live Runtime`
- **一句话定义**：`把 hook / permission / elicitation / usage 四条 runtime side-channel 从 contract-only 提升为真实 live path。`
- **边界描述**：这个功能簇**包含** hook dispatcher 激活、scheduler `hook_emit` 执行、permission/elicitation waiter 真等待、usage push 到 client WS；**不包含**新客户端功能面、admin plane、device auth gate。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| Lane F | runtime live side-channel | 这里指 hook / permission / elicitation / usage |
| waiter activation | DO 内真正等待用户答案，而不是只写 KV/storage | RH1 核心 |
| usage push | quota commit 后推送给 attached client 的 live 更新 | HTTP snapshot 仍保留为严格读模型 |
| dispatcher | 把内核产生的 hook event 送到真实处理器的层 | 不能再是 no-op |

### 1.2 参考调查报告

- `docs/charter/plan-real-to-hero.md` — §7.2、§9.2、§10.1
- `docs/design/real-to-hero/RH2-llm-delta-policy.md` — usage/stream 的 snapshot-vs-push 边界

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- RH1 在整体架构里扮演 **runtime live wiring phase** 的角色。
- 它服务于：
  - attached client 的真实交互链路
  - RH2 WS / context / models 能力
  - RH3 device revoke 的 force-disconnect 基础机制
- 它依赖：
  - RH0 已冻结的测试与拆分切口
  - `NanoSessionDO` 的 deferred answer storage contract
  - orchestrator-core 的 current WS / HTTP facade
- 它被谁依赖：
  - RH2 的 WS full frame 升级
  - RH3 的 WS device gate
  - final closure 的 live runtime criterion

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| RH2 Client Visibility | RH1 -> RH2 | 强 | RH2 的 WS 能力必须站在 live runtime 之上 |
| RH3 Device Gate | RH1 -> RH3 | 中 | force-disconnect 复用 WS push / terminal path |
| Quota runtime | RH1 <-> usage | 强 | onUsageCommit 是 usage live preview 的入口 |
| User DO facade | RH1 <-> orchestrator-core | 强 | permission / elicitation / usage 都要穿过 facade |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`RH1 Lane F Live Runtime` 是 **把 runtime side-channel 变成真实客户端能力的接线层**，负责 **闭合 hook、permission、elicitation、usage 四条 live path**，对上游提供 **可被消费的实时事件**，对下游要求 **后续 phase 不再依赖 stub 或 log-only runtime**。"

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| `hook.emit` 保持 no-op | 当前最省事路径 | 直接违背 live runtime 目标 | 否 |
| 只记录 permission/elicitation 到 storage，不等待 | ZX4/ZX5 契约层遗留 | 不能形成 round-trip | 否 |
| onUsageCommit 仅 console.log | 当前实现现实 | 只证明 quota commit 发生，不证明 client 可见 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段 / 文档入口) | 第一版行为 | 未来可能的演进方向 |
|--------|--------------------------------------------------|------------|---------------------|
| hook dispatcher | runtime hook delegate | 先打通单一 dispatcher | hero-to-platform 再扩更丰富 hook bus |
| async answer waiter | DO storage + in-memory deferred map | permission / elicitation 共用同一等待原语 | 后续可扩 approval-like flows |
| usage push | user-do -> attached client WS forward | best-effort push + HTTP strict snapshot | 后续可接 richer quota / billing preview |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：usage snapshot vs usage push
- **解耦原因**：push 是实时 preview，snapshot 是严格读模型；混在一起会让一致性口径失真。
- **依赖边界**：RH1 只负责 push path 活化，HTTP snapshot 的严格语义由现有 `/usage` 和 RH2 delta-policy 文档管理。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：hook emit、permission wait、elicitation wait、usage commit emit
- **聚合形式**：统一在 session runtime / user-do relay 这一条 live path 上收敛
- **为什么不能分散**：分散之后无法形成可验证的 round-trip e2e

---

## 4. 参考实现 / 历史 precedent 对比

### 4.1 当前 runtime 的做法

- **实现概要**：runtime-mainline 已经暴露 `onUsageCommit` seam，但 hook 仍是 no-op。
- **亮点**：
  - quota commit seam 已存在
  - waiter storage + in-memory deferred map 已存在
- **值得借鉴**：
  - 复用当前 `awaitAsyncAnswer()` / `recordAsyncAnswer()` 基础设施
- **不打算照抄的地方**：
  - 继续接受“contract 已有，运行时稍后再接”

### 4.2 当前 facade 的做法

- **实现概要**：user-do 已能接收 permission / elicitation HTTP mirror，并 best-effort 转发给 agent-core。
- **亮点**：
  - facade 已是唯一 public ingress
- **值得借鉴**：
  - 继续让 orchestrator-core 保持 public -> internal relay owner
- **不打算照抄的地方**：
  - 只 200 ack，不要求 runtime 真正消费

### 4.3 RH1 的设计倾向

- **实现概要**：把现有 seam 接满，不新增抽象层。
- **亮点**：
  - 最短路径把 stub 变 live
- **值得借鉴**：
  - 在 DO 内完成 waiter / timeout / replay；在 orchestrator-core 完成 facade relay
- **不打算照抄的地方**：
  - 另开第 7 worker 或独立 bus

### 4.4 横向对比速查表

| 维度 | 当前代码 | ZX4/ZX5 contract | RH1 倾向 |
|------|----------|------------------|----------|
| hook runtime | no-op | 已有 `hook_emit` intent | live dispatcher |
| permission / elicitation | 可记录，可转发 | 等待原语已存在 | 真等待、真恢复 |
| usage | commit 后仅 log | seam 已暴露 | 真推送给 client |
| 验证口径 | 偏基础设施 | 部分 live | 完整 live runtime |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1]** hook dispatcher 激活 — `hook_emit` 必须从 kernel 意图变成真实 side-effect 路由。
- **[S2]** permission round-trip — request frame、waiter、decision forward、timeout 形成闭环。
- **[S3]** elicitation round-trip — 与 permission 对称的 ask/answer 路径成立。
- **[S4]** usage push — quota commit 之后 attached client 能收到 live 更新。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1]** token-level LLM delta streaming — 由 RH2 delta-policy 明确降级；重评条件：hero-to-platform
- **[O2]** admin / approval / policy center — RH1 只做 runtime wiring；重评条件：hero-to-platform
- **[O3]** 新 public endpoint 面 — RH1 主攻 live path，不扩产品 surface；重评条件：RH2/RH3

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| 只把 permission decision 记录到 KV/storage | out-of-scope | 不是 live runtime closure | RH1 必做 live waiter |
| usage 只更新 `/usage` HTTP snapshot | out-of-scope | 缺少 attached client 可见性 | RH1 |
| timeout fail-closed | in-scope | permission / elicitation 是 runtime gate，不可 silent allow | RH1 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **把现有 seam 真接上** 而不是 **再设计一套新 runtime bus**
   - **为什么**：当前缺的是 wiring，不是抽象层。
   - **我们接受的代价**：RH1 会直接修改核心热路径，回归面较大。
   - **未来重评条件**：如果 hero-to-platform 需要更通用的 runtime bus，再重构。

2. **取舍 2**：我们选择 **timeout fail-closed** 而不是 **超时自动 allow**
   - **为什么**：permission / elicitation 是安全与交互 gate。
   - **我们接受的代价**：客户端断开时更容易触发 deny，需要 UX 上能解释。
   - **未来重评条件**：若后续引入 richer approval policy，可再细分。

3. **取舍 3**：我们选择 **usage push 视为 best-effort preview** 而不是 **把 push 当严格真相**
   - **为什么**：严格真相仍应落在 HTTP snapshot / D1 usage read model。
   - **我们接受的代价**：短时丢 push 需要客户端自行回读 snapshot。
   - **未来重评条件**：无。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| kernel 热路径回归 | hook/scheduler 改动进入主循环 | agent-core 大量测试回归 | 严格依赖 RH0 测试基线 + RH1 e2e |
| waiter 在 DO hibernation 下丢失 | deferred map 只在内存 | 权限交互失败 | 继续复用 storage + alarm backstop |
| usage push 有 relay 断点 | onUsageCommit 接上但 user-do 不推 WS | client 仍看不到 live 预览 | 以 cross-worker e2e + preview smoke 验证整链 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：把最容易“看起来已经有了”的虚假完成态彻底剥掉。
- **对 nano-agent 的长期演进**：后续客户端功能都能建立在真实 side-channel 之上。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：permission / elicitation / usage 都是未来 richer client UX 的基础能力。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | Hook Dispatcher Live | `hook_emit` 不再 no-op，而是进入真实 dispatcher | ✅ `hook event 能被真实消费` |
| F2 | Permission / Elicitation Waiters | ask/answer 进入真等待与恢复 | ✅ `用户决策能影响运行中 turn` |
| F3 | Usage Push Relay | quota commit 后经 user-do 推到 attached client | ✅ `client 能看到 live usage preview` |

### 7.2 详细阐述

#### F1: `Hook Dispatcher Live`

- **输入**：`hook_emit` kernel decision、runtime hook delegate、authority / trace 上下文
- **输出**：可验证的 hook dispatch side-effect 与 event frame
- **主要调用者**：`KernelRunner`、`NanoSessionDO`
- **核心逻辑**：把当前 `hook.emit()` no-op 替换为真实 delegate，并让 scheduler / runtime mainline 统一消费。
- **边界情况**：
  - hook dispatcher 失败时应产生显式 error path，不允许 silent swallow。
- **一句话收口目标**：✅ **`hook_emit 从 intent 变成 live runtime event`**

#### F2: `Permission / Elicitation Waiters`

- **输入**：permission/elicitation request、`request_uuid`、client answer、timeout
- **输出**：runtime 可消费的 allow/deny/answer 结果
- **主要调用者**：`NanoSessionDO`、`orchestrator-core User DO`
- **核心逻辑**：复用已有 storage + deferred map 原语，让 request frame 发出后，真正等待用户决策再恢复 turn。
- **边界情况**：
  - timeout / disconnect 必须 fail-closed。
  - DO restart 后仍要靠 storage + sweep 恢复。
- **一句话收口目标**：✅ **`permission / elicitation 不再是只写不等的伪闭环`**

#### F3: `Usage Push Relay`

- **输入**：`onUsageCommit` 产生的 llm/tool usage 事件
- **输出**：attached client WS 收到 `session.usage.update` live preview
- **主要调用者**：`runtime-mainline`、`NanoSessionDO`、`orchestrator-core`
- **核心逻辑**：quota commit 后经 session runtime -> user-do -> client WS 形成单向 push，HTTP `/usage` 保持 strict snapshot。
- **边界情况**：
  - client 未 attached 时允许 best-effort 丢失，但下一次 `/usage` 必须可读到严格真相。
- **一句话收口目标**：✅ **`usage commit 对 client 可见，而不是只存在日志`**

### 7.3 非功能性要求与验证策略

- **性能目标**：不显著增加单次 turn 的基础延迟；waiter timeout 默认控制在合理窗口
- **可观测性要求**：每条 live path 有 trace_uuid，preview smoke 可观测
- **稳定性要求**：agent-core / orchestrator-core 测试矩阵不回归
- **安全 / 权限要求**：permission/elicitation/usage 内部转发继续带 authority 校验
- **测试覆盖要求**：每条 live runtime path ≥1 cross-worker e2e + 1 preview smoke
- **验证策略**：以 permission allow/deny/timeout、elicitation answer、usage WS push 三组证据证明 RH1 成立

---

## 8. 可借鉴的代码位置清单

### 8.1 Runtime seam

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `workers/agent-core/src/host/runtime-mainline.ts:96-113` | `MainlineKernelOptions.onUsageCommit` seam | RH1 直接复用现有 usage callback seam | 当前已暴露 |
| `workers/agent-core/src/host/runtime-mainline.ts:295-299` | `hook.emit()` 当前 no-op | RH1 的直接断点 | 必须替换 |
| `workers/agent-core/src/host/runtime-mainline.ts:240-252,323-339` | tool/llm quota commit 后调用 `onUsageCommit` | RH1 usage push 的源头 | 当前仅到 callback |

### 8.2 Session DO waiters

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `workers/agent-core/src/host/do/nano-session-do.ts:640-790` | storage + deferred map + sweep 机制 | RH1 直接站在现有等待原语上 | 现成基础设施 |
| `workers/agent-core/src/host/do/nano-session-do.ts:797-828` | `emitPermissionRequestAndAwait` / `emitElicitationRequestAndAwait` | RH1 需把“emit + await”从 contract 变 live | 当前 emit 仍 best-effort |

### 8.3 Facade relay

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `workers/orchestrator-core/src/user-do.ts:1286-1415` | permission / elicitation HTTP mirror + best-effort RPC forward | RH1 要把“best-effort”升级为真实 round-trip 一部分 | current relay owner |
| `workers/agent-core/src/host/do/nano-session-do.ts:490-501` | `onUsageCommit` 当前仅 `console.log` | RH1 usage push 的明确断点 | log-only gap |
