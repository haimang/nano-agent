# Zero-to-Real — ZX QNA

> 范围：`zero-to-real / Z0-Z4`
> 目的：把会影响后续 `docs/design/zero-to-real/*.md`、`docs/action-plan/zero-to-real/*.md` 与 Z0-Z4 closure 的业主 / 架构师决策收敛到一份单一清单，避免在多个文档中重复回答、重复漂移、重复改口。
> 状态：`answered freeze register (Q1-Q10 owner answers recorded)`
> 使用方式：
> 1. **业主只在本文件填写回答。**
> 2. 其他 design / action-plan / memo 若引用某个 `Q` 编号，默认都以本文件为唯一答复来源。
> 3. 各具体文档不再逐条填写 QNA；如仍保留“已确认 / 已冻结”的历史表述，应理解为上下文说明，后续统一以本文件已回填答案为准。
> 4. `Q` 编号应保持稳定；后续若补题，从最后一个编号继续追加。
>
> 📝 **注**：
> - 本文件使用 `docs/templates/qna.md` 的完整版格式。
> - 当前建议以 `docs/charter/plan-zero-to-real.md` 与本轮 design 初稿为基础。

---

## 1. Auth / Boundary / RPC

### Q1 — `orchestration.auth` 的 exact transport form，是否直接冻结为 WorkerEntrypoint RPC-first？（来源：`ZX-binding-boundary-and-rpc-rollout.md`、`Z1-full-auth-and-tenant-foundation.md`）

- **影响范围**：`workers/orchestration-auth/**`、`workers/orchestrator-core/**`、Z1 tests、后续 auth pure-RPC boundary proof
- **为什么必须确认**：虽然 charter 已冻结 `orchestration.auth = internal-only + single caller + no public route`，但 exact transport 仍影响 Z1 的实现路线。如果不拍板，Z1 会在 WorkerEntrypoint RPC 与 fetch-binding shim 之间摇摆。
- **当前建议 / 倾向**：**优先冻结为 WorkerEntrypoint RPC-first；仅在 Cloudflare 实际限制阻塞时，退回 fetch-binding shim 作为过渡实现。**
- **Reasoning**：这个问题出现，是因为 repo 当前真正跑着的 internal control-plane 仍偏 fetch-backed，而 `nacp-core` 已经有 service-binding / DO RPC transport primitives。推荐 WorkerEntrypoint RPC-first，更符合 zero-to-real 对“internal boundary 是主线之一”的要求；如果不拍板，Z1 极可能把 auth 先做成 fetch shim，然后长期拖着不切。

- **Opus的对问题的分解**：
  - 问题其实有三层：(a) RPC vs fetch-binding shim 的技术选型；(b) caller / callee 之间合约由谁拥有，是否 typed；(c) 实施过渡期如何避免"shim 永久化"。
  - 代码事实：`packages/nacp-core/src/transport/service-binding.ts` 与 `do-rpc.ts` 已具备 transport precheck 能力；`workers/orchestrator-core/src/user-do.ts:657 forwardInternalRaw` 当前仍走 `https://agent.internal/internal/...` fetch-backed——这是过渡现实，不是终态。
  - 同时 `workers/orchestration-auth/` 目录在文件系统中**不存在**——这道题不仅是"选 transport"，而是"建一个新 worker 时第一笔技术债选哪种"。

- **Opus的对GPT推荐线路的分析**：
  - GPT 推荐 WorkerEntrypoint RPC-first 与 charter 的"control-plane RPC-first"主线吻合，技术前提具备，方向正确。
  - 但 GPT 留的 fallback 条款 ("仅在 Cloudflare 实际限制阻塞时退回 fetch-binding shim 作为过渡实现") 没有 retire deadline——这是实务上 shim 永久化最常见的入口。一旦 Z1 接受 shim，Z2/Z3 的 RPC 主线会被这条已 working 的 shim 持续阻击。
  - GPT 也没强制要求 "typed contract package"，而 RPC-first 没有 typed 合约 = caller/callee 类型漂移，反而比 fetch JSON 更难调试。

- **Opus的最终回答**：
  - **同意 WorkerEntrypoint RPC-first**，但附两条硬约束：
    1. **必须创建 `packages/orchestration-auth-contract/` typed 合约包**：auth worker 与 orchestrator 都从该包 import 接口与 envelope 类型，杜绝 caller/callee 类型漂移。
    2. **fetch-binding shim 退化路径必须带 retire deadline**：仅当 Cloudflare 平台限制确实阻塞 RPC 时允许 shim，但必须在 Z1 closure 文档显式记录"deadline = Z2 closure 之前必须完全替换为 RPC"，否则 Z2 review 不收口。
  - 业主回答此题时建议同时确认 Z1 是否承担 `workers/orchestration-auth/` 工程骨架（参见 review R3）——若不承担，本题答案没有落点。

- **问题**：`Z1 是否确认把 orchestration.auth 的 exact transport 冻结为 WorkerEntrypoint RPC-first？若不同意，请明确是接受 fetch-binding shim 作为 Z1 baseline，还是要改成其它 internal transport。`
- **业主回答**：同意 GPT 的推荐，同意 Opus 的看法。

