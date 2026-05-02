# Nano-Agent 行动计划

> 服务业务簇: `hero-to-pro / HPX7 — closure honesty + scoped follow-up fixes`
> 计划对象: `把 hero-to-pro 从 partial-close / 7-retained 推到 close-with-known-issues 所需的 6 项窄范围修补：closure honesty、agent-core micro-fix、HPX6 residual followup、final closure uplift`
> 类型: `modify + refactor + remove`
> 作者: `GPT-5.4`
> 时间: `2026-05-02`
> 文件位置: `docs/action-plan/hero-to-pro/HPX7-closure-honesty-and-followup-action-plan.md`
> 上游前序 / closure:
> - `docs/eval/pro-to-product/re-planning-by-opus.md` §6.1-§6.4（HPX7 新入选标准、6 项清单、与 final closure 的关系）
> - `docs/eval/pro-to-product/initial-planning-reviewed-by-GPT.md` §3-§6（phase 重排、truth gate、D1 freeze 例外与 verification-first 判断）
> - `docs/issue/hero-to-pro/HPX6-closure.md`（当前 `executed-with-followups`，R1/R2 followup 仍需事实收口）
> - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`（当前 `partial-close / 7-retained-with-explicit-remove-condition`）
> 下游交接:
> - `docs/issue/hero-to-pro/HPX7-closure.md`
> - `docs/issue/hero-to-pro/HPX6-closure.md`（follow-up 状态回填）
> - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`（升级为 `close-with-known-issues`）
> - `docs/charter/plan-pro-to-product.md`（PP0 入口时引用 HPX7 的真实收口状态）
> 关联设计 / 调研文档:
> - `docs/eval/pro-to-product/re-planning-by-opus.md`
> - `docs/eval/pro-to-product/initial-planning-reviewed-by-GPT.md`
> - `docs/eval/pro-to-product/initial-planning-reviewed-by-kimi.md`
> 冻结决策来源:
> - `docs/eval/pro-to-product/re-planning-by-opus.md` §6.1（HPX7 S1-S4 入选标准）
> - `docs/eval/pro-to-product/re-planning-by-opus.md` §6.2（HPX7-1..HPX7-6）
> - `docs/eval/pro-to-product/re-planning-by-opus.md` §6.3（明确不进入 HPX7 的项目）
> - `docs/eval/pro-to-product/re-planning-by-opus.md` §6.4（HPX7 完成后的 hero-to-pro final closure 目标状态）
> - `docs/charter/plan-hero-to-pro.md` §16.4（hero-to-pro 后期 reality 已是 workbench-grade backend substrate）
> 文档状态: `draft`

---

## 0. 执行背景与目标

HPX7 不是一个新的能力阶段，而是 hero-to-pro 尾端的一次 **诚实收口 + 窄范围补题**。`re-planning-by-opus.md` 已经把 initial draft 中自相矛盾的 HPX7 范围重新压缩为 6 项：它们都必须满足 **单工程师 1 天内可完整 deliver、不跨 worker、不引入新协议 / 新 D1 / 新 message_type，并且直接服务于 deceptive closure 修正、schema-live producer-not-live 修补、race hardening 或 final closure 升级**。因此，HPX7 的目标不是“再补一个小 phase”，而是 **在不重开 hero-to-pro 命题的前提下，消掉最后一批不诚实表述与显性 follow-up**。

结合当前真实代码，我对这 6 项又做了一次一手核对：`runtime-mainline.ts` 的 `cancel()` 目前只下发 capability transport cancel，没有形成 `tool.call.cancelled` 的 live caller；`session-do-runtime.ts` 的 `attachHelperToSocket()` 仍有空 `catch {}`；`session-runtime.ts` 公开路由已有 body-version + D1 version-law，但还没有 HTTP 层的 `ETag / If-Match` 乐观锁合同。与此同时，`item-projection-plane.ts` 当前已经能够 list/read 7 类 item，因此 HPX7-5 不能机械照抄旧 review，而必须按 **verification-first** 的方式先核实“剩余 gap 是否仍存在于 public surface / tests / closure 口径”，避免把已吸收的问题重新当成实施项。

