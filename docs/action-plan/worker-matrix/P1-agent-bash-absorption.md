# P1 — agent-core + bash-core Absorption

> 服务业务簇: `worker-matrix / Phase 1 — A1-A5 + B1 Absorption`
> 计划对象: `D01(agent-core A1-A5 吸收)+ D02(bash-core B1 吸收,含 R3 binding-first entry + F6 real preview deploy)`
> 类型: `migration`(package → worker 吸收;byte-identical 语义)+ `new`(workers/{agent,bash}-core/src 真实 runtime)+ `modify`(index.ts / package.json / wrangler)
> 作者: `Claude Opus 4.7 (1M context)`
> 时间: `2026-04-23`
> 文件位置:
> - `workers/agent-core/src/{host/,kernel/,llm/,hooks/,eval/}`(A1-A5 吸收目的地)
> - `workers/agent-core/test/`(A1-A5 **package-local** tests;root contract / cross tests 留在 root,不迁 — per P1-P5 GPT review R4)
> - `workers/bash-core/src/{core/,fake-bash/,capabilities/,targets/,index.ts}`(B1 吸收目的地)
> - `workers/bash-core/test/`(B1 tests)
> - `workers/{agent-core,bash-core}/package.json`
> - `packages/{session-do-runtime,agent-runtime-kernel,llm-wrapper,hooks,eval-observability,capability-runtime}/**`(共存期保持原位,不动)
> 关联设计 / 调研文档:
> - `docs/plan-worker-matrix.md` §4.1 / §4.2 / §5.2-5.3 / §6.1(P1 DoD)
> - `docs/design/worker-matrix/D01-agent-core-absorption.md`(A1-A5 归属)
> - `docs/design/worker-matrix/D02-bash-core-absorption.md` v0.2(B1 + R3 binding-first + F6 preview deploy)
> - `docs/design/pre-worker-matrix/W3-absorption-map.md`(10 units)
> - `docs/design/pre-worker-matrix/W3-absorption-pattern.md`(10 disciplines;3 placeholder 本 phase 回填)
> - `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md`(B1 代表)
> - `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md`(A1 代表)
> - `docs/design/worker-matrix/blueprints/A2/A3/A4/A5/A1-A5-sub-pr-granularity.md`(P0 补齐)
> - `docs/issue/worker-matrix/P0-absorption-prep-closure.md`(kickoff checklist + P2.E0 owner 决策)
> 文档状态: `draft`

---

## 0. 执行背景与目标

P0 已把 blueprint + owner 决策 + R1-R5 吸收索引全部落盘,P1 的任务是在 **不动任何 NACP / schema / wire 契约** 的前提下,把 **A1-A5(session-do-runtime / agent-runtime-kernel / llm-wrapper / hooks residual / eval-observability residual)整体吸收进 `workers/agent-core/src/`**,以及把 **B1(capability-runtime 整包)吸收进 `workers/bash-core/src/`**,并在 P1.B 收尾时完成 **`workers/bash-core` real preview deploy**(D02 F6),作为 P2 硬前置(per GPT R1)。

P1 内部两组可以真正并行(P1.A agent-core 组 + P1.B bash-core 组),但组内必须按 sub-PR 序列推进:P1.A 按 Q1c 拆 2-3 sub-PR(A1-A5 不是 5 份独立 PR),P1.B 按 B1 代表 blueprint 一次 PR 完成,末尾触发 F6 real preview deploy。

整个 P1 结束后:
- `workers/agent-core/src/` 含 host/kernel/llm/hooks/eval 5 组吸收后 runtime
- `workers/bash-core/src/` 含完整 capability-runtime(21 commands + fake-bash + typed runtime + honest-partial)
- 两个 worker `pnpm --filter workers/<name> test` 全绿
- 两个 worker `deploy:dry-run` 全绿;**bash-core 额外达成 real preview deploy live URL + `curl` 合法 JSON**
- B7 LIVE 5 tests / 98 root tests / 112 cross tests 全绿
- W3 pattern spec 的 "LOC→时长系数" + "可执行流水线样板" 两节在首批 absorb PR 内被回填
- 共存期规则就位:`packages/{session-do-runtime,agent-runtime-kernel,llm-wrapper,hooks,eval-observability,capability-runtime}/` 保留物理存在,**未打 DEPRECATED**(D09 / P5 才打)

- **服务业务簇**:`worker-matrix / Phase 1 — agent+bash absorption`
- **计划对象**:A1-A5(agent-core)+ B1(bash-core)共 6 个 units 的机械吸收 + B1 末尾 real preview deploy
- **本次计划解决的问题**:
  - `workers/agent-core/src/index.ts` 仍是 version-probe shell,未吸收任何 substrate`
  - `workers/bash-core/src/index.ts` 仍是 version-probe,agent↔bash loop 没有可命中的 binding 目标`
  - P2 的 default composition 装配缺物理吸收源头,无法装 kernel/llm/capability/workspace/hooks/eval 全量 handle`
  - W3 pattern spec 3 个 placeholder 节仍为空,后续阶段无 LOC→时长 / 可执行流水线 / 循环引用 pattern`
- **本次计划的直接产出**:
  - `workers/agent-core/src/` 真实 host + kernel + llm + hooks + eval runtime
  - `workers/bash-core/src/` 真实 capability-runtime(21 commands + fake-bash + targets + policy)
  - `workers/bash-core` real preview deploy live URL + `curl` 合法 JSON + wrangler Version ID 记录
  - 共存期纪律落地:`packages/*` 原位保留,bug 先修原包(W3 pattern §6)
  - W3 pattern spec "LOC→时长" / "可执行流水线" 回填

---

## 1. 执行综述

### 1.1 总体执行方式

