# Blueprint — `agent-runtime-kernel` → `workers/agent-core/src/kernel/`

> 类型：on-demand absorption blueprint(非代表,P0 补齐)
> 状态：draft(worker-matrix P0 Phase 2 产出)
> 直接上游：
> - `docs/design/pre-worker-matrix/W3-absorption-map.md`(A2 归属)
> - `docs/design/pre-worker-matrix/W3-absorption-pattern.md`(10 disciplines)
> - `docs/design/pre-worker-matrix/TEMPLATE-absorption-blueprint.md`(母本)
> - `docs/design/worker-matrix/D01-agent-core-absorption.md`(A1-A5 聚合设计)
> 相关原始素材：
> - `packages/agent-runtime-kernel/package.json`
> - `packages/agent-runtime-kernel/src/index.ts`
> - `packages/agent-runtime-kernel/src/{runner,reducer,scheduler,interrupt,state,step,types,events,errors,delegates,message-intents,session-stream-mapping,checkpoint,version}.ts`
> - `packages/agent-runtime-kernel/test/{checkpoint,events,interrupt,message-intents,reducer,runner,scheduler}.test.ts`

---

## 1. 这个 blueprint 解决什么问题

1. agent-runtime-kernel 是 `agent.core` 的 turn-loop 纯逻辑内核(state machine + step scheduler + reducer),不涉及 WebSocket / DO / HTTP / KV / R2;它与 A1 host shell 解耦,但被 A1 host shell 的 turn loop 消费,是 D07 "live agent turn loop" 的执行骨架。
2. 它代表的是 **"零跨包依赖 / 纯 TypeScript / 全 deterministic / test 覆盖密集"** 的 absorption 难度 — 同 B1 一样属于 "source coupling 轻、semantic coupling 重" 样本,但规模更小(~3017 LOC;B1 ~9473 LOC)。
3. 进入 worker-matrix 时,这份 blueprint 让 P1.A / A2 sub-PR 作者少想:
   - 源文件 → 目标文件的映射表(15 src + 7 test 文件)
   - public API aggregator(`index.ts`)应如何在 `workers/agent-core/src/kernel/index.ts` 重建
   - 共存期内 `agent-runtime-kernel` 是否可以与新位置并存(结论:**可以**,但 host shell 的 `runner` import 路径必须在同一 sub-PR 内完成切换)
   - 哪些 test 必须迁走、哪些(暂未出现)root-level test 仍应保留在 root

---

## 2. 当前代码事实与源路径

### 2.1 package-level 事实

- `package.json` 关键信息:
  - 名称:`@nano-agent/agent-runtime-kernel`
  - 版本:`0.1.0`
  - scripts:`build` / `typecheck` / `test` / `test:coverage`
  - **`dependencies` 字段不存在 / 等价零 runtime 依赖**;`peerDependencies.zod >= 3.22.0`;`devDependencies: typescript / vitest / zod`
- **实测:`src/**` 与 `test/**` 内零 `@nano-agent/*` 或 `@haimang/*` 跨包 import**(已 grep 验证)
- public surface 由 `src/index.ts`(100 行)汇总导出 15 类 named / type exports
- 实测 LOC:src ~1659 / test ~1358 / 合计 ~3017(不含 test/scenarios/ 目录体量)

### 2.2 核心源码锚点

| 职责 | 源路径 | 备注 |
|------|--------|------|
| public API aggregator | `packages/agent-runtime-kernel/src/index.ts` | 15 named + type exports;搬后在 `workers/agent-core/src/kernel/index.ts` 复现 |
| kernel version constant | `src/version.ts` | `KERNEL_VERSION` 常量;搬后保持 |
| state machine types | `src/types.ts` | zod schemas:`KernelPhaseSchema` / `StepKindSchema` / `StepDecisionSchema` / `RuntimeEventSchema` / `InterruptReasonSchema` + `LlmChunk` / `CapabilityChunk` 联合类型 |
| kernel state | `src/state.ts` | `KernelSnapshot` 定义 |
| step primitives | `src/step.ts` | `KernelStepSchema` / `KernelStep` |
| reducer | `src/reducer.ts` | `applyAction(snapshot, action)` + `KernelAction` 类型 |
| scheduler | `src/scheduler.ts` | `scheduleNextStep(signals)` + `SchedulerSignals` |
| interrupt | `src/interrupt.ts` | `classifyInterrupt / canResumeFrom` + `InterruptClassification` |
| runner | `src/runner.ts` | `KernelRunner` class + `AdvanceStepResult` — turn loop 主体 |
| events | `src/events.ts` | `RuntimeEvent → SessionStream` 事件 emit |
| session-stream-mapping | `src/session-stream-mapping.ts` | `RUNTIME_TO_STREAM_MAP` 静态表 |
| message intents | `src/message-intents.ts` | `intentForStep` + `MessageIntent` |
| kernel error taxonomy | `src/errors.ts` | `KernelError` class + `KERNEL_ERROR_CODES` + `KernelErrorCode` type |
| delegates | `src/delegates.ts` | `KernelDelegates` 接口 — host 注入的 llm / capability / tools 委托 |
| checkpoint | `src/checkpoint.ts` | `KernelCheckpointFragment` + checkpoint-read/write helpers |
| tests | `test/{checkpoint,events,interrupt,message-intents,reducer,runner,scheduler}.test.ts` + `test/scenarios/` | package-local 覆盖全 src |

