# Nano-Agent 行动计划 — HP7 Checkpoint Revert

> 服务业务簇: `hero-to-pro / HP7`
> 计划对象: `把当前 latest checkpoint runtime seam 升级为用户可枚举、可 diff、可三模式 restore、可 fork、可 TTL 清理的 checkpoint/revert 产品系统`
> 类型: `modify + API + D1 + R2 + runtime + test`
> 作者: `Owner + GPT-5.4`
> 时间: `2026-04-30`
> 文件位置:
> - `packages/nacp-session/src/{messages,frame,stream-event}.ts`
> - `packages/nacp-core/src/tenancy/scoped-io.ts`
> - `workers/agent-core/src/host/checkpoint.ts`
> - `workers/agent-core/src/host/do/session-do-persistence.ts`
> - `workers/agent-core/src/host/do/session-do/ws-runtime.ts`
> - `workers/orchestrator-core/migrations/004-session-files.sql`
> - `workers/orchestrator-core/src/index.ts`
> - `workers/filesystem-core/src/{index,artifacts}.ts`
> - `test/cross-e2e/**`
> - `docs/issue/hero-to-pro/HP7-closure.md`
> 上游前序 / closure:
> - `docs/action-plan/hero-to-pro/HP6-action-plan.md`
> - `docs/charter/plan-hero-to-pro.md` §7.8 HP7
> 下游交接:
> - `docs/action-plan/hero-to-pro/HP8-action-plan.md`
> 关联设计 / 调研文档:
> - `docs/design/hero-to-pro/HP7-checkpoint-revert.md`
> - `docs/design/hero-to-pro/HPX-qna.md`
> 冻结决策来源:
> - `docs/design/hero-to-pro/HPX-qna.md` Q22-Q24（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `executed`

---

## 0. 执行背景与目标

HP7 不是“把现有 session resume 再多带几个参数”的表层补丁，而是要把今天仅服务于 DO hibernation 的 latest checkpoint seam，升级为真正可枚举、可 materialize、可 diff、可 restore、可 fork、可 cleanup 的产品级时间旅行系统。到当前代码现实为止，`session.resume` 仍只接受 `last_seen_seq`；`SessionCheckpoint` 类型虽然已经为 `kernel/replay/workspace/hooks` fragment 预留了完整形态，但 `persistCheckpoint()` 真实写入的仍是 `replayFragment: null / workspaceFragment: null / hooksFragment: null` 的 single latest blob；`restoreFromStorage()` 与 `ws-runtime` 的 `session.resume` 也都只走单个 `session:checkpoint` key。换言之，当前 seam 是“worker 休眠恢复”，还不是“用户可管理 checkpoint registry”。

因此 HP7 的任务，是把 checkpoint/revert/fork 做成正式系统能力：`nano_session_checkpoints`、`nano_checkpoint_file_snapshots`、`nano_checkpoint_restore_jobs` 成为 durable truth，`conversation_only/files_only/conversation_and_files` 三模式 restore 成为正式产品操作，restore 前必经 HP5 `checkpoint_restore` confirmation，restore 失败必须回滚到 rollback baseline，fork 必须生成同 conversation 下的新 session 且完全隔离 R2 namespace。与此同时，Q22-Q24 已把关键边界冻结：**file snapshot baseline 采用 lazy materialization，user-named checkpoint 尽量 eager；fork 不是新 conversation；restore 禁止 partial success，必须有 rollback baseline 且 `failure_reason` 足够解释失败步骤与错误码**。

- **服务业务簇**：`hero-to-pro / HP7`
- **计划对象**：`hero-to-pro 的 checkpoint / revert / fork control plane`
- **本次计划解决的问题**：
  - 当前协议与 runtime 恢复只理解 `last_seen_seq` 和 latest-key checkpoint，不具备 checkpoint-aware 产品语义。
  - 当前仓库只有 artifact truth，没有 checkpoint registry、file snapshot、restore job、fork lineage 与 TTL cleanup 产品真相。
  - restore/fork 还没有 confirmation gate、rollback baseline 与 tenant-scoped snapshot/fork namespace 这些关键保护栏。
- **本次计划的直接产出**：
  - checkpoint registry + lazy snapshot materialization + `/checkpoints` / `/diff` / `/restore` / `/fork` surface。
  - `files_only` / `conversation_and_files` restore、restore job + rollback baseline、`session.fork.created` stream event。
  - TTL cleanup、fork namespace isolation、HP7 closure 与三模式 restore/fork e2e。
- **本计划不重新讨论的设计结论**：
  - file snapshot baseline 采用 lazy materialization；turn-end auto checkpoint 严格 lazy，user-named checkpoint 尽量 eager（失败转 pending）（来源：`docs/design/hero-to-pro/HPX-qna.md` Q22）。
  - fork 的语义是“同 conversation 下的新 session”，不是新建 conversation；parent/child 完全独立，并在 parent attached client 上推 `session.fork.created`（来源：`docs/design/hero-to-pro/HPX-qna.md` Q23）。
  - restore 禁止 partial success；失败时必须 rollback 到已知 baseline，且 `failure_reason` 要足够解释失败步骤与错误码（来源：`docs/design/hero-to-pro/HPX-qna.md` Q24）。

---

## 1. 执行综述

### 1.1 总体执行方式

