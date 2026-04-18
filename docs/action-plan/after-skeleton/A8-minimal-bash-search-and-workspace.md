# A8. Nano-Agent Minimal Bash Search and Workspace 执行计划

> 服务业务簇: `Capability Runtime / Fake Bash / Workspace`
> 计划对象: `after-skeleton / Phase 7a / minimal-bash-search-and-workspace`
> 类型: `modify`
> 作者: `GPT-5.4`
> 时间: `2026-04-18`
> 执行序号: `A8 / 10`
> 上游前序: `A7`
> 下游交接: `A9`, `A10`
> 文件位置: `packages/capability-runtime/**`, `packages/workspace-context-artifacts/**`, `test/e2e/e2e-07-workspace-fileops.test.mjs`, `docs/design/after-skeleton/P7a-minimal-bash-search-and-workspace.md`
> 关键仓库锚点: `packages/capability-runtime/src/{fake-bash/commands,planner,capabilities/filesystem,capabilities/search}.ts`, `packages/workspace-context-artifacts/src/{mounts,backends/types}.ts`
> 参考 context / 对标来源: `context/just-bash/src/fs/mountable-fs/mountable-fs.ts`, `context/just-bash/README.md`
> 关联设计 / 调研文档:
> - `docs/plan-after-skeleton.md`
> - `docs/design/after-skeleton/P6-storage-and-context-evidence-closure.md`
> - `docs/design/after-skeleton/P7a-minimal-bash-search-and-workspace.md`
> - `docs/design/after-skeleton/PX-capability-inventory.md`
> - `docs/design/after-skeleton/PX-QNA.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

Phase 7a 的任务不是“把 Linux 文件系统搬进 Worker”，而是把 nano-agent 的 fake bash 里最基础、也最容易漂移的一层先收紧：**workspace truth 只来自 `MountRouter + WorkspaceNamespace`，search 只在这套 truth 内运行，bash 只是兼容外形**。当前仓库已经有一条很有价值的基线：`registerMinimalCommands()` 已把 `pwd/ls/cat/write/mkdir/rm/mv/cp/rg/...` 固定进 registry，`createFilesystemHandlers()` 已能走 namespace-backed file ops，`MountRouter` 已有 `/_platform/` reserved namespace regression guard，`test/e2e/e2e-07-workspace-fileops.test.mjs` 也已经证明 `ls/cat/write` 可以通过 workspace mount 跑通。

但同一时间，Phase 7a 的缺口也非常明确：`rg` 现在仍只是简单 TS scan stub；`grep/egrep/fgrep` 还没有任何兼容 alias；`mkdir` 还只是 compatibility ack，因为 `WorkspaceBackend` 本身没有真正的 directory primitive；planner 也只支持极窄的 `rg <pattern> [path]` 形态。Q15 已冻结 **v1 canonical search command 只保留 `rg`**，Q16 已冻结 **`grep -> rg` 兼容 alias 是优先回补项，但不改变 canonical truth**。因此这份 action-plan 的目标，是把 **workspace substrate、search surface、path law、partial disclosure、snapshot/evidence 对齐** 一次性收成一套可执行包，避免 Phase 7 之后还要靠 README 或 prompt 去解释“这些命令其实只是半真的”。

- **服务业务簇**：`Capability Runtime / Fake Bash / Workspace`
- **计划对象**：`after-skeleton / Phase 7a / minimal-bash-search-and-workspace`
- **本次计划解决的问题**：
  - workspace truth 已存在，但 file/list/search 还没有被收成一套单一命名与 routing law
  - `rg` 已注册成 canonical search command，但当前实现仍停留在 degraded stub
  - `mkdir` 仍是 partial reality， yet command registry / prompt / inventory 还没有完全收口
- **本次计划的直接产出**：
  - 一套明确的 workspace/search contract：namespace-first、canonical `rg`、path formatting 一致
  - 一套 `grep -> rg` 最窄兼容、readonly/reserved-path law、bounded search output 的实现与测试
  - 一份同步更新到 inventory/docs/tests 的 Phase 7a exit pack

---

## 1. 执行综述

### 1.1 总体执行方式

这份 action-plan 采用 **先冻结 workspace truth 与 disclosure，再补 filesystem/search contract，再收最窄 alias 与一致性，再补 evidence/docs** 的推进方式。核心原则是：**workspace 是 truth、registry 是 truth、inventory 也是 truth；搜索不得绕过 mount universe；partial support 宁可保守披露，也不允许包装成 fully supported。**

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Workspace Truth & Inventory Freeze | `M` | 冻结 workspace/search 的 single source of truth、canonical `rg`、partial disclosure 与 path law | `A7 + PX-QNA / PX-capability-inventory` |
| Phase 2 | Filesystem Contract Hardening | `M` | 收紧 namespace-backed file ops、readonly/reserved-path 行为与 `mkdir` partial reality | `Phase 1` |
| Phase 3 | Canonical Search & Alias Closure | `M` | 让 `rg` 成为真正的 minimal search baseline，并补最窄 `grep -> rg` 兼容层 | `Phase 2` |
| Phase 4 | File/Search Consistency & Evidence Wiring | `M` | 保证 list/cat/search 对同一路径宇宙给出一致命名，并接入 snapshot/evidence 约束 | `Phase 3` |
| Phase 5 | Tests, Docs & Inventory Exit Pack | `S` | 用 package/integration/E2E 证据与 capability inventory 把 P7a 正式封箱 | `Phase 4` |

### 1.3 执行策略说明

- **执行顺序原则**：`先 freeze truth，再修 filesystem/search，再补 alias，再做 evidence/docs`
- **风险控制原则**：`不允许 search 绕过 namespace；不允许把 mkdir/rg 直接升级成 supported 但无证据；不允许 root mount 吞掉 /_platform`
- **测试推进原则**：`先 capability-runtime package tests，再 workspace package tests，再 root E2E / consistency guards`
- **文档同步原则**：`P7a design、PX inventory、capability-runtime README 与 command disclosure 必须同口径`

### 1.4 本次 action-plan 影响目录树

```text
minimal-bash-search-and-workspace
├── packages/capability-runtime
│   ├── src/{fake-bash/commands,planner,capabilities/filesystem,capabilities/search}.ts
│   ├── test/fake-bash-bridge.test.ts
│   └── test/integration/{command-surface-smoke,search-smoke,file-search-consistency}.test.ts
├── packages/workspace-context-artifacts
│   ├── src/{mounts,namespace,backends/types}.ts
│   └── test/{mounts,namespace}/**/*.test.ts
├── test
│   └── e2e/e2e-07-workspace-fileops.test.mjs
└── docs
    ├── action-plan/after-skeleton/A8-minimal-bash-search-and-workspace.md
    └── design/after-skeleton/{P7a-minimal-bash-search-and-workspace,PX-capability-inventory}.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 冻结 `MountRouter + WorkspaceNamespace` 为 workspace truth，并让 file/search surface 统一消费它
