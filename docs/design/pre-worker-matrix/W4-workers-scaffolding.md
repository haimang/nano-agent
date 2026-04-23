# W4 — `workers/` Scaffolding & Cloudflare Deploy Validation

> 功能簇:`pre-worker-matrix / W4 / workers-scaffolding`
> 讨论日期:`2026-04-21`
> 讨论者:`Claude Opus 4.7 (1M context)` + owner pending review
> 关联文档:
> - Charter: `docs/plan-pre-worker-matrix.md` §4.1 E / §7.5
> - Owner 决策:`docs/plan-pre-worker-matrix.md` §1.2(`workers/` 顶级目录)
> - 前置 design:
>   - `W0-nacp-consolidation.md`(nacp-core 1.4.0 shape)
>   - `W1-cross-worker-protocols.md`(协议 shape;wrangler 里预留 service binding 名对应 W1 设想的 workers)
>   - `W2-publishing-pipeline.md`(import/publish 策略与 W4 package resolution 的前置)
>   - `W3-absorption-blueprint-and-dryrun.md`(v0.2 optional capability-runtime dry-run;若执行,落点 `workers/bash-core/src/`,与 W4 时序协同)
> - 模板参考:
>   - `docs/templates/wrangler-worker.toml`(B8 shipped,evidence-backed 注释;W4 转 `.jsonc` 格式)
>   - `docs/templates/composition-factory.ts`(B8 shipped,真实 composition factory 时复用)
> - 后继 design:`W5-closure-and-handoff.md`(消费 W4 的 4 workers 就绪状态)
> 文档状态:`draft (v0.3 post-GPT-R5-review: body fully aligned — §7 S-table / §9 verdict / §0 relation 均为 1 real + 3 dry-run)`
>
> **修订历史**:
> - v0.1 (2026-04-21):初稿。4 workers 真实 deploy 到 Cloudflare
> - v0.2 (2026-04-21):Post-GPT-review narrowing(顶部 / §0 / §5.1 In-Scope / §5.5 纪律):4 real deploy 降为 **1 real(agent-core)+ 3 dry-run(bash-core / context-core / filesystem-core 各自 `wrangler deploy --dry-run`)**;配合 W2 parallel publishing 允许 `workspace:*` interim
> - v0.3 (2026-04-21):Post-GPT-R5 body-level narrowing。§7.1 S7/S8 功能表、§7.2 S7 执行步骤 / S8 closure memo、§9.1 画像 / §9.2 verdict、§0.4 显式排除 / §2.2 interaction matrix / §5.3 边界 / §0.3 前置共识 全部与 §0.2 空壳表保持 "agent-core 1 real + 3 workers dry-run" 一致;W3 协同从 llm-wrapper / agent-core/src/llm/ 改为 capability-runtime / bash-core/src/

---

## 0. 背景与前置约束

### 0.1 为什么 W4 必须在 pre-worker-matrix 阶段做

owner 的 `workers/` 顶级目录决策(`plan-pre-worker-matrix.md` §1.2)要求每个 first-wave worker 有独立 `wrangler.jsonc / package.json / src / test`。W4 负责把这个目录**从 0 建立到 4 个脚手架就绪 + agent-core 真实 deploy 1 次 + 其他 3 worker dry-run**(v0.2 narrower)。

为什么必须在 pre-worker-matrix 而非 worker-matrix P0 做:

1. **DevOps 链路验证(收窄到 agent-core 1 次)**:agent-core 1 次真实 `wrangler deploy --env preview` 验证完整 DevOps 链路(wrangler / CF account / TS build / NACP bundle);其他 3 workers `wrangler deploy --dry-run` 验证同构 shape;**不需要 4 次真实 deploy**(GPT review 盲点 1)
2. **W3 代表性 dry-run(若做)目的地依赖**:若 W3 执行 optional capability-runtime dry-run,需要 `workers/bash-core/` 目录存在;W4 先建比 W3 先建 stub 更一致(v0.2 调整:原 W3 目标从 llm-wrapper 改 capability-runtime)
3. **GitHub Packages 非硬依赖(v0.2 parallel)**:workers `package.json` 可用 `workspace:*` interim;若 W2 首发已完成,可切 `@<scope>/nacp-core@1.4.0`;W4 不 block 在 W2 首发上
4. **空壳即脚手架**:worker-matrix P0 absorb 时直接填 `src/`,不需再建 `wrangler.jsonc` / `package.json`,架构一致性

### 0.2 空壳(shell) vs 实装 worker 的严格区分

本 design 反复使用"空壳 worker",必须明确语义:

| 维度 | W4 产出的空壳(v0.2) | worker-matrix P0 的实装 worker |
|---|---|---|
| `wrangler.jsonc` | 完整,含 bindings slots(即便未接真实对端) | 与 W4 同结构;只有 binding target 真实配置 |
| `package.json` | deps 含 NACP 2 包 **via `workspace:*` interim OR via GitHub Packages**(依 W2 首发状态) | 切 published version;额外加 absorption 后的 runtime deps |
| `src/index.ts` | hello-world fetch handler,无业务 | 完整业务逻辑(absorb 后) |
| `test/` | shell-level smoke test 3-5 个 | unit + integration + cross-worker |
| Cloudflare deploy | ✅ **agent-core 1 次 real deploy**(到 `<name>.workers.dev`)+ **3 workers `wrangler deploy --dry-run`** | 全部 worker 业务 live deploy |
| NACP import | ✅ agent-core 已 import + deploy 证明路径通(workspace:* OR published,二者之一) | 同 import,但消费更深 |
| Business capability | **无** | **有** |

**核心纪律(v0.2)**:W4 空壳 deploy 成功,**不等于** worker 已 "ready for production";等于 "wrangler 配置 + NACP resolve(via workspace:* 或 GitHub Packages,二者之一)+ Cloudflare deploy 链路 end-to-end 可用"。DevOps 链路验证 1 次(agent-core)已足够;3 workers dry-run 验证 shape 同构。这两个语义要在 W4 closure memo 里明确区分。

### 0.3 前置共识(不再辩论)

- **4 个 worker,skill.core 保持 reserved**:charter §4.2 F [O14] 明确 skill.core 不在本阶段
- **目录命名用 kebab-case**:`workers/agent-core/`(因为 npm / wrangler 命名规范 + pnpm workspace glob 友好);NACP producer_key 语义可保留 `agent.core`
- **`wrangler.jsonc` 而非 `.toml`**:charter §7.5 item 41 明确 `jsonc`
- **NACP 包 import 策略(v0.2 parallel)**:workers 允许 `workspace:*` interim(若 W2 未首发)或 `@<scope>/nacp-core@1.4.0`(若已首发);二者任一 build 通即可;切换时机由 worker-matrix 阶段决定
- **agent-core 真实 deploy + 3 workers dry-run(v0.2)**:继承 charter §5.5 Empty-Shell-Deploy-Discipline 但**只对 agent-core 做 1 次真实 deploy**;其他 3 workers `wrangler deploy --dry-run` 即可
- **CI 采用 matrix workflow(单 YAML 跑 4 workers)**:charter §7.5 item 44 方案 B
- **空壳阶段 DO binding / KV / R2 / D1 暂不实际绑定**:只声明 slot;具体资源创建在 worker-matrix P0
- **共存 workspace**:`pnpm-workspace.yaml` 同时 include `packages/*` + `workers/*`

### 0.4 显式排除

