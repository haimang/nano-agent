# Nano-Agent 代码审查模板

> 审查对象: `A8-minimal-bash-search-and-workspace`, `A9-minimal-bash-network-and-script`, `A10-minimal-bash-vcs-and-policy`
> 审查时间: `2026-04-18`
> 审查人: `kimi (k2p5)`
> 审查范围:
> - `docs/action-plan/after-skeleton/A8-minimal-bash-search-and-workspace.md`
> - `docs/action-plan/after-skeleton/A9-minimal-bash-network-and-script.md`
> - `docs/action-plan/after-skeleton/A10-minimal-bash-vcs-and-policy.md`
> - `packages/capability-runtime/src/capabilities/{workspace-truth,filesystem,search,network,exec,vcs}.ts`
> - `packages/capability-runtime/src/{planner,fake-bash/commands,fake-bash/unsupported,index}.ts`
> - `packages/capability-runtime/test/**/*.test.ts`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：该实现主体成立，但存在 2 个 medium 级 correctness 隐患和 2 个 low 级 docs-gap，当前不应直接标记为 completed。
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. A8 search.ts 与 A10 vcs.ts 都使用了脆弱的启发式来判断"目录 vs 文件"，在真实 workspace 上会产生不可预期的行为差异（R1、R2）。
  2. A9 network.ts 的 output cap 使用字符长度而非字节长度，与 A8 rg 的 UTF-8 byte cap 口径不一致（R4）。
  3. 全部 In-Scope 交付项已落地，测试 gate 全绿（227 + 52 + 14），但 PX inventory 的命令顺序与代码 canonical order 不一致（R5）。

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
  - `docs/design/after-skeleton/PX-QNA.md`
- **核查实现**：
  - `packages/capability-runtime/src/capabilities/workspace-truth.ts`
  - `packages/capability-runtime/src/capabilities/filesystem.ts`
  - `packages/capability-runtime/src/capabilities/search.ts`
  - `packages/capability-runtime/src/capabilities/network.ts`
  - `packages/capability-runtime/src/capabilities/exec.ts`
  - `packages/capability-runtime/src/capabilities/vcs.ts`
  - `packages/capability-runtime/src/planner.ts`
  - `packages/capability-runtime/src/fake-bash/commands.ts`
  - `packages/capability-runtime/src/fake-bash/unsupported.ts`
  - `packages/capability-runtime/src/index.ts`
  - 配套 test suites（见下文）
- **执行过的验证**：
  - `pnpm --filter @nano-agent/capability-runtime test` → 227 passed
  - `pnpm -r typecheck` → 10 包全绿
  - `pnpm -r build` → 10 包全绿
  - `node --test test/*.test.mjs` → 52/52 passed
  - `npm run test:cross` → 14/14 passed
  - `context/just-bash/src/fs/mountable-fs/mountable-fs.ts` 事实考古（longest-prefix mount routing 与 reserved namespace law 已吸收）
  - `context/just-bash/src/commands/rg/rg.ts` 事实考古（rich rg surface 作为 future ceiling，当前未承诺）
  - `context/just-bash/src/commands/curl/curl.ts` 事实考古（rich curl flags 矩阵作为 out-of-scope 依据）
  - `context/just-bash/src/commands/js-exec/js-exec.ts` 事实考古（Node/worker_threads-heavy 路线被明确拒绝）

### 1.1 已确认的正面事实

