# test/ — 4-worker Live E2E 测试索引

> 2026-04-23 worker-matrix P5 之后建立的新根测试树。
> 测试设计: `GPT-5.4`(v0.1)+ `Claude Opus 4.7 1M context`(v0.2 扩展)
> 索引编写者: `Claude Opus 4.7 (1M context)`

---

## 0. 这个目录是什么 / 不是什么

**是什么**:worker-matrix 收口后,针对 4 workers live preview URL 的 **真 HTTP e2e 测试** 索引。所有测试都向真实的 `*.workers.dev` preview 发 HTTP 请求,断言的是 **部署工件的真实行为**(不是本地 vitest 单测)。

**不是什么**:
- 不是 worker 包内部的 unit tests(那些仍在 `workers/*/test/`)
- 不是 packages 里的 contract / cross tests(已退役到 `test-legacy/` 目录)
- 不是 B7 LIVE root guardian(仍在 `test-legacy/` 下,worker-matrix 期间保持绿)

**运行前提**:
```bash
export NODE_AUTH_TOKEN=<ghp_... with read:packages>   # 仅 pnpm install 时才需要
export NANO_AGENT_LIVE_E2E=1                          # 解锁 e2e 执行(否则全部 skip)
node --test test/package-e2e/**/*.test.mjs test/cross-e2e/*.test.mjs
```

默认 worker URLs(可通过 env 覆盖):
- `agent-core` — `NANO_AGENT_AGENT_CORE_URL`(默认 `https://nano-agent-agent-core-preview.haimang.workers.dev`)
- `bash-core` — `NANO_AGENT_BASH_CORE_URL`(默认 `.../bash-core-preview...`)
- `context-core` — `NANO_AGENT_CONTEXT_CORE_URL`(默认 `.../context-core-preview...`)
- `filesystem-core` — `NANO_AGENT_FILESYSTEM_CORE_URL`(默认 `.../filesystem-core-preview...`)

**当前状态**(2026-04-23 实测):**35 subtests / 35 pass / 0 fail / 0 skip**,wall-clock ~12 秒。

---

## 1. 目录结构

```
test/
├── INDEX.md                      ← 本文件
├── shared/
│   └── live.mjs                  ← harness 辅助(liveTest / fetchJson / expectProbe / randomSessionId)
├── package-e2e/                  ← 每个 worker 独立负责自己的 preview surface
│   ├── agent-core/               (6 test files / 10 subtests)
│   ├── bash-core/                (6 test files / 10 subtests)
│   ├── context-core/             (2 test files / 2 subtests)
│   └── filesystem-core/          (2 test files / 2 subtests)
└── cross-e2e/                    ← 跨 worker 的真实装配、service binding、posture 组合测试
    └── *.test.mjs                (10 test files / 11 subtests)
```

**合计 26 test files / 35 subtests**(16 package-e2e + 10 cross-e2e file count;24 + 11 subtest count)。

---

## 2. shared/ — 公共 harness

### `shared/live.mjs` — live e2e 执行框架
- **提供**:`liveEnabled()` / `workerUrl(worker)` / `liveTest(name, workers, fn)` / `fetchJson(url, init)` / `randomSessionId()` / `expectProbe(body, expected)`
- **`liveTest` 语义**:当 `NANO_AGENT_LIVE_E2E != "1"` 或任一所需 worker 缺 URL 时 → `node:test skip` 跳过;否则真实 `fetch` 执行
- **目的**:让 e2e 测试在 CI 默认状态下不触碰外网(skip),owner 显式 opt-in 才跑,避免破坏本地 / CI 上 `pnpm -r run test` 的常规 fast path

---

## 3. package-e2e/ — 每个 worker 独立验证自己的 preview 表面

### agent-core(6 files / 10 subtests)

