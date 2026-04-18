# Nano-Agent 代码审查报告

> 审查对象: `docs/action-plan/after-skeleton/A8-minimal-bash-search-and-workspace.md` / `docs/action-plan/after-skeleton/A9-minimal-bash-network-and-script.md` / `docs/action-plan/after-skeleton/A10-minimal-bash-vcs-and-policy.md`
> 审查时间: `2026-04-18`
> 审查人: `GPT-5.4`
> 审查范围:
> - `packages/capability-runtime/**`
> - `packages/workspace-context-artifacts/**`
> - `test/e2e/e2e-07-workspace-fileops.test.mjs`
> - `docs/design/after-skeleton/P7a-minimal-bash-search-and-workspace.md`
> - `docs/design/after-skeleton/P7b-minimal-bash-network-and-script.md`
> - `docs/design/after-skeleton/P7c-minimal-bash-vcs-and-policy.md`
> - `docs/design/after-skeleton/PX-capability-inventory.md`
> - `docs/action-plan/after-skeleton/AX-QNA.md`
> - `docs/design/after-skeleton/PX-QNA.md`
> - `context/just-bash/README.md`
> - `context/just-bash/src/fs/mountable-fs/mountable-fs.ts`
> - `context/just-bash/src/commands/js-exec/worker.ts`
> - `context/claude-code/services/tools/toolExecution.ts`
> - `context/codex/codex-rs/tools/src/tool_registry_plan.rs`
> - `context/mini-agent/mini_agent/tools/bash_tool.py`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`A8/A9/A10 的主体骨架已经真实落地：workspace truth、minimal command pack、restricted curl、ts-exec honest partial、git read-only subset、taxonomy/disclosure helpers 都存在；但当前仍有 3 条 correctness contract 没有兑现，以及 1 条 inventory drift guard 被明显说重，因此不应标记为 completed。`
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `A8 的 rg 已不再是 stub，但它会漏扫带点号的目录（如 .config / foo.bar），这直接破坏“workspace truth + canonical rg”承诺。`
  2. `A9 的 curl 口头上是 byte-bounded output，实际却按 JS 字符数截断；多字节响应下会突破它自己宣称的 byte cap。`
  3. `A10 的 git subset / taxonomy / disclosure helpers 已经成形，但 inventory drift guard 目前只是在锁硬编码 fixture，并没有真正校验 PX inventory 文档本体，因此“代码改了不改 docs 会被 CI 挡住”的说法还不成立。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/after-skeleton/A8-minimal-bash-search-and-workspace.md`
  - `docs/action-plan/after-skeleton/A9-minimal-bash-network-and-script.md`
  - `docs/action-plan/after-skeleton/A10-minimal-bash-vcs-and-policy.md`
  - `docs/design/after-skeleton/P7a-minimal-bash-search-and-workspace.md`
  - `docs/design/after-skeleton/P7b-minimal-bash-network-and-script.md`
  - `docs/design/after-skeleton/P7c-minimal-bash-vcs-and-policy.md`
  - `docs/design/after-skeleton/PX-capability-inventory.md`
  - `docs/action-plan/after-skeleton/AX-QNA.md`
  - `docs/design/after-skeleton/PX-QNA.md`
- **核查实现**：
  - `packages/capability-runtime/src/{planner,fake-bash/commands,fake-bash/bridge,fake-bash/unsupported}.ts`
  - `packages/capability-runtime/src/capabilities/{workspace-truth,filesystem,search,network,exec,vcs}.ts`
  - `packages/capability-runtime/src/{targets/service-binding,tool-call}.ts`
  - `packages/capability-runtime/test/**`
  - `packages/workspace-context-artifacts/src/{namespace,mounts,backends/memory}.ts`
  - `test/e2e/e2e-07-workspace-fileops.test.mjs`
  - `context/just-bash/README.md`
  - `context/just-bash/src/fs/mountable-fs/mountable-fs.ts`
  - `context/just-bash/src/commands/js-exec/worker.ts`
  - `context/claude-code/services/tools/toolExecution.ts`
  - `context/codex/codex-rs/tools/src/tool_registry_plan.rs`
  - `context/mini-agent/mini_agent/tools/bash_tool.py`
