# Before Worker Matrix — Spike-Worker & Pre-Matrix Phase Evaluation by Opus

> 状态：`独立辩证评估 (independent dialectical review)`
> 对象：用户的"在 worker matrix 之前再加一个 after-foundations 阶段 + spike worker probe"提案
> 写作时间：2026-04-19
> 立场：**实质性地同意，并强化**

---

## 0. 思维链承接（reference 之前的所有讨论）

为了让本文不失语境，下面是这条思维链按时间顺序的全部 artefacts。建议读者先按这个顺序读完，再读本文。

| 文件 | 作者 / 立场 | 主张 |
|---|---|---|
| `docs/plan-after-nacp.md` | 立项基线 | NACP 协议族落地 |
| `docs/plan-after-skeleton.md` | 立项基线 | Skeleton + A1-A10 收尾 |
| `docs/code-review/after-skeleton/A*-reviewed-by-GPT.md` (5 篇) | GPT 第一轮代码审查 | A1-A10 各阶段独立 review |
| `docs/code-review/after-skeleton/A*-reviewed-by-Kimi.md` (5 篇) | Kimi 第一轮代码审查 | 同上 |
| `docs/code-review/after-skeleton/A1-10-2nd-round-reviewed-by-GPT.md` | GPT 二轮 | 三个 R1/R2/R3 finding |
| 同文件底部 §6 + §7 | Opus 修复 + GPT 三轮 verdict | R2 default sink missing 已闭合 |
| **`docs/eval/new-plan-by-Opus.md`** | Opus 提案（旧） | **Phase 8 = 单 worker、Real Agent Loop & Worker Realization**；本质上是把 KernelRunner 接进 session-do-runtime，跑通单 worker 内部 turn |
| **`docs/eval/after-foundations/worker-matrix-eval-with-GPT.md`** | GPT 评估 | **5 个 worker 都建成 real worker，但厚薄不同**（3 load-bearing + 2 real-but-thin）；推荐 worker matrix 作为 next phase |
| **`docs/eval/after-foundations/worker-matrix-eval-with-Opus.md`** | Opus 提案（中） | 比 GPT 更保守一档：**3 worker 立项 + 2 reserved binding 名额**；W1-W4 实现路径 |
| **本文 — `before-worker-matrix-eval-with-Opus.md`** | 用户新立场 + Opus 评估（新） | **再退一步：worker matrix 之前先做 spike worker probe**；本文论证为什么这是正确的退一步 |

也就是说，这条思维链已经经历了三次正向修正：

```
Opus(单 worker, 内部闭环)
  → 用户 / GPT(5 worker matrix, 直接落地)
    → Opus(3 worker matrix, 立刻做)
      → 用户(spike worker probe, 先验证再立项)  ← 本文评估对象
```

每一次修正都是把"什么时候算 ready 进入 deployable phase"这个判断**更保守一档**。本文的核心问题就是：**这一次的更保守，是过度谨慎，还是必要的现实校准？**

我的判断：**是必要的现实校准，不是过度谨慎。**

下面分七节论证。

---

## 1. 一句话先给结论

> **同意。而且我认为这是这条思维链上至今最重要的一次修正——它把"我们以为 packages 已经 ready"的隐性假设第一次推到 Cloudflare runtime 真实事实面前去验证，而不是继续在本地 vitest 与 fake transport 里假装 ready。**

更具体地：

- ✅ 同意 worker matrix 之前需要插入一个 **`pre-matrix probing` 阶段**
- ✅ 同意用 **spike worker** 这种"无业务意义、可重写、可销毁"的 probe 形态来做验证
- ✅ 同意你列的 5 项缺口大体正确，下面会逐项以代码事实加权评估
- ⚠️ 对其中一项（hooks 分类补充）我有更强烈的意见——它**应该**做，但**不应该**与 spike 一起做，而是 spike 验证后才做
- ⚠️ 对 spike worker 的形态本身有一些细化建议（不是 1-2 个 worker，而是**1 个 spike worker + 1 个 spike-pair worker**）

---

## 2. 这条思维链的 meta-观察：我们在反复学习同一个教训

把上面 4 步修正放在一起看，其实是同一个教训以不同形式重复出现：

> **本地 vitest + fake transport 测试通过 ≠ Cloudflare runtime 部署后行为正确。**

这个 gap 在每一次提案被 review 时都被低估：

- Opus 第一次：默认"kernel 接通即可"，没问 KernelRunner 在真实 DO 里的 hibernation 行为
- 用户 / GPT 第一次：默认 5 个 worker 直接立项，没问 service-binding 在真实 deploy 下的 timeout / cancellation 形态
- Opus 第二次：默认 3 个 worker 立项即可，没问 R2 promotion 在真实 R2 上的 latency / consistency 行为
- 用户这次：终于把这个隐性假设**显式化**——"我们还没在 Cloudflare 真实环境里验证过任何东西"

这个 meta-观察很重要，因为它解释了为什么你的 spike worker 思路是**结构性正确**而不是单纯的谨慎：

> **它把"未经 Cloudflare runtime 验证的代码"标记为不可信，并设立一个独立的、可销毁的容器去做验证——这是正确的工程方法论。**

在硬件领域这叫做 "FPGA prototyping before tape-out"；在系统软件领域这叫做 "spike before commit"；在 SRE 领域这叫做 "canary before rollout"。它不是过度谨慎，是行业共识。

---

## 3. 对你列出的 5 项缺口的逐项代码事实评估

下面用真实代码事实给每一项打分。打分维度是：**"这一项缺口在真实 Cloudflare deploy 之前能被本地测试检出吗"**。

如果答案是"不能本地检出"，就证明这一项必须用 spike worker 来验证；如果答案是"能本地检出"，则该项不需要 spike，可以正常迭代。

### 3.1 缺口 1：更多的 just-bash 抽象实现 + Cloudflare 真实环境测试

**当前事实：**
- `packages/capability-runtime/src/capabilities/` 下有 6 个文件：`exec.ts / filesystem.ts / network.ts / search.ts / vcs.ts / workspace-truth.ts`
- 12-pack 命令已实现：pwd/ls/cat/write/mkdir/rm/mv/cp/rg/curl/ts-exec/git
- `ts-exec` 明确标记 `not connected`（不能在 Cloudflare Workers 里 spawn 子进程）
- `curl` 明确返回 `CURL_NOT_CONNECTED_NOTE = "curl-not-connected"`（默认 stub）
- `git` 限定为 read-only 子集（status/diff/log）

**关键问题：**

`fake-bash` 这个命名其实有一个**根本性的语义模糊**——它到底是什么？

- 是"在 Cloudflare Workers 沙箱里**模拟** bash 的行为"？
- 还是"提供一组**类似** bash 接口、但底层用 Workers 平台原语实现的能力"？

这两个定义在本地 vitest 里**看不出区别**，因为本地 vitest 里：
- `filesystem.ts` 用 `MemoryBackend` 模拟，根本没有真实 fs
- `network.ts` 默认就是 `not-connected` stub
- `exec.ts` 也是 stub
- 所有命令都在 `WorkspaceNamespace` 这个抽象层之上跑，与 OS bash 的事实没有任何接触面

**部署到 Cloudflare 之后会暴露什么？**

1. `filesystem` 的 `mkdir -p` 在 Cloudflare DO storage 里到底应该怎么实现？是 `key prefix` ？还是显式 directory marker？这个语义在本地永远测不出来
2. `cat` 一个 100MB 文件的时候，Cloudflare DO 的 128MB memory limit 会不会被打爆？本地 `MemoryBackend` 没有这个限制，永远不会触发
3. `curl` 一旦"接通"为真实 fetch，会遇到 Workers 的 `cpu_ms` / `subrequest count` / `outgoing fetch quota` 限制——这些都是 platform-level 限制
4. `rg` (ripgrep alias) 在大文件上会触发 CPU time limit；本地永远跑得动
5. `git` 真实做 git 操作（即使是 read-only）需要某种 git binary 或纯 JS 实现——Workers 没有 git binary

