# Nano-Agent Issue Tracker (Markdown SOT)

> **业主决策（2026-04-19）**：本项目所有 issue 在 `docs/issue/{phase}/` 下以 markdown 文件管理，**不使用 GitHub Issue tracker**——避免双真相层（GitHub UI vs repo docs）。

---

## 目录布局

```
docs/issue/
├── README.md                         # 本文件
├── after-foundations/                # Phase: After-Foundations (B1-B8)
│   ├── B1-phase-1-closure.md
│   ├── B1-phase-2-closure.md
│   └── ...
├── after-skeleton/                   # Phase: After-Skeleton (历史，A1-A10)
│   └── ...                           # 之前的 issue 也可逐步迁入
└── (后续 phase 同款)/
```

## Issue 文件命名

`{action-plan-id}-{slug}.md`，例：
- `B1-phase-1-closure.md`
- `B1-phase-2-closure.md`
- `B2-storage-adapter-RFC.md`
- `B4-context-management-package-skeleton.md`

## Issue 文档结构（最小要求）

每份 issue 文件顶部必须有 frontmatter-style metadata：

```markdown
# [{action-plan-id} / {short-title}] {full title}

> **Issue ID**: `{slug}`
> **Action plan**: `docs/action-plan/{phase}/{file}.md`
> **Phase**: {N} — {Phase name}
> **Status**: open | in-progress | closed | dismissed
> **Created**: YYYY-MM-DD
> **Closed**: YYYY-MM-DD (或 -)
> **Owner**: {who}
```

正文内容因 issue 类型而异（closure / writeback / question / blocker），但**必须包含**：

- Summary 一段话
- 与 spike finding 关联（如 `docs/spikes/{namespace}/{NN}-{slug}.md`）
- 与 charter / design / action-plan 的 reference
- Verdict / next step

## 与 spike finding 的关系

- **Spike finding**（`docs/spikes/{namespace}/{NN}-{slug}.md`）= 单条 platform truth 发现
- **Issue**（`docs/issue/{phase}/{slug}.md`）= phase 级行政单位（closure verdict / writeback action / question / blocker）

一个 phase closure issue 可以 reference 多条 spike finding；一条 spike finding 可以触发一个或多个 issue。

## 历史 GitHub issue 处理

之前在 `https://github.com/haimang/nano-agent/issues/` 创建过的 issue（仅 #1）已在本文件 ship 后被 close 并指向 docs/issue/。后续不再创建 GitHub issue。

## 与 action-plan 的双向链接

- 每个 action-plan（`docs/action-plan/{phase}/{file}.md`）的 §6 Q&A 处理涉及 issue 的，必须 link 到 `docs/issue/{phase}/`
- 每个 issue 的 metadata 必须 link 回对应 action-plan
