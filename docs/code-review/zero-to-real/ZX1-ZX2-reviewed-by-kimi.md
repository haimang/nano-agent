# ZX1-ZX2 审查报告 —— 由 Kimi 独立完成

> 审查对象: `zero-to-real / ZX1 / ZX2`
> 审查类型: `mixed (code-review + closure-review + cross-phase analysis)`
> 审查时间: `2026-04-27`
> 审查人: `Kimi`
> 审查范围:
> - `docs/action-plan/zero-to-real/ZX1-wechat-ehance.md`
> - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md`
> - `docs/issue/zero-to-real/ZX1-closure.md`
> - `docs/issue/zero-to-real/ZX2-closure.md`
> - 全部涉及 workers / packages / clients / test 实现文件
> 对照真相:
> - 上述 action-plan 与 closure 文档
> - 实际代码与测试运行结果
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：ZX1-ZX2 主体骨架已落地，契约层与测试数字真实，但实现层存在多处命名与语义漂移，关键路径的 "RPC" 存在概念偷换，若干 action-plan 收口标准尚未真正达成。
- **结论等级**：`approve-with-followups`
- **是否允许关闭本轮 review**：**yes，但须完成 §5 列出的 blocker 后再标记为 closed**
- **本轮最关键的 3 个判断**：
  1. **agent-core 的 "7 action 全 RPC" 是 RPC facade over internal HTTP，不是真正的 worker-to-worker RPC；dual-track parity 比对的是同一套 fetch-based DO 调用，无法发现 DO 层本身的 bug。**
  2. **P3-05 HTTP 路径删除尚未执行，closure 将其标记为 "resolved" 但 action-plan §8.2 明确要求 "HTTP 路径已删除"；当前状态是 "具备删除条件" 而非 "已删除"。**
  3. **2392 tests 全绿是真实的，但 live preview e2e 从未实际运行，7 天 parity 观察期无证据，不能作为 "production-ready" 的依据。**

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/zero-to-real/ZX1-wechat-ehance.md`
  - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md`
  - `docs/issue/zero-to-real/ZX1-closure.md`
  - `docs/issue/zero-to-real/ZX2-closure.md`
  - `docs/templates/code-review.md`
- **核查实现**：
  - `packages/orchestrator-auth-contract/src/{index.ts,facade-http.ts}`
  - `workers/orchestrator-auth/src/{wechat.ts,service.ts,public-surface.ts}`
  - `workers/orchestrator-core/src/{index.ts,user-do.ts,policy/authority.ts}`
  - `workers/agent-core/src/{index.ts,host/internal.ts,host/remote-bindings.ts,host/internal-policy.ts}`
  - `workers/bash-core/src/{index.ts,worker-runtime.ts}`
  - `workers/{context-core,filesystem-core}/src/index.ts`
  - `packages/nacp-core/src/rpc.ts`
  - `packages/nacp-session/src/messages.ts`
  - `clients/{web/src/client.ts,wechat-miniprogram/{apiRoutes.js,utils/api.js}}`
  - `test/cross-e2e/zx2-transport.test.mjs`
  - `docs/runbook/zx2-rollback.md`
  - `docs/transport/transport-profiles.md`
- **执行过的验证**：
  - `pnpm --filter @haimang/nacp-core test` → 289/289 ✅
  - `pnpm --filter @haimang/nacp-session test` → 146/146 ✅
  - `pnpm --filter @haimang/orchestrator-auth-contract test` → 19/19 ✅
  - `pnpm --filter @haimang/orchestrator-auth-worker test` → 8/8 ✅
  - `pnpm --filter @haimang/orchestrator-core-worker test` → 41/41 ✅
  - `pnpm --filter @haimang/agent-core-worker test` → 1054/1054 ✅
  - `pnpm --filter @haimang/bash-core-worker test` → 370/370 ✅
  - `pnpm --filter @haimang/context-core-worker test` → 171/171 ✅
  - `pnpm --filter @haimang/filesystem-core-worker test` → 294/294 ✅
  - **合计：2392/2392 ✅**
- **复用 / 对照的既有审查**：
  - 无 — 本审查完全独立进行，未参考其他 reviewer 的结论。

### 1.1 已确认的正面事实

1. **WeChat decrypt 实现真实存在**：`workers/orchestrator-auth/src/service.ts:342-400` 实现了完整的 `code -> jscode2session -> session_key decrypt -> openid 对拍` 链路；`wechat.ts:100-158` 实现了 AES-CBC 解密与水印校验。
2. **worker_version 统一**：6 个 worker 的 `/health` 都返回 `worker_version`，通过 `WORKER_VERSION` env 注入。
3. **workers_dev 审计完成**：仅 orchestrator-core 为 `true`，其余 5 个 worker 均为 `false`（含 agent-core preview）。
4. **binding-scope guards 真实存在**：bash-core（secret + 401）、context-core（401）、filesystem-core（401）、orchestrator-auth（401）都有非 `/health` 路径守卫。
5. **NACP 协议层已补齐**：`packages/nacp-core/src/rpc.ts` 真实存在 Envelope<T>、RpcMeta、RpcErrorCode、validateRpcCall 等。
6. **facade-http-v1 已落地**：`packages/orchestrator-auth-contract/src/facade-http.ts` 实现了 FacadeSuccessEnvelope / FacadeErrorEnvelope / facadeOk / facadeError，且有编译期 `_authErrorCodesAreFacadeCodes` 保证。
7. **bash-core WorkerEntrypoint 真实存在**：`BashCoreEntrypoint` 有 `call` 和 `cancel` 两个 RPC 方法，带 `validateBashRpcMeta` 校验。
8. **rollback runbook 已撰写**：`docs/runbook/zx2-rollback.md` 覆盖了软回滚、硬回滚、bash-core 回滚、通信与重新前进。
9. **2392 tests 全绿已验证**：实际运行了全部 9 个包的测试，数字与 closure 一致。

### 1.2 已确认的负面事实

1. **agent-core 的 "RPC" 方法内部仍走 HTTP fetch**：`AgentCoreEntrypoint.input()` 等方法调用 `invokeInternalRpc()`，后者通过 `stub.fetch()` 向 DO 发起 HTTP 请求（`agent-core/src/index.ts:284`）。这不是 worker-to-worker RPC，而是 RPC facade over internal HTTP。
2. **dual-track parity 比对的是同一套实现**：`forwardInternalJsonShadow` 中，RPC 路径调用 `AGENT_CORE.input()`，该 RPC 方法内部仍通过 fetch 调用 DO；HTTP 路径直接 fetch 调用 DO。两者在 DO 层汇合，parity 只能发现 RPC wrapper 层的差异，无法发现 DO 层 bug。
3. **P3-05 翻转未执行**：`user-do.ts:1812` 的 `forwardInternalRaw` 仍使用 `AGENT_CORE.fetch()`；`agent-core/src/index.ts` 的 `invokeInternalRpc` 仍通过 fetch 转发。closure 声称 "resolved" 但实际是 "具备条件，待执行"。
4. **live preview e2e 未运行**：`zx2-transport.test.mjs` 在 `NANO_AGENT_LIVE_E2E` 未设置时全部跳过；没有证据表明该测试在 preview 环境实际通过。
5. **bash-core RPC 缺少 caller 枚举校验**：`validateBashRpcMeta` 检查了 `authority` 和 `request_uuid`，但未校验 `caller` 字段是否是 `orchestrator-core | agent-core | runtime` 之一。action-plan §5.3 明确要求 caller 枚举校验。
6. **/me/sessions TTL GC 逻辑缺失**：`handleMeSessions` 在 `orchestrator-core/src/index.ts:447-501` 中 mint UUID 并返回 TTL，但没有看到 24h 后自动 GC pending session 的逻辑。
7. **dist overlay workaround 不应长期存在**：closure §13.4 #8 提到 bash-core 通过手动覆盖 pnpm cache 的 dist 来使用本地 nacp-core 变更。这是 dev-time hack，必须在 nacp-core 1.4.1 publish 后移除。
8. **frame-compat 层不是真正的统一**：wire 上仍是 `{kind,...}` 轻量 frame，`liftLightweightFrame()` 只是运行时映射。closure 声称 "server frame 统一对齐 NacpSessionFrameSchema" 是过度声明。
9. **HttpController 仍可能返回旧形状**：`wrapSessionResponse` 明确检测并兼容 `{ok:true,action,phase}` 旧形状（`orchestrator-core/src/index.ts:518-533`）。closure 声称 "HttpController 不再吐自定义形状" 不准确——它仍在吐，只是被外层 idempotently 包装。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 逐行阅读了 20+ 个关键文件，总计约 5000+ 行代码 |
| 本地命令 / 测试 | yes | 实际运行了全部 9 个包的测试，验证 2392/2392 |
| schema / contract 反向校验 | yes | 核对了 facade-http.ts、rpc.ts、messages.ts 与 action-plan 的 schema 要求 |
| live / deploy / preview 证据 | no | 无 live 环境访问权限；e2e 测试均跳过 |
| 与上游 design / QNA 对账 | yes | 核对了 action-plan 的 In-Scope / Out-of-Scope / 收口标准 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | agent-core "RPC" 实为 internal HTTP facade，概念偷换 | high | correctness | no | 文档澄清 + 后续重构 |
| R2 | dual-track parity 比对同一套 DO fetch 实现，发现力不足 | high | test-gap | no | 增强 parity 的差异化覆盖 |
| R3 | P3-05 HTTP 路径删除未执行，closure 过度声明 | high | delivery-gap | **yes** | 按 runbook 执行翻转或修改 closure |
| R4 | live preview e2e 未运行，7 天观察期无证据 | medium | test-gap | no | 部署后补跑 e2e + 观察期证据 |
| R5 | bash-core RPC 缺少 caller 枚举校验 | medium | security | no | 补 caller 枚举校验 |
| R6 | /me/sessions TTL GC 逻辑缺失 | medium | correctness | no | 补 GC 逻辑或更新 closure |
| R7 | dist overlay workaround 长期化风险 | medium | platform-fitness | no | nacp-core 1.4.1 publish 后移除 |
| R8 | frame-compat 层是映射而非真正统一 | low | protocol-drift | no | 文档澄清 wire 与 schema 的区别 |
| R9 | HttpController 旧形状仍被兼容而非移除 | low | protocol-drift | no | 文档澄清 compat 层意图 |
| R10 | user-do.ts 1909 行，职责过重 | low | platform-fitness | no | 后续拆分 |

### R1. agent-core "RPC" 实为 internal HTTP facade，概念偷换

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/agent-core/src/index.ts:227-295`：`invokeInternalRpc` 通过 `stub.fetch()` 向 DO 发起 HTTP 请求，RPC 方法只是包装层。
  - `workers/orchestrator-core/src/user-do.ts:1812`：`forwardInternalRaw` 仍使用 `AGENT_CORE.fetch()`。
