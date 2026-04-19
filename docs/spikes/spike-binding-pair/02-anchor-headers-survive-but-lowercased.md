# Spike Finding — `V3-binding-cross-seam-anchor`

> **Finding ID**: `spike-binding-pair-F02`
> **Spike**: `spike-binding-pair`
> **Validation item**: `V3-binding-cross-seam-anchor`
> **Transport scope**: `fetch-based-seam`
> **Discovered**: 2026-04-19
> **Author**: Opus 4.7 (1M context)
> **Severity**: `medium` _(forces packages/ contract: header names must always be lowercase)_
> **Status**: `open`

---

## 0. 摘要（一句话）

> 5 个 `x-nacp-*` anchor headers + 1 个 `x-nacp-source-role` **全部完整透传**；128/1024/8192 byte 值无截断；absent path 无 leak。**关键 contract requirement**：service binding runtime 把 header 名字**强制 lowercase**（`X-Nacp-Trace-Uuid` 接收端只能在 `x-nacp-trace-uuid` 下找到，`receivedAsMixed: null`）——`packages/session-do-runtime/src/cross-seam.ts` 在 set/get header 时**必须始终使用小写**，否则跨 worker 时无法读取。

---

## 1. 现象（Phenomenon）

### 1.1 复现步骤

```bash
curl -sS -X POST "https://nano-agent-spike-binding-pair-a.haimang.workers.dev/probe/binding-cross-seam-anchor" \
  -H "content-type: application/json" --data '{}'
```

### 1.2 实际观测

**Anchor baseline** (6 headers sent):
```json
{
  "survived": {
    "x-nacp-trace-uuid": "ok",
    "x-nacp-session-uuid": "ok",
    "x-nacp-team-uuid": "ok",
    "x-nacp-request-uuid": "ok",
    "x-nacp-source-uuid": "ok",
    "x-nacp-source-role": "ok"
  },
  "receivedHeaderCount": 8
}
```
**6/6 anchor headers survived** (额外 `content-length` + `content-type` 是自动的)。

**Case normalization** (sent `X-Nacp-Trace-Uuid`):
```json
{
  "sentName": "X-Nacp-Trace-Uuid",
  "sentValue": "MIXED-CASE-VALUE-AAAA",
  "receivedAsLower": "MIXED-CASE-VALUE-AAAA",
  "receivedAsMixed": null
}
```
Header 名**被 runtime 强制 lowercase**；mixed-case 在接收端**不可读**。Header value 内容保留（大小写不变）。

**Value size**:

| Sent bytes | Received bytes | Truncated | Rejected |
|---|---|---|---|
| 128 | 128 | false | false |
| 1024 | 1024 | false | false |
| 8192 | 8192 | false | false |

**Absent path**: `anchorHeadersUnexpectedlyPresent: []` —— 不发 anchor 时也无意外注入。

### 1.3 期望与实际的差距

| 维度 | 期望 | 实际 | 差距 |
|---|---|---|---|
| 6 anchor 透传 | yes | ✅ 全 ok | 无 |
| Header value 长度上限 | 推测 ~128 | **实测 ≥ 8192 无问题** | 比期望宽松 |
| Header name case | 推测可能保留 | **强制 lowercase** | **关键约束** |
| Auto-injection | 推测无 | ✅ confirmed 无 | 无 |

---

## 2. 根因（Root Cause）

### 2.1 直接原因

HTTP header names 在标准上 case-insensitive，但 Cloudflare Workers runtime 在跨 binding 透传时**显式 normalize 到 lowercase**——这与 Workers Headers API 的 `entries()` 输出一致。

### 2.2 平台/协议/SDK 引用

| 来源 | 章节 | 关键内容 |
|---|---|---|
| RFC 7230 §3.2 | HTTP header field names | "case-insensitive" |
| Cloudflare Workers Headers API | `Headers.entries()` | 返回 lowercase names |
| 实测 | `.out/2026-04-19T08-28-14Z.json` | confirmed lowercase normalization |

### 2.3 与 packages/ 当前假设的差异

`packages/session-do-runtime/src/cross-seam.ts` 当前定义 anchor header constants 时**应**全部用 lowercase。如果有任何 mixed-case 写法（例如 `X-Nacp-Trace-Uuid`），跨 binding 后接收端 `headers.get("X-Nacp-Trace-Uuid")` 仍能返回值（因为 Headers API 本身 case-insensitive），但**direct iteration 与 dump 时只能看到 lowercase 形式**——这会让 inspector / log / replay 出现 case 不一致。

---

## 3. 对 packages/ 的影响（Package Impact）

### 3.1 受影响文件

