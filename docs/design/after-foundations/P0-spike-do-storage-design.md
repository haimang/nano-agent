# Nano-Agent After-Foundations P0 — Spike DO+Storage Design

> 功能簇：`Spike Worker — DO + Storage Probe (Round 1, single-worker)`
> 讨论日期：`2026-04-19`
> 讨论者：`Opus 4.7 (1M context)`
> 关联调查报告：
> - `docs/plan-after-foundations.md` (§2.2 V1+V2 / §4.1 A / §7.1)
> - `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` (§3 纪律 / §4.1-4.2 8 项验证项 / §5 writeback)
> - `docs/templates/_TEMPLATE-spike-finding.md`
> - `packages/storage-topology/src/adapters/scoped-io.ts` (`NullStorageAdapter` not-connected baseline)
> - `packages/workspace-context-artifacts/src/backends/reference.ts` (`ReferenceBackend` not-connected baseline)
> - `packages/capability-runtime/src/capabilities/{network,filesystem,search}.ts`
> 文档状态：`draft`

---

## 0. 背景与前置约束

`spike-do-storage` 是 Round 1 两个 spike 之一——**单 worker probe**，专门暴露 R2 / KV / DO storage / D1 与 fake-bash filesystem capabilities 在真实 Cloudflare runtime 下的行为。它不验证 worker-to-worker 通讯（那是 `spike-binding-pair` 的职责）。

- **项目定位回顾**：nano-agent 的 storage 真相分布在 KV (warm config) + R2 (cold artifact) + DO storage (transactional session state) + D1 (deferred query)；fake-bash 假定这些 storage 在 Workers runtime 下行为可预测。
- **本次讨论的前置共识**：
  - 当前 `NullStorageAdapter` 全部抛 "not connected"（`storage-topology/src/adapters/scoped-io.ts:87-127`）
  - 当前 `ReferenceBackend` 全部抛 "not connected"（`workspace-context-artifacts/src/backends/reference.ts:19-47`）
  - 当前 `CURL_NOT_CONNECTED_NOTE = "curl-not-connected"`（`capability-runtime/src/capabilities/network.ts:38`）
  - 12-pack capabilities 仅通过本地 vitest + MemoryBackend 验证，**没有任何 Workers DO 沙箱真实测试**
  - 必须严守 spike 7 条纪律（详见 P0-spike-discipline-and-validation-matrix §3）
- **显式排除的讨论范围**：
  - 不讨论 service binding / cross-worker（→ `spike-binding-pair`）
  - 不讨论 NACP 协议升级（→ Phase 5）
  - 不讨论 async compact lifecycle（→ Phase 3）
  - 不讨论 worker matrix 阶段的最终 storage worker shell

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`spike-do-storage`
- **一句话定义**：单 Cloudflare worker，含 1 个 DO class，绑定 R2 / KV / D1 / DO storage 全部，作为 probe 验证 storage 与 fake-bash filesystem 在真实 platform 下的 8 项行为。
- **边界描述**：本 spike **包含** §4 的 8 项 storage + bash 验证；**不包含** service binding 测试 / 多 worker 协同 / 真实 LLM 调用 / 业务数据持有。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|---|---|---|
| **Probe endpoint** | spike worker 暴露的 HTTP 路由，接受参数后执行特定 storage 操作 | 路由命名 `/probe/{validation-item-id}/{operation}` |
| **Validation script** | 在本机调用 probe endpoint 并采集结果的 shell 脚本 | 放在 `spikes/round-1-bare-metal/spike-do-storage/scripts/` |
| **Replay seed** | 让多次执行 probe 产生一致行为的固定 seed | 用于 stale-read window / consistency 验证 |
| **Probe namespace** | spike 专用的 KV / R2 / D1 / DO namespace | 必须独立于 production；纪律 5 |

### 1.2 参考调查报告

