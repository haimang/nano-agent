# Nano-Agent 代码审查

> 审查对象: `zero-to-real 全阶段 + 6-worker 架构 + packages/ 全量`
> 审查类型: `mixed`
> 审查时间: `2026-04-29`
> 审查人: `GLM-5.1`
> 审查范围:
> - `workers/orchestrator-core/**`
> - `workers/orchestrator-auth/**`
> - `workers/agent-core/**`
> - `workers/bash-core/**`
> - `workers/context-core/**`
> - `workers/filesystem-core/**`
> - `packages/nacp-core/**`
> - `packages/nacp-session/**`
> - `packages/jwt-shared/**`
> - `packages/orchestrator-auth-contract/**`
> - `packages/workspace-context-artifacts/**`
> - `packages/eval-observability/**`
> - `packages/storage-topology/**`
> - `clients/api-docs/**`
> - `test/**`
> - `scripts/deploy-preview.sh`
> 对照真相:
> - `docs/charter/plan-zero-to-real.md`
> - `docs/charter/plan-worker-matrix.md`
> - `docs/code-review/zero-to-real/ZX5-reviewed-by-GPT.md`（仅作参照事实源，判断独立于 GPT 审查结论）
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`zero-to-real 阶段已完成大量结构正确性工作——NACP 协议基石坚实、6-worker 拓扑物化、auth RPC 独立 worker 已上线、D1 truth 层已铺到 ZX5、facade 公开面已从 3 个路由扩展到 16 个。但在协议完整性、charter-代码对齐、运行时闭环三个维度上存在尚未闭合的断点：NACP 错误信封生产路径不可用（空 verb set）、context-core/filesystem-core 尚未脱离 shim 状态、Lane F runtime kernel hookup 直至 defer 仍未有实装计划、charters 声称的吸收完成与代码现实之间存在系统性漂移。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `NACP 错误信封生产路径（wrapAsError）与空 NACP_ERROR_BODY_VERBS 互斥——validateEnvelope 会拒绝所有错误类型 message_type，这是协议层的真实断点，不是语义问题。`
  2. `worker-matrix charter 声称 "runtime ownership 已落在 workers/*/src/"，但 context-core 和 filesystem-core 实际是 3 个 RPC 方法的 probe-only shim；agent-core 仍通过包级 import 消费 context-core，binding 仍注释态。吸收与 charter 叙事漂移严重。`
  3. `handleRead 中 timeline 的 D1-first/RPC-fallback 双路径逻辑与 status 路径的结构不一致，加上 orchestrator-core 缺少 facadeFromRpcEnvelope() 通用桥接函数，导致信封包装逻辑脆弱且不可扩展。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-zero-to-real.md`（Z0-Z4 完整 charter）
  - `docs/charter/plan-worker-matrix.md`（P0-P5 worker matrix charter）
  - `docs/code-review/zero-to-real/ZX5-reviewed-by-GPT.md`（ZX5 审查事实参照）
- **核查实现**：
  - `workers/orchestrator-core/src/{index,user-do,auth,session-truth,session-lifecycle,frame-compat,parity-bridge,ws-bridge,catalog-content}.ts`
  - `workers/orchestrator-core/src/policy/authority.ts`
  - `workers/orchestrator-auth/src/{index,service,jwt,repository,errors,public-surface,wechat,hash}.ts`
  - `workers/agent-core/src/{index,host/do/nano-session-do,host/runtime-mainline,hooks/permission}.ts`
  - `workers/bash-core/src/{index,executor,fake-bash/commands,fake-bash/bridge,tool-call,targets/service-binding,policy}.ts`
  - `workers/context-core/src/index.ts`
  - `workers/filesystem-core/src/index.ts`
  - `workers/*/wrangler.jsonc`（6 份全量）
  - `packages/nacp-core/src/{envelope,error-body,rpc,tenancy,transport,hooks-catalog,storage-law,state-machine,admissibility,version,evidence,observability}.ts`
  - `packages/nacp-session/src/{messages,type-direction-matrix,session-registry,frame,websocket,ingress,replay,delivery,heartbeat,stream-event,redaction,upstream-context,errors,version}.ts`
  - `packages/jwt-shared/src/index.ts`
  - `packages/orchestrator-auth-contract/src/{index,facade-http}.ts`
  - `packages/workspace-context-artifacts/src/` 全量
  - `packages/eval-observability/src/` 全量
  - `packages/storage-topology/src/` 全量
  - `clients/api-docs/{README,session,session-ws-v1,permissions,me-sessions,catalog,worker-health,wechat-auth,usage}.md`
  - `workers/orchestrator-core/migrations/001-identity-core.sql` 至 `007-user-devices.sql`
  - `test/` 目录结构及 root-guardians、cross-e2e 关键测试文件
  - `scripts/deploy-preview.sh`
- **执行过的验证**：
  - `pnpm test:contracts`（31/31 through）
  - `bash -n scripts/deploy-preview.sh`（语法通过）
  - `find workers -mindepth 1 -maxdepth 1 -type d | wc -l`（结果 = 6）
  - `grep -rn` 多组关键词核查
- **复用 / 对照的既有审查**：
  - `docs/code-review/zero-to-real/ZX5-reviewed-by-GPT.md` — 仅作事实参照（客户端文档漂移、Lane F/E 措辞降级等已修复事实）；本文件的判断完全独立，不采纳 GPT 的结论等级或修法建议。

### 1.1 已确认的正面事实

- 6 个 worker 目录物理存在，wrangler 绑定拓扑与 charter 声称一致（orchestrator-core 为唯一 public façade，orchestrator-auth / agent-core / bash-core / context-core / filesystem-core 为 internal-only）。
- `packages/jwt-shared` 抽取成功：orchestrator-core 和 orchestrator-auth 均使用 `verifyJwtAgainstKeyring` 统一验证路径，kid rotation 测试各 3 unit 通过。
- `packages/orchestrator-auth-contract` 的 `FacadeErrorCode` 对 `AuthErrorCode` 和 `RpcErrorCode` 的超集断言正确，编译期类型守卫有效。
- Z1-Z5 的 D1 migration 链（identity-core → session-truth → hardening → usage → usage-events → pending-status → user-devices）完整可追溯，共 7 个 migration 文件，全部使用 `CREATE TABLE IF NOT EXISTS` 保证幂等。
- NACP transport 三层流水线（validateEnvelope → verifyTenantBoundary → checkAdmissibility）在 ServiceBindingTransport / DoRpcTransport / QueueTransport 均已实装并强制执行。
- bash-core capability runtime 完整吸收：21-command registry、policy gate（allow/ask/deny）、service-binding transport 目标、tool.call.* body bridge 均已落地于 `workers/bash-core/src/`。
- orchestrator-auth 的 `assertAuthMeta` 严格执行 `caller === "orchestrator-core"` 单一调用者约束，无公开路由，与 charter §1.7 一致。
- session-truth.ts 的全部 D1 查询使用参数化绑定（`?1`, `?2`），无 SQL 注入风险。
- ZX5 review 后的 D3 修复已落地：`handleMessages` 现在走 `forwardInternalJsonShadow('input', ...)` 驱动 agent-runtime，`/input` 已归一为 `/messages` 的 thin alias。

### 1.2 已确认的负面事实

- `NACP_ERROR_BODY_VERBS` 为空 `Set<string>`（error-body.ts:57），`wrapAsError()` 产出的错误信封因 message_type 不在 `NACP_MESSAGE_TYPES_ALL` 注册集中而无法通过 `validateEnvelope()`——这是协议层断点。
- context-core 和 filesystem-core 的 `src/index.ts` 各只暴露 3 个 RPC 方法（`probe`, `nacpVersion`, `contextOps/filesystemOps`），无任何业务逻辑实现；agent-core 仍通过 `import { appendInitialContextLayer } from "@haimang/context-core-worker/context-api/append-initial-context-layer"` 包级导入消费 context-core，binding 仍注释态。
- bash-core `BashCoreAllowedCallers` 包含不存在的 `"runtime"` 调用者（index.ts:441），无对应 worker，属于残留幽灵值。
- 三层错误信封格式（`NacpEnvelope` / `Envelope<T>` / `FacadeEnvelope<T>`）并存且缺少 `facadeFromRpcEnvelope()` 桥接；弃用路径上的 `forwardInternalJsonShadow` 方法名仍保留"dual-track 遗迹"语义。
- `handleRead` 中 `action === 'timeline'` 的双路径（D1-first 尝试 + RPC fallback）与 `status` 路径（D1+RPC merge）采用不同合并策略，且 timeline 双 if-block 中间穿插 status block，降低可维护性。
- `VerifyApiKeyResultSchema` 返回 `{supported: false, reason: "reserved-for-future-phase"}`——这与 charter Z2 In-Scope "最小 API key verify 运行时路径" 矛盾。
- `hashSecret` 使用 `SHA-256(salt:raw)` 而非 bcrypt/scrypt/argon2——在 Workers 环境下是已知妥协，但 charter 未显式声明此安全边界。
- `NacpObservabilityEnvelopeSchema` 未在 nacp-core 主 index.ts 导出，只能通过子路径 `@haimang/nacp-core/observability` 访问。
- `@nano-agent/` 与 `@haimang/` 双 package scope 并存（workspace-context-artifacts、eval-observability、storage-topology 用 `@nano-agent/`；nacp-core、nacp-session、jwt-shared、orchestrator-auth-contract、context-core-worker 用 `@haimang/`），且 `context-core-worker` 的 npm scope 又与 worker 目录名不一致。
- `SessionStatus` 与 `DurableSessionStatus` 值域完全相同但类型独立声明于不同文件。
- `users/orchestrator-auth/src/hash.ts` 的 `randomOpaqueToken` 使用 `crypto.getRandomValues`，但 `hashSecret` 使用确定性 SHA-256 以固定 salt 格式 `salt:raw`——若 salt 泄露则 hash 可被预计算。
- `CapabilityCallDO`（bash-core index.ts:324-353）不管理任何持久状态，无用 DO 语义，更像是函数式 service 而非 stateful DO。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 全量核查了 6 个 worker entry、包级 barrel、wrangler.jsonc、key 源码文件 |
| 本地命令 / 测试 | `yes` | `pnpm test:contracts` 31/31 通过；`bash -n scripts/deploy-preview.sh` 语法通过；`find workers` 确认 6 worker 目录 |
| schema / contract 反向校验 | `yes` | 对照 nacp-core envelope/error-body/rpc 与 session message matrix、auth-contract facade-http 与 orchestrator-core 实际路由 |
| live / deploy / preview 证据 | `no` | 未对 preview deploy 环境做 live 验证，sandbox 限制 |
| 与上游 design / QNA 对账 | `yes` | 对照 plan-zero-to-real.md 与 plan-worker-matrix.md 逐项审查 In-Scope / Out-of-Scope 完成度 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | NACP 错误信封生产路径与空 verb set 互斥 | `critical` | `correctness` | `yes` | 注册错误类型 verbs 或重构 wrapAsError 使其产出合法信封 |
| R2 | context-core / filesystem-core 尚未脱离 probe-only shim，与 worker-matrix charter 叙事严重漂移 | `high` | `scope-drift` | `yes` | 在 closure 文档中明确标注 "library-worker-posture/shim period"，或推进真正吸收 |
| R3 | 三层错误信封格式并存且缺少 facadeFromRpcEnvelope 桥接 | `high` | `protocol-drift` | `yes` | 统一到 FacadeEnvelope 为唯一公开信封格式，补 facadeFromRpcEnvelope 桥接函数 |
| R4 | VerifyApiKeyResultSchema 返回 supported:false，与 charter Z2 In-Scope 矛盾 | `high` | `delivery-gap` | `yes` | 要么实装最小 verify 路径，要么在 charter 中将 API key verify 降级为 "reserved-for-future-phase" |
| R5 | handleRead 的 timeline 双路径与 status 路径结构不一致 | `medium` | `platform-fitness` | `no` | 统一 read-path 合并策略，或将 timeline 的 D1-first/RPC-fallback 逻辑显式文档化 |
| R6 | bash-core BashCoreAllowedCallers 包含幽灵调用者 "runtime" | `medium` | `protocol-drift` | `no` | 移除 "runtime" 或标注其来源与意图 |
| R7 | SHA-256(salt:raw) 密码哈希方案未在 charter 中声明安全边界 | `medium` | `security` | `no` | 在 design 文档中显式声明此为 Workers 环境已知妥协与升级路径 |
| R8 | last_seen_at 在内部多处使用其原始含义（KV session entry、touch logic），与 ZX5 review 的 rename 仅作用于 /me/conversations 响应体 | `medium` | `protocol-drift` | `no` | 在 session-truth 和 user-do 全量替换内建字段名为 latest_session_started_at，或显式文档化 KV 字段 last_seen_at 实际语义 |
| R9 | D1 单数据库 UUID 跨 3 个 worker 共享，migration 目录独立管理，无跨 worker migration 冲突防护 | `medium` | `platform-fitness` | `no` | 在 orchestrator-core 主控 migration 以外显式标注 "single-writer" 约束，或引入 migration 协调层 |
| R10 | CapabilityCallDO 无持久状态管理，DO 语义冗余 | `low` | `platform-fitness` | `no` | 将 CapabilityCallDO 降级为 WorkerEntrypoint 方法，或文档化为 future stateful-tracking 预留 |
| R11 | NacpObservabilityEnvelopeSchema 未在 nacp-core 主 index 导出 | `low` | `docs-gap` | `no` | 补充 export 或在 README 中标注子路径导入方式 |
| R12 | @nano-agent/ 与 @haimang/ 双 scope 并存 | `low` | `protocol-drift` | `no` | 在 P5 cutover milestone 中统一为 @haimang/，或显式文档化双 scope 过渡策略 |

### R1. NACP 错误信封生产路径与空 verb set 互斥

- **严重级别**：`critical`
- **类型**：`correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `packages/nacp-core/src/error-body.ts:57` 声明 `export const NACP_ERROR_BODY_VERBS: ReadonlySet<string> = new Set<string>()`——初始化为空集合。
  - `packages/nacp-core/src/error-body.ts:73-87` 的 `wrapAsError()` 构造一个 `{header: {message_type: "error"}, ...}` 信封，其中 `message_type` 为 `"error"`。
  - `packages/nacp-core/src/envelope.ts:312-316` 的 `validateEnvelope()` 在校验时检查 `NACP_MESSAGE_TYPES_ALL.has(env.header.message_type)`——如果 `message_type` 不在注册集中，抛出 `NacpValidationError`。
  - 注册集由各 message 模块的 `registerMessageType()` 填充。`"error"` 作为 message_type 从未被注册（目前注册的是 `"session.start"`, `"tool.call.request"` 等）。
  - 因此：任何通过 `wrapAsError()` 产出的 NACP 错误信封都无法通过 `validateEnvelope()` 校验。
- **为什么重要**：
  - 这是 NACP 协议层的一个真实断点，不是语义问题。所有 worker-to-worker RPC 通信路径都依赖 `validateEnvelope()` 做入口校验，如果错误响应无法被合法包装和传输，那么跨 worker 错误传播就没有标准化路径。
  - 当前代码之所以仍能运行，是因为多数 RPC 路径使用 `Envelope<T>`（rpc.ts）而非 NACP 1.x `NacpEnvelope`。但 `NacpEnvelope` 在 transport 层（ServiceBindingTransport、DoRpcTransport）的 `validateEnvelope` 是强制执行的，如果某条 RPC 路径触发了 NACP-level 错误传播，它将被 transport 层拒绝。
  - 注释在 error-body.ts:18-37 明确标注 `"Populated by the forthcoming per-verb migration PR (RFC §3.3)"`。这说明这个空集合是故意留白的，但从协议完整性角度看，只要 transport 层强制 `validateEnvelope`，这个留白就等于协议断点。
- **审查判断**：
  - NACP 错误信封生产路径当前不可用。如果 transport 层收到一个 `message_type: "error"` 的信封，当前的 `NACP_MESSAGE_TYPES_ALL` 不包含 `"error"`，`validateEnvelope` 会拒绝它。
  - 这在当前运行时暂时不会触发（因为所有实际错误路径走 `Envelope<T>` 或 `FacadeEnvelope<T>`），但协议层的正确性漏洞是真实的。
- **建议修法**：
  - 方案 A（最小修复）：在 `error-body.ts` 中 `registerMessageType("error", NacpErrorBodySchema)` 注册错误类型。
  - 方案 B（协议级重构）：将错误处理统一到 `Envelope<T>` 的 `ok: false` 路径，`NacpErrorBodySchema` 标记为 deprecated。
  - 无论选哪个，`wrapAsError()` 和 `validateEnvelope()` 的矛盾必须被显式解决。

### R2. context-core / filesystem-core 尚未脱离 probe-only shim，与 worker-matrix charter 叙事严重漂移

- **严重级别**：`high`
- **类型**：`scope-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `workers/context-core/src/index.ts:61-106` 暴露的 RPC 方法仅为 `probe()`, `nacpVersion()`, `contextOps()`——其中 `contextOps()` 只返回 3 个 op 名字符串（`["appendInitialContextLayer", "drainPendingInitialContextLayers", "peekPendingInitialContextLayers"]`），没有实际业务逻辑。
  - `workers/filesystem-core/src/index.ts:71-85` 同样暴露 `probe()`, `nacpVersion()`, `filesystemOps()`——只返回 3 个 op 名字符串。
  - `workers/agent-core/wrangler.jsonc:41-48` 中 `CONTEXT_CORE` 和 `FILESYSTEM_CORE` binding 仍为注释态：`// { "binding": "CONTEXT_CORE", "service": "nano-agent-context-core" }`。
  - `workers/agent-core/src/host/do/nano-session-do.ts:34-35` 仍直接通过包级导入消费 context-core：`import { appendInitialContextLayer } from "@haimang/context-core-worker/context-api/append-initial-context-layer"`。
  - 而 `plan-worker-matrix.md §9 Exit Criteria #2` 明确声称："4 workers 的 runtime ownership 已落在 `workers/*/src/`，packages/ 不再是 runtime 归属"。P5 closure 声称 context-core / filesystem-core absorption 完成（P3/P4 closure）。
  - `test/INDEX.md:126-130` 仍把两者描述为 `remain probe-only`。
- **为什么重要**：
  - Charter 是执行真理。如果 charter 声称 "runtime ownership 已吸收到 workers/*/src/" 但代码现实是 context-core 和 filesystem-core 只有 3 个 RPC 方法的 shim壳、agent-core 仍通过包级 import 消费它们、binding 仍注释态、测试矩阵仍标注 probe-only，那 charter 的退出条件就没有真正满足。
  - 这个漂移不仅是文档问题——如果有人依赖 charter 描述来理解系统拓扑，他们会对 context-core 和 filesystem-core 的运行身份产生根本性误解。
- **审查判断**：
  - 当前更准确的状态是：**context-core 和 filesystem-core 已完成 WorkerEntrypoint shim 部署（ZX5 Lane E），但尚未脱离 probe-only posture 吸收真实 substrate runtime。agent-core 仍通过包级 import 消费两者。**
  - 这与 charter 声称的 "P3/P4 absorption 完成" 不是同一事实。
- **建议修法**：
  - 要么推进真正的吸收（打开 binding、将 agent-core 消费路径切到 RPC、context-core/filesystem-core 承担实际运行时职责）；
  - 要么在 worker-matrix closure 和当前架构文档中将两者明确标注为 "library-worker-posture, in-process shim period"，并显式记录哪些 substrate 代码仍在 `packages/` 中被 agent-core 直接消费。

### R3. 三层错误信封格式并存且缺少 facadeFromRpcEnvelope 桥接

- **严重级别**：`high`
- **类型**：`protocol-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - 系统中存在三种错误信封格式：
    1. `NacpEnvelope`（nacp-core/envelope.ts）——核心协议格式，`{header: {message_type, ...}, body: {...}}`。
    2. `Envelope<T>`（nacp-core/rpc.ts）——ZX2 引入的 RPC 格式，`{ok: true/false, data?, error?, meta?}`。
    3. `FacadeEnvelope<T>`（orchestrator-auth-contract/facade-http.ts）——公开面格式，`{ok: true/false, data?, error?, trace_uuid}`。
  - `orchestrator-auth-contract/facade-http.ts` 有 `facadeFromAuthEnvelope()` 桥接 Auth → Facade，但没有 `facadeFromRpcEnvelope()` 桥接 RPC → Facade。
  - `orchestrator-core/src/user-do.ts:813-878` 的 `wrapSessionResponse()` 是手写的 ad-hoc 包装，通过检测 `ok === true && "data" in obj` 或 `ok === false && "error" in obj` 来判断是否已被包装——这个启发式检测在响应体恰好包含这些字段时会误判。
  - `forwardInternalJsonShadow`（user-do.ts:644）方法名保留着"dual-track 遗迹"语义（ZX4 P9 已删除 HTTP shadow track，binding 现是唯一 transport），但未被 rename。
