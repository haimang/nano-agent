# Review: `plan-after-skeleton.md` — by Opus

> 审查对象: `docs/plan-after-skeleton.md`（GPT-5.4, 2026-04-17 rewrite）
> 审查人: `Claude Opus 4.7 (1M context)`
> 审查时间: `2026-04-17`
> 审查依据:
> - 根目录 `README.md` 定义的项目 vision
> - `docs/plan-after-nacp.md` 对当前 skeleton 阶段的收口判断（`skeleton-complete, not deployment-complete`）
> - `packages/**` 当前代码事实（已对关键命题做 spot-check）
> - `docs/progress-report/mvp-wave-2nd-round-fixings.md` 中 scope-down 的 3 条 deferred items
> - 8 份 code-review 文档中 GPT 二次审查的"仍未收口"清单

---

## 0. 总结结论（TL;DR）

- **整体判断**：这份 plan **方向正确、立意明显高于旧版**，把"继续补 runtime"改写为"先冻结 contract + 把 trace 升级为 runtime law，再做 runtime closure"这条 sequencing，是**正确且有见地的重排**。旧版的问题就是把"runtime closure"作为唯一目标，会让协议面继续漂移。
- **但这份 plan 不能当作"可以直接开工的 charter"**——它在 **3 个关键命题上存在与代码事实 / README vision 的未对齐**，另有 **4 处 sequencing 可以更佳的安排**，在进入 Phase 0 之前必须先明确。
- **结论等级**：`approve-with-followups` —— 方向采纳，但需要先解决 §3 列出的 3 个**必须沟通确认**的点，否则 Phase 0 的 scope 会在执行时继续打架。

### 0.1 最关键的 3 个判断

1. **`trace_uuid` vs `trace_id` 的命名不是"可以延后的 cosmetic 问题"**——plan 全文用 `trace_uuid` 作为 canonical 名，但 `nacp-core` 核心 envelope 里的字段**已经叫 `trace_id`**（且是 required UUID）。这意味着 plan 里"把 trace_uuid 提升为 runtime law"这条，在代码层面**要么是 rename 动作，要么是和 `trace_id` 共存的兼容动作**。plan 没说清是哪种，Phase 0 就不能启动。
2. **README §6 Todo Notes 第一条承诺的"多轮 follow-up input family"被 plan 放到了 Out-of-Scope**——这是 README 级的**明文期待**，plan 把它归到"richer session v2"，但 README 原文写的是"right after MVP"。这两者至少要有一方更新。
3. **D1-backed trace anchor 是 100% greenfield**——仓内**没有任何 D1 wiring**（0 个 package.json 依赖 / 0 处 `D1Database` 用法 / `eval-observability` 目前只有 DO storage sink）。把 D1 作为 Phase 1 的 foundation **承诺 commitment 是对的**，但 plan 需要承认"这是新 infra，不是 instrument existing infra"，工作量估算和前置决策都会不同。

---

## 1. 与 README vision 和 plan-after-nacp 的对齐分析

### 1.1 对齐良好的部分

| plan-after-skeleton 主张 | 与 README / post-nacp 的对齐情况 |
|---|---|
| Cloudflare-native, DO-centered, WebSocket-first 作为前置事实 | ✅ 完全复述 README §1/§3 |
| "fake-bash-as-compatibility-surface, typed capability runtime, layered context" | ✅ 直接引用 README §1 最后一段 |
| "skeleton-complete, not deployment-complete" | ✅ 直接继承 plan-after-nacp §9.2 的结论 |
| Phase 2（Session Edge Closure）优先 | ✅ plan-after-nacp §8.3 就把 Session Edge 列为下一阶段 Workstream 1 |
| Phase 5（Capability Governance）放在后面 | ✅ plan-after-nacp §8.2.4 同样把它作为"长期治理" |
| "registry / DDL decision"挪到下一阶段 | ✅ plan-after-nacp §8.2.5 明确"这仍然不应该是下一阶段的起点" |
| 不提前冻结 product API | ✅ README §1/§6 语境下合理 |

### 1.2 对齐存在张力的部分

#### 1.2.1 ⚠️ 多轮 follow-up input family 的归属错位（**必须用户决策**）

- README.md §6 Todo Notes 第一条（行 231）**直接点名**:
  > "**Add a formal follow-up input family right after MVP** so multi-turn conversations become protocol-native instead of being blocked behind the current first-turn-only `session.start.initial_input` entry."
