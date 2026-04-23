# Nano-Agent 代码审查

> 审查对象: `worker-matrix / P3(context-core absorption)+ P4(filesystem-core absorption)by GPT-5.4`
> 审查时间: `2026-04-23`
> 审查人: `Claude Opus 4.7 (1M context)`
> 审查范围:
> - `docs/action-plan/worker-matrix/P3-context-absorption.md`(S1-S10 + O1-O11)
> - `docs/action-plan/worker-matrix/P4-filesystem-absorption.md`(S1-S7 + O1-O9)
> - `docs/issue/worker-matrix/P3-closure.md`
> - `docs/issue/worker-matrix/P4-closure.md`
> - `docs/design/worker-matrix/D03-context-core-absorption-and-posture.md`
> - `docs/design/worker-matrix/D04-filesystem-core-absorption-and-posture.md`
> - `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`(C2 / D1 split 代表 blueprint)
> - `workers/context-core/**`、`workers/filesystem-core/**`、`workers/agent-core/**`、`workers/bash-core/**`
> - `packages/workspace-context-artifacts/**`、`packages/context-management/**`、`packages/storage-topology/**`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**:`P3/P4 的主体搬迁成立,dry-run + tests 真实绿,但 closure memo 把 "context slice 源头已迁至 context-core" 表述得比代码真相更强 — 当前仍是"双份共存(duplicate)"而非"re-export",且 P4 的 mixed helper artifact 切分根本未发生`
- **结论等级**:`changes-requested`
- **本轮最关键的 3 个判断**:
  1. `context-core / filesystem-core 成功承接了被搬迁 src/ 与 test/,测试与 dry-run 数字与 closure memo 一致,owner 归位 (appendInitialContextLayer) 的 subpath 链路可 build、可 live consume`
  2. `P3 S4(packages/workspace-context-artifacts 改为 re-export)未兑现 — WCA 仍然本地 export 全部 context slice;这不是回归,但 closure memo 把 coexistence duplicate 叙述成 ownership transfer,事实口径需要收紧`
  3. `P4 S2(mixed helper artifact slice → workers/filesystem-core/src/evidence-emitters-filesystem.ts)完全未执行 — 文件不存在,buildArtifactEvidence / emitArtifactEvidence 仍只在 packages/workspace-context-artifacts/src/evidence-emitters.ts 里;P4 closure memo 没承认这条 gap,按动作计划口径属 delivery-gap`

---

## 1. 审查方法与已核实事实

- **对照文档**:
  - `docs/action-plan/worker-matrix/P3-context-absorption.md` §2.1 S1-S10(in-scope)+ §2.2 O1-O11
  - `docs/action-plan/worker-matrix/P4-filesystem-absorption.md` §2.1 S1-S7 + §2.2 O1-O9
  - `docs/design/worker-matrix/D03-context-core-absorption-and-posture.md` §4.1(mixed helper owner 表)+ §5.2 S3
  - `docs/design/worker-matrix/D04-filesystem-core-absorption-and-posture.md`
  - `docs/issue/worker-matrix/P3-closure.md` + `P4-closure.md`
- **核查实现**:
  - `workers/context-core/src/**`(30 files)+ `workers/context-core/test/**`(19 test files)
  - `workers/filesystem-core/src/**`(32 files)+ `workers/filesystem-core/test/**`(24 test files)
  - `workers/agent-core/src/host/composition.ts` / `do/nano-session-do.ts` / `context-api/append-initial-context-layer.ts` / `context-core-worker.d.ts`
  - `packages/workspace-context-artifacts/src/index.ts` + `evidence-emitters.ts`
  - `packages/context-management/` / `packages/storage-topology/`(coexistence 侧)
- **执行过的验证**:
  - `pnpm --filter @haimang/context-core-worker test` → `19 files / 170 tests 绿`(与 P3 closure §2 数字 match)
  - `pnpm --filter @haimang/filesystem-core-worker test` → `24 files / 291 tests 绿`(与 P4 closure §2 数字 match)
  - `pnpm --filter @haimang/agent-core-worker test` → `96 files / 1027 tests 绿`(与两 closure §2 数字 match)
  - `node --test test/*.test.mjs` → `107 pass`(与两 closure §2 数字 match)
  - `npm run test:cross` → `121 pass`(与两 closure §2 数字 match)
  - `pnpm --filter './workers/*' run deploy:dry-run` → 4/4 绿;bindings 列显示 agent-core 仍活着 `env.BASH_CORE (nano-agent-bash-core)`
  - `curl https://nano-agent-agent-core-preview.haimang.workers.dev/` → 返回 P2 shape `live_loop: true / capability_binding: true`(P3/P4 未打断 P2 live state)
  - `curl https://nano-agent-bash-core-preview.haimang.workers.dev/` → 返回 P1.B shape 仍 live
  - `curl .../sessions/check-p3p4/status` → `{"ok":true,"action":"status","phase":"unattached"}` HTTP 200(SESSION_DO forwarding 仍活)
  - `grep` 遍历:ContextLayerKindSchema 6 canonical kinds / 无 `"initial_context"` / 无 `"turn_input"` kind-value / `system.notify` 正确使用

### 1.1 已确认的正面事实