- **为什么重要**：
  - 三种错误格式并存导致：(a) 跨 worker 错误传播需要手动格式转换而非通用桥接；(b) `wrapSessionResponse` 的启发式检测是脆弱的，任何内部响应格式的微小变化都可能绕过包装逻辑；(c) 新增 facade endpoint 时开发者需要理解三套格式，增加出错概率。
  - 缺少 `facadeFromRpcEnvelope()` 意味着 orchestrator-core 在将 agent-core 的 RPC 响应转为公开面格式时，必须手写这种转换，而不是使用经过测试的桥接函数。
- **审查判断**：
  - 当前错误信封的三层并存是可工作的（因为 `wrapSessionResponse` 按 if-else 分支处理了主要情况），但它是脆弱的且缺少通用桥接。这是一个协议卫生问题，不是功能 break。
- **建议修法**：
  - 在 `orchestrator-auth-contract/facade-http.ts` 中新增 `facadeFromRpcEnvelope<T>()` 函数，统一 RPC → Facade 桥接。
  - 将 `wrapSessionResponse` 中的启发式检测替换为对 `Envelope<T>` 类型的显式判断。
  - 将 `forwardInternalJsonShadow` 重命名为 `forwardRpcAction` 或 `invokeAgentCoreRpc`，消除 dual-track 遗迹语义。

