# Nano-Agent 代码审查模板

> 审查对象: `zero-to-real / Z4 / Real Clients and First Real Run`
> 审查时间: `2026-04-25`
> 审查人: `DeepSeek`
> 审查范围:
> - `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md`
> - `docs/design/zero-to-real/Z4-real-clients-and-first-real-run.md`
> - `docs/design/zero-to-real/ZX-qna.md`（Q10 owner 冻结答案）
> - `docs/charter/plan-zero-to-real.md`（root truth 文件）
> - `docs/issue/zero-to-real/Z4-closure.md`
> - `docs/eval/zero-to-real/first-real-run-evidence.md`
> - `clients/web/**`（web client 全部代码）
> - `clients/wechat-miniprogram/**`（Mini Program 全部代码）
> - `workers/agent-core/src/index.ts`（RPC kickoff + internal authority 转发）
> - `workers/agent-core/src/host/internal.ts`（guarded `/internal/*` relay）
> - `workers/agent-core/src/host/internal-policy.ts`（validateInternalRpcMeta + validateInternalAuthority）
> - `workers/agent-core/src/host/do/nano-session-do.ts`（DO-side defense-in-depth + currentTeamUuid 退役 TEAM_UUID fallback）
> - `workers/agent-core/src/host/runtime-mainline.ts`（Workers AI + quota + system prompt）
> - `workers/agent-core/src/host/quota/repository.ts`（synthetic seed owner UUID 分离）
> - `workers/agent-core/src/llm/tool-registry.ts`（tool 声明收敛）
> - `workers/agent-core/src/llm/adapters/workers-ai.ts`（adapter 去硬编码）
> - `workers/agent-core/test/rpc.test.ts`（RPC parity 测试）
> - `workers/agent-core/test/host/do/nano-session-do.test.ts`（DO internal auth 测试）
> - `workers/agent-core/test/llm/gateway.test.ts`（drift guard）
> - `test/cross-e2e/12-real-llm-mainline-smoke.test.mjs`（live LLM mainline smoke）
> - `test/shared/orchestrator-auth.mjs`（live auth helper 修复）
> - `test/shared/live.mjs`（live test 基础设施）
> - `workers/orchestrator-core/migrations/005-usage-events-provider-key.sql`
> - `packages/nacp-session/src/heartbeat.ts`（nano-agent 官方心跳库）
> - `packages/nacp-session/src/replay.ts`（nano-agent 官方 replay cursor 库）
> - `context/ddl-v170/`（smind 祖宗 schema）
> - `context/smind-admin/`（smind 祖宗 auth 实现）
> 文档状态: `changes-requested`

---

## 0. 总结结论

> Z4 的客户端骨架已建立、RPC authority preflight 已修复、Workers AI live evidence 已跑通。但本轮最关键的“Q10 冻结的 heartbeat/replay cursor 真实客户端行为”在两个客户端中完全不存在，"residual HTTP inventory" 完全缺失，"evidence pack per-run" 完全缺失，"IntentDispatcher/Broadcaster" 状态未文档化。Z4 更像"代码骨架建好但核心客户端行为未验证"的状态，而非 design doc 要求的"真实客户端全面进场验证"。

- **整体判断**：`客户端骨架成立，但 Q10 核心行为、F3 证据体系、F5 运输库存三项设计硬约束完全落空；当前不应标记为 closed。`
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. **Q10 heartbeat/replay cursor 在两个客户端中零集成**——不仅是"未测试"，是代码中完全不存在任何 heartbeat/replay/reconnect 逻辑。这是本次审查最严重的缺失。
  2. **Design F3 要求的 per-run evidence pack（`z4-<trace_uuid>.json`）不存在，F5 要求的 residual HTTP inventory 不存在**——两个 design 层面的一级交付物完全缺失。
  3. **Mini Program WeChat login 以 `touristappid` 运行，代码级 `wx.login()` 永远无法拿到真实 code**——"WeChat 全链路已接通" 的声称不成立。

---

## 1. 审查方法与已核实事实

> 这一节只写事实，不写结论。  
> 明确你看了哪些文件、跑了哪些命令、核对了哪些计划项/设计项。

- **对照文档**：
  - `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md`（含 GPT-5.5 工作日志回填）
  - `docs/design/zero-to-real/Z4-real-clients-and-first-real-run.md`
  - `docs/design/zero-to-real/ZX-qna.md`（Q10 owner 冻结答案）
  - `docs/charter/plan-zero-to-real.md`（root truth）
  - `docs/issue/zero-to-real/Z4-closure.md`
  - `docs/eval/zero-to-real/first-real-run-evidence.md`
- **核查实现**：
  - `clients/web/src/client.ts`（121 行，NanoClient transport 封装）
  - `clients/web/src/main.ts`（100 行，web UI + event log）
  - `clients/wechat-miniprogram/pages/index/index.js`（119 行，Mini Program 页面逻辑）
  - `clients/wechat-miniprogram/utils/nano-client.js`（59 行，Mini Program transport 封装）
  - `workers/agent-core/src/index.ts`（246 行，RPC 入口）
  - `workers/agent-core/src/host/internal.ts`（205 行，内部 relay）
  - `workers/agent-core/src/host/internal-policy.ts`（278 行，authority/trace 校验）
  - `workers/agent-core/src/host/do/nano-session-do.ts`（1762 行，DO fetch + validateInternalAuthority + currentTeamUuid）
  - `workers/agent-core/src/host/runtime-mainline.ts`（314 行，Workers AI mainline + system prompt + llm/tool quota）
  - `workers/agent-core/src/host/quota/repository.ts`（328 行，synthetic seed owner UUID 分离验证）
  - `workers/agent-core/src/llm/tool-registry.ts`（33 行，21 个 tool 声明）
  - `workers/agent-core/src/llm/adapters/workers-ai.ts`（271 行，adapter 去硬编码 + 双模型回退）
  - `workers/agent-core/src/kernel/runner.ts`（437 行，beforeLlmInvoke/afterLlmInvoke hooks）
  - `test/cross-e2e/12-real-llm-mainline-smoke.test.mjs`（82 行）
  - `test/shared/orchestrator-auth.mjs`（100 行）
  - `test/shared/live.mjs`（75 行）
  - `packages/nacp-session/src/heartbeat.ts`（56 行，HeartbeatTracker）
  - `packages/nacp-session/src/replay.ts`（129 行，ReplayBuffer）
