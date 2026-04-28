# nano-agent web-v10 foundations

> **文档对象**：`clients/web first real web foundation`
> **状态**：`active charter`
> **日期**：`2026-04-28`
> **作者**：`Copilot`
> **文档性质**：`foundation charter`
> **文档一句话定义**：`为 nano-agent 的真实 Web 前端冻结 web-v10 的起跑线、边界、Phase 职责与退出条件。`
>
> **修订历史**：
> - `r1`：将 `clients/web/docs/web-v1-roadmap.md` 重写为 foundations charter，停止用“roadmap + checklist”混合文体承载基石职责。
> - `r0`：早期 `web-v1-roadmap` 草案，只提供执行清单，不足以承担 charter 角色。
>
> **直接输入包（authoritative）**：
> 1. `docs/templates/charter.md`
> 2. `clients/web/package.json`
> 3. `clients/web/src/{main.ts,client.ts}` 与 `pnpm-workspace.yaml`
>
> **ancestry-only / 背景参考（不作为直接入口）**：
> - user direction：`仿照 open web ui 的样式, 使用 dark mode, 技术栈使用 cloudflare pages + vite + react`
> - user direction：`nano-agent web / apis / components / pages / constants / docs`
>
> **下游预期产物**：
> - `clients/web/docs/action-plan/web-v10/{F0-foundation-freeze,F1-react-shell-reset,F2-bff-and-transport-split,F3-auth-and-session-navigation,F4-chat-mainline-and-stream,F5-inspector-and-delivery-hardening,F6-closure-and-handoff}.md`
> - `clients/web/docs/web-v10-closure.md`
> - `clients/web/docs/setup.md` / `deployment.md` / `api-contract.md`

---

## 0. 为什么这份 charter 要现在写

### 0.1 当前时点的根本原因

`clients/web` 已经不再是“是否要做 Web”的讨论阶段，而是进入“必须给真实前端建立起点”的阶段。当前仓库里已经有一个可以跑通 auth、session、usage、catalog、WS 的 dogfood client，但它仍然是 `Vite + TypeScript + 原生 DOM` 的调试壳，而不是一个可以承接真实用户体验、页面组织、BFF 分层与长期迭代的 Web 产品入口。

旧的 `web-v1-roadmap.md` 适合作为执行清单，却不足以承担基石文件职责。它把“架构决策、边界冻结、Phase 责任、退出口径、未来能力限制”混在同一份 roadmap 里，会导致后续执行者把尚未冻结的判断误读为已确认真相，也容易把 Open WebUI 风格的视觉目标误推成“后端能力已齐备”。

因此，现在需要一份 **web-v10 foundations charter**，把 `clients/web` 的第一阶段定位为 **真实前端的基石与起点**：它不追求一次性完成完整产品，而是先冻结正确的技术姿势、边界纪律、实施顺序与成功/失败定义。

### 0.2 这份文档要解决的模糊空间

1. `clients/web` 究竟是继续长成 demo，还是升级为真实的 Web 客户端基线。
2. Pages / React / BFF / WS 的协作方式，哪些属于已冻结姿势，哪些仍是后续设计细节。
3. 前端应该承诺哪些真实能力，哪些后端尚未 fully live 的能力必须明确排除。

### 0.3 这份 charter 的职责，不是别的文件的职责

- **本 charter 负责冻结**：
  - web-v10 的目标定义、起跑线、技术姿势与系统边界。
  - web-v10 各 Phase 的职责切分、交付方向与收口标准。
  - web-v10 对后端真实能力的诚实口径：哪些可以接，哪些不能伪装成已完成。
- **本 charter 不负责展开**：
  - React 组件树、状态管理、BFF 目录到文件级别的详细设计（应在：`clients/web/docs/action-plan/web-v10/F0-F6` 或专项 design 文档）。
  - 逐接口字段级 contract、截图、部署截图、操作手册（应在：`api-contract.md` / `setup.md` / `deployment.md`）。

---

## 1. 本轮已确认的 Owner Decisions 与基石事实

### 1.1 Owner Decisions（直接生效）

| 编号 | 决策 | 影响范围 | 来源 |
|------|------|----------|------|
| D1 | Web 前端风格以 Open WebUI 的 dark mode 体验为参考，但不是照搬其产品范围。 | UI 视觉、布局与交互预期 | user direction |
| D2 | 技术栈冻结为 `Cloudflare Pages + Vite + React + TypeScript`。 | 工程脚手架、部署模型、BFF 选型 | user direction |
| D3 | `clients/web` 目录按 `apis / components / pages / constants / docs` 的产品化结构演进。 | 前端项目内部分层 | user direction |

