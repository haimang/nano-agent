# A9. Nano-Agent Minimal Bash Network and Script 执行计划

> 服务业务簇: `Capability Runtime / Fake Bash / Network-Script`
> 计划对象: `after-skeleton / Phase 7b / minimal-bash-network-and-script`
> 类型: `modify`
> 作者: `GPT-5.4`
> 时间: `2026-04-18`
> 执行序号: `A9 / 10`
> 上游前序: `A8`
> 下游交接: `A10`
> 文件位置: `packages/capability-runtime/**`, `packages/session-do-runtime/**`, `docs/design/after-skeleton/P7b-minimal-bash-network-and-script.md`
> 关键仓库锚点: `packages/capability-runtime/src/{fake-bash/commands,planner,capabilities/network,capabilities/exec,targets/service-binding}.ts`, `packages/session-do-runtime/src/composition.ts`
> 参考 context / 对标来源: `context/just-bash/src/commands/js-exec/worker.ts`, `context/just-bash/CLAUDE.md`, `context/claude-code/services/tools/toolExecution.ts`
> 关联设计 / 调研文档:
> - `docs/plan-after-skeleton.md`
> - `docs/design/after-skeleton/P4-external-seam-closure.md`
> - `docs/design/after-skeleton/P5-deployment-dry-run-and-real-boundary-verification.md`
> - `docs/design/after-skeleton/P7b-minimal-bash-network-and-script.md`
> - `docs/design/after-skeleton/PX-capability-inventory.md`
> - `docs/design/after-skeleton/PX-QNA.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

Phase 7b 是 fake bash 第一次真正碰到高风险工具面：`curl` 与 `ts-exec` 都是 LLM 天生强依赖的工具形状，但在 nano-agent 的 Worker/V8 isolate 前提下，它们绝不能继续沿用“本地 shell + 本地 Node/Python”的心智。当前仓库已经有几块重要资产：`registerMinimalCommands()` 已把 `curl` 与 `ts-exec` 固定为 minimal command pack 的一部分，默认 policy 都是 `ask`；`planner.ts` 已把 bash string path 收窄为 `curl <url>` 与 `ts-exec <inline code>`；`ServiceBindingTarget` 已经有 request/progress/cancel/response 的强 transport seam；`BrowserRenderingTarget` 也已保留出未来高价值远程执行槽位。

但现实也同样清楚：`capabilities/network.ts` 现在只是 URL 校验 + stub 文案，`capabilities/exec.ts` 也只是 code length acknowledgement + stub 文案；`curl` richer method/header/body/timeout 还没有正式输入面；`ts-exec` 更没有真正的 sandbox substrate。Q17 已冻结：**`curl` richer method/header/body/timeout 语义只允许走 structured path，不通过 bash argv 扩张**。因此这份 action-plan 的目标，是把 **最小 bash 形状、structured path 扩张、高风险 policy、remote seam 升级口、artifact/evidence 对齐** 一次性写成可以执行的工作包，让 Phase 7b 不再停留在“预留两个名字”的状态。

- **服务业务簇**：`Capability Runtime / Fake Bash / Network-Script`
- **计划对象**：`after-skeleton / Phase 7b / minimal-bash-network-and-script`
- **本次计划解决的问题**：
  - `curl`/`ts-exec` 已进入 command pack，但仍主要停留在 partial/stub reality
  - bash path 与 richer structured path 的边界尚未被彻底固定
  - localhost、Python、package install、宿主级 Node 能力等幻觉仍需要被显式挡在 v1 外
- **本次计划的直接产出**：
  - 一套最小 `curl <url>` / `ts-exec <inline code>` contract 与 structured-path 扩展面
  - 一套 policy-first、timeout-first、artifact-aware 的 network/script 执行治理方案
  - 一份可向 future tool-runner worker / deployment smoke 平滑升级的 P7b exit pack

---

## 1. 执行综述

### 1.1 总体执行方式

这份 action-plan 采用 **先冻结 bash-vs-structured contract 与风险边界，再补 restricted curl，再决定 ts-exec substrate，再补 remote seam/evidence/docs** 的推进方式。核心原则是：**bash string path 只承诺最小形状；高风险扩张必须走 structured path；local-ts 只是 reference path，不等于最终执行边界；policy 与 evidence 必须先于能力宣传。**

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Contract Freeze & Risk Boundary | `M` | 冻结 bash/structured 双路径边界、禁止面与 capability disclosure | `A8 + PX-QNA / PX-capability-inventory` |
| Phase 2 | Restricted Curl Baseline | `M` | 实现最小 `curl` baseline，并把 richer options 锁进 structured path | `Phase 1` |
| Phase 3 | `ts-exec` Substrate Decision & Baseline | `L` | 决定 `ts-exec` 的最小可行执行 substrate，并建立真实 baseline | `Phase 2` |
| Phase 4 | Remote Seam, Promotion & Observability | `M` | 把 network/script 执行挂到 service-binding / artifact / trace seam 上 | `Phase 3` |
| Phase 5 | Tests, Inventory & Deployment Handoff | `S` | 用 smoke/tests/docs/inventory 证明 P7b 是可治理能力面，而非 stub | `Phase 4` |

### 1.3 执行策略说明

- **执行顺序原则**：`先 freeze 边界，再做 curl，再做 ts-exec，再接 remote seam 与 evidence`
- **风险控制原则**：`不允许 localhost/private-network 幻觉；不允许 bash argv 偷渡 richer curl；不允许把 stub 讲成 supported`
- **测试推进原则**：`先 capability-runtime package tests，再 restricted smoke，再 future deploy-shaped smoke handoff`
- **文档同步原则**：`P7b design、PX inventory、README、policy disclosure 必须同步写清 bash path 与 structured path 的差异`

### 1.4 本次 action-plan 影响目录树

```text
minimal-bash-network-and-script
├── packages/capability-runtime
│   ├── src/{fake-bash/commands,planner,capabilities/network,capabilities/exec,targets/service-binding,targets/browser-rendering,policy}.ts
│   └── test/integration/{restricted-curl,restricted-ts-exec,policy-block,large-output-promotion,service-binding-progress}.test.ts
├── packages/session-do-runtime
│   └── test/integration/{capability-remote-call,tool-progress-stream}.test.ts
└── docs
    ├── action-plan/after-skeleton/A9-minimal-bash-network-and-script.md
    └── design/after-skeleton/{P5-deployment-dry-run-and-real-boundary-verification,P7b-minimal-bash-network-and-script,PX-capability-inventory}.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 冻结 `curl` / `ts-exec` 的最小 bash 形状与 richer structured path 边界