- **执行过的验证**：
  - `pnpm --filter @nano-agent/capability-runtime test && pnpm --filter @nano-agent/capability-runtime typecheck && pnpm --filter @nano-agent/capability-runtime build`
  - `pnpm --filter @nano-agent/workspace-context-artifacts test && pnpm --filter @nano-agent/workspace-context-artifacts typecheck && pnpm --filter @nano-agent/workspace-context-artifacts build`
  - `node --test test/*.test.mjs`
  - `npm run test:cross`
  - `node --input-type=module` snippets against built `dist/` to reproduce:
    - `rg` missing `/workspace/project/.config/**` and `/workspace/project/foo.bar/**`
    - `curl` emitting 12 UTF-8 bytes while claiming truncation at `4 bytes`

### 1.1 已确认的正面事实

- A8 的 path law 与 workspace truth 不是空文档：`packages/capability-runtime/src/capabilities/workspace-truth.ts` 已冻结 `DEFAULT_WORKSPACE_ROOT="/workspace"`、`RESERVED_NAMESPACE_PREFIX="/_platform"`、`resolveWorkspacePath()` / `resolveWorkspacePathOrThrow()`，filesystem 与 search 也都真实消费了这条 law。
- A8/A9 的总体方向确实吸收了 `just-bash` 的真实启发，而不是空口号：`context/just-bash/src/fs/mountable-fs/mountable-fs.ts` 展示了 mount-based unified namespace，`context/just-bash/src/commands/js-exec/worker.ts` 展示了显式 sandbox/worker substrate；nano-agent 选择更窄的 Worker-native surface，而不是伪装成完整 POSIX/Node host。
- A9/A10 的核心 contract 已真实存在：`curl` 已具备 scheme/private-address guard 与 timeout/output cap，`ts-exec` 已转成 syntax-validation-only honest partial，`git` 已冻结为 `status/diff/log`，`FakeBashBridge` 继续保持 no-silent-success，相关 package tests / typecheck / build 与 root cross/E2E 入口本轮均为绿色。

### 1.2 已确认的负面事实

- `packages/capability-runtime/src/planner.ts:84-101` 把 `grep` alias 的所有 `-flag` 一律拒绝；但 `docs/action-plan/after-skeleton/AX-QNA.md:394-418` 的 Q16 最终冻结口径明确允许最窄的 `-i` 与 `-n`。
- `packages/capability-runtime/src/capabilities/search.ts:127-133` 依赖 `!candidate.includes(".")` 来猜目录；在真实 `MemoryBackend + MountRouter + WorkspaceNamespace` substrate 上，`rg` 实测会漏掉 `/workspace/project/.config/settings.json` 与 `/workspace/project/foo.bar/readme.txt`，只返回普通目录下的匹配。
- `packages/capability-runtime/src/capabilities/network.ts:146-149,214-221` 的 `truncateBody()` 按 JS 字符长度截断而不是 UTF-8 字节长度；实测当 `maxOutputBytes=4` 且响应体为 `"你".repeat(5)` 时，输出仍包含 4 个汉字（12 bytes），却宣称 `body truncated at 4 bytes`。
- `packages/capability-runtime/test/inventory-drift-guard.test.ts:30-138` 只对拍 `EXPECTED_*` 常量与 registry/taxonomy 导出，没有读取、解析或校验 `docs/design/after-skeleton/PX-capability-inventory.md` 本体；A10 对 “改代码不改 docs 会被 CI 硬拒” 的表述高于代码事实。

---

## 2. 审查发现

