# test/ — 5-worker Live E2E 测试索引

> 2026-04-24 `orchestration-facade` closed 后的根测试树索引。

---

## 0. 这个目录是什么 / 不是什么

**是什么**：面向 5 个 preview workers 的真实 HTTP / WebSocket live E2E 树。这里断言的是部署到 `*.workers.dev` 的真实行为，不是包内 unit test。

**不是什么**：
- 不是 `workers/*/test/` 下的包内单测
- 不是已归档的 legacy contract 树(ZX3 Phase 5 已物理删除 `test-legacy/`,有价值的 guardians 已迁到 `test/root-guardians/`,fixtures 已迁到 `test/shared/fixtures/`)
- 不是 production 域名 smoke

**运行前提**：

```bash
export NANO_AGENT_LIVE_E2E=1
export NANO_AGENT_ORCHESTRATOR_JWT_SECRET=<must match preview JWT_SECRET>
node --test test/package-e2e/**/*.test.mjs test/cross-e2e/**/*.test.mjs
```

默认 worker URLs（可用 env 覆盖）：

| worker | env | default preview URL |
| --- | --- | --- |
| `agent-core` | `NANO_AGENT_AGENT_CORE_URL` | `https://nano-agent-agent-core-preview.haimang.workers.dev` |
| `orchestrator-core` | `NANO_AGENT_ORCHESTRATOR_CORE_URL` | `https://nano-agent-orchestrator-core-preview.haimang.workers.dev` |
| `bash-core` | `NANO_AGENT_BASH_CORE_URL` | `https://nano-agent-bash-core-preview.haimang.workers.dev` |
| `context-core` | `NANO_AGENT_CONTEXT_CORE_URL` | `https://nano-agent-context-core-preview.haimang.workers.dev` |
| `filesystem-core` | `NANO_AGENT_FILESYSTEM_CORE_URL` | `https://nano-agent-filesystem-core-preview.haimang.workers.dev` |

**当前状态（2026-04-24）**：`47 subtests / 47 pass / 0 fail / 0 skip`

---

## 1. 目录结构

```text
test/
├── INDEX.md
├── shared/
│   ├── live.mjs
│   ├── orchestrator-auth.mjs
│   └── orchestrator-jwt.mjs
├── package-e2e/
│   ├── agent-core/          (1 file)
│   ├── orchestrator-core/   (7 files)
│   ├── bash-core/           (6 files)
│   ├── context-core/        (2 files)
│   └── filesystem-core/     (2 files)
└── cross-e2e/               (11 files)
```

**合计**：`29 files`

---

## 2. shared/ — 公共 harness

| 文件 | 作用 |
| --- | --- |
| `shared/live.mjs` | live opt-in gate、worker URL lookup、`fetchJson()`、`randomSessionId()` |
| `shared/orchestrator-jwt.mjs` | HMAC JWT signer for orchestrator-facing live tests |
| `shared/orchestrator-auth.mjs` | 统一构造 orchestrator bearer token / headers |

说明：
1. `NANO_AGENT_LIVE_E2E != "1"` 时，整棵树 skip，不发真实外网请求。
2. `orchestrator-core` 相关 live tests 需要本地 `NANO_AGENT_ORCHESTRATOR_JWT_SECRET` 与 preview worker 的 `JWT_SECRET` 保持一致。

---

## 3. package-e2e/ — 单 worker preview truth

| worker | 文件数 | 当前定位 |
| --- | --- | --- |
| `agent-core` | `1` | runtime host probe only；public session ingress 已退役 |
| `orchestrator-core` | `7` | canonical public session façade suite |
| `bash-core` | `6` | capability runtime public surface |
| `context-core` | `2` | probe-only library worker |
| `filesystem-core` | `2` | probe-only library worker |

### 3.1 `agent-core`

| 文件 | 目标 |
| --- | --- |
| `01-preview-probe.test.mjs` | 只锁定 worker probe / absorbed runtime truth |

> `agent-core` 的 legacy `410/426` negative cases 故意放在 `orchestrator-core/07-*`，因为它们证明的是 **canonical public owner 已切到 orchestrator-core**，不是 agent-core 还拥有 public suite。

### 3.2 `orchestrator-core`

| 文件 | 目标 |
| --- | --- | --- |
| `01-preview-probe.test.mjs` | probe marker 已 rollover 到 `orchestration-facade-closed` |
| `02-session-start.test.mjs` | public start relay + initial_context effect |
| `03-ws-attach.test.mjs` | canonical WS attach / supersede behavior |
| `04-reconnect.test.mjs` | detached reconnect + terminal/missing taxonomy |
| `05-verify-status-timeline.test.mjs` | input/status/timeline/verify/cancel canonical route family |
| `06-auth-negative.test.mjs` | missing / malformed bearer token + trace / tenant negatives |
| `07-legacy-agent-retirement.test.mjs` | legacy `agent-core` HTTP `410` + WS `426` retirement proof |

