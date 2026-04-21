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
> 文档状态:`draft (v0.2 revised post-W0)`
>
> **修订历史:**
> - **v0.1 (2026-04-21)**:初稿
> - **v0.2 (2026-04-21)**:W0 design 完成后的回顾性修订 3 处 —— §4 新增 §4.5 引用 W0 sibling design pattern;§7.2 F7 的 `wrapEvidenceAsAudit` 签名基于 W0 §7.2 C3 的 `EvidenceAnchorSchema` 精确化(ctx 冗余消除);§9.3 Q1 标记为 resolved by W0 §7.2 C5。

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

这 3 条通讯面在 `nacp-core 1.3.0` 下都**无现成协议承载**,所以 W1 存在:**为这 3 条通讯设计并实装最小协议**,作为 `nacp-core 1.4.0` 的一部分 ship,是 worker-matrix 阶段真正独立跨 worker 的前置条件。

### 0.2 前置共识(不再辩论)

- **γ/β 路线已确定**:owner 已在讨论中选定,**不重启方向级讨论**;本 design 只负责**具体 shape 与实装细节**
- **所有 cross-worker 通讯必须经 NACP 协议层**:不允许 "side-channel RPC" 或 "in-process shortcut"(违反 Tier A/B 分离)
- **1.3.0 消费者零破坏**:W1 所有新增协议 additive 进 1.4.0,现有 `tool.call.*` / `context.compact.*` / `hook.*` / `audit.*` / `system.*` 契约不改
- **Layer 6 matrix 强制**:所有新 message types 必须在 `NACP_CORE_TYPE_DIRECTION_MATRIX` 注册
- **tenant boundary 强制**:所有新 message 必须经 `verifyTenantBoundary` gate
- **W0 先于 W1 实装**:本 design 可先写,但实装需等 W0 的 evidence vocabulary / storage-law / cross-seam helper 落到 nacp-core 后再接

### 0.3 显式排除

- 不设计 `orchestrator.*` namespace(post-worker-matrix phase)
- 不设计 `skill.*` 相关协议(skill.core deferred)
- 不为每个 evidence 类型单独开 NACP message family(违反"最小扩展"纪律)
- 不设计 "client → worker-matrix 内部 worker" 的 route(客户端仍然只通过 agent.core 的 session protocol)
- 不在本 design 里讨论协议的 transport 层细节(service binding 本身的握手 / 重试 / 负载均衡属 Cloudflare 平台层,不属协议层)

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**:`Cross-Worker Protocol Triad`(W1 三件套)
- **一句话定义**:为 worker-matrix 阶段的 3 对关键 cross-worker 通讯设计最小可实装的 NACP 协议扩展
- **边界描述**:
  - **包含**:γ workspace RPC / β remote compact delegate / cross-worker evidence forwarding 三条通讯的 wire shape + schema + matrix/role entry + delegate helper 代码
  - **不包含**:上述通讯的 runtime 实现(那是各 worker 的 consumer 职责)、端到端 live turn loop 验证(那是 worker-matrix 的 Phase 0 exit criteria)

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

### 2.1 角色

- **在整体架构里的角色**:协议层的 3 块新基石,它们让 Tier B 逻辑层 absorption 之后的 workers 仍然能**按协议组合**
- **服务于**:worker-matrix 阶段的 4 个 first-wave worker(agent/bash/context/filesystem);间接服务于未来的 skill.core / 其他独立 worker
- **依赖**:W0 已经把 evidence vocabulary / cross-seam anchor / storage-law 吸收进 nacp-core(W1 message 的 body schema 会 import 这些)
- **被谁依赖**:worker-matrix P0 所有 absorption + service-binding wiring;各 worker 的测试 harness

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| `nacp-core` envelope validator | W1 extends | 强 | 新 message types 必须通过 Layer 1-6 全部校验 |
| `nacp-core` matrix | W1 register | 强 | 6 条新 type 要进入 `NACP_CORE_TYPE_DIRECTION_MATRIX` |
| `nacp-core` tenant helpers | W1 consume | 强 | 所有新 message 带 authority,verify 走统一 helper |
| `nacp-core` evidence vocabulary(W0) | W1.3 consume | 强 | audit.record.detail 承载 evidence record shape |
| `nacp-core` storage-law(W0) | W1.1 consume | 强 | workspace.fs.* 的 path + ref 走 storage-law |
| `context.compact.*`(1.3 已存在) | W1.2 复用 | 强 | 不新增 message,只做 delegate 实装 |
| `tool.call.*`(1.3 已存在) | W1 正交 | 弱 | tool.call 是 agent→capability worker;workspace.fs 是 capability→filesystem worker,不耦合 |
| service binding transport(Cloudflare 平台) | W1 承载于 | 中 | 平台层不归我们管;W1 只规定 wire shape |
| BoundedEvalSink(W0 吸收后) | W1.3 consume | 强 | evidence 转发终点 |