### R1. `grep -> rg` alias 没有兑现 Q16 冻结的最小兼容范围，`-i/-n` 被错误拒绝

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `docs/action-plan/after-skeleton/AX-QNA.md:394-418` 的 Q16 最终回答明确冻结：alias 接受 `grep <pattern> [file|dir]`，并允许 `-i`（case-insensitive）与 `-n`（line numbers）；其他 flag 才应触发 “use rg directly”。
  - 但 `packages/capability-runtime/src/planner.ts:87-101` 当前只要 `args[0]` 以 `-` 开头就直接拒绝，`packages/capability-runtime/test/planner-grep-alias.test.ts:50-60` 还把 `grep -i ...` 写成应被拒绝的回归真相。
  - `docs/action-plan/after-skeleton/A8-minimal-bash-search-and-workspace.md:285-286,340` 也沿用了 “任何 `-flag` 都拒绝” 的更旧收口口径，说明 A8 文档和 AX-QNA owner-final answer 之间仍有真实漂移。
- **为什么重要**：
  - 用户要求这轮审查必须结合 action-plan、design 与两份 QNA 的 owner feedback；在 after-skeleton 体系里，AX-QNA 是统一 owner answer 聚合点，不能被实现层或旧 action-plan 局部回填覆盖。
  - `grep` alias 的价值本来就是减少 LLM 的常见幻觉成本；把 Q16 已接受的 `-i/-n` 也拒掉，会让最常见的 grep 兼容路径再次浪费 turn/token。
- **审查判断**：
  - 当前实现与测试、A8 §11 的回填只证明“做了一个比 owner 冻结更窄的 alias”，不能算 Q16 已正确收口。
- **建议修法**：
  - 调整 `parseAliasArgs()`：显式只接受 `-i/-n` 与 `pattern [path]`，其余 flag 保持拒绝；并把这两个 flag 映射到 `rg` 的 canonical input。
  - 同步修正 `planner-grep-alias.test.ts`、A8 §11 回填与必要的 inventory/prompt 文案，避免继续以旧口径覆盖 AX-QNA。

### R2. `rg` 会漏扫带点号的目录，A8 的 canonical search baseline 仍有真实断点

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `packages/capability-runtime/src/capabilities/search.ts:127-133` 通过 `!candidate.includes(".")` 判断是否为目录；这会把 `.config`、`foo.bar` 这类目录误判成文件。
  - `packages/workspace-context-artifacts/src/backends/memory.ts:42-75` 与 `src/namespace.ts:62-80` 的真实 substrate 允许通过前缀推导出这类目录项；也就是说，这不是 fake test double 才会出现的形状，而是当前 workspace truth 自己会产生的路径。
  - 我用 built `dist/` 做最小复现：向 `MemoryBackend` 写入 `project/.config/settings.json`、`project/foo.bar/readme.txt`、`project/normal/readme.txt` 后，通过 `MountRouter + WorkspaceNamespace + createSearchHandlers()` 搜 `needle`，实际只返回 `/workspace/project/normal/readme.txt`，前两者整棵子树被漏掉。
  - A8 自己在 `docs/action-plan/after-skeleton/A8-minimal-bash-search-and-workspace.md:285,289,339-340` 与 P7a 中都把 `rg` 描述成“namespace-backed 真实 baseline / workspace truth / file-search consistency”。
- **为什么重要**：
  - 这不是 corner-case 样式问题，而是 canonical `rg` 在合法 workspace 路径空间内不能完整遍历。
  - `.config/` 与带点目录在真实 repo/workspace 中非常常见；如果 A8 允许这类目录被静默漏扫，LLM 会得到“rg 没搜到”的错误事实。
- **审查判断**：
  - A8 的 `rg` 已经比 stub 前进很多，但还不能按 “canonical search baseline 已收口” 记账。
- **建议修法**：
  - 不要用 `.` 启发式猜目录；改成基于 `listDir(candidate)` 是否有子项、或在 workspace substrate 上显式提供 `kind/isDirectory` truth。
  - 补至少两条真实回归：`/.config/**` 与 `/foo.bar/**` 目录递归扫描。

### R3. `curl` 的 “byte cap” 实现与披露不一致，多字节响应会突破边界