- **为什么重要**：action-plan 和 closure 声称 "agent-core 7 个 session action 全部走 RPC"，这会让读者误以为内部 transport 已从 HTTP 完全切换到 worker-to-worker RPC。实际上 orchestrator-core -> agent-core 之间虽然有 WorkerEntrypoint RPC 方法，但 agent-core -> DO 仍然是 HTTP。这影响了对 "HTTP 退役" 进度的判断。
- **审查判断**：这不是实现错误，而是命名与文档的过度声明。RPC facade 在当前阶段是合理的技术选择，但不应在 closure 中表述为 "全部 RPC"。
- **建议修法**：
  1. 在 closure 中补充说明：agent-core 的 RPC 方法是对 internal HTTP 的 facade，真正的 DO 调用仍走 fetch。
  2. 在 `docs/transport/transport-profiles.md` 中明确标注 agent-core 的 "RPC" 属于 `internal-http-compat` 的 facade 形态。

### R2. dual-track parity 比对同一套 DO fetch 实现，发现力不足

- **严重级别**：`high`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:842-890`：`forwardInternalJsonShadow` 中，RPC 路径调用 `AGENT_CORE.input()`，该 RPC 方法内部通过 fetch 调用 DO；HTTP 路径直接 fetch 调用 DO。
  - `workers/agent-core/src/index.ts:284`：`invokeInternalRpc` 中的 `stub.fetch(...)`。
- **为什么重要**：parity 的核心价值是 "发现 RPC 路径与 HTTP 路径的行为差异"。如果两者在底层走同样的 DO 调用，parity 只能发现 RPC wrapper 层的序列化/反序列化差异，无法发现 DO 层本身的 bug。这使得 parity 的保护价值被削弱。
- **审查判断**：parity 在当前形态下仍有价值（可发现 envelope 包装差异），但不应被视为 "HTTP 完全退役" 的充分证据。
- **建议修法**：
  1. 在 closure 中诚实说明 parity 的覆盖范围限制。
  2. 考虑在 P3-05 翻转后，引入更细粒度的集成测试来覆盖 DO 层行为。

### R3. P3-05 HTTP 路径删除未执行，closure 过度声明

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:1812`：`forwardInternalRaw` 仍使用 `AGENT_CORE.fetch()`。
  - `workers/agent-core/src/index.ts:227-295`：`invokeInternalRpc` 仍通过 fetch 转发到 DO。
  - `docs/runbook/zx2-rollback.md` 明确说明 rollback 是针对 "翻转之后" 的场景。
  - closure §1.6 表格中 P3-05 标记为 "resolved (v3)"，但 §4.2 明确说 "preview 连续 7 天...后按 runbook 反向流程执行 P3-05 翻转"。
