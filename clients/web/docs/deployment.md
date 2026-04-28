# nano-agent Web Client — Deployment Guide

> **文档版本**: `web-v10`
> **更新日期**: `2026-04-28`
> **适用范围**: `clients/web`
> **目标平台**: Cloudflare Pages

---

## 1. 部署架构

```text
┌─────────────────────────────────────────────────────────────┐
│                        Cloudflare Pages                      │
│  ┌──────────────────┐      ┌─────────────────────────────┐  │
│  │   Static Assets   │      │   Pages Functions (BFF)     │  │
│  │   (React SPA)     │      │   functions/api/[[path]].ts │  │
│  │                   │      │                             │  │
│  │  index.html       │      │  /api/auth/*               │  │
│  │  dist/*           │      │  /api/me/*                 │  │
│  │                   │      │  /api/sessions/*           │  │
│  └──────────────────┘      │  /api/catalog/*            │  │
│           │                │  /api/debug/*              │  │
│           │                └─────────────────────────────┘  │
│           │                         │                       │
│           │                         ▼                       │
│           │              orchestrator-core (upstream)       │
│           │              (Cloudflare Workers)               │
│           │                                               │
│           └───────────────────────────────────────────────┘
│                           WebSocket (direct)
│                              ▼
│                   orchestrator-core WS endpoint
└─────────────────────────────────────────────────────────────┘
```

### 1.1 部署原则

| 原则 | 说明 |
|------|------|
| **Same-origin BFF** | HTTP 请求统一走 `/api/*` Pages Functions，由 BFF 代理到 upstream |
| **Direct WS** | WebSocket 直连 orchestrator-core（foundation 阶段的受控例外） |
| **Static SPA** | React 应用构建为静态资源，由 Pages 托管 |

---

## 2. 部署前准备

### 2.1 环境变量

在 Cloudflare Pages 项目设置中配置以下环境变量：

| 变量名 | 必需 | 说明 | 示例 |
|--------|------|------|------|
| `VITE_NANO_BASE_URL` | 是 | upstream orchestrator-core 地址 | `https://nano-agent-orchestrator-core-preview.haimang.workers.dev` |

### 2.2 构建配置

Pages 构建配置（Dashboard → Project → Settings → Builds）：

| 配置项 | 值 |
|--------|-----|
| **Build command** | `pnpm build` |
| **Build output directory** | `dist` |
| **Root directory** | `clients/web` |

### 2.3 依赖安装

Pages 使用 `pnpm` 安装依赖（通过 `packageManager` 字段自动识别）：

```json
// clients/web/package.json
{
  "packageManager": "pnpm@9.15.0"
}
```

---

## 3. 部署步骤

### 3.1 首次部署（手动）

#### 步骤 1：创建 Pages 项目

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **Pages** → **Create a project**
3. 选择连接 GitHub/GitLab 仓库或直接上传

#### 步骤 2：配置构建设置

```yaml
# 等效的 wrangler.toml 配置片段（参考）
name = "nano-agent-web"
compatibility_date = "2026-04-28"

[build]
command = "pnpm build"
cwd = "clients/web"

[site]
bucket = "./dist"
```

#### 步骤 3：设置环境变量

在 Pages Dashboard → Settings → Environment variables 中：

```
VITE_NANO_BASE_URL=https://nano-agent-orchestrator-core-preview.haimang.workers.dev
```

#### 步骤 4：部署

点击 **Save and Deploy**，等待构建完成。

### 3.2 持续部署（Git 集成）

推荐配置 Git 集成实现自动部署：

```yaml
# .github/workflows/deploy-web.yml（示例）
name: Deploy Web Client

on:
  push:
    branches: [main]
    paths: ['clients/web/**']

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.15.0
      - run: pnpm install
        working-directory: clients/web
      - run: pnpm build
        working-directory: clients/web
      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy clients/web/dist --project-name=nano-agent-web
```

### 3.3 本地预览（生产构建）

```bash
cd clients/web

# 构建生产版本
pnpm build

# 本地预览
pnpm preview
```

---

## 4. 环境管理

### 4.1 多环境部署

| 环境 | 域名示例 | upstream | 用途 |
|------|----------|----------|------|
| **Preview** | `preview.nano-agent-web.pages.dev` | preview worker | 功能验证 |
| **Production** | `nano-agent-web.pages.dev` | production worker | 线上服务 |

### 4.2 环境变量隔离

在 Pages Dashboard 中，为不同环境设置不同的 `VITE_NANO_BASE_URL`：

- **Production environment**: 指向 production orchestrator-core
- **Preview environment**: 指向 preview orchestrator-core

---

## 5. 验证部署

### 5.1 基础健康检查

```bash
# 检查静态资源
curl https://<your-domain>/index.html

# 检查 BFF 代理
curl https://<your-domain>/api/auth/login \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test"}'

# 应返回 401 或标准 facade error envelope
```

### 5.2 端到端验证

1. 访问部署后的域名
2. 注册/登录测试账户
3. 创建新会话
4. 发送消息并确认流式输出正常
5. 刷新页面，确认会话恢复（resume/timeline）
6. 检查 inspector 面板数据加载

---

## 6. 故障排查

### 6.1 构建失败

**症状**: Pages 构建日志显示 `vite build` 失败

**排查**:
```bash
# 本地复现
cd clients/web
pnpm install
pnpm build
```

常见原因：
- TypeScript 类型错误（运行 `pnpm build` 查看）
- 缺少 `@types/react` 等类型定义

### 6.2 BFF 404

**症状**: `/api/*` 请求返回 404

**原因**: Pages Functions 未正确部署

**解决**:
1. 确认 `functions/api/[[path]].ts` 在构建输出中
2. 检查 Pages Dashboard → Functions 标签页是否有函数部署记录
3. 确认 `wrangler.toml` 或构建配置正确

### 6.3 CORS 错误

**症状**: 浏览器控制台显示 CORS 错误

**原因**: BFF 未正确添加 CORS headers

**解决**: 检查 `functions/api/[[path]].ts` 中的 `access-control-allow-*` headers 是否正确设置。

### 6.4 WS 连接失败

**症状**: 聊天流式输出不工作

**排查**:
1. 检查上游 `orchestrator-core` 的 WS 端点是否可访问
2. 确认 `VITE_NANO_BASE_URL` 环境变量正确
3. 检查浏览器 Network 面板的 WS 握手请求

---

## 7. 回滚策略

### 7.1 快速回滚

Cloudflare Pages 保留最近部署历史，可通过 Dashboard 一键回滚到上一版本。

### 7.2 紧急切换上游

若 upstream 出现故障，可临时切换 `VITE_NANO_BASE_URL` 到备用环境并重新部署。

---

## 8. 安全注意事项

1. **不要在客户端代码中硬编码敏感信息**（API keys、secrets）
2. **Bearer token 存储**: 当前使用 `localStorage`，后续应考虑更安全的存储方案
3. **CORS 配置**: BFF 已设置 `access-control-allow-origin: *`，production 环境应根据实际需求收紧
4. **WS 鉴权**: 通过 query parameter 传递 `access_token`，后续应考虑 ticket/gateway 方案

---

## 9. 相关文档

- **本地运行**: `clients/web/docs/setup.md`
- **API 契约**: `clients/web/docs/api-contract.md`
- **基石文档**: `clients/web/docs/charter/web-v10-foundations.md`