HP7 采用**先建立 checkpoint registry 与 lazy snapshot truth → 再扩 `/diff` 与三模式 restore surface → 再把 confirmation/rollback baseline 固定到 restore job 主线 → 最后接 fork、TTL cleanup 与 e2e 收口** 的顺序。先把 checkpoint row / snapshot row / restore job 三层 durable truth 定好，能避免实现者继续用 latest-key seam 假扮产品面；而把 fork 与 cleanup 放在后半段，则能确保 fork lineage、snapshot copy 与 TTL 清理都建立在已经稳定的 registry/restore law 之上。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Checkpoint Registry + Lazy Snapshot | M | 建立 checkpoint row、snapshot row 与按需 materialization 机制 | `-` |
| Phase 2 | Restore Modes + Diff Surface | M | 建立 `/checkpoints` / `/diff` / `/restore` 三模式产品面 | Phase 1 |
| Phase 3 | Confirmation Gate + Rollback Job | M | 固定 HP5 gate、rollback baseline、restore job 与 failure recovery law | Phase 1-2 |
| Phase 4 | Session Fork + TTL Cleanup | M | 让 fork 成为同 conversation 新 session，并完成 rotate/TTL cleanup | Phase 1-3 |
| Phase 5 | E2E + Closure | S | 用三模式 restore、fork、TTL、rollback 证据完成 HP7 closure | Phase 1-4 |

### 1.3 Phase 说明

1. **Phase 1 — Checkpoint Registry + Lazy Snapshot**
   - **核心目标**：让 checkpoint 第一次拥有独立于 DO latest key 的 durable registry。
   - **为什么先做**：没有 registry truth，restore/fork/diff 都只能继续偷用 latest-key seam。
2. **Phase 2 — Restore Modes + Diff Surface**
   - **核心目标**：让 `conversation_only/files_only/conversation_and_files` 与 diff 成为正式产品操作。
   - **为什么放在这里**：三模式 restore 必须消费已经稳定的 checkpoint/snapshot truth。
3. **Phase 3 — Confirmation Gate + Rollback Job**
   - **核心目标**：让 destructive restore 始终经过 HP5 gate，并在失败时显式回滚。
   - **为什么放在这里**：rollback baseline 与 restore job 只有在 mode/diff 都已明确后才能被固定。
4. **Phase 4 — Session Fork + TTL Cleanup**
   - **核心目标**：让 fork 变成同 conversation 新 session，并把 snapshot 生命周期治理收口。
   - **为什么放在这里**：fork 与 cleanup 都依赖 checkpoint row、snapshot row、restore law 已稳定。
5. **Phase 5 — E2E + Closure**
   - **核心目标**：证明 checkpoint row、snapshot row、restore/fork 结果与 cleanup audit 四者一致。
   - **为什么最后**：只有 registry/restore/fork/cleanup 全部连起来，HP7 才真正完成。

### 1.4 执行策略说明

- **执行顺序原则**：先 registry 再 restore，先 lazy snapshot 再文件恢复，先 gate/rollback 再 fork，先 source-of-truth 后 runtime seam。
- **风险控制原则**：不再让 DO latest blob 充当产品 registry；snapshot/fork key 全部强制 tenant prefix；rollback baseline 与 failure recovery law 在执行前先固定。
- **测试推进原则**：agent-core、filesystem-core、orchestrator-core、`@haimang/nacp-session` 测试之外，必须有三模式 restore、confirmation gate、rollback on failure、fork isolation、TTL cleanup 的 cross-e2e。
- **文档同步原则**：closure 必须同时记录 registry verdict、restore/diff verdict、rollback verdict、fork/cleanup verdict。
- **回滚 / 降级原则**：restore 前先创建 rollback baseline；若 restore 中任一步失败，立即尝试从 baseline 回放，并把 job 标 `rolled_back` 或 `failed`，绝不接受 partial success。

### 1.5 本次 action-plan 影响结构图

```text
hero-to-pro HP7 checkpoint revert
├── Phase 1: Checkpoint Registry + Lazy Snapshot
│   ├── nano_session_checkpoints
│   ├── nano_checkpoint_file_snapshots
│   └── lazy/eager-by-kind materialization
├── Phase 2: Restore Modes + Diff Surface
│   ├── /sessions/{id}/checkpoints
│   ├── /diff
│   └── /restore (3 modes)
├── Phase 3: Confirmation Gate + Rollback Job
│   ├── HP5 checkpoint_restore
│   ├── nano_checkpoint_restore_jobs
│   └── rollback baseline + failure recovery
├── Phase 4: Session Fork + TTL Cleanup
│   ├── /sessions/{id}/fork
│   ├── session.fork.created
│   └── rotate/ttl cleanup jobs
└── Phase 5: E2E + Closure
    ├── test/cross-e2e/**
    └── docs/issue/hero-to-pro/HP7-closure.md
```

### 1.6 已核对的当前代码锚点

1. **协议层目前没有 checkpoint-aware resume / restore / fork 语义**
   - `packages/nacp-session/src/messages.ts:56-59,260-319`
   - `packages/nacp-session/src/frame.ts:25-30`
   - 当前 `session.resume` 只接受 `last_seen_seq`，frame 里只有 `last_seen_seq/replay_from`，还看不到 checkpoint id、restore mode、fork 参数。
