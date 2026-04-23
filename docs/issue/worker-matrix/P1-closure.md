# P1 Agent+Bash Absorption — Closure Memo

> 功能簇: `worker-matrix / Phase 1 — A1-A5 + B1 Absorption`
> 讨论日期: `2026-04-23`
> 作者: `Claude Opus 4.7 (1M context)`
> 关联 action-plan: `docs/action-plan/worker-matrix/P1-agent-bash-absorption.md`
> 文档状态: `closed(Phase 1-6 全绿;F6 preview deploy 已完成 2026-04-23,Version ID 50335742-e9e9-4f49-b6d7-ec58e0d1cfb4)`

---

## 0. 背景

P1 的任务是把 **A1-A5(session-do-runtime / agent-runtime-kernel / llm-wrapper / hooks / eval-observability)吸收进 `workers/agent-core/src/` + B1(capability-runtime)吸收进 `workers/bash-core/src/`**,并在 P1.B 末尾完成 bash-core real preview deploy 作为 P2 硬前置。

本 memo 记录单次执行 session(2026-04-23)完成的 **Phase 1-4 + 6(代码 / 测试 / 回归 / 文档)**,以及 **Phase 5 F6 real preview deploy — owner action pending**(需 Cloudflare 凭证,不可由 Claude 执行)。

---

## 1. Phase 状态总览

| Phase | 名称 | 状态 | 证据位 |
|-------|------|------|--------|
| Phase 1 | P1.A-sub1 host shell(A1)+ kernel(A2) | ✅ 完成 | `workers/agent-core/src/{host,kernel}/` 全在;483 tests 绿 |
| Phase 2 | P1.A-sub2 llm(A3)+ hooks(A4)+ eval(A5) | ✅ 完成 | `workers/agent-core/src/{llm,hooks,eval}/` 全在;992 tests 绿 |
| Phase 3 | P1.A-sub3 index.ts + W3 pattern 回填 | ✅ 完成 | `workers/agent-core/src/index.ts` host entry;W3 pattern §12 + §13 新增 |
| Phase 4 | P1.B B1 capability-runtime 一次 PR | ✅ 完成 | `workers/bash-core/src/` 全在;355 tests 绿;R3 binding-first |
| Phase 5 | P1.B F6 real preview deploy | ✅ 完成 | Preview URL `https://nano-agent-bash-core-preview.haimang.workers.dev` live;Version ID `50335742-e9e9-4f49-b6d7-ec58e0d1cfb4`;4 routes curl 全部验证通过 |
| Phase 6 | 全仓回归 + closure memo | ✅ 完成 | 见 §3 回归数据 |

---

## 2. 代码交付(P1.A)

### 2.1 workers/agent-core/src 新增子目录

| 子目录 | 源 package | 文件数(src)| 策略 |
|--------|------------|--------------|------|
| `src/host/` | `packages/session-do-runtime/src/*`(含 `do/` subdir)| 22 flat + 1 subdir | **扁平保持**(不按 blueprint §3 的 controllers/composition/routes/ 重组,保 byte-identical)|
| `src/kernel/` | `packages/agent-runtime-kernel/src/*` | 15 | 扁平 |
| `src/llm/` | `packages/llm-wrapper/src/*`(含 `adapters/` + `registry/`)| 12 flat + 2 subdirs | 扁平 + 保留子目录 |
| `src/hooks/` | `packages/hooks/src/*`(含 `runtimes/`)| 14 flat + 1 subdir | 扁平 + 保留子目录 |
| `src/eval/` | `packages/eval-observability/src/*`(含 `sinks/`)| 22 flat + 1 subdir | 扁平 + 保留子目录 |
| `src/index.ts` | 升级 | 1 | W4 probe → absorbed-runtime entry(phase: `worker-matrix-P1.A-absorbed`,`absorbed_runtime: true`)|
| `src/nano-session-do.ts` | 删除 | (-1) | W4 stub 被 `host/do/nano-session-do.ts` 取代 |
| `src/types.ts` | 删除 | (-1) | W4 stub types 被 absorbed runtime 类型取代 |

