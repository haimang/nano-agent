# P0 Absorption Prep — Closure Memo

> 功能簇: `worker-matrix / Phase 0 — Absorption Prep`
> 讨论日期: `2026-04-23`
> 作者: `Claude Opus 4.7 (1M context)`
> 关联 action-plan: `docs/action-plan/worker-matrix/P0-absorption-prep.md`
> 文档状态: `closed(2026-04-23 由 Claude 使用本地预授权的 wrangler OAuth 完成 F6 deploy 后,owner 决策 5 子项已批准默认建议值;E3/E6 已勾绿)`

---

## 0. 背景

P0 Absorption Prep 的目的是 **在 P1 开工前,把 "缺 detailed blueprint / 缺 P2.E0 owner 决策 / 缺 D01-D09 R1-R5 吸收索引" 三件 design-only 欠账压实**,并在 P0 落盘一份 closure memo 作为 P1 kickoff 的 single source of truth。

P0 本阶段零代码改动;全部产出都是 markdown。覆盖:

- Phase 1:3 份 pre-worker-matrix 代表 blueprint 的 reality-check(§7/§8/§9 worker-matrix 消费要点)
- Phase 2:8 份新增文件(6 份 A2/A3/A4/A5/C1/D2 P0 补齐 blueprint + 1 份 A1-A5 sub-PR 切分建议 + 1 份 blueprints-index)
- Phase 3:本 memo §3 P2.E0 owner 决策 + §4 P1.A / P1.B kickoff checklist
- Phase 4:本 memo §5 D01-D09 R1-R5 吸收索引 + charter / handoff 索引同步 + §6 exit criteria

---

## 1. P0 已交付内容清单

### 1.1 Phase 1 — 代表 blueprint reality check(patch only,不改结构)

| blueprint | 补充章节 | 核心 fact-anchor |
|-----------|----------|------------------|
| `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md` | §5.1 + §8.1 | `@haimang/nacp-core@1.4.0` / `@haimang/nacp-session@1.3.0`(W2 shipped);D02 F6 real preview deploy 为 P2.E0 硬前置;D02 R3 binding-first `/capability/call`+`/capability/cancel`;workspace substrate 共存期保留 `@nano-agent/workspace-context-artifacts` |
| `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md` | §7 | A1 host shell 落点 `workers/agent-core/src/host/do/nano-session-do.ts`;D05 R1 consumer 读 `composition?.workspace?.assembler`;D05 R2 wire truth = `session.start.body.initial_input`;host shell 依赖 `@haimang/nacp-core/nacp-session`+`@nano-agent/workspace-context-artifacts` coexist 期 |
| `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md` | §9 | mixed helper 表落 D03 §7 F3 / D04 §4 D1 slice;`appendInitialContextLayer` 归 context-core helper(R1 口径 — 不扩 assembler API / 不发明 initial_context kind);D04 D1 slice 对 `@nano-agent/storage-topology` 的依赖在 D2 同批搬 |

### 1.2 Phase 2 — 8 份 blueprint 新建

| 文件 | unit | LOC |
|------|------|-----|
| `docs/design/worker-matrix/blueprints/A2-agent-runtime-kernel-absorption-blueprint.md` | A2 | 202 |
| `docs/design/worker-matrix/blueprints/A3-llm-wrapper-absorption-blueprint.md` | A3 | 209 |
| `docs/design/worker-matrix/blueprints/A4-hooks-residual-absorption-blueprint.md` | A4 | 222 |
| `docs/design/worker-matrix/blueprints/A5-eval-observability-residual-absorption-blueprint.md` | A5 | 233 |
| `docs/design/worker-matrix/blueprints/C1-context-management-absorption-blueprint.md` | C1 | 223 |
| `docs/design/worker-matrix/blueprints/D2-storage-topology-residual-absorption-blueprint.md` | D2 | 218 |
| `docs/design/worker-matrix/blueprints/A1-A5-sub-pr-granularity.md` | A1-A5 切分建议 | 192 |
| `docs/design/worker-matrix/blueprints/blueprints-index.md` | 10 units 映射 index | 79 |

