# P5 — Published-Path Cutover + Tier B Deprecation + Worker-Matrix Closure

> 服务业务簇: `worker-matrix / Phase 5 — Release Hygiene Closure`
> 计划对象: `D08(workspace:* → @haimang/1.4.0/1.3.0 独立 release PR,per Q5c + 已吸收 R4 .npmrc readiness 诚实化)+ D09(Tier B 9 包 per-worker DEPRECATED banner,per Q6c + 已吸收 R5 no-CHANGELOG fallback)+ worker-matrix final closure + handoff memo`
> 类型: `upgrade`(workspace:* → published registry)+ `modify`(Tier B 9 包 README + 可选 CHANGELOG)+ `new`(worker-matrix closure memo + handoff)
> 作者: `Claude Opus 4.7 (1M context)`
> 时间: `2026-04-23`
> 文件位置:
> - `workers/{agent-core,bash-core,context-core,filesystem-core}/package.json`(nacp 依赖从 `workspace:*` 切 `1.4.0` / `1.3.0`)
> - `pnpm-lock.yaml`(resolution **从 `link:` 切到非 `link:` published-path**;per P1-P5 GPT review R5:真相是"非 link:",tarball / registry version 均为合法表面形态)
> - `.npmrc`(若 R4 诚实化后发现必要,按 `workers/<name>/.npmrc` → `workers/.npmrc` → `root/.npmrc` 最小面补)
> - `packages/<name>/README.md`(9 Tier B 包各贴 DEPRECATED banner;per Q6c per-worker 节奏)
> - `packages/<name>/CHANGELOG.md`(7 有的包加 entry;`agent-runtime-kernel` / `capability-runtime` 2 个缺 CHANGELOG 按 R5 走 README-only 或 minimal stub)
> - `docs/issue/worker-matrix/worker-matrix-final-closure.md`
> - `docs/handoff/worker-matrix-to-<next>.md`(若有下一阶段)
> 关联设计 / 调研文档:
> - `docs/plan-worker-matrix.md` §5.3 P5.A-C / §6.5(P5 DoD)/ §7 Q5/Q6
> - `docs/design/worker-matrix/D08-published-path-cutover.md` v0.2(已吸收 R4)
> - `docs/design/worker-matrix/D09-tier-b-deprecation-protocol.md` v0.2(已吸收 R5)
> - `docs/issue/worker-matrix/{P1,P2,P3,P4}-closure.md`(P5 kickoff 前提)
> - `docs/issue/pre-worker-matrix/W2-closure.md` §5 首发真相
> - `.github/workflows/publish-nacp.yml`
> 文档状态: `draft`

---

## 0. 执行背景与目标

P4 结束时,4 个 workers 的 runtime ownership 全部从 `packages/*` 迁入 `workers/*/src/`,live loop / initial_context / tool.call 闭环在 preview env 已跑通。但仍有 3 件 release hygiene 欠账阻挡 worker-matrix 闭合:

1. **workspace:* interim 仍挂**:4 个 `workers/<name>/package.json` 对 `@haimang/nacp-core` / `@haimang/nacp-session` 仍是 `workspace:*`,意味着 workers 未真正从 published registry install NACP bundle — W2 首发"到 GitHub Packages"未被消费者侧真实验证
2. **Tier B 9 包未打 DEPRECATED**:吸收完成但 `packages/*/README.md` 没有 banner,让任何接手者误以为 Tier B 仍是 runtime 归属
3. **worker-matrix 未收口**:没有 closure memo / 下一阶段 handoff / 3 个 W3 pattern placeholder 的最终状态梳理

P5 的任务是把这三件事按 **独立 release PR** 方式关掉,并写 final closure + handoff。按 Q5c,cutover 是 **独立 release PR**,不绑在任何 absorb PR;按 Q6c,deprecation 是 **per-worker 逐个贴**,不 P5 一次统一贴(但本 action-plan 负责 "P5 结束前所有应贴的 9 包都已贴完"的合拢)。

已吸收的 R4 / R5 决定了两件执行细节:
- **R4**:`.npmrc` readiness 诚实化 — 当前仓库 root `.npmrc` 未落仓;cutover PR 先 trial-and-error 验证现有 `publishConfig.registry` + `NODE_AUTH_TOKEN` 是否足够,只在不足时按 minimal-surface 补
- **R5**:`agent-runtime-kernel` / `capability-runtime` 2 包缺 CHANGELOG.md,允许 README-only deprecation 或 minimal CHANGELOG stub,不强制补完整历史

- **服务业务簇**:`worker-matrix / Phase 5 — Release Hygiene Closure`
- **计划对象**:published-path cutover + Tier B 9 包 DEPRECATED banner(per-worker)+ worker-matrix final closure + handoff memo
- **本次计划解决的问题**:
  - `workers/{agent-core,bash-core,context-core,filesystem-core}/package.json` 的 `@haimang/nacp-*` 仍是 `workspace:*`(interim 未退役)`
  - `.npmrc` readiness 口径不清(R4:root 未落仓,口径诚实化)`
  - Tier B 9 包 README 未贴 DEPRECATED;2 包缺 CHANGELOG(R5 提供 README-only / minimal stub 两种合法路径)`
  - worker-matrix 没有 final closure memo + 下一阶段 handoff`
- **本次计划的直接产出**:
  - 独立 release PR(1 PR)完成 4 workers `package.json` cutover + lockfile resolution **不再是 `link:`**(tarball / registry version 任一形态合法,per R5)+ agent-core preview redeploy + live probe `nacp_core_version: "1.4.0"` / `nacp_session_version: "1.3.0"` 不变
  - 9 per-worker deprecation PR(按 D09 §5.1 S5 顺序)Tier B banner 全贴;2 缺 CHANGELOG 包走 R5 路径
  - `docs/issue/worker-matrix/worker-matrix-final-closure.md`
  - `docs/handoff/worker-matrix-to-<next>.md`(若有下一阶段)
  - W3 pattern 3 个 placeholder 最终状态清点(填 / 未填原因)

---

## 1. 执行综述

### 1.1 总体执行方式

**独立 release PR(Phase 1)先行**,再 **per-worker deprecation PR 流水(Phase 2,9 PRs)**,最后 **closure + handoff**。Phase 1 作为原子 cutover,回滚即 revert commit;Phase 2 的 9 PR 可并行也可串行,但建议串行以便 per-worker review。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 0 | P5 kickoff gate check | `XS` | P2/P3/P4 DoD 全绿 + `@haimang/nacp-core@1.4.0` + `nacp-session@1.3.0` 仍 installable | P4 closed |
| Phase 1 | 独立 release PR cutover | `M` | 4 workers package.json workspace:* → 1.4.0/1.3.0 + lockfile 非 `link:` published-path(R5)+ regression + agent-core preview redeploy + `.npmrc` readiness verdict(R4)| Phase 0 |
| Phase 2 | 9 per-worker deprecation PR 流水(per Q6c)| `L` | 9 Tier B 包按 D09 §5.1 S5 顺序贴 README banner + CHANGELOG entry;`agent-runtime-kernel` / `capability-runtime` 走 R5 路径 | Phase 1(或部分可与 Phase 1 并行,取决于 owner)|
| Phase 3 | W3 pattern 3 placeholder 清点 + 补齐 | `S` | "LOC→时长 / 可执行流水线 / 循环引用" 三节最终状态 | Phase 1-2 |
| Phase 4 | worker-matrix final closure + handoff memo | `S` | closure memo + handoff(若有下一阶段) | Phase 3 |

