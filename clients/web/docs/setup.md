# nano-agent Web Client — Setup Guide

> **文档版本**: `web-v10`
> **更新日期**: `2026-04-28`
> **适用范围**: `clients/web`

---

## 1. 前置条件

### 1.1 系统要求

- **Node.js**: `>= 18.0.0`
- **包管理器**: `pnpm >= 9.15.0`（与主仓保持一致）
- **浏览器**: 支持 ES2022 的现代浏览器（Chrome 90+, Firefox 90+, Safari 15+, Edge 90+）

### 1.2 环境准备

```bash
# 安装 pnpm（若尚未安装）
npm install -g pnpm

# 确认版本
pnpm --version  # >= 9.15.0
node --version  # >= 18.0.0
```

### 1.3 仓库结构

```text
nano-agent/
├── clients/
│   ├── web/          # 本目录 — Web 客户端
│   └── api-docs/     # API 契约文档（client-facing contract baseline）
├── packages/         # monorepo workspace packages（主仓）
└── ...
```

**重要**: `clients/web` 是 **out-of-workspace** 的 dogfood consumer，不进入根 `pnpm-workspace.yaml`。这确保了 Web 客户端以 published/tarball 路径消费 `@haimang/*` 包，验证真实 consumer 体验。

---

## 2. 本地开发启动

### 2.1 安装依赖

```bash
cd clients/web

# 安装所有依赖
pnpm install
```

### 2.2 配置上游环境

Web 客户端需要指向一个可访问的 `orchestrator-core` facade。默认使用 preview 环境：

```bash
# 方式 1：环境变量（推荐用于临时切换）
export VITE_NANO_BASE_URL="https://your-orchestrator-core.haimang.workers.dev"

# 方式 2：localStorage（浏览器端持久化）
# 在浏览器控制台执行：
localStorage.setItem("nano.baseUrl", "https://your-orchestrator-core.haimang.workers.dev")
```

**默认上游**:
```
https://nano-agent-orchestrator-core-preview.haimang.workers.dev
```

### 2.3 启动开发服务器

```bash
pnpm dev
```

默认在 `http://0.0.0.0:5173` 启动（Vite 默认端口）。

### 2.4 验证启动

1. 浏览器访问 `http://localhost:5173`
2. 应看到 `AuthPage`（登录/注册界面）
3. 使用测试账户注册并登录
4. 进入 Chat 页面，创建新会话并发送消息

---

## 3. 项目结构

```text
clients/web/
├── index.html              # HTML 入口
├── package.json            # 依赖与脚本
├── tsconfig.json           # TypeScript 配置
├── vite.config.ts          # Vite 构建配置
├── functions/              # Cloudflare Pages Functions（BFF）
│   └── api/
│       └── [[path]].ts     # 同域 API 代理路由
├── src/
│   ├── main.tsx            # React 应用入口
│   ├── App.tsx             # 根组件（路由与全局状态）
│   ├── heartbeat.ts        # HeartbeatTracker（WS 心跳工具）
│   ├── styles/
│   │   └── global.css      # 全局样式与 CSS 变量（dark theme）
│   ├── constants/
│   │   └── theme.ts        # 主题常量
│   ├── apis/               # 前端 API 层（按域拆分）
│   │   ├── transport.ts    # HTTP transport + 错误模型
│   │   ├── auth.ts         # 认证 API
│   │   ├── sessions.ts     # 会话 API
│   │   ├── catalog.ts      # 目录 API
│   │   └── debug.ts        # 调试/健康 API
│   ├── state/              # 全局状态（极简，非 Redux）
│   │   ├── auth.ts         # 认证状态（localStorage 持久化）
│   │   └── sessions.ts     # 会话列表状态
│   ├── components/         # 共享组件
│   │   ├── AppShell.tsx    # 应用外壳（sidebar + topbar + main + inspector）
│   │   ├── Sidebar.tsx     # 侧边栏（导航 + 会话列表）
│   │   ├── Topbar.tsx      # 顶部栏
│   │   ├── MainPanel.tsx   # 主内容区
│   │   ├── InspectorPanel.tsx # 右侧面板容器
│   │   ├── SessionList.tsx # 会话列表组件
│   │   └── inspector/
│   │       └── InspectorTabs.tsx # 检查器标签页
│   └── pages/              # 页面组件
│       ├── AuthPage.tsx    # 认证页
│       ├── ChatPage.tsx    # 聊天页（核心）
│       ├── SettingsPage.tsx # 设置页
│       ├── CatalogPage.tsx # 目录页
│       └── HealthPage.tsx  # 健康检查页
└── docs/                   # 文档
    ├── charter/
    │   └── web-v10-foundations.md    # 基石文档
    ├── action-plan/web-v10/
    │   ├── F0-foundation-freeze.md
    │   ├── F1-react-shell-reset.md
    │   ├── F2-bff-and-transport-split.md
    │   ├── F3-auth-and-session-navigation.md
    │   ├── F4-chat-mainline-and-stream.md
    │   ├── F5-inspector-and-delivery-hardening.md
    │   └── F6-closure-and-handoff.md
    └── closure/
        └── web-v10-closure.md        # 收口文档
```