- 合计 8 文件 / ~1578 行
- 每份 absorption blueprint 覆盖 §源目录 / §目标目录 / §文件映射表 / §dep 处理 / §测试迁移 / §风险 / §LOC 估算 / §verdict 8 要素
- index 覆盖 10 units(A1-A5 / B1 / C1-C2 / D1-D2)× blueprint link + 来源属性(代表 3 份 + P0 补齐 6 份 + 切分建议 1 份)

### 1.3 blueprint 覆盖 10 units 验证

| unit | blueprint 源 | 存在?|
|------|--------------|------|
| A1 | pre-worker-matrix W3-absorption-blueprint-session-do-runtime.md(§7 reality-checked)| ✓ |
| A2 | P0 A2-agent-runtime-kernel-absorption-blueprint.md | ✓ |
| A3 | P0 A3-llm-wrapper-absorption-blueprint.md | ✓ |
| A4 | P0 A4-hooks-residual-absorption-blueprint.md | ✓ |
| A5 | P0 A5-eval-observability-residual-absorption-blueprint.md | ✓ |
| B1 | pre-worker-matrix W3-absorption-blueprint-capability-runtime.md(§5.1/§8.1 reality-checked)| ✓ |
| C1 | P0 C1-context-management-absorption-blueprint.md | ✓ |
| C2 | pre-worker-matrix W3-absorption-blueprint-workspace-context-artifacts-split.md(§9 reality-checked)| ✓(与 D1 共用)|
| D1 | 同上(§9 reality-checked)| ✓(与 C2 共用)|
| D2 | P0 D2-storage-topology-residual-absorption-blueprint.md | ✓ |

所有 10 个 units 都有 machine-usable blueprint;P1-P4 执行 PR 作者可按 index 直接查母本。

---

## 2. Phase 1 reality-check delta 说明

Phase 1 仅做 **fact-anchor 补充**,不改 §1-§6 结构。所有 3 份代表 blueprint 增加了 "worker-matrix 下 …… 消费本 blueprint 的要点" 一节,列出以下事实锚点:

- 已 shipped 的 NACP scope / 版本号:`@haimang/nacp-core@1.4.0` + `@haimang/nacp-session@1.3.0`
- D02 F6 real preview deploy 契约 + R3 binding-first HTTP surface
- D05 v0.2 host consumer 口径(composition.workspace.assembler + initial_input wire truth)
- D03/D04 mixed helper 归属(context-core vs. filesystem-core evidence split)
- D03 F4 `appendInitialContextLayer` helper 的 R1 口径

这些 delta 都在对应 blueprint 的附加 §(§7/§8.1/§9)底部,不影响原有章节的 byte-identical 引用性。

---

## 3. P2.E0 owner 决策(Phase 3 产出)

### 3.1 P2.E0 决策对象

`workers/bash-core/` 的 **real preview deploy** — D02 §7.1 F6 定义:

1. `pnpm --filter workers/bash-core run deploy:preview` 成功 landing preview URL
2. `curl -fsSL <preview-url>/` 返回含以下字段的合法 JSON:
   - `worker: "bash-core"`
   - `absorbed_runtime: true`
   - `nacp_core_version: "1.4.0"`
   - `nacp_session_version: "1.3.0"`
   - `status: "ok"`
3. preview URL + Version ID 记录在 B1 PR body 内

### 3.2 owner 决策(已批准默认建议值,2026-04-23)

owner(用户)在 2026-04-23 通过明确授权("我们已经构建了 wrangler 有效的登录信息,你可以使用 npx wrangler whoami 来确认登录与权限... 你会完成 P1 需要的线上 deploy 以及线上测试")批准所有 5 子项建议值作为最终 answer。Claude 已按该决策执行 P1 Phase 5 F6。