### 1.3 Phase 说明

1. **Phase 0 — kickoff gate**:P2/P3/P4 closure 全 ✓;`gh api /orgs/haimang/packages/npm/nacp-core/versions` 显示 `1.4.0` / `1.3.0` 仍 listed + installable
2. **Phase 1 — 独立 release PR cutover**(D08 F1-F7):
   - F1 prerequisite 验证(PR body)
   - F2 4 package.json diff(8 行)
   - F3 **`.npmrc` readiness 诚实化(R4)**:先 trial-and-error;不足再 minimal-surface 补;PR body 必须含 "`.npmrc` readiness verdict"(未落仓 / 补了哪里 / 补了什么)
   - F4 `pnpm install` → lockfile resolution **不再是 `link:`**(tarball / registry version 均合法,per R5)
   - F5 全仓回归(typecheck / test / dry-run / root / cross)
   - F6 agent-core preview redeploy + `curl` `nacp_core_version: "1.4.0"` / `nacp_session_version: "1.3.0"` 不变
   - F7 PR body 结构固化(prerequisites / diff / regression / redeploy evidence / rollback)
3. **Phase 2 — 9 per-worker deprecation PR 流水**(D09 §5.1 S5):
   - 第一批(P2 稳定后):`session-do-runtime`(A1)、`capability-runtime`(B1,**R5 路径**:PR author 任选 README-only 或 minimal stub)
   - 第二批(P2 + agent-core 其他 A 吸收稳定):`agent-runtime-kernel`(A2,**R5 路径**)、`llm-wrapper`(A3)、`hooks`(A4)、`eval-observability`(A5)
   - 第三批(P3 稳定):`context-management`(C1)
   - 第四批(P3 + P4 都稳定):`workspace-context-artifacts`(C2+D1 split 同步贴)、`storage-topology`(D2)
4. **Phase 3 — W3 pattern 3 placeholder 清点**:
   - "LOC→时长系数":P1 已回填(首批 absorb PR 内)
   - "可执行流水线样板":P1 已回填
   - "循环引用解决 pattern":P3 / P4 执行中若遇,则对应 phase 回填;若未遇,Phase 3 写清 "未触发" 并在 W3 pattern 文档保留 template stub
5. **Phase 4 — final closure + handoff**:
   - `docs/issue/worker-matrix/worker-matrix-final-closure.md`:含 charter §9 primary 6 条 exit criteria 全绿证据 + 4 workers 最终状态 + 9 Tier B deprecation status table + 3 placeholder 最终状态 + 下一阶段 trigger
   - `docs/handoff/worker-matrix-to-<next>.md`:若有下一阶段(live loop stability trigger 或 scope expansion trigger)则写;若无,注明 "等待 trigger"

### 1.4 执行策略说明

- **执行顺序原则**:Phase 1 原子 release PR 先 merge;Phase 2 per-worker 按 D09 §5.1 S5 顺序;Phase 3-4 收口
- **风险控制原则**:Phase 1 revert 即回滚;Phase 2 每 PR diff 极小(README + 可选 CHANGELOG);不改任何 source
- **测试推进原则**:Phase 1 跑全仓 + preview redeploy + curl probe;Phase 2 每 PR 跑 dry-run + 全仓回归;Phase 3-4 无代码测试
- **文档同步原则**:D08 / D09 事实锚点若在执行中漂移,v0.3;charter §11 维护规则要求 P5 cutover 在同 PR 内同步修订 charter(Phase 1 PR body 内附 charter §11 link)

### 1.5 本次 action-plan 影响目录树

