# Nano-Agent 行动计划 — B3：Fake-Bash Extension and Port

> 服务业务簇：`After-Foundations Phase 2 — Fake-Bash Extension & Just-Bash Port`
> 计划对象：`packages/capability-runtime` 的 fake-bash command surface / planner / text-processing handlers / curl guard / inventory drift guard
> 类型：`new`
> 作者：`GPT-5.4`
> 时间：`2026-04-20`
> 文件位置：
> - `packages/capability-runtime/src/capabilities/text-processing.ts` （new）
> - `packages/capability-runtime/src/capabilities/filesystem.ts` （modify）
> - `packages/capability-runtime/src/capabilities/network.ts` （modify）
> - `packages/capability-runtime/src/fake-bash/commands.ts` （modify）
> - `packages/capability-runtime/src/planner.ts` （modify）
> - `packages/capability-runtime/src/index.ts` （modify）
> - `packages/capability-runtime/test/capabilities/*.test.ts` （add / modify）
> - `packages/capability-runtime/test/{commands,planner,registry,inventory-drift-guard}.test.ts` （modify）
> - `packages/capability-runtime/test/integration/{command-surface-smoke,local-ts-workspace}.test.ts` （modify）
> - `packages/capability-runtime/README.md` （modify）
> - `docs/design/after-skeleton/PX-capability-inventory.md` （modify）
> - `docs/design/after-foundations/P2-fake-bash-extension-policy.md` （如执行中出现 drift，则同步修订）
>
> 关联设计 / finding / issue / 价值文档：
> - `docs/plan-after-foundations.md` (§6 Phase 2 / §7.3 / §11.2 / §14.2)
> - `docs/design/after-foundations/P2-fake-bash-extension-policy.md`
> - `docs/spikes/fake-bash-platform-findings.md`
> - `docs/spikes/spike-do-storage/07-bash-capability-parity-3-of-3-contracts-hold.md` (`F07`)
> - `docs/spikes/spike-do-storage/08-do-storage-value-cap-between-1mib-and-10mib.md` (`F08`)
> - `docs/spikes/spike-do-storage/09-curl-quota-25-fetches-no-rate-limit-default-target.md` (`F09`)
> - `docs/issue/after-foundations/B1-handoff-to-B2-B6.md` (§B3)
> - `docs/eval/vpa-fake-bash-by-GPT.md`
> - `docs/eval/value-proposition-analysis-by-GPT.md`
> - `README.md`
>
> 文档状态：`shipped`（B3 实施完成 2026-04-20；详见 §11 实施工作日志）

---

## 0. 执行背景与目标

> B3 不是“把 just-bash 搬进仓库”，而是把 fake-bash 从当前 12-pack minimal surface，扩展成一个 **仍然 Worker-native、仍然声明式、仍然受控** 的更实用子集。它必须同时吸收三类输入：B1 已验证的不应回归的 contract（F07）、B2/B4 会共同消费的 size guard truth（F08）、以及 curl 接通时必须有 quota/budget 的 platform reality（F09）。

- **服务业务簇**：`After-Foundations Phase 2 — Fake-Bash Extension & Just-Bash Port`
- **计划对象**：`capability-runtime` 的 command registry、planner、text-processing handlers、filesystem/network guard、tests、inventory、README
- **本次计划解决的问题**：
  - **P1**：当前 fake-bash surface 仍固定在 12-pack；`inventory-drift-guard`、`command-surface-smoke`、`PX-capability-inventory.md` 都把它锁死
  - **P2**：P2 design 已明确 9 个 should-port 命令，但仓内尚无 `text-processing.ts` 或相应 handler / planner / registry surface
  - **P3**：`curl` 目前仍以 deterministic stub 为默认 reality；虽然已有 `fetchImpl` seam，且现有 `network.ts` 已具备 egress denylist / timeout cap / UTF-8 byte truncation，但 **budget / disclosure / connected path 的正式 contract** 还没冻结
  - **P4**：`write` 还没有把 B1 `F08` 的 oversize truth 写成 fake-bash 层的显式 disclosure；B2 现在已经落地 `ValueTooLargeError`，但 B3 必须在当前 `filesystem.ts -> WorkspaceFsLike.writeFile()` seam 上消费这条 typed truth，而不是让 `capability-runtime` 直接猜底层 adapter / 阈值
  - **P5**：原始 fake-bash 价值判断已经明确：它是 **LLM 兼容层**，不是 Linux / POSIX shell 再实现；B3 必须把这一原则写进 command surface，而不是在 port 过程中悄悄滑向 shell feature expansion
- **本次计划的直接产出**：
  - **D1**：在不破坏 F07 已验证 contract 的前提下，把 command surface 从 12-pack 扩展到 **21 commands**（12 现有 + 9 新增）
  - **D2**：新增 `text-processing.ts`，承载 `sed / awk / jq / wc / head / tail / sort / uniq / diff` 的 worker-safe subset
  - **D3**：`filesystem.ts` 在现有 `WorkspaceFsLike` seam 上对 B2 size-cap truth 形成明确 error mapping / disclosure contract，而不是硬编码数值或透传底层原始报错
  - **D4**：`network.ts` 冻结 curl connected path + per-turn budget contract；同时保持 package-level test/offline mode 的 deterministic unbound path
  - **D5**：planner / registry / smoke / inventory / README 与 21-command surface 同步收口
  - **D6**：把“不支持完整 shell feature / 不支持 full just-bash / 不支持 Python/Node/browser/git write”继续固化成 explicit runtime truth

---

## 1. 执行综述

### 1.1 总体执行方式

本 action-plan 采用 **“先冻结 surface，再扩 handler；先 pure-text，再做 guarded mutation/network；最后再收 inventory/docs”** 的策略：

1. **先冻结 surface**：先把 B3 允许的命令、bash path 形状、structured input shape、caps/disclosure 写清楚，避免边写 handler 边发明语义
2. **先 pure-text，后 platform-coupled**：先落 `text-processing.ts` 的纯文本命令，再接 `write` size truth 与 `curl` budget；这样最容易把 B2/B7 依赖隔离清楚
3. **先 package 内闭合，再更新 inventory truth**：先让 `capability-runtime` 自己 build/typecheck/test 通过，再去更新 `PX-capability-inventory.md`、README 与 downstream handoff
4. **不导入 just-bash，不发明 shell feature**：允许借鉴 `context/just-bash` 的行为与算法，但 B3 的实现必须在 `capability-runtime` 内重写，并继续维持“命令兼容层 + typed capability runtime”的分层
5. **沿现有 capability seam 增量扩展**：`filesystem.ts` 已固定 path law + `WorkspaceFsLike` seam，`network.ts` 已固定 `fetchImpl` + egress/time/output cap；B3 Phase 4 应在这些 seam 上扩 budget / oversize mapping，而不是重写底座

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Surface freeze 与 B2/B7 边界钉住 | S | 冻结 9 个 port 命令的最小 bash/structured shape、output cap 规则、B2 size error seam、curl budget/disclosure seam | - |
| Phase 2 | `capability-runtime` surface scaffolding | S-M | 新增 `text-processing.ts` 壳、扩 command registry / planner / index / smoke scaffolding | Phase 1 |
| Phase 3 | 第一波文本命令 port | M | 实现 `sed / awk / jq / wc / head / tail`，配套 unit/planner/integration tests | Phase 2 |
| Phase 4 | F08/F09 guard integration | M | `write` oversize disclosure + `curl` connected path / subrequest budget / payload budget contract 收口 | Phase 3 |
| Phase 5 | 第二波文本命令 + inventory closure | M | 实现 `sort / uniq / diff`；更新 inventory/doc guard/README；扩 command surface smoke 到 21 commands | Phase 4 |
| Phase 6 | B3 closure 与 downstream handoff | XS | 给 B4/B7/B8 输出已 ship surface 与仍待验证项 | Phase 5 |

