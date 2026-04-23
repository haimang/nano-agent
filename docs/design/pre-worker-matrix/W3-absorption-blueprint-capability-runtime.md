# Blueprint — `capability-runtime` → `workers/bash-core/`

> 类型：representative blueprint  
> 状态：pre-worker-matrix 可直接消费  
> 直接上游：`W3-absorption-map.md`、`W3-absorption-pattern.md`  
> 相关原始素材：
> - `packages/capability-runtime/package.json`
> - `packages/capability-runtime/src/index.ts`
> - `packages/capability-runtime/src/fake-bash/*`
> - `packages/capability-runtime/src/capabilities/*`
> - `packages/capability-runtime/src/targets/*`
> - `packages/capability-runtime/test/*`

## 1. 为什么它是代表性 blueprint

`capability-runtime` 不是因为 dependency graph 最复杂才适合当样本，而是因为它最能代表 nano-agent 在 worker 化时的一个核心难题：

**对外要保持 fake-bash compatibility surface，对内却必须继续是 typed capability runtime。**

它覆盖：

1. planner / command alias
2. registry / policy / permission
3. executor / target
4. filesystem / search / text / network / exec / vcs handlers
5. honest partial / unsupported / risk-blocked disclosure

因此，它是 `bash-core` 的最佳代表样本。

## 2. 当前代码事实

### 2.1 package-level reality

- `packages/capability-runtime/package.json`
  - 当前版本：`0.1.0`
  - scripts：`build` / `typecheck` / `test`
  - **`dependencies: {}`(实测零跨包运行时依赖)**；`devDependencies` 只有 `typescript` / `vitest` / `zod`
- public surface 由 `src/index.ts` 汇总导出
- **实测:`packages/capability-runtime/src/**` 与 `test/**` 均无任何 `@nano-agent/*` 或 `@haimang/*` 形式的 cross-package import**
- 这意味着 capability-runtime 的代表性来源 **不是** "跨包依赖最复杂",而是:
  1. fake-bash compatibility surface(外形维持)
  2. typed capability runtime 内核(policy / permission / executor)
  3. honest partial / unsupported / risk-blocked disclosure 纪律
  4. ~9473 LOC (src + test) 的体量(足以 battle-test pattern)
- 因此它代表的是 **单包内部的 "semantic coupling 重于 source coupling"**,而不是 "循环引用 / cross-worker seam 最复杂" 样本

### 2.2 关键源码锚点

| 职责 | 源路径 | 备注 |
|---|---|---|
| public API | `packages/capability-runtime/src/index.ts` | 导出全 package truth |
| planner | `packages/capability-runtime/src/planner.ts` | bash → structured plan |
| core runtime | `registry.ts` / `policy.ts` / `permission.ts` / `executor.ts` / `tool-call.ts` | `bash-core` 核心 |
| fake bash facade | `fake-bash/bridge.ts` / `fake-bash/commands.ts` / `fake-bash/unsupported.ts` | compatibility surface |
| capability handlers | `capabilities/*.ts` | search/network/exec/vcs 等 |
| execution targets | `targets/local-ts.ts` / `targets/service-binding.ts` / `targets/browser-rendering.ts` | local / remote / reserved seam |

## 3. 建议目标目录

```text
workers/bash-core/
  src/
    index.ts
    core/
      registry.ts
      policy.ts
      permission.ts
      executor.ts
      planner.ts
      tool-call.ts
      result.ts
      events.ts
      types.ts
      version.ts
      artifact-promotion.ts
    fake-bash/
      bridge.ts
      commands.ts
      unsupported.ts
    capabilities/
      filesystem.ts
      search.ts
      text-processing.ts
      network.ts
      exec.ts
      vcs.ts
      workspace-truth.ts
    targets/
      local-ts.ts
      service-binding.ts
      browser-rendering.ts
  test/
    ...package-local tests...
```

## 4. 文件映射建议

| 源路径 | 目标路径 | 方式 |
|---|---|---|
| `src/index.ts` | `workers/bash-core/src/index.ts` | 重写 exports，指向 worker 内部路径 |
| `src/planner.ts` | `src/core/planner.ts` | 原样迁移 |
| `src/registry.ts` 等 runtime core | `src/core/*` | 原样迁移 |
| `src/fake-bash/*` | `src/fake-bash/*` | 原样迁移 |
| `src/capabilities/*` | `src/capabilities/*` | 原样迁移 |
| `src/targets/*` | `src/targets/*` | 原样迁移 |
| `test/*` | `workers/bash-core/test/*` | 调整 import path 后迁移 |

