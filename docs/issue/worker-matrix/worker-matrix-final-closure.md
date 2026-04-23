# Worker-Matrix — Final Closure Memo

> 阶段: `worker-matrix(Phase 0-5 合拢)`
> 闭合日期: `2026-04-23`
> 作者: `Claude Opus 4.7 (1M context)`
> 关联 charter: `docs/plan-worker-matrix.md` §6 Phase DoD + §9 Exit Criteria
> 文档状态: `closed(worker-matrix 阶段全部 6 条 primary exit criteria 已满足)`

---

## 0. 背景与定位

worker-matrix 阶段以 `docs/plan-worker-matrix.md` r2 + `docs/design/worker-matrix/D01-D09` + 7 条 owner 决策 Q1-Q7 confirmed 为执行输入,在 2026-04-23 单日(单 session 链)内合拢,目标是:**把 Tier B substrate 吸进 4 个 worker 壳,装出 live agent turn loop,激活 first-wave 真实需要的 cross-worker service binding,并把 `workspace:*` interim 切换到 published path**。

本阶段不扩 scope — skill.core 保持 reserved;W1 RFC 保持 direction-only;Tier B packages 保持物理存在;NACP wire vocabulary / tenant wrapper / session message matrix 全程零私修。

本 memo 是 worker-matrix 的 **single final truth anchor**,将 charter §9 的 6 条 primary exit criteria 每一条映射到具体 phase 的真实证据 + 代码锚点 + live probe。

---

## 1. 6 条 primary exit criteria 全绿映射

### criterion 1 — live agent turn loop 端到端运行

- **状态**:✅ 已满足
- **证据**:
  - P2 action-plan §4.6 / §5.6 两条 root e2e 实装并持续绿:
    - `test-legacy/tool-call-live-loop.test.mjs`(5 subtests:binding 激活 / composition 路由 / NanoSessionDO 选 remote factory / transport seam 穿透 mock binding / R2 wire truth guard)
    - `test-legacy/initial-context-live-consumer.test.mjs`(4 subtests:consumer 不 throw / assembledKinds 含 canonical session kind / negative case / positive vs negative diff)
  - agent-core preview live URL `https://nano-agent-agent-core-preview.haimang.workers.dev/` 返回 `live_loop: true` + `capability_binding: true`
  - `/sessions/probe-demo/status` 实测 HTTP 200,`{"ok":true,"action":"status","phase":"unattached"}` — SESSION_DO forwarding end-to-end 真实命中 DO fetch
  - bash-core preview live URL `https://nano-agent-bash-core-preview.haimang.workers.dev/` 以 `absorbed_runtime: true` 持续服务 BASH_CORE binding
  - B7 LIVE dedup / overflow disclosure 契约在 `test-legacy/b7-round2-integrated-contract.test.mjs` 继续作为 root guardian 绿

### criterion 2 — 4 workers runtime ownership 已吸收到 `workers/*/src/`

- **状态**:✅ 已满足
- **证据**:
  - **agent.core**(live runtime,非 probe):absorbed A1 host shell + A2 kernel + A3 llm + A4 hooks residual + A5 eval residual(P1.A)到 `workers/agent-core/src/{host,kernel,llm,hooks,eval}/`;1027 tests / 96 files 全绿
  - **bash.core**(live runtime,非 probe):absorbed B1 capability-runtime 全包(P1.B)到 `workers/bash-core/src/`;355 tests / 29 files 全绿;preview URL live + `/capability/call` + `/capability/cancel` 501 honest-partial + `/tool.call.request` 404(R3 binding-first 保持)
  - **context.core**(library-worker posture,Q3c host-local):absorbed C1 + C2 slice + `appendInitialContextLayer` owner 归位(P3)到 `workers/context-core/src/`;170 tests / 19 files 全绿;probe 返 `library_worker: true`(R3 fix 诚实化)
  - **filesystem.core**(library-worker posture,Q4a host-local):absorbed D1 + D2 + mixed helper artifact slice(P4 + P3-P4 review fix)到 `workers/filesystem-core/src/`;293 tests / 25 files 全绿;probe 返 `library_worker: true`
  - `packages/*` 保留物理存在,不再是主要 runtime 归属(9 Tier B 包均已标 DEPRECATED per criterion 4)

### criterion 3 — `@haimang/nacp-*` published path cutover 完成(P5 本 phase 主要工作)