- `plan-after-skeleton.md` §3.2.C.9 把 "richer session message family v2" 列为 **Out-of-Scope**，转入下一阶段。
- 代码事实验证：`packages/nacp-session/src/messages.ts` 只有 6 个 message families（`session.start` / `session.resume` / `session.cancel` / `session.end` / `session.stream.ack` / `session.heartbeat`），**确实没有 follow-up input 家族**。

**这是本 plan 与 README vision 的一个明确矛盾**。需要你的决策：
- **选项 A**：按 README Todo 执行，把 follow-up input family 纳入 Phase 0 的"NACP Contract Freeze"（它是协议级扩展，符合 Phase 0 的本色），plan 的 §3.2.C.9 应删除/改写。
- **选项 B**：更新 README §6 的 Todo Notes，明确多轮扩展"be moved to post-runtime-closure phase"。
- **我倾向选项 A**：协议加一个 `session.continue` / `session.followup_input` family 并不需要 runtime closure 做前置；延后会让下一阶段的 API 设计失去协议抓手。

#### 1.2.2 ⚠️ `trace_uuid` vs `trace_id` 的命名漂移（**必须用户决策**）

- 代码事实：
  - `packages/nacp-core/src/envelope.ts:114-121` 的 `NacpTraceSchema` 字段叫 `trace_id`（required UUID），**不叫 `trace_uuid`**。
  - 全仓唯一出现 `trace_uuid` 的地方是 `packages/nacp-core/src/observability/envelope.ts:15` 的 `NacpAlertPayloadSchema`——而且是 optional。
  - 运行时代码里读/写 `trace_uuid` 的路径 = 0 个。
- plan-after-skeleton.md 全文（§2.3 / §5.2 / §5.3 / §7.2）一律用 `trace_uuid` 作 canonical 名，并自己在 §3.1.A.4 承认"当前 `trace_id / trace_uuid` 存在命名漂移"。
- 但 plan **没明说这是"rename `trace_id` → `trace_uuid`"还是"用 `trace_uuid` 作为新的 operational name, `trace_id` 作 schema 兼容字段"**。

**需要决策**：
- **选项 A（rename）**：把核心 envelope 的 `trace_id` 改名为 `trace_uuid`，contract tests 全改。这是 breaking change，但名称更精确（它的确是 UUID）。
- **选项 B（keep `trace_id`）**：plan 全文把 `trace_uuid` 替换回 `trace_id`，`NacpAlertPayloadSchema` 里的 `trace_uuid` 字段也改成 `trace_id`。
- **选项 C（别名共存）**：两者都保留，新规则只要求"有其中一个"。这是最兼容但最容易出新 drift 的路径。
- **我倾向选项 B**：`trace_id` 已经是 repo truth, 15 个 root contract test 都用这个名字; 强行 rename 不带来技术收益。plan 里只需要改一个词。

#### 1.2.3 ⚠️ "冻结"与"下一阶段 API design"的协调

- plan-after-skeleton §3.2.A 把"richer session API v2 / 产品级公共接口设计"全部挪到下一阶段。
- 但 plan §11 同时承诺"下一阶段第一 workstream 应明确为 API & Data Model Design"。
- **问题**：如果 Phase 0 的 contract freeze 把**"internal worker boundary"与"external client API"都冻结了**，下一阶段 API design 会不会变成"在已冻结的 contract 之上贴一层薄皮"？
- **建议**：plan §3.1.A 应该**更精确地区分 "internal contract freeze"（必须做）vs "external public API contract"（延后）**；目前这层区别没写清。

### 1.3 结论

> plan 总体与 README vision 对齐，但在 **follow-up input family 的时间点** 和 **trace 命名** 上必须先和用户对齐；这两个是会影响 Phase 0 scope 定义的 **必须先澄清的前置决策**。

---

## 2. 基于代码事实的可执行性分析

> 方法论：以 plan 中的 Phase 0-5 声明为靶，spot-check `packages/` 当前状态是否支撑 plan 描述的 "起点"。

### 2.1 Phase 0（Contract Freeze）—— **地基已成立，但仍有具体未对齐点**

