# Orchestration Facade — FX QNA

> 范围：`orchestration-facade / F0-F5`
> 目的：把会影响后续 `F0 design freeze / F1-F5 action-plan / closure` 的业主 / 架构师决策收敛到一份单一清单，避免在多个 design 文档中重复回答、重复漂移、重复改口。
> 使用方式：
> 1. **业主只在本文件填写回答。**
> 2. 其他 design / action-plan / memo 若引用某个 `Q` 编号，默认都以本文件为唯一答复来源。
> 3. 各具体文档不再逐条填写 QNA；如仍保留“已确认 / 已冻结”的历史表述，应理解为上下文说明，后续统一以本文件回填结果为准。
> 4. `Q` 编号应保持稳定；后续若补题，从最后一个编号继续追加。

---

## 1. Internal Contract / Stream Contract

### Q1 — internal auth header 的 first-wave 形态是否接受“shared secret header”作为 frozen baseline？（来源：`F0-agent-core-internal-binding-contract.md`）

- **影响范围**：`agent.core` internal route、`orchestrator.core` binding client、F1 integration tests
- **为什么必须确认**：如果不拍板，F1 会在“纯 header”与“签名载体/更复杂 token”之间摇摆，导致 internal contract 迟迟无法冻结。
- **当前建议 / 倾向**：**先接受 shared secret header 作为 first-wave frozen baseline**；未来若需要更强 identity，再升级为签名或平台级身份。
- **Reasoning**：这个问题会出现，是因为 `orchestrator -> agent` internal contract 既不能只信 transport，也不值得在第一版就造一套更重的内部身份系统。当前推荐路线更稳，是因为它足以把 internal request 与 public request 区分开，又不会把 F1 的实现复杂度抬高太多。如果现在不拍板，internal binding contract 这份 design 就会停留在“抽象同意，落地不同意”的状态，F1 会重新变回 ad-hoc fetch 胶水。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`F1 是否确认采用 shared secret header 作为 first-wave internal auth gate？如果不同意，请明确是要签名 token，还是平台身份方案。`
- **业主回答**：

### Q2 — internal stream relay 是否正式冻结为 `HTTP streaming + application/x-ndjson + meta/event/terminal`？（来源：`F0-stream-relay-mechanism.md`）

- **影响范围**：`agent.core` internal stream route、`orchestrator.core` relay reader、reconnect cursor、F1/F2 integration tests
- **为什么必须确认**：如果 framing 不冻结，F1/F2 会在 NDJSON、SSE-like、custom JSON chunk 三种形态间漂移。
- **当前建议 / 倾向**：**冻结为 `HTTP streaming + application/x-ndjson`，并采用 `meta` / `event` / `terminal` 三类 frame。**
- **Reasoning**：这个问题会出现，是因为 r2 虽然已经拍板“HTTP streaming response”，但还没有把 framing 层写成唯一真相。当前推荐路线更稳，是因为 NDJSON 简单、可调试、与 fetch/Readable body 心智一致，而且非常适合 first-wave 的 worker-to-worker relay。如果现在不拍板，stream relay 会成为 F1/F2 最大的返工点，尤其是在 reconnect、terminal 语义、日志诊断上。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`first-wave internal stream framing 是否确认采用 NDJSON 三类 frame？如果不同意，请明确替代 wire shape。`
- **业主回答**：

---

## 2. Session Registry / Reconnect

### Q3 — first-wave 是否确认采用“single active writable attachment”作为默认 attach/reconnect 规则？（来源：`F0-session-lifecycle-and-reconnect.md`）

