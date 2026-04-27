# Legacy Test and Package Deprecation by GPT

## 0. 结论先行

这次专项调查的结论很明确：

1. **在当前 6-workers 结构里，除了两个 GitHub 发布的 NACP 协议包之外，仍然存在真实的 `packages/` 引用残留。**
2. **目前不能安全删除 `nacp-*` 之外的全部 package。**
3. **在当前阶段，`test-legacy/` 也不能全面淘汰并直接删除。**

更准确地说，ZX3 不应把目标表述成“清空 packages/ + 删除 test-legacy/”，而应表述成：

- **把真正的协议层收敛到最小 canonical 集合**
- **把仍然 load-bearing 的 helper/contract 包迁走**
- **把 `test-legacy/` 中仍有价值的 root guardians 与共享 fixture 迁入新的 canonical `test/` 树**
- **最后再做物理删除**

## 1. 对 3 个问题的直接回答

| 问题 | 结论 | 简短说明 |
|---|---|---|
| 1. 6-workers 中，除了两个 GitHub package 通讯协议外，是否还有 package 引用残留 | **有** | 至少还有 `orchestrator-auth-contract`、`workspace-context-artifacts`、`storage-topology` 的真实残留 |
| 2. 是否可以安全退役并删除 nacp 之外的全部 package | **不可以** | 有些包已经 absorbed 但仍有 runtime/test consumer；有些包仍是 worker build 的直接依赖 |
| 3. 全面转向新 `test/` 后，`test-legacy/` 现在是否可以全面淘汰并删除 | **不可以** | root scripts、root guardians、共享 fixture、文档口径都还依赖它 |

## 2. 问题一：6-workers 里是否还有对 `packages/` 的残留引用

### 2.1 简答

**有，而且不是只有一处。**

当前 6-workers 结构下，除了 `@haimang/nacp-core` 与 `@haimang/nacp-session` 这两个 GitHub 发布协议包，至少还有下面这些真实依赖：

1. `@haimang/orchestrator-auth-contract`
2. `@nano-agent/workspace-context-artifacts`
3. `@nano-agent/storage-topology`

此外，还存在 **通过 worker package export** 的共享代码依赖，例如 `agent-core` 直接消费 `@haimang/context-core-worker/context-api/append-initial-context-layer`。

### 2.2 直接证据

#### A. `orchestrator-auth-contract` 仍是 load-bearing

- `orchestrator-core` 直接 import：`workers/orchestrator-core/src/index.ts:1-3`
- `orchestrator-core` workspace dependency：`workers/orchestrator-core/package.json:25-29`
- `orchestrator-auth` 直接 import：`workers/orchestrator-auth/src/index.ts:1-11`
- `orchestrator-auth` workspace dependency：`workers/orchestrator-auth/package.json:25-27`

这说明 auth RPC contract 不是历史残影，而是当前 façade 与 auth worker 的真实拼装件。

#### B. `workspace-context-artifacts` 仍是 load-bearing

- `agent-core` 仍直接依赖：`workers/agent-core/package.json:17-25`
- `agent-core` 的 Session DO 直接 import：`workers/agent-core/src/host/do/nano-session-do.ts:61-66`
- `context-core` 的 snapshot 直接 import：`workers/context-core/src/snapshot.ts:10-23`
- `context-core` 的 compact boundary 直接引用其类型：`workers/context-core/src/compact-boundary.ts:24-25`

这不是“README 还没删”的问题，而是 worker 代码和类型系统仍然依赖它。

#### C. `storage-topology` 仍是 load-bearing

- `context-core` 仍直接依赖：`workers/context-core/package.json:26-31`
- `context-core` async compact 直接 import：`workers/context-core/src/async-compact/index.ts:53-57`
- `filesystem-core` 已吸收其实现，但 `context-core` 仍通过 package 使用其 adapter/type vocabulary

因此 `storage-topology` 不是可立即删除的“纯 duplicate”。

#### D. worker-to-worker export 依赖仍存在

