# Nano-Agent 功能簇设计模板

> 功能簇: `Z4 Real Clients and First Real Run`
> 讨论日期: `2026-04-24`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告: `docs/charter/plan-zero-to-real.md`、`docs/design/zero-to-real/Z1-full-auth-and-tenant-foundation.md`、`docs/design/zero-to-real/Z2-session-truth-and-audit-baseline.md`、`docs/design/zero-to-real/Z3-real-runtime-and-quota.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

Z4 的意义不是“再做一个 demo client”，而是让真实客户端全面进场，用真实链路把系统剩余 gap 全部逼出来并收掉。它必须同时覆盖 web 与 Mini Program，两者都要跑通 login -> start -> input -> stream -> history 的连续真实 loop；同时，它还是 zero-to-real 收纳延后 stateful 工作与 residual HTTP seam inventory 的最后阶段。

- **项目定位回顾**：Z4 是 zero-to-real 的产品真实性验收阶段。
- **本次讨论的前置共识**：
  - web client 不是演示品，而是较早稳定验证面。
  - Mini Program + WeChat 是 owner 明确要求的真实入口。
  - 双向 WS message handling 的 richer hardening 会在 Z4 收尾，但 first proof baseline 已由 Q10 冻结为 **HTTP start/input + WS stream/history**。
  - `packages/nacp-session/src/{frame,heartbeat,replay}.ts` 已提供现成 primitives；Z4 的重点是 hardening/接线，而不是从零 invent bidirectional WS。
  - residual internal HTTP 必须在 Z4 被盘点、收缩、落 backlog。
  - 当前仓库还没有真实 validation client 目录；Z4 负责引入 `clients/web/` 与 `clients/wechat-miniprogram/` 作为 greenfield deliverables。
- **显式排除的讨论范围**：
  - 完整 admin plane
  - platform dashboards / SLO / ops console
  - full stream-plane RPC-only retirement

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Z4 Real Clients and First Real Run`
- **一句话定义**：让 web 与 Mini Program 在真实 auth、真实 session、真实 provider、真实 history 上完成 first real run，并把剩余 runtime/client gap 收敛成明确 backlog。
- **边界描述**：本功能簇**包含** web hardening、Mini Program 接入、WeChat full chain、gap triage、延后 stateful 工作与 residual HTTP inventory；**不包含**下一阶段的完整产品化与全 transport 清洁。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| first real run | 真实用户在真实客户端里连续完成登录、交互、回看 | 不是单条 smoke |
| gap triage | 把真实运行暴露的问题逐项分类、修复或压成 backlog | Z4 核心方法 |
| residual HTTP | 仍未退役的 internal HTTP seam | 必须显式列举 |
| client hardening | 把试验性前端收紧为稳定验证工具 | 不等于正式产品 UI |
| delayed stateful work | Z2 未收完、但真实客户端确实需要的状态能力 | 如 bidirectional WS 等 |
| validation client repo | Z4 新增的 thin client 代码位置 | `clients/web/` 与 `clients/wechat-miniprogram/` |
| evidence pack | 一次真实 run 的结构化收口资产 | 默认落 `docs/eval/zero-to-real/evidence/z4-<trace_uuid>.json` |

### 1.2 参考调查报告

- `docs/charter/plan-zero-to-real.md` — §7.5 / §10
- `docs/design/zero-to-real/Z1-full-auth-and-tenant-foundation.md`
- `docs/design/zero-to-real/Z2-session-truth-and-audit-baseline.md`
- `docs/design/zero-to-real/Z3-real-runtime-and-quota.md`

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **real-world validation layer** 的角色。
- 它服务于：
  - owner 的真实使用实验
  - web thin client
  - Mini Program
  - final closure/handoff
- 它依赖：
  - Z1 auth truth
  - Z2 session/history truth
  - Z3 real runtime
