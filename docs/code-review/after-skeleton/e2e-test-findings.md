# Nano-Agent 代码审查

> 审查对象: `after-skeleton test refresh`
> 审查时间: `2026-04-18`
> 审查人: `GPT`
> 审查范围:
> - `test/session-registry-doc-sync.test.mjs`
> - `test/test-command-coverage.test.mjs`
> - `test/verification-runner.test.mjs`
> - `test/e2e/e2e-07-workspace-fileops.test.mjs`
> - `packages/capability-runtime/test/*`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`after-skeleton refresh 这一轮测试升级已落地，root cross + capability-runtime 回归都通过，没有再撞出新的阻塞级产品 bug。`
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. `root test/` 已补上 script honesty、session registry/doc sync、remote-harness forwarding 这三类此前缺失的 guard。
  2. `E2E-07` 已从单纯 file ops 提升为 `workspace + grep->rg alias + stream redaction` 的跨包回归点。
  3. A8-A10 相关的 capability-runtime package tests 在当前 HEAD 全绿，说明此前 review 里提到的 `grep -i/-n`、dot-directory search、multibyte curl cap、PX inventory docs guard 至少在当前实现上都已被守住。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/eval/cross-packages-test-suite-02.md`
  - `docs/code-review/after-skeleton/A8-A10-reviewed-by-GPT.md`
- **核查实现**：
  - `test/session-registry-doc-sync.test.mjs`
  - `test/test-command-coverage.test.mjs`
  - `test/verification-runner.test.mjs`
  - `test/e2e/e2e-07-workspace-fileops.test.mjs`
  - `packages/capability-runtime/test/planner-grep-alias.test.ts`
  - `packages/capability-runtime/test/capabilities/search-rg-reality.test.ts`
  - `packages/capability-runtime/test/capabilities/network-egress.test.ts`
  - `packages/capability-runtime/test/inventory-drift-guard.test.ts`
- **执行过的验证**：
  - `npm run test:cross`
  - `pnpm --filter @nano-agent/capability-runtime test`
  - `node --test test/verification-runner.test.mjs test/session-registry-doc-sync.test.mjs test/test-command-coverage.test.mjs test/e2e/e2e-07-workspace-fileops.test.mjs`

### 1.1 已确认的正面事实

- `test/session-registry-doc-sync.test.mjs:5-79` 现在把 `nacp-session` 的 exported version / compat / ws subprotocol、registry markdown、README baseline 绑成同一条 root guard。
- `test/test-command-coverage.test.mjs:5-28` 现在固定了 `test:contracts / test:e2e / test:cross` 三段脚本与 root/e2e 双树同时存在的事实，补上了 suite-02 里的 runner honesty guard。
- `test/verification-runner.test.mjs:148-199` 新增了 `WorkerHarness(baseUrl)` 真的走 ambient `fetch` 的断言，避免再次把 remote-shaped run 误记成 in-process harness。
- `test/e2e/e2e-07-workspace-fileops.test.mjs:36-130` 已把 `createSearchHandlers()` 与 `planFromBashCommand("grep ...")` 接入，证明 `workspace-context-artifacts + capability-runtime + planner` 的最小 bash 搜索链路可以一起工作。
- `pnpm --filter @nano-agent/capability-runtime test` 全绿（24 files / 241 tests），其中直接覆盖了 `planner-grep-alias`、`search-rg-reality`、`network-egress`、`inventory-drift-guard` 四个 A8-A10 关键回归点。

### 1.2 已确认的负面事实

- `npm run test:cross` 仍会打印 `[MODULE_TYPELESS_PACKAGE_JSON]` warning；证据来自本轮 root run 输出，触发点是 `test/verification/*` 与 `test/fixtures/external-seams/*` 里的 ESM `.ts` helper 被 root `package.json` 当成未声明 module type 的文件加载。

---

## 2. 审查发现

### R1. Root test runner 仍有 module-type warning 噪音

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **事实依据**：
  - `package.json:1-12` 没有声明 `"type": "module"`
  - 本轮 `npm run test:cross` 输出多次出现 `[MODULE_TYPELESS_PACKAGE_JSON]`，来源包括 `test/verification/smokes/*.ts`、`test/fixtures/external-seams/*.ts`
- **为什么重要**：
  - 这不影响当前 correctness，但会持续污染 root test 输出，也会让后续 review 更难快速区分“真实 failing signal”与“tooling 噪音”。
- **审查判断**：
  - 当前不构成 blocker；这轮 after-skeleton refresh 可以收口。
- **建议修法**：
  - 二选一即可：
    1. 明确把 root test helper 所在边界声明为 ESM；
    2. 或把这些 `.ts` helper 收进已声明 module type 的包边界，减少 root runner 的自动重解析。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | root test scripts / runner honesty | `done` | `test/test-command-coverage.test.mjs` 已固定三条 root scripts 与双树存在事实。 |
| S2 | session registry / README / exported truth sync | `done` | `test/session-registry-doc-sync.test.mjs` 已覆盖 version、compat、subprotocol、message table、stream kinds。 |
| S3 | verification runner remote forwarding guard | `done` | `test/verification-runner.test.mjs` 已验证 `baseUrl` 模式下真的走 ambient `fetch`。 |
| S4 | workspace fileops cross-package refresh | `done` | `E2E-07` 已覆盖 mkdir partial disclosure、namespace-backed file ops、grep->rg alias 与 stream redaction。 |
| S5 | A8-A10 package regressions | `done` | capability-runtime package test 全绿，核心 minimal-bash regressions 均已被当前 HEAD 守住。 |

### 3.1 对齐结论

- **done**: `5`
- **partial**: `0`
- **missing**: `0`

这轮更像是“after-skeleton root/cross-package refresh 已完成并站稳”，而不是只写了一批新测试却没有证明它们能跑通。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | real-cloud L1/L2 provider verification | `遵守` | 本轮没有假装完成真实 cloud smoke；`l1/l2` 仍按当前环境诚实走 harness / missing-secret blocker。 |
| O2 | 顺手修产品实现 | `遵守` | 本轮只做 test refresh 与回归执行；没有在无必要的情况下扩散到产品代码。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`approve-with-followups`
- **是否允许关闭本轮 review**：`yes`
- **关闭前必须完成的 blocker**：
  1. `无`
  2. `无`
- **可以后续跟进的 non-blocking follow-up**：
  1. `处理 root test runner 的 MODULE_TYPELESS_PACKAGE_JSON warning。`
  2. `下一轮继续按 suite-02 扩展更重的 WS/live-evidence/remote-dev E2E，而不是只停留在当前 root refresh。`

本轮 review 可以收口。