| # | 文件 | subtest 数 | 目标 |
|---|------|-----------|------|
| 1 | `package-e2e/agent-core/01-preview-probe.test.mjs` | 1 | **probe 身份**:`GET /` 返回 200 + 字段 `worker="agent-core"` / `status="ok"` / `phase="worker-matrix-P2-live-loop"` / `absorbed_runtime=true` / `live_loop=true` + `capability_binding` 是 boolean。锚定 P2 最终 deploy shape |
| 2 | `package-e2e/agent-core/02-session-edge.test.mjs` | 1 | **HTTP fallback 三件套**:随机 sessionId 下 `POST /sessions/:id/start`(initial_input)→ `GET /sessions/:id/status` → `GET /sessions/:id/timeline`,三者都 200 + `{ok:true, action:"start|status|timeline"}`。证明 SESSION_DO HTTP ingress 真活 |
| 3 | `package-e2e/agent-core/03-initial-context-smoke.test.mjs` | 1 | **initial_context 消费(D05 R1)**:`POST /sessions/:id/start` 携带 `initial_context.intent` + `user_memory` → `POST /sessions/:id/verify { check: "initial-context" }` 返回 `pendingCount>=1` + `assembledKinds` 含 `"session"` + `totalTokens>0`。守护 "映射到 canonical session kind,非 invented initial_context kind" 口径 |
| 4 | `package-e2e/agent-core/04-session-lifecycle.test.mjs` ★v0.2 | 2 | **lifecycle 锚定**:(a) start → cancel → status 三步,各自 200 + `phase="attached"`(cancel 只结束 turn,不结束 session);(b) `/end` 返 HTTP 405 + 错误文案 `/server-emitted/`,锚定 "client 不得直接发 session.end" 不对称契约 |
| 5 | `package-e2e/agent-core/05-multi-turn-input.test.mjs` ★v0.2 | 2 | **multi-turn HTTP 路径**:(a) `/input` 无 `text` → HTTP 400 + `{error:"input requires text"}`;(b) 同 session 下 start + 2 次 `/input`(turn-2 / turn-3) 各 200,之后 `/status` + `/timeline` 仍可达。锚定 followup_input 路径(R2 wire)不因多轮崩溃 |
| 6 | `package-e2e/agent-core/06-verify-unknown-check.test.mjs` ★v0.2 | 2 | **verify 路由 honest-error 合约**:(a) bogus check name 返 HTTP 200 + `{ok:true, action:"verify", check:"...", error:"unknown-verify-check", supported:[5 names]}`;(b) 缺 check 字段同上但 `check:""`。**drift guard**:硬编码 5 canonical check 名,如果未来 verify 集合被增/删,此测试会红,强制同步 INDEX.md |

### bash-core(6 files / 10 subtests)

| # | 文件 | subtest 数 | 目标 |
|---|------|-----------|------|
| 1 | `package-e2e/bash-core/01-preview-probe.test.mjs` | 1 | **probe 身份**:`GET /` 返回 `worker="bash-core"` / `phase="worker-matrix-P1.B-absorbed"` / `absorbed_runtime=true`。锚定 P1.B deploy shape |
| 2 | `package-e2e/bash-core/02-capability-call-route.test.mjs` | 1 | **`/capability/call` 真实执行**:`POST /capability/call { requestId, capabilityName:"pwd", body:{ tool_name:"pwd" } }` → 200 + `{ status:"ok", output:<string> }`。证明 bash-core runtime 已从 P1.B 501 honest-partial 升级到真实 capability dispatch |
| 3 | `package-e2e/bash-core/03-capability-cancel-route.test.mjs` | 1 | **`/capability/cancel` 赛跑**:并发发起 `/capability/call __px_sleep(ms:150)` + 延迟 20ms `/capability/cancel`。断言 cancel 200 + `cancelled` boolean;若 cancel 命中则 call 返 `status:"error", error.code:"cancelled"`。守护 D07 cancel 路径(专用 `__px_sleep` 容器化慢 capability 用于确定性 cancel 测试) |
| 4 | `package-e2e/bash-core/04-capability-sampling.test.mjs` ★v0.2 | 2 | **21-command 注册表抽样**:`pwd`(DEFAULT_WORKSPACE_ROOT 读)+ `ls`(workspace 条目列)— 两个 policy=allow + 零入参即可跑的读操作。各自都 200 + `{status:"ok", output:<string>}`。MINIMAL_COMMANDS registry / policy gate / LocalTsTarget / handler 全链路的 smoke;drift 即红 |
| 5 | `package-e2e/bash-core/05-capability-error-envelopes.test.mjs` ★v0.2 | 3 | **canonical 错误码 taxonomy**:(a) `unknown-tool` via `tool_name:"echo"`(不在 MINIMAL_COMMANDS);(b) `policy-ask` via `tool_name:"curl"`(ask 策略无 authorizer);(c) `handler-error` via `tool_name:"cat"`(allow 策略但空输入 → handler throw)。各自 200 + `{status:"error", error:{code,message}}`。R2 canonical 错误 shape 不得 regress,也不得自造新错误 kind |
| 6 | `package-e2e/bash-core/06-capability-malformed-body.test.mjs` ★v0.2 | 3 | **HTTP 层输入校验**:(a) `text/plain` 非 JSON body → HTTP 400 + `{error:"invalid-json", worker:"bash-core", phase:"worker-matrix-P1.B-absorbed"}`;(b) JSON 但缺 `tool_name` → `invalid-request-shape`,message 匹配 `/tool_name/`;(c) 完全空 `{}` → `invalid-request-shape`。锚定 edge 层校验先于 runtime dispatch 且错误 envelope 携带 worker + phase 观测字段 |

