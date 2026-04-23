# W4 Closure — `workers/` Scaffolding & Deploy Validation

> 阶段: `pre-worker-matrix / W4`
> 状态: `closed (real preview deploy completed)`
> 作者: `GPT-5.4`
> 时间: `2026-04-23`
> 对应 action-plan: `docs/action-plan/pre-worker-matrix/W4-workers-scaffolding.md`
> 对应 design: `docs/design/pre-worker-matrix/W4-workers-scaffolding.md`

---

## 1. 结论

W4 已达到 **脚手架阶段** 的关闭条件。

本轮真实完成的不是 4 个业务 worker，也不是 1 个 live host + 3 个 live capability workers；而是：

1. `workers/` 顶级目录已经成为物理事实
2. `agent-core` / `bash-core` / `context-core` / `filesystem-core` 四个 deploy-shaped shell 已建立
3. `agent-core` 的 `SESSION_DO` slot 已通过 stub class 落地
4. 4 个 worker 的 build / smoke test / `wrangler deploy --dry-run` 已通过
5. 当前执行环境已通过 `npx wrangler whoami` 验证出可用的 Wrangler OAuth token，且 `agent-core` real preview deploy 已完成

因此，W4 的最终状态是：

> **worker-matrix P0 已经拥有稳定的 `workers/*` 外壳与 DevOps 验证路径，并且 `agent-core` 已完成真实 preview deploy。**

---

## 2. 实际交付

### 2.1 代码 / 配置

- `pnpm-workspace.yaml`
  - 新增 `workers/*`
- `.github/workflows/workers.yml`
  - 新建 matrix workflow
  - 按 worker 维度执行 build / test / dry-run
- `workers/agent-core/*`
  - `wrangler.jsonc` / `package.json` / `tsconfig.json` / `README.md` / `.gitignore`
  - `src/index.ts` + `src/types.ts` + `src/nano-session-do.ts`
  - `test/smoke.test.ts`
- `workers/bash-core/*`
  - shell files + smoke test
- `workers/context-core/*`
  - shell files + smoke test
- `workers/filesystem-core/*`
  - shell files + smoke test

### 2.2 当前依赖解析路径

W4 本轮实际采用：

1. `@haimang/nacp-core: workspace:*`
2. `@haimang/nacp-session: workspace:*`

原因不是 W2 published path 不存在，而是：

1. W2 已经完成 `@haimang/*` 首发
2. 但在 monorepo 内先用 workspace path 建立 shell / CI / dry-run，更适合作为第一轮脚手架基线
3. published path 继续保留为后续 cutover 的真实选项

### 2.3 agent-core 特殊处理

`agent-core` 本轮多出的 W4 特征：

1. `wrangler.jsonc` 激活 `SESSION_DO` binding
2. `src/nano-session-do.ts` 提供 `NanoSessionDO` stub
3. `test/smoke.test.ts` 同时验证 worker shell 与 DO stub 响应
4. 未来 `BASH_CORE / CONTEXT_CORE / FILESYSTEM_CORE` service bindings 保持 **注释态 documented future slots**

---

## 3. Mandatory / Optional 状态裁定

| 项目 | 设计定位 | 本轮实际结果 | 裁定 |
|---|---|---|---|
| `workers/` 顶级目录 | mandatory | 已创建 | `done` |
| 4 个 worker shell | mandatory | 已创建并同构 | `done` |
| `agent-core` DO slot + stub | mandatory | 已创建 | `done` |
| workspace 接入 | mandatory | 已完成 | `done` |
| matrix CI workflow | mandatory | 已完成 | `done` |
| 4 个 worker build/test | mandatory | 已完成 | `done` |
| 4 个 worker dry-run | mandatory | 已完成 | `done` |
| `agent-core` real preview deploy | mandatory in ideal path / fallback allowed | 已完成 | `done` |
| W4 closure memo | mandatory | 本文件 | `done` |

---

## 4. 关键现实对齐

### 4.1 W3 → W4 的衔接

W3 的最终结论是：

1. optional capability-runtime dry-run **未执行**
2. `workers/bash-core/` 等落点只是 blueprint 指向，不是已存在目录

因此 W4 是 **第一次** 把 `workers/*` 变成真实仓库结构，而不是接手一个半完成的 workers skeleton。

### 4.2 为什么本轮不激活 agent-core 的 service bindings

若在只有 `agent-core` 计划 real deploy、其余 3 个 worker 只做 dry-run 的前提下，直接启用：

- `BASH_CORE`
- `CONTEXT_CORE`
- `FILESYSTEM_CORE`

则 `agent-core` preview deploy 会依赖尚未真实存在的 downstream Worker 服务名。

这与 W4 narrowed scope 冲突，因为 W4 明确 **不负责**：

1. cross-worker 真联通
2. 其余 3 个 worker 的真实 deploy

因此本轮选择：

1. 保留 service bindings 为 documented future slots
2. 只激活 `SESSION_DO`
3. 让 `agent-core` 首先成为 **deploy-shaped host shell**

