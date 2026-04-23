# D08 — `workspace:*` → `@haimang/*` published path cutover

> 功能簇: `worker-matrix / published-path-cutover`
> 讨论日期: `2026-04-23`
> 讨论者: `Claude Opus 4.7 (1M context)`
> 关联调查报告:
> - `docs/plan-worker-matrix.md` §3 I11、§5.3 P5.A、§6.5 P5 DoD、§7 Q5(confirmed `(c) 独立 release PR`)
> - `docs/plan-worker-matrix-reviewed-by-GPT.md` §5.5
> - `docs/issue/pre-worker-matrix/W2-closure.md`(首发真相)
> - `docs/issue/pre-worker-matrix/W4-closure.md`(workspace:* interim 决策)
> 文档状态: `draft`

---

## 0. 背景与前置约束

W2 已经把 `@haimang/nacp-core@1.4.0` + `@haimang/nacp-session@1.3.0` 真实发布到 GitHub Packages。W4 选择 `workspace:*` 作为 worker shells 首轮依赖路径(有意的 interim,非 regression)。本设计负责 **在 P5 以独立 release PR 的方式**,把 4 个 worker 的 `@haimang/nacp-*` 依赖从 `workspace:*` 切换到具体版本号(`1.4.0` / `1.3.0`),并完成 redeploy 验证。

charter Q5 最终决策是 **(c) 独立 release PR schedule**(not `(a) 首批 absorb 稳定 1 周后` 的日历化触发),以避免 interim 漂成 permanent,同时避免过早 cutover 把 P2-P4 验证噪音带进包版本管理。

- **项目定位回顾**:`workspace:*` interim 有诚实理由;但 interim 不能永久。cutover 是 **release hygiene**,不是 first-wave 架构证明的一部分。
- **本次讨论的前置共识**:
  - W2 published path 真实存在:`@haimang/nacp-core@1.4.0`、`@haimang/nacp-session@1.3.0`
  - W4 "workspace:* interim" 有意设置,不是 gap
  - Q5c:独立 P5 release PR 执行 cutover;不搭车 P2/P3/P4 PR
  - cutover 完成后,pnpm lockfile 应反映 published registry resolution 而非 workspace path
- **显式排除的讨论范围**:
  - Tier B package cutover(Tier B 不发布,永远 `@nano-agent/*` 内部 scope;D09 negotiate Tier B deprecation)
  - production env flip(下一阶段)
  - 改变 nacp-core / nacp-session 的 semver 规则或发布纪律(W2 纪律保持)
  - dogfood consumer 路径改动(`dogfood/nacp-consume-test/` 本就 published;保持不变)

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**:`workspace:* → @haimang/* published path cutover`
- **一句话定义**:P5 开一个 **独立 release PR**,把 `workers/{agent-core,bash-core,context-core,filesystem-core}/package.json` 对 `@haimang/nacp-core` / `@haimang/nacp-session` 的 `workspace:*` 依赖改成具体版本号(`1.4.0` / `1.3.0`),更新 lockfile,重跑 build/test/dry-run,并 redeploy `workers/agent-core` preview 验证 live probe 仍合法。
- **边界描述**:
  - **包含**:4 个 `package.json` 版本号改写、lockfile 更新、build/test/dry-run 回归、agent-core preview redeploy + live probe 验证、PR body 里附 release note
  - **不包含**:Tier B scope 切换(保持 `@nano-agent/*`)、NACP semver bump / 新发布、production env flip、dogfood consumer 路径改动、`nacp-core` 或 `nacp-session` source 修改
- **关键术语对齐**:

| 术语 | 定义 |
|------|------|
| `workspace:*` | pnpm workspace path,解析到 `packages/nacp-core` / `packages/nacp-session` 的本地源 |
| `1.4.0` / `1.3.0` | 已发布到 GitHub Packages 的版本号 |
| release PR | 专门负责 cutover 的 PR,独立于 P2-P4 任何 absorb PR |
| live probe | `curl` agent-core preview 返回的 JSON;cutover 后 `nacp_core_version` / `nacp_session_version` 字段 value 不变 |
| `.npmrc` scope | `@haimang:registry=https://npm.pkg.github.com`(W2 + W4 已就绪) |

### 1.2 参考调查报告

