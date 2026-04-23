# D07 — agent↔bash `tool.call.*` 激活(含 bash-core 预部署硬前置 + local-ts fallback seam)

> 功能簇: `worker-matrix / agent-bash-activation`
> 讨论日期: `2026-04-23`
> 讨论者: `Claude Opus 4.7 (1M context)`
> 关联调查报告:
> - `docs/plan-worker-matrix.md` §3 I6、§5.3 P2.E0/P2.E/P2.F1/P2.F3、§6.2 P2 DoD(含 GPT R1)、§7 Q2
> - `docs/plan-worker-matrix-reviewed-by-GPT.md` §2 R1、§5.2 Q2
> - `docs/eval/worker-matrix/cross-worker-interaction-matrix.md` §3.1 / §5
> - `docs/design/worker-matrix/D02-bash-core-absorption.md`(bash-core real preview deploy)
> - `docs/design/worker-matrix/D06-default-composition-and-remote-bindings.md`(capability handle Q2a)
> 文档状态: `draft`

---

## 0. 背景与前置约束

cross-worker-interaction-matrix §5 明确:first-wave **唯一** 真正需要 battle-test 的 cross-worker loop 是 `agent.core ↔ bash.core`。本设计负责把这条 loop 从 "seam exists" 变成 "live default transport activated"。

GPT R1 review 明确:**bash-core real preview deploy 必须作为 P2 的显式硬前置**,不是 "风险提示"。本设计将其提升为 P2.E0。

charter Q2a 明确:**default `serviceBindingTransport`**(远端),**`local-ts` 保留为显式 fallback seam**,不是 "默认远端 + 删除 local-ts"。

- **项目定位回顾**:first-wave 不是 "4 个 workers 同时 chatter",而是 "agent.core 作为唯一 session 边缘,`bash.core` 作为首波唯一 remote execution seam";其余两个 worker 首波 host-local。
- **本次讨论的前置共识**:
  - D02 F6 real preview deploy 是 P2.E0 硬前置(GPT R1)
  - D06 F3 在 composition 内把 capability handle default 指向 `serviceBindingTransport`(Q2a)
  - `CAPABILITY_WORKER` service binding name 由 agent-core wrangler 指向 D02 bash-core 的 `nano-agent-bash-core` service
  - `local-ts` 作为 opt-in fallback seam 保留(Q2a + P2.F3)
  - root e2e(P2.F1)验证 tool.call 端到端闭环
- **显式排除的讨论范围**:
  - `initial_context` consumer 闭环(D05 / P2.F2)
  - default composition 的 handle 装配(D06)
  - bash-core src 吸收(D02)
  - context / filesystem workers 的 service binding 激活(charter §4.1 保持注释态)

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**:`agent.core ↔ bash.core tool.call.* activation`
- **一句话定义**:把 `workers/agent-core/wrangler.jsonc` 里注释态的 `BASH_CORE` service binding 转 active(指向 D02 部署后的 `nano-agent-bash-core` service);让 D06 内 capability handle default 走 service-binding 远端;保留 `local-ts` 作 opt-in fallback;新增一条 root e2e 证明闭环。
- **边界描述**:
  - **包含**:bash-core preview deploy prerequisite 验证、`BASH_CORE` binding 激活(wrangler diff)、composition default 改为 service-binding(与 D06 协同)、`local-ts` opt-in seam 保留、root e2e(P2.F1)、`CAPABILITY_TRANSPORT=local-ts` env flag test
  - **不包含**:bash-core src / test 吸收(D02)、bash-core 自己的 real preview deploy(D02 F6)、其他 worker service binding(context/filesystem 保持注释态)
- **关键术语对齐**:

| 术语 | 定义 |
|------|------|
| `BASH_CORE` | agent-core `wrangler.jsonc` 中 service binding name |
| `nano-agent-bash-core` | bash-core wrangler 的 deploy service name(由 D02 F5 / F6 保证) |
| `serviceBindingTransport` | capability-runtime `targets/service-binding.ts` 的 Target 实现;接 `Fetcher` binding |
| `local-ts` fallback seam | env flag `CAPABILITY_TRANSPORT=local-ts` 或 test harness 显式启用的本地路径 |
| P2.E0 | **bash-core real preview deploy 硬前置**(GPT R1) |
| P2.F1 | `tool.call.*` 闭环 root e2e(charter §5.3) |
| P2.F3 | local-ts fallback testable(charter §5.3) |