- `agent-core` 通过中转 export 使用 `context-core-worker` API：`workers/agent-core/src/host/context-api/append-initial-context-layer.ts:1`
- `agent-core` 的 Session DO 直接 import `@haimang/context-core-worker/...`：`workers/agent-core/src/host/do/nano-session-do.ts:34-35`

这虽不是 `packages/` 目录本身，但说明 current graph 还没有彻底变成“纯 6 workers + nacp 双包”的最小形态。

### 2.3 当前真实最小集合

如果只按 **6-workers 当前运行/构建面** 来看，package 残留最少也包括：

| 包 | 当前角色 | 是否仍 load-bearing |
|---|---|---:|
| `@haimang/nacp-core` | internal protocol core | 是 |
| `@haimang/nacp-session` | session/ws profile | 是 |
| `@haimang/orchestrator-auth-contract` | auth RPC contract | 是 |
| `@nano-agent/workspace-context-artifacts` | workspace/context/filesystem shared helper | 是 |
| `@nano-agent/storage-topology` | storage semantics/helper | 是 |

所以问题一的答案不是“只剩两个”，而是：**当前最少还剩 5 个 load-bearing package（其中 2 个是 NACP，3 个不是）。**

## 3. 问题二：是否可以安全退役并删除 `nacp` 之外的全部 package

### 3.1 结论

**现在不可以。**

因为“非 NACP package”里混着三种完全不同的状态：

1. **已经 absorbed 且可进入删除序列的 duplicate 包**
2. **虽然标了 deprecated，但仍有真实 worker consumer 的 bridge 包**
3. **runtime 已不再使用，但测试/验证层还在依赖的包**

把它们混成一个“全部删除”动作，会同时打断 worker build、worker tests 和 root guard regression。

### 3.2 包分层判断

#### A. 可以进入 ZX3 第一波物理删除候选的包

这些包的 README 已明确标注 absorbed/deprecated，而且在当前 worker runtime 中已经不再作为直接 import 来源：

| 包 | README 状态 | 当前判断 |
|---|---|---|
| `packages/agent-runtime-kernel` | `DEPRECATED — absorbed` (`packages/agent-runtime-kernel/README.md:1-9`) | 可进入第一波删除候选 |
| `packages/capability-runtime` | `DEPRECATED — absorbed` (`packages/capability-runtime/README.md:1-9`) | 可进入第一波删除候选 |
| `packages/llm-wrapper` | `DEPRECATED — absorbed` (`packages/llm-wrapper/README.md:1-8`) | 可进入第一波删除候选 |
| `packages/context-management` | `DEPRECATED — absorbed` (`packages/context-management/README.md:1-9`) | 可进入第一波删除候选 |
| `packages/hooks` | `runtime residual absorbed` (`packages/hooks/README.md:1-10`) | 可进入第一波删除候选，但需确认无 test consumer |
| `packages/session-do-runtime` | `DEPRECATED — absorbed` (`packages/session-do-runtime/README.md:1-9`) | 可进入第一波删除候选 |

这些包的共同特征是：**owner/runtime truth 已经迁到 worker 内部目录**。

#### B. 不能现在删除的非-NACP包

| 包 | 现在不能删的原因 |
|---|---|
| `packages/orchestrator-auth-contract` | `orchestrator-core` 与 `orchestrator-auth` 还直接依赖它 |
| `packages/workspace-context-artifacts` | `agent-core` 与 `context-core` 还直接 import 它 |
| `packages/storage-topology` | `context-core` 还直接 import 它，且 `workspace-context-artifacts` 对它有依赖 |

这三类包不是“历史重复件”，而是**当前运行图的一部分**。

#### C. 不能直接删、但可以在 ZX3 后段删除的包

| 包 | 当前状态 | 说明 |
|---|---|---|
| `packages/eval-observability` | runtime 已吸收，但 test 仍在用 | `agent-core` 测试仍直接 import 其 helper/schema；需要先迁测试 |

