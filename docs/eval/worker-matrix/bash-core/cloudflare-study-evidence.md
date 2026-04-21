# bash.core — Cloudflare / just-bash study evidence

> 目标：把 `bash.core` 的平台证据、fake-bash spike finding、以及 `context/just-bash` 的参考价值与边界放到同一处，回答：为什么 worker-matrix 第一波应该做 `bash.core`，以及为什么它必须是 **governed subset**。

---

## 0. 先给结论

**Cloudflare / Worker / V8 isolate 给 `bash.core` 的最强结论，不是“我们能复刻 shell”，而是：**

1. **fake-bash 这条路是必要的**，因为 LLM 的工具先验就是 bash-shaped；
2. **just-bash 不能直接搬过来**，因为它的宿主心智是 AST shell + virtual FS + optional runtimes，而不是 Worker-native capability worker；
3. **当前最稳的第一波姿态**，就是以 `capability-runtime` 的 21-command governed subset 为核心，把 `bash.core` 做成一个远端 capability worker，而不是 full shell worker。

---

## 1. 原始素材召回表

### 1.1 Cloudflare / spike / worker-matrix 文档

| 类型 | 原始路径 | 关键行 / 章节 | 用途 |
|---|---|---|---|
| spike rollup | [`docs/spikes/fake-bash-platform-findings.md`](../../../spikes/fake-bash-platform-findings.md) | `12-22,26-33,51-69,81-89` | 总结 F07/F08/F09 对 B3/B8 的 writeback |
| finding | [`docs/spikes/spike-do-storage/07-bash-capability-parity-3-of-3-contracts-hold.md`](../../../spikes/spike-do-storage/07-bash-capability-parity-3-of-3-contracts-hold.md) | `13-16,30-40,90-107,182-208` | 证明 12-pack 核心 contract 在真实 DO 沙箱成立 |
| finding | [`docs/spikes/spike-do-storage/09-curl-quota-25-fetches-no-rate-limit-default-target.md`](../../../spikes/spike-do-storage/09-curl-quota-25-fetches-no-rate-limit-default-target.md) | `13-16,31-47,95-123,206-219` | 证明 curl low-volume viable，但必须保守预算 |
| design | [`docs/design/after-foundations/P2-fake-bash-extension-policy.md`](../../../design/after-foundations/P2-fake-bash-extension-policy.md) | `25-41,95-149,168-199,241-248` | 说明 should-port / not-port / budget / partial policy |
| action-plan | [`docs/action-plan/after-foundations/B3-fake-bash-extension-and-port.md`](../../../action-plan/after-foundations/B3-fake-bash-extension-and-port.md) | `38-56,64-70,106-110,148-173` | 说明 B3 的真实目标是 governed extension，不是移植 just-bash |
| design | [`docs/design/after-foundations/P7-worker-matrix-pre-convergence.md`](../../../design/after-foundations/P7-worker-matrix-pre-convergence.md) | `166-170` | 说明 worker-matrix 对 `bash.core` 的 role 预期 |
| evaluation | [`docs/eval/after-foundations/worker-matrix-eval-with-GPT.md`](../../../eval/after-foundations/worker-matrix-eval-with-GPT.md) | `311-346` | GPT 对 `bash.core` readiness 中高的判断 |
| evaluation | [`docs/eval/after-foundations/worker-matrix-eval-with-Opus.md`](../../../eval/after-foundations/worker-matrix-eval-with-Opus.md) | `207-224` | Opus 对 `bash.core READY` 的判断与 Phase 8.A 任务清单 |
| value analysis | [`docs/eval/vpa-fake-bash-by-GPT.md`](../../../eval/vpa-fake-bash-by-GPT.md) | `67-95,98-115,185-206,237-259` | 说明 fake-bash 应是 capability-native runtime，而不是 Linux 幻觉 |

### 1.2 `context/just-bash` 参考实现

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| README | [`context/just-bash/README.md`](../../../../context/just-bash/README.md) | `3-7,27-50,54-103,151-233,237-303` | 说明 just-bash 是广命令面 + 广语法面 + 多种 FS / network / runtimes 的虚拟 shell |
| Bash runtime | [`context/just-bash/src/Bash.ts`](../../../../context/just-bash/src/Bash.ts) | `3-8,16-21,95-145,183-217` | 说明 just-bash 的总体架构与可选能力面 |
| registry | [`context/just-bash/src/commands/registry.ts`](../../../../context/just-bash/src/commands/registry.ts) | `1-12,14-18,100-117,198-226` | 说明它有大而全的 lazy command registry |
| interpreter | [`context/just-bash/src/interpreter/interpreter.ts`](../../../../context/just-bash/src/interpreter/interpreter.ts) | `1-10,109-137,139-177` | 说明它是真正 AST interpreter，而非 command bridge |
| threat model | [`context/just-bash/THREAT_MODEL.md`](../../../../context/just-bash/THREAT_MODEL.md) | `3-6,31-38,80-89,118-140,181-219,223-241` | 说明 full shell runtime 带来的安全面与 residual risk |
| CLI | [`context/just-bash/src/cli/just-bash.ts`](../../../../context/just-bash/src/cli/just-bash.ts) | `3-9,80-88,167-175` | 说明 just-bash 的宿主心智仍是 OverlayFS + CLI sandbox |