- **影响范围**：public WS attach、reconnect、user DO registry、F2 tests
- **为什么必须确认**：如果不确认，多 tab / 多 attachment 的行为会在实现时继续模糊，F2 容易陷入无休止 edge-case 讨论。
- **当前建议 / 倾向**：**确认 single active writable attachment**；新 attachment 可接管旧 attachment，multi-tab richer 行为延后。
- **Reasoning**：这个问题会出现，是因为 façade 接管 public WS 后，必须有人回答“一个 session 到底允许几个活跃客户端同时写”。当前推荐路线更稳，是因为它把 first-wave 问题降到最可控：只有一个写者、一个当前 relay owner，旧连接被 supersede。如果现在不拍板，F2 的 attach/reconnect 代码会在“是不是要支持多 tab 并发写”上失控，测试也会失去明确验收边界。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`first-wave attach/reconnect 是否确认 single active writable attachment？如果不同意，请明确是多写者还是读写分离模型。`
- **业主回答**：

### Q4 — ended session 的 recent metadata 是否允许 bounded 保留窗口？（来源：`F0-user-do-schema.md`）

- **影响范围**：user DO schema、registry cleanup、terminal session status/timeline 行为
- **为什么必须确认**：如果不确认，`active_sessions` 是只保活跃中，还是允许短期保留 ended metadata，会直接影响 schema 与 cleanup 设计。
- **当前建议 / 倾向**：**允许 bounded recent-ended metadata**，例如时间窗口或数量窗口；不做 full archive。
- **Reasoning**：这个问题会出现，是因为 first-wave 既不想引入完整 history domain，又不能在 session 一结束就把一切事实抹掉，否则状态读取、错误诊断、刚结束后的查询都会变得困难。当前推荐路线更稳，是因为它只保留少量、短期、最小必要的 terminal metadata，既能支撑实际使用，又不会把 user DO 拉成 history store。如果现在不拍板，schema 与 lifecycle 文档会一直停留在“可能 purge / 也可能保留”的模糊状态。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`first-wave 是否允许 bounded recent-ended metadata 保留？如果允许，请确认更倾向时间窗口还是数量窗口。`
- **业主回答**：

---

## 3. Tenant Truth / Authority Law

### Q5 — preview / prod 是否明确要求显式配置 `TEAM_UUID`，不得继续依赖 `_unknown` fallback？（来源：`F4-authority-policy-layer.md`、`docs/plan-orchestration-facade.md`）

- **影响范围**：wrangler config、preview deploy、tenant law、negative tests
- **为什么必须确认**：如果不拍板，single-tenant-per-deploy 仍会停留在“概念上同意、配置上没落实”的状态。
- **当前建议 / 倾向**：**确认 preview / prod 必须显式配置 `TEAM_UUID`**；`_unknown` 只允许本地或测试兜底。
- **Reasoning**：这个问题会出现，是因为当前运行时代码已经把 `TEAM_UUID` 当成 tenant truth，但 preview wrangler 现实里还没显式提供它。当前推荐路线更稳，是因为它把“first-wave tenant truth = single-tenant-per-deploy”从纸面设计变成真实 deploy discipline。如果现在不拍板，F4.A 的 authority law 会变成半真半假：代码看起来有 tenant 边界，实际 preview 却可能继续跑在 `_unknown` 上。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`preview / prod 是否确认强制显式配置 TEAM_UUID？`
- **业主回答**：

### Q6 — 当 JWT 中没有 `tenant_uuid` claim 时，first-wave 是否接受“用 deploy tenant truth 隐式补足”？（来源：`F4-authority-policy-layer.md`）

- **影响范围**：JWT ingress、tenant mismatch policy、F4 negative tests
- **为什么必须确认**：tenant claim 缺失到底是允许还是必须报错，会直接影响 public ingress policy helper。
- **当前建议 / 倾向**：**允许 claim 缺失，但如果 claim 存在则必须与 `TEAM_UUID` 一致。**
- **Reasoning**：这个问题会出现，是因为 first-wave 同时存在两个事实：一方面 current runtime 以 deploy-level tenant truth 为主，另一方面 façade 又会处理 JWT。当前推荐路线更稳，是因为它与“single-tenant-per-deploy”一致：tenant 真相仍来自部署，claim 只是附加验证，而不是唯一来源。如果现在不拍板，JWT policy helper 在实现时要么过严（逼所有 token 都带 tenant），要么过松（claim mismatch 也不管），两边都容易出问题。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`first-wave 是否确认“tenant claim 可缺失，但若存在必须匹配 TEAM_UUID”？`
- **业主回答**：

