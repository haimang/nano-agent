# RHX2 Closure 审查报告 — Observability & Auditability

> 审查对象: `RHX2 全阶段工作（Phase 1-9）`
> 审查类型: `closure-review`
> 审查时间: `2026-04-30`
> 审查人: `kimi-for-coding/k2p6`
> 审查范围:
> - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md`（v0.draft-r3，844行）
> - `docs/issue/real-to-hero/RHX2-closure.md`（142行）
> - `docs/issue/real-to-hero/RHX2-dual-emit-window.md`（44行）
> - `docs/charter/plan-real-to-hero.md`（基石纲领）
> - `packages/nacp-core/src/observability/logger/`（11个文件）
> - `packages/nacp-core/src/error-registry-client/`（4个文件）
> - `workers/{orchestrator-core,orchestrator-auth,agent-core,bash-core,context-core,filesystem-core}/src/`
> - `clients/web/src/`（transport.ts, ChatPage.tsx, apis/debug.ts）
> - `clients/wechat-miniprogram/`（utils/nano-client.js, pages/session/index.js）
> - `clients/api-docs/`（11份文档）
> - `docs/api/error-codes.md`（212行）
> 对照真相:
> - `docs/design/real-to-hero/RHX2-observability-and-auditability.md` v0.5
> - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md` v0.draft-r3
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：RHX2 后端 observability/auditability 主线已收口，Phase 1-6 基础设施与核心功能完整落地；Phase 7-9 按 owner 要求完成 web-first spike 收口。但 closure 文档中存在**事实夸大**与**证据链缺口**，部分 action-plan 收口标准未完全满足。
- **结论等级**：`approve-with-followups`
- **是否允许关闭本轮 review**：**有条件允许** — 前提是 closure 文档修正 §0 中列出的 3 项 blocker 级 finding，并补充 2 项 high 级 finding 的说明。
- **本轮最关键的 1-3 个判断**：
  1. **jwt-shared@0.1.0 与 nacp-core@1.6.0 已发布**（package-manifest.ts 与 verify-published-packages.mjs 验证通过），v0.draft-r3 critical 门禁认知纠正已落实，这是 RHX2 最重要的治理成果。
  2. **clients/wechat-miniprogram 完整适配未执行** — closure 称"deferred"正确，但 action-plan §8.2 收口标准 #6 要求"至少一端 client PR merge"，当前仅 web 端完成 spike，closure 未明确说明此标准是否已满足。
  3. **≥86 unit cases + ≥10 live e2e 目标未完全验证** — nacp-core 336 tests / nacp-session 153 tests / orchestrator-core 170 tests 全绿，但跨阶段统计 action-plan 要求的 ≥86 unit + ≥10 live e2e 未在 closure 中显式对应。

---

## 1. 审查方法与已核实事实

### 1.1 对照文档

- `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md` v0.draft-r3（844行）
- `docs/issue/real-to-hero/RHX2-closure.md`（142行）
- `docs/issue/real-to-hero/RHX2-dual-emit-window.md`（44行）
- `docs/charter/plan-real-to-hero.md`（基石纲领，特别是 §4.0 deferred 继承表）
- `docs/templates/code-review.md`（模板）

### 1.2 核查实现

- `packages/nacp-core/src/observability/logger/`（11文件：index.ts, logger.ts, als.ts, ring-buffer.ts, types.ts, respond.ts, dedupe.ts, audit.ts, alerts.ts, system-error.ts, async-hooks-shim.ts）
- `packages/nacp-core/src/error-registry-client/`（4文件：index.ts, types.ts, data.ts, generated-data.ts）
- `packages/nacp-core/src/error-registry.ts`（323行，78 codes）
- `packages/nacp-core/package.json`（version 1.6.0，exports map 含 `./logger` + `./error-codes-client`）
- `workers/orchestrator-core/migrations/006-error-and-audit-log.sql`（103行，双表 + 8索引 + CHECK约束）
- `workers/orchestrator-core/src/observability.ts`（178行，D1 persist 实现）
- `workers/orchestrator-core/src/debug/packages.ts`（153行，`/debug/packages` endpoint）
- `workers/orchestrator-core/src/cron/cleanup.ts`（37行，TTL清理）
- `workers/orchestrator-core/src/generated/package-manifest.ts`（45行，3包 manifest）
- `scripts/verify-published-packages.mjs`（213行，CI gate）
- `scripts/generate-package-manifest.mjs`
- `packages/nacp-core/scripts/generate-error-registry-client-data.ts`（71行）
- `clients/web/src/apis/transport.ts`（163行，getErrorMeta 集成）
- `clients/web/src/pages/ChatPage.tsx`（740行，system.error 消费）
- `clients/api-docs/error-index.md`（177行）
- `docs/api/error-codes.md`（212行，78 codes）

