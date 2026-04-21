# Worker-Matrix 上下文空间审查 — by Opus

> Status: `dialectical review — ready-with-minor-fixes`
> Reviewer: Claude Opus 4.7 (1M context)
> Date: 2026-04-21
> Scope: `docs/eval/worker-matrix/{agent-core,bash-core,context-core,filesystem-core,00-contexts}/**`
> 驱动问题:这些上下文是否充分、事实是否准确、能否直接支撑 worker matrix 基石设计?

---

## 0. 一句话结论

**这份 GPT 准备的 worker-matrix 上下文空间在"深度、精度、诚实度"三件事上已达到施工可用级别;但在"meta-doc 同步、跨-worker 交互矩阵、全局 readiness stratification、charter 模板 scaffold"这四件事上仍有可识别的 pre-construction 缺口。** 我的结论是 `ready-with-minor-fixes`: worker-matrix 可以立即基于 4 份 `index.md` + 各自的 `realized-code-evidence.md` 起草 charter,但在动第一行实装代码之前,还需要在这份审查的 §6 列出的 4 项补丁落地。

---

## 1. 审查方法与独立验证

### 1.1 覆盖面

本次审查读了:

- **4 份入口 index** (`agent-core`, `bash-core`, `context-core`, `filesystem-core`) — **全读**
- **实码证据** `realized-code-evidence.md` (agent + context) — 全读;bash + filesystem — 采样
- **协议合规** `internal-nacp-compliance.md` — bash 全读
- **外部面** `external-contract-surface.md` — filesystem 全读
- **平台证据** `cloudflare-study-evidence.md` — agent + filesystem 头部采样
- **meta-doc** `00-contexts/README.md` + `00-current-gate-truth.md` — 全读

共读 GPT 产出文档 **13 份**,外加 **代码事实交叉核查 8 处 citation**。

### 1.2 独立 citation 核查

我对 GPT 产出的 file:line 级别 citation 做了抽样:

| 抽检项 | 引用来源 | 核查结果 |
|---|---|---|
| `packages/session-do-runtime/src/composition.ts:82-106` — "default composition 返回空柄" | `agent-core/index.md:80`, `realized-code-evidence.md:23` | ✅ 代码 90-106 行逐字匹配 `kernel: undefined, llm: undefined, ...` |
| `packages/session-do-runtime/src/remote-bindings.ts:385-395` — "remote factory 仍未接 kernel/workspace/eval/storage" | 同上 | ✅ 385-395 行返回值结构 4 项仍 `undefined` |
| `packages/capability-runtime/src/fake-bash/commands.ts:15-315` — "canonical 21-command set 已注册" | `bash-core/index.md:84`, `bash-core/realized-code-evidence.md:19` | ✅ 16 行起 `MINIMAL_COMMANDS` 声明,文件 314 行,正确覆盖 |
| `packages/workspace-context-artifacts/src/mounts.ts:58-85` — "longest-prefix + `_platform/` reserved namespace" | `filesystem-core/index.md:80` | ✅ 73 行 `routePath()`,64-69 行文字说明 `_platform/` reserved |
| `packages/context-management/src/async-compact/index.ts:613-620` — "`restoreVersion` 仍 throw not-implemented" | `context-core/realized-code-evidence.md:94,297` | ✅ 613-621 行完整 throw `"restoreVersion(${...}): not implemented"` |
| `packages/nacp-core/src/messages/tool.ts:19-30` — "`tool.call.response` role gate = capability/skill" | `bash-core/internal-nacp-compliance.md:87` | ✅ 19-30 行 `registerMessageType` 三调用逐字匹配 |
| `packages/storage-topology/src/keys.ts:38-64` — "`_platform/` 只允许 feature flag KV 例外" | `filesystem-core/cloudflare-study-evidence.md:33` | ✅ 63 行唯一例外点 `featureFlags: () => "_platform/config/feature_flags"` |
| `packages/session-do-runtime/src/do/nano-session-do.ts:487-533` — "`acceptClientFrame` async await `verifyTenantBoundary`" | `agent-core/index.md:52`, `realized-code-evidence.md:106` | ✅ 当前代码状态(post-B9-R1 修复)与引用完全一致 |