- **[S2]** 让 `rg` 成为唯一 canonical search command，并给出最小可验证实现
- **[S3]** 补最窄 `grep -> rg` alias compatibility，但不引入独立 grep capability family
- **[S4]** 明确 `mkdir` 的 partial reality，并决定是最小补强还是显式保持 partial disclosure
- **[S5]** 为 file/list/search/path formatting、reserved namespace、snapshot/evidence 补一致性与回归证据

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 完整 POSIX filesystem 语义、inode/permission/symlink/watcher
- **[O2]** 完整 ripgrep feature set（glob、ignore files、multiline、PCRE2、复杂 flags）
- **[O3]** 把 `grep/egrep/fgrep` 做成独立 capability / command family
- **[O4]** 把 `mkdir` 升级成完整目录元数据模型

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| canonical search command = `rg` | `in-scope` | Q15 已冻结；registry/prompt/inventory 都必须统一 | 仅在 owner 重新决策 search canon 时重评 |
| `grep -> rg` alias | `in-scope` | Q16 已要求作为优先回补项，但仅做最窄兼容 | P7a 完成后仅在 richer search 设计时重评 |
| `egrep/fgrep` alias | `out-of-scope` | 当前没有必要扩大 parser/semantics 复杂度 | 下一阶段如有明确需求再重评 |
| `mkdir` fully supported | `depends-on-phase` | 当前 backend 无真实 directory primitive，不能口头升级 | P7a 结束时按实现与证据决定是否仍为 partial |
| `/_platform/` reserved namespace law | `in-scope` | 当前已有回归测试，必须继续成为 workspace/search 共同边界 | 长期保留 |
| search 扫宿主 / 真 ripgrep binary | `out-of-scope` | 与 Worker/V8 isolate 前提和 fake bash 路线冲突 | 永不作为 v1 路线重评 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | Workspace Truth Freeze | `update` | `workspace-context-artifacts/src/{mounts,namespace}.ts`, P7a/PX docs | workspace/search/file ops 都只认 namespace truth | `high` |
| P1-02 | Phase 1 | Search Canon & Disclosure Sync | `update` | `capability-runtime/src/{fake-bash/commands,planner}.ts`, README/docs | `rg` canonical、`grep` alias、partial disclosure 全部同口径 | `high` |
| P1-03 | Phase 1 | Path Formatting Law | `update` | filesystem/search handlers, docs | list/cat/search 共享路径格式与 workspace root 语义 | `medium` |
| P2-01 | Phase 2 | Filesystem Handler Hardening | `update` | `capabilities/filesystem.ts`, workspace tests | readonly/write/delete/list 行为继续锚定 namespace reality | `medium` |
| P2-02 | Phase 2 | `mkdir` Partial Closure | `update` | `capabilities/filesystem.ts`, `backends/types.ts`, tests | 不再让 `mkdir` 处于“看起来成功但语义不明”的状态 | `high` |
| P2-03 | Phase 2 | Reserved Namespace Search Guard | `update` | `capabilities/search.ts`, `mounts.ts`, tests | `/_platform/` law 对 search 也成立 | `medium` |
| P3-01 | Phase 3 | Minimal `rg` Reality | `update` | `capabilities/search.ts`, tests | `rg` 不再只是 declaration；拥有最小可验证行为 | `high` |
| P3-02 | Phase 3 | `grep -> rg` Alias Compatibility | `update` | `fake-bash/commands.ts`, `planner.ts`, tests | 最小 grep-compatible 心智成立，但 canonical truth 不变 | `medium` |
| P3-03 | Phase 3 | Bounded Search Output | `update` | search handlers + promotion/evidence seams | 搜索输出 deterministic/bounded，超界结果可转 artifact/ref | `medium` |
| P4-01 | Phase 4 | File/Search Consistency Guard | `update` | package tests + root E2E | 同一路径在 list/cat/search 中没有三套命名 | `medium` |
| P4-02 | Phase 4 | Snapshot / Evidence Alignment | `update` | workspace snapshot, eval notes, docs | workspace/search 状态能被 snapshot/evidence 解释 | `medium` |
| P5-01 | Phase 5 | Package / E2E Test Gate | `update` | capability/workspace/root tests | 用现有 test surface 证明 Phase 7a 真实成立 | `medium` |
| P5-02 | Phase 5 | Docs / Inventory Exit Pack | `update` | P7a docs, PX inventory, README | capability disclosure 不再高于实现 reality | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Workspace Truth & Inventory Freeze

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | Workspace Truth Freeze | 把 `MountRouter + WorkspaceNamespace` 明确写成 file/search 唯一 truth，拒绝任何 search 绕过 namespace 的实现路线 | `packages/workspace-context-artifacts/src/{mounts,namespace}.ts`, docs | file/search 都锚定同一个路径宇宙 | docs + code review | 后续实现不再能以“搜索另走一套宿主路径”为借口扩张 |
| P1-02 | Search Canon & Disclosure Sync | 收紧 `registerMinimalCommands()`、planner、README、inventory 的口径：`rg` canonical、`grep` 仅 alias、`mkdir/rg` 仍可能 partial | `packages/capability-runtime/src/{fake-bash/commands,planner}.ts`, README, PX docs | registry truth 与对外披露一致 | `pnpm --filter @nano-agent/capability-runtime test` | 不再出现“代码写 partial，文档写 supported” |
| P1-03 | Path Formatting Law | 明确 `ls/cat/rg` 的输入输出路径格式、workspace root 约定、relative/absolute normalization 策略 | filesystem/search handlers, docs | path naming law 固定 | targeted tests | list/cat/search 对同一路径给出一致命名 |