**评分：HIGH-VALUE FOR SPIKE.**

这一项是 spike worker 最强的论证：**几乎所有的 fake-bash 的真实行为，本地都验证不了**。当前 12-pack 在本地 100% 通过测试，但部署后大概率会出现 5-10 个 platform-edge case。

✅ **强烈同意必须用 spike 验证。**

### 3.2 缺口 2：D1 / R2 / KV vs 本地 worker 内存的抽象与真实循环测试

**当前事实：**
- `packages/storage-topology/src/adapters/scoped-io.ts` 提供 `ScopedStorageAdapter` 接口
- 唯一实现是 `NullStorageAdapter`，所有方法（doGet/doPut/doDelete/kvGet/kvPut/kvDelete/r2Get/r2Put/r2Delete/r2List）都抛 `"not connected"`
- `packages/workspace-context-artifacts/src/backends/`：`MemoryBackend` 可用、`ReferenceBackend` 全部抛 `"not connected"`
- 在 packages/ 下**没有任何真实的 D1 / R2 / KV adapter 实现**

**关键问题：**

`ScopedStorageAdapter` 接口长什么样、当真接到 D1/R2/KV 上是否成立——这是本地永远验证不了的。具体几个真实坑：

1. **R2 的 multipart upload 限制**：单 part 必须 ≥ 5MB（最后一个 part 除外）。当前 `r2Put` 的接口签名里完全没有体现这个约束
2. **R2 的 list pagination**：`r2List` 在真实 R2 上一次最多 1000 个 key，需要 cursor。当前接口签名里没有 cursor 支持
3. **D1 的 transaction 模型**：D1 不支持跨 query 的真实事务（只支持单 query batch）。这个事实如果在 spike 之前没暴露，整个 placement / promotion / archive plan 的逻辑都可能要重写
4. **KV 的 eventual consistency**：KV 的 write-after-read 不保证读到 fresh value。当前 `kvGet/kvPut` 的接口完全没有体现 stale-read 可能性
5. **跨 adapter 的 ref 解引用**：`refs.ts` 假设可以从一个 ref 跨 namespace 解到具体内容——但当 namespace A 在 R2、namespace B 在 KV、namespace C 在 D1 时，跨 adapter 引用的事务语义在 packages/ 里完全没定义

**评分：CRITICAL FOR SPIKE.**

这一项比缺口 1 更关键。理由：

> **如果 ScopedStorageAdapter 接口在真实 D1/R2/KV 上不成立，那么 `storage-topology` 整个包的 taxonomy / placement / promotion / refs / calibration 都建立在错误的接口契约上——这是会让整个 filesystem.core worker 重写的级别的风险。**

✅ **强烈同意必须用 spike 验证。这一项的 ROI 比缺口 1 还高。**

### 3.3 缺口 3：更真实的上下文管理 package 的实现

**当前事实：**
- `workspace-context-artifacts` 提供 `ContextAssembler / CompactBoundaryManager / WorkspaceSnapshotBuilder`
- `composeWorkspaceWithEvidence` 已能装配三件套（`packages/session-do-runtime/src/workspace-runtime.ts:75-101`）
- 5 evidence streams 已能 emit
- **但**：`CompactBoundaryManager` 当前只判断"是否到了 compact 边界"——没有"实际用 LLM 做语义压缩"的代码
- 用户原话："我会在别的说明里，进行具体安排和说明"

**关键问题：**

这一项的性质和缺口 1、缺口 2 不一样——**它不是"本地测不出"问题，而是"spec 没出"问题**。

具体来说：
- "上下文压缩"在 product behavior 层面是什么？是 summarization？是 chunked retention？是 prepared-artifact promotion？是几者组合？
- 触发时机是什么？是 token budget 接近上限就触发？是用户显式 `/compact`？是每 N 个 turn 自动？
- 压缩的 LLM 调用走哪个 provider？是与 turn 用同一个 model 还是用专用 cheaper model？
- 压缩失败如何降级？是丢弃旧 layer？是切回上一个 snapshot？

这些都是**产品策略问题**，不是技术接口问题。在策略问题没回答之前，spike 也没法测——spike 只能测"接口长这样、跑一次能不能通"，但跑一次能通不代表策略对。

**评分：MEDIUM FOR SPIKE，HIGH FOR SPEC-FIRST.**

我的建议：

> **这一项不应该被 spike 先验证。它应该被 spec 先冻结。spec 出来后，spike 才有验证的目标。**

✅ 同意它是缺口；⚠️ 但它不属于 spike phase，它属于 spec-first phase。

### 3.4 缺口 4：context 管理 / 文件系统操作的更准确 hooks 分类

**当前事实（`packages/hooks/src/catalog.ts`）：**

8-event catalog 完整列出：
- `SessionStart / SessionEnd`
- `UserPromptSubmit`
- `PreToolUse / PostToolUse / PostToolUseFailure`
- `PreCompact / PostCompact`

**注意到的真实缺口：**

| 你提到的领域 | 当前 hooks 是否覆盖 | 缺什么 |
|---|---|---|
| context 管理 | 仅 `PreCompact / PostCompact`（边界事件） | 缺 `PreContextAssemble / PostContextAssemble`（每次 turn 都装 context 时触发）；缺 `PreLayerLoad / PostLayerLoad`（layer-level 干预）；缺 `PreSnapshot / PostSnapshot`（snapshot 写入边界） |
| 文件系统操作 | 仅 `PreToolUse / PostToolUse`（工具级粗粒度） | 缺 `PreFileWrite / PostFileWrite / PreFileRead`；缺 `PrePromotion / PostPromotion`（artifact 跨层迁移）；缺 `PreArchive / PostArchive`（数据归档边界） |

这个缺口是**真实的**，而且它的性质和缺口 3 一样——是**spec 问题**而不是 spike 问题。

**关键判断：**

我有一个比你更强的意见：

> **hooks catalog 不应该急着扩。它现在覆盖的"工具级 + compact 边界"已经足够 MVP；扩 hooks 的代价是 nacp-core / nacp-session 协议层的 breaking change。**

具体地：
- `HookEventName` 是 union 类型，加新值就是 protocol-level change
- `HOOK_EVENT_CATALOG` 的 `allowedOutcomes` 是冻结的契约，被 `outcome reducer` 和 `session mapper` 同时依赖
- 一旦扩展，所有 1.1.0 的 nacp-core / nacp-session 都得跟进 1.2.0

**所以这一项的处理顺序应该是：**

1. **先用 spike 暴露**：哪些场景下当前 8 个 hook 不够？（在 spike 跑业务时凭经验记账，不要拍脑袋）
2. **再 spec 收口**：把 spike 中真实需要的 hook 写进 design doc，不要把 claude-code 风格的全套 hook 一口气搬过来
3. **最后 protocol-level 升级**：nacp-core 1.2.0、nacp-session 1.2.0、catalog 扩展——一次性做

✅ 同意是缺口；⚠️ 反对在 spike 阶段同时做 hooks 扩展——它应该是 spike 的**输出物**，而不是 spike 的**前置条件**。

### 3.5 缺口 5：基于以上更新 nacp-core / nacp-session

**当前事实：**
- `nacp-core` 1.1.0（frozen baseline + 1.0.0 compat shim）
- `nacp-session` 1.1.0（8 message kinds 已冻结）
- 两个包都已经做过 review、closure、第三轮 verdict

**关键判断：**

这一项的性质：**它不是独立缺口，是上面 4 项的下游影响**。

- 如果缺口 1 (just-bash) 暴露真实问题 → capability message envelope 可能要扩
- 如果缺口 2 (storage) 暴露真实问题 → resource-ref / placement 字段可能要扩
- 如果缺口 3 (context) spec 落地 → 可能新增 `session.context_compacted` 之类 message
- 如果缺口 4 (hooks) 扩展 → 可能新增 hook event message + outcome 字段

