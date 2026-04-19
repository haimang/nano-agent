# Spike Finding — `V3-binding-hooks-callback`

> **Finding ID**: `spike-binding-pair-F03`
> **Spike**: `spike-binding-pair`
> **Validation item**: `V3-binding-hooks-callback`
> **Transport scope**: `fetch-based-seam`
> **Discovered**: 2026-04-19
> **Author**: Opus 4.7 (1M context)
> **Severity**: `informational`
> **Status**: `open`

---

## 0. 摘要（一句话）

> 跨 worker hook dispatch 在 fetch-based seam 上 **p50 = 4 ms / p99 = 6 ms**；slow 1.5 s blocking hook 准时 1510 ms 返回；throwing hook 返回 HTTP 500 + 结构化 body (`{ ok: false, thrown: "..." }`)；anchor headers 在 hook path 上同样透传。**对 `packages/hooks/src/runtimes/service-binding.ts` 远端 hook runtime 的 contract 强 confirm**——可放心用于 worker matrix 阶段的跨 worker hook dispatch（含 PreToolUse/PreCompact 等 blocking events）。

---

## 1. 现象（Phenomenon）

### 1.1 复现步骤

```bash
curl -sS -X POST "https://nano-agent-spike-binding-pair-a.haimang.workers.dev/probe/binding-hooks-callback" \
  -H "content-type: application/json" --data '{}'
```

### 1.2 实际观测

**OK dispatch latency** (mode=ok × 20):

| metric | value |
|---|---|
| p50 | **4 ms** |
| p99 | **6 ms** |
| max | 6 ms |

**Slow blocking hook** (slowMs=1500):
```json
{
  "callerWaitMs": 1510,
  "calleeReportedLatencyMs": 1500,
  "outcome": { "ok": true, "additionalContext": "stub-from-spike" }
}
```
Caller 准时等待 1510 ms （与 callee 实际处理 1500 ms 几乎一致），无 timeout。

**Throwing hook** (mode=throw):
```json
{
  "responseStatus": 500,
  "callerWaitMs": 5,
  "bodyShape": ["ok", "handler", "mode", "thrown"],
  "bodyOk": false,
  "bodyThrown": "intentional-failure-from-hook"
}
```
HTTP 500 + 结构化 JSON body 完整透传——caller 可解析失败原因。

**Anchor on hook-dispatch path (r2 verified)**: 2026-04-19 (r2) 之后 probe 显式 POST 到 `/handle/hook-dispatch` (不再是 `/handle/header-dump`)，worker-b hook-dispatch handler 在 response body 中 echo 收到的全部 headers。实测结果：`{ route: "/handle/hook-dispatch", traceSurvived: true, sessionSurvived: true, traceMatches: true, sessionMatches: true }` —— anchor 在真 hook-dispatch 路径上同样透传且值完全保留。

### 1.3 期望与实际的差距

| 维度 | 期望 | 实际 | 差距 |
|---|---|---|---|
| Hook dispatch latency | < 10 ms | ✅ p50 = 4 ms | 无 |
| Slow blocking hook tolerance | 准时返回 | ✅ 1510 ms ≈ 1500 ms | 无 |
| Throwing hook error shape | 期望 transport-level 502/503 | **HTTP 500 + 结构化 body** | 比期望好（可读 body） |
| Anchor on hook path | yes | ✅ confirmed | 无 |

---

## 2. 根因（Root Cause）

### 2.1 直接原因

`packages/hooks/src/runtimes/service-binding.ts` 设计的 hook runtime seam 与 fetch-based service binding 完全 line up：HTTP body / status / headers 全部透传，无额外协议层 overhead。

### 2.2 平台/协议/SDK 引用

| 来源 | 章节 | 关键内容 |
|---|---|---|
| `packages/hooks/src/runtimes/service-binding.ts` | code | hook runtime 的 transport seam |
| `packages/hooks/src/catalog.ts:43-98` | code | 8 hook events with allowedOutcomes/blocking |
| 实测 | `.out/2026-04-19T08-28-14Z.json` | dispatch / slow / throw / anchor 4 scenarios 全 ok |

### 2.3 与 packages/ 当前假设的差异

无差异。Hook runtime contract 完全 hold。

---

## 3. 对 packages/ 的影响（Package Impact）

### 3.1 受影响文件

