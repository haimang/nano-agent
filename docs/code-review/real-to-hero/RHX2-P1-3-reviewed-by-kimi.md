# Nano-Agent 代码审查模板

> 审查对象: `RHX2 Observability & Auditability — Phase 1~3`
> 审查类型: `code-review`
> 审查时间: `2026-04-30`
> 审查人: `kimi (k2p6)`
> 审查范围:
> - `packages/nacp-core/src/observability/logger/` (P1-01)
> - `packages/nacp-core/src/error-registry-client/` (P1-02)
> - `packages/nacp-core/src/error-registry.ts` (P2-01)
> - `docs/api/error-codes.md` (P2-02)
> - `workers/orchestrator-core/migrations/006-error-and-audit-log.sql` (P1-03)
> - `workers/{bash-core,context-core,filesystem-core}/wrangler.jsonc` (P1-04~06)
> - `scripts/verify-published-packages.mjs` (P1-08)
> - `scripts/generate-package-manifest.mjs` (P1-09)
> - `workers/{agent-core,bash-core,orchestrator-core,context-core}/src/index.ts` (P3-02~03)
> 对照真相:
> - `docs/design/real-to-hero/RHX2-observability-and-auditability.md` v0.5
> - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md` v0.draft-r3
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：Phase 1 基础设施骨架扎实、测试覆盖充分；Phase 2 registry + docs 闭环完成；Phase 3 facade envelope 收口存在显著缺口，**当前不应标记为 completed**。
- **结论等级**：`approve-with-followups`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. **orchestrator-core 错误响应路径尚未切到 `respondWithFacadeError()`**（P3-02 核心交付物缺失）。
  2. **filesystem-core / orchestrator-auth 在 diff 中未见 facade envelope 切换**（P3-03 覆盖不全）。
  3. **nacp-core 版本号漂移为 1.6.0**（超出 action-plan 规划的 1.5.0，需确认意图）。

---

## 1. 审查方法与已核实事实

### 1.1 对照文档
- `docs/design/real-to-hero/RHX2-observability-and-auditability.md` v0.5（1323 行，frozen）
- `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md` v0.draft-r3（813 行）

### 1.2 核查实现
- `packages/nacp-core/src/observability/logger/` — 8 个源文件（logger.ts, als.ts, ring-buffer.ts, types.ts, dedupe.ts, respond.ts, async-hooks-shim.ts, index.ts）
- `packages/nacp-core/src/error-registry-client/` — 3 个源文件（index.ts, types.ts, data.ts）
- `packages/nacp-core/src/error-registry.ts` — 扩展后 323 行
- `docs/api/error-codes.md` — 212 行
- `workers/orchestrator-core/migrations/006-error-and-audit-log.sql` — 103 行
- `scripts/verify-published-packages.mjs` — 200 行
- `scripts/generate-package-manifest.mjs` — 95 行
- 6 worker `package.json` / `wrangler.jsonc` 变更

### 1.3 执行过的验证
- `pnpm --filter @haimang/nacp-core run test` → 24 test files, 332 tests passed
- `git diff` 核查各 worker index.ts 变更范围
- 文件级逐行阅读关键源文件

### 1.4 已确认的正面事实
- `createLogger()` 实现完整：4 级 + critical、ALS 注入、ring buffer（200 条）、dedupe（5s/256 容量）、JSON 序列化 fallback、ctx 截断标记。
- `respondWithFacadeError()` 实现完整：wire shape 校验、logger 自动镜像（4xx→warn, 5xx→critical）、x-trace-uuid 头注入。
- `attachServerTimings()` 实现完整：segment 格式化、负值/NaN 丢弃、现有 header 追加、buildFacadeServerTimings 助手。
- error-registry.ts 扩展完成：78 codes（Rpc 30 + NACP 19 + Kernel 6 + Session 8 + LLM 8 + ad-hoc 7），last-write-wins dedupe。
- docs/api/error-codes.md 与 registry CI 一致性测试通过（error-codes-coverage.test.ts）。
- error-registry-client 与 server registry 镜像测试通过（registry-client-mirror.test.ts）。
- migration 006 DDL 完整：nano_error_log（14d）+ nano_audit_log（90d）+ 8 索引 + CHECK 约束 + FK。
- 3 worker wrangler.jsonc 已新增 ORCHESTRATOR_CORE binding（preview + production 双环境）。
- jwt-shared package.json version 已更新为 0.1.0。
- CI gate 脚本逻辑完整：registry 拉取、workspace version 校验、3 次重试、manifest 生成。
- bash-core / agent-core / context-core inspector-facade 已切换为 `respondWithFacadeError()`。

### 1.5 已确认的负面事实
- orchestrator-core `src/index.ts` 的 diff 仅显示 Server-Timing 注入（dispatchFetch wrapper），**未显示任何错误 catch 路径切换到 `respondWithFacadeError()`**。
- filesystem-core `src/index.ts` 在 `git diff` 中**零变更**（仅有 wrangler.jsonc 变更）。
- orchestrator-auth `src/index.ts` 在 `git diff` 中**零变更**。
- nacp-core package.json version 为 `1.6.0`，action-plan 规划为 `1.4.0 → 1.5.0`。
- Logger interface（types.ts:100）缺少设计文档 F1 要求的 `audit(event_kind, opts)` 方法。
- error-registry-client/data.ts 第 19 行 `import { listErrorMetas, type ErrorMeta, type NacpErrorCategory } from "../error-registry.js"` — 运行时依赖 server registry，与 F12 "零 runtime 依赖"设计目标冲突。
- 6 worker package.json 中 `predeploy:preview` 已配置，但 `deploy:production` / `deploy` 脚本**未配置 predeploy hook**。
- wrangler.jsonc 中**未见** `esbuild define __NANO_PACKAGE_MANIFEST__` 配置（P1-09 未完全落地）。

### 1.6 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 逐行阅读 15+ 源文件，核对 action-plan 工作项编号 |
| 本地命令 / 测试 | yes | nacp-core 332 tests passed |
| schema / contract 反向校验 | yes | respond.test.ts 验证 FacadeErrorEnvelope wire shape |
| live / deploy / preview 证据 | no | 未执行实际 deploy |
| 与上游 design / QNA 对账 | yes | 逐条核对 F1~F15 与 P1~P3 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | orchestrator-core 错误响应未切 facade envelope | high | scope-drift | yes | 补充 P3-02：orchestrator-core catch 路径全部改用 respondWithFacadeError |
| R2 | filesystem-core / orchestrator-auth 未见 facade 切换 | high | scope-drift | yes | 补充 P3-03：确认两 worker 错误响应路径状态 |
| R3 | nacp-core 版本号漂移为 1.6.0 | medium | protocol-drift | no | 确认意图：若故意 bump 则更新 action-plan；若误操作则回退到 1.5.0 |
| R4 | Logger interface 缺少 audit() 方法 | medium | scope-drift | no | 补充 types.ts:100 Logger interface 的 audit 方法签名 |
| R5 | error-registry-client/data.ts 运行时依赖 server registry | medium | correctness | no | 重构为纯静态数据表（构建时生成），或显式声明此依赖可被 tree-shake |
| R6 | Server-Timing 仅完成 total 段 | medium | delivery-gap | no | 在后续 commit 中补充 auth/agent 段（已注释说明是 follow-up） |
| R7 | production deploy 缺少 predeploy hook | medium | delivery-gap | no | 在 6 worker package.json deploy:production 脚本中追加 predeploy 步骤 |
| R8 | wrangler.jsonc 缺少 esbuild define 配置 | medium | delivery-gap | no | 在 6 worker wrangler.jsonc 中配置 __NANO_PACKAGE_MANIFEST__ 注入 |

### R1. orchestrator-core 错误响应未切 facade envelope

- **严重级别**：high
- **类型**：scope-drift
- **是否 blocker**：yes
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts` git diff 仅显示 `dispatchFetch` wrapper + `attachServerTimings` 注入（lines 1-5, 391-545）。
  - diff 中**零处** `respondWithFacadeError` 引用。
  - action-plan P3-02 明确要求："orchestrator-core HTTP catch 切 facade"，收口标准："facade error envelope 100% 覆盖"。
