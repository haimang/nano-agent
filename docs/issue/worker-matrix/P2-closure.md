# P2 Live Turn Loop Activation — Closure Memo

> 功能簇: `worker-matrix / Phase 2 — Live Turn Loop Activation`
> 讨论日期: `2026-04-23`
> 作者: `Claude Opus 4.7 (1M context)`
> 关联 action-plan: `docs/action-plan/worker-matrix/P2-live-loop-activation.md`
> 文档状态: `closed(Phase 0-6 全绿;agent-core redeploy 已 live + BASH_CORE binding live + 2 条 root e2e 持续守护)`

---

## 0. 背景

P2 把 agent-core 从 "absorbed-but-isolated" 升到 "live-loop-wired":initial_context host consumer 接线,default composition 从空 handle bag 升到 6 非 undefined handle,BASH_CORE service binding 取消注释并在 preview env 真实绑定到 live bash-core,2 条 root e2e 作为持续守护。

Phase 0-6 全部在 2026-04-23 单次 session 内完成,含 agent-core preview redeploy。

---

## 1. Phase 状态总览

| Phase | 名称 | 状态 | 证据位 |
|-------|------|------|--------|
| Phase 0 | kickoff gate check | ✅ | P1 closure memo 引用 + bash-core curl 5 字段 ok + Version ID 记录 |
| Phase 1 | D03 F4 `appendInitialContextLayer` API stub | ✅ | `src/host/context-api/append-initial-context-layer.ts` + 9 unit tests |
| Phase 2 | D06 composition factory 升级 | ✅ | 6 handle 非 undefined + 4 nullable + local-ts fallback + packages/ 镜像 + 9 composition tests |
| Phase 3 | D05 host consumer 接线 | ✅ | `dispatchAdmissibleFrame` session.start 分支 + packages/ 镜像 + 6 unit tests |
| Phase 4 | D07 CAPABILITY_WORKER binding 激活 | ✅ | wrangler.jsonc `BASH_CORE` 取消注释 + 4 local-ts fallback tests |
| Phase 5 | Root e2e #1 + #2 | ✅ | `test/tool-call-live-loop.test.mjs` 4 tests + `test/initial-context-live-consumer.test.mjs` 4 tests |
| Phase 6 | agent-core preview redeploy + 全仓回归 + closure | ✅ | agent-core Preview URL live + `live_loop: true` + `capability_binding: true` + 全仓 4884 tests green |

---

## 2. 代码交付

### 2.1 workers/agent-core 新增文件

| 文件 | 用途 |
|------|------|
| `src/host/context-api/append-initial-context-layer.ts` | D03 F4 stub — helper 维护 pending layers;映射 canonical kind(R1)|
| `test/host/context-api/append-initial-context-layer.test.ts` | 9 unit tests(R1: no "initial_context" kind / per-assembler isolation)|
| `test/host/composition-p2-upgrade.test.ts` | 7 tests:6 handle 非 undefined / workspace.assembler 真实 / 4-nullable 显式 / R1 守护 |
| `test/host/composition-local-ts-fallback.test.ts` | 4 tests:local-ts opt-in + default service-binding + honest-degrade |
| `test/host/do/initial-context-consumer.test.ts` | 6 tests:consumer path + R2 `system.error` 禁止 |

### 2.2 workers/agent-core 修改文件