- A8 新增 `workspace-truth.ts`，导出 `DEFAULT_WORKSPACE_ROOT`、`RESERVED_NAMESPACE_PREFIX`、`resolveWorkspacePath`、`isReservedNamespacePath` 与 `WorkspaceFsLike` 接口；`filesystem.ts` 与 `search.ts` 全部消费该路径法则。
- A8 `rg` handler 已重写为 namespace-backed 真实实现：递归 `listDir`、确定性排序、`path:lineNumber:line` 格式、默认 cap 200 matches / 32 KiB、超界 emit `[rg] truncated:` marker、静默跳过 `/_platform/**`、UTF-8 字节计数走 `TextEncoder`。
- A8 `grep -> rg` alias 在 planner 层实现：`COMMAND_ALIASES = { grep: "rg" }`；任何 `-flag` 抛错；`r.has("grep") === false` 被测试锁定。
- A8 `mkdir` 落地为 partial-with-disclosure，输出固定 marker `mkdir-partial-no-directory-entity`。
- A9 `curl` 完全重写：scheme allow-list (http/https)、host deny-list（localhost/RFC1918/link-local/CGNAT/IPv6 ULA/cloud-metadata）、timeout + output 双 cap、`AbortController` 超时中断、`fetchImpl` 注入、默认返回 `curl-not-connected` stub。
- A9 `ts-exec` 重写为 honest partial：`new Function(code)` 语法校验 + 长度 ack + 固定 `ts-exec-partial-no-execution` marker；不回显 caller 代码本体。
- A9 `UNSUPPORTED_COMMANDS` 扩张 9 条 host interpreter（python/node/bash/sh/zsh/deno/bun 等）。
- A10 `git` 导出 `GIT_SUPPORTED_SUBCOMMANDS = ["status","diff","log"]`；planner 与 handler 共享同一常量；mutating subcommand 在 planner 层即抛 `git-subcommand-blocked`。
- A10 `inventory-drift-guard.test.ts` 锁定 12-pack canonical 顺序、policy、ask/allow-gated 集合、UNSUPPORTED_COMMANDS、OOM_RISK_COMMANDS、git subset 共 10 个 case。
- 全部新增测试 case 与 Opus 报告计数一致（workspace-truth 16 + search-rg-reality 9 + planner-grep-alias 7 + file-search-consistency 6 + planner-bash-narrow 11 + network-egress 24 + ts-exec-partial 5 + remote-seam-upgrade 3 + git-subset 10 + planner-git-subset 8 + inventory-drift-guard 10 = 119 cases；capability-runtime 原有 108 cases，合计 227）。
- 10 个包 typecheck + build 全绿，root E2E + cross-package 零回归。

### 1.2 已确认的负面事实

- `search.ts:129` 使用 `!candidate.includes(".")` 作为目录启发式，会将无扩展名文件（Makefile、LICENSE 等）误判为目录，导致额外 listDir 调用。
- `vcs.ts:76-82` 使用 `children.length > 0` 判断目录/文件，会将空目录误判为文件，导致 `git status` 输出不一致。
- `network.ts:146-149` 的 `truncateBody` 使用 `body.length`（字符长度）做截断，而非 UTF-8 字节长度，与 `search.ts` 的 `utf8ByteLength` 口径不一致。
- A9 工作报告 §11.3 中关于 "公网 hostname 只有 example.com/ 落在 accept 列表" 的描述与代码事实不符——代码只有 deny-list，没有 allow-list，任何不在 deny-list 中的公网 hostname 都会被接受。
- `PX-capability-inventory.md` §7.1 的命令表格顺序（write → rm → mv → cp → mkdir）与代码 `MINIMAL_COMMANDS` 的 canonical 顺序（write → mkdir → rm → mv → cp）不一致，虽然 drift guard 测试锁定的是代码顺序。

---

## 2. 审查发现

### R1. search.ts 中目录/文件的启发式检测会误判无扩展名文件

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `packages/capability-runtime/src/capabilities/search.ts:129`：`const looksDirectory = !treatAsFile && !candidate.includes(".") && candidate !== next;`
  - 在真实 workspace 中，Makefile、LICENSE、Dockerfile 等常见文件没有扩展名，会被误判为目录。
- **为什么重要**：
  - 误判不会导致搜索失败（下一轮 listDir 返回空后会被当作文件处理），但会引入无意义的递归调用，增加搜索延迟。
  - 更重要的是，它与 `vcs.ts` 使用了完全不同的目录检测逻辑（`children.length > 0`），导致同一 workspace 在 search 和 git status 中的遍历行为不一致。
- **审查判断**：
  - 这是一个隐蔽的实现瑕疵，不属于设计层面的 scope-drift，但在真实 workspace（如 Node.js 项目根目录常有大量无扩展名文件）上会产生可感知的性能差异和行为不一致。
