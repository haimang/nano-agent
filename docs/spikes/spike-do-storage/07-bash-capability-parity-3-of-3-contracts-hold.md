# Spike Finding — `V2A-bash-capability-parity`

> **Finding ID**: `spike-do-storage-F07`
> **Spike**: `spike-do-storage`
> **Validation item**: `V2A-bash-capability-parity`
> **Discovered**: 2026-04-19
> **Author**: Opus 4.7 (1M context)
> **Severity**: `informational`
> **Status**: `open`

---

## 0. 摘要（一句话）

> `packages/capability-runtime/src/capabilities/{filesystem,search}.ts` 的 3 个 load-bearing 行为契约在真实 DO 沙箱里**全部成立**：mkdir 返回 `MKDIR_PARTIAL_NOTE` + `listAfter=[]`、`/_platform/**` reserved namespace 拒绝写入、`rg` 200-line/32KiB inline cap 触发截断。Phase 2 fake-bash 扩展（B3）**不需要修改**这 3 个 contract，可放心直接 port more just-bash 命令。

---

## 1. 现象（Phenomenon）

### 1.1 复现步骤

```bash
curl -sS -X POST "https://nano-agent-spike-do-storage.haimang.workers.dev/probe/bash/capability-parity" \
  -H "content-type: application/json" --data '{}'
```

### 1.2 实际观测

3 contract checks summary：`{ total: 3, holding: 3, diverging: [] }`

| Contract | Source | Expected | Observed | Holds? |
|---|---|---|---|---|
| mkdir partial-no-directory-entity | `filesystem.ts:53,120-127` | `note="mkdir-partial-no-directory-entity"` + `listAfterEmpty=true` | ✅ matched | **yes** |
| reserved-namespace `/_platform/**` rejection | `filesystem.ts:9` | `rejected=true` | ✅ matched (`errorKind="reserved-namespace"`) | **yes** |
| rg inline output cap (200 lines / 32 KiB) | `search.ts` | `truncated=true` + `returnedLines ≤ 200` + `returnedBytes ≤ 32K` | ✅ matched | **yes** |

### 1.3 期望与实际的差距

无差距。3/3 hold。

---

## 2. 根因（Root Cause）

### 2.1 直接原因

`packages/capability-runtime` 的 handler 设计哲学是 "small contract, deterministic behavior"。这些 contract 是**path-law / disclosure 行为**而非 OS-bound 行为，所以在 Cloudflare Worker 沙箱（无 directory entity / 无 ripgrep binary）和 OS shell 上一致表现。

### 2.2 平台/协议/SDK 引用

| 来源 | 章节 | 关键内容 |
|---|---|---|
| `packages/capability-runtime/src/capabilities/filesystem.ts:9` | comment | `/_platform/**` reserved namespace |
| `packages/capability-runtime/src/capabilities/filesystem.ts:53` | const | `MKDIR_PARTIAL_NOTE = "mkdir-partial-no-directory-entity"` |
| `packages/capability-runtime/src/capabilities/filesystem.ts:120-127` | mkdir handler | "ack-create prefix only, no directory entity" |
| `packages/capability-runtime/src/capabilities/search.ts` | rg handler | inline cap `200 lines / 32 KiB` + reserved namespace silently skipped |
| 实测 | `.out/2026-04-19T08-17-46Z.json` | 3/3 hold |

### 2.3 与 packages/ 当前假设的差异

无差异。3 个 contract 完全 hold。

---

## 3. 对 packages/ 的影响（Package Impact）

### 3.1 受影响文件

| 文件路径 | 行号 | 影响类型 | 说明 |
|---|---|---|---|
| `packages/capability-runtime/src/capabilities/filesystem.ts` | 9, 53, 120-127 | (no change) | 3 contract validated |
| `packages/capability-runtime/src/capabilities/search.ts` | (entire) | (no change) | rg cap validated |
| `docs/design/after-foundations/P2-fake-bash-extension-policy.md` | (待写) | reference | B3 设计中可放心 port more just-bash 命令，无需重新评估 mkdir/reserved-ns/rg cap |

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

- [ ] agent.core
- [x] **bash.core** —— 12-pack contract 在真实 worker runtime 上 holds
- [ ] filesystem.core
- [ ] context.core
- [ ] reserved skill.core

### 4.2 影响形态

- [ ] 阻塞
- [ ] 漂移
- [ ] 性能
- [ ] 可观测性
- [x] **仅 documentation** —— bash.core 的 worker 化不需要重新设计这 3 个 handler

---

## 5. 写回行动（Writeback Action）

### 5.1 推荐写回路径

| 行动 | 目标 phase | 目标文件 / 模块 | 责任 owner |
|---|---|---|---|
| B3 design doc 引用本 finding，证明 12-pack 现有 contract 可保留 | B3 | `docs/design/after-foundations/P2-fake-bash-extension-policy.md` | B3 author |
| Phase 7 handoff memo 列出"V2A 3 contract 已验证" | B8 | `docs/handoff/after-foundations-to-worker-matrix.md` | B8 author |

### 5.2 写回完成的判定

- [ ] 对应 packages/ 文件已 ship（不需要——contract holds）
- [x] **B3 design doc 显式引用本 finding**

### 5.3 dismissed-with-rationale 的判定

- [ ] Finding 不成立
- [ ] Cost-benefit 不划算
- [ ] 延后到更后阶段

---

## 6. 验证证据（Evidence）

### 6.1 原始日志 / 输出

```json
{
  "validationItemId": "V2A-bash-capability-parity",
  "success": true,
  "observations": [{
    "label": "contract_checks",
    "value": [
      {"contract": "mkdir partial-no-directory-entity", "source": "filesystem.ts:53,120-127", "holds": true},
      {"contract": "reserved-namespace /_platform/** rejection", "source": "filesystem.ts:9", "holds": true},
      {"contract": "rg inline output cap (200 lines / 32 KB)", "source": "search.ts", "holds": true}
    ]
  }, {
    "label": "summary",
    "value": {"total": 3, "holding": 3, "diverging": []}
  }]
}
```

### 6.2 复现脚本位置

- `spikes/round-1-bare-metal/spike-do-storage/src/probes/bash-capability-parity.ts`

---

## 7. 关联关系

| 关联 finding | 关系类型 | 说明 |
|---|---|---|
| `spike-do-storage-F08` (V2B platform-stress) | related-to | 同 bash 类，但 stress 维度 |

| 文档 | 章节 | 关系 |
|---|---|---|
| `docs/plan-after-foundations.md` | §2.2 V2-bash | validation item source |
| `docs/design/after-foundations/P0-spike-do-storage-design.md` | r2 §4.7 | V2A 拆分理由 |
| `docs/design/after-foundations/P0-reviewed-by-GPT.md` | §2.4 | GPT 推动 V2 拆分为 V2A/V2B |

---

## 8. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；3/3 hold；B3 不需修订 12-pack contract |
