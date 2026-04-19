# Spike Finding — `{FINDING_SHORT_TITLE}`

> **Finding ID**: `{SPIKE_NAMESPACE}-F{NN}` （e.g. `do-storage-F03` / `binding-pair-F07` / `integrated-F02`）
> **Spike**: `{spike-do-storage | spike-binding-pair | spike-round-2-integrated}`
> **Validation item**: `{P0-design 中 12 验证项之一的 ID，例如 V1-storage-R2-multipart}`
> **Discovered**: `YYYY-MM-DD`
> **Author**: `{name}`
> **Severity**: `blocker | high | medium | low | informational`
> **Status**: `open | writeback-in-progress | writeback-shipped | dismissed-with-rationale`

---

## 0. 摘要（一句话）

> **{用 1-2 句话说清这条 finding 是什么、为什么重要}**

例：
> R2 binding 的 `list()` 在真实 Cloudflare 环境每次最多返回 1000 keys 且必须使用 `cursor` 分页；当前 `ScopedStorageAdapter.r2List` 接口签名既无 cursor 入参也无 next-cursor 返回字段，导致 `WorkspaceNamespace` 无法正确遍历大目录。

---

## 1. 现象（Phenomenon）

> **直接描述发生了什么**——具体的错误、行为、性能数字、日志、stack trace。**不要解释原因**，只描述事实。

### 1.1 复现步骤

```bash
# 在 spike 中运行的具体命令 / curl / wrangler 操作
# 必须可被独立复现
```

### 1.2 实际观测

- 观测 1：（粘贴具体的输出 / 日志 / 时间）
- 观测 2：
- 观测 3：

### 1.3 期望与实际的差距

| 维度 | 期望 | 实际 | 差距 |
|---|---|---|---|
| | | | |

---

## 2. 根因（Root Cause）

> **解释为什么会出现 §1 的现象**。基于 Cloudflare 平台行为、协议规范、SDK 文档、或其他可引用的事实。

### 2.1 直接原因

> 一段话描述最近一层的因果。

### 2.2 平台/协议/SDK 引用

| 来源 | 链接 / 章节 | 关键内容 |
|---|---|---|
| Cloudflare docs | https://... | 引用原文 |
| RFC / spec | | |
| Reference impl 代码 | `context/...` | |

### 2.3 与 packages/ 当前假设的差异

> 当前 packages/ 代码隐式假设了什么？真实 platform 行为如何不同？

---

## 3. 对 packages/ 的影响（Package Impact）

> **明确指出哪些 packages/ 文件需要变更**。这一节是 finding 与 ship code 的双向 traceability 的核心。

### 3.1 受影响文件

| 文件路径 | 行号 | 影响类型 (`add`/`modify`/`delete`/`rename`) | 说明 |
|---|---|---|---|
| `packages/storage-topology/src/adapters/scoped-io.ts` | 95-105 | modify | `r2List` 签名加 cursor 字段 |
| `packages/storage-topology/src/adapters/r2-adapter.ts` | NEW | add | 真实 R2 binding 包装，含 cursor 分页循环 |
| | | | |

### 3.2 受影响的接口契约

> 是否会引入 breaking change？是否影响 cross-package contract test？

- [ ] Breaking change（major bump 候选）
- [ ] Non-breaking addition（minor bump 候选）
- [ ] 内部实现修改（patch bump 或不 bump）

### 3.3 是否需要协议层改动

> 这条 finding 是否需要走到 `nacp-core` / `nacp-session` 1.2.0 升级？

- [ ] 仅 packages/ 内部
- [ ] 需要新增 NACP message kind
- [ ] 需要扩展现有 NACP message 字段

---

## 4. 对 worker matrix 阶段的影响（Worker-Matrix Impact）

> **如果不在本阶段消化这条 finding，会对下一阶段（worker matrix）产生什么影响？**

### 4.1 哪些下一阶段 worker 会受影响

- [ ] agent.core（host worker）
- [ ] bash.core（拟议）
- [ ] filesystem.core（拟议）
- [ ] context.core（拟议）
- [ ] reserved skill.core

### 4.2 影响形态

- [ ] 阻塞——不修无法启动该 worker
- [ ] 漂移——可启动但行为与 packages/ 假设不一致
- [ ] 性能——可启动且行为正确但性能不达标
- [ ] 可观测性——影响 trace / evidence / inspection 的可解释性
- [ ] 仅 documentation——影响 handoff memo 描述的准确性

---

## 5. 写回行动（Writeback Action）

> **本条 finding 必须被消化为 packages/ 改动或被显式 dismissed。无 writeback 的 finding 是 spike-truth 与 package-truth 双轨漂移的种子。**

### 5.1 推荐写回路径

| 行动 | 目标 phase | 目标文件 / 模块 | 责任 owner |
|---|---|---|---|
| | Phase 1 / 2 / 3 / 4 / 5 | | |

### 5.2 写回完成的判定

> 怎样算这条 finding 已经被消化？

- [ ] 对应 packages/ 文件已 ship
- [ ] 对应 contract test 已新增
- [ ] 对应 spike Round 2 integrated test 已跑通
- [ ] 修订对应 design doc（如 `docs/design/after-foundations/P{X}-...`）

### 5.3 dismissed-with-rationale 的判定

> **如果决定不写回**，必须解释为什么：是 finding 本身不成立、还是 cost > benefit、还是延后到下一阶段？

- [ ] Finding 在更广 context 下不成立（重新核实后撤回）
- [ ] Cost-benefit 不划算（保留 finding 但接受当前行为）
- [ ] 延后到 worker matrix 阶段或更后阶段（明确写出延后到哪个 phase + 为什么）

---

## 6. 验证证据（Evidence）

> **附上原始材料的引用或粘贴**——日志、截图、wrangler tail 输出、curl 响应、test 失败输出、性能数字。

### 6.1 原始日志 / 输出

```
{paste raw output here}
```

### 6.2 截图 / 链接

- {wrangler dashboard link}
- {grafana link if applicable}

### 6.3 复现脚本位置

- `spikes/round-{1|2}-{bare-metal|integrated}/{spike-name}/scripts/{repro-script}`

---

## 7. 关联关系

### 7.1 与其他 findings 的关系

| 关联 finding | 关系类型 (`duplicates` / `caused-by` / `causes` / `related-to` / `superseded-by`) | 说明 |
|---|---|---|
| | | |

### 7.2 与 charter / design doc 的关系

| 文档 | 章节 | 关系 |
|---|---|---|
| `docs/plan-after-foundations.md` | §X.Y | 印证 / 修正 / 触发新章节 |
| `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` | 第 X 验证项 | finding 直接来源 |

---

## 8. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| YYYY-MM-DD | | 初版 |
| | | |

---

> **使用本模板的纪律**：
> 1. 每条 finding 必须**独立成文件**（一个文件一个 finding，不要在一个文件里塞多个）
> 2. 必须有明确的 **§3 Package Impact** —— 没有 package impact 的 finding 没有 ship value
> 3. 必须有明确的 **§5 Writeback Action** —— writeback 决议是 finding closure 的唯一标准
> 4. **§4 Worker-Matrix Impact** 必须显式判断是否阻塞下一阶段，不要含糊
> 5. 文件命名：`docs/spikes/{spike-namespace}/{NN}-{kebab-short-title}.md`
>    例：`docs/spikes/spike-do-storage/03-r2-list-cursor-required.md`