- **服务业务簇**：`hero-to-pro / HPX7 — closure honesty + scoped follow-up fixes`
- **计划对象**：`HPX7-1..HPX7-6 六项窄修补 + 对 hero-to-pro final closure 的 verdict uplift`
- **本次计划解决的问题**：
  - `HP5-closure.md` 仍把 F12 写成 first-wave closed，与当前“dispatcher 注入但 live caller deferred”事实不一致
  - agent-core 仍存在 3 条窄 seam：token accounting 疑点、tool cancel producer-not-live、attach race 静默吞错
  - HPX6 review R1 / R2 需要以当前 repo reality 重新判定并收口，尤其 `/runtime` 的 public optimistic lock 合同需要补齐
- **本次计划的直接产出**：
  - `docs/issue/hero-to-pro/HP5-closure.md`、`HPX6-closure.md`、`hero-to-pro-final-closure.md` 的事实回填与 verdict 升级
  - `workers/agent-core` 与 `workers/orchestrator-core` 的定点代码 / 测试修补（仅限 HPX7 六项）
  - `docs/issue/hero-to-pro/HPX7-closure.md`，作为 HPX7 的唯一执行回填入口
- **本计划不重新讨论的设计结论**：
  - HPX7 只接受满足 S1-S4 的工作，任何跨 worker / 新协议 / 新 D1 / 新 message_type 的事项都必须退回 pro-to-product（来源：`re-planning-by-opus.md` §6.1）
  - replay restore、lagged contract、detached TTL 属 PP3；reasoning content_type 与 observability push 属 PP6；docs drift 总收口属 PP0 / PP6（来源：`re-planning-by-opus.md` §6.3）
  - HPX7 完成后 hero-to-pro 的目标状态是 `close-with-known-issues`，4 项 owner-action retained 不变，不追求 `full close`（来源：`re-planning-by-opus.md` §6.4）

---

## 1. 执行综述

### 1.1 总体执行方式

**先诚实表述、再做窄修补、最后统一 uplift closure。** Phase 1 先把 F12 与 HPX7 范围的 truth sync 固化，防止后续实现继续建立在旧 closure 口径上；Phase 2 集中处理 `agent-core` 的 3 个单 worker 微修补；Phase 3 收口 `orchestrator-core` 残余 follow-up，其中 `/runtime` optimistic lock 是确定项，`item projection` 采用 verification-first，不强行重做已吸收代码；Phase 4 再把 HPX7 closure、HPX6 closure follow-up 状态、hero-to-pro final closure verdict 一次性回填。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Closure Honesty Sync | `XS` | 先修正 F12 / HPX7 scope 的事实口径，冻结 HPX7 只做 6 项窄修补 | `-` |
| Phase 2 | Agent-Core Micro Fixes | `S` | 处理 token accounting、tool cancel live caller、attach race hardening | `Phase 1` |
| Phase 3 | Orchestrator Residual Followups | `S` | 补 `/runtime` 的 public optimistic lock；复核并收口 HPX6 R1 item projection residual | `Phase 1` |
| Phase 4 | Closure Uplift & Regression | `XS` | 写 HPX7 closure，回填 HPX6 / hero-to-pro final closure，并跑整体回归 | `Phase 2 + Phase 3` |

### 1.3 Phase 说明

1. **Phase 1 — Closure Honesty Sync**
   - **核心目标**：先把 `HP5-closure.md` 与 HPX7 目标状态改到与 reality 一致，避免“边修边沿用错误 closure”。
   - **为什么先做**：HPX7 的第一价值就是消除 deceptive closure；如果 Phase 1 不先做，后续所有“已修 / 未修”的判定都会继续漂。
2. **Phase 2 — Agent-Core Micro Fixes**
   - **核心目标**：把 3 个确定属于 `agent-core` 的微修补集中完成，并补齐相应 worker/package 测试。
   - **为什么放在这里**：三项都不跨 worker，且对 HPX7 的“schema-live producer-not-live / race hardening”目标最直接。
3. **Phase 3 — Orchestrator Residual Followups**
   - **核心目标**：以 verification-first 的方式收口 HPX6 R1/R2，避免重复做已吸收工作，同时把 `/runtime` 公共合同提升到可并发控制的真实状态。
   - **为什么放在这里**：这两项都属于 `orchestrator-core`，适合在 Phase 2 之后按 worker 聚簇收尾。
4. **Phase 4 — Closure Uplift & Regression**
   - **核心目标**：把 HPX7 的结果固化进 closure 体系，并确认 hero-to-pro 的阶段 verdict 可以合法升级。
   - **为什么放在最后**：只有代码、测试与 truth sync 全部完成，closure uplift 才是可信的。

### 1.4 执行策略说明

