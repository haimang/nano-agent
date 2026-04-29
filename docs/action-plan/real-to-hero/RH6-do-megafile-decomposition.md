# Nano-Agent 行动计划 — RH6 DO Megafile Decomposition + Truth Freeze + Evidence Closure

> 服务业务簇: `real-to-hero / RH6`
> 计划对象: `把 RH1-RH5 累积到 NanoSessionDO 与 user-do.ts 的复杂度一次拆开；冻结 three-layer-truth 文档；归档 web/wechat-devtool/real-device 三层 final evidence；清理残余 shim`
> 类型: `refactor + add (docs) + remove (residue)`
> 作者: `Owner + Opus 4.7`
> 时间: `2026-04-29`
> 文件位置:
> - `workers/agent-core/src/host/do/{nano-session-do,session-do-*}.ts`
> - `workers/orchestrator-core/src/{user-do,user-do/handlers/*}.ts`
> - `docs/architecture/three-layer-truth.md`
> - `docs/evidence/{web,wechat-devtool,real-device}-manual-2026-XX/**`（charter §7.7 锁定路径；不使用 `docs/evidence/real-to-hero/RH6/...` 嵌套路径）
>
> 📝 **行号引用提示**：行号截至 2026-04-29 main 快照；以函数名为锚点。
>
> 📝 **业主已签字 QNA**：业主同意 RHX-qna Q4（5 套 evidence + 4 限定 must-cover scenario）。
> 上游前序 / closure:
> - RH1-RH5 全部 closure
> - `docs/charter/plan-real-to-hero.md` r2 §7.7 + §10.3
> 下游交接:
> - real-to-hero final closure 文档
> - hero-to-platform 启动基线
> 关联设计 / 调研文档:
> - `docs/design/real-to-hero/RH6-do-megafile-decomposition.md`（含 §9 修订 + ZX5 seam 承认）
> 冻结决策来源:
> - `docs/design/real-to-hero/RHX-qna.md` Q4（业主同意 Opus 路线：5 套基线 + 4 项限定 must-cover scenario / 录像+HAR+WS log / closure ±3 工作日 / 真机 5G+Wi-Fi reconnect 各 1 次）
> 文档状态: `draft`

---

## 0. 执行背景与目标

real-to-hero 的功能在 RH1-RH5 内已经全部 live；RH6 不再引入新功能，而是把巨石拆开、把三层真相边界冻结成可审计架构文档、把 web/wechat-devtool/real-device 三层 final evidence 归档，并把过渡期 shim/deprecated bridge/Lane E residue 清理掉。如果不在 RH6 收口，下一阶段会直接继承维护灾难——`NanoSessionDO` 经过 RH1+RH4 还会更长，`user-do.ts` 经过 RH2+RH3+RH4+RH5 也会接近 3000 行。

- **本次计划解决的问题**：
  - `NanoSessionDO` 巨石（RH0 后 ~1600 行 + RH1-5 净增）
  - `user-do.ts` 巨石（在 ZX5 已抽 4 seam 之上 RH2-5 还在新增 handler）
  - three-layer truth 仅在 charter 内描述，无独立架构文档
  - web/wechat-devtool/real-device evidence 全无
  - `forwardInternalJson @deprecated` 残留；deploy-fill 4 源残留 + 文档残留；Lane E library import 已在 RH4 sunset 删除（验证）
- **本次计划的直接产出**：
  - `nano-session-do.ts` 主文件 ≤400 行 + 7 子模块（含 RH0 已切的 verify/persistence + RH6 新切的 bootstrap/identity/ingress/ws/orchestration）
  - `user-do.ts` 主 façade ≤500 行 + `user-do/handlers/*.ts` + `user-do/durable-truth.ts` + 现有 4 seam（保留）
  - `docs/architecture/three-layer-truth.md` 冻结
  - `docs/evidence/{web,wechat-devtool,real-device}-manual-2026-XX/` 各 1 完整 evidence pack（charter §7.7 锁定路径；`real-device` 子目录内含 ios17-safari / android14-chrome / wechat8.0 三组 sub-pack）
  - 残余清理 PR
- **本计划不重新讨论的设计结论**：
  - 不做 SQLite-DO（charter D2）
  - 不引入新功能 / 新 endpoint（design RH6 [O1]）
  - manual evidence baseline = 5 套（RHX Q4，业主同意 Opus 4 项限定）

---

## 1. 执行综述

### 1.1 总体执行方式