- `docs/issue/pre-worker-matrix/W2-closure.md` §5 首发真相(`@haimang/nacp-core@1.4.0` / `@haimang/nacp-session@1.3.0`)
- `docs/issue/pre-worker-matrix/W4-closure.md` §4.2 workspace:* interim 决策
- `workers/{agent-core,bash-core,context-core,filesystem-core}/package.json` — 当前 `workspace:*` 配置
- `pnpm-lock.yaml` — 当前 workspace resolution
- `.github/workflows/publish-nacp.yml` — 发布真相

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **架构角色**:把 W2 交付的 published path 从 "存在但 worker 未使用" 升级为 "worker 实际使用";同时把 "interim" 退役
- **服务于**:release hygiene、后续 production flip、worker-matrix exit primary #3
- **依赖**:P2(live loop 绿)+ P3(context absorb 绿)+ P4(filesystem absorb 绿) 三 phase DoD 全绿;W2 published path 持续可用
- **被谁依赖**:charter exit primary #3、D09 deprecation(cutover 后 `workers/` 内 NACP 依赖不再经 `packages/` 解析)

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|----------|----------|------|
| P2-P4 全部 absorb | 上游(硬前置)| 强 | P5 cutover 要求 P2/P3/P4 DoD 全绿 |
| W2 published path | 上游 | 强 | cutover 依赖真实可 install 的 published bundle |
| D09 deprecation | 同 P5 / 下游 | 中 | cutover 后,Tier B package 进入 deprecation 候选;但 cutover 本身只改 NACP 依赖,不动 Tier B |
| `dogfood/nacp-consume-test` | 并行非 worker | 弱 | 已经走 published path;cutover 不改 dogfood |
| B7 LIVE | 非破坏 | 强 | cutover 后回归必须 5/5 |

### 2.3 一句话定位陈述

> "在 nano-agent 里,`published-path cutover` 是 **worker-matrix P5 的 release hygiene 交付物**,负责 **独立 release PR 里把 4 个 worker 的 @haimang/nacp-* 从 workspace:* 切到 1.4.0 / 1.3.0,并 redeploy 验证**,对上游(charter exit primary #3)提供 **interim 退役** 的真实兑现,对下游(D09 deprecation / 未来 production flip)要求 **worker 依赖已对齐 published registry,不再经本地 workspace**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点

| 被砍项 | 来源 | 砍的理由 | 未来回补 |
|--------|------|----------|----------|
| cutover 同时升级 NACP 版本(新 minor / patch) | 顺手 | cutover ≠ release;不 bump | 否(独立 release charter) |
| cutover 同时改 Tier B 包 scope | "clean 整合" | Tier B 保持 `@nano-agent/*` 内部 | 否 |
| cutover 同时 production env flip | 对称 | Q5c cutover 独立;production 属下一阶段 | 否 |
| "稳定 1 周" 日历化触发器(原 Q5a) | 原 v0.1 建议 | Q5c 明确:trigger = P2/P3/P4 DoD 全绿 + 独立 release PR | 否 |
| 在 cutover PR 里做 Tier B 的 DEPRECATED banner | 顺手 | D09 per-worker 时机纪律 | 否 |
| 允许某 worker 保留 workspace:* | 对称破坏 | 全切或不切;半切会造成 混合依赖 | 否 |

### 3.2 接口保留点

| 扩展点 | 表现形式 | 第一版行为 | 未来演进 |
|--------|----------|------------|----------|
| 版本 pin 方式 | 精确 `1.4.0` / `1.3.0` | 不用 caret `^1.4.0` | 可按需切 caret / semver range |
| registry | `.npmrc` scope `@haimang` | W2 已固 | 若未来迁到其他 org 走独立 migration |
| cutover 回滚 | revert PR 即可 | workspace:* 完全可恢复 | — |

### 3.3 完全解耦点

- **解耦对象**:cutover PR vs absorb PR
- **解耦原因**:release hygiene 与 runtime 装配不混;cutover PR 应 **只** 改 package.json / lockfile
- **依赖边界**:cutover PR 不触任何 `workers/*/src/**`、不触任何 `packages/**`、不触 charter / design

### 3.4 聚合点

- **聚合对象**:一次 PR 覆盖 4 个 workers
- **聚合形式**:一个 release PR,diff 集中(4 package.json + 1 lockfile + 1 agent-core preview redeploy record)
- **为什么不能分散**:部分切 = 混合依赖,pnpm 行为不确定;一次整切回滚成本最低

