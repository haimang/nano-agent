# Nano-Agent 行动计划 — RH4 Filesystem R2 Pipeline and Lane E

> 服务业务簇: `real-to-hero / RH4`
> 计划对象: `把 files/artifacts 从内存占位推进到真实 R2 持久化，并让 agent-core 切到 context/filesystem RPC-first；执行 Lane E consumer migration ≤ 2 周 sunset`
> 类型: `add + update + migration + remove`
> 作者: `Owner + Opus 4.7`
> 时间: `2026-04-29`
> 文件位置:
> - `workers/orchestrator-core/migrations/010-session-files.sql`
> - `workers/filesystem-core/src/{index,artifacts}.ts`
> - `packages/storage-topology/src/adapters/{r2,kv,d1}-adapter.ts`（**canonical adapter 位置**；`workers/filesystem-core/src/storage/adapters/` 是同内容副本，本 plan 显式从 storage-topology 包消费 via workspace dep，避免双源漂移）
> - `workers/agent-core/src/host/do/nano-session-do.ts`
> - `workers/agent-core/wrangler.jsonc`
> - `workers/orchestrator-core/src/{index,user-do}.ts`
>
> 📝 **行号引用提示**：行号截至 2026-04-29 main 分支快照；以函数 / 接口名为锚点。
>
> 📝 **业主已签字 QNA**：业主同意 RHX-qna Q2 (Lane E sunset ≤ 2 周 + 4 限定)。本 plan 全程按此执行。
> 上游前序 / closure:
> - `docs/action-plan/real-to-hero/RH2-models-context-inspection.md` 完成
> - `docs/action-plan/real-to-hero/RH3-device-auth-gate-and-api-key.md` 完成（auth gate + tenant namespace 配套）
> - `docs/charter/plan-real-to-hero.md` r2 §7.5
> 下游交接:
> - `docs/action-plan/real-to-hero/RH5-multi-model-multimodal-reasoning.md`（image upload 真实可用）
> 关联设计 / 调研文档:
> - `docs/design/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md`（含 §9 修订 + KV 职责限定）
> 冻结决策来源:
> - `docs/design/real-to-hero/RHX-qna.md` Q2（业主同意 ≤2 周 sunset + 4 项限定：起点=prod 启用日 / `@deprecated`+ESLint 阻止新引用 / 失败不 silent fallback / 到期物理删除）
> 文档状态: `executed`

---

## 0. 执行背景与目标

filesystem-core 当前是 **hybrid（WorkerEntrypoint 已建 + fetch 仍 401 + InMemoryArtifactStore + binding commented）**。设计审查同时确认：`storage/adapters/{r2,kv,d1}-adapter.ts` 已是 484 行生产级实现，RH4 的 storage 工作不是"实装适配器"，而是**组装到 ArtifactStore 接口 + 启用 binding + 关 hybrid 残留**。RH4 同时要在 ≤2 周 sunset 内完成 agent-core 从 library import 到 RPC-first 的 Lane E migration。

- **本次计划解决的问题**：
  - artifact 仍在内存
  - filesystem-core fetch 仍 401，library_worker:true 残留
  - agent-core CONTEXT_CORE/FILESYSTEM_CORE binding 注释
  - `POST /sessions/{id}/files` multipart upload 路径不存在
  - `GET /files/{file_uuid}/content` 不返字节
- **本次计划的直接产出**：
  - migration 010-session-files.sql（`nano_session_files` metadata 表）
  - `SessionFileStore` 新 async 接口（不复用 sync `ArtifactStore`）；内部消费 `packages/storage-topology` 的 r2/d1 adapter
  - filesystem-core hybrid 残留收口（fetch 401 + library_worker 标志移除）
  - agent-core wrangler.jsonc 启用 CONTEXT_CORE/FILESYSTEM_CORE binding
  - agent-core RPC-first dual-track（含 env flag + sunset 日历）
  - `POST/GET /files` multipart pipeline + tenant namespace
