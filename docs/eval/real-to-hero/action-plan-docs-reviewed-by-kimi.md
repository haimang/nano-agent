# Action-Plan 文档审查 — real-to-hero 全阶段

> 审查对象: `docs/action-plan/real-to-hero/RH{0..6}-*.md`（共 7 份）
> 审查类型: `docs-review`
> 审查时间: `2026-04-29`
> 审查人: `kimi（独立复核，未参考其他 reviewer 报告）`
> 审查范围:
> - `docs/action-plan/real-to-hero/RH0-bug-fix-and-prep.md`
> - `docs/action-plan/real-to-hero/RH1-lane-f-live-runtime.md`
> - `docs/action-plan/real-to-hero/RH2-models-context-inspection.md`
> - `docs/action-plan/real-to-hero/RH3-device-auth-gate-and-api-key.md`
> - `docs/action-plan/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md`
> - `docs/action-plan/real-to-hero/RH5-multi-model-multimodal-reasoning.md`
> - `docs/action-plan/real-to-hero/RH6-do-megafile-decomposition.md`
> 对照真相:
> - `docs/charter/plan-real-to-hero.md` r2
> - `docs/design/real-to-hero/RH{0..6}-*.md` + `RHX-qna.md` + `RH2-llm-delta-policy.md`
> - 实际代码库 `workers/` / `packages/` / `pnpm-lock.yaml`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：7 份 action-plan 在**设计意图与代码现实的对齐层面**主体成立，但存在 1 个全局 blocker、3 个 high 级别盲点、以及若干 medium/low 级断点与漂移。
- **结论等级**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **本轮最关键的 1-3 个判断**：
  1. **`RHX-qna.md` 5 道业主问答全部空白**，这是整个 real-to-hero 阶段的全局 blocker；action-plan 中大量引用 Q1-Q5 冻结决策，但业主尚未签字。
  2. **RH1-RH5 均假设 `tests/cross-worker/` 目录已存在**，但代码库中该目录缺失，cross-worker e2e 的基础设施需要先行搭建。
  3. **RH0 P0-B 对 ZX5 endpoint 的测试缺口描述准确**，但 action-plan 低估了 5 份新增测试与现有 smoke/parity-bridge 测试的耦合风险。

---

## 1. 审查方法与已核实事实

### 1.1 已确认的正面事实

- **RH0 对巨石文件现状的描述准确**：`nano-session-do.ts` 确为 2078 行，`user-do.ts` 确为 2285 行（`wc -l` 核实）。
- **RH0 对 lockfile 断裂的描述准确**：`pnpm-lock.yaml` 中 `jwt-shared` 出现次数为 0；`agent-runtime-kernel` 和 `capability-runtime` 各有 stale importer（11 行和 23 行）。
- **RH0 对 KV/R2 binding 缺失的描述准确**：6 个 worker 的 `wrangler.jsonc` 中均无 `kv_namespaces` 或 `r2_buckets` 声明。
- **RH1 对 Lane F 断点的描述准确**：`runtime-mainline.ts:296` `emit()` 返回 `undefined`（no-op）；`scheduler.ts` 中无 `hook_emit` 决策产出逻辑；`emitPermissionRequestAndAwait` / `emitElicitationRequestAndAwait` 零调用方（grep 全代码库确认）；`forwardServerFrameToClient` RPC 完全不存在。
- **RH1 对 `handleUsage` null fallback 的描述准确**：`user-do.ts:1226-1230` 使用 `null` 初始化多个字段。
- **RH2 对 `/models`、 `/context` 缺失的描述准确**：`index.ts` 路由白名单中无此二者；无 `handleModels` / `handleContext` handler。
- **RH3 对 device auth 全链路为零的描述准确**：`nano_auth_sessions` 表无 `device_uuid` 列（migration 007 仅有 `nano_user_devices.device_uuid`）；`verifyApiKey()` 返回 `supported: false`；`AccessTokenClaims` / `AuthSnapshot` 无 `device_uuid`。
- **RH3 对 `nano_teams` 缺 `team_name/team_slug` 的描述准确**：migration 001-007 中均无此二列。
- **RH4 对 filesystem-core hybrid 状态的描述准确**：`library_worker: true` 存在；`bindingScopeForbidden()` 401 存在；`InMemoryArtifactStore` 仍在 `nano-session-do.ts:353` 实例化；`wrangler.jsonc` 中 binding 被注释。
- **RH5 对 reasoning/schema 缺口的描述准确**：`CanonicalLLMRequest` 无 `reasoning` 字段；`ModelCapabilities` 无 `supportsReasoning`；`CapabilityName` 缺 `"reasoning"`；`/messages` ingress `kind` 仅接受 `'text' | 'artifact_ref'`。
- **RH5 对 vision flag 错误的描述准确**：`gateway.ts` 两个模型均 `supportsVision: false`（含 `llama-4-scout`）。
- **RH6 对 ZX5 已抽 4 个 seam 的描述准确**：`session-lifecycle.ts` / `session-read-model.ts` / `ws-bridge.ts` / `parity-bridge.ts` 均存在于 `workers/orchestrator-core/src/`。