---

## 4. 三个代表实现对比(内部 precedent)

### 4.1 W2 dogfood consumer(已在 published path 运行)

- **实现概要**:`dogfood/nacp-consume-test/package.json` 使用 `@haimang/nacp-core: 1.4.0` 版本号 pin
- **亮点**:release pipeline 已被真实消费者 battle-test
- **借鉴**:cutover PR 可直接参考 dogfood 的 dependency 写法
- **不照抄**:dogfood 是外部 workspace(`--ignore-workspace`);workers 是内部 workspace member — cutover 时 pnpm 仍识别 workers,但 registry resolve 优先(lockfile 会明确 resolution path)

### 4.2 W4 workspace:* interim 决策

- **实现概要**:W4 有意选择 `workspace:*` 作首轮依赖
- **借鉴**:interim 的诚实理由(reduce registry auth + clean-checkout build-order 耦合)
- **不照抄**:P5 退役 interim

### 4.3 B9 1.2 → 1.3 contract freeze

- **实现概要**:B9 做 NACP 版本 freeze(additive)
- **借鉴**:release 纪律;additive semver
- **不照抄**:B9 改 package source + 发新 version;本设计不改 source / 不发新 version

### 4.4 横向对比

| 维度 | dogfood | W4 interim | B9 freeze | **D08** |
|------|---------|-----------|-----------|---------|
| 操作 | 初始化用 published | 首轮用 workspace:* | source + publish | **切依赖表示法** |
| 改 source | 否 | 否 | 是 | **否** |
| 发新 version | 否 | 否 | 是 | **否** |
| 回归 | smoke | dry-run | 全绿 | **build/test/dry-run + agent-core redeploy** |

---

## 5. In-Scope / Out-of-Scope

### 5.1 In-Scope

- **[S1]** cutover PR 前置条件确认:P2/P3/P4 DoD 全绿(charter §6 对应 DoD checklist 在 PR body 引用);`@haimang/nacp-core@1.4.0` / `@haimang/nacp-session@1.3.0` 在 GitHub Packages 仍可 install(手工 `gh` 或 preview dogfood 验证)
- **[S2]** 4 个 `workers/*/package.json` 批量 diff:
  - `"@haimang/nacp-core": "workspace:*"` → `"@haimang/nacp-core": "1.4.0"`
  - `"@haimang/nacp-session": "workspace:*"` → `"@haimang/nacp-session": "1.3.0"`
- **[S3]** `.npmrc`(repo root / workers/ 内若有)验证 scope 注册指向 GitHub Packages;若 worker 目录没 `.npmrc` 且 pnpm 未继承 root 的配置,补一份
- **[S4]** `NODE_AUTH_TOKEN` 在本地 / CI 可用(W2 pipeline 验证过)
- **[S5]** `pnpm install` 更新 `pnpm-lock.yaml`;lockfile diff 应反映 4 个 worker 对 `@haimang/nacp-*` 的 resolution path 从 `link:../../packages/nacp-core` 切到 registry tarball
- **[S6]** 全仓回归:
  - `pnpm -r run typecheck` 绿
  - `pnpm -r run test` 绿(含 workers 侧)
  - `pnpm --filter './workers/*' run deploy:dry-run` 4/4 绿
  - `node --test test/*.test.mjs` 98/98 绿
  - `npm run test:cross` 112/112 绿
- **[S7]** `workers/agent-core` redeploy preview:
  - `pnpm --filter workers/agent-core run build`
  - `pnpm --filter workers/agent-core run deploy:preview`
  - `curl <preview-url>` 返回 `nacp_core_version: "1.4.0"` / `nacp_session_version: "1.3.0"`(unchanged);P2 live loop 不受影响
- **[S8]** PR body 结构固化:
  - Prerequisites block(P2/P3/P4 DoD 引用)
  - Changed files list(4 package.json + lockfile + 可选 `.npmrc`)
  - Regression block(S6 所有命令输出)
  - Redeploy evidence(S7 preview URL + Version ID + curl 输出)
  - Rollback instruction(revert commit = rollback)

### 5.2 Out-of-Scope

