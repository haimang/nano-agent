# PX — Root Test Tree Reset and 4-Worker Live E2E Matrix

> 服务业务簇: `worker-matrix / PX new tests`
> 计划对象: `root test tree rename + new test/ layout + 4-worker live deploy E2E`
> 类型: `rename`(现有 `test/` → `test-legacy/`) + `new`(新的 `test/` live E2E tree) + `reclassify`(legacy vs worker-matrix-first-wave) + `upgrade`(A6 verification ladder 迁入新测试体系)
> 作者: `GPT-5.4`
> 时间: `2026-04-23`
>
> **POST-ZX3 NOTE(2026-04-28)**: 本计划在 ZX3 Phase 5(2026-04-27)收口 — `test-legacy/` 已物理删除,有价值的 guardians 已迁到 `test/root-guardians/`,fixtures 迁到 `test/shared/fixtures/`,14 个无活跃契约的 guardian 已 retire。本文档中所有 `test-legacy/**` 引用仅作为 ZX2 阶段的历史结构快照。当前测试结构请读 `test/INDEX.md` v0.4+ 与 `docs/issue/zero-to-real/ZX3-closure.md`。
> 文件位置:
> - `test-legacy/**`（原根目录 `test/` 全量迁移后保留）
> - `test/package-e2e/**`
> - `test/cross-e2e/**`
> - `test/shared/**`
> - `package.json`
> - `docs/action-plan/worker-matrix/PX-new-tests.md`
> 关联事实 / 文档:
> - `package.json`（当前 `test:contracts / test:e2e / test:cross` 仍指向旧 `test/`）
> - `docs/action-plan/worker-matrix/P1-agent-bash-absorption.md`
> - `docs/action-plan/worker-matrix/P2-live-loop-activation.md`
> - `docs/action-plan/worker-matrix/P3-context-absorption.md`
> - `docs/action-plan/worker-matrix/P4-filesystem-absorption.md`
> - `test/verification/README.md`
> - `test/verification/profiles/manifest.ts`
> 文档状态: `executed`

---

## 0. 执行背景与目标

当前根目录 `test/` 混合承载了四类不同世代、不同用途的资产：

1. 旧 root contract guards（`test/*.test.mjs`）
2. 旧 root E2E（`test/e2e/*.test.mjs`）
3. A6 verification ladder（`test/verification/**`）
4. 一些为 pre-worker-matrix / after-skeleton 时代建立的 fixture / smoke 资产

在 `worker-matrix` 的 4-worker 结构下，这种混合树已经不再适合作为后续 live deploy 验证的长期真相层。我们现在需要一个**全新的根测试主树**，它从一开始就围绕下面两个测试层来组织：

- **包内 E2E(package-internal live E2E)**：每个 worker 自己对自己的 preview/live surface 负责
- **跨包 E2E(cross-package live E2E)**：验证 4-worker 之间的真实装配、service binding、以及 first-wave posture

因此，本 PX 的根决策是：

1. **不删除旧测试**，先把现有 `test/` **整体更名为 `test-legacy/`**
2. **创建新的 `test/`**
3. 新的 `test/` **只承载 worker-matrix 时代的 live deploy E2E 与其 shared harness**
4. 所有新测试必须诚实反映当前 4-worker 真相：  
   - `agent-core` / `bash-core` 有真实 preview/live surface  
   - `context-core` / `filesystem-core` 当前是 **probe-only library workers**
   - `filesystem-core` 当前仍是 **0 runtime consumer**
   - `agent↔bash` 是 first-wave 唯一真实 remote binding seam

---

## 1. 目标结构与命名冻结

### 1.1 目录目标

```text
test-legacy/
├── *.test.mjs
├── e2e/*.test.mjs
├── fixtures/**
└── verification/**

test/
├── shared/
│   ├── fixtures/**
│   ├── profiles/**
│   ├── runner/**
│   └── env/**
├── package-e2e/
│   ├── agent-core/**
│   ├── bash-core/**
│   ├── context-core/**
│   └── filesystem-core/**
└── cross-e2e/**
```

### 1.2 分类定义

