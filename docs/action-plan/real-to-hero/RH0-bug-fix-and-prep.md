# Nano-Agent 行动计划 — RH0 Bug Fix and Prep

> 服务业务簇: `real-to-hero / RH0`
> 计划对象: `把 real-to-hero 启动闸门冻结成可验证的构建/测试/配置/拆分预备基线`
> 类型: `modify + refactor + migration`
> 作者: `Owner + Opus 4.7`
> 时间: `2026-04-29`
> 文件位置:
> - `pnpm-lock.yaml`
> - `packages/jwt-shared/**`
> - `workers/{orchestrator-core,orchestrator-auth,agent-core,bash-core,context-core,filesystem-core}/wrangler.jsonc`
> - `workers/orchestrator-core/test/**`
> - `workers/orchestrator-auth/test/bootstrap-hardening.test.ts`
> - `workers/agent-core/src/host/do/**`
> - `docs/owner-decisions/real-to-hero-tooling.md`
> - `docs/issue/zero-to-real/post-fix-verification.md`
>
> 📝 **行号引用提示**：本文档所有 `file:line` 引用均基于 2026-04-29 main 分支代码快照。RH0 拆分本身会使后续 phase 引用的行号漂移；实施时以函数 / 方法名为锚定，行号仅作辅助。
>
> 📝 **业主已签字 QNA**：业主已同意 `docs/design/real-to-hero/RHX-qna.md` Q1-Q5 的 Opus 路线（含所有限定）。本 action-plan 中"冻结决策"段落均以此为前提，无须再回 owner 二次确认。
> 上游前序 / closure:
> - `docs/issue/zero-to-real/zero-to-real-final-closure.md`（ZX5 闭环 → real-to-hero 启动）
> - `docs/charter/plan-real-to-hero.md` r2 §7.1 + §8.3 Per-Phase Entry Gate
> 下游交接:
> - `docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md`（依赖 RH0 endpoint baseline + megafile prep + tooling readiness）
> 关联设计 / 调研文档:
> - `docs/design/real-to-hero/RH0-bug-fix-and-prep.md`
> - `docs/eval/real-to-hero/closing-thoughts-by-opus.md` §0 / §1
> - `docs/eval/real-to-hero/design-docs-reviewed-by-{GPT,deepseek,GLM,kimi}.md`
> 冻结决策来源:
> - `docs/design/real-to-hero/RHX-qna.md` Q5（业主同意 Opus 8 步 checklist + 失败处置政策）
> 文档状态: `draft`

---

## 0. 执行背景与目标

real-to-hero 的成败以 RH0 是否真的把"开始前必须真的成立"的事冻结为前提：jwt-shared 在 lockfile 里恢复成可重现 importer、6 个 worker 的 KV/R2 binding 首次声明、ZX5 已 ship 但未直达测试的 6 个 endpoint 补齐、NanoSessionDO 切出 verify/persistence 的预拆分边界、preview deploy + bootstrap stress + owner-action checklist 都从口头约定升级成可审计文档。RH0 不是 feature 启动而是**Start Gate 收口**；只有 RH0 PASS，RH1-RH6 才能在已冻结前提上施工。

- **服务业务簇**：`real-to-hero / RH0 Start Gate`
- **计划对象**：`real-to-hero 阶段启动前提冻结`
- **本次计划解决的问题**：
  - jwt-shared 在 `pnpm-lock.yaml` 中**完全缺失** + 存在 ≥2 条已删除包的 stale importer，fresh checkout 下 install 不可确定
  - 6 worker 的 `wrangler.jsonc` 中 KV namespace 与 R2 bucket binding **完全缺失**（不是"未启用"）
  - ZX5 的 `messages/files/me-conversations/me-devices/me-devices-revoke` 等 endpoint 0 直达测试覆盖
  - NanoSessionDO 仍是 2078 行单文件，RH1-RH5 还会继续往里堆逻辑
  - owner tooling readiness 仍停在记忆/口头约定
- **本次计划的直接产出**：
  - `pnpm-lock.yaml` 重建：含 jwt-shared importer + 删除 stale importer
  - 6 worker `wrangler.jsonc` 中首次声明 KV/R2 binding 占位（dev + production env）
  - `workers/orchestrator-core/test/{messages,files,me-conversations,me-devices,me-devices-revoke}.endpoint.test.ts` 5 份新增直达测试
  - `workers/agent-core/src/host/do/session-do-verify.ts` + `session-do-persistence.ts` 预拆分 seam
  - `docs/owner-decisions/real-to-hero-tooling.md` 记录 8 步 P0-F checklist 实际执行结果
  - `docs/issue/zero-to-real/post-fix-verification.md` preview deploy + manual smoke 证据
  - `workers/orchestrator-core/test/bootstrap-hardening.test.ts` 三个 stress case