所以正确的顺序是：

> **不是"先升级 nacp 再 spike"，而是"先 spike 暴露问题，再 spec，再升级 nacp"。**

如果倒过来做（先升级 nacp 再 spike），就会得到一个**预先想象出来**的 1.2.0，而不是**真实需要**的 1.2.0。这正是你当前 1.1.0 baseline 想避免的事——你已经经历过一次 1.0.0 → 1.1.0 的演化，知道太早冻结的代价。

✅ 同意是缺口；⚠️ 强烈建议它是**spike 的下游产物**，不是 spike 的前置条件。

### 3.6 缺口评估汇总

| 缺口 | 是否真实 | spike 能否验证 | 推荐做法 |
|---|---|---|---|
| 1. just-bash + Cloudflare 真实测试 | ✅ 真实 | ✅ 完美适配 | **进 spike 第一波** |
| 2. D1 / R2 / KV vs 本地内存 | ✅ 真实，且 ROI 最高 | ✅ 完美适配 | **进 spike 第一波** |
| 3. 真实上下文管理实现 | ✅ 真实 | ⚠️ spec 先于 spike | spec-first，spike 第二波 |
| 4. hooks 分类补充 | ✅ 真实 | ⚠️ spike 的输出而非输入 | spike 输出 → spec → protocol 升级 |
| 5. nacp-core / nacp-session 升级 | ⚠️ 是下游影响 | ❌ 不是 spike 任务 | spike + spec 后做 |

**也就是说：spike phase 的第一波只对应缺口 1 + 2；缺口 3、4、5 是 spike 之后的产物。**

这与你的"5 项一起做"略有不同。下面会展开。

---

## 4. spike worker 这个形态本身的辩证评估

### 4.1 我同意 spike worker 是正确的形态选择

理由（从工程方法论角度）：

1. **承诺度低**：spike 的代码可以被完全删掉重写——这一点和正常 worker 不同。正常 worker 一旦 deploy 就有 backward compat 包袱
2. **可销毁**：spike worker 的存在期是短期的，它不是产品的一部分
3. **真实 platform exposure**：它是真实 Cloudflare deploy，能暴露 platform-level 行为
4. **隔离 blast radius**：spike 失败不会影响主链

这是一个好的中间形态——比 vitest 真实，比 production worker 便宜。

### 4.2 但我对 "1-2 个 spike" 的形态有更细的建议

你的原话是 "**这个 worker，或者是 2 个 worker，它们纯粹是 probe**"。

我的细化建议：**做 2 个 spike，分工明确**：

| Spike | 名字（建议） | 验证目标 |
|---|---|---|
| Spike-1 | `spike-do-storage` | 单 worker，**DO + storage adapters** 验证：R2 / KV / DO storage 的 latency / consistency / quota / multipart 行为；workspace mount + memory backend 在真实 DO 下的可用性 |
| Spike-2 | `spike-binding-pair` | 两个 worker（spike-A + spike-B），**service binding handshake** 验证：service binding latency / cancellation / WS 跨 worker / CrossSeamAnchor header 在真实 binding 下的传播 / hooks remote runtime 在真实 binding 下能否调通 |

理由：

- **Spike-1 解决缺口 2 + 缺口 1 的一部分**（fake-bash 的 storage 类操作）
- **Spike-2 解决跨 worker 的 binding contract** —— 这是 worker matrix 立项前必须验证的最核心契约
- **不需要 3 个或更多** —— 那样会让 spike 变成"小型 worker matrix"，违背 spike 的轻量本质

为什么不是 1 个 spike：因为 1 个 spike 跑不了 service-binding（service binding 必须有两个真实部署的 worker）。

为什么不是 3 个或更多 spike：因为再多就是变相的 worker matrix，spike 的"可销毁"语义会丢。

### 4.3 spike worker 的纪律（避免它退化成事实上的产品代码）

这是 spike 模式最容易出错的地方。我的建议：

1. **spike 代码必须放在 `spikes/` 顶级目录**，**不能**放在 `packages/`——避免被 cross-package 测试与 release flow 拉进去
2. **spike 必须有 expiration date**——例如"2026-06-01 之前删除或转正式 worker"
3. **spike 不接 CI 主链**——它有自己的 deploy script，但不进 main pipeline
4. **spike 的发现必须落到 design doc**——不能只在 spike 代码里留注释；spike 一旦销毁，注释就丢了
5. **spike 不接真实生产数据**——它跑在独立的 Cloudflare account 或独立的 namespace，避免数据污染

这 5 条纪律如果不立，spike 会在 3 个月内自然演化成"事实上的 production worker"，丧失它的方法论价值。

### 4.4 spike worker 的明确 anti-pattern

下面这些做法**会破坏 spike 的价值**，必须避免：

- ❌ 在 spike 里写"未来产品也要用"的代码
- ❌ 在 spike 里实现新业务能力（spike 只测 platform 行为，不实现业务）
- ❌ 让 spike 通过 NACP 协议跟主链 worker 通讯（spike 是孤岛）
- ❌ 给 spike 接生产 secret / 真实 LLM key（spike 用 fake provider 或 free-tier）
- ❌ 把 spike 写成 5000 行的 god worker（spike 应该 < 500 行/each）
- ❌ 让 spike 持有真实业务数据
- ❌ 给 spike 加测试覆盖率要求（spike 是手动验证驱动的）

---

## 5. 与之前两篇 worker matrix eval 的关系

为了让这条思维链可追踪，明确说一下本文与之前两篇的差异：

### 5.1 与 `worker-matrix-eval-with-GPT.md` 的差异

GPT 的方案是：**5 个 worker 都建成 real worker，但厚薄不同**（3 load-bearing + 2 real-but-thin）。

本文同意 GPT 关于 `context.core` 与 `skill.core` 的风险评估，但提出了一个 GPT 没考虑的更基本问题：

> **GPT 假设了"3 个 load-bearing worker 的 platform 行为已经可以 deploy"——这个假设也未经验证。**

也就是说，GPT 的方案在 worker 级别做了厚薄区分，但**整层都跳过了 platform reality 验证**。本文要补的就是这一层。

### 5.2 与 `worker-matrix-eval-with-Opus.md`（我自己上一篇）的差异

我上一篇推荐"3 worker 立刻做 + 2 reserved binding 名额"，W1-W4 实现路径。

但用户这次的提案让我重新审视上一篇的隐性假设：**我假设了 `agent.core / bash.core / filesystem.core` 这 3 个 ready 的 worker 在 Cloudflare 真实环境里也是 ready 的——这个假设没有事实支撑。**

具体地：
- `bash.core` 的 ready 是基于"本地 vitest 100% 通过"
- `filesystem.core (memory tier + R2)` 的 ready 是基于"MemoryBackend 在本地能跑、R2 binding 在文档里看起来 simple"
- 这两个 ready 都没经过真实 deploy 验证

**用户这次的提案纠正的就是这个隐性假设。**

### 5.3 修正后的整体思维链

```
[已完成]   plan-after-nacp + plan-after-skeleton (A1-A10)
              ↓
[已完成]   2nd & 3rd round code review closure
              ↓
[本阶段] ★ pre-matrix probing phase（本文）
              · Spike-1: spike-do-storage   → 验证缺口 1 + 2
              · Spike-2: spike-binding-pair → 验证跨 worker contract
              · 输出：design doc + 缺口 3/4/5 的 spec
              ↓
[随后]    spec-first phase
              · context 管理 spec
              · hooks 扩展 spec
              · nacp-core / nacp-session 1.2.0 升级
              ↓
[再随后]  worker matrix phase（3 → 5 worker）
              · agent.core / bash.core / filesystem.core
              · context.core / skill.core（spec 落地后）
              ↓
[最终]    deployable MVP
```

---

## 6. 推荐的 pre-matrix probing phase 结构

如果你采纳本评估，建议的阶段结构：

### 6.1 阶段名