- **状态**:✅ 已满足
- **证据**:
  - 4 个 worker `package.json` 的 `@haimang/nacp-core` / `@haimang/nacp-session` 依赖均为精确 pin `"1.4.0"` / `"1.3.0"`(`grep "workspace:\*" workers/*/package.json | grep -c nacp` == 0)
  - `pnpm-lock.yaml` 中 `workers/{agent,bash,context,filesystem}-core` 的 `@haimang/nacp-core` / `nacp-session` 全部为 `version: 1.4.0(zod@3.25.76)` / `version: 1.3.0(zod@3.25.76)`(非 `link:` — per P1-P5 GPT review R5 口径,tarball / registry version 都是合法 published-path truth)
  - 根目录 `.npmrc` 已落地,按 dogfood `nacp-consume-test/.npmrc` 同模式(`@haimang:registry=https://npm.pkg.github.com` + `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` + `always-auth=true`)
  - `.npmrc` readiness verdict(per R4 诚实化):`NODE_AUTH_TOKEN` 需要 GitHub classic PAT 附带 `read:packages` scope;owner 已 on-ramp(token 由 owner 在 2026-04-23 当日提供),local dev 与 CI 都遵循同一 `${NODE_AUTH_TOKEN}` 占位符模式
  - agent-core preview redeploy 完成:Preview URL 不变 `https://nano-agent-agent-core-preview.haimang.workers.dev`,新 Version ID `1d423bfc-4d54-4fed-b84c-f47586b79728`,upload 从 290.80 KiB 增至 318.73 KiB(published NACP bundle 被 wrangler 实际打包进 deploy artifact)
  - live probe `nacp_core_version: "1.4.0"` + `nacp_session_version: "1.3.0"` 保持,字段值不变(cutover 是源头 workspace link → published registry,字段值是语义 identity)

### criterion 4 — 已吸收 Tier B packages 全部 `DEPRECATED`(P5 本 phase 主要工作)

- **状态**:✅ 已满足
- **证据**:**9 包 README banner + 7 包 CHANGELOG 条目**

| # | Tier B package | README banner | CHANGELOG entry | 吸收目标 |
|---|----------------|----------------|------------------|----------|
| 1 | `packages/session-do-runtime/` | ✅ | ✅ | `workers/agent-core/src/host/`(A1)|
| 2 | `packages/capability-runtime/` | ✅ | R5 README-only(无 CHANGELOG 文件)| `workers/bash-core/src/`(B1)|
| 3 | `packages/agent-runtime-kernel/` | ✅ | R5 README-only | `workers/agent-core/src/kernel/`(A2)|
| 4 | `packages/llm-wrapper/` | ✅ | ✅ | `workers/agent-core/src/llm/`(A3)|
| 5 | `packages/hooks/` | ✅(runtime residual only — wire catalog 不 deprecate)| ✅ | `workers/agent-core/src/hooks/`(A4)|
| 6 | `packages/eval-observability/` | ✅(runtime residual only — B7 LIVE 仍 root guardians)| ✅ | `workers/agent-core/src/eval/`(A5)|
| 7 | `packages/context-management/` | ✅ | ✅ | `workers/context-core/src/{budget,async-compact,inspector-facade}/`(C1)|
| 8 | `packages/workspace-context-artifacts/` | ✅(C2+D1 split 同步)| ✅ | `workers/context-core/src/` + `workers/filesystem-core/src/`(split)|
| 9 | `packages/storage-topology/` | ✅(tenant wrapper 不 deprecate)| ✅ | `workers/filesystem-core/src/storage/`(D2)|

- 物理保留 100%(Q6c 口径:per-worker absorb-stable,不物理删);物理删除归下一阶段
- `@haimang/nacp-core` + `@haimang/nacp-session`(Tier A)**不**打 DEPRECATED — 它们是 canonical wire vocabulary,继续作为 published 协议层
- `@haimang/{agent,bash,context,filesystem}-core-worker`(workers,non-Tier B)**不**打 DEPRECATED — 它们是 canonical absorbed runtime

### criterion 5 — 全仓测试仍全绿

- **状态**:✅ 已满足
- **证据**(2026-04-23 P5 实测):

