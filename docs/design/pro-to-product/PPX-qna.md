# Pro-to-Product — PPX QNA

> 范围：`pro-to-product / PP0-PP6`
> 目的：把会影响后续 `docs/design/pro-to-product/*.md`、`docs/action-plan/pro-to-product/*.md`、各 PP phase implementation gate 与 final closure 的业主 / 架构师决策收敛到一份单一清单，避免在多个文档中重复回答、重复漂移、重复改口。
> 状态：`reviewed — Q1-Q22 全部回填 (业主已基于 GPT/Opus 意见逐题拍板)`
> 使用方式：
> 1. **业主只在本文件填写回答。**
> 2. 其他 design / action-plan / memo 若引用某个 `Q` 编号，默认都以本文件为唯一答复来源。
> 3. 各具体文档中仍保留的 QNA / 冻结表述，应理解为设计阶段上下文说明；后续统一以本文件回填结果为准。
> 4. `Q` 编号应保持稳定；后续若补题，从最后一个编号继续追加。
>
> 📝 **注**：
> - 本文件使用 `docs/templates/qna.md` 的完整版格式。
> - 本文件中的“当前建议 / 倾向”来自 `docs/charter/plan-pro-to-product.md` 与 8 份 `docs/design/pro-to-product/*.md` 的既有结论，是当前默认口径，不等于最终业主回答。
> - 对于已经在 charter 中作为默认答案冻结的问题，若业主要推翻旧口径，应直接在对应 `业主回答` 中写出新决策，不要在其他文档侧写改口。

---

## 1. 基线治理 / 前端边界

### Q1 — `7 truth gates` 是否作为 pro-to-product 唯一 hard exit？（来源：`docs/charter/plan-pro-to-product.md` §10、`docs/design/pro-to-product/00-agent-loop-truth-model.md` D-00-1）

- **影响范围**：`PP0-PP6 closure`、`docs/issue/pro-to-product/*.md`、`docs/issue/pro-to-product/pro-to-product-final-closure.md`
- **为什么必须确认**：如果 7 条 truth gates 不是全阶段唯一硬闸，后续 phase 很容易又退回“代码存在即可 closure”的旧习惯，final closure 口径会重新发散。
- **当前建议 / 倾向**：**是。** 7 truth gates 作为本阶段唯一 hard exit。
- **Reasoning**：这个问题出现，是因为 pro-to-product 的目标不是继续堆功能，而是把已存在 substrate 接成前端可信的 live loop。把 7 truth gates 固定成唯一硬闸，能把“做了什么代码”与“前端是否真的可信”区分开；如果不拍板，后续每个 phase 都可能各自发明 closure 标准。

- **Opus的对问题的分解**：这题问的是闭合标准的"唯一性"——是否允许各 phase 在 7 truth gates 之外私设 phase exit law；不是问 truth gates 本身的设计是否合理。区分清楚后会发现 phase 内部仍可有 sub-gate（例如 PP1 自定"ask/elicitation/timeout 三态都有真实证据"），只要这些 sub-gate 都映射到 7 truth gates 之一。
- **Opus的对GPT推荐线路的分析**：GPT 推荐"是"，理由"避免每个 phase 各自发明 closure 标准"成立。但 GPT 的表述容易让 PP* owner 误解为"phase 内部不能有任何附加判据"——这与 charter §8.3 "每个 Phase 的 action-plan 与 closure 都必须以 truth gate 为对账单" 是一致的，但需要明确区分"phase 内可有 sub-gate（必须映射到 7 gate）"与"phase 不能新增独立 exit law"。
- **Opus的最终回答**：**同意 GPT 的"是"**，并补充：phase 内部允许有 sub-gate 但必须可被映射到 7 truth gates 之一，不能成为新的 exit law。如果某 phase 提出"我有一条本 phase 独立 exit"，就视为 charter amendment 请求，必须由 owner 在 PPX-qna 中正式拍板，而不是 phase 自己定义。

- **问题**：`是否确认 pro-to-product 的唯一硬闸就是 charter §10 定义的 7 条 truth gates，而不是再允许各 phase 各自追加一套平行 exit law？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

### Q2 — latency baseline 是否只作为 alert threshold，而不是 hard gate？（来源：`docs/charter/plan-pro-to-product.md` §9.2、`docs/design/pro-to-product/00-agent-loop-truth-model.md` D-00-2）

- **影响范围**：`PP1/PP3/PP5/PP6`、closure verdict、manual evidence 与 final closure 表述
- **为什么必须确认**：如果 latency baseline 被误当成独立硬闸，phase 可能因为体验抖动长期无法开始/无法 closure；反过来如果完全无纪律，又会把“前端可感知体验”从验证中删掉。
- **当前建议 / 倾向**：**否。** latency baseline 只作为 alert threshold，不单独构成 hard gate。
- **Reasoning**：这个问题出现，是因为 pro-to-product 既要强调 functional truth，也不能对前端体感完全失明。把它定为 alert threshold 最稳：既保留体验压力，也不让整个阶段被性能偶发波动绑架；如果不拍板，团队会在“功能先过”与“性能先过”之间反复摇摆。

- **Opus的对问题的分解**：这题问的是 latency 是否上升为独立 phase blocker。两端都有风险：升为 hard gate → phase 因体验抖动长期阻塞；完全不约束 → 前端可感知体验从验证中消失。中间路径就是 alert threshold + 登记纪律。
- **Opus的对GPT推荐线路的分析**：GPT 推荐"否，alert threshold"，理由 reasonable。但 GPT 的表述漏掉了一个关键纪律：alert threshold 持续超阈值时，必须在 final closure 中显式登记并由 owner 接受才能 close-with-known-issues，否则 latency 仍可能被静默吞掉。
- **Opus的最终回答**：**同意 GPT 的"否"**，并补强：latency baseline 作为 alert threshold 时，每条 phase closure 与 final closure 必须显式登记"超阈值次数 / 是否接受 / 复现条件"。如果 final closure 没登记任何 latency evidence，视为 docs gap，PP6 review 必须返工 — 这条登记纪律比 alert threshold 本身更重要，否则"非硬闸"会被滥用为"不用看"。

- **问题**：`是否确认本阶段 latency baseline 只作为 validation baseline / alert threshold，不作为独立 hard gate？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

### Q3 — 前端 contract 是否只依赖 `orchestrator-core facade`，而不直接依赖 internal RPC / worker seam？（来源：`docs/design/pro-to-product/01-frontend-trust-contract.md` D-01-1）

