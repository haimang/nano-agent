# Nano-Agent 功能簇设计模板

> 功能簇: `RH0 Bug Fix and Prep`
> 讨论日期: `2026-04-29`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告:
> - `docs/charter/plan-real-to-hero.md`
> - `docs/charter/review/plan-real-to-hero-reviewed-by-GPT.md`
> 关联 QNA / 决策登记:
> - `docs/design/real-to-hero/RHX-qna.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

RH0 不是功能 phase，而是 real-to-hero 的启动闸门。它要把“开始前必须真的成立”的东西一次收紧：`jwt-shared` 可独立 build/test、ZX5 新 endpoint 有直达测试、KV/R2 binding 占位不再依赖口头约定、NanoSessionDO 拆分准备先做出切口、preview deploy 前的 owner tooling readiness 变成可审计记录。只有 RH0 处理完，RH1-RH6 才不会在实施中途被环境、测试和巨石文件拖垮。

- **项目定位回顾**：`real-to-hero` 的目标是从 partial-close 进入真实产品基线，RH0 负责把后续 6 个 implementation phase 的施工前提冻结。
- **本次讨论的前置共识**：
  - 不新增 worker，不引入 SQLite-DO。
  - RH0 之后所有 phase 都必须遵守“design + action-plan 先于 implementation”的 gate。
- **本设计必须回答的问题**：
  - RH0 到底要收什么，才算“可以开始 RH1”？
  - 哪些属于基础设施预备，哪些不能偷渡成 feature implementation？
- **显式排除的讨论范围**：
  - Lane F live runtime 本体
  - RH2-RH6 的功能实现细节

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`RH0 Bug Fix and Prep`
- **一句话定义**：`把 real-to-hero 的启动前提冻结成可验证的构建、测试、配置与拆分预备基线。`
- **边界描述**：这个功能簇**包含** `jwt-shared` 独立可构建、ZX5 endpoint 测试补齐、KV/R2 binding 占位、NanoSessionDO verify/persistence 预拆分、bootstrap hardening 与 owner tooling checklist；**不包含** RH1-RH6 的 runtime feature 落地。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| Start Gate | 允许进入 RH0 implementation 的硬条件 | 由 charter §8.3 定义 |
| endpoint-level 直达测试 | 对 public endpoint 的直接请求测试，不依赖别的 handler 顺便覆盖 | 每个新增 endpoint ≥5 用例 |
| bootstrap hardening | 在真实凭据和平台资源存在前，对 deploy/build/test 前提做显式验证 | 不等于 feature hardening |
| megafile prep | 先切出后续拆分边界，避免 RH1-RH5 继续把逻辑堆进巨石 | RH0 只做 verify/persistence 预拆分 |

### 1.2 参考调查报告

- `docs/charter/plan-real-to-hero.md` — §7.1、§8.3、§9.2、§12 Q5
- `docs/charter/review/plan-real-to-hero-reviewed-by-GPT.md` — 先前对 start gate / deferred mapping / testing discipline 的 blocker 说明

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- RH0 在整体架构里扮演 **phase bootstrap freeze** 的角色。
- 它服务于：
  - RH1-RH6 所有后续 implementation
  - preview deploy / owner tooling readiness
  - closure 中的“测试矩阵不回归”承诺
- 它依赖：
  - `packages/jwt-shared`
  - root test scripts
  - 当前 `NanoSessionDO` / `user-do.ts` 巨石现实
  - owner 对 `RHX-qna` Q5 的回答
- 它被谁依赖：
  - RH1 live runtime 改造
  - RH4 KV/R2 / filesystem migration
  - RH6 megafile decomposition

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| RH1 Lane F | RH0 -> RH1 | 强 | RH1 必须站在已冻结测试与拆分切口上 |
| RH4 Filesystem | RH0 -> RH4 | 中 | RH0 先把 KV/R2 binding 占位与 owner checklist 明确 |
| RH6 拆分 | RH0 -> RH6 | 强 | RH0 先做 verify/persistence 预拆分，RH6 才能完成大拆 |
| Root test matrix | RH0 <-> tests | 强 | RH0 要定义后续所有 phase 的最小验证纪律 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`RH0 Bug Fix and Prep` 是 **real-to-hero 的启动闸门**，负责 **把构建、测试、配置和巨石切口冻结成真实前提**，对上游提供 **可启动的实现基线**，对下游要求 **后续 phase 不再拿未冻结前提当借口**。"

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| 在 RH0 直接实现 Lane F / Models / Files 功能 | “顺手做一点 feature” 的诱因 | RH0 的目标是冻结施工前提，不是抢跑后续 phase | 否 |
| 把 owner tooling readiness 藏在口头约定里 | 过去依赖记忆 / 环境经验 | 无法审计，且一旦失败会在实施中途才爆 | 否 |
| 用“现有测试已够用”替代 endpoint-level 直达测试 | 依赖间接覆盖最省事 | 会再次放过需要 body / route / auth 的 drift | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段 / 文档入口) | 第一版行为 | 未来可能的演进方向 |
|--------|--------------------------------------------------|------------|---------------------|
| RH0 tooling checklist | `docs/owner-decisions/real-to-hero-tooling.md` | 记录 owner 当日验证结果 | 后续阶段复用为 deploy readiness 审计格式 |
| endpoint test baseline | worker test files / root test scripts | 给 RH1-RH6 提供统一验证门槛 | 后续按 phase 增补场景，但不回退纪律 |
| megafile pre-split seam | `session-do-verify` / `session-do-persistence` 目标边界 | 先切切口，不做全量拆分 | RH6 完成全拆 |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：`RH0 prep` vs `RH1-RH6 feature`
- **解耦原因**：如果 RH0 同时承担 feature implementation，Start Gate 就会失真，后续 phase 的风险也会被提前混进来。
- **依赖边界**：RH0 只冻结前提，不在功能面上声称“已经闭环”。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：测试纪律、tooling readiness、巨石切口
- **聚合形式**：全部先收敛到 RH0 设计与 action-plan，而不是分散到 RH1-RH6 各自补票
- **为什么不能分散**：这些都是后续 phase 的共享前提，分散之后很难形成统一 gate

---

## 4. 参考实现 / 历史 precedent 对比

### 4.1 当前仓库的做法

- **实现概要**：仓库已经有 root contracts / e2e scripts、`jwt-shared` 独立包，以及两份巨石文件，但这些前提还没被正式收口为 real-to-hero 的启动基线。
- **亮点**：
  - `jwt-shared` 已具备独立 build/typecheck/test 脚本
  - root 测试脚本已经分 contracts / package-e2e / cross-e2e
- **值得借鉴**：
  - 直接复用现有脚本和包边界，不另造 RH0 专属工具
- **不打算照抄的地方**：
  - 继续依赖“已有脚本存在 = gate 已满足”的宽松口径

### 4.2 zero-to-real 阶段留下的前例

- **实现概要**：上一阶段的问题集中在“基础设施 landed，但 wiring / gate / evidence 没跟上”。
- **亮点**：
  - 已经证明 design/action-plan/closure 三段式文档机制可工作
- **值得借鉴**：
  - 把 deferred 明确升级成 charter 正文，不再放 closing thoughts
- **不打算照抄的地方**：
  - 让未冻结的前提混进 implementation 再边做边补

### 4.3 本阶段的设计倾向

- **实现概要**：先把 start gate 做实，再放行 RH1-RH6。
- **亮点**：
  - 把 owner-action 与代码施工边界分开
- **值得借鉴**：
  - 用最小必要的 prep 支撑后续 phase，而不是在 RH0 全量预实现
- **不打算照抄的地方**：
  - 让 RH0 变成“大杂烩 phase”

### 4.4 横向对比速查表

| 维度 | 当前仓库 | zero-to-real 经验 | real-to-hero RH0 倾向 |
|------|----------|-------------------|------------------------|
| gate 明确度 | 中 | 偏弱 | 高 |
| tooling 可审计性 | 低 | 低 | 高 |
| 测试纪律显式度 | 中 | 不均匀 | 高 |
| 巨石预拆分 | 低 | 低 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1]** `jwt-shared` 独立构建基线冻结 — RH0 必须保证 auth shared contract 不再因 lockfile / importer 漂移阻塞后续 phase。
- **[S2]** ZX5 / RH public endpoint 直达测试基线 — 后续所有 phase 都依赖这条统一纪律。
- **[S3]** KV / R2 binding 占位与 owner tooling checklist — RH4/RH5 的平台资源前提必须在 RH0 先显式存在。
- **[S4]** NanoSessionDO verify / persistence 预拆分 — 为 RH1-RH6 减少继续向巨石堆逻辑的诱因。
- **[S5]** bootstrap hardening 与 preview deploy readiness — 让 RH0 真正成为 implementation start gate。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1]** Lane F dispatcher / permission waiters live wiring — `RH1` 才是 live runtime phase；重评条件：无
- **[O2]** `/models`、`/context`、`/files`、多模型、多模态等产品能力 — 这些分别属于 RH2/RH4/RH5；重评条件：无
- **[O3]** 完整 NanoSessionDO / user-do.ts 全拆 — RH0 只做预拆分；重评条件：进入 RH6

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| RH0 内顺手补一个 Lane F runtime path | out-of-scope | 会污染 start gate 定义 | RH1 |
| 在 RH0 新增 root-level 自定义测试工具 | out-of-scope | 现有脚本足够，重点是冻结纪律 | action-plan 只复用现有脚本 |
| verify/persistence 预拆分 | in-scope | 是后续拆分和 feature 实施的共用切口 | RH0 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **先冻结施工前提** 而不是 **RH0 直接混入 feature implementation**
   - **为什么**：后续 phase 的失败点已经非常明确，不应再次把环境 / 测试 / 巨石问题推迟。
   - **我们接受的代价**：RH0 的“功能可见性”较低，看起来不像 feature 进展。
   - **未来重评条件**：无。

2. **取舍 2**：我们选择 **沿用现有测试 / 包脚本并把纪律写清楚** 而不是 **另造 RH0 专属工具链**
   - **为什么**：当前真正缺的是 gate，不是工具。
   - **我们接受的代价**：需要在 action-plan 中更严格地组织已有脚本，而不是靠新工具掩盖问题。
   - **未来重评条件**：无。

3. **取舍 3**：我们选择 **预拆分 verify/persistence 切口** 而不是 **等 RH6 再一次性拆大文件**
   - **为什么**：RH1-RH5 都要继续在这些文件上施工，完全不做切口会让冲突更难收敛。
   - **我们接受的代价**：RH0 会有少量重构工作，不只是纯文档 / 测试 phase。
   - **未来重评条件**：如果 RH1-RH5 之前就决定整体重写 session host，可再评估。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| RH0 scope 膨胀 | 把后续功能混入 prep | Start Gate 失真 | 只接受前提冻结项 |
| owner checklist 未执行 | 凭据 / 资源前提继续停留在假设 | RH0 进入 implementation 后中途卡死 | 用 RHX-qna Q5 + owner-decisions 文档固定 |
| megafile pre-split 做得太浅 | RH1-RH5 继续把逻辑堆回主文件 | RH6 拆分成本上升 | 在 RH0 设计里先明确 verify/persistence 作为独立切面 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：减少后续 phase 在构建、测试和环境问题上的返工。
- **对 nano-agent 的长期演进**：把 implementation gate 从“口头认可”升级为“文档+测试+owner action”三位一体。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：让所有后续运行时与客户端能力都建立在可验证基线之上。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | Shared Build Freeze | 冻结 `jwt-shared` 的独立构建 / 测试 / 发布前提；**lockfile 完整重建（jwt-shared 当前在 pnpm-lock.yaml 中完全缺失，并存在 ≥2 条已删除包的 stale importer，必须一并清理）** | ✅ `jwt-shared` 不再成为 auth 链路的隐性 blocker，`pnpm install --frozen-lockfile` 在 fresh checkout 下可确定 |
| F2 | Endpoint Test Baseline | 为 ZX5 / RH public endpoints 建立统一直达测试纪律；**首批必补：messages/files/me-conversations/me-devices/me-devices-revoke 等当前 0 覆盖 ZX5 endpoint** | ✅ `后续 phase 的 public endpoint 都有统一验收底座` |
| F3 | Storage Bootstrap Prep | 把 KV/R2/binding/tooling readiness 显式化；**RH0 是 6 个 worker `wrangler.jsonc` 中 KV namespace 与 R2 bucket binding 的首次声明（当前完全缺失，不是“占位声明”），必须保证 dry-run 通过且 binding 在 env 中可见** | ✅ `RH4/RH5 不再依赖“应该已经有资源”` |
| F4 | Megafile Prep Split | 给 NanoSessionDO 切出 verify / persistence 预拆分边界 | ✅ `RH1-RH6 有可持续施工切口` |
| F5 | Post-Fix Preview Verification (P0-E) | preview deploy + manual smoke + 写 `docs/issue/zero-to-real/post-fix-verification.md` | ✅ `RH0 完成后存在可审计的 preview 验证证据` |
| F6 | Bootstrap Hardening (P0-G) | 写 `bootstrap-hardening.test.ts`，覆盖 cold-start 100 并发 register / D1 慢响应 5s / refresh chain 旋转风暴 | ✅ `RH0 不再让 stress 失败留到 RH1+ 才暴露` |

### 7.2 详细阐述

#### F1: `Shared Build Freeze`

- **输入**：`packages/jwt-shared` 当前 package 结构、root workspace 测试脚本、owner 的 GitHub Packages 凭据
- **输出**：`jwt-shared` 的稳定 build/typecheck/test 基线与 importer 清单
- **主要调用者**：`orchestrator-core`、`orchestrator-auth`
- **核心逻辑**：先确保 shared auth helper 能独立通过，再允许后续 auth / device / API key phase 在此基础上扩展。
- **边界情况**：
  - `NODE_AUTH_TOKEN` 缺失时必须被 RH0 tooling checklist 捕获，而不是在后续 phase 隐式失败。
- **一句话收口目标**：✅ **`jwt-shared build/typecheck/test 成为 RH0 的显式 gate，而不是偶然能过的包`**

#### F2: `Endpoint Test Baseline`

- **输入**：`package.json` 现有 root scripts、当前 ZX5 public endpoints
- **输出**：各 worker phase 后续要遵守的 endpoint-level 测试纪律
- **主要调用者**：RH1-RH5 implementation 与 closure
- **核心逻辑**：把“每个新增 public endpoint ≥5 用例”的规则落成后续 action-plan 的统一验收口径。
- **边界情况**：
  - 不能用跨 worker e2e 替代 endpoint-level 测试。
- **一句话收口目标**：✅ **`后续 phase 不再能用“已有集成测试”替代 endpoint 直达测试`**

#### F3: `Storage Bootstrap Prep`

- **输入**：Cloudflare KV/R2/AI/identity 资源前提、wrangler bindings、owner tooling readiness
- **输出**：显式的 placeholder / binding / checklist 规则
- **主要调用者**：RH4 file pipeline、RH5 multi-model、preview deploy
- **核心逻辑**：把“资源存在”从假设改成可核对事实。
- **边界情况**：
  - owner checklist 未执行时，RH0 不应宣称完成 start gate。
- **一句话收口目标**：✅ **`资源与凭据 readiness 可以被审计，而不是被猜测`**

#### F4: `Megafile Prep Split`

- **输入**：`NanoSessionDO` 当前 2078 行实现、后续 RH1-RH6 的改造面
- **输出**：verify / persistence 两个优先切面的拆分边界
- **主要调用者**：agent-core session host 改造
- **核心逻辑**：先把最容易被持续修改、且可独立抽出的块剥离出主文件。
- **边界情况**：
  - RH0 不追求一次性主文件大幅缩短，只要求建立可持续切口。
- **一句话收口目标**：✅ **`RH0 结束后，不再需要把所有新逻辑继续塞进 NanoSessionDO 主文件`**

### 7.3 非功能性要求与验证策略

- **性能目标**：RH0 不引入新的热路径延迟；重点是构建、测试与配置前提
- **可观测性要求**：owner checklist 与 preview smoke 结果可被文档化追溯
- **稳定性要求**：不允许破坏现有 root contracts / package-e2e / cross-e2e 基线
- **安全 / 权限要求**：凭据检查只读、不把 secret 落进仓库
- **测试覆盖要求**：遵守 charter §9.2 的 endpoint / RPC / preview smoke 纪律
- **验证策略**：以现有 `package.json` 脚本、`jwt-shared` 包脚本、preview smoke 和 owner checklist 证明 RH0 真正完成

---

## 8. 可借鉴的代码位置清单

### 8.1 Shared package / tests

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `packages/jwt-shared/package.json:1-35` | `jwt-shared` 独立包脚本与发布设置 | RH0 应直接复用其独立 build/typecheck/test seam | shared auth single source |
| `package.json:7-14` | root contracts / package-e2e / cross-e2e scripts | RH0 不新增新工具，只冻结现有测试纪律 | root single source |

### 8.2 Megafile reality

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `workers/agent-core/src/host/do/nano-session-do.ts:159-2078` | 当前 `NanoSessionDO` 巨石 | RH0 预拆分与 RH6 完整拆分都以此为起点 | 当前文件 2078 行 |
| `workers/orchestrator-core/src/user-do.ts:1-2285` | 当前 `user-do.ts` 巨石 | RH0 虽不直接拆它，但必须把 RH6 风险提前纳入设计 | 当前文件 2285 行 |

### 8.3 Runtime prep touchpoints

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `workers/agent-core/src/host/do/nano-session-do.ts:481-502` | `createLiveKernelRunner()` 当前仍带 deferred callback / no-op现实 | RH0 只做拆分准备，不在这里抢跑 RH1 | RH1 真正接线 |
| `workers/orchestrator-core/src/user-do.ts:755-989` | `/start` 的幂等 claim 与 durable truth 流程 | RH0 endpoint baseline 可直接围绕这类路径补齐测试 | ZX5 hot path |

### 8.4 已建成资产（不要重复实现）

> 多审查 cross-cutting：仓库中已存在但被 RH1/RH4/RH5 设计忽略的成熟资产。RH0 不直接消费它们，但需要在 endpoint baseline / megafile prep 任务里**显式记录其存在**，避免下游 phase action-plan 误把"激活"当成"从零搭"。

| 文件:行 | 内容 | 借鉴点 / 备注 |
|---------|------|----------------|
| `workers/agent-core/src/hooks/dispatcher.ts:1-149` | 完整 hook dispatcher（registry/matcher/runtime/timeout/exception/blocking/non-blocking）| RH1 F1 仅缺 wiring，不需要 build dispatcher 本体 |
| `workers/agent-core/src/kernel/types.ts:30,62` + `kernel/runner.ts:111-115,415` | `StepKind/StepDecision` 已含 `hook_emit` 变体，runner 已有 `handleHookEmit` case | RH1 P1-B 实际只需修改 `scheduler.ts` 让其产生 hook_emit 决策 |
| `workers/filesystem-core/src/storage/adapters/{r2,kv,d1}-adapter.ts:1-484` | R2/KV/D1 适配器各 132-214 行的生产级实现 | RH4 F1 工作量是"组装到 ArtifactStore + 启用 binding"，不是"实装适配器" |
| `workers/agent-core/src/llm/canonical.ts:46-50` + `llm/request-builder.ts:81-92` | `ImageUrlContentPart` canonical 类型 + vision capability check（含 `CAPABILITY_MISSING` throw）| RH5 F3 需在此基础上：①修正 supportsVision 标记或注册新 vision 模型；②扩 `/messages` ingress 接受 `image_url` kind |

---

## 9. 多审查修订记录（2026-04-29 design rereview）

> 来源：`docs/eval/real-to-hero/design-docs-reviewed-by-{GPT,deepseek,GLM,kimi}.md`
> 修订口径：业主审查后 implementer 仅修订设计文档以贴近代码现实，不直接改实现代码。

### 9.1 已确认并采纳的修订

| 编号 | 审查者 | 原 finding | 已采纳的修订 |
|------|--------|-------------|---------------|
| K-R1 / GLM-R14 / DS-R5 | kimi/GLM/deepseek 共识 | pnpm-lock.yaml 中 jwt-shared **完全缺失**（非 stale），且存在 ≥2 条已删除包的 stale importer | §7.1 F1 升级：lockfile 重建 + stale importer 清理；§7.2 F1 边界情况补充 fresh checkout 下的 frozen-lockfile 验证 |
| K-R2 | kimi | 6 worker wrangler.jsonc 完全无 KV/R2 声明（非"占位"）| §7.1 F3 改为"首次声明"，并要求 dry-run 通过 + env 可见 |
| GPT-R8 | GPT | P0-E / P0-G 应升为一等 feature | §7.1 新增 F5（Post-Fix Preview Verification）+ F6（Bootstrap Hardening 三个 stress case）|
| GLM-R7 | GLM | RH0 §8.2 行号 `481-502` 偏移 | §8.3 行号保持原样并加注 `截至 2026-04-29 代码快照`，由 RH0 action-plan 二次校验 |
| DS-R3/R4/R7 | deepseek | 已建成 hooks/dispatcher、storage adapters、kernel hook_emit 预路由资产被忽略 | 新增 §8.4「已建成资产清单」，明确给出引用，下游 RH1/RH4/RH5 action-plan 必须站在此清单之上 |

### 9.2 已审视但 **未采纳** 的建议（带理由）

| 编号 | 审查者 | 原建议 | 不采纳理由 |
|------|--------|--------|-----------|
| GLM "verification subsystem 也作 RH0 切口" | GLM | RH0 顺手切 verification subsystem | RH6 才负责完整拆分；RH0 仅做 verify/persistence 预拆分，扩范围会污染 Start Gate |
| kimi "全部行号补 2026-04-29 注释" | kimi | 全文逐行号补注释 | 由 action-plan 阶段统一校验，不在 design 这一层加噪 |