> **Phase 7.5 — Pre-Matrix Probing**（在 Phase 7 = A1-A10 已闭合 与 Phase 8 = worker matrix 之间）

### 6.2 In-Scope

1. **Spike-1: `spike-do-storage`** — 单 worker probe，验证：
   - R2 binding 的 multipart upload + list pagination + GET 行为
   - KV binding 的 stale-read window + put-then-get consistency
   - DO storage 的 transactional get/put + 与 KV 协作
   - `MemoryBackend` 与真实 DO storage 的语义差异
   - `ScopedStorageAdapter` 接口在真实 D1/R2/KV 上是否成立
   - fake-bash filesystem capabilities 在真实 DO 沙箱里的行为（mkdir、cat 大文件、rg 大目录等）

2. **Spike-2: `spike-binding-pair`** — 两 worker probe，验证：
   - service binding 的 latency / timeout / cancellation / retry
   - WS 跨 worker 的延迟与 frame 顺序
   - `CrossSeamAnchor` header 在真实 service-binding 下的传播
   - hooks `service-binding` runtime 在真实 binding 下的回调延迟
   - capability `ServiceBindingTarget` 在真实 binding 下的执行
   - eval sink fan-in 在跨 worker 下的 ordering 与 dedup

3. **Spike outputs**（design docs）：
   - `docs/spikes/storage-findings.md`
   - `docs/spikes/binding-findings.md`
   - `docs/spikes/fake-bash-platform-findings.md`
   - 每个 finding 必须包含：现象、根因、对 packages/ 的影响、对 worker matrix 的影响

### 6.3 Out-of-Scope

1. **不做** spike 用业务数据
2. **不做** spike 实现新业务能力
3. **不做** spike 的协议层 / 数据层 spec（这是 spike 输出后才做）
4. **不做** context 管理 spec（这是独立 spec phase）
5. **不做** hooks 扩展（这是 spike 输出后的 protocol-level 升级）
6. **不做** nacp-core / nacp-session 升级（同上）
7. **不做** worker matrix 的任何实质实现

### 6.4 验收信号

| 信号 | 含义 |
|---|---|
| Spike-1 deploy 成功 | 至少一次成功的 wrangler deploy；能从外网访问；R2/KV/DO binding 全部可用 |
| Spike-1 storage 矩阵跑过 | 上面 6 个 storage-related 验证项每一项都有 finding 文档 |
| Spike-2 deploy 成功 | 两个 worker 都成功部署；service binding 表正确 |
| Spike-2 binding 矩阵跑过 | 上面 6 个 binding-related 验证项每一项都有 finding 文档 |
| 至少 5 个真实 finding 落入 design doc | 证明 spike 的方法论价值 |
| 至少 1 个 packages/ 接口需要修改的发现 | 证明 spike 抓到了本地测不出的 gap |
| 缺口 3/4/5 有了清晰的输入 | 为下一阶段 spec phase 提供素材 |

### 6.5 时长建议

- Spike-1：1-2 周
- Spike-2：1-2 周（可与 Spike-1 部分并行）
- Findings 落 design doc：3-5 天
- **总时长：3-4 周**

这与我上篇 Opus 评估里推荐的 W1-W4 时长接近——**也就是说，加入 spike phase 不会显著拖延总进度，但会显著提高 worker matrix 阶段的成功率**。

---

## 7. 最终 verdict

### 7.1 是否同意你的 pre-matrix probing 提案

> **同意。强烈同意。**

并且我认为它是这条思维链上**至今最重要的一次修正**，原因：

1. 它把"我们以为 packages 已经 ready"的隐性假设第一次推到 Cloudflare runtime 真实事实面前
2. 它把 spike 这种"低承诺、可销毁、专门用来探路"的工程方法论引入主链
3. 它纠正了 GPT 与我自己上篇都没意识到的 platform-reality gap
4. 它把"先冻结协议再实现"的传统顺序倒过来，改成"先 spike 暴露真实行为再冻结协议"——这是更现实的方法论

### 7.2 我对你提案的两点细化

1. **缺口 1 / 2 进 spike 第一波；缺口 3 / 4 / 5 是 spike 的下游产物**——不要把 5 项一起做
2. **做 2 个 spike 而不是 1 个**：`spike-do-storage` (单 worker, 验证 storage + fake-bash platform 行为) + `spike-binding-pair` (双 worker, 验证 service binding + 跨 worker contract)

### 7.3 给 spike phase 立的 5 条纪律（再次强调）

1. spike 代码放 `spikes/` 顶级目录，不进 `packages/`
2. spike 必须有 expiration date
3. spike 不接 CI 主链
4. spike 的发现必须落到 design doc，不能只在代码注释里
5. spike 不接生产数据 / 不持有业务数据 / 不实现新业务能力

### 7.4 一句话总结

> **你这次的退一步不是过度谨慎，是必要的现实校准。worker matrix 之前必须有一个 spike phase，用 1-2 个可销毁的真实 Cloudflare worker 去验证我们至今所有的"本地测试都通过"是否真的意味着"Cloudflare 部署也通过"。这是这条思维链上至今最重要的一次方向修正——它把 packages/ 的"假装 ready"第一次推到 platform reality 面前去对账。强烈推荐采纳；spike 阶段做 3-4 周；输出物是 design docs 而不是代码；之后才进入 spec-first phase 与 worker matrix。**

---

## 附 A：建议的下一步可执行动作

如果你采纳本评估，建议的最小可执行动作：

1. 创建目录：`spikes/spike-do-storage/` 和 `spikes/spike-binding-pair/`
2. 创建文档：`docs/plan-pre-matrix-probing.md`（参考 `docs/plan-after-skeleton.md` 的格式），列出 Phase 7.5 的 in-scope / out-of-scope / 验收信号
3. 创建 spike findings 模板：~~`docs/spikes/_TEMPLATE-finding.md`~~ → **已落到 `docs/templates/_TEMPLATE-spike-finding.md`**（业主决策，2026-04-19）
4. 把本文 §3 的"缺口评估汇总表"作为 Phase 7.5 立项的 baseline checklist
5. 把本文 §6.2 的 12 个验证项（6 storage + 6 binding）作为 spike 跑通后必须有 finding 的清单

## 附 B：当前真实代码事实快照（写本文时核对）

| 事实 | 文件 | 行号 |
|---|---|---|
| `HOOK_EVENT_CATALOG` 仅 8 个事件，无 filesystem / context-assemble 类 | `packages/hooks/src/catalog.ts` | 43-98 |
| `NullStorageAdapter` 全部抛 "not connected" | `packages/storage-topology/src/adapters/scoped-io.ts` | 87-127 |
| `ReferenceBackend` 全部抛 "not connected" | `packages/workspace-context-artifacts/src/backends/reference.ts` | 19/25/33/41/47 |
| `CURL_NOT_CONNECTED_NOTE = "curl-not-connected"` | `packages/capability-runtime/src/capabilities/network.ts` | 38 |
| `BrowserRenderingTarget` 是 stub | `packages/capability-runtime/src/targets/browser-rendering.ts` | — |
| `ts-exec` 显式 not connected | `packages/capability-runtime/test/capabilities/ts-exec-partial.test.ts` | 29 |
| 默认 composition factory `kernel: undefined` | `packages/session-do-runtime/src/composition.ts` | 95 |
| 远程 composition factory `kernel: undefined` | `packages/session-do-runtime/src/remote-bindings.ts` | 386 |
| `composeWorkspaceWithEvidence` 已就绪 | `packages/session-do-runtime/src/workspace-runtime.ts` | 75-101 |
| `nacp-core` 当前版本 1.1.0 frozen | `packages/nacp-core/src/version.ts` | — |
| `nacp-session` 当前版本 1.1.0 frozen，8 message kinds | `packages/nacp-session/src/version.ts` | — |
| `capability-runtime/src/capabilities/` 6 个文件，12-pack 命令 | — | — |