### Q2 — JWT signing / verification / rotation 的 first-wave 纪律，是否采用“单签发 key + 双验证窗口”？（来源：`ZX-nacp-realization-track.md`、`Z1-full-auth-and-tenant-foundation.md`）

- **影响范围**：`orchestration.auth` JWT mint、`orchestration.core` verify、secret rotation playbook、Z1 closure
- **为什么必须确认**：auth worker 与 orchestrator 需要共享 token truth；如果 rotation 策略不冻结，Z1 只能写死“一个 secret 永久不动”或引入过度复杂方案。
- **当前建议 / 倾向**：**采用 HS256 单签发 key + 双验证窗口。** 即 auth worker 仅用 active key 签发；orchestrator 在 rotation 窗口内同时接受 old/new 验证，待旧 token 自然过期后删除旧 key。
- **Reasoning**：这个问题出现，是因为 zero-to-real 需要真实 JWT，而真实 JWT 一旦进入生产路径就必须考虑 rotation。推荐路线足够简单，也与当前 repo 的轻量 auth reality 匹配；如果不拍板，Z1 可能先做出无法平滑轮换的 token 方案，后续再返工。

- **Opus的对问题的分解**：
  - 三层：(a) 算法选择（HS256 对称 vs RS256/ES256 非对称）；(b) 单 key 还是多 key 共存；(c) rotation 时 verifier 如何选对 key。
  - 代码事实：`workers/orchestrator-core/src/auth.ts:75 verifyJwt` 已存在；同文件 `grep “createJwt\|mintJwt\|signJwt”` → **0 命中**——当前仓库**没有任何 worker 能 mint JWT**，是从零开始建造。
  - 参考 `context/smind-admin/src/modules/identity/auth.service.ts:62-69`：smind-admin 已用 `createJwt` mint 单一 key 签发，claim 集 `{user_uuid, team_uuid, team_plan_level}`——可以作为 nano-agent 的祖宗实现，但 smind-admin 未实现 rotation。

- **Opus的对GPT推荐线路的分析**：
  - HS256 + 双验证窗口 在 Cloudflare 单平台、所有 verifier 都是 own worker 的前提下是最简方案，方向同意。
  - 但 GPT 推荐里”双验证窗口”的实现细节模糊——若是”两个 secret 一起放、verify 时 try-both”，会出现两个隐患：(i) 错误 token 与 old key 偶然碰撞，难以与正常 old-key token 区分；(ii) rotation 状态难以观测（”现在到底接受几个 key？”）。
  - GPT 也没规定 secret 落点（wrangler secret? D1? KV?）——这会影响 rotation 操作的具体步骤。

- **Opus的最终回答**：
  - **同意 HS256 + 双验证窗口大方向**，但要求加三条 freeze：
    1. **JWT header 必须含 `kid` (key id)**：verifier 根据 `kid` 选 key 而非 try-both。这样 rotation 操作变成”加新 kid → 等旧 token 自然过期 → 移除旧 kid”，可观测且零误判。
    2. **secret 落点 = wrangler secret**：命名约定 `JWT_SIGNING_KEY_<kid>`（如 `JWT_SIGNING_KEY_2026Q2`）。rotation 时 deploy 同时带 N 个 secret，Z1 first-wave 默认 N=2。
    3. **claim 集与 smind-admin 对齐**：`{user_uuid, team_uuid, team_plan_level, kid, iat, exp}`，`exp` 默认 1h（access token）；refresh-token lifetime 与 rotation 见 review R12（建议 30d）。
  - 此题与 review R12 强相关，建议 owner 同时确认 refresh-token 默认 lifetime（推荐 access 1h / refresh 30d / rotate-on-use）。

- **问题**：`Z1 的 JWT secret 纪律，是否确认采用”单签发 key + 双验证窗口”的最小 rotation 方案？`
- **业主回答**：同意 GPT 的推荐，同意 Opus 的看法。

### Q3 — WeChat 首次登录时，是否确认“自动建 user + default team + membership”作为 first-wave baseline？（来源：`Z1-full-auth-and-tenant-foundation.md`、`ZX-d1-schema-and-migrations.md`）

- **影响范围**：WeChat bridge、identity core、team membership、Mini Program 首次 onboarding
- **为什么必须确认**：WeChat bridge 真正难的不是拿 `openid`，而是首次登录后系统要不要自动完成租户落地。如果不拍板，Z1 会卡在“登录成功但没有 tenant truth”。
- **当前建议 / 倾向**：**确认自动建 user + default team + owner-level membership。**
- **Reasoning**：这个问题出现，是因为 zero-to-real 明确需要 real WeChat login + multi-tenant day-1，而不是只拿到一个外部 identity 就结束。推荐自动建 default team，因为这是 first real run 成本最低、最可持续验证的路径；如果不拍板，Mini Program 首次登录会变成半成品体验。

- **Opus的对问题的分解**：
  - 四层：(a) 是否自动建 user；(b) 是否自动建 default team；(c) 是否自动建 membership；(d) membership 的 role 是什么。
  - 代码事实：`context/smind-admin/src/modules/identity/auth.service.ts:107-130` 的 register flow **只建 user / profile / identity 三表，不建 team / membership**——因此 nano-agent 此处比 smind-admin 更进一步，不是无条件继承祖宗实现。
  - 表事实：`context/ddl-v170/smind-01-tenant-identity.sql` 中 `smind_users` 有 `default_team_uuid` 列；`smind_team_memberships` 是 owner/role 真相源。自动建 = 写 4 张表（user + profile + identity + team + membership = 5 张）。
  - **隐性后果**：如果不自动建 team，登录后 NACP authority 中 `team_uuid` 为 null——会让 Z2/Z3 的 tenant 隔离逻辑出现"null vs empty vs valid"三态，安全面与代码面都更复杂。