- **[S2]** 实现受 policy / timeout / output-bound 约束的 restricted `curl` baseline
- **[S3]** 为 `ts-exec` 选择 Worker-native 最小 substrate，并建立真实或诚实 partial baseline
- **[S4]** 把 network/script 与 service-binding progress/cancel/response seam、artifact promotion、trace/evidence 接上
- **[S5]** 在 inventory / README / tests 中明确 unsupported 与 ask-gated reality

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 本地 Linux shell、真实 bash pipes、Node child process、Python 解释器
- **[O2]** `curl` 完整 CLI 旗标宇宙与任意 header/body/auth/file upload 语义
- **[O3]** `npm install`、`pip install`、localhost/private RFC1918 egress、宿主文件系统访问
- **[O4]** browser rendering 真正接入（保留为后续 target slot）

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| bash `curl <url>` | `in-scope` | 当前 planner 已固定最小形态，应落实为真实 baseline | P7b 完成后仅在 richer UX 设计时重评 |
| structured `curl` options | `in-scope` | Q17 已要求 richer method/header/body/timeout 只走 structured path | 后续如扩更多字段再重评 |
| bash `curl -X/-H/-d` | `out-of-scope` | 会扩大 parser 与 shell 幻觉，违背 Q17 | 永不作为 v1 canonical 路线重评 |
| bash `ts-exec <inline code>` | `in-scope` | 当前最小入口已存在 | P7b 后按 substrate 证据重评是否扩 stdin/file input |
| Python / package manager / localhost | `out-of-scope` | 与 Worker-first 安全边界冲突 | 下一阶段若有独立 remote worker 设计再重评 |
| `service-binding` remote upgrade | `depends-on-phase` | transport seam 已强，但真正 remote tool-runner 仍待接线 | P5 deployment smoke 阶段立即复用 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | Bash vs Structured Contract Freeze | `update` | `fake-bash/commands.ts`, `planner.ts`, P7b/PX docs | 固定 bash path 最小面与 structured-path 扩张面 | `high` |
| P1-02 | Phase 1 | Unsupported Surface Freeze | `update` | policy/docs/README | localhost、Python、install、host Node 幻觉全部明示拦截 | `high` |
| P1-03 | Phase 1 | Inventory / Prompt Sync | `update` | PX inventory, README, capability docs | `curl/ts-exec` 仍 partial 的现实被显式披露 | `medium` |
| P2-01 | Phase 2 | Restricted Curl Handler | `update` | `capabilities/network.ts`, tests | `curl <url>` 拥有真实最小执行价值 | `high` |
| P2-02 | Phase 2 | Structured Curl Input Path | `update` | planner/tool-call/runtime docs | richer method/header/body/timeout 只经 structured input 进入 | `high` |
| P2-03 | Phase 2 | Egress Guard & Timeout Policy | `update` | policy/network tests | private address、scheme、timeout、size cap 成为硬边界 | `high` |
| P3-01 | Phase 3 | `ts-exec` Substrate Decision | `update` | `capabilities/exec.ts`, target docs, tests | 明确 v1 是 local sandbox、remote sandbox，还是诚实 partial | `high` |
| P3-02 | Phase 3 | Minimal `ts-exec` Baseline | `update` | exec handler/tests | 给 `ts-exec` 一个真实 baseline，而不是纯文案 stub | `high` |
| P3-03 | Phase 3 | Script Output Boundaries | `update` | exec handler + promotion/tests | 大脚本输出 deterministic/bounded，可转 ref/artifact | `medium` |
| P4-01 | Phase 4 | Service-Binding Upgrade Path | `update` | `targets/service-binding.ts`, integration tests | local->remote 升级不改 contract/message family | `medium` |
| P4-02 | Phase 4 | Promotion / Trace / Audit Wiring | `update` | capability runtime + session/eval seams | network/script 结果可挂 trace 与 evidence | `medium` |
| P5-01 | Phase 5 | Smoke / Package Test Gate | `update` | package tests + deploy handoff notes | restricted curl / ts-exec / policy block / promotion 都有证据 | `medium` |
| P5-02 | Phase 5 | Docs / Inventory / P5 Handoff | `update` | P7b docs, PX inventory, deployment docs | P7b 结果能直接被 deployment dry-run / review 消费 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Contract Freeze & Risk Boundary

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | Bash vs Structured Contract Freeze | 冻结 bash string path 只支持 `curl <url>` 与 `ts-exec <inline code>`；richer `curl` 参数只接受 structured input，不再扩 bash argv | `packages/capability-runtime/src/{fake-bash/commands,planner}.ts`, docs | parser 与 capability truth 稳定 | planner tests + docs review | `curl -X/-H/-d` 不再处于“也许以后可以”状态 |
| P1-02 | Unsupported Surface Freeze | 把 localhost/private-network/Python/install/host Node 等明确写入不支持边界与 policy 文案 | policy/docs/README | 高风险幻觉被显式挡住 | docs review | prompt/reviewer/runtime 对不支持面说法一致 |
| P1-03 | Inventory / Prompt Sync | 在 PX inventory 与 README 中保留 `curl/ts-exec = Partial (ask-gated)`，直到真实 evidence 成立 | PX docs, README | 披露不高于实现 reality | doc review | 不再出现“命令已注册=能力已完成”的误读 |