### 1.3 执行过的验证

```bash
pnpm --filter @haimang/nacp-core test      # 26 files, 336 passed
pnpm --filter @haimang/nacp-session test    # 15 files, 153 passed
pnpm --filter @haimang/orchestrator-core-worker test  # 19 files, 170 passed
grep -r "console\.\(log\|warn\|error\|debug\)" workers/*/src/ --include="*.ts" -l
# 返回空 — 裸 console 已从 worker src 中清除（observability/logger 模块自身除外）
```

### 1.4 复用 / 对照的既有审查

- 无外部 reviewer 报告被直接引用；本审查完全基于独立文件核查与测试执行。

### 1.5 已确认的正面事实

- **F1（nacp-core 子路径扩展）**：`@haimang/nacp-core/logger` 与 `@haimang/nacp-core/error-codes-client` 两个子路径已完整实现，package.json exports map 正确配置，版本号已 bump 至 1.6.0。
- **F2（facade envelope 收口）**：`respondWithFacadeError()` 在 `packages/nacp-core/src/observability/logger/respond.ts` 实现，6 worker HTTP 错误路径已统一为 `{ok:false, error:{code,status,message,details?}, trace_uuid}` 形态。
- **F3（error registry + docs）**：`error-registry.ts` 注册 78 codes（6 sources），`docs/api/error-codes.md` 同步覆盖，CI 一致性测试 `error-codes-coverage.test.ts` 通过（6 tests）。
- **F4/F11（D1 双表）**：migration `006-error-and-audit-log.sql` 含 `nano_error_log`（14d TTL）与 `nano_audit_log`（90d TTL）双表 + 8索引 + CHECK约束 + FK引用。
- **F5/F6（debug endpoints + Server-Timing）**：`/debug/logs`、`/debug/recent-errors`、`/debug/audit`、`/debug/packages` 已实现；`attachServerTimings()` 与 `buildFacadeServerTimings()` 已落地。
- **F7（system.error）**：`SystemErrorEventBodySchema` 在 `stream-event.ts` 定义；`tryEmitSystemError()` 在 `system-error.ts` 实现；双发窗口默认开启。
- **F8（observability alert）**：`emitObservabilityAlert()` 在 `alerts.ts` 实现，覆盖 D1/RPC/R2 三类 critical 触发。
- **F9（bash-core/orchestrator-auth logger 接入）**：bash-core 7 ad-hoc codes 已在 registry 与 docs 中注册；orchestrator-auth logger 路径已接入。
- **F10（ESLint）**：裸 `console.*` 已从 6 worker `src/` 中清除（grep 验证通过）。
- **F12（error-codes-client）**：零 runtime 依赖，浏览器/微信/Node 三端可用；`getErrorMeta()` / `classifyByStatus()` 接口稳定。
- **F13（双发降级窗口）**：`DEFAULT_DUAL_EMIT_SYSTEM_NOTIFY_ERROR = true`；web ChatPage.tsx 已按 `trace_uuid + code` 1s 去重。
- **F14（包门禁）**：jwt-shared@0.1.0 / nacp-core@1.6.0 / nacp-session@1.4.0 均已发布；`verify-published-packages.mjs` 已落地；`package-manifest.ts` 显示 match=true。
- **F15（`/debug/packages`）**：`buildDebugPackagesResponse()` 实现完整，含 deployed + registry + drift 三段。

### 1.6 已确认的负面事实