### 1.2 参考调查报告

- `workers/agent-core/wrangler.jsonc` — 当前注释态 slot
- `packages/capability-runtime/src/targets/service-binding.ts` — serviceBindingTransport 实现
- `docs/plan-worker-matrix-reviewed-by-GPT.md` §2 R1 + §5.2 Q2
- `docs/eval/worker-matrix/cross-worker-interaction-matrix.md` §2 agent↔bash 行、§5 `derived first-wave ordering`

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **架构角色**:first-wave 唯一 cross-worker remote execution loop 的激活;charter exit primary #1 的关键节点
- **服务于**:P2 DoD、charter exit #1 e2e、所有 tool call 真实执行
- **依赖**:D02 F6(bash-core preview deploy live)+ D06 F3(capability handle default 改远端)+ D01 F1(host shell 已搬)+ D05(session.start ingress 仍兼容)
- **被谁依赖**:P2.F1 root e2e、live loop session 的所有 tool call、P5 cutover(cutover 不改 binding 语义,只改版本号)

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|----------|----------|------|
| D02 bash-core | 上游 | 强 | D02 F6 real preview deploy = P2.E0 硬前置 |
| D06 composition | 同周期 | 强 | D06 F3 把 capability default 指向 serviceBinding;本设计配套激活 wrangler |
| D01 host shell | 上游 | 中 | host shell 搬家后,wrangler.jsonc 结构不漂移,本设计只改 `services` 数组 |
| D05 initial_context | 无直接 | 弱 | D05 / D07 两条 P2 独立 e2e |
| D03 context.core | 无直接 | 弱 | 首波无 context → bash |
| D04 filesystem.core | 无直接 | 弱 | bash handler 通过 workspace 消费 filesystem,不走 tool.call |
| charter Q2a | 参考 | 强 | 默认远端 + local-ts 保留 fallback |
| B7 LIVE contract | 非破坏 | 强 | `idFromName(sessionId)` / sink dedup 不变 |

### 2.3 一句话定位陈述

> "在 nano-agent 里,`agent↔bash tool.call activation` 是 **worker-matrix P2 的 cross-worker loop 激活交付物**,负责 **把 workers/agent-core 的 BASH_CORE binding 从注释态转 active 并指向已 live 的 bash-core preview,让 default capability transport 从 undefined 升级为 serviceBindingTransport,保留 local-ts 作 opt-in fallback,并由 P2.F1 root e2e 证明 tool.call 端到端闭环**,对上游(charter exit primary #1)提供 **first-wave 唯一 battle-tested 的远端 execution 路径**,对下游(所有后续 tool call 消费者)要求 **通过 service binding 调用,不绕道**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点

| 被砍项 | 来源 | 砍的理由 | 未来回补 |
|--------|------|----------|----------|
| bash-core 单独开 wrangler env (production) | 对称性 | 首波只 preview | 否(production flip 属下一阶段)|
| 把 `CONTEXT_CORE` / `FILESYSTEM_CORE` binding 同一 PR 内也激活 | 顺手 | Q3c / Q4a host-local;charter §4.1 注释态 | 否 |
| `tool.call.*` 走 command-policy 分流(按 verb 决定远端 / 本地) | 增加复杂度 | Q2a 简单 default 远端 + fallback | 否(需独立 RFC)|
| 把 `local-ts` 删除以减少 target 数 | 简化 | Q2a 保留 | 否 |
| bash-core real preview deploy 移到 D07 做 | 集中 | D02 F6 已做;D07 只消费 URL | 否 |
| 在 D07 PR 内修 `targets/service-binding.ts` | 越界 D02 | byte-identical;bash-core runtime 归 D02 | 否 |

### 3.2 接口保留点

