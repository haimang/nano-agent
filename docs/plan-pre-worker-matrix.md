# Plan Pre-Worker-Matrix — NACP Protocol Finalization, Publishing, and Worker Scaffolding

> 文档对象:`nano-agent / pre-worker-matrix phase charter`
> 刷新日期:`2026-04-21 (r1)`
> 作者:`Claude Opus 4.7 (1M context)`
> 文档性质:`phase charter / NACP-inward consolidation / cross-worker protocol design / publishing pipeline / package absorption blueprint / workers/ scaffolding`
>
> **修订历史:**
> - **r1 (2026-04-21)**:初版。在 `plan-worker-matrix.md` r1 草稿后,经过"packages 定位辩证"与"是否需要独立前置阶段"两轮讨论,owner 明确:(1) packages 是吸收上下文而非永久 library;(2) 需要独立的 pre-worker-matrix 阶段来完成协议发布、跨 worker 协议设计、脚手架。本 charter 在此决策基础上起草,`plan-worker-matrix.md` 同步标记 deprecated,待本阶段闭合后依据本阶段产出修订。
>
> **输入依据:**
> - `docs/plan-after-foundations.md` (r2,全部 phase 闭合)
> - `docs/plan-worker-matrix.md` (r1,已 deprecated,待本阶段闭合后修订)
> - `docs/handoff/after-foundations-to-worker-matrix.md` (B8 handoff,含 §11/§12/§13 post-B9 回填)
> - `docs/handoff/next-phase-worker-naming-proposal.md` (4 first-wave + 1 reserved 命名建议)
> - `docs/issue/after-foundations/B9-final-closure.md` (B9 closed with revision §8)
> - `docs/rfc/nacp-core-1-3-draft.md` (1.3 契约现状,本阶段起点)
> - `docs/eval/worker-matrix/context-space-examined-by-opus.md` (上下文束审查 + 4 项 patch)
> - `docs/eval/worker-matrix/cross-worker-interaction-matrix.md` (4×4 交互矩阵)
> - `docs/eval/worker-matrix/worker-readiness-stratification.md` (全局 readiness)
> - `docs/eval/worker-matrix/skill-core-deferral-rationale.md`
> - `docs/eval/worker-matrix/{agent,bash,context,filesystem}-core/` 20 份 worker 上下文
> - `docs/eval/after-foundations/smind-contexter-learnings.md` (Contexter 分层架构辩证)
> - 当前 `packages/**` 真实代码事实(详见 §2)
> - Owner 在 2 轮讨论中的 3 条基石决策(详见 §1)

---

## 0. 为什么这份文档要现在写

after-foundations 阶段闭合 + B9 NACP 1.3 契约冻结后,worker-matrix 的 `plan-worker-matrix.md` r1 草稿完成。但这份草稿被随后的两轮讨论从两个不同角度挑战并**明确需要收窄前置**:

### 0.1 第一轮挑战 — 独立目录与项目隔离(source:owner)

Owner 指出:4 个 first-wave worker 应该像 `spikes/` 一样拥有 **`workers/` 顶级目录**,每个 worker 有独立的 `wrangler.jsonc` / `package.json` / `src/` / `test/`,从而获得 Cloudflare-native 的部署隔离、风险隔离、独立生命周期。

`plan-worker-matrix.md` r1 原本的 "host worker = `session-do-runtime`,其他 3 个 worker 暂以 in-process composition handle 形式存在" 是**错误的**,因为它把"代码事实"(今天还没建独立目录)误当成"设计判断"(所以不该建)。这一决策被 owner 纠正。

### 0.2 第二轮挑战 — `packages/` 的真实定位(source:owner)

Owner 进一步指出:**除 `nacp-core` 与 `nacp-session` 外,所有 packages 都是"验证过程的中间产物 / 构建 worker 的上下文",不是"长期 library"**。随 worker 成熟,这些 packages 应被有序吸收进对应 worker,最终只剩 2 个 NACP 包对外发布到 GitHub Packages。

这一决策意味着:worker-matrix 阶段的"P0 composition wiring"不是真的只在 `composition.ts` 里改一次;它意味着**整个 packages/ 的解构 + 吸收 + 重新组装**,配合 `workers/` 顶级目录的建立。

### 0.3 推论 — 我们距离真正的 worker-matrix 还缺一个完整阶段

把 0.1 + 0.2 放一起,`plan-worker-matrix.md` r1 给出的"Phase 0 做所有事"方案行不通:

- NACP 还没真实发布到 GitHub Packages,workers 无法 import
- NACP 还需吸收 5 类跨 worker 共享契约(见 Tier A 映射)
- γ 路线(filesystem.core = workspace authority)与 β 路线(context.core = remote compact authority)需要**新的跨 worker 协议**设计
- 每个 Tier B package 的分割点 / 循环引用 / 测试迁移还没有 blueprint
- `workers/` 目录根本不存在

这些工作**不能**塞进 worker-matrix P0 的 sub-phase,因为它们:

1. 是**完全不同种类**的 risk(DevOps publishing / 协议设计 / 脚手架 / 代码搬迁)
2. 互相有内部 dependency(NACP 不发布 → worker 无 import 源 → worker 壳无意义)
3. 会让 worker-matrix 的**焦点任务(live agent turn loop)**被稀释到 7-8 个 sub-phase 里,失去"焦点性单次装配"的价值

所以本 charter 的产生就是:

> **在 after-foundations 与 worker-matrix 之间,插入一个专门处理"协议最终形态 + 发布流水线 + 跨 worker 协议新增 + 包解构 blueprint + workers/ 脚手架"的前置阶段;这一阶段不做任何业务能力的 worker,只完成 worker-matrix 启动所需的工程 prerequisites。**

简称:

> **Pre-Worker-Matrix: Protocol Finalization + Publishing + Scaffolding**

---

## 1. 本轮已经确认的 Owner Decisions 与基石事实

### 1.1 `packages/` 的真实定位(Owner 决策)

1. **仅 `nacp-core` 与 `nacp-session` 是永久对外契约**,会真实发布到 GitHub Packages
2. **其他所有 packages 都是"验证 + 吸收"上下文**,不是长期 library,随 worker 成熟而 phase out
3. **吸收轨迹是正向的**:从 0 开始(本阶段启动)就要有明确的 absorption blueprint,不是"先复用后再搬"
4. 出处:2 轮讨论 + `docs/eval/worker-matrix/context-space-examined-by-opus.md` §7.3 "conservative-first" 纪律的延伸

### 1.2 `workers/` 顶级目录(Owner 决策)

5. **`workers/` 与 `packages/` / `spikes/` / `context/` 平级**,每个 worker 有独立项目结构
6. **每个 worker 独立 wrangler.jsonc / package.json / src / test**;independent deploy lifecycle
7. **`packages/session-do-runtime/wrangler.jsonc`** 在本阶段视为**放错位置的工件**,将随 `session-do-runtime` 的 absorption 一起搬到 `workers/agent-core/`

### 1.3 Tier A / Tier B / Tier C 归属映射(Opus 提案 + Owner 接受)

**Tier A — 进入 `nacp-core` 的跨 worker 协议契约**(本阶段 W0 完成):

| 来源 | 要吸收的内容 | 进入 NACP 后位置 |
|---|---|---|
| `packages/session-do-runtime/src/eval-sink.ts` | `BoundedEvalSink` + `extractMessageUuid` + overflow disclosure 契约 | `nacp-core/src/evidence/sink.ts`(新) |
| `packages/session-do-runtime/src/cross-seam.ts` | `CrossSeamAnchor` header law(lowercase)+ anchor 接口 | `nacp-core/src/transport/cross-seam.ts` |
| `packages/workspace-context-artifacts/src/evidence-emitters.ts` 的 **schema 部分** | 4 类 evidence record shape(`assembly / compact / artifact / snapshot`) vocabulary | `nacp-core/src/evidence/vocabulary.ts`(新) |
| `packages/hooks/src/catalog.ts` 的 **event name + payload schema 部分** | hook event vocabulary | `nacp-core/src/hooks-catalog/`(新) |
| `packages/storage-topology/src/keys.ts` + `refs.ts` | key / ref / tenant / `_platform` reserved namespace law | `nacp-core/src/storage-law/`(新,或合并到 `tenancy/`) |

