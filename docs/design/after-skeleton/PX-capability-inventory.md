# Nano-Agent Capability Inventory Memo

> 功能簇: `Capability Inventory`
> 讨论日期: `2026-04-17`
> 讨论者: `GPT-5.4`
> 关联调查报告:
> - `docs/plan-after-skeleton.md`
> - `docs/design/after-skeleton/P7a-minimal-bash-search-and-workspace.md`
> - `docs/design/after-skeleton/P7b-minimal-bash-network-and-script.md`
> - `docs/design/after-skeleton/P7c-minimal-bash-vcs-and-policy.md`
> - `docs/eval/vpa-fake-bash-by-GPT.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

在 Phase 7 的三份设计文档写完之后，nano-agent 已经不缺“观点”，缺的是一份最终可执行的总表：

- 哪些 capability **现在真支持**
- 哪些只是 **partial / degraded / reserved**
- 哪些是 **明确 deferred**
- 哪些是 **明确 unsupported**
- 哪些是 **因为 V8 isolate 风险而主动 blocked**

而当前仓库已经给了我们做这份 inventory 所需的核心事实：

- command registry 已固定为 12 个 minimal commands（`packages/capability-runtime/src/fake-bash/commands.ts:16-143`）。
- FakeBashBridge rejection path 已明确、且有测试锚点（`packages/capability-runtime/src/fake-bash/bridge.ts:68-109`; `packages/capability-runtime/test/fake-bash-bridge.test.ts:90-210`）。
- workspace truth 已固定在 `MountRouter + WorkspaceNamespace`（`packages/workspace-context-artifacts/src/mounts.ts:38-158`; `namespace.ts:17-120`）。
- network / exec / vcs 里仍存在明显 stub/degraded reality（`capabilities/network.ts`, `exec.ts`, `vcs.ts`）。
- service-binding / browser-rendering target 目前还是 reserved seam，不是 fully available target（`targets/service-binding.ts`, `targets/browser-rendering.ts`）。

因此这份 inventory memo 的任务不是重复描述，而是：

> **把 Phase 7 的 supported / deferred / risky judgement 收敛成一份单一真相，供 prompt、review、action-plan 与 future implementation 共用。**

- **项目定位回顾**：nano-agent 的能力面必须小而硬，inventory 不是营销页，而是 contract truth。
- **本次讨论的前置共识**：
  - inventory 以当前代码 reality 为准，而不是以“未来想做什么”为准。
  - `partial` 与 `supported` 必须区分开。
  - `unsupported` 与 `oom-risk-blocked` 也必须区分开。
  - 若 evidence 不足，inventory 必须明确写出不足，而不是自动上调等级。
- **显式排除的讨论范围**：
  - 不讨论 action-plan 粒度
  - 不讨论 client UX 文案细节
  - 不讨论未来组织级 registry / DDL

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Capability Inventory`
- **一句话定义**：它负责作为 nano-agent fake bash / capability runtime 的最终能力总表，汇总 supported、partial、deferred、unsupported、risk-blocked 的单一真相。
- **边界描述**：**包含** command inventory、target inventory、workspace substrate inventory、evidence grade、risk taxonomy；**不包含**实现步骤、产品文案、未来 roadmap 细节。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| **Supported** | declaration + implementation + 基本 evidence 已成立 | 可以对外承诺 |
| **Partial** | declaration 存在，但实现仍 stub/degraded/不完整 | 不能说 fully supported |
| **Deferred** | 本期明确不做，但未来可回到议程 | 不在 registry truth 中 |
| **Unsupported** | 主动拒绝的命令/能力 | 直接 hard-fail |
| **Risk-Blocked** | 因 isolate budget / security risk 主动阻断 | 不是“以后自然支持” |
| **Capability Maturity Grade** | 当前支持判断背后的实现/验证成熟度 | E0-E3；不同于 P6 的 calibration verdict |

### 1.2 Capability Maturity Grade 定义

