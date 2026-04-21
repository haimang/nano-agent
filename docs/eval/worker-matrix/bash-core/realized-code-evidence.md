# bash.core — realized code evidence

> 目标：只基于**当前仓库代码与当前测试**，回答 `bash.core` 已经实现了什么、还缺什么、哪些只是 seam。

---

## 0. 先给结论

**`bash.core` 现在最准确的代码判断是：一个以 21-command governed subset 为核心、以 bridge/planner/executor/handlers/transport seam 为骨架的 fake-bash 执行引擎已经真实存在；它离“可独立 worker 化”已经很近，但 deploy-shaped worker shell 仍未落成。**

---

## 1. 原始素材召回表

### 1.1 核心代码

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| registry | `packages/capability-runtime/src/fake-bash/commands.ts` | `16-315` | 证明 canonical 21-command set、policy、registry helpers 已存在 |
| bridge | `packages/capability-runtime/src/fake-bash/bridge.ts` | `17-20,61-72,82-167` | 证明 no-silent-success + plan/execute 双路径 |
| unsupported taxonomy | `packages/capability-runtime/src/fake-bash/unsupported.ts` | `15-119` | 证明 unsupported 与 OOM-risk contract 已存在 |
| planner | `packages/capability-runtime/src/planner.ts` | `23-65,76-128,151-248,257-403` | 证明 bash parsing / alias / narrow path / structured input builder 已存在 |
| tool-call bridge | `packages/capability-runtime/src/tool-call.ts` | `20-37,64-87,100-160` | 证明 capability-runtime 与 `tool.call.*` body family 已对齐 |
| executor | `packages/capability-runtime/src/executor.ts` | `22-68,121-239,242-320` | 证明 policy / cancel / timeout / progress lifecycle 已存在 |
| service-binding target | `packages/capability-runtime/src/targets/service-binding.ts` | `40-84,90-215` | 证明 remote transport seam 已存在 |
| handlers | `packages/capability-runtime/src/capabilities/{filesystem,search,text-processing,network,exec,vcs}.ts` | `filesystem.ts:102-237`; `search.ts:67-205`; `text-processing.ts:39-85,196-355`; `network.ts:38-57,153-187`; `exec.ts:28-90`; `vcs.ts:34-50,110-170` | 证明 21-pack 背后已有真实 handlers |
| package exports | `packages/capability-runtime/src/index.ts` | `37-87,104-165` | 证明这些能力已构成单一 package API |

### 1.2 运行时接缝

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| host env slot | `packages/session-do-runtime/src/worker.ts` | `31-49` | 证明 `CAPABILITY_WORKER` binding slot 已存在 |
| host remote seam | `packages/session-do-runtime/src/remote-bindings.ts` | `329-390` | 证明 capability remote handle 的形状已固定 |

### 1.3 测试证据

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| bridge | `packages/capability-runtime/test/fake-bash-bridge.test.ts` | `41-77,79-134,197-255` | 证明 rejection/no-silent-success/21 commands |
| planner | `packages/capability-runtime/test/planner-bash-narrow.test.ts` | `24-75,78-100` | 证明 `curl` / `ts-exec` bash-path 已冻结 |
| command smoke | `packages/capability-runtime/test/integration/command-surface-smoke.test.ts` | `14-87` | 证明 21 commands 都可从 bash path 规划 |
| inventory guard | `packages/capability-runtime/test/inventory-drift-guard.test.ts` | `55-89,114-180,220-239` | 证明 registry/policy/docs 已强对齐 |
| service-binding | `packages/capability-runtime/test/integration/service-binding-transport.test.ts` | `72-90,92-136,167-216,218-255` | 证明 transport/progress/cancel/requestId patch 已存在 |
| curl | `packages/capability-runtime/test/capabilities/network-egress.test.ts` | `27-49,105-130,222-260` | 证明 curl stub/egress guard/budget guard |
| ts-exec | `packages/capability-runtime/test/capabilities/ts-exec-partial.test.ts` | `21-60` | 证明 `ts-exec` honest partial |
| git | `packages/capability-runtime/test/capabilities/git-subset.test.ts` | `56-99,147-195` | 证明 readonly git subset |
| rg | `packages/capability-runtime/test/capabilities/search-rg-reality.test.ts` | `54-147,185-216` | 证明 real `rg` baseline |
| text core | `packages/capability-runtime/test/capabilities/text-processing-core.test.ts` | `51-89,91-143,145-213,215-280` | 证明 B3 wave 1 已真实落地 |
| text aux | `packages/capability-runtime/test/capabilities/text-processing-aux.test.ts` | `39-69,71-98,100-156` | 证明 B3 wave 2 已真实落地 |

