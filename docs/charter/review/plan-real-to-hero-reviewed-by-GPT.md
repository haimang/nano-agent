# Nano-Agent 代码审查

> 审查对象: `docs/charter/plan-real-to-hero.md`
> 审查类型: `docs-review | closure-review`
> 审查时间: `2026-04-29`
> 审查人: `GPT-5.5`
> 审查范围:
> - `docs/charter/plan-real-to-hero.md`
> - `docs/issue/zero-to-real/zero-to-real-final-closure.md`
> - `docs/eval/real-to-hero/closing-thoughts-by-opus.md`
> - `docs/eval/real-to-hero/api-gap-study-by-{GLM,GPT,deepseek,kimi}.md`
> - `docs/eval/real-to-hero/runtime-session-study-by-GPT.md`
> - `docs/code-review/zero-to-real/fully-reviewed-by-{GPT,deepseek,kimi,GLM}.md`
> 对照真相:
> - `docs/charter/plan-zero-to-real.md`
> - `docs/charter/plan-worker-matrix.md`
> - `docs/issue/worker-matrix/worker-matrix-final-closure.md`
> - `docs/action-plan/zero-to-real/ZX5-protocol-hygiene-product-surface-architecture.md`
> 文档状态: `changes-requested`

---

## 0. 总结结论

> `real-to-hero` charter 的总体方向正确，已经把 zero-to-real partial-close 的主体残余、4 家 API gap 共识、runtime-session-study 的巨石拆分路线压成了可执行的 RH0-RH6 阶段框架；但作为“基石纲领”冻结前仍需修改，因为 15 条 deferred 中有 5 条承接不够硬，且 migration/owner-decision/evidence/test 口径存在会影响执行顺序的矛盾。