```text
worker-matrix/P5/
├── Phase 1 — 独立 release PR cutover/
│   ├── workers/agent-core/package.json         [workspace:* → 1.4.0/1.3.0]
│   ├── workers/bash-core/package.json          [same]
│   ├── workers/context-core/package.json       [same]
│   ├── workers/filesystem-core/package.json    [same]
│   ├── pnpm-lock.yaml                           [resolution link → 非 link:(tarball / registry version 均合法,per R5)]
│   ├── .npmrc(optional,per R4 trial-and-error)
│   └── agent-core preview redeploy + Version ID
├── Phase 2 — 9 per-worker deprecation PR/
│   ├── PR#1 session-do-runtime       [README banner + CHANGELOG entry]
│   ├── PR#2 capability-runtime       [README banner + R5 路径(README-only or minimal stub)]
│   ├── PR#3 agent-runtime-kernel     [README banner + R5 路径]
│   ├── PR#4 llm-wrapper              [README banner + CHANGELOG entry]
│   ├── PR#5 hooks                    [README banner + CHANGELOG entry;wire catalog 不 deprecate]
│   ├── PR#6 eval-observability       [README banner + CHANGELOG entry]
│   ├── PR#7 context-management       [README banner + CHANGELOG entry]
│   ├── PR#8 workspace-context-artifacts  [README banner + CHANGELOG entry;C2+D1 split 同步]
│   └── PR#9 storage-topology         [README banner + CHANGELOG entry]
├── Phase 3 — W3 pattern 3 placeholder 清点/
│   └── docs/design/pre-worker-matrix/W3-absorption-pattern.md  [3 节状态最终化]
└── Phase 4 — closure + handoff/
    ├── docs/issue/worker-matrix/worker-matrix-final-closure.md
    └── docs/handoff/worker-matrix-to-<next>.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope

- **[S1]** Phase 1 独立 release PR:`workers/{agent-core,bash-core,context-core,filesystem-core}/package.json` 对 `@haimang/nacp-core` + `@haimang/nacp-session` 从 `workspace:*` → `1.4.0` / `1.3.0`(精确 pin,不 caret)
- **[S2]** Phase 1 `.npmrc` readiness 诚实化(R4):先 trial install;不足再补;PR body 含 readiness verdict
- **[S3]** Phase 1 `pnpm install` → `pnpm-lock.yaml` 对 `@haimang/nacp-core` / `@haimang/nacp-session` 的 resolution **不再是 `link:`**(当前是 `version: link:../../packages/nacp-core`);切完后具体表面形态可为 tarball descriptor 或 registry version,**均为合法 published-path truth**(per R5);PR reviewer grep 验证的是 `resolution.*link:` 对 nacp-* 条目已消失
- **[S4]** Phase 1 全仓回归:`pnpm -r run typecheck && pnpm -r run test && pnpm --filter './workers/*' run deploy:dry-run && node --test test/*.test.mjs && npm run test:cross` 全绿
- **[S5]** Phase 1 agent-core redeploy preview:`pnpm --filter workers/agent-core run build && run deploy:preview`;`curl` 返回 `nacp_core_version: "1.4.0"` / `nacp_session_version: "1.3.0"`(value 不变,但源头从 published-path 而非 workspace link 读 — 具体 resolution 形态无所谓,见 R5)
- **[S6]** Phase 1 PR body 结构:Prerequisites / Changed files / Regression evidence / Redeploy evidence(URL + Version ID)/ Rollback instruction / `.npmrc` readiness verdict
- **[S7]** Phase 2:9 Tier B 包按 D09 §5.1 S5 顺序逐个开 deprecation PR;每 PR 只改 1 package 的 `README.md` + 可选 `CHANGELOG.md`
- **[S8]** Phase 2 R5 路径:`agent-runtime-kernel` / `capability-runtime` 2 包 PR author 在 **README-only** 或 **minimal CHANGELOG stub** 二选一;PR body 注明选哪条(R5 口径)
- **[S9]** Phase 2 per-worker 纪律:per Q6c,不要求 P5 一次统一贴 — 只要 P5 结束前 9 包都有 banner 即可;owner 按 absorb-stable 节奏安排
- **[S10]** Phase 2 physical delete 不做(D09 §5.1 S8;归下一阶段)
- **[S11]** Phase 3 W3 pattern 3 placeholder 清点:
  - "LOC→时长" + "可执行流水线" 在 P1 已填
  - "循环引用" 若 P3/P4 未遇,Phase 3 在 W3 pattern 文档里写 "未触发 — P3/P4 WCA split 顺利,mixed helper 切分零循环依赖"
- **[S12]** Phase 4 `docs/issue/worker-matrix/worker-matrix-final-closure.md`:含 charter §9 primary 6 条 exit criteria 全绿证据
- **[S13]** Phase 4 `docs/handoff/worker-matrix-to-<next>.md`:写 "下一阶段 trigger 之一被激活时由此 handoff 提供输入";若无 trigger 则 placeholder 段
- **[S14]** Phase 1 或 Phase 4 同步修订 charter §11:按 charter 维护规则,cutover 触发时同 PR 修订 charter;Phase 1 PR body 附 charter §11 diff reference

### 2.2 Out-of-Scope

- **[O1]** NACP 版本 bump(`1.4.1` / `1.3.1` / `1.5.0`)
- **[O2]** Tier B scope 切换(`@nano-agent/` 保持;不切 `@haimang/`)
- **[O3]** Tier B 物理删除(D09 §5.1 O1)
- **[O4]** `npm deprecate` CLI 调用(Tier B 不发布)
- **[O5]** production env flip(charter §3.2 O5)
- **[O6]** 修改 W2 发布纪律 / CI
- **[O7]** 修改 `the retired historical dogfood consumer`(已 published path)
- **[O8]** 改 `workers/*/src/**` 任一文件
- **[O9]** 改 `packages/**/src/**` 任一文件(Phase 2 只动 README + CHANGELOG)
- **[O10]** 其余 3 worker(bash/context/filesystem)real preview deploy 升级 — charter §6.5 允许 defer;本 phase 不强制除非 owner 要求
- **[O11]** `workspace:*` 切 caret `^1.4.0` / `^1.3.0`
- **[O12]** bash-core / context-core / filesystem-core 的 `@haimang/*` 依赖从 `workspace:*` 切到版本号 **之外的** 修改

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| Phase 1 是否拆多个 PR | `out-of-scope / 1 独立 release PR` | Q5c 明确独立 | NOT revisit |
| Phase 2 9 PR 是否统一合 1 | `out-of-scope / per-worker` | Q6c per-worker 节奏 | NOT revisit |
| `agent-runtime-kernel` / `capability-runtime` deprecation 方式 | `in-scope / R5 二选一` | R5 口径 | — |
| `.npmrc` 落点(root / workers / `<worker>`) | `defer / R4 trial-and-error` | 最小 surface | Phase 1 执行中决定 |
| Tier B 物理删除 | `out-of-scope` | 归下一阶段 | 共存期 ≥ 3 月 + production stable 后 |
| NACP 版本 bump | `out-of-scope` | 独立 release charter | 未来 |
| `workers/bash/context/filesystem` preview deploy 升级 | `out-of-scope P5` | 允许 defer | 下一阶段 |
| 产品 env flip | `out-of-scope` | charter O5 | live loop stability trigger 后 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P0-01 | Phase 0 | P2/P3/P4 DoD gate | check | 3 closure memos | 全绿 | low |
| P0-02 | Phase 0 | published bundle installable 验证 | check | `gh api ...` | `1.4.0` / `1.3.0` listed | low |
| P1-01 | Phase 1 | 4 package.json cutover | upgrade | 4 package.json × 2 行 | workspace:* → 1.4.0/1.3.0 | medium |
| P1-02 | Phase 1 | `.npmrc` readiness 诚实化(R4)| optional new | `<worker>/.npmrc` / `workers/.npmrc` / `root/.npmrc` 任一 or 无 | trial-and-error + PR verdict | medium |
| P1-03 | Phase 1 | `pnpm install` + lockfile 对 nacp-* 切到非 `link:` | update | `pnpm-lock.yaml` | resolution **不再是 `link:`**(tarball / registry 均合法,per R5)| medium |
| P1-04 | Phase 1 | 全仓回归 | test | 全仓 | 全绿 | medium |
| P1-05 | Phase 1 | agent-core redeploy preview | new | workers/agent-core | URL live + `curl` JSON 不变 | medium |
| P1-06 | Phase 1 | charter §11 同步修订 | update | `docs/plan-worker-matrix.md` §11 | 标 "cutover 已触发 Y-M-D" | low |
| P1-07 | Phase 1 | PR body 固化 + merge | update | release PR | 5 段齐(Prerequisites/Diff/Regression/Redeploy/Rollback)+ R4 verdict | low |
| P2-01 至 P2-09 | Phase 2 | 9 Tier B per-worker deprecation PR | new | `packages/<name>/README.md` + CHANGELOG.md | banner + entry;R5 路径 for 2 无 CHANGELOG 包 | low |
| P3-01 | Phase 3 | W3 pattern 3 节清点 | check / update | `W3-absorption-pattern.md` | 状态最终化 | low |
| P4-01 | Phase 4 | worker-matrix final closure memo | add | `docs/issue/worker-matrix/worker-matrix-final-closure.md` | charter §9 primary 6 绿证据 | low |
| P4-02 | Phase 4 | handoff memo | add | `docs/handoff/worker-matrix-to-<next>.md` | trigger 说明 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 0 — kickoff gate check

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P0-01 | P2/P3/P4 DoD gate | 读 3 份 closure memo;所有 DoD 全 ✓ | P2/P3/P4 closure | 全 ✓ | 目视 | ✓ |
| P0-02 | published bundle 校验 | `gh api /orgs/haimang/packages/npm/nacp-core/versions | jq '.[].name'` 含 `1.4.0`;同 nacp-session/1.3.0 | gh | ≥ 1 行匹配 each | curl gh | ✓ |

### 4.2 Phase 1 — 独立 release PR cutover

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | 4 package.json cutover | sed / 手工 edit:`"@haimang/nacp-core": "workspace:*"` → `"1.4.0"`;`"@haimang/nacp-session": "workspace:*"` → `"1.3.0"`;4 files × 2 lines = 8 行 diff | `workers/*/package.json` | 4 文件各 2 行 diff | `grep "workspace:\\*" workers/*/package.json` 0 | 0 interim 残留 |
| P1-02 | `.npmrc` trial(R4)| `pnpm --filter workers/agent-core install` 看是否 resolve `@haimang/nacp-core@1.4.0`;若报 registry/auth 失败,按 `workers/agent-core/.npmrc` → `workers/.npmrc` → `root/.npmrc` 最小补 | 可能新建 1 个 `.npmrc` 或 0 改 | install 成功 | trial install | PR body `.npmrc` readiness verdict |
| P1-03 | `pnpm install` | `pnpm install` 更新 lockfile | `pnpm-lock.yaml` | resolution **不再是 `link:`** | `grep -A2 "'workers/agent-core':" pnpm-lock.yaml` 的 `@haimang/nacp-core` 条目 **不含** `version: link:`(tarball descriptor 或 registry `version: 1.4.0` 均合法,per R5)| lockfile `link:` 对 nacp-* 消失 |
| P1-04 | 全仓回归 | `pnpm -r run typecheck && pnpm -r run test && pnpm --filter './workers/*' run deploy:dry-run && node --test test/*.test.mjs && npm run test:cross` | 全仓 | 全绿 | 命令组 | 0 failure;B7 LIVE 5 绿;P2 两条 e2e 绿;98 + 112 绿 |
| P1-05 | agent-core redeploy | `pnpm --filter workers/agent-core run build && run deploy:preview`;`curl -fsSL <preview-url>/` 验证 `nacp_core_version: "1.4.0"` / `nacp_session_version: "1.3.0"`(value 不变) | workers/agent-core | URL live + 2 字段不变 | curl + jq | Version ID 记录 |
| P1-06 | charter §11 同步 | charter §11 维护规则触发:cutover 触发 → 同 PR 内附一行 "cutover 已在 YYYY-MM-DD via PR #<num> 触发";若需改 §1.2 "worker shell 依赖" 注也同改 | `docs/plan-worker-matrix.md` §11 + §1.2 | charter diff ≤ 10 行 | `grep "cutover 已触发"` ≥ 1 | charter 同步 |
| P1-07 | PR body + merge | PR body 5 段 + R4 verdict | release PR | body 齐 | PR review | merge + rollback instruction 明 |

### 4.3 Phase 2 — 9 per-worker deprecation PR 流水

> 每个 PR 的共同模板:
> - 改动仅限 `packages/<name>/README.md`(顶部加 banner 段)+(若有)`packages/<name>/CHANGELOG.md`(新 `## [DEPRECATED] - YYYY-MM-DD` block)
> - PR body Prerequisites 段列:对应 absorb PR link / workers/<dest> test 全绿 link / P2 live loop 至少一次绿 link / 无 revert
> - 每 PR 跑全仓回归(虽然不改 source,仍 sanity check)

| 编号 | PR 序号 | Package | Dest worker | CHANGELOG 状态(R5)| PR body 特殊段 |
|------|---------|---------|-------------|---------------------|----------------|
| P2-01 | PR#1(第一批)| `session-do-runtime` | `agent-core` | 有 CHANGELOG | standard |
| P2-02 | PR#2(第一批)| `capability-runtime` | `bash-core` | **缺 CHANGELOG(R5)** | **PR body 注明:走 README-only 或 minimal CHANGELOG stub** |
| P2-03 | PR#3(第二批)| `agent-runtime-kernel` | `agent-core` | **缺 CHANGELOG(R5)** | **同上** |
| P2-04 | PR#4(第二批)| `llm-wrapper` | `agent-core` | 有 CHANGELOG | standard |
| P2-05 | PR#5(第二批)| `hooks` | `agent-core` | 有 CHANGELOG | **注 "wire catalog 保留在 @haimang/nacp-core;仅 runtime residual deprecate"** |
| P2-06 | PR#6(第二批)| `eval-observability` | `agent-core` | 有 CHANGELOG | **注 "BoundedEvalSink 契约由 B7 LIVE 守护"** |
| P2-07 | PR#7(第三批)| `context-management` | `context-core` | 有 CHANGELOG | standard |
| P2-08 | PR#8(第四批)| `workspace-context-artifacts` | `context-core` + `filesystem-core`(split)| 有 CHANGELOG | **注 "split banner:context slice → context-core;filesystem slice → filesystem-core"** |
| P2-09 | PR#9(第四批)| `storage-topology` | `filesystem-core` | 有 CHANGELOG | **注 "tenant wrapper 契约 by B9 load-bearing"** |

> Phase 2 收口标准:`ls packages/<name>/README.md` 每份顶部都含 `⚠️ DEPRECATED — Absorbed into workers/<dest>/`;P2/P4/P8 的 CHANGELOG 路径(R5)PR body 注明

### 4.4 Phase 3 — W3 pattern 3 placeholder 清点

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | 清点 3 节 | 读 `W3-absorption-pattern.md`:"LOC→时长"("可执行流水线"两节 P1 填;"循环引用" P3/P4 若遇则填,否则 Phase 3 注 "未触发" | `docs/design/pre-worker-matrix/W3-absorption-pattern.md` | 3 节状态清晰 | grep `TODO\|placeholder` | 0 或 1(循环引用未触发)|

### 4.5 Phase 4 — worker-matrix final closure + handoff

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | final closure memo | 写 `docs/issue/worker-matrix/worker-matrix-final-closure.md`:6 段(charter §9 primary 6 exit criteria 每条独立一段 + 证据 link)+ 4 workers 最终状态表 + 9 Tier B deprecation status table + 3 placeholder 最终状态 + 下一阶段 trigger | `docs/issue/worker-matrix/worker-matrix-final-closure.md` | 500-800 行 memo | `grep "primary 1\|primary 2"` ≥ 6 段 | charter §9 全绿 |
| P4-02 | handoff memo | 写 `docs/handoff/worker-matrix-to-<next>.md`:若有下一阶段 trigger(live loop stability 2-4 周 / scope expansion 如 skill.core),说明输入包;否则 placeholder "等待 trigger" | `docs/handoff/worker-matrix-to-<next>.md` | 200-400 行 | grep "trigger" ≥ 1 | handoff 存在 |

---

## 5. Phase 详情

### 5.1 Phase 0 — kickoff gate check

- **Phase 目标**:P2/P3/P4 全绿 + published bundle installable
- **本 Phase 对应编号**:`P0-01` `P0-02`
- **收口标准**:2 条 check 全 ✓

### 5.2 Phase 1 — 独立 release PR cutover

- **Phase 目标**:4 workers workspace:* → 1.4.0/1.3.0;lockfile 对 `@haimang/nacp-*` 条目**不再是 `link:`**(tarball / registry version 任一均合法,per R5);全仓回归 + agent-core redeploy 全绿;`.npmrc` readiness 诚实化(R4)
- **本 Phase 对应编号**:`P1-01` 至 `P1-07`
- **本 Phase 新增文件**:可能 1 个 `.npmrc`(视 R4 trial-and-error 结果);可能 `docs/issue/worker-matrix/P5.1-cutover-memo.md`(可选)
- **本 Phase 修改文件**:
  - `workers/{agent-core,bash-core,context-core,filesystem-core}/package.json`(各 2 行)
  - `pnpm-lock.yaml`
  - `docs/plan-worker-matrix.md` §11(1 行 cutover 标注)
- **具体功能预期**:
  1. 4 package.json 8 行 diff
  2. lockfile 对 `@haimang/nacp-*` resolution **不再是 `link:`**(tarball / registry version 均合法,per R5)
  3. 全仓回归全绿
  4. agent-core preview redeploy;`nacp_core_version: "1.4.0"` / `nacp_session_version: "1.3.0"` value 不变
  5. `.npmrc` readiness verdict in PR body
- **具体测试安排**:
  - **单测**:`pnpm -r run test`
  - **集成测试**:workers dry-run 全绿
  - **端到端 / 手动验证**:curl preview JSON + grep version
  - **回归测试**:B7 LIVE 5 / 98 root / 112 cross / P2 两条 e2e
  - **文档校验**:PR body 5 段齐 + R4 verdict
- **收口标准**:charter §6.5 P5 DoD 前 2 条(cutover + redeploy)绿
- **本 Phase 风险提醒**:
  - `NODE_AUTH_TOKEN` 过期 → install 红;提前 refresh
  - GitHub Packages 短时 unavailable → 重试或 revert
  - lockfile 未切出 `link:`(仍 `version: link:...`)→ PR reviewer 必须 grep verify 对 nacp-* 条目已无 `link:`(per R5;不绑定 tarball 特定表面)
  - preview redeploy 后 curl 字段漂移 → 回滚 revert commit 完整 restore workspace:*
  - `.npmrc` 如果补在不对的位置,pnpm 不继承 → Phase 1-02 trial 多次

### 5.3 Phase 2 — 9 per-worker deprecation PR 流水

- **Phase 目标**:9 Tier B 包全贴 DEPRECATED banner;per Q6c 节奏;R5 for 2 缺 CHANGELOG 包
- **本 Phase 对应编号**:`P2-01` 至 `P2-09`
- **本 Phase 新增文件**:可选(R5 minimal stub 路径)2 个 `packages/{agent-runtime-kernel,capability-runtime}/CHANGELOG.md`
- **本 Phase 修改文件**:
  - `packages/{session-do-runtime,capability-runtime,agent-runtime-kernel,llm-wrapper,hooks,eval-observability,context-management,workspace-context-artifacts,storage-topology}/README.md`(顶部 banner)
  - `packages/{session-do-runtime,llm-wrapper,hooks,eval-observability,context-management,workspace-context-artifacts,storage-topology}/CHANGELOG.md`(7 个有的 entry;2 个缺的视 R5 路径决定)
- **具体功能预期**:
  1. 9 README banner 结构一致
  2. 7 CHANGELOG entry 加 `## [DEPRECATED] - YYYY-MM-DD`
  3. 2 CHANGELOG 缺包走 R5:README-only 或 minimal stub
  4. `package.json.deprecated` 不设(D09 §5.1 S6)
  5. NACP 2 包不 deprecate
- **具体测试安排**:
  - **单测**:n/a(不改 source)
  - **集成测试**:每 PR 跑 dry-run + pnpm -r test 作 sanity
  - **手动验证**:`grep -c "⚠️ DEPRECATED" packages/<name>/README.md` 每份 ≥ 1
- **收口标准**:9 包 banner 全贴;2 缺 CHANGELOG 包 PR body 明 R5 路径
- **本 Phase 风险提醒**:
  - PR 内误改 source → PR review gate 必须限制 diff 仅 README + CHANGELOG
  - banner 文本误写 worker 目标 → `<dest>` 对照 W3 map
  - WCA split PR(P2-08)要求 C2+D1 都 stable 后才贴 — 顺序不得早

### 5.4 Phase 3 — W3 pattern 3 placeholder 清点

- **Phase 目标**:3 节状态最终化
- **本 Phase 对应编号**:`P3-01`
- **本 Phase 新增文件**:无
- **本 Phase 修改文件**:`docs/design/pre-worker-matrix/W3-absorption-pattern.md`
- **具体功能预期**:
  - "LOC→时长系数":P1 实测填入(已在)
  - "可执行流水线样板":P1 实测填入(已在)
  - "循环引用解决 pattern":P3/P4 未遇 → 本 phase 写 "未触发 — WCA split 切分按 D03/D04 owner 表执行,零循环依赖"
- **具体测试安排**:目视
- **收口标准**:3 节状态明确;placeholder 标记全清

### 5.5 Phase 4 — worker-matrix final closure + handoff

- **Phase 目标**:final closure memo + handoff shipped
- **本 Phase 对应编号**:`P4-01` `P4-02`
- **本 Phase 新增文件**:
  - `docs/issue/worker-matrix/worker-matrix-final-closure.md`
  - `docs/handoff/worker-matrix-to-<next>.md`
- **本 Phase 修改文件**:无
- **具体功能预期**:
  1. final closure memo 含 charter §9 primary 6 条 全绿证据
  2. 4 workers 最终状态表 + preview URLs + Version IDs
  3. 9 Tier B deprecation status table(每行:package / dest worker / banner 贴的日期 / CHANGELOG 路径 / absorb-stable 判定证据)
  4. 3 placeholder 最终状态
  5. 下一阶段 trigger 说明(charter §10)
  6. handoff memo:输入包 / NOT-trigger placeholder
- **具体测试安排**:目视 review;charter §9 / §10 交叉核对
- **收口标准**:charter §6.5 P5 DoD 全绿;`NOT-成功退出识别` 任一条未触发

---

## 6. 需要业主 / 架构师回答的问题清单

### Q1 — Phase 2 9 PR 是串行还是并行

- **影响范围**:Phase 2
- **为什么必须确认**:Q6c per-worker 节奏允许逐个贴,但时间上 9 PR 是串行(1 天 1 PR ≈ 2 周)还是并行(所有 stable 后一批开 9 PR)
- **当前建议 / 倾向**:**按 D09 §5.1 S5 批次节奏**:第一批并行 2 个;第二批并行 4 个;第三批 1 个;第四批并行 2 个 — 4 轮;每轮之间保留 stable buffer
- **Q**:节奏?
- **A**:_pending_

### Q2 — R5 路径选 README-only 还是 minimal stub

- **影响范围**:Phase 2 PR#2 + PR#3(`capability-runtime` / `agent-runtime-kernel`)
- **为什么必须确认**:R5 允许二选一;影响文件形态 + reviewer 负担
- **当前建议 / 倾向**:**走 minimal stub**(`packages/<name>/CHANGELOG.md` 同 PR 创建,仅含 DEPRECATED entry,无历史);原因:后续若下一阶段 physical-delete 需要 audit trail,统一有 CHANGELOG 比混合 README-only 更一致
- **Q**:哪条?
- **A**:_pending_

### Q3 — 下一阶段 trigger 是否已由 owner 选定

- **影响范围**:Phase 4 handoff memo
- **为什么必须确认**:charter §10 给出 2 类 trigger — "live loop stability" 或 "scope expansion";owner 若已选,handoff 有具体输入包;若未选,handoff 是 placeholder
- **当前建议 / 倾向**:**placeholder**(P5 完成当日通常无 trigger;由后续 2-4 周监控触发)
- **Q**:placeholder 还是已选?
- **A**:_pending_

### Q4 — charter §11 同步修订放在 release PR 内还是单独 PR

- **影响范围**:Phase 1
- **为什么必须确认**:charter §11 要求 "同 PR 内同步修订";但如果 release PR 已经 diff 很大,charter 同修可能被 reviewer 注意力稀释
- **当前建议 / 倾向**:**同 PR 内改**(charter §11 明确要求;1 行修订不会稀释 review)
- **Q**:同 PR 还是单独?
- **A**:_pending_

### 6.2 问题整理建议

- Q1 / Q2 影响 Phase 2 执行;Q3 影响 handoff memo 内容丰度
- Q4 是流程纪律问题

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| `NODE_AUTH_TOKEN` 过期 | Phase 1 install 红 | `medium` | 提前 refresh;W2 pipeline battle-tested |
| GitHub Packages unavailable | Phase 1 install 红 | `low` | 重试 / 暂停 cutover 1-2 天 |
| lockfile resolution 未切出 `link:` | Phase 1 silent 漂移 | `medium` | PR reviewer grep `resolution.*link:` 对 nacp-* 行数 == 0(per R5 真相 = 非 `link:`,不绑定 tarball 特定表面)|
| `.npmrc` 补错位置 | Phase 1 pnpm 找不到 | `medium` | R4 trial-and-error;PR body 诚实 verdict |
| agent-core redeploy 破坏 live probe shape | Phase 1 | `medium` | curl 5 字段断言 + Version ID rollback |
| Phase 2 PR 误改 source | PR review gate 失效 | `medium` | PR body 限制 diff only README + CHANGELOG |
| R5 双路径 PR author 自选混乱 | `capability-runtime` / `agent-runtime-kernel` | `low` | Q2 owner 统一 |
| WCA split 贴 banner 时 C2/D1 某端未 stable | Phase 2 PR#8 | `medium` | 按 D09 §5.3 边界清单:C2+D1 都 stable 后才贴 |
| `workspace:*` → `1.4.0` 之后仍有 workers 忘切 | Phase 1 partial cutover | `high` | Phase 1-01 grep 强校验:`grep "workspace:\\*" workers/*/package.json | grep nacp` == 0 |
| `nacp_core_version` 字段源头漂移 | Phase 1-05 | `medium` | curl 断言 value 不变 + lockfile 对 nacp-* 非 `link:` verify(per R5)|
| Tier B 物理删除被误做 | 任一 Phase | `low` | charter §3.2 O4 硬约束 |
| 下一阶段 trigger handoff 写具体计划 | Phase 4 | `low` | 默认 placeholder(Q3) |

### 7.2 约束与前提

- **技术前提**:P4 closed;`@haimang/nacp-core@1.4.0` / `@haimang/nacp-session@1.3.0` 仍 installable
- **运行时前提**:Cloudflare preview deploy 凭证;`NODE_AUTH_TOKEN` fresh
- **组织协作前提**:Q1-Q4 owner 决策
- **上线 / 合并前提**:Phase 1 release PR 原子 merge;Phase 2 per-PR review + dry-run;Phase 3-4 document-only

### 7.3 文档同步要求

- 需要同步更新的设计文档:
  - `docs/plan-worker-matrix.md` §11(Phase 1 PR 内同修订)
  - D08 / D09 若执行中漂移 → v0.3(Phase 1/2 PR body 附 link)
- 需要同步更新的说明文档 / README:
  - `packages/<name>/README.md` × 9(Phase 2)
  - `packages/<name>/CHANGELOG.md` × 7+(可选 2,视 R5)
- 需要同步更新的测试说明:无(不改 tests)

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**:
  - `grep "workspace:\\*" workers/*/package.json | grep nacp` == 0
  - `grep "@haimang/nacp-core.*1.4.0" workers/*/package.json` × 4
  - `grep "@haimang/nacp-session.*1.3.0" workers/*/package.json` × 4
  - `grep -l "⚠️ DEPRECATED" packages/*/README.md | wc -l` == 9
  - `ls docs/issue/worker-matrix/worker-matrix-final-closure.md` 存在
  - `ls docs/handoff/worker-matrix-to-*.md` ≥ 1
- **单元测试**:`pnpm -r run test` 全绿
- **集成测试**:`pnpm --filter './workers/*' run deploy:dry-run` 全绿
- **端到端 / 手动验证**:
  - Phase 1 agent-core redeploy:`curl <preview-url>/` 返回 `nacp_core_version: "1.4.0"` + `nacp_session_version: "1.3.0"`
  - Phase 2 9 README banner:visual review
- **回归测试**:B7 LIVE 5 / 98 root / 112 cross / P2 两条 e2e 全绿
- **文档校验**:final closure memo charter §9 primary 6 条 全绿证据;handoff memo 存在

### 8.2 Action-Plan 整体收口标准(= charter §6.5 P5 DoD + §9 primary 6)

1. 4 个 worker 的 `package.json` 中 `@haimang/nacp-core` / `@haimang/nacp-session` 从 `workspace:*` 切到 `1.4.0` / `1.3.0`;`deploy:dry-run` 仍绿;agent-core preview redeploy 成功(P5.A / D08)
2. 9 Tier B packages README 顶部加 `⚠️ DEPRECATED — absorbed into workers/<dest>/`;CHANGELOG 更新(7 有 + 2 R5 路径)(P5.B / D09)
3. Tier B packages 物理保留(不删文件)(charter §3.2 O4)
4. `docs/issue/worker-matrix/worker-matrix-final-closure.md` shipped
5. `docs/handoff/worker-matrix-to-<next>.md` shipped(若有下一阶段)或 placeholder
6. charter §9 primary 6 条 exit criteria 全绿:
   - live agent turn loop 端到端(P2 e2e #1 + #2)
   - 4 workers runtime ownership 已吸收到 `workers/*/src/`(entrypoint 形状按 posture)
   - `@haimang/nacp-*` published path cutover 完成(本 phase)
   - 已吸收 Tier B packages 全部打 DEPRECATED(本 phase)
   - B7 LIVE 5 + `pnpm -r run test` + cross tests 全绿
   - worker-matrix final closure + handoff shipped(本 phase)

### 8.3 完成定义(Definition of Done)

| 维度 | 完成定义 |
|------|----------|
| 功能 | cutover 完成 + 9 deprecation banner 贴全 + 物理保留 + R4/R5 诚实化 |
| 测试 | Phase 1 全仓回归 + agent-core redeploy live probe;B7 LIVE + P2 e2e 全绿 |
| 文档 | final closure memo + handoff shipped;charter §11 同步修订 |
| 风险收敛 | Tier B 未被物理删除;NACP 版本未 bump;production env 未误 flip |
| 可交付性 | worker-matrix 进入 "等待下一阶段 trigger" 状态;live loop stability 2-4 周监控可开始 |

---

## 9. 执行后复盘关注点

- Phase 1 `.npmrc` readiness 最终走哪条路径(未落仓 / 落在 `workers/<name>/` / 落在 `workers/` / 落在 root)
- Phase 2 的 9 PR 实际节奏(串行 / 并行批)与 Q1 建议偏差
- R5 的 capability-runtime / agent-runtime-kernel 选 README-only 还是 minimal stub
- live probe `nacp_core_version` 字段源头是否真的切到 published-path(build-time vs runtime read 差别;具体 lockfile 表面 tarball / registry version 均可,per R5)
- charter §11 同步修订是否在 Phase 1 PR 内被 reviewer 注意到
- handoff memo 是否真的在 P5 当日写就;还是延迟到 live loop stability 2-4 周后才具体

---

## 10. 结语

这份 P5 action-plan 以 **"workspace:* interim 退役 + Tier B 吸收真相诚实标注 + worker-matrix 正式收口"** 为第一优先级,采用 **"独立 release PR 原子 cutover + per-worker deprecation 流水 + closure + handoff"** 的推进方式,优先解决 **"4 workers 未真走 published path / 9 Tier B 未打 banner / 3 placeholder 未清点 / 阶段未收口"** 四件 release hygiene 欠账,并把 **"Tier B 物理保留 / NACP 版本不 bump / production 不 flip / tenant wrapper 不绕过 / B7 LIVE 不破 / R4 .npmrc 诚实化 / R5 no-CHANGELOG 二路径"** 作为主要约束。整个计划完成后,`worker-matrix` 应达到 **"charter §9 primary 6 exit criteria 全绿 + workers 从 published registry install NACP + Tier B 吸收真相在 README/CHANGELOG 落盘 + 最终 closure/handoff 就位"**,从而让本阶段以诚实、可审计、可回滚的方式正式闭合,为后续 live loop stability 2-4 周监控或 scope expansion trigger 提供稳定起点。

---

## 11. P5 执行工作报告(Claude Opus 4.7, 2026-04-23)

### 11.1 执行综述

- **判断结果**:P5 可以进入 — Phase 0-4 全部完成
- **Phase 序列**:Phase 0 gate → Phase 1 cutover(含 `.npmrc` readiness 落盘)→ Phase 2 9 Tier B banner → Phase 3 W3 pattern 清点 → Phase 4 final closure + handoff
- **总规模**:workers/*/package.json 4 改 + 根 `.npmrc` 新建 + 9 README banner + 7 CHANGELOG entries + W3 pattern §15 新增 + final closure memo(~300 行)+ handoff memo(~150 行)+ charter §11 update
- **deploy**:agent-core preview redeploy 成功;新 Version ID `1d423bfc-4d54-4fed-b84c-f47586b79728`;live probe 字段保持
- **R4 readiness verdict**:owner 在 P5 当日提供 classic PAT `read:packages` scope;`.npmrc` 落在 root(覆盖 4 workers);CI / wrangler / local-dev 使用同一 `${NODE_AUTH_TOKEN}` 占位符模式
- **R5 deprecation**:`capability-runtime` + `agent-runtime-kernel` 2 无-CHANGELOG 包均选 **README-only** 路径(不补 minimal stub,per R5 二选一)

