# Nano-Agent Real-to-Hero 设计文档审查

> 审查对象: `docs/design/real-to-hero/*.md`
> 审查类型: `docs-review | charter-alignment-review | code-reality-review`
> 审查时间: `2026-04-29`
> 审查人: `GPT-5.5`
> 审查范围:
> - `docs/design/real-to-hero/RH0-bug-fix-and-prep.md`
> - `docs/design/real-to-hero/RH1-lane-f-live-runtime.md`
> - `docs/design/real-to-hero/RH2-models-context-inspection.md`
> - `docs/design/real-to-hero/RH2-llm-delta-policy.md`
> - `docs/design/real-to-hero/RH3-device-auth-gate-and-api-key.md`
> - `docs/design/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md`
> - `docs/design/real-to-hero/RH5-multi-model-multimodal-reasoning.md`
> - `docs/design/real-to-hero/RH6-do-megafile-decomposition.md`
> - `docs/design/real-to-hero/RHX-qna.md`
> 对照真相:
> - `docs/charter/plan-real-to-hero.md`
> - 当前 `workers/` 6-worker 代码事实
> - 当前 `packages/` contract / schema / runtime package 事实
> 文档状态: `changes-requested`

---

## 0. 总结结论

这套 real-to-hero 设计包的主体方向成立：阶段切片、6-worker 约束、不引入 SQLite-DO、owner QNA 不阻断 design 的处理方式，以及 RH1-RH6 的大体 scope 都与 charter r2 保持一致。但当前不应直接作为 action-plan / implementation 的冻结输入，因为它仍存在若干真实漂移：RH1 漏承接 charter P1-E 的 `/usage` strict snapshot，RH2/RH2-delta 对 `tool_use_stop` 的协议口径没有回到当前 schema，RH3/RH4/RH5/RH6 各有局部 blind spot，RHX QNA 还把 charter Q3/Q4 重新编号导致引用容易错位。