| 分类 | 定义 | 断言对象 | 允许依赖 | 不允许混淆 |
|------|------|----------|----------|------------|
| package-internal live E2E | 一个 worker 自己拥有的 preview/live surface 契约 | 单 worker 的 probe / edge / capability / posture | 可依赖 shared harness；必要时可要求 preview-only verification hook | 不把“多 worker 装配结果”伪装成单包责任 |
| cross-package live E2E | 两个及以上 worker 的真实装配、binding、posture 联动 | agent↔bash / agent↔context truth / 4-worker topology | 可调用多个 preview URL；可消费 shared profiles / runner | 不把 package-local probe 冒充成 cross-package verdict |

### 1.3 root scripts 目标

| script | 新含义 | 备注 |
|--------|--------|------|
| `test:legacy:contracts` | `node --test test-legacy/*.test.mjs` | legacy root guards 保留 |
| `test:legacy:e2e` | `node --test test-legacy/e2e/*.test.mjs` | legacy root E2E 保留 |
| `test:legacy:cross` | `node --test test-legacy/*.test.mjs test-legacy/e2e/*.test.mjs` | legacy 一键回归 |
| `test:package-e2e` | `node --test test/package-e2e/**/*.test.mjs` | 新 package-internal live E2E |
| `test:cross-e2e` | `node --test test/cross-e2e/**/*.test.mjs` | 新 cross-package live E2E |
| `test:e2e` | `node --test test/package-e2e/**/*.test.mjs test/cross-e2e/**/*.test.mjs` | 新 canonical E2E |
| `test:cross` | `node --test test/package-e2e/**/*.test.mjs test/cross-e2e/**/*.test.mjs` | 在 cutover 后与 `test:e2e` 同义；不再指向 legacy |

---

## 2. 执行 Phase

### Phase 0 — taxonomy freeze + no-delete policy

- 冻结根测试重构的基本法律：
  - 先 rename，不删除 legacy
  - 旧 `test/` 迁到 `test-legacy/` 后，任何已有资产只能做 **引用迁移 / 脚本改名 / 文档重分类**
  - `test/` 新树从第一天开始就只写 worker-matrix live E2E
- 输出：
  - `PX-new-tests.md`
  - `package.json` 脚本改名方案
  - 目录与命名规范

### Phase 1 — root tree rename + script compatibility

- 把当前根目录 `test/` **整体更名**为 `test-legacy/`
- 同一 PR 内更新根 `package.json`，避免 rename 后脚本立即断裂
- 把引用旧路径的 action-plan / README / review 文档收紧到：
  - “legacy guards 在 `test-legacy/`”
  - “新的 live E2E 在 `test/`”
- 输出：
  - `test-legacy/**`
  - 新 root scripts
  - 文档口径同步

### Phase 2 — shared live harness extraction

- 从 legacy tree 中把可复用的 A6 资产抽出/重写到新 `test/shared/`
- 复用对象：
  - profile manifest 思路
  - verdict bundle 结构
  - smoke runner 思路
- 但新树不再沿用 “L0/L1/L2 mixed inventory” 作为主入口；新入口改为：
  - package-e2e inventory
  - cross-e2e inventory
- 需要新增 **preview-only verification contract**：
  - `agent-core`：可被外部测试 harness 稳定触发的 session/turn/initial_context smoke seam
  - `bash-core`：可被稳定调用与取消的 deterministic capability seam
  - `context-core` / `filesystem-core`：保持 probe-only library-worker posture 的显式断言面

### Phase 3 — package-internal live E2E authoring

- 为 4 个 worker 分别建立 package-e2e 子目录
- 每个 worker 只写自己拥有的 live truth
- 通过 shared runner 统一：
  - base URL 注入
  - preview env 标识
  - auth / secret loading
  - evidence bundle 输出

### Phase 4 — cross-package live E2E authoring

- 围绕 **4-worker 当前真实装配** 写 cross-package E2E
- 核心不是“模拟未来 chat.core”，而是验证当前 first-wave 真相：
  - agent-core ↔ bash-core remote binding
  - initial_context consumer 经 agent-core live path 生效
  - context/filesystem 仍是 library worker posture
  - filesystem-core 暂无 runtime consumer 不被误写成 live dependency

### Phase 5 — CI / deploy gate cutover

