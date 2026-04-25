# Nano-Agent 功能簇设计模板

> 功能簇: `Z1 Full Auth and Tenant Foundation`
> 讨论日期: `2026-04-24`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告: `docs/charter/plan-zero-to-real.md`、`docs/design/zero-to-real/ZX-binding-boundary-and-rpc-rollout.md`、`docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

Z1 的目标不是“补一个登录接口”，而是第一次让 nano-agent 拥有真实 end-user auth、真实 tenant foundation、真实 WeChat bridge，并把它们纳入 `orchestration.core` 作为唯一 public façade 的体系内。它必须足够强，能支撑 web 与 Mini Program 的真实入口；但也必须克制，不能在本阶段膨胀成完整 admin plane。

- **项目定位回顾**：Z1 是 zero-to-real 的真实用户入口层。
- **本次讨论的前置共识**：
  - `orchestration.auth` 必须 internal-only。
  - `orchestration.core` 仍是唯一 public auth proxy。
  - identity core 进入 D1 first wave。
  - WeChat bridge 属于 Z1 主线，不再 defer。
- **显式排除的讨论范围**：
  - 完整 team/member/API key admin UI
  - billing / CRM / project 类控制面
  - real provider / session history 主线

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Z1 Full Auth and Tenant Foundation`
- **一句话定义**：在 `orchestration.core` 之下建立完整 end-user auth substrate，使 user / team / token / WeChat 真实成立。
- **边界描述**：本功能簇**包含** register/login/verify/refresh/reset/me/tenant readback/WeChat bridge、identity core schema、最小 API key verify 条件面；**不包含**完整 admin plane 与 session/history 真相层。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| end-user auth | 直接面向最终用户与真实客户端的登录授权能力 | 不是 admin plane |
| auth worker | `orchestration.auth`，负责 identity/token truth 的 internal worker | internal-only |
| auth proxy | `orchestration.core` 对外暴露的 `/auth/*` / `/me` 等 façade | 唯一 public 入口 |
| WeChat bridge | `code -> openid -> identity -> JWT` 的整条桥接链路 | Z1 必做 |
| tenant foundation | user/team/membership 的最小多租户真相 | multi-tenant day-1 |

### 1.2 参考调查报告

- `docs/charter/plan-zero-to-real.md` — §1.3 / §7.2
- `docs/design/zero-to-real/ZX-binding-boundary-and-rpc-rollout.md`
- `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`
- `context/smind-admin/src/index.ts`

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **real user ingress layer** 的角色。
- 它服务于：
  - web thin client
  - Mini Program / WeChat
  - `orchestration.core` public façade
- 它依赖：
  - identity core D1 schema
  - auth worker internal transport
  - JWT / WeChat secrets
- 它被谁依赖：
  - Z2 session truth
  - Z4 real client run
  - multi-tenant negative tests

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| NACP realization | auth -> authority | 强 | verify 结果必须进入 `AuthSnapshot -> NacpAuthority` |
| D1 schema | auth -> identity tables | 强 | 所有 identity 真相落 D1 |
| Binding/RPC | orchestrator -> auth | 强 | auth worker internal-only / single caller |
| Clients | client -> orchestrator auth proxy | 强 | web / Mini Program 首个真实入口 |
| Session truth | auth -> session | 中 | session 依赖真实 user/team truth |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`Z1 Full Auth and Tenant Foundation` 是 **zero-to-real 的用户入口与租户基座**，负责 **让真实用户、真实团队、真实 JWT/WeChat 授权成立**，对上游提供 **可以直接被 web 与 Mini Program 使用的 auth façade**，对下游要求 **所有会话与运行时能力都建立在真实 tenant truth 上**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 完整 tenant admin CRUD | `smind-admin` 的完整 control plane | 会显著扩大 Z1 | 是 |
| 完整 API key admin plane | 同上 | first real run 不需要 | 是 |
| 把 auth 逻辑分散到多个 worker | 常见服务直接调用 auth DB 的捷径 | 会破坏 secret 与写入 ownership | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| identity providers | `nano_user_identities.provider` | email_password + wechat | 更多 providers |
| token state | `nano_auth_sessions` | refresh / verify 最小状态 | device/session management |
| API key verify | auth internal endpoint | 条件进入 Z1 | 完整 API key admin plane |
| me/tenant readback | public proxy + internal query | 仅最小 readback | richer profile/team settings |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：auth worker vs runtime mesh
- **解耦原因**：JWT mint、WeChat secret、identity write 权不应进入 `agent.core` / `bash.core`。
- **依赖边界**：runtime mesh 只能消费 `AuthSnapshot` / `NacpAuthority` 结果，不直接参与 token 逻辑。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：identity write ownership
- **聚合形式**：集中在 `orchestration.auth`
- **为什么不能分散**：否则 user/team/membership 真相会在多个 worker 间分叉。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：auth 不是主中心。
- **亮点**：
  - 简单
