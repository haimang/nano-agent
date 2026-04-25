# Plan Zero-to-Real — Charter Review by Opus

> **文档性质**:`charter review / independent second-pass`
> **日期**:`2026-04-24`
> **作者**:`Claude Opus 4.7 (1M context)`
> **审核对象**:`docs/charter/plan-zero-to-real.md` r1 draft
> **参考输入**:
> 1. `docs/eval/zero-to-real/plan-analysis-by-opus-v2.md`(我本人 v2 探索性分析)
> 2. `docs/eval/zero-to-real/plan-hardening-by-GPT.md`(GPT 对 v2 的加固辩证)
> 3. `workers/{agent-core,bash-core,context-core,filesystem-core,orchestrator-core}/**` 真实代码事实
> 4. `packages/{nacp-core,nacp-session}/**` 协议层代码事实
> 5. `context/{ddl-v170,smind-admin,smind-contexter}/**` 参考上下文
>
> **方法**:本次审核的所有结论均基于**独立的代码事实核查** + **三份 input 文档的 dialectic 对比**。遵循“若 charter 与 v2 结论分歧,不默认 v2 正确;若 charter 与 GPT 结论分歧,不默认 GPT 正确;以代码事实和自身 first-principle 推理为准”。

---

## 目录

- §0 一句话 Verdict
- §1 审核范围与方法
- §2 Charter 的结构性强点(优先肯定)
- §3 阶段分层的辩证分析
- §4 In-Scope / Out-of-Scope 边界的辩证分析
- §5 文件设计(Design / Action-Plan / Closure)的辩证分析
- §6 Charter 与 v2 / GPT-hardening 的分歧点追踪
- §7 Charter 对代码事实的引用是否准确
- §8 具体 Findings 清单(按严重度)
- §9 推荐的 r2 修订清单
- §10 最终 Verdict

---

## §0 一句话 Verdict

> **Charter r1 是一份结构清晰、事实扎实、立场合理的基石文档,可以作为 zero-to-real 阶段的执行 baseline。但在 4 个维度上需要 r2 实质修订才能真正承担"不应频繁漂移的基石"这个定位。**

4 个维度:

1. **Z0 的"冻结范围"与下游 design 的"决策范围"混淆**(§3.1)
2. **Z2 合并了两类不同压力的工作(D1 SSOT + control-plane RPC 化),有结构性 scope 风险**(§3.3)
3. **Out-of-Scope 漏掉了 2 项会在执行期真实吞噬预算的项目**(§4.2)
4. **File design 漏掉了 D1 schema / LLM adapter 两份关键 cross-cutting design 文件**(§5.2)

对这 4 点修订后,本 charter 即可被视为 approve-with-followups。

---

## §1 审核范围与方法

### §1.1 我审核什么、不审核什么

**审核**:

1. 阶段分层(Z0→Z4)是否符合执行逻辑
2. in-scope / out-of-scope 是否预期准确
3. 文件清单设计是否合理(design / action-plan / closure / handoff)
4. charter 对代码事实的引用是否准确
5. charter 与 v2 / GPT-hardening 的分歧点是否有书面可追溯的 decision

**不审核**:

1. QnA 细节(charter 明确声明不产出)
2. 具体 DDL 字段级 schema 设计(留 design 阶段)
3. 具体 RPC contract 方法名(留 design 阶段)
4. 语言风格 / 排版细节

### §1.2 审核方法

对 charter 的每一条关键陈述,我做 3 件事:

1. **Fact-check**:回到 `workers/**` / `packages/**` / `context/**` 核对事实
2. **Dialectic-check**:对比 v2 + GPT-hardening 两份 input,识别 charter 是否承接、修正、或偏离
3. **Self-consistency-check**:charter 内部 §N 与 §M 是否矛盾

---

## §2 Charter 的结构性强点(优先肯定)

在进入辩证之前,先明确 charter 做对的事(避免 r2 修订时把好的东西改掉):

### §2.1 命名逻辑合理

`zero-to-real` 比 `bridging-the-gap` 更准确 —— charter §0.1 的论证(bridging 不说明补到什么状态)与 GPT-hardening §1 一致,且在文本中把 5 条"真实"(身份 / 租户 / loop / 持久化 / 客户端实验)清楚地列出来作为命名理由。**这一条沿用即可,不需改**。

### §2.2 NACP-first 作为 top-level 原则符合已 shipped truth

charter §1.2 把 NACP 抬到"执行真理"而非"背景板",并明确要求 zero-to-real 所有 track 都要能映射回 `AuthSnapshot -> NacpAuthority` / `session.start` / `session.followup_input`。

**代码事实核查**:

- `packages/nacp-core/src/{envelope.ts, type-direction-matrix.ts, state-machine.ts, admissibility.ts, version.ts}` — 全部 shipped
- `packages/nacp-core/src/transport/{service-binding.ts, do-rpc.ts, cross-seam.ts, queue.ts}` — 全部 shipped
- `packages/nacp-session/src/{ingress.ts, delivery.ts, session-registry.ts, websocket.ts, heartbeat.ts, replay.ts, redaction.ts}` — 全部 shipped

**结论**:charter 没有"虚抬"NACP;NACP 作为协议基石是 shipped 真相,charter §1.2 的措辞准确。

### §2.3 "thin-but-complete D1" 的定性把尺度拿捏对了

charter §1.5 和 §5.2 把 D1 第一波切法定位成"薄但完整",既拒绝"太薄"(只落 2-3 张 conversation/message)也拒绝"太厚"(smind-06/09 full richness)。**这个尺度与 GPT-hardening §3.2.D / §4.1 完全一致,也与我 v2 §4.2 的三模块 adopt 清单一致**。

### §2.4 Binding 矩阵 + RPC rollout law 被写成主线

charter §1.7 / §5.5 / §5.6 把"`orchestration.core` 唯一 public façade / `orchestrator.auth` internal-only / control-plane 先 RPC 化 / stream-plane 渐进退役"写成结构纪律,而不是散落条款。这一条**直接吸收了 owner 的 hard requirement 和我 v2 §1.3 的 service binding 矩阵**,是 r1 最关键的一次升级。

### §2.5 Exit criteria 分层到位

