# Nano-Agent 代码审查 — Hero-to-Pro HP0~HP10 全阶段

> 审查对象: `hero-to-pro / HP0~HP10 full closure`
> 审查类型: `mixed`
> 审查时间: `2026-05-01`
> 审查人: `GPT-5.5`
> 审查范围:
> - `docs/charter/plan-hero-to-pro.md`
> - `docs/action-plan/hero-to-pro/HP0-action-plan.md` 至 `docs/action-plan/hero-to-pro/HP10-action-plan.md`
> - `docs/issue/hero-to-pro/HP0-closure.md` 至 `docs/issue/hero-to-pro/HP10-closure.md`
> - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
> - `docs/issue/hero-to-pro/HP0-H10-deferred-closure.md`
> - `docs/issue/hero-to-pro/manual-evidence-pack.md`
> - `docs/issue/hero-to-pro/prod-schema-baseline.md`
> - `clients/api-docs/`
> - `workers/` 六 worker 与 `packages/` 中 hero-to-pro 相关实现
> - `test/cross-e2e/`
> 对照真相:
> - `docs/templates/code-review.md`
> - `docs/design/hero-to-pro/HPX-qna.md`
> - `docs/charter/plan-hero-to-pro.md`
> - 当前仓库真实代码、测试、脚本输出
> 文档状态: `changes-requested`

---

## 0. 总结结论

HP0~HP10 当前不能按“全阶段已完成并可封板”关闭；它更准确的状态是 **HP0/HP1 主体关闭，HP2~HP8 多数为 first-wave / scaffold / partial-live，HP9 证据 hard gate 未完成，HP10 final closure 文档存在过度吸收与陈旧自相矛盾，且 root `pnpm test` 当前失败**。

