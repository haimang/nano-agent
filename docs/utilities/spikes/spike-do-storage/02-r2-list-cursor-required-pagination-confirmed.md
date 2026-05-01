# Spike Finding — `V1-storage-R2-list-cursor`

> **Finding ID**: `spike-do-storage-F02`
> **Spike**: `spike-do-storage`
> **Validation item**: `V1-storage-R2-list-cursor`
> **Discovered**: 2026-04-19
> **Author**: Opus 4.7 (1M context)
> **Severity**: `medium`
> **Status**: `open`

---

## 0. 摘要（一句话）

> R2 `list({ limit: N, cursor })` 完全按预期分页：50 keys + limit=20 → 3 pages (20+20+10) with `truncated` 标志和 cursor 链；**`packages/storage-topology/src/adapters/scoped-io.ts:127` 的 `r2List` 接口当前签名缺少 cursor 字段，B2 ship `R2Adapter` 时必须扩展为 `(prefix, options: { limit?, cursor? }) => { objects, truncated, cursor? }` 形态**。

---

## 1. 现象（Phenomenon）

### 1.1 复现步骤

```bash
curl -sS -X POST "https://nano-agent-spike-do-storage.haimang.workers.dev/probe/storage-r2/list-cursor" \
  -H "content-type: application/json" --data '{"keyCount":50,"pageLimit":20,"preseed":true}'
```

### 1.2 实际观测

- preseed 50 keys：13.67 s（约 273 ms / put — 见 unexpected-F01 候选）
- list page 1：`{ objCount: 20, truncated: true, cursor: "..." }`
- list page 2：`{ objCount: 20, truncated: true, cursor: "..." }`
- list page 3：`{ objCount: 10, truncated: false, cursor: null }`
- 总计 returned 50 keys，3 pages with pageSizes [20, 20, 10]
- `errors: []`

### 1.3 期望与实际的差距

| 维度 | 期望 | 实际 | 差距 |
|---|---|---|---|
| `truncated` 标志 | 存在且按 limit 触发 | ✅ 完全按预期 | 无 |
| `cursor` 字段 | 在 truncated=true 时返回 string；truncated=false 时无 | ✅ 完全按预期 | 无 |
| limit 实际生效 | 是 | ✅ 每页正好返回 limit 或更少 | 无 |
| `r2List` 当前接口可承载 | charter 推测：否 | **确认：否** —— `scoped-io.ts:127` 没有 cursor 字段 | 必须 v2 |

---

## 2. 根因（Root Cause）

### 2.1 直接原因

R2 `list()` 是 paginated by design (Cloudflare 平台决定)。任何超过 `limit` 的 list 都强制返回 `truncated: true` + `cursor`，调用方必须用该 cursor 继续 list 直到 `truncated: false`。

### 2.2 平台/协议/SDK 引用

| 来源 | 章节 | 关键内容 |
|---|---|---|
| Cloudflare R2 Workers API | `R2Bucket.list()` | 返回 `{ objects, truncated, cursor?, delimitedPrefixes }` |
| 实测 | `.out/2026-04-19T08-17-46Z.json` | 50 keys / limit=20 → 3 pages with cursor chain |

### 2.3 与 packages/ 当前假设的差异

```ts
// packages/storage-topology/src/adapters/scoped-io.ts:127
async r2List(prefix: string): Promise<{ objects: Array<...> }> {
  throw new Error("NullStorageAdapter: r2List not connected");
}
```

当前接口**只接受 prefix，不接受 limit/cursor，也不返回 truncated/next-cursor**。这是必须修订的项。

---

## 3. 对 packages/ 的影响（Package Impact）

### 3.1 受影响文件

| 文件路径 | 行号 | 影响类型 | 说明 |
|---|---|---|---|
| `packages/storage-topology/src/adapters/scoped-io.ts` | 127 | **modify** | `r2List` 接口扩展为 `(prefix, opts?: { limit?: number, cursor?: string }) => Promise<{ objects, truncated, cursor? }>` |
| `packages/storage-topology/src/adapters/r2-adapter.ts` | NEW (B2) | add | 真实 R2Adapter 实现 cursor walking helper（封装 `list-until-not-truncated` 模式） |
| `packages/workspace-context-artifacts/src/backends/reference.ts` | 47 | modify | `ReferenceBackend.list*` 方法消费新接口 |
| `docs/rfc/scoped-storage-adapter-v2.md` | NEW (B2) | add | 显式记录此 breaking change |

### 3.2 受影响的接口契约

- [x] **Breaking change** —— `ScopedStorageAdapter.r2List` 签名变了
- [ ] Non-breaking addition
- [ ] 内部实现修改

`storage-topology` 当前仅 0.1.0，唯一实现是 `NullStorageAdapter`（全抛 not-connected），**没有真实生产用户**——breaking change 代价为零。建议 B2 ship 时直接 major bump 到 2.0.0（charter §11.2 已 anticipate 此 bump）。

### 3.3 是否需要协议层改动

- [x] **仅 packages/ 内部** —— 不穿透到 NACP（与 charter §4.1 F "不新增 storage.* family" 一致）
- [ ] 需要新增 NACP message kind
- [ ] 需要扩展现有 NACP message 字段

---