- **建议修法**：
  - 短期：在 `WorkspaceFsLike` 接口中补充 `isDirectory(path): Promise<boolean>` 或 `stat(path): Promise<{ isFile: boolean }>` 方法，让 search 和 vcs 共享同一判断标准。
  - 中期：如果补充接口不可行，至少统一 search 和 vcs 的启发式逻辑，并在代码注释中明确标注已知限制。

### R2. vcs.ts 中 listWorkspace 会将空目录误判为文件

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `packages/capability-runtime/src/capabilities/vcs.ts:76-82`：`const children = await namespace.listDir(entry.path); if (children.length > 0) { await walk(entry.path); } else { out.push(entry.path); }`
  - 若 workspace  backend 的 `listDir(emptyDir)` 返回空数组，空目录会被 push 到 `git status` 的输出列表中，仿佛它是一个文件。
- **为什么重要**：
  - `git status` 的输出语义是"列出 workspace 下的文件和目录"。把空目录当作文件列出，会误导 LLM 对 workspace 结构的理解。
  - 与 R1 合起来看：search 把无扩展名文件当目录，vcs 把空目录当文件——两套 handler 对同一 workspace 的遍历语义不一致，违背了 P7a §5.1 S4 的 "File/Search Consistency Law"。
- **审查判断**：
  - 这是 A10 交付中值得修复的 correctness gap。虽然 git status 当前标为 Partial，但 "honest partial" 不等于 "输出错误"。
- **建议修法**：
  - 与 R1 共用同一解法：在 `WorkspaceFsLike` 中补充目录判断 primitive，或统一使用与 search.ts 相同的启发式（`listDir(candidate).length > 0` 且 candidate 不含 "." 等），但注释中标注 "空目录会被列出"。

### R3. A9 工作报告中 curl "accept 列表" 的措辞与代码事实不符

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - A9 工作报告 §11.3："公网 hostname 只有 `example.com/` 落在 accept 列表"
  - `packages/capability-runtime/src/capabilities/network.ts:101-130` 的 `isPrivateHost()` 只有 deny-list 逻辑（localhost/RFC1918/link-local/CGNAT/IPv6 ULA），没有任何 allow-list 检查。
  - `network-egress.test.ts:75-81` 只测试了 `example.com`，但代码逻辑会接受任何不在 deny-list 中的 hostname（如 `https://api.github.com`）。
- **为什么重要**：
  - 工作报告作为执行回填，是后续审阅者理解代码边界的第一手资料。措辞不准确会导致 future reviewer 误以为 egress guard 比实际更严格。
- **审查判断**：
  - 不影响代码 correctness，但影响文档可信度。建议在 A9 报告或 PX inventory 中修正措辞为 "任何不在 deny-list 中的公网 hostname 均被接受"。
- **建议修法**：
  - 修正 A9 §11.3 措辞；或在 `network-egress.test.ts` 中增加一条非 example.com 的公网 hostname 测试以消除歧义。

### R4. network.ts 的 output cap 使用字符长度而非字节长度

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `packages/capability-runtime/src/capabilities/network.ts:146-149`：`function truncateBody(body: string, cap: number): { body: string; truncated: boolean } { if (body.length <= cap) return { body, truncated: false }; return { body: body.slice(0, cap), truncated: true }; }`
  - `search.ts:54-56` 使用 `TextEncoder` 计算 UTF-8 字节长度：`function utf8ByteLength(s: string): number { return TEXT_ENCODER.encode(s).byteLength; }`
  - 对于包含中文、emoji 等多字节 UTF-8 字符的 HTTP 响应，`body.length`（字符数）远小于实际字节数，可能导致截断后输出超过 `DEFAULT_CURL_MAX_BYTES`（64 KiB）。
- **为什么重要**：
  - 在 Worker/V8 isolate 环境中，上下文大小和 WS stream payload 都有硬预算。output cap 承诺的是字节上限，但实现上是字符上限，会造成预算超支。
  - A8 search 已经使用 UTF-8 byte cap 作为最佳实践，A9 curl 应保持一致。
- **审查判断**：
  - 这是 security/resource-boundary 层面的不一致。对于纯 ASCII 内容无影响，但对于国际化内容（LLM 可能拉取的中文文档、JSON 等）会造成 cap 失效。