### 1.2 已冻结的系统真相

| 主题 | 当前真相 | 本阶段如何继承 |
|------|----------|----------------|
| 当前前端壳 | `clients/web/package.json` 只有 `vite + typescript`，说明当前仍是轻量 dogfood 工程，而不是 React 产品壳。 | web-v10 必须把“demo client”升级为正式前端工程起点。 |
| 当前 UI 实现 | `clients/web/src/main.ts` 是原生 DOM 面板，直接堆按钮、输入框与日志区。 | web-v10 明确禁止继续在 `main.ts` 上叠产品逻辑，必须改造成 React shell。 |
| 当前 transport 资产 | `clients/web/src/client.ts` 已经封装 auth/session/usage/catalog/ws 等 adapter。 | web-v10 要复用 transport 资产，但拆出更清晰的前端 API 与 BFF 分层。 |
| dogfood consumer discipline | `pnpm-workspace.yaml` 已明确要求 dogfood consumer 保持在 workspace 之外，以验证 published/tarball 路径。 | web-v10 不得把 `clients/web` 拉入根 workspace。 |

### 1.3 明确不再重讨论的前提

1. `orchestrator-core` 是客户端唯一 public facade；Web 客户端不直连其他 5 个 worker。
2. HTTP 主路径应通过 same-origin BFF 收口；浏览器跨域直打 upstream 不作为 foundation 默认路线。
3. Web 第一阶段必须以真实后端能力为准，不能为了 UI 完整感伪装 permission / elicitation / usage live push / model switcher。

---

## 2. 当前真实起点（Reality Snapshot）

### 2.1 已成立的 shipped / frozen truth

| 主题 | 当前现实 | 证据 |
|------|----------|------|
| 工程基线 | `clients/web` 已可 `dev/build/preview`，但尚未引入 React。 | `clients/web/package.json` |
| 调试能力 | 现有页面已能触发 register、login、me、worker health、session start/input、timeline、usage、resume、catalog、WS。 | `clients/web/src/main.ts` |
| transport 能力 | `NanoClient` 已有 auth、session、usage、permission、catalog 与 WS heartbeat/ack 逻辑。 | `clients/web/src/client.ts` |
| 部署定位 | 当前默认 upstream 仍是 preview worker URL，说明它是 dogfood/probe client，不是 production-ready web app。 | `clients/web/src/main.ts` |
| workspace 纪律 | 仓库已显式要求 dogfood consumer 不进入 workspace links。 | `pnpm-workspace.yaml` |

### 2.2 当前仍然存在的核心 gap

| 编号 | gap | 为什么必须在本阶段处理 | 若不处理会怎样 |
|------|-----|------------------------|----------------|
| G1 | 没有 React app shell、页面结构与组件层 | 没有产品级 UI 骨架，就无法承接真实客户端演进 | `clients/web` 会继续变成 demo 与产品混合体 |
| G2 | 没有 same-origin BFF，HTTP transport 仍是直接面向 upstream 的调试适配 | Web 真实部署需要更稳定的同域 HTTP 收口与错误归一 | 浏览器环境、鉴权与环境切换会长期分裂 |
| G3 | 没有对后端“partial truth”做前端级别的硬边界 | 前端很容易把未闭环能力误包装成已上线功能 | 形成错误预期，反向污染 API 与客户端设计 |
| G4 | 当前文档更像 roadmap，不像 charter | 执行者无法明确哪些是已冻结边界，哪些仍待 design/action-plan 展开 | 后续文档链路会失去统一基石 |

### 2.3 本阶段必须拒绝的错误前提

- **错误前提 1**：`只要 UI 先做出来，后端能力以后再补也没关系。`  
  **为什么错**：web-v10 foundations 的意义就是建立真实前后端对齐的起点，而不是做漂亮的假壳。

- **错误前提 2**：`既然已有 NanoClient，就可以直接在现有 main.ts 上继续扩页面。`  
  **为什么错**：`NanoClient` 是资产，但 `main.ts` 的原生 DOM 调试壳不是产品骨架，继续叠加只会把技术债前置。

---

## 3. 本阶段的一句话目标