### 1.2 已确认的负面事实

- **RHX-qna.md 全部业主回答栏空白**：Q1-Q5 的 `业主回答：`后均无内容，意味着 team_slug law、Lane E sunset、per-model quota、evidence 范围、P0-F checklist 均未获业主确认。
- **`tests/cross-worker/` 目录不存在**：action-plan RH1/RH3/RH4/RH5 均计划在此目录放置 e2e 测试，但代码库中无此目录，亦无 cross-worker e2e runner 配置。
- **RH0 P0-B 的测试新增量与现有测试耦合**：现有 `orchestrator-core/test/` 仅 6 个文件（auth/jwt-helper/kid-rotation/parity-bridge/smoke/user-do），新增 5 份 endpoint 测试可能暴露现有 mock 环境对 facade route 的覆盖不足。
- **RH2 对 migration 008 的假设未验证**：`nano_models` 表在 D1 中尚未创建，action-plan 假设 RH2 Phase 2 可以 seed，但未验证 `gateway.ts` 启动时从 D1 读取的可行性。
- **RH3 migration 009 对现有数据的 slug fill 策略未细化**：action-plan 提及"自动生成 slug"，但未给出 migration 内 data fill 的具体 SQL 模板。
- **RH4 Phase 7 sunset PR 的触发条件依赖业主日历**：但业主尚未确认 Q2，sunset 起点无法冻结。
- **RH5 对 Workers AI 模型 catalog 的假设存在漂移风险**：13+4+8 模型的具体 `model_id`、context_window、capability 标记依赖外部 Workers AI 文档，action-plan 未给出查询/验证命令。
- **RH6 对 `madge` 的依赖未验证**：仓库 root `package.json` 中无 `madge` devDep，亦无 `check:cycles` script。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 对 action-plan 中引用的 30+ 处代码位置做了 grep / sed 核实 |
| 本地命令 / 测试 | yes | `wc -l`, `grep`, `ls`, `sed` 等基础命令验证 |
| schema / contract 反向校验 | yes | 核对 `orchestrator-auth-contract`, `nacp-session`, `nano-session-do.ts` schema 状态 |
| live / deploy / preview 证据 | no | 无 preview/deploy 环境访问权限 |
| 与上游 design / QNA 对账 | yes | 每份 action-plan 与其对应 design doc 逐项对账 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | RHX-qna 业主回答全部空白 | critical | delivery-gap | yes | 业主必须先回答 Q1-Q5，否则 action-plan 中冻结决策均悬空 |
| R2 | tests/cross-worker/ 目录与 runner 缺失 | high | delivery-gap | no | RH0 或 RH1 启动前需搭建 cross-worker e2e 基础设施 |
| R3 | RH0 P0-B 新增测试与现有 mock 环境耦合风险 | high | test-gap | no | 在 RH0 action-plan 中补"mock env 兼容性审查"步骤 |
| R4 | RH3 migration 009 slug data fill SQL 未细化 | medium | delivery-gap | no | 在 RH3 action-plan Phase 1 中给出 data fill SQL 模板 |
| R5 | RH5 模型 catalog 假设无验证手段 | medium | correctness | no | 在 RH5 action-plan 中给出 `wrangler ai models --json` 的 catalog 核验命令 |
| R6 | RH6 madge 依赖未声明 | medium | delivery-gap | no | 在 RH0 或 RH6 的 package.json 中预装 madge |
| R7 | 多份 action-plan 行号引用无时间戳 | low | docs-gap | no | 统一补注"截至 2026-04-29 代码快照" |
| R8 | RH4 Phase 7 sunset 触发条件依赖未确认 Q2 | medium | delivery-gap | no | 在业主确认 Q2 前，RH4 Phase 7 为"不可计划"状态 |

