# W2 — GitHub Packages Publishing Pipeline

> 功能簇:`pre-worker-matrix / W2 / publishing-pipeline`
> 讨论日期:`2026-04-21`
> 讨论者:`Claude Opus 4.7 (1M context)` + owner pending review
> 关联文档:
> - Charter: `docs/plan-pre-worker-matrix.md` §4.1 C / §7.3
> - Owner 决策:`docs/plan-pre-worker-matrix.md` §1.5(NACP 必须发布到 GitHub Packages)
> - 前置 design:
>   - `docs/design/pre-worker-matrix/W0-nacp-consolidation.md`(ship 1.4.0 shape)
>   - `docs/design/pre-worker-matrix/W1-cross-worker-protocols.md`(ship 1.4.0 新协议)
> - 后继 design(W2 阻塞):`W4-workers-scaffolding.md`(4 worker 从 GitHub Packages import NACP)
> 文档状态:`draft`

---

## 0. 背景与前置约束

### 0.1 为什么 W2 必须在 pre-worker-matrix 阶段做

owner 在 `packages 定位辩证` 讨论中明确:**`nacp-core` 与 `nacp-session` 是唯一永久对外契约**,必须以 GitHub Packages 形式发布,其他 9 个 Tier B packages 都是"吸收上下文"不对外。

这个决策直接推出 W2 的必要性:worker-matrix 阶段 `workers/*` 的 `package.json` 将**从 GitHub Packages import** `@<scope>/nacp-core` + `@<scope>/nacp-session`,而非用 `workspace:*` local link。若本阶段不完成 publishing pipeline:

1. W4 的 4 个空 worker 无法用 GitHub Packages path 消费 NACP(等于脚手架名存实亡)
2. worker-matrix P0 的 absorption 期间 Tier B 包逐个 deprecated,若 NACP 还没发布,workers 会连 Tier A 的 source-of-truth 都找不到
3. 第三方实现者(若有)无任何消费路径

所以 W2 存在的本质:**把"只发 NACP 2 包"这一 owner 决策,从 charter 文字变成 CI/CD 可执行的真实流水线**。

### 0.2 W2 在 pre-worker-matrix 阶段的时机

按 charter §8 DAG,W2 的依赖与并发:

- **硬依赖**:W0(必须先 consolidate 好 1.4.0 代码,才能发布)
- **软依赖**:W1(W1 新增的 `workspace.fs.*` + 3 helper 若想包含在首次发布,应等 W1 完成;若不等,可以发 "W0-only" 的中间版本后再发)
- **并发可能**:W2 可与 W1 并行启动(发布管道搭建不依赖 W1 代码完成),但**首次真实发布**应等 W0+W1 都 ship

**推荐节奏**:

1. W2 先搭 pipeline skeleton(publishConfig / workflow / secret / permission)— 可与 W1 并行
2. 等 W0+W1 代码全 merge → 一次性 tag `nacp-v1.4.0` → 流水线触发首次发布
3. Dogfood 验证 → 反馈到 discipline doc → W2 closure

### 0.3 前置共识(不再辩论)

- **仅 2 个包发布**:`nacp-core` + `nacp-session`;其他 9 个 Tier B 包**绝不**发布
- **GitHub Packages 而非 npm 公共 registry**:owner 决策;避免管控空间失控
- **publish-on-tag 纪律**:只有 `nacp-v*.*.*` 格式 git tag 触发发布,不用 branch / commit / PR merge
- **Additive versioning**:继承 W0 的 1.4.0 additive 纪律;第一次发布版本号 = W0+W1 合并后的 1.4.0
- **Access 模式**:`restricted`(private) — 初期仅 nano-agent 组织内部消费;未来可提升到 `public`
- **Consumer 是 workers/\***:worker-matrix 阶段的 4 个 worker 是首批 known consumers;dogfood 消费者可以是独立 throwaway

### 0.4 显式排除

- 不发布 `@nano-agent/capability-runtime / session-do-runtime / context-management / ...` 等 Tier B 包
- 不发布到 npm 公共 registry(`registry.npmjs.org`)
- 不建立 nacp-core 的 beta / rc / canary 多 tag 策略(保持 stable tag only)
- 不提供 nacp-core 的 CDN 分发(GitHub Packages 足够)
- 不写 nacp-core 的 SDK wrapper 库(consumers 直接 import schema 即可)
- 不处理 nacp-core 1.3.0 的 "backport publish"(1.3.0 只存在 git 历史,没发布也不补发)
- 不实装发布失败的人工审批流程(第一版 auto-publish on tag;若出问题用 unpublish)

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**:`NACP GitHub Packages Publishing Pipeline`
- **一句话定义**:一条由 `nacp-v*` git tag 触发、通过 GitHub Actions 自动发布 `nacp-core` + `nacp-session` 到 GitHub Packages 的受控流水线,并通过 throwaway dogfood 消费者证明端到端可用
- **边界描述**:
  - **包含**:2 个 `package.json` 的 `publishConfig`、`.github/workflows/publish-nacp.yml`、repo secrets / permissions、首次发布 nacp-v1.4.0、dogfood 消费者、publishing discipline 文档
  - **不包含**:runtime 行为(那是 W0/W1)、发布 beta / canary tag、发布其他 9 个包、npm 公共 registry、nacp 1.3.0 补发

### 1.2 关键术语对齐

