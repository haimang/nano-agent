# Nano Agent 微信小程序同步开发与测试方案

## 1. 现状分析

### 1.1 orchestrator-core 接口现状

通过分析 `workers/orchestrator-core/src/index.ts`，当前对外暴露的接口如下：

**公共接口（无需认证）：**
- `GET /` / `/health` - 健康检查，返回 `{ worker, nacp_core_version, status, phase, public_facade, agent_binding }`

**认证接口（代理到 ORCHESTRATOR_AUTH）：**
- `POST /auth/register` - email/password 注册
- `POST /auth/login` - email/password 登录
- `POST /auth/refresh` - 刷新 access_token
- `POST /auth/verify` - 验证 token 有效性
- `GET|POST /auth/me` - 获取当前用户信息
- `POST /auth/password/reset` - 重置密码
- `POST /auth/wechat/login` - 微信 code 登录

**会话接口（需要 JWT + tenant）：**
- `POST /sessions/:uuid/start` - 开始新会话，body: `{ initial_input?, text? }`
- `POST /sessions/:uuid/input` - 发送输入，body: `{ text? }`
- `POST /sessions/:uuid/cancel` - 取消会话，body: `{ reason? }`
- `GET /sessions/:uuid/status` - 获取会话状态
- `GET /sessions/:uuid/timeline` - 获取事件时间线
- `GET /sessions/:uuid/history` - 获取历史记录
- `POST /sessions/:uuid/verify` - 验证会话
- `GET /sessions/:uuid/ws` - WebSocket 连接（支持 query_token）

**统一响应格式：**
```json
// 成功
{ "ok": true, "data": { ... } }

// 失败
{ "ok": false, "error": { "code": "...", "message": "...", "status": 400 } }
```

**WebSocket 协议：**
- 连接 URL: `wss://host/sessions/:uuid/ws?access_token=xxx&trace_uuid=xxx&last_seen_seq=0`
- 客户端发送: `{ "message_type": "session.input", "body": { "text": "..." } }`
- 服务端推送: `{ "message_type": "session.stream.event", "body": { "kind": "llm.delta", ... } }`
- 心跳: `{ "message_type": "session.heartbeat", "body": { "ts": 1234567890 } }`

### 1.2 小程序前端现状

当前前端架构：
- `utils/api.js` - 统一 HTTP 请求封装，支持 JWT 自动注入、token 刷新、401 处理
- `utils/nano-client.js` - WebSocket 连接封装，支持 heartbeat、resume、ack
- `apiRoutes.js` - 集中管理后端路由
- 页面: chat(首页), session(对话), profile(个人中心), auth(登录)

### 1.3 核心痛点

1. **接口不稳定**：orchestrator-core 和 agent-core 都在开发中，字段可能变动
2. **前后端耦合**：前端直接调用后端，后端挂掉时前端无法开发
3. **缺乏契约**：没有明确的接口契约文档，前后端靠口头对齐
4. **测试困难**：小程序环境限制，难以做自动化接口测试
5. **WebSocket 难 Mock**：流式响应难以预测和模拟

---

## 2. 总体设计思路

### 2.1 核心理念：契约优先（Contract First）

**推荐工作流：**
```
1. 前后端一起定义接口契约（JSON Schema）
2. 后端根据契约实现接口
3. 前端根据契约开发 + 使用 Mock 数据
4. 联调时切换到真实后端验证
5. 持续迭代契约
```

**锚定策略：**
- **短期（1-2 周）**：前端锚定，后端跟随。前端先定义期望的接口格式，后端按此实现。
- **中期（2-4 周）**：后端锚定，前端跟随。后端接口稳定后，前端做最终适配。
- **长期**：契约锚定，前后端都跟随契约。

### 2.2 三层测试架构

```
┌─────────────────────────────────────────────────────┐
│  Layer 3: 真实集成测试（E2E）                          │
│  - 连接真实 orchestrator-core                         │
│  - 全链路验证                                          │
│  - 在 staging 环境运行                                  │
├─────────────────────────────────────────────────────┤
│  Layer 2: 契约测试（Contract Test）                    │
│  - 验证前后端都遵守 JSON Schema                       │
│  - Mock 数据符合契约                                   │
│  - 每次 CI 自动检查                                    │
├─────────────────────────────────────────────────────┤
│  Layer 1: Mock 开发（Frontend Dev）                   │
│  - 前端独立开发，不依赖后端                            │
│  - 使用内置 Mock 服务器                                │
│  - 可模拟各种边界情况                                   │
└─────────────────────────────────────────────────────┘
```