> **阶段目标**：**建立一个 truth-first 的 web-v10 foundation：以 `Cloudflare Pages + Vite + React + Dark Mode` 为工程基线，以 same-origin BFF 承接 HTTP、以 direct WS 承接 first-wave stream，使 `clients/web` 从 dogfood demo 升级为真实 Web 客户端的可执行起点，同时明确排除后端尚未 fully live 的能力包装。**

### 3.1 一句话产出

`clients/web` 不再只是可调试的 demo 页面，而成为一个可继续实现真实产品链路的前端基石。

### 3.2 一句话非目标

web-v10 foundations **不是**“一次性把完整产品做完”，也**不是**“为了前端推进而虚构后端能力已经具备”。

---

## 4. 本阶段边界：全局 In-Scope / Out-of-Scope

### 4.1 全局 In-Scope（本阶段必须完成）

| 编号 | 工作主题 | 为什么必须在本阶段完成 | 对应 Phase |
|------|----------|------------------------|------------|
| I1 | 把 `clients/web` 从 DOM demo 重构为 React app shell | 没有产品壳，就没有后续真实 UI 演进面 | F1 |
| I2 | 建立 Pages Functions BFF 与前端 API 分层 | Web 真实部署不能长期依赖浏览器直打 upstream | F2 |
| I3 | 跑通 auth、session navigation 与聊天主链 | 这是 first real client 的最小非空主线 | F3-F4 |
| I4 | 建立 inspector / settings / catalog / health 的辅助页面边界 | Web 端不能只有聊天框，必须具备最小 inspection 面 | F5 |
| I5 | 冻结“partial capability 不伪装”的前端口径 | 防止 UI 反向制造错误产品事实 | F0-F5 |
| I6 | 为后续执行产出 action-plan / closure 所需的基础结构 | foundations 不能只给方向，不给下游文档锚点 | F0/F6 |

### 4.2 全局 Out-of-Scope（本阶段明确不做）

| 编号 | 项目 | 为什么现在不做 | 重评条件 / 下游落点 |
|------|------|----------------|----------------------|
| O1 | 完整 Open WebUI 产品能力复刻 | 当前后端与客户端都未准备好承接全量功能面 | 进入后续 productization 阶段再议 |
| O2 | model/provider 真正可切换的产品面板 | 后端模型策略与可选列表尚未冻结为 client-ready truth | 等模型清单与业务规则独立冻结后再纳入 |
| O3 | 实时 permission / elicitation modal fully live | 当前 decision path 与 runtime unblock 尚未形成完整产品闭环 | 等后端真正完成 live contract 后再进入 UI 主线 |
| O4 | 完整附件上传 / 下载 / 预览系统 | 当前 files 更接近 metadata / inspection 面，而非成熟资产系统 | 后续 multimodality / file pipeline 阶段再做 |
| O5 | 多租户 admin console / billing / credits / org management | 这不是 first real client foundation 的目标 | 单独的 admin/product charter |
| O6 | 把 `clients/web` 纳入根 workspace | 违反既有 dogfood consumer discipline | 不重评，保持 out-of-workspace |

### 4.3 灰区判定表（用来消除模糊空间）

| 项目 | 判定 | 判定理由 | 若要翻案，需要什么新事实 |
|------|------|----------|--------------------------|
| direct WS 到 `orchestrator-core` | `in-scope` | first-wave stream 已存在，先保留直连可降低启动复杂度 | 若后端提供同域 WS gateway / ticket 机制，再重评 |
| 浏览器直接跨域打 upstream HTTP | `out-of-scope` | foundations 默认需要稳定同域入口与错误归一 | 只有当 CORS、session、trace、cookie 策略都被正式冻结时才可翻案 |
| files inspector 作为 metadata list | `in-scope` | 它符合当前真实能力与右侧 inspection 面定位 | 若后端提供下载/预览/权限完整链路，可升级 |
| model chooser | `defer / later-phase` | 当前会制造错误能力预期 | 必须先有 owner-frozen model catalog 与策略规则 |

### 4.4 必须写进 charter 的硬纪律

1. **truth-first**：前端页面不得把后端尚未 fully live 的能力伪装成产品承诺。
2. **facade-first**：客户端只面向 `orchestrator-core` public facade，不绕开 façade 扩大调用面。
3. **dogfood-but-productizing**：允许复用现有调试 adapter，但不允许继续把产品主线写回 demo shell。