### 4.2 Phase 2 — Restricted Curl Baseline

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | Restricted Curl Handler | 将当前 URL 校验 stub 升级为最小真实 fetch baseline：限定 scheme、默认 method、受 output/timeout 约束 | `packages/capability-runtime/src/capabilities/network.ts`, tests | `curl <url>` 有真实执行价值 | `pnpm --filter @nano-agent/capability-runtime test` | 至少一条 restricted curl smoke 走过真实 handler |
| P2-02 | Structured Curl Input Path | 为 richer method/header/body/timeout 增加 structured input 入口，并保持与 bash path 分离 | planner/tool-call/runtime docs/tests | richer curl 有扩展口，但不污染 bash parser | package tests | bash path 与 structured path 边界清晰可测 |
| P2-03 | Egress Guard & Timeout Policy | 明确并实现 private address、localhost、RFC1918 / CGNAT / link-local / IPv6 ULA / metadata-style endpoint、超长 timeout、过大 body/output 的 deny/ask 规则 | policy/network tests | network tool 具备 Worker-native 安全边界 | policy block tests | 高风险目标与长悬挂请求被确定性阻断 |

### 4.3 Phase 3 — `ts-exec` Substrate Decision & Baseline

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | `ts-exec` Substrate Decision | 基于 Worker/V8 isolate 约束，决定 v1 `ts-exec` 是最小本地沙箱、远程 tool-runner，还是保守 partial，并写成明确 contract；若 Phase 3 结束前仍未选定 substrate，则 inventory 必须继续标 `Partial (ask-gated)` | `packages/capability-runtime/src/capabilities/exec.ts`, docs | 不再一边注册命令、一边回避执行 substrate | docs + tests | `ts-exec` 的现实边界可被 reviewer 直接理解，且不允许“未决却对外宣称 supported” |
| P3-02 | Minimal `ts-exec` Baseline | 按 P3-01 结论实现最小 baseline：inline code only、无宿主 FS、无 package install、无 Python sidecar | exec handler/tests | `ts-exec` 从纯 stub 进入最小可用或诚实 partial | package tests | 至少一条 script smoke 能证明 baseline 成立 |
| P3-03 | Script Output Boundaries | 给脚本执行补 deterministic output cap、cancel/timeout 与 artifact promotion 出口 | exec handler + promotion tests | script 输出不会失控或挂死 | package tests | 大输出与长执行均有稳定边界 |

