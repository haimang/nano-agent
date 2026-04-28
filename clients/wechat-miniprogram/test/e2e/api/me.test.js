/**
 * test/e2e/api/me.e2e.js
 * Me 模块 E2E 测试
 *
 * 环境要求: preview 后端可用
 */

const { register, login } = require('../../../api/auth');
const { createSession, listSessions } = require('../../../api/me');
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

const TEST_EMAIL = `e2e-me-${Date.now()}@nano-agent.test`;
const TEST_PASSWORD = 'TestPass123!';

describe('Me E2E', () => {
  it('should setup auth', async () => {
    const regResult = await register(TEST_EMAIL, TEST_PASSWORD, 'Me E2E');
    expect(regResult.ok).toBe(true);
    const loginResult = await login(TEST_EMAIL, TEST_PASSWORD);
    expect(loginResult.ok).toBe(true);
    mockStorage.set('nano_agent_token', loginResult.data.tokens.access_token);
  });

  it('should create a session', async () => {
    const result = await createSession();
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.session_uuid).toBeDefined();
    expect(result.data.status).toBe('pending');
  });

  it('should list sessions', async () => {
    const result = await listSessions();
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data.sessions)).toBe(true);
  });
});