- **本计划不重新讨论的设计结论**：
  - 不新增 worker、不引入 SQLite-DO（来源：`charter §3 D2`）
  - 不在 RH0 抢跑 RH1+ 任何 feature（来源：`design RH0 §5.2 [O1]/[O2]`）
  - RH0 只做 verify/persistence 预拆分，不做完整拆分（来源：`design RH0 §5.2 [O3]`，留给 RH6）
  - P0-F = 8 步 checklist + 失败处置政策（来源：`RHX-qna Q5`，业主已确认 Opus 扩展）

---

## 1. 执行综述

### 1.1 总体执行方式

RH0 采用**先凭据 → 后构建 → 再测试 → 后预拆分 → 末验证**的串行策略：业主必须先把 P0-F 8 步 checklist 跑通，把失败步骤显式回填或 owner-override；implementer 才能在已知凭据/资源/lockfile 健康的前提下做 P0-A/B/C/D；所有改动落地后再做 P0-E preview smoke 和 P0-G stress harness。这避免 RH0 的工作在 lockfile 漂移、binding 缺失或凭据过期时被卡住。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Owner Tooling Readiness (P0-F) | XS | owner 执行 8 步 checklist 并归档 | `-` |
| Phase 2 | Lockfile Rebuild + Shared Build Freeze (P0-A) | S | jwt-shared 在 lockfile 中重建、stale importer 清理、独立 build/typecheck/test 全绿 | Phase 1 |
| Phase 3 | KV/R2 Binding First-Declaration (P0-C) | S | 6 worker `wrangler.jsonc` 中首次声明 KV/R2 binding 占位 | Phase 2 |
| Phase 4 | Endpoint Test Baseline (P0-B) | M | 5 份 endpoint-level 直达测试新增 | Phase 2 |
| Phase 5 | Megafile Pre-Split (P0-D) | M | NanoSessionDO 切出 verify/persistence seam | Phase 2 |
| Phase 6 | Bootstrap Hardening (P0-G) | S | 3 个 stress case test | Phase 4 |
| Phase 7 | Post-Fix Preview Verification (P0-E) | S | preview deploy + manual smoke + 文档归档 | Phase 3-6 全完成 |

### 1.3 Phase 说明

1. **Phase 1 — Owner Tooling Readiness**
   - **核心目标**：业主单日跑通 8 步 checklist，发现凭据/资源/quota 缺口立即处置
   - **为什么先做**：所有后续 Phase 的 deploy/build/install 路径都依赖 owner 凭据；不先验证就开工等于把失败延后到中段才暴露
2. **Phase 2 — Lockfile Rebuild**
   - **核心目标**：让 fresh checkout 下 `pnpm install --frozen-lockfile` 确定可解析；jwt-shared 独立 `build/typecheck/test` 全绿
   - **为什么放在这里**：lockfile 是所有后续 worker `wrangler deploy` 与测试的下层依赖
3. **Phase 3 — KV/R2 Binding First-Declaration**
   - **核心目标**：6 worker `wrangler.jsonc` 首次声明 binding，`wrangler deploy --dry-run` 跨 6 worker 全通
   - **为什么放在这里**：RH4/RH5 要求 binding 在 env 中可见；RH0 只占位、不消费
4. **Phase 4 — Endpoint Test Baseline**
   - **核心目标**：把"endpoint-level 直达测试 ≥ 5 用例"从口头纪律落成 5 份测试文件
   - **为什么放在这里**：RH1-RH5 任何 endpoint 修改都将以这层做回归基线
5. **Phase 5 — Megafile Pre-Split**
   - **核心目标**：从 `nano-session-do.ts` 抽出 `session-do-verify.ts` + `session-do-persistence.ts`
   - **为什么放在这里**：RH1-RH5 还要在这两个区域改代码；先切口能避免每个 phase 各自往主文件继续堆
6. **Phase 6 — Bootstrap Hardening**
   - **核心目标**：cold-start 100 并发 register / D1 慢响应 5s / refresh 旋转风暴 3 个 stress case
   - **为什么放在这里**：依赖 Phase 4 endpoint baseline 才能 stress
7. **Phase 7 — Preview Verification**
   - **核心目标**：把 P0-A→P0-G 真正部署到 preview，做 manual smoke
   - **为什么最后**：必须等 lockfile / binding / 测试 / 拆分 / stress 全做完才能 deploy

### 1.4 执行策略说明

