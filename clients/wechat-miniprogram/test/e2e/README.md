# E2E 测试说明

## 技术方案

采用 **Node.js + vitest/jest**，通过 mock `wx.request` 和 `wx.connectSocket` 来测试 `api/` 层函数。

**不依赖小程序运行时**，直接在后端真实环境（preview）上运行。

## 运行方式

```bash
# 进入小程序目录
cd clients/wechat-miniprogram

# 安装依赖（如使用 vitest）
npm install -D vitest

# 运行测试
npx vitest run

# 或持续监听模式
npx vitest
```

## 测试范围

- `auth.e2e.js` - 覆盖注册、登录、微信登录、获取用户信息
- `session.e2e.js` - 覆盖创建会话、启动、输入、WS 接收事件
- `me.e2e.js` - 覆盖创建会话与列表查询

## 环境要求

- Node.js >= 18
- 预览环境 `https://nano-agent-orchestrator-core-preview.haimang.workers.dev` 可用
- 网络可访问外域

## Mock 说明

测试中对 `wx` 全局对象进行 mock：
- `wx.request` → 使用 node-fetch 或原生 fetch 发送真实 HTTP 请求
- `wx.connectSocket` → 使用 ws 库建立真实 WebSocket 连接
- `wx.getStorageSync`/`wx.setStorageSync` → 使用内存 Map 模拟
