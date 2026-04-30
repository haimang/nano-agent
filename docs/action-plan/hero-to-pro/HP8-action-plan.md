# Nano-Agent 行动计划 — HP8 Runtime Hardening + Chronic Closure

> 服务业务簇: `hero-to-pro / HP8`
> 计划对象: `把 R28/R29、heartbeat posture、megafile/tool/envelope drift 与 Lane E 终态统一压成可验证、可阻断漂移、可显式 handoff 的 runtime governance 层`
> 类型: `modify + scripts + runtime + docs + test`
> 作者: `Owner + GPT-5.4`
> 时间: `2026-04-30`
> 文件位置:
> - `package.json`
> - `scripts/check-megafile-budget.mjs`
> - `scripts/megafile-budget.json`
> - `scripts/check-tool-drift.mjs`
> - `scripts/check-envelope-drift.mjs`
> - `scripts/verify-initial-context-divergence.mjs`
> - `packages/nacp-core/src/messages/tool.ts`
> - `packages/nacp-core/src/tools/{tool-catalog.ts,bash/**,filesystem/**,workspace/**}`
> - `workers/agent-core/src/host/{runtime-mainline.ts,workspace-runtime.ts}`
> - `workers/agent-core/src/host/do/session-do/{ws-runtime.ts}`
> - `workers/agent-core/src/host/do/{session-do-runtime.ts,session-do-persistence.ts,nano-session-do.ts}`
> - `workers/bash-core/src/tool-call.ts`
> - `workers/filesystem-core/src/index.ts`
> - `workers/orchestrator-core/src/{index.ts,user-do.ts,user-do-runtime.ts,parity-bridge.ts}`
> - `docs/runbook/zx5-r28-investigation.md`
> - `docs/issue/zero-to-real/R29-postmortem.md`
> - `docs/architecture/lane-e-final-state.md`
> - `docs/issue/hero-to-pro/HP8-closure.md`
> - `test/cross-e2e/**`
> 上游前序 / closure:
> - `docs/action-plan/hero-to-pro/HP7-action-plan.md`
> - `docs/charter/plan-hero-to-pro.md` §7.9 HP8
> 下游交接:
> - `docs/action-plan/hero-to-pro/HP9-action-plan.md`
> 关联设计 / 调研文档:
> - `docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md`
> - `docs/design/hero-to-pro/HPX-qna.md`
> - `docs/runbook/zx5-r28-investigation.md`
> 冻结决策来源:
> - `docs/design/hero-to-pro/HPX-qna.md` Q25-Q28（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `draft`

---

## 0. 执行背景与目标

HP8 不是“顺手做几条脚本”或“补一份 closure memo”的轻量善后，而是 hero-to-pro 进入后段封板前的治理闸口：如果 R28/R29/Lane E 仍以 runbook 模板、历史命名残影和口头共识存在，HP9 的接口文档冻结与 HP10 的阶段总 closure 就只能建立在漂移中的现实之上。当前仓库已经具备 alarm-driven Session DO、部分 megafile seam split、`nacp-core` canonical tool schema、`FacadeEnvelope` 公共外形，但这些骨架还没有被压成“脚本 gate + runtime posture + explicit register”三件套。

因此 HP8 的任务，是把慢性问题与运行时硬化压成明确规则：R28 必须显式定位或显式 handoff，R29 必须经真实 diff/postmortem 判定，heartbeat 必须从“代码里已有”升级成“平台姿态已验证”，megafile/tool/envelope drift 必须进入 root gate，Lane E 必须从 shim 口径进入 `closed` 或 `retained-with-reason` 二选一。这里不重新讨论方向，而是消费已冻结的 Q25-Q28：**megafile gate 盯当前 owner 文件、tool catalog 落在 `nacp-core`、envelope cleanup 只清 public surface、R28/R29/Lane E 允许 retained/handoff 但绝不允许 silent unresolved**。

- **服务业务簇**：`hero-to-pro / HP8`
- **计划对象**：`hero-to-pro 的 runtime governance / chronic closure 系统`
- **本次计划解决的问题**：
  - R28/R29/Lane E 仍停留在 runbook / 注释 / 临时判断，缺少 explicit register 与 closure 法则。
  - Session DO heartbeat、megafile split、tool schema、envelope 分层都已有局部骨架，但还没进入 root-level drift gate。
  - HP8 charter 早期 wording 仍带有历史 owner 文件阈值；当前执行必须改以 Q25 冻结后的“真实 owner + stop-the-bleed”口径为准。