- **Opus的对GPT推荐线路的分析**：
  - 同意 GPT 推荐的方向（自动建）。理由是产品层面 Mini Program 首登期望"零摩擦"，技术层面消除 team_uuid null 三态歧义。
  - 但 GPT 推荐没有覆盖三个具体决策点：(i) team 命名规则（不能是 random，要确定性）；(ii) email_password 注册是否同样自动建 team；(iii) 如果不自动建，retreat path 是什么。
  - 特别是 (ii)：如果只 WeChat 自动建、email_password 不建，会让两条 auth path 在 tenant 行为上分叉，Z2/Z3 测试用例直接翻倍。

- **Opus的最终回答**：
  - **同意"WeChat 首登自动建 user + default team + owner-level membership"**，但补充三条硬约束：
    1. **team 命名确定性**：`team_name = ${user_nickname || ('user-' + openid_prefix(8))} 的工作区`；`team_uuid = uuid()`，但若想要可重建可改用 `uuid_v5(namespace, openid)`。先用 random uuid 即可。
    2. **email_password 路径同样应用**：注册成功立即自动建 default team + membership，避免 auth path 分叉。这条比 WeChat 路径更应明确，因为 charter 没显式说。
    3. **membership.role = `owner`**（即 ddl-v170 的最高 role）；后续若用户加入其他 team 形成 multi-tenant，default team 仍保留。
  - **NACP authority 不变规则**：登录后 `team_uuid` 必为非 null（如果建 team 失败，应整体回滚 user 注册并报错；不允许"user 已建、team 未建"中间态）。

- **问题**：`WeChat 第一次登录成功后，是否确认自动创建 user/default team/default membership？如果不同意，请明确需要 invited binding 还是其它 onboarding 流。`
- **业主回答**：同意 GPT 的推荐，同意 Opus 的看法。

### Q4 — 最小 API key verify 运行时路径，是否只有在 server-to-server ingress 启用时才进入 Z1？（来源：`Z1-full-auth-and-tenant-foundation.md`、`ZX-binding-boundary-and-rpc-rollout.md`）

- **影响范围**：`orchestration.auth`、server-to-server ingress、Z1 scope 控制
- **为什么必须确认**：charter 已明确“完整 API key admin plane out-of-scope，但最小 verify path 可在 Z1”。是否真的要进 Z1，需要 owner 拍板，否则 scope 可能继续膨胀。
- **当前建议 / 倾向**：**只有当 zero-to-real 确定会启用 server-to-server ingress 时，才把 minimal API key verify 放进 Z1；否则保持 schema reserved，不抢跑实现。**
- **Reasoning**：这个问题出现，是因为 API key 很容易从“最小 verify”膨胀成半个 admin plane。当前推荐路线更稳：仅当它真服务 first real run 时才实现；如果不拍板，Z1 容易被不必要的 control-plane richness 稀释。

- **Opus的对问题的分解**：
  - 三层：(a) zero-to-real 阶段是否真存在 S2S consumer；(b) 若无，schema 是否仍要预留；(c) 若有，verify 实现落 Z1 还是后置阶段。
  - 代码事实：`context/ddl-v170/` 已有 `smind_team_api_keys` 表；`context/smind-admin/src/modules/identity/auth.service.ts:142-150 validateApiKey` 已是参考实现（用 `hashSecret(api_key, PASSWORD_SALT)` 比对 `api_key_hash`，状态接受 `active|rotating`）。
  - charter 与 design 已识别的 first-wave client 只有 web + Mini Program，两者都走 JWT；server-to-server consumer **不在 zero-to-real 任何文档列入的 in-scope client 之中**。

- **Opus的对GPT推荐线路的分析**：
  - GPT 的最小化方向正确：仅当真有 S2S 需求时才落 Z1。
  - 但 GPT 没区分”schema 是否预留”与”impl 是否实现”——这两件事成本完全不同：建表是几行 SQL（零成本），实现完整 verify path + admin plane（rotate / revoke / quota-per-key / scope）则会膨胀。
  - 智能选择是分开两件事：schema 复刻无成本应做，impl 完整化则严格 OoS。

- **Opus的最终回答**：
  - **推荐”schema 预留进 Z1 D1 wave + impl 完整 defer 到下一阶段”**，比 GPT 推荐更激进保守：
    1. **Schema：建表 `nano_team_api_keys`（mirror smind 结构）**，纳入 ZX-D1 §5.1（升级到 S 级，不留灰区）。理由：建表零成本，还能让 Z2/Z3 的 tenant 隔离测试覆盖此表。
    2. **Impl：完整 verify path 不进 Z1**。如果 Z4 first real run 暴露真实 S2S 需求，作为下一阶段独立项处理（带 admin plane 一起）。
    3. **如果 owner 坚持 Z1 进 verify path**：必须同时定义 admin plane 边界（创建 / 撤销 / 列出 API key），否则会出现”user 注册了 API key 但无管理 UI”的死端体验。
  - 业主回答此题时建议同时回答：”Z1 是否真有 S2S consumer 候选？” 如答案是”暂无”，本题答案应明确为 “schema yes, impl no”。