### R4. VerifyApiKeyResultSchema 返回 supported:false，与 charter Z2 In-Scope 矛盾

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `packages/orchestrator-auth-contract/src/index.ts` 中 `VerifyApiKeyResultSchema` 定义为 `z.object({ supported: z.literal(false), reason: z.literal("reserved-for-future-phase") })`——这是一个明确标记为"未来阶段"的 stub schema。
  - `plan-zero-to-real.md §1.4` 声明："它（本阶段）不等于 first-wave 就要吞下完整 admin plane / API key product surface"，但接下来的 §7.2 Z1 In-Scope 第 5 条写着："最小 API key verify 运行时路径（不含 admin plane）：仅用于 server-to-server 鉴权校验；不引入 list/create/revoke/rotate/UI"。
  - Z1 In-Scope 第 5 条明确要求 API key verify 运行时路径是本阶段的交付物，而代码现实是 `supported: false` 的硬编码 stub。
  - `orchestrator-auth` 的 `verifyApiKey` RPC 方法的 `service.ts:verifyApiKey()` 返回的是 `result.supported === false` 的固定响应。
- **为什么重要**：
  - charter 把 "最小 API key verify 运行时路径" 列为 Z1 In-Scope 是有理由的：server-to-server 鉴权是生产环境的基本需求。如果 API key 路径是 `supported: false`，那么任何需要 service-to-service 验证的外部系统都无法使用此路径。
  - 当前的退出条件（§10.1 第 1 条）写道："若 server-to-server ingress 被启用，最小 API key verify 运行时路径成立"。由于当前是 `supported: false`，这个退出条件的后半段不满足——不是 "路径成立"，而是 "路径明确标记为不可用"。
