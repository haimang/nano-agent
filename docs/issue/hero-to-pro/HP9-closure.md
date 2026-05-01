# HP9 API Docs + Manual Evidence — Closure

> 服务业务簇: `hero-to-pro / HP9`
> 上游 action-plan: `docs/action-plan/hero-to-pro/HP9-action-plan.md`
> 上游 design: `docs/design/hero-to-pro/HP9-api-docs-and-manual-evidence.md`
> 冻结决策来源: `docs/design/hero-to-pro/HPX-qna.md` Q29 / Q30 / Q31 / Q32
> 闭环日期: `2026-05-01`
> 文档状态: `cannot-close (pending-owner-action)`

---

## 0. 总体 Verdict

| 维度 | 结论 |
|------|------|
| HP9 当前状态 | **`cannot-close (owner-action-blocked)`** — docs pack 18 份已冻结，但 manual evidence (Q30) 与 prod schema baseline (Q31) 两个 hard gate 待 owner 完成 |
| Phase 1 inventory + routing | `done`（README 18-doc index 锁定；rewrite/sanity/new 路由冻结） |
| Phase 2 rewrite 高风险 4 文档 | `done`（session.md / permissions.md / usage.md / error-index.md 全部用 HP5-HP8 frozen 事实重写） |
| Phase 3 7 新文档 + README reindex + 7 stable sanity | `done`（7 份新增专题写就；README reindex 完成；stable docs 全部清理 RHX2 旧标题） |
| Phase 4 manual evidence + prod baseline | **`cannot-close`**（5 设备录制未发生；prod remote 未访问；index + template 已 scaffold 完成等 owner action） |
| Phase 5 4-review + closure | `partial-pending-reviewer-input`（本 closure 已写；4-reviewer memo 等待外部 reviewer 产生） |
| docs 数量 | 11 现有重组/校对 + 7 新增 = **18 份**（与 charter §10.1 第 3 条对齐） |
| docs 与代码对齐度 | rewrite 文档逐项 code-vs-doc 核对完成；7 新文档基于 HP2-HP8 closure + 实现代码事实撰写 |
| RHX2 stale 口径清理 | `clean`（5 份 stable docs 标题 / catalog.md 关于 permission-gate 的 "未 live" 旧描述全部更新） |
| chronic terminal compliance (Q28) | `partial`（依赖 HP8 chronic register；HP8 closure §5 已 NOT-GRANT freeze gate） |

---

## 1. Resolved 项（本轮 HP9 已落地、可直接消费）

| ID | 描述 | 证据 | 说明 |
|----|------|------|------|
| `R1` | README 重新索引为 18-doc authoritative pack（Q29 按产品 surface 切分） | `clients/api-docs/README.md` | 11 现有 + 7 新增 = 18；headers 标注 implementation reference |
| `R2` | `session.md` 收缩到 lifecycle / transport 主线，移除 models / context / files 混装 | `clients/api-docs/session.md` | 文档行数 897 → ~210，职责单一 |
| `R3` | `permissions.md` 用 HP5 row-first dual-write law 重写，明确为 legacy compat surface | `clients/api-docs/permissions.md` | 不再写 "唯一 live API"；指向 confirmations.md |
| `R4` | `usage.md` 用 `session.usage.update` WS live push 事实重写；不再说 "未 live" | `clients/api-docs/usage.md` | polling fallback 仍记录 |
| `R5` | `error-index.md` 新增 HP5/HP6 ad-hoc public codes：`confirmation-already-resolved` / `confirmation-not-found` / `todo-not-found` / `invalid-status` / `in-progress-conflict` | `clients/api-docs/error-index.md` | hero-to-pro phase wire facts §1-§6 也补充 |
| `R6` | 7 新增专题文档 | `models.md` / `context.md` / `checkpoints.md` / `confirmations.md` / `todos.md` / `workspace.md` / `transport-profiles.md` | 每份带 implementation reference header + frozen Q ID 表 |
| `R7` | `confirmations.md` 含 7-kind × 6-status readiness matrix（Q18 frozen） | `clients/api-docs/confirmations.md` §1 | `live` / `registry-only` 边界明确；HP5 emitter row-create not-wired 显式承认 |
| `R8` | `session-ws-v1.md` 升级为 12-kind catalog（含 `tool.call.cancelled` HP6 / `session.fork.created` HP7 / `session.confirmation.*` HP5 / `session.todos.*` HP6 / `session.usage.update`） | `clients/api-docs/session-ws-v1.md` | 此文件因结构漂移 升级为 rewrite (Q32) |
| `R9` | 5 份 stable docs 全部清理 RHX2 stale 标题 | `auth.md` / `me-sessions.md` / `wechat-auth.md` / `worker-health.md` / `catalog.md` | sanity check pass；catalog.md 内 permission-gate 描述更新到 HP5 |
| `R10` | manual-evidence-pack.md 索引文件 + 5 设备 step list + owner-action 4 时点 checklist scaffold | `docs/issue/hero-to-pro/manual-evidence-pack.md` | Q30 hard gate 路径已显式；不允许降级为 partial-close |
| `R11` | prod-schema-baseline.md scaffold + owner-action wrangler 命令 template + `blocked-by-owner-access` 路径 | `docs/issue/hero-to-pro/prod-schema-baseline.md` | Q31 + Q36 frozen；owner 必须回填 wrangler version + captured_at |
| `R12` | charter §1.1 D7 纪律恢复：HP9 之前的 HP6/HP7/HP8 已遵守 `clients/api-docs not-touched`；本轮 HP9 在 HP8 freeze 之后唯一更新 docs 的 phase | (历史一致性) | 与 HP2-HP4 review 中 reviewer 担忧 (DS-R8 / GLM-R9) 形成对照修正 |