- `workers/context-core/src/` 含 C1 三个子目录(`budget/` `async-compact/` `inspector-facade/`)+ C2 五个 .ts 文件(`context-layers` `context-assembler` `compact-boundary` `redaction` `snapshot`)+ `evidence-emitters-context.ts`(含 7 组 export: `buildAssemblyEvidence/emitAssemblyEvidence/buildCompactEvidence/emitCompactEvidence/buildSnapshotEvidence/emitSnapshotEvidence` + 2 个结构类型)+ `context-api/append-initial-context-layer.ts`(owner 归位)
- `workers/filesystem-core/src/` 含 D1 九个 `.ts`(`types/paths/refs/artifacts/prepared-artifacts/promotion/mounts/namespace` + `backends/{memory,reference,types}`)+ D2 整包搬到 `storage/`(15 源文件 + 5 adapters)
- `workers/context-core/src/index.ts` 升级为 `phase: "worker-matrix-P3-absorbed"` + `absorbed_runtime: true`;`workers/filesystem-core/src/index.ts` 升级为 `phase: "worker-matrix-P4-absorbed"` + `absorbed_runtime: true`
- `workers/agent-core` 通过 subpath `@haimang/context-core-worker/context-api/append-initial-context-layer` 消费 helper;shim re-export 在 `workers/agent-core/src/host/context-api/append-initial-context-layer.ts`;ambient `.d.ts` 正确声明;`nano-session-do.ts:34` 直接 import 指向 context-core
- Q3c compact opt-in posture 在 `workers/agent-core/src/host/composition.ts:240` 的 kernel reason 中明确写 "no default compact delegate is auto-wired";`test/host/composition-profile.test.ts:179` 有一条 guard 断言该文字
- Q4a host-local posture 落盘三处:`workers/agent-core/wrangler.jsonc:31-38` 保留 `FILESYSTEM_CORE` 注释 + 写 reason;`workers/agent-core/src/host/composition.ts:253-255` storage handle 明确 `phase: "host-local"` + Q4a reason;`workers/filesystem-core/src/backends/reference.ts:13-104` `connected === false` 为默认
- Tenant wrapper 纪律保持:agent-core 侧所有 `storage.put/get` 调用都经过 `getTenantScopedStorage()`(nano-session-do.ts:602 is the DO-local helper;`.put/.get` call sites 均先拿 scoped storage)
- 全部 4 个 wrangler dry-run 绿;P1.B 的 bash-core live URL 仍绿;P2 的 agent-core live URL 仍绿;session forwarding 仍活
- 全仓 wire 真实性保持:`ContextLayerKindSchema` 仍是 6 canonical kinds;`"initial_context"` 从未作为 kind 出现;`"turn_input"` 从未作为 message_type / kind 出现;`system.notify` 作为 canonical error kind 正确使用
- coexistence period 纪律保持:packages/{context-management, workspace-context-artifacts, storage-topology} 仍完整存在;P5 / D09 才 deprecate

### 1.2 已确认的负面事实

- `packages/workspace-context-artifacts/src/index.ts` 仍**本地** export `context-layers / context-assembler / compact-boundary / redaction / snapshot / evidence-emitters`;没有任何 `export * from "@haimang/context-core-worker/..."` 语句 — S4 "re-export 已迁移 slice" 未兑现
- `packages/workspace-context-artifacts/src/evidence-emitters.ts:195,206` 仍完整持有 `buildArtifactEvidence` / `emitArtifactEvidence` — 这是 P4 S2 明确要求搬到 `workers/filesystem-core/src/evidence-emitters-filesystem.ts` 的 artifact slice
- `workers/filesystem-core/src/evidence-emitters-filesystem.ts` **不存在**(find 全仓无此文件);整个 filesystem-core 内 grep `buildArtifactEvidence|emitArtifactEvidence` 命中 0 — P4 S2 未执行
- `workers/context-core/src/context-assembler.ts` 不再是 packages 的 byte-identical 副本:`import` 改为 `./evidence-emitters-context.js`(取代原 `./evidence-emitters.js`);`compact-boundary.ts` / `snapshot.ts` 改为从 `@nano-agent/workspace-context-artifacts` 的 package 级 subpath 取 `NacpRefLike / ArtifactRef / WorkspaceFileEntry` 等类型(因 refs / types 仍归 WCA)— 非 byte-identical,但语义等价
- `workers/context-core` 的 deploy artifact(wrangler upload)是 **155.73 KiB / gzip 26.02 KiB**,与 W4 shell-only 同尺寸(filesystem-core 也是)— 说明被搬进 src/ 的 runtime code **没有被编译到 deploy 包**;deploy entry 仍是只返回 probe JSON 的 `index.ts`,不对外 HTTP 暴露 C1+C2 能力(这是 Q3c / Q4a host-local 设计,但 closure memo "worker has absorbed runtime" 表述容易误导读者以为 deploy artifact 也 live)
- `workers/agent-core/src/host/composition.ts` / `workspace-runtime.ts` / `nano-session-do.ts` 的 context 类型仍 `from "@nano-agent/workspace-context-artifacts"` — agent-core 的主 consumer 路径**并未**切到 context-core(仅 `appendInitialContextLayer` 走 subpath);P3 closure "owner 归位" 叙述只对 1 个 symbol 成立
- `workers/context-core/src/context-api/append-initial-context-layer.ts` 的 `assembler` 形参类型由 P2 版的 `ContextAssembler`(强类型)**弱化**为 `InitialContextTarget = object`,WeakMap 键类型也跟着弱化 — 功能仍对,但失去了类型系统对"必须传 ContextAssembler 实例"的编译期守护
- `workers/filesystem-core` 目前 **零下游 consumer**:grep `@haimang/filesystem-core-worker` in workers/ 和 packages/ 无任何命中;该 worker 是纯 landing,还不是 runtime 组件
- `evidence-emitters-context.ts` 的物理落点为**单文件**,而 D03 §5.2 S3 原设计是 `workers/context-core/src/evidence/{assembly.ts, compact.ts, snapshot.ts}/` 三文件拆分 — 结构性偏离,非 blocker 但不匹配 design doc 的目录形状
- `workers/filesystem-core/src/promotion.ts:27` / `errors.ts:19` / `backends/reference.ts:5` 注释中仍残留 "`@nano-agent/storage-topology`" 文字引用(只是 comment,非 import)— 未更新以反映 "substrate 已在 worker 内部" 的新口径