- **执行顺序原则**：先修正文档真相，再按 worker 分簇修补代码，最后统一更新 closure verdict。
- **风险控制原则**：任何工作一旦超出 S1-S4（跨 worker、新 frame、新 D1、新 message_type、超过 1 天）立即踢出 HPX7，转交 PP0 / PP3 / PP6。
- **测试推进原则**：先补现有定点 Vitest，再跑受影响 worker/package 的 build/typecheck/test，最后用 root `pnpm test` 与 docs consistency 做整体回归。
- **文档同步原则**：HPX7 只同步 closure / final closure / 必要的 public runtime contract 文档；不重开 22-doc pack 的系统性 rewrite。
- **回滚 / 降级原则**：HPX7 不允许引入新的长期兼容层；如果某项需要 feature flag、新协议或新表，直接判定为不属于 HPX7。

### 1.5 本次 action-plan 影响结构图

```text
HPX7 scoped follow-up fixes
├── Phase 1: Closure Honesty Sync
│   ├── docs/issue/hero-to-pro/HP5-closure.md
│   └── docs/issue/hero-to-pro/hero-to-pro-final-closure.md
├── Phase 2: Agent-Core Micro Fixes
│   ├── workers/agent-core/src/kernel/reducer.ts
│   ├── workers/agent-core/src/host/runtime-mainline.ts
│   ├── workers/agent-core/src/host/do/session-do-runtime.ts
│   └── workers/agent-core/test/{kernel/reducer.test.ts,host/runtime-mainline.test.ts,...}
├── Phase 3: Orchestrator Residual Followups
│   ├── workers/orchestrator-core/src/runtime-config-plane.ts
│   ├── workers/orchestrator-core/src/facade/routes/session-runtime.ts
│   ├── workers/orchestrator-core/src/item-projection-plane.ts (仅在 residual 仍真实存在时)
│   └── workers/orchestrator-core/test/{runtime-config-plane.test.ts,item-projection-plane.test.ts,...}
└── Phase 4: Closure Uplift & Regression
    ├── docs/issue/hero-to-pro/HPX7-closure.md
    ├── docs/issue/hero-to-pro/HPX6-closure.md
    └── docs/issue/hero-to-pro/hero-to-pro-final-closure.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 更新 `docs/issue/hero-to-pro/HP5-closure.md`：把 F12 从“closed / done-first-wave”修正为“dispatcher instance injected；real caller deferred to pro-to-product PP4”。
- **[S2]** 复核并修正 token accounting 链路：以 `workers/agent-core/src/kernel/reducer.ts` 为首入口，连同 `kernel/runner.ts` 与 compact signal 读取链路一起确认是否存在真实双重累计；若重复点不在 `reducer.ts` 而在同 worker 其他 token 汇总点，则按真实 owner file 修复，但**不得**扩展到 PP2 的 real compact 设计。
- **[S3]** 补齐 `workers/agent-core/src/host/runtime-mainline.ts` 的 cancel live caller：在现有 capability transport `cancel()` 基础上，接出可观察的 `tool.call.cancelled` 结果路径，并补相应测试。
- **[S4]** 修复 `workers/agent-core/src/host/do/session-do-runtime.ts` `attachHelperToSocket()` 的空 `catch {}`：改成显式 error surfacing 或 detach-then-attach 的真实分支，不再静默吞 race。
- **[S5]** 在现有 `D1RuntimeConfigPlane` version-law 基础上，补齐 `/sessions/{id}/runtime` 的 public optimistic lock 合同：`GET` 提供 `ETag`，`PATCH` 支持 `If-Match`，并与现有 `version` 冲突语义对齐。
- **[S6]** 以 verification-first 方式复核 HPX6 R1：如果 `item-projection-plane.ts` 与 public `/items` route 已经完整支持 7 类 item 的 list/read，则 HPX7 只补 route/test/closure 证据，不重复改代码；如果 public surface 仍有 residual gap，再做最小补丁。
- **[S7]** 新建 `docs/issue/hero-to-pro/HPX7-closure.md`，并同步回填 `HPX6-closure.md` 与 `hero-to-pro-final-closure.md`，把阶段 verdict 提升为 `close-with-known-issues`。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** `restoreFromStorage` replay restore、lagged contract、detached TTL、actor snapshot —— 下放 `pro-to-product` PP3。
- **[O2]** reasoning `content_type` 区分、TokenCount / RateLimits / ContextWindow% push、HookStarted / HookCompleted —— 下放 `pro-to-product` PP6。
- **[O3]** `confirmations.md` / `session-ws-v1.md` 全量 docs drift 清扫与 docs regex drift guard —— 下放 PP0 / PP6。
- **[O4]** `approval_policy=ask` 真 pause-resume、real compact、minimal hook loop、runtime 三字段真 enforce —— 全部属于 pro-to-product 主线，不属于 HPX7。
- **[O5]** 新 D1 migration、新顶层协议帧、新 NACP message_type、新 worker 或新 Queue topology。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| `HP5-closure.md` F12 诚实降级 | `in-scope` | 直接消除 deceptive closure，完全符合 S1-S4 | 无；HPX7 必做 |
| token accounting bug | `in-scope`（audit-first） | re-planning 指定为 HPX7-2，但当前 `reducer.ts` 未显出明显重复累计，必须先复核真实 owner file | 若定位结果跨 worker 或要求 real compact 改造，则踢到 PP2 |
| `tool.call.cancelled` live caller | `in-scope` | 当前 schema 已有、cancel transport 已有、producer-not-live 明确 | 若需要新 frame / 新 route 才能完成，则踢到 PP6 |
| attach race 空 catch | `in-scope` | 单 worker race hardening，完全符合 HPX7 定位 | 无 |
| `/runtime` optimistic lock | `in-scope` | D1 plane 已有 version-law；缺的是 public HTTP contract | 若需要新增表/字段而非纯 route contract，则踢到 PP5 |
| HPX6 R1 item projection residual | `in-scope`（verification-first） | re-planning 收进 HPX7，但当前代码已显示 7-kind list/read 支持，必须先核实是否只剩 route/test/closure gap | 若 public surface 也已无 gap，则转为 closure-only |
| replay restore / lagged contract | `out-of-scope` | 明确被 re-planning 下放到 PP3a | 仅 PP3 重新评估 |
| reasoning stream typing | `out-of-scope` | 已被 re-planning 从 HPX7 删除并下放 PP6 | 仅 PP6 重新评估 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | F12 closure honesty rewrite | `update` | `docs/issue/hero-to-pro/HP5-closure.md` | 把 HP5 对 F12 的表述改到与当前 reality 一致 | `low` |
| P1-02 | Phase 1 | HPX7 scope fact-check baseline | `update` | `docs/action-plan/hero-to-pro/HPX7-closure-honesty-and-followup-action-plan.md`, `docs/issue/hero-to-pro/hero-to-pro-final-closure.md` | 冻结 HPX7 只做 6 项，且 item projection 采用 verification-first | `low` |
| P2-01 | Phase 2 | Token accounting audit & fix | `update` | `workers/agent-core/src/kernel/{reducer.ts,runner.ts}` 及相关测试 | 消除真实重复记账点，确保 compact signal 不被假触发 | `medium` |
| P2-02 | Phase 2 | Tool cancel live caller | `update` | `workers/agent-core/src/host/runtime-mainline.ts`, `packages/nacp-session/test/hp6-tool-cancelled.test.ts`, `workers/agent-core/test/host/runtime-mainline.test.ts` | 让 cancel 从 transport 调用变成可观察的 runtime event / stream output | `medium` |
| P2-03 | Phase 2 | Attach race hardening | `update` | `workers/agent-core/src/host/do/session-do-runtime.ts` 及相关测试 | 取消空 catch，显式 surface reconnect race | `low` |
| P3-01 | Phase 3 | `/runtime` ETag / If-Match contract | `update` | `workers/orchestrator-core/src/{runtime-config-plane.ts,facade/routes/session-runtime.ts}` 及测试 | 把已有 version-law 升级为 public optimistic lock | `medium` |
| P3-02 | Phase 3 | HPX6 R1 residual verification / patch | `update` | `workers/orchestrator-core/src/{item-projection-plane.ts,facade/routes/session-items.ts}` 及测试 | 只收口仍真实存在的 `/items` residual，不重复改已完成功能 | `low` |
| P4-01 | Phase 4 | HPX7 closure doc + HPX6 follow-up sync | `add | update` | `docs/issue/hero-to-pro/{HPX7-closure.md,HPX6-closure.md}` | 形成 HPX7 的唯一 closure，并把 HPX6 R1/R2 结论显式落文 | `low` |
| P4-02 | Phase 4 | Final closure uplift + regression pack | `update` | `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`, affected tests/docs | 把 hero-to-pro verdict 升级到 `close-with-known-issues` 并完成整体回归 | `medium` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Closure Honesty Sync

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | F12 closure honesty rewrite | 重写 HP5 closure 中关于 HookDispatcher 的结论，把“已 closed”改为“dispatcher injected / live caller deferred to PP4” | `docs/issue/hero-to-pro/HP5-closure.md` | HP5 closure 不再误报 F12 完成度 | 文档自检 + 与当前代码锚点对照 | F12 口径与 `runtime-mainline.ts` / `runtime-assembly.ts` 的真实 wiring 一致 |
| P1-02 | HPX7 scope fact-check baseline | 把 HPX7 仅允许 6 项窄修补写死，并对 HPX6 R1 residual 采用 verification-first 判定 | 本 action-plan、`hero-to-pro-final-closure.md` | HPX7 不再携带 replay / reasoning / docs drift 等外溢任务 | 行动计划自检 | HPX7 边界与 `re-planning-by-opus.md` §6.1-§6.4 一致，无 scope creep |

### 4.2 Phase 2 — Agent-Core Micro Fixes

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | Token accounting audit & fix | 复核 `llm_response → compact signal` 的 token 记账链；按真实重复点修补并补齐定点测试 | `workers/agent-core/src/kernel/{reducer.ts,runner.ts}`, `test/kernel/reducer.test.ts` 等 | 不再出现重复累计导致的 compact false positive | agent-core 定点 Vitest | 能以测试证明总 token 只累计一次；无跨 worker 扩张 |
| P2-02 | Tool cancel live caller | 在 `cancel()` 现有 transport 路径上补齐 `tool.call.cancelled` 的 live caller / emit 语义 | `workers/agent-core/src/host/runtime-mainline.ts`, `workers/agent-core/test/host/runtime-mainline.test.ts`, `packages/nacp-session/test/hp6-tool-cancelled.test.ts` | cancel 不再只是 transport side-effect，而是可见状态变化 | agent-core + nacp-session 定点测试 | 用户/系统 cancel 都能形成可观察终态 |
| P2-03 | Attach race hardening | 把 `attachHelperToSocket()` 的空 catch 改为显式错误上浮或真实 reconnect 分支 | `workers/agent-core/src/host/do/session-do-runtime.ts` 及相关测试 | reconnect race 不再静默吞掉 | agent-core 定点测试 | race 路径有明确行为与日志 / error surface |

### 4.3 Phase 3 — Orchestrator Residual Followups

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | `/runtime` ETag / If-Match contract | 保留当前 body `version` / D1 version-law 的基础上，引入 HTTP `ETag / If-Match` 并补 route 测试与必要文档 | `workers/orchestrator-core/src/{runtime-config-plane.ts,facade/routes/session-runtime.ts}`, `test/runtime-config-plane.test.ts` | `/runtime` 具备真正的 public optimistic lock 合同 | orchestrator-core 定点 Vitest | GET 返回 ETag，PATCH 冲突语义稳定，route 合同可测 |
| P3-02 | HPX6 R1 residual verification / patch | 先核实现有 `item-projection-plane.ts` + `/items` route 是否仍有 residual gap；如仅剩 route/test/closure 缺口则补证据，如仍有功能缺口再做最小补丁 | `workers/orchestrator-core/src/{item-projection-plane.ts,facade/routes/session-items.ts}`, `test/item-projection-plane.test.ts` | HPX6 R1 被按 current reality 显式 closed，而不是沿用旧 review 口径 | orchestrator-core 定点 Vitest + route 自检 | `/items` 的最终结论与当前代码一致；不发生重复劳动 |

### 4.4 Phase 4 — Closure Uplift & Regression

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | HPX7 closure doc + HPX6 follow-up sync | 新建 HPX7 closure，并把 HPX6 R1/R2 与 HPX7 各项结果回填到 HPX6 closure | `docs/issue/hero-to-pro/{HPX7-closure.md,HPX6-closure.md}` | HPX7 有独立 closure，HPX6 follow-up 状态不再悬空 | 文档自检 | 6 项都有 explicit verdict，无 silently resolved |
| P4-02 | Final closure uplift + regression pack | 更新 hero-to-pro final closure，把阶段 verdict 从 `partial-close` 升级为 `close-with-known-issues`；跑受影响回归 | `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`, affected tests/docs | hero-to-pro 进入可合法承接 PP0 的终态 | root 回归 + docs consistency | 仅 4 项 owner-action retained 保留；engineering retained 收口完毕 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Closure Honesty Sync

- **Phase 目标**：先把 HPX7 的 truth baseline 定死，停止沿用旧的 deceptive closure 口径。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 新增文件**：
  - 无
- **本 Phase 修改文件**：
  - `docs/issue/hero-to-pro/HP5-closure.md`
  - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
- **本 Phase 删除文件**（如无可删去）：
  - 无
- **具体功能预期**：
  1. HP5 closure 对 F12 的表述从“已闭合”改为“dispatcher instance injected / caller deferred”。
  2. HPX7 的 6 项范围被明确锁定，replay / reasoning / docs drift 不再被偷偷夹带进来。
- **具体测试安排**：
  - **单测**：无
  - **集成测试**：无
  - **回归测试**：文档引用路径与代码锚点人工复核
  - **手动验证**：逐段对照 `re-planning-by-opus.md` §6.1-§6.4 与当前代码事实
- **收口标准**：
  - F12 口径与当前代码一致
  - HPX7 的范围说明不再与 current reality 打架
- **本 Phase 风险提醒**：
  - 若文档口径仍试图把 replay / reasoning / docs drift 混入 HPX7，则后续 implementation 必然再次膨胀

### 5.2 Phase 2 — Agent-Core Micro Fixes

- **Phase 目标**：以不跨 worker 的方式，收掉 agent-core 侧最后 3 条明确 seam。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - 无（优先补现有测试）
- **本 Phase 修改文件**：
  - `workers/agent-core/src/kernel/reducer.ts`
  - `workers/agent-core/src/kernel/runner.ts`
  - `workers/agent-core/src/host/runtime-mainline.ts`
  - `workers/agent-core/src/host/do/session-do-runtime.ts`
  - `workers/agent-core/test/kernel/reducer.test.ts`
  - `workers/agent-core/test/host/runtime-mainline.test.ts`
  - `packages/nacp-session/test/hp6-tool-cancelled.test.ts`
- **本 Phase 删除文件**（如无可删去）：
  - 无
- **具体功能预期**：
  1. token accounting 真实重复点被定位并修掉；如果 `reducer.ts` 本身不是 bug owner，按真实 owner file 落修补，但仍限定在 `agent-core` 内。
  2. `cancel()` 能驱动真实的 `tool.call.cancelled` 结果路径，而不是只调用 transport cancel。
  3. websocket attach race 不再被空 catch 静默吞掉。
- **具体测试安排**：
  - **单测**：`workers/agent-core/test/kernel/reducer.test.ts`、`workers/agent-core/test/host/runtime-mainline.test.ts`
  - **集成测试**：必要时补 `runtime-assembly` / host-runtime 定点测试，但不新增跨 worker e2e
  - **回归测试**：`pnpm --filter @haimang/agent-core-worker test`
  - **手动验证**：检查 cancel 与 attach race 的 error / event surface 是否可观测
- **收口标准**：
  - token accounting 链路能被测试证明无重复累计
  - cancel 与 attach race 都有显式可观测行为
- **本 Phase 风险提醒**：
  - token bug 可能不在 `reducer.ts`；若定位后需要跨 `context-core` 或 `orchestrator-core` 才能修完，则立即降级为 PP2 work item，不强撑进 HPX7

### 5.3 Phase 3 — Orchestrator Residual Followups

- **Phase 目标**：按 current repo reality 收掉 HPX6 R1/R2，而不是照旧 review 文本机械补丁。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - 无
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/runtime-config-plane.ts`
  - `workers/orchestrator-core/src/facade/routes/session-runtime.ts`
  - `workers/orchestrator-core/src/item-projection-plane.ts`（仅 residual 仍存在时）
  - `workers/orchestrator-core/src/facade/routes/session-items.ts`（仅 public route 仍有缺口时）
  - `workers/orchestrator-core/test/runtime-config-plane.test.ts`
  - `workers/orchestrator-core/test/item-projection-plane.test.ts`