每个 phase 的 `收口标准` 与 §10.1 Primary Exit Criteria / §10.2 NOT-成功退出识别**配对成立**,并且第 10.2 条 "`orchestrator.auth` 仍暴露 public route 或非 `orchestration.core` caller" 作为 NOT-成功标准,直接把安全边界写成可验证 gate。

### §2.6 Owner 关键修正已被吸收

v2 与 GPT-hardening 在四次 dialectic 中的 4 个修正点:

1. auth 必须是完整 end-user auth flow(含 WeChat),不是最小 login demo
2. 多租户 / NACP compliance 是主线不是附属
3. NACP-core / NACP-session 从"协议存在"推到"执行真理"
4. real loop baseline 必须"可审计、可回看、可追责"

**这 4 条在 charter §1.3 / §1.4 / §1.5 / §5.1 全部有对应写入**,没有漏。

---

## §3 阶段分层的辩证分析

### §3.1 Z0 的定位混淆:charter freeze vs design decision

#### Charter 的当前写法

charter §7.1 Z0 的 In-Scope 列了 10 项要"冻结":

> 冻结完整 end-user auth surface / JWT claims 映射 / Session profile 使用面 / D1 first-wave table 清单 / quota minimal contract / provider 顺序 / worker 间 binding matrix / RPC rollout law / deferred 清单 / design-action-plan 文件清单

#### 问题

这 10 项里有**两类东西被混在一起**:

| 类别 | 属于 | 典型例子 |
|---|---|---|
| A. Charter 级别的 scope 决策 | **Z0 charter freeze 确实应包含** | binding matrix / RPC rollout law / deferred 清单 / design 文件清单 |
| B. Design 级别的技术选型 | **本应留到 design 阶段做,Z0 不该一次冻结** | 具体 JWT claim schema 字段名 / D1 first-wave 精确 table 清单 / provider 顺序 |

charter §0.2 明确说"本版本按 owner 要求,**不在 charter 中展开 QnA**",并把 QnA 留给 design 阶段。但 §7.1 Z0 in-scope 又一次性要求把 JWT claim schema 映射、D1 table 清单、provider 顺序这类**需要 QnA 配合才能冻结**的决策放进 Z0 freeze。

#### 结果

1. **Z0 变成半拉子 freeze**:要么 Z0 实际把 design-级决策吞进来(和 §0.2 的"不 QnA"冲突),要么 Z0 只冻结 charter-级决策(那 in-scope §1-§9 的措辞就需要重写)
2. **下游 ZX / Z1 design 文件的起跑线变模糊**:如果 Z0 冻了 JWT claim 字段,那 `Z1-full-auth-and-tenant-foundation.md` 就没有决策空间;如果 Z0 没冻,就是 charter 说了但 design 再推翻

#### 推荐修订

把 Z0 的 in-scope 分成两组明确项:

**Z0-charter-freeze(charter 自己负责)**:

1. binding matrix / RPC rollout law(`orchestration.core` 唯一 public / `orchestrator.auth` internal-only / control-plane RPC-first / stream-plane 渐进退役)
2. NACP realization track 作为全程主线
3. deferred / backlog 清单
4. design / action-plan / closure 文件清单与撰写顺序
5. `Z1-Z4` 的 in-scope / out-of-scope / exit criteria

**Z0-design-handoff(留给 ZX / Z1 design 文件做)**:

1. JWT claim schema 字段级冻结
2. D1 first-wave table 精确清单(含列级定义)
3. Session profile 使用面逐消息冻结
4. quota minimal contract 逐字段冻结
5. provider 顺序(Workers AI first 还是 DeepSeek first)

charter 当前写法把第二组也推给 Z0 freeze 本身,实操上会陷入"design QnA 偷偷在 Z0 charter 里做"的困境。**建议 r2 明确把第二组标注为 `待 design 阶段 ZX / Z1 冻结`。**

---

### §3.2 Z1 的范围合理,但 "auth pure RPC" 与 "internal binding secret" 的关系需要显式化

charter §7.2 Z1 in-scope 第 5 条:

> `orchestrator.auth` 从 day-1 就走 pure RPC / binding-only:
> - 不开 public route
> - 只接受 `orchestration.core` 一个 caller

#### 潜在问题

"只接受 `orchestration.core` 一个 caller"**是 wrangler binding topology 决定的**(CF 平台层保证),不是 `orchestrator.auth` 代码里能自己感知的。如果有人在 wrangler 里配了第二个 binding,代码层面没有 reject 机制。

**对比**:`workers/agent-core/src/host/internal-policy.ts` 里用 `x-nano-internal-authority` + `x-trace-uuid` 做内部身份校验,这是代码层面 typed gate。`orchestrator.auth` 作为 "creator of authority",无法用 authority header 做同款校验(因为是它在签发)。

但在 v2 §2.4.2 我已经指出一个 `secret gate` 方案:

> `orchestrator.auth` 所有 internal endpoint 都只要 secret gate + optional authority passthrough(仅用于审计日志,不做二次校验)

**charter 没把这一层点破**。实际执行时,ZX-binding-boundary-and-rpc-rollout.md(charter §12.1 提到)需要回答:

1. `orchestrator.auth` 靠什么拒绝非 `orchestration.core` caller(仅依赖 wrangler binding,还是加 secret header)
2. "pure RPC" 是指 WorkerEntrypoint class 方法,还是仅仅"不走 public ingress"(HTTP binding 也算)
3. v2 §8.2 决策表里 "orchestrator.auth 对内 transport" 的选项是 `RPC(WorkerEntrypoint)从 day-1` —— charter 对这一点**态度不明**(§5.5 说 control-plane 优先 RPC 化,但没明说 `orchestrator.auth` 是 RPC-only 还是 HTTP-also-ok)

#### 推荐

r2 §7.2 Z1 的 in-scope 第 5 条加一行显式决策锚点:

> `orchestrator.auth` 的 transport 形式(WorkerEntrypoint RPC vs fetch-based binding vs 双支持)在 ZX-binding-boundary-and-rpc-rollout.md 冻结;charter 本体不预设二选一,但要求 "pure internal, single caller, no public route" 三条硬纪律成立。

---

### §3.3 Z2 的结构性压力:D1 SSOT + control-plane RPC 化合并是真正的 scope 风险

charter §7.3 Z2 in-scope 同时包含:

**A 类 — D1 SSOT 工程**:

- 落 conversation / session / turn / message 四张表
- 落 context snapshot 表
- 落 trace-linked activity / audit 表
- `orchestration.core` 把 start / followup / cancel / resume / stream 与 D1 接起来
- history / reconnect / timeline / conversation list 可读
- web thin client 先跑通真实 persistence loop

**B 类 — control-plane RPC 迁移**:

- 启动 `orchestration.core -> agent.core` 的 control-plane RPC
- 覆盖 `start / followup / cancel / status / verify / timeline`
- 现有 `/internal/sessions/*` 保留为过渡面

#### 为什么这是结构性压力

1. **两类工作的失败模式完全不同**
   - A 类失败 = schema 过薄或过重,history/audit 语义断裂(charter §6 已列为 Z2 主要风险)
   - B 类失败 = RPC 类型面 / 测试面 / 并行存在期 / 双写一致性等 transport-level 问题
2. **两类工作不分层、同期推进,整个 Z2 收口门槛会同时承受两类风险**
3. **A 类可以立即给出可感知的产品进展**(history 能查了),B 类对产品用户不可感知。把它们绑在一起,如果 B 类卡住,A 类的进展也被 Z2 closure 门槛挡住
4. **v2 §7.2 把这两类工作明确分到 zero-to-real-2 和 zero-to-real-3 两段**(v2 zero-to-real-2 = Runtime 接真 + 用户态补齐;zero-to-real-3 = 对外 + 冷层 + first real run 期间做 internal RPC 启动)

#### 可能的修订方案

方案 A:**维持 Z2 混合,但把 RPC 化显式降级为 "启动并行存在,不作为 Z2 exit 硬门槛"**

- charter §7.3 Z2 收口标准第 3 条当前写 "orchestration.core -> agent.core control-plane 已能经 RPC 调用"
- r2 修订为:"orchestration.core -> agent.core control-plane 的 RPC entrypoint **已 scaffold 并有至少 1 条方法(推荐 `start`)双实现可用**;其余方法在 Z3-Z4 继续补齐,不作为 Z2 exit 硬门槛"

方案 B:**把 B 类从 Z2 抽到 ZX cross-cutting track**

- 不作为 Z2 exit 门槛,而是作为 ZX-binding-boundary-and-rpc-rollout.md 自己的 milestone(跨 Z2-Z4)
- Z2 专注 D1 SSOT

**推荐方案 A**,理由是:charter §5.5 已经明确 RPC-first control-plane 是纪律主线,从 Z2 抽走会让纪律主线失去一个承载阶段。降级 Z2 exit 硬门槛是更轻的调整。

---

### §3.4 Z4 的隐藏风险:stateful uplift 被当成 "可能" 而非 "很可能"

charter §7.5 Z4 in-scope 第 5 条:

> 若 Z2/Z3 暴露出 user-stateful 缺口,则在本阶段补齐 stateful uplift

这句话看起来是风险 hedge,但实际上是**把一个极重的工作项(DO SQLite + Alarm + 双向 WS + conversation 聚合 + IntentDispatcher)悬置在 Z4 上方**。

#### v2 的事实判断

v2 §3.1 已经指出 `orchestration.core` user DO 当前**完全缺失** 5 类用户态能力:

1. DO SQLite 未用
2. Alarm 未用
3. 双向 WS 未实装
4. conversation 聚合层空白
5. Intent dispatch 空白

这 5 条**不是"可能暴露",而是"一定暴露"**。Z2 要 "history / reconnect / timeline / conversation list 可读",没有 DO SQLite + conversation 聚合基本做不了(除非全部走 D1 round-trip,那 hot read 的延迟 budget 会撑爆)。

#### 潜在后果

- 如果 Z4 才做 stateful uplift,Z4 的 "web + Mini Program + gap hardening + 剩余 internal HTTP 收敛 + first real run evidence pack" 5 件事里还要加第 6 件 "orchestration.core user DO 重塑",Z4 超期概率极高
- 如果 Z2 不做 stateful uplift,Z2 的 "history / reconnect" 很可能变成"勉强能查,但热路径走 D1 全表扫"这种"可证明但不可用"的状态

#### 推荐

r2 §7.3 Z2 in-scope 增加一条:

> **orchestration.core user DO 的 stateful uplift(DO SQLite + Alarm + conversation 聚合最低集合)作为 Z2 in-scope 的必做项**,以支撑 history / reconnect / timeline 的真实读路径。双向 WS 与 IntentDispatcher 可延后到 Z4。

同时 r2 §7.5 Z4 in-scope 第 5 条降格为:

> Z4 处理 DO SQLite / Alarm 之外的**延后 stateful 工作**(双向 WS / IntentDispatcher / Broadcaster 等),以及 Z2 未能闭环的 user-state gap 修复。

---

### §3.5 Z0 -> Z4 DAG 的排序逻辑总体合理

charter §8.2 的 DAG 和 §8.3 的"为什么这样排"论证,**没有硬矛盾**。重点核查:

1. **Z1 必须先于 Z2** — ✅ 合理,session / audit 真相依赖真实 identity / tenant truth
2. **Z2 必须先于 Z3** — ✅ 合理,provider 接真之前先落 SSOT 与 control-plane baseline
3. **Z3 必须先于 Z4** — ✅ 合理,client experiment 不该跑在 fake provider 上

唯一 DAG 上可讨论的:

#### WeChat bridge 在 Z1 vs Mini Program 在 Z4 的时间差问题

- Z1 要求 WeChat bridge 落地并有 negative tests
- Z4 才引入 Mini Program 真实接入
- 中间 Z2+Z3 ≈ 2-3 个月 WeChat bridge 无真实客户端 exercise

**风险**:Z1 写的 WeChat bridge 到 Z4 对接 Mini Program 时才发现 API 理解有偏差或 `code2session` 响应结构与预期不符,Z4 预算被 bridge 重写吞噬。

**推荐**:r2 §7.2 Z1 exit criteria 增加一条:

> 用 Mini Program 开发者工具(或 wx.login mock)至少跑通一次 `code -> openid -> JWT` 的完整链路,不要求产品级 UI 但要求 code-level 链路证据。

这不是引入 Mini Program 开发工作,而是**降低 bridge 代码在 Z4 对接时才发现 API 偏差的风险**。

---

## §4 In-Scope / Out-of-Scope 边界的辩证分析