- `test:e2e` / `test:cross` 切换到新树
- legacy 脚本继续保留一个共存期
- PR / milestone / pre-deploy gate 改为同时读取：
  - package-e2e verdict
  - cross-e2e verdict
  - legacy verdict（过渡期）

---

## 3. 预期创建的 package-internal live E2E（全量清单）

> 原则：package-internal 只验证该 worker 自己拥有的 preview/live surface 与 posture，不在这里声称多 worker 集成结论。

### 3.1 `agent-core`

1. `test/package-e2e/agent-core/01-preview-probe.test.mjs`  
   - 证明：preview URL reachable，返回正确 worker identity / env / phase truth
2. `test/package-e2e/agent-core/02-session-edge.test.mjs`  
   - 证明：agent-core 的外部 session edge（HTTP/WS 中最终冻结的那一条）在 preview 环境可 attach / start / ack / close
3. `test/package-e2e/agent-core/03-initial-context-smoke.test.mjs`  
   - 证明：preview-only verification seam 可触发 `initial_context` smoke，且返回可观测 evidence summary

### 3.2 `bash-core`

1. `test/package-e2e/bash-core/01-preview-probe.test.mjs`  
   - 证明：preview URL reachable，registry / worker identity truth 正确
2. `test/package-e2e/bash-core/02-capability-call.test.mjs`  
   - 证明：safe deterministic command 可被 live 调用并返回结构化结果
3. `test/package-e2e/bash-core/03-capability-cancel.test.mjs`  
   - 证明：长时命令的 cancel seam 已真实接线；当前 live verdict 固定 `cancelled=true|false` 的 best-effort truth，并显式暴露是否真的命中运行中执行体

### 3.3 `context-core`

1. `test/package-e2e/context-core/01-preview-probe.test.mjs`  
   - 证明：preview URL reachable，`absorbed_runtime: true` + `library_worker: true` truth 正确
2. `test/package-e2e/context-core/02-library-worker-posture.test.mjs`  
   - 证明：context-core 当前仍是 probe-only library worker，不暴露 runtime HTTP API

### 3.4 `filesystem-core`

1. `test/package-e2e/filesystem-core/01-preview-probe.test.mjs`  
   - 证明：preview URL reachable，`absorbed_runtime: true` + `library_worker: true` truth 正确
2. `test/package-e2e/filesystem-core/02-library-worker-posture.test.mjs`  
   - 证明：filesystem-core 当前仍是 probe-only library worker，不暴露 runtime HTTP API

### 3.5 package-e2e 合计

| worker | 预期测试数 |
|--------|------------|
| `agent-core` | 3 |
| `bash-core` | 3 |
| `context-core` | 2 |
| `filesystem-core` | 2 |
| **合计** | **10** |

---

## 4. 预期创建的 cross-package live E2E（全量清单）

> 原则：cross-package 只声明当前 4-worker first-wave 已经真实存在的装配关系；没有 public facade 的未来能力，不在这里提前造测试幻觉。

1. `test/cross-e2e/01-stack-preview-inventory.test.mjs`  
   - 证明：4 个 preview URL 全部可达，且各自 worker role / posture truth 一致

2. `test/cross-e2e/02-agent-bash-tool-call-happy-path.test.mjs`  
   - 证明：agent-core 经真实 remote seam 调用 bash-core，safe command round-trip 成功

3. `test/cross-e2e/03-agent-bash-tool-call-cancel.test.mjs`  
   - 证明：agent-core 的 remote cancel seam 已真实发出，并在 live verdict 中显式暴露 `cancelRequested` / `cancelHonored`，诚实固定当前 first-wave cancel posture

4. `test/cross-e2e/04-agent-context-initial-context.test.mjs`  
   - 证明：`session.start.initial_context` 经 agent-core live path 被消费，并在 assembly/evidence summary 中产生可观测差异

5. `test/cross-e2e/05-agent-context-default-compact-posture.test.mjs`  
   - 证明：default composition 仍遵守 Q3c，不会在 live path 中默认挂 compact delegate

6. `test/cross-e2e/06-agent-filesystem-host-local-posture.test.mjs`  
   - 证明：current stack 仍坚持 Q4a host-local posture；agent-core 的 live path 不把 `filesystem-core` 当成必需 remote runtime dependency