| 扩展点 | 表现形式 | 第一版行为 | 未来演进 |
|--------|----------|------------|----------|
| `CAPABILITY_TRANSPORT` env flag | `serviceBinding` / `local-ts` | default `serviceBinding`;`local-ts` 显式切 | 未来可支持 `policy-based` |
| `BASH_CORE` service binding | wrangler.jsonc `services[]` entry | 指向 `nano-agent-bash-core` | production flip 时改 env(preview → prod)|
| `CONTEXT_CORE / FILESYSTEM_CORE` slots | wrangler 注释态 | **保持注释态**(Q3c / Q4a)| D03/D04 posture 变更时重评 |
| `tool.call.cancel` transport | 走同 service binding | 复用激活的 `BASH_CORE` | 未来 cancel 流控可独立 |
| e2e `tool.call` roundtrip harness | root test helper | `makeToolCallSession()` | 后续 cancel / progress e2e 复用 |

### 3.3 完全解耦点

- **解耦对象**:wrangler binding 配置 vs composition handle factory
- **解耦原因**:wrangler 是 "部署拓扑";factory 是 "运行时组装";两层分离,PR review 易审
- **依赖边界**:wrangler 提供 `env.BASH_CORE` → factory 读取 → serviceBindingTransport 使用

### 3.4 聚合点

- **聚合对象**:`agent.core ↔ bash.core` 作为 first-wave 唯一激活的跨 worker service binding
- **聚合形式**:单一 binding 名(`BASH_CORE`);单一 target service(`nano-agent-bash-core`)
- **为什么不能分散**:其余 bindings(`CONTEXT_CORE / FILESYSTEM_CORE`)若被并行激活会模糊 "first-wave 唯一" 纪律

---

## 4. 三个代表实现对比(内部 precedent)

### 4.1 W4 agent-core wrangler SESSION_DO

- **实现概要**:W4 激活 `SESSION_DO` DO binding
- **借鉴**:wrangler.jsonc 激活模式 / env 注入格式
- **不照抄**:SESSION_DO 是 DO 类型 binding;本设计是 service binding(fetcher)

### 4.2 hook worker `HOOK_WORKER` binding(已 live)

- **实现概要**:hooks 已通过 service binding live
- **借鉴**:service binding + `Fetcher` 类型 / factory 读取 `services.HOOK_WORKER` 模式
- **不照抄**:hooks 是 bidirectional emit/outcome;tool.call 是 request/response

### 4.3 W1 RFC `workspace-rpc` direction

- **实现概要**:workspace RPC 仍 direction-only,不 shipped
- **借鉴**:方向性确认 + "live 需要才升级为 shipped"
- **不照抄**:本设计把 agent↔bash 真正激活(非方向性)

### 4.4 横向对比

| 维度 | W4 SESSION_DO | HOOK_WORKER | W1 direction | **D07** |
|------|---------------|-------------|--------------|---------|
| 类型 | DO binding | service binding | n/a | **service binding** |
| 状态 | active | active | frozen RFC | **active**(P2 内)|
| 前置 | W4 build | hooks worker live | 无 | **D02 F6 real preview deploy**(硬前置)|
| 保留 fallback | n/a | n/a | n/a | **是(local-ts)** |

---

## 5. In-Scope / Out-of-Scope

### 5.1 In-Scope

- **[S1]** P2.E0 prerequisite 验证:D02 F6 bash-core real preview deploy 已完成,`https://nano-agent-bash-core-preview.haimang.workers.dev/` live 且 `curl` 返回合法 JSON(`absorbed_runtime: true`);D07 PR 必须在 PR body 引用 D02 F6 Version ID
- **[S2]** `workers/agent-core/wrangler.jsonc` 编辑:
  - 取消注释 `services: [{ binding: "BASH_CORE", service: "nano-agent-bash-core" }]`(preview env)
  - 保持 `CONTEXT_CORE / FILESYSTEM_CORE` 注释态不动
