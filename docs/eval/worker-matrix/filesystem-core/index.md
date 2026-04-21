# filesystem.core 上下文索引

> 状态：`curated / rewritten`
> 目标：作为 `docs/eval/worker-matrix/filesystem-core/` 的入口索引，同时提供**原始素材召回路径**、**范围边界**、**当前结论**与**阅读顺序**。

---

## 0. 一句话结论

**`filesystem.core` 不是一个已经独立部署完成的 filesystem worker，而是一组已经真实存在、且相当有力的 filesystem substrate：它今天最可信的核心是 `MountRouter + WorkspaceNamespace + Memory/ReferenceBackend + tenant/ref/key law + fake-bash file/search/vcs consumer`；第一波应把它当作 host-local workspace/storage foundation，而不是误写成“完整 KV/D1/R2 文件系统服务”。**

---

## 1. In-Scope / Out-of-Scope

### 1.1 In-Scope

本目录只负责回答下面四类问题：

| 项目 | 说明 |
|---|---|
| `filesystem.core` 的定位 | 它到底是独立 worker，还是 mount-based workspace/storage substrate |
| `filesystem.core` 的协议责任 | 它今天拥有哪些 `NacpRef / tenant / path / reserved namespace` 法则 |
| `filesystem.core` 的当前代码真相 | 当前仓库里已经有哪些 namespace/backend/adapter/consumer/runtime use-site |
| `filesystem.core` 的平台边界 | DO / R2 / KV / `_platform/` / service binding / just-bash 对它的直接约束 |

### 1.2 Out-of-Scope

本目录**不**承担下面这些工作：

| 项目 | 为什么不在这里做 |
|---|---|
| 设计 `agent.core / context.core / bash.core` 的全部细节 | 它们各自需要独立上下文包 |
| 把 `filesystem.core` 写成完整 POSIX/Linux 文件系统 | 这与当前 Worker/V8 isolate 路线和 fake-bash 边界冲突 |
| 重写 B2/B3/A8-A10 原始历史文档 | 原始文档仍是历史审计路径，本目录只做聚合与裁判 |
| 提前冻结完整 KV/D1/R2 production topology | 当前代码和原始评估都表明这仍应保持 evidence-driven / provisional |

---

## 2. 证据优先级

本目录采用下面这条优先级：

1. **当前仓库源码与当前测试**
2. **原始 action-plan / review / evaluation 文档**
3. **`context/` 下的参考实现**
4. **较早的 closure 口径**

这条优先级在 `filesystem.core` 上尤其重要，因为：

- GPT/Opus 的 worker-matrix 原始评估都把它写成“可做，但平台适配层未闭合”：`docs/eval/after-foundations/worker-matrix-eval-with-GPT.md:230-295`; `docs/eval/after-foundations/worker-matrix-eval-with-Opus.md:226-248`
- 但这些评估写作时，`ReferenceBackend` 还没有今天这么前进；当前代码已经具备 connected mode + R2 promotion：`packages/workspace-context-artifacts/src/backends/reference.ts:7-29,58-80,120-140`
- 因此这里必须以**当前代码真相**裁判“哪些已经成立、哪些仍不能写满”。

---

## 3. 原始素材总索引

> 下面列的都是**原始路径**，不是 `docs/eval/worker-matrix/00-context/` 里的复制品。

### 3.1 原始文档素材

| 类型 | 原始路径 | 关键行 / 章节 | 为什么必读 |
|---|---|---|---|
| evaluation | [`docs/eval/after-foundations/worker-matrix-eval-with-GPT.md`](../../../eval/after-foundations/worker-matrix-eval-with-GPT.md) | `230-295` | GPT 对 `filesystem.core` 的原始判断：必要，但真实状态仍是“需要补平台适配层” |
| evaluation | [`docs/eval/after-foundations/worker-matrix-eval-with-Opus.md`](../../../eval/after-foundations/worker-matrix-eval-with-Opus.md) | `226-248` | Opus 的原始判断：第一波只建议做 memory + R2，不要把 KV/D1 写满 |
| action-plan | [`docs/action-plan/after-foundations/B2-storage-adapter-hardening.md`](../../../action-plan/after-foundations/B2-storage-adapter-hardening.md) | `41-59,153-167,207-214` | B2 说明 filesystem foundations 的平台侧来源：DO/R2/KV/D1 adapters、ReferenceBackend、MemoryBackend cap 对齐 |
| action-plan | [`docs/action-plan/after-foundations/B3-fake-bash-extension-and-port.md`](../../../action-plan/after-foundations/B3-fake-bash-extension-and-port.md) | `40-57,148-173` | B3 说明 fake-bash 如何正式消费 filesystem truth，而不是重新发明 shell FS |
| action-plan | [`docs/action-plan/after-skeleton/A8-minimal-bash-search-and-workspace.md`](../../../action-plan/after-skeleton/A8-minimal-bash-search-and-workspace.md) | `24-39,88-112,142-167` | A8 冻结 workspace truth、canonical `rg`、`grep -> rg`、`mkdir` partial、reserved namespace |
| action-plan | [`docs/action-plan/after-nacp/workspace-context-artifacts.md`](../../../action-plan/after-nacp/workspace-context-artifacts.md) | `28-50,145-159,163-184,224-242,248-250` | workspace data plane 的原始 scope、`/_platform/` 保留位、artifact/context/snapshot 责任边界 |
| action-plan | [`docs/action-plan/after-nacp/storage-topology.md`](../../../action-plan/after-nacp/storage-topology.md) | `29-47,154-175,181-187,229-242` | storage semantics 的原始 scope、`NacpRef`/tenant law、provisional placement、evidence calibration |