**Tier B — 被对应 worker 吸收**(本阶段 W3 出 blueprint;worker-matrix P0 完成实际搬迁):

| 来源 package | 吸收目的地 |
|---|---|
| `session-do-runtime`(除 Tier A 部分) | `workers/agent-core/` |
| `agent-runtime-kernel` | `workers/agent-core/` |
| `llm-wrapper` | `workers/agent-core/` |
| `hooks`(除 catalog vocabulary 部分) | `workers/agent-core/` |
| `eval-observability` | `workers/agent-core/` |
| `evidence-emitters`(helper 部分,按 owner 答案 3) | `workers/agent-core/` |
| `capability-runtime` 全部 | `workers/bash-core/` |
| `context-management` 全部 | `workers/context-core/` |
| `workspace-context-artifacts` 的 snapshot / assembly / compact-boundary | `workers/context-core/` |
| `workspace-context-artifacts` 的 mount / namespace / backends | `workers/filesystem-core/` |
| `storage-topology`(除 Tier A keys/refs 部分)adapters | `workers/filesystem-core/` |
| `storage-topology` placement / calibration | `workers/filesystem-core/` |

**Tier C — context(已就绪)**:`context/smind-contexter/`、`context/just-bash/`、`docs/eval/worker-matrix/`

### 1.4 γ / β 路线(Owner 决策)

8. **γ — `filesystem.core` 是文件操作抽象工具的起点与终点**:所有其他 worker 必须通过 workspace service-binding 协议调 filesystem.core 完成文件操作(禁止本地副本或绕道)
9. **β — `context.core` 是上下文工作抽象工具**:所有其他 worker 对 context 的操作必须通过 `context.compact.*` 等协议调 context.core(禁止本地副本 compact 逻辑)
10. **两条路线都需要新的跨 worker 协议**,这些协议的 shape + 实装属于本阶段 W1

### 1.5 NACP 必须真实发布到 GitHub Packages(Owner 决策)

11. NACP 两个包**必须**以 GitHub Packages 形式对外发布,供 `workers/*` 与潜在第三方消费者引用
12. 发布流水线、auth 配置、publish-on-tag 纪律、dogfood 验证都属本阶段 W2
13. 这也意味着:worker-matrix 阶段 `workers/agent-core/package.json` 中 `@nano-agent/nacp-core` 是**外部 npm 依赖**,不是 `workspace:*` 本地 link

### 1.6 Pre-worker-matrix 阶段存在的必要性(Opus 提案 + Owner 接受)

14. 这一前置阶段**独立成 charter**,不塞入 worker-matrix 的 P0 sub-phase
15. 本阶段完成前,`plan-worker-matrix.md` 处于 deprecated 状态;本阶段完成后,依据本阶段产出 rewrite worker-matrix charter

---

## 2. 当前仓库的真实起点

### 2.1 已成立的 frozen truth(来自 after-foundations 闭合)

1. **NACP 1.3 contract surface**
   - `nacp-core 1.3.0` — Layer 6 matrix + `NacpErrorBodySchema` + `NACP_ERROR_BODY_VERBS` + provisional `wrapAsError()`
   - `nacp-session 1.3.0` — session profile matrix + `SessionStartInitialContextSchema`
   - 两包**仍未发布**到 GitHub Packages(本阶段 W2 处理)

2. **B9 post-review-integration 契约**
   - `acceptClientFrame` async + `await verifyTenantBoundary`(真正 gate dispatch)
   - `getTenantScopedStorage` 全部 4 个 storage use-site 接线
   - `http-controller.ts` 硬编码 1.1.0 已清除