- **为什么重要**：action-plan §8.2 收口标准 #3 明确要求 "HTTP 路径已删除"。closure 将 P3-05 标记为 "resolved" 是不准确的——当前只是 "runbook 已写就，待执行"。
- **审查判断**：这是 closure 文档与事实之间的差异，不是代码错误。但 closure 的诚实性直接影响后续执行者的判断。
- **建议修法**：
  1. **立即修改 `ZX2-closure.md`**：将 P3-05 状态从 "resolved" 改为 "runbook-ready, pending 7-day observation"。
  2. 在 §8 中明确区分 "已落地" 与 "已翻转"。

### R4. live preview e2e 未运行，7 天观察期无证据

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `test/cross-e2e/zx2-transport.test.mjs:44`：`if (!process.env.NANO_AGENT_LIVE_E2E) return;`
  - closure §6.3 公网入口审计明确标注 "preview 待部署后 curl 验证"。
- **为什么重要**：closure 声称 "2392 tests 全绿" 给人以全面验证的印象，但 cross-e2e 在 CI 中全部跳过。7 天 parity 观察期是 action-plan 明确要求的收口条件，当前无证据。
- **审查判断**：单元测试全绿是真实的，但 live e2e 和观察期是 action-plan 的硬性要求，不能省略。
- **建议修法**：
  1. 在 closure 中补充说明：live e2e 和 7 天观察期是 "待执行" 状态。
  2. preview 部署后立即运行 `NANO_AGENT_LIVE_E2E=1 node --test test/cross-e2e/zx2-transport.test.mjs`。

