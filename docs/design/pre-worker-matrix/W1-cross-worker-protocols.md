# W1 — Cross-Worker Protocol Design

> 功能簇:`pre-worker-matrix / W1 / cross-worker-protocols`
> 讨论日期:`2026-04-21`
> 讨论者:`Claude Opus 4.7 (1M context)` + owner pending review
> 关联文档:
> - Charter: `docs/plan-pre-worker-matrix.md` §4.1 B / §7.2
> - 前置决策:`docs/plan-pre-worker-matrix.md` §1.4(γ / β 路线 owner 接受)
> - Tier 映射:`docs/plan-pre-worker-matrix.md` §1.3
> - Cross-worker 交互矩阵:`docs/eval/worker-matrix/cross-worker-interaction-matrix.md`
> - 当前 NACP contract:`docs/rfc/nacp-core-1-3-draft.md` + `packages/nacp-core/src/messages/`
> 文档状态:`draft (v0.3 major downgrade post-GPT-review)`
>
> **修订历史:**
> - **v0.1 (2026-04-21)**:初稿
> - **v0.2 (2026-04-21)**:W0 design 完成后的回顾性修订 3 处 —— §4 新增 §4.5 引用 W0 sibling design pattern;§7.2 F7 的 `wrapEvidenceAsAudit` 签名基于 W0 §7.2 C3 的 `EvidenceAnchorSchema` 精确化(ctx 冗余消除);§9.3 Q1 标记为 resolved by W0 §7.2 C5。
> - **v0.3 (2026-04-21) — MAJOR DOWNGRADE**:Post-GPT-review narrowing。GPT review 盲点 4 明确指出 3 条跨 worker 新协议属 Layer 3 远期工作(依 live loop 证据驱动),不应作为 first-wave 硬前置。本 design 整体从 "code-ship + RFC" 降级为 **"RFC-only"**:workspace.fs.* 不实装 Zod schema + 不注册 matrix + 不 ship helper;β compact delegate 确认现有 `context.compact.*` family 足够,不新增 message + 不实装 remote delegate helper;evidence forwarding 不实装 `wrapEvidenceAsAudit` / `extractEvidenceFromAudit` helpers。3 份 RFC 作为 worker-matrix 后续 phase 的 input 仍要写。所有原 v0.2 的 schema 草案保留作为 RFC 起草 reference material。

---

## 0. 背景与前置约束

### 0.1 为什么现在要设计这 3 条协议

pre-worker-matrix 阶段 W0 正在把 5 类 cross-worker 契约吸收进 `nacp-core`(evidence sink / cross-seam anchor / evidence vocabulary / hooks catalog / storage law);但 **W0 只搬移已有契约,不新增跨 worker 行为**。而 owner 在 `plan-worker-matrix.md` r1 讨论中明确:

- γ — `filesystem.core` 是**所有文件操作的起点与终点**;其他 worker 必须通过协议调 filesystem.core,禁止本地副本
- β — `context.core` 是**所有上下文工作的抽象工具**;其他 worker 必须通过协议调 context.core,禁止本地 compact

这两条决策**新产生了跨 worker 通讯面**:
1. `bash.core → filesystem.core` 的全部文件 I/O(今天 in-process)
2. `agent.core kernel → context.core` 的 compact delegate(今天 in-process)
3. `filesystem.core / bash.core / context.core → agent.core sink` 的 evidence 流转(今天 in-process + 默认 sink)

这 3 条通讯面在 `nacp-core 1.3.0` 下都**无现成协议承载**(或现有 family 尚未经 live evidence 验证)。W1 v0.3 的定位:**为这 3 条通讯写 3 份方向性 RFC,冻结设计方向供 worker-matrix 后续 phase 在 live loop 证据驱动下实装**;**不在本阶段 ship 代码、不新增 message family、不实装 helper、不注册 matrix entries**。

**事实核查(v0.3 关键支撑)**:
- `context.compact.*` 在 `packages/nacp-core/src/messages/context.ts:18-29` 已 shipped — β remote compact delegate 路线 **无需新 message family**,只需 RFC 层文档化跨 worker 调用 pattern
- `audit.record` 在 `packages/nacp-core/src/messages/system.ts:10-27` 已 shipped — cross-worker evidence forwarding 可 wrap 在 audit.record 内,**无需新 evidence.* family**
- workspace.fs.* 目前 **无** 现成协议承载 — RFC 冻结未来 shape,实装等 live loop evidence

### 0.2 前置共识(v0.3 post-GPT-review 更新)

- **γ/β 路线方向已 owner 确定**:本 design **只产 RFC 冻结方向,不实装代码**(v0.3 降级)
- **所有未来 cross-worker 通讯必须经 NACP 协议层**:不允许 "side-channel RPC"(纪律保持)
- **1.3.0 消费者零破坏**:即使 W1 RFC-only,原则保留以防未来实装时违反
- **Layer 6 matrix 约定**:未来实装时新 message types 必须在 matrix 注册(RFC 里描述即可,不实装)
- **tenant boundary 强制**:未来实装时新 message 必须经 `verifyTenantBoundary` gate(同上)
- **RFC 不依赖 W0 完成**:本 design 产 RFC 文档,可与 W0 实装并行;不阻塞 W0 进度

### 0.5 v0.3 MAJOR DOWNGRADE 说明

GPT review 盲点 4 明确指出:
- workspace.fs.* 是否要成为新 NACP family,今天**证据不够**
- `context.compact.*` 现有 family **很可能已经够 first-wave**
- evidence forwarding 是否需要新 protocol,**未被当前运行路径证明**

结合 charter r2 §0.5 分层原则(long-term vs first-wave),W1 的代码实装属 Layer 3 远期工作,应由 live loop 证据驱动。v0.3 的正确定位:

> **W1 只冻结方向,不实装代码**。3 份 RFC shipped = W1 成功 exit;Zod schema / matrix registration / helper functions 推迟到 worker-matrix 后续 phase 由真实 runtime 证据驱动。

本 design 原 v0.2 的 schema 草案 + helper 签名保留在 §7,但其地位从 "实装规格" 变为 **"RFC 起草的 reference material"**。

### 0.3 显式排除

- 不设计 `orchestrator.*` namespace(post-worker-matrix phase)
- 不设计 `skill.*` 相关协议(skill.core deferred)
- 不为每个 evidence 类型单独开 NACP message family(违反"最小扩展"纪律)
- 不设计 "client → worker-matrix 内部 worker" 的 route(客户端仍然只通过 agent.core 的 session protocol)
- 不在本 design 里讨论协议的 transport 层细节(service binding 本身的握手 / 重试 / 负载均衡属 Cloudflare 平台层,不属协议层)

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**:`Cross-Worker Protocol Triad RFC Set`(W1 三份 RFC)
- **一句话定义(v0.3 RFC-only)**:为 worker-matrix 后续 phase 的 3 对 cross-worker 通讯撰写**方向性 RFC 文档**(非代码),冻结设计方向以便 live loop evidence 驱动下的实装有 reference
- **边界描述(v0.3)**:
  - **包含**:3 份 RFC markdown 文档(`workspace-rpc.md` / `remote-compact-delegate.md` / `evidence-envelope-forwarding.md`);每份含:目标、shape 草案、matrix/role 预期、实装延后至 worker-matrix 后续 phase 的理由
  - **不包含**:任何代码实装 — Zod schema 不注册、matrix entries 不 register、helper 函数不实装、contract tests 不写、1.4.0 不新增 W1 symbols