### §4.1 全局 In-Scope(§4.1)精准度 ≥ 90%

charter §4.1 的 9 条全局 in-scope 与 Opus v2 §0.3 6 条硬指标 / GPT-hardening §4.1 6 条必做内容的交集非常高。差异:

| charter §4.1 | v2 对应 | GPT 对应 | 判断 |
|---|---|---|---|
| NACP realization track | §0.1 / §1.2 | §3.1.C / §5.3 | ✅ charter 最强化 |
| 完整 end-user auth(含 WeChat)| §0.3.1 | §3.2.A / §4.1.1 | ✅ 三者一致 |
| multi-tenant / no-escalation / tenant boundary | §0.3.2 / §1.3 | §4.1.2 | ✅ 三者一致 |
| binding boundary freeze + internal RPC kickoff | §1.3 / §6 | §5.5 | ✅ charter 重写最清晰 |
| `orchestration.core` 继续作为唯一 public façade | §1.3 | §5.6.1 | ✅ |
| thin-but-complete D1 | §4 | §4.1.3 / §5.2 | ✅ |
| real provider | §5 | §4.1.4 | ✅ |
| quota minimal runtime truth | §4.2.3 | §4.1.5 | ✅ |
| web + Mini Program | §0.3.5 | §4.1.6 | ✅ |

**结论**:in-scope 清单事实准确,没有漏项,没有虚项。

### §4.2 全局 Out-of-Scope(§4.2)的实质问题

charter §4.2 列了 7 条。我的核查:

| # | charter §4.2 | 问题 |
|---|---|---|
| 1 | 完整 admin plane | ✅ 合理 |
| 2 | 完整 API key / invite / member admin | ⚠️ **与 v2 §2.4.2 内部 api-keys/validate 接口存在张力**,详见下文 |
| 3 | 所有 internal stream / relay / WS 相关路径一步到位全面 RPC-only 化 | ⚠️ 语义冗余,和 §5.5 重复,不是新增 OoS |
| 4 | cold archive / R2 offload | ✅ 合理 |
| 5 | full quota policy / ledger / alerts plane | ✅ 合理 |
| 6 | collaboration richness 全量化 | ✅ 合理 |
| 7 | NACP 之外的新协议家族扩张 | ✅ 合理 |

#### 问题 1:Out-of-Scope 第 2 条与 API key server-to-server 验证的冲突

- charter Z1 in-scope **没有**明确包含 `POST /internal/auth/api-keys/validate`(server-to-server API key 校验),只说 register / login / verify / refresh / reset / WeChat / me
- charter §4.2.2 **排除**"完整 API key admin plane"
- **但是**,如果某个下游 agent 或集成要用 API key 调 orchestration.core,**API key verify 路径是否包含在 Z1**?charter 没给明确 answer

**v2 §2.4.2 明确列了 `POST /internal/api-keys/validate` 作为 orchestrator.auth day-1 internal 接口**,理由是"server-to-server API key 验证"是运行时鉴权路径,不是 admin CRUD。

charter 当前写法把 API key admin 整个拉到 OoS,可能顺带把 verify 运行时路径也挡掉。

**推荐 r2 修订**:

- §4.2.2 修为 "完整 API key **admin** plane(管理面 list/create/revoke/rotate)",与 **verify 运行时路径**显式区分
- §7.2 Z1 in-scope 加一条 "api-key verify 运行时路径(无 admin plane)"或明确 defer 到后续 phase

#### 问题 2:OoS 漏掉 2 项会在执行期吞预算

charter §4.2 没明确排除的但应该排除的:

**A. Admin UI / tenant 自助控制台**

- Z2/Z3/Z4 执行中,很容易陷入"做个后台给用户查 conversation 列表 / quota 余额"
- charter §7.3.1 Z2 in-scope 第 7 条 "history / reconnect / timeline / conversation list 可读" —— "可读"意思可能被扩读成"admin UI 可以看"
- v2 §0.4 明确把 "不建 CMS / CRM / project 等业务模块" 排除了,GPT-hardening 也把 admin plane 排除了;但 charter 没显式排除 UI 层

**推荐 r2 修订**:§4.2 加一条

> 所有 tenant-facing admin UI / 自助控制台 / 前端管理面板(包括 conversation 列表 UI / quota 余额展示 UI / 租户成员管理 UI)。本阶段只要求 API 层能查,UI 层整体 out-of-scope。

**B. 观测性 / metrics / dashboard / ops plane**

- charter §10.1 第 5 条 "first real run evidence" 的 "evidence pack" 措辞容易被扩读成"要接入 Grafana / Datadog / 自建 metrics dashboard"
- v2 §8.3 明确把 "platform SLO / billing / dashboard / ops plane" 排除了

**推荐 r2 修订**:§4.2 加一条

> 所有 platform-level 观测性(Grafana 接入 / 告警规则 / SLO 定义 / runtime dashboard)。本阶段的 "evidence pack" 限定为 "issue / bug / backlog 文档 + 必要的 one-off logs",不扩张为 ops plane。

### §4.3 Phase 级 in-scope / out-of-scope 的一致性

逐 phase 核查:

#### Z0

- in-scope 10 条,out-of-scope 5 条 — **结构 OK**
- 问题:§3.1 已指出 Z0 in-scope 混了 charter-level 和 design-level

#### Z1

- in-scope 8 条,out-of-scope 6 条 — **结构 OK**
- **问题**:in-scope 没提 API key verify 运行时路径(见 §4.2 问题 1)
- **问题**:out-of-scope 第 3 条 "`agent.core` internal HTTP 退役" — charter §1.7 / §5.5 说本阶段 RPC kickoff,Z1 出现 "agent.core internal HTTP 退役 out-of-scope" 与 §5.5 语义一致(Z1 不做 agent.core RPC,Z2 才启动)— **内部一致**

#### Z2

- in-scope 8 条 — **结构 OK**
- 问题:见 §3.3 / §3.4,混合 D1 SSOT + control-plane RPC + 未显式包含 stateful uplift

#### Z3