- **执行过的验证**：
  - `grep -rn "heartbeat\|replay\|cursor" clients/` → **仅在 CSS 中有 `cursor: pointer`，无任何 heartbeat/replay/reconnect 逻辑**
  - `grep -rn "last_seen_seq\|frame_seq\|replayCursor" clients/` → **0 命中**
  - `grep -rn "HeartbeatTracker\|ReplayBuffer\|heartbeat\.ts\|replay\.ts" clients/` → **0 命中**
  - `grep -rn "ping\|pong\|heartbeat" clients/` → **0 命中**
  - `ls docs/eval/zero-to-real/evidence/` → **目录不存在**
  - `grep -rn "residual.*inventory\|internal.*HTTP.*seam\|transport.*inventory" docs/issue/zero-to-real/Z4-closure.md` → **0 命中**
  - `grep -rn "IntentDispatcher\|Broadcaster" docs/issue/zero-to-real/Z4-closure.md` → **0 命中**
  - `grep -rn "appid\|touristappid" clients/wechat-miniprogram/` → `project.config.json` 中 `"appid": "touristappid"`
  - `grep -rn "NANO_AGENT_ALLOW_PREVIEW_TEAM_SEED" workers/agent-core/src/` → repository.ts:27 `allowSeedMissingTeam` 参数化
  - `grep -rn "00000000-0000-4000-8000-000000000001" workers/agent-core/src/host/quota/repository.ts` → 独立 owner UUID 已成立

### 1.1 已确认的正面事实

- RPC kickoff internal authority preflight 已在 agent-core `index.ts:222-226` + `internal.ts:38-51` 完整实现，`x-trace-uuid`、`x-nano-internal-authority`、`x-nano-internal-binding-secret` 三头均为转发链节
- NanoSessionDO `fetch()` 对 `session.internal` 请求已加入 `validateInternalAuthority()` 防护（`nano-session-do.ts:502-511`）
- DO-side positive/negative 测试已存在（`nano-session-do.test.ts:126-147`）——缺失 internal auth 返回 401，合法 internal auth 返回 200
- `currentTeamUuid()` 不再从 deploy `TEAM_UUID` fallback（`nano-session-do.ts:602-607`），runtime tenant truth 来自 session authority latch
- Preview seed owner UUID 已与 team UUID 分离：`repository.ts:30` 定义为 `00000000-0000-4000-8000-000000000001`
- Workers AI tool declarations 已从 adapter 内硬编码移出到 `tool-registry.ts`，gateway.test.ts 已加入与 bash-core minimal registry 的 drift guard
- LLM mainline 已注入 nano-agent system prompt：`runtime-mainline.ts:104-107` + `withNanoAgentSystemPrompt()`
- 真实 Workers AI live smoke 已跑通：`12-real-llm-mainline-smoke.test.mjs` 通过 orchestrator-core public route 发起 session start 并在 D1 确认 `provider_key='workers-ai'` usage event
- 005 migration remote apply 已确认 `provider_key` 列存在
- `clients/web` 与 `clients/wechat-miniprogram` 目录已建立，具备最小 auth/session/stream transport
- `test/shared/orchestrator-auth.mjs` 已修复 live auth flow —— 接受真实注册返回的 `team_uuid`，仅在 auth flow 不可用时才回退本地 JWT secret

### 1.2 已确认的负面事实

- **两个客户端均零集成 `packages/nacp-session/src/heartbeat.ts`**：`clients/web/src/main.ts` 通过 `new WebSocket(url)` 直接连接，无任何 ping/pong、无心跳间隔配置、无服务端心跳消费；`clients/wechat-miniprogram/utils/nano-client.js` 通过 `wx.connectSocket()` 直接连接，同样零心跳逻辑
- **两个客户端均零集成 `packages/nacp-session/src/replay.ts`**：WebSocket 断开后无重连逻辑（`main.ts:92-99` 仅关闭旧 socket、开新 socket，不发送 `last_seen_seq`）；Mini Program 同理（`index.js:97-105` 仅 `.close()` + `connectStream()`，不带任何 cursor）
- **per-run evidence pack 完全不存在**：design doc §7.1 F3 要求 `docs/eval/zero-to-real/evidence/z4-<trace_uuid>.json`，该目录不存在、无任何 evidence JSON 文件
- **residual HTTP inventory 完全不存在**：design doc §7.1 F5 + charter §7.5 要求列出 seam 名称、owner、保留原因、风险、候选退役阶段。closure 与 evidence 文档中均无此 inventory
- **IntentDispatcher / Broadcaster 状态在 Z4 closure 中完全未提及**：design doc §7.1 F4 判定方法第 2 条要求"文档明确说明 IntentDispatcher / Broadcaster 是已实现还是 deferred backlog"，closure 对此默然
- **Mini Program `project.config.json` 中 `appid` 为 `"touristappid"`**：这是一个占位符值，`wx.login()` 以此 appid 调用微信 API 不会返回有效 `code`，WeChat 代码级登录无法实际跑通
- **两个客户端均硬编码 preview URL**：`clients/web/src/main.ts:4` `DEFAULT_BASE_URL` 和 `clients/wechat-miniprogram/pages/index/index.js:5` `baseUrl` 均写死 `https://nano-agent-orchestrator-core-preview.haimang.workers.dev`，无环境变量覆盖机制
- **action-plan P5-01 要求的客户端发现回灌测试未执行**：work log §9.5 显示仅执行了 `typecheck/test/deploy/live-e2e/package-e2e/cross-e2e/client-static-checks`，无新增自动化回归测试
- **design doc §7.1 F3 evidence 模板字段（trace_uuid, client_kind, auth_path, transport_baseline, history_ok, reconnect_ok, runtime_ok, open_gaps[], closure_verdict）在 `first-real-run-evidence.md` 中未被结构化使用**

---