这些事实应当作为 Phase 7.5 立项 review 时的基线 checklist——任何一条事实在 spike 之后变了，都是有价值的发现。

---

# §8. 第二轮回应：after-foundations 阶段必须 ship 代码，不只是 ship 文档

> 写作时间：2026-04-19（同日续写）
> 触发：用户对本文 §6.2 "Out-of-Scope" 中"不做协议升级、不做 hooks 扩展、不做 nacp 升级、不做 context spec"的明确反对
> 参考：`docs/eval/after-foundations/before-worker-matrix-eval-with-GPT.md`（GPT 对同一思维链的独立判断）
> 立场：**用户是对的，我上文 §6.2 把 scope 切得太窄。本节正式修正。**

---

## 8.1 我先承认上文 §6.2 是错的

上文 §6.2 我把 after-foundations / pre-matrix probing 阶段的 Out-of-Scope 列成：

> 3. **不做** spike 的协议层 / 数据层 spec（这是 spike 输出后才做）
> 4. **不做** context 管理 spec（这是独立 spec phase）
> 5. **不做** hooks 扩展（这是 spike 输出后的 protocol-level 升级）
> 6. **不做** nacp-core / nacp-session 升级（同上）

我的当时论据是"spike 之后再 spec、spec 之后再升级 nacp，避免提前冻结错误协议"。

**但这个论据有一个隐性错误**：它假设 spike → spec → 协议升级 → 实现 这四件事是**串行**的，且**每一件都需要独立 phase**。如果真的这样切，nano-agent 会出现一个尴尬现象：

> **after-foundations 跑完 3-4 周，packages/ 一行代码没变，只多了几份 design doc。然后下一个 phase 用 design doc 改协议、再下一个 phase 改实现、再下一个 phase 才进 worker matrix。等真正能 deploy 的时候，3-4 个月过去了。**

这种节奏违背了你这次提出 spike 的初衷——**你提出 spike，是为了加快进入 deployable reality，不是为了再加 3 个 spec phase**。

更具体地：如果 spike 输出的只是 docs，那么进入 worker matrix 时，所有的协议、storage adapter、context package、hooks 都还没真正 ship。worker matrix 一开始就会立即停下来等"先 ship 这些"——这等于把 after-foundations 的工作往后推一个 phase 而已。

**所以你的反驳是对的：after-foundations 必须 ship 代码，不只是 ship 文档。**

---

## 8.2 GPT 在同一时刻独立给出的判断与本文一致

GPT 的 `before-worker-matrix-eval-with-GPT.md` 在 §3 写道：

> **"这个阶段的本质是补齐前提事实、收敛协议与抽象、用 spike workers 验证 Cloudflare reality、为下一阶段的 worker matrix implementation 降风险。"**

GPT §6 的 In-Scope 列出 6 项，其中第 5 项明确是"NACP core / session 的协议更新"——也就是说 **GPT 也认为 protocol 更新是 after-foundations 阶段的产出，不是后续 phase 的前置依赖**。

GPT §2.4 关于 hooks 给出的判断更尖锐：

> **"hook taxonomy 扩充与实现 ... 我认为它是你这 5 个条件里最容易被低估，但最影响后续质量的一项。"**

也就是说，GPT 也认为 hook 扩展不是"spike 之后再说"的事，而是**与 spike 同期完成的代码工作**。

**结论：GPT 的判断 + 用户的反驳，两条独立的论证线在同一时刻指向同一结论——上文 §6.2 把这些列为 Out-of-Scope 是错的。本节正式修正。**

---

## 8.3 用代码事实重新核对你列出的 5 项产出物

下面用代码事实逐项核对你新提出的 5 项**代码产出**，并判断每项的 ship-ability。

### 8.3.1 产出 1：新的 context management package

**用户原话：** "1 个新的 context management package，这个 package 中包含全部的上下文管理抽象，并得到验证"

**当前代码事实：**
- 已有 `packages/workspace-context-artifacts/`，提供 `ContextAssembler / CompactBoundaryManager / WorkspaceSnapshotBuilder / WorkspaceNamespace / PreparedArtifacts / Promotion / Refs`
- `nacp-core/src/messages/context.ts` 仅注册 `context.compact.request / context.compact.response` 两个 message
- `prepared-artifacts.ts` 暴露的是 `StubArtifactPreparer`（GPT 已在其 §2.3 引用）
- `promotion.ts` 的 `DEFAULT_PROMOTION_POLICY` 与 `coldTierSizeBytes` 仍是 provisional

**两个 package 边界选项：**

| 选项 | 形态 | 风险 | 优势 |
|---|---|---|---|
| **A. 新建 `packages/context-management/`** | 独立 package，承担 context strategy 层（compaction strategy / budget arbitration / layer policy / prepared-artifact lifecycle） | context 责任会分裂在两个 package 之间；需要明确 `workspace-context-artifacts` 与 `context-management` 的依赖方向 | 强迫 strategy 层与 primitives 层物理隔离；未来 `context.core` worker 只依赖 `context-management`，不需要拖入 `workspace-context-artifacts` 全部内容 |
| **B. 把新能力加到 `workspace-context-artifacts` 内部** | 在已有包内扩 `ContextStrategyEngine` 等模块 | 包会变厚，未来拆 worker 时还得二次拆 | 不引入新 package，依赖图更简单 |

**我的建议：选 A。** 理由：

1. 你明确说"1 个新的 package"——这是产品决策，我尊重
2. 物理边界正是你这次思维链一直坚持的方法论（5-worker matrix 也是这个逻辑）
3. `workspace-context-artifacts` 当前承担的是 **primitives**（assembler、boundary detector、snapshot builder、namespace、mount router），它的语义已经清晰；新建包承担的是 **strategy & lifecycle**（什么时候压、压成什么样、压完去哪、过期了怎么 reclaim）
4. 依赖方向：`context-management` → `workspace-context-artifacts`（单向），`workspace-context-artifacts` 不反向依赖

**ship 内容（建议）：**
- `packages/context-management/src/strategy/` — compaction strategy interfaces + 默认 implementations
- `packages/context-management/src/budget/` — token budget arbitration 跨 turn
- `packages/context-management/src/lifecycle/` — prepared-artifact lifecycle（promote / demote / archive / reclaim）
- `packages/context-management/src/llm-driven/` — 真实 LLM-based summarization adapter（可以用 fake provider 在 spike 验证）
- `packages/context-management/test/` — 端到端测试，证明 strategy 在真实 turn 中产出可被 ContextAssembler 消费的 layer

**ship-ability：HIGH。** 这是新建包，不会破坏现有契约；可以 spike 验证后立即 ship。

### 8.3.2 产出 2：基于 spike 答案，nacp.core 和 nacp.session 的具体修改与更新

**用户原话：** "结合 spike 的答案，对 nacp.core 和 nacp.session 的具体修改和更新，保证我们在进入到 worker matrix 阶段，进行最大限度的 surface contract 冻结"

**当前代码事实（GPT §2.5 已核对）：**
- `nacp-core/src/messages/index.ts` 注册 5 个 family：tool / hook / skill / context / system
- `nacp-core/src/messages/context.ts` 仅 `context.compact.request/response`
- `nacp-session/src/messages.ts` 8 个 session message kind
- 当前版本均为 **1.1.0 frozen**

**spike 之后预期需要新增的 message families（基于本文 §3 与 §6 的 12 个验证项预测）：**

| 新增 family | 推断的 message | 来源验证项 |
|---|---|---|
| `context.*` 扩展 | `context.assemble.request`、`context.assemble.response`、`context.snapshot.committed`、`context.layer.evicted`、`context.budget.exceeded` | spike 的 context-management 集成验证；GPT §2.3 |
| `storage.*` 新增 | `storage.placement.requested`、`storage.placement.committed`、`storage.promote.requested`、`storage.archive.requested` | Spike-1 storage 验证 |
| `filesystem.*` 新增 | `filesystem.write.intent`、`filesystem.write.committed`、`filesystem.read.miss` | Spike-1 fake-bash + storage 协作验证 |
| `hook.*` 扩展 | 新 event_name 进 catalog，wire-level 不变（`hook.emit/outcome` 已足够通用，GPT §2.4 已确认） | spike 的 hook 触发覆盖验证 |
| `session.*` 可能扩展 | `session.context.committed`、`session.workspace.diverged`（用于跨 worker 状态推送） | Spike-2 binding 验证 |