**命中率 8 / 8。** 这是一个显著高于 B8/B9 文档初稿期 citation 准确率的水平。

---

## 2. 结构层审查 — 5-doc-per-worker scheme

### 2.1 scheme 的优点

每个 worker 都固定为:

1. `index.md` — 入口/定位/scope/证据优先级/阅读顺序
2. `realized-code-evidence.md` — 只看代码真相
3. `internal-nacp-compliance.md` — 协议契约归属与职责
4. `external-contract-surface.md` — 对外暴露面 (package API + consumer + runtime assembly)
5. `cloudflare-study-evidence.md` — 平台事实与 `context/` 参考实现对比

**这套 scheme 本身是有价值的:**

- **正交性强**:5 类问题之间 zero overlap (代码真相 ≠ 协议契约 ≠ 外部 API ≠ 平台约束)
- **单文件 cognitive load 可控**:每份 8-18k 字符,不会出现 "一个大文件把所有事都说了一遍"
- **召回路径稳定**:所有文档都重复了"原始素材召回表 + 当前应冻结的五个判断 + 当前仍开放的关键缺口"的三段式,worker-matrix 作者可以用同一套阅读心智穿过 4 个 worker

### 2.2 scheme 的风险

**没有跨-worker 的交互矩阵文档。**

每个 worker 自述"我对外暴露什么",但没有一份文档把 `agent.core × bash.core × context.core × filesystem.core` 的 4×4 交互矩阵显式画出来。具体缺失的交叉问题:

- `agent.core → bash.core` 默认 `tool.call.*` 主链 + 异常回包格式?(只在 bash 文档里有,agent 文档未对称引用)
- `agent.core → context.core` 的 `body.initial_context` 消费时序?(两边都承认未接,但没有一份文档说"它由谁负责接、什么时候接")
- `bash.core → filesystem.core` 的 workspace truth 共享契约?(filesystem 文档承认 fake-bash handlers 消费同一 workspace,但没有把这条 invariant 提到 cross-worker level)
- `context.core ← everywhere` 的 evidence vocabulary 归并规则?(context 文档说了自己收什么,但没有说明 bash 产 progress / agent 产 stream.event 时是否会被 context.core 误收)

这不是 blocker,但它意味着 **worker matrix charter 阶段必须多做一步**:从 4 份 external-contract-surface 手工推导出 4×4 interaction matrix,然后才能画 dependency graph。

---

## 3. 事实准确性审查

### 3.1 总体评价:**非常高**

8 处 citation 全部命中;所提代码位点在当前 repo 真实存在,且 line range 误差 < 3 行。更关键的是:

- **B9-R1 post-fix 状态被正确反映**:`agent-core/index.md:52` 与 `realized-code-evidence.md:106, 297` 都明确写 `acceptClientFrame` 已 `await verifyTenantBoundary`,与我上一轮的修复 100% 对齐。
- **误判空间已经自我消除**:`agent-core/realized-code-evidence.md:293-300` 专门做了"历史 review vs 当前代码真相"的三行表,明确写出 `以当前代码为准`。这是成熟的反漂移纪律。

### 3.2 已识别的 staleness 与不一致点

**唯一显著的 staleness 点在 meta-doc:**

`00-contexts/00-current-gate-truth.md:38-49` 仍然写:

> 最新 GPT 实现 review 结论为 `changes-requested`,不是 closed。
>
> 两个问题立即影响 worker-matrix 规划:
> 1. `NanoSessionDO.acceptClientFrame()` wires `verifyTenantBoundary()` as fire-and-forget …
> 2. `wrapAsError()` does not currently produce a legal per-verb error envelope …
> 3. `packages/nacp-session/README.md` still carries one stale Core-owned phase-gate statement

