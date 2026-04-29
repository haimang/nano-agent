# Nano-Agent 功能簇设计模板

> 功能簇: `RH4 Filesystem R2 Pipeline and Lane E`
> 讨论日期: `2026-04-29`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告:
> - `docs/charter/plan-real-to-hero.md`
> - `docs/investigation/api-docs-after-ZX5-reviewed-by-GPT.md`
> 关联 QNA / 决策登记:
> - `docs/design/real-to-hero/RHX-qna.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

RH4 要解决的是 filesystem 仍停留在 **hybrid（WorkerEntrypoint 已建 + fetch 仍 401 + InMemoryArtifactStore + binding commented）** 的现实，把它推进成真实业务 RPC consumer：image/file upload 真正落 R2，metadata 真正落 D1，agent-core 真正通过 service binding 访问 context/filesystem worker。它同时也是 RH5 多模态输入成立的硬前置。**前置事实**：`workers/filesystem-core/src/storage/adapters/{r2,kv,d1}-adapter.ts` 已是 484 行生产级实现，RH4 的 storage 工作是"组装到 ArtifactStore 接口 + 启用 binding"，不是从零实装适配器。

- **项目定位回顾**：RH4 是 `real persistence + Lane E consumer migration`。
- **本次讨论的前置共识**：
  - 不新增 worker，Lane E migration 必须在现有 6-worker 内完成。
  - dual-track 可以短期存在，但必须有 owner 冻结的 sunset，见 `RHX-qna` Q2。
- **本设计必须回答的问题**：
  - 什么才算“filesystem-core 已从 library-only 变成业务 worker”？
  - R2 / KV / D1 / DO memory 四层之间各自负责什么？
- **显式排除的讨论范围**：
  - 3-step presigned upload
  - prepared artifact 的真实二次处理 pipeline

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`RH4 Filesystem R2 Pipeline and Lane E`
- **一句话定义**：`把 files/artifacts 从内存占位推进到真实 R2 持久化，并让 agent-core 切到 context/filesystem RPC-first。`
- **边界描述**：这个功能簇**包含** R2/KV/D1 持久化、filesystem-core 业务 RPC、agent-core bindings 解锁、multipart file upload、multi-tenant namespace；**不包含** presigned 3-step upload 与 prepared artifact 真正处理。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| Lane E | context/filesystem consumer migration | 从 library import 切到 service binding |
| RPC-first | agent-core 优先通过 WorkerEntrypoint RPC 调用 leaf worker | 允许短期 dual-track |
| file pipeline | upload -> metadata -> list -> content download | RH4 first-wave 完整链 |
| tenant namespace | `tenants/{teamUuid}/...` 级别的存储隔离 | 不是独立 bucket per tenant |

### 1.2 参考调查报告

- `docs/charter/plan-real-to-hero.md` — §7.5、§8.1、§12 Q2
- `docs/investigation/api-docs-after-ZX5-reviewed-by-GPT.md` — 当前 `/files` surface 与 code reality 漂移说明

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- RH4 在整体架构里扮演 **artifact persistence and worker cutover** 的角色。
- 它服务于：
  - client file upload / download
  - RH5 multimodal image input
  - context/filesystem leaf worker 的真正业务化
- 它依赖：
  - RH0 的 KV/R2/tooling 占位
  - RH1 已稳定的 runtime / relay
  - RHX-qna Q2 的 sunset 冻结
- 它被谁依赖：
  - RH5 多模态与 image_url
  - RH6 three-layer truth 冻结

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| context-core | RH4 <-> context | 中 | context snapshot 与 artifact store 共享 artifact truth |
| filesystem-core | RH4 -> filesystem | 强 | 从 library-only uplift 到真实业务 worker |
| RH5 Multi-model | RH4 -> RH5 | 强 | image upload 是 vision inference 的前提 |
| agent-core runtime | RH4 <-> agent-core | 强 | 要切到 RPC-first consumer |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`RH4 Filesystem R2 Pipeline and Lane E` 是 **把 artifact 能力从 demo 占位推进到真实持久化的 phase**，负责 **R2/D1 真持久化与 agent-core 的 RPC-first cutover**，对上游提供 **真实 file lifecycle**，对下游要求 **多模态和三层真相不再建立在内存假象上**。"

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| 继续保留 `InMemoryArtifactStore` 作为主路径 | 当前实现最省事 | 与 RH4 目标直接冲突 | 否 |
| 永久 dual-track | “先跑起来再说” 的诱因 | 会重演 library + RPC 永久并存反模式 | 否 |
| 3-step upload | 想一步做到“更标准” | 超出 RH4 first-wave 所需 | hero-to-platform/polish |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段 / 文档入口) | 第一版行为 | 未来可能的演进方向 |
|--------|--------------------------------------------------|------------|---------------------|
| filesystem RPC ops | `FilesystemCoreEntrypoint.filesystemOps()` | 最小读写列举能力 | 后续可扩 prepareArtifact 等 richer ops |
| upload surface | `POST /sessions/{id}/files` multipart | first-wave 直传 | 后续可演进为 3-step presigned |
| artifact metadata | D1 `nano_session_files` | list / content 所需最小字段 | 后续扩 prepared state / derived artifacts |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：artifact metadata vs artifact binary
- **解耦原因**：D1 适合 list/search/read model，R2 适合二进制本体。
- **依赖边界**：R2 只存内容，D1 存 metadata，DO/KV 不复制冷真相。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：filesystem-core RPC、R2 key namespace、multipart upload ingress
- **聚合形式**：全部经 façade + leaf worker + D1/R2 单一责任划分收敛
- **为什么不能分散**：否则 multi-tenant 隔离与 dual-track sunset 很难真正完成

---

## 4. 参考实现 / 历史 precedent 对比

### 4.1 当前 filesystem reality

- **实现概要**：filesystem-core 已有 WorkerEntrypoint 外形，但 fetch 仍只给 `/health`，RPC op list 仍是最小占位，artifact store 仍是 in-memory。
- **亮点**：
  - binding / RPC 形状已经有了
- **值得借鉴**：
  - 继续让 filesystem-core 作为 leaf worker，被 façade 和 agent-core 间接消费
- **不打算照抄的地方**：
  - 继续把它当 library-only worker

### 4.2 当前 agent-core reality

- **实现概要**：agent-core wrangler 里 CONTEXT_CORE / FILESYSTEM_CORE 仍注释，runtime 中仍实例化 `InMemoryArtifactStore`。
- **亮点**：
  - 已有 runtime seam 与 binding active flags
- **值得借鉴**：
  - 用 env flag 控制 cutover，而不是硬切不可回退
- **不打算照抄的地方**：
  - 长期同时维护 library import 与 RPC-first

### 4.3 RH4 的设计倾向

- **实现概要**：先做最小真实 file pipeline，再完成 Lane E cutover。
- **亮点**：
  - 只做 first-wave 必需能力
- **值得借鉴**：
  - R2 key namespace 强制带 teamUuid
- **不打算照抄的地方**：
  - 用裸 `file_uuid` 或全局平铺 key

### 4.4 横向对比速查表

| 维度 | 当前代码 | RH4 目标 | nano-agent 倾向 |
|------|----------|----------|------------------|
| artifact store | in-memory | R2 backed | 真持久化 |
| filesystem-core | library-only | business RPC worker | leaf worker active |
| agent-core consumer | library import | RPC-first | dual-track 过渡 |
| tenant isolation | 弱 | `tenants/{teamUuid}/...` | 强命名空间 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1]** **R2 + D1 冷真相 artifact persistence；KV 仅作可选短 TTL 缓存 / upload idempotency / hot index，不拥有冷真相，不作为 list source**（GPT R4 修订；charter §4.4 三层真相纪律）
- **[S2]** filesystem-core 业务 RPC 与 op surface（已建 WorkerEntrypoint hybrid，需把 fetch 401 / `library_worker:true` 残留收口）
- **[S3]** agent-core CONTEXT_CORE / FILESYSTEM_CORE binding 启用 + RPC-first dual-track
- **[S4]** `POST /sessions/{id}/files` multipart pipeline
- **[S5]** multi-tenant namespace 与 download/list 隔离（R2 key namespace `tenants/{teamUuid}/sessions/{sessionUuid}/files/{fileUuid}`；KV key 同样需要 teamUuid prefix 与 TTL/invalidation 规则）

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1]** 3-step presigned upload — first-wave 不需要；重评条件：polish
- **[O2]** prepared artifact 真处理（resize/pdf/audio）— 只留 stub；重评条件：hero-to-platform
- **[O3]** per-tenant dedicated bucket — 当前只做 key namespace；重评条件：更大规模租户隔离需求

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| `filesystemOps()` 只列 op 名 | in-scope 但不够 | 允许先保留最小自描述面，但 RH4 还要补真实实现 | RH4 |
| dual-track 长期保留 | out-of-scope | 违反 charter 硬纪律 | RHX-qna Q2 + RH4 |
| metadata 只放 KV 不落 D1 | out-of-scope | 无法做稳定 list/read model | RH4 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **multipart 直传 first-wave** 而不是 **直接做 3-step presigned**
   - **为什么**：先把真实持久化闭环跑通，比先做更复杂上传协议更重要。
   - **我们接受的代价**：大文件与直传体验不是最终形态。
   - **未来重评条件**：polish / hero-to-platform。

2. **取舍 2**：我们选择 **RPC-first + 短期 dual-track** 而不是 **一次硬切** 或 **长期双轨**
   - **为什么**：硬切风险高，长期双轨又会留下永久技术债。
   - **我们接受的代价**：RH4 需要额外治理 sunset。
   - **未来重评条件**：无。

3. **取舍 3**：我们选择 **tenant namespace in one bucket** 而不是 **per-tenant bucket**
   - **为什么**：更符合 first-wave 成本和运维复杂度。
   - **我们接受的代价**：必须极其严格地做 key path law。
   - **未来重评条件**：租户隔离规模显著上升时。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| R2 key 未带 team prefix | 实现图快 | 跨租户读写漏洞 | 强制 `tenants/{teamUuid}/...` |
| dual-track 拖延 | sunset 未冻结或未执行 | Lane E 永久并存 | 依赖 RHX-qna Q2 + closure 强制删除 |
| filesystem-core 只有 op list 没有真实持久化 | 只做接口不做存储 | RH4 名存实亡 | 以 upload/list/content e2e 判定完成 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：后续 file/multimodal 开发都终于建立在真实 artifact truth 上。
- **对 nano-agent 的长期演进**：把 context/filesystem leaf worker 从“存在于拓扑图”变成真实业务参与者。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：上下文 artifact 与多模态输入第一次拥有稳定底座。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | Real Artifact Store | R2 + D1 取代内存 artifact truth | ✅ `artifact 跨请求真实存在` |
| F2 | Filesystem RPC Surface | filesystem-core 提供真实业务 RPC | ✅ `leaf worker 真正参与业务` |
| F3 | Lane E Consumer Migration | agent-core 切 RPC-first，library import 进入 sunset | ✅ `consumer migration 完成而非永远并存` |
| F4 | Upload / List / Download | façade 提供完整 file lifecycle | ✅ `client 可上传、列出、下载文件` |

### 7.2 详细阐述

#### F1: `Real Artifact Store`

- **输入**：binary file、artifact metadata、team/session identity
- **输出**：R2 object + D1 metadata row
- **主要调用者**：filesystem-core、context-core、orchestrator-core
- **核心逻辑**：binary 进 R2，metadata 进 D1，读写都带 tenant namespace。**KV 职责严格限定**：可作为 (a) 短 TTL artifact 元信息热缓存（list 加速）、(b) upload idempotency marker（防止 multipart 重传重复入库）、(c) compatibility hot index；**禁止把 D1 metadata 完整复制到 KV 作为冷真相**，charter §4.4 已硬纪律化。**实施步骤**：(a) 在 `filesystem-core/src/artifacts.ts` 新增 `R2ArtifactStore` 实现，**直接消费已建成的** `storage/adapters/r2-adapter.ts` + `d1-adapter.ts`；(b) `nano-session-do.ts:353` 的 `new InMemoryArtifactStore()` 替换为通过 binding 调 filesystem-core RPC；(c) canonical 共享类型保留在 `packages/workspace-context-artifacts/src/artifacts.ts`，不做物理 fork。
- **边界情况**：
  - 任一只写 R2 或只写 D1 都不算完成。
  - 任何 KV cache key 必须带 `teamUuid` prefix 与显式 TTL；list/get/delete 操作必须有清晰的 invalidation 路径。
- **一句话收口目标**：✅ **`artifact 终于脱离进程内内存，进入真实持久化；R2/D1 是冷真相，KV 仅可选缓存`**

#### F2: `Filesystem RPC Surface`

- **输入**：read/write/list requests 与 authority/team context
- **输出**：filesystem-core WorkerEntrypoint 的真实业务结果
- **主要调用者**：agent-core、orchestrator-core
- **核心逻辑**：filesystem-core 从 “op names only” 升级为真正读写 artifact 的 leaf worker。
- **边界情况**：
  - worker fetch 仍只开放 `/health`，业务调用通过 RPC 而非 public route。
- **一句话收口目标**：✅ **`filesystem-core 从 library-only 升级成 business RPC worker`**

#### F3: `Lane E Consumer Migration`

- **输入**：agent-core host runtime、bindings、RPC-first flag、sunset 时间盒
- **输出**：agent-core 对 context/filesystem 的 RPC-first 消费路径
- **主要调用者**：session runtime / workspace runtime
- **核心逻辑**：短期 dual-track 保持可回退，sunset 到期后删除 library import。
- **边界情况**：
  - 未写清 sunset 或 sunset 后不删旧 path 都不算完成。
- **一句话收口目标**：✅ **`Lane E consumer migration 有终点而不是新技术债`**

#### F4: `Upload / List / Download`

- **输入**：multipart upload、sessionUuid、teamUuid
- **输出**：`POST /files`、`GET /files`、`GET /files/{file_uuid}/content`
- **主要调用者**：web / mini-program client
- **核心逻辑**：上传入 R2 与 D1；list 读 metadata；download 读内容。
- **边界情况**：
  - 跨 team list/read 必须明确拒绝。
- **一句话收口目标**：✅ **`client 第一次有完整的 file lifecycle，而不是空 catalog`**

### 7.3 非功能性要求与验证策略

- **性能目标**：upload/list/content 走真实存储但保持 first-wave 可接受时延
- **可观测性要求**：R2 key、file_uuid、teamUuid 映射可追踪
- **稳定性要求**：dual-track 切换期间不破坏现有 context/filesystem 能力
- **安全 / 权限要求**：tenant namespace 与 auth gate 同时成立
- **测试覆盖要求**：file pipeline e2e + multi-tenant read/list 拒绝 + preview smoke
- **验证策略**：通过上传到 R2、列表可见、内容可读、跨 team 拒绝、RPC-first 成功证明 RH4 成立

---

## 8. 可借鉴的代码位置清单

### 8.1 Filesystem current reality

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `workers/filesystem-core/src/index.ts:19-23,50-85` | hybrid WorkerEntrypoint：RPC 已存在 + fetch 仍 `bindingScopeForbidden()` 401 + `library_worker:true` | RH4 在此基础上升级业务 RPC，而不是另造 worker；同时收口 hybrid 残留 | current leaf seam |
| `workers/filesystem-core/src/artifacts.ts:27-60` | `ArtifactStore` 接口与 `InMemoryArtifactStore` | RH4 的明确替换点 | current in-memory gap |
| `packages/workspace-context-artifacts/src/artifacts.ts` | `InMemoryArtifactStore` 的 **canonical 位置**（agent-core `nano-session-do.ts:353` 从此包导入，不是从 filesystem-core 导入）| RH4 替换 in-memory 时需同步处理共享包的导出 | shared canonical |
| `workers/filesystem-core/src/storage/adapters/r2-adapter.ts:1-214` | R2 适配器（get/head/put/delete/list/listAll/putParallel + maxValueBytes guard + 分页游标）| F1 直接组装即可，**不要重新实装** | already built |
| `workers/filesystem-core/src/storage/adapters/kv-adapter.ts:1-138` | KV 适配器（含 ctx.waitUntil async write + maxValueBytes guard）| 仅在 KV 被 §5.1 [S1] 限定的 cache/idempotency 场景下使用 | already built |
| `workers/filesystem-core/src/storage/adapters/d1-adapter.ts:1-132` | D1 适配器（query/first/batch/prepare）| metadata 持久化层直接复用 | already built |

### 8.2 Agent-core cutover seam

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `workers/agent-core/wrangler.jsonc:43-50` | `CONTEXT_CORE` / `FILESYSTEM_CORE` 仍被注释 | RH4 的明确 binding 开启点 | current commented bindings |
| `workers/agent-core/src/host/do/nano-session-do.ts:353,2066-2071` | `InMemoryArtifactStore` 与 binding active flags | RH4 需把 runtime 消费切到 RPC-first | current runtime gap |

### 8.3 Façade file surface

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `workers/orchestrator-core/src/user-do.ts:1651-1699` | 当前 `handleFiles` 所在位置 | RH4 要保持 public route owner 不变 | existing file surface |
| `workers/orchestrator-core/src/index.ts:47-48,150-151` | façade 已持有 context/filesystem bindings | RH4 无需改 public topology，只需接真能力 | binding already present |

---

## 9. 多审查修订记录（2026-04-29 design rereview）

| 编号 | 审查者 | 原 finding | 采纳的修订 |
|------|--------|-------------|------------|
| GPT-R4 | GPT | RH4 未给 KV 在 file pipeline 分配明确职责，与"DO/KV 不复制冷真相"自相矛盾 | §5.1 [S1] 改写为"R2+D1 冷真相 / KV 仅可选 cache+idempotency"；§7.2 F1 实施步骤 + 边界情况补 KV 范围 |
| GLM-R5 | GLM | filesystem-core 当前为 hybrid 而非 library-only | §0 / §8.1 改写为 hybrid 描述并加注 fetch 401 + `library_worker:true` 残留 |
| deepseek-R3 | deepseek | r2/kv/d1 storage adapters 已是 484 行生产级实现 | §7.2 F1 实施步骤明确"直接消费已建成 adapter"；§8.1 加 3 行引用，标注 already built |
| GLM-R6 | GLM | `InMemoryArtifactStore` canonical 位置在 `packages/workspace-context-artifacts/`，不是 filesystem-core | §8.1 加 shared canonical 行 |
| kimi-R1 / GLM-R14 | kimi/GLM | KV/R2 binding 在 6 worker 中完全缺失 | §5.1 [S5] 强化 namespace 要求；具体 binding 首次声明由 RH0 P0-C 收口（已交叉引用）|
| GLM-R5（小项）| GLM | handleFiles 当前只返回 metadata，不返回字节 | §7.2 F4 在 RH2 主设计中已涵盖；本文件 [S4] multipart pipeline 同步把 download 内容路径写实 |