| target | 结果 |
|--------|------|
| `pnpm -r run typecheck` | 15 projects 全绿 |
| `pnpm -r run test` | 全绿;合计 **15 projects × 具体 tests**(见下)|
| `pnpm --filter @haimang/agent-core-worker test` | **1027 / 96 files** 绿 |
| `pnpm --filter @haimang/bash-core-worker test` | **355 / 29 files** 绿 |
| `pnpm --filter @haimang/context-core-worker test` | **170 / 19 files** 绿 |
| `pnpm --filter @haimang/filesystem-core-worker test` | **293 / 25 files** 绿 |
| `pnpm --filter @nano-agent/workspace-context-artifacts test` | 192 绿 |
| `pnpm --filter @nano-agent/session-do-runtime test` | 367 绿 |
| `pnpm --filter @nano-agent/agent-runtime-kernel test` | 123 绿 |
| `pnpm --filter @nano-agent/llm-wrapper test` | 103 绿 |
| `pnpm --filter @nano-agent/hooks test` | 198 绿 |
| `pnpm --filter @nano-agent/eval-observability test` | 208 绿 |
| `pnpm --filter @nano-agent/capability-runtime test` | 352 绿 |
| `pnpm --filter @nano-agent/context-management test` | 97 绿 |
| `pnpm --filter @nano-agent/storage-topology test` | 169 绿 |
| `pnpm --filter @haimang/nacp-core test` | 259 绿 |
| `pnpm --filter @haimang/nacp-session test` | 119 绿 |
| `node --test test-legacy/*.test.mjs` | **107 / 107** 绿(含 B7 LIVE 5 tests) |
| `npm run test:cross`(`test-legacy/*.test.mjs` + `test-legacy/e2e/*.test.mjs`) | **121 / 121** 绿 |
| `pnpm --filter './workers/*' run deploy:dry-run` | 4 workers 全绿 |

合计全仓 ~4500+ 真实 tests 全绿;B7 LIVE dedup / overflow 契约继续作 root guardian。

**说明(test tree rename)**:PX action-plan(独立于 worker-matrix)把根 `test/` 重命名为 `test-legacy/` 并新建 `test/package-e2e/` + `test/cross-e2e/` 两层树(尚未落盘实装)。这是出根目录 testing 方法论重构,不属 worker-matrix 闭环内容;`test:contracts / test:cross / test:e2e` 等 npm scripts 已同步指向 `test-legacy/`,本 phase 回归使用这批 scripts 全绿。

### criterion 6 — worker-matrix final closure + handoff shipped

- **状态**:✅ 已满足(本 memo + §3 handoff 段)
- **证据**:
  - 本 memo:`docs/issue/worker-matrix/worker-matrix-final-closure.md`
  - Phase 级 closure memos 已全部 ship:
    - `docs/issue/worker-matrix/P0-absorption-prep-closure.md`
    - `docs/issue/worker-matrix/P1-closure.md`
    - `docs/issue/worker-matrix/P2-closure.md`
    - `docs/issue/worker-matrix/P3-closure.md`
    - `docs/issue/worker-matrix/P4-closure.md`
  - review 文档:
    - `docs/code-review/worker-matrix/P1-P0-reviewed-by-GPT.md`(全部 fix + 二次 closed)
    - `docs/code-review/worker-matrix/P2-reviewed-by-GPT.md`(全部 fix + closed)
    - `docs/code-review/worker-matrix/P3-P4-reviewed-by-opus.md`(全部 fix + 二次 closed;§7 最终收口)
  - handoff memo:见本 memo §3

---

## 2. Secondary outcomes 状态

| 项 | 状态 | 说明 |
|----|------|------|
| W3 pattern spec 3 个 placeholder 节全部已回填 | ✅ | §12 Pattern 11(LOC→时长)+ §13 Pattern 12(流水线)由 P1 回填;§15 第 3 placeholder(循环引用)在 P5 清点文档化为"未触发 — WCA split 零循环" — 这本身成为第 3 条 pattern(见 W3-absorption-pattern §15 final state)|
| 其余 3 workers(bash/context/filesystem)各自至少 1 次 real preview deploy | ⚠ 部分 | bash-core 在 P1.B Phase 5 完成 real preview deploy(`nano-agent-bash-core-preview` Version ID `50335742-e9e9-4f49-b6d7-ec58e0d1cfb4`);context-core / filesystem-core **按 Q3c / Q4a posture 主动 defer** — 二者作为 library-worker,runtime 通过 pnpm workspace subpath 被其他 worker 消费而非 HTTP endpoint。**这不是缺口而是 posture 决策**(P3/P4 closure § 已诚实承认 library_worker 身份);P5 未强制补 deploy |
| `docs/design/worker-matrix/` 新增 charter-level boundary 子 design | N/A | 可选项;未新增;P5 review 未提出必要性 |

---

## 3. 下一阶段 handoff