| 文件路径 | 行号 | 影响类型 | 说明 |
|---|---|---|---|
| `packages/session-do-runtime/src/cross-seam.ts` | (entire) | **review** | 所有 anchor header constants 必须 lowercase；任何 `header.set("X-Nacp-...")` 都应改为 `header.set("x-nacp-...")` |
| `packages/eval-observability/src/inspector.ts` | (existing SessionInspector) | review | 如果 inspector 显示 captured headers，要 expect lowercase form |
| `packages/nacp-core/src/messages/system.ts` | (TBD if header policy lives here) | review | NACP envelope 中 trace anchor 的 header form 应明确 lowercase |
| `docs/design/after-foundations/P5-nacp-1-2-0-upgrade.md` | (待写) | reference | 如有 NACP 1.2.0 新 anchor header 字段，spec 必须明确 lowercase |

### 3.2 受影响的接口契约

- [x] **Non-breaking addition** —— 现有 `headers.get()` 已 case-insensitive；只需 audit constants
- [ ] Breaking change
- [ ] 内部实现修改

### 3.3 是否需要协议层改动

- [x] **仅 packages/ 内部** —— 但 NACP 1.2.0 spec 应**显式声明** anchor header 始终为 lowercase
- [ ] 需要新增 NACP message kind
- [ ] 需要扩展现有 NACP message 字段

---

## 4. 对 worker matrix 阶段的影响（Worker-Matrix Impact）

### 4.1 哪些下一阶段 worker 会受影响

- [x] **agent.core** —— 跨 worker hop 时 anchor 透传依赖 lowercase contract
- [x] **bash.core**
- [x] **filesystem.core**
- [x] **context.core**

### 4.2 影响形态

- [ ] 阻塞
- [x] **漂移** —— 任何 packages/ 中 mixed-case 写法在生产仍 work 但 inspector 看到 lowercase，造成 audit log 不一致
- [ ] 性能
- [x] **可观测性** —— inspector / replay 必须 normalize lowercase

---

## 5. 写回行动（Writeback Action）

### 5.1 推荐写回路径

| 行动 | 目标 phase | 目标文件 / 模块 | 责任 owner |
|---|---|---|---|
| Audit `cross-seam.ts` 所有 anchor header 用法是否一致 lowercase | B6 / B5 | `packages/session-do-runtime/src/cross-seam.ts` | B5/B6 author |
| NACP 1.2.0 spec 显式声明 anchor header lowercase | B6 (P5) | `docs/rfc/nacp-1-2-0.md` | B6 author |
| `SessionInspector` JSDoc 标注 "headers are normalized lowercase" | B4 (P3 inspector facade) | `packages/eval-observability/src/inspector.ts` | B4 implementer |
| handoff memo 列出该 contract requirement | B8 | `docs/handoff/after-foundations-to-worker-matrix.md` | B8 author |

### 5.2 写回完成的判定

- [ ] 对应 packages/ 文件已 ship
- [ ] 对应 contract test 已新增（验证 mixed-case 透传后只能 lowercase 找到）
- [ ] 对应 spike Round 2 integrated test 已跑通
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
  "validationItemId": "V3-binding-cross-seam-anchor",
  "transportScope": "fetch-based-seam",
  "success": true,
  "observations": [
    {"label": "anchor_baseline", "value": {"survived": {"x-nacp-trace-uuid": "ok", "x-nacp-session-uuid": "ok", "x-nacp-team-uuid": "ok", "x-nacp-request-uuid": "ok", "x-nacp-source-uuid": "ok", "x-nacp-source-role": "ok"}, "receivedHeaderCount": 8}},
    {"label": "anchor_case_normalization", "value": {"sentName": "X-Nacp-Trace-Uuid", "receivedAsLower": "MIXED-CASE-VALUE-AAAA", "receivedAsMixed": null}},
    {"label": "anchor_value_size_128", "value": {"sentBytes": 128, "receivedBytes": 128, "truncated": false, "rejected": false}},
    {"label": "anchor_value_size_1024", "value": {"sentBytes": 1024, "receivedBytes": 1024, "truncated": false, "rejected": false}},
    {"label": "anchor_value_size_8192", "value": {"sentBytes": 8192, "receivedBytes": 8192, "truncated": false, "rejected": false}},
    {"label": "anchor_absent_path", "value": {"anchorHeadersUnexpectedlyPresent": []}}
  ]
}
```

### 6.2 复现脚本位置

- `spikes/round-1-bare-metal/spike-binding-pair/worker-a/src/probes/cross-seam-anchor.ts`
- `spikes/round-1-bare-metal/spike-binding-pair/worker-b/src/handlers/header-dump.ts`

---

## 7. 关联关系

| 关联 finding | 关系类型 | 说明 |
|---|---|---|
| `spike-binding-pair-F03` (hooks-callback) | related-to | hook path 也透传 anchor |

| 文档 | 章节 | 关系 |
|---|---|---|
| `docs/plan-after-foundations.md` | §2.2 V3-binding-cross-seam-anchor | validation item source |
| `docs/design/after-foundations/P0-spike-binding-pair-design.md` | §4.2 | probe design |

---

## 8. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；anchor 透传 ✅；强 contract requirement: header name lowercase |