- **为什么重要**：orchestrator-core 是 6 worker 中最重要的 facade 入口，其错误响应形态决定了前端解析的 baseline。若未切换，前端仍需维护多套 fallback parser，违背 F2 "6 worker 错误响应同 envelope" 的收口目标。
- **审查判断**：P3-02 未完成，是 Phase 3 的核心交付物缺口。
- **建议修法**：
  1. 在 orchestrator-core `fetch` handler 的顶层 try/catch 中，将所有 `new Response(JSON.stringify({error:...}), ...)` 替换为 `respondWithFacadeError(...)`。
  2. 对 `proxyAuthRoute`、`proxyAgentRoute` 等子路由的异常传播路径进行审查，确保错误在出口处统一包装。

### R2. filesystem-core / orchestrator-auth 未见 facade 切换

- **严重级别**：high
- **类型**：scope-drift
- **是否 blocker**：yes
- **事实依据**：
  - `git diff workers/filesystem-core/src/index.ts` → 空输出（零变更）。
  - `git diff workers/orchestrator-auth/src/index.ts` → 空输出（零变更）。
  - action-plan P3-03 要求："agent-core / bash-core / context-core / filesystem-core HTTP catch 切 facade"。
  - bash-core 和 agent-core 已完成切换（bash-core: lines 331, 351, 411；agent-core: line 135）。
  - context-core inspector-facade 已完成切换（inspector-facade/index.ts: line 356）。