## 2. 审查发现

> 使用稳定编号：`R1 / R2 / R3 ...`  
> 每条 finding 都应包含：严重级别、事实依据、为什么重要、审查判断。  
> 只写真正影响 correctness / security / scope / delivery 的问题，不写样式意见。

### R1. Q10 heartbeat / replay cursor 在两个客户端中完全不存在

- **严重级别**：`critical`
- **类型**：`delivery-gap`
- **事实依据**：
  - `docs/design/zero-to-real/ZX-qna.md` Q10 owner 冻结答案：**"Mini Program 的 first real run 接受 HTTP start/input + WS stream/history 作为 first-wave baseline"**，并要求显式接入 `packages/nacp-session/src/heartbeat.ts`（间隔 ≤25s）与 `replay.ts` cursor
  - `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md` P3-01 明确要求："用真实客户端验证 disconnect/reconnect/heartbeat/replay cursor，复用 packages/nacp-session/src/{heartbeat,replay,messages}.ts 既有资产"
  - `docs/design/zero-to-real/Z4-real-clients-and-first-real-run.md` §7.1 F1 判定方法第 2 条："Z4 closure 附的 evidence pack 中至少有一条 web full-chain 成功 run"；F2 §7.2 要求 "WS 断开后，client 通过 replay cursor 补回最近窗口帧"
  - `clients/web/src/main.ts` 中 `openStream()` 仅创建 `new WebSocket(url)`，无 heartbeat 发送/接收逻辑，无 reconnect 逻辑，无 replay cursor
  - `clients/wechat-miniprogram/utils/nano-client.js` 中 `connectStream()` 仅创建 `wx.connectSocket({ url: wsUrl })`，无 heartbeat 配置，无 reconnect，无 cursor
  - `grep -rn "heartbeat\|replay\|cursor\|last_seen_seq\|frame_seq" clients/` → 仅在 CSS 中有 `cursor: pointer`，无任何协议级心跳/重连代码
  - `packages/nacp-session/src/heartbeat.ts` 的 `HeartbeatTracker`（包含 intervalMs=15s, timeoutMs=45s, shouldSendHeartbeat）和 `packages/nacp-session/src/replay.ts` 的 `ReplayBuffer`（包含 replay streamUuid fromSeq, getLatestSeq, checkpoint/restore）是两个完全就绪的 npm 包，但客户端零消费
- **为什么重要**：
  - 这是 Q10 owner 亲自冻结的 first-wave baseline，不是 optional 项
  - 没有 heartbeat，WeChat Mini Program 会在 idle disconnect（默认数十秒）后静默断开，用户看到"3 分钟无响应后历史消息消失"的灾难体验（Opus Q10 分析中已明确预警）
  - 没有 replay cursor，reconnect 时所有中间帧永久丢失，`packages/nacp-session/src/replay.ts` 的 `fromSeq` 参数永远不被使用
  - 这是 Z4 design doc 中 F1/F2 判定方法的核心条件——没有这个，Z4 不能声称"web full-chain 成功"或"Mini Program 真实可跑 loop"
- **审查判断**：
  - 当前 Z4 的"真实客户端验证"只覆盖了 happy path（开局域网、发一条 input、读一条 timeline、开一次 WS），完全没有覆盖 Q10 明确要求的 reconnect/disconnect/heartbeat 异常路径
  - 这不是"实现不完整"，而是"design 约束被完全忽略"
- **建议修法**：
  1. 在两个客户端的 WS transport 层集成 `packages/nacp-session` 的 `HeartbeatTracker`（服务端主动 ping 或客户端主动 ping，间隔 ≤25s）
  2. 在两个客户端的 WS transport 层加入 reconnect 逻辑：disconnect 后，携带 `last_seen_seq` 重新发起 stream attach，消费 `replay.ts` 的 `fromSeq` 参数
  3. Z4 closure 至少提供一条 reconnect → replay → 不丢帧的 evidence（web + Mini Program 各一条）

### R2. per-run evidence pack 完全缺失

- **严重级别**：`critical`
- **类型**：`delivery-gap`
- **事实依据**：
  - `docs/design/zero-to-real/Z4-real-clients-and-first-real-run.md` §7.1 F3 要求："每次真实 run 产出结构化 evidence pack，字段至少包括：trace_uuid、client_kind、auth_path、transport_baseline、history_ok、reconnect_ok、runtime_ok、open_gaps[]、closure_verdict"
  - 同文档 §7.1 关键术语表定义 `evidence pack` 默认落 `docs/eval/zero-to-real/evidence/z4-<trace_uuid>.json`
  - `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md` P4-01 收口标准："evidence 含环境、步骤、结果、失败与截图/日志摘要"
  - **实际**: `ls docs/eval/zero-to-real/evidence/` → 目录不存在
  - 唯一存在的 evidence 文件是 `first-real-run-evidence.md`（92 行），是一个 narrative summary，不是 per-run 结构化 evidence
- **为什么重要**：
  - Design doc 明确将 per-run evidence pack 作为 F3 的**判定方法**（"每次关键真实 run 都产出...或等价 artifact"）
  - 没有 per-run evidence，Z4 的"真实运行覆盖面"无法被独立复核——closure 声称"已具备 register/login/me..."但这些声称没有对应的 evidence 文件可追溯
  - Opus v2 + charter 都强调 zero-to-real 的证据必须是"可复核的，不是只截图不留步骤/环境"
- **审查判断**：
  - `first-real-run-evidence.md` 是一份总结报告，不是 design 要求的 per-run evidence pack
  - 尤其 `reconnect_ok`、`history_ok`、`open_gaps[]` 这些字段在当前 evidence 中完全不存在——因为根本没跑过 reconnect
- **建议修法**：
  1. 创建 `docs/eval/zero-to-real/evidence/` 目录
  2. 至少产出 2 份 per-run evidence：web 一条、Mini Program 一条，每份按 F3 模板填写完整字段
  3. `first-real-run-evidence.md` 可以作为汇总，但它不能替代 per-run evidence

### R3. Residual HTTP inventory 完全缺失