- **本次计划的直接产出**：
  - R28 runbook 回填入口、R29 verifier + postmortem、Lane E final-state 文档与 HP8 chronic register。
  - heartbeat 4-scenario e2e、megafile/tool/envelope drift 三类 root gate、`package.json` 集成。
  - `nacp-core` tool catalog 单源、agent-core/bash-core consumer 收敛、HP8 closure 与 HP9 gate verdict。
- **本计划不重新讨论的设计结论**：
  - megafile gate 只针对当前真实 owner 文件，且使用 `scripts/megafile-budget.json` 的 stop-the-bleed 阈值（来源：`docs/design/hero-to-pro/HPX-qna.md` Q25）。
  - tool catalog 单一真相源固定落在 `nacp-core`，并按 capability owner 分目录维护（来源：`docs/design/hero-to-pro/HPX-qna.md` Q26）。
  - envelope cleanup 只针对 public HTTP surface；internal RPC 继续允许 `Envelope<T>` / `AuthEnvelope<T>`（来源：`docs/design/hero-to-pro/HPX-qna.md` Q27）。
  - R28 / R29 / Lane E 允许 `retained-with-reason` / `handed-to-platform` 作为合法终态，但缺任一显式字段就视为 unresolved（来源：`docs/design/hero-to-pro/HPX-qna.md` Q28）。

---

## 1. 执行综述

### 1.1 总体执行方式

HP8 采用**先现实取证与 chronic register → 再固化 heartbeat posture → 再接 root drift gates → 最后收敛 tool/envelope/Lane E 并写 closure** 的顺序。先把“现在到底还有什么、哪些是历史名词漂移、哪些是真残余”钉死，才能避免脚本 gate 和 cleanup 决议继续围着旧名字打转；而把 closure 放在最后，则能确保 HP9 读取到的是完整的 runtime governance verdict，而不是半截中的施工状态。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Chronic Register + Reality Baseline | M | 建立 R28/R29/Lane E 的 explicit register 与现实基线 | `-` |
| Phase 2 | Heartbeat Posture + 4-Scenario E2E | M | 把 DO heartbeat/alarm 提升成正式 platform posture | Phase 1 |
| Phase 3 | Stop-the-Bleed Gates | M | 把 megafile/tool/envelope drift 纳入 root gate | Phase 1-2 |
| Phase 4 | Tool Catalog + Envelope/Lane E Cleanup | M | 收敛 tool contract、public envelope 与 Lane E 终态文档 | Phase 1-3 |
| Phase 5 | Closure + HP9 Freeze Gate | S | 用 explicit register + gate 结果完成 HP8 closure | Phase 1-4 |

### 1.3 Phase 说明

1. **Phase 1 — Chronic Register + Reality Baseline**
   - **核心目标**：把 R28/R29/Lane E 从“大家都知道有这些事”升级为可引用的显式 register。
   - **为什么先做**：没有 reality baseline，后面所有 gate 和 cleanup 都可能继续盯错对象。
2. **Phase 2 — Heartbeat Posture + 4-Scenario E2E**
   - **核心目标**：确认 alarm-driven heartbeat 的唯一主线，并以真实异常断连场景证明它。
   - **为什么放在这里**：heartbeat posture 是 HP8 最直接的 runtime hardening 事项，且要在 closure 前成为已验证事实。
3. **Phase 3 — Stop-the-Bleed Gates**
   - **核心目标**：建立 megafile/tool/envelope 三类 drift guard，并接到 root script。
   - **为什么放在这里**：gate 必须建立在已确认的 reality baseline 和 runtime posture 之上，避免脚本一开始就盯错对象。
4. **Phase 4 — Tool Catalog + Envelope/Lane E Cleanup**
   - **核心目标**：完成 tool contract 单源、public envelope cleanup 与 Lane E 二选一终态文件。
   - **为什么放在这里**：catalog / envelope / Lane E 的收口都需要前面 gate 和 register 已存在，才能避免再次漂移。
5. **Phase 5 — Closure + HP9 Freeze Gate**
   - **核心目标**：形成 HP8 closure，并明确 HP9 是否获得文档冻结许可。
   - **为什么最后**：只有 chronic、runtime、gate、cleanup 四层都完成，closure 才有意义。

### 1.4 执行策略说明

- **执行顺序原则**：先 reality baseline，再 runtime posture，再 gate，最后 cleanup / closure；先写 law，再删改 residue。
- **风险控制原则**：不再沿用历史 megafile 名称；任何 retained 项都必须带 scope / reason / remove condition / owner；R28/R29 不允许“看起来好了”。
- **测试推进原则**：以 root gate + worker regression + 4-scenario cross-e2e 三层并行推进；脚本 gate 必须先能本地跑、再接 package script。
- **文档同步原则**：runbook、postmortem、lane-e final-state、HP8 closure 四份文档必须形成互链，不能散落在评论或临时记录里。
- **回滚 / 降级原则**：HP8 不因 cleanup 追求“全删光”；若删改风险高，则走 `retained-with-reason` 或 `handed-to-platform`，但绝不 silent。