### 1.2 关键术语对齐

| 术语 | 定义 | 备注 |
|------|------|------|
| workspace RPC | 跨 worker 文件操作通讯,由 filesystem.core 作为 authority 提供 | γ 路线的具体表现 |
| remote compact delegate | agent.core kernel 通过 service binding 调 context.core 做压缩的装配模式 | β 路线的具体表现 |
| evidence envelope forwarding | 非 agent.core worker 发出 evidence record,通过 NACP envelope 流到 agent.core sink 的机制 | 第三条通讯 |
| `workspace.fs.*` | W1 新增 NACP message family(候选 5-6 条 message types) | 本 design §7.1 具体化 |
| `audit.record` wrap | 用已有 `audit.record` envelope 承载 evidence record 的复用策略 | 替代新增 `evidence.*` family |
| CompactDelegate | `@nano-agent/agent-runtime-kernel` 消费的 compact 接口类型 | β 路线的消费端 type |

### 1.3 参考上下文

- `docs/rfc/nacp-core-1-3-draft.md`:NACP 1.3 契约现状
- `docs/eval/worker-matrix/cross-worker-interaction-matrix.md` §2:协议 surface 汇总
- `docs/eval/worker-matrix/filesystem-core/internal-nacp-compliance.md`:filesystem 协议归属讨论
- `docs/eval/worker-matrix/context-core/internal-nacp-compliance.md`:context 协议归属讨论
- `packages/workspace-context-artifacts/src/namespace.ts:17-121`:当前 in-process WorkspaceNamespace API(5 个操作)— W1.1 的 API 参考蓝本
- `packages/nacp-core/src/messages/context.ts:5-25`:`context.compact.request/response` 现有 schema — W1.2 复用对象
- `packages/nacp-core/src/messages/system.ts:10-14`:`AuditRecordBodySchema = {event_kind, ref?, detail?}` — W1.3 复用对象

---

## 2. 在 nano-agent 中的定位

### 2.1 角色(v0.3 RFC-only)

- **在整体架构里的角色**:**方向性 RFC 集**,冻结未来 cross-worker 协议演进的 design reference;不是协议代码
- **服务于**:worker-matrix 后续 phase 的实装者(在 live loop evidence 驱动下把 RFC 变成真实代码时有参考基线)
- **依赖**:W0 narrower 产出(evidence vocabulary / cross-seam anchor / storage-law 吸收后的 shape)— RFC 引用这些 shape
- **被谁依赖**:worker-matrix 后续 phase 的 remote-split 实装(非 first-wave)

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| `nacp-core` envelope validator | W1 RFC 引用 | 弱 | RFC 描述未来 Layer 6 matrix entries 的预期 shape,不实际注册 |
| `nacp-core` matrix | W1 RFC 预告 | 弱 | RFC 列出未来要注册的 matrix rows,不实际注册 |
| `nacp-core` evidence vocabulary(W0 narrower) | W1 RFC 引用 | 中 | RFC 在 evidence forwarding 部分引用 W0 shipped shape |
| `nacp-core` storage-law(W0) | W1 RFC 引用 | 中 | workspace RPC RFC 引用 storage-law builders |
| `context.compact.*`(1.3 已存在) | W1 RFC 确认够用 | 强 | RFC 结论:现有 family 已足够承载 remote compact delegate — 不新增 |
| `audit.record`(1.3 已存在) | W1 RFC 利用 | 强 | RFC 结论:wrap 进 audit.record 已足够承载 evidence forwarding — 不新增 family |
| `tool.call.*`(1.3 已存在) | W1 正交 | 弱 | 不耦合 |
| W4 workers 空壳 | 无耦合 | 无 | W1 不产代码,workers 不消费 W1 产出 |

### 2.3 一句话定位陈述(v0.3 RFC-only)

> 在 nano-agent 里,`Cross-Worker Protocol Triad RFC Set` 是**方向性协议 RFC 集(非代码)**,负责**为 3 条未来 cross-worker 通讯冻结设计方向**(workspace RPC 新增 / compact delegate 复用现有 context.compact.* / evidence 复用现有 audit.record),对上游(worker-matrix 后续 phase 实装者)提供**设计 reference baseline**,对下游(live loop evidence 驱动的实装)要求**按 RFC 冻结方向推进,不另立替代协议**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点(哪里可以砍)

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|---|---|---|---|
| `workspace.fs.chmod / chown / stat(extended)` | POSIX / just-bash `MountableFs` | Cloudflare 无 POSIX 概念;当前 handlers 不需要 | 否(Workers 模型下不会) |
| `workspace.fs.symlink` 系列 | just-bash symlink security tests | 当前 workspace 无 symlink;fake-bash 也不支持 | 否 |
| `workspace.fs.watch` / inotify | node fs.watch / just-bash `/_jb_http` | 无跨 worker 事件监听需求 | 未来 `FileChanged` hook 落地时评估 |
| `workspace.fs.batch.*`(单 envelope 多 op) | 自行发明 | 第一波不需要;单 op/envelope 足够 | 性能数据证明需要时 |
| `evidence.*` 独立 message family | Opus 早期备选 | 审查阶段决定 audit.record 复用即可 | 除非 evidence shape 与 audit 明显分叉 |
| `kernel.compact.delegate.*` 专属 message | Opus 早期备选 | `context.compact.*` 已足够 | 若出现 compact 对 kernel 的反向调用需求 |
| path resolver 作为独立 NACP op | 自行发明 | 客户端不需要 resolve;workspace 端自己 resolve 即可 | 否 |

### 3.2 接口保留点(必须留扩展空间)

| 扩展点 | 表现形式 | 第一版行为 | 未来演进方向 |
|---|---|---|---|
| `workspace.fs.*.request.body.options` | Zod object optional field | 空接受;实装忽略 | 可承载 `encoding / maxBytes / createIfMissing` 等不影响 legality 的参数 |
| `workspace.fs.*.response.body.metadata` | Zod object optional field | 空 | 未来可带 `modified_at / etag / content_hash` |
| `AuditRecordBodySchema.detail` | 已有 `z.record(z.string(), z.unknown())` | evidence record 直接塞入 | 无需改;W0 只需在 `vocabulary.ts` 定义 evidence record discriminated union shape |
| `NacpRef` for workspace path | 已有 | 用 `NacpRef{ kind:"do-storage", key:"tenants/<team>/workspace/..." }` | 不变 |
| CompactDelegate interface | TS interface in agent-runtime-kernel | 本地 + remote 两种实现共用 | 未来可扩展 `prepare()` / `cancel()` 方法 |

### 3.3 完全解耦点(必须独立)

- **workspace RPC 的 body schema 与 WorkspaceNamespace in-process API 必须独立定义**
  - 不能 `z.instanceof(WorkspaceNamespace)` 之类
  - 必须用纯 Zod primitive + NacpRef
  - 原因:NACP 是 wire contract,消费者的 in-process 类型是 runtime 细节

- **remote compact delegate helper 与 in-process delegate 接口表面一致,实现分离**
  - 都实现 `CompactDelegate` interface
  - `createInProcessCompactDelegate(orchestrator)` vs `createRemoteCompactDelegate(binding)`
  - kernel 不知道它调的是哪一个