RH6 采用 **拆前依赖图审核 → 按职责拆 → 拆后 cycle 检测 → 文档冻结 → evidence 采集 → cleanup**：每个 megafile 拆分前先用 `madge` 画现有依赖图、识别潜在循环；按 design [S1]/[S2] 列的职责切；每个 PR 拆后跑 `tsc --noEmit` + `madge --circular`，0 cycle 才合并。`three-layer-truth.md` 与代码现实严格回绑（不允许只复述 charter）。Evidence 由业主在 closure ±3 工作日采集，5 套设备共 20 case（每套 4 must-cover scenario）。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 依赖 |
|------|------|------|------|
| Phase 1 | 依赖图基线 + cycle detector 接入 CI | S | RH5 closure |
| Phase 2 | NanoSessionDO 拆分 (P6-A) | L | Phase 1 |
| Phase 3 | user-do.ts 拆分 (P6-B) | L | Phase 1 |
| Phase 4 | three-layer-truth 文档冻结 (P6-C) | M | Phase 2-3 完成 |
| Phase 5 | Residue Cleanup (P6-E) | S | Phase 2-3 |
| Phase 6 | Manual Evidence Pack (P6-D) | L | Phase 2-5 + preview deploy |
| Phase 7 | Real-to-Hero Final Closure | S | Phase 1-6 |

### 1.3 执行策略

- **执行顺序**：依赖图先 → 拆分 → 文档 → cleanup → evidence → final closure
- **风险控制**：拆分前后均跑 madge；任何 import cycle 必须在 PR 内修复
- **测试**：拆分不改行为，既有测试矩阵全绿即可
- **文档**：three-layer-truth 与代码同提交
- **回滚**：单 PR 拆分单文件，便于回滚单点

### 1.4 影响结构图