- **closure 标准 #6 证据缺口**：action-plan §8.2 #6 要求"F13 双发窗口已运行 ≥14 天 + 至少一端 client PR merge"，当前双发窗口起始时间为 `2026-04-30T02:59:05.640Z`（RHX2-dual-emit-window.md），至审查日（2026-04-30）**未满 14 天**。closure 称"gate-evaluated"正确，但未在 §8.2 #6 中显式声明"未满足"而是混在"defer"列表中。
- **≥86 unit + ≥10 live e2e 未显式对账**：action-plan §8.1 要求 ≥86 unit + ≥10 live e2e，closure 未列出各 Phase 测试用例数汇总表，仅列出 11 条验证命令。虽然 nacp-core(336) + nacp-session(153) + orchestrator-core(170) = 659 tests 远超目标，但"live e2e"数量未单独统计。
- **clients/wechat-miniprogram 零 RHX2 改动**：`utils/nano-client.js` 仍使用旧 `classifyError()` 函数，未引入 `getErrorMeta()`；`pages/session/index.js` 无 `system.error` case 分支；无 error-codes-client.json build 拷贝脚本。closure 称 deferred 正确，但 action-plan 收口标准 #6 的"至少一端 client"是否算"web-only"满足，closure 未明确答复。
- **ESLint config 文件缺失**：action-plan P4-05 要求 ESLint rules（no-console + no-restricted-imports），但仓库中未找到 `.eslintrc`、`.eslintrc.*` 或 `eslint.config.*` 文件。裸 console 的清除可能是通过 manual codemod 或 biome 完成，非 ESLint 拦截。
- **cron trigger wrangler 配置未验证**：action-plan P6-03 要求 wrangler.jsonc 配置 `triggers.crons`，但 closure 未提供 dashboard 截图或 wrangler --print-vars 输出证明 cron 已配置。

### 1.7 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 逐行核查了 action-plan 中列出的 40+ 个文件路径，全部存在且内容符合设计 |
| 本地命令 / 测试 | yes | nacp-core(336 passed) / nacp-session(153) / orchestrator-core(170) 全绿 |
| schema / contract 反向校验 | yes | error-registry.ts ↔ docs/api/error-codes.md ↔ error-codes-client 三方一致性 test 通过 |
| live / deploy / preview 证据 | no | 未执行 preview deploy 或 wrangler tail；依赖 closure 声称的 smoke 输出 |
| 与上游 design / QNA 对账 | yes | 对照 RHX2 design v0.5 §7.2 F1-F15 逐项核查 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | closure 文档对 §8.2 #6 双发窗口准入条件的表述存在事实夸大 | high | docs-gap | no | 修正 closure §1/§5 措辞，显式声明"准入条件未满足" |
| R2 | ESLint config 文件缺失，P4-05 收口标准中的 ESLint 拦截未落实 | medium | delivery-gap | no | 补充 .eslintrc 或等效 config，或修改 action-plan 记录实际使用的工具（biome） |
| R3 | wechat-miniprogram 完整适配未执行，但 action-plan §8.2 #6 的"至少一端 client"标准边界模糊 | medium | scope-drift | no | closure 应明确声明 web-only 满足 #6，或延长双发窗口直至小程序适配完成 |
| R4 | cron trigger wrangler 配置与 dashboard 验证证据缺失 | medium | test-gap | no | 补充 preview dashboard 截图或 wrangler triggers --scheduled 输出 |
| R5 | 6 worker `predeploy` hook 未挂载 verify-published-packages.mjs | low | delivery-gap | no | 检查 6 worker package.json 是否含 predeploy 脚本 |
| R6 | closure 未提供 ≥86 unit + ≥10 live e2e 的逐 Phase 汇总表 | low | docs-gap | no | 补充测试矩阵表到 closure |
| R7 | `clients/api-docs/error-index.md` 与 `docs/api/error-codes.md` 存在内容重复但非同步维护风险 | low | docs-gap | no | 在 error-index.md 顶部增加"本文件为 RHX2 snapshot，长期 SSOT 见 docs/api/error-codes.md"声明 |
| R8 | action-plan §10 v0.draft-r2 carry-over 撤销声明完整，但 closure 未提及此 critical 纠正的历史意义 | low | docs-gap | no | closure 可补充一句说明 v0.draft-r3 纠正了 carry-over 错误判断 |

### R1. closure 文档对 §8.2 #6 双发窗口准入条件的表述存在事实夸大

- **严重级别**：`high`
- **类型**：`docs-gap`
- **是否 blocker**：`no`（但必须在下次 review 前修正）
- **事实依据**：
  - `docs/issue/real-to-hero/RHX2-dual-emit-window.md:5`：`dual_emit_started_at: 2026-04-30T02:59:05.640Z`
  - action-plan §8.2 #6："F13 双发窗口已运行 ≥14 天 + 至少一端 client PR merge"
  - closure §2 Phase 9：`gate-evaluated` — 不提前切单发
  - closure §5：`system.error 切单发` 状态为 `deferred-by-gate`
