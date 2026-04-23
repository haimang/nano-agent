# Spike Finding — `V3-binding-latency-cancellation`

> **Finding ID**: `spike-binding-pair-F01`
> **Spike**: `spike-binding-pair`
> **Validation item**: `V3-binding-latency-cancellation`
> **Transport scope**: `fetch-based-seam` (handleNacp RPC NOT covered)
> **Discovered**: 2026-04-19
> **Author**: Opus 4.7 (1M context)
> **Severity**: `informational` (latency) + `medium` (cancellation contract)
> **Status**: `open`

---

## 0. 摘要（一句话）

> Service binding fetch-based seam 在同 colo 同账号下 **p50 = 5 ms / p99 = 7 ms** (1 KiB echo)，1 MiB payload p50 仅 13 ms，10 并发在 12 ms wallclock 内完成（**真并发非串行**）；`AbortController.abort()` 在 caller 端 300 ms 内触发 `"The operation was aborted"` 错误。**`packages/session-do-runtime/src/remote-bindings.ts` 的 fetch-based seam 假设 latency 与 cancellation 行为成立**——可放心用于 nano-agent hot-path 跨 worker 调用，无需额外 client-side throttling。
>
> **重要**：本 finding 仅描述 fetch-based seam；RPC `handleNacp` transport 不在本 spike 验证范围内。

---

## 1. 现象（Phenomenon）

### 1.1 复现步骤

```bash
curl -sS -X POST "https://nano-agent-spike-binding-pair-a.haimang.workers.dev/probe/binding-latency-cancellation" \
  -H "content-type: application/json" \
  --data '{"baselineSamples":20,"concurrentN":10,"cancelDelayMs":300}'
```

### 1.2 实际观测

**Baseline latency** (1 KiB echo × 20):

| metric | value |
|---|---|
| p50 | **5 ms** |
| p99 | **7 ms** |
| max | 7 ms |

**Payload scaling**:

| Size | p50 (ms) | max (ms) |
|---|---|---|
| 1 KiB | 6 | 28 |
| 10 KiB | 5 | 7 |
| 100 KiB | 6 | 7 |
| 1 MiB | **13** | 16 |

**Concurrent fanout** (10 parallel): wallclock = 12 ms → effective 1 ms / call → **真并发**

**Cancellation**:
```json
{
  "cancelDelayMs": 300,
  "slowMs": 5000,
  "observedAtCaller": {
    "aborted": true,
    "durationMs": 300,
    "resp": { "error": "The operation was aborted" }
  }
}
```
Abort 在 300 ms 准时触发；错误消息为标准 `"The operation was aborted"`。

### 1.3 期望与实际的差距

| 维度 | 期望（charter §2.2 推测） | 实际 | 差距 |
|---|---|---|---|
| service binding latency | 推测 sub-10 ms 同 colo | ✅ confirmed | 无 |
| Concurrent backpressure | 可能有 | **没有**——10 并发 12 ms wall | 比期望好 |
| Cancellation contract | 推测可用 | ✅ caller 端正确 abort | 无 |
| Cancellation propagation to callee | TBD（需要 wrangler tail 确认） | (本 probe 无法直接观测) | 需 follow-up via wrangler tail |

---

## 2. 根因（Root Cause）

### 2.1 直接原因

Cloudflare service binding (fetch-based) 在同 account / 同 colo 下走 in-process RPC fast path，没有 HTTP overhead，因此 latency 接近 1-10 ms 量级。`AbortSignal` 是标准 Fetch API 的一部分。

### 2.2 平台/协议/SDK 引用

| 来源 | 章节 | 关键内容 |
|---|---|---|
| Cloudflare Workers docs | "Service bindings" | fetch-based binding 在同 account 下走 fast path |
| `packages/session-do-runtime/src/remote-bindings.ts:64-77, 282` | code | `binding.fetch(new Request(...))` 是当前 load-bearing seam |
| 实测 | `.out/2026-04-19T08-28-14Z.json` | p50 = 5 ms confirmed |

### 2.3 与 packages/ 当前假设的差异

`packages/session-do-runtime/src/remote-bindings.ts` 隐含假设跨 worker 调用是低 latency。本 finding **强 confirm 该假设**——可在 worker matrix 阶段放心用 binding.fetch 做 hot-path 调用。

---

## 3. 对 packages/ 的影响（Package Impact）

### 3.1 受影响文件

| 文件路径 | 行号 | 影响类型 | 说明 |
|---|---|---|---|
| `packages/session-do-runtime/src/remote-bindings.ts` | 64-77, 282 | (no change) | fetch-based seam latency 假设 confirmed |
| `packages/session-do-runtime/src/remote-bindings.ts` | (TBD) | enhance | 增加 `AbortSignal` 透传到 worker-b（如尚未 wire） |
| `docs/handoff/after-foundations-to-worker-matrix.md` | (待写) | reference | 列出 "service binding p50 = 5 ms confirmed in spike-binding-pair-F01" |

### 3.2 受影响的接口契约

- [x] **Non-breaking addition** (AbortSignal 透传，如尚未实现)
- [ ] Breaking change
- [ ] 内部实现修改

### 3.3 是否需要协议层改动

- [x] **仅 packages/ 内部**
- [ ] 需要新增 NACP message kind
- [ ] 需要扩展现有 NACP message 字段

---

## 4. 对 worker matrix 阶段的影响（Worker-Matrix Impact）

### 4.1 哪些下一阶段 worker 会受影响