7. `test/cross-e2e/07-library-worker-topology-contract.test.mjs`  
   - 证明：context-core / filesystem-core 在 4-worker stack 中仍是 library workers；它们的 preview 只承担 probe / posture truth，不承担对外业务 facade

### 4.1 cross-e2e 合计

| 类别 | 预期测试数 |
|------|------------|
| topology / inventory | 2 |
| agent↔bash | 2 |
| agent↔context | 2 |
| agent↔filesystem posture | 1 |
| **合计** | **7** |

---

## 5. Phase 对应的产出映射

| Phase | 主要产出 | 完成标志 |
|------|----------|----------|
| 0 | freeze 文档 + 命名/脚本方案 | `PX-new-tests.md` 落盘 |
| 1 | `test/` → `test-legacy/` rename + 脚本兼容 | root scripts 绿，legacy 路径全通 |
| 2 | `test/shared/**` + preview-only verification contract | package/cross harness 可统一跑 |
| 3 | 10 个 package-e2e | 4 worker 各自 live truth 可独立验证 |
| 4 | 7 个 cross-e2e | 4-worker 当前真实装配可 live 断言 |
| 5 | CI / gate 切换 | `test:e2e` 与 `test:cross` 指向新树 |

---

## 6. 关键 trade-off 与执行纪律

1. **先 rename，不先 delete**  
   - 原因：当前根测试仍是仓库里唯一的大面积 contract truth；直接删除会让 worker-matrix 重写失去回归锚点

2. **package-e2e 与 cross-e2e 分树，不混目录**  
   - 原因：单 worker 自证与多 worker 装配结论不是一回事，必须在文件系统层就切开

3. **context-core / filesystem-core 不假装有“功能 E2E”**  
   - 原因：它们现在的真实身份是 probe-only library workers；package-e2e 只能断言 posture 与 probe truth

4. **cross-package 测试允许要求 preview-only verification seam**  
   - 原因：在没有 `chat.core` 的阶段，很多内部 binding/assembly 真相无法仅靠 public façade 观测；需要受控、显式、只在 preview/dev 生效的验证面

5. **新 `test:e2e` 只代表 worker-matrix live E2E**  
   - 原因：旧 after-skeleton / pre-worker-matrix E2E 不应继续占用 canonical 名字；它们进入 `test-legacy:*`

---

## 7. 最终收口判断

这个 PX 的价值，不是“重新组织一下测试目录”，而是**把仓库级验证语义从 legacy 单体/混合时代，切换到 4-worker live deploy 时代**。

只要本计划执行完成，根目录 `test/` 就会变成一个更诚实的真相层：

- **package-e2e** 负责每个 worker 自证
- **cross-e2e** 负责真实装配验证
- **test-legacy** 负责过渡期回归与历史对照

这会让后续 `worker-chat-core` 阶段的测试扩展更自然：届时只需在新树上增加 `chat-core/` package-e2e 与新的 cross-e2e，不必再回头拆老树。

---

## 8. 2026-04-23 — initial execution slice

- **已完成**
  1. 根目录 `test/` 已整体 rename 为 `test-legacy/`
  2. 根 `package.json` 已完成脚本兼容改写：
     - canonical legacy scripts 继续可跑
     - 新增 `test:package-e2e` / `test:cross-e2e` / `test:live:e2e`
  3. `test-legacy/verification/**`、fixture import、`.gitignore` 等路径已同步到新位置
  4. 已创建新的 `test/shared/live.mjs`
  5. 已落首批新测试：
     - `package-e2e`：10 条
     - `cross-e2e`：3 条（inventory / agent↔bash seam contract / library-worker topology）
  6. `context-core` / `filesystem-core` entry 已收紧为：仅 `GET /` 与 `GET /health` 返回 probe，其余路由 `404`

- **当前仍未完成的 PX 后续项**
  1. `bash-core` `/capability/call` / `/capability/cancel` 仍是 `501 not wired`，尚未升级到真实 happy-path / cancel-path live E2E
  2. `agent-core` 的 preview-only verification seam 仍未补齐，因此：
     - `agent-context-initial-context`
     - `agent-context-default-compact-posture`
     - `agent-filesystem-host-local-posture`
     这些 cross-package live tests 还不能诚实落地
  3. `test:e2e` / `test:cross` 还未切到新树；当前仍保持 legacy canonical path，等待更多 live tests 落地后再做最终 cutover