- **问题**：`本阶段是否确实需要 server-to-server API key verify 路径？如果不需要，是否同意把它降为”schema 预留 + action-plan defer”？`
- **业主回答**：同意 GPT 的推荐，同意 Opus 的看法。

---

## 2. Schema / Session / Hot State

### Q5 — `nano_session_activity_logs` 的 first-wave 形态，是否确认采用“单 append-only 表 + 必要 views/query helpers”？（来源：`ZX-d1-schema-and-migrations.md`、`ZX-nacp-realization-track.md`、`Z2-session-truth-and-audit-baseline.md`）

- **影响范围**：Z2 D1 migrations、activity/audit readback、trace linkage、后续 closure/eval
- **为什么必须确认**：这张表没有现成祖宗结构可照抄；如果不拍板，Z2 会在“单表先行”与“拆 activity/audit 两组表”之间来回摆。
- **当前建议 / 倾向**：**先采用单 append-only 表，按 `team_uuid + conversation_uuid/session_uuid/turn_uuid + trace_uuid + event_kind + payload + created_at` 组织，再用 views 或 query helpers 派生 read model。**
- **Reasoning**：这个问题出现，是因为 zero-to-real 需要可审计、可回看，但又没有 full BI/reporting 目标。单表 + views 是最克制也最实用的方案；如果不拍板，Z2 很可能会把审计层做得过重，或者相反做得太散。

- **Opus的对问题的分解**：
  - 三层：(a) 单表 vs 按 domain 拆（auth_events / runtime_events / quota_events）；(b) 字段集是否完整支撑 first-wave audit 需求；(c) read model 形态（views / query helpers / 物化视图）。
  - 代码事实：`context/ddl-v170/` 12 个 smind-* 模块**没有任何 audit/activity_log 表族**，最接近的是 smind-04 `process_events`（属于 workflow control plane，已被 charter 列为 OoS）。即此表是 nano-agent 全新设计，没有祖宗结构可继承。
  - 既有 redaction 资产：`packages/nacp-session/src/redaction.ts` 已存在，可被 payload 写入侧复用。

- **Opus的对GPT推荐线路的分析**：
  - **方向同意单表**：first-wave audit 没有 BI/reporting 主目标，单表 + event_kind 区分 + views 派生最克制。
  - **但 GPT 推荐字段集偏单薄**：`team_uuid + conversation_uuid/session_uuid/turn_uuid + trace_uuid + event_kind + payload + created_at` 缺三个 first-wave 必要字段：
    1. **`actor_user_uuid`**：谁触发的事件——审计场景必备（不能只靠 team 维度）。
    2. **`event_seq`（同 trace 内顺序）**：created_at 精度可能不足以排序同毫秒事件，trace 内严格 seq 是 owner 巡检"事件顺序"必备。
    3. **`severity`（info/warn/error）**：owner 巡检过滤面，不需精细但需有过滤维度。
  - GPT 也没说 payload 大小上限与 redaction 接入点——audit 上线后无法事后清理，必须前置定。

- **Opus的最终回答**：
  - **同意"单 append-only 表 + views"baseline**，但要求字段集扩展为以下 12 列：
    ```
    activity_uuid       TEXT PK
    team_uuid           TEXT NOT NULL
    actor_user_uuid     TEXT (nullable, 系统事件可为空)
    conversation_uuid   TEXT (nullable)
    session_uuid        TEXT (nullable)
    turn_uuid           TEXT (nullable)
    trace_uuid          TEXT NOT NULL
    event_seq           INTEGER NOT NULL  (per trace 内严格递增)
    event_kind          TEXT NOT NULL     (如 'auth.login' / 'quota.deny' / 'runtime.llm.invoke')
    severity            TEXT NOT NULL     (info|warn|error)
    payload             TEXT              (JSON, max 8KB)
    created_at          TEXT NOT NULL     (ISO8601)
    ```
  - **强制 index** 三条：`(team_uuid, created_at DESC)`、`(trace_uuid, event_seq)`、`(session_uuid, created_at)`。
  - **payload redaction 复用 `packages/nacp-session/src/redaction.ts`**，写入侧统一过滤；不允许任何 worker 直接 INSERT 不经过 redaction wrapper。
  - **first-wave views**：建议先建一条 `view_recent_audit_per_team`（最近 7 天，按 team 分组），其余 query helpers 落 codebase 而非 D1 view。

- **问题**：`Z2 是否确认把 nano_session_activity_logs 做成单 append-only 表 + 必要 views/query helpers 的 baseline？`
- **业主回答**：同意 GPT 的推荐，同意 Opus 的看法。

### Q6 — `orchestration.core` 的 DO SQLite hot-state 最低集合，应冻结到什么粒度？（来源：`ZX-d1-schema-and-migrations.md`、`Z2-session-truth-and-audit-baseline.md`）

