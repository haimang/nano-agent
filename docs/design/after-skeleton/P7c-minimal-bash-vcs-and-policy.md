# Nano-Agent Minimal Bash VCS and Policy 功能簇设计

> 功能簇: `Minimal Bash VCS and Policy`
> 讨论日期: `2026-04-17`
> 讨论者: `GPT-5.4`
> 关联调查报告:
> - `docs/plan-after-skeleton.md`
> - `docs/design/after-skeleton/P7a-minimal-bash-search-and-workspace.md`
> - `docs/design/after-skeleton/P7b-minimal-bash-network-and-script.md`
> - `docs/eval/vpa-fake-bash-by-GPT.md`
> - `docs/design/after-nacp/capability-runtime-by-GPT.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

只要 fake bash 开始像样，LLM 很快就会进一步假设自己可以：

- `git status`
- `git diff`
- `git log`
- 甚至 `git add` / `git commit` / `git checkout`

而当前仓库的现实很明确：

- minimal command pack 已注册一个 `git` capability，默认 policy 是 `allow`（`packages/capability-runtime/src/fake-bash/commands.ts:130-142`）。
- planner 能把 `git <subcommand> [args...]` 解析成 `{ subcommand, args }` 的 structured input（`packages/capability-runtime/src/planner.ts:145-146`）。
- 当前 `createVcsHandlers()` 只支持 `status / diff / log` 三个子命令，而且仍是 stub 文案，不是真实 VCS backend（`packages/capability-runtime/src/capabilities/vcs.ts:16-48`）。
- `UNSUPPORTED_COMMANDS` 与 `OOM_RISK_COMMANDS` 已经存在一套很清楚的 blocked taxonomy（`packages/capability-runtime/src/fake-bash/unsupported.ts:15-105`）。
- `FakeBashBridge` 已验证 unsupported / unknown / oom-risk / no-executor 都必须 hard-fail，而不是 fabricate success（`packages/capability-runtime/test/fake-bash-bridge.test.ts:79-210`）。
- just-bash 的命令注册表展示了“命令 surface 必须显式枚举”的价值；codex 的 registry plan 展示了“handler kind 与 capability inventory 应先于实现扩张”；claude-code 展示了“高风险工具必须纳入 permission/hook/telemetry 主链”（`context/just-bash/src/commands/registry.ts:14-116`; `context/codex/codex-rs/tools/src/tool_registry_plan.rs:67-184`; `context/claude-code/services/tools/toolExecution.ts:126-131`）。

所以 Phase 7c 的任务不是“把 git 带进 Worker”，而是：

> **冻结 nano-agent 在 fake bash 下关于 virtual VCS、unsupported surface、risk taxonomy、registry/prompt/TS guard 对齐的最小治理模型。**

- **项目定位回顾**：fake bash 是兼容层，不是 Linux 幻觉工厂；凡是宿主做不到或代价极高的面，都应该显式声明 unsupported/deferred/risky。
- **本次讨论的前置共识**：
  - VCS v1 先是 virtual read-mostly subset，不是完整 git clone。
  - unsupported surface 必须 hard-fail，不允许 success-shaped fallback。
  - command registry、system prompt、TypeScript guard 三处必须同口径。
  - capability inventory 是最后的公开真相，不是 README 文案修辞。
- **显式排除的讨论范围**：
  - 不讨论真实 git object database / refs / index 实现
  - 不讨论 commit signing / remote push / auth
  - 不讨论 rebase / merge / cherry-pick / submodule / worktree
  - 不讨论 generalized shell compatibility 扩张

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Minimal Bash VCS and Policy`
- **一句话定义**：它负责把 fake bash 中最容易引发“我有一台完整开发机”幻觉的 VCS 与 shell policy 面冻结成一个 registry-first、hard-fail、可盘点的治理模型。
- **边界描述**：**包含** git minimal subset、unsupported/risky taxonomy、registry declaration、prompt guard、TS guard、inventory 对齐；**不包含**完整 git 语义、远程仓库操作、process/job control、package manager 恢复。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| **Virtual VCS** | Worker-native 的 git 兼容表面 | 不等于真实 `git` 进程 |
| **Read-Mostly Subset** | 只读或低风险 introspection 命令集合 | v1 先收敛为 `status/diff/log` |
| **Unsupported Surface** | 明确不支持、直接报错的命令族 | 不允许模糊失败 |
| **OOM-Risk Surface** | 因 V8 isolate 内存风险而主动拦截的命令族 | 如 `tar/gzip/unzip` |
| **Registry Truth** | 命令名/target/policy 的单一真相来源 | `registerMinimalCommands()` |
| **Prompt Guard** | system prompt/tool docs 对模型的约束 | 必须与 registry truth 对齐 |