这三条 finding 我**都已经在上一轮整改里修复**并在 `docs/code-review/after-foundations/B9-reviewed-by-GPT.md` §6 response 里记录完成:

- R1 blocker 已通过 `acceptClientFrame` async + `await verifyTenantBoundary` + typed rejection 修复 — 新增 negative-case test 锁行为;
- R2 已通过 `NACP_ERROR_BODY_VERBS` registry + `target_message_type` override + RFC/closure/CHANGELOG 四处 provisional 标注收窄;
- R3 已通过 `packages/nacp-session/README.md` 相关段落重写修复。

但 `00-current-gate-truth.md` 不知道这些修复。**这意味着 meta-doc 的 "latest review truth" 早于 worker-level doc 的 "post-fix state"。**

**风险**:如果 worker-matrix 作者完全按 `README.md` 推荐的阅读顺序读(meta-doc 在最先),会被误导。
**缓解路径**:worker-level `index.md` 由于自带 §2 "证据优先级 + 当前代码锚点",能覆盖掉 meta-doc 的 staleness — 但这是事后救场,不是事前防线。

**另外一处次级 drift:** `00-contexts/README.md:45-47` 把 `B9-final-closure.md` 与 `after-foundations-final-closure.md` 划为 "not as clean entry"。在 B9 review 的整改后,这两份 closure 的 §6/§8 已分别加入 revision note 与 close-out。因此 `not part of the bundle core` 的理由已经部分失效;它们现在可以作为 historical + revision record 一并阅读。

---

## 4. 范围与边界审查

### 4.1 Scope 的明显覆盖

每个 worker 都显式列出:

- In-Scope 四类问题(定位 / 协议责任 / 代码真相 / 平台边界)
- Out-of-Scope 四类排除(其它 worker 细节 / 越线扩张 / 历史文档重写 / 早期冻结)
- Open Gaps 表

**这套"scope + anti-scope + gaps"的三元约束是本次 GPT 产出最扎实的部分。** 任何一份 worker-matrix charter 都可以 directly 消费这三张表来定自己的边界,不需要重新推导。

### 4.2 Scope 的隐性空白

**最显著的空白:`skill.core` 缺席。**

B8 handoff memo 的 naming proposal 里明确写了五个 first-wave candidates:`agent.core / bash.core / context.core / filesystem.core / skill.core (reserved)`。但 `docs/eval/worker-matrix/` 只准备了 4 个,**`skill.core` 没有目录**。

这是有原因的(skill.core 当前是 reserved slot,不是 first-wave impl 对象),但没有一份文档显式说"为什么 skill.core 不在这次 context bundle 里"。**这是一个 discoverability 问题**:新上手的 worker-matrix 作者会想"skill.core 是漏了还是故意不做?",而现在没有直接答案。

### 4.3 Scope 的跨边界漏洞

- **`agent.core` 对 `initial_context` 消费点的归属**:`agent-core/realized-code-evidence.md:280-290` 正确指出 "schema 已冻结、host consumer 未实现",但没有说 "consumer 应归属于 agent.core 还是 context.core?"。两边都有"这不是我们这里做的"的暗示,但没有一边明确宣称"所以它归 X"。这是一个典型的 cross-worker orphan 责任。

---

## 5. 逐 worker 辩证评价

### 5.1 `agent.core` — **评级:A / ready**

**最强项**:

- 明确把 host = `NanoSessionDO` 这一物理事实钉死(index §4、realized §2.2)
- 区分了"已真实存在"(host shell、ingress、orchestration、checkpoint、evidence sink)与"只是 handle"(kernel、llm、workspace 仍 undefined)
- 显式反对三种越界解读:binding slot / 长期记忆 orchestrator / greenfield

**辩证保留**:

- §4 "当前应冻结的五个判断" 里第 5 条写"默认 host 能跑 session shell,但还没有默认跑出真实 agent turn loop" — 这个措辞对 charter 阶段太轻。worker-matrix Phase 0 首要任务就是 **给 default composition 装上 kernel + llm**,所以这条应升级为 "Phase 0 的唯一必要里程碑"。