- ✅ `nacp-core` envelope（header / authority / trace / control / refs / body / extra）已存在且被 15 个 root contract test 锁定。
- ✅ `nacp-session` edge 的 6 个 client message family 与 9 个 stream event kind 已成立。
- ⚠️ `trace_uuid` vs `trace_id`：见 §1.2.2。
- ⚠️ "internal worker boundary contract"（provider / capability / hook）**尚未有统一的 freeze 面**：
  - `capability-runtime` 有 `ServiceBindingTransport` seam（但 0 个真实 service binding 用到）
  - `llm-wrapper` 有 provider registry（但 provider 侧是 fake-llm）
  - `hooks` 有 dispatcher（但 `service-binding` transport 还是 stub）
  - plan §7.1 把这三个列为"本 Phase In-Scope"是对的，但实际要做的"冻结"需要先设计**一个统一的 worker-boundary contract shape**——plan 没给这个 shape 的草图。

### 2.2 Phase 1（Trace-first Observability）—— **greenfield 比 plan 承认的更多**

- ❌ D1 wiring：全仓 **0 处真实 D1 依赖 / 0 处 D1Database 用法**。plan §7.2 的"D1 schema（仅 observability 最小面）"是从 0 开始的，不是 instrument existing infra。
- ❌ `trace_uuid` 运行时消费：目前**没有任何 package 在运行时 emit / propagate / validate `trace_uuid`**。Phase 1 要做的是**把每一条 hop 都打上 trace 标**——工作面比 plan 描述的要宽。
- ⚠️ "recovery path with anchor-based reconstruction" 要求 `message_uuid` / `request_uuid` / `reply_to` / `parent_message_uuid` 这些字段在运行时能被捕获——但当前 `nacp-core` envelope 的 control 层里并非全部字段都 required 且被消费。
- ✅ `eval-observability` 已有 trace taxonomy / timeline / inspector / replay helpers，作为 infrastructure upgrade 的起点是稳固的。

### 2.3 Phase 2（Session Edge Closure）—— **helper 已存在，ingress 切换成本低**

- ✅ `nacp-session` 已经 export `normalizeClientFrame`（`packages/nacp-session/src/index.ts:50` / `ingress.ts`）。
- ❌ `packages/session-do-runtime/src/do/nano-session-do.ts:215-257` 仍然是 raw `JSON.parse` + `switch (messageType)`。
- 📝 这就是 2nd-round 我主动 scope-down 的 session-do R1 —— plan Phase 2 把它拉回 in-scope 是**正确的**。
- ✅ `WsController` / `HttpController` 已有骨架但确实是 stub-level glue，Phase 2 要做的是给它们 wire 到 orchestrator。

### 2.4 Phase 3（External Seam Closure）—— **纯 greenfield**

- ❌ 全仓 **0 处真实 `env.X.fetch(...)` 模式**——所有 service-binding 都是 test doubles。
- Phase 3 要做的"fake provider worker / fake capability worker / fake hook worker"**都是新 workers**，不是现有 worker 升级。
- 这一点 plan §7.4 其实承认（"从 in-process 组合推进到真实 worker boundary"），但工作量级需要用户明确预期。

### 2.5 Phase 4 / Phase 5 —— **scope 合理，但和 Phase 2/3 有隐含依赖**

- Phase 4（Storage & Context Evidence）需要有一条真实运行时路径才能产生 evidence；plan 说依赖 Phase 0-3 是对的。
- Phase 5（Minimal Bash Completion）的 5 个命令（`grep` / file/search / `curl` / `ts-js` / `git subset`）每一个都是独立 track，合并成一个 Phase 可能造成 Phase 5 超时。

### 2.6 代码事实验证小结

plan 自己说"已具备 8 个 skeleton packages、15 个 root contract tests、14 个跨包 E2E"作为前置——**这是准确的**。但：
- plan 在 Phase 1 / Phase 3 **默认 D1 与 service-binding 基础设施已部分就位，而实际上它们都是 0**
- plan 在 Phase 0 **默认协议名已统一，而 `trace_id/trace_uuid` 的命名未统一**

---

## 3. 需要与用户沟通确认的关键决策点

以下 3 个问题必须在 Phase 0 启动前明确，否则 plan 不能当作可执行 charter：

### 3.1 `trace_id` 还是 `trace_uuid`？（命名统一方向）