### 11.2 全部新增文件清单

- `.npmrc`(root)— 3 行;`@haimang:registry=https://npm.pkg.github.com` + `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` + `always-auth=true`
- `docs/issue/worker-matrix/worker-matrix-final-closure.md` — ~300 行,含 6 exit criteria 映射 + 9 Tier B deprecation 表 + handoff 段 + cross-cut 不变量
- `docs/handoff/worker-matrix-to-next.md` — ~150 行,含 2 trigger 候选 + 5 layers truth pack + kickoff checklist + open questions + 硬约束

### 11.3 全部修改文件清单

**workers/ package.json(Phase 1 cutover)**:
- `workers/agent-core/package.json` — `@haimang/nacp-core` workspace:* → `"1.4.0"`;`@haimang/nacp-session` workspace:* → `"1.3.0"`
- `workers/bash-core/package.json` — 同构
- `workers/context-core/package.json` — 同构
- `workers/filesystem-core/package.json` — 同构

**pnpm-lock.yaml(Phase 1 cutover)**:
- 4 workers 的 `@haimang/nacp-core` resolution 从 `link:../../packages/nacp-core` 切到 `1.4.0(zod@3.25.76)`
- 同理 nacp-session 切到 `1.3.0(zod@3.25.76)`

**packages/* README(Phase 2 — 9 文件)**:全部顶部加 `⚠️ DEPRECATED` banner block
- `packages/session-do-runtime/README.md`
- `packages/capability-runtime/README.md`(R5 README-only)
- `packages/agent-runtime-kernel/README.md`(R5 README-only)
- `packages/llm-wrapper/README.md`
- `packages/hooks/README.md`(runtime residual only;wire catalog 不 deprecate)
- `packages/eval-observability/README.md`(runtime residual only;B7 LIVE 仍 root guardian)
- `packages/context-management/README.md`
- `packages/workspace-context-artifacts/README.md`(C2+D1 split 同步)
- `packages/storage-topology/README.md`(tenant wrapper 不 deprecate)

**packages/* CHANGELOG(Phase 2 — 7 文件)**:全部顶部加 `## Unreleased — 2026-04-23 (worker-matrix P5/D09 DEPRECATED)` 段
- `packages/session-do-runtime/CHANGELOG.md`
- `packages/llm-wrapper/CHANGELOG.md`
- `packages/hooks/CHANGELOG.md`(runtime residual wording)
- `packages/eval-observability/CHANGELOG.md`(runtime residual wording)
- `packages/context-management/CHANGELOG.md`
- `packages/workspace-context-artifacts/CHANGELOG.md`(C2+D1 split 同步 wording)
- `packages/storage-topology/CHANGELOG.md`(tenant wrapper 不 deprecate wording)

**docs(Phase 3 + 4)**:
- `docs/design/pre-worker-matrix/W3-absorption-pattern.md` — §15 新增 "第 3 placeholder(循环引用)最终状态" 章节 + §15.1 3 placeholder 最终清点表;§14 verdict 更新
- `docs/plan-worker-matrix.md` — §11.1 列出全部 5 phase closure link + P5 final closure link;§11.2 状态标 `closed`

**本文件回填(Phase 4)**:
- `docs/action-plan/worker-matrix/P5-cutover-and-deprecation.md` — 本 §11 工作报告

### 11.4 Live deploy 证据

- agent-core Preview URL:`https://nano-agent-agent-core-preview.haimang.workers.dev`
- 新 Version ID:`1d423bfc-4d54-4fed-b84c-f47586b79728`(cutover 后 redeploy)
- Upload:290.80 KiB → **318.73 KiB**;gzip 58.62 KiB → **63.48 KiB**(published NACP bundle 被实际打进 deploy artifact)
- Startup:15 ms → 21 ms(可接受,bundle 稍大)
- curl probe JSON:`{"worker":"agent-core","nacp_core_version":"1.4.0","nacp_session_version":"1.3.0","status":"ok","phase":"worker-matrix-P2-live-loop","absorbed_runtime":true,"live_loop":true,"capability_binding":true}` — 字段值与 P2 完全一致(cutover 是源头切换,不是 probe 字段 bump)
- `/sessions/check-p3p4/status` → HTTP 200 `{"ok":true,"action":"status","phase":"unattached"}` — SESSION_DO forwarding 仍活
- bash-core Preview URL 保持 live(Version `50335742-e9e9-4f49-b6d7-ec58e0d1cfb4` 不变)

### 11.5 Test 回归(与 P5 action-plan §4 各 DoD 对比)

| target | 实测 | P5 DoD 要求 |
|--------|------|-------------|
| `workers/agent-core test` | 1027 绿 | 全绿 |
| `workers/bash-core test` | 355 绿 | 全绿 |
| `workers/context-core test` | 170 绿 | 全绿 |
| `workers/filesystem-core test` | 293 绿 | 全绿 |
| `pnpm -r run test` | 15 projects 全绿 | 全绿 |
| `node --test test-legacy/*.test.mjs`(含 B7 LIVE)| 107 绿 | 全绿 |
| `npm run test:cross` | 121 绿 | 全绿 |
| `pnpm --filter './workers/*' run deploy:dry-run` | 4 workers 全绿 | 全绿 |

**说明**:P5 DoD 原文 references "98 root + 112 cross",但这是 PX test tree rename 之前的老路径。PX 把 `test/` → `test-legacy/` 后,npm scripts `test:contracts / test:cross / test:e2e` 同步指向 `test-legacy/`,实测 `node --test test-legacy/*.test.mjs` 107 / `test:cross` 121。数字比 P4 时(98 / 112)增多原因是 P2 两条 root e2e + P3/P4 review 时增补的几条覆盖;regression 口径等价(原 98/112 都在,新增都绿)。

### 11.6 charter §9 primary exit criteria 全绿映射(与 final closure memo §1 对照)

| # | criterion | 状态 |
|---|-----------|------|
| 1 | live agent turn loop 端到端 | ✅ P2 两条 root e2e + live URL 验证 |
| 2 | 4 workers runtime ownership 吸收 | ✅ P1-P4 全 absorbed;workers/*/src/ 是 canonical |
| 3 | `@haimang/nacp-*` published path cutover | ✅ **本 P5 Phase 1 完成** |
| 4 | Tier B DEPRECATED(9 包)| ✅ **本 P5 Phase 2 完成** |
| 5 | 全仓 test 仍全绿 | ✅ 详见 §11.5 |
| 6 | final closure + handoff shipped | ✅ **本 P5 Phase 4 完成** |