| 术语 | 定义 | 备注 |
|---|---|---|
| publishConfig | `package.json` 内的 field,指向特定 registry + access 模式 | GitHub Packages 需要这个 |
| `nacp-v*` tag | 专属 git tag 格式,形如 `nacp-v1.4.0`,只为 NACP 发布触发 | 与其他 tag 正交 |
| scope | npm scope,格式 `@<name>/pkg`(如 `@nano-agent/nacp-core`) | GitHub Packages 要求 scope |
| restricted access | npm / GitHub Packages 的 private 模式,仅授权 user 可 install | 初版选此 |
| dogfood consumer | 一个仅用于证明发布可用性的消费者项目(一次性) | W2 验证手段 |
| publish-on-tag | 发布只被 git tag 触发,不由 commit / branch 触发 | 本 design §6.1 取舍 3 |
| NACP_PACKAGE_SCOPE | `.npmrc` / workflow 里引用的 scope 占位符 | owner 决策填入具体值 |

### 1.3 参考上下文

- GitHub Packages 官方文档(`docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry`)
- 现有 `packages/nacp-core/package.json`(W2 要加 publishConfig)
- 现有 `packages/nacp-session/package.json`(同上)
- W0 §7.2 C6 CHANGELOG 1.4.0 草案(首次发布对应 entry)
- Charter §5.2 publishing-before-scaffolding 纪律(W4 workers 必须从 GitHub Packages 而非 workspace link 消费)

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **整体架构里的角色**:DevOps/CI 层的最小必要流水线;把 "代码 ship ready" 转化为 "外部 consumer 可 install"
- **服务于**:
  - W4 的 4 个空 worker(首批消费者)
  - worker-matrix 阶段的 4 个实装 worker
  - 未来第三方 nano-agent 实现(若有)
- **依赖**:
  - W0 完成(1.4.0 代码 shipped in repo)
  - 可选 W1 完成(新 `workspace.fs.*` 等 symbol 包含在 1.4.0 首发)
  - GitHub repo 存在 + repository owner 有 `packages: write` 权限
- **被谁依赖**:
  - W4 scaffolding 的 `package.json` dependency resolution
  - 所有 worker-matrix 阶段对 NACP 的消费
  - 未来 pre-worker-matrix 后续(每次 nacp-core minor bump)

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| `packages/nacp-core/package.json` | W2 modify(加 publishConfig) | 强 | 必改一次 |
| `packages/nacp-session/package.json` | W2 modify(加 publishConfig) | 强 | 必改一次 |
| git tag 规则 | W2 define(`nacp-v*` 专属) | 强 | 与其他 tag(若有)正交 |
| `.github/workflows/` | W2 create(目录不存在,W2 建) | 强 | 本阶段第一个 workflow |
| W0/W1 的 CHANGELOG | W2 consume(发布时 attach changelog) | 中 | 发布 release note 引用 |
| W4 scaffolding | W2 enables | 强 | W4 workers 的 `package.json` 从 GitHub Packages import |
| pnpm lockfile | W2 may affect | 弱 | dogfood 消费者有独立 lockfile;不污染主 repo |
| 第三方消费者 | W2 theoretical serve | 弱 | 当前无;未来可消费 |
| `test/*.test.mjs` root tests | W2 不干扰 | 无 | 发布管道与测试流水线隔离 |

### 2.3 一句话定位陈述

> 在 nano-agent 里,`NACP GitHub Packages Publishing Pipeline` 是**DevOps 层最小必要流水线**,负责**以 `nacp-v*` git tag 为唯一触发器自动发布 `nacp-core` + `nacp-session` 到 GitHub Packages 并通过 dogfood 证明可消费**,对上游(pre-worker-matrix)提供**"只发 NACP 2 包" owner 决策的 CI/CD 实体化**,对下游(W4 + worker-matrix workers)要求**从 GitHub Packages 而非 workspace link 消费 NACP**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点(哪里可以砍)

| 被砍项 | 来源 / 对标 | 砍的理由 | 未来是否回补 |
|---|---|---|---|
| 发布其他 9 个 Tier B 包 | 典型 monorepo "发布一切" | owner 决策:Tier B 是吸收上下文非 library | **否**(长期纪律) |
| npm 公共 registry 镜像发布 | 公开 OSS 惯例 | 管控空间失控;当前无公开需求 | 若将来开源可考虑 |
| Beta / RC / Canary tag 策略 | semantic-release 类工具 | 第一版 stable only,复杂度不划算 | 若版本 churn 高再考虑 |
| 版本自动 bump(如 changeset / semantic-release) | 流行 monorepo 工具 | charter 有明确 semver 纪律;人工 tag 足够 | 若手工 bump 失误多,再考虑 |
| Publish 后自动 tweet / slack 通知 | 企业 OSS 常见 | 内部小团队不需要 | 否 |
| Multi-region CDN 发布 | 公开包常见 | GitHub Packages 已足够 | 否 |
| Publish workflow 的 manual approval gate | 严 compliance 企业 | 第一版 auto;错误用 unpublish 补救 | 若 unpublish 超过 2 次再引入 |
| 发布签名(provenance / sigstore) | npm 2024+ 新特性 | 初期不需;GitHub Packages + repo auth 已充分 | 若消费者要求再加 |

### 3.2 接口保留点(必须留扩展空间)

| 扩展点 | 表现形式 | 第一版行为 | 未来演进 |
|---|---|---|---|
| `publishConfig` | `package.json` field | `{registry: ..., access: "restricted"}` | 若转 public 只改 access |
| `nacp-v*` tag namespace | git tag 规则 | 专属触发 publish-nacp.yml | 未来可加 `worker-v*` 专属其他工作流,互不冲突 |
| Workflow input parameter | `workflow_dispatch.inputs` | 不用(只 tag-trigger) | 未来可加 `dry-run / pre-release / skip-tests` 入参 |
| Package 可发布列表 | workflow 里 `matrix.package` | `[nacp-core, nacp-session]` 2 个 | 未来若新协议包入场,append;但 Tier B 永不加 |
| `.npmrc` scope 映射 | dogfood 消费者示例 | 示例用 `@nano-agent:registry=...` | 其他 consumers 按此模板配置 |
| Version consistency check | workflow step | 断言 package.json version 与 tag 一致 | 未来可加多种检查(`CHANGELOG head` 匹配等) |