- **值得借鉴**：
  - 不把 auth 写成平台级大工程
- **不打算照抄的地方**：
  - 继续弱化真实身份与多租户

### 4.2 codex 的做法

- **实现概要**：更关注 agent/task/runtime，而非 SaaS auth。
- **亮点**：
  - control-plane 边界清晰
- **值得借鉴**：
  - 把 auth 作为独立 boundary 处理
- **不打算照抄的地方**：
  - 假设本地环境已有 identity context

### 4.3 claude-code 的做法

- **实现概要**：不以多租户 SaaS auth 为主战场。
- **亮点**：
  - 中心控制面
- **值得借鉴**：
  - 对外入口统一
- **不打算照抄的地方**：
  - 本地工具化入口优先于真实 SaaS auth

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| auth richness | 低 | 低 | 低 | 中高 |
| multi-tenant emphasis | 低 | 低 | 低 | 高 |
| WeChat/mobile auth | 无 | 无 | 无 | 高 |
| public auth façade | 弱 | 弱 | 中 | 强 |
| identity write ownership | 弱 | 弱 | 中 | 强 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1]** `orchestration.auth` internal-only bringup
- **[S2]** register / login / verify-token / refresh-token / password reset
- **[S3]** `me` / tenant readback
- **[S4]** WeChat bridge
- **[S5]** 双租户 negative tests 与 no-escalation proof

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1]** 完整 tenant/member/API key admin plane
- **[O2]** auth worker public route
- **[O3]** Z1 内处理 session/history/persistence 主线

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `orchestration.core` public `/auth/*` | in-scope | 这是 auth proxy，而不是 auth ownership |
| minimal API key verify | conditional in-scope | 仅当 server-to-server ingress 确实需要 |
| full invite/member management | out-of-scope | 会把 Z1 拉向 admin plane |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **完整 end-user auth** 而不是 **最小 login demo**
   - **为什么**：真实客户端实验需要 register/login/refresh/reset/WeChat 全链路。
   - **我们接受的代价**：Z1 实现面更大。
   - **未来重评条件**：无；这是 owner 已明确要求。

2. **取舍 2**：我们选择 **auth worker internal-only** 而不是 **auth worker 对外直暴露**
   - **为什么**：保持 `orchestration.core` 为唯一 public façade。
   - **我们接受的代价**：需要一层 public proxy。
   - **未来重评条件**：只有下一阶段明确要重构 public gateway 时。

3. **取舍 3**：我们选择 **先做 end-user auth，不吞完整 admin plane**
   - **为什么**：zero-to-real 的目标是让 real loop 跑起来，而不是先造后台系统。
   - **我们接受的代价**：某些团队管理能力后置。
   - **未来重评条件**：当 zero-to-real 已闭合。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| Z1 范围膨胀 | 把 admin plane 一并吸收 | 阻塞后续 Z2/Z3 | 明确 end-user auth vs admin plane 边界 |
| WeChat 半闭合 | 只拿 openid 不落 team/membership | Mini Program 无法进入真实 loop | 通过 Q3 明确首次登录策略 |
| auth truth 分叉 | orchestrator/runtime 也开始写 identity | token/user/team 真相漂移 | identity write ownership 固定给 auth worker |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：真实 client 终于有可靠入口。
- **对 nano-agent 的长期演进**：后续 admin plane、API key plane 都能在这个基底上逐步扩。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：真实用户与真实 tenant 成立后，所有后续能力都能在真实使用面上验证。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Auth Worker Bringup | 建立 internal-only `orchestration.auth` | ✅ **auth ownership 已从 runtime mesh 中剥离** |
| F2 | Full User Auth Flow | register/login/verify/refresh/reset/me | ✅ **web 客户端可完整登录与续期** |
| F3 | WeChat Bridge | `code -> openid -> identity -> JWT` | ✅ **Mini Program 至少可完成首次 code-level 登录** |
| F4 | Tenant Foundation | user/team/membership 真相成立 | ✅ **双租户 negative tests 可通过** |