## 5. 依赖处理原则

### 5.1 不跟着 absorb 的共享 contract

以下 truth 继续保持外部依赖或上游 contract，不内联复制：

1. `@haimang/nacp-core@1.4.0` / `@haimang/nacp-session@1.3.0`(W2 shipped;published under `@haimang/*` scope due to GitHub namespace 冲突)的 canonical wire truth
2. worker-matrix 之后可能形成的 service-binding transport profile(D07 激活时按 `CAPABILITY_WORKER` binding 形态落地;本 blueprint 不涉及 binding 激活)
3. workspace path / ref / tenant law 的 canonical上位约束(workspace-context-artifacts 的 split 由 D03/D04 / C2+D1 处理)

### 5.2 跟随 absorb 的内容

`capability-runtime` 内部的下列 owner 应直接归 `bash-core`：

1. command registry
2. fake-bash bridge
3. capability handlers
4. execution targets
5. policy / permission gate

### 5.3 不在本 blueprint 内解决的事情

1. 新增命令面
2. 扩大 `curl` / `ts-exec` / `git` 成熟度
3. 真正把 `browser-rendering` 做成 load-bearing target
4. 改写现有 `partial / unsupported` taxonomy

## 6. 测试继承方案

| 当前测试面 | 进入 `bash-core` 后的建议 |
|---|---|
| package-local unit tests | 迁到 `workers/bash-core/test/` |
| root cross tests | 继续保留在 root |
| optional dry-run smoke | 作为 `workers/bash-core` 独立 smoke |

特别说明：

- root contract / e2e tests 不应因为包吸收就全部搬走
- capability inventory / command surface drift guard 仍应在根测试层保留一份

## 7. 主要风险

1. **误把“direct deps 少”当成“迁移轻”**  
   实际难点在 command truth 与 honest partial discipline。

2. **把 `bash-core` 写成 shell 仿真器**  
   目标应继续是 typed capability runtime，不是补 POSIX 幻觉。

3. **顺手扩命令**  
   blueprint 只能搬当前 truth，不能在迁移时趁机加新 surface。

## 8. optional dry-run 如何使用这份 blueprint

若 owner 决定在 pre-worker-matrix 做 optional dry-run，则这份 blueprint 可直接作为落点说明：

1. `workers/bash-core/` 先建 deploy-shaped shell(W4 已完成)
2. `capability-runtime` 按本 blueprint 的目标目录落入 `src/`
3. package-local tests 与 worker-local build 证明结构可承载
4. 旧 `packages/capability-runtime/` 保持不删，只作为共存期来源

### 8.1 worker-matrix 下 P1.B / D02 消费本 blueprint 的要点(reality-check)

worker-matrix 阶段本 blueprint 是 P1.B / D02 的执行基线。进入 worker-matrix 后需在以下事实锚点上保持一致,blueprint 本身不改结构:

1. **real preview deploy 是 P2.E0 硬前置(per GPT R1)** — D02 §7.1 F6 已把 `pnpm --filter workers/bash-core run deploy:preview` 落为 B1 PR 收尾必过 gate,`curl <preview-url>/` 应返回含 `worker: "bash-core"` / `absorbed_runtime: true` / `nacp_core_version: "1.4.0"` / `nacp_session_version: "1.3.0"` 的合法 JSON。
2. **index.ts binding-first,不暴露 public HTTP RPC(per GPT R3 / D02 v0.2 F3)** — 本 blueprint §2.2 的 `fake-bash bridge` 与 `tool-call.ts` 仍保留 NACP `tool.call.*` body schema;但 bash-core 的 HTTP 入口固定为 `/capability/call` + `/capability/cancel`(与 `remote-bindings.ts::callBindingJson` byte-identical 对齐);不得自造 `/tool.call.request` 公开路径。
3. **`ServiceBindingTarget` 默认 service name 保持 `CAPABILITY_WORKER`** — D07 激活时不改字符串;本 blueprint §2.2 中 `targets/service-binding.ts` 的搬迁保持原常量。
4. **workspace substrate 共存期 import 保留 `@nano-agent/workspace-context-artifacts`** — D04 合并之前不切换来源;本 blueprint §5.3 的"新 consumer 切换" 归 D04 / C2+D1。

## 9. 一句话 verdict

这份 blueprint 已经足够支撑 `bash-core` 在 worker-matrix 里完成第一次真实吸收：难点不是“文件怎么挪”，而是**挪过去以后，仍严格保持 fake-bash 外形 + typed capability 内核 + honest partial 纪律不变。**