- **[S3]** `agent-core` preview redeploy:PR 合并后 `pnpm --filter workers/agent-core run deploy:preview`;live probe 返回含 `bash_core_binding_active: true`(或等价) 字段
- **[S4]** D06 F3 capability handle default 走 `serviceBindingTransport`(本设计与 D06 同期落,D06 先 merge 理想,但 PR 可 pair)
- **[S5]** `local-ts` fallback seam 保留:
  - `CAPABILITY_TRANSPORT=local-ts` env flag 可切;`env.CAPABILITY_TRANSPORT` 缺省时 default `serviceBinding`
  - 缺 `BASH_CORE` binding(如 test env)→ fall back `local-ts` + evidence(D06 F3 已处理)
- **[S6]** **root e2e P2.F1**:新增 `test/tool-call-roundtrip-live.test.mjs`(或等价):
  - 构造 `session.start` + `tool.call.request`(e.g. simple `echo` / `ls`)
  - 验证经 `CAPABILITY_WORKER` transport → bash-core → response 回到 agent-core → `session.stream.event` 到 client
  - 断言至少 3 条:(a) no throw;(b) response body legal per `ToolCallResponseBodySchema`;(c) evidence 链含 tool.call emit
- **[S7]** **root e2e P2.F3 fallback seam**:新增 test case 或 suite 验证 `CAPABILITY_TRANSPORT=local-ts` 可切到 local-ts 并仍跑绿 tool.call
- **[S8]** B7 LIVE 5 tests 全绿(每个 sub-PR 都跑)

### 5.2 Out-of-Scope

- **[O1]** bash-core src / test 吸收(D02)
- **[O2]** bash-core real preview deploy 执行(D02 F6)
- **[O3]** composition default 本身实装(D06 F3;本设计只配套)
- **[O4]** initial_context consumer(D05)
- **[O5]** context / filesystem service binding 激活
- **[O6]** production env flip
- **[O7]** `tool.call.*` 按 verb 分流 transport
- **[O8]** cancel / progress 单独 transport 优化
- **[O9]** `CAPABILITY_WORKER` binding 加新 service(如 future `bash-core-canary`)
- **[O10]** 新 tool verb / 扩 21-command

### 5.3 边界清单

| 项目 | 判定 | 理由 |
|------|------|------|
| 本 PR 内同时 flip `context.core` / `filesystem.core` bindings | `out-of-scope` | Q3c/Q4a 明确注释态 |
| bash-core binding 用 "production" env override | `out-of-scope` | 首波只 preview |
| root e2e 用 live preview URL 还是 in-process Miniflare | `in-scope 优先 Miniflare 带 service binding stub;可选 live` | Miniflare 更快;live 由 owner 按需 trigger |
| `local-ts` fallback 在 default env 也要 opt-in | `in-scope` | env flag 显式;default 仍 serviceBinding |
| PR 合并后是否立即升级 production | `out-of-scope` | production flip 属下一阶段 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**:bash-core real preview deploy **硬前置**(GPT R1)而非 "风险提示"
   - **为什么**:没有 bash-core live,agent-core 侧激活 binding 只会得到假红;这是 P2 阻塞点
   - **代价**:D02 F6 必须在 D07 前完成
   - **缓解**:D02 F6 已是硬 DoD;D07 PR body 引用 D02 F6 Version ID

2. **取舍 2**:Q2a default serviceBinding + `local-ts` 保留 fallback
   - **为什么**:远端是真 cross-worker loop;local-ts 是 test/dev/故障回退
   - **代价**:runtime 仍两条路径
   - **缓解**:F5 env flag `CAPABILITY_TRANSPORT`;default 固定 serviceBinding

3. **取舍 3**:只激活 `BASH_CORE`,`CONTEXT_CORE / FILESYSTEM_CORE` 保持注释态
   - **为什么**:Q3c/Q4a host-local;首波不必远端
   - **代价**:4 worker 看起来 "不对称"
   - **缓解**:对称性不是目标;代码真相是 "first-wave 仅 agent↔bash 需要远端"