- **整体判断**：`该 charter 主体成立，但当前仍是高质量 draft，不应直接冻结为 real-to-hero 阶段基石；需要先修正 deferred 映射、migration 编号/owner 决策时点、证据纪律和下游文档 gate。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `执行顺序 RH0 → RH1 → RH2/RH3 → RH4 → RH5 → RH6 总体合理：先补 lockfile/test/deploy/refactor 脚手架，再闭合 Lane F，再做 client visibility / tenant / filesystem / multi-model，最后 evidence 与巨石拆分。`
  2. `zero-to-real final closure §4 的 15 条 deferred 已被大体吸收：10 条明确 covered，5 条 partial；partial 项主要是 token-level streaming/heartbeat/tool-registry/client-helper/quota-bootstrap/multi-tenant-per-deploy/internal-RPC 演进。`
  3. `作为 phase charter，它必须避免再次出现 zero-to-real 的“infra landed 被写成 closed”问题；当前 §4.2/§4.4/§9 对 manual smoke/evidence 的冲突、RH2/RH3 migration 008 共用、以及引用非仓库 memory 的 authoritative decisions 都会削弱这个目标。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-real-to-hero.md`
  - `docs/issue/zero-to-real/zero-to-real-final-closure.md`
  - `docs/eval/real-to-hero/closing-thoughts-by-opus.md`
  - `docs/eval/real-to-hero/runtime-session-study-by-GPT.md`
  - `docs/eval/real-to-hero/api-gap-study-by-{GLM,GPT,deepseek,kimi}.md`
  - `docs/code-review/zero-to-real/fully-reviewed-by-{GPT,deepseek,kimi,GLM}.md`
  - `docs/templates/code-review.md`
- **核查实现 / 文件存在性**：
  - 已核查 `docs/design/real-to-hero/` 与 `docs/action-plan/real-to-hero/` 当前不存在。
  - 已核查 `docs/charter/review/` 既有 review 文档格式。
  - 已核查 `docs/charter/plan-real-to-hero.md` 全文 936 行。
- **执行过的验证**：
  - 文档审查为主，未运行代码测试。
  - 使用文件读取、全文检索、引用路径存在性检查、closure §4 逐项映射。
- **复用 / 对照的既有审查**：
  - `docs/code-review/zero-to-real/fully-reviewed-by-{GPT,deepseek,kimi,GLM}.md` — `仅作为上一阶段已确认 residual 的输入，不把任何 reviewer 的判断直接当作本轮结论；本轮独立对 charter 是否承接这些 residual 做复核。`

### 1.1 已确认的正面事实

- `docs/charter/plan-real-to-hero.md:38-43` 正确把本阶段定义为 `zero-to-real partial-close §4 residual + 4 家 API gap 共识 + runtime-session-study 路线` 的并集，而不是“只补 deferred”或“只补产品端点”。
- `docs/charter/plan-real-to-hero.md:77-85` 冻结了 6-worker、不引入 SQLite-backed DO、jwt-shared single source、三层真相等关键约束；这些约束与 zero-to-real / worker-matrix 的阶段事实一致。
- `docs/charter/plan-real-to-hero.md:123-139` 的 Reality Snapshot 把当前核心 gap 列得比较准：Lane F、/models、/context、device auth gate、filesystem R2/KV、verifyApiKey、team display、巨石、Lane E、jwt-shared lockfile、ZX5 endpoint tests、/me/conversations 双源。
- `docs/charter/plan-real-to-hero.md:171-181` 的全局 In-Scope 基本覆盖 real-to-hero 必须完成的产品闭环：Lane F、client visibility、租户产品面、filesystem 真实化、多模型、多模态、巨石拆分、RH0 前置准备。
- `docs/charter/plan-real-to-hero.md:661-704` 的 Phase 顺序总体成立：RH0 独占、RH1 前置、RH2/RH3 部分并行、RH4 依赖 RH0/RH1、RH5 依赖 RH2/RH4、RH6 放最后。
- `docs/charter/plan-real-to-hero.md:748-778` 的 NOT-success 条件有明确反 over-claim 作用，能防止 Lane F stub、device revoke 半闭合、R2 伪接入、Lane E 永久 dual-track 等问题被错误写成 closed。

### 1.2 已确认的负面事实

- `docs/charter/plan-real-to-hero.md:13-18` 把 direct input 包列为 authoritative，但其中 `docs/design/real-to-hero/*` 与 `docs/action-plan/real-to-hero/*` 当前尚未生成；这些在 §13 被写成后续产物，不能被当作当前可审查依据。
- `docs/charter/plan-real-to-hero.md:81-82,121` 引用 `memory: project_nacp_publish_scope.md`、`reference_local_tooling.md`、`reference_npm_auth.md` 作为 owner decisions / tooling truth，但这些文件不在仓库内，当前 reviewer 无法复核。
- `docs/charter/plan-real-to-hero.md:433` 把 `migration 008-models-and-team-display.sql` 交给 RH2；`docs/charter/plan-real-to-hero.md:468-470,482` 又把 `nano_teams.team_name+slug` 和 `migration 008` 放进 RH3；RH2/RH3 又允许部分并行，migration ownership 会冲突。
- `docs/charter/plan-real-to-hero.md:202` 说“不强制每 Phase 做 live deploy / 真机 / 微信 evidence，只在 RH0/RH6”；但 `docs/charter/plan-real-to-hero.md:240,300,725,733-735` 又说每 Phase 至少一个 manual smoke / preview deploy / endpoint manual smoke 双保险，口径不一致。
- `docs/charter/plan-real-to-hero.md:527-545` 的 full mapping 来自 `closing-thoughts-by-opus`，但 charter 正文没有完整复写；尤其 closure §4 item 4/5/6/7 的承接在正文里仍偏抽象或被“顺带处理”。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 完整读取 `plan-real-to-hero.md`、zero-to-real final closure、closing-thoughts、runtime-session-study、4 家 API gap study 的关键章节。 |
| 本地命令 / 测试 | `no` | 本轮是 charter 文档审查；未改变代码，未运行测试。 |
| schema / contract 反向校验 | `partial` | 只对文档中 migration/RH Phase 编号与 closure item 映射做一致性校验，未重新审查全部源码。 |
| live / deploy / preview 证据 | `no` | 本轮未验证 live preview；charter 中关于 deploy/tooling 的 owner-action 只审查可复核性。 |
| 与上游 design / QNA 对账 | `yes` | 对照 zero-to-real final closure §4、runtime-session-study、api-gap-study、worker-matrix/zero-to-real charter。 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | closure §4 的 15 条 deferred 中有 5 条承接不够硬 | `high` | `scope-drift` | `yes` | 在 charter 正文增加逐项承接表，并把 partial 项明确为 in-scope DoD 或 out-of-scope handoff |
| R2 | RH2/RH3 migration 008 与 owner 决策时点冲突 | `high` | `delivery-gap` | `yes` | 冻结 migration allocation 与 RH2/RH3 并行规则 |
| R3 | manual smoke / preview deploy / 真机 evidence 纪律前后矛盾 | `medium` | `docs-gap` | `yes` | 区分 per-phase smoke、preview deploy、RH6 full manual evidence 三种证据 |
| R4 | authoritative owner decisions 引用不可复核的 `memory:*` 文件 | `medium` | `docs-gap` | `yes` | 将 owner decisions 写入仓库内可引用文档，或改成 unresolved owner questions |
| R5 | design/action-plan 下游文档尚不存在，但 Start Gate 未把 RH0 design/action-plan 作为硬前置 | `medium` | `delivery-gap` | `no` | 在 Start Gate / §13 中加入 RH0 design+action-plan 发布前不得实现 |
| R6 | endpoint-level 测试纪律在全局与各 Phase DoD 中不一致 | `medium` | `test-gap` | `no` | 统一“每 endpoint ≥5 用例”还是“每 Phase ≥N 用例”的口径 |
| R7 | closure §4 item 2 的 token-level streaming 与 snapshot-vs-push 决策仍混在一起 | `medium` | `protocol-drift` | `no` | 明确 token streaming 是否 out-of-scope；若不做，写清 snapshot/push 决策 |

### R1. closure §4 的 15 条 deferred 中有 5 条承接不够硬

- **严重级别**：`high`
- **类型**：`scope-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/issue/zero-to-real/zero-to-real-final-closure.md:99-115` 列出 15 条下一阶段事项。
  - `docs/eval/real-to-hero/closing-thoughts-by-opus.md:527-545` 有完整映射表。
  - `docs/charter/plan-real-to-hero.md` 正文对 item 8-15 覆盖很硬，但对 item 2/4/5/6/7 的承接分散在 RH1/RH2/RH5/RH6/out-of-scope 中，缺少同等强度的 DoD 或显式降级。
- **逐项映射结果**：

| closure §4 item | charter 承接位置 | 本轮判断 | 说明 |
|---|---|---|---|
| 1. manual browser / 微信开发者工具 / 真机证据 | RH6 P6-D / §10.1 | `covered` | RH6 evidence pack 明确。 |
| 2. token-level live streaming 或 snapshot-vs-push 决策 | RH1 usage snapshot/push + RH2 tool streaming | `partial` | usage push 与 tool result 有承接；token-level streaming 是否不做没有明确裁决。 |
| 3. dead `deploy-fill` residue 清理 | RH6 P6-E | `covered` | 明确 cleanup。 |
| 4. DO websocket heartbeat lifecycle platform-fit hardening | closing-thoughts 映射为 RH2 WS NACP “顺带处理” | `partial` | charter 正文没有 heartbeat/ack/alarm/platform-fit 验收。 |
| 5. tool registry 与 client session helper 单一真相源抽取 | RH5 model registry / RH6 三层真相 / catalog plugin out-of-scope | `partial` | tool registry、model registry、client helper 不是同一问题。 |
| 6. richer quota/bootstrap hardening、admin plane、billing/control plane | admin/billing out-of-scope；quota 在 RH1/RH5 边缘 | `partial` | admin/billing 清楚，但 quota/bootstrap hardening 没有拆成 DoD。 |
| 7. broader multi-tenant-per-deploy 与更深 internal RPC 演进 | RH4 namespace / RH6 truth docs / protocol backlog | `partial` | multi-deploy 和 internal RPC 演进应明确降级或承接范围。 |
| 8. D6 device revoke auth gate | RH3 P3-A/P3-E | `covered` | access/refresh/WS gate 与 force-disconnect 明确。 |
| 9. Lane F dispatcher 完整闭合 | RH1 P1-A/B/C | `covered` | delegate/scheduler/waiter/round-trip 明确。 |
| 10. onUsageCommit WS push | RH1 P1-D | `covered` | agent-core→user-do→client WS 明确。 |
| 11. Lane E consumer migration | RH4 P4-D | `covered` | binding、RPC-first、dual-track sunset 明确。 |
| 12. API key verify runtime path | RH3 P3-C | `covered` | verifyApiKey + authenticateRequest 双轨明确。 |
| 13. jwt-shared lockfile | RH0 P0-A | `covered` | standalone build/typecheck/test 与 lockfile 明确。 |
| 14. /me/conversations D1+KV 双源对齐 | RH3 P3-D | `covered` | 双源 + cursor 明确。 |
| 15. ZX5 product endpoints tests | RH0 P0-B | `covered` | 至少 5 条 endpoint tests 明确，但用例数口径需统一。 |

- **为什么重要**：
  - 用户本次特别要求彻查 zero-to-real final closure 中 deferred 的内容是否进入 real-to-hero 阶段。当前 10/15 足够硬，但 5/15 仍可能在执行时被解释成“已经被大概覆盖”，最终再次变成 partial-close 残余。
- **审查判断**：
  - charter 的主方向没有问题，但必须把 15 条 mapping 从 `closing-thoughts` 提升为 charter 正文硬表，并对 partial 项做“本阶段 in-scope DoD / explicit out-of-scope handoff / owner decision needed”三选一。
- **建议修法**：
  - 在 §4 或 §7 前新增 `zero-to-real §4 deferred full inheritance table`。
  - 对 item 4 增加 RH2/RH6 heartbeat lifecycle DoD：ack timeout、alarm cleanup、disconnect/replay、platform close semantics。
  - 对 item 5 明确：tool registry 是否仅保留静态 catalog，client session helper 是否在 RH2/RH6 抽单一 SDK/helper；如果不做，写入 hero-to-platform。
  - 对 item 6 拆分：quota usage snapshot 属 RH1，per-model quota 明确 out-of-scope，bootstrap hardening 属 RH6 或独立 RH0 checklist。
  - 对 item 7 明确：multi-tenant-per-deploy 暂不做；internal RPC contract stabilization 是否在 RH6 三层真相文档或 RH2/RH4 contract tests 中完成。

### R2. RH2/RH3 migration 008 与 owner 决策时点冲突

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/charter/plan-real-to-hero.md:433` 写 `migration 008-models-and-team-display.sql` 在 RH2 落地，包含 `nano_models / nano_teams.team_name+slug`。
  - `docs/charter/plan-real-to-hero.md:468-470` 又把 `nano_teams.team_name+slug` 定义为 RH3 P3-B。
  - `docs/charter/plan-real-to-hero.md:482` 再写 RH3 交付 `migration 008`。
  - `docs/charter/plan-real-to-hero.md:665,700` 允许 RH2 与 RH3 部分并行。
  - `docs/charter/plan-real-to-hero.md:839-843` 把 `team_slug` 策略最晚冻结时点放在 RH3 启动当天，但如果 RH2 先写包含 team display 的 migration 008，这个 owner decision 已经太晚。
- **为什么重要**：
  - migration 编号和 schema ownership 是跨 Phase 并行时最容易冲突的地方。RH2/RH3 如果各自开分支都写 `008`，会制造 rebase / deploy migration 顺序事故。
  - owner decision Q1 的冻结时点必须早于第一个依赖它的 migration，而不是晚于 RH2 schema 写入。
- **审查判断**：
  - 这是 charter 冻结前必须修的执行顺序问题，不是普通文案问题。
- **建议修法**：
  - 明确一张 migration allocation 表，例如：
    - `008-models.sql`：RH2，只建 `nano_models` 与 team model policy。
    - `009-team-display-and-api-keys.sql`：RH3，team_name/team_slug/device/API key 补充。
    - `010-session-files.sql`：RH4。
    - `011-model-capabilities.sql` 或 data seed：RH5。
  - 或者保留单一 `008-models-and-team-display.sql`，但要求 Q1 在 RH2 启动前冻结，并禁止 RH2/RH3 并行修改同一个 migration。

### R3. manual smoke / preview deploy / 真机 evidence 纪律前后矛盾

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/charter/plan-real-to-hero.md:202` 的 O16 写“live deploy / 真机 / 微信开发者工具 evidence 不在每个 Phase 都做，只在 RH0 部署验证 + RH6 manual evidence pack 两点做”。
  - `docs/charter/plan-real-to-hero.md:240` 又写“每 Phase 至少 1 个 manual smoke evidence（preview deploy + curl/WS client 验证）”。
  - `docs/charter/plan-real-to-hero.md:300` 写“每 Phase 交接前必须有 endpoint-level 测试 + manual smoke 双保险”。
  - `docs/charter/plan-real-to-hero.md:725,733-735` 又把 manual smoke / preview deploy / endpoint manual smoke 双保险写成本阶段验证重点和不变量。
- **为什么重要**：
  - evidence 纪律是防止上一阶段 over-claim 的关键。如果“每 Phase smoke”与“只 RH0/RH6 evidence”混用，执行者可以选择宽松解释，导致 phase closure 无法比较。
- **审查判断**：
  - 当前不是方向错误，而是证据术语没有分层。
- **建议修法**：
  - 定义三类 evidence：
    1. `per-phase preview smoke`：每个 Phase 必须做，curl/WS/script 即可。
    2. `owner/manual client evidence`：只要求 RH0 post-fix 与 RH6 全量 pack。
    3. `real-device evidence`：只在 RH6，全旅程覆盖 browser / 微信开发者工具 / 真机。
  - 把 O16 改成“不要求每 Phase 都做真机/微信 full evidence”，而不是“不强制每 Phase live deploy/manual evidence”。

### R4. authoritative owner decisions 引用不可复核的 `memory:*` 文件

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/charter/plan-real-to-hero.md:81` 的 D3 来源是 `memory: project_nacp_publish_scope.md`。
  - `docs/charter/plan-real-to-hero.md:82` 的 D4 来源是 `memory: reference_local_tooling.md`。
  - `docs/charter/plan-real-to-hero.md:121` 又引用 `memory: reference_local_tooling.md + reference_npm_auth.md`。
  - 仓库中未找到这些 `memory` 文件。
- **为什么重要**：
  - phase charter 是团队共享基石，不能依赖某个 agent/session 的私有记忆作为 authoritative source。
  - D4 还涉及 wrangler/gh/npm token 与 deploy 权限，不应被写成不可复核的已冻结事实；它应是可重复验证的 owner-action checklist。
- **审查判断**：
  - D3/D4 的内容可能是真的，但当前引用形态不可审查，不能作为基石文档的稳定依据。
- **建议修法**：
  - 将 D3/D4 移到仓库内 owner decision 记录，例如 `docs/owner-decisions/real-to-hero.md` 或 charter 附录。
  - 对 tooling 权限改写为可执行验证步骤：`wrangler whoami`、`gh auth status`、`pnpm --filter @haimang/jwt-shared build`、R2/KV list 权限检查；不要记录具体 token 或敏感值。
  - 如果 owner 尚未正式确认，则改成 §12 unresolved owner question，而不是 §1 Owner Decision。

### R5. design/action-plan 下游文档尚不存在，但 Start Gate 未把 RH0 design/action-plan 作为硬前置

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/charter/plan-real-to-hero.md:26-29` 与 §13 列出 `docs/design/real-to-hero/*`、`docs/action-plan/real-to-hero/RH{0..6}-*.md` 作为下游预期产物。
  - 当前仓库没有 `docs/design/real-to-hero/` 与 `docs/action-plan/real-to-hero/` 目录。
  - `docs/charter/plan-real-to-hero.md:687-690` 的 Start Gate 只要求 charter stable 与 implementer fix merge，没有要求 RH0 design/action-plan 已发布。
  - `docs/charter/plan-real-to-hero.md:892-898` 建议先写 RH0 design + action-plan，但这只是“建议撰写顺序”，不是 gate。
- **为什么重要**：
  - charter 本身不应展开单 endpoint schema / handler 细节；这点写得对。但如果 RH0 直接开工而没有 RH0 action-plan，jwt-shared lockfile、endpoint tests、KV/R2 binding、NanoSessionDO pure refactor 会在一个大 PR 里失控。
- **审查判断**：
  - 作为 draft 可以接受；作为执行基石冻结前，应把 RH0 design/action-plan 发布列为 Start Gate 或 RH0 entry condition。
- **建议修法**：
  - 在 §8.3 Start Gate 增加：`RH0 design + RH0 action-plan 已发布并通过 review`。
  - 在 §13.4 把“建议撰写顺序”改为“执行前置顺序”：未发布 RH{N} action-plan，不得启动 RH{N} implementation。

### R6. endpoint-level 测试纪律在全局与各 Phase DoD 中不一致

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/charter/plan-real-to-hero.md:721` 写每个新 endpoint 至少 5 用例。
  - `docs/charter/plan-real-to-hero.md:292` 写 RH2 输出“5 个新 endpoint 测试全绿”，但没有说每 endpoint 5 用例。
  - `docs/charter/plan-real-to-hero.md:338-340` 写 RH0 endpoint 直达测试 ≥5 条文件 ≥25 用例，口径较硬。
  - `docs/eval/real-to-hero/closing-thoughts-by-opus.md:248-256` 对 `/context` 只写 3 个测试用例，这与 charter §9.2 的“每 endpoint 5 用例”不同。
- **为什么重要**：
  - real-to-hero 的重要方法论是 endpoint-level closure。如果测试口径不一致，后续 phase closure 容易把“有测试文件”当作“每 endpoint 覆盖足够”。
- **审查判断**：
  - 当前全局纪律是对的，但需要在每个 Phase DoD 中显式复写或引用。
- **建议修法**：
  - 统一为：`每个新增 public endpoint ≥5 endpoint-level cases；每个新增 internal RPC ≥3 contract cases；每个 live runtime path ≥1 e2e + 1 preview smoke`。
  - 在 RH2/RH3/RH4/RH5 收口标准中引用该规则，不再写模糊的“测试全绿”。

### R7. closure §4 item 2 的 token-level streaming 与 snapshot-vs-push 决策仍混在一起

- **严重级别**：`medium`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/issue/zero-to-real/zero-to-real-final-closure.md:102` 写的是“token-level live streaming 或更清晰的 snapshot-vs-push 决策”。
  - `docs/charter/plan-real-to-hero.md:371-372` 覆盖 usage WS push 与 HTTP snapshot。
  - `docs/charter/plan-real-to-hero.md:422-423` 覆盖 WS NACP frame、tool call 增量、tool result frame。
  - `docs/charter/plan-real-to-hero.md:750` 又把 `/messages` 多模态/idempotency 与 WS tool result 纳入 session consumption，但没有明确 token-level LLM delta 是否要升级到 token-level live streaming。
- **为什么重要**：
  - token-level streaming 是客户端体感能力；snapshot-vs-push 是协议一致性决策。它们可以二选一，但不能在 closure 映射中含混带过。
- **审查判断**：
  - real-to-hero 不一定必须做 token-level streaming；但必须在 charter 中给出明确产品/协议决策。
- **建议修法**：
  - 在 RH2 中新增一条：`LLM delta policy`。
  - 选项 A：`token-level streaming in-scope`，则定义 frame、测试、manual smoke。
  - 选项 B：`token-level streaming out-of-scope`，则定义 RH2 只保证 semantic chunk / tool-call streaming，并把 token-level 放到 hero-to-platform/polish。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | 阶段目标：真实 web / mini-program / CLI 可持续使用，而非 demo | `done` | §3 目标清晰，且与 API gap study 的三道闭环一致。 |
| S2 | 6-worker 不变 / 不新增 worker | `done` | §1 D1、§4.4、§10.3 均写入硬纪律。 |
| S3 | 不引入 SQLite-backed DO | `done` | §1 D2、§4.2 O8、runtime-session-study 对齐。 |
| S4 | RH0 bug fix + prep | `partial` | 内容正确；但 RH0 design/action-plan 未列为 Start Gate，且 owner-action 依赖需提前冻结。 |
| S5 | RH1 Lane F live runtime | `done` | hook delegate、scheduler、permission/elicitation、usage push、usage snapshot DoD 明确。 |
| S6 | RH2 client visibility | `partial` | /models、/context、WS NACP、tool result 明确；token-level streaming/heartbeat/test count 需补。 |
| S7 | RH3 tenant product surface | `partial` | device gate/API key/conversations/device binding 明确；migration 008 与 RH2 冲突需修。 |
| S8 | RH4 filesystem + Lane E | `done` | R2/KV/D1、filesystem RPC、agent-core binding、upload pipeline、dual-track sunset 明确。 |
| S9 | RH5 multi-model/multimodal/reasoning | `done` | 13+4+8、model_id、vision、reasoning effort、team policy 均有 DoD。 |
| S10 | RH6 giant-file split + truth + evidence | `done` | NanoSessionDO/user-do split、三层真相、manual evidence、cleanup 明确。 |
| S11 | zero-to-real closure §4 全量承接 | `partial` | 10 covered / 5 partial；见 R1。 |
| S12 | Out-of-Scope 边界 | `partial` | admin/billing/provider/OAuth/SQLite/7th worker 边界清楚；item 5/6/7 的 handoff 需更硬。 |
| S13 | Exit / NOT-success discipline | `done` | §10.1/§10.3 能有效防 over-claim。 |
| S14 | 下游文档生产清单 | `partial` | §13 列得清楚，但缺 execution gate。 |

### 3.1 对齐结论

- **done**: `8`
- **partial**: `6`
- **missing**: `0`
- **stale**: `0`
- **out-of-scope-by-design**: `0`

这更像 **“方向正确、覆盖面足够、但冻结前需要修正执行歧义的 phase charter draft”**，而不是可以直接进入 RH0 implementation 的稳定基石。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | admin plane / billing | `遵守` | §4.2 O1/O2、§11.1 均明确进入 hero-to-platform。 |
| O2 | second LLM provider | `遵守` | §4.2 O3、§11.1 明确延后；RH5 只做 Workers AI 多模型。 |
| O3 | catalog 真实 plug-in registry | `遵守但需补 handoff` | §4.2 O4 延后合理；但 closure item 5 的 tool registry 单一真相源需明确是否就是这个。 |
| O4 | sandbox isolation | `遵守` | §4.2 O5 延后合理。 |
| O5 | OAuth federation | `遵守` | §4.2 O6 延后合理。 |
| O6 | logout / token revocation endpoint | `遵守` | §4.2 O7 延后合理，device revoke 作为核心 first-wave。 |
| O7 | SQLite-backed DO | `遵守` | runtime-session-study 支持该判断。 |
| O8 | 第 7 worker | `遵守` | 6-worker 约束贯穿全文。 |
| O9 | NACP error envelope / 三层错误信封统一 | `遵守但需确认协议 backlog` | §4.2 O10/O11 延后合理；但更深 internal RPC 演进 item 7 需要明确落点。 |
| O10 | 真机/微信 full evidence 每 Phase 都做 | `部分违反/口径冲突` | §4.2 O16 与 §4.4/§9 的每 Phase smoke 表述冲突；需区分 full evidence 与 per-phase smoke。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. `把 zero-to-real final closure §4 的 15 条 deferred 映射表写入 charter 正文，并对 5 条 partial 项给出明确 DoD 或 out-of-scope handoff。`
  2. `修正 RH2/RH3 migration 008 ownership、team_slug owner decision 时点，以及 RH2/RH3 并行修改 schema 的规则。`
  3. `统一 manual smoke / preview deploy / 真机 evidence 的术语和 gate，避免 §4.2 与 §4.4/§9 互相冲突。`
  4. `移除或仓库化不可复核的 memory 引用；D3/D4 等 owner decisions 必须有可审计来源或降为 unresolved owner question。`
- **可以后续跟进的 non-blocking follow-up**：
  1. `把 RH0 design/action-plan 发布加入 Start Gate。`
  2. `统一每 endpoint / internal RPC / live runtime 的测试用例数规则，并在各 Phase DoD 中引用。`
  3. `明确 token-level streaming 是否 real-to-hero in-scope；若否，把 snapshot-vs-push policy 写成 RH2 协议决策。`
  4. `为 tool registry、client session helper、bootstrap hardening、internal RPC 演进补明确 handoff。`
- **建议的二次审查方式**：`same reviewer rereview`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

本轮 review 不收口，等待 charter 作者按 §6 回应并更新 `docs/charter/plan-real-to-hero.md` 后再复审。

---

## 6. 实现者回应

### 6.1 对本轮审查的回应

> 执行者: `Claude Opus 4.7`
> 执行时间: `2026-04-29`
> 回应范围: `R1–R7`
> 对应审查文件: `docs/charter/review/plan-real-to-hero-reviewed-by-GPT.md`

- **总体回应**：7 项 finding 全部 `fixed`（4 项 blocker R1-R4 + 3 项 follow-up R5-R7 一并修复，不留 partial）；`docs/charter/plan-real-to-hero.md` 在 r1 基础上发布 r2，修订历史已记录。
- **本轮修改策略**：所有 reviewer-flagged 模糊空间（migration ownership / evidence 术语 / memory 引用 / token streaming / endpoint test 用例数 / design-action-plan gate / closure §4 partial 项）必须从"分散在多处的隐含约定"提升为"charter 正文显式硬纪律"。
- **实现者自评状态**：`ready-for-rereview`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | closure §4 的 15 条 deferred 中有 5 条承接不够硬 | `fixed` | 新增 §4.0 `zero-to-real final closure §4 deferred 全量继承表（硬性映射）`；15 条全部落到 `in-scope-with-DoD / out-of-scope-handoff / split` 三类。partial 项处理：item 2（token-level streaming）→ RH2 P2-E 决议为 out-of-scope；item 4（DO ws heartbeat lifecycle）→ RH2 P2-C 新增子项 + §9.2 4 用例硬纪律；item 5（tool/model registry + client helper）→ split：model registry → RH5、catalog → RH6 三层真相文档冻结、client helper → out-of-scope；item 6（quota/bootstrap/admin）→ split：quota snapshot → RH1 P1-E、bootstrap hardening → RH0 新增 P0-G、admin/billing → out-of-scope；item 7（multi-tenant-per-deploy + internal RPC 演进）→ out-of-scope-handoff to hero-to-platform。 | `docs/charter/plan-real-to-hero.md` §4.0 新增 + §7.2/§7.3 RH1/RH2 In-Scope 扩展 + §4.2 O 列表更新 |
| R2 | RH2/RH3 migration 008 与 owner 决策时点冲突 | `fixed` | 新增 §8.4 `Migration Allocation Rule`，强制每 RH 至多新增 1 migration 文件且编号严格递增；冻结分配：RH2=008-models.sql（仅 nano_models）、RH3=009-team-display-and-api-keys.sql、RH4=010-session-files.sql、RH5=011-model-capabilities-seed.sql（optional）、RH6=不新增。Q1 最晚冻结时点从"RH3 启动当天"改为"RH2 启动前"。 | §1.2 / §6.1 / §7.3 RH2 / §7.4 RH3 / §7.5 RH4 / §7.6 RH5 / §8.4 / §12 Q1 |
| R3 | manual smoke / preview deploy / 真机 evidence 纪律前后矛盾 | `fixed` | 新增 §9.5 `三层 evidence 定义`：Tier-A `per-phase preview smoke`（每 Phase 必做，curl/WS/script）+ Tier-B `RH0/RH6 owner manual evidence`（仅 RH0/RH6 做）+ Tier-C `RH6 real-device evidence`（仅 RH6）。§4.4 硬纪律 #7 重写为引用 §9.5；§4.2 O16 改为只禁 Tier-B/C 全 phase 化；§9.2 manual smoke 行替换为 §9.5 引用；RH0/RH6 收口标准引用 Tier 编号。 | §4.2 O16 / §4.4 #7 / §9.2 / §9.5（新增）/ §7.1 RH0 收口标准 |
| R4 | authoritative owner decisions 引用不可复核的 `memory:*` 文件 | `fixed` | D3 改为引用仓库内可验证证据（`packages/*/package.json` scope = `@haimang`）；D4 改为"通过 RH0 P0-F owner-action checklist 验证后方可生效"，不再宣称"已默认配置"；§2.1 wrangler/gh 行同样改写为 spike-verified + checklist 待 owner 完成；新增 §7.1 RH0 P0-F deliverable `docs/owner-decisions/real-to-hero-tooling.md`（不含 token，仅含验证步骤与通过/未通过结果）；新增 §12 Q5 显式列为 owner 必须在 RH0 启动当天回答的问题。 | §1.1 D3/D4 / §2.1 / §7.1 RH0 In-Scope+交付物+收口标准 / §12 Q5（新增） |
| R5 | design/action-plan 下游文档尚不存在，但 Start Gate 未把 RH0 design/action-plan 作为硬前置 | `fixed` | §8.3 Start Gate 增加"RH0 design + RH0 action-plan 已发布并通过 review"；新增 `Per-Phase Entry Gate（进入 RH{N}, N≥1）`，要求对应 design + action-plan 必须先于 implementation 发布；§13.4 标题从"建议撰写顺序"改为"执行前置顺序（per R5 review 升级为硬 gate，不再是'建议'）"，明文写"未发布 RH{N} design + action-plan，不得启动 RH{N} implementation"。 | §8.3 / §13.4 |
| R6 | endpoint-level 测试纪律在全局与各 Phase DoD 中不一致 | `fixed` | §9.2 重写为统一口径：每个新增 public endpoint ≥5 endpoint-level 用例 / 每个新增 internal RPC ≥3 contract 用例 / 每个 live runtime path ≥1 cross-worker e2e + 1 preview smoke / multi-tenant 边界 ≥2 用例 / multi-model 至少 4 模型各 1 e2e / heartbeat lifecycle 4 用例。RH0 / RH2 / RH3 收口标准在引用文字中显式 link 回 §9.2，不再写"测试全绿"模糊表述。 | §9.2 / §9.3 #5 / §7.1 RH0 收口标准 / §7.3 RH2 / §7.4 RH3 |
| R7 | closure §4 item 2 的 token-level streaming 与 snapshot-vs-push 决策仍混在一起 | `fixed` | RH2 In-Scope 新增 P2-E `LLM delta policy 决议`：token-level streaming **out-of-scope**（性能成本 + 协议复杂度大于 first-wave 价值）；本阶段仅做 semantic-chunk streaming（tool_use_start/delta/stop + tool.call.result）；snapshot-vs-push policy 文档化（usage = WS push best-effort + HTTP snapshot strict-consistent；permission/elicitation = WS push only with HTTP fallback）。RH2 Out-of-Scope 新增 #4 显式列出 token-level；交付物新增 `docs/design/real-to-hero/RH2-llm-delta-policy.md`。 | §7.3 RH2 In-Scope/Out-of-Scope/交付物/收口标准 |

### 6.3 Blocker / Follow-up 状态汇总

| 分类 | 数量 | 编号 | 说明 |
|------|------|------|------|
| 已完全修复 | 7 | R1-R7 | 4 项 blocker + 3 项 follow-up 一并修复，不留 partial |
| 部分修复，需二审判断 | 0 | — | — |
| 有理由 deferred | 0 | — | — |
| 拒绝 / stale-rejected | 0 | — | — |
| 仍 blocked | 0 | — | — |

### 6.4 变更文件清单

- `docs/charter/plan-real-to-hero.md` — r1 → r2，应用 R1-R7 全部修法。具体变更：
  - 修订历史新增 r2 entry。
  - §1.1 D3/D4 重写为可审计来源。
  - §1.2 session truth 行更新为 migration allocation 冻结。
  - §2.1 wrangler/gh 行重写为 spike-verified + checklist。
  - §4.0 新增 closure §4 deferred 全量继承表。
  - §4.2 O16 重写。
  - §4.3 灰区表 team_name 行 migration 引用更新。
  - §4.4 硬纪律 #7 改为引用 §9.5。
  - §6.1 Phase 总表 RH3/RH4 migration 编号更新。
  - §7.1 RH0 In-Scope 新增 P0-F + P0-G；交付物新增 2 项；收口标准引用 §9.2 + §9.5；什么不算完成新增 1 项。
  - §7.3 RH2 In-Scope 新增 P2-E + heartbeat hardening；Out-of-Scope 新增 token-level 条；交付物 migration 编号修正 + 新增 ws-lifecycle test + design doc；收口标准引用 §9.2。
  - §7.4 RH3 P3-B + 交付物 migration 编号改 009。
  - §7.5 RH4 P4-C + 交付物 migration 编号改 010。
  - §7.6 RH5 migration 编号改 011（如需）。
  - §8.3 Gate 规则新增 Per-Phase Entry Gate；Start Gate 加 design+action-plan 硬前置。
  - §8.4 新增 Migration Allocation Rule。
  - §8.5 原 §8.4 重编号。
  - §9.2 重写为统一测试用例数纪律。
  - §9.3 #5 引用 §9.2。
  - §9.5 新增 evidence 三层定义。
  - §12 Q1 最晚冻结时点改"RH2 启动前"；Q5 新增。
  - §13.4 升级为执行前置顺序（硬 gate）。

### 6.5 验证结果

| 验证项 | 命令 / 证据 | 结果 | 覆盖的 finding |
|--------|-------------|------|----------------|
| §4.0 deferred 全量继承表完整性 | grep 15 条 closure §4 item 全部出现在 §4.0 表中 | `pass` | R1 |
| migration 编号一致性 | grep migration 编号 008/009/010 在 §1.2/§6.1/§7.{2,3,4,5}/§8.4/§12 全部一致；无 008 同时被 RH2/RH3 引用 | `pass` | R2 |
| evidence 三层 + §4.4 硬纪律一致 | §4.2 O16 / §4.4 #7 / §9.5 / §7.1 RH0 收口标准互相引用无冲突 | `pass` | R3 |
| memory 引用清零 | grep `memory:` 在 plan-real-to-hero.md 中无匹配 | `pass` | R4 |
| Per-Phase Entry Gate 形成闭环 | §8.3 + §13.4 互相引用，硬纪律一致 | `pass` | R5 |
| §9.2 测试用例数被各 Phase 引用 | RH0/RH2/RH3 收口标准显式引用 §9.2 用例数 | `pass` | R6 |
| RH2 P2-E LLM delta policy 决议存在 | §7.3 In-Scope/Out-of-Scope/交付物 三处一致写入 | `pass` | R7 |

```text
charter r2 修订完成；7 项 finding 全部 addressed in §6.2 表。
所有变更已写入同一文件 docs/charter/plan-real-to-hero.md，diff 可通过 git diff 审查。
未运行代码测试（charter 文档审查范围）。
```

### 6.6 未解决事项与承接

| 编号 | 状态 | 不在本轮完成的原因 | 承接位置 |
|------|------|--------------------|----------|
| — | — | 本轮无未解决项 | — |

### 6.7 Ready-for-rereview gate

- **是否请求二次审查**：`yes`
- **请求复核的范围**：`R1-R7 全部 7 项修法的实现质量；尤其 §4.0 全量继承表的承接强度、§8.4 migration allocation 是否消除 RH2/RH3 并行冲突、§9.5 evidence 三层是否消除 §4.2/§4.4/§9 之间口径冲突`
- **实现者认为可以关闭的前提**：
  1. §4.0 15 条 closure §4 deferred 的 in-scope-with-DoD / out-of-scope-handoff / split 分类被 reviewer 接受。
  2. §8.4 migration allocation 冻结被接受为防 RH2/RH3 schema collision 的有效手段。
  3. §9.5 evidence 三层（Tier-A/B/C）被接受为一致的术语 + §4.2 O16 / §4.4 #7 / §7.1/§7.7 引用一致。
  4. §1.1 D3/D4 + §7.1 P0-F + §12 Q5 + `docs/owner-decisions/real-to-hero-tooling.md`（待 RH0 启动时由 owner 写入）共同形成可审计 owner-action 记录路径，不再依赖任何 memory 文件。
  5. §8.3 Per-Phase Entry Gate + §13.4 升级为硬 gate 被接受为防 design/action-plan 缺位施工的有效约束。
