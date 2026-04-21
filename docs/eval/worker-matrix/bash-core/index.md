# bash.core 上下文索引

> 状态：`curated / rewritten`
> 目标：作为 `docs/eval/worker-matrix/bash-core/` 的入口索引，同时提供**原始素材召回路径**、**范围边界**、**当前结论**与**阅读顺序**。

---

## 0. 一句话结论

**`bash.core` 不是 Linux shell，也不是 just-bash 那种完整 AST shell runtime；它今天最可信的身份，是一个已经真实存在、而且很接近可独立 worker 化的 fake-bash 执行引擎：`FakeBashBridge + 21-command governed subset + CapabilityExecutor + ServiceBindingTarget seam`。**

---

## 1. In-Scope / Out-of-Scope

### 1.1 In-Scope

本目录只负责回答下面四类问题：

| 项目 | 说明 |
|---|---|
| `bash.core` 的定位 | 它到底是 shell、capability worker，还是只是 command parser |
| `bash.core` 的协议责任 | 它今天到底拥有哪一层 `tool.call.* / cancel / progress / policy` contract |
| `bash.core` 的当前代码真相 | 当前仓库里已经有哪些 registry/bridge/handler/target/runtime seam，哪些仍未闭合 |
| `bash.core` 的平台边界 | Cloudflare Worker / V8 isolate / fake-bash findings / just-bash 对它的直接约束 |

### 1.2 Out-of-Scope

本目录**不**承担下面这些工作：

| 项目 | 为什么不在这里做 |
|---|---|
| 设计 `agent.core / filesystem.core / context.core` 的全部细节 | 它们各自需要独立上下文包 |
| 把 `bash.core` 写成完整 POSIX / Linux / just-bash 兼容层 | 当前代码和设计都明确拒绝这条路线 |
| 把 `bash.core` 直接写成 deploy 完成的 worker | 现在最扎实的是 package + transport seam，不是现成 worker shell |
| 把 browser / python / npm / package install / real git write 包进 bash 面 | 这些都已被当前治理真相显式排除或延后 |

---

## 2. 证据优先级

本目录采用下面这条优先级：

1. **当前仓库源码与当前测试**
2. **原始 action-plan / review / evaluation / spike finding 文档**
3. **`context/just-bash` 参考实现**
4. **较早的价值分析与 closure 口径**

这条优先级在 `bash.core` 上尤其重要，因为：

- 旧评估常把它概括成“12-pack fake-bash 已 ready”；
- 当前代码已经前进到 **B3 21-command surface + `ServiceBindingTarget` transport seam + curl budget + text-processing handlers**：`packages/capability-runtime/src/fake-bash/commands.ts:16-315`; `src/targets/service-binding.ts:90-215`; `src/capabilities/text-processing.ts:1-85`; `src/capabilities/network.ts:38-57,83-117,153-187`
- 但当前仓库仍没有一个 deploy-shaped `bash.core` Worker 入口；所以必须以**当前代码真相**裁判“什么已经成立、什么还不能写满”。

---

## 3. 原始素材总索引

> 下面列的都是**原始路径**，不是 `docs/eval/worker-matrix/00-context/` 里的复制品。

### 3.1 原始文档素材