- **本 Phase 删除文件**（如无可删去）：
  - 无
- **具体功能预期**：
  1. `/runtime` 的当前 body-version law 升级为更诚实的 public `ETag / If-Match` 并发合同。
  2. item projection 的 HPX6 R1 以 verification-first 收口：若 7-kind list/read 已成立，则只补 route/test/closure 证据；若仍有 public residual，再做最小补丁。
- **具体测试安排**：
  - **单测**：`workers/orchestrator-core/test/runtime-config-plane.test.ts`、`workers/orchestrator-core/test/item-projection-plane.test.ts`
  - **集成测试**：补 `/runtime` route contract 测试；必要时补 `/items` route 定点测试
  - **回归测试**：`pnpm --filter @haimang/orchestrator-core-worker test`
  - **手动验证**：核对 `/runtime` GET/PATCH 响应头与 conflict 语义；核对 `/items` list/detail 的 current reality
- **收口标准**：
  - `/runtime` 并发控制成为 public contract，而不仅是内部 D1 version law
  - HPX6 R1 被明确判为“已吸收”或“已以最小补丁修复”，不再悬而不决
- **本 Phase 风险提醒**：
  - 当前 `item-projection-plane.ts` 已显示 7 类 list/read 支持，最可能的结果是“closure-only + test-only”；不得为了符合旧 review 文字而重开大改

