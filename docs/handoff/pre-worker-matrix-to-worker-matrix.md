# Pre-Worker-Matrix → Worker-Matrix handoff memo

> **Status**: `handoff-ready` ✅
> **Owner**: `GPT-5.4`
> **Primary source of truth**: `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md`
> **Scope**: W5 handoff only — no `packages/` or `workers/` code changes

---

## §1 Phase Summary

| phase | verdict used for handoff | primary evidence |
|---|---|---|
| W0 | `closed` | `docs/issue/pre-worker-matrix/W0-closure.md` |
| W1 | `closed` | `docs/issue/pre-worker-matrix/W1-closure.md` |
| W2 | `closed (first publish completed)` | `docs/issue/pre-worker-matrix/W2-closure.md` |
| W3 | `closed (design-heavy; optional dry-run deferred)` | `docs/issue/pre-worker-matrix/W3-closure.md` |
| W4 | `closed (real preview deploy completed)` | `docs/issue/pre-worker-matrix/W4-closure.md` |
| W5 | `closed` | this memo + `docs/issue/pre-worker-matrix/W5-closure.md` |

**Executive summary**

1. Pre-worker-matrix did **not** absorb Tier B packages into the workers.
2. It froze topology, package ownership, import/publish posture, three cross-worker RFC directions, representative absorption blueprints, and the deploy-shaped worker shells.
3. Worker-matrix r2 should start from this memo plus the final closure and current-gate-truth rev 3, not by reopening the old deprecated charter.

---

## §2 What worker-matrix may assume now

| assumption | current truth | why worker-matrix may rely on it |
|---|---|---|
| worker topology | `workers/agent-core`, `workers/bash-core`, `workers/context-core`, `workers/filesystem-core` exist | directory naming and shell ownership are no longer design guesses |
| external package truth | only `@haimang/nacp-core` and `@haimang/nacp-session` are permanent published packages | worker-matrix should absorb Tier B packages instead of treating them as forever-libraries |
| publish posture | GitHub Packages path is real: `@haimang/nacp-core@1.4.0`, `@haimang/nacp-session@1.3.0` | worker-matrix may plan future cutover against a real registry, not a hypothetical one |
| interim dependency posture | `workspace:*` remains legal during first-wave worker assembly | worker-matrix does not need to force published-path cutover in its first absorption PR |
| protocol direction | workspace RPC / remote compact delegate / evidence forwarding are RFC-frozen, not shipped code | worker-matrix must not pretend these remote seams already exist as runtime APIs |
| worker shell baseline | `agent-core` preview deploy is real; other 3 shells are dry-run validated | P0 should fill the existing shells rather than rebuild topology from scratch |

---

## §3 Hard rewrite checklist for `plan-worker-matrix.md` r2

1. Rewrite the opening state from **deprecated awaiting pre-worker close** to **rewrite-required after pre-worker close**.
2. Use `@haimang/nacp-core@1.4.0` + `@haimang/nacp-session@1.3.0` as the published contract baseline.
3. Treat W1 as **RFC-only direction freeze**; do not upgrade workspace RPC / compact delegate / evidence forwarding into “already shipped protocol code”.
4. Treat W3’s absorption map + 3 representative blueprints as the execution baseline for Tier B absorption order.
5. Treat W4’s `workers/*` shells as already materialized; worker-matrix P0 fills `src/` and bindings, not the repository topology.
6. Keep `agent.core` as the host worker and do **not** move it into a binding-slot mental model.
7. Keep `workspace:*` as an allowed interim path until worker-matrix explicitly chooses its published-path cutover milestone.
8. Move all real Tier B absorption, live cross-worker binding activation, and service runtime assembly work into worker-matrix scope; do not back-project them into pre-worker.
9. Make r2 exit criteria about **live assembly reality**: actual absorption, live turn loop, remote seam activation where needed, and published-path/deprecation milestones.

---

## §4 Open items carried forward