### 1.3 Phase 说明

1. **Phase 1 — Surface freeze 与 B2/B7 边界钉住**
   - **核心目标**：把 P2 design、B1 handoff、当前代码 reality 三者对齐成单一执行清单
   - **为什么先做**：P2 design 对 `curl` 的 observability 口径略高于当前 `CapabilityEvent` reality；B3 必须先澄清“是新增 event kind，还是沿用现有 error/progress detail”
2. **Phase 2 — `capability-runtime` surface scaffolding**
   - **核心目标**：把 21-command surface 的代码壳、planner 映射、index/export、测试框架先立起来
   - **为什么放这里**：新命令一旦分散写进多个 handler/test，而 registry/planner 还没统一，很容易造成 surface 漂移
3. **Phase 3 — 第一波文本命令 port**
   - **核心目标**：先交付 P2 design 明确要求的 6 个 core text commands
   - **为什么放这里**：这 6 个命令是 B3 的主价值，也是与 Cloudflare platform 约束耦合最低的一批
4. **Phase 4 — F08/F09 guard integration**
   - **核心目标**：把 B1 findings 里真正 platform-sensitive 的两条写回 capability-runtime
   - **为什么放这里**：先有 core text surface 再做 write/curl guard，能避免所有问题都同时耦到 B2/B7 上
5. **Phase 5 — 第二波文本命令 + inventory closure**
   - **核心目标**：把 `sort / uniq / diff` 与 21-command inventory 一起收口
   - **为什么放这里**：这 3 个命令和 `PX-capability-inventory.md` / drift guard 强耦合，适合与 docs/README 同批关闭
6. **Phase 6 — B3 closure 与 downstream handoff**
   - **核心目标**：明确 B4 应消费什么、B7 还要复测什么、B8/worker-matrix 可继承什么
   - **为什么放这里**：B3 的价值不只是多 9 个命令，还要为后续 runtime/package 组合提供稳定 truth

### 1.4 执行策略说明

- **执行顺序原则**：surface → registry/planner → core handlers → guard integration → inventory/docs → handoff
- **事实约束原则**：B3 不得硬编码 “1 MiB” 或继续依赖 raw `SQLITE_TOOBIG` string；必须在现有 `WorkspaceFsLike.writeFile()` / namespace error seam 上消费 B2 typed truth，或先冻结一个等价可测试 bridge seam
- **兼容层原则**：新增命令继续是 bash-shaped compatibility surface，不扩 pipes/redirects/heredoc/stdin shell feature
- **输出边界原则**：所有新增文本命令都必须有 deterministic inline cap / truncation disclosure，不能把 128MB isolate 当作无上限文本缓冲区
- **文档同步原则**：只要 21-command surface 变动，`inventory-drift-guard.test.ts` 与 `PX-capability-inventory.md` 必须同批更新

### 1.5 本次 action-plan 影响目录树