---

## 2. 审查发现

### R1. P4 S2 未执行 — mixed helper artifact slice 未迁到 filesystem-core

- **严重级别**:`high`
- **类型**:`delivery-gap`
- **事实依据**:
  - `docs/action-plan/worker-matrix/P4-filesystem-absorption.md:135`(S2):"evidence-emitters.ts artifact 部分(+ 相关 2 结构类型的 filesystem 归属)→ workers/filesystem-core/src/evidence-emitters-filesystem.ts"
  - `docs/design/worker-matrix/D03-context-core-absorption-and-posture.md:52`:"mixed helper | evidence-emitters.ts 既有 context 侧 helper 也有 filesystem 侧 helper;本设计处理 context 侧"(即 context 侧已处理,filesystem 侧归 D04 / P4)
  - `packages/workspace-context-artifacts/src/evidence-emitters.ts:195,206`:`buildArtifactEvidence` / `emitArtifactEvidence` 仍在原位,未迁出
  - `find workers/filesystem-core -name "*evidence*"` 返回 `workers/filesystem-core/src/storage/evidence.ts`(属于 D2 storage-topology 的 placement evidence,完全不同的文件)+ dist 与 test 文件,无 `evidence-emitters-filesystem.ts`
  - `grep -rn "buildArtifactEvidence\|emitArtifactEvidence" workers/filesystem-core/` → 0 命中
  - `docs/issue/worker-matrix/P4-closure.md` §1 + §3 没有承认这条 gap,反而把 D1 吸收简单归结为 "filesystem slice 已吸收"
- **为什么重要**:
  - mixed helper owner split 是 WCA split 的 **唯一非平凡** 工程动作 — C2/D1 本身的迁文件是机械 copy,只有 evidence-emitters 需要按 §4.1 owner 表**真实切分**。P3 做了 context 侧的切,P4 却没做 filesystem 侧的切 — 整个 split 结果是 "半切" 状态
  - 在 P5 要 DEPRECATE WCA 之前,此 artifact helper 无物理归属:如果 WCA 被 DEPRECATE,所有使用 `buildArtifactEvidence` 的 consumer 会没有 canonical 新路径;P5 将被迫"退回 P4 补做这件事,然后再继续"
  - 对 eval observability 的 artifact 侧 evidence(D01-D09 R? / A5)是潜在的未来 wire seam,当前它被永久锁定在 WCA 下
- **审查判断**:
  - P4 S2 状态从 "✅"(closure memo 暗示)改为 **`missing`**
  - P4 closure memo 标题 "closed(P4 absorbed runtime landed; D1+D2 moved into filesystem-core)" 不完整,应补 "mixed helper artifact slice deferred"
- **建议修法**:
  - 新建 `workers/filesystem-core/src/evidence-emitters-filesystem.ts`;从 `packages/workspace-context-artifacts/src/evidence-emitters.ts:195-230` 搬 `buildArtifactEvidence` / `emitArtifactEvidence`(以及它们引用的 `ArtifactEvidenceInput` interface 与 2 个结构类型 `EvidenceAnchorLike / EvidenceSinkLike` — 与 context 侧 evidence-emitters-context.ts 保持结构对称)
  - 原 `packages/workspace-context-artifacts/src/evidence-emitters.ts` 的 artifact 块可以删除或保留 re-export(与 S4 同一 coexistence 策略)
  - 补 `workers/filesystem-core/test/evidence-emitters-filesystem.test.ts` 覆盖 artifact 侧 emission
  - P4 closure memo 增补 v0.2 版本历史,承认此前的 gap 与修复

### R2. P3 S4 部分未兑现 — WCA index.ts 仍本地 export context slice,不是 re-export

- **严重级别**:`medium`
- **类型**:`scope-drift`
- **事实依据**:
  - `docs/action-plan/worker-matrix/P3-context-absorption.md:139`(S4):"packages/workspace-context-artifacts/src/index.ts 改为 re-export 已迁移 slice(以 workspace import 路径)+ 原 filesystem slice 保持 inline"
  - `packages/workspace-context-artifacts/src/index.ts:61-145`:仍本地 `export ... from "./context-layers.js"` / `./context-assembler.js` / `./compact-boundary.js` / `./redaction.js` / `./snapshot.js` / `./evidence-emitters.js`;无 `from "@haimang/context-core-worker/..."` 语句
  - `diff packages/workspace-context-artifacts/src/context-layers.ts workers/context-core/src/context-layers.ts` → 完全 byte-identical(= 双份 duplicate)
  - `workers/context-core/src/compact-boundary.ts:24` 反而**回头** `import type { NacpRefLike, ArtifactRef } from "@nano-agent/workspace-context-artifacts"` — 说明 context-core 的副本仍然依赖 WCA 的 refs / types,形成 "context-core 依赖 WCA,WCA 含 context slice 的 duplicate" 的反循环 coupling