### 3.3 完全解耦点(必须独立)

- **Publish 流水线与 CI 测试流水线完全分离**
  - publish-nacp.yml 只跑 tag-triggered;不跑 PR / push / branch
  - 现有(或未来)CI 测试的 workflow 不做 publish 动作
  - 原因:发布失败不阻塞 PR;测试失败不阻塞发布(若真要 gate,由 tag 前手工验证)

- **Publish 流水线只操作 `packages/nacp-core/` + `packages/nacp-session/`**
  - workflow `working-directory` 或 `--filter` 严格限定 2 包
  - 即使手残推了错误 tag,也只发 2 包

- **Dogfood 消费者项目独立于主 repo**
  - 放 `dogfood/nacp-consume-test/`(本 repo 内)或独立 repo(本 design 选前者简化)
  - 独立 `package.json` + 独立 lockfile + 独立 `.npmrc`
  - `pnpm-workspace.yaml` **不**包含 dogfood 目录(否则会用 workspace link 而非 GitHub Packages — 违背 dogfood 初衷)

### 3.4 聚合点(单一中心)

- **聚合对象**:所有 nacp 发布配置与纪律
- **聚合形式**:
  - 代码:`.github/workflows/publish-nacp.yml`(单一 workflow)
  - 文档:`docs/design/pre-worker-matrix/W2-publishing-discipline.md`(专门的纪律 spec)
  - 版本:nacp-core + nacp-session 同步 bump,同一 tag 同时发布
- **为什么不能分散**:两个 NACP 包在语义上严格绑定(nacp-session 依赖 nacp-core);发布也应同步避免 consumer resolve 到 mismatched 版本

---

## 4. 关键参考实现对比

> 本 design 不参考"3 个对标 agent",而参考 3 类 GitHub Packages publishing pattern。

### 4.1 GitHub Packages 官方最小示例(typical)

- **实现概要**:在 package.json 加 `publishConfig`,在 workflow 里用 `actions/setup-node@v4` + `npm publish`(GITHUB_TOKEN 作为 NODE_AUTH_TOKEN)
- **亮点**:
  - `GITHUB_TOKEN` 自动可用;不需要额外 PAT
  - `permissions: packages: write` 声明式授权
- **值得借鉴**:
  - 使用 `GITHUB_TOKEN`,不自建 PAT(省管理成本)
  - `permissions` block 最小授权
- **不照抄的地方**:
  - 官方示例通常 `npm publish`;我们用 pnpm,需改 `pnpm publish`

### 4.2 Monorepo 选择性发布 pattern(changesets / lerna / nx-release)

- **实现概要**:工具维护一个"哪些包需要发布"的 manifest,自动 bump 版本 + 发布
- **亮点**:
  - 自动化 version bump,减少人工失误
  - 自动生成 changelog
- **值得借鉴**:
  - "仅发布白名单"概念 — W2 硬编码 `[nacp-core, nacp-session]`,不全 monorepo
- **不照抄的地方**:
  - 太复杂;我们 owner 决策是"人工 tag 触发",不需要自动 bump
  - changesets 通常假设所有包都发布,我们 9/11 包不发布违反工具默认

### 4.3 nano-agent 自己的 semver 纪律(B9 1.3.0 + W0 1.4.0 precedent)

- **实现概要**:B9 shipped nacp-core 1.3.0 时用了 "Primary criteria(语义成熟)vs Secondary(版本号)"纪律,避免把版本号当价值锚点
- **亮点**:
  - 明确"additive only"
  - 区分"shipped in repo" vs "published to registry"
- **值得借鉴**:
  - W2 的首次 publish 版本号 = W0+W1 shipped 后的 1.4.0;与 in-repo 版本完全同步,无额外"发布号"
- **新增**:
  - 首次引入"in-repo ship"与"published to registry"两步分离;W2 建立"published"层的纪律

### 4.4 横向对比速查表

| 维度 | GitHub Packages 官方 | Monorepo tool(changesets) | nano-agent W2(本 design) |
|---|---|---|---|
| 发布范围 | 所有 package | 工具管理的一组 | **硬编码 2 个**(nacp-core + nacp-session) |
| 版本 bump | 人工 | 自动 | **人工 git tag** |
| 触发方式 | push / tag | PR merge | **只 tag(`nacp-v*`)** |
| Changelog 生成 | 人工 | 自动 | **人工**(继承 W0 的 CHANGELOG) |
| Access | 默认 private | 多模式 | **restricted**(初版) |
| 多包同步 | 不管 | 工具保证 | **workflow 里同一 run 中 2 包顺序发布** |
| Dogfood | 不定义 | 不定义 | **显式 throwaway consumer** |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope(W2 第一版必须完成)

- **[S1]** `packages/nacp-core/package.json` 加 `publishConfig`:
  ```json
  "publishConfig": {
    "registry": "https://npm.pkg.github.com",
    "access": "restricted"
  }
  ```
