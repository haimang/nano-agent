# bash.core — realized code evidence

> 目标：只基于当前代码与当前 closure truth，回答 `bash.core` 已经有什么、还缺什么。

---

## 0. 先给结论

**`bash.core` 当前最准确的代码判断是：worker shell 已 materialize；governed fake-bash engine 已在 `@nano-agent/capability-runtime` 中真实存在；host-side remote seam 也已存在；真正没完成的，是把 B1 吸收到 `workers/bash-core/` 并让该 shell 承接 live runtime。**

---

## 1. 当前最重要的代码锚点

| 层 | 路径 | 当前用途 |
|---|---|---|
| worker shell | `workers/bash-core/package.json`; `wrangler.jsonc`; `src/index.ts`; `test/smoke.test.ts` | 证明 deploy-shaped shell |
| fake-bash engine | `packages/capability-runtime/README.md`; `src/fake-bash/*`; `src/planner.ts`; `src/executor.ts`; `src/capabilities/*`; `src/targets/service-binding.ts` | 证明真实语义面 |
| host seam | `packages/session-do-runtime/src/env.ts`; `remote-bindings.ts` | 证明当前 host 已承认 capability remote seam |
| phase truth | `docs/issue/pre-worker-matrix/W4-closure.md`; `docs/design/pre-worker-matrix/W3-absorption-map.md`; `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md` | 证明当前 shell reality 与吸收目标 |

---

## 2. 已经真实存在的 worker shell

### 2.1 `workers/bash-core` 已是 deploy-shaped 目录

直接证据：

- `workers/bash-core/package.json:1-24`
- `workers/bash-core/wrangler.jsonc:1-22`
- `workers/bash-core/src/index.ts:1-22`
- `workers/bash-core/test/smoke.test.ts:1-26`

当前 shell 已真实具备：

1. `build / typecheck / test / deploy:dry-run / deploy:preview`
2. worker fetch handler
3. 对 NACP published truth 的 probe 输出
4. W4 matrix CI / dry-run 适配

### 2.2 但当前 shell 还没有吸收 engine

`workers/bash-core/src/index.ts:5-22` 当前只返回版本探针 JSON，没有：

1. command registry
2. fake-bash bridge
3. executor
4. service-binding handler
5. handlers / targets

因此当前 shell 必须诚实写成：

> **deploy shell exists, engine not yet absorbed**

---

## 3. 已经真实存在的 fake-bash engine 仍在 `capability-runtime`

### 3.1 package-level engine 已真实存在

最重要的当前代码锚点：

- `packages/capability-runtime/package.json:1-35`
- `packages/capability-runtime/README.md:1-151`

这说明：

1. `@nano-agent/capability-runtime@0.1.0` 是当前真实 engine package
2. 不是文档概念，也不是 test-only helper

### 3.2 canonical command truth 已冻结

当前最直接的单一真相源仍是：

- `packages/capability-runtime/src/fake-bash/commands.ts:16-314`

这里已经冻结：

1. 21-command surface
2. ask/allow policy
3. registry helper

### 3.3 bridge / planner / executor / targets 都已真实存在

当前 load-bearing 面至少包括：

| 组件 | 锚点 | 当前意义 |
|---|---|---|
| bridge | `packages/capability-runtime/src/fake-bash/bridge.ts` | no-silent-success、bash-shaped execute path |
| planner | `packages/capability-runtime/src/planner.ts` | narrow bash path、structured tool bridge |
| executor | `packages/capability-runtime/src/executor.ts` | requestId / cancel / timeout / streaming lifecycle |
| service-binding target | `packages/capability-runtime/src/targets/service-binding.ts:1-215` | remote execution seam |
| handlers | `packages/capability-runtime/src/capabilities/*` | filesystem/search/text/network/exec/vcs baseline |

这意味着 `bash.core` 当前不是“只差一点点 parser”，而是：

> **整台 governed fake-bash engine 都已经存在，只是还在 package 里。**

---

## 4. host 侧 remote seam 也已经是真实代码

当前 host substrate 已明确：

- `packages/session-do-runtime/src/env.ts:55-77`
- `packages/session-do-runtime/src/remote-bindings.ts:335-395`

也就是说：

1. `CAPABILITY_WORKER` binding slot 已存在
2. host 已会产出 `{ serviceBindingTransport }` capability handle

因此当前最准确的状态不是“remote path 还没开始”，而是：

> **remote seam exists; worker shell has not yet absorbed the engine behind it.**

---

## 5. W3/W4 之后，`bash.core` 的代码真相应该怎么写

| 维度 | 当前真相 | 不应写成什么 |
|---|---|---|
| worker shell | 已存在，dry-run 已过 | 还没有独立 worker 目录 |
| fake-bash engine | 已存在于 `capability-runtime` | 还是纯概念或 prompt 幻觉层 |
| remote seam | 已存在 | 还没有 tool/cancel/progress transport 基线 |
| absorbed runtime | 仍未进入 `workers/bash-core/src/` | W4 shell 已是完整 bash worker |
| full shell grammar | 明确不在当前真相内 | 可以顺势扩成 POSIX shell |

---

## 6. 对 r2 的直接含义

从 realized code evidence 角度看，`bash.core` 的工作描述现在应写成：

1. **吸收 B1 capability-runtime**
2. **保持 21-command governed subset 不漂移**
3. **把现有 `tool.call.*` / service-binding seam 带入 worker shell**
4. **让 `workers/bash-core` 从 probe shell 升级成真实 capability worker**

这与 W3 blueprint 完全一致：`docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md:58-170`

---

## 7. 本文件的最终判断

**`bash.core` 现在已经拥有“可部署的壳”“可吸收的引擎”“可复用的 remote seam”，但还没有完成三者合流。**

因此 worker-matrix r2 的主任务不是“证明 bash-core 值得做”，而是：

> **完成 B1 absorption，并把当前 shell 提升成真实 governed fake-bash worker。**