- **影响范围**：`workers/orchestrator-core/src/user-do.ts` stateful uplift、history/reconnect/timeline 热路径、Z2 closure
- **为什么必须确认**：charter 已要求 Z2 纳入 DO SQLite / Alarm / conversation 聚合最低集合，但“最低集合”还不够精确。如果不拍板，Z2 容易一边过度设计，一边又拿不出 closure 标准。
- **当前建议 / 倾向**：**冻结为 4 组热态：conversation index、active conversation/session 指针、recent timeline cursor / reconnect hint、短时 secret/profile cache。**
- **Reasoning**：这个问题出现，是因为 zero-to-real 既不能把所有 truth 都塞进 D1 冷读，也不能把 user-level 状态无限膨胀在 DO SQLite。当前建议正好覆盖 history/reconnect/real client 最常用热路径；如果不拍板，Z2 的 “stateful uplift” 很容易变成模糊口号。

- **Opus的对问题的分解**：
  - 三层：(a) hot-state 包含哪些类别；(b) 各类别的容量上限与 TTL；(c) DO Alarm 触发什么动作。
  - 代码事实：`workers/orchestrator-core/src/user-do.ts`（788 行）当前主要承担 session registry / relay；它的 DO storage 已在使用，但还不是真正的 stateful host。
  - 关键 invariant：DO SQLite **没有自动 GC**——所有写入都是永久的直到显式 delete。如果不定容量上限，hot-state 必然无限膨胀（尤其 recent_frames）。
  - 与 D1 的关系：DO hot-state 必须能从 D1 重建，不能成为唯一真相源。这条 charter 已说，但 design 没说”如何证明可重建”。

- **Opus的对GPT推荐线路的分析**：
  - GPT 提的 4 类（conversation index / active pointers / reconnect/timeline hints / short-lived caches）覆盖面正确，方向同意。
  - 但 GPT 推荐**没有覆盖三个关键维度**：
    1. **容量上限**：每类多少条/多大？conversation index 是 user 全量还是最近 N 条？recent frames 几条？
    2. **TTL 与 GC 触发**：cache 过期后谁清理？谁定时 trim？
    3. **DO Alarm 做什么**：现成的 Alarm 机制如果不指定职责，就会变成”声称用了，没真用”。
  - 这三个空白决定了 hot-state 是 “thin” 还是 “膨胀”。

- **Opus的最终回答**：
  - **同意”4 类划分”**，但要求加三条容量/TTL/Alarm 硬约束：
    1. **容量上限**：
       - `conversation_index`：≤ 200 conversations per user（超出按 last_active 排序丢弃最旧）
       - `active_pointers`：每 user 同时仅 1 条 active session pointer + 1 条 active conversation pointer
       - `recent_frames`：≤ 50 frames per session（超出按 frame_seq 丢弃最旧；reconnect 拿不到的部分回落 D1）
       - `cache`：每条 TTL ≤ 5 min；cache miss 走 D1 重读
    2. **DO Alarm 触发周期 = 10 min**，每次执行：
       - trim recent_frames > 50 / session
       - expire reconnect cursors > 1 h
       - refresh / evict secret cache(包括 JWT key cache)
       - 这个 Alarm 是 stateful uplift 的”心跳”——没有它，hot-state 就是 leak。
    3. **重建 invariant 测试**：Z2 closure 必须包含一条测试，”清空 DO storage 后 reconnect 仍能从 D1 恢复 last 50 frames”。如果通不过，hot-state 设计就是错的。

- **问题**：`Z2 的 DO SQLite hot-state，是否确认冻结为”conversation index + active pointers + reconnect/timeline hints + short-lived caches”四组最小集合？`
- **业主回答**：同意 GPT 的推荐，同意 Opus 的看法。

### Q7 — Z2 第一条 dual-implemented control-plane 方法，是否直接选择 `start`？（来源：`ZX-binding-boundary-and-rpc-rollout.md`、`Z2-session-truth-and-audit-baseline.md`）

- **影响范围**：`orchestration.core -> agent.core` RPC scaffold、Z2 parity proof、后续 rollout 顺序
- **为什么必须确认**：charter 要求 Z2 至少有 1 条主方法双实现可用，但具体是哪条仍未冻结。如果不拍板，Z2 容易把“任意一条”做成形式主义证明。
- **当前建议 / 倾向**：**直接选择 `start` 作为第一条 dual-implemented 方法。**
- **Reasoning**：这个问题出现，是因为 `start` 是 session 生命周期与持久化链路的起点，最能证明 control-plane RPC 真的接进主路径。若不拍板，团队可能选一条相对边缘的方法完成“最低指标”，却无法证明真实价值。

- **Opus的对问题的分解**：
  - 两层：(a) 哪条方法适合作 "首条 dual-impl"；(b) "parity"（双实现等价性）的判定形式是什么。
  - 候选方法集合：start / followup / cancel / status / verify / timeline。
  - 代码事实：`workers/orchestrator-core/src/user-do.ts:483, 490, 653` 中 `forwardInternalRaw` 把这些方法都当成 fetch-backed。把任何一条切到 RPC = 在 user-do 里建第二条 path、加 toggle、加对照测试。
  - 可作 parity 判定的资产：D1 写入的 row diff 可机器比对；返回 envelope 可结构 deep-equal。

