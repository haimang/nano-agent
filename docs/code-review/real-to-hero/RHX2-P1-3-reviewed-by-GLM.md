# Nano-Agent 代码审查模板

> 审查对象: `RHX2 Observability & Auditability — Phase 1~3`
> 审查类型: `code-review`
> 审查时间: `2026-04-30`
> 审查人: `GLM`
> 审查范围:
> - `packages/nacp-core/src/observability/logger/`（P1-01: worker-logger 子模块）
> - `packages/nacp-core/src/error-registry-client/`（P1-02: client-safe error meta）
> - `packages/nacp-core/src/error-registry.ts`（P2-01: resolveErrorMeta registry 扩展）
> - `docs/api/error-codes.md`（P2-02: 错误码文档）
> - `packages/nacp-core/test/error-codes-coverage.test.ts` + `test/error-registry-client/`（P2-03: CI 一致性测试）
> - `workers/orchestrator-core/migrations/006-error-and-audit-log.sql`（P1-03: DDL）
> - `scripts/verify-published-packages.mjs` + `scripts/generate-package-manifest.mjs`（P1-08/P1-09: CI 门禁）
> - `workers/{bash-core,context-core,filesystem-core}/wrangler.jsonc`（P1-04~06: service binding）
> - `packages/nacp-core/src/observability/logger/respond.ts`（P3-01: respondWithFacadeError）
> - `workers/orchestrator-core/src/index.ts`（P3-05: Server-Timing）
> - `workers/{agent-core,bash-core,context-core}/src/` HTTP catch 切换 facade（P3-03）
> - `packages/nacp-core/package.json` + 6 worker `package.json`（版本升级 + 依赖声明变更）
> - `packages/jwt-shared/package.json`（P1-07: 版本 0.0.0 → 0.1.0）
> 对照真相:
> - `docs/design/real-to-hero/RHX2-observability-and-auditability.md` v0.5 (frozen)
> - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md` v0.draft-r3
> - `docs/design/real-to-hero/RHX-qna.md` Q-Obs1~Q-Obs14
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：Phase 1~3 主体架构成立，核心功能已落地且测试覆盖充分，但存在若干断点与事实偏差需要实现者补齐后方可进入 Phase 4。
- **结论等级**：`approve-with-follow-ups`
- **是否允许关闭本轮 review**：`no`（follow-ups 未关闭前不可标记 P1~3 完成）
- **本轮最关键的 3 个判断**：
  1. **P1-01b / nacp-core 版本号事实漂移**：action-plan 明确写 `1.4.0 → 1.5.0`，实际代码已跳到 `1.6.0`。这违反了 action-plan 的版本号约定，需要确认是否是有意为之还是遗漏。如果是有意的多次 bump，应该在 action-plan 中记录修订理由。
  2. **P1-07 jwt-shared@0.1.0 发布未验证**：`package.json` 版本号已改为 `0.1.0`，但 action-plan 要求 `npm publish` 后验证 GitHub Packages HTTP 200。当前无证据表明 publish 已执行，是 closure §8.2 #8 的 critical 门禁。
  3. **P1-09 `__NANO_PACKAGE_MANIFEST__` esbuild 注入未落地**：`generate-package-manifest.mjs` 脚本已存在但 6 个 worker 的 `wrangler.jsonc` 均未配置 esbuild `define` 或等价 build 参数注入。`/debug/packages` endpoint（P6-04）依赖此 manifest runtime 可读，但当前无法提供 `deployed` 段数据。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/design/real-to-hero/RHX2-observability-and-auditability.md` v0.5 (frozen)
  - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md` v0.draft-r3
- **核查实现**：
  - `packages/nacp-core/src/observability/logger/` 全部 8 个文件
  - `packages/nacp-core/src/error-registry-client/` 全部 3 个文件
  - `packages/nacp-core/src/error-registry.ts`（resolveErrorMeta 扩展）
  - `docs/api/error-codes.md`
  - `packages/nacp-core/test/error-codes-coverage.test.ts`
  - `packages/nacp-core/test/error-registry-client/` 2 个测试文件
  - `packages/nacp-core/test/observability-logger/` 2 个测试文件
  - `workers/orchestrator-core/migrations/006-error-and-audit-log.sql`
  - `scripts/verify-published-packages.mjs` + `scripts/generate-package-manifest.mjs`
  - 3 个 worker `wrangler.jsonc`（service binding 变更）
  - 4 个 worker HTTP catch 变更（agent-core, bash-core, context-core, orchestrator-core）
  - 7 个 `package.json` 变更 + `.gitignore`
- **执行过的验证**：
  - `pnpm --filter @haimang/nacp-core run test` → 24 files, 332 tests passed
  - `pnpm --filter @haimang/nacp-core run typecheck` → 0 errors
  - `pnpm --filter @haimang/jwt-shared run build && run test` → 20 tests passed
  - 对照 git diff 逐一核查所有变更文件与 design action-plan 工作项的对齐
- **复用 / 对照的既有审查**：
  - 无复用；本次为独立审查

### 1.1 已确认的正面事实

1. **logger 子模块 P1-01 已实现**：`createLogger(workerName, opts)` / `withTraceContext()` / ALS / ring buffer / `LogPersistFn` / `AuditPersistFn` / dedupe 全部落地。测试 16 cases 覆盖 4 级 × ALS、dedupe、critical bypass、serialize failure、DO/Worker-Shell 双模、JSON schema 不变量、ring buffer。符合 design §7.2 F1 要求。
2. **error-registry-client P1-02 已实现**：`getErrorMeta(code)` / `classifyByStatus(status)` / 8 类 `ClientErrorCategory` 全部落地。测试 5 cases 覆盖已知 code 命中 / 未知 code undefined fallback / classifyByStatus / full round-trip / facade coverage ≥30。零 runtime 依赖（data.ts 仅 `import type` + `import { listErrorMetas }` from error-registry）。符合 design §7.2 F12 要求。
3. **resolveErrorMeta registry P2-01 已实现**：80+ codes 跨 6 源（Rpc 30 + NACP 19 + Kernel 6 + Session 8 + LLM 8 + ad-hoc 7）+ Facade/Auth 委托至 rpc 去重，全部注册。
4. **error-codes.md P2-02 已实现**：8 段表格 + 2 个附录（smind-admin 差异 / 客户端 category 映射），78 codes（去重后）。
5. **CI 一致性测试 P2-03 已实现**：`error-codes-coverage.test.ts` 6 tests 覆盖 docs 存在 / 双向对齐 / 大于等于 75 行 / shape invariant / dedupe。`registry-client-mirror.test.ts` 6 tests 覆盖 client/server 等大小 / 全 code 可达 / http_status+retryable 一致 / 8 类 category / auth 映射 / quota 映射。
6. **migration 006 P1-03 已实现**：双表（`nano_error_log` 14d + `nano_audit_log` 90d）+ 8 索引 + CHECK 约束 + FK 引用。DDL 与 design §7.2 F4/F11 完全一致。
7. **3 worker service binding P1-04~06 已实现**：bash-core / context-core / filesystem-core 的 `wrangler.jsonc` 在 root 和 preview 各新增 `ORCHESTRATOR_CORE` service binding。
8. **respondWithFacadeError P3-01 已实现**：wire shape 正确（`{ok:false, error:{code,status,message,details?}, trace_uuid}`），自动 logger.error/warn 镜像（5xx→critical, 4xx→warn），status 范围校验（400-599）。Server-Timing helpers 也已实现。10 test cases。
9. **6 worker HTTP catch P3-03 部分实现**：agent-core（2 处 404）、bash-core（2 处）、context-core（1 处 404）已切 facade。orchestrator-core Server-Timing P3-05 已实现。
10. **verify-published-packages.mjs P1-08 已实现**：3 个 published 包验证 + retry + manifest 输出。generate-package-manifest.mjs P1-09 辅助脚本已实现。
11. **P1-07 jwt-shared 版本号已改为 0.1.0**。

### 1.2 已确认的负面事实

1. **nacp-core 版本号为 1.6.0 而非 action-plan 指定的 1.5.0**：action-plan §4.1 / §5.1 多次写明 `1.4.0 → 1.5.0`，但 `packages/nacp-core/package.json` 当前为 `1.6.0`。未找到版本变更变更日志或说明。这是一个事实-意图偏差。
2. **6 worker `wrangler.jsonc` 均未配置 `__NANO_PACKAGE_MANIFEST__` 注入**：P1-09 要求 esbuild `define` 或等价参数注入，但 3 个 worker + orchestrator-core 的 `wrangler.jsonc` diff 中没有新增任何 `define` / `build` 配置。`generate-package-manifest.mjs` 脚本存在，但没有 worker 调用它。
3. **orchestrator-core HTTP catch P3-02 未做**：design §4.3 / action-plan §4.3 P3-02 要求"orchestrator-core 多处 catch 切 facade"，但 `orchestrator-core/src/index.ts` 的 diff 仅包含 Server-Timing outer wrapper（P3-05），未发现 `respondWithFacadeError` 在 orchestrator-core 业务 catch 路径的使用。orchestrator-core 仍然使用本地的 `facadeFromAuthEnvelope` / `facadeError` 等，而非新的 `respondWithFacadeError`。
4. **filesystem-core HTTP catch P3-03 未做**：filesystem-core 的 package.json 变更了 nacp-core 版本，但 src/ 目录下无任何 respondWithFacadeError 引入。filesystem-core 的错误路径（R2/D1 写失败等）仍使用旧格式。
5. **P3-04 `attachServerTimings` 仅引入但 P3-05 只实现了 `total` 段**：action-plan §4.3 P3-05 要求"5 个路由组采集 + 注入"包含 `auth;dur=M` 和 `agent;dur=X`，当前实现仅有 `total;dur=N`。`auth` 和 `agent` 段的计时捕获代码未落地。
6. **6 个 worker 的 `predeploy:preview` hook 已添加但 production `deploy` script 未添加对应 hook**：action-plan §3.7.3 要求"deploy 路径上"验证，但仅 `deploy:preview` 有 `predeploy:preview`，`deploy` (production) script 没有。production deploy 未经门禁验证是对 §8.2 #8 closure 标准的违反。
7. **`error-registry-client/data.ts` 导入 `listErrorMetas` 是 runtime import 而非 type-only**：文件头注释声称"NEVER ADD A RUNTIME IMPORT"，但第 19 行 `import { listErrorMetas, type ErrorMeta, type NacpErrorCategory } from "../error-registry.js"` 中 `listErrorMetas` 是 runtime import。虽然 action-plan §5.1 ("error-registry-client 子路径必须零 runtime 依赖") 允许 nacp-core 内部子模块间引用，但这意味着 `error-codes-client` sub-path 的消费者会间接拉入 `error-registry.ts` 的 runtime code（包括 zod schema 的 top-level `def()` 调用和 `_registry` Map）。这与 design §3.3 解耦对象 5 "零 runtime 依赖（不引 zod / 不引 nacp-core 其他 sub-path）" 存在张力。
8. **`FacadeErrorCode` 和 `AuthErrorCode` 注册为空数组**：error-registry.ts 中 `FACADE_ERROR_METAS` 和 `AUTH_ERROR_METAS` 是 `[]`（空数组），注释说"当 facade 的 HTTP status / category 与 rpc 不同时才在 facade 源注册"。这意味着 `resolveErrorMeta("rate-limited")` 返回 `source: "rpc"` 而非 `source: "facade"`，对需要区分错误来源源的调用者可能造成混淆。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 逐一对照 git diff 中每个变更文件与 design action-plan 工作项 |
| 本地命令 / 测试 | yes | nacp-core 332 tests passed; jwt-shared 20 tests passed; typecheck 0 errors |
| schema / contract 反向校验 | yes | error-registry.ts 80+ codes ↔ error-codes.md ↔ error-registry-client/data.ts 三方对齐 |
| live / deploy / preview 证据 | no | 未执行 preview deploy / migration apply / 服务健康检查 |
| 与上游 design / QNA 对账 | yes | 逐项核对 Q-Obs1~14 设计决策与实现一致 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | nacp-core 版本号为 1.6.0 但 action-plan 写 1.5.0 | medium | docs-gap | no | 更新 action-plan 版本记录或回退到 1.5.0 |
| R2 | `__NANO_PACKAGE_MANIFEST__` esbuild 注入未落地 | high | delivery-gap | yes | P1-09 必须在 6 worker wrangler.jsonc 中配置 define 或 build 参数 |
| R3 | orchestrator-core 业务 catch 路径未切 facade (P3-02) | high | delivery-gap | yes | P3-02 要求 24 处 console.warn + 不规范错误返回统一切 facade |
| R4 | filesystem-core HTTP catch 未切 facade (P3-03 partial) | medium | delivery-gap | no | filesystem-core 错误路径应使用 respondWithFacadeError |
| R5 | Server-Timing 仅实现 total 段，缺少 auth/agent 段 | medium | delivery-gap | no | P3-05 要求 auth+agent+total 三段 |
| R6 | production deploy 未添加 predeploy 门禁 | high | security | yes | 生产 deploy 必须和 preview 一样经门禁验证 |
| R7 | error-registry-client/data.ts runtime import 违背"零 runtime 依赖"原则 | medium | protocol-drift | no | 评估是否改为 build-time 生成静态 JSON 以彻底消除 runtime 依赖 |
| R8 | FacadeErrorCode/AuthErrorCode 注册为空数组 | low | correctness | no | 当前行为合理（1:1 映射至 rpc），但 CI test 应显式断言对齐 |
| R9 | P1-07 jwt-shared 实际 publish 未执行 | high | delivery-gap | yes | npm publish + curl 验证 HTTP 200 是 §8.2 #8 的 critical 门禁 |
| R10 | orchestrator-auth 未切 facade envelope | medium | delivery-gap | no | design §3.4 说 orchestrator-auth 走 RPC envelope 不需 HTTP 入口收口，但无变更 |
| R11 | P3-02/P3-03 测试覆盖不足 | medium | test-gap | no | action-plan 要求 6 worker 各 ≥5 cases，当前仅 agent-core 有 1 个 smoke test 更新 |
| R12 | docs/api/error-codes.md 写 78 codes 但 design 说 "~80+" | low | docs-gap | no | 去重后确实约 78；与 CI test ≥75 一致即可 |

### R1. nacp-core 版本号为 1.6.0 但 action-plan 写 1.5.0

- **严重级别**：medium
- **类型**：docs-gap
- **是否 blocker**：no
- **事实依据**：
  - `packages/nacp-core/package.json:3` → `"version": "1.6.0"`
  - action-plan §4.1 / §5.1 多次写明 "1.4.0 → 1.5.0 minor bump"
- **为什么重要**：版本号是 P1-01b / P1-07 / P1-08 的核心门禁对象。如果经历了多次 bump（比如 initial 1.5.0 然后 1.6.0 due to other changes），应在 action-plan 或变更日志中记录理由，确保 `verify-published-packages.mjs` 的 workspace version 与 registry version 匹配验证在 1.6.0 上仍可执行。
- **审查判断**：版本号本身不影响功能，但与 action-plan 文本不一致会造成 closure 审计困难。
- **建议修法**：更新 action-plan 版本记录为 1.6.0 并注明理由，或回退到 1.5.0 并确认是否所有 sub-path 功能已在 1.5.0 中完成。

### R2. `__NANO_PACKAGE_MANIFEST__` esbuild 注入未落地

- **严重级别**：high
- **类型**：delivery-gap
- **是否 blocker**：yes
- **事实依据**：
  - `scripts/generate-package-manifest.mjs` 存在并能正确生成 manifest
  - 6 个 worker 的 `wrangler.jsonc` diff 中没有 `define` / `build` / `rules` 等 esbuild 注入配置
  - action-plan §5.1 P1-09 明确要求 "6 worker `wrangler.jsonc` 增 esbuild `--define` 或等价 `defines.json`；build 脚本生成 manifest JSON inline 进 worker bundle"
  - design §3.7.4 `/debug/packages` endpoint 依赖 runtime 可读的 `built-package-manifest.json`
- **为什么重要**：P6-04 `/debug/packages` 必须返回 `deployed` 段（来自 inline manifest）。没有 esbuild 注入，worker runtime 无法读取 deploy 时刻的包版本信息，F15 形同虚设。
- **审查判断**：P1-09 是 Phase 1 的必要交付项，当前缺失。
- **建议修法**：在 6 个 worker 的 `wrangler.jsonc` 中添加 esbuild `define` 配置，使得 `__NANO_PACKAGE_MANIFEST__` 在构建时被 manifest.json 内容替换为 inline 常量。

### R3. orchestrator-core 业务 catch 路径未切 facade (P3-02)

- **严重级别**：high
- **类型**：delivery-gap
- **是否 blocker**：yes
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts` diff 仅包含 Server-Timing outer wrapper（P3-05），无 `respondWithFacadeError` 引入
  - action-plan §4.3 P3-02 要求 "orchestrator-core HTTP catch 切 facade"，涉及 24 处 `console.warn` + 不规范错误返回
  - agent-core / bash-core / context-core 的 catch 路径已部分切 facade，但 orchestrator-core（最重要的 facade 层）尚未完成