**我的建议**：**用 `trace_id`**，不搞 rename。理由：
1. `trace_id` 已是 15 个 contract test 的锁定事实。
2. 其他业界实践（OpenTelemetry）里 `trace_id` 也是 canonical 名。
3. `NacpAlertPayloadSchema` 里那个 optional `trace_uuid` 字段应该 rename 为 `trace_id`，消除 drift 方向就此锁定。
4. plan 里把所有 `trace_uuid` 替换回 `trace_id` 即可，不影响任何其他决策。

### 3.2 follow-up input family 在 Phase 0 还是下一阶段？

**我的建议**：**放在 Phase 0 的 NACP Contract Freeze**。理由：
1. README §6 Todo Notes 第一条是**你已经签字的优先级**，plan 不应单方面推翻。
2. 这是纯协议层扩展，不需要 runtime closure 做前置。
3. 如果 Phase 0 要做"最大已知冻结"，follow-up 输入是 MVP 之后最明显的 known surface。
4. 如果延后，下一阶段 API design 会被迫**围绕一个不支持多轮的协议设计 API**，只会造成更大返工。

### 3.3 D1 作为 trace anchor infra 是否合适？是否有其他候选？

**背景**：plan §5.4 直接宣布"D1 trace anchor"。但 D1 是 relational store，写入延迟 / schema migration cost / Workers binding overhead 都要评估。
- **候选方案 A**：D1（plan 当前假设）—— SQL schema、关系查询强、但需要 schema migration
- **候选方案 B**：DO storage（append-only log）—— 已经有 wiring，读路径 O(1) by key
- **候选方案 C**：R2 + KV index（audit log + index）—— 类似 eval-observability 现有模式
- **我的倾向**：先**不要在 plan 层把 D1 写死**，而是在 Phase 1 之前做一个**"trace persistence substrate decision"的 1-week investigation**，产出一份 decision memo 再锁。

---

## 4. Phase 排布的 best-practice 分析

### 4.1 plan 当前的 DAG

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6
```

完全线性，wall-clock 最长。

### 4.2 我认为可以更优的 DAG

```
Phase 0 (Contract Freeze) ────┬──→ Phase 1 (Trace/Observability Law)
                               │
                               └──→ Phase 2 (Session Edge Closure) ────┐
                                                                        │
                                    Phase 1 ─────────────────────┐     │
                                                                  │     │
                                                                  ▼     ▼
                                                Phase 3 (External Seams) ────┐
                                                                              │
                                                        Phase 4 (Storage Evidence)
                                                                              │
                                                        Phase 5 (Bash Governance, 可与 Phase 4 并行)
                                                                              │
                                                                         Phase 6