### 4.2 Phase 2 — Filesystem Contract Hardening

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | Filesystem Handler Hardening | 继续以 namespace-backed handlers 为主轴，收紧 writable/readonly/delete/move/copy 对 mount access law 的消费 | `packages/capability-runtime/src/capabilities/filesystem.ts`, workspace tests | filesystem commands 与 workspace backend law 对齐 | package tests + E2E | `ls/cat/write/rm/mv/cp` 都不再绕开 namespace |
| P2-02 | `mkdir` Partial Closure | 明确 `mkdir` 的 contract：要么补最小 backend primitive，要么保留 compatibility ack 但明确标记 partial 并补 deterministic tests | `capabilities/filesystem.ts`, `workspace-context-artifacts/src/backends/types.ts`, tests | `mkdir` 不再处于语义模糊区 | package tests | `mkdir` 的 capability grade 与实现 reality 一致可审阅 |
| P2-03 | Reserved Namespace Search Guard | 把 `/_platform/` reserved namespace law 从 routing 扩到 search input validation 与 traversal | `capabilities/search.ts`, `mounts.ts`, tests | search 不会因 catch-all root mount 误扫保留空间 | workspace + capability tests | `/_platform/` 在 filesystem/search 两边同样受保护 |

### 4.3 Phase 3 — Canonical Search & Alias Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | Minimal `rg` Reality | 将当前 degraded search stub 升级为最小真实行为：在 namespace 范围内扫描文本、返回 bounded/deterministic matches、保持路径 law 一致 | `packages/capability-runtime/src/capabilities/search.ts`, tests | `rg` 拥有可验证最小价值，不再只是占位符 | `pnpm --filter @nano-agent/capability-runtime test` | 至少一条 search smoke 证明结果来自真实 workspace 内容 |
| P3-02 | `grep -> rg` Alias Compatibility | 在 registry/planner 层增加最窄 alias，让常见 `grep pattern file` 心智映射到 canonical `rg`，但不暴露额外 grep feature promise | `fake-bash/commands.ts`, `planner.ts`, tests | LLM 兼容心智更平滑，但系统真相仍是 `rg` | command-surface smoke | `grep` 可被接住，且 inventory 仍只把 `rg` 记作 canonical capability |
| P3-03 | Bounded Search Output | 为 search 结果增加 deterministic truncation / promotion 策略，避免无界 inline 输出 | search handlers, promotion/evidence seams | 搜索不会成为上下文炸弹 | package tests | 大结果有稳定截断或 ref/promotion 出口 |