- **evidence 转发路径的 emitter 与 sink 完全解耦**
  - emitter(filesystem / bash / context)只产 `audit.record` envelope
  - sink(agent.core 的 BoundedEvalSink)只消费 envelope,不知道是谁发的
  - 解耦让未来引入 `evidence.reranker` worker 作为 intermediate aggregator 不需改 emitter/sink

### 3.4 聚合点(单一中心)

- **W1 所有新 message types 聚合在 `nacp-core/src/messages/workspace.ts`**
  - 不分散到 `nacp-workspace` 子包(会产生循环)
  - 与 `tool.ts` / `context.ts` / `hook.ts` 同级,保持 registry 集中
  
- **CompactDelegate type 聚合在 `agent-runtime-kernel`**
  - 本地 + remote 实现都在这里;或 remote 实现在 `nacp-core` 作为 transport helper
  - 原则:delegate 是 kernel 的接口要求,由 kernel 决定归属
  
- **evidence envelope 转发纪律聚合在 `nacp-core/src/evidence/forwarding.ts`(新建,W1 一部分)**
  - 统一 helper:`wrapEvidenceAsAudit(record) → NacpEnvelope`
  - 统一 helper:`extractEvidenceFromAudit(envelope) → EvidenceRecord | null`
  - 让所有 emitter / sink 走同一入口,避免 shape 漂移

---

## 4. 关键参考实现对比

> 本 design 不是从"三个对标 agent"借实现,而是从 3 类已有 protocol pattern 借取决策。

### 4.1 现有 NACP `tool.call.*` family(内部 reference)

- **实现概要**:`tool.call.request/response/cancel` 在 `packages/nacp-core/src/messages/tool.ts:4-30`,body 是 `{tool_name, tool_input}` 或 `{status, output?, error?}`
- **亮点**:
  - request/response pair 模式成熟;role gate 清晰(session→command,capability/skill→response)
  - Matrix legality 强制;延迟向 worker 发送前即校验
- **值得借鉴**:
  - `workspace.fs.*` 直接复刻 `*.request` / `*.response` 命名 + role gate 模式
  - 错误通过 `status: "ok"|"error"` + `error?:{code,message}` 对齐(与 wrapAsError provisional 兼容)
- **不照抄的地方**:
  - `tool_name` 是字符串 ID,`workspace.fs.*` 的 op 是分 type 的;不需要 "fs_op: string"

### 4.2 现有 `context.compact.*` family(W1.2 直接复用)

- **实现概要**:`packages/nacp-core/src/messages/context.ts`,已 shipped 在 1.3.0
- **亮点**:
  - request 携带 `history_ref` + `target_token_budget`
  - response 携带 `summary_ref` + `tokens_before/after`
  - role gate:`session/platform → capability`,与 β 路线的 kernel(session)→ context.core(capability)完全匹配
- **值得借鉴**:
  - **直接拿来用,不改**;W1.2 只做 delegate wiring
- **不新增**:没有发现需要新 message 的 gap

### 4.3 现有 `audit.record`(W1.3 直接复用)

- **实现概要**:`packages/nacp-core/src/messages/system.ts:10-14`,`{event_kind, ref?, detail?}`,role-open(任何 producer 可发)
- **亮点**:
  - `detail: z.record(z.string(), z.unknown())` 已经是灵活载荷
  - `ref` 可指向 R2/DO 中的大 artifact(当 evidence record 太大时)
  - `event_kind` 是 discriminator string — 完美适配 evidence 4 kinds(`evidence.assembly / evidence.compact / evidence.artifact / evidence.snapshot`)
- **值得借鉴**:
  - 用 `event_kind` 作为 evidence record type discriminator
  - `detail` 承载 W0 吸收后的 evidence record body
- **不新增**:`evidence.*` family 完全无必要

### 4.4 横向对比速查表

| 维度 | `tool.call.*` | `context.compact.*` | `audit.record` | W1 新 `workspace.fs.*` |
|---|---|---|---|---|
| 抽象层次 | 业务动作 | 业务动作 | 事件记录 | 资源操作 |
| message types 数量 | 3(request/response/cancel) | 2(request/response) | 1 | **5-6**(read/write/list/stat/delete/resolve) |
| role gate 严格度 | 强(producer_role 限定) | 强 | 弱(任意) | 强(建议严格,见 §7.1) |
| body 是否分 variant | 不分(单一 shape) | 不分 | 通过 `event_kind` + `detail` discriminate | **分**(每个 op 独立 schema) |
| 是否需 `*.cancel` | 是 | 否 | N/A | **否**(fs 操作同步/短时,不需 cancel) |
| 是否需 progress stream | 是(stream event) | 否 | 否 | **否**(第一波不需要) |
| 错误形状 | `{status, error?}` | `{status, error?}` | N/A | **`{status, error?}`**(统一) |
| nano-agent 倾向 | 复用 shape | 复用 | 复用 | **新增,但遵循现有 shape 惯例** |

### 4.5 来自 sibling W0 design 的 pattern 借鉴(v0.2 新增)

W0 是 pre-worker-matrix 的姊妹 phase,先 W1 完成的 design `docs/design/pre-worker-matrix/W0-nacp-consolidation.md` 建立了几条关键纪律,W1 应直接继承而非另立:

- **共用 `nacp-core 1.4.0` 版本号**:W0 已把 `NACP_VERSION 1.3.0 → 1.4.0` 作为 pre-worker-matrix 的统一 additive bump;W1 的新 `workspace.fs.*` message family + helper 作为同一 1.4.0 的一部分 ship,**不单独 bump 1.5.0**
- **Additive-only 纪律**:W0 §6.1 取舍 1 已建立 1.3.0 消费者零破坏原则;W1 新增 message types 通过 `registerMessageType` 追加,不修改现有 registry;新加的 matrix entries 只是 `NACP_CORE_TYPE_DIRECTION_MATRIX` 的新 key,不改现有 key
- **子目录聚合惯例**:W0 已建立 `evidence/ hooks-catalog/ storage-law/` + `transport/cross-seam.ts` 的子目录 pattern;W1 的 `workspace.fs.*` 应放 `messages/workspace.ts`(与 `tool.ts / hook.ts / skill.ts / context.ts / system.ts` 同级),保持 messages 家族聚合;`workspace.fs.*` 不新建 `messages/workspace/` 子目录
- **Evidence schema 依赖方向**:W0 §7.2 C3 已冻结 `EvidenceAnchorSchema` + 4 kinds discriminated union;W1 §7.2 F7 的 `wrapEvidenceAsAudit` 必须**消费** W0 shipped 的这套 schema,不得在 W1 里重新定义 evidence record shape
- **CHANGELOG 共写**:W0 §7.2 C6 的 CHANGELOG 1.4.0 entry 会**合并** W0 + W1 的新 symbol;W1 不产 CHANGELOG 单独条目,而是把新增贡献加入 W0 草案的 CHANGELOG(见 W0 §7.2 C6 entry 草案,本 design 中的 W1 新 symbol 需合并进去)

**什么 W1 不继承 W0**:

- W0 的 **re-export 纪律**(原位置保留 wrapper)不适用 W1 — W1 的 `workspace.fs.*` 和 `wrapEvidenceAsAudit` 都是**全新 symbol**,没有"老家"可 re-export;直接在 nacp-core 新建即可

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope(W1 v0.3 RFC-only 版)

> **v0.3 MAJOR DOWNGRADE**:原 v0.2 的 S1-S12 包含大量代码实装动作。v0.3 按 GPT review 盲点 4 整改,**只保留 RFC deliverables**;所有 Zod schema / matrix registration / helper implementation 全部**降级** OR **删除**。