- **[O1]** NACP 版本升 `1.4.1` / `1.3.1` / `1.5.0`
- **[O2]** Tier B scope 切换
- **[O3]** Tier B DEPRECATED banner(D09)
- **[O4]** production env flip
- **[O5]** 修改 W2 发布纪律 / CI
- **[O6]** 修改 dogfood consumer(已在 published path)
- **[O7]** 改 `workers/*/src/**` 任一文件
- **[O8]** 改 `packages/**` 任一文件
- **[O9]** 其他 worker(bash-core / context-core / filesystem-core)real preview deploy — charter §6 允许 defer;本设计不强制执行,除非 owner 要求

### 5.3 边界清单

| 项目 | 判定 | 理由 |
|------|------|------|
| cutover PR 内 bump 某个 worker 自己的 version | `out-of-scope` | cutover 只改依赖表示法 |
| cutover 允许改 lockfile 以外的 config(如 `pnpm-workspace.yaml`)| `out-of-scope` | workspace 仍含 packages/* + workers/*;published path 不删 workspace 成员资格(packages/nacp-core 继续在 workspace,对 workers 不再 link 即可) |
| cutover 后 `packages/nacp-core` / `packages/nacp-session` 是否保留 | `in-scope 保留` | workspace 仍需 `packages/nacp-core / packages/nacp-session` 本地源作 publish 源 + dogfood link |
| cutover 后某 worker 回滚到 workspace:* 做紧急修复 | `case-by-case` | revert PR 即可;纪律是默认 published |
| cutover 顺便做 `1.4.0` → `^1.4.0` caret range | `out-of-scope` | 精确 pin;caret 走独立 RFC |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**:**独立 release PR**(Q5c)而非 "绑在某个 absorb PR"
   - **为什么**:cutover 是 release hygiene,不是 first-wave 架构证明;绑在 absorb PR 会让 absorb 风险混入 cutover
   - **代价**:多一个 PR 流程
   - **缓解**:PR 极小 + 可回滚

2. **取舍 2**:**精确 pin `1.4.0` / `1.3.0`** 而非 caret `^1.4.0`
   - **为什么**:precise pin → 回归可重复;future semver bump 走独立 release charter
   - **代价**:下次 bump 需要再改 cutover-like PR
   - **缓解**:每次 bump 走独立 hygiene PR,纪律清晰

3. **取舍 3**:**4 workers 一次全切** 而非 "分批"
   - **为什么**:部分切 = 混合依赖;pnpm lockfile 行为不确定
   - **代价**:回滚影响 4 workers
   - **缓解**:revert commit 一键恢复

4. **取舍 4**:**workers/* package.json 用 `"1.4.0"` 字面量** 而非 `dependencies` 缺省
   - **为什么**:未来 bump 时所有 worker 同步切
   - **代价**:4 份 duplicate
   - **缓解**:可以用一个 `scripts` 辅助 grep / 脚本对齐

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解 |
|------|----------|------|------|
| `NODE_AUTH_TOKEN` 在本地或 CI 缺失 | token 过期 | `pnpm install` 红 | 提前 refresh token;W2 pipeline 已 battle-test |
| GitHub Packages 短时 unavailable | 上游不稳 | install 红 | PR 重试;回退 revert commit |
| `pnpm-lock.yaml` resolution 未正确切 registry | workspace path 仍存在 | 依赖仍 link 本地 | PR reviewer grep lockfile 内 `resolution: ...tarball` 或 `link:...` 判断 |
| `nacp_core_version` / `nacp_session_version` 字段实际从 `packages/*` 本地读 | cutover 后 runtime 仍用本地 source | silent | redeploy 后 `curl` 验证 version field 仍 `1.4.0` / `1.3.0`;若是从 package.json 字段读,则 cutover 后应 from registry tarball 的 package.json |
| B7 LIVE 对 nacp-core source 有间接 import | root test 直接 import `packages/nacp-core/src/**` | root test 与 cutover 无关 | root tests 本身不受 worker cutover 影响 |
| 某 worker 在源码内 import `../packages/nacp-core/...` 相对路径 | source drift | build 红 | grep 所有 `workers/*/src/**` 确认 import 用 `@haimang/nacp-*` scope,非相对路径 |

### 6.3 价值

- **对开发者自己**:interim 退役;cutover 后 `workers/` 依赖真相对齐 published registry
- **对 nano-agent 长期演进**:为 production env flip 提供稳定 preview baseline;为未来 external consumer 提供 "workers 能像 dogfood 一样从 registry 安装" 的证据
- **对 "上下文管理 / Skill / 稳定性" 杠杆**:
  - 稳定性:worker 依赖真相固化;避免 workspace drift
  - 长期:为 skill.core 入场(如果 admit)提供对称 published baseline 模式
  - 直接价值:charter exit primary #3 兑现

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | prerequisite 验证 | P2/P3/P4 DoD 全绿 + published path 真实 | ✅ PR body 引用 DoD 与 `gh` query 证明 |
| F2 | 4 package.json cutover | workspace:* → 1.4.0 / 1.3.0 | ✅ diff 精确 4 files × 2 lines |
| F3 | `.npmrc` 验证 | scope + auth 可用 | ✅ `.npmrc` 含 `@haimang:registry` + auth 可读;若缺失则补 |
| F4 | `pnpm install` | lockfile 更新 | ✅ `pnpm-lock.yaml` resolution 由 workspace link 切 tarball |
| F5 | 全仓回归 | typecheck / test / dry-run / root tests / cross tests | ✅ S6 所有命令绿 |
| F6 | agent-core redeploy | preview redeploy + live probe | ✅ `curl` 返回合法 JSON;Version ID 记录 PR body |
| F7 | PR body 结构固化 | prerequisite / diff / regression / evidence / rollback | ✅ PR body 模板齐全 |

### 7.2 详细阐述

#### F1: prerequisite 验证

- **输入**:P2/P3/P4 DoD checklist(charter §6.2 / §6.3 / §6.4)
- **输出**:PR body block "Prerequisites"
- **核心逻辑**:
  - 引用每个 phase closure(若已写)或 DoD 对应 PR
  - `gh api /orgs/haimang/packages/npm/nacp-core/versions | jq '.[].name'` 验证 `1.4.0` 存在;同 session/1.3.0
- **一句话收口目标**:✅ **PR body 明确 P2/P3/P4 DoD 已全绿 + published bundle 仍可 install**

#### F2: 4 package.json cutover

- **输入**:4 个 `workers/*/package.json` 当前 `workspace:*`
- **输出**:diff
  ```diff
  -  "@haimang/nacp-core": "workspace:*",
  -  "@haimang/nacp-session": "workspace:*"
  +  "@haimang/nacp-core": "1.4.0",
  +  "@haimang/nacp-session": "1.3.0"
  ```
- **核心逻辑**:sed / 手工 edit;4 files 完全一致
- **一句话收口目标**:✅ **diff 最小、精确,4 文件各 2 行**

#### F3: `.npmrc` 验证

- **输入**:repo root `.npmrc`(W2 已配 `@haimang:registry=https://npm.pkg.github.com`)
- **输出**:no-op 或在 workers/ 补一份(若 pnpm 不继承)
- **核心逻辑**:
  - 试跑 `pnpm --filter workers/agent-core install` 看是否能 resolve `@haimang/nacp-core@1.4.0`
  - 若报 `registry not found` → 补 `workers/.npmrc` 或 `workers/agent-core/.npmrc`