---

## 3. 目标落点

### 3.1 建议目录结构

```text
workers/agent-core/
  src/
    kernel/
      index.ts                 # A2 public API aggregator(package-local 1:1 复现 packages/agent-runtime-kernel/src/index.ts)
      version.ts
      types.ts
      state.ts
      step.ts
      reducer.ts
      scheduler.ts
      interrupt.ts
      runner.ts                # KernelRunner 主体;被 host shell 的 do/nano-session-do.ts 消费
      events.ts
      session-stream-mapping.ts
      message-intents.ts
      errors.ts
      delegates.ts             # KernelDelegates interface — A3 / A4 / A5 实现该接口
      checkpoint.ts
  test/
    kernel/
      checkpoint.test.ts
      events.test.ts
      interrupt.test.ts
      message-intents.test.ts
      reducer.test.ts
      runner.test.ts
      scheduler.test.ts
      scenarios/...
```

### 3.2 文件映射表

| 源文件 / 目录 | 目标文件 / 目录 | 搬迁方式 | 备注 |
|---------------|------------------|----------|------|
| `packages/agent-runtime-kernel/src/index.ts` | `workers/agent-core/src/kernel/index.ts` | 重建 exports;byte-identical | 对外 public API 不变 |
| `src/version.ts` | `kernel/version.ts` | 原样迁移 | `KERNEL_VERSION` 不 bump |
| `src/types.ts` | `kernel/types.ts` | 原样迁移 | zod schemas 不改 shape |
| `src/state.ts` | `kernel/state.ts` | 原样迁移 | |
| `src/step.ts` | `kernel/step.ts` | 原样迁移 | |
| `src/reducer.ts` | `kernel/reducer.ts` | 原样迁移 | |
| `src/scheduler.ts` | `kernel/scheduler.ts` | 原样迁移 | |
| `src/interrupt.ts` | `kernel/interrupt.ts` | 原样迁移 | |
| `src/runner.ts` | `kernel/runner.ts` | 原样迁移 | 被 A1 host shell 消费 |
| `src/events.ts` | `kernel/events.ts` | 原样迁移 | |
| `src/session-stream-mapping.ts` | `kernel/session-stream-mapping.ts` | 原样迁移 | |
| `src/message-intents.ts` | `kernel/message-intents.ts` | 原样迁移 | |
| `src/errors.ts` | `kernel/errors.ts` | 原样迁移 | |
| `src/delegates.ts` | `kernel/delegates.ts` | 原样迁移 | `KernelDelegates` interface — A3 llm / A4 hooks / A5 eval 实装 |
| `src/checkpoint.ts` | `kernel/checkpoint.ts` | 原样迁移 | |
| `test/*.test.ts` + `test/scenarios/` | `workers/agent-core/test/kernel/...` | 调整 import path 后迁移 | 仅改相对 import;fixture / scenarios 一并搬 |

---

## 4. 依赖与 import 处理

### 4.1 保留为 package dependency(不跟 absorb)

- `zod`:保持 peer dependency(host shell `workers/agent-core/package.json` 已保留;A2 sub-PR 不新增)
- 无其他外部包依赖 — A2 是零 runtime dep absorption

### 4.2 跟随 absorb 一起内化

- 上面 §3.2 全部 15 src + 7 test 文件 + `test/scenarios/` 目录
- **不**内化 A1 host shell(composition / controllers / routes / DO / workspace bridge) — A1 由独立 sub-PR 搬
- **不**内化 A3 llm-wrapper / A4 hooks / A5 eval-observability — 它们实装 `KernelDelegates` 接口,是独立 sub-PR

### 4.3 不在本 blueprint 内解决

