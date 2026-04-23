# TEMPLATE — Absorption Blueprint

> 用途：为某个 Tier B package / absorption unit 编写进入 `workers/*` 的具体搬迁蓝图  
> 阶段：pre-worker-matrix / W3 配套模板  
> 说明：模板关注 **路径、依赖、测试、风险、证据**；不替代 action-plan

## 0. 文档头

- **源对象**：`packages/<name>/`
- **目标 worker**：`workers/<worker-name>/`
- **blueprint 类型**：representative / optional dry-run / split-package
- **当前状态**：draft / frozen-for-worker-matrix / optional
- **直接上游**：`W3-absorption-map.md`
- **相关原始素材**：
  - `docs/design/pre-worker-matrix/W3-absorption-blueprint-and-dryrun.md`
  - 真实源码路径
  - 相关 tests / context 参考实现路径

## 1. 这个 blueprint 解决什么问题

用 3-5 句话说明：

1. 为什么这个对象适合作为代表性 blueprint
2. 它代表的是哪一类 absorption 难度
3. 进入 worker-matrix 时，这份文档要让实现者少想什么

## 2. 当前代码事实与源路径

### 2.1 package-level 事实

- `package.json` 关键信息
- build / typecheck / test reality
- 是否存在真实跨包 import

### 2.2 核心源码锚点

| 职责 | 源路径 | 备注 |
|---|---|---|
| entry / public API | `...` |  |
| domain model | `...` |  |
| runtime glue | `...` |  |
| adapters / capabilities | `...` |  |
| tests | `...` |  |

## 3. 目标落点

### 3.1 建议目录结构

```text
workers/<worker-name>/
  src/
    ...
  test/
    ...
```

### 3.2 文件映射表

| 源文件/目录 | 目标文件/目录 | 搬迁方式 | 备注 |
|---|---|---|---|
| `packages/<name>/src/...` | `workers/<worker>/src/...` | 原样移动 / 拆分 / 重写壳 |  |

## 4. 依赖与 import 处理

### 4.1 保留为 package dependency 的内容

- `@haimang/nacp-core`
- `@haimang/nacp-session`
- 其他仍不应 absorb 的共享包

### 4.2 跟随 absorb 一起内化的内容

- 说明哪些目录要一起移入 worker
- 说明哪些 helper 只能保留一个 owner

### 4.3 明确不在本 blueprint 内解决的依赖

- 留给 worker-matrix P0/P1 的 seam
- 留给后续 action-plan 的 remote binding / deploy glue

## 5. 测试与验证继承

| 当前测试面 | 进入 worker 后如何继承 |
|---|---|
| unit tests | 原样迁移 / 改 import path |
| integration tests | 保留在根 `test/` / worker 内新增 smoke |
| cross-package tests | 哪些应继续留在 repo root |

## 6. 风险与禁止事项

### 6.1 主要风险

1. import path 漂移
2. worker 壳与原 package 同时存活时的重复 owner
3. tests 绿但 deploy glue 仍为空

### 6.2 明确禁止

1. 把 blueprint 写成 action-plan checklist
2. 偷偷扩 scope，顺手重构 unrelated API
3. 把当前 `partial / deferred` 能力写成“进入 worker 就自动完整”

## 7. 收口证据

至少给出以下证据位：

1. 源路径列表
2. 目标路径列表
3. 依赖处理说明
4. 测试迁移说明
5. optional / deferred 项声明

## 8. 一句话 verdict

用一句话说明：

- 这份 blueprint 在 worker-matrix 里是“直接照着做”
- 还是“只作代表，不构成强 gate”