- **影响范围**：`clients/api-docs/**`、frontend integration、PP6 docs closure
- **为什么必须确认**：如果前端可绕过 facade 直接依赖内部 seam，后续文档范围、测试边界、closure 口径都会立刻失真。
- **当前建议 / 倾向**：**是。** 前端 contract 只依赖 `orchestrator-core` facade。
- **Reasoning**：这个问题出现，是因为 nano-agent 的内部 worker 之间已经有不少 transport / RPC seam，但这些都不是前端产品面。把 facade 固定为唯一 public owner，能确保 API docs、测试和 future frontend 都围绕同一层工作；如果不拍板，PP6 会被拉去为 internal-only seam 背书。

- **Opus的对问题的分解**：这题问的是 public boundary owner 是否冻结为 orchestrator-core facade。冻结后：客户端不可绕过 facade；facade 必须封装内部 worker seam；后续 worker refactor 不会变 breaking change。
- **Opus的对GPT推荐线路的分析**：GPT 推荐"是"，理由扎实。但 GPT 没强调一条隐性义务：facade-only 的代价是 facade 层必须承担更多 envelope/error/idempotency 责任。例如 ETag/If-Match 已加到 `/runtime`，但 PP5/PP6 还要逐一审 facade 是否把内部 worker 异常封装成 frontend-friendly contract（不能让 internal RPC error 直接 leak 给 client）。
- **Opus的最终回答**：**同意 GPT 的"是"**，并补强：冻结同时附带"facade 必须封装 internal worker 异常"的隐性义务。PP5 enforce matrix 与 PP6 docs sweep 必须包含一项"facade error envelope 完整性"审查 — 任何 internal worker 5xx / network failure / RPC timeout 都必须经 facade 转换为 documented `system.error` 或 HTTP error code，而不是 raw leak。这条义务在 06 design F3 已有萌芽（Reliability Error Contract），但 PP6 时必须强制执行。

- **问题**：`是否确认前端只依赖 orchestrator-core facade 暴露的 HTTP / WS contract，而不直接依赖 worker-to-worker internal seam？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

### Q4 — per-phase design 文档是否允许按 `just-in-time` 方式逐份冻结，而不是要求 PP0 先把全部设计一次性冻结？（来源：`docs/charter/plan-pro-to-product.md` §13.4、`docs/design/pro-to-product/01-frontend-trust-contract.md` D-01-3）

- **影响范围**：`PP0-PP6`、design production order、action-plan start gate
- **为什么必须确认**：如果要求全部设计在 PP0 一次性冻结，容易让后续设计在代码事实尚未稳定时写成大而空；如果完全不设 JIT 纪律，又会造成设计拖后于实现。
- **当前建议 / 倾向**：**是。** 允许 JIT 冻结，但每个 phase 开工前必须已有对应 design。
- **Reasoning**：这个问题出现，是因为 pro-to-product 的若干 gap 只有在前一阶段 truth 更稳定后才能写清。JIT 的好处是把设计尽量贴近真实代码与最新 precedent，同时仍然守住“无设计不开工”的纪律；如果不拍板，团队不是过早设计，就是设计被实现绕过。

- **Opus的对问题的分解**：这题问的是 design 与实现的时序关系 — 一次性冻结 vs 滚动冻结。两端都有缺陷：一次性 → 设计在代码事实未稳定时写大而空；完全滚动 → 设计被实现绕过。JIT 是中间路线，但需要纪律支撑。
- **Opus的对GPT推荐线路的分析**：GPT 推荐 JIT，reasoning OK。但 GPT 没解决一个隐性问题：JIT 模式下，PP6 sweep 时若发现 PP1-PP5 design 间冲突（例如 confirmation `decision_payload` 的 typing 跨 phase 漂移），是允许回头 amend design，还是只能在 closure 标 known issue？这个问题不答，JIT 会变成"先冻结的 design 永远不准 amend"。
- **Opus的最终回答**：**同意 JIT**，并附加一条：design JIT 冻结后，跨 phase 冲突仍允许 design amend（带版本号），不是只允许 closure 标 known issue。amend 必须在 PPX-qna 中登记或在 design 文档 §B 版本历史中显式记录"why amended after frozen"。否则 JIT 模式下早期 design 会变成"已冻结但事实漂移"的僵尸合同。

- **问题**：`是否确认 pro-to-product 采用 just-in-time design 冻结策略：不要求 PP0 先冻结全部 phase 设计，但每个 phase 开工前必须先有自己的 frozen design？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

### Q5 — PP6 的接口扫描是否只覆盖前端依赖的 public/frontend-facing surfaces，而不扩张到 internal RPC / worker-only seam？（来源：`docs/charter/plan-pro-to-product.md` §12 Q3、`docs/design/pro-to-product/00-agent-loop-truth-model.md` D-00-3、`01-frontend-trust-contract.md` D-01-2、`07-api-contract-docs-closure.md` D-07-1）

- **影响范围**：`PP6`、`clients/api-docs/**`、final closure 边界
- **为什么必须确认**：如果扫描范围不冻结，PP6 很容易从 docs closure 膨胀成第二轮全仓架构审计，直接失控。
- **当前建议 / 倾向**：**是。** 只扫描前端依赖的 public/frontend-facing surfaces。
- **Reasoning**：这个问题出现，是因为“把全部接口重新核对一遍”很容易被误解成“把所有内部 seam 也一起做文档化”。推荐路线更稳，因为 PP6 的价值在于把前端可直接依赖的 contract 收口，而不是把内部 worker 生态再做一遍考古；如果不拍板，PP6 会变成没有止境的扩张阶段。

- **Opus的对问题的分解**：这题问的是 PP6 sweep 范围。前端依赖的 public surface 是 PP6 主战场；internal RPC / worker binding 不是。中间灰区是 debug routes / inspector endpoints — 这些虽然是 facade GET，但前端可能直接消费。
- **Opus的对GPT推荐线路的分析**：GPT 推荐"是"，理由防止 PP6 膨胀成全仓审计，正确。GPT 没明确灰区判定细则 — design 07 §5.3 已写明 "debug routes if frontend inspector uses → in-scope"，建议 owner 答 yes 时同时确认这条灰区细则。
- **Opus的最终回答**：**同意 GPT 的"是"**，并补强：边界判定细则 — debug routes（worker-health / error-index）若被前端 inspector 使用，就属于 frontend-facing；service binding RPC 不论被谁调用都属于 internal。PP6 不能反向因"internal RPC 也涉及 trace_uuid"就把 service binding 写进 client docs。这条灰区细则在 07 design §5.3 已存在，确认即可。