---

## 4. Cutover / Testing Strategy

### Q7 — legacy `agent.core` session routes 是否在 F3 exit 后立即进入 hard deprecation，而不是再保留一个 post-F3 grace window？（来源：`F0-compatibility-facade-contract.md`）

- **影响范围**：F3 cutover、legacy route behavior、closure criterion #2
- **为什么必须确认**：如果 F3 exit 后还留额外 grace window，canonical ingress 的定义会再次变模糊。
- **当前建议 / 倾向**：**F3 exit 后立即 hard deprecate**；迁移窗口只存在于 F3 执行期。
- **Reasoning**：这个问题会出现，是因为工程上大家都喜欢给 legacy 路由“再多留一点保险时间”，但本阶段真正要修的正是 dual-ingress tech debt。当前推荐路线更稳，是因为它把迁移窗口限制在执行阶段内部，而不是让“临时兼容”再次变成常态。如果现在不拍板，F3 closure 很容易写成“理论上切换完成，但 legacy path 还在跑”，那 canonical ingress 就仍然没有真正成立。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`是否确认 F3 exit 后 legacy session routes 立即 hard deprecate，不再保留额外 grace window？`
- **业主回答**：

### Q8 — F3 测试迁移是否确认采用“新增 `test/package-e2e/orchestrator-core/`”作为推荐路径？（来源：`F0-live-e2e-migration-inventory.md`）

- **影响范围**：test tree、live harness、`test/INDEX.md`、F3 action-plan
- **为什么必须确认**：如果不拍板，F3 会在“原地改 agent-core 测试”与“新增 orchestrator-core suite”之间反复摇摆。
- **当前建议 / 倾向**：**确认新增 `test/package-e2e/orchestrator-core/` 作为 canonical public suite**；agent-core 保留 probe/internal verification tests。
- **Reasoning**：这个问题会出现，是因为 canonical public owner 已经从 `agent.core` 变成 `orchestrator.core`，而测试树理应同步表达这件事。当前推荐路线更稳，是因为它让目录结构本身就说出架构真相：public suite 属于 orchestrator，agent-core 的 package-e2e 回到 internal/probe/posture 验证。如果现在不拍板，F3 迁移会既改路径又不改结构，最后人和文档仍会把 agent-core 当默认 public worker。

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`F3 是否确认新增 orchestrator-core package-e2e suite，而不是只在 agent-core 原文件上原地改 URL？`
- **业主回答**：

---

## 5. 使用约束

### 5.1 哪些问题应该进入 QNA

- **会直接改变 contract surface、实现边界、执行顺序、验收标准或支持面披露的问题**
- **需要业主 / 架构师拍板，而不是实现阶段自己就能收敛的技术细节**
- **如果不先拍板，就会导致多个后续文档一起漂移的问题**

### 5.2 哪些问题不应进入 QNA

- **实现细节微调**：例如单个文件内的 helper 命名、局部 refactor 手法
- **已有 frozen answer 的重复提问**：除非本次要正式推翻旧答案
- **只影响单个函数或单个包内部实现、不会改变阶段治理边界的问题**

### 5.3 `Reasoning` 的写法要求

- 要写给**非项目作者、但需要做决策的人**
- 要解释：
  1. **这个问题为什么会出现**
  2. **为什么当前推荐路线更稳**
  3. **如果不拍板，会导致什么工程或业务后果**
- 避免只写“建议这样做”，而不解释其背后的 trade-off

### 5.4 `问题` 的写法要求

- 必须是**业主可以直接作答**的句子
- 尽量避免把多个独立决策捆成一题
- 若问题天然包含两个子决策，需在问题里明确写出“如果确认，请同时回答 X / Y”

### 5.5 `业主回答` 的使用要求

- 业主回答应尽量简洁、明确、可执行
- 一旦填写，应同步成为后续 design / action-plan / review 的唯一口径
- 如果后续要推翻答案，应在同一份 QNA 中追加修订说明，而不是在别处悄悄改口