- 不吸收任何 Tier B package 代码进 workers(那是 worker-matrix P0;W4 仅建脚手架;例外:若 W3 执行 optional capability-runtime dry-run,产出会落入 `workers/bash-core/src/`,但那属 W3 scope)
- 不实装任何业务逻辑(tool.call 消费 / workspace 操作 / kernel 推进 等全部 P0)
- 不配置真实的 service binding 连通(4 worker 互相 call 的逻辑属 P0)
- 不创建真实 DO / KV / R2 / D1 实例(`wrangler.jsonc` 用占位 ID 或 owner 提供)
- 不处理 custom domain 路由(空壳用 `<name>.workers.dev` 即可)
- 不写 CI 的生产 deploy workflow(W4 阶段 deploy 由手工或 `--env preview` 触发;正式 tag-triggered deploy 属未来 worker-matrix phase)
- 不处理 secrets management 生产实践(空壳不需要秘密)

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**:`workers/ Scaffolding & Cloudflare Deploy Validation`
- **一句话定义**:在 nano-agent repo 建 `workers/` 顶级目录,产出 4 个独立 worker 空壳项目,每个有完整 `wrangler.jsonc + package.json + src/index.ts + test/smoke + tsconfig.json + README + .gitignore`,真实 deploy 到 Cloudflare 并通过独立 URL 证明链路端到端可用,同时建立 per-worker CI matrix
- **边界描述**:
  - **包含(v0.2 narrower)**:`workers/` 目录 + 4 worker shell + `pnpm-workspace.yaml` 更新 + **agent-core 1 次真实 Cloudflare deploy(1 URL)+ 3 workers `wrangler deploy --dry-run`** + matrix CI workflow + evidence 归档
  - **不包含**:业务代码;Tier B absorption(W3 dry-run 除外);service binding 真实连通;DO / KV / R2 / D1 资源创建;生产 deploy 流水线

### 1.2 关键术语对齐

| 术语 | 定义 | 备注 |
|---|---|---|
| shell(空壳)| `wrangler.jsonc + package.json + src/index.ts(hello-world)+ smoke test` 五件套,具备 deploy-validated 能力但无业务 | W4 产出核心 |
| hello-world fetch handler | 极简 `export default { fetch(req) { return Response.json({ worker, nacp_version, status }) } }` | §7.2 S4 详细 |
| binding slot | `wrangler.jsonc` 里声明的 binding 名 + target,空壳阶段 target 可占位 | §6.1 取舍 3 |
| preview env | `wrangler deploy --env preview` 使用的独立 deployment | §6.1 取舍 4 |
| workers.dev subdomain | Cloudflare 免费提供的 `<name>.<account>.workers.dev` URL | 空壳默认 deploy 目标 |
| matrix CI | GitHub Actions 的 `strategy.matrix` 跑 4 workers | charter §7.5 item 44 方案 B |
| worker name(wrangler)vs directory name | `wrangler.jsonc.name` 是 Cloudflare 上的 worker 名 | W4 规定三者一致 |

### 1.3 参考上下文

- B8 `docs/templates/wrangler-worker.toml`(shipped 2026-04-21 的模板,含 evidence-backed 注释)
- B8 `docs/templates/composition-factory.ts`(shipped,真实 composition 时复用)
- `packages/session-do-runtime/wrangler.jsonc`(现有 jsonc 格式先例)
- W2 dogfood 消费者 `dogfood/nacp-consume-test/`(同类 GitHub Packages consumer;但 dogfood 不 deploy 到 Cloudflare;W4 多了一层 deploy validation)
- Cloudflare Workers 文档 — Durable Objects binding 格式、service binding 格式、compatibility_date / flags

### 1.4 4 个 worker 的预期角色速查(W4 仅预留 slot,不实装)

| Worker | 在 worker-matrix P0 的角色 | W4 空壳 bindings |
|---|---|---|
| `agent-core` | host worker:持 SESSION_DO,接 WS/HTTP client | DO binding slot(NanoSessionDO stub)+ KV + R2 + 3 个下游 SERVICE bindings |
| `bash-core` | capability worker:消费 `tool.call.*` | 无 DO;可选 R2(future artifact)+ 自身 outgoing fetch |
| `context-core` | context substrate worker:消费 `context.compact.*` + `workspace.fs.*` client | 无 DO;可选 KV(summary)+ 上游 FILESYSTEM_CORE service binding |
| `filesystem-core` | workspace authority:提供 `workspace.fs.*`(W1) | 可能 DO (persistent workspace)+ R2 + KV |

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **整体架构里的角色**:脚手架 + DevOps 验证层;把 owner "`workers/` 顶级目录" 决策从字面变成物理事实
- **服务于**:
  - W2(提供 future published consumer 的着陆点,但不是硬前置)
  - W3(provides `workers/bash-core/` 等目的地目录给 map / blueprint / optional dry-run)
  - worker-matrix P0(provides shell,absorption 直接填 src)
- **依赖**:
  - W2 skeleton 就绪(或至少明确 workers 采用 `workspace:*` interim 路径)
  - W1 设计可读(wrangler service binding 名与 W1 worker 命名对齐)
  - Owner 提供 Cloudflare account(deploy 需要)
- **被谁依赖**:
  - W3 的 optional dry-run(若执行,优先复用 `workers/bash-core/`)
  - W5 closure(引用 agent-core 1 个 deploy URL + 3 dry-run log + CI pass)
  - worker-matrix P0 全部 absorption

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| `pnpm-workspace.yaml` | W4 modify | 强 | 加 `workers/*` 必须;不替换 `packages/*` |
| `dogfood/` | W4 参考但无依赖 | 弱 | W4 的 package.json 风格参考 dogfood;但独立 |
| `packages/session-do-runtime/wrangler.jsonc` | W4 参考格式 | 中 | jsonc 格式先例 |
| `docs/templates/wrangler-worker.toml` | W4 转格式使用 | 强 | 模板语义 → jsonc 格式化 |
| `.github/workflows/publish-nacp.yml`(W2) | W4 平行 | 弱 | 两个独立 workflow;互不干扰 |
| `.github/workflows/workers.yml`(本 design S6) | W4 create | 强 | W4 核心产出 |
| Cloudflare Account | W4 consume | 强 | deploy 必须;owner-gated |
| W2 import/publish 策略 | W4 consume | 中 | workers 可先用 `workspace:*`,也可在首发后切 published version |
| `workers/bash-core/src/`(W3 optional dry-run 产出,若执行) | W4 coexist | 弱-中 | W4 建 `workers/bash-core/` 目录;W3 若执行 optional capability-runtime dry-run,其产出落入该目录 |
| `packages/*` | W4 coexist | 弱 | workspace 同时 include 两者 |

### 2.3 一句话定位陈述

> 在 nano-agent 里,`workers/ Scaffolding & Cloudflare Deploy Validation` 是**脚手架 + DevOps 验证层**,负责**建立 `workers/` 顶级目录并产出 4 个 deploy-shaped 空壳 worker 项目**,对上游(owner `workers/` 决策)提供**物理目录 + agent-core 1 次真实 deploy / 其余 3 个 dry-run 的最小证明**,对下游(W3 dry-run + worker-matrix P0)要求**按 W4 冻结的项目结构直接填业务代码而不重建脚手架**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点(哪里可以砍)

| 被砍项 | 来源 / 对标 | 砍的理由 | 未来是否回补 |
|---|---|---|---|
| 为每个 worker 单独写 CI workflow | 最自然方案 | 4 个 workflow 内容 90% 重复;matrix 方案足够 | 否(matrix 长期可用) |
| 空壳阶段接真实 service binding 对端 | 最理想状态 | W4 时 4 worker 都是 hello-world,互相 call 无意义 | worker-matrix P0 实装 |
| Custom domain / route 配置 | 生产级 deploy | `<name>.workers.dev` 已足够验证链路 | 若未来对外暴露 |
| 为空壳写 integration test | 覆盖率追求 | 空壳无业务,integration 无意义 | worker-matrix P0 按需 |
| wrangler.jsonc 详细 env override | 多环境管理 | 空壳只需 preview;production 在 P0 | 否(preview + production 足够) |
| 真实的 DO / KV / R2 / D1 资源创建 | 生产级 | 空壳不需要 state | worker-matrix P0 按业务需要 |
| 生产级 secrets management | 安全工程 | 空壳无秘密 | 若 P0 出现真实 secret 需求 |
| wrangler 的 `build` / `deploy` 自定义 hook | 复杂场景 | TSC compile + 直接 deploy 足够 | 否 |
| 为每个 worker 写专属 README | 文档完整 | 统一模板极简说明即可 | worker-matrix P0 补 |
| pre-commit hook 做 wrangler validate | 严格防御 | CI 做足够 | 若 wrangler 配置漂移频繁 |
| 自动 preview URL comment 到 PR | GitOps 友好 | 手工记录 URL 足够 | 若 team 扩大 |

