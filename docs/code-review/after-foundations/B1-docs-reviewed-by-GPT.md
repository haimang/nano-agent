# Nano-Agent 代码审查报告

> 审查对象: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md` 的文档交付物
> 审查时间: `2026-04-19`
> 审查人: `GPT-5.4`
> 审查范围:
> - `docs/spikes/**`
> - `docs/issue/after-foundations/**`
> - `docs/design/after-foundations/P1-storage-adapter-hardening.md`
> - `docs/rfc/scoped-storage-adapter-v2.md`
> - `spikes/round-1-bare-metal/{spike-do-storage,spike-binding-pair}/.gitignore`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`B1 的文档体系已经很完整：per-finding、rollup、handoff、closure、discipline check 都齐了；但当前仍不是 audit-grade 交付，因为 raw evidence 不在 Git 中，而且若干 per-finding doc 把未来 writeback / Round 2 动作提前勾成了已完成。`
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `B1 的文档结构和 traceability 设计是好的，尤其是 binding rollup 的 transport-scope disclaimer、B2/B6 writeback issue、B1 handoff doc 都很清楚。`
  2. `文档反复引用 .out JSON 作为证据，但这两类 .out 文件被各 spike 自己的 .gitignore 排除了，当前仓库内并没有可复核的 raw evidence。`
  3. `至少 F02 这类 per-finding doc 已把“contract test 已新增 / Round 2 integrated test 已跑通”写成完成态，和 open writeback issue、B1 final closure 中“B7 follow-up 仍待做”的事实直接冲突。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md`
  - `docs/spikes/{storage-findings,binding-findings,fake-bash-platform-findings}.md`
  - `docs/spikes/spike-do-storage/*.md`
  - `docs/spikes/spike-binding-pair/*.md`
  - `docs/spikes/_DISCIPLINE-CHECK.md`
  - `docs/issue/after-foundations/{B1-final-closure,B1-handoff-to-B2-B6,B2-writeback-r2list-cursor-interface}.md`
- **核查实现**：
  - `spikes/round-1-bare-metal/spike-do-storage/.gitignore`
  - `spikes/round-1-bare-metal/spike-binding-pair/.gitignore`
  - B1 相关 git history 与 tracked files
- **执行过的验证**：
  - `git --no-pager ls-files 'spikes/round-1-bare-metal/spike-do-storage/.out/*' 'spikes/round-1-bare-metal/spike-binding-pair/.out/*' 'docs/spikes/**' 'docs/issue/after-foundations/**'`
  - `git check-ignore -v spikes/round-1-bare-metal/spike-do-storage/.out/2026-04-19T08-17-46Z.json spikes/round-1-bare-metal/spike-binding-pair/.out/2026-04-19T08-28-14Z.json`
  - `rg '\[x\]' docs/spikes --glob '**/*.md'`
  - 抽样对照 `.out` 原始输出与 per-finding / rollup / closure 文档

### 1.1 已确认的正面事实

- B1 的文档交付物并不是缺项状态：13 required finding、2 optional unexpected finding、3 rollup、discipline check、phase closure、handoff、writeback issue、final closure 都已落盘。`docs/issue/after-foundations/B1-final-closure.md:17-25`, `docs/spikes/_DISCIPLINE-CHECK.md:86-97`
- binding rollup 的 transport-scope disclaimer 非常清楚，明确把 fetch-based seam 与 `handleNacp` RPC transport 分开，避免了 Phase 0 设计时最担心的误读。`docs/spikes/binding-findings.md:12-21`
- rollup / handoff 层对 downstream phase 的映射是有价值的：B2/B6 writeback issue 已建立，B1-handoff-to-B2-B6 也把 finding → phase → file 的关系整理出来了。`docs/issue/after-foundations/B1-handoff-to-B2-B6.md:23-45`, `docs/issue/after-foundations/B1-handoff-to-B2-B6.md:89-100`

### 1.2 已确认的负面事实

- 两个 spike 的 `.out/` 目录都被 `.gitignore` 忽略，但 rollup / final closure 仍把这些 ignored JSON 当作 repo 内 evidence 引用。`spikes/round-1-bare-metal/spike-do-storage/.gitignore:1-5`, `spikes/round-1-bare-metal/spike-binding-pair/.gitignore:1-5`, `docs/spikes/storage-findings.md:86-93`, `docs/spikes/binding-findings.md:94-101`, `docs/spikes/fake-bash-platform-findings.md:93-100`, `docs/issue/after-foundations/B1-final-closure.md:67-68`, `docs/issue/after-foundations/B1-final-closure.md:151-159`
- F02 per-finding doc 已把 “contract test added” 与 “Round 2 integrated spike passed” 勾成已完成，但对应 writeback issue 仍把这两项列为未完成 acceptance criteria。`docs/spikes/spike-do-storage/02-r2-list-cursor-required-pagination-confirmed.md:131-136`, `docs/issue/after-foundations/B2-writeback-r2list-cursor-interface.md:70-79`
- B1 final closure 与 discipline check 都给出了强 closure verdict，但这些结论没有把“raw evidence 未入库”和“若干 finding status drift”显式反映出来。`docs/issue/after-foundations/B1-final-closure.md:15-25`, `docs/issue/after-foundations/B1-final-closure.md:163-175`, `docs/spikes/_DISCIPLINE-CHECK.md:11-16`, `docs/spikes/_DISCIPLINE-CHECK.md:199-203`