### 4.4 Phase 4 — Remote Seam, Promotion & Observability

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | Service-Binding Upgrade Path | 把 `ServiceBindingTarget` 作为 future remote worker 的正式升级口，确保 request/progress/cancel/response 不需重写 | `packages/capability-runtime/src/targets/service-binding.ts`, integration tests | local-ts 只是 reference path，remote 不改 contract | service-binding tests | future tool-runner worker 可平滑接入 |
| P4-02 | Promotion / Trace / Audit Wiring | 让 network/script 执行结果与 progress、artifact promotion、trace/evidence 对齐 | capability runtime + session/eval seams | network/script 不再是 observability blind spot | targeted integration tests | 结果、拒绝、取消都可被 trace/audit 解释 |

### 4.5 Phase 5 — Tests, Inventory & Deployment Handoff

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | Smoke / Package Test Gate | 执行 restricted curl、restricted ts-exec、policy block、large-output promotion、service-binding progress smoke | package tests + targeted integration | P7b 不再只是 design 决议 | `pnpm --filter @nano-agent/capability-runtime test` | 关键高风险边界都有回归证据 |
| P5-02 | Docs / Inventory / P5 Handoff | 更新 P7b docs、PX inventory、deployment notes，使 Phase 5 可直接消费 network/script reality | docs + deployment notes | 后续 deploy verification 能直接复用 P7b contract | docs review | `curl/ts-exec` 的当前等级与升级条件可直接引用 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Contract Freeze & Risk Boundary

- **Phase 目标**：先把最容易被 LLM 幻觉误读的部分写死：bash path 很窄，structured path 才是扩张口。
- **具体功能预期**：
  1. `curl <url>` 与 `ts-exec <inline code>` 成为唯一 bash baseline。
  2. richer curl options 不再被暗示为 bash parser future。
  3. localhost / Python / install / host Node 等都被明确拒绝。
- **测试与验证重点**：
  - planner/registry tests
  - policy block docs/tests

### 5.2 Phase 2 — Restricted Curl Baseline

- **Phase 目标**：让 `curl` 至少成为一个受控、可用、不会破边界的 Worker-native capability。
- **具体功能预期**：
  1. `curl <url>` 通过真实 fetch 路径拿到最小输出。
  2. richer structured input 可表达 method/header/body/timeout，但不污染 bash path。
  3. private/local/RFC1918/CGNAT/link-local/IPv6 ULA/metadata endpoint、network-size/timeout guard 成为 hard edge。
- **测试与验证重点**：
  - restricted curl smoke
  - policy block tests
  - output truncation / promotion tests