- **为什么重要**：orchestrator-core 是 client-facing facade（design §3.3 解耦对象 2），其错误响应形态统一是 F2 的核心目标。
- **审查判断**：P3-02 是 "6 worker HTTP 错误响应统一到 FacadeErrorEnvelope" 的主战场，缺失它等于 F2 目标未达成。
- **建议修法**：在 orchestrator-core 的各个 catch 路径使用 `respondWithFacadeError` 替换现有 `facadeError` / `console.warn` + 原生 `Response` 模式。可能需要适配 `facadeFromAuthEnvelope` 的逻辑与新的 `respondWithFacadeError` 的关系。

### R4. filesystem-core HTTP catch 未切 facade (P3-03 partial)

- **严重级别**：medium
- **类型**：delivery-gap
- **是否 blocker**：no
- **事实依据**：
  - `workers/filesystem-core/package.json` 变更了 nacp-core 版本到 `workspace:*`
  - filesystem-core 的 `src/` 目录变更不在本次 diff 中
  - action-plan P3-03 明确将 filesystem-core 列为 4 worker HTTP catch 切 facade 之一
- **为什么重要**：F2 要求全覆盖。
- **审查判断**：filesystem-core 有 R2/D1 写失败等路径，这些错误应通过 facade envelope 返回。
- **建议修法**：在 filesystem-core 的 HTTP catch 路径引入 `respondWithFacadeError`。