### 4.5 必须写明的例外（如有）

first-wave 允许 **WS 仍直接连接 `orchestrator-core`**。这是一个受控例外：它不是未来长期终局，只是 foundation 阶段为了降低复杂度、优先跑通真实流式链路而保留的工程姿势。

---

## 5. 本阶段的方法论

| 方法论 | 含义 | 它避免的错误 |
|--------|------|--------------|
| façade-first web | 所有 client contract 都以 public façade 为唯一真相 | 前端偷偷依赖内部 worker 或内网形状 |
| shell-before-richness | 先稳定 React shell、页面结构与 transport 分层，再扩产品细节 | 在 demo 页面上叠出不可维护的“伪产品” |
| BFF-for-HTTP | HTTP 先同域收口，统一 trace / env / error 模型 | 浏览器直接跨域打 upstream 导致环境与鉴权碎片 |
| honest capability framing | 对 permission、usage、files、models 坚持诚实口径 | 为了 UI 好看而制造错误产品事实 |
| reuse-with-extraction | 复用 `NanoClient` 里的协议经验，但通过拆分提纯，不保留巨石结构 | 把 demo adapter 直接升级成长期架构 |

### 5.1 方法论对 phases 的直接影响

- `shell-before-richness` 直接要求 F1 必须早于 F3/F4，否则后续聊天页面仍会落回杂糅结构。
- `BFF-for-HTTP` 直接要求 F2 成为硬门槛；没有 BFF，同域产品姿势就不成立。

---

## 6. Phase 总览与职责划分

### 6.1 Phase 总表

| Phase | 名称 | 类型 | 核心目标 | 主要风险 |
|------|------|------|----------|----------|
| F0 | Foundation Freeze | freeze | 冻结 web-v10 的边界、姿势、truth discipline | 范围漂移，继续把 roadmap 当 charter 用 |
| F1 | React Shell Reset | implementation | 从 DOM demo 升级为 React dark shell | 继续在旧页面堆逻辑 |
| F2 | BFF And Transport Split | implementation | 同域 HTTP/BFF 与前端 API 分层落地 | transport 巨石继续膨胀 |
| F3 | Auth And Session Navigation | implementation | 进入系统、列会话、创建/切换会话 | 只做 UI 壳，不形成真实主链 |
| F4 | Chat Mainline And Stream | implementation | 跑通 start/input/ws/timeline/resume 聊天主线 | UI 与 stream 语义错位 |
| F5 | Inspector And Delivery Hardening | implementation | 补齐辅助面、部署面与可维护性 | 把 partial capability 误包装成 fully live |
| F6 | Closure And Handoff | closure | 形成 web-v10 foundations 的关闭口径与下游入口 | 没有正式收口，导致下一阶段漂移 |

### 6.2 Phase 职责矩阵（推荐必填）

| Phase | 本 Phase 负责 | 本 Phase 不负责 | 进入条件 | 交付输出 |
|------|---------------|----------------|----------|----------|
| F0 | 冻结边界、姿势、非目标、下游文档要求 | 不写逐组件/逐文件实现细节 | 当前文档起草 | foundations charter |
| F1 | React app shell、dark layout、目录分层起骨架 | 不接完整业务闭环 | F0 已冻结结构与边界 | `App.tsx`、路由壳、主题与页面骨架 |
| F2 | Functions BFF、front-end API adapters、错误与环境归一 | 不负责产品级页面交互细节 | F1 已形成 React 壳 | `functions/api/*` + `src/apis/*` |
| F3 | auth/me/session list/new session/sidebar 主链 | 不负责复杂聊天 runtime 细节 | F2 已形成同域 API 基础 | 登录、会话导航与 session bootstrap |
| F4 | chat composer、stream、timeline/history/resume 主链 | 不负责丰富设置与运维辅助面 | F3 已能进入与切换会话 | 真实聊天主页面 |
| F5 | inspector、catalog、health、device、build/deploy/doc polish | 不创造不真实能力 | F4 已形成主聊天链 | 辅助面与部署硬化 |
| F6 | closure、known issues、handoff | 不追加新功能范围 | F0-F5 已具备可审查证据 | closure / next-step handoff |

### 6.3 Phase 之间的交接原则

1. **先壳后业务**：没有 React shell 与目录分层，不允许直接推进业务页面复杂度。
2. **先 transport 再页面接线**：BFF/API 分层必须先于大面积页面调用。
3. **先主线后辅助面**：auth/session/chat 主链先闭合，catalog/health/devices/files/usage inspector 后补。