**版本演进路径：**
- `nacp-core` 1.1.0 → **1.2.0**（新增 storage / filesystem family；扩展 context family；hook wire 不变）
- `nacp-session` 1.1.0 → **1.2.0**（新增 session 跨 worker 同步类 message）
- `nacp-core` 1.0.0 compat shim 保持，因为 1.0.0 用户不消费新 family
- `nacp-session` 1.1.0 compat shim 新增（保护已 ship 的 8 message 用户）

**ship-ability：HIGH，但必须 spike 之后才 ship。**

这里的 sequencing 至关重要：
- ❌ 错误顺序：先猜测协议升级 → ship 1.2.0 → spike 验证 → 发现猜错 → ship 1.3.0（这是当前 1.0.0 → 1.1.0 已经走过一次的坑）
- ✅ 正确顺序：spike → finding → 设计协议 → 1.2.0 RC → 用 spike 重新跑通 → 1.2.0 final → ship

也就是说，nacp 升级**必须**在 after-foundations 阶段内完成（用户的反驳成立），但**必须**经过 spike 验证后再冻结（我上文 §6.2 的担心仍部分成立）。两者并不矛盾——用 RC 阶段把它们都满足。

### 8.3.3 产出 3：fake-bash 全面更新 + 更多 just-bash 实现 port

**用户原话：** "结合 spike 的答案，对 fake bash 验证后，进行更全面的更新，以及更多 just-bash 的实现 port"

**当前代码事实：**
- `packages/capability-runtime/src/fake-bash/` 仅 3 个文件：`bridge.ts (4.4KB) / commands.ts (5.0KB) / unsupported.ts (3.1KB)` 共 ~12KB
- `packages/capability-runtime/src/capabilities/` 6 个文件，覆盖 12-pack
- **`context/just-bash/` 真实存在**——是 vercel-labs/just-bash v2.14.2 的 vendored copy，包含完整子目录：`ast / cli / commands / fs / helpers / interpreter / network / parser / regex / sandbox / security / shell` ……

也就是说：**just-bash 作为参考实现一直在仓库里**（`context/just-bash/`），但目前 `packages/capability-runtime/fake-bash/` 只是一个非常 minimal 的 governed subset。GPT §2.1 也确认了这一点。

**spike 应当验证什么、port 应当 port 什么：**

| 现 12-pack 之外的 just-bash 能力 | 是否 port | 原因 |
|---|---|---|
| 文本处理：sed / awk / sort / uniq / wc / head / tail | ✅ 优先 port | LLM 驱动的 bash 命令里这些是高频需求；纯字符串处理在 Workers runtime 完全没问题 |
| 数据格式：jq / json query | ✅ 优先 port | LLM agent 处理 API response 的高频需求 |
| 进程：ps / kill / pkill | ❌ 不 port | Workers 没有 process 概念 |
| Shell features：管道 \| / 重定向 > / 环境变量 | ⚠️ 谨慎 port | 这是 just-bash 最复杂的部分；spike 应验证 cpu_ms 限制下能跑多深 |
| `js-exec` / `python3` | ⚠️ 仅 js-exec | python3 在 Workers 不可用；js-exec 走 wasm 或受控 sandbox |
| `sqlite3` | ⚠️ 仅当 D1 adapter 落地后 | spike-do-storage 应当验证 |
| `curl` 真实接通 | ✅ 必须 | 当前是 not-connected stub；spike 应验证 outgoing fetch quota |
| `git`（write 子集） | ⚠️ 仅 read-only 维持 | write 需要真实 git binary 或 isomorphic-git，复杂度高，留给 worker matrix 后再说 |

**ship-ability：MEDIUM-HIGH。** 这一项的工作量比上面两项都大——port 真实 sed/awk/jq 在 Workers runtime 上是非平凡工作。但它确实必须在 after-foundations 完成，否则 worker matrix 阶段的 `bash.core` 立项时还是当前 12-pack，没有真正进步。

### 8.3.4 产出 4：D1 / KV / R2 真实验证后的本地代码抽象

**用户原话：** "结合 spike 的测试，对 D1，KV，R2 形成完整的，经过真实测验的本地代码抽象，后续可以当做已验证的组件，直接用于 filesystem.core 的构建"

**当前代码事实：**
- `packages/storage-topology/src/adapters/scoped-io.ts` 仅 `ScopedStorageAdapter` 接口 + `NullStorageAdapter`（全抛 not connected）
- `packages/workspace-context-artifacts/src/backends/reference.ts` `ReferenceBackend` 全抛 not connected
- `packages/workspace-context-artifacts/src/backends/memory.ts` `MemoryBackend` 可用

**after-foundations 应 ship 的 adapter 类（基于 spike-do-storage 验证后的实现）：**

```
packages/storage-topology/src/adapters/
  ├── scoped-io.ts         (already exists, keep接口)
  ├── d1-adapter.ts        (NEW — 经 spike 验证)
  ├── r2-adapter.ts        (NEW — 经 spike 验证；包含 multipart + cursor pagination)
  ├── kv-adapter.ts        (NEW — 经 spike 验证；明确 stale-read 语义)
  └── do-storage-adapter.ts (NEW — 经 spike 验证)
```

每个 adapter 的特征：
- `D1Adapter`：实现 `ScopedStorageAdapter` 的 `kvGet/Put/Delete`（如果决定用 D1 当 KV 替代）+ 新增 `query/exec` 方法
- `R2Adapter`：实现 `r2Get/Put/Delete/List`，**修订 list 接口签名**（加 cursor、加 limit）
- `KvAdapter`：实现 `kvGet/Put/Delete`，**显式 stale-read 标注**
- `DOStorageAdapter`：实现 DO `state.storage` 的 transactional get/put

**关键修订：基于 spike 发现，`ScopedStorageAdapter` 接口本身可能需要修订**。本文 §3.2 列出的几个 R2 与 D1 真实坑（multipart、cursor、transaction model、stale-read）都意味着接口签名要扩。这也是为什么这一项必须在 after-foundations 阶段 ship——如果延后到 worker matrix 阶段，接口修订就会变成 cross-package 大重构。

**ship-ability：HIGH，但**接口修订是 breaking change**，所以需要：
- `storage-topology` 1.1.0 → **2.0.0**（接口修订是 major bump）
- 或者：保留旧接口、新增 `ScopedStorageAdapterV2`（minor bump，但留双接口的代价）

**我的建议：major bump 到 2.0.0。** 当前 `ScopedStorageAdapter` 只有 `NullStorageAdapter` 一个实现，没有真实生产用户，breaking change 代价为零。趁现在改。

### 8.3.5 产出 5：context management 实现 + spike 测试驱动的 hooks 延伸

**用户原话：** "通过对 context management 的实现与测试，以及 spike 的测试，完成对 hooks 的延伸和扩展更新"

**当前代码事实：**
- `packages/hooks/src/catalog.ts` 仅 8 个 event（GPT §2.4 已核对）：SessionStart/End / UserPromptSubmit / PreToolUse / PostToolUse / PostToolUseFailure / PreCompact / PostCompact
- `nacp-core/src/messages/hook.ts` 的 wire body 已经 generic 到能容纳新 event（`{ event_name, event_payload }` + `{ ok, block?, updated_input?, additional_context?, stop?, diagnostics? }`）

**after-foundations 应 ship 的新 hook events（推断自产出 1 + 产出 4）：**

