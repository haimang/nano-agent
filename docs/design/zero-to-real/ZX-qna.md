# Zero-to-Real — ZX QNA

> 范围：`zero-to-real / Z0-Z4`
> 目的：把会影响后续 `docs/design/zero-to-real/*.md`、`docs/action-plan/zero-to-real/*.md` 与 Z0-Z4 closure 的业主 / 架构师决策收敛到一份单一清单，避免在多个文档中重复回答、重复漂移、重复改口。
> 状态：`draft answer register (questions collected; waiting owner answers)`
> 使用方式：
> 1. **业主只在本文件填写回答。**
> 2. 其他 design / action-plan / memo 若引用某个 `Q` 编号，默认都以本文件为唯一答复来源。
> 3. 各具体文档不再逐条填写 QNA；如仍保留“已确认 / 已冻结”的历史表述，应理解为上下文说明，后续统一以本文件回填结果为准。
> 4. `Q` 编号应保持稳定；后续若补题，从最后一个编号继续追加。
>
> 📝 **注**：
> - 本文件使用 `docs/templates/qna.md` 的完整版格式。
> - 当前建议以 `docs/charter/plan-zero-to-real.md` 与本轮 design 初稿为基础。

---

## 1. Auth / Boundary / RPC

### Q1 — `orchestration.auth` 的 exact transport form，是否直接冻结为 WorkerEntrypoint RPC-first？（来源：`ZX-binding-boundary-and-rpc-rollout.md`、`Z1-full-auth-and-tenant-foundation.md`）

- **影响范围**：`workers/orchestration-auth/**`、`workers/orchestrator-core/**`、Z1 tests、后续 auth pure-RPC boundary proof
- **为什么必须确认**：虽然 charter 已冻结 `orchestration.auth = internal-only + single caller + no public route`，但 exact transport 仍影响 Z1 的实现路线。如果不拍板，Z1 会在 WorkerEntrypoint RPC 与 fetch-binding shim 之间摇摆。
- **当前建议 / 倾向**：**优先冻结为 WorkerEntrypoint RPC-first；仅在 Cloudflare 实际限制阻塞时，退回 fetch-binding shim 作为过渡实现。**
- **Reasoning**：这个问题出现，是因为 repo 当前真正跑着的 internal control-plane 仍偏 fetch-backed，而 `nacp-core` 已经有 service-binding / DO RPC transport primitives。推荐 WorkerEntrypoint RPC-first，更符合 zero-to-real 对“internal boundary 是主线之一”的要求；如果不拍板，Z1 极可能把 auth 先做成 fetch shim，然后长期拖着不切。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`Z1 是否确认把 orchestration.auth 的 exact transport 冻结为 WorkerEntrypoint RPC-first？若不同意，请明确是接受 fetch-binding shim 作为 Z1 baseline，还是要改成其它 internal transport。`
- **业主回答**：

### Q2 — JWT signing / verification / rotation 的 first-wave 纪律，是否采用“单签发 key + 双验证窗口”？（来源：`ZX-nacp-realization-track.md`、`Z1-full-auth-and-tenant-foundation.md`）

- **影响范围**：`orchestration.auth` JWT mint、`orchestration.core` verify、secret rotation playbook、Z1 closure
- **为什么必须确认**：auth worker 与 orchestrator 需要共享 token truth；如果 rotation 策略不冻结，Z1 只能写死“一个 secret 永久不动”或引入过度复杂方案。
- **当前建议 / 倾向**：**采用 HS256 单签发 key + 双验证窗口。** 即 auth worker 仅用 active key 签发；orchestrator 在 rotation 窗口内同时接受 old/new 验证，待旧 token 自然过期后删除旧 key。
- **Reasoning**：这个问题出现，是因为 zero-to-real 需要真实 JWT，而真实 JWT 一旦进入生产路径就必须考虑 rotation。推荐路线足够简单，也与当前 repo 的轻量 auth reality 匹配；如果不拍板，Z1 可能先做出无法平滑轮换的 token 方案，后续再返工。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`Z1 的 JWT secret 纪律，是否确认采用“单签发 key + 双验证窗口”的最小 rotation 方案？`
- **业主回答**：