| 类型 | 原始路径 | 关键行 / 章节 | 为什么必读 |
|---|---|---|---|
| evaluation | [`docs/eval/after-foundations/worker-matrix-eval-with-GPT.md`](../../../eval/after-foundations/worker-matrix-eval-with-GPT.md) | `299-346` | GPT 对 `bash.core` 的原始判断：值得做、readiness 中高、限制主要在 wiring 与 full port |
| evaluation | [`docs/eval/after-foundations/worker-matrix-eval-with-Opus.md`](../../../eval/after-foundations/worker-matrix-eval-with-Opus.md) | `200-224` | Opus 对 `bash.core READY` 与 Phase 8.A 任务清单的原始判断 |
| action-plan | [`docs/action-plan/after-skeleton/A8-minimal-bash-search-and-workspace.md`](../../../action-plan/after-skeleton/A8-minimal-bash-search-and-workspace.md) | `24-39,90-95,120-132` | A8 冻结 workspace/search fake-bash 的第一波 contract |
| action-plan | [`docs/action-plan/after-skeleton/A9-minimal-bash-network-and-script.md`](../../../action-plan/after-skeleton/A9-minimal-bash-network-and-script.md) | `25-40,87-99,117-129` | A9 冻结 `curl / ts-exec` 的高风险 bash-path 边界 |
| action-plan | [`docs/action-plan/after-skeleton/A10-minimal-bash-vcs-and-policy.md`](../../../action-plan/after-skeleton/A10-minimal-bash-vcs-and-policy.md) | `25-40,85-89,121-127` | A10 冻结 `git` subset 与 unsupported / risk-blocked / drift guard 治理 |
| action-plan | [`docs/action-plan/after-foundations/B3-fake-bash-extension-and-port.md`](../../../action-plan/after-foundations/B3-fake-bash-extension-and-port.md) | `38-56,64-70,148-173` | B3 说明 21-command 扩展不是移植 just-bash，而是扩 typed capability runtime |
| design | [`docs/design/after-foundations/P2-fake-bash-extension-policy.md`](../../../design/after-foundations/P2-fake-bash-extension-policy.md) | `25-41,49-60,95-149,168-187` | 说明 should-port / not-port / curl budget / ts-exec partial / worker-matrix `bash.core` 边界 |
| spike rollup | [`docs/spikes/fake-bash-platform-findings.md`](../../../spikes/fake-bash-platform-findings.md) | `12-22,26-33,51-69` | 总结 F07/F08/F09 三条 Cloudflare fake-bash finding 对 B3/B8 的 writeback |
| finding | [`docs/spikes/spike-do-storage/07-bash-capability-parity-3-of-3-contracts-hold.md`](../../../spikes/spike-do-storage/07-bash-capability-parity-3-of-3-contracts-hold.md) | `13-16,30-40,90-107,182-208` | 证明 12-pack 三条核心 contract 在真实 DO 沙箱成立 |
| finding | [`docs/spikes/spike-do-storage/09-curl-quota-25-fetches-no-rate-limit-default-target.md`](../../../spikes/spike-do-storage/09-curl-quota-25-fetches-no-rate-limit-default-target.md) | `13-16,31-47,95-123,206-219` | 说明 curl 在 low-volume 下 viable，但 high-volume cap 仍要保守预算 |
| design | [`docs/design/after-foundations/P7-worker-matrix-pre-convergence.md`](../../../design/after-foundations/P7-worker-matrix-pre-convergence.md) | `166-170` | 说明 worker-matrix 原 proposal 中 `bash.core` 的 worker role |
| value analysis | [`docs/eval/vpa-fake-bash-by-GPT.md`](../../../eval/vpa-fake-bash-by-GPT.md) | `67-95,98-115` | 说明 fake-bash 的正确定位是 bash-compatible surface + capability-native runtime |

### 3.2 当前仓库代码素材