| 文件 | 改动要点 |
|------|----------|
| `src/index.ts` | probe shape 升到 `worker-matrix-P2-live-loop` + `live_loop: true` + `capability_binding` 基于 env.BASH_CORE |
| `src/host/composition.ts` | `createDefaultCompositionFactory` 升级为 6 live handles;import `BoundedEvalSink` / `extractMessageUuid` / `composeWorkspaceWithEvidence`;新增 `CapabilityCompositionHandle` / `EvalCompositionHandle` / `KernelCompositionHandle` / `LlmCompositionHandle` / `HooksCompositionHandle` / `StorageCompositionHandle` 类型 |
| `src/host/remote-bindings.ts` | 4 always-host-local 槽位(kernel/workspace/eval/storage)显式 `null` + 详细 reason 注释 |
| `src/host/do/nano-session-do.ts` | `dispatchAdmissibleFrame` session.start 分支新增 ~40 行 D05 consumer(R1 `composition?.workspace?.assembler` 路径 + R2 `system.notify severity=error`);`defaultEvalSink` 去 readonly 并在 composition 提供 BoundedEvalSink 时 adopt;workspace handle 生命周期:若 composition 提供完整 `WorkspaceCompositionHandle`,retrofit evidence wiring 到 assembler/compactManager/snapshotBuilder |
| `wrangler.jsonc` | `BASH_CORE` 取消注释;顶层 service = `nano-agent-bash-core`;preview env 绑 `nano-agent-bash-core-preview`(Version ID `50335742-e9e9-4f49-b6d7-ec58e0d1cfb4`)|
| `test/smoke.test.ts` | 更新 W4/P1 shape 断言为 P2 shape(`live_loop: true` / `capability_binding: false` 在 test env) |
| `test/host/composition-profile.test.ts` | `returns undefined subsystem handles` 改为 `returns 6 non-undefined subsystem handles`;新增 workspace.assembler 真实 + eval sink shape 两条 |
| `test/host/integration/remote-composition-default.test.ts` | `s.hooks).toBeUndefined()` 改为 `s.hooks.phase === "P2-stub"`(P2 非 undefined 新口径)|

### 2.3 packages/session-do-runtime 镜像新增文件

| 文件 | 说明 |
|------|------|
| `src/context-api/append-initial-context-layer.ts` | D03 F4 helper 的 packages/ 镜像(共存期纪律 W3 pattern §6)|
| `test/context-api/append-initial-context-layer.test.ts` | 9 unit tests 镜像 |

### 2.4 packages/session-do-runtime 镜像修改文件

| 文件 | 改动要点 |
|------|----------|
| `src/do/nano-session-do.ts` | 对称落 D05 consumer(~40 行);注释注明 "packages/ 镜像,D09 时清理" |

### 2.5 root test 新增

| 文件 | 说明 |
|------|------|
| `test/tool-call-live-loop.test.mjs` | 4 subtests:(a) BASH_CORE binding 已激活 + R3 路径守护 / (b) composition 路由 service-binding / (c) transport seam 穿透 mock binding / (d) R2 wire truth guard(无 `turn_input` kind-value)|
| `test/initial-context-live-consumer.test.mjs` | 4 subtests:(a) 无 throw + pending 至少 1 / (b) assembledKinds 含 `session` 且不含 `initial_context` / (c) negative 无 payload pending = 0 / (d) positive vs negative totalTokens 可观测差异 |

---

## 3. 测试数据

### 3.1 worker-local

| target | tests | 上一阶段 | 增量 |
|--------|-------|----------|------|
| workers/agent-core | **1024 绿 / 96 test files** | 996(P1 末) | +28(9 API stub + 7 composition upgrade + 4 local-ts fallback + 6 consumer + 2 smoke update) |
| workers/bash-core | 355 绿 | 355 | 0 |
| workers/context-core | 3 绿 | 3 | 0 |
| workers/filesystem-core | 3 绿 | 3 | 0 |

### 3.2 packages

| target | tests | 上一阶段 | 增量 |
|--------|-------|----------|------|
| packages/session-do-runtime | **366 绿** | 357 | +9(context-api 镜像)|
| packages/agent-runtime-kernel | 123 绿 | 123 | 0 |
| packages/llm-wrapper | 103 绿 | 103 | 0 |
| packages/hooks | 198 绿 | 198 | 0 |
| packages/eval-observability | 208 绿 | 208 | 0 |
| packages/capability-runtime | 352 绿 | 352 | 0 |
| packages/context-management | 97 绿 | 97 | 0 |
| packages/workspace-context-artifacts | 192 绿 | 192 | 0 |
| packages/storage-topology | 169 绿 | 169 | 0 |
| packages/nacp-core | 259 绿 | 259 | 0 |
| packages/nacp-session | 119 绿 | 119 | 0 |