- **执行顺序原则**：先凭据后代码、先底层后上层、先冻基线后验证
- **风险控制原则**：每个 Phase 都能独立回滚（lockfile 与 wrangler.jsonc 分别在不同 PR）；P0-F 失败必须按 RHX-qna Q5 三选一处置
- **测试推进原则**：endpoint baseline 在 P0-B 落地，后续 Phase 都站在这层之上做回归
- **文档同步原则**：P0-F 结果立即写 `docs/owner-decisions/real-to-hero-tooling.md`；P0-E 写 `docs/issue/zero-to-real/post-fix-verification.md`
- **回滚 / 降级原则**：任何 Phase 失败必须在 PR 级别 revert，不允许在 main 上"先开工再补"

### 1.5 本次 action-plan 影响结构图

```text
RH0 Start Gate
├── Phase 1: Owner Tooling Readiness
│   └── docs/owner-decisions/real-to-hero-tooling.md
├── Phase 2: Lockfile Rebuild
│   ├── pnpm-lock.yaml
│   └── packages/jwt-shared/**
├── Phase 3: KV/R2 Binding
│   └── workers/{6 workers}/wrangler.jsonc
├── Phase 4: Endpoint Test Baseline
│   └── workers/orchestrator-core/test/{messages,files,me-conversations,me-devices,permission-decision,elicitation-answer,policy-permission-mode}-route.test.ts (≥7 文件 ≥35 case，per charter §7.1)
├── Phase 5: Megafile Pre-Split
│   └── workers/agent-core/src/host/do/{nano-session-do,session-do-verify,session-do-persistence}.ts
├── Phase 6: Bootstrap Hardening
│   └── workers/orchestrator-auth/test/bootstrap-hardening.test.ts (charter §7.1 锁定在 orchestrator-auth)
└── Phase 7: Preview Verification
    └── docs/issue/zero-to-real/post-fix-verification.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope

- **[S1]** `pnpm-lock.yaml` 完整重建 + jwt-shared importer + stale importer 删除
- **[S2]** `packages/jwt-shared` 独立 `build/typecheck/test` 全绿
- **[S3]** 6 worker `wrangler.jsonc` KV namespace + R2 bucket binding 占位声明（dev + production）
- **[S4]** **≥7 份** endpoint-level 直达测试新增（charter §7.1 命名 `{name}-route.test.ts`）：`messages-route` / `files-route` / `me-conversations-route` / `me-devices-route` / `permission-decision-route` / `elicitation-answer-route` / `policy-permission-mode-route`，每文件 ≥5 case，共 ≥35 case
- **[S5]** NanoSessionDO 拆出 `session-do-verify.ts` + `session-do-persistence.ts`
- **[S6]** `bootstrap-hardening.test.ts` 三个 stress case
- **[S7]** Preview deploy + manual smoke + `post-fix-verification.md` 归档
- **[S8]** P0-F 8 步 checklist 执行 + `real-to-hero-tooling.md` 归档

### 2.2 Out-of-Scope

- **[O1]** Lane F runtime 接线（RH1）
- **[O2]** `/models` / `/context` / device gate / multimodal / 模型扩展（RH2-RH5）
- **[O3]** NanoSessionDO 完整拆分（RH6）
- **[O4]** user-do.ts 拆分（RH6）
- **[O5]** three-layer-truth 文档冻结（RH6）

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| RH0 顺手做 hook dispatcher wiring | out-of-scope | 会污染 Start Gate 定义 | 无（RH1）|
| RH0 给 ZX5 endpoint 加新 case | in-scope（仅最小直达测试） | 直达测试纪律是 phase-cross 共享前提 | 无 |
| RH0 一次性切完 NanoSessionDO 全部 7 份 | out-of-scope | 不在 RH0 scope，留给 RH6 | RH6 |
| `wrangler.jsonc` 真把 binding 接到业务代码 | out-of-scope | RH0 仅占位 | RH4 |
| `bootstrap-hardening.test.ts` 写到 ≥3 case | in-scope | charter §7.1 P0-G 硬要求 | 无 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P0-F1 | Phase 1 | 业主跑 8 步 tooling checklist | manual | `docs/owner-decisions/real-to-hero-tooling.md` | 8 步 pass 或 owner-override | medium |
| P0-A1 | Phase 2 | 删除 stale importer + 重建 lockfile | update | `pnpm-lock.yaml` | fresh `pnpm install --frozen-lockfile` + 4 步联检（grep+install+jwt-shared test+下游 worker test）通过 | medium |
| P0-A2 | Phase 2 | jwt-shared 独立 build/typecheck/test | update | `packages/jwt-shared/**` | `pnpm --filter @haimang/jwt-shared {build,typecheck,test}` 全绿；预装 root `madge` devDep + `check:cycles` script（baseline 0 cycle 留给 RH6 enforce） | low |
| P0-C1 | Phase 3 | 6 worker wrangler.jsonc 首次声明 KV/R2 | add | `workers/*/wrangler.jsonc` | `wrangler deploy --dry-run` 跨 6 worker 通过 | medium |
| P0-B0 | Phase 4 | mock env 兼容性审查（needsBody / route-param 解析）| audit | `workers/orchestrator-core/test/{auth,jwt-helper,parity-bridge,smoke}.test.ts` 现状 | mock baseline 可承载 7 份新 endpoint test，否则补 fixture | medium |
| P0-B1 | Phase 4 | messages-route test | add | `workers/orchestrator-core/test/messages-route.test.ts` | ≥5 用例覆盖 | medium |
| P0-B2 | Phase 4 | files-route test | add | `workers/orchestrator-core/test/files-route.test.ts` | ≥5 用例 | medium |
| P0-B3 | Phase 4 | me-conversations-route test | add | `workers/orchestrator-core/test/me-conversations-route.test.ts` | ≥5 用例 | medium |
| P0-B4 | Phase 4 | me-devices-route test | add | `workers/orchestrator-core/test/me-devices-route.test.ts` | ≥5 用例 | medium |
| P0-B5 | Phase 4 | permission-decision-route test | add | `workers/orchestrator-core/test/permission-decision-route.test.ts` | ≥5 用例 | medium |
| P0-B6 | Phase 4 | elicitation-answer-route test | add | `workers/orchestrator-core/test/elicitation-answer-route.test.ts` | ≥5 用例 | medium |
| P0-B7 | Phase 4 | policy-permission-mode-route test | add | `workers/orchestrator-core/test/policy-permission-mode-route.test.ts` | ≥5 用例 | medium |
| P0-D1 | Phase 5 | 抽出 session-do-verify.ts | refactor | `workers/agent-core/src/host/do/{nano-session-do,session-do-verify}.ts` | preview verification 方法迁出主文件 | medium |
| P0-D2 | Phase 5 | 抽出 session-do-persistence.ts | refactor | `workers/agent-core/src/host/do/{nano-session-do,session-do-persistence}.ts` | persistence helpers 迁出；主文件 ≤1500 行（charter §7.1 hard gate）| medium |
| P0-G1 | Phase 6 | bootstrap-hardening.test.ts 3 case | add | `workers/orchestrator-auth/test/bootstrap-hardening.test.ts` (charter §7.1 锁定路径) | cold-start/D1 slow/refresh storm 三 case 通过 | medium |
| P0-E1 | Phase 7 | preview deploy 跨 6 worker | manual | `wrangler deploy --env preview` | 6 worker 部署成功 | medium |
| P0-E2 | Phase 7 | manual smoke + 归档 | manual | `docs/issue/zero-to-real/post-fix-verification.md` | 5-10 个 smoke step 全通过且写文档 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Owner Tooling Readiness

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P0-F1 | 8 步 checklist | 业主依次执行：(1) `wrangler whoami`；(2) `gh auth status`；(3) `NODE_AUTH_TOKEN=*** pnpm --filter @haimang/jwt-shared build`；(4) `wrangler r2 bucket list`；(5) `wrangler kv namespace list`；(6) `wrangler ai models --json | wc -l`；(7) `pnpm install --frozen-lockfile`；(8) 跨 6 worker `wrangler deploy --dry-run` | `docs/owner-decisions/real-to-hero-tooling.md` | 每步记 timestamp + output hash + verdict（pass/fail/owner-override） | manual checklist | 8 步全部 pass 或失败步骤已按 RHX-qna Q5 三选一处置（修复/升级 in-scope/owner-override 签字） |

### 4.2 Phase 2 — Lockfile Rebuild

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P0-A1 | lockfile 重建 | 删除 ≥2 个已删除包 (`agent-runtime-kernel`, `capability-runtime` 等) 的 stale importer；执行 `rm pnpm-lock.yaml && pnpm install` 重新生成 | `pnpm-lock.yaml` | jwt-shared importer 出现；6 worker importer 完整；fresh checkout 可 frozen-lockfile install | `pnpm install --frozen-lockfile` 在 fresh container 中通过 | lockfile 中 `grep -c "jwt-shared"` ≥ 2；`grep -c "agent-runtime-kernel\|capability-runtime"` = 0 |
| P0-A2 | jwt-shared 独立验证 | 确保 `packages/jwt-shared/package.json` 的 build/typecheck/test 脚本在带 `NODE_AUTH_TOKEN` 时全绿 | `packages/jwt-shared/**` | 三个脚本独立可执行 | `pnpm --filter @haimang/jwt-shared build typecheck test` | 三命令均 0 退出码；test 输出 ≥ 20 用例（参考既有 `test/jwt-shared.test.ts`）|

### 4.3 Phase 3 — KV/R2 Binding First-Declaration

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P0-C1 | 6 worker binding 占位 | 在 6 worker 的 `wrangler.jsonc` 中分别新增 `kv_namespaces` 与 `r2_buckets` 数组（dev + production env），placeholder id 由 P0-F1 中 `wrangler kv namespace list` / `wrangler r2 bucket list` 提供 | `workers/{orchestrator-core,orchestrator-auth,agent-core,bash-core,context-core,filesystem-core}/wrangler.jsonc` | 每个 worker 至少声明 `NANO_KV` 与 `NANO_R2` 两个 binding（具体名由 design 在 RH4 决定，RH0 仅放占位） | 6 个 `wrangler deploy --dry-run` 通过 | 6 worker dry-run 输出含 KV/R2 binding；`wrangler dev --local` 可启动且 binding 在 env 可见 |

### 4.4 Phase 4 — Endpoint Test Baseline (≥7 文件 / ≥35 case)

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P0-B0 | mock env 审查 | 在批量新增前先 audit 现有 `auth.test.ts` / `jwt-helper.ts` / `parity-bridge.test.ts` / `smoke.test.ts` 是否能承载 `needsBody` + route 参数解析；如缺，先补 fixture | 同上 | 7 份新增可在该 fixture 上跑通 | manual audit | audit doc 写入 PR description |
| P0-B1 | messages-route test | 覆盖：(1) 200 happy；(2) 401 missing JWT；(3) 403 wrong device；(4) 400 invalid kind；(5) 404 unknown session | `workers/orchestrator-core/test/messages-route.test.ts` | 5 case 全绿 | `pnpm --filter orchestrator-core test` | 5 case pass + 复用 `jwt-helper.ts` |
| P0-B2 | files-route test | 覆盖：(1) GET 列出空；(2) GET 列出 ≥1；(3) 401；(4) 跨 team 403；(5) 404 | `workers/orchestrator-core/test/files-route.test.ts` | 同上 | 同上 | 同上 |
| P0-B3 | me-conversations-route test | 覆盖：(1) 200 第一页；(2) cursor 翻页；(3) 末页 next_cursor=null；(4) 401；(5) 跨 user 不可见 | `workers/orchestrator-core/test/me-conversations-route.test.ts` | 同上 | 同上 | 同上 |
| P0-B4 | me-devices-route test | 覆盖：(1) 200 列出当前 device；(2) 多 device；(3) 401；(4) 已 revoke 的不出现；(5) 跨 user 不可见 | `workers/orchestrator-core/test/me-devices-route.test.ts` | 同上 | 同上 | 同上 |
| P0-B5 | permission-decision-route test | 覆盖：(1) 200 allow；(2) 200 deny；(3) 401；(4) 400 unknown request_uuid；(5) 404 已答 / 已超时 | `workers/orchestrator-core/test/permission-decision-route.test.ts` | 同上 | 同上 | 同上（runtime live 留给 RH1）|
| P0-B6 | elicitation-answer-route test | 覆盖：(1) 200 answer；(2) 401；(3) 400 invalid；(4) 404 unknown；(5) 重复答 409 / 200 idempotent | `workers/orchestrator-core/test/elicitation-answer-route.test.ts` | 同上 | 同上 | 同上 |
| P0-B7 | policy-permission-mode-route test | 覆盖：(1) 200 set；(2) 200 read；(3) 401；(4) 400 invalid mode；(5) 跨 session 不可见 | `workers/orchestrator-core/test/policy-permission-mode-route.test.ts` | 同上 | 同上 | 同上 |

### 4.5 Phase 5 — Megafile Pre-Split

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P0-D1 | 抽出 session-do-verify.ts | 把 nano-session-do 中 preview verification subsystem 的 verify 方法（实际范围以函数 `verifyXxx*` 名定位，截至 2026-04-29 约 ~355 行）迁到独立文件，主文件改为薄 façade 调用 | `workers/agent-core/src/host/do/{nano-session-do,session-do-verify}.ts` | 主文件减少 ~355 行；`session-do-verify.ts` 新文件 | 既有测试矩阵全绿 | `session-do-verify.ts` 出现；agent-core test 全绿 |
| P0-D2 | 抽出 session-do-persistence.ts | 把 storage put/get/sweep 等 persistence helpers 迁出 | `workers/agent-core/src/host/do/{nano-session-do,session-do-persistence}.ts` | 主文件 ≤ **1500 行**（charter §7.1 hard gate；不许放宽到 1600）| 既有测试矩阵全绿 + `pnpm check:cycles` 0 cycle | `wc -l nano-session-do.ts` ≤ 1500；no import cycle |

### 4.6 Phase 6 — Bootstrap Hardening (orchestrator-auth)

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P0-G1 | 3 stress case | 写 `bootstrap-hardening.test.ts`：(1) cold-start 并发 100 register（验证 pending/expired status 正确）；(2) D1 慢响应 5s（验证 timeout/retry path）；(3) refresh chain 旋转风暴（验证 token rotation 不出现死锁）| `workers/orchestrator-auth/test/bootstrap-hardening.test.ts`（charter §7.1 锁定路径；register/login/refresh 是 orchestrator-auth 核心职责）| 3 case 在 miniflare 内通过 | `pnpm --filter orchestrator-auth test bootstrap-hardening` | 3 case pass + 单 case 运行时 ≤ 30s |

### 4.7 Phase 7 — Post-Fix Preview Verification

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P0-E1 | preview deploy | 6 worker 顺序 `wrangler deploy --env preview` | 6 worker | 6 个 deploy 成功 | manual + Cloudflare dashboard | 6 个 deploy 200 OK，preview URL 可访问 |
| P0-E2 | manual smoke + 归档 | 跑 5-10 个手动 smoke：register → start session → message text → list me/sessions → revoke device → re-register | `docs/issue/zero-to-real/post-fix-verification.md` | smoke step 全通过；浏览器截屏 + curl log 入文档 | manual | 文档 ≥ 1 KB，含 timestamp、preview URL、每 step 截图/curl 输出 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Owner Tooling Readiness

- **Phase 目标**：让 RH0 的所有后续 Phase 在已知凭据/资源/quota 健康前提下推进
- **本 Phase 对应编号**：P0-F1
- **本 Phase 新增文件**：`docs/owner-decisions/real-to-hero-tooling.md`
- **本 Phase 修改文件**：无
- **具体功能预期**：
  1. 业主单日完成 8 步 checklist
  2. 任何失败步骤按 RHX-qna Q5 政策（修复/升级 in-scope/owner-override）24h 内决议
- **具体测试安排**：
  - **手动验证**：8 个命令的输出截图 + verdict
- **收口标准**：
  - `real-to-hero-tooling.md` ≥ 8 行 verdict（每步 pass/fail/owner-override）
  - 任何 fail 步骤都有显式处置记录
- **本 Phase 风险提醒**：业主 R2 quota 或 GitHub PAT 过期会导致部分步骤失败 — 必须在文档中显式标注并按政策处置

### 5.2 Phase 2 — Lockfile Rebuild

- **Phase 目标**：fresh checkout 下 `pnpm install --frozen-lockfile` 确定可解析 + jwt-shared 独立可构建
- **本 Phase 对应编号**：P0-A1, P0-A2
- **本 Phase 新增文件**：无
- **本 Phase 修改文件**：`pnpm-lock.yaml`
- **本 Phase 删除文件**：`pnpm-lock.yaml` 内 ≥ 2 条 stale importer entry
- **具体功能预期**：
  1. lockfile 重建后包含 `packages/jwt-shared` importer 与依赖树
  2. 删除已物理消失的包 importer
- **具体测试安排**：
  - **回归测试**：root `pnpm install --frozen-lockfile` 在 fresh container 中通过；既有 6 worker test 全绿
  - **单测**：`pnpm --filter @haimang/jwt-shared test` ≥ 20 case
- **收口标准**：
  - `grep -c "jwt-shared" pnpm-lock.yaml` ≥ 2
  - `grep -c "agent-runtime-kernel\|capability-runtime" pnpm-lock.yaml` = 0
  - `pnpm --filter @haimang/jwt-shared {build,typecheck,test}` 三命令全 0 退出
- **本 Phase 风险提醒**：lockfile 重建可能让既有 dev 依赖 minor version 漂移；通过 PR diff 显式 review，避免悄悄升级 production deps

### 5.3 Phase 3 — KV/R2 Binding First-Declaration

- **Phase 目标**：6 worker `wrangler.jsonc` 首次声明 KV/R2 binding，dry-run 通过
- **本 Phase 对应编号**：P0-C1
- **本 Phase 新增文件**：无
- **本 Phase 修改文件**：6 份 `wrangler.jsonc`
- **具体功能预期**：
  1. 每个 worker 至少声明 `NANO_KV`（占位 namespace id 由 P0-F1 输出）+ `NANO_R2`（占位 bucket name）
  2. dev + production env 都声明
- **具体测试安排**：
  - **集成测试**：跨 6 worker `wrangler deploy --dry-run` 全通过
  - **手动验证**：`wrangler dev --local` 启动后 `env.NANO_KV` / `env.NANO_R2` 都可见
- **收口标准**：
  - 6 dry-run 全 0 退出
  - 6 worker `wrangler dev` 启动可看见 binding（不消费）
- **本 Phase 风险提醒**：业主 Cloudflare account 没有 R2 quota 时 binding 占位仍可声明（dry-run 不强制 quota），但实际 deploy 时会失败；R2 quota 缺口在 P0-F1 已被识别

### 5.4 Phase 4 — Endpoint Test Baseline

- **Phase 目标**：把"endpoint-level ≥5 case"纪律落成 5 份测试
- **本 Phase 对应编号**：P0-B0 至 P0-B7
- **本 Phase 新增文件**：7 份 `*-route.test.ts`（charter §7.1 命名）+ P0-B0 mock env audit doc
- **具体功能预期**：
  1. 每份测试 ≥ 5 用例（happy + 401 + 403 + 400/422 + 404 各 1）
  2. 复用现有 `jwt-helper.ts` fixture，避免每个测试自造 helper
  3. 共 ≥7 文件 ≥35 case（charter §7.1 hard gate）
- **具体测试安排**：
  - **单测**：`pnpm --filter orchestrator-core test` 7 个新文件都通过
  - **回归测试**：现有 6 个 test 文件不破坏；P0-B0 audit 揭示的 mock 缺口先补 fixture 再批量新增
- **收口标准**：
  - 7 份新测试合计 ≥ 35 case 全绿
  - test 不依赖跨 worker 的 service binding（mock 或 miniflare local）
- **本 Phase 风险提醒**：未实装的 endpoint（如 device-revoke 还没真 gate）只能测 D1 写 + 200 status，真正 gate 留给 RH3 — 测试要明确 TODO 注释，不能掩盖未实装事实

### 5.5 Phase 5 — Megafile Pre-Split

- **Phase 目标**：从 NanoSessionDO 抽出 verify 与 persistence 两个职责
- **本 Phase 对应编号**：P0-D1, P0-D2
- **本 Phase 新增文件**：`session-do-verify.ts`、`session-do-persistence.ts`
- **本 Phase 修改文件**：`nano-session-do.ts`
- **具体功能预期**：
  1. 主文件减少 ≥ 580 行（2078 → ≤1500）
  2. 两个新文件无 import cycle，主文件以薄 façade 调用
- **具体测试安排**：
  - **回归测试**：agent-core 全部既有测试通过
  - **静态校验**：`tsc --noEmit` + `pnpm check:cycles`（madge --circular）0 cycle
- **收口标准**：
  - `wc -l nano-session-do.ts` ≤ **1500**（charter §7.1）
  - `pnpm check:cycles` 0 cycle
- **本 Phase 风险提醒**：拆分时容易把 private state 误暴露；要严格保持 `private` 修饰符；helper 通过 `this.parent.<method>()` 风格回调，避免双向依赖

### 5.6 Phase 6 — Bootstrap Hardening (orchestrator-auth)

- **Phase 目标**：3 stress case 揭露隐性瓶颈；测试落点严格按 charter §7.1 在 **orchestrator-auth**（register/login/refresh 是 auth worker 核心职责，不能简化为 façade smoke）
- **本 Phase 对应编号**：P0-G1
- **本 Phase 新增文件**：`workers/orchestrator-auth/test/bootstrap-hardening.test.ts`
- **具体测试安排**：
  - **集成测试**：3 case 在 miniflare 内运行
- **收口标准**：3 case 全 pass，单 case ≤ 30s
- **本 Phase 风险提醒**：miniflare 与 production runtime 在并发模型上不完全一致；stress test 主要发现 application-level 死锁与 race，而非 platform-level 瓶颈

### 5.7 Phase 7 — Preview Verification

- **Phase 目标**：把 RH0 真正部署到 preview 验证
- **本 Phase 对应编号**：P0-E1, P0-E2
- **本 Phase 新增文件**：`docs/issue/zero-to-real/post-fix-verification.md`
- **具体测试安排**：
  - **手动验证**：5-10 step smoke
- **收口标准**：6 worker preview 部署成功 + 文档归档完成
- **本 Phase 风险提醒**：preview 与 production 凭据可能不同；deploy 失败需立即回 P0-F1 复核凭据

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| RHX Q5（业主同意 Opus 8 步 + 失败处置政策）| `RHX-qna.md` Q5 | Phase 1 直接执行 | 业主推翻则回 design 重新讨论 P0-F |
| 不新增 worker、不引入 SQLite-DO | `charter §3 D2` | 拆分仅在 6 worker 内 | 推翻则整个 RH 阶段重写 |
| 三层真相纪律（DO memory / DO storage / D1）| `charter §4.4` | RH0 不破坏既有真相分布 | RH6 才能修订 |
| 不在 RH0 抢跑 RH1+ feature | `design RH0 §5.2` | Phase 5 仅做 verify/persistence 切口 | 无 |
| Q1（team_slug）/ Q2（dual-track）/ Q3（quota）/ Q4（evidence）| `RHX-qna.md` | 不影响 RH0 | 无 |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| R2/KV quota 不足 | owner Cloudflare account 没开 R2 / KV quota | medium | P0-F1 提早暴露；按 Q5 政策 24h 内升级 quota 或 owner-override |
| GitHub PAT 过期 | NODE_AUTH_TOKEN 过期 | low | P0-F1 第 3 步会发现 |
| lockfile 重建漂移 | dev 依赖 minor version 自动升级 | medium | PR diff review；锁定 production deps |
| 拆分引入 import cycle | session-do-verify ↔ persistence 互相依赖 | medium | `madge --circular` gate |
| miniflare 行为差异 | stress test 与 prod 不完全一致 | low | 先 miniflare，preview deploy 后再补一轮真 stress |

### 7.2 约束与前提

- **技术前提**：pnpm 9+；wrangler 4+；node 20+
- **运行时前提**：Cloudflare account 已开 D1 + KV + R2 + Workers AI
- **组织协作前提**：业主单人能在 1 工作日内执行 P0-F1
- **上线 / 合并前提**：每个 Phase 单 PR，Phase 间不交叉

### 7.3 文档同步要求

- 需要同步更新的设计文档：无（RH0 设计文件已含修订记录）
- 需要同步更新的说明文档 / README：根 README 增加"running tests" section（指向 P0-B 5 份新测试）
- 需要同步更新的测试说明：`workers/orchestrator-core/test/README.md`（如不存在则新建）

### 7.4 完成后的预期状态

1. fresh checkout 下 `pnpm install --frozen-lockfile` 在任何 CI runner 上确定通过
2. 6 worker `wrangler deploy --dry-run` 全部通过且 KV/R2 binding 在 env 中可见
3. ZX5 7 个 product endpoint 都有 ≥ 5 case 直达测试（≥35 case，含 permission-decision/elicitation-answer/policy-permission-mode）
4. NanoSessionDO 主文件 ≤ **1500 行**（charter §7.1 hard gate）+ 2 个新 seam 文件无 cycle
5. preview deploy + manual smoke 证据归档；业主 P0-F checklist 归档；RH1 可以启动

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `pnpm install --frozen-lockfile` 在 fresh container 通过
  - 6 worker `wrangler deploy --dry-run` 全通
  - `pnpm check:cycles` 0 cycle baseline
- **单元测试**：
  - `pnpm --filter @haimang/jwt-shared test` ≥ 20 case
  - `pnpm --filter orchestrator-core test` 含 7 个新 `*-route.test.ts` 全绿
  - `pnpm --filter orchestrator-auth test bootstrap-hardening` 3 case 全绿
- **集成测试**：
  - root `pnpm test` 全套测试矩阵不回归
- **端到端 / 手动验证**：
  - preview deploy 后 5-10 step manual smoke
- **回归测试**：
  - agent-core 既有测试矩阵全绿（拆分不破坏行为）
- **文档校验**：
  - `real-to-hero-tooling.md` 与 `post-fix-verification.md` 各 ≥ 1KB

### 8.2 Action-Plan 整体收口标准

1. 业主 P0-F checklist 归档完成（pass 或 owner-override 三选一）
2. lockfile rebuild 完成且 jwt-shared 独立 build/typecheck/test 全绿
3. 6 worker KV/R2 binding 首次声明 + dry-run 全通
4. **7 份** endpoint-level 测试 ≥ **35 case** 全绿（charter §7.1 hard gate）
5. NanoSessionDO 拆出 2 个 seam 文件 + 主文件 ≤ **1500 行** + 0 cycle
6. bootstrap-hardening 3 case 全绿（在 **orchestrator-auth/test**）
7. preview deploy + smoke 文档归档
8. **RH1 Per-Phase Entry Gate（charter §8.3）满足**：design + action-plan + RH0 closure 三件齐全

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | 8 个交付物全部归档 |
| 测试 | endpoint baseline ≥35 case (7 文件) + jwt-shared ≥20 case + bootstrap 3 case (在 orchestrator-auth) 全绿；既有矩阵不回归 |
| 文档 | `real-to-hero-tooling.md` + `post-fix-verification.md` + 设计文档 §9 修订记录已写 |
| 风险收敛 | P0-F 暴露的所有凭据/资源问题均已处置或 owner-override |
| 可交付性 | RH1 action-plan 可直接基于 RH0 closure 启动 |