- **建议修法**：
  - 将 `truncateBody` 改为字节感知截断，参考 `search.ts` 的 `utf8ByteLength` 实现，或在截断前用 `TextEncoder.encode(body).byteLength` 计算实际字节数。

### R5. PX inventory 的命令顺序与代码 canonical order 不一致

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `PX-capability-inventory.md` §7.1 表格顺序：write → rm → mv → cp → mkdir → rg → ...
  - `fake-bash/commands.ts:16-143` `MINIMAL_COMMANDS` 顺序：write → mkdir → rm → mv → cp → rg → ...
  - `inventory-drift-guard.test.ts:30-33` 锁定的 `EXPECTED_COMMAND_ORDER`：write → mkdir → rm → mv → cp → rg → ...
- **为什么重要**：
  - drift guard 测试明确将 "canonical order" 作为回归资产锁定。如果 PX inventory 作为 "单一真相表" 与代码顺序不一致，会降低 inventory 的权威性。
- **审查判断**：
  - 不影响功能，但影响文档与代码的一致性。建议统一为代码中的 canonical order（或明确说明 PX inventory 表格顺序不代表 canonical order）。
- **建议修法**：
  - 将 PX inventory §7.1 的命令表格顺序调整为与 `MINIMAL_COMMANDS` 一致；或在 PX inventory 中增加注释说明表格按 capability kind 分组，canonical order 以代码和 drift guard 为准。

---

## 3. In-Scope 逐项对齐审核

### A8 In-Scope

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | Workspace truth freeze | `done` | `workspace-truth.ts` 导出 path law，filesystem/search 统一消费 |
| S2 | Minimal file ops surface | `done` | 7 个 handler 全部走 `resolveOrThrow()`，mkdir partial-with-disclosure |
| S3 | Canonical search command (rg) | `done` | namespace-backed 真实搜索 + bounded output + truncation marker |
| S4 | File/search consistency law | `done` | `file-search-consistency.test.ts` 6 cases 锁定同一路径宇宙 |
| S5 | Reserved namespace + mount law | `done` | `/_platform/` 在 filesystem/search 中一致拒绝，与 workspace mounts.ts 对齐 |
| S6 | Evidence and test closure | `done` | 36 新增 cases + 全绿 gate |

### A9 In-Scope

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | curl/ts-exec bash shape freeze | `done` | `checkBashNarrow()` 在 planner 层拦截 `-flag` 和 extra token |
| S2 | Restricted curl baseline | `done` | egress guard + timeout/output cap + fetchImpl 注入 + not-connected stub |
| S3 | ts-exec substrate decision | `done` | honest partial（syntax validation + length ack + fixed marker）|
| S4 | Service-binding upgrade seam | `done` | `remote-seam-upgrade.test.ts` 验证 curl/ts-exec plan 可透明转发 |
| S5 | Inventory/README sync | `done` | PX v0.3 升级 curl/ts-exec 行，追加 host interpreter Unsupported |

### A10 In-Scope

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | Git status/diff/log freeze | `done` | `GIT_SUPPORTED_SUBCOMMANDS` 常量 + planner/handler 双层拦截 |
| S2 | Unsupported / Risk taxonomy | `done` | `UNSUPPORTED_COMMANDS` / `OOM_RISK_COMMANDS` 在 fake-bash/unsupported.ts 中正式 contract 化 |
| S3 | Registry / prompt / TS guard | `done` | `getMinimalCommandDeclarations()` / `getAskGatedCommands()` / `getAllowGatedCommands()` 提供 disclosure helper |
| S4 | Hard-fail policy | `done` | FakeBashBridge 21 cases 全绿，drift guard 防止 taxonomy 悄悄扩张 |
| S5 | Capability inventory closure | `done` | PX v0.4 升级 git 行 + mutating-git Frozen Out + drift guard 记录 |

### 3.1 对齐结论

- **done**: 16/16
- **partial**: 0/16
- **missing**: 0/16

> 所有 action-plan 的 In-Scope 交付项均已落地，但 A8/A10 的 search/vcs handler 中存在脆弱的目录/文件启发式检测（R1、R2），需要在后续修复后再正式标记为 completed。

---

## 4. Out-of-Scope 核查