3. **11 包 + 全部 regression**
   - packages/* 11 包 2242+ tests 全绿
   - root 98/98 / cross 112/112 / B7 LIVE 5/5

4. **13 份 + 4 patches 的 worker-matrix 上下文**
   - `docs/eval/worker-matrix/` 4 worker × 5 doc + 4 patches shipped

### 2.2 需要本阶段补齐的 6 处 gap

| gap | 证据 | 本阶段阶段 |
|---|---|---|
| **NACP 5 类 cross-worker 契约内容还分散在非 NACP 包内** | `BoundedEvalSink` 在 `session-do-runtime`;`evidence-emitters` 在 `workspace-context-artifacts`;`CrossSeamAnchor` 在 `session-do-runtime`;`hooks catalog` 在 `hooks` 包;`storage keys/refs law` 在 `storage-topology` | **W0** |
| **γ workspace service-binding 协议不存在** | 今天 `bash.core` / `context.core` / `agent.core` 通过 in-process `WorkspaceFsLike` 消费 workspace;远程 workspace 协议 0 message types | **W1** |
| **β remote compact delegate 协议不落地** | `context.compact.*` message types 已在 1.3.0 shipped,但 `createKernelCompactDelegate` 仍 in-process;没有 kernel↔context.core 跨 worker 的 delegate shape | **W1** |
| **NACP 未发布到 GitHub Packages** | 没有 publishing workflow;`packages/nacp-core/package.json` 没有 publishConfig;没有 dogfood 消费者 | **W2** |
| **Tier B packages 的分割 blueprint 不存在** | 每个 package 的"哪些文件去哪里 + 循环依赖解决 + 测试迁移"均未写 | **W3** |
| **`workers/` 顶级目录不存在** | 0 个 worker 项目;0 个独立 wrangler.jsonc;0 个 CI per-worker | **W4** |

### 2.3 本阶段**不**负责的(worker-matrix 再做)

- `createDefaultCompositionFactory()` 的真实装配(kernel + llm + capability)
- `initial_context` consumer 接线
- 4 个 worker 的真实业务能力实装
- live agent turn loop
- Tier B packages 的**实际**搬迁(blueprint 在 W3 写,实际搬在 worker-matrix P0)

---

## 3. 本阶段的一句话目标

> **在 after-foundations 交付的 NACP 1.3 契约基础上,本阶段完成 5 件事:(a) 把 5 类跨 worker 共享契约吸收进 `nacp-core`(W0)并 ship 1.4.0;(b) 设计并实装 γ workspace service-binding 协议 + β remote compact delegate + cross-worker evidence envelope 转发协议(W1);(c) 建立 GitHub Packages publishing 流水线并真实发布 nacp-core + nacp-session + dogfood 消费(W2);(d) 为 Tier B 每个 package 写 absorption blueprint 并对最简包做 dry-run 吸收(W3);(e) 建立 `workers/` 顶级目录与 4 个空 worker 项目脚手架(W4),每个 worker 真实部署到 Cloudflare 验证 wrangler 工作;产出物是可供 worker-matrix 阶段直接消费的"协议就绪 + 发布就绪 + blueprint 就绪 + 脚手架就绪"的 4 就绪起跑线。**

---

## 4. 本阶段边界:In-Scope / Out-of-Scope

### 4.1 In-Scope(本阶段必须完成)

#### A. NACP 协议吸收(W0)

1. 把 `BoundedEvalSink` + `extractMessageUuid` + overflow disclosure 从 `session-do-runtime/src/eval-sink.ts` 搬到 `nacp-core/src/evidence/sink.ts`
2. 把 `CrossSeamAnchor` header law 从 `session-do-runtime/src/cross-seam.ts` 搬到 `nacp-core/src/transport/cross-seam.ts`
3. 把 evidence vocabulary(`assembly / compact / artifact / snapshot` schema)从 `workspace-context-artifacts/src/evidence-emitters.ts` 搬到 `nacp-core/src/evidence/vocabulary.ts`
4. 把 hooks event name + payload schema 从 `hooks/src/catalog.ts` 搬到 `nacp-core/src/hooks-catalog/`
5. 把 storage key / ref / tenant law 从 `storage-topology/src/{keys,refs}.ts` 搬到 `nacp-core/src/storage-law/`(或合并到现有 `tenancy/`)
6. 所有原位置改为**re-export from nacp-core**,保证消费者 1 次 minor diff 即可迁移
7. Ship `nacp-core 1.4.0` + `nacp-session 1.4.0`(必要时)

#### B. 跨 worker 新协议设计与实装(W1)

8. **γ workspace service-binding 协议**:
   - 定义最小 RPC 面:`read / write / list / stat / delete / listDir / resolveWorkspacePath`
   - 作为新 NACP message family(`workspace.fs.*`)或独立 RPC interface(service-binding 风格)
   - 必要的 body schemas + role gate + direction matrix entries
   - 参考实现(可在 `nacp-core` 或独立 `nacp-workspace` 子模块)
9. **β remote compact delegate 协议**:
   - 基于现有 `context.compact.request/response`,设计 kernel ↔ context.core 跨 worker 的 delegate wiring shape
   - 若需要新 message(例如 `kernel.compact.delegate.request/response`),补进 NACP;若现有 `context.compact.*` 已足够,只需文档化调用流
10. **Cross-worker evidence envelope 转发协议**:
    - 规定 filesystem.core / bash.core / context.core 发出的 evidence record 如何通过 NACP envelope 转发到 agent.core sink
    - 推荐方式:evidence record 包裹为 `audit.record` envelope(1.3 已存在)或新增 `evidence.emit` family(若需要)
11. Ship 新协议作为 nacp-core 1.4.0 的一部分(合并 W0)或 1.5.0(单独 ship);决策在 W1 执行期做

#### C. GitHub Packages 发布流水线(W2)

12. 在 `packages/nacp-core/` 与 `packages/nacp-session/` 的 `package.json` 加 `publishConfig`(指向 GitHub Packages registry)
13. 创建 `.github/workflows/publish-nacp.yml` — 在 `nacp-v*` tag 触发时发布
14. 配置 repository secret(`NODE_AUTH_TOKEN` 或等价)
15. 第一次发布:`@nano-agent/nacp-core@1.4.0` + `@nano-agent/nacp-session@1.4.0`(或 W1 完成后的版本)
16. Dogfood:建一个 throwaway 消费者(放在 `spikes/nacp-publish-dogfood/` 或类似位置),从 GitHub Packages import,验证 `.npmrc` 配置 + auth + resolve + build 闭合
17. 写 `docs/design/pre-worker-matrix/W2-publishing-discipline.md`:publish-on-tag 纪律、版本号规则、紧急撤回流程

#### D. Tier B 吸收 Blueprint + Dry-Run(W3)

18. 对 Tier B 每个 package 写 `docs/design/pre-worker-matrix/W3-absorption-blueprint-<name>.md`:
    - files → destination 映射表
    - 循环引用 / 依赖倒置解决路径
    - 测试迁移规划(每个 test 文件归属)
    - 旧包 deprecated 标注时机(发 0.3.1 patch 加 README deprecated 贴纸)
19. 对最简单 package(建议 `llm-wrapper`)做一次真实 **dry-run absorption**:
    - 搬进 `workers/agent-core/src/llm/`(即使 `workers/agent-core/` 此时还是空壳)
    - 保持与 packages 版本共存;packages/llm-wrapper 标记 deprecated 但不删
    - 作为其他 package 吸收的 pattern 样本

#### E. `workers/` 脚手架与 Cloudflare 部署验证(W4)

20. 建 `workers/` 顶级目录
21. 为 4 个 worker 各建:
    - `workers/agent-core/wrangler.jsonc` — 含预期 DO binding + SERVICE bindings
    - `workers/agent-core/package.json` — 从 GitHub Packages 引用 `@nano-agent/nacp-core` + `@nano-agent/nacp-session`(**首次测试 W2 发布的真实可消费性**)
    - `workers/agent-core/src/index.ts` — hello-world fetch handler
    - `workers/agent-core/test/smoke.test.ts` — 壳级 smoke test
    - 其他 3 个 worker 同构
22. 每个 worker **真实 `wrangler deploy`** 到 Cloudflare(作为独立 worker,各自 URL),验证:
    - wrangler 配置解析成功
    - NACP 包从 GitHub Packages 真实 pull 到 deploy bundle
    - fetch handler 在真实 Worker 上可访问
    - 每个 worker 的 binding catalog(空或预设)不影响 deploy
23. 建立 per-worker CI(`.github/workflows/worker-<name>.yml` 或 matrix):单独 build + test + deploy-dry-run

#### F. 交接(W5)

24. 写 `docs/issue/pre-worker-matrix/W{0-5}-closure.md`(每 phase 一份)+ `pre-worker-matrix-final-closure.md`
25. 写 `docs/handoff/pre-worker-matrix-to-worker-matrix.md`:列出 4 就绪(协议 / 发布 / blueprint / 脚手架)+ worker-matrix 阶段可直接消费的 input pack
26. 依据本阶段实际产出,**触发 `plan-worker-matrix.md` 的 rewrite**(由 worker-matrix 阶段的 owner approval 启动,不在本阶段)

### 4.2 Out-of-Scope(本阶段明确不做)

#### A. 真实 worker 能力

1. 4 个 worker 的真实业务逻辑(absorption 之后的 wiring)
2. `createDefaultCompositionFactory()` 的真实装配(kernel / llm / capability)
3. live agent turn loop
4. `initial_context` consumer 实装
5. cross-worker service-binding 的真实数据流(只做 hello-world 验证 wrangler)

#### B. Tier B packages 的大规模实际搬迁

6. `session-do-runtime / capability-runtime / context-management / workspace-context-artifacts / storage-topology / hooks / eval-observability / agent-runtime-kernel` 的整体 absorption(只对 `llm-wrapper` 做 dry-run 作为 pattern)
7. Tier B packages 的物理删除(本阶段只做 deprecated 标注,删除在 worker-matrix 末期或更后)

#### C. NACP 范围外的新协议

8. `orchestrator.*` / `skill.*` / `reranker.*` / `browser.*` 等 namespace 立项
9. `wrapAsError()` 的 per-verb response migration PR(延后给单独 PR)
10. `SessionStartInitialContextSchema` 的字段扩展

#### D. 生产化

11. SLO / on-call / runbook / dashboard / billing(post-worker-matrix)
12. per-tenant rate limiting / quota enforcement(post-worker-matrix)

#### E. 平台 Gate

13. F03(cross-colo KV)/ F09(high-volume curl)的 probe 重跑(owner-side action)

#### F. skill.core 任何实装

14. `skill.core` substrate / registry / worker shell / env binding(保持 reserved;入场条件见 `docs/eval/worker-matrix/skill-core-deferral-rationale.md` §4)

### 4.3 一个必须写明的例外

本阶段 W4 **必须真实 deploy** 4 个空 worker 到 Cloudflare,这看起来像"做 worker"。准确表述是:

> **本阶段 deploy 的 4 个 worker 是"空壳 validator",目的是证明 wrangler 配置 + GitHub Packages import + Cloudflare 部署链路可工作。它们没有任何业务能力,也不会被 worker-matrix 阶段直接复用作为最终 worker — worker-matrix P0 会在 absorption 过程中重建这些壳的 src/ 内容。**

空壳的 `wrangler.jsonc` / `package.json` 结构**可以**被 worker-matrix 阶段直接复用,但 `src/` 会被 absorption 完全重写。

---

## 5. 本阶段的方法论

### 5.1 NACP-Inward-First — 协议先收束

本阶段第一个动作是 W0 的 5 类内容吸收。纪律:

- ❌ 错误:边吸收边设计新协议(W0 + W1 并行)
- ✅ 正确:先把已有 cross-worker 契约归位到 NACP(W0),再在已归位的 NACP 上设计新协议(W1)

原因:W1 的新协议(workspace RPC / remote compact / evidence forwarding)在语义上会**依赖** W0 吸收后的 anchor / evidence / storage-law 契约。反过来做会产生双向依赖漂移。

### 5.2 Publishing-Before-Scaffolding — 发布先于脚手架

W4 的 workers 脚手架**必须**从 GitHub Packages 真实 import NACP,不能用 `workspace:*` local link。

- ❌ 错误:W4 用 workspace link,把 publishing 推迟到 worker-matrix
- ✅ 正确:W4 作为 **publishing 的第一批真实消费者**,向 W2 提供闭环验证

这也意味着 W2 必须先于或并行 W4,不能延后。

### 5.3 Blueprint-Before-Absorption — 迁移图先于搬迁

W3 产出的每份 absorption blueprint 是 worker-matrix P0 的**前置契约**:

- ❌ 错误:worker-matrix P0 临时决定"这个文件去哪"
- ✅ 正确:本阶段 W3 给出逐文件 + 逐测试 + 循环依赖解决 + deprecated 时机,worker-matrix P0 按 blueprint 执行

这把"设计 absorption"与"执行 absorption"分离,单次 phase 只做一件事。

### 5.4 One-Dry-Run-As-Pattern — 一次样本优于盲推

W3 的 dry-run 对象是 `llm-wrapper`(最简 package,最少依赖,消费者只有 agent.core)。它成功后作为**其他 package 的吸收模板**:

- 验证 blueprint 方法论是否 sustainable
- 验证测试迁移工具链是否可用
- 验证 deprecated 共存模式(packages 仍存在但标记)是否干净
- 为 worker-matrix P0 的 absorption sub-phase 提供时长估算基线

### 5.5 Empty-Shell-Deploy-Discipline — 空壳也要真实部署

W4 的 4 个 worker 在本阶段必须真实 `wrangler deploy` 到 Cloudflare,而非只 build 成功。理由:

- `wrangler deploy` 的 DNS / route / binding / secret / TLS 链路只有真实部署才能验证
- GitHub Packages pull 在 Cloudflare build-time 的行为(npm registry proxy 配置)只有真实 deploy 才能验证
- 本阶段若绕开真实 deploy,worker-matrix P0 会踩到本阶段本该踩到的 DevOps 坑

这一条继承自 `plan-after-foundations.md` §1.1 的 spike 纪律("Spike workers 必须真实部署到 Cloudflare 环境")。

### 5.6 Contract-First-Change 在本阶段仍然有效

继承 `plan-worker-matrix.md` r1 §5.3 的口径,本阶段对 `nacp-core 1.3.0` 的**任何**扩张都必须经:

1. W0 吸收部分 — 作为 1.3.0 → 1.4.0 additive minor bump(非 breaking)
2. W1 新协议部分 — 同样 additive;若冲突需升 1.5.0 或论证 breaking 合理性(不推荐)

1.3.0 消费者在本阶段完全不 break;是本阶段硬纪律。

---

## 6. Phase 总览

| Phase | 名称 | 类型 | 核心目标 | 主要风险 |
|------|------|------|----------|----------|
| **W0** | NACP Protocol Consolidation | code-ship + RFC | 把 5 类 cross-worker 契约吸收进 nacp-core;ship 1.4.0 | 吸收破坏消费端 / 测试大规模迁移漏项 / 引入 nacp-core / downstream package 循环依赖 |
| **W1** | Cross-Worker Protocol Design | RFC + code-ship | 设计并实装 γ workspace RPC + β remote compact + evidence forwarding 三套新协议 | 协议设计过度(做到一半发现 1 个就够)或过简(worker-matrix P0 再补) |
| **W2** | GitHub Packages Publishing Pipeline | DevOps | publishing workflow + 首次发布 + dogfood 验证 + publish-on-tag 纪律 | auth 配置错误导致发布失败 / dogfood 不真实 / 跨 org 授权未打通 |
| **W3** | Absorption Blueprint & Dry-Run | doc + code-ship (dry-run) | 每个 Tier B package 的 blueprint + llm-wrapper 真实 dry-run | blueprint 不够细导致 worker-matrix 再次设计 / dry-run 暴露结构问题来不及回写 blueprint |
| **W4** | `workers/` Scaffolding & Deploy Validation | scaffold + deploy | `workers/` 顶级目录 + 4 个空 worker + 真实 Cloudflare deploy + per-worker CI | wrangler 配置错误 / GitHub Packages 消费路径断 / DO binding 冲突 |
| **W5** | Closure & Handoff | doc | closure memo + handoff + 触发 `plan-worker-matrix.md` rewrite | handoff 漏掉关键 blueprint / 遗漏 deprecated 标记 |

---

## 7. 各 Phase 详细说明

### 7.1 W0 — NACP Protocol Consolidation

#### 实现目标

把 5 类 cross-worker 契约物理归位到 `nacp-core`,保持消费端零破坏,ship `nacp-core 1.4.0`。

#### In-Scope

1. **Evidence sink 契约**(`nacp-core/src/evidence/sink.ts` 新建):
   - `BoundedEvalSink` 类、`EvalSinkOverflowDisclosure` 类型、`extractMessageUuid` helper
   - 原位置 `session-do-runtime/src/eval-sink.ts` 改为 re-export + deprecated JSDoc
   - 消费者(agent runtime 构造函数)在 worker-matrix absorption 时改 import path;本阶段保持 re-export 兼容
2. **Cross-seam anchor**(`nacp-core/src/transport/cross-seam.ts` 新建,或扩展已有 `transport/`):
   - `CrossSeamAnchor` 接口、lowercase header law 常量、`extractAnchorFromHeaders` / `applyAnchorToHeaders` helpers
   - 原位置 `session-do-runtime/src/cross-seam.ts` 同样 re-export
3. **Evidence vocabulary**(`nacp-core/src/evidence/vocabulary.ts` 新建):
   - 4 类 record shape:`AssemblyEvidenceRecord`、`CompactEvidenceRecord`、`ArtifactEvidenceRecord`、`SnapshotEvidenceRecord`,全部 Zod schema
   - 原位置 `workspace-context-artifacts/src/evidence-emitters.ts` 的 emitter 函数**暂不移动**(这些是 agent.core 的 helper,worker-matrix absorb);仅 schema 部分提取到 nacp-core
4. **Hooks catalog vocabulary**(`nacp-core/src/hooks-catalog/` 新建):
   - 8 个 v1 event 的 name + payload schema(不含 runtime)
   - 原位置 `packages/hooks/src/catalog.ts` re-export
5. **Storage law**(`nacp-core/src/storage-law/` 新建,或合并到现有 `tenancy/`):
   - `buildDoStorageRef / buildR2Ref / buildKvRef` helpers、`_platform/` reserved namespace 常量、tenant prefix 校验
   - 原位置 `storage-topology/src/{keys,refs}.ts` re-export
6. **版本同步**:`nacp-core 1.4.0`,`nacp-session` 若依赖新 anchor 接口则 bump 到 1.4.0,否则保 1.3.0
7. **Regression**:原消费者 re-export 路径保持工作;全包测试全绿;B7 LIVE 契约 test/b7-round2-integrated-contract.test.mjs 5/5 绿

#### 交付物

1. `packages/nacp-core/src/{evidence/sink,evidence/vocabulary,transport/cross-seam,hooks-catalog/*,storage-law/*}.ts` 新建或补充
2. `packages/nacp-core/CHANGELOG.md` 1.4.0 entry(additive,非 breaking)
3. `docs/rfc/nacp-core-1-4-consolidation.md`:说明 5 类吸收 + re-export 策略
4. `docs/issue/pre-worker-matrix/W0-closure.md`

#### 收口标准

1. `pnpm --filter @nano-agent/nacp-core build` 通过
2. 全 11 包 `pnpm -r run test` 全绿
3. root tests + cross tests + B7 LIVE 全绿
4. 所有原位置消费者 **无需修改代码** 即可继续工作(re-export 保证)
5. CHANGELOG 1.4.0 与 RFC 对齐

### 7.2 W1 — Cross-Worker Protocol Design

#### 实现目标

为 γ / β 两条 owner 确认的路线设计并实装所需的新协议;同时补一条 cross-worker evidence envelope 转发协议。

#### In-Scope

##### γ — Workspace Service-Binding Protocol

8. RFC:`docs/rfc/nacp-workspace-rpc.md`
9. 确定 shape 形式:
   - **选项 α**:作为 NACP message family(`workspace.fs.read.request/response`、`workspace.fs.write.request/response` 等,6-7 条 message)
   - **选项 β**:作为独立 service-binding RPC interface(更薄,不走 envelope)
   - Opus **推荐 α**,理由:保持协议单一路径(NACP),复用现有 tenant/matrix/authority 机制;W1 决策
10. 实装:在 `nacp-core/src/messages/workspace.ts`(若走 α)或 `nacp-core/src/transport/workspace-rpc.ts`(若走 β)
11. 对应 direction matrix entries、role gate、body schema 全部落地
12. Contract tests:为每条新 message / RPC 方法写 root tests

##### β — Remote Compact Delegate

13. RFC:`docs/rfc/remote-compact-delegate.md`
14. 评估现有 `context.compact.request/response` 是否足够,还是需要新增 `kernel.compact.delegate.*`
15. Opus **推荐**:若现有足够,只做**文档化**(不新增 message);若不足,补最小 message
16. 实装:`createRemoteKernelCompactDelegate(binding: ServiceBindingLike, ...)` helper(可能在 nacp-core 或独立小 package)
17. Contract tests

##### Cross-Worker Evidence Envelope Forwarding

18. RFC:`docs/rfc/evidence-envelope-forwarding.md`
19. 决策:evidence record 是包裹为 `audit.record` envelope,还是新增 `evidence.emit` family
20. Opus **推荐**:包裹为 `audit.record`(1.3 已存在,无需新 family);body 内嵌 evidence vocabulary 的 4 类 record
21. 若决策不同,W1 补最小 family
22. Contract test 证明 agent.core sink 能 extract 转发 evidence

#### 版本策略

23. W1 全部协议作为 `nacp-core 1.4.0` 的一部分 ship(与 W0 合并),或独立 ship `1.5.0` — W1 执行期决策
24. `nacp-session` 不变(这三条都不涉及 session profile)

#### 交付物

1. 3 份 RFC(上)
2. `nacp-core` 对应源码 + 测试
3. 原 `plan-worker-matrix.md` §7 "Cross-Worker 不变量" 现在有代码背书
4. `docs/issue/pre-worker-matrix/W1-closure.md`

#### 收口标准

1. 3 条新协议 + 对应 tests 全绿
2. 现有 1.3.0 消费者不 break(additive)
3. 3 份 RFC owner-approved
4. 新协议的 contract test 覆盖 legality / boundary / evidence propagation

### 7.3 W2 — GitHub Packages Publishing Pipeline

#### 实现目标

把 `nacp-core` + `nacp-session` 真实发布到 GitHub Packages,跑通 publish-on-tag 流水线,dogfood 验证跨 org 消费路径。

#### In-Scope

25. `packages/nacp-core/package.json` + `packages/nacp-session/package.json` 加 `publishConfig`:
    ```json
    "publishConfig": {
      "registry": "https://npm.pkg.github.com",
      "access": "restricted"
    }
    ```
26. 若 owner name 需确定,在此 phase 与 owner 对齐(例如 `@nano-agent/nacp-core` vs `@<org>/nacp-core`)
27. `.github/workflows/publish-nacp.yml`:
    - trigger on `push tags nacp-v*.*.*`
    - steps: checkout + setup-node + pnpm install + build + publish
    - auth:`NODE_AUTH_TOKEN` = `GITHUB_TOKEN` 或配置 PAT
28. Repo secret 配置 + permission 声明(`packages: write`)
29. 第一次真实发布:tag `nacp-v1.4.0`,CI 发布 nacp-core 1.4.0 + nacp-session 1.4.0(或 1.3.0 — 取决于 W1 是否 bump session)
30. Dogfood 消费者 — **建议路径**:
    - 方案 A(推荐):在本仓库新建 `dogfood/nacp-consume-test/`,独立 package.json,从 GitHub Packages import nacp-core + nacp-session,build + test 成功即可删除
    - 方案 B:直接让 W4 的第一个 worker(agent-core 空壳)作为 dogfood
31. `docs/design/pre-worker-matrix/W2-publishing-discipline.md`:
    - publish-on-tag 纪律(只有 `nacp-v*` tag 触发,不用 commit 触发)
    - 版本号规则(与 `nacp-core/CHANGELOG` 同步)
    - 紧急撤回流程(unpublish + deprecated tag)
    - consumer 配置模板(`.npmrc` 示例)

#### 交付物

1. 2 个 package.json 的 publishConfig
2. publishing workflow YAML
3. 真实发布的 `@<scope>/nacp-core@1.4.0` + `@<scope>/nacp-session@1.4.0`(或对应版本)
4. dogfood 消费成功记录(截图或 log 归档到 closure)
5. W2-publishing-discipline doc
6. `docs/issue/pre-worker-matrix/W2-closure.md`

#### 收口标准

1. GitHub Packages registry 上能看到 `nacp-core@1.4.0` + `nacp-session@(1.3.0|1.4.0)`
2. Dogfood consumer 能 `pnpm install` + `pnpm build` 成功
3. publish-on-tag workflow 至少 run 1 次并 pass
4. discipline doc owner-approved

### 7.4 W3 — Absorption Blueprint & Dry-Run

#### 实现目标

为 Tier B 每个 package 写精确到文件/测试的 absorption blueprint;对 `llm-wrapper` 做真实 dry-run 作为 pattern 样本。

#### In-Scope

##### Blueprint 书写

32. 对以下 Tier B packages 各写一份 blueprint(`docs/design/pre-worker-matrix/W3-absorption-blueprint-<name>.md`):
    - `session-do-runtime` → `workers/agent-core/`
    - `agent-runtime-kernel` → `workers/agent-core/`
    - `llm-wrapper` → `workers/agent-core/`
    - `hooks`(runtime 部分)→ `workers/agent-core/`
    - `eval-observability` → `workers/agent-core/`
    - `capability-runtime` → `workers/bash-core/`
    - `context-management` → `workers/context-core/`
    - `workspace-context-artifacts`(snapshot/assembly/compact-boundary 部分)→ `workers/context-core/`
    - `workspace-context-artifacts`(mount/namespace/backends 部分)→ `workers/filesystem-core/`
    - `storage-topology`(adapters + placement + calibration)→ `workers/filesystem-core/`
33. 每份 blueprint 包含:
    - files → destination 逐文件表
    - 跨 package 循环引用分析(如 `hooks` import `nacp-core` / `eval-observability`)
    - 测试文件归属 + 迁移路径
    - deprecated 标注时机(哪些 commit 加 deprecated README 贴纸)
    - 预估 diff 规模(大致 LOC)
    - worker-matrix P0 执行该 blueprint 的预估时长

##### `llm-wrapper` 真实 Dry-Run

34. 在 `workers/agent-core/src/llm/`(即使 `workers/agent-core/` 目录此时还没存在,先建该子目录)吸收 `llm-wrapper` 的 `LLMExecutor` 类与相关 types
35. 调整 import:从 `@nano-agent/nacp-core` 等走 GitHub Packages(W2 闭合后可用)
36. 保持 `packages/llm-wrapper/` 不删,在其 README 加 deprecated 贴纸 + 指向新位置
37. Dry-run absorption 的测试全部迁移并跑绿
38. 作为 pattern,回写到**所有**其他 package 的 blueprint 中作为参考模板
39. 估算:若成功,预估其他 package 平均吸收时长

#### 交付物

1. 10 份 blueprint docs
2. `llm-wrapper` 真实 dry-run absorption(diff 可提交但 workers/ 目录可能还在建设中 — 见 W4 依赖)
3. `docs/design/pre-worker-matrix/W3-absorption-pattern.md`(方法论文档,基于 dry-run 总结)
4. `docs/issue/pre-worker-matrix/W3-closure.md`

#### 收口标准

1. 10 份 blueprint 完整
2. `llm-wrapper` dry-run 成功 + 测试绿(可能依赖 W4 目录就绪,顺序见 §8)
3. pattern doc 捕获可复用 steps
4. 每份 blueprint owner 至少 glance-pass

### 7.5 W4 — `workers/` Scaffolding & Deploy Validation

#### 实现目标

建 `workers/` 顶级目录 + 4 个空 worker 项目 + 每个 worker 真实 Cloudflare deploy,证明 wrangler + GitHub Packages + 部署链路闭合。

#### In-Scope

40. 建 `workers/` 顶级目录,更新 `pnpm-workspace.yaml` 包含 `workers/*`
41. 4 个 worker 项目,每个包含:
    - `wrangler.jsonc` — main + compatibility_date + minimal bindings(各自有预期 binding slots,但 scope 内只测 shell)
    - `package.json` — from GitHub Packages import `@<scope>/nacp-core` + `@<scope>/nacp-session`;其他 dependencies 先空着
    - `src/index.ts` — 最小 fetch handler,能 return `{ worker: "agent-core", version: "pre-shell-0.1.0", status: "ok" }`
    - `test/smoke.test.ts` — 壳级 unit test(构造 fetch handler,assert 返回 shape)
    - `tsconfig.json` — 继承 root tsconfig
    - `.gitignore`
42. 命名对齐:目录 `workers/agent-core`(与 worker.name `agent.core` 对应 — 目录用 `-` 因为 npm 命名规范)
43. 真实 `wrangler deploy` — 每个 worker 独立部署:
    - 部署到独立 URL(例如 `<worker-name>.<account>.workers.dev`)
    - 允许使用 `--env preview` 或类似保护 tag
    - 验证 binding catalog 解析(即使本阶段 bindings 都空)
44. per-worker CI:
    - 方案 A:每个 worker 一个 workflow 文件(`.github/workflows/worker-agent-core.yml` etc.)
    - 方案 B:matrix workflow,一个 `.github/workflows/workers.yml` 跑 4 个 worker 的 build + test
    - 推荐方案 B(更少 YAML 重复);W4 决策
45. 每个 worker 的 `README.md` 极简版:说明 "this is a pre-worker-matrix shell; real absorption happens in worker-matrix phase"

#### 交付物

1. `workers/` 目录 + 4 个空 worker 项目完整结构
2. 4 份成功的 `wrangler deploy` 记录(URL + version hash)
3. per-worker CI workflow
4. 4 份 worker README
5. `docs/issue/pre-worker-matrix/W4-closure.md`

#### 收口标准

1. `pnpm --filter './workers/*' build` 全部通过
2. `pnpm --filter './workers/*' test` 全部通过(shell 级 smoke)
3. 4 个 URL 均外网可访(或 owner-gated)
4. CI workflow run 1 次 + green
5. 证明 `@<scope>/nacp-core` 从 GitHub Packages 真实被 pull + bundle(通过检视 deploy artifact 或 `wrangler deploy --dry-run` 日志)

### 7.6 W5 — Closure & Handoff

#### 实现目标

总结本阶段全部产出,触发 `plan-worker-matrix.md` rewrite。

#### In-Scope

46. `docs/issue/pre-worker-matrix/W{0-4}-closure.md` 确认全部写完
47. `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md`:
    - 本阶段 5 大产出(协议吸收 / 新协议 / 发布 / blueprint / 脚手架)清单
    - 每类的代码锚点 + 文档锚点
    - 遗留 open items(若有)
    - 对 worker-matrix 阶段的 handoff posture
48. `docs/handoff/pre-worker-matrix-to-worker-matrix.md`:
    - 4 就绪清单
    - worker-matrix charter 需修订的具体节(§4 in-scope / §6 worker 章 / §8 Phase 拆分 / §11 exit criteria)
    - 可直接消费的 input pack(blueprint docs / scaffolds / 发布路径 / 新协议 RFC)
49. `docs/plan-worker-matrix.md` 的 deprecated 标记**解除**,进入 r2 rewrite(rewrite 本身**不在本阶段**,但解除标记的触发在本阶段)
50. 更新 `docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md` 到 rev 3:pre-worker-matrix closed + worker-matrix 输入就绪

#### 交付物

1. 6 份 closure docs + final closure
2. handoff memo
3. `plan-worker-matrix.md` 顶部状态更新(deprecated → needs-rewrite-r2)
4. `00-current-gate-truth.md` rev 3

#### 收口标准

1. 所有交付文档 owner-approved
2. handoff memo 涵盖本阶段全部产出
3. `plan-worker-matrix.md` 状态一致

---

## 8. 执行顺序与 DAG

### 8.1 推荐执行顺序

1. **W0** — NACP Protocol Consolidation
2. **W1** — Cross-Worker Protocol Design(在 W0 基础上)
3. **W2** — GitHub Packages Publishing(可与 W1 并行,W0 完成即可启)
4. **W3** — Absorption Blueprint(blueprint 部分)+ Dry-Run(dry-run 依赖 W4 `workers/agent-core/` 目录就绪)
5. **W4** — `workers/` Scaffolding & Deploy(依赖 W2 发布完成)
6. **W5** — Closure & Handoff

### 8.2 推荐 DAG

```text
                 ┌─> W2 (Publishing) ────┐
W0 (Consolidation) │                       │
                 └─> W1 (New Protocols) ──┤
                              │           ├─> W4 (Scaffolding + Deploy)
                              │           │            │
                              │           └─> W3 dry-run 部分 (需 W4 目录就绪)
                              │                        │
                              └──> W3 blueprint 部分(可并行 W4)
                                              │
                                              └──> W5 (Closure + Handoff)
```

### 8.3 为什么这样排

1. **W0 必须最先**:W1 / W2 / W3 都依赖 nacp-core 的最终 shape
2. **W2 与 W1 可并行**:W2 第一次发布的是 "W0 的产物"(1.4.0);W1 的新协议可以在 W2 发布 1.4.0 之后追加为 1.4.1 / 1.5.0,不阻塞首发
3. **W3 blueprint 可与 W1 / W2 并行**:blueprint 是 doc,不依赖代码完成
4. **W3 dry-run 依赖 W4 `workers/agent-core/` 目录**:因为 `llm-wrapper` 吸收到 `workers/agent-core/src/llm/`,该目录由 W4 建立;因此 W3 的 dry-run 部分必须在 W4 目录就绪后执行
5. **W4 依赖 W2**:每个 worker 从 GitHub Packages 引用 nacp;若 W2 未发布,import 会失败
6. **W5 最后**:收口必须等全部 phase 完成

### 8.4 估计时长

| Phase | 时长 | 依赖 | 累计(带并行) |
|---|---|---|---|
| W0 | 1-2 周(5 类吸收 + 全 regression) | — | 2 周 |
| W1 | 1 周(3 条新协议 + RFC) | W0 | 3 周 |
| W2 | 0.5-1 周(DevOps pipeline) | W0(可与 W1 并行) | 3 周 |
| W3 blueprint 部分 | 0.5-1 周(10 份 doc) | W0 + W1 (可与 W4 并行) | 3.5 周 |
| W4 | 0.5-1 周(脚手架 + 4 deploy + CI) | W2 | 3.5-4 周 |
| W3 dry-run 部分 | 0.5 周 | W4 agent-core 目录 | 4-4.5 周 |
| W5 | 0.5 周 | 全部 | 4.5-5 周 |

**总时长:4-5 周**。比 after-foundations(5-6 周)短,比 worker-matrix(3 周)略长 — 合理,因为本阶段 DevOps + 协议设计负担重于单纯 composition wiring。

---

## 9. 执行方法

### 9.1 每个 Phase 都必须先有 Design Artifact

最低要求:

1. 问题定义
2. in-scope / out-of-scope
3. 对 nacp-core 的影响面(任何 phase 都可能)
4. failure paths
5. test matrix
6. closure criteria

### 9.2 每个 Phase 按批次执行

每个 Phase 拆 2-4 个批次,每批次:

1. 明确交付物(文件路径)
2. 独立测试目标
3. 对 regression baseline 的影响评估

### 9.3 每个 Phase 的三道 Gate

#### Start Gate

1. design artifact 已写出
2. scope 已冻结
3. test matrix 已列出
4. 前置 phase 已闭合(除 W0)

#### Build Gate

1. 批次已拆分
2. 对 B7 LIVE 契约的影响已评估(W0 / W4 均有)
3. observability / logging 计划已明确

#### Closure Gate

1. phase closure criteria 全部满足
2. tests 存在 + 绿
3. closure note 回填
4. 若适用,发布 artifact(W2)/ deploy artifact(W4)归档

### 9.4 本阶段的特殊纪律

8. **W0 的 re-export 纪律**:原位置不能直接删掉,必须 re-export 3 个月以上 — 保持 1.3.0 消费者不 break
9. **W2 的 tag 纪律**:只有 `nacp-v*.*.*` 格式 git tag 触发发布,不用 branch 或 commit
10. **W4 的 deploy 纪律**:4 个 worker 必须真实 deploy,不接受"build 成功" 作为替代证据

---

## 10. 测试与验证策略

### 10.1 继承 plan-after-foundations §10.1 的五层结构

1. Package tests — 保持 all green
2. Root contract tests — 补 W1 新协议的 contract tests
3. Cross-package E2E — 补 W0 吸收后的 cross-package 验证
4. Real-Cloudflare verification — W4 的 4 worker deploy
5. Chaos / failure injection — 不在本阶段

### 10.2 本阶段必须新增的验证

| 验证项 | 测试位置 | 说明 |
|---|---|---|
| W0 re-export 完整性 | `packages/*/test/` + root | 原 import path 仍可 resolve + type check |
| W0 regression 全绿 | `pnpm -r run test` + root + cross | 不允许新红 |
| W1 `workspace.fs.*` matrix 合法性 | `test/workspace-rpc-contract.test.mjs`(新) | 新 message family 通过 Layer 6 matrix |
| W1 evidence envelope forwarding | `test/evidence-forward-contract.test.mjs`(新) | `audit.record` 能承载 evidence record |
| W1 remote compact delegate wiring | `test/remote-compact-delegate-contract.test.mjs`(新) | delegate 通过 service binding 跑通 |
| W2 dogfood consumer build | dogfood 目录 | 从 GitHub Packages import 成功 |
| W3 dry-run `llm-wrapper` tests | `workers/agent-core/test/llm/` | 原 tests 迁移后全绿 |
| W4 per-worker smoke | `workers/*/test/smoke.test.ts` | 4 个 worker 各自 shell-level smoke |
| W4 Cloudflare deploy 真实性 | 归档到 closure | wrangler deploy URL 可访问 |

### 10.3 继承的不变量保护

继承 `plan-worker-matrix.md` §7 五条不变量,本阶段期间:

- 不变量 1 tenant boundary — W0 吸收期间不能破坏;W4 空壳 deploy 不触发
- 不变量 2 matrix legality — W1 新协议必须通过 matrix;W0 吸收不改变现有合法性
- 不变量 3 evidence dedup — W0 搬 sink 时必须保留 dedup 契约
- 不变量 4 stream replay — 本阶段不动
- 不变量 5 checkpoint 对称性 — 本阶段不动

---

## 11. 本阶段的退出条件

### 11.1 Primary Exit Criteria

1. **NACP 协议吸收完成**:5 类 cross-worker 契约全部 in nacp-core;re-export 保证消费者零破坏;`nacp-core 1.4.0` shipped
2. **3 条新协议落地**:γ workspace RPC + β remote compact delegate + cross-worker evidence forwarding 全部有代码 + 测试 + RFC
3. **NACP 真实发布到 GitHub Packages**:`@<scope>/nacp-core@1.4.0` + `@<scope>/nacp-session@(1.3.0|1.4.0)` 可 install;publish-on-tag 流水线 pass
4. **Dogfood 消费成功**:至少一个消费者从 GitHub Packages install + build + test 成功
5. **10 份 absorption blueprint**:Tier B 每个 package 有 blueprint doc + owner glance-pass
6. **`llm-wrapper` dry-run 吸收完成**:`workers/agent-core/src/llm/` 含真实代码 + 测试绿;`packages/llm-wrapper/` 仍存在但 deprecated 标注
7. **`workers/` 顶级目录 + 4 个空 worker**:4 个 worker shell 存在;pnpm workspace 认识;per-worker CI 配置
8. **4 个 worker 真实部署**:`wrangler deploy` 成功 4 次;4 个 URL 可访问(或 owner-gated)
9. **Regression 全绿**:全包 tests + root + cross + B7 LIVE 全部保持;没有新红
10. **Closure ritual 完成**:6 份 closure docs + 1 份 handoff memo
11. **`plan-worker-matrix.md` 状态已更新**:从 deprecated 转为 needs-rewrite-r2,触发 worker-matrix charter 的下一版撰写

### 11.2 Secondary Outcomes(结果非锚点)

- `nacp-core` 1.3.0 → 1.4.0(additive)
- `nacp-session` 按需 1.3.0 → 1.4.0 或保持
- `storage-topology` / `hooks` / `workspace-context-artifacts` 等 Tier B 包可能出现 patch 级版本(因为 re-export 指向 nacp-core)
- 新 deprecated 标记分布在 packages/*/README.md

