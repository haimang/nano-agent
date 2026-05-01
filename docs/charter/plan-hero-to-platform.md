# Hero-to-Platform Charter — Inherited Issues Stub

> 阶段类型: `stub` — **不是**正式 charter
> 创建依据: `docs/issue/hero-to-pro/HP10-closure.md` Phase 4 P4-01；`docs/issue/hero-to-pro/hero-to-pro-final-closure.md` §7
> 冻结依据: `docs/design/hero-to-pro/HPX-qna.md` Q35
> 创建日期: `2026-05-01`
> 文档状态: `stub — handoff-ready, awaiting next-phase owner`

---

## 0. Stub 边界声明

**本文件是 stub，不是正式 charter。**

按 HPX-Q35 frozen，hero-to-platform stub **只**登记：

1. inherited issues（来自 hero-to-pro 阶段的 second-wave 与 retained items）
2. inherited Q ID frozen invariants
3. 边界声明（hero-to-pro 不再覆盖、hero-to-platform 必须从入口起独立决定的范围）

本文件**严禁**包含（HPX-Q35 frozen）：

- recommended approach / strategy
- timeline / milestone schedule
- proposed architecture
- implementation plan
- 任何形式的 "下一阶段应该这样做" 建议

正式 hero-to-platform charter 由该阶段的 owner / architect 在阶段启动时独立撰写，本 stub 不替代。

---

## 1. Inherited Issues from hero-to-pro Final Closure

详见 `docs/issue/hero-to-pro/hero-to-pro-final-closure.md` §4。共 22 项 `handed-to-platform` + 3 项 `retained-with-reason`（owner-action 时间窗）+ 5 项 `accepted-as-risk`。

### 1.1 22 Items `handed-to-platform`（按 phase 分组）

| Phase | Item ID | 简述 |
|-------|---------|------|
| HP2 | HP2-D1 | `<model_switch>` developer message 注入 |
| HP2 | HP2-D2 | `model.fallback` stream event 注册 + emit |
| HP2 | HP2-D3 | HP2 cross-e2e (5+ scenarios) |
| HP3 | HP3-D1 | `CrossTurnContextManager` runtime owner |
| HP3 | HP3-D2 | auto-compact runtime trigger |
| HP3 | HP3-D3 | strip-then-recover full contract |
| HP3 | HP3-D4 | compact 失败 3 次 circuit breaker |
| HP3 | HP3-D5 | 60s preview cache (Q12) |
| HP3 | HP3-D6 | HP3 cross-e2e (5+ scenarios) |
| HP4 | HP4-D1 | `POST /sessions/{id}/retry` route + attempt chain |
| HP4 | HP4-D2 | conversation_only restore public route + executor |
| HP4 | HP4-D3 | HP4 cross-e2e (6+ scenarios) |
| HP5 | HP5-D1 | PreToolUse emitter 侧 row-create |
| HP5 | HP5-D2 | HP5 round-trip cross-e2e (15-18) |
| HP6 | HP6-D1 | filesystem-core temp-file RPC（4 leaf） |
| HP6 | HP6-D2 | filesystem-core snapshot/restore/copy-to-fork RPC |
| HP6 | HP6-D3 | `/sessions/{id}/workspace/files/{*path}` public CRUD |
| HP6 | HP6-D4 | `/sessions/{id}/tool-calls` list/cancel |
| HP6 | HP6-D5 | artifact promotion / provenance |
| HP6 | HP6-D6 | cleanup jobs cron |
| HP6 | HP6-D7 | agent-core WriteTodos capability |
| HP6 | HP6-D8 | HP6 cross-e2e (6+ scenarios) |
| HP7 | HP7-D1 | restore/fork executor 真接线 |
| HP7 | HP7-D2 | `POST /sessions/{id}/checkpoints/{uuid}/restore` public route |
| HP7 | HP7-D3 | `POST /sessions/{id}/fork` public route |
| HP7 | HP7-D4 | TTL cleanup cron |
| HP7 | HP7-D5 | HP7 cross-e2e (6+ scenarios) |
| HP8 | HP8-D3 | heartbeat posture hardening + 4-scenario cross-e2e |
| HP8 | HP8-D4 | tool catalog consumer migration |
| HP9 | HP9-D1 | manual evidence pack 5 设备录制 |
| HP9 | HP9-D3 | 4-reviewer memos |

