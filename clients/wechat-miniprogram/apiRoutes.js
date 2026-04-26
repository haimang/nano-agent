// apiRoutes.js - 集中管理后端 API 路由

const BASE_URLS = {
  ORCHESTRATOR: 'orchestrator',
};

const BASE_URL_MAP = {
  [BASE_URLS.ORCHESTRATOR]: 'https://nano-agent-orchestrator-core-preview.haimang.workers.dev',
};

const apiRoutes = {
  // Auth
  register: { path: '/auth/register', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST' },
  login: { path: '/auth/login', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST' },
  wechatLogin: { path: '/auth/wechat/login', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST' },
  refresh: { path: '/auth/refresh', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST' },
  me: { path: '/auth/me', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'GET' },
  verifyToken: { path: '/auth/verify', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST' },
  resetPassword: { path: '/auth/password/reset', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST' },
  workerHealth: { path: '/debug/workers/health', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'GET' },

  // Session
  sessionStart: { path: '/sessions/{sessionUuid}/start', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST' },
  sessionInput: { path: '/sessions/{sessionUuid}/input', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST' },
  sessionCancel: { path: '/sessions/{sessionUuid}/cancel', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST' },
  sessionStatus: { path: '/sessions/{sessionUuid}/status', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'GET' },
  sessionTimeline: { path: '/sessions/{sessionUuid}/timeline', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'GET' },
  sessionHistory: { path: '/sessions/{sessionUuid}/history', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'GET' },
  sessionVerify: { path: '/sessions/{sessionUuid}/verify', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST' },
};

module.exports = {
  apiRoutes,
  BASE_URL_MAP,
  BASE_URL_KEYS: BASE_URLS,
};