- **[S2]** `packages/nacp-session/package.json` 同上
- **[S3]** Owner 与 Opus 共同对齐 **package scope**(推荐 `@nano-agent`;若 GitHub org 名不同需 owner 确认)
- **[S4]** `.github/workflows/publish-nacp.yml` 新建,含:
  - trigger: `on: push: tags: - 'nacp-v*.*.*'`
  - permissions: `packages: write`, `contents: read`
  - steps: checkout → setup-node(+ `NODE_AUTH_TOKEN=GITHUB_TOKEN`)→ setup-pnpm → install → build → version-consistency-check → publish nacp-core → publish nacp-session
- **[S5]** Repository secret 确认(`GITHUB_TOKEN` 自动提供;若用 PAT 则手工创建)
- **[S6]** Repository settings → Actions permissions(write packages)
- **[S7]** 首次发布:手动创建 git tag `nacp-v1.4.0`(在 W0+W1 代码全 merge 之后);workflow 触发;验证 GitHub Packages registry 上能看到
- **[S8]** Dogfood 消费者 `dogfood/nacp-consume-test/`:
  - 独立 `package.json` import `@<scope>/nacp-core@1.4.0` + `@<scope>/nacp-session@1.4.0`
  - 独立 `.npmrc` 配 GitHub Packages registry + `always-auth=true`
  - 独立 `pnpm-lock.yaml`(不加入主 workspace)
  - 最小 build + 最小 test(如 import `validateEnvelope` + 构造一个 envelope pass)
  - CI smoke(可手动 or optional workflow)
- **[S9]** `docs/design/pre-worker-matrix/W2-publishing-discipline.md`(本 design owner-approve 后拆出来作为独立 Policy doc)涵盖:
  - publish-on-tag 规则
  - 版本号与 CHANGELOG 同步 rule
  - 紧急撤回流程(deprecate + republish fix + unpublish 条件)
  - Consumer `.npmrc` 配置模板
  - Future 扩展规则
- **[S10]** Closure memo `docs/issue/pre-worker-matrix/W2-closure.md`:归档首次发布证据(截图 / tag URL / registry URL / dogfood build log)

### 5.2 Out-of-Scope(W2 不做)

- **[O1]** 发布其他 9 个 Tier B 包
- **[O2]** 发布到 npm 公共 registry
- **[O3]** 自动 version bump(changesets / semantic-release 等)
- **[O4]** beta / canary / rc tag 策略
- **[O5]** 发布签名(provenance / sigstore)
- **[O6]** Multi-region CDN
- **[O7]** 发布失败的手工审批 gate
- **[O8]** nacp-core 1.3.0 的补发布
- **[O9]** nacp-core 1.4.0 的 "public" access(owner 未决策)
- **[O10]** nacp-session 独立发布节奏(与 nacp-core 同步)
- **[O11]** Dogfood 消费者进入 pnpm workspace(会破坏 dogfood 语义)
- **[O12]** Consumer `.npmrc` 自动配置(每个 consumer 自行配置)

### 5.3 边界清单(灰色地带)

| 项目 | 判定 | 理由 |
|---|---|---|
| 首发 version 是否用 1.4.0 还是重起 0.1.0 | **1.4.0** | 与 in-repo ship 版本一致;避免"发布号与代码版本号错位" |
| GitHub Packages scope 是 `@nano-agent` 还是 repo owner 名 | **Q2 待 owner 确认** | 取决于 GitHub org 实际名;本 design 暂用 `@nano-agent` 占位符 |
| workflow 是否发布时跑完整 test | **in-scope(但只跑 nacp-core/session 的 unit test)** | 快速确认 dist 可用;不跑 root/cross tests(那是 CI 职责) |
| `access: "restricted"` vs `"public"` | **in-scope restricted** | 第一版保守;owner 决策转 public 后改 1 个字段即可 |
| 是否发 `nacp-v1.4.0-rc.1` 等预发布 | **out-of-scope** | 加复杂度;tag 只认 `nacp-v<major>.<minor>.<patch>` |
| 发布失败时是否自动 rollback | **out-of-scope** | 第一版:失败就 fail;手工判断 |
| Dogfood 是否也 tag-triggered | **out-of-scope** | Dogfood 只在 S7 首次发布后跑一次 |
| `.github/workflows/` 是否只 W2 workflow 一个 | **in-scope 就一个** | 其他 workflow(若未来需要)单独加,不在 W2 scope |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1 — 只发 `nacp-core` + `nacp-session`,不发其他 9 个**
   - **选择 2 包白名单**,不是 **全 monorepo publish**
   - **为什么**:
     - owner 决策:Tier B 是吸收上下文非 library,发布它们会违反"packages phase out"trajectory
     - 减少发布 surface = 减少外部兼容性负担
   - **接受的代价**:
     - 其他 9 包永远没有"公开 version"概念;它们在 repo 里有 CHANGELOG 但不会 public
     - 未来若想 partial open source 其中某包,需先升级到"库定位"才能发(非小 PR)
   - **重评条件**:若某 Tier B 包被某 worker absorb 后,**该 worker 需要独立部署给第三方**,才考虑把它升级为 library + 发布

2. **取舍 2 — publish-on-tag(`nacp-v*`),不用 commit / branch trigger**
   - **选择 tag trigger**
   - **为什么**:
     - commit trigger 会每 push 都发 → 无版本管理
     - branch trigger 需要 release branch 纪律 → 复杂度翻倍
     - tag trigger:版本号与 tag 一一对应,最直接
   - **接受的代价**:每次发布要人工 `git tag nacp-v1.4.0 && git push --tags`;不能全自动
   - **重评条件**:若发布频率 > 1 次/周且人工 tag 易出错,考虑 changesets