- **审查判断**：
  - API key verify 运行时路径当前是显式 stub，不是 "可用但最小"。
  - charter 对此项的 In-Scope 声明与代码现实不一致。
- **建议修法**：
  - 方案 A（实装）：实现最小 API key verify——在 D1 中存储 `nano_api_keys` 表，`verifyApiKey` 查表验证 key hash + tenant scope + expiry，返回 `supported: true` + key metadata。
  - 方案 B（降级）：在 charter 中将此条改为 "reserved-for-future-phase"，明确标注当前 In-Scope 不包含任何 API key 运行时路径，免于与代码现实矛盾。

### R5. handleRead 的 timeline 双路径与 status 路径结构不一致

- **严重级别**：`medium`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - `user-do.ts:1143-1149`：第一个 `if (action === 'timeline')` 尝试 D1 读取，若 `events.length > 0` 则直接返回 D1 数据。
  - `user-do.ts:1153-1170`：`if (action === 'status')` 读取 D1 durable snapshot 并与 agent-core 代理响应 merge。
  - `user-do.ts:1175-1181`：第二个 `if (action === 'timeline')` 在 D1 为空时 fallback 到 agent-core RPC。
  - 这三段逻辑的结构是：timeline→D1-first，如果 D1 有数据就返回；如果没有就 fall-through 到第二个 timeline block 走 RPC。而 status 则永远走 D1+RPC merge。
  - 这种不一致意味着：timeline 只在 D1 有数据时使用 D1 数据，空时则完全丢弃 D1 转走 RPC；而 status 则永远 D1+RPC both。两种 read-path 的合并策略不同。
  - 更微妙的是：两个 `if (action === 'timeline')` block 之间穿插了 `if (action === 'status')` block，降低可读性。
- **为什么重要**：
  - 如果有人修改 timeline 逻辑（如改变合并策略），很容易只注意第一个 block 而忽略第二个。
  - 对于客户端而言，timeline 的行为在 D1 有数据时返回 KV timing 的数据，空时返回 agent-core 的 timing 数据，两者可能非幂等（数据来源不同可能有时序差异）。
- **建议修法**：
  - 将 timeline 的 D1-first + RPC-fallback 逻辑合并为一个连续的 handler，不再被 status block 穿插。
  - 显式文档化 timeline 的合并策略预期行为：D1-first 是缓存层还是 authoritative source？如果是缓存，应加 TTL 或 stale marker。

### R6. bash-core BashCoreAllowedCallers 包含幽灵调用者 "runtime"

- **严重级别**：`medium`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/bash-core/src/index.ts:438-442` 定义 `BashCoreAllowedCallers = ["orchestrator-core", "agent-core", "runtime"]`。
  - 当前 6 个 worker 中没有名为 "runtime" 的 worker。"runtime" 可能是早期设计中对 `session-do-runtime`（已被吸收进 agent-core）的预留，或者是 future `skill.core` 的预位。
  - `bash-core/src/index.ts:469` 的错误消息提示包括 `runtime` 作为合法 caller，这意味着如果有一个调用者以 `caller: "runtime"` 通过 RPC 调用 bash-core，它会被接受——但没有任何合法 worker 应该使用这个 caller。
- **为什么重要**：
  - 允许列表中包含不存在的调用者违反了最小权限原则。如果未来有人误创建了一个使用 `caller: "runtime"` 的服务，它会意外获得 bash-core 的访问权限。
  - 同时，这个幽灵值没有任何 charter 或 design 文档的支撑——worker-matrix §4.2 bash-core 的入站通道只列出了 `agent.core kernel` 和 `agent.core cancel`，没有 "runtime"。
- **建议修法**：
  - 移除 `"runtime"` 从 `BashCoreAllowedCallers`，或添加注释标注其来源与预期用途，并在 charter 中显式记录。
  - 如果是 skill.core 预位，应标注为 "reserved for future skill.core, see plan-worker-matrix §1.5"。

### R7. SHA-256(salt:raw) 密码哈希方案未在 charter 中声明安全边界

- **严重级别**：`medium`
- **类型**：`security`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-auth/src/hash.ts:5-7` 实现密码哈希为 `SHA-256(salt:raw)`：
    ```typescript
    export async function hashSecret(raw: string, salt: string): Promise<string> {
      const data = new TextEncoder().encode(`${salt}:${raw}`);
      const digest = await crypto.subtle.digest("SHA-256", data);
    ```
  - SHA-256 是快速哈希，不适合密码存储（bcrypt/scrypt/argon2 更安全，但 Cloudflare Workers 不原生支持）。
  - `plan-zero-to-real.md §7.2 Z1 In-Scope` 在密码认证相关的条目中没有提及哈希方案的安全边界。
  - `hash.ts` 的 `randomOpaqueToken` 使用 `crypto.getRandomValues` 是密码学安全的，但密码哈希本身不是。