### 11.3 NOT-成功退出识别

若出现以下任一,本阶段 NOT 退出:

- primary 1-11 任一未满足
- NACP 发布过程出现 breaking change(例如 `@nano-agent/nacp-core` 消费者无法 install 1.3.0 消费者期待的 symbol)
- 任何 1.3.0 消费者在 re-export 机制下被 break
- B7 LIVE 契约 tests 红
- `workers/` 目录建立但某 worker deploy 失败且未 resolved

---

## 12. 下一阶段:Worker-Matrix 会如何被修订

本阶段闭合后,`plan-worker-matrix.md` 需 rewrite 为 r2。预期修订面:

### 12.1 §0 / §1 / §2 全部重写

基于本阶段产出的"4 就绪"起点(协议 / 发布 / blueprint / 脚手架)重写前置条件。

### 12.2 §4 In-Scope 大改

worker-matrix r2 的 in-scope 将变为:

1. **按 blueprint 执行 Tier B absorption**(除 `llm-wrapper` 已在本阶段 dry-run)
2. **装配 live agent turn loop**(default composition wiring + initial_context consumer)
3. **激活 cross-worker service-binding 流量**(每对 worker 通过 W1 设计的协议开始真实通讯)
4. **deprecated packages 物理删除时机决策**

### 12.3 §5 方法论调整