- **一句话收口目标**:✅ **install 能 authenticate + resolve**

#### F4: `pnpm install`

- **输入**:F2/F3 后
- **输出**:`pnpm-lock.yaml` 更新
- **核心逻辑**:
  - `pnpm install --lockfile-only`(或正常 install)
  - verify:`grep -A2 "'workers/agent-core':" pnpm-lock.yaml` 的 `@haimang/nacp-core` 条目是 `tarball` 或 `registry` 解析,不是 `link:`
- **一句话收口目标**:✅ **lockfile resolution 路径从 `link:` 切 tarball**

#### F5: 全仓回归

- **输入**:F4 后
- **输出**:CI-ready 回归证据
- **核心逻辑**:
  ```
  pnpm -r run typecheck
  pnpm -r run test
  pnpm --filter './workers/*' run deploy:dry-run
  node --test test/*.test.mjs
  npm run test:cross
  ```
- **边界情况**:若 dry-run 红因 dist/ 未 build,先 `pnpm --filter './workers/*' run build` 再 dry-run(与 D02/D01 CI 顺序一致)
- **一句话收口目标**:✅ **全部命令绿;B7 LIVE 5 + 98 root + 112 cross + workers test + workers dry-run 全绿**

#### F6: agent-core redeploy preview

- **输入**:F5 后
- **输出**:preview URL + Version ID 记录
- **核心逻辑**:
  - `pnpm --filter workers/agent-core run build`
  - `pnpm --filter workers/agent-core run deploy:preview`
  - `curl -fsSL https://nano-agent-agent-core-preview.haimang.workers.dev/`
  - 验证 JSON 里 `nacp_core_version === "1.4.0"`、`nacp_session_version === "1.3.0"`(字段 value 不变,但源头已是 registry tarball)