### 4.3 为什么本轮不再保留 fallback 口径

当前执行环境的硬事实：

```text
npx wrangler whoami
→ logged in with an OAuth token
→ workers (write)
```

因此本轮可以诚实完成：

```bash
cd workers/agent-core
pnpm deploy:preview
curl <preview-url>
```

实际结果：

1. `pnpm deploy:preview` 成功
2. preview URL 已可访问
3. `curl` 已返回 live JSON

---

## 5. 实际证据

### 5.1 workers 目录快照（tracked shape）

```text
workers/
  agent-core/
    .gitignore
    README.md
    package.json
    tsconfig.json
    wrangler.jsonc
    src/
    test/
  bash-core/
    .gitignore
    README.md
    package.json
    tsconfig.json
    wrangler.jsonc
    src/
    test/
  context-core/
    .gitignore
    README.md
    package.json
    tsconfig.json
    wrangler.jsonc
    src/
    test/
  filesystem-core/
    .gitignore
    README.md
    package.json
    tsconfig.json
    wrangler.jsonc
    src/
    test/
```

### 5.2 本地验证命令

本轮实际完成：

1. install / local worker validation
   ```bash
   pnpm install
   pnpm --filter @haimang/nacp-core build
   pnpm --filter @haimang/nacp-session build
   pnpm --filter './workers/*' typecheck
   pnpm --filter './workers/*' build
   pnpm --filter './workers/*' test
   pnpm --filter './workers/*' deploy:dry-run
   ```
2. full repo regression
   ```bash
   pnpm -r run typecheck
   pnpm -r run test
   node --test test/*.test.mjs
   npm run test:cross
   ```

全部通过。

### 5.3 dry-run 摘要

**agent-core**

```text
Binding                              Resource
env.SESSION_DO (NanoSessionDO)       Durable Object
env.ENVIRONMENT ("preview")          Environment Variable
env.OWNER_TAG ("nano-agent")         Environment Variable

--dry-run: exiting now.
```

**bash-core**

```text
Binding                             Resource
env.ENVIRONMENT ("preview")         Environment Variable
env.OWNER_TAG ("nano-agent")        Environment Variable

--dry-run: exiting now.
```

**context-core**

```text
Binding                             Resource
env.ENVIRONMENT ("preview")         Environment Variable
env.OWNER_TAG ("nano-agent")        Environment Variable

--dry-run: exiting now.
```

**filesystem-core**

```text
Binding                             Resource
env.ENVIRONMENT ("preview")         Environment Variable
env.OWNER_TAG ("nano-agent")        Environment Variable

--dry-run: exiting now.
```

### 5.4 Wrangler auth + live deploy 证据

```text
npx wrangler whoami
logged in with an OAuth Token
workers (write)
```

```text
pnpm deploy:preview
Uploaded nano-agent-agent-core-preview
Deployed nano-agent-agent-core-preview
https://nano-agent-agent-core-preview.haimang.workers.dev
Current Version ID: 05baa0b9-2f0a-4982-b036-1855ca97439a
```

```json
{"worker":"agent-core","nacp_core_version":"1.4.0","nacp_session_version":"1.3.0","status":"ok","phase":"pre-worker-matrix-W4-shell"}
```

---

## 6. 对 W5 / worker-matrix P0 的意义

W4 现在给下游的是 4 条更稳定的基线：

1. **目录基线**：worker-matrix P0 不需要再重建 `workers/*` 外壳
2. **DevOps 基线**：Wrangler config / TS build / smoke test / dry-run 路径已经验证过
3. **Host shell 基线**：`agent-core` 的 Durable Object slot 已有最小可替换 stub，且 preview deploy 已验证它能真实上线
4. **切换基线**：当前 workers 走 `workspace:*`，未来仍可按 W2 truth 切到 `@haimang/*` published path

---

## 7. 遗留项与后续交接

### 7.1 本轮未解决但已诚实归档的项

1. `BASH_CORE / CONTEXT_CORE / FILESYSTEM_CORE` service binding activation
2. KV / R2 等 owner-managed bindings

### 7.2 下一阶段如何接手

1. worker-matrix P0 直接在现有 `workers/*/src/` 内吸收业务代码
2. downstream workers 获得 real deploy 后，再解除 `agent-core` 里注释掉的 service bindings
3. 若未来需要刷新 preview，只需在现有 shell 上重复 `pnpm deploy:preview`

---

## 8. 最终 verdict

**W4 可以关闭，而且关闭形态已经从 fallback 升级为真实完成：**

1. `workers/` 与四个 deploy-shaped shell 已完成
2. `agent-core` DO slot 已存在
3. 4 个 worker 的 build/test/dry-run 已全部成立
4. `agent-core` preview URL 已真实上线并返回正确的 NACP version probe JSON

换句话说，W4 已经把 **“worker 壳是否存在、是否能被 monorepo 与 Wrangler 识别，以及 agent-core 能否真实部署到 Cloudflare”** 这三个问题一起关闭；剩下的是 worker-matrix P0 的真实业务吸收与后续 cross-worker wiring。