- **为什么重要**:
  - Closure memo 第 §0 行(P3)描述 "context-core 现在已经成为 C1+C2 absorbed runtime 的真实承载点" — 但对于所有 C2 相关 symbol(ContextAssembler / ContextLayer / CompactBoundaryManager / ...),`workers/agent-core/src/host/{composition.ts, workspace-runtime.ts, do/nano-session-do.ts}` 仍 import 自 `@nano-agent/workspace-context-artifacts`,即 agent-core 作为主 consumer **并未**切换到 context-core 所有权路径
  - "owner 归位" 的真实范围仅有 `appendInitialContextLayer` 一个 symbol;C2 的其他 5 个 module 在 packages 与 workers 两处**并存**,agent-core 读 packages 侧,context-core 读它自己的 local copy
  - 对 P5 cutover:如果 WCA 整包 DEPRECATE,context-core 的 `compact-boundary.ts / snapshot.ts` 会断——它们仍 import `@nano-agent/workspace-context-artifacts` 的 refs/types
- **审查判断**:
  - P3 S4 状态从 closure memo 暗含的 "✅" 改为 **`partial`**
  - 这不是 correctness bug(tests 全绿),但 **closure 口径与代码真相不对齐**:closure 说 "owner 归位",真相是 "copy + coexistence",两者对 P5 cutover 的准备度完全不同
- **建议修法**:
  - 两条路径二选一:
    - **A. 走原 action-plan S4 口径**:`packages/workspace-context-artifacts/src/index.ts` 把 context slice exports 改为 `export * from "@haimang/context-core-worker"` 类 re-export;workers/context-core 的 compact-boundary / snapshot 从 "`@nano-agent/workspace-context-artifacts`" 改回 local `./refs.js / ./types.js`(需要先把 refs/types 一起搬过来,但 refs 是 D1 的 — 与 P4 交叉);或
    - **B. 口径修正**:承认 P3 是 "copy + coexistence" 而不是 "owner 归位";P3 closure memo §1.1 的表格 "吸收面" 条目改为 "C2 context slice 已在 workers/context-core 建立 canonical copy(packages 侧仍保留以 coexistence)";P5 cutover 的 rollback 文档显式记录 "context slice 在 P5 做 one-shot ownership transfer"
  - 推荐 **B**(代价小 + 不跨 P3/P4 边界),把 A 列入 P5 计划

### R3. `context-core` / `filesystem-core` deploy artifact 仍是 W4 shell 规模

- **严重级别**:`low`
- **类型**:`docs-gap`
- **事实依据**:
  - `pnpm --filter './workers/*' run deploy:dry-run` 实测:
    - `workers/agent-core/deploy:dry-run: Total Upload: 290.80 KiB / gzip 58.74 KiB`
    - `workers/bash-core/deploy:dry-run: Total Upload: 248.50 KiB / gzip 46.41 KiB`
    - `workers/context-core/deploy:dry-run: Total Upload: 155.73 KiB / gzip 26.02 KiB`(= W4 shell size)
    - `workers/filesystem-core/deploy:dry-run: Total Upload: 155.73 KiB / gzip 26.02 KiB`(= W4 shell size)
  - `workers/context-core/dist/` 实际编译产物含 30 个 .js 文件(tsc 已编译全部 src);但 `index.js` 为 528 B,仅 return probe JSON,不 import 任何 C1+C2 runtime
  - `workers/filesystem-core/dist/` 含 32 个 .js 文件同理;`index.js` 同样只 return probe
  - wrangler 按 entry = `dist/index.js` 的 import graph bundle,因 index 根本不 import,所以 absorbed runtime 不被打包上传
- **为什么重要**:
  - Closure memo "worker probe truth 校准" + "absorbed_runtime: true" 的字面表述,容易让读者把"源码已存在"误认为"deploy artifact 也 live"。实际上两个 worker 的 deploy artifact 仍是"W4 shell + 更新 phase 字段"
  - 这是 Q3c / Q4a host-local 的 **设计结果**(worker 不作为 remote RPC 暴露 C1/C2/D1/D2),不是 bug;但需要在 closure / probe 中诚实承认
- **审查判断**:
  - `docs` 级表达问题,非 correctness / scope;但 closure memo 应补一行 "runtime code 存在于 src/ 与 dist/,当前 deploy artifact 不暴露(per Q3c/Q4a host-local)"
- **建议修法**:
  - 在 P3 / P4 closure memo `§0 背景` 或新增 `§5 deploy artifact` 明确:
    - context-core / filesystem-core 作为 **library worker** 存在,其他 workers 通过 `pnpm workspace` 的 package subpath 消费(如 agent-core 的 `appendInitialContextLayer`);worker 本身的 `index.ts` 仅 serve probe
    - `absorbed_runtime: true` 字段仅证明 src/ 层的归位,不代表 HTTP endpoint 可被外部 fetch 到 C1/C2/D1/D2
  - 可选:在 `workers/{context,filesystem}-core/src/index.ts` 的 probe response 里加 `library_worker: true` 字段,让 curl 就能区分 library-style vs. host-style worker

### R4. `appendInitialContextLayer` 类型弱化(从 ContextAssembler → object)

- **严重级别**:`low`
- **类型**:`correctness`
- **事实依据**:
  - P2 版(原 `workers/agent-core/src/host/context-api/append-initial-context-layer.ts`)签名:`appendInitialContextLayer(assembler: ContextAssembler, payload: SessionStartInitialContext)`
  - P3 迁至 context-core 后,现 `workers/context-core/src/context-api/append-initial-context-layer.ts:33,82,92,103`:`type InitialContextTarget = object` → 签名改为 `assembler: InitialContextTarget`;WeakMap 键类型也 `WeakMap<InitialContextTarget, ContextLayer[]>`
  - `workers/agent-core/src/context-core-worker.d.ts:12-20` ambient declaration 声明 `assembler: object` — 同步弱化
