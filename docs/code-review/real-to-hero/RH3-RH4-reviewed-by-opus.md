# Nano-Agent 代码审查 — RH3 + RH4 + 跨阶段回顾

> 审查对象: `real-to-hero / RH3 (Device Auth Gate + API Key) + RH4 (Filesystem R2 + Lane E)`
> 审查类型: `mixed (code-review + closure-review + cross-phase audit)`
> 审查时间: `2026-04-29`
> 审查人: `Opus 4.7(独立审查;不参考 GPT/Kimi/Deepseek/GLM 既有报告)`
> 审查范围:
> - `docs/charter/plan-real-to-hero.md` r2 §7.4 + §7.5 + §8.3 + §8.4 + §9.2 + §10.3
> - `docs/action-plan/real-to-hero/RH3-device-auth-gate-and-api-key.md`(含 §11 工作日志)
> - `docs/action-plan/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md`(含 §11 工作日志)
> - `docs/issue/real-to-hero/RH3-closure.md`
> - `docs/issue/real-to-hero/RH4-closure.md`
> - `workers/orchestrator-core/{src,test,migrations}/`
> - `workers/orchestrator-auth/src/`
> - `workers/agent-core/{src,wrangler.jsonc}`
> - `workers/filesystem-core/{src,test}/`
> - `workers/context-core/src/`
> - `packages/orchestrator-auth-contract/src/`
> - `test/cross-e2e/` 与 `test/package-e2e/`
> 对照真相:
> - charter §7.4(RH3 In/Out scope + 收口标准)+ §7.5(RH4)+ §8.4 migration 编号冻结 + §9.2 测试纪律 + §10.1 Primary Exit + §10.3 NOT-成功退出
> - 两份 RH3 / RH4 action-plan 的 hard gate / DoD
> - 此前 RH0-RH2 review respond §6 的 §2.1.1 C1-C10 carry-over inheritance 表
> 文档状态: `changes-requested`

---

## 0. 总结结论

