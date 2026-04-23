# Nano-Agent 代码审查

> 审查对象: `worker-matrix / P0 + P1 implementation by Claude Opus`
> 审查时间: `2026-04-23`
> 审查人: `GPT-5.4`
> 审查范围:
> - `docs/action-plan/worker-matrix/P0-absorption-prep.md`
> - `docs/action-plan/worker-matrix/P1-agent-bash-absorption.md`
> - `docs/issue/worker-matrix/P0-absorption-prep-closure.md`
> - `docs/issue/worker-matrix/P1-closure.md`
> - `workers/agent-core/**`
> - `workers/bash-core/**`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`P0/P1 的主体工作量真实存在，但当前不应把它们合并标记为 completed；P0 仍停在 owner-ratification，P1 则因为 agent-core 默认入口仍是 probe shell 而未真正收口。`
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `P1.B(bash-core) 的吸收与 real preview deploy 基本成立，但 P1.A 的 “index.ts 升到 host worker entry” 没有兑现。`
  2. `P0 closure memo 仍是 draft，owner 决策表与 exit criteria 还没关完，所以 P0 不能诚实地算 closed。`
  3. `当前绿色测试主要证明“搬进来的 package-local 测试还在过”，没有守住 agent-core 默认 worker 入口的真实行为。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/worker-matrix/P0-absorption-prep.md`
  - `docs/action-plan/worker-matrix/P1-agent-bash-absorption.md`
  - `docs/issue/worker-matrix/P0-absorption-prep-closure.md`
  - `docs/issue/worker-matrix/P1-closure.md`
- **核查实现**：
  - `workers/agent-core/src/index.ts`
  - `workers/agent-core/src/host/worker.ts`
  - `workers/agent-core/test/smoke.test.ts`
  - `workers/bash-core/src/index.ts`
  - `workers/bash-core/test/smoke.test.ts`
  - `docs/design/worker-matrix/blueprints/blueprints-index.md`
- **执行过的验证**：
  - `pnpm --filter @haimang/agent-core-worker test`
  - `pnpm --filter @haimang/bash-core-worker test`
  - `node --test test/*.test.mjs`
  - `npm run test:cross`
  - `pnpm --filter @haimang/agent-core-worker build` + 本地导入 `dist/index.js` 复现 `/sessions/:id/...` 路由行为
  - `curl -fsSL https://nano-agent-bash-core-preview.haimang.workers.dev/`
  - `curl -X POST https://nano-agent-bash-core-preview.haimang.workers.dev/capability/{call,cancel}`

### 1.1 已确认的正面事实

- `P0` 产出的 blueprints 目录与 `blueprints-index.md` 已存在，`plan-worker-matrix.md` 与 handoff memo 也都已回链到 `P0-absorption-prep-closure.md`。  
- `P1` 的 bulk absorption 是真的：`workers/agent-core/src/{host,kernel,llm,hooks,eval}` 与 `workers/bash-core/src/{capabilities,fake-bash,targets}` 已落盘，关键 worker/root 测试命令也都能通过。  
- `bash-core` live preview claim 成立：`GET /`、`GET /health`、`POST /capability/call`、`POST /capability/cancel`、`GET /tool.call.request` 的实测行为与 closure memo 一致。  

### 1.2 已确认的负面事实

- `workers/agent-core/wrangler.jsonc` 仍以 `dist/index.js` 为入口，但 `workers/agent-core/src/index.ts` 当前对所有请求都直接返回 probe JSON，并没有把 `/sessions/:id/...` 委派到 `host/worker.ts` 的 DO-forwarding 路径。  
- `P0` closure memo 仍是 `draft`，且 owner decision 表仍全部 `_pending_`，`E3/E6` 也仍未勾绿。  
- `P1` closure memo 顶部已经写成 `closed`，但正文第 15 行仍保留 “F6 preview deploy — owner action pending”；同时 `agent-core` 的 smoke coverage 只测根路径 probe，没测默认入口的 session route forwarding。  

---

## 2. 审查发现