| 新增 event | 触发位置 | blocking? | allowedOutcomes |
|---|---|---|---|
| `PreContextAssemble` | 每次 turn 装 context 前 | ✅ | block / additionalContext / diagnostics |
| `PostContextAssemble` | 每次 turn 装完 context 后 | ❌ | additionalContext / diagnostics |
| `PreLayerLoad` | 单 layer load 前 | ✅ | block / updatedInput / diagnostics |
| `PostLayerLoad` | 单 layer load 后 | ❌ | diagnostics |
| `PreSnapshot` | snapshot 写入前 | ✅ | block / diagnostics |
| `PostSnapshot` | snapshot 写入后 | ❌ | additionalContext / diagnostics |
| `PreFileWrite` | filesystem capability 写入前 | ✅ | block / updatedInput / diagnostics |
| `PostFileWrite` | filesystem capability 写入后 | ❌ | additionalContext / diagnostics |
| `PreFileRead` | filesystem capability 读取前 | ✅ | block / diagnostics |
| `PrePromotion` | artifact 跨 tier 迁移前 | ✅ | block / diagnostics |
| `PostPromotion` | 同上之后 | ❌ | diagnostics |
| `PreArchive` | 数据归档前 | ✅ | block / diagnostics |
| `PostArchive` | 同上之后 | ❌ | diagnostics |

也就是 hook event catalog 从 **8 → 21**，是 **2.6 倍**的扩张。这是一次实质性的 protocol-level 升级。

**版本影响：**
- `hooks` 0.x → ⚠️ 可能 bump 到 1.0.0（catalog 是该包最 load-bearing 的契约）
- `nacp-core` 跟 1.2.0 一起走（`hook.emit/outcome` wire 不变，但 event_name allowed values 扩了）

**ship-ability：HIGH，但**必须与产出 1（context-management package）协同 ship**。理由：13 个新 event 中有 6 个是 context 相关（assemble/layer/snapshot），4 个是 filesystem 相关（write/read/promotion/archive）。这些 event 没有 producer 就是死代码——producer 就在 `context-management` 与 `storage-topology` 的 adapter 实现里。所以这两项必须**同期 ship**。

### 8.3.6 5 项产出物的 ship-ability 汇总

| 产出物 | ship-ability | 必须前置 | 与谁同期 ship |
|---|---|---|---|
| 1. `context-management` 新 package | HIGH | spike-do-storage（验证 storage 接口）；context strategy spec | 与产出 4、5 同期 |
| 2. nacp-core / nacp-session 1.2.0 | HIGH | 产出 1、3、4 都跑通后，spike-binding-pair 验证 | 最后一波 ship |
| 3. fake-bash 扩展 + just-bash port | MEDIUM-HIGH | spike-do-storage（验证 Workers runtime fake-bash 行为） | 与产出 4 同期 |
| 4. D1 / KV / R2 / DO storage adapter | HIGH（接口可能 breaking） | spike-do-storage 验证完成 | 第一波 ship |
| 5. hooks 扩展 8 → 21 events | HIGH | 产出 1 + 产出 4 同时 ship（否则 producer 不存在） | 与产出 1、4 同期 |

---

## 8.4 修正后的 after-foundations 阶段定义

### 8.4.1 阶段重命名

上文 §6.1 我把它命名为 **Phase 7.5 — Pre-Matrix Probing**。这个名字现在不够准确了——它不只是 probing，还是 ship code 的真实开发阶段。

修正命名：

> **Phase 7.5 — After-Foundations Consolidation: Spike-Driven Code Hardening**

### 8.4.2 修正后的 In-Scope（替换上文 §6.2）

**第一波（W1-W2）：spike 部署 + 真实事实暴露**
1. `spike-do-storage` 单 worker 部署到真实 Cloudflare 环境
2. `spike-binding-pair` 双 worker 部署，service-binding 真实通讯
3. 12 个验证项跑过（6 storage + 6 binding，见上文 §6.2）

**第二波（W2-W4）：spike 驱动的代码 ship**
4. 基于 spike-do-storage 发现，ship `storage-topology` 2.0.0：新增 `D1Adapter / R2Adapter / KvAdapter / DOStorageAdapter`，修订 `ScopedStorageAdapter` 接口（cursor、multipart、stale-read 显式化）
5. 基于 spike-do-storage 发现，ship `capability-runtime` fake-bash 扩展：port sed/awk/jq/wc/head/tail 等高频文本能力；接通 curl real fetch；明确 ts-exec/python 边界

**第三波（W4-W6）：context-management 新包 + 协议升级**
6. ship `packages/context-management/` 新包：strategy / budget / lifecycle / llm-driven 4 个子模块
7. ship `hooks` 1.0.0：catalog 从 8 → 21 events
8. ship `nacp-core` 1.2.0：扩展 context family + 新增 storage / filesystem family
9. ship `nacp-session` 1.2.0：新增 session 跨 worker 同步 message
10. **再次** spike 验证：用扩展后的协议 + 新 adapter + 新 hook event 在 spike worker 跑一遍 end-to-end

**全过程：design doc 与 code change 双流**
11. `docs/spikes/storage-findings.md` / `binding-findings.md` / `fake-bash-platform-findings.md`（与代码同期产出，作为协议演进 RFC 输入）

### 8.4.3 修正后的 Out-of-Scope（保留 + 补充）

1. **不做** spike 接生产数据 / 持有业务数据 / 实现新业务能力（spike 纪律保留）
2. **不做** 完整 5-worker matrix implementation（这是 Phase 8）
3. **不做** 完整 frontend-facing API / DDL（与 worker matrix 同期或更后）
4. **不做** 完整 browser / scrape / search productization（skill.core 议题）
5. **不做** 最终 context strategy 全冻结（context-management 包 ship 第一版即可，策略层留迭代空间）
6. **不做** filesystem.core / context.core 真实 worker shell（worker matrix 阶段做）
7. **不做** R2 + D1 + KV 跨 adapter 的 cross-namespace transactional reference 实现（先单 adapter 跑通，跨 adapter 留 worker matrix 后）

### 8.4.4 修正后的时长估计

| 周 | 内容 | 验收信号 |
|---|---|---|
| W1 | Spike-1 部署 + storage 6 验证项 | spike-do-storage live；storage findings 初稿 |
| W2 | Spike-2 部署 + binding 6 验证项；storage adapter 第一波 ship | spike-binding-pair live；`storage-topology` 2.0.0 RC |
| W3 | fake-bash 扩展 + just-bash port；hooks catalog 设计 | `capability-runtime` 扩展 RC；hook catalog spec |
| W4 | `context-management` 新包初版 ship；协议升级设计 | `context-management` 0.1.0 RC；nacp 1.2.0 spec |
| W5 | nacp-core / nacp-session 1.2.0 ship；hooks 1.0.0 ship；spike 重跑 e2e | 所有版本 frozen；spike e2e 通过 |
| W6 | 整合验证 + design docs 收口 | 进入 worker matrix 的所有前提都已 code-shipped + spike-validated |

**总时长：5-6 周。** 比上文 §6.5 的 3-4 周长 50-70%，但产出物从 docs 升级为 **shipped code + frozen contracts + validated adapters**。

---

## 8.5 一个仍需保留的 dialectical caution：循环依赖风险

### 8.5.1 风险描述

如果 after-foundations 同时要 ship 5 项代码 + 跑 2 个 spike，会出现一个 chicken-and-egg：

- 产出 4（storage adapters）需要 spike-do-storage 验证后再实现
- 但 spike-do-storage 想跑 fake-bash 写文件场景，又需要某种 storage adapter 才能跑
- 产出 1（context-management 新包）需要 spike 验证 context 集成
- 但 spike 跑 context 又需要 context-management 已存在

### 8.5.2 我推荐的破环方法

**两轮 spike**，不是一轮：

**轮 1（W1-W2）：bare-metal spike**
- 不接任何 adapter，直接调 Cloudflare runtime 原生 API（DO storage / R2 binding / KV binding / D1 binding / service binding）
- 目的：暴露 platform 真实行为，**不**验证我们的接口设计
- 输出：`spike-findings-platform-raw.md`