### R1. RHX-qna 业主回答全部空白

- **严重级别**：`critical`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/design/real-to-hero/RHX-qna.md` Q1 `业主回答：`后空白（line 32）
  - Q2 `业主回答：`后空白（line 51）
  - Q3 `业主回答：`后空白（line 67）
  - Q4 `业主回答：`后空白（line 87）
  - Q5 `业主回答：`后空白（line 101）
- **为什么重要**：
  - RH3 P3-11 team_slug 生成策略依赖 Q1
  - RH4 Phase 7 sunset 日历依赖 Q2
  - RH5 usage event 字段范围依赖 Q3
  - RH6 evidence pack 范围依赖 Q4
  - RH0 P0-F checklist 执行政策依赖 Q5
  - 5 道问题全部悬空意味着 5 份 action-plan 的核心冻结决策均建立在"假设业主同意 Opus 路线"上，而非业主实际确认。
- **审查判断**：
  - 这是全局 blocker，不是单个 phase 的问题。
  - action-plan 文档本身质量合格，但它们引用的上游冻结决策尚未生效。
- **建议修法**：
  - 在 `RHX-qna.md` 获得业主回答前，所有 action-plan 应标注 `[PENDING OWNER QNA]` 前缀。
  - 或者在 `docs/eval/real-to-hero/action-plan-docs-reviewed-by-kimi.md` 本文件中显式列出"业主回答前不可启动 implementation"。

### R2. tests/cross-worker/ 目录与 runner 缺失

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`（可通过 RH0 前置解决）
- **事实依据**：
  - `find tests -type d` 无 `tests/cross-worker/` 目录
  - `package.json` root scripts 无 cross-worker e2e runner
  - RH1 P1-10/11/12、RH3 P3-16、RH4 P4-14、RH5 P5-13/14/15/16 均计划在此目录放置测试
- **为什么重要**：
  - 7 份 action-plan 中共计划 ≥10 份 cross-worker e2e 测试，但基础设施不存在。
  - 若按现有 miniflare 配置直接运行，service binding 跨 worker 的行为可能与 production 不一致。
- **审查判断**：
  - action-plan 把 cross-worker e2e 当作"新增测试文件"处理，低估了 runner 搭建工作量。
- **建议修法**：
  - RH0 或 RH1 启动前，先搭建 `tests/cross-worker/` 目录 + miniflare 多 worker 配置模板。
  - 在 RH0 action-plan §7.3 文档同步要求中增加"cross-worker e2e runner setup"。

### R3. RH0 P0-B 新增测试与现有 mock 环境耦合风险

- **严重级别**：`high`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - 现有 `workers/orchestrator-core/test/` 只有 6 个文件，其中 `smoke.test.ts` 和 `parity-bridge.test.ts` 已大量 mock facade 内部行为。
  - 新增 5 份 endpoint test（messages/files/me-conversations/me-devices/me-devices-revoke）需要更完整的 facade route + auth + D1 mock。