---

## 3. 具体实施方案

### 3.1 接口契约定义

在 `clients/wechat-miniprogram/test/contract/` 目录下定义接口契约：

```
test/
├── contract/
│   ├── auth.schema.json          # 认证接口契约
│   ├── session.schema.json       # 会话接口契约
│   ├── websocket.schema.json     # WebSocket 消息契约
│   └── common.schema.json        # 通用类型定义
├── mock/
│   ├── mock-server.js            # Mock 服务器核心
│   ├── scenarios/
│   │   ├── auth.scenario.js      # 认证场景
│   │   ├── session.scenario.js   # 会话场景
│   │   └── agentic.scenario.js   # Agentic Loop 场景
│   └── fixtures/
│       ├── auth.fixtures.js      # 认证 Mock 数据
│       └── session.fixtures.js   # 会话 Mock 数据
├── runner/
│   ├── test-runner.js            # 测试执行器
│   └── assertions.js             # 断言库
└── report/
    └── test-report.wxml          # 测试报告页面
```

**示例契约（auth.schema.json）：**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Auth API Contract",
  "definitions": {
    "AuthResponse": {
      "type": "object",
      "required": ["ok"],
      "properties": {
        "ok": { "type": "boolean" },
        "data": {
          "type": "object",
          "properties": {
            "tokens": {
              "type": "object",
              "properties": {
                "access_token": { "type": "string", "minLength": 10 },
                "refresh_token": { "type": "string" }
              },
              "required": ["access_token"]
            },
            "user": {
              "type": "object",
              "properties": {
                "user_uuid": { "type": "string", "format": "uuid" },
                "display_name": { "type": "string" },
                "email": { "type": "string", "format": "email" },
                "membership_level": { "type": "number", "minimum": 0 },
                "credit_current": { "type": "number", "minimum": 0 }
              }
            }
          }
        },
        "error": {
          "type": "object",
          "properties": {
            "code": { "type": "string" },
            "message": { "type": "string" },
            "status": { "type": "number" }
          }
        }
      }
    }
  }
}
```

### 3.2 Mock 服务器设计

**核心思路：** 在 `utils/api.js` 中增加一层拦截器，当 `MOCK_MODE = true` 时，请求被路由到 Mock 服务器而非真实后端。

**实现方案：**

```javascript
// test/mock/mock-server.js
class MockServer {
  constructor() {
    this.handlers = new Map();
    this.delay = 300; // 模拟网络延迟
    this.scenarios = [];
  }

  // 注册 Mock 处理器
  on(routeKey, handler) {
    this.handlers.set(routeKey, handler);
  }

  // 执行请求
  async handle(routeKey, options) {
    const handler = this.handlers.get(routeKey);
    if (!handler) {
      throw new Error(`Mock handler not found for: ${routeKey}`);
    }
    
    // 模拟网络延迟
    await this.simulateDelay();
    
    const response = await handler(options);
    
    // 验证响应是否符合契约
    this.validateContract(routeKey, response);
    
    return response;
  }

  simulateDelay() {
    return new Promise(resolve => setTimeout(resolve, this.delay));
  }

  validateContract(routeKey, response) {
    // TODO: 使用 JSON Schema 验证
    // 如果验证失败，在开发模式下打印警告
  }
}

module.exports = { MockServer };
```

**Mock 场景示例：**

```javascript
// test/mock/scenarios/auth.scenario.js
const mockServer = require('../mock-server');

// 注册登录场景
mockServer.on('login', async (options) => {
  const { email, password } = options.data;
  
  // 模拟验证
  if (password.length < 6) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: '密码长度不能少于 6 位',
        status: 400
      }
    };
  }
  
  // 模拟成功
  return {
    ok: true,
    data: {
      tokens: {
        access_token: `mock_token_${Date.now()}`,
        refresh_token: `mock_refresh_${Date.now()}`
      },
      user: {
        user_uuid: '550e8400-e29b-41d4-a716-446655440000',
        display_name: 'Test User',
        email: email,
        membership_level: 1,
        credit_current: 100.00
      }
    }
  };
});