- 它被谁依赖：
  - zero-to-real final closure
  - next-phase backlog

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| Auth foundation | client -> auth | 强 | web / Mini Program 都要依赖真实登录 |
| Session truth | client -> history/reconnect | 强 | 没有 Z2，Z4 无法闭环 |
| Real runtime/quota | client -> runtime | 强 | 没有 Z3，Z4 只能跑假 loop |
| Binding/RPC | runtime residuals -> inventory | 中 | Z4 要盘点剩余 internal HTTP |
| Delayed stateful work | client feedback -> stateful fixes | 中高 | Z4 是这些 gap 的真实暴露面 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`Z4 Real Clients and First Real Run` 是 **把前面三阶段的真实能力放进真实使用场景里检验** 的阶段，负责 **让 web 与 Mini Program 跑通 first real run，并把剩余 gap 收缩成可解释的 backlog**，对上游提供 **真实产品级验证面**，对下游要求 **所有未闭环项都被诚实分类而不是继续藏在 scaffold 里**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 正式产品级前端大工程 | SaaS 产品常见做法 | Z4 的目标是验证，不是做 full UI | 是 |
| full stream-plane RPC-only | transport purity 追求 | 会掩盖 first real run 主目标 | 是 |
| platform ops/metrics/dashboard | 运维产品线 | 超出 zero-to-real | 是 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| web client | thin client / test harness | stable validation face | richer product UI |
| Mini Program | minimal real run client | WeChat-first experiment | richer mobile UX |
| residual HTTP inventory | memo / issue list | 明确剩余 seam | 下一阶段继续退役 |
| gap triage pack | evidence + backlog | 真问题归类 | next-phase roadmap |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：real client validation vs product polishing
- **解耦原因**：本阶段要的是“真实链路成立”，不是“正式产品设计已完成”。
- **依赖边界**：只要验证目的达成，UI/交互可以保持克制，不必承担完整产品设计目标。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：gap triage、residual HTTP inventory、first real run evidence
- **聚合形式**：统一进入 Z4 closure / final closure / handoff
- **为什么不能分散**：否则下一阶段无法直接接收剩余问题。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：真实客户端与多端验证不是主战场。
- **亮点**：
  - 验证闭环直接
- **值得借鉴**：
  - 验证面保持轻量
- **不打算照抄的地方**：
  - 忽略真实客户端与多租户入口

### 4.2 codex 的做法

- **实现概要**：更偏开发者工具体验，不以 Mini Program SaaS 场景为主。
- **亮点**：
  - 交互路径清晰
- **值得借鉴**：
  - 真实用户路径要有完整生命周期证明
- **不打算照抄的地方**：
  - 本地 repo/native CLI 的默认前提

### 4.3 claude-code 的做法

- **实现概要**：本地强交互模型。
- **亮点**：
  - 复杂交互控制强
- **值得借鉴**：
  - 用真实交互暴露系统 gap
- **不打算照抄的地方**：
  - 以本地终端为核心的交互形态

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| real client emphasis | 低 | 低 | 低 | 高 |
| mobile entry | 无 | 无 | 无 | 高 |
| gap-driven validation | 中 | 中 | 高 | 高 |
| product UI depth | 低 | 低 | 中 | 低到中 |
| worker-native suitability | 低 | 低 | 低 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1]** web thin client 完整 hardening
- **[S2]** Mini Program 接入
- **[S3]** WeChat login -> start -> input -> stream -> history 全链路
- **[S4]** gap triage + 修复
- **[S5]** delayed stateful work + residual HTTP inventory

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1]** full product UI polish
- **[O2]** full stream-plane RPC-only retirement
- **[O3]** full admin plane / ops console
- **[O4]** billing / dashboard / SLO program

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| 双向 WS message handling | in-scope（Z4 收尾） | first proof 已固定为 HTTP in + WS out；WS hardening 在后半程收口 |
| web client 是否正式产品化 | out-of-scope | 其职责是稳定验证面 |
| residual HTTP 是否允许暂留 | in-scope（过渡） | 但必须被显式列出 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **让真实客户端尽早进场** 而不是 **后端全部“感觉完美”后再试**
   - **为什么**：只有真实客户端才能暴露真正的 gap。
   - **我们接受的代价**：Z4 会显得更“脏”，因为它要处理真实发现的问题。
   - **未来重评条件**：无。

2. **取舍 2**：我们选择 **thin client + Mini Program 验证面** 而不是 **正式产品级 UI**
   - **为什么**：当前目标是验证真实链路，不是做完整产品设计。
   - **我们接受的代价**：界面可能不够精致。
   - **未来重评条件**：zero-to-real 闭合后再进入下一阶段。

3. **取舍 3**：我们选择 **诚实保留 residual HTTP inventory** 而不是 **宣称 transport 已完全清洁**
   - **为什么**：真实系统中，过渡 seam 是否存在比口头“已退役”更重要。
   - **我们接受的代价**：closure 文档会承认仍有过渡面。
   - **未来重评条件**：下一阶段继续压缩即可。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| 客户端 scope 失控 | 开始追求产品 UI 完整度 | 偏离 real run 目标 | 固定 thin validation client posture |