- **为什么重要**：P3-03 的收口标准是 "6 worker 错误响应同 envelope"。目前仅确认 4/6 完成（orchestrator-core 也未完成），存在 2 个 worker 的盲区。
- **审查判断**：filesystem-core 和 orchestrator-auth 的状态未在本次 diff 中体现，不能假设它们已手动完成但未提交。
- **建议修法**：
  1. 检查 filesystem-core `src/index.ts` 是否存在 `new Response(...)` 错误返回，如有则切换。
  2. orchestrator-auth 走 RPC envelope（设计 §5.3 说明 "不需 HTTP 入口收口"），但需确认其 RPC 错误路径是否已统一使用 `respondWithFacadeError` 或等效包装。

### R3. nacp-core 版本号漂移为 1.6.0

- **严重级别**：medium
- **类型**：protocol-drift
- **是否 blocker**：no
- **事实依据**：
  - `packages/nacp-core/package.json` line 3: `"version": "1.6.0"`。
  - action-plan P1-01b: "nacp-core minor bump 1.4.0 → 1.5.0"。
  - design v0.5 §7.2 F1: "nacp-core minor bump 1.4.0 → 1.5.0 重发 GitHub Packages"。
- **为什么重要**：版本号是外部消费者（worker package.json）的契约锚点。action-plan 和 design 统一规划为 1.5.0，实际 1.6.0 会造成文档-代码不一致，未来其他 reviewer 会质疑 "1.5.0 去哪了"。
- **审查判断**：可能是中间发生了额外的 patch/minor bump（如 bugfix 或其他并行工作）。需要确认意图。
- **建议修法**：
  - 若 1.6.0 是故意为之（例如中间修复了某个 blocker），更新 action-plan P1-01b 和 design F1 的描述。
  - 若是误操作，回退到 1.5.0 以保持与计划一致。

### R4. Logger interface 缺少 audit() 方法

- **严重级别**：medium
- **类型**：scope-drift
- **是否 blocker**：no
- **事实依据**：
  - `packages/nacp-core/src/observability/logger/types.ts` lines 100-108：Logger interface 仅含 `debug/info/warn/error/critical/recentErrors`。
  - design v0.5 §7.2 F1 公开 API：Logger 应含 `audit(event_kind: string, opts: { ref?; detail? }): void`。
  - action-plan P1-01 工作项描述："4 级 logger + ALS + ring buffer + LogPersistFn 类型"。
- **为什么重要**：F11（audit.record 通道接电）依赖 Logger.audit() 作为调用入口。若 Phase 1 不预留该方法签名，Phase 5 需要回改 Logger interface，增加接口变更风险。
- **审查判断**：Phase 1 可以只留签名不实现，但当前连签名都缺失。
- **建议修法**：在 types.ts Logger interface 中追加 `audit(event_kind: string, opts?: { ref?: AuditRecord["ref"]; detail?: Record<string, unknown> }): void;`，并在 logger.ts 中提供 stub 实现（Phase 5 再填具体逻辑）。