## 4. 对 worker matrix 阶段的影响（Worker-Matrix Impact）

### 4.1 哪些下一阶段 worker 会受影响

- [ ] agent.core
- [ ] bash.core
- [x] **filesystem.core** —— 任何 R2-backed list 操作必须用 cursor walking
- [x] **context.core** —— `WorkspaceSnapshotBuilder` 跨 namespace enumerate 时用 R2 ref 列表

### 4.2 影响形态

- [x] **阻塞** —— 不修无法启动 filesystem.core 的 large directory scenario
- [ ] 漂移
- [ ] 性能
- [ ] 可观测性
- [ ] 仅 documentation

---

## 5. 写回行动（Writeback Action）

### 5.1 推荐写回路径

| 行动 | 目标 phase | 目标文件 / 模块 | 责任 owner |
|---|---|---|---|
| 修订 `ScopedStorageAdapter.r2List` 接口签名（加 cursor / limit 入参 + truncated/cursor 返回字段） | B2 | `packages/storage-topology/src/adapters/scoped-io.ts:127` | B2 implementer |
| 实现 R2Adapter 真实 list-until-not-truncated helper | B2 | `packages/storage-topology/src/adapters/r2-adapter.ts` | B2 implementer |
| RFC 文档 | B2 | `docs/rfc/scoped-storage-adapter-v2.md` | B2 author |
| 接通 ReferenceBackend list path | B2 | `packages/workspace-context-artifacts/src/backends/reference.ts` | B2 implementer |

### 5.2 写回完成的判定

- [ ] 对应 packages/ 文件已 ship (B2 future work)
- [ ] **对应 contract test 已新增**（B2 future work — 验证 cursor walk 不漏 key + truncated/cursor 字段存在）
- [ ] **对应 spike Round 2 integrated test 已跑通**（B7 future work — 用 ship 后的 R2Adapter 重跑 V1-storage-R2-list-cursor）
- [x] **修订 design doc** —— `P1-storage-adapter-hardening.md` 引用本 finding ID (confirmed 2026-04-19)

### 5.3 dismissed-with-rationale 的判定

- [ ] Finding 不成立
- [ ] Cost-benefit 不划算
- [ ] 延后到更后阶段

---

## 6. 验证证据（Evidence）

### 6.1 原始日志 / 输出

```json
{
  "validationItemId": "V1-storage-R2-list-cursor",
  "success": true,
  "timings": { "samplesN": 3, "totalDurationMs": 13909 },
  "errors": [],
  "observations": [
    {"label": "preseed_complete", "value": {"keyCount": 50, "durationMs": 13670}},
    {"label": "page_1", "value": {"objCount": 20, "truncated": true, "cursor": "..."}},
    {"label": "page_2", "value": {"objCount": 20, "truncated": true, "cursor": "..."}},
    {"label": "page_3", "value": {"objCount": 10, "truncated": false, "cursor": null}},
    {"label": "summary", "value": {"pages": 3, "totalReturned": 50, "requestedLimit": 20, "pageSizes": [20, 20, 10]}}
  ]
}
```

### 6.2 复现脚本位置

- `the historical round-1 storage spike workspace`
- `the historical round-1 storage spike workspace`

---

## 7. 关联关系

| 关联 finding | 关系类型 | 说明 |
|---|---|---|
| `spike-do-storage-F01` (R2 multipart) | related-to | 同 R2 binding |
| `unexpected-F01` (R2 put 273 ms/key) | related-to | preseed 阶段同时观察到 |

| 文档 | 章节 | 关系 |
|---|---|---|
| `docs/plan-after-foundations.md` | §2.2 V1-storage-R2-list-cursor | validation item source |
| `docs/design/after-foundations/P0-spike-do-storage-design.md` | §4.2 | probe design |

---

## 8. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；真实证据 + r2List 接口 v2 修订需求确定 |
| 2026-04-19 (r2) | Opus 4.7 | R2 docs fix per B1-docs-reviewed-by-GPT §R2: 回收 §5.2 2 处 premature `[x]` → `[ ]` (contract test + Round 2 test 都是 B2/B7 future work) |

---

## 9. Round-2 closure (B7 integrated spike)

> **Round-2 status**: `writeback-shipped` ✅ LIVE (2026-04-20)
> **Writeback date**: 2026-04-20
> **Driver**: `the historical round-2 integrated storage spike workspace` via `R2Adapter.listAll({ prefix })`

### Round-2 evidence summary

- **used seam**: `@nano-agent/storage-topology::R2Adapter.listAll`
- **local simulation**: seed 3 keys → `listAll` returns all 3 → cleanup
- **caveats carried forward**: `listAll` is **bounded best-effort**
  (B2 carry-forward caveat per `packages/storage-topology` docs);
  callers that need all keys beyond the adapter's internal cap still
  must honour the cursor themselves. This caveat is preserved in the
  probe's `caveats` array.

### Round-2 verdict

`listAll` pagination path is valid for small inventories. Large
catalog sweeps still require cursor-aware iteration at the caller.
The B2 `listAll` bounded-sweep caveat is **not collapsed** by B7.

### Residual still-open

None at adapter level. The `ReferenceBackend` orphan-sweep concern
remains a B2 calibration item tracked separately.