### 5.4 Phase 4 — Closure Uplift & Regression

- **Phase 目标**：把 HPX7 结果压实到 closure 体系，并完成 hero-to-pro 的合法 verdict 升级。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 新增文件**：
  - `docs/issue/hero-to-pro/HPX7-closure.md`
- **本 Phase 修改文件**：
  - `docs/issue/hero-to-pro/HPX6-closure.md`
  - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
  - `clients/api-docs/runtime.md`（仅当 `/runtime` public contract 发生可见变化时）
- **本 Phase 删除文件**（如无可删去）：
  - 无
- **具体功能预期**：
  1. HPX7 6 项全部有 explicit verdict：closed / verification-closed / deferred。
  2. HPX6 R1/R2 与 hero-to-pro final closure 的 retained map 同步更新。
  3. hero-to-pro final verdict 升级为 `close-with-known-issues`，只保留 4 项 owner-action retained。
- **具体测试安排**：
  - **单测**：无新增单测，消费前面 Phase 的测试结果
  - **集成测试**：受影响 route / worker tests 全绿
  - **回归测试**：root `pnpm test`
  - **手动验证**：逐条比对 `hero-to-pro-final-closure.md` retained map 与 HPX7 closure / HPX6 closure
- **收口标准**：
  - closure 文档之间不再互相打架
  - hero-to-pro 可作为 PP0 的可信前序，而不是“看起来收了、实际仍漂”