- **为什么重要**：
  - 这不是一个可被外部利用的 trivially 破解的漏洞（salt 仍然提供了一定保护），但如果 salt 泄露，攻击者可以以极低成本对密码进行预计算。
  - charter 应显式声明此安全边界，并标注未来升级路径（如 WebCrypto 可能增加 PBKDF2 或 argon2-wasm）。
- **建议修法**：
  - 在 Z1 design 文档中显式记录此安全边界与已知妥协。
  - 考虑使用 PBKDF2（Workers 环境下可用 `crypto.subtle.deriveBits` + `importKey` 实现）或引入 WebCrypto 的 HKDF 作为密码哈希基础。

### R8. last_seen_at 内部语义不一致

- **严重级别**：`medium`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - ZX5 review 后 `handleMeConversations` 响应体新增了 `latest_session_started_at` 字段，同时保留 `last_seen_at` 作为 one-release deprecation alias。
  - 但 `user-do.ts` 内部的 session entry KV 结构（`last_seen_at` 字段出现在约 15 处代码位置，包括 `touchSession`、`rememberSessionEntry`、`updateActivePointers` 等）仍全部使用 `last_seen_at` 命名——并且其语义实际是 "最新 session 的 started_at" 或 "最后一次 touch 的时间戳"，而非 "用户最后看到的时间"。
  - `session-truth.ts` 的 D1 写入也使用 `last_seen_at` 列名（虽然 D1 的列名可能不直接暴露给客户端）。
  - 这意味着 `last_seen_at` 在系统内部有至少两种微妙不同的语义：(a) session KV entry 中的 "最新 session started_at 或 touch time"；(b) /me/conversations 响应中的 "latest session started_at" alias。
- **为什么重要**：
  - 字段名与语义不一致会导致后续开发者误用。如果有人把 KV 中的 `last_seen_at` 当成 "用户最后活动时间" 来排序或展示，就会产生与预期不同的行为。
  - ZX5 review 的修复只触及了客户端响应体的 renaming，没有触及内部存储层的语义对齐。
- **建议修法**：
  - 在 session entry KV schema 和 D1 session-truth 中将 `last_seen_at` column/field 显式文档化为 `latest_activity_at` 或 `latest_session_started_at` 的语义，在代码注释中明确标注这不是 "用户看到的时间" 而是 "最新 session 的 started_at 或 touch 时间戳"。
  - 或在全量将内部 `last_seen_at` 重命名为更诚实的名称（作为 follow-up phase）。

### R9. D1 单数据库跨 worker 共享，migration 无冲突防护

- **严重级别**：`medium`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/wrangler.jsonc:30`、`workers/orchestrator-auth/wrangler.jsonc:32`、`workers/agent-core/wrangler.jsonc:54` 三份 wrangler 使用完全相同的 D1 database_id `71a4b089-93e0-4d8f-afb8-bc9356a97cfa`。
  - 但 migration 文件分散在不同目录：orchestrator-core/migrations/ 下有 007-identity-core 等全部 7 个文件，orchestrator-auth 和 agent-core 各有自己的 migration 目录（agent-core 也有 NANO_AGENT_DB 绑定）。
  - `scripts/deploy-preview.sh` 只在 orchestrator-core 部署时执行 `wrangler d1 migrations apply`，不处理其它 worker 的 migration。
  - 这意味着 orchestrator-auth 和 agent-core 的 D1 migration 依赖于 orchestrator-core 的 migration 目录包含它们的表（如 `nano_user_devices` 在 007 中，而 `nano_users` 等在 001 中）。
  - 没有机制防止不同 worker 的 migration 在同一 D1 上产生 schema 冲突。
- **为什么重要**：
  - 如果未来 agent-core 或 orchestrator-auth 需要独立新增表（如 agent-core 增加 quota 相关表），它们的 migration 文件需要手动拷贝到 orchestrator-core 的 migration 目录，否则 `wrangler d1 migrations apply` 不会执行它们。
  - 这是一个 single-writer 约束（orchestrator-core 是 D1 migration 的唯一执行者），但这个约束没有被显式文档化，也没有工具级防护。
- **建议修法**：
  - 在架构文档中显式声明 "D1 migration single-writer 约束"：所有 migration 文件必须放在 orchestrator-core/migrations/ 目录下，由 orchestrator-core 的部署脚本统一执行。
  - 或引入 migration 协调层：每个需要 D1 写入的 worker 在自己的 migration 目录下管理自己的 migration，但通过 CI 检查确保每个 migration 会被某个部署流程触发。

### R10. CapabilityCallDO 无持久状态管理，DO 语义冗余

- **严重级别**：`low`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/bash-core/src/index.ts:324-353` 定义了 `CapabilityCallDO`，其 `fetch` handler 仅委托到 `handleCapabilityCall` / `handleCapabilityCancel`，没有使用 `state.storage` 或 `state.blockConcurrencyWhile` 或任何持久状态。
  - wrangler.jsonc 中 `CAPABILITY_CALL_DO` 绑定了这个 DO，这意味着每次 tool call 都会创建一个 DO 实例（通过 `idFromName`），但这个实例不存储任何有意义的持久状态。
  - DO 按 Cloudflare 定价会产生额外的 duration 费用，即使它不做任何持久化。
- **建议修法**：
  - 如果 tool call 不需要持久状态（当前似乎如此），将 `handleCapabilityCall` 降级为 WorkerEntrypoint 方法（与 `call`/`cancel` RPC 方法共享同一实例）。
  - 或文档化 CapabilityCallDO 存在的理由——例如为 future stateful tracking（如超时管理、progress 追踪）预留。

### R11. NacpObservabilityEnvelopeSchema 未在 nacp-core 主 index 导出

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `packages/nacp-core/src/observability/envelope.ts` 定义了 `NacpObservabilityEnvelopeSchema`，但 `packages/nacp-core/src/index.ts` 的 barrel 不导出它。
  - 消费者必须通过子路径 `@haimang/nacp-core/observability` 导入，这在功能上是可用的，但与其它核心导出的访问方式不一致。