### R5. bash-core RPC 缺少 caller 枚举校验

- **严重级别**：`medium`
- **类型**：`security`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/bash-core/src/index.ts:434-463`：`validateBashRpcMeta` 检查了 `authority` 和 `request_uuid`，但没有检查 `caller` 字段。
  - action-plan §5.3 明确要求："authority 必填 `sub` / `team_uuid` / `caller`（`orchestrator-core | agent-core | runtime`）"。
- **为什么重要**：缺少 caller 枚举校验意味着任何带有正确 authority 和 request_uuid 的调用方都可以调用 bash-core，无法区分是合法 orchestrator-core/agent-core 还是其他内部组件。
- **审查判断**：当前 binding-secret 已经提供了第一层防护，但 caller 校验是 action-plan 明确要求的第二层防护。
- **建议修法**：在 `validateBashRpcMeta` 中增加 `caller` 枚举校验：
  ```typescript
  const VALID_CALLERS = ["orchestrator-core", "agent-core", "runtime"] as const;
  if (!parsed.data.caller || !VALID_CALLERS.includes(parsed.data.caller)) {
    return { ok: false, envelope: errorEnvelope("invalid-caller", 400, "...") };
  }
  ```

### R6. /me/sessions TTL GC 逻辑缺失

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts:447-501`：`handleMeSessions` POST 返回 `ttl_seconds: 24 * 60 * 60`，但没有看到任何 GC pending session 的逻辑。
  - action-plan §5.5 P5-02 明确要求："TTL 24h 未 start 自动 GC"。