- **本 Phase 风险提醒**：
  - 不能把 owner-action retained 误写成 engineering closed；HPX7 只负责 engineering 侧 uplift

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| HPX7-S1..S4 | `re-planning-by-opus.md` §6.1 | HPX7 所有 work item 必须符合 1 天 deliver / 不跨 worker / 不引新协议或 D1 / 服务于 honesty or residual closure | 任一项不满足则退出 HPX7，改挂 PP0 / PP3 / PP6 |
| HPX7-1..6 清单 | `re-planning-by-opus.md` §6.2 | 本 action-plan 只围绕 6 项展开，不再沿用 initial 8 项版本 | 若 current reality 已吸收其中某项，则转为 verification-only，不额外造工作 |
| 不进入 HPX7 的项目 | `re-planning-by-opus.md` §6.3 | replay restore、reasoning typing、docs regex drift 等一律不纳入本计划 | 若实现中被触发，立即停止并移交对应 pro-to-product phase |
| hero-to-pro 终态目标 | `re-planning-by-opus.md` §6.4 | HPX7 完成后阶段 verdict 目标是 `close-with-known-issues`，而非 `full close` | 若仍需超过 4 项 owner-action retained 之外的新 retained，则 HPX7 不能宣称完成 |
| workbench-grade backend substrate 已成立 | `plan-hero-to-pro.md` §16.4 | HPX7 不再承担新 substrate 建设，只做 truth sync 与 last-mile follow-up | 若某项要求新增 substrate，则不属于 HPX7 |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| token bug 真实 owner file 漂移 | `re-planning` 把问题挂到 `reducer.ts`，但当前代码未直接呈现重复累计 | `medium` | 先 audit `reducer.ts → runner.ts → compact signal`；若超出 agent-core 边界则立即下放 PP2 |
| HPX6 R1 可能已被后续提交吸收 | 当前 `item-projection-plane.ts` 与测试已显示 7-kind list/read 支持 | `low` | verification-first；若无 gap，仅更新 tests / closure / verdict，不做重复 patch |
| `/runtime` route 合同变更会影响 client doc | 当前 route 仅 body `version`，新增 `ETag / If-Match` 会改变 public contract | `medium` | 保持现有 version law，不改 D1；仅提升 HTTP 层合同，并同步 `clients/api-docs/runtime.md` |
| closure uplift 误伤 owner-action retained | hero-to-pro final closure 仍有 4 项 owner-action retained | `low` | HPX7 只关闭 engineering retained；owner-action retained 原样保留并复写 remove condition |

