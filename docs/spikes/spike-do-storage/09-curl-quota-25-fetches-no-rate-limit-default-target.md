# Spike Finding — `V2-bash-curl-quota`

> **Finding ID**: `spike-do-storage-F09`
> **Spike**: `spike-do-storage`
> **Validation item**: `V2-bash-curl-quota`
> **Discovered**: 2026-04-19
> **Author**: Opus 4.7 (1M context)
> **Severity**: `low` _(本轮 baseline；高 volume probe 待 owner Q2 测试 URL)_
> **Status**: `open`

---

## 0. 摘要（一句话）

> 25 个 outbound fetch (target=`example.com`, 1 KiB response) **全部成功**，p50 = 800ms / p99 = 847ms；未观测到 quota / rate-limit 触发。结果 informational，不能直接驱动 packages/ 修改；要找到真实 outbound subrequest cap，必须在 Round 2 用 owner Q2 提供的高 volume 测试 URL（业主拥有自有前后端），跑 50/100/500/1000 等 count 阶梯。

---

## 1. 现象（Phenomenon）

### 1.1 复现步骤

```bash
curl -sS -X POST "https://nano-agent-spike-do-storage.haimang.workers.dev/probe/bash/curl-quota" \
  -H "content-type: application/json" \
  --data '{"counts":[10,25],"target":"https://example.com/"}'
```

### 1.2 实际观测

| count | Succeeded | Failed | p50 (ms) | p99 (ms) | Failure codes |
|---|---|---|---|---|---|
| 10 | 10 | 0 | 795 | 847 | (none) |
| 25 | 25 | 0 | 806 | 846 | (none) |

- 总计 35/35 outbound fetch 成功
- p99 < 1s
- `errors: []`
- 没有任何 rate-limit / quota 错误码

### 1.3 期望与实际的差距

| 维度 | 期望 | 实际 | 差距 |
|---|---|---|---|
| Cloudflare Workers subrequest cap (free / paid) | 50 / 1000 (公开文档值) | 25 OK，未到上限 | 本 probe count 太小，未触发 |
| example.com rate-limit | 可能 429 | 35/35 OK | example.com 在 25 req 量级稳定 |

**关键 caveat**：本 finding **不是 quota 真相**，只是"在低 volume 下未触发"的 baseline。要找真实上限必须**追加 high-volume probe**。

---

## 2. 根因（Root Cause）

### 2.1 直接原因

Cloudflare Workers paid plan 的 outbound subrequest cap 远高于 25。example.com 是 IANA reserved domain，rate-limit 宽松。

### 2.2 平台/协议/SDK 引用

| 来源 | 章节 | 关键内容 |
|---|---|---|
| Cloudflare Workers limits | "Subrequests" | Free: 50; Paid: 1000 (per single Worker invocation) |
| 实测 | `.out/2026-04-19T08-17-46Z.json` | 25 req 全成功 |

### 2.3 与 packages/ 当前假设的差异

`packages/capability-runtime/src/capabilities/network.ts:38` 的 `CURL_NOT_CONNECTED_NOTE` 仍是默认 stub。本 finding **不直接改变** packages/ 假设——仅 confirm "low-volume curl 在 paid plan 上是 viable"。

---

## 3. 对 packages/ 的影响（Package Impact）

### 3.1 受影响文件

| 文件路径 | 行号 | 影响类型 | 说明 |
|---|---|---|---|
| `packages/capability-runtime/src/capabilities/network.ts` | 38 | (no change yet) | CURL_NOT_CONNECTED_NOTE 仍保留；ship "real curl" 是 B3 决策 |
| `packages/capability-runtime/src/capabilities/network.ts` | (B3 enhancement) | **modify** | 接通后必须 implement subrequest count budget guard（防止单 turn 把 1000 quota 用完） |
| `docs/design/after-foundations/P2-fake-bash-extension-policy.md` | (待写) | reference | B3 设计中确认 curl 接通是 viable + 必须有 guard |

### 3.2 受影响的接口契约

- [x] **Non-breaking addition** (B3 ship 时新增 quota guard config)
- [ ] Breaking change
- [ ] 内部实现修改

### 3.3 是否需要协议层改动

- [x] **仅 packages/ 内部**
- [ ] 需要新增 NACP message kind
- [ ] 需要扩展现有 NACP message 字段

---

## 4. 对 worker matrix 阶段的影响（Worker-Matrix Impact）

### 4.1 哪些下一阶段 worker 会受影响