### context-core(2 files / 2 subtests)

| # | 文件 | subtest 数 | 目标 |
|---|------|-----------|------|
| 1 | `package-e2e/context-core/01-preview-probe.test.mjs` | 1 | **library-worker probe**:`GET /` 返回 `phase="worker-matrix-P3-absorbed"` + **`library_worker=true`**。锚定 P3/D03 library-worker 身份(runtime 通过 npm subpath 消费,非 HTTP) |
| 2 | `package-e2e/context-core/02-library-worker-posture.test.mjs` | 1 | **非 probe 路径必 404**:`POST /runtime {smoke:true}` → 404 + body `"Not Found"`。守护 "library worker 不对外暴露 C1/C2 runtime HTTP API" 纪律 |

### filesystem-core(2 files / 2 subtests)

| # | 文件 | subtest 数 | 目标 |
|---|------|-----------|------|
| 1 | `package-e2e/filesystem-core/01-preview-probe.test.mjs` | 1 | **library-worker probe**:`GET /` 返回 `phase="worker-matrix-P4-absorbed"` + `library_worker=true`。锚定 P4/D04 身份 |
| 2 | `package-e2e/filesystem-core/02-library-worker-posture.test.mjs` | 1 | **非 probe 路径必 404**:`POST /runtime` → 404。守护 Q4a host-local posture(D1/D2 substrate 不远端暴露) |

---

## 4. cross-e2e/ — 4-worker 联合覆盖(10 files / 11 subtests)