### 3.2 接口保留点(必须留扩展空间)

| 扩展点 | 表现形式 | 第一版行为 | 未来演进 |
|---|---|---|---|
| `src/index.ts` export shape | `export default { fetch, … }` | 只 export `fetch` | P0 按 DO worker 需要加 `export class NanoSessionDO` |
| `wrangler.jsonc.services` | binding 名对齐 W1 设想 | 名字写 `BASH_CORE / CONTEXT_CORE / FILESYSTEM_CORE`;service 占位 `nano-agent-<name>` | P0 时对端 worker 就绪,service value 生效 |
| `wrangler.jsonc.durable_objects` | agent-core 预留 slot | `name: SESSION_DO, class_name: NanoSessionDO`;但 src/ 里是 stub class | P0 absorb NanoSessionDO 后替换 |
| `tsconfig.json`(per worker) | 简单 TSC config | 继承 root(若 root 有);否则独立 minimal config | 与 nano-agent 其他 tsconfig 策略协同时升级 |
| `package.json.scripts` | minimal | `build / test / deploy / deploy:preview` 4 个 | 按需加 `typecheck / lint / …` |
| `.dev.vars`(本地开发) | 不提交 | 空壳阶段不需要 | P0 按 business 需要 |

### 3.3 完全解耦点(必须独立)

- **4 个 worker 之间完全独立**
  - 各自 `wrangler.jsonc` / `package.json` / `tsconfig.json` / `src/` / `test/`
  - 不共享代码(即使未来某一 pattern 重复 — 共享应该通过 NACP 协议,不通过 shared source)
  - 部署失败只影响该 worker,不影响其他 3 个
- **workers/ 与 packages/ 完全独立**
  - pnpm workspace 同时识别但不混合
  - workers 的 package.json deps 指向统一 NACP 包名,但解析路径可为 `workspace:*` 或 published version
  - packages/ 保留 `workspace:*` internal deps;这是 Tier B 包之间的旧 contract
- **CI matrix 与 W2 publish workflow 完全独立**
  - 两个 YAML 互不 import / 互不 depend
  - W2 失败不阻塞 W4 CI;反之亦然

### 3.4 聚合点(单一中心)

- **聚合对象**:workers 配置与发布纪律
- **聚合形式**:
  - 代码:`.github/workflows/workers.yml`(单 matrix workflow)
  - 文档:每个 worker 的 `README.md` 短小但结构一致;由 §7.2 S7 模板保证
  - 结构:4 个 worker 共享**完全相同的目录布局**(`src/ test/ wrangler.jsonc package.json tsconfig.json README.md .gitignore`)
- **为什么不能分散**:统一布局让 worker-matrix P0 的 absorb pattern 能统一(W3 blueprint 读者不需因 worker 不同而调整心智)

---

## 4. 关键参考实现对比

### 4.1 B8 shipped `docs/templates/wrangler-worker.toml`(直接前置)

- **实现概要**:B8 shipped 的 wrangler toml 模板,含 DO / KV / R2 / D1 / SERVICES bindings + evidence-backed 注释(B1/B7 findings)
- **亮点**:
  - binding 语义已在模板文字明确
  - `SKILL_CORE` 注释掉表明 reserved 纪律
- **值得借鉴**:
  - bindings 语义 **直接转 jsonc 格式使用**
  - 各 worker 按其角色裁剪(agent-core 保留 DO;bash-core 删 DO 等)
- **不照抄的地方**:
  - 格式转 jsonc(owner 决策 + charter §7.5 item 41)
  - ID 都占位;不填真 ID
  - `BASH_CORE / CONTEXT_CORE / FILESYSTEM_CORE` 在 4 worker 里只有 agent-core 持有(其他 workers 是被调方,不持 outgoing binding)

### 4.2 `packages/session-do-runtime/wrangler.jsonc`(格式先例)

- **实现概要**:现有唯一 jsonc 格式 wrangler 配置
- **亮点**:
  - 证明 nano-agent 项目已接受 jsonc 形式
  - 有 DO binding 完整示例
- **值得借鉴**:
  - jsonc 语法 + 现有 comment pattern
- **不照抄的地方**:
  - 现在 session-do-runtime 的 wrangler 是 "packages/ 内工件"的历史遗留;W4 的 4 wrangler 放到 `workers/` 目录内,是"正确位置"
  - 长期:worker-matrix P0 agent-core absorb 完成后,`packages/session-do-runtime/wrangler.jsonc` 应该**退休**(被 `workers/agent-core/wrangler.jsonc` 继承),这属 worker-matrix P0 delete 动作

### 4.3 Cloudflare Workers 官方最小 worker 模板

- **实现概要**:`wrangler init` 生成的默认模板,含 basic fetch handler + tsconfig + package.json
- **亮点**:
  - Minimal viable 结构
- **值得借鉴**:
  - package.json 的 `wrangler` devDep 版本;`@cloudflare/workers-types`
  - tsconfig 的 `moduleResolution: bundler`
- **不照抄的地方**:
  - 官方模板没有 NACP import;W4 必须加
  - 官方模板用 `.toml`;owner 决策 `.jsonc`

### 4.4 smind-contexter 的多 Worker 结构(repo 内参考)

- **实现概要**:`context/smind-contexter/` 含 gateway + engine 两个独立 wrangler project
- **亮点**:
  - 证明多 wrangler 在 nano-agent repo 共存模式可行
  - 两个 Worker 通过 service binding 协作的示例
- **值得借鉴**:
  - 多 worker 并存 pattern
  - 每个 worker 独立 package.json + deploy cadence
- **不照抄的地方**:
  - smind-contexter 是**参考实现** context(不被 nano-agent runtime 消费);W4 的 4 workers 将是 **真 runtime**(虽然 W4 阶段还是 shell)

### 4.5 横向对比速查表

| 维度 | B8 toml 模板 | session-do-runtime jsonc | wrangler 官方模板 | smind-contexter | W4(本 design) |
|---|---|---|---|---|---|
| 格式 | toml | jsonc | toml(默认) | toml | **jsonc** |
| bindings 详尽度 | 高(含 evidence 注释) | 中 | 无 | 中 | **高**(继承 B8 模板语义) |
| worker 数量 | 1 模板 | 1 个 | 1 个 | 2 个 | **4 个** |
| deploy 验证 | 否(纯模板) | 部分 B7 已 LIVE | N/A | N/A | **必须 deploy** |
| NACP import | 无 | 内部 workspace | 无 | 无 | **`workspace:*` 或 published version** |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope(W4 第一版必须完成)

- **[S1]** 建 `workers/` 顶级目录
- **[S2]** 更新 `pnpm-workspace.yaml` 加 `workers/*`(保留 `packages/*`)
- **[S3]** 为 4 workers 各建:
  - `workers/<name>/wrangler.jsonc`
  - `workers/<name>/package.json`(deps 指向 `@<scope>/nacp-core` + `@<scope>/nacp-session`;解析方式依 W2 状态为 `workspace:*` 或 published version)
  - `workers/<name>/src/index.ts`(hello-world fetch handler,含 NACP version probe)
  - `workers/<name>/src/types.ts`(env binding types,初期 empty interface)
  - `workers/<name>/test/smoke.test.ts`(3-5 个 shell-level unit test)
  - `workers/<name>/tsconfig.json`
  - `workers/<name>/README.md`(§7.2 S7 模板)
  - `workers/<name>/.gitignore`(node_modules / dist / .wrangler / .dev.vars)
