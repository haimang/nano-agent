# Hero-to-Pro Prod Schema Baseline — Scaffold + Owner-Action Template

> 文档状态: `cannot-close (owner-access-blocked)` (initial scaffold) → `complete` after owner remote run
> 服务业务簇: `hero-to-pro / HP9`
> 关联 action-plan: `docs/action-plan/hero-to-pro/HP9-action-plan.md` §4.4 P4-02
> 关联 design: `docs/design/hero-to-pro/HP9-api-docs-and-manual-evidence.md` §7 F4
> 冻结决策来源: `docs/design/hero-to-pro/HPX-qna.md` Q31
> 实施者笔记日期: `2026-05-01`

---

## 0. 当前状态

本文件是 hero-to-pro 第一次对 prod remote D1 schema 做 owner-verified 真实事实校对的产物。HPX-Q31 冻结：**必须 remote/prod 校对，禁止以本地 migrations 代替**。

**实施者侧已完成**（claude-opus-4-7，2026-05-01）：

- 本 baseline 文档骨架
- 仓内 committed migrations snapshot 表（§3）
- owner-action 命令 template（§4）
- 一致性判断表 template（§5）
- `blocked-by-owner-access` 显式承接路径（§6）

**owner 侧待完成**（4 项）：

- 在拥有 prod D1 / wrangler 权限的环境运行 §4 命令集
- 把 remote `wrangler d1 migrations list` 输出粘贴回本文件 §5
- 写明 wrangler 版本与 captured_at
- 在 HP9 closure §4 中 schema baseline verdict 行回填 `complete` 或 `blocked-by-owner-access`

---

## 1. Frozen Discipline (HPX-Q31)

baseline 文档**必须**记录：

1. remote command（实际命令字符串）
2. remote result（命令完整 stdout，redact 敏感信息后）
3. committed migrations snapshot（与 §3 比对）
4. 是否一致（`consistent` / `drift-detected` / `unverifiable`）
5. 若 `drift-detected`：差异项 + 补救路径
6. `wrangler --version`（必填）
7. `captured_at`（ISO timestamp，必填）

**不允许**：
- 把 preview 结果当 prod
- 只保留命令输出而不形成本 markdown
- 以本地 `migrations/` 目录列表代替 remote

---

## 2. Owner-Verified Field Slot（待 owner 回填）

```yaml
captured_at: <pending-owner-run>
captured_by: <pending-owner-run>
wrangler_version: <pending-owner-run>
remote_environment: production
worker: nano-agent-orchestrator-core
d1_database: nano-agent-d1-prod
verdict: pending
```

---

## 3. Committed Migrations Snapshot（仓内事实）

来源：`workers/orchestrator-core/migrations/`，HP8 freeze (2026-04-30) 后冻结：

| # | File | Phase | Description |
|---|------|-------|-------------|
| 001 | `001-bootstrap.sql` | RHX2 | initial schema |
| 002 | `002-session-truth-and-audit.sql` | RHX2 | session truth + audit |
| 003 | `003-trace-and-stream-cursor.sql` | RHX2 | trace + stream cursor |
| 004 | `004-message-and-conversation.sql` | RHX2 | message + conversation |
| 005 | `005-quota-and-usage.sql` | RHX2 | quota + usage |
| 006 | `006-checkpoints-and-files.sql` | RHX2 | checkpoint + file |
| 007 | `007-model-metadata-and-aliases.sql` | HP1 | nano_models metadata + aliases |
| 008 | `008-session-model-audit.sql` | HP1 | session.default_* + turn audit |
| 009 | `009-turn-attempt-and-message-supersede.sql` | HP1 | turn_attempt + supersede + deleted_at |
| 010 | `010-agentic-loop-todos.sql` | HP1 | nano_session_todos |
| 011 | `011-session-temp-files-and-provenance.sql` | HP1 | nano_session_temp_files + provenance |
| 012 | `012-session-confirmations.sql` | HP1 | nano_session_confirmations |
| 013 | `013-product-checkpoints.sql` | HP1 | checkpoints + snapshots + restore_jobs + cleanup_jobs |
| 014 | `014-session-model-fallback-reason.sql` | HP2 (charter §4.4 R8 受控例外) | fallback_reason 列 |

`migration_count: 14`（HP8 freeze 之后未新增 migration；hero-to-pro 阶段 DDL freeze 已闭合）。

---

## 4. Owner-Action Command Template