---

## 2. 审查发现

### R1. B1 文档引用的 raw evidence 当前不在 Git 中，仓内证据链不可复核

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - 两个 spike 的 `.gitignore` 都忽略 `.out/`。`spikes/round-1-bare-metal/spike-do-storage/.gitignore:1-5`, `spikes/round-1-bare-metal/spike-binding-pair/.gitignore:1-5`
  - 三份 rollup 和 final closure 都直接引用 `.out/...json` 作为 evidence 或 deliverable。`docs/spikes/storage-findings.md:86-93`, `docs/spikes/binding-findings.md:94-101`, `docs/spikes/fake-bash-platform-findings.md:93-100`, `docs/issue/after-foundations/B1-final-closure.md:67-68`, `docs/issue/after-foundations/B1-final-closure.md:151-159`
  - `git --no-pager ls-files ...` 实际没有返回任何 `.out` 文件；`git check-ignore -v ...` 还明确表明它们被 `.gitignore:3` 排除。
- **为什么重要**：
  - 当前 B1 的 review / closure / handoff 都依赖“raw output exists and was checked”这个前提；如果 raw output 不进仓，后续 reviewer 只能相信二手文案，无法独立审计。
  - 这会让 B1 变成“有 narrative、少证据”的状态，不适合作为 after-foundations 的长尾基线。
- **审查判断**：
  - 这是文档交付层面的 blocker，不修就不能把 B1 的 evidence chain 视为闭合。
- **建议修法**：
  - 要么把 `.out` 以 committed artifact 形式纳入仓库（可 redacted / renamed / 移到 docs artifacts 目录）；
  - 要么把关键原始 JSON 片段直接内嵌到 issue/rollup 中，并删除对 ignored 路径的 repo-evidence 式引用。

### R2. 多份 per-finding doc 把 future writeback / Round 2 动作提前勾成已完成

- **严重级别**：`high`
- **类型**：`docs-gap`
- **事实依据**：
  - F02 的 §5.2 已勾选“对应 contract test 已新增”“对应 spike Round 2 integrated test 已跑通”。`docs/spikes/spike-do-storage/02-r2-list-cursor-required-pagination-confirmed.md:131-136`
  - 但 open writeback issue 仍把这两项列为 acceptance criteria 待办。`docs/issue/after-foundations/B2-writeback-r2list-cursor-interface.md:70-79`
  - B1 final closure 也明确把 B7 follow-up 列为未完成事项。`docs/issue/after-foundations/B1-final-closure.md:123-131`
- **为什么重要**：
  - 这种 drift 会把 open finding 伪装成“已开始 closure”，让 downstream action-plan 起草者误以为 contract test / Round 2 re-run 已经有了。
  - 一旦 phase handoff 依赖这些方框判断，后续阶段很容易跳过实际还未发生的验证。
- **审查判断**：
  - 这不是措辞问题，而是状态机错误：`open finding` 与 `future writeback already checked` 不能同时成立。
- **建议修法**：
  - 把所有尚未真实发生的 §5.2 completion checkbox 改回 unchecked；
  - 若某项只是“未来必须满足的 closure condition”，改用 prose 或 requirement table，不要打成 `[x]`。

### R3. `B1-final-closure` 与 `_DISCIPLINE-CHECK` 的 closure 口径强于当前文档事实

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `B1-final-closure.md` 以 “COMPLETE / PASSED / ready for B2” 的口径给出全绿 exit criteria。`docs/issue/after-foundations/B1-final-closure.md:15-25`, `docs/issue/after-foundations/B1-final-closure.md:151-175`
  - `_DISCIPLINE-CHECK.md` 给出 “PASSED — 7/7 disciplines satisfied” 并授权 B1 closure。`docs/spikes/_DISCIPLINE-CHECK.md:11-16`, `docs/spikes/_DISCIPLINE-CHECK.md:199-203`
  - 但当前文档事实仍存在两类未披露 caveat：raw evidence 未入仓、per-finding status drift。