---

## 7. 各 Phase 详细说明

### 7.1 F0 — Foundation Freeze

#### 实现目标

把 web-v10 的目标、边界、姿势、非目标与收口标准冻结为基石文件。

#### In-Scope

1. 定义 web-v10 的技术栈、部署模型、BFF/WS 分工。
2. 明确当前 `clients/web` 的 reality snapshot 与不可继续延续的 demo 姿势。
3. 明确 partial capability 的诚实口径。

#### Out-of-Scope

1. 具体 React 组件树与状态管理实现细节。
2. 逐接口 contract 的最终字段样例。

#### 交付物

1. `clients/web/docs/web-v10-foundations.md`
2. 下游 action-plan / closure 文档命名与职责入口
3. foundations 阶段的 exit discipline

#### 收口标准

1. 执行者能够仅凭本文件判断 web-v10 的目标与非目标。
2. old roadmap 不再作为当前基石真相入口。
3. 页面、BFF、WS、partial capability 的边界已写清。

#### 什么不算完成

1. 只有页面草图，没有边界与收口口径。
2. 仍然把 roadmap checklist 混同于 charter 冻结。

#### 本 Phase 风险提醒

- 若 F0 写得含糊，后续每个 Phase 都会各自解释“web-v10 到底想做什么”。
- 若 F0 继续保留旧 roadmap 口径，文档真相会一分为二。

---

### 7.2 F1 — React Shell Reset

#### 实现目标

把当前 DOM demo 升级为 React dark-mode app shell，并建立 `apis / components / pages / constants / docs` 结构骨架。

#### In-Scope

1. React / React DOM / TS 入口切换。
2. 全局布局：sidebar / main panel / inspector / topbar。
3. 基础页面骨架：Auth / Chat / Settings / Catalog / Health。

#### Out-of-Scope

1. 完整聊天业务链路闭环。
2. 复杂状态同步与 reconnect 策略定稿。

#### 交付物

1. `src/main.tsx` / `src/App.tsx`
2. `src/components/*` 与 `src/pages/*` 基础骨架
3. dark theme token 与基础样式层

#### 收口标准

1. `clients/web` 已不再依赖 `main.ts` 的按钮式 demo 作为主入口。
2. 页面结构已具备可继续接业务的稳定骨架。
3. 视觉上已经进入 dark shell，而不是工具页。

#### 什么不算完成

1. 只是在旧 DOM 页面加更多按钮。
2. 有 React 依赖，但业务仍散落在单文件巨石中。

#### 本 Phase 风险提醒

- 最容易回退到“先把功能堆上去再说”的旧路径。
- 若组件边界不立住，后续 F3-F5 会把页面层重新打碎。

---

### 7.3 F2 — BFF And Transport Split

#### 实现目标

建立 Pages Functions BFF 与前端 API 层，统一 preview/production upstream、trace、error 与 auth HTTP 姿势。

#### In-Scope

1. `functions/api/auth|me|sessions|catalog|debug`
2. `src/apis/transport|auth|sessions|catalog|debug`
3. 从 `NanoClient` 中抽离可复用 transport 逻辑，形成新的前端 API 层

#### Out-of-Scope

1. 完整 cookie/session 安全体系二期设计。
2. WebSocket 同域 gateway 一步到位。

#### 交付物

1. Pages Functions BFF 路由族
2. 前端 API adapters
3. 错误模型与环境切换归一口径

#### 收口标准

1. 浏览器 HTTP 主链统一走同域 `/api/*`。
2. 前端页面不再直接拼所有 upstream HTTP URL。
3. `src/client.ts` 不再承担长期巨石职责。

#### 什么不算完成

1. 只是把旧 URL 换了个变量名，仍然由页面直接访问 upstream。
2. 只是复制粘贴 `NanoClient`，没有拆出明确分层。

#### 本 Phase 风险提醒

- 若 F2 做不彻底，页面层会继续耦合 transport 细节。
- 若 BFF 口径不统一，preview/prod 切换会长期污染前端代码。

---

### 7.4 F3 — Auth And Session Navigation

#### 实现目标

打通“进入系统 → 列出 session/conversation → 新建/切换会话”的 first real client 主入口。

#### In-Scope