- [ ] agent.core
- [x] **bash.core** —— curl 接通必须有 subrequest budget
- [ ] filesystem.core
- [ ] context.core
- [ ] reserved skill.core

### 4.2 影响形态

- [ ] 阻塞
- [ ] 漂移
- [x] **性能** —— 高 volume curl 可能耗尽 quota
- [x] **可观测性** —— `defaultEvalRecords` 应 emit `capability.subrequest_budget_exhausted` 类 event

---

## 5. 写回行动（Writeback Action）

### 5.1 推荐写回路径

| 行动 | 目标 phase | 目标文件 / 模块 | 责任 owner |
|---|---|---|---|
| **追加高 volume probe**（按 owner Q2 答取业主提供 URL） | Phase 6 (Round 2) | spike re-run with `{"counts":[50,100,500,1000],"target":"<owner-supplied>"}` | spike runner + owner |
| B3 实现 curl 接通 + per-turn subrequest budget config | B3 | `packages/capability-runtime/src/capabilities/network.ts` | B3 implementer |
| Per-turn budget 触发时 emit evidence | B3 | `packages/capability-runtime` + `eval-observability` | B3 implementer |

### 5.2 写回完成的判定

- [ ] 对应 packages/ 文件已 ship
- [ ] 对应 contract test 已新增
- [ ] 对应 spike Round 2 integrated test 已跑通（**含高 volume**）
- [ ] 修订对应 design doc

### 5.3 dismissed-with-rationale 的判定

- [ ] Finding 不成立
- [ ] Cost-benefit 不划算
- [ ] 延后到更后阶段

---

## 6. 验证证据（Evidence）

### 6.1 原始日志 / 输出

```json
{
  "validationItemId": "V2-bash-curl-quota",
  "success": true,
  "timings": { "samplesN": 35, "totalDurationMs": 27960 },
  "errors": [],
  "observations": [
    {"label": "config", "value": {"target": "https://example.com/", "counts": [10, 25]}},
    {"label": "count_10", "value": {"count": 10, "succeeded": 10, "failed": 0, "p50Ms": 795, "p99Ms": 847}},
    {"label": "count_25", "value": {"count": 25, "succeeded": 25, "failed": 0, "p50Ms": 806, "p99Ms": 846}},
    {"label": "owner_prompt", "value": "Per owner B1 Q2: when first run, please supply preferred test URL via probe params (default uses example.com which is rate-limited)."}
  ]
}
```

### 6.2 复现脚本位置

- `the historical round-1 storage spike workspace`

---

## 7. 关联关系

| 关联 finding | 关系类型 | 说明 |
|---|---|---|
| (none yet) | | |

| 文档 | 章节 | 关系 |
|---|---|---|
| `docs/plan-after-foundations.md` | §2.2 V2 | validation item source |
| `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md` | §6 Q2 | owner pre-answer about test URL |

---

## 8. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；low-volume baseline；high-volume follow-up 是 closure 必要项 |

---

## 9. Round-2 closure (B7 integrated spike)

> **Round-2 status**: `still-open` (gated on owner URL)
> **Writeback date**: 2026-04-20
> **Gate**: `F09-OWNER-URL-MISSING`
> **Drivers**:
>   - follow-up: `the historical round-2 integrated storage spike workspace`
>   - re-validation (conservative path only): `the historical round-2 integrated storage spike workspace`

### Round-2 evidence summary

- **follow-up gate**: the probe **refuses to run** without
  `env.F09_OWNER_URL`. Substituting the default target from Round 1
  would poison the closure verdict (per B7 §6.2 #4).
- **re-validation path**: confirms B3's conservative curl budget
  flows through `CapabilityExecutor` end-to-end (no policy-denied
  under allow, correct output marker). This covers F09 **only** at
  the "shipped surface still reachable" layer, not at the
  high-volume cap layer.
- **probe volumes when enabled**: 50 / 100 / 200 / 500 / 1000 with
  early-stop at 50%+ 429; 5-second per-request timeout

### Round-2 verdict

**Conservative-path re-validation**: `writeback-shipped`.
**High-volume cap**: remains `still-open` pending owner URL.
The B3 conservative budget is safe to keep; the exact widening point
for B8 worker-matrix requires the owner-URL probe.

### Residual still-open

- `F09-OWNER-URL-MISSING` — without an owner-supplied URL that
  tolerates 1000+ fetches in a short window, the high-volume cap
  cannot be measured. B8 worker-matrix should keep B3's
  conservative budget until this gate is cleared.