2. **checkpoint interface 已存在，但持久化仍是 latest single key，且多个 fragment 还是 null**
   - `workers/agent-core/src/host/checkpoint.ts:43-56,89-121,145-206,218-282`
   - `workers/agent-core/src/host/do/session-do-persistence.ts:142-187`
   - `SessionCheckpoint` 类型本身已为 `kernel/replay/workspace/hooks` 预留 fragment contract，但 `persistCheckpoint()` 当前仍写 single latest blob。
3. **runtime restore 仍只走 `session:checkpoint` latest-key 路径**
   - `workers/agent-core/src/host/do/session-do-persistence.ts:193-222`
   - `workers/agent-core/src/host/do/session-do/ws-runtime.ts:197-213`
   - `restoreFromStorage()` 与 `session.resume` 当前只是 latest-key resume seam，而不是 checkpoint registry。
4. **仓内现在只有 artifact truth，没有 checkpoint/snapshot/restore job 产品真相**
   - `workers/orchestrator-core/migrations/004-session-files.sql:6-27`
   - `workers/filesystem-core/src/artifacts.ts:113-170,185-272`
   - 当前只有 `nano_session_files` + artifact key `tenants/{team}/sessions/{session}/files/{file_uuid}`。
5. **tenant prefix law 已冻结，HP7 的 snapshot/fork 必须延续这条规则**
   - `packages/nacp-core/src/tenancy/scoped-io.ts:1-19,35-79`
   - 这意味着 snapshot 与 fork 绝不允许引用原 session 的 R2 key 作为“软链接式 fork”。
6. **当前 stream event 里还没有 `session.fork.created` 等 HP7 事件**
   - `packages/nacp-session/src/stream-event.ts:81-107`
   - HP7 需要在现有 event registry 之上新增 fork/restore 相关产品事件，而不是继续隐形完成。
7. **外部 precedent 已核对并支持 HP7 的 checkpoint / restore / fork 语义**
   - `context/gemini-cli/packages/core/src/utils/checkpointUtils.ts:84-157`, `context/gemini-cli/packages/core/src/commands/restore.ts:11-58`, `context/gemini-cli/packages/cli/src/ui/commands/rewindCommand.tsx:40-90,143-198`, `context/claude-code/constants/xml.ts:61-66`, `context/claude-code/tools/AgentTool/forkSubagent.ts:96-198`
   - precedent 共同说明 checkpoint 必须是成组状态锚点，restore 要同时处理 transcript / file state / client-visible history，fork child 必须带显式 lineage 语义；HP7 吸收这些边界，不照抄外部 UI/agent orchestration。

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** checkpoint registry、lazy file snapshot materialization 与 snapshot row truth。
- **[S2]** `/checkpoints` list/create/diff、三模式 restore：`conversation_only/files_only/conversation_and_files`。
- **[S3]** HP5 `checkpoint_restore` confirmation gate、rollback baseline、restore job 与 failure recovery。
- **[S4]** 同 conversation 的 session fork、child lineage message、`session.fork.created`。
- **[S5]** rotate/TTL cleanup：turn-end recent-10、user-named 30d、session.end + 90d cleanup。
- **[S6]** HP7 closure 与 restore/fork/cleanup e2e。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** cross-conversation fork。
- **[O2]** checkpoint diff visualizer UI。
- **[O3]** checkpoint export/import。
- **[O4]** 继续让 latest DO key 充当产品级 registry。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| turn-end checkpoint eager 全量复制文件 | `out-of-scope` | Q22 已冻结 baseline 为 lazy；只有 user-named 尽量 eager | 若未来成本/UX 重新评估，需新 phase |
| fork 是否新建 conversation | `out-of-scope` | Q23 已冻结为同 conversation 新 session | 仅在 cross-conversation fork 被正式立项时重评 |
| restore 失败保留 partial success | `out-of-scope` | Q24 已冻结必须 rollback 到已知 baseline | 不重评；这是 HP7 信任基础 |
| 产品 restore 继续复用 latest DO key | `out-of-scope` | 与 HP7 registry/job 目标冲突 | 不重评；这是 HP7 核心目标 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | checkpoint registry truth | `update` | orchestrator-core + HP1 checkpoint truth | 让 checkpoint 从 latest blob 升级为 durable registry | `high` |
| P1-02 | Phase 1 | lazy/eager-by-kind materialization | `update` | filesystem-core + snapshot materializer | 让 snapshot 按需生成而不是 turn-end 全量复制 | `high` |
| P2-01 | Phase 2 | restore/diff public surface | `update` | orchestrator-core + nacp-session | 让 `/checkpoints` / `/diff` / `/restore` 成为正式产品面 | `medium` |
| P2-02 | Phase 2 | three-mode restore executor | `update` | orchestrator-core + agent-core + filesystem-core | 让 conversation/file/combined 三模式恢复都可执行 | `high` |
| P3-01 | Phase 3 | confirmation gate + restore jobs | `update` | HP5 plane + restore coordinator | 让每次 restore 都有 confirmation_uuid 与 job truth | `high` |
| P3-02 | Phase 3 | rollback baseline + failure recovery | `update` | restore coordinator + DO seam + D1 reverse markers | 让 restore 失败不留下半状态 | `high` |
| P4-01 | Phase 4 | session fork | `update` | orchestrator-core + agent-core + filesystem-core | 让 fork 成为同 conversation 新 session 的正式语义 | `high` |
| P4-02 | Phase 4 | TTL cleanup + session.fork.created | `update` | cleanup owner + stream-event | 让 snapshot 生命周期与 fork 可观察性一起收口 | `medium` |
| P5-01 | Phase 5 | restore/fork/ttl e2e matrix | `add` | `test/cross-e2e/**` | 用端到端场景证明 HP7 真闭环 | `medium` |
| P5-02 | Phase 5 | HP7 closure | `update` | `docs/issue/hero-to-pro/HP7-closure.md` | 让 HP8 能直接消费 HP7 verdict | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Checkpoint Registry + Lazy Snapshot

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | checkpoint registry truth | 建立 `nano_session_checkpoints` 与 `nano_checkpoint_file_snapshots` 的 create/read/update 语义，让 `checkpoint_uuid`、`file_snapshot_status`、`snapshot_status` 成为正式 truth | orchestrator-core + HP1 checkpoint truth | checkpoint 第一次有独立 durable owner | D1 assertions + orchestrator-core tests | checkpoint 不再依赖 latest DO key 才能被列举/解释 |
| P1-02 | lazy/eager-by-kind materialization | turn-end auto checkpoint 严格 lazy；user-named checkpoint 尽量 eager、失败转 pending；snapshot key 冻结为 `tenants/{team}/sessions/{session}/snapshots/{checkpoint_uuid}/{virtual_path}` | filesystem-core + materializer | 成本与 UX 第一次被分级治理 | snapshot tests + R2 assertions | lazy/eager 规则与 kind 完全一致，materialization 状态可追踪 |

