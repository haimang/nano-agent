# Nano-Agent `real-to-hero` 阶段基石纲领

> **文档对象**：`nano-agent real-to-hero phase（zero-to-real partial-close 之后的下一阶段）`
> **状态**：`draft`
> **日期**：`2026-04-29`
> **作者**：`Claude Opus 4.7（基于 4 家 reviewer 评审 + 4 家 api-gap-study + runtime-session-study 综合输入）`
> **文档性质**：`phase charter`
> **文档一句话定义**：`让 nano-agent 第一次拥有可被真实 web / mini-program / CLI 客户端持续使用的产品基线，而不只是端到端能跑的 demo。`
>
> **修订历史**：
> - `r1, 2026-04-29 — 初稿，基于 zero-to-real partial-close §4 残余 + 4 家 api-gap-study 共识 + runtime-session-study 路线综合编制`
> - `r2, 2026-04-29 — 应用 GPT-5.5 review (changes-requested) 的 7 项修法：R1 新增 §4.0 closure §4 deferred 全量继承表 + R2 migration allocation 冻结（RH2=008/RH3=009/RH4=010）+ §8.4 + R3 §9.5 evidence 三层定义 + R4 移除 memory 引用 + 新增 P0-F owner checklist + R5 §8.3 Per-Phase Entry Gate + §13.4 升级为硬 gate + R6 §9.2 统一测试用例数纪律 + R7 RH2 P2-E LLM delta policy out-of-scope 决议；新增 P0-G bootstrap hardening；新增 §12 Q5。`
>
> **直接输入包（authoritative）**：
> 1. `docs/issue/zero-to-real/zero-to-real-final-closure.md`（partial-close / handoff-ready，§4 列 15 条未完成项）
> 2. `docs/eval/real-to-hero/closing-thoughts-by-opus.md`（6 阶段执行设想 + 全量映射）
> 3. `docs/eval/real-to-hero/api-gap-study-by-{GLM,GPT,deepseek,kimi}.md`（4 家独立 API gap 调查共识）
> 6. `docs/charter/review/plan-real-to-hero-reviewed-by-GPT.md`（r1 审查 changes-requested + 7 项 finding，r2 已修复）
> 4. `docs/eval/real-to-hero/runtime-session-study-by-GPT.md`（NanoSessionDO 拆分路线 + 否决 SQLite-DO 主线）
> 5. `docs/code-review/zero-to-real/fully-reviewed-by-{GPT,deepseek,kimi,GLM}.md`（4 家 implementer-fixed 后的 review + §6/§7 implementer response 与 review-quality eval）
>
> **ancestry-only / 背景参考（不作为直接入口）**：
> - `docs/charter/plan-zero-to-real.md`（上一阶段 charter）
> - `docs/charter/plan-worker-matrix.md`（6-worker 拓扑 charter）
> - `docs/issue/worker-matrix/worker-matrix-final-closure.md`
> - `docs/action-plan/zero-to-real/ZX5-protocol-hygiene-product-surface-architecture.md`
>
> **下游预期产物**：
> - design 文档：`docs/design/real-to-hero/{lane-f-live-runtime, models-context-inspection, device-auth-gate, filesystem-r2-pipeline, multi-model-multimodal-reasoning, do-megafile-decomposition}.md`
> - action-plan 文档：`docs/action-plan/real-to-hero/RH{0..6}-*.md`（每 Phase 一份）
> - closure 文档：`docs/issue/real-to-hero/real-to-hero-final-closure.md`
> - 中间 handoff：必要时按 Phase 写 phase-closure（不强制）

---

## 0. 为什么这份 charter 要现在写

### 0.1 当前时点的根本原因

zero-to-real 阶段已于 2026-04-29 以 **partial-close / handoff-ready** 收口。本轮 implementer fix 修复了 14 条 critical/high reviewer findings、partially-fixed 6 条、deferred 27 条、blocked 1 条；4 家 reviewer 在同一时点对 6-worker 全量代码做了独立 API gap 调查，并就 first-wave 客户端可运行接口的最小集形成 **4-家共识**。

这意味着：
1. 上一阶段在 "auth + session truth + workers AI mainline + 6-worker 拓扑" 层面已经成立（partial-close 的本意是"基础设施成立、live runtime 部分接通"）。
2. 4 家 reviewer 共识下来的 first-wave 缺口是**结构性的**，不是 incremental polish — 必须在下一阶段以 charter 级别冻结边界才能避免漂移。
3. 已经识别但 deferred 的 15 条残余项（closure §4）+ 4 家共识的 first-wave 接口（/models, /context, WS bidirectional, device auth gate, API key, filesystem R2/KV pipeline, multi-model）+ runtime-session-study 推荐的 NanoSessionDO 拆分路线，三者必须**并行**而非串行规划，否则会出现"修一个断点暴露三个新断点"的反复。

如果现在不写 charter：
- closure §4 deferred 项会被各 PR 各自挑着修，丢失阶段级 truth anchor。
- api-gap-study 4 家共识会被挑着实现一两个就宣称 first-wave 完成，导致再次 partial-close。
- runtime-session-study 关于 SQLite-DO 否决与拆分顺序的判断会被遗忘，巨石继续堆积。

### 0.2 这份文档要解决的模糊空间

1. **下一阶段到底叫什么、负责什么、不负责什么** — 是 "zero-to-real 续作" 还是 "real-to-hero 全新阶段"？是补 deferred 还是补 product 面？
2. **Phase 切片如何排序** — Lane F 完整闭合、客户端可见性、租户产品面、filesystem 真实化、多模型上线、巨石拆分这六块工作的执行顺序与依赖。
3. **哪些不在本阶段做** — admin plane / billing / multi-provider routing / SQLite-backed DO / 第 7 个 worker 这些在 4 家文档中被反复提及但不应在本阶段做的工作，必须显式列出 out-of-scope 与下游承接位置。
4. **退出条件** — 怎样算"成功退出 real-to-hero"，怎样算"close-with-known-issues"，怎样算"cannot close"。

### 0.3 这份 charter 的职责，不是别的文件的职责

- **本 charter 负责冻结**：
  - 下一阶段一句话目标（让真实客户端跑起来，不只是 demo）。
  - 全局 In-Scope / Out-of-Scope / 灰区判定。
  - Phase 切片（RH0-RH6）与各 Phase 的进入条件、交付物、收口标准。
  - 不变量（6-worker 不动 / 不引入 SQLite-DO / 三层真相 / 不新增 public worker）。
  - Primary Exit Criteria 与 NOT-成功退出识别。
- **本 charter 不负责展开**：
  - 单个 endpoint 的 schema / route / handler 实现（应在：`docs/design/real-to-hero/*.md`）。
  - 单个 Phase 的逐任务清单（应在：`docs/action-plan/real-to-hero/RH{N}-*.md`）。
  - 单个 reviewer finding 的修法细节（应在：`docs/code-review/zero-to-real/fully-reviewed-by-*.md §6`，已完成）。
  - 跨阶段的执行日志或 PR-by-PR diary（应在：closure / handoff）。

---

## 1. 本轮已确认的 Owner Decisions 与基石事实

### 1.1 Owner Decisions（直接生效）

| 编号 | 决策 | 影响范围 | 来源 |
|------|------|----------|------|
| D1 | 保持 6-worker 拓扑，不新增 worker（不引入 skill.core 或 third-party-router worker） | 全阶段所有 Phase | plan-worker-matrix.md §1.5 + zero-to-real-final-closure.md §3.1 |
| D2 | 不引入 SQLite-backed DO（user-do / session-do 继续 KV-style storage + memory actor） | RH0 / RH6 / 整阶段 | runtime-session-study-by-GPT.md §3.2/§8.2 |
| D3 | NACP first-publish scope = `@haimang/*`（而非 `@nano-agent/*`） | RH4 filesystem package、RH5 model package | 仓库证据：`packages/{nacp-core,nacp-session,jwt-shared,orchestrator-auth-contract}/package.json` scope = `@haimang`；shipped 1.4.0/1.3.0 bundle |
| D4 | 本阶段所有 deploy / install 路径所需的 `wrangler` / `gh` / npm 凭据均通过 RH0 P0-F 的 owner-action checklist 验证后方可生效 | 全阶段 deploy 路径 | RH0 P0-F checklist（见 §7.1 + §12 Q5）；DeepSeek api-gap §6.1 已 spike-verified `ai (write)` 权限 |
| D5 | jwt-shared 是 auth 主链 single source（不允许重复 fork） | RH0 / RH3 | ZX5 Lane C closure |
| D6 | 三层真相职责冻结：DO memory = active loop；DO storage = hot read model；D1 = product durable truth | RH0 / RH4 / RH6 | runtime-session-study §8.3 |

### 1.2 已冻结的系统真相

| 主题 | 当前真相 | 本阶段如何继承 |
|------|----------|----------------|
| 6-worker 拓扑 | `orchestrator-core`(public facade) + `orchestrator-auth`(internal RPC) + `agent-core`(runtime host) + `bash-core`(capability) + `context-core`(library shim, RPC stub) + `filesystem-core`(library shim, RPC stub) | 不动；context-core / filesystem-core 在 RH4 升为真实业务 RPC consumer，但仍是 internal-only |
| auth truth | email/password + WeChat + JWT(HS256+kid) + refresh rotation；device 表已建（migration 007）；API key 表 DDL 已建但 verify 是 stub | RH3 完成 device auth gate + API key verify；RH0 修复 jwt-shared lockfile |
| session truth | D1 7 个 migration（含 pending/expired status, user_devices）；D1SessionTruthRepository 写主路径；user-do KV index 是 hot read model | 不动 schema 主线；**migration allocation（per R2 review 冻结）**：RH2 → 008-models.sql；RH3 → 009-team-display-and-api-keys.sql；RH4 → 010-session-files.sql；RH5 → 011-model-capabilities-seed.sql（如需） |
| Workers AI mainline | `agent-core` 通过 `AI` binding 走 Workers AI；`gateway.ts` 注册 2 个模型；preview deploy `--dry-run` 已通过 | RH5 扩展为 13 + 4 vision + 8 reasoning；onUsageCommit callback 已注册（console.log），RH1 替换为真实 WS push |
| facade 路由白名单 | 已含 `start/input/messages/cancel/status/timeline/history/verify/files/usage/resume/permission|policy|elicitation 子路径` + `me/sessions/conversations/devices*` + `auth/*` + `catalog/*` | RH2 加 `models` + `sessions/{id}/context/*`；RH3 加 `me/team` + `me/devices` GET / `auth/api-keys/*`（最小） |
| WS wire | lightweight `{kind, ...}` frame；`validateSessionFrame` 库代码完备但未在 runtime path 强制；onUsageCommit/permission/elicitation/tool-result frame 全未真实 emit | RH1 接通 onUsageCommit + permission round-trip；RH2 升级 NACP frame + meta(opened) + bidirectional + tool result emit |
| KV/R2 binding | 账号资源已存在（`nano-agent-spike-do-storage-probe*` 等）；6 worker wrangler 全无声明 | RH0 在 wrangler.jsonc 占位声明；RH4 启用业务路径 |
| 巨石文件 | `nano-session-do.ts` 2078 行；`user-do.ts` 2285 行 | RH0 拆 verify + persistence（≤1500 行）；RH6 完成剩余拆分（≤400 行 facade） |

### 1.3 明确不再重讨论的前提

1. **不重新讨论 6-worker 是否合理** — 在本阶段视为 frozen truth。任何"是否新增第 7 个 worker"的讨论延后到本阶段闭合后。
2. **不重新讨论 SQLite-DO 是否更优** — 本阶段不做 DO storage 模型切换。runtime-session-study 已论证当前 first problem 不是缺 SQL；session loop memory-first 性能没坏；D1 已是清晰 product truth。
3. **不重新讨论 admin plane / billing 的设计** — 这两块明确推迟到本阶段闭合后的下一个 phase（暂称 hero-to-platform）。
4. **不重新讨论 NACP error envelope 协议层（GLM R1）** — 当前所有活跃 RPC 路径走 `Envelope<T>` 的 ok:false 路径，不走 `NacpEnvelope` 错误信封。GLM R1 是协议卫生 finding，纳入 RH 阶段闭合后的 protocol-evolution backlog。
5. **不重新讨论第 2 个 LLM provider** — Workers AI 13 模型已覆盖核心需求；DeepSeek/OpenAI adapter 启用是 hero-to-platform 工作。

---

## 2. 当前真实起点（Reality Snapshot）

### 2.1 已成立的 shipped / frozen truth