| item | current posture at handoff | expected landing zone |
|---|---|---|
| first real absorption order | not yet chosen | worker-matrix r2 + first P0 PR |
| `workspace:*` → published version cutover in worker shells | not yet scheduled | worker-matrix first-wave milestone |
| `BASH_CORE / CONTEXT_CORE / FILESYSTEM_CORE` live service bindings in `agent-core` | documented future slots only | worker-matrix integration phase |
| W3 pattern placeholder backfill | waiting for first real absorb | first absorb retrospective |
| Tier B deprecation banners / package removal | intentionally untouched | after corresponding worker absorption proves stable |

---

## §5 Input pack to read before authoring r2

Read these in order:

1. `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md`
2. `docs/issue/pre-worker-matrix/W5-closure.md`
3. `docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md`
4. `docs/design/pre-worker-matrix/W3-absorption-map.md`
5. `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md`
6. `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`
7. `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md`
8. `docs/issue/pre-worker-matrix/W4-closure.md`

Use B8/B9 materials as upstream ancestry, not as the direct planning pack:

9. `docs/handoff/after-foundations-to-worker-matrix.md`
10. `docs/issue/after-foundations/B9-final-closure.md`

---

## §6 Final handoff verdict

Worker-matrix may start **rewrite r2 now**.

The important constraint is sequencing:

1. rewrite the charter first,
2. then use W3/W4 artifacts to drive the first absorption and assembly PRs,
3. and only then close the remaining “real runtime” items that pre-worker-matrix intentionally left downstream.

---

## §7 Opus 审查与收口分析(2026-04-23,audit by Claude Opus 4.7 1M context)

> **审查对象**:整个 pre-worker-matrix 阶段(W0 → W5)
> **审查维度**:代码事实 / 部署真相 / 设计目标(`docs/plan-pre-worker-matrix.md` §11.1 6 条 exit criteria + `docs/design/pre-worker-matrix/**`)
> **审查结论**:**✅ 无硬 blocker,pre-worker-matrix 正式收口成立**;列 4 项软观察供 worker-matrix r2 authors 在开写 charter 前显式消化。

### §7.1 逐 phase × 事实层 verdict 表

| phase | 本 charter 承诺的硬目标(§11.1 / §4.1) | 实测事实 | verdict |
|---|---|---|---|
| W0 | Tier A wire vocabulary 收进 `@haimang/nacp-core@1.4.0`;不搬 runtime class | `packages/nacp-core/package.json` name=`@haimang/nacp-core` version=`1.4.0`;`evidence/` `hooks-catalog/` `storage-law/` `transport/cross-seam.ts` 目录存在;`pnpm -r run typecheck` 14 项全绿(10 packages + 4 workers) | ✅ |
| W1 | 3 条 cross-worker RFC directionally shipped,不实装代码 | `docs/rfc/nacp-workspace-rpc.md` / `remote-compact-delegate.md` / `evidence-envelope-forwarding.md` 三份齐备;`packages/nacp-core/src/messages/` 里没有 `workspace.fs.*` / 私有 compact / 私有 evidence family 的 schema;三份 RFC 顶部均为 `executed directional RFC` | ✅ |
| W2 | GitHub Packages publish pipeline skeleton + 首发 parallel | `gh run view 24814439569 --repo haimang/nano-agent` → conclusion `success` / headSha `8da7e6b`;`@haimang/nacp-core@1.4.0` + `@haimang/nacp-session@1.3.0` published;`dogfood/nacp-consume-test` published-path install+build+smoke 3 步均有 verifiable evidence 于 `W2-closure.md` §5 | ✅(升级为 first publish completed)|
| W3 | 1 份 map + 2-3 份代表 blueprint + pattern spec;optional capability-runtime dry-run | `W3-absorption-map.md` 含 10 units / 4 workers;`W3-absorption-blueprint-{capability-runtime,workspace-context-artifacts-split,session-do-runtime}.md` 三份齐备;`W3-absorption-pattern.md` 10 条 pattern 齐备;optional dry-run 按 owner Q1 deferred 到 worker-matrix P0(诚实 defer,非偷 skip)| ✅(design-heavy,dry-run deferred)|
| W4 | `workers/` 物理目录 + 4 个 deploy-shaped shell + `agent-core` 1 real deploy + 3 dry-run | `workers/{agent-core,bash-core,context-core,filesystem-core}/` 目录 + 各自 `package.json` + `wrangler.jsonc` + `tsconfig.json` + `README.md` + `src/` + `test/`;`pnpm --filter './workers/*' typecheck` 4/4 绿;`pnpm --filter './workers/*' test` 13 tests 全绿;`pnpm --filter './workers/*' deploy:dry-run`(需先跑 build)4/4 pass;**`curl https://nano-agent-agent-core-preview.haimang.workers.dev` 返回 `{"worker":"agent-core","nacp_core_version":"1.4.0","nacp_session_version":"1.3.0","status":"ok","phase":"pre-worker-matrix-W4-shell"}`(live deploy 真实存在)** | ✅(upgraded to real preview deploy completed)|
| W5 | 6 份 closure + handoff memo + gate-truth rev 3 + charter state flip | `pre-worker-matrix-final-closure.md` / `W0..W5-closure.md` 齐备;`docs/handoff/pre-worker-matrix-to-worker-matrix.md` shipped;`00-current-gate-truth.md` header 标记 Revision 3;`plan-worker-matrix.md` 顶部状态 `needs-rewrite-r2 / pre-worker-matrix closed on 2026-04-23`;`after-foundations-final-closure.md` rev 2 已把下游 gate 重指向 pre-worker-matrix closure | ✅ |