### 1.2 参考调查报告

- `context/just-bash/src/commands/registry.ts` — 明确枚举 command names 与 lazy loaders，说明 command surface 必须受中心化清单治理（`14-116`）
- `context/codex/codex-rs/tools/src/tool_registry_plan.rs` — 说明 tool inventory 与 handler kind 规划应先于 capability 扩张（`67-184`）
- `context/claude-code/services/tools/toolExecution.ts` — 说明高风险工具不只是 declaration，还要受 permission/hook/telemetry 约束（`126-131`, `173-245`）
- `docs/eval/vpa-fake-bash-by-GPT.md` — 已明确建议 nano-agent 对 git 只保留 subset，并明确 unsupported/deferred/risky inventory

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **fake bash 能力面治理收口层**。
- 它服务于：
  1. `capability-runtime`
  2. prompt/tool docs
  3. reviewers / inventory maintainers
  4. future VCS / policy expansion
- 它依赖：
  - `P7a-minimal-bash-search-and-workspace.md`
  - `P7b-minimal-bash-network-and-script.md`
  - `registerMinimalCommands()`
  - `UNSUPPORTED_COMMANDS / OOM_RISK_COMMANDS`
- 它被谁依赖：
  - `PX-capability-inventory.md`
  - future fake bash action-plan
  - system prompt / client capability disclosure

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| `Minimal Bash Search and Workspace` | Workspace -> VCS | 强 | VCS 读到的状态必须与 workspace truth 对齐 |
| `Minimal Bash Network and Script` | Policy -> Surface | 强 | unsupported/risky taxonomy 要统一 |
| `Capability Runtime` | 双向 | 强 | registry/planner/executor/policy 是主承载层 |
| `External Seam Closure` | VCS -> External | 中 | future remote VCS worker 不能推翻 v1 subset contract |
| `Deployment Dry-Run` | Verification -> Policy | 中 | unsupported/risky 行为需要真实 smoke |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Minimal Bash VCS and Policy` 是 **fake bash 的能力治理收口层**，负责 **把 virtual git、unsupported 命令面、risk taxonomy、registry/prompt/TS guard 三方对齐成一套单一真相**，对上游提供 **清楚的 supported/deferred/risky 边界**，对下游要求 **任何新命令都不能绕过 inventory 与 guard 私自扩张**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| `git add/commit/restore/checkout/branch` | 本地 git 工作流 | 当前没有 virtual index/ref/object model | 可能 |
| `git rebase/merge/cherry-pick` | 真实 git | 对 Worker runtime 与 review surface 过重 | 否 |
| shell job/process 管理 | 本地 CLI | 与 Worker/V8 isolate 心智相冲突 | 否 |
| package managers (`npm/pip/pnpm/...`) | 本地机器工具链 | 已被 unsupported set 否定 | 否 |
| archive/compression shell tools | 通用 shell | 已被 OOM-risk law 否定 | 可能，以 streaming capability 替代 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| Virtual git subset | `git` capability + structured input | `status/diff/log` | `show/ls-files/blame` 等只读扩张 |
| Unsupported taxonomy | `UNSUPPORTED_COMMANDS` | hard-fail | richer error families / explainers |
| OOM-risk taxonomy | `OOM_RISK_COMMANDS` | hard-fail with explicit memory rationale | streaming archive capabilities |
| Prompt guard | tool docs / system prompt text | 明示 supported/deferred/risky | dynamic inventory injection |
| TS guard | registry + tests + inventory diff | 人工维护 | generated inventory checks |

### 3.3 完全解耦点（哪里必须独立）

- **VCS subset 与真实 git backend**
  - **解耦原因**：Phase 7c 先冻结 subset 语义，不冻结存储实现。
  - **依赖边界**：future real/virtual VCS engine 必须遵守 `status/diff/log` contract，而不是反过来改文档。

- **Unsupported taxonomy 与 parser behavior**
  - **解耦原因**：unsupported 是 policy/governance 判定，不是 parser 是否“恰好不会解析”。
  - **依赖边界**：即使以后 parser 变强，unsupported 仍需显式维护。

- **Prompt guard 与 runtime enforcement**
  - **解耦原因**：prompt 可以降低误用，但不能代替 runtime hard-fail。
  - **依赖边界**：runtime truth 优先，prompt 只能解释它。

### 3.4 聚合点（哪里要刻意收敛）

- **所有 command declarations 收敛到 `registerMinimalCommands()`**
- **所有 unsupported 命令族收敛到 `UNSUPPORTED_COMMANDS`**
- **所有 OOM-risk 命令族收敛到 `OOM_RISK_COMMANDS`**
- **所有 public-facing capability truth 收敛到 capability inventory**

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：更依赖本地 git / 本地环境，不需要显式 unsupported inventory。
- **亮点**：
  - 本地工具直觉强
- **值得借鉴**：
  - 模型确实会天然期待 git/status/diff 这类工作流
- **不打算照抄的地方**：
  - 不把本地 git 进程假设带进 Worker runtime

### 4.2 codex 的做法

- **实现概要**：tool registry plan 很适合做 allowlist/handler kind 治理。
- **亮点**：
  - capability surface 明确
  - registry truth 稳定
- **值得借鉴**：
  - 新命令必须先进入 inventory/registry，再谈实现
- **不打算照抄的地方**：
  - 不复制其完整 shell/tool/search 大矩阵

### 4.3 claude-code 的做法

- **实现概要**：工具执行治理成熟，尤其在 permission 与 telemetry 上。
- **亮点**：
  - 不把高风险工具当“随便跑”
- **值得借鉴**：
  - VCS / shell 风险命令同样要进 permission/hook/telemetry 主链
- **不打算照抄的地方**：
  - 不复制其本地 CLI 宿主与大量现成 shell 假设

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| VCS 宿主假设 | 本地 git | 本地环境 | 本地环境 | virtual subset |
| unsupported taxonomy 显式度 | 低 | 中高 | 中高 | 高 |
| registry 中心化 | 低 | 高 | 中 | 高 |
| Worker/V8 适配度 | 低 | 低 | 低 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1] Virtual git minimal subset**
  - 必须冻结 `git status / git diff / git log` 作为 v1 唯一正式承诺的 VCS bash surface。

- **[S2] Unsupported / OOM-risk taxonomy**
  - 必须把 unsupported 与 oom-risk 视为一等 contract，而不是临时黑名单。

- **[S3] Registry / prompt / TS guard alignment**
  - 必须确保命令清单、提示词、测试与 inventory 口径一致。

- **[S4] Hard-fail policy**
  - unsupported / unknown / no-executor / risk-blocked 必须稳定返回错误，而不是 success-shaped fallback。

- **[S5] Capability inventory closure**
  - 所有 supported/deferred/risky 结论都必须进最终 inventory memo。

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1] `git add` / `git commit` / `git restore` / `git branch`**
- **[O2] remote git auth / fetch / push / pull**
- **[O3] rebase / merge / cherry-pick / hooks / submodule / worktree**
- **[O4] package manager / system command 恢复**
- **[O5] 让 unsupported surface 退化为“提示成功但没做事”**

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `git status` | in-scope | 当前代码 reality 已冻结到这个级别 |
| `git diff` / `git log` | in-scope | 同上 |
| `git add` / `git commit` | out-of-scope | 当前没有 virtual index / commit model |
| `tar/gzip/unzip` | out-of-scope，并且 risk-blocked | 不是“暂时没做”，而是主动拦截 |
| `npm/pnpm/pip/docker/ssh` | out-of-scope，并且 unsupported | 与 Worker-native fake bash 心智冲突 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **virtual read-mostly VCS subset** 而不是 **完整 git**
   - **为什么**：当前只有 introspection contract 已成型，mutating VCS 还没有数据模型支撑。
   - **我们接受的代价**：模型不能在 v1 中直接 `git add/commit`。
   - **未来重评条件**：当 virtual index/commit/object model 被正式设计出来后。

2. **取舍 2**：我们选择 **hard-fail unsupported surface** 而不是 **模糊降级**
   - **为什么**：silent success 是 fake bash 最危险的欺骗。
   - **我们接受的代价**：短期会显得“能力面更窄”。
   - **未来重评条件**：无；这是 correctness law。

3. **取舍 3**：我们选择 **registry-first governance** 而不是 **实现先行、文档补票**
   - **为什么**：fake bash 一旦扩张，最先失控的就是能力面口径。
   - **我们接受的代价**：新增命令需要多一步 inventory/review。
   - **未来重评条件**：无；这是平台化必要成本。

4. **取舍 4**：我们选择 **risk taxonomy 明示** 而不是 **把所有不支持都混成一个大“unsupported”**
   - **为什么**：OOM-risk 与宿主不支持是两种完全不同的治理信号。
   - **我们接受的代价**：错误码与 inventory 结构更复杂一点。
   - **未来重评条件**：当 risk taxonomy 被证明不再提供治理价值时再简化；当前不会。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| 用户/模型默认期待 `git commit` | 受本地 CLI 训练先验影响 | 任务路径误判 | prompt guard + inventory 明示 subset |
| unsupported list 与 prompt 漂移 | 只改一处文档/代码 | 对外口径不一致 | inventory 作为单一汇总真相，并加 smoke checks |
| risk taxonomy 被滥用 | 什么都丢进 risk-blocked | inventory 失焦 | 区分 unsupported / deferred / oom-risk 三类 |
| 后续 remote worker 改写 subset | 实现团队只看 transport 不看 inventory | contract 波动 | subset contract 在设计文档中先冻结 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：可以非常清楚地知道哪些命令应该直接拒绝，哪些未来可扩展。
- **对 nano-agent 的长期演进**：为更大的 fake bash surface 建立治理模版。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：稳定性收益最大，因为 unsupported surface 不再靠口头约束。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Virtual Git Subset | 冻结 `status/diff/log` 三个只读子命令 | VCS 能力面不再漂移 |
| F2 | Unsupported Taxonomy | 冻结 unsupported families | 禁止宿主幻觉回流 |
| F3 | OOM-Risk Taxonomy | 冻结 archive/compression 风险命令族 | 资源风险有专门错误语义 |
| F4 | Registry/Prompt/TS Guard Alignment | 三方口径对齐 | 文档与代码不再脱节 |
| F5 | Inventory Closure | 最终 supported/deferred/risky 总表 | 所有结论可审阅 |

### 7.2 详细阐述

#### F1: `Virtual Git Subset`

- **输入**：`git` declaration、planner、VCS handler
- **输出**：v1 git subset contract
- **主要调用者**：LLM VCS introspection path、inventory、future virtual repo engine
- **核心逻辑**：
  - 只承诺 `status/diff/log`
  - bash string 与 structured input 都映射到同一 `git` capability
  - mutating git 全部 defer
- **一句话收口目标**：✅ **`v1 git 只是一组可解释的 introspection capabilities，而不是完整仓库控制台`**

#### F2: `Unsupported Taxonomy`

- **输入**：`UNSUPPORTED_COMMANDS`
- **输出**：explicit unsupported families
- **主要调用者**：FakeBashBridge、prompt、inventory
- **核心逻辑**：
  - package managers / privilege / containers / system / ssh 等全部明确拒绝
  - 错误要说明“需要真实 OS access 或被安全策略阻止”
- **一句话收口目标**：✅ **`unsupported surface 是清单化、硬失败、可解释的`**

#### F3: `OOM-Risk Taxonomy`

- **输入**：`OOM_RISK_COMMANDS`
- **输出**：resource-risk families
- **主要调用者**：FakeBashBridge、inventory、future streaming archive design
- **核心逻辑**：
  - `tar/gzip/unzip/...` 与 unsupported 分开
  - 错误信息必须明确是因为 isolate memory law
- **一句话收口目标**：✅ **`资源风险不再被模糊地混进“暂时不支持”`**

#### F4: `Registry/Prompt/TS Guard Alignment`

- **输入**：registry、tests、prompt docs、inventory
- **输出**：统一真相
- **主要调用者**：reviewers、maintainers、client disclosure
- **核心逻辑**：
  - registry 是命令 truth
  - prompt 解释 truth，不新增 truth
  - tests 防止 drift
- **一句话收口目标**：✅ **`命令口径不会在代码、提示词、文档三处各说各话`**

#### F5: `Inventory Closure`

- **输入**：Phase 7a/7b/7c 设计结论
- **输出**：`PX-capability-inventory.md`
- **主要调用者**：owner review、future action-plan、prompt maintainers
- **核心逻辑**：
  - 每个 capability 都带 supported/deferred/risky judgement
  - judgement 必须带 evidence reality
- **一句话收口目标**：✅ **`所有 fake bash 能力都有最终归档，不再散落在各文档角落`**

### 7.3 非功能性要求

- **性能目标**：unsupported/risky 判定必须在 planning/dispatch 早期完成。
- **可观测性要求**：拒绝路径也应可挂 trace 和 audit。
- **稳定性要求**：registry truth 优先于 prompt 文案。
- **测试覆盖要求**：至少需要 unsupported、oom-risk、git subset、inventory drift 四类 smoke。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 nano-agent 当前代码

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `packages/capability-runtime/src/capabilities/vcs.ts:16-48` | git subset stub | 当前 v1 VCS reality 的直接锚点 | 明确只有 `status/diff/log` |
| `packages/capability-runtime/src/fake-bash/unsupported.ts:15-105` | unsupported + oom-risk lists | taxonomy 已经成形 | Phase 7c 要把它们升级成 policy truth |
| `packages/capability-runtime/test/fake-bash-bridge.test.ts:90-133` | hard-fail rejection paths | no silent success 已有测试锚点 | 很重要的 correctness asset |

### 8.2 来自 just-bash

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/just-bash/src/commands/registry.ts:14-116` | explicit command-name registry | command surface 必须中心化管理 | 很适合 capability inventory |