- `P0-spike-discipline-and-validation-matrix.md` §4.1 + §4.2 —— 8 项验证项的来源
- Cloudflare R2 docs + KV docs + DO docs + D1 docs（在 finding 中按需引用）
- `context/claude-code/services/SessionMemory/sessionMemory.ts` —— 对照 single-process CLI 的 storage 心智

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 本 spike 的角色：**after-foundations Round 1 的两条 truth-source 之一**（另一条是 spike-binding-pair）。
- 它服务于：Phase 1 (storage adapter hardening) + Phase 2 (fake-bash extension) + Phase 3 (context-management hybrid storage)。
- 它依赖：Cloudflare R2 / KV / D1 / DO bindings 的真实可用性 + wrangler deploy 能力。
- 它被谁依赖：Phase 1-3 的 design / action plan 必须把 spike-do-storage 的 finding 列为输入。

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| `spike-binding-pair` | 同期独立 | 弱 | 不互相依赖，但共享 spike 纪律 |
| Phase 1 storage adapter ship | 输出 finding → 输入 spec | 强 | V1-V6 finding 必须被 Phase 1 消化 |
| Phase 2 fake-bash extension | 输出 finding → 输入 spec | 强 | V2-bash-platform / V2-bash-curl-quota 必须被 Phase 2 消化 |
| Phase 3 context-management hybrid storage | 输出 finding → 输入 spec | 中 | tier-router 设计依赖 V1-storage-* 全套 |
| Phase 6 Round 2 integrated spike | 输入 ← finding closure | 强 | Round 2 必须验证所有 V1-V2 finding 已被消化 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`spike-do-storage` 是 after-foundations Round 1 的**单 worker storage truth probe**，负责对 R2 / KV / DO storage / D1 与 fake-bash filesystem capabilities 在真实 Cloudflare runtime 下的 8 项行为给出 finding，对上游消化 §4.1-4.2 的验证矩阵，对下游为 Phase 1-3 提供必须消化的 spike-finding 输入。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 | 砍的理由 | 未来是否可能回补 |
|---|---|---|---|
| 完整 NACP envelope 处理 | `nacp-core` | spike 不验证协议，验证 platform；用 plain JSON HTTP 即可 | 不回补，因为 spike 与 production worker 是分开形态 |
| Trace seam / cross-seam anchor | `session-do-runtime/src/cross-seam.ts` | binding-pair spike 才需要；single worker 不需要 | 由 binding-pair spike 覆盖 |
| 完整 hooks dispatch | `hooks` | spike 不验证 hooks，验证 storage | 不回补 |
| Cross-package E2E test | root contract tests | spike 用 manual probe + finding doc，不接 CI | 不回补 |

### 3.2 接口精简：spike worker 暴露的最小 HTTP 表面

> **修订说明（2026-04-19, GPT review §2.2 反馈）**：v1 写"9 路由"是错的；实际 8 个 probe 路由 + 1 healthz + 1 debug = 10 endpoints，但 **probe 路由是 8 个**，对应 8 个 required validation items。

```
GET  /healthz                                — liveness（不算 probe）
POST /probe/storage-r2/multipart            — V1-storage-R2-multipart
POST /probe/storage-r2/list-cursor          — V1-storage-R2-list-cursor
POST /probe/storage-kv/stale-read           — V1-storage-KV-stale-read
POST /probe/storage-do/transactional        — V1-storage-DO-transactional
POST /probe/storage-mem-vs-do/diff          — V1-storage-Memory-vs-DO
POST /probe/storage-d1/transaction          — V1-storage-D1-transaction
POST /probe/bash/capability-parity          — V2A-bash-capability-parity (修订后；详见 §4.7-4.8)
POST /probe/bash/platform-stress            — V2B-bash-platform-stress  (修订后；详见 §4.9)
POST /probe/bash/curl-quota                 — V2-bash-curl-quota
GET  /inspect/last-run                      — 最近一次 probe 的结果（debug，不算 probe）
```

总计：**8 个 probe 路由**，对应 8 项 required validation（V1 6 项 + V2A + V2B + V2-curl 共 9 项？修正：V2-bash 拆分为 V2A 与 V2B 后 §4 共有 9 个验证项；但 V2-bash-curl-quota 仍是 V2 类的 1 项，因此 §4 总数实际为 6 storage + 3 bash = **9 个 validation item**，对应 9 个 probe 路由）。

> **进一步修订（基于 GPT review §2.4）**：V2 拆分后实际是 V2A (capability-parity) + V2B (platform-stress) + V2-curl-quota = 3 项 bash validation；总计 6 storage + 3 bash = **9 个 validation item**，对应 9 个 probe endpoint。这与修订后 charter §2.2 的"V1 6 storage + V2 2 bash = 8 项"略有出入，需要在 charter §2.2 中相应调整为"V1 6 storage + V2 3 bash = 9 项"（详见 plan-after-foundations §14 同步修订）。