### Q3 — WeChat 首次登录时，是否确认“自动建 user + default team + membership”作为 first-wave baseline？（来源：`Z1-full-auth-and-tenant-foundation.md`、`ZX-d1-schema-and-migrations.md`）

- **影响范围**：WeChat bridge、identity core、team membership、Mini Program 首次 onboarding
- **为什么必须确认**：WeChat bridge 真正难的不是拿 `openid`，而是首次登录后系统要不要自动完成租户落地。如果不拍板，Z1 会卡在“登录成功但没有 tenant truth”。
- **当前建议 / 倾向**：**确认自动建 user + default team + owner-level membership。**
- **Reasoning**：这个问题出现，是因为 zero-to-real 明确需要 real WeChat login + multi-tenant day-1，而不是只拿到一个外部 identity 就结束。推荐自动建 default team，因为这是 first real run 成本最低、最可持续验证的路径；如果不拍板，Mini Program 首次登录会变成半成品体验。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`WeChat 第一次登录成功后，是否确认自动创建 user/default team/default membership？如果不同意，请明确需要 invited binding 还是其它 onboarding 流。`
- **业主回答**：

### Q4 — 最小 API key verify 运行时路径，是否只有在 server-to-server ingress 启用时才进入 Z1？（来源：`Z1-full-auth-and-tenant-foundation.md`、`ZX-binding-boundary-and-rpc-rollout.md`）

- **影响范围**：`orchestration.auth`、server-to-server ingress、Z1 scope 控制
- **为什么必须确认**：charter 已明确“完整 API key admin plane out-of-scope，但最小 verify path 可在 Z1”。是否真的要进 Z1，需要 owner 拍板，否则 scope 可能继续膨胀。
- **当前建议 / 倾向**：**只有当 zero-to-real 确定会启用 server-to-server ingress 时，才把 minimal API key verify 放进 Z1；否则保持 schema reserved，不抢跑实现。**
- **Reasoning**：这个问题出现，是因为 API key 很容易从“最小 verify”膨胀成半个 admin plane。当前推荐路线更稳：仅当它真服务 first real run 时才实现；如果不拍板，Z1 容易被不必要的 control-plane richness 稀释。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`本阶段是否确实需要 server-to-server API key verify 路径？如果不需要，是否同意把它降为“schema 预留 + action-plan defer”？`
- **业主回答**：

---

## 2. Schema / Session / Hot State

### Q5 — `nano_session_activity_logs` 的 first-wave 形态，是否确认采用“单 append-only 表 + 必要 views/query helpers”？（来源：`ZX-d1-schema-and-migrations.md`、`ZX-nacp-realization-track.md`、`Z2-session-truth-and-audit-baseline.md`）

- **影响范围**：Z2 D1 migrations、activity/audit readback、trace linkage、后续 closure/eval
- **为什么必须确认**：这张表没有现成祖宗结构可照抄；如果不拍板，Z2 会在“单表先行”与“拆 activity/audit 两组表”之间来回摆。
- **当前建议 / 倾向**：**先采用单 append-only 表，按 `team_uuid + conversation_uuid/session_uuid/turn_uuid + trace_uuid + event_kind + payload + created_at` 组织，再用 views 或 query helpers 派生 read model。**
- **Reasoning**：这个问题出现，是因为 zero-to-real 需要可审计、可回看，但又没有 full BI/reporting 目标。单表 + views 是最克制也最实用的方案；如果不拍板，Z2 很可能会把审计层做得过重，或者相反做得太散。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`Z2 是否确认把 nano_session_activity_logs 做成单 append-only 表 + 必要 views/query helpers 的 baseline？`
- **业主回答**：