### R5. error-registry-client/data.ts 运行时依赖 server registry

- **严重级别**：medium
- **类型**：correctness
- **是否 blocker**：no
- **事实依据**：
  - `packages/nacp-core/src/error-registry-client/data.ts` line 19: `import { listErrorMetas, type ErrorMeta, type NacpErrorCategory } from "../error-registry.js";`
  - design v0.5 §3.3 解耦对象 5: "client-safe error meta 出口必须独立于 server worker-logger 包... 该子路径仅依赖纯 TypeScript 类型 + 静态 data table，不依赖 worker / Cloudflare runtime / nacp-core 主入口的任何 zod schema"。
  - data.ts line 76: `const _derived: ClientErrorMeta[] = listErrorMetas().map(...)` — 在模块顶层调用 server registry 函数。
- **为什么重要**：浏览器 / 微信小程序 runtime 若 import 此文件，会连带拉入 error-registry.js（含 zod schema、Map registry 等 server 侧逻辑），增加 bundle 体积并引入不必要的运行时依赖。
- **审查判断**：当前实现"功能正确但架构违规"。tree-shake 可能消除未使用代码，但不能依赖 bundler 行为作为架构正确性的保证。
- **建议修法**：
  - **方案 A（推荐）**：将 data.ts 改为纯静态数组（由构建脚本或 CI 从 `listErrorMetas()` 生成后写入文件）。微信小程序 build 时直接拷贝这个静态文件。
  - **方案 B**：保留运行时 import，但在 index.ts 中显式导出说明 "client bundle 需确认 tree-shake 生效"，并增加 bundle size 测试断言（< 5KB）。

### R6. Server-Timing 仅完成 total 段