| WS 目标过满 | day-1 强求 full bidirectional purity | 阻塞 Z4 closure | 通过 Q10 固定 first-wave baseline |
| gap triage 漂移 | 问题散在各处 | 下一阶段无法接手 | 统一写入 evidence pack / backlog |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：终于能从真实入口看到系统是否真的可用。
- **对 nano-agent 的长期演进**：Z4 产出的 gap list 会直接成为下一阶段的高质量 backlog。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：真实客户端实验会把这些方向的真实缺口暴露出来。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Web Hardening | web thin client 跑通真实闭环 | ✅ **web 已能连续完成真实 loop** |
| F2 | Mini Program Run | WeChat + Mini Program 跑通真实闭环 | ✅ **mobile 真实入口成立** |
| F3 | Gap Triage | 把真实问题系统化 | ✅ **剩余问题都变成明确 backlog** |
| F4 | Delayed Stateful Work | 收尾 bidirectional WS / IntentDispatcher / Broadcaster 等 | ✅ **客户端阻塞项被收敛** |
| F5 | Residual Transport Inventory | 盘点剩余 internal HTTP seam | ✅ **transport 过渡面被诚实记录** |

### 7.2 详细阐述

#### F1: `Web Hardening`

- **输入**：Z1 auth façade、Z2 history/readback、Z3 real runtime
- **输出**：可持续运行的 web validation client
- **主要调用者**：owner、开发者、后续 Mini Program 对照验证
- **核心逻辑**：先在 `clients/web/` 形成最薄但稳定的 public contract 消费者，跑通 login -> start -> followup -> stream -> history -> reconnect 的完整真实链路。
- **边界情况**：
  - web client 是验证面，不承担正式产品 UI polish
  - public contract 只能经 `orchestration.core`，不允许重新暴露 legacy `agent.core` public routes
- **一句话收口目标**：✅ **web 已成为 first real run 的稳定验证面，而不是 demo 壳**
- **判定方法**：
  1. `clients/web/` 能连续完成登录、开会话、提交 followup、消费 stream、读取 history。
  2. Z4 closure 附的 evidence pack 中至少有一条 web full-chain 成功 run。
  3. web client 不依赖任何私有 internal endpoint。

#### F2: `Mini Program Run`

- **输入**：WeChat code、JWT、session actions、WS stream/history
- **输出**：真实用户可持续完成的移动端 loop
- **主要调用者**：Mini Program 用户
- **核心逻辑**：在 `clients/wechat-miniprogram/` 中采用 Q10 已冻结的 baseline：HTTP `start/input` + WS `stream/history`；WS 必须显式接入 `heartbeat.ts`（间隔 `<=25s`）与 `replay.ts` cursor 重连能力。
- **边界情况**：
  - follow-up input 通过 HTTP public API 带 `session_uuid`
  - WS idle disconnect / reconnect 是 design 显式约束，不允许假设浏览器级长连接稳定性
- **一句话收口目标**：✅ **Mini Program 已不是 code-level smoke，而是真实可跑 loop**
- **判定方法**：
  1. Mini Program 可完成 WeChat login -> start -> input -> stream -> history。
  2. WS 断开后，client 通过 replay cursor 补回最近窗口帧，不出现 silent loss。
  3. Z4 evidence pack 中至少有一条 Mini Program full-chain 成功 run。

#### F3: `Gap Triage`

- **输入**：web 与 Mini Program 真实 run 暴露的问题
- **输出**：修复列表 + backlog + evidence pack
- **主要调用者**：Z4 实施者、owner、下一阶段规划者
- **核心逻辑**：每次真实 run 产出结构化 evidence pack，字段至少包括：`trace_uuid`、`client_kind`、`auth_path`、`transport_baseline`、`history_ok`、`reconnect_ok`、`runtime_ok`、`open_gaps[]`、`closure_verdict`。
- **边界情况**：
  - gap 只能归三类：`fixed-in-z4`、`deferred-next-phase`、`known-platform-limit`
  - 不允许把明显 blocker 只写成 narrative note 而不入 evidence/backlog
- **一句话收口目标**：✅ **真实问题都被收敛成可追踪、可继承的 backlog，而不是散落感受**
- **判定方法**：
  1. 每次关键真实 run 都产出 `docs/eval/zero-to-real/evidence/z4-<trace_uuid>.json` 或等价 artifact。
  2. gap 列表能与具体 trace/run 对应，不存在“口头发现、文档无证据”的问题。
  3. closure/handoff 能直接引用 evidence pack 汇总剩余问题。

#### F4: `Delayed Stateful Work`

- **输入**：Z2 未完全收口的 WS/replay/stateful 能力，以及真实客户端反馈
- **输出**：必要的 stateful hardening 或显式 backlog
- **主要调用者**：`orchestration.core`、`agent.core`、client validation 层
- **核心逻辑**：Z4 只 harden 真正阻塞 real run 的 stateful gap，优先消费既有 `frame / heartbeat / replay` primitives；`IntentDispatcher` 指 `agent.core` 内的 user-input routing seam，`Broadcaster` 指 `orchestration.core` user DO 内的多端 fanout seam，若本阶段不实现则必须进入 residual backlog。
- **边界情况**：
  - 不把 Z4 变成 full collaboration / broadcaster platform 项目
  - 若某个 stateful gap 不阻塞 first real run，可保留到下一阶段