### 7.2 约束与前提

- **技术前提**：不得引入新 D1 migration、新协议帧、新 NACP message_type、新 worker；所有修补必须限定在现有 schema / truth / route 之内。
- **运行时前提**：继续保持 6-worker topology 与现有 `@haimang/nacp-session` 合同；HPX7 不是 deploy topology 变更阶段。
- **组织协作前提**：HPX7 是 PP0 之前的 engineering cleanup；owner-action retained 不在本计划内。
- **上线 / 合并前提**：受影响 worker/package 测试、root `pnpm test`、`pnpm run check:docs-consistency` 通过后，closure verdict 才能 uplift。

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - 无（HPX7 只消费 `re-planning-by-opus.md` 与已有评审，不再开新的 design doc）
- 需要同步更新的说明文档 / README：
  - `clients/api-docs/runtime.md`（仅当 `ETag / If-Match` 进入 public contract）
- 需要同步更新的测试说明：
  - 受影响 worker/package 测试文件中的 case 名称与备注
  - `docs/issue/hero-to-pro/HPX7-closure.md` 中的测试矩阵

### 7.4 完成后的预期状态

1. `HP5-closure.md` 不再把 F12 写成“已闭合”，而是明确标为“dispatcher injected / live caller deferred to PP4”。
2. agent-core 侧最后 3 条 HPX7 seam（token accounting、tool cancel、attach race）要么被修掉，要么被精确重新归位到下阶段，不再含糊。
3. `/runtime` 的并发控制从内部 version law 升级为前端可依赖的 public optimistic lock 合同。
4. HPX6 R1/R2 不再以 review 口径漂着，而是按 current repo reality 显式 close。
5. `hero-to-pro-final-closure.md` 可合法升级到 `close-with-known-issues`，只保留 4 项 owner-action retained。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `pnpm --filter @haimang/agent-core-worker typecheck`
  - `pnpm --filter @haimang/orchestrator-core-worker typecheck`
  - `pnpm --filter @haimang/nacp-session build`