### 5.2 `bash.core` — **评级:A / ready**

**最强项**:

- 准确区分了 "fake-bash 执行引擎"(真实存在)与 "独立 worker shell"(仍缺)
- `internal-nacp-compliance.md` 把 "bash.core 拥有 `tool.call.*`、**不**拥有 `session.*`" 这条分层写得极其清楚 — 这是避免 `bash.core` 越界的关键保护栏
- 明确接受 `ts-exec` 是 honest partial,不 paper over

**辩证保留**:

- `cloudflare-study-evidence.md` 对 `curl` low-volume 可行性(F09 finding)的采信度略高。B7 LIVE 已经证明 25 fetches 以下稳定,但第一波 `bash.core` worker 仍然不应该把 `curl` 当成 bolted-in 能力;`network.ts` handler 与 budget guard 的边界应该保持 conservative default。这点索引已经提到("high-volume curl cap" 在 open gaps 里),但 worker-matrix charter 需要把它提升为 "first-wave default = conservative, post-LIVE-reverify can widen"。

### 5.3 `context.core` — **评级:A- / ready-with-caveat**

**最强项**:

- 坦承 `context.core` 是 "薄 substrate,不是独立 context engine",这与 worker-matrix eval 两次评估(GPT + Opus)一致
- 显式把 `CompactBoundaryManager` 与 `nacp-core` `context.compact.*` 对齐证明作为最 formal 的协议点(realized §3.2)
- 诚实标注 `restoreVersion` 仍 throw not-implemented,不掩盖

**辩证保留**:

- `context.core` 与 `agent.core` 的 `initial_context` consumer 责任归属仍模糊(见 §4.3 cross-boundary 漏洞)
- **inspector facade 的默认启用态**在 `index.md:138` 列为 "gap",但没有给出"什么时候应该启用 / 启用的 owner 是谁" — 这对 worker-matrix charter 作者缺少决策锚点
- smind-contexter learnings 的借鉴范围收窄到 "future direction",这是正确的;但没有给出"如果未来要接,哪几个字段/seam 是最关键 handoff 点" — 比如 `initial_context.warm_slots` 是否映射到 smind 的 L2 Swap slots

### 5.4 `filesystem.core` — **评级:A- / ready-with-caveat**

**最强项**:

- 三层 external surface 的分层(workspace package API / fake-bash consumer API / runtime assembly seam)非常清晰
- 对 `_platform/` reserved namespace 的多处代码引用(mounts.ts + keys.ts)相互印证
- 对 `mkdir partial` / `rg subset` / `git readonly` 三条残留事实坦承

**辩证保留**:

- `ReferenceBackend` 的 connected mode 被正确标为 "已有实码",但文档没有说"第一波 worker 是否需要把它激活?还是保持 memory-only?"。这是 worker-matrix charter 要回答的关键 Phase 0 设计点,GPT 未留指引。
- `just-bash` 参考实现的"不要照搬"口径写得很好,但没有提炼出"可以借鉴哪 3 个 primitive"(比如 `MountableFs` 的 longest-prefix 算法已经被借鉴,但其他 primitive 列表不清)

---

## 6. Pre-construction 缺口 — 在动 worker-matrix 第一行代码前必补的 4 项

基于本审查,我判断以下 4 项是 worker-matrix Phase 0 启动前的**硬前置缺口**:

### 6.1 `[补丁-1]` 同步 `00-current-gate-truth.md` 到 post-B9-review 整改状态

- 当前 staleness:meta-doc 仍然描述 R1/R2/R3 为 live blocker,不知道已修复
- 建议动作:在 meta-doc §3 追加 "Revision 2026-04-21:这三条 finding 已在 `B9-reviewed-by-GPT.md` §6 response 整改完成" + 指向 `B9-final-closure.md` 顶部 revision note
- 估工:< 30 分钟

### 6.2 `[补丁-2]` 补一份 `cross-worker-interaction-matrix.md`