- **为什么重要**：
  - 如果现有 mock 环境不支持 `needsBody` 或 route 参数解析，新增测试可能在 RH0 就暴露基础设施缺口，而非"轻松新增 5 个文件"。
- **审查判断**：
  - action-plan 对 P0-B 的风险评级为"low"，但我判断应为"medium"——因为 ZX5 的 `needsBody` silent-drop bug（DS R1）说明 facade 测试基础设施曾存在盲区。
- **建议修法**：
  - RH0 P0-B1 至 P0-B5 每个工作项的风险等级从 `low` 调整为 `medium`。
  - 增加一步："先验证现有 mock 环境对 `needsBody` + route param 的支持，再批量新增 5 份测试"。

### R4. RH3 migration 009 slug data fill SQL 未细化

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - RH3 action-plan P3-01 提及"现有行通过 migration data fill 自动生成 slug"，但未给出 SQL。
  - design RH3 §8.4 同样只说"自动生成"，无具体 fill 逻辑。
- **为什么重要**：
  - `nano_teams` 当前已有数据（ZX5 注册产生），`ALTER TABLE ADD COLUMN team_slug TEXT NOT NULL` 会导致 migration apply 失败，除非同一 migration 内先 fill 再改约束。
- **审查判断**：
  - 这是典型的"migration forward-only 风险"，action-plan 和 design 都未给出可执行的 SQL 模板。
- **建议修法**：
  - 在 RH3 action-plan §4.1 P3-01 中给出 data fill SQL 示例：
    ```sql
    -- 先加可空列
    ALTER TABLE nano_teams ADD COLUMN team_slug TEXT;
    -- fill 现有数据
    UPDATE nano_teams SET team_slug = substr(lower(replace(team_name,' ','-')),1,25)||'-'||lower(hex(randomblob(3)));
    -- 再加约束
    ALTER TABLE nano_teams ADD CONSTRAINT uniq_team_slug UNIQUE(team_slug);
    ```
  - 或接受 `DEFAULT ''` 后由 application 层回填（但 design 倾向 `NOT NULL`）。

### R5. RH5 模型 catalog 假设无验证手段

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - RH5 计划 seed 13+4+8=25 个 Workers AI 模型，但未给出 catalog 查询命令。
  - `wrangler ai models --json` 输出格式和模型 ID 可能随 Cloudflare 更新而变化。
- **为什么重要**：
  - 如果 seed 的 `model_id` 拼写错误，RH5 的 `/models` endpoint 会返回无法执行的模型，导致 client 选择后 runtime 报错。
- **审查判断**：
  - action-plan 依赖 implementer"查最新 Workers AI 模型 catalog"，但未给出验证命令和失败处置。
- **建议修法**：
  - 在 RH5 action-plan §4.2 P5-04 中增加："seed 前执行 `wrangler ai models --json | jq -r '.[].name'` 核对 model_id；任何不在 catalog 中的模型标记为 `NOT NULL but disabled`"。

### R6. RH6 madge 依赖未声明

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - RH6 action-plan P6-01 要求"添加 `madge` devDep"，但 root `package.json` 中无此依赖。
  - 也无 `check:cycles` script。
- **为什么重要**：
  - RH6 把 `madge --circular` 0 cycle 作为硬 gate，但如果依赖未预装，CI 会在 RH6 最后一步才报错。
- **审查判断**：
  - 建议将 madge 安装前置到 RH0 或 RH1，而非留到 RH6。
- **建议修法**：
  - 在 RH0 P0-A2（或独立 P0-H）中增加"安装 madge + 跑 baseline cycle check"，提前暴露既有 cycle。

### R7. 多份 action-plan 行号引用无时间戳

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - RH0 引用 `nano-session-do.ts:1723-2078`、RH1 引用 `runtime-mainline.ts:295-298`、RH2 引用 `user-do.ts:1456` 等。
  - 这些行号基于 2026-04-29 快照，但文档未统一标注。