例如，agent-core 的测试仍有对该包的直接依赖（package audit 中已发现 `workers/agent-core/test/host/integration/edge-trace.test.ts` 等引用），所以它不是 runtime blocker，但仍是 **test blocker**。

### 3.3 为什么“不应该把所有非-NACP内容都吸收到 NACP”

ZX3 最容易犯的一个设计错误，是把“删 packages”理解成“把剩余 helper/contract 都吸进 NACP”。

这不合理，原因是：

1. **NACP-Core / NACP-Session 是协议层，不应吞掉业务 façade contract**
   - `orchestrator-auth-contract` 是 auth façade / RPC contract，不是通用内部 transport law。
2. **workspace / storage 语义不是 protocol family 本体**
   - `workspace-context-artifacts`、`storage-topology` 更像 runtime semantics/helper，不应为了“减少包数”就挤进协议层。
3. **协议层膨胀会让 NACP 从“wire truth”退化成“everything bagel”**
   - 这会伤害你们前面已经很努力建立的 `nacp-core` / `nacp-session` 边界。

### 3.4 问题二的准确回答

因此，问题二的准确回答是：

- **不能安全删除 nacp 之外的全部 package**
- **可以开始删除其中一部分已经 absorbed 的 duplicate 包**
- **但必须先保留至少 `orchestrator-auth-contract`、`workspace-context-artifacts`、`storage-topology`**
- **`eval-observability` 需要在测试迁移后再删**

## 4. 问题三：`test-legacy/` 是否已经可以全面淘汰并删除

### 4.1 结论

**现在还不可以。**

### 4.2 三个硬阻塞

#### 阻塞 1：root scripts 仍直接指向 `test-legacy/`

根 `package.json` 当前仍保留：

- `test:contracts`: `package.json:7-10`
- `test:legacy:contracts`: `package.json:11`
- `test:legacy:e2e`: `package.json:12`
- `test:legacy:cross`: `package.json:13`

而且 `test-legacy/test-command-coverage.test.mjs` 还在显式断言这个脚本布局必须存在：`test-legacy/test-command-coverage.test.mjs:9-27`。

这意味着 `test-legacy/` 不是“没人再跑”的目录，而是**根测试命令的一部分**。

#### 阻塞 2：现行测试仍直接 import `test-legacy/fixtures`

至少两处当前测试直接引用 legacy fixture：

- `workers/agent-core/test/llm/integration/fake-provider-worker.test.ts:13`
- `packages/llm-wrapper/test/integration/fake-provider-worker.test.ts:13`

它们都 import：

- `test-legacy/fixtures/external-seams/fake-provider-worker.js`

所以就算不考虑 root guards，**只删目录也会立刻打断现行测试**。

#### 阻塞 3：文档与治理口径仍把 `test-legacy/` 视为 root guardian truth

当前文档并没有把 `test-legacy/` 宣布为“可删除历史包袱”，反而把它定义成仍在发挥作用的树：

- `test/INDEX.md:176-178` 明确说：`test-legacy/` 继续保留历史 contract / guardian 价值，新 `test/` 只负责 deploy-time live E2E
- `docs/action-plan/worker-matrix/PX-new-tests.md:43-45` 明确说当时的重构原则是 **先 rename，不删除旧测试**
- `docs/issue/worker-matrix/worker-matrix-final-closure.md:27-33` 明确把 `test-legacy/tool-call-live-loop.test.mjs`、`test-legacy/initial-context-live-consumer.test.mjs`、`test-legacy/b7-round2-integrated-contract.test.mjs` 视为 root guardians / 闭环证据

因此，现在如果直接删 `test-legacy/`，会与现有测试方法论文档发生正面冲突。

### 4.3 一个重要细节：CI 并不等于“可删”

值得单独指出的是：

- `.github/workflows/workers.yml` 只构建 workers 和三类共享包：`packages/orchestrator-auth-contract/**`、`packages/nacp-core/**`、`packages/nacp-session/**`，并不跑 root `test:contracts`（`.github/workflows/workers.yml:1-71`）
- `publish-nacp.yml` 也只关心 NACP 发布（`.github/workflows/publish-nacp.yml:1-115`）