### 1.5 本次 action-plan 影响结构图

```text
hero-to-pro HP8 runtime hardening
├── Phase 1: Chronic Register + Reality Baseline
│   ├── R28 runbook backfill path
│   ├── R29 verifier + postmortem
│   └── Lane E current-state audit
├── Phase 2: Heartbeat Posture + 4-Scenario E2E
│   ├── Session DO alarm/heartbeat law
│   └── abnormal disconnect / resume matrix
├── Phase 3: Stop-the-Bleed Gates
│   ├── megafile budget config + script
│   ├── tool drift guard
│   └── envelope drift guard
├── Phase 4: Tool Catalog + Envelope/Lane E Cleanup
│   ├── nacp-core tool catalog
│   ├── public FacadeEnvelope cleanup
│   └── lane-e-final-state.md
└── Phase 5: Closure + HP9 Freeze Gate
    ├── docs/issue/hero-to-pro/HP8-closure.md
    └── HP9 documentation freeze verdict
```

### 1.6 已核对的当前代码锚点

1. **root pipeline 现在还没有 HP8 需要的 megafile/tool/envelope gate**
   - `package.json:7-17`
   - 当前只有 `check:cycles` 与 `check:observability-drift`，还没有 `check:megafile-budget` / `check:tool-drift` / `check:envelope-drift`。
2. **Session DO 已经以 `alarm()` 驱动 health-check / checkpoint / deferred sweep，但这仍只是 runtime seam**
   - `workers/agent-core/src/host/do/session-do-runtime.ts:583-599`
   - `workers/agent-core/src/host/do/session-do/ws-runtime.ts:197-235,262-271`
   - `session.resume` 仍只理解 `last_seen_seq`，heartbeat 也只是 helper 行为，还没有 phase-level posture 与 4-scenario 证据。
3. **megafile split 已部分完成，历史大文件名已经不能代表当前 owner reality**
   - `workers/agent-core/src/host/do/session-do-persistence.ts:1-12`
   - `workers/agent-core/src/host/do/nano-session-do.ts:1-8`
   - `workers/orchestrator-core/src/user-do.ts:1-9`
   - `workers/orchestrator-core/src/user-do-runtime.ts:1-15,1141-1171`
4. **tool contract 仍然在协议层、caller、callee 三处并存**
   - `packages/nacp-core/src/messages/tool.ts:4-36`
   - `workers/bash-core/src/tool-call.ts:20-36,70-87`
   - `workers/agent-core/src/host/runtime-mainline.ts:383-405`
   - 当前 `nacp-core` 有 canonical schema，但 bash-core 和 agent-core 仍保留镜像接口/手写 payload。
5. **Lane E 仍有 host-local residue；filesystem-core 公开的 RPC 仍只有 artifact 三件套**
   - `workers/agent-core/src/host/workspace-runtime.ts:20-35,75-100`
   - `workers/filesystem-core/src/index.ts:83-125`
6. **public envelope 的确已经存在，但仍需显式校验 public route 不再 re-emit internal envelope**
   - `workers/orchestrator-core/src/index.ts:1844-1899`
   - `packages/nacp-core/src/rpc.ts:104-150`
   - `packages/orchestrator-auth-contract/src/index.ts:235-255`
   - `packages/orchestrator-auth-contract/src/facade-http.ts:120-170`
