# W2 Closure — GitHub Packages Publishing Skeleton

> 阶段：`pre-worker-matrix / W2`
> 状态：`closed (skeleton complete / first publish deferred)`
> 关联：
> - `docs/design/pre-worker-matrix/W2-publishing-pipeline.md`
> - `docs/design/pre-worker-matrix/W2-publishing-discipline.md`
> - `docs/action-plan/pre-worker-matrix/W2-publishing-pipeline.md`

---

## 1. 结论摘要

W2 已按 narrowed scope 收口为 **skeleton complete**。本轮真正落地的是：

1. 双包 `publishConfig`
2. tag-trigger 的 `publish-nacp.yml`
3. workspace 外的 dogfood consumer skeleton
4. W2 discipline / action-plan / downstream 引用同步

**没有**在本轮完成的内容也必须诚实写明：

1. 没有执行真实 GitHub Packages 首发
2. 没有得到 published-path dogfood install 证据
3. 当前 repo owner 与 package scope 仍存在 owner-aligned namespace 风险

因此，W2 的 closure 不是 “registry 已 ready for consumers”，而是：

> **publish skeleton 已经在仓内成为真实资产；真实首发继续保持 optional parallel。**

---

## 2. 本轮实际交付物

### 2.1 代码 / 配置

- `packages/nacp-core/package.json`
  - 新增 `publishConfig.registry = https://npm.pkg.github.com`
  - 新增 `publishConfig.access = restricted`
- `packages/nacp-session/package.json`
  - 同上
- `.github/workflows/publish-nacp.yml`
  - `nacp-v*.*.*` tag trigger
  - `contents: read` + `packages: write`
  - 双包 typecheck / build / test
  - bundle version check：`tag == nacp-core.version`
- `.gitignore`
  - 去除对 `.github/` 的整体忽略，确保 workflow 可被真实跟踪
- `pnpm-workspace.yaml`
  - 保持只包含 `packages/*`
  - 补注释说明 dogfood 必须留在 workspace 外

### 2.2 dogfood skeleton

- `dogfood/nacp-consume-test/package.json`
- `dogfood/nacp-consume-test/.npmrc`
- `dogfood/nacp-consume-test/tsconfig.json`
- `dogfood/nacp-consume-test/src/smoke.ts`
- `dogfood/nacp-consume-test/README.md`

当前 dogfood 依赖基线：

- `@nano-agent/nacp-core@1.4.0`
- `@nano-agent/nacp-session@1.3.0`

### 2.3 文档 / closure

- `docs/design/pre-worker-matrix/W2-publishing-pipeline.md`
- `docs/design/pre-worker-matrix/W2-publishing-discipline.md`
- `docs/action-plan/pre-worker-matrix/W2-publishing-pipeline.md`
- `docs/design/pre-worker-matrix/W4-workers-scaffolding.md`
- `docs/design/pre-worker-matrix/W5-closure-and-handoff.md`
- 本文件

---

## 3. Mandatory / Optional 状态裁定

| 项目 | 设计定位 | 本轮结果 | 裁定 |
|---|---|---|---|
| 双包 publish metadata | mandatory skeleton | 已完成 | `done` |
| publish workflow skeleton | mandatory skeleton | 已完成 | `done` |
| dogfood skeleton | mandatory skeleton | 已完成 | `done` |
| discipline doc | mandatory skeleton | 已完成 | `done` |
| W2 closure memo | mandatory skeleton | 已完成 | `done` |
| 首次 GitHub Packages 发布 | optional parallel | 未执行 | `deferred` |
| published-path dogfood install | optional parallel | 未执行 | `deferred` |

---

## 4. 关键现实对齐

### 4.1 版本现实

W2 之前的文档残留了一个直接冲突：默认把双包都写成 `1.4.0`。当前真实 shipped baseline 是：

1. `@nano-agent/nacp-core@1.4.0`
2. `@nano-agent/nacp-session@1.3.0`

因此本轮把 W2 的版本纪律改成：

1. `nacp-v<semver>` bundle tag **锚定 `nacp-core.version`**
2. `nacp-session` 在同一 publish run 内按自己的 semver 发布
3. dogfood 与 W4 的 published-path 示例必须跟随这个真实版本对

### 4.2 owner / scope 风险

当前 package scope 是 `@nano-agent/*`，但当前仓库现实是 `haimang/nano-agent`。这意味着：

1. skeleton 可以先按当前 package truth 落盘
2. 真实首发前仍需确认 owner-aligned namespace / publish venue
3. 这个问题影响 **first publish**，但不影响 **skeleton complete** 的 closure

### 4.3 为什么本轮不能宣称首发 ready