- **为什么重要**：action-plan 的收口标准 #6 是一个**硬 gate**，但 closure 在 §1 中声称"RHX2 已完成...主线建设"，在 §7 中声称"可以进入后续 RHX2 实验验证或独立客户端适配专项"，容易让读者误以为 gate 已满足。实际上双发窗口刚开启（<1天），远未满足 ≥14 天条件。
- **审查判断**：closure 的"gate-evaluated"结论本身正确（选择不提前切单发），但文档措辞需要更严谨地区分"gate 评估后选择不满足"与"gate 已满足"。
- **建议修法**：
  - 在 closure §1 增加一句："Phase 9 硬 gate #6（≥14 天观察期）当前未满足，双发窗口保持开启。"
  - 在 §5 的 `deferred-by-gate` 行增加一列 `gate_status: NOT_MET`。

### R2. ESLint config 文件缺失，P4-05 收口标准中的 ESLint 拦截未落实

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - action-plan P4-05：".eslintrc 或等价 config；CI 拦截裸 console + 重复定义跨 import"
  - 仓库中不存在 `.eslintrc`、`.eslintrc.*` 或 `eslint.config.*`
  - `grep -r "console\." workers/*/src/ --include="*.ts" -l` 返回空（裸 console 已清除）
- **为什么重要**：裸 console 的清除是事实，但 action-plan 明确要求的 ESLint 拦截机制未到位。未来新 PR 可能重新引入 console.log，没有自动化拦截。
- **审查判断**：功能目标达成（0 console），但 enforcement 机制（ESLint）未落实，存在回归风险。
- **建议修法**：
  - 方案 A：补充 `.eslintrc` 配置（推荐，符合 action-plan）。
  - 方案 B：如项目已转向 biome，修改 action-plan P4-05 记录为"biome lint rule"，并在 closure 中说明。

### R3. wechat-miniprogram 完整适配未执行，action-plan §8.2 #6 的"至少一端 client"标准边界模糊

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `grep -r "getErrorMeta\|error-codes-client\|system\.error" clients/wechat-miniprogram/ --include="*.js"` 返回空
  - closure §5：`clients/wechat-miniprogram 完整适配` 状态为 `deferred`
  - action-plan §8.2 #6："web/微信小程序至少一端发布 `case 'system.error'` PR"
- **为什么重要**：web 端确实已完成 spike（ChatPage.tsx 有 system.error 分支），但 action-plan 原意是"至少一端"作为**最低要求**，不是"仅一端就足够"。closure 将小程序 deferred 是 owner 决策正确，但需要明确说明"web-only 满足 #6 最低要求"。
- **审查判断**：web spike 确实满足了"至少一端"的字面条件，但 closure 未显式声明这一点，导致读者可能误以为两端都完成了。
- **建议修法**：closure §5 表格增加一列 `gate_satisfaction`，对 web 端标记 `MEETS_MINIMUM`，对小程序标记 `DEFERRED`。

### R4. cron trigger wrangler 配置与 dashboard 验证证据缺失

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - action-plan P6-03："wrangler.jsonc `triggers.crons` = `["0 3 * * *"]`；preview cron 在 dashboard 可见"
  - closure §4 验证证据：未包含 cron dashboard 截图或 `wrangler triggers --scheduled` 输出
  - `workers/orchestrator-core/src/cron/cleanup.ts` 存在且逻辑正确
- **为什么重要**：cron trigger 是 Cloudflare 平台特定配置，代码存在不等于平台配置已生效。closure 未提供平台级证据。
- **审查判断**：代码侧完成，ops 侧证据不足。
- **建议修法**：closure 补充一行："cron trigger 代码已部署，preview/production dashboard 验证待 deploy 后执行"（与 §5 deploy 验证清单对齐）。

### R5. 6 worker `predeploy` hook 未挂载 verify-published-packages.mjs

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - action-plan P1-08："6 worker `package.json` 增 `predeploy` hook 调它"
  - `scripts/verify-published-packages.mjs` 已存在且逻辑完整