1. register / login / me bootstrap
2. `GET /me/sessions`、`POST /me/sessions`、`GET /me/conversations`
3. sidebar 中的 session / conversation navigation

#### Out-of-Scope

1. 聊天流式 runtime 的完整体验。
2. 复杂设备管理与账户安全 UI。

#### 交付物

1. auth state 与 auth page
2. 会话列表与创建入口
3. 进入聊天页的稳定 session bootstrap

#### 收口标准

1. 用户可以从登录进入系统。
2. 已存在会话与新会话入口都可被前端正确组织。
3. sidebar 已从占位变成真实导航面。

#### 什么不算完成

1. 只有登录框，没有会话导航。
2. 会话 UUID 逻辑仍然只是临时手工输入。

#### 本 Phase 风险提醒

- 若 session bootstrap 不稳定，F4 聊天主链会失去入口。
- 若 navigation 只做表面展示，真实客户端价值仍然不成立。

---

### 7.5 F4 — Chat Mainline And Stream

#### 实现目标

跑通聊天主链路：`start / input / ws / timeline / history / resume`，形成真正可用的聊天页面。

#### In-Scope

1. 首消息 start、后续 input、必要时 messages 面
2. WS 直连、heartbeat、ack、reconnect、timeline 对账
3. 页面中对 user / assistant / runtime 状态的基本展示

#### Out-of-Scope

1. 实时 permission / elicitation modal fully live
2. 模型与 provider 可切换控制台

#### 交付物

1. chat composer 与 message list
2. stream 连接与 resume/timeline 回补
3. 最小非空的真实对话页面

#### 收口标准

1. 用户能完成至少一轮真实对话。
2. 刷新或掉线后可以恢复会话流式状态。
3. timeline/history/resume 与流式主链没有明显语义冲突。

#### 什么不算完成

1. 只能发请求，不能稳定显示流式输出。
2. 只有 WS happy path，没有 resume/reconnect/timeline 对账。

#### 本 Phase 风险提醒

- F4 最容易把“流式能看到字”误判成“聊天主链已完成”。
- 若 timeline/reconnect 不接，真实客户端体验仍然不成立。

---

### 7.6 F5 — Inspector And Delivery Hardening

#### 实现目标

补齐 Web 客户端的右侧 inspection 面、设置面、catalog/health 辅助页面，以及本地/preview 可维护运行能力。

#### In-Scope

1. status / usage / files / timeline / history inspector
2. catalog / worker health / devices 辅助页面
3. build、preview、部署文档与基础测试

#### Out-of-Scope

1. 把 usage 伪装成 live push。
2. 把 files 伪装成完整下载/预览资产系统。

#### 交付物

1. inspector tabs 与辅助页面
2. `setup.md` / `deployment.md` / `api-contract.md`
3. build / smoke / transport 基础验证

#### 收口标准

1. 聊天页已具备最小 inspection 能力。
2. preview 与本地运行方式已成文。
3. 页面不会把 partial capability 错包装成 fully live。

#### 什么不算完成

1. 只有主聊天框，没有 usage/files/history 等 inspection 面。
2. 能跑但不可部署、不可交接、不可维护。

#### 本 Phase 风险提醒

- F5 最容易为了“页面完整”而伪装 capability。
- 若部署与文档不补，foundation 仍然只是开发机演示品。

---

### 7.7 F6 — Closure And Handoff

#### 实现目标

给 web-v10 foundations 一个正式的关闭口径，并为下一阶段执行留出明确入口。

#### In-Scope

1. 总结 F0-F5 的完成事实与 known issues
2. 判定 `full close / close-with-known-issues / cannot close`
3. 把残留问题挂到下一阶段，而不是留在正文阴影里

#### Out-of-Scope

1. 借 closure 临时新增功能。
2. 用 closure 取代正式 action-plan。

#### 交付物

1. `clients/web/docs/web-v10-closure.md`
2. known issues / deferred items 清单
3. 下一阶段入口说明

#### 收口标准

1. web-v10 foundations 的完成程度被正式定性。
2. 所有残留问题都有明确归属，而不是散落在聊天记录里。
3. 下游执行者知道下一步应该接什么文档，而不是重新猜方向。

#### 什么不算完成

1. 只说“差不多能用了”，没有正式 close 口径。
2. 已知问题没有写清影响范围与下游落点。

#### 本 Phase 风险提醒

- 若没有 closure，foundations 会长期保持“正在做”的模糊状态。
- 若 close 口径不诚实，会污染后续 Web 与 API 的事实判断。