> **一句话 verdict**:RH3 + RH4 的 client-facing 主链(device gate / API key / `/me/*` 表面 / R2 file pipeline / cross-tenant deny)**确实落地了**,migration 009 + 010 已 apply,3+1 条 live e2e 通过,1878 个单元 test 全绿。但本轮在 **三处** 与 charter / 我们自己写的 action-plan / RH0-RH2 review §2.1.1 出现"裁剪"或"未实施":(a) **API key 原始密钥 plaintext 写入 D1 PK**(security R1)、(b) **Lane E RPC-first dual-track 在代码层面零行实装**(只加了 binding + 一个永远没人读的 env var,违反 charter §10.3 NOT-成功退出 #4)、(c) **RH3 P3-A 没有把 user_uuid 接进 NanoSessionDO**(RH0-RH2 review §2.1.1 中显式登记的 C1 没有兑现,导致 RH1 的 lane F 真投递在生产环境**仍然 100% `delivered:false`**)。同时 R5 的 `files-api.md / r2-namespace.md / lane-e-sunset.md` 三份 charter 显式要求的文档全部缺位,RH3/RH4 evidence 文件也并未生成。结论:**主体结构成立,但三个真实存在的硬纪律违反必须先修才能宣称 RH3/RH4 闭合。**

- **整体判断**:`基础设施 + 客户端表面成立,但 charter §10.3 NOT-成功退出条件 #4(Lane E)与隐含的 #1 / 收口标准 §7.4 P3-A 在代码层面被绕过,且 API key 安全模型有 plaintext 漏洞`
- **结论等级**:`changes-requested`
- **是否允许关闭本轮 review**:`no`
- **本轮最关键的 1-3 个判断**:
  1. **R1 (critical-security)**:API key 在 D1 `nano_team_api_keys.api_key_uuid` 主键中以 plaintext 写入完整可用密钥;`key_hash` 列从 verification 防线被弱化为防御已破。任何具备 D1 read 权限的运维 / 备份 / debug 通道都直接拿到可用密钥。这是 RH3 P3-C 在交付时引入的新攻击面。
  2. **R2 (high-delivery-gap)**:RH4 Phase 4 P4-07 在 action-plan 内承诺的 `LANE_E_RPC_FIRST` 真实 `RemoteArtifactStore` dual-track + `@deprecated` + ESLint `no-restricted-imports` 三件套**全部未实施**;`nano-session-do.ts:330` 仍是 `new InMemoryArtifactStore()`,无 env flag 分支,Phase 7 sunset 因此**无法启动**(没有要 sunset 的东西)。这与 charter §10.3 NOT-成功退出 #4 / #8 同时构成 violation。closure §1 Phase 4 标 ⚠️ partial 远低估事实。
  3. **R3 (high-delivery-gap)**:RH0-RH2 review respond §2.1.1 表 C1 显式列为"P3-S6 必须吸纳 / 工作量 S / 不可降级",但 RH3 在 device gate 落地时**没有**把 `IngressAuthSnapshot.user_uuid` 接进 `NanoSessionDO`;agent-core → orchestrator-core 的 `pushServerFrameToClient` 仍然走 `this.env.USER_UUID` 这个永远为 `undefined` 的路径。直接后果:RH1 lane F 的 permission / elicitation / usage 三链在 production 环境**全部 100% `delivered:false`**。RH3 closure §0 仅用"RH1 carry-over 的 3 条 round-trip cross-e2e 文件未补"包装这件事,把"e2e 文件 missing"叙述出来,把"代码 wiring missing"隐去,这是 closure 口径与代码事实的二次错位。

---

## 1. 审查方法与已核实事实

### 对照文档

- `docs/charter/plan-real-to-hero.md` r2(§4.4 硬纪律 / §7.4 RH3 / §7.5 RH4 / §8.4 migration 编号 / §9.2 测试纪律 / §10.1 Primary Exit / §10.3 NOT-成功退出)
- `docs/action-plan/real-to-hero/RH3-device-auth-gate-and-api-key.md`(415 行,含 §11 work log)
- `docs/action-plan/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md`(420 行,含 §11 work log)
- `docs/issue/real-to-hero/RH3-closure.md`(120 行)
- `docs/issue/real-to-hero/RH4-closure.md`(108 行)
- `docs/code-review/real-to-hero/RH0-RH2-reviewed-by-GPT.md` §6.1.1 / §2.1.1 (RH3 应吸纳的 C1-C10 carry-over inheritance 表)— 仅作为"前序我自己签字过的承诺"对照,不引用其他 reviewer 结论

### 核查实现

- `workers/orchestrator-auth/src/{service,repository}.ts`:device mint / refresh bind / verifyApiKey / createApiKey
- `workers/orchestrator-core/src/auth.ts`(279 行):JWT + nak_ 双轨 + device gate cache
- `workers/orchestrator-core/src/index.ts`(1633 行):/me/team / /me/teams / /me/devices(/revoke)/ /me/conversations / /sessions/{id}/files{,/list,/content}
- `workers/orchestrator-core/src/user-do.ts`(2432 行):enforceSessionDevice / handleDeviceRevoke / WS attach / __forward-frame
- `workers/orchestrator-core/migrations/{009-team-display-and-api-keys,010-session-files}.sql`
- `workers/filesystem-core/src/{artifacts,index}.ts`:`SessionFileStore`(307 行) + RPC entrypoint(136 行)
- `workers/agent-core/{wrangler.jsonc, src/host/do/nano-session-do.ts, src/host/runtime-mainline.ts}`:CONTEXT_CORE / FILESYSTEM_CORE binding + LANE_E_RPC_FIRST + InMemoryArtifactStore 用法
- `packages/orchestrator-auth-contract/src/index.ts`:`AuthTeam` / `AccessTokenClaims` / `AuthSnapshot` / `VerifyApiKeyResult` shape
- `workers/orchestrator-core/test/`:11 个 *-route.test.ts(含 me-team, me-teams, me-devices, me-conversations, files, models, context, messages, permission-decision, elicitation-answer, policy-permission-mode)
- `test/cross-e2e/`:14 个 e2e mjs 文件(含 13-device-revoke 与 14-files-cross-tenant)
- `test/package-e2e/orchestrator-core/`:10 个 e2e mjs(含 09-api-key 与 10-files)

### 执行过的验证

| 命令 | 结果 |
|---|---|
| `pnpm --filter @haimang/jwt-shared test` | ✅ 20 passed |
| `pnpm --filter @haimang/nacp-session test` | ✅ 150 passed |
| `pnpm --filter @haimang/orchestrator-core-worker test` | ✅ 158 passed(17 files)|
| `pnpm --filter @haimang/orchestrator-auth-worker test` | ✅ 18 passed(4 files)|
| `pnpm --filter @haimang/agent-core-worker test` | ✅ 1062 passed(100 files)|
| `pnpm --filter @haimang/context-core-worker test` | ✅ 171 passed(19 files)|
| `pnpm --filter @haimang/filesystem-core-worker test` | ✅ 299 passed(26 files)|
| **测试矩阵合计** | **1878 passed** (RH2 后 1557 → RH3+RH4 净增 321)|
| `pnpm check:cycles` | ❌ 10 cycles(与 RH0-RH2 baseline 完全相同;RH3+RH4 引入 0 个新 cycle)|
| `wc -l` 关键文件 | nano-session-do.ts 1594 / user-do.ts 2432 / index.ts 1633 |
| 文件存在性核查 | docs/api/files-api.md / docs/architecture/r2-namespace.md / docs/owner-decisions/lane-e-sunset.md / docs/issue/real-to-hero/RH3-evidence.md / docs/issue/real-to-hero/RH4-evidence.md **全部不存在** |

### 复用 / 对照的既有审查

- 仅对照"我自己"在 RH0-RH2 review respond §6 与 RH3 action-plan §2.1.1 写下的 C1-C10 carry-over 承诺。不引用 GPT / Kimi / Deepseek / GLM 任一报告作为本轮结论来源。

### 1.1 已确认的正面事实

- migration 009 + 010 schema 文件存在、`UNIQUE INDEX` / `FOREIGN KEY` / 数据 fill 序列正确;closure 声称已 apply 到 preview D1。
- `orchestrator-auth-contract` 升级:`AuthTeam.team_name+team_slug`、`AccessTokenClaims.device_uuid`、`AuthSnapshot.device_uuid`、`VerifyApiKeyResult` 成功 shape、新增 `createApiKey` RPC,均落地。
- device 5 链路代码层面成立:register / login(`issueTokens` line 220-256)/ refresh(`requireBoundDeviceUuid` line 130-149)/ access path(`auth.ts:authenticateRequest` + `readDeviceStatus` cache)/ WS gate(经 ingress auth 间接保护 + DO `enforceSessionDevice` 双层)/ revoke(`handleMeDevicesRevoke` D1 update + audit + cache clear + cross-DO POST `__forward-frame`)。
- `verifyApiKey` 真查 D1 + HMAC-SHA256(salt:raw)(`service.ts:335-366`);`authenticateRequest` 在 `auth.ts:198` 严格按 `nak_` 前缀分流。
- team_slug 自动生成 retry-loop(`service.ts:280-320`)在 `IsUniqueConstraintError` 时 retry,语义正确。
- `/me/team` GET+PATCH(`index.ts:handleMeTeam`)、`/me/teams` GET、`/me/conversations` cursor、`/me/devices` active-only、`/me/devices/revoke` POST 全部接通真实 D1 路径并返 facade envelope。
- `SessionFileStore`(`filesystem-core/src/artifacts.ts:76-247`)实装 R2 + D1 atomic 写入(line 122-148:R2 写入后 D1 INSERT 失败立即 `r2.delete` cleanup,符合 action-plan §5.2 风险应对策略)。
- `tenants/{teamUuid}/sessions/{sessionUuid}/files/{fileUuid}` namespace 严格执行(`buildSessionFileKey` line 249-254),所有 head/get/list/delete 都把 `team_uuid + session_uuid` 作为 WHERE 条件,跨 tenant 无法 list 或 read。
- 25 MiB 上限在 `parseSessionFileUpload`(`index.ts:1511`)与 `SessionFileStore.put`(`artifacts.ts:92`)双层校验,前者返 413 facade,后者 `throw`。
- `requireOwnedSession`(`index.ts:1458-1482`)同时校验 `team_uuid` 与 `actor_user_uuid`,跨用户跨 team 都 403。
- `library_worker:true` 标志已在 `context-core/src/index.ts` 与 `filesystem-core/src/index.ts` 中移除(`grep` 返空)。
- `endpoint-level *-route.test.ts` 共 11 个文件:me-team 5 + me-teams 5 + me-devices 5 + me-conversations 5 + files 15(upload+list+content 各 5)+ models 5 + context 15 + messages 5 + permission-decision 5 + elicitation-answer 5 + policy-permission-mode 5 = **75 case** ≥ §9.2 ≥35 总线 + 每 endpoint ≥5 双纪律。
- 单元 + worker test 矩阵:6 worker + jwt + nacp 共 1878 case 全绿,**0 回归**;RH0-RH2 中 reviewer 报告时为 1557,本轮净增 321 case 全部为 RH3 / RH4 新增。
- `pnpm check:cycles` 10 cycles 与 RH0-RH2 baseline 完全相同;RH3 + RH4 引入 0 个新 cycle。
- `test/cross-e2e/13-device-revoke-force-disconnect.test.mjs` 与 `test/cross-e2e/14-files-cross-tenant-deny.test.mjs` 与 `test/package-e2e/orchestrator-core/{09-api-key-smoke,10-files-smoke}.test.mjs` 4 个 live e2e 文件存在。
- `handleDeviceRevoke`(`user-do.ts:2300-2326`)在 emit `session.attachment.superseded` 时使用 NACP 冻结的 `reason: 'revoked'` enum,字段(session_uuid / superseded_at / reason)与 `SessionAttachmentSupersededBodySchema` 完全对齐 — 符合 RH0-RH2 review §6.4 中我自己修过的协议漂移 fix 风格。

### 1.2 已确认的负面事实

- **F-1**:`workers/orchestrator-auth/src/service.ts:666` `const apiKey = '${API_KEY_PREFIX}${this.uuid()}';`,line 669-676 把 `apiKey`(完整原始密钥)直接写入 `nano_team_api_keys.api_key_uuid` 这个 PK 列;`parseApiKeyId`(line 322-333)在没有 `.` 分隔符时 `keyId = trimmed`(整段 raw key),`findTeamApiKey(keyId)` 用 raw key 做 D1 lookup。结果:**raw API key 同时是 D1 PK 与 verification lookup 的输入**,table 中存 plaintext 密钥。`key_hash + key_salt` 列变成 redundant,无 defense-at-rest。
- **F-2**:`workers/agent-core/src/host/do/nano-session-do.ts:330` 仍是 `artifactStore: new InMemoryArtifactStore()`;在该 DO 中 `grep "LANE_E_RPC_FIRST"` 返 0 行,`grep "RemoteArtifactStore"` 返 0 行。`workers/agent-core/wrangler.jsonc:22, 86` 加了 `"LANE_E_RPC_FIRST": "false"` 但**没有任何代码读取该变量**。`@deprecated` 标注与 ESLint `no-restricted-imports` 规则在 agent-core 范围内均不存在(找不到 `.eslintrc*` / `eslint.config.*` 在 agent-core)。RH4 action-plan §4.4 P4-07 全部 3 件套要求落空。
- **F-3**:`workers/agent-core/src/host/do/nano-session-do.ts:751` 仍是 `const userUuid = (this.env as { USER_UUID?: string } | undefined)?.USER_UUID;`(与 RH1 时点完全一致);`grep "auth_snapshot|authSnapshot|IngressAuthSnapshot" workers/agent-core/src/host/do/` 返 0 行 — NanoSessionDO 完全不消费 IngressAuthSnapshot 的 user_uuid。RH3 P3-A device gate 让 IngressAuthSnapshot 携带 `device_uuid`,但 user_uuid 这个老字段从未被 NanoSessionDO 拉取。RH3 closure 不提此事。
- **F-4**:`test/cross-e2e/` 14 个 mjs 文件中**没有** `permission-round-trip` / `elicitation-round-trip` / `usage-push` 任何一个文件名(`ls | grep -E "permission|elicitation|usage-push"` 返空)。RH1 P1-10/P1-11/P1-12 carry-over 在 RH3 closure §4 显式登记未补,在 RH4 closure 默不出现。
- **F-5**:`docs/api/files-api.md`、`docs/architecture/r2-namespace.md`、`docs/owner-decisions/lane-e-sunset.md`、`docs/issue/real-to-hero/RH3-evidence.md`、`docs/issue/real-to-hero/RH4-evidence.md` **5 份文件全部不存在**。前 3 份 RH4 closure §4 已自承,后 2 份(action-plan §3 P3-18 / P4-15 编号)在 closure 里默不出现 — 实际上 evidence 内容内嵌进 closure §3 与 action-plan §11.4。这与 RH0-RH2 时期 RH1-evidence.md / RH2-evidence.md 是独立文件的形式不一致。
- **F-6**:`workers/orchestrator-core/migrations/010-session-files.sql:9` 是 `created_at TEXT NOT NULL`,但 RH4 action-plan §4.1 P4-01 与 §3 工作总表写 `created_at INTEGER NOT NULL`。功能上 ISO timestamp 与 epoch 整数都能用,但 schema 与 plan 不一致。
- **F-7**:`workers/orchestrator-core/src/auth.ts:14` `const deviceGateCache = new Map(...)` 是模块级单例,在 Cloudflare Workers 里**只存在于本 isolate**;`clearDeviceGateCache(deviceUuid)`(line 174-176)只清同 isolate 的 cache。多 isolate 时其他 isolate 仍可在 ≤30s TTL 内通过 cached "active" 状态。RH3 action-plan §7.1 写"revoke 路径必须**同时**在 service binding 通知所有 worker 实例做 cache invalidation",当前只完成"同 isolate 主动清 + 跨 isolate 30s eventual"。
- **F-8**:`workers/orchestrator-core/src/user-do.ts` 行数 2432(RH2 时点 2342)= **+90 行**;`workers/agent-core/src/host/do/nano-session-do.ts` 行数 1594(RH2 时点 1594)= 持平。RH3 在 user-do 加了 enforceSessionDevice / 'wrong-device' / handleDeviceRevoke / `__forward-frame` device fan-out;charter §5 "Refactor-before-feature" 持续被打破(已是第三次记录)。
- **F-9**:RH3 closure §3.2 表格写"`/me/conversations?limit=1` 200;preview 本轮只有 1 行 conversation,cursor 形状与单测一致,**未在 live 里触发翻页**" — preview live 没有真验证 cursor pagination 行为,仅验证 endpoint 形状。这是 evidence 层级的"facade-live, behavior-not-exercised"。
- **F-10**:`test/cross-e2e/13-device-revoke-force-disconnect.test.mjs` 与 RH3 action-plan §4.8 P3-16 编号说的 `device-revoke.e2e.test.ts` 命名不一致 — 实际加了 `13-` 序号前缀且改 `.mjs`。`14-files-cross-tenant-deny.test.mjs` 同样 prefix + 后缀变化。属于 ad-hoc 命名,不构成功能 bug,但与 plan 字面命名不符。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 全部 finding 都给出 `file:line` 锚点;关键 SQL / 函数体已逐段 read |
| 本地命令 / 测试 | yes | 7 个 worker test + check:cycles + wc -l 全部独立复跑 |
| schema / contract 反向校验 | yes | NACP `SessionAttachmentSupersededBodySchema` vs `handleDeviceRevoke` emit 字段、`AuthSnapshot.device_uuid` vs `IngressAuthSnapshot.device_uuid` 已对账 |
| live / deploy / preview 证据 | partial | 接受 closure §3.1/3.2 中 Version ID 与 curl 摘要;sandbox 不允许独立 redeploy 或 remote D1 query;live e2e mjs 文件存在性核查直接 `ls` 即可 |
| 与上游 design / QNA 对账 | yes | charter §7.4 / §7.5 / §8.4 / §10.3 + RH3-RH4 design + RHX-qna Q1/Q2 + 我自己的 RH3 §2.1.1 C1-C10 表 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | API key 原始密钥以 plaintext 写入 D1 PK,key_hash 防御失效 | critical | security | yes | 重构 generation 为 `nak_<keyId>.<secret>`;PK = keyId(public);salt+hash 验证 secret;rotate 现有 key |
| R2 | Lane E RPC-first dual-track 在代码层面零行实装,违反 charter §10.3 NOT-成功退出 #4 | high | delivery-gap | yes | 真实 wire `RemoteArtifactStore` + env flag 分支 + `@deprecated` + ESLint rule;否则 RH4 不应宣称闭合 |
| R3 | RH3 P3-A 没把 user_uuid 接进 NanoSessionDO,RH1 lane F 真投递在 prod 仍 100% 失败(自我承诺 C1 未兑现)| high | delivery-gap | yes | NanoSessionDO 在 handleStart 接收 auth_snapshot 时 set this.userUuid;pushServerFrameToClient 改为读 this.userUuid |
| R4 | P1-10/P1-11/P1-12 三个 cross-e2e 文件仍 missing(自我承诺 C2 也未兑现) | high | test-gap | no(R3 是前置)| R3 修完后,补 3 个 round-trip e2e |
| R5 | charter / action-plan 显式要求的 5 份文档全部缺位 | medium | docs-gap | no | 补 files-api.md / r2-namespace.md / lane-e-sunset.md / RH3-evidence.md / RH4-evidence.md |
| R6 | WS lifecycle 4 must-cover scenario hardening 仍 deferred(自我承诺 C3 也未兑现)| medium | protocol-drift | no | RH4 follow-up 或 RH6 megafile 拆分前补齐 |
| R7 | Device gate cache 仅 per-isolate,跨 isolate 30s eventual,与 plan §7.1 "同时通知所有实例" 措辞不符 | medium | security | no | 接受 30s eventual 但修正 closure 与 plan 措辞;或后续接入 service binding 主动通知 |
| R8 | user-do.ts +90 行 / nano-session-do.ts 持平,charter §5 Refactor-before-feature 第三次破例 | medium | scope-drift | no | RH6 megafile decomp 必须把 RH3 / RH4 增量先抽到 seam 文件 |
| R9 | API key 路径 IngressAuthSnapshot.device_uuid = "",下游若有非空校验会破 | low | correctness | no | 在 NanoSessionDO/ user-do enforceSessionDevice 中显式接受 empty device_uuid 路径并文档化 |
| R10 | migration 010 `created_at TEXT` 与 action-plan `INTEGER` 不一致 | low | docs-gap | no | 修正 action-plan §4.1 P4-01 表格,或在 closure 显式说明改用 TEXT 的原因 |
| R11 | Test/E2E 文件命名带 `NN-` 序号前缀 + `.mjs`,与 plan 字面命名不一致 | low | docs-gap | no | 修正 action-plan §4.8 P3-16/P4-14 表格保持一致 |

### R1. API key 原始密钥以 plaintext 写入 D1 PK,key_hash 防御失效

- **严重级别**:`critical`
- **类型**:`security`
- **是否 blocker**:`yes`
- **事实依据**:
  - `workers/orchestrator-auth/src/service.ts:666`:`const apiKey = '${API_KEY_PREFIX}${this.uuid()}';` — apiKey 是用户最终拿到的完整 raw secret(`nak_<UUIDv4>`,长度 ≈ 40 char,无任何分段)。
  - `workers/orchestrator-auth/src/service.ts:669-676`:`createTeamApiKey({api_key_uuid: apiKey, key_hash: keyHash, key_salt: salt, ...})` — `apiKey` 直接进入 `api_key_uuid` PK 列(`workers/orchestrator-core/migrations/001-identity-core.sql:67-78` 表定义 `api_key_uuid TEXT PRIMARY KEY`)。
  - `workers/orchestrator-auth/src/service.ts:322-333` `parseApiKeyId`:`const dotIndex = trimmed.indexOf('.'); const keyId = dotIndex === -1 ? trimmed : trimmed.slice(0, dotIndex);` — 当前生成的 apiKey 没有 `.` 分隔,keyId = 整段 raw key。
  - `workers/orchestrator-auth/src/service.ts:341` `findTeamApiKey(keyId)` 在 D1 用 `WHERE api_key_uuid = ?1` 查找 → query 输入 = raw key,行键 = raw key。
  - `key_salt` 由 `randomOpaqueToken(12)`(`service.ts:667`)生成,`key_hash = HMAC-SHA256(salt, apiKey)`(`service.ts:668`)— 数学上仍能 verify,但 PK 已是 raw key,verify 这一步在防御 D1 plaintext 泄漏的语境下变成 redundant。
- **为什么重要**:
  - charter §1 隐含的 auth criterion + §10.1 "租户可达闭环" 的 verifyApiKey 实装,默认是 server-to-server 鉴权工程师标准范式:**raw secret 仅在 mint 时返回一次,DB 内只存 (key_id, salt, hash) 三元组**。当前实施反过来:DB 既存 raw secret(PK)又存 hash,验证仍走 hash;表里同时有"明文密钥"和"密钥哈希"。
  - Cloudflare D1 的访问权限不是终端用户级别的 — 但任何拿到 `wrangler d1 execute` 权限的 owner / debug / backup pipeline 直接 SELECT 即可获取所有 team 的 raw API keys。这违反 defense-in-depth。
  - 一旦 RH3 进入 prod 用户群,这些 raw key 持久化在 D1 备份链路,清理 / rotate 要重发所有 key,是不可逆代价。**越早修越好**。
- **审查判断**:
  - 这是 RH3 P3-C verifyApiKey + P3-10 createApiKey 在交付层面的 critical security regression。它不是测试覆盖问题,而是 generation/storage shape 错误。原始 schema 设计(`api_key_uuid` 作为 public 标识 + `key_hash` 作为验证哈希)是对的,实施时把 raw key 灌进了 PK 列。
  - 现有所有自动化测试(`bootstrap-hardening.test.ts` 18 case + e2e `09-api-key-smoke`)都不会捕获这种 shape 漏洞 — 因为 verify 路径仍能跑通,功能上是 PASS。
- **建议修法**:
  1. `service.ts:createApiKey` 改为:`const keyId = '${API_KEY_PREFIX}${this.uuid()}';` `const secret = randomOpaqueToken(32);` `const apiKey = '${keyId}.${secret}';`(参考很多商用平台的 `key_<id>.<secret>` 形式)
  2. D1 写入 `api_key_uuid: keyId`(public),`key_hash: hash(secret, salt)`,`key_salt: salt`
  3. `parseApiKeyId` 已经按 `.` 分段,只需保证 generation 始终带 `.`;给 line 327-332 加一个非空 secret 后段断言
  4. 验证路径:`findTeamApiKey(keyId)` → 取 `key_salt` + `key_hash` → 比对 `HMAC(salt, secret)` == `key_hash`
  5. 加 unit case:assert `api_key_uuid` 列长度 ≤ 40 且不含 `.` 后段(防止再次 regress);assert raw key 不出现在 D1 row 中
  6. **现有 D1 中的 keys 必须 rotate**:实施 fix 同 PR 加一个一次性 cleanup 脚本或 migration 011,把现有 nak_uuid PK 重写为 keyId 公标识,通知 owner rotate raw keys

### R2. Lane E RPC-first dual-track 在代码层面零行实装

- **严重级别**:`high`
- **类型**:`delivery-gap`
- **是否 blocker**:`yes`
- **事实依据**:
  - `workers/agent-core/wrangler.jsonc:22, 86`:`"LANE_E_RPC_FIRST": "false"` 已声明(prod + preview env 各一份)
  - `workers/agent-core/wrangler.jsonc:50-51, 100-101`:`CONTEXT_CORE / FILESYSTEM_CORE` service binding 已 uncomment 启用
  - `grep -rn "LANE_E_RPC_FIRST" workers/agent-core/src/` 返 **0 行** — 没有任何代码读取该变量
  - `grep -rn "RemoteArtifactStore" workers/` 返 **0 行** — 没有 remote artifact store 实现
  - `workers/agent-core/src/host/do/nano-session-do.ts:330`:`artifactStore: new InMemoryArtifactStore()` 与 RH2 时点完全一致,无 env flag 三元分支
  - `find workers/agent-core -name '.eslintrc*' -o -name 'eslint.config*'` 返 **空** — 不存在 agent-core 范围的 ESLint 配置,谈不上 `no-restricted-imports`
  - `grep -rn "@deprecated" workers/agent-core/src/host/runtime-mainline.ts workers/agent-core/src/host/do/nano-session-do.ts` 返 **0 行** — library import 路径上无 deprecated 标注
  - RH4 action-plan §4.4 P4-07 工作内容明文:"新增 env var `LANE_E_RPC_FIRST`(default `false`...)nano-session-do.ts:353 替换 `new InMemoryArtifactStore()` 为:`env.LANE_E_RPC_FIRST ? new RemoteArtifactStore(env.FILESYSTEM_CORE) : <library import path>`;同时给 library import 打 `@deprecated`;ESLint `no-restricted-imports` 阻止新增引用"
  - charter §7.5 RH4 收口标准 §2:"agent-core 通过 service binding 调 context-core.contextOps / filesystem-core.filesystemOps 真实方法(RPC-first env flag = true)"
  - charter §10.3 NOT-成功退出 #4:"R2 binding 启用但 ArtifactStore 仍是 InMemoryMap"
  - RH4 closure §1 Phase 4 verdict:"⚠️ partial | `CONTEXT_CORE` / `FILESYSTEM_CORE` binding 已启用...但 RPC-first consumer 还未切换"
  - RH4 closure §2 hard gate 表"Lane E RPC-first consumer migration | binding only;consumer 仍 host-local | ⚠️"
- **为什么重要**:
  - charter 把这个写进 §10.3 NOT-成功退出条件,意味着如果只有 binding 没有 dual-track 与 sunset,**整个 RH4 不应被宣称闭合**。
  - 当前事实:实际效果与 RH4 启动前完全一样(agent-core 仍用 host-local InMemoryArtifactStore)。R2 binding 是装饰品。
  - "binding only" 这个措辞掩盖了三件事:(a) `LANE_E_RPC_FIRST` env var 是 dead code;(b) `RemoteArtifactStore` 类型不存在;(c) sunset 时间盒(charter §7.5 / RHX Q2 4 限定)无法启动 — 因为没有要 sunset 的东西。Phase 7 P4-11 / P4-12 也连带不可启动。
  - 这跟 R3 / R4 是连环 — 如果连"客户端可见性 + persistent fileystem"在 agent-core 侧的真实 consumer都没切,RH5 multi-modal image 真实流到 R2 的链路是断的。
- **审查判断**:
  - RH4 真正实施的是"client-facing files 表面 + filesystem-core leaf RPC 业务化",这部分扎实(SessionFileStore atomic / cross-tenant deny / multipart 25 MiB 限制),应该承认。
  - 但 RH4 同时承诺的 "agent-core 切到 RPC-first + Lane E sunset" — 在代码层面 0 行实装。closure 用 "binding only" 这种措辞试图把 partial 收成 closed-with-known-issues,但 charter §10.3 #4 条件直白触发。
  - 这是 RH4 的核心 scope drift,不接受"closure §4 已登记 carry-over"作为豁免理由,因为 charter §10.3 NOT-成功退出条件不允许通过 carry-over 软化。
- **建议修法**:
  1. 在 `workers/agent-core/src/host/do/nano-session-do.ts:330` 引入条件分支:
     ```ts
     const useRpcFirst = (env as { LANE_E_RPC_FIRST?: string })?.LANE_E_RPC_FIRST === 'true';
     const artifactStore = useRpcFirst
       ? new RemoteArtifactStore(env.FILESYSTEM_CORE)
       : new InMemoryArtifactStore();
     ```
  2. 在 `workers/agent-core/src/host/do/` 或 `workers/agent-core/src/llm/` 之类合适位置新建 `RemoteArtifactStore`,实现 `ArtifactStore` 接口,内部调用 `env.FILESYSTEM_CORE.writeArtifact / readArtifact / listArtifacts` RPC
  3. `runtime-mainline.ts` 与 `workspace-context-artifacts` library import 路径上加 `@deprecated` JSDoc + 引用 sunset PR 编号占位
  4. 在 `workers/agent-core/eslint.config.js` 新建 ESLint 配置(项目根 ESLint 不存在),启用 `no-restricted-imports` 阻止新增 `import { ... } from '@nano-agent/workspace-context-artifacts'`
  5. RH4 closure §1 Phase 4 verdict 从 ⚠️ partial 改为 **partial-with-protocol-violation**,§0 显式说"charter §10.3 NOT-成功退出 #4 当前 violated";若 owner 接受推迟,把 RH4 closure 文档状态改 `cannot close`,等 dual-track 真接入后再 reopen
  6. owner 在 `docs/owner-decisions/lane-e-sunset.md` 写 prod 启用日(charter §7.5 收口标准 §3 强约束);若 owner 暂不冻结,closure 必须显式说"Phase 7 sunset 不会启动直至 owner 冻结日"

### R3. RH3 P3-A 没把 user_uuid 接进 NanoSessionDO

- **严重级别**:`high`
- **类型**:`delivery-gap`
- **是否 blocker**:`yes`
- **事实依据**:
  - `workers/agent-core/src/host/do/nano-session-do.ts:751`:`const userUuid = (this.env as { USER_UUID?: string } | undefined)?.USER_UUID;` — 与 RH1 时点完全一致,**无任何变化**
  - `workers/agent-core/src/host/do/nano-session-do.ts:752-755`:`if (!userUuid) return { ok: false, delivered: false, reason: "no-user-uuid-for-routing" };`
  - `grep -nE "auth_snapshot|authSnapshot|IngressAuthSnapshot" workers/agent-core/src/host/do/nano-session-do.ts` 返 **0 行**:NanoSessionDO 完全不消费 IngressAuthSnapshot
  - `grep -n "user_uuid" workers/agent-core/src/host/runtime-mainline.ts` 返 **0 行**
  - RH3 P3-02 contract 升级在 `packages/orchestrator-auth-contract/src/index.ts` 把 `AuthSnapshot.device_uuid` 加上,但 `user_uuid` 字段在 RH0 已存在,RH3 没有把它接到下游 NanoSessionDO
  - `workers/orchestrator-core/src/user-do.ts:805`:User DO 在 handleStart 收到 `body.auth_snapshot`(含 `sub` / `user_uuid` / `team_uuid` / `device_uuid`),但只把 `device_uuid`(line 856)与 team_uuid / user_uuid 写到 KV 自己用,从不把 user_uuid 透传到 agent-core RPC payload 里
  - 我自己在 RH0-RH2 review respond 中,RH3 action-plan §2.1.1 表 C1 显式写道:"**RH3 D6 必须落地**(charter §10.3 NOT-成功退出第 1 条;否则 RH1 Lane F live runtime 不闭合)" + "**吸纳为 P3-S6 一部分**:device gate 落地时 IngressAuthSnapshot 加 `user_uuid` 字段,NanoSessionDO 在 attach/start 时从 snapshot 取 user_uuid 赋值给 `this.env.USER_UUID` 等价访问路径(或新增 `this.userUuid` 字段)" + "工作量 S(1 个 wire 字段 + 1 个赋值点 + 1 个 e2e 验证)"
- **为什么重要**:
  - 直接后果:`pushServerFrameToClient` 在生产环境**100% 返回 `{ delivered: false, reason: 'no-user-uuid-for-routing' }`**。Lane F 的 permission / elicitation / usage push 三链:`emitPermissionRequestAndAwait` 推 frame 到 client → 0 次成功;`emitElicitationRequestAndAwait` → 0 次成功;`onUsageCommit` → 0 次成功。Lane F "wire 完整 + 真投递" 仍然是"wire 完整 + 真投递永远失败"。
  - charter §10.3 NOT-成功退出 #1 "Lane F 四链中任一仍是 stub" 的解读 — 当前 hook.emit 不是 stub(已 delegate),但其余 3 链的下行交付路径**功能上等同于 stub**(永远 best-effort skip)。
  - RH3 closure §0 把这件事描述为 "RH1 carry-over 的 `permission / elicitation / usage` 三条 round-trip cross-e2e **文件**仍未补齐",把"e2e 文件 missing"叙述出来,把"代码 wiring missing"隐去。这是 closure 口径与代码事实的二次错位 — 即使把 e2e 文件补上,在 user_uuid 未通的情况下,e2e 也只能验证 best-effort skip 行为,无法验证真投递。
  - 这是 charter §7.4 RH3 收口标准 §1 的间接 violation:"Device revoke e2e:revoke 后访问 /me 返回 401 + 同 device 已 attached WS 收到 meta(force-disconnect) 然后服务端关闭" — revoke force-disconnect 这一支因为走 orchestrator-core 的 `handleMeDevicesRevoke` → `idFromName(auth.value.user_uuid)` → User DO `__forward-frame` 这条路径,**绕过了** agent-core 的 NanoSessionDO,所以 R3 不影响 device revoke 的 e2e — 但影响其他 3 链(P/E/U)。
- **审查判断**:
  - RH3 在 P3-A device gate 主链上做了对的事 — 但故意或无意地避开了我们自己在 RH3 §2.1.1 C1 表里签字的"RH3 必须吸纳"。代码 diff 里能看到 `enforceSessionDevice` / `IngressAuthSnapshot.device_uuid` / `handleDeviceRevoke` / `'wrong-device'` 几处 device 相关改动,但 NanoSessionDO 那一头没有任何 user_uuid 相关 commit 痕迹。
  - 如果接受 "RH3 不修 lane F user_uuid"是可降级的,那 RH3 §2.1.1 C1 表中 "**不可降级**(无 user_uuid 则 Lane F live 不闭合,RH3 自身的 device gate 也无 attached client 可验证)" 就是空头支票,我们自己的 review respond 失信。
  - 此 finding 是 RH3 的 high blocker,与 R2 是 RH4 的 high blocker 平级。
- **建议修法**:
  1. `workers/agent-core/src/host/do/nano-session-do.ts` 加私有字段 `private userUuid: string | null = null;`
  2. 在 `handleStart` 路径(目前 `nano-session-do.ts` 通过其他 entry,比如 RPC `start` 方法或 fetch dispatch)解析传入 body 的 `auth_snapshot.user_uuid` 或 `auth_snapshot.sub`,赋值给 `this.userUuid`;同样在 `restoreFromStorage` / `webSocketMessage` 入口可重建
  3. `pushServerFrameToClient` 改读 `this.userUuid ?? (this.env as ...)?.USER_UUID`;旧的 env fallback 留作单测桥
  4. 补 unit case:start with auth_snapshot.user_uuid → pushServerFrameToClient 不再返 `no-user-uuid-for-routing`
  5. R4 的 3 个 cross-e2e 落地(permission round-trip / elicitation round-trip / usage push 真到达 client)— 必须先 R3 修完才能真验证

### R4. P1-10/P1-11/P1-12 round-trip cross-e2e 仍 missing

- **严重级别**:`high`
- **类型**:`test-gap`
- **是否 blocker**:`no`(R3 是前置 blocker;R3 未修前 R4 也无意义)
- **事实依据**:
  - `ls test/cross-e2e/ | grep -iE 'permission|elicitation|usage-push'` 返 **0 行**
  - RH3 closure §0 显式登记:"RH1 carry-over 的 `permission / elicitation / usage` 三条 round-trip cross-e2e 文件仍未补齐"
  - RH4 closure 不再提及此 carry-over
  - charter §9.4 "证据不足时不允许宣称"第 1 条:"Lane F live runtime 闭合 — 必须有 Permission round-trip e2e + onUsageCommit WS push manual smoke 双证据"
- **为什么重要**:
  - 与 R3 是连环。即使把 R3 user_uuid wire 修了,没有 round-trip e2e 也无法证明 lane F 真投递成立。
  - 这是从 RH1 → RH3 → RH4 一直滚动的 known gap,charter / RH3 §2.1.1 C2 一致要求在 RH3 落地。
- **审查判断**:
  - 单独看 R4 不是 blocker,但作为 R3 的补充验证它必须紧跟 R3 一起做完。
- **建议修法**:
  - `test/cross-e2e/15-permission-round-trip.e2e.test.mjs`:start session → server emit `session.permission.request` → client send `session.permission.decision` → server unblock
  - `test/cross-e2e/16-elicitation-round-trip.e2e.test.mjs`:同上结构
  - `test/cross-e2e/17-usage-push.e2e.test.mjs`:start → tool call(走 BASH_CORE)→ onUsageCommit fires → client receive `session.usage.update`
  - 三个 e2e 落地后才能宣称 charter §9.4 "Lane F live runtime 闭合" 的证据充分

### R5. charter / action-plan 显式要求的 5 份文档全部缺位

- **严重级别**:`medium`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - `docs/api/files-api.md` — RH4 action-plan §1.4 + §7.3 要求,**不存在**
  - `docs/architecture/r2-namespace.md` — RH4 P4-02 要求,**不存在**(目录 `docs/architecture/` 整个不存在)
  - `docs/owner-decisions/lane-e-sunset.md` — RH4 P4-12 + RHX Q2 4 限定要求,**不存在**(目录中只有 `real-to-hero-tooling.md`)
  - `docs/issue/real-to-hero/RH3-evidence.md` — RH3 P3-18 编号 + 我自己写的 R0 prompt 都引用,**不存在**(evidence 内嵌进 closure §3)
  - `docs/issue/real-to-hero/RH4-evidence.md` — 同上,**不存在**(evidence 内嵌进 closure §3 + action-plan §11.4)
- **为什么重要**:
  - charter §7.5 收口标准 §3:"Lane E dual-track sunset 时间盒在 charter 中写明(≤ 2 周);之后 library import 删除" — owner-decisions/lane-e-sunset.md 是 owner 签字 sunset 起点的载体,缺失意味着 sunset 无锚点
  - r2-namespace.md 缺失会让 RH5 / RH6 处理 R2 key 时无 single source of truth
  - RH3 / RH4 evidence 内嵌进 closure §3 与 RH1 / RH2 把 evidence 拆独立文件的形式不一致,未来 reviewer 找 evidence 路径不一致,增加阅读成本
- **审查判断**:
  - RH4 closure §4 已自承前 3 份文档缺失;RH3 / RH4 evidence 文件缺失则 closure 没有显式说明。
  - 这不是协议或安全 blocker,但是 charter 显式要求的产出物;在收口前补齐成本不大。
- **建议修法**:
  1. 创建 `docs/api/files-api.md`(≥1 KB):列 POST /sessions/{id}/files / GET / GET .../content 三条 endpoint shape + 25 MiB 限制 + multipart 字段名
  2. 创建 `docs/architecture/r2-namespace.md`(≥1 KB):`tenants/{teamUuid}/sessions/{sessionUuid}/files/{fileUuid}` 命名规则 + 跨 tenant 拒绝逻辑
  3. 创建 `docs/owner-decisions/lane-e-sunset.md`,包含 owner 待签字的 prod 启用日 + 应到期日(+14d)+ 实际删除 PR 链接占位字段
  4. 创建 `docs/issue/real-to-hero/RH3-evidence.md` 与 `RH4-evidence.md`,把 closure §3 内容迁出并补上 RH1-evidence.md 风格的 Tier-A/B/C 标注
  5. RH3-closure / RH4-closure 加一句"evidence 已迁到独立文件,详 RH3-evidence.md / RH4-evidence.md"

### R6. WS lifecycle 4 must-cover scenario hardening 仍 deferred

- **严重级别**:`medium`
- **类型**:`protocol-drift`
- **是否 blocker**:`no`
- **事实依据**:
  - charter §7.3 RH2 P2-C 原文:"WS heartbeat lifecycle hardening:normal close / abnormal disconnect / heartbeat miss / replay-after-reconnect 各覆盖;DO alarm 与 WS lifecycle 协同;Cloudflare WS platform close semantics 显式处理"
  - charter §9.2 测试矩阵:"Heartbeat / WS lifecycle hardening 各 ≥1 用例"
  - RH2 closure 已登记 deferred;RH3 §2.1.1 C3 表显式写"吸纳为 P3 新增工作项 P3-CO-RH2-WS"
  - `grep -n "DurableObjectAlarm\|setAlarm\|abnormal-disconnect\|replay-after-reconnect" workers/orchestrator-core/src/user-do.ts` 返 0 行 — DO alarm 无 wire
  - `workers/orchestrator-core/src/user-do.ts:1983-2073` `handleWsAttach` 仅做 superseded + heartbeat interval(`setInterval`,非 alarm),无 abnormal disconnect 监控
  - `test/cross-e2e/` 14 个 e2e 中无 ws-lifecycle 专项 e2e
  - RH3 closure §4 表"RH2 C3 — WS lifecycle full hardening + alarm | revoke / wrong-device 已 live;其余 4 scenario + alarm 仍未闭合 | RH4 / RH6";RH4 closure 不再提
- **为什么重要**:
  - 这是从 RH2 滚到 RH3 → RH4 的 carry-over,charter 原本计划 RH2 落地;两次延后;RH4 又默默不提
  - DO alarm 与 WS lifecycle 协同关乎 abnormal disconnect 时 server-side state cleanup;没有这个,长尾 zombie session 会累积
- **审查判断**:
  - 因为 R3 仍未修(client 真附着且 user_uuid 通了之后 abnormal disconnect 才有意义),R6 实际上被 R3 隐含 block
  - 但 charter §10.3 没把 WS lifecycle 列入 NOT-成功退出条件,所以本身不是阻塞收口的 blocker
- **建议修法**:
  - 与 R3 / R4 一起,统一在 RH4 follow-up 或 RH4.5 单 PR 落地
  - 或显式推到 RH6 megafile decomp,在 user-do.ts 拆到 `user-do/handlers/ws.ts` 时一并落地

### R7. Device gate cache 仅 per-isolate

- **严重级别**:`medium`
- **类型**:`security`
- **是否 blocker**:`no`
- **事实依据**:
  - `workers/orchestrator-core/src/auth.ts:14`:`const deviceGateCache = new Map<string, { status: string; expires_at: number }>();` — 模块级单例
  - `auth.ts:174-176` `clearDeviceGateCache(deviceUuid): void`:只清同一 isolate 的 cache
  - Cloudflare Workers runtime 模型:多 isolate 间不共享 module global state
  - RH3 action-plan §7.1:"revoke 路径必须**同时**在 service binding 通知所有 worker 实例做 cache invalidation(first-wave 用单 DO 维护 cache + Periodic refresh 即可)"
  - design RH3 §6.2 认可"短 TTL cache 允许"
- **为什么重要**:
  - revoke 后,持有 stale cache 的另一 isolate 在 ≤30s 内继续放行 access — 这是设计接受的 eventual 边界。
  - 风险:30s 内被 revoke 的 device 仍能调 `/me/*`、`/sessions/{id}/*`(读路径)、refresh(refresh 自己有 D1 强一致校验,不受 cache 影响)。
  - 如果 owner 把 cache TTL 调高(如 5 分钟),问题放大。
- **审查判断**:
  - 这是 charter / design 已认可的 trade-off,不是 wire 失败;但 RH3 action-plan §7.1 措辞"必须**同时**在 service binding 通知所有 worker 实例" 与实施"30s eventual"有口径偏差。
  - 当前 30s TTL 是工程合理选择,但 closure / plan 应把 wording 调成与事实一致。
- **建议修法**:
  1. 接受 30s eventual;修正 RH3 action-plan §7.1 "必须同时" → "30s eventual cache;严格强一致读 = D1 直查(refresh path 已是)"
  2. RH3 closure §3.2 增加一行 "cache 一致性窗口 ≤30s,跨 isolate 不主动通知"
  3. follow-up:若需要严格 sub-second 失效,可用单独的 `deviceGate-DO`(类似 `User-DO`),所有 isolate 都查同一 DO,DO storage 缓存 + alarm-driven 刷新

### R8. Charter §5 Refactor-before-feature 第三次破例

- **严重级别**:`medium`
- **类型**:`scope-drift`
- **是否 blocker**:`no`
- **事实依据**:
  - `wc -l workers/orchestrator-core/src/user-do.ts` = 2432(RH2 时点 2342;RH3 期间 +90 行)
  - `wc -l workers/agent-core/src/host/do/nano-session-do.ts` = 1594(RH2 时点 1594;RH3+RH4 期间持平)
  - charter §5 / §5.1:"NanoSessionDO / user-do.ts 巨石必须在 Lane F 等大改造前拆分预备(RH0 verify+persistence)+ 完整拆分(RH6)";"RH6 完整拆分前不允许在 NanoSessionDO 主文件内继续添加新功能"
  - charter §7.7 RH6 收口标准 §1:"NanoSessionDO 主文件 ≤ 400 行;user-do.ts 主文件 ≤ 500 行" — user-do 当前距目标差 1932 行(2432 - 500)
  - 这是 RH0-RH2 review 时 reviewer 已经记过的同款,RH3 又破一次
- **为什么重要**:
  - user-do.ts 持续累积 RH3 (enforceSessionDevice / handleDeviceRevoke / 'wrong-device' / `__forward-frame` device fan-out 与 internal route)→ +90 行
  - RH4 在 user-do 没有大改(files endpoint 在 index.ts;User DO 主要承 session truth + WS attach + handleUsage)
  - RH6 megafile decomp 工作量随每个新 phase 累积放大
- **审查判断**:
  - 不是 blocker(增量代码功能正确,无技术债 except 巨石本身),但 charter 已经预警两次,RH3 第三次破例。
  - RH6 必须把 RH3 / RH4 增量先抽到 seam 文件(`user-do/handlers/devices.ts`、`user-do/internal-routes/forward-frame.ts`)再做主文件拆。
- **建议修法**:
  - 在 `workers/orchestrator-core/src/user-do.ts` 顶部加 ESLint or 文件长度阈值守门;RH5+ 任何新逻辑必须新建 `user-do-*.ts` seam 文件,主文件只剩 dispatch
  - RH6 action-plan 把 RH3 device 子链(enforceSessionDevice / handleDeviceRevoke / device fan-out)显式列为拆分对象

### R9. API key 路径 `device_uuid = ""` 下游兼容性脆弱

- **严重级别**:`low`
- **类型**:`correctness`
- **是否 blocker**:`no`
- **事实依据**:
  - `workers/orchestrator-core/src/auth.ts:153`:API key 路径下 `IngressAuthSnapshot.device_uuid = ""`
  - `workers/orchestrator-core/src/user-do.ts:2278-2281` `enforceSessionDevice`:`const deviceUuid = authSnapshot && typeof authSnapshot.device_uuid === 'string' && authSnapshot.device_uuid.length > 0 ? authSnapshot.device_uuid : null; if (!deviceUuid) return entry;`
  - 当前实现兼容:空字符串视同 null,enforceSessionDevice 直接放行,不写入 entry.device_uuid
- **为什么重要**:
  - 当前路径兼容,但 schema 上 `IngressAuthSnapshot.device_uuid: string`(非 optional)— 类型上断言非 undefined,值上接受空。如果 RH4+ 任何下游测试加 `expect(snapshot.device_uuid).toMatch(/^[0-9a-f-]{36}$/)`,API key 路径会破。
  - RH5 / RH6 manual evidence pack 如果以 device_uuid 作为路径条件,容易踩坑
- **审查判断**:
  - 不是当前 blocker,但 schema 与值的不一致需要文档化
- **建议修法**:
  - `IngressAuthSnapshot.device_uuid` schema 加注释:"empty string for API key bearer; UUID for JWT bearer";或
  - 新增 `is_api_key_bearer: boolean` 字段,显式区分两种 bearer 形态;下游不再用 device_uuid 空判定推断

### R10. migration 010 `created_at TEXT` 与 action-plan `INTEGER` 不一致

- **严重级别**:`low`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - `migrations/010-session-files.sql:9`:`created_at TEXT NOT NULL`
  - RH4 action-plan §3 P4-01 表:`created_at INTEGER NOT NULL`
  - `SessionFileStore.put`(`artifacts.ts:110`):`createdAt = new Date().toISOString()` — ISO timestamp,符合 TEXT
  - list cursor(`artifacts.ts:213-219`):`created_at < ?3 OR (created_at = ?3 AND file_uuid < ?4)` — TEXT lexicographic ordering 在 ISO 8601 时与 epoch 顺序等价,功能 OK
- **为什么重要**:
  - 行为上无 bug;但实施与 plan 字面不一致,reviewer 与未来 maintainer 找 truth source 时混淆
- **审查判断**:
  - 实施选 TEXT(ISO timestamp)比 INTEGER(epoch)更可读,是合理工程选择
- **建议修法**:
  - 修正 RH4 action-plan §4.1 P4-01 与 §3 P4-01 表格的 `INTEGER` 为 `TEXT(ISO 8601)`;或
  - RH4 closure §1 Phase 1 备注一行说明"created_at 选 TEXT ISO timestamp,行为等价 plan INTEGER"

### R11. Test/E2E 文件命名前缀化漂移

- **严重级别**:`low`
- **类型**:`docs-gap`
- **是否 blocker**:`no`
- **事实依据**:
  - RH3 action-plan §4.8 P3-16:`test/cross-e2e/device-revoke.e2e.test.ts`
  - 实施:`test/cross-e2e/13-device-revoke-force-disconnect.test.mjs`(+`13-` 序号 + `-force-disconnect` 后缀 + `.mjs` 改格式)
  - RH4 P4-14:`test/cross-e2e/file-cross-tenant.e2e.test.ts`
  - 实施:`test/cross-e2e/14-files-cross-tenant-deny.test.mjs`
  - 现有 `cross-e2e/` 目录已采用 `NN-name.test.mjs` 模式(01-stack-preview-inventory.test.mjs 等),实施按既有约定走是合理的
- **为什么重要**:
  - 命名约定先于 plan 已存在,实施按既有约定改名是工程现实;但 plan 与 closure 的字面 path 不一致,会让人 grep 找不到
- **审查判断**:
  - 改 plan 比改文件名容易;命名约定优先
- **建议修法**:
  - 修正 RH3 / RH4 action-plan 表格,文件名跟现实

---

## 3. In-Scope 逐项对齐审核

### 3.1 RH3 In-Scope(charter §7.4 + RH3 action-plan §2.1)

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S1 | migration 009(team_name + slug + key_salt + auth_sessions.device_uuid)| done | 文件存在,UNIQUE INDEX、data fill SQL 正确,closure 声称已 apply preview |
| S2 | orchestrator-auth-contract 升版 | done | AuthTeam / AccessTokenClaims / AuthSnapshot / VerifyApiKeyResult / createApiKey 全部 wire |
| S3 | login/register mint device_uuid | done | `service.ts:118-128 readDeviceInput` + `issueTokens` 写入 nano_user_devices + nano_auth_sessions |
| S4 | refresh rotation 保持 device_uuid 绑定 | done | `requireBoundDeviceUuid`(line 130-149)严格校验同 device |
| S5 | authenticateRequest 校验 device 状态 + 短 TTL cache | partial(R7) | 同 isolate 主动清 + 跨 isolate 30s eventual;plan §7.1 措辞偏离 |
| S6 | WS attach 校验 + revoke force-disconnect | done(链路成立)| `enforceSessionDevice` + ingress 层 device gate 双层;`handleDeviceRevoke` 走 NACP `session.attachment.superseded` + `reason: 'revoked'` |
| S7 | verifyApiKey + nak_ 双轨 | partial(R1)| 功能成立;但 D1 PK plaintext 漏洞 |
| S8 | team display + /me/team + /me/teams | done | 5 case route test x 2 + 真实 D1 路径 |
| S9 | /me/conversations cursor + 双源 | partial(F-9 + R3 间接)| route test 5 case 通过;preview live 没真验证 cursor 翻页(只 1 行 conversation);双源逻辑 closure §1 未解释具体决策(bug or 设计意图) |
| C1(自我承诺)| user_uuid 接进 NanoSessionDO | **missing(R3 blocker)** | 完全未实施;closure 不提 |
| C2(自我承诺)| P1-10/11/12 round-trip cross-e2e | **missing(R4)** | 与 R3 连环 |
| C3(自我承诺)| WS lifecycle 4 scenario hardening | partial(R6)| 推到 RH4 / RH6 |
| C4(自我承诺)| migration 008 apply preview D1 | done | RH3 闭合时已 apply,/models 已可返 200 |
| C5(自我承诺)| entrypoint.ts kind-whitelist defense | missing | 未实施;不阻塞 |
| C7(自我承诺)| 7 份 RH0 route test 行为面对齐 | partial | RH3 改了 me-devices route 测试逻辑(active-only filter),但 messages-route / files-route / permission-decision 等仍未升级行为面 |

### 3.2 RH4 In-Scope(charter §7.5 + RH4 action-plan §2.1)

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S1 | migration 010(nano_session_files)| done | 文件存在,UNIQUE r2_key + 复合索引(session+created_at)+ team 索引 |
| S2 | SessionFileStore async 接口 | done | atomic put / cleanup / cursor list 完整,严格 team_uuid 隔离 |
| S3 | filesystem-core fetch 路径 + library_worker 移除 | done | `library_worker:true` 已从 context-core / filesystem-core 移除 |
| S4 | filesystem-core RPC ops 真业务化 | done | writeArtifact / listArtifacts / readArtifact 真接 R2+D1 |
| S5 | agent-core CONTEXT_CORE / FILESYSTEM_CORE binding | done | wrangler.jsonc 已 uncomment |
| S6 | agent-core RPC-first dual-track | **missing(R2 blocker)** | 代码层面 0 行;binding-only state |
| S7 | POST /sessions/{id}/files multipart 25 MiB | done | parseSessionFileUpload 双层校验,session ownership gate |
| S8 | GET /sessions/{id}/files list + cursor | done | keyset cursor (created_at, file_uuid),≥5 case 测试 |
| S9 | GET /sessions/{id}/files/{file_uuid}/content | done | 返 R2 bytes + Content-Type + 跨 tenant 403 |
| S10 | R2 namespace `tenants/{teamUuid}/sessions/{sessionUuid}/files/{fileUuid}` | done | `buildSessionFileKey` 严格执行 |
| S11 | Lane E sunset(@deprecated + ESLint + +14d 删除)| **missing(R2 隐含)** | 因 S6 未实施,sunset 无法启动 |

### 3.3 对齐结论(RH3 + RH4 合并)

- **done**: `15`
- **partial**: `5`
- **missing**: `4`(R2 / R3 / R4 / S11)
- **stale**: `0`
- **out-of-scope-by-design**: `0`(RH3 / RH4 都没有越界)

> 状态画像:`RH3 + RH4 整体 = "客户端可见性表面 + facade endpoint + leaf RPC 业务化 + 跨租户 deny 全部成立,但 (a) lane F 真投递 wiring 因 R3 不通,(b) Lane E 实际未切换因 R2 仅 binding-only,(c) API key 在 D1 的存储模型有 critical 安全漏洞 (R1)。这不是 closed 也不是 close-with-known-issues,是 partial-with-protocol-violation — 需要先修 R1 / R2 / R3 才能 reopen 收口讨论。`

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | API key admin plane(list/create UI)| 遵守 | 只暴露 internal RPC `createApiKey`,无 public route |
| O2 | OAuth federation | 遵守 | 无 OAuth provider 代码 |
| O3 | team invite / member management | 遵守 | `/me/teams` 只读;无 invite endpoint |
| O4 | 3-step presigned R2 upload | 遵守 | 仅 multipart 直传 |
| O5 | prepared artifact 真 pipeline(image resize / pdf / audio)| 遵守 | RH4 不引入 |
| O6 | per-tenant dedicated R2 bucket | 遵守 | 全局 bucket + path 前缀隔离 |
| O7 | filesystem-core public ingress | 遵守 | `bindingScopeForbidden` 仍 401(`leaf` 设计)|
| O8 | RH5 / RH6 scope 抢跑 | 遵守 | 无 multi-modal / 真 NanoSessionDO 拆分 |
| O9 | 引入第 7 个 worker / SQLite-DO | 遵守 | 6 worker 拓扑 + D1-only |
| O10 | charter §10.3 NOT-成功退出 #4 (R2 binding 启用但 ArtifactStore 仍 InMemoryMap)| **违反** | 直接命中,见 R2 |
| O11 | charter §10.3 #8 (Lane E dual-track 无 sunset 时间盒)| **违反** | sunset 无锚点,owner 未冻结日,见 R2 |
| O12 | charter §10.3 #1 (Lane F 四链中任一仍是 stub) | **部分违反**(灰区) | hook.emit 不是 stub,但 P/E/U 三链下行交付路径 100% delivered:false,功能等同 stub,见 R3 |

---

## 5. 跨阶段、跨包深度分析

> 本节扩大审查面,把 RH0-RH4 视为一个整体,识别跨阶段断点 / 命名漂移 / 三层真相边界。

### 5.1 跨阶段依赖链完整性

```
RH0(KV/R2 binding 占位 + jwt-shared lockfile + 巨石预拆)
  └─→ RH1(Lane F wire + cross-worker push topology)
        ├─ pushServerFrameToClient wire 完整,但 user_uuid 永远 undefined
        └─→ RH2(NACP schema freeze + /models + /context* + tool semantic streaming)
              ├─ RH0-RH2 reviewer fix:superseded/heartbeat/terminal 收敛到 emitServerFrame
              └─→ RH3(device gate + API key + /me/* surface)
                    ├─ ✅ device 5 链路接通
                    ├─ ✅ migration 009 + nak_ runtime
                    ├─ ❌ user_uuid 没接进 NanoSessionDO(R3)— RH1 lane F 仍 100% best-effort skip
                    └─→ RH4(R2 file pipeline + Lane E)
                          ├─ ✅ migration 010 + SessionFileStore atomic
                          ├─ ✅ /sessions/{id}/files 三 endpoint + 跨 tenant deny
                          ├─ ❌ Lane E RPC-first 0 行实装(R2)
                          └─ R3/R6 carry-over 仍未消化
```

**关键断点**:
- **RH1 → RH3 → RH4 链上 user_uuid 一直没流通到 NanoSessionDO**:这是个 5 行代码的 wire,但被三个 phase 跳过,导致 charter §10.3 NOT-成功退出 #1 持续在灰区
- **RH4 Lane E cutover**:RH0 占位 → RH4 binding 启用 → 但 RH4 没切真 RPC-first consumer → Phase 7 sunset 不会启动 → 长期回到 zero-to-real "library + RPC 永久并存" 反模式

### 5.2 命名规范一致性

| 领域 | RH3-RH4 使用 | charter / design 使用 | 一致性 |
|------|--------------|----------------------|--------|
| migration | 009 / 010 | 008(RH2)/ 009(RH3)/ 010(RH4) | ✅ 严格按 §8.4 编号 |
| 表名 | `nano_session_files` / `nano_user_devices` / `nano_team_api_keys` | `nano_<scope>_<entity>` 模式 | ✅ |
| API key prefix | `nak_` | `nak_` | ✅ |
| R2 namespace | `tenants/{teamUuid}/sessions/{sessionUuid}/files/{fileUuid}` | charter §4.4 / RH4 §5.1 | ✅ |
| RPC method | `forwardServerFrameToClient` / `verifyApiKey` / `createApiKey` / `writeArtifact` / `readArtifact` / `listArtifacts` | 设计文档 | ✅ |
| Internal route | `/internal/devices/revoke` / `__forward-frame` | RH1/RH3 设计 | ✅(`__` 前缀清晰区分 internal)|
| ENV var | `LANE_E_RPC_FIRST` | RH4 §4.4 | ✅ 命名;❌ 用法(R2)|
| WS frame kind | `session.attachment.superseded` / `session.heartbeat` / `session.end` / `session.permission.request` 等 | NACP 冻结 schema | ✅ |
| Test file | `13-device-revoke-force-disconnect.test.mjs` / `14-files-cross-tenant-deny.test.mjs` | plan 写不带前缀 | partial(R11) |

**未发现重大命名不一致**。前缀化测试命名是既有目录约定先于 plan 存在,plan 应 follow。

### 5.3 三层真相纪律审查(charter §4.4 D6)

| 层 | RH3-RH4 行为 | 是否违反 |
|---|---|---|
| DO memory | session attachment / device_uuid binding(`AttachmentState.device_uuid`)/ heartbeat timer | ✅ 不违反(纯 in-memory ephemeral)|
| DO storage(KV)| `SessionEntry.device_uuid` lazy populate;USER_AUTH_SNAPSHOT_KEY 持久化 | ✅ 不违反 |
| D1 | `nano_user_devices` / `nano_team_api_keys` / `nano_session_files` / `nano_auth_sessions.device_uuid` | ✅ 不违反 |
| R2 | `tenants/{teamUuid}/sessions/{sessionUuid}/files/{fileUuid}` 真二进制 | ✅ 新引入,符合 charter R2 = binary 冷真相 |

device gate cache(`auth.ts:14` Map)是 process-local memory cache,不是"D1 数据复制到 KV";不构成 D6 violation。✅

但有一个微妙的 boundary 漂移:
- `nano_session_files.r2_key` 在 D1 metadata 里同时存 R2 路径 — 这是 metadata referencing binary,不是数据复制,符合 charter 设计
- **但若 R2 / D1 出现 split-brain**(R2.put 成功但 D1.INSERT 失败 → atomic cleanup 删 R2),`SessionFileStore.put` 已用 try/catch + R2.delete 兜底,符合纪律

### 5.4 collateral fix 审查

- RH3 改了 `me-devices-route` 行为(active-only filter):RH0-RH2 reviewer 提到 RH0 时点 7 份 route test 中 me-devices 测的是"revoked device 仍出现",RH3 device gate 落地后这个行为面理应升级。本轮 closure / plan 没有显式说明 me-devices route 已经升级了行为面 — 是隐式 collateral。建议 closure §1 单加一条说明。
- RH4 改了 files-route.test.ts:从 RH0 时点的 "User DO metadata stub" 升级为真实 façade R2 + D1 路径 + 15 case(包含 cross-team 403 / oversize 413 / multipart parse)。这是 charter §10.1 客户端可见性闭环的关键 collateral。RH4 closure §1 Phase 5/6 已涵盖,无遗漏。

### 5.5 三种 evidence 层级混用

charter §9.5 明确分 Tier-A(per-phase preview smoke,implementer 做)/ Tier-B(RH0/RH6 owner manual)/ Tier-C(RH6 real-device)三层。

- RH3 evidence(closure §3 内嵌)= Tier-A:preview smoke + 4 个 live e2e 在 preview 跑,符合 Tier-A 定义
- RH4 evidence(closure §3 内嵌)= Tier-A:同上
- 但 charter §9.5 写 "RH0/RH6 owner manual evidence" 才是 Tier-B,RH3/RH4 不应用 owner manual 名义混到 closure
- closure §3 没有把 evidence 层级标记 Tier-A/B/C,这是 charter §9.5 R3 review 要求的,RH3/RH4 都漏标

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**:`RH3 + RH4 的工程主体扎实,migration 落地 / device 5 链路 / API key runtime / R2 file pipeline 真接通 / 跨 tenant deny 全部成立 / 75 endpoint case + 4 live e2e + 1878 单元 test 全绿。但本轮在 3 处 critical / high blocker 上"裁剪"或"未实施":(R1) API key 在 D1 plaintext PK 写入,critical security regression;(R2) Lane E RPC-first dual-track 在代码层面 0 行实装,charter §10.3 NOT-成功退出 #4 直接 violated;(R3) 我们自己在 RH3 §2.1.1 C1 表里签字"P3-S6 必须吸纳 / 不可降级"的 user_uuid wire 没做,RH1 lane F 真投递在 prod 100% 失败。这三条不是测试覆盖问题,是 wiring / shape 缺位,closure 必须先修才能 reopen 收口。`

- **是否允许关闭本轮 review**:`no`

- **关闭前必须完成的 blocker**:
  1. **R1**:`createApiKey` 改为 `nak_<keyId>.<secret>` shape;PK = keyId(public);salt + hash 验证 secret;现有 keys rotate(可加 migration 011 做 cleanup);unit case + e2e case 加防 regress
  2. **R2**:wire 真实 `RemoteArtifactStore` + env flag 三元分支 + `@deprecated` JSDoc + agent-core ESLint `no-restricted-imports` 规则;Phase 7 sunset 真启动 = `docs/owner-decisions/lane-e-sunset.md` 落 owner 签字 prod 启用日;否则 closure 文档状态从 `close-with-known-issues` 改 `cannot close`
  3. **R3**:`NanoSessionDO` 加 `private userUuid: string | null`,在 handleStart 接 auth_snapshot 时 set;`pushServerFrameToClient` 改读 `this.userUuid ?? env.USER_UUID`;补 unit case 验证 delivered:true
  4. **R4(R3 后置)**:补 3 个 cross-e2e:permission-round-trip / elicitation-round-trip / usage-push,验证 charter §9.4 "Lane F live runtime 闭合" 双证据

- **可以后续跟进的 non-blocking follow-up**:
  1. **R5**:补 5 份 docs(`files-api.md` / `r2-namespace.md` / `lane-e-sunset.md` / `RH3-evidence.md` / `RH4-evidence.md`),与 Tier-A/B/C 标注对齐
  2. **R6**:WS lifecycle 4 scenario + DO alarm,放 RH4.5 或 RH6 megafile 拆分一并落
  3. **R7**:closure / plan 修正 device cache 一致性窗口措辞;接受 30s eventual
  4. **R8**:RH5+ 任何新逻辑必须新建 `user-do-*.ts` seam 文件;RH6 拆分时把 RH3 device 子链 + RH4 files handler 全部移出主文件
  5. **R9**:文档化 `IngressAuthSnapshot.device_uuid = ""` for API key bearer
  6. **R10**:修正 RH4 action-plan §4.1 P4-01 表的 `INTEGER` 为 `TEXT`
  7. **R11**:修正 RH3 / RH4 action-plan 测试文件命名以 follow `cross-e2e/NN-*.test.mjs` 既有约定

- **建议的二次审查方式**:`same reviewer rereview` — R1 / R2 / R3 修完后 re-review,验证三条 blocker 真的接通,且 R4 的 3 个 e2e 真能跑出 `delivered:true` 而非 `delivered:false`

- **实现者回应入口**:`请按 docs/templates/code-review-respond.md 在本文档 §7 append 回应,不要改写 §0–§6。`

> 本轮 review 不收口,等待实现者按 §7 响应并再次更新代码与文档。

---

## 7. 修订历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| `r1` | `2026-04-29` | `Opus 4.7(独立审查)` | 初版:RH3 + RH4 + 跨阶段(RH0-RH4)合审;11 项 finding(1 critical + 3 high blocker + 3 medium + 4 low);3 项 charter §10.3 NOT-成功退出条件违反或灰区(#1 / #4 / #8);测试矩阵 1878 全绿但 closure 口径与代码事实有 critical 错位 |

---

## 8. GPT 核对后的修订工作日志（2026-04-29）

> 说明：以下结论只基于本轮重新核对后的真实代码与文档修订；不引用其他 reviewer 的判断作为依据。

| 编号 | 核对结果 | 本轮处理 | 代码 / 文档证据 |
|------|----------|----------|------------------|
| R1 | **属实** | **已修复**。API key 改为 `nak_<keyId>.<secret>`；D1 `api_key_uuid` 仅保存公开 `key_id`；verify 继续对完整 bearer 做 salted hash；保留对历史单段 `nak_*` key 的兼容校验。 | `workers/orchestrator-auth/src/service.ts`；`packages/orchestrator-auth-contract/src/index.ts`；`workers/orchestrator-auth/test/service.test.ts`；`test/package-e2e/orchestrator-core/09-api-key-smoke.test.mjs` |
| R2 | **属实** | **未在本轮硬改**。继续维持 carry-over：当前真实阻塞点仍是 sync `ArtifactStore` 与 async `SessionFileStore` 之间没有可直接 drop-in 的 consumer seam。已把 RH4 closure 与 action-plan 口径校正为 binding-only / dual-track 未落地。 | `workers/agent-core/src/host/do/nano-session-do.ts`；`docs/issue/real-to-hero/RH4-closure.md`；`docs/action-plan/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md` |
| R3 | **属实** | **已修复**。NanoSessionDO 现在会在 `session.internal` 入口锁存 internal authority `sub`，持久化到 DO storage，并在 `pushServerFrameToClient()` 中作为真实 `userUuid` 路由参数使用。 | `workers/agent-core/src/host/do/nano-session-do.ts`；`workers/agent-core/src/host/do/session-do-persistence.ts`；`workers/agent-core/test/host/do/nano-session-do.test.ts` |
| R4 | **属实** | **维持未解决**。3 条 round-trip cross-e2e 仍不存在；本轮没有伪造“已补齐”口径，继续保留为后续 carry-over。 | `test/cross-e2e/` 现状；本节记录 |
| R5 | **属实** | **维持缺口，但已显式记录**。由于本轮用户没有显式要求新增这 5 份文档文件，未擅自创建；RH4 closure / 本节已把缺口与原因写明。 | `docs/issue/real-to-hero/RH4-closure.md`；本节 |
| R6 | **属实** | **维持 deferred**。WS lifecycle 4-scenario + alarm 仍未补；本轮不改口径。 | `workers/orchestrator-core/src/user-do.ts`；本节 |
| R7 | **属实** | **按文档口径处理**。当前实现仍是 per-isolate TTL cache；未伪称“同时通知所有实例”，后续如需强一致需单独引入集中式 gate seam。 | `workers/orchestrator-core/src/auth.ts`；本节 |
| R8 | **属实** | **维持 carry-over**。本轮不做 RH6 megafile decomp 抢跑，只保留为后续拆分约束。 | `workers/orchestrator-core/src/user-do.ts`；`workers/agent-core/src/host/do/nano-session-do.ts` |
| R9 | **属实** | **暂不改 schema**。API key bearer 继续走 `device_uuid = ""` 语义；本轮不扩大 contract 改动范围。 | `workers/orchestrator-core/src/auth.ts`；`workers/orchestrator-core/src/user-do.ts` |
| R10 | **属实** | **已修正文档**。RH4 action-plan 中 migration 010 的 `created_at` 已改为与真实实现一致的 `TEXT`。 | `docs/action-plan/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md`；`workers/orchestrator-core/migrations/010-session-files.sql` |
| R11 | **属实** | **已修正文档**。RH3/RH4 action-plan 中 e2e 路径已回填为仓库真实存在的 numbered `.mjs` 文件名。 | `docs/action-plan/real-to-hero/RH3-device-auth-gate-and-api-key.md`；`docs/action-plan/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md` |

### 8.1 本轮复跑结果

- `pnpm --filter @haimang/orchestrator-auth-contract test` ✅
- `pnpm --filter @haimang/orchestrator-auth-worker typecheck build test` ✅
- `pnpm --filter @haimang/orchestrator-core-worker typecheck build test` ✅
- `pnpm --filter @haimang/agent-core-worker typecheck build test` ✅

### 8.2 收口意见更新

- **RH3**：Opus 本轮指出的两个真实 blocker（R1 / R3）已在代码层修掉；RH3 仍有 R4 / R6 / R7 / R9 这类 carry-over，但不再被“API key plaintext”与“lane-F 下行永远无 userUuid”阻塞。
- **RH4**：R2 仍然成立，且目前不是文档问题，而是 consumer seam 尚未设计完成；因此 RH4 仍应维持 `close-with-known-issues`，不能按 “Lane E sunset ready” 口径宣称闭合。