// 注册微信登录场景
mockServer.on('wechatLogin', async (options) => {
  return {
    ok: true,
    data: {
      tokens: {
        access_token: `mock_wx_token_${Date.now()}`,
        refresh_token: `mock_wx_refresh_${Date.now()}`
      },
      user: {
        user_uuid: '550e8400-e29b-41d4-a716-446655440001',
        display_name: '微信用户',
        email: 'wechat@nano-agent.test',
        membership_level: 0,
        credit_current: 0.00
      }
    }
  };
});
```

```javascript
// test/mock/scenarios/session.scenario.js
mockServer.on('sessionStart', async (options) => {
  const { sessionUuid } = options.pathParams;
  
  return {
    ok: true,
    data: {
      session_uuid: sessionUuid,
      status: 'starting',
      created_at: new Date().toISOString(),
      message: '会话创建成功'
    }
  };
});

mockServer.on('sessionInput', async (options) => {
  return {
    ok: true,
    data: {
      message: '输入已接收',
      stream_seq: 1
    }
  };
});

mockServer.on('sessionTimeline', async (options) => {
  return {
    ok: true,
    data: {
      events: [
        {
          seq: 1,
          message_type: 'session.stream.event',
          body: {
            kind: 'llm.delta',
            content_type: 'text',
            content: '这是一个 Mock 回复',
            is_final: false
          }
        }
      ]
    }
  };
});
```

### 3.3 WebSocket Mock 设计

WebSocket Mock 是最复杂的部分，因为需要模拟流式推送：

```javascript
// test/mock/mock-websocket.js
class MockWebSocket {
  constructor(url, onMessage, onState) {
    this.url = url;
    this.onMessage = onMessage;
    this.onState = onState;
    this.connected = false;
    this.scenarios = [];
    this.currentScenario = null;
  }

  connect() {
    setTimeout(() => {
      this.connected = true;
      this.onState('open');
      
      // 发送欢迎消息
      this.pushMessage({
        message_type: 'session.stream.event',
        body: {
          kind: 'turn.begin',
          turn_id: `turn_${Date.now()}`
        }
      });
    }, 100);
  }

  send(data) {
    const message = JSON.parse(data);
    
    if (message.message_type === 'session.input') {
      this.handleInput(message.body);
    }
  }

  async handleInput(body) {
    const text = body.text || '';
    
    // 模拟思考过程
    this.pushMessage({
      message_type: 'session.stream.event',
      body: {
        kind: 'llm.delta',
        content_type: 'text',
        content: '正在思考...',
        is_final: false
      }
    });

    await this.delay(500);

    // 模拟工具调用（如果输入包含特定关键词）
    if (text.includes('工具') || text.includes('tool')) {
      this.pushMessage({
        message_type: 'session.stream.event',
        body: {
          kind: 'llm.delta',
          content_type: 'tool_use_start',
          content: JSON.stringify({
            id: `call_${Date.now()}`,
            name: 'bash',
            arguments: { command: 'pwd' }
          }),
          is_final: false
        }
      });

      await this.delay(800);

      this.pushMessage({
        message_type: 'session.stream.event',
        body: {
          kind: 'tool.call.result',
          tool_name: 'bash',
          result: { output: '/workspace/nano-agent', exit_code: 0 }
        }
      });
    }

    await this.delay(300);

    // 模拟最终回复
    const responses = [
      '收到！我已经处理了您的请求。',
      '这是一个 Mock 回复，用于前端开发测试。',
      '在实际环境中，这里会显示真实的 AI 回复内容。'
    ];
    
    const response = responses[Math.floor(Math.random() * responses.length)];
    
    this.pushMessage({
      message_type: 'session.stream.event',
      body: {
        kind: 'llm.delta',
        content_type: 'text',
        content: response,
        is_final: false
      }
    });

    await this.delay(200);

    // 结束回合
    this.pushMessage({
      message_type: 'session.stream.event',
      body: {
        kind: 'turn.end',
        turn_id: `turn_${Date.now()}`
      }
    });
  }