| # | 文件 | subtest 数 | 涉及 worker | 目标 |
|---|------|-----------|-------------|------|
| 1 | `cross-e2e/01-stack-preview-inventory.test.mjs` | 1 | agent+bash+context+filesystem | **4-worker 联合探针**:并发 `GET /` 4 workers,断言每个 response 200 + `worker` 字段对应正确名字。4-worker topology 一致性的最小证据 |
| 2 | `cross-e2e/02-agent-bash-tool-call-happy-path.test.mjs` | 1 | agent + bash | **agent → bash 真实 tool call happy path**:`POST /sessions/:id/verify { check:"capability-call", toolName:"pwd" }` → 200 + `response.status:"ok"` + `response.output:<string>`。**证明 agent-core 的 BASH_CORE service binding 真活,实际 fetch 到 bash-core 并拿到 pwd 输出**。这是 P2 live loop 的核心契约 |
| 3 | `cross-e2e/03-agent-bash-tool-call-cancel.test.mjs` | 1 | agent + bash | **agent → bash cancel race 验证**:`POST /verify { check:"capability-cancel", ms:250, cancelAfterMs:25 }` 触发 agent 对 bash 的 call + cancel race;断言 `cancelRequested=true` + `cancelHonored` boolean;若 honored 则 `response.error.code:"cancelled"`。守护 D07 agent↔bash cancel 路径 |
| 4 | `cross-e2e/04-agent-context-initial-context.test.mjs` | 1 | agent(context host-local) | **initial_context live 端到端**:`POST /start` 带 `initial_context` → `POST /verify { check:"initial-context" }` 返 `pendingCount>=1` + `assembledKinds` 含 `"session"` + `totalTokens>0`。守护 D05 R1 ownership 归位 + canonical kind 映射 |
| 5 | `cross-e2e/05-agent-context-default-compact-posture.test.mjs` | 1 | agent | **Q3c compact opt-in 在 preview 真活**:`POST /verify { check:"compact-posture" }` 返 `compactDefaultMounted:false`。守护 "default composition 不自动装 createKernelCompactDelegate" 纪律在 deploy artifact 中仍然保持 |
| 6 | `cross-e2e/06-agent-filesystem-host-local-posture.test.mjs` | 1 | agent | **Q4a filesystem host-local 在 preview 真活**:`POST /verify { check:"filesystem-posture" }` 返 `hostLocalFilesystem:true` + `filesystemBindingActive:false` + `capabilityBindingActive:true`。守护 "FILESYSTEM_CORE wrangler binding 保持注释" + BASH_CORE binding 激活 两条 posture 的 deploy-artifact 验证 |
| 7 | `cross-e2e/07-library-worker-topology-contract.test.mjs` | 1 | context + filesystem | **library-worker 拓扑一致性**:对 context-core 和 filesystem-core 同步发 `POST /runtime` 都断言 404。守护 "两个 library worker 都不暴露非 probe 路径" 作为拓扑级 invariant(不是单 worker 级) |
| 8 | `cross-e2e/08-session-lifecycle-cross.test.mjs` ★v0.2 | 1 | agent + bash | **full 生命周期 + mid-session 跨 seam call**:start → input(follow-up)→ verify(capability-call,要求 bash 活)→ cancel → status → timeline 全 200,证明 BASH_CORE binding 在 session 生命周期内不随 turn 结束而失效(DO-level binding 不是 turn-level) |
| 9 | `cross-e2e/09-capability-error-envelope-through-agent.test.mjs` ★v0.2 | 2 | agent + bash | **bash-core 错误 envelope 跨 seam 透传**:(a) `toolName:"echo"` → agent `.response.error.code==="unknown-tool"`;(b) `toolName:"curl"` → agent `.response.error.code==="policy-ask"`。守护 "agent 不 re-wrap / 不 swallow bash 错误"(若 agent 把错误映射成 system.error 即红),R2 canonical 形态跨 worker 保留 |
| 10 | `cross-e2e/10-probe-concurrency-stability.test.mjs` ★v0.2 | 1 | agent+bash+context+filesystem | **32 并发探针(8×4)稳定性**:每 worker 8 fanout 同时 `GET /`;全 200 + 同 worker 间 body deep-equal(worker / phase / absorbed_runtime 字段)+ 32 请求 wall-clock < 10s。DO cold-start / edge 缓存 / subrequest budget / 边缘路由一致性的综合 smoke |

---

## 5. 4-worker 结构覆盖面分析(by Opus,v0.2 更新)

### 5.1 覆盖充分(v0.1 基础 + v0.2 扩展)