- **问题**：`是否确认 PP6 只扫描前端依赖的 public/frontend-facing contract，不纳入 internal RPC / worker-only seam？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

---

## 2. HITL / Context / Recovery

### Q6 — `approval_policy=ask` 是否必须中断 turn，禁止继续返回 tool error？（来源：`docs/design/pro-to-product/02-hitl-interrupt-closure.md` D-02-1）

- **影响范围**：`PP1`、HITL runtime loop、frontend permission UX
- **为什么必须确认**：如果 ask 仍允许退化成 tool error，HITL 就仍是假闭环，PP1 的 phase 目标会直接落空。
- **当前建议 / 倾向**：**必须 interrupt。** 不允许继续返回 tool error 代替 pause-resume。
- **Reasoning**：这个问题出现，是因为当前 runtime 里 `ask` 还会落回错误路径，而不是进入等待用户决策的真实 loop。推荐路线更稳，因为它直接把“是否真的有 HITL”与“只是多了一个错误 code”分开；如果不拍板，前端会被迫用错误处理去伪装交互中断。

- **Opus的对问题的分解**：这题问的是 ask 的语义性质 — error 还是 interrupt。当前 `runtime-mainline.ts:252-260` 把 ask 翻译成 `tool-permission-required` error，前端只能显示 "失败"。改成 interrupt 后，前端能显示 "等待你确认"。这是性质性区别，不是 UI polish。
- **Opus的对GPT推荐线路的分析**：GPT 推荐"必须 interrupt"，正确。GPT 没强调 non-interactive / no-client 边界 — 这场景下不能伪 pending（前端不在线就没人能 decide），应走 timeout 或 explicit deny+reason。02 design F1 边界已 cover，PP1 closure e2e 必须验证。
- **Opus的最终回答**：**强烈同意"必须 interrupt"**。补充：non-interactive / no-client（含 cron / system-initiated turn）场景下不能伪 pending，必须显式走 timeout deny 或 explicit "no-decider-available" 错误。这条边界必须进 PP1 closure e2e 测试集 — 否则"interrupt-不-error" 这条法律会被边界条件 silent 击穿。PP1 e2e 至少需要：(a) interactive ask → pause-resume (b) timeout → terminal (c) no-client → explicit "no-decider" 三组用例。

- **问题**：`是否确认 approval_policy=ask 在 PP1 中必须变成真实 interrupt + pause-resume，而不能继续用 tool error 形态对前端兜底？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

### Q7 — confirmation decision 是否仍保持 `HTTP` 输入，而不改成 `WS` 输入？（来源：`docs/design/pro-to-product/02-hitl-interrupt-closure.md` D-02-2）

- **影响范围**：`PP1`、`PP6`、session-control API、frontend transport design
- **为什么必须确认**：如果输入通道在执行期摇摆，前端和 docs 会同时裂成两套口径。
- **当前建议 / 倾向**：**保持 HTTP。** WS 只负责广播状态，不承担 decision 输入。
- **Reasoning**：这个问题出现，是因为 confirmation loop 天然会让人想把“请求”和“回答”都塞进同一条 WS。保持 HTTP 更稳，因为现有路由、幂等和审计边界都已经围绕 row-first + HTTP decision 组织；如果不拍板，PP1 与 PP6 会同时改 transport 面。

- **Opus的对问题的分解**：这题问的是 decision 输入通道的 transport 选择。当前 direction matrix 已冻结 server-only WS confirmation frames，client→server WS 不承担 decision；HTTP POST decision 是已实现路径。
- **Opus的对GPT推荐线路的分析**：GPT 推荐"保持 HTTP"，正确。GPT 没强调 idempotency 纪律 — HTTP decision 路径必须 idempotent，重复提交同一 confirmation_uuid 必须返回 409 + terminal status 而非创建新 row。02 design F2 边界情况已 cover，PP1 e2e 必须显式覆盖 "duplicate decision submission → 409 + same terminal" 用例。
- **Opus的最终回答**：**同意 GPT 的"保持 HTTP"**，并附加 idempotency e2e 强约束。HTTP 路径下，重复提交同一 confirmation_uuid 必须由 server 返回 409 + 已有终态，而不是创建新 row 或 silent overwrite。PP1 closure e2e 必须包含此用例 — 这是协议层最容易被前端 retry 撞到的边界。