- **单元测试**：
  - `workers/agent-core/test/kernel/reducer.test.ts`
  - `workers/agent-core/test/host/runtime-mainline.test.ts`
  - `workers/orchestrator-core/test/runtime-config-plane.test.ts`
  - `workers/orchestrator-core/test/item-projection-plane.test.ts`
  - `packages/nacp-session/test/hp6-tool-cancelled.test.ts`
- **集成测试**：
  - `pnpm --filter @haimang/agent-core-worker test`
  - `pnpm --filter @haimang/orchestrator-core-worker test`
- **端到端 / 手动验证**：
  - 对 `/runtime` 的 `GET → capture ETag → PATCH with If-Match / stale If-Match` 走一轮 public contract 验证
  - 对 `cancel()` 与 attach race 的可观测行为做一轮手动 smoke
- **回归测试**：
  - `pnpm test`
- **文档校验**：
  - `pnpm run check:docs-consistency`
  - closure 文档之间 retained / closed / deferred 映射的人工对账

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. HPX7 六项都得到 explicit verdict，且没有超出 S1-S4 的 scope creep。
2. 受影响 worker/package 测试、root `pnpm test` 与 docs consistency 全部通过。
3. `HPX7-closure.md`、`HPX6-closure.md`、`hero-to-pro-final-closure.md` 的状态映射彼此一致。
4. hero-to-pro 阶段总 verdict 从 `partial-close / 7-retained` 升级为 `close-with-known-issues`，且 4 项 owner-action retained 保持显式。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | HPX7 的代码修补只覆盖 6 项窄范围工作；agent-core/orchestrator-core 的 live seam 与 residual follow-up 已收口 |
| 测试 | 受影响 worker/package 测试、root `pnpm test`、docs consistency 通过，且关键行为有定点测试支撑 |
| 文档 | HP5/HPX6/final closure 与 HPX7 closure 同步更新；必要时 `clients/api-docs/runtime.md` 同步新的 optimistic lock 合同 |
| 风险收敛 | token bug 与 item projection residual 均经过 verification-first 处理，不存在“旧 review 说有问题，所以硬做一轮”的虚假劳动 |
| 可交付性 | hero-to-pro 可以作为 PP0 的可信前序输入，PP0 不再需要额外为 HPX7 做 truth cleanup |