| 子项 | 批准的最终 answer(基于 P0 建议值)|
|------|-----------------------------------|
| **owner**(谁执行 deploy)| **Claude Opus 4.7**,使用本地预授权的 wrangler OAuth(email `sean.z@haimangtech.cn`,Account ID `8b611460403095bdb99b6e3448d1f363`,权限含 `workers_scripts (write)`)|
| **schedule**(何时执行)| **P1.B "merge" 当日(2026-04-23)内立即 deploy**(实际执行:吸收 + dry-run + preview deploy + curl 验证在同一 session 内连续完成)|
| **rollback plan** | Wrangler `Version ID` `50335742-e9e9-4f49-b6d7-ec58e0d1cfb4` 已记录(见 P1-closure.md §5.5);出故障可 `wrangler rollback 50335742-e9e9-4f49-b6d7-ec58e0d1cfb4` 或重 deploy 到 W4 基线 Version ID |
| **probe command** | `curl -fsSL https://nano-agent-bash-core-preview.haimang.workers.dev/ \| jq`(已实测通过)|
| **probe expected JSON**(shape)| `{"worker":"bash-core","nacp_core_version":"1.4.0","nacp_session_version":"1.3.0","status":"ok","phase":"worker-matrix-P1.B-absorbed","absorbed_runtime":true}`(实测 6 字段完整返回)|

**决策口径**:本次 owner decision 批准基于 "Claude 已持有本地 wrangler OAuth 授权" 这一组织性前提(memory: `reference_local_tooling.md`)— 从而 `owner` 一栏填 `Claude Opus 4.7` 并非违反 W3 pattern §1 "owner-first" 纪律,而是 owner(用户)正式授权 Claude 作为 deploy 执行者。同样授权覆盖 P2 / P5 等后续需 deploy 的 phase。

### 3.3 rollback 具体流程(正常路径 + 故障路径)

**正常路径**(deploy 成功):
1. `pnpm --filter workers/bash-core run build` → 绿
2. `pnpm --filter workers/bash-core run deploy:dry-run` → 绿
3. `pnpm --filter workers/bash-core run deploy:preview` → 获取 preview URL + Version ID
4. `curl -fsSL <preview-url>/` → 验证 §3.1 JSON shape
5. 把 preview URL + Version ID 写入 B1 PR body 的 "P2.E0 deploy 证据" 段
6. P2 开工;D07 consumer 直接引用该 preview URL

**故障路径**(deploy 失败):
1. 若 wrangler build 失败 → diagnose 后 amend B1 PR(非 force-push,新 commit)
2. 若 deploy 返回 403 / 5xx → 检查 Wrangler OAuth(`npx wrangler whoami`);若 token 过期则 owner 重新登录
3. 若 preview URL 返回非法 JSON → 检查 D02 F3 `index.ts` 的 `/` 路由实装;B1 PR 不得 merge 直到 probe 绿
4. 若 merge 后发现问题 → `wrangler rollback <prev-versionId>` 或 revert merge commit(后者优先,单一回滚粒度更干净)

---

## 4. P1.A / P1.B kickoff checklist(Phase 3 产出)

### 4.1 P1.A kickoff PR body 必含

- [ ] **blueprint 就绪验证**:引用 `docs/design/worker-matrix/blueprints/blueprints-index.md` + 确认 A1-A5 覆盖的 5 份 blueprint link
- [ ] **A1-A5 sub-PR 方案锁定**:从 `A1-A5-sub-pr-granularity.md` §3.4 三种方案中选 1 种(默认建议方案 2 = 2 sub-PR),并在 PR body 明确 merge 顺序
- [ ] **代表 blueprint(A1 optional)reality-check 已吸收**:session-do-runtime blueprint §7 5 条要点确认被 sub-PR 执行时消费
- [ ] **dependency graph check**:确认 A2/A3/A5 零跨包 runtime dep + A4 `@haimang/nacp-core` + A1 `@haimang/nacp-core/nacp-session/workspace-context-artifacts`
- [ ] **owner 背书**:本 sub-PR 作者姓名 + approver 姓名;B7 LIVE 5 tests 绿证据 block 计划(哪个 sub-PR 附)
- [ ] **共存期 window 声明**:若 > 1 sub-PR,声明 sub-PR i merge 后 N 天内必 ship sub-PR i+1

### 4.2 P1.B kickoff PR body 必含