**组间并行,组内序列**:P1.A(agent-core)+ P1.B(bash-core)两个 PR sequence 独立,可以同时打开;组内按 sub-PR 顺序推进。每一个 sub-PR 独立可以 revert,不跨组依赖。P1.B 末尾的 F6 real preview deploy 是整个 P1 的收口门。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | P1.A-sub1 host shell + kernel 吸收 | `L` | A1 + A2 搬到 `workers/agent-core/src/host/` + `src/kernel/`;packages 保留 | P0 closed + A1/A2 blueprint |
| Phase 2 | P1.A-sub2 llm + hooks + eval 吸收 | `M` | A3 + A4 + A5 搬到 `workers/agent-core/src/{llm,hooks,eval}/` | Phase 1 绿 |
| Phase 3 | P1.A-sub3 index.ts + package.json + W3 pattern 回填 | `S` | `workers/agent-core/src/index.ts` 从 probe 升到 host runtime entry;package.json 补 deps;W3 pattern "LOC→时长" + "可执行流水线" 回填 | Phase 2 绿 |
| Phase 4 | P1.B B1 capability-runtime 一次 PR | `L` | `packages/capability-runtime/{src,test}` → `workers/bash-core/{src,test}`;index.ts 升 binding-first(R3 口径:`/capability/call` + `/capability/cancel`);package.json + wrangler 不漂移 | P0 closed(与 P1.A 并行)|
| Phase 5 | P1.B F6 real preview deploy(P2 硬前置)| `XS` | `pnpm --filter workers/bash-core run deploy:preview` 成功 + `curl` 返回合法 JSON + Version ID 记录 | Phase 4 绿 |
| Phase 6 | 全仓回归 + P1 closure | `S` | 98 root tests + 112 cross + workers/{agent,bash} test + dry-run 全绿;写 P1 closure memo | Phase 1-5 绿 |

### 1.3 Phase 说明

1. **Phase 1 — P1.A-sub1 host shell + kernel**:先搬 `session-do-runtime` 整 host shell(DO 类体 / worker entry / WS ingress / dispatchAdmissibleFrame 空壳 + composition.ts + remote-bindings.ts)+ `agent-runtime-kernel` kernel runtime。host shell 是 A1-A5 的 "壳中心",必须先落,后续 A3-A5 才能以 `workers/agent-core/src/host/composition/` 为单一 composition 中心
2. **Phase 2 — P1.A-sub2 llm + hooks + eval**:A3 `llm-wrapper` / A4 `hooks` runtime residual / A5 `eval-observability` runtime sink + inspector seam 一次搬进 3 个 subdir(`src/llm/` / `src/hooks/` / `src/eval/`)。hooks / eval 的 NACP wire catalog(`hooks-catalog.ts` / evidence vocabulary schema)**不迁** — 归 `@haimang/nacp-core`
3. **Phase 3 — P1.A-sub3 index.ts 升级 + W3 pattern 回填**:`workers/agent-core/src/index.ts` 从 version-probe 升到 "真 host worker entry"(re-export DO + worker entry + 保留 probe JSON 字段兼容 W4);同一 PR 内回填 W3 pattern spec 两个 placeholder(借 A1-A5 实测 LOC + 流水线命令)
4. **Phase 4 — P1.B B1 一次 PR**:按 W3 代表 blueprint 一次性把 `packages/capability-runtime/` 全包搬进 `workers/bash-core/`;`index.ts` 按 D02 v0.2(R3 binding-first)升级 — 暴露 `/capability/call` + `/capability/cancel` 两条 internal path,**不**开 `/tool.call.request` public HTTP
5. **Phase 5 — F6 real preview deploy**:P2 硬前置(per GPT R1)+ D02 F6 — deploy、`curl` probe、记录 Version ID
6. **Phase 6 — 全仓回归 + closure**:B7 LIVE 5 + 98 root + 112 cross + 两个 workers test 和 dry-run 全绿;写 `docs/issue/worker-matrix/P1-closure.md`

### 1.4 执行策略说明

- **执行顺序原则**:组间并行(P1.A 与 P1.B),组内序列(sub-PR 1→2→3;B1 一次然后 F6)
- **风险控制原则**:每个 sub-PR 独立可 revert;B7 LIVE 5 tests 是每个 sub-PR 的 block gate;`packages/*` 保留,不动
- **测试推进原则**:每个 sub-PR 跑 `workers/<name> test` + 全仓 `pnpm -r run test` + root `node --test test/*.test.mjs` + cross tests;F6 跑 curl probe;不允许 B7 LIVE 红着 merge
- **文档同步原则**:首批 absorb PR 内回填 W3 pattern spec;P1 closure 写 memo,不重复写在各 sub-PR body

### 1.5 本次 action-plan 影响目录树