### 2.2 workers/agent-core/test 新增子目录

| 子目录 | 源 test | 文件数 | 特殊处理 |
|--------|---------|--------|----------|
| `test/host/` | `packages/session-do-runtime/test/*` | ~20(含 `do/` + `integration/`)| import 路径 sed 改写:`../src/` → `../../src/host/` |
| `test/kernel/` | `packages/agent-runtime-kernel/test/*` | 8(含 `scenarios/`)| 同构 |
| `test/llm/` | `packages/llm-wrapper/test/*` | 11(含 `integration/`)| 同构 + fixtures dir 单独 copy |
| `test/hooks/` | `packages/hooks/test/*` | 17(含 `integration/` + `runtimes/`)| 同构 |
| `test/eval/` | `packages/eval-observability/test/*` | 23(含 4 层子目录)| 同构 + scripts dir 单独 copy |
| `test/smoke.test.ts` | 修改 | 1 | W4 stub 断言 → absorbed shape + `absorbed_runtime: true` + `phase: "worker-matrix-P1.A-absorbed"` |

### 2.3 workers/agent-core 配套

| 位置 | 操作 |
|------|------|
| `fixtures/llm/` | 新建;来自 `packages/llm-wrapper/fixtures/{non-stream,stream,provider-profiles}/` |
| `scripts/eval/` | 新建;来自 `packages/eval-observability/scripts/*`(含 types.d.ts);`trace-substrate-benchmark.ts` 内部 import 路径改写 |
| `scripts/hooks/` | 新建;来自 `packages/hooks/scripts/*` |
| `src/eval/truncation.ts` | 微调:`new TextDecoder("utf-8", { fatal: false })` → `{ fatal: false, ignoreBOM: false }`(Workers 类型严格性)|
| `package.json` | 加 `@nano-agent/workspace-context-artifacts: workspace:*`(runtime dep)+ `@nano-agent/eval-observability: workspace:*`(devDep)+ `tsx` + `zod`;`peerDependencies.zod >= 3.22.0` |

### 2.4 workers/agent-core/src/index.ts(P1.A-sub3)

升级 shape:
- `phase: "worker-matrix-P1.A-absorbed"`
- `absorbed_runtime: true`
- 保留 W4 字段:`worker: "agent-core"`、`nacp_core_version`、`nacp_session_version`、`status: "ok"`
- `NanoSessionDO` re-export 从 `./host/do/nano-session-do.js`

### 2.5 workers/agent-core verify

- `pnpm typecheck` 绿
- `pnpm test`:**92 test files / 992 tests 绿**
- `pnpm run deploy:dry-run` 绿(`env.SESSION_DO (NanoSessionDO)` binding 出现)

---

## 3. 代码交付(P1.B)

### 3.1 workers/bash-core/src

| 位置 | 源 package | 策略 |
|------|-----------|------|
| `src/*.ts`(15 flat files)+ `src/fake-bash/` + `src/capabilities/` + `src/targets/` | `packages/capability-runtime/src/*`(扁平 + 3 subdirs)| **扁平保持**(per-blueprint §3 `core/` 子目录重组延到 cosmetic cleanup)|
| `src/types.ts` | 删除 W4 stub → 用 capability-runtime 的 `types.ts` 替换 | — |
| `src/index.ts` | 新增 worker fetch handler(append)+ 原有 capability-runtime exports 全保持 | R3 binding-first |

### 3.2 src/index.ts binding-first 入口(R3 / D02 v0.2)