  pushMessage(message) {
    if (this.connected) {
      this.onMessage(message);
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  close() {
    this.connected = false;
    this.onState('close');
  }
}

module.exports = { MockWebSocket };
```

### 3.4 自动化测试组件

**测试面板页面：**

在小程序中增加一个 `pages/test-runner/` 页面，用于运行自动化测试：

```
pages/
├── test-runner/
│   ├── index.js          # 测试执行逻辑
│   ├── index.wxml        # 测试报告 UI
│   ├── index.wxss        # 样式
│   └── index.json        # 配置
```

**测试场景定义：**

```javascript
// test/runner/scenarios.js
const TEST_SCENARIOS = [
  {
    id: 'auth-flow',
    name: '认证流程测试',
    description: '测试注册、登录、获取用户信息完整流程',
    steps: [
      {
        name: '注册用户',
        action: 'register',
        data: { email: 'test@nano-agent.test', password: 'Test123456', display_name: 'Test' },
        expect: { ok: true, 'data.tokens.access_token': 'string' }
      },
      {
        name: '登录用户',
        action: 'login',
        data: { email: 'test@nano-agent.test', password: 'Test123456' },
        expect: { ok: true, 'data.user.email': 'test@nano-agent.test' }
      },
      {
        name: '获取用户信息',
        action: 'me',
        expect: { ok: true, 'data.user.display_name': 'Test' }
      }
    ]
  },
  {
    id: 'session-flow',
    name: '会话流程测试',
    description: '测试创建会话、发送消息、获取时间线',
    steps: [
      {
        name: '创建会话',
        action: 'sessionStart',
        pathParams: { sessionUuid: '550e8400-e29b-41d4-a716-446655440000' },
        data: { initial_input: 'Hello' },
        expect: { ok: true, 'data.status': 'starting' }
      },
      {
        name: '发送输入',
        action: 'sessionInput',
        pathParams: { sessionUuid: '550e8400-e29b-41d4-a716-446655440000' },
        data: { text: '测试消息' },
        expect: { ok: true }
      },
      {
        name: '获取时间线',
        action: 'sessionTimeline',
        pathParams: { sessionUuid: '550e8400-e29b-41d4-a716-446655440000' },
        expect: { ok: true, 'data.events': 'array' }
      }
    ]
  },
  {
    id: 'agentic-loop',
    name: 'Agentic Loop 测试',
    description: '测试工具调用、思考过程、最终回复',
    steps: [
      {
        name: '触发工具调用',
        action: 'sessionInput',
        pathParams: { sessionUuid: '550e8400-e29b-41d4-a716-446655440000' },
        data: { text: '执行工具' },
        expect: { ok: true },
        wsExpect: [
          { 'body.kind': 'turn.begin' },
          { 'body.kind': 'llm.delta', 'body.content_type': 'tool_use_start' },
          { 'body.kind': 'tool.call.result' },
          { 'body.kind': 'llm.delta', 'body.content_type': 'text' },
          { 'body.kind': 'turn.end' }
        ]
      }
    ]
  },
  {
    id: 'error-handling',
    name: '错误处理测试',
    description: '测试各种错误场景的响应',
    steps: [
      {
        name: '无效登录',
        action: 'login',
        data: { email: 'invalid', password: '123' },
        expect: { ok: false, 'error.status': 401 }
      },
      {
        name: '未授权访问',
        action: 'me',
        expect: { ok: false, 'error.code': 'AUTH_FAILURE' }
      }
    ]
  }
];

module.exports = { TEST_SCENARIOS };
```

**断言库：**

```javascript
// test/runner/assertions.js
class AssertionError extends Error {
  constructor(message, path, expected, actual) {
    super(message);
    this.path = path;
    this.expected = expected;
    this.actual = actual;
  }
}

function assertResponse(response, expectations) {
  const results = [];
  
  for (const [path, expected] of Object.entries(expectations)) {
    const actual = getValueByPath(response, path);
    const passed = matchValue(actual, expected);
    
    results.push({
      path,
      expected,
      actual,
      passed,
      error: passed ? null : `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    });
  }
  
  return results;
}

function getValueByPath(obj, path) {
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : undefined;
  }, obj);
}

function matchValue(actual, expected) {
  if (expected === 'string') return typeof actual === 'string';
  if (expected === 'number') return typeof actual === 'number';
  if (expected === 'boolean') return typeof actual === 'boolean';
  if (expected === 'array') return Array.isArray(actual);
  if (expected === 'object') return typeof actual === 'object' && !Array.isArray(actual);
  if (expected === 'undefined') return actual === undefined;
  if (expected === 'null') return actual === null;
  return actual === expected;
}

module.exports = { assertResponse, AssertionError };
```

### 3.5 配置切换机制

在 `app.js` 中增加 Mock 模式配置：

```javascript
// app.js 中的配置
App({
  globalData: {
    // 运行模式: 'mock' | 'staging' | 'production'
    runtimeMode: 'mock',
    
    // Mock 配置
    mockConfig: {
      delay: 300,           // 模拟延迟(ms)
      failureRate: 0,       // 模拟失败率(0-1)
      wsScenario: 'normal'  // WebSocket 场景: 'normal' | 'tool' | 'error' | 'slow'
    },
    
    // 后端地址
    endpoints: {
      mock: 'http://localhost:3000',  // Mock 服务器地址
      staging: 'https://nano-agent-orchestrator-core-preview.haimang.workers.dev',
      production: 'https://nano-agent-orchestrator-core.haimang.workers.dev'
    }
  },
  
  // 切换运行模式
  setRuntimeMode(mode) {
    this.globalData.runtimeMode = mode;
    wx.setStorageSync('runtime_mode', mode);
  },
  
  // 获取当前 endpoint
  getEndpoint() {
    return this.globalData.endpoints[this.globalData.runtimeMode];
  }
});
```

在 `utils/api.js` 中根据模式路由请求：

```javascript
// utils/api.js 中的修改
function request(routeKey, options = {}) {
  const app = getApp();
  const mode = app.globalData.runtimeMode;
  
  // Mock 模式
  if (mode === 'mock') {
    const mockServer = require('../test/mock/mock-server');
    return mockServer.handle(routeKey, options);
  }
  
  // 真实模式
  // ... 原有代码
}
```

---

## 4. 开发工作流

### 4.1 前端独立开发（Mock 模式）

```bash
# 1. 启动小程序，切换到 Mock 模式
# 在 app.js 中设置: runtimeMode: 'mock'

# 2. 前端开发者根据契约开发 UI
# 参考: test/contract/*.schema.json

# 3. 运行自动化测试验证 UI 逻辑
# 打开 pages/test-runner/index 页面
# 运行场景: auth-flow, session-flow, agentic-loop

# 4. 调整 Mock 数据以测试边界情况
# 修改: test/mock/fixtures/*.js
```

### 4.2 后端独立开发（契约模式）

```bash
# 1. 后端开发者根据契约实现接口
# 参考: test/contract/*.schema.json

# 2. 使用契约验证响应格式
# 在 orchestrator-core 中引入契约验证中间件

# 3. 提供健康检查端点
# GET /health 返回完整的接口状态
```

### 4.3 联调阶段（真实模式）

```bash
# 1. 后端部署到 staging
# 2. 前端切换到 staging 模式
# 在 app.js 中设置: runtimeMode: 'staging'

# 3. 运行自动化测试验证集成
# 4. 修复不匹配的地方
# 5. 更新契约文档
```

---

## 5. 建议的 nano-agent 后端改进

### 5.1 为前端开发提供专用接口

建议 nano-agent 增加以下接口，帮助前端开发和测试：

**1. 批量 Mock 数据接口（仅开发环境）**
```
POST /dev/mock/generate
Authorization: Bearer <dev_token>
Body: {
  "scenario": "auth_flow",    // 预定义场景
  "count": 10                 // 生成数量
}

Response: {
  "ok": true,
  "data": {
    "users": [...],
    "sessions": [...]
  }
}
```

**2. 接口契约端点**
```
GET /dev/contract
Response: {
  "ok": true,
  "data": {
    "version": "1.0.0",
    "schemas": {
      "auth": { ... },
      "session": { ... }
    }
  }
}
```

**3. WebSocket 测试端点**
```
GET /dev/ws-test
返回一个可交互的 WebSocket 测试页面，可以手动发送消息并查看响应
```

**4. 会话列表接口**
```
GET /sessions
Response: {
  "ok": true,
  "data": {
    "sessions": [
      {
        "session_uuid": "...",
        "title": "对话标题",
        "status": "active",
        "created_at": "...",
        "updated_at": "...",
        "message_count": 10
      }
    ]
  }
}
```

### 5.2 错误码标准化

建议统一错误码格式，方便前端处理：

```javascript
const ERROR_CODES = {
  // 认证错误 (1xx)
  AUTH_INVALID_TOKEN: { code: 'AUTH_001', status: 401, message: '无效的令牌' },
  AUTH_EXPIRED_TOKEN: { code: 'AUTH_002', status: 401, message: '令牌已过期' },
  AUTH_INVALID_CREDENTIALS: { code: 'AUTH_003', status: 401, message: '无效的凭据' },
  
  // 会话错误 (2xx)
  SESSION_NOT_FOUND: { code: 'SES_001', status: 404, message: '会话不存在' },
  SESSION_ALREADY_ENDED: { code: 'SES_002', status: 400, message: '会话已结束' },
  SESSION_QUOTA_EXCEEDED: { code: 'SES_003', status: 429, message: '配额已用完' },
  
  // 验证错误 (3xx)
  VALIDATION_INVALID_EMAIL: { code: 'VAL_001', status: 400, message: '无效的邮箱格式' },
  VALIDATION_INVALID_PASSWORD: { code: 'VAL_002', status: 400, message: '密码格式不正确' },
  
  // 系统错误 (9xx)
  SYSTEM_INTERNAL_ERROR: { code: 'SYS_001', status: 500, message: '内部服务器错误' },
  SYSTEM_SERVICE_UNAVAILABLE: { code: 'SYS_002', status: 503, message: '服务暂时不可用' }
};
```

### 5.3 版本协商机制

建议增加 API 版本协商：

```
GET /version
Response: {
  "ok": true,
  "data": {
    "api_version": "1.0.0",
    "supported_versions": ["1.0.0", "0.9.0"],
    "deprecated_features": ["old_auth_endpoint"]
  }
}
```

前端启动时调用此接口，检查兼容性。

---

## 6. 实施路线图

### Phase 1: 基础设施（1 周）
- [ ] 创建 `test/` 目录结构
- [ ] 定义核心接口契约（auth, session, websocket）
- [ ] 实现 Mock 服务器核心
- [ ] 在 `utils/api.js` 中增加模式切换
- [ ] 创建测试面板页面框架

### Phase 2: Mock 场景（1 周）
- [ ] 实现认证场景 Mock（register, login, me, wechatLogin）
- [ ] 实现会话场景 Mock（start, input, timeline, history）
- [ ] 实现 WebSocket Mock（正常流、工具调用、错误场景）
- [ ] 创建边界情况 Mock（401, 429, 500, 超时）

### Phase 3: 自动化测试（1 周）
- [ ] 实现测试执行器
- [ ] 实现断言库
- [ ] 编写核心测试场景
- [ ] 实现测试报告 UI
- [ ] 集成到开发工作流

### Phase 4: 后端适配（1 周）
- [ ] nano-agent 增加健康检查接口
- [ ] nano-agent 增加开发环境 Mock 接口
- [ ] 统一错误码
- [ ] 前后端联调验证

---

## 7. 总结

**核心结论：**

1. **契约优先**：前后端应该共同维护一份接口契约（JSON Schema），作为开发的"锚点"
2. **Mock 隔离**：前端通过内置 Mock 服务器独立开发，不依赖后端进度
3. **场景化测试**：预定义用户故事级别的测试场景（注册→登录→创建会话→发送消息→工具调用）
4. **渐进式集成**：从 Mock → Staging → Production 渐进式验证

**推荐的工作模式：**

```
Week 1-2: 前端锚定
  - 前端定义期望的接口契约
  - 前端使用 Mock 完成 80% 功能开发
  - 后端根据契约开始实现

Week 3-4: 后端锚定  
  - 后端接口稳定
  - 前端切换到真实后端
  - 修复接口不匹配问题
  - 更新契约文档

Week 5+: 契约锚定
  - 前后端都跟随契约开发
  - 任何接口变更都需要更新契约
  - 自动化测试保障兼容性
```

**立即可做的：**
1. 在小程序中增加 `MOCK_MODE` 配置开关
2. 创建 `test/mock/` 目录，实现 auth 和 session 的基础 Mock
3. 在 `pages/test-runner/` 中创建简单的测试面板
4. 与 nano-agent 后端团队对齐接口契约

---

*文档版本: v1.0*
*创建时间: 2025-04-25*
*作者: Kimi*