每个 `POST /probe/...` 路由：
- 接受参数 JSON（payload size、object size、cursor seed 等）
- 同步执行对应 binding 操作
- 返回 JSON `{ success, observations, timings, errors, raw }`

### 3.3 解耦：spike worker 的最小内部结构

```
spikes/round-1-bare-metal/spike-do-storage/
├── wrangler.jsonc          # bindings: R2_PROBE / KV_PROBE / D1_PROBE / DO_PROBE
├── package.json            # type: module; deps: @cloudflare/workers-types only
├── src/
│   ├── worker.ts           # fetch handler + route table
│   ├── do/
│   │   └── ProbeDO.ts      # 1 个 DO class，承载 transactional 测试
│   ├── probes/
│   │   ├── r2-multipart.ts
│   │   ├── r2-list-cursor.ts
│   │   ├── kv-stale-read.ts
│   │   ├── do-transactional.ts
│   │   ├── mem-vs-do.ts
│   │   ├── d1-transaction.ts
│   │   ├── bash-platform.ts
│   │   └── bash-curl-quota.ts
│   └── result-shape.ts     # 与 finding template 字段对齐的 result schema
└── scripts/
    ├── deploy.sh           # wrangler deploy
    ├── run-all-probes.sh   # 顺次调用 9 路由 + 写入 .out/{date}.json
    └── extract-finding.ts  # 把 .out 转成 finding doc 草稿
```

### 3.4 聚合：与 finding template 的对齐

`result-shape.ts` 必须输出能直接喂 `_TEMPLATE-spike-finding.md` §1.2 + §6.1 的字段：

```ts
export interface ProbeResult {
  validationItemId: string;        // → finding §0
  observations: ProbeObservation[]; // → finding §1.2
  timings: { p50Ms: number; p99Ms: number; samplesN: number };  // → finding §1.2
  errors: ProbeError[];            // → finding §6.1
  rawSamples: unknown[];           // → finding §6.1
}
```

---

## 4. 8 项验证的具体设计

### 4.1 V1-storage-R2-multipart

**Probe 操作**：
1. 上传 1KB / 100KB / 1MB / 5MB / 10MB / 100MB / 1GB 的 deterministic blob（PRNG seed = validationItemId hash）
2. 测量每档的 success / failure / latency
3. 失败时记录是否触发 multipart upload 协议、partial upload 状态、retry 行为

**预期 finding 维度**：
- single-part 上限（推测 5MB 但需验证）
- multipart 启用阈值
- partial failure 后的 cleanup 行为
- `r2Put` 接口签名是否需要 multipart-aware

### 4.2 V1-storage-R2-list-cursor

**Probe 操作**：
1. 预填 1500 个 deterministic key 到 probe namespace
2. 不带 cursor 调用 `list({ limit: 1000 })` → 观察返回 keys 数 + truncated 标志 + cursor 形态
3. 用返回 cursor 继续调用直到 `truncated === false`
4. 测量分页总耗时与 page size 实际上限

**预期 finding 维度**：
- 单次 list 实际上限（假设 1000）
- truncated / cursor 字段的实际命名
- `r2List` 接口必须新增 cursor 入参与 next-cursor 返回

### 4.3 V1-storage-KV-stale-read

**Probe 操作**：
1. `put(key, v1)` → 立即 `get(key)` × 100 次（spread across 1s）→ 统计 stale 与 fresh 比例
2. `put(key, v1)` → 等 100ms / 500ms / 1s / 5s 后 `get(key)` → 找出 fresh window 的下界
3. 跨 region replication 的影响（如果 wrangler tail 能观测）

**预期 finding 维度**：
- stale-read window 的 P99 数字
- 是否提供 strong-read 选项（API 文档查不到，需 spike 实测）
- `kvGet` 接口是否需要标注 freshness guarantee

### 4.4 V1-storage-DO-transactional

**Probe 操作**：
1. 在 `ProbeDO` 内 `state.storage.transaction(async tx => { ... })`
2. 跑 3 类场景：成功 commit / 主动 abort / throw 触发 rollback
3. 跨 transaction + KV 写入的混合操作（验证 transaction 不覆盖 KV 写）