- **[S1]** ~~workspace.fs.* NACP message family 设计 + schema~~ → **RFC-only**:写 `docs/rfc/nacp-workspace-rpc.md` 含 shape 方向 + 未来实装规划,但**不**实装代码
- **[S2]** ~~workspace.fs.* 注册进 Layer 6 matrix~~ → **删除**(RFC 中说明未来注册方案即可)
- **[S3]** ✅ `docs/rfc/nacp-workspace-rpc.md` RFC 文档(保留)
- **[S4]** ~~CompactDelegate TS interface 冻结~~ → **降级**:RFC 中描述接口预期;不在 `@nano-agent/agent-runtime-kernel` 添加实际 TS code
- **[S5]** ~~createRemoteCompactDelegate 实装~~ → **删除**(worker-matrix 阶段 live 后再实装)
- **[S6]** ✅ 确认 β delegate 可复用 existing `context.compact.request/response`,不新增 message type(结论写入 RFC)
- **[S7]** ✅ `docs/rfc/remote-compact-delegate.md` RFC 文档(保留)
- **[S8]** ~~wrapEvidenceAsAudit helper 实装~~ → **删除**(RFC 中描述 wrapping pattern;实装延后)
- **[S9]** ~~extractEvidenceFromAudit helper 实装~~ → **删除**(同上)
- **[S10]** ✅ `docs/rfc/evidence-envelope-forwarding.md` RFC 文档(保留)
- **[S11]** ~~3 条协议的 root contract tests~~ → **删除**(未实装,无代码可测)
- **[S12]** ~~nacp-core 1.4.0 ship 包含 W1 新 symbol~~ → **删除**(W0 shipped 1.4.0 不含 W1 协议代码)

### 5.1.1 v0.3 In-Scope 净清单(只剩 RFC)

- **[R1]** 写 3 份 RFC(`nacp-workspace-rpc.md` / `remote-compact-delegate.md` / `evidence-envelope-forwarding.md`)
- **[R2]** 每份 RFC 含:方向描述 + 未来实装规划 + 为什么 first-wave 不需要实装
- **[R3]** RFC 内保留原 v0.2 §7 的 shape 草案作为 reference material
- **[R4]** 3 份 RFC 互相 cross-link + 与 W0 shipped vocabulary 对齐

### 5.2 Out-of-Scope(W1 不做)

- **[O1]** `workspace.fs.*` 的真实 runtime handler 实装(工作属 worker-matrix `filesystem.core` absorption)
- **[O2]** 远端 compact 的真实 `context.core` worker 实装(属 worker-matrix `context.core` absorption)
- **[O3]** 每条协议的 end-to-end live deploy 验证(W4 只做 hello-world shell;真实协议流量在 worker-matrix)
- **[O4]** `workspace.fs.batch.*` 批操作协议(3.1 被砍)
- **[O5]** `workspace.fs.watch` 事件流(3.1 被砍)
- **[O6]** `evidence.*` 独立 family(3.1 被砍,复用 `audit.record`)
- **[O7]** `kernel.compact.*` 反向调用 family(3.1 被砍,现有 `context.compact.*` 足够)
- **[O8]** 任何 1.3.0 → 1.4.0 的 breaking change(必须 additive)
- **[O9]** 修改 `nacp-session` 契约(session profile 与跨 worker 无关)
- **[O10]** wrapper / SDK 化(如 "nacp-workspace-client" library)— 每个 worker 直接用原 schema,不需要额外 SDK 层

### 5.3 边界清单(灰色地带)

| 项目 | 判定 | 理由 |
|---|---|---|
| `workspace.fs.resolve.*` 是否独立 op | **out-of-scope** | `resolveWorkspacePath` 是 server 内部逻辑,client 只需发绝对 path;resolve 为 server-side 细节 |
| workspace op 失败时是否走 `wrapAsError` | **out-of-scope / provisional** | helper 仍 provisional;用现有 `{status, error?}` shape,与 tool.call.response 对齐 |
| evidence envelope 是否带 `trace.parent_message_uuid` 关联源操作 | **in-scope(可选字段)** | 若源 envelope 已经有 trace,evidence 应继承 trace;带关联;属于 evidence record shape 约束 |
| `workspace.fs.*` response 是否带 `NacpRef` 用于大文件 | **in-scope(可选)** | read 大文件时 response 可仅带 `NacpRef` 指向 artifact,而不 inline 文件内容 |
| compact delegate 是否需支持并发 compact | **out-of-scope** | kernel 保证单 compact;delegate 不必考虑;与 `AsyncCompactOrchestrator` generation token 契约一致 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1 — workspace RPC 走 NACP envelope,不走 raw service-binding RPC**
   - **我们选择 NACP envelope 路径**,而不是**裸 `fetch` + typed handlers** 这样轻的 RPC
   - **为什么**:
     - 单协议路径 = 所有 cross-worker 流量都经 Layer 6 matrix + tenant verify + audit trail
     - 复用现成 `CrossSeamAnchor` header law / 认证 / tracing
     - 与其他 NACP family(`tool.call.*` / `context.compact.*`)交互一致
   - **我们接受的代价**:每次 fs 操作都 encode / validate / decode envelope,有额外延迟(估计 + 0.5-2ms / op)
   - **未来重评条件**:若 profile 显示 fs 操作延迟是 first-wave 瓶颈(超 20% latency budget),考虑 envelope-less fast path

2. **取舍 2 — β 路线不新增 message family,复用 `context.compact.*`**
   - **我们选择复用**,而不是新增 `kernel.compact.delegate.*`
   - **为什么**:
     - 现有 schema 完全覆盖 delegate 所需(history_ref + target_budget → summary_ref + token stats)
     - 减少协议 surface;避免"为同一种语义引入两套 shape"
   - **我们接受的代价**:`context.compact.*` 的使用场景略微放大(不仅是一般 compact,也用于 kernel delegate)— 但语义完全一致
   - **未来重评条件**:若 kernel compact delegate 出现其他使用场景需要不同 shape(如 partial compact / cancel),再引入新 family

3. **取舍 3 — evidence 转发复用 `audit.record`,不新增 family**
   - **我们选择复用**,而不是新增 `evidence.emit`
   - **为什么**:
     - `audit.record.event_kind` 本就是 discriminator string;evidence 4 kinds 对它来说是新值而非新 shape
     - `audit.record.detail` 灵活;可承载 W0 定义的 evidence record discriminated union
     - 减少 nacp-core 1.4.0 的 surface 增量
   - **我们接受的代价**:audit.record 语义从"审计事件"扩张到"审计 + 证据",但这本来就是合理的语义合并 — audit 的本义就是 evidence
   - **未来重评条件**:若出现 evidence 需要 `audit.record` 没有的字段(如强制 `trace_uuid` / `emitter_role` 等),评估是否专设 family