- **严重级别**：`critical`
- **类型**：`delivery-gap`
- **事实依据**：
  - `docs/design/zero-to-real/Z4-real-clients-and-first-real-run.md` §7.1 F5（Residual Transport Inventory）："列明保留 seam、原因、风险、下一步候选退休顺序，并区分 control-plane 已冻结'只减不增'与 stream-plane 仍在过渡中的残余面"
  - F5 判定方法第 1 条："inventory 至少包含 seam 名称、owner、保留原因、风险、候选退役阶段"
  - F5 判定方法第 2 条："Z4 结束时 internal HTTP seam 数量不高于 Z4 开始时基线"
  - `docs/charter/plan-zero-to-real.md` §7.5 Z4 交付物第 3 项："internal HTTP retirement inventory / remaining-seam memo"
  - **实际**: `grep -rn "residual.*inventory\|internal.*HTTP.*seam\|transport.*inventory" docs/issue/zero-to-real/Z4-closure.md` → 0 命中
  - Z4 closure 第 5 节 Residuals 仅列 4 条客户端产品化事项，没有任何 internal HTTP seam 条目
- **为什么重要**：
  - 这是 design doc §7.1 F5 的独立功能项，与客户端是平行的交付物
  - charter §7.5 将它列为 Z4 交付物第 3 项（排在 closure 和 handoff 之前）
  - 当前系统中确实存在 internal HTTP seam（`/internal/sessions/*` 的 6 个 action、`user-do.ts` 的 `forwardInternalRaw`、agent-core 的 `routeInternal`），这些 seam 的状态、risk、退役时间线必须被诚实记录
- **审查判断**：
  - 不是"做了但没写文档"——是完全没有这份 inventory
  - 这与 design 的"取舍 3"精神直接矛盾：design 说 **"诚实保留 residual HTTP inventory 而不是宣称 transport 已完全清洁"**，但实际产物却是**既没有清洁 transport，也没有诚实 inventory**
- **建议修法**：
  1. 创建 residual HTTP inventory（可在 closure 中新增一节，或独立文档）
  2. 至少列出当前保留的 internal HTTP seam（`/internal/sessions/*` 的各个 action、`user-do` forward 路径等），按"seam 名称 / owner / 保留原因 / 风险 / 候选退役阶段"填写
  3. 区分 control-plane seam（可退役的）与 stream-plane seam（仍需过渡的）

### R4. IntentDispatcher / Broadcaster 状态在 Z4 closure 中完全未提及