这说明：

- **CI 对 `test-legacy/` 的依赖比 root scripts 更弱**
- 但这并不等于能删

因为你们当前是通过 **root scripts + root guardians + 文档治理** 维持这棵树的存在，而不是通过 GitHub workflow 强制运行。

### 4.4 问题三的准确回答

因此，问题三的准确回答是：

- **现在不能全面淘汰并删除 `test-legacy/`**
- 它已经不是 canonical 新测试树，但仍然是：
  1. root contracts 的脚本承载
  2. 部分 active tests 的 fixture 来源
  3. B7 / live-loop / initial-context 等历史 guardian 的证据层

## 5. ZX3 的最佳策略与设计

### 5.1 ZX3 的目标不应是“一刀切删除”

ZX3 最合理的目标应该是：

> **把 package 与 test-legacy 的“逻辑退役”转成“可验证的物理退役”**。

也就是说，ZX3 的核心不是“删得快”，而是：

1. **先收敛 canonical truth**
2. **再迁移最后的 consumer**
3. **最后做物理删除**

### 5.2 ZX3 建议拆成两条主线

#### 主线 A：packages/ 物理退役

建议按 3 档推进。

##### ZX3-A1：先删已经完全 absorbed 的 duplicate 包

第一波候选：

- `agent-runtime-kernel`
- `capability-runtime`
- `llm-wrapper`
- `context-management`
- `hooks`
- `session-do-runtime`

执行前要做的不是重构 runtime，而是：

1. 确认没有 worker 真实 import
2. 清理 package 自己的测试/README/文档引用
3. 从 workspace / lockfile / docs 中移除

这是一波**低风险结构清理**。

##### ZX3-A2：迁移仍 load-bearing 的 bridge/helper 包 consumer

第二波要处理：

- `orchestrator-auth-contract`
- `workspace-context-artifacts`
- `storage-topology`
- `eval-observability`

推荐设计：

| 包 | ZX3 设计建议 |
|---|---|
| `orchestrator-auth-contract` | 保留，不要吸进 NACP；如要扩展 façade contract，可演进成更明确的 orchestrator/auth façade contract |
| `workspace-context-artifacts` | 把剩余 consumer 迁到 `workers/context-core` / `workers/filesystem-core` 的正式 export 面 |
| `storage-topology` | 同样迁到 `workers/filesystem-core` export 面，避免 `context-core` 继续跨 packages import |
| `eval-observability` | 把测试仍需的 helper 迁到 `workers/agent-core/test-support` 或 `test/shared/observability` |

这一步完成后，非-NACP package 才可能缩减到一个很小集合。

##### ZX3-A3：冻结最终 package posture

ZX3 结束时，建议明确冻结成下面这类最小原则：

1. **协议层**：`nacp-core`、`nacp-session`
2. **必要 façade contract 层**：`orchestrator-auth-contract`（或其后继 façade contract）
3. **不再保留已 absorbed 的 duplicate runtime 包**

这样 package tree 会从“历史共存仓库”变成“极小 canonical contract set”。

### 5.3 主线 B：`test-legacy/` 的 canonical cutover

#### ZX3-B1：先在新 `test/` 中补一个 root-guardians 层

当前新 `test/` 只承载 package-e2e / cross-e2e，这个设计还不够，因为旧 root contracts 没有落脚点。

建议新增：

```text
test/
├── shared/
├── root-guardians/
├── package-e2e/
└── cross-e2e/
```

其中：

- `root-guardians/` 承载现在仍有价值的 root contract / B7 / doc-sync / protocol-guard tests
- `shared/` 承载从 `test-legacy/fixtures` 中迁出的公共 fixture

#### ZX3-B2：先迁 fixture，再迁 guardians

优先级建议：

1. 先把 `test-legacy/fixtures/external-seams/*` 迁到 `test/shared/fixtures/external-seams/*`
2. 更新现行测试 import
3. 再迁移仍然有价值的 root guardians