---

## 8. 执行顺序与 Gate

### 8.1 推荐执行顺序

1. F0 — 先冻结边界与真相口径。
2. F1 — 先把 React shell 与产品化目录骨架立起来。
3. F2 — 再落 BFF 与 transport 分层。
4. F3 — 然后打通 auth 与 session navigation。
5. F4 — 再闭合聊天主链与 stream runtime。
6. F5 — 最后补 inspection、部署、文档与硬化。
7. F6 — 用 closure 固定成果与残留项。

### 8.2 推荐 DAG / 依赖关系

```text
F0
└── F1
    └── F2
        └── F3
            └── F4
                └── F5
                    └── F6
```

### 8.3 Gate 规则

| Gate | 含义 | 必须满足的条件 |
|------|------|----------------|
| Foundation Gate | 允许进入正式实施 | 本 charter 已冻结技术姿势、边界、非目标与 Phase 责任 |
| Product Shell Gate | 允许大面积接业务接口 | React shell、目录结构与基础页面骨架已成立 |
| Transport Gate | 允许页面主链依赖 HTTP | same-origin BFF 与前端 API adapters 已落地 |
| Closure Gate | 允许宣称 foundations 完成 | 聊天主链、inspection 基本面、部署与文档证据都已具备 |

### 8.4 为什么这样排

web-v10 foundations 的核心不是“把功能按页面顺序堆出来”，而是先把前端从 demo 姿势切换到真实产品姿势，再接入最小非空业务主线。若跳过 F1/F2 直接做 F3/F4，最终只会得到一个更复杂的 demo，而不是 foundation。

---

## 9. 测试与验证策略

### 9.1 继承的验证层

1. `clients/web` 现有 `dev/build/preview` 工程脚本。
2. 当前 `NanoClient` 已经验证过的 HTTP/WS adapter 经验。
3. public façade 的真实 API 面与 preview 环境联调。

### 9.2 本阶段新增的验证重点

| 类别 | 验证内容 | 目的 |
|------|----------|------|
| 工程层 | `clients/web` 在 React 化后仍可 `build` 与 `preview` | 防止前端重构后失去基本运行能力 |
| transport 层 | BFF 的 trace、env、auth、error 归一逻辑 | 防止 HTTP 面碎片化 |
| runtime 层 | session start/input/ws/resume/timeline 实际闭环 | 验证它确实是 real client，而不是静态 UI |
| UX truth 层 | usage/files/permission 等页面口径与真实后端能力一致 | 防止过度承诺 |

### 9.3 本阶段不变量

1. `clients/web` 不进入根 workspace。
2. HTTP 主路径默认经 BFF，同域优先。
3. 前端页面不得宣称后端未 fully live 的能力已经完成。

### 9.4 证据不足时不允许宣称的内容

1. 不允许宣称“web 已 fully production-ready”，除非 Pages 部署、主链、文档与基础测试都成立。
2. 不允许宣称“permission / usage / files / models 已产品化”，除非真实闭环证据存在。

---

## 10. 收口分析（Exit / Non-Exit Discipline）

### 10.1 Primary Exit Criteria（硬闸）

1. `clients/web` 已完成从 DOM demo 到 React app shell 的姿势切换。
2. HTTP 主路径已由 same-origin BFF 承接，页面不再直接散打 upstream。
3. auth → session navigation → chat mainline → stream/resume/timeline 的最小非空主链已可运行。
4. inspector / settings / catalog / health 至少具备与当前真实能力一致的基础面。
5. foundations 的文档、部署与已知限制已经书面冻结。

### 10.2 Secondary Outcomes（结果加分项，不是硬闸）

1. 视觉与交互更接近 Open WebUI 的成熟感。
2. 基础组件测试、smoke test 与窄屏适配做得更完整。

### 10.3 NOT-成功退出识别

以下任一成立，则**不得**宣称本阶段收口：

1. `clients/web` 仍然主要依赖原生 DOM 调试壳。
2. 页面主链仍然直接拼 upstream HTTP URL，没有稳定 BFF。
3. 聊天主链缺少 resume/reconnect/timeline 对账，只有 happy-path 流式展示。
4. 文档仍然把 partial capability 当成 fully live capability 描述。

### 10.4 收口类型判定表