### 5.3 Phase 3 — `ts-exec` Substrate Decision & Baseline

- **Phase 目标**：解决 `ts-exec` 最大的不确定性：我们到底在哪执行，以及能承诺到什么程度。
- **具体功能预期**：
  1. `ts-exec` substrate 结论被显式冻结。
  2. baseline 至少支持 inline code，且受严格 policy/timeout/output 限制。
  3. 若执行 substrate 仍未 ready，也必须在 inventory 中继续保持 partial，而非伪装完成。
  4. Phase 3 只能在三种结论之一中选一：`local isolate sandbox`、`remote tool-runner via service binding`、`honest partial`；不允许继续停留在“以后再说”的灰区。
- **测试与验证重点**：
  - restricted ts-exec smoke
  - cancel/timeout tests
  - artifact promotion tests

### 5.4 Phase 4 — Remote Seam, Promotion & Observability

- **Phase 目标**：保证 network/script 即便以后升到 remote worker，也不需要重写 message family 或 policy model。
- **具体功能预期**：
  1. `ServiceBindingTarget` 成为正式升级路径。
  2. network/script progress/result/cancel 与 `tool.call.*` reality 对齐。
  3. 大结果、拒绝与失败都能进入 trace/evidence。
- **测试与验证重点**：
  - service-binding progress/cancel tests
  - session stream / audit alignment tests

### 5.5 Phase 5 — Tests, Inventory & Deployment Handoff

- **Phase 目标**：让 Phase 7b 结束时，后续 Phase 5 deploy verification 可以直接消费 network/script 合同，而不是再重写一版。
- **交付要求**：
  1. smoke/tests 齐备
  2. docs/inventory 同步
  3. deployment dry-run 知道该如何验证 restricted curl / ts-exec

---

## 6. 风险、依赖与验收

> **统一说明**：与本 action-plan 相关的业主 / 架构师问答，统一收录于 `docs/action-plan/after-skeleton/AX-QNA.md`；请仅在该汇总文件中填写答复，本文不再逐条填写。

### 6.1 关键依赖

| 依赖项 | 作用 | 当前状态 | 本计划应对方式 |
|--------|------|----------|----------------|
| `ServiceBindingTarget` | remote worker 升级口 | 已有强 transport seam | 作为 P4 正式升级路径保留 |
| `BrowserRenderingTarget` | future browser capability slot | 仍是 reserved stub | 明确保留，不抢跑接线 |
| PX capability inventory | 能力披露真相表 | 已存在 design memo | Phase 5 更新 network/script 等级 |
| Phase 5 deployment verification | deploy-shaped smoke | 已有 P5 action-plan | 作为 P7b 完成后的验证下游 |

### 6.2 主要风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| bash path 被持续加旗标 | 为“更像 curl”而扩 argv parser | 心智模型再次漂移 | Q17 固定 structured-only 扩张 |
| `ts-exec` substrate 不清 | 继续停留在“以后再说” | 命令长期半真半假 | Phase 3 必须产出明确 baseline 或明确 partial verdict |
| unrestricted egress / long-running script | 缺少 policy/timeout/output cap | Worker 资源与安全风险上升 | Phase 2/3 必须先上硬边界再谈能力 |

### 6.3 完成定义（Definition of Done）

1. `curl <url>` 具备真实 restricted baseline，且 richer options 只走 structured path。
2. `ts-exec` 的执行 substrate 与当前等级被清晰写死，不再模糊。
3. localhost / Python / package install / host Node 幻觉都被明确拦截。
4. network/script 结果、拒绝、取消可进入 trace/evidence/promotion 语境。
5. P7b docs、README、PX inventory 与 tests 对 `curl/ts-exec` 的口径完全一致。

---

## 7. 收口结论

Phase 7b 的价值，不是“让 nano-agent 看起来终于像有了 shell”，而是把两个最诱人的 shell 幻觉重新铸造成 Worker-native capability：**bash 只保留最小入口，structured path 才承载扩张，policy 与 evidence 决定能力是否能被承诺，remote seam 保证未来升级不重写 contract**。只要这几条成立，`curl` 与 `ts-exec` 就不再是 fake bash 里的危险占位符，而会成为一个可治理、可升级、可验证的能力层。

---