| 等级 | 含义 | 典型例子 |
|------|------|----------|
| **E0** | 只有 declaration / 文档，没有执行证据 | reserved target |
| **E1** | 有 handler/bridge 但明显 stub 或 degraded | `curl` / `ts-exec` / `git` 当前 local-ts handlers |
| **E2** | 有 package-level tests / integration evidence | `FakeBashBridge` rejection、workspace package tests |
| **E3** | 有跨包 E2E evidence | workspace file ops / snapshot promotion 等 |

> **术语边界**：PX 的 E0-E3 只回答“能力成熟度到哪了”；P6 的 `provisional / evidence-backed / needs-revisit / contradicted-by-evidence` 只回答“某条 storage/context 假设是否被证据支撑”。两者并列存在，但不互相替代。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **能力真相总表**。
- 它服务于：
  1. prompt/tool docs
  2. reviewers
  3. future action-plan writers
  4. runtime implementers
- 它依赖：
  - Phase 7a/7b/7c 三份设计
  - current package code reality
  - existing tests/e2e evidence
- 它被谁依赖：
  - capability disclosure
  - future drift guards
  - owner review / phase closure

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| `Minimal Bash Search and Workspace` | Design -> Inventory | 强 | workspace/search judgement 直接进入总表 |
| `Minimal Bash Network and Script` | Design -> Inventory | 强 | curl/ts-exec judgement 直接进入总表 |
| `Minimal Bash VCS and Policy` | Design -> Inventory | 强 | unsupported/risky taxonomy 从这里汇总 |
| `Capability Runtime` | Runtime -> Inventory | 强 | registry/targets/results 是事实来源 |
| `Deployment Dry-Run` | Evidence -> Inventory | 中 | future dry-run 可提升某些 capability evidence grade |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Capability Inventory` 是 **fake bash 能力面的单一真相表**，负责 **把 registry、handlers、tests、policy 与风险分类收敛成一份 supported / partial / deferred / unsupported / risk-blocked inventory**，对上游提供 **可信的能力披露**，对下游要求 **新增命令与新增承诺必须先更新 inventory 再扩张实现**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 理由 | 未来是否可能回补 |
|--------|------|------------------|
| 模糊的“基本支持”措辞 | 无法指导 prompt/review | 否 |
| 只按 command name 盘点，不看 evidence | 会把 stub 误写成 fully supported | 否 |
| 把 unsupported 与 risk-blocked 混为一类 | 会丢失治理信息 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 第一版行为 | 未来可能的演进方向 |
|--------|------------|---------------------|
| Capability maturity grade | E0-E3 | finer-grained runtime evidence |
| Capability groups | command/target/substrate 三层 | future hook/skill/provider capability inventory |
| Drift guard | 人工维护 + review smoke | generated docs/tests |

### 3.3 完全解耦点（哪里必须独立）

- **Inventory judgement 与实现愿景**
  - **解耦原因**：想做什么不等于现在支持什么。
  - **依赖边界**：inventory 永远以当前 reality/evidence 为准。

- **Capability inventory 与 marketing/README 文案**
  - **解耦原因**：README 可以讲方向，但 inventory 负责讲真相。
  - **依赖边界**：README 不得高于 inventory。

### 3.4 聚合点（哪里要刻意收敛）

- **所有 fake bash capability judgement 聚合到本 memo**
- **所有 risk taxonomy 聚合到本 memo**
- **所有 future upgrade prerequisites 聚合到本 memo 的备注栏**

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：更接近自然拥有本地能力，因此无需如此严格的 inventory。
- **值得借鉴**：能力面最好让模型感觉自然。
- **不照抄**：不借本地宿主来掩盖 Worker reality。

### 4.2 codex 的做法

- **实现概要**：registry/handler kind 规划强，适合 inventory-first。
- **值得借鉴**：能力总表应先于能力扩张。

### 4.3 claude-code 的做法

- **实现概要**：高风险工具治理成熟，说明 inventory 不应只是静态列表，还要关联 policy/telemetry。
- **值得借鉴**：能力披露必须跟执行治理一起看。

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| inventory 显式度 | 低 | 高 | 中高 | 高 |
| partial support 诚实度 | 低 | 中高 | 中 | 高 |
| risk taxonomy 显式度 | 低 | 中 | 中高 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1] Command inventory**
- **[S2] Target inventory**
- **[S3] Workspace substrate inventory**
- **[S4] Evidence grade**
- **[S5] Unsupported / risk-blocked summary**

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1] 自动生成 inventory 的 build tooling**
- **[O2] client-facing fancy capability explorer**
- **[O3] 未来 hooks/skills/provider 全量 inventory**

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **诚实地区分 supported 与 partial** 而不是 **为了好看统一叫 supported**
   - **为什么**：stub/degraded reality 如果被包装成 fully supported，会直接误导 prompt 与开发。
   - **我们接受的代价**：清单看起来更保守。
   - **未来重评条件**：当 evidence 提升时再升级等级。

2. **取舍 2**：我们选择 **把 evidence grade 写进 inventory** 而不是 **只列命令名**
   - **为什么**：命令名本身不说明成熟度。
   - **我们接受的代价**：inventory 更像工程真相表，不像简单说明文。
   - **未来重评条件**：无；这正是它的价值。

3. **取舍 3**：我们选择 **risk-blocked 单列** 而不是 **一律塞进 unsupported**
   - **为什么**：资源风险是非常具体的 V8/Worker 约束，应该可见。
   - **我们接受的代价**：分类稍多。
   - **未来重评条件**：当 streaming/archive capability 落地后再调整。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| inventory 很快过期 | 代码改了但文档没跟 | 对外口径失真 | 把 inventory drift 纳入 review gate |
| evidence 评级过于主观 | 无明确标准 | 审阅争论 | 固定 E0-E3 定义 |
| partial 与 deferred 混淆 | 术语不清 | 实现顺序失真 | 在 memo 中固定术语 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：以后讨论 capability 时可以直接对着表说话。
- **对 nano-agent 的长期演进**：为 future hooks/skills/provider inventory 提供模板。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：稳定性收益最大，因为能力面不再口头漂移。

---

## 7. Inventory 总表

### 7.1 Command Inventory

| Capability | Kind | Target | Policy | 等级 | Evidence | 备注 |
|------------|------|--------|--------|------|----------|------|
> **Command order law (A8-A10 review GPT R4 / Kimi R5)**: the rows
> below are listed in the same **canonical order** as
> `MINIMAL_COMMANDS` in `packages/capability-runtime/src/fake-bash/commands.ts`.
> `packages/capability-runtime/test/inventory-drift-guard.test.ts` parses
> this table and fails CI if the row order, policy column, or command
> set diverges from the code.

| `pwd` | filesystem | `local-ts` | allow | **Supported** | E2 | 有 planner + local target + package tests |
| `ls` | filesystem | `local-ts` | allow | **Supported** | E3 | 已有 workspace-backed E2E evidence |
| `cat` | filesystem | `local-ts` | allow | **Supported** | E3 | 已有 workspace-backed E2E evidence |
| `write` | filesystem | `local-ts` | ask | **Supported (ask-gated)** | E3 | handler 真实存在；默认非交互路径需 policy allow 才执行 |
| `mkdir` | filesystem | `local-ts` | ask | **Partial (ask-gated)** | E2 | A8 收口为 partial-with-disclosure：handler 只 ack-create prefix，每次输出携带 `mkdir-partial-no-directory-entity` 标识（AX-QNA Q21） |
| `rm` | filesystem | `local-ts` | ask | **Supported (ask-gated)** | E2 | handler 真实存在；默认非交互路径需 policy allow 才执行 |
| `mv` | filesystem | `local-ts` | ask | **Supported (ask-gated)** | E2 | handler 真实存在；默认非交互路径需 policy allow 才执行 |
| `cp` | filesystem | `local-ts` | ask | **Supported (ask-gated)** | E2 | handler 真实存在；默认非交互路径需 policy allow 才执行 |
| `rg` | search | `local-ts` | allow | **Supported** | E2 | A8 P3-01 已实现 namespace-backed 真实搜索 + bounded output；canonical search baseline（AX-QNA Q15） |
| `curl` | network | `local-ts` | ask | **Partial (ask-gated)** | E2 | A9 P2 收口为 restricted baseline：scheme allow-list (http/https)、host deny-list (localhost/RFC1918/link-local/CGNAT/IPv6 ULA/cloud-metadata)、`timeoutMs`/`maxOutputBytes` 双 cap、`fetchImpl` 注入注接，bash path 仅承诺 `curl <url>`，richer `{ url, method, headers, body, timeoutMs }` 只走 structured tool call（AX-QNA Q17） |
| `ts-exec` | exec | `local-ts` | ask | **Partial (ask-gated)** | E2 | A9 P3 按 Q22 冻结为 honest partial：syntax validation (`new Function`) + length ack + 固定 `ts-exec-partial-no-execution` marker；不执行 code，升级口保留为 future remote tool-runner via `ServiceBindingTarget` |
| `git` | vcs | `local-ts` | allow | **Partial** | E2 | A10 P2-01 冻结为 `status/diff/log` 只读 subset（AX-QNA Q18）：`status` 接入 `WorkspaceFsLike.listDir` 真实列出 workspace entries（跳过 `/_platform/**`）；`diff` / `log` 走 honest-partial markers (`git-partial-no-baseline` / `git-partial-no-history`)；mutating subcommand 触发 `git-subcommand-blocked`；planner 与 handler 共享 `GIT_SUPPORTED_SUBCOMMANDS` 验证 |
| `wc` | filesystem | `local-ts` | allow | **Supported** | E2 | B3 wave 1 (after-foundations Phase 2)：file/path-first；POSIX 形状 `lines words bytes path`；UTF-8 byte counting；64 KiB output cap with `text-output-truncated` marker；F07 reserved-namespace + path-law 复用 |
| `head` | filesystem | `local-ts` | allow | **Supported** | E2 | B3 wave 1：file/path-first；structured input 支持 `{ path, lines?, bytes? }`；UTF-8 boundary-safe `bytes` truncation；bash path 默认 10 行 |
| `tail` | filesystem | `local-ts` | allow | **Supported** | E2 | B3 wave 1：与 `head` 对称；最后 N 行 / 最后 N 字节；trailing-newline 行为保持 POSIX 默认 |
| `jq` | filesystem | `local-ts` | allow | **Partial (worker-safe subset)** | E2 | B3 wave 1：仅 `. / .field / .a[N] / .a[] / keys / length`；其他查询形式抛 `jq-unsupported-query-form`；`jq <query> <path>` bash form |
| `sed` | filesystem | `local-ts` | allow | **Partial (worker-safe subset)** | E2 | B3 wave 1：仅单条 `s/PATTERN/REPLACEMENT/[gi]`；地址 / 范围 / `d/p/q/n/a/i/c/y/=` 全部抛 `sed-unsupported-script-form` |
| `awk` | filesystem | `local-ts` | allow | **Partial (worker-safe subset)** | E2 | B3 wave 1：仅 `{ print $N }` / `NR == K { print [...] }` / `/PATTERN/ { print [...] }`；BEGIN/END / 多语句 / 用户函数 / `getline/gsub/printf` 抛 `awk-unsupported-program-form` |
| `sort` | filesystem | `local-ts` | allow | **Supported** | E2 | B3 wave 2：默认 lexicographic；structured `{ reverse?, numeric?, unique? }`；output cap |
| `uniq` | filesystem | `local-ts` | allow | **Supported** | E2 | B3 wave 2：相邻去重 (POSIX semantics)；`{ count? }` 右对齐计数列；output cap |
| `diff` | filesystem | `local-ts` | allow | **Supported** | E2 | B3 wave 2：deterministic unified-style minimal-context diff；LCS-based；output cap；两侧 path 都受 F07 path-law 约束 |

### 7.2 Target Inventory

| Target | 当前状态 | Evidence | 备注 |
|--------|----------|----------|------|
| `local-ts` | **Supported baseline** | E2-E3 | 当前 reference execution path |
| `service-binding` | **Partial / reserved seam** | E1 | transport contract 强，但默认仍 `not-connected` |
| `browser-rendering` | **Reserved slot** | E0 | target 存在，但完全未接入 |

### 7.3 Workspace / Supporting Substrate Inventory

| Substrate | 当前状态 | Evidence | 备注 |
|-----------|----------|----------|------|
| `MountRouter` | **Supported** | E2 | longest-prefix + reserved `/_platform/` law 已有 tests |
| `WorkspaceNamespace` | **Supported** | E2-E3 | read/write/list/delete 已真实存在 |
| `WorkspaceSnapshotBuilder` | **Supported** | E2-E3 | 已读取 mounts/fileIndex/artifactRefs/contextLayers |
| `Artifact promotion` | **Supported** | E3 | large result promotion + snapshot evidence 已存在 |
| `ContextAssembler` | **Supported** | E2 | orderApplied/truncated/tokens 已成型 |

### 7.4 Deferred Surface

| Surface | 当前判定 | 备注 |
|---------|----------|------|
| `grep -> rg` 最窄兼容 alias | **Landed (A8 P3-02)** | planner 层最窄改写，仅接 `grep <pattern> [path]`；任何 `-flag` 拒绝并提示 "grep alias is intentionally narrow (Q16)"；不进入 registry，`r.has("grep") === false` |
| `egrep/fgrep` | Deferred | 当前完全未注册；扩张需重新评估 parser/semantics 复杂度（A8 §2.3） |
| `find/head/tail/touch/tee` | Deferred | fake bash 专项分析里建议过，但当前仓内未落地 |
| richer `curl` flags via bash argv | **Frozen Out (A9 Q17)** | bash path 仅 `curl <url>`；planner 拦截 `-X / -H / --data / extra-token` 并提示 `curl-bash-narrow-use-structured` —— richer 必须走 structured `{ url, method, headers, body, timeoutMs, maxOutputBytes }` |
| file-based / argv-based `ts-exec` | Deferred | 当前 v1 仅 honest partial，inline code only；upgrade path 保留给 future remote tool-runner via service-binding |
| host interpreter / nested shell (`python` / `python3` / `node` / `nodejs` / `bash` / `sh` / `zsh` / `deno` / `bun`) | **Unsupported (A9 P1-02)** | Workers-native runtime 无宿主 shell；详见 §7.5 |
| `git add/commit/restore/branch/checkout/merge/rebase/reset/push/pull/fetch/clone/tag/stash` | **Frozen Out (A10 Q18)** | planner 层在 bash 路径直接抛 `git-subcommand-blocked`；handler 层同样拦截；virtual index/ref/history 属 Phase 8+ 设计，本次不提前承诺 |

### 7.5 Unsupported / Risk-Blocked Surface

| Surface | 分类 | 备注 |
|---------|------|------|
| `apt/apt-get/npm/npx/yarn/pnpm/pip/pip3` | Unsupported | package manager / install flow 明确禁止 |
| `python/python3/node/nodejs/bash/sh/zsh/deno/bun` | Unsupported (A9) | host interpreter / nested shell 幻觉；`ts-exec` 是唯一 sanctioned script seam |
| `sudo/su/chmod/chown/chgrp` | Unsupported | privilege / OS mutation |
| `docker/docker-compose/podman` | Unsupported | container host assumptions |
| `systemctl/service/journalctl/reboot/shutdown/poweroff` | Unsupported | system lifecycle control |
| `ssh/scp/rsync/wget` | Unsupported | remote shell / unrestricted network shape |
| `curl localhost` / private-address destinations | Unsupported (A9 egress guard) | scheme allow-list + host deny-list 强制阻断；marker `curl-private-address-blocked` / `curl-scheme-blocked` |
| `install-then-run` / background server loops | Unsupported | Worker-native fake bash 明确拒绝本地机器幻觉 |
| `tar/gzip/gunzip/zcat/zip/unzip/bzip2/xz` | Risk-Blocked | isolate memory risk，需 streaming capability 才能回补 |

---

## 8. 可借鉴的代码位置清单

| 文件:行 | 内容 | 借鉴点 |
|---------|------|--------|
| `packages/capability-runtime/src/fake-bash/commands.ts:16-143` | minimal command registry | inventory 的命令真相来源 |
| `packages/capability-runtime/src/fake-bash/unsupported.ts:15-105` | unsupported / risk-blocked taxonomy | inventory 的风险真相来源 |
| `packages/capability-runtime/test/fake-bash-bridge.test.ts:90-210` | rejection path tests | “不撒谎”已有证据锚点 |
| `test/e2e/e2e-07-workspace-fileops.test.mjs:23-109` | workspace file ops E2E | filesystem 支持等级的重要依据 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

这份 `Capability Inventory` memo 的真正价值，在于它把 Phase 7 三份 design 的观点压缩成了一份可执行真相表。以后任何人问“nano-agent 现在到底支持哪些 fake bash 能力”，答案都不该再散落在 README、prompt、tests 和口头讨论里，而应该先看这张表。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 能力真相若不集中，fake bash 很快会失控 |
| 第一版实现的性价比 | 4 | 仍需补 drift guard 与 ask-gated 语境说明 |
| 对未来“上下文管理 / Skill / 稳定性”演进的杠杆 | 4 | 稳定性与 review 收益最显著 |
| 对开发者自己的日用友好度 | 5 | 查表即可，不必反复猜测 |
| 风险可控程度 | 5 | 风险主要是文档漂移，可通过 review gate 控制 |
| **综合价值** | **4** | **应作为 fake bash surface 的单一真相 memo 保留，并继续把 maturity 与 policy context 一并写清楚** |

### 9.3 下一步行动

- [ ] **决策确认**：确认 inventory 里的 `Supported / Partial / Deferred / Unsupported / Risk-Blocked` 五级口径，以及 ask-gated command 的披露方式。
- [ ] **关联 Issue / PR**：补 inventory drift guard，并让 prompt/tool docs 明确区分 bash-path truth、structured-path truth 与 policy context。
- [ ] **待深入调查的子问题**：
  - [ ] 是否将来把 hooks/skills/provider 也纳入同一 inventory 体系
  - [ ] 是否把 evidence grade 做成 generated artifact

---

## 附录

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-17` | `GPT-5.4` | 初稿 |
| v0.2 | `2026-04-18` | `GPT-5.4` | A8 收口：`mkdir` 升级为 Partial(ask-gated)+disclosure（Q21）；`rg` 升级为 Supported E2 +namespace-backed（Q15）；Deferred 表移除 `grep -> rg` 行并新增 Landed(A8 P3-02) 记录（Q16）；`egrep/fgrep` 单列 Deferred |
| v0.3 | `2026-04-18` | `GPT-5.4` | A9 收口：`curl` 升级为 Partial(ask-gated) E2 + restricted baseline / egress guard（Q17）；`ts-exec` 升级为 Partial(ask-gated) E2 honest partial（Q22）；Deferred 表把 richer `curl` flags 重标 Frozen Out + 新增 host interpreter Unsupported 行；Unsupported 表新增 `python/node/bash/sh/...` 与 egress guard 对齐 |
| v0.4 | `2026-04-18` | `GPT-5.4` | A10 收口：`git` 升级为 Partial E2，namespace-backed status + honest-partial diff/log + subcommand validator（Q18）；Deferred 表的 mutating git 行重标 Frozen Out 并枚举常见子命令；新增 drift guard 测试把 12-pack / policy / unsupported taxonomy / oom-risk taxonomy / git subset 锁入回归（Q19） |