### 8.3 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/tools/src/tool_registry_plan.rs:67-184` | registry plan / handler kind mapping | 支持面扩张前先做 plan/inventory | 平台型思路很稳 |

### 8.4 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/services/tools/toolExecution.ts:173-245` | permission/hook/telemetry-woven tool execution | 高风险能力不只是 declaration，还要进治理主链 | 为 prompt/guard 一致性提供参考 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`Minimal Bash VCS and Policy` 是 fake bash 从“命令表”走向“能力治理”的那一层。它真正冻结的不是 git 本身，而是一个态度：只承诺我们真的有的 subset；没有的能力要么 defer，要么 unsupported，要么因资源风险被主动拦截；所有这些都必须在 registry、prompt、TS guard 和 inventory 里保持单一真相。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | fake bash 若无治理，很快会失控 |
| 第一版实现的性价比 | 5 | 主要是治理收敛，收益非常高 |
| 对未来“上下文管理 / Skill / 稳定性”演进的杠杆 | 4 | 尤其提升稳定性与 review 可控性 |
| 对开发者自己的日用友好度 | 5 | 新命令是否该进系统会更清楚 |
| 风险可控程度 | 5 | 方向明确，且已部分有代码锚点 |
| **综合价值** | **5** | **应作为 Phase 7 的治理收口文稿保留** |

### 9.3 下一步行动

- [ ] **决策确认**：确认 `git` v1 是否严格冻结为 `status/diff/log`，不提前承诺 mutating subset。
- [ ] **关联 Issue / PR**：补 inventory drift guard，避免 registry 与 capability inventory 脱节。
- [ ] **待深入调查的子问题**：
  - [ ] future virtual git 是否需要 `show/ls-files` 这类只读扩张
  - [ ] unsupported / oom-risk 是否拆成更细的 client-visible error families
- [ ] **需要更新的其他设计文档**：
  - `docs/design/after-skeleton/PX-capability-inventory.md`

---

## 附录

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-17` | `GPT-5.4` | 初稿 |