- A2 完成后,host shell 如何在 `KernelRunner` 之上装配 delegates(归 D01 F3 host composer)
- `KernelDelegates` 接口的三个实装(llm / hooks / eval)分别归 A3 / A4 / A5
- checkpoint 的 KV / R2 持久化 runtime glue(归 D04 / D06 storage posture)

---

## 5. 测试与验证继承

| 当前测试面 | 进入 worker 后如何继承 |
|------------|------------------------|
| package-local unit tests(checkpoint / events / interrupt / message-intents / reducer / runner / scheduler)| 1:1 迁到 `workers/agent-core/test/kernel/` 下同名文件;仅改相对 import |
| `test/scenarios/` 里的多 step turn-loop 场景 | 随 unit tests 一起迁;保持 fixture 相对路径 |
| root cross-tests(目前无;将来若加,按 B7 LIVE 纪律)| 不迁 — 继续留 root `test/` |

实测 root `test/` 目录并无 A2 专属测试;A2 的所有 test 覆盖集中在 package 内,迁移后由 worker-local `pnpm --filter workers/agent-core test -- kernel/...` 运行。

---

## 6. 风险与禁止事项

### 6.1 主要风险

1. **import 路径漂移**:`runner.ts` 对 `state.ts` / `reducer.ts` / `scheduler.ts` 的相对 import 路径必须在搬家时同步 — 已观察 runner.ts 7 条 import 全部相对,不涉及跨包。
2. **`KERNEL_VERSION` 被误 bump**:搬家 ≠ 升级;A2 sub-PR 内不得修改 version.ts。
3. **test 文件里 hard-coded 相对路径**:`test/scenarios/` 内的 fixture 若有 `../src/...` 相对 import,迁移时必须同步。
4. **host shell 在共存期引用两份 kernel**:A2 sub-PR 必须在合并时把 host shell 的 `KernelRunner` import 指向 `workers/agent-core/src/kernel/runner.js`;不得出现 A1 merge 后 host 仍 import `@nano-agent/agent-runtime-kernel` 的 drift。
5. **D05 F4 helper 被误接到 kernel**:`appendInitialContextLayer` 是 **context-core** 侧 helper,不归 A2;A2 sub-PR 不得新增 context 相关 surface。

### 6.2 明确禁止

1. 把 blueprint 写成 action-plan checklist(本 blueprint 只给落点,不给命令序列)
2. A2 sub-PR 内顺手重构 reducer / runner API(保持 byte-identical)
3. A2 sub-PR 内新增 zod schema / kernel event 类型(归独立 charter)
4. A2 sub-PR 内删除 `packages/agent-runtime-kernel/`(deprecation 归 D09)

---

## 7. 收口证据

1. **源路径列表**:`packages/agent-runtime-kernel/src/{15 files}` + `test/{7 files + scenarios/}`
2. **目标路径列表**:`workers/agent-core/src/kernel/{15 files}` + `workers/agent-core/test/kernel/{7 files + scenarios/}`
3. **依赖处理说明**:零 runtime dep;`zod` 保持 peerDependency;host shell 的 kernel runner import 路径改写
4. **测试迁移说明**:package-local 7 个 test 文件 1:1 迁;root 目前无 kernel 专属测试
5. **optional / deferred 项声明**:
   - `KernelDelegates` 三个实装(llm / hooks / eval)归 A3 / A4 / A5
   - checkpoint 的 KV / R2 持久化 runtime glue 归后续设计

---

## 8. LOC 与工作量估算

| 维度 | 估算值 | 依据 |
|------|--------|------|
| 源 LOC | ~1659 | wc -l src/*.ts |
| 测试 LOC | ~1358(不含 scenarios/)| wc -l test/*.test.ts |
| 搬家工作量 | **S-M** | 文件数 22 + scenarios 目录;单 sub-PR 可机械完成 |
| 预估时长 | 1-2 工作日(含 PR review 往返)| B1 代表 9473 LOC 单 PR ≈ 1.5 工作日;A2 规模更小 |
| 关键风险项 | host shell 共存期 import | 需在同一 sub-PR 内切换 |

---

## 9. 一句话 verdict

A2 是 P1.A sub-PR 序列里 **最机械、最 deterministic** 的一环:零跨包依赖 / 15 src 1:1 映射 / 7 test 1:1 迁 / `KernelDelegates` 接口保持不变。A2 合并后,A3 / A4 / A5 可以各自独立 sub-PR 实装 delegates;A1 host shell 在合并同一 sub-PR 窗口内切 kernel import 路径即可完成共存期关闭。