7. **R28 现在仍只是 owner-action 模板，尚未进入 closure 结论**
   - `docs/runbook/zx5-r28-investigation.md:1-7,32-41,100-141`

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** R28 / R29 / Lane E explicit register 与对应 artifact（runbook / postmortem / final-state）。
- **[S2]** alarm-driven heartbeat 的正式 runtime posture 与 4-scenario cross-e2e。
- **[S3]** `scripts/megafile-budget.json` + `check-megafile-budget.mjs` + tool/envelope drift guards。
- **[S4]** `nacp-core` tool catalog 单源、agent-core/bash-core consumer 收敛。
- **[S5]** public-only envelope cleanup、Lane E `closed`/`retained-with-reason` 二选一文档化。
- **[S6]** `docs/issue/hero-to-pro/HP8-closure.md` 与 HP9 documentation freeze gate。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** `clients/api-docs/` 内容重写与对外交付包。
- **[O2]** manual evidence pack 与 prod schema baseline。
- **[O3]** 新的产品 API / 新状态机。
- **[O4]** hero-to-platform 的正式 charter / action-plan。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| megafile gate 继续盯 `nano-session-do.ts` / `user-do.ts` | `out-of-scope` | Q25 已冻结为当前 owner 文件；wrapper 文件不能继续充当治理对象 | 仅在 repo reality 再次拆分后下调阈值 |
| internal RPC envelope 统一改成 FacadeEnvelope | `out-of-scope` | Q27 已冻结 public-only cleanup，internal `Envelope<T>` / `AuthEnvelope<T>` 保持分层 | 不重评 |
| R28 / R29 必须在 HP8 全部代码根治 | `defer` | Q28 允许 retained/handoff，但必须 explicit | HP10 final closure / hero-to-platform |
| Lane E 必须立即物理删除全部 host-local residue | `defer` | 设计允许 `retained-with-reason` 路径；核心是终态二选一，而非强行删光 | 若 R28 / platform-fit 结论变化时重评 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | chronic register baseline | `update` | runbook / postmortem / lane-e docs | 把 R28/R29/Lane E 压成显式 register | `high` |
| P1-02 | Phase 1 | R29 verifier + verdict skeleton | `add` | `scripts/verify-initial-context-divergence.mjs` + docs | 给 R29 三选一判定建立真实输入 | `high` |
| P2-01 | Phase 2 | heartbeat posture hardening | `update` | agent-core DO runtime | 固定 alarm-driven heartbeat 顺序与行为 law | `medium` |
| P2-02 | Phase 2 | abnormal disconnect 4-scenario e2e | `add` | `test/cross-e2e/**` | 用真实链路证明 heartbeat posture | `medium` |
| P3-01 | Phase 3 | megafile budget gate | `add` | `scripts/megafile-budget.json`, `check-megafile-budget.mjs`, `package.json` | 让大文件只减不增 | `medium` |
| P3-02 | Phase 3 | tool/envelope drift guards | `add` | root scripts + package.json | 把 contract drift 变成 CI 失败而不是 review 口头提醒 | `medium` |
| P4-01 | Phase 4 | tool catalog SSoT | `update` | `packages/nacp-core/src/tools/**`, agent-core, bash-core | 让 tool schema / description / owner 第一次单源 | `high` |
| P4-02 | Phase 4 | public envelope cleanup | `update` | orchestrator-core + auth contract | 让 public surface 统一回到 `FacadeEnvelope` | `medium` |
| P4-03 | Phase 4 | Lane E final-state decision | `update` | `docs/architecture/lane-e-final-state.md` + related residues | 把 Lane E 从 shim 口径收束到 closed/retained 二选一 | `high` |
| P5-01 | Phase 5 | HP8 closure | `update` | `docs/issue/hero-to-pro/HP8-closure.md` | 让 HP9 能直接消费 HP8 verdict | `low` |
| P5-02 | Phase 5 | HP9 freeze gate verdict | `update` | HP8 closure + charter traceability | 明确 HP9 是否得到 documentation freeze 许可 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Chronic Register + Reality Baseline

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | chronic register baseline | 为 R28、R29、Lane E 建立统一 register，明确每项至少要有 `closed / retained-with-reason / handed-to-platform` 之一，并补足 artifact 链接 | `docs/runbook/zx5-r28-investigation.md`, `docs/issue/zero-to-real/R29-postmortem.md`, `docs/architecture/lane-e-final-state.md` | chronic issue 不再停留在聊天或注释里 | doc review + grep/assert | 三项 chronic 都有唯一 authoritative artifact |
| P1-02 | R29 verifier + verdict skeleton | 编写 preview verifier，跑真实 session diff，给 `zero diff / diff found / unverifiable` 三选一提供输入证据 | `scripts/verify-initial-context-divergence.mjs`, `docs/issue/zero-to-real/R29-postmortem.md` | R29 第一次拥有程序化输入而不是主观判断 | preview smoke + script tests | postmortem 能明确落到三选一，不再写“看起来已消失” |

### 4.2 Phase 2 — Heartbeat Posture + 4-Scenario E2E

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | heartbeat posture hardening | 固定 `alarm()` 与 `persistCheckpoint()` / `sweepDeferredAnswers()` / helper restore 的顺序，明确 DO `alarm()` 为唯一 heartbeat 主线 | `workers/agent-core/src/host/do/session-do-runtime.ts`, `workers/agent-core/src/host/do/session-do/ws-runtime.ts`, `workers/agent-core/src/host/do/session-do-persistence.ts` | heartbeat 从 seam 升级为被规则化的平台姿态 | agent-core tests | alarm 主线唯一且顺序稳定，不回退 attachment-lifetime timer |
| P2-02 | abnormal disconnect 4-scenario e2e | 覆盖正常 heartbeat、heartbeat 丢失后 close+checkpoint、reconnect/resume、deferred sweep 共存四类场景 | `test/cross-e2e/**` | HP8 有真实 runtime 证据，不只依赖 unit tests | `pnpm test:cross-e2e` | 4 个场景全绿，且 trace / checkpoint / close 行为一致 |