- in-scope 7 条,out-of-scope 5 条 — **结构 OK**
- 轻微问题:out-of-scope 第 3 条 "DeepSeek per-tenant secret governance 完整化" —— 这里**加 "完整化" 后缀很关键**,暗示 minimal DeepSeek BYO key 是可以在 Z3 期间做的。与 GPT-hardening §5.4 "DeepSeek BYO key 更适合在 auth/secrets plane 稳定后再引入" 一致。但 Z3 in-scope 没写 "DeepSeek minimal"——这是 **fallback-only**(OK, provider 为 Workers AI first 已是 Z3 scope),还是 **primary**(需 DeepSeek)? charter 应显式
- **推荐**: Z3 in-scope 第 1 条 "agent.core 接入 Workers AI" 保持,追加一条 "Workers AI 作为 Z3 唯一 first provider;DeepSeek adapter skeleton 属 optional 增量,具体 per-tenant secret 工程 defer 到后续 phase"

#### Z4

- in-scope 7 条,out-of-scope 5 条 — **结构 OK**
- 问题:见 §3.4,stateful uplift 悬置风险

---

## §5 文件设计(Design / Action-Plan / Closure)的辩证分析

### §5.1 §12.1 Design 文件清单的合理性

charter §12.1 列了 7 份 design 文件:

| 文件 | 对应 | 我的看法 |
|---|---|---|
| `Z0-contract-and-compliance-freeze.md` | Z0 | ✅ |
| `ZX-nacp-realization-track.md` | Z0 cross-cutting | ✅ |
| `ZX-binding-boundary-and-rpc-rollout.md` | Z0 cross-cutting | ✅ |
| `Z1-full-auth-and-tenant-foundation.md` | Z1 | ✅ |
| `Z2-session-truth-and-audit-baseline.md` | Z2 | ✅ |
| `Z3-real-runtime-and-quota.md` | Z3 | ✅ |
| `Z4-real-clients-and-first-real-run.md` | Z4 | ✅ |

#### 缺失的 2 份关键 cross-cutting design 文件

**A. 缺 `ZX-d1-schema-and-migrations.md`**

- D1 schema 是 Z1 + Z2 + Z3 + Z5(backlog)**四个阶段都要直接消费的共享真相**
- charter §1.5 明确 "identity core / conversation / context snapshot / audit / usage-quota" 五大类表是第一波
- 这个 schema 如果散落在 Z1 / Z2 / Z3 各自的 design 文件里,会出现:
  - 同一张表(例如 `nano_teams`)可能在 Z1 design 和 Z3 design 里描述不一致
  - migration order 不清晰(Z1 落 identity,Z2 落 conversation,Z3 落 quota —— 但 FK 可能跨阶段)
  - view 策略(v2 §4.3 `v_nano_*_live` views)没地方写
- **推荐 r2 §12.1 加入**:`ZX-d1-schema-and-migrations.md`
  - 冻结:数据库命名 / 表前缀 / 模块级 table 清单 / migration 版本管理 / view 策略 / FK 关系图

**B. 缺 `ZX-llm-adapter-and-secrets.md`**

- LLM adapter 工程(Workers AI + DeepSeek fallback + tenant secrets 加密)本身是独立 track
- v2 §5 整整一节(§5.1-§5.6)讲这个
- charter Z3 design 文件要同时覆盖 "Workers AI 接入 + fake provider 退役 + quota hook + runtime mesh binding + 秘钥工程 + trace integration",太重
- **推荐 r2 §12.1 加入**:`ZX-llm-adapter-and-secrets.md`
  - 冻结:provider 顺序 / fallback 触发条件 / 秘钥存储方案 / 加密算法 / rotation 协议 / 热缓存 TTL / rate limit 处理

加上这 2 份,charter §12.1 的 design 文件数从 7 → 9,仍是合理范围(对比 orchestration-facade 阶段有 10+ 份 design 文档)。

### §5.2 §12.2 Action-Plan 清单 — 合理,小补一条

charter §12.2 列了 6 份 action-plan:Z0-Z4 + Z5-closure。**结构合理**。

一个小补:Z5-closure 单独作为 action-plan 文件是好的(closure 本身是工作流),但可以考虑:

- `Z5-closure-and-handoff.md` 改名为 `Z5-closure-handoff-and-backlog-curation.md`,明确 Z5 包含 backlog 整理 / deferred 文档化,不是只做 closure 文档

这是 minor,不影响结构决策。

### §5.3 §12.3 Closure / Handoff 清单 — 合理

Z0-Z4 + final + handoff = 7 份。**结构与 orchestration-facade 阶段保持一致**,沿用即可。

### §5.4 §12.4 建议撰写顺序 — 有 1 个排序问题

charter §12.4 的三批次:

**第一批**:`Z0-contract-and-compliance-freeze` / `ZX-nacp-realization-track` / `Z1-full-auth`
**第二批**:`Z2-session-truth` / `Z3-real-runtime-and-quota`
**第三批**:`Z4-real-clients` / 所有 action-plan / `Z5-closure`

#### 问题

1. **`ZX-binding-boundary-and-rpc-rollout.md` 没进第一批**
   - 但 charter §1.7 / §5.5 / §5.6 都把 binding boundary / RPC rollout 列为 Z0 freeze 必做
   - 如果它在第二批或第三批写,Z1 的 `orchestrator.auth` 实现期就没有 "pure internal binding / RPC-first" 的 design 依据
   - **推荐 r2 §12.4 第一批修正为**:`Z0-contract` / `ZX-nacp-realization` / `ZX-binding-boundary-and-rpc-rollout` / `Z1-full-auth`(4 份而非 3 份)

2. **`Z4-real-clients` 推到第三批有一个子风险**
   - §3.5 已指出 WeChat bridge(Z1 做) ↔ Mini Program(Z4 对接) 中间相隔 2-3 月
   - 如果 Z4 design 到第三批才起草,Mini Program-side 的接口期待可能与 Z1 WeChat bridge 实现已经偏移
   - **推荐**:Z4 design 的 **skeleton**(至少明确 Mini Program 端 auth API 期待 + WS 连接期待)提前到第二批写,完整版留第三批迭代

### §5.5 §12.5 "优先看哪 5 份" — 有一个小瑕疵

charter §12.5 列出的 5 份:

1. `docs/eval/zero-to-real/plan-hardening-by-GPT.md` ← **eval 文件,不是 design 文件**
2. `ZX-nacp-realization-track.md`
3. `Z1-full-auth`
4. `Z2-session-truth`
5. `Z4-real-clients`