- **为什么重要**：
  - RH0-RH5 实施后，行号必然漂移，后续 reviewer 难以核对。
- **审查判断**：
  - design RH0 §9.1 已采纳 GLM-R7 的修订（加注"截至 2026-04-29 代码快照"），但 action-plan 未统一。
- **建议修法**：
  - 在每份 action-plan 的 header 或 §1.5 影响结构图处统一加注："代码行号引用截至 2026-04-29 快照，实施时需二次校验"。

### R8. RH4 Phase 7 sunset 触发条件依赖未确认 Q2

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`（但导致 Phase 7 不可执行）
- **事实依据**：
  - RH4 action-plan §4.7 P4-11 要求"Phase 4 prod 启用日 + 14 天后物理删除 library import"。
  - 但 `RHX-qna.md` Q2 业主回答空白，sunset 长度、起点定义、4 项限定均未确认。
- **为什么重要**：
  - 若业主不同意 Opus 的 4 项限定（尤其是"RPC-first 失败必须 throw"），RH4 Phase 4-7 的 risk profile 会完全改变。
- **审查判断**：
  - RH4 action-plan 对 Phase 7 的风险评级为"medium"，但在 Q2 未确认前应为"不可计划"。
- **建议修法**：
  - 在 RH4 action-plan §4.7 / §5.7 增加前置条件："本 Phase 依赖 RHX-qna Q2 业主确认后方可执行"。

---

## 3. 逐 Action-Plan In-Scope 对齐审核

### RH0 — Bug Fix and Prep

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|----------------|----------|------|
| S1 | P0-A1 lockfile 重建 + stale importer 清理 | done | 与代码现实完全一致（jwt-shared 0 次出现；stale importer 存在） |
| S2 | P0-A2 jwt-shared 独立 build/typecheck/test | done | `packages/jwt-shared/` 结构完整，需验证 NODE_AUTH_TOKEN |
| S3 | P0-C1 6 worker KV/R2 binding 占位 | done | 6 个 wrangler.jsonc 均无 binding，描述准确 |
| S4 | P0-B 5 份 endpoint 测试新增 | partial | 缺口描述准确，但 mock 环境耦合风险被低估（R3） |
| S5 | P0-D1/D2 verify/persistence 预拆分 | partial | 目标合理，但 `nano-session-do.ts:1723-2078` 的 verify subsystem 边界需实施时二次确认 |
| S6 | P0-G bootstrap-hardening 3 case | done | 设计合理，但建议增加 madge baseline（R6） |
| S7 | P0-F owner checklist 8 步 | partial | 依赖 Q5 业主回答（R1） |

**RH0 对齐结论**：更像"断点描述准确，但测试基础设施与 owner 确认存在前置缺口"。

### RH1 — Lane F Live Runtime

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|----------------|----------|------|
| S1 | P1-01 scheduler 产生 hook_emit | done | `kernel/types.ts` 已含 `hook_emit` 变体，scheduler 缺产出逻辑，描述准确 |
| S2 | P1-02 runtime-mainline.hook.emit 调 dispatcher | done | `emit()` 当前返回 `undefined`，描述准确 |
| S3 | P1-03/04 emitPermission/Elicitation 真 emit | done | `emitPermissionRequestAndAwait` / `emitElicitationRequestAndAwait` 零调用方，描述准确 |
| S4 | P1-06/07 forwardServerFrameToClient RPC | done | 完全不存在，"全新实装"描述准确 |
| S5 | P1-09 handleUsage no-null | done | `user-do.ts:1226-1230` null fallback 存在，描述准确 |
| S6 | P1-10~13 cross-worker e2e | missing | `tests/cross-worker/` 目录不存在（R2） |

**RH1 对齐结论**：对代码断点的诊断极其准确，但 e2e 测试基础设施缺失是显性 gap。

### RH2 — Models & Context Inspection

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|----------------|----------|------|
| S1 | P2-01 NACP schema 注册 heartbeat/terminal/superseded | done | `nacp-session` 当前无此三 schema，描述准确 |
| S2 | P2-03 migration 008 + `/models` | done | `nano_models` 表不存在，`/models` 路由不存在，描述准确 |
| S3 | P2-05~07 `/context` + snapshot/compact | done | 路由和 handler 均不存在，描述准确 |
| S4 | P2-08 emitServerFrame 走 validateSessionFrame | done | `user-do.ts:1204` `emitServerFrame` 使用 `{ kind: string; [k: string]: unknown }` 而非 NACP schema，描述准确 |
| S5 | P2-12 tool semantic chunk | done | `runtime-mainline.ts` 两层归一化存在，需对齐 |
| S6 | P2-14/15 web/wechat adapter 升级 | partial | adapter 升级工作量被低估；wechat mini-program 兼容性风险未量化 |

**RH2 对齐结论**：服务端断点描述准确，但客户端 adapter 升级的风险面大于 action-plan 评估。

### RH3 — Device Auth Gate and API Key

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|----------------|----------|------|
| S1 | P3-01 migration 009 三表变更 | partial | schema 变更清单准确，但 slug data fill SQL 未细化（R4） |
| S2 | P3-02 contract 升级 | done | `AuthTeam` / `AccessTokenClaims` / `AuthSnapshot` 缺字段，描述准确 |
| S3 | P3-03/04 device_uuid mint + refresh bind | done | login/register/refresh 无 device_uuid，描述准确 |
| S4 | P3-05/06 device gate access/refresh/WS | done | `authenticateRequest` 和 `handleWsAttach` 无 device 校验，描述准确 |
| S5 | P3-08 verifyApiKey 真实化 | done | `service.ts:402` 返回 `supported: false`，描述准确 |
| S6 | P3-14 `/me/conversations` 双源 + cursor | done | 当前仅 D1，与 `/me/sessions` 口径不一致，描述准确 |

**RH3 对齐结论**：对 auth 断点的诊断准确，但 migration data fill 是实施盲点。

### RH4 — Filesystem R2 Pipeline and Lane E

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|----------------|----------|------|
| S1 | P4-01 migration 010 | done | `nano_session_files` 表不存在，描述准确 |
| S2 | P4-03 R2ArtifactStore 组装 | done | `storage/adapters/` 已建 484 行，描述准确 |
| S3 | P4-04/05 filesystem-core RPC 收口 | done | `library_worker:true` + 401 存在，描述准确 |
| S4 | P4-06/07 agent-core binding + dual-track | done | binding 注释 + `InMemoryArtifactStore` 存在，描述准确 |
| S5 | P4-11 sunset PR | stale | 依赖 Q2 业主回答（R1/R8） |

**RH4 对齐结论**：对 hybrid 状态的诊断准确，但 sunset 纪律在业主确认前不可执行。

### RH5 — Multi-Model Multimodal Reasoning

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|----------------|----------|------|
| S1 | P5-01~03 schema 前置扩展 | done | `model_id` / `reasoning` / `supportsReasoning` 均缺失，描述准确 |
| S2 | P5-04 migration 011 seed | partial | 25 模型 seed 策略合理，但 catalog 验证手段缺失（R5） |
| S3 | P5-08 vision 激活 | done | `llama-4-scout` `supportsVision: false`，描述准确 |
| S4 | P5-09/10 `/messages` image_url ingress | done | `kind` 仅 `'text' | 'artifact_ref'`，描述准确 |
| S5 | P5-12 usage event 扩字段 | done | `onUsageCommit` payload 当前未含 model_id 等，描述准确 |

**RH5 对齐结论**：对 capability 缺口的诊断准确，但模型 seed 的 catalog 对齐是实施盲点。

### RH6 — DO Megafile Decomposition

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|----------------|----------|------|
| S1 | P6-01 madge CI gate | missing | `madge` 未安装，无 `check:cycles` script（R6） |
| S2 | P6-02 baseline 依赖图 | done | 目标合理，可作为 RH6 起点 |
| S3 | P6-03~08 NanoSessionDO 拆分 7 文件 | done | 目标合理，与 RH0 verify/persistence 预拆分衔接自然 |
| S4 | P6-09/10 user-do 拆分 | done | 在 ZX5 4 seam 之上新增 handlers，策略正确 |
| S5 | P6-12 three-layer-truth.md | done | 目标合理，但需与代码严格回绑 |
| S6 | P6-16~20 evidence pack 5 套×4 scenario | partial | 依赖 Q4 业主回答（R1）；20 case 工作量巨大 |

**RH6 对齐结论**：拆分策略合理，但 madge 基础设施和 evidence 范围均依赖前置确认。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | RH0 不抢跑 RH1+ feature | 遵守 | 无 Lane F / models / device gate / filesystem 混入 RH0 |
| O2 | RH1 不做 token-level streaming | 遵守 | 与 RH2-llm-delta-policy 一致 |
| O3 | RH2 不做 13+4+8 全模型（留 RH5） | 遵守 | RH2 仅 seed schema，模型扩展在 RH5 |
| O4 | RH3 不做 API key admin plane | 遵守 | verify-only 路径，无 list/create UI |
| O5 | RH4 不做 3-step presigned upload | 遵守 | multipart 直传 first-wave |
| O6 | RH5 不做 second provider | 遵守 | Workers AI only |
| O7 | RH6 不做新功能 / SQLite-DO | 遵守 | refactor + closure only |
| O8 | 不新增 worker（charter D1） | 遵守 | 全部 6 个 phase 无新增 worker 计划 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：7 份 action-plan 在**诊断代码断点**方面表现出极高准确性——对 hook no-op、KV/R2 缺失、device auth 为零、filesystem hybrid、schema 缺口等关键 gap 的描述与代码现实几乎完全一致。但在**执行前提**方面存在全局缺口：业主 QNA 全部未回答，cross-worker e2e 基础设施缺失，以及部分实施细节（migration data fill、模型 catalog 验证、madge 预装）未细化。
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. **RHX-qna.md Q1-Q5 获得业主回答并签字**。这是最高优先级 blocker，影响 RH0/RH3/RH4/RH6 的核心决策。
  2. **搭建 `tests/cross-worker/` 目录与 miniflare runner**。建议在 RH0 或 RH1 Phase 1 前完成，否则 RH1/RH3/RH4/RH5 的 e2e 收口标准无法执行。
  3. **RH3 action-plan 补 migration 009 slug data fill SQL 模板**。
- **可以后续跟进的 non-blocking follow-up**：
  1. 在 root `package.json` 预装 `madge` + `check:cycles` script（R6）。
  2. RH5 action-plan 补 Workers AI catalog 验证命令（R5）。
  3. 统一 7 份 action-plan 的行号引用时间戳标注（R7）。
  4. RH0 P0-B 风险等级从 low 上调至 medium（R3）。
- **建议的二次审查方式**：`same reviewer rereview`（在 RHX-qna 业主回答后，复核 action-plan 是否需要因业主答案而调整）
- **实现者回应入口**：请按 `docs/templates/code-review-respond.md` 在本文档 §6 append 回应，不要改写 §0–§5。

> 本轮 review 不收口，等待：
> 1. 业主回答 RHX-qna Q1-Q5；
> 2. 搭建 cross-worker e2e 基础设施；
> 3. RH3 action-plan 补 migration data fill SQL。
> 以上三项完成后，可进入二次审查。

---

## 6. 附录：各 Action-Plan 与代码现实的关键行号对照表

| Action-Plan 引用 | 文件:行 | 核实结果 | 备注 |
|------------------|---------|----------|------|
| RH0 §8.2 nano-session-do.ts:159-2078 | `workers/agent-core/src/host/do/nano-session-do.ts:1-2078` | ✅ 准确 | 文件共 2078 行 |
| RH0 §8.2 user-do.ts:1-2285 | `workers/orchestrator-core/src/user-do.ts:1-2285` | ✅ 准确 | 文件共 2285 行 |
| RH0 §8.3 runtime-mainline.ts:481-502 | `workers/agent-core/src/host/runtime-mainline.ts:481-528` | ⚠️ 偏移 | 实际 createLiveKernelRunner 在 481-528 |
| RH0 §8.3 user-do.ts:755-989 | `workers/orchestrator-core/src/user-do.ts:755-989` | ✅ 大致准确 | /start 幂等 claim 区域 |
| RH0 §8.4 hooks/dispatcher.ts:1-149 | `workers/agent-core/src/hooks/dispatcher.ts:1-~149` | ✅ 准确 | HookDispatcher class 存在 |
| RH1 §4.2 runtime-mainline.ts:295-298 | `workers/agent-core/src/host/runtime-mainline.ts:296` | ✅ 准确 | `emit()` 返回 `undefined` |
| RH1 §4.2 nano-session-do.ts:797-815 | `workers/agent-core/src/host/do/nano-session-do.ts:797-815` | ✅ 准确 | emitPermissionRequestAndAwait |
| RH1 §4.2 nano-session-do.ts:817-829 | `workers/agent-core/src/host/do/nano-session-do.ts:817-829` | ✅ 准确 | emitElicitationRequestAndAwait |
| RH1 §4.4 nano-session-do.ts:494-501 | `workers/agent-core/src/host/do/nano-session-do.ts:494-501` | ✅ 准确 | onUsageCommit console.log |
| RH1 §4.5 user-do.ts:1215-1257 | `workers/orchestrator-core/src/user-do.ts:1220-~1240` | ⚠️ 微偏 | handleUsage 在 1220 行开始 |
| RH2 §4.4 user-do.ts:1196-1212 | `workers/orchestrator-core/src/user-do.ts:1204` | ⚠️ 微偏 | emitServerFrame 在 1204 行 |
| RH2 §4.4 user-do.ts:1905-1981 | `workers/orchestrator-core/src/user-do.ts:1905` | ✅ 准确 | handleWsAttach 在 1905 行 |
| RH3 §8.2 user-do.ts:1286-1415 | `workers/orchestrator-core/src/user-do.ts:1286-1415` | ✅ 准确 | permission/elicitation relay |
| RH3 §8.2 index.ts:618-646 | `workers/orchestrator-core/src/index.ts:618-646` | ✅ 准确 | /me/conversations route |
| RH4 §8.1 filesystem-core/index.ts:50-85 | `workers/filesystem-core/src/index.ts:24,46` | ⚠️ 偏移 | bindingScopeForbidden 在 24 行，调用在 46 行 |
| RH4 §8.2 agent-core/wrangler.jsonc:43-50 | `workers/agent-core/wrangler.jsonc:43-50` | ✅ 准确 | binding 注释区域 |
| RH5 §8.3 user-do.ts:1456 | `workers/orchestrator-core/src/user-do.ts:1456` | ✅ 准确 | /messages ingress kind 数组 |
| RH5 §8.3 canonical.ts:67-77 | `workers/agent-core/src/llm/canonical.ts:67-77` | ✅ 准确 | CanonicalLLMRequest 定义 |

> 注：行号偏移主要发生在 RH0 §8.3（runtime-mainline.ts:481-502 实际为 481-528）和 RH4 §8.1（filesystem-core 的 401 处理行号微偏）。这些偏移不影响 design/action-plan 的实质判断，但提醒实施时需以实际代码为准，不宜机械照搬行号。

---

*审查结束。本审查仅基于 kim 独立推理完成，未参考 GPT/deepseek/GLM 等其他 reviewer 的分析报告。*