新增 "blueprint-driven absorption"、"protocol-based cross-worker integration"、"gradual packages removal" 三条纪律。

### 12.4 §6 worker 章节深化

每个 worker 章节基于本阶段 W3 blueprint 深化:具体文件清单、绝对时长估算、worker 内部 sub-phase。

### 12.5 §8 Phase 数量

从 r1 的 3 Phase(P0 wiring + P1 freeze + P2 closure)扩展为 6-7 Phase:

- P0.A / P0.B / P0.C / P0.D 各 worker 按 blueprint 吸收(并行)
- P0.E composition + initial_context consumer 装配
- P0.F cross-worker service-binding 激活
- P0.G packages deprecation 物理执行

### 12.6 §11 exit criteria

新增"live agent turn loop 端到端运行"、"4 worker 真实 cross-calling"、"Tier B packages 物理删除完成"三条。

---

## 13. 最终 Verdict

### 13.1 对本阶段的最终定义

本阶段不应被表述为:

> "worker-matrix 的准备工作"

而应被表述为:

> **"在 after-foundations 交付的 NACP 1.3 契约之上,完成 worker-matrix 启动所需的 5 件 prerequisites:跨 worker 契约完全收束到 NACP(W0)、3 条新跨 worker 协议 shipped(W1)、NACP 真实发布到 GitHub Packages 并被 dogfood(W2)、Tier B packages 每份 absorption blueprint + 1 份 dry-run pattern(W3)、`workers/` 顶级目录 + 4 个空 worker 真实部署到 Cloudflare(W4);这一阶段不实装任何 worker 业务能力,但它把 worker-matrix 从'需要边设计边 ship'降级为'纯粹的 blueprint-driven absorption + 纯粹的装配 wiring'。"**