**6/6 全绿**;worker-matrix 阶段正式 closed。

### 11.7 R4 / R5 / R3 吸收验证

- **R4(`.npmrc` readiness 诚实化)**:owner 在 P5 当日补齐 `read:packages` scope PAT;root `.npmrc` 落仓(使用 `${NODE_AUTH_TOKEN}` 占位符,token 本体不入 git);验证 `pnpm install` → `pnpm-lock.yaml` 所有 worker/@haimang 条目切到非 `link:` — done per R5 truth
- **R5(no-CHANGELOG fallback)**:`packages/capability-runtime/` + `packages/agent-runtime-kernel/` 均选 README-only 路径;DEPRECATED banner 写明 "R5 README-only" 口径;无 minimal stub CHANGELOG 被创建(不搞半吊子历史)
- **R3(其他 review R3)**:bash-core `/tool.call.request` 仍 404,binding-first 口径保持

### 11.8 对未来的影响

- worker-matrix 阶段 `closed` — 下一阶段等待 trigger
- 所有 9 个 Tier B 包的物理删除 timeline 由下一阶段(live loop stability trigger 之后)决定;现在删会破坏 coexistence
- `.npmrc` 已经落仓,使用 `${NODE_AUTH_TOKEN}` 占位符;CI / wrangler / 新开发者都按该模式,不会再遇本次 cutover 的 token 障碍

### 11.9 已知限制(保留给下一阶段)

1. WCA coexistence duplicate(context slice / artifact slice)的 one-shot ownership switch 延到下一阶段
2. filesystem-core 当前 0 runtime consumer(Q4a posture);是否切 agent-core WCA consumer path 归下一阶段
3. Tenant wrapper CI grep guard 仍靠人工 review;建议下一阶段固化
4. PX root test tree reset(独立于 worker-matrix)可继续推进

### 11.10 结论

P5 Phase 0-4 全部完成;worker-matrix 阶段 6 条 primary exit criteria 全绿;released path cutover + 9 Tier B deprecation + final closure + handoff 全部 ship;agent-core preview redeploy 后 live probe 保持 `live_loop: true` + `capability_binding: true`。**worker-matrix 阶段正式 closed;下一阶段等待 trigger 激活。**
