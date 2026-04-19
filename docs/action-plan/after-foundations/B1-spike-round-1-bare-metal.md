# Nano-Agent 行动计划 — B1：Spike Round 1 Bare-metal Cloudflare Truth Probe

> 服务业务簇：`After-Foundations Phase 0 — Spike-Driven Code Hardening`
> 计划对象：`spikes/round-1-bare-metal/{spike-do-storage, spike-binding-pair}` + `docs/spikes/{per-finding, rollup}`
> 类型：`new`
> 作者：`Opus 4.7 (1M context)`
> 时间：`2026-04-19`
> 文件位置：
> - `spikes/round-1-bare-metal/spike-do-storage/` （新建）
> - `spikes/round-1-bare-metal/spike-binding-pair/` （新建）
> - `docs/spikes/spike-do-storage/` （per-finding docs）
> - `docs/spikes/spike-binding-pair/` （per-finding docs）
> - `docs/spikes/{storage-findings, binding-findings, fake-bash-platform-findings}.md` （rollup docs）
>
> 关联设计 / 调研文档：
> - `docs/plan-after-foundations.md` (§1.1 / §2.2 / §4.1 A / §5.1 / §7.1 / §11.1)
> - `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` (§3 7 条纪律 / §4 9 项 validation / §4.5-4.6 required vs optional + two-tier deliverable / §5 writeback)
> - `docs/design/after-foundations/P0-spike-do-storage-design.md` (r2)
> - `docs/design/after-foundations/P0-spike-binding-pair-design.md` (r2)
> - `docs/templates/_TEMPLATE-spike-finding.md`
> - `docs/design/after-foundations/P0-reviewed-by-GPT.md` (drift fix 触发源)
>
> 文档状态：`draft`

---

## 0. 执行背景与目标

> after-foundations 阶段是 worker matrix 之前的 spike-driven hardening gate。Phase 0 是这道 gate 的第一步——**用 2 个 disposable Cloudflare worker 在真实 platform 暴露 packages/ typed seams 与 runtime reality 的差异**，并把每个差异写成可被 Phase 1-5 消化的 finding。本 action-plan 只覆盖 Round 1 (bare-metal)，Round 2 integrated 是 B7 的范围。

- **服务业务簇**：`After-Foundations Phase 0 — Spike-Driven Code Hardening`
- **计划对象**：spike Round 1 的 2 个 disposable worker + 9 个 storage/bash probe + 4 个 binding probe + 配套 finding docs（per-finding + 3 rollup）
- **本次计划解决的问题**：
  - **P1**：`packages/storage-topology` 与 `packages/workspace-context-artifacts` 的 storage adapter 假设（含 `NullStorageAdapter` / `ReferenceBackend` not-connected）从未在真实 R2 / KV / DO storage / D1 上验证
  - **P2**：`packages/capability-runtime` 的 12-pack handler contract（特别是 `mkdir` partial-no-directory-entity / `/_platform/**` reserved namespace / `rg` 200 lines+32KB cap / `curl` not-connected stub）从未在真实 Cloudflare Worker 沙箱里跑过
  - **P3**：`packages/session-do-runtime/src/remote-bindings.ts` 的 fetch-based service binding seam + `CrossSeamAnchor` headers 传播 + hooks remote dispatch + eval sink fan-in 从未跨真实 worker 部署验证
  - **P4**：缺少把 spike findings 反向写回 packages/ 的强制纪律——历史经验显示 spike 容易停留在"实验记录"层
- **本次计划的直接产出**：
  - **D1**：2 个 disposable Cloudflare worker（`spike-do-storage` 单 worker + `spike-binding-pair` 双 worker）真实部署
  - **D2**：13 条 required per-finding doc（9 storage/bash + 4 binding，全部使用 `_TEMPLATE-spike-finding.md`）
  - **D3**：3 份 rollup index doc（`storage-findings.md` / `binding-findings.md` / `fake-bash-platform-findings.md`）
  - **D4**：至少 1 条 finding 触发的 packages/ 修改 issue（forward traceability evidence，留给 B2-B6 实施）
  - **D5**：spike 销毁纪律落地（expiration 标注 + namespace 隔离 + 不接生产数据）

---

## 1. 执行综述

### 1.1 总体执行方式

本 action-plan 采用 **"先壳后探，先单后双，先跑后总"** 的三段式策略：

1. **先壳后探**：先把两个 spike 的最小 wrangler 壳与 deploy script 打通，再实现具体 probe handler——确保 platform 真实可达后再做实质工作
2. **先单后双**：先做 `spike-do-storage`（单 worker，少依赖），再做 `spike-binding-pair`（双 worker，需要部署顺序）
3. **先跑后总**：先把所有 per-finding doc 写完，最后做 rollup——避免提前总结导致单个 finding 的精度被稀释

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Spike 壳与 finding 模板就位 | S | 2 个 spike 的目录骨架 + wrangler.jsonc + scripts 模板就位；finding 模板与 P0 design 路径全部对齐 | - |
| Phase 2 | spike-do-storage 部署与 probe 实现 | M | 9 个 probe endpoint 部署可达 + run-all-probes.sh 跑通 | Phase 1 |
| Phase 3 | spike-binding-pair 部署与 probe 实现 | M | 双 worker 部署可达 + 4 binding probe 跑通；显式 transport scope 限制为 fetch-based seam | Phase 1 |
| Phase 4 | Per-finding doc 撰写 | M | 13 条 required finding + N 条 optional 全部 ship；每条带 §3 Package Impact + §5 Writeback Action | Phase 2 + Phase 3 |
| Phase 5 | Rollup index doc 撰写 | S | 3 份 rollup ship；每份含 finding index + severity summary + writeback destination map + dismissed summary | Phase 4 |
| Phase 6 | Spike 纪律自检与 handoff | XS | 7 条 spike 纪律 self-check + writeback issue 创建 + B2/B3 输入交接 | Phase 5 |

### 1.3 Phase 说明

1. **Phase 1 — Spike 壳与 finding 模板就位**
   - **核心目标**：让两个 spike 的目录结构、wrangler 配置、script 模板、finding 模板路径全部对齐 P0 design
   - **为什么先做**：避免 spike implementer 在写 probe 时被路径不一致 / 模板缺失打断；7 条 spike 纪律必须先建立才能开工
2. **Phase 2 — spike-do-storage 部署与 probe 实现**
   - **核心目标**：单 worker probe 真实部署 + 9 个 probe endpoint 全部可调用并返回结构化结果
   - **为什么放在这里**：单 worker 复杂度低，先打通 wrangler deploy 与 R2/KV/D1/DO binding 真实可用，再做双 worker