- **Opus的对GPT推荐线路的分析**：
  - GPT 选 `start` 出于"最能证明价值"（它是 session 生命周期起点，影响 D1 写入面最广）——这条理由成立。
  - 但 GPT 忽略了 implementation cost：`start` 同时是**最复杂**方法（涉及 conversation 创建、session 创建、authority 注入、初始 stream 建立）；它的 dual-impl parity 测试也最难写——因为多组并发写入很容易在两条 path 之间产生 row diff。
  - 更实务的路径是分两步：先用最简单的方法（如 `status`，纯读、idempotent、无 D1 写入）打通 RPC scaffold，再以 `start` 作为 closure proof。这样 RPC 基础设施 bug 不会与 `start` 业务复杂性纠缠。

- **Opus的最终回答**：
  - **推荐两步走**，比 GPT 单步推荐更稳：
    1. **Z2 中段：`status` 作为 RPC scaffold smoke**（1-2 天工作量）。验证 WorkerEntrypoint binding / NACP envelope precheck / error path / typed contract package（参见 Q1 推荐）通畅。`status` 无 D1 写入，parity 仅需返回值 deep-equal。
    2. **Z2 closure 标志：`start` dual-impl + golden parity test 通过**。Parity 判定 = 同一组 fixtures 跑两套 path，比较：(a) 返回 envelope deep-equal；(b) D1 写入 row diff = ∅；(c) NACP authority/trace stamp 一致。
  - **如果只能选一条作为 charter 满足条件**：选 `start`，与 GPT 一致。但建议在 action-plan 阶段允许"先 `status` smoke"作为内部里程碑，不上 charter。
  - **不推荐选 `cancel` 或 `verify` 作为首条**：cancel 是终止性操作、parity 测试需要构造活 session；verify 主要用于 health check，不能证明"control-plane 真的在主路径上"。

- **问题**：`Z2 的首条 dual-implemented control-plane 方法，是否确认直接用 start？如果不同意，请明确替代方法。`
- **业主回答**：同意 GPT 的推荐，同意 Opus 的看法。

---

## 3. Runtime / Provider / Client

### Q8 — DeepSeek 在 zero-to-real 中的角色，是否只保留为“optional adapter skeleton / fallback track”，而不进入 required provider baseline？（来源：`ZX-llm-adapter-and-secrets.md`、`Z3-real-runtime-and-quota.md`）

- **影响范围**：provider 策略、tenant secret 表、Z3 scope、secret engineering
- **为什么必须确认**：charter 已明确 Workers AI first，但 design 仍需防止 Z3 scope 因 DeepSeek secret/rotation/cache 扩大。
- **当前建议 / 倾向**：**确认 DeepSeek 只做 optional adapter skeleton / fallback track；required provider baseline 只有 Workers AI。**
- **Reasoning**：这个问题出现，是因为 owner 同时关心真实 provider 与未来灵活性。当前建议最稳：先把 fake provider 从主路径拿掉，再把 BYO-key / fallback 作为后续可控增量；如果不拍板，Z3 会同时背上 provider + secret engineering 两层复杂度。

- **Opus的对问题的分解**：
  - 三层：(a) Workers AI 作为 required 是否真够 first real run；(b) DeepSeek skeleton 的代码位置与最小义务；(c) `nano_tenant_secrets` 表是否在 Z3 建表。
  - 代码事实：`workers/agent-core/src/llm/gateway.ts`（15 行）确为 stub interface，注释 “Stub interface only — not implemented in v1”——provider seam 实际还没成形。
  - 历史事实：本人 v2 review (`docs/eval/zero-to-real/plan-analysis-by-opus-v2.md`) 曾推荐 DeepSeek primary；charter r1 + GPT-hardening 倒转为 Workers AI primary。这个倒转**我同意**（platform-native + 零 secret engineering 在 zero-to-real 阶段是更稳的方向），但 owner 应知道这个 decision trail（review R19）。
  - **隐藏风险**：Cloudflare Workers AI 各 model 的 function-calling / tool-calling 能力差异巨大——如果 first-wave 选错 model，agent loop 中的 tool 调用会失败，DeepSeek 必须临时升级 required。

- **Opus的对GPT推荐线路的分析**：
  - **同意 GPT 大方向**：Workers AI required + DeepSeek skeleton，避免 Z3 同时背 provider + secret engineering 两层复杂度。
  - 但 GPT 没回应**两个落点问题**：(i) DeepSeek skeleton 落到哪个文件？是否替代 `gateway.ts`？(ii) 如果 Workers AI fc 失败，escalate DeepSeek 需要 owner 重决策吗？
  - 第二点尤其关键——如果不预设 escalation path，Z3 一旦遇到 fc 障碍就会停摆等 owner 拍板，浪费 1-2 天。

- **Opus的最终回答**：
  - **同意”Workers AI required + DeepSeek skeleton”**，但补三条预设决策：
    1. **Workers AI model fc smoke gate**：first-wave model 必须经过 5+ tool 类型 invoke smoke 测试通过才能上线。如失败：(a) 优先换 model（不同 fc 能力），(b) 换不到则**自动 escalate DeepSeek 为 required**，无需 owner 重决策；只需在本 Q8 文末追加修订记录。
    2. **DeepSeek skeleton 落点**：建 `workers/agent-core/src/llm/adapters/deepseek/` 目录，仅含 adapter shape interface 与一个 throw-not-implemented 函数。不写真实调用代码。这样 future BYO key 接入时不需要重构 boundary。
    3. **`nano_tenant_secrets` 暂不建表**：等 BYO-key 真实需求出现再 wave-N 加表。当前阶段反对建空表占位（”建了不用”是反模式，让 schema 看起来更复杂）。WeChat 凭证落 wrangler secret，与本表无关（参见 review R5）。
  - 业主回答此题时建议同时回答 review R4 引出的 Q（Workers AI 具体 model ID）。