- **[S4]** `agent-core` 特殊处理:声明 `SESSION_DO` DO binding + export `class NanoSessionDO` stub(最小实现返回 `Response.json({ worker: "agent-core", binding: "session-do-stub" })`)
- **[S5 v0.2]** **1 real deploy(agent-core)+ 3 dry-run(其他 3 workers)**:
  - **agent-core real deploy**:`wrangler deploy --env preview`;1 个 URL 记录;curl 返回 JSON 含 `worker: "agent-core"` + NACP version + status(解析路径可为 published version 或 `workspace:*`)
  - **bash-core / context-core / filesystem-core dry-run**:各自 `wrangler deploy --dry-run`;不真实部署;只验证 wrangler.jsonc parse + bindings resolve + TS build
  - **3 份 dry-run log 归档**(作为 DevOps 链路同构证据)
- **[S6]** `.github/workflows/workers.yml` matrix CI:
  - trigger: `push` to main + `pull_request`(paths: `workers/**`)
  - matrix: `[agent-core, bash-core, context-core, filesystem-core]`
  - steps: checkout + setup-node + setup-pnpm + install + build + test + `wrangler deploy --dry-run`(CI 不做真实 deploy)
- **[S7 v0.2]** W4 closure memo `docs/issue/pre-worker-matrix/W4-closure.md`:
  - 4 个 worker 的 git tree snapshot
  - **1 real deploy URL(agent-core)+ 3 dry-run log** + wrangler run log
  - CI workflow first green run URL
  - 证明 NACP import 通过(agent-core curl 响应里有 nacp_core_version;其他 3 worker 的 dry-run log 显示 bundle 包含 NACP)

### 5.2 Out-of-Scope(W4 不做)

- **[O1]** 任何业务逻辑(tool.call / workspace.fs / context.compact 等消费)
- **[O2]** 任何 Tier B package 的 absorb(仅 W3 optional capability-runtime dry-run 例外,它有自己的 scope)
- **[O3]** Service binding 真实对端连通(4 worker 之间的 HTTP call 属 worker-matrix P0)
- **[O4]** 真实 DO / KV / R2 / D1 资源创建(用占位 ID;或由 owner 提前提供;或 P0 创建)
- **[O5]** custom domain / route 配置
- **[O6]** Tag-triggered deploy workflow(空壳阶段手工 deploy 足够;自动化 deploy workflow 属未来 phase)
- **[O7]** Secrets management / encrypted vars
- **[O8]** 生产级 observability / tail / logging 配置
- **[O9]** `wrangler.jsonc` 的多 env 精细化配置(只配 preview + default)
- **[O10]** 4 worker 之间的共享代码(例如 shared types)— 必须走 NACP
- **[O11]** `workers/skill-core/` 预建(skill.core reserved;P1+ 可能入场)
- **[O12]** NACP beta / rc tag 消费(W4 只 consume stable `1.4.0`)

### 5.3 边界清单(灰色地带)

| 项目 | 判定 | 理由 |
|---|---|---|
| agent-core 的 SESSION_DO stub class 是否算"业务逻辑" | **不算**,in-scope | stub 只 return shell 响应,用于验证 DO binding resolve;无 state 无业务 |
| workers 下是否放 `package.json.name` = `@<scope>/agent-core-worker` | **in-scope**,但不发布 | 命名一致性;`private: true` 防止误发 |
| `wrangler.jsonc` 里 KV / R2 / D1 的 ID 占位用 `"replace-me"` 还是真 ID | **in-scope 占位**,用 `"replace-me-by-<owner>"`; `wrangler deploy` 会失败 — 但空壳阶段 deploy 不依赖这些 | 若 owner 提供真 ID,替换;否则**从 wrangler.jsonc 注释掉** KV / R2 bindings 以 deploy 通过 |
| 是否立即给 4 个 worker 加 observability: enabled | **in-scope** | 继承 B8 template 惯例;不增加复杂度 |
| `workers/bash-core/src/`(W3 optional dry-run 落点,若执行)与 W4 shell 的关系 | **in-scope 预留空间** | W4 建 `workers/bash-core/src/` 目录;若 W3 执行 dry-run,则在其下直接填 capability-runtime 代码;W4 的 `index.ts` 不 import 那些(至少空壳阶段);P0 absorb 时接 |
| 每个 worker 的 `test/` 是 vitest 还是 wrangler 的 Miniflare test | **in-scope vitest shell-level** | 空壳阶段 unit test 足够;Miniflare 复杂度不匹配空壳 |
| 是否在 W4 阶段 document 4 worker 的未来 service binding 互相 call 关系 | **in-scope,README 提及但不实装** | `workers/agent-core/README.md` 写 "P0 阶段此 worker 将通过 BASH_CORE binding call bash-core";仅文档 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1 — 目录 kebab-case `workers/agent-core/`,worker name(wrangler)也是 kebab**
   - **选择 kebab-case 一致**,不是 **dotted `agent.core`**
   - **为什么**:
     - npm package name / pnpm workspace glob / 文件系统 path 都不允许 dot
     - wrangler worker name 允许 kebab,与目录名一致减少心智负担
     - NACP 层面仍可用 dotted `agent.core`(如 `producer_key: "nano-agent.agent-core@v1"` — 但 producer_key 格式是 `namespace.sub@vN`,已含 dot;可直接 `nano-agent.agent.core@v1` 也可以)
   - **接受的代价**:wrangler 层的 "agent-core" 与 learnings doc 里的 "agent.core" 不一致
   - **缓解**:每个 worker README 开头明确 "目录名 kebab-case;在 NACP / 设计讨论中用 dotted 语义";pattern doc 提 1 句

2. **取舍 2 — 用 `wrangler.jsonc`,不用 `.toml`**
   - **选择 jsonc**,不是 **toml**
   - **为什么**:
     - charter §7.5 明确 jsonc
     - `packages/session-do-runtime/wrangler.jsonc` 已是先例
     - jsonc 支持 comment + trailing comma,更友好
   - **接受的代价**:B8 shipped 的模板是 `.toml`;W4 需要"翻译" 一次
   - **缓解**:W4 deliverable 之一:在 wrangler-worker.toml 旁边加 jsonc 等价版本 `wrangler-worker.jsonc`(可选,若 owner 要保留双格式)

3. **取舍 3 — binding slot 占位用"replace-me"注释,KV / R2 / D1 deploy-time 注释掉**
   - **选择 注释掉未使用 bindings**,不是 **申请真实资源**
   - **为什么**:
     - 空壳不需要持久化
     - 创建真实资源是 owner 动作,跨 W4 scope
     - 注释掉让 `wrangler deploy` 不因资源 ID 无效而失败
   - **接受的代价**:wrangler.jsonc 里有 "注释掉的 bindings" + "slot 声明" 两种形式并存,读者容易困惑
   - **缓解**:每个 worker README 附 "binding 策略" 小节说明 "哪些已激活 / 哪些注释待 P0"

4. **取舍 4 — 首次 deploy 用 `--env preview`**
   - **选择 preview env**,不是 **直接 production**
   - **为什么**:
     - 空壳 deploy 即使失败也应隔离;preview env 提供隔离
     - wrangler `--env preview` 会用独立 Worker 实例 + 独立 URL(类似 `agent-core-preview.<account>.workers.dev`)
     - 未来 P0 实装 production 时,默认 env 仍 clean
   - **接受的代价**:URL 多一段 "-preview";W5 closure memo 记录时要写对
   - **重评条件**:若 preview 与 production env 配置差异引起混淆,未来 phase 统一