### 4.2 Phase 2 — Restore Modes + Diff Surface

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | restore/diff public surface | 新增 `/sessions/{id}/checkpoints`、`GET .../{checkpoint_uuid}/diff`、`POST .../{checkpoint_uuid}/restore`；diff 至少返回 message delta、workspace file delta、promoted artifact delta | orchestrator-core + `packages/nacp-session/src/messages.ts` | checkpoint 成为真正可管理产品面 | route tests + diff tests | 对不存在/已过期 checkpoint 返回显式错误而非 fallback |
| P2-02 | three-mode restore executor | `conversation_only` 回退 transcript + DO state，`files_only` 回退 workspace/file truth，`conversation_and_files` 用一个 job 编排两者 | orchestrator-core + agent-core + filesystem-core | restore 第一次拥有明确模式边界 | integration tests | 三种 mode 的行为边界清晰且可验证 |

### 4.3 Phase 3 — Confirmation Gate + Rollback Job

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | confirmation gate + restore jobs | restore 前必经 HP5 `checkpoint_restore`；通过后创建 `nano_checkpoint_restore_jobs`，记录 `confirmation_uuid`、mode、status、failure_reason | restore coordinator + HP5 plane | destructive restore 第一次拥有统一人机边界与作业真相 | integration tests + D1 assertions | deny/cancel/timeout 不进入 running；job truth 可解释每次 restore |
| P3-02 | rollback baseline + failure recovery | restore 前先建 `checkpoint_kind=system` rollback baseline；失败时立刻尝试 baseline 回放并反标 D1 supersede/tombstone；rollback 再失败才进入 `failed` | restore coordinator + DO seam + D1 reverse markers | restore 失败不再留下 partial state | failure-path tests + restart tests | `rolled_back` / `failed` 区分清晰，`failure_reason` 足够诊断 |

### 4.4 Phase 4 — Session Fork + TTL Cleanup

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | session fork | `POST /sessions/{id}/fork` 从 checkpoint 派生 child session，复制 message truth 与 snapshot 文件到 child namespace，写 lineage system message 与 `target_session_uuid` | orchestrator-core + agent-core + filesystem-core | fork 第一次成为有 lineage 的新 session 语义 | integration tests | parent/child R2 key 完全隔离，且仍处于同一 conversation |
| P4-02 | TTL cleanup + session.fork.created | turn-end rotate=10、user-named 30d、session.end + 90d cleanup；cleanup 写 `nano_workspace_cleanup_jobs(scope=checkpoint_ttl)`；fork 时向 parent attached client 推 `session.fork.created`；scope 责任固定为 `checkpoint_ttl` 归 HP7，而 `session_end` / `explicit` 保持由 HP6 owner | cleanup owner + `packages/nacp-session/src/stream-event.ts` | HP7 的生命周期治理与 fork 可观察性一起成型 | cleanup tests + event tests | cleanup 不会删正在 restore/fork 使用的 checkpoint；fork 事件可见 |

### 4.5 Phase 5 — E2E + Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | restore/fork/ttl e2e matrix | 覆盖三模式 restore、confirmation gate、rollback on failure、fork isolation、TTL cleanup 至少 6 个 cross-e2e；建议文件名使用 `checkpoint-restore-conversation-only` / `checkpoint-restore-files-only` / `checkpoint-restore-combined` / `checkpoint-rollback-failure` / `checkpoint-fork-lineage` / `checkpoint-ttl-cleanup` 描述性前缀；若采用编号文件，必须为 HP5 预留 `15-18` | `test/cross-e2e/**` | HP7 在真实链路里闭环 | `pnpm test:cross-e2e` | 6+ 场景全绿，且 checkpoint row / snapshot row / result / cleanup audit 一致 |
| P5-02 | HP7 closure | 回填 registry verdict、restore/diff verdict、rollback verdict、fork/cleanup verdict，并显式登记 F1-F17 chronic status（`closed / partial / not-touched / handed-to-platform`） | `docs/issue/hero-to-pro/HP7-closure.md` | HP8 可直接消费 HP7 输出 | doc review | closure 能独立回答“checkpoint/revert/fork 是否已经成型” |