- **一句话收口目标**:✅ **redeploy 成功 + live probe 合法 + Version ID 记录**

#### F7: PR body 结构固化

- **输入**:F1-F6 产物
- **输出**:PR body 模板(在 PR body 或附 `docs/` 里一个 release note)
- **一句话收口目标**:✅ **PR body 含 5 块:Prerequisites / Diff / Regression output / Redeploy evidence / Rollback 指令**

### 7.3 非功能性要求

- **性能目标**:`pnpm install` 后冷 cache ≤ 1 min(registry 慢可重试)
- **可观测性要求**:lockfile diff 明确 workspace link 去除;live probe 字段保持
- **稳定性要求**:rollback 一键(revert commit);回滚后 workspace:* 恢复;dry-run 再次全绿
- **测试覆盖要求**:回归用既有 tests;不新增 test

---

## 8. 可借鉴的代码位置清单

### 8.1 现有代码

| 位置 | 内容 | 借鉴点 |
|------|------|--------|
| `dogfood/nacp-consume-test/package.json` | 已 published path consumer | F2 dependency 写法参考 |
| `dogfood/nacp-consume-test/.npmrc` | `@haimang` scope + auth | F3 参考 |
| `workers/*/package.json` | 当前 workspace:* | F2 目标文件 |
| `pnpm-lock.yaml` | workspace resolution | F4 验证对照 |
| `.github/workflows/publish-nacp.yml` | W2 发布 pipeline | 证明 version 存在 |

### 8.2 W2 precedent

| 位置 | 内容 | 借鉴点 |
|------|------|--------|
| W2 run `24814439569` | 成功 publish | 证明 registry live |
| W2-closure.md §5 | 首发证据 | F1 prerequisite reference |

### 8.3 必须避开的反例

| 位置 | 问题 | 避开理由 |
|------|------|----------|
| cutover PR 顺便 bump `1.4.0` → `1.4.1` | 混入 release | 否 |
| 部分 worker 切,部分保持 workspace:* | 混合依赖 | 否 |
| 同 PR 改 `packages/nacp-core/src/**` | 越界 | 否 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

D08 是 P5 的 release hygiene 交付物:独立 release PR 切 4 个 worker 的 NACP 依赖从 `workspace:*` 到 `1.4.0` / `1.3.0`,lockfile 更新,全仓回归 + agent-core redeploy 验证。PR 极小(diff ≈ 8 行 + lockfile),risk 可控,rollback 一键。

### 9.2 Value Verdict

| 维度 | 评级 | 说明 |
|------|------|------|
| 贴合度 | **5** | charter exit primary #3 |
| 性价比 | **5** | 极小 PR + 高 hygiene 价值 |
| "上下文 / Skill / 稳定性" 杠杆 | **3** | 纯 release hygiene;间接稳定性 |
| 开发者友好度 | **5** | diff 直观 + rollback 简单 |
| 风险可控 | **5** | revert 即回滚 |
| **综合价值** | **4.6** | P5 必做 |

### 9.3 下一步行动

- [ ] **决策确认**:owner approve P5 release PR schedule
- [ ] **关联 PR**:P2/P3/P4 closure closure 完成后开 release PR
- [ ] **待深入调查**:
  - `workers/` 目录下是否需要补独立 `.npmrc`(pnpm 不继承 root)?(建议:PR 执行时 trial-and-error)
  - agent-core preview redeploy 后,`nacp_core_version` 字段来源是 runtime import 还是 build-time embed?(若是 build-time,cutover 后应从 registry tarball 的 package.json 读;F6 验证)

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-23 | Claude Opus 4.7 | 初稿;基于 charter Q5c + GPT §5.5 编制 |
