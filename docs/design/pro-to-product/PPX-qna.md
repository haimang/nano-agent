# Pro-to-Product — PPX QNA

> 范围：`pro-to-product / PP0-PP6`
> 目的：把会影响后续 `docs/design/pro-to-product/*.md`、`docs/action-plan/pro-to-product/*.md`、各 PP phase implementation gate 与 final closure 的业主 / 架构师决策收敛到一份单一清单，避免在多个文档中重复回答、重复漂移、重复改口。
> 状态：`draft register (Q1-Q22 collected; owner answers pending unless otherwise noted)`
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

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 pro-to-product 的唯一硬闸就是 charter §10 定义的 7 条 truth gates，而不是再允许各 phase 各自追加一套平行 exit law？`
- **业主回答**：

### Q2 — latency baseline 是否只作为 alert threshold，而不是 hard gate？（来源：`docs/charter/plan-pro-to-product.md` §9.2、`docs/design/pro-to-product/00-agent-loop-truth-model.md` D-00-2）

- **影响范围**：`PP1/PP3/PP5/PP6`、closure verdict、manual evidence 与 final closure 表述
- **为什么必须确认**：如果 latency baseline 被误当成独立硬闸，phase 可能因为体验抖动长期无法开始/无法 closure；反过来如果完全无纪律，又会把“前端可感知体验”从验证中删掉。
- **当前建议 / 倾向**：**否。** latency baseline 只作为 alert threshold，不单独构成 hard gate。
- **Reasoning**：这个问题出现，是因为 pro-to-product 既要强调 functional truth，也不能对前端体感完全失明。把它定为 alert threshold 最稳：既保留体验压力，也不让整个阶段被性能偶发波动绑架；如果不拍板，团队会在“功能先过”与“性能先过”之间反复摇摆。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认本阶段 latency baseline 只作为 validation baseline / alert threshold，不作为独立 hard gate？`
- **业主回答**：

### Q3 — 前端 contract 是否只依赖 `orchestrator-core facade`，而不直接依赖 internal RPC / worker seam？（来源：`docs/design/pro-to-product/01-frontend-trust-contract.md` D-01-1）

- **影响范围**：`clients/api-docs/**`、frontend integration、PP6 docs closure
- **为什么必须确认**：如果前端可绕过 facade 直接依赖内部 seam，后续文档范围、测试边界、closure 口径都会立刻失真。
- **当前建议 / 倾向**：**是。** 前端 contract 只依赖 `orchestrator-core` facade。
- **Reasoning**：这个问题出现，是因为 nano-agent 的内部 worker 之间已经有不少 transport / RPC seam，但这些都不是前端产品面。把 facade 固定为唯一 public owner，能确保 API docs、测试和 future frontend 都围绕同一层工作；如果不拍板，PP6 会被拉去为 internal-only seam 背书。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认前端只依赖 orchestrator-core facade 暴露的 HTTP / WS contract，而不直接依赖 worker-to-worker internal seam？`
- **业主回答**：

### Q4 — per-phase design 文档是否允许按 `just-in-time` 方式逐份冻结，而不是要求 PP0 先把全部设计一次性冻结？（来源：`docs/charter/plan-pro-to-product.md` §13.4、`docs/design/pro-to-product/01-frontend-trust-contract.md` D-01-3）

- **影响范围**：`PP0-PP6`、design production order、action-plan start gate
- **为什么必须确认**：如果要求全部设计在 PP0 一次性冻结，容易让后续设计在代码事实尚未稳定时写成大而空；如果完全不设 JIT 纪律，又会造成设计拖后于实现。
- **当前建议 / 倾向**：**是。** 允许 JIT 冻结，但每个 phase 开工前必须已有对应 design。
- **Reasoning**：这个问题出现，是因为 pro-to-product 的若干 gap 只有在前一阶段 truth 更稳定后才能写清。JIT 的好处是把设计尽量贴近真实代码与最新 precedent，同时仍然守住“无设计不开工”的纪律；如果不拍板，团队不是过早设计，就是设计被实现绕过。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 pro-to-product 采用 just-in-time design 冻结策略：不要求 PP0 先冻结全部 phase 设计，但每个 phase 开工前必须先有自己的 frozen design？`
- **业主回答**：

### Q5 — PP6 的接口扫描是否只覆盖前端依赖的 public/frontend-facing surfaces，而不扩张到 internal RPC / worker-only seam？（来源：`docs/charter/plan-pro-to-product.md` §12 Q3、`docs/design/pro-to-product/00-agent-loop-truth-model.md` D-00-3、`01-frontend-trust-contract.md` D-01-2、`07-api-contract-docs-closure.md` D-07-1）