- **为什么重要**:
  - 该 helper 的本质契约是 "per-assembler 隔离 pending list",依赖的是 WeakMap 对对象引用的等值语义 — 从 `ContextAssembler` 弱化到 `object` 后,consumer 可以合法传任何对象作为 WeakMap 键,编译期不再拒绝 "传错实例" 的 bug
  - P2 已有 integration test 证明正常路径,但"传错 assembler 引用 → pending list 落在错误的 WeakMap 槽"这类 drift 不会被类型系统挡住
- **审查判断**:
  - 非 blocker — tests 仍绿,运行时语义对;但**类型系统的守护下降了一档**
- **建议修法**:
  - 恢复 `assembler: ContextAssembler`(从 context-core 自己的 local `./context-assembler.js` import 类型):
    ```ts
    import type { ContextAssembler } from "../context-assembler.js";
    export function appendInitialContextLayer(
      assembler: ContextAssembler,
      payload: SessionStartInitialContext,
    ): void { ... }
    ```
  - 同步更新 `workers/agent-core/src/context-core-worker.d.ts` 的 ambient declaration
  - 如果保留 `object` 是为了容纳 test doubles / 未来封装,在 JSDoc 写明理由

### R5. `evidence-emitters-context` 物理落点偏离 D03 §5.2 S3

- **严重级别**:`low`
- **类型**:`docs-gap`
- **事实依据**:
  - `docs/design/worker-matrix/D03-context-core-absorption-and-posture.md:167` S3:"搬进 `workers/context-core/src/evidence/{assembly.ts, compact.ts, snapshot.ts}/`"(三文件,子目录)
  - 实际:`workers/context-core/src/evidence-emitters-context.ts`(单文件,无 `evidence/` 子目录)
- **为什么重要**:
  - 结构性偏离 design,但功能等价;未来如果有 C1+C2 外的 evidence(例如 artifact / tool-call)希望按 slice 拆,现在一个大文件会更难切
- **审查判断**:
  - cosmetic;不影响 P3/P4 收口,但 D03 v0.2 应该把 S3 的目标路径更新为实际采用的 `evidence-emitters-context.ts` 单文件形式,避免设计与代码**永远不对齐**
- **建议修法**:
  - D03 §5.2 S3 更新为 "`workers/context-core/src/evidence-emitters-context.ts`(单文件;若未来新 evidence slice 需要再拆,按 evidence/{assembly,compact,snapshot}.ts 重组)"
  - 或者在 P5 前把单文件拆成三文件,与 design 对齐

### R6. `filesystem-core` 当前 0 下游 consumer

- **严重级别**:`low`
- **类型**:`scope-drift`
- **事实依据**:
  - `grep -rn "@haimang/filesystem-core-worker" workers/ packages/` → 0 命中
  - `workers/filesystem-core/package.json::dependencies` 只有 `nacp-core / nacp-session / zod`,**不**被 agent-core / bash-core / context-core 的 package.json 列入 deps
  - `workers/agent-core/src/host/composition.ts:28-31` 仍 `import { InMemoryArtifactStore, MountRouter, WorkspaceNamespace } from "@nano-agent/workspace-context-artifacts"`(packages 路径,不是 workers/filesystem-core 的 copy)
- **为什么重要**:
  - P4 closure §4 结论说 "filesystem-core 现在已经拥有 D1 + D2 的真实代码与测试面" — 但该 worker 是 **纯 landing**,没有任何下游 consumer。对比 context-core 至少被 agent-core 通过 subpath 消费了 1 个 symbol
  - 如果 P5 cutover 忘记把 agent-core 的 WCA 消费路径切到 filesystem-core,filesystem-core 的 absorbed code 永远不会被 bundle 进任何活 worker
- **审查判断**:
  - 符合 P4 O2 / O4(Q4a host-local,不激活 FILESYSTEM_CORE binding),不是越界;但 **"filesystem-core 有真实代码" 的表达需要加上 "目前零 consumer" 的口径**,避免 P5 / 下一 charter 作者误以为切换成本低
- **建议修法**:
  - P4 closure 增补一行:"当前 filesystem-core 是 library worker,0 下游 consumer;下一 charter(P5 cutover 或之后的 posture 重评)需要显式决策 agent-core 是否从 WCA 路径切到 filesystem-core"
  - 或在 `docs/handoff/*.md` 写一条 "filesystem-core consumer backlog" 备忘

---

## 3. In-Scope 逐项对齐审核