| 文件路径 | 行号 | 影响类型 | 说明 |
|---|---|---|---|
| `packages/hooks/src/runtimes/service-binding.ts` | (entire) | (no change) | contract validated |
| `packages/hooks/src/catalog.ts` | 43-98 | (no change in this finding) | 8-event catalog 仍可信；扩展由 P4 决定 |
| `docs/design/after-foundations/P4-hooks-catalog-expansion.md` | (待写) | reference | B5 设计中可放心扩 catalog 到 16-20 events，跨 worker dispatch contract 已 verified |

### 3.2 受影响的接口契约

- [ ] Breaking change
- [ ] Non-breaking addition
- [ ] 内部实现修改

### 3.3 是否需要协议层改动

- [x] **仅 packages/ 内部**
- [ ] 需要新增 NACP message kind
- [ ] 需要扩展现有 NACP message 字段

---

## 4. 对 worker matrix 阶段的影响（Worker-Matrix Impact）

### 4.1 哪些下一阶段 worker 会受影响

- [x] **agent.core** —— PreToolUse/PreCompact 等 blocking hook 跨 worker dispatch latency 已知 < 10 ms ok / blocking hook 1.5 s 也 viable
- [ ] bash.core
- [ ] filesystem.core
- [x] **context.core** —— Phase 4 新增 ContextCompactPrepareStarted / Committed 等 lifecycle hook 跨 worker dispatch 同款 latency

### 4.2 影响形态

- [ ] 阻塞
- [ ] 漂移
- [x] **性能** —— hook dispatch budget 可信
- [x] **可观测性** —— throwing hook 错误 body 可解析，便于 audit

---

## 5. 写回行动（Writeback Action）

### 5.1 推荐写回路径

| 行动 | 目标 phase | 目标文件 / 模块 | 责任 owner |
|---|---|---|---|
| handoff memo 列出 hook dispatch latency baseline + error shape | B8 | `docs/handoff/after-foundations-to-worker-matrix.md` | B8 author |
| Phase 4 hook catalog 扩展 design 引用本 finding | B5 | `docs/design/after-foundations/P4-hooks-catalog-expansion.md` | B5 author |

### 5.2 写回完成的判定

- [ ] 对应 packages/ 文件已 ship（contract holds，无需 ship）
- [x] **handoff memo 引用本 finding**

### 5.3 dismissed-with-rationale 的判定

- [ ] Finding 不成立
- [ ] Cost-benefit 不划算
- [ ] 延后到更后阶段

---

## 6. 验证证据（Evidence）

### 6.1 原始日志 / 输出

```json
{
  "validationItemId": "V3-binding-hooks-callback",
  "transportScope": "fetch-based-seam",
  "success": true,
  "observations": [
    {"label": "ok_dispatch_latency", "value": {"samples": 20, "p50Ms": 4, "p99Ms": 6, "maxMs": 6}},
    {"label": "slow_blocking_hook", "value": {"callerWaitMs": 1510, "calleeReportedLatencyMs": 1500, "outcome": {"ok": true, "additionalContext": "stub-from-spike"}}},
    {"label": "throwing_hook", "value": {"responseStatus": 500, "callerWaitMs": 5, "bodyShape": ["ok", "handler", "mode", "thrown"], "bodyOk": false, "bodyThrown": "intentional-failure-from-hook"}},
    {"label": "anchor_on_hook_path", "value": {"traceSurvived": true, "sessionSurvived": true}}
  ]
}
```

### 6.2 复现脚本位置

- `spikes/round-1-bare-metal/spike-binding-pair/worker-a/src/probes/hooks-callback.ts`
- `spikes/round-1-bare-metal/spike-binding-pair/worker-b/src/handlers/hook-dispatch.ts`

---

## 7. 关联关系

| 关联 finding | 关系类型 | 说明 |
|---|---|---|
| `spike-binding-pair-F02` (cross-seam-anchor) | causes | anchor 透传是 hook path 的前置 |
| `spike-binding-pair-F01` (latency) | related-to | latency baseline 一致 |

| 文档 | 章节 | 关系 |
|---|---|---|
| `docs/plan-after-foundations.md` | §2.2 V3-binding-hooks-callback | validation item source |

---

## 8. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；3 modes (ok/slow/throw) + anchor 都 confirmed |
| 2026-04-19 (r2) | Opus 4.7 | R2 code fix per B1-code-reviewed-by-GPT §R2: probe 的 anchor 检查从 `/handle/header-dump` 改为 `/handle/hook-dispatch`；worker-b hook-dispatch handler echo receivedHeaders；真 hook 路径上 anchor 透传与值完整性已独立验证。新 `.out/2026-04-19T13-02-31Z.json` 证据 |
