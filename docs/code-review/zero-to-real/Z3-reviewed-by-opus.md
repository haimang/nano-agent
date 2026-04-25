# Z3 Code Review — Real Runtime and Quota（by Opus）

> 审查对象: `zero-to-real / Z3 / real-runtime-and-quota`
> 审查时间: `2026-04-25`
> 审查人: `Opus 4.7 (1M context)`
> 审查范围:
> - `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md`（含 §10 GPT 工作日志）
> - `docs/issue/zero-to-real/Z3-closure.md`
> - `docs/design/zero-to-real/Z3-real-runtime-and-quota.md`
> - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`
> - `docs/design/zero-to-real/ZX-llm-adapter-and-secrets.md`
> - `docs/design/zero-to-real/ZX-qna.md`（Q5 / Q6 / Q7 / Q8 / Q9）
> - `workers/agent-core/src/host/runtime-mainline.ts`（new）
> - `workers/agent-core/src/host/quota/{authorizer,repository}.ts`（new）
> - `workers/agent-core/src/llm/{gateway.ts, adapters/workers-ai.ts, registry/**}`
> - `workers/agent-core/src/kernel/runner.ts`
> - `workers/agent-core/src/host/{orchestration.ts, do/nano-session-do.ts, internal-policy.ts}`
> - `workers/agent-core/src/index.ts`
> - `workers/bash-core/src/worker-runtime.ts`
> - `workers/agent-core/wrangler.jsonc`
> - `workers/orchestrator-core/migrations/004-usage-and-quota.sql`（new）
> - `workers/orchestrator-core/src/user-do.ts`（含 forwardStart / forwardStatus）
> - `context/ddl-v170/smind-09-tenant-billing-quota-usage.sql`（参考)
> - `context/ddl-v170/smind-01-tenant-identity.sql`（参考）
> - `test/cross-e2e/**`、`test/package-e2e/**`、`workers/agent-core/test/**`、`workers/bash-core/test/**`
> 文档状态: `changes-requested`

---

## 0. 总结结论

> 这一份 Z3 工作把 **Workers AI binding、quota authorizer、`runtime-mainline` 组装、bash-core second-gate ticket、`004-usage-and-quota.sql`、preview AI binding 部署** 一次性接到了主路径上，主体骨架是真的。但它**不应作为可关闭、可解锁 Z4 的 closed Z3** 通过本轮 review，原因是 **真实 Workers AI 调用与 quota dual-gate 这两条本阶段唯一“执行真理”的主线，从来没有被任何一条单测、集成测、或 live e2e 测过——所有 GPT 在 closure 中引用的 36/36 + 12/12 通过证据，全部来自不触碰 Z3 新增代码的旧有 capability/probe 测试套**。

- **整体判断**：`Z3 主体骨架成立，但 in-scope §S1 / §S3 / §S5 收口标准被实现，但未被任何测试或 live evidence 真实证明；同时 ZX-LLM-adapter 中的 deepseek skeleton 与 gateway 退役要求，被实现路径绕开未落地`
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. **测试侧零证据**：Z3 在仓库中没有任何一条 test 真正调用了 `runtime-mainline`、`QuotaAuthorizer`、`invokeWorkersAi` 或写入 `nano_quota_balances / nano_usage_events`；Phase 5 §收口标准“至少一轮真实 prompt->tool->response 成功，负例 reject 正常”在代码层完全缺位。closure §3.3 引用的 36/36 + 12/12 是 Z2 同样套件 verbatim 复用，并不能证明 Z3 的新代码工作。
  2. **ZX-LLM-adapter 的 §F2 / §F4 收口被绕开而不是被达成**：`workers/agent-core/src/llm/gateway.ts` 仍是 “Stub interface only — not implemented in v1.” 的 16 行占位（design 与 Q8 Opus 答案明确要求它退出 stub）；`workers/agent-core/src/llm/adapters/deepseek/` skeleton 目录**根本没有创建**。Z3 用 `runtime-mainline.ts` 直接调 `invokeWorkersAi` 绕过了 gateway 与 registry，从而把这两个 design 法则跳过去而不是收口。
  3. **写权与 audit lineage 漂移**：`D1QuotaRepository.ensureTeamSeed()` 让 `agent-core` 直接 `INSERT OR IGNORE INTO nano_users / nano_teams`——这违反了 ZX-D1 §7.3.5 frozen write-ownership matrix（identity core 只能由 `orchestrator.auth` 主写）；同时 `appendActivity` 把 `actor_user_uuid / conversation_uuid` 永远写为 NULL，丢失了 ZX-D1 §7.3.6 与 Q5 已冻结的 lineage 责任；durable usage 也丢了 `provider_key`（design F1 §判定方法 3 显式要求）。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md`（Phase 1-5 + §10 工作日志）
  - `docs/issue/zero-to-real/Z3-closure.md`（§1 结论 / §2 实际交付 / §3 验证证据 / §5 residuals）
  - `docs/design/zero-to-real/Z3-real-runtime-and-quota.md`（F1-F4 + §7 收口判定）
  - `docs/design/zero-to-real/ZX-llm-adapter-and-secrets.md`（F1-F4，特别是 F1 §判定方法 3、F2 §判定方法 1、F4 §判定方法 1）
  - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`（§7.3.1 表清单 / §7.3.5 写权 matrix / §7.3.6 activity discipline）
  - `docs/design/zero-to-real/ZX-qna.md`（Q8 / Q9 frozen owner answers）
- **核查实现**：
  - `workers/agent-core/src/host/runtime-mainline.ts` 256 行
  - `workers/agent-core/src/host/quota/authorizer.ts` 201 行
  - `workers/agent-core/src/host/quota/repository.ts` 354 行
  - `workers/agent-core/src/llm/adapters/workers-ai.ts` 318 行
  - `workers/agent-core/src/llm/gateway.ts` 16 行（仍 stub）
  - `workers/agent-core/src/llm/registry/{providers,models,loader}.ts`
  - `workers/agent-core/src/kernel/runner.ts`（`beforeLlmInvoke` / `afterLlmInvoke` hooks）
  - `workers/agent-core/src/host/orchestration.ts`（kernel snapshot 驱动 step-loop）
  - `workers/agent-core/src/host/do/nano-session-do.ts`（live KernelRunner + quota wiring）
  - `workers/agent-core/src/host/internal-policy.ts`（`validateInternalRpcMeta` vs `validateInternalAuthority`）
  - `workers/agent-core/src/index.ts`（WorkerEntrypoint `start / status` RPC）
  - `workers/bash-core/src/worker-runtime.ts`（`pendingQuotaAuthorizations` second gate）
  - `workers/orchestrator-core/migrations/004-usage-and-quota.sql`（new wave C）
  - `workers/orchestrator-core/src/user-do.ts`（forwardStart / forwardStatus parity）
  - `workers/agent-core/wrangler.jsonc`（`AI` binding / `NANO_AGENT_DB` / `NANO_AGENT_LLM_CALL_LIMIT` / `NANO_AGENT_TOOL_CALL_LIMIT`）
- **执行过的验证**：
  - 全仓 `grep -rln -i "QuotaExceeded|nano_usage_events|nano_quota_balances|workers-ai|invokeWorkersAi|runtime-mainline|createMainlineKernelRunner"` → `0` 个 test 文件命中
  - `grep -rn "real prompt|workers-ai|@cf/|granite|llama|llm.invoke|runtime.llm" test/ workers/agent-core/test/` → `0` 命中
  - `find workers/agent-core/src/llm -name "*deepseek*"` → 空
  - `cat workers/agent-core/src/llm/gateway.ts` → 仍是 “Stub interface only — not implemented in v1.”
  - 对照 `context/ddl-v170/smind-09` schema 与 `migrations/004-usage-and-quota.sql` 的 column shape

### 1.1 已确认的正面事实

- `wrangler.jsonc:52-54` 与 `env.preview.ai` 都已声明 `{"ai": {"binding": "AI"}}`，binding contract 真实落到部署文件。
- `wrangler.jsonc:14` `TEAM_UUID` / `:16-17` `NANO_AGENT_LLM_CALL_LIMIT=200` / `NANO_AGENT_TOOL_CALL_LIMIT=400` / `:46-50` `NANO_AGENT_DB → nano-agent-preview / 71a4b089-...` 都是真实 preview env。
- `workers/agent-core/src/llm/adapters/workers-ai.ts:7-9` 把 `WORKERS_AI_PRIMARY_MODEL = "@cf/ibm-granite/granite-4.0-h-micro"` 与 `WORKERS_AI_FALLBACK_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct"` 冻结进代码常量（设计 §F1 frozen 一致）。
- `workers/agent-core/src/host/runtime-mainline.ts:104-253` 确实把 LLM、tool、quota authorizer 装配成单一 `KernelRunner`，覆盖 design §F1 / §F2 / §F4 主结构。
- `workers/agent-core/src/kernel/runner.ts:31-42, 160-256` 新增 `beforeLlmInvoke` / `afterLlmInvoke` hook，并在 `handleLlmCall` 的 try/catch 里把 `QUOTA_EXCEEDED` 走 `complete_turn + system.notify` 而不是裸抛。
- `workers/agent-core/src/host/do/nano-session-do.ts:471-481` 只有当 `runtimeEnv.AI` 真实存在时才 `createMainlineKernelRunner`，否则返回 null（honest fallback，design Phase 2 §风险提醒达成）。
- `workers/orchestrator-core/migrations/004-usage-and-quota.sql:1-34` 落下 `nano_quota_balances` 与 `nano_usage_events`，带 FK→`nano_teams`、`UNIQUE(team_uuid, resource_kind, idempotency_key)`、3 条索引（团队按 created_at DESC、按 trace_uuid、按 balance updated_at DESC）。
- `workers/orchestrator-core/src/user-do.ts:710-782` `forwardStart` 与 `forwardStatus` 均已切到 fetch + RPC dual-run + `jsonDeepEqual` parity gate（这是 Z2 W-1 想看到的 follow-up 的一部分，但仍未完全收口——见 R12 / 跨阶段 §5）。
- `workers/bash-core/src/worker-runtime.ts:128-145` 真实在 `beforeCapabilityExecute` hook 中校验 `pendingQuotaAuthorizations.get(requestId)` 的 verdict / quota_kind / request_id / tool_name 4 字段一致——design §F2 §3.3 “tool reject 与 LLM gate 行为一致” 在结构层面达成。
- `workers/agent-core/src/host/quota/authorizer.ts:56-106` 把 deny path 同时写 `usage event(verdict='deny')` + `activity log(event_kind='quota.deny')` + `trace event` 三处可观测，覆盖 Q9 §最终回答 “不允许静默吞掉”。

### 1.2 已确认的负面事实

- **测试侧零覆盖**：仓库中**没有任何一条** test 文件 import 或断言 `QuotaAuthorizer / QuotaExceededError / D1QuotaRepository / runtime-mainline / createMainlineKernelRunner / invokeWorkersAi / WORKERS_AI_PRIMARY_MODEL / nano_quota_balances / nano_usage_events`。包括：
  - `workers/agent-core/test/host/{do,integration,quota}/**`：没有 `quota` 目录，没有 `runtime-mainline.test.ts`，没有 `quota-authorizer.test.ts`。
  - `test/package-e2e/agent-core/01-preview-probe.test.mjs` 只断言 `live_loop: true` 这条 string envelope，不调用 LLM。
  - `test/cross-e2e/02-agent-bash-tool-call-happy-path.test.mjs` 仍走 `verify -> capability-call`，与 Z3 之前没有差别。
  - `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs` 第 7 行注释 “A future credit/quota charter may need to extend this test with funded / authorized fixture state.” 这条 charter 就是 Z3，但本轮 Z3 没有把它落实。
- **`workers/agent-core/src/llm/gateway.ts`**（16 行，verbatim）仍写：`* Stub interface only — not implemented in v1.`。ZX-LLM-adapter §F2 §判定方法 1 与 §8.4 “需要避开的反例位置” 都明确要求 “Z3 要把真实 provider 接进主路径，而不是继续停在 placeholder”——本轮选择了“跳过”而不是“退役”。
- **`workers/agent-core/src/llm/adapters/deepseek/` 不存在**。`ls workers/agent-core/src/llm/adapters/` → 只有 `openai-chat.ts`、`types.ts`、`workers-ai.ts`。ZX-LLM-adapter §F4 §判定方法 1 frozen：“`workers/agent-core/src/llm/adapters/deepseek/` 或等价 skeleton 目录存在”——本轮未交付。
- **`provider_key` 列缺失**：design §F1 §判定方法 3 frozen “`nano_usage_events.provider_key='workers-ai'` 的写入可被 trace/session 关联回看”。`migrations/004-usage-and-quota.sql:11-24` 的 `nano_usage_events` 表 schema 没有 `provider_key` / `provider` / `model` 任何相关列；`quota/repository.ts:192-216 recordUsage` 也不写。durable truth 永远不知道这条 usage 来自 Workers AI 还是其它 provider。
- **写权违反**：`workers/agent-core/src/host/quota/repository.ts:71-94 ensureTeamSeed()` 由 `agent-core` 主体执行 `INSERT OR IGNORE INTO nano_users (...)` 与 `INSERT OR IGNORE INTO nano_teams (...)`。ZX-D1 §7.3.5 frozen write-ownership matrix：identity core / nano_teams / nano_users 只能由 `orchestrator.auth` 主写；agent.core 仅允许主写 `nano_usage_events / nano_quota_balances`。
- **synthetic owner UUID 设计可疑**：同一 `repository.ts:73` 直接令 `const ownerUserUuid = teamUuid` —— 即合成 user 的 PK 与 team 的 PK 完全相等。这种 collision space 在“真用户 UUID 与 team UUID 撞车”概率微乎其微，但仍违背 “user_uuid 与 team_uuid 是两个独立 namespace” 的语义法则；后续真实 identity bootstrap 将不得不绕过/迁移这些 synthetic 行。
- **lineage drop 在 quota.appendActivity**：同一文件 `:282-296` 把 `actor_user_uuid` 与 `conversation_uuid` 双双写为字面 `NULL`，即使运行时其实知道 `auth_snapshot.sub` 与 `conversation_uuid`（`orchestrator-core` 在 `forwardStart` 已经把 authority 注入到 body）。Q5 §最终回答 与 ZX-D1 §7.3.6 都明确这两列是 nullable lineage carrier，不应在已知时硬填 NULL。
- **`forwardStart` parity 仅在“authority 完整 + AGENT_CORE.start 存在” 时执行**（`user-do.ts:716-718`）；在缺 authority 或 AGENT_CORE 没绑 RPC 时直接返回 fetch 结果。这意味着 deploy 失误时 parity 会自动降级而不报警——作为 zero-to-real 的“双实现等价”证明，这条 fallback 本身需要更显式的 disclosure（见 R12）。
- **`AI` binding fallback 行为偏离设计**：`workers-ai.ts:297-313` 的 `for (const model of [PRIMARY, FALLBACK])` 在 PRIMARY 抛**任意** error 时都立刻切到 FALLBACK；action-plan §P1-01 frozen “只有两者都过不了 fc smoke 才升级 DeepSeek required”——意指 boot/smoke 期决策，而不是 per-request silent fallback。
- **system prompt / tool schema 不动态**：`workers-ai.ts:11-54 WORKERS_AI_TOOLSET` 把 6 个工具的 schema 直接写死在 worker 里；`runtime-mainline.ts:107-115` 的 LLM 调用没有 system prompt，messages 完全等于 `snapshot.activeTurn?.messages ?? []`。在 first-wave 范围内可接受，但与 bash-core 真实 capability 注册表完全脱钩，未来漂移概率高。
- **`closure §3` 与 `action-plan §10` 的 36/36 + 12/12 数字与 Z2 closure verbatim 一致**：本轮 Z3 没有新增任何 e2e 用例触达 Workers AI / quota；通过的旧用例并不能证明 Z3 主线工作。

---

## 2. 审查发现

### R1. ZX-LLM-adapter §F2 frozen requirement “gateway 退出 stub” 未达成

- **严重级别**：`high`
- **类型**：`scope-drift`
- **事实依据**：
  - `workers/agent-core/src/llm/gateway.ts:1-16` 仍为：
    ```ts
    /**
     * Inference Gateway Interface
     *
     * Future seam for plugging in alternative execution backends
     * ...
     * Stub interface only — not implemented in v1.
     */
    export interface InferenceGateway {
      execute(exec: ExecutionRequest): Promise<CanonicalLLMResult>;
      executeStream(exec: ExecutionRequest): AsyncGenerator<NormalizedLLMEvent>;
    }
    ```
  - `docs/design/zero-to-real/ZX-llm-adapter-and-secrets.md` §F2 §判定方法 1 frozen：“`workers/agent-core/src/llm/gateway.ts` 不再只是 stub/seam comment”。
  - `docs/design/zero-to-real/ZX-llm-adapter-and-secrets.md` §8.4 反例：“`workers/agent-core/src/llm/gateway.ts` 当前仅是未来 seam/stub —— Z3 要把真实 provider 接进主路径，而不是继续停在 placeholder”。
  - `Z3-real-runtime-and-quota.md`（design）§5.2 P2-01 §expected：“`gateway.ts` 不再停在 stub”。
  - 仓库实际 wiring 用 `runtime-mainline.ts -> invokeWorkersAi` 直接绕过 gateway。closure §2 / §5 / §7 一字未提 gateway。
- **为什么重要**：
  - design 与 Q8 Opus answer 明确 gateway 是 Workers AI / DeepSeek / 未来 provider 的 canonical seam，本意是“同一接口可替换 provider”。本轮选择直接 import adapter 函数而非通过 gateway，等于把 design §F2 §3.3 “provider 切换不要求改 public session contract” 的杠杆点埋掉了——未来真要接 DeepSeek / 第二 provider 时，`runtime-mainline.ts` 就得重写而不是只换 gateway impl。
  - closure 沉默 = 不诚实记录 residual。Z2 closure §5 至少把 deploy-fill 等 residual 写出来；Z3 closure §5 没有承认 gateway / DeepSeek 这两条 design 漂移。
- **审查判断**：
  - 这不是“代码错”，但属于 ZX-LLM-adapter design law 被静默绕过。要么补一条 closure residual（“gateway 与 registry 在 Z3 暂不退役，runtime-mainline 直接 import adapter；后续 provider 扩展再回收”），要么把 `runtime-mainline.ts` 的 LLM call 改为通过 gateway。
- **建议修法**：
  - **保守做法（最小变更）**：保留 `runtime-mainline.ts`，但把 `invokeWorkersAi` 包成 `WorkersAiGateway implements InferenceGateway`，runtime 通过 gateway 调用；同时在 `Z3-closure.md §5` 显式承认这一选型与 design 偏差。
  - **激进做法**：把 `runtime-mainline.ts` 中的 LLM seam 替换为 `InferenceGateway.executeStream`，让 gateway 真正成为 canonical 主路径。

### R2. ZX-LLM-adapter §F4 frozen requirement “DeepSeek skeleton 落点”未交付

- **严重级别**：`high`
- **类型**：`scope-drift`
- **事实依据**：
  - `find workers/agent-core/src/llm -name "*deepseek*" -o -name "*DeepSeek*"` → 空。
  - `ls workers/agent-core/src/llm/adapters/` → 只有 `openai-chat.ts`、`types.ts`、`workers-ai.ts`。
  - `ZX-llm-adapter-and-secrets.md` §F4 §判定方法 1 frozen：“`workers/agent-core/src/llm/adapters/deepseek/` 或等价 skeleton 目录存在”。
  - Q8 Opus 最终回答 §2：“**DeepSeek skeleton 落点**：建 `workers/agent-core/src/llm/adapters/deepseek/` 目录，仅含 adapter shape interface 与一个 throw-not-implemented 函数。不写真实调用代码。这样 future BYO key 接入时不需要重构 boundary。” 业主已 “同意”。
- **为什么重要**：
  - design §F4 §3.3 与 Q8 都把 skeleton 当成“给未来留落点，避免重构 adapter boundary”的低成本前置债——cost 极低（一个目录 + 一个 throw 函数）。Z3 阶段不交付这个低成本结构，等 BYO key 真正进入时仓库 layout 必须重新 negotiate。
  - closure 不承认这条 residual = design law 静默漂移。
- **审查判断**：
  - 这是一条 design level commitment，本轮 Z3 没有交付，也没有在 closure §5 显式记录为 residual。判定 `scope-drift`。
- **建议修法**：
  - 新增 `workers/agent-core/src/llm/adapters/deepseek/index.ts`，shape 与 `workers-ai.ts` 的 `invokeWorkersAi` 对齐；仅含 `throw new Error("DeepSeek adapter not implemented in zero-to-real first wave")` 占位。
  - 同时在 `Z3-closure.md §5` 增列“DeepSeek skeleton 已落骨架但不进入 default runtime path（参见 Q8 Opus answer）”。

### R3. `nano_usage_events.provider_key` 列缺失，durable truth 失去 provider lineage

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - `migrations/004-usage-and-quota.sql:11-24` `nano_usage_events` 列：`usage_event_uuid / team_uuid / session_uuid / trace_uuid / resource_kind / verdict / quantity / unit / idempotency_key / created_at`——无 `provider_key`、无 `model`。
  - `docs/design/zero-to-real/ZX-llm-adapter-and-secrets.md` §F1 §判定方法 3 frozen：“`nano_usage_events.provider_key='workers-ai'` 的写入可被 trace/session 关联回看”。
  - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md` §7.3.1 nano_usage_events 字段冻结清单本身确实没有 provider_key（与 ZX-LLM-adapter F1 §判定方法 3 之间存在 design 内部不一致），但只要任何一条 design freeze 写了它，落地就该有。
- **为什么重要**：
  - 没有 `provider_key`，audit/eval 永远无法回答“这条 LLM usage 是谁的 token 钱”——尤其在未来 Workers AI / DeepSeek / BYO 共存阶段，回看不出这条 token 的成本归属或失败归因。
  - 改 schema 在 D1 是 “add column”，不是 destructive migration；现在补成本最低，越往后越贵。
- **审查判断**：
  - design 内部已有不一致，但 ZX-LLM-adapter §F1 §判定方法 3 是 Q8 owner 已 ack 的 design。Z3 未交付——`delivery-gap`。
- **建议修法**：
  - 新增 `005-usage-quota-provider-key.sql`：`ALTER TABLE nano_usage_events ADD COLUMN provider_key TEXT;` 加上 `CREATE INDEX ... ON nano_usage_events(team_uuid, provider_key, created_at DESC);`
  - `quota/authorizer.ts::commit/authorize` 把 provider_key（runtime 获悉的 model registry key）注入 `recordUsage` payload；先期 hard-code `'workers-ai'` 即可。
  - 同步把 ZX-D1 §7.3.1 与 ZX-LLM-adapter §F1 §判定方法 3 字段集对齐。

### R4. Phase 5 “至少一轮真实 prompt->tool->response 成功，负例 reject 正常” 在仓库中无任何测试证据

- **严重级别**：`critical`
- **类型**：`test-gap`
- **事实依据**：
  - 全仓 `grep -rln "QuotaExceeded\|QuotaAuthorizer\|D1QuotaRepository\|runtime-mainline\|createMainlineKernelRunner\|invokeWorkersAi\|WORKERS_AI_PRIMARY_MODEL\|nano_quota_balances\|nano_usage_events"` → `0` 个 test 文件命中（仅源码文件命中）。
  - `test/package-e2e/agent-core/01-preview-probe.test.mjs:1-15` 只断言 `live_loop: true`，不调用 LLM。
  - `test/cross-e2e/02 / 09 / 11` 全部走 `verify -> capability-call -> bash-core`，与 Z3 之前的 capability roundtrip 一致；不触发 LLM 主路径，不消费 quota。
  - `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs:5-8` 注释明确写 “A future credit/quota charter may need to extend this test with funded / authorized fixture state.”——这条 charter 就是 Z3，但 Z3 没有 extend 它。
  - closure §3.3 引用的 `36/36 + 12/12` 是与 Z2 closure §3.3 verbatim 一致的数字（甚至文字格式都相同）。
  - `Z3-real-runtime-and-quota.md`（action-plan）§4.5 P5-01 §收口标准：“至少一轮真实 prompt->tool->response 成功，负例 reject 正常”。
  - design §F2 §收口标准：“deny 会同时产生 typed user-visible error 与 `nano_session_activity_logs.event_kind='quota.deny'` 记录”——没有 test 验证这条 invariant。
- **为什么重要**：
  - 这是 Z3 的核心收口承诺。closure §1 “zero-to-real 现在不再只是‘有 durable session baseline，但 runtime 仍可能是假执行’的过渡状态；它已经拥有一条真实可运行、可计量、可审计、可通过 preview live E2E 证明的 runtime 主链” —— 这句话**没有任何 test 支撑**。
  - 36/36 + 12/12 的数字在没有 Z3 用例的情况下与 Z2 一致是合理的（旧用例没改），但作为 Z3 通过证据是误导。
  - 最关键：万一 Workers AI binding 在 preview 上其实根本没触发（比如 `runtimeEnv.AI` 实际为 undefined），`createLiveKernelRunner()` 会返回 null，`advanceStep` 走 `{ snapshot, events: [], done: true }` 立即结束 turn。整个 “real loop” 可以悄无声息地降级为 honest stub，而仓库里没有任何检测器能发现。
- **审查判断**：
  - 这是 `critical` 级 test-gap。Phase 5 §收口标准没有达成；closure §3.3 的“live evidence 已经覆盖” + `agent-core` preview probe 与 legacy retirement envelope” 不能等同于 “Workers AI 真实执行通过”。
- **建议修法**：
  - 至少补 4 条 test：
    1. **`workers/agent-core/test/host/quota/authorizer.test.ts`**：mock D1，断言 authorize → balance=0 时 throw `QuotaExceededError`，并写 1 条 deny usage_event + 1 条 quota.deny activity。
    2. **`workers/agent-core/test/host/quota/repository.test.ts`**：mock D1，断言 idempotency_key 二次插入不重复扣减；balance ≥ quantity 与 < quantity 两路 update。
    3. **`test/package-e2e/agent-core/02-real-llm-smoke.test.mjs`**（new live e2e）：在 preview 上发一条 user message，预期 stream 出 `llm.delta` 与 `turn.end`；同时断言 `nano_usage_events` 多了一行 `resource_kind='llm', verdict='allow'`。
    4. **`test/cross-e2e/12-quota-exhausted-blocks-llm.test.mjs`**（new）：先 `setBalance(team, 'llm', 0)`，再发 start，断言客户端流上看到 `system.notify` with `code='QUOTA_EXCEEDED'`，timeline 有 `quota.deny` activity。
  - 测试落地前，closure §1 “preview live evidence” 这句话不能成立。

### R5. `D1QuotaRepository.ensureTeamSeed()` 违反 ZX-D1 §7.3.5 frozen 写权 matrix

- **严重级别**：`high`
- **类型**：`scope-drift`（兼 `correctness` 隐患）
- **事实依据**：
  - `workers/agent-core/src/host/quota/repository.ts:71-94`：
    ```ts
    private async ensureTeamSeed(teamUuid: string): Promise<void> {
      const now = new Date().toISOString();
      const ownerUserUuid = teamUuid;
      await this.db.batch([
        this.db.prepare(
          `INSERT OR IGNORE INTO nano_users (...)`
        ).bind(ownerUserUuid, teamUuid, now),
        this.db.prepare(
          `INSERT OR IGNORE INTO nano_teams (...)`
        ).bind(teamUuid, ownerUserUuid, now),
      ]);
    }
    ```
  - `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md` §7.3.5 frozen write-ownership matrix（业主已 ack）：
    | worker | 允许主写的表组 |
    |---|---|
    | `orchestrator.auth` | identity core, auth sessions, team api keys |
    | `agent.core` | usage events, quota balances |
  - closure §5.3 自己承认：“quota repo 现在会为缺失 deploy team row 的单租户 preview posture 自动 seed synthetic owner user + team；这解决了 FK truth, 但更完整的 tenant bootstrap owner 仍应在后续 identity/runtime 统一时收回到更上层 owner”。
  - 同上 `:73`：`const ownerUserUuid = teamUuid;` —— 直接令 user PK 等于 team PK。
- **为什么重要**：
  - **写权违反**：identity core 的“single-writer” law 是 nano-agent 多 worker 安全模型的基础。一旦允许 agent.core 直写 nano_users / nano_teams，其它 worker 也会模仿（“反正 agent-core 都能写”），write-ownership matrix 就崩了。
  - **数据完整性隐患**：当 preview/真实 auth bootstrap 真正触发时，`orchestrator.auth` 会创建 `team_uuid_real`；如果 agent-core 已经为同一 deploy `TEAM_UUID = aaaa…aaaa` seed 了 synthetic team + user，未来真正 user 注册撞到 `aaaa…aaaa`（preview 单租户固定值）时会被 `INSERT OR IGNORE` 静默吞掉，造成 “user_uuid 已存在但 default_team / profile / identity 不匹配” 的脏数据。
  - **`ownerUserUuid = teamUuid` 命名空间冲撞**：UUID v4 collision 概率极低，但语义层把两个 namespace（user vs team）合并是一种 anti-pattern；任何后续 `JOIN nano_users ON nano_teams.owner_user_uuid = nano_users.user_uuid` 在这一行 synthetic data 上会偶然成功，但 trail 完全是 fictional。
- **审查判断**：
  - closure §5.3 把这个 deferred 当“residual”是诚实的，但同时 closure §1 又宣称 “Z3 已达到 action-plan 约定的关闭条件”。这两句话不能同时成立——因为 ZX-D1 §7.3.5 写权 matrix 是 zero-to-real D1 baseline 的硬约束，不是某个阶段的 nice-to-have。
- **建议修法**：
  - **第一选择**：把 `ensureTeamSeed` 整段移除；preview 部署时由 `orchestrator-auth` 在 D1 migration 之后跑一条 deploy-tenant seed script（类似 W2 的 `seed-deploy-team.sql`），写一行真实 `(team_uuid=aaaa…, owner_user_uuid='preview-bootstrap-...')` 到 nano_teams + nano_users，FK 一次性建立。
  - **次选**：在 agent-core 写之前，反过来 fail fast——`ensureBalance` 第一次 SELECT FK 失败时抛 `team-not-bootstrapped` 错而不是默默 seed。然后 `orchestrator-auth` / 部署脚本去 seed。
  - 不论哪条，`const ownerUserUuid = teamUuid;` 必须改为 `const ownerUserUuid = "deploy-bootstrap:" + teamUuid;` 或 `crypto.randomUUID()`，让两个 PK namespace 物理上不可能撞。

### R6. `appendActivity` 永久把 `actor_user_uuid / conversation_uuid` 写为 NULL，丢失 Q5 / ZX-D1 §7.3.6 lineage

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - `workers/agent-core/src/host/quota/repository.ts:280-310`：
    ```sql
    INSERT INTO nano_session_activity_logs (
      activity_uuid, team_uuid, actor_user_uuid, conversation_uuid,
      session_uuid, turn_uuid, trace_uuid, event_seq, event_kind,
      severity, payload, created_at
    )
    SELECT
      ?1, ?2, NULL, NULL, ?3, ?4, ?5, ...
    ```
    actor_user_uuid 与 conversation_uuid 双双写为字面 `NULL`。
  - `docs/design/zero-to-real/ZX-qna.md` Q5 Opus 最终回答与 §ZX-D1 §7.3.6 frozen activity discipline:
    > `actor_user_uuid` = nullable（**系统事件可空**）
    > `conversation_uuid / session_uuid / turn_uuid` = nullable lineage carriers
  - 实际运行时这条 activity log 来自一个真实用户的真实 turn——`auth_snapshot.sub` 与 conversation_uuid 都已知（orchestrator-core 已经在 `forwardStart` 把 authority 带入 body，`createDurableTurn` 已经把 `conversation_uuid` 写入 D1）。
- **为什么重要**：
  - 把 nullable lineage 在“知道时”仍写 NULL，与 Q5 Opus 答案的“actor_user_uuid 是审计场景必备（不能只靠 team 维度）”意图冲突。
  - 这条 quota.deny / quota.allow event 是后续 Z4 客户端 retry/hint 能够依赖的“为什么这次失败”证据；丢掉 actor_user_uuid 后续 admin 想做“某用户被 quota 拦了几次” 的 query 完全做不出。
- **审查判断**：
  - 这是 frozen design discipline 没有完全兑现。可以以小补丁修复。
- **建议修法**：
  - `quota/authorizer.ts::QuotaRuntimeContext` 增加 `actorUserUuid?: string | null` 与 `conversationUuid?: string | null`；
  - `nano-session-do.ts::buildQuotaContext()` 从 `auth_snapshot.sub` 与 `traceContext.conversationUuid`（如已 latched）取值；
  - `repository.ts::appendActivity` 把这两列也作为参数写入而不是硬 NULL。

### R7. 工具 quota 在 capability error envelope 上仍 `commit`（扣额），与 LLM gate 行为非对称

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `workers/agent-core/src/host/runtime-mainline.ts:163-191`：
    ```ts
    const parsed = parseCapabilityEnvelope(response);
    if (parsed.status === "ok") {
      ...
      await options.quotaAuthorizer.commit("tool", quotaContext, requestId, { tool_name, status: "ok" });
      yield { type: "result", status: "ok", result: parsed.output };
      return;
    }
    if (options.quotaAuthorizer && quotaContext) {
      await options.quotaAuthorizer.commit("tool", quotaContext, requestId, {
        tool_name,
        status: "error",
        error_code: parsed.error.code,
      });
    }
    ```
    OK + error 两条 path 都 commit（扣额）；只有 QuotaExceeded / 抛出异常的 transport-level error 不扣。
  - LLM 端 `kernel/runner.ts:193-211`：try/catch 包住整段 `delegates.llm.call`，任何异常都进入 `complete_turn(reason: "quota_exceeded")` + `system.notify`，**`afterLlmInvoke` 不会执行**——也就是 LLM 失败不扣 quota。
- **为什么重要**：
  - design 没有显式冻结这条政策（success vs failure 是否计入 quota），但 “LLM 失败不扣” + “tool 失败也扣” 是不一致的实现选择，未来如果有 “unknown-tool / policy-ask / cancelled” 这种 user 没真正消费资源的 path 也扣额，会被业主吐槽。
  - 同时也让 R8 idempotency 雪上加霜——同一 turn 多次 retry 同一 tool 会持续扣额。
- **审查判断**：
  - 不是 blocker，但属于 hidden semantic decision；需要明文化，并在 closure §5 列入 residual。
- **建议修法**：
  - **保守**：把 capability error path 改为不 commit（只 record usage with verdict='deny' / quantity=0），与 LLM gate 对齐；同时单独写一条 `runtime.tool.error` activity。
  - **激进**：要求 design 明文确认 “tool 真实进入 worker 边界即扣 1 次，无论 success / 业务 error”。视业主取舍。

### R8. idempotency_key 由每次重新 mint 的 requestId 派生，丧失真实“重放不重复扣减”能力

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `workers/agent-core/src/host/runtime-mainline.ts:237`：
    ```ts
    const requestId = `llm-${turnId}-${crypto.randomUUID()}`;
    ```
    每次 `beforeLlmInvoke` 调用都生成新的 randomUUID，没有 cache。
  - `quota/authorizer.ts:65-67, 130-132`：`idempotencyKey: '${quotaKind}:deny:${requestId}'` / `'${quotaKind}:allow:${requestId}'`。
  - `migrations/004-usage-and-quota.sql:22`：`UNIQUE (team_uuid, resource_kind, idempotency_key)` —— 在 DB 层强制唯一。
  - design §F5 §判定方法 3 frozen：“retry / replay 不产生重复扣减”。
- **为什么重要**：
  - turn 级 idempotency 是“同一 logical action”的去重锁，用 randomUUID 派生意味着只在“authorize 与 commit 之间”单次幂等（同一 requestId map 内）；任何 turn 重启 / DO 重建 / kernel 重新进入 step 都会换 requestId，DB 唯一约束失去防重作用。
  - 真实 production 重放（用户连点 “重发”、cloudflare retry）会被双扣。
- **审查判断**：
  - design §F5 §判定方法 3 没达成。`correctness` 级 issue；不影响首次 happy path，但破坏 zero-to-real 的“可计量”法则。
- **建议修法**：
  - LLM gate：把 `requestId` 派生为 `llm:${trace_uuid}:${turn_uuid}:${stepIndex}`（trace_uuid + turn_uuid + stepIndex 唯一确定 “某轮某步的 LLM invoke”）。
  - tool gate：派生为 `tool:${trace_uuid}:${turn_uuid}:${tool_call_id}`（kernel 已经提供 tool_call_id 与 turnId）。
  - 同时 commit 路径的 idempotencyKey 应写 `${kind}:${trace_uuid}:${turn_uuid}:${...}`，与 authorize 共用一个真实 business key——而不是把 verdict 编进 key。

### R9. Workers AI 工具列表硬编码且与 bash-core 真实 capability registry 解耦

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - `workers/agent-core/src/llm/adapters/workers-ai.ts:11-54` 直接 hard-code 6 个工具 schema：
    ```ts
    const WORKERS_AI_TOOLSET = [
      { name: "pwd", ... },
      { name: "ls",  ... },
      { name: "cat", ... },
      { name: "rg",  ... },
      { name: "curl",... },
      { name: "git", ... },
    ] as const;
    ```
  - `workers/bash-core/src/worker-runtime.ts:92-110 registerAllHandlers()` 注册 6 大类 handler（filesystem / search / text-processing / network / exec / vcs），命令数量远超 6。
  - `Z3-real-runtime-and-quota.md`（action-plan）§5.1 P1-01 §收口标准：“first-wave model 通过 5+ tool 类型 invoke smoke” —— 6 ≥ 5 数字上达标，但语义上 “tool 类型” 不该等于这 6 个 hard-coded 名字。
- **为什么重要**：
  - LLM 只知道这 6 个工具；任何用户期望的高级工具（grep 子命令、find、awk、curl 高级 flag、git 子命令以外）都不会被 LLM 选中。
  - 任何 bash-core 端的 capability 增减不会自动同步到 LLM toolset，未来 drift 不可避免。
  - LLM 输入的 tool schema 与 bash-core registry 没有任何共享类型，只能用字符串 name 对齐——非常脆弱。
- **审查判断**：
  - 满足数字达标但不满足 design §F1 “mainline runtime 真实 wire” 精神。判 `scope-drift`。
- **建议修法**：
  - 在 `workers/agent-core/src/llm/adapters/workers-ai.ts` 把 `WORKERS_AI_TOOLSET` 改为运行时 lazy 派生：从 bash-core `BASH_CORE` binding RPC 拉一次 capability list，本地短缓存（DO Alarm 同步）。或者：把 capability schema 抽到共享 `packages/nacp-capabilities` 包，agent-core 与 bash-core 都从此 import。
  - 同时增加“unknown-tool 调用 returned by LLM 时如何降级”的 design freeze。

### R10. Workers AI runtime 无 system prompt，messages 直接等于 turn 历史

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `runtime-mainline.ts:107-115`：
    ```ts
    async *call(request: unknown) {
      const messages = Array.isArray(request) ? request : [];
      for await (const chunk of invokeWorkersAi(options.ai, {
        messages,
        tools: true,
      })) { yield chunk; }
    }
    ```
  - `kernel/runner.ts:164-166`：`for await (const chunk of this.delegates.llm.call(snapshot.activeTurn?.messages ?? []))` —— 把 turn.messages 原样传入。
  - `orchestration.ts:236-244` 把 `{ role: "user", content: input.content, ... }` 作为唯一一条 message 起步。
- **为什么重要**：
  - 没有 system prompt，模型不知道自己是 nano-agent、可以使用哪 6 个工具、应当 prefer tool_call、何时 finish。Workers AI granite/llama 的 instruction-following 在没有 system prompt 时退化严重。
  - tool-calling 通常需要 system 段说明 “你是 X，可调用以下 tools，应在需要时输出 tool_call”。否则模型常常直接 answer 用户而不调用工具。
- **审查判断**：
  - 这条不是 design 显式 freeze，但 design §F1 §核心逻辑“messages + stream: true + tool-calling enabled” 默认要求 tool-calling 真起作用。`correctness` 级 issue。
- **建议修法**：
  - 在 `runtime-mainline.ts` 的 LLM seam 注入一条 minimal system prompt，描述 worker 身份 + 可用工具 + 输出语义。可直接派生自 `WORKERS_AI_TOOLSET`。

### R11. Provider/Model registry 与 loader 是死代码，没有一处运行时调用

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **事实依据**：
  - `workers/agent-core/src/llm/registry/{providers.ts, models.ts, loader.ts}` 都有完整 implementation。
  - `grep -rn "ProviderRegistry\|ModelRegistry" workers/agent-core/src/host/ /workspace/repo/nano-agent/workers/agent-core/src/llm/index.ts` → 仅 export & request-builder.ts 引用；`runtime-mainline.ts` / `nano-session-do.ts` / `worker.ts` / `index.ts` 全部不引用。
  - `request-builder.ts` 是历史 LLMExecutor scaffolding，runtime 主路径已经绕过它。
- **为什么重要**：
  - 同 R1 / R2：ZX-LLM-adapter design intent 是“通过 registry 选 provider”，结构在 repo 里却不接 runtime；R1 / R2 / R11 是同一现象的三个症状。
  - 死代码会让后续 reviewer / 新开发者误以为它仍在主路径上，浪费调试时间。
- **审查判断**：
  - 不是 blocker；但应在 closure §5 写入“registry & loader 在 Z3 暂未接入主路径，runtime-mainline 直连 adapter”。
- **建议修法**：
  - 与 R1 一并修：让 `runtime-mainline.ts` 通过 `loadDefaultRegistries()` 拿到 `models / providers`，再调 gateway。
  - 或显式在 `index.ts` 标记 “@deprecated for zero-to-real Z3 wave” 直到 Z4/5 接入。

### R12. `forwardStart / forwardStatus` parity 在 authority 缺失或 binding 缺失时静默降级，没有 disclosure

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:716-718`：
    ```ts
    if (typeof rpcStart !== 'function' || !authority) return fetchResult;
    ```
  - 同上 `:755-756`：`if (typeof rpcStatus !== 'function' || !authority) return this.forwardInternalRaw(...);`
- **为什么重要**：
  - parity gate 是 Z2 §Q7 “首条 dual-implemented control-plane 方法” 的诚实证明；Z2 review 的 W-1 已经指出 RPC kickoff 旁路 `validateInternalAuthority`，本轮 Z3 继续靠 parity 来兜底。
  - 但 parity 自我降级（静默走 fetch）等于失去 disclosure：deploy 出错配（authority/binding 缺失）时表现是“parity 永远 ok”，运维方看不到。
- **审查判断**：
  - 不是 blocker，但 zero-to-real 的“双实现等价证明”要求每次自我降级都应有 trace event 或日志线索。
- **建议修法**：
  - 在两处 fallback 加一条 `traces.emit({ eventKind: "rpc.parity.skipped", reason: !authority ? "missing-authority" : "binding-absent" })`；或至少 `console.warn` 一行可被 Cloudflare logs 抓取。

### R13. Workers AI provider per-error fallback 偏离 action-plan §P1-01 frozen 选型方针

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `workers/agent-core/src/llm/adapters/workers-ai.ts:296-313`：
    ```ts
    let lastError: unknown;
    for (const model of [WORKERS_AI_PRIMARY_MODEL, WORKERS_AI_FALLBACK_MODEL]) {
      try { ... return; } catch (error) { lastError = error; }
    }
    throw lastError ...;
    ```
  - `Z3-real-runtime-and-quota.md`（action-plan）§4.1 P1-01 §工作内容：“默认 model=`@cf/ibm-granite/granite-4.0-h-micro`，Workers AI 内部 fallback=`@cf/meta/llama-4-scout-17b-16e-instruct`，**只有两者都过不了 fc smoke 才升级 DeepSeek required**”。
  - 上文 frozen 的语义是 “provider 选择在 boot 期 / smoke 期决策”；当前实现是 per-request silent fallback。
- **为什么重要**：
  - per-request fallback 会让 PRIMARY 间歇失败被 silently 切到 FALLBACK，运维不易察觉。
  - 只要 PRIMARY 一次抛错，整个请求的 model identity 漂移到 FALLBACK，但 audit 没有记录是哪个 model 真的产出了内容。
- **审查判断**：
  - 与 R3（缺 provider_key）叠加，runtime audit 看不出真用了哪个 model。
- **建议修法**：
  - PRIMARY/FALLBACK 选型挪到 boot：worker startup 时跑一次轻量 fc smoke probe，结果存 `globalThis._workersAiActiveModel`。
  - per-request 只用一个 model；fallback 在 5xx/timeout 上走，并在 trace event + activity log 显式落 `event_kind='runtime.llm.model_fallback'` + `payload.from / payload.to`。

### R14. `closure §3` 的 “36/36 + 12/12 pass” 与 Z2 closure 字面相同，被作为 Z3 主证据

- **严重级别**：`high`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/issue/zero-to-real/Z3-closure.md` §3.3：
    > 1. `NANO_AGENT_LIVE_E2E=1 ... pnpm test:package-e2e` → `36 / 36 pass`
    > 2. `NANO_AGENT_LIVE_E2E=1 ... pnpm test:cross-e2e` → `12 / 12 pass`
  - `docs/issue/zero-to-real/Z2-closure.md` §3.3 写的是同一行：`36 / 36 pass` / `12 / 12 pass`。
  - 同一份 Z3 closure §3.3 “live evidence 已经覆盖” 列表（orchestrator-core public start / verify / ws / reconnect / cancel / timeline / auth negatives / agent-core preview probe / bash-core happy path / cancel / unknown-tool / policy-ask / capability verify / mid-session cross-worker call / final façade roundtrip）—— 这 14 条**没有一条**触发 Workers AI / quota / 真实 LLM。
- **为什么重要**：
  - 这是 closure 文档诚实性的关键问题。Z3 工作日志说 “bash-core happy / cancel / unknown-tool / policy-ask” 等等，这些项目在 Z2 closure 阶段就已通过；Z3 没有新增任何 e2e 用例触达 Z3 真正的新 invariant。
  - 这与 R4 (test-gap) 互为表里，但 R4 是“代码缺测试”，R14 是“closure 引用错误证据”。
- **审查判断**：
  - 必须在 closure §3 / §5 显式承认：本轮 36/36 + 12/12 数字与 Z2 一致，并明确没有新增 LLM/quota e2e fixture。
- **建议修法**：
  - 在 closure §3 加一段 “本次 36/36 + 12/12 与 Z2 数字一致；本轮 Z3 未新增 Workers AI / quota e2e 测试，相关 invariant 当前仅由 deploy posture 与人工 preview 验证。”
  - 同时提交 R4 §建议修法 中的 4 条 test 之后，再把 Z3 closure 升级。

### R15. preview shared D1 与 deploy-time `TEAM_UUID` 仍走 single-tenant 占位路径，与 Z2 review R6 / K7 deploy-fill 退役未处理形成同一隐患

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - `wrangler.jsonc:14` & `:60`：`TEAM_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"` 作为 var 注入（不是 env-only）。
  - `host/internal-policy.ts:134-137 validateInternalRpcMeta`：从 `env.TEAM_UUID` 读 fallback。
  - `do/nano-session-do.ts:584-587 currentTeamUuid()`：`return env.TEAM_UUID` 兜底。
  - Z3 closure §5.1：“`orchestrator-auth` 真正 bootstrap 的 team UUID 仍然是随机值，而 preview deploy posture 仍是单租户固定 `TEAM_UUID`；当前 live harness 通过 JWT fallback 保持测试可运行……”
  - Z2 closure §5.4 + Z2 review R6 / K7 已经把 deploy-fill 退役列为 “follow-up work”，Z3 没有处理。
- **为什么重要**：
  - 这条是 zero-to-real 跨阶段最大隐患：单租户 preview 看似工作，是因为所有 worker 都从 env 读同一个 fixed UUID；一旦真实多租户上线，所有依赖 env.TEAM_UUID 的 fallback path 都会指向错误的 team。
  - Z3 quota repo 又在 ensureTeamSeed 上 hard-tied 到 env.TEAM_UUID（间接通过 currentTeamUuid → buildQuotaContext.teamUuid → ensureTeamSeed(teamUuid)），让这条隐患从“auth 边界”扩散到“quota durable truth”。
- **审查判断**：
  - 不是 Z3 单独引入的问题，但 Z3 没有 retire 这条 deploy-fill 路径，反而把它绑定到了 quota durable truth。`scope-drift` 级。
- **建议修法**：
  - Z3 closure §5 应明确加上 deadline：“deploy-fill / `env.TEAM_UUID` 兜底必须在 Z4 中段之前完全退役，否则多客户端 first real run 不可成立”。
  - 实施层：`buildQuotaContext` / `currentTeamUuid` 应改为 “authority 必须显式提供 team_uuid，env 兜底被 throw”，并允许 preview 测试通过 explicit JWT 注入实现。

### R16. ZX-D1 §7.3.1 与 ZX-LLM-adapter §F1 §判定方法 3 字段集自相矛盾（design 内部）

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `ZX-d1-schema-and-migrations.md` §7.3.1 nano_usage_events 字段 freeze：`usage_event_uuid, team_uuid, session_uuid, trace_uuid, resource_kind, verdict, quantity, unit, idempotency_key, created_at` —— 不含 `provider_key`。
  - `ZX-llm-adapter-and-secrets.md` §F1 §判定方法 3：“`nano_usage_events.provider_key='workers-ai'` 的写入可被 trace/session 关联回看” —— 含 `provider_key`。
- **为什么重要**：
  - 内部不一致 → 实现者只能挑一条照做。R3 是其结果。
- **审查判断**：
  - design 自相矛盾本身不是 Z3 实现的错，但 Z3 阶段就该指出并 owner 拍板。
- **建议修法**：
  - 修 ZX-D1 §7.3.1，在 nano_usage_events 加 `provider_key TEXT NOT NULL`。两份 design 对齐之后，R3 的 ALTER TABLE 才有 design back-stop。

### R17. Workers AI tool schema 仅在 `runtime-mainline -> invokeWorkersAi(tools: true)` 时下发，Workers AI 端 `payload.tools` 没有 caching；每次 LLM call 都重建 tool list

- **严重级别**：`low`
- **类型**：`correctness`（性能维度）
- **事实依据**：
  - `workers-ai.ts:120-132 buildWorkersAiTools()`、`:286-294 invokeWorkersAi()`。
  - 6 工具 schema 每次都重新 `.map(...)` 重建对象。
- **为什么重要**：
  - 单次 cost 微小，但是 Workers AI rate-limit 对 input token 敏感，每次 prompt 重传 6 个工具 schema 没必要；可以先 prebuild 一次。
- **审查判断**：
  - 性能维度 nice-to-have；不影响收口。
- **建议修法**：
  - 把 `buildWorkersAiTools()` 结果模块级 cache。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | Workers AI = mainline + binding 冻结 | `partial` | binding 与 model id 冻结到 wrangler+adapter 真实成立；但 `gateway.ts` 仍 stub、`adapters/deepseek/` 缺失（R1 / R2）；real-loop 在 test 与 live e2e 中未验证（R4 / R14） |
| S2 | real LLM execution path | `partial` | runtime-mainline + kernel hook 接通；但缺 system prompt / tool list 静态化 / fallback 行为偏离设计（R10 / R9 / R13）；零测试覆盖（R4） |
| S3 | llm + tool dual quota gate | `partial` | LLM gate (beforeLlmInvoke) 与 tool gate (beforeCapabilityExecute + ticket) 都已落点，结构对齐 design §F2；但 idempotency 失真（R8）、tool error 仍扣额（R7）、deny activity 缺 lineage（R6） |
| S4 | usage/balance/quota tables 与 writeback truth | `partial` | nano_quota_balances / nano_usage_events 表已落，FK + UNIQUE + 索引齐全；但 provider_key 列缺失（R3）、ensureTeamSeed 违规（R5）、deploy-fill 隐患未退役（R15） |
| S5 | accepted/rejected runtime evidence 写入 activity/audit/eval | `partial` | quota.deny / runtime.llm.invoke / runtime.tool.invoke 三种 event_kind 都在 authorizer 中输出；但 actor_user_uuid / conversation_uuid lineage NULL（R6），且没有任何测试断言 “timeline/history 真能看见这些 event”（R4） |

### 3.1 对齐结论

- **done**: `0`
- **partial**: `5`
- **missing**: `0`

> 这更像“五条主线骨架在代码层都搭起来了，但每一条都缺 1-3 项 design freeze 的兑现 + 测试侧零证据”，而不是 closed。最贴切的描述是：**Z3 把所有 `in-scope` 项都 “摸到”了，没有任何一项被完整 “收口”**。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 多 provider GA 与复杂路由 | `遵守` | 仅 Workers AI 在 runtime-mainline 中作为唯一 provider；fallback 在同一 binding 内部走 PRIMARY → FALLBACK 两条 model id |
| O2 | 细粒度 billing / statement / finance admin UI | `遵守` | nano_quota_balances 仅 (team_uuid, quota_kind, remaining, limit_value, updated_at)；无 statement / invoice / cycle_key |
| O3 | 完整 browser-rendering productization | `遵守` | 本轮无 client / browser-rendering 工作 |
| O4 | 大规模 client hardening 与产品包装 | `遵守` | 同上 |

---

## 5. 跨阶段（Z0–Z3）联合审查

> 本节不重复 R1–R17，只关注“跨阶段不变量”是否被 Z3 维持、回退或加深。

### 5.1 zero-to-real 不变量矩阵

| 不变量 | Z0 / Z1 状态 | Z2 状态 | Z3 影响 | 当前位置 |
|---|---|---|---|---|
| **single-writer per table（ZX-D1 §7.3.5）** | 建立 | Z2 review R5 / 跨阶段 R5 提示 orchestrator-core append 是 single-writer 例外 | **被 Z3 quota repo `ensureTeamSeed` 写入 nano_users / nano_teams 主动违反**（R5） | 退化 |
| **deploy-fill 兜底（env.TEAM_UUID）** | Z1 引入；Z2 review R6 / K7 列入 follow-up | Z2 closure §5.4 deferred | **Z3 把 quota durable truth 间接绑到 deploy-fill** —— ensureTeamSeed 用 env.TEAM_UUID seed 真实 D1 行（R15） | 加深 |
| **session truth as durable owner（Q5/Q6）** | n/a | Z2 完整建立 D1 truth 与 4 类 hot-state | Z3 没有破坏（runtime-mainline 不写 conversation/session/turn） | 维持 |
| **append-only activity discipline（Q5 / ZX-D1 §7.3.6）** | Z2 三类索引 / 8KB cap / unique(trace_uuid, event_seq) | Z2 √ | **Z3 quota.deny / quota.allow 写入丢 actor_user_uuid + conversation_uuid lineage**（R6） | 退化 |
| **dual-implemented control-plane parity（Q7）** | n/a | Z2 forwardStart / forwardStatus parity ✅；Z2 review W-1 指出 RPC bypass `validateInternalAuthority` | Z3 没有处理 W-1（agent-core/index.ts:222-228 仍直接 stub.fetch 不带 `x-nano-internal-binding-secret`）；同时 forwardStart 静默降级 disclosure 不足（R12） | 维持但未改进 |
| **provider boundary（ZX-LLM §F2）** | n/a | n/a | **gateway.ts 未退役 + DeepSeek skeleton 未落地**（R1 / R2 / R11） | 退化（design law 静默失守） |
| **idempotency-driven quota truth（design §F5 §判定方法 3）** | n/a | n/a | **per-request randomUUID 派生使 idempotency 失真**（R8） | 部分 |
| **测试驱动收口（每阶段 closure §3）** | Z0 / Z1 都有 e2e + 单测 | Z2 18 unit tests（user-do.test.ts）+ live e2e 36/36+12/12 ✅ | **Z3 没有补任何 quota / runtime-mainline / Workers AI 单测；live e2e 数字 verbatim 复用 Z2** | 倒退 |

### 5.2 三个跨阶段连锁问题

1. **Z2 W-1（RPC kickoff bypass `validateInternalAuthority`）+ Z3 LLM 主路径**：
   - Z2 review 已经标记 RPC `start / status` 不携带 `x-nano-internal-binding-secret` / `x-nano-internal-authority`。Z3 把 LLM 主执行 + quota deduction 都挂在 `start` kickoff 上——**这意味着原 W-1 的“defense-in-depth 旁路”从“session 元信息泄漏”升级为“真实 LLM 调用 + 真实余额扣减”可被旁路触发**。
   - 在 service-binding 模型下 caller 只能是 orchestrator-core，attack surface 仍由 Cloudflare 平台拦在外面，但 zero-trust 模型的“多缝防御”已被打通。
   - 必须在 Z3 closure 写入或在 Z4 preflight 中修复。

2. **deploy-fill + ensureTeamSeed 的 cascading 数据污染**：
   - Z2 review R6 / K7 / 跨阶段 §5 deploy-fill 已识别。
   - Z3 ensureTeamSeed 现在让 quota 的 FK truth 也依赖 deploy-fill。当真实 auth 在 Z4 上线、`orchestrator-auth` 用真实 team_uuid 创建 nano_teams 行时，preview deploy 上残留的 “(team_uuid=aaaa…aaaa, owner_user_uuid=aaaa…aaaa)” synthetic 行会与真实 row 冲突或共存——后者是更糟的状态：从 D1 看不出哪一行是 real / synthetic。
   - 必须在 Z3 closure §5 加 “synthetic seed cleanup script” 作为 Z4 preflight。

3. **provider boundary 与 ZX-LLM-adapter design 内部矛盾**：
   - ZX-LLM-adapter §F2 / §F4 / §judgement points 与 `runtime-mainline.ts` 实现选型脱钩；ZX-D1 §7.3.1 与 ZX-LLM-adapter §F1 §判定方法 3 自相矛盾（R16）。
   - 这两条 design law 都要在 Z3 实施期 owner 拍板，否则 Z4 client 端会暴露给同样不一致的 audit trail。

### 5.3 命名规范 / 执行逻辑错误

- **`ownerUserUuid = teamUuid`**（R5）：把 user_uuid PK 与 team_uuid PK 物理地等值，违背命名 namespace 法则。
- **`event_kind` 字符串非冻结**：`runtime.llm.invoke` / `runtime.tool.invoke` / `quota.deny` 三个字符串散落在 `quota/authorizer.ts:142-144 / 75 / 156-158`，没有进入 `packages/nacp-session` 的 frozen string 枚举；ZX-D1 §7.3.6 frozen `event_kind = typed event family（如 'auth.login' / 'quota.deny' / 'runtime.llm.invoke'）` 实际只是文档列举，没有 enum 校验。
- **migration 文件命名一致**：`001 / 002 / 003 / 004` 命名顺序合理；004 直接 CREATE TABLE IF NOT EXISTS，没有 RENAME / RENAME 兼容路径——这个 OK，因为是新表。但 `nano_usage_events.session_uuid REFERENCES nano_conversation_sessions(session_uuid) ON DELETE SET NULL` 这一行——当 conversation session 被 cascade 删除时，usage event 的 session_uuid 被 set NULL，但 trace_uuid 仍保留。这是设计可接受的 lineage 弱化。
- **`request_id` vs `requestId`**：`runtime-mainline.ts:80 / 88` 把 quota ticket 字段命名为 `request_id`（snake_case），而 `worker-runtime.ts:131-141` 校验 `quota.request_id` 与 `requestId` 一致——两个 worker 跨命名风格，是有意为之（wire snake_case，本地 camelCase），命名层 OK。

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested — Z3 主体骨架成立，但因 in-scope §S1/§S2/§S3/§S4/§S5 全部 partial、design law（gateway 退役、DeepSeek skeleton、provider_key、写权 matrix）静默漂移、且 Phase 5 §收口标准“至少一轮真实 prompt->tool->response 成功，负例 reject 正常”在仓库中无任何测试或 live evidence 支撑，本轮 review 不予收口。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. **R4** — 至少新增 4 条 test：`quota/authorizer.test.ts` + `quota/repository.test.ts` + `test/package-e2e/agent-core/02-real-llm-smoke.test.mjs` + `test/cross-e2e/12-quota-exhausted-blocks-llm.test.mjs`，并在 closure §3.3 把 “36/36 + 12/12 是 Z2 旧套件 verbatim 复用” 这条事实显式承认。
  2. **R3 + R16** — owner 决定 `provider_key` 是否进 nano_usage_events；如进，新增 `005-usage-quota-provider-key.sql`，并对齐 ZX-D1 §7.3.1 与 ZX-LLM-adapter §F1 字段；如不进，删除 ZX-LLM-adapter §F1 §判定方法 3 中的 “provider_key='workers-ai'” 提法。
  3. **R5** — `ensureTeamSeed` 必须替换为 “由 `orchestrator-auth` 在部署期 seed”，或至少：(a) `ownerUserUuid` 不能等于 `teamUuid`；(b) closure §5 显式列入 “Z4 preflight：删除 synthetic seed”。
  4. **R6** — quota.appendActivity 把 actor_user_uuid + conversation_uuid 真实带入（而不是硬 NULL）。
  5. **R1 / R2** — 二选一：要么 deepseek skeleton 目录 + gateway 真接入主路径；要么 closure §5 显式列入 “gateway / registry 在 Z3 不退役，runtime-mainline 直连 adapter” 作为已 ack residual。
- **可以后续跟进的 non-blocking follow-up**：
  1. **R7 / R8** — quota 政策 owner 拍板（tool error 是否扣额 + idempotency_key 派生策略），并在 design Z3 §F5 明文化；不阻塞 Z3 closure。
  2. **R9 / R10** — Workers AI tool list 与 bash-core capability registry 共享 + system prompt 注入，可在 Z3.x 或 Z4 第一时间补。
  3. **R12 / R13** — parity gate 静默降级 disclosure + provider fallback 选型策略，可作为 Z3 hardening follow-up。
  4. **R11 / R17** — registry & loader 死代码标记 + tool schema cache，文档/可读性级别。
  5. **跨阶段 §5.2 第 1 条** — Z2 W-1（RPC kickoff bypass `validateInternalAuthority`）必须在 Z4 第二个 RPC caller 出现之前修复；本轮可作为 Z3 closure §5 显式 follow-up。
  6. **跨阶段 §5.2 第 2 条** — synthetic seed cleanup script 必须在 Z4 真实多租户上线前执行。

> 本轮 review 不收口。等待实现者按本文档 §6 §blocker 1-5 响应并再次更新代码与 closure 文档之后，再做 second-round 复核。届时同时 verify Z2 W-1 仍未修复带来的 cascading risk 是否被合理隔离。

---

## 7. 备忘：Z2 review 与 Z3 review 的连续判断

> 这一节专门留给后续阶段做“Z3 何时可以真正 closed、Z4 何时可以 start”的判断备忘，不属于本轮收口结论的一部分。

- **Z3 何时可以 closed**：本文档 §6 §blocker 1-5 全部响应；同时 Z2 review §9 / 跨阶段 §5.2 第 1 条 W-1 必须落 fix（让 RPC kickoff 走 `validateInternalRpcMeta` 之外再加 `x-nano-internal-binding-secret` 校验），或在 closure §5 中显式 lift 为 Z4 第一个 preflight。
- **Z4 何时可以 start**：除 Z3 §6 blocker 全部完成外，必须先满足以下两条 cross-stage 前置：
  1. `deploy-fill` / `env.TEAM_UUID` 兜底有明确 retire 时间表（R15）；不可继续“Z4 之后再说”。
  2. `ensureTeamSeed` synthetic 数据要么被 cleanup script 清理，要么被 orchestrator-auth bootstrap seed 替换（R5 + 跨阶段 §5.2 第 2 条）。
- **Z4 在两条前置未满足之前**：可以做 Web 端 UI / wire / fallback 设计，但不应进入 Mini Program 真实 first run；因为 Mini Program 接入意味着真实多客户端、真实 multi-tenant，会立刻把 deploy-fill + synthetic seed 这两条隐患放大。

---

## 8. 审查方法学说明

- 本审查遵守用户在 invocation 中给出的 “**仅使用 Opus 自己的 reasoning，不参考其他同事（Kimi / DeepSeek / 其他 Opus）的分析报告**” 约束。本文档全部 R / 跨阶段判断均基于：
  1. 仓库当前真实代码、migrations、wrangler.jsonc、tests 文件夹的实际内容；
  2. `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md` §10 GPT 工作日志；
  3. `docs/issue/zero-to-real/Z3-closure.md` §1 / §2 / §3 / §5；
  4. `docs/design/zero-to-real/Z3-real-runtime-and-quota.md` 与 `ZX-llm-adapter-and-secrets.md` / `ZX-d1-schema-and-migrations.md` / `ZX-qna.md` 的 frozen freeze 项；
  5. `context/ddl-v170/smind-09-tenant-billing-quota-usage.sql` 与 `smind-01-tenant-identity.sql` 作为 schema 参考；
  6. 现有 Z0 / Z1 / Z2 closure 与 review-by-opus.md（仅作为“跨阶段不变量”比较的事实依据，未引用其他 reviewer 的判断）。
- 本审查不依赖 GPT 工作日志的“正面叙述”作为事实——所有“已交付”项均经过 file-level grep / 行级 inspect / 跨文件交叉验证。

## 6.1 对本轮审查的回应

> 执行者: `GPT-5.4`
> 执行时间: `2026-04-25`
> 回应范围: `R1–R17（并吸收 DeepSeek / Kimi 的重复与交叉 finding）`

- **总体回应**：`本轮把真实成立的 runtime / quota / docs drift 逐项吸收：gateway 不再是 stub，DeepSeek skeleton 已补，provider_key/atomic quota write/write-ownership drift 已修，Z3 docs 与测试证据也已回填；剩余未改项均转成显式 deferred/owner-level tradeoff。`
- **本轮修改策略**：`优先修 correctness 与 design-law drift，再修 docs truth，最后补最小但直接命中新代码路径的 package regressions；不把仍需 owner 取舍的 tool schema / system prompt / fallback policy 伪装成“已解决”。`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | gateway 仍是 stub，runtime-mainline 直连 adapter | `fixed` | 新建 `WorkersAiGateway`，并让 `runtime-mainline.ts` 通过 gateway 执行真实 Workers AI path | `workers/agent-core/src/llm/gateway.ts`; `workers/agent-core/src/host/runtime-mainline.ts`; `workers/agent-core/src/llm/index.ts` |
| R2 | DeepSeek skeleton 未创建 | `fixed` | 新增 `workers/agent-core/src/llm/adapters/deepseek/index.ts` throw-only skeleton，并暴露到 llm public export | `workers/agent-core/src/llm/adapters/deepseek/index.ts`; `workers/agent-core/src/llm/index.ts` |
| R3 | `nano_usage_events.provider_key` 缺失 | `fixed` | 新增 `005-usage-events-provider-key.sql`，quota usage 写入 `provider_key`，同步修 ZX-D1 字段冻结 | `workers/orchestrator-core/migrations/005-usage-events-provider-key.sql`; `workers/agent-core/src/host/quota/repository.ts`; `workers/agent-core/src/host/quota/authorizer.ts`; `workers/agent-core/src/host/runtime-mainline.ts`; `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md` |
| R4 | Z3 新代码路径没有任何测试证据 | `fixed` | 新增 gateway / runtime-mainline / quota repository 三组 package regressions，并在 closure 中明确 live suite 不是唯一证据 | `workers/agent-core/test/llm/gateway.test.ts`; `workers/agent-core/test/host/runtime-mainline.test.ts`; `workers/agent-core/test/host/quota/repository.test.ts`; `docs/issue/zero-to-real/Z3-closure.md` |
| R5 | `ensureTeamSeed()` 违反 write ownership / synthetic seed 常开 | `partially-fixed` | 保留 preview single-tenant escape hatch，但改为显式 `NANO_AGENT_ALLOW_PREVIEW_TEAM_SEED=true` 才允许触发，并把 residual 写清 | `workers/agent-core/src/host/quota/repository.ts`; `workers/agent-core/src/host/do/nano-session-do.ts`; `workers/agent-core/src/host/env.ts`; `workers/agent-core/src/index.ts`; `workers/agent-core/wrangler.jsonc`; `docs/issue/zero-to-real/Z3-closure.md`; `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md` |
| R6 | quota activity append 永久丢失 lineage / 与 activity ownership 冲突 | `fixed` | 移除 `agent-core -> nano_session_activity_logs` 直写；Z3 evidence 仅保留 `nano_usage_events` + trace/eval sink | `workers/agent-core/src/host/quota/repository.ts`; `workers/agent-core/src/host/quota/authorizer.ts`; `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`; `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md`; `docs/issue/zero-to-real/Z3-closure.md` |
| R7 | tool capability error envelope 仍会 commit 扣额 | `fixed` | `runtime-mainline.ts` 仅在 capability 返回 `status: "ok"` 时 commit tool quota；error envelope 不再扣额 | `workers/agent-core/src/host/runtime-mainline.ts`; `workers/agent-core/test/host/runtime-mainline.test.ts` |
| R8 | idempotency_key 由每次重新 mint 的 requestId 派生 | `fixed` | LLM requestId 改为 `llm-${turnId}-${seq}`，且只在 authorize 成功后入表/入 Map，消除 pre-authorize leak 与随机 request drift | `workers/agent-core/src/host/runtime-mainline.ts`; `workers/agent-core/test/host/runtime-mainline.test.ts` |
| R9 | Workers AI tool schema 硬编码且与 bash-core registry 解耦 | `deferred` | 问题成立，但属于 capability inventory / registry convergence；本轮不在 Z3 review-fix 内重构 tool registry | `无代码修改；在本回应中显式保留` |
| R10 | runtime 无 system prompt | `deferred` | 问题成立，但当前 Z3 fix 先处理 correctness / design seam；system prompt 归入 Z3.x / Z4 runtime hardening | `无代码修改；在本回应中显式保留` |
| R11 | provider/model registry 与 loader 是死代码 | `fixed` | gateway 现通过 `loadRegistryFromConfig()` + `buildExecutionRequest()` 消费 registry/model truth，不再是纯死代码 | `workers/agent-core/src/llm/gateway.ts`; `workers/agent-core/src/llm/index.ts` |
| R12 | `forwardStart / forwardStatus` parity 缺 authority/binding 时静默降级 | `deferred` | finding 成立，但属于 orchestrator-core parity disclosure；本轮未改 Z3 runtime correctness 主线 | `无代码修改；在本回应中显式保留` |
| R13 | Workers AI per-error fallback 偏离 frozen policy | `deferred` | finding 成立，但需 owner-level fallback policy 取舍；本轮先不改变 live runtime 行为 | `无代码修改；在本回应中显式保留` |
| R14 | closure 把 36/36 + 12/12 当成 Z3 唯一主证据 | `fixed` | closure §3 已补 package regressions，并明确 live suite 证明的是 deploy roundtrip，不是新代码路径唯一证据 | `docs/issue/zero-to-real/Z3-closure.md` |
| R15 | preview shared D1 与 deploy `TEAM_UUID` 仍走 single-tenant 占位路径 | `partially-fixed` | 不再隐式 auto-seed，改为 preview-only explicit gate，并把 cleanup/bootstrap residual 明写进 closure | `workers/agent-core/src/host/quota/repository.ts`; `workers/agent-core/wrangler.jsonc`; `docs/issue/zero-to-real/Z3-closure.md`; `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md` |
| R16 | ZX-D1 与 ZX-LLM-adapter 字段集自相矛盾 | `fixed` | ZX-D1 已对齐 `provider_key`，并明确 Wave B=`002+003`、Wave C=`004+005` 的当前 truth | `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md` |
| R17 | Workers AI tool schema 每次调用都重建 | `deferred` | 这是非阻塞性能/cleanliness follow-up；当前 first-wave 仍接受 per-call 构建成本 | `无代码修改；在本回应中显式保留` |

### 6.3 变更文件清单

- `workers/agent-core/src/llm/gateway.ts`
- `workers/agent-core/src/llm/adapters/deepseek/index.ts`
- `workers/agent-core/src/llm/index.ts`
- `workers/agent-core/src/host/runtime-mainline.ts`
- `workers/agent-core/src/host/quota/repository.ts`
- `workers/agent-core/src/host/quota/authorizer.ts`
- `workers/agent-core/src/host/do/nano-session-do.ts`
- `workers/agent-core/src/host/env.ts`
- `workers/agent-core/src/index.ts`
- `workers/agent-core/wrangler.jsonc`
- `workers/agent-core/test/llm/gateway.test.ts`
- `workers/agent-core/test/host/runtime-mainline.test.ts`
- `workers/agent-core/test/host/quota/repository.test.ts`
- `workers/orchestrator-core/migrations/005-usage-events-provider-key.sql`
- `docs/design/zero-to-real/ZX-d1-schema-and-migrations.md`
- `docs/action-plan/zero-to-real/Z3-real-runtime-and-quota.md`
- `docs/issue/zero-to-real/Z3-closure.md`

### 6.4 验证结果

```text
pnpm --filter @haimang/agent-core-worker typecheck
pnpm --filter @haimang/agent-core-worker build
pnpm --filter @haimang/agent-core-worker test

Result:
- typecheck/build/test 全部通过
- 新增回归已进入 agent-core package test：
  - test/llm/gateway.test.ts
  - test/host/runtime-mainline.test.ts
  - test/host/quota/repository.test.ts
```

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. preview deploy posture 仍是 single-tenant 占位，`NANO_AGENT_ALLOW_PREVIEW_TEAM_SEED=true` 只是显式 escape hatch，不是最终 bootstrap truth。
  2. Workers AI tool schema / system prompt / fallback policy 仍未与 bash-core registry 和 owner-level provider policy 完整统一，这些属于后续 hardening，不再冒充为本轮已解决。
