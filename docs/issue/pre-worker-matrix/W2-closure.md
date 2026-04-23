# W2 Closure — GitHub Packages First Publish

> 阶段：`pre-worker-matrix / W2`
> 状态：`closed (first publish completed)`
> 关联：
> - `docs/design/pre-worker-matrix/W2-publishing-pipeline.md`
> - `docs/design/pre-worker-matrix/W2-publishing-discipline.md`
> - `docs/action-plan/pre-worker-matrix/W2-publishing-pipeline.md`

---

## 1. 结论摘要

W2 已从 **skeleton complete / first publish deferred** 升级为 **first publish completed**。

本轮真实完成的结果是：

1. 采用当前仓库 owner 对齐的 scope：`@haimang/*`
2. 真实发布 `@haimang/nacp-core@1.4.0`
3. 真实发布 `@haimang/nacp-session@1.3.0`
4. 在同一个 GitHub Actions run 内完成 dogfood published-path install/build/smoke

因此，W2 不再只是“registry-ready skeleton”，而是：

> **NACP 双包已经以 `@haimang` scope 首次发布到 GitHub Packages，并被同仓 dogfood consumer 真实消费验证。**

---

## 2. 本轮最终交付物

### 2.1 代码 / 配置

- `packages/nacp-core/package.json`
  - `name = @haimang/nacp-core`
  - `repository.url = https://github.com/haimang/nano-agent.git`
- `packages/nacp-session/package.json`
  - `name = @haimang/nacp-session`
  - `repository.url = https://github.com/haimang/nano-agent.git`
- `.github/workflows/publish-nacp.yml`
  - `scope: "@haimang"`
  - bundle version gate 仍锚定 `nacp-core@1.4.0`
  - 发布后追加 dogfood install/build/smoke
- `dogfood/nacp-consume-test/*`
  - 依赖切到 `@haimang/nacp-core@1.4.0` / `@haimang/nacp-session@1.3.0`

### 2.2 首发 release 资产

- release-ready commit: `ff9a03d` — `chore: prepare haimang nacp publish`
- workflow fix commit: `8da7e6b` — `fix: order nacp publish workflow builds`
- bundle tag: `nacp-v1.4.0`
- 成功 workflow run:
  - run URL: `https://github.com/haimang/nano-agent/actions/runs/24814439569`
  - job URL: `https://github.com/haimang/nano-agent/actions/runs/24814439569/job/72625731482`
- 首次失败 run（已修复后重发同名 tag）:
  - run URL: `https://github.com/haimang/nano-agent/actions/runs/24814362710`
  - 根因：CI clean checkout 下 `nacp-session` typecheck 先于 `nacp-core` build，导致 `@haimang/nacp-core` 无 `dist` 可解析

---

## 3. Mandatory / Optional 状态裁定

| 项目 | 设计定位 | 最终结果 | 裁定 |
|---|---|---|---|
| 双包 publish metadata | mandatory skeleton | 已完成 | `done` |
| publish workflow skeleton | mandatory skeleton | 已完成 | `done` |
| dogfood skeleton | mandatory skeleton | 已完成 | `done` |
| discipline doc | mandatory skeleton | 已完成 | `done` |
| W2 closure memo | mandatory skeleton | 已完成 | `done` |
| 首次 GitHub Packages 发布 | optional parallel | 已完成 | `done` |
| published-path dogfood install | optional parallel | 已完成 | `done` |

---

## 4. 关键现实对齐

### 4.1 scope 决策

`nano-agent` 这个 GitHub namespace 已被现有用户账号占用，不能直接注册同名 org。因此本轮采用仓库 owner 对齐的真实发布路径：

1. scope = `@haimang`
2. repository = `haimang/nano-agent`
3. package 名称与 workflow scope 全部对齐到当前 owner reality

### 4.2 版本纪律

W2 继续保持 W0/W1 之后已经冻结的版本纪律：