3. **取舍 3 — tag format `nacp-v*`,不用 `v*`**
   - **选择 nacp-prefix**
   - **为什么**:
     - 未来可能有其他 tag 类型(如 `workers-v*` / `spike-v*` / `release-v*`)
     - nacp-specific prefix 避免与其他 tag 触发器冲突
   - **接受的代价**:tag 字符更长;开发者要记这个前缀
   - **重评条件**:若未来确信只有 NACP 会被 tag-published,可简化为 `v*`

4. **取舍 4 — 首发用 1.4.0,不重起 0.1.0**
   - **选择继续 1.4.0**
   - **为什么**:
     - `NACP_VERSION` 常量已是 1.4.0(W0 bumped);若发布 0.1.0 → 代码里常量与发布号错位
     - B9/W0 已建立 "1.3.0 shipped in repo" 的 precedent;继续用 1.4.0 保持一致性
   - **接受的代价**:首发包名称 + 1.4.0 version 的组合在 GitHub Packages 看起来"突然出现"(无历史 1.3.0)— 消费者可能困惑
   - **缓解**:W2 discipline doc 明确解释"1.3.0 只 shipped in repo 未发布;1.4.0 是首个 published version";CHANGELOG 也写
   - **重评条件**:若未来需要补发 1.3.0 作为 baseline,可 back-tag publish

5. **取舍 5 — Dogfood 消费者放 `dogfood/` 本 repo 内,不独立 repo**
   - **选择本 repo 内 `dogfood/`**
   - **为什么**:
     - 独立 repo 增加 admin 成本(branch / PR / settings 都要配)
     - 本 repo 内有 git 历史可追溯
     - dogfood 用完可删文件
   - **接受的代价**:本 repo 的 `.gitignore` 或 workspace 配置要确保 dogfood 不误入主 workspace
   - **缓解**:`pnpm-workspace.yaml` 里 **不** include `dogfood/`
   - **重评条件**:若多个 dogfood 场景共存,再独立 repo

6. **取舍 6 — 发布时只跑 nacp 2 包 unit test,不跑 root/cross**
   - **选择窄 test gate**
   - **为什么**:
     - root / cross tests 需要 session-do-runtime 等 Tier B 包 build,发布流水线无必要依赖这些
     - nacp-core + nacp-session 的 unit test 已充分证明"包本身可用"
   - **接受的代价**:如果 W0 某吸收改动破坏了 cross test 但 nacp unit 绿,发布会成功而 cross 仍红 — 但 cross 红应该在 W0 之前就被发现,发布不负责再抓
   - **重评条件**:若出现"发布绿但 root/cross 红"的真实 incident,加 gate

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解 |
|---|---|---|---|
| Package scope(`@nano-agent`)与 GitHub org 名不匹配 | owner 的 GitHub org 不是 "nano-agent" | publish 时 403 / 404 | **S3 owner-approve 之前不触发首发**;用 github-org 实际名 |
| `GITHUB_TOKEN` 权限不足 | `permissions: packages: write` 遗漏 | publish 401 | workflow 头部显式 permissions block;首次手动 dry-run 验证 |
| Tag push 到远端不触发 workflow | `.github/workflows/` 配置错误;repository actions 被禁 | 发布无动作 | repository settings 确认 actions enabled;用 `act` 本地模拟 |
| Dogfood 误入 pnpm workspace | `pnpm-workspace.yaml` 通配错 | dogfood 用 workspace link 而非 GitHub Packages,违背 dogfood 意图 | 明确 `dogfood/` 不在 workspace;用 `pnpm install --ignore-workspace` |
| 版本号与 tag 不一致 | 手工 tag 错误(`nacp-v1.4.0` 但 package.json 还是 1.3.0) | publish 成功但版本号错位 | workflow step `version-consistency-check` 比对 tag 与 package.json |
| publish 成功但 dogfood install 失败 | consumer `.npmrc` auth 未配置 | 对外不可消费 | dogfood step 包含真实 install + build;任一失败立即暴露 |
| 首次发布后被迫 unpublish | 发布后发现 bug | GitHub Packages unpublish 有 24h 窗口;过后永久无法删除 | S9 discipline doc 明确 unpublish 流程;必要时 publish 1.4.1 patch |
| secret leak | GITHUB_TOKEN 被错误打印到 log | 安全事件 | workflow 默认 mask secrets;避免 `echo $TOKEN` 类调试 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己**:
  - 每次 NACP 协议变更,只需 `git tag nacp-v<next> && git push --tags`,流水线自动化发布
  - 不用每次手工 `pnpm publish`(避免本地环境漂移)
- **对 nano-agent 长期演进**:
  - "只发 2 包" 纪律从 charter 变成 CI 强制事实;未来如果有人试图发 Tier B,workflow 白名单会拒绝
  - 建立"nano-agent 发布什么"单一参考点(discipline doc)
- **对三大深耕方向的杠杆**:
  - **上下文管理**:context.core 变 Tier B → 不发布 → 内部 absorb 进 workers 演进,无兼容债
  - **Skill**:未来 skill.core 若需协议扩展,`nacp-core 1.5.0` 可按同一流水线发布,无额外设施
  - **稳定性**:固定 "NACP 是唯一对外契约" 从代码纪律变成 CI 纪律,三重约束

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|---|---|---|---|
| P1 | `publishConfig` 加入 2 package.json | GitHub Packages registry + restricted | ✅ 2 个 `package.json` 有 publishConfig;本地 `pnpm publish --dry-run` 能识别 target |
| P2 | `.github/workflows/publish-nacp.yml` 新建 | tag-triggered publish workflow | ✅ YAML 可被 GitHub Actions 识别;`nacp-v*` tag push 触发 |
| P3 | Repository secrets + permissions | `GITHUB_TOKEN` + `packages: write` | ✅ workflow 有 permissions block;actions enabled |
| P4 | 首次发布 `nacp-v1.4.0` | 真实 publish | ✅ GitHub Packages registry 可见 2 个包 |
| P5 | Dogfood 消费者 | 独立 consumer 证明可 install | ✅ `dogfood/nacp-consume-test/` build + test 成功 |
| P6 | Publishing discipline doc | 纪律文档 | ✅ `W2-publishing-discipline.md` owner-approved |
| P7 | W2 closure memo | 归档证据 | ✅ `W2-closure.md` 含 tag URL / registry URL / dogfood log |