**预期 finding 维度**：
- transaction abort 的具体语义
- 与 KV / R2 跨 binding 协作时事务边界停在哪
- `WorkspaceNamespace.atomicWrite` 假设是否成立

### 4.5 V1-storage-Memory-vs-DO

**Probe 操作**：
1. 跑同一组 fake-bash mkdir / write / cp / mv / rm 序列
2. 一次用 `MemoryBackend`（spike 本地 in-memory mock）
3. 一次用真实 DO storage
4. 对比每步后的 state hash + 列出差异

**预期 finding 维度**：
- 顺序保证差异
- 原子性差异
- 容量上限触发点（DO 128MB memory）
- `MemoryBackend` 的哪些行为在 production DO 上**不**成立

### 4.6 V1-storage-D1-transaction

**Probe 操作**：
1. 单 query `SELECT 1; SELECT 2;` batch
2. 多 query 之间的"事务"假设：先 `INSERT`，断开，再 `SELECT`，看是否能回滚
3. 测试 D1 batch API 的 atomic 范围

**预期 finding 维度**：
- D1 是否支持跨 query 事务（推测：否）
- batch API 的真实 atomic 边界
- 对 `storage-topology/src/refs.ts` 假设 D1 manifest 的影响

### 4.7 V2A-bash-capability-parity（GPT review §2.4 修订）

> **修订说明（2026-04-19, GPT review §2.4 反馈）**：v1 把 V2 写成 "shell stress probe"，与当前 `capability-runtime` 真实 handler 行为脱节。v2 把 V2 拆为 **V2A capability-parity probe**（验证当前 handler contract 在真实 DO 沙箱里成立）+ **V2B platform-stress probe**（验证 Worker runtime 边界）。本节是 V2A。

**目标**：验证 `packages/capability-runtime/src/capabilities/` 当前 handler 的 contract 在真实 DO 沙箱中**保持不变**。这是 capability-runtime → real worker 的 handler-parity gate。

**Probe 操作**（按 capability handler 真实语义）：

| Capability | 真实 handler 语义（来自代码） | Probe 测试 |
|---|---|---|
| `mkdir` | `MKDIR_PARTIAL_NOTE = "mkdir-partial-no-directory-entity"` (`filesystem.ts:53`); 仅 ack-create prefix，无目录 entity | mkdir 任意路径 → 验证是否真实返回 partial note；后续 `ls` 是否能看到 prefix |
| `mkdir` reserved namespace | `/_platform/**` 是保留命名空间 (`filesystem.ts:9`) | 写入 `/_platform/x` → 验证拒绝 + 错误形态 |
| `rg` (search) | `WorkspaceFsLike.listDir/readFile` 递归；inline cap `200 lines / 32KB` | 验证 cap 触发 + 截断行为 + reserved namespace 静默跳过 |
| `cat` | 通过 `readFile` API 读取 | 验证大文件 read 行为：是否分块、是否触发 listDir-probe fallback |
| `write` | 写入 workspace；走 `resolveWorkspacePath` | 验证路径归一化 / reserved namespace 拒绝 |
| `curl` | `CURL_NOT_CONNECTED_NOTE` 默认 stub | 验证 not-connected 标记保持 |

**预期 finding 维度**（capability-parity）：
- 当前 handler contract 在真实 DO 沙箱中**仍然成立**——如果不成立，是 packages/ contract bug
- mkdir partial note 是否仍是合适的 disclosure 格式（vs 真实需要直接返回 error）
- rg cap (200 lines/32KB) 是否在真实大目录下需要调整
- reserved namespace `/_platform/**` 是否需要在真实 binding 上用更强的 enforcement

### 4.8 V2B-bash-platform-stress（GPT review §2.4 修订）

> **修订说明**：本节专注 Cloudflare Worker runtime 边界，与 capability handler contract 解耦。

**目标**：验证 Worker runtime 的 memory / cpu / subrequest 边界，作为 fake-bash 扩展（Phase 2）的 quota guard 设计输入。

**Probe 操作**：