- **建议修法**：
  - 在 `index.ts` 中补导出 `NacpObservabilityEnvelopeSchema`，或在 README 中显式标注子路径导入方式。

### R12. @nano-agent/ 与 @haimang/ 双 package scope 并存

- **严重级别**：`low`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `packages/workspace-context-artifacts/package.json` 使用 `@nano-agent/workspace-context-artifacts`。
  - `packages/eval-observability/package.json` 使用 `@nano-agent/eval-observability`。
  - `packages/storage-topology/package.json` 使用 `@nano-agent/storage-topology`。
  - 而其余包使用 `@haimang/` scope：`@haimang/nacp-core`、`@haimang/nacp-session`、`@haimang/jwt-shared`、`@haimang/orchestrator-auth-contract`、`@haimang/context-core-worker`（此包命名也不一致，worker 目录名为 `context-core` 但包名为 `context-core-worker`）。
  - `plan-worker-matrix.md §1.2` 声称 `@haimang/nacp-core` 和 `@haimang/nacp-session` 是唯二永久外部包，其余是 absorption inputs。但 `@nano-agent/` scope 的包既不是永久外部包，也不在 `@haimang/` scope 内。
- **建议修法**：
  - 在 P5 cutover milestone 中统一为 `@haimang/` scope，或在 package.json 中显式标注 `@nano-agent/` 为 "absorption input scope, not for long-term consumption"。

---

## 3. In-Scope 逐项对齐审核

> 以下对照 `plan-zero-to-real.md` Z0-Z4 In-Scope 与 `plan-worker-matrix.md` P0-P5 Exit Criteria 进行逐项审核。

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | Z0 charter freeze | `done` | charter 已冻结，Z1-Z4 目标/边界/design 清单/exit criteria 均有书面定义。 |
| S2 | Z1 完整 end-user auth (email/password + JWT) | `done` | orchestrator-auth 提供完整 register/login/refresh/verifyToken/resetPassword/me 路径，JWT via jwt-shared with kid rotation。 |
| S3 | Z1 WeChat bridge | `partial` | `wechat.ts` 存在但未观察到真机验证证据；auth-contract 的 `VerifyWechatLoginBodySchema` 已定义。代码结构完整但 live proof 缺失。 |
| S4 | Z1 orchestrator.auth pure internal RPC | `done` | 无公开路由，`assertAuthMeta` 严格执行 `caller === "orchestrator-core"` 单一调用者约束。 |
| S5 | Z1 authority/trace/tenant truth 进入真实 ingress | `done` | `authenticateRequest` 在 orchestrator-core 入口强制 JWT + trace_uuid + tenant 校验。 |
| S6 | Z2 最小 API key verify 运行时路径 | `missing` | `VerifyApiKeyResultSchema` 返回 `supported: false`，不是运行时路径而是显式 stub。与 Z1 In-Scope 第 5 条矛盾。（见 R4） |
| S7 | Z2 D1 SSOT (identity + session + context + audit) | `done` | 7 个 migration 文件覆盖 identity-core / session-truth / session-truth-hardening / usage / usage-events / pending-status / user-devices。D1 是真实持久化源。 |
| S8 | Z2 user-state hot path (history/reconnect/timeline) | `partial` | history/timeline 存在 D1-first + RPC-fallback 双路径，但 timeline 与 status 的合并策略不一致（见 R5）。reconnect 路径在 ws-bridge 中存在但未见独立测试。 |
| S9 | Z2 orchestration.core → agent.core control-plane RPC | `done` | `AGENT_CORE` binding 和 RPC 方法（start/status/input/cancel/verify/timeline/streamSnapshot/permissionDecision/elicitationAnswer）均已实现。 |
| S10 | Z3 real provider (Workers AI) | `partial` | `workers/agent-core/src/host/runtime-mainline.ts` 有 Workers AI binding但 fake provider 路径仍为主要 fallback。 |
| S11 | Z3 quota minimal runtime truth | `partial` | D1 表已建（usage_events / quota_balances），但 `onUsageCommit` callback 未从 NanoSessionDO 传入 kernel runner（ZX5 review 确认 deferred）。 |
| S12 | Z4 web client 完整 hardening | `partial` | `clients/web/` 存在但 ZX5 review 确认 WeChat/WS live push/permission round-trip 仍为 deferred。 |
| S13 | Z4 Mini Program 接入 | `partial` | `clients/wechat-miniprogram/` 存在框架但真机 smoke 仍为 owner-action。 |
| S14 | P5 Exit #2 "4 workers runtime ownership 已吸收到 workers/*/src/" | `partial` | agent-core / bash-core 吸收完成，context-core / filesystem-core 仍为 probe-only shim+包级 import。（见 R2） |
| S15 | P5 Exit #5 "B7 LIVE 5 tests 全绿" | `done` | `pnpm test:contracts` 31/31 通过，根据 ZX5 review 修复后全量 2058/2058。 |
| S16 | worker-matrix "live agent turn loop 端到端运行" | `partial` | tool.call 闭环已跑通（bash-core service-binding），但 stdio capability / LLM real output / permission round-trip 闭环未跑通。 |

### 3.1 对齐结论

- **done**: `7`
- **partial**: `8`
- **missing**: `1`
- **stale**: `0`
- **out-of-scope-by-design**: `0`

整体更像 **"auth 基石已立、D1 truth 已铺、worker 拓扑已物化、但协议完整性有断点、吸收叙事与代码现实漂移、runtime kernel 闭环尚未跑通"** 的状态，而非 charter 描述的 "first real run baseline"。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | Z2 完整 tenant admin CRUD | `遵守` | 未在代码中观察到 admin CRUD 路径。 |
| O2 | Z2 完整 API key admin plane | `遵守` | 代码中无 list/create/revoke 路径。但 "最小 verify 运行时路径" 是 Z1 In-Scope（见 R4），此部分未遵守。 |
| O3 | Z2 smind-06/09 full richness | `遵守` | D1 migration 只覆盖 thin-but-complete 列表。 |
| O4 | Z3 所有 internal stream-plane 一步到位全面 RPC-only | `遵守` | context-core/filesystem-core binding 仍注释态，stream-plane 保留过渡。 |
| O5 | worker-matrix "不引入第 5 个 first-wave worker" | `遵守` | 仍为 6 workers，无 skill.core。 |
| O6 | worker-matrix "Tier B packages 物理保留不删除" | `遵守` | 所有 Tier B 包仍物理存在于 packages/。 |
| O7 | worker-matrix "W1 RFC 不升级为 shipped code" | `遵守` | workspace-rpc / remote-compact / evidence-forwarding 仍为 direction-only。 |
| O8 | Z4 cold archive / R2 offload | `遵守` | 未在代码中观察到 cold archive 路径。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. `解决 R1（NACP 错误信封生产路径断点）：要么注册 error verb 到 NACP_MESSAGE_TYPES_ALL，要么将 wrapAsError 标记为 deprecated 并统一到 Envelope<T> 的 ok:false 路径。` 
  2. `解决 R2（context-core/filesystem-core 吸收真实性）：在架构文档中明确标注 "library-worker-posture, in-process shim period" 与 charter 声称的 "runtime ownership 已吸收" 之间的差距，或推进真正吸收。`
  3. `解决 R4（API key verify supported:false）：要么实装最小 verify 路径，要么将 Z1/Z2 的 "最小 API key verify 运行时路径" In-Scope 条目改为 "reserved-for-future-phase"。`
  4. `解决 R3（三层错误信封格式并存）：至少补 facadeFromRpcEnvelope 桥接函数，或将错误格式统一为 FacadeEnvelope 为唯一公开格式。`