- **严重级别**：`high`
- **类型**：`security`
- **事实依据**：
  - `packages/capability-runtime/src/capabilities/network.ts:21-25,46-47` 与 A9 文档多处把输出边界定义成 `bytes`，并把它描述为防止 unbounded inline exfiltration 的 hard edge。
  - 但实现里的 `truncateBody()`（`packages/capability-runtime/src/capabilities/network.ts:146-149`）按 `body.length` / `slice()` 工作，`response.text()` 后的截断单位其实是 JS code unit，不是 UTF-8 bytes。
  - 本轮复现中，给 `curl` 注入 `fetchImpl` 返回 `"你".repeat(5)`，并传入 `maxOutputBytes: 4`，输出仍保留 4 个汉字（12 bytes），同时 header 行声称 `body truncated at 4 bytes`。
  - `docs/action-plan/after-skeleton/A9-minimal-bash-network-and-script.md:147-149,192-194,283,339` 明确把 `maxOutputBytes` / `bytes cap` 写成 contract 与安全边界的一部分。
- **为什么重要**：
  - 这不是文案小误差；A9 把 output cap 当成 network tool 的安全边界。
  - 如果实现与披露的单位不一致，调用方、审阅者和后续 policy layer 都会误判真实 exfiltration 上限。
- **审查判断**：
  - 当前 `curl` baseline 的 egress guard/timeout guard 真实存在，但 output cap 还没有按它自己承诺的单位落地，因此 A9 不能算完整收口。
- **建议修法**：
  - 用 `TextEncoder` 以 UTF-8 bytes 计算并截断，或把 contract 明确改成 “characters/code units cap” 并同步所有 docs/tests；前者更符合现有 A9 口径。
  - 补一条多字节响应回归测试，避免未来再次把 bytes/characters 混淆。

### R4. `inventory-drift-guard` 还不是文档真相守卫，A10 对 CI gate 的表述过度

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `packages/capability-runtime/test/inventory-drift-guard.test.ts:30-138` 只对拍 `EXPECTED_COMMAND_ORDER`、`EXPECTED_POLICY`、`EXPECTED_UNSUPPORTED`、`EXPECTED_OOM_RISK`、`GIT_SUPPORTED_SUBCOMMANDS` 与代码导出；它完全没有读取 `docs/design/after-skeleton/PX-capability-inventory.md`。
  - 该测试文件头注释 `:2-15` 与 A10 回填 `docs/action-plan/after-skeleton/A10-minimal-bash-vcs-and-policy.md:161,213,326,335-336` 都把它描述成 “prompt / registry / inventory never diverge” 的单一 enforcement point，甚至声称 “PR 时任何代码改动必须同步修改 PX inventory 才能让这个测试继续通过”。
  - 现实上，如果有人只改 `PX-capability-inventory.md` 而不改测试常量，CI 不会报；如果有人只改代码与测试常量、忘了改文档，本测试同样不会直接发现。
  - 相比之下，`context/codex/codex-rs/tools/src/tool_registry_plan.rs` 与 `context/claude-code/services/tools/toolExecution.ts` 都显示其工具真相主要由 registry/handler 自身与真实 runtime path 冻结，而不是由“声称会同步 docs 的测试注释”来兜底。
- **为什么重要**：
  - A10 的核心交付不是“有一份常量 fixture”，而是“治理真相表能阻止 registry / prompt / inventory 彼此漂移”。
  - 如果 review / CI 机制被说得比实际更强，后续 phase 会以为 capability inventory 已有硬防线，进而降低人工核对强度。
- **审查判断**：
  - 当前 drift guard 最多只能叫 `registry/taxonomy fixture guard`，不能叫 `PX inventory drift guard`。
- **建议修法**：
  - 要么让测试真实解析/校验 `PX-capability-inventory.md` 中的关键表项或 checked-in inventory fixture；要么把 A10 回填、P7c 附录 B 与测试头注释里的表述降级为 “fixture guard, not docs-backed guard”。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | A8 workspace truth freeze / path law | `done` | `workspace-truth.ts`、filesystem、search 已共享 `/workspace` + `/_platform` law。 |