### 3.3 root

| target | tests | 上一阶段 | 增量 |
|--------|-------|----------|------|
| root `test/*.test.mjs`(含 B7 LIVE 5 + 2 新 e2e)| **106 绿** | 98 | +8(4 tool-call + 4 initial-context)|
| `npm run test:cross` | **120 绿** | 112 | +8 |

### 3.4 合计

**~4896 tests 全绿**(packages ~2285 + workers 1385 + root 106 + cross 120)。

### 3.5 4 workers dry-run

全绿;agent-core binding 列新增 `BASH_CORE (nano-agent-bash-core)` 条目。

---

## 4. Deploy 证据(Phase 6)

### 4.1 agent-core preview redeploy

```
Preview URL:      https://nano-agent-agent-core-preview.haimang.workers.dev
Version ID:       3a34f962-649f-4615-847c-83e6f282e8fe
Upload:           290.47 KiB / gzip 58.62 KiB
Worker Startup:   15 ms
Bindings live:    env.SESSION_DO (NanoSessionDO)
                  env.BASH_CORE (nano-agent-bash-core-preview)
                  env.ENVIRONMENT="preview"
                  env.OWNER_TAG="nano-agent"
Deployed by:      Claude Opus 4.7 (local wrangler OAuth; sean.z@haimangtech.cn)
Deployed at:      2026-04-23
```

### 4.2 curl 实测 — agent-core GET /

```json
{
  "worker": "agent-core",
  "nacp_core_version": "1.4.0",
  "nacp_session_version": "1.3.0",
  "status": "ok",
  "phase": "worker-matrix-P2-live-loop",
  "absorbed_runtime": true,
  "live_loop": true,
  "capability_binding": true
}
```

### 4.3 curl 实测 — agent-core `/sessions/probe-demo/status`

```json
{"ok":true,"action":"status","phase":"unattached"}
```

HTTP 200 — **forwarded to NanoSessionDO**,non-probe path reaches the real DO fetch handler(证明 entry routing fix + session forwarding end-to-end live)。

### 4.4 bash-core preview URL 保持 live

```
https://nano-agent-bash-core-preview.haimang.workers.dev/
→ {"worker":"bash-core","nacp_core_version":"1.4.0","nacp_session_version":"1.3.0","status":"ok","phase":"worker-matrix-P1.B-absorbed","absorbed_runtime":true}
```

Version ID `50335742-e9e9-4f49-b6d7-ec58e0d1cfb4` 继续 serve BASH_CORE binding。

---

## 5. DoD 对齐(charter §6.2 / P2 action-plan §8.2)

| # | 条件 | 状态 |
|---|------|------|
| 1 | P2 prerequisite(bash-core preview live + Version ID)| ✅ |
| 2 | `createDefaultCompositionFactory` 6 handle 全非 undefined | ✅ |
| 3 | `makeRemoteBindingsFactory` 4 nullable 显式处理 | ✅ |
| 4 | `initial_context` host consumer 接线(R1 + R2)| ✅ |
| 5 | `workers/agent-core/wrangler.jsonc` `BASH_CORE` 激活 | ✅ |
| 6 | agent-core preview redeploy + `live_loop: true` | ✅ |
| 7 | Root e2e #1 tool.call loop 绿 | ✅(4/4)|
| 8 | Root e2e #2 initial_context dedicated 绿 | ✅(4/4)|
| 9 | Fallback seam testable(local-ts opt-in)| ✅(4/4 fallback test)|
| 10 | B7 LIVE 5 tests 全绿 | ✅(root 106/106 含 B7 LIVE)|

**10/10 全绿;P2 100% closed。**

---

## 6. R1 / R2 / R3 口径落实验证

