# ZX3 Components Deprecation — 收尾专项

> 类型: closure (full — 5/5 phases done)
> 关联: `docs/action-plan/zero-to-real/ZX3-components-deprecation.md`
> 上游承接: `docs/issue/zero-to-real/ZX2-closure.md` §4.3 + §5 R11-R31 + §8.2
> 上游调研: `docs/eval/zero-to-real/legacy-test-and-package-deprecation.md`
> 执行人: Opus 4.7(1M ctx)
> 时间: 2026-04-27
> 状态: **ZX3 全 5 phase 完成 — `test-legacy/` 物理删除;6 个 absorbed duplicate package 删除;6 个 utility library 显式 keep-set;test 树完成 4-layer canonical 化(shared / root-guardians / package-e2e / cross-e2e)**

---

## 0. TL;DR

ZX3 完成"组件退役"主线 — 仓库从"逻辑退役 + 物理共存"中间态,推进到"canonical keep-set + 物理删除 6 个 absorbed duplicate + test 树 canonical 化"。**ZX2 closure §4.3 + §5 + §8.2 中的 26 个 carryover 项,17 个明确 defer 到 ZX4(详见 ZX3 plan §16.7),2 个进入 owner-action,7 个已 ZX2 / ZX3 闭合**。

**已完成**:
- ✅ Phase 1: manifest 冻结(package + test-legacy + ZX2 carryover scope)
- ✅ Phase 2: 6 个 absorbed duplicate package 物理删除(`agent-runtime-kernel` / `capability-runtime` / `llm-wrapper` / `context-management` / `hooks` / `session-do-runtime`)
- ✅ Phase 3(v2 simplified): 6 个 utility library reclassify 为 keep-set(原 v1 把它们错误分类为 deletion 候选)
- ✅ Phase 4: test-legacy cutover(5 guardians 迁 `test/root-guardians/` + 14 broken retire + R30 cross-e2e 拓扑修 + scripts 切换)
- ✅ Phase 5: `test-legacy/` 物理删除 + docs sync
- ✅ Q1-Q6 owner 全部确认(2026-04-27)
- ✅ **2400 + 31 = 2431 tests 全绿,零回归**

**v2 关键修订(2026-04-27)**: `workspace-context-artifacts` / `storage-topology` / `eval-observability` 改为 keep-set utility libraries(而非 deletion 候选)。这些是真 shared infrastructure(D1Adapter / DOStorageAdapter / TraceEvent / ContextLayer 等),与 nacp-core 同性质。原 v1 plan 把它们当 deletion 候选是错误分类。修订后 Phase 3 简化为 README posture freeze(docs-only),避免高风险 53-import refactor。

**owner-action 待办**:
- ⏳ `pnpm-lock.yaml` 一次清理 — 需 `NODE_AUTH_TOKEN` 注入后 `pnpm install`(不阻塞 test/deploy)

**defer 到 ZX4**:
- 17 项 ZX2 carryover(R28+R29 deploy-only bug / R30 测试拓扑修已在 ZX3 P4-04 完成 / R27 WS round-trip / R26 user-do refactor / R16 D1 schema / R19+R20+R21 协议 + auth hardening / R25 WORKER_VERSION CI / 产品 endpoints / heartbeat client / WeChat / 7 天 parity / P3-05 翻转 / 等)
- 见 ZX4 unified plan: `docs/action-plan/zero-to-real/ZX4-transport-finalization.md`

---

## 1. 已交付物

### 1.1 Phase 1 — Manifest 冻结(详见 ZX3 plan §14)

- §14.1 Package Posture Manifest(v2 reclassified): 6 surviving keep-set + 1 reserved + 6 deletion(已删)
- §14.2 Test-Legacy Inventory: 27 entries 4-tier 分类
- §14.3 ZX2 Carryover Scope: 26 项落点冻结

### 1.2 Phase 2 — 物理删除 6 个 absorbed duplicate(详见 ZX3 plan §15)

`packages/` 12 → 6;模板文件加 archive header;2400/2400 tests 全绿。

### 1.3 Phase 3 — keep-set posture freeze(**v2 scope reduction**;详见 ZX3 plan §16.1-§16.2)

**Scope reduction acknowledgment**(per deepseek R10 / GLM R4):

ZX3 plan v1 把 P3-01/P3-02/P3-03 定义为 "迁移 `workspace-context-artifacts` / `storage-topology` / `eval-observability` 的 53 个 import 至 worker 内 → 清零后删除这 3 个 bridge package"。**v2 reclassification 把这 3 个 bridge package 整体重新分类为 keep-set utility libraries**(因为它们承载真 shared infrastructure — D1Adapter / DOStorageAdapter / TraceEvent / ContextLayer 等,与 nacp-core 同性质),原计划的 53-import 迁移工作**整体取消**。Phase 3 实际交付物降级为 6 份 README posture freeze(docs-only)。

