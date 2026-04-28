/**
 * test/e2e/api/session.e2e.js
 * Session 模块 E2E 测试
 *
 * 环境要求: preview 后端可用
 */

const { register, login } = require('../../../api/auth');
const { createSession } = require('../../../api/me');
const { start, input, getStatus, getTimeline, getHistory, resume, usage } = require('../../../api/session');
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

const TEST_EMAIL = `e2e-session-${Date.now()}@nano-agent.test`;
const TEST_PASSWORD = 'TestPass123!';
let sessionUuid = null;

describe('Session E2E', () => {
  it('should setup auth', async () => {
    const regResult = await register(TEST_EMAIL, TEST_PASSWORD, 'Session E2E');
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
    sessionUuid = result.data.session_uuid;
  });

  it('should start a session', async () => {
    const result = await start(sessionUuid, 'Hello, this is an E2E test.');
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('should get session status', async () => {
    const result = await getStatus(sessionUuid);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('should send input', async () => {
    const result = await input(sessionUuid, 'Continue');
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('should get timeline', async () => {
    const result = await getTimeline(sessionUuid);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data.events)).toBe(true);
  });

  it('should get history', async () => {
    const result = await getHistory(sessionUuid);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data.messages)).toBe(true);
  });

  it('should get usage snapshot', async () => {
    const result = await usage(sessionUuid);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.session_uuid).toBe(sessionUuid);
  });

  it('should resume session', async () => {
    const result = await resume(sessionUuid, 0);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
  });
});