### 2.3 一句话定位陈述

> 在 nano-agent 里,`Cross-Worker Protocol Triad` 是**协议扩展包**,负责**新增 workspace RPC + 复用 compact 协议做 remote delegate + 以 audit.record 包裹 evidence 转发**,对上游(worker-matrix P0)提供**3 条已冻结的跨 worker 通讯 contract**,对下游(worker 实装)要求**严格按协议 shape 生产/消费,不得 side-channel**。

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

### 5.1 In-Scope(W1 第一版必须完成)

- **[S1]** `workspace.fs.*` NACP message family 设计 + schema(5-6 条 message types)
- **[S2]** `workspace.fs.*` 注册进 Layer 6 matrix + role gate + body schemas
- **[S3]** `workspace.fs.*` RFC 文档(`docs/rfc/nacp-workspace-rpc.md`)
- **[S4]** `CompactDelegate` TS interface 冻结(在 `@nano-agent/agent-runtime-kernel`)
- **[S5]** `createRemoteCompactDelegate(binding, ctx)` helper 实装(in `@nano-agent/nacp-core` 或 agent-runtime-kernel)
- **[S6]** β delegate 使用 existing `context.compact.request/response`,不新增 message type
- **[S7]** β RFC 文档(`docs/rfc/remote-compact-delegate.md`)
- **[S8]** `wrapEvidenceAsAudit(record) → NacpEnvelope` helper
- **[S9]** `extractEvidenceFromAudit(envelope) → EvidenceRecord | null` helper
- **[S10]** γ RFC 文档(`docs/rfc/evidence-envelope-forwarding.md`)
- **[S11]** 3 条协议的 root contract tests(每条至少 legality / happy path / error path 3 用例)
- **[S12]** `nacp-core 1.4.0` ship 包含上述所有新 symbol + 新 message family

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

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|---|---|---|---|
| F1 | `workspace.fs.read.request/response` | filesystem.core 上文件读取 RPC | ✅ 能通过 service binding 完成 read,body 通过 Layer 4/6 验证 |
| F2 | `workspace.fs.write.request/response` | filesystem.core 上文件写入 RPC | ✅ 同上,支持 readonly mount reject |
| F3 | `workspace.fs.list.request/response` | 目录列出 RPC | ✅ 同上,返回 file entries |
| F4 | `workspace.fs.stat.request/response` | 文件元数据 RPC | ✅ 同上,`null` 用 error response 表达 |
| F5 | `workspace.fs.delete.request/response` | 文件删除 RPC | ✅ 同上,支持 readonly mount reject |
| F6 | `CompactDelegate` TS interface + `createRemoteCompactDelegate()` helper | β 路线 remote compact wiring | ✅ kernel 可无感知切换 local / remote delegate |
| F7 | `wrapEvidenceAsAudit` / `extractEvidenceFromAudit` helpers | cross-worker evidence envelope forwarding | ✅ 4 类 evidence record 可双向 round-trip |
| F8 | 3 条协议的 matrix + role gate registration | Layer 6 强制 | ✅ 非法 `(type, delivery_kind)` 被 reject |
| F9 | 3 份 RFC 文档 | 正式协议文档 | ✅ owner-approved 作为 1.4.0 一部分 |
| F10 | root contract tests | W1 整体 contract 守护 | ✅ 每条协议 legality + happy + error 3 用例 |

### 7.2 详细阐述

#### F1: `workspace.fs.read.request` / `workspace.fs.read.response`

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

#### F2: `workspace.fs.write.request` / `workspace.fs.write.response`

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

#### F3: `workspace.fs.list.request` / `workspace.fs.list.response`

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

#### F4: `workspace.fs.stat.request` / `workspace.fs.stat.response`

- **输入**:`{path: string}`
- **输出**:`{status, entry?: FileEntry, error?}`(not-found 走 `error.code: "WORKSPACE_NOT_FOUND"`)
- **一句话收口目标**:✅ **schema + matrix/role + test(exist / not-found 2 用例)**

#### F5: `workspace.fs.delete.request` / `workspace.fs.delete.response`

- **输入**:`{path: string}`
- **输出**:`{status, deleted?: boolean, error?}`
- **一句话收口目标**:✅ **schema + matrix/role + test(happy / readonly / not-found 3 用例)**

#### F6: `CompactDelegate` interface + `createRemoteCompactDelegate`

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

#### F7: `wrapEvidenceAsAudit` / `extractEvidenceFromAudit`

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

#### F8-F10:其他(Matrix registration / RFC / tests)

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