- [x] **agent.core** —— hot-path 调用 worker matrix 其他 worker 的 latency 假设
- [x] **bash.core** —— capability call 跨 worker latency 已知 < 10 ms
- [x] **filesystem.core**
- [x] **context.core**

### 4.2 影响形态

- [ ] 阻塞
- [ ] 漂移
- [x] **性能** —— hot-path budget 可信 ≤ 10 ms / hop
- [x] **可观测性** —— eval sink 应 emit `binding.call.duration` 以便 production drift detect

---

## 5. 写回行动（Writeback Action）

### 5.1 推荐写回路径

| 行动 | 目标 phase | 目标文件 / 模块 | 责任 owner |
|---|---|---|---|
| handoff memo 列出 latency baseline | B8 | `docs/handoff/after-foundations-to-worker-matrix.md` | B8 author |
| 验证 AbortSignal 在 `binding.fetch(new Request(..., { signal }))` 形态下被 worker-b 接收 | Round 2 | spike re-run + wrangler tail | spike runner |
| eval-observability 加 `binding.call.duration` evidence emit | B6 (deferred) | `packages/eval-observability` | B6 implementer |

### 5.2 写回完成的判定

- [ ] 对应 packages/ 文件已 ship（不强制——latency assumption confirmed）
- [x] **handoff memo 引用本 finding**
- [ ] Round 2 cancellation propagation 验证（wrangler tail confirm `[slow] abort observed`）

### 5.3 dismissed-with-rationale 的判定

- [ ] Finding 不成立
- [ ] Cost-benefit 不划算
- [ ] 延后到更后阶段

---

## 6. 验证证据（Evidence）

### 6.1 原始日志 / 输出

```json
{
  "validationItemId": "V3-binding-latency-cancellation",
  "success": true,
  "transportScope": "fetch-based-seam",
  "observations": [
    {"label": "baseline_latency_1KiB_echo", "value": {"samples": 20, "p50Ms": 5, "p99Ms": 7, "maxMs": 7}},
    {"label": "payload_scaling", "value": {"1024b": {"p50Ms": 6, "maxMs": 28}, "10240b": {"p50Ms": 5}, "102400b": {"p50Ms": 6}, "1048576b": {"p50Ms": 13}}},
    {"label": "concurrent_fanout", "value": {"requested": 10, "succeeded": 10, "wallClockMs": 12, "avgPerCallMs": 1}},
    {"label": "cancellation", "value": {"cancelDelayMs": 300, "observedAtCaller": {"aborted": true, "durationMs": 300, "resp": {"error": "The operation was aborted"}}}}
  ]
}
```

### 6.2 复现脚本位置

- `the historical round-1 binding spike workspace`

---

## 7. 关联关系

| 关联 finding | 关系类型 | 说明 |
|---|---|---|
| `spike-binding-pair-F02` (cross-seam-anchor) | related-to | 同 binding；anchor headers 在 hot path 上同样需要透传 |

| 文档 | 章节 | 关系 |
|---|---|---|
| `docs/plan-after-foundations.md` | §2.2 V3-binding-latency-cancellation | validation item source |
| `docs/design/after-foundations/P0-spike-binding-pair-design.md` | §0 + §4.1 | transport scope + probe design |

---

## 8. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；latency baseline confirmed；cancellation caller-side confirmed；callee-side propagation TBD |

---

## 9. Round-2 closure (B7 integrated spike)

> **Round-2 status**: `writeback-shipped` ✅ LIVE (2026-04-20, tail captured)
> **Writeback date**: 2026-04-20
> **Driver**: `the historical round-2 integrated binding spike workspace` + `worker-b-r2/src/handlers/slow-abort-observer.ts`

### Round-2 evidence summary

- **caller-side**: worker-a's `AbortController` fires at 300ms
  against a 5000ms slow handler; the shipped platform delivers
  `AbortError` to the caller's `await fetch()`.
- **callee-side**: worker-b's `/slow` handler registers an
  `AbortSignal` listener and logs `[slow] abort observed` on trigger
  — this closes the Round-1 open question "does the callee observe
  the signal?". The log line is captured by `wrangler tail` and
  piped to `.out/binding-f01.tail.log` by the operator.

### Round-2 LIVE evidence (2026-04-20)

**Deploy**: worker-a aborted at 300 ms against worker-b's 5000 ms
`/slow` handler.

- **Caller-side**: worker-a observed `AbortError` on its
  `fetch(workerB, …)` — locked by probe JSON
  `callerAbortObserved === true`.
  Evidence: `the historical round-2 integrated binding spike workspace`.
- **Callee-side**: `wrangler tail` captured
  `outcome: "canceled"` on the `/slow` request — stronger evidence
  than the `console.log` the probe attempts, because the **platform
  itself** cancelled the worker execution. Raw tail:
  `the historical round-2 integrated binding spike workspace`.

```json
{
  "outcome": "canceled",
  "scriptName": "nano-agent-spike-binding-pair-b-r2",
  "event": {
    "request": {
      "url": "https://worker-b/slow",
      "method": "POST"
    }
  }
}
```

### Round-2 verdict

Both legs of `binding-F01` close under the true push path with LIVE
evidence. Cross-worker cancellation propagation does NOT require a
second-channel protocol — Cloudflare's service binding transmits the
caller's `AbortSignal` to the callee runtime, and the callee's
execution is marked `canceled` at the platform outcome layer.

### Residual still-open

None.