- **问题**：`是否确认 confirmation 的 decision 输入继续走 HTTP，而不是在 PP1/PP6 改成 WS 写入？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

### Q8 — confirmation `kind` 是否保持当前 7-kind freeze，而不在 PP1 扩展新种类？（来源：`docs/design/pro-to-product/02-hitl-interrupt-closure.md` D-02-3）

- **影响范围**：`PP1`、`packages/nacp-session/**` schema、docs 与 frontend enum
- **为什么必须确认**：如果在闭合前先扩 enum，PP1 会从 wiring phase 演变成 schema 扩张 phase。
- **当前建议 / 倾向**：**是。** 维持当前 7-kind freeze。
- **Reasoning**：这个问题出现，是因为 HITL/elicitation/context compact 等场景看起来都像“再加一个 kind 就好了”。但当前真正的断点不在 enum 数量，而在 live caller 和 pause-resume 没接通；如果不拍板，团队很容易用“扩 kind”掩盖“没接线”的真问题。

- **Opus的对问题的分解**：这题问的是 enum schema 是否在 PP1 内扩。HP5 Q18 已硬化 7-kind（`tool_permission / elicitation / model_switch / context_compact / fallback_model / checkpoint_restore / context_loss`）。扩 kind 等于 schema amendment + migration 例外。
- **Opus的对GPT推荐线路的分析**：GPT 推荐"是，维持 freeze"，理由扎实 — 当前真问题是 live caller，不是 enum 数量。GPT 没强调一条隐含义务：维持 freeze 意味着 PP1 closure 不应把"未扩 kind"当成 limitation 写进 known issues，因为它本身就是 out-of-scope by design。
- **Opus的最终回答**：**同意"维持 7-kind freeze"**。补充：扩 kind 必须经 HP5 同等级别 charter amendment，PP1 / PP4（Q17 fallback path 若选 hook→confirmation 路径需要新 kind）等都不能私扩。如果 Q17 owner 选 fallback confirmation，建议复用 `tool_permission` kind 而非新增 hook-fallback kind — 这样可避免 schema 扩张。

- **问题**：`是否确认 PP1 不扩展 confirmation kind，继续以当前 7-kind freeze 为准？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

### Q9 — PP2 是否禁止新增 `compact jobs` 专用表，而复用现有 checkpoint lineage？（来源：`docs/design/pro-to-product/03-context-budget-closure.md` D-03-1）

- **影响范围**：`PP2`、context durable truth、migration / storage discipline
- **为什么必须确认**：如果不拍板，PP2 遇到 durable 记录需求时很容易顺手再开新表，造成 schema 面继续碎裂。
- **当前建议 / 倾向**：**禁止新增专用 jobs 表。** 复用现有 checkpoint / compact lineage。
- **Reasoning**：这个问题出现，是因为 compact 既像一次性动作，也像 job。推荐路线更稳，因为当前 repo 已有 durable checkpoint/compact 边界可承载 first-wave truth；如果不拍板，PP2 会把“把 compact 接通”升级成“再设计一套 job 子系统”。

- **Opus的对问题的分解**：这题问的是 PP2 的 schema 边界。compact 既像一次性动作又像 job — 倾向 "job" 思维就会想新开表；倾向 "checkpoint" 思维就复用已有 lineage。当前 repo 已有 durable checkpoint/compact 边界（`createCompactBoundaryJob` + snapshot/checkpoint/message 三表写入）。
- **Opus的对GPT推荐线路的分析**：GPT 推荐"否，复用 checkpoint"，正确。GPT 没强调一条 schema 一致性约束：复用 checkpoint lineage 的代价 = 必须用 `snapshot_kind` 字段区分 manual compact / auto compact / checkpoint，否则 PP6 docs 无法分别描述。`snapshot_kind` 字段已存在（`nano_conversation_context_snapshots`），但 PP2 action-plan 要显式校验区分逻辑。
- **Opus的最终回答**：**同意"不新增 compact jobs 表"**。补强：复用 checkpoint lineage 时，PP2 action-plan 必须显式校验 `snapshot_kind` 区分逻辑（manual/auto/checkpoint），否则 PP6 docs sweep 时会发现 "compact 与 checkpoint 都写入同一张表，但前端无法分类"。这是技术债的常见来源，必须在 PP2 实现期就 nail down。

- **问题**：`是否确认 PP2 不新增 compact jobs 专用表，而是复用已有 checkpoint / compact lineage 承载 durable truth？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

### Q10 — auto compact 在未真实接线前，是否必须明确标成 `not live`，禁止写成 live？（来源：`docs/design/pro-to-product/03-context-budget-closure.md` D-03-2）

- **影响范围**：`PP2`、`PP6`、clients/api-docs、closure honesty
- **为什么必须确认**：如果 auto compact 只因为有 schema/notify 就被写成 live，PP2 与 PP6 都会重新制造 fake-live drift。
- **当前建议 / 倾向**：**必须标成 not live。**
- **Reasoning**：这个问题出现，是因为当前代码已经有 context-core probe / preview / notify substrate，很容易让文档误写成“已经自动 compact”。推荐路线更稳，因为它把“substrate 存在”和“runtime 已接通”严格分开；如果不拍板，前端会按不存在的自动行为开发。

- **Opus的对问题的分解**：这题问的是 docs/closure 与代码事实的诚实关系。当前 context-core probe / preview / notify substrate 已存在,容易让 docs 误写"已经自动 compact"。是 charter §10.1 T2 在 docs 层的投影。
- **Opus的对GPT推荐线路的分析**：GPT 推荐"必须标 not-live",正确。GPT 没明确 "not-live" vs "registry-only" vs "schema-live" 的标注法律 — 不同 readiness label 在 PP6 docs 中含义不同。建议 owner 答 yes 时同时认可 "由 PP6 readiness label 法律(charter §0.5 + 01 design)决定具体标签"。
- **Opus的最终回答**：**强烈同意"必须标 not-live"**。补强:具体标签由 PP6 readiness label 法律决定 — auto compact 当前最准确的标签是 `registry-only`(enum 已有但 caller 未 live),不是 `not-live` 或 `schema-live`。`registry-only` 比 `not-live` 更精确,因为前者明确指出 "API 字段存在但 runtime 不消费",后者过于含糊。PP6 docs sweep 应统一使用 4 选 1 标签集 `live / first-wave / schema-live / registry-only / not-enforced`,不再有自由文本。

- **问题**：`是否确认在 auto compact 尚未真实接线前，任何 design / docs / closure 都不得把它写成 live？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

### Q11 — PP2 是否必须引入 `LLM summary` 才能 closure？（来源：`docs/design/pro-to-product/03-context-budget-closure.md` D-03-3）

- **影响范围**：`PP2` scope、context compaction strategy、implementation complexity
- **为什么必须确认**：如果默认把 summary 当成 closure 前提，PP2 会从 truth wiring 扩张成 prompt intelligence / summarization 设计。
- **当前建议 / 倾向**：**否。** 先完成 truth / boundary / compact live，不把 LLM summary 设为硬前提。
- **Reasoning**：这个问题出现，是因为一谈到 context budget，最容易联想到“要不要先做摘要”。但当前 repo 的核心断点是 budget preflight、manual compact 真执行、overflow degrade 诚实，而不是摘要效果；如果不拍板，PP2 容易被“摘要好不好”拖进无边界优化。

- **Opus的对问题的分解**：这题问的是 PP2 的 scope 上限。一谈 context budget 就联想到摘要质量 — 但 PP2 的真断点是 budget preflight、manual compact 真执行、overflow degrade 诚实,不是摘要语义质量。
- **Opus的对GPT推荐线路的分析**：GPT 推荐"否",正确。GPT 没强调 deterministic summary 的诚实义务 — first-wave 用 deterministic summary 是 honest,但 PP2 closure 必须明示 "deterministic summary 在长会话超过 N turns 后会语义退化",否则 final closure 写 "Context truth 闭合" 会让前端误以为可以无限长会话。
- **Opus的最终回答**：**同意"不以 LLM summary 为前提"**。补强:deterministic summary 在 first-wave 是诚实的,但 PP2 closure 必须显式登记一条 known limitation:"deterministic summary 在长会话超过 X turns(由实测决定) 后,语义保留度会退化;真正的 LLM-based summary 留作下一阶段(暂定 platform-foundations)的 secondary outcome。" 否则"Context truth 闭合" 会被误读为"长会话无限可用"。

- **问题**：`是否确认 PP2 的 closure 不以 LLM summary 为前提，而优先完成 budget truth、manual compact 与 degrade honesty？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

### Q12 — PP3 是否承诺 `exactly-once replay`？（来源：`docs/design/pro-to-product/04-reconnect-session-recovery.md` D-04-1）

- **影响范围**：`PP3`、WS/replay contract、frontend recovery expectation
- **为什么必须确认**：如果默认承诺 exactly-once，PP3 scope 会立刻抬升到 event-store 级别，而这并不是当前阶段的目标。
- **当前建议 / 倾向**：**不承诺。** 只承诺 best-effort replay + explicit degraded contract。
- **Reasoning**：这个问题出现，是因为“断线恢复”很自然让人想追求强语义一致性。但 nano-agent 当前更现实的目标，是让前端在 replay 成功或失败时都拿到可信状态，而不是把底层存储升级成严格一次投递；如果不拍板，PP3 会被错误地抬成基础设施重构。

- **Opus的对问题的分解**：这题问的是 PP3 是否升级到 event-store 级 replay 语义。承诺 exactly-once → PP3 scope 抬升到基础设施重构;承诺 best-effort + explicit degraded → PP3 是接线 + 诚实降级。
- **Opus的对GPT推荐线路的分析**：GPT 推荐"不承诺",正确。GPT 没强调 best-effort 的隐性义务 — degraded contract 不是事后通知,而是在 frontend 决策点立即可用(例如 attach 后第一个 frame 就告知 lag,而不是 turn 结束后才报)。Q14 是同一根问题的另一面;两题须一致。
- **Opus的最终回答**：**强烈同意"不承诺 exactly-once"**。补强:best-effort 的隐性义务 = degraded verdict 必须在 frontend 决策点立即可用(WS attach 后第一个 frame / HTTP resume body 同步返回),不能事后补发。这条与 Q14 答案逻辑一致 — silent latest-state fallback 禁止 = degraded 必须可见 = degraded 必须 *早* 可见。三题(Q12 / Q14 + Q13 single attachment)是一组,owner 应一起拍板。

- **问题**：`是否确认 PP3 不承诺 exactly-once replay，而以 best-effort replay + explicit degraded contract 作为 first-wave baseline？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

### Q13 — PP3 是否继续维持 `single attachment`，而不支持多活动 attachment？（来源：`docs/design/pro-to-product/04-reconnect-session-recovery.md` D-04-2）

- **影响范围**：`PP3`、WS attach policy、frontend multi-device expectation
- **为什么必须确认**：如果这一点不冻结，reconnect / replay / presence 语义都会立刻复杂一倍。
- **当前建议 / 倾向**：**是。** 维持 single attachment。
- **Reasoning**：这个问题出现，是因为一旦讨论断线恢复，就会自然延伸到“多端同时在线”。但当前代码已经以 supersede + detached 为主线组织，继续维持 single attachment 最稳；如果不拍板，PP3 会在恢复链闭合前先陷入 presence 设计。

- **Opus的对问题的分解**：这题问的是 attachment 模型。多端 attachment → 引入 cursor / decision / todo 并发协调;single attachment + supersede → 与当前 ws-runtime.ts 实现一致。
- **Opus的对GPT推荐线路的分析**：GPT 推荐"是,single",正确。GPT 没明确 — single-attachment 意味着 PP3 不能因"想做多端"而新增任何 supersede 逻辑外的 attachment race handling;凡涉及多设备协同的功能都属于下一阶段 platform-foundations 的 scope。
- **Opus的最终回答**：**同意"single attachment"**。补强:single + supersede 已在 `ws-runtime.ts:86-110` 实现,PP3 不应新增任何"多 attachment 协调"代码。前端在第二设备 attach 时,第一设备会收到 `session.attachment.superseded` frame 然后 close — 这是已经存在的诚实合同。多端协作是平台级命题,留给 platform-foundations 阶段统一设计。

- **问题**：`是否确认 PP3 继续以 single attachment 为基线，不在本阶段支持多活动 attachment？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

### Q14 — replay gap / replay_lost 时，是否禁止 silent latest-state fallback，而必须显式 degraded？（来源：`docs/design/pro-to-product/04-reconnect-session-recovery.md` D-04-3）

- **影响范围**：`PP3`、`PP6`、session-ws / resume docs、frontend recovery UX
- **为什么必须确认**：如果允许 silent fallback，前端会误以为自己拿到了连续历史，实际却已经丢帧，恢复 contract 将不可信。
- **当前建议 / 倾向**：**禁止 silent fallback。** 必须显式 degraded / replay_lost。
- **Reasoning**：这个问题出现，是因为最新状态快照看起来像是一个“能继续用”的兜底，但它不能替代真实 replay 语义。推荐路线更稳，因为它让前端明确知道“你现在恢复的是 latest-state，而不是完整事件链”；同时当前 HTTP `resume` 端已经能返回 `replay_lost`，但 WS attach 端还缺等价 degraded 表达，所以拍板时还要一并明确：是要求 PP3 补齐 WS degraded frame，还是要求前端先走 HTTP resume 再 WS attach。如果不拍板，recovery 看似平滑，实际是在隐式吞掉断点。

- **Opus的对问题的分解**：这题问的是 replay 失败时的语义诚实。silent fallback → 前端误以为完整;explicit degraded → 前端可主动决定 reload。同时还要选 PP3 实现路径:补 WS degraded frame、还是固化"先 HTTP resume 再 WS attach"顺序、还是两条都做。
- **Opus的对GPT推荐线路的分析**：GPT 推荐"explicit degraded",正确。GPT 在 reasoning 中追问 PP3 该补 WS frame 还是固化 HTTP→WS 顺序,但没给推荐 — 留给 owner 判。我倾向给出明确推荐:**两条都做**。
- **Opus的最终回答**：**同意"禁止 silent fallback"**。具体路径推荐:**两条都做** — (a) WS attach 时检测到 client `last_seen_seq > relay_cursor`,必须先 emit 一条 `session.replay.lost` top-level frame 再继续转发后续 events;(b) 同时保留 HTTP resume 作为初始恢复入口(已实现)。理由:仅靠 HTTP→WS 顺序作为唯一恢复路径,会让前端必须先 round-trip HTTP 才能 attach,弱网场景下增加恢复延迟与失败率;WS 端补 degraded frame 是更对称、更简洁、且与 single attachment supersede frame(`session.attachment.superseded`)同一族的方案。这与 Q12 best-effort + early degraded verdict 一致。

- **问题**：`是否确认 replay gap / replay_lost 时不允许 silent latest-state fallback，而必须显式向前端暴露 degraded verdict？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

---

## 3. Hooks / Policy / Docs Closure

### Q15 — PP4 的最小 hook 范围，是否冻结为 `minimal live loop`，而不扩展 hook enum / full catalog？（来源：`docs/charter/plan-pro-to-product.md` §12 Q2、`docs/design/pro-to-product/05-hook-delivery-closure.md` D-05-1）

- **影响范围**：`PP4`、hook contract、action-plan scope 控制
- **为什么必须确认**：如果不冻结最小 hook 范围，PP4 极易从 caller wiring 演变成 catalog 扩张或平台化设计。
- **当前建议 / 倾向**：**是。** 只做到 `PreToolUse + 1 register source + 1 frontend-visible path` 的 minimal live loop，不扩 hook enum。
- **Reasoning**：这个问题出现，是因为当前 repo 已有 hook catalog / dispatcher substrate，最容易让人误以为“顺手全接通”才算完整。推荐路线更稳，因为 PP4 的真正目标是把至少一条 user-driven hook 闭合，而不是把 14/18 catalog 全部平台化；如果不拍板，PP4 会立刻 scope creep。

- **Opus的对问题的分解**：这题问的是 PP4 scope 上限。当前 hook catalog (18 events) + dispatcher substrate 已存在,容易让 PP4 误读为"顺手全接通"。charter §10.1 T5 仅要求"至少一条 user-driven hook live loop",是"三选一"。
- **Opus的对GPT推荐线路的分析**：GPT 推荐"是,minimal loop",正确。05 design §6.1 取舍 2 进一步收窄到 PreToolUse-only,严于 charter T5 三选一 — 这是设计层主动收窄,不是 charter 调整(见 RR6)。
- **Opus的最终回答**：**强烈同意"minimal loop"**,并支持 design 05 的 PreToolUse-only 收窄。理由:PreToolUse 是工具执行前唯一能 *阻断/改写 input* 的 blocking 事件,证明 register→emit→outcome→frontend visible+audit visible 链路最有信息量;PostToolUse(non-blocking)不能证明 outcome 改变行为;PermissionRequest 受 Q17 fallback 不确定性影响。PP4 闭合 PreToolUse 一条即满足 T5,其他 13 类(包括 PostToolUse / PermissionRequest)留作 secondary outcome,不进 hard gate。

- **问题**：`是否确认 PP4 只冻结 minimal live hook loop，不扩 hook enum、不追求 full catalog 接通？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

### Q16 — PP4 是否禁止开放 `shell hook`？（来源：`docs/design/pro-to-product/05-hook-delivery-closure.md` D-05-2）

- **影响范围**：`PP4`、runtime safety、Cloudflare worker execution model
- **为什么必须确认**：如果 shell hook 被默许，PP4 会立刻跨到 runtime sandbox / security policy 的另一条产品线。
- **当前建议 / 倾向**：**禁止。**
- **Reasoning**：这个问题出现，是因为很多 CLI precedent 的 hook 都允许触发本地 shell。但 nano-agent 当前跑在 Cloudflare worker 语境里，开放 shell hook 不只是“多一个 handler”，而是完全不同的执行与安全模型；如果不拍板，PP4 的安全边界会失真。

- **Opus的对问题的分解**：这题问的是 PP4 hook runtime 形态。Cloudflare worker 运行时不能 fork/exec — shell hook 在 nano-agent 当前架构下不仅是"多一个 handler",而是完全不同的执行与安全模型。
- **Opus的对GPT推荐线路的分析**：GPT 推荐"禁止",正确。GPT 没强调一条 — 这不是"现在不做",而是"runtime 不允许"。这关系到下一阶段是否要引入 dedicated sandbox worker 才能开放 shell hook;如果要开放,必须先有 sandbox worker,不能直接在现 worker 内放 shell。
- **Opus的最终回答**：**同意"禁止 shell hook"**。补强:这是 *runtime 层硬约束*,不是策略选择 — Cloudflare worker 没有 process spawn 能力,即便想开也开不了。design 05 §3.1 应显式说明 "shell hook 在当前 worker runtime 不可实现;若未来要支持,需先引入 dedicated sandbox worker(独立 charter)"。这条 framing 比 GPT 的"现在不做"更准确,可避免下一阶段 review 时反复回答同一问题。

- **问题**：`是否确认 PP4 不开放 shell hook，而只允许符合 worker 运行边界的 hook form？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

### Q17 — `PermissionRequest` 在没有 hook handler 时，默认策略应是 `fallback confirmation` 还是 `直接 fail-closed`？（来源：`docs/design/pro-to-product/05-hook-delivery-closure.md` D-05-3）

- **影响范围**：`PP4/PP5`、hook/policy 优先级、frontend permission UX
- **为什么必须确认**：如果这一点不冻结，PP4 action-plan 会在“保持安全”与“保持可用”之间摇摆，前端也无法确定无 handler 时的预期。
- **当前建议 / 倾向**：**优先 fallback confirmation；只有 confirmation substrate 不可用时才 fail-closed。**
- **Reasoning**：这个问题出现，是因为 PermissionRequest 同时踩在 hook、policy、HITL 三条链的交汇处，而且当前 `workers/agent-core/src/hooks/catalog.ts` 还把“零 handler = denied”写成了 fail-closed 注释。这里有两种**不等价**的产品语义：`fail-closed` = 默认拒绝，handler 缺失直接视为 deny；`fallback confirmation` = 默认把决定权交回用户，用户仍可 allow。当前建议更偏向后者，因为它能复用 PP1 的真实 interrupt substrate，但这也意味着如果业主采纳该路线，就必须同步修改 catalog 注释与对应 guard 语义，而不是只改 action-plan 文案。如果不拍板，PP4/PP5 会各自实现一套兜底逻辑。

- **Opus的对问题的分解**：这题问的是 handler 缺失时的默认行为 — 两条路径在安全语义上不等价:`fail-closed` = 默认拒绝,handler 缺失视为 deny;`fallback confirmation` = 默认问用户,用户可 allow。同时 catalog.ts:158-159 已 frozen "fail-closed",fallback confirmation 路径会触发 catalog/dispatcher/test 同步修订。
- **Opus的对GPT推荐线路的分析**：GPT 推荐 fallback confirmation,reasoning 已诚实承认 catalog 注释要同步改。但我**不同意 GPT 的偏好**,提供 second opinion 倾向 fail-closed。理由见下。
- **Opus的最终回答**：**Second opinion: 倾向 fail-closed,与 GPT 推荐相反**。理由:
  1. **安全语义不可逆** — fallback confirmation 把"无 handler"升级为"ask user",用户可 allow。生产环境下这会培养前端"无脑 allow"习惯,实际等于削弱权限模型;fail-closed 让"应该有 hook 但没有"成为可见错误,推动主动注册。
  2. **工程成本** — catalog.ts:158-159 已 frozen "fail-closed",改这一行连锁触发 dispatcher fail-closed guard、catalog test、docstring、HP5 closure docs 同步修订,代价远超表面;若选 fallback,Q8 7-kind freeze 也面临"是否复用 tool_permission kind 还是新增 hook-fallback kind"的次生争论。
  3. **first-wave 诚实性** — fail-closed 暴露 misconfiguration,fallback confirmation 掩盖 misconfiguration。pro-to-product 阶段的产品哲学是 honesty-first,fail-closed 更对齐这条主线。
  4. **若 owner 仍倾向 fallback confirmation**,必须配套登记:(a) catalog.ts:158-159 注释改写 (b) dispatcher fail-closed guard 改名为 "fallback confirmation guard" (c) PP1 confirmation 路径增加 "由 hook 缺失触发" 的 source 标识(避免与正常 user-driven ask 混淆) (d) 更新 HP5-closure docs 中相关 fail-closed 描述 — 这是工程量级别的连锁改动,不是 reasoning 文案改动。
  5. **建议路径** — 即便 owner 倾向 fallback confirmation,也建议先 fail-closed 进 PP4 closure,等 Q17 答复 + 上述配套准备完成后再升级到 fallback。这样 PP4 不会被 Q17 fallback 路径阻塞。

- **问题**：`当 PermissionRequest 没有命中的 hook handler 时，是否确认优先回退到 confirmation 流程；只有 confirmation 本身不可用时才 fail-closed？`
- **业主回答**：业主已同意 Opus 意见

### Q18 — `/runtime` 中的 `config-only` 字段是否允许继续保留，但必须明确标成 `not-enforced`？（来源：`docs/charter/plan-pro-to-product.md` §12 Q1、`docs/design/pro-to-product/06-policy-reliability-hardening.md` D-06-1）

- **影响范围**：`PP5/PP6`、runtime docs、frontend truth、policy honesty
- **为什么必须确认**：如果这些字段继续存在却不标状态，前端会天然把它们当成 active policy；如果直接删掉，又会打断现有 runtime shape。
- **当前建议 / 倾向**：**允许保留，但必须明确标成 not-enforced / stored-only。**
- **Reasoning**：这个问题出现，是因为 nano-agent 当前已经有 `network_policy / web_search / workspace_scope` 等 durable config 字段，但执行约束尚未全部闭合。推荐路线更稳，因为它允许渐进收口，同时把 contract honesty 放在第一位；如果不拍板，PP5 和 PP6 只会继续积累 stored-not-enforced drift。

- **Opus的对问题的分解**：这题问的是"字段已公开但 runtime 不消费"的 docs 处理策略。删字段 → 破坏前端;保留不标 → 前端误以为 active policy。中间路径是保留 + 显式 not-enforced 标注。
- **Opus的对GPT推荐线路的分析**：GPT 推荐"保留 + 标 not-enforced",正确。GPT 没强调一条 — 必须有"不 enforce 时间窗",否则 stored-not-enforced 会变成永久债。建议 owner 答 yes 时同时认可"每个 not-enforced 字段必须登记预期 enforce 周期"。
- **Opus的最终回答**：**同意"保留 + 标 not-enforced"**。补强:必须设"不 enforce 时间窗" — 例如"字段标 not-enforced 超过 2 个 charter 周期未 enforce 则必须废弃或显式 enforce"。否则 stored-not-enforced 会变成永久债,前端永远无法判断这些字段何时可信。建议 PP5 closure 显式登记每个 not-enforced 字段的"预期 enforce 周期"或"明确 sunset 时间"。当前应登记的字段:`network_policy.mode`、`web_search.mode`、`workspace_scope.mounts`(若 mounts 语义未与 filesystem path law 完全对齐)。

- **问题**：`是否确认 runtime 中尚未闭合执行约束的 config-only 字段可以保留，但必须在 API/docs 中明确标成 not-enforced / stored-only？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

### Q19 — stream retry 是否必须与 non-stream retry 完全对齐，还是允许采用“显式 degraded + client retry”作为 first-wave baseline？（来源：`docs/design/pro-to-product/06-policy-reliability-hardening.md` D-06-2）

- **影响范围**：`PP5`、LLM streaming reliability、frontend retry strategy、error docs
- **为什么必须确认**：如果不冻结 baseline，PP5 action-plan 会在“必须补内部 retry”与“先把 truth 写清”之间反复摇摆。
- **当前建议 / 倾向**：**不强求完全对齐；至少要做到 retry/error honesty，并明确是“内部 retry”还是“显式 degraded + client retry”。**
- **Reasoning**：这个问题出现，是因为 non-stream 与 stream path 当前可靠性能力不一致。推荐路线更稳，因为它优先消除 contract ambiguity，让前端知道什么时候该等平台重试、什么时候该自己 retry；这里真正不能接受的不是“选择哪条路”，而是让 PP5 在实现结束时仍然保持语义未冻结。因此这题必须在 PP5 implementation/closure 之前收口成单一路径：要么内部补 stream retry，要么显式 degraded + client retry + docs truth；不能继续把两条都写成 open option。

- **Opus的对问题的分解**：这题问的是 stream reliability baseline。non-stream `execute()` 已有完整 retry loop(429 rotation / exponential backoff);stream `executeStream()` 在 `!response.ok` 时直接 throw,无重试。两条路径如何对齐(完全对齐 / 部分对齐 / 显式不对齐)是 PP5 必须冻结的 contract。
- **Opus的对GPT推荐线路的分析**：GPT 推荐"不强求对齐,但必须冻结单一路径",方向正确。但 GPT 没给具体推荐 — 留给 owner 二选一。我倾向给出明确推荐:**显式 degraded + client retry**(非内部补 stream retry)。
- **Opus的最终回答**：**同意"必须冻结单一路径,不能保留 open option"**。具体路径推荐:**显式 degraded + client retry**(而非内部补 stream retry)。理由:
  1. **stream 内部 retry 难度** — 必须解决"已发送的 partial chunks 是否回滚 / 已发出的 tool_use_start 怎么撤销"的语义,这是 SSE/WS 的难题,会把 PP5 拖入 streaming protocol 重新设计
  2. **与 PP3 reconnect 一致** — 显式 degraded + client retry 与 PP3 的 reconnect 语义同一族;前端只需一套 retry/恢复策略,不需要分别处理 "stream 内部 retry" 与 "stream 失败后 reconnect"
  3. **工程成本低** — 已有 `system.error` registry,只需新增一个 `stream-failed-retryable` code(或复用现有 retryable 字段),前端按 `trace_uuid` 决定是否 retry
  4. **诚实性更高** — 内部 retry 容易掩盖底层 provider instability,显式 degraded 让前端能感知"这次请求不可靠",符合 honesty-first 主线
  
  Owner 拍板时,建议直接选 "显式 degraded + client retry",不再保留 "内部 retry" 选项。

- **问题**：`是否确认 PP5 不要求 stream retry 与 non-stream retry 完全对齐，但必须明确冻结为“实现内部 retry”或“显式 degraded + client retry”中的一种？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

### Q20 — policy plane unavailable 时，是否禁止 `silent allow`？（来源：`docs/design/pro-to-product/06-policy-reliability-hardening.md` D-06-3）

- **影响范围**：`PP5`、runtime safety、tool authorization、error strategy
- **为什么必须确认**：如果 policy unavailable 时允许 silent allow，整个 policy 面都会退化成“有时生效、有时失效但没人知道”。
- **当前建议 / 倾向**：**禁止 silent allow。**
- **Reasoning**：这个问题出现，是因为任何 policy chain 在 first-wave 阶段都可能遇到配置缺失或控制面异常。推荐路线更稳，因为安全和诚实都要求 unavailable 至少变成可见 deny / degraded，而不能悄悄放行；如果不拍板，PP5 会留下最危险的一种模糊成功。

- **Opus的对问题的分解**：这题问的是 policy plane 异常时的 fail-safe 方向。silent allow → 最危险(有时生效有时失效但没人知道);silent deny → 较安全但仍隐藏故障;explicit deny / degraded → 安全且可见。
- **Opus的对GPT推荐线路的分析**：GPT 推荐"禁止 silent allow",正确。GPT 没明确 entrypoint.ts:349 把 db missing 翻译成 "ask + unavailable" → runtime-mainline.ts:252-260 又把 ask 翻译成 `tool-permission-required` error 这条具体链路。06 design F2 已 cover,但 owner 答 yes 等同于授权 PP5 把 unavailable 改为 fail-visible。
- **Opus的最终回答**：**强烈同意"禁止 silent allow"**。补强:具体实现 — entrypoint.ts:349 当前 `decision: "ask", source: "unavailable"` 的语义必须改为 `decision: "deny", source: "unavailable"` 或新增 `decision: "unavailable"` 三态。前者复用现有 enum 但混淆 user-deny / unavailable-deny;后者更精确但需要 runtime-mainline 增加一条分支。建议后者(增加 `unavailable` 三态),这样 PP1 的 ask interrupt 主线不会被 unavailable 撞穿,PP5 的 fail-visible degraded 也能独立呈现。这是对 GPT "禁止 silent allow" 的进一步具体化。

- **问题**：`是否确认 policy plane unavailable 时不允许 silent allow，而必须显式 deny / degraded / error surfaced？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

### Q21 — PP6 的 docs closure 是否要求相关功能都 `fully complete`，还是只要求 `truthful readiness`？（来源：`docs/design/pro-to-product/07-api-contract-docs-closure.md` D-07-2）

- **影响范围**：`PP6`、`clients/api-docs/**`、final closure honesty
- **为什么必须确认**：如果 docs closure 被理解成“所有功能必须 fully complete”，PP6 会被迫重开前面 phase 的实现边界；如果没有这个问题的明确答案，docs 又容易继续 overclaim。
- **当前建议 / 倾向**：**只要求 truthful readiness。** docs closure 不等于功能 fully complete。
- **Reasoning**：这个问题出现，是因为文档收口很容易被误会成“把所有功能都做到完美再写文档”。推荐路线更稳，因为 PP6 的目标是让前端拿到真实、可执行、不会误导的 contract；只要 readiness truth 诚实，first-wave / schema-live / not-enforced 也可以被正确文档化；如果不拍板，PP6 要么无限拖延，要么继续包装成 fake-live。

- **Opus的对问题的分解**：这题问的是 PP6 docs closure 标准。要求 fully complete → PP6 被迫重开前面 phase 的实现边界;只要求 truthful readiness → docs 能承载未完成事实。
- **Opus的对GPT推荐线路的分析**：GPT 推荐"truthful readiness 即可",正确。GPT 没给出 truthful readiness 的具体可验证形式 — 这容易让 PP6 reviewer 在闭合时争论 "什么算 truthful"。我建议给出可枚举的 readiness label 集。
- **Opus的最终回答**：**同意"truthful readiness"**。补强:truthful readiness 的具体可验证形式 = 每个 endpoint / frame / error code / runtime field 都被划入 5 选 1 readiness label:`live / first-wave / schema-live / registry-only / not-enforced`。PP6 closure evidence shape = 22 份 docs 中所有 surface 都有明确 label。如果某 surface 不能被划入任一 label(例如说不清是 first-wave 还是 not-enforced),就视为 docs gap,不能 closure。这条可枚举性比"truthful" 抽象表述更可执行。

- **问题**：`是否确认 PP6 的 docs closure 只要求 truthful readiness，而不要求相关功能在本阶段全部达到 fully complete？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

### Q22 — PP6 是否引入 `OpenAPI / doc generator`，还是继续维持人工对账 + markdown truth？（来源：`docs/design/pro-to-product/07-api-contract-docs-closure.md` D-07-3）

- **影响范围**：`PP6`、docs maintenance strategy、future drift-control
- **为什么必须确认**：如果在 PP6 临时引入 generator，这一阶段会从 contract 对账扩张成文档基础设施建设。
- **当前建议 / 倾向**：**本阶段不引入。** 继续维持人工对账 + markdown truth，后续再评估 drift gates / generation。
- **Reasoning**：这个问题出现，是因为在做大规模 docs sweep 时，很容易自然想到“顺手把生成器一起上了”。但当前更紧迫的是先把既有 public contract 真相归零；如果不拍板，PP6 会把有限精力投入到工具链，而不是解决当前 drift。

- **Opus的对问题的分解**：这题问的是 PP6 是否在 docs closure 同时引入 doc generator。引入 generator → PP6 scope 抬升到文档基础设施建设;不引入 → PP6 保持 manual sweep,但下一阶段做 SDK 时要承担一次性 schema reverse-engineering 成本。
- **Opus的对GPT推荐线路的分析**：GPT 推荐"否,本阶段不引入",正确。GPT 没说不引入 generator 的代价 — 后续若要做 SDK extraction,首批 SDK 必须基于 manual markdown,会承担 schema reverse-engineering 成本。但相比 generator 引入的 drift 风险(generated 与 markdown 不一致变成新债),仍然是不引入更稳。
- **Opus的最终回答**：**同意"本阶段不引入 generator"**。补强:不引入 generator 的代价 — 后续若要做 SDK extraction,首批 SDK 必须基于 manual markdown reverse-engineering,会有一次性成本。建议 PP6 closure 时显式登记 "若下一阶段计划做 SDK,首要任务是 type generation",作为 handoff signal 写进 `pro-to-product-to-platform-foundations-handoff.md`。这样 generator/schema-driven 路径不会被遗忘,同时 PP6 不被工具链开发拖慢。

- **问题**：`是否确认 PP6 不引入 OpenAPI / doc generator，而先以人工 item-by-item 对账 + markdown truth 完成收口？`
- **业主回答**：业主已同意 GPT 与 Opus 意见

---

## 4. 使用约束

### 4.1 哪些问题应该进入 PPX QNA

- **会直接改变 public contract、phase scope、执行顺序、closure 标准、readiness 表述或前端依赖边界的问题**
- **需要业主 / 架构师拍板，而不是 action-plan 自己就能收敛的实现细节**
- **如果不先冻结，会导致多个 design / action-plan / review 同时漂移的问题**

### 4.2 哪些问题不应进入 PPX QNA

- **局部实现细节**：例如单个 helper 命名、局部测试拆分、内部脚本组织
- **已有 frozen answer 的重复提问**：除非要正式推翻旧答案
- **只影响单个文件内部实现、不会改变外部 contract 或治理边界的问题**

### 4.3 回填纪律

- 一旦某题填入 `业主回答`，后续 `docs/design/pro-to-product/*.md`、`docs/action-plan/pro-to-product/*.md`、`docs/issue/pro-to-product/*.md` 若引用该决策，均以本文件为唯一口径。
- 如果后续要推翻答案，必须在本文件对应题目下追加修订说明，而不是在别处静默改口。
- 各 design 文件中原有的 `D-xx` 表述可保留为历史上下文，但不再作为最终 owner-answer source。