### 7.2 详细阐述

#### P1: `publishConfig` 加入 2 package.json

- **输入**:现有 `package.json`(2 个)
- **输出**:每个 `package.json` 多出 `publishConfig` field
- **具体 diff**:
  ```json
  {
    "name": "@nano-agent/nacp-core",
    "version": "1.4.0",
    ...
    "publishConfig": {
      "registry": "https://npm.pkg.github.com",
      "access": "restricted"
    }
  }
  ```
- **边界情况**:
  - `name` 前缀(`@nano-agent/`)必须与 repo 的 GitHub owner 匹配(Q2 待 owner 确认)
  - `private: true` 不能存在(GitHub Packages 不允许发布 private 标记的包)— 需核查现有 package.json
- **一句话收口目标**:✅ **2 个 package.json 含 publishConfig;`pnpm publish --dry-run` 在 2 包目录下均能识别 target registry**

#### P2: `.github/workflows/publish-nacp.yml`

- **Workflow 草案**(符合 charter §7.3):
  ```yaml
  name: Publish NACP to GitHub Packages

  on:
    push:
      tags:
        - 'nacp-v*.*.*'

  permissions:
    contents: read
    packages: write

  jobs:
    publish:
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

        - name: Build nacp-core
          run: pnpm --filter @nano-agent/nacp-core build

        - name: Build nacp-session
          run: pnpm --filter @nano-agent/nacp-session build

        - name: Test nacp-core (unit only)
          run: pnpm --filter @nano-agent/nacp-core test

        - name: Test nacp-session (unit only)
          run: pnpm --filter @nano-agent/nacp-session test

        - name: Version consistency check
          run: |
            TAG_VERSION=${GITHUB_REF#refs/tags/nacp-v}
            CORE_VERSION=$(node -p "require('./packages/nacp-core/package.json').version")
            SESSION_VERSION=$(node -p "require('./packages/nacp-session/package.json').version")
            if [ "$TAG_VERSION" != "$CORE_VERSION" ]; then
              echo "::error::Tag $TAG_VERSION != nacp-core package.json $CORE_VERSION"
              exit 1
            fi
            if [ "$TAG_VERSION" != "$SESSION_VERSION" ]; then
              echo "::error::Tag $TAG_VERSION != nacp-session package.json $SESSION_VERSION"
              exit 1
            fi

        - name: Publish nacp-core
          run: pnpm --filter @nano-agent/nacp-core publish --no-git-checks --access=restricted
          env:
            NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

        - name: Publish nacp-session
          run: pnpm --filter @nano-agent/nacp-session publish --no-git-checks --access=restricted
          env:
            NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  ```
- **边界情况**:
  - Version mismatch → step `Version consistency check` fail-fast,不到发布步骤
  - Unit test fail → step `Test ...` fail,不到发布
  - `--no-git-checks` 必要(pnpm publish 默认要求 clean git state,但 tag workflow 下 HEAD 就是 tag commit,不 dirty;加 flag 防跨平台差异)
- **一句话收口目标**:✅ **`nacp-v1.4.0` tag push 后,workflow 自动跑完 8 个 step 并在 GitHub Packages 上发布 2 个包**

#### P3: Repository secrets + permissions

- **GITHUB_TOKEN**:自动提供,workflow 内 `${{ secrets.GITHUB_TOKEN }}` 即可
- **Repository settings**:
  - Settings → Actions → General:`Allow all actions and reusable workflows`(或更严格)
  - Settings → Actions → General → Workflow permissions:`Read and write permissions`(或 `Read` + workflow 内 `permissions: packages: write`)
- **一句话收口目标**:✅ **workflow 第一次 run 无 permission 相关 error**

#### P4: 首次发布 `nacp-v1.4.0`

- **前置条件**:W0 + W1 代码全 merge;`package.json` version = 1.4.0;CHANGELOG 1.4.0 entry landed
- **执行步骤**:
  1. `git tag nacp-v1.4.0`
  2. `git push origin nacp-v1.4.0`
  3. GitHub Actions 触发 publish-nacp workflow
  4. 等待 workflow green
  5. 检查 `https://github.com/<owner>/<repo>/packages` 能看到 2 包
- **交付物**:
  - GitHub Packages registry 上 2 包可见
  - 首发 tag 与 workflow run 的 URL 归档进 W2 closure
- **边界情况**:若 workflow 失败,debug 后修 code / workflow → 删除 tag(`git tag -d` + `git push origin :nacp-v1.4.0`)→ 重新 tag 同一 version → 重跑
- **一句话收口目标**:✅ **`@nano-agent/nacp-core@1.4.0` + `@nano-agent/nacp-session@1.4.0` 在 GitHub Packages 可见**

#### P5: Dogfood 消费者 `dogfood/nacp-consume-test/`

- **目录结构**:
  ```
  dogfood/
  └── nacp-consume-test/
      ├── package.json
      ├── .npmrc
      ├── tsconfig.json
      ├── src/
      │   └── consume.ts
      └── test/
          └── import-smoke.test.ts
  ```
