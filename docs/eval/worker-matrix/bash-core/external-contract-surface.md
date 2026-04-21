# bash.core — external contract surface

> 目标：回答 `bash.core` 今天实际暴露给哪些外部消费者；哪些 surface 已真实存在，哪些仍只是 seam 或 reserved slot。

---

## 0. 先给结论

**`bash.core` 当前最真实的 external surface 不是独立 Worker API，而是三层组合：**

1. **package API**：`@nano-agent/capability-runtime`
2. **bash-shaped compatibility surface**：`FakeBashBridge.plan()/execute()` + canonical 21 commands
3. **runtime remote seam**：`ServiceBindingTarget` + `CAPABILITY_WORKER`

而**独立 deploy-shaped `bash.core` worker fetch / websocket surface 目前仍不存在**。

---

## 1. 原始素材召回表

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| package README | [`packages/capability-runtime/README.md`](../../../../packages/capability-runtime/README.md) | `1-18,20-82,84-101,130-197` | 证明 package 的 public positioning、supported commands、targets、tool-call bridge |
| public exports | [`packages/capability-runtime/src/index.ts`](../../../../packages/capability-runtime/src/index.ts) | `37-87,104-165` | 证明真正的 package-level API surface |
| registry truth | [`packages/capability-runtime/src/fake-bash/commands.ts`](../../../../packages/capability-runtime/src/fake-bash/commands.ts) | `16-315` | 证明 command surface 与 policy truth |
| bridge | [`packages/capability-runtime/src/fake-bash/bridge.ts`](../../../../packages/capability-runtime/src/fake-bash/bridge.ts) | `39-147` | 证明 bash-shaped external entry 是 `plan()` / `execute()` |
| planner | [`packages/capability-runtime/src/planner.ts`](../../../../packages/capability-runtime/src/planner.ts) | `23-65,76-128,130-248,257-311` | 证明 bash path 与 structured path 的 public boundary |
| service-binding target | [`packages/capability-runtime/src/targets/service-binding.ts`](../../../../packages/capability-runtime/src/targets/service-binding.ts) | `81-125,127-192` | 证明 remote execution external seam 已存在 |
| host binding slot | [`packages/session-do-runtime/src/worker.ts`](../../../../packages/session-do-runtime/src/worker.ts) | `31-49` | 证明 host env 已为 `CAPABILITY_WORKER` 预留 binding slot |
| host remote handle | [`packages/session-do-runtime/src/remote-bindings.ts`](../../../../packages/session-do-runtime/src/remote-bindings.ts) | `329-390` | 证明 host 侧 capability remote seam 的外部形状 |
| worker-matrix eval | [`docs/eval/after-foundations/worker-matrix-eval-with-Opus.md`](../../../eval/after-foundations/worker-matrix-eval-with-Opus.md) | `218-224` | 说明独立 `bash.core` worker 的建议外部面其实很薄：fetch handler + service-binding |

---

## 2. 第一层 external surface：package / library API

`capability-runtime` 现在已经是一个正式 workspace package：

- package name/version/scripts：`packages/capability-runtime/package.json:2-19`
- README 开头直接定义它是 typed capability execution layer：`README.md:1-18`
- `src/index.ts` 明确要求所有消费者从 public API surface import：`1-5`

当前 package-level external surface 至少包含：

1. planner：`planFromBashCommand / planFromToolCall / parseSimpleCommand`：`src/index.ts:37-47`
2. executor：`CapabilityExecutor`：`60-63`
3. targets：`LocalTsTarget / ServiceBindingTarget / BrowserRenderingTarget`：`64-69`
4. fake-bash：`FakeBashBridge / registerMinimalCommands / taxonomy helpers`：`70-87`
5. handlers：filesystem/search/text-processing/network/exec/vcs：`104-165`

这说明当前的 `bash.core` 不是“写死在 session-do-runtime 里的私有 helper”，而是已经有了可直接 import 的 package contract。

---

## 3. 第二层 external surface：bash-shaped compatibility face

### 3.1 bash 外形的真正入口是 `FakeBashBridge`

`FakeBashBridge` 当前向外暴露的 public shape 很清楚：

- `plan(commandLine)`：返回 `CapabilityPlan | null`：`bridge.ts:46-73`
- `execute(commandLine)`：返回 `CapabilityResult`：`75-135`
- `isSupported(command)`：`137-142`
- `listCommands()`：`144-147`

也就是说，`bash.core` 当前给上游的“shell 面”，其实不是 AST shell API，而是：

> **bash-shaped command string -> capability plan/result 的 compatibility bridge。**

### 3.2 command surface 已冻结为 canonical 21-pack

`commands.ts` 当前已经把最小 surface 冻结为：

- 12-pack baseline：`pwd / ls / cat / write / mkdir / rm / mv / cp / rg / curl / ts-exec / git`
- B3 新增 9 个 text-processing：`wc / head / tail / jq / sed / awk / sort / uniq / diff`

见：`packages/capability-runtime/src/fake-bash/commands.ts:16-275`

README 也同步把这 21 commands 文档化了：`packages/capability-runtime/README.md:20-82`

### 3.3 policy 也是 external contract 的一部分

当前 surface 不是“只有命令名”，还包含默认 policy：