---

## 2. registry / taxonomy 已经是真代码，不是文档愿景

### 2.1 `commands.ts` 已把 21-pack 冻结成 canonical truth

当前 `MINIMAL_COMMANDS` 已经包含：

1. baseline 12-pack：`16-142`
2. B3 wave 1：`143-229`
3. B3 wave 2：`230-274`

再加上：

- `registerMinimalCommands()`：`283-293`
- `getMinimalCommandDeclarations()`：`301-304`
- `getAskGatedCommands()` / `getAllowGatedCommands()`：`306-314`

说明 command surface 已经不只是“README 里列了一张表”，而是有单一代码真相源。

### 2.2 unsupported / OOM-risk taxonomy 也已经冻结

`unsupported.ts` 当前把两类边界显式分开：

- `UNSUPPORTED_COMMANDS`：`15-69`
- `OOM_RISK_COMMANDS`：`77-86`

而且 rejection message 也已经固定：`99-118`

这件事很关键，因为它意味着 `bash.core` 的边界不是“以后可能都能做”，而是：

> **有一批 surface 当前就是被明确拒绝的。**

### 2.3 drift guard 已把 registry truth 固化进测试

`inventory-drift-guard.test.ts` 现在会同时锁：

1. canonical command order：`55-63`
2. canonical policy map：`65-89`
3. unsupported taxonomy：`91-112`
4. git subset：`177-179`
5. PX docs §7.1 与代码一致：`220-239`

所以当前的 bash.core 治理真相已经具备非常强的“不能悄悄漂移”特性。

---

## 3. bridge / planner 已经把 fake-bash compatibility surface 做成 load-bearing layer

### 3.1 `FakeBashBridge` 已经把 shell 入口收成 plan/execute 双路径

当前 bridge 已经稳定提供：

- `plan()`：命令字符串 -> `CapabilityPlan | null`：`61-73`
- `execute()`：命令字符串 -> `CapabilityResult`：`82-135`

同时还显式保证：

- unsupported / OOM-risk / unknown / no-executor 都返回 structured error
- **never fabricate success**：`17-20`

这说明 `bash.core` 的 LLM-facing 外壳已经不是空壳。

### 3.2 planner 已经把 narrow bash law 做实

`planner.ts` 当前最重要的 load-bearing truth 有四条：

1. `parseSimpleCommand()`：极窄 shell-like parsing：`23-65`
2. `grep -> rg` narrow alias：`67-128`
3. `curl / ts-exec / git / text-processing` bash-path narrow law：`151-248`
4. `buildInputFromArgs()`：bash argv -> structured input：`316-403`

换句话说，当前 fake-bash 不是“先 parse 成 AST 再执行 shell”，而是：

> **先把 LLM 常见 bash 形状收窄，再翻译进 typed capability input。**

### 3.3 这些 bridge/planner law 都有直接测试

`planner-bash-narrow.test.ts` 已经锁了：

- `curl <url>` 才合法：`24-75`
- `ts-exec <inline code>` 才合法：`78-100`

`fake-bash-bridge.test.ts` 已经锁了：

- no-executor 不得伪造成功：`62-77`
- bash-narrow violation 要回 structured error：`197-227`

因此当前的 `bash.core` compatibility surface 已经非常明确，不再是凭 prompt 隐式约定。

---

## 4. handlers 侧已经形成真实 21-command baseline

## 4.1 filesystem/search 已不再是占位

当前 `filesystem.ts` 已真实提供：

- `pwd/ls/cat/write/mkdir/rm/mv/cp`：`122-236`
- `mkdir-partial-no-directory-entity` disclosure：`53,176-188`
- `write-oversize-rejected` disclosure：`70,153-173`

`search.ts` 已真实提供：

- namespace-based recursive `rg`：`67-205`
- reserved namespace hard edge：`79-88,140`
- deterministic line/byte cap：`108-110,169-195`

这些行为也被测试锁定：

- `search-rg-reality.test.ts:54-147,185-216`
- `docs/spikes/spike-do-storage/07-bash-capability-parity-3-of-3-contracts-hold.md:13-16,30-40`

## 4.2 B3 的 9 个 text-processing 命令已经全部落成

`text-processing.ts` 当前已经有：

- shared output cap / truncation note：`39-85`
- `wc/head/tail/jq/sed/awk`：`196-355`
- `sort/uniq/diff`：同文件后半段（由 tests 证明已导出并工作）

直接回归证据：

- core：`text-processing-core.test.ts:51-280`
- aux：`text-processing-aux.test.ts:39-156`

这点非常关键，因为它把 `bash.core` 从“12-pack minimal shell facade”推进到了一个更像真实 analysis tool layer 的阶段。