> Owner 必须在拥有 prod D1 与 wrangler write permission 的环境执行以下命令，并把完整 stdout 贴回 §5。

```bash
# 0. 先记录 wrangler 版本
wrangler --version

# 1. 列出 prod remote migrations 已应用清单
wrangler d1 migrations list nano-agent-d1-prod \
    --remote \
    --config workers/orchestrator-core/wrangler.jsonc

# 2. (可选) prod schema dump 用于深度对照
wrangler d1 execute nano-agent-d1-prod --remote --json \
    --config workers/orchestrator-core/wrangler.jsonc \
    --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"

# 3. (可选) 关键字段确认
wrangler d1 execute nano-agent-d1-prod --remote --json \
    --config workers/orchestrator-core/wrangler.jsonc \
    --command "PRAGMA table_info(nano_session_confirmations)"

wrangler d1 execute nano-agent-d1-prod --remote --json \
    --config workers/orchestrator-core/wrangler.jsonc \
    --command "PRAGMA table_info(nano_session_temp_files)"

wrangler d1 execute nano-agent-d1-prod --remote --json \
    --config workers/orchestrator-core/wrangler.jsonc \
    --command "PRAGMA table_info(nano_session_todos)"

wrangler d1 execute nano-agent-d1-prod --remote --json \
    --config workers/orchestrator-core/wrangler.jsonc \
    --command "PRAGMA table_info(nano_conversation_sessions)"
```

**Redaction reminder**：粘贴 stdout 前请检查没有 secrets / 内部 IP / 个人数据。

---

## 5. Owner-Verified Result（待回填）

### 5.1 wrangler version

```text
<待 owner 粘贴 stdout of `wrangler --version`>
```

### 5.2 prod remote migrations list

```text
<待 owner 粘贴 stdout of `wrangler d1 migrations list ... --remote`>
```

### 5.3 (optional) schema dump

```text
<待 owner 粘贴关键 PRAGMA / SELECT 输出>
```

### 5.4 一致性判断（待 owner 回填）

| 维度 | 仓内 (committed) | prod remote | verdict |
|------|------------------|-------------|---------|
| migration count | 14 | (待) | (待) |
| 最新 migration | `014-session-model-fallback-reason` | (待) | (待) |
| `nano_session_confirmations` 是否存在 | yes | (待) | (待) |
| `nano_session_temp_files` 是否存在 | yes | (待) | (待) |
| `nano_session_todos` 是否存在 | yes | (待) | (待) |
| `fallback_reason` column 是否在 `nano_conversation_sessions` | yes | (待) | (待) |

**verdict** ∈ `{consistent, drift-detected, unverifiable}`：

```yaml
overall_verdict: pending
```

### 5.5 若 `drift-detected` — 差异项与补救路径

```yaml
drifts: []   # owner 回填具体 drift item
remediation: pending
```

---

## 6. `blocked-by-owner-access` 路径

如果 owner 临时没有 prod D1 / wrangler write 权限，必须显式标：

```yaml
overall_verdict: blocked-by-owner-access
blocked_reason: <具体说明，如 "owner credential rotation in progress, ETA 2026-05-XX">
escalation_path: HP10 retained-with-reason registry  # 必填
remove_condition: "wrangler d1 migrations list --remote completes successfully against prod"  # 必填
```

> **HPX-Q31 + HPX-Q36 frozen**：blocked 路径下，本 baseline **必须**进入 HP10 retained registry 并附带可观察 remove condition；HP9 closure 不允许把 blocked 当作 `complete` 处理。

---

## 7. Future Automation Hooks

未来可能演进方向（不属于 HP9 scope）：

- 自动 diff tool（对比 committed migrations vs remote applied）
- 周期性 `wrangler d1 migrations list --remote` cron + 异常告警
- staging / prod pair 一致性验证

这些都在 hero-to-platform 阶段可考虑，本文件不规划。

---

## 8. Frozen Decisions

| Q ID | 内容 | 影响 |
|------|------|------|
| Q31 | prod schema baseline 必须 remote/prod 校对 | 不允许以本地 migrations 代替；不允许只输出命令而不 markdown |
| Q31 (子条款) | wrangler 版本与 captured_at 必填 | 用于审计 baseline 抓取时刻 |
| Q36 | retained-with-reason 必须可观察 remove condition | blocked 路径下本文件进入 HP10 retained 时必须附 `remove_condition` |