### 7.2 详细阐述

#### F1: `Auth Worker Bringup`

- **输入**：`orchestration.core` internal auth calls
- **输出**：JWT / user / tenant truth
- **主要调用者**：`orchestration.core`
- **核心逻辑**：把 token mint/verify、identity write、WeChat bridge 集中到 auth worker。
- **边界情况**：
  - exact transport 由 Q1 定稿
  - public route 一律不放行
- **一句话收口目标**：✅ **`orchestration.auth` 已成为 internal-only single-caller worker**

#### F2: `Full User Auth Flow`

- **输入**：register/login/refresh/reset/me 等 public 调用
- **输出**：JWT、refresh state、当前 user/team 信息
- **主要调用者**：web client / Mini Program
- **核心逻辑**：由 `orchestration.core` 代理对外 auth surface，内部转给 auth worker。
- **边界情况**：
  - refresh 需要最小 token state
  - `me` / tenant readback 不等于 admin plane
- **一句话收口目标**：✅ **真实用户已能不依赖假数据进入系统**

### 7.3 非功能性要求

- **性能目标**：auth flow 必须足够轻，不能成为 real loop 的明显瓶颈。
- **可观测性要求**：所有 auth 入口要带 trace 并能回挂到 tenant/user。
- **稳定性要求**：invalid token、tenant mismatch、forged authority 必须 typed reject。
- **测试覆盖要求**：双租户负例、WeChat code-level smoke、public->internal auth proxy 证明都必须存在。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/README.md` | 轻量 agent 入口 | auth 也要控制复杂度 | 仅作克制提醒 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/README.md` | control-plane 与执行层分层 | auth worker 应是独立边界 | 间接启发 |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/Task.ts` | 控制层集中化 | 真实入口应该只有一个外部 façade | 对 `orchestration.core` 有启发 |

### 8.4 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `context/smind-admin/src/index.ts` | 适合 control-plane 工程样板，但容易连完整 admin surface 一起吸收 | zero-to-real 只吸收 end-user auth 与工程手法，不整包复制 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

Z1 是 zero-to-real 把“真实用户”引入系统的阶段。它的核心不是 auth API 数量，而是让 user/team/token/WeChat 真正进入 D1 与 runtime law。复杂度中高，但没有它，后续 session/history/runtime 都只能建立在假入口上。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | real run 必须先有真实 auth |
| 第一版实现的性价比 | 4 | 比最小 demo 重，但直接服务 zero-to-real 主线 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 5 | 没有真实用户/tenant，后续能力很难真实验证 |
| 对开发者自己的日用友好度 | 4 | 一次做对后，后续客户端与测试都更稳定 |
| 风险可控程度 | 4 | 风险主要在 scope creep，可通过边界治理控制 |
| **综合价值** | **5** | **Z1 是 zero-to-real 的第一道真实入口门** |

### 9.3 下一步行动

- [ ] **决策确认**：在 `ZX-qna.md` 回答 Q1-Q4。
- [ ] **关联 Issue / PR**：auth worker、identity migrations、WeChat bridge。
- [ ] **待深入调查的子问题**：
  - refresh state 表结构
  - default team naming / membership policy
  - minimal API key verify 是否真进 Z1
- [ ] **需要更新的其他设计文档**：
  - `ZX-nacp-realization-track.md`
  - `ZX-binding-boundary-and-rpc-rollout.md`
  - `ZX-d1-schema-and-migrations.md`

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：Z1 是做最小 login 还是完整 end-user auth
  - **A 方观点**：先最小化
  - **B 方观点**：必须完整到能支撑 real client
  - **最终共识**：后者成立

### B. 开放问题清单（可选）

- [ ] **Q1**：auth worker 的 exact transport 形态
- [ ] **Q3**：WeChat 首次登录的自动开租户策略
- [ ] **Q4**：minimal API key verify 是否真进 Z1

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-24` | `GPT-5.4` | 初稿 |