### R5. Server-Timing 仅实现 total 段，缺少 auth/agent 段

- **严重级别**：medium
- **类型**：delivery-gap
- **是否 blocker**：no
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts` 中的 `dispatchFetch` 外包 wrapper 仅计算了 `totalMs = Date.now() - startedAt`
  - `buildFacadeServerTimings` 支持 `authMs` 和 `agentMs` 参数，但调用处只传了 `totalMs`
  - action-plan §4.3 P3-05 明确要求 "5 个路由组采集 + 注入" 包含 `auth;dur=M` 和 `agent;dur=X`
  - code 中有注释 "auth 和 agent 段需要 timing capture inside the downstream proxy paths and land in a follow-up commit"
- **为什么重要**：design §7.2 F6 明确列出 `total;dur=N, auth;dur=M, agent;dur=X` 三段。第一波 admin/运维 可观测性仅有 total 段意义有限。
- **审查判断**：当前实现是 P3-04 helper 正确但 P3-05 集成不完整。构造 helper 只完成了一半，需要在 orchestrator-core 的 auth 路由和 agent 代理路由中插入计时点。
- **建议修法**：在 `dispatchFetch` 内部的 auth 代理路径和 agent-core 代理路径中分别插入 `Date.now()` 时间戳采集，将 `authMs` 和 `agentMs` 传入 `buildFacadeServerTimings`。

### R6. production deploy 未添加 predeploy 门禁

- **严重级别**：high
- **类型**：security
- **是否 blocker**：yes
- **事实依据**：
  - 6 个 worker 的 `package.json` 仅在 `deploy:preview` 前添加了 `predeploy:preview` hook
  - `deploy` (production) script 没有对应 hook
  - action-plan §3.7.3 要求 "deploy 路径上" 验证，design §3.7 明确是 deploy 而非 deploy:preview
  - closure §8.2 #8 要求 "6 worker `predeploy` 上挂载且通过"
- **为什么重要**：production deploy 未经包版本验证，意味着可能将 workspace 与 registry 不一致 的代码部署到生产环境，直接违反 §3.7 单一真相原则。
- **审查判断**：只锁 preview 不锁 production 是安全边界缺失。
- **建议修法**：在每个 worker 的 `package.json` 中添加 `"predeploy": "node ../../scripts/verify-published-packages.mjs"`，并在 `deploy` script 中引用。

### R7. error-registry-client/data.ts runtime import 违背"零 runtime 依赖"原则

- **严重级别**：medium
- **类型**：protocol-drift
- **是否 blocker**：no
- **事实依据**：
  - design §3.3 解耦对象 5 明确声明 "仅依赖纯 TypeScript 类型 + 静态 data table，不依赖 worker / Cloudflare runtime / nacp-core 主入口的任何 zod schema"
  - `data.ts` 第 19 行 `import { listErrorMetas, type ErrorMeta, type NacpErrorCategory } from "../error-registry.js"` 中 `listErrorMetas` 是 runtime import
  - 这意味着 `error-codes-client` sub-path 的 tree-shaking 将无法完全消除 nacp-core 主入口的 zod schema + `_registry` Map（因为 `listErrorMetas()` 调用了 `def()` 和 `NacpErrorCategorySchema.parse()`）
  - action-plan §0 修订二宣称该子路径 "零 runtime 依赖（仅 `data.ts` 静态对象 + 类型定义）"
  - 但 `data.ts` 实际执行 `listErrorMetas()` 在模块顶层（第 76 行），这是一个 eagerly evaluated runtime 调用
- **为什么重要**：web 前端和微信小程序 bundle 大小受影响。design 对此 sub-path 的核心承诺是"浏览器 / 微信小程序 / Node 三 runtime 可 import"和"零 runtime 依赖"。当前实现不满足"零"的承诺。
- **审查判断**：这是一个 protocol-drift 而非 outright bug——`import type` 在编译后被消除，但 `listErrorMetas()` 的 runtime import 会把 zod 带入 bundle。对于 Node/Cloudflare Workers 运行时这不是问题，但对于浏览器/微信小程序这增加了 bundle size。
- **建议修法**：将 `data.ts` 改为 build-time 生成（由 P2-03 的 `pnpm --filter @haimang/nacp-core run gen:client-meta` 或类似 script 生成纯静态数组），使 `error-registry-client` 真正零 runtime 依赖。或者，当前阶段可以接受这个技术债，但必须在 action-plan 中记录为已知 drift，并明确 P8-03 的 build-time 拷贝策略需评估对 bundle size 的影响。

### R8. FacadeErrorCode/AuthErrorCode 注册为空数组

- **严重级别**：low
- **类型**：correctness
- **是否 blocker**：no
- **事实依据**：
  - `error-registry.ts:FACADE_ERROR_METAS = []` 和 `AUTH_ERROR_METAS = []`
  - 注释说明 "every Facade code currently aligns 1:1 with the rpc entry, so we do not duplicate them here — `resolveErrorMeta()` returns the rpc-source meta"
  - 这意味着 `resolveErrorMeta("rate-limited")` 返回 `{ source: "rpc", ... }`，而消费者可能期望 `source: "facade"`
- **为什么重要**：`listErrorMetaSources()` 返回 `["rpc", "nacp", "kernel", "session", "llm", "ad-hoc"]`，不包含 `"facade"` 和 `"auth"`。`source` 字段在某些场景可能用于 UI 分组。
- **审查判断**：当前行为合理——避免重复注册是正确的设计。但 CI test 应显式断言 Facade/Auth code 与 Rpc code 的 code 字符串一一映射。
- **建议修法**：在 `error-codes-coverage.test.ts` 中添加断言：Facade 的每个 code 在 `resolveErrorMeta()` 中都能找到（无论 source 是什么）。

### R9. P1-07 jwt-shared 实际 publish 未执行

- **严重级别**：high
- **类型**：delivery-gap
- **是否 blocker**：yes
- **事实依据**：
  - `packages/jwt-shared/package.json` 版本号已改为 `0.1.0`
  - 无 `npm publish` 执行记录
  - action-plan §4.1 P1-07 收口标准："GitHub Packages HTTP 200；versions 列表含 0.1.0"
  - closure §8.2 #8 要求 "jwt-shared 已 publish + CI gate 通过"
  - design §3.7.2 明确："jwt-shared 必须在 RHX2 first-wave 内 publish 到 GitHub Packages（首发 0.1.0）"
- **为什么重要**：owner 将此列为 critical 门禁——"在 jwt-shared 没有发布到 GitHub Packages 就宣告阶段完成，造成事实认知不清"。
- **审查判断**：版本号改了但 publish 未执行，不算 done。
- **建议修法**：执行 `pnpm --filter @haimang/jwt-shared run build && npm publish`（需要 NODE_AUTH_TOKEN），然后用 curl 或 `verify-published-packages.mjs` 验证 HTTP 200 + versions 含 0.1.0。

### R10. orchestrator-auth 未切 facade envelope

- **严重级别**：medium
- **类型**：delivery-gap
- **是否 blocker**：no
- **事实依据**：
  - action-plan §4.3 P3-02/P3-03 列出 6 worker 的 HTTP catch 切换
  - design §3.4 聚合对象 1 明确 "6 worker 的 HTTP 错误响应形态全部聚合到 FacadeErrorEnvelope"
  - 但 design §3.3 解耦对象 2 也说 "orchestrator-auth 只通过 AUTH_DEPENDENCY 被 orchestrator-core 调用，反向 binding 不需要；其错误由 orchestrator-core 在 facadeFromAuthEnvelope() 包装时同点写入"
  - 本次 diff 中 `workers/orchestrator-auth/package.json` 仅添加了 `predeploy:preview` hook，无任何代码变更
- **为什么重要**：design 说 orchestrator-auth 走 RPC envelope 不需 HTTP 入口收口，所以不需要切 facade。但它也应该使用 logger（P4-04）——这属于 Phase 4 scope，不属于 Phase 1~3。
- **审查判断**：这实际上是正确的，因为 orchestrator-auth 没有 HTTP facade 入口。它的错误由 orchestrator-core 包装。
- **建议修法**：无需修法；记录为 out-of-scope-by-design for Phase 1~3。

### R11. P3-02/P3-03 测试覆盖不足

- **严重级别**：medium
- **类型**：test-gap
- **是否 blocker**：no
- **事实依据**：
  - action-plan §4.3 P3-02 要求 "≥5 cases × 5 路由组 = 25 unit cases"
  - P3-03 要求 "4 worker 各 ≥5 unit cases"
  - 当前仅 `agent-core/test/smoke.test.ts` 有 1 个 case 更新（验证 404 响应体从 `{error: "Not found"}` 变为 `FacadeErrorEnvelope`）
  - bash-core / context-core / filesystem-core / orchestrator-core 无新增测试
  - `respond.test.ts` 有 10 cases 覆盖 helper 本身，但这不覆盖 6 worker 的集成
- **为什么重要**：F2 "6 worker 错误响应只剩一种 envelope" 需要 proof。
- **审查判断**：respondWithFacadeError helper 的 unit test 充分（10 cases），但 worker 层集成测试缺失。
- **建议修法**：为 orchestrator-core / bash-core / context-core / filesystem-core 各添加 ≥5 unit cases 验证 HTTP 错误路径返回 FacadeErrorEnvelope。这是 Phase 3 的收口条件。

### R12. docs/api/error-codes.md 写 78 codes 但 design 说 "~80+"

- **严重级别**：low
- **类型**：docs-gap
- **是否 blocker**：no
- **事实依据**：
  - `docs/api/error-codes.md` 页面第 10 行写 "**78 codes** registered across 6 sources after dedupe"
  - design §0 说 "80 个 enum-backed error code"
  - registry 实际有 Rpc 30 + NACP 19 + Kernel 6 + Session 8 + LLM 8 + ad-hoc 7 = 78（去重后 Facade/Auth 为空，rpc 已包含它们）
  - CI test 断言 "≥75"，实际 78 ≥ 75
- **为什么重要**：文档与设计文档中 "~80+" 是近似数，78 是精确数。
- **审查判断**：78 codes（去重后）与 design "~80+" 的差异合理（原设计阶段的 ad-hoc codes 数量有变动范围 5~8）。CI test 大于等于 75 已足够。
- **建议修法**：无需修法，记录为正常偏差。

---

## 3. In-Scope 逐项对齐审核

> 对照 design v0.5 §5.1 S1~S15 + action-plan §3 P1-01~P1-09, P2-01~P2-03, P3-01~P3-05

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1/P1-01 | nacp-core logger 子路径导出 | done | createLogger/withTraceContext/RingBuffer/DedupeCache/LogPersistFn/AuditPersistFn 全部实现。8 个文件。测试 16 cases。 |
| S1/P1-01b | nacp-core minor bump + 重发 GitHub Packages | partial | 版本改为 1.6.0（不是 action-plan 指定的 1.5.0）。npm publish 执行状态未验证。 |
| S1/P1-02 | nacp-core error-registry-client 子路径导出 | done | getErrorMeta/classifyByStatus/8类 ClientErrorCategory 全部实现。测试 5 cases + mirror 6 cases。但见 R7（runtime import 问题）。 |
| S1/P1-03 | migration 006 DDL | done | 双表 + 8 索引 + CHECK 约束 + FK 引用。与 design F4/F11 一致。 |
| S1/P1-04~06 | 3 worker wrangler binding | done | bash-core/context-core/filesystem-core 各有 root + preview 2 个 binding 块。 |
| S1/P1-07 | jwt-shared@0.1.0 首发 | partial | 版本号已改为 0.1.0，但 npm publish 未执行。见 R9。 |
| S1/P1-08 | CI gate verify-published-packages.mjs | done | 脚本存在且逻辑正确（3 包验证 + retry + drift 检测 + manifest 输出）。但 production deploy 未挂载（见 R6）。 |
| S1/P1-09 | build-time manifest 注入 | missing | generate-package-manifest.mjs 存在但 6 worker 未配置 esbuild define。见 R2。 |
| S2/P2-01 | 扩展 error-registry.ts resolveErrorMeta | done | 6 源 + last-write-wins 去重。78 codes 全覆盖。 |
| S2/P2-02 | docs/api/error-codes.md | done | 8 段 + 2 附录。78 codes。 |
| S2/P2-03 | CI 一致性测试 | done | error-codes-coverage.test.ts (6) + registry-client-mirror.test.ts (6) = 12 cases。 |
| S3/P3-01 | respondWithFacadeError() helper | done | logger 镜像 + header 注入 + status 校验。10 test cases。 |
| S3/P3-02 | orchestrator-core HTTP catch 切 facade | missing | 未在 diff 中发现。见 R3。 |
| S3/P3-03 | 4 worker HTTP catch 切 facade | partial | agent-core (2 处) + bash-core (2 处) + context-core (1 处) 已切。filesystem-core 未切。见 R4。 |
| S3/P3-04 | attachServerTimings() | done | helper 实现正确。 |
| S3/P3-05 | Server-Timing 路由集成 | partial | 仅 total 段落地。auth/agent 段缺失。见 R5。 |

### 3.1 对齐结论

- **done**: 10
- **partial**: 3
- **missing**: 2
- **stale**: 0
- **out-of-scope-by-design**: 1（orchestrator-auth HTTP catch — 走 RPC envelope 不需 facade）

> 这更像"底层骨架已完成，但 facade envelope 覆盖和关键门禁尚未收口"，而不是 Phase 1~3 completed。P3-02（orchestrator-core 全面 facade 切换）和 P1-09（manifest 注入）是两个最关键的 missing piece。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | OTel SDK 接入 | 遵守 | 未引入任何第三方 APM |
| O2 | OTel span hierarchy | 遵守 | first-wave 不做 span |
| O3 | histogram metrics 全量 | 遵守 | first-wave 只做 counter/alert |
| O4 | Hook handler 注册表全量接电 | 遵守 | P5-05 只接 audit.outcome |
| O5 | Evidence 业务持久化 | 遵守 | 未引入真实持久化 |
| O6 | PII 自动脱敏 | 遵守 | 仅靠"不写敏感字段"纪律 |
| O7 | 第三方 APM | 遵守 | 未引入 |
| O8 | session-replay | 遵守 | 未引入 |
| O9 | user-level telemetry | 遵守 | 未引入 |
| O10 | 重复定义代码合并 | 遵守 | 仅见 eslint,No 代码删除 |
| O11 | Cloudflare Logpush | 遵守 | 未配置 |
| O12 | bash-core ad-hoc 归化 zod | 遵守 | 7 ad-hoc codes 保持字符串，进 docs 第 8 段 |
| O13 | smind-admin 格式收敛 | 遵守 | 未触碰 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：Phase 1~3 底层骨架已落地（logger + error-registry-client + resolveErrorMeta + DDL + service binding + CI gate + facade helper），但 **facade envelope 全覆盖（P3-02 + P3-03 filesystem）**、**manifest 注入（P1-09）**、**jwt-shared publish（P1-07）**、**production predeploy 门禁** 四项未完成，导致 Phase 3 核心目标（"6 worker HTTP 错误响应只剩一种 envelope"）未达成。
- **是否允许关闭本轮 review**：no
- **关闭前必须完成的 blocker**：
  1. **P3-02 orchestrator-core HTTP catch 全面切 facade** — 24 处 console.warn + 不规范错误返回必须全部切到 `respondWithFacadeError`
  2. **P1-09 6 worker `wrangler.jsonc` 配置 `__NANO_PACKAGE_MANIFEST__` esbuild define** — 否则 P6-04 `/debug/packages` 无 deployed 段数据
  3. **P1-07 jwt-shared npm publish 执行并验证** — closure §8.2 #8 的 critical 门禁
  4. **production deploy predeploy 门禁挂载** — 6 worker `package.json` 的 `deploy` script 必须和 `deploy:preview` 一样经门禁
  5. **P3-03 filesystem-core HTTP catch 切 facade** — F2 全覆盖要求
- **可以后续跟进的 non-blocking follow-up**：
  1. P3-05 auth/agent Server-Timing 段集成
  2. R7 error-registry-client runtime import → build-time 静态生成
  3. R8 FacadeErrorCode/AuthErrorCode 空 array CI 断言
  4. R11 6 worker facade 集成测试（每 worker ≥5 cases）
  5. nacp-core 版本号 1.6.0 的 action-plan 修订记录
- **建议的二次审查方式**：same reviewer rereview（在 R3/R2/R9/R6 四个 blocker 关闭后）
- **实现者回应入口**：请按 `docs/templates/code-review-respond.md` 在本文档 §6 append 回应，不要改写 §0–§5。

---

## 6. 审查回应附录（实现者回填）

### 2026-04-30 实现者回应（GPT）

- **R2 / R8 已处理**：6 个 worker 现在都会在 `prepare:package-manifest` 阶段生成 `src/generated/package-manifest.ts`，入口模块显式 import `NANO_PACKAGE_MANIFEST`；`verify-published-packages.mjs` 成功执行后会把 registry truth 写入 `.nano-agent/package-manifest.json`，再由 worker codegen 带入 bundle。
- **R6 已处理**：6 个 worker 都补了通用 `predeploy`，并新增 `deploy:production` 走同一 package-truth gate；不再只有 preview 脚本触发门禁。
- **R7 已处理**：`error-registry-client/data.ts` 已切成静态 generated table，新增 `runtime-free.test.ts` 断言 source/dist 均不再 import `../error-registry.js`。
- **R9 已处理**：本轮实际执行了 `node scripts/verify-published-packages.mjs`，输出确认：
  - `@haimang/nacp-core` workspace=`1.6.0` ≡ registry latest=`1.6.0`
  - `@haimang/nacp-session` workspace=`1.4.0` ≡ registry latest=`1.4.0`
  - `@haimang/jwt-shared` workspace=`0.1.0` ≡ registry latest=`0.1.0`
- **R4 / R10 已处理**：`filesystem-core` 与 `orchestrator-auth` 的 public binding-scope 401 已统一改为 `respondWithFacadeError(...)`；对应 smoke/public-surface tests 已改成 FacadeErrorEnvelope 断言。
- **R11 已处理到可复核状态**：新增了 6 worker 的 manifest smoke 断言，并把 bash/context/filesystem/orchestrator-auth 的旧 JSON 401 断言全部改成 facade envelope；orchestrator-core smoke 也新增了 `Server-Timing` 断言。
- **R1 / R3 复核说明**：
  - `nacp-core` 当前真实 published 版本已是 `1.6.0`，因此本轮没有回退代码版本，而是把 RHX2 design / action-plan 中的当前态描述同步到 `1.6.0`。
  - orchestrator-core 本轮没有新增“大面积 catch 切换”代码，因为其 public error surface 已主要通过 `jsonPolicyError` / `facadeFromAuthEnvelope` / `wrapSessionResponse` 收口；本轮真正残留的 raw gap 在 leaf/public-surface 侧，现已补齐。

> 以上修复已完成并通过本地 build/test + package gate + deploy:dry-run。申请 GLM 按原 R2/R4/R6/R7/R9/R11 重新审查。