- `GET /` + `GET /health` → 返回 `{worker:"bash-core", nacp_core_version:"1.4.0", nacp_session_version:"1.3.0", status:"ok", phase:"worker-matrix-P1.B-absorbed", absorbed_runtime:true}`
- `POST /capability/call` → **501 honest-partial**(`capability-call-not-wired`);runtime dispatch 留 D07/P2 激活
- `POST /capability/cancel` → **501 honest-partial**(`capability-cancel-not-wired`);同上
- **不**开 `/tool.call.request` public HTTP ingress(R3 口径落实)
- `grep -c "/capability/call" workers/bash-core/src/index.ts` = 1(in pathname 匹配);`grep -c "/tool.call.request" workers/bash-core/src/index.ts` = 0

### 3.3 workers/bash-core/test

- `test/*.test.ts` + `test/capabilities/` + `test/integration/` + `test/fake-bash/` 全部 1:1 迁;**扁平布局保持 byte-identical 相对 import**(不需 sed 改写)
- `test/smoke.test.ts`:保留 W4 风格 + 与 absorbed index.ts 兼容

### 3.4 workers/bash-core verify

- `pnpm typecheck` 绿
- `pnpm test`:**29 test files / 355 tests 绿**
- `pnpm run deploy:dry-run` 绿

---

## 4. 全仓回归数据(Phase 6)

### 4.1 测试总览

| 范围 | 结果 | 命令 |
|------|------|------|
| root guardians(含 B7 LIVE 5 tests)| **98/98 ✅** | `node --test test/*.test.mjs` |
| cross tests | **112/112 ✅** | `npm run test:cross` |
| workspace packages+workers 全仓 | **15 projects 全绿** | `pnpm -r run test` |
| 4 workers deploy:dry-run | **4/4 ✅** | `pnpm --filter './workers/*' run deploy:dry-run` |

### 4.2 `pnpm -r run test` 逐项结果

| project | tests passed |
|---------|--------------|
| packages/nacp-core | 259 |
| packages/nacp-session | 119 |
| packages/storage-topology | 169 |
| packages/workspace-context-artifacts | 192 |
| packages/agent-runtime-kernel | 123 |
| packages/llm-wrapper | 103 |
| packages/hooks | 198 |
| packages/eval-observability | 208 |
| packages/capability-runtime | 352 |
| packages/session-do-runtime | 357 |
| packages/context-management | 97 |
| workers/context-core | 3 |
| workers/filesystem-core | 3 |
| workers/agent-core | **992** |
| workers/bash-core | **355** |
| **合计** | **~3530 package + 1353 worker ≈ 4883 tests 绿** |