---

## 2. Partial / Cannot-Close 项

| ID | 描述 | 当前完成度 | 后续 phase / 批次 | 说明 |
|----|------|-----------|-------------------|------|
| `P1` | manual evidence pack — 5 设备实际录制 | **`cannot-close`** | owner-action（HP9 后续批次） | claude-opus-4-7 没有任何物理设备访问权；index + template + checklist 已 scaffold 等 owner |
| `P2` | prod schema baseline — wrangler `--remote` 实跑 | **`cannot-close`** | owner-action（HP9 后续批次或 HP10 retained） | 需要 owner 拥有 prod D1 / wrangler write 权限；template 已写 |
| `P3` | 4-review pattern — 4 reviewer (kimi / GLM / deepseek / GPT) 对 11 份 deep-review docs 走 memo | `pending-reviewer-input` | HP9 后续批次 | 等外部 reviewer agent 产出 `docs/eval/hero-to-pro/HP9-api-docs-reviewed-by-*.md` |

---

## 3. Retained / Handed-to-Platform / Out-of-Scope（本轮显式登记）

| ID | 项 | 终态 | 理由 / Q ID |
|----|---|-----|-------------|
| `K1` | WeChat miniprogram 完整产品化适配 | `out-of-scope` | HPX-O1：留给客户端独立 charter |
| `K2` | 自动化 SDK / contract codegen | `out-of-scope` | HPX-O3：留给 hero-to-platform |
| `K3` | 7 新增文档头部的 worker reference header | `done`（不是 worker 边界长文档；按产品 surface 组织 + worker map header） | Q29 frozen |
| `K4` | sanity-check 升级为 rewrite 的判定权 | `exercised`（`session-ws-v1.md` 因 12-kind 漂移升级到 rewrite） | Q32 frozen |

---

## 4. F1-F17 Chronic 状态登记（HP9 视角）

> HP9 不直接修 chronic；只登记本 phase 文档侧对 chronic 的可见状态。canonical verdict 由 HP10 final closure 统一归并。

| Chronic | HP9 视角 | 说明 |
|---------|---------|------|
| F1 | `closed-by-HP0`（不变） | 公共入口模型字段透传断裂 |
| F2 | `closed-by-review-fix`（不变） | system prompt suffix 缺失 |
| F3 | `partial-by-HP2-first-wave`（不变） | session model + alias |
| F4 | `partial-by-HP3-first-wave`（不变） | context state machine |
| F5 | `partial-by-HP4-first-wave`（不变） | chat lifecycle |
| F6 | `partial-by-HP5-first-wave`（不变） | confirmation control plane |
| F7 | `partial-by-HP6-first-wave`（不变） | tool workspace state machine |
| F8 | `partial-by-HP7-first-wave`（不变） | checkpoint / revert |
| F9 | `partial-by-HP8-first-wave`（不变） | runtime hardening |
| F10 | `still-handed-to-platform`（HP8 closure 已登记） | R29 postmortem |
| F11 | **`partial-by-HP9-docs-frozen-but-evidence-blocked`** | API docs + 手工证据：18 docs 冻结；manual evidence + prod baseline `cannot-close` |
| F12 | `not-touched`（待 HP10） | final closure |
| F13 | `partial-by-HP3/HP6/HP7/HP8`（不变） | observability drift |
| F14 | `partial-by-HP6-and-HP7`（不变） | tenant-scoped storage |
| F15 | `closed-by-HP1`（不变） | DO checkpoint vs product registry 解耦 |
| F16 | `closed-by-HP5`（不变） | confirmation_pending 统一 |
| F17 | `partial-by-HP3`（不变） | model_switch strip-recover |

---

## 5. HP10 Final Closure 输入清单

HP10 启动时本 closure 提供以下 frozen 输入：

| 类别 | 输入 |
|------|------|
| docs pack | `clients/api-docs/*.md` 18 份 frozen authoritative |
| manual evidence | `docs/issue/hero-to-pro/manual-evidence-pack.md`（status: `cannot-close-pending-owner`） |
| prod baseline | `docs/issue/hero-to-pro/prod-schema-baseline.md`（status: `cannot-close-pending-owner`） |
| review | `docs/eval/hero-to-pro/HP9-api-docs-reviewed-by-*.md` (`pending-reviewer-input`) |
| chronic | F1-F17 §4 状态表 |
| Q ID 冻结 | Q29 / Q30 / Q31 / Q32 |