5. **取舍 5 — 单 matrix workflow,不 4 个独立 workflow**
   - **选择 matrix**(charter §7.5 item 44 方案 B)
   - **为什么**:
     - 4 workflow 的 90% 内容重复;matrix 干净
     - 只需维护 1 个 YAML
     - GitHub Actions matrix 自然并行
   - **接受的代价**:matrix 里某个 worker 失败,跳到其他 workers 的 debug 切换成本
   - **缓解**:matrix 的 `fail-fast: false`;每个 worker 独立 annotate

6. **取舍 6 — hello-world fetch 返回 JSON 带 NACP version probe,不是纯 200 OK**
   - **选择 JSON + version probe**,不是 **`Response("OK")`**
   - **为什么**:
     - version probe 证明 NACP import 真的 resolve 成功(bundle 成功),不强制要求必须来自 GitHub Packages
     - 给 W4 closure memo 提供可机读 evidence(curl + jq)
     - 成本近零(3 行代码)
   - **接受的代价**:无
   - **额外**:可选 `turn_count: 0` / `uptime_ms: Date.now() - started` 等 fun 字段;但核心是 `worker / nacp_core_version / nacp_session_version / status`

7. **取舍 7 — pnpm-workspace 同时 include `packages/*` + `workers/*`,不替换**
   - **选择共存**,不是 **替换**
   - **为什么**:
     - Tier B packages 在共存期(W3 §6.1 取舍 4,~3 个月)仍需 testable + build
     - 一次性替换 = big bang,风险爆炸
   - **接受的代价**:pnpm install 会扫描两个目录;build 时间略增
   - **重评条件**:worker-matrix 末期 Tier B 全部 deleted,届时 remove `packages/*`(除 NACP 2 包)

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解 |
|---|---|---|---|
| Cloudflare account 未 owner-approved / 权限不足 | owner 未提供 credentials | wrangler deploy 失败 | **Q3 owner-gate**;W4 启动前必须 owner 提供 account ID + API token |
| workers 的 NACP 解析路径配置错误 | `workspace:*` / published version 选择与当下 W2 状态不匹配 | build 失败 | 在 W4 closure 里显式记录当前采用的解析路径;CI 按该路径验证 |
| DO binding stub 在 agent-core 未正确 export | NanoSessionDO class 未 export | wrangler deploy 报错 "no class NanoSessionDO" | §7.2 S4 明确 stub class export 要求 |
| 4 worker 的 `wrangler.jsonc.name` 冲突 or 重名 | 命名策略漂移 | deploy 覆盖 / refused | W4 冻结命名:`nano-agent-<name>`(如 `nano-agent-agent-core`);4 名字互不冲突 |
| Matrix workflow 某 worker 失败但其他 worker 成功却被看成整体绿 | CI dashboard 读法误解 | 漏掉失败 | matrix 使用 `fail-fast: false` + 每个 worker 独立 annotate |
| wrangler deploy 所需 compatibility_date 过期或 flag 冲突 | 日期老 / flag 不支持 | deploy 失败 | §7.2 S2 用近期 date(推荐 2026-04-21 起步)+ `nodejs_compat` flag;W4 完成后每 6 个月评估一次更新 |
| `.wrangler/` 本地状态污染 git | gitignore 未配 | 误提交 build artifact | `.gitignore` 明确 `node_modules / dist / .wrangler / .dev.vars` |
| workers/ 加入 workspace 后 pnpm install 时间变长 | workspace 扫描 | CI 略慢 | 可接受(workers 空壳依赖很少) |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己**:
  - 4 个 worker 的绝对物理位置冻结;worker-matrix P0 执行者直接填 src 不建壳
  - 至少 1 个真实 URL + 3 份 dry-run 证明,足够确认脚手架与 deploy 形状成立
- **对 nano-agent 长期演进**:
  - `workers/` 目录从字面变成事实;packages/ 的 phase out trajectory 有物理终点
  - CI matrix 模式为未来加 worker 提供 zero-cost extensibility