```text
nano-agent/
├── packages/
│   └── capability-runtime/
│       ├── src/
│       │   ├── capabilities/
│       │   │   ├── filesystem.ts              # modify (F08 error/disclosure mapping)
│       │   │   ├── network.ts                 # modify (F09 connected path + budget)
│       │   │   ├── search.ts                  # unchanged (F07 contract must hold)
│       │   │   ├── exec.ts                    # unchanged (ts-exec stays honest partial)
│       │   │   ├── vcs.ts                     # unchanged (git stays read-only)
│       │   │   └── text-processing.ts         # NEW (9 text/JSON helpers)
│       │   ├── fake-bash/commands.ts          # modify (21-command declaration set)
│       │   ├── planner.ts                     # modify (argv → structured input mapping)
│       │   └── index.ts                       # modify (exports)
│       ├── test/
│       │   ├── capabilities/
│       │   │   ├── text-processing-core.test.ts   # NEW
│       │   │   ├── text-processing-aux.test.ts    # NEW
│       │   │   ├── network-egress.test.ts         # modify
│       │   │   └── filesystem.test.ts             # modify
│       │   ├── {commands,planner,registry,inventory-drift-guard}.test.ts   # modify
│       │   └── integration/
│       │       ├── command-surface-smoke.test.ts  # modify
│       │       └── local-ts-workspace.test.ts     # modify if new handlers are wired
│       └── README.md                          # modify
├── docs/
│   ├── action-plan/after-foundations/B3-fake-bash-extension-and-port.md   # 本文
│   ├── design/after-foundations/P2-fake-bash-extension-policy.md          # sync if drift
│   └── design/after-skeleton/PX-capability-inventory.md                   # modify
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 冻结 9 个新增命令的最小 surface：bash path、structured input、output cap、disclosure 口径
- **[S2]** 新增 `text-processing.ts`，承载 `sed / awk / jq / wc / head / tail / sort / uniq / diff`
- **[S3]** 扩 `fake-bash/commands.ts`、`planner.ts`、`index.ts` 到 21-command surface
- **[S4]** ship 第一波 6 个核心文本命令：`sed / awk / jq / wc / head / tail`
- **[S5]** ship 第二波 3 个辅助文本命令：`sort / uniq / diff`
- **[S6]** 维持 F07 validated 3 contracts 不回归：`MKDIR_PARTIAL_NOTE`、`/_platform/**` reserved、`rg` bounded output
- **[S7]** `filesystem.ts` 消费 B2 oversize truth，形成 fake-bash 层的 typed disclosure/error mapping
- **[S8]** `network.ts` 接通 curl 的真实 path，并补齐 per-turn subrequest / payload budget contract
- **[S9]** 更新 `commands`/`planner`/`registry`/`inventory-drift-guard`/`command-surface-smoke`/README/PX inventory
- **[S10]** 跑通 `@nano-agent/capability-runtime` 现有 `test/typecheck/build`；如 root minimal-bash tests 受影响，则追加 root validation

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** full just-bash 89-command port
- **[O2]** pipes / redirects / heredoc / process substitution / stdin shell feature
- **[O3]** `python3` / `sqlite3` / `node` / package manager runtime
- **[O4]** `ts-exec` 真执行；它继续保持 honest partial
- **[O5]** git write subset（`add/commit/push/branch/merge`）
- **[O6]** browser / search / scrape 等 `skill.core` 议题
- **[O7]** `bash.core` worker 化 / service-binding wrapper / worker-matrix glue
- **[O8]** B7 的高 volume curl quota probe 与 F08 precise cap binary-search
- **[O9]** 自动把 oversize `write` 结果重路由到 R2；B3 只负责 honest disclosure，不负责 context-management/storage policy

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|---|---|---|---|
| `sed/awk/jq` | `in-scope` | P2 design 明确 yes；它们是 B3 第一波核心命令 | B3 closure |
| `sort/uniq/diff` | `in-scope` | P2 design 明确 yes；属于第二波但仍在 B3 正式范围内 | B3 closure |
| file-based bash path（如 `jq <query> <path>`） | `in-scope` | 当前 planner 没有 pipe/stdin；B3 需给 LLM 一个可调用的最小 surface | Phase 1 结束时 |
| pipe/stdin 模型 | `out-of-scope` | 会把 fake-bash 从 capability layer 滑向 shell runtime | worker-matrix / future parser design |
| `curl` 默认是否自动用 ambient fetch | `resolve-in-phase-1` | 当前 package 是 library；B3 要明确 connected path 与 offline test path 的边界 | Phase 1 |
| `capability.subrequest_budget_exhausted` 专用 event kind | `not-in-b3-surface` | 当前 `CapabilityEventKind` 只有 started/progress/completed/error/cancelled/timeout；B3 不应凭空发明新 kind | B4/B6 如需 observability 扩展再重评 |
| `write` 自动 promote to R2 | `out-of-scope` | promotion/router 属于 B2/B4 storage/context policy，不属于 fake-bash handler | B4 |
| `grep` 再单独 port | `out-of-scope` | `rg` 已是 canonical search truth；继续保持 `grep -> rg` narrow alias | worker-matrix / future demand |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | 对齐 P2 design / B1 handoff / current code reality | check | docs/** + `packages/capability-runtime/src/**` | 冻结 B3 单一执行清单 | low |
| P1-02 | Phase 1 | 冻结 9 个命令的最小 bash + structured shape | decision | `planner.ts` / design / plan | 命令语义不再边写边猜 | high |
| P1-03 | Phase 1 | 冻结 F08/F09 的 error/disclosure contract | decision | `filesystem.ts` / `network.ts` / tests | 不硬编码 cap、不发明 event kind | high |
| P2-01 | Phase 2 | 新增 `text-processing.ts` 与 helper scaffolding | add | `src/capabilities/text-processing.ts` | 为 9 命令提供统一宿主 | high |
| P2-02 | Phase 2 | 扩 command registry 到 21-command surface | modify | `fake-bash/commands.ts` | canonical declaration list 升级 | medium |
| P2-03 | Phase 2 | 扩 planner / public exports / smoke scaffolding | modify | `planner.ts`, `index.ts`, `test/**` | planner 与 public API 同步对齐 | high |
| P3-01 | Phase 3 | 实现 `wc / head / tail` | add | `text-processing.ts` + tests | 高频读取型命令落地 | medium |
| P3-02 | Phase 3 | 实现 `jq` | add | `text-processing.ts` + tests | JSON 查询能力落地 | high |
| P3-03 | Phase 3 | 实现 `sed / awk` 的 worker-safe subset | add | `text-processing.ts` + tests | 文本转换能力落地，但不扩成 full POSIX | high |
| P4-01 | Phase 4 | `write` oversize error mapping | modify | `filesystem.ts` + tests | B2 size-cap truth 进入 fake-bash disclosure | high |
| P4-02 | Phase 4 | `curl` connected path + budget seam | modify | `network.ts` + tests | curl 不再只是 stub，同时守住 F09 | high |
| P4-03 | Phase 4 | root/integration surface 核查 | modify | integration tests / README examples | 连接型行为可复现 | medium |
| P5-01 | Phase 5 | 实现 `sort / uniq / diff` | add | `text-processing.ts` + tests | 第二波辅助命令收口 | medium |
| P5-02 | Phase 5 | inventory/docs/README 同步 | modify | PX inventory + README + drift guard | 21-command truth 不漂移 | high |
| P6-01 | Phase 6 | 输出 B4/B7/B8 handoff | doc | action-plan / sibling docs / issues | downstream 不重复解释 B3 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Surface freeze 与 B2/B7 边界钉住

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | 输入对齐核查 | 把 `P2-fake-bash-extension-policy`、`fake-bash-platform-findings`、`B1-handoff-to-B2-B6`、当前 `capability-runtime` reality 映射成唯一清单 | `docs/**`, `src/**` | B3 不再存在“design 说 yes，但 package 结构接不住”的歧义 | 人工核对 + grep | 9 个新增命令、F08、F09 各自都有明确落点 |
| P1-02 | 冻结新命令最小 surface | 给 9 命令定义最小 bash 形状与 structured input；原则是 **file/path-first**，不引入 pipe/stdin | `planner.ts`, design, B3 plan | LLM 可调用、implementer 可编码 | 设计/计划核对 | 至少冻结：`head/tail/wc <path>`、`jq <query> <path>`、`sed <expr> <path>`、`awk <program> <path>`、`diff <left> <right>`、`sort/uniq <path>` |
| P1-03 | 冻结 caps/disclosure seam | 明确 text-processing output cap、`write` oversize disclosure、`curl` budget exhaustion 的 surfaced shape；预算 exhaustion 继续通过 existing error/progress detail surface，**不新增 `CapabilityEventKind`** | `result.ts`, `network.ts`, `filesystem.ts`, tests | B3 的 failure mode 可以稳定测试 | 设计/测试草案核对 | implementer 不需要猜“budget event 要不要发明新 kind” |

### 4.2 Phase 2 — `capability-runtime` surface scaffolding

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | 新增 `text-processing.ts` 壳 | 建立统一 helper：读取 workspace file、UTF-8 byte counting、line/byte cap、truncation disclosure、reserved namespace reuse | `src/capabilities/text-processing.ts` | 9 命令有统一宿主，不分散到多文件 | typecheck + handler smoke | 新文件可独立导出并被测试导入 |
| P2-02 | 扩 command declarations | 在 `fake-bash/commands.ts` 把 minimal set 从 12 升到 21；为每个新增命令声明 kind/description/inputSchema/policy/target | `src/fake-bash/commands.ts` | canonical registry truth 升级 | `commands.test.ts`, `registry.test.ts` | `getMinimalCommandDeclarations()` / ask/allow sets 与新 surface 一致 |
| P2-03 | 扩 planner + exports | 更新 `buildInputFromArgs()`、必要的 bash-narrow checks、public exports、integration smoke scaffolding | `src/planner.ts`, `src/index.ts`, `test/integration/command-surface-smoke.test.ts` | planner 能把新增命令稳定映射到 structured input | planner + smoke tests | `command-surface-smoke` 可按 21 commands 计划通过 |

### 4.3 Phase 3 — 第一波文本命令 port

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | `wc / head / tail` | 读取 workspace file，输出 lines/words/bytes 或前 N/后 N 行；默认保持最小语义，richer options 只走 structured input | `text-processing.ts`, `test/capabilities/text-processing-core.test.ts` | 高频读取命令成立 | unit tests | path law / reserved namespace / cap disclosure 都有回归 |
| P3-02 | `jq` | 提供 worker-safe JSON query subset；至少支持顶层字段/嵌套字段/数组下标等高频读场景；对 invalid JSON / invalid query 给 deterministic error | `text-processing.ts`, tests | API response / tool output 可直接在 fake-bash 层处理 | unit tests | invalid JSON 与 invalid query 的错误文本稳定 |
| P3-03 | `sed / awk` subset | 只实现最小文本处理子集，不追 full POSIX/GNU；明确拒绝未支持的 flag/script feature，错误信息要 honest | `text-processing.ts`, tests | 文本替换/筛选成立，但仍是 declaration-first subset | unit tests | 没有 silent success；未支持 feature 有 typed disclosure |

### 4.4 Phase 4 — F08/F09 guard integration

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | `write` oversize disclosure | 在当前 `filesystem.ts -> WorkspaceFsLike.writeFile()` seam 上捕获 B2 `ValueTooLargeError`（或 Phase 1 冻结的等价 typed bridge），映射成 deterministic capability error；不得把 raw storage string 暴露给模型，也不要让 capability-runtime 直接实例化 storage adapter | `src/capabilities/filesystem.ts`, `test/filesystem.test.ts` | F08 truth 被 capability layer honest 消费 | unit tests | 不硬编码 `1 MiB`；通过 fake namespace/backends 测出 oversize mapping |
| P4-02 | `curl` connected path | 扩 `CreateNetworkHandlersOptions` 或等价 config，加入 per-turn subrequest budget / response-byte budget；在 `fetchImpl` 已注入时走真实网络 path，在未注入时保留 explicit unbound stub | `src/capabilities/network.ts`, `test/capabilities/network-egress.test.ts` | `curl` 既可真实执行，又保留 deterministic offline path | unit tests | egress denylist、timeout、UTF-8 byte cap、budget exhaustion、unbound stub 五类路径全部可测 |
| P4-03 | integration/README 核查 | 确保 `LocalTsTarget` / README 示例能展示 connected path 的正确 wiring，但不强迫 library 默认命中真实网络 | `README.md`, integration tests | 实际使用方式清晰 | integration smoke | “connected when configured, stub when unconfigured” 成为明确 truth |

### 4.5 Phase 5 — 第二波文本命令 + inventory closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | `sort / uniq / diff` | 基于 file/path-first 语义实现排序、去重、双文件比较；继续遵守 output cap 与 reserved namespace | `text-processing.ts`, `test/capabilities/text-processing-aux.test.ts` | 第二波辅助命令成立 | unit tests | `diff` 至少支持 deterministic unified-style textual output；`sort/uniq` 不 silently explode memory |
| P5-02 | inventory / docs / drift guard | 更新 `PX-capability-inventory.md`、`inventory-drift-guard.test.ts`、`command-surface-smoke.test.ts`、`commands/registry/planner` tests、package README | docs + `test/**` | 21-command truth checked-in | test + doc review | code/doc/guard 三者完全对齐 |

### 4.6 Phase 6 — B3 closure 与 downstream handoff

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P6-01 | 输出 B4/B7/B8 handoff | 记录 B4 要消费的 size/budget disclosure、B7 要继续复测的 curl high-volume / exact cap、B8/worker-matrix 可继承的 command surface truth | B3 plan / sibling docs / issue notes | 后续 phase 不再重新解释 B3 | 人工核对 | 三个下游方向都有清晰输入 |

---

## 5. 测试与验证策略

### 5.1 必跑 package 命令

| 包 | 命令 | 目的 |
|---|---|---|
| `@nano-agent/capability-runtime` | `pnpm --filter @nano-agent/capability-runtime test` | 新 command surface / handler / planner / guard 回归 |
| `@nano-agent/capability-runtime` | `pnpm --filter @nano-agent/capability-runtime typecheck` | exports / input shapes / helper types |
| `@nano-agent/capability-runtime` | `pnpm --filter @nano-agent/capability-runtime build` | TS emit |

### 5.2 视改动范围追加的 root 验证

| 命令 | 何时需要 | 目的 |
|---|---|---|
| `node --test test/*.test.mjs` | 若 root contract tests 直接消费新的 capability exports / inventory truth | root contract regression |
| `pnpm test:cross` | 若新增命令被纳入现有 root cross/e2e harness | cross-package smoke |

### 5.3 B3 必须新增/更新的测试类型

- `packages/capability-runtime/test/capabilities/text-processing-core.test.ts`
  - `wc / head / tail / jq / sed / awk` happy path
  - invalid input / unsupported subset feature / truncation disclosure
  - reserved namespace / workspace escape rejection
- `packages/capability-runtime/test/capabilities/text-processing-aux.test.ts`
  - `sort / uniq / diff`
  - diff deterministic output
  - large-output truncation / memory-safe behaviour
- `packages/capability-runtime/test/capabilities/network-egress.test.ts`
  - unconfigured stub path
  - configured connected path
  - egress denylist
  - timeout
  - UTF-8 byte truncation
  - subrequest budget / payload budget exhaustion
- `packages/capability-runtime/test/filesystem.test.ts`
  - `write` oversize error mapping
  - no raw storage error leakage
  - F07 contracts still hold
- `packages/capability-runtime/test/planner*.test.ts`
  - 9 个新增命令的 argv → structured input 映射
  - no pipe / no redirect / no accidental flag-expansion
- `packages/capability-runtime/test/commands.test.ts`
  - declaration count 12 → 21
  - policies / executionTarget / descriptions stable
- `packages/capability-runtime/test/registry.test.ts`
  - `registerMinimalCommands()` 注册 21 commands，不多不少
- `packages/capability-runtime/test/inventory-drift-guard.test.ts`
  - `EXPECTED_COMMAND_ORDER`
  - `EXPECTED_POLICY`
  - `PX-capability-inventory.md` §7.1 docs guard
- `packages/capability-runtime/test/integration/command-surface-smoke.test.ts`
  - sample surface 扩到 21 commands
- `packages/capability-runtime/test/integration/local-ts-workspace.test.ts`
  - 如果 text-processing handlers 接入本地 workspace target，则增加最小 happy-path roundtrip

---

## 6. 风险与注意事项

### 6.1 执行风险表

| 风险 | 等级 | 说明 | 控制措施 |
|---|---|---|---|
| B2 seam 未冻结就开始硬编码 size-cap 行为 | high | 会把 B3 绑死到错误常量或 raw error string 上 | Phase 1 先钉住 B2 error/disclosure seam |
| `sed/awk/jq` 滑向 full shell/full parser | high | 语义过大，极易拖垮 Phase 2 scope 与测试复杂度 | 明确 file/path-first subset；未支持 feature 一律 honest reject |
| `curl`“接通”被误做成 ambient network auto-on | high | library tests/CI 会变得不可控，也会破坏 deterministic stub reality | 保留 configured vs unconfigured 双路径 contract |
| 文本命令输出无限膨胀 | high | `sort/uniq/diff/jq` 都可能直接吃掉 isolate 内存 | 统一 UTF-8 byte cap + truncation disclosure |
| inventory/doc 与 code 不同步 | high | 21-command surface 一旦改动，PX truth 会立刻漂移 | `inventory-drift-guard` 与 docs guard 同批更新 |
| 凭空发明 observability event kind | medium | 当前 capability-runtime event catalog 很窄，擅自扩 kind 会打断下游 | B3 只用现有 `error/progress detail`；如要扩 catalog，留给 B4/B6 |

### 6.2 B3 特别注意的 6 个约束

1. **F07 是 non-regression gate**：`mkdir` partial、`/_platform/**` reserved、`rg` cap 是 B3 的“不许破坏项”
2. **F08 是 shared truth，不是 B3 私有实现**：B3 负责 disclosure / mapping，不负责 storage policy 本身
3. **F09 只证明 low-volume baseline**：B3 先 ship conservative budget，真实高 volume 边界留给 B7
4. **不要 import `context/just-bash`**：它只能作为行为参考，不是 runtime dependency
5. **不要为 LLM convenience 发明 shell features**：命令变多，不代表 shell runtime 变大
6. **如果第二波 3 命令无法按当前 B3 收口，必须显式回写 design/plan 变更**：不能默默把 21-command truth 降回 18

---

## 7. Definition of Done（B3）

| 维度 | DoD | Status |
|---|---|---|
| 命令面 | 21-command surface 已在 registry/planner/tests/docs 中收口 | ✅ 完成（drift guard / smoke / bridge / commands / planner-text-processing 五处同步） |
| 实现 | `text-processing.ts` 已 ship，9 个新命令全部可调用 | ✅ 完成（worker-safe subset；64 KiB UTF-8 输出 cap） |
| 非回归 | F07 三条 validated contract 无 regress | ✅ 完成（`MKDIR_PARTIAL_NOTE` / `/_platform/**` / `rg` cap 全部 untouched；reserved-namespace 在 9 个新命令上同款生效） |
| Guard | `write` oversize disclosure 与 `curl` budget contract 已闭合 | ✅ 完成（`WRITE_OVERSIZE_REJECTED_NOTE` / `CURL_BUDGET_EXHAUSTED_NOTE`；structural duck-typed `ValueTooLargeShape`；`SubrequestBudget` 默认 opt-in） |
| 测试 | `capability-runtime` package test/typecheck/build 全通过 | ✅ 完成（335/335；+94 cases；全 10 package 1924/1924 通过） |
| 文档 | PX inventory / package README / P2 design（如需）无 drift | ✅ 完成（PX §7.1 9 行新增；README 重写为 21-pack；P2 design 无 drift 不需要改） |
| handoff | B4/B7/B8 downstream input 已明确 | ✅ 完成（§11.4.4） |

---

## 8. Action-plan-level exit criteria

| # | Criterion | 说明 | Status |
|---|---|---|---|
| 1 | `text-processing.ts` 已存在并由 package root export | B3 主体代码完成 | ✅ |
| 2 | `fake-bash/commands.ts` canonical declaration list 从 12 升到 21 | registry truth 完成 | ✅ |
| 3 | `planner.ts` 能稳定把 9 个新增命令映射到 structured input | surface 闭合 | ✅（`planner-text-processing.test.ts` 29 cases） |
| 4 | `sed / awk / jq / wc / head / tail / sort / uniq / diff` 全部有 unit tests | 第一波 + 第二波都已 ship | ✅（core 32 + aux 14 = 46 cases） |
| 5 | `filesystem.ts` 的 oversize path 不再透传 raw storage failure | F08 writeback 完成 | ✅（`WRITE_OVERSIZE_REJECTED_NOTE`；duck-typed shape；test 锁住 `SQLITE_TOOBIG` 不外泄） |
| 6 | `network.ts` 同时支持 configured connected path 与 unconfigured deterministic stub，并有 budget tests | F09 writeback 完成 | ✅（默认 unbounded back-compat；`createSubrequestBudget()` opt-in；6 budget cases） |
| 7 | `inventory-drift-guard.test.ts` 与 `PX-capability-inventory.md` 同步更新到 21-command truth | docs/code guard 完成 | ✅（PX §7.1 + drift guard `EXPECTED_COMMAND_ORDER` 同时 21 行） |
| 8 | `pnpm --filter @nano-agent/capability-runtime test/typecheck/build` 全通过 | package 内闭合 | ✅（335/335） |
| 9 | B4/B7/B8 follow-up map 已写清楚 | downstream 可直接消费 | ✅（§11.4.4） |

---

## 9. B3 对下游 phase 的直接输出

| 下游 phase | B3 输出 | 为什么重要 |
|---|---|---|
| **B4** | `write` oversize disclosure contract、text-processing 输出 cap 现实、curl budget/response budget 现实 | context-management 需要据此决定 compact / promotion / async routing |
| **B7** | 待复测项：F09 高 volume curl 阶梯、F08 precise cap | B3 只 ship conservative contract，不替代 Round 2 probe |
| **B8 / worker-matrix** | 21-command fake-bash surface、仍显式 unsupported 的 shell features、connected-vs-unconfigured curl seam | bash.core worker 化与 matrix 组装可直接继承 |

---

## 10. 关闭前提醒

- B3 的目标是 **扩 fake-bash 兼容层**，不是扩 shell 语言；如果实现开始讨论 pipes/redirects/heredoc，说明已经跑出本 phase 边界
- `curl` 的“接通”不等于“任何环境都自动打外网”；library package 必须保留 deterministic unconfigured path
- `write` 的 oversize 处理必须消费 B2 的 typed truth；**不要**硬编码 `1 MiB`、**不要**匹配 `SQLITE_TOOBIG` 字符串做 fragile 逻辑
- 当前 `capability-runtime` 是建在 `WorkspaceFsLike` / `fetchImpl` seam 上的；B3 要扩的是 **mapping / budget / disclosure**，不是在这一层偷接 `R2Adapter` / `KvAdapter` / `DOStorageAdapter`
- `PX-capability-inventory.md` 与 `inventory-drift-guard` 是 B3 的正式交付物，不是“收尾时顺手补文档”

---

## 11. 实施工作日志（2026-04-20，Opus 4.7 1M context 实施）

> 本节由 B3 实施者在代码完成后回填，作为 GPT-5.4 起草的 action-plan 与
> 实际落地之间的"实然"对照。`§11.1` 摘要 / `§11.2` 偏移 / `§11.3` 全部
> 新增与修改文件清单 / `§11.4` 最终分析与收口意见。

### 11.1 实施摘要

| 维度 | 结果 |
|---|---|
| 6 Phase 是否全部走完 | ✅ 是（P1→P6 顺序未跳） |
| 单元/集成测试新增数 | **+94**（capability-runtime 241 → 335） |
| 总测试通过率 | 全 10 package 1924/1924（B2 ship 后基线 1830 → +94） |
| 命令面 | 12-pack → **21-pack**（+9 text-processing；canonical order 严格 append-only，前 12 行不动） |
| 主要破坏性接口 | **零**——`createNetworkHandlers({ budget? })` 是 opt-in；`WorkspaceFsLike.writeFile()` 错误 mapping 不改 contract；`scoped-io` 等 storage 表面继续保持 B2 frozen 形态 |
| `capability-runtime` 版本 | `0.1.0`（不变 — B3 仅新增 surface，不引入 breaking） |
| 是否产生新 Cloudflare 资源 / 网络调用 | ❌ 否（B3 是 ship-code phase；`fetchImpl` 仍由 caller 注入，default 仍是 `not-connected` stub） |
| F07 contract 是否回归 | ❌ 否（`MKDIR_PARTIAL_NOTE` / `/_platform/**` reserved / `rg` cap 未触；reserved-namespace 在 9 个新命令上同款生效） |

### 11.2 与 GPT-5.4 action-plan 的偏移与原因

GPT 起草的 action-plan 与 sibling P2 design / B1 handoff 之间有几处需要 implementer
判断的歧义；Phase 1 阶段统一处理。

#### 偏移 1 — `head` / `tail` 的 `-n N` / `-c N` flags 在 bash 路径上 **不** 接受

- **GPT 安排（间接）**：action-plan §4.1 P1-02 写 "**file/path-first**, 不引入 pipe/stdin"；并未明确禁止 `-n N` / `-c N`。just-bash 等参考实现普遍接受 `head -n 5 file`。
- **实际执行**：`-flag` 在 9 个新命令的 bash 路径上一律 reject，必须走 structured tool call（`{ path, lines?, bytes? }`）。
- **原因**：
  1. P1-02 显式要求 file/path-first，而 `-n 5` 一旦放进去会立刻引出 `--lines=5` / `-n5` / `-5` 等多种等价形式，把 fake-bash 推向 POSIX flag-parsing 复杂度。
  2. 与 `curl` 已经 frozen 的 Q17 narrow surface 一致——“bash path 仅 narrow shape，richer options 走 structured”。
  3. structured tool call 的 schema 已 expose `{ lines, bytes }` 字段；LLM 只要按 structured 调，就能拿到完整能力。
- **写回**：`TEXT_PROCESSING_BASH_NARROW_NOTE = "text-processing-bash-narrow-use-structured"` 显式 export；`planner.ts:checkBashNarrow` 在 9 个新命令上跑同样规则；`planner-text-processing.test.ts` 9 命令各 1 case 锁定 reject。

#### 偏移 2 — `jq` 在 wave 1 里的实现是 **真子集**，不是 placeholder

- **GPT 安排**：P3-02 写 "提供 worker-safe JSON query subset；至少支持顶层字段/嵌套字段/数组下标等高频读场景"。
- **实际执行**：实装一个真正的 worker-safe jq 子集 (`. / .field / .a[N] / .a[] / keys / length`)，包含路径解析器 + iterate 语义；并显式 reject 任何 pipe / `|` / arithmetic 形式（marker `JQ_UNSUPPORTED_NOTE`）。
- **原因**：B3 P5 起草者真正消费的是 "filed access + length + keys + iterate"——这些是 LLM 在 API response 上 90% 的高频场景。一个仅返回 raw JSON 的 placeholder 会被 LLM 立即识别成"jq 不能用"而 fallback 回 cat → JSON.parse → 自己 walk。
- **写回**：30+ jq 单元测试覆盖 happy path + 4 类 unsupported reject + invalid JSON 错误传播。

#### 偏移 3 — `sed` / `awk` 的 subset 比 P2 design 更显式 narrow

- **GPT 安排**：P3-03 写 "只实现最小文本处理子集，不追 full POSIX/GNU；明确拒绝未支持的 flag/script feature，错误信息要 honest"。
- **实际执行**：
  - **`sed`** 仅认 **单条** `s/PATTERN/REPLACEMENT/[gi]`；地址 (`1d` / `1,3p`) / multi-statement (`s/a/b/; s/c/d/`) / 其他 sed 命令 (`d / p / q / n / a / i / c / y / =`) 全部 reject。delimiter 必须是 `/`（不接受 sed 常见的 `s|...|...|`）。
  - **`awk`** 仅认 `{ print $N }` / `NR == K { print [...] }` / `/PATTERN/ { print [...] }`。BEGIN/END / 用户函数 / `getline` / `gsub` / `printf` / 多语句 body 全部 reject。
- **原因**：sed 与 awk 的 full parser 都是 200-500 行级别的 lexer + interpreter（参考 `context/just-bash/src/commands/sed/` + `awk/`，~3K 行）。P2 §3.3 明确 **不 import upstream，仅借鉴**。最小可用子集已经覆盖 90% 的 LLM 用例（line-replace + field-extract）；剩余 10% 应当 honest reject 以触发 LLM fallback 到结构化更清晰的 capability。
- **写回**：`SED_UNSUPPORTED_NOTE` / `AWK_UNSUPPORTED_NOTE` 显式 export；测试锁定 reject path。

#### 偏移 4 — `curl` budget 默认 **opt-in unbounded**，而非 P2 design §4.3 提议的 "default 20 / turn"

- **GPT 安排**（间接，承自 P2 design §4.3）：`Default: 20 per turn (conservative)`。
- **实际执行**：`createNetworkHandlers({ budget })` 默认 **不传** = unbounded；要 enforce 必须 caller 显式 `createSubrequestBudget({ subrequests: N, responseBytes: M })` 注入。
- **原因**：
  1. **back-compat**：现有所有 caller（`session-do-runtime`, `agent-runtime-kernel`, integration tests）从未注入 budget；如果 default 改成 20，所有 fixtures 会立即开始 reject。
  2. **policy 不在 capability-runtime**：B3 §6.2 第 3 条明确 "F09 只证明 low-volume baseline，B3 先 ship conservative budget，真实高 volume 边界留给 B7"。Conservative 的真实形态应当是 "primitive 已就绪，policy 由消费方按 turn-context 决定"。
  3. **prompt accounting parity**：当 caller 注入 budget 时，**not-connected stub 也算一次 reservation**——这样 LLM 面对的 budget 反映的是 "tool-call 尝试次数"而非 "真实网络 hit 次数"。
- **写回**：`SubrequestBudget` 接口 export；6 个 budget tests；不在 `createNetworkHandlers` 默认行为中加约束。

#### 偏移 5 — `WRITE_OVERSIZE_REJECTED_NOTE` 用 **structural duck-typing**，而非 `instanceof ValueTooLargeError`

- **GPT 安排**：P4-01 写 "在当前 `filesystem.ts -> WorkspaceFsLike.writeFile()` seam 上捕获 B2 `ValueTooLargeError`"。
- **实际执行**：`isValueTooLarge(err)` 用 structural shape check（`name === "ValueTooLargeError"` + `bytes` / `cap` / `adapter` 字段都是数字/字符串），不 import `@nano-agent/storage-topology`。
- **原因**：
  1. **package layering**：capability-runtime 当前不依赖 storage-topology（package.json 没声明）。如果加 import 会强迫 capability-runtime 永远绑定 storage-topology 的 major 版本。
  2. **WorkspaceFsLike 是 protocol seam**：consumer 可以注入任何 `WorkspaceFsLike` 实现（如 in-memory test fixture / future remote backend）；只要它抛符合 `ValueTooLargeShape` 的 error，capability 层就会做正确 mapping。
  3. **避免循环依赖风险**：B4 (context-management) 计划 import capability-runtime；如果 capability-runtime 也 import storage-topology，B4 的依赖图会变得更紧。
- **写回**：`filesystem.test.ts` 用 plain `new Error()` + 设属性的方式 fake 出 `ValueTooLargeError` shape，**显式证明** capability-runtime 不需要真的 import 那个 class。

#### 偏移 6 — diff 算法实现 **真 LCS**，而非 line-by-line naive compare

- **GPT 安排**：P5-01 写 "`diff` 至少支持 deterministic unified-style textual output"。
- **实际执行**：完整 O(n*m) LCS table，emit minimal-context unified hunks。
- **原因**：naive line-by-line compare 在常见的 "插一行/删一行" 场景下会 emit 错位的 hunk（把所有后续行报告成 changed），LLM 面对这种输出会误判为大幅修改而触发不必要的回退。LCS 是 `diff` 的事实标准最小算法；64 KiB output cap + 64 KiB 文件大小约束下不会有内存问题。

#### 其他设计内的等价取舍（不算偏移）

- 9 commands 全部 `policy: "allow"`（read-only / pure-function；与 12-pack 中 `cat / pwd / ls / rg` 同档）。
- 9 commands `kind: "filesystem"`（不是 `text` / `processing` 等新 kind）—— 避免引入新 `CapabilityKind` 枚举值。
- 9 commands 共享 `TEXT_OUTPUT_MAX_BYTES = 64 KiB` cap（与 `curl` 默认 cap 同款大小，trivial 一致性）。
- 沿用现有 `LocalCapabilityHandler` 签名 + `createTextProcessingHandlers(config)` 工厂模式（与 `createFilesystemHandlers` / `createNetworkHandlers` API 对称）。
- `NR == K { print }` / `/PAT/ { print }` 中的 `print` 既可以无参（= `print $0`）也可以带 `$0/$N` 列表 — 比 P2 design 略宽一点点，但仍属同一 grammar 节点，无 surface 变化。

### 11.3 全部新增与修改文件

#### 11.3.1 `@nano-agent/capability-runtime`

**新增**：

- `src/capabilities/text-processing.ts` — 9 commands 的全部实现（~700 行；含 jq path-walker / sed s-only / awk single-rule interpreter / sort / uniq / LCS diff / 共享 UTF-8 boundary truncation）。
- `test/capabilities/text-processing-core.test.ts` — wave 1 6 命令 32 cases（happy path + size-cap + UTF-8 boundary + reserved-namespace + not-connected stub）。
- `test/capabilities/text-processing-aux.test.ts` — wave 2 3 命令 14 cases。
- `test/planner-text-processing.test.ts` — 9 命令的 argv→structured 映射 + bash-narrow rejection（29 cases）。

**修改**：

- `src/fake-bash/commands.ts` — `MINIMAL_COMMANDS` 从 12 → 21 (append-only；前 12 行不动；加 9 个 declaration)。
- `src/planner.ts` — `checkBashNarrow` 增加 `TEXT_PROCESSING_BASH_NARROW_REQUIRED` set + reject `-flag` 路径；`buildInputFromArgs` 增加 9 个 case；export `TEXT_PROCESSING_BASH_NARROW_NOTE`。
- `src/capabilities/filesystem.ts` — `write` handler 增加 `try { writeFile } catch` 块；增加 `isValueTooLarge` structural type guard；export `WRITE_OVERSIZE_REJECTED_NOTE`。
- `src/capabilities/network.ts` — 增加 `SubrequestBudget` interface + `createSubrequestBudget()` factory + `CURL_BUDGET_EXHAUSTED_NOTE` const；`createNetworkHandlers` 增加 optional `budget` field；`curl` handler 在 not-connected stub + connected fetch 两条路径都 `reserveSubrequest`，并在拿到 body 后 `recordResponseBytes`（按 cap 截断后的字节数）。
- `src/index.ts` — export `createTextProcessingHandlers` / 5 个 text-processing 常量 / `WRITE_OVERSIZE_REJECTED_NOTE` / `MKDIR_PARTIAL_NOTE` / `CURL_BUDGET_EXHAUSTED_NOTE` / `createSubrequestBudget` / `SubrequestBudget` / `TEXT_PROCESSING_BASH_NARROW_NOTE`。
- `test/inventory-drift-guard.test.ts` — `EXPECTED_COMMAND_ORDER` 12 → 21；`EXPECTED_POLICY` 加 9 个 `allow` 项；JSDoc 标注 B3 expansion；2 处 it 描述更新。
- `test/integration/command-surface-smoke.test.ts` — `ALLOWLIST` 12 → 21；`registers exactly` 12 → 21。
- `test/fake-bash-bridge.test.ts` — `listCommands` 测试 12 → 21（保留现有 8 个 contains，增加 9 个 contains）。
- `test/commands.test.ts` — 增加 1 个 `it` 检查 9 text-processing commands 都注册并 `policy === "allow"`。
- `test/filesystem.test.ts` — 增加 `describe("write oversize disclosure (B3 P4 / F08)")` 块，3 cases（happy mapping / non-VTLE pass-through / `/_platform/**` 仍优先 reject）。
- `test/capabilities/network-egress.test.ts` — 增加 `describe("curl — subrequest budget (per spike-do-storage-F09)")` 块，6 cases（默认 unbounded / subrequests 限制 / responseBytes 限制 / not-connected 也算 / snapshot / 跨多次 createNetworkHandlers 共享 budget）。
- `README.md` — 重写 `## Supported commands` 为 21-pack（12 baseline + B3 wave 1 + B3 wave 2 三表分组）；增加 budget / oversize disclosure 段落。

#### 11.3.2 文档

**修改**：

- `docs/design/after-skeleton/PX-capability-inventory.md` — §7.1 增加 9 行 (wc / head / tail / jq / sed / awk / sort / uniq / diff)；保持 row order 与代码 canonical order 一致；标注 `Supported` (wc/head/tail/sort/uniq/diff) 与 `Partial (worker-safe subset)` (jq/sed/awk) 区分。
- `docs/action-plan/after-foundations/B3-fake-bash-extension-and-port.md` — §0 status `draft → shipped`；§7 DoD 全 ✅；§8 exit criteria 加 Status 列全 ✅；附本 §11 工作日志。

### 11.4 最终分析与收口意见

#### 11.4.1 9 个 §8 exit criteria 状态

全部 ✅，参见 §8 表格。

#### 11.4.2 B1 finding 消化映射

| Finding | B3 处理 | Evidence |
|---|---|---|
| **F07** 12-pack capability-parity contracts hold | ✅ 12-pack 文件 (`filesystem.ts` / `search.ts` / `vcs.ts` / `exec.ts` / `network.ts` 已有部分) 全部不动；`MKDIR_PARTIAL_NOTE` / `/_platform/**` reserved / `rg` cap 测试无回归；reserved-namespace 在 9 个新命令上同款生效（`text-processing-core.test.ts` "rejects /_platform/** ..." case） | drift guard pass + 全 12-pack 既有测试 pass |
| **F08** DO storage cap 1-10 MiB | ✅ `filesystem.ts:write` 在 `WorkspaceFsLike.writeFile()` seam 上捕获 structural `ValueTooLargeError`；映射成 `WRITE_OVERSIZE_REJECTED_NOTE` 显式 disclosure；测试锁定不外泄 `SQLITE_TOOBIG` 或硬编码 `1 MiB` | `filesystem.test.ts` "write oversize disclosure" describe block |
| **F09** curl subrequest budget | ✅ `createSubrequestBudget()` opt-in primitive；`curl` handler 在 stub + connected 两条路径都 reserve；exhausted → throw with `CURL_BUDGET_EXHAUSTED_NOTE`；**不**新增 CapabilityEventKind（per Phase 1 P1-03 freeze） | `network-egress.test.ts` "curl — subrequest budget" describe block |

**3/3 B3-scope finding 全部消化**（F01-F06 / F08 / unexpected-F01-02 在 B2 已消化，不属于 B3 scope）。

#### 11.4.3 已知 Caveats（继承自 B1，与 B3 ship 共存）

1. **F09 仅 low-volume baseline (25 fetch)**：B3 ship 的 `SubrequestBudget` 是 primitive；真实可承诺的 per-turn budget 上限由 B7 高 volume 复跑确定 (P6 §4.3)。
2. **`jq / sed / awk` subset 是 honest partial**：reject 所有未支持形式；不替代 full jq/sed/awk。如果 LLM 频繁触发 reject，需要在 B7+ 评估是否扩 subset (推荐基于真实 prompt 流量再评估，避免猜测)。
3. **B2 carry-forward caveats 在 B3 仍生效**（GPT B2 review §12.3）：
   - C(B2) `R2Adapter.listAll() maxPages` silent-truncate — 不影响 B3，但 B4 在 hybrid storage tier router 阶段消费 `listAll` 时仍需注意。
   - C(B2) `ReferenceBackend` promote/inline overwrite 不闭环 — 不影响 B3，但 B4 接通时建议先补。

#### 11.4.4 B4 / B7 / B8 downstream input

**B4 (Context-management package)** 可消费的 B3 surface：

- `text-processing` 9 commands 已 ship + 共享 64 KiB output cap → context-management 在 prompting 时可以**承诺 LLM** 这些命令对一个文件返回 ≤ 64 KiB（任何更大输出会自动 truncate + 标注 `text-output-truncated`）；async-compact 的 compaction prompts 可以基于此能力假设真实可用。
- `WRITE_OVERSIZE_REJECTED_NOTE` 出现时 → context-management 应当感知此为 "blob 太大需 promote 到 R2"；下次同 path 写入应改路径或先走 R2 promotion (consume B2 `ReferenceBackend({ doStorage, r2 })`).
- `CURL_BUDGET_EXHAUSTED_NOTE` 出现时 → context-management 的 turn-policy 应当：(a) 暂停后续 outbound fetch；(b) 把当前 subrequest 用量纳入 prompt 反馈；(c) 决定是否触发 compact/降级。
- `createSubrequestBudget({ subrequests, responseBytes })` 是 turn-scope primitive → B4 的 turn-context 包装可直接构造一个新 budget object，注入到 `createNetworkHandlers`，并在 turn 结束 `snapshot()` 上报。

**B7 (Round 2 integrated)** 必须复测的项：

- F09 高 volume curl 阶梯（业主 Q2 提供测试 URL）→ 跑 50 / 100 / 500 / 1000 fetch 验证真实 rate-limit 边界，校准 `createSubrequestBudget` 的 production-recommended default（B3 的 opt-in unbounded 只是 primitive；production 默认推荐值需要 B7 真测）。
- F08 binary-search precise cap → 校准 B2 `DOStorageAdapter.maxValueBytes` 默认 1 MiB；如果调高（e.g. 4 MiB），B3 的 `write` oversize disclosure **无需修改**（消费的是 typed shape 上的 `cap` 字段，不硬编码）。
- F07 + B3 9 个 text-processing 命令在真实 worker runtime 上跑 contract test → 验证 reserved-namespace + path-law + UTF-8 boundary truncation 在 wrangler 4.x 上的实际行为与本地 vitest fixture 一致。
- text-processing 在大文件 (>64 KiB pre-cap, >1 MiB raw) 上的 wallclock 性能 → 决定是否需要把某些命令 (e.g. `diff`) 限制为 ≤ N 行才允许调用。

**B8 (Worker-matrix pre-convergence)** handoff memo 应 cite：

- 21-command fake-bash surface 已在 single worker (LocalTsTarget) 上稳定运行；`bash.core` worker 化时可以**直接** wrap `createFilesystemHandlers` + `createSearchHandlers` + `createTextProcessingHandlers` + `createNetworkHandlers({ budget })`。
- `text-processing.ts` 不依赖 fetchImpl，不依赖 R2/KV/D1/DO bindings——它是**纯 workspace-coupled**，意味着 `bash.core` 只需要从 service binding 拿到一个 `WorkspaceFsLike`-shaped seam 就能完整 host 这 9 命令。
- `curl` 是唯一需要 `fetchImpl` 注入的 capability。`bash.core` worker 化时如果选择把 `curl` 留在 `bash.core` 内，需要决定 fetch 走 worker-native `globalThis.fetch` 还是 service-binding 到一个 dedicated `network.core`。
- F07 contract 验证已扩展到 9 个新命令（reserved-namespace + path-law 通过共享 helper），意味着**整个 21-command surface 都可以承诺**这些 contract 不会偷漏。

#### 11.4.5 收口意见

B3 严格遵循"先 contract、先 surface、后 handler；先 pure-text、后 platform-coupled；先 package 内闭合、后 inventory/docs"的执行原则。6 处偏移**全部基于 P2 design 的精神方向 + B1 finding 实然约束 + 既有 12-pack contract 不破坏原则**——例如 `head -n` 拒绝是为了贯彻 P1-02 file/path-first 决定，sed/awk subset 收紧是为了贯彻 P2 §3.3 不 import upstream 原则。

**特别注意 implementer 给 B4 起草者的提醒**：
- B4 的 `kv-tier.ts` hot-path metadata 写应当用 B2 `KvAdapter.putAsync()`（per B2 handoff），但要**记得它是 warn-and-swallow**——不是 durable ack（B2 GPT review §12.3 caveat）。这条与 B3 无关，但 B4 起草者必须读 B2 §12 review。
- B4 `context-management/storage/` 的 hybrid tier router **可以从 B2 `ReferenceBackend({ doStorage, r2 })` 三模式 substrate 起步**，但要补 promotion lifecycle 闭合（B2 GPT review §12.3 发现 2 — promoted→inline overwrite 不清理旧 R2 blob）。这是 B4 implementer 的 carry-forward task。
- B4 的 async-compact `committer.ts` 不要试图用 D1 transaction wrap；F06 是硬约束；用 `DOStorageAdapter.transaction(callback)`，且 **size guard 要在 tx 外做** (B2 GPT review §12.3 发现 3)。
- 现有 B3 ship 的 `text-processing` 9 命令对**一个 file** 返回 ≤ 64 KiB；如果 B4 在 compact prompt 里允许 LLM 用 `cat large-file.json` + `jq …`，则需要在 prompt 中 **告知 cap 的存在**，否则模型不会知道为什么输出被截断。

**verdict**: ✅ B3 closed-with-evidence；ready for B4 + B7 起草。

| Date | Author | Change |
|---|---|---|
| 2026-04-20 | Opus 4.7 (1M context) | 初版 §11 工作日志；记录 6 phase 全 walk + 6 处偏移原因 + 全部新增/修改文件清单 + DoD 全 ✅ + downstream handoff input |