### 3.1 P3 S1-S10

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| P3-S1 | C1 整包 `packages/context-management/{src,test}/**` → `workers/context-core/{src,test}/**`;byte-identical;packages 保留 | `done` | 3 子目录 + 对应 tests 全在;packages 保留;`pnpm --filter @haimang/context-core-worker test` 19 files / 170 tests 绿 |
| P3-S2 | C2 WCA context 5 个 `.ts` → `workers/context-core/src/` | `done` | `context-layers/context-assembler/compact-boundary/redaction/snapshot.ts` 全在;非 byte-identical(import 路径改写),语义等价 |
| P3-S3 | `evidence-emitters.ts` mixed helper 按 D03 §4.1 表切 context slice 到 `evidence-emitters-context.ts`(或 `evidence/*`)| `done`(文件形式偏离 S3 文字)| 单文件 `evidence-emitters-context.ts` 承接 7 组 export(包含 2 个结构类型 + 6 个 build/emit 助手);功能等价,但原设计期望三文件拆分(R5)|
| P3-S4 | `packages/workspace-context-artifacts/src/index.ts` 改为 re-export 已迁移 slice | `partial / missing-per-plan-text`(见 R2)| WCA index 仍本地 export 全部 context slice;双份 duplicate 存在,`agent-core` consumer 仍从 WCA 读 |
| P3-S5 | `appendInitialContextLayer` 物理迁到 `workers/context-core/src/context-api/`;agent-core import 改 | `done` | Helper 落在 context-core;`workers/agent-core/src/host/do/nano-session-do.ts:34` import 走 subpath;agent-core 下保留 shim re-export;packages/session-do-runtime 镜像同步 |
| P3-S6 | composition 层 "default 不装 createKernelCompactDelegate" 显式注释 + 单测 | `done` | `composition.ts:240` kernel reason 明文;`composition-profile.test.ts:179` guard 断言 |
| P3-S7 | `workers/context-core` `deploy:dry-run` 绿;preview 可 defer | `done` | dry-run 绿;preview deploy 按 posture defer |
| P3-S8 | B7 LIVE + 98 root + 112 cross + P2 两条 e2e + 三 workers test + dry-run 全绿 | `done` | 实测数字优于声称:root 107 / cross 121(P2 e2e 已 baked in);B7 LIVE 继续绿 |
| P3-S9 | W3 pattern 第 3 placeholder(循环引用)回填 | `out-of-scope-by-design` | action-plan 标 "conditional";WCA split 并未碰到真实循环引用场景(只是 WCA 含未迁 refs/types,context-core 反向依赖),未触发新 pattern;closure memo 未回填,也未说明 — 尚可接受 |
| P3-S10 | `docs/issue/worker-matrix/P3-closure.md` | `done` | 78 行 memo 完整 |

**P3 对齐结论**

- **done**:8(含 S3 的形式偏离被归入 done)
- **partial**:1(S4)
- **missing**:0
- **out-of-scope-by-design**:1(S9)

> 这更像"C1 + C2 搬迁 + `appendInitialContextLayer` owner 归位已机械完成,Q3c 落盘合规,但 WCA 仍持有 context slice duplicate,'owner 归位' 是仅对 1 symbol 成立的叙述"。

### 3.2 P4 S1-S7

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| P4-S1 | D1 WCA filesystem slice 9 `.ts` + `backends/{memory,reference,types}.ts` → `workers/filesystem-core/src/**`;tests 迁 | `done` | 9 + 3 = 12 文件全在;对应 tests 迁到 `workers/filesystem-core/test/`(含 backends tests);byte-identical(除 `backends/reference.ts` 内部 import 改为 `../storage/index.js`)|
| P4-S2 | `evidence-emitters.ts` artifact 部分 → `workers/filesystem-core/src/evidence-emitters-filesystem.ts` | `missing` | 文件不存在;`buildArtifactEvidence` / `emitArtifactEvidence` 仍在 `packages/workspace-context-artifacts/src/evidence-emitters.ts:195,206`;0 migration(R1)|
| P4-S3 | `packages/storage-topology/src/*` → `workers/filesystem-core/src/storage/**`;tests 迁 | `done` | 15 src + 5 adapters 全在;storage-topology tests 迁 + integration tests 存在;`workers/filesystem-core/src/storage/index.ts` 与 `packages/storage-topology/src/index.ts` byte-identical |
| P4-S4 | Q4a posture + tenant wrapper 守护 | `done` | `wrangler.jsonc:31-38` FILESYSTEM_CORE 保持注释 + 有 reason 注释;`composition.ts:253-255` storage handle 明确 Q4a reason;`backends/reference.ts:13-104` `connected: false` 默认 + 明确注释;grep 实测 tenant wrapper 无违规(所有 `storage.put/get/list` use-site 先经 `getTenantScopedStorage`)|
| P4-S5 | `workers/filesystem-core` dry-run 绿;preview 可 defer | `done` | dry-run 绿;preview 按 posture defer |
| P4-S6 | B7 LIVE + 98 root + 112 cross + P2 两条 e2e + 四 workers test + dry-run 全绿 | `done` | 实测:root 107 / cross 121 / 4 workers test / dry-run 全绿 |
| P4-S7 | `docs/issue/worker-matrix/P4-closure.md` | `done`(但未承认 R1)| 70 行 memo 完整;但把 S2 状态标 "D1+D2 moved" 偷换了 "artifact slice 未搬" 的事实 |

**P4 对齐结论**

- **done**:6
- **partial**:0
- **missing**:1(S2)
- **out-of-scope-by-design**:0

> 这更像"D1 WCA filesystem slice 与 D2 storage-topology 整包吸收已真实完成,Q4a posture 显式落盘三处,但 mixed helper 的 artifact 侧切分没有触发 — 整个 WCA split 在代码层仍是 '半切' 状态"。

---

## 4. Out-of-Scope 核查

### 4.1 P3 out-of-scope

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| P3-O1 | D1 filesystem slice(归 P4)| `遵守` | workers/filesystem-core 另做,workers/context-core 未越界搬 D1 |
| P3-O2 | D2 storage-topology residual(归 P4)| `遵守` | 同上;但 context-core `dependencies: @nano-agent/storage-topology` 有一定耦合(async-compact import storage-topology types) — 未越界搬,但在共存期存在隐式 coupling(worth noting,not a violation)|
| P3-O3 | `packages/workspace-context-artifacts` 物理删除 | `遵守` | WCA 完整保留 |
| P3-O4 | `packages/context-management` DEPRECATED banner | `遵守` | 无 banner |
| P3-O5 | `appendInitialContextLayer` 深度实装 | `遵守` | Helper 迁移仅改签名类型(R4 弱化),未改内部算法 |
| P3-O6 | 默认打开 InspectorFacade | `遵守` | 默认 OFF |
| P3-O7 | `restoreVersion` 改实装 | `遵守` | N/A 未触及 |
| P3-O8 | Remote compact delegate helper | `遵守` | 未出现 |
| P3-O9 | `CONTEXT_CORE` service binding 激活 | `遵守` | wrangler.jsonc 仍注释 |
| P3-O10 | 改 NACP wire / schema | `遵守` | wire 层面 0 改动 |
| P3-O11 | WCA 物理删除 | `遵守` | 保留 |

