# Z4 — Real Clients and First Real Run

> 服务业务簇: `zero-to-real / Z4 / real-clients-and-first-real-run`
> 计划对象: `创建 web + wechat-miniprogram 客户端，并完成第一次真实 agent loop 实验与 gap 回填`
> 类型: `new`
> 作者: `GPT-5.4`
> 时间: `2026-04-25`
> 文件位置: `docs/action-plan/zero-to-real/Z4-real-clients-and-first-real-run.md`
> 关联设计 / 调研文档:
> - `docs/charter/plan-zero-to-real.md`
> - `docs/design/zero-to-real/Z4-real-clients-and-first-real-run.md`
> - `docs/design/zero-to-real/ZX-qna.md`
> - `docs/design/zero-to-real/ZX-binding-boundary-and-rpc-rollout.md`
> - `docs/design/zero-to-real/Z1-full-auth-and-tenant-foundation.md`
> - `docs/design/zero-to-real/Z2-session-truth-and-audit-baseline.md`
> - `docs/design/zero-to-real/Z3-real-runtime-and-quota.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

到 Z3 为止，系统理论上已经拥有真实 auth、session truth、runtime 与 quota，但这些能力仍主要由 worker/package tests 证明。zero-to-real 的阶段意义要求我们再往前走一步：让真实客户端接入，让真实用户动作触发真实 agent loop，然后用这些真实交互暴露剩余 gap，而不是继续靠 in-repo harness 推断“应该已经可用”。

因此 Z4 的中心任务不是“做一个漂亮前端”，而是创建 **最小但真实的 `clients/web` 与 `clients/wechat-miniprogram`**，并完成第一轮真实运行：登录、建 session、发起 input、接收 WS stream/history、验证 heartbeat/replay、观察 quota 与 error path，再把发现的 gap 做成修复回合与 residual inventory。

- **服务业务簇**：`zero-to-real / Z4`
- **计划对象**：`Real Clients and First Real Run`
- **本次计划解决的问题**：
  - 仓库当前完全没有 `clients/` 目录
  - 现有 proof 仍主要来自 package-e2e / cross-e2e，不是 end-user client reality
  - web 与 Mini Program 的 transport/auth/session 细节还没有在真实 UI/UX 场景里被压测
  - 第一轮真实执行后的 gap triage 资产还不存在
- **本次计划的直接产出**：
  - `clients/web/**`
  - `clients/wechat-miniprogram/**`
  - 第一轮真实运行 evidence pack
  - `docs/issue/zero-to-real/Z4-closure.md`

---

## 1. 执行综述

### 1.1 总体执行方式

采用 **先做 web、再做 Mini Program、再做 replay/heartbeat/stateful gap 修补、最后做 real-run evidence 与 residual inventory** 的方式推进。Q10 已冻结：first-wave baseline 是 `HTTP start/input + WS stream/history + heartbeat + replay cursor`，并且执行顺序应先 `clients/web` 再 `clients/wechat-miniprogram`。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Web Client Baseline | `M` | 建立 `clients/web` 并接 auth/session/runtime baseline | `Z3 closed` |
| Phase 2 | Mini Program Baseline | `M` | 建立 `clients/wechat-miniprogram` 并接 WeChat auth 与 session baseline | `Phase 1` |
| Phase 3 | Replay / Heartbeat / Stateful Gap Fix | `L` | 用真实客户端压出 stream/history/reconnect/gap 并修正 | `Phase 2` |
| Phase 4 | First Real Run Evidence | `M` | 完成端到端真实 loop 演练，并沉淀 evidence/residual inventory | `Phase 3` |
| Phase 5 | Z4 Closure | `S` | 写 closure，明确哪些已真实跑通、哪些 gap 留给 Z5/下一阶段 | `Phase 4` |

### 1.3 Phase 说明

1. **Phase 1 — Web Client Baseline**
   - **核心目标**：先用 web 接通 email/password + session/runtime 主链。
   - **为什么先做**：Web 的调试面与可观测性更好，适合先暴露 gap。
2. **Phase 2 — Mini Program Baseline**
   - **核心目标**：把 WeChat 登录与移动端 session usage 变成真实事实。
   - **为什么放在这里**：建立在 Z1 WeChat bridge 与 web 验证之后更稳。
3. **Phase 3 — Replay / Heartbeat / Stateful Gap Fix**
   - **核心目标**：让 Q10 里的 heartbeat/replay cursor 从设计约束升级成真实客户端行为。
   - **为什么放在这里**：只有两个真实客户端都接入后，gap 才能被系统性暴露。
4. **Phase 4 — First Real Run Evidence**
   - **核心目标**：做第一次 end-to-end 真实 agent loop 演练并存证。
   - **为什么放在这里**：gap 先收一轮，再输出 evidence，含金量更高。
5. **Phase 5 — Z4 Closure**
   - **核心目标**：把真实运行的结论、残留问题、下一阶段入口文档化。
   - **为什么放在最后**：closure 需要基于真实演练，而不是预设判断。

### 1.4 执行策略说明

- **执行顺序原则**：`先 web，再 mini-program，再 stateful gap，再 real-run evidence`
- **客户端栈基线**：`clients/web` 默认使用 `Vite + Vanilla TypeScript`；`clients/wechat-miniprogram` 默认使用微信原生小程序工程
- **风险控制原则**：`客户端只做最小产品面，不在 Z4 膨胀为完整前端平台`
- **测试推进原则**：`保留 package-e2e / cross-e2e 作为回归护栏，同时新增客户端 smoke/evidence，不另造过重 runner`
- **文档同步原则**：`Q10、Z1/Z2/Z3 closure、residual inventory 同步维护`

### 1.5 本次 action-plan 影响目录树

```text
Z4 Real Clients and First Real Run
├── clients/
│   ├── web/                              [new]
│   └── wechat-miniprogram/              [new]
├── test/
│   ├── package-e2e/orchestrator-core/
│   ├── cross-e2e/
│   └── shared/live.mjs
├── docs/
│   ├── eval/zero-to-real/
│   │   └── first-real-run-evidence.md   [new]
│   └── issue/zero-to-real/
│       └── Z4-closure.md                [new]
└── workers/
    ├── orchestrator-core/
    ├── orchestration-auth/
    └── agent-core/
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 新建 `clients/web/`，完成 register/login/session start/input/stream/history baseline
- **[S2]** 新建 `clients/wechat-miniprogram/`，完成 WeChat auth 与 session baseline
- **[S3]** 用真实客户端验证 heartbeat、replay cursor、history readback、quota/error disclosure
- **[S4]** 做第一次 end-to-end 真实运行并沉淀 evidence / residual inventory

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 完整产品化 UI/设计系统
- **[O2]** 多端同步、离线缓存、复杂消息渲染组件库
- **[O3]** 完整运营后台 / 计费中心 / 管理台
- **[O4]** 客户端 SDK 产品化发布

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `clients/web` | `in-scope` | Q10 已冻结先做 web baseline | `Z4 执行期` |
| `clients/wechat-miniprogram` | `in-scope` | Q10 已冻结 first-wave mini-program baseline | `Z4 执行期` |
| WS-only client transport | `out-of-scope` | Q10 已冻结仍以 HTTP `start/input` + WS `stream/history` 为 baseline | `后续 transport 收敛阶段` |
| 完整产品 polish | `out-of-scope` | Z4 的目标是 real-run 验证，不是产品包装 | `下一阶段` |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | web client scaffold | `add` | `clients/web/**` | 建最小 web 真实入口 | `medium` |
| P1-02 | Phase 1 | web auth/session integration | `update` | `clients/web/**` `workers/orchestrator-core/**` | 接通 email/password + session loop | `high` |
| P2-01 | Phase 2 | mini-program scaffold | `add` | `clients/wechat-miniprogram/**` | 建最小微信小程序真实入口 | `medium` |
| P2-02 | Phase 2 | wechat auth/session integration | `update` | `clients/wechat-miniprogram/**` `workers/orchestration-auth/**` | 接通 WeChat code-level 登录与 session loop | `high` |
| P3-01 | Phase 3 | replay/heartbeat gap fixes | `update` | `clients/**` `workers/orchestrator-core/**` `workers/agent-core/**` | 用真实客户端压出并修补 stateful gaps | `high` |
| P3-02 | Phase 3 | error/quota disclosure hardening | `update` | `clients/**` `workers/agent-core/**` | 让 runtime failures 对客户端诚实可见 | `medium` |
| P4-01 | Phase 4 | first real run evidence | `add` | `docs/eval/zero-to-real/first-real-run-evidence.md` | 固定第一次真实 loop 证据 | `medium` |
| P4-02 | Phase 4 | residual inventory | `update` | `docs/eval/zero-to-real/first-real-run-evidence.md` | 形成 gap 分类和剩余清单 | `medium` |
| P5-01 | Phase 5 | client smoke/regression | `update` | `test/package-e2e/**` `test/cross-e2e/**` | 把关键客户端发现转成回归护栏 | `medium` |
| P5-02 | Phase 5 | Z4 closure | `add` | `docs/issue/zero-to-real/Z4-closure.md` | 形成 Z4 真机/真实运行结论 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Web Client Baseline

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | web client scaffold | 新建 `clients/web/`，按 `Vite + Vanilla TypeScript` 搭最小 auth/session/runtime screens 与 transport helpers | `clients/web/**` | web 成为真实实验入口 | client smoke / build | `clients/web` 可本地/preview 运行 |
| P1-02 | web auth/session integration | 接通 register/login/refresh/me、`start/input`、WS `stream/history` | `clients/web/**` `workers/orchestrator-core/**` | web 可真实发起 agent session | manual smoke / e2e notes | web 可跑一轮真实 session |

### 4.2 Phase 2 — Mini Program Baseline

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | mini-program scaffold | 新建 `clients/wechat-miniprogram/`，按微信原生工程搭最小页面、store、transport layer | `clients/wechat-miniprogram/**` | 小程序成为真实实验入口 | developer-tools smoke | 目录可运行、页面可加载 |
| P2-02 | wechat auth/session integration | 接 WeChat 登录、HTTP `start/input(session_uuid required)`、WS `stream/history`、session list/readback | `clients/wechat-miniprogram/**` `workers/orchestration-auth/**` | 小程序可真实进入 agent loop | developer-tools smoke / manual evidence | code-level 登录与 session 基线可跑通 |

### 4.3 Phase 3 — Replay / Heartbeat / Stateful Gap Fix

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | replay/heartbeat gap fixes | 用真实客户端验证 disconnect/reconnect/heartbeat/replay cursor，复用 `packages/nacp-session/src/{heartbeat,replay,messages}.ts` 既有资产修复 stateful gaps，并以 server-initiated heartbeat 作为 first-wave 默认 | `clients/**` `workers/orchestrator-core/**` `workers/agent-core/**` `packages/nacp-session/src/heartbeat.ts` `packages/nacp-session/src/replay.ts` `packages/nacp-session/src/messages.ts` | Q10 baseline 成为真实行为 | manual smoke / regression tests | reconnect 后 stream/history 不错位，heartbeat 不虚设，HTTP follow-up input 始终显式带 `session_uuid` |
| P3-02 | error/quota disclosure hardening | 校正客户端对 auth/quota/runtime/tool failures 的呈现与重试策略 | `clients/**` `workers/agent-core/**` | 真实错误对终端用户可见且可理解 | manual smoke / regression notes | runtime failure 不再被吞掉或伪装成功 |

### 4.4 Phase 4 — First Real Run Evidence

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | first real run evidence | 完成一轮真实用户身份 + 真实 prompt + 真实 tool/runtime 的演练并记录证据；模板至少含环境、commit SHA、worker version、账户、步骤、观察到的 `trace_uuid/session_uuid`、失败与修复摘要 | `docs/eval/zero-to-real/first-real-run-evidence.md` | Z4 拥有真实实验资产 | manual evidence pack | evidence 含环境、步骤、结果、失败与截图/日志摘要 |
| P4-02 | residual inventory | 将发现的问题按 `[blocker] / [follow-up] / [wont-fix-z4]` 分类，并再映射为 fixed / deferred / next-phase required | 同上 | 后续阶段拥有清晰 gap list | doc review | residuals 有优先级、标签与 owner 建议 |

### 4.5 Phase 5 — Z4 Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | client smoke/regression | 把关键发现回灌到现有 package-e2e / cross-e2e 或客户端 smoke 文档 | `test/package-e2e/**` `test/cross-e2e/**` | 客户端发现有回归护栏 | `pnpm test:package-e2e` / `pnpm test:cross-e2e` | 关键 gap 至少有 1 个自动化护栏或 evidence proof |
| P5-02 | Z4 closure | 写 `Z4-closure.md`，声明真实运行覆盖面、残留问题、进入 Z5 的前提 | `docs/issue/zero-to-real/Z4-closure.md` | Z4 正式收口 | 文档 review | closure 能直接被 Z5 消费 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Web Client Baseline

- **Phase 目标**：用最可观测的方式把真实 auth/session/runtime 暴露给终端用户
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 新增文件**：
  - `clients/web/**`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/**`
  - `workers/orchestration-auth/**`
- **具体功能预期**：
  1. web 具备 login/session start/stream history 最小闭环。
  2. 终端用户能直观看到 runtime 输出与错误。
  3. `Vite + Vanilla TypeScript` 成为 web first-wave baseline，而不是在实施期再争框架。
  4. web 成为第一批 gap 发现器。
- **具体测试安排**：
  - **单测**：`客户端内部状态/transport helpers`
  - **集成测试**：`manual web smoke`
  - **回归测试**：`现有 orchestrator-core / auth tests`
  - **手动验证**：`真实登录并启动一次 session`
- **收口标准**：
  - `clients/web` 可运行
  - 可完成 auth + session start/input/stream/history
  - 能看到 runtime success/failure
- **本 Phase 风险提醒**：
  - 最容易为 UI 让步，忽略 transport/debug visibility

### 5.2 Phase 2 — Mini Program Baseline

- **Phase 目标**：把 WeChat 登录和移动端 session 变成真实使用路径
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 新增文件**：
  - `clients/wechat-miniprogram/**`
- **本 Phase 修改文件**：
  - `workers/orchestration-auth/**`
  - `workers/orchestrator-core/**`
- **具体功能预期**：
  1. 小程序可完成 code-level 登录。
  2. 小程序可完成 HTTP `start/input(session_uuid required)` + WS `stream/history`。
  3. 微信原生工程成为 mini-program first-wave baseline，而不是在实施期再争框架。
  4. 移动端 transport 暴露出与 web 不同的边缘问题。
- **具体测试安排**：
  - **单测**：`客户端 store/helpers`
  - **集成测试**：`developer tools smoke`
  - **回归测试**：`Z1/Z2/Z3 相关 tests`
  - **手动验证**：`一次真实小程序登录与会话`
- **收口标准**：
  - WeChat 登录成功
  - 可进入 session 并收到 stream/history
  - 错误可见、不 silent fail
- **本 Phase 风险提醒**：
  - 最容易把小程序做成“只会登录，不会真实跑 loop”

### 5.3 Phase 3 — Replay / Heartbeat / Stateful Gap Fix

- **Phase 目标**：把最难的 stateful transport 问题通过真实客户端暴露并修补
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `clients/web/**`
  - `clients/wechat-miniprogram/**`
  - `workers/orchestrator-core/**`
  - `workers/agent-core/**`
- **具体功能预期**：
  1. heartbeat 不再只是协议存在，而是客户端行为存在。
  2. replay cursor、history readback、reconnect 顺序稳定。
  3. `packages/nacp-session/src/heartbeat.ts`（间隔 `<=25s`，默认 server-initiated）与 `replay.ts` 被真实消费，而不是客户端重写一套。
  4. quota/runtime/tool 错误能在客户端被正确展示与重试。
- **具体测试安排**：
  - **单测**：`reconnect/replay helpers`
  - **集成测试**：`manual disconnect/reconnect smoke`
  - **回归测试**：`04-reconnect.test.mjs` `08-session-lifecycle-cross.test.mjs`
  - **手动验证**：`网络切换/前后台切换`
- **收口标准**：
  - reconnect 后不丢关键状态
  - replay/history 不重复也不错位
  - heartbeat 间隔 `<=25s`，follow-up HTTP input 始终带 `session_uuid`
  - quota/error disclosure 一致
- **本 Phase 风险提醒**：
  - 最容易只在 web 成功，而在 Mini Program 上留下 hidden gap

### 5.4 Phase 4 — First Real Run Evidence

- **Phase 目标**：形成第一轮真实产品级实验资产
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 新增文件**：
  - `docs/eval/zero-to-real/first-real-run-evidence.md`
- **本 Phase 修改文件**：
  - `无`
- **具体功能预期**：
  1. 至少一次真实端到端演练被完整记录。
  2. evidence 不是只报喜，也记录失败与操作步骤。
  3. evidence 模板至少包含环境、commit/worker version、测试账户、步骤、关键 `trace_uuid/session_uuid`、失败与修复摘要。
  4. residual inventory 为 Z5 和下一阶段提供事实输入。
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`manual real-run walkthrough`
  - **回归测试**：`无新增自动化要求`
  - **手动验证**：`按证据模板执行一次完整流程`
- **收口标准**：
  - evidence pack 存在
  - residual inventory 含 `[blocker] / [follow-up] / [wont-fix-z4]` 标签与 fixed/deferred/next-phase 映射
  - 至少覆盖 web 与 mini-program 各一轮
- **本 Phase 风险提醒**：
  - 最容易只留下口头描述，没有可复核证据

### 5.5 Phase 5 — Z4 Closure

- **Phase 目标**：把真实运行的结果压成正式阶段结论
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 新增文件**：
  - `docs/issue/zero-to-real/Z4-closure.md`
- **本 Phase 修改文件**：
  - `test/package-e2e/**`
  - `test/cross-e2e/**`
- **具体功能预期**：
  1. 关键 gap 被回灌到自动化测试或 evidence pack。
  2. closure 清楚指出“真实跑通的面”与“仍待下一阶段吸收的 gap”。
  3. Z5 可以直接消费这些结果做总收口。
- **具体测试安排**：
  - **单测**：`无额外要求`
  - **集成测试**：`客户端 smoke re-run`
  - **回归测试**：`pnpm test:package-e2e && pnpm test:cross-e2e`
  - **手动验证**：`closure 与 evidence 对照`
- **收口标准**：
  - `Z4-closure.md` 存在
  - key findings 已被自动化或 evidence 固化
  - Z5 输入清晰
- **本 Phase 风险提醒**：
  - 最容易把 Z4 closure 写成“客户端已完成”，而不是“真实运行结论”

---

## 6. 风险与依赖

| 风险 / 依赖 | 描述 | 缓解方式 |
|-------------|------|----------|
| 客户端栈选择发散 | web / mini-program 若选型过重，会偏离验证目标 | 固定 `Vite + Vanilla TypeScript` 与微信原生工程作为 first-wave baseline |
| 真实运行暴露系统性 gap | 首轮真实运行很可能推翻局部乐观判断 | 在 Z4 明确保留 gap-fix 与 residual inventory phase |
| 证据难复核 | 只截图不留步骤/环境，后续无法重现 | 统一 evidence 模板：环境、步骤、结果、失败、残留 |

---

## 7. 完成后的预期状态

Z4 完成后，系统将具备：

1. `clients/web` 与 `clients/wechat-miniprogram`
2. 真实用户侧的 auth/session/runtime 使用路径
3. heartbeat/replay/history/quota/error 的真实客户端验证
4. 第一次真实运行的 evidence 与 residual inventory

---

## 8. 本计划完成后立即解锁的后续动作

1. 启动 `Z5-closure-and-handoff.md`
2. 用 Z4 evidence + Z0-Z3 closures 做 zero-to-real 最终 verdict
3. 把 residual inventory 转成下一阶段入口
