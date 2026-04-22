# W3 Absorption Map（9 个 Tier B packages / 10 个 absorption units）

> 状态：pre-worker-matrix / W3 主交付物  
> 配套主文：`docs/design/pre-worker-matrix/W3-absorption-blueprint-and-dryrun.md`

## 1. 这份 map 的用途

这份文档不是 action-plan，也不是最终搬迁 checklist。它只做一件事：

**把当前 9 个非 NACP Tier B packages，转换成 worker-matrix 可执行的 10 个 absorption units，并明确每个单元的归宿、复杂度、依赖与代表性样本。**

这也是为了修正 W3 主文里曾出现的模糊口径：  
仓内现实是 **9 个 Tier B packages**，但从 worker 吸收视角看，会展开成 **10 个 absorption units**，因为 `workspace-context-artifacts` 至少要拆成 context/filesystem 两个主要单元。

## 2. 原始素材召回

- `docs/plan-pre-worker-matrix.md`
- `docs/design/pre-worker-matrix/W3-absorption-blueprint-and-dryrun.md`
- `packages/agent-runtime-kernel/`
- `packages/capability-runtime/`
- `packages/context-management/`
- `packages/eval-observability/`
- `packages/hooks/`
- `packages/llm-wrapper/`
- `packages/session-do-runtime/`
- `packages/storage-topology/`
- `packages/workspace-context-artifacts/`

## 3. 10 个 absorption units 总表

| Unit | 源对象 | 目标 worker | 类型 | 复杂度 | 代表 blueprint |
|---|---|---|---|---|---|
| A1 | `session-do-runtime` host shell | `agent-core` | host / deploy glue | 高 | 可选 |
| A2 | `agent-runtime-kernel` | `agent-core` | pure runtime core | 中 | 否 |
| A3 | `llm-wrapper` | `agent-core` | provider / stream adapter | 中 | 否 |
| A4 | `hooks` runtime residual | `agent-core` | hook dispatch / binding seam | 中 | 否 |
| A5 | `eval-observability` runtime sink & inspector seam | `agent-core` | evidence / trace plane | 中 | 否 |
| B1 | `capability-runtime` | `bash-core` | fake-bash / capability engine | 高 | **是** |
| C1 | `context-management` | `context-core` | budget / compact planner | 中 | 否 |
| C2 | `workspace-context-artifacts` context slice | `context-core` | context assembly / compact / snapshot | 高 | **是** |
| D1 | `workspace-context-artifacts` filesystem slice | `filesystem-core` | namespace / mounts / artifacts / backends | 高 | **是（与 C2 成对）** |
| D2 | `storage-topology` residual | `filesystem-core` | placement / refs / adapters | 中 | 否 |

## 4. 每个 unit 的落点说明

### A1 — `session-do-runtime` host shell → `agent-core`

- 主要内容：Worker/DO 壳、dual ingress、route/controller、remote binding factory、workspace/eval wiring
- 核心源码入口：
  - `packages/session-do-runtime/src/do/nano-session-do.ts`
  - `packages/session-do-runtime/src/session-edge.ts`
  - `packages/session-do-runtime/src/http-controller.ts`
  - `packages/session-do-runtime/src/ws-controller.ts`
  - `packages/session-do-runtime/src/composition.ts`
  - `packages/session-do-runtime/src/remote-bindings.ts`
  - `packages/session-do-runtime/src/worker.ts`
- 说明：这是 `agent-core` 的 host 壳，不等于把 `agent-runtime-kernel / llm-wrapper / hooks / eval` 一次性内联成一个文件夹。

### A2 — `agent-runtime-kernel` → `agent-core`

- 主要内容：single-active-turn reducer / scheduler / wait-resume / stream event mapping
- 说明：逻辑核心归 `agent-core`，但对外协议仍继续依赖 `nacp-session` / `nacp-core`

### A3 — `llm-wrapper` → `agent-core`

- 主要内容：canonical request、provider registry、ChatCompletions adapter、stream normalize
- 说明：属于 host worker 内部核心，不是独立 worker

### A4 — `hooks` runtime residual → `agent-core`

- 主要内容：matcher / dispatcher / service-binding hook runtime / outcome folding
- 说明：`hook.*` wire truth 仍留在协议层；runtime residual 跟 host worker 走

### A5 — `eval-observability` runtime seam → `agent-core`

- 主要内容：trace sink、inspector、timeline read、verdict aggregation 的 runtime use-site
- 说明：durable sink owner 更接近 host worker / DO，而不是单独 first-wave worker

### B1 — `capability-runtime` → `bash-core`

- 主要内容：planner、registry、policy、executor、fake-bash bridge、targets、capability handlers
- 核心特征：**直接跨包 import 很少，但语义耦合极强**
- 代表性原因：能代表“不是 graph 复杂，而是 capability surface / honest partial / policy discipline 复杂”的吸收模式

### C1 — `context-management` → `context-core`

- 主要内容：budget / async compact / inspector facade
- 说明：是 `context-core` 的 planner / orchestration 面

### C2 + D1 — `workspace-context-artifacts` split

- `C2` 归 `context-core`：`context-assembler`、`context-layers`、`compact-boundary`、`snapshot`、`redaction`
- `D1` 归 `filesystem-core`：`mounts`、`namespace`、`backends/*`、`paths`、`refs`、artifact / promotion 相关 substrate
- 混合点：`evidence-emitters.ts`
  - assembly / compact / snapshot evidence 更偏 `context-core`
  - artifact lifecycle evidence 更偏 `filesystem-core`
  - sink owner / durable persistence 仍由 `agent-core` / eval plane 接

### D2 — `storage-topology` → `filesystem-core`

- 主要内容：tenant/ref/key law、placement policy、DO/KV/R2 adapters、calibration seams
- 说明：它不是独立 runtime worker，更像 `filesystem-core` 的 semantics / placement layer

## 5. 依赖面观察

### 5.1 直接源码级耦合最明显的对象

1. `session-do-runtime` → `@nano-agent/nacp-core` / `@nano-agent/nacp-session` / `@nano-agent/workspace-context-artifacts`
2. `workspace-context-artifacts` → `@nano-agent/storage-topology`

### 5.2 语义耦合重于源码耦合的对象

1. `capability-runtime`
2. `agent-runtime-kernel`
3. `llm-wrapper`
4. `hooks`

这几类对象的 blueprint 难点更多在：

- protocol truth 对齐
- worker 壳中的 owner 划分
- partial / unsupported disclosure
- root integration tests 如何保留

而不是 package.json 里有多少 direct dependency。

## 6. 对 action-plan 的直接含义

这份 map 会把后续 action-plan 自然分成 4 组：

1. `agent-core` 组：A1-A5
2. `bash-core` 组：B1
3. `context-core` 组：C1-C2
4. `filesystem-core` 组：D1-D2

如果后续再写 action-plan，应该以**worker absorption group** 为单位，而不是按现在的 package 目录一份份机械复制。

## 7. 一句话 verdict

这份 map 已经把“包该去哪里”从模糊判断收窄成了 **9 个 package / 10 个 absorption units / 4 个目标 worker** 的稳定表；后续 worker-matrix 不应再重新辩论归宿，只需要沿着这张表做实现拆解。