- **严重级别**：`high`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/design/zero-to-real/Z4-real-clients-and-first-real-run.md` §7.1 F4 判定方法第 2 条：**"文档明确说明 IntentDispatcher / Broadcaster 是已实现还是 deferred backlog"**
  - F4 描述中定义：`IntentDispatcher = agent.core 内的 user-input routing seam`，`Broadcaster = orchestration.core user DO 内的多端 fanout seam`
  - `grep -rn "IntentDispatcher\|Broadcaster" docs/issue/zero-to-real/Z4-closure.md` → **0 命中**
  - `grep -rn "class IntentDispatcher\|class Broadcaster" workers/ packages/` → **0 命中**（代码中不存在）
  - Z4 closure 第 5 节 Residuals 中 R1-R4 均未提及这两个概念
- **为什么重要**：
  - 这是 design F4 判定方法的**明确文字要求**，不是含蓄期待
  - Opus v2、Opus design review、DeepSeek design review、Kimi design review **四份独立 review 都指出过这个概念悬空问题**（参见 `docs/eval/zero-to-real/Z0-ZX-design-docs-reviewed-by-opus.md` R10+R20、`Z0-ZX-design-docs-reviewed-by-deepseek.md` R14）
  - Z4 是这两个概念的"最终裁决阶段"——如果在 Z4 closure 中仍然不提，它们将进入"无人认领的悬空概念"状态
- **审查判断**：
  - 两个组件在代码中确实不存在，这不违反 design（F4 允许"若不实现则进入 residual backlog"）
  - 但 closure 对它们的完全默然违反了 F4 的明确文档要求
- **建议修法**：
  1. 在 Z4 closure 或 residual inventory 中显式写明：`IntentDispatcher` 为 deferred backlog，`Broadcaster` 为 deferred backlog，并注明下一阶段归入时机
  2. 如果某一方已经以别名或不同形态存在，需要澄清对应关系

### R5. Mini Program WeChat login 以 fake appid 运行，无法真实验证

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - `clients/wechat-miniprogram/project.config.json:3`：`"appid": "touristappid"`
  - 微信小程序 `wx.login()` API 要求 `appid` 必须是微信开放平台注册的真实 AppID，才能返回有效 `code`
  - `clients/wechat-miniprogram/pages/index/index.js:53-71` 的 `wechatLogin()` 方法调用 `wx.login()` → 获取 `res.code` → POST `/auth/wechat`——但 `code` 来自 `touristappid`，微信服务器会拒绝
  - `docs/issue/zero-to-real/Z4-closure.md:16` 声称："WeChat code-level 登录入口已接线"
  - `docs/eval/zero-to-real/first-real-run-evidence.md:52` 声称："已具备 WeChat wx.login() code-level login 入口"
- **为什么重要**：
  - Z4 charter 的核心目标之一是"Mini Program + WeChat 是 owner 明确要求的真实入口"
  - 用 `touristappid` 运行，`wx.login()` 代码虽然写了，但**永远无法拿到真实 code，`/auth/wechat` 端点从未被真实 code 调用过**
  - 这意味着 WeChat 全链路的第一个环节（code → openid → JWT）从未被真实验证——Z4 对 WeChat 路径的"已验证"声称不成立
  - Z4 closure §5 Residuals R2 承认"真实 appid / 微信开发者工具真机截图不在本仓自动化内"，但没承认"当前代码实际上无法完成 code-level 登录"
- **审查判断**：
  - `touristappid` 在微信开发者工具中可以用于基础 UI 调试，但 `wx.login()` 的 code 交换链路无法打通
  - 这不是"没有截图证据"的问题，而是"代码路径无法产生有意义结果"的问题
- **建议修法**：
  1. 如果 owner 有真实 AppID，替换 `touristappid` 并跑一次真实的 WeChat login → start → input → stream → history 全程
  2. 如果暂无真实 AppID，closure 必须诚实声明"Mini Program WeChat code-level 登录路径仅在代码层面接线，尚未以真实 AppID 验证"，不得写"已具备"
  3. `project.config.json` 中的 `appid` 移入环境变量 / `.gitignore` 保护的配置文件

### R6. 客户端硬编码 preview URL，不可移植

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `clients/web/src/main.ts:4`：`const DEFAULT_BASE_URL = "https://nano-agent-orchestrator-core-preview.haimang.workers.dev";`
  - `clients/wechat-miniprogram/pages/index/index.js:5`：`baseUrl: "https://nano-agent-orchestrator-core-preview.haimang.workers.dev"`
  - `clients/wechat-miniprogram/app.js:3`：`baseUrl: "https://nano-agent-orchestrator-core-preview.haimang.workers.dev"`
  - Web client 无环境变量读取机制（Vite 的 `import.meta.env` 未被使用）
  - Mini Program 无 `app.js` globalData 与页面 `baseUrl` 的联动机制（`app.js` 定义了 `globalData.baseUrl` 但 `pages/index/index.js` 有自己独立的硬编码 `data.baseUrl`）
- **为什么重要**：
  - 这意味着客户端只能在 preview 环境下运行，无法切换到 local dev / staging / production
  - `app.js` 中定义的 `globalData` 工程骨架与页面实际 `data` 字段脱节
  - design doc §7.1 F1/F2 要求客户端是"可持续运行的验证面"，不是一次性 smoke
- **审查判断**：
  - Web client 修复简单（Vite 环境变量 `import.meta.env.VITE_ORCHESTRATOR_URL`）
  - Mini Program 修复需要让页面 data 从 `app.globalData` 读取或提供配置入口
- **建议修法**：
  1. Web: 使用 `import.meta.env.VITE_ORCHESTRATOR_URL` 作为 baseUrl，`DEFAULT_BASE_URL` 仅为 fallback
  2. Mini Program: 要么统一从 `getApp().globalData.baseUrl` 读取，要么在 `project.config.json` 中增加自定义配置字段

### R7. Action-plan P5-01 要求的客户端发现回灌回归测试未执行

- **严重级别**：`medium`
- **类型**：`test-gap`
- **事实依据**：
  - `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md` P5-01 工作内容："把关键发现回灌到现有 package-e2e / cross-e2e 或客户端 smoke 文档"
  - P5-01 收口标准："关键 gap 至少有 1 个自动化护栏或 evidence proof"
  - Work log §9.5 显示只执行了现有测试 suite 的 re-run：
    ```
    pnpm --filter @haimang/agent-core-worker typecheck
    pnpm --filter @haimang/agent-core-worker test
    pnpm --filter @haimang/agent-core-worker deploy:preview
    NANO_AGENT_LIVE_E2E=1 node --test test/cross-e2e/12-real-llm-mainline-smoke.test.mjs
    pnpm test:package-e2e
    pnpm test:cross-e2e
    ```
  - 没有新增任何测试文件（除 `12-real-llm-mainline-smoke.test.mjs` 是 P4-01 的 live evidence，不属于 P5-01 的回归护栏）
  - 例如：RPC authority preflight 修复后没有新增 cross-e2e 负例测试来验证"不带 internal secret 的 RPC 调用被拒绝"
- **为什么重要**：
  - Z4 的核心方法是"发现 gap → 修复 → 回灌护栏"——只修不测等于 gap 仍然存在
  - 尤其 RPC authority、TEAM_UUID 退役、synthetic seed owner 分离这些修复是 regression-prone，应该被测试封住
- **审查判断**：
  - 现有 `rpc.test.ts` 和 `nano-session-do.test.ts` 的测试只覆盖了正向路径，缺少：
    - 负例：internal authority 缺失/不匹配 → 拒绝
    - 负例：body authority 与 header authority 不一致 → 拒绝
    - 负例：不带 `session_uuid` 的 RPC 调用 → 400
- **建议修法**：
  1. 在 `rpc.test.ts` 中增加负例测试（缺失 authority、缺失 trace_uuid、缺失 internal secret）
  2. 在 `nano-session-do.test.ts` 中增加 body authority 与 header authority 不匹配的负例测试

### R8. 客户端的错误/quota disclosure 为 raw JSON passthrough，无结构化重试

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md` P3-02 工作内容："校正客户端对 auth/quota/runtime/tool failures 的呈现与重试策略"
  - P3-02 收口标准："runtime failure 不再被吞掉或伪装成功"
  - `clients/web/src/client.ts:112-119` 的 `json()` 方法：非 2xx 响应直接 `throw new Error(body.message)`——不区分 auth 过期 / quota 超出 / runtime 错误 / tool 失败
  - `clients/wechat-miniprogram/utils/nano-client.js:16-18` 同理：`reject(new Error(res.data?.message || ...))`
  - `clients/web/src/main.ts:67-74` 的 `run()` 包装器：所有错误统一打印为 `{ kind: "client.xxx.error", message: "..." }`，无重试、无区分呈现
  - 虽然 P3-02 收口标准是 "runtime failure 不再被吞掉"（这一点基本成立——错误确实被显示了），但缺少"重试策略"
- **为什么重要**：
  - Action-plan P3-02 明确写了"校正重试策略"，不只是"别吞错误"
  - 当前客户端对 `401 Unauthorized`（token 过期）和 `429 Quota Exceeded`（quota 超限）和 `500 Internal Error`（运行时崩溃）使用完全相同的错误处理，用户体验上这没有区别
- **审查判断**：
  - 基础错误可见性成立（达到了"不吞错误"），但缺少"结构化重试"
  - 至少应该区分 `401` → 提示重新登录 vs `QUOTA_EXCEEDED` → 提示配额不足 vs 其他
- **建议修法**：
  1. 客户端对 HTTP status code 做最低限度的区分（401 → re-login、429/QUOTA_EXCEEDED → 告知用户配额不足、5xx → 重试/告知运维）
  2. 这不要求 rich UI，只需在 event log 中展示不同的 kind 前缀（如 `auth.expired` vs `quota.exceeded` vs `runtime.error`）