- **`package.json`**:
  ```json
  {
    "name": "nacp-consume-test",
    "private": true,
    "version": "0.0.0",
    "type": "module",
    "dependencies": {
      "@nano-agent/nacp-core": "1.4.0",
      "@nano-agent/nacp-session": "1.4.0"
    },
    "devDependencies": {
      "typescript": "^5.6.0",
      "vitest": "^2.1.0",
      "zod": "^3.24.0"
    },
    "scripts": {
      "build": "tsc",
      "test": "vitest run"
    }
  }
  ```
- **`.npmrc`**:
  ```
  @nano-agent:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_AUTH_TOKEN}
  always-auth=true
  ```
- **`src/consume.ts`**:
  ```ts
  import { validateEnvelope, NACP_VERSION, NACP_CORE_TYPE_DIRECTION_MATRIX } from "@nano-agent/nacp-core";
  import { validateSessionFrame, NACP_SESSION_VERSION } from "@nano-agent/nacp-session";
  
  export function probe() {
    console.log("nacp-core version:", NACP_VERSION);
    console.log("nacp-session version:", NACP_SESSION_VERSION);
    console.log("matrix type count:", Object.keys(NACP_CORE_TYPE_DIRECTION_MATRIX).length);
  }
  ```
- **`test/import-smoke.test.ts`**:
  ```ts
  import { describe, it, expect } from "vitest";
  import { NACP_VERSION } from "@nano-agent/nacp-core";
  import { NACP_SESSION_VERSION } from "@nano-agent/nacp-session";
  
  describe("dogfood import smoke", () => {
    it("nacp-core 1.4.0 from GitHub Packages", () => {
      expect(NACP_VERSION).toBe("1.4.0");
    });
    it("nacp-session 1.4.0 from GitHub Packages", () => {
      expect(NACP_SESSION_VERSION).toBe("1.4.0");
    });
  });
  ```
- **执行步骤**:
  1. owner 或 CI 设置 env `NPM_AUTH_TOKEN`(PAT with `read:packages`)
  2. `cd dogfood/nacp-consume-test && pnpm install --ignore-workspace`
  3. `pnpm build && pnpm test`
  4. 所有 step 成功 → W2 closure memo 归档 build log
- **一句话收口目标**:✅ **dogfood 消费者从 GitHub Packages install + build + test 成功,version 断言返回 1.4.0**

#### P6: Publishing discipline doc

- **文件位置**:`docs/design/pre-worker-matrix/W2-publishing-discipline.md`
- **章节建议**:
  1. 背景(只发 2 NACP 包)
  2. Tag 规则(`nacp-v<semver>`,SemVer 要求)
  3. 发布流程(tag → CI → verify)
  4. 版本 bump 决策(什么情况下 minor / patch)
  5. CHANGELOG 同步要求
  6. Consumer `.npmrc` 配置模板
  7. 紧急撤回流程(24h 窗口内 unpublish / 窗口外 deprecate + patch)
  8. 发布前 checklist(package.json version / CHANGELOG head / test green)
  9. 未来扩展点(beta tag / public access / signature)
- **一句话收口目标**:✅ **doc 涵盖 9 节;owner-approved**

#### P7: W2 closure memo

- **文件**:`docs/issue/pre-worker-matrix/W2-closure.md`
- **必含字段**:
  - 首发 tag URL
  - 首次 workflow run URL
  - GitHub Packages registry URL
  - Dogfood build log(quote)
  - 实际 scope 确认(`@nano-agent` 或其他)
  - Owner sign-off
- **一句话收口目标**:✅ **closure memo 内所有证据 URL 有效**

### 7.3 非功能性要求

- **性能**:发布全流程(tag push → registry visible)< 5 分钟
- **可观测性**:workflow 每 step log 可查;失败 step 有 `::error::` annotation
- **稳定性**:重复 tag push(无需 force)应 idempotent — workflow 检测已发布版本,失败 retry-safe
- **测试覆盖**:2 包 unit test full pass;dogfood smoke test 证明 consumer 可 import

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 nano-agent 现有

| 位置 | 内容 | 借鉴点 |
|---|---|---|
| `packages/nacp-core/package.json` | 现有 package shape | S1 直接加 publishConfig |
| `packages/nacp-session/package.json` | 同上 | S2 同 |
| `packages/nacp-core/CHANGELOG.md`(W0 1.4.0 entry) | CHANGELOG 规范 | P4 发布时 release note 引用 |
| `docs/rfc/nacp-core-1-4-consolidation.md`(W0 产出) | RFC 规范 | P4 release note 附 RFC link |

### 8.2 来自 GitHub Packages 官方示例

| 位置 | 内容 | 借鉴点 |
|---|---|---|
| GitHub docs: "Publishing nodejs packages to GitHub Packages" | workflow template | P2 workflow 的 `setup-node` 配置 |
| `actions/setup-node@v4` README | `registry-url` + `scope` 用法 | P2 里的 auth 配置 |

### 8.3 来自 pnpm 官方

| 位置 | 内容 | 借鉴点 |
|---|---|---|
| pnpm publish docs | `--no-git-checks` + `--filter` | P2 里的 publish 命令 |
| pnpm workspace docs | `--ignore-workspace` | P5 dogfood install 必要 flag |

### 8.4 需要避开的反例

| 做法 | 问题 | 我们为什么避开 |
|---|---|---|
| `npm publish` 全 workspace | 会发所有 package | 我们硬编码 2 包 |
| 用 PAT 而非 GITHUB_TOKEN | PAT 管理成本 | 无必要(GITHUB_TOKEN 够用) |
| commit trigger publish | 每 commit 都发 | 无版本管理 |
| 把 dogfood 加进 workspace | 会用 workspace link | 违背 dogfood 验证意图 |
| 发布时跑 root/cross tests | 需要 Tier B build,不必要依赖 | 与 publish 流水线解耦 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