### Q6 — `orchestration.core` 的 DO SQLite hot-state 最低集合，应冻结到什么粒度？（来源：`ZX-d1-schema-and-migrations.md`、`Z2-session-truth-and-audit-baseline.md`）

- **影响范围**：`workers/orchestrator-core/src/user-do.ts` stateful uplift、history/reconnect/timeline 热路径、Z2 closure
- **为什么必须确认**：charter 已要求 Z2 纳入 DO SQLite / Alarm / conversation 聚合最低集合，但“最低集合”还不够精确。如果不拍板，Z2 容易一边过度设计，一边又拿不出 closure 标准。
- **当前建议 / 倾向**：**冻结为 4 组热态：conversation index、active conversation/session 指针、recent timeline cursor / reconnect hint、短时 secret/profile cache。**
- **Reasoning**：这个问题出现，是因为 zero-to-real 既不能把所有 truth 都塞进 D1 冷读，也不能把 user-level 状态无限膨胀在 DO SQLite。当前建议正好覆盖 history/reconnect/real client 最常用热路径；如果不拍板，Z2 的 “stateful uplift” 很容易变成模糊口号。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`Z2 的 DO SQLite hot-state，是否确认冻结为“conversation index + active pointers + reconnect/timeline hints + short-lived caches”四组最小集合？`
- **业主回答**：

### Q7 — Z2 第一条 dual-implemented control-plane 方法，是否直接选择 `start`？（来源：`ZX-binding-boundary-and-rpc-rollout.md`、`Z2-session-truth-and-audit-baseline.md`）

- **影响范围**：`orchestration.core -> agent.core` RPC scaffold、Z2 parity proof、后续 rollout 顺序
- **为什么必须确认**：charter 要求 Z2 至少有 1 条主方法双实现可用，但具体是哪条仍未冻结。如果不拍板，Z2 容易把“任意一条”做成形式主义证明。
- **当前建议 / 倾向**：**直接选择 `start` 作为第一条 dual-implemented 方法。**
- **Reasoning**：这个问题出现，是因为 `start` 是 session 生命周期与持久化链路的起点，最能证明 control-plane RPC 真的接进主路径。若不拍板，团队可能选一条相对边缘的方法完成“最低指标”，却无法证明真实价值。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`Z2 的首条 dual-implemented control-plane 方法，是否确认直接用 start？如果不同意，请明确替代方法。`
- **业主回答**：

---

## 3. Runtime / Provider / Client

### Q8 — DeepSeek 在 zero-to-real 中的角色，是否只保留为“optional adapter skeleton / fallback track”，而不进入 required provider baseline？（来源：`ZX-llm-adapter-and-secrets.md`、`Z3-real-runtime-and-quota.md`）

- **影响范围**：provider 策略、tenant secret 表、Z3 scope、secret engineering
- **为什么必须确认**：charter 已明确 Workers AI first，但 design 仍需防止 Z3 scope 因 DeepSeek secret/rotation/cache 扩大。
- **当前建议 / 倾向**：**确认 DeepSeek 只做 optional adapter skeleton / fallback track；required provider baseline 只有 Workers AI。**
- **Reasoning**：这个问题出现，是因为 owner 同时关心真实 provider 与未来灵活性。当前建议最稳：先把 fake provider 从主路径拿掉，再把 BYO-key / fallback 作为后续可控增量；如果不拍板，Z3 会同时背上 provider + secret engineering 两层复杂度。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`Z3 是否确认“Workers AI 是唯一 required provider，DeepSeek 只保留 optional adapter skeleton / fallback track”？`
- **业主回答**：

### Q9 — quota deny 的 first-wave 语义，是否覆盖“所有 llm/tool side-effects 前 gate”而不是只拦 tool？（来源：`ZX-nacp-realization-track.md`、`Z3-real-runtime-and-quota.md`）