- `write / mkdir / rm / mv / cp / curl / ts-exec` = `ask`
- 其余大多是 `allow`

见：`commands.ts:17-275`; `README.md:26-76`

再加上：

- `getAskGatedCommands()`：`commands.ts:306-309`
- `getAllowGatedCommands()`：`311-314`

这说明 external surface 已经把“支持面”和“权限面”一起公开，而不是把 policy 藏在内部。

---

## 4. 第三层 external surface：bash path vs structured tool path

`planner.ts` 当前已经定义了两条外部入口：

1. `planFromBashCommand(command, registry)`：`257-287`
2. `planFromToolCall(name, args, registry)`：`294-311`

这两条路径的边界也已经冻结：

- `grep` 只是 `rg` 的 narrow alias：`76-128`
- `curl` bash path 只允许 `curl <url>`：`151-182`
- `ts-exec` bash path 只允许 inline code：`183-198`
- `git` bash path 只允许 `status/diff/log`：`199-215`
- B3 text-processing bash path 全部 file/path-first：`216-248`

因此 `bash.core` 的 external contract 不是“bash surface 无限扩张”，而是：

> **bash path 保持窄；任何 richer semantics 走 structured tool call。**

---

## 5. 第四层 external surface：execution target / remote seam

### 5.1 target 层已经对外暴露三种 execution slot

README 当前把 target reality 写得很明确：

- `local-ts`：reference target
- `service-binding`：stub / reserved for remote execution
- `browser-rendering`：stub / reserved for headless browser capability

见：`packages/capability-runtime/README.md:84-101`

对 `bash.core` 来说，真正 relevant 的是：

> **`service-binding` 已经是正式 external seam。**

### 5.2 `ServiceBindingTarget` 已经是外部 transport 契约

`ServiceBindingTarget` 对外暴露的 seam 不是“某个 Cloudflare 私有对象”，而是一套抽象 transport：

- `ServiceBindingTransport.call()`：`81-84`
- 可选 `cancel()`：同上
- `ServiceBindingCallInput` 包含 `requestId / capabilityName / body / signal / onProgress`：`58-64`

这意味着任何未来的 `bash.core` worker，只要能实现这套 transport 契约，就能接入今天的 capability-runtime。

### 5.3 host runtime 已经给 `bash.core` 预留 binding slot

当前 host Worker env 已经有：

- `CAPABILITY_WORKER?: unknown`

见：`packages/session-do-runtime/src/worker.ts:33-47`

而 `makeRemoteBindingsFactory()` 已经把它翻译成：

- `capability: { serviceBindingTransport }`

见：`packages/session-do-runtime/src/remote-bindings.ts:335-390`

所以 `bash.core` 当前已经有：

1. package-level remote target
2. host env binding slot
3. host runtime remote handle shape

但还没有真正的独立 worker shell。

---

## 6. 当前不存在的 external surface

### 6.1 当前没有 deploy-shaped `bash.core` worker entry

现在仓库里我们能直接看到的 Worker entry 仍是：

- `packages/session-do-runtime/src/worker.ts`

而不是 `packages/bash-core/...` 之类的独立 worker shell。

再结合：

- `ServiceBindingTarget` 仍允许无 transport 时返回 `not-connected`：`targets/service-binding.ts:113-125`
- Opus 对 Phase 8.A 的任务清单仍把“写 `bash-worker/src/index.ts`”列为未来工作：`docs/eval/after-foundations/worker-matrix-eval-with-Opus.md:218-223`

更准确的当前表述应是：

> **remote seam 已有，但独立 worker shell 还没落成。**

### 6.2 当前也没有 full shell external contract

当前 external contract 明确不包含：

- pipes / redirects / heredoc / loops / functions
- real process spawning
- python / node / nested bash
- package managers
- mutating git

证据分别在：

- planner narrow law：`packages/capability-runtime/src/planner.ts:130-248`
- unsupported taxonomy：`src/fake-bash/unsupported.ts:15-86`
- `ts-exec` honest partial：`src/capabilities/exec.ts:1-31,61-87`
- `git` readonly trio：`src/capabilities/vcs.ts:34-50,117-167`

所以，把今天的 `bash.core` external face 写成“shell runtime API”会明显过头。

---

## 7. 当前最合理的 surface 分层

| 层 | 当前真实 surface | readiness |
|---|---|---|
| package/library | `@nano-agent/capability-runtime` public API | **高** |
| bash-shaped compatibility | `FakeBashBridge` + canonical 21 commands | **高** |
| execution target seam | `LocalTsTarget` + `ServiceBindingTarget` | **中高** |
| host runtime binding | `CAPABILITY_WORKER` + `serviceBindingTransport` | **中** |
| standalone worker API | 独立 `bash.core` fetch / WS surface | **低 / 未落成** |

---

## 8. 结论

**`bash.core` 当前对外最成熟的是 package API、bash-shaped bridge 和 service-binding seam；最不成熟的是独立 worker shell。**

所以 worker-matrix 第一波最推荐的姿态不是：

> “先发明一套完整 shell worker API”

而是：

> **先沿现有 package surface + service-binding seam 把 `bash.core` 独立出来，再在真正需要时补 deploy shell。**