| 类型 | 原始路径 | 关键行 | 为什么必读 |
|---|---|---|---|
| package contract | [`packages/capability-runtime/README.md`](../../../../packages/capability-runtime/README.md) | `1-18,20-82,84-101,130-197` | 证明当前 public positioning、21-command surface、target reality、tool-call bridge |
| public exports | [`packages/capability-runtime/src/index.ts`](../../../../packages/capability-runtime/src/index.ts) | `37-87,104-165` | 证明 planner / bridge / target / handlers / governance helpers 已组成 package API |
| registry truth | [`packages/capability-runtime/src/fake-bash/commands.ts`](../../../../packages/capability-runtime/src/fake-bash/commands.ts) | `15-315` | 证明 canonical 21-command declaration、policy 与 registry helper 已冻结 |
| bridge | [`packages/capability-runtime/src/fake-bash/bridge.ts`](../../../../packages/capability-runtime/src/fake-bash/bridge.ts) | `1-20,46-80,82-167` | 证明 fake-bash bridge 的 no-silent-success contract |
| unsupported taxonomy | [`packages/capability-runtime/src/fake-bash/unsupported.ts`](../../../../packages/capability-runtime/src/fake-bash/unsupported.ts) | `1-12,15-86,88-119` | 证明 unsupported 与 OOM-risk taxonomy 已显式冻结 |
| planner | [`packages/capability-runtime/src/planner.ts`](../../../../packages/capability-runtime/src/planner.ts) | `17-65,67-128,130-248,257-403` | 证明 narrow bash path、grep alias、tool planning 与 structured input builder 已存在 |
| tool-call bridge | [`packages/capability-runtime/src/tool-call.ts`](../../../../packages/capability-runtime/src/tool-call.ts) | `1-15,20-37,64-87,89-160` | 证明 `bash.core` 与 `tool.call.*` body family 的对齐方式 |
| executor | [`packages/capability-runtime/src/executor.ts`](../../../../packages/capability-runtime/src/executor.ts) | `22-68,71-119,121-239,242-320` | 证明 policy / requestId / cancel / timeout / progress stream 的 load-bearing reality |
| internal lifecycle | [`packages/capability-runtime/src/events.ts`](../../../../packages/capability-runtime/src/events.ts) | `1-25` | 证明 capability event kinds 已冻结 |
| policy gate | [`packages/capability-runtime/src/policy.ts`](../../../../packages/capability-runtime/src/policy.ts) | `1-49` | 证明 allow / ask / deny 由 registry declaration 决定 |
| service-binding target | [`packages/capability-runtime/src/targets/service-binding.ts`](../../../../packages/capability-runtime/src/targets/service-binding.ts) | `1-18,40-84,90-215` | 证明 remote transport seam 已存在 |
| handlers | [`packages/capability-runtime/src/capabilities/{filesystem,search,text-processing,network,exec,vcs}.ts`](../../../../packages/capability-runtime/src/capabilities) | `filesystem.ts:102-237`; `search.ts:67-205`; `text-processing.ts:1-85,196-355`; `network.ts:38-57,83-117,153-187`; `exec.ts:1-31,52-90`; `vcs.ts:34-50,110-170` | 证明 21-command surface 背后已有真实 handler |
| runtime seam | [`packages/session-do-runtime/src/remote-bindings.ts`](../../../../packages/session-do-runtime/src/remote-bindings.ts) | `324-399` | 证明 `CAPABILITY_WORKER` 已能产出 `serviceBindingTransport` handle |
| worker env | [`packages/session-do-runtime/src/worker.ts`](../../../../packages/session-do-runtime/src/worker.ts) | `31-49,72-88` | 证明 host worker env 已为 `CAPABILITY_WORKER` 预留 binding slot |

### 3.3 当前测试素材