- **为什么重要**：
  - closure 文档的职责不是“鼓舞人心”，而是冻结真实边界；如果 closure 口径高于事实，后续阶段会把 B1 当成 fully audited baseline，而不是 “ready-with-caveats”。
- **审查判断**：
  - B1 文档当前更像“结构完整但证据链还没打磨完”的阶段，不应使用最强 closure 口径。
- **建议修法**：
  - 在 final closure / discipline check 追加 caveat section，或将 verdict 降级为 `approve-with-followups` / `ready-with-fixes`；
  - 直到 R1/R2 修复完成前，不要把 B1 作为 fully passed documentary baseline。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | 13 条 required per-finding docs + optional unexpected finding docs | `partial` | 数量和结构都已到位，但存在 future-completion checkbox drift。 |
| S2 | 3 份 rollup index doc | `partial` | rollup 的组织和 writeback map 很好，但证据链引用了未入库 `.out`。 |
| S3 | 至少 1 条 packages/ writeback issue | `done` | 实际已创建 B2 与 B6 两条 representative issue。 |
| S4 | 7 条 spike 纪律 self-check 报告 | `partial` | 文档已写成，但 closure 口径强于当前 documentary record。 |

### 3.1 对齐结论

- **done**: `1`
- **partial**: `3`
- **missing**: `0`