否则你们会在“删 legacy”之前，先把现行 worker test 打断。

#### ZX3-B3：对 `test-legacy/` 做清单化分类

建议把 `test-legacy/` 下文件分成三类：

| 分类 | 处理 |
|---|---|
| 仍然有价值的 guardian | 迁到 `test/root-guardians/` |
| 仅作为历史证据可保留 | 归档到 `docs/evidence/` 或 session artifact，不再当测试运行 |
| 与当前 6-workers posture 不再匹配 | 直接退休删除 |

这个步骤必须是**manifest 化**的，而不是人工边看边删。

#### ZX3-B4：最后再切脚本

脚本变更顺序建议：

1. 先迁测试
2. 再把 `test:contracts` 从 `test-legacy/*.test.mjs` 改到 `test/root-guardians/**/*.test.mjs`
3. 再删除 `test:legacy:*`
4. 最后删除 `test-legacy/`

不要反过来做。

### 5.4 ZX3 不建议做的事情

1. **不要把 remaining helper/contract 都吸进 NACP**
   - 这会破坏协议层边界。
2. **不要把 package 删除和 test-legacy 删除绑成一个超大 PR**
   - 两条主线都在动 consumer / scripts / docs，风险太高。
3. **不要只凭 README 上的 `DEPRECATED` 就执行物理删除**
   - 当前 repo 里的 `DEPRECATED` 很多是“ownership 已迁移，但物理删除归下一阶段”的意思。

## 6. 推荐的 ZX3 落地顺序

### ZX3-Phase 1：建立清单与最小 keep-set

产物：

- `docs/design/zero-to-real/ZX3-package-retirement-manifest.md`
- `docs/design/zero-to-real/ZX3-test-legacy-retirement-manifest.md`

冻结：

- 哪些 package 立即删
- 哪些 package 暂留
- 哪些 `test-legacy` 文件要迁 / 归档 / 删除

### ZX3-Phase 2：删纯 duplicate packages

先删：

- `agent-runtime-kernel`
- `capability-runtime`
- `llm-wrapper`
- `context-management`
- `hooks`
- `session-do-runtime`

### ZX3-Phase 3：迁最后的 package consumers

目标：

- `workspace-context-artifacts` consumer 清零
- `storage-topology` consumer 清零
- `eval-observability` 测试 consumer 清零

### ZX3-Phase 4：迁 `test-legacy` 共享 fixture 与 root guardians

目标：

- `test/shared/fixtures/external-seams/`
- `test/root-guardians/`
- `test:contracts` 指向新树

### ZX3-Phase 5：物理删除 `test-legacy/`

删除前必须满足：

1. root `package.json` 不再引用 `test-legacy`
2. 没有任何测试 import `test-legacy/fixtures`
3. B7 guardians 已迁移或被等价替代
4. `test/INDEX.md` 与相关 closure/action-plan 文档同步改口

## 7. 最终建议

ZX3 的最佳策略不是“全面清仓”，而是：

1. **先把 packages 分成 canonical / bridge / duplicate / test-only 四类**
2. **先删 duplicate**
3. **再迁 bridge 和 test-only consumer**
4. **最后删除 `test-legacy/`**

如果只给一个最核心建议，我会建议：

> **把 ZX3 明确拆成两个 PR 序列：`packages-retirement` 和 `test-legacy-cutover`，不要混做。**

原因很简单：你们现在的 `packages/` 与 `test-legacy/` 之间是交叉的。比如 `eval-observability` 的 root guardians 仍被文档承认为 `test-legacy` 的保护层，`test-legacy/fixtures` 又被现行测试引用。如果把两者绑成一个“总清理”，很容易把“逻辑上应该被删除”与“当前还被运行系统依赖”混在一起，导致一次性切断过多载荷。

所以 ZX3 最稳的目标态应该是：

- `packages/` 最终只保留 **NACP 协议层 + 必要 façade contract 层**
- `test/` 成为唯一 canonical 测试树
- `test-legacy/` 在完成 guardian/fixture cutover 后被物理删除