4. **取舍 4 — 每个 fs op 一个独立 message type,不共用 "fs_op: string" discriminator**
   - **我们选择 per-op schema**,而不是 `workspace.fs.op.request` 用 `{op_name: string, args: ...}` 共用
   - **为什么**:
     - 每个 op 有独立 body schema → Layer 4 body validation 直接强制每个 op 的 args shape
     - 与 `tool.call.request` 的 `tool_name: string + tool_input: record` 不同,后者是 "we don't know all tool names at registry time";但 fs 操作是固定有限集合,per-op schema 更强
   - **我们接受的代价**:message types 从 1 个膨胀到 5-6 个
   - **未来重评条件**:若 fs 操作动态扩张需求出现(不太可能),考虑降级为单 type + discriminator

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解 |
|---|---|---|---|
| W1 设计的 schema 在 worker-matrix 实装时发现不足 | absorption 时暴露新字段需求 | nacp-core 1.4.0 → 1.5.0 被迫非额外 bump | §3.2 predefined optional 扩展点;新字段走 `.optional()` additive |
| `audit.record` 扩张承载 evidence 导致审计诉求失真 | 消费者用 `event_kind.startsWith("evidence.")` 过滤 | evidence 与 audit 的消费面混 | §7.3 要求 emitter 明确用 `evidence.<kind>` 前缀;消费者 strict filter |
| remote compact delegate 的 latency 超出 in-process 基线 | real deploy profile | compact 可能变成 user-visible 卡顿 | kernel 本来就是 async 消费 compact;latency 可吸收;监控 `tokens_after - tokens_before` |
| workspace RPC role gate 错配 | bash.core 被错误允许 producer session | 权限外泄 | §7.1 严格 role gate;root contract test 锁定 |
| Layer 6 matrix 漏列某合法 `(workspace.fs.*, delivery_kind)` 组合 | 真实发送被 reject | 第一次 wiring 时 `NACP_TYPE_DIRECTION_MISMATCH` | §7.1 Table 列出所有;unit test enumerate |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己(我们)**:W1 完成后,worker-matrix absorption 中的 "跨 worker 通讯" 不再是设计问题,只剩接线问题;P0 执行复杂度大幅下降
- **对 nano-agent 的长期演进**:workspace RPC / remote compact 成为第三方 nano-agent 实现的**公开契约**(经 GitHub Packages 发布 nacp-core 1.4.0);`skill.core` / 未来 workers 进场时不需要重新设计这两个基础面
- **对"上下文管理 / Skill / 稳定性"三大方向的杠杆**:
  - 上下文管理:remote compact delegate 解锁 context.core 的真实 isolation(独立部署)
  - Skill:workspace RPC 为 skill.core 未来访问文件提供现成协议,不需要另立
  - 稳定性:cross-worker 协议 + tenant boundary 强制 + matrix 强制,三重约束让跨 worker 交互的失败模式收敛到少数已知面

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单(v0.3 RFC-only 净清单)

> **v0.3 重写说明**:原 v0.2 的 F1-F10 包含大量代码实装动作(Zod schema / helper / matrix registration / contract tests / 1.4.0 ship)。按 R2 整改,v0.3 的 W1 **仅**产出 3 份 RFC 文档;所有代码动作 **移除或推迟**。原 F1-F10 的详细 schema/helper 草案作为 **"superseded reference / appendix"** 保留在 §7.2,供未来实装者参考,**不**作为本阶段交付。

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|---|---|---|---|
| **R1** | workspace RPC RFC | 写 `docs/rfc/nacp-workspace-rpc.md`;含未来 `workspace.fs.*` family 方向(read/write/list/stat/delete 5 ops),但**不实装** | ✅ RFC markdown shipped + owner-reviewed;**无代码** |
| **R2** | remote compact delegate RFC | 写 `docs/rfc/remote-compact-delegate.md`;结论:复用 `context.compact.*` 现有 family 足够,未来 `createRemoteCompactDelegate` helper 实装由 worker-matrix 后续 phase 完成 | ✅ RFC markdown shipped + owner-reviewed;**不新增 message family** |
| **R3** | evidence forwarding RFC | 写 `docs/rfc/evidence-envelope-forwarding.md`;结论:wrap 进现有 `audit.record` envelope 足够,未来 `wrapEvidenceAsAudit` helper 实装推迟 | ✅ RFC markdown shipped + owner-reviewed;**不新增 family / helper** |
| **R4** | 3 份 RFC 相互 cross-link | RFC 互相引用 + 与 W0 shipped vocabulary 对齐 | ✅ 3 份 RFC 内部引用链完整;所有对 W0 shape 的 reference 准确 |

**以下 v0.2 的 F1-F10 全部移除作为本阶段 in-scope** — 保留在 §7.2 作 superseded reference:

| 原 F 编号 | v0.2 状态 | v0.3 状态 |
|---|---|---|
| F1-F5(workspace.fs.* 5 ops schema 实装)| in-scope | **superseded** — reference material only;实装归 worker-matrix 后续 phase |
| F6(CompactDelegate + createRemoteCompactDelegate)| in-scope | **superseded** — RFC 确认现有 family 足够;helper 实装推迟 |
| F7(wrapEvidenceAsAudit / extractEvidenceFromAudit helpers)| in-scope | **superseded** — helper 实装推迟 |
| F8(matrix + role gate registration)| in-scope | **superseded** — 无新代码可注册 |
| F9(3 份 RFC 文档)| in-scope | ✅ **保留为 R1-R3**(本阶段唯一交付) |
| F10(root contract tests)| in-scope | **superseded** — 无代码可测 |

### 7.2 详细阐述 — **v0.3 标注为 SUPERSEDED REFERENCE / APPENDIX**

> **v0.3 重要说明**:以下 F1-F10 各节内容**不是本阶段交付**,而是为未来实装者保留的 **design reference material**。本阶段唯一交付是 3 份 RFC markdown(对应上表 R1-R3)。每个 F 节的 schema 草案 / helper 签名 / contract test 设想将被 RFC 引用,但**不在本阶段 ship 代码**。
>
> ⚠️ 若 worker-matrix 阶段决定实装这些,实装者应基于**当时的 live loop evidence** 重新 review 下列草案,不得直接视为已 frozen specification。

---

#### F1 (superseded reference): `workspace.fs.read.request` / `workspace.fs.read.response`

- **输入(request body)**:
  ```ts
  z.object({
    path: z.string().min(1).max(1024),  // 绝对 workspace path, e.g. "/workspace/src/index.ts"
    options: z.object({
      encoding: z.enum(["utf-8", "binary"]).optional(),
      max_bytes: z.number().int().min(1).max(10 * 1024 * 1024).optional(),
    }).optional(),
  })
  ```
- **输出(response body)**:
  ```ts
  z.object({
    status: z.enum(["ok", "error"]),
    content: z.string().optional(),  // utf-8 or base64 for binary
    content_ref: NacpRefSchema.optional(),  // 大文件走 ref,不 inline
    size: z.number().int().min(0).optional(),
    metadata: z.object({
      modified_at: z.string().datetime({ offset: true }).optional(),
    }).optional(),
    error: z.object({ code: z.string(), message: z.string() }).optional(),
  })
  ```
- **主要调用者**:bash.core 的 file read handler、context.core 的 snapshot builder 读 mount content
- **核心逻辑**:
  - filesystem.core 接收 request → `verifyTenantBoundary` → `MountRouter.routePath(body.path)` → `backend.read(relativePath)` → 若 content > inline threshold 则 promote 到 R2 artifact + 返回 `content_ref`;否则 inline
- **边界情况**:
  - mount 不存在 → `{status: "error", error: {code: "WORKSPACE_NO_MOUNT", message}}`
  - 超过 `max_bytes` → 返回 truncated + `error.code: "WORKSPACE_SIZE_EXCEEDED"`