### 4.4 Phase 4 — File/Search Consistency & Evidence Wiring

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | File/Search Consistency Guard | 新增一致性测试：同一路径在 `ls`、`cat`、`rg` 中的命名、readonly 判定、reserved-path 规则必须一致 | capability/workspace tests, root E2E | 不再出现 file/search 双轨 reality | package tests + `test/e2e/e2e-07-workspace-fileops.test.mjs` | file/list/search consistency 成为固定回归资产 |
| P4-02 | Snapshot / Evidence Alignment | 让 search 结果与 workspace snapshot、artifact promotion、Phase 6 evidence 口径对齐 | workspace snapshot/docs/eval notes | workspace/search 状态能被解释、回放与审阅 | targeted tests + docs review | snapshot 记录 workspace truth，而非 bash history 幻觉 |

### 4.5 Phase 5 — Tests, Docs & Inventory Exit Pack

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | Package / E2E Test Gate | 执行 capability-runtime、workspace-context-artifacts、root E2E / cross tests，补足 search smoke 与 consistency 回归 | package tests + root tests | Phase 7a 有 package + E2E 双层证据 | `pnpm --filter @nano-agent/capability-runtime test`, `pnpm --filter @nano-agent/workspace-context-artifacts test`, root tests | `rg`/workspace law 不再只有 design 结论，没有运行证据 |
| P5-02 | Docs / Inventory Exit Pack | 更新 P7a design、PX inventory、capability-runtime README 与 command disclosure | docs + README | future prompt/reviewer 直接引用同一真相 | docs review | 对外能力描述不再高于代码与测试 reality |

---

## 5. Phase 详情

### 5.1 Phase 1 — Workspace Truth & Inventory Freeze

- **Phase 目标**：先让 workspace/search 的 truth 与披露口径冻结，避免后续实现阶段继续长出平行现实。
- **具体功能预期**：
  1. `MountRouter + WorkspaceNamespace` 被明确为 file/search 唯一 substrate。
  2. `rg` canonical 与 `grep` alias 的身份边界固定。
  3. `mkdir/rg` 若仍 partial，会被显式写进 inventory/README，而非默许升级。
- **测试与验证重点**：
  - command-surface smoke 继续固定 12-command baseline
  - disclosure review 覆盖 README / design / inventory / registry 四处一致性

### 5.2 Phase 2 — Filesystem Contract Hardening