---

## 5. Phase 详情

### 5.1 Phase 1 — Checkpoint Registry + Lazy Snapshot

- **Phase 目标**：让 checkpoint/snapshot 第一次成为正式 durable truth，而不是 DO latest blob。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/index.ts`
  - 可能涉及新的 checkpoint truth / materializer helper
  - `workers/filesystem-core/src/index.ts`
  - `workers/filesystem-core/src/artifacts.ts` 或新 snapshot 模块
- **本 Phase 已核对的源码锚点**：
  - `packages/nacp-session/src/messages.ts:56-59,260-319`
  - `workers/agent-core/src/host/checkpoint.ts:43-56,89-121,145-206,218-282`
  - `workers/agent-core/src/host/do/session-do-persistence.ts:142-187`
  - `workers/filesystem-core/src/artifacts.ts:113-170,185-272`
- **具体功能预期**：
  1. checkpoint row 与 file snapshot row 会拥有独立 D1 truth，不再寄生在 latest key 上。
  2. turn-end checkpoint 严格 lazy；user-named checkpoint 尽量 eager，失败转 pending。
  3. materialization status 会写回 D1，而不是只停留在 DO memory。
- **具体测试安排**：
  - **单测**：checkpoint row/snapshot row tests、materialization policy tests。
  - **集成测试**：checkpoint create → snapshot materialize → D1/R2 assertions。
  - **回归测试**：
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
    - `pnpm --filter @haimang/filesystem-core-worker typecheck build test`
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - checkpoint registry 已能脱离 latest DO key 独立存在。
  - lazy/eager-by-kind 规则与 Q22 完全一致。
- **本 Phase 风险提醒**：
  - 若 materialization 状态只保存在内存，worker 重启后 checkpoint 会重新回到“看起来存在、实际上不可恢复”的危险状态。

### 5.2 Phase 2 — Restore Modes + Diff Surface

- **Phase 目标**：把 restore/diff 从内部恢复技巧升级为正式产品操作。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 修改文件**：
  - `packages/nacp-session/src/messages.ts`
  - `packages/nacp-session/src/frame.ts`
  - `workers/orchestrator-core/src/index.ts`
  - 可能涉及新的 restore executor / diff projection helper
- **本 Phase 已核对的源码锚点**：
  - `packages/nacp-session/src/messages.ts:56-59,260-319`
  - `packages/nacp-session/src/frame.ts:25-30`
  - `workers/agent-core/src/host/do/session-do/ws-runtime.ts:197-213`
- **具体功能预期**：
  1. `/diff` 至少能回答 message / workspace file / promoted artifact delta。
  2. `conversation_only`、`files_only`、`conversation_and_files` 都有清晰执行边界。
  3. 产品 restore 不再等同于 `session.resume` 的 latest-key restore。
- **具体测试安排**：
  - **单测**：diff projection tests、restore mode router tests。
  - **集成测试**：three-mode restore + D1/R2/DO assertions。
  - **回归测试**：
    - `pnpm --filter @haimang/nacp-session typecheck build test`
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
    - `pnpm --filter @haimang/filesystem-core-worker typecheck build test`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - 三模式 restore 都能被 diff 与 job truth 解释。
  - 不存在“实际只是 resume latest key，却对外叫 restore”的伪产品面。
- **本 Phase 风险提醒**：
  - 若 `/restore` 继续偷偷调用 latest-key seam，HP7 表面上有新 endpoint，实质上仍然没有 checkpoint 产品语义。

### 5.3 Phase 3 — Confirmation Gate + Rollback Job

- **Phase 目标**：让 restore 始终经过 confirmation，并在失败时回到可解释的已知基线。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/index.ts`
  - 可能涉及新的 restore coordinator
  - `workers/agent-core/src/host/do/session-do-persistence.ts`
  - 可能涉及 HP5 confirmation consumer adapter
- **本 Phase 已核对的源码锚点**：
  - `workers/agent-core/src/host/checkpoint.ts:145-206,218-282`
  - `workers/agent-core/src/host/do/session-do-persistence.ts:193-222`
- **具体功能预期**：
  1. restore 必须携带 `confirmation_uuid`，未放行不进入 running。
  2. rollback baseline 默认 lazy 物化兜底，而不是每次 restore 都先昂贵复制。
  3. `failure_reason` 必须能明确指出失败步骤与错误码，而不是只写 boolean failure。
- **具体测试安排**：
  - **单测**：confirmation gate tests、rollback baseline tests、failure-reason tests。
  - **集成测试**：restore→failure→rollback→反标 D1 的全链路验证。
  - **回归测试**：
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
    - `pnpm --filter @haimang/filesystem-core-worker typecheck build test`
  - **手动验证**：mid-restore failure 场景验证。
- **收口标准**：
  - restore 失败后不会留下 partial success 合法终态。
  - `rolled_back` / `failed` 能清晰区分“回退成功”和“连回退都失败”。
- **本 Phase 风险提醒**：
  - 若 rollback baseline 顺序不先固定，HP7 很容易在执行期被“先试试能恢复多少”这种危险 best-effort 诱惑带偏。