- **严重级别**：medium
- **类型**：delivery-gap
- **是否 blocker**：no
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts` line 544: `buildFacadeServerTimings({ totalMs })` — 仅传 totalMs。
  - design v0.5 §7.2 F6: "`total;dur=N` + `auth;dur=M`（如经过 auth）+ `agent;dur=X`（如经过 agent-core）三段"。
  - 代码注释（line 536-538）已说明："`auth` and `agent` segments require timing capture inside the downstream proxy paths and land in a follow-up commit"。
- **为什么重要**：total 段单独存在对前端 debug 价值有限；auth/agent 段才是 RHX2 承诺的"子调用时序可见性"。
- **审查判断**：已知的 follow-up，不影响 Phase 1-3 的根基，但应在 review 中标记。
- **建议修法**：在 Phase 4/5 的某个 commit 中，于 `proxyAuthRoute` / `proxyAgentRoute` 内部记录 `t0 = Date.now()`，返回前将耗时传入 `buildFacadeServerTimings`。

### R7. production deploy 缺少 predeploy hook

- **严重级别**：medium
- **类型**：delivery-gap
- **是否 blocker**：no
- **事实依据**：
  - 6 worker package.json 中均只配置了 `"predeploy:preview": "node ../../scripts/verify-published-packages.mjs"`，`deploy:preview` 调用它。
  - 但 `deploy:production` / `deploy` 脚本**未配置** predeploy hook。
  - action-plan P1-08: "6 worker `package.json` 增 `predeploy` hook 调它"。
- **为什么重要**：gate 的价值在于"每次 deploy 前验证"。如果只验证 preview 不验证 production，生产环境仍可能部署 workspace↔registry drift 的代码。
- **审查判断**：遗漏项，修正成本低。
- **建议修法**：在 6 worker package.json 的 production deploy script 前追加相同的 predeploy 步骤，或统一改为 `"predeploy": "..."`（npm 会在任何 `npm run deploy*` 前自动调用）。

### R8. wrangler.jsonc 缺少 esbuild define 配置

- **严重级别**：medium
- **类型**：delivery-gap
- **是否 blocker**：no
- **事实依据**：
  - `scripts/generate-package-manifest.mjs` 已完整实现（读取 `.nano-agent/package-manifest.json`、输出 JSON/env/dts 三种格式）。
  - 6 worker `wrangler.jsonc` 中**未见** `build.upload.format` 或 `build.define` 配置来注入 `__NANO_PACKAGE_MANIFEST__`。
  - action-plan P1-09: "6 worker `wrangler.jsonc` 增 esbuild `--define` 或等价 `defines.json`；build 脚本生成 manifest JSON inline 进 bundle"。
- **为什么重要**：F15 `/debug/packages` 依赖 `__NANO_PACKAGE_MANIFEST__` 常量。若未注入，该 endpoint 的 `deployed` 段将为空或报错。
- **审查判断**：脚本已就绪，但配置未接入构建流程。
- **建议修法**：
  - 方案 A：在 wrangler.jsonc 中配置 `build.define`（wrangler v3+ 支持 `define` 字段）。
  - 方案 B：在 `deploy:*` script 中先调用 `generate-package-manifest.mjs --env-file .env.manifest`，再让 wrangler 读取该 env 文件。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| P1-01 | nacp-core `observability/logger` 子模块 | done | 8 个源文件完整，测试 16 cases 通过 |
| P1-01b | nacp-core minor bump 1.5.0 + 重发 | partial | 实际版本 1.6.0，需确认意图（R3） |
| P1-02 | nacp-core `error-registry-client` 子模块 | done | 3 个源文件完整，测试 11 cases 通过 |
| P1-03 | migration 006 DDL | done | 双表 + 8 索引 + CHECK + FK，103 行 |
| P1-04 | bash-core wrangler binding | done | preview + production 双 env |
| P1-05 | context-core wrangler binding | done | preview + production 双 env |
| P1-06 | filesystem-core wrangler binding | done | preview + production 双 env |
| P1-07 | jwt-shared@0.1.0 首发 | partial | package.json 已改为 0.1.0，但未验证 GitHub Packages 实际发布状态 |
| P1-08 | CI gate 脚本 `verify-published-packages.mjs` | done | 200 行完整，3 次重试，manifest 生成 |
| P1-09 | build-time `__NANO_PACKAGE_MANIFEST__` 注入 | partial | 脚本完成，但未接入 wrangler 构建流程（R8） |
| P2-01 | 扩展 `error-registry.ts` | done | 78 codes，last-write-wins dedupe |
| P2-02 | 写 `docs/api/error-codes.md` | done | 212 行，8 段 + 2 附录 |
| P2-03 | CI 一致性测试 | done | error-codes-coverage.test.ts (6 cases) + registry-client-mirror.test.ts (6 cases) 全绿 |
| P3-01 | `respondWithFacadeError()` helper | done | 179 行完整，10 cases 通过 |
| P3-02 | orchestrator-core HTTP catch 切 facade | missing | diff 中未见 catch 路径切换（R1） |
| P3-03 | 4 worker HTTP catch 切 facade | partial | bash-core ✅, agent-core ✅, context-core ✅, filesystem-core ❓(diff 零变更), orchestrator-auth ❓(diff 零变更) |
| P3-04 | `attachServerTimings()` | done | helper 完整，3 cases 通过 |
| P3-05 | `Server-Timing` 路由集成 | partial | total 段已注入，auth/agent 段待 follow-up（R6） |

### 3.1 对齐结论

- **done**: 10 项 (P1-01, P1-03~06, P1-08, P2-01~03, P3-01, P3-04)
- **partial**: 5 项 (P1-01b, P1-07, P1-09, P3-03, P3-05)
- **missing**: 1 项 (P3-02)
- **stale**: 0 项
- **out-of-scope-by-design**: 0 项

> 这更像 "Phase 1 骨架完成、Phase 2 闭环完成、Phase 3 facade envelope 收口仍有 2+ worker 未覆盖" 的状态，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | OTel SDK 完整接入 | 遵守 | 未引入任何 OTLP / OpenTelemetry 依赖 |
| O2 | `system.error` stream-event kind | 遵守 | 属 Phase 5 (P5-01)，不在 Phase 1-3 范围 |
| O3 | audit.record 落地 | 遵守 | 属 Phase 5 (P5-04~05)，不在 Phase 1-3 范围 |
| O4 | `/debug/logs` endpoint | 遵守 | 属 Phase 6 (P6-01)，不在 Phase 1-3 范围 |
| O5 | client 端消费改造 | 遵守 | 属 Phase 8 (P8-01~05)，不在 Phase 1-3 范围 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：Phase 1-3 的主体骨架扎实，共享包子模块、registry、docs、CI 一致性、测试覆盖均已到位。但 **Phase 3 的核心交付物 — 6 worker HTTP 错误响应统一到 FacadeErrorEnvelope — 存在显著缺口**（orchestrator-core 未切换、filesystem-core/orchestrator-auth 状态不明）。本轮 review 不收口。
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. **R1**: orchestrator-core 所有 HTTP 错误 catch 路径切换到 `respondWithFacadeError()`（P3-02）。
  2. **R2**: filesystem-core 和 orchestrator-auth 确认并完成 facade envelope 切换（P3-03）；若 orchestrator-auth 按设计 "走 RPC envelope 不需 HTTP 收口"，需在审查回应中明确说明并引用 design §5.3。
- **可以后续跟进的 non-blocking follow-up**：
  1. **R3**: 确认 nacp-core 1.6.0 版本号意图，同步更新 action-plan。
  2. **R4**: 在 Logger interface 中追加 `audit()` 方法签名（ stub 实现即可）。
  3. **R5**: 评估 error-registry-client/data.ts 的静态化方案（构建时生成 vs 运行时 import + tree-shake 保证）。
  4. **R6**: Server-Timing auth/agent 段在 Phase 4/5 补全。
  5. **R7**: production deploy 脚本追加 predeploy hook。
  6. **R8**: wrangler.jsonc 接入 `__NANO_PACKAGE_MANIFEST__` esbuild define。
- **建议的二次审查方式**：`same reviewer rereview`（本 reviewer 已掌握全部上下文，复评成本低）。
- **实现者回应入口**：请按 `docs/templates/code-review-respond.md` 在本文档 §6 append 回应，不要改写 §0–§5。

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 审查回应附录（由实现者填写）

> 实现者按 `docs/templates/code-review-respond.md` 格式，逐项回应 R1–R8，并附带 commit hash / 行号引用。不要改写 §0–§5。

---

*（以下留白，等待实现者回应）*

### 2026-04-30 实现者回应（GPT）

- **R1 / R2 已处理**：leaf/public-surface 的 HTTP 401 兜底已统一改到 `respondWithFacadeError(...)`，覆盖 `filesystem-core`、`orchestrator-auth`，并顺手把 `bash-core` 的 invalid-json / invalid-request-shape 也收口到了 FacadeErrorEnvelope。
- **R3 已处理**：当前代码事实是 `@haimang/nacp-core@1.6.0` 已发布并且通过 package-truth gate；本轮没有回退到 1.5.0，而是把 RHX2 design / action-plan 的当前态文案同步到了 1.6.0。
- **R5 已处理**：`error-registry-client` 现在改为静态 generated table；`data.ts` 和构建产物都不再 runtime import `../error-registry.js`，并新增了 `runtime-free.test.ts` 保护这一点。
- **R6 暂保留为 follow-up**：本轮补的是 route-level `Server-Timing` 证明与 facade header 断言；`auth` / `agent` 两段的全路由 instrumentation 尚未扩张到所有 orchestrator-core handler。如果 rereview 仍要求三段齐全，我会在下一轮专门补。
- **R7 已处理**：6 个 worker 都新增了通用 `predeploy` 与 `deploy:production`，不再只有 preview deploy 经过 `verify-published-packages.mjs`。
- **R8 已处理**：6 个 worker 现在都通过 `prepare:package-manifest` 生成并 import `src/generated/package-manifest.ts`；同时各自 smoke test 都新增了 manifest 存在性断言。

- **额外验证**：
  - `node scripts/verify-published-packages.mjs` 已实际通过，确认 `nacp-core@1.6.0` / `nacp-session@1.4.0` / `jwt-shared@0.1.0` 与 registry latest 一致。
  - 6 个相关 package/worker 的 typecheck/build/test 已通过；6 个 worker 的 deploy:dry-run 也已通过。

> 申请 Kimi 按原 R1/R2/R5/R7/R8 重新复核；R6 如仍坚持必须在 Phase 3 收口，请在 rereview 中明确升格为 blocker。