### 13.2 一句话总结

> **Pre-worker-matrix is not the first act of worker-matrix. It is the protocol finalization, publishing pipeline, absorption blueprint, and scaffolding layer that makes the actual worker-matrix phase a clean assembly pass rather than a simultaneous design-plus-assembly scramble.**

### 13.3 对前一阶段的承接关系

after-foundations 给本阶段留下:

- NACP 1.3 frozen contract surface
- 11 shipped packages 全绿
- B7 LIVE wire contract
- 13 份 `docs/eval/worker-matrix/` 上下文 + 4 份 patch
- B8/B9 closure + handoff

本阶段给 worker-matrix 留下:

- NACP 1.4.0 shipped + 发布到 GitHub Packages + dogfood 通过
- 3 条新跨 worker 协议(workspace RPC / remote compact / evidence forwarding)
- 10 份 absorption blueprint + 1 份 pattern sample
- `workers/` 顶级目录 + 4 个 deployed shell + per-worker CI
- 6 份 closure + handoff memo + worker-matrix charter r2 触发

---

## 14. 后续文档生产清单

### 14.1 Design / RFC / Policy 文档

路径:`docs/design/pre-worker-matrix/` 与 `docs/rfc/`

| 对应 Phase | 文件路径 | 类型 |
|---|---|---|
| W0 | `docs/design/pre-worker-matrix/W0-nacp-consolidation.md` | Design |
| W0 | `docs/rfc/nacp-core-1-4-consolidation.md` | RFC |
| W1 | `docs/design/pre-worker-matrix/W1-cross-worker-protocols.md` | Design |
| W1 | `docs/rfc/nacp-workspace-rpc.md` | RFC |
| W1 | `docs/rfc/remote-compact-delegate.md` | RFC |
| W1 | `docs/rfc/evidence-envelope-forwarding.md` | RFC |
| W2 | `docs/design/pre-worker-matrix/W2-publishing-discipline.md` | Policy |
| W3 | `docs/design/pre-worker-matrix/W3-absorption-blueprint-<package>.md` × 10 | Blueprint |
| W3 | `docs/design/pre-worker-matrix/W3-absorption-pattern.md` | Pattern Spec |
| W4 | `docs/design/pre-worker-matrix/W4-workers-scaffolding.md` | Design |