| 类型 | 原始路径 | 关键行 | 为什么必读 |
|---|---|---|---|
| bridge rejection | [`packages/capability-runtime/test/fake-bash-bridge.test.ts`](../../../../packages/capability-runtime/test/fake-bash-bridge.test.ts) | `41-77,79-134,197-255` | 证明 no-executor / unsupported / oom-risk / bash-narrow 都 hard-fail，且 21 commands 已注册 |
| planner narrow | [`packages/capability-runtime/test/planner-bash-narrow.test.ts`](../../../../packages/capability-runtime/test/planner-bash-narrow.test.ts) | `24-75,78-100` | 证明 `curl` / `ts-exec` bash path 已被严格收窄 |
| registry | [`packages/capability-runtime/test/commands.test.ts`](../../../../packages/capability-runtime/test/commands.test.ts) | `6-53` | 证明 ask/allow defaults 与 B3 text-processing registration 已锁定 |
| inventory drift guard | [`packages/capability-runtime/test/inventory-drift-guard.test.ts`](../../../../packages/capability-runtime/test/inventory-drift-guard.test.ts) | `1-29,55-89,114-180,220-239` | 证明 21-pack / policy / taxonomy / PX docs 已形成强守卫 |
| command smoke | [`packages/capability-runtime/test/integration/command-surface-smoke.test.ts`](../../../../packages/capability-runtime/test/integration/command-surface-smoke.test.ts) | `14-87` | 证明 21 commands 都能从 bash path 被规划出来 |
| service-binding | [`packages/capability-runtime/test/integration/service-binding-transport.test.ts`](../../../../packages/capability-runtime/test/integration/service-binding-transport.test.ts) | `63-90,92-136,138-216,218-255` | 证明 transport/progress/cancel roundtrip 已真实存在 |
| curl | [`packages/capability-runtime/test/capabilities/network-egress.test.ts`](../../../../packages/capability-runtime/test/capabilities/network-egress.test.ts) | `27-49,105-130,222-260` | 证明 curl stub、egress guard、budget guard 已锁定 |
| ts-exec | [`packages/capability-runtime/test/capabilities/ts-exec-partial.test.ts`](../../../../packages/capability-runtime/test/capabilities/ts-exec-partial.test.ts) | `21-60` | 证明 `ts-exec` 仍是 honest partial |
| git subset | [`packages/capability-runtime/test/capabilities/git-subset.test.ts`](../../../../packages/capability-runtime/test/capabilities/git-subset.test.ts) | `56-99,147-195` | 证明 git subset 只读三件套已锁定 |
| rg reality | [`packages/capability-runtime/test/capabilities/search-rg-reality.test.ts`](../../../../packages/capability-runtime/test/capabilities/search-rg-reality.test.ts) | `54-147,185-216` | 证明 `rg` 已是真实 workspace search，而非纯 stub |
| text-processing | [`packages/capability-runtime/test/capabilities/text-processing-core.test.ts`](../../../../packages/capability-runtime/test/capabilities/text-processing-core.test.ts) | `51-89,91-143,145-213,215-280` | 证明 `wc/head/tail/jq/sed/awk` 已有真实回归 |
| text-processing aux | [`packages/capability-runtime/test/capabilities/text-processing-aux.test.ts`](../../../../packages/capability-runtime/test/capabilities/text-processing-aux.test.ts) | `39-69,71-98,100-156` | 证明 `sort/uniq/diff` 已有真实回归 |

### 3.4 `context/` 参考实现素材

| 类型 | 原始路径 | 关键行 | 为什么必读 |
|---|---|---|---|
| overall shell runtime | [`context/just-bash/src/Bash.ts`](../../../../context/just-bash/src/Bash.ts) | `3-8,16-21,95-145,183-217` | 说明 just-bash 是 AST shell runtime，不是简单 command bridge |
| command registry | [`context/just-bash/src/commands/registry.ts`](../../../../context/just-bash/src/commands/registry.ts) | `1-12,14-18,100-117,198-226` | 说明它有大而全的 lazy command registry |
| interpreter | [`context/just-bash/src/interpreter/interpreter.ts`](../../../../context/just-bash/src/interpreter/interpreter.ts) | `1-10,109-137,139-177,219-220` | 说明 just-bash 真实拥有 AST interpreter |
| README | [`context/just-bash/README.md`](../../../../context/just-bash/README.md) | `3-7,27-50,54-103,151-233,237-303` | 说明 just-bash 的广语法面、FS universe、network / JS / Python / pipe / redirect |
| threat model | [`context/just-bash/THREAT_MODEL.md`](../../../../context/just-bash/THREAT_MODEL.md) | `3-6,31-38,80-89,118-140,181-219` | 说明做完整 shell runtime 会立刻进入更重的安全面 |
| CLI | [`context/just-bash/src/cli/just-bash.ts`](../../../../context/just-bash/src/cli/just-bash.ts) | `3-9,80-88,167-175` | 说明 just-bash 的宿主心智依然是 OverlayFS + CLI sandbox，而不是 Worker-native transport worker |

---

## 4. 当前应冻结的五个判断