- [ ] **blueprint 就绪验证**:引用 B1 代表 blueprint(`W3-absorption-blueprint-capability-runtime.md`)+ 确认 §8.1 worker-matrix 消费要点已吸收
- [ ] **D02 v0.2 已审阅**:确认 D02 §7.1 F3 binding-first + F6 real preview deploy 对齐
- [ ] **P2.E0 owner 已定**:引用本 memo §3.2 的 owner 名 / schedule / rollback / probe 5 子项 answer
- [ ] **preview deploy rollback plan ready**:Wrangler Version ID pin + curl probe expected JSON 两项明确
- [ ] **dependency graph check**:capability-runtime 实测零 runtime dep;`@haimang/nacp-core` 仅用于 wire vocabulary;workspace-context-artifacts 共存期保持旧 package 位置
- [ ] **owner 背书**:B1 sub-PR 作者 + approver;package-local 352 tests 绿 + root B7 LIVE 5 tests 绿双证据 block

---

## 5. D01-D09 GPT R1-R5 吸收索引(Phase 4 产出)

### 5.1 9 份 design v0.2 版本历史总表

| design | v0.2 吸收的 R | 主要 delta | 事实锚点(代码 / 文件 / §)|
|--------|---------------|------------|---------------------------|
| D01(agent-core-absorption)| 无 delta(作为聚合目录) | 无直接 R;A1-A5 单独 sub-PR 序列的 host / kernel / delegates 布局 | `docs/design/worker-matrix/D01-agent-core-absorption.md` |
| D02(bash-core-absorption)| **R3**(binding-first)| F3 index.ts 收口为 binding-first;`/capability/call` + `/capability/cancel` internal path;`tool.call.*` 仅为 body schema | D02 §7.1 F3;附录 B Q2 |
| D03(context-core-absorption)| **R1**(P1-P5 GPT review)| F4 `appendInitialContextLayer` 改为 helper-maintained pending layers;不扩 assembler API;映射 canonical `session`/`injected` kind(非 `initial_context`)| D03 §7 F4 + v0.2 历史 |
| D04(filesystem-core-absorption)| 无 R delta | D1 slice + D2 absorb 的 posture;`@haimang/filesystem-core-worker` real package name | D04 v0.1 |
| D05(initial-context-host-consumer)| **R1 + R2**(D01-D09 GPT review)| R1:consumer 走 `composition?.workspace?.assembler`(非 top-level assembler 句柄);R2:`system.notify severity=error`(非自造 `system.error`)| D05 v0.2 |
| D06(default-composition-and-remote-bindings)| **R1**(D01-D09 GPT review)| composition 无 top-level `assembler` handle;走 `composition.workspace.assembler` 路径 | D06 v0.2 |
| D07(agent-bash-tool-call-activation)| 无 R delta | P2 硬前置 = D02 F6 real preview deploy | D07 v0.1 |
| D08(published-path-cutover)| **R4**(D01-D09 GPT review)| `.npmrc` readiness honesty;cutover 条件改 "lockfile resolution 不再是 `link:`"(tarball / registry 均为有效 published-path)| D08 v0.2 |
| D09(tier-b-deprecation-protocol)| **R5**(D01-D09 GPT review)| README-only / minimal stub banner 策略;per-worker absorb-stable;不触 Tier A | D09 v0.2 |

### 5.2 5 条 delta cross-reference 表(P1-P5 action-plan 的消费点)

| R | 吸收 design | 消费 action-plan | 消费内容 |
|---|-------------|------------------|----------|
| R1(D01-D09)| D05 / D06 | P2(live-loop-activation)§1 / P1-01 / P5-01 | host consumer 走 composition.workspace.assembler;`system.notify severity=error` |
| R1(P1-P5)| D03 | P2(live-loop-activation)§S1 / §P1-01 / §5.2 / §5.6 + D03 F4 | helper-maintained pending layers;canonical kind mapping;无 layer_kind 断言 |
| R2(P1-P5)| (D05 已含 R2)| P2(live-loop-activation)§S9 / §S10 / §P5-01 / §P5-02 | wire truth = `session.start.body.initial_input` + `session.followup_input.body.text`;`turn_input` 仅 runtime-internal |
| R3(D01-D09)| D02 | P1(agent-bash-absorption)§P2-03;B1 F3 | binding-first `/capability/call` + `/capability/cancel` |
| R4(D01-D09)| D08 | P5(cutover-and-deprecation)§S3/S5/P1-03/Phase 1 goal/risk table/recap | `.npmrc` honesty;cutover 条件 `resolution.*link:` 检查 |
| R4(P1-P5)| (P1 action-plan)| P1(agent-bash-absorption)§S1/S2/S6/P1-03/P2-03/P4-02/Phase 1+2 新增文件/Phase 1 function spec | package-local tests 搬;root `test/*.test.mjs` + e2e + verification 不搬 |
| R5(D01-D09)| D09 | P5(cutover-and-deprecation)Phase 1 goal + P1-03 + recap | README-only / minimal stub banner;per-worker absorb-stable |
| R3(P1-P5)| (P3/P4 action-plan)| P3(context-absorption)§P3-02/P3-03/§Q1 + P4(filesystem-absorption)§Risk/Prereq | A=cross-worker import B=shared helper in packages;真实 `@haimang/{context,filesystem}-core-worker` name |
| R5(P1-P5)| (P5 action-plan)| P5 全 S3/S5/P1-03/Phase 1 goal/risk table/recap | 成功 = lockfile `resolution.*link:` 不再存在;tarball / registry 均为 valid surface |