### R9. Design F3 evidence 模板字段在 `first-real-run-evidence.md` 中未被结构化使用

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/design/zero-to-real/Z4-real-clients-and-first-real-run.md` §7.1 F3 要求每次 evidence 至少包含：`trace_uuid`、`client_kind`、`auth_path`、`transport_baseline`、`history_ok`、`reconnect_ok`、`runtime_ok`、`open_gaps[]`、`closure_verdict`
  - `docs/eval/zero-to-real/first-real-run-evidence.md` 的实际结构是：环境与版本 → 本轮覆盖面 → 执行步骤 → 发现与修复摘要 → Residual inventory → Verdict
  - `client_kind` 字段不存在（未区分 web run vs mini-program run）
  - `reconnect_ok` 字段不存在（因为没跑过 reconnect）
  - `history_ok` 字段不存在
  - `transport_baseline` 字段不存在
- **为什么重要**：
  - Design 特意定义了这些字段，是为了让 evidence 跨 run 可比、跨 reviewer 可复核
  - 当前 evidence 更像一份 "changelog + 验证结果汇总"，不符合 design 的 evidence 语义
- **审查判断**：
  - 需要至少 1-2 份 per-run evidence（参见 R2）按此模板填写
  - `first-real-run-evidence.md` 作为汇总可以保留，但需补充 per-run evidence 的交叉引用
- **建议修法**：
  - 见 R2 修法，每份 per-run evidence 按 F3 模板字段填写

### R10. Mini Program UUID 实现为非标准随机 hex（非 RFC 4122 v4）

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `clients/wechat-miniprogram/utils/nano-client.js:1-7`：使用 `Math.random()` 生成 hex 字符替代 UUID
  - `clients/web/src/main.ts:6-8`：使用 `crypto.randomUUID()`（正确）
  - 对比：agent-core `index.ts:184` 的 `invokeInternalRpc` 使用 `isUuid()` 校验 `trace_uuid`，要求严格 UUID v4 格式
  - Mini Program 的 `uuid()` 生成的 `trace_uuid` 版本字段为随机值，可能不符合 `[1-5]` 版本号约束，甚至可能不符合 `[89ab]` 变体约束
- **为什么重要**：
  - 如果 Mini Program 发出的 `trace_uuid` 不能通过 agent-core `internal-policy.ts:36` 的 `UUID_RE` 校验，internal authority 验证会拒绝请求
  - 这在小程序调用 orchestrator-core public API 时不一定触发（orchestrator-core 对 public 路径的 UUID 校验可能不如 internal 严格），但在后续 RPC 化后一定会出问题
- **审查判断**：
  - 当前 orchestrator-core public API 路径可能不严格校验 UUID 格式（`x-trace-uuid` header 作为 opaque string 传递），所以这个 bug 暂时被掩盖
  - 但它是 technical debt——任何依赖 UUID 格式校验的内部路径都会被触发
- **建议修法**：
  - 替换为符合 RFC 4122 v4 的实现，或使用微信小程序 `wx.getStorage` 下可用的 UUID 库

### R11. Web client `sessionUuid` 在页面生命周期内不刷新

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `clients/web/src/main.ts:14`：`let sessionUuid = uuid();` → 仅在页面初始化时生成一次
  - `main.ts:62-65`：`refreshSessionUuid()` 仅读取 input 框的值，不会生成新 UUID
  - 这意味着用户如果想开始一个新 session，必须手动输入一个新的 UUID
  - Mini Program 端有同样问题：`index.js:9` `sessionUuid: uuid()` 仅在 Page data 初始化时生成一次
- **为什么重要**：
  - 这是 UX 摩擦（与 design 的"验证面保持轻量"不矛盾），但会降低真实使用效率
  - 更重要的是——如果用户用同一个 `sessionUuid` 做第二次 start，会发生什么？NACP session law 是否允许对已存在的 session 重新 start？
- **审查判断**：
  - 低优先级，不是 blocker
- **建议修法**：
  - 增加 "New Session" 按钮，生成新 UUID 并刷新界面

### R12. `first-real-run-evidence.md` 声称与事实不符

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `first-real-run-evidence.md:31-33`："已具备 email/password register/login、WeChat wx.login() code-level login 入口、session start/input、WS stream attach、timeline readback"
  - 但是：
    - WeChat login 以 `touristappid` 运行，`wx.login()` 无法返回有效 code（参见 R5）
    - WS stream attach 缺少 heartbeat，在 WeChat 真实环境下会在数十秒后 idle disconnect
    - 没有 reconnect 测试
  - "已具备"这个措辞过度乐观，实际是"代码已接线但完整行为未验证"
- **为什么重要**：
  - Evidence 文档是日后 Z5 closure / handoff 的输入——如果 evidence 过度声称，Z5 会在错误前提上做决策
- **审查判断**：
  - 用词精度问题——不是 code bug，但影响后续阶段的决策质量
- **建议修法**：
  - 将 "@wechat-miniprogram WeChat Login" 改为 "`已接线（appid 为 touristappid，code 链路待真实验证）`"
  - 将 "WS stream attach" 补充说明 "`（heartbeat/reconnect 未在客户端侧集成）`"

---

## 3. In-Scope 逐项对齐审核

> 如果存在 action-plan / design doc，就必须有这一节。  
> 结论统一使用：`done | partial | missing | out-of-scope-by-design`。

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | **P1-01** web client scaffold | `done` | `clients/web/` 已建立，`Vite + Vanilla TypeScript`，具备 auth/session/runtime 的最小 UI |
| S2 | **P1-02** web auth/session integration | `partial` | 基础 register/login/start/input/stream/timeline 已接通，但缺少 Q10 要求的 heartbeat/replay/reconnect（参见 R1） |
| S3 | **P2-01** mini-program scaffold | `done` | `clients/wechat-miniprogram/` 已建立，微信原生小程序工程结构完整 |
| S4 | **P2-02** wechat auth/session integration | `partial` | email/password 路径已接线；WeChat `wx.login()` 代码存在但以 `touristappid` 运行，无法实际拿到有效 code（参见 R5） |
| S5 | **P3-01** replay/heartbeat gap fixes | `missing` | 两个客户端中完全零 heartbeat/replay/reconnect 集成（参见 R1）——这是本轮最严重的缺失 |
| S6 | **P3-02** error/quota disclosure hardening | `partial` | 错误不再被吞掉（P3-02 收口标准满足），但缺少结构化重试策略（参见 R8） |
| S7 | **P4-01** first real run evidence | `partial` | live LLM mainline smoke 已跑通（D1 usage event evidence 成立），但 per-run evidence pack 完全缺失（参见 R2），design F3 模板字段未使用（参见 R9） |
| S8 | **P4-02** residual inventory | `partial` | `first-real-run-evidence.md` §5 有 4 条 residual items，但全部是客户端产品化事项，缺少 IntentDispatcher/Broadcaster 状态声明（R4）、residual HTTP inventory（R3）、heartbeat/replay gap |
| S9 | **P5-01** client smoke/regression | `missing` | 没有新增自动化回归测试（参见 R7），只有现有 test suite 的 re-run |
| S10 | **P5-02** Z4 closure | `partial` | closure 文档存在，但缺少 Q10 heartbeat/replay 的诚实评估、缺少 IntentDispatcher/Broadcaster 状态声明、缺少 residual HTTP inventory、缺少 per-run evidence 交叉引用 |

### 3.1 对齐结论

- **done**: `1`（P1-01 scaffold）
- **partial**: `6`（P1-02, P2-02, P3-02, P4-01, P4-02, P5-02）
- **missing**: `3`（P3-01 heartbeat/replay, P5-01 regression, R2 的 per-run evidence）
- **out-of-scope-by-design**: `0`

> 这更像"代码骨架完成，preflight 修复到位，但核心客户端行为验证（Q10 heartbeat/replay）完全没有开始"的状态。Z4 不是一个"可以关闭、等下一阶段再做遗留项"的阶段——因为 Q10 是本阶段的基本要求，不是 optional enhancement。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 完整产品化 UI/设计系统 | `遵守` | 客户端保持最小可用界面，没有引入产品级 UI 膨胀 |
| O2 | 多端同步、离线缓存、复杂消息渲染组件库 | `遵守` | 无相关实现 |
| O3 | 完整运营后台 / 计费中心 / 管理台 | `遵守` | 无相关实现 |
| O4 | 客户端 SDK 产品化发布 | `遵守` | 客户端仅作为验证面存在 |

> 所有 out-of-scope 项均被遵守。Z4 在 scope 边界上保持克制。

---

## 5. 跨阶段深度分析

> 以下分析基于 Z0-Z4 全部代码、文档、closure 与多轮 review，对 zero-to-real 全阶段进行拓扑性回顾，检查存在盲点、断点、命名规范和执行逻辑错误。

### 5.1 Q10 heartbeat/replay 的持续缺失——Z2→Z4 的行为断层

**事实链**：
- Z2 阶段建立了 replay buffer（`packages/nacp-session/src/replay.ts`）、heartbeat tracker（`packages/nacp-session/src/heartbeat.ts`）、frame 序号（`frame.ts`）——这些是 Z2 design 的 hot-state 最低集合的一部分
- Z2 的 NanoSessionDO 中确实使用了 `ReplayBuffer`（`getWsHelper().replay.replay(this.streamUuid, 0)`），heartbeat 也在 server 侧存在 tracker
- Q10 owner 冻结明确要求 Z4 客户端消费这两个 npm 包
- Z4 action-plan P3-01 明确写了"复用 packages/nacp-session/src/{heartbeat,replay,messages}.ts 既有资产"
- **Z4 实际：两个客户端零消费**

**影响**：Z2 的 heartbeat/replay 是"服务器端做好了，等客户端来接"。Z4 说"客户端来接了"，但实际上只接了 happy path 的 HTTP + WS。Z2→Z4 的协议桥在客户端侧是断的。

**横切判断**：这不是 Z4 单独的问题——Z2 closure 声称"reconnect 后 timeline 不丢"满足了收口标准，但其实这个"满足"在 Z2 review 的 R6 中就是未测试的（Q6 "清空 DO storage 后从 D1 恢复 last 50 frames" 的 invariant 测试当时就缺失）。Z4 本应是这个 invariant 的真实客户端证明，现在 Z4 也没做到。

### 5.2 Z4 mid hard deadlines 的正面收敛——Z3→Z4 的跨阶段修复

Z4 的工作日志中记录了 4 个 hard deadline 修复，它们实际上是对 Z3 review 发现的直接回应：

1. **退役 TEAM_UUID fallback**：Z3 review（DeepSeek）R2 指出 `env.TEAM_UUID` 作为 runtime tenant fallback 是隐患。Z4 在 `nano-session-do.ts:602-607` 中移除了 fallback，`currentTeamUuid()` 现在只从 session authority latch 读取。

2. **Preview seed owner UUID 分离**：Z3 review R3 指出 `D1QuotaRepository.ensureTeamSeed()` 用 `user_uuid == team_uuid` 绕过 auth。Z4 在 `repository.ts:30` 中引入独立 `PREVIEW_SEED_OWNER_USER_UUID = "00000000-0000-4000-8000-000000000001"`。

3. **Workers AI tool registry 收敛**：Z3 review R5 指出 toolset 硬编码在 adapter 内。Z4 创建了 `tool-registry.ts` 并加入 drift guard。

4. **System prompt 注入**：Z4 新增 `NANO_AGENT_SYSTEM_PROMPT`，解决了 LLM 在 Workers 环境下误以为自己是 Linux VM 的问题。

这四项修复体现了 Z4 的正面价值：它不仅做了客户端，还把 Z3 遗留的架构积债做了实质性收敛。

### 5.3 Residual HTTP inventory 的空缺——跨 Z0→Z4 的设计一致性断点

Charter §1.7 明确写道：

> "internal HTTP 全面退役完成不是本阶段硬 gate...但其范围必须被显式收窄，而不能继续无限扩张。"

这是一个贯穿 Z0→Z4 的治理原则。Design Z4 §7.1 F5 将这个原则具体化为 "Residual Transport Inventory"。但回顾全部阶段 closure：

- Z0 closure：无 transport inventory 内容
- Z1 closure：无 transport inventory 内容
- Z2 closure：无 transport inventory 内容（虽然 Z2 是新增 `/internal/sessions/*` 的关键阶段）
- Z3 closure：无 transport inventory 内容
- Z4 closure：无 transport inventory 内容

**判断**：Transport inventory 是一个承诺了 5 个阶段的跨阶段交付物（从 Z0 charter 就开始提），但至今零内容。更关键的是——当前系统中 internal HTTP seam 的数量在 Z2 阶段显著增加（加了 `/internal/sessions/` 下 7 个 action），然后 Z2-Z3-Z4 一路没有盘点。Charter §7.5 承诺 "Z4 结束时 internal HTTP seam 数量不高于 Z4 开始时基线"——但这个基线从未被量化过，所以"不高于"是无从验证的。

### 5.4 Action-plan 工作日志与代码的"声称-事实"对齐

GPT-5.5 在工作日志 §9.7 声称：

> "web 与 mini-program 客户端目录已建立，并拥有最小真实 auth/session/runtime transport。"

这个声称与代码事实之间的差距：

| 声称 | 代码事实 | 差距 |
|------|----------|------|
| "拥有最小真实 auth" | web: register/login/me 已接线；mini-program: email 路径已接线，WeChat 路径 appid 为 touristappid | WeChat 路径未真实验证 |
| "session transport" | start/input/timeline HTTP 路径存在 | 修复 |
| "runtime transport" | WS stream attach 存在 | 缺少 heartbeat + reconnect |
| "最小真实" | 硬编码 preview URL，无法切换环境 | 不可移植 |

### 5.5 命名规范跨阶段一致性

延续 Z0-Z3 审查已发现的问题：

- **`orchestration.core` vs `orchestrator-core`**：charter/docs 使用 `orchestration.core`，代码目录使用 `orchestrator-core`。Z4 客户端硬编码的 URL 使用的是 `orchestrator-core`（代码侧命名），docs 继续使用 `orchestration.core`。不一致延续。
- **`agent.core` vs `agent-core`**：同上。
- Z4 中无新增命名不一致。

### 5.6 Z0→Z4 阶段间未闭合的遗留问题链

以下问题从早期 review 中提出，到 Z4 仍未解决：

| 来源 | 问题编号 | 描述 | Z4 状态 |
|------|----------|------|---------|
| Z2 review (DeepSeek) | R3 | RPC 内部仍走 fetch-backed DO routing | 未改变——`invokeInternalRpc` 仍是 `stub.fetch()` |
| Z2 review (DeepSeek) | R6 | Q6 "清空 DO storage 后从 D1 恢复 last 50 frames" invariant 测试缺失 | 仍然缺失 |
| Z2 review (DeepSeek) | R8 | forwardStatus 无 parity 检查 | 未改变 |
| Z2 review (DeepSeek) | R13+R14 | alarm checkpoint / cache eviction 未实现 | 仍然未实现 |
| Z3 review (DeepSeek) | R2 | quota exhausted/recover 测试缺失 | 仍然缺失 |
| Z3 review (DeepSeek) | R6 | 无 AI binding → silent fallback to stub kernel | 未改变 |

**判断**：Z4 的优先序是正确的——先让真实客户端进场、先修 preflight blocking bugs。但 6 条已知 issue 在 Z4 closure 中被集体沉默，没有在任何 residual inventory 中映射为 deferred。

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested`

  Z4 的客户端代码骨架已建立，Z4-mid hard deadline 的 4 项 backend 修复体现实质价值。但本轮审查揭示的结构性缺失——Q10 核心行为零集成、per-run evidence 零交付、residual HTTP inventory 零交付——使 Z4 离 design doc 和 charter 的收口标准还有实质距离。

- **是否允许关闭本轮 review**：`no`

- **关闭前必须完成的 blocker**：
  1. **Q10 heartbeat/replay 客户端集成**：在两个客户端中集成 `packages/nacp-session` 的 heartbeat（≤25s，server-initiated 或 client-initiated）和 replay cursor（reconnect 时上报 `last_seen_seq`），并提供至少 1 条 reconnect → replay → 不丢帧的 evidence
  2. **Per-run evidence pack 创建**：创建 `docs/eval/zero-to-real/evidence/` 目录，至少 2 份 per-run evidence（web + Mini Program 各一），按 design F3 模板字段填写（trace_uuid、client_kind、auth_path、transport_baseline、history_ok、reconnect_ok、runtime_ok、open_gaps[]、closure_verdict）
  3. **Residual HTTP inventory 创建**：产出至少包含 seam 名称、owner、保留原因、风险、候选退役阶段的 inventory，区分 control-plane 可退役项与 stream-plane 过渡项
  4. **Mini Program WeChat login 真实验证或诚实声明**：要么替换真实 appid 并跑通 WeChat 全链路，要么在 closure 中诚实声明"`wx.login()` 代码已接线，但 appid 为 touristappid，code-level 交换链路尚未验证"

- **可以后续跟进的 non-blocking follow-up**：
  1. **IntentDispatcher/Broadcaster 状态文档化**：在 closure 或 backlog 中显式声明为 deferred，并注明预计归入阶段
  2. **P5-01 回归测试回灌**：为 RPC authority preflight + TEAM_UUID 退役 + seed owner 分离增加负例回归测试
  3. **客户端错误重试策略结构化**：区分 401 / QUOTA_EXCEEDED / 5xx 的错误处理
  4. **客户端 URL 可配置化**：通过环境变量而非硬编码
  5. **Mini Program UUID 标准化**：替换为 RFC 4122 v4 实现
  6. **Z0→Z4 遗留问题链映射**：将 6 条已知 issue（RPC fetch-backend、DO rebuild test、forwardStatus parity、alarm checkpoint、quota test、AI binding silent fallback）在 residual inventory 中显式映射为 deferred

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。