| 契约 / posture | 覆盖测试 | 覆盖质量 |
|----------------|----------|----------|
| 4 workers probe shape | package-e2e/*/01 × 4 + cross-e2e/01 + **cross-e2e/10 fan-out**(并发版) | ✅ 强 |
| P2 live loop — HTTP ingress 单步 | package-e2e/agent-core/02 | ✅ |
| P2 live loop — **多轮 HTTP 稳定性** | **package-e2e/agent-core/05**(2 turn)+ **cross-e2e/08**(mid-session 跨 seam) | ✅(v0.2 新增) |
| D05 R1 initial_context canonical kind mapping | package-e2e/agent-core/03 + cross-e2e/04 | ✅ |
| P1.B B1 capability runtime 真实执行 | package-e2e/bash-core/02 + **package-e2e/bash-core/04**(pwd+ls sampling) | ✅(v0.2 扩展 sampling) |
| D07 cancel path(local)| package-e2e/bash-core/03 | ✅ |
| D07 cancel path(cross-worker)| cross-e2e/03 | ✅ |
| P2 BASH_CORE service binding 真活 | cross-e2e/02 + **cross-e2e/08 mid-session 版本** | ✅ |
| Q3c compact opt-in | cross-e2e/05 | ✅ |
| Q4a filesystem host-local + BASH_CORE 激活 | cross-e2e/06 | ✅ |
| library-worker 拓扑 | package-e2e/{context,filesystem}-core/02 + cross-e2e/07 | ✅ |
| **R2 canonical error envelope(无 invented kind)** | **package-e2e/bash-core/05**(3 错误码)+ **cross-e2e/09**(跨 seam 透传) | ✅(v0.2 新增 — 守护 "不自造 system.error") |
| **session 生命周期 asymmetry(cancel vs end)** | **package-e2e/agent-core/04** | ✅(v0.2 新增) |
| **HTTP 层输入校验 — bash-core 边界** | **package-e2e/bash-core/06**(3 种 malformed body) | ✅(v0.2 新增) |
| **verify 路由 drift guard** | **package-e2e/agent-core/06** | ✅(v0.2 新增 — 5 check 名硬断言,增删即红) |
| **并发 / cold-start stability** | **cross-e2e/10**(32 并发)| ✅(v0.2 新增) |

### 5.2 仍未覆盖 / 延后处理

| 契约 / 功能 | 当前状态 | 说明 |
|------------|----------|------|
| WebSocket ingress `session.start` / followup | ⚠ 未覆盖 | 所有测试走 HTTP fallback(`/start` `/input`);WS ingress(A4 SessionWebSocketHelper 的 seq / ACK / replay buffer)没 live e2e。需要 `ws` client;复杂度中高,defer 到下一阶段 |
| B7 LIVE dedup / overflow disclosure | ⚠ 仍在 `test-legacy/` | worker-matrix 期间持续作 root guardian 绿 |
| B9 tenant wrapper live 双租户验证 | ⚠ 未覆盖 | 需要 2-tenant scenario + read-back;当前仅单 sessionId 测试 |
| Hook 事件路径(A4 HookDispatcher)| ⚠ 未覆盖 | PreToolUse / PostToolUse / PermissionRequest / Class B / Class D 事件无 live probe;需要 verify 路由扩增一个 `check:"hook-emission"` |
| Eval sink 持续性(A5 BoundedEvalSink)| ⚠ 未覆盖 | live preview 里 eval 记录 dedup / overflow 行为没 e2e 探针;需要 verify 路由扩增 `check:"eval-sink"` |
| agent-core checkpoint / restore 生命周期 | ⚠ 未覆盖 | `session.resume last_seen_seq` 需要 DO hibernate 再 resume;对 live e2e 来说需要 cold-start 触发 |
| WCA coexistence consumer path | ⚠ 未覆盖 | agent-core 当前仍 import `@nano-agent/workspace-context-artifacts`;e2e 难以辨别 |
| 21 commands 全覆盖 | ⚠ sampling 覆盖 | 目前 `pwd` + `ls`(happy)+ `echo/curl/cat`(error);剩 `rg/head/tail/wc/jq/sed/awk/sort/uniq/diff/git/write/mkdir/rm/mv/cp/ts-exec` 等需真实 `tool_input` 方能测 happy 路径,defer 到后续扩展 |
| production env(prod 域名)| ⚠ 未 flip | 仅 preview URL;待 live loop stability trigger 后再加 |

### 5.3 整体评估(v0.2)

- **v0.1 → v0.2 质量提升点**:
  - 错误 envelope taxonomy 从 "隐式" 升到 "显式 3 错误码断言"(package bash 05 + cross 09)
  - lifecycle 从 "单步 start/status/timeline" 升到 "start → cancel → end asymmetry / multi-turn / cross-session 贯通"
  - 边界校验从 "无覆盖" 升到 "bash-core 边界 3 malformed body 断言"
  - stability 从 "单发探针" 升到 "32 并发 fan-out + body deep-equal"
  - verify 路由从 "隐式消费 check" 升到 "显式 drift guard 硬断言 5 check 名"
- **目前 e2e 定位**:高信号、low-flake、与生产代码解耦(仅通过 `/verify` 探测 harness,不污染 live surface);在 "default skip + env opt-in" 模式下 CI 无影响
- **什么仍要等**:WS / hook / eval / checkpoint 4 件都依赖 verify 路由进一步扩增(或 WebSocket 客户端),建议按需求驱动引入,而不是一次全建

### 5.4 可 backlog 的扩展方向(非 blocker)

1. **WebSocket ingress 测试**:加 `shared/ws.mjs` harness,基于 `ws` npm module 实现 `session.start` 握手 + `session.stream.event` 收取断言;建议封装成专门 `test/ws-e2e/` 层,与 HTTP fallback 分离
2. **hook-emission / eval-sink verify checks**:在 `workers/agent-core/src/host/do/nano-session-do.ts` 增 2 个新 verify 分支,然后 `cross-e2e/` 补对应 2 条测试。增量代码 < 100 行
3. **capability sampling 扩面**:新增 `package-e2e/bash-core/07-capability-sampling-with-input.test.mjs` 覆盖 `cat`(写一个文件先)/ `wc` / `head` 等需要真实文件 IO 的 happy 路径;需要配套 fixture
4. **B9 多租户 isolation**:2 sessionId 同时写入 + 读取,断言 tenant prefix 隔离;需要 verify 路由暴露 DO storage 的 keys 列表探针
5. **production env 切换后**:把 `DEFAULT_URLS` 的 preview 域名列为 override-only,prod 作为新默认,或加 `test/prod-e2e/` 作为平行层

---

## 6. 与 test-legacy/ 的关系

- `test-legacy/` 是 worker-matrix 之前的老根测试树,现已正式 **退役 / 只读**;包含:
  - root contract guards(`test-legacy/*.test.mjs`)含 B7 LIVE 5 tests
  - root e2e(`test-legacy/e2e/*.test.mjs`)11 条早期 e2e
  - A6 verification ladder + fixtures
- 当前 `package.json::scripts.test:contracts / test:e2e / test:cross` 仍指向 `test-legacy/`,保持 worker-matrix 期间 guardians 继续绿;物理删除归 post-worker-matrix 的 Tier B physical-delete 阶段(与 9 个 DEPRECATED packages 同批)
- 本 `test/` 新树专注 **deploy-time live e2e**,不承载 legacy contract;包内 unit test 仍在各 worker 的 `workers/*/test/` 下

---

## 7. 快速索引表(直接可执行)

```bash
# 0. 前置:token + enable flag
export NODE_AUTH_TOKEN=<ghp_... with read:packages>
export NANO_AGENT_LIVE_E2E=1