- **Matrix entry**: `workspace.fs.read.request = command`;`workspace.fs.read.response = response | error`
- **Role gate**:
  - request:producer `session | capability | skill`(所有 workers 可读)
  - response:producer `capability`(filesystem.core role = capability)
- **一句话收口目标**:✅ **schema 冻结 + matrix/role 注册 + 独立 unit test 3 用例**

#### F2 (superseded reference): `workspace.fs.write.request` / `workspace.fs.write.response`

- **输入(request body)**:
  ```ts
  z.object({
    path: z.string().min(1).max(1024),
    content: z.string(),  // utf-8 or base64 string
    content_ref: NacpRefSchema.optional(),  // 或从已有 ref 导入
    options: z.object({
      encoding: z.enum(["utf-8", "binary"]).optional(),
      create_if_missing: z.boolean().optional(),
      overwrite: z.boolean().optional(),
    }).optional(),
  }).refine(
    (b) => b.content !== undefined || b.content_ref !== undefined,
    { message: "either content or content_ref must be provided" },
  )
  ```
- **输出**:同 F1 response shape,但 `content` / `content_ref` 不返回(只需 `{status, size?, metadata?, error?}`)
- **边界情况**:
  - readonly mount → `{status: "error", error: {code: "WORKSPACE_READONLY"}}`
  - mount 不存在 → `WORKSPACE_NO_MOUNT`
- **Role gate**:
  - request:producer `session | capability | skill`(写权限开放,由 mount 的 readonly 策略控制)
  - response:producer `capability`
- **一句话收口目标**:✅ **schema + matrix/role + test 3 用例(happy / readonly / no-mount)**

#### F3 (superseded reference): `workspace.fs.list.request` / `workspace.fs.list.response`

- **输入**:
  ```ts
  z.object({
    path: z.string().min(1).max(1024),  // directory path
    options: z.object({
      recursive: z.boolean().optional(),
      include_hidden: z.boolean().optional(),
      max_entries: z.number().int().min(1).max(10_000).optional(),
    }).optional(),
  })
  ```
- **输出**:
  ```ts
  z.object({
    status: z.enum(["ok", "error"]),
    entries: z.array(z.object({
      path: z.string(),
      size: z.number().int().min(0),
      modified_at: z.string().datetime({ offset: true }).optional(),
      is_directory: z.boolean().optional(),
    })).optional(),
    truncated: z.boolean().optional(),
    error: z.object({ code: z.string(), message: z.string() }).optional(),
  })
  ```
- **一句话收口目标**:✅ **schema + matrix/role + test(flat / recursive / empty-dir 3 用例)**

#### F4 (superseded reference): `workspace.fs.stat.request` / `workspace.fs.stat.response`

- **输入**:`{path: string}`
- **输出**:`{status, entry?: FileEntry, error?}`(not-found 走 `error.code: "WORKSPACE_NOT_FOUND"`)
- **一句话收口目标**:✅ **schema + matrix/role + test(exist / not-found 2 用例)**

#### F5 (superseded reference): `workspace.fs.delete.request` / `workspace.fs.delete.response`

- **输入**:`{path: string}`
- **输出**:`{status, deleted?: boolean, error?}`
- **一句话收口目标**:✅ **schema + matrix/role + test(happy / readonly / not-found 3 用例)**

#### F6 (superseded reference): `CompactDelegate` interface + `createRemoteCompactDelegate`

- **CompactDelegate TS interface**(在 `@nano-agent/agent-runtime-kernel`):
  ```ts
  export interface CompactDelegate {
    requestCompact(input: {
      historyRef: NacpRef;
      targetTokenBudget: number;
    }): Promise<{
      summaryRef: NacpRef | null;
      tokensBefore: number;
      tokensAfter: number;
    }>;
  }
  ```
- **`createRemoteCompactDelegate(binding, ctx)`**(在 `nacp-core/src/transport/` 或 `agent-runtime-kernel/src/delegate/`):
  - 入参:`ServiceBindingLike` + `{teamUuid, sessionUuid, traceUuid}` context
  - 行为:封装 `context.compact.request` envelope → 经 binding 发送 → await response → unwrap → 返回 delegate-shape 结果
  - 错误:response `status: "error"` → throw `CompactFailedError(code, message)`
- **一句话收口目标**:✅ **interface 冻结 + helper 可测 + 本地/远端 dual implementation unit test pass**

#### F7 (superseded reference): `wrapEvidenceAsAudit` / `extractEvidenceFromAudit`

> **v0.2 修订**:原 ctx 参数与 `EvidenceRecord.anchor`(W0 §7.2 C3 shipped 的 `EvidenceAnchorSchema` 内含 `traceUuid / sessionUuid / teamUuid / sourceRole / sourceKey? / turnUuid? / timestamp`)冗余。v0.2 把 `ctx` 收窄为 `WrapEvidenceAsAuditOptions`,只承载**不能从 anchor 派生**的字段:envelope-level message_uuid / sent_at + authority 补足字段。

- **`wrapEvidenceAsAudit(record, options) → NacpEnvelope`**:
  - **输入**:
    - `record: EvidenceRecord`(W0 §7.2 C3 冻结的 discriminated union of 4 kinds,每条内含 `anchor`)
    - `options: WrapEvidenceAsAuditOptions`(下面详细定义)
  - **`WrapEvidenceAsAuditOptions` shape**(v0.2 新定义):
    ```ts
    export interface WrapEvidenceAsAuditOptions {
      /** Fresh envelope message_uuid. Caller responsible for UUID v4. */
      envelope_message_uuid: string;
      /** Fresh envelope sent_at (ISO 8601 with offset). Typically same as authority.stamped_at. */
      envelope_sent_at: string;
      /** Authority fields not derivable from record.anchor. */
      authority: {
        plan_level: NacpPlanLevel;   // "free" | "pro" | "enterprise" | "internal"
        stamped_by_key: NacpProducerKey;
        stamped_at: string;          // 通常等于 envelope_sent_at
        membership_level?: NacpMembershipLevel;
      };
      /** Optional header.priority override. Defaults to "normal". */
      priority?: NacpPriority;
    }
    ```
  - **行为**(从 record.anchor + options 派生完整 envelope):
    - `header.schema_version = NACP_VERSION`(自 nacp-core)
    - `header.message_uuid = options.envelope_message_uuid`
    - `header.message_type = "audit.record"`
    - `header.delivery_kind = "event"`(W0 已注册 audit.record 的 matrix 合法 kind)
    - `header.sent_at = options.envelope_sent_at`
    - `header.producer_role = record.anchor.sourceRole`(派生)
    - `header.producer_key = record.anchor.sourceKey ?? options.authority.stamped_by_key`(优先用 anchor 的,缺省用 stamp)
    - `header.priority = options.priority ?? "normal"`
    - `authority.team_uuid = record.anchor.teamUuid`(派生)
    - `authority.plan_level = options.authority.plan_level`
    - `authority.stamped_by_key = options.authority.stamped_by_key`
    - `authority.stamped_at = options.authority.stamped_at`
    - `authority.membership_level = options.authority.membership_level`(若提供)
    - `trace.trace_uuid = record.anchor.traceUuid`(派生)
    - `trace.session_uuid = record.anchor.sessionUuid`(派生)
    - `body.event_kind = "evidence." + record.kind`(即 `"evidence.assembly"` / `"evidence.compact"` / `"evidence.artifact"` / `"evidence.snapshot"`)
    - `body.detail = record`(完整 EvidenceRecord 作为 audit.record 的 detail)
  - **输出**:valid `NacpEnvelope`(经 `validateEnvelope` 通过 Layer 1-6)
