# Nano-Agent After-Foundations P2 — Fake-Bash Extension Policy

> 功能簇：`Fake-Bash Extension & Just-Bash Port Policy`
> 讨论日期：`2026-04-19`
> 讨论者：`Opus 4.7 (1M context)`
> 关联调查报告（B1 finding traceability — backward）：
> - `docs/spikes/fake-bash-platform-findings.md` — V2 fake-bash rollup（writeback destination map）
> - `docs/spikes/spike-do-storage/07-bash-capability-parity-3-of-3-contracts-hold.md` (**F07 — existing contract holds**)
> - `docs/spikes/spike-do-storage/08-do-storage-value-cap-between-1mib-and-10mib.md` (**F08 — `write` capability must size-check**)
> - `docs/spikes/spike-do-storage/09-curl-quota-25-fetches-no-rate-limit-default-target.md` (**F09 — curl subrequest budget**)
> - `docs/issue/after-foundations/B1-handoff-to-B2-B6.md` §B3 (this design's input contract)
>
> 上游 charter / 模板：
> - `docs/plan-after-foundations.md` §6 Phase 2 + §4.1 C (fake-bash extension in-scope)
> - `docs/templates/design.md`
>
> 参考实现（vendored upstream）：
> - `context/just-bash/src/commands/` (89 commands)
> - `packages/capability-runtime/src/capabilities/` (current 6-file 12-pack)
>
> 文档状态：`draft`

---

## 0. 背景与前置约束

Phase 2 (B3) 的工作由 B1 spike round 1 的 3 条 V2 findings 驱动。本 design 决定：**哪些 just-bash 能力 port 到 fake-bash**、**哪些明确 NOT port**、**如何基于 F07 的 contract validation 扩展而不破坏现有 12-pack**。

- **项目定位回顾**：nano-agent fake-bash 不是 OS shell，而是 "virtual bash environment" —— 接收 bash-like 命令，但由 Cloudflare Workers + DO storage + R2 + KV 实现。参考实现 `context/just-bash/` (vercel-labs/just-bash v2.14.2) 有 89 个 command，但其中很多不适合或不可能在 Workers 上实现。
- **本次讨论的前置共识**：
  - B1 F07 已证明 **12-pack 3 core contracts hold**（mkdir partial-no-directory-entity / `/_platform/**` reserved / rg cap）—— B3 可以放心扩命令，**不需要改现有 handler contract**
  - B1 F08 暴露 DO storage `put` 1-10 MiB hard cap —— `write` capability 必须 size-check + R2 promotion
  - B1 F09 暴露 curl 在 25 req 量级 viable —— 接通 curl 必须 per-turn subrequest budget
  - 业主 Q2: 测试 URL 按需从业主索取（自有前后端）
  - 业主 Q1: 所有 spike 资源必须 `nano-agent` + `spike` 双标签；B3 接通 curl 时要考虑生产 quota 隔离策略
- **显式排除的讨论范围**：
  - 不讨论 just-bash 的 89 commands 全量 port（charter §4.2 C 第 13 项明确 deferred）
  - 不讨论 python3 / sqlite3 接通（Workers 无 python；sqlite3 由 D1Adapter 替代，见 P1 design）
  - 不讨论 browser / scraping / search —— 这些是 `skill.core` 议题（reserved per charter §12.2）
  - 不讨论 git write subset —— 维持 read-only (status/diff/log)，write 留给后续 phase
  - 不讨论 fake-bash 的 service binding 包装（worker matrix 阶段议题，charter §12.1 `bash.core`）

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Fake-Bash Extension Policy`
- **一句话定义**：基于 B1 F07 已验证的 capability-parity contract，扩展 `packages/capability-runtime` 12-pack 至更实用子集（高频文本处理 + 接通 curl），同时遵守 F08 size cap + F09 quota budget 约束。
- **边界描述**：本功能簇**包含** port 策略矩阵、size/quota guard 设计、`/_platform/**` reserved namespace 复用、handler contract 不变承诺；**不包含** full just-bash port、shell features（pipes/redirects）、python/sqlite3/browser 等 reserved capability、service-binding wrapper。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|---|---|---|
| **12-pack** | 当前 fake-bash 12 命令：pwd/ls/cat/write/mkdir/rm/mv/cp/rg/curl/ts-exec/git | 维持 F07 validated contract |
| **Port** | 从 `context/just-bash/src/commands/{name}/` 借鉴实现思路，在 `capability-runtime` 中**重写** handler（纪律 7: 不 import upstream） | 纯文本处理 handler 可借鉴；OS-bound 不 port |
| **Size-check** | `write` capability 在写入 DO storage 前检查 value bytes ≤ adapter.maxValueBytes | F08 强制 |
| **Subrequest budget** | 单 turn 内可发起的 outbound fetch 总数上限 + payload 总字节上限 | F09 驱动设计 |
| **Reserved namespace** | `/_platform/**` 路径前缀，fake-bash 所有 write-like handler 必须拒绝 | F07 validated contract，B3 扩展时继承 |

### 1.2 参考调查报告

- B1 F07 / F08 / F09: 见上文 frontmatter
- `context/just-bash/` 89 commands inventory: 参考实现（不 import，仅借鉴 handler shape）
- 业主 Q1 / Q2 answers: `docs/action-plan/after-foundations/B1-spike-cf-credentials.md`

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 本功能簇的角色：**扩展 fake-bash 能力面，满足 LLM agent loop 的高频文本/网络需求**，同时守住 F08/F09 约束。
- 服务于：所有 agent turn 中的 tool call；worker matrix 阶段的 `bash.core` worker。
- 依赖：B1 F07 validated 12-pack contract + B1 F08 size cap + B1 F09 subrequest budget + P1 `storage-topology` v2 (size pre-check 机制)。
- 被谁依赖：`agent-runtime-kernel` 的 tool dispatcher; worker matrix 阶段 `bash.core`.

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| `packages/capability-runtime` (本身) | modify + add | 强 | 扩 capabilities/ 内文件 + 新增 text-processing.ts |
| P1 storage adapter (size cap mechanism) | consumes | 中 | `write` handler 调用 DOStorageAdapter 会自动 size-check |
| `workspace-context-artifacts` (reserved namespace) | reuses | 弱 | `/_platform/**` 机制保持不变 (F07) |
| `eval-observability` (quota evidence) | emits to | 弱-中 | `curl` 触发 quota 时 emit 显式 event |
| B7 round 2 (high-volume probe) | round-2 deferred | 弱 | F09 的 owner-supplied URL probe 属 B7 scope |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Fake-Bash Extension Policy` 是 **LLM-agent-facing tool layer 的能力扩充**，负责基于 B1 F07 已验证的 contract 稳定性扩 port 高频 just-bash 子集，同时用 F08/F09 guard 机制防止 platform-level failure mode 泄漏到 agent loop。

---

## 3. Port 决策矩阵（基于 F07/F08/F09）

### 3.1 分类总表

| Command | Upstream (just-bash) | 当前 fake-bash | Port 决策 | 理由 |
|---|---|---|---|---|
| pwd | ✓ | ✓ | **维持** | core; F07 contract holds |
| ls | ✓ | ✓ | **维持** | core; F07 |
| cat | ✓ | ✓ | **维持** (+ size disclosure on read > threshold) | F08 考虑 |
| write (fake-bash 独有) | — | ✓ | **维持 + size-check (F08)** | F08 hard requirement |
| mkdir | ✓ | ✓ | **维持** | F07 MKDIR_PARTIAL_NOTE contract validated |
| rm / mv / cp | ✓ | ✓ | **维持** | F07 |
| rg | — (just-bash has grep) | ✓ (rg alias) | **维持** (200 lines / 32 KiB cap) | F07 cap 已 validated |
| curl | ✓ | ✓ (not-connected stub) | **接通 + subrequest budget** | F09 driver |
| ts-exec | — | ✓ (partial, not-connected) | **维持 partial + explicit stub marker** | js-exec 是 worker matrix 议题 |
| git | ✓ | ✓ (read-only: status/diff/log) | **维持 read-only** | write 留 worker matrix |
| **NEW: sed** | ✓ | — | **PORT** (pure text processing) | LLM 高频；无 platform 依赖 |
| **NEW: awk** | ✓ | — | **PORT** (pure text processing) | 同上 |
| **NEW: jq** | ✓ | — | **PORT** (JSON query) | LLM 处理 API response 高频 |
| **NEW: wc** | ✓ | — | **PORT** | 高频；~30 lines 实现 |
| **NEW: head** | ✓ | — | **PORT** | 高频 |
| **NEW: tail** | ✓ | — | **PORT** | 高频 |
| **NEW: sort** | ✓ | — | **PORT** | 高频 |
| **NEW: uniq** | ✓ | — | **PORT** | 与 sort 配对高频 |
| **NEW: diff** | ✓ | — | **PORT** | 代码 review 场景高频 |
| grep | ✓ | — (rg covers) | **不 port** (rg 已覆盖) | 避免重复；rg 更强 |
| find | ✓ | — | **延后** | ls + rg 组合可替代；复杂度高 |
| base64 | ✓ | — | **延后** | Workers 有内置 btoa/atob |
| column | ✓ | — | **延后** | LLM 不高频 |
| date | ✓ | — | **延后** | Workers 有 Date |
| du | ✓ | — | **延后** | 需要 walk filesystem；复杂 |

### 3.2 明确 NOT port 的分类

| 分类 | Commands | 理由 |
|---|---|---|
| **OS-bound (进程管理)** | ps, kill, pkill, top, nice, nohup, timeout, xargs (when used as subprocess runner) | Workers 没有 process 概念 |
| **Shell features** | pipes `\|` / redirects `>` / heredoc / process substitution | 这些是 shell parser 功能，not commands；需要独立 shell feature design，**不在本 P2 范围** |
| **Reserved for skill.core** | browser / search / scrape | charter §12.2 explicit defer |
| **Incompatible runtime** | python3, sqlite3 (covered by D1Adapter), node/npm | Workers runtime 不支持 |
| **Write-side VCS** | git commit / push / branch / merge | 留给后续 phase |
| **just-bash experimental** | js-exec | ts-exec 已占位；js-exec 决策留 worker matrix |

### 3.3 Port 的技术约束（纪律 7 延伸）

Port **不** 等于 import upstream. `context/just-bash/src/commands/{name}/` 仅用于：
- 读 README / 测试用例理解行为 contract
- 参考算法实现思路
- 参考 flag parsing 策略

**Port 后** 的实现必须：
- 放在 `packages/capability-runtime/src/capabilities/{filename}.ts`
- 遵守 `CapabilityHandler` signature（与 12-pack 一致）
- 单元测试独立
- 0 个 `import "just-bash"` 或 `from "../../context/just-bash"` (纪律 7 同款)

---

## 4. 关键决策与证据链

### 4.1 决策：9 新命令分类 port（6 core text + 3 高频辅助）

**Evidence**: F07 证明扩命令不会破坏现有 3 个 contract；`context/just-bash/` 89 commands 中纯文本处理约 20+ 个，LLM 日常 tool-use 高频只占 ~10 个。

**Decision**:
- **第一波 Port** (B3 必做): sed / awk / jq / wc / head / tail — 6 个核心文本命令
- **第二波 Port** (B3 可做): sort / uniq / diff — 3 个常用辅助
- **延后**: find / base64 / column / date / du 等 (LLM 用频次低 或 需要更多设计)

### 4.2 决策：`write` capability size-check 机制（来自 F08）

**Evidence**: F08 DO storage 1-10 MiB hard cap；10 MiB write 触发 `SQLITE_TOOBIG`。

**Decision**:
- `filesystem.ts` 的 `write` handler 在调用 DOStorageAdapter.put 前 **不需要**显式 size-check —— P1 ship 的 DOStorageAdapter 已在 adapter 层 throw `ValueTooLargeError`
- fake-bash 层收到 `ValueTooLargeError` 后，emit 显式 disclosure: `"write-oversize: {bytes} > {cap} bytes; use R2 promotion"`
- LLM 看到 disclosure message 后可选择拆分或改路径
- reserved namespace `/_platform/**` 行为保持 F07 validated

### 4.3 决策：`curl` 接通 + subrequest budget（来自 F09）

**Evidence**: F09 实测 25 outbound fetch 无 rate-limit；Cloudflare Workers paid plan 单 worker invocation 限 1000 subrequest。

**Decision**:
- `network.ts` 的 curl handler 去掉 `CURL_NOT_CONNECTED_NOTE` stub，接通真实 `fetch()`
- 引入 **per-turn subrequest budget**：
  - Default: 20 per turn (conservative; LLM tool call 很少超过)
  - Owner override via `CapabilityRuntimeConfig.perTurnSubrequestBudget`
  - Budget exceeded 时 throw `SubrequestBudgetExhaustedError` + emit `capability.subrequest_budget_exhausted` evidence
- 引入 **per-turn outbound payload budget**：
  - Default: 10 MiB total response bytes per turn
  - 超 budget 时终止后续 fetch
- **不**接真实 LLM API key (业主 Q1 隔离策略)；LLM fetch 应走专门的 llm-wrapper path，not via curl capability

### 4.4 决策：维持 ts-exec partial + 显式 not-connected marker

**Evidence**: A8/A9/A10 closure 已明确 ts-exec 是 partial disclosure; 没有真实 subprocess capability 接通 plan; worker matrix `bash.core` 再决定。

**Decision**: B3 不 touch ts-exec handler；保持 `"ts-exec-not-connected"` note。如果 worker matrix 阶段 `bash.core` 决定接通，再由那时设计 driver。

### 4.5 决策：git read-only subset 维持不变

**Evidence**: A10 closure 冻结 git read-only (status/diff/log)；write 侧复杂度高 (需要 isomorphic-git 或 real git binary)，B3 不必投入。

**Decision**: git capability 保持 `GIT_SUPPORTED_SUBCOMMANDS = [status, diff, log]`。write 侧 (commit/push/branch/merge) 留 worker matrix 阶段的 `bash.core`。

### 4.6 决策：新增 `text-processing.ts` 文件放 port 的命令

**Evidence**: 当前 `capabilities/` 6 个文件 (exec / filesystem / network / search / vcs / workspace-truth) 按业务维度分。9 个 port 命令都是 pure text processing，适合单独一个文件。

**Decision**:
```
packages/capability-runtime/src/capabilities/
├── exec.ts                    (existing)
├── filesystem.ts              (existing; F07 contracts unchanged)
├── network.ts                 (modify — curl 接通 + budget)
├── search.ts                  (existing; F07 rg cap unchanged)
├── vcs.ts                     (existing; git read-only unchanged)
├── workspace-truth.ts         (existing)
└── text-processing.ts         (NEW — sed / awk / jq / wc / head / tail / sort / uniq / diff)
```

### 4.7 决策：inventory drift guard 更新

**Evidence**: A10 已有 `test/inventory-drift-guard.test.ts` 守 `PX-capability-inventory.md` 与实际代码同步。

**Decision**: B3 ship 时同步更新：
- `docs/design/after-skeleton/PX-capability-inventory.md` 加入 9 个新 command rows
- `test/inventory-drift-guard.test.ts` 的 `EXPECTED_COMMAND_ORDER` 扩展
- `EXPECTED_POLICY` 为每个新命令标注（全部 supported 类，无 risky/ask-gated）

---

## 5. 与 charter / spike findings 对应关系

| Charter §6 Phase 2 in-scope | 实现位置 | Source finding |
|---|---|---|
| port sed / awk / jq / wc / head / tail | `capabilities/text-processing.ts` (NEW) | F07 (contract stability) |
| 接通 curl + subrequest budget | `capabilities/network.ts` (modify) | F09 |
| 明确 ts-exec / python / sqlite3 / browser 仍保持 not-connected | `capabilities/exec.ts` (unchanged) | A8/A9/A10 closure + F07 |
| 维持 git read-only | `capabilities/vcs.ts` (unchanged) | A10 closure |
| 更新 `PX-capability-inventory.md` | `docs/design/after-skeleton/` | A10 pattern |
| inventory drift guard 扩展 | `packages/capability-runtime/test/` | A10 pattern |

---

## 6. 不在本 design 决策的事项

1. Shell features (pipes / redirects / heredoc) → 独立 shell parser design，非本 P2 scope
2. full just-bash 89-command port → charter §4.2 明确 deferred
3. browser / search / scrape → `skill.core` worker 议题
4. python3 / sqlite3 / node runtime → Workers incompatible
5. git write subset → 后续 phase
6. bash.core worker 化（service binding wrapper）→ worker matrix 阶段

---

## 7. 收口标准（Exit Criteria）

本 design 的成立标准：

1. ✅ §3.1 port 决策矩阵 9 个 yes + 其他明确 no 都有 evidence
2. ✅ §4 5 个关键决策每个绑定 B1 finding 或历史 closure
3. ✅ §5 与 charter §6 Phase 2 in-scope 逐项对应
4. ⏳ B3 action plan 引用本 design 写出执行批次
5. ⏳ B7 round 2 F09 follow-up 用 owner-supplied URL 跑高 volume probe
6. ⏳ B3 ship 后 `filesystem.ts` F07 validated contract 不 regress

---

## 8. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；port 策略矩阵 9 yes + 明确 no；size/quota guard 设计 |