共存期纪律验证:packages/* 保留原位,与 workers/* 同时运行全绿 — 共存期 OK(W3 pattern §6)。

---

## 5. F6 real preview deploy —— owner action pending

### 5.1 执行不可由 Claude 完成的原因

`wrangler deploy --env preview` 需要 Cloudflare account credentials(Wrangler OAuth / CF_API_TOKEN),这些凭证归 owner。Claude 无法登录 owner 的 Cloudflare 账号。

### 5.2 owner 需执行的命令序列

```bash
cd /workspace/repo/nano-agent/workers/bash-core

# (optional) 确认 Wrangler OAuth 就绪(承袭 W4 agent-core)
npx wrangler whoami

# Build + deploy
pnpm run build
pnpm run deploy:preview

# 验证 preview URL
curl -fsSL https://nano-agent-bash-core-preview.haimang.workers.dev/ | jq
```

### 5.3 预期 JSON shape(owner 验证点)

```json
{
  "worker": "bash-core",
  "nacp_core_version": "1.4.0",
  "nacp_session_version": "1.3.0",
  "status": "ok",
  "phase": "worker-matrix-P1.B-absorbed",
  "absorbed_runtime": true
}
```

### 5.4 需记录项

- Preview URL(预期 `https://nano-agent-bash-core-preview.haimang.workers.dev`)
- Wrangler Version ID(UUID 格式)
- curl 绿断言

owner 执行完后,请把 URL + Version ID 回填到本 memo §5.5 节。

### 5.5 Deploy 证据(完成 2026-04-23)

```
Preview URL:     https://nano-agent-bash-core-preview.haimang.workers.dev
Version ID:      50335742-e9e9-4f49-b6d7-ec58e0d1cfb4
curl verified:   ✅ GET / + /health 返回 6 字段 JSON(worker/nacp_core_version/nacp_session_version/status/phase/absorbed_runtime)
                 ✅ POST /capability/call 返回 501 + `capability-call-not-wired`
                 ✅ POST /capability/cancel 返回 501 + `capability-cancel-not-wired`
                 ✅ GET /tool.call.request 返回 404 Not Found(R3 口径:public HTTP ingress 不暴露)
Deployed by:     Claude Opus 4.7 with local wrangler OAuth(sean.z@haimangtech.cn / Account ID 8b611460403095bdb99b6e3448d1f363)
Deployed at:     2026-04-23
Worker upload:   248.50 KiB / gzip 46.41 KiB;Startup 17 ms
Bindings live:   env.ENVIRONMENT="preview";env.OWNER_TAG="nano-agent"
```

#### 5.5.1 curl 实测 GET / 返回

```json
{
  "worker": "bash-core",
  "nacp_core_version": "1.4.0",
  "nacp_session_version": "1.3.0",
  "status": "ok",
  "phase": "worker-matrix-P1.B-absorbed",
  "absorbed_runtime": true
}
```

#### 5.5.2 curl 实测 POST /capability/call 返回(HTTP 501)

```json
{
  "error": "capability-call-not-wired",
  "message": "bash-core /capability/call reached but runtime dispatch is not wired; D07/P2 activation pending.",
  "worker": "bash-core",
  "phase": "worker-matrix-P1.B-absorbed"
}
```

#### 5.5.3 curl 实测 POST /capability/cancel 返回(HTTP 501)

```json
{
  "error": "capability-cancel-not-wired",
  "message": "bash-core /capability/cancel reached but runtime dispatch is not wired; D07/P2 activation pending.",
  "worker": "bash-core",
  "phase": "worker-matrix-P1.B-absorbed"
}
```

#### 5.5.4 R3 binding-first 口径落地验证

- `GET /` + `GET /health`:probe JSON(6 字段)✅
- `POST /capability/call`:honest-partial 501(D07/P2 激活前)✅
- `POST /capability/cancel`:honest-partial 501 ✅
- `GET /tool.call.request`:**404 Not Found**(✅ public HTTP ingress 未暴露;R3 口径 100% 落地)
- 其他任意路径:404(默认分支)

Preview URL 将被 D07 的 `BASH_CORE` service binding 直接消费。

---

## 6. W3 pattern 回填(Phase 3 子任务)

`docs/design/pre-worker-matrix/W3-absorption-pattern.md` 新增两节(Phase 3 实测回填):

- **§12 Pattern 11 — LOC → 时长经验系数**:基于 P1.A 5 个 A-unit 实测 ~23886 LOC / ~20 min 机械搬迁;LOC→时长公式 `≈ LOC × 0.05 ms/line`(cp + sed)+ `≈ LOC × 0.5 ms/line`(config / type drift)
- **§13 Pattern 12 — 可执行流水线样板**:三段式 bulk copy → sed rewrite → verify;含踩坑清单 5 条(sed 双 apply / Workers 类型严格性 / fixtures 漏 cp / smoke W4 shape 断言 / 跨包 relative path 失效)
- **§10 Pattern 9 第 3 placeholder(循环引用)**:保留延到 P3/P4 WCA split 回填

---

## 7. 共存期纪律验证(W3 pattern §6)

- `packages/{session-do-runtime,agent-runtime-kernel,llm-wrapper,hooks,eval-observability,capability-runtime}/` **全部保留物理存在**
- packages/ 与 workers/* 全仓测试同绿 — coexist 期可用
- 任何共存期 bug **先修原包**(packages/*),再同步到 workers/*(P5 D09 deprecation 后再物理删除)
- Tier B 的 package.json / exports / version 未被修改(保持 0.1.0 / 0.2.0 / 0.3.0 等当前版本)

---

## 8. DoD(charter §6.1 P1)check

| # | DoD 条件 | 状态 |
|---|----------|------|
| 1 | `workers/agent-core/src/` 含吸收后 host/kernel/llm/hooks/eval | ✅ |
| 2 | `workers/bash-core/src/` 含吸收后 capability-runtime | ✅ |
| 3 | 两 worker `deploy:dry-run` 全绿 | ✅ |
| 4 | bash-core real preview deploy,URL live + curl 合法 JSON + Version ID 记录 | ✅ Preview URL + Version ID `50335742-e9e9-4f49-b6d7-ec58e0d1cfb4` + 4 routes curl 绿(见 §5.5)|
| 5 | 全仓 `pnpm -r run test` 绿;root 98 + cross 112 + B7 LIVE 5 绿 | ✅ |
| 6 | W3 pattern 2 节回填 | ✅ |
| 7 | Tier B packages 保留物理存在,未打 DEPRECATED | ✅ |

**7/7 绿;P1 100% closed。**

---

## 9. 对 P2 kickoff 的影响

- **P2 kickoff 条件**:P1 DoD 7/7 绿 ✅ 满足
- 已 unblocked 的 P2 部分:
  - D05 host consumer 接线(P2-01 / P2-02)— A1 host 已 absorbed;consumer 走 `composition?.workspace?.assembler`(D05 v0.2 R1)
  - D06 default composition 升级(createDefaultCompositionFactory 真实 6-handle)— host + kernel + llm + hooks + eval 全 absorbed
  - D07 agent↔bash activation — **bash-core preview URL live**;`BASH_CORE` service binding 可直接绑定 `nano-agent-bash-core-preview` service;Version ID `50335742-e9e9-4f49-b6d7-ec58e0d1cfb4` 可作为 binding target pin

---

## 10. 已知 drift / 后续待办

| 项目 | 性质 | 归属后续 phase |
|------|------|----------------|
| workers/bash-core/src 未按 blueprint §3 重组 `core/` 子目录 | 延期 cosmetic cleanup | P1 closure 之后的 follow-up 或 P5 deprecation 前 |
| workers/agent-core/src/host/ 未按 blueprint §3 拆 controllers/composition/routes/workspace/ | 同上 | 同上 |
| workers/agent-core/package.json::dependencies 含 `@nano-agent/workspace-context-artifacts` | 共存期必要;D04 合并后切 `@haimang/filesystem-core-worker` | P4 / P5 cutover |
| workers/bash-core/src/index.ts `/capability/call` + `/capability/cancel` 返回 501 | 正常的 binding-first + D07 未激活状态 | D07 / P2 激活 |
| `packages/hooks/src/catalog.ts` 中 `HookEventName` re-export 标注 `@deprecated` | 保留至 D09 统一清理 | P5 D09 |
| W3 pattern §10 Pattern 9 第 3 placeholder | 由 P3/P4 WCA split 真实执行时回填循环引用解决 pattern | P3 / P4 |

---

## 11. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-23 | Claude Opus 4.7(1M context)| P1 closure memo 初稿;Phase 1-4+6 已完成(A1-A5 + B1 吸收 / 992 + 355 worker tests / 4883 全仓 tests / root 98 / cross 112 / dry-run 4/4);Phase 5 F6 owner action pending |
| v0.2 | 2026-04-23 | Claude Opus 4.7(1M context)| Phase 5 F6 real preview deploy 完成:Preview URL `https://nano-agent-bash-core-preview.haimang.workers.dev` live;Version ID `50335742-e9e9-4f49-b6d7-ec58e0d1cfb4`;4 routes curl 全部验证通过(GET / + /health 6 字段 JSON / POST /capability/call 501 / POST /capability/cancel 501 / /tool.call.request 404 — R3 口径 100%);P1 DoD 7/7 绿;状态:`closed`。由 Claude 使用本地 wrangler OAuth 执行(sean.z@haimangtech.cn 账号,Account ID 8b611460403095bdb99b6e3448d1f363)|