**问题**:charter §12.5 的语境是 "如果先控制文档数量,优先看哪 5 份 **(design)** 文档";列入 eval 文档在语境上是不协调的。要么:

- **方案 A**:保留 GPT-hardening 作为"最关键辅助输入",标注 "(eval 参考,非 design)"
- **方案 B**:替换为 `ZX-d1-schema-and-migrations.md`(如果 §5.1 的建议被采纳)

**推荐方案 B**,理由是 §12.5 应该作为 "新 reviewer 最少读什么 design 就能对上 charter 意图" 的入口,而 eval 文档天然在 charter 的 "输入依据" 列表(头部已引用)。

---

## §6 Charter 与 v2 / GPT-hardening 的分歧点追踪

这里记录 3 份文档(v2 / GPT-hardening / charter r1)**显式分歧**的地方,供 r2 决定是否需要在 charter 里加"决策说明"。

### §6.1 LLM provider 顺序:v2 主张 DeepSeek first,charter 采 Workers AI first

| 维度 | v2 §5.5 / §8.2 | GPT-hardening §5.4 | Charter §7.1 / §7.4 |
|---|---|---|---|
| 主 provider | DeepSeek | Workers AI | Workers AI |
| fallback | Workers AI | DeepSeek | (未显式) |
| 理由 | 中文好 / per-tenant key / 成本可控 | 平台原生 binding / 最小 secret 复杂度 / 尽快真实输出 | 沿用 GPT 推荐 |

**Charter 选 GPT 推荐但没有说明为什么 revoke v2 推荐**。

**推荐 r2 修订**:charter §1.4 或 §7.4 加一句:

> **provider 顺序决策**:Z0 冻结采用 Workers AI first(platform-native binding,最小秘钥复杂度),DeepSeek adapter 作为 Z3 optional 增量 + 后续阶段 fallback。此决策取自 GPT-hardening §5.4 推荐,覆盖 v2 §5.5 的 DeepSeek-primary 建议。

这类 decision-trail 写入 charter,可以避免未来 r3/r4 漂移时没人记得为什么切换。

### §6.2 orchestration.core user DO stateful uplift:v2 主张 day-1,charter 悬置到 Z4

| 维度 | v2 §7.2 zero-to-real-2 | GPT-hardening §5.5 | Charter |
|---|---|---|---|
| 时机 | 明确列入 zero-to-real-2 in-scope(DO SQLite + Alarm + 双向 WS + conversation 聚合 + IntentDispatcher 全包)| "优先 D1 SSOT,但如果现有形态不足,uplift 不能后移" | §7.5 Z4 in-scope 第 5 条 "若暴露缺口才补" |
| 压力方向 | 一次性补 | 条件触发 | 条件触发(最弱)|

**Charter 比 v2 和 GPT 都更保守**。§3.4 已展开说明这个悬置是有风险的。

**推荐 r2 修订**:按 §3.4 建议,Z2 承担 DO SQLite + Alarm + conversation 聚合最低集合,Z4 补双向 WS + IntentDispatcher。

### §6.3 API key verify 运行时路径:v2 列为 day-1,charter 归到"完整 API key admin plane" OoS

见 §4.2 问题 1。**推荐 r2 明确 API key verify 路径不属于 admin plane**,可以作为 Z1/Z2 runtime 路径。

### §6.4 共识点(三份文档完全一致,charter 不用改)

1. nano-agent 与 smind 完全独立(参考上下文,不是上游)
2. 多租户 day-1
3. NACP-first
4. 持久化永久(冷热分层留后续阶段)
5. 不收费但 quota hook 强制
6. web + Mini Program 双客户端
7. `orchestrator.auth` 必须独立且 internal-only
8. `orchestration.core` 唯一 public façade
9. thin-but-complete D1(而非 too-thin)
10. WeChat bridge 属于 zero-to-real in-scope(而非后置)

---

## §7 Charter 对代码事实的引用是否准确

我逐条核查 charter 引用的代码事实。

### §7.1 引用准确 ✅

| charter 位置 | 引用内容 | 代码事实 | 判断 |
|---|---|---|---|
| §1.2.1 | `@haimang/nacp-core` envelope / authority / trace / control / transport / tenancy / evidence vocabulary 已冻结 | `packages/nacp-core/src/{envelope.ts, types.ts, version.ts, transport/, tenancy/, evidence/}` 全部存在 | ✅ |
| §1.2.2 | `@haimang/nacp-session` session.start / followup_input / ack / heartbeat / resume / replay 已冻结 | `packages/nacp-session/src/{messages.ts, frame.ts, heartbeat.ts, replay.ts, session-registry.ts, ingress.ts, delivery.ts}` 全部存在 | ✅ |
| §1.2.3 | `workers/orchestrator-core/src/auth.ts` 已有 public ingress JWT + trace_uuid + tenant mismatch rejection | 文件存在,190 LOC,包含 verifyJwt(line 75)+ authCtx 构造 | ✅ |
| §1.2.4 | `workers/agent-core/src/host/internal-policy.ts` 已有 internal authority / trace / no-escalation 校验 | 文件存在,252 LOC,包含 `authorityEquals`(line 92)+ `authority-escalation` 拒绝逻辑(line 216) | ✅ |
| §2.1.3 | `workers/agent-core/src/kernel/runner.ts` 已有真实 loop、tool exec、runtime events | 文件存在,355 LOC | ✅ |
| §2.1.4 | `workers/agent-core/src/host/traces.ts` 已有 trace-law compliant event builders | 文件存在,288 LOC | ✅ |
| §2.1.5 | `workers/context-core/src/{context-assembler.ts, snapshot.ts}` 存在 | 文件均存在 | ✅ |
| §2.1.6 | `packages/nacp-core/src/transport/{service-binding.ts, do-rpc.ts}` 存在 | `ServiceBindingTransport` + `DoRpcTransport` 文件均存在 | ✅ |
| §2.2 | orchestrator-core -> agent-core 仍通过 `/internal/*` + secret header + URL path 调用 | 与 orchestration-facade 阶段现状一致 | ✅ |

### §7.2 需要补充的一个事实(不是 charter 错,而是 charter 可以更精确)

charter §2.1.6 "transport primitives 已具备,但 runtime worker 还没有真正用起来" —— 这句话准确但模糊。具体:

- `ServiceBindingTransport` / `DoRpcTransport` 作为 NACP 协议层 transport 工具存在
- 但 `workers/*/src/**` 里 **grep 到的使用方** 基本上只在测试路径,production 代码仍用 fetch-backed binding
- charter 可以明确写 "runtime worker 的 production 路径仍未消费 transport primitives"——但这是 minor 精度问题,不影响 charter 判断

### §7.3 charter 没有"虚构事实"

我逐条核查后,charter r1 **没有虚构或过度拔高代码事实**。

唯一需要注意的潜在风险:charter §1.5 / §7.3.1 提到 "`nano_session_activity_logs` 或 owner-approved 等价表" 作为 audit table。

**我 grep `context/ddl-v170/*.sql` 查询 `audit | activity_log` 关键字,返回空**。最接近的祖宗是 `smind-04-runtime-process-execution.sql` 里的 `smind_process_events`(line 504),但 smind-04 整体 OoS。

**结论**:`nano_session_activity_logs` 是 **zero-to-real 阶段的新设计**,不是从 ddl-v170 adopt。charter 已用"或 owner-approved 等价表" hedge 了这一点,但 r2 可以更明确:

**推荐 r2 修订**:charter §1.5 第 4 条 "trace-linked activity / audit core" 后面加:

> 注:`nano_session_activity_logs` 在 ddl-v170 中**没有直接祖宗表**(smind-04 的 `smind_process_events` 结构最近但模块整体 OoS)。本阶段 audit table 是 nano-agent 新设计,design 阶段由 `ZX-d1-schema-and-migrations.md` 明确 schema。

---

## §8 具体 Findings 清单(按严重度)

按 orchestration-facade 阶段的 finding 分级(blocker / high / medium / low)。

### §8.1 Blocker

**无**。

### §8.2 High

**H1. Z2 结构性压力:D1 SSOT 与 control-plane RPC 化合并,且 stateful uplift 悬置到 Z4**

- 位置:charter §7.3 / §7.5
- 影响:Z2 可能因为 RPC 工作卡住而阻塞 D1 SSOT 的用户可感进展;Z4 可能因为补 stateful uplift 而超期
- 建议:按 §3.3 方案 A + §3.4 修订

**H2. Out-of-Scope §4.2 漏排 admin UI 与 observability 两类会吞预算的项目**

- 位置:charter §4.2
- 影响:执行期 Z2-Z4 有 30%+ 概率被误读为"需要做后台 UI / 做 dashboard"
- 建议:按 §4.2 问题 2 加 2 条显式 OoS

### §8.3 Medium

**M1. Z0 "冻结范围" 与 design 决策混淆**

- 位置:charter §7.1
- 影响:Z0 in-scope 的 10 条里有 5 条是 design-level 决策(JWT claim 字段 / D1 table 精确清单 / provider 顺序等),与 §0.2 "不 QnA" 冲突
- 建议:按 §3.1 修订,分 charter-freeze 和 design-handoff 两组

**M2. API key verify 运行时路径的归属不明**

- 位置:charter §4.2.2 / §7.2
- 影响:如果某个下游 agent 要用 API key 调 orchestration.core,Z1 in-scope 是否覆盖?
- 建议:按 §4.2 问题 1 修订

**M3. Design 文件清单漏 2 份 cross-cutting**

- 位置:charter §12.1
- 影响:D1 schema / LLM adapter 工程散落在 Z1/Z2/Z3 各自 design 文件,有 cross-phase 不一致风险
- 建议:按 §5.1 增加 `ZX-d1-schema-and-migrations.md` + `ZX-llm-adapter-and-secrets.md`

**M4. 撰写顺序 §12.4 遗漏了 `ZX-binding-boundary-and-rpc-rollout.md` 的第一批地位**

- 位置:charter §12.4
- 影响:Z1 `orchestrator.auth` 实现时可能没有 design 锚点
- 建议:按 §5.4 修订

**M5. Provider 顺序从 v2 到 charter 发生了反转但无 decision-trail**

- 位置:charter §7.4(默认 Workers AI first)
- 影响:未来读者无法理解为什么 charter 与 v2 §5.5 相反
- 建议:按 §6.1 在 charter §1.4 或 §7.4 加 decision-trail 一行

### §8.4 Low

**L1. `nano_session_activity_logs` 没有 ddl-v170 祖宗表,charter 需显式**

- 位置:charter §1.5 / §7.3.1
- 建议:按 §7.3 加一行 note

**L2. Orchestration.auth "只接受 orchestration.core 一个 caller" 的执行机制未锚定**

- 位置:charter §1.7.2 / §7.2 Z1 in-scope 第 5 条
- 影响:binding topology 是 wrangler 配置层决定,代码层没有 typed gate;charter 没明确 ZX-binding 文件要回答这个问题
- 建议:按 §3.2 r2 §7.2 加 transport 形式的 design-handoff 锚点

**L3. §12.5 "优先 5 份" 列入了 eval 文件**

- 位置:charter §12.5
- 建议:按 §5.5 替换

**L4. Z1 exit criteria 缺少 Mini Program-side WeChat code 链路 smoke test**

- 位置:charter §7.2 收口标准
- 建议:按 §3.5 增加一条

---

## §9 推荐的 r2 修订清单

按优先级汇总:

### §9.1 必改(H 级)

1. **§7.3 Z2 in-scope 增加 orchestration.core user DO stateful uplift 最低集合**(DO SQLite + Alarm + conversation 聚合)作为必做项
2. **§7.3 Z2 收口标准** 把 "control-plane RPC 已能经 RPC 调用" 降级为 "RPC entrypoint 已 scaffold + 至少 1 方法双实现可用"
3. **§7.5 Z4 in-scope 第 5 条** stateful uplift 降格为 "双向 WS + IntentDispatcher + Broadcaster 等延后项 + Z2 未闭环的 user-state gap 修复"
4. **§4.2 Out-of-Scope** 增加 2 条:
   - 所有 tenant-facing admin UI / 自助控制台 / 前端管理面板
   - 所有 platform-level 观测性(metrics / dashboard / ops plane)

### §9.2 应改(M 级)