- **本轮执行判断**
  - Phase 1：**done**
  - Phase 2：**partial**
  - Phase 3：**initial slice landed**
  - Phase 4：**initial slice landed**
  - Phase 5：**not started**

---

## 9. 2026-04-23 — final execution closure and work log

- **最终完成项**
  1. `test/` → `test-legacy/` rename 已完成，legacy root contracts / E2E / verification 资产全部保留在 `test-legacy/**`
  2. 新 `test/` 已按 frozen taxonomy 落成：
     - `test/shared/live.mjs`
     - `test/package-e2e/**`（10 条）
     - `test/cross-e2e/**`（7 条）
  3. root scripts 已完成 canonical cutover：
     - `test:contracts` 继续指向 `test-legacy/*.test.mjs`
     - `test:e2e` / `test:cross` 已切到 `test/package-e2e/**/*.test.mjs test/cross-e2e/**/*.test.mjs`
     - `test:legacy:*` 全部保留
  4. `bash-core` 已从 `501 not wired` 升级为真实 route runtime：
     - `/capability/call` 具备 real happy-path
     - `/capability/cancel` 已真实接线
     - preview 路径新增 `CapabilityCallDO`，把 call/cancel state 从 worker 局部内存提升到 actor seam
  5. `agent-core` 已补齐 preview-only verification seam：
     - `capability-call`
     - `capability-cancel`
     - `initial-context`
     - `compact-posture`
     - `filesystem-posture`
  6. `HttpController.handleStart()` 已把 `initial_context` 正式转送进 `session.start` frame；新 live tests 直接锁住这条路径
  7. `context-core` / `filesystem-core` preview posture 已固定为 probe-only library workers：只接受 `GET /` 与 `GET /health`，非 probe path `404`

- **cancel seam 的最终诚实口径**
  1. `bash-core` 的 standalone HTTP `/capability/cancel` 已不是 placeholder，但它对跨请求 live preview 的语义仍应被视为 **best-effort ack**
  2. 因此 package-e2e 锁定的是：
     - route 可达
     - 返回结构化 `{ ok, cancelled }`
     - 结果不会再伪装成 `501 not wired`
  3. 真正的 first-wave cancel posture 由 `agent-core` preview verification seam 继续补充可观测字段：
     - `cancelRequested`
     - `cancelHonored`
     这让 cross-e2e 可以诚实地固定“remote cancel 已发出，当前 live preview 是否真的命中执行体”

- **本轮新增 / 修改的关键文件**
  1. `package.json`
  2. `test/shared/live.mjs`
  3. `test/package-e2e/**`
  4. `test/cross-e2e/**`
  5. `test-legacy/test-command-coverage.test.mjs`
  6. `workers/bash-core/src/index.ts`
  7. `workers/bash-core/src/worker-runtime.ts`
  8. `workers/bash-core/wrangler.jsonc`
  9. `workers/bash-core/test/smoke.test.ts`
  10. `workers/agent-core/src/host/http-controller.ts`
  11. `workers/agent-core/src/host/do/nano-session-do.ts`
  12. `workers/agent-core/test/host/http-controller.test.ts`

- **本轮执行日志**
  1. 先完成 root tree rename、脚本兼容、legacy path 收口、新 shared harness 与首批 10+3 live tests
  2. 再补 `bash-core` route runtime，使 `/capability/call` 从 placeholder 进入真实执行
  3. 随后补 `agent-core` verify action 与 `initial_context` forwarding，把 cross-worker 可观测性从计划稿变成 preview truth
  4. 为了让 cancel path 不再完全依赖 worker isolate 局部内存，又为 `bash-core` 加入 `CapabilityCallDO` preview actor seam
  5. 最后完成 4 个 preview workers 的 redeploy，并以 live preview URL 跑通 17 条新 E2E

- **最终执行判断**
  - Phase 1：**done**
  - Phase 2：**done**
  - Phase 3：**done**
  - Phase 4：**done**
  - Phase 5：**done**
  - **PX verdict：closed**