- **可以后续跟进的 non-blocking follow-up**：
  1. `R5: 统一 handleRead 的 timeline/status 合并策略`
  2. `R6: 移除 bash-core 幽灵调用者 "runtime" 或显式标注`
  3. `R7: 在 Z1 design 文档中声明 SHA-256 密码哈希安全边界`
  4. `R8: 全量对齐 last_seen_at 内部语义`
  5. `R9: 文档化 D1 migration single-writer 约束`
  6. `R10: 评估 CapabilityCallDO 降级为 WorkerEntrypoint 方法`
  7. `R11: 补充 NacpObservabilityEnvelopeSchema 主导出`
  8. `R12: 统一 package scope 为 @haimang/`
- **建议的二次审查方式**：`independent reviewer`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码或文档。

---

## 6. 附录：charter-代码对账差异清单

> 以下列出 charter 文档中与代码现实存在显著差异的条目，不构成独立 finding（已在 R1-R12 中覆盖核心差异），但作为完整性参考。

| Charter 条目 | Charter 声称 | 代码现实 | 差异性质 |
|---|---|---|---|
| worker-matrix §9 Exit #2 | "4 workers 的 runtime ownership 已落在 workers/*/src/，packages/ 不再是 runtime 归属" | context-core / filesystem-core 只暴露 3 个 RPC 方法的 shim壳，agent-core 仍通过包级 import 消费 context-core | 吸收叙事漂移 |
| worker-matrix §4.3 context-core | "薄 context substrate，host 进程内运行" | 代码确实如此（host-local import），但 §4.3 同时声称 "C1+C2 absorption 完成" 而代码只有 shim壳 | 吸收程度漂移 |
| zero-to-real §7.2 Z1 第 5 条 | "最小 API key verify 运行时路径" | `supported: false` 显式 stub | In-Scope 未交付 |
| zero-to-real §10.1 Exit #1 后半段 | "若 server-to-server ingress 被启用，最小 API key verify 运行时路径成立" | verifyApiKey 返回 `supported: false`，路径不可用 | 退出条件不满足 |
| worker-matrix §4.4 filesystem-core | "D1+D2 absorption 完成" | filesystem-core/src/index.ts 只有 3 个 RPC 方法的 shim壳 | 吸收叙事漂移 |
| worker-matrix §5.2 P3 DoD | "context-core preview deploy 成功（或明确记录 defer 到 P5）" | context-core 的 wrangler 有 `preview = true` 但实际是 library-worker posture，无真实业务负载 | 部署语义漂移 |
| zero-to-real §1.7 | "orchestration.core 把 stream 相关过渡面显式收窄" | context-core / filesystem-core 的 stream-plane 仍为零业务（probe-only），收窄无从谈起 | 过渡面描述漂移 |
| nacp-core error-body.ts | 注释标注 "Populated by the forthcoming per-verb migration PR (RFC §3.3)" | NACP_ERROR_BODY_VERBS 为空集，wrapAsError 产出的信封无法通过 validateEnvelope | 协议断点 |
| `plan-worker-matrix.md §1.2` | `@haimang/nacp-core` 和 `@haimang/nacp-session` 是唯二永久外部包 | 3 个包使用 `@nano-agent/` scope 而非 `@haimang/` | scope 不一致 |

---

## 7. 审查质量评价

> 评价对象: `GLM-5.1 对 zero-to-real + 6-worker + packages 的代码审查`
> 评价人: `Claude Sonnet 4.6（实现者，结合本轮真实修复结果）`
> 评价时间: `2026-04-29`

### 7.0 评价结论

- **一句话评价**：以 NACP 协议层 + charter-vs-代码 paper-trail 对账为切入点，在 4 家中协议完整性视角最深；唯一发现 `NACP_ERROR_BODY_VERBS` 空集与 `wrapAsError` 互斥这种纯 schema-vs-runtime 协议断点。
- **综合评分**：`8.8 / 10`
- **推荐使用场景**：协议层（NACP envelope / error-body / message_type 注册）完整性核查、charter §X.Y 与代码逐句对账、package scope / barrel export 一致性巡检、附录式差异清单（§6 charter-代码对账）。
- **不建议单独依赖的场景**：runtime correctness 调用链对账（不及 DeepSeek 深入）、生产稳定性陷阱（如 alarm 链断裂）巡检（被 DeepSeek 独占）。

### 7.1 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | `NACP 协议层完整性 + charter paper-trail 对账` | R1 串起 `error-body.ts:57 NACP_ERROR_BODY_VERBS 空集` ↔ `envelope.ts:312 validateEnvelope` ↔ `error-body.ts:73 wrapAsError` 三处文件证明协议路径不可用；§6 附录列 9 条 charter 与代码差异 |
| 证据类型 | `精确行号 + schema 注册表对账 + RFC 注释引用` | R1 引用 `error-body.ts:18-37` 的 `Populated by the forthcoming per-verb migration PR (RFC §3.3)` 注释作为"故意留白但仍是协议断点"的论证 |
| Verdict 倾向 | `STRICT-PROTOCOL — 12 finding 中 4 个 blocker，但 blocker 理由全在协议/charter 层` | 不像 DeepSeek 那样把 6 个 critical 全归 runtime correctness；GLM 的 critical (R1) 是协议层断点，blocker (R2/R3/R4) 是 charter 漂移与协议卫生 |
| Finding 粒度 | `BALANCED — 12 项覆盖 1 critical → 5 low 完整光谱` | 同时覆盖 R1 协议层断点和 R12 双 scope 这种 packaging 卫生级；§6 附录补 9 条 charter-代码差异作为 finding 之外的完整性参考 |
| 修法建议风格 | `ACTIONABLE，给方案 A/B 选择` | R1 给 "注册 verb to NACP_MESSAGE_TYPES_ALL" vs "废弃 wrapAsError 统一 Envelope<T>"；R4 给 "实装最小 verify" vs "降级 charter 为 reserved-for-future-phase" |

### 7.2 优点与短板

#### 7.2.1 优点