## 4.3 network/exec/vcs 都有诚实边界

`network.ts` 当前真实拥有：

- `curl-not-connected` stub：`38`
- scheme / private-address deny：`39-52,193-244`
- timeout / output cap：`53-57,246-279`
- optional subrequest budget：`83-117,153-187`

`exec.ts` 当前真实拥有：

- `ts-exec-partial-no-execution`：`28`
- `ts-exec-syntax-error`：`29`
- syntax-only baseline：`37-49,61-87`

`vcs.ts` 当前真实拥有：

- `status/diff/log` 只读 trio：`34-50`
- `status` 真遍历 workspace：`65-99,135-150`
- `diff/log` honest partial：`151-161`

对应测试：

- curl：`network-egress.test.ts:27-49,105-130,222-260`
- ts-exec：`ts-exec-partial.test.ts:21-60`
- git：`git-subset.test.ts:56-99,147-195`

所以 `bash.core` 当前不是“多数命令都还没接线”，而是：

> **大多数命令已经有明确 baseline，只是其中一部分 baseline 故意保持 partial。**

---

## 5. executor / transport 已经把“未来 remote worker”需要的骨架做出来了

## 5.1 `tool.call.*` body bridge 已经存在

`tool-call.ts` 当前已经把：

- `CapabilityPlan -> tool.call.request body`
- `cancel reason -> tool.call.cancel body`
- `tool.call.response body -> CapabilityResult`

全部实现出来：`64-160`

这意味着 `bash.core` 如果远端化，不需要重新发明 tool wire body。

## 5.2 `CapabilityExecutor` 已经把 cancel / timeout / progress 做成统一 lifecycle

当前 executor 最重要的价值是：

1. allow / ask / deny 在同一入口裁决：`125-191`
2. target dispatch 与 no-target error：`193-206`
3. cancel 通过 `AbortController` 进入底层 handler：`208-239`
4. streaming path 统一产出 lifecycle events：`242-320`

这让 `bash.core` 已经具备了“像一个真正远端 worker 一样被调用”的骨架。

## 5.3 `ServiceBindingTarget` 已不再是永久 stub

它当前已经能：

- 无 transport 时返回 `not-connected`：`113-125`
- 有 transport 时转发 request：`127-162`
- 响应 caller abort 并发送 cancel：`130-148`
- patch response 回真正 `capabilityName + requestId`：`168-176`

而 `service-binding-transport.test.ts` 也锁了：

- progress 能上浮：`92-136`
- cancel 能回传：`167-216`
- result 会补回真实 requestId：`218-255`

因此当前代码真相不是“remote path 还没有任何东西”，而是：

> **remote transport seam 已存在，缺的是独立 worker shell。**

---

## 6. host runtime 已经承认 `bash.core` 的 remote identity

`session-do-runtime` 当前已经在两个位置承认 capability remote seam：

1. Worker env 有 `CAPABILITY_WORKER`：`packages/session-do-runtime/src/worker.ts:33-47`
2. `makeRemoteBindingsFactory()` 会产出 `{ serviceBindingTransport }`：`src/remote-bindings.ts:335-390`

这说明从 host 视角看，`bash.core` 的 future identity 已经很清楚：

> **它应该是一个被 `CAPABILITY_WORKER` binding 调用的 capability worker。**

但同一时间，这里也暴露了一个关键缺口：

- 当前我们只看到了 binding seam；
- 还没有看到独立的 `bash.core` Worker fetch handler / deploy shell。

---

## 7. 当前真正没闭合的不是 fake-bash 本体，而是 deploy shell

把今天的 `bash.core` 用一句话收起来，大致是：

| 层 | 当前真实状态 |
|---|---|
| command registry | **已闭合** |
| fake-bash bridge | **已闭合** |
| planner / narrow law | **已闭合** |
| handlers (21-pack) | **大体闭合；个别命令故意 partial** |
| tool-call bridge | **已闭合** |
| service-binding transport seam | **已闭合** |
| standalone worker shell | **未闭合** |

也就是说，当前的 `bash.core` 不该被写成：

> “还只是一个概念”

而应该写成：

> **引擎已经存在，缺的是把这台引擎包成独立 worker 的 deploy shell。**

---

## 8. 结论

**`bash.core` 当前最成熟的是内部执行引擎与治理骨架，最不成熟的是独立 worker 外壳。**

这也是为什么 worker-matrix 阶段对 `bash.core` 最合理的工作，不是重新发明 shell，而是：

> **沿现有 `capability-runtime` + `ServiceBindingTarget` + `CAPABILITY_WORKER` seam，把它正式 remoteize。**