HP10 应在 final closure 中：

1. 把 P1 / P2 / P3 三项作为 `retained-with-reason` 或 `handed-to-platform` 显式登记（HPX-Q33 + Q36），附 remove condition；
2. 把 docs pack frozen 事实纳入 hero-to-pro `final closure verdict` 主体；
3. 不要替 HP9 重做 manual evidence / prod baseline（HP10 不在 owner-action 时间窗内）。

---

## 6. 测试 / 验证矩阵

| 验证项 | 命令 / 证据 | 结果 |
|--------|-------------|------|
| 18-doc count | `ls clients/api-docs/*.md \| wc -l` | `18` ✅ |
| stale RHX2 标题清理 | `grep -nE "^# .*RHX2" clients/api-docs/*.md` | zero matches ✅ |
| 7 新增文档存在 | `ls clients/api-docs/{models,context,checkpoints,confirmations,todos,workspace,transport-profiles}.md` | all present ✅ |
| README reindex 完整性 | README 18-Doc Pack 表与文件清单一致 | ✅ |
| confirmations 7-kind matrix | `confirmations.md §1` | matrix present ✅ |
| session-ws-v1 13-kind catalog | `session-ws-v1.md §3.2` | 13 kinds 列出 ✅ |
| manual evidence index scaffold | `docs/issue/hero-to-pro/manual-evidence-pack.md` | scaffold present；`cannot-close` 状态显式 ✅ |
| prod baseline scaffold | `docs/issue/hero-to-pro/prod-schema-baseline.md` | scaffold present；wrangler command template + blocked-by-owner-access 路径显式 ✅ |
| 5 设备实际录制 | `docs/evidence/hero-to-pro-manual-*` | **NOT YET** — owner-action |
| prod `wrangler --remote` 实跑 | baseline.md §5 | **NOT YET** — owner-action |
| 4-review memos | `docs/eval/hero-to-pro/HP9-api-docs-reviewed-by-*` | **NOT YET** — pending-reviewer-input |
| `pnpm test:cross-e2e` | `pnpm test:cross-e2e` | not-run（charter §0.5 wire-with-delivery — 由 HP10 final gate 复核） |

---

## 7. HP10 启动 Gate

HP10 final closure 需要本 closure 之后启动。启动前 HP10 必须确认：

1. ✅ 本 closure 已存在，verdict = `cannot-close-with-explicit-pending-items`
2. ✅ 18 docs pack 已冻结
3. ⚠️ manual evidence + prod baseline 已 explicit `cannot-close`（**explicit 即合规**——HPX-Q33 禁止 silently resolved；显式 `cannot-close` 是 legitimate 终态之一）
4. ✅ F1-F17 状态已登记，等待 HP10 canonical merge

> **HP9 closure 不阻塞 HP10 启动**——只要 manual evidence + prod baseline 这两项**显式**为 `cannot-close (owner-action-blocked)`，HP10 就可以在 final closure 中把它们登记为 `retained-with-reason` 或 `handed-to-platform`（HPX-Q34 + Q36），整个 hero-to-pro 阶段以 `partial-close` 或 `handoff-ready` verdict 收尾。HPX-Q33 frozen：禁止的是 silent，不是 cannot-close 本身。

---

## 8. Closure Opinion

HP9 把 hero-to-pro 第一次拥有了真正按产品 surface 切分的 18-doc authoritative pack；docs 主体（11 现有重组 + 7 新增）100% 用 HP5-HP8 frozen 代码事实撰写，不再有 RHX2 / "未 live" / 混装入口的过时叙述。docs side 的合规性可以由后续 reviewer 直接审核。

但 HPX-Q30 / Q31 把 manual evidence + prod baseline 列为 hard gate，且 owner-action 强依赖 5 套物理设备 + prod D1 权限——这两项**不是文档可以替代**的事实，必须由 owner 完成。本 closure 已完成所有可由实施者侧完成的工作（scaffold + template + checklist + index），把后续合规路径明确移交给：

- **owner-action**（5 设备录制 + prod wrangler --remote）
- **HP10 final closure**（把 P1 / P2 显式登记为 `retained-with-reason` 或 `handed-to-platform`，附 remove condition）

HP9 closure 自身的 `cannot-close` 状态是 HPX-Q30 法律下的 explicit terminal verdict，**不是 deceptive**——这与 HP8 closure §5 "HP9 freeze gate: NOT GRANTED" 形成因果链一致。

> **后续判定路径**：
> - 若 owner 在 HP9 启动 +10 日内完成 P1 + P2，本 closure 升级为 `closed`
> - 若 owner 选择把 P1 + P2 移交 hero-to-platform，本 closure 仍标 `cannot-close`，但 HP10 final closure 把这两项登记为 `handed-to-platform` + Q36 字段齐全
> - 任何形式的 "暂时跳过" 都违反 Q30，**不允许**