| 判断 | 结论 | 主证据 |
|---|---|---|
| `bash.core` 的身份 | **governed fake-bash execution engine，不是完整 shell** | `docs/eval/vpa-fake-bash-by-GPT.md:67-95`; `packages/capability-runtime/README.md:9-18`; `context/just-bash/README.md:88-103` |
| 当前最扎实的代码面 | **`FakeBashBridge + 21-command registry + CapabilityExecutor + handlers + ServiceBindingTarget`** | `packages/capability-runtime/src/fake-bash/bridge.ts:1-20,82-167`; `commands.ts:16-315`; `executor.ts:121-239`; `targets/service-binding.ts:90-215` |
| 当前最关键的治理法则 | **no-silent-success + bash-narrow + ask/allow policy + unsupported/oom-risk taxonomy** | `bridge.ts:17-20`; `planner.ts:130-248`; `policy.ts:17-48`; `unsupported.ts:15-119` |
| 当前最真实的 remote seam | **`CAPABILITY_WORKER` + `serviceBindingTransport` 已存在，但 deploy-shaped `bash.core` worker shell 仍未出现** | `packages/session-do-runtime/src/worker.ts:33-47`; `src/remote-bindings.ts:335-390`; `packages/capability-runtime/test/integration/service-binding-transport.test.ts:92-216` |
| worker-matrix 第一波姿态 | **可以把 `bash.core` 当 first-wave worker 研究对象，但必须按“21-command governed subset + remote transport seam”推进，不能误写成 full shell** | `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md:313-346`; `docs/eval/after-foundations/worker-matrix-eval-with-Opus.md:207-224`; `docs/design/after-foundations/P2-fake-bash-extension-policy.md:127-149,241-248` |

---

## 5. 推荐阅读顺序

1. **先读** `realized-code-evidence.md`  
   先把“当前仓库里到底已经有什么”读清楚，避免把 `bash.core` 当成纯设想。

2. **再读** `internal-nacp-compliance.md`  
   它说明 `bash.core` 当前到底拥有哪些 `tool.call.* / cancel / progress / requestId / policy` 内部 contract。

3. **再读** `external-contract-surface.md`  
   它解释 package API、bash-shaped surface、service-binding seam、host binding slot 是怎么分层的。

4. **最后读** `cloudflare-study-evidence.md`  
   它把 F07/F09 与 just-bash 的结构差异放到一起，解释为什么第一波必须是 governed subset。

---

## 6. 当前仍然开放的关键缺口

| 缺口 | 当前状态 | 是否阻止 `bash.core` 继续建模 |
|---|---|---|
| deploy-shaped `bash.core` worker shell | 仍未看到独立 worker 入口 | **不阻止建模，但阻止“已独立部署”判断** |
| `agent.core -> bash.core` 默认主链 | `CAPABILITY_WORKER` transport seam 已有，但默认 host 主链仍未把完整 agent turn loop 接满 | **不阻止 worker 建模，但阻止“默认远端 tool path 已闭合”判断** |
| `ts-exec` 真执行 substrate | 仍是 honest partial | **不阻止 bash-core 成立，但阻止把它写成完整 script runner** |
| full shell grammar / pipe / redirect / heredoc | 当前明确 out-of-scope | **不阻止 fake-bash engine 成立，反而是边界保护器** |
| high-volume curl cap | low-volume baseline 已有，真实 widening point 仍待 owner URL probe | **不阻止 conservative budget path，但阻止把 network surface 写成 fully profiled reality** |

---

## 7. 本索引的使用方式

如果后续要继续编写 `worker-matrix` 的 `bash.core` 设计文档，建议把本目录当成下面这三件事的 SSOT：

1. **原始素材召回入口**：先沿着这里的原始路径回到 evaluation / action-plan / code / test / `context/just-bash` 本体；
2. **当前真相裁判**：遇到“bash.core 已 ready”与“bash.core 只是 fake-bash 文档概念”的冲突时，以这里列出的当前代码锚点为准；
3. **边界保护器**：任何把 `bash.core` 写成“full shell / full just-bash / Linux compatible worker”的设计，都应视为越界。