- **本计划不重新讨论的设计结论**：
  - dual-track sunset ≤ 2 周（来源：RHX Q2，业主同意 + 4 限定）
  - R2 = binary 冷真相；D1 = metadata 冷真相；KV = 仅可选 cache/idempotency/hot index（来源：design RH4 §5.1）
  - 不做 3-step presigned upload（来源：design RH4 §5.2 [O1]）
  - 不做 prepared artifact 真处理（[O2]）
  - tenant namespace = `tenants/{teamUuid}/sessions/{sessionUuid}/files/{fileUuid}`（[S5]）

---

## 1. 执行综述

### 1.1 总体执行方式

RH4 采用 **schema → adapter audit → SessionFileStore → filesystem-core RPC → binding 启用 → upload pipeline → sunset → cleanup**：先在 P4-A 显式 audit `packages/storage-topology` 与 `workers/filesystem-core/src/storage/` 两处 adapter 是否仍为 byte-identical（截至 2026-04-29 是），决定本 phase 统一从 `packages/storage-topology` 包消费；冻 D1 metadata 表与 R2 key namespace；filesystem-core 先以 leaf worker 的 RPC 形态工作（`SessionFileStore` 通过 workspace dep 消费 canonical adapter）；agent-core 启 binding 后 dual-track（env flag），实际生产以 RPC-first；sunset 时间盒满后 PR 物理删除 library import；然后做 multipart upload + list + download 的 façade pipeline。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 依赖 |
|------|------|------|------|
| Phase 1 | Migration 010 + R2 Key Namespace 冻结 | S | RH3 closure |
| Phase 2 | SessionFileStore 实现（async 新接口 + adapter 来源对账） | M | Phase 1 |
| Phase 3 | filesystem-core RPC Surface 收口 | M | Phase 2 |
| Phase 4 | agent-core CONTEXT_CORE/FILESYSTEM_CORE binding 启用 + RPC-first dual-track | M | Phase 3 |
| Phase 5 | Multipart Upload Pipeline (P4-A) | L | Phase 4 |
| Phase 6 | List + Download | M | Phase 5 |
| Phase 7 | Lane E Sunset Cutover | S | Phase 4 上线 ≥ 2 周 |
| Phase 8 | E2E + Preview Smoke | M | Phase 5-7 |

### 1.3 Phase 说明

1. **Phase 1**：D1 metadata + R2 key 是后续所有 phase 的下层
2. **Phase 2**：复用已建 adapter 的组装层，是 R4 storage 主体
3. **Phase 3**：把 hybrid 残留 fetch 401 改为 200 health-only + RPC 业务化；RPC op surface 给出真实 read/write/list 实装
4. **Phase 4**：agent-core 启用 binding；env flag 驱动 RPC-first；保留 library import 直到 sunset
5. **Phase 5**：façade multipart 真接 R2+D1
6. **Phase 6**：list/download path 完成
7. **Phase 7**：sunset 起点 = Phase 4 prod 启用日；满 2 周后单 PR 删除 library import
8. **Phase 8**：preview smoke 含跨 team 拒绝

### 1.4 执行策略

- **执行顺序**：schema → adapter 组装 → leaf worker 收口 → consumer 切换 → ingress → sunset → e2e
- **风险控制**：sunset 期间 RPC-first 失败必须 throw（RHX Q2 限定 3）；不允许 silent fallback library
- **测试**：每 endpoint ≥5；upload e2e；多 tenant 拒绝 e2e
- **文档**：`docs/api/files-api.md` 新建；sunset 日历加 `docs/owner-decisions/lane-e-sunset.md`
- **回滚**：sunset 到期前可 env flag 回退到 library；到期后只能 hot-fix 不能回退

### 1.5 影响结构图