### 3.3 `bash-core`

- probe
- `/capability/call`
- `/capability/cancel`
- command sampling
- canonical error taxonomy
- malformed body edge validation

### 3.4 `context-core` / `filesystem-core`

两者继续锁定 **probe-only library worker posture**：`GET /` 可用、非 probe 路径 404。

---

## 4. cross-e2e/ — 真实装配与 owner cutover

| 文件 | 目标 |
| --- | --- |
| `01-stack-preview-inventory.test.mjs` | 5-worker inventory |
| `02-agent-bash-tool-call-happy-path.test.mjs` | `orchestrator-core -> bash-core` happy path |
| `03-agent-bash-tool-call-cancel.test.mjs` | `orchestrator-core -> bash-core` cancel path |
| `04-agent-context-initial-context.test.mjs` | orchestrator public path consumes `initial_context` |
| `05-agent-context-default-compact-posture.test.mjs` | compact delegate stays opt-in |
| `06-agent-filesystem-host-local-posture.test.mjs` | filesystem posture stays host-local |
| `07-library-worker-topology-contract.test.mjs` | context/filesystem remain probe-only |
| `08-session-lifecycle-cross.test.mjs` | full lifecycle + mid-session bash call |
| `09-capability-error-envelope-through-agent.test.mjs` | bash error envelope survives cross seam verbatim |
| `10-probe-concurrency-stability.test.mjs` | 5-worker / 40-request concurrent probe stability |
| `11-orchestrator-public-facade-roundtrip.test.mjs` | final `JWT -> orchestrator -> agent -> bash -> stream back` roundtrip |

---

## 5. 覆盖面总结

| 覆盖主题 | 现状 |
| --- | --- |
| canonical public owner | `orchestrator-core` package suite + affected cross tests 已全部切换 |
| legacy retirement | `agent-core` HTTP `410` / WS `426` 已有 live negative proof |
| JWT ingress | missing / malformed bearer covered |
| reconnect taxonomy | detached / terminal / missing covered |
| bash binding truth | happy / cancel / error envelope 都有 live coverage |
| compact / filesystem posture | 继续由 orchestrator verify checks 锁定 |
| topology truth | 5-worker inventory + 40-request fan-out covered |

仍未覆盖：
1. richer WebSocket ingress beyond current attach/reconnect needs
2. hook / eval sink dedicated live probes
3. checkpoint / hibernation resume cold-start E2E

---

## 6. 快速命令

```bash
# 全量 live suite
export NANO_AGENT_LIVE_E2E=1
export NANO_AGENT_ORCHESTRATOR_JWT_SECRET=<preview JWT secret>
node --test test/package-e2e/**/*.test.mjs test/cross-e2e/**/*.test.mjs

# 只跑 package 层
node --test test/package-e2e/**/*.test.mjs

# 只跑 cross 层
node --test test/cross-e2e/**/*.test.mjs

# 只跑 orchestrator canonical suite
node --test test/package-e2e/orchestrator-core/*.test.mjs
```

---

## 7. 与 `test-legacy/` 的关系(已归档)

`test-legacy/` 已在 ZX3 Phase 5(2026-04-27)物理删除。原树中:
- 5 个有价值的 contract guardians 已迁到 `test/root-guardians/`(参见 `pnpm test:contracts`)。
- 1 个 meta-guardian(`test-command-coverage.test.mjs`)守护测试脚本覆盖,合计 6 文件。
- external-seam fixtures 已迁到 `test/shared/fixtures/external-seams/`。
- 14 个无活跃契约价值的 guardian 已 retire(对应 runtime 已被 absorbed 到 worker,各 worker 的 unit test 自带契约保护)。

新树职责:`test/` 只负责 **deploy-time live E2E**;ZX3 后两棵树的混写已不存在。

---

## 8. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
| --- | --- | --- | --- |
| `v0.4` | 2026-04-28 | Opus 4.7 | ZX3-ZX4 review followup:删除 §7 对 test-legacy 仍然存在的描述(实际已 ZX3 P5 删除);§0 "不是什么" 补加 ZX3 cutover 说明 |
| `v0.3` | 2026-04-24 | GPT-5.4 | F3 cutover:升级到 5-worker index,orchestrator 成为 canonical public owner,agent legacy 退役进入 live negative suite |
| `v0.2` | 2026-04-23 | Claude Opus 4.7 | 扩展 v0.1,加入更多 lifecycle / error / concurrency coverage |
| `v0.1` | 2026-04-23 | Claude Opus 4.7 | 初版 live E2E 索引 |
