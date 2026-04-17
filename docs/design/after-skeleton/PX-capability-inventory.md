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
| **Evidence Grade** | 当前支持判断背后的证据强度 | E0-E3 |

### 1.2 Evidence Grade 定义

| 等级 | 含义 | 典型例子 |
|------|------|----------|
| **E0** | 只有 declaration / 文档，没有执行证据 | reserved target |
| **E1** | 有 handler/bridge 但明显 stub 或 degraded | `curl` / `ts-exec` / `git` 当前 local-ts handlers |
| **E2** | 有 package-level tests / integration evidence | `FakeBashBridge` rejection、workspace package tests |
| **E3** | 有跨包 E2E evidence | workspace file ops / snapshot promotion 等 |

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
| Evidence grade | E0-E3 | finer-grained runtime evidence |
| Capability groups | command/target/substrate 三层 | future hook/skill/provider capability inventory |
| Drift guard | 人工维护 | generated docs/tests |

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
| `pwd` | filesystem | `local-ts` | allow | **Supported** | E2 | 有 planner + local target + package tests |
| `ls` | filesystem | `local-ts` | allow | **Supported** | E3 | 已有 workspace-backed E2E evidence |
| `cat` | filesystem | `local-ts` | allow | **Supported** | E3 | 已有 workspace-backed E2E evidence |
| `write` | filesystem | `local-ts` | ask | **Supported** | E3 | namespace-backed；需 policy allow 才执行 |
| `rm` | filesystem | `local-ts` | ask | **Supported** | E2 | namespace-backed delete 已存在 |
| `mv` | filesystem | `local-ts` | ask | **Supported** | E2 | 通过 read+write+delete 组合实现 |
| `cp` | filesystem | `local-ts` | ask | **Supported** | E2 | 通过 read+write 组合实现 |
| `mkdir` | filesystem | `local-ts` | ask | **Partial** | E1 | handler 只返回 ack，backend 无真实 dir primitive |
| `rg` | search | `local-ts` | allow | **Partial** | E1 | declaration 存在，但当前仅 degraded TS scan stub |
| `curl` | network | `local-ts` | ask | **Partial** | E1 | URL 校验后返回 not-connected 风格 stub |
| `ts-exec` | exec | `local-ts` | ask | **Partial** | E1 | 只确认代码长度，未接真实 sandbox |
| `git` | vcs | `local-ts` | allow | **Partial** | E1 | 只承诺 `status/diff/log`，且仍是 stub |

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
| `grep/egrep/fgrep` | Deferred | 当前完全未注册 |
| `find/head/tail/touch/tee` | Deferred | fake bash 专项分析里建议过，但当前仓内未落地 |
| richer `curl` flags | Deferred | 未来优先走 structured path |
| file-based / argv-based `ts-exec` | Deferred | 当前只适合 inline code |
| `git add/commit/restore/branch/...` | Deferred | 当前无 virtual index/ref model |

### 7.5 Unsupported / Risk-Blocked Surface

| Surface | 分类 | 备注 |
|---------|------|------|
| `apt/apt-get/npm/npx/yarn/pnpm/pip/pip3` | Unsupported | package manager / install flow 明确禁止 |
| `sudo/su/chmod/chown/chgrp` | Unsupported | privilege / OS mutation |
| `docker/docker-compose/podman` | Unsupported | container host assumptions |
| `systemctl/service/journalctl/reboot/shutdown/poweroff` | Unsupported | system lifecycle control |
| `ssh/scp/rsync/wget` | Unsupported | remote shell / unrestricted network shape |
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
| 第一版实现的性价比 | 5 | 主要是归档整理，但收益极高 |
| 对未来“上下文管理 / Skill / 稳定性”演进的杠杆 | 4 | 稳定性与 review 收益最显著 |
| 对开发者自己的日用友好度 | 5 | 查表即可，不必反复猜测 |
| 风险可控程度 | 5 | 风险主要是文档漂移，可通过 review gate 控制 |
| **综合价值** | **5** | **应作为 fake bash surface 的单一真相 memo 保留** |

### 9.3 下一步行动

- [ ] **决策确认**：确认 inventory 里的 `Supported / Partial / Deferred / Unsupported / Risk-Blocked` 五级口径。
- [ ] **关联 Issue / PR**：补 inventory drift guard，并让 prompt/tool docs 对齐本表。
- [ ] **待深入调查的子问题**：
  - [ ] 是否将来把 hooks/skills/provider 也纳入同一 inventory 体系
  - [ ] 是否把 evidence grade 做成 generated artifact

---

## 附录

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-17` | `GPT-5.4` | 初稿 |