- **对三大深耕方向杠杆**:
  - 上下文管理:context.core 有独立 deploy 位,future 升级成 stateful context engine 不破坏其他 workers
  - Skill:未来 `workers/skill-core/` 只需复制本 W4 的任一 shell + 修 name + 加 skill.* 消费;低入场成本
  - 稳定性:4 workers 独立 deploy = 独立 failure domain;风险隔离

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|---|---|---|---|
| S1 | `workers/` 顶级目录 + workspace 更新 | mkdir + pnpm-workspace.yaml 增 workers/* | ✅ `pnpm install` 扫到 4 workers;各自 node_modules 独立 |
| S2 | 4 × `wrangler.jsonc` | 每个 worker 一份 | ✅ `wrangler deploy --dry-run` 全部通过 |
| S3 | 4 × `package.json` + tsconfig + README + .gitignore | 辅助文件 5 件套 | ✅ pnpm install + tsc build 绿 |
| S4 | 4 × `src/index.ts`(hello-world + NACP probe)+ `src/types.ts` | 入口代码 | ✅ curl 响应 JSON 含 nacp_core_version: "1.4.0" |
| S5 | 4 × `test/smoke.test.ts` | shell-level unit | ✅ 每 worker 3-5 tests all green |
| S6 | `.github/workflows/workers.yml` | matrix CI | ✅ 首次 CI run green on 4 workers |
| S7 (v0.2) | agent-core 1 real deploy + 3 workers dry-run(gated by deploy permissions) | `wrangler deploy --env preview`(agent-core) + `wrangler deploy --dry-run`(bash-core / context-core / filesystem-core) | ✅ agent-core 1 URL 外网可访问 + 返回正确 JSON;3 workers dry-run build pass |
| S8 | W4 closure memo | 归档 | ✅ `W4-closure.md` 含 agent-core 1 URL + CI run URL + agent-core curl 响应 log + 3 workers dry-run build output |

### 7.2 详细阐述

#### S1: `workers/` 目录 + workspace 更新

- **操作**:
  ```bash
  mkdir -p workers/{agent-core,bash-core,context-core,filesystem-core}
  ```
- **`pnpm-workspace.yaml` 更新**:
  ```yaml
  packages:
    - "packages/*"
    - "workers/*"
  ```
- **不加**:`dogfood/*`(W2 已明确 dogfood 不入 workspace)
- **一句话收口目标**:✅ **`pnpm install` 执行后,4 workers 目录自带 node_modules;pnpm -r commands 扫 16 个 package**(11 tier B + 4 workers + dogfood 若需手工 run)

#### S2: 4 × `wrangler.jsonc`

- **命名约定(4 workers)**:
  - `workers/agent-core/wrangler.jsonc` → `name: "nano-agent-agent-core"`
  - `workers/bash-core/wrangler.jsonc` → `name: "nano-agent-bash-core"`
  - `workers/context-core/wrangler.jsonc` → `name: "nano-agent-context-core"`
  - `workers/filesystem-core/wrangler.jsonc` → `name: "nano-agent-filesystem-core"`
- **共通字段**:
  ```jsonc
  {
    "$schema": "node_modules/wrangler/config-schema.json",
    "name": "nano-agent-<name>",
    "main": "dist/index.js",
    "compatibility_date": "2026-04-21",
    "compatibility_flags": ["nodejs_compat"],
    "observability": {
      "enabled": true
    },
    "vars": {
      "ENVIRONMENT": "preview",
      "OWNER_TAG": "nano-agent"
    },
    "env": {
      "preview": {}
    }
  }
  ```
- **agent-core 特殊**(DO binding):
  ```jsonc
  "durable_objects": {
    "bindings": [
      { "name": "SESSION_DO", "class_name": "NanoSessionDO" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_classes": ["NanoSessionDO"] }
  ],
  // "kv_namespaces": [
  //   { "binding": "KV_CONFIG", "id": "replace-me-by-owner" }
  // ],
  // "r2_buckets": [
  //   { "binding": "R2_ARTIFACTS", "bucket_name": "replace-me-by-owner" }
  // ],
  "services": [
    { "binding": "BASH_CORE", "service": "nano-agent-bash-core" },
    { "binding": "CONTEXT_CORE", "service": "nano-agent-context-core" },
    { "binding": "FILESYSTEM_CORE", "service": "nano-agent-filesystem-core" }
    // { "binding": "SKILL_CORE", "service": "nano-agent-skill-core" }  // reserved
  ]
  ```
- **bash-core / context-core / filesystem-core**:无 DO binding;无 services(3 个非 host worker 都是**被调**方,不持 outgoing binding);可选 R2 bucket(注释掉)
- **一句话收口目标**:✅ **4 jsonc 文件存在;`wrangler deploy --dry-run` 对每个 worker 都 parse 通过**

#### S3: 4 × `package.json` + tsconfig + README + .gitignore

- **`package.json` 模板**(以 agent-core 为例,v0.2 两种 interim 选项):
  
  **Option A — W2 未首发,用 workspace:* interim(v0.2 默认)**:
  ```jsonc
  {
    "name": "@nano-agent/agent-core-worker",
    "private": true,
    "version": "0.0.0",
    "type": "module",
    "scripts": {
      "build": "tsc",
      "test": "vitest run",
      "deploy:preview": "wrangler deploy --env preview",
      "deploy:dry-run": "wrangler deploy --dry-run"
    },
    "dependencies": {
      "@nano-agent/nacp-core": "workspace:*",
      "@nano-agent/nacp-session": "workspace:*"
    },
  ```

  **Option B — W2 已首发,切 published version**:
  ```jsonc
  {
    // ... 同上 ...
      "dependencies": {
        "@nano-agent/nacp-core": "1.4.0",
        "@nano-agent/nacp-session": "1.3.0"
      },
    "devDependencies": {
      "@cloudflare/workers-types": "^4.0.0",
      "typescript": "^5.6.0",
      "vitest": "^2.1.0",
      "wrangler": "^3.80.0"
    }
  }
  ```
- **`.npmrc`**(配 GitHub Packages):
  ```
  @nano-agent:registry=https://npm.pkg.github.com
  always-auth=true
  ```
  (若 repo root 有全局 .npmrc,可继承)
- **`tsconfig.json`**:
  ```jsonc
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ES2022",
      "moduleResolution": "bundler",
      "lib": ["ES2022"],
      "types": ["@cloudflare/workers-types"],
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "outDir": "dist",
      "rootDir": "src"
    },
    "include": ["src/**/*.ts"],
    "exclude": ["node_modules", "dist", "test"]
  }
  ```
- **`README.md` 模板**(结构统一):
  ```markdown
  # workers/<name> — pre-worker-matrix shell

  ## Status
  
  **Shell-only. No business logic yet.**
  
  ## Purpose
  
  This is the pre-worker-matrix W4 shell for `<name>`. Its job at this
  phase is to validate:
  - wrangler.jsonc parses
  - NACP package imports resolve (`workspace:*` or published version)
  - Cloudflare deploy pipeline works
  
  Real business code will be absorbed here during worker-matrix Phase 0,
  following the blueprint at `docs/design/pre-worker-matrix/W3-absorption-blueprint-*.md`.
  
  ## Scripts
  
  - `pnpm build` — TSC compile to `dist/`
  - `pnpm test` — vitest smoke tests
  - `pnpm deploy:dry-run` — wrangler deploy dry-run
  - `pnpm deploy:preview` — wrangler deploy to preview env
  
  ## Binding strategy
  
  <per-worker binding table>
  
  ## Preview URL
  
  `https://nano-agent-<name>-preview.<account>.workers.dev`
  (set after first deploy — see `W4-closure.md`)
  ```
- **`.gitignore`**:
  ```
  node_modules
  dist
  .wrangler
  .dev.vars
  *.log
  ```
- **一句话收口目标**:✅ **4 worker 目录结构一致;pnpm install + tsc build 绿;README 统一模板**

#### S4: 4 × `src/index.ts`(hello-world + NACP probe)

- **agent-core `src/index.ts`**:
  ```ts
  import { NACP_VERSION } from "@nano-agent/nacp-core";
  import { NACP_SESSION_VERSION } from "@nano-agent/nacp-session";

  export interface Env {
    SESSION_DO: DurableObjectNamespace;
    BASH_CORE?: Fetcher;
    CONTEXT_CORE?: Fetcher;
    FILESYSTEM_CORE?: Fetcher;
  }

  // DO class stub — not a real session runtime.
  // Real NanoSessionDO will be absorbed from packages/session-do-runtime
  // during worker-matrix Phase 0 (see W3 blueprint).
  export class NanoSessionDO {
    constructor(_state: DurableObjectState, _env: Env) {}
    async fetch(_req: Request): Promise<Response> {
      return Response.json({
        worker: "agent-core",
        role: "do-stub",
        status: "shell",
      });
    }
  }

  export default {
    async fetch(_req: Request, _env: Env): Promise<Response> {
      return Response.json({
        worker: "agent-core",
        nacp_core_version: NACP_VERSION,
        nacp_session_version: NACP_SESSION_VERSION,
        status: "ok",
        phase: "pre-worker-matrix-W4-shell",
      });
    },
  };
  ```
- **bash-core / context-core / filesystem-core** 同结构,只换 `worker: "<name>"`,没有 DO class
- **一句话收口目标**:✅ **每个 src/index.ts build 绿,deploy 后 curl 返回预期 JSON**

#### S5: 4 × `test/smoke.test.ts`

- **以 agent-core 为例**:
  ```ts
  import { describe, it, expect } from "vitest";
  import worker, { NanoSessionDO } from "../src/index.js";
  import { NACP_VERSION } from "@nano-agent/nacp-core";

  describe("agent-core shell smoke", () => {
    it("exports default fetch handler", () => {
      expect(typeof worker.fetch).toBe("function");
    });

    it("exports NanoSessionDO stub class", () => {
      expect(typeof NanoSessionDO).toBe("function");
    });

    it("responds with NACP version on fetch", async () => {
      const env = {} as any;
      const res = await worker.fetch(new Request("http://x"), env);
      const body = await res.json();
      expect(body.worker).toBe("agent-core");
      expect(body.nacp_core_version).toBe(NACP_VERSION);
      expect(body.status).toBe("ok");
    });
  });
  ```
- **其他 3 worker** 类似,minus DO stub 断言
- **一句话收口目标**:✅ **每 worker 3-5 tests 全绿(共约 14-18 tests);`pnpm -C workers/<name> test` 通过**

#### S6: `.github/workflows/workers.yml` Matrix CI

- **Workflow 草案**:
  ```yaml
  name: Workers Shell CI

  on:
    pull_request:
      paths:
        - 'workers/**'
        - '.github/workflows/workers.yml'
    push:
      branches: [main]
      paths:
        - 'workers/**'

  permissions:
    contents: read
    packages: read

  jobs:
    workers:
      strategy:
        fail-fast: false
        matrix:
          worker: [agent-core, bash-core, context-core, filesystem-core]
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4

        - uses: pnpm/action-setup@v3
          with:
            version: 9

        - uses: actions/setup-node@v4
          with:
            node-version: 20
            registry-url: 'https://npm.pkg.github.com'
            scope: '@nano-agent'

        - name: Install dependencies
          run: pnpm install --frozen-lockfile
          env:
            NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

        - name: Build ${{ matrix.worker }}
          run: pnpm --filter ./workers/${{ matrix.worker }} build

        - name: Test ${{ matrix.worker }}
          run: pnpm --filter ./workers/${{ matrix.worker }} test

        - name: wrangler dry-run deploy ${{ matrix.worker }}
          run: |
            cd workers/${{ matrix.worker }}
            pnpm exec wrangler deploy --dry-run
  ```
- **说明**:
  - `fail-fast: false` — 不因一个 worker 失败终止其他
  - `--dry-run` — CI 不做真实 deploy(避免 CI 频繁污染生产环境)
  - 真实 deploy 仍由本地 / 手工 `pnpm --filter ./workers/<name> deploy:preview` 触发
- **一句话收口目标**:✅ **workflow 首次 run 4 workers 全绿**

#### S7: 1 Real Deploy + 3 Dry-Run

- **执行步骤(v0.2 — 1 real + 3 dry-run)**(owner 提供 Cloudflare account + API token 后):
  1. 本地:`export CLOUDFLARE_ACCOUNT_ID=<owner-provides>` + `export CLOUDFLARE_API_TOKEN=<owner-provides>`
  2. **agent-core real deploy**:`cd workers/agent-core && pnpm install && pnpm build && pnpm deploy:preview`
  3. 记录返回 URL(预期 `https://nano-agent-agent-core-preview.<account>.workers.dev`)
  4. `curl <url>` 验证 JSON 响应
  5. **bash-core / context-core / filesystem-core dry-run**:`cd workers/<name> && pnpm install && pnpm build && pnpm wrangler deploy --dry-run`(不消耗 credentials;验证 wrangler config + bundle 可生成)