| 维度 | Probe |
|---|---|
| Memory | 通过 `write` capability 写入 1MB / 10MB / 100MB blob，监控 DO state.storage 与 Worker memory 是否触发 OOM |
| CPU ms | rg 在 1000 / 5000 / 10000 文件目录上的 wall-clock；找出 50ms cpu_ms 上限触发点 |
| Subrequest | 通过 `curl` 发起 N 次 outbound fetch（N = 10/50/100/500），找出 subrequest 上限 |
| List exhaustion | `listDir` 在 10000+ entries 目录的 enumeration 行为 |

**预期 finding 维度**（platform-stress）：
- DO memory 上限实际触发点（推测 128MB 但需实测）
- cpu_ms 50ms 在 rg / cat / ls 各场景的等价"工作量"（多少行 / 多少文件）
- subrequest 上限对 curl 接通的影响（→ Phase 2 capability-runtime 必须强制 quota guard）
- 这些数字将作为 Phase 2 fake-bash extension 的 budget policy 输入

> **V2A 与 V2B 的区分准则**：V2A finding 主要 writeback 到 `capability-runtime/src/capabilities/*` 的 handler contract；V2B finding 主要 writeback 到 Phase 2 的 quota guard 与 Phase 3 的 budget policy。

### 4.9 V2-bash-curl-quota

**Probe 操作**：
1. curl `https://example.com/` × N 次（N = 50, 100, 200, 500, 1000）
2. 测试单 turn 内最大 outbound subrequest 数
3. 测试单 turn 内总 outbound payload bytes 上限
4. 失败时具体的 error code / 503 / quota-exceeded 形态

**预期 finding 维度**：
- 单 worker 最大 subrequest 数（Cloudflare 文档说 50 / Bundled，但需实测）
- 总 outbound payload 上限
- `curl` 接通时是否需要在 capability runtime 强制 quota guard

---

## 5. wrangler.jsonc 结构（草案）

```jsonc
{
  "name": "spike-do-storage",
  "main": "src/worker.ts",
  "compatibility_date": "2026-04-19",
  "durable_objects": {
    "bindings": [
      { "name": "DO_PROBE", "class_name": "ProbeDO" }
    ]
  },
  "kv_namespaces": [
    { "binding": "KV_PROBE", "id": "<spike-only-kv-id>" }
  ],
  "r2_buckets": [
    { "binding": "R2_PROBE", "bucket_name": "spike-do-storage-probe" }
  ],
  "d1_databases": [
    { "binding": "D1_PROBE", "database_name": "spike_probe", "database_id": "<spike-only-d1-id>" }
  ],
  "vars": {
    "ENVIRONMENT": "spike-r1-bare-metal",
    "EXPIRATION_DATE": "2026-08-01"
  }
}
```

> **纪律对齐**：所有 namespace / bucket / database 必须独立于 production；`EXPIRATION_DATE` 是 spike 自我标记，不是 Cloudflare 字段。

---

## 6. Finding 产出流程（GPT review §2.5 修订：two-tier deliverable）

> **修订说明（2026-04-19, GPT review §2.2 + §2.5 反馈）**：v1 写"10 条 ProbeResult"含数字漂移，且没有 rollup 步骤。v2 明确：probe 路由 9 个 → 9 条 required findings（每 validation item 至少 1 条）+ N 条 optional `unexpected-F*` finding；最后输出 1 份 `storage-findings.md` rollup index doc。

### 6.1 Per-finding docs（Tier 1）

1. 跑 `scripts/run-all-probes.sh` → 生成 `.out/YYYY-MM-DD.json`（**9 条 required ProbeResult** + 任意数量 `unexpected-*` ProbeResult）
2. 跑 `scripts/extract-finding.ts` → 为每个 ProbeResult 生成 `docs/spikes/spike-do-storage/{NN}-{slug}.md` 草稿（基于 `docs/templates/_TEMPLATE-spike-finding.md`）
3. 人工补全 finding 模板的 §2 root cause / §3 package impact / §4 worker-matrix impact / §5 writeback action
4. 提交 review；通过后 commit
5. Phase 1-3 的 design / action plan **必须显式 reference** 对应 finding ID

### 6.2 Rollup index docs（Tier 2，charter §4.1 A 第 4 项交付）

跑完所有 per-finding 后，必须输出 2 份 rollup（spike-do-storage 一份 spike 覆盖 storage + bash 两类 charter rollup）：