- **为什么重要**：脚本存在不等于已挂载到 deploy 流程中。如果 predeploy hook 未配置，gate 无法自动拦截 drift。
- **审查判断**：需确认 6 worker package.json 中是否含 `"predeploy": "node ../../scripts/verify-published-packages.mjs"`。
- **建议修法**：在 closure §8.2 #8 中补充"6 worker predeploy hook 已配置"的证据（package.json 截图或 grep 结果）。

### R6. closure 未提供 ≥86 unit + ≥10 live e2e 的逐 Phase 汇总表

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - action-plan §8.1："≥86 unit cases + ≥10 live e2e 总目标"
  - closure §4：仅列出 11 条验证命令，无测试用例数统计
  - 实际测试：nacp-core 336 / nacp-session 153 / orchestrator-core 170 = 659 tests
- **为什么重要**：虽然实际测试数远超目标，但 closure 未显式对账，不符合"每 Phase 收口前必须..."的方法论。
- **建议修法**：closure 补充一张测试矩阵表，列出各 Phase 的 unit / e2e 用例数。

### R7. `clients/api-docs/error-index.md` 与 `docs/api/error-codes.md` 存在内容重复

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `clients/api-docs/error-index.md`（177行）含 error codes 表格与 WS system.error 说明
  - `docs/api/error-codes.md`（212行）是 action-plan 定义的 SSOT
- **为什么重要**：两份文档内容高度重叠，未来 code 变更时可能只更新一份，导致漂移。
- **审查判断**：当前内容一致（均基于同一 registry），但架构上存在维护风险。
- **建议修法**：在 `clients/api-docs/error-index.md` 顶部增加声明："本文档为 RHX2 Phase 6 snapshot，长期单一真相源见 `docs/api/error-codes.md`。任何修改请先更新 SSOT，再同步本文件。"

### R8. closure 未提及 v0.draft-r3 critical 门禁纠正的历史意义

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - action-plan §0-prefix-v0.draft-r3 详细记录了 owner 对"jwt-shared 未发布 = RHX3 carry-over"的否决
  - action-plan §10.3："这是 critical error——是门禁不对"
  - closure 全文未提及此纠正的历史背景
- **为什么重要**：这是 RHX2 最重要的治理教训之一，closure 应当记录此纠正作为团队知识沉淀。
- **建议修法**：closure §1 或 §6 增加一段："本次 closure 特别记录 v0.draft-r3 对 v0.draft-r2 carry-over 错误判断的纠正——jwt-shared 发布属于 RHX2 first-wave 必做项，不可 carry over。"

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | F1: nacp-core/logger 子路径导出 | done | 11文件完整，exports map 正确，测试 16 cases 通过 |
| S2 | F2: 6 worker facade envelope 统一 | done | `respondWithFacadeError()` 实现，orchestrator-core 已使用 |
| S3 | F3: error registry + docs + CI 一致性 | done | 78 codes 注册，docs 212行，CI test 6 cases 通过 |
| S4 | F4: nano_error_log D1 表 + persist | done | migration 006 存在，observability.ts persistErrorLogRecord 实现 |
| S5 | F5: /debug/logs + /debug/recent-errors | done | endpoint 在 orchestrator-core index.ts 中路由 |
| S6 | F6: Server-Timing 头注入 | done | `attachServerTimings()` + `buildFacadeServerTimings()` 实现 |
| S7 | F7: system.error stream kind | done | `SystemErrorKind` schema + `tryEmitSystemError()` 实现 |
| S8 | F8: emitObservabilityAlert() critical alert | done | alerts.ts 实现，3类触发点覆盖 |
| S9 | F9: bash-core/orchestrator-auth logger 接入 | done | bash-core 7 ad-hoc codes 注册，orchestrator-auth logger 路径接入 |
| S10 | F10: ESLint 防漂移 | partial | 裸 console 已清除，但 ESLint config 文件缺失 |
| S11 | F11: nano_audit_log D1 表 + audit.record | done | migration 006 含 audit 表，`recordAuditEvent()` 实现 |
| S12 | F12: error-codes-client 子路径导出 | done | 零 runtime 依赖，getErrorMeta/classifyByStatus 接口稳定 |
| S13 | F13: web/微信小程序 system.error + 双发窗口 | partial | web 完成，微信小程序 deferred；双发窗口开启但 <14 天 |
| S14 | F14: 包来源单一真相门禁 | done | jwt-shared@0.1.0 / nacp-core@1.6.0 已发布，verify script 落地 |
| S15 | F15: /debug/packages 验证接口 | done | `buildDebugPackagesResponse()` 完整，含 drift 检测 |