```text
RH6
├── Phase 1: madge baseline + CI
├── Phase 2: NanoSessionDO 拆分
│   ├── nano-session-do.ts (façade ≤400 行)
│   ├── session-do-bootstrap.ts
│   ├── session-do-identity.ts
│   ├── session-do-ingress.ts
│   ├── session-do-ws.ts
│   ├── session-do-verify.ts (RH0 已切)
│   ├── session-do-persistence.ts (RH0 已切)
│   └── session-do-orchestration.ts
├── Phase 3: user-do 拆分
│   ├── user-do.ts (façade ≤500 行)
│   ├── user-do/handlers/{start,input,messages,cancel,verify,files,me-conversations,me-devices,me-team,permission,elicitation,usage,resume}.ts
│   ├── user-do/durable-truth.ts
│   └── （保留）session-lifecycle.ts / session-read-model.ts / ws-bridge.ts / parity-bridge.ts
├── Phase 4: three-layer-truth.md
├── Phase 5: residue cleanup
├── Phase 6: evidence pack
└── Phase 7: real-to-hero final closure
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope

- **[S1]** `madge` 接入 root scripts（`pnpm check:cycles`）；CI 必跑
- **[S2]** `nano-session-do.ts` 拆为 façade ≤400 行 + 7 子模块（含 verify + persistence + 5 个新切）
- **[S3]** `user-do.ts` 拆为 façade ≤500 行 + `handlers/*` + `durable-truth.ts`；保留 ZX5 4 seam 不重抽
- **[S4]** `docs/architecture/three-layer-truth.md`：DO memory / DO storage / D1 ownership 边界 + 禁令 + 常见违规示例 + 与代码 file:line 回绑
- **[S5]** Residue cleanup：`forwardInternalJson @deprecated` 删除；`deploy-fill` 4 源 + 文档残留删除；验证 Lane E library import 已无残留
- **[S6]** Manual evidence pack：5 套 × 4 scenario = 20 case（含真机 5G+Wi-Fi reconnect 各 1 次）；录像 + HAR + WS log
- **[S7]** Real-to-Hero final closure 文档（独立）

### 2.2 Out-of-Scope

- **[O1]** 新功能 / 新 endpoint
- **[O2]** SQLite-DO
- **[O3]** 额外 polish
- **[O4]** ≥6 套设备 evidence

### 2.3 边界判定表

| 项目 | 判定 | 理由 |
|------|------|------|
| 顺手补 polish 功能 | out-of-scope | 不在 RH6 scope |
| 拆出文件 ≤400/500 但有 import cycle | out-of-scope | charter §10.3 NOT-成功退出第 1 条 |
| three-layer-truth 复述 charter 不回绑代码 | out-of-scope | 文档失去约束力 |
| 仅 happy path evidence | out-of-scope | 必须 4 must-cover scenario |

---

## 3. 业务工作总表

| 编号 | Phase | 工作项 | 类型 | 文件 | 风险 |
|------|-------|--------|------|------|------|
| P6-01 | 1 | madge CI gate（依赖 RH0 P0-A2 已预装）| add | `.github/workflows/*`（RH6 在 RH0 baseline 之上加 hard gate；`madge` devDep 与 `pnpm check:cycles` script 已由 RH0 P0-A2 安装） | low |
| P6-02 | 1 | 当前依赖图 baseline 截图 | manual | `docs/architecture/dependency-graph-baseline.svg` | low |
| P6-03 | 2 | session-do-bootstrap 抽出 | refactor | agent-core do/ | medium |
| P6-04 | 2 | session-do-identity 抽出 | refactor | 同上 | medium |
| P6-05 | 2 | session-do-ingress 抽出 | refactor | 同上 | medium |
| P6-06 | 2 | session-do-ws 抽出 | refactor | 同上 | high |
| P6-07 | 2 | session-do-orchestration 抽出 | refactor | 同上 | medium |
| P6-08 | 2 | NanoSessionDO 主文件薄 façade | refactor | `nano-session-do.ts` | medium |
| P6-09 | 3 | user-do/handlers/* 13 文件 | refactor | orchestrator-core | high |
| P6-10 | 3 | user-do/durable-truth.ts 抽出 | refactor | 同上 | medium |
| P6-11 | 3 | user-do.ts 主文件薄 façade | refactor | 同上 | medium |
| P6-12 | 4 | three-layer-truth.md | add | `docs/architecture/three-layer-truth.md` | low |
| P6-13 | 5 | forwardInternalJson 删除 | remove | `user-do.ts` | low |
| P6-14 | 5 | deploy-fill 残留删除 | remove | 多源 | low |
| P6-15 | 5 | Lane E library import 残留验证 | manual | grep | low |
| P6-16 | 6 | iOS17 Safari evidence | manual | `docs/evidence/.../ios17-safari/` | medium |
| P6-17 | 6 | Android14 Chrome evidence | manual | 同上 | medium |
| P6-18 | 6 | WeChat 8.0 真机 evidence（含 5G+Wi-Fi reconnect 各 1）| manual | 同上 | medium |
| P6-19 | 6 | WeChat devtool evidence | manual | 同上 | low |
| P6-20 | 6 | Chrome stable evidence | manual | 同上 | low |
| P6-21 | 7 | Real-to-Hero final closure | add | `docs/issue/real-to-hero/real-to-hero-final-closure.md` | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — 依赖图基线 + CI

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P6-01 | madge CI hard gate | madge devDep 与 `check:cycles` script 已在 RH0 P0-A2 baseline 安装（pre-existing）；本 phase 仅在 CI workflow 把 `pnpm check:cycles` 列为 hard gate（非通过禁止合并）；同时把 cycle baseline 从 RH0 的 informational 升级为 enforcement | `.github/workflows/*` | CI fail-on-cycle 启用；既有 0 cycle baseline 不回归 |
| P6-02 | baseline graph | `madge --image dependency-graph.svg`（拆前快照）+ 写说明 | `docs/architecture/dependency-graph-baseline.svg` + `*-readme.md` | 文件存在 |

### 4.2 Phase 2 — NanoSessionDO 拆分

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P6-03 | bootstrap | 抽出 DO constructor、env 初始化、首次 attach 准备 | `session-do-bootstrap.ts` | unit + 主文件不引用具体实现 |
| P6-04 | identity | 抽出 sessionUuid / userUuid / teamUuid 解析 | `session-do-identity.ts` | 同上 |
| P6-05 | ingress | 抽出 fetch route 分发 | `session-do-ingress.ts` | 同上 |
| P6-06 | ws | 抽出 WS attach / detach / heartbeat / replay | `session-do-ws.ts` | 同上；这是最大风险（涉及 RH1/RH2 改动）|
| P6-07 | orchestration | 抽出 KernelRunner 启动 + step 执行 + tool 调度 | `session-do-orchestration.ts` | 同上 |
| P6-08 | façade | 主文件保留 class、依赖注入、对外 method；具体逻辑全部下沉 | `nano-session-do.ts` | ≤ 400 行；`madge --circular` 0 cycle；agent-core 全部既有测试不回归 |

### 4.3 Phase 3 — user-do.ts 拆分

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P6-09 | handlers | 13 个 domain handler 各自抽出独立文件，主 façade 用 dispatch table 引用 | `user-do/handlers/*.ts` | 每文件 ≤ 200 行 |
| P6-10 | durable-truth | `user-do.ts:286-500` D1 helpers 抽到 `user-do/durable-truth.ts` | new file | 215 行 → 独立模块 |
| P6-11 | façade | 主 façade 仅含 class、route 分发、ZX5 4 seam 引用、handlers dispatch | `user-do.ts` | ≤ 500 行；`madge --circular` 0 cycle；既有测试不回归 |

### 4.4 Phase 4 — three-layer-truth 文档冻结

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P6-12 | 文档 | 章节包含：(a) DO memory（in-flight kernel 状态、attached WS map）；(b) DO storage（waiter / sweep 等 hibernation-safe state）；(c) D1（usage events / sessions / users / teams / models / files / api_keys / user_devices）；(d) 禁令：D1 → KV cold copy 禁止、KV → D1 反向写禁止；(e) 常见违规示例；(f) 与代码 file:line 回绑 | `docs/architecture/three-layer-truth.md` | 文档 ≥ 5KB；任何 file:line 引用经实际 grep 验证 |

### 4.5 Phase 5 — Residue Cleanup

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P6-13 | forwardInternalJson | 删除 @deprecated method + 调用方零检查 | `user-do.ts` 等 | grep 0 残留 |
| P6-14 | deploy-fill | 删除 4 源 + 文档残留（具体清单从 design RH6 §5.1 [S5] 来源 deepseek H6-5）| 多源 | grep 0 残留 |
| P6-15 | Lane E 残留验证 | grep 全代码库 `from '@nano-agent/workspace-context-artifacts'` 仅 leaf worker 内部使用，agent-core runtime 0 引用 | manual grep | 验证通过 |

### 4.6 Phase 6 — Manual Evidence Pack

> 5 套 × 4 must-cover scenario（注册→start→image_url chat→收响应 / permission deny / device revoke force-disconnect / 断网 30s reconnect 不丢消息）= 20 case

| 编号 | 工作项 | 设备 | 网络 | 收口 |
|------|--------|------|------|------|
| P6-16 | iOS 17 Safari | iPhone | Wi-Fi | 4 scenario 全通过；录像 + HAR + WS log zip 入 `docs/evidence/real-device-manual-2026-XX/ios17-safari/` |
| P6-17 | Android 14 Chrome | Android 真机 | Wi-Fi | 同上 |
| P6-18 | WeChat 8.0 真机 | Android 真机 | 5G+Wi-Fi 切换（仅 reconnect scenario 各 1）+ 其他 scenario Wi-Fi | 4 scenario + reconnect 真切网通过；evidence 含 ≥2 录像 |
| P6-19 | WeChat devtool stable | desktop | Wi-Fi | 4 scenario |
| P6-20 | Chrome stable | desktop | Wi-Fi | 4 scenario |

### 4.7 Phase 7 — Final Closure

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P6-21 | final closure | 撰写 RH 阶段 verdict / 各 phase 简表 / evidence 索引 / handoff 给 hero-to-platform | `docs/issue/real-to-hero/real-to-hero-final-closure.md` | 文档 ≥ 5KB；含 5 evidence 链接 |

---

## 5. Phase 详情

### 5.1 Phase 1 — 依赖图

- **核心**：拆分前先有可对照的依赖图基线
- **风险**：madge 在 root 跨 worker 跑可能慢；只跑 src/ 目录可加速

### 5.2 Phase 2 — NanoSessionDO 拆分

- **核心**：5 个新切（bootstrap/identity/ingress/ws/orchestration）+ RH0 已切的 verify/persistence = 7 子模块
- **风险**：ws 模块涉及 RH1 后的 forwardServerFrameToClient + RH2 NACP frame upgrade 复杂度，是最高风险点
- **回滚**：每个抽出单 PR

### 5.3 Phase 3 — user-do.ts 拆分

- **核心**：保留 ZX5 4 seam，新增 handlers/* + durable-truth.ts
- **风险**：handler 间共享 helper 容易形成 cycle；统一通过 façade 调度
- **回滚**：单 PR 单 handler

### 5.4 Phase 4 — three-layer-truth

- **核心**：与代码现实严格回绑
- **测试**：每条 file:line 引用必须在 RH6 closure 时仍准确（grep 验证）

### 5.5 Phase 5 — Residue Cleanup

- **核心**：清理过渡期遗留
- **风险**：误删 active 引用；先 grep 验证零调用方再删

### 5.6 Phase 6 — Evidence Pack

- **核心**：业主在 closure ±3 工作日内 5 套 × 4 = 20 case
- **风险**：真机 5G/Wi-Fi 切换需要业主在不同物理位置或用蜂窝热点切换

### 5.7 Phase 7 — Final Closure

- **核心**：把 RH 阶段所有承诺逐项 close

---

## 6. 依赖的冻结决策

| 决策 | 来源 | 影响 |
|------|------|------|
| RHX Q4 5 套基线 + 4 限定 | RHX-qna Q4 | Phase 6 evidence 直接按此 |
| 不引入新功能 | design RH6 [O1] | Phase 全部不涉及 feature |
| 不引入 SQLite-DO | charter D2 | 拆分仅在现有 DO 内 |
| three-layer truth 必须回绑代码 | design RH6 §6.1 | Phase 4 文档要求 |
| import cycle = NOT-成功退出 | charter §10.3 | Phase 1-3 CI gate |

---

## 7. 风险、依赖、完成后状态

### 7.1 风险

| 风险 | 描述 | 判断 | 应对 |
|------|------|------|------|
| 拆分引入 import cycle | ws / orchestration 互相依赖 | high | madge CI gate；不通过禁止合并 |
| 业主 evidence 时间盒 | 5 套 × 4 case 单日完成有压力 | medium | ±3 工作日；分多日 |
| three-layer-truth 文档与代码漂移 | 文档先写，代码后改 | medium | Phase 4 仅在 Phase 2-3 完成后启动 |
| residue 误删 | 删了仍有调用方的代码 | medium | 先 grep 验证零调用 |

### 7.2 约束

- **技术前提**：RH1-RH5 全部 closure；agent-core / orchestrator-core 既有矩阵全绿
- **运行时前提**：preview deploy 健康
- **组织协作**：业主参与 evidence 采集
- **上线**：拆分单 PR 单文件；evidence 单 PR

### 7.3 文档同步

- `docs/architecture/three-layer-truth.md`
- `docs/architecture/dependency-graph-baseline.svg`
- `docs/issue/real-to-hero/real-to-hero-final-closure.md`

### 7.4 完成后状态

1. NanoSessionDO 主文件 ≤ 400 行 + 7 子模块；0 cycle
2. user-do.ts 主文件 ≤ 500 行 + handlers/* + durable-truth + 4 ZX5 seam；0 cycle
3. three-layer-truth.md 冻结成架构法
4. 5 套 × 4 = 20 case evidence 归档
5. residue 清零
6. real-to-hero 阶段可正式宣布闭合；hero-to-platform 启动基线就绪

---

## 8. 整体测试与收口

### 8.1 整体测试

- **基础**：`madge --circular` 0 cycle；6 worker dry-run
- **单测**：拆分不改行为，既有矩阵全绿
- **集成**：RH1-RH5 全部 cross-worker e2e 不回归
- **端到端**：5 套 × 4 = 20 case manual evidence
- **回归**：RH0-5 既有矩阵全绿
- **文档校验**：three-layer-truth 中每条 file:line 经 grep 验证

### 8.2 整体收口

1. madge CI gate 启用且 0 cycle
2. NanoSessionDO 主文件 ≤ 400 行 + 7 子模块
3. user-do.ts 主文件 ≤ 500 行 + handlers/* + durable-truth + ZX5 4 seam 保留
4. three-layer-truth.md 冻结
5. 5 套 × 4 case evidence 归档（含真机 5G+Wi-Fi reconnect 各 1）
6. residue 清零（forwardInternalJson / deploy-fill / Lane E）
7. real-to-hero-final-closure.md 撰写完成
8. **具备提交 hero-to-platform charter 启动评审的材料**（charter §11.2 触发条件：real-to-hero-final-closure.md 发布 / 生产运行 / owner 决策启动 / 4 家 reviewer 无 high blocker）—— 这是 owner-decision gate，不由本 action-plan 自动满足

### 8.3 DoD

| 维度 | 完成定义 |
|------|----------|
| 功能 | 不引入新功能（refactor only） |
| 测试 | RH0-5 既有矩阵 0 回归；20 case evidence 通过 |
| 文档 | three-layer-truth + final-closure + dependency-graph |
| 风险收敛 | 0 cycle；0 residue；0 evidence 缺口 |
| 可交付性 | hero-to-platform 启动基线干净 |