### A8 Out-of-Scope

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 完整 POSIX filesystem 语义 | `遵守` | 未引入 inode/permission/symlink/watcher |
| O2 | 完整 ripgrep feature set | `遵守` | 未承诺 glob/ignore/multiline/PCRE2 |
| O3 | grep/egrep/fgrep 独立 capability family | `遵守` | 仅 planner 层 alias，不进入 registry |
| O4 | mkdir 完整目录元数据模型 | `遵守` | 明确标记 partial-with-disclosure |

### A9 Out-of-Scope

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 本地 Linux shell / child process / Python | `遵守` | UNSUPPORTED_COMMANDS 已拦截 python/bash/sh 等 |
| O2 | curl 完整 CLI flags | `遵守` | planner 层拦截 `-X/-H/--data` |
| O3 | localhost / package install / 宿主 FS | `遵守` | egress guard + unsupported taxonomy 双重拦截 |
| O4 | browser rendering 接入 | `遵守` | BrowserRenderingTarget 保持 reserved slot |

### A10 Out-of-Scope

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | git add/commit/reset/checkout/merge/rebase | `遵守` | planner 和 handler 都抛 `git-subcommand-blocked` |
| O2 | 宿主真实 git repository / shelling out | `遵守` | 未引入 libgit2-wasm 或宿主 git binary |
| O3 | 复杂 prompt engineering 平台 | `遵守` | 未引入自动生成 marketing 文案 |
| O4 | 细粒度组织级权限平台 / DDL | `遵守` | 未引入完整 registry 持久化 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`approve-with-followups`
- **是否允许关闭本轮 review**：`no`（需先修复 R1/R2/R4 中的 follow-up 项）
- **关闭前必须完成的 blocker**：
  1. **无 critical/high blocker**。但建议在下一轮更新中一并处理以下 follow-up：
     - R1 + R2：统一 search/vcs 的目录/文件检测逻辑，或在 `WorkspaceFsLike` 中补充 `isDirectory` primitive。
     - R4：将 `network.ts` 的 `truncateBody` 改为字节感知截断，与 `search.ts` 的 `utf8ByteLength` 保持一致。
- **可以后续跟进的 non-blocking follow-up**：
  1. R3：修正 A9 工作报告或 PX inventory 中关于 curl "accept 列表" 的不准确措辞。
  2. R5：将 PX inventory §7.1 的命令表格顺序调整为与 `MINIMAL_COMMANDS` canonical order 一致。

> 本轮 review 建议先由实现者按 §5 中的 follow-up 响应并更新代码，然后再进行收口。

---

## 6. 实现者回应（针对 Kimi 报告）

> 执行者: `Claude (claude-opus-4-7[1m])`
> 执行时间: `2026-04-18`
> 回应范围: `Kimi R1 – R5`
> 交叉回应: 跨 reviewer 的统一修改日志与对 GPT 报告的整体评价写在 `docs/code-review/after-skeleton/A8-A10-reviewed-by-GPT.md` §6；本节只记录针对 Kimi 五条 finding 的独立回应与对本份报告的评价。