### 14.2 Action-Plan 文档

路径:`docs/action-plan/pre-worker-matrix/`

| 对应 Phase | 文件路径 |
|---|---|
| W0 | `docs/action-plan/pre-worker-matrix/D1-nacp-consolidation.md` |
| W1 | `docs/action-plan/pre-worker-matrix/D2-cross-worker-protocols.md` |
| W2 | `docs/action-plan/pre-worker-matrix/D3-publishing-pipeline.md` |
| W3 | `docs/action-plan/pre-worker-matrix/D4-absorption-blueprint-and-dryrun.md` |
| W4 | `docs/action-plan/pre-worker-matrix/D5-workers-scaffolding-and-deploy.md` |
| W5 | `docs/action-plan/pre-worker-matrix/D6-closure-and-handoff.md` |

(D 前缀:继承 plan-after-foundations 的 B 前缀 + plan-worker-matrix 的 C 前缀;D 表示本阶段 action-plan)

### 14.3 撰写顺序建议

**第一批(必须最先)**:

1. `W0-nacp-consolidation.md` design
2. `nacp-core-1-4-consolidation.md` RFC
3. `D1-nacp-consolidation.md` action-plan

**第二批(并行可启)**:

4. `W2-publishing-discipline.md`(可与 W1 并行)
5. `D3-publishing-pipeline.md`