- **预期产出(v0.2)**:
  - agent-core real:`https://nano-agent-agent-core-preview.<account>.workers.dev`(1 URL 外网可访问)
  - bash-core / context-core / filesystem-core dry-run:各自 `pnpm wrangler deploy --dry-run` 成功日志(bundle 生成成功 + config 校验通过)
- **一句话收口目标(v0.2)**:✅ **agent-core 1 URL 存在且 `curl` 返回包含 NACP version 的 JSON;3 workers dry-run build 成功**

#### S8: W4 Closure Memo

- **文件**:`docs/issue/pre-worker-matrix/W4-closure.md`
- **必含(v0.2)**:
  - 4 worker 的目录结构快照(命令 `tree workers -L 2` 输出)
  - agent-core 1 real deploy URL + 其 curl 响应 JSON(归档)
  - bash-core / context-core / filesystem-core 各自的 dry-run build log + wrangler config validation 截图
  - CI workflow 第一次成功 run 的 URL
  - 遗留 open items:3 workers 的 real deploy 推迟到 worker-matrix P0(P0 末 kick real deploy);哪些 binding 被注释掉(待 P0 激活);哪些 account-gated 步骤待 owner 配置
  - 对 worker-matrix P0 absorption 消费者的前置 checklist
- **一句话收口目标**:✅ **memo 可供 worker-matrix charter r2 作者直接消费;agent-core real + 3 dry-run 状态清晰**

### 7.3 非功能性要求

- **脚手架性能**:`pnpm install` 在 workers 目录扫描 < 30 秒;tsc build < 10 秒 per worker
- **Deploy 耐用性**:deploy URL 至少在 W4 closure 后 1 周内可访问(Cloudflare workers.dev 默认长期存在)
- **CI 耐用性**:matrix workflow 稳定运行;失败率低于 5%(排除 GitHub Packages 或 Cloudflare 平台抖动)
- **脚手架一致性**:4 workers 目录布局 byte-identical 结构(除 agent-core DO binding)

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 nano-agent 自己

| 位置 | 内容 | 借鉴点 |
|---|---|---|
| `docs/templates/wrangler-worker.toml` | B8 shipped 模板含 evidence 注释 | bindings 语义;转 jsonc |
| `packages/session-do-runtime/wrangler.jsonc` | jsonc 格式先例 | 语法 + migration block |
| `dogfood/nacp-consume-test/`(W2) | GitHub Packages 消费者 | package.json + .npmrc 模板 |
| `pnpm-workspace.yaml` | 现有 workspace | 扩展;不替换 |

### 8.2 来自 Cloudflare 官方

| 位置 | 内容 | 借鉴点 |
|---|---|---|
| Cloudflare Workers docs — wrangler init | 最小 worker 模板 | tsconfig / package.json devDeps |
| `@cloudflare/workers-types` 类型定义 | Env / DurableObject 类型 | src/types.ts import |
| Cloudflare Workers docs — Durable Objects | DO class 约定 | NanoSessionDO stub export shape |
| wrangler.jsonc schema | JSON schema | `$schema` field + IDE IntelliSense |

### 8.3 来自 smind-contexter

| 位置 | 内容 | 借鉴点 |
|---|---|---|
| `context/smind-contexter/` | 多 worker 共存 pattern | 确认"4 worker + 1 repo"可行 |
| smind-contexter wrangler 配置 | 多 Worker service binding | future P0 wiring 参考 |

### 8.4 需要避开的反例

| 做法 | 问题 | 我们为什么避开 |
|---|---|---|
| 为 4 workers 写 4 个独立 CI workflow | YAML 90% 重复 | matrix 方案足够 |
| 在 W4 阶段就配真实 KV / R2 ID | 跨 W4 scope | 注释掉;P0 激活 |
| hello-world 只 `Response("OK")` | 不 probe NACP import | 加 NACP version 字段 |
| 把 `packages/session-do-runtime/wrangler.jsonc` 删掉改指 workers/agent-core | W4 仍在共存期 | packages 保留;P0 末期删 |
| 在 W4 阶段配 custom domain | 空壳不需要 | 用 workers.dev subdomain |
| 直接 deploy 到 production env | 无 preview 隔离 | `--env preview` 默认 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

W4 是 **"脚手架 + 一次 DevOps 贯通验证"** phase:

- **存在形式(v0.2)**:`workers/` 顶级目录 + 4 workers 空壳 + 1 matrix CI workflow + **1 agent-core real deploy URL + 3 workers dry-run build log**
- **覆盖范围**:每 worker 目录结构一致;agent-core 独立 real deploy;其余 3 workers dry-run;CI 覆盖 build + test + dry-run deploy 全 4 workers
- **耦合形态**:
  - 与 W2 **弱-中依赖**(workers import NACP 用 `workspace:*` OR `@<scope>/nacp-core` 任一;不强制 first publish)
  - 与 W3 **弱协同**(若 W3 执行 optional capability-runtime dry-run,落点 `workers/bash-core/src/`;W3 不做 dry-run 则该协同不触发)
  - 与 worker-matrix P0 **强下游**(P0 直接填 src/,不建脚手架;3 workers real deploy 推迟到 P0)
- **预期代码量级**:
  - `wrangler.jsonc` × 4:~40-60 行 each → ~200 行合计
  - `package.json` × 4:~30 行 each → ~120 行合计(每份支持 `workspace:*` OR published 两条注释路径)
  - `src/index.ts` × 4:~30-40 行 each → ~150 行合计(agent-core 稍长因 DO stub)
  - `test/smoke.test.ts` × 4:~30 行 each → ~120 行合计
  - `tsconfig.json` / README / .gitignore × 4:~50 行 each → ~200 行合计
  - `.github/workflows/workers.yml`:~60 行
  - **总计**:~850 行 YAML/JSON/TS + **1 agent-core real deploy URL + 3 workers dry-run build log**