### 4.2 P4 out-of-scope

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| P4-O1 | `workspace.fs.*` remote RPC family shipped | `遵守` | 无 |
| P4-O2 | 取消注释 FILESYSTEM_CORE wrangler binding | `遵守` | `wrangler.jsonc:38` 仍注释 |
| P4-O3 | `ReferenceBackend.connected: true` 默认 | `遵守` | 默认 false |
| P4-O4 | FILESYSTEM_CORE remote service preview deploy 激活 agent-core binding | `遵守` | 仅 bash-core 有 binding;filesystem 侧未激活 |
| P4-O5 | D09 Tier B DEPRECATED banner | `遵守` | 无 |
| P4-O6 | 物理删除 packages | `遵守` | 三包全保留 |
| P4-O7 | `storage.put/get/list` 绕过 tenant wrapper | `遵守` | grep 实测:所有 storage use-site 都先经 `getTenantScopedStorage` |
| P4-O8 | 改 `MountRouter` / `WorkspaceNamespace` API shape | `遵守` | byte-identical |
| P4-O9 | 改 NACP wire / schema | `遵守` | 0 改动 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**:`P3/P4 的搬迁主体真实成立,tests + dry-run + live URL 都可复现,但 closure memo 在两处把 "copy + coexistence" 叙述成 "owner 归位":(a) P4 mixed helper artifact slice 完全未迁移(R1);(b) P3 WCA re-export 口径未实现(R2)。在不修 R1 之前不应允许 P3/P4 作为 P5 cutover 的无条件输入。`
- **是否允许关闭本轮 review**:`no`
- **关闭前必须完成的 blocker**:
  1. `R1 — 执行 P4 S2:新增 workers/filesystem-core/src/evidence-emitters-filesystem.ts,搬 buildArtifactEvidence / emitArtifactEvidence(+ 其 ArtifactEvidenceInput interface + 2 结构类型);补对应 tests;packages/WCA 的 evidence-emitters.ts 要么删除 artifact 块,要么保留作为 coexistence re-export;P4 closure memo v0.2 明确承认此前 gap`
  2. `R2 — 对齐 "owner 归位" 与代码真相:要么在 packages/WCA 的 index.ts 加 re-export 从 workers/context-core(同时把 context-core 的 compact-boundary / snapshot 内部 import 从 "@nano-agent/workspace-context-artifacts" 改回本地 refs / types — 但这需要把 refs / types 从 WCA 同步拉进 context-core,会与 P4 coupling),要么口径修正:P3 closure §1.1 改成 "C2 context slice canonical copy landed in context-core;packages/WCA 保留原地以 coexistence;P5 cutover 时 one-shot 切换"`
- **可以后续跟进的 non-blocking follow-up**:
  1. `R3 — 在 {context,filesystem}-core 的 probe response 加 library_worker: true 字段,并在 closure memo §5 新增 "deploy artifact 真相" 段,澄清 155 KiB 的 shell-only 是 Q3c/Q4a 预期而非 bug`
  2. `R4 — 恢复 appendInitialContextLayer 签名为 assembler: ContextAssembler 强类型;同步更新 agent-core 下的 ambient .d.ts`
  3. `R5 — D03 v0.2 的 §5.2 S3 路径描述与 evidence-emitters-context.ts 单文件实际落点对齐`
  4. `R6 — handoff / charter 记录 filesystem-core 当前 0 consumer,把 "agent-core 是否切到 filesystem-core" 列入 P5 或下一 posture charter 的 open question`
  5. `补充一条 CI grep guard,持续检查 workers/*/src/ 内所有 storage.put/get/list 都先经 getTenantScopedStorage(action-plan P4 S4.4 提到但未落地成 CI,只靠本轮手动 grep)`

> `本轮 review 不收口,等待实现者按 §6 响应并再次更新代码。`

---

## 6.1 对本轮审查的回应

> 执行者: `GPT-5.4`
> 执行时间: `2026-04-23`
> 回应范围: `R1–R6`