- 当前缺失:4 个 worker 各自说"我对外 expose 什么",但 4×4 交互矩阵没被显式画出
- 建议动作:在 `docs/eval/worker-matrix/` 根目录新增一份文档,用 4×4 表格 + 每格标注"A 调用 B 的 seam 是什么 / 当前代码状态 / 第一波是否必做"
- 估工:2-3 小时,但这是 charter 阶段省时间的关键投入

### 6.3 `[补丁-3]` 补一份全局 `worker-readiness-stratification.md`

- 当前缺失:每个 worker 各自有 "open gaps" 表,但没有全局比较
- 建议动作:一张大表,列 4 × worker × 维度(registry / package / default composition / remote seam / tests / deploy shell),用 `real / seam / missing / not-yet` 四级标注。这能让 charter 作者一眼看出"哪些是 Phase 0 必补、哪些可延后"
- 估工:1 小时
- 草案建议:

  | 维度 | agent.core | bash.core | context.core | filesystem.core |
  |---|---|---|---|---|
  | 核心 package | real (session-do-runtime) | real (capability-runtime) | real (context-management + workspace-context-artifacts) | real (workspace-context-artifacts + storage-topology) |
  | 默认 composition 装配 | seam only (undefined) | seam only (via CAPABILITY_WORKER) | partial (workspace trio mounted, context-management 未装) | partial (default DO path 会 mount workspace trio) |
  | 独立 worker shell | missing | missing | missing | missing |
  | remote service-binding | seam only (CAPABILITY_WORKER/HOOK_WORKER) | seam only (CAPABILITY_WORKER) | not-yet | not-yet |
  | tests 覆盖 | real (357 session-do + 17 B9 root) | real (352 capability + integration) | real (97 context-management + 192 workspace) | real (192 workspace + 169 storage) |
  | deploy-shaped Worker | absent | absent | absent | absent |

### 6.4 `[补丁-4]` 补一份 `skill-core-deferral-rationale.md`

- 当前缺失:`skill.core` 没有目录,且没有 explicit 说明"为什么不在这次 first-wave context bundle 里"
- 建议动作:一页纸解释 skill.core 作为 reserved slot 的边界 + 未来何时入场的 prerequisite
- 估工:< 1 小时
- 这条看似小,但避免未来 3-6 个月里反复被问 "skill.core 是漏了还是故意不做"

---

## 7. 我对 GPT 方法论的辩证肯定

### 7.1 做得好的地方

1. **"证据优先级"这条元规则被显式写死且反复引用。** 4 份 index.md 的 §2 都重复同一个优先级:当前代码 > 原始 action-plan / review / evaluation > `context/` 参考实现 > 较早的 closure 口径。这是一个高质量反漂移工程纪律,比很多实际代码仓库的 contribution guide 更严。
2. **"当前应冻结的五个判断"这个模板是有价值的创造。** 把一个复杂 worker 的 positional truth 压缩到 5 条(身份、最扎实代码面、核心法则、remote seam 现状、第一波姿态),每条带 3-5 条 citation。这是后续 charter 作者能够直接引用的最小闭合 claim 集合。
3. **对"历史印象 vs 当前代码真相"的交叉判断表。** `agent-core/realized-code-evidence.md:293-300` 明确列出 tenant verify / host evidence / agent loop 三条 issue 各自"历史印象"与"当前真相",并给出裁判口径。这种结构非常适合多 AI / 多次 review 的协作场景。

### 7.2 仍可加强的地方

1. **cross-worker 视角缺位**:GPT 的 scheme 按 worker 正交切分,但 worker 间 interaction 没被独立文档化。**对 charter 阶段来说,interaction 比 worker 本身更重要**,因为 charter 要回答"这 4 个 worker 要不要拆"和"先做哪个"。
2. **readiness 分层仅限局部**:每份 index 的 §6 open gaps 表只覆盖自身 worker;没有 meta-level readiness matrix。
3. **meta-doc 同步滞后**:`00-current-gate-truth.md` 和各 worker `index.md` 之间存在时间差,这反映了"meta-doc curation 不是 monotonic"的问题。未来应该明确规定:每次 per-worker doc 更新都必须同步 meta-doc。