- **影响范围**：`PP6`、`clients/api-docs/**`、final closure 边界
- **为什么必须确认**：如果扫描范围不冻结，PP6 很容易从 docs closure 膨胀成第二轮全仓架构审计，直接失控。
- **当前建议 / 倾向**：**是。** 只扫描前端依赖的 public/frontend-facing surfaces。
- **Reasoning**：这个问题出现，是因为“把全部接口重新核对一遍”很容易被误解成“把所有内部 seam 也一起做文档化”。推荐路线更稳，因为 PP6 的价值在于把前端可直接依赖的 contract 收口，而不是把内部 worker 生态再做一遍考古；如果不拍板，PP6 会变成没有止境的扩张阶段。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 PP6 只扫描前端依赖的 public/frontend-facing contract，不纳入 internal RPC / worker-only seam？`
- **业主回答**：

---

## 2. HITL / Context / Recovery

### Q6 — `approval_policy=ask` 是否必须中断 turn，禁止继续返回 tool error？（来源：`docs/design/pro-to-product/02-hitl-interrupt-closure.md` D-02-1）

- **影响范围**：`PP1`、HITL runtime loop、frontend permission UX
- **为什么必须确认**：如果 ask 仍允许退化成 tool error，HITL 就仍是假闭环，PP1 的 phase 目标会直接落空。
- **当前建议 / 倾向**：**必须 interrupt。** 不允许继续返回 tool error 代替 pause-resume。
- **Reasoning**：这个问题出现，是因为当前 runtime 里 `ask` 还会落回错误路径，而不是进入等待用户决策的真实 loop。推荐路线更稳，因为它直接把“是否真的有 HITL”与“只是多了一个错误 code”分开；如果不拍板，前端会被迫用错误处理去伪装交互中断。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 approval_policy=ask 在 PP1 中必须变成真实 interrupt + pause-resume，而不能继续用 tool error 形态对前端兜底？`
- **业主回答**：

### Q7 — confirmation decision 是否仍保持 `HTTP` 输入，而不改成 `WS` 输入？（来源：`docs/design/pro-to-product/02-hitl-interrupt-closure.md` D-02-2）