**第三批(W0 落地后)**:

6. `W1-cross-worker-protocols.md`
7. 3 份 RFC(workspace-rpc / remote-compact / evidence-forwarding)
8. `D2-cross-worker-protocols.md`

**第四批(blueprint 集体撰写)**:

9. `W3-absorption-blueprint-*.md` × 10
10. `D4-absorption-blueprint-and-dryrun.md`

**第五批**:

11. `W4-workers-scaffolding.md`
12. `D5-workers-scaffolding-and-deploy.md`
13. `D6-closure-and-handoff.md`

### 14.4 如果要先控制文档数量,优先看哪 5 份

1. `W0-nacp-consolidation.md` — 决定整阶段的 NACP shape
2. `nacp-core-1-4-consolidation.md` RFC — 决定向后兼容
3. `nacp-workspace-rpc.md` RFC — γ 路线能否落地
4. `W3-absorption-pattern.md` — 决定 worker-matrix 阶段 absorption 的工程效率
5. `W4-workers-scaffolding.md` — 决定 `workers/` 目录的最终 shape

---

## 15. 思维链承接表

| 本 charter 章节 | 决策内容 | 来源 |
|---|---|---|
| §0 | 本阶段存在必要性 | Owner 在"packages 定位"讨论 + 我的第 4 条硬理由(γ/β 协议设计) |
| §1.1 | packages 是吸收上下文非永久 library | Owner 2 轮讨论 |
| §1.2 | `workers/` 顶级目录 | Owner 第 1 轮讨论 |
| §1.3 Tier A/B/C | 协议-逻辑分层映射 | Opus 提案 + Owner 接受 |
| §1.4 γ/β 路线 | workspace / context authority | Owner 回答硬问题 1 / 2 |
| §1.5 NACP 必须发布 | GitHub Packages | Owner 回答 pre-worker-matrix 问题 |
| §1.6 独立阶段 | pre-worker-matrix charter | Owner 回答 + Opus 辩证支持 |
| §4.1 A W0 内容 | 5 类 Tier A 吸收 | §1.3 Tier A 表 |
| §4.1 B W1 内容 | γ + β + evidence forwarding | §1.4 + Opus 第 4 条 |
| §4.1 C W2 内容 | publishing pipeline | §1.5 |
| §4.1 D W3 内容 | blueprint + dry-run | §1.1 + Opus 提案 |
| §4.1 E W4 内容 | workers/ scaffolding | §1.2 + Opus 提案 |
| §5.1 NACP-Inward-First | 方法论 | Opus 方法论提炼 |
| §5.2 Publishing-Before-Scaffolding | 方法论 | Opus + publishing 硬理由 |
| §5.3 Blueprint-Before-Absorption | 方法论 | Opus + 分离 design 与 execution |
| §5.4 One-Dry-Run-As-Pattern | 方法论 | Opus 提案 |
| §5.5 Empty-Shell-Deploy-Discipline | 方法论 | 继承 plan-after-foundations §1.1 |
| §8 DAG | 执行顺序 | Opus 建议,已标出 W3 dry-run 依赖 W4 agent-core 目录 |
| §11 Exit Criteria | 退出条件 | 基于 4.1 In-Scope 推出 |
| §12 worker-matrix rewrite | 下一阶段触发 | Owner 明确要求本阶段后 rewrite worker-matrix |

---

## 16. 结语

本 charter 的诞生是 nano-agent "不断把 gap 显性化,再用专门 phase 收束" 纪律的又一次体现。从 Opus 单 worker 提案,到 5-worker matrix,到 3-worker + 2 reserved,到 spike-driven after-foundations,到 B9 post-review integration,到 4-worker context bundle,到 packages 定位辩证,再到本 pre-worker-matrix charter —— 每一步都把下一阶段的起点推得更稳一点。

> **Pre-Worker-Matrix 不是 worker-matrix 的预热,也不是 after-foundations 的延长。它是**"协议最终形态 + 发布流水线 + 新协议设计 + absorption blueprint + workers 脚手架"**5 件本该分离完成的工程 prerequisites 的集中闭合 phase。它不建任何 worker 能力,但它让 worker-matrix 真正能做 worker-matrix 该做的事。**

进入下一阶段(worker-matrix 实施 / r2 rewrite),我们将拥有:

- `nacp-core 1.4.0` + `nacp-session` 真实发布到 GitHub Packages 并 dogfood 验证
- 3 条新跨 worker 协议(workspace RPC + remote compact + evidence forwarding)shipped + contract-tested
- 10 份 Tier B package absorption blueprint + 1 份 dry-run pattern
- `workers/` 顶级目录 + 4 个空 worker 项目 + 4 个 真实 Cloudflare deploy + per-worker CI
- 6 份 closure + handoff memo
- `plan-worker-matrix.md` 触发进入 r2 rewrite

worker-matrix 阶段不会再问"NACP 形态是否稳定"、"跨 worker 协议是否就绪"、"packages 如何切"、"workers 目录怎么建"—— 这 4 类问题在本阶段已经被答完。worker-matrix 阶段只需做一件事:**按 blueprint 把 Tier B packages 吸收进 4 个 worker,装配 live agent turn loop,完成 cross-worker 服务绑定通讯**。

---

## 17. 维护约定

- 本 charter owner-approved 后不再频繁修订;任何修订需明确触发源
- 修订时必须在顶部"修订历史"列出 r1 → r2 → ...
- 下游 design / RFC / action-plan 若与本 charter 冲突,以本 charter 为准;除非下游文档承载 owner 新决策,此时修本 charter
- 本阶段是 `plan-after-foundations.md` → `plan-worker-matrix.md` 之间**强制性的中间 phase**,绕过本阶段直接进入 worker-matrix 是架构反模式
- 本阶段闭合的硬标志之一:`plan-worker-matrix.md` 的 deprecated banner 解除,进入 r2 rewrite cycle