4. **取舍 4**:root e2e 优先 Miniflare + service-binding stub
   - **为什么**:CI 快 + 不依赖 live deploy auth
   - **代价**:live preview 闭环由 PR 作者手工 `curl`
   - **缓解**:PR body 附 live `curl` 记录作二次证据

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解 |
|------|----------|------|------|
| D07 PR 比 D02 F6 先 merge → agent-core preview redeploy 时 bash-core 不 live | 顺序错 | preview 假红 / session.start 死循环 | PR review gate:D07 必须 reference D02 F6 Version ID;GitHub Actions 可加 pre-check |
| `CAPABILITY_WORKER` binding 名与 bash-core `nano-agent-bash-core` service name 错配 | 拼写 | binding resolve 失败 → silent local-ts fallback | E2E 检查 env `BASH_CORE` resolve 成功并 fetch 真实 bash-core response(通过 headers 签名)|
| B7 LIVE 被破坏 | DO / sink 结构被改 | pre-worker 契约破坏 | 每 sub-PR 跑 `node --test` |
| root e2e 误依赖 live preview | harness 设计 | CI 慢 + flaky | Miniflare + service binding stub;live 作 optional |
| local-ts fallback 被意外默认 | env flag 默认值 | 远端未 battle-test | default 固定 `serviceBinding`;test 覆盖 default env |
| cancel 路径未 test | test case 漏 | cancel silent fail | F6 root e2e 含 cancel case(`tool.call.cancel` 能到达 bash 并被 ack)|

### 6.3 价值

- **对开发者自己**:first-wave 真正 cross-worker loop 活化;tool call 不再 silent undefined
- **对 nano-agent 长期演进**:charter exit primary #1 的核心一环;为 production flip 提供可信 preview baseline
- **对 "上下文管理 / Skill / 稳定性" 杠杆**:
  - 稳定性:e2e 持续守护;local-ts fallback 提供 degraded path 测试
  - Skill:未来 skill.core 如入场,可对称建 `SKILL_WORKER` binding;本设计是范例
  - 上下文管理:context.core 依赖的 tool call outcome 流经稳定路径(D05 evidence 链 + tool.call evidence)

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | P2.E0 prerequisite 验证 | D02 F6 bash-core preview live 引用 | ✅ D07 PR body 附 bash-core preview URL + Version ID + `curl` 输出截图 |
| F2 | wrangler.jsonc 编辑 | 取消 `BASH_CORE` 注释;保留 others 注释 | ✅ diff 只含 `services` 数组 active + 注释 cleanup |
| F3 | agent-core preview redeploy | PR 合并后手工或 CI trigger | ✅ `pnpm --filter workers/agent-core run deploy:preview` 绿;live probe 含 `bash_core_binding_active: true` |
| F4 | composition default 远端(与 D06 F3 协同) | capability handle default 走 serviceBindingTransport | ✅ `env.CAPABILITY_WORKER` 被消费;缺失时 fall back local-ts + evidence |
| F5 | `CAPABILITY_TRANSPORT=local-ts` env flag | opt-in 切 local-ts | ✅ test env 下切换成功;default 仍 serviceBinding |
| F6 | root e2e P2.F1(tool.call 闭环) | new root test | ✅ 3 条断言绿 + cancel case 覆盖 |
| F7 | root e2e P2.F3(local-ts fallback) | test harness 验证 local-ts 可跑 tool.call | ✅ fallback case 绿 |
| F8 | B7 LIVE regression | 每 sub-PR 跑 `node --test test/*.test.mjs` | ✅ 98/98 绿 + B7 LIVE 5/5 绿 |

### 7.2 详细阐述

#### F1: P2.E0 prerequisite 验证

- **输入**:D02 F6 产出的 bash-core preview URL + Version ID
- **输出**:D07 PR body 的 prerequisite 块
- **核心逻辑**:
  - PR body 第一段引用 D02 F6 URL + Version ID + `curl -fsSL <url>/` 的实际 JSON
  - 验证 JSON 含 `absorbed_runtime: true`(或等价 post-B1 flag)
- **一句话收口目标**:✅ **PR body 明确 bash-core preview live + hash + live probe 证据**

#### F2: wrangler.jsonc 编辑