按 charter §10 下一阶段触发条件,下一 phase 由 **live loop stability trigger** 或 **scope expansion trigger** 之一启动。截至 2026-04-23,尚无 trigger 被激活。

### 3.1 下一阶段候选与触发条件

| trigger | 启动条件 | 预期产出 |
|---------|----------|----------|
| **live loop stability trigger** | preview live loop 连续稳定 2-4 周(监测 agent-core + bash-core preview URL 无 5xx / 无 regression / B7 LIVE 继续绿)| 独立 release charter:production env flip(`nano-agent-agent-core-production` + `nano-agent-bash-core-production`)、custom domain、可选 namespace 归属到 `@nano-agent/*` 或保持 `@haimang/*`(取决于 namespace 纠纷时的后续决议)|
| **scope expansion trigger** | owner 明确 admit skill.core 或其他第 5 workers | clean rewrite `docs/plan-<next>.md`(class 似 r2);重新开 design + blueprint + action-plan 链 |

### 3.2 handoff 输入包(下一阶段作者 kickoff 时读这些)

**worker-matrix final truth layer**:
1. 本 memo — 全阶段收口证据汇总
2. `docs/plan-worker-matrix.md` — charter,含 §10 触发条件 + §11 维护规则(§11.1 新增 "P5 released-path cutover executed 2026-04-23" 条目)
3. 5 份 phase closure memos(P0/P1/P2/P3/P4)— 每个 phase 的具体交付证据
4. 3 份 review 文档(P1-P0 / P2 / P3-P4)— GPT 与 Opus 互审的事实核查链

**runtime ownership truth layer**:
5. 4 个 `workers/*/` 目录 — 真实 canonical runtime(agent-core 含 1027 tests;bash-core 355;context-core 170;filesystem-core 293)
6. 9 个 `packages/<Tier-B>/README.md` — 已带 DEPRECATED banner,**coexistence duplicate 保留** 直到下一阶段 physical delete
7. 2 个 `packages/<Tier-A>/`(`nacp-core@1.4.0` / `nacp-session@1.3.0`)— 仍是 canonical wire vocabulary(Tier A,不 deprecate)
8. live preview URLs(仍 serve):
   - `https://nano-agent-agent-core-preview.haimang.workers.dev/`(Version `1d423bfc-4d54-4fed-b84c-f47586b79728`;含 BASH_CORE binding live)
   - `https://nano-agent-bash-core-preview.haimang.workers.dev/`(Version `50335742-e9e9-4f49-b6d7-ec58e0d1cfb4`)

**release hygiene truth layer**:
9. `.npmrc`(root,使用 `${NODE_AUTH_TOKEN}` 占位符,与 `the historical dogfood consumer npmrc` 同模式)
10. `pnpm-lock.yaml` — 4 workers 对 nacp-* resolution 为 `1.4.0/1.3.0`(published path)
11. GitHub Packages 发布 workflow run ID:`24814439569`(W2 W2-closure.md 记录);`@haimang/nacp-core@1.4.0` + `@haimang/nacp-session@1.3.0` 仍 listed

### 3.3 下一阶段已知 open questions(非 worker-matrix 内 blocker)

1. **context slice / artifact slice one-shot ownership switch**:WCA coexistence duplicate(context slice 在 context-core + packages 两端存在)的最终 cutover 节奏,待下一阶段明确。P3/P4 closure §4 已把此项标为 "next charter"。
2. **filesystem-core consumer path 切换**:目前 agent-core 仍 import `@nano-agent/workspace-context-artifacts`(老 WCA path),而非 `@haimang/filesystem-core-worker`。是否切换归下一阶段 posture charter 决定。
3. **tenant wrapper CI grep guard**:当前 B9 tenant wrapper 约束靠人工 review + 本 memo §4 手工 grep。下一阶段建议固化成 CI check(`grep -r "storage.put|storage.get|storage.list" workers/*/src/` + 要求每处前有 `getTenantScopedStorage`)。
4. **PX — root test tree 重构**:`docs/action-plan/worker-matrix/PX-new-tests.md` 是独立于 worker-matrix 的测试树重构 charter(已 draft,未完全执行)。下一阶段按 owner 节奏决定何时落地。

### 3.4 下一阶段作者 kickoff checklist

当 trigger 激活后,下一阶段 kickoff 的 first PR body 应包含:

- [ ] 引用本 memo 作为 single final truth anchor
- [ ] 明确 trigger(live loop stability vs scope expansion)
- [ ] 选择是否启动 production env flip(若 live loop stability trigger)
- [ ] 决策 WCA / context-slice / artifact-slice 的最终 one-shot cutover 节奏
- [ ] 决策是否切 agent-core 的 WCA 消费路径到 filesystem-core
- [ ] 决策 Tier B packages 物理删除的 timeline(建议 live loop stability 2-4 周后)
- [ ] 是否 admit 第 5 worker(skill.core 或其他)
- [ ] 是否 bump NACP(`nacp-core 1.5.0` / `nacp-session 1.4.0`)— 独立 charter,不在 worker-matrix 闭环内

---

## 4. Cross-cut 不变量最终确认(worker-matrix 全阶段零漂移)

| 不变量 | 状态 | 证据 |
|--------|------|------|
| NACP wire vocabulary(6 canonical `ContextLayerKind`)| ✅ 保持 | `grep -rE '"initial_context"' workers/*/src/ packages/*/src/` 0 命中(作为 kind value) |
| R2 wire truth:`session.start.initial_input` + `session.followup_input.text`,`turn_input` 仅 TS internal | ✅ 保持 | `grep -rE 'message_type\s*:\s*"turn_input"\|kind\s*:\s*"turn_input"' workers/*/src/` 0 命中 |
| R3 binding-first:bash-core 无 `/tool.call.request` public HTTP | ✅ 保持 | bash-core live URL `/tool.call.request` 返 404;`workers/bash-core/src/index.ts` 仅暴露 `/capability/call` + `/capability/cancel` + `/` + `/health` |
| R2 error kind:`system.notify severity=error`,不自造 `system.error` | ✅ 保持 | `grep -rE 'kind\s*:\s*"system\.error"' workers/*/src/` 0 命中 |
| B9 tenant wrapper:所有 `storage.put/get/list` 经 `getTenantScopedStorage()` | ✅ 保持 | production DO code path(`workers/agent-core/src/host/do/nano-session-do.ts:1150+1203`、`1208+1212`)全部先拿 scoped storage |
| W1 RFC direction-only(不 ship `workspace.fs.*` remote RPC) | ✅ 保持 | `workers/agent-core/wrangler.jsonc` 仅 `BASH_CORE` 激活;`CONTEXT_CORE / FILESYSTEM_CORE` 仍注释(Q3c/Q4a host-local) |
| Tier B packages 共存期物理存在 | ✅ 保持 | 11 个包(9 Tier B + 2 Tier A)全保留,9 Tier B 已挂 DEPRECATED banner |
| NACP 版本号不 bump | ✅ 保持 | `nacp-core@1.4.0` / `nacp-session@1.3.0` 端到端一致(package.json / lockfile / live probe) |
| workspace truth 单一源 | ✅(coexistence)| `ContextAssembler` / `WorkspaceNamespace` / `MountRouter` 等 canonical source 仍在 `packages/workspace-context-artifacts`;worker-side canonical copies 在 context-core / filesystem-core;coexistence duplicate 口径已显式 |
| skill.core reserved | ✅ 保持 | 未 admit;未新建 worker;`SKILL_WORKERS` 仍在 `RESERVED_BINDINGS` |
| NOT-成功退出 6 条硬约束 | ✅ 0 违反 | primary 1-6 全绿 / tenant wrapper 未绕过 / schemas 未私修 / 无第 5 worker / W1 RFC 未 ship / Tier B 未物理删 |

---

## 5. worker-matrix 阶段一句话 verdict

> **worker-matrix 阶段正式收口**:4 个 workers 的 runtime ownership 已从 `packages/*` 吸收到 `workers/*/src/`;live agent turn loop 在 preview env 通过 BASH_CORE service binding 真实跑通;`workspace:*` interim 已切到 `@haimang/nacp-core@1.4.0` + `@haimang/nacp-session@1.3.0` published path;9 个 Tier B packages 已按 per-worker 节奏挂 DEPRECATED banner(物理保留至下一阶段);B7 LIVE / 98+ root / 121 cross + 3500+ package/worker tests 全绿;NACP wire vocabulary / tenant wrapper / skill.core 保持 / W1 RFC direction-only 全 6 条硬约束 0 违反。下一阶段等待 **live loop stability trigger** 或 **scope expansion trigger** 之一被激活,届时以本 memo 作为 single truth anchor kickoff。

---

## 6. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-23 | Claude Opus 4.7(1M context)| 初稿;P5 Phase 0-4 全部完成后 ship;charter §9 6 条 primary exit criteria 全绿映射 + secondary outcomes 状态 + 下一阶段 handoff + cross-cut 不变量最终确认 |