# 1. 全部 35 subtests
node --test test/package-e2e/**/*.test.mjs test/cross-e2e/*.test.mjs

# 2. 只跑 package-layer(单 worker 范围,24 subtests)
node --test test/package-e2e/**/*.test.mjs

# 3. 只跑 cross-layer(组合装配,11 subtests)
node --test test/cross-e2e/*.test.mjs

# 4. 只跑某个 worker 的 package tests
node --test test/package-e2e/agent-core/*.test.mjs

# 5. 只跑某个 cross test
node --test test/cross-e2e/02-agent-bash-tool-call-happy-path.test.mjs

# 6. 只跑 v0.2 新增的 9 test files
node --test \
  test/package-e2e/agent-core/04-*.test.mjs \
  test/package-e2e/agent-core/05-*.test.mjs \
  test/package-e2e/agent-core/06-*.test.mjs \
  test/package-e2e/bash-core/04-*.test.mjs \
  test/package-e2e/bash-core/05-*.test.mjs \
  test/package-e2e/bash-core/06-*.test.mjs \
  test/cross-e2e/08-*.test.mjs \
  test/cross-e2e/09-*.test.mjs \
  test/cross-e2e/10-*.test.mjs

# 不 export NANO_AGENT_LIVE_E2E → 全部 skip,不发任何 HTTP 请求
```

---

## 8. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-23 | Claude Opus 4.7(1M context)初版索引(GPT-5.4 测试设计) | 17 subtests 索引(10 package-e2e + 7 cross-e2e + 1 shared harness)+ 目标说明 + 覆盖面分析(11 覆盖 / 10 缺口 / 3 backlog)+ test-legacy 关系 + 快速索引表 |
| v0.2 | 2026-04-23 | Claude Opus 4.7(1M context) | **新增 9 test files / 18 subtests**,合计 **35 subtests 全绿**:agent-core(+3 files:04 lifecycle / 05 multi-turn / 06 verify drift guard)+ bash-core(+3 files:04 sampling / 05 error taxonomy / 06 malformed body)+ cross-e2e(+3 files:08 lifecycle-cross / 09 error envelope cross / 10 32-并发 stability)。§5 覆盖面表格重写(覆盖升到 "R2 canonical error" + "lifecycle asymmetry" + "边界校验" + "并发 stability" + "verify drift guard" 5 个新维度);§5.4 4 条 backlog 扩展方向 |