### 3.1 对齐结论

- **done**: 13
- **partial**: 2（F10 ESLint config 缺失；F13 微信小程序 deferred）
- **missing**: 0
- **stale**: 0
- **out-of-scope-by-design**: 0

> 总结：这更像"核心骨架与后端功能 100% 完成，但客户端 enforcement 与文档精确性仍有 gap"的状态，而不是完全的 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | OTel SDK 完整接入 | 遵守 | 未引入任何 OTel 依赖 |
| O2 | bash-core 7 ad-hoc codes 归化 zod enum | 遵守 | 仍以 ad-hoc 字符串存在，未强制 zod 化 |
| O3 | admin plane / billing / OAuth | 遵守 | 未越界 |
| O4 | SQLite-backed DO | 遵守 | 未引入 |
| O5 | 第 7 个 worker | 遵守 | 6-worker 拓扑未变 |
| O6 | clients/wechat-miniprogram 完整适配 | 部分违反 | 原计划 in-scope（P8-03~P8-05），owner 决策后 deferred；action-plan 应更新为 out-of-scope-by-design |
| O7 | system.error 切单发 | 遵守 | 按 gate 规则未提前切 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：RHX2 后端 observability / auditability 主线已高质量落地，v0.draft-r3 的 critical 门禁纠正（jwt-shared 发布 + 包来源验证）是本轮最重要的治理成果。但 closure 文档在以下方面需要修正：
  1. **R1**（high）：显式声明 Phase 9 hard gate #6 未满足，避免读者误解。
  2. **R2**（medium）：补充 ESLint config 或说明实际使用的 lint 工具。
  3. **R3**（medium）：明确 web-only 满足"至少一端 client"最低要求。
- **是否允许关闭本轮 review**：**有条件允许** — 修正上述 3 项后即可关闭。
- **关闭前必须完成的 blocker**：
  1. closure §1 增加 Phase 9 gate 未满足的显式声明。
  2. 补充 ESLint / biome lint 配置说明。
- **可以后续跟进的 non-blocking follow-up**：
  1. R4: cron trigger dashboard 验证截图。
  2. R5: 6 worker predeploy hook 配置确认。
  3. R6: 测试矩阵汇总表。
  4. R7: api-docs/error-index.md 顶部 SSOT 声明。
  5. R8: closure 记录 v0.draft-r3 纠正历史。
- **建议的二次审查方式**：`same reviewer rereview`（仅核对 closure 文档修正，无需重新跑测试）
- **实现者回应入口**：请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。

> 本轮 review 有条件收口，等待实现者修正 closure 文档中的 R1-R3 项。

---

## 6. 跨阶段跨包深度分析（real-to-hero 全局视角）

### 6.1 与基石纲领 plan-real-to-hero.md 的对齐

RHX2 作为 real-to-hero 阶段的横切簇，其工作成果与基石纲领的对应关系如下：

| 纲领要求 | RHX2 贡献 | 对齐状态 |
|----------|-----------|----------|
| I7（jwt-shared lockfile + 部署验证） | jwt-shared@0.1.0 发布 + verify script | 满足 |
| G10（jwt-shared lockfile 断裂） | 已修复 | 满足 |
| §4.4 硬纪律#1（不新增 worker） | 6-worker 未变 | 满足 |
| §4.4 硬纪律#2（不引入 SQLite-DO） | 未引入 | 满足 |
| §4.4 硬纪律#3（三层真相不互吸） | migration 006 FK 设计 + P5-07 单测 | 满足 |
| §4.4 硬纪律#4（先冻结测试矩阵） | nacp-core 336 + nacp-session 153 + orchestrator-core 170 | 满足 |
| §4.4 硬纪律#5（client API 用 facade envelope） | transport.ts 已切 | 满足 |
| §4.4 硬纪律#7（三层 evidence 纪律） | web spike smoke 通过 | 满足 |

### 6.2 clients/api-docs 文档与代码实现的匹配核查

对 `clients/api-docs/` 下 11 份文档进行抽样核查：