- **`extractEvidenceFromAudit(envelope) → EvidenceRecord | null`**:
  - **输入**:validated `NacpEnvelope`
  - **行为**:
    - 若 `header.message_type !== "audit.record"` → return `null`
    - 若 `body.event_kind` 不以 `"evidence."` 开头 → return `null`(非 evidence 审计事件)
    - parse `body.detail` 通过 `EvidenceRecordSchema` → 若成功 return parsed `EvidenceRecord`;若失败(shape 不对)return `null`
  - **约束**:round-trip 可逆 — `extractEvidenceFromAudit(wrapEvidenceAsAudit(record, opts))` 必须返回与 `record` deeply equal 的 EvidenceRecord
- **一句话收口目标**:✅ **4 类 evidence record 双向 round-trip test pass;非 evidence 的 audit.record 返回 null;签名无 ctx 冗余(anchor 已承载跨 worker 身份)**

#### F8-F10 (superseded reference):其他(Matrix registration / RFC / tests)

- **F8**:在 `nacp-core/src/type-direction-matrix.ts` 的 `NACP_CORE_TYPE_DIRECTION_MATRIX` 加 5 条 `workspace.fs.*.request = command` + 5 条 `workspace.fs.*.response = [response, error]`
- **F9**:3 份 RFC:
  - `docs/rfc/nacp-workspace-rpc.md`
  - `docs/rfc/remote-compact-delegate.md`
  - `docs/rfc/evidence-envelope-forwarding.md`
- **F10**:root contract tests(放在 `test/` 根目录):
  - `test/workspace-rpc-contract.test.mjs`
  - `test/remote-compact-delegate-contract.test.mjs`
  - `test/evidence-forwarding-contract.test.mjs`

### 7.3 非功能性要求

- **性能目标**:
  - workspace RPC single op 延迟(service binding internal,同 colo)< 10ms P50 / < 50ms P99(Cloudflare 官方给出的 service binding 典型延迟基线)
  - remote compact delegate 不作为 user-visible hot path(async),无硬 latency 目标
  - evidence forwarding 无 batch / 每条走 envelope;如量过大由 W0 shipped `BoundedEvalSink` 的 overflow mechanism 自然 degrade
- **可观测性要求**:
  - 每条 workspace RPC envelope 带 CrossSeamAnchor trace header
  - 每个 delegate call 带 trace link 到原 kernel turn
  - evidence envelope 保持原 emitter 的 trace,不破坏 trace tree
- **稳定性要求**:
  - 所有 W1 新 schema 通过 1.3.0 消费者 compat test(它们不触及现有 family)
  - Layer 6 matrix 对新 type 严格;非法组合 fail-closed
- **测试覆盖要求**:
  - W1 新文件 unit test 覆盖 ≥ 90% lines
  - 3 份 root contract test 全绿
  - 继承 nacp-core 全包 regression(≥ 247 + N new = 247+ tests)

---

## 8. 可借鉴的代码位置清单

### 8.1 来自当前 `packages/nacp-core/src/messages/` 的 pattern

| 文件:行 | 内容 | 借鉴点 |
|---|---|---|
| `packages/nacp-core/src/messages/tool.ts:4-36` | request/response/cancel shape | workspace.fs.* 直接套用 request/response pair |
| `packages/nacp-core/src/messages/context.ts:5-30` | request/response with `history_ref` / `summary_ref` | NacpRef 在 body 中的正确用法;large payload 经 ref 不 inline |
| `packages/nacp-core/src/messages/system.ts:10-23` | audit.record schema + registerMessageType | F7 直接基于此构造 wrapper |
| `packages/nacp-core/src/type-direction-matrix.ts:17-40` | matrix entry 格式 | F8 append 到同一 const |
| `packages/nacp-core/src/error-registry.ts` | 错误 code 命名惯例 | `WORKSPACE_*` / `COMPACT_*` / `EVIDENCE_*` 前缀 |

### 8.2 来自 `packages/workspace-context-artifacts/src/namespace.ts`

| 文件:行 | 内容 | 借鉴点 |
|---|---|---|
| `namespace.ts:17-121` | 5 个 in-process method (readFile / writeFile / listDir / stat / deleteFile) | F1-F5 的 op 命名 + 返回 null 语义 |
| `namespace.ts:45-56` | readonly mount reject 路径 | F2 / F5 的 error path 直接复刻 |

### 8.3 来自 `packages/agent-runtime-kernel/`(若已有 compact delegate shape)

- 未完整看到 `CompactDelegate` 现有定义;F6 建议**新建**若不存在;若已有,保持 shape 兼容
- 预期位置:`packages/agent-runtime-kernel/src/compact/` 或 `packages/context-management/src/async-compact/kernel-adapter.ts`
- 后者已有 `createKernelCompactDelegate` 函数 — F6 的 remote 版本是其姊妹实现

### 8.4 需要避开的反例

| 位置 | 问题 | 我们为什么避开 |
|---|---|---|
| 自行发明的 "workspace.batch.*" | 过早 batch 协议 | §3.1 砍;单 op/envelope 足够 |
| 复用 `tool.call.request` 承载 fs op | 语义污染 | fs op 不是 tool;role gate 不匹配 |
| 新增 `evidence.emit` family | 不必要的 surface 膨胀 | §4.3 说明 audit.record 足够 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

W1 的 cross-worker protocol triad 是 nano-agent 从"单 worker in-process" 走向"多 worker 协议协作"的**最后一块关键协议砖**。

- **存在形式**:作为 `nacp-core 1.4.0` 的 additive 新增(5-6 个 `workspace.fs.*` message types + 2 个 cross-worker helper)
- **覆盖范围**:3 对关键 cross-worker 通讯(filesystem authority / compact delegate / evidence forwarding)
- **与其他部分耦合**:与 W0 是**前后耦合**(W1 body schema 引用 W0 吸收的 evidence vocabulary + storage-law);与 W2 是**发布耦合**(W1 新符号必须包含在 1.4.0 首次发布的 GitHub Packages artifact 里);与 W3/W4 **无直接耦合**(那是 worker 级工作)
- **预期代码量级**:
  - `nacp-core/src/messages/workspace.ts`:~150-200 行
  - `nacp-core/src/transport/compact-delegate.ts`:~80-120 行
  - `nacp-core/src/evidence/forwarding.ts`:~60-100 行
  - `nacp-core/src/type-direction-matrix.ts` 增量:~15 行
  - 3 份 root test:合计 ~300-400 行
  - 3 份 RFC:合计 ~600-900 行
- **预期复杂度**:中 — 每个协议独立简单,但需要与 W0 consolidated NACP 保持一致性 + 1.3.0 消费者零破坏

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|---|---|---|
| 对 nano-agent 核心定位的贴合度 | **5** | 是"协议决定工程形态"这一纪律的直接延伸 |
| 第一版实现的性价比 | **4** | 3 条协议聚焦 + 复用 2 条既有 family,surface 增量很小 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | **5** | workspace RPC 为所有未来 worker 的 fs 访问提供公共地基;skill.core 等不需重走 |
| 对开发者自己的日用友好度 | **4** | protocol-level 工作非 day-to-day,但收口后 worker-matrix 执行效率大幅提升 |
| 风险可控程度 | **4** | additive-only + Layer 6 matrix + 1.3.0 compat shim 多重约束;唯一不确定性在 workspace RPC 的 schema 完备性 |
| **综合价值** | **4.5** | 标准 "不性感但 load-bearing" 的基础设施工作 |