3. **Phase 3 — spike-binding-pair 部署与 probe 实现**
   - **核心目标**：双 worker 部署（worker-b 先 deploy，worker-a 后 deploy）+ 4 binding probe 真实跨 worker 可调用
   - **为什么放在这里**：依赖 Phase 2 已验证 wrangler deploy 流程；双 worker 需要部署顺序约束
4. **Phase 4 — Per-finding doc 撰写**
   - **核心目标**：把 9 + 4 = 13 条 required finding 全部写成符合 `_TEMPLATE-spike-finding.md` 的独立文档；每条必须有 packages/ impact + writeback action
   - **为什么放在这里**：必须在 spike 跑完后才能写真实的 finding；finding 是 spike 的唯一 ship-value
5. **Phase 5 — Rollup index doc 撰写**
   - **核心目标**：输出 charter 要求的 3 份 rollup deliverable；每份是索引 + verdict + writeback map，不重复 per-finding 内容
   - **为什么放在这里**：必须在 per-finding 全部 ship 后再做，避免 rollup 与 per-finding 双轨漂移
6. **Phase 6 — Spike 纪律自检与 handoff**
   - **核心目标**：检查 7 条 spike 纪律是否全部满足；为 B2 (storage adapter hardening) / B3 (fake-bash extension) / B4-B6 创建 writeback issue
   - **为什么放在这里**：handoff 是阶段尾段动作；必须等 rollup 完成后才能交接

### 1.4 执行策略说明

- **执行顺序原则**：壳→探→总→交（建立基础设施 → 跑 probe → 总结发现 → handoff）
- **风险控制原则**：spike 纪律 7 条作为自检 checklist 贯穿每个 Phase；任何一条违反立即停下修正
- **测试推进原则**：spike 不接 CI 主链（纪律 3）；每个 probe 路由有自己的 manual smoke；rollup 完成后做整体 traceability check
- **文档同步原则**：per-finding doc 必须用 `docs/templates/_TEMPLATE-spike-finding.md`（**唯一**模板路径）；不允许使用 `docs/spikes/_TEMPLATE-finding.md`

### 1.5 本次 action-plan 影响目录树