**轮 2（W5-W6）：integrated spike**
- 接入第二、三波 ship 出来的 adapter / context-management / 扩展协议
- 目的：验证我们 ship 的代码是否消化了轮 1 的发现
- 输出：`spike-findings-integrated.md`

这样轮 1 是 platform 真相、轮 2 是 contract 验证，破掉循环依赖。

### 8.5.3 这个方法的纪律延伸

回到上文 §4.3 立的 5 条 spike 纪律，这里再补 2 条：

6. **spike 代码两轮分目录**：`spikes/round-1-bare-metal/` 与 `spikes/round-2-integrated/`，互不污染
7. **轮 1 spike 不依赖任何 packages/ 代码**——它是 platform reality 探针，必须独立

---

## 8.6 与上文 §6 的差异点（明确给出 diff）

为了让读者能直接 diff 上文 §6 与本节 §8 的修订：

| 维度 | 上文 §6 | 本节 §8 修正 |
|---|---|---|
| 阶段名 | Phase 7.5 — Pre-Matrix Probing | Phase 7.5 — After-Foundations Consolidation: Spike-Driven Code Hardening |
| In-Scope 产出 | spike + design docs only | spike + design docs + **5 项代码 ship**（新 package、storage adapters、fake-bash 扩展、hooks 扩展、nacp 升级） |
| Out-of-Scope | "不做协议升级、不做 hooks 扩展、不做 nacp 升级、不做 context spec" | **删除**这 4 条，改为"不做 worker matrix、不做 frontend、不做 browser、不做最终冻结" |
| 时长 | 3-4 周 | 5-6 周 |
| Spike 形态 | 1 轮 spike | 2 轮 spike（bare-metal → integrated） |
| 输出物性质 | docs primary | code + docs + frozen protocol versions |
| 协议升级 | 推迟到下一 phase | **本阶段完成**：nacp-core 1.2.0 / nacp-session 1.2.0 / storage-topology 2.0.0 / hooks 1.0.0 / 新建 context-management 0.1.0 |

---

## 8.7 与 GPT 评估的最终对照

**GPT** 在其 `before-worker-matrix-eval-with-GPT.md` §6 的 In-Scope 列出 6 项：
1. just-bash 与 nano fake-bash 的差异收敛
2. Cloudflare-native storage adapter / loop 验证
3. 更真实的 context package 演化
4. hook taxonomy 扩充与实现
5. NACP core / session 的协议更新
6. spike worker / probe worker 的真实部署验证

**用户**新提的 5 项产出（不仅 docs，必须 ship 代码）：
1. 新 context-management package
2. nacp.core / nacp.session 修改
3. fake-bash + just-bash port
4. D1 / KV / R2 真实代码抽象
5. context management 实现 + hooks 延伸

**Opus 本节 §8 修正后的 In-Scope** 11 项（合 GPT + 用户 + spike 双轮）：
1-3. 第一波：双 spike 部署 + 12 验证项跑过
4-5. 第二波：storage adapter ship + fake-bash 扩展 ship
6-9. 第三波：context-management 新包 + hooks 1.0.0 + nacp-core 1.2.0 + nacp-session 1.2.0
10. 第三波末：用扩展后协议在 spike 跑 e2e
11. design docs 双流产出

**结论：用户、GPT、Opus 三方独立思考的 In-Scope 重叠度 > 80%。** 三方在同一时间窗给出基本一致的判断，这是这条思维链至今最高的方向共识——这强烈支持 after-foundations 阶段就是当前正确的下一步。

---

## 8.8 §8 verdict

### 8.8.1 对你这次反驳的回应

> **你是对的。我上文 §6.2 把"协议升级、hooks 扩展、nacp 更新"列为 Out-of-Scope 是错的。本节正式把它们改回 In-Scope，并按 spike 双轮 + 三波 ship 的方式给出可执行路径。**

### 8.8.2 对 after-foundations 阶段的最终定义

> **After-Foundations Consolidation 是 nano-agent 进入 worker matrix 之前的最后一个 code-shipping phase。它的本质是：用 2 轮 spike worker 在真实 Cloudflare runtime 暴露 platform truth，并基于这些真相同期 ship 5 类代码（新 context-management package、修订后的 storage adapters、扩展后的 fake-bash、扩展后的 hooks catalog、升级后的 nacp 协议）。它的成功标准是：进入 worker matrix 阶段时，所有 surface contract 都已被 spike 验证后冻结，所有 worker matrix 阶段的代码工作都只是"组装已验证组件"，而不是"边写边验证"。**

### 8.8.3 一句话总结

> **after-foundations 不是文档阶段，是 ship 阶段——ship 经过 Cloudflare 真实 spike 验证后的 5 类代码（context-management 新包 / 真实 storage adapters / 扩展 fake-bash / 扩展 hooks 21-event catalog / nacp 1.2.0 协议升级）。spike 用两轮：第一轮 bare-metal 验证 platform 真相，第二轮 integrated 验证 ship 的代码消化了真相。5-6 周，产出物是冻结的契约 + 已验证的 packages，让 worker matrix 阶段从"边写边验证"降级为"组装已验证组件"。这是用户、GPT、Opus 三方独立思考收敛得到的最高共识方案。**

---

## 附 C：基于 §8 修正的可执行下一步

如果你采纳本节修正，建议的可执行序列：

1. 创建 `docs/plan-after-foundations.md`（参考 `docs/plan-after-skeleton.md` 格式），列出 §8.4 的 In-Scope 11 项 / 6 周时间线 / Out-of-Scope 7 项
2. 创建 `spikes/round-1-bare-metal/spike-do-storage/` 与 `spikes/round-1-bare-metal/spike-binding-pair/`
3. 创建 `spikes/round-2-integrated/`（暂留空，第三波 ship 完后填入）
4. 创建 `packages/context-management/`（package skeleton + package.json + 4 个子模块目录）
5. 创建 ~~`docs/spikes/_TEMPLATE-finding.md`~~ → **已落到 `docs/templates/_TEMPLATE-spike-finding.md`**（业主决策，2026-04-19）与三个 finding 文档骨架
6. 创建 RFC 模板 `docs/rfc/_TEMPLATE-protocol-extension.md`，作为 nacp-core 1.2.0 / nacp-session 1.2.0 / hooks 1.0.0 升级的设计输入

## 附 D：基于 §8 新增的代码事实快照

| 事实 | 文件 | 行号 / 备注 |
|---|---|---|
| `context/just-bash/` 是 vercel-labs/just-bash v2.14.2 vendored copy | `context/just-bash/package.json` | 含 ast/cli/commands/fs/helpers/interpreter/network/parser/regex/sandbox/security/shell 12 个子目录 |
| `packages/capability-runtime/src/fake-bash/` 仅 3 文件 12KB | bridge.ts / commands.ts / unsupported.ts | minimal subset |
| `nacp-core` message families 5 个：tool/hook/skill/context/system | `packages/nacp-core/src/messages/index.ts` | 当前 1.1.0 |
| `nacp-core` context family 仅 2 message | `packages/nacp-core/src/messages/context.ts` | compact.request/response |
| `nacp-session` 8 message kinds | `packages/nacp-session/src/messages.ts` | 当前 1.1.0 |
| `prepared-artifacts.ts` 暴露 `StubArtifactPreparer` | `packages/workspace-context-artifacts/src/prepared-artifacts.ts` | GPT §2.3 已引用 |
| `promotion.ts` `DEFAULT_PROMOTION_POLICY` 仍 provisional | `packages/workspace-context-artifacts/src/promotion.ts` | GPT §2.3 已引用 |
| `hook.emit/outcome` wire body 已足够通用容纳新 event_name | `packages/nacp-core/src/messages/hook.ts` | GPT §2.4 已引用 |

这些事实加上附 B 的 12 项基线 checklist，构成 Phase 7.5 立项 review 的完整事实底座。