- `docs/spikes/storage-findings.md` —— 汇总 V1-storage-* 6 项 finding
- `docs/spikes/fake-bash-platform-findings.md` —— 汇总 V2-bash-* 3 项 finding（V2A + V2B + curl-quota）

每份 rollup 必须包含 P0-spike-discipline-and-validation-matrix §4.6 规定的 5 段：finding index / severity summary / writeback destination map / unresolved-dismissed summary / per-finding doc links。

> **第 3 份 charter rollup `docs/spikes/binding-findings.md` 由 spike-binding-pair 输出**（详见 P0-spike-binding-pair-design §6）。

---

## 7. Spike 执行的边界条件

### 7.1 数据隔离

- spike R2 bucket 名字必须含 `spike-` 前缀
- spike KV namespace 名字必须含 `spike-` 前缀
- spike D1 database 名字必须含 `spike_` 前缀
- spike worker 名字以 `spike-` 开头
- 任何 finding 中如出现貌似生产数据的内容，立即 review 是否纪律 5 被破坏

### 7.2 销毁条件

满足下面任一条件即销毁 spike-do-storage：

- 到达 `EXPIRATION_DATE`（2026-08-01）
- Phase 6 Round 2 integrated spike 已闭合
- **全部 9 条 required finding**（V1 6 项 + V2 3 项 = 9 个 validation item × 至少 1 条）已 `writeback-shipped` 或 `dismissed-with-rationale`；optional `unexpected-F*` finding **不**强制全部闭合，但出现的必须经过 finding template 流程

### 7.3 Cost 约束

- spike 总成本 < $20 / 月（R2 / KV / D1 / DO 都按 free tier）
- 不接 LLM API key
- 不持有任何业务数据

---

## 8. 与 plan-after-foundations charter 的对应关系

| Charter 章节 | 本 spike 对应 |
|---|---|
| §2.2 storage 6 项 + bash 项 | §4 全部（修订后 V2 拆为 V2A/V2B/curl-quota 共 3 项；charter §2.2 需同步修订为 6 storage + 3 bash = 9 项） |
| §4.1 A 第 1 / 3 / 4 项 | spike-do-storage 真实部署 + 9 验证项跑过 + 2 份 rollup findings doc（storage + fake-bash-platform） |
| §7.1 Phase 0 收口标准 | 至少 1 次 wrangler deploy 成功 + 9 项每项有 ≥ 1 条 finding + 至少 1 finding 触发 packages/ 修改 |
| §10.3 双向 traceability | §6 的 finding 流程强制 forward traceability；Phase 1-3 design 强制 backward traceability |

---

## 9. 收口标准（Exit Criteria）

本 spike 设计的成立标准：

1. ✅ **9 个 probe endpoint** 设计已对齐 §4 验证矩阵（V1 6 + V2A + V2B + V2-curl-quota）
2. ✅ wrangler.jsonc 结构与 §3.3 内部结构已可被 implementer 直接读取
3. ✅ 与 `docs/templates/_TEMPLATE-spike-finding.md` 字段对齐
4. ⏳ 实际部署后产出至少 9 条 required finding（每个 validation item ≥ 1 条）
5. ⏳ 至少 1 条 finding 推动 packages/ 文件修改（满足 charter §7.1 的 evidence 要求）
6. ⏳ 输出 2 份 rollup index doc：`docs/spikes/storage-findings.md` + `docs/spikes/fake-bash-platform-findings.md`（charter §4.1 A 第 4 项）
7. ⏳ Round 2 闭合时全部 required finding 落入 `writeback-shipped` / `dismissed-with-rationale`

---

## 10. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；定义 8 个 probe endpoint + finding 产出流程 + 销毁条件 |
| 2026-04-19 (r2) | Opus 4.7 | 基于 P0-reviewed-by-GPT.md §2.2 + §2.4 + §2.5 修订：(1) 修正 9 routes / 10 ProbeResult 计数为 9 required + N optional unexpected；(2) V2 拆分为 V2A capability-parity（对齐 filesystem.ts:53 mkdir partial-no-directory-entity）+ V2B platform-stress + V2-curl-quota；(3) §6 改为 two-tier deliverable (per-finding + 2 份 rollup)；(4) §9 收口标准从 8 改为 9 required + 2 rollup |