### 6.1 逐项回应

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| Kimi R1 | `search.ts:129` 使用 `!candidate.includes(".")` 作启发式，会把 Makefile/LICENSE 误判为目录 | `fixed` | 与 GPT R2 合并：重写 search traversal 为 `listDir(candidate)` 非空 → recurse（sorted），空/throw → `readFile` 分支；`LICENSE / Makefile / Dockerfile` 被正确读为文件，无多余 listDir 调用；`search-rg-reality.test.ts` 新增 "extensionless files (LICENSE / Makefile)" regression case | `packages/capability-runtime/src/capabilities/search.ts`, `packages/capability-runtime/test/capabilities/search-rg-reality.test.ts` |
| Kimi R2 | `vcs.ts:76-82` 用 `children.length > 0` 判断目录/文件，空目录会被 push 到 `git status` 输出 | `fixed` | `listWorkspace` 的 leaf 分支改为 `readFile(entry.path)` 探测：返回内容才 push（文件），返回 null 跳过（空目录）；`git-subset.test.ts` 新增 "status omits leaf entries whose readFile returns null (empty-directory guard)" case，使用 WsWithEmptyDir 直接造场景 | `packages/capability-runtime/src/capabilities/vcs.ts`, `packages/capability-runtime/test/capabilities/git-subset.test.ts` |
| Kimi R3 | A9 工作报告 §11.3 "公网 hostname 只有 example.com 落在 accept 列表" 与代码 deny-list 语义不符 | `fixed` | A9 §11.3 措辞改写为明确的 deny-list 声明："`isPrivateHost()` 是 deny-list 语义，不是 allow-list —— 任何未命中 deny-list 的公网 hostname 都会被接受"；`network-egress.test.ts` 新增 "accepts other common public hostnames" case 覆盖 `api.github.com / registry.npmjs.org / raw.githubusercontent.com`，消除 "only example.com" 错觉 | `docs/action-plan/after-skeleton/A9-minimal-bash-network-and-script.md`, `packages/capability-runtime/test/capabilities/network-egress.test.ts` |
| Kimi R4 | `network.ts::truncateBody` 按 `body.length` 截断，多字节响应突破 byte cap；与 `search.ts::utf8ByteLength` 口径不一致 | `fixed` | 与 GPT R3 合并：truncateBody 改为「TextEncoder.encode → 向前找最近的 UTF-8 起始字节（跳过 `10xx_xxxx` continuation bytes）→ TextDecoder.decode」。结果 byte 数 ≤ cap 且是 valid UTF-8。新增 2 个 regression：`"你".repeat(5) + maxOutputBytes:4` 实际 ≤ 4 bytes；`"你好"`（6 UTF-8 bytes）+ `maxOutputBytes:10` 不触发截断 | `packages/capability-runtime/src/capabilities/network.ts`, `packages/capability-runtime/test/capabilities/network-egress.test.ts` |
| Kimi R5 | PX §7.1 命令表格顺序 (`write → rm → mv → cp → mkdir`) 与 `MINIMAL_COMMANDS` canonical order (`write → mkdir → rm → mv → cp`) 不一致 | `fixed` | 重排 PX §7.1 表格为 canonical order；在表格开头加入 "command order law" 段说明 row order 与 `MINIMAL_COMMANDS` 严格对齐；inventory-drift-guard test 新增 PX parser（与 GPT R4 合并），直接读取 `docs/design/after-skeleton/PX-capability-inventory.md` 并校验行顺序 + policy 列——任一侧漂移即 CI 失败 | `docs/design/after-skeleton/PX-capability-inventory.md`, `packages/capability-runtime/test/inventory-drift-guard.test.ts` |

### 6.2 变更文件清单（仅本报告触达部分）

- `packages/capability-runtime/src/capabilities/search.ts`（R1 — 与 GPT R2 合并）
- `packages/capability-runtime/src/capabilities/vcs.ts`（R2）
- `packages/capability-runtime/src/capabilities/network.ts`（R4 — 与 GPT R3 合并）
- `packages/capability-runtime/test/capabilities/search-rg-reality.test.ts`（R1）
- `packages/capability-runtime/test/capabilities/git-subset.test.ts`（R2）
- `packages/capability-runtime/test/capabilities/network-egress.test.ts`（R3 + R4）
- `packages/capability-runtime/test/inventory-drift-guard.test.ts`（R5 — 与 GPT R4 合并）
- `docs/action-plan/after-skeleton/A9-minimal-bash-network-and-script.md`（R3）
- `docs/design/after-skeleton/PX-capability-inventory.md`（R5 — 与 GPT R4 合并）

其余修改（GPT R1 Q16 -i/-n + GPT R2 `.config` 目录递归 + GPT R3 UTF-8 byte boundary + GPT R4 PX parser）见 GPT 报告 §6.

### 6.3 验证结果

```text
pnpm -r typecheck                                                → 10 包全绿
pnpm -r build                                                    → 10 包全绿
pnpm --filter @nano-agent/capability-runtime test                → 241 passed (up from 227; +14 cases)
npm run test:cross                                               → 67/67 passed (14 e2e + 53 contract suites)
```

五条 finding 全部落地；R1/R2/R4 的 follow-up 都在本轮完成，不再需要作为跨 phase 跟踪项。R5 的 PX 表格顺序因为 drift guard 新 parser 而 **从此由 CI 硬锁**，再次 drift 会立即失败。