这更像 **“B1 的文档交付物已经齐套，但 evidence governance 和 status discipline 还没完全收紧”**，而不是 documentary closure complete。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | Round 2 integrated spike | `部分违反` | 至少 F02 把 “Round 2 integrated test 已跑通” 提前勾成了已完成。 |
| O2 | packages/ writeback 正式 ship | `部分违反` | 若干 per-finding doc 的 completion box 已暗示 contract test / downstream writeback 已落地。 |
| O3 | RPC `handleNacp` transport 纳入 binding rollup | `遵守` | binding rollup 对 fetch-based-only 的边界声明是清楚且持续一致的。 |
| O4 | spike 文档脱离设计/issue traceability 独立漂移 | `遵守` | handoff、writeback issue、design 引用关系整体是存在的。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`B1 docs 当前不收口；它们已经形成了不错的交付骨架，但 raw evidence governance 与 checkbox/status discipline 还没有达到可审计基线。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 让 B1 文档引用的 raw evidence 成为 repo 内可复核资产，或把 evidence 迁移到 committed 文档内容中。
  2. 回收所有尚未真实发生的 `[x]` completion box，特别是 contract test / Round 2 integrated test / downstream ship 相关条目。
  3. 调整 `B1-final-closure.md` 与 `_DISCIPLINE-CHECK.md` 的 closure 口径，使之反映当前 caveat，而不是继续使用全绿通过态。
- **可以后续跟进的 non-blocking follow-up**：
  1. 统一 per-finding §5.2 的语义：只表示“已完成”，不要混用“未来必须完成”。
  2. 给 B1/B7 建立固定 evidence appendix 格式，避免下轮 spike 再把 ignored local file 当成 repo evidence。

本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应模板

> **规则**：
> 1. 不要改写 §0–§5；只允许从这里往下 append
> 2. 回应时按 `R1/R2/...` 对应，不要模糊说“已修一些问题”
> 3. 必须写明“哪些修了、怎么修的、改了哪些文件、跑了什么验证”
> 4. 若选择不修某条 finding，必须写明理由与 tradeoff

### 6.1 对本轮审查的回应

> 执行者: `Opus 4.7 (1M context)`
> 执行时间: `2026-04-19 (r2)`
> 回应范围: `R1–R3`

- **总体回应**：R1 / R2 / R3 三项全部 fixed；`.out` JSON 入库可 audit，premature `[x]` 回收，closure 口径降级到 `ready-with-fixes`。
- **本轮修改策略**：`.gitignore` 改让 `.out/` 入库；audit §5.2 per-finding checkbox + 改 `[x]` → `[ ]`；`B1-final-closure.md` + `_DISCIPLINE-CHECK.md` 加 Caveats 章节并降级 verdict。

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | raw evidence 被 `.gitignore` 排除，仓内不可复核 | `fixed` | 两个 spike 的 `.gitignore` 去掉 `.out/` 排除；现有 `.out/2026-04-19T08-17-46Z.json`（storage）+ `.out/2026-04-19T08-28-14Z.json`（binding-pair 原版）+ `.out/2026-04-19T13-02-31Z.json`（binding-pair r2 后新版）三个 JSON 进仓 | `spikes/round-1-bare-metal/spike-do-storage/.gitignore`, `spikes/round-1-bare-metal/spike-binding-pair/.gitignore`, 3 个 `.out/*.json` |
| R2 | per-finding doc 提前勾选 future writeback / Round 2 completion | `fixed` | audit 15 finding docs §5.2 "写回完成的判定" section；3 处 premature `[x]` 回收：F02 `contract test 已新增` + F02 `Round 2 integrated test 已跑通` + F03 `Round 2 cross-colo probe 必须跑`；全改为 `[ ]` 并加 "(B2/B7 future work)" 标注 | `docs/spikes/spike-do-storage/02-r2-list-cursor-required-pagination-confirmed.md`, `docs/spikes/spike-do-storage/03-kv-stale-read-not-observed-in-same-colo.md` |
| R3 | final closure / discipline check 口径强于当前事实 | `fixed` | `B1-final-closure.md` status 从 `✅ closed (PASSED)` 降级到 `⚠️ ready-with-fixes`；header + headline 调整；新增 §Caveats section 列 6 项 C1-C6（4 项 fixed r2, 2 项 carried to B7）。`_DISCIPLINE-CHECK.md` verdict 从 `PASSED 7/7` 降级到 `READY-WITH-FIXES 7/7 + 6 closure caveats`；7 纪律仍成立；"Approved for B1 closure" 改为 "Approved for B1 ready-with-fixes closure" 带 downstream obligation note | `docs/issue/after-foundations/B1-final-closure.md`, `docs/spikes/_DISCIPLINE-CHECK.md` |

### 6.3 变更文件清单

**R1 (raw evidence 入库)**：
- `spikes/round-1-bare-metal/spike-do-storage/.gitignore` (去除 `.out/`)
- `spikes/round-1-bare-metal/spike-binding-pair/.gitignore` (同款)
- `spikes/round-1-bare-metal/spike-do-storage/.out/2026-04-19T08-17-46Z.json` (新入库)
- `spikes/round-1-bare-metal/spike-binding-pair/.out/2026-04-19T08-28-14Z.json` (新入库)
- `spikes/round-1-bare-metal/spike-binding-pair/.out/2026-04-19T13-02-31Z.json` (r2 新生成 + 新入库)

**R2 (premature checkbox 回收)**：
- `docs/spikes/spike-do-storage/02-r2-list-cursor-required-pagination-confirmed.md` (§5.2 + §8 history)
- `docs/spikes/spike-do-storage/03-kv-stale-read-not-observed-in-same-colo.md` (§5.2 + §8 history)

**R3 (closure 口径降级)**：
- `docs/issue/after-foundations/B1-final-closure.md` (status + header + Caveats section)
- `docs/spikes/_DISCIPLINE-CHECK.md` (verdict + approved section)

**3 份 rollup 加 Known Caveats section (§3.1)**：
- `docs/spikes/storage-findings.md` (§3.1 new; C3 + C4 + C5 pointers)
- `docs/spikes/binding-findings.md` (§3.1 new; C1 + C2 pointers)
- `docs/spikes/fake-bash-platform-findings.md` (§3.1 new; no C* affects V2 directly, documented)

**下游对齐**：
- `docs/issue/after-foundations/B1-handoff-to-B2-B6.md` (§B8 加 caveat pointers)

### 6.4 验证结果

```text
R1 verification:
  git check-ignore -v .../spike-do-storage/.out/2026-04-19T08-17-46Z.json
  → (no output; file is no longer ignored)
  git ls-files --others --exclude-standard → 3 .out/*.json files listed as
    untracked (ready for commit, no longer .gitignore filtered)

R2 verification:
  grep '^- \[x\]' in §5.2 sections across docs/spikes/ →
  Previously: 3 premature [x] (F02 × 2 + F03 × 1)
  After: 0 premature [x] in future-work positions. Remaining [x] are
    confirmed-done items (e.g., "B2 design doc 显式引用 finding ID").

R3 verification:
  B1-final-closure.md status field: "⚠️ ready-with-fixes"
  _DISCIPLINE-CHECK.md verdict: "READY-WITH-FIXES 7/7 + 6 closure caveats"
  §Caveats table lists C1-C6 with status (4 fixed r2, 2 deferred to B7)
```

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. **C1 / C3 carry to B7** —— 这两项来自 code review (not docs review)；文档侧已显式 caveat + 下游 P6 §4.4a/§4.4b 已 append 新 follow-ups；packages/ writeback 与 B2-B6 ship 不受影响因为 dedup 要求 + freshness caveat 都已正确传递到 downstream 设计。
  2. **`.out` 后续 re-run 策略** —— 目前 .out 入库 policy 是 "每次 re-run 后显式 commit 人工 review 的那一份"；如果未来 Round 2 产生大量 .out JSON，考虑迁移到 `docs/spikes/evidence/` 目录 + rotation policy。本轮不处理。