1. bundle tag `nacp-v1.4.0` 锚定 `@haimang/nacp-core@1.4.0`
2. `@haimang/nacp-session` 在同一 publish run 内保持自己的 semver：`1.3.0`
3. dogfood 与 workflow published-path 验证都跟随这个真实版本对

### 4.3 为什么第一次 run 失败但不影响最终首发

第一次 run `24814362710` 失败在 workflow 的 `Typecheck NACP packages`，并未进入 publish step。因此：

1. 没有产生半发布 / 部分发布状态
2. 可以安全删除并重推同名 tag `nacp-v1.4.0`
3. 修复后第二次 run `24814439569` 成功完成双包发布与 dogfood 验证

---

## 5. 实际证据

### 5.1 tag / run 证据

1. `git push origin nacp-v1.4.0` 已成功
2. `publish-nacp.yml` 第二次 run `24814439569` 结论为 `success`
3. job `72625731482` 的 12 个核心 step 全部为 `success`：
   - `Typecheck and build nacp-core`
   - `Typecheck and build nacp-session`
   - `Test NACP packages`
   - `Publish nacp-core`
   - `Publish nacp-session`
   - `Verify dogfood install`

### 5.2 publish 日志证据

成功 run 的关键日志：

1. `Publishing bundle 1.4.0: @haimang/nacp-core@1.4.0 + @haimang/nacp-session@1.3.0`
2. `npm notice Publishing to https://npm.pkg.github.com/ with tag latest and restricted access`
3. `+ @haimang/nacp-core@1.4.0`
4. `+ @haimang/nacp-session@1.3.0`

两包 tarball 细节（来自成功 run）：

| 包 | 文件名 | package size | unpacked size | total files |
|---|---|---:|---:|---:|
| `@haimang/nacp-core@1.4.0` | `haimang-nacp-core-1.4.0.tgz` | `67.0 kB` | `381.9 kB` | `146` |
| `@haimang/nacp-session@1.3.0` | `haimang-nacp-session-1.3.0.tgz` | `34.1 kB` | `170.1 kB` | `82` |

### 5.3 dogfood published-path 证据

成功 run 的 `Verify dogfood install` step 输出：

1. install:
   - `+ @haimang/nacp-core 1.4.0`
   - `+ @haimang/nacp-session 1.3.0`
   - `Done in 1.7s`
2. build:
   - `tsc -p tsconfig.json` 成功
3. smoke:
   ```json
   {
     "nacpCoreVersion": "1.4.0",
     "nacpSessionVersion": "1.3.0",
     "coreTypeCount": 11
   }
   ```

这说明 published package path 不仅存在，而且已被同仓 consumer 成功 install / build / execute。

### 5.4 package page 证据说明

本地 `gh` token 当前缺少 `read:packages` scope，因此我无法在 CLI 中直接列出私有 GitHub Packages 页面 / version API。

但对 W2 收口来说，以下证据已足够：

1. publish step 成功
2. dogfood install 从 registry 成功
3. dogfood smoke 读到真实 published version

---

## 6. 对 W4 / W5 的意义

W2 现在给后续 phase 的不再是 “publish skeleton complete”，而是更强的 3 条基线：

1. **W4** 若要走 published path，当前真实消费面是 `@haimang/nacp-core@1.4.0` + `@haimang/nacp-session@1.3.0`
2. **W4** 仍可保留 `workspace:*` interim path，但这已经不是唯一可行路径
3. **W5** 可以把 W2 视为 “first publish complete”，不再只是 deferred parallel track

---

## 7. 最终 verdict

**W2 = closed（first publish completed）**。

这个关闭成立的理由是：

1. mandatory skeleton 已完整存在于仓库
2. owner-aligned scope 已收口到 `@haimang`
3. 双包真实发布已完成
4. published-path dogfood install/build/smoke 已完成

W2 现在已经不再阻塞任何后续 “import / publish reality” 判断；后续需要承接的只是：

1. 若未来要改为公开包或新 namespace，再做独立 release policy 调整
2. W4 / worker-matrix 选择何时从 `workspace:*` 切换到 `@haimang/*`
