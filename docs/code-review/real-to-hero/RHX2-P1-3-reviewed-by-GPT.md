# RHX2 Phase 1–3 代码审查（GPT）

> 审查对象: `RHX2 Phase 1–3（Observability & Auditability）未提交实现`
> 审查类型: `code-review`
> 审查时间: `2026-04-30`
> 审查人: `GPT-5.4`
> 审查范围:
> - `docs/design/real-to-hero/RHX2-observability-and-auditability.md`
> - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md`
> - `packages/nacp-core/{package.json,src/error-registry.ts,src/error-registry-client/**,src/observability/logger/**,test/**}`
> - `scripts/{verify-published-packages.mjs,generate-package-manifest.mjs}`
> - `workers/{orchestrator-core,agent-core,bash-core,context-core,filesystem-core,orchestrator-auth}/**`
> - `workers/orchestrator-core/migrations/006-error-and-audit-log.sql`
> - `docs/api/error-codes.md`
> 对照真相:
> - `docs/design/real-to-hero/RHX2-observability-and-auditability.md`
> - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`Phase 1–3 的主体骨架已经起了，但当前实现还不能标记为 completed，更不能作为 RHX2 可收口的基础。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `P1-08 / P1-09 的“包来源单一真相门禁”只落了一半：verify 脚本存在，但 latest/SHA 语义与 manifest 注入链路都未闭合。`
  2. `P1-02 / F12 的 client-safe error meta 子路径违背了“零 runtime 依赖”承诺，当前实现实际上在运行时拉了 server registry。`
  3. `P3 的“6 worker 同一 facade error envelope”还没有完成：filesystem-core / orchestrator-auth 仍返回旧式 JSON 401，而且 route-level 测试覆盖明显不足。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/design/real-to-hero/RHX2-observability-and-auditability.md`
  - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md`
- **核查实现**：
  - `packages/nacp-core/src/{error-registry.ts,error-registry-client/**,observability/logger/**}`
  - `scripts/{verify-published-packages.mjs,generate-package-manifest.mjs}`
  - `workers/{orchestrator-core,agent-core,bash-core,context-core,filesystem-core,orchestrator-auth}/src/**`
  - `workers/orchestrator-core/migrations/006-error-and-audit-log.sql`
  - `docs/api/error-codes.md`
- **执行过的验证**：
  - `pnpm --filter @haimang/nacp-core build && pnpm --filter @haimang/nacp-core test`
  - `pnpm --filter @haimang/orchestrator-core-worker typecheck && pnpm --filter @haimang/orchestrator-core-worker build && pnpm --filter @haimang/orchestrator-core-worker test`
  - `pnpm --filter @haimang/agent-core-worker typecheck && pnpm --filter @haimang/agent-core-worker build && pnpm --filter @haimang/agent-core-worker test`
  - `pnpm --filter @haimang/bash-core-worker typecheck && pnpm --filter @haimang/bash-core-worker build && pnpm --filter @haimang/bash-core-worker test`
  - `pnpm --filter @haimang/context-core-worker typecheck && pnpm --filter @haimang/context-core-worker build && pnpm --filter @haimang/context-core-worker test`
  - `pnpm --filter @haimang/filesystem-core-worker typecheck && pnpm --filter @haimang/filesystem-core-worker build && pnpm --filter @haimang/filesystem-core-worker test`
  - `pnpm --filter @haimang/orchestrator-core-worker deploy:dry-run`
  - `pnpm --filter @haimang/bash-core-worker deploy:dry-run`
  - `pnpm --filter @haimang/context-core-worker deploy:dry-run`
  - `pnpm --filter @haimang/filesystem-core-worker deploy:dry-run`
- **复用 / 对照的既有审查**：
  - `none` — `本轮结论基于独立文件核查、命令验证与未提交 diff 审读得出。`

### 1.1 已确认的正面事实

- `@haimang/nacp-core` 已新增 `./logger` 与 `./error-codes-client` 两条 sub-path export，`006-error-and-audit-log.sql` 也已创建，且 3 个新增 `ORCHESTRATOR_CORE` service binding 的 worker dry-run 都能正确解析配置。`
- `docs/api/error-codes.md` 与 runtime registry 当前是一致的：本轮本地复核得到 `listErrorMetas().length = 78`，按测试正则解析文档行数也是 `78`，相关 nacp-core parity tests 全绿。`
- `respondWithFacadeError()` / `attachServerTimings()` helper 已落地，agent-core / bash-core / context-core / orchestrator-core 也已经开始切换到统一 helper。`

### 1.2 已确认的负面事实

- `verify-published-packages.mjs` 当前只做“workspace version 是否存在于 registry versions”检查，没有落实 design / action-plan 要求的 latest equality、SHA256 对账与完整 manifest snippet 语义。`
- `generate-package-manifest.mjs` 虽已存在，但 6 个 worker 的 `wrangler.jsonc` 里都还没有 `__NANO_PACKAGE_MANIFEST__` 的 build-time define / 注入链路。`
- `packages/nacp-core/src/error-registry-client/data.ts` 运行时 import 了 `../error-registry.js`，与 F12 / P1-02 明写的“零 runtime 依赖、静态 data table”相冲突。`
- `filesystem-core` 与 `orchestrator-auth` 仍然返回旧式 `{ error, message, worker }` JSON 401；worker tests 里也没有 route-level `respondWithFacadeError` / `Server-Timing` 覆盖命中。`

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 逐项核对 design、action-plan、脚本、worker 源码与 migration 文件。 |
| 本地命令 / 测试 | `yes` | 运行了 nacp-core 与 5 个相关 worker 的 build / typecheck / test，并对 4 个改过 wrangler 的 worker 跑了 deploy:dry-run。 |
| schema / contract 反向校验 | `yes` | 复核了 `docs/api/error-codes.md` ↔ `listErrorMetas()` 的实际数量与 parity test 结果。 |
| live / deploy / preview 证据 | `partial` | 本轮只做了 `deploy:dry-run`，没有执行 preview D1 apply / live preview health / registry publish 验证。 |
| 与上游 design / QNA 对账 | `yes` | 所有 finding 都直接对照 RHX2 design / action-plan 原文的 F12 / F14 / F15 / P1-08 / P1-09 / P3 条目。 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | P1-08 包发布门禁只实现了“版本存在”检查，未达到 F14 的单一真相门禁 | `high` | `delivery-gap` | `yes` | 把 latest equality / SHA / manifest snippet 语义补齐，或下调 design/action-plan 口径 |
| R2 | P1-09 `__NANO_PACKAGE_MANIFEST__` 注入链路完全未接 | `high` | `delivery-gap` | `yes` | 在 6 个 worker build / wrangler 配置里真正接上 manifest 生成与 define 注入 |
| R3 | `error-codes-client` 违背“零 runtime 依赖”承诺 | `high` | `platform-fitness` | `yes` | 改成 build-time 生成的静态表，并补齐 bundle-size / browser fixture 证明 |
| R4 | Phase 3 的 facade envelope rollout 与 route-level 测试仍然是 partial | `high` | `delivery-gap` | `yes` | 补 filesystem-core / orchestrator-auth 收口，并按计划补 worker-route 级测试 |

### R1. P1-08 包发布门禁只实现了“版本存在”检查，未达到 F14 的单一真相门禁

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/design/real-to-hero/RHX2-observability-and-auditability.md:1041-1076`
  - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md:447-451,463-467`
  - `scripts/verify-published-packages.mjs:112-156`
- **为什么重要**：
  - F14 / P1-08 的核心，不是“包在 registry 上存在过”，而是要回答 **deploy 到 worker bundle 里的到底是不是当前应当被信任的那一版**。
  - 现在的脚本只验证 `workspace version ∈ registry versions`，并不会因为 `workspace version != latest`、`dist SHA256 不一致`、或 manifest 缺少关键字段而 fail。这样 owner 想解决的“包来源真相模糊”问题并没有真正被封死。
- **审查判断**：
  - 当前脚本是 **门禁骨架已落，但语义还没达到 design / action-plan 明写标准**。
  - 尤其脚本注释自己也承认 SHA 比对只是 soft output / future strict mode，这与 F14 的 closure 口径不一致。
- **建议修法**：
  - 至少把以下三项补成硬校验，或同步下调文档口径：
    1. workspace version 必须与 registry latest 对齐，而不是“只要存在于历史 versions 就算过”；
    2. strict mode 下对 tarball / dist 做 SHA256 对账；
    3. 输出可直接供 F14-c / F15 消费的 manifest 数据，而不是仅写一个简化版中间产物。

### R2. P1-09 `__NANO_PACKAGE_MANIFEST__` 注入链路完全未接

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/design/real-to-hero/RHX2-observability-and-auditability.md:1052-1076,1078-1095`
  - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md:448-451`
  - `scripts/generate-package-manifest.mjs:1-95`
  - `workers/agent-core/wrangler.jsonc:1-127`
  - `workers/orchestrator-core/wrangler.jsonc:1-118`
  - `workers/orchestrator-auth/wrangler.jsonc:1-79`
  - `workers/bash-core/wrangler.jsonc:1-85`
  - `workers/context-core/wrangler.jsonc:1-61`
  - `workers/filesystem-core/wrangler.jsonc:1-75`
- **为什么重要**：
  - F15 `/debug/packages` 的 `deployed` 段依赖 `__NANO_PACKAGE_MANIFEST__` 常量，这是 design v0.5 新增的关键 owner-facing 真相源。
  - 现在只有 `generate-package-manifest.mjs` 脚本本身存在，但 6 个 worker 的构建链路都没有任何 `define` / build hook / env-file 注入配置，这意味着 Phase 1 的 P1-09 事实上还是 missing。
- **审查判断**：
  - 这不是“Phase 6 的 endpoint 还没做，所以先不接”。相反，**manifest 注入本身就是 Phase 1 前置工作项**，现在没接上，就等于把后面 `/debug/packages` 的 deployed truth 直接架空了。
- **建议修法**：
  - 在 6 个 worker 的 build / wrangler 配置里统一接上 `generate-package-manifest.mjs`，把 manifest 通过 `--define` 或等价方式 inline 进 bundle。
  - 至少补 1 个 runtime 级测试，验证 worker 内能真正读取到 `__NANO_PACKAGE_MANIFEST__`，而不只是脚本能在命令行吐 JSON。

### R3. `error-codes-client` 违背“零 runtime 依赖”承诺

- **严重级别**：`high`
- **类型**：`platform-fitness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/design/real-to-hero/RHX2-observability-and-auditability.md:973-1008,1131`
  - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md:438-440,452-460`
  - `packages/nacp-core/src/error-registry-client/data.ts:11-20,76-92`
  - `packages/nacp-core/dist/error-registry-client/data.js:11-18,69-84`
- **为什么重要**：
  - F12 / P1-02 明写的是 **“纯 TypeScript / 零 runtime 依赖 / 静态 data table”**。这是为了保证 browser / 微信小程序只消费 client-safe 元数据，不把 server registry 逻辑和依赖树一并带进去。
  - 现在 `data.ts` 在运行时 import `../error-registry.js`，编译产物里也保留了这个 import。也就是说，它并不是“静态表”，而是“客户端子路径在模块初始化时去跑 server registry 派生逻辑”。这与设计承诺是直接冲突的。
- **审查判断**：
  - 当前实现虽然通过了 parity tests，但**通过的是“内容一致性”**，没有满足“runtime-free / static table / bundle-size guard”这条更关键的交付标准。
  - 再加上 action-plan 承诺的微型 vite/esbuild fixture 与 `< 5 KB` 验证也没有落地，所以这条路径现在只能判 `partial`，不能判 `done`。
- **建议修法**：
  - 把 client meta 变成真正的 build-time 生成结果：要么在 `data.ts` 里写入纯字面量表，要么由脚本生成静态模块；不要在运行时 import server registry。
  - 按 action-plan 补一个最小 browser bundling / tree-shake fixture，把“零 runtime 依赖 + 体积约束”从口头承诺变成 CI 事实。

### R4. Phase 3 的 facade envelope rollout 与 route-level 测试仍然是 partial

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md:113-116`
  - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md:495-510`
  - `docs/design/real-to-hero/RHX2-observability-and-auditability.md:1105-1125`
  - `workers/filesystem-core/src/index.ts:33-56`
  - `workers/orchestrator-auth/src/public-surface.ts:27-44`
  - `workers/agent-core/test/smoke.test.ts:138-149`
- **为什么重要**：
  - Phase 3 的目标不是“写出一个 `respondWithFacadeError()` helper”，而是让 **6 worker HTTP error response 只剩一种 envelope**，并给 orchestrator-core 的 facade route 加上可证明的 `Server-Timing` 注入。
  - 现在 agent-core / bash-core / context-core / orchestrator-core 已开始切换，但 filesystem-core 与 orchestrator-auth 仍然返回旧式 `{ error, message, worker }` JSON 401，说明 rollout 还是 partial。
  - 同时，worker test 里几乎没有 route-level `respondWithFacadeError` / `Server-Timing` 覆盖；本轮只看到 `agent-core` 新增了一个 smoke 断言，而 action-plan / design 要求的是各 worker route 级 case 与 orchestrator-core sample coverage。
- **审查判断**：
  - 当前不能宣称“6 worker 错误响应同 envelope”已经成立。
  - 当前也不能宣称 `Server-Timing` 的 route integration 已被充分验证；helper unit test 过了，不等于 facade 路由面真的收口。
- **建议修法**：
  - 把 `filesystem-core` 的 `bindingScopeForbidden()` 与 `orchestrator-auth` 的 `handlePublicRequest()` 改为统一使用 `respondWithFacadeError()`，或明确在 design / action-plan 里把它们降出 Phase 3 范围。
  - 补 route-level 测试，至少覆盖：
    1. filesystem-core / orchestrator-auth 的 401 binding-scope envelope；
    2. orchestrator-core facade 错误路径的 `Server-Timing` 头存在；
    3. worker-route 层面的 `x-trace-uuid` 与 FacadeErrorEnvelope 形状，而不是只测 helper 单元。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | P1-01 `nacp-core/logger` 子路径导出 | `done` | sub-path export、logger helper、unit tests 已落地。 |
| S2 | P1-02 `nacp-core/error-codes-client` 子路径导出 | `partial` | 子路径已存在，但当前不是“零 runtime 依赖”的静态 data table。 |
| S3 | P1-03~P1-06 migration 006 + 3 个新增 service binding | `done` | migration 文件存在；bash/context/filesystem 的 wrangler 改动通过 dry-run。 |
| S4 | P1-07 版本 bump / publish gate 准备 | `partial` | `jwt-shared` 已 bump 到 `0.1.0`，`nacp-core` 已 bump，但本轮没有看到 publish 证据，且 `nacp-core` 实际版本已到 `1.6.0`，与 plan 中 `1.5.0` 文字未同步。 |
| S5 | P1-08 `verify-published-packages.mjs` | `partial` | 脚本已存在并挂到 6 worker `predeploy:preview`，但 latest equality / SHA / manifest snippet 语义未落满。 |
| S6 | P1-09 `__NANO_PACKAGE_MANIFEST__` build-time 注入 | `missing` | 脚本存在，但 6 worker 的 wrangler/build 链路没有注入配置。 |
| S7 | P2-01 `resolveErrorMeta()` / `listErrorMetas()` | `done` | 统一 registry API 已落地，相关 tests 通过。 |
| S8 | P2-02 `docs/api/error-codes.md` | `done` | 文档已生成，且本轮复核得到文档行数 = registry 数量 = 78。 |
| S9 | P2-03 docs ↔ registry ↔ client meta 一致性测试 | `partial` | parity tests 已落地且通过，但“runtime-free / bundle-size”这条交付标准仍未证明。 |
| S10 | P3-01 `respondWithFacadeError()` / `attachServerTimings()` helper | `done` | helper 已落地，unit tests 存在且通过。 |
| S11 | P3-02 / P3-03 6 worker error envelope rollout | `partial` | agent/bash/context/orchestrator-core 已开始切；filesystem-core / orchestrator-auth 仍是旧 JSON 401。 |
| S12 | P3-04 / P3-05 `Server-Timing` 路由集成 | `partial` | helper 与 orchestrator-core wrapper 已落，但 route-level sample / test proof 仍不足。 |

### 3.1 对齐结论

- **done**: `6`
- **partial**: `5`
- **missing**: `1`
- **stale**: `0`
- **out-of-scope-by-design**: `0`

这更像是：**Phase 1–3 的基础设施骨架和一部分 helper 已完成，但关键 gate、零依赖边界、以及 6-worker façade 收口都还没真正闭合。**

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | Phase 4 的 6 worker 结构化日志全量切换 | `遵守` | 本轮不以“6 worker 裸 console 清零”为 blocker；那是 P4 的范围。 |
| O2 | Phase 5 的 `system.error` / `audit.record` / alerts 接电 | `遵守` | 本轮不因为 `audit.ts` / `alerts.ts` / `system-error.ts` 缺失而报错；它们按计划属于后续 phase。 |
| O3 | Phase 6 的 `/debug/packages` endpoint | `误报风险` | `/debug/packages` 本身不在 P1-3，但它依赖的 P1-09 manifest 注入在本轮范围内，因此**前置缺口**仍应作为 blocker 报告。 |
| O4 | Phase 8 的 web / 微信小程序消费改造 | `遵守` | 本轮不因 client 尚未切 `getErrorMeta()` / `system.error` 而报错；这里只审 P1-3 基础设施。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`Phase 1–3 主体已起，但当前仍是 changes-requested；不能按 completed 处理。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. `把 P1-08 / P1-09 的包来源门禁补到 design / action-plan 要求的强度：latest equality、manifest 输出、6 worker build-time 注入链路必须闭合。`
  2. `把 error-codes-client 改成真正的静态、零 runtime 依赖实现，并补齐 promised browser/bundle-size 证明。`
  3. `补完 filesystem-core / orchestrator-auth 的 facade envelope 收口，并增加 Phase 3 的 route-level 测试与 Server-Timing sample 证明。`
- **可以后续跟进的 non-blocking follow-up**：
  1. `同步 action-plan 中 nacp-core 1.5.0 与当前 package.json 1.6.0 的文字漂移，避免后续 release / review 再次混淆。`
  2. `把 preview D1 apply / registry HTTP 200 / preview health 6/6 的运行证据在后续 closure 中显式归档，本轮只证明了本地 build/test + deploy:dry-run。`
- **建议的二次审查方式**：`same reviewer rereview`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应（预留）

> 由实现者按 `docs/templates/code-review-respond.md` append。

### 2026-04-30 实现者回应（GPT）

- **状态**：`Phase 1–3 代码修复已完成，申请 same-reviewer rereview。`
- **本轮直接修复**：
  1. **P1-08 / 包来源门禁**：`scripts/verify-published-packages.mjs` 现在不仅要求 workspace version 存在于 registry，还要求它 **等于 registry latest**；本轮已实际执行脚本，3 个 published 包都返回通过，且 `.nano-agent/package-manifest.json` 已更新为 registry truth。
  2. **P1-09 / manifest 注入**：6 个 worker 都新增 `prepare:package-manifest` 生命周期，生成 `src/generated/package-manifest.ts` 并由入口模块显式 import；同时补了通用 `predeploy` 与 `deploy:production`，不再只有 preview 路径经过门禁。
  3. **P1-02 / F12 runtime-free**：`packages/nacp-core/src/error-registry-client/data.ts` 已改为消费静态生成表 `generated-data.ts`，移除了对 `../error-registry.js` 的 runtime import；新增 `runtime-free.test.ts` 断言 source/dist 都不再引用 server registry。
  4. **P3 facade 收口**：`bash-core`、`context-core`、`filesystem-core`、`orchestrator-auth` 的 `binding-scope-forbidden` / invalid-json / invalid-shape 路径已改为 `respondWithFacadeError(...)`；相关 smoke/public-surface tests 已同步改为断言 FacadeErrorEnvelope。
  5. **P3 route-level proof**：新增/加强了 6 worker 的 manifest smoke 断言，以及 orchestrator-core 的 `Server-Timing` smoke 断言。
  6. **文档漂移**：RHX2 design / action-plan 中当前态 `nacp-core` 版本口径已同步从 `1.5.0` 调整为 `1.6.0`（保留 v0.4 历史记录不改）。

- **本轮验证证据**：
  - `pnpm install`
  - `pnpm --filter @haimang/nacp-core typecheck build test`
  - `pnpm --filter @haimang/{bash-core-worker,context-core-worker,filesystem-core-worker,orchestrator-auth-worker,agent-core-worker,orchestrator-core-worker} typecheck/build/test`
  - `node scripts/verify-published-packages.mjs`
  - `pnpm --filter @haimang/{agent-core-worker,bash-core-worker,context-core-worker,filesystem-core-worker,orchestrator-auth-worker,orchestrator-core-worker} deploy:dry-run`

- **仍保留为 follow-up、未在本轮扩张 scope 的项**：
  1. `Server-Timing` 的 `auth` / `agent` 分段采集仍未展开到全部 orchestrator-core 路由，当前先保留 `total` 段和 route-level proof；如果 review 认为 Phase 3 必须三段齐全，再单独补这一层 instrumentation。
  2. `Logger.audit()` 仍保持 Phase 5 范围，不在本轮 P1–P3 代码修复内。

- **申请**：请按原审查项重新核对；本轮目标是把此前的 4 个 blocker 全部关掉，让 RHX2 Phase 1–3 可以进入后续轮次开发。