### 4.3 Phase 3 — Stop-the-Bleed Gates

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | megafile budget gate | 以 `scripts/megafile-budget.json` 冻结当前 owner ceilings，新增 `check-megafile-budget.mjs` 并接入 root script | `package.json`, `scripts/megafile-budget.json`, `scripts/check-megafile-budget.mjs` | 大文件增长第一次被根脚本阻断 | script smoke | 当前 owner 文件受控，阈值只允许下调不允许上调 |
| P3-02 | tool/envelope drift guards | 新增 `check-tool-drift.mjs` / `check-envelope-drift.mjs`，前者查 schema/payload drift，后者基于 public route enumeration 查 public envelope 漂移 | `package.json`, `scripts/check-tool-drift.mjs`, `scripts/check-envelope-drift.mjs` | contract drift 从 review 口头提醒变成脚本失败 | script smoke + grep/assert | duplicated tool literals 与 public route internal-envelope 漂移都能被拦下 |

### 4.4 Phase 4 — Tool Catalog + Envelope/Lane E Cleanup

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | tool catalog SSoT | 在 `nacp-core` 建立按 capability owner 分目录的 tool catalog，并让 message schema / bash-core / agent-core 都向其收敛 | `packages/nacp-core/src/tools/**`, `packages/nacp-core/src/messages/tool.ts`, `workers/bash-core/src/tool-call.ts`, `workers/agent-core/src/host/runtime-mainline.ts` | tool contract 第一次具备单源 | package tests + drift guard | caller/callee 不再保留第二份镜像类型作为事实来源 |
| P4-02 | public envelope cleanup | 枚举 orchestrator-core public routes，验证 public path 只对外输出 `FacadeEnvelope`；legacy DO ack 继续作为兼容例外显式保留 | `workers/orchestrator-core/src/index.ts`, `packages/orchestrator-auth-contract/src/facade-http.ts` | public contract 与 internal RPC 分层第一次被明确执行 | route tests + envelope drift guard | 对外不再直出 internal envelope 形状 |
| P4-03 | Lane E final-state decision | 结合 R28 结果与当前 residue reality，写 `lane-e-final-state.md`，明确 `closed` 或 `retained-with-reason` | `docs/architecture/lane-e-final-state.md`, `workers/agent-core/src/host/workspace-runtime.ts`, `workers/filesystem-core/src/index.ts` | Lane E 从 shim 口径变为正式结论 | doc review + grep/assert | 不再出现“暂时 shim、未来再说”的模糊表述 |

### 4.5 Phase 5 — Closure + HP9 Freeze Gate

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | HP8 closure | 回填 chronic register、heartbeat verdict、gates verdict、tool/envelope/Lane E verdict | `docs/issue/hero-to-pro/HP8-closure.md` | HP8 可以独立回答“哪些已关、哪些保留、哪些移交” | doc review | closure 不包含 silent unresolved |
| P5-02 | HP9 freeze gate verdict | 明确 HP9 是否可启动，以及若不可启动时卡在哪个 gate | HP8 closure + charter traceability | HP9 文档工作不再抢跑代码冻结 | gate checklist | 只有 HP8 关键 gate 齐全时，HP9 才被标记为可执行 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Chronic Register + Reality Baseline

- **Phase 目标**：把 R28 / R29 / Lane E 从历史 carryover 变成有唯一 artifact 的显式 register。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 新增文件**：
  - `scripts/verify-initial-context-divergence.mjs`
  - `docs/issue/zero-to-real/R29-postmortem.md`（若当前不存在则新建）
  - `docs/architecture/lane-e-final-state.md`
- **本 Phase 修改文件**：
  - `docs/runbook/zx5-r28-investigation.md`
- **本 Phase 已核对的源码锚点**：
  - `docs/runbook/zx5-r28-investigation.md:32-41,100-141`
  - `workers/agent-core/src/host/workspace-runtime.ts:20-35,75-100`
  - `workers/filesystem-core/src/index.ts:83-125`
- **具体功能预期**：
  1. R28 至少回填 stack source、root cause class、chosen branch。
  2. R29 至少能落到 `zero diff / diff found / unverifiable` 三选一。
  3. Lane E 至少能落到 `closed` 或 `retained-with-reason`，且 retained 必须说明 scope / risk / remove condition。