### 9.3 下一步行动

- [ ] **决策确认**:owner 在本 design owner-approve 前列表确认:
  - §7.1 F1-F5 的 schema 草案是否接受?
  - §6.1 取舍 3(audit.record 复用 vs evidence.* family)是否接受?
  - §6.1 取舍 4(per-op schema vs 共用 discriminator)是否接受?
  - `workspace.fs.*` 的 producer role gate 收窄到哪 3 种(session / capability / skill)是否接受?
- [ ] **关联 RFC 撰写**(由本 design owner-approve 后触发):
  - `docs/rfc/nacp-workspace-rpc.md`
  - `docs/rfc/remote-compact-delegate.md`
  - `docs/rfc/evidence-envelope-forwarding.md`
- [ ] **关联 action-plan**:`docs/action-plan/pre-worker-matrix/D2-cross-worker-protocols.md`(基于本 design 展开执行批次)
- [ ] **待深入调查的子问题**:
  - `CompactDelegate` TS interface 是否已在 `agent-runtime-kernel` 存在?若存在,F6 仅扩展 remote 实装;若不存在,F6 含 interface 定义
  - `NacpRef.kind` 是否需扩展 `"evidence-large"` 让超 96KB 的 evidence 走 ref?(若 evidence body 不可能超,无需)
- [ ] **需要同步更新的其他设计文档**:
  - `W0-nacp-consolidation.md`(如尚未写):evidence vocabulary shape 要与 F7 的 `wrapEvidenceAsAudit` 的 `event_kind` 前缀 `"evidence."` 对齐
  - `W3-absorption-blueprint-capability-runtime.md`(W3 阶段):bash.core fs handler 必须从"直接 import WorkspaceFsLike" 迁移到"通过 workspace RPC 调 filesystem.core",blueprint 需预告这件事
  - `W3-absorption-blueprint-context-management.md`(W3 阶段):kernel compact 消费点必须从"in-process delegate" 迁到 "remote delegate"
  - `W3-absorption-blueprint-workspace-context-artifacts.md`(W3 阶段):evidence-emitters helper 重构为"发 audit.record envelope",不直接调 local sink

---

## 附录

### A. 讨论记录摘要

- **分歧 1**:workspace RPC 走 NACP envelope vs raw service-binding RPC
  - **Opus 倾向**:NACP envelope(单协议路径纪律)
  - **潜在 owner 反向**:性能(5-10ms overhead per op)
  - **当前共识**:NACP envelope;重评条件为 profile 显示 > 20% latency budget
- **分歧 2**:evidence 是新 family 还是复用 audit.record
  - **早期提案**:新 `evidence.emit` family
  - **当前共识**:audit.record + `event_kind = "evidence.<kind>"` + `detail = record`
- **分歧 3**:compact delegate 是否新增 message
  - **早期提案**:`kernel.compact.delegate.*` 专属
  - **当前共识**:直接复用 `context.compact.*`;delegate 只是消费端抽象

### B. 开放问题清单

- [x] ~~**Q1**:`NacpRef.kind` 当前允许值是什么?`workspace.fs.read.response.content_ref` 的 kind 应是 `do-storage` / `r2` / 新增 `workspace`?~~ — **Resolved by W0 §7.2 C5**:`NacpRefSchema` 保留在 `nacp-core/src/envelope.ts`(W0 不迁);不新增 `workspace` kind,复用现有 `do-storage` / `r2`;由 W0 吸收后的 `buildDoStorageRef` / `buildR2Ref` helpers 生成。
- [ ] **Q2**:`CompactDelegate` 是否已在 `agent-runtime-kernel` 存在?若存在,F6 是否与之兼容?(需读 agent-runtime-kernel/src/ 确认)
- [ ] **Q3**:`workspace.fs.*` 是否需 cancel message?(当前倾向否 — op 同步短时;但若未来出现长时 list/walk 操作可能需 revisit)
- [ ] **Q4**:`audit.record` 扩张后,消费者如何 distinguish "审计事件" vs "evidence 转发"?(当前:用 `event_kind` 前缀 `"evidence."` 区分;but audit.* 过滤器需明确更新)
- [ ] **Q5**:workspace RPC 的 tenant 粒度 — 是否允许一个 session 的 workspace RPC 调 filesystem.core 访问另一 team 的文件?(当前默认:**禁止**,由 authority.team_uuid 强制;但可能需 explicit RFC 语句)

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|---|---|---|---|
| v0.1 | 2026-04-21 | Claude Opus 4.7 | 初稿:3 条协议的 schema + matrix/role + helper + RFC 规划 |
| v0.2 | 2026-04-21 | Claude Opus 4.7 | W0 design 完成后的回顾性修订:§4 新增 §4.5 sibling W0 pattern 借鉴;§7.2 F7 `wrapEvidenceAsAudit` 签名从 `(record, ctx)` 精确化为 `(record, options)` — ctx 的 trace/session/team 字段从 record.anchor 派生,options 只承载 envelope_message_uuid / envelope_sent_at / authority 补足字段;§9.3 Q1 标记为 resolved by W0 §7.2 C5 |
| **v0.3** | 2026-04-21 | Claude Opus 4.7 | **MAJOR DOWNGRADE — Post-GPT-review narrowing**(GPT review 盲点 4 整改)。将整份 design 从 "code-ship + RFC" 降级为 **"RFC-only"**:<br/>• §0.2 前置共识调整:本 design 只产 RFC,不实装代码<br/>• §0.5 新增 "MAJOR DOWNGRADE 说明" — 解释 Layer 3 远期工作不应前移<br/>• §5.1 S1-S12 逐条降级/删除(S3/S6/S7/S10 保留,其他删或降级)<br/>• §5.1.1 新增 "v0.3 In-Scope 净清单" — 只剩 R1-R4 共 4 条 RFC-focused items<br/>• §7 功能详述保留作为 RFC 起草 reference material,**不作为实装规格**<br/>• §9.1 功能簇画像:代码量级从 ~500 行 TS 降为 ~0 行 TS + ~900-1200 行 RFC 文档<br/>**净效果**:W1 工作量减少 ~75%(仅留 RFC 写作);worker-matrix first-wave 不再被阻塞在 3 条新协议实装上;实装延后到 live loop 证据驱动的未来 phase |

### D. 修订综述

**v0.3 核心原则**(post-GPT-review):Pre-worker-matrix 的 W1 责任是 **冻结未来跨 worker 协议的方向**(写 RFC),**不是**提前把代码写完。Layer 3 远期工作(workspace.fs.* 实装、remote compact delegate 实装、evidence forwarding helper)由 worker-matrix 后续 phase 的 live loop 证据驱动。

**本 design 的 v0.2 精确化工作**(`wrapEvidenceAsAudit` 签名设计)作为 **RFC-quality reference material** 保留在 §7.2 F7;未来实装时可直接采用。但本阶段不 ship TS code。

**W1 在新 pre-worker-matrix 的 charter r2 里的角色**:§4.1 B 降级为 3 份 RFC;§11 exit criteria 第 5 条中 "方向性 RFC × 3 shipped" 是本 design 的唯一硬交付。
