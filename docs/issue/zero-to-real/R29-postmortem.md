# R29 — Initial-Context 502 Postmortem

> 类型: `chronic postmortem`
> Phase: hero-to-pro / HP8 chronic register (HP8-D2)
> 文档状态: `unverifiable-pending-owner-evidence`
> 创建日期: `2026-05-01` (HP0-H10 deferred-closure absorb)
> 关联 verifier: `scripts/verify-initial-context-divergence.mjs`
> 关联 runbook: `docs/runbook/zx5-r28-investigation.md`
> 冻结依据: HPX-Q28 chronic terminal compliance

---

## 0. 三选一终态判定（required by Q28）

R29 chronic 的合规终态必须落在以下三选一之一，每一项的判定都必须由 `scripts/verify-initial-context-divergence.mjs` 的实跑结果支撑：

| 终态 | 判定规则 | 退出码 |
|------|----------|--------|
| `zero-diff` | baseline 与 candidate 完全一致；502 是历史快照，不再现；resolved by code removal | exit 0 |
| `has-diff` | baseline ≠ candidate；说明历史 502 仍有残留代码路径在产 diverge；upgrade 为 active issue | exit 1 |
| `unverifiable` | input 缺失 / 损坏；证据不足；postmortem 无法判定；保留为 retained-with-reason | exit 2 |

**当前判定**：`unverifiable-pending-owner-evidence`。

理由：

1. ZX5 R29 报告的 initial-context 502 来自 deploy preview 环境的 wrangler tail 日志快照，本地代码无法 reproduce。
2. 实施者侧 (claude-opus-4-7) 没有 deploy preview 的 historical wrangler tail 访问权，无法构造 baseline 快照。
3. 当前仓库代码已经经过 HP0-HP10 改造；引发 502 的代码路径（如旧 `forwardInternalJsonShadow` 异常分支）虽未被物理删除（HP10 cleanup register K1 retained-with-reason），但 caller flow 已被重写多轮——实施者推断很大概率落在 `zero-diff`，但 **推断不是证据**。

---

## 1. Owner-Action Required to Upgrade Verdict

要把 `unverifiable` 升级为 `zero-diff` 或 `has-diff`，owner 需要：

1. 选择 `baseline.json`：从历史 wrangler tail / preview deploy log / R29 原始事故 capture 中提取该次 502 的 initial-context payload（已 redact secrets）。
2. 选择 `candidate.json`：在当前 HEAD 的 preview deploy 上跑相同的入口 path，捕获其 initial-context payload。
3. 运行：
   ```bash
   node scripts/verify-initial-context-divergence.mjs \
       --baseline=path/to/baseline.json \
       --candidate=path/to/candidate.json
   ```
4. 把 stdout/stderr 与 exit code 粘贴到本文件 §3，更新 §0 中的"当前判定"。

如果 `baseline.json` 历史数据已永久丢失（preview log retention 过期且无 backup），把判定升级为 `zero-diff-by-code-removal`，并在 §3 写明：
- 引发 502 的具体代码路径（commit / file / line）
- 该路径在当前 HEAD 是否仍存在；若不存在，引用对应 cleanup commit
- 显式声明 `regression risk: low`，原因是 caller flow 已经被 HP2-HP10 改造多轮，与原 buggy path 无 surface 重合

---

## 2. 自动化 Smoke Gate（不需要 owner data）

`verify-initial-context-divergence.mjs --self-test` 可以无 owner data 跑通，证明 verifier 本身工作正常：

```bash
node scripts/verify-initial-context-divergence.mjs --self-test
# expected output:
#   [verify-initial-context-divergence] self-test pass
# expected exit code: 0
```

这个 smoke gate **本身**不解 R29 的 chronic verdict，但它确认：
- verifier 脚本工作正常
- 三选一退出码语义对齐
- 当 owner 提供 baseline + candidate 时，结果是可信的

实施者侧已确认 self-test pass（2026-05-01）。

---

## 3. Owner 实跑结果（待回填）

```yaml
captured_at: <pending-owner-run>
captured_by: <pending-owner-run>
preview_deploy_commit: <pending-owner-run>
baseline_path: <pending-owner-run-or-N/A-if-zero-diff-by-removal>
candidate_path: <pending-owner-run-or-N/A>
script_invocation: <pending-owner-run>
exit_code: <pending-owner-run>
verdict: unverifiable-pending-owner-evidence
notes: <pending-owner-write>
```

---

## 4. 终态升级路径

| 当前 | 触发 | 升级为 | 负责人 |
|------|------|-------|--------|
| `unverifiable-pending-owner-evidence` | owner 完成 §1 步骤并回填 §3 | `zero-diff` / `has-diff` / `zero-diff-by-code-removal` | hero-to-pro owner |
| `unverifiable-pending-owner-evidence` | owner 选择 `retained-with-reason within hero-to-pro` | retained-with-reason，附 next-review-date | hero-to-pro owner |
| `has-diff` | 后续修复让 baseline === candidate | `zero-diff` | hero-to-pro owner |

**Q28 法律重申**：`unverifiable` 是 hero-to-pro 阶段的 LEGITIMATE 终态之一（与 `closed` / `retained-with-reason` 并列）。这与 zero-to-real 时代的 "silently resolved" 形成对比 — silent 不允许，unverifiable 允许（因为它显式承认了证据不足）。

---

## 5. 与 HP8 闭环关系

HP8 closure §2 P2 之前把 R29 verifier + postmortem 列为 `not-started`。HP0-H10 deferred-closure absorb 把状态推进为：

| 维度 | 之前 | 现在 |
|------|------|------|
| `scripts/verify-initial-context-divergence.mjs` 文件存在 | ❌ | ✅ |
| self-test pass | n/a | ✅ |
| `R29-postmortem.md` 文件存在 | ❌ | ✅（本文件） |
| 三选一终态判定 framework | ❌ | ✅ |
| 实际 owner 实跑判定 | ❌ | ⚠️ unverifiable-pending-owner-evidence |
| HP8 closure §2 P2 状态 | `not-started` | `partial-by-deferred-closure-absorb` |

`unverifiable-pending-owner-evidence` 是 hero-to-pro 阶段的合法 closure。F10 chronic（R29 postmortem）的 canonical verdict 因此更新为 `retained-with-reason: postmortem framework live, owner-evidence pending`，next review 在 hero-to-pro 后续 phase 的 owner-action gate 评估。