- **影响范围**：`PP1`、`PP6`、session-control API、frontend transport design
- **为什么必须确认**：如果输入通道在执行期摇摆，前端和 docs 会同时裂成两套口径。
- **当前建议 / 倾向**：**保持 HTTP。** WS 只负责广播状态，不承担 decision 输入。
- **Reasoning**：这个问题出现，是因为 confirmation loop 天然会让人想把“请求”和“回答”都塞进同一条 WS。保持 HTTP 更稳，因为现有路由、幂等和审计边界都已经围绕 row-first + HTTP decision 组织；如果不拍板，PP1 与 PP6 会同时改 transport 面。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 confirmation 的 decision 输入继续走 HTTP，而不是在 PP1/PP6 改成 WS 写入？`
- **业主回答**：

### Q8 — confirmation `kind` 是否保持当前 7-kind freeze，而不在 PP1 扩展新种类？（来源：`docs/design/pro-to-product/02-hitl-interrupt-closure.md` D-02-3）

- **影响范围**：`PP1`、`packages/nacp-session/**` schema、docs 与 frontend enum
- **为什么必须确认**：如果在闭合前先扩 enum，PP1 会从 wiring phase 演变成 schema 扩张 phase。
- **当前建议 / 倾向**：**是。** 维持当前 7-kind freeze。
- **Reasoning**：这个问题出现，是因为 HITL/elicitation/context compact 等场景看起来都像“再加一个 kind 就好了”。但当前真正的断点不在 enum 数量，而在 live caller 和 pause-resume 没接通；如果不拍板，团队很容易用“扩 kind”掩盖“没接线”的真问题。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 PP1 不扩展 confirmation kind，继续以当前 7-kind freeze 为准？`
- **业主回答**：

### Q9 — PP2 是否禁止新增 `compact jobs` 专用表，而复用现有 checkpoint lineage？（来源：`docs/design/pro-to-product/03-context-budget-closure.md` D-03-1）

- **影响范围**：`PP2`、context durable truth、migration / storage discipline
- **为什么必须确认**：如果不拍板，PP2 遇到 durable 记录需求时很容易顺手再开新表，造成 schema 面继续碎裂。
- **当前建议 / 倾向**：**禁止新增专用 jobs 表。** 复用现有 checkpoint / compact lineage。
- **Reasoning**：这个问题出现，是因为 compact 既像一次性动作，也像 job。推荐路线更稳，因为当前 repo 已有 durable checkpoint/compact 边界可承载 first-wave truth；如果不拍板，PP2 会把“把 compact 接通”升级成“再设计一套 job 子系统”。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 PP2 不新增 compact jobs 专用表，而是复用已有 checkpoint / compact lineage 承载 durable truth？`
- **业主回答**：

### Q10 — auto compact 在未真实接线前，是否必须明确标成 `not live`，禁止写成 live？（来源：`docs/design/pro-to-product/03-context-budget-closure.md` D-03-2）

- **影响范围**：`PP2`、`PP6`、clients/api-docs、closure honesty
- **为什么必须确认**：如果 auto compact 只因为有 schema/notify 就被写成 live，PP2 与 PP6 都会重新制造 fake-live drift。
- **当前建议 / 倾向**：**必须标成 not live。**
- **Reasoning**：这个问题出现，是因为当前代码已经有 context-core probe / preview / notify substrate，很容易让文档误写成“已经自动 compact”。推荐路线更稳，因为它把“substrate 存在”和“runtime 已接通”严格分开；如果不拍板，前端会按不存在的自动行为开发。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认在 auto compact 尚未真实接线前，任何 design / docs / closure 都不得把它写成 live？`
- **业主回答**：

### Q11 — PP2 是否必须引入 `LLM summary` 才能 closure？（来源：`docs/design/pro-to-product/03-context-budget-closure.md` D-03-3）

- **影响范围**：`PP2` scope、context compaction strategy、implementation complexity
- **为什么必须确认**：如果默认把 summary 当成 closure 前提，PP2 会从 truth wiring 扩张成 prompt intelligence / summarization 设计。
- **当前建议 / 倾向**：**否。** 先完成 truth / boundary / compact live，不把 LLM summary 设为硬前提。
- **Reasoning**：这个问题出现，是因为一谈到 context budget，最容易联想到“要不要先做摘要”。但当前 repo 的核心断点是 budget preflight、manual compact 真执行、overflow degrade 诚实，而不是摘要效果；如果不拍板，PP2 容易被“摘要好不好”拖进无边界优化。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 PP2 的 closure 不以 LLM summary 为前提，而优先完成 budget truth、manual compact 与 degrade honesty？`
- **业主回答**：

### Q12 — PP3 是否承诺 `exactly-once replay`？（来源：`docs/design/pro-to-product/04-reconnect-session-recovery.md` D-04-1）

- **影响范围**：`PP3`、WS/replay contract、frontend recovery expectation
- **为什么必须确认**：如果默认承诺 exactly-once，PP3 scope 会立刻抬升到 event-store 级别，而这并不是当前阶段的目标。
- **当前建议 / 倾向**：**不承诺。** 只承诺 best-effort replay + explicit degraded contract。
- **Reasoning**：这个问题出现，是因为“断线恢复”很自然让人想追求强语义一致性。但 nano-agent 当前更现实的目标，是让前端在 replay 成功或失败时都拿到可信状态，而不是把底层存储升级成严格一次投递；如果不拍板，PP3 会被错误地抬成基础设施重构。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 PP3 不承诺 exactly-once replay，而以 best-effort replay + explicit degraded contract 作为 first-wave baseline？`
- **业主回答**：

### Q13 — PP3 是否继续维持 `single attachment`，而不支持多活动 attachment？（来源：`docs/design/pro-to-product/04-reconnect-session-recovery.md` D-04-2）

- **影响范围**：`PP3`、WS attach policy、frontend multi-device expectation
- **为什么必须确认**：如果这一点不冻结，reconnect / replay / presence 语义都会立刻复杂一倍。
- **当前建议 / 倾向**：**是。** 维持 single attachment。
- **Reasoning**：这个问题出现，是因为一旦讨论断线恢复，就会自然延伸到“多端同时在线”。但当前代码已经以 supersede + detached 为主线组织，继续维持 single attachment 最稳；如果不拍板，PP3 会在恢复链闭合前先陷入 presence 设计。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 PP3 继续以 single attachment 为基线，不在本阶段支持多活动 attachment？`
- **业主回答**：

### Q14 — replay gap / replay_lost 时，是否禁止 silent latest-state fallback，而必须显式 degraded？（来源：`docs/design/pro-to-product/04-reconnect-session-recovery.md` D-04-3）

- **影响范围**：`PP3`、`PP6`、session-ws / resume docs、frontend recovery UX
- **为什么必须确认**：如果允许 silent fallback，前端会误以为自己拿到了连续历史，实际却已经丢帧，恢复 contract 将不可信。
- **当前建议 / 倾向**：**禁止 silent fallback。** 必须显式 degraded / replay_lost。
- **Reasoning**：这个问题出现，是因为最新状态快照看起来像是一个“能继续用”的兜底，但它不能替代真实 replay 语义。推荐路线更稳，因为它让前端明确知道“你现在恢复的是 latest-state，而不是完整事件链”；如果不拍板，recovery 看似平滑，实际是在隐式吞掉断点。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 replay gap / replay_lost 时不允许 silent latest-state fallback，而必须显式向前端暴露 degraded verdict？`
- **业主回答**：

---

## 3. Hooks / Policy / Docs Closure

### Q15 — PP4 的最小 hook 范围，是否冻结为 `minimal live loop`，而不扩展 hook enum / full catalog？（来源：`docs/charter/plan-pro-to-product.md` §12 Q2、`docs/design/pro-to-product/05-hook-delivery-closure.md` D-05-1）

- **影响范围**：`PP4`、hook contract、action-plan scope 控制
- **为什么必须确认**：如果不冻结最小 hook 范围，PP4 极易从 caller wiring 演变成 catalog 扩张或平台化设计。
- **当前建议 / 倾向**：**是。** 只做到 `PreToolUse + 1 register source + 1 frontend-visible path` 的 minimal live loop，不扩 hook enum。
- **Reasoning**：这个问题出现，是因为当前 repo 已有 hook catalog / dispatcher substrate，最容易让人误以为“顺手全接通”才算完整。推荐路线更稳，因为 PP4 的真正目标是把至少一条 user-driven hook 闭合，而不是把 14/18 catalog 全部平台化；如果不拍板，PP4 会立刻 scope creep。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 PP4 只冻结 minimal live hook loop，不扩 hook enum、不追求 full catalog 接通？`
- **业主回答**：

### Q16 — PP4 是否禁止开放 `shell hook`？（来源：`docs/design/pro-to-product/05-hook-delivery-closure.md` D-05-2）

- **影响范围**：`PP4`、runtime safety、Cloudflare worker execution model
- **为什么必须确认**：如果 shell hook 被默许，PP4 会立刻跨到 runtime sandbox / security policy 的另一条产品线。
- **当前建议 / 倾向**：**禁止。**
- **Reasoning**：这个问题出现，是因为很多 CLI precedent 的 hook 都允许触发本地 shell。但 nano-agent 当前跑在 Cloudflare worker 语境里，开放 shell hook 不只是“多一个 handler”，而是完全不同的执行与安全模型；如果不拍板，PP4 的安全边界会失真。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 PP4 不开放 shell hook，而只允许符合 worker 运行边界的 hook form？`
- **业主回答**：

### Q17 — `PermissionRequest` 在没有 hook handler 时，默认策略应是 `fallback confirmation` 还是 `直接 fail-closed`？（来源：`docs/design/pro-to-product/05-hook-delivery-closure.md` D-05-3）

- **影响范围**：`PP4/PP5`、hook/policy 优先级、frontend permission UX
- **为什么必须确认**：如果这一点不冻结，PP4 action-plan 会在“保持安全”与“保持可用”之间摇摆，前端也无法确定无 handler 时的预期。
- **当前建议 / 倾向**：**优先 fallback confirmation；只有 confirmation substrate 不可用时才 fail-closed。**
- **Reasoning**：这个问题出现，是因为 PermissionRequest 同时踩在 hook、policy、HITL 三条链的交汇处。纯 fail-closed 最安全，但会把“没注册 handler”直接放大成产品死端；优先回退到现有 confirmation，更能复用 PP1 的真实 interrupt substrate，同时仍然维持安全边界；如果不拍板，PP4/PP5 会各自实现一套兜底逻辑。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`当 PermissionRequest 没有命中的 hook handler 时，是否确认优先回退到 confirmation 流程；只有 confirmation 本身不可用时才 fail-closed？`
- **业主回答**：

### Q18 — `/runtime` 中的 `config-only` 字段是否允许继续保留，但必须明确标成 `not-enforced`？（来源：`docs/charter/plan-pro-to-product.md` §12 Q1、`docs/design/pro-to-product/06-policy-reliability-hardening.md` D-06-1）

- **影响范围**：`PP5/PP6`、runtime docs、frontend truth、policy honesty
- **为什么必须确认**：如果这些字段继续存在却不标状态，前端会天然把它们当成 active policy；如果直接删掉，又会打断现有 runtime shape。
- **当前建议 / 倾向**：**允许保留，但必须明确标成 not-enforced / stored-only。**
- **Reasoning**：这个问题出现，是因为 nano-agent 当前已经有 `network_policy / web_search / workspace_scope` 等 durable config 字段，但执行约束尚未全部闭合。推荐路线更稳，因为它允许渐进收口，同时把 contract honesty 放在第一位；如果不拍板，PP5 和 PP6 只会继续积累 stored-not-enforced drift。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 runtime 中尚未闭合执行约束的 config-only 字段可以保留，但必须在 API/docs 中明确标成 not-enforced / stored-only？`
- **业主回答**：

### Q19 — stream retry 是否必须与 non-stream retry 完全对齐，还是允许采用“显式 degraded + client retry”作为 first-wave baseline？（来源：`docs/design/pro-to-product/06-policy-reliability-hardening.md` D-06-2）

- **影响范围**：`PP5`、LLM streaming reliability、frontend retry strategy、error docs
- **为什么必须确认**：如果不冻结 baseline，PP5 action-plan 会在“必须补内部 retry”与“先把 truth 写清”之间反复摇摆。
- **当前建议 / 倾向**：**不强求完全对齐；至少要做到 retry/error honesty，并明确是“内部 retry”还是“显式 degraded + client retry”。**
- **Reasoning**：这个问题出现，是因为 non-stream 与 stream path 当前可靠性能力不一致。推荐路线更稳，因为它优先消除 contract ambiguity，让前端知道什么时候该等平台重试、什么时候该自己 retry；如果不拍板，PP5 可能既没补齐机制，也没写清真相。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 PP5 不要求 stream retry 与 non-stream retry 完全对齐，但必须明确冻结为“实现内部 retry”或“显式 degraded + client retry”中的一种？`
- **业主回答**：

### Q20 — policy plane unavailable 时，是否禁止 `silent allow`？（来源：`docs/design/pro-to-product/06-policy-reliability-hardening.md` D-06-3）

- **影响范围**：`PP5`、runtime safety、tool authorization、error strategy
- **为什么必须确认**：如果 policy unavailable 时允许 silent allow，整个 policy 面都会退化成“有时生效、有时失效但没人知道”。
- **当前建议 / 倾向**：**禁止 silent allow。**
- **Reasoning**：这个问题出现，是因为任何 policy chain 在 first-wave 阶段都可能遇到配置缺失或控制面异常。推荐路线更稳，因为安全和诚实都要求 unavailable 至少变成可见 deny / degraded，而不能悄悄放行；如果不拍板，PP5 会留下最危险的一种模糊成功。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 policy plane unavailable 时不允许 silent allow，而必须显式 deny / degraded / error surfaced？`
- **业主回答**：

### Q21 — PP6 的 docs closure 是否要求相关功能都 `fully complete`，还是只要求 `truthful readiness`？（来源：`docs/design/pro-to-product/07-api-contract-docs-closure.md` D-07-2）

- **影响范围**：`PP6`、`clients/api-docs/**`、final closure honesty
- **为什么必须确认**：如果 docs closure 被理解成“所有功能必须 fully complete”，PP6 会被迫重开前面 phase 的实现边界；如果没有这个问题的明确答案，docs 又容易继续 overclaim。
- **当前建议 / 倾向**：**只要求 truthful readiness。** docs closure 不等于功能 fully complete。
- **Reasoning**：这个问题出现，是因为文档收口很容易被误会成“把所有功能都做到完美再写文档”。推荐路线更稳，因为 PP6 的目标是让前端拿到真实、可执行、不会误导的 contract；只要 readiness truth 诚实，first-wave / schema-live / not-enforced 也可以被正确文档化；如果不拍板，PP6 要么无限拖延，要么继续包装成 fake-live。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 PP6 的 docs closure 只要求 truthful readiness，而不要求相关功能在本阶段全部达到 fully complete？`
- **业主回答**：

### Q22 — PP6 是否引入 `OpenAPI / doc generator`，还是继续维持人工对账 + markdown truth？（来源：`docs/design/pro-to-product/07-api-contract-docs-closure.md` D-07-3）

- **影响范围**：`PP6`、docs maintenance strategy、future drift-control
- **为什么必须确认**：如果在 PP6 临时引入 generator，这一阶段会从 contract 对账扩张成文档基础设施建设。
- **当前建议 / 倾向**：**本阶段不引入。** 继续维持人工对账 + markdown truth，后续再评估 drift gates / generation。
- **Reasoning**：这个问题出现，是因为在做大规模 docs sweep 时，很容易自然想到“顺手把生成器一起上了”。但当前更紧迫的是先把既有 public contract 真相归零；如果不拍板，PP6 会把有限精力投入到工具链，而不是解决当前 drift。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 PP6 不引入 OpenAPI / doc generator，而先以人工 item-by-item 对账 + markdown truth 完成收口？`
- **业主回答**：

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