- **为什么重要**：如果不 GC，pending session 会无限累积，可能导致 UUID 空间污染或索引膨胀。
- **审查判断**：这是一个已知的 lazy 实现缺口。closure 提到 "lazy 创建" 但没有提到 GC。
- **建议修法**：
  1. 在 User DO 中增加定时任务（如 DO alarm）来清理超过 TTL 的 pending session。
  2. 或在 `handleMeSessions` GET 时过滤掉过期的 pending session。

### R7. dist overlay workaround 长期化风险

- **严重级别**：`medium`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - closure §13.4 #8："dist overlay 解决 pnpm cache 问题...临时方案是把本地 build 的 dist 覆盖到 cache...正式发布时 nacp-core 应 bump 1.4.1"。
- **为什么重要**：dist overlay 是 dev-time hack，如果忘记移除，会导致本地构建与 published package 不一致，产生难以调试的 "works on my machine" 问题。
- **审查判断**：这是一个运维任务，不是代码错误。但 closure 将其列为 "残留事项" 而没有设定明确的移除 deadline。
- **建议修法**：
  1. 在 closure §4.1 中增加明确的 deadline："必须在 preview deploy 前完成 nacp-core 1.4.1 publish 并移除 dist overlay"。

### R8. frame-compat 层是映射而非真正统一

- **严重级别**：`low`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/src/frame-compat.ts`：`liftLightweightFrame()` 将 `{kind,...}` 映射为 NACP-shaped envelope。
  - closure §1.7 表格中标注："WS server frame | `{kind,...}` (compat-preserved) + `liftLightweightFrame()` 提供 NACP-shape mapping"。
- **为什么重要**：closure 在多个地方声称 "server frame 统一对齐 NacpSessionFrameSchema"，但 wire 上并未改变。这可能导致读者误以为客户端可以直接消费 NACP frame，而实际上仍需 compat 层。
- **审查判断**：这是文档表述的问题，不是技术错误。compat 层在当前阶段是合理的迁移策略。
- **建议修法**：在 `clients/api-docs/session-ws-v1.md` 中明确标注：当前 wire 格式仍为 `{kind,...}`，NacpSessionFrameSchema 通过 `liftLightweightFrame()` 在服务端映射。

### R9. HttpController 旧形状仍被兼容而非移除

- **严重级别**：`low`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts:518-533`：`wrapSessionResponse` 检测 `"ok" in body` 并只补 `trace_uuid`。
  - closure §1.7 表格中标注："DO `HttpController` 仍吐 `{ok:true,action,phase}` | acknowledged (v3) | 由 facade idempotently 包装"。
