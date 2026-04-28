/**
 * test/e2e/api/auth.e2e.js
 * Auth 模块 E2E 测试
 *
 * 环境要求: preview 后端可用
 */

const { register, login, verifyToken, getMe } = require('../../../api/auth');
const fetch = require('node-fetch');

// 模拟 wx 全局对象
const mockStorage = new Map();
global.wx = {
  request: ({ url, method, data, header, success, fail }) => {
    fetch(url, {
      method,
      body: data ? JSON.stringify(data) : undefined,
      headers: header || {},
    })
      .then((res) => res.json())
      .then((json) => success({ data: json, statusCode: 200 }))
      .catch((err) => fail({ errMsg: err.message }));
  },
  getStorageSync: (key) => mockStorage.get(key),
  setStorageSync: (key, value) => mockStorage.set(key, value),
  removeStorageSync: (key) => mockStorage.delete(key),
  showToast: () => {},
  showModal: () => {},
  showLoading: () => {},
  hideLoading: () => {},
};

const TEST_EMAIL = `e2e-${Date.now()}@nano-agent.test`;
const TEST_PASSWORD = 'TestPass123!';
let accessToken = null;

describe('Auth E2E', () => {
  it('should register a new user', async () => {
    const result = await register(TEST_EMAIL, TEST_PASSWORD, 'E2E User');
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.tokens).toBeDefined();
    expect(result.data.tokens.access_token).toBeDefined();
    accessToken = result.data.tokens.access_token;
  });

  it('should login with email and password', async () => {
    const result = await login(TEST_EMAIL, TEST_PASSWORD);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.tokens).toBeDefined();
    expect(result.data.tokens.access_token).toBeDefined();
    accessToken = result.data.tokens.access_token;
  });

  it('should verify token', async () => {
    const result = await verifyToken(accessToken);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.valid).toBe(true);
  });

  it('should get current user info', async () => {
    // 模拟 token 在 storage 中
    mockStorage.set('nano_agent_token', accessToken);
    const result = await getMe();
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.user).toBeDefined();
  });
});