### 3.2 当前仓库代码素材

| 类型 | 原始路径 | 关键行 | 为什么必读 |
|---|---|---|---|
| workspace package README | [`packages/workspace-context-artifacts/README.md`](../../../../packages/workspace-context-artifacts/README.md) | `17-64` | 证明 workspace package 的 in-scope / out-of-scope 已冻结 |
| storage package README | [`packages/storage-topology/README.md`](../../../../packages/storage-topology/README.md) | `18-63` | 证明 storage-topology 是 semantics library，不是 runtime orchestrator |
| capability package README | [`packages/capability-runtime/README.md`](../../../../packages/capability-runtime/README.md) | `20-93` | 证明 fake-bash 当前真实消费面与 target readiness |
| mount router | [`packages/workspace-context-artifacts/src/mounts.ts`](../../../../packages/workspace-context-artifacts/src/mounts.ts) | `1-10,58-85,115-157` | 证明 longest-prefix routing + `/_platform/` reserved namespace 已真实存在 |
| namespace | [`packages/workspace-context-artifacts/src/namespace.ts`](../../../../packages/workspace-context-artifacts/src/namespace.ts) | `17-27,33-39,45-56,62-80,86-120` | 证明统一 file ops surface 已存在 |
| backends | [`packages/workspace-context-artifacts/src/backends/memory.ts`](../../../../packages/workspace-context-artifacts/src/backends/memory.ts) / [`reference.ts`](../../../../packages/workspace-context-artifacts/src/backends/reference.ts) | `9-19,29-39,68-78` / `7-29,58-80,120-140,180-197` | 证明 memory backend 对齐 DO cap；ReferenceBackend 现已支持 connected mode + R2 promotion |
| artifact refs | [`packages/workspace-context-artifacts/src/refs.ts`](../../../../packages/workspace-context-artifacts/src/refs.ts) / [`promotion.ts`](../../../../packages/workspace-context-artifacts/src/promotion.ts) | `4-21,68-96,113-166` / `21-33,107-143` | 证明 artifact refs 已对齐 `NacpRef` 语义，promotion 会在 `do-storage` 与 `r2` 间按大小分层 |
| snapshot | [`packages/workspace-context-artifacts/src/snapshot.ts`](../../../../packages/workspace-context-artifacts/src/snapshot.ts) | `122-184,188-232` | 证明 snapshot builder 真实读取 mount/fileIndex/artifactRefs |
| storage keys/refs | [`packages/storage-topology/src/keys.ts`](../../../../packages/storage-topology/src/keys.ts) / [`refs.ts`](../../../../packages/storage-topology/src/refs.ts) | `17-32,38-64,70-85` / `31-53,67-79,128-166` | 证明 key/ref/tenant law 已冻结，且 `_platform` 例外只在 `KV_KEYS.featureFlags()` |
| placement/calibration | [`packages/storage-topology/src/placement.ts`](../../../../packages/storage-topology/src/placement.ts) / [`calibration.ts`](../../../../packages/storage-topology/src/calibration.ts) | `22-57,98-120,157-207` / `14-18,75-171,177-240` | 证明 placement 仍是 provisional + MIME-gated + evidence-driven |
| real adapters | [`packages/storage-topology/src/adapters/do-storage-adapter.ts`](../../../../packages/storage-topology/src/adapters/do-storage-adapter.ts) / [`r2-adapter.ts`](../../../../packages/storage-topology/src/adapters/r2-adapter.ts) | `73-178` / `63-187` | 证明 DO size guard/transaction 与 R2 cursor walk/parallel put 已真实实现 |
| fake-bash consumers | [`packages/capability-runtime/src/capabilities/filesystem.ts`](../../../../packages/capability-runtime/src/capabilities/filesystem.ts) / [`workspace-truth.ts`](../../../../packages/capability-runtime/src/capabilities/workspace-truth.ts) / [`search.ts`](../../../../packages/capability-runtime/src/capabilities/search.ts) / [`vcs.ts`](../../../../packages/capability-runtime/src/capabilities/vcs.ts) | `4-20,102-237` / `11-30,32-57,60-157` / `4-25,74-205` / `4-23,34-50,110-170` | 证明 file/search/vcs 已真实消费同一 workspace/path universe |
| runtime use-site | [`packages/session-do-runtime/src/workspace-runtime.ts`](../../../../packages/session-do-runtime/src/workspace-runtime.ts) / [`packages/session-do-runtime/src/do/nano-session-do.ts`](../../../../packages/session-do-runtime/src/do/nano-session-do.ts) | `1-18,45-62,75-100` / `282-307` | 证明默认 DO 路径会本地装配 workspace trio，而不是完全空缺 |
| non-ready remote seam | [`packages/session-do-runtime/src/composition.ts`](../../../../packages/session-do-runtime/src/composition.ts) / [`remote-bindings.ts`](../../../../packages/session-do-runtime/src/remote-bindings.ts) | `82-106` / `385-395` | 证明 `filesystem.core` 仍未形成独立 remote worker 默认接线 |