- **问题**：`Z3 是否确认”Workers AI 是唯一 required provider，DeepSeek 只保留 optional adapter skeleton / fallback track”？`
- **业主回答**：同意 GPT 的推荐，同意 Opus 的看法。

### Q9 — quota deny 的 first-wave 语义，是否覆盖“所有 llm/tool side-effects 前 gate”而不是只拦 tool？（来源：`ZX-nacp-realization-track.md`、`Z3-real-runtime-and-quota.md`）

- **影响范围**：`beforeCapabilityExecute` 扩展、LLM invoke gate、usage events、quota balances、trace evidence
- **为什么必须确认**：当前 repo 已有 `beforeCapabilityExecute` seam，但 charter 要求 quota 成为 runtime truth。是否只拦 tool 或连 llm/start 也拦，会直接改变 Z3 的设计面。
- **当前建议 / 倾向**：**覆盖所有会产生资源消耗或副作用的 llm/tool path；client start 仅做轻量 admission，不做无上限旁路。**
- **Reasoning**：这个问题出现，是因为 repo 现状最现成的是 capability hook，而 owner 明确不希望 quota 只是“摆设”。推荐把 llm/tool 都纳入 gate，因为否则 real run 的资源控制会出现最大漏洞；如果不拍板，Z3 很可能只做“工具前拦截”，却让 LLM 成为真实绕行面。

- **Opus的对问题的分解**：
  - 三层：(a) gate 是否覆盖 LLM；(b) gate 是否覆盖 tool；(c) `start` / `followup_input` 是否需要轻量 admission。
  - 代码事实：`workers/bash-core/src/executor.ts:73, 203, 372` 已有 `beforeCapabilityExecute` hook，**仅在 tool/capability 路径上**。`workers/agent-core/src/kernel/runner.ts`（355 行）是 LLM 调用的最近现成位置，**当前没有任何 gate hook**。
  - 这意味着"覆盖 LLM" = 必须新增 hook，不是利用现有 seam；这是 **engineering 工作而非配置工作**。
  - 副作用语义：tool 可能产生 D1 写、文件创建、外部 API 调用——硬副作用；LLM 主要消耗 token——软成本，但金额上往往是大头。

- **Opus的对GPT推荐线路的分析**：
  - **方向同意 GPT**："只拦 tool 不拦 LLM"会让 LLM 成为真实绕行面，违背 owner "配额是门禁"的明确表态。
  - 但 GPT 推荐**没指认 LLM gate 的代码落点**——这道题不解决，Z3 实施者会自创一个位置，与现有 `beforeCapabilityExecute` 形态不一致。
  - GPT 也没说 deny 的可观测形态——deny 事件如果只在 log 里、不进 D1，owner 巡检就看不到。

- **Opus的最终回答**：
  - **同意"LLM + tool 双覆盖；start 仅做轻量 admission"**，但补三条具体落点：
    1. **Tool gate 落点**：复用 `workers/bash-core/src/executor.ts:73 beforeCapabilityExecute`（已存在）。Z3 任务 = 在 hook 里加 quota authorizer 调用。
    2. **LLM gate 落点**：新建 hook `beforeLlmInvoke`，落 `workers/agent-core/src/kernel/runner.ts`，命名对称于 `beforeCapabilityExecute`。两个 hook 都通过 NACP envelope 调 quota authorizer——envelope shape 必须一致（参见 ZX-NACP）。
    3. **Deny 必须可观测**：每次 deny 写一行 `nano_session_activity_logs`，`event_kind='quota.deny'`、`severity='warn'`、`payload` 含 deny reason + remaining balance + requested cost。同时 user-visible stream 抛 typed error `code='QUOTA_EXCEEDED'`，**不允许静默吞掉**。
  - **`start` admission**：仅检查 team 是否被冻结（hard ban），不检查 quota balance。这样新用户/新 session 不会因为 balance 临界值而无法启动。

- **问题**：`Z3 的 quota deny，是否确认覆盖 llm/tool 两类实际消耗路径，而不是只拦 tool？`
- **业主回答**：同意 GPT 的推荐，同意 Opus 的看法。

### Q10 — Mini Program 的 first real run transport baseline，是否接受“HTTP start/input + WS stream/history”作为 first-wave，而不是要求 day-1 纯 WS 双向全闭合？（来源：`ZX-binding-boundary-and-rpc-rollout.md`、`Z4-real-clients-and-first-real-run.md`）

- **影响范围**：Mini Program 客户端、Z4 scope、双向 WS 延后 stateful 工作的排序
- **为什么必须确认**：charter 把双向 WS message handling 放在 Z4 in-scope，但 Z4 同时还承接 WeChat login、history、gap triage。如果不拍板最小 transport baseline，Z4 容易因为追求 full WS purity 而延误 first real run。
- **当前建议 / 倾向**：**接受 first-wave 以 HTTP `start/input` + WS stream/history 为 baseline；双向 WS message handling 仍在 Z4 做，但不作为 first proof 的前提。**
- **Reasoning**：这个问题出现，是因为 owner 既要真实 Mini Program，又要求系统尽快 first real run。当前建议更稳：先闭合真实链路，再把双向 WS 完整化作为 Z4 后半收敛项；如果不拍板，Z4 很容易把 transport purity 当成 real run 前置条件。