- **输入**:现 `workers/agent-core/wrangler.jsonc` 注释态
- **输出**:diff(仅 `services` 数组 active + 注释 cleanup)
- **核心逻辑**:
  ```jsonc
  "services": [
    { "binding": "BASH_CORE", "service": "nano-agent-bash-core" }
  ],
  // Future service bindings stay commented:
  // { "binding": "CONTEXT_CORE", "service": "nano-agent-context-core" },
  // { "binding": "FILESYSTEM_CORE", "service": "nano-agent-filesystem-core" }
  ```
- **边界情况**:preview env 激活;若有 `env.production` override,保持注释态(production flip 属下阶段)
- **一句话收口目标**:✅ **wrangler.jsonc diff 最小 + clear**

#### F3: agent-core preview redeploy

- **输入**:F2 后 wrangler + F4 后 composition
- **输出**:redeployed agent-core preview URL
- **核心逻辑**:
  1. `pnpm --filter workers/agent-core run build`
  2. `pnpm --filter workers/agent-core run deploy:preview`
  3. `curl -fsSL <agent-core-preview-url>/` 验证 JSON 含 `bash_core_binding_active: true`(index.ts 加一个字段反映 `env.BASH_CORE !== undefined`)
- **边界情况**:redeploy 失败则 PR 不合并
- **一句话收口目标**:✅ **redeploy 成功 + live probe 显示 binding active**

#### F4: composition default 远端

- **输入**:D06 F3
- **输出**:`createDefaultCompositionFactory` 返回的 capability handle 默认是 `ServiceBindingCapability(env.BASH_CORE)`
- **核心逻辑**:D06 F3 已实现;本设计仅验证
- **边界情况**:缺 `env.BASH_CORE` → fall back local-ts + evidence
- **一句话收口目标**:✅ **default composition.capability 是 ServiceBindingCapability;fallback 有 evidence**

#### F5: `CAPABILITY_TRANSPORT=local-ts` env flag

- **输入**:D06 F3
- **输出**:env flag 在 test harness / dev env 可切
- **核心逻辑**:
  - `env.CAPABILITY_TRANSPORT === "local-ts"` → force `LocalTsCapability`
  - default / unset → `serviceBinding`
- **一句话收口目标**:✅ **flag 切换 testable + default 不变**

#### F6: root e2e P2.F1(tool.call 闭环)

- **输入**:Miniflare + service binding stub(指向 in-process bash-core runner);`ToolCallRequestBodySchema` 合法 payload(e.g. `echo "hello"`)
- **输出**:`test/tool-call-roundtrip-live.test.mjs`(或等价 .ts per root test 约定)
- **核心逻辑**:
  1. 启动 in-process agent-core DO + in-process bash-core `CapabilityRunner`
  2. 发 `session.start` → 发 `tool.call.request`
  3. 断言:
     - (a) `session.stream.event` 含 `tool.call.progress` 与 `tool.call.response` 两条
     - (b) response body 合法 `ToolCallResponseBodySchema`
     - (c) BoundedEvalSink 有 evidence `tool_call_emit` + `tool_call_return`
  4. cancel 测试:发 `tool.call.cancel` → 断言 cancel 到达 bash-core 并被 ack
- **边界情况**:
  - live preview URL 可作 optional smoke(harness 不默认依赖)
- **一句话收口目标**:✅ **roundtrip + cancel e2e 全绿**

#### F7: root e2e P2.F3(local-ts fallback)

- **输入**:env flag `CAPABILITY_TRANSPORT=local-ts`
- **输出**:test case(可在 F6 同文件新 describe block)
- **核心逻辑**:
  1. 同 F6 构造 session,但 env 里设 `CAPABILITY_TRANSPORT=local-ts`
  2. 断言 tool.call 仍跑绿(走 `LocalTsCapability`)
- **一句话收口目标**:✅ **fallback case 绿;证明 local-ts 未被删除**

#### F8: B7 LIVE regression

- **输入**:每 sub-PR
- **输出**:CI / 本地 `node --test test/*.test.mjs`
- **一句话收口目标**:✅ **98/98 + B7 LIVE 5/5**