| 主题 | 当前现实 | 证据 |
|------|----------|------|
| 6 个 worker 物理存在 | orchestrator-core / orchestrator-auth / agent-core / bash-core / context-core / filesystem-core | `find workers -mindepth 1 -maxdepth 1 -type d` |
| facade 路由 含 ZX5 Lane D 全部产品面 | `/messages, /files, /me/conversations, /me/devices*` 已 wired，本轮 needsBody fix 后 body 透传正常 | `workers/orchestrator-core/src/index.ts`（19 处 ZX5 Lane D 路由匹配） |
| D1 migrations 7 个 | identity-core / session-truth / hardening / usage / usage-events-provider-key / pending-status-extension / user-devices | `workers/orchestrator-core/migrations/00{1..7}-*.sql` |
| context-core / filesystem-core WorkerEntrypoint 默认导出已修 | DS R5 fix；RPC 方法在 service binding 下可达 | 本轮 implementer fix |
| onUsageCommit callback 已注册（console.log） | DS R3 partial-fix；hook.emit no-op 与 emitPermissionRequestAndAwait 零调用方仍 deferred | 本轮 implementer fix |
| Workers AI deploy 路径已通 | `wrangler deploy --dry-run` 通过；`ai (write)` 权限已确认；尚未真实 deploy + 端到端 inference | DeepSeek api-gap §6.1 |
| wrangler / gh / npm 凭据 | 部分流程已在本地完成（DeepSeek api-gap §6.1 spike-verified `wrangler whoami` 含 `ai (write)`），但 CI / 团队复现还需 owner 通过 RH0 P0-F checklist 落地 | 本阶段不依赖任何"已默认配置"的私有凭据假设；任何 deploy / install 必须先跑 P0-F 验证脚本 |

### 2.2 当前仍然存在的核心 gap

| 编号 | gap | 为什么必须在本阶段处理 | 若不处理会怎样 |
|------|-----|------------------------|----------------|
| G1 | Lane F live runtime 三链全断（hook.emit no-op / scheduler 不产生 hook_emit / emitPermissionRequestAndAwait 零调用方 / onUsageCommit 仅 console.log） | zero-to-real charter exit criterion 4 partial 的核心阻塞 | "permission 可点但不生效"、"usage 不可见"，真实客户端无法做有意义的 agent loop |
| G2 | `GET /models` 不存在；模型硬编码 2 个；context window 错标为 128K | 4 家 api-gap-study 共识 P0；client 无法做 model picker | 客户端永远只能用 default granite，无法用 reasoning / vision 模型 |
| G3 | `GET /sessions/{id}/context` 不存在；InspectorFacade 仅 library 层 | 4 家共识 P0；这是与 3 个外部 CLI 的最大可见性差距 | 客户端无法 explain context window 使用、无法在长对话中决定何时压缩 |
| G4 | D6 device revoke 仅写 D1，不进入 access/refresh/WS auth gate | zero-to-real auth criterion 不真正成立 | revoke 设备后 access token 仍可用 1 小时；refresh chain 不被拒；多设备安全语义为零 |
| G5 | filesystem-core 仍是 in-memory + library-only；KV/R2 binding 未声明；ArtifactStore 是 InMemoryMap | 4 家共识 P1；no real file pipeline 意味着 vision 模型 / 多模态都是空头支票 | 客户端无法上传 image，bash-core 输出 promote 不到 R2，artifact 不能跨请求列举 |
| G6 | `verifyApiKey` 永远 `supported:false`；`nano_team_api_keys` 表零读写 | charter Z1 In-Scope 第 5 条明文要求；server-to-server 鉴权场景刚需 | CI/CD、第三方 CLI、programmatic access 全部无法用；与 3 个外部 CLI 的鉴权范式严重错位 |
| G7 | nano_teams 缺 `team_name / team_slug`；`/auth/me` 返回的 team 仅含不可读 UUID | 多用户产品最基础前端展示 | 用户无法辨认/分享自己的工作区；多团队管理无从谈起 |
| G8 | NanoSessionDO 2078 行 + user-do.ts 2285 行 | runtime-session-study 推荐的拆分前提；Lane F 改造 + WS bidirectional 改造若在巨石内堆积，conflict / regression 成本指数级 | 后续每个 Phase 的合并冲突与 review 难度都会被巨石放大 |
| G9 | Lane E consumer migration 未启动（agent-core CONTEXT_CORE / FILESYSTEM_CORE binding 仍注释） | 现有 context-core RPC 方法定义后无消费者 = 空头建设；G5 的 filesystem 真实化也依赖此 | 6-worker 内部 RPC 拓扑无法真正成立 |
| G10 | jwt-shared lockfile 断裂；`pnpm-lock.yaml` 缺 importer + 含 stale importer | CI reproducibility 已断；任何 fresh install 都会是不确定状态 | RH 阶段任何 CI / preview deploy / production deploy 都可能因 lockfile 漂移失败 |
| G11 | ZX5 product endpoints（messages/files/me-conversations/me-devices）缺 endpoint-level 直达测试 | DS R1 needsBody silent-drop 类 bug 没有自动捕获保障 | 同类 silent-drop bug 会再次发生且无法被 CI 阻断 |
| G12 | `/me/conversations` 与 `/me/sessions` 数据集不一致（前者仅 D1，后者 KV+D1） | 同一用户在两端看到不同会话集 | "Z2 real loop 可持久、可回看" 不真正成立 |

### 2.3 本阶段必须拒绝的错误前提

- **错误前提 1**：`real-to-hero = 把 zero-to-real partial-close 的 deferred 项一条一条修完`。
  **为什么错**：4 家 api-gap-study 共识下来的 first-wave 接口（/models、/context、WS bidirectional、device auth gate、API key、filesystem R2/KV pipeline、multi-model）**绝大多数不在 closure §4 deferred 列表里**。这两套需求并集才是 real-to-hero scope。把 closure §4 当成全部，会得到一个"内部干净但客户端仍跑不起来"的 partial-close v2。
- **错误前提 2**：`既然 4 家共识，就把所有共识项都列为 P0`。
  **为什么错**：4 家共识里有些项（catalog 真实 plug-in 注册框架、prompt caching、sandbox 隔离、logout endpoint、third-party OAuth）属于 hero-to-platform，不是 real-to-hero。本 charter 必须显式划分。
- **错误前提 3**：`session loop 应该改成 SQLite-DO 驱动`。
  **为什么错**：runtime-session-study 已论证此为不必要重构，且会在巨石未拆时绑死"重构 + 存储语义切换"两件事。当前 first problem 是 product API gap + 巨石维护性，不是缺 SQL。
- **错误前提 4**：`Lane F 在 ZX5 已经 partial 完成，可以 best-effort 补齐`。
  **为什么错**：DeepSeek R2/R3/R4/R6 拆开后才看清，Lane F 是 4 链全断（delegate / scheduler / waiter caller / WS push），需要独立 sprint 而不是 best-effort。
- **错误前提 5**：`api-gap-study 写于 2026-04-28，所以列出的 missing 都还 missing`。
  **为什么错**：ZX5 Lane D 在 2026-04-28→04-29 期间已落地 `/messages, /files, /me/conversations, /me/devices/revoke`、pending session status、user_devices 表、catalog 静态内容。Charter 起点必须是 2026-04-29 真实代码状态。

---

## 3. 本阶段的一句话目标

> **阶段目标**：让 nano-agent 第一次拥有可被真实 web / mini-program / CLI 客户端持续使用的产品基线 — Session 消费 + 租户可达 + Live runtime 三道闭环全部成立 — 在 6-worker 拓扑不变 + 不引入 SQLite-DO 的约束下完成。

### 3.1 一句话产出

`一组 client-ready 的 first-wave API（/models, /context, /messages 多模态/idempotency, WS NACP frame, /me/devices auth gate, /api-keys verify, /files R2 pipeline）+ Lane F live runtime 三链全通 + 巨石拆分完成 + manual evidence pack。`

### 3.2 一句话非目标

`不做 admin plane / billing / second LLM provider / sandbox 隔离 / OAuth federation / SQLite-DO / 第 7 个 worker / catalog 真实 plug-in 注册框架。`

---

## 4. 本阶段边界：全局 In-Scope / Out-of-Scope

### 4.0 zero-to-real final closure §4 deferred 全量继承表（硬性映射）

> 本表是 R1 review 的直接回应：把 closure §4 的 15 条 deferred 从 `closing-thoughts` 提升为 charter 正文硬表。每条必须落到三类之一 — `in-scope-with-DoD`（本阶段完成且有可验证 DoD）/ `out-of-scope-handoff`（明确降级到下游 + 落点）/ `owner-decision-needed`（最晚冻结时点见 §12）。

| closure §4 item | 处理类型 | 承接位置 | DoD 或 handoff 说明 |
|-----------------|----------|----------|---------------------|
| 1. manual browser / 微信开发者工具 / 真机证据 | `in-scope-with-DoD` | RH6 P6-D | 三套 evidence pack 覆盖 happy + image upload + permission round-trip + device revoke 关键场景；evidence 归档至 `docs/evidence/{web,wechat-devtool,real-device}-manual-2026-XX/` |
| 2. token-level live streaming 或 snapshot-vs-push 决策 | `in-scope-with-DoD` | RH2 P2-E (新增) | **决议**：token-level streaming 在 real-to-hero **out-of-scope**（性能成本与协议复杂度大于 first-wave 价值）；本阶段做 semantic-chunk streaming（tool_use_start/delta/stop + tool.call.result）+ snapshot-vs-push policy 文档化（usage = WS push best-effort + HTTP snapshot strict-consistent）；token-level 留 hero-to-platform |
| 3. dead `deploy-fill` residue 清理 | `in-scope-with-DoD` | RH6 P6-E | dead `deploy-fill` 文件物理删除；`forwardInternalJson @deprecated` 移除；Lane E shim 删除；CI 检查无残留 import |
| 4. DO websocket heartbeat lifecycle platform-fit hardening | `in-scope-with-DoD` | RH2 P2-C 新增子项 + RH6 P6-A | 在 RH2 WS 升级时同步 hardening：(a) heartbeat tracker timeout 行为 + (b) ack window cleanup + (c) DO alarm 与 WS lifecycle 协同 + (d) Cloudflare WS platform close semantics 显式处理；测试覆盖 ≥ 4 用例（normal close / abnormal disconnect / heartbeat miss / replay after reconnect） |
| 5. tool registry 与 client session helper 的单一真相源抽取 | `partial-in-scope + out-of-scope-handoff` | RH5 (model registry) + RH6 (三层真相 doc 中明确 catalog 静态内容是 single source) | model registry 单一真相源在 RH5 P5-A nano_models seed 完成；tool registry（catalog 静态 SKILLS/COMMANDS/AGENTS）在 RH6 P6-C 三层真相文档中冻结为"静态 single source 直到 hero-to-platform plug-in 框架"；client session helper（clients/web、wechat 各自的 session helper 抽 SDK）**out-of-scope**，留 hero-to-platform |
| 6. richer quota / bootstrap hardening / admin plane / billing / control plane | `split` | quota usage snapshot → RH1 P1-E；bootstrap hardening → RH0 P0-G (新增)；admin plane / billing / control plane → out-of-scope, hero-to-platform | RH0 P0-G：bootstrap hardening = 验证 register/login/refresh 在 cold-start cluster 与 D1 latency spike 下的稳定性；admin plane / billing 留 hero-to-platform |
| 7. broader multi-tenant-per-deploy 与更深 internal RPC 演进 | `out-of-scope-handoff` | hero-to-platform charter §1 inherited known-issues | multi-tenant-per-deploy（每个 owner 独立 D1 实例）暂不做；internal RPC 演进（如 NACP error envelope 注册、facadeFromRpcEnvelope 桥接、context/filesystem RPC 方法集扩展）的协议侧留 hero-to-platform 的 protocol-evolution backlog；本阶段仅做必要的 contract test 覆盖（RH4 filesystem RPC + RH2 GET /models） |
| 8. D6 device revoke auth gate | `in-scope-with-DoD` | RH3 P3-A + P3-E | 见 §7.4 RH3 收口标准（access/refresh/WS gate 全部生效 + 同 device 已 attached WS force-disconnect） |
| 9. Lane F dispatcher 完整闭合 | `in-scope-with-DoD` | RH1 P1-A + P1-B + P1-C | 见 §7.2 RH1 收口标准（hook.emit delegate / scheduler hook_emit / Permission+Elicitation round-trip 全部端到端 e2e） |
| 10. onUsageCommit WS push | `in-scope-with-DoD` | RH1 P1-D | 见 §7.2 RH1（preview deploy + ws client manual smoke evidence） |
| 11. Lane E consumer migration | `in-scope-with-DoD` | RH4 P4-D | binding 启用 + RPC-first env flag + dual-track sunset ≤ 2 周 + library import 删除（见 §12 Q2） |
| 12. API key verify runtime path | `in-scope-with-DoD` | RH3 P3-C | verifyApiKey 实装 + authenticateRequest 双轨 + internal createApiKey RPC（owner-side manual 用） |
| 13. jwt-shared lockfile | `in-scope-with-DoD` | RH0 P0-A | jwt-shared standalone build/typecheck/test 全绿 + lockfile importer 修复 + stale importer 删除 |
| 14. /me/conversations D1+KV 双源对齐 | `in-scope-with-DoD` | RH3 P3-D | 与 handleMeSessions 一致 + cursor pagination + 双源测试覆盖 |
| 15. ZX5 product endpoints tests | `in-scope-with-DoD` | RH0 P0-B | ≥7 endpoint test files / ≥35 测试用例（按 §9.2 endpoint-level 测试纪律：每个新增 public endpoint ≥5 用例） |

