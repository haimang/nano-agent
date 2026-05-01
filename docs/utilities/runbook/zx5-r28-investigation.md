# ZX5 F5 — R28 verify-cancel deploy 500 根因复盘 runbook

> 写于: 2026-04-28(ZX5 Phase F5 owner-driven 任务模板)
> 适用范围: ZX4 closure §3.1 标记的 R28 deploy-only 500 — `POST /verify {check: capability-cancel}` 在 preview deploy 仍返 500 "Worker threw exception"
> 关联文档: `docs/issue/zero-to-real/ZX4-closure.md` §3.1 + `docs/code-review/zero-to-real/ZX3-ZX4-reviewed-by-{kimi,deepseek}.md`(kimi R4 / deepseek R3)
> 状态: **owner-action template** — 本期 sandbox 拒绝 wrangler tail,需 owner 在自己环境执行下面流程后回填 §2/§3/§4

---

## 0. 何时使用本 runbook

ZX5 启动 Lane F 时(尤其 F1/F2 之前),把 R28 根因定位作为前置任务:
- F1 PermissionRequest hook 改 await/resume 涉及 verify capability-cancel 路径相邻代码
- 若 R28 根因恰好在 RPC 调用栈上层(orchestrator-core User-DO `await rpc` 后某环节抛出),修法可能与 F1 wait-and-resume kernel 共享
- **不解决 R28 直接进 F1**:F1 land 之后再做根因定位会增加排查面

---

## 1. 复现条件

- preview deploy 状态:Phase 7 deploy 后到现在未做 P9 后的部署刷新(本期实际跑了 2 次 P9 后 redeploy,版本 ID 见 ZX4 closure §1.8)
- 复现命令:
  ```sh
  # 在 owner 本地环境
  cd /path/to/nano-agent
  NANO_AGENT_LIVE_E2E=1 node --test test/cross-e2e/03-agent-bash-tool-call-cancel.test.mjs
  ```
- 期望:test 03 仍 fail with 500 "Worker threw exception"

---

## 2. owner ops 流程(本期 sandbox 不能执行,owner 在自己环境跑后回填)

### Step A — 启动 wrangler tail

```sh
cd workers/orchestrator-core
npx wrangler tail nano-agent-orchestrator-core-preview --format=pretty | tee /tmp/zx5-r28-tail-1.log
```

(**说明**:`--format=pretty` 让 stack trace 可读;`tee` 备份到日志文件,以防 stdout buffer 被裁切。)

### Step B — 复现 verify capability-cancel

另一终端跑 cross-e2e 03,或直接:
```sh
# 直接 probe,绕过 cross-e2e 测试包装
cat > /tmp/probe-r28.mjs <<'EOF'
import { fetchJson } from "./test/shared/live.mjs";
import { createOrchestratorAuth } from "./test/shared/orchestrator-auth.mjs";
const base = "https://nano-agent-orchestrator-core-preview.haimang.workers.dev";
const sessionId = crypto.randomUUID();
const { jsonHeaders } = await createOrchestratorAuth("zx5-r28");
const start = await fetchJson(`${base}/sessions/${sessionId}/start`, {
  method: "POST", headers: jsonHeaders,
  body: JSON.stringify({ initial_input: "zx5 r28 probe" }),
});
console.log("START", start.response.status);
const verify = await fetchJson(`${base}/sessions/${sessionId}/verify`, {
  method: "POST", headers: jsonHeaders,
  body: JSON.stringify({ check: "capability-cancel", ms: 250, cancelAfterMs: 25 }),
});
console.log("VERIFY", verify.response.status);
console.log("BODY", JSON.stringify(verify.json, null, 2).slice(0, 4000));
EOF
NANO_AGENT_LIVE_E2E=1 node /tmp/probe-r28.mjs
```

### Step C — 在 tail 里抓 stack trace

`wrangler tail` 应该会打出类似:
```
"workers": "nano-agent-orchestrator-core-preview"
"event": "fetch"
"outcome": "exception"
"exceptions": [{
  "name": "...",
  "message": "...",
  "stack": "..."
}]
```

把 exception name + message + stack 三段贴到本文档 §3 raw evidence。

### Step D — 在 agent-core 也 tail 一份(若 orchestrator-core 不显式抛)

orchestrator-core 的 `forwardInternalJsonShadow` 在 ZX4 P9 已加 try/catch
catch RPC throw,但 **如果 throw 的源头是 agent-core 在 RPC 内的 unhandled
rejection**,异常可能逃逸到 Cloudflare 平台层而不是被 try/catch 抓到。

```sh
cd workers/agent-core
npx wrangler tail nano-agent-agent-core-preview --format=pretty | tee /tmp/zx5-r28-tail-2.log
```

重复 Step B 复现,对比两个 tail 的时序。

---

## 3. 复盘记录(owner 回填)

### 3.1 抓到的 stack trace 关键帧

```
[paste exception stack here — keep ≤ 30 lines]
```

### 3.2 根因分类

owner 根据 stack trace 选一项:
- [ ] **A. orchestrator-core User-DO 内部抛**:`forwardInternalJsonShadow` `await rpc` 后某行(D1 query / authority check / response.body cleanup)抛 unhandled。
- [ ] **B. agent-core RPC entrypoint 抛**:`AgentCoreEntrypoint.verify` 在调 verifyCapabilityCancel 时,内部 `transport.call` 即使有 try/catch 仍泄露异常给上层 RPC dispatch,导致 RPC envelope 失败。
- [ ] **C. CF Workers 平台层抛**:I/O cross-request 隔离 / DO state 限制 /  AbortSignal 行为变化等;**这一类无法在代码层修复,只能调整调用模式**。
- [ ] **D. 其他**(注明)

### 3.3 修法决策(per F5-02 三选一)

- [ ] **fix code in ZX5 F5**:根因在 (A) 或 (B),修法 LOC ≤ 30,一并 land 进 ZX5 F5
- [ ] **升级为 ZX5 P0 bug**:根因在 (B/C),需要更大改造 — 把 R28 提升为单独 phase 或独立 hotfix
- [ ] **持续 carryover**:根因在 (C) 且无明确修法,继续作为 known-issue;在 transport-profiles 文档加 caveat

---

## 4. 回填 ZX5 closure 状态

owner 完成 §2/§3 后,在 `docs/issue/zero-to-real/ZX5-closure.md` Lane F F5 行回填:
- 是否定位根因(yes/no)
- 选择的 §3.3 修法分支
- 实际修法的 commit sha / PR(若 fix code 路径)
- `2026-05-12` runbook archive date 是否需要推迟(若 R28 升级为 ZX5 P0)

---

## 5. 历史背景

- ZX2 P3-04:R28 首次在 cross-e2e 03 fail surface
- ZX4 Phase 1:`AbortController + signal` 修法 land,本地单测通过
- ZX4 Phase 7 deploy:R28 仍 fail,被 ack 为 "deploy-only carryover,verification harness only"
- ZX4 Phase 7+:加 outer try/catch defensive wrap,deploy 仍 500
- 4-reviewer review:kimi R4 / deepseek R3 challenge 这是 "carryover 退场而非修复",推动 ZX5 F5 owner-driven 复盘
- ZX5 F5(本 runbook):owner ops 任务,产出 §3.1 stack trace + §3.2 根因 + §3.3 修法决策