### 3.3 当前测试素材

| 类型 | 原始路径 | 关键行 | 为什么必读 |
|---|---|---|---|
| mount routing | [`packages/workspace-context-artifacts/test/mounts.test.ts`](../../../../packages/workspace-context-artifacts/test/mounts.test.ts) | `71-139,160-192` | 证明 longest-prefix + `/_platform/` reserved namespace 已被回归锁定 |
| namespace CRUD | [`packages/workspace-context-artifacts/test/namespace.test.ts`](../../../../packages/workspace-context-artifacts/test/namespace.test.ts) | `33-109,112-212,214-220` | 证明 read/write/list/stat/delete 与 readonly law 已被锁定 |
| memory cap | [`packages/workspace-context-artifacts/test/backends/memory.test.ts`](../../../../packages/workspace-context-artifacts/test/backends/memory.test.ts) | `196-217` | 证明 MemoryBackend 1 MiB mirror cap 与 `ValueTooLargeError` 真实成立 |
| reference backend | [`packages/workspace-context-artifacts/test/backends/reference.test.ts`](../../../../packages/workspace-context-artifacts/test/backends/reference.test.ts) | `114-141,144-210,213-278` | 证明 not-connected 占位模式、connected CRUD、R2 promotion、cleanup 都有测试 |
| integration | [`packages/workspace-context-artifacts/test/integration/fake-workspace-flow.test.ts`](../../../../packages/workspace-context-artifacts/test/integration/fake-workspace-flow.test.ts) | `36-78` | 证明 mount + namespace + artifact ref + snapshot 已形成端到端闭环 |
| DO adapter | [`packages/storage-topology/test/adapters/do-storage-adapter.test.ts`](../../../../packages/storage-topology/test/adapters/do-storage-adapter.test.ts) | `133-197,199-264` | 证明 DO size pre-check 与 transaction semantics 已锁定 |
| R2 adapter | [`packages/storage-topology/test/adapters/r2-adapter.test.ts`](../../../../packages/storage-topology/test/adapters/r2-adapter.test.ts) | `137-195,198-243` | 证明 R2 cursor walking、`listAll()`、`putParallel()` 已锁定 |

### 3.4 `context/` 参考实现素材

| 类型 | 原始路径 | 关键行 | 为什么必读 |
|---|---|---|---|
| mountable fs README | [`context/just-bash/README.md`](../../../../context/just-bash/README.md) | `151-220` | 说明 `MountableFs` 的统一命名空间心智与它的本地/overlay/readwrite 设定 |
| mount router 实现 | [`context/just-bash/src/fs/mountable-fs/mountable-fs.ts`](../../../../context/just-bash/src/fs/mountable-fs/mountable-fs.ts) | `49-62,85-99,181-221` | 说明 longest-prefix routePath 的原始来源 |
| mount tests | [`context/just-bash/src/fs/mountable-fs/mountable-fs.test.ts`](../../../../context/just-bash/src/fs/mountable-fs/mountable-fs.test.ts) | `66-123,126-167,169-233` | 说明它还包含 root/baseFs/nested mount/virtual dir/mkdir 等更完整 FS 心智 |
| security tests | [`context/just-bash/src/fs/mountable-fs/mountable-fs.security.test.ts`](../../../../context/just-bash/src/fs/mountable-fs/mountable-fs.security.test.ts) | `18-67,70-154` | 说明 just-bash 的 mount model 还处理 symlink/cross-mount/path traversal 风险 |
| threat model | [`context/just-bash/THREAT_MODEL.md`](../../../../context/just-bash/THREAT_MODEL.md) | `279-304` | 说明 just-bash 还包含 Python/HTTPFS `/host`/`/_jb_http` 这类我们当前不应照搬的执行模型 |