| 收口类型 | 含义 | 使用条件 | 文档要求 |
|----------|------|----------|----------|
| `full close` | foundations 目标与硬闸全部满足 | F1-F6 全部完成且主线无结构性断点 | `web-v10-closure.md` 明确写 full close 依据 |
| `close-with-known-issues` | 主线已成立，但存在不破坏 foundation 定义的残留项 | 残留项已被诚实降级为下一阶段工作 | closure 文档必须逐项列出 known issues |
| `cannot close` | 仍有结构性 blocker 或真相漂移 | React/BFF/主链/口径任一核心项缺失 | closure 文档必须说明不能 close 的原因 |

### 10.5 这一阶段成功退出意味着什么

意味着 `clients/web` 已真正成为 nano-agent 的 **第一个可执行 Web 客户端基线**，后续可以在其上继续做 richer product iteration，而不是重新从 demo 重启。

### 10.6 这一阶段成功退出**不意味着什么**

1. 不意味着 Web 端已经拥有完整产品能力或完整后台管理面。
2. 不意味着所有后端 partial capability 都已被补齐为 fully live client contract。

---

## 11. 下一阶段触发条件

### 11.1 下一阶段会正式纳入 In-Scope 的内容

1. richer chat UX、组件细化与状态管理增强。
2. 更完整的 session inspection / multimodality / file flows。
3. 认证安全姿势增强（例如更成熟的 cookie/session 化方案）。

### 11.2 下一阶段的开启前提

1. web-v10 foundations 已被正式 close 或 close-with-known-issues。
2. 基础主链、BFF、部署与文档已经形成可复用地基。

### 11.3 为什么这些内容不能前移到本阶段

因为 foundations 的本质是“建立真实地基”，不是“在地基未稳时直接冲产品厚度”。若把 richer capability 提前塞进来，只会重新制造 scope 漂移与事实伪装。

---

## 12. 后续文档生产清单

### 12.1 Action-Plan 文档

- `clients/web/docs/action-plan/web-v10/F0-foundation-freeze.md`
- `clients/web/docs/action-plan/web-v10/F1-react-shell-reset.md`
- `clients/web/docs/action-plan/web-v10/F2-bff-and-transport-split.md`
- `clients/web/docs/action-plan/web-v10/F3-auth-and-session-navigation.md`
- `clients/web/docs/action-plan/web-v10/F4-chat-mainline-and-stream.md`
- `clients/web/docs/action-plan/web-v10/F5-inspector-and-delivery-hardening.md`
- `clients/web/docs/action-plan/web-v10/F6-closure-and-handoff.md`

### 12.2 Closure / Handoff 文档

- `clients/web/docs/web-v10-closure.md`

### 12.3 运行与契约文档

- `clients/web/docs/setup.md`
- `clients/web/docs/deployment.md`
- `clients/web/docs/api-contract.md`

### 12.4 建议撰写顺序

1. 先以本 foundations charter 为基线。
2. 再写 `clients/web/docs/action-plan/web-v10/F0-F6` 细化分阶段实施任务。
3. 实施结束后写 `web-v10-closure.md` 与运行文档。

---

## 13. 最终 Verdict

### 13.1 对本阶段的最终定义

web-v10 foundations 是 `clients/web` 的 **第一份真正基石文件**。它定义的不是页面列表本身，而是 nano-agent Web 客户端从 dogfood demo 走向真实可运行产品入口的起点纪律。

### 13.2 工程价值

它把 React shell、BFF 分层、transport 提纯、chat mainline、inspection 面与部署文档组织到一条有先后顺序的工程主线上，避免继续在 demo 壳上叠系统。

### 13.3 业务价值

它让 nano-agent 的 Web 端第一次有机会从“能调接口”变成“能承接真实用户使用与后续产品迭代”的前台入口。

### 13.4 一句话总结

> **web-v10 foundations 的任务不是把所有前端都做完，而是诚实地建立第一个真正可执行、可关闭、可继承的 Web 客户端地基。**

---

## 14. 维护约定

1. 本文件只更新边界、Phase 定义、退出条件与下游文档入口，不回填逐任务执行日志。
2. 逐任务拆分、文件级实施与依赖顺序进入 `clients/web/docs/action-plan/web-v10/F0-F6`。
3. 若 web-v10 的目标或非目标发生变化，必须同步更新 §4、§6、§10、§11。
4. 若实际实施只能达到 `close-with-known-issues`，必须在 closure 文档中复写残留项、影响范围与下游落点。