- **Phase 目标**：把 workspace-facing file ops 全部收紧到 namespace law，并把 `mkdir` 的模糊区消掉。
- **具体功能预期**：
  1. writable/readonly mount law 在 filesystem handlers 中继续保持强约束。
  2. `/_platform/` reserved namespace law 从 routing 延伸到 filesystem/search 输入。
  3. `mkdir` 得到清晰 contract：要么最小实现、要么诚实 partial。
- **测试与验证重点**：
  - workspace mount tests
  - readonly write rejection
  - `/_platform/` regression guards

### 5.3 Phase 3 — Canonical Search & Alias Closure

- **Phase 目标**：让 `rg` 具备最小真实价值，并为 LLM 常见 `grep` 心智提供最窄兼容。
- **具体功能预期**：
  1. `rg` 在 namespace 里扫描真实文本，不再返回纯占位字符串。
  2. `grep pattern file` 可被 planner 接住并落到 canonical `rg` 语义。
  3. 搜索输出 bounded/deterministic，必要时进入 promotion/ref 路径。
- **测试与验证重点**：
  - search smoke
  - alias smoke
  - large-output truncation / promotion tests

### 5.4 Phase 4 — File/Search Consistency & Evidence Wiring

- **Phase 目标**：保证 workspace 与 search 的结果不仅“能跑”，还可以被 snapshot/evidence 正确解释。
- **具体功能预期**：
  1. `ls/cat/rg` 对同一路径保持一致命名与 mount law。
  2. search 结果可进入 snapshot/evidence 语境，而不只剩 stdout。
  3. capability grade 与 evidence 关系被固定到 inventory 术语中。
- **测试与验证重点**：
  - file/list/search consistency tests
  - workspace snapshot alignment checks

### 5.5 Phase 5 — Tests, Docs & Inventory Exit Pack

- **Phase 目标**：让 Phase 7a 结束时，search/workspace capability 已经可被后续 phase 直接消费。
- **交付要求**：
  1. package + root E2E 证据齐备
  2. README / P7a / PX inventory 同口径
  3. 后续 P7b/P7c 不再需要重新解释 workspace/search 的基础边界

---

## 6. 风险、依赖与验收

### 6.1 关键依赖

| 依赖项 | 作用 | 当前状态 | 本计划应对方式 |
|--------|------|----------|----------------|
| `WorkspaceNamespace` / `MountRouter` | workspace truth substrate | 已存在并有回归测试 | 直接作为唯一 truth 消费 |
| `registerMinimalCommands()` | command registry truth | 已存在 | 同步 canonical/alias/disclosure |
| `test/e2e/e2e-07-workspace-fileops.test.mjs` | workspace E2E baseline | 已存在 | 在此之上补 search 与 consistency |
| PX capability inventory | 能力披露总表 | 已有 design memo | Phase 5 一并同步 |

### 6.2 主要风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| `mkdir` 继续语义模糊 | 既不补 primitive，也不明确 partial | prompt / docs 会高估能力 | Phase 2 必须作出清晰 contract 决定 |
| `grep` alias 过度扩张 | 为兼容心智引入复杂 flags/semantics | planner 与 capability truth 再次漂移 | alias 只做最窄映射，不建立独立 grep family |
| search 输出无界 | 大仓或大文件扫描直接 inline | 上下文/内存失控 | bounded truncation + promotion/ref |

### 6.3 完成定义（Definition of Done）

1. `rg` 成为有最小真实行为与测试证据的 canonical search command。
2. `grep -> rg` 兼容存在，但 inventory/prompt 仍只以 `rg` 为 canonical truth。
3. `mkdir` 的 capability grade 与实际实现不再冲突。
4. file/list/search/path law 在 capability-runtime、workspace package、README、PX inventory 中一致。
5. root E2E 与 package tests 都能说明 Phase 7a 已从观点收敛为可执行 reality。

---

## 7. 收口结论

Phase 7a 的执行重点不是“再多给几个 bash 命令”，而是把 fake bash 的 **工作目录宇宙** 先定住。只要 workspace truth、canonical `rg`、`grep` 最窄兼容、`mkdir` partial disclosure、以及 file/search consistency 被真正收口，后续 `curl`、`ts-exec`、`git` 这些更高风险 surface 才不会继续建立在漂浮地基之上。这也是为什么 P7a 必须作为最后三份 minimal-bash action-plan 里的第一份先落盘：它决定了 fake bash 后面所有能力究竟是在同一个 workspace 世界里生长，还是重新滑回“像 shell，但不知真相在哪”的老问题。