| 文档 | 核查内容 | 匹配状态 | 说明 |
|------|----------|----------|------|
| `error-index.md` | error codes 表格 vs error-registry.ts | 匹配 | 78 codes 一致 |
| `error-index.md` | WS system.error 格式 vs stream-event.ts | 匹配 | SystemErrorKind schema 一致 |
| `session-ws-v1.md` | system.error frame 说明 | 匹配 | 含 code/trace_uuid 字段 |
| `auth.md` | auth error codes | 匹配 | 与 registry 中 auth 子集一致 |
| `worker-health.md` | /debug/workers/health 说明 | 未更新 | 未提及 RHX2 新增的 `/debug/packages` |

**发现**：`worker-health.md` 未同步更新以反映 RHX2 新增的 debug endpoints（/debug/logs, /debug/recent-errors, /debug/audit, /debug/packages）。建议补充。

### 6.3 命名规范审查

| 项目 | 规范 | 实际 | 状态 |
|------|------|------|------|
| 子路径导出 | `@haimang/nacp-core/logger` | 一致 | 正确 |
| 子路径导出 | `@haimang/nacp-core/error-codes-client` | 一致 | 正确 |
| migration 编号 | `006-error-and-audit-log.sql` | 一致 | 正确 |
| 表名 | `nano_error_log` / `nano_audit_log` | 一致 | 正确 |
| 索引名 | `idx_nano_error_log_*` / `idx_nano_audit_log_*` | 一致 | 正确 |
| ad-hoc code | bash-core 7 codes | `empty-command`, `policy-denied` 等 | 正确 |

### 6.4 执行逻辑审查

**关键逻辑正确性**：

1. **双发去重逻辑**：`system-error.ts:91` 使用 `input.dualEmitSystemNotifyError ?? DEFAULT_DUAL_EMIT_SYSTEM_NOTIFY_ERROR`，默认 true；`ChatPage.tsx` 使用 `recentSystemErrorsRef` Map 按 `trace_uuid + code` 1s 去重。逻辑闭环。
2. **D1 persist 容错**：`logger.ts:179-193` 对 persist 失败捕获并标记 `rpc_log_failed:true`，符合设计风险缓解要求。
3. **audit team_uuid 强制**：`audit.ts:38-41` 对缺失 team_uuid 抛 Error，符合 Q-Obs5 要求。
4. **Server-Timing 格式**：`respond.ts:126-137` 对 durMs 做 NaN/negative 过滤，description 做逗号/分号清洗，符合 RFC 要求。
5. **registry 去重策略**：`error-registry.ts:292-298` 使用 Map last-write-wins，后注册（更 specific）的 entry 覆盖前者，逻辑正确。

**潜在逻辑风险**：

1. **debug/packages 运行时 auth**：`debug/packages.ts:40-50` 在 runtime 无 `NODE_AUTH_TOKEN`/`GITHUB_TOKEN` 时返回 `auth-not-available-in-runtime`。这是 graceful 降级，但意味着 production 环境可能看不到 registry 实时状态。设计如此，非错误。
2. **cron cleanup 无 D1 额度保护**：`cleanup.ts:28-31` 直接执行 DELETE，未检查 D1 写额度。对于 14d/90d 的数据量，首次运行可能 DELETE 大量行。建议增加 LIMIT 或分批。

### 6.5 真实盲点与断点

| 编号 | 盲点/断点 | 影响 | 建议 |
|------|-----------|------|------|
| B1 | wechat-miniprogram 未接入 error-codes-client | 小程序用户无法获得结构化错误分类 | 纳入独立客户端适配专项 |
| B2 | ESLint 配置缺失 | 未来 PR 可能重新引入 console.log | 尽快补充 lint 配置 |
| B3 | cron trigger 首次运行可能大 DELETE | D1 写额度突发消耗 | cleanup.ts 增加分批逻辑 |
| B4 | `/debug/packages` production 无 token 时降级 | production 环境无法验证 registry drift | 在 production vars 中配置只读 token（最小权限） |
| B5 | `generated-data.ts` 未在 git 中跟踪 | 新 checkout 需先运行 build 才能 typecheck | 已配置 prebuild/pretypecheck hook，但 CI 外的新开发者可能困惑。建议在 README 中说明。 |

---

*审查完成。本报告基于 2026-04-30 的代码快照，所有文件路径与行号均指向该快照。*