```text
nano-agent/
├── spikes/                                          # 顶级目录（纪律 1：不进 packages/）
│   └── round-1-bare-metal/
│       ├── spike-do-storage/                        # Phase 2 新建
│       │   ├── wrangler.jsonc
│       │   ├── package.json
│       │   ├── src/
│       │   │   ├── worker.ts
│       │   │   ├── do/ProbeDO.ts
│       │   │   ├── probes/
│       │   │   │   ├── r2-multipart.ts            # V1-storage-R2-multipart
│       │   │   │   ├── r2-list-cursor.ts          # V1-storage-R2-list-cursor
│       │   │   │   ├── kv-stale-read.ts           # V1-storage-KV-stale-read
│       │   │   │   ├── do-transactional.ts        # V1-storage-DO-transactional
│       │   │   │   ├── mem-vs-do.ts               # V1-storage-Memory-vs-DO
│       │   │   │   ├── d1-transaction.ts          # V1-storage-D1-transaction
│       │   │   │   ├── bash-capability-parity.ts  # V2A-bash-capability-parity
│       │   │   │   ├── bash-platform-stress.ts    # V2B-bash-platform-stress
│       │   │   │   └── bash-curl-quota.ts         # V2-bash-curl-quota
│       │   │   └── result-shape.ts
│       │   └── scripts/{deploy,run-all-probes,extract-finding}.{sh,ts}
│       └── spike-binding-pair/                      # Phase 3 新建
│           ├── README.md
│           ├── worker-a/
│           │   ├── wrangler.jsonc                  # services: WORKER_B
│           │   ├── package.json
│           │   └── src/{worker.ts, probes/{latency-cancellation,cross-seam-anchor,hooks-callback,eval-fanin}.ts, result-shape.ts}
│           └── worker-b/
│               ├── wrangler.jsonc
│               ├── package.json
│               └── src/{worker.ts, handlers/{echo,slow,header-dump,hook-dispatch,eval-emit}.ts}
│           └── scripts/{deploy-both,run-all-probes,extract-finding}.{sh,ts}
│
├── docs/spikes/                                     # Phase 4-5 新建
│   ├── spike-do-storage/                            # Tier 1 per-finding (Phase 4)
│   │   ├── 01-{slug}.md
│   │   ├── 02-{slug}.md
│   │   └── ...
│   ├── spike-binding-pair/                          # Tier 1 per-finding (Phase 4)
│   │   ├── 01-{slug}.md
│   │   └── ...
│   ├── unexpected/                                  # optional findings
│   │   └── ...
│   ├── storage-findings.md                          # Tier 2 rollup (Phase 5)
│   ├── binding-findings.md                          # Tier 2 rollup (Phase 5)
│   └── fake-bash-platform-findings.md               # Tier 2 rollup (Phase 5)
│
└── docs/templates/
    └── _TEMPLATE-spike-finding.md                   # 已 ship；本 action-plan 仅引用
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 创建 2 个 spike 的目录骨架（`spikes/round-1-bare-metal/spike-do-storage/` + `spikes/round-1-bare-metal/spike-binding-pair/`）
- **[S2]** 部署 `spike-do-storage` 单 worker 到真实 Cloudflare 环境（含 R2 + KV + D1 + DO bindings）
- **[S3]** 部署 `spike-binding-pair` 双 worker 到真实 Cloudflare 环境（worker-a 与 worker-b 通过 service binding 通讯）
- **[S4]** 实现 9 个 storage/bash probe handler（含 V2 拆分后的 V2A capability-parity + V2B platform-stress + V2-curl-quota）
- **[S5]** 实现 4 个 binding probe handler（V3-binding-* 4 项），**仅覆盖 fetch-based seam**，明确排除 RPC `handleNacp` transport
- **[S6]** 跑通 `run-all-probes.sh` 并产出原始结果 `.out/YYYY-MM-DD.json`
- **[S7]** 撰写 13 条 required per-finding doc + N 条 optional `unexpected-F*` per-finding doc，全部使用 `docs/templates/_TEMPLATE-spike-finding.md`
- **[S8]** 撰写 3 份 rollup index doc：`storage-findings.md` / `binding-findings.md` / `fake-bash-platform-findings.md`
- **[S9]** 为至少 1 条 finding 创建 packages/ writeback issue（forward traceability evidence）
- **[S10]** 完成 7 条 spike 纪律 self-check 报告

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** Round 2 integrated spike（属于 B7 action plan）
- **[O2]** packages/ 内任何代码修改（writeback 实施属于 B2-B6）
- **[O3]** RPC `handleNacp` transport 验证（不在本 spike scope；如需要应单列 `spike-rpc-transport`）
- **[O4]** 把 spike code promote 到 `packages/`（违反纪律 1）
- **[O5]** spike 接生产 LLM API key / 真实业务数据（违反纪律 5）
- **[O6]** spike 接 CI 主链或 PR-blocking pipeline（违反纪律 3）
- **[O7]** Inspector / observability dashboard for spike（spike 用 manual probe + finding doc，不需要 dashboard）
- **[O8]** NACP 1.2.0 协议升级 / context-management 新包 / hooks catalog 扩展（这些是 B5/B6/B4 的范围）

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|---|---|---|---|
| 2 个 spike 同时立项 | `in-scope` | charter §4.1 A 第 1-2 项明确要求 | Phase 0 closure 时 |
| RPC handleNacp 验证 | `out-of-scope` | GPT review §2.3：避免 partial truth 被误读为 repo-wide truth | 如果 worker matrix 阶段需要 RPC transport 真相，单独立项 spike-rpc-transport |
| spike 进 CI | `out-of-scope` | 纪律 3：spike 失败不应阻塞主线 | spike 销毁时 |
| spike 实现新业务能力 | `out-of-scope` | 纪律 5：disposable 语义要求对销毁不敏感 | 不重评 |
| Round 2 integrated | `defer` | 本 action plan 仅覆盖 Round 1；Round 2 见 B7 | B7 起草时 |
| packages/ writeback 实施 | `defer` | 本 action plan 只创建 issue；实际 ship 在 B2-B6 | B2-B6 起草时 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | 创建 spike 顶级目录结构 + README | add | `spikes/`, `spikes/round-1-bare-metal/{spike-do-storage,spike-binding-pair}/README.md` | spike 物理目录就位 | low |
| P1-02 | Phase 1 | 验证 finding 模板路径与 charter 对齐 | check | `docs/templates/_TEMPLATE-spike-finding.md` + `docs/plan-after-foundations.md` §14 | 模板路径唯一性确认 | low |
| P1-03 | Phase 1 | spike-do-storage wrangler.jsonc + package.json 骨架 | add | `spikes/round-1-bare-metal/spike-do-storage/{wrangler.jsonc,package.json}` | wrangler deploy 可调用（即使 worker.ts 仅返回 healthz） | medium |
| P1-04 | Phase 1 | spike-binding-pair worker-a + worker-b 骨架（无 probe 实现） | add | `spikes/round-1-bare-metal/spike-binding-pair/{worker-a,worker-b}/{wrangler.jsonc,package.json,src/worker.ts}` | 双 worker 都可 deploy；service binding 配置正确 | medium |
| P2-01 | Phase 2 | spike-do-storage 单 worker 真实部署 | deploy | wrangler deploy | spike worker URL 可从外网访问；`/healthz` 返回 200 | medium |
| P2-02 | Phase 2 | 实现 6 个 storage probe handler (V1) | add | `spikes/.../spike-do-storage/src/probes/{r2-multipart,r2-list-cursor,kv-stale-read,do-transactional,mem-vs-do,d1-transaction}.ts` + `do/ProbeDO.ts` + `result-shape.ts` | 6 个 storage probe endpoint 全部可调用并返回结构化结果 | medium |
| P2-03 | Phase 2 | 实现 V2A capability-parity probe（对齐 filesystem.ts 真实 contract） | add | `spikes/.../spike-do-storage/src/probes/bash-capability-parity.ts` | 验证 mkdir partial-no-directory-entity / `/_platform/**` reserved / rg cap 真实行为 | medium |
| P2-04 | Phase 2 | 实现 V2B platform-stress probe（runtime 边界） | add | `spikes/.../spike-do-storage/src/probes/bash-platform-stress.ts` | 测出 DO memory / cpu_ms / subrequest 上限 | medium |
| P2-05 | Phase 2 | 实现 V2-bash-curl-quota probe | add | `spikes/.../spike-do-storage/src/probes/bash-curl-quota.ts` | 测出单 turn 最大 outbound subrequest + payload 上限 | medium |
| P2-06 | Phase 2 | 实现 `run-all-probes.sh` + `extract-finding.ts` | add | `spikes/.../spike-do-storage/scripts/{run-all-probes.sh,extract-finding.ts}` | 一键跑 9 routes 并生成 finding draft | low |
| P3-01 | Phase 3 | spike-binding-pair worker-b 真实部署 | deploy | wrangler deploy worker-b | worker-b URL 可访问 | medium |
| P3-02 | Phase 3 | spike-binding-pair worker-a 真实部署（依赖 worker-b service） | deploy | wrangler deploy worker-a | worker-a URL 可访问；service binding 真实通讯 | medium |
| P3-03 | Phase 3 | 实现 4 个 binding probe handler + 5 个 worker-b handler | add | `spikes/.../spike-binding-pair/{worker-a,worker-b}/src/...` | 4 binding probe endpoint 全部可调用并返回结构化结果；包含显式 transport scope 注释（fetch-based only） | medium |
| P3-04 | Phase 3 | 实现 deploy-both.sh + run-all-probes.sh | add | `spikes/.../spike-binding-pair/scripts/...` | 一键部署双 worker（强制顺序）+ 一键跑 4 probe | low |
| P4-01 | Phase 4 | 撰写 9 条 spike-do-storage required per-finding doc | add | `docs/spikes/spike-do-storage/{01..09}-{slug}.md` | 每条 finding 有 §3 Package Impact + §5 Writeback Action | high |
| P4-02 | Phase 4 | 撰写 4 条 spike-binding-pair required per-finding doc | add | `docs/spikes/spike-binding-pair/{01..04}-{slug}.md` | 同上 | high |
| P4-03 | Phase 4 | 撰写 N 条 optional `unexpected-F*` per-finding doc | add | `docs/spikes/unexpected/{NN}-{slug}.md` | optional findings 经过模板流程 | low |
| P5-01 | Phase 5 | 撰写 `docs/spikes/storage-findings.md` rollup | add | `docs/spikes/storage-findings.md` | 含 finding index + severity + writeback map + dismissed | medium |
| P5-02 | Phase 5 | 撰写 `docs/spikes/binding-findings.md` rollup（显式 transport scope = fetch-only） | add | `docs/spikes/binding-findings.md` | 同上 + 显式声明 RPC transport not covered | medium |
| P5-03 | Phase 5 | 撰写 `docs/spikes/fake-bash-platform-findings.md` rollup | add | `docs/spikes/fake-bash-platform-findings.md` | 同 P5-01 + 区分 V2A capability-parity 与 V2B platform-stress 的 writeback 目标 | medium |
| P6-01 | Phase 6 | 7 条 spike 纪律 self-check 报告 | add | `docs/spikes/_DISCIPLINE-CHECK.md` | 7 条全部 ✅ 或带 explanation | low |
| P6-02 | Phase 6 | 为至少 1 条 finding 创建 packages/ writeback issue | add | `docs/issue/after-foundations/{slug}.md` markdown SOT（业主决策：不用 GitHub Issue）；reference 在 rollup 中 | forward traceability evidence | low |
| P6-03 | Phase 6 | B2/B3/B4 输入交接 | doc | 在 rollup 中明确指向 B2/B3 等 action plan | 下游 action plan 起草时不再追问 finding | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Spike 壳与 finding 模板就位

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | 创建顶级目录 + README | `mkdir -p spikes/round-1-bare-metal/{spike-do-storage,spike-binding-pair}`；写两个 README 描述 spike 名字 / expiration / 7 纪律 reference | `spikes/`, `spikes/round-1-bare-metal/*/README.md` | 目录与 README 已 commit | 手动 ls + 文件检视 | README 含 expiration 2026-08-01 + 纪律 reference link |
| P1-02 | 模板路径对齐核查 | 确认 `docs/templates/_TEMPLATE-spike-finding.md` 存在；确认 charter §14 已统一指向该路径；如有 `docs/spikes/_TEMPLATE-finding.md` 残留，删除 | `docs/templates/_TEMPLATE-spike-finding.md`, `docs/plan-after-foundations.md` §14 | 模板路径全 repo 唯一 | grep 模板路径在所有 .md 中的引用 | grep 仅返回 `docs/templates/_TEMPLATE-spike-finding.md` 一种路径 |
| P1-03 | spike-do-storage wrangler 骨架 | 写 wrangler.jsonc（DO_PROBE / KV_PROBE / R2_PROBE / D1_PROBE 4 binding + EXPIRATION_DATE var）；写 package.json（type:module，devDep `@cloudflare/workers-types`）；写 worker.ts 仅返回 `/healthz` 200 | spike-do-storage wrangler.jsonc + package.json + src/worker.ts | wrangler deploy 不报 binding 缺失 | `wrangler deploy --dry-run` | dry-run 无 error |
| P1-04 | spike-binding-pair worker-a/b 骨架 | 同 P1-03；worker-a 含 services WORKER_B；worker-b 不含 service binding；两个 worker.ts 仅返回 `/healthz` 200 | spike-binding-pair/{worker-a,worker-b}/{wrangler.jsonc,package.json,src/worker.ts} | 两个 worker dry-run 通过 | `wrangler deploy --dry-run` × 2 | dry-run 无 error；worker-a 的 services 字段引用 worker-b 名字 |

### 4.2 Phase 2 — spike-do-storage 部署与 probe 实现

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | spike-do-storage 真实部署 | `wrangler deploy`；获取真实 URL；验证 `/healthz` 200；初始化 KV / R2 / D1 namespace（spike-only） | wrangler config + spike namespace | URL 可从外网访问 | curl `/healthz` | curl 返回 200 + JSON `{ ok: true, env: "spike-r1-bare-metal" }` |
| P2-02 | 实现 6 storage probes | 按 P0-spike-do-storage-design §4.1-4.6 实现：每个 probe 接受 JSON params、调用对应 binding、返回 `ProbeResult` shape | `src/probes/{6 files}.ts` + `do/ProbeDO.ts` + `result-shape.ts` | 6 个 endpoint 可调用 | curl 每个 endpoint with sample payload | 每个返回结构化 JSON 含 `observations` + `timings` + `errors` |
| P2-03 | V2A capability-parity probe | 严格按 `packages/capability-runtime/src/capabilities/filesystem.ts` 的真实 handler contract 设计 probe；测试 mkdir 是否真实返回 `MKDIR_PARTIAL_NOTE`、`/_platform/**` 是否被拒绝、rg cap 是否触发 | `src/probes/bash-capability-parity.ts` | probe 验证 capability handler contract 在真实 DO 沙箱里成立 | curl with sample workspace ops | 至少 1 个 capability contract 行为被记录（成立或不成立都可） |
| P2-04 | V2B platform-stress probe | 跑 memory/cpu/subrequest 上限测试；发现真实数字 | `src/probes/bash-platform-stress.ts` | 测出实际边界数字 | curl with escalating params | 至少 1 个 platform 边界被记录 |
| P2-05 | V2-bash-curl-quota probe | curl outbound 测试 N=10/50/100/500 | `src/probes/bash-curl-quota.ts` | 测出单 turn subrequest 上限 | curl + 观察 wrangler tail | 上限数字被记录 |
| P2-06 | run-all-probes.sh + extract-finding.ts | shell script 顺次调用 9 个 probe；TS script 把 `.out/*.json` 转成 finding draft | `scripts/run-all-probes.sh` + `scripts/extract-finding.ts` | 一键执行 + 一键生成 draft | `bash scripts/run-all-probes.sh` | 输出 `.out/YYYY-MM-DD.json` 含 9 条 ProbeResult |

### 4.3 Phase 3 — spike-binding-pair 部署与 probe 实现

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | worker-b 部署 | `cd worker-b && wrangler deploy`；验证 `/healthz` | spike-binding-pair/worker-b/* | URL 可访问 | curl /healthz | 200 OK |
| P3-02 | worker-a 部署 | `cd worker-a && wrangler deploy`；验证 `/healthz` + service binding 配置 | spike-binding-pair/worker-a/* | URL 可访问且能调 worker-b | curl /healthz + 触发一次最简 probe call | worker-a 能跨 binding 调 worker-b 并返回成功 |
| P3-03 | 4 binding probes + 5 worker-b handlers | 实现 V3-binding-latency-cancellation / cross-seam-anchor / hooks-callback / eval-fanin；worker-b 实现 echo / slow / header-dump / hook-dispatch / eval-emit | spike-binding-pair/{worker-a,worker-b}/src/... | 4 个 endpoint 可调用 | curl 每个 probe 路由 with sample params | 每个返回 `BindingProbeResult` 含 transport scope 注释（fetch-based only） |
| P3-04 | deploy-both.sh + run-all-probes.sh | deploy script 强制 worker-b 先 deploy；run script 顺次调 4 probe | scripts/{deploy-both.sh, run-all-probes.sh} | 部署顺序受控；4 probe 可一键跑 | `bash scripts/deploy-both.sh` 然后 `run-all-probes.sh` | `.out/YYYY-MM-DD.json` 含 4 条 BindingProbeResult |

### 4.4 Phase 4 — Per-finding doc 撰写

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | 9 条 spike-do-storage required per-finding | 跑 extract-finding.ts 生成 9 个 draft；人工补全 §2 root cause + §3 package impact + §4 worker-matrix impact + §5 writeback action | `docs/spikes/spike-do-storage/{01..09}-{slug}.md` | 9 个 finding doc 全部含 5 段必填 | review checklist | 每个 finding 有明确的 packages/ 文件引用 + writeback target phase |
| P4-02 | 4 条 spike-binding-pair required per-finding | 同上，但 4 个；rollup 提示 transport scope = fetch-based only | `docs/spikes/spike-binding-pair/{01..04}-{slug}.md` | 同上 | review checklist | 同上 |
| P4-03 | optional unexpected-F* per-finding | 跑 spike 时如发现 matrix 之外的真相，按相同模板 ship | `docs/spikes/unexpected/{NN}-{slug}.md` | 0 或多条 | review checklist | 每条经过模板流程；不强制数量 |

### 4.5 Phase 5 — Rollup index doc 撰写

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | storage-findings.md rollup | 索引 V1-storage-* 6 项 finding；按 §4.6 5 段结构（finding index / severity summary / writeback destination map / dismissed / per-finding links） | `docs/spikes/storage-findings.md` | rollup ship | 所有 6 finding 都被 index | 5 段全部完整 |
| P5-02 | binding-findings.md rollup | 索引 V3-binding-* 4 项 finding；**显式声明** transport scope = fetch-based only；handleNacp RPC out-of-scope | `docs/spikes/binding-findings.md` | rollup ship | 4 finding 全 index + transport scope 声明 | 5 段全部完整 + transport scope disclaimer |
| P5-03 | fake-bash-platform-findings.md rollup | 索引 V2A + V2B + V2-curl-quota 3 项 finding；区分 capability-parity writeback 目标（→ packages/capability-runtime/src/capabilities/） vs platform-stress writeback 目标（→ Phase 2/3 budget policy） | `docs/spikes/fake-bash-platform-findings.md` | rollup ship | 3 finding 全 index + writeback 区分 | 5 段全部完整 |

### 4.6 Phase 6 — Spike 纪律自检与 handoff

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P6-01 | 7 条 spike 纪律 self-check | 按 P0-spike-discipline §3.1-3.7 逐条检查；填表说明每条是否满足 + evidence | `docs/spikes/_DISCIPLINE-CHECK.md` | 7 条 ✅ | self-review | 7 条全部 ✅ 或带显式 explanation |
| P6-02 | packages/ writeback issue 创建 | 至少为 1 条 finding 创建 issue（forward traceability evidence）；issue 链接 back to per-finding doc | **`docs/issue/after-foundations/{slug}.md`** markdown SOT（业主决策：不用 GitHub Issue） | 1+ issue 文件创建 | check `docs/issue/after-foundations/` 内文件 | issue 含 finding ID + 目标 packages/ 文件 + 目标 phase (B2/B3/B4) |
| P6-03 | B2/B3/B4 输入交接 | 在 rollup 中显式标注 "writeback to B2 / B3 / B4 / B5 / B6"；交接给 B2 起草 | rollup docs + B2 起草 | B2 起草不再追问 finding | review B2 草稿 | B2 起草引用至少 1 个 finding ID |

---

## 5. Phase 详情

### 5.1 Phase 1 — Spike 壳与 finding 模板就位

- **Phase 目标**：让 spike 物理基础设施 + 模板路径全部对齐 P0 design，给 implementer 一个 zero-ambiguity 的起点
- **本 Phase 对应编号**：P1-01 / P1-02 / P1-03 / P1-04
- **本 Phase 新增文件**：
  - `spikes/round-1-bare-metal/spike-do-storage/{wrangler.jsonc, package.json, src/worker.ts}` + README
  - `spikes/round-1-bare-metal/spike-binding-pair/{worker-a, worker-b}/{wrangler.jsonc, package.json, src/worker.ts}` + README
  - `spikes/README.md`（顶级）
- **本 Phase 修改文件**：（如 P1-02 发现 `docs/spikes/_TEMPLATE-finding.md` 残留）删除该残留路径
- **具体功能预期**：
  1. `wrangler deploy --dry-run` 在两个 spike 都通过
  2. 模板路径全 repo 唯一 (`docs/templates/_TEMPLATE-spike-finding.md`)
  3. 两个 spike 的 README 含 `EXPIRATION_DATE = 2026-08-01` + 纪律 reference link
- **具体测试安排**：
  - **手动验证**：`wrangler deploy --dry-run`（× 3 次：do-storage / binding-pair-a / binding-pair-b）
  - **grep 验证**：`grep -rn "_TEMPLATE-finding\|_TEMPLATE-spike-finding" docs/` 仅返回 `docs/templates/_TEMPLATE-spike-finding.md` 一种路径
- **收口标准**：
  - 所有 dry-run 通过
  - grep 模板路径仅 1 种结果
  - README 含 expiration + 纪律 reference
- **本 Phase 风险提醒**：
  - wrangler.jsonc binding 配置错误会延迟 P2/P3 真实部署 —— 务必先 dry-run
  - 模板路径如未统一，下游 phase 会出现 partial finding（用错模板）

### 5.2 Phase 2 — spike-do-storage 部署与 probe 实现

- **Phase 目标**：单 worker 真实部署 + 9 个 probe endpoint 全部跑通；产出 `.out/YYYY-MM-DD.json`
- **本 Phase 对应编号**：P2-01 / P2-02 / P2-03 / P2-04 / P2-05 / P2-06
- **本 Phase 新增文件**：
  - `spikes/round-1-bare-metal/spike-do-storage/src/do/ProbeDO.ts`
  - `spikes/round-1-bare-metal/spike-do-storage/src/probes/*.ts` （9 个 probe handler）
  - `spikes/round-1-bare-metal/spike-do-storage/src/result-shape.ts`
  - `spikes/round-1-bare-metal/spike-do-storage/scripts/{deploy.sh, run-all-probes.sh, extract-finding.ts}`
- **本 Phase 修改文件**：`src/worker.ts`（从 healthz-only 升级到 9 routes）
- **具体功能预期**：
  1. spike worker URL 可从外网访问（curl 测试通过）
  2. 9 个 probe endpoint 每个能接受 JSON params + 返回结构化 ProbeResult
  3. V2A 严格对齐 `filesystem.ts:53` 的 `MKDIR_PARTIAL_NOTE` 与 `/_platform/**` reserved namespace
  4. V2B 测出 DO memory / cpu_ms / subrequest 真实数字
  5. run-all-probes.sh 一键跑 9 routes 并写入 `.out/`
- **具体测试安排**：
  - **手动验证**：每个 probe endpoint curl 一次 with sample payload；wrangler tail 观察日志
  - **集成测试**：`bash scripts/run-all-probes.sh` 必须无 fail；输出 JSON 含 9 条 ProbeResult
  - **回归测试**：spike 不接 CI（纪律 3）；本 Phase 无回归
- **收口标准**：
  - spike worker URL 可外网访问
  - 9 个 probe endpoint 全部返回 200 + 结构化 JSON
  - `.out/YYYY-MM-DD.json` 含 9 条 ProbeResult
  - V2A probe 显式记录 mkdir partial note 行为是否成立
- **本 Phase 风险提醒**：
  - V2A 如果直接套 v1 的 "mkdir -p a/b/c/d/e" stress 写法，会失去 capability-parity 价值——必须按 `filesystem.ts` 真实 handler contract 设计
  - V2B platform-stress 可能在某档触发 OOM 或 cpu_ms 上限——这本身是 finding，不是失败
  - DO storage transactional 测试 abort 路径要小心，不要污染下次 probe 的 state

### 5.3 Phase 3 — spike-binding-pair 部署与 probe 实现

- **Phase 目标**：双 worker 部署 + 4 binding probe 跑通；显式声明 transport scope = fetch-based only
- **本 Phase 对应编号**：P3-01 / P3-02 / P3-03 / P3-04
- **本 Phase 新增文件**：
  - `spikes/round-1-bare-metal/spike-binding-pair/worker-a/src/{probes/*.ts, result-shape.ts}` （4 probe）
  - `spikes/round-1-bare-metal/spike-binding-pair/worker-b/src/handlers/*.ts` （5 handler）
  - `spikes/round-1-bare-metal/spike-binding-pair/scripts/{deploy-both.sh, run-all-probes.sh, extract-finding.ts}`
- **本 Phase 修改文件**：worker-a / worker-b 的 `src/worker.ts`（升级 routes）
- **具体功能预期**：
  1. worker-b 先部署，URL 可访问
  2. worker-a 后部署，service binding 配置正确，能跨 binding 调 worker-b
  3. 4 个 probe endpoint 全部跑通（V3-binding-latency-cancellation / cross-seam-anchor / hooks-callback / eval-fanin）
  4. 5 个 worker-b handler 全部就位（echo / slow / header-dump / hook-dispatch / eval-emit）
  5. **每个 probe handler 含显式注释**："本 probe 仅验证 fetch-based seam；handleNacp RPC transport not in scope"
  6. deploy-both.sh 强制 worker-b 先 deploy
- **具体测试安排**：
  - **手动验证**：curl 每个 probe + 观察两个 worker 的 wrangler tail
  - **集成测试**：`bash scripts/deploy-both.sh` + `bash scripts/run-all-probes.sh` 全成功
- **收口标准**：
  - 两个 worker URL 可外网访问
  - 4 binding probe 全返回 BindingProbeResult
  - 至少 1 个 probe 验证 5 个 cross-seam anchor header 的传播
  - 至少 1 个 probe 测试 cancellation 真实行为
- **本 Phase 风险提醒**：
  - 部署顺序错误（worker-a 先于 worker-b）会导致 service binding reference fail —— deploy-both.sh 必须 enforce 顺序
  - cross-seam anchor header 大小写归一化可能与代码假设不一致，要保留原始 header dump
  - cancellation probe 必须用真实 abort signal，不能用 sleep + 不读响应

### 5.4 Phase 4 — Per-finding doc 撰写

- **Phase 目标**：把 13 条 required finding（9 storage/bash + 4 binding）+ 任意 optional findings 全部写成符合模板的独立文档
- **本 Phase 对应编号**：P4-01 / P4-02 / P4-03
- **本 Phase 新增文件**：
  - `docs/spikes/spike-do-storage/{01..09}-{slug}.md` （9 条 required）
  - `docs/spikes/spike-binding-pair/{01..04}-{slug}.md` （4 条 required）
  - `docs/spikes/unexpected/{NN}-{slug}.md` （optional）
- **本 Phase 修改文件**：（无）
- **具体功能预期**：
  1. 13 条 required finding 全部使用 `docs/templates/_TEMPLATE-spike-finding.md` 模板的 8 段结构
  2. 每条 finding 的 §3 Package Impact 必须显式列出受影响 packages/ 文件路径与行号
  3. 每条 finding 的 §5 Writeback Action 必须显式列出 target phase (B2/B3/B4/B5/B6) 与 owner
  4. 每条 finding 的 §0 status 至少落入 `open` 或 `writeback-in-progress`（Phase 6 才能转 `writeback-shipped`/`dismissed`）
- **具体测试安排**：
  - **review checklist**：每条 finding 检查 8 段是否齐全 + §3/§4/§5 是否非空
  - **手动验证**：spot-check 抽样 3 条 finding 与 `_TEMPLATE` 字段对齐
- **收口标准**：
  - 13 条 required finding 全 ship
  - 每条 finding 8 段齐全
  - 每条 finding §3 Package Impact 非空
  - 每条 finding §5 Writeback Action 非空
- **本 Phase 风险提醒**：
  - finding 写得太抽象会让 B2-B6 implementer 看不懂如何 writeback —— 必须含具体文件路径与行号
  - optional `unexpected-F*` 不强制数量但出现的必须经过模板流程，避免成为 informal note

### 5.5 Phase 5 — Rollup index doc 撰写

- **Phase 目标**：按 charter §4.1 A 第 4 项交付 3 份 rollup index doc
- **本 Phase 对应编号**：P5-01 / P5-02 / P5-03
- **本 Phase 新增文件**：
  - `docs/spikes/storage-findings.md`
  - `docs/spikes/binding-findings.md`
  - `docs/spikes/fake-bash-platform-findings.md`
- **本 Phase 修改文件**：（无）
- **具体功能预期**：
  1. 每份 rollup 含 §1 Finding index + §2 Severity summary + §3 Writeback destination map + §4 Unresolved/dismissed summary + §5 Per-finding doc links 5 段
  2. `binding-findings.md` 必须显式声明 transport scope = fetch-based only；handleNacp RPC NOT covered
  3. `fake-bash-platform-findings.md` 必须区分 V2A capability-parity writeback（→ packages/capability-runtime/src/capabilities/）vs V2B platform-stress writeback（→ Phase 2 quota guard / Phase 3 budget policy）
- **具体测试安排**：
  - **手动验证**：每份 rollup 与对应 per-finding 的链接全部可点
  - **review**：3 份 rollup 互相之间无重复 finding（每条 finding 只在 1 份 rollup 中出现）
- **收口标准**：
  - 3 份 rollup 全 ship
  - 每份 5 段齐全
  - binding-findings.md 含 transport scope disclaimer
  - fake-bash-platform-findings.md 含 V2A/V2B writeback 区分
- **本 Phase 风险提醒**：
  - rollup 容易写成 per-finding 的 copy-paste —— 必须严格保持索引/总结性质
  - 如未显式声明 transport scope，下游会误读为 "service binding 全验证"

### 5.6 Phase 6 — Spike 纪律自检与 handoff

- **Phase 目标**：纪律 self-check + writeback issue + B2/B3/B4 输入交接
- **本 Phase 对应编号**：P6-01 / P6-02 / P6-03
- **本 Phase 新增文件**：
  - `docs/spikes/_DISCIPLINE-CHECK.md`
- **本 Phase 修改文件**：3 份 rollup（增加 "next phase handoff" 段）；GitHub issue / TODO list
- **具体功能预期**：
  1. _DISCIPLINE-CHECK.md 含 7 条纪律的逐条 ✅/❌ 与 evidence
  2. 至少 1 条 finding 已创建 packages/ writeback issue（forward traceability evidence）；issue 写入 **`docs/issue/after-foundations/{slug}.md`**（不用 GitHub Issue tracker）
  3. B2 起草时能直接引用本 action plan 的 finding ID
- **具体测试安排**：
  - **手动验证**：_DISCIPLINE-CHECK.md 7 条逐项 review
  - **回归校验**：spike 是否仍然在 `spikes/` 顶级（纪律 1 仍成立）；spike 仍带 EXPIRATION_DATE（纪律 2）；spike 仍未进 CI（纪律 3）
- **收口标准**：
  - 7 条纪律全 ✅ 或带 explanation
  - 至少 1 个 packages/ writeback issue 存在
  - B2 起草已引用至少 1 个 finding ID
- **本 Phase 风险提醒**：
  - 如纪律 4 (finding 必须落 doc) 被违反，spike 销毁后 truth 即丢失 —— 销毁前必须 _DISCIPLINE-CHECK 通过

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1

- **影响范围**：Phase 2 + Phase 3
- **为什么必须确认**：spike 部署需要真实 Cloudflare account；不同 account 的 R2 / KV / D1 free tier 配额不同，可能影响 V2B platform-stress 的边界数字
- **当前建议 / 倾向**：用与 production **完全独立**的 spike account；如果业主只有一个 account，spike namespace 名字必须显式 `spike-` 前缀以隔离
- **Q**：spike 用哪个 Cloudflare account？是新建独立 account，还是复用现有 account 的 spike namespace？
- **A**：见 docs/action-plan/after-foundations/B1-spike-cf-credentials.md 回答。

#### Q2

- **影响范围**：Phase 2 V2-bash-curl-quota
- **为什么必须确认**：curl outbound 需要 target URL；用 `https://example.com` 安全但无法测大 payload；用 `https://httpbin.org` 可测但有第三方依赖
- **当前建议 / 倾向**：默认用 `https://httpbin.org`；如有内部 echo service 更好
- **Q**：spike curl probe 的 outbound target URL 用哪个？
- **A**：见 docs/action-plan/after-foundations/B1-spike-cf-credentials.md 回答。

#### Q3

- **影响范围**：Phase 4 finding writeback target
- **为什么必须确认**：finding 的 §5 Writeback Action 需要明确目标 phase；如果 writeback 全部指向 B2/B3，那 B4-B6 的 spike 输入会偏少
- **当前建议 / 倾向**：finding 按其性质自然分布；不强制每个 phase 都有 finding writeback；不平衡时在 rollup §3 Writeback destination map 中显式说明
- **Q**：是否要求 finding writeback 在 B2-B6 之间"分布平均"？
- **A**：请按照你的建议执行。

#### Q4

- **影响范围**：Phase 6 P6-02 writeback issue 创建
- **为什么必须确认**：业主可能用 GitHub issue / Linear / Notion / 其他 tracker；不同 tracker 的 issue 创建方式与 link 格式不同
- **当前建议 / 倾向**：用 repo 内的 GitHub issue（与 nano-agent repo 一致）；如业主有其他 tracker 偏好，调整即可
- **Q**：writeback issue 创建在哪个 tracker？
- **A**：如果 Issue 可以在 CLI 中直接提交，则同意你的建议。如果不能在 CLI 中直接执行，则在本地 docs/ 下建立 issue/ 文件夹，并使用 markdown 文件进行跟踪
- **A (业主补充 2026-04-19)**：**最终决策——不使用 GitHub Issue tracker**。理由：避免双真相层（GitHub UI vs repo docs）。所有 issue 改为 `docs/issue/{phase}/{slug}.md` markdown 文件。policy 见 `docs/issue/README.md`。已创建过的 GitHub issue（#1）已 close 并指向 docs。

#### Q5

- **影响范围**：Phase 0 closure 时的销毁条件评估
- **为什么必须确认**：spike 默认 expiration `2026-08-01`，但如果 Phase 6 integrated spike (B7) 还没启动，可能需要 extend
- **当前建议 / 倾向**：保持 2026-08-01；如 B7 推迟，在 charter 修订时同步 extend
- **Q**：spike 是否在 B1 closure 后立即销毁，还是保留到 B7 闭合？
- **A**：spike worker 可以一直保留，可以由业主进行自主销毁。

### 6.2 问题整理建议

- 优先问 **会直接改变实现路径** 的问题（Q1 / Q4）
- 优先问 **影响多个 Phase** 的问题（Q1 / Q3）
- 不把"实现时自然可确定"的细节也塞进待确认项（如 specific blob seed）
- 每个问题都给出 **当前建议答案**，方便业主决策

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|---|---|---|---|
| Cloudflare account 限额 | spike 可能触发 free-tier 限额（特别是 V2B platform-stress） | medium | 用独立 spike account；V2B finding 中显式记录限额数字 |
| Spike 偷跑成 product | spike 容易被加业务功能而违反纪律 5 | medium | _DISCIPLINE-CHECK.md 强制 review；7 条纪律每个 Phase 都重申 |
| RPC transport 误读 | binding-pair finding 可能被下游误读为 "service binding 全验证" | medium | binding-findings.md rollup 显式声明 transport scope = fetch only |
| V2 capability-parity 写偏 | implementer 可能把 V2A 写成 stress test | high | P0-spike-do-storage-design r2 §4.7 给出明确的 capability handler 引用；review 时严格对照 |
| Finding 写得太抽象 | finding §3 Package Impact 不含具体行号会让 writeback 困难 | medium | finding template 强制要求 §3 含文件路径 + 行号；P4 review 严查 |
| extract-finding.ts 自动化偏弱 | 自动从 ProbeResult 生成 draft 可能漏掉 root cause | low | 接受 draft 是初稿；人工补全是必经步骤 |

### 7.2 约束与前提

- **技术前提**：
  - Cloudflare account with R2 / KV / D1 / DO bindings 可用
  - wrangler CLI 已安装并 authenticate
  - spike namespace 与 production 完全独立
- **运行时前提**：
  - spike URL 在公网可访问（用于 manual curl）
  - wrangler tail 可观察 spike 日志
  - 不接 LLM API key
- **组织协作前提**：
  - finding 撰写需要熟悉 packages/ 实际代码（特别是 capability-runtime / storage-topology / session-do-runtime）
  - rollup 撰写需要熟悉 charter §11 exit criteria
- **上线 / 合并前提**：
  - spike 不进 PR-blocking pipeline
  - per-finding 与 rollup 进 nano-agent main repo（commit）
  - spike 代码可单独 PR 但不阻塞主线

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` —— 如 spike 实施暴露纪律不足，回填修订
  - `docs/design/after-foundations/P0-spike-do-storage-design.md` —— 如 probe 设计实施时调整，回填
  - `docs/design/after-foundations/P0-spike-binding-pair-design.md` —— 同上
- 需要同步更新的说明文档 / README：
  - `spikes/README.md` —— 顶级目录索引
  - 两个 spike 各自的 README —— 含 expiration + 纪律 link
- 需要同步更新的测试说明：
  - 本 action plan 不接 CI；无主线测试同步要求
  - 但 finding 中提到的"对 packages/ 的 contract test 影响"必须在对应 finding §3 中明确

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - 两个 spike 的 wrangler URL 在公网可访问
  - 9 + 4 = 13 个 probe endpoint 全返回 200 + 结构化 JSON
- **单元测试**：（spike 不写单元测试，纪律 3）
- **集成测试**：
  - `bash spike-do-storage/scripts/run-all-probes.sh` 全成功
  - `bash spike-binding-pair/scripts/run-all-probes.sh` 全成功
- **端到端 / 手动验证**：
  - 13 条 required finding doc 与 3 份 rollup 互相 link 一致
  - per-finding §3 Package Impact 引用的文件路径与行号真实存在
- **回归测试**：（spike 不接 CI，纪律 3；本 action plan 无回归测试要求）
- **文档校验**：
  - `grep -rn "_TEMPLATE-finding\|_TEMPLATE-spike-finding" docs/` 仅返回 `docs/templates/_TEMPLATE-spike-finding.md` 一种路径
  - rollup 5 段每段非空
  - binding-findings.md 含 transport scope disclaimer

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. 2 个 spike worker（spike-do-storage + spike-binding-pair worker-a/b）真实部署到 Cloudflare 并 URL 可访问
2. 13 条 required per-finding doc 已 ship（9 storage/bash + 4 binding），全部使用 `docs/templates/_TEMPLATE-spike-finding.md` 模板
3. 3 份 rollup index doc 已 ship（`storage-findings.md` / `binding-findings.md` / `fake-bash-platform-findings.md`）
4. 至少 1 条 finding 已创建 packages/ writeback issue（forward traceability evidence）
5. `_DISCIPLINE-CHECK.md` 7 条全 ✅
6. `binding-findings.md` 显式声明 transport scope = fetch-based only
7. `fake-bash-platform-findings.md` 区分 V2A capability-parity vs V2B platform-stress writeback 目标
8. 至少 1 条 finding 触发 packages/ 文件修改 issue（不要求本 action plan 实施 ship）

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | 2 个 spike worker 真实部署 + 13 条 required probe 全部 callable |
| 测试 | 2 份 run-all-probes.sh 全成功；`.out/` 含 13 条 ProbeResult |
| 文档 | 13 条 per-finding + 3 份 rollup + 1 份 _DISCIPLINE-CHECK 全 ship |
| 风险收敛 | 7 条 spike 纪律全 ✅；transport scope disclaimer 在 rollup 中显式 |
| 可交付性 | 至少 1 条 finding writeback issue 存在；B2 起草可直接引用 finding ID |

---

## 9. 执行后复盘关注点

> 这一节不是必填，但建议在 action-plan 执行结束后回填，用于后续迭代与模板复用。

- **哪些 Phase 的工作量估计偏差最大**：（执行后回填）
- **哪些编号的拆分还不够合理**：（执行后回填）
- **哪些问题本应更早问架构师**：（执行后回填）
- **哪些测试安排在实际执行中证明不够**：（执行后回填）
- **模板本身还需要补什么字段**：（执行后回填）

---

## 10. 结语

这份 action-plan 以 **spike-driven Cloudflare truth probing + finding writeback discipline** 为第一优先级，采用 **"先壳后探，先单后双，先跑后总"** 的推进方式，优先解决 **packages/ typed seams 与真实 platform reality 之间的差异从未被验证** 这个 load-bearing 问题，并把 **disposable spike 7 条纪律 + transport scope 严控** 作为主要约束。

整个计划完成后，nano-agent after-foundations Phase 0 应达到 **"13 条经验证的 finding + 3 份可交接 rollup + 1 条已创建的 packages/ writeback issue"** 的状态，从而为 B2-B6 的代码 ship 与 B7 的 integrated spike 提供 spike-validated truth source，避免 worker matrix 阶段陷入"边写边验证"的反模式。

> **本 action plan 的成功标志不是"spike 部署成功"，而是"finding 被写回 packages/ 的路径被建立起来"。spike 是手段，finding writeback 是产品；如果 13 条 finding 全部 ship 但没有任何一条触发 packages/ 修改，本 action plan 应判定为**not successful**——这是 P0-spike-discipline §5 双向 traceability 的硬要求。**