因为当前缺少的不是 workflow 文件，而是 **owner-aligned publish 条件**：

1. publish namespace 仍未在当前 repo reality 下被证明可行
2. 没有实际 Actions run / registry URL / package page evidence
3. dogfood 还没有走真实 GitHub Packages install

所以本轮选择保守收口：**只关闭 W2 mandatory skeleton，不伪造 optional 首发证据。**

---

## 5. 本轮验证摘要

本轮验证围绕 W2 真实交付面展开：

1. `@nano-agent/nacp-core`
   - `pnpm --filter @nano-agent/nacp-core typecheck`
   - `pnpm --filter @nano-agent/nacp-core build`
   - `pnpm --filter @nano-agent/nacp-core test`
   - `pnpm --filter @nano-agent/nacp-core publish --dry-run --no-git-checks`
2. `@nano-agent/nacp-session`
   - `pnpm --filter @nano-agent/nacp-session typecheck`
   - `pnpm --filter @nano-agent/nacp-session build`
   - `pnpm --filter @nano-agent/nacp-session test`
   - `pnpm --filter @nano-agent/nacp-session publish --dry-run --no-git-checks`
3. dogfood pre-publish smoke（复核补录 2026-04-23，hard evidence）
   - `pnpm pack` 产出 2 个本地 tarball：
     - `nano-agent-nacp-core-1.4.0.tgz` — 70.3 kB / 147 files / sha256 `7a49800071bcdfa1f4f8f4bc941d40d82d60e305`
     - `nano-agent-nacp-session-1.3.0.tgz` — 36.8 kB / 83 files / sha256 `2aa8b9ed74c8e92d02e074ae51b83a727e45e30c`
   - 在 throwaway copy 里把 dogfood 的 `dependencies` 改为 `file:` tarball 路径，并用 `pnpm.overrides` 把 `@nano-agent/nacp-core` 的传递依赖统一指向同一个 `core` tarball，避免 pnpm 回落公共 registry：
     ```json
     {
       "dependencies": {
         "@nano-agent/nacp-core": "file:/tmp/nacp-dogfood-tarball/nano-agent-nacp-core-1.4.0.tgz",
         "@nano-agent/nacp-session": "file:/tmp/nacp-dogfood-tarball/nano-agent-nacp-session-1.3.0.tgz"
       },
       "pnpm": {
         "overrides": {
           "@nano-agent/nacp-core": "file:/tmp/nacp-dogfood-tarball/nano-agent-nacp-core-1.4.0.tgz"
         }
       }
     }
     ```
   - `pnpm install --ignore-workspace --no-frozen-lockfile` → `+ @nano-agent/nacp-core 1.4.0` / `+ @nano-agent/nacp-session 1.3.0` / `+ zod 3.25.76` / `+ typescript 5.9.3`，`Done in 1.2s`
   - `pnpm build` → tsc 静默成功（无 error、无 warning）
   - `pnpm smoke` 输出：
     ```json
     {
       "nacpCoreVersion": "1.4.0",
       "nacpSessionVersion": "1.3.0",
       "coreTypeCount": 11
     }
     ```
     其中 `coreTypeCount = 11` 与当前 `NACP_CORE_TYPE_DIRECTION_MATRIX` 已注册的 core 消息族数量一致，说明 W0 shipped surface 可通过 tarball install 链路被 consumer 消费。

本轮没有执行真实 registry publish，因此也没有 registry URL / package page / workflow run URL 证据。

本轮记录的 dry-run / tarball smoke 数字由 W1-W2 code review 二次收口时（2026-04-23）复核产生，命令均可通过 `pnpm --filter ... publish --dry-run --no-git-checks` 与 `pnpm pack` 路径复现。

---

## 6. 对 W4 / W5 的意义

W2 现在能给后续 phase 提供的不是“GitHub Packages 已可消费”，而是更克制也更真实的 3 条基线：

1. **W4** 可以继续合法使用 `workspace:*` interim path
2. **W4** 若改写 published-path 示例，必须使用 `core@1.4.0 + session@1.3.0`
3. **W5** 在做 diagonal closure 时，可以把 W2 判为 “publish skeleton complete / first publish deferred”，而不是继续把它当 blocker

---

## 7. 最终 verdict

**W2 = closed（仅限 narrowed scope）**。

这个关闭成立的理由是：

1. mandatory skeleton 已完整存在于仓库
2. workflow / metadata / dogfood / discipline / closure 已互相对齐
3. 首次真实发布被继续保留为 optional parallel，没有被假装完成

后续若要把 W2 从 “skeleton complete” 升级为 “first publish complete”，只需要再补一轮非常明确的 evidence：

1. real tag
2. real workflow run
3. registry package page
4. published-path dogfood install log