```text
worker-matrix/P1/
├── P1.A agent-core absorption PR sequence (3 sub-PR)/
│   ├── sub-PR-1: host shell + kernel
│   │   ├── workers/agent-core/src/host/        [A1]
│   │   │   ├── do/nano-session-do.ts           [from packages/session-do-runtime/src/do/]
│   │   │   ├── composition/                    [from packages/session-do-runtime/src/composition.ts + remote-bindings.ts]
│   │   │   ├── worker.ts                       [from packages/session-do-runtime/src/worker.ts]
│   │   │   └── orchestration/                  [from packages/session-do-runtime/src/orchestration.ts]
│   │   └── workers/agent-core/src/kernel/      [A2 from packages/agent-runtime-kernel/src/]
│   ├── sub-PR-2: llm + hooks + eval
│   │   ├── workers/agent-core/src/llm/         [A3]
│   │   ├── workers/agent-core/src/hooks/       [A4 — wire catalog 不迁]
│   │   └── workers/agent-core/src/eval/        [A5 — BoundedEvalSink + inspector seam]
│   └── sub-PR-3: index.ts + package.json + W3 pattern
│       ├── workers/agent-core/src/index.ts     [from probe → host entry]
│       ├── workers/agent-core/package.json     [+ devDeps]
│       └── docs/design/pre-worker-matrix/W3-absorption-pattern.md  [2 placeholder 回填]
├── P1.B bash-core absorption 一次 PR/
│   ├── workers/bash-core/src/
│   │   ├── core/                               [from packages/capability-runtime/src/ runtime core]
│   │   ├── fake-bash/                          [21-command registry + bridge]
│   │   ├── capabilities/                       [7 capability handlers]
│   │   ├── targets/                            [service-binding / local-ts targets]
│   │   └── index.ts                            [binding-first: /capability/call + /capability/cancel (R3)]
│   ├── workers/bash-core/test/                 [from packages/capability-runtime/test/]
│   ├── workers/bash-core/package.json          [+ devDeps]
│   └── workers/bash-core/wrangler.jsonc        [不漂移,name: nano-agent-bash-core]
├── P1.B F6 real preview deploy/
│   ├── preview URL live + `curl` JSON 合法
│   └── Version ID 记录在 P1 closure memo
└── P1 closure/
    └── docs/issue/worker-matrix/P1-closure.md  [memo 含 P1.A + P1.B 全 DoD + W3 pattern 回填 link]
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope

- **[S1]** P1.A-sub1:A1 整 host shell + A2 kernel 搬进 `workers/agent-core/src/{host,kernel}/`;保持 byte-identical runtime 语义;`packages/session-do-runtime` + `packages/agent-runtime-kernel` 原位保留;**package-local tests 随 src 搬到 `workers/agent-core/test/{host,kernel}/`;root `test/*.test.mjs` 与 `test/e2e/**` 不搬**(per P1-P5 GPT review R4)
- **[S2]** P1.A-sub2:A3 llm + A4 hooks residual + A5 eval residual 搬进 `workers/agent-core/src/{llm,hooks,eval}/`;hooks 的 wire catalog 仍归 `@haimang/nacp-core`,不搬;**package-local tests 随 src 搬;root contract / cross / e2e tests 不搬**(per R4)
- **[S3]** P1.A-sub3:`workers/agent-core/src/index.ts` 从 version-probe 升到 host worker entry(re-export DO + worker fetch handler + 保留 probe JSON 字段兼容 W4 preview contract);package.json 补吸收涉及的 devDeps
- **[S4]** P1.B:`packages/capability-runtime/{src,test}` 一次 PR 搬进 `workers/bash-core/{src,test}`;`index.ts` 按 D02 v0.2 升级为 binding-first(R3 口径,`/capability/call` + `/capability/cancel` internal path)
- **[S5]** P1.B F6 real preview deploy:`pnpm --filter workers/bash-core run deploy:preview` 成功;preview URL live;`curl` 返回 JSON 含 `worker:"bash-core" status:"ok" absorbed_runtime:true nacp_core_version:"1.4.0" nacp_session_version:"1.3.0"`;Version ID 记录
- **[S6]** P1 所有 sub-PR 都跑:root 侧 `node --test test/*.test.mjs`(含 B7 LIVE 5 tests,不搬)+ cross tests + package-local(两 workers test)+ dry-run 回归(per R4 保留两层测试所有权)
- **[S7]** W3 pattern spec 2 个 placeholder 节("LOC→时长系数" + "可执行流水线样板")在 P1.A-sub3 或首个 P1.A sub-PR 内回填(第 3 个 "循环引用解决 pattern" 由 P3/P4 在涉及 WCA split 时回填,本 P1 不强制)
- **[S8]** P1 closure memo(`docs/issue/worker-matrix/P1-closure.md`):含 A1-A5 实测 LOC / 时长 / PR link / W3 pattern 回填 link / B1 preview URL + Version ID / 全绿证据

### 2.2 Out-of-Scope

- **[O1]** `createDefaultCompositionFactory` 升级为真实 6-handle(归 D06 / P2)
- **[O2]** `makeRemoteBindingsFactory` 补 4 nullable(归 D06 / P2)
- **[O3]** `initial_context` host consumer 接线(归 D05 / P2)
- **[O4]** `tool.call.*` 端到端闭环激活(归 D07 / P2)
- **[O5]** C1 / C2 / D1 / D2 吸收(归 P3 / P4)
- **[O6]** `workers/agent-core` redeploy preview(agent-core 已经在 W4 有 live preview;本 phase 不重 deploy,除非 sub-PR-3 完成后 owner 决定)
- **[O7]** Tier B DEPRECATED banner / physical delete(归 P5)
- **[O8]** `workspace:*` → `@haimang/*` 切换(归 P5 D08)
- **[O9]** 改 NACP wire vocabulary / session message matrix / tenant wrapper 任一契约(B9 / W0)
- **[O10]** 升级 W1 RFC 为 shipped runtime(charter §2.3 / §3.2 O2)
- **[O11]** 扩 21-command registry / 放宽 curl budget / ts-exec not-connected(D02 §5.2 O);任何 verb 扩走 capability-runtime RFC
- **[O12]** 物理删除 `packages/capability-runtime` / `packages/session-do-runtime` 等 6 个被吸收包(归 下一阶段)

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| A1-A5 拆几个 sub-PR(2 / 3 / 4)| `defer / P1.A owner in kickoff` | Q1c 给 owner 最终自由度;本 action-plan 建议 3 | P1.A kickoff PR |
| B1 是否拆 sub-PR | `out-of-scope / 一次 PR` | D02 §5.1 / W3 blueprint 明确一次搬 | NOT revisit |
| `workers/agent-core` redeploy preview | `out-of-scope P1` | W4 已有 live preview;P2 在 BASH_CORE binding 激活后重 deploy 更合适 | P2 |
| `workers/bash-core` real preview deploy 归属 | `in-scope P1.B 末尾 / Phase 5` | 作为 P2 硬前置,必须在 P1 内完成 | — |
| `hooks-catalog` 是否一并搬进 `workers/agent-core/src/hooks/` | `out-of-scope`(仍归 @haimang/nacp-core)| wire catalog 永久外部 | NOT revisit |
| BoundedEvalSink 改内部实现 | `out-of-scope` | B7 LIVE 契约,byte-identical | NOT revisit |
| W3 pattern 第 3 placeholder(循环引用)| `out-of-scope P1` | 要等 WCA split 真执行后回填 | P3 / P4 |
| 共存期 bug 先修哪里 | `packages 原包先修` | W3 pattern §6 | — |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | A1 host shell 搬迁 | migration | `packages/session-do-runtime/src/**` → `workers/agent-core/src/host/**` | byte-identical DO + worker entry + composition 空壳 | high |
| P1-02 | Phase 1 | A2 kernel 搬迁 | migration | `packages/agent-runtime-kernel/src/**` → `workers/agent-core/src/kernel/**` | byte-identical kernel runtime | medium |
| P1-03 | Phase 1 | host + kernel 的 **package-local** test 搬迁(per R4)| migration | `packages/{session-do-runtime,agent-runtime-kernel}/test/**` **package-local** → `workers/agent-core/test/{host,kernel}/**` | package-local tests 全绿;**root `test/*.test.mjs` 与 `test/e2e/*.test.mjs` 不搬**(B7 LIVE 等 root guardians 继续在 root 跑)| medium |
| P1-04 | Phase 1 | import rewrite(sub1 范围)| update | 被搬的 .ts 内部 import | 相对 import 保留;外部 `@haimang/nacp-*` / `@nano-agent/*` 不变 | medium |
| P2-01 | Phase 2 | A3 llm 搬迁 | migration | `packages/llm-wrapper/{src,test}/**` → `workers/agent-core/{src/llm,test/llm}/**` | byte-identical llm runtime | medium |
| P2-02 | Phase 2 | A4 hooks residual 搬迁 | migration | `packages/hooks/{src,test}/**` runtime residual → `workers/agent-core/{src/hooks,test/hooks}/**` | wire catalog 不迁 | medium |
| P2-03 | Phase 2 | A5 eval residual 搬迁 | migration | `packages/eval-observability/{src,test}/**` → `workers/agent-core/{src/eval,test/eval}/**` | B7 LIVE 契约不漂 | high |
| P3-01 | Phase 3 | `index.ts` 升级 | update | `workers/agent-core/src/index.ts` | probe → host worker entry(re-export DO + fetch handler) | medium |
| P3-02 | Phase 3 | package.json 更新 | update | `workers/agent-core/package.json` | 补 A1-A5 所需 devDeps;dependencies 对齐 `@haimang/nacp-*` workspace:* | low |
| P3-03 | Phase 3 | W3 pattern 回填 | update | `docs/design/pre-worker-matrix/W3-absorption-pattern.md` | "LOC→时长系数" + "可执行流水线样板" 两节用 A1-A5 实测填入 | low |
| P4-01 | Phase 4 | B1 src 搬迁 | migration | `packages/capability-runtime/src/**` → `workers/bash-core/src/**`(按 W3 blueprint §3 目标目录)| 21-command + fake-bash + targets 整体搬 | high |
| P4-02 | Phase 4 | B1 **package-local** test 搬迁(per R4)| migration | `packages/capability-runtime/test/**` **package-local** → `workers/bash-core/test/**`;**root `test/capability-toolcall-contract.test.mjs` 等 root guardians 不搬** | 352 tests 全绿 + root contract guardian 仍绿 | medium |
| P4-03 | Phase 4 | `workers/bash-core/src/index.ts` 升级(R3 binding-first)| update | `workers/bash-core/src/index.ts` | binding-first:`/capability/call` + `/capability/cancel`;**不**开 `/tool.call.request` public HTTP | high |
| P4-04 | Phase 4 | `workers/bash-core/package.json` + wrangler | update | 两文件 | devDeps 补齐;wrangler name 不漂移 | low |
| P5-01 | Phase 5 | F6 real preview deploy | new | `workers/bash-core` deploy:preview | URL live + curl 合法 JSON + Version ID 记录 | medium |
| P6-01 | Phase 6 | 全仓回归 | test | 全仓 | B7 LIVE 5 + 98 root + 112 cross + 两个 workers test + dry-run 全绿 | high |
| P6-02 | Phase 6 | P1 closure memo | add | `docs/issue/worker-matrix/P1-closure.md` | 含 A1-A5 + B1 实测 LOC / 时长 / preview URL + Version ID / 全绿证据 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — P1.A-sub1 host shell + kernel(A1 + A2)

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | A1 host shell 搬 | `cp -r packages/session-do-runtime/src/* workers/agent-core/src/host/`(按 A1 代表 blueprint §3 目录重组);保留 byte-identical 语义;不动 consumer 逻辑 | `workers/agent-core/src/host/{do,composition,worker,orchestration}/` | 文件存在;import 正确 | `pnpm --filter workers/agent-core typecheck` 绿 | 编译通过 + no diff semantic |
| P1-02 | A2 kernel 搬 | `cp -r packages/agent-runtime-kernel/src/* workers/agent-core/src/kernel/` | `workers/agent-core/src/kernel/` | 文件存在;import 正确 | 同上 | 同上 |
| P1-03 | package-local tests 搬(R4)| `packages/{session-do-runtime,agent-runtime-kernel}/test/**` **package-local** 文件 → `workers/agent-core/test/{host,kernel}/`;**不搬** root `test/*.test.mjs` / `test/e2e/*.test.mjs` / `test/verification/**`(B7 LIVE / 21+ root contract tests / cross tests 继续作 root gate)| workers/agent-core/test(package-local)+ root `test/`(guardians 原位)| package-local 绿 + root guardians 仍绿 | `pnpm --filter workers/agent-core test` + `node --test test/*.test.mjs` 两者分别跑 | 0 failure 两端;root 未被误搬 |
| P1-04 | import rewrite | 内部相对 import 保持;对 `@haimang/nacp-*` / `@nano-agent/*` 不变;对被搬兄弟 package 的 cross import(如 kernel → session)调整到 `workers/agent-core/src/` 内部路径 | 被搬 .ts | 无 dangling import | `pnpm --filter workers/agent-core typecheck` 绿 | grep `@nano-agent/session-do-runtime` == 0(在 workers/agent-core/src/ 内)|
| P1-05 | 全仓回归 | B7 LIVE + 98 root + 112 cross | 全仓 | 全绿 | `node --test test/*.test.mjs && npm run test:cross && pnpm -r run test` | 0 failure |
| P1-06 | W3 pattern §6 共存期纪律落地 | `packages/session-do-runtime/` + `packages/agent-runtime-kernel/` 保留;本 sub-PR 内任一后续 bug 先改原包再同步 workers/ | `packages/*` + `workers/agent-core/src/host,kernel/` | 共存 | PR review gate + grep | PR body 明确 "共存期 bug 先修原包" |

### 4.2 Phase 2 — P1.A-sub2 llm + hooks + eval(A3 + A4 + A5)

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | A3 llm 搬 | `cp -r packages/llm-wrapper/src/* workers/agent-core/src/llm/` + tests | `workers/agent-core/src/llm/` + `test/llm/` | 文件齐 | `pnpm --filter workers/agent-core test` 绿 | 0 failure |
| P2-02 | A4 hooks residual 搬 | runtime dispatcher / registry 搬;**wire catalog 不迁** — `hooks-catalog.ts` 保留在 `@haimang/nacp-core` | `workers/agent-core/src/hooks/` + `test/hooks/` | 文件齐 + catalog 不在此处 | `grep "hooks-catalog" workers/agent-core/src/` == 0 | 仅 runtime residual |
| P2-03 | A5 eval residual 搬(R4)| `BoundedEvalSink` + `InspectorSeam` 搬;保留 dedup / overflow disclosure(B7 LIVE 契约);**eval package-local tests 随 src 搬**;**B7 LIVE root tests 不搬**(作为 root gate 继续保护 dedup / overflow 契约)| `workers/agent-core/src/eval/` + package-local `test/eval/` + root B7 LIVE 原位 | 文件齐 + root B7 LIVE 不动 | `pnpm --filter workers/agent-core test` 绿 + root `node --test test/b7-round2-integrated-contract.test.mjs` 绿 | 0 failure + B7 LIVE 未被移动且未红 |
| P2-04 | import rewrite(sub2 范围)| llm / hooks / eval 之间相对 import + 回落 `host` 的 import | 被搬 .ts | 无 dangling | typecheck 绿 | — |
| P2-05 | 全仓回归 | 同 P1-05 | 全仓 | 全绿 | 同上 | 0 failure |

### 4.3 Phase 3 — P1.A-sub3 index.ts + package.json + W3 pattern 回填

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | `index.ts` 升级 | probe → host entry:re-export `NanoSessionDO` + worker `fetch` handler;保留 W4 probe JSON 字段(`status / worker / nacp_core_version / nacp_session_version`)兼容 | `workers/agent-core/src/index.ts` | `curl <preview>/` 返回含 `status: "ok"` + 新字段 `absorbed_runtime: true` 或等价 JSON | `pnpm --filter workers/agent-core run deploy:dry-run` 绿 | dry-run 绿 + 字段 list 完整 |
| P3-02 | package.json | 补 A1-A5 所需 devDeps(vitest / typescript / zod 等 — 取自 6 个源 package 的 devDeps 合并);dependencies 对 `@haimang/nacp-*` 保持 `workspace:*` | `workers/agent-core/package.json` | `pnpm install` 绿 | `pnpm install && pnpm --filter workers/agent-core typecheck` 绿 | 无 peer-dep warning |
| P3-03 | W3 pattern 回填 | 用 A1-A5 实测 LOC(Phase 1-2 累积) + 实测 PR 时长,回填 `W3-absorption-pattern.md` 两个 placeholder 节 | `docs/design/pre-worker-matrix/W3-absorption-pattern.md` | placeholder 章节非空 | `grep "TODO\|placeholder" W3-absorption-pattern.md` 剩 ≤ 1(循环引用那节)| 2 section 填实 |

### 4.4 Phase 4 — P1.B B1 capability-runtime 一次 PR

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | B1 src 搬 | `cp -r packages/capability-runtime/src/* workers/bash-core/src/`;按 W3 blueprint §3 目标目录结构重组(`core/ fake-bash/ capabilities/ targets/`)| `workers/bash-core/src/` | 目录 4 子模块齐 | `pnpm --filter workers/bash-core typecheck` 绿 | `ls workers/bash-core/src/{core,fake-bash,capabilities,targets}` 全在 |
| P4-02 | B1 test 搬 | `cp -r packages/capability-runtime/test/* workers/bash-core/test/` | `workers/bash-core/test/` | tests 文件齐 | `pnpm --filter workers/bash-core test` | 全绿(~352 tests) |
| P4-03 | `index.ts` 升级(R3 binding-first)| 按 D02 v0.2 F3 口径:`GET /` / `/health` 返回 probe JSON + `absorbed_runtime: true`;`POST /capability/call` → `CapabilityRunner.execute`;`POST /capability/cancel` → cancel;**不**开 `/tool.call.request` public HTTP | `workers/bash-core/src/index.ts` | index.ts 含两条 internal path | `grep -E "/capability/(call\|cancel)" workers/bash-core/src/index.ts` 两行;`grep "/tool.call.request" workers/bash-core/src/index.ts` 0 行 | 两条 internal path 存在,public `/tool.call.request` 不存在 |
| P4-04 | package.json + wrangler | 补 devDeps;`wrangler.jsonc` 不漂移(name: `nano-agent-bash-core`;无新 DO / service binding)| `workers/bash-core/{package.json,wrangler.jsonc}` | `pnpm install` 绿;wrangler 不动 name | `git diff workers/bash-core/wrangler.jsonc` ≤ 5 行 | wrangler name 不变 |
| P4-05 | 全仓回归 | B7 LIVE + 98 root + 112 cross | 全仓 | 全绿 | 同 P1-05 | 0 failure |

### 4.5 Phase 5 — P1.B F6 real preview deploy(P2 硬前置)

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | build | `pnpm --filter workers/bash-core run build` | `workers/bash-core/dist/**` | dist 产出 | build 绿 | dist 存在 |
| P5-02 | deploy:preview | `pnpm --filter workers/bash-core run deploy:preview` | Cloudflare preview | URL live | wrangler 输出含 preview URL + Version ID | URL 可 curl |
| P5-03 | curl probe | `curl -fsSL <preview-url>/` | — | JSON 含 `status:"ok" worker:"bash-core" absorbed_runtime:true nacp_core_version:"1.4.0" nacp_session_version:"1.3.0"` | `jq` 断言 5 字段 | 5 字段全对 |
| P5-04 | 记录 Version ID | 在 P1 closure memo 内记录 preview URL + Version ID | closure memo | 1 段 | — | Version ID 格式 UUID |

### 4.6 Phase 6 — 全仓回归 + P1 closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P6-01 | 全仓回归 | 最终一轮:`pnpm -r run typecheck && pnpm -r run test && pnpm --filter './workers/*' run deploy:dry-run && node --test test/*.test.mjs && npm run test:cross` | 全仓 | 全绿 | 该命令组绿 | 0 failure |
| P6-02 | P1 closure memo | 写 `docs/issue/worker-matrix/P1-closure.md`:含 A1-A5 + B1 实测 LOC / 时长 / 每个 sub-PR link / F6 preview URL + Version ID / W3 pattern 回填 link / 全绿证据 | `docs/issue/worker-matrix/P1-closure.md` | 300-600 行 memo | `grep "preview URL\|Version ID\|LOC"` 各 ≥ 1 | §DoD 全 checked |

---

## 5. Phase 详情

### 5.1 Phase 1 — P1.A-sub1 host shell + kernel

- **Phase 目标**:`workers/agent-core/src/{host,kernel}/` 从空升到含 A1 + A2 runtime;byte-identical 语义;B7 LIVE 不破
- **本 Phase 对应编号**:`P1-01` `P1-02` `P1-03` `P1-04` `P1-05` `P1-06`
- **本 Phase 新增文件**:`workers/agent-core/src/host/**`、`workers/agent-core/src/kernel/**`、`workers/agent-core/test/{host,kernel}/**`(均为 package-local;per R4 root `test/` 不搬)
- **本 Phase 修改文件**:无(`packages/*` 不动)
- **具体功能预期**:
  1. `workers/agent-core/src/host/do/nano-session-do.ts` 等价于原 `packages/session-do-runtime/src/do/nano-session-do.ts`
  2. `workers/agent-core/src/host/composition/index.ts` + `.../remote-bindings.ts` 等价于原;**仍是空 bag**(D06/P2 才升级)
  3. `workers/agent-core/src/kernel/` 完整吸收
  4. B7 LIVE 5 tests 继续作为 **root gate**,在 root `test/b7-round2-integrated-contract.test.mjs` 等位置跑绿(**不搬** 到 workers/agent-core/test;per R4);workers/agent-core/test 只含 package-local 单测
- **具体测试安排**:
  - **单测**:`pnpm --filter workers/agent-core test` 绿;`pnpm --filter @nano-agent/session-do-runtime test`(原包)仍绿
  - **集成测试**:`node --test test/*.test.mjs` 98/98 绿
  - **回归测试**:`npm run test:cross` 112/112 绿;B7 LIVE 5 tests 独立绿
  - **手动验证**:`grep -r "import.*from.*@nano-agent/session-do-runtime" workers/agent-core/src/` == 0
- **收口标准**:
  - workers/agent-core test 全绿
  - B7 LIVE 5 tests 全绿
  - 共存期纪律 PR body 明确(bug 先修原包)
- **本 Phase 风险提醒**:
  - A1 host shell 是 first sub-PR,若 import 改错会炸 B7 LIVE;必须每次 commit 跑 `node --test test/*.test.mjs`
  - DO identity(`idFromName(sessionId)`)不得漂移 — grep `idFromName(` 保留相同调用位点
  - `composition.ts` 空 bag 的 API signature 必须保留 —— D06 稍后升级依赖此 signature

### 5.2 Phase 2 — P1.A-sub2 llm + hooks + eval

- **Phase 目标**:A3/A4/A5 搬入 `workers/agent-core/src/{llm,hooks,eval}/`;hooks wire catalog 不迁;B7 LIVE 仍绿
- **本 Phase 对应编号**:`P2-01` `P2-02` `P2-03` `P2-04` `P2-05`
- **本 Phase 新增文件**:`workers/agent-core/src/{llm,hooks,eval}/**`、`workers/agent-core/test/{llm,hooks,eval}/**`(均为 package-local;per R4 root `test/` 不搬)
- **本 Phase 修改文件**:无
- **具体功能预期**:
  1. A3 llm 完整吸收
  2. A4 hooks dispatcher + registry runtime 吸收;wire catalog 在 `@haimang/nacp-core` 保留原位
  3. A5 BoundedEvalSink + Inspector seam 吸收;B7 LIVE dedup / overflow 契约不漂
- **具体测试安排**:
  - **单测**:`pnpm --filter workers/agent-core test` 含 llm/hooks/eval 子测试
  - **集成测试**:`node --test test/*.test.mjs` 含 B7 LIVE 5 绿
  - **回归测试**:`npm run test:cross` 绿
  - **手动验证**:`grep -r "hooks-catalog" workers/agent-core/src/` == 0
- **收口标准**:
  - 3 个子目录齐;tests 绿
  - wire catalog 未被误搬
- **本 Phase 风险提醒**:
  - BoundedEvalSink 若在搬迁时 dedup 行为漂移,B7 LIVE 会直接红
  - InspectorSeam 默认 OFF 契约(D03/P3 关联)不得在搬迁时被误开启

### 5.3 Phase 3 — P1.A-sub3 index.ts + package.json + W3 pattern 回填

- **Phase 目标**:`workers/agent-core/src/index.ts` 升级到 host entry;package.json 补 devDeps;W3 pattern 2 个 placeholder 回填
- **本 Phase 对应编号**:`P3-01` `P3-02` `P3-03`
- **本 Phase 新增文件**:无
- **本 Phase 修改文件**:
  - `workers/agent-core/src/index.ts`
  - `workers/agent-core/package.json`
  - `docs/design/pre-worker-matrix/W3-absorption-pattern.md`
- **具体功能预期**:
  1. index.ts re-export `NanoSessionDO` + worker `fetch` handler
  2. probe JSON 字段保留 + 新增 `absorbed_runtime: true` 或等价
  3. package.json 依赖 `@haimang/nacp-*` workspace:* 不变
  4. W3 pattern 2 节被实测数据填实
- **具体测试安排**:
  - **单测**:n/a
  - **集成测试**:`pnpm --filter workers/agent-core run deploy:dry-run` 绿
  - **回归测试**:全仓回归一次
  - **手动验证**:`grep -c "TODO\|placeholder" W3-absorption-pattern.md` ≤ 1(第 3 placeholder 留给 P3/P4)
- **收口标准**:dry-run 绿 + pattern 两节填实
- **本 Phase 风险提醒**:
  - index.ts 改动若破坏 W4 probe JSON shape,会让 preview URL 返回不兼容 JSON;保留字段 `status / worker / nacp_core_version / nacp_session_version` 是硬约束

### 5.4 Phase 4 — P1.B B1 一次 PR

- **Phase 目标**:`workers/bash-core/src` 含完整 capability-runtime;index.ts 按 R3 binding-first
- **本 Phase 对应编号**:`P4-01` 至 `P4-05`
- **本 Phase 新增文件**:`workers/bash-core/src/{core,fake-bash,capabilities,targets}/**`、`workers/bash-core/test/**`
- **本 Phase 修改文件**:
  - `workers/bash-core/src/index.ts`(从 probe 升到 binding-first)
  - `workers/bash-core/package.json`
  - `workers/bash-core/wrangler.jsonc`(极少改,仅在必要时)
- **具体功能预期**:
  1. 21-command registry 完整
  2. no-silent-success bridge 完整
  3. service-binding target 完整
  4. index.ts 含 `/capability/call` + `/capability/cancel` 两条 internal path;`/tool.call.request` 0 条
  5. 352 tests 全绿
- **具体测试安排**:
  - **单测**:`pnpm --filter workers/bash-core test` 352/352 绿
  - **集成测试**:`pnpm --filter workers/bash-core run deploy:dry-run` 绿
  - **回归测试**:`pnpm -r run test` 绿;B7 LIVE 不受影响
  - **手动验证**:`grep -c "/capability/call" workers/bash-core/src/index.ts` == 1;`grep -c "/tool.call.request" workers/bash-core/src/index.ts` == 0
- **收口标准**:
  - 352 tests 绿
  - dry-run 绿
  - R3 binding-first 口径在代码落实
- **本 Phase 风险提醒**:
  - 一次 PR ~9473 LOC 迁移,review 负担高 — 必须附 W3 blueprint link + diff 按目录分组
  - 21-command registry 任何新增 verb 会触发 RFC gate(charter §3.2 O6)
  - `/capability/call` body 语义必须严格对齐 `remote-bindings.ts::callBindingJson` — PR review 时交叉 grep

### 5.5 Phase 5 — P1.B F6 real preview deploy(P2 硬前置)

- **Phase 目标**:bash-core preview URL live;P2 的 `BASH_CORE` binding 有可 attach 的 worker
- **本 Phase 对应编号**:`P5-01` 至 `P5-04`
- **本 Phase 新增文件**:无
- **本 Phase 修改文件**:无(deploy 是 wrangler 行为)
- **具体功能预期**:
  1. `pnpm --filter workers/bash-core run build && run deploy:preview` 绿
  2. preview URL live
  3. curl 返回 5 字段 JSON
  4. Version ID 记录
- **具体测试安排**:
  - **手动验证**:`curl -fsSL <preview-url>/ | jq '.status == "ok" and .worker == "bash-core" and .absorbed_runtime == true'` == true
- **收口标准**:
  - URL + Version ID 在 P1 closure memo §preview 段
- **本 Phase 风险提醒**:
  - Cloudflare tokens / secrets 必须对齐 W4 agent-core 的 preview deploy owner(P0 Q3 决策)
  - 若 deploy 失败,revert 整个 P1.B PR 前先尝试 build/dry-run 本地重现,不直接 revert

### 5.6 Phase 6 — 全仓回归 + P1 closure

- **Phase 目标**:P1 整体全绿 + closure memo shipped
- **本 Phase 对应编号**:`P6-01` `P6-02`
- **本 Phase 新增文件**:`docs/issue/worker-matrix/P1-closure.md`
- **本 Phase 修改文件**:无
- **具体功能预期**:
  1. B7 LIVE 5 tests + 98 root + 112 cross + 两个 workers test + dry-run 全绿
  2. closure memo 含所有 sub-PR link + preview URL + Version ID + W3 pattern 回填 link
- **具体测试安排**:
  - **手动验证**:closure memo §DoD 每条 checkbox 都 checked
- **收口标准**:P1 DoD 全绿(charter §6.1)
- **本 Phase 风险提醒**:
  - closure memo 不写 C / D 进度(归 P3 / P4)

---

## 6. 需要业主 / 架构师回答的问题清单

### Q1 — A1-A5 sub-PR 最终数量

- **影响范围**:P1.A 内部
- **为什么必须确认**:charter Q1c 给 owner 最终自由度;本 action-plan 建议 3(sub1 host+kernel / sub2 llm+hooks+eval / sub3 index+pkg+pattern);但也可能 2(合并 sub2/sub3)或 4(拆 llm vs hooks/eval)
- **当前建议 / 倾向**:**3 sub-PR**(如上)
- **Q**:sub-PR 数?
- **A**:_pending_

### Q2 — B1 是否拆 sub-PR

- **影响范围**:P1.B
- **为什么必须确认**:B1 是 ~9473 LOC 的一次搬,review 负担重;但拆反而会破坏 byte-identical 纪律
- **当前建议 / 倾向**:**一次 PR**(D02 §5.1 / W3 blueprint 定;拆开只会增加共存期 bug)
- **Q**:一次还是多次?
- **A**:_pending_

### Q3 — F6 preview deploy 触发时机

- **影响范围**:P1.B Phase 5
- **为什么必须确认**:可以在 P1.B PR merge 当天触发,也可以等一个 deploy window
- **当前建议 / 倾向**:**P1.B merge 后 24 小时内**(对齐 P0 Q3 owner 决策;不拖到 P2 再找 owner)
- **Q**:触发窗口?
- **A**:_pending_

### Q4 — W3 pattern 第 3 placeholder(循环引用)何时回填

- **影响范围**:W3 pattern spec 完整度
- **为什么必须确认**:第 3 placeholder 只有在遇到真实循环引用场景(最可能是 WCA split)才有可回填的真相
- **当前建议 / 倾向**:**由 P3 或 P4 的 WCA split PR 回填,不塞进 P1**
- **Q**:何时?
- **A**:_pending_

### 6.2 问题整理建议

- Q1 影响 P1.A kickoff;Q3 影响 P2 启动时间
- Q2 / Q4 已有默认答,确认即可

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| A1 host shell 吸收破坏 B7 LIVE | P1-01 | `high` | 每 commit 跑 B7 LIVE;红则回滚当 commit |
| A5 BoundedEvalSink dedup 漂移 | P2-03 | `high` | B7 LIVE 测 overflow disclosure 行为;任何漂移立即回滚 |
| B1 一次 PR review 负担 | P4 | `medium` | PR body 附 W3 blueprint link + diff 分组 commit |
| `/capability/call` body 与 `remote-bindings.ts` glue 漂移 | P4-03 | `high` | PR review 时交叉 grep `callBindingJson('/capability/call'`;对 body shape 单测 |
| F6 deploy owner 未在 P0 定 | Phase 5 | `medium` | P0 Q3 若未拿到答案,P1.B merge 前 block 卡住 |
| `packages/*` 与 `workers/*` 双修漂移 | 全 phase | `medium` | W3 pattern §6:bug 先修原包,再同步 |
| W3 pattern 回填没有实测数据 | Phase 3 | `low` | 使用首批 sub-PR 的 git 时间戳 / wc -l 作为数据源 |
| wrangler.jsonc 被误改 | Phase 4 | `medium` | `git diff workers/bash-core/wrangler.jsonc` ≤ 5 行硬闸 |

### 7.2 约束与前提

- **技术前提**:P0 已 closed;blueprint 全就绪;owner 决策 Q1-Q7 confirmed
- **运行时前提**:Cloudflare preview deploy 凭证就绪(承袭 W4)
- **组织协作前提**:P2.E0 owner 在 P0 Q3 已定
- **上线 / 合并前提**:每个 sub-PR 独立 merge;B7 LIVE 红则不 merge

### 7.3 文档同步要求

- 需要同步更新的设计文档:
  - `docs/design/pre-worker-matrix/W3-absorption-pattern.md`(2 placeholder 回填)
- 需要同步更新的说明文档 / README:
  - `workers/agent-core/README.md`(若存在,新增 "absorbed runtime" 段)
  - `workers/bash-core/README.md`(若存在,同上)
- 需要同步更新的测试说明:
  - 无(B7 LIVE / root / cross tests 断言结构不变)

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**:
  - `ls workers/agent-core/src/{host,kernel,llm,hooks,eval}` 全在
  - `ls workers/bash-core/src/{core,fake-bash,capabilities,targets}` 全在
  - `grep -c "/capability/call" workers/bash-core/src/index.ts` == 1
  - `grep -c "/tool.call.request" workers/bash-core/src/index.ts` == 0
- **单元测试**:`pnpm -r run test` 全绿
- **集成测试**:`pnpm --filter './workers/*' run deploy:dry-run` 全绿
- **端到端 / 手动验证**:`curl -fsSL <bash-core-preview-url>/` 返回 5 字段 JSON
- **回归测试**:`node --test test/*.test.mjs && npm run test:cross`
- **文档校验**:closure memo §DoD 全 checked;W3 pattern §placeholder 2 节非空

### 8.2 Action-Plan 整体收口标准(= charter §6.1 P1 DoD)

1. `workers/agent-core/src/` 含吸收后的 host / kernel / llm / hooks / eval runtime(非 version-probe);`pnpm --filter workers/agent-core test` 全绿
2. `workers/bash-core/src/` 含吸收后的 capability-runtime;`pnpm --filter workers/bash-core test` 全绿
3. 两个 worker 的 `deploy:dry-run` 全绿
4. `workers/bash-core` **real preview deploy** 完成,URL live + curl 返回合法 JSON + Version ID 记录(P2 硬前置)
5. 全仓 `pnpm -r run test` 绿;root `test/*.test.mjs` 98/98 绿;`npm run test:cross` 112/112 绿;B7 LIVE 5 tests 绿
6. 首批 absorb PR 的其中一个已回填 W3 pattern spec "LOC→时长系数" + "可执行流水线样板" 两节
7. 被吸收的 Tier B packages 保留物理存在,未打 DEPRECATED(P5 才打)

### 8.3 完成定义(Definition of Done)

| 维度 | 完成定义 |
|------|----------|
| 功能 | A1-A5 + B1 代码吸收完成;index.ts 升级;preview deploy 达成 |
| 测试 | B7 LIVE 5 / 98 root / 112 cross / 两个 workers test / dry-run 全绿 |
| 文档 | closure memo shipped;W3 pattern 2 节回填 |
| 风险收敛 | 共存期纪律落地;binding-first 口径在代码;no scope creep(21-command 未扩)|
| 可交付性 | P2 可以 kickoff — `BASH_CORE` binding 有真实 worker 可 attach |

---

## 9. 执行后复盘关注点

- A1-A5 sub-PR 是否 3 个正好 / 被迫拆 4 个 / 合并成 2 个
- B1 一次 PR 的 review 时长 vs ~9473 LOC 估算
- F6 deploy 在 P1.B merge 后多久触发
- B7 LIVE 是否有任何一 commit 红过
- W3 pattern 2 节回填数据是否足以机械化 P3/P4 估算

---

## 10. 结语

这份 P1 action-plan 以 **"把 A1-A5 + B1 整体吸收进 workers/,并以 bash-core real preview deploy 合拢 P2 硬前置"** 为第一优先级,采用 **"组间并行(agent-core / bash-core)+ 组内序列(sub-PR 1→2→3 / B1 一次 + F6)"** 的推进方式,优先解决 **"workers/{agent,bash}-core/src/ 仍是 version-probe"** 与 **"agent↔bash loop 没有可 attach 的 binding 目标"** 两件核心欠账,并把 **"B7 LIVE 不得破 / 共存期 bug 先修原包 / 21-command registry 不扩 / wire catalog 不迁 / R3 binding-first 口径不漂"** 作为主要约束。整个计划完成后,`agent.core` 与 `bash.core` 应达到 **"runtime ownership 已从 packages/ 迁到 workers/ 的 src/ 内,且 bash-core preview URL live 可被 agent-core 的 BASH_CORE binding 激活"**,从而为后续的 **P2 live turn loop 装配 + initial_context consumer + tool.call 闭环** 提供稳定基础。