- **整体判断**：`设计主线可用，但需要修订后才能作为 RH action-plan 的稳定输入。`
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `不要把 owner 尚未回答 QNA 当 blocker；真正 blocker 是设计文档自身对 charter / code reality 的少数漏承接。`
  2. `RH1 设计把 usage snapshot 视为既有严格读模型，但 charter 明确把 P1-E 放进 RH1，且当前代码仍有 null placeholder fallback。`
  3. `RH2/RH5 的 stream/model/reasoning 能力必须先补 schema / capability law 设计，不能只写“复用现有 schema”或“沿用 capability error 模式”。`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-real-to-hero.md`
  - `docs/templates/code-review.md`
  - `docs/design/real-to-hero/*.md`
- **核查实现**：
  - `workers/orchestrator-core/src/index.ts`
  - `workers/orchestrator-core/src/user-do.ts`
  - `workers/orchestrator-core/src/session-truth.ts`
  - `workers/orchestrator-auth/src/service.ts`
  - `workers/filesystem-core/src/index.ts`
  - `workers/filesystem-core/src/artifacts.ts`
  - `workers/agent-core/src/host/runtime-mainline.ts`
  - `workers/agent-core/src/host/do/nano-session-do.ts`
  - `workers/agent-core/src/llm/{gateway,canonical,request-builder,registry/models}.ts`
  - `packages/nacp-session/src/{messages,stream-event}.ts`
  - `packages/orchestrator-auth-contract/src/index.ts`
  - `workers/orchestrator-core/migrations/00{1..7}-*.sql`
- **执行过的验证**：
  - 文档 / 代码逐项读取与反向 grep。
  - 没有运行 build/test；本轮是设计文档审查，不是代码变更验证。
- **复用 / 对照的既有审查**：
  - `none` — 本文只使用本轮独立核查结果，不采纳其他 reviewer 的分析结论。

### 1.1 已确认的正面事实

- 设计目录中实际存在 9 份文档：RH0、RH1、RH2 主设计、RH2 delta policy、RH3、RH4、RH5、RH6、RHX-qna；其中 `RH2-models-context-inspection.md` 虽未出现在用户列出的路径清单中，但它是真实存在且被多份文档引用的 RH2 主设计。
- 设计包总体遵守 charter 的大边界：不新增 worker、不引入 SQLite-DO、不把 admin plane / billing / second provider / OAuth / sandbox / catalog plug-in 框架提前塞入 real-to-hero。
- 多数代码书签是成立的：`runtime-mainline.ts` 的 `hook.emit()` 仍是 no-op，`onUsageCommit` seam 已存在；`nano-session-do.ts` 已有 async answer waiters 但 runtime hook 尚未真正接入；`verifyApiKey()` 仍返回 `supported:false`；`filesystem-core` 仍是 `/health` + WorkerEntrypoint RPC op list，artifact store 仍是 in-memory。
- 设计包正确承认 QNA 未回答不会阻断 design 产出；这与用户要求一致，也符合 charter 将若干 owner decision 设置为 phase start gate 的思路。

### 1.2 已确认的负面事实

- `RH1-lane-f-live-runtime.md` 明确写“RH1 只负责 push path 活化，HTTP snapshot 的严格语义由现有 /usage 和 RH2 delta-policy 文档管理”，但 charter §7.2 把 `handleUsage HTTP snapshot 查 D1 真实化（替换 null placeholders）`列为 RH1 P1-E；当前 `handleUsage()` 代码仍保留无 usage rows 时的 null placeholder fallback。
- `RH2-models-context-inspection.md` / `RH2-llm-delta-policy.md` 使用 `tool_use_start / delta / stop` 作为 semantic-chunk 口径，但当前 `SessionStreamEventBodySchema` 的 `llm.delta.content_type` 只有 `text | thinking | tool_use_start | tool_use_delta`，没有 `tool_use_stop`。
- `RH3-device-auth-gate-and-api-key.md` 未覆盖 charter 灰区表中已明确 in-scope 的只读 `GET /me/teams`。
- `RH4-filesystem-r2-pipeline-and-lane-e.md` 同时说“R2/KV/D1 真实 artifact persistence”和“DO/KV 不复制冷真相”，但没有给 KV 分配明确职责，容易违反三层真相纪律。
- `RH5-multi-model-multimodal-reasoning.md` 说 reasoning effort 要走 capability law，但当前 `ModelCapabilities` 与 `CapabilityName` 只有 stream/tools/vision/json-schema，没有 reasoning capability；设计没有把 schema / registry / request-builder 的新增字段讲完整。
- `RH6-do-megafile-decomposition.md` 把 `user-do.ts` 描述为完全未拆的单文件巨石，但当前 orchestrator-core 已有 `session-lifecycle.ts`、`session-read-model.ts`、`ws-bridge.ts`、`parity-bridge.ts` 等 seam 模块；RH6 若不承认这些现状，后续 action-plan 很容易重复拆或拆错方向。
- `RHX-qna.md` 把 charter §12 的 Q3/Q4 重新编号为自己的 Q4/Q3，并在 RH5/RH6 设计中用 RHX 编号引用；这不是 owner 未回复问题，而是引用系统自身的漂移风险。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 本轮逐份读取 design docs、charter 关键段落与 workers/packages 代码锚点。 |
| 本地命令 / 测试 | `no` | 本轮目标是文档审查，没有修改代码逻辑，也没有运行测试矩阵。 |
| schema / contract 反向校验 | `yes` | 对照了 `nacp-session` stream/message schema 与 `orchestrator-auth-contract` auth schema。 |
| live / deploy / preview 证据 | `n/a` | 本轮不审查 live deploy evidence。 |
| 与上游 design / QNA 对账 | `yes` | 对账 charter §4/§7/§8/§9/§12/§13 与 RHX-qna 引用。 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | RH1 漏承接 charter P1-E `/usage` strict snapshot | `high` | `scope-drift / correctness` | `yes` | 在 RH1 设计中新增 P1-E/S5/F4，明确消除 null placeholders 与测试证据。 |
| R2 | RH2 semantic-chunk 使用 `tool_use_stop`，但当前 schema 没有该枚举 | `medium` | `protocol-drift` | `yes` | 明确新增 schema 枚举，或改为 `tool_use_delta.is_final` / `tool.call.result` 表示结束。 |
| R3 | RH3 漏掉 charter 已判定 in-scope 的 `GET /me/teams` | `medium` | `scope-drift / docs-gap` | `yes` | 把只读 `GET /me/teams` 纳入 RH3 scope、feature list 和测试口径。 |
| R4 | RH4 没有给 KV 在 file pipeline 中分配明确职责 | `medium` | `architecture-drift / security` | `yes` | 明确 KV 仅作 cache/index/compat 或从“真实 artifact persistence”中移除；冷真相只在 R2+D1。 |
| R5 | RH5 reasoning capability law 未落到现有 registry/schema 结构 | `medium` | `correctness / protocol-drift` | `yes` | 在 RH5 设计中补 `supportsReasoning` / D1 capability / request-builder validation / adapter translation。 |
| R6 | RH6 忽略 `user-do.ts` 已有 seam 模块，拆分起点不够真实 | `medium` | `delivery-gap / docs-gap` | `no` | 把现有 seam 模块列为拆分基线，避免重复拆分与 import cycle。 |
| R7 | RHX QNA 对 charter Q3/Q4 重新编号，跨文档引用容易错配 | `medium` | `docs-gap / governance` | `yes` | 保留 RHX 编号也可以，但必须同时固定 `charter-Q` 与 `rhx-Q` 双编号映射。 |
| R8 | RH0 对 P0-E/P0-G 的功能化承接不足 | `low` | `delivery-gap` | `no` | 在 RH0 详细功能清单中补 preview post-fix verification 与 bootstrap hardening stress tests。 |

### R1. RH1 漏承接 charter P1-E `/usage` strict snapshot

- **严重级别**：`high`
- **类型**：`scope-drift / correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/charter/plan-real-to-hero.md:405-410` 将 RH1 In-Scope 明确列为 P1-A 到 P1-E，其中 P1-E 是 `handleUsage HTTP snapshot 查 D1 真实化（替换 null placeholders）`。
  - `docs/charter/plan-real-to-hero.md:427-431` 将“handleUsage HTTP 不再返回 null；token / tool / cost 真实值”写入 RH1 收口标准。
  - `docs/design/real-to-hero/RH1-lane-f-live-runtime.md:108-110` 写 RH1 只负责 usage push，HTTP snapshot strict 由现有 `/usage` 与 RH2 delta-policy 管理。
  - `workers/orchestrator-core/src/user-do.ts:1215-1220` 注释写当前 usage read 有 D1 聚合，但无 rows 时保留 null-placeholder fallback。
  - `workers/orchestrator-core/src/user-do.ts:1225-1232` 初始化的 usage 字段仍是 `null`。
  - `workers/orchestrator-core/src/session-truth.ts:822-827` 也明确 `readUsageSnapshot()` 在没有 rows 时返回 `null`，caller fallback placeholder。
- **为什么重要**：
  - 这不是 owner QNA 未回答导致的模糊项，而是 design 文档漏掉了 charter 已冻结的 RH1 scope。
  - 如果 RH1 action-plan 以现设计为输入，会只做 WS push，而不会修 `/sessions/{id}/usage` strict snapshot；最终仍可能触发 charter §10.3 的“不允许宣称闭合”类问题。
- **审查判断**：
  - RH1 主线正确，但当前文档对 usage 只覆盖“push preview”，漏掉“HTTP strict read model 修真”。
- **建议修法**：
  - 在 RH1 `§5.1 In-Scope` 增加 **[S5] Usage strict snapshot realification**。
  - 在 RH1 `§7.1 功能清单` 增加 F4 或 F3 拆分子项：`handleUsage D1 snapshot no-null`。
  - 明确 DoD：有 usage rows 时聚合真实 token/tool/cost；无 rows 时返回 0/明确空快照而不是 null placeholder；测试覆盖 happy/no-rows/D1-missing/error path，并与 WS push best-effort 语义分离。

### R2. RH2 semantic-chunk 使用 `tool_use_stop`，但当前 schema 没有该枚举

- **严重级别**：`medium`
- **类型**：`protocol-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/design/real-to-hero/RH2-models-context-inspection.md:46` 将 semantic-chunk 定义为 `tool_use_start / delta / stop`。
  - `docs/design/real-to-hero/RH2-models-context-inspection.md:266-274` 再次要求 `llm.delta` semantic chunk + `tool.call.result`。
  - `docs/design/real-to-hero/RH2-llm-delta-policy.md:41-44` 同样用 `tool_use_start / delta / stop` 描述 semantic-chunk。
  - `packages/nacp-session/src/stream-event.ts:64-69` 当前 `LlmDeltaKind.content_type` 只有 `text`、`thinking`、`tool_use_start`、`tool_use_delta`，没有 `tool_use_stop`。
  - `packages/nacp-session/src/stream-event.ts:18-25` 已有独立 `tool.call.result`，可表达工具最终结果。
- **为什么重要**：
  - RH2/RH2-delta 文档一方面说 `nacp-session` 是 single source，另一方面使用了 single source 中不存在的枚举。
  - 如果 action-plan 不先处理这个分歧，客户端和服务端会在“stop frame 到底是什么”上再次 drift。
- **审查判断**：
  - 设计意图成立，但协议落点不严。当前至少需要二选一：新增 `tool_use_stop` schema，或承认“结束”由 `tool_use_delta.is_final=true` / `tool.call.result` 表示。
- **建议修法**：
  - 在 RH2 主设计和 delta policy 中加一个明确决议：
    - 方案 A：修改 `packages/nacp-session/src/stream-event.ts`，新增 `tool_use_stop` 并加 schema tests；
    - 方案 B：删除 `tool_use_stop` 表述，改为 `tool_use_delta` + `is_final` / `tool.call.result`。
  - 同步更新 `§8 可借鉴代码位置`，不要把当前 schema 描述成已经支持 stop。

### R3. RH3 漏掉 charter 已判定 in-scope 的 `GET /me/teams`

- **严重级别**：`medium`
- **类型**：`scope-drift / docs-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/charter/plan-real-to-hero.md:237` 在灰区判定表中明确 `GET /me/teams` 是 `in-scope (RH3)`，理由是用户可能已经属于多个 team，list 是只读简单查询。
  - `docs/charter/plan-real-to-hero.md:515-519` 也写 RH3 out-of-scope 是 team invite / member management，但“仅做 GET /me/teams 只读”。
  - `docs/design/real-to-hero/RH3-device-auth-gate-and-api-key.md:165-171` 的 RH3 In-Scope 只列 device gate、team_name/team_slug 与 `/me/team` patch、verifyApiKey、conversations、devices/refresh binding，没有 `GET /me/teams`。
  - 当前 `workers/orchestrator-core/src/index.ts:281-293` auth/me 路由存在，但没有 `/me/team` 或 `/me/teams` route。
  - 当前 `packages/orchestrator-auth-contract/src/index.ts:86-90` `AuthTeamSchema` 只有 `team_uuid/membership_level/plan_level`，还没有 `team_name/team_slug`。
- **为什么重要**：
  - `GET /me/teams` 是 charter 已冻结的 RH3 产品面，不是 owner 未回答 QNA，也不是 admin plane。
  - 如果设计遗漏，RH3 action-plan 很可能只做当前 team display 和 patch，最终仍缺多团队只读入口。
- **审查判断**：
  - RH3 对“不要做 invite/member management”的边界是对的，但把只读 team list 也漏掉了。
- **建议修法**：
  - 在 RH3 `§5.1` 和 `§7.1` 增加 `Team Read Surface`：`GET /me/teams` 只读列表 + `/me/team` 当前 team patch。
  - 明确它不是 admin plane：不含 create/invite/remove/change-role。
  - 测试覆盖：401、empty/default team、multi-team membership、字段 shape、跨用户不可见。

### R4. RH4 没有给 KV 在 file pipeline 中分配明确职责

- **严重级别**：`medium`
- **类型**：`architecture-drift / security`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/design/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md:24-25` 自称必须回答 R2 / KV / D1 / DO memory 四层各自负责什么。
  - `docs/design/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md:38` 将 RH4 scope 写成 `R2/KV/D1 持久化`。
  - `docs/design/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md:107-109` 又写 artifact metadata vs binary 必须解耦，R2 存内容，D1 存 metadata，DO/KV 不复制冷真相。
  - `docs/design/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md:164-170` In-Scope 仍写 `R2 / KV / D1 真实 artifact persistence`。
  - 当前代码事实是 `workers/filesystem-core/src/artifacts.ts:27-60` 只有 `ArtifactStore` + `InMemoryArtifactStore`，没有 KV/R2/D1 实现；`workers/filesystem-core/src/index.ts:77-84` 只列 op names。
  - charter §4.4 明确三层真相不互相吸收，且任何为了性能把 D1 数据复制到 KV 的 PR 必须在 charter 层报备。
- **为什么重要**：
  - file pipeline 是高风险多租户路径；KV 如果被写成“真实 artifact persistence”但又不定义职责，会在实现时自然滑向 metadata 冷真相复制或跨租户 cache key 漏洞。
- **审查判断**：
  - RH4 的 R2+D1 主线正确，但 KV 的职责没有被设计冻结。
- **建议修法**：
  - 将 RH4 里的 `R2/KV/D1 持久化` 改成更精确的三分法：
    - R2：binary object truth；
    - D1：metadata/list/read-model truth；
    - KV：可选短 TTL cache / upload idempotency marker / compatibility hot index，不拥有冷真相，不作为 list source。
  - 如果 RH4 first-wave 根本不需要 KV，则从 `Real Artifact Store` 的 “真实 persistence” 中移除 KV，只保留 RH0 binding readiness。
  - 明确所有 KV key 也必须带 `teamUuid/sessionUuid` namespace，并有 TTL / invalidation 规则。

### R5. RH5 reasoning capability law 未落到现有 registry/schema 结构

- **严重级别**：`medium`
- **类型**：`correctness / protocol-drift`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/charter/plan-real-to-hero.md:610-614` 要求 RH5 增加 `CanonicalLLMRequest.reasoning?: { effort: "low|medium|high" }`，且不支持 reasoning 的 model 返回 capability error。
  - `docs/design/real-to-hero/RH5-multi-model-multimodal-reasoning.md:168-172` 将 reasoning effort 纳入 in-scope。
  - `docs/design/real-to-hero/RH5-multi-model-multimodal-reasoning.md:267-275` 写 reasoning effort 进入 canonical request 与 adapter，且不支持模型显式拒绝。
  - 当前 `workers/agent-core/src/llm/canonical.ts:67-77` `CanonicalLLMRequest` 没有 `reasoning` 字段。
  - 当前 `workers/agent-core/src/llm/registry/models.ts:8-18` `ModelCapabilities` 没有 `supportsReasoning` / reasoning effort 范围。
  - 当前 `workers/agent-core/src/llm/registry/models.ts:20-22` `CapabilityName` 只有 `stream | tools | vision | json-schema`。
  - 当前 `workers/agent-core/src/llm/request-builder.ts:56-92` capability validation 覆盖 stream/tools/json-schema/vision，没有 reasoning。
- **为什么重要**：
  - 设计只说“遵循现有 capability error 模式”还不够；现有 capability law 没有 reasoning 这个维度。
  - 如果 action-plan 只加 schema 字段和 adapter 翻译，runtime registry 无法判断哪些模型支持 reasoning，最终会变成 silent ignore 或 provider-specific 临时判断。
- **审查判断**：
  - RH5 方向正确，但缺了关键设计落点：reasoning 必须进入 model capability schema、D1 seed、runtime validation 和 Workers AI adapter translation 四处。
- **建议修法**：
  - 在 RH5 设计中明确新增：
    - `ModelCapabilities.supportsReasoning` 或 `reasoningEfforts?: ("low"|"medium"|"high")[]`；
    - `CapabilityName` 增加 `reasoning`；
    - `CanonicalLLMRequest.reasoning`；
    - D1 `nano_models` / seed 中 reasoning capability 字段；
    - request-builder capability error；
    - usage event 记录 `model_id`，但不引入 per-model quota。

### R6. RH6 忽略 `user-do.ts` 已有 seam 模块，拆分起点不够真实

- **严重级别**：`medium`
- **类型**：`delivery-gap / docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/design/real-to-hero/RH6-do-megafile-decomposition.md:131-139` 描述当前 `user-do.ts` 像一个完全单文件巨石。
  - `workers/orchestrator-core/src/user-do.ts:8-13` 注释说明已有 seam extraction，types + pure helpers 已抽到 4 个 seam 模块。
  - `workers/orchestrator-core/src/user-do.ts:14-73` 已从 `parity-bridge.ts`、`ws-bridge.ts`、`session-lifecycle.ts`、`session-read-model.ts` 导入多类 helper/type。
  - 当前 `workers/orchestrator-core/src/` 已存在 `session-lifecycle.ts`、`session-read-model.ts`、`ws-bridge.ts`、`parity-bridge.ts` 等文件。
  - `workers/agent-core/src/host/do/session-do-*.ts` 当前没有任何匹配文件，说明 RH0 的 agent-core verify/persistence 预拆分尚未发生。
- **为什么重要**：
  - RH6 是拆分 action-plan 的直接输入；如果起点不真实，后续可能重复抽已经存在的 seam，或者把 domain handler 拆分与已有 read/lifecycle/ws seam 搅在一起。
- **审查判断**：
  - RH6 的最终目标合理，但“当前现实”写得太粗，应升级为基于现有 seam 的 incremental decomposition plan。
- **建议修法**：
  - 在 RH6 `§4.2 / §8.2` 明确列出现有 seam 模块和仍留在 `user-do.ts` 的 domain handler。
  - 对 `user-do.ts` 的拆分目标从“从零拆”改成“保留现有 lifecycle/read-model/ws/parity seam，新增 `user-do/handlers/*` 与 infrastructure，消除主文件 domain 密度”。
  - 对 agent-core 侧明确：RH6 依赖 RH0 先创建 `session-do-verify.ts` / `session-do-persistence.ts`，当前代码尚无这些文件。

### R7. RHX QNA 对 charter Q3/Q4 重新编号，跨文档引用容易错配

- **严重级别**：`medium`
- **类型**：`docs-gap / governance`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/charter/plan-real-to-hero.md:924-929` 中 Q3 是 manual evidence 覆盖范围。
  - `docs/charter/plan-real-to-hero.md:930-934` 中 Q4 是 per-model quota。
  - `docs/design/real-to-hero/RHX-qna.md:52-64` 将 per-model quota 登记为 RHX Q3，并在标题中注明来源是 charter §12 Q4。
  - `docs/design/real-to-hero/RHX-qna.md:70-82` 将 manual evidence 登记为 RHX Q4，并在标题中注明来源是 charter §12 Q3。
  - `docs/design/real-to-hero/RH5-multi-model-multimodal-reasoning.md:22,68,176,185,206` 多处引用 `RHX-qna Q3`。
  - `docs/design/real-to-hero/RH6-do-megafile-decomposition.md:50,66,213` 多处引用 `RHX-qna Q4`。
- **为什么重要**：
  - 用户明确说 QNA 未回复不应当作 blocker；但这里的问题不是“未回复”，而是同一个问题在 charter 与 RHX 中编号相反。
  - 后续 owner 可能按 charter Q3/Q4 回答，也可能按 RHX Q3/Q4 回答，导致 RH5/RH6 引错决策。
- **审查判断**：
  - RHX 作为统一 QNA 的思路正确，但不能让编号系统制造新 drift。
- **建议修法**：
  - 在 RHX 每个问题标题中固定双编号，例如 `RHX-Q3 / Charter-Q4 — per-model quota`。
  - 在 RH5/RH6 设计中引用双编号，而不是只写 RHX Q3/Q4。
  - 或者直接让 RHX 编号与 charter §12 完全一致，避免二次编号。

### R8. RH0 对 P0-E/P0-G 的功能化承接不足

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/charter/plan-real-to-hero.md:350-352` 明确 RH0 包含 P0-E preview deploy + manual smoke，以及 P0-G bootstrap hardening stress tests。
  - `docs/charter/plan-real-to-hero.md:366-368` 将 post-fix verification 文档和 `bootstrap-hardening.test.ts` 写成交付物。
  - `docs/design/real-to-hero/RH0-bug-fix-and-prep.md:167-174` In-Scope 包含 bootstrap hardening 与 preview deploy readiness。
  - `docs/design/real-to-hero/RH0-bug-fix-and-prep.md:228-235` 详细功能清单只有 Shared Build Freeze、Endpoint Test Baseline、Storage Bootstrap Prep、Megafile Prep Split，没有把 P0-E/P0-G 作为同等级 feature/DoD 展开。
- **为什么重要**：
  - RH0 是 Start Gate，P0-E/P0-G 都是“能否开工”的硬证据。只在背景或非功能要求中出现，action-plan 很容易把它们写成尾项或遗漏测试。
- **审查判断**：
  - 这不是大方向错误，但 RH0 设计的可执行性低于 charter 要求。
- **建议修法**：
  - 在 RH0 `§7.1` 增加 `F5 Post-Fix Preview Verification` 与 `F6 Bootstrap Hardening`，或者把现有 F3 拆成 storage readiness 与 bootstrap hardening 两个 feature。
  - 明确 P0-G 三个 stress case：cold-start 100 并发 register、D1 慢响应 5s、refresh chain 旋转风暴。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 设计文档 / 项目 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | `RH0-bug-fix-and-prep.md` | `partial` | 大边界对齐 RH0，但 P0-E/P0-G 未在详细功能列表中成为一等交付项。 |
| S2 | `RH1-lane-f-live-runtime.md` | `partial` | hook / permission / elicitation / usage push 主线正确，但漏掉 charter P1-E `/usage` strict snapshot。 |
| S3 | `RH2-models-context-inspection.md` | `partial` | `/models`、`/context`、WS full frame、tool streaming 方向正确；但 `tool_use_stop` 与当前 schema 不一致。 |
| S4 | `RH2-llm-delta-policy.md` | `partial` | snapshot-vs-push、token-level out-of-scope 口径正确；同样需要解决 `tool_use_stop` 与 current schema 的分歧。 |
| S5 | `RH3-device-auth-gate-and-api-key.md` | `partial` | device revoke、team display、verifyApiKey、conversation 对齐主线正确；缺 charter in-scope 的只读 `GET /me/teams`。 |
| S6 | `RH4-filesystem-r2-pipeline-and-lane-e.md` | `partial` | R2+D1+filesystem RPC+Lane E cutover 方向正确；KV 在 artifact pipeline 中的职责不清。 |
| S7 | `RH5-multi-model-multimodal-reasoning.md` | `partial` | model_id、vision、reasoning、Workers AI-only scope 正确；reasoning capability law 未落到当前 registry/schema 结构。 |
| S8 | `RH6-do-megafile-decomposition.md` | `partial` | 收口 phase、three-layer truth、evidence 与 cleanup 方向正确；对 `user-do.ts` 已有 seam 模块的现实描述不足。 |
| S9 | `RHX-qna.md` | `partial` | 集中 QNA 的治理方式正确，owner 未回复不阻断 design；但 Q3/Q4 与 charter 编号相反，需修正引用规则。 |

### 3.1 对齐结论

- **done**: `0`
- **partial**: `9`
- **missing**: `0`
- **stale**: `0`
- **out-of-scope-by-design**: `0`

这更像“设计包主体完成，但还不能冻结为 action-plan 输入”的状态，而不是可以关闭的 reviewed design baseline。所有问题都可以通过文档修订解决，不需要推翻 phase 切片。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | Owner 未回答 QNA | `遵守` | 设计包把 QNA 集中在 RHX，且未将 owner 未回复本身当作当前 design blocker；这符合用户要求。 |
| O2 | 新增第 7 worker | `遵守` | RH1-RH6 都明确在现有 6-worker 内完成。 |
| O3 | SQLite-backed DO | `遵守` | RH6 也明确不引入 SQLite-DO。 |
| O4 | Admin plane / billing / API key UI | `遵守` | RH3 只做 verify-only / manual internal path，没有设计 admin plane。 |
| O5 | Second provider 启用 | `遵守` | RH5 明确 Workers AI 是唯一 required provider。 |
| O6 | Token-level text streaming | `遵守` | RH2 delta-policy 明确 out-of-scope；问题只在 semantic-chunk schema 口径，不在 scope 扩张。 |
| O7 | 3-step presigned upload | `遵守` | RH4 明确只做 first-wave multipart 直传。 |
| O8 | 真机 / 微信 evidence 每 phase 都做 | `遵守` | RH6 才做完整 Tier-C；其他 phase 使用 preview smoke。 |
| O9 | Per-model quota | `遵守但引用需修` | RH5 正确 out-of-scope，但 QNA 编号和 charter Q4/RHX Q3 的引用需统一。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested — 设计包可作为草稿继续推进，但需要修订后才能作为 RH0-RH6 action-plan 的冻结输入。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 修订 RH1，补齐 charter P1-E `/usage` strict snapshot，不再把它完全委托给“现有 /usage”。
  2. 修订 RH2/RH2-delta，明确 `tool_use_stop` 的 schema 决策或删除该不存在枚举。
  3. 修订 RH3，补入只读 `GET /me/teams`。
  4. 修订 RH4，冻结 KV 在 artifact pipeline 中的职责边界。
  5. 修订 RH5，补齐 reasoning capability 的 registry/schema/request-builder/adapter 设计。
  6. 修订 RHX QNA 编号映射，避免 charter Q3/Q4 与 RHX Q3/Q4 错配。
- **可以后续跟进的 non-blocking follow-up**：
  1. RH0 将 P0-E/P0-G 提升为详细功能清单中的一等交付项。
  2. RH6 将现有 `user-do.ts` seam modules 写入当前现实和拆分基线。
- **建议的二次审查方式**：`same reviewer rereview`
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

本轮 review 不收口，等待设计文档按 §2 findings 修订后再次审查。