- **整体判断**：`hero-to-pro` 的基础架构推进真实存在，但 final closure 对“28 absorbed / 100% docs 对齐 / 单元测试全绿 / wire-with-delivery”的表述高估了当前仓库事实。
- **结论等级**：`blocked`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `pnpm test` 当前失败在 `@nano-agent/eval-observability`：本地 9-kind inspector 与 `@haimang/nacp-session` 13-kind stream catalog 不一致。
  2. `HP0-H10-deferred-closure.md` 把大量 stub / first-wave / metadata-only surface 记为 absorbed；这不满足 charter 中“wire-without-delivery 不算 phase 闭合”的法律。
  3. `clients/api-docs`、`hero-to-pro-final-closure.md`、`HP10-closure.md`、`test-topology.md` 之间存在多处互相矛盾的状态口径，不能作为客户端或下阶段交接的稳定事实源。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-hero-to-pro.md`
  - `docs/action-plan/hero-to-pro/HP0-action-plan.md` 至 `HP10-action-plan.md`
  - `docs/issue/hero-to-pro/HP0-closure.md` 至 `HP10-closure.md`
  - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
  - `docs/issue/hero-to-pro/HP0-H10-deferred-closure.md`
  - `docs/issue/hero-to-pro/manual-evidence-pack.md`
  - `docs/issue/hero-to-pro/prod-schema-baseline.md`
- **核查实现**：
  - `workers/orchestrator-core/src/index.ts`
  - `workers/orchestrator-core/src/hp-absorbed-routes.ts`
  - `workers/orchestrator-core/src/hp-absorbed-handlers.ts`
  - `workers/orchestrator-core/src/user-do-runtime.ts`
  - `workers/filesystem-core/src/index.ts`
  - `workers/agent-core/src/host/orchestration.ts`
  - `packages/nacp-session/src/stream-event.ts`
  - `packages/eval-observability/src/inspector.ts`
  - `workers/agent-core/src/eval/inspector.ts`
  - `clients/api-docs/*.md`
  - `test/shared/live.mjs`
  - `test/cross-e2e/*.test.mjs`
- **执行过的验证**：
  - `pnpm test` — **失败**，`@nano-agent/eval-observability` 1 个测试失败。
  - `pnpm run check:observability-drift`
  - `pnpm run check:megafile-budget`
  - `pnpm run check:tool-drift`
  - `pnpm run check:envelope-drift`
  - `pnpm test:cross-e2e`
  - `find test/cross-e2e -maxdepth 1 -name '*.test.mjs' | wc -l`
  - `find clients/api-docs -maxdepth 1 -name '*.md' | wc -l`
  - `find docs/evidence -maxdepth 2 -type f`
  - `find docs/eval/hero-to-pro -maxdepth 1 -name 'HP9-api-docs-reviewed-by-*.md'`
- **复用 / 对照的既有审查**：
  - `none` — 本文只使用一手代码、文档、测试输出和当前仓库状态；不采纳其他 reviewer 报告作为结论来源。

### 1.1 已确认的正面事实

- HP0/HP1 的 DDL freeze、模型字段透传、14 migrations 事实在当前 closure 与代码中有较稳定的基础；这两阶段可以视为 `closed / closed-with-controlled-exception`。
- `packages/nacp-session/src/stream-event.ts` 已将 stream event schema 扩展为 13 kind，包含 `tool.call.cancelled`、`system.error`、`session.fork.created`、`model.fallback`（`packages/nacp-session/src/stream-event.ts:147-179`）。
- `workers/orchestrator-core` 已接入若干 hero-to-pro surface：workspace route、tool-calls route、retry action、fork action、checkpoint list/create/diff 等。
- `workers/filesystem-core` 已新增 temp-file、snapshot、copy-to-fork、cleanup 等 RPC 方法，并通过 `filesystemOps()` 暴露为 12 ops（`workers/filesystem-core/src/index.ts:89-113`）。
- root drift gates 中 `check:megafile-budget`、`check:tool-drift`、`check:envelope-drift` 当前通过；`test:cross-e2e` 命令 exit 0。
- `clients/api-docs/` 当前有 18 份 markdown，对客户端 surface 的拆分比 HP0~HP1 时明显更完整。

### 1.2 已确认的负面事实

- `pnpm test` 当前失败：`packages/eval-observability/test/inspector.test.ts` 期望本地 inspector catalog 与 `STREAM_EVENT_KINDS` 完全一致，但 `packages/eval-observability/src/inspector.ts` 仍是 9-kind，而 `packages/nacp-session/src/stream-event.ts` 已是 13-kind。
- `pnpm test:cross-e2e` 虽 exit 0，但输出为 `tests 52 / pass 1 / skipped 51`；`test/shared/live.mjs` 明确要求 `NANO_AGENT_LIVE_E2E=1` 才启用 live E2E（`test/shared/live.mjs:24-42`）。这不能证明 HP2~HP8 的真实跨 worker wire-with-delivery。
- `workers/orchestrator-core/src/hp-absorbed-routes.ts` 的 workspace read 只返回 metadata 和 `content_source: "filesystem-core-leaf-rpc-pending"`，write 只 upsert D1 metadata，没有写入 bytes（`workers/orchestrator-core/src/hp-absorbed-routes.ts:212-267`）。
- `workers/orchestrator-core/src/hp-absorbed-routes.ts` 的 tool-calls list 固定返回空数组和 `source: "ws-stream-only-first-wave"`，cancel 只返回 202 / `forwarded: true`，未见实际终态状态机（`workers/orchestrator-core/src/hp-absorbed-routes.ts:122-148`）。
- `workers/orchestrator-core/src/hp-absorbed-handlers.ts` 的 retry 是“acknowledged + hint”，fork 是 `pending-executor`，均不是 action-plan 要求的 executor 级闭环（`workers/orchestrator-core/src/hp-absorbed-handlers.ts:27-39,57-70`）。
- `workers/orchestrator-core/src/index.ts` 的 checkpoint route parser 只支持 list/create/diff，没有 `/checkpoints/{uuid}/restore`（`workers/orchestrator-core/src/index.ts:1179-1201`）。
- `workers/filesystem-core/src/index.ts` 的 temp/snapshot key builder 只去掉前导 slash，没有执行 Q19 virtual_path 7-rule；`cleanup()` 删除整个 `tenants/{team}/sessions/{session}/` prefix，范围过宽（`workers/filesystem-core/src/index.ts:266-282,301-314`）。
- `clients/api-docs/session-ws-v1.md` 写 12-kind catalog，但 code 已是 13-kind；同一文档又把 `model.fallback` 标为 not-started（`clients/api-docs/session-ws-v1.md:51-67,253-260`）。
- `clients/api-docs/workspace.md` 仍称 filesystem temp RPC、workspace public CRUD、tool-calls route not-live / 未注册，但当前代码已经有 RPC 与 first-wave route；该文档应区分“route/schema exists”与“完整 bytes/product semantics 未闭合”（`clients/api-docs/workspace.md:127-134`）。
- HP9 manual evidence、prod schema baseline、4-reviewer memos 都未落实际 artifact：`manual-evidence-pack.md` 明确 evidence artifact 为空，`prod-schema-baseline.md` 明确 owner remote result 待回填，`docs/eval/hero-to-pro/HP9-api-docs-reviewed-by-*.md` 当前 0 个匹配文件。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 逐项核查 action-plan、closure、public docs、orchestrator-core、filesystem-core、nacp-session、eval-observability、cross-e2e helper。 |
| 本地命令 / 测试 | `yes` | `pnpm test` 失败；root drift gates 通过；`pnpm test:cross-e2e` 51/52 skipped。 |
| schema / contract 反向校验 | `yes` | 用 `STREAM_EVENT_KINDS` 与 eval-observability inspector/test 反向确认 catalog drift。 |
| live / deploy / preview 证据 | `no` | 本轮未设置 `NANO_AGENT_LIVE_E2E=1`，也没有 owner prod D1 / manual device / wrangler tail 证据。 |
| 与上游 design / QNA 对账 | `yes` | 重点按 HPX Q19/Q22-Q28/Q30-Q36、charter wire-with-delivery 法律对账。 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | root `pnpm test` 失败：eval-observability 仍是 9-kind catalog | `critical` | `protocol-drift` | `yes` | 统一到 13-kind，修正实现、测试与文档，并将 drift gate 覆盖该包。 |
| R2 | final closure 把 first-wave / stub / metadata-only surface 记为 absorbed | `critical` | `scope-drift` | `yes` | 重判 HP4/HP6/HP7 的 absorbed 状态，拆分 route-live 与 delivery-live。 |
| R3 | checkpoint restore public route 的 closure claim 与代码不一致 | `high` | `correctness` | `yes` | 实现 `/restore` route + executor，或把 HP7-D2 改回 retained/partial。 |
| R4 | filesystem-core leaf RPC path law 与 cleanup scope 有安全风险 | `high` | `security` | `yes` | 复用 Q19 规范化器；cleanup 分 scope，不得删除整个 session prefix。 |
| R5 | cross-e2e scaffold 被当作 wire-with-delivery 证据 | `high` | `test-gap` | `yes` | 对 HP2~HP8 建立非 skipped 的 semantic e2e 或明确标为 scaffold-only。 |
| R6 | clients/api-docs 与当前代码事实多处漂移 | `high` | `docs-gap` | `yes` | 重写 WS catalog、models、workspace、checkpoints 等状态表。 |
| R7 | HP9 hard gates 没有真实证据 artifact | `high` | `delivery-gap` | `yes` | 补齐 5 设备 evidence、prod schema remote result、4 reviewer memos，或保持 cannot-close。 |
| R8 | final closure / HP10 closure / stub / test-topology 互相残留旧口径 | `medium` | `docs-gap` | `yes` | 统一 single source of truth，删除 handed-to-platform/15-file/1922 等陈旧描述。 |
| R9 | R28 runbook 路径漂移，多个 HP8/HP10 文档引用不存在路径 | `medium` | `docs-gap` | `no` | 批量修正为 `docs/utilities/runbook/zx5-r28-investigation.md` 或恢复兼容路径。 |
| R10 | `check:observability-drift` 名称与实际覆盖范围不符 | `medium` | `test-gap` | `no` | 增加真正的 stream-event catalog drift script，或改名避免误导。 |

### R1. root `pnpm test` 失败：eval-observability 仍是 9-kind catalog

- **严重级别**：`critical`
- **类型**：`protocol-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `packages/nacp-session/src/stream-event.ts:147-179` 定义 13-kind `STREAM_EVENT_KINDS`，含 `tool.call.cancelled`、`system.error`、`session.fork.created`、`model.fallback`。
  - `packages/eval-observability/src/inspector.ts:4-33` 注释与常量仍写“9 canonical”并只列 9 个 kind。
  - `packages/eval-observability/test/inspector.test.ts:32-36` 明确断言本地 catalog 与 `STREAM_EVENT_KINDS` 相等；`pnpm test` 当前在该断言失败。
- **为什么重要**：
  - HP8 / HP9 / HP10 都把 observability、stream event catalog、客户端协议冻结作为收口条件；root test 红灯说明不能宣称“6-worker 单元测试全绿”或“13 → 13 event catalog 全部对齐”。
- **审查判断**：
  - 这是当前仓库最硬 blocker。它不是文档措辞问题，而是根测试失败和跨包协议漂移。
- **建议修法**：
  - 将 `packages/eval-observability/src/inspector.ts` 更新到 13-kind；同步注释、测试名、拒绝/过滤逻辑。
  - 将 `scripts/check-observability-drift.mjs` 扩展为检查 eval-observability catalog，或新增 `check:stream-event-drift` 并纳入 root gate。

### R2. final closure 把 first-wave / stub / metadata-only surface 记为 absorbed

- **严重级别**：`critical`
- **类型**：`scope-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/issue/hero-to-pro/HP0-H10-deferred-closure.md:68-75` 把 HP6-D1~D8 全列为 absorbed。
  - workspace route read 返回 `content_source: "filesystem-core-leaf-rpc-pending"`，write 只 upsert `content_hash/size/mime` metadata（`workers/orchestrator-core/src/hp-absorbed-routes.ts:212-267`）。
  - tool-calls list 返回 `tool_calls: []` 和 `source: "ws-stream-only-first-wave"`；cancel 只是 202 ack（`workers/orchestrator-core/src/hp-absorbed-routes.ts:122-148`）。
  - retry handler 明确注释 full attempt-chain executor 在后续，返回的是 replay hint（`workers/orchestrator-core/src/hp-absorbed-handlers.ts:27-39`）。
  - fork handler 返回 `fork_status: "pending-executor"`，注释说明 snapshot copy 之后才会发 `session.fork.created`（`workers/orchestrator-core/src/hp-absorbed-handlers.ts:57-70`）。
- **为什么重要**：
  - charter 的核心法律是 wire-without-delivery 不算 phase 闭合。当前吸收日志把“route 可返回响应”混同为“产品语义闭合”，会让后续 phase、客户端文档、manual evidence 都建立在错误前提上。
- **审查判断**：
  - HP4-D1、HP6-D3/D4/D5/D6、HP7-D1/D3 不能按 completed absorbed 判定；最多是 `route-live / scaffold-live / metadata-plane-live`。
- **建议修法**：
  - 在 final closure 和 deferred closure 中为每个 absorbed item 增加三态：`route/schema live`、`executor/storage delivery live`、`tested live`。
  - 对未达到第二、第三态的项改回 `partial-live` 或 `retained-with-reason`，并给出 remove condition。

### R3. checkpoint restore public route 的 closure claim 与代码不一致

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/issue/hero-to-pro/HP0-H10-deferred-closure.md:81-83` 声称 HP7-D2 restore public route 已通过 existing `parseSessionCheckpointRoute` extended。
  - 当前 `parseSessionCheckpointRoute` 类型只包含 `list/create/diff`，parser 只匹配 `/checkpoints` 和 `/checkpoints/{uuid}/diff`（`workers/orchestrator-core/src/index.ts:1179-1201`）。
  - `clients/api-docs/checkpoints.md:9` 仍写 public restore / fork 路由在 HP9 frozen pack 阶段尚未 live。
- **为什么重要**：
  - checkpoint restore 是 HP4/HP7 action-plan 的核心产品能力；closure claim 与 router 实现不一致会直接误导 client 调用。
- **审查判断**：
  - HP7-D2 不是 absorbed；至少 public route 部分缺失。
- **建议修法**：
  - 实现 `POST /sessions/{id}/checkpoints/{checkpoint_uuid}/restore`，接入 restore job / rollback baseline / confirmation gate；或修正 closure，把它标为未完成。

### R4. filesystem-core leaf RPC path law 与 cleanup scope 有安全风险

- **严重级别**：`high`
- **类型**：`security`
- **是否 blocker**：`yes`
- **事实依据**：
  - temp/snapshot key builder 只执行 `virtualPath.replace(/^\/+/, "")`，没有拒绝 `..`、反斜杠、空段、控制字符等（`workers/filesystem-core/src/index.ts:301-314`）。
  - `cleanup()` 用 `tenants/{team}/sessions/{session}/` 作为 root，删除该 prefix 下所有 object（`workers/filesystem-core/src/index.ts:266-282`）。
  - HP6 Q19 冻结的是 virtual_path 7-rule 与 tenant R2 key law；orchestrator-core route 侧有 `normalizeVirtualPath()`，但 filesystem-core leaf RPC 是独立入口，不能依赖 caller 总是预清洗。
- **为什么重要**：
  - filesystem-core 一旦成为 leaf RPC bytes owner，它必须在边界上自校验；否则内部 RPC、未来 worker、测试 helper 或错误 caller 都可能绕过 public façade 的 path law。
- **审查判断**：
  - 当前 HP6-D1/D2 不能按 security-complete 判定；cleanup 的删除范围也不满足最小权限原则。
- **建议修法**：
  - 抽出共享 path law helper 到 package 或 filesystem-core 本地复制同等 7-rule 校验。
  - 将 cleanup 拆为 `workspace_temp`、`snapshot`、`artifact` 等明确 scope，并要求调用方显式传 scope。

### R5. cross-e2e scaffold 被当作 wire-with-delivery 证据

- **严重级别**：`high`
- **类型**：`test-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `test/shared/live.mjs:24-42` 规定只有 `NANO_AGENT_LIVE_E2E=1` 才运行 live tests，否则 skip。
  - 本轮 `pnpm test:cross-e2e` 输出：`tests 52 / pass 1 / skipped 51 / fail 0`。
  - 当前 `test/cross-e2e` 实际有 22 个 `.test.mjs` 文件；`docs/architecture/test-topology.md:61-69,111-118` 仍写 15 baseline files，并把 HP2~HP8 targeted 全部 handed-to-platform / NOT YET。
  - `docs/issue/hero-to-pro/HP0-H10-deferred-closure.md:55,62,75,85,92` 把新增 cross-e2e 文件作为 absorbed 证据，但状态是 scaffolded。
- **为什么重要**：
  - scaffolded test 文件和 skipped live test 不能证明 runtime 跨 worker 闭环。若把它们算作 pass，会掩盖 HP2 model switch、HP3 compact、HP4 retry/restore、HP6 workspace/tool、HP7 fork/restore、HP8 heartbeat 的真实断点。
- **审查判断**：
  - HP2-D3、HP3-D6、HP4-D3、HP5-D2、HP6-D8、HP7-D5、HP8-D3 当前都只能算 `test scaffold exists`，不能算 e2e delivered。
- **建议修法**：
  - 为每个 HP2~HP8 scenario 增加非 live-only 的 semantic contract test，或提供 owner live run artifact。
  - final closure 中不要把 skipped tests 统计为 delivered evidence。

### R6. clients/api-docs 与当前代码事实多处漂移

- **严重级别**：`high`
- **类型**：`docs-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `clients/api-docs/session-ws-v1.md:51-67` 标题写 12-kind catalog，但列表已包含 12 项且漏掉 `model.fallback`；代码真相是 13 kind（`packages/nacp-session/src/stream-event.ts:165-179`）。
  - `clients/api-docs/session-ws-v1.md:253-260` 与 `clients/api-docs/models.md:233-239` 把 `model.fallback` 写成 not-started，但 schema 已 live。
  - `clients/api-docs/workspace.md:127-134` 说 filesystem temp RPC、workspace public CRUD、tool-calls route not-live / 未注册；当前代码已存在 first-wave RPC/route。
  - `clients/api-docs/checkpoints.md:9` 说 restore / fork public route 均未 live；实际 fork route 已有 202 `pending-executor`，restore route 未有。
- **为什么重要**：
  - client docs 是客户端集成的权威入口。现在的错误不是“少写一个字段”，而是同一能力在代码、closure、client docs 之间有三种状态。
- **审查判断**：
  - HP9 “18 docs pack 与 HP5-HP8 frozen 代码事实 100% 对齐”的 claim 不成立。
- **建议修法**：
  - 对每个 API item 使用统一状态枚举：`not-registered`、`route-live-stub`、`schema-live-emitter-pending`、`metadata-live-bytes-pending`、`delivery-live`。
  - 重写 `session-ws-v1.md`、`models.md`、`workspace.md`、`checkpoints.md` 的 readiness 表。

### R7. HP9 hard gates 没有真实证据 artifact

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/issue/hero-to-pro/manual-evidence-pack.md:14-30` 写 owner 侧 5 设备录制、artifact 上传、failure/caveat 记录都待完成；`§7` 写 evidence artifact 目录为空（`docs/issue/hero-to-pro/manual-evidence-pack.md:154-168`）。
  - `docs/issue/hero-to-pro/prod-schema-baseline.md:24-30,52-62,131-166` 写 prod remote migrations / schema dump / overall verdict 均待 owner 回填。
  - 当前 `docs/evidence/` 下无 `hero-to-pro-manual-*` artifact；当前 `docs/eval/hero-to-pro/HP9-api-docs-reviewed-by-*.md` 匹配数为 0。
- **为什么重要**：
  - HPX Q30/Q31/Q32 把 manual evidence、prod schema baseline、review routing 都定义为 hard gate；这些不能用 scaffold 替代。
- **审查判断**：
  - HP9 不能从 `cannot-close` 升级为 closed；HP10 也不能把 HP9 hard gate 包装成“已吸收”。
- **建议修法**：
  - 保持 HP9 `cannot-close`，直到 owner evidence / remote output / reviewer memos 全部落地。
  - final closure 中把这些标为 hard blockers，而不是正面事实中的“docs pack 100% 对齐”。

### R8. final closure / HP10 closure / stub / test-topology 互相残留旧口径

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `hero-to-pro-final-closure.md` header 和 §8 说 28 absorbed、0 handed-to-platform（`docs/issue/hero-to-pro/hero-to-pro-final-closure.md:13,344-380`），但 phase map 仍在 HP2~HP9 多处写 `handed-to-platform`（`docs/issue/hero-to-pro/hero-to-pro-final-closure.md:40-52`）。
  - `HP10-closure.md:35-59` 仍写“22 handed-to-platform / 3 retained / manual evidence → handed / 4-reviewer → handed”，与 final closure 新 header 和 `plan-hero-to-platform.md` 的 post-absorb state 冲突。
  - `docs/charter/plan-hero-to-platform.md:38-80` 说之前 22 items 已全部 absorbed；但同文件 §4 仍列 HP2~HP8 inherited test coverage gaps。
  - `docs/architecture/test-topology.md:61-69,111-118` 写 15 files / HP2~HP8 NOT YET；实际 `test/cross-e2e` 文件数为 22，closure 又说 7 个新 cross-e2e scaffolded。
- **为什么重要**：
  - HP10 的目标是形成唯一阶段总 closure 入口。现在几个 final artifacts 相互矛盾，读者无法判断“是 absorbed、handed、retained、还是 scaffolded”。
- **审查判断**：
  - HP10 文档层本身不能判为 closed；它需要一次 consistency rewrite。
- **建议修法**：
  - 选定一个 canonical state map，并同步改写 final closure、HP10 closure、hero-to-platform stub、test-topology。
  - 禁止同一 item 同时出现在 absorbed、handed、coverage gap 三类。

### R9. R28 runbook 路径漂移，多个 HP8/HP10 文档引用不存在路径

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - 当前实际文件是 `docs/utilities/runbook/zx5-r28-investigation.md`。
  - 大量文档仍引用 `docs/runbook/zx5-r28-investigation.md`，包括 `HP8-action-plan.md`、`HP10-action-plan.md`、`hero-to-pro-final-closure.md`、`HP0-H10-deferred-closure.md`、`plan-hero-to-pro.md`。
  - 实际 runbook 的 owner 回填区仍是模板，`stack trace`、根因分类、修法决策都未填（`docs/utilities/runbook/zx5-r28-investigation.md:100-141`）。
- **为什么重要**：
  - R28 是 HP8/Q28 chronic register 的关键 owner-action；路径错误会让后续 owner 回填与 reviewer 追踪失效。
- **审查判断**：
  - 不影响 runtime，但影响 closure 可审计性。
- **建议修法**：
  - 批量修正引用，或恢复 `docs/runbook/zx5-r28-investigation.md` 兼容入口。

### R10. `check:observability-drift` 名称与实际覆盖范围不符

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `package.json:15-19` 注册了 `check:observability-drift`。
  - `scripts/check-observability-drift.mjs:1-106` 实际只检查 6 worker src 下裸 `console.*` 与 cross-worker import，不检查 packages/eval-observability stream catalog。
  - 本轮该 gate clean，但 `pnpm test` 同时暴露 eval-observability catalog drift。
- **为什么重要**：
  - final closure 把 “5 类 root drift gate clean” 作为质量证据，但当前 observability drift 中最重要的 protocol drift 并不在该脚本覆盖内。
- **审查判断**：
  - gate 名称和 closure 解读会误导 reader；它不是 stream event observability drift gate。
- **建议修法**：
  - 改名为 `check:worker-observability-style`，或新增真正 catalog drift gate。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | HP0 前置 defer 修复、verify-only / cleanup baseline | `done` | 当前没有发现阻断 HP0 closure 的新 runtime 断点。 |
| S2 | HP1 DDL 集中扩展、14 migrations freeze | `done` | 13 + HP2 controlled exception 的 014 migration 事实成立；仍需 prod schema owner baseline 才能验证 remote。 |
| S3 | HP2 model state machine | `partial` | model durable fields 与 schema 有进展；`model.fallback` schema live，但 docs/test/runtime delivery 仍漂移，cross-e2e skipped。 |
| S4 | HP3 context state machine | `partial` | probe/layers/preview/job surface 存在；CrossTurnContextManager runtime owner、auto-compact delivery、strip-recover full contract 仍未被真实 e2e 证明。 |
| S5 | HP4 chat lifecycle / retry / restore | `partial` | close/delete/title/cursor/checkpoint list/create/diff first-wave 成立；retry 是 replay hint，restore route/parser 缺失。 |
| S6 | HP5 confirmation control plane | `partial` | confirmations surface 与 row-first 方向较完整；但 HP5 15-18 round-trip tests 默认 skipped，不能证明 live delivery。 |
| S7 | HP6 tool/workspace state machine | `partial` | todos 与 D1 metadata surface 存在；workspace bytes、tool-calls read model/cancel transport、promotion、cleanup scope 与 security 未闭环。 |
| S8 | HP7 checkpoint restore/fork/TTL | `partial` | substrate 与 fork ack 存在；restore route 缺失，fork executor/snapshot copy/lineage emit/TTL live cleanup 未闭环。 |
| S9 | HP8 runtime hardening/chronic closure | `partial` | megafile/tool/envelope gates 成立；R28 owner evidence、R29 owner run、heartbeat live posture 与 eval-observability 13-kind alignment 未闭环。 |
| S10 | HP9 API docs/manual evidence/prod baseline/review routing | `stale` | docs pack 存在但与代码不 100% 对齐；manual evidence、prod schema、4 reviewer memos 都是 pending。 |
| S11 | HP10 final closure/cleanup/stub/test-topology | `stale` | 文档产物存在，但内部口径冲突、test numbers 陈旧，并把 scaffold/stub 过度吸收。 |

### 3.1 对齐结论

- **done**: `2`
- **partial**: `7`
- **missing**: `0`
- **stale**: `2`
- **out-of-scope-by-design**: `0`

整体更像“HP0/HP1 已闭合，HP2~HP8 first-wave 骨架和若干 route/schema 已落地，HP9/HP10 收口文档提前把 scaffold 与 stub 当成 delivered”，而不是完整 `hero-to-pro` closed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | 真实 5 设备 manual evidence | `遵守但未完成` | 代码 agent 无法替代 owner physical devices；但 HP9/HP10 不能因此把 hard gate 降级为 complete。 |
| O2 | prod D1 remote schema baseline | `遵守但未完成` | 没有 owner prod credential 输出；只能保留为 owner-action blocked。 |
| O3 | R28 deploy-only wrangler tail root cause | `遵守但未完成` | 当前 runbook 仍是模板；不能 silent close。 |
| O4 | hero-to-platform 正式实施方案 | `遵守` | `plan-hero-to-platform.md` 基本保持 stub 边界；但 inherited / absorbed / coverage gap 口径需统一。 |
| O5 | 跨 conversation fork / multi-provider fallback chain / SDK codegen | `遵守` | 这些仍属未来阶段或 QNA out-of-scope；本轮未把它们当 blocker。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`blocked`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 修复 `@nano-agent/eval-observability` 9-kind / 13-kind catalog drift，让 root `pnpm test` 通过。
  2. 重判 `HP0-H10-deferred-closure.md` 与 `hero-to-pro-final-closure.md` 中 28 absorbed 项，把 stub / first-wave / metadata-only / skipped-test scaffold 与 delivery-live 区分开。
  3. 实现或撤回 checkpoint restore public route claim；同步修正 HP7-D2、checkpoints docs 与 final closure。
  4. 修复 filesystem-core leaf RPC path normalization 与 cleanup scope。
  5. 重写 `clients/api-docs` 中 WS catalog、model fallback、workspace、checkpoint/fork readiness 的错误表述。
  6. 将 `manual-evidence-pack.md`、`prod-schema-baseline.md`、HP9 4-reviewer memos 保持为 hard gate pending，不能在 final closure 中写成已完成或“100% 对齐”。
  7. 统一 `hero-to-pro-final-closure.md`、`HP10-closure.md`、`plan-hero-to-platform.md`、`test-topology.md` 的状态口径和测试数字。
- **可以后续跟进的 non-blocking follow-up**：
  1. 批量修正 R28 runbook 路径漂移。
  2. 改名或扩展 `check:observability-drift`，避免它与 stream-event catalog drift 混淆。
  3. 对 HP2~HP8 新增可在 CI 中非 skipped 执行的 semantic e2e/contract tests。
- **建议的二次审查方式**：`same reviewer rereview`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

## 6. 实现者回应

### 6.1 对本轮审查的回应

> 执行者: `GPT-5.4`
> 执行时间: `2026-05-01`
> 回应范围: `R1–R10`
> 对应审查文件: `docs/code-review/hero-to-pro/HP-fully-reviewed-by-GPT.md`

- **总体回应**：已按 GPT / kimi / GLM / deepseek 四份 full-review 的重叠问题逐项回归核实，并以本文件 `R1–R10` 作为归并编号落下修复与口径回写。
- **本轮修改策略**：先修真实代码断点（stream-event catalog、restore route、filesystem path law），再回刷 clients/api-docs 与 hero-to-pro final-closure 系列文档，把 `route-live / schema-live / first-wave / live-gated` 和 `delivery-live` 明确拆开。
- **实现者自评状态**：`partially-closed`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | eval-observability 仍是 9-kind catalog，导致 root `pnpm test` 失败 | `fixed` | 将 `packages/eval-observability` 本地 catalog 同步到 13 kind，补上 `tool.call.cancelled` / `system.error` / `session.fork.created` / `model.fallback`，并同步测试文字与断言 | `packages/eval-observability/src/inspector.ts`; `packages/eval-observability/test/inspector.test.ts` |
| R2 | final closure 把 first-wave / scaffold / metadata-only surface 记为 absorbed | `partially-fixed` | 回写 main source-of-truth 文档，改成 `代码/route/substrate/scaffold absorbed` 与 `first-wave/live-gated` 分离；未追溯重写全部历史 phase 闭包文档 | `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`; `docs/issue/hero-to-pro/HP10-closure.md`; `docs/architecture/test-topology.md` |
| R3 | checkpoint restore public route claim 与代码不一致 | `fixed` | 实装 `POST /sessions/{id}/checkpoints/{checkpoint_uuid}/restore` first-wave facade：校验 checkpoint、`checkpoint_restore` pending confirmation，创建 `pending` restore job 并返回 `202` | `workers/orchestrator-core/src/index.ts`; `workers/orchestrator-core/test/chat-lifecycle-route.test.ts`; `clients/api-docs/checkpoints.md` |
| R4 | filesystem-core leaf RPC path law 与 cleanup scope 有风险 | `fixed` | 在 filesystem-core 本地补齐与 HP6 Q19 等价的 path 校验；修正 snapshot key 到 `/snapshots/{checkpoint}/...`；cleanup 改为显式 scope，默认只清理 workspace；补测试 | `workers/filesystem-core/src/index.ts`; `workers/filesystem-core/test/leaf-rpc-path-law.test.ts`; `docs/issue/hero-to-pro/HP0-H10-deferred-closure.md` |
| R5 | skipped cross-e2e scaffold 被当作 wire-with-delivery 证据 | `partially-fixed` | 保留现有 live-gate 机制，但把 final-closure / topology / error-index 中的表述修正为 `52 tests / pass 1 / skipped 51` 的 live-gated 事实，不再把其当作默认环境下的交付证据 | `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`; `docs/architecture/test-topology.md`; `clients/api-docs/error-index.md` |
| R6 | clients/api-docs 与代码事实多处漂移 | `fixed` | 回刷 checkpoints / confirmations / session-ws / workspace / models / todos / session / README / error-index，统一到当前代码事实与 first-wave 状态 | `clients/api-docs/checkpoints.md`; `clients/api-docs/confirmations.md`; `clients/api-docs/session-ws-v1.md`; `clients/api-docs/workspace.md`; `clients/api-docs/models.md`; `clients/api-docs/todos.md`; `clients/api-docs/session.md`; `clients/api-docs/README.md`; `clients/api-docs/error-index.md` |
| R7 | HP9 hard gates 缺真实 evidence artifact | `deferred-with-rationale` | 这是 owner-action 范畴；本轮仅把 final-closure 口径改回 retained / blocked，不伪装为已完成 | `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`; `docs/issue/hero-to-pro/HP10-closure.md` |
| R8 | final closure / HP10 closure / test-topology 残留旧口径 | `fixed` | 统一 main source-of-truth 的测试数量、cross-e2e live-gate、partial-close 口径；同时修正 HP7/HP9 closure 的 13-kind 描述 | `docs/issue/hero-to-pro/hero-to-pro-final-closure.md`; `docs/issue/hero-to-pro/HP10-closure.md`; `docs/architecture/test-topology.md`; `docs/issue/hero-to-pro/HP7-closure.md`; `docs/issue/hero-to-pro/HP9-closure.md` |
| R9 | R28 runbook 路径漂移 | `deferred-with-rationale` | 该问题横跨大量历史 design/action-plan/zero-to-real 文档，且 runbook 本身仍属 owner-action 模板；本轮优先修 runtime / client-doc / final-closure 主线，路径批量校正留待后续文档批次 | — |
| R10 | `check:observability-drift` 名称与覆盖范围不符 | `deferred-with-rationale` | 先修真实 catalog 漂移与 failing tests；脚本改名/扩面会影响已有文档与 gate 口径，本轮只在 `test-topology.md` 明确其真实覆盖范围 | `docs/architecture/test-topology.md` |

### 6.3 Blocker / Follow-up 状态汇总

| 分类 | 数量 | 编号 | 说明 |
|------|------|------|------|
| 已完全修复 | `5` | `R1,R3,R4,R6,R8` | 代码断点、restore route、filesystem path law、clients docs、main closure docs 已同步 |
| 部分修复，需二审判断 | `2` | `R2,R5` | 已修 main source-of-truth，但 live-delivery 证据本身仍未新增 |
| 有理由 deferred | `3` | `R7,R9,R10` | owner evidence / runbook path 批量漂移 / gate 命名扩面不适合在本轮强行混修 |
| 拒绝 / stale-rejected | `0` | `—` | — |
| 仍 blocked | `0` | `—` | 本轮未留下新的代码级 blocker；剩余问题主要是 owner-action 与后续文档批次 |

### 6.4 变更文件清单

- `packages/eval-observability/src/inspector.ts` — 修复 13-kind catalog drift。
- `workers/orchestrator-core/src/index.ts` — 新增 checkpoint restore public route first-wave。
- `workers/filesystem-core/src/index.ts` — 落本地 path law、snapshot key 修正、cleanup scope 收紧。
- `workers/orchestrator-core/test/chat-lifecycle-route.test.ts` — 覆盖 restore route open-job。
- `workers/filesystem-core/test/leaf-rpc-path-law.test.ts` — 覆盖 leaf RPC path / cleanup prefix 法律。
- `clients/api-docs/*.md`（checkpoints / confirmations / session-ws-v1 / workspace / models / todos / session / README / error-index）— 回刷客户端事实口径。
- `docs/issue/hero-to-pro/hero-to-pro-final-closure.md` / `HP10-closure.md` / `HP0-H10-deferred-closure.md` / `HP7-closure.md` / `HP9-closure.md` / `docs/architecture/test-topology.md` — 修复 closure/test-topology 的陈旧自相矛盾表述。

### 6.5 验证结果

| 验证项 | 命令 / 证据 | 结果 | 覆盖的 finding |
|--------|-------------|------|----------------|
| eval-observability catalog 回归 | `pnpm --filter @nano-agent/eval-observability test` | `pass` | `R1` |
| restore route + facade 类型回归 | `pnpm --filter @haimang/orchestrator-core-worker typecheck && pnpm --filter @haimang/orchestrator-core-worker test` | `pass` | `R3,R6,R8` |
| filesystem leaf RPC path law 回归 | `pnpm --filter @haimang/filesystem-core-worker typecheck && pnpm --filter @haimang/filesystem-core-worker test` | `pass` | `R4,R6` |
| root workspace 回归 | `pnpm test` | `pass` | `R1,R6,R8` |
| cross-e2e 当前真实性确认 | `pnpm test:cross-e2e` | `skipped-with-rationale` | `R5` |
| patch 完整性 | `git --no-pager diff --check` | `pass` | `R2,R6,R8` |

```text
pnpm test: pass
pnpm test:cross-e2e: tests 52 / pass 1 / skipped 51
```

### 6.6 未解决事项与承接

| 编号 | 状态 | 不在本轮完成的原因 | 承接位置 |
|------|------|--------------------|----------|
| `R7` | `deferred` | manual evidence / prod baseline / reviewer memo 需要 owner 环境与外部 artifact，代码 agent 不能代替 | `docs/issue/hero-to-pro/manual-evidence-pack.md`; `docs/issue/hero-to-pro/prod-schema-baseline.md`; owner-action retained |
| `R9` | `deferred` | runbook 路径漂移横跨大量历史文档；本轮优先修当前 source-of-truth 与 runtime 断点 | 后续文档批次（R28 runbook path cleanup） |
| `R10` | `deferred` | gate 改名/扩面需要同步 package.json、脚本、文档与 reviewer 口径；当前真实 catalog 漂移已由代码修复 + root test 消除 | 后续 drift-gate 整理批次 |

### 6.7 Ready-for-rereview gate

- **是否请求二次审查**：`yes`
- **请求复核的范围**：`all findings`
- **实现者认为可以关闭的前提**：
  1. reviewer 接受 `R2/R5` 已从“错误宣称 delivered”收敛为“主文档口径正确 + live-evidence 仍待后续”的处理方式。
  2. owner-action 项 `R7` 与文档批量清理项 `R9/R10` 被接受为 retained/deferred，而不是本轮代码修复的阻断条件。