- **具体测试安排**：
  - **单测**：R29 verifier 的 script-level fixtures。
  - **集成测试**：preview verifier 与 postmortem 文档对照。
  - **回归测试**：
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
  - **手动验证**：owner 侧 wrangler tail / preview probe 回填 runbook。
- **收口标准**：
  - R28 / R29 / Lane E 三项都有唯一 authoritative artifact。
  - 不再出现“silently fixed”“看起来没问题”这类 closure 口径。
- **本 Phase 风险提醒**：
  - R28 与 prod/preview 环境强绑定，owner 若不配合只能进入 explicit handoff，不能装作已关闭。

### 5.2 Phase 2 — Heartbeat Posture + 4-Scenario E2E

- **Phase 目标**：把 Session DO heartbeat 从“已有实现细节”升级为“已验证的平台姿态”。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 修改文件**：
  - `workers/agent-core/src/host/do/session-do-runtime.ts`
  - `workers/agent-core/src/host/do/session-do/ws-runtime.ts`
  - `workers/agent-core/src/host/do/session-do-persistence.ts`
  - `test/cross-e2e/**`
- **本 Phase 已核对的源码锚点**：
  - `workers/agent-core/src/host/do/session-do-runtime.ts:583-599,620-658`
  - `workers/agent-core/src/host/do/session-do/ws-runtime.ts:197-235,243-271`
  - `workers/agent-core/src/host/do/session-do-persistence.ts:1-12`
- **具体功能预期**：
  1. `alarm()` 继续作为 heartbeat / checkpoint / deferred sweep 唯一主线。
  2. helper restore、checkpoint 持久化、deferred sweep 的调用顺序被固定并文档化。
  3. abnormal disconnect 与 reconnect/resume 不再只靠单测假设成立。
- **具体测试安排**：
  - **单测**：heartbeat helper / persistence order tests。
  - **集成测试**：DO lifecycle + helper restore + checkpoint interaction。
  - **回归测试**：
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
    - `pnpm test:cross-e2e`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - 4-scenario e2e 全绿。
  - 不再出现 attachment timer 与 alarm 双主线并存。
- **本 Phase 风险提醒**：
  - 若只改代码不补 e2e，HP8 仍无法证明 heartbeat 是 platform posture 而非偶然实现。

### 5.3 Phase 3 — Stop-the-Bleed Gates

- **Phase 目标**：把 megafile/tool/envelope 漂移压进 root gate。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `scripts/megafile-budget.json`
  - `scripts/check-megafile-budget.mjs`
  - `scripts/check-tool-drift.mjs`
  - `scripts/check-envelope-drift.mjs`
- **本 Phase 修改文件**：
  - `package.json`
- **本 Phase 已核对的源码锚点**：
  - `package.json:7-17`
  - `workers/orchestrator-core/src/user-do-runtime.ts:1141-1171`
  - `workers/orchestrator-core/src/index.ts:1844-1899`
  - `workers/agent-core/src/host/do/session-do-runtime.ts:720-737`
- **具体功能预期**：
  1. megafile gate 改盯当前 owner 文件，而不是历史 megafile 名称。
  2. tool drift guard 能发现 duplicated schema literal、payload drift、capability name mismatch。
  3. envelope drift guard 能以 public route enumeration 为 scope，验证 public surface 只输出 `FacadeEnvelope` 或已声明的 legacy ack 例外。
- **具体测试安排**：
  - **单测**：script fixture tests。
  - **集成测试**：root script 对真实仓树运行。
  - **回归测试**：
    - `node scripts/check-megafile-budget.mjs`
    - `node scripts/check-tool-drift.mjs`
    - `node scripts/check-envelope-drift.mjs`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - `package.json` 暴露 3 条新 check。
  - gate 可以稳定失败在真正的漂移点上，而不是误报 wrapper/非 public 文件。
- **本 Phase 风险提醒**：
  - 若脚本 scope 没钉死，很容易把 current owner / public route law 写成另一种 drift 源。

### 5.4 Phase 4 — Tool Catalog + Envelope/Lane E Cleanup

- **Phase 目标**：完成 contract 单源、public envelope 清理与 Lane E 终态定稿。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
  - `P4-03`
- **本 Phase 新增文件**：
  - `packages/nacp-core/src/tools/tool-catalog.ts`
  - `packages/nacp-core/src/tools/bash/**`
  - `packages/nacp-core/src/tools/filesystem/**`
  - `packages/nacp-core/src/tools/workspace/**`