---

## 2. Cloudflare 给 `bash.core` 的最强支持，不是“能做 shell”，而是“能做 fake-bash capability worker”

### 2.1 F07 证明了：最核心的 fake-bash contract 在真实 DO 沙箱成立

F07 的结论很直接：

> 3/3 load-bearing bash capability contracts hold

具体是：

1. `mkdir` partial disclosure
2. `/_platform/**` reserved namespace rejection
3. `rg` inline output cap

见：`docs/spikes/spike-do-storage/07-bash-capability-parity-3-of-3-contracts-hold.md:13-16,30-40`

这条 finding 的工程含义不是“小测了一下没问题”，而是：

> **fake-bash 的最基本 contract 在真实 Cloudflare runtime 上没有塌。**

这也是 `bash.core` 能进入 worker-matrix first-wave 的最关键平台依据之一。

### 2.2 F09 证明了：curl 在低 volume 下可行，但必须保守预算

F09 当前只能给出一个保守结论：

- 10 / 25 outbound fetch 全成功：`31-39`
- 这**不是**真实上限，只是 low-volume baseline：`41-49`
- worker-matrix 继续推进时必须保留保守 budget：`206-219`

因此平台真相不是“network 已 fully profiled”，而是：

> **curl connected path 可行，但 `bash.core` 必须把 subrequest budget 当成 first-class guard。**

### 2.3 rollup 已把 writeback 路径说得很清楚

`fake-bash-platform-findings.md` 已把三条 finding 的 writeback map 写清：

- F07 → 保留 12-pack contract
- F08 → write size guard / size-aware routing
- F09 → curl subrequest budget

见：`docs/spikes/fake-bash-platform-findings.md:51-69`

这说明 Cloudflare 平台对 `bash.core` 的影响，不是“平台不允许做”，而是：

> **平台要求 `bash.core` 以 budget / disclosure / governed subset 的方式去做。**

---

## 3. 为什么 first-wave 的正确姿态一定是 governed subset

### 3.1 B3 / P2 已经把路线冻结成“扩 capability runtime”，不是移植 just-bash

P2 design 明确写着：

- fake-bash 不是 OS shell，而是 virtual bash environment：`docs/design/after-foundations/P2-fake-bash-extension-policy.md:27-30`
- 不讨论 full 89 commands port：`37-41`
- port 要在 `capability-runtime` 中**重写**，不 import upstream：`138-149`

B3 action-plan 也强调：

- 不导入 just-bash，不发明 shell feature：`docs/action-plan/after-foundations/B3-fake-bash-extension-and-port.md:64-70`
- 输出边界与 inventory/docs 必须同步：`106-110`

因此 worker-matrix 阶段若做 `bash.core`，应继承的是：

> **`capability-runtime` 这条 governed subset 路线，而不是 just-bash 那条 full shell runtime 路线。**

### 3.2 GPT 的 fake-bash 价值判断也与这条路完全一致

`vpa-fake-bash-by-GPT.md` 当前给出的核心判断是：

- fake-bash 是 **兼容层 / 能力路由层 / prompt 协议层**：`67-76`
- 不是 POSIX 复刻 / Linux 仿真：`77-81`
- 最佳架构是 `bash-compatible surface + typed capability runtime`：`83-95`

所以从产品定位上看，worker-matrix 的 `bash.core` 最合理的继承物，就是今天的 `capability-runtime`。

---

## 4. just-bash 真正值得吸收的是什么

### 4.1 值得吸收：它非常清楚 shell runtime 的结构

just-bash 的主路径是：

> Input -> Parser -> AST -> Interpreter -> Output

见：`context/just-bash/src/Bash.ts:3-8`; `docs/eval/vpa-fake-bash-by-GPT.md:102-115`

它值得我们吸收的地方主要有三类：

1. **command registry 是显式枚举且可分析的**：`context/just-bash/src/commands/registry.ts:1-12,116-117`
2. **安全面被认真建模**：`THREAT_MODEL.md:80-89,118-140,181-219`
3. **对 AI-agent 场景有很强的适配意识**：`README.md:3-7,27-50`

这些启发都已经在 nano-agent 当前 fake-bash 路线上被吸收了：

- 显式 registry：`packages/capability-runtime/src/fake-bash/commands.ts:16-315`
- unsupported / OOM-risk taxonomy：`src/fake-bash/unsupported.ts:15-119`
- no-silent-success + bounded outputs + budget：`src/fake-bash/bridge.ts:17-20`; `src/capabilities/network.ts:45-57,83-117`; `src/capabilities/text-processing.ts:39-85`