**承接强度审计**：15 项中 12 项 `in-scope-with-DoD`、1 项 `partial + out-of-scope-handoff`、1 项 `split`、1 项纯 `out-of-scope-handoff`；无 `owner-decision-needed`；不允许在 closure 阶段以"已大概覆盖"形式跳过任一项的 DoD 验证。

### 4.1 全局 In-Scope（本阶段必须完成）

| 编号 | 工作主题 | 为什么必须在本阶段完成 | 对应 Phase |
|------|----------|------------------------|------------|
| I1 | Lane F live runtime 闭合（hook.emit delegate / scheduler hook_emit / Permission+Elicitation round-trip / onUsageCommit WS push） | zero-to-real criterion 4 真正成立的唯一路径 | RH1 |
| I2 | client 可见性 first-wave API（GET /models / GET /sessions/{id}/context / WS NACP frame upgrade / tool call 增量 + tool result frame） | 4 家共识 P0；与 3 个外部 CLI 的最大差距 | RH2 |
| I3 | 多租户产品面（D6 device auth gate / nano_teams team_name+slug / verifyApiKey 实装 / /me/conversations 双源对齐 + cursor pagination / refresh-token bind device） | zero-to-real auth criterion 真正成立 + 4 家共识 P1 | RH3 |
| I4 | filesystem 真实持久化 + Lane E consumer migration（KV/R2 binding 启用 / filesystem-core 业务 RPC / agent-core CONTEXT_CORE+FILESYSTEM_CORE binding 启用 / file upload pipeline） | client 多模态 / artifact 跨请求 / promotion-to-R2 全部依赖 | RH4 |
| I5 | 多模型 + 多模态 + reasoning 模型上线（13 个 Workers AI function-calling + 4 vision + 8 reasoning，per-session model_id 透传，reasoning effort 参数贯通） | 4 家共识 P1；llama-4-scout 多模态 / kimi-k2.6 reasoning 都已是平台资产 | RH5 |
| I6 | 巨石文件拆分 + 三层真相文档冻结 + manual evidence pack | runtime-session-study 推荐路线；为下一阶段提供清晰起跑线 | RH6 |
| I7 | jwt-shared lockfile 修复 / ZX5 endpoint 直达测试 / KV+R2 binding wrangler 占位 / NanoSessionDO 拆分预备 / 本轮 fix 部署验证 | 上述 I1-I6 的施工前提，必须在 Phase 0 一次扫干净 | RH0 |

### 4.2 全局 Out-of-Scope（本阶段明确不做）

| 编号 | 项目 | 为什么现在不做 | 重评条件 / 下游落点 |
|------|------|----------------|----------------------|
| O1 | admin plane（list/create/revoke API key UI、tenant CRUD UI） | charter Z1 已声明只做 minimal API key verify path；admin plane 是产品化的 hero-to-platform 工作 | RH 阶段闭合 + 至少 1 个真实租户在生产环境用 30 天后 → hero-to-platform charter |
| O2 | billing / quota policy / cost ledger | 同上；当前 quota 仅做最小 runtime gate | hero-to-platform |
| O3 | second LLM provider 启用（DeepSeek / OpenAI Chat adapter） | Workers AI 13 模型已覆盖核心；DeepSeek 当前是 throw-skeleton；多 provider 路由会引入 routing-policy 设计 | hero-to-platform 或独立 spike |
| O4 | catalog 真实 plug-in 注册框架（skill/command/agent registry） | 当前静态 CATALOG_SKILLS/COMMANDS/AGENTS 已能支撑 demo；plug-in 框架需要先有 admin plane | hero-to-platform |
| O5 | sandbox 隔离（seatbelt / WorkspaceWrite policy / 危险命令检测） | 当前 fake bash 已能支撑 demo；sandbox 是 hardening 阶段 | hero-to-platform 或独立 hardening sprint |
| O6 | OAuth federation（Google / GitHub / Apple / Microsoft） | WeChat 已覆盖核心目标用户；其他 provider 是 GTM 工作 | hero-to-platform |
| O7 | logout / token revocation endpoint | device revoke 已覆盖核心场景；显式 logout endpoint 是 v2 polish | RH 阶段闭合后 polish backlog |
| O8 | SQLite-backed Durable Object（user-do / session-do） | runtime-session-study 论证当前 first problem 不是缺 SQL；session loop memory-first 没坏 | 在 RH6 三层真相冻结后，若 user-do 的 list/分页确实因性能问题需要 SQL，再做独立 spike |
| O9 | 第 7 个 worker（skill.core 或 third-party-router） | 6-worker 拓扑由 plan-worker-matrix 冻结；real-to-hero 的 6 阶段都不依赖第 7 个 worker | hero-to-platform 或独立架构 spike |
| O10 | NACP error envelope 协议层重构（GLM R1：NACP_ERROR_BODY_VERBS 注册 vs wrapAsError 废弃二选一） | 当前活跃 RPC 路径走 `Envelope<T>` 的 ok:false 路径，不是运行时 blocker | RH 阶段闭合后 protocol-evolution backlog |
| O11 | 三层错误信封统一 / facadeFromRpcEnvelope 桥接（GLM R3） | 当前 wrapSessionResponse heuristic 可工作；统一是协议卫生 | 同上 |
| O12 | prompt caching / structured output（provider-specific 特性） | 依赖 multi-provider routing 先成立 | 同 O3 |
| O13 | streaming progress for long-running bash commands | 当前 capability 返回 atomic CapabilityResult 已支撑 demo；增量进度是 polish | RH 阶段闭合后 polish backlog |
| O14 | conversation 标题 / archive / delete / FTS 搜索 | 当前 listing 已可工作；title 等是 polish | RH 阶段闭合后 polish backlog |
| O15 | 用户偏好（theme / language / preferences） / user profile CRUD | 注册时已有 display_name；profile 更新是 polish | 同上 |
| O16 | 真机 / 微信开发者工具 / browser full evidence pack 在每个 Phase 都做 | 仅 RH6 P6-D 一次性归档；其他 Phase 用 `per-phase preview smoke`（curl/WS/script，见 §4.4 硬纪律）；详见 §9.5 evidence 三层定义 | RH6 |

### 4.3 灰区判定表（用来消除模糊空间）

| 项目 | 判定 | 判定理由 | 若要翻案，需要什么新事实 |
|------|------|----------|--------------------------|
| 注册时让 client 指定 team_name | `in-scope` (RH3) | 多团队产品最基础前端展示；migration 009-team-display-and-api-keys.sql | — |
| 注册时让 client 指定 team_slug | `out-of-scope, owner-action` | slug 唯一性 / 长度 / charset 策略需要 owner 决策；自动生成已能覆盖 first-wave | owner 在 RH3 启动前明确 slug 策略 |
| `POST /me/teams`（用户主动新建第 2 个 team） | `out-of-scope` | 多团队归属是产品复杂度，admin plane 范畴 | hero-to-platform |
| `GET /me/teams`（列出当前用户所属所有 team） | `in-scope` (RH3) | 用户当前可能已属多个 team（注册自动建 1 个 + 被邀请加入其他）；list 是只读简单查询 | — |
| `POST /me/teams/{uuid}/invite`（邀请成员） | `out-of-scope` | admin plane | hero-to-platform |
| 在 nano_models 表存 per-team policy | `in-scope` (RH2) | /models 端点的 team policy filter 必须有 storage | — |
| 在 nano_models 表存 per-team default model | `in-scope` (RH2) | model picker 的"默认选中"需要 | — |
| 让 owner 通过 admin endpoint 修改 nano_models | `out-of-scope` | admin plane；first-wave 通过 seed migration 注入即可 | hero-to-platform |
| 注册全部 13 个 Workers AI function-calling 模型 | `in-scope` (RH5) | 4 家共识 + 平台已有；context window 修正 131K | — |
| 启用全部 4 个 vision 模型 | `in-scope` (RH5) | llama-4-scout 已是 fallback，激活 supportsVision flag 几乎无成本 | — |
| 启用全部 8 个 reasoning 模型 | `in-scope` (RH5) | reasoning effort 参数贯通是 first-wave 价值点；不增加新 provider 复杂度 | — |
| 启用 OpenAI Chat adapter（已有 322 行实现） | `out-of-scope` | 同 O3，多 provider 路由是 hero-to-platform | hero-to-platform |
| WS 切换到 NACP full frame | `in-scope` (RH2) | 协议代码完备；不切就一直漂移 | — |
| 删除 lightweight `{kind, ...}` 兼容路径 | `out-of-scope` | 保留 1 个 release 兼容是 owner 风险偏好；强制删除是 v2 | RH 阶段闭合后 1 release 自然下线 |
| NanoSessionDO 拆 verify + persistence | `in-scope` (RH0) | 后续 Phase 在巨石内施工成本太高 | — |
| NanoSessionDO 完整拆 7 个文件 | `in-scope` (RH6) | 在 Lane F 改造后做，避免 rebase hell | — |
| user-do.ts 拆分 | `in-scope` (RH6) | 同上 | — |
| 引入 SQLite-DO | `out-of-scope` | 决议 D2 | RH 闭合后独立 spike |
| 引入第 7 worker | `out-of-scope` | 决议 D1 | hero-to-platform |
| /sessions/{id}/files 加上传 (POST) | `in-scope` (RH4) | 4 家共识 P1；R2 binding 启用后顺手做 | — |
| 3-step file upload（create → presigned PUT → finalize） | `out-of-scope` | first-wave 用 multipart/form-data 直传已够；3-step 是 polish | RH 闭合后 polish |
| Permission decision DO storage waiter（emitPermissionRequestAndAwait） | `in-scope` (RH1) | Lane F 闭合的核心 | — |
| Permission DO storage 结构化为 SQLite | `out-of-scope` | 同 SQLite-DO 否决 | — |

### 4.4 必须写进 charter 的硬纪律

1. **不新增 worker**（决议 D1）。所有新功能必须在 6-worker 内消化。
2. **不引入 SQLite-DO**（决议 D2）。session loop 继续 memory-first；user-do / session-do 继续 KV-style storage。
3. **三层真相不互相吸收**（决议 D6）。session DO memory ≠ user DO storage ≠ D1；新 endpoint / 新读写路径必须显式声明属于哪一层。任何"为了性能把 D1 数据复制到 KV"的 PR 必须在 charter 层报备。
4. **首先冻结测试矩阵**（RH0 必须先做）。任何 Phase 在没有 endpoint-level 直达测试时不允许声称收口。
5. **client API 一律使用 facade envelope**（`{ok, data, trace_uuid}`）。新增 API 不得继续扩展 legacy `{ok, action, ...}` shape。
6. **Lane E binding 启用时 dual-track 必须有 owner-decided sunset**（不允许 library import + RPC consumer 永久并存）。
7. **三层 evidence 纪律**（详见 §9.5）：
   - `per-phase preview smoke`（每 Phase 必做）：preview deploy + curl/WS/script 验证关键路径，不需要 owner 真机。
   - `RH0/RH6 owner manual evidence`（仅这两点做）：browser console + network log + WS frame log，需要 owner 操作。
   - `RH6 real-device evidence`（仅 RH6 做）：iOS/Android 真机 + 微信开发者工具，全旅程覆盖。
   不允许把"真机/微信 full evidence"前移到非 RH6 phase；也不允许把"per-phase preview smoke"省略。

### 4.5 必须写明的例外（如有）

`/debug/workers/health` 是 ops/debug exception：orchestrator-core 直接 bind 全部 5 个 leaf worker 仅用于健康探针，不得扩散到业务路由依赖。本阶段保留此例外，不视为 6-worker 拓扑漂移。

---

## 5. 本阶段的方法论