```

### 4.3 关键差异

| 依赖关系 | plan | 我的建议 | 理由 |
|---|---|---|---|
| Phase 0 → Phase 1 | 严格串行 | **可并行（共用 design phase）** | Phase 0 的 envelope freeze 和 Phase 1 的 observability event base 是同一类 contract 工作，可以合并成 design batch |
| Phase 1 → Phase 2 | 严格串行 | **可并行启动，Phase 2 在 close 时依赖 Phase 1 的 trace law** | Session Edge 的 helper 切换不需要等 trace law 完成就能开始 |
| Phase 2 → Phase 3 | 严格串行 | **串行（保留）** | external seam 需要 session edge 稳定 |
| Phase 3 → Phase 4 | 严格串行 | **串行（保留）** | storage evidence 需要真实 runtime path |
| Phase 4 → Phase 5 | 严格串行 | **Phase 4 与 Phase 5 可并行** | bash governance 不依赖 storage evidence |

### 4.4 Phase 粒度建议

- **Phase 5（Minimal Bash Completion）太大**：把它拆成 5a（grep + file/search consistency）+ 5b（curl 边界治理）+ 5c（ts-js / git subset）更现实。不然 Phase 5 会变成 open-ended。
- **Phase 6（Closure & Handoff）不应占 phase 位**：它更像 "每个 Phase 收口时都要产出 closure note"，作为 ritual 存在即可。单列为 Phase 有"为了凑个完整 phase 而塞文档活"的嫌疑。

---

## 5. plan 未覆盖或需要补充的工作

### 5.1 缺失 A：Deployment-shaped verification phase

plan §10 提到"deployment-shaped tests"作为测试策略的一层，但**没有任何 Phase 以 "实际部署到 Cloudflare 并 E2E 验证" 作为 closure criteria**。"deployment-shaped" 目前在仓内仍然是**in-process 模拟**，不是 wrangler dev / wrangler deploy 跑起来的真实环境。

建议：
- 在 Phase 3（External Seams）的 closure criteria 里增加一条"至少一条链路在 `wrangler dev` 下跑通并能捕获真实 trace"
- 或者新增一个 Phase 3.5：**Deployment Dry-Run**，在进入 Phase 4 之前先做一次 deploy verification

### 5.2 缺失 B：Contract migration / versioning policy

plan §4 提出 "Maximal Known-Surface Contract" 原则是好的，但**如果 freeze 后发现需要改 contract 怎么办**？
- 版本号策略？
- deprecation 窗口？
- 契约测试的兼容层？

plan 仅在 Phase 0 deliverable 里写了一句"drift / migration rules"，没给具体 shape。建议在 Phase 0 早期先产出一份 **`nacp-versioning-policy.md`** 作为 freeze 的兜底。

### 5.3 缺失 C：Real LLM provider integration

plan Phase 3 提到"Fake Provider Worker"，但**没有任何 phase 涉及接真实的 Claude / OpenAI API**。这是 nano-agent 最终产品形态的核心 capability。
- 如果是下一阶段 in-scope，plan §11 应该明说
- 如果是更远期，应该说明"直到何时才接真 provider"
- 否则 Phase 3 close 时仍然是 "fake provider + fake capability + fake hook"，三个 fake 并列但没有 real 代表

### 5.4 缺失 D：Chaos / failure injection testing

plan §10.1 列出 4 层测试但**没有 chaos test 层**：DO hibernation mid-turn、D1 unavailability、WebSocket abort on flush、Service binding timeout 这些场景对 trace recovery law 尤其关键。

建议：Phase 1 closure criteria 加一条"trace recovery path 必须经过至少一次 chaos injection 验证"。

### 5.5 缺失 E：Performance budget

plan 不涉及性能预算。V8 isolate + WebSocket 的 cold start + DO activation 都有严格时间窗口。至少 Phase 2（Session Edge）收口时应该有一个 hot-path latency baseline。

---

## 6. 逐 Phase 详细意见

### 6.1 Phase 0 — NACP Contract Freeze

- **scope 是对的**，但要**先决定 3.1 / 3.2 两个决策点**才能真正启动。
- deliverable 里的 "contract matrix" 非常必要——应该是一张表，把每一个 wire body shape 映射到"已冻结 / 可变 / 实验"三档。
- "drift / migration rules" 应独立成 memo（见 §5.2）。

### 6.2 Phase 1 — Trace-first Observability Foundation

- **三层 observability（Anchor / Durable Business Flow / Verbose Diagnostic）模型很好**，建议写成独立的 `observability-layering.md` 供 reviewer 参考。
- **D1 承诺需要先有 substrate decision memo**（见 §3.3）。
- **trace_uuid law 的严格度可以更精细**：plan 说"系统接纳后的内部消息无 trace_uuid 即非法"——但 fake bash / hook loop 里的每一条 intermediate event 都要吗？应该给一个"enforce at boundary" vs "enforce at every hop"的梯度选择。
- **recovery failure 的 quarantine path 需要设计**：plan 说"不允许正常业务流静默继续"，但具体是 abort turn / fallback ingest / dead-letter queue 没定。

### 6.3 Phase 2 — Session Edge Closure

- **直接对齐了 2nd-round scope-down 的 session-do R1 + R3，我完全同意**。
- deliverable 应该明确："ingress go through `nacp-session.normalizeClientFrame`" 作为 closure criterion，不能只停留在"controller 不再是 stub"这种主观判断。
- 建议加一条：**reconnect + replay 要能在 WS 断线 3s 内 resume**——这对前端体验很重要。

### 6.4 Phase 3 — External Seam Closure

- **scope 是对的**（fake provider / capability / hook worker）。
- 但如 §5.3 所说，这一 Phase 结束时仍然 0 个真 provider。
- 建议：Phase 3 closure criteria 增加"至少跑一次 Claude API（real）的 trace-preserving call"作为真实性证据。

### 6.5 Phase 4 — Storage & Context Evidence Closure

- scope 合理。
- 但 "DO / KV / R2 adapters" 不应该只做 stub adapters——最终要在 Phase 4 结束时**有一次真 R2 put/get 的 integration test**。

### 6.6 Phase 5 — Capability Governance & Minimal Bash

- **太大，建议拆成 5a/5b/5c**（见 §4.4）。
- "unsupported contract" 的 artifact 应该是一份 **`capability-inventory.md`**（supported / deferred / risky 三档），plan 里没明说要产出这份 document。

### 6.7 Phase 6 — Closure & Handoff

- 可以**降级为"每个 Phase 都要写 closure note"的 ritual**，不占 phase 位。
- 节省出来的位置可以给 Phase 3.5（deployment dry-run）或 Phase 4.5（real provider integration）。

---

## 7. 最终 Verdict 与 Recommendations

### 7.1 对 plan 的最终 verdict

- **方向**：`approve`
- **内容充分性**：`approve-with-followups` —— 3 个命题必须先决策才能启动 Phase 0
- **phase 排布 best-practice 符合度**：`partially-aligned` —— 线性 DAG 可以更优

### 7.2 可以直接采纳的部分（占 plan 约 75%）

- 6 大成果项（§2.3）
- "Maximal Known-Surface Contract" 方法论
- "observability as runtime law" 的提升
- Phase 0-5 的主题定义
- 测试四层结构（§10.1）
- Each-phase Start/Build/Closure Gate ritual（§9.3）

### 7.3 必须先解决才能开工的部分（占 plan 约 15%）

> 这 3 个决策点必须先和用户对齐：

1. **§3.1** —— `trace_id` vs `trace_uuid`：我推荐 `trace_id`
2. **§3.2** —— follow-up input family 在 Phase 0 还是下一阶段：我推荐 Phase 0
3. **§3.3** —— D1 作为 trace anchor substrate：建议先做 substrate decision investigation

### 7.4 需要改写但不影响整体方向的部分（占 plan 约 10%）

- Phase 5 拆成 5a/5b/5c
- Phase 6 降级为 ritual
- DAG 从线性改为部分并行（Phase 0‖Phase 1，Phase 4‖Phase 5）
- 增加 Phase 3.5（Deployment Dry-run）
- 增加 §5 列出的 5 个缺失项

### 7.5 推荐的下一步

| 步骤 | 动作 | 产出 |
|---|---|---|
| 1 | 用户就 §3.1 / §3.2 / §3.3 三个决策点给明确答案 | 3 条 user decision record |
| 2 | 基于决策更新 plan-after-skeleton.md 为 v2 | plan v2 |
| 3 | 新增 `nacp-versioning-policy.md`、`trace-substrate-decision.md` | 2 份 memo |
| 4 | 按 v2 plan 启动 Phase 0 前写 Phase 0 design artifact | Phase 0 design |
| 5 | 正式进入 Phase 0 execution | — |

### 7.6 一句话收尾

> plan 的**战略框架是对的、优先级是对的、scope 边界是对的**——它把"先冻结 contract、把 observability 升级为 runtime law、再做 runtime closure"这条 sequencing 写清楚了，比旧版高出一个档次。但它**在 3 个命题上还没对齐代码事实或 README 承诺**；这 3 条不解决，Phase 0 开工就会带着未定义的前提跑。**改好这 3 条，加上部分并行化的 DAG 调整，plan 就能作为下一阶段的正式 charter 使用。**

---

## 附录 A：代码事实 spot-check 摘要

| 命题 | plan 的假设 | 代码现实 | 差距 |
|---|---|---|---|
| `trace_uuid` 是 canonical name | 是 | `trace_id`（required UUID in `NacpTraceSchema`） | 命名未统一 |
| 多轮 input family 已延后 | 在 Out-of-Scope | 确实不存在，但 README §6 Todo 说要做 | README 承诺冲突 |
| D1 可作为 trace anchor | 默认存在 | 0 处 D1 wiring / 0 个 package 依赖 | 100% greenfield |
| `normalizeClientFrame` 切换 | 可行 | nacp-session 已 export，session-do 未调用 | 切换成本低 ✅ |
| real service binding | 默认存在 | 0 处 `env.*.fetch(` pattern | 100% greenfield |
| `eval-observability` 作为 infrastructure | 已成立 | 已有 taxonomy / timeline / inspector / replay | 可以升级 ✅ |