### §7.2 对照 charter §11.1 primary exit criteria(6 条硬闸)

| exit 条件 | 实测对照 | verdict |
|---|---|---|
| 1. 目录拓扑冻结 | `workers/{agent-core,bash-core,context-core,filesystem-core}/wrangler.jsonc` 四份均有 `"name": "nano-agent-<worker>"`;名字已 owner-approved 并落盘 | ✅ |
| 2. 包策略冻结 | 全仓 `package.json` 扫描:`@haimang/nacp-core` + `@haimang/nacp-session` 是唯一非 Tier B 永久包;Tier B 9 包维持 `@nano-agent/*` 内部 scope;`W3-absorption-map.md` 给出 9 packages → 4 workers 的 10 units 吸收图 | ✅ |
| 3. import / publish 策略冻结 | `workspace:*` interim 路径真实存在(见 `workers/*/package.json` 对 `@haimang/nacp-*` 的 `workspace:*` 依赖);published path 亦真实存在于 GitHub Packages;两条路径并存不冲突 | ✅ |
| 4. 3 个 orphan 决策冻结 | `initial_context` 归属 → `plan-worker-matrix.md:111` 冻结在 agent.core host;capability remote/local → `plan-worker-matrix.md:199,269` 冻结为 `tool.call.* via CAPABILITY_WORKER seam` + bash.core 不单独 deploy;filesystem first-wave → `plan-worker-matrix.md:269` 冻结为 `保持 host-local workspace mount`。**⚠️ 见 §7.4 O2:三项决策的权威文档在 `plan-worker-matrix.md` r1(pre-worker-matrix 的上游 deprecated charter)而非 pre-worker-matrix 自身 charter,表述上 `§11.1 item 4` 的 "本 phase charter 明确" 不够精确** | ✅(决策本身冻结;文档归属有轻微偏移)|
| 5. 最小 worker scaffold 存在 | `agent-core` preview URL 真实上线并回传预期 JSON(live probe 验证)+ 其他 3 worker `deploy:dry-run` 全绿 + 3 份 directional RFC 已 shipped | ✅ |
| 6. worker-matrix r2 起跑线重写清楚 | `plan-worker-matrix.md` 状态翻到 `needs-rewrite-r2` + handoff memo(本文)+ final closure memo + gate-truth rev 3 四件齐备 | ✅ |

### §7.3 §11.3 NOT-成功退出识别逐条排除