### 4.2 值得吸收：它知道 shell 幻觉是有代价的

just-bash 的 threat model 里把攻击面列得很完整：

- parser / expansion bomb
- path traversal / symlink
- SSRF / response bomb
- code execution escape
- prototype pollution
- DoS

见：`context/just-bash/THREAT_MODEL.md:92-219`

这反过来印证了 nano-agent 当前的克制是对的：**一旦要做 full shell，安全面会立刻爆炸。**

---

## 5. just-bash 明确不能直接照搬的是什么

### 5.1 它的宿主心智是 shell runtime，不是 Worker-native capability worker

just-bash README 当前公开承诺：

- pipes / redirects / command chaining / loops / functions：`README.md:88-103`
- OverlayFs / ReadWriteFs / MountableFs：`151-233`
- 可选 network / js-exec / python3：`237-303`

再加上 CLI 默认心智仍是：

- OverlayFS
- CLI root / cwd
- `--allow-write`
- `--python`
- `--javascript`

见：`context/just-bash/src/cli/just-bash.ts:3-9,80-88,167-175`

这与 nano-agent 的 `bash.core` 目标心智明显不同：

| just-bash | nano-agent `bash.core` |
|---|---|
| AST shell runtime | typed capability worker |
| full bash syntax | narrow bash path + structured tool path |
| FS / network / runtimes 都在 shell 里 | 真实能力散在 workspace/network/exec/vcs handlers |
| OverlayFS / CLI 宿主 | Worker / DO / service binding 宿主 |

### 5.2 它会强化“我真的在 Linux”幻觉

just-bash 的价值分析里已经指出这一点：

- 它会更自然地诱导 LLM 期待 job control、真实 process、npm/pip、真实 sockets：`docs/eval/vpa-fake-bash-by-GPT.md:237-259`

而这正是 nano-agent 不该做的事情。

所以对 `bash.core` 来说，最危险的 drift 不是“命令太少”，而是：

> **为了更像 shell，重新把系统带回 Linux 幻觉。**

---

## 6. 为什么 worker-matrix 第一波应该做 `bash.core`

两份 worker-matrix 评估其实在 `bash.core` 上高度收敛：

- GPT：值得做，readiness 中高：`docs/eval/after-foundations/worker-matrix-eval-with-GPT.md:311-346`
- Opus：READY，立刻做：`docs/eval/after-foundations/worker-matrix-eval-with-Opus.md:200-224`

结合当前代码与 spike finding，这个判断成立的原因是：

1. **引擎已经真实存在**：`capability-runtime`
2. **Cloudflare 上最关键的 contract 已被验证**：F07
3. **高风险点已经知道如何保守处理**：F09 budget、F08 oversize
4. **remote transport seam 已经存在**：`ServiceBindingTarget + CAPABILITY_WORKER`
5. **它比 filesystem/context 更像一个天然的“跨 worker 工具执行面”**

所以 first-wave 真正推荐的不是“先做 full shell”，而是：

> **先把今天这套 governed fake-bash engine 包成独立 `bash.core` worker。**

---

## 7. 当前最合理的 bash.core 平台判断

| 主题 | 当前判断 | 依据 |
|---|---|---|
| fake-bash 是否必要 | **必要** | LLM 工作流强依赖 bash-shaped interface；`vpa-fake-bash-by-GPT.md:67-95` |
| full shell 是否必要 | **不必要，且应主动拒绝** | `P2-fake-bash-extension-policy.md:36-41,127-149`; `just-bash/README.md:88-103` |
| first-wave 是否适合做 `bash.core` | **适合** | `worker-matrix-eval-with-GPT.md:311-346`; `worker-matrix-eval-with-Opus.md:200-224` |
| 平台约束的主线 | **budget / disclosure / governed subset** | `fake-bash-platform-findings.md:51-69`; `F09: 206-219` |
| should absorb from just-bash | **registry discipline / security mindset / AI-agent awareness** | `just-bash/src/commands/registry.ts:1-12`; `THREAT_MODEL.md:92-219`; `README.md:3-7` |
| should NOT absorb from just-bash | **full shell grammar / full FS universe / Python/JS runtimes / CLI host mental model** | `README.md:88-103,151-303`; `cli/just-bash.ts:80-88,167-175` |

---

## 8. 结论

**对 `bash.core` 而言，Cloudflare 平台真相与 just-bash 参考实现其实给出了同一个 verdict：可以做，而且应该做；但必须按 fake-bash capability worker 的方式做，而不是按 full shell runtime 的方式做。**

更直白地说：

> **第一波最值得做的不是“Cloudflare 上的 bash”，而是“Cloudflare 上的 governed fake-bash worker”。**