5. **§7.1 Z0 in-scope** 分为 Z0-charter-freeze(charter 自己负责)+ Z0-design-handoff(留给 design 阶段)
6. **§4.2.2 OoS** 修为 "完整 API key **admin** plane",与 **verify 运行时路径**显式区分;§7.2 Z1 in-scope 明确 api-key verify 是否包含
7. **§12.1 Design 清单** 增加:
   - `ZX-d1-schema-and-migrations.md`
   - `ZX-llm-adapter-and-secrets.md`
8. **§12.4 撰写顺序 第一批** 从 3 份扩为 4 份,加入 `ZX-binding-boundary-and-rpc-rollout.md`
9. **§1.4 或 §7.4** 加 provider 顺序 decision-trail:"Workers AI first 决策覆盖 v2 DeepSeek-primary 建议,理由:platform-native binding + 最小秘钥复杂度"

### §9.3 建议改(L 级)

10. **§1.5 / §7.3.1** 加 note:`nano_session_activity_logs` 在 ddl-v170 中没有直接祖宗,本阶段是 nano-agent 新设计
11. **§1.7.2 / §7.2** 加 design-handoff 锚点:`orchestrator.auth` 的 transport 形式(WorkerEntrypoint RPC vs fetch-based binding)在 `ZX-binding-boundary-and-rpc-rollout.md` 冻结
12. **§12.5 "优先 5 份"** 把 `plan-hardening-by-GPT.md` 替换为 `ZX-d1-schema-and-migrations.md`(或标注 "eval 参考,非 design")
13. **§7.2 Z1 收口标准** 加一条:用 Mini Program 开发者工具(或 mock)跑通 `code -> openid -> JWT` code-level 链路

---

## §10 最终 Verdict

### §10.1 对 Charter r1 的独立评价

| 维度 | 评价 |
|---|---|
| **结构清晰度** | **A** — 14 节覆盖完整,每节职责单一,引用源头可追溯 |
| **事实准确度** | **A** — 对 `workers/` / `packages/` / `context/` 代码事实引用无虚构,仅 1 项("nano_session_activity_logs 祖宗")需更显式标注 |
| **Dialectic 吸收度** | **A-** — Owner 四次修正(WeChat 必做 / multi-tenant 主线 / NACP law / real loop 可审计基线)全部吸收;v2 与 GPT-hardening 共识部分吸收,分歧部分多数吸收 GPT 推荐但缺 decision-trail |
| **阶段分层合理度** | **B+** — Z0-Z4 顺序合理;Z2 合并 D1 + RPC 是结构风险;Z4 悬置 stateful uplift 是执行风险 |
| **in/out-scope 边界精度** | **B+** — in-scope 9 条无虚项无漏项;out-of-scope 漏 2 条(admin UI / observability);API key verify 归属不明 |
| **文件设计合理度** | **B** — 结构合理,但漏 2 份关键 cross-cutting(D1 schema / LLM adapter);撰写顺序漏了 `ZX-binding` 的第一批地位 |

**综合**:**B+,approve-with-followups**

### §10.2 推荐的 r2 决策动作

- **立刻 r2**:H1 + H2(4 条 OoS 补充、Z2/Z4 stateful uplift 搬家)
- **起草 design 前 r2**:M1 + M3 + M4(Z0 freeze/handoff 分层、2 份新 ZX 文件、撰写顺序)
- **可延到 r3**:L1 + L2 + L3 + L4(note 补充 / design-handoff 锚点 / 替换入口文档 / Mini Program smoke test)

M2(API key verify 归属)和 M5(provider decision-trail)建议**也进 r2**,因为这两条一旦漂移会导致下游 design 文件写错。

### §10.3 对 owner 的 3 个决策建议(非 charter 内容)

1. **是否接受 "Z2 带 stateful uplift 最低集合,Z4 只做延后项"?** 这直接改变 Z2/Z4 的 velocity 预期
2. **是否接受 API key verify 路径 Z1 in-scope?** 这影响 Z1 `orchestrator.auth` 的 RPC surface 大小
3. **是否接受 LLM provider 从 v2 的 DeepSeek-first 反转为 charter 的 Workers AI-first?** 这是 charter r1 已经默认的选择,但值得 owner 显式 ack

### §10.4 一句话总结

> **Charter r1 是一份立场合理、事实扎实、结构清晰的基石草稿,可以承担"不频繁漂移的基石"这个定位,但在落地执行前需要通过 r2 修订明确(a)Z2/Z4 的 stateful uplift 承担阶段、(b)Admin UI 与 observability 的 OoS 边界、(c)D1 schema 与 LLM adapter 两份 cross-cutting design 文件、(d)Workers AI first 的 decision-trail。r2 修订后即可 approve。**

---

## §11 对自己 v2 的 self-critique(不是 charter 审核,但对 owner 透明)

审这一轮 charter 的过程中,我也对自己的 v2 做了几点修正认识:

1. **v2 §5.5 推荐 DeepSeek primary 是错的** — GPT-hardening §5.4 的反驳("platform-native binding 最小秘钥复杂度")在 first-wave 阶段更合理,charter 采用 GPT 推荐是对的
2. **v2 §3.4 IntentDispatcher 放 day-1 有点过重** — charter 把双向 WS + IntentDispatcher 悬到 Z4 这个方向本身是对的(只是悬挂的时机和安全网需要调,见 §3.4)
3. **v2 §6 "internal RPC 本阶段只启动不完成" 的语气过于笼统** — charter §5.5 / §1.7 把 "control-plane 优先 RPC / stream-plane 渐进退役" 写成分层纪律,比 v2 的笼统说法更精确

**v2 的结论仍有 3 条我坚持不变**:

1. orchestration.core user DO 有 5 类用户态能力缺失(见 §3.4,事实不变,只是 "何时补" charter 需调)
2. 秘钥工程必须在 LLM adapter 接真同期完成(charter 也认了)
3. nano_ 表前缀 + 独立 D1 是必须的(三方共识)

---

## §12 版本历史

| 版本 | 日期 | 作者 | 变更 |
|---|---|---|---|
| r1 | 2026-04-24 | Claude Opus 4.7 (1M context) | 基于 `workers/**` + `packages/**` + `context/**` 代码事实 + v2 + GPT-hardening dialectic 对比,对 `docs/charter/plan-zero-to-real.md` r1 draft 进行独立审核。结论:approve-with-followups(综合评分 B+)。2 条 H 级 + 5 条 M 级 + 4 条 L 级 findings,共 11 条 r2 修订建议。 |