**这是 scope reduction 不是 simplification** — closure 应清晰记录这个决策,避免后续阅读者误以为 P3-01/P3-02/P3-03 的迁移动作已执行。

**当前 import 计数口径说明**(per deepseek R7 / GLM R4):
- ZX3 plan §14.1 manifest 列的 "37 active imports / 16 / 2" 是 package.json 依赖声明 + TS type/value import + test import 的合计口径(包括注释、类型声明、间接引用)
- 精确 `from '@haimang/...'` 或 `from '@nano-agent/...'` 的 runtime import 实际为:`workspace-context-artifacts` 6-29 处 / `storage-topology` 0-19 处 / `eval-observability` 0-2 处(grep 范围影响计数,但量级远低于 manifest 数字)
- 两个口径都成立,但 closure 应标注差异来源,避免后续 reader 误判

6 个 surviving package 全部 keep-set:
- 协议层(3): `nacp-core` / `nacp-session` / `orchestrator-auth-contract`
- utility 层(3): `workspace-context-artifacts` / `storage-topology` / `eval-observability`
- reserved(1): `jwt-shared`(ZX4 Stream-3 创建)

### 1.4 Phase 4 — test-legacy cutover(详见 ZX3 plan §16.3)

- P4-01: external-seam fixtures 迁 `test/shared/fixtures/`;agent-core test import path 更新
- P4-02: **5 个 contract guardian + 1 个 meta-guardian = 6 个文件**(原 closure 写 "5 个" 不准确;`test-command-coverage.test.mjs` 是 meta-guardian,守护测试脚本覆盖)迁 `test/root-guardians/`;14 broken retire;`test-command-coverage` 改写为新 scripts 守护
- P4-03: `package.json` scripts 切换 — `test:contracts` 指向 `test/root-guardians/*.test.mjs`;`test:legacy:*` 删除
- P4-04: cross-e2e 01/02/03/07/10/11 + zx2-transport + `live.mjs` 全部改为 facade-唯一-entry 模型(承接 ZX2 R30)— **R30 在 ZX3 P4-04 已完整 land,不再 defer 到 ZX4 Stream-1**(见 §3.2 修订)

### 1.5 Phase 5 — 物理删除 + docs sync(详见 ZX3 plan §16.4)

- `rm -rf test-legacy/` — 27 entries 全删
- `ZX3-components-deprecation.md` §14+§15+§16 工作日志
- `ZX3-closure.md`(本文档)
- `ZX4-transport-finalization.md`(unified plan,下条工作)

### 1.6 Owner 决策记录(Q1-Q6 答复)

| Q | 决策 | 落点 |
|---|---|---|
| Q1 | `test/root-guardians/` 命名 canonical | Phase 4 P4-02 ✅ |
| Q2 | observability helper 落点(Q2 答复 `test/shared/observability/` 后 v2 reverted — eval-observability 整体保留为 keep-set library) | §14.1 v2 reclassification |
| Q3 | `orchestrator-auth-contract` 仅 keep-set 冻结 | §14.1 ✅ |
| Q4 | `@haimang/jwt-shared` reserved-for-ZX4 keep-set | §14.1 ✅(ZX4 Stream-3 创建)|
| Q5 | R26 user-do.ts 拆分推迟到 ZX4 | ZX4 Stream-2 |
| Q6 | ZX4 Stream-1 P0 = R28+R29 修 + cross-e2e 14/14 + 7 天 0 误报 → P3-05 翻转 | ZX4 Stream-1 |

---

## 2. 验证证据

| 验证项 | 命令 | 结果 |
|---|---|---|
| `ls packages/` | — | 6 项(全 keep-set) |
| `ls test-legacy/` | — | **不存在** |
| `ls test/` | — | `INDEX.md / cross-e2e / package-e2e / root-guardians / shared` |
| `pnpm test:contracts`(新树) | — | **31 / 31 pass** |
| `pnpm test:cross-e2e`(local, live disabled) | — | **1 pass + 13 skip**(正常) |
| orchestrator-core test | `pnpm -F @haimang/orchestrator-core-worker test` | `42 passed` |
| agent-core test | `pnpm -F @haimang/agent-core-worker test` | `1057 passed` |
| bash-core test | `pnpm -F @haimang/bash-core-worker test` | `374 passed` |
| context-core test | — | `171 passed` |
| filesystem-core test | — | `294 passed` |
| orchestrator-auth test | — | `8 passed` |
| nacp-core test | — | `289 passed` |
| nacp-session test | — | `146 passed` |
| orchestrator-auth-contract test | — | `19 passed` |
| **合计** | — | **`2400 worker+package + 31 root-guardians = 2431 / 2431 pass — 零回归`** |