| 方法论 | 含义 | 它避免的错误 |
|--------|------|--------------|
| **Reality-anchored start** | 起点是 2026-04-29 真实代码（不是 api-gap-study 撰写时的 04-28 状态） | 重复实现 ZX5 Lane D 已落地的 endpoints；把 closure §4 当成全部 scope |
| **Test-first endpoint hardening** | 任何 endpoint 没有 endpoint-level 直达测试，不允许在 charter / closure 中宣称"已落地" | DS R1 needsBody 类 silent-drop bug 无人捕获 |
| **Three-layer truth discipline** | session DO memory / user DO storage / D1 三层职责严格分离；新 endpoint 必须显式属于一层 | 双重真相 / 同一数据在多层互不一致（如 /me/conversations 仅 D1 vs /me/sessions KV+D1） |
| **Refactor-before-feature** | NanoSessionDO / user-do.ts 巨石必须在 Lane F 等大改造前拆分预备（RH0 verify+persistence）+ 完整拆分（RH6） | 巨石内堆积新功能 → conflict / regression 成本指数级 |
| **Endpoint-level closure** | 每个 endpoint 必须满足"代码 + 测试 + manual smoke + closure §4 标注"四件套才算 done | "代码已存在但运行时不可达"（DS R5 WorkerEntrypoint export bug 类型）再次发生 |
| **Reviewer-aware honesty** | 每 Phase 退出前必须诚实标注哪些是"基础设施成立"vs"live runtime 成立"vs"真实客户端验证" | zero-to-real 那种"infra landed, wiring deferred"被误读为完成态 |
| **Charter-truthful severity** | 当 charter exit criterion 与代码现实不符时，必须升级严重级别（如 device revoke 不进 auth gate ⇒ Z1 auth criterion 不真正成立 ⇒ blocker 而非 polish） | 把 partial 写成 closed，下阶段把真实 blocker 当 backlog |

### 5.1 方法论对 phases 的直接影响

- **Reality-anchored start** 影响：RH0 必须先做"已落地 vs 仍 missing"对账（已在 closing-thoughts §0 完成）。
- **Test-first endpoint hardening** 影响：RH0 P0-B 是其他所有 Phase 的 prerequisite；每 Phase 退出条件必含"endpoint-level test ≥ N 用例"。
- **Three-layer truth discipline** 影响：RH3 P3-D 双源对齐 + RH4 KV/R2 启用 + RH6 P6-C 三层真相文档冻结，三处协同。
- **Refactor-before-feature** 影响：RH0 拆 verify+persistence；RH6 完整拆分前不允许在 NanoSessionDO 主文件内继续添加新功能。
- **Endpoint-level closure** 影响：每 Phase exit 必含 manual smoke + closure §4 标注。
- **Reviewer-aware honesty** 影响：每 Phase closure 必须显式列 "live runtime 成立 vs 仅 infra 成立" 的差异。
- **Charter-truthful severity** 影响：RH3 device auth gate 是 blocker 而非 polish；RH1 Lane F 是 blocker 而非 best-effort。

---

## 6. Phase 总览与职责划分

### 6.1 Phase 总表

| Phase | 名称 | 类型 | 核心目标 | 主要风险 |
|------|------|------|----------|----------|
| RH0 | Bug 修复 + 前期准备 | freeze + implementation | jwt-shared lockfile + ZX5 endpoint test + KV/R2 binding 占位 + NanoSessionDO 拆 verify+persistence + 本轮 fix 部署验证 | owner-action 依赖（NODE_AUTH_TOKEN / R2 bucket 创建）卡住整阶段 |
| RH1 | Lane F live runtime 完整闭合 | implementation | hook.emit delegate / scheduler hook_emit / Permission+Elicitation round-trip / onUsageCommit WS push | scheduler 改造涉及 agent-core 1056 测试相当一部分回归 |
| RH2 | 客户端可见性闭环 | implementation | GET /models + GET /sessions/{id}/context + WS NACP frame + tool result frame + bidirectional WS | WS 协议升级与 client SDK 版本不一致；增量 tool call streaming 的 LLM provider 行为差异 |
| RH3 | 租户产品面 | implementation | D6 device auth gate / nano_teams team_name+slug / verifyApiKey / /me/conversations 双源 / refresh+device 绑定 | device status 缓存与 D1 一致性；API key 鉴权与 JWT 双轨切换的 path collision |
| RH4 | filesystem 真实持久化 + Lane E consumer migration | implementation + migration | KV/R2 binding 启用 / filesystem-core 业务 RPC / agent-core binding 启用 / file upload pipeline / migration 010-session-files.sql | multi-tenant 边界 bug 在切真实 R2 后暴露；Lane E dual-track sunset 拖延变永久并存 |
| RH5 | 多模型 + 多模态 + reasoning 上线 | implementation + migration | 13 + 4 vision + 8 reasoning 模型注册；per-session model_id；reasoning effort 参数；llama-4-scout vision 激活 | per-model quota 设计被 cost / billing 牵引到 admin plane（O2 边界） |
| RH6 | 巨石拆分 + 三层真相冻结 + manual evidence | refactor + closure | NanoSessionDO 完整拆 7 文件 + user-do.ts 按 domain 拆 + 三层真相 doc + manual browser/微信/真机 evidence pack | 与 RH1-RH5 改动的合并冲突；manual evidence 依赖 owner-action |

### 6.2 Phase 职责矩阵

| Phase | 本 Phase 负责 | 本 Phase 不负责 | 进入条件 | 交付输出 |
|------|---------------|----------------|----------|----------|
| RH0 | 测试矩阵 + 基础设施 binding 占位 + 巨石拆分预备 + lockfile + 部署验证 | 任何 Lane F / WS 协议 / API 端点新功能 | zero-to-real partial-close 已发布 + 本轮 implementer fix 已合并 | jwt-shared 独立 build/test 通过 / ≥5 ZX5 endpoint tests / wrangler 含 KV+R2 占位 / NanoSessionDO ≤1500 行 / preview deploy evidence |
| RH1 | hook.emit delegate / scheduler hook_emit / Permission+Elicitation round-trip / onUsageCommit WS push / handleUsage HTTP 真实化 | 新增任何 client-facing endpoint；改 WS frame 协议 | RH0 全部退出条件满足 | Lane F 4 链全通 e2e 证据 / agent-core 测试矩阵不回归 |
| RH2 | GET /models endpoint + GET /sessions/{id}/context endpoint + WS NACP frame upgrade + tool call 增量 + tool result frame | 模型本身的注册（在 RH5）；filesystem 真实持久化（在 RH4） | RH1 Lane F 闭合 | 5 个新 endpoint 测试全绿 / WS bidirectional smoke evidence |
| RH3 | D6 device auth gate / migration 009-team-display-and-api-keys.sql / verifyApiKey 实装 / /me/conversations 双源对齐 / refresh+device 绑定 | API key admin plane（list/create UI）；OAuth federation | RH1 完成（device WS push 依赖 onUsageCommit 同款机制） | device revoke e2e（含 WS force-disconnect）/ verifyApiKey server-to-server smoke / /me/conversations 双源测试 |
| RH4 | KV/R2 binding 启用 / filesystem-core 业务 RPC / agent-core CONTEXT_CORE+FILESYSTEM_CORE binding 启用 / migration 010-session-files.sql / POST /sessions/{id}/files upload | multi-modal 模型激活（在 RH5）；prepared artifact 完整 pipeline（仅占位 stub） | RH0 KV/R2 binding 占位完成 + RH1 完成 | filesystem-core RPC e2e / image upload to R2 smoke / Lane E dual-track owner-decided sunset 写入 charter §4.3 |
| RH5 | nano_models seed 13+4+8 / per-session model_id 透传 / reasoning effort / vision capability 激活 | 第 2 个 LLM provider；prompt caching / structured output | RH2 GET /models endpoint / RH4 R2 file upload | /models 真实返回 13+ 模型 / image 输入 → llama-4-scout 端到端 / reasoning effort 4 等级 e2e |
| RH6 | NanoSessionDO 完整拆 7 文件 / user-do.ts 按 domain 拆 / 三层真相文档 / manual browser/微信/真机 evidence | 任何新功能；任何新 schema | RH1-RH5 全部 merge | NanoSessionDO ≤400 行 / user-do.ts ≤500 行 / `docs/architecture/three-layer-truth.md` / `docs/evidence/{web,wechat,realdevice}-manual-2026-XX/` |

### 6.3 Phase 之间的交接原则

1. **每 Phase 交接前必须有 endpoint-level 测试 + manual smoke 双保险**。下游 Phase 不为上游 Phase 的回归 buy back。
2. **Phase 内部不允许引入下游 Phase 的依赖反向耦合**（如 RH1 引入 GET /models 设计选择；RH3 提前实装 nano_models seed）。
3. **每 Phase closure 必须显式区分"基础设施成立"vs"live runtime 成立"**（避免 zero-to-real 那种 infra-landed 被误读为闭环）。

---

## 7. 各 Phase 详细说明

### 7.1 RH0 — Bug 修复 + 前期准备

#### 实现目标

把 zero-to-real partial-close 残留的 4 项基础设施断点（jwt-shared lockfile / ZX5 endpoint 测试缺失 / KV+R2 binding 未声明 / 巨石拆分预备）一次扫干净，并验证本轮 implementer fix 在 preview 部署后真实生效。

#### In-Scope

1. P0-A：jwt-shared 独立 build/test 修复 + pnpm-lock.yaml 刷新（含删除 stale importer）。
2. P0-B：≥5 个 ZX5 product endpoint 直达测试（messages / files / me-conversations / me-devices-revoke / permission-decision / elicitation-answer / policy-permission-mode 至少 5 条）。
3. P0-C：在 filesystem-core / agent-core / orchestrator-core wrangler.jsonc 占位声明 KV namespace + R2 bucket binding（不启用业务路径，仅确保 dry-run 通过 + binding 在启动可见）。
4. P0-D：NanoSessionDO 拆 `session-do-verify.ts` + `session-do-persistence.ts`，主文件 ≤1500 行（pure refactor，不改 route shape / storage key / runtime 语义）。
5. P0-E：本轮 implementer fix preview deploy + manual smoke（needsBody / WorkerEntrypoint RPC / JWT_LEEWAY）+ evidence 归档至 `docs/issue/zero-to-real/post-fix-verification.md`。
6. **P0-F：owner-action 凭据验证 checklist**（per R4 review 回应）— 替代原 D4 的 memory 引用。在 `docs/owner-decisions/real-to-hero-tooling.md` 记录可重复验证的 checklist：`wrangler whoami` / `gh auth status` / `pnpm --filter @haimang/jwt-shared build`（带 NODE_AUTH_TOKEN）/ `wrangler r2 bucket list` / `wrangler kv namespace list` / `wrangler ai models --json | wc -l ≥ 13`。文件不记录任何具体 token 或敏感值，只记录验证步骤与"通过/未通过"结果。
7. **P0-G：bootstrap hardening**（per closure §4 item 6 split + R1 review）— register/login/refresh 在 cold-start cluster 与 D1 latency spike 下的稳定性测试；至少 3 个 stress test 用例（cold-start 100 并发 register / D1 慢响应 5s 模拟 / refresh chain 旋转风暴）。

#### Out-of-Scope

1. 任何 Lane F live runtime 改造（在 RH1）。
2. 任何 client-facing 新 endpoint（在 RH2-RH5）。
3. 任何巨石的"功能性"拆分（仅 RH0 P0-D 两个文件 pure refactor；其他在 RH6）。

#### 交付物

1. `pnpm-lock.yaml`（更新）。
2. `workers/orchestrator-core/test/{messages,files,me-conversations,me-devices,permission-decision,elicitation-answer,policy-permission-mode}-route.test.ts`（**每文件 ≥5 用例 per §9.2**；共 ≥7 文件 ≥35 用例）。
3. `workers/{filesystem-core,agent-core,orchestrator-core}/wrangler.jsonc`（KV+R2 binding 占位）。
4. `workers/agent-core/src/host/do/session-do-verify.ts` + `session-do-persistence.ts`。
5. `docs/issue/zero-to-real/post-fix-verification.md`（preview deploy evidence）。
6. **`docs/owner-decisions/real-to-hero-tooling.md`**（P0-F checklist 可审计版本）。
7. **`workers/orchestrator-auth/test/bootstrap-hardening.test.ts`**（P0-G stress 用例）。

#### 收口标准