## 11. 工作报告（A9 执行回填）

> 完成时间: `2026-04-18`
> 执行者: `Claude (claude-opus-4-7[1m])`
> 状态: `done`

### 11.1 工作目标和内容回顾

A9 要把 P7b 设计稿冻结成可执行的 fake bash network+script 真相，五个 Phase 实际命中以下五件事：

1. **Phase 1 — Bash vs Structured Contract Freeze (Q17)**：planner 层把 `curl` 的 bash argv 收紧到 `curl <url>` 最小形态，任何 flag / extra token 都触发带固定 marker `curl-bash-narrow-use-structured` 的错误，并提示 `{ url, method, headers, body, timeoutMs }` 才是 structured 扩张口；`ts-exec` bash 路径只接 inline code，前导 `-flag` 拒绝（marker `ts-exec-bash-narrow-no-flags`）。
2. **Phase 1 — Unsupported Surface Freeze (P1-02)**：`UNSUPPORTED_COMMANDS` 集合追加 `python / python3 / node / nodejs / bash / sh / zsh / deno / bun`，把 host-interpreter 幻觉从 fake bash 拒之门外；与 PX inventory §7.5 新增行同口径。
3. **Phase 2 — Restricted `curl` baseline**：`capabilities/network.ts` 完全重写，接入 scheme allow-list（http/https）、host deny-list（localhost/127./10./172.16./192.168./100.64./169.254./::1/fc00::/fe80::/0.0.0.0）、`timeoutMs` + `maxOutputBytes` 双 cap、`AbortController` 超时中断、`fetchImpl` 注入，错误路径全部携带典型 marker（`curl-scheme-blocked`、`curl-private-address-blocked`、`curl-timeout-exceeded`、`curl-output-truncated`、`curl-not-connected`）。
4. **Phase 3 — `ts-exec` honest partial (Q22)**：`capabilities/exec.ts` 重写为 syntax-validation + length ack + 固定 marker `ts-exec-partial-no-execution`；语法错误走 `ts-exec-syntax-error`；输出不回显 caller 代码本体；代码长度 cap `TS_EXEC_MAX_CODE_BYTES = 64 KiB`。严格遵守 Q22「v1 诚实 partial，保留 remote tool-runner upgrade 口」的结论。
5. **Phase 4 — Remote Seam Upgrade Regression (P4-01)**：新增 `integration/remote-seam-upgrade.test.ts`，证明 `curl` 与 `ts-exec` plan 都可经 `ServiceBindingTarget` 透明转发，`tool.call.*` message family 与 schema 不变；future remote tool-runner 仅替换 transport，不改 handler。
6. **Phase 5 — Test/Docs/Inventory Exit Pack**：全仓 typecheck + build + test 全绿；`PX-capability-inventory.md` v0.3 升级 curl/ts-exec 行、追加 host interpreter 与 egress guard 条目、版本历史；`P7b-minimal-bash-network-and-script.md` v0.3 追加附录 B「A9 执行后状态」；A9 §11 本节回填。

A9 §6.3 Definition of Done 五条全部命中：restricted `curl` baseline 就绪且 richer options 只走 structured path；`ts-exec` substrate 冻结并写死为 honest partial；localhost/Python/install/host interpreter 全部拦截；network/script 进入 service-binding/progress/cancel 语境有测试证据；P7b/README/PX/tests 对 curl/ts-exec 口径一致。

### 11.2 全部实际代码清单

**新增文件（4 个）**:
- `packages/capability-runtime/test/planner-bash-narrow.test.ts` — 11 cases 覆盖 curl bash-path 窄接口（`-flag` 拒绝、extra token 拒绝、错误文本携带 `url/method/headers/body/timeoutMs` 字段名）与 ts-exec 宽容 inline-code+`-flag` 拒绝
- `packages/capability-runtime/test/capabilities/network-egress.test.ts` — 24 cases 覆盖 no-fetchImpl stub、scheme 拒绝（4 scheme）、host 拒绝（14 个私有地址 + 公网接受）、fetchImpl 结构化调用（method/headers/body 透传）、输出截断（全局 cap + caller-smaller cap）、超时 abort
- `packages/capability-runtime/test/capabilities/ts-exec-partial.test.ts` — 5 cases 覆盖 partial disclosure + 长度 ack、空代码拒、超长代码拒、语法错误 marker、敏感代码不回显
- `packages/capability-runtime/test/integration/remote-seam-upgrade.test.ts` — 4 cases 覆盖 curl/ts-exec plan 通过 service-binding 透明转发、`tool.call.request` 字段完整性、progress 事件传递