---

## 6. Exit criteria(P0 合拢标准)

P0 关闭满足以下 **6 项** 全绿:

- [x] **[E1]** 3 份代表 blueprint 完成 reality-check(§1.1)— 每份补一节 worker-matrix 消费要点,不改 §1-§6 结构
- [x] **[E2]** 6 份 P0 补齐 blueprint + 1 份 sub-PR 切分建议 + 1 份 index 全部新建(§1.2)— 10 units 100% 覆盖(§1.3)
- [x] **[E3]** P2.E0 owner 决策 5 子项 answer(§3.2)— owner / schedule / rollback / probe / expected JSON 全部批准默认建议值(见 §3.2 批准表);P1 Phase 5 F6 已按该 answer 执行并实测通过
- [x] **[E4]** P1.A / P1.B kickoff checklist 合计 12+ 条(§4.1 + §4.2)— P1 kickoff PR body 可直接 copy
- [x] **[E5]** D01-D09 R1-R5 吸收索引表 9 行(§5.1)+ 5 条 delta cross-reference 表(§5.2)
- [x] **[E6]** charter(`docs/plan-worker-matrix.md` §11)+ handoff(`docs/handoff/pre-worker-matrix-to-worker-matrix.md` 尾部)回链本 memo

**6/6 全绿**:E1/E2/E4/E5 由 P0 Phase 1-4 执行期产出完成;E3 由 owner 在 2026-04-23 明确授权批准默认 answer + Claude 已实际执行 F6 验证;E6 由 Phase 4 回链步骤完成。

---

## 7. 对 P1 开工的直接影响

- P1.A kickoff PR 作者可直接引用 §4.1 checklist + blueprints-index(§1.2)+ A1-A5 sub-PR 切分建议
- P1.B kickoff PR 作者可直接引用 §4.2 checklist + §3 P2.E0 decision + B1 代表 blueprint(§8.1 reality-check)+ D02 v0.2
- P3 / P4 的 context-core / filesystem-core PR 作者可直接按 C1 / D2 blueprint + WCA split blueprint §9 reality-check 执行
- P5 cutover PR 作者可直接按 D08 v0.2 + §5.2 R4 cross-reference 行(lockfile `resolution.*link:` 不再存在 = 成功条件)执行

---

## 8. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-23 | Claude Opus 4.7(1M context)| P0 closure memo 初稿;Phase 1 reality-check delta 汇总 + Phase 2 8 blueprint 新建汇总 + Phase 3 P2.E0 decision 提议 + P1.A/P1.B kickoff checklist + Phase 4 D01-D09 R1-R5 吸收索引 + exit criteria 6 项 |
| v0.2 | 2026-04-23 | Claude Opus 4.7(1M context)| 吸收 GPT R2:§3.2 owner decision 5 子项由 `_pending_` 批准为默认 answer(owner 授权 Claude 作为 deploy 执行者 + Version ID `50335742-e9e9-4f49-b6d7-ec58e0d1cfb4` 已记录);§6 E3/E6 由 `[ ]` 改为 `[x]`;文档状态由 `draft` → `closed`。6/6 exit criteria 全绿 |