- **一句话收口目标**：✅ **阻塞真实客户端的 stateful 缺口已被修掉或被诚实命名**
- **判定方法**：
  1. heartbeat / replay / recent-frame restore 足以支撑 Mini Program 与 web 的真实重连场景。
  2. 文档明确说明 `IntentDispatcher` / `Broadcaster` 是已实现还是 deferred backlog。
  3. 不再存在“客户端能跑但 stateful 行为无人拥有”的悬空区域。

#### F5: `Residual Transport Inventory`

- **输入**：Z2/Z3 之后仍存在的 internal HTTP seam
- **输出**：明确 inventory 与 retirement priority
- **主要调用者**：closure/handoff 作者、下一阶段规划者
- **核心逻辑**：列明保留 seam、原因、风险、下一步候选退休顺序，并区分 control-plane 已冻结“只减不增”与 stream-plane 仍在过渡中的残余面。
- **边界情况**：
  - 不要求 Z4 全部退役
  - 但不允许继续“默认存在、无人认领”
- **一句话收口目标**：✅ **transport 过渡面已从隐性债务变成显式 backlog**
- **判定方法**：
  1. inventory 至少包含 seam 名称、owner、保留原因、风险、候选退役阶段。
  2. Z4 结束时 internal HTTP seam 数量不高于 Z4 开始时基线。
  3. client-facing real run 不依赖新增 internal HTTP 接口。

### 7.3 非功能性要求

- **性能目标**：真实客户端链路可持续使用，不因 history/reconnect/stream 频繁失败。
- **可观测性要求**：每次真实 run 都能形成 evidence pack。
- **稳定性要求**：gap triage 后的问题要么修复，要么诚实入 backlog。
- **测试覆盖要求**：web full-chain、Mini Program full-chain、history/reconnect smoke、residual HTTP inventory 都要可交付。
  - **测试基础设施基线**：继续复用现有 package-e2e / cross-e2e harness，并让 `clients/web` 与 `clients/wechat-miniprogram` 成为真实 public contract 消费者。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/README.md` | 轻量验证入口 | 客户端验证面保持克制 | 仅作验证方法提醒 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/README.md` | 用户交互/执行循环说明 | real run 验证要以完整生命周期为单位 | 间接启发 |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/history.ts` | 交互历史处理 | real client 体验必须包含 history/readback | 对 Z4 有启发 |

### 8.4 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `workers/agent-core/src/index.ts` | 当前 legacy public routes 已退役但仍保留 compatibility shell | Z4 不能再把旧 public 思路捡回来，必须坚持 `orchestration.core` 唯一入口 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

Z4 是 zero-to-real 的最后一块拼图：它用真实客户端把前面三阶段的“技术正确”转成“产品可用”。它不会追求产品表面完整度，但会最大化暴露系统真实 gap，并把这些 gap 收束成下一阶段可直接继承的 backlog。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | zero-to-real 的“real”最终要靠客户端证明 |
| 第一版实现的性价比 | 5 | 不做正式产品 UI 也能得到高质量真实验证 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 5 | 真实使用会直接暴露这三条线的问题 |
| 对开发者自己的日用友好度 | 4 | 会增加 triage 工作，但结论价值很高 |
| 风险可控程度 | 4 | 通过 thin validation client posture 可控 |
| **综合价值** | **5** | **Z4 是 zero-to-real 的最终真伪裁判** |

### 9.3 下一步行动

- [ ] **已冻结答案需在实施中消费**：Q10 已在 `ZX-qna.md` 回填，Z4 action-plan 直接采用 HTTP in + WS out baseline、heartbeat、replay cursor。
- [ ] **关联 Issue / PR**：`clients/web/`、`clients/wechat-miniprogram/`、gap triage pack、residual HTTP inventory。
- [ ] **实施前必须继续对齐的 cross-cutting 文档**：
  - `Z2-session-truth-and-audit-baseline.md`
  - `Z3-real-runtime-and-quota.md`
  - `ZX-binding-boundary-and-rpc-rollout.md`

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：Z4 是不是应该先等 transport 更纯
  - **A 方观点**：先把所有内部边界做漂亮
  - **B 方观点**：真实客户端才是最终裁判
  - **最终共识**：后者优先

### B. 已冻结决策清单（可选）

- [x] **Q10**：Mini Program first-wave baseline = HTTP `start/input` + WS `stream/history`，并强制消费 heartbeat + replay cursor。

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-24` | `GPT-5.4` | 初稿 |
