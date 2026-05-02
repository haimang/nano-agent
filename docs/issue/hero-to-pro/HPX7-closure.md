# HPX7 Closure Honesty and Follow-up — Closure

> 服务业务簇: `hero-to-pro / HPX7 — closure honesty + residual follow-up sync`
> 上游 action-plan: `docs/action-plan/hero-to-pro/HPX7-closure-honesty-and-followup-action-plan.md`
> 闭环日期: `2026-05-02`
> 文档状态: `closed`

---

## 0. 总体 Verdict

| 维度 | 结论 |
|------|------|
| HPX7 当前状态 | **`closed`**：6 项窄范围工作都得到 explicit verdict，且未越出 HPX7-S1..S4 的 scope guard |
| Closure honesty | HP5 HookDispatcher 口径已回调到 `dispatcher-injected / caller-deferred`；final closure 不再沿用 “7 retained” 旧说法 |
| Agent-core residuals | `tool.call.cancelled` live producer 与 attach race hardening 已落地；token accounting 经 verification-first 复核后未再确认出新的 live bug |
| HPX6 residual sync | `/runtime` 已具 `ETag / If-Match` public optimistic lock；`/items` public route 已有 7-kind route evidence；cancel route 已 forward `tool.call.cancelled` |
| Docs / closure chain | `HP5-closure.md`、`HPX6-closure.md`、`hero-to-pro-final-closure.md`、`clients/api-docs/{runtime,tool-calls}.md` 已按 current code reality 同步 |
| 测试 | 受影响 worker tests、root `pnpm test`、`pnpm run check:docs-consistency` 均作为本轮 closure 证据 |

---

## 1. Item-by-item Verdict

| ID | 项目 | Verdict | 说明 | 主要证据 |
|----|------|---------|------|----------|
| H1 | HP5 closure honesty sync | `closed` | HookDispatcher 只证明 dispatcher substrate 已注入，不再误写成 live caller 已闭环 | `docs/issue/hero-to-pro/HP5-closure.md` |
| H2 | token accounting audit | `verification-closed` | 本轮按 `reducer.ts → runner.ts → runtime-mainline.ts` 复核，没有再证实独立的重复累计 live bug；因此不为旧 review 口径强做跨 worker patch | `workers/agent-core/src/kernel/reducer.ts`, `workers/agent-core/src/kernel/runner.ts`, `workers/agent-core/test/kernel/reducer.test.ts` |
| H3 | `tool.call.cancelled` live caller | `closed` | agent-core parent cancel 与 public user cancel route 现在都能产生真实 live cancel 结果，而不再只停在 transport/ledger 层 | `workers/agent-core/src/host/runtime-mainline.ts`, `workers/agent-core/src/host/do/session-do/runtime-assembly.ts`, `workers/orchestrator-core/src/hp-absorbed-routes.ts` |
| H4 | websocket attach race hardening | `closed` | `attachHelperToSocket()` 不再空 catch；仅吞 `NACP_SESSION_ALREADY_ATTACHED`，其他错误继续抛出 | `workers/agent-core/src/host/do/session-do-runtime.ts`, `workers/agent-core/test/host/do/nano-session-do.test.ts` |
| H5 | HPX6 R1 verification-first 收口 | `verification-closed` | 当前 repo reality 下 `/items` 的 7-kind list/detail 已成立；HPX7 做的是 route-level evidence 补齐，而不是重写 object layer | `workers/orchestrator-core/src/item-projection-plane.ts`, `workers/orchestrator-core/test/session-items-route.test.ts` |
| H6 | `/runtime` public optimistic lock | `closed` | `GET` 现在返回 `ETag` 且支持 `If-None-Match`；`PATCH` 在保留 body `version` 的同时支持 `If-Match` | `workers/orchestrator-core/src/facade/routes/session-runtime.ts`, `workers/orchestrator-core/test/session-runtime-route.test.ts` |

---

## 2. 本轮真正修掉了什么

1. **修掉了 schema-live / producer-not-live 的 cancel 缺口**：`tool.call.cancelled` 不再只是 nacp-session schema 里的声明，agent-core parent cancel 与 public cancel route 都能产生真实事件。
2. **修掉了一个真实 silent swallow**：`attachHelperToSocket()` 不再用空 catch 吞掉未知异常。
3. **把 HPX6 residual 改成了可验证的 public contract**：`/runtime` 现在有 header-level optimistic lock，`/items` 与 cancel route 也都有 route-level evidence。
4. **把 closure wording 拉回事实**：HP5/HPX6/final closure 不再把工程 retained、caller deferred、verification-only 项混写成“已经 fully done”。

---

## 3. 明确没有纳入 HPX7 的内容

以下内容保持 **不进入 HPX7**，避免 scope creep：

1. replay / detached recovery / reconnect 深语义
2. reasoning typing / replay doc regex drift
3. retry / fork / restore executor deep semantics
4. 新 D1、新协议帧、新 worker 或跨 topology 改造

这些内容仍应由后续 pro-to-product phase 或已有 retained map 显式承接，而不是被 HPX7 偷偷吸收。

---

## 4. 验证记录

| 命令 | 结果 |
|------|------|
| `pnpm --filter @haimang/agent-core-worker test -- test/host/runtime-mainline.test.ts test/host/do/nano-session-do.test.ts` | ✅ pass |
| `pnpm --filter @haimang/orchestrator-core-worker typecheck` | ✅ pass |
| `pnpm --filter @haimang/orchestrator-core-worker build` | ✅ pass |
| `pnpm --filter @haimang/orchestrator-core-worker test -- test/tool-calls-route.test.ts test/session-runtime-route.test.ts test/session-items-route.test.ts` | ✅ pass |
| `pnpm run check:docs-consistency` | ✅ pass (`22 docs pass 8 regex checks + 2 required-snippet checks`) |
| `pnpm test` | ✅ pass (`102 files / 1075 tests`) |

---

## 5. 与 hero-to-pro final closure 的关系

HPX7 完成后，hero-to-pro 的 retained map 应只保留 **4 项 owner-action retained**：

1. HP8-D1 R28 owner runbook
2. HP9-D1 manual evidence
3. HP9-D2 prod schema baseline
4. HP9-D3 4-reviewer memos

工程侧 cleanup / honesty residual 在本轮之后不再作为阶段 retained blocker 挂起；它们要么已经被代码修掉，要么被降格为 `accepted-as-risk / known issue`，不再阻止 hero-to-pro 进入 `close-with-known-issues`。