- **本 Phase 修改文件**：
  - `packages/nacp-core/src/messages/tool.ts`
  - `workers/bash-core/src/tool-call.ts`
  - `workers/agent-core/src/host/runtime-mainline.ts`
  - `workers/orchestrator-core/src/index.ts`
  - `docs/architecture/lane-e-final-state.md`
- **本 Phase 已核对的源码锚点**：
  - `packages/nacp-core/src/messages/tool.ts:4-36`
  - `workers/bash-core/src/tool-call.ts:20-36,70-87`
  - `workers/agent-core/src/host/runtime-mainline.ts:383-405`
  - `packages/nacp-core/src/rpc.ts:104-150`
  - `packages/orchestrator-auth-contract/src/facade-http.ts:128-170`
  - `workers/orchestrator-core/src/index.ts:1864-1899`
- **具体功能预期**：
  1. tool request/response/cancel schema、description、owner、binding 名称都由 catalog 驱动。
  2. public HTTP routes 统一回到 `FacadeEnvelope`；legacy DO ack 仅作为显式兼容面存在。
  3. Lane E 的最终说明会明确是 `closed` 还是 `retained-with-reason`，不再使用“short-term shim”口径。
- **具体测试安排**：
  - **单测**：catalog derivation tests、envelope grep/assert tests。
  - **集成测试**：agent-core ↔ bash-core tool call 真实路径。
  - **回归测试**：
    - `pnpm --filter @haimang/nacp-core typecheck build test`
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
    - `pnpm --filter @haimang/bash-core-worker typecheck build test`
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
  - **手动验证**：lane-e final-state 文档与 code reality 对照。
- **收口标准**：
  - agent-core/bash-core 不再维持第二份 tool contract 镜像。
  - public route 不再无意透出 internal envelope 形状。
  - Lane E 二选一终态已成文。
- **本 Phase 风险提醒**：
  - 若只新建 catalog 不迁 consumer，SSoT 仍只是“又一份定义文件”。

### 5.5 Phase 5 — Closure + HP9 Freeze Gate

- **Phase 目标**：完成 HP8 closure，并为 HP9 写出严格的启动条件。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 修改文件**：
  - `docs/issue/hero-to-pro/HP8-closure.md`
- **具体功能预期**：
  1. HP8 closure 能独立回答 chronic、heartbeat、gates、tool catalog、envelope、Lane E 六层 verdict。
  2. HP9 是否可启动由 HP8 closure 显式判断，而不是靠口头“差不多可以写文档了”。
- **具体测试安排**：
  - **单测**：无新增单测为主。
  - **集成测试**：读取 gate 结果与 closure 对照。
  - **回归测试**：
    - `pnpm test:cross-e2e`
    - `pnpm --filter @haimang/nacp-core typecheck build test`
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
    - `pnpm --filter @haimang/bash-core-worker typecheck build test`
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
  - **手动验证**：closure checklist 对照。
- **收口标准**：
  - HP8 closure 不含 silent unresolved。
  - HP9 freeze gate 给出 clear pass/fail。
- **本 Phase 风险提醒**：
  - 若 closure 只写完成项不写 retained/handoff，HP10 仍会失去可靠输入。

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q25 — megafile gate 盯当前 owner，预算配置外置为 JSON | `docs/design/hero-to-pro/HPX-qna.md` | 决定 HP8 用 `scripts/megafile-budget.json` 管理 stop-the-bleed ceilings，不再围绕历史文件名写 gate | 若要回到历史文件名或硬编码阈值，必须重开 QNA |
| Q26 — tool catalog 落在 `nacp-core` 且按 capability owner 分目录 | `docs/design/hero-to-pro/HPX-qna.md` | 决定 catalog 由协议层持有，agent-core/bash-core 只能向其收敛 | 若要在 worker 层再建第二真相源，必须退回 design |
| Q27 — envelope cleanup 只针对 public HTTP surface | `docs/design/hero-to-pro/HPX-qna.md` | 决定 `check-envelope-drift` 只枚举 public route，不误伤 internal RPC envelope | 若想统一 internal envelope，需新 phase 重新论证 |
| Q28 — chronic issue 允许 retained/handoff，但必须 explicit | `docs/design/hero-to-pro/HPX-qna.md` | 决定 HP8 closure 合法接受 retained/handoff，同时要求字段齐全 | 若 owner 想回到 silent unresolved，HP8 直接不能 closure |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| owner-action 依赖 | R28 runbook 与部分 preview/prod 证据需要 owner 执行 | `high` | 允许 explicit handoff，但必须写清原因与下一阶段去向 |
| reality snapshot 漂移 | HP8 执行期间 owner files 可能继续拆分 | `medium` | 以 Q25 的 current-owner baseline 建 gate；变更后只允许下调阈值 |
| catalog 落地半程化 | 只建 catalog，不迁 consumer | `high` | P4-01 和 P4-02 必须一起 closure；drift guard 反向检查 consumer |
| envelope cleanup 误伤 internal RPC | 未区分 public/internal scope | `medium` | 以 orchestrator-core public route enumeration 作为唯一 scope |
| Lane E 终态受 R28 牵引 | 若 R28 无法定因，Lane E 可能只能 retained | `medium` | 接受 retained-with-reason，但禁止继续称为 shim |