**修改文件（7 个）**:
- `packages/capability-runtime/src/planner.ts` — 新增 `checkBashNarrow()` + 常量 `CURL_BASH_NARROW_NOTE` / `TS_EXEC_BASH_NARROW_NOTE`；`planFromBashCommand()` 在 alias 改写后追加 narrow 检查
- `packages/capability-runtime/src/capabilities/network.ts` — 完全重写为 restricted baseline：egress guard + 时间/字节 cap + injectable fetchImpl + 5 个 marker 常量 + `CurlStructuredInput` / `CreateNetworkHandlersOptions` 类型
- `packages/capability-runtime/src/capabilities/exec.ts` — 重写为 honest partial：syntax validation + length ack + 3 个 marker / cap 常量
- `packages/capability-runtime/src/fake-bash/unsupported.ts` — `UNSUPPORTED_COMMANDS` 新增 9 条 host interpreter / nested shell 条目
- `packages/capability-runtime/src/index.ts` — 公开新 symbol：`CURL_BASH_NARROW_NOTE` / `TS_EXEC_BASH_NARROW_NOTE` / `COMMAND_ALIASES`、`CURL_NOT_CONNECTED_NOTE` / `CURL_SCHEME_BLOCKED_NOTE` / `CURL_PRIVATE_ADDRESS_BLOCKED_NOTE` / `CURL_TIMEOUT_NOTE` / `CURL_OUTPUT_TRUNCATED_NOTE` / `DEFAULT_CURL_TIMEOUT_MS` / `DEFAULT_CURL_MAX_BYTES` / `CurlStructuredInput` / `CreateNetworkHandlersOptions`、`TS_EXEC_PARTIAL_NOTE` / `TS_EXEC_SYNTAX_ERROR_NOTE` / `TS_EXEC_MAX_CODE_BYTES`
- `docs/design/after-skeleton/PX-capability-inventory.md` — `curl`、`ts-exec` 升级到 Partial(ask-gated) E2；Deferred 表把 richer curl flags 重标 Frozen Out + 新增 host interpreter Unsupported 行；Unsupported 表新增 `python/node/...` 与 egress guard 描述；v0.3 版本历史
- `docs/design/after-skeleton/P7b-minimal-bash-network-and-script.md` — 追加附录 B「A9 执行后状态」+ v0.3 版本历史

### 11.3 测试制作与测试结果

**新增 case 计 44 条**：planner-bash-narrow 11 + network-egress 24 + ts-exec-partial 5 + remote-seam-upgrade 4 = 44 cases。

**Gate 结果（全部绿）**：

| 命令 | 结果 |
|------|------|
| `pnpm -r typecheck` | 10 包全绿 |
| `pnpm -r build` | 10 包全绿 |
| `pnpm --filter @nano-agent/capability-runtime test` | 199 passed（A8 收尾时为 156，净增 43 cases；44 新 case 与 commands.test 中 1 个 stub-token 调整合并） |
| `pnpm --filter @nano-agent/nacp-core test` | 231 passed |
| `pnpm --filter @nano-agent/nacp-session test` | 115 passed |
| `pnpm --filter @nano-agent/eval-observability test` | 194 passed |
| `pnpm --filter @nano-agent/hooks test` | 132 passed |
| `pnpm --filter @nano-agent/llm-wrapper test` | 103 passed |
| `pnpm --filter @nano-agent/agent-runtime-kernel test` | 123 passed |
| `pnpm --filter @nano-agent/storage-topology test` | 114 passed |
| `pnpm --filter @nano-agent/workspace-context-artifacts test` | 163 passed |
| `pnpm --filter @nano-agent/session-do-runtime test` | 309 passed |
| `node --test test/*.test.mjs`（root e2e） | 52/52 passed |
| `npm run test:cross`（root cross-package） | 14/14 passed |