---

## 4. 可用脚本

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动开发服务器（`vite --host 0.0.0.0`） |
| `pnpm build` | 生产构建（`tsc --noEmit && vite build`） |
| `pnpm preview` | 预览生产构建（`vite preview --host 0.0.0.0`） |

---

## 5. 本地调试要点

### 5.1 认证流程

1. 首次访问时，若未登录，自动跳转到 `AuthPage`
2. 注册或登录后，token 持久化到 `localStorage`（key: `nano.auth`）
3. 刷新页面后自动恢复登录态

### 5.2 会话流程

1. 登录后进入 `ChatPage`
2. 左侧 `Sidebar` 显示会话列表（来自 `/me/sessions`）
3. 点击 "New Session" 创建新会话（server-mint UUID）
4. 在聊天输入框发送消息，首次调用 `POST /sessions/{id}/start`，后续调用 `POST /sessions/{id}/input`
5. WebSocket 自动连接，接收流式输出

### 5.3 切换上游环境

```javascript
// 在浏览器控制台切换上游（会触发页面刷新）
localStorage.setItem("nano.baseUrl", "https://another-orchestrator.haimang.workers.dev");
location.reload();
```

### 5.4 清空本地状态

```javascript
// 退出登录并清空所有本地状态
localStorage.removeItem("nano.auth");
localStorage.removeItem("nano.baseUrl");
location.reload();
```

---

## 6. 常见问题

### Q1: `pnpm install` 时找不到 `@haimang/nacp-session`

**原因**: `clients/web` 是 out-of-workspace consumer，依赖需要通过 npm registry 或本地 tarball 安装。

**解决**: 确保 `@haimang/*` 包已发布到 registry，或从主仓构建 tarball：
```bash
# 在主仓根目录
cd /workspace/repo/nano-agent
pnpm -r build
pnpm -r pack
# 然后手动安装 tarball 到 clients/web
```

### Q2: 构建失败，提示 React 类型错误

**解决**: 确保已安装 `@types/react` 和 `@types/react-dom`：
```bash
cd clients/web
pnpm add -D @types/react @types/react-dom
```

### Q3: WebSocket 连接失败

**排查步骤**:
1. 检查 `VITE_NANO_BASE_URL` 或 `localStorage` 中的上游地址是否正确
2. 确认上游 `orchestrator-core` 的 `/sessions/{id}/ws` 端点可用
3. 检查浏览器 Network 面板，确认 WS 握手请求

### Q4: BFF (`/api/*`) 返回 404

**原因**: BFF 仅在 Cloudflare Pages 环境中运行（`functions/api/[[path]].ts`）。本地 `pnpm dev` 时，前端直接访问 upstream。

**解决**: 这是预期行为。本地开发时，HTTP 请求通过 `src/apis/transport.ts` 中的逻辑决定走 BFF 还是直连 upstream。`useBff` 默认 `true`，但本地无 Pages Functions 时，transport 会 fallback 到 upstream。

---

## 7. 相关文档

- **基石文档**: `clients/web/docs/charter/web-v10-foundations.md`
- **部署文档**: `clients/web/docs/deployment.md`
- **API 契约**: `clients/web/docs/api-contract.md`
- **公共契约基线**: `clients/api-docs/README.md`