### 7.3 对"薄做"(conservative-first)基调的 100% 支持

4 份 index.md 全都在关键节点强调"薄做 / conservative / 不要一步到位":

- `agent.core` 不是"万能 controller"
- `bash.core` 不是"完整 shell"
- `context.core` 不是"完整 slot/rerank engine"
- `filesystem.core` 不是"完整 POSIX FS"

这条基调**我完全赞同**。worker-matrix Phase 0 的目标不是"交付 4 个完美 worker",而是"从 substrate 过渡到首个 deploy-shaped composition"。任何把 scope 一步做到位的设计都会在 Phase 1-2 被迫回滚。GPT 的 conservative-first 基调与 nano-agent 既有的"freeze biggest cognition range"纪律相兼容。

---

## 8. 综合 verdict

| 维度 | 评分 | 说明 |
|---|---|---|
| 结构完整性 | **A** | 5-doc-per-worker scheme 正交稳定 |
| 事实准确性 | **A+** | 8/8 citation 命中,高于初稿期水平 |
| 证据优先级纪律 | **A** | 显式书面 + 反复引用 |
| 范围边界清晰度 | **A-** | In/Out/Gap 三元约束成熟;skill.core 缺席未注释 |
| 跨-worker 集成视角 | **B+** | 4 份各自优秀,4×4 交互矩阵缺失 |
| 全局 readiness 分层 | **B** | 局部 gap 表完整,全局 readiness stratification 缺 |
| Charter 可启动性 | **A-** | 4 份 index + realized-code 已足够 charter drafting;4 项补丁后可直接施工 |
| 诚实度 | **A+** | "not yet" / "honest partial" / "still open gate" 出现频率极高,未见 paper over |

**整体 verdict:`ready-with-minor-fixes`**

- **可以立即开始** worker-matrix charter 草稿工作(基于 4 份 index + realized-code-evidence)
- **开始第一行实装代码之前**必须先落地 §6 的 4 项补丁 — 尤其是补丁-2 (cross-worker interaction matrix) 与补丁-3 (readiness stratification)
- **不需要** 重写现有文档;现有 13 份产出 quality 足够高,补丁是追加不是重构

---

## 9. 给 worker-matrix charter 作者的使用建议

1. **从 4 份 index.md 开始读**,跳过 00-contexts/ 的旧 meta-doc(直到 §6.1 补丁落地)
2. **遇到"以什么为准"的冲突时,应用 4 份 index §2 的证据优先级规则**:当前代码 > 原始文档 > 参考实现 > 旧 closure
3. **把每份 index §4 的"五个判断"直接复制到 charter 的 §1 positional truth 里**,不需要重新推导
4. **把每份 index §6 的 open gaps 表合并成一张全局 gap 表**,charter 的 Phase 0 scope 就应该按这张表选优先级
5. **补丁-2 产出的 cross-worker interaction matrix 一旦就绪,应作为 charter 的 §2 dependency graph 输入**
6. **charter 最终不应超过 5-10 页**;长不代表准,短意味着已经吃透了这 13 份上下文

---

## 10. 最终判断

这份 worker-matrix 上下文空间是 **严肃、扎实、诚实** 的 pre-construction artifact。它没有把 B8/B9 的积累讲成"什么都搞定了",也没有把 Phase 0 的未来任务讲成"greenfield";它在两者之间维持住了 "substrate 已成熟、composition 仍待接线" 这个精确的中间态表述。

这种表述本身就是可贵的 — 在大多数项目里,这个中间态要么被 overclaim 成 "closed",要么被 underclaim 成 "nothing ready"。GPT 在这里守住了中间。

**我支持 worker-matrix 基于这份 context space 继续施工,前提是落地 §6 的 4 项补丁。**