- **影响范围**：`beforeCapabilityExecute` 扩展、LLM invoke gate、usage events、quota balances、trace evidence
- **为什么必须确认**：当前 repo 已有 `beforeCapabilityExecute` seam，但 charter 要求 quota 成为 runtime truth。是否只拦 tool 或连 llm/start 也拦，会直接改变 Z3 的设计面。
- **当前建议 / 倾向**：**覆盖所有会产生资源消耗或副作用的 llm/tool path；client start 仅做轻量 admission，不做无上限旁路。**
- **Reasoning**：这个问题出现，是因为 repo 现状最现成的是 capability hook，而 owner 明确不希望 quota 只是“摆设”。推荐把 llm/tool 都纳入 gate，因为否则 real run 的资源控制会出现最大漏洞；如果不拍板，Z3 很可能只做“工具前拦截”，却让 LLM 成为真实绕行面。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`Z3 的 quota deny，是否确认覆盖 llm/tool 两类实际消耗路径，而不是只拦 tool？`
- **业主回答**：

### Q10 — Mini Program 的 first real run transport baseline，是否接受“HTTP start/input + WS stream/history”作为 first-wave，而不是要求 day-1 纯 WS 双向全闭合？（来源：`ZX-binding-boundary-and-rpc-rollout.md`、`Z4-real-clients-and-first-real-run.md`）

- **影响范围**：Mini Program 客户端、Z4 scope、双向 WS 延后 stateful 工作的排序
- **为什么必须确认**：charter 把双向 WS message handling 放在 Z4 in-scope，但 Z4 同时还承接 WeChat login、history、gap triage。如果不拍板最小 transport baseline，Z4 容易因为追求 full WS purity 而延误 first real run。
- **当前建议 / 倾向**：**接受 first-wave 以 HTTP `start/input` + WS stream/history 为 baseline；双向 WS message handling 仍在 Z4 做，但不作为 first proof 的前提。**
- **Reasoning**：这个问题出现，是因为 owner 既要真实 Mini Program，又要求系统尽快 first real run。当前建议更稳：先闭合真实链路，再把双向 WS 完整化作为 Z4 后半收敛项；如果不拍板，Z4 很容易把 transport purity 当成 real run 前置条件。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`Mini Program 的 first real run，是否接受“HTTP start/input + WS stream/history”作为 first-wave baseline？`
- **业主回答**：

---

## 4. 使用约束

### 4.1 哪些问题应该进入 QNA

- **会直接改变 contract surface、实现边界、执行顺序、验收标准或支持面披露的问题**
- **需要业主 / 架构师拍板，而不是实现阶段自己就能收敛的技术细节**
- **如果不先拍板，就会导致多个后续文档一起漂移的问题**

### 4.2 哪些问题不应进入 QNA

- **实现细节微调**：例如内部模块命名、单个 migration 文件拆分
- **已有 frozen answer 的重复提问**：除非后续要正式推翻旧答案
- **只影响单个函数或单个包内部实现的问题**

### 4.3 `Reasoning` 的写法要求

- 写给第一次进入 zero-to-real 决策现场的业主
- 解释问题为什么出现、当前建议为什么稳、如果不拍板会怎样
- 明确推荐路线的 trade-off

### 4.4 `问题` 的写法要求

- 必须能让业主直接作答
- 不把多个独立决策捆成一题
- 若存在条件分支，要在问题里明确说明

### 4.5 `业主回答` 的使用要求

- 一旦填写，即成为 Z0-Z4 design/action-plan/review 的唯一口径
- 后续若要推翻，必须在本文件追加修订说明

---

## 5. 最小示例

### QX — `{EXAMPLE_QUESTION_TITLE}`（来源：`{EXAMPLE_SOURCE}`）

- **影响范围**：`{PACKAGE_A / DOC_B / PHASE_C}`
- **为什么必须确认**：`{EXAMPLE_WHY_CONFIRM}`
- **当前建议 / 倾向**：`{EXAMPLE_RECOMMENDATION}`
- **Reasoning**：`{EXAMPLE_REASONING_WRITTEN_FOR_OWNER}`

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`{EXAMPLE_OWNER_FACING_QUESTION}`
- **业主回答**：