| NOT-成功条件 | 当前真相 | 排除状态 |
|---|---|---|
| primary 1-6 任一未满足 | §7.2 全部 ✅ | `排除` |
| W0 吸收过程破坏 1.3.0 消费者(re-export 失效) | `pnpm -r run test` 总计 2190 tests 绿;`@nano-agent/session-do-runtime` 357/357、`@nano-agent/hooks` 198/198、`@nano-agent/workspace-context-artifacts` 192/192 仍全绿;`npm run test:cross` 112/112 绿 | `排除` |
| B7 LIVE 契约 tests 红 | `node --test test/*.test.mjs` 98/98 绿(含 `test/b7-round2-integrated-contract.test.mjs` 全部 subtests)| `排除` |
| agent-core 真实 deploy 失败且未 resolved | `curl https://nano-agent-agent-core-preview.haimang.workers.dev` 实时返回预期 JSON;`pnpm deploy:preview` 于 `W4-closure.md` §5.4 已有 URL + Version ID 证据 | `排除` |

### §7.4 软观察(非 blocker,但建议 worker-matrix r2 开写前消化)

> 所有条目均不构成 **硬 blocker**;它们是 "若不提前消化,会在 worker-matrix r2 rewrite 时引入不必要的阅读成本或静默假设" 的温和风险。

**O1 — 本地 `deploy:dry-run` 隐含依赖 `build` 前置,文档未显式声明。**
审查时首次跑 `pnpm --filter './workers/*' deploy:dry-run`(未先 build)结果 bash-core / context-core / filesystem-core 三个因 `dist/index.js not found` 失败;先跑 `pnpm --filter './workers/*' build` 后再 dry-run 全部通过。CI 工作流 `.github/workflows/workers.yml` step 60-67 的顺序是对的(`build` → `test` → `dry-run`),因此这 **不影响 CI 绿灯**,也不否定 W4 closure 里的 "4/4 dry-run 通过" 事实。但本地复现者若按 `workers/*/README.md` 或 closure §5.2 的命令清单拷贝执行,第一次会看到红屏。**建议**:在 `workers/*/README.md` 或 handoff memo §2 明确一句 "local deploy:dry-run must follow a local build step",或在 `package.json` 里把 `deploy:dry-run` 改成 `tsc && wrangler deploy --dry-run`。

**O2 — 3 个 orphan 决策的权威文档归属有轻微偏移。**
`plan-pre-worker-matrix.md` §11.1 item 4 的文字是 "本 phase charter 明确",但实测这三条决策的权威 wording 都落在 `docs/plan-worker-matrix.md`(r1 deprecated charter):
1. `initial_context` consumer 归属 agent.core → `plan-worker-matrix.md:111`
2. `CAPABILITY_WORKER` 作为 remote seam / bash.core 不单独 deploy → `plan-worker-matrix.md:199,269`
3. filesystem first-wave 保持 host-local workspace mount → `plan-worker-matrix.md:269`

final closure §3 item 4 把这个归属写成 "frozen at charter/design level",属于诚实的宽松描述,但对 r2 作者不够精确。**建议**:worker-matrix r2 charter §0 / §1 把这 3 条决策 **原样引用** 进 r2 正文(或建一张 decision-provenance 表),避免未来 archaeology。否则 r2 作者会在两个 charter 之间来回查找,容易误以为某条决策仍待冻结。

**O3 — W3 pattern spec 有 3 个 placeholder 节未回填,但没有 schedule 绑在具体 PR 上。**
`W3-absorption-pattern.md` 的三个 placeholder:
1. "LOC → 时长经验系数"
2. "可执行流水线样板"(搬 src/test + build + test 的实际命令序列)
3. "循环引用解决 pattern"

前两项 charter / final closure 都声明 "等 worker-matrix P0 首次 absorb 回填";第三项因 `capability-runtime` 实测零跨包 dep,必须等 `workspace-context-artifacts` split 真实发生时回填。**当前 handoff memo §4 把 W3 pattern placeholder 归为 "waiting for first real absorb",但没有具体 PR owner / 触发条件表述**。**建议**:worker-matrix r2 charter 的 Phase §(首个 absorption PR 对应那一节)把 "完成 pattern spec 三个节回填" 写成该 PR 的 DoD(definition-of-done)checklist item,否则很容易在后续 PR 里漂移丢失。