1. `pnpm --filter @haimang/jwt-shared build typecheck test` 全绿。
2. ZX5 endpoint 直达测试 ≥ **7 文件 ≥ 35 测试用例**（per §9.2 endpoint-level 测试纪律：每个新增 public endpoint ≥ 5 用例）全绿。
3. `pnpm -r run test` 全 worker 测试矩阵全绿（含 NanoSessionDO 拆分后 agent-core 1056+ 测试不回归）。
4. `wrangler deploy --dry-run` 在 6 worker 全部通过；KV+R2 binding 在 Worker 启动 env 中可见（但 binding 业务路径未启用，仅占位）。
5. NanoSessionDO 主文件 ≤1500 行；拆出文件总行数 ≈ 原 ≥ 拆出量（净增不超 50 行）。
6. preview deploy 后 Tier-A per-phase preview smoke + Tier-B owner manual evidence（needsBody / WorkerEntrypoint RPC / JWT leeway）全部通过 + evidence 归档（per §9.5 evidence 三层定义）。
7. P0-F owner-action checklist 全部 ✓；P0-G bootstrap hardening 3 个 stress test 全绿。

#### 什么不算完成

1. lockfile 在 owner 本地刷新但没提交到主线。
2. ZX5 endpoint 测试只覆盖 happy path，不覆盖 needsBody silent-drop 回归保护，或不满足 §9.2 每文件 ≥5 用例。
3. KV+R2 binding 声明但 dry-run 失败（如 namespace ID 拼错）。
4. NanoSessionDO 拆分后 agent-core 测试有任意 1 条回归。
5. preview deploy 失败但 RH1 已开工。
6. P0-F checklist 任一项未通过 owner 显式验证。

#### 本 Phase 风险提醒

- jwt-shared lockfile 修复需 NODE_AUTH_TOKEN，依赖 owner-action；如 owner 未及时提供，RH0 卡死全阶段。建议：RH0 启动当天第一件事 sync owner。
- NanoSessionDO 拆分若 verify/persistence 边界识别错误，可能导致 import cycle 或 tenant-scoped storage 语义漂移。建议 pure refactor 守则严格守住。
- bootstrap hardening 在 D1 latency spike 模拟下可能暴露未识别的 race condition；建议预留 buffer 时间。

---

### 7.2 RH1 — Lane F live runtime 完整闭合

#### 实现目标

把 zero-to-real closure §4 item 9-10 中的 Lane F 4 链全断（hook.emit no-op / scheduler 不产生 hook_emit / emitPermissionRequestAndAwait 零调用方 / onUsageCommit 仅 console.log）一次性接通，让 Permission round-trip 与 Usage push 成为真实可用的客户端能力。

#### In-Scope

1. P1-A：hook.emit kernel delegate 真实化（替换 no-op；接 dispatcher）。
2. P1-B：scheduler 产生 hook_emit 决策（PreToolUse / PostToolUse / PermissionRequest / PostCompact 等 catalog 事件）。
3. P1-C：emitPermissionRequestAndAwait / emitElicitationRequestAndAwait 真实激活（DO storage waiter + WS frame emit + HTTP decision unblock）。
4. P1-D：onUsageCommit WS push 完整路径（NanoSessionDO → user-do `forwardServerFrameToClient` RPC → client WS）。
5. P1-E：handleUsage HTTP snapshot 查 D1 真实化（替换 null placeholders）。

#### Out-of-Scope

1. 新增 hook 类型（catalog 18 事件之外）。
2. 新增 client-facing endpoint（在 RH2-）。
3. WS 协议升级到 NACP full frame（在 RH2）。

#### 交付物

1. `workers/agent-core/src/kernel/scheduler.ts`（含 hook_emit 决策生成）。
2. `workers/agent-core/src/host/runtime-mainline.ts`（替换 no-op delegate）。
3. `workers/agent-core/src/host/do/nano-session-do.ts`（onUsageCommit 接 user-do RPC；emitPermission/Elicitation 真实激活）。
4. `workers/orchestrator-core/src/user-do.ts`（forwardServerFrameToClient RPC handler）。
5. `workers/agent-core/test/lane-f-{permission,elicitation,usage}-e2e.test.ts`。

#### 收口标准

1. Permission round-trip e2e ≥3 用例（allow / deny / timeout）通过。
2. Elicitation round-trip e2e 通过。
3. onUsageCommit → WS push live preview deploy + ws client manual smoke evidence 归档。
4. handleUsage HTTP 不再返回 null；token / tool / cost 真实值。
5. agent-core 测试矩阵 1056+ 测试不回归（允许新增测试）。
6. closure §4 items 9 / 10 标记为 fixed。

#### 什么不算完成

1. hook.emit delegate 改为 console.log（与现有 onUsageCommit partially-fixed 同档次）而非真实接 dispatcher。
2. emitPermissionRequestAndAwait 有 caller 但 WS frame emit 仍是 stub。
3. onUsageCommit 接到 user-do RPC 但 user-do 未真实推 client WS。
4. e2e 测试通过但 preview deploy live smoke 失败。

#### 本 Phase 风险提醒

- scheduler 改造 + delegate 注入是 agent-core 1056 测试矩阵的核心路径；规模较大，建议在独立 feature branch 开发，cross-e2e 稳定 ≥3 天后再合主。
- emitPermission/Elicitation 的 DO storage waiter 已有基础设施（deferredAnswers Map），但 timeout / disconnect / replay 行为是新场景；需补 timeout 测试。
- onUsageCommit 跨 worker（agent-core → orchestrator-core）路径需要新的 internal RPC method；authority 校验必须从 day 1 严格守住。

---

### 7.3 RH2 — 客户端可见性闭环

#### 实现目标

把 4 家 api-gap-study P0 共识（GET /models + GET /sessions/{id}/context + WS NACP frame + tool call 增量 + tool result frame）一次性落地，让真实 client 能选择模型、查 context 状态、看到 tool 执行细节。

#### In-Scope

1. P2-A：GET /models endpoint（含 D1 nano_models seed 13+ 模型，per-team policy filter，ETag 支持）。
2. P2-B：GET /sessions/{id}/context endpoint + POST /sessions/{id}/context/{snapshot,compact} endpoints。
3. P2-C：WS 协议升级到 NACP full frame（保留 lightweight 1 release 兼容）+ meta(opened) on connection + client → server bidirectional 处理（stream.ack / resume / permission.decision / elicitation.answer）+ **WS heartbeat lifecycle hardening**（per closure §4 item 4：normal close / abnormal disconnect / heartbeat miss / replay-after-reconnect 各覆盖；DO alarm 与 WS lifecycle 协同；Cloudflare WS platform close semantics 显式处理）。
4. P2-D：Tool call **semantic-chunk** 流式（tool_use_start / delta / stop）+ tool.call.progress + tool.call.result frame emit。
5. P2-E：**LLM delta policy 决议**（per closure §4 item 2 + R7 review）：token-level streaming **out-of-scope** 留 hero-to-platform；本阶段 RH2 只保证 semantic-chunk streaming（tool-call 增量 + tool.call.result）；snapshot-vs-push policy 文档化（usage = WS push best-effort + HTTP snapshot strict-consistent；permission/elicitation = WS push only with HTTP fallback for ack）。

#### Out-of-Scope

1. 模型注册的具体清单扩展到 13+4+8（在 RH5；RH2 只 seed minimal 必须的字段 schema）。
2. 多模态 image input（在 RH5 / RH4 协同）。
3. 新增任何非客户端可见性 endpoint。
4. **token-level LLM delta streaming**（per P2-E 决议；留 hero-to-platform）。

#### 交付物

1. **migration 008-models.sql**（仅建 `nano_models` 表 + per-team model policy 字段；**不含** team_name/team_slug — 移到 RH3 migration 009，避免 RH2/RH3 并行修改同一 migration，per R2 review）。
2. `workers/orchestrator-core/src/index.ts`（routes /models, /context*）。
3. `workers/agent-core/src/host/do/nano-session-do.ts`（getContextSnapshot RPC + tool_use_delta emit + tool.call.result emit）。
4. `workers/orchestrator-core/test/{models,context}-route.test.ts` + `workers/agent-core/test/tool-call-streaming-e2e.test.ts`。
5. `workers/agent-core/test/ws-lifecycle-hardening.test.ts`（per closure §4 item 4，4 用例）。
6. `docs/design/real-to-hero/RH2-llm-delta-policy.md`（snapshot-vs-push 决议落地文档）。

#### 收口标准

1. GET /models 返回 ≥ minimal 模型列表（具体 13+4+8 在 RH5）；per-team policy filter 工作；ETag 行为正确。**测试覆盖：≥5 endpoint 用例**（per §9.2）。
2. GET /sessions/{id}/context 与 InspectorFacade 数据互通；POST snapshot/compact 工作。**测试覆盖：≥5 endpoint 用例 each**。
3. WS 升级后所有现有测试通过；client → server 4 类消息（stream.ack / resume / permission.decision / elicitation.answer）真实处理；**heartbeat lifecycle hardening 4 用例全绿**。
4. Tool call **semantic-chunk** 增量 + tool result frame e2e 通过；**至少覆盖 2 个不同模型**（granite + llama-4-scout）。
5. closure §4 item 2 + item 4 标注完成；P2-E 决议文档发布。

#### 什么不算完成

1. /models 仅返回硬编码 2 模型（不查 D1 nano_models）。
2. /sessions/{id}/context 返回静态 stub。
3. WS 升级后 lightweight 兼容性回归 1 case。
4. tool call 增量但 tool result 不发到 client。

#### 本 Phase 风险提醒

- WS 协议升级若与 client SDK 版本不一致（web client / wechat-miniprogram），在 RH6 manual evidence 阶段会暴露；建议 RH2 同步更新两个 client 的 WS adapter。
- 增量 tool call streaming 在 Workers AI 不同模型行为可能差异（granite vs llama-4-scout 的 function-calling SSE 帧形态不一定完全对齐）；建议 RH2 e2e 至少覆盖 2 个模型。

---

### 7.4 RH3 — 多租户产品面

#### 实现目标

让 zero-to-real auth criterion "完整 end-user auth truth" 真正成立 — D6 device revoke 进入 access/refresh/WS gate；nano_teams 提供可读名称；server-to-server 鉴权通过 API key；用户多设备状态可管理。

#### In-Scope

1. P3-A：D6 device revoke 进入 access/refresh/WS auth gate（含 device_uuid claim 注入 + verifyAccessToken D1 lookup + WS attach 拒绝 revoked device + 同 device 已 attached WS 主动 force-disconnect）。
2. P3-B：**migration 009-team-display-and-api-keys.sql**（nano_teams.team_name+slug + API key 字段补充 + refresh-session ↔ device_uuid 关联）；注册时自动生成 team_name/slug；/auth/me 返回；PATCH /me/team 允许 owner 更新 name。
3. P3-C：verifyApiKey 实装（HMAC-SHA256(salt:raw) 查 nano_team_api_keys；authenticateRequest 双轨支持 JWT + API key bearer）；提供 internal RPC createApiKey 用于 manual 测试。
4. P3-D：/me/conversations D1+KV 双源对齐（与 handleMeSessions 一致策略）+ cursor-based pagination（基于 latest_session_started_at keyset）。
5. P3-E：refresh / access token 与 device_uuid 绑定（login/register 自动 mint device_uuid + nano_user_devices insert；refresh rotation 保持 device_uuid 绑定；GET /me/devices）。

#### Out-of-Scope

1. API key admin plane（list/create/revoke UI）— 仅提供 internal RPC 用于 manual。
2. OAuth federation。
3. team invite / member management（仅做 GET /me/teams 只读）。

#### 交付物

1. **migration 009-team-display-and-api-keys.sql**（nano_teams.team_name+slug；API key hash/salt 字段补充；refresh-session ↔ device_uuid 关联字段）— per R2 review 修正：与 RH2 migration 008-models.sql 解耦，避免 RH2/RH3 并行修改同一 migration。
2. `workers/orchestrator-auth/src/{service,jwt,repository}.ts`（device_uuid claim + verifyApiKey 实装）。
3. `workers/orchestrator-core/src/{auth,user-do}.ts`（authenticateRequest 双轨 + /me/team 路由 + /me/conversations 双源 + /me/devices GET）。
4. `workers/orchestrator-core/test/{device-auth-gate,api-key-verify,me-conversations-dual-source,me-devices}-e2e.test.ts`（每文件 ≥5 用例 per §9.2）。

#### 收口标准

1. Device revoke e2e：revoke 后访问 /me 返回 401（不再 access token 有效期内可用）；refresh 立即被拒；同 device 已 attached WS 收到 meta(force-disconnect) 然后服务端关闭。
2. /auth/me 返回 team_name / team_slug；PATCH /me/team 工作。
3. verifyApiKey server-to-server smoke：用 `nak_...` bearer token 调 `/me` 通过；JWT 与 API key 双轨不冲突。
4. /me/conversations 与 /me/sessions 数据集一致；cursor pagination 工作（含 next_cursor null when 末页）。
5. closure §4 items 8 / 12 / 14 标注完成。

#### 什么不算完成