---

## 4. 当前应冻结的五个判断

| 判断 | 结论 | 主证据 |
|---|---|---|
| `filesystem.core` 的身份 | **mount-based workspace/storage substrate，不是已独立部署的 filesystem worker** | `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md:234-295`; `packages/session-do-runtime/src/composition.ts:82-106`; `packages/session-do-runtime/src/remote-bindings.ts:385-395` |
| 当前最扎实的代码面 | **`MountRouter + WorkspaceNamespace + MemoryBackend + ReferenceBackend`** | `packages/workspace-context-artifacts/src/mounts.ts:58-85`; `namespace.ts:17-120`; `backends/memory.ts:54-78`; `backends/reference.ts:120-140` |
| 当前最真实的外部消费面 | **fake-bash 的 file/search/vcs handlers 已经统一消费同一 workspace/path truth** | `packages/capability-runtime/src/capabilities/filesystem.ts:4-20,102-237`; `workspace-truth.ts:11-30,60-157`; `search.ts:4-25,74-205`; `vcs.ts:4-23,110-170` |
| 当前平台/storage 判断 | **DO/R2 adapters 真实存在，但 placement/topology 仍是 provisional/evidence-driven；`_platform` 只允许极窄例外** | `packages/storage-topology/src/adapters/do-storage-adapter.ts:73-178`; `r2-adapter.ts:63-187`; `placement.ts:22-57,98-120`; `keys.ts:38-64` |
| 第一波 worker-matrix 建议 | **按“host-local workspace + memory/DO/R2 seam + fake-bash consumer”推进，先不要把 KV/D1/独立 remote filesystem worker 写满** | `docs/eval/after-foundations/worker-matrix-eval-with-Opus.md:226-248`; `packages/workspace-context-artifacts/README.md:49-64`; `packages/storage-topology/README.md:52-63` |

---

## 5. 推荐阅读顺序

1. **先读** `realized-code-evidence.md`  
   先把“现在仓库里到底已经有什么”读清楚，避免把 `filesystem.core` 当成 greenfield。

2. **再读** `internal-nacp-compliance.md`  
   它解释 filesystem 相关的 `NacpRef / tenant / key / reserved namespace` 法则到底由谁拥有。

3. **再读** `external-contract-surface.md`  
   它解释 fake-bash、workspace package、storage package、session runtime 之间的真正接线关系。

4. **最后读** `cloudflare-study-evidence.md`  
   它把 B2/B3/A8 与 `just-bash`/Cloudflare 约束结合起来，说明为什么第一波必须薄做。

---

## 6. 当前仍然开放的关键缺口

| 缺口 | 当前状态 | 是否阻止 `filesystem.core` 继续建模 |
|---|---|---|
| 独立 `filesystem.core` worker deploy shell | 仍不存在 | **不阻止建模，但阻止“已独立部署”判断** |
| remote/service-binding workspace seam | `remote-bindings` 仍返回 `workspace: undefined` | **不阻止 host-local first-wave，但阻止 remote closure 宣称** |
| `mkdir` fully supported | 仍是 `partial-with-disclosure` | **不阻止基础 substrate 成立，但阻止把 fake-bash FS 写成完整 POSIX** |
| `git` baseline | 只读 `status/diff/log`，且 `diff/log` 仍是 honest partial | **不阻止 filesystem substrate 建模，但阻止把 VCS 当成成熟子系统** |
| KV/D1 full runtime placement | 仍应保持 provisional / evidence-driven | **不阻止继续推进，但阻止过早冻结“完整文件系统服务”叙事** |

---

## 7. 本索引的使用方式

如果后续要继续编写 `worker-matrix` 的 `filesystem.core` 设计文档，建议把本目录当成下面这三件事的 SSOT：

1. **原始素材召回入口**：先沿着这里的原始路径回到 evaluation / action-plan / code / context 本体；
2. **当前真相裁判**：遇到旧评估口径与当前代码冲突时，以这里列出的当前代码锚点为准；
3. **边界保护器**：任何把 `filesystem.core` 写成“已经拥有完整 KV/D1/R2 runtime filesystem”“已经独立 remote 化”的设计，都应视为越界。