- **总体回应**：`R1 blocker 已补齐，R2 采用 review 建议的“口径修正(B)”路径收紧 source-of-truth，R3–R6 的低风险漂移项也已一并对齐。`
- **本轮修改策略**：`先补真实 delivery gap（artifact evidence slice + tests），再把 helper 强类型与 library-worker probe truth 收回，最后统一更新 P3/P4 closure、action-plan、design docs 到当前代码真相。`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | P4 S2 未执行，artifact evidence slice 未迁到 filesystem-core | `fixed` | 新增 `workers/filesystem-core/src/evidence-emitters-filesystem.ts` 与对应 tests；保留 `packages/workspace-context-artifacts/src/evidence-emitters.ts` 的 artifact helper 作为 coexistence duplicate，并在注释中声明 canonical worker-side owner 已落到 filesystem-core | `workers/filesystem-core/src/evidence-emitters-filesystem.ts`, `workers/filesystem-core/test/evidence-emitters-filesystem.test.ts`, `packages/workspace-context-artifacts/src/evidence-emitters.ts`, `docs/issue/worker-matrix/P4-closure.md`, `docs/action-plan/worker-matrix/P4-filesystem-absorption.md` |
| R2 | P3 把 “copy + coexistence” 说成了 “owner 归位 / re-export” | `fixed` | 采用 review 推荐的 **B 路径**：不跨 P3/P4 边界强做 packages→workers re-export，而是把 P3 source-of-truth 改成“worker-side canonical copy + package-side coexistence duplicate”；同时在 WCA `index.ts` 注释中显式写明 overlap truth | `packages/workspace-context-artifacts/src/index.ts`, `docs/issue/worker-matrix/P3-closure.md`, `docs/action-plan/worker-matrix/P3-context-absorption.md` |
| R3 | context-core / filesystem-core deploy artifact 仍是 shell 规模，但文档没讲清楚 | `fixed` | 在两个 worker probe 增加 `library_worker: true`，并在 P3/P4 closure 与 design/action-plan 中新增/改写 deploy artifact truth：说明 `absorbed_runtime` 证明的是源码归位，而不是远端 HTTP runtime API 已 live | `workers/context-core/src/{index.ts,types.ts}`, `workers/filesystem-core/src/{index.ts,types.ts}`, `workers/context-core/test/smoke.test.ts`, `workers/filesystem-core/test/smoke.test.ts`, `docs/issue/worker-matrix/P3-closure.md`, `docs/issue/worker-matrix/P4-closure.md`, `docs/design/worker-matrix/D03-context-core-absorption-and-posture.md`, `docs/design/worker-matrix/D04-filesystem-core-absorption-and-posture.md` |
| R4 | `appendInitialContextLayer` 的 assembler 类型从 `ContextAssembler` 弱化为 `object` | `fixed` | 恢复 context-core 实现中的 `ContextAssembler` 强类型；同步收紧 `workers/agent-core/src/context-core-worker.d.ts`，让 agent-core 的 subpath consumer 也重新要求 `ContextAssembler` | `workers/context-core/src/context-api/append-initial-context-layer.ts`, `workers/agent-core/src/context-core-worker.d.ts` |
| R5 | `evidence-emitters-context.ts` 单文件落点与 D03 设计文档不一致 | `fixed` | 不再把代码改回三文件，而是把 D03 design/action-plan 的 source-of-truth 更新为实际落地的 `workers/context-core/src/evidence-emitters-context.ts` 单文件形态 | `docs/design/worker-matrix/D03-context-core-absorption-and-posture.md`, `docs/action-plan/worker-matrix/P3-context-absorption.md` |
| R6 | filesystem-core 当前 0 consumer，但 handoff / closure 没讲清楚 | `fixed` | 在 P4 closure / action-plan / design 里显式补入 “filesystem-core 当前是 0 runtime consumer 的 library worker；是否切换 agent-core consumer path 留给 P5/后续 charter” | `docs/issue/worker-matrix/P4-closure.md`, `docs/action-plan/worker-matrix/P4-filesystem-absorption.md`, `docs/design/worker-matrix/D04-filesystem-core-absorption-and-posture.md` |

### 6.3 变更文件清单

- `workers/filesystem-core/src/evidence-emitters-filesystem.ts`
- `workers/filesystem-core/test/evidence-emitters-filesystem.test.ts`
- `workers/context-core/src/context-api/append-initial-context-layer.ts`
- `workers/agent-core/src/context-core-worker.d.ts`
- `workers/context-core/src/index.ts`
- `workers/context-core/src/types.ts`
- `workers/context-core/test/smoke.test.ts`
- `workers/filesystem-core/src/index.ts`
- `workers/filesystem-core/src/types.ts`
- `workers/filesystem-core/test/smoke.test.ts`
- `packages/workspace-context-artifacts/src/evidence-emitters.ts`
- `packages/workspace-context-artifacts/src/index.ts`
- `docs/issue/worker-matrix/P3-closure.md`
- `docs/issue/worker-matrix/P4-closure.md`
- `docs/action-plan/worker-matrix/P3-context-absorption.md`
- `docs/action-plan/worker-matrix/P4-filesystem-absorption.md`
- `docs/design/worker-matrix/D03-context-core-absorption-and-posture.md`
- `docs/design/worker-matrix/D04-filesystem-core-absorption-and-posture.md`

### 6.4 验证结果

```text
pnpm --filter @haimang/context-core-worker typecheck build test
  -> Test Files 19 passed, Tests 170 passed

pnpm --filter @haimang/filesystem-core-worker typecheck build test
  -> Test Files 25 passed, Tests 293 passed

pnpm --filter @haimang/agent-core-worker typecheck build test
  -> Test Files 96 passed, Tests 1027 passed

pnpm --filter @nano-agent/workspace-context-artifacts typecheck build test
  -> Test Files 17 passed, Tests 192 passed

pnpm --filter @haimang/context-core-worker run deploy:dry-run
  -> green, Total Upload 155.75 KiB / gzip 26.03 KiB

pnpm --filter @haimang/filesystem-core-worker run deploy:dry-run
  -> green, Total Upload 155.76 KiB / gzip 26.03 KiB

node --test test/*.test.mjs
  -> 107 pass, 0 fail

npm run test:cross
  -> 121 pass, 0 fail
```

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. `packages/workspace-context-artifacts` 的 context slice 与 artifact evidence helper 仍保留 coexistence duplicate；P5 cutover 前没有做 packages→workers 的 one-shot ownership switch。
  2. `filesystem-core` 仍是 library worker / 0 runtime consumer；是否把 agent-core 的 WCA consumer path 切到 filesystem-core，仍需在 P5 或后续 posture charter 明确决策。