**O4 — `workspace:*` → published 切换的里程碑未定锚。**
`W2` 已经把 `@haimang/*` published path 做成真实基线,`W4` 有意保留 `workspace:*` 作为首轮依赖基线。handoff memo §4 把 "worker shells published-path cutover" 归为 "not yet scheduled"。这在 pre-worker-matrix 阶段是正确选择(不越位),但 worker-matrix r2 charter **应该** 显式给出切换 trigger,否则 "interim" 容易变成 "permanent"。**建议 trigger 候选**:(a) 首个 Tier B absorption PR merge 后的第一个 release 周期;或 (b) `agent-core` 从 preview env 升级到 production env 时同时切换;或 (c) 明确定一个月内 scheduled PR。worker-matrix r2 作者择一即可,但不能留空。

### §7.5 与原始设计目标的对齐度打分

| charter §3 / §13 目标 | 交付强度 | 备注 |
|---|---|---|
| "narrower: 不实装任何 worker 业务能力" | ✅ 完全遵守 | workers/*/src/ 仅是 host shell + NACP version probe,无任何 Tier B 业务代码 |
| "narrower: 3 条新协议降级为 RFC-only" | ✅ 完全遵守 | 无私有 family 代码 ship;RFC 文本已 frozen 并与 W0 shipped truth 对齐 |
| "narrower: W2 skeleton + 首发 parallel" | ✅ 超额完成 | 不只 skeleton,还完成真实首发 + dogfood + reality-calibrated discipline |
| "narrower: W3 map + 2-3 代表 blueprint + optional dry-run" | ✅ 按 narrower scope 落地 | 非代表包 7 份 detailed blueprint 按设计留给 worker-matrix P0 on-demand 补 |
| "narrower: W4 1 real deploy + 3 dry-run" | ✅ 完全达标 | agent-core live preview + 其余 3 dry-run 全绿 |
| "narrower: W5 只负责 closure / handoff / charter flip,不越位" | ✅ 完全遵守 | W5 未动任何 packages/ 或 workers/ 代码;`plan-worker-matrix.md` r2 正文由 W5 显式 **不写**,仅 flip state |
| "exit:6 条 §11.1 硬闸全满足" | ✅ 6/6 | 见 §7.2 |
| "NOT-成功退出 4 条逐条排除" | ✅ 4/4 | 见 §7.3 |

### §7.6 最终审查裁定

**✅ pre-worker-matrix 阶段正式 closed,无硬 blocker,可以进入 worker-matrix charter rewrite r2。**

支持这个裁定的 4 条硬事实:

1. **代码真相层全绿**:全仓 typecheck 14 项绿;`pnpm -r run test` 2190 tests 绿;root contract 98/98 绿;cross 112/112 绿;workers build/test/dry-run 4/4 绿。
2. **部署真相层真实存在**:`https://nano-agent-agent-core-preview.haimang.workers.dev` 实时返回 v1.4.0 / v1.3.0 probe JSON(非模拟,非 claim)。
3. **发布真相层真实存在**:`@haimang/nacp-core@1.4.0` + `@haimang/nacp-session@1.3.0` 在 GitHub Packages 上,workflow run `24814439569` conclusion=`success`。
4. **文档真相层内部一致**:`plan-worker-matrix.md` 状态 = `needs-rewrite-r2 / pre-worker-matrix closed`;`after-foundations-final-closure.md` = rev 2;`00-current-gate-truth.md` = Revision 3;`pre-worker-matrix-final-closure.md` §3 6 条 exit readiness 全 `done`;三层元文档互相指认,无环形 / 孤儿引用。

worker-matrix r2 作者在动笔前应显式消化 **§7.4 的 4 个软观察(O1-O4)**,把它们在 r2 正文 / r2 Phase DoD / r2 milestone 中落实成具体表述;其余事实可以按 §5 input pack 直接进入 rewrite。

---