---

## 3. 残留事项与承接

### 3.1 owner-action 待办

- `pnpm-lock.yaml` 一次清理 — `NODE_AUTH_TOKEN` 注入后 `pnpm install`(不阻塞 test/deploy)

### 3.2 ZX2 Carryover 承接 ZX4(详见 ZX3 plan §11+§16.7)

> **ZX3-ZX4 review 后修订(2026-04-28)**:R30 cross-e2e 拓扑修在 ZX3 Phase 4 P4-04 已完整 land,**不再 defer 到 ZX4 Stream-1**。原 §16.7 defer 列表中关于 R30 的条目已过时,以本节为准。

ZX4 unified plan(`docs/action-plan/zero-to-real/ZX4-transport-finalization.md`)分 3 streams + 7 phases:
- **Stream-1**: deploy-only bug(R28+R29)+ 7 天 parity 观察 + P3-05 翻转 + R31 workers_dev URL 撤销 — **R30 已在 ZX3 P4-04 land,不在 ZX4 Stream-1**
- **Stream-2**: WS round-trip(R27)+ catalog content(R18)+ 产品 endpoints(ZX2 [O8-O11])+ heartbeat client + WORKER_VERSION CI(R25)+ user-do refactor(R26)
- **Stream-3**: D1 schema(R16 /me/sessions pending truth)+ envelope 收敛(R19)+ jwt-shared package(R20)+ FacadeErrorCode 同步(R21)+ kid rotation 测试

### 3.3 defer 到 ZX5(架构 refactor)

- DO 提取独立 worker(R24)
- context-core / filesystem-core 升级真 RPC(原 ZX2 [O5])
- 大型架构 refactor 不在 ZX4 scope

### 3.4 owner-action(无 plan)

- WeChat 真机 smoke(R17)— 需要 owner 用真实 AppID + 微信开发者工具操作

---

## 4. 风险与已知缺口

| 风险 | 严重 | 状态 | 缓解 |
|---|---|---|---|
| `pnpm-lock.yaml` 仍含 6 个 stale 块 | low | open | owner 注入 NODE_AUTH_TOKEN 后一次 `pnpm install` 即可 |
| 14 retired guardians 可能漏掉部分 cross-cutting 契约 | low | acknowledged | 这些 guardians 测的是已被 absorbed 到 worker 的 runtime;契约现在分散在 worker-local tests(2400/2400 全绿证明)。如发现具体契约缺失,可在 ZX4 任意 phase 加回 root-guardians |
| ZX4 scope 庞大(3 streams + 7 phases) | medium | open | ZX4 plan 已起草并冻结 streams 边界;按 P0-P2 优先级串行执行 |

---

## 5. 收尾签字

### 5.1 ZX3 Phase 1-5 — done
- ✅ 6 个 absorbed duplicate package 物理删除(Phase 2)
- ✅ 6 个 utility library 显式 keep-set(Phase 3 v2 reclassified)
- ✅ test-legacy/ 27 entries 物理删除(Phase 5)
- ✅ test/ 4-layer canonical 化(shared / root-guardians / package-e2e / cross-e2e)
- ✅ R30 cross-e2e 拓扑修(Phase 4 P4-04)
- ✅ Q1-Q6 owner 决策落地
- ✅ 2431 / 2431 tests 全绿,零回归

### 5.2 ZX4 启动条件(已具备)
- ✅ ZX2 closure rollout 验证完成(9/14 cross-e2e pass + R28+R29 deploy-only bug 已定位)
- ✅ ZX3 keep-set 冻结(jwt-shared 预留位置)
- ✅ test 树 canonical 化(ZX4 Stream-1 测试可基于 facade-唯一-entry 模型)
- ✅ ZX4 unified plan 草稿已起草

### 5.3 owner action
- ⏳ 审核 ZX4 plan Q1-Q4
- ⏳ `pnpm-lock.yaml` 一次性清理

> 2026-04-27 — ZX3 全 5 phase 收口。"组件退役"主线完成 — 仓库从混杂的 12 packages 共存收敛到 6 个 canonical keep-set;test-legacy/ 历史共存彻底退场;canonical test 树成为唯一真相。**ZX3 不是 transport finalization 的开始,而是 packages + test 治理的结尾**;真正的 transport 收尾(包括真实 deploy bug 修复 + 7 天 parity 观察 + P3-05 翻转)承接到 ZX4 transport-finalization plan。