### R1. `agent-core` 默认 Worker 入口仍是 probe shell，P1.A-sub3 未真正完成

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `docs/action-plan/worker-matrix/P1-agent-bash-absorption.md:72,81,138,186,226` 明确把 `workers/agent-core/src/index.ts` 的目标定义为 “从 probe 升到 host worker entry(re-export DO + worker fetch handler)”。
  - `workers/agent-core/wrangler.jsonc:3-4` 说明真实入口仍是 `dist/index.js`。
  - `workers/agent-core/src/index.ts:3-41` 当前只导出 `NanoSessionDO`，并在 `fetch()` 里无条件 `return Response.json(createShellResponse())`。
  - `workers/agent-core/src/host/worker.ts:72-88` 已经存在真正的 routing + `SESSION_DO` forwarding 逻辑，但没有被 `src/index.ts` 接上。
  - 本地复现实测：导入 `workers/agent-core/dist/index.js` 后请求 `/sessions/s1/status`，返回仍是 probe JSON，且注入的 `SESSION_DO` mock 调用列表为空。
  - `workers/agent-core/test/smoke.test.ts:15-27` 只断言根路径 probe shape，没有覆盖 `/sessions/:id/...` 行为。
- **为什么重要**：
  - 这不是“文档措辞保守/激进”的问题，而是默认 deploy 入口的真实行为仍停留在 W4 shell 模式。A1 host shell 虽然被复制进了树里，但对 Wrangler 主入口仍然不可达。
  - P2 的 default composition、HTTP fallback、WS ingress、`initial_context` consumer 都建立在 “agent-core 已经是 host worker entry” 这个前提上；如果 P1 在这个状态下被判 closed，后续 phase 会在错误基线上继续推进。
- **审查判断**：
  - `P1.A-sub3 / P3-01` 只能判 `partial`，因此 `P1 100% closed` 与 `Phase 1-6 全绿` 的结论不成立。
- **建议修法**：
  - 把 `workers/agent-core/src/index.ts` 改成真正的 wrapper entry：保留 `GET /` probe compat，但对 `/sessions/:id/...` 委派到 `./host/worker.js`。
  - 至少新增一个 worker-level entry test：对 `/sessions/:id/status` 或 `/sessions/:id/start` 注入 `SESSION_DO` mock，断言发生 `idFromName → get → fetch` 调用链。

### R2. `P0` 仍停在 owner-ratification，closure 不能算 completed

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - `docs/issue/worker-matrix/P0-absorption-prep-closure.md:7` 仍写 `文档状态: draft`。
  - `docs/issue/worker-matrix/P0-absorption-prep-closure.md:99-109` 的 owner / schedule / rollback / probe / expected JSON 五项最终 answer 仍全部 `_pending_`。
  - `docs/issue/worker-matrix/P0-absorption-prep-closure.md:183-194` 里 `E3` 与 `E6` 仍未勾绿，并明确写着 `E3 / E6 在 P0 closure PR 审阅期由 owner 填写确认`。
  - `docs/action-plan/worker-matrix/P0-absorption-prep.md:502-505` 自己也写了 `4/6 完全绿 / 1/6 部分绿 / 1/6 pending`。
  - `docs/action-plan/worker-matrix/P0-absorption-prep.md:531-536` 仍把 owner action 列为未完成 gate。
  - 同时 `docs/plan-worker-matrix.md:613` 与 `docs/handoff/pre-worker-matrix-to-worker-matrix.md:195` 已经把 P0 挂成可引用输入，这造成了“链接已补，但 closure 本体还没 honest close”的双层口径。
- **为什么重要**：
  - P0 不只是“文档整理 phase”；它自己定义了 P1 kickoff gate，尤其是 `P2.E0 owner 已定`。如果这些 answer 还没回填，就不能把 P0 描述成已完成 closure。
  - 下一位执行者如果只看 handoff / charter 顶层索引，会误以为 P0 已是 fully closed truth layer，而不是“产出已齐、但 owner ratification 仍未完成”的状态。
- **审查判断**：
  - `P0` 当前更接近 `partial / ready-for-owner-ratification`，不应被算作 closed。
- **建议修法**：
  - 要么把 §3.2 五项最终值补成真值，并同步把 `E3/E6` 勾绿、`draft` 改成 `closed`；
  - 要么把顶层口径统一收紧，明确写成 `P0 outputs produced, closure pending owner ratification`，不要再把它当 completed phase 引用。