W2 是 **"最小必要 DevOps 层"**:

- **存在形式**:1 个 workflow + 2 个 package.json field + 1 个 dogfood 项目 + 1 份 discipline doc
- **覆盖范围**:仅 2 个 NACP 包的发布;不涉及 runtime 行为
- **耦合形态**:
  - 与 W0 强耦合(发布对象就是 W0 的 consolidated nacp-core 1.4.0)
  - 与 W1 软耦合(首发内容包含 W1 的新 symbol,但 W2 流水线逻辑不依赖 W1)
  - 与 W4 解耦(W4 workers 在 W2 完成后才能 import from GitHub Packages,但 W2 不需要等 W4)
- **预期代码量级**:
  - `publish-nacp.yml` ~60-80 行 YAML
  - 2 个 `package.json` 修改 ~6 行
  - `dogfood/nacp-consume-test/` ~80-100 行(package.json + tsconfig + 1 src + 1 test + .npmrc)
  - discipline doc ~300-400 行
  - closure memo ~50 行
- **预期复杂度**:低 — 几乎纯 DevOps;零 runtime 风险

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|---|---|---|
| 对 nano-agent 核心定位的贴合度 | **5** | 把 "只发 2 包" owner 决策从 charter 字面变成 CI 强制事实 |
| 第一版实现的性价比 | **5** | 纯 DevOps 工程;工作量很小收益非常高 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | **4** | 所有未来 NACP 协议变更都走同一流水线;无管道维护成本 |
| 对开发者自己的日用友好度 | **4** | `git tag && git push` 就能发布;心智负担低 |
| 风险可控程度 | **5** | workflow 失败不影响 runtime;unpublish 窗口兜底;完全反向可操作 |
| **综合价值** | **4.6** | 极高 ROI 的 DevOps 基础设施 |

### 9.3 下一步行动

- [ ] **决策确认**(W2 动手前,owner 需 approve):
  - §6.1 取舍 1(2 包白名单)是否接受?
  - §6.1 取舍 4(首发用 1.4.0 而非 0.1.0)是否接受?
  - §6.1 取舍 3(tag format `nacp-v*`)是否接受?
  - **Q2**:GitHub org / scope 实际名(目前占位 `@nano-agent`)
  - §5.2 [O9] 是否接受保持 restricted(如 owner 已决策转 public,提前告知)
- [ ] **关联 action-plan**:`docs/action-plan/pre-worker-matrix/D3-publishing-pipeline.md`(7 个 P1-P7 的执行批次化)
- [ ] **关联 policy doc 拆出**:`docs/design/pre-worker-matrix/W2-publishing-discipline.md`(本 design owner-approve 后,P6 产出作为独立 policy doc,charter §14.1 有 placeholder)
- [ ] **依赖下游**:
  - W4 的 `workers/*/package.json` 写法等着 W2 发布完成(W4 消费 `@<scope>/nacp-core@1.4.0`)
- [ ] **待深入调查的子问题**:
  - repo 是否已有 `.gitignore` 保护 `dogfood/` 的 node_modules?
  - pnpm workspace 是否已有 exclude pattern?需加 `!dogfood`?
  - 现有 `packages/nacp-core/package.json` 是否有 `private: true` 字段需先删?

---

## 附录

### A. 讨论记录摘要

- **分歧 1**:首发用 1.4.0 vs 重起 0.1.0
  - **Opus 倾向**:1.4.0
  - **理由**:与 `NACP_VERSION` 常量一致;与 in-repo ship 同步
  - **当前共识**:1.4.0(§6.1 取舍 4)
- **分歧 2**:tag prefix 用 `nacp-v*` vs `v*`
  - **Opus 倾向**:`nacp-v*`
  - **理由**:预留多种 tag namespace 空间
  - **当前共识**:`nacp-v*`(§6.1 取舍 3)
- **分歧 3**:dogfood 在本 repo 还是独立 repo
  - **Opus 倾向**:本 repo `dogfood/`
  - **理由**:简化 admin;git 历史可追溯
  - **当前共识**:本 repo(§6.1 取舍 5);注意 workspace exclusion

### B. 开放问题清单

- [ ] **Q1**:现有 `packages/nacp-core/package.json` + `packages/nacp-session/package.json` 是否有 `private: true`?如有,P1 step 里先删
- [ ] **Q2**:GitHub org 实际名?假设 `@nano-agent`;若不同,本 design §5.1 S3 处换
- [ ] **Q3**:owner 是否已有 GitHub Packages 使用历史?(影响 first-time authorization flow)
- [ ] **Q4**:`dogfood/` 是否需要加到 `.gitignore`(至少 `node_modules` / `dist`)?
- [ ] **Q5**:pnpm workspace 已有配置,是否需 `!dogfood` exclusion?(需核查 `pnpm-workspace.yaml`)
- [ ] **Q6**:unpublish 若超过 GitHub Packages 24h 窗口,recovery pattern 是发 1.4.1 patch 还是 deprecate 1.4.0 永久警告?
- [ ] **Q7**:workflow 内 test step 是否需要 `--reporter=github-actions`(更友好 log)?

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|---|---|---|---|
| v0.1 | 2026-04-21 | Claude Opus 4.7 | 初稿:7 个 P1-P7 功能 + 6 个 tradeoff + workflow YAML 草案 + dogfood 消费者 shape |