### 7.2 约束与前提

- **技术前提**：Session DO 继续使用 classic DO storage + alarm；不引入 SQLite-backed DO，不新增 worker。
- **运行时前提**：public facade 仍由 orchestrator-core 统一对外；internal RPC transport layering 不在 HP8 内推翻。
- **组织协作前提**：R28 / prod 环境相关信息只能由 owner/ops 回填，执行者不得凭空伪造现场结论。
- **上线 / 合并前提**：chronic artifact、heartbeat e2e、三类 root gate、tool catalog 迁移、Lane E final-state、HP8 closure 六层证据齐全。

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/hero-to-pro/HP9-api-docs-and-manual-evidence.md`（回填 HP9 freeze gate 输入）
  - `docs/design/hero-to-pro/HP10-final-closure-and-cleanup.md`（回填 retained/handoff 输入）
- 需要同步更新的说明文档 / README：
  - `docs/issue/hero-to-pro/HP8-closure.md`
  - `docs/architecture/lane-e-final-state.md`
  - `docs/issue/zero-to-real/R29-postmortem.md`
- 需要同步更新的测试说明：
  - `test/index.md` 或 cross-e2e 说明（若 heartbeat 4-scenario 成为固定 gate）

### 7.4 完成后的预期状态

1. HP8 之后，慢性问题只能以 `closed / retained-with-reason / handed-to-platform` 显式存在。
2. Session DO heartbeat 会第一次拥有 platform posture 级别的证据，而不再只是代码实现细节。
3. root pipeline 会第一次对 megafile/tool/envelope 三类 drift 提供硬闸。
4. HP9 能在 freeze 代码事实之上写文档，而不是继续追着 runtime 变化跑。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - 检查 `package.json` 已接入 `check:megafile-budget` / `check:tool-drift` / `check:envelope-drift`。
  - 检查 `docs/runbook/zx5-r28-investigation.md`、`docs/issue/zero-to-real/R29-postmortem.md`、`docs/architecture/lane-e-final-state.md` 三件套存在且互链。
  - 检查 `packages/nacp-core/src/tools/**` 已成为 tool contract 单源。
- **单元测试**：
  - `pnpm --filter @haimang/nacp-core typecheck build test`
  - `pnpm --filter @haimang/agent-core-worker typecheck build test`
  - `pnpm --filter @haimang/bash-core-worker typecheck build test`
  - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
- **集成测试**：
  - tool catalog consumer migration、public envelope asserts、R29 verifier script
- **端到端 / 手动验证**：
  - `pnpm test:cross-e2e`
  - owner 侧 wrangler tail / preview verification 回填
- **回归测试**：
  - heartbeat 4-scenario
  - megafile/tool/envelope drift scripts
  - tool call roundtrip 不回归
- **文档校验**：
  - `docs/issue/hero-to-pro/HP8-closure.md` 必须同时记录 chronic / heartbeat / gates / tool catalog / envelope / Lane E 六层 verdict

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. R28 / R29 / Lane E 三项 chronic 都已有唯一 authoritative artifact，且无 silent unresolved。
2. DO heartbeat alarm 主线已被 4-scenario e2e 证明，不再只是代码实现细节。
3. megafile/tool/envelope 三类 root gate 已 live，并能阻断真实 drift。
4. `nacp-core` tool catalog 已成为单源；agent-core / bash-core 已迁 consumer。
5. Lane E 已显式落到 `closed` 或 `retained-with-reason`。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | chronic register、heartbeat posture、root gates、tool catalog、public envelope cleanup、Lane E final-state 全部闭环 |
| 测试 | `nacp-core`、agent-core、bash-core、orchestrator-core 测试通过；`pnpm test:cross-e2e` 覆盖 heartbeat 4-scenario |
| 文档 | HP8 closure 能独立解释 chronic/runtime/governance 六层结果 |
| 风险收敛 | 不再以历史 megafile 名称治理、不再保留 tool 镜像真相源、不再存在 silent chronic carryover |
| 可交付性 | HP9 可以在 HP8 freeze gate 之上开始 18 份 docs、manual evidence 与 prod baseline 的收口 |
