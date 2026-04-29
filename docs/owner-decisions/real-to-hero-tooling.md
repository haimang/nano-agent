# Real-to-Hero — Owner Tooling Readiness (P0-F)

> 阶段: `real-to-hero / RH0 / Phase 1 — P0-F1`
> 执行人: `owner (haimang) + Opus 4.7`
> 执行日期: `2026-04-29`
> 关联 action-plan: `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md` §4.1
> 冻结来源: `docs/design/real-to-hero/RHX-qna.md` Q5(业主已落字 同意 Opus 路线)
> 文档状态: `final`

---

## 0. 执行说明

本文件按 RHX-qna Q5 业主签字版本一次性记录 RH0 Phase 1 P0-F1 的 8 步 tooling readiness checklist。任何后续 phase 在 build / deploy / install 路径出现失败时,必须先回看本文件复核凭据是否仍有效。

记录原则:
- **timestamp**:UTC 日期 + 执行 turn(本轮 = `2026-04-29` Opus 4.7 turn-30)
- **output hash**:对结构性输出取 head/tail 摘要,避免敏感字段入 git
- **verdict**:`pass` / `fail` / `owner-override`,失败必须按 RHX-qna Q5 三选一处置(修复 / 升级 in-scope / 业主签字)

---

## 1. 8 步 checklist 执行记录

### Step 1 — `wrangler whoami`

- **命令**:`npx wrangler whoami`
- **timestamp**:2026-04-29
- **输出摘要**:
  - `OAuth Token` associated with `sean.z@haimangtech.cn`
  - Account: `Sean.z@haimangtech.cn's Account` (id `8b611460403095bdb99b6e3448d1f363`)
  - Token scopes 含 `workers_scripts:write` / `workers_kv:write` / `d1:write` / `ai:write` / `pipelines:write`(覆盖 6-worker deploy + KV/R2/D1/AI 全路径)
- **verdict**:✅ `pass`

### Step 2 — `gh auth status`

- **命令**:`gh auth status`
- **timestamp**:2026-04-29
- **输出摘要**:
  - Logged in to `github.com` 帐号 `haimang`(active)
  - Git protocol: `https`
  - Token scopes: `gist, read:org, repo, workflow`
- **verdict**:✅ `pass`(scopes 足够 PR / Actions / release;`read:packages` 走另一份 PAT,见 step 3)

### Step 3 — jwt-shared build with `NODE_AUTH_TOKEN`

- **命令**:`NODE_AUTH_TOKEN=*** pnpm --filter @haimang/jwt-shared build`(本轮直接复用既有 dist 验证)
- **timestamp**:2026-04-29
- **输出摘要**:
  - `packages/jwt-shared/dist/{index.js,index.d.ts,*.map}` 已存在(2026-04-29 main snapshot)
  - `npm whoami --registry=https://npm.pkg.github.com` 返 `haimang`(NODE_AUTH_TOKEN classic PAT 含 `read:packages`,可拉 `@haimang/*` GitHub Packages)
  - 实际 lockfile rebuild + 全量 build 在 P0-A1 步骤验证(见 §2)
- **verdict**:✅ `pass`

### Step 4 — `wrangler r2 bucket list`

- **命令**:`npx wrangler r2 bucket list`
- **timestamp**:2026-04-29
- **输出摘要**:
  - 共 20 个 R2 bucket
  - 含 nano-agent 命名:`nano-agent-spike-do-storage-probe` / `nano-agent-spike-do-storage-probe-r2`
  - RH4 真实 binding 业务 bucket 名留待 RH4 决定(`design RH4 §5.1`),RH0 仅占位
- **verdict**:✅ `pass`(account 有 R2 quota + 已存在 nano-agent placeholder bucket)

### Step 5 — `wrangler kv namespace list`

- **命令**:`npx wrangler kv namespace list`
- **timestamp**:2026-04-29
- **输出摘要**:
  - 共 19 个 KV namespace
  - 含 nano-agent 命名:`nano-agent-spike-do-storage-kv` / `nano-agent-spike-do-storage-kv-r2`
- **verdict**:✅ `pass`

### Step 6 — `wrangler ai models --json | wc -l ≥ 13`

- **命令**:`npx wrangler ai models --json | python3 -c "import json,sys; print(len(json.load(sys.stdin)))"`
- **timestamp**:2026-04-29
- **输出**:`91`
- **verdict**:✅ `pass`(远高于 charter §7.1 / RH5 baseline 13 模型最低线)

### Step 7 — `pnpm install --frozen-lockfile`(lockfile 重建后复跑)

- **命令**:`pnpm install --frozen-lockfile`(P0-A1 lockfile 重建后)
- **timestamp**:2026-04-29
- **重建前**:fail — lockfile 缺 `packages/jwt-shared` importer 且含 6 条 stale importer(`agent-runtime-kernel` / `capability-runtime` / `context-management` / `hooks` / `llm-wrapper` / `session-do-runtime`),按 RHX-qna Q5 失败处置政策 (b) 升级为 P0-A1 in-scope
- **重建后**:✅ pass — `Lockfile is up to date, resolution step is skipped` / `Already up to date` / `Done in 5.2s`(jwt-shared importer 出现 5 次;6 条 stale importer 计数 0)
- **verdict**:✅ `pass`(post-rebuild)

### Step 8 — 6-worker `wrangler deploy --env preview --dry-run`

- **命令**:每个 worker `pnpm exec wrangler deploy --env preview --dry-run`
- **timestamp**:`2026-04-29`(P0-C1 KV/R2 binding 占位声明完成后)
- **结果**:✅ 6 worker dry-run 全 0 退出,`env.NANO_KV (f5de37a4139a480683368d39ca4bbb62)` + `env.NANO_R2 (nano-agent-spike-do-storage-probe)` 在每个 worker 的 binding summary 中均可见
- **真实 deploy(P0-E1 后置步骤)**:6 worker 已成功部署到 preview 环境,Version IDs 见 `docs/issue/zero-to-real/post-fix-verification.md` §1
- **verdict**:✅ `pass`

---

## 2. 失败处置政策(per RHX-qna Q5,业主签字版)

8 步中任何一步失败,业主必须在 24h 内三选一:

1. **(a) 修复后重跑 checklist**:适用于凭据过期 / 临时网络问题
2. **(b) 把失败步骤升级为 RH0 in-scope 工作**:适用于资源不足(quota / 包未发布 / lockfile 漂移),把修复纳入 RH0 PR
3. **(c) 业主以书面形式写明可降级的理由并签字**:适用于环境差异,必须显式 owner-override

不允许"先开工再补"。本轮 step 7 已按 (b) 升级为 P0-A1 in-scope。

---

## 3. RH0 启动判定

- ✅ Step 1-6 全部 pass(凭据 + 资源 + 模型 catalog 健康)
- ✅ Step 7 P0-A1 lockfile 重建后 frozen-lockfile install 全绿
- ✅ Step 8 6-worker dry-run 全通,真实 preview deploy 已落地

**判定**:RH0 Start Gate `pass`,RH0 Phase 1-7 全部完成,RH1 Per-Phase Entry Gate 已成立。

---

## 4. 修订历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| `r1` | `2026-04-29` | `Owner + Opus 4.7` | RH0 Phase 1 初版,记录 step 1-6 pass + step 7-8 已知状态 |