| S2 | A8 namespace-backed filesystem + `mkdir` partial disclosure | `done` | `ls/cat/write/rm/mv/cp` 都走 path law，`mkdir` 也明确输出 `mkdir-partial-no-directory-entity`。 |
| S3 | A8 canonical `rg` minimal baseline | `partial` | 已不再是 stub，但会漏扫带点目录，尚未真正覆盖合法 workspace path 空间。 |
| S4 | A8 `grep -> rg` narrow compatibility (Q16) | `partial` | alias 已存在且 canonical truth 仍是 `rg`，但 owner 冻结允许的 `-i/-n` 当前被错误拒绝。 |
| S5 | A9 bash-vs-structured contract freeze | `done` | `curl` bash path 已收窄到 `curl <url>`，`ts-exec` bash path 拒绝前导 flags。 |
| S6 | A9 restricted `curl` baseline + egress/output boundary | `partial` | scheme/private-address/timeout guard 已有；但 `maxOutputBytes` 不是按 bytes 实现。 |
| S7 | A9 `ts-exec` honest partial + host interpreter unsupported | `done` | `ts-exec` 已冻结为 syntax validation only，`python/node/bash/...` 已进入 unsupported taxonomy。 |
| S8 | A9 service-binding upgrade seam / progress family reuse | `done` | transport seam、request/progress/cancel/response contract 与 regression tests 真实存在；默认仍是 `not-connected` stub 这一点也有清晰披露。 |
| S9 | A10 git read-only subset + mutating block | `done` | `git` 已冻结为 `status/diff/log`，bash 路径 mutating subcommands 明确阻断，handler 也会二次拒绝。 |
| S10 | A10 inventory / disclosure / drift guard closure | `partial` | taxonomy/disclosure helpers 已有，但 drift guard 还不是 docs-backed inventory guard。 |

### 3.1 对齐结论

- **done**: `6`
- **partial**: `4`
- **missing**: `0`

这更像 **“minimal bash 的核心 contract 已经成形，search/network/vcs 的主要 truth 也都找到了宿主；但还有若干被文档宣称为已冻结的 correctness/governance 细节并未真正收口”**，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 把 `grep/egrep/fgrep` 全量升格成正式 grep family | `遵守` | 当前仍坚持 `rg` 为 canonical，只是 alias contract 过窄，没有越界扩成 full grep。 |
| O2 | 通过 bash argv 扩张 richer curl / localhost / host interpreter / package manager 幻觉 | `遵守` | `curl -X/-H/-d` 仍被收窄，RFC1918/ULA/link-local/metadata 仍被阻断，host interpreters 仍是 unsupported。 |
| O3 | 提前引入 mutating git / virtual commit model | `遵守` | `git add/commit/...` 仍明确 blocked，没有越界承诺 virtual VCS。 |
| O4 | 在 A10 里做 auto-generated inventory 系统 | `遵守` | 当前并未偷偷实现 codegen；问题是现有 fixture guard 被说成了 docs-backed guard。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`A8/A9/A10 当前不收口；minimal-bash 的主骨架成立，但 grep alias、rg traversal、curl byte cap 与 inventory drift guard 这四处仍然使“已完成”结论站不住。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 修正 A8 的 grep alias 与 rg traversal：让 Q16 允许的 `-i/-n` 成立，并补齐带点目录的递归搜索真相。
  2. 修正 A9 的 `curl` output cap，使 `maxOutputBytes` 与披露口径保持同一单位，并补多字节回归测试。
  3. 让 A10 的 drift guard 真正对拍 PX inventory 文档/fixture，或回收所有“CI 会强制代码与 docs 同步”的过度表述。
- **可以后续跟进的 non-blocking follow-up**：
  1. 为 `ts-exec` 增加一条跨 planner/bridge/executor/handler 的 integration smoke，锁定 partial disclosure marker 不会在主路径丢失。
  2. 在 capability inventory / prompt docs 里更明确区分 `registry truth`、`docs truth` 与 `fixture guard`，减少后续评审误读。

本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。
