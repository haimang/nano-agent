# W2 Publishing Discipline（设计级纪律文档）

> 状态：pre-worker-matrix / W2 executed 配套子文档  
> 配套主文：`docs/design/pre-worker-matrix/W2-publishing-pipeline.md`

## 1. 文档目标

`W2-publishing-pipeline.md` 负责说明“为什么 W2 需要 skeleton、为什么首发是 optional parallel track”；本文件只负责把 **publish 行为纪律** 写清楚，避免后续 action-plan 在 release、dogfood、interim `workspace:*` 与 published version 之间来回摇摆。

## 2. 当前代码事实

当前仓内已存在的硬事实：

- `packages/nacp-core/package.json`：已是独立 package，当前版本 `1.4.0`
- `packages/nacp-session/package.json`：已是独立 package，当前版本 `1.3.0`
- `pnpm-workspace.yaml`：当前 workspace 只包含 `packages/*`
- 当前 package 名称仍是 `@nano-agent/*`，而仓库 owner 现实是 `haimang/nano-agent`；因此 **workflow skeleton 可以先按当前 package truth 落盘，但真实首发仍需 owner-aligned namespace / publish venue 最终确认**

因此，W2 的最小真实任务不是“发明 publish 概念”，而是把**已有双包**的 publish skeleton、discipline、dogfood 路径写成稳定约束。

## 3. W2 必须坚持的 6 条纪律

### 3.1 skeleton mandatory，首发 optional

W2 必须产出：

1. `publishConfig`
2. 发布 workflow skeleton
3. consumer / dogfood 安装纪律
4. 失败回退纪律

但**不强制**在 pre-worker-matrix 阶段完成真实首发。若 owner 决定不在本阶段首发，workers 仍可先用 `workspace:*`。

### 3.2 只服务 `nacp-core` 与 `nacp-session`

W2 的 publish scope 只覆盖：

1. `@nano-agent/nacp-core`
2. `@nano-agent/nacp-session`

本阶段不把 `agent-runtime-kernel`、`llm-wrapper`、`capability-runtime`、`workspace-context-artifacts` 等 Tier B 包一并拉入发布面。

### 3.3 版本与 contract freeze 一致

publish 行为不能脱离 contract freeze 独立发生。版本 bump、tag、CHANGELOG 都应服务于 frozen baseline，而不是“先发再说”。

当前已冻结的 publish baseline 是：

1. bundle tag 锚定 `nacp-core@1.4.0`
2. `nacp-session` 保持 `1.3.0` 直到它真实引入新的 published surface
3. 因此 W2 的版本一致性检查应是 **`tag == nacp-core.version`**，而不是强行要求双包同步 version

### 3.4 `workspace:*` 是合法 interim path

如果真实首发未做，`workers/*` 的 install/build 成功可以暂时建立在 `workspace:*` 上；这不是失败，而是 W2 设计明确允许的过渡路径。

### 3.5 publish evidence 必须可回看

一旦真实首发发生，至少要能回看：

1. workflow run
2. package version
3. dogfood install / import evidence
4. 当前 tag / release note

### 3.6 不为 W4 强绑单一路径

W4 的 `workers/agent-core` 必须允许两种 install reality：

1. `workspace:*`
2. published version

W2 不能把 W4 写成“只有 GitHub Packages 直装才算 closure”。

## 4. 建议的发布面结构

| 项目 | 纪律 |
|---|---|
| package owner | 仅 `nacp-core` / `nacp-session` |
| registry path | owner 决定 scope，但两个包必须一致 |
| versioning | bundle tag 锚定 `nacp-core` 当前 published baseline；`nacp-session` 可在同一 run 内按自身 semver 发布 |
| workflow trigger | `nacp-v*.*.*` tag only |
| consumer install | 支持 `workspace:*` 与 published dual-path |
| dogfood proof | 必须有至少一个真实 import/build 证明 |

## 5. 推荐的 skeleton 文件集合

> 说明：这里描述的是 W2 **应拥有**的文件面；并不声称这些文件此刻都已存在。

1. `.github/workflows/publish-nacp.yml`
2. `packages/nacp-core/package.json` 中的 publish metadata
3. `packages/nacp-session/package.json` 中的 publish metadata
4. `dogfood/` 下最小 consumer proof
5. 本文件（discipline）

以上 5 项现在都应被视为 W2 mandatory skeleton 的实际交付面。

## 6. 首发发生时的最低检查表

1. `nacp-core` / `nacp-session` 版本号与 CHANGELOG 对齐  
2. workflow 输入与 registry target 明确  
3. dry-run 或 preview publish 记录保留  
4. dogfood import 成功  
5. publish 失败时的回退路径写明（回退到 `workspace:*` 或撤 tag）

补充：若当前 repo owner 与 package scope 仍不对齐，closure 必须把真实首发标记为 **deferred**,不能把 skeleton complete 误写为 registry-ready published。

## 7. 若本阶段不首发，应如何写 closure

若 owner 选择本阶段不做真实首发，closure 应明确写：

1. workflow skeleton 已具备  
2. install/build dual-path 设计已冻结  
3. `workers/*` 当前采用 `workspace:*` interim path  
4. 真实首发推迟到 worker-matrix first-wave 或后续 release phase

## 8. 最终判断

这份 discipline 文档的作用，是把 W2 从“发布激情”收窄成“发布纪律”。pre-worker-matrix 阶段真正需要的是：

- **让 publish 成为可执行路径**
- 而不是 **强迫所有下游立刻依赖真实 registry 首发**

这也是为什么 W2 能与 W4 平行，而不应该成为 W4 的硬阻塞。