- **预期复杂度**:中 — 脚手架本身简单;但 Cloudflare real deploy 依赖 owner credentials(仅 1 次 for agent-core);dry-run 3 份降低 DevOps 坑 exposure

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|---|---|---|
| 对 nano-agent 核心定位的贴合度 | **5** | owner "`workers/` 顶级目录" 决策从字面变成物理事实 + agent-core 1 real URL + 3 workers dry-run |
| 第一版实现的性价比 | **4** | 工作量中等;收益巨大(worker-matrix P0 直接填代码) |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | **5** | 未来 skill.core 入场只需复制 pattern;context.core 独立 deploy 通道 |
| 对开发者自己的日用友好度 | **5** | 每 worker 目录结构一致;CI matrix 简洁 |
| 风险可控程度 | **4** | 核心风险在 Cloudflare account 配置(owner-gated);脚手架本身低风险 |
| **综合价值** | **4.6** | 脚手架工作 + DevOps 验证的标准高 ROI phase |

### 9.3 下一步行动

- [ ] **决策确认**(W4 动手前,owner 需 approve):
  - §6.1 取舍 1(目录 kebab-case `workers/agent-core/`)是否接受?
  - §6.1 取舍 2(`wrangler.jsonc` 而非 `.toml`)是否接受?
  - §6.1 取舍 4(首次 deploy 用 `--env preview`)是否接受?
  - §6.1 取舍 5(单 matrix workflow)是否接受?
  - §5.3 边界:agent-core 的 DO stub class 是否算合格空壳产出(预期接受)
  - **Q3**:Cloudflare account ID + API token 是否可提供?
  - **Q4**:GitHub Packages consumer auth 是否已在 workflow secrets 配置(继承 W2)?
- [ ] **关联 action-plan**:`docs/action-plan/pre-worker-matrix/D5-workers-scaffolding-and-deploy.md`(S1-S8 的批次化)
- [ ] **依赖就绪确认**:
  - W2 skeleton 就绪 + 当前解析路径(`workspace:*` 或 published version)已冻结 → W4 可启动
  - W3 若执行 optional dry-run 的 `workers/bash-core/src/` 与本 W4 各 worker `src/index.ts` 共存于 `workers/<name>/src/`,W4 不 import 那些 dry-run 代码(保持空壳纯净)
- [ ] **待深入调查**:
  - 现有 `packages/session-do-runtime/wrangler.jsonc` 是否需要在 W4 阶段标 deprecated?(推荐:不标;worker-matrix P0 末期 absorb 完再处理)
  - `compatibility_date` 取 2026-04-21 是否有任何 flag 在 Cloudflare 侧弃用?(owner 或 Opus 查官方 changelog)
  - wrangler 9 还是 10 版本?(参考 dogfood 使用的版本)

---

## 附录

### A. 讨论记录摘要

- **分歧 1**:目录命名 kebab vs dotted
  - **Opus 倾向**:kebab(npm / pnpm / filesystem 友好)
  - **当前共识**:kebab(§6.1 取舍 1)
- **分歧 2**:wrangler 格式 toml vs jsonc
  - **Opus 倾向**:jsonc(owner 字面 + 先例)
  - **当前共识**:jsonc(§6.1 取舍 2)
- **分歧 3**:CI matrix 还是 4 独立
  - **Opus 倾向**:matrix
  - **当前共识**:matrix(§6.1 取舍 5)

### B. 开放问题清单

- [ ] **Q1**:worker-matrix P0 absorb 完成后,原 `packages/session-do-runtime/wrangler.jsonc` 是否彻底删除 vs 保留一段时间?(推荐:P0 末期删)
- [ ] **Q2**:Cloudflare account 是 owner 个人账号还是 org 账号?(影响 URL 格式 `<worker>.<account>.workers.dev` 的 `<account>`)
- [ ] **Q3**:GitHub Packages auth 在 workflow 里 secrets 配置模式(是 PAT 还是 `GITHUB_TOKEN` 继承 W2 publish workflow)?
- [ ] **Q4**:`agent-core` 的 SESSION_DO binding 在空壳阶段是否会与 `packages/session-do-runtime` 现有 DO 产生冲突?(推测不会 — worker name 不同;但建议 deploy 前先 `wrangler d1 list` 或等价命令核查)
- [ ] **Q5**:agent-core 1 real deploy 后,是否需要定期 probe URL 维持"alive"状态?(推测不需要 — Cloudflare workers.dev subdomain 不因闲置而下线;但 closure memo 建议 1 周后再 probe 一次)
- [ ] **Q6**:CI workflow 中 `wrangler deploy --dry-run` 是否需要 Cloudflare API token?(推测不需要 — dry-run 是本地 validate;真实 deploy 才需 token)
- [ ] **Q7**:`@cloudflare/workers-types` 版本固定还是 latest?(推荐 `^4.0.0` 范围;若 Cloudflare 在 W4 期间 bump 到 v5,评估)

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|---|---|---|---|
| v0.1 | 2026-04-21 | Claude Opus 4.7 | 初稿:8 个 S 功能 + 7 个 tradeoff + 4 workers 具体 wrangler.jsonc 草案 + matrix CI workflow + hello-world src + smoke test 模板 |
| v0.2 | 2026-04-21 | Claude Opus 4.7 | Post-GPT-review narrowing(顶部/§0/§5.1 S5-S7/§5.5 纪律):4 real deploy → 1 real(agent-core)+ 3 dry-run;允许 `workspace:*` interim;配合 W2 parallel publishing |
| **v0.3** | 2026-04-21 | Claude Opus 4.7 | Post-GPT-R5 body-level narrowing(GPT 指出 v0.2 顶部/In-Scope 改完但 §7 详表/§9 画像仍按 4 real):<br/>• §7.1 S7/S8 功能表:S7 改为"agent-core 1 real + 3 workers dry-run";S8 closure memo 要求扩为 "1 URL + 3 dry-run build output"<br/>• §7.2 S7 执行步骤改为 1 real + 3 dry-run;去除 "重复 3 次"改为 "其余 3 workers dry-run(bash-core / context-core / filesystem-core)";S8 closure 必含字段调整<br/>• §9.1 功能簇画像:存在形式 / 覆盖范围 / 耦合形态(W2 弱-中 / W3 弱)/ 预期代码量级 / 复杂度 全部 narrower<br/>• §9.2 Value Verdict 第 1 行描述改 "agent-core 1 real URL + 3 workers dry-run"<br/>• 前言关联文档 W3 描述改 "v0.2 optional capability-runtime dry-run;落点 workers/bash-core/src/"<br/>• §0.4 显式排除 + §2.2 interaction matrix + §5.2 明显不做 + §6.3 非功能性(脚手架一致性措辞)+ 边界声明 全部同步到 capability-runtime / bash-core/src/<br/>**净效果**:W4 全文与 §0.2 空壳表、§7.1 功能表、charter r2 §11 第 5 条完全对齐;无残留 "4 real deploy / 4 URL / llm-wrapper dry-run 落点 agent-core/src/llm/" 表述 |

### D. 修订综述

**v0.2 核心调整**:真实 deploy 只做 agent-core 一次;其他 3 个走 `wrangler deploy --dry-run`。

**为什么 1 次就够**(GPT review 盲点 1 整合):
- 真实 deploy 验证的是 **DevOps 平台链路**(wrangler config parses + CF account binds + NACP bundle + TS build works)
- 4 workers 的 wrangler.jsonc 结构一致,DevOps 链路同构 — 验证一次充分
- 3 次额外 deploy 的增量信号价值低 + 4 workers 仪式化感强
- `wrangler deploy --dry-run` 对其他 3 workers 仍能抓到 wrangler.jsonc 的 structural errors

**对 charter r2 §11 第 5 条(最小 worker scaffold)的支持**:新 exit 明确 "至少 1 个样板 worker 可以 build/test/真实 deploy;其他 3 个脚手架就绪 + dry-run pass"— 本 W4 v0.2 对应到这条。

**与 W2 parallel publishing 决策的配合**:若 W2 未完成真实首发,agent-core 的 deploy 可用 `workspace:*` interim;封 build 成功即可。worker-matrix 阶段的后续 migration PR 再切到 published version。