```text
RH4 Filesystem & Lane E
├── Phase 1: schema
│   └── migrations/010-session-files.sql
├── Phase 2: R2ArtifactStore
│   └── workers/filesystem-core/src/artifacts.ts
├── Phase 3: filesystem-core RPC
│   └── workers/filesystem-core/src/index.ts
├── Phase 4: agent-core binding
│   ├── workers/agent-core/wrangler.jsonc (uncomment)
│   └── workers/agent-core/src/host/do/nano-session-do.ts:353
├── Phase 5: upload pipeline
│   └── workers/orchestrator-core/src/{index,user-do}.ts
├── Phase 6: list + download
│   └── 同上
├── Phase 7: sunset cutover
│   └── workers/agent-core/src/host/runtime-mainline.ts (delete library import)
└── Phase 8: e2e + smoke
    └── docs/issue/real-to-hero/RH4-evidence.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope

- **[S1]** migration 010-session-files.sql：`nano_session_files (file_uuid PK, session_uuid, team_uuid, r2_key, mime, size_bytes, created_at, ...)`
- **[S2]** **`SessionFileStore` 新接口**（**不**叫 `R2ArtifactStore` 也**不**复用现有 sync `ArtifactStore` 接口；当前 `filesystem-core/src/artifacts.ts:27-32` 的 `ArtifactStore` 是 sync metadata registry 接口（`register/get/list/listByKind`），不适合 async 业务存储 —— 强行 `implements ArtifactStore` 会 TS 类型不兼容或语义破坏）；新接口签名：`async put(file)`/`async get(file_uuid)`/`async head(file_uuid)`/`async delete(file_uuid)`/`async list({sessionUuid, teamUuid, cursor})`；内部组装 `packages/storage-topology/src/adapters/{r2,d1}-adapter.ts`（canonical 位置）+ atomic 失败 cleanup
- **[S3]** filesystem-core fetch 路径仅暴露 `/health`；`bindingScopeForbidden` 改为 200 health；`library_worker:true` 标志移除
- **[S4]** filesystem-core RPC ops：`readArtifact`、`writeArtifact`、`listArtifacts` 真实读写 R2+D1
- **[S5]** agent-core wrangler.jsonc 启用 CONTEXT_CORE + FILESYSTEM_CORE binding
- **[S6]** agent-core RPC-first dual-track（env flag `LANE_E_RPC_FIRST=true`）
- **[S7]** `POST /sessions/{id}/files` multipart：单文件 **≤ 25MiB（first-wave 产品策略：兼顾 WeChat / 浏览器 multipart body / DO memory；不是 R2 adapter 限制）**。R2 adapter 的 `maxValueBytes` 默认 100MiB（10MiB 已 probe-verified，100MiB 是 soft guard），25MiB 是 KV adapter 的限制；本 phase 选 25MiB 作为产品上限，与 KV adapter 兼容
- **[S8]** `GET /sessions/{id}/files` list（参考 `nano_session_files` D1 + cursor）
- **[S9]** `GET /sessions/{id}/files/{file_uuid}/content`：从 R2 读字节，并校验 team_uuid + session_uuid
- **[S10]** R2 key namespace 严格 `tenants/{teamUuid}/sessions/{sessionUuid}/files/{fileUuid}`
- **[S11]** Lane E sunset：env flag 启用 ≥ 2 周后单 PR 删除 library import；同时打 `@deprecated` + ESLint `no-restricted-imports` rule

### 2.2 Out-of-Scope

- **[O1]** 3-step presigned upload → polish/hero
- **[O2]** prepared artifact 真处理（resize/pdf/audio）→ hero
- **[O3]** per-tenant dedicated bucket → 更大规模租户需求
- **[O4]** filesystem-core public ingress（保持 leaf）

### 2.3 边界判定表

| 项目 | 判定 | 理由 |
|------|------|------|
| KV 复制 D1 metadata | out-of-scope | KV 仅 cache/idempotency |
| 单文件 > 25MiB | out-of-scope first-wave | first-wave 产品上限 25MiB；> 25MiB 留 polish phase 引入 R2 multipart upload |
| filesystem-core 暴露 public route | out-of-scope | 保持 leaf |
| dual-track 永久并存 | out-of-scope | sunset ≤ 2 周硬纪律 |

---

## 3. 业务工作总表

| 编号 | Phase | 工作项 | 类型 | 文件 | 风险 |
|------|-------|--------|------|------|------|
| P4-01 | 1 | migration 010 | add | `migrations/010-session-files.sql` | medium |
| P4-02 | 1 | R2 key namespace 文档化 | add | `docs/architecture/r2-namespace.md` | low |
| P4-02b | 2 | adapter 来源对账（packages/storage-topology vs filesystem-core/src/storage/） | audit | 两处 adapter 文件 byte diff | 确认仍 byte-identical 后选择 packages/storage-topology 为 canonical 消费源；如已分叉则需先合并 | low |
| P4-03 | 2 | SessionFileStore 实现 | add | `filesystem-core/src/artifacts.ts`（新增 class，**不**改原 `ArtifactStore` 接口）+ workspace dep 引入 storage-topology | medium |
| P4-04 | 3 | filesystem-core fetch 收口 | update | `filesystem-core/src/index.ts:50-85` | medium |
| P4-05 | 3 | filesystemOps 真业务实装 | update | 同上 | medium |
| P4-06 | 4 | wrangler.jsonc binding 启用 | update | `agent-core/wrangler.jsonc:43-50` | medium |
| P4-07 | 4 | RPC-first env flag + dual-track | add | `agent-core/src/host/do/nano-session-do.ts:353` 等 | high |
| P4-08 | 5 | multipart upload handler | add | `orchestrator-core/src/index.ts` + `user-do.ts:1651-1699` 改写 | high |
| P4-09 | 6 | list handler | add | 同上 | medium |
| P4-10 | 6 | download handler | add | 同上 | medium |
| P4-11 | 7 | sunset PR：删除 library import | remove | `agent-core/src/host/runtime-mainline.ts` 等 | medium |
| P4-12 | 7 | sunset 起点冻结到 owner-decisions doc | manual | `docs/owner-decisions/lane-e-sunset.md` | low |
| P4-13 | 8 | upload/list/download endpoint test ≥5×3 | add | test files | low |
| P4-14 | 8 | 跨 team 拒绝 e2e | add | `test/cross-e2e/file-cross-tenant.e2e.test.ts` | medium |
| P4-15 | 8 | preview smoke + 归档 | manual | `docs/issue/real-to-hero/RH4-evidence.md` | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Migration + Namespace

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P4-01 | migration 010 | `CREATE TABLE nano_session_files (file_uuid TEXT PK, session_uuid TEXT NOT NULL, team_uuid TEXT NOT NULL, r2_key TEXT NOT NULL, mime TEXT, size_bytes INTEGER, original_name TEXT, created_at INTEGER NOT NULL, INDEX(session_uuid), INDEX(team_uuid))` | `migrations/010-session-files.sql` | apply 全绿 |
| P4-02 | R2 namespace doc | 写 `docs/architecture/r2-namespace.md`：`tenants/{teamUuid}/sessions/{sessionUuid}/files/{fileUuid}` 严格命名规则 + 跨 tenant 拒绝逻辑 | new file | 文档 ≥1KB |

### 4.2 Phase 2 — SessionFileStore

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P4-02b | adapter 来源对账 | `diff packages/storage-topology/src/adapters/r2-adapter.ts workers/filesystem-core/src/storage/adapters/r2-adapter.ts`（kv/d1 同样）；如 byte-identical（截至 2026-04-29 是），新接口直接消费 `packages/storage-topology`；如已分叉，先合并到 canonical 后再继续 | adapter 文件 | diff 结果 + 选择记录入 PR description |
| P4-03 | SessionFileStore | 新建 `class SessionFileStore`（**不** `implements ArtifactStore` —— 后者是 sync metadata registry 接口，签名不兼容）；签名 `async put({sessionUuid, teamUuid, file_uuid, mime, bytes, original_name}): Promise<{file_uuid, r2_key, size_bytes}>` / `async get(file_uuid, {teamUuid, sessionUuid})` / `async head(file_uuid, {teamUuid, sessionUuid})` / `async delete(file_uuid, {teamUuid, sessionUuid})` / `async list({sessionUuid, teamUuid, cursor})`；`put` 调 `R2Adapter.put` + `D1Adapter` 写 metadata；strict atomic（先 R2 后 D1，D1 失败则 R2 delete cleanup）；`InMemoryArtifactStore` 与 sync `ArtifactStore` 接口保留为 testing fixture / metadata registry 用途，不被替换 | `filesystem-core/src/artifacts.ts`（新增 class）+ workspace dep 引入 `@nano-agent/storage-topology` | unit test：≥5 case（put/get/list/cross-tenant-deny/atomic-rollback）|

### 4.3 Phase 3 — filesystem-core RPC 收口

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P4-04 | fetch 收口 | `bindingScopeForbidden()` → 保持 401（leaf worker 不暴露 public ingress 是 charter §4.5 设计）；**仅移除 `library_worker:true` 标志**（标 library 不再准确）；`/health` 仍开放；**context-core 联动**：context-core 同样有 `library_worker` 标记，本 phase 同步移除（context-core 在 RH2 Phase 3 已暴露真业务 RPC method `getContextSnapshot/triggerCompact/triggerContextSnapshot`，因此也不再是 library-only） | `filesystem-core/src/index.ts:50-85` + `context-core/src/index.ts` library_worker 标志 | filesystem-core / context-core 两处 library_worker 标志移除；non-`/health` 路径仍 401（leaf worker 设计） |
| P4-05 | filesystemOps 实装 | `readArtifact`/`writeArtifact`/`listArtifacts` 不再仅返回 op name list，而是真实业务调 R2ArtifactStore；带 authority/team context 验证 | 同上 | RPC unit test ≥5 |

### 4.4 Phase 4 — agent-core binding + dual-track

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P4-06 | binding uncomment | `agent-core/wrangler.jsonc:43-50` 启用 CONTEXT_CORE + FILESYSTEM_CORE service binding | `agent-core/wrangler.jsonc` | dry-run 通过；agent-core 启动后 env 含 binding |
| P4-07 | dual-track + env flag | 新增 env var `LANE_E_RPC_FIRST` (default `false` for safety in initial deploy；prod 启用日 set `true`)；nano-session-do.ts:353 替换 `new InMemoryArtifactStore()` 为：`env.LANE_E_RPC_FIRST ? new RemoteArtifactStore(env.FILESYSTEM_CORE) : <library import path>`；同时给 library import 打 `@deprecated`；ESLint `no-restricted-imports` 阻止新增引用 | `nano-session-do.ts:353` + ESLint config | unit + integration：flag on 走 RPC，flag off 走 library |

### 4.5 Phase 5 — Multipart Upload

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P4-08 | upload handler | `POST /sessions/{id}/files`：解析 multipart；校验 session 属于 user team；构造 `r2_key = tenants/{teamUuid}/sessions/{sessionUuid}/files/{fileUuid}`；调 R2ArtifactStore.put；返回 `{file_uuid, size_bytes, mime}` | `orchestrator-core/src/index.ts` route + `user-do.ts:1651-1699` 重写 handler | endpoint test ≥5：happy / 401 / cross-team-403 / oversize / invalid mime |

### 4.6 Phase 6 — List + Download

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P4-09 | list | `GET /sessions/{id}/files`：D1 query + cursor；返回 `{files: [{file_uuid, mime, size_bytes, ...}], next_cursor}` | 同上 | endpoint test ≥5 |
| P4-10 | download | `GET /sessions/{id}/files/{file_uuid}/content`：D1 lookup → 验证 team/session → R2 stream 字节；Content-Type 来自 D1 mime | 同上 | endpoint test ≥5（含 Range request 不支持的 negative case 留 polish）|

### 4.7 Phase 7 — Sunset Cutover

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P4-11 | sunset PR | Phase 4 prod 启用日 + 14 天后单独 PR：删除 library import；删除 InMemoryArtifactStore 在 agent-core 的引用；`workspace-context-artifacts` 中保留 canonical（其他 worker 仍可能用到）；env flag 从可配改为 hard `true`（或直接删除条件分支） | `agent-core/src/host/do/nano-session-do.ts` + 相关 import 链 | grep 全代码库 0 library import；ESLint rule 不再需要 |
| P4-12 | sunset 日历 | 业主在 `docs/owner-decisions/lane-e-sunset.md` 写明 prod 启用日 + 应到期日（+14d）+ 实际删除日（PR link）+ 期间 RPC failure 监控数据 | new file | 文档 ≥1KB |

### 4.8 Phase 8 — E2E + Preview Smoke

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P4-13 | endpoint tests | 3 endpoint × 5 case = 15 case | test files | 全绿 |
| P4-14 | cross-tenant 拒绝 e2e | team A upload → team B 尝试 list/download → 403 | `test/cross-e2e/file-cross-tenant.e2e.test.ts` | 通过 |
| P4-15 | preview smoke | preview deploy → 业主 manual upload 1MB image + list + download；浏览器 + wechat-devtool 各 1 | `docs/issue/real-to-hero/RH4-evidence.md` | 文档 ≥1KB + 截图 |

---

## 5. Phase 详情

### 5.1 Phase 1

- **风险**：team_uuid 必须在 every metadata row，避免 cross-tenant 漏洞
- **测试**：apply + rollback test（虽然 forward-only，但要确保新表存在）

### 5.2 Phase 2

- **核心**：R2ArtifactStore 是 RH4 的主体；务必在 `put` 失败时 cleanup 已写 R2 对象（atomic）
- **风险**：D1 写入失败而 R2 已写入会留 orphan binary；用 `try {R2.put} catch / {D1 写入} catch {R2.delete}` 模式

### 5.3 Phase 3

- **核心**：filesystem-core hybrid 残留收口
- **风险**：fetch 改为 200 health 可能影响其他 worker 健康检查；保持 `/health` 路径不变

### 5.4 Phase 4

- **核心**：dual-track 启动；env flag = "RPC-first 启用日"标记
- **风险**：flag 默认 false 是为了 deploy 安全性；prod 启用必须由业主单 PR 显式设 true 并加注 sunset 日历

### 5.5 Phase 5

- **风险**：multipart 解析在 Workers runtime 内有限制；25MB 上限来自 R2 putParallel
- **回归**：handleFiles 重写后旧的 D1 history-only 行为消失，但当前 `handleFiles` 实际上没有 production usage（charter §1.2 已注 metadata-only stub），不破坏 client

### 5.6 Phase 6

- **风险**：跨 tenant 拒绝必须先 D1 lookup 再 R2 read，避免 r2_key 泄漏

### 5.7 Phase 7 — Sunset

- **核心**：RHX Q2 4 项限定全部落地
- **业主签字**：sunset 起点必须由业主在 `lane-e-sunset.md` 显式写日期；+14 天到期当天 implementer 必须发起删除 PR

### 5.8 Phase 8

- **核心**：cross-tenant evidence 是 closure 硬要求

---

## 6. 依赖的冻结决策

| 决策 | 来源 | 影响 |
|------|------|------|
| RHX Q2 sunset ≤ 2 周 + 4 限定 | RHX-qna Q2 | Phase 4-7 全部按此 |
| KV 仅 cache / D1 + R2 是冷真相 | design RH4 §5.1 | Phase 2 atomic write 不写 KV |
| migration 编号 = 010 | charter §8.4 | Phase 1 锁定 |
| 不做 3-step presigned | design RH4 §5.2 | Phase 5 用 multipart 直传 |
| filesystem-core 保持 leaf | design RH4 §3.3 | Phase 3 无 public route |

---

## 7. 风险、依赖、完成后状态

### 7.1 风险

| 风险 | 描述 | 判断 | 应对 |
|------|------|------|------|
| atomic put 失败 orphan R2 | D1 写入失败而 R2 已 commit | high | try/catch + cleanup 模式 + observability alert |
| sunset 期间 RPC failure | RPC-first 路径在 prod 触发 5xx | high | 不允许 silent fallback；监控 alert；hot-fix 而非 fallback |
| binding 启用导致 cold-start latency | service binding warmup | medium | RH0 P0-G stress 已覆盖 |
| 跨 tenant 漏洞 | r2_key 泄漏或 D1 验证缺位 | high | tenant namespace + e2e 跨 team 拒绝必测 |

### 7.2 约束

- **技术前提**：RH3 closure；team_uuid 全链路稳定
- **运行时前提**：R2 quota（业主 P0-F 已验证）
- **组织协作**：业主 14 天后亲手发起 sunset PR；preview smoke 双端
- **上线**：Phase 4 prod 启用日由业主决定，写入 `lane-e-sunset.md`

### 7.3 文档同步

- `docs/api/files-api.md`
- `docs/architecture/r2-namespace.md`
- `docs/owner-decisions/lane-e-sunset.md`

### 7.4 完成后状态

1. artifact 真实持久化在 R2 + D1
2. filesystem-core 真业务化，hybrid 残留清零
3. agent-core 仅经 RPC 调 leaf worker，library import 路径删除
4. 客户端可上传 / 列 / 下载 ≤ 25MB 文件
5. RH5 image upload 真实可用

---

## 8. 整体测试与收口

### 8.1 整体测试

- **基础**：6 worker dry-run；既有测试不回归
- **单测**：R2ArtifactStore ≥10；filesystem-core RPC ≥5
- **集成**：upload/list/download e2e；cross-tenant 拒绝 e2e
- **端到端**：业主 preview manual upload + list + download
- **回归**：RH0/1/2/3 既有矩阵不破

### 8.2 整体收口

1. migration 010 部署
2. R2ArtifactStore atomic 5 case 全绿
3. filesystem-core 业务 RPC 5 case + hybrid 残留清零
4. agent-core binding 启用 + RPC-first dual-track
5. 3 endpoint × 5 case 全绿
6. cross-tenant 拒绝 e2e 通过
7. sunset PR 在 +14d 物理删除 library import
8. RH5 Per-Phase Entry Gate 满足

### 8.3 DoD

| 维度 | 完成定义 |
|------|----------|
| 功能 | upload/list/download live + Lane E migrated |
| 测试 | endpoint 15+ + cross-tenant + atomic e2e |
| 文档 | files-api / r2-namespace / lane-e-sunset |
| 风险收敛 | atomic 0 orphan；cross-tenant 0 漏 |
| 可交付性 | RH5 multimodal 可启动 |

---

## 11. 工作日志回填（executed）

> 执行日期: `2026-04-29`
> 关联闭合文件: `docs/issue/real-to-hero/RH4-closure.md`

本节按「schema / filesystem-core / façade / bindings / tests / preview」顺序回填 RH4 的实际落地内容；仅记录已经完成并验证过的改动，同时显式标注本轮未收口的 Lane E carry-over。

### 11.1 新增文件

| # | 文件路径 | 对应项 | 说明 |
|---|---|---|---|
| 1 | `workers/orchestrator-core/migrations/010-session-files.sql` | P4-01 | 新增 `nano_session_files` metadata 表与索引 |
| 2 | `workers/filesystem-core/test/session-file-store.test.ts` | P4-03 / P4-05 | `SessionFileStore` 原子写入 / 读取 / cursor / 隔离 / rollback |
| 3 | `test/package-e2e/orchestrator-core/10-files-smoke.test.mjs` | P4-13 / P4-15 | preview live upload/list/download smoke |
| 4 | `test/cross-e2e/14-files-cross-tenant-deny.test.mjs` | P4-14 | cross-tenant list/download deny |
| 5 | `docs/issue/real-to-hero/RH4-closure.md` | RH4 closure | 阶段闭合 memo |

### 11.2 关键修改文件

| 领域 | 文件 | 变更摘要 |
|---|---|---|
| filesystem store | `workers/filesystem-core/src/artifacts.ts` | 新增 `SessionFileStore`；R2 key=`tenants/{teamUuid}/sessions/{sessionUuid}/files/{fileUuid}`；D1 insert 失败时 cleanup R2；cursor 修正为“最后一条已返回记录” |
| filesystem RPC | `workers/filesystem-core/src/index.ts` | `writeArtifact` / `listArtifacts` / `readArtifact` 真实化；binding-scope 文案改成 leaf RPC worker |
| filesystem env | `workers/filesystem-core/src/types.ts` / `package.json` / `wrangler.jsonc` | 引入 `@nano-agent/storage-topology`；声明 `NANO_AGENT_DB` / `NANO_R2`；增加 RPC input/output types |
| façade routes | `workers/orchestrator-core/src/index.ts` | 新增 `/sessions/{id}/files` upload/list/content 三条真实路由；multipart parse；25 MiB 上限；session ownership 校验；filesystem-core RPC 调用 |
| façade tests | `workers/orchestrator-core/test/files-route.test.ts` | 从“User DO metadata stub”升级为 RH4 真实 façade 用例；`15` cases 覆盖 list/upload/content |
| leaf probes | `workers/context-core/src/{index,types}.ts` / `workers/context-core/test/smoke.test.ts` | 移除 `library_worker` 标志；binding-scope message 改为 leaf worker |
| agent binding | `workers/agent-core/wrangler.jsonc` | 启用 `CONTEXT_CORE` / `FILESYSTEM_CORE` preview+prod binding；增加 `LANE_E_RPC_FIRST=false` 基础变量 |
| live posture test | `test/cross-e2e/06-agent-filesystem-host-local-posture.test.mjs` | 跟随 RH4 真实姿态更新为 `filesystemBindingActive=true` |

### 11.3 测试与验证回填

| 命令 / 验证 | 结果 |
|---|---|
| `pnpm --filter @haimang/context-core-worker typecheck && build && test` | ✅ `19` files / `171` tests |
| `pnpm --filter @haimang/filesystem-core-worker typecheck && build && test` | ✅ `26` files / `299` tests |
| `pnpm --filter @haimang/orchestrator-core-worker typecheck && build && test` | ✅ `17` files / `158` tests |
| `pnpm --filter @haimang/agent-core-worker typecheck && build && test` | ✅ `100` files / `1062` tests |
| `bash scripts/deploy-preview.sh orchestrator-core filesystem-core context-core` | ✅ apply 010 + deploy 3 workers |
| `bash scripts/deploy-preview.sh agent-core` | ✅ deploy agent-core with Lane E bindings |
| `NANO_AGENT_LIVE_E2E=1 node --test test/cross-e2e/06-agent-filesystem-host-local-posture.test.mjs test/package-e2e/orchestrator-core/10-files-smoke.test.mjs test/cross-e2e/14-files-cross-tenant-deny.test.mjs` | ✅ `3/3` live tests |
| preview health probe | ✅ `/debug/workers/health` = `live: 6 / total: 6` |

### 11.4 Preview 执行结果

| 项 | 结果 |
|---|---|
| remote D1 apply | `010-session-files.sql` 成功执行 |
| `nano-agent-orchestrator-core-preview` | Version `342425b5-9d1c-4372-9195-aec938847104` |
| `nano-agent-filesystem-core-preview` | Version `ce5e5d26-6e8a-4e38-af0c-9236d59abfae` |
| `nano-agent-context-core-preview` | Version `3caf48da-5aa7-44cd-bf42-a98277064bed` |
| `nano-agent-agent-core-preview` | Version `411a2c9a-bd98-4cb9-bab3-2b5661603e01` |
| `/debug/workers/health` | `live: 6 / total: 6` |
| files smoke | upload → list → download 全链路通过 |
| cross-tenant deny | stranger 对 owner session 的 list / content 均 `403` |

### 11.5 本轮未一并闭合的 carry-over

1. `agent-core` 只完成了 `CONTEXT_CORE / FILESYSTEM_CORE` binding 激活；**没有**完成 `workspace-context-artifacts` → filesystem/context RPC-first 的真实 consumer cutover。
2. Phase 7 的 sunset（`@deprecated` / ESLint `no-restricted-imports` / +14d 删除 PR）未开始，因为 prod 启用日还没有 owner 冻结。
3. `docs/api/files-api.md`、`docs/architecture/r2-namespace.md`、`docs/owner-decisions/lane-e-sunset.md` 未在本轮创建。