- **Opus的对问题的分解**：
  - 三层：(a) input transport（HTTP vs WS）；(b) output transport（WS vs HTTP NDJSON）；(c) 双向 WS message handling 在 Z4 的位置（first proof 前置 vs 收尾项）。
  - WeChat Mini Program 平台事实：(i) WS 有 idle disconnect（默认数十秒静默断开）；(ii) reconnect 频率有限；(iii) wx.connectSocket 与浏览器 WS 行为不完全等价。
  - 既有资产：`packages/nacp-session/src/heartbeat.ts` 已有心跳实现；`replay.ts` 已有 cursor 重连机制；`frame.ts` 已定义 frame 序号——这些都是 Mini Program WS 必须利用的现成能力。
  - 这道题问的是 client 与 `orchestration.core` 之间的 wire（public 边界），**不是** internal mesh 的 transport（参见 Q1）。两件事不要混。

- **Opus的对GPT推荐线路的分析**：
  - **方向同意 GPT**：HTTP-in / WS-out 把 Mini Program 平台坑往后推，让 first real run 闭环优先。
  - 但 GPT 推荐没回应**两个具体集成点**：
    1. WS 如何对抗 WeChat idle disconnect？必须用 heartbeat。
    2. WS 重连后如何不漏帧？必须用 replay cursor。
  - 不指认这两点，Mini Program WS 在 owner 实测中会出现”3 分钟无响应自动断、断了之后历史消息消失”的体验灾难，gap triage 又得回头补。

- **Opus的最终回答**：
  - **同意”HTTP start/input + WS stream/history”作为 first-wave**，但要求显式接入既有 nacp-session 资产：
    1. **WS 必须使用 `packages/nacp-session/src/heartbeat.ts` 的 heartbeat**：间隔 ≤ 25s（小于 WeChat idle disconnect 默认值），由 server 主动 ping 或 client 主动 ping 任一即可（推荐 server-initiated）。
    2. **WS 重连必须使用 `replay.ts` 的 cursor**：reconnect 时 client 上报 last `frame_seq`，server 从该 seq 开始重发；缺帧从 D1 拉。这是 Z2 hot-state 设计的直接消费者。
    3. **HTTP input 必须携 session_uuid**：避免 stream 中途的 follow-up 与原 stream 失联。`packages/nacp-session/src/messages.ts` 已支持此 envelope。
    4. **双向 WS message handling 仍在 Z4 收尾**，但作为 Z4 closure 的”延后 stateful work”项；不是 first proof 前置条件。
  - **顺序约束**：Web hardening → Mini Program 接入。不允许并行做。理由是 Mini Program 调试成本高于 web，先在 web 上把所有 transport 坑磨平。

- **问题**：`Mini Program 的 first real run，是否接受”HTTP start/input + WS stream/history”作为 first-wave baseline？`
- **业主回答**：同意 GPT 的推荐，同意 Opus 的看法。

---

## 4. 使用约束

### 4.1 哪些问题应该进入 QNA

- **会直接改变 contract surface、实现边界、执行顺序、验收标准或支持面披露的问题**
- **需要业主 / 架构师拍板，而不是实现阶段自己就能收敛的技术细节**
- **如果不先拍板，就会导致多个后续文档一起漂移的问题**

### 4.2 哪些问题不应进入 QNA

- **实现细节微调**：例如内部模块命名、单个 migration 文件拆分
- **已有 frozen answer 的重复提问**：除非后续要正式推翻旧答案
- **只影响单个函数或单个包内部实现的问题**

### 4.3 `Reasoning` 的写法要求

- 写给第一次进入 zero-to-real 决策现场的业主
- 解释问题为什么出现、当前建议为什么稳、如果不拍板会怎样
- 明确推荐路线的 trade-off

### 4.4 `问题` 的写法要求

- 必须能让业主直接作答
- 不把多个独立决策捆成一题
- 若存在条件分支，要在问题里明确说明

### 4.5 `业主回答` 的使用要求

- 一旦填写，即成为 Z0-Z4 design/action-plan/review 的唯一口径
- 后续若要推翻，必须在本文件追加修订说明

---

## 5. 最小示例

### QX — `{EXAMPLE_QUESTION_TITLE}`（来源：`{EXAMPLE_SOURCE}`）

- **影响范围**：`{PACKAGE_A / DOC_B / PHASE_C}`
- **为什么必须确认**：`{EXAMPLE_WHY_CONFIRM}`
- **当前建议 / 倾向**：`{EXAMPLE_RECOMMENDATION}`
- **Reasoning**：`{EXAMPLE_REASONING_WRITTEN_FOR_OWNER}`

- **Opus的对问题的分解**：
- **Opus的对GPT推荐线路的分析**：
- **Opus的最终回答**：

- **问题**：`{EXAMPLE_OWNER_FACING_QUESTION}`
- **业主回答**：