1. Device revoke 仅在 refresh path 拒绝，access token 仍可用。
2. team_name 自动生成但 PATCH /me/team 未实装。
3. verifyApiKey 实装但 authenticateRequest 仍只走 JWT。
4. /me/conversations cursor 字段始终为 null。

#### 本 Phase 风险提醒

- Device status 检查在每次 verifyAccessToken 都查 D1 会增加 latency；引入 user-do KV cache（5 分钟 TTL，revoke 主动清）但需注意一致性窗口。
- API key 与 JWT 双轨在同一 path 上的 collision 检测必须严格（前缀区分 `eyJ` vs `nak_`）；不允许 bearer 既是 JWT 又是 API key 的歧义。

---

### 7.5 RH4 — filesystem 真实持久化 + Lane E consumer migration

#### 实现目标

让 filesystem-core 脱离 in-memory + library-only 状态，成为真实业务 RPC consumer；agent-core 通过 service binding 启用 CONTEXT_CORE / FILESYSTEM_CORE；client 能上传 image 到 R2 并被 agent loop 引用。

#### In-Scope

1. P4-A：KV/R2 binding 业务启用（在 RH0 占位基础上）；R2ArtifactStore + R2ArtifactReader 实装替换 InMemoryArtifactStore。
2. P4-B：filesystem-core 业务 RPC（writeArtifact / readArtifact / listSessionFiles / prepareArtifact stub）。
3. P4-C：migration 010-session-files.sql（nano_session_files 表）；handleFiles 改查此表。
4. P4-D：Lane E consumer migration — agent-core wrangler.jsonc 启用 CONTEXT_CORE+FILESYSTEM_CORE binding；env flag dual-track（短期 shim ≤ 2 周）；library import 在 dual-track sunset 后删除。
5. P4-E：POST /sessions/{id}/files upload pipeline（multipart/form-data 直传，3-step 留 polish）。

#### Out-of-Scope

1. 3-step file upload（presigned R2 PUT URL flow）。
2. prepared artifact 真实 pipeline（image resize / pdf text extraction / audio transcript）— 仅占位 stub。
3. Multi-tenant per-deploy R2 bucket 隔离 — 一个 R2 bucket 内通过 `tenants/{teamUuid}/...` key namespace。

#### 交付物

1. migration 010-session-files.sql。
2. `workers/filesystem-core/src/{artifacts,storage}/...`（R2 / KV / D1 真实业务）。
3. `workers/filesystem-core/src/index.ts`（FilesystemCoreEntrypoint 业务 RPC）。
4. `workers/agent-core/wrangler.jsonc`（解开 CONTEXT_CORE+FILESYSTEM_CORE binding 注释）。
5. `workers/agent-core/src/host/do/nano-session-do.ts`（context/filesystem RPC-first dual-track + env flag）。
6. `workers/orchestrator-core/src/user-do.ts`（POST /sessions/{id}/files multipart handler）。
7. `workers/{filesystem-core,agent-core,orchestrator-core}/test/file-upload-r2-e2e.test.ts`。

#### 收口标准

1. POST /sessions/{id}/files upload image → R2 真实存储 → GET /sessions/{id}/files 返回 metadata（含 R2 ref）→ GET /sessions/{id}/files/{file_uuid}/content 下载工作。
2. agent-core 通过 service binding 调 context-core.contextOps / filesystem-core.filesystemOps 真实方法（RPC-first env flag = true）。
3. Lane E dual-track sunset 时间盒在 charter 中写明（≤ 2 周）；之后 library import 删除。
4. multi-tenant key namespace 校验：team A 的 file_uuid 不能被 team B 通过任何 endpoint 列出或下载。
5. closure §4 item 11 标注完成。

#### 什么不算完成

1. R2 binding 启用但 ArtifactStore 仍是 InMemoryMap。
2. filesystem-core RPC 真实但 agent-core 仍走 library import。
3. POST /sessions/{id}/files 工作但未做 team_uuid path 隔离校验。
4. dual-track 开始但没写 sunset 时间盒。

#### 本 Phase 风险提醒

- 切真实 R2 后 multi-tenant 边界 bug 会暴露；当前 fake backend 不会在 path 编码 team_uuid。建议在 R2 path 引入 `tenants/{teamUuid}/...` 强制前缀；任何裸 file_uuid 路径都视为 bug。
- Lane E dual-track 若 sunset 时间盒拖延，会回到 zero-to-real "library + RPC 永久并存" 的反模式。建议 RH4 闭合时强制删除 library import。

---

### 7.6 RH5 — 多模型 + 多模态 + reasoning 上线

#### 实现目标

让 client 能用 13 个 Workers AI function-calling 模型 + 4 个 vision 模型 + 8 个 reasoning 模型，在 per-session 维度选择，并通过 reasoning effort 参数贯通到底层。

#### In-Scope

1. P5-A：nano_models seed 13 个 function-calling 模型（含 context window 真实值修正：131K not 128K）。
2. P5-B：Per-session model_id 透传（SessionStartBodySchema / SessionMessagesBodySchema 加 `model_id?` 字段；user-do → agent-core 透传；team policy validation）。
3. P5-C：Vision capability 激活（llama-4-scout / llama-3.2-11b-vision / llava-1.5-7b / gemma-3-12b 设 supports_vision=true）；POST /messages 支持 image_url content part；validateExecutionRequest 不再 silent-drop。
4. P5-D：Reasoning effort 参数贯通（CanonicalLLMRequest.reasoning?: { effort: "low|medium|high" }；Workers AI adapter 翻译；不支持 reasoning 的 model 返回 capability error）。

#### Out-of-Scope

1. 第 2 个 LLM provider（DeepSeek / OpenAI Chat 启用） — 决议 O3。
2. Per-model quota（仅在 PostHocBudget 上记录 model_id；不强制 per-model 配额）— 留 polish。
3. Prompt caching / structured output —决议 O12。

#### 交付物

1. seed migration / D1 data update：nano_models 13+4+8 行。
2. `workers/agent-core/src/llm/{gateway,adapters/workers-ai,canonical-types}.ts`（model_id 透传 + reasoning + vision capability）。
3. `packages/nacp-session/src/messages.ts`（schema 加 model_id + image_url part 已支持，仅确认）。
4. `workers/orchestrator-core/test/multi-model-e2e.test.ts`（granite / llama-4-scout / kimi-k2.6 / gpt-oss-120b 四个不同模型至少各 1 e2e）。

#### 收口标准

1. GET /models 返回 ≥ 13 + 4 + 8 数据；context window 全部正确（131K/256K/262K）。
2. POST /sessions/{id}/messages 带 model_id="@cf/meta/llama-4-scout-17b-16e-instruct" + image_url content part → 真实 multimodal 推理。
3. POST /sessions/{id}/messages 带 model_id="@cf/openai/gpt-oss-120b" + reasoning.effort="high" → 真实 reasoning 推理。
4. team policy validation：用户传 disabled-by-team 的 model_id 返回 403。
5. closure 标注 Workers AI multi-model live。

#### 什么不算完成

1. nano_models seed 但 GET /models 仍硬编码 2 模型。
2. model_id 透传但 agent-core 仍用 default model。
3. supports_vision = true 但 buildExecutionRequest 仍 silent-drop image_url。
4. reasoning effort 字段加入 schema 但 Workers AI adapter 不翻译。

#### 本 Phase 风险提醒

- per-model quota 设计若被 cost / billing 牵引会越界到 admin plane（O2 边界）。建议本 Phase 仅记录 model_id 到 nano_usage_events，不引入 per-model 配额上限。
- llama-4-scout 多模态在不同 image MIME 下行为可能不一致；e2e 至少覆盖 png + jpeg 两种。

---

### 7.7 RH6 — 巨石拆分 + 三层真相冻结 + manual evidence

#### 实现目标

把 NanoSessionDO（2078 行）+ user-do.ts（2285 行）巨石完整拆分到 maintainable 状态；冻结三层真相文档；归档 manual browser/微信开发者工具/真机 evidence 作为 real-to-hero 收口前置。

#### In-Scope

1. P6-A：NanoSessionDO 完整拆 7 个文件（在 RH0 verify+persistence 基础上完成 bootstrap / identity / ingress / ws / orchestration-deps）。
2. P6-B：user-do.ts 按 domain 拆 handlers/{start, input, messages, cancel, verify, files, me-conversations, me-devices, permission-decision, elicitation-answer}.ts + user-do-infrastructure.ts。
3. P6-C：三层真相文档冻结（`docs/architecture/three-layer-truth.md`）。
4. P6-D：Manual evidence pack（browser / 微信开发者工具 / 真机端到端：register → login → start session → message with image → permission round-trip → device revoke → reattach 拒绝）。
5. P6-E：Cleanup 残余（dead `deploy-fill` residue / forwardInternalJson @deprecated 删除 / Lane E shim 删除）。

#### Out-of-Scope

1. 任何新功能 / 新 schema / 新 endpoint。
2. SQLite-DO 引入（决议 O8）。

#### 交付物

1. `workers/agent-core/src/host/do/{nano-session-do,session-do-bootstrap,session-do-identity,session-do-ingress,session-do-ws,session-do-verify,session-do-persistence,session-do-orchestration-deps}.ts`。
2. `workers/orchestrator-core/src/user-do.ts` + `workers/orchestrator-core/src/user-do/handlers/*.ts` + `workers/orchestrator-core/src/user-do/infrastructure.ts`。
3. `docs/architecture/three-layer-truth.md`。
4. `docs/evidence/{web,wechat-devtool,real-device}-manual-2026-XX/`（含截屏 / network log / WS frame log）。
5. `docs/issue/real-to-hero/real-to-hero-final-closure.md`。

#### 收口标准

1. NanoSessionDO 主文件 ≤ 400 行；user-do.ts 主文件 ≤ 500 行。
2. agent-core 测试矩阵 1056+ 测试不回归；orchestrator-core 测试不回归。
3. 三层真相文档明确写出 session DO memory / user DO storage / D1 三层 ownership 边界与禁令。
4. Manual evidence 三套（web / 微信开发者工具 / 真机）完整覆盖端到端旅程，含 image 上传 + permission round-trip + device revoke 三个关键场景。
5. closure §4 items 1 / 3 / 5 标注完成。
6. real-to-hero-final-closure.md 写明 full close vs close-with-known-issues 判定。

#### 什么不算完成

1. NanoSessionDO 主文件 ≤ 400 行但拆出文件含 import cycle。
2. user-do.ts 拆分但 cross-handler 共享代码重复。
3. 三层真相文档写但代码中仍有违反（如 hot path 推 KV / R2）。
4. manual evidence 仅覆盖 happy path，不含 image / permission / device revoke。

#### 本 Phase 风险提醒

- 与 RH1-RH5 改动的合并冲突：建议 RH6 启动时所有上游 Phase 已 merge，避免 rebase hell。
- Manual evidence 依赖 owner-action（真机 + 微信开发者工具），如 owner 时间不齐，可拆分为多个 evidence batch 分批归档。

---

## 8. 执行顺序与 Gate

### 8.1 推荐执行顺序

1. **RH0 优先且独占**：基础设施 + 测试矩阵；其他 Phase 不允许在 RH0 完成前并行。
2. **RH1 紧随其后**：Lane F 闭合是后续 onUsageCommit 与 device WS push 的前置。
3. **RH2 与 RH3 可部分并行**：RH3 P3-A device WS push 依赖 RH1 P1-D 同款机制（user-do forwardServerFrameToClient RPC）；其他子项可并行。
4. **RH4 在 RH0 KV+R2 占位完成 + RH1 完成后启动**：Lane E consumer migration 与 file pipeline 联动。
5. **RH5 在 RH2 GET /models endpoint + RH4 R2 file pipeline 完成后启动**：multi-modal 依赖 R2 file pipeline。
6. **RH6 在 RH1-RH5 全部 merge 后启动**：拆分与 evidence 归档是 closure 前置。

### 8.2 推荐 DAG / 依赖关系

```text
RH0（基础设施 + 测试矩阵 + 巨石拆分预备）
├── RH1（Lane F live runtime）
│   ├── RH2（客户端可见性闭环）
│   │   └── RH5（多模型 / 多模态 / reasoning） ← 也依赖 RH4
│   │       └── RH6（巨石拆分 + 三层真相 + evidence）
│   ├── RH3（多租户产品面） ← 可与 RH2 部分并行
│   │   └── RH6
│   └── RH4（filesystem 真实持久化 + Lane E migration）
│       ├── RH5
│       └── RH6
```

### 8.3 Gate 规则