> 每项的 Q36 remove condition 见 final closure §4。

### 1.2 3 Items `retained-with-reason` (owner-action)

| ID | 项 | next review |
|----|---|-------------|
| HP8-D1 | R28 explicit register | 2026-05-15 |
| HP8-D2 | R29 verifier + postmortem | 2026-05-15 |
| HP9-D2 | prod schema baseline (owner remote run) | 2026-05-15 |

> 失守时升级为 `handed-to-platform`。

### 1.3 5 Items `accepted-as-risk`

详见 final closure §4.9。这些项**不需要** hero-to-platform 强制承接：

| ID | 项 |
|----|---|
| AR1 | `MODEL_PROMPT_SUFFIX_CACHE` 无 TTL |
| AR2 | model profile 解析跨 worker 重复 |
| AR3 | context-core `assemblerOps` deprecated alias |
| AR4 | clients/api-docs HP2-HP4 散落更新 D7 violation |
| AR5 | F13/F15/F17 phase 命名 drift |

### 1.4 5 Cleanup Candidates Carrying Forward

详见 final closure §6.2。

| ID | 项 |
|----|---|
| K1 | `parity-bridge.ts` (372 行；5 live caller) |
| K2 | `nano-session-do.ts` wrapper (8 行) |
| K3 | `user-do.ts` wrapper (9 行) |
| K4 | context-core `assemblerOps` deprecated alias |
| K5 | host-local Lane E workspace residue |

---

## 2. Inherited Q ID Frozen Invariants

hero-to-platform 必须遵守以下 frozen invariants（unfreeze 必须重开 QNA 流程）：

| Q ID | 内容 |
|------|------|
| Q1 | 4 套状态机定义（model / context / chat-lifecycle / tool-workspace） |
| Q2 | 6-worker 拓扑边界 |
| Q3 | NACP backward compat 原则 |
| Q4-Q6 | DDL freeze（HP1 集中 + HP2 受控例外 = 14 migrations） |
| Q7-Q9 | model state machine 4 层 + alias resolve + clear semantics |
| Q10-Q12 | context state machine 5 surface + 60s preview cache |
| Q13-Q15 | chat lifecycle Q13 close `ended_reason` / Q14 软删 / Q15 cursor read model |
| Q16-Q18 | confirmation row-first dual-write / `confirmation_pending` rename / server-only frame direction |
| Q19-Q21 | virtual_path 7-rule + tenant R2 key + todo at-most-1 in_progress + tool cancel 不入 confirmation enum |
| Q22-Q24 | file snapshot policy by kind / fork = same conversation / restore failure → rollback baseline |
| Q25-Q28 | megafile budget / tool catalog SSoT in nacp-core / public FacadeEnvelope only / chronic terminal compliance |
| Q29-Q32 | docs by product surface / manual evidence hard gate / prod baseline remote / sanity-vs-rewrite routing |
| Q33-Q36 | final closure no silent / cleanup by reality / stub no overreach / retained must have observable remove condition |

总计 **36 个 Q ID** 全部 frozen，详见 `docs/design/hero-to-pro/HPX-qna.md`。

---

## 3. 边界声明 — hero-to-pro 不再覆盖

hero-to-platform 阶段必须独立决定（hero-to-pro 不预设答案）：

| 维度 | hero-to-pro 不覆盖 |
|------|---------------------|
| 客户端产品化 | clients/web 与 clients/wechat-miniprogram 的 fully productized 实现（独立客户端 charter） |
| Multi-provider routing | LLM provider routing / fallback chain（HPX-Q8 frozen single-step；不允许 chain） |
| Sub-agent / multi-agent | agent-of-agents 拓扑 |
| Admin plane | admin / billing / pricing 控制面 |
| Auto-generated SDK | contract codegen / sdk auto-gen |
| WeChat 微信生态深度集成 | 公众号 / 服务号 / 视频号 |
| 跨 conversation fork | HPX-Q23 frozen same-conversation-only |
| TodoWrite V2 task graph | HPX-Q20 frozen 5-status flat list（V2 graph 是 hero-to-platform territory） |