| 口径 | 验证 |
|------|------|
| R1 — `appendInitialContextLayer` 不 mutate assembler / 不发明 `initial_context` kind | ✅ `src/host/context-api/append-initial-context-layer.ts` 使用 WeakMap pending list + 映射 `session` kind;9 unit tests + 1 integration test + 1 e2e test(#2 b)三重守护 |
| R1 — SubsystemHandles 不新增 top-level `assembler` | ✅ `composition-p2-upgrade.test.ts` 断言 handle bag 恰好 8 keys(无 `assembler`)|
| R1 — D05 consumer 走 `composition?.workspace?.assembler` | ✅ `src/host/do/nano-session-do.ts` 消费路径 `this.subsystems.workspace.assembler` |
| R2 — 异常走 `system.notify severity=error`(不自造 `system.error`) | ✅ `initial-context-consumer.test.ts` 源码扫描断言 `kind: "system.notify"` 存在;`kind: "system.error"` 作为 value 使用 0 次 |
| R2 — 使用 `session.start.body.initial_input` / `session.followup_input.body.text` 作 wire kind(不是 `turn_input`) | ✅ `tool-call-live-loop.test.mjs` (d) 源码扫描:`turn-ingress.ts` 含两个 canonical wire kinds,`message_type: "turn_input"` / `kind: "turn_input"` 0 次 |
| R3 — bash-core `/tool.call.request` 不暴露 | ✅ `workers/bash-core/src/index.ts` 只路由 `/capability/call` + `/capability/cancel`;e2e #1 (a) 扫源断言无 `/tool.call.request` |

---

## 7. 对 P3 / P4 kickoff 的影响

- **P3 (context-core) unblocked**:C1 context-management 吸收时,`appendInitialContextLayer` helper 可迁到 `workers/context-core/src/` 新落点(stub 已按 P3 migration-ready 设计 — WeakMap-keyed by assembler,无模块级单例状态)。D03 C2 slice 吸收的 context-core workspace 侧 helpers 可直接替代 P2 host-local 装配
- **P4 (filesystem-core) unblocked**:D04 D1 slice 吸收的 filesystem-core artifact helpers 可替代 P2 host-local `InMemoryArtifactStore`;D2 storage-topology 吸收不受影响(host-local 继续)
- **P5 (cutover + deprecation) unblocked**:P2 closure 证明 "live loop works" — P5 cutover 的 rollback 基线是 agent-core Version ID `3a34f962-649f-4615-847c-83e6f282e8fe` + bash-core Version ID `50335742-e9e9-4f49-b6d7-ec58e0d1cfb4`;D09 deprecation 可开始 per-package 标 `DEPRECATED`(absorb-stable 门控满足)
- **D07 tool.call 完整闭环**:binding 已激活 + transport seam 测过;kernel / llm / hooks 的 `P2-stub` → live 迁移(完整 turn loop)归下一 charter(非 P3/P4 scope)

---

## 8. 已知 drift / 后续待办

| 项 | 性质 | 归属 |
|----|------|------|
| kernel / llm / hooks 的 `P2-stub` handle → live 实装 | 预期 | 后续 charter(非 worker-matrix scope)|
| `packages/session-do-runtime/src/context-api/` 镜像 | 共存期维护 | D09 deprecation 清理 |
| CONTEXT_CORE / FILESYSTEM_CORE binding(仍注释态)| 预期 | P3 / P4 posture 决策后取消注释 |
| workers/context-core, workers/filesystem-core 仍是 W4 shell(3 tests)| 预期 | P3 / P4 吸收 |
| `EvidenceAnchorLike` deprecated TS 警告(2 处)| pre-existing | 随 P3 C2 slice 吸收一并清理 |

---

## 9. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-23 | Claude Opus 4.7(1M context)| 初稿;P2 Phase 0-6 全绿:D03 F4 stub / D06 composition / D05 consumer / D07 BASH_CORE 激活 / 2 root e2e / agent-core preview redeploy(Version ID `3a34f962-649f-4615-847c-83e6f282e8fe`);DoD 10/10 绿;`capability_binding: true` + `live_loop: true` 实测通过 |