| Gate | 含义 | 必须满足的条件 |
|------|------|----------------|
| Start Gate（进入 RH0） | real-to-hero charter 已发布；上一阶段 partial-close 已 merge；**RH0 design + RH0 action-plan 已发布并通过 review** | charter §0 / §1 全部 stable；本轮 implementer fix 已 merge 到 main；`docs/design/real-to-hero/RH0-bug-fix-and-prep.md` + `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md` 已发布 |
| **Per-Phase Entry Gate（进入 RH{N}, N≥1）** | 对应 Phase 的 design + action-plan 已发布 | `docs/design/real-to-hero/RH{N}-*.md` + `docs/action-plan/real-to-hero/RH{N}-*.md` 必须先于 implementation 发布；上游 Phase 退出条件全满足 |
| Build Gate（进入 RH2/RH3/RH4） | RH0 + RH1 退出条件全满足 | RH0 所有 deliverable 完成；RH1 Lane F 4 链 e2e 全绿 |
| Build Gate（进入 RH5） | RH2 GET /models + RH4 R2 file pipeline 完成 | RH2/RH4 各自 deliverable 与 exit criterion 满足 |
| Closure Gate（进入 RH6 + 阶段闭合） | RH1-RH5 全部 merge | 全部 endpoint-level 测试全绿（per §9.2 用例数）；preview deploy 全绿；4 家 reviewer ZX5-rereview 通过（如需）|

### 8.4 Migration Allocation Rule（per R2 review 冻结）

**纪律**：
1. RH2/RH3 部分并行允许，但**不得修改同一 migration 文件**。
2. 每个 RH{N} 至多新增一个 migration 文件，编号严格递增（不跨 Phase 复用）。
3. 编号分配冻结：
   - RH2 → `008-models.sql`
   - RH3 → `009-team-display-and-api-keys.sql`
   - RH4 → `010-session-files.sql`
   - RH5 → `011-model-capabilities-seed.sql`（仅在需要时；optional）
   - RH6 → 不新增 migration（仅 cleanup）
4. 编号变更必须更新 §1.2 / §6.1 / §7.{N} / §13 + 修订历史。

### 8.5 为什么这样排

RH0 必须独占，因为它是 "把上一阶段残留的基础设施缺口扫干净" 的工作；任何 Phase 在残留缺口未修时同时进行，都会被这些缺口反噬（比如 RH1 在 jwt-shared lockfile 仍坏的情况下做 preview deploy，会暴露 lockfile 而非 Lane F 的真实 bug）。

RH1 紧随 RH0，因为 Lane F 是 zero-to-real partial-close 中最深层的"4 链全断"，并且 RH3 device WS push 与 RH1 onUsageCommit 共享同一 user-do RPC 机制；Lane F 不通，RH3 device gate 也无法 push force-disconnect。

RH2/RH3 部分并行是工程效率考虑：两者无核心代码路径冲突（RH2 在 agent-core context inspector + WS frame；RH3 在 orchestrator-auth + auth gate），可在两个 feature branch 平行推进。

RH4 / RH5 依次是因为 multi-modal model 需要先有 file pipeline 才能用 image input；提前到 RH5 会出现"模型注册了但 client 无法上传 image"的 mismatch。

RH6 放最后是因为巨石拆分若与上游改动并行会产生 rebase hell；evidence 归档则是阶段闭合的天然 finale。

---

## 9. 测试与验证策略

### 9.1 继承的验证层

1. `pnpm test:contracts`（root contracts，31/31 baseline 不回归）。
2. 每 worker 的 unit test（agent-core 1056+ / orchestrator-core 80+ / orchestrator-auth 13+ / bash-core 374+ / context-core 171+ / filesystem-core 294+ baseline 不回归；新增测试以增量计）。
3. orchestrator-auth-contract 跨包 19+ test。
4. cross-e2e 测试矩阵（root e2e 守门 ≥ baseline）。

### 9.2 本阶段新增的验证重点（统一测试用例数纪律）

> R6 review 回应：本表是各 Phase DoD 引用的 single source；各 Phase 收口标准必须显式引用本表条款，而非写"测试全绿"模糊表述。

| 类别 | 验证内容（统一口径） | 目的 |
|------|----------|------|
| **Public endpoint 直达测试** | **每个新增 public endpoint ≥ 5 endpoint-level 用例**（happy / 401 / 400 body / 500 internal / idempotency 或 ETag 至少各 1） | 防 DS R1 needsBody silent-drop 类回归 |
| **Internal RPC contract 测试** | **每个新增 internal RPC method ≥ 3 contract 用例**（happy / authority/caller 拒绝 / payload schema 校验 至少各 1） | 防 DS R5 类 "RPC 方法定义但运行时不可达" |
| **Live runtime path e2e** | **每个 live runtime path ≥ 1 cross-worker e2e + 1 preview smoke**（如 Lane F permission round-trip / onUsageCommit WS push） | 防 "infra landed wiring deferred" 误读 |
| **Multi-tenant 边界校验** | RH4 file pipeline + RH3 device gate：跨 team_uuid 不应能列/读对方资源；至少 2 用例（read 拒绝 / list 拒绝） | 防 R2 切真后多租户 bug |
| **WS NACP frame validation** | RH2 升级后所有 frame 通过 validateSessionFrame 校验；正反例至少各 3 用例 | 防协议漂移 |
| **Multi-model live inference** | RH5：≥4 个不同模型各 1 e2e（granite / llama-4-scout / kimi-k2.6 / gpt-oss-120b 必含），含 image 输入 + reasoning effort 至少各 1 用例 | 防硬编码 default 路径 |
| **Heartbeat / WS lifecycle hardening** | RH2 P2-C 新增子项（per closure §4 item 4）：normal close / abnormal disconnect / heartbeat miss / replay-after-reconnect 各 ≥1 用例 | 防 DO websocket lifecycle drift |

### 9.3 本阶段不变量

1. **6-worker 拓扑不变**（决议 D1）。任何 PR 不得新增 worker。
2. **不引入 SQLite-DO**（决议 D2）。任何 PR 不得在 wrangler.jsonc 引入 `new_sqlite_classes`。
3. **三层真相不互相吸收**（决议 D6）。任何"为了性能把 D1 数据复制到 KV"的 PR 必须在 charter 层报备。
4. **preview deploy 全绿** 是每 Phase 退出条件；不允许 e2e 通过但 deploy 失败。
5. **每个新增 public endpoint 必须满足 §9.2 endpoint-level 测试纪律 + per-phase preview smoke 双保险**。
6. **Lane E dual-track 必须有 owner-decided sunset**（≤ 2 周）；library + RPC 不得永久并存。

### 9.4 证据不足时不允许宣称的内容

1. "Lane F live runtime 闭合" — 必须有 Permission round-trip e2e + onUsageCommit WS push manual smoke 双证据。
2. "Multi-modal 上线" — 必须有 image 真实上传到 R2 + llama-4-scout 真实 vision inference 端到端 evidence。
3. "Device revoke 真正成立" — 必须有 access token 立即失效 + WS force-disconnect 双证据，不允许仅 D1 写入 evidence。
4. "real-to-hero closed" — 必须三道闭环全部 evidence + 4 家 reviewer rereview 通过（或 owner 显式接受 close-with-known-issues）。

### 9.5 三层 evidence 定义（R3 review 回应）

> 上一阶段 zero-to-real 的"manual evidence 不足"被多家 reviewer 标为 partial-close 原因。本阶段把 evidence 拆成三类，避免术语混用导致的口径冲突。

| Evidence 层级 | 谁做 | 何时做 | 内容 | DoD |
|---|---|---|---|---|
| **Tier-A：per-phase preview smoke** | implementer | 每 Phase 退出前 | preview deploy + curl/WS client/script 验证关键路径，不需要 owner 操作或真机 | 关键路径返回正确 facade envelope；无 5xx；preview log 归档至 phase closure |
| **Tier-B：RH0/RH6 owner manual evidence** | owner（implementer 提供脚本） | 仅 RH0 P0-E 部署验证 + RH6 P6-D | browser console + network log + WS frame log，端到端跑 happy + 1 个 edge case | 浏览器 evidence 含截屏 + 网络 trace；归档至 `docs/evidence/web-manual-2026-XX/` |
| **Tier-C：RH6 real-device evidence** | owner | 仅 RH6 P6-D | iOS Safari + Android Chrome + 微信 8.0 真机 + 微信开发者工具最新 stable，全旅程（register → login → start → message-with-image → permission round-trip → device revoke → reattach 拒绝） | 三套真机 + 1 套微信开发者工具 evidence pack 完整归档 |

**纪律**：
- 不允许把 Tier-B / Tier-C 前移到非 RH0/RH6 phase（成本与 owner 时间限制）。
- 不允许把 Tier-A 省略（它是 per-phase exit gate）。
- §4.2 O16 的"out-of-scope"指的是 Tier-B/C 全 phase 化；Tier-A 是 §4.4 硬纪律 #7。

---

## 10. 收口分析（Exit / Non-Exit Discipline）

### 10.1 Primary Exit Criteria（硬闸）

1. **Session 消费闭环成立**：GET /models + GET /sessions/{id}/context + POST /sessions/{id}/messages（含 model_id + image_url + idempotency）+ WS NACP frame upgrade + tool result frame 全部端到端可用。
2. **租户可达闭环成立**：D6 device revoke 进 access/refresh/WS gate；nano_teams.team_name+slug；verifyApiKey 实装；/me/conversations 双源对齐 + cursor pagination；/me/devices GET + revoke 完整。
3. **Live runtime 闭环成立**：Lane F 4 链全通（hook.emit delegate / scheduler hook_emit / Permission+Elicitation round-trip / onUsageCommit WS push）。
4. **Filesystem 真实持久化**：R2 file upload 端到端 + multi-tenant key namespace 隔离 + filesystem-core 业务 RPC + Lane E consumer migration sunset。
5. **多模型上线**：13 + 4 vision + 8 reasoning 真实可用；context window 修正；reasoning effort 贯通。
6. **巨石拆分 + 三层真相冻结**：NanoSessionDO ≤400 行；user-do.ts ≤500 行；`docs/architecture/three-layer-truth.md` 发布。
7. **Manual evidence pack 完整**：web / 微信开发者工具 / 真机三套覆盖 happy + image + permission + device-revoke 关键场景。
8. **测试矩阵不回归** + closure §4 全部 15 项标注完成或显式降级。

### 10.2 Secondary Outcomes（结果加分项，不是硬闸）

1. 4 家 reviewer 对 real-to-hero 的 rereview 通过。
2. 至少 1 个真实 web 或 mini-program 在 production 用 ≥ 7 天无重大 incident。
3. preview deploy → production deploy 自动化通过 ≥ 1 次。

### 10.3 NOT-成功退出识别

以下任一成立，则**不得**宣称本阶段收口：

1. Lane F 四链中任一仍是 stub（如 hook.emit 仍 console.log 而非真实 dispatcher）。
2. /models 返回硬编码 2 模型（未做 D1 nano_models seed）。
3. Device revoke 仅在 refresh path 拒绝，access token 仍可在有效期内使用。
4. R2 binding 启用但 ArtifactStore 仍是 InMemoryMap。
5. NanoSessionDO 主文件 > 800 行（拆分目标 ≤ 400 行的两倍以上）。
6. Manual evidence 缺 image / permission / device-revoke 关键场景中任一项。
7. ZX5 / RH 系列任一 endpoint 缺 endpoint-level 直达测试。
8. Lane E dual-track 无 sunset 时间盒（library + RPC 永久并存）。
9. 引入了第 7 个 worker 或 SQLite-DO（违反决议 D1 / D2）。
10. closure §4 任一 item 在 charter 中有承接但实际未完成且未在 closure 中显式降级。

### 10.4 收口类型判定表

| 收口类型 | 含义 | 使用条件 | 文档要求 |
|----------|------|----------|----------|
| `full close` | §10.1 全部 8 条硬闸满足；§10.3 全部 NOT-条件不成立 | 无 partial / TODO / blocker 残留；4 家 reviewer rereview 通过 | real-to-hero-final-closure.md verdict = `closed` |
| `close-with-known-issues` | §10.1 全部硬闸满足，但 §10.2 secondary outcome 部分未达 OR 个别 polish 项明确降级到下一阶段 | owner 显式接受降级；降级项写入 closure §4 + hero-to-platform charter §0 | closure verdict = `close-with-known-issues`；hero-to-platform charter §1 必须列 inherited known-issues |
| `cannot close` | §10.3 任一 NOT-条件成立 | RH0-RH6 任一 Phase 退出条件未满足；或 4 家 reviewer rereview 出 critical/high blocker | closure verdict = `cannot close`；列 missing items 与 next-step plan |

### 10.5 这一阶段成功退出意味着什么