---

## 4. Inherited Test Coverage Gaps

hero-to-platform 必须接续补齐：

| 类别 | Coverage gap |
|------|--------------|
| HP2 cross-e2e | 5+ scenarios (model-switch / model-alias-resolve / model-fallback / model-policy-block / model-clear) |
| HP3 cross-e2e | 5+ scenarios (long-conversation / compact / cross-turn-recall / breaker / strip-recover) |
| HP4 cross-e2e | 6+ scenarios (close / delete / title / retry / restore / restart-safe) |
| HP5 cross-e2e (15-18) | 4 round-trip scenarios (permission / elicitation / model-switch-confirmation / checkpoint-restore-confirmation) |
| HP6 cross-e2e | 6+ scenarios (todos-roundtrip / workspace-temp / tool-cancel / promote / cleanup-audit / traversal-deny) |
| HP7 cross-e2e | 6+ scenarios (three-mode-restore / rollback-baseline / fork-isolation / checkpoint-ttl / restore-mid-restart-safe / fork-restore) |
| HP8 cross-e2e | 4-scenario heartbeat posture (heartbeat-normal / heartbeat-lost / reconnect-resume / deferred-sweep-coexist) |

详见 `docs/architecture/test-topology.md` §1.4。

---

## 5. Inherited Doc Surface

hero-to-pro 已冻结 18 docs pack；hero-to-platform 阶段如要重组 / 扩展，需独立 charter，不能在本 stub 中规划。

`clients/api-docs/`：

```text
README.md / auth.md / catalog.md / error-index.md / me-sessions.md / worker-health.md / transport-profiles.md
session.md / session-ws-v1.md / models.md / context.md / workspace.md / checkpoints.md / todos.md
confirmations.md / permissions.md / usage.md / wechat-auth.md
```

---

## 6. Inherited Repo Reality Snapshot

| 维度 | hero-to-pro 末态 |
|------|------------------|
| as-of-commit-hash | `e9287e4523f33075a37d4189a8424f385c540374` |
| 6 workers | orchestrator-core / orchestrator-auth / agent-core / context-core / bash-core / filesystem-core |
| migrations | 14 (001-014, HP1 集中 + HP2 014 受控例外) |
| nacp packages | nacp-core / nacp-session / nacp-session-contract |
| unit tests | 1,922 全绿 |
| root drift gates | 5 类（cycles / observability-drift / megafile-budget / tool-drift / envelope-drift） |
| docs pack | 18 frozen |
| live cross-e2e files | 15 |
| stream event kinds | 12 |

---

## 7. 启动 Gate

hero-to-platform charter（正式版）启动时，应在自己的 §1 引用本 stub 作为唯一 inherited issues 入口，并：

1. 给 §1.1 22 items 各自决定接受 / 重新评估 / decline 的态度
2. 给 §1.2 3 items 在 next-review-date 前回填 owner-action 结果
3. 给 §1.3 5 accepted-as-risk 决定是否 promote 为正式 issue
4. 给 §1.4 5 cleanup K1-K5 决定 cleanup timeline
5. 给 §3 边界声明各维度独立设定阶段目标
6. 给 §4 cross-e2e gap 设定补齐时间窗

> **本 stub 不预设以上任何决定**。

---

## 8. Stub Closure

本 stub 由 hero-to-pro HP10 final closure 创建，以满足 charter §10 final closure gate 与 HPX-Q35 frozen invariant。stub 自身的"完成"定义 = 上述 §1-§7 全部 inherited issues 已显式登记 + 边界已划清 + 不越界。

stub 完成；hero-to-pro 阶段封板宣告参考 `docs/issue/hero-to-pro/hero-to-pro-final-closure.md` §8 final verdict。

---

> **下一阶段 owner**：请读 `docs/issue/hero-to-pro/hero-to-pro-final-closure.md` § §1-§7 + 本 stub §1-§7，作为 hero-to-platform 正式 charter 的输入。
> **请勿**在本 stub 中追加实施方案 / timeline / architecture（HPX-Q35 frozen）。