### 5.4 Phase 4 — Session Fork + TTL Cleanup

- **Phase 目标**：让 fork 成为有 lineage 的新 session 语义，并让 checkpoint 生命周期被真正治理。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/index.ts`
  - `packages/nacp-session/src/stream-event.ts`
  - `workers/filesystem-core/src/index.ts`
  - `workers/filesystem-core/src/artifacts.ts` 或新 snapshot/fork module
  - 可能涉及新的 cleanup owner / lineage helper
- **本 Phase 已核对的源码锚点**：
  - `packages/nacp-core/src/tenancy/scoped-io.ts:1-19,35-79`
  - `workers/filesystem-core/src/artifacts.ts:113-170,185-272`
  - `packages/nacp-session/src/stream-event.ts:81-107`
- **具体功能预期**：
  1. fork 生成的是同 conversation 下的新 session，而不是新 conversation。
  2. child session 的 workspace namespace 绝不复用 parent R2 key。
  3. TTL cleanup 会遵守 recent-10、user-named 30d、session.end + 90d 的冻结策略。
- **具体测试安排**：
  - **单测**：fork lineage tests、cleanup policy tests、event schema tests。
  - **集成测试**：fork copy → child namespace isolation → parent event assertions。
  - **回归测试**：
    - `pnpm --filter @haimang/nacp-session typecheck build test`
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
    - `pnpm --filter @haimang/filesystem-core-worker typecheck build test`
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - fork 后 parent/child 可独立继续写入，且不会串 R2 路径。
  - cleanup 不会并发删除正在 restore/fork 使用的 checkpoint。
- **本 Phase 风险提醒**：
  - 若 fork 直接引用 parent R2 key，HP7 会在第一版就失去 namespace isolation，后续 cleanup 与 lineage 都会失真。

### 5.5 Phase 5 — E2E + Closure

- **Phase 目标**：证明 checkpoint/revert/fork 已从内部 seam 升级为可信产品能力。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 新增文件**：
  - `test/cross-e2e/**`（新增 6+ 场景）
- **本 Phase 修改文件**：
  - `docs/issue/hero-to-pro/HP7-closure.md`
- **具体功能预期**：
  1. 三模式 restore、confirmation gate、rollback、fork、TTL cleanup 都有 real-stack 证据。
  2. HP7 closure 能独立说明 checkpoint/revert/fork 是否已经成型，以及还有哪些内容明确留给 hero-to-platform。
- **具体测试安排**：
  - **单测**：无新增单测为主。
  - **集成测试**：orchestrator-core + filesystem-core + agent-core + HP5 gate 联动。
  - **回归测试**：
    - `pnpm test:cross-e2e`
    - `pnpm --filter @haimang/nacp-session typecheck build test`
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
    - `pnpm --filter @haimang/filesystem-core-worker typecheck build test`
  - **手动验证**：closure 对照 e2e 结果回填。
- **收口标准**：
  - 6+ e2e 全绿。
  - closure 对 registry/restore/rollback/fork/cleanup 都给出明确 verdict。
- **本 Phase 风险提醒**：
  - 若只验证 endpoint 200，不核对 checkpoint row、snapshot row、result 与 cleanup audit 四层，HP7 会很容易出现“看上去能恢复，其实不可追责”的假闭环。

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q22 — file snapshot baseline 为 lazy，user-named 尽量 eager | `docs/design/hero-to-pro/HPX-qna.md` | 决定 HP7 的 materialization policy 不能 turn-end eager 全量复制文件 | 若未来要改 eager 策略，需新 phase 重评 |
| Q23 — fork 为同 conversation 新 session | `docs/design/hero-to-pro/HPX-qna.md` | 决定 child session lineage、conversation detail 展示、parent event 与 R2 namespace 都围绕“同 conversation”实现 | 若未来要 cross-conversation fork，需新设计 |
| Q24 — restore 禁止 partial success | `docs/design/hero-to-pro/HPX-qna.md` | 决定 restore 必须有 rollback baseline、`rolled_back/failed` 终态与足够详细的 `failure_reason` | 不重评；这是 HP7 信任底线 |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| HP1/HP6 truth 依赖 | HP7 依赖 checkpoint/snapshot/restore-job 表与 HP6 workspace truth 已冻结 | `high` | HP7 不私补边界；若前序 truth 缺口暴露，只能回到对应 correction law |
| lazy snapshot 信息丢失 | materialization 若只存在内存或临时状态，worker 重启后会丢 | `high` | `file_snapshot_status` 先写 D1，再做实际 materialization |
| restore 半状态 | D1、R2、DO 三侧任一步失败都可能留下不可预测状态 | `high` | 固定 rollback baseline 顺序，并强制 `rolled_back/failed` law |
| fork namespace 串线 | child 若复用 parent R2 key，会导致 cleanup 与后续写入互相污染 | `high` | fork 必须复制到 child namespace，新旧路径永不共享 |
| TTL cleanup 漏执行 | rotate/90d cleanup 若只停留在文档，不会真正控制成本 | `medium` | cleanup job 每次必写 audit，并做 cron/alarm 验证 |

### 7.2 约束与前提

- **技术前提**：HP5 confirmation plane 已可提供 `checkpoint_restore` kind；HP6 已提供 workspace temp file truth 与 provenance 边界。
- **运行时前提**：`session.resume` latest-key seam 继续存在，但只服务 runtime resume，不再充当 checkpoint 产品面。
- **组织协作前提**：rollback baseline 与 confirmation gate 顺序必须先固定，再写 restore 执行逻辑；fork lineage 不得在实现期临时改成新 conversation。
- **上线 / 合并前提**：registry、materialization、restore/diff、rollback、fork、cleanup 六层证据完整。

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/hero-to-pro/HP4-chat-lifecycle.md`
  - `docs/design/hero-to-pro/HP5-confirmation-control-plane.md`
  - `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md`
- 需要同步更新的说明文档 / README：
  - `docs/issue/hero-to-pro/HP7-closure.md`
- 需要同步更新的测试说明：
  - `test/index.md` 或相关 e2e 入口说明（若新增 restore/fork/ttl gate）

### 7.4 完成后的预期状态

1. checkpoint 会从内部 latest-key seam 升级为真正的 registry + snapshot + restore job 产品系统。
2. restore 将第一次拥有明确 mode、diff、confirmation、rollback 和 failure reason。
3. fork 会成为同 conversation 的新 session 语义，并拥有清晰 lineage 与 namespace isolation。
4. checkpoint 成本与生命周期会第一次被 rotate/TTL/cleanup audit 真正治理，而不是无限堆积。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - 检查 `/checkpoints` / `/diff` / `/restore` / `/fork` surface 已存在。
  - 检查 snapshot/fork key 都落在 `tenants/{team}/sessions/{session}/...` law 下。
  - 检查 `session.fork.created` 已进入 stream event registry。
- **单元测试**：
  - `pnpm --filter @haimang/nacp-session typecheck build test`
  - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
  - `pnpm --filter @haimang/agent-core-worker typecheck build test`
  - `pnpm --filter @haimang/filesystem-core-worker typecheck build test`
- **集成测试**：
  - checkpoint registry + snapshot materialization + restore job + rollback + fork lineage
- **端到端 / 手动验证**：
  - `pnpm test:cross-e2e`
- **回归测试**：
  - 三模式 restore、confirmation gate、rollback on failure、fork isolation、TTL cleanup 至少 6 场景
- **前序 phase 回归**：
  - 至少回归 HP4 的 lifecycle / checkpoint surface、HP5 的 confirmation gate，以及 HP6 的 workspace temp/promotion 路径，确认 restore/fork 不会把既有 truth 与 cleanup 边界打乱。
- **文档校验**：
  - `docs/issue/hero-to-pro/HP7-closure.md` 必须同时记录 registry / restore-diff / rollback / fork / cleanup 五层 verdict
  - `docs/issue/hero-to-pro/HP7-closure.md` 必须显式登记 F1-F17 chronic status，并复用 HP6/HP1 已锁定的 cleanup scope 分工

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. checkpoint registry / snapshot row / restore jobs 已 live，且不再依赖 latest DO key 充当产品面。
2. 三模式 restore 全部可用，restore 前必有 confirmation，失败时必能 rollback 或显式 failed。
3. fork 已成为同 conversation 新 session，parent/child 完全隔离且 parent 收到 `session.fork.created`。
4. rotate/TTL cleanup 已真实启用，closure 已清楚写出 HP7 的最终 verdict。
5. HP7 closure 已显式声明 F1-F17 的 phase 状态，并把 `checkpoint_ttl` cleanup 边界与 HP6 的 workspace cleanup 边界明确分开。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | checkpoint / snapshot / restore / rollback / fork / cleanup 六个产品面已完整闭环 |
| 测试 | `nacp-session`、orchestrator-core、agent-core、filesystem-core 测试通过，cross-e2e 覆盖 6+ 场景 |
| 文档 | HP7 closure 能独立解释 checkpoint/revert/fork 的五层结果 |
| 风险收敛 | 无 partial restore、无 parent/child R2 串线、无 latest-key 冒充产品面 |
| 可交付性 | HP8 可以在 HP7 已完成的恢复/分支骨架之上继续做 runtime hardening 与 chronic closure |

---

## 9. 工作日志(回填)

> 记录 HP7 first wave 的实际落地路径 — 与 §3 业务工作总表逐项对齐。
> 闭环日期: `2026-04-30`。详情参见 `docs/issue/hero-to-pro/HP7-closure.md`。

### 9.1 P1-01 / P1-02 — checkpoint snapshot durable truth + lazy/eager-by-kind 物化策略

- 新增 `workers/orchestrator-core/src/checkpoint-restore-plane.ts`
  - 导出 `D1CheckpointSnapshotPlane`:`list` / `create` / `transitionStatus` / `setCheckpointFileSnapshotStatus`
  - 导出 4 个 frozen enum:`CHECKPOINT_FILE_SNAPSHOT_STATUSES`(4) / `CHECKPOINT_SNAPSHOT_STATUSES`(4) / `RESTORE_MODES`(4) / `RESTORE_STATUSES`(6)
  - 导出 `buildCheckpointSnapshotR2Key()`:`tenants/{team}/sessions/{session}/snapshots/{checkpoint_uuid}/{virtual_path}` 法律
  - 导出 `buildForkWorkspaceR2Key()`:`tenants/{team}/sessions/{child_session}/workspace/{virtual_path}`(Q23 child 完全独立 namespace)
  - 导出 `fileSnapshotPolicyForKind()`:user_named=`eager_with_fallback`,其余=`lazy`(Q22)
  - 导出 `CheckpointSnapshotConstraintError`(`checkpoint-not-found` / `snapshot-already-materialized` / `invalid-status`)

### 9.2 P3-01 / P3-02 — restore job + confirmation gate + rollback / failure_reason law

- 在同一文件新增 `D1CheckpointRestoreJobs`
  - `openJob`:对非 fork 模式强制 `confirmation_uuid`(Q24);fork 显式允许无 confirmation(Q23)
  - `markRunning`:仅 pending → running;终态 job 拒绝重新进入 running
  - `terminate`:仅接受 4 终态;非 success 终态强制 `failure_reason`(Q24);幂等
  - `read` / `listForSession`:支持 audit / debug 列举
  - `CheckpointRestoreJobConstraintError`(`missing-confirmation` / `invalid-mode` / `invalid-status` / `already-terminal` / `job-not-found`)
- 新增 `workers/orchestrator-core/test/checkpoint-restore-plane.test.ts`(25 用例)
  - 覆盖 4 enum 冻结、R2 key law、Q22 物化策略
  - snapshot 状态机:create / transition materialized / transition copied_to_fork
  - SQL CHECK 双层硬化(file_snapshot_status / restore_mode / restore_status)
  - confirmation gate / fork 例外 / rolled_back failure_reason / terminate idempotency / markRunning 拒绝终态

### 9.3 P2-01 — checkpoint diff projector

- 新增 `workers/orchestrator-core/src/checkpoint-diff-projector.ts`
  - 导出 `CheckpointDiffProjector.project()`:返回 added/removed/changed workspace 列表 + watermark-后 artifact added 列表
  - 仅消费 `materialized` / `copied_to_fork` 状态的 snapshot 行(避免 pending 数据干扰)
  - watermark message 已 prune 时 artifact delta 返回空(不猜测)
- 新增 `workers/orchestrator-core/test/checkpoint-diff-projector.test.ts`(5 用例)
  - 覆盖 missing checkpoint / 三种 workspace 变更 / pending snapshot 不入 diff / artifact watermark 过滤 / pruned watermark 边界

### 9.4 P4-02 — `session.fork.created` 帧 + observability drift fix

- 修改 `packages/nacp-session/src/stream-event.ts`
  - 新增 `SessionForkCreatedKind`:5 项必填 uuid(parent_session / child_session / conversation / from_checkpoint / restore_job)+ 可选 label(≤200 字符)
  - 加入 `SessionStreamEventBodySchema` discriminated union
  - `STREAM_EVENT_KINDS` 长度 11 → 12
- 修改 `packages/nacp-session/src/index.ts`:re-export `SessionForkCreatedKind`
- 修改 `packages/nacp-session/test/stream-event.test.ts`:`has 11` → `has 12`
- 新增 `packages/nacp-session/test/hp7-fork-created.test.ts`(5 用例)
- 修改 `workers/agent-core/src/eval/inspector.ts`:`SESSION_STREAM_EVENT_KINDS` mirrored constant 加入 `session.fork.created`(防 drift)
- 修改 `workers/agent-core/test/eval/inspector.test.ts`:`mirrors the 11` → `mirrors the 12`

### 9.5 P1-P4 partial — 留给 HP7 后续批次

- restore executor(`conversation_only` / `files_only` / `conversation_and_files`)真接 DO restore seam + filesystem-core RPC + R2 复制 + 反标 D1 supersede
- fork executor:复制 conversation 与 snapshot 文件到 child namespace + child transcript lineage system message
- TTL cleanup cron(scope=`checkpoint_ttl`):turn_end recent-10 / user_named 30d / session.end + 90d
- public surface 路由:`POST /sessions/{id}/checkpoints/{id}/restore` / `POST /sessions/{id}/fork` / 扩展 `/diff` 输出 workspace+artifact
- closure §2 P1-P7 已显式登记后续批次责任

### 9.6 P5 — closure + work log

- 新增 `docs/issue/hero-to-pro/HP7-closure.md`(7 节)
  - §0 verdict matrix(17 维度)
  - §1 Resolved 13 项
  - §2 Partial 7 项
  - §3 Retained 7 项(K1-K7 含 Q22/Q23/Q24 + cleanup scope HP6/HP7 分工 + 禁止 latest-key seam 充当 restore)
  - §4 F1-F17 chronic status(F8 升级为 partial-by-HP7;F13/F14 升级为 partial-by-HP6-and-HP7)
  - §5 下游 phase 交接
  - §6 测试与证据矩阵
  - §7 收口意见
- cross-e2e 6+ 场景仍未运行(closure §2 P7 + §6 已显式记录)
- 本节 §9 工作日志回填 `docs/action-plan/hero-to-pro/HP7-action-plan.md`(本文件)

### 9.7 测试与回归矩阵

| 包 | typecheck | build | test |
|------|-----------|-------|------|
| `@haimang/nacp-session` | ✅ | ✅ | ✅ 196/196 |
| `@haimang/orchestrator-core-worker` | ✅ | n/a | ✅ 305/305 |
| `@haimang/agent-core-worker` | ✅ | n/a | ✅ 1077/1077 |

cross-e2e 6+ 场景显式留至 HP7 后续批次(见 closure §2 P7)。