### R3. `P1` closure memo 自相矛盾，且缺少守住默认入口行为的回归测试

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/issue/worker-matrix/P1-closure.md:7` 已写成 `closed(...)`。
  - `docs/issue/worker-matrix/P1-closure.md:15` 仍写 `Phase 5 F6 real preview deploy — owner action pending`。
  - `docs/issue/worker-matrix/P1-closure.md:194-207` 又在 §5.5 回填了已完成 deploy 的 URL / Version ID / executor。
  - `workers/agent-core/test/smoke.test.ts:15-27` 只守住 probe JSON，没有任何 entry-level session route forwarding 断言。
- **为什么重要**：
  - 这类自相矛盾会直接污染 closure memo 的“单一真相”地位；而缺少 entry-level route coverage，正是 R1 能够溜过 package-local 绿测的原因。
- **审查判断**：
  - 这条本身不阻止最终修复，但它说明当前 closure pack 还不能直接作为下一阶段的无条件 truth layer。
- **建议修法**：
  - 重写 P1 closure memo 顶部背景段，把 F6 状态统一成已完成；
  - 在 `agent-core` 增补一条默认入口 route smoke / integration test，防止未来再次出现“host/worker.ts 已落盘，但 index.ts 没接上”的假绿。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | P0 代表 blueprint reality-check + 7 份补齐 blueprint + index | `done` | 8 份 P0 资产已存在，`blueprints-index.md` 也能覆盖 10 units。 |
| S2 | P0 kickoff checklist + D01-D09 R1-R5 吸收索引 | `done` | `P0-absorption-prep-closure.md` 的 §4、§5 已落盘。 |
| S3 | P0 owner 决策与 closure exit criteria 全绿 | `partial` | owner decision 仍全 `_pending_`，`E3/E6` 未闭合，文档仍为 `draft`。 |
| S4 | P0 charter / handoff 回链 | `done` | `plan-worker-matrix.md` 与 handoff memo 都已加入 P0 closure link。 |
| S5 | P1 A1-A5 的 src/test bulk absorption | `done` | `workers/agent-core/src/{host,kernel,llm,hooks,eval}` 与对应测试目录已存在，相关测试命令可通过。 |
| S6 | P1 B1 的 src/test bulk absorption | `done` | `workers/bash-core/src/**` 与 `workers/bash-core/test/**` 已落盘，binding-first 入口和包内测试都成立。 |
| S7 | P1 `workers/agent-core/src/index.ts` 升级为 host worker entry | `partial` | 当前只完成 DO re-export + probe shape 更新，未把 session routes 委派到 absorbed host worker。 |
| S8 | P1 `workers/bash-core` binding-first + live preview deploy | `done` | 本地与 live preview 两侧都验证了 `GET /`, `GET /health`, `POST /capability/{call,cancel}`, `GET /tool.call.request`。 |
| S9 | P1 全仓回归与 closure pack | `partial` | 绿测是真实的，但 closure 文字与默认入口行为还没对齐，不能判“全绿闭环”。 |

### 3.1 对齐结论

- **done**: `6`
- **partial**: `3`
- **missing**: `0`

`这更像“bulk absorption 已经完成、bash-core 已可作为下一阶段前置，但 agent-core 默认入口与 P0/P1 closure truth 仍未收口”，而不是 completed。`

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 不修改 NACP wire vocabulary / session message matrix / tenant law | `遵守` | 本轮核查范围内未看到对这些协议真相的改写。 |
| O2 | root contract / cross / e2e tests 不搬进 worker-local tests | `遵守` | root `test/*.test.mjs` 与 `npm run test:cross` 仍独立存在并可运行。 |
| O3 | Tier B packages 在共存期保留物理存在，不在 P1 直接打 DEPRECATED | `遵守` | 各源 package 仍保留，当前问题不在 package removal。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`P0/P1 主体工作成立，但本轮 review 不收口。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. `修正 workers/agent-core/src/index.ts，使默认 Worker 入口真正接入 absorbed host worker；或者诚实把 P1.A-sub3 / P1 closure 降为 partial。`
  2. `把 P0 closure memo 的 owner decision / E3-E6 状态补成真值，或明确降级为“待 owner ratification”，不能继续按 closed 引用。`
- **可以后续跟进的 non-blocking follow-up**：
  1. `统一 P1 closure memo 顶部关于 F6 deploy 的叙述，清掉“已完成/待 owner”双口径。`
  2. `为 agent-core 默认入口增加 session-route forwarding 测试，避免同类假绿再次出现。`

`本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。`