`nano-agent 第一次拥有可被真实 web / mini-program / CLI 客户端持续使用的产品基线 — 不是 demo，不是 partial — 而是 client 能选择模型、上传 image、看到 tool 执行细节、查 context 状态、做 permission round-trip、管理多设备、用 API key 做 server-to-server 鉴权的端到端可运行系统。下一阶段（hero-to-platform）可以专注于 admin plane / billing / second LLM provider / OAuth federation 这些产品化与 GTM 工作。`

### 10.6 这一阶段成功退出**不意味着什么**

1. `不意味着 nano-agent 已经 production-ready 无 hardening 缺口` — sandbox 隔离 / streaming progress for bash / 真实 prepared artifact pipeline 等仍属下一阶段或 polish backlog。
2. `不意味着 admin plane / billing / 第 2 个 LLM provider / OAuth federation 已就绪` — 全部为 out-of-scope，对应 hero-to-platform。
3. `不意味着 NACP 协议层完美` — 错误信封 / 三层信封统一 / facadeFromRpcEnvelope 等留 protocol-evolution backlog。
4. `不意味着 client SDK 已经稳定` — 仅 web client + wechat-miniprogram first-wave；第三方 CLI SDK 是后续工作。

---

## 11. 下一阶段触发条件

### 11.1 下一阶段（hero-to-platform）会正式纳入 In-Scope 的内容

1. Admin plane（API key list/create/revoke UI / tenant CRUD / membership management / team invite）。
2. Billing / quota policy / cost ledger / per-model quota / usage dashboards。
3. Second LLM provider（DeepSeek / OpenAI Chat / Anthropic 启用）。
4. OAuth federation（Google / GitHub / Apple / Microsoft）。
5. Sandbox 隔离（seatbelt / WorkspaceWrite policy / 危险命令检测）。
6. Catalog 真实 plug-in 注册框架（skill / command / agent dynamic registry）。
7. Real prepared artifact pipeline（image resize / pdf text / audio transcript）。
8. Streaming progress for long-running bash commands。
9. Conversation 标题（LLM 生成）/ archive / delete / FTS 搜索。
10. NACP 协议层重构（error verb 注册 / 三层信封统一 / facadeFromRpcEnvelope）。
11. Logout / token revocation endpoint。
12. SQLite-backed DO（仅 user-do read model；session-do 仍 memory-first）— 仅在 RH6 三层真相冻结后真实需要才做。

### 11.2 下一阶段的开启前提

1. real-to-hero-final-closure.md 已发布；verdict = `full close` 或 `close-with-known-issues`（known issues 已明确降级）。
2. 至少 1 个真实 web / mini-program 在生产 ≥ 7 天无重大 incident。
3. owner 决策启动 hero-to-platform charter（不是自动延续）。
4. 4 家 reviewer 对 real-to-hero 阶段做最终 rereview，无 critical/high blocker。

### 11.3 为什么这些内容不能前移到本阶段

- **Admin plane / billing**：会引入 UI / 权限分级 / 计费策略等正交工作；real-to-hero 已有 6 个 Phase + ~13 周，再加这两块会拖到 6 个月以上。
- **Second LLM provider**：需要 routing-policy 设计（fallback / on-error / per-team default）；Workers AI 13 模型已能覆盖核心需求。
- **OAuth federation / sandbox / catalog plug-in 框架**：每一项都是独立子系统设计；前移会把 charter scope 撑爆。
- **NACP 协议层重构**：当前活跃 RPC 路径走 Envelope<T>，不是运行时 blocker；推迟到协议层有真实多版本兼容需求时再做。
- **SQLite-backed DO**：runtime-session-study 已论证当前 first problem 不是缺 SQL；推迟到 RH6 三层真相冻结后是否真有性能需求再判断。

---

## 12. Owner / Architect 决策区

> 本阶段已显式列出 6 条 owner decisions（D1-D6）作为基石事实。以下是仍需 owner 在 RH 各阶段启动前明确的少量默认答案。

### Q1 — `team_slug 唯一性 / 长度 / charset 策略`

- **为什么必须回答**：RH3 P3-B 注册时自动生成 team_slug，需要确定生成算法（如 `slugify(display_name) + '-' + random6chars` 还是纯 random）+ 唯一性策略（global unique 还是 team_uuid 内 unique）+ 字符集限制（ASCII only 还是含中文 punycode）+ 长度上限（如 ≤ 32 chars）。
- **当前建议 / 默认答案**：`slugify(ASCII-fallback) + '-' + random6chars`；global unique（D1 UNIQUE 约束）；长度 ≤ 32；charset = `[a-z0-9-]`。
- **最晚冻结时点**：**RH2 启动前**（per R2 review：RH2 与 RH3 部分并行；RH2 仅写 008-models.sql，RH3 写 009-team-display-and-api-keys.sql；team_slug 策略影响 009 schema 设计，必须在 RH2 启动前冻结，而非"RH3 启动当天"）。

### Q2 — `Lane E dual-track sunset 时间盒长度`

- **为什么必须回答**：RH4 P4-D 中 library import + RPC consumer 短期并存的 owner-decided sunset 长度，决定 RH 阶段闭合前是否必须删除 library import。
- **当前建议 / 默认答案**：`≤ 2 周`（cross-e2e 稳定 2 周后 prod 切 RPC-first，再 1 个 release 内删除 library import）。
- **最晚冻结时点**：RH4 启动当天。

### Q3 — `manual evidence 真机品牌 / 微信版本范围`

- **为什么必须回答**：RH6 P6-D evidence 归档需要明确覆盖范围（如 iOS Safari 17+ / Android Chrome 最新 / 微信 8.0+），否则 evidence 集合可能被认为不充分。
- **当前建议 / 默认答案**：`iOS 17 Safari + Android 14 Chrome + 微信 8.0 真机各 1 套；微信开发者工具最新 stable 版本 1 套；浏览器 Chrome stable 1 套`。
- **最晚冻结时点**：RH6 启动前 1 周（让 owner 准备真机）。

### Q4 — `per-model quota 是否在 RH5 引入`

- **为什么必须回答**：RH5 P5-A 注册多模型后是否同时引入 per-model 配额（例如 reasoning 模型贵，限制每团队每月 100 次）。
- **当前建议 / 默认答案**：`不引入`（仅在 nano_usage_events 记录 model_id；per-model 配额留 hero-to-platform）。
- **最晚冻结时点**：RH5 启动当天。

### Q5 — `RH0 P0-F owner-action 凭据 checklist 验证执行`

- **为什么必须回答**：替代原 D4 的 `memory:*` 引用（per R4 review）。RH0 P0-F 需要 owner 实际执行验证步骤并签字（"通过/未通过"），否则 charter §1 D4 没有可审计来源。
- **当前建议 / 默认答案**：owner 在 RH0 启动当天执行 `wrangler whoami` / `gh auth status` / `pnpm --filter @haimang/jwt-shared build`（带 NODE_AUTH_TOKEN）/ `wrangler r2 bucket list` / `wrangler kv namespace list` / `wrangler ai models --json | wc -l` 6 步，结果写入 `docs/owner-decisions/real-to-hero-tooling.md`。
- **最晚冻结时点**：**RH0 启动当天**（任一项未通过则 RH0 卡死，不允许跳过）。

---

## 13. 后续文档生产清单

### 13.1 Design 文档

- `docs/design/real-to-hero/RH1-lane-f-live-runtime.md`（hook dispatcher / scheduler hook_emit / waiter activation / WS push 联动）
- `docs/design/real-to-hero/RH2-models-context-inspection.md`（GET /models + GET /context + WS NACP upgrade + tool call streaming）
- `docs/design/real-to-hero/RH3-device-auth-gate-and-api-key.md`（device claim 注入 + verifyApiKey + dual-track auth）
- `docs/design/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md`（R2 binding + filesystem RPC + Lane E migration + multi-tenant namespace）
- `docs/design/real-to-hero/RH5-multi-model-multimodal-reasoning.md`（13+4+8 model registry + per-session model_id + reasoning effort）
- `docs/design/real-to-hero/RH6-do-megafile-decomposition.md`（NanoSessionDO + user-do.ts 拆分 + 三层真相）

### 13.2 Action-Plan 文档

- `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md`
- `docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md`
- `docs/action-plan/real-to-hero/RH2-client-visibility.md`
- `docs/action-plan/real-to-hero/RH3-tenant-product-surface.md`
- `docs/action-plan/real-to-hero/RH4-filesystem-real-persistence.md`
- `docs/action-plan/real-to-hero/RH5-multi-model-multimodal-reasoning.md`
- `docs/action-plan/real-to-hero/RH6-megafile-decomposition-evidence.md`

### 13.3 Closure / Handoff 文档

- 每 Phase 可选 phase-closure（不强制）：`docs/issue/real-to-hero/RH{N}-closure.md`
- 阶段总 closure：`docs/issue/real-to-hero/real-to-hero-final-closure.md`
- 阶段 handoff（如有跨阶段交接）：`docs/issue/real-to-hero/handoff-to-hero-to-platform.md`

### 13.4 执行前置顺序（per R5 review 升级为硬 gate，不再是"建议"）

**纪律**：未发布 RH{N} design + action-plan，不得启动 RH{N} implementation。详见 §8.3 Per-Phase Entry Gate。

1. **RH0 design + RH0 action-plan 必须在 RH0 启动前发布并通过 review**（同时是 §8.3 Start Gate 硬条件）。
2. **RH1 design + action-plan 必须在 RH1 启动前发布**（在 RH0 执行期间产出）。
3. **RH2-RH5 design + action-plan 必须各自在对应 Phase 启动前发布**；可在上游 Phase 执行期间分批产出，但不允许"边写边干"。
4. **RH6 design + 三层真相 doc 必须在 RH6 启动前发布**（在 RH5 执行期间产出）。
5. real-to-hero-final-closure.md 在 RH6 退出条件全部满足后产出。

---

## 14. 最终 Verdict

### 14.1 对本阶段的最终定义

`real-to-hero 是 zero-to-real partial-close 之后的下一个 phase charter；它不重新设计架构，不引入新 worker，不引入 SQLite-DO；它把 zero-to-real 残留的 15 项 deferred 与 4 家 reviewer 共识的 first-wave 客户端可用性需求 + runtime-session-study 推荐的巨石拆分路线，压成一组 7 阶段（RH0-RH6，约 13 周）的并行可执行计划，目标是让真实 web / mini-program / CLI 客户端能持续使用 nano-agent，而不只是端到端能跑的 demo。`

### 14.2 工程价值

- 第一次让 6-worker 拓扑成为真实工作的产品基础设施（而不只是架构示意图）。
- 第一次让 D1 + R2 + KV + DO storage + DO memory 五层存储职责被严格分离与文档化。
- 第一次让 Lane F live runtime（permission / elicitation / usage push）成为可被客户端真实消费的能力。
- 第一次让多模型 / 多模态 / reasoning 在 Workers AI 13 模型上端到端可用。
- 把 NanoSessionDO 从 2078 行巨石变成 ≤ 400 行 facade，为后续可持续维护建立 baseline。

### 14.3 业务价值

- web / mini-program / CLI 客户端从此可以真实集成（而不是 demo wrapper）。
- 多租户安全语义首次完整成立（device revoke / API key / team display）。
- 平台第一次可以用 reasoning 模型（kimi-k2.6 / gpt-oss-120b 等）做高复杂度任务，而不是只能用 granite-4.0-h-micro 默认通用模型。
- 为 hero-to-platform 阶段（admin plane / billing / OAuth / sandbox）提供清晰起跑线。

### 14.4 一句话总结

> `real-to-hero 不是再做一次架构清洁度提升，而是把 zero-to-real 剩下的 last mile 一次跑完 — Session 消费 + 租户可达 + Live runtime 三道闭环全部成立，让 nano-agent 第一次拥有真正可被客户端持续使用的产品基线。`

---

## 15. 维护约定

1. **charter 只更新冻结边界、Phase 定义、退出条件，不回填逐任务执行日志**。每 Phase 的逐任务进展进 action-plan / phase-closure。
2. **执行过程中的具体变更进入 action-plan / closure / handoff**。charter 仅在阶段方向被重写时更新。
3. **若阶段方向被重写，必须在文首修订历史说明：改了什么、为什么改**。所有修订必须保留前一版本的 git history。
4. **若某项由 in-scope 改为 out-of-scope（或反向），必须同步更新 §4、§7、§10、§11**，并在修订历史显式标注。
5. **若采用 `close-with-known-issues`，必须在 closure 文档里复写对应残留问题、影响范围与下游落点**，并在 hero-to-platform charter §1 inherited known-issues 中显式继承。
6. **本 charter §4.4 硬纪律 / §10.3 NOT-成功退出识别 / §10.1 Primary Exit Criteria 任一变更，需 owner 显式批准**，不允许在 PR 中悄悄修改。