1. **唯一发现 NACP 协议层断点**：R1 (`NACP_ERROR_BODY_VERBS` 空集 vs `wrapAsError` 互斥) 是 4 家中唯一的协议完整性 finding。GPT/DeepSeek/kimi 全部漏掉。判断扎实——不仅指出空集，还引用 RFC §3.3 注释作为"故意留白但当前不可用"的论证；同时澄清"runtime 不会立即触发"是因为活跃路径走 `Envelope<T>`，避免了误报。
2. **NacpObservabilityEnvelopeSchema 主导出缺失（R11）**：4 家中独有；本轮已 fixed（在 nacp-core 主 index.ts 补导出 4 个 Schema + 类型）。这种 packaging 卫生级 finding 体现 GLM 对 barrel export 一致性的关注。
3. **bash-core 幽灵 caller "runtime"（R6）**：4 家中独有；指出 `BashCoreAllowedCallers` 包含的 `"runtime"` 在 6-worker 拓扑中没有对应 worker，违反最小权限原则。本轮已 fixed（移除 + 测试更新）。
4. **§6 附录式 charter-代码对账差异清单**：9 条差异（worker-matrix Exit #2、context-core §4.3、zero-to-real §7.2 Z1#5、Z1 §10.1 Exit#1、filesystem-core §4.4、§5.2 P3 DoD、zero-to-real §1.7、nacp-core RFC §3.3 注释、@haimang vs @nano-agent scope）作为 finding 之外的完整性参考——这种"不构成独立 finding 但作为审查 paper-trail"的补充非常有价值。
5. **方案 A/B 选择风格修法**：R1 和 R4 都给 "实装" 与 "降级 charter" 二选一，让 owner 在 implementation budget 紧张时仍有可行选项。

#### 7.2.2 短板 / 盲区

1. **runtime correctness 硬断点全部漏掉**：DeepSeek R1 (needsBody)、R5 (WorkerEntrypoint default export，但 GLM R2 触及了周边问题)、R9 (alarm try/catch)、R23 (JWT_LEEWAY_SECONDS) 这些 missed-by-others 的 critical/high 全被 GLM 漏掉。GLM 的审查路径偏协议层，没有深入"路由→参数解析→handler"的调用链对账。
2. **R8 (last_seen_at 语义) 与 DeepSeek R15 重叠但定位偏轻**：标 medium non-blocker；从内部字段 KV schema 一致性角度可能更接近 high（影响后续开发者误用）。
3. **R7 (SHA-256 密码哈希) 标 medium 偏轻 OR 偏重不易判**：Workers 环境没有原生 bcrypt/argon2 是事实约束，GLM 自己标"已知妥协"；但建议方案"PBKDF2"可能在 Workers 环境也有性能成本，修法建议偏宏观。
4. **§6 附录差异清单与 R1-R12 重叠度高**：9 条附录差异中有 5 条已在 R1-R12 中作为 finding 出现，剩下 4 条（context-core §4.3、§5.2 P3 DoD、zero-to-real §1.7、filesystem-core §4.4）严格说也可以并入 R2 主 finding；附录的独立性可以更强。

### 7.3 Findings 质量清点

| 问题编号 | 原始严重程度 | 事后判定 | Finding 质量 | 分析与说明 |
|----------|--------------|----------|--------------|------------|
| R1 | critical | true-positive / missed-by-others | excellent | NACP 错误信封生产路径与空 verb set 互斥；4 家中独有；GLM 还自我澄清 "runtime 不会立即触发" 避免误报；deferred（需 owner 决定方案 A/B）|
| R2 | high | true-positive | good | context-core/filesystem-core 与 charter 叙事漂移；与 GPT R3 / kimi R1 同方向，但 GLM 更深入指出"3 个 RPC 方法只返回 op 名字符串"；本轮 partially-fixed（default export 修复 + closure 降级）|
| R3 | high | true-positive | good | 三层错误信封 + 缺 facadeFromRpcEnvelope；deferred；需协议层重构 |
| R4 | high | true-positive | good | VerifyApiKey supported:false vs charter Z2 矛盾；deferred；closure §4 已标注 |
| R5 | medium | true-positive | good | handleRead timeline/status 双路径不一致；deferred |
| R6 | medium | true-positive / missed-by-others | excellent | bash-core BashCoreAllowedCallers 含幽灵 "runtime" 调用者；4 家中独有；本轮 fixed（移除 + 测试更新）|
| R7 | medium / security | true-positive | mixed | SHA-256 密码哈希边界；事实判断准确，但 Workers 环境约束强，severity 与建议方案都偏宏观；deferred |
| R8 | medium | true-positive | good | last_seen_at 内部语义不一致；与 DeepSeek R15 重叠；deferred |
| R9 | medium | true-positive | good | D1 single-writer 约束未文档化；deferred 为文档 follow-up |
| R10 | low | true-positive | mixed | CapabilityCallDO 无持久状态；deferred；判断准确但 severity 略偏轻 |
| R11 | low | true-positive / missed-by-others | excellent | NacpObservabilityEnvelopeSchema 未在主 index 导出；4 家中独有；本轮 fixed |
| R12 | low | true-positive | good | @nano-agent/ vs @haimang/ 双 scope；与 closure §4 已标注的 P5 cutover 一致；deferred |

**统计**：12 findings 全部 true-positive，0 false-positive，3 项 missed-by-others（R1 / R6 / R11），本轮 fixed 2 项 + partially-fixed 1 项 + deferred 9 项。

### 7.4 多维度评分 — 单向总分 10 分

| 维度 | 评分 | 说明 |
|------|-----|------|
| 证据链完整度 | `9.5` | 12 个 finding 全部精确行号 + schema 注册表对账；R1 跨 3 文件 (error-body.ts, envelope.ts, NACP_MESSAGE_TYPES_ALL 注册器) 对账；§6 附录补 9 条 charter-代码差异 |
| 判断严谨性 | `9.5` | 0 false-positive；R1 自我澄清 "runtime 不会立即触发" 避免协议层 finding 误报为 runtime blocker，校准非常清晰 |
| 修法建议可执行性 | `8.5` | 方案 A/B 选择风格让 owner 有 budget-aware 选项；R7 修法略宏观（建议 PBKDF2 但未给 Workers 实测） |
| 对 action-plan / design / QNA 的忠实度 | `9.5` | 每个 finding 附 plan-zero-to-real / plan-worker-matrix §X.Y 引用；§6 附录式差异清单是 paper-trail 工作的极致 |
| 协作友好度 | `9.0` | 友好；不情绪化；R1 自我澄清避免协议层 finding 被误读 |
| 找到问题的覆盖面 | `8.5` | 12 项覆盖 NACP 协议 / 错误信封 / charter 漂移 / 安全 / package 卫生 / 双 scope；3 项 missed-by-others 体现协议层独到视角；但 runtime correctness 全部漏掉 |
| 严重级别 / verdict 校准 | `8.5` | critical=协议断点、high=charter 漂移与协议卫生、medium=语义/可维护性、low=packaging 卫生；分级清晰；R7/R10 略偏轻但不构成误判 |
| **加权综合** | **`8.8`** | 协议层完整性视角的标杆；NACP / charter paper-trail 对账深度 4 家最高；唯一短板是 runtime correctness 调用链审计偏弱 |