### 6.4 对 Kimi 审查报告的评价

- **报告切入角度**：Kimi 五条 finding 覆盖了「search/vcs 对同一 workspace 的遍历一致性（R1 + R2）+ network 与 search 的 UTF-8 cap 口径一致性（R4）+ docs / code 一致性（R3 + R5）」三个维度。尤其 R1 + R2 合起来展示了一种非常有洞察力的对称视角：R1 从 "extensionless file 被误判为目录" 切入，R2 从 "空目录被误判为文件" 切入，两者合起来暴露同一段启发式代码的双向错误。实现者因此采用 "不依赖 `.` 字符、改用 listDir-probe + readFile-fallback" 的统一方案，一次性消灭两条症状。这种「对称缺陷发现法」不是 GPT 风格能覆盖的。
- **证据链质量**：每条 finding 都有文件:行号 + 可复现命令。R1 的 `search.ts:129` 直接指向代码行；R2 的 `vcs.ts:76-82` 同样精确；R4 的 `network.ts:146-149` + `search.ts:54-56` 交叉对比让 "跨模块口径不一致" 的论据无可争议；R5 的 `MINIMAL_COMMANDS` 与 `PX §7.1` 对比直接锁定 drift。
- **严重级别判断**：R1/R2/R4 medium + R3/R5 low 的分布精准反映了每条 finding 的阻塞性。R1/R2 作为 "correctness 问题但当前没有显式 bug 表现" 标 medium，既表达紧迫感又不升级为 high；R4 作为 "security-adjacent 但只在多字节内容下暴露" 也标 medium；R3/R5 作为纯 docs-drift 标 low —— 这种分级克制是我在系列 8 轮 review 里最欣赏 Kimi 的特质。
- **修复边界建议**：Kimi 对 R1/R2 给出了 "短期：统一启发式 / 中期：补 isDirectory primitive" 两档选项，实现者选了中间方案（不新增接口但用 listDir-probe 代替启发式），同时达成两档目标；对 R4 建议 "参考 search.ts 的 utf8ByteLength 实现"，虽然最终实现用了向后找 UTF-8 起始字节（更可预测）而非 encode+decode 全程，但 Kimi 的建议方向完全正确。R5 建议 "调整表格顺序或加注释"，实现者选了前者并增加了 CI 硬锁，比 Kimi 建议更主动。
- **与 GPT 的互补性**：本轮 5 条 Kimi finding 中，R1/R4/R5 与 GPT 的 R2/R3/R4 有部分重叠但视角不同（GPT 从 canonical baseline 看，Kimi 从跨模块一致性看）；R2/R3 是 Kimi 独有。合并后的 9 条 finding 无冗余无缺漏，覆盖 A8-A10 closure 的所有真实缺口。
- **综合评价**：报告质量顶级。与 GPT 报告形成系列里最强的互补审阅。五条 finding 的分级、证据、修复建议都精准到位，是一份 approve-grade 审查工作的标杆范本。

### 6.5 实现者收口判断（仅针对 Kimi 报告维度）

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. R1/R2 的 `WorkspaceFsLike` 接口没有加 `isDirectory` primitive（Kimi 建议的「中期」方案）；当前用 `listDir + readFile` 双探测已经足够解决两条启发式缺陷，未来如果 workspace backend 引入真实目录实体（例如 R2-backed artifacts 的 list-prefix 原语），再扩 `WorkspaceFsLike` 也不迟。
  2. R4 的 `truncateBody` 用「向前找 UTF-8 起始字节」而非 `TextDecoder` 的全程 fatal 模式，因为前者永远不会扩张到 replacement char (`U+FFFD`) 而稳定地保证 `byteLength ≤ cap`；这是刻意选择，与 Kimi 建议的「字节感知截断」方向一致但实现路径不同。

请 Kimi 按 §7 二次审查模板复核；若 R1 的 `.config / foo.bar / LICENSE / Makefile` 回归 + R2 的 empty-dir guard + R4 的 UTF-8 truncation + R3 的 "accept 列表" 消歧 + R5 的 PX canonical order 全部验证有效，则 Kimi 侧 review 可直接收口。