### 7.3 非功能性要求

- **性能目标**:tool.call roundtrip latency(Miniflare)< 50ms;live preview 实测 < 300ms
- **可观测性要求**:evidence 链含 `tool_call_emit` / `tool_call_return` / `capability_transport_used=serviceBinding|local-ts`
- **稳定性要求**:B7 LIVE 全程绿;fallback 不 silent
- **测试覆盖要求**:F6 + F7 root e2e;package-local 不直接涉及(已由 D02 F2 覆盖)

---

## 8. 可借鉴的代码位置清单

### 8.1 现有代码

| 位置 | 内容 | 借鉴点 |
|------|------|--------|
| `workers/agent-core/wrangler.jsonc:26-32`(注释态 slots)| 3 个 future bindings | F2 取消 BASH_CORE 注释 |
| `packages/session-do-runtime/src/remote-bindings.ts:329-390` | `CAPABILITY_WORKER` 装配入口 | F4 参考 |
| `packages/capability-runtime/src/targets/service-binding.ts:90-215` | serviceBindingTransport | F4 runtime 路径 |
| `packages/capability-runtime/src/targets/local-ts.ts`(若存在)| local-ts target | F5 opt-in 路径 |
| `test/b7-round2-integrated-contract.test.mjs` | root e2e 模板 | F6 harness 参照 |
| HOOK_WORKER binding 现有配置 | 已 live service binding | F2 模板 |

### 8.2 W1 RFC 参考

| 位置 | 内容 | 借鉴点 |
|------|------|--------|
| `docs/rfc/nacp-workspace-rpc.md` | direction-only | 参考 "不升级为 shipped" 纪律(但本设计是 live 激活,不是 RFC 升级)|

### 8.3 必须避开的反例

| 位置 | 问题 | 避开理由 |
|------|------|----------|
| 同 PR 激活 `CONTEXT_CORE / FILESYSTEM_CORE` | 违反 Q3c/Q4a | 否 |
| `CAPABILITY_TRANSPORT` default 设为 local-ts | 违反 Q2a | 否 |
| 删除 `local-ts` target 实现 | 违反 Q2a | 否 |
| root e2e 必须 live preview(不用 Miniflare)| CI 慢 / flaky | 否 |
| 在 D07 PR 里 bump `CAPABILITY_WORKER` 语义 | 越界 RFC | 否 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

D07 是 P2 的 cross-worker loop 激活交付物:wrangler 小改 + composition default 切远端(与 D06 协同)+ local-ts opt-in 保留 + 2 条 root e2e(tool.call 闭环 + fallback)。严格依赖 D02 F6 real preview deploy 硬前置(GPT R1)。不激活其他 worker 的 binding。PR 小而精确,风险主要在 PR merge 顺序 + binding service name 拼写。

### 9.2 Value Verdict

| 维度 | 评级 | 说明 |
|------|------|------|
| 贴合度 | **5** | first-wave 唯一 remote loop;charter exit #1 |
| 性价比 | **5** | 代码量小 + 杠杆极高 |
| "上下文 / Skill / 稳定性" 杠杆 | **4** | 稳定性直接受益;skill 未来可复用模式 |
| 开发者友好度 | **5** | wrangler 单 diff;e2e 单测 |
| 风险可控 | **4** | B7 LIVE + e2e + fallback |
| **综合价值** | **4.6** | P2 必做 |

### 9.3 下一步行动

- [ ] **决策确认**:owner approve
- [ ] **关联 PR**:D02 F6 → D06 F3 → D07 F2/F3/F4/F6/F7
- [ ] **待深入调查**:
  - root e2e harness 用 Miniflare 时,service binding stub 如何注入 `Fetcher`?(需要 PR 实际编写时确认 Miniflare API)
  - cancel e2e 对 `tool.call.progress` 的 cancellation 时序断言如何可稳定?(建议:容忍 ≤ 1 progress event 后 cancel)

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-23 | Claude Opus 4.7 | 初稿;基于 charter P2 + GPT R1 + Q2a 编制 |