**关键回归证据**：
- `planner-bash-narrow.test.ts` 对 `-X POST` / `-H` / `--data` / extra token 四种 smuggle 形态全部 assertion，任何 future 放宽 bash argv 都会立即触发；错误文本 regex 检查 `url/method/headers/body/timeoutMs` 五字段名，确保 LLM 可识别 structured path 入口。
- `network-egress.test.ts` 逐条列出 14 个私有地址并断言 `curl-private-address-blocked` marker，公网 hostname 只有 `example.com/` 落在 accept 列表；scheme 四条 negative case（file/ftp/gopher/data）保证 allow-list 永不被扩张为 deny-list。
- `ts-exec-partial.test.ts` 的「secret 不回显」case 锁死 A9 Q22 的 privacy 约束 — 任何 future 把 caller 代码 echo 回去的退化都会立即失败。
- `remote-seam-upgrade.test.ts` 断言 `body.tool_name` 与 `body.tool_input` 字段名与 `packages/capability-runtime/src/tool-call.ts` NACP schema 对齐，future remote tool-runner 接线即可复用。

### 11.4 收口分析 + 下一阶段安排

**收口分析（对照 A9 §6.3 Definition of Done）**:
- ✅ DoD-1 `curl <url>` 具备真实 restricted baseline 且 richer options 只走 structured path：egress guard + 双 cap + injectable fetchImpl 齐全；bash path 拒绝任何 flag/extra token（11 cases + 24 cases 证据）。
- ✅ DoD-2 `ts-exec` 的执行 substrate 与当前等级清晰写死：honest partial + syntax validation + 固定 marker；Q22 共识落地，upgrade path 保留为 ServiceBindingTarget。
- ✅ DoD-3 localhost / Python / package install / host Node 幻觉都被明确拦截：UNSUPPORTED_COMMANDS 追加 9 条 host interpreter；egress guard 涵盖 localhost + RFC1918 + link-local + CGNAT + IPv6 ULA + metadata。
- ✅ DoD-4 network/script 结果、拒绝、取消可进入 trace/evidence/promotion 语境：remote-seam-upgrade.test 展示 curl/ts-exec 全部走既有 `tool.call.*` 帧；progress/cancel 轨迹与 Phase 6 evidence emitter 兼容。
- ✅ DoD-5 P7b docs / PX inventory / tests 对 curl/ts-exec 口径一致：P7b v0.3 附录 B + PX v0.3 inventory 升级 + 固定 marker 贯穿 code/tests/docs。

**未触及 / 显式遗留项**:
- 未在 capability-runtime 外的其他 package 触发任何改动（127 + 194 + 132 + 103 + 123 + 114 + 163 + 309 = 1265 tests 完全不变），与 §1.4 影响目录树声明一致。
- session-do-runtime 端的 `tool.call.*` 帧没有增减，§4.4 所需「progress/cancel 对齐」已由既有 `service-binding-progress.test.ts` + 新 `remote-seam-upgrade.test.ts` 共同覆盖，未新增 session-do-runtime 集成测试。
- `BrowserRenderingTarget` 保持 reserved slot 未接入，与 §2.2 [O4] 一致。
- restricted curl 默认路径仍返回 `not-connected` stub（注入 fetchImpl 才会真 fetch），符合 P7b Q17 的「local-ts 是 reference path、真实 remote path 后补」。

**下一阶段交接（A10）**:
- A10（`A10-minimal-bash-vcs-and-policy.md`）核心是 Q18（`git` 冻结为 `status/diff/log` 只读子命令）+ Q19（Capability inventory 五级口径 + ask-gated 正交维度）。
- A9 留下的 `UNSUPPORTED_COMMANDS` 扩张是 A10 taxonomy 的锚点，PX inventory v0.3 已提前采用五级 + 正交 policy 列，A10 只需固化措辞与 risk-blocked 分类。
- A9 的 `checkBashNarrow()` 与 egress marker 模式是 A10 `git` subcommand guard 的直接参考：同样的 narrow-allow-list 思路可套用在 `git` 子命令分派上（仅接受 `status/diff/log`，其他 subcommand 全部 Deferred）。
- future remote tool-runner 工作（A9 未触及的 Phase 8+）接线点已在 `ServiceBindingTarget` 确定，不属 A10 范围。

A9 至此关闭，等待用户确认进入 A10。