- **为什么重要**：closure §1.6 表格中 "DO `HttpController` 仍吐 `{ok:true,action,phase}`" 的状态是 "acknowledged"，而 §13.1 P4-03 标记为 "done"。这两者之间存在矛盾——如果旧形状仍在，则不是 "done" 而是 "wrapped"。
- **审查判断**：idempotent wrapping 是合理的技术选择，但 closure 的 Phase 表格应诚实反映状态。
- **建议修法**：将 P4-03 状态从 "done" 改为 "wrapped-with-compat"，并在说明中引用 `wrapSessionResponse` 的行号。

### R10. user-do.ts 1909 行，职责过重

- **严重级别**：`low`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts`：1909 行，包含 session lifecycle、D1 truth、dual-track parity、permission handling、WS attachment、frame forwarding、me-sessions 等。
- **为什么重要**：单文件职责过多会增加维护成本和 review 难度，也容易引入隐蔽的交叉依赖 bug。
- **审查判断**：这是一个长期的代码健康度问题，不阻塞 ZX2 收口。
- **建议修法**：在 ZX3 或后续 refactoring 中拆分 user-do.ts 为多个模块（如 session-lifecycle.ts、parity-bridge.ts、ws-attachment.ts）。

---

## 3. In-Scope 逐项对齐审核

### ZX1 In-Scope

| 编号 | 计划项 / closure claim | 审查结论 | 说明 |
|------|------------------------|----------|------|
| S1 | 扩展 WeChat 登录 contract | done | `WeChatLoginInputSchema` 已扩展 encrypted_data + iv |
| S2 | jscode2session + session_key decrypt | done | `wechat.ts:35-158` 完整实现 |
| S3 | JWT/salt/appid/secret 开发入口 | done | wrangler.jsonc 注释清晰，无 secret 入仓 |
| S4 | 6-worker health/version 聚合 | done | `/debug/workers/health` 存在，worker_version 统一 |
| S5 | clients/api-docs/ 建立 | done | 5 篇文档已创建 |

### ZX2 In-Scope

| 编号 | 计划项 / closure claim | 审查结论 | 说明 |
|------|------------------------|----------|------|
| S1 | 5 个 transport profile 命名冻结 | done | `transport-profiles.md` 存在 |
| S2 | workers_dev 显式审计 | done | 6 个 worker 全部显式声明 |
| S3 | NACP 协议对象公开 | done | `rpc.ts` 存在，30 测试覆盖 |
| S4 | nacp-session 5族7 message_type | done | `messages.ts` 存在，27 测试覆盖 |
| S5 | orchestrator-auth-contract 扩 facade-http-v1 | done | `facade-http.ts` 存在，15 测试覆盖 |
| S6 | NACP 双头校验 | partial | caller-side `validateRpcCall` 存在，但 bash-core callee-side 缺少 caller 枚举校验 |
| S7 | agent-core 4 RPC shadow + stream snapshot | partial | RPC 方法存在，但内部仍走 fetch（R1） |
| S8 | bash-core WorkerEntrypoint + secret + authority | partial | WorkerEntrypoint 存在，但缺少 caller 枚举校验（R5） |
| S9 | orchestrator-core session envelope 化 | partial | `wrapSessionResponse` 存在，但 HttpController 旧形状仍兼容（R9） |
| S10 | WS frame 对齐 NacpSessionFrameSchema | partial | compat 层存在，wire 未改变（R8） |
| S11 | 5 个 facade 必需 HTTP 端点 | done | 端点存在，测试覆盖 |
| S12 | `/me/sessions` server-mint UUID | partial | server-mint 存在，但 TTL GC 缺失（R6） |
| S13 | 客户端同步 + e2e | partial | 客户端已同步，但 live e2e 未运行（R4） |

### 3.1 对齐结论

- **done**: 10
- **partial**: 7
- **missing**: 0
- **stale**: 0
- **out-of-scope-by-design**: 0

> **总结**：ZX1-ZX2 更像是 "契约层与基础设施层完成，实现层存在包装与兼容，收口标准部分达成"。核心功能都已存在，但多处存在 "文档过度声明" 或 "实现打折扣" 的情况。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | 真实 secret 入仓 | 遵守 | 无真实 secret 在代码中 |
| O2 | 手机号解密 / UnionID 运营 | 遵守 | 未实现 |
| O3 | 内部 worker 单独 public debug 面 | 遵守 | 仅 orchestrator-core 暴露 debug |
| O4 | 小程序升级为产品级 UI | 遵守 | 仅基础调用示例 |
| O5 | context-core / filesystem-core 升级真 RPC | 遵守 | 仍为 library-only |
| O6 | 引入 MCP 服务器管理 | 遵守 | 未实现 |
| O7 | rewind / fork 端点 | 遵守 | 未实现 |
| O8-O11 | 产品型功能（messages/files/conversations/devices） | 遵守 | 明确推迟到 ZX3 |
| O12 | 新建 orchestrator-rpc-contract 包 | 遵守 | v2 已撤销，通用协议回收 NACP |
| O13 | gemini-cli 能力面对照 | 遵守 | 未实现，证据缺失 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：ZX1-ZX2 的代码实现是诚实的、可运行的、测试覆盖充分的。契约层（NACP、facade-http-v1、message_type registry）已经冻结，可以作为后续阶段的稳定基础。但 closure 文档存在多处过度声明，将 "已具备条件" 表述为 "已完成"，将 "RPC facade" 表述为 "全 RPC"，将 "compat 层映射" 表述为 "统一对齐"。这些表述差异虽然不影响代码运行，但会影响后续执行者对系统状态的理解，也可能导致 P3-05 翻转等关键运维动作被误判为 "已完成" 而延迟执行。
- **是否允许关闭本轮 review**：**yes，但须在关闭前完成以下 blocker**
- **关闭前必须完成的 blocker**：
  1. **R3 - 修改 ZX2-closure.md**：将 P3-05 状态从 "resolved" 改为 "runbook-ready, pending 7-day observation"；在 §8 中明确区分 "已落地" 与 "已翻转"。
  2. **R3 - 修改 ZX2-closure.md §1.6 表格**：将 P3-05 的 "HTTP 路径已删除" 改为 "HTTP 路径仍存在，具备翻转条件"。
  3. **R1 - 修改 ZX2-closure.md**：在 §1.6 agent-core 段落补充说明 RPC 方法内部仍通过 fetch 调用 DO。
- **可以后续跟进的 non-blocking follow-up**：
  1. **R5** - 在 bash-core `validateBashRpcMeta` 中补 caller 枚举校验。
  2. **R6** - 补 `/me/sessions` TTL GC 逻辑。
  3. **R7** - nacp-core 1.4.1 publish 后移除 dist overlay。
  4. **R4** - preview 部署后运行 live e2e 并收集 7 天观察期证据。
  5. **R10** - 后续 refactoring 拆分 user-do.ts。
- **建议的二次审查方式**：`same reviewer rereview`（由 Kimi 在 blocker 修复后复核 closure 修改）
- **实现者回应入口**：请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。

> 本轮 review 可以收口，但 closure 文档必须按 blocker 修正后才能标记为 closed。

---

## 6. 跨阶段跨包深度分析

### 6.1 zero-to-real 全阶段回顾

回顾 zero-to-real 的 Z0-ZX2 全部工作，我发现以下跨阶段盲点和断点：

**断点 1：session identity 的碎片问题**
- Z2/Z3 阶段建立了 session + conversation 的 D1 truth。
- ZX1 阶段没有触及 session identity。
- ZX2 阶段引入了 `/me/sessions` server-mint UUID，但 lazy 创建（首次 `/start` 才落 D1）。
- **问题**：如果用户在 POST `/me/sessions` 后 24h 内未 start，UUID 会丢失（因为没有持久化），但客户端可能仍持有这个 UUID。这与 "server-mint 是单一真相" 的设计意图矛盾。
- **建议**：要么在 POST `/me/sessions` 时立即写入 D1（eager），要么在客户端提供明确的 "session 已过期" 信号。

**断点 2：auth contract 与 facade-http-v1 的演化路径**
- ZX1 阶段冻结了 auth contract 的 `{ok,data}` / `{ok:false,error}` 形状。
- ZX2 阶段引入了 facade-http-v1，在 auth contract 包中扩展了 `trace_uuid`。
- **问题**：auth contract 现在同时承载 auth RPC contract 和 facade HTTP contract，命名上存在歧义（`orchestrator-auth-contract` 不再只是 auth）。
- **建议**：在 ZX3 或后续阶段考虑将 facade-http-v1 独立为 `orchestrator-facade-contract`，或重命名当前包以反映其双重职责。

**断点 3：binding-secret 与 NACP authority 的层级关系**
- ZX2 Phase 1 引入了 binding-secret（P1-03）。
- ZX2 Phase 3 引入了 NACP authority（P3-03）。
- **问题**：bash-core 同时校验 binding-secret 和 NACP authority，但其他非 facade worker（orchestrator-auth、context-core、filesystem-core）只有 binding-scope guard，没有 NACP authority。这意味着安全层级不一致。
- **建议**：在 transport-profiles.md 中明确标注每个 profile 的安全栈层级，并在后续阶段统一所有 internal worker 的 authority 校验。

**断点 4：worker health 的版本真实性**
- ZX1 阶段引入了 `WORKER_VERSION` env。
- 当前所有 worker 的 `WORKER_VERSION` 都是硬编码的 `xxx@preview`。
- **问题**：closure 建议 "在 CI/deploy 时改写为 worker-name@<git-sha-or-release>"，但当前没有 CI pipeline 证据。
- **建议**：在 deploy runbook 中增加 `WORKER_VERSION` 的自动注入步骤，或在 wrangler.jsonc 中使用 `${GITHUB_SHA}` 等变量（如果 wrangler 支持）。

### 6.2 命名规范问题

| 问题 | 位置 | 建议 |
|------|------|------|
| `forwardInternalJsonShadow` 中的 "Shadow" 命名不清晰 | `user-do.ts:842` | 建议改为 `forwardWithParity` 或 `dualTrackForward` |
| `AgentRpcMethodKey` 中 `streamSnapshot` 是 camelCase，其他是 lowercase | `user-do.ts:17-24` | 统一命名风格，建议全部 camelCase 或全部 lowercase |
| `jsonPolicyError` 函数名与 facade-http-v1 不符 | `policy/authority.ts` | 该函数现在返回 facade-http-v1 形状，建议重命名为 `facadePolicyError` |
| `liftLightweightFrame` 中的 "Lightweight" 无定义 | `frame-compat.ts` | 在文档中定义什么是 "lightweight frame" 什么是 "NACP frame" |

### 6.3 执行逻辑错误

**错误 1：parity 失败时返回 502 但不记录 metrics**
- `user-do.ts:869-877`：当 parity 失败时，返回 502 并带有详细的 rpc/fetch 对比信息。
- **问题**：closure 声称 "mismatch 分类记录"，但代码中没有看到 metrics/logging 输出。502 响应只在客户端可见，不会在服务端留下可观察的 trace。
- **建议**：在 parity 失败路径中增加 `console.error` 或 structured logging，以便在 preview 观察期中 grep `agent-rpc-parity-failed`。

**错误 2：streamSnapshot 的 cursor 缺乏校验**
- `agent-core/src/index.ts:223-225`：`streamSnapshot` RPC 方法接受 `cursor` 和 `limit` 参数。
- **问题**：没有验证 `limit` 是否在合理范围内（action-plan 要求默认 200，最大 1000）。
- **建议**：在 `invokeInternalRpc` 或 internal.ts 的 stream_snapshot handler 中增加 limit 边界校验。

---

*本审查由 Kimi 独立完成，未参考其他 reviewer（Deepseek、Opus、GPT）的分析报告。*
