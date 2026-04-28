/**
 * apiRoutes.js - 集中管理后端 API 路由
 *
 * 增强项（Phase 1）:
 * - requireAuth: 标注路由是否需要 JWT token
 * - wsBaseUrl: WebSocket base URL（解决页面硬编码问题）
 * - responseShape: 标注返回格式类型（facade | legacy | debug）
 */

const BASE_URLS = {
  ORCHESTRATOR: 'orchestrator',
};

const BASE_URL_MAP = {
  [BASE_URLS.ORCHESTRATOR]: 'https://nano-agent-orchestrator-core-preview.haimang.workers.dev',
};

const WS_BASE_URL_MAP = {
  [BASE_URLS.ORCHESTRATOR]: 'wss://nano-agent-orchestrator-core-preview.haimang.workers.dev',
};

const RESPONSE_SHAPE = {
  FACADE: 'facade',
  LEGACY: 'legacy',
  DEBUG: 'debug',
};

const apiRoutes = {
  // Auth (facade envelope)
  register: { path: '/auth/register', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST', requireAuth: false, responseShape: RESPONSE_SHAPE.FACADE },
  login: { path: '/auth/login', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST', requireAuth: false, responseShape: RESPONSE_SHAPE.FACADE },
  wechatLogin: { path: '/auth/wechat/login', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST', requireAuth: false, responseShape: RESPONSE_SHAPE.FACADE },
  refresh: { path: '/auth/refresh', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST', requireAuth: false, responseShape: RESPONSE_SHAPE.FACADE },
  me: { path: '/auth/me', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'GET', requireAuth: true, responseShape: RESPONSE_SHAPE.FACADE },
  meAlias: { path: '/me', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'GET', requireAuth: true, responseShape: RESPONSE_SHAPE.FACADE },
  verifyToken: { path: '/auth/verify', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST', requireAuth: true, responseShape: RESPONSE_SHAPE.FACADE },
  resetPassword: { path: '/auth/password/reset', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST', requireAuth: true, responseShape: RESPONSE_SHAPE.FACADE },

  // Session (legacy action payload)
  sessionStart: { path: '/sessions/{sessionUuid}/start', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST', requireAuth: true, responseShape: RESPONSE_SHAPE.LEGACY },
  sessionInput: { path: '/sessions/{sessionUuid}/input', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST', requireAuth: true, responseShape: RESPONSE_SHAPE.LEGACY },
  sessionCancel: { path: '/sessions/{sessionUuid}/cancel', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST', requireAuth: true, responseShape: RESPONSE_SHAPE.LEGACY },
  sessionStatus: { path: '/sessions/{sessionUuid}/status', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'GET', requireAuth: true, responseShape: RESPONSE_SHAPE.LEGACY },
  sessionTimeline: { path: '/sessions/{sessionUuid}/timeline', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'GET', requireAuth: true, responseShape: RESPONSE_SHAPE.LEGACY },
  sessionHistory: { path: '/sessions/{sessionUuid}/history', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'GET', requireAuth: true, responseShape: RESPONSE_SHAPE.LEGACY },
  sessionVerify: { path: '/sessions/{sessionUuid}/verify', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST', requireAuth: true, responseShape: RESPONSE_SHAPE.LEGACY },

  // Session (facade envelope)
  sessionUsage: { path: '/sessions/{sessionUuid}/usage', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'GET', requireAuth: true, responseShape: RESPONSE_SHAPE.FACADE },
  sessionResume: { path: '/sessions/{sessionUuid}/resume', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST', requireAuth: true, responseShape: RESPONSE_SHAPE.FACADE },

  // Permission (facade envelope)
  permissionDecision: { path: '/sessions/{sessionUuid}/permission/decision', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST', requireAuth: true, responseShape: RESPONSE_SHAPE.FACADE },
  permissionMode: { path: '/sessions/{sessionUuid}/policy/permission_mode', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST', requireAuth: true, responseShape: RESPONSE_SHAPE.FACADE },

  // Me (facade envelope)
  meSessionsCreate: { path: '/me/sessions', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'POST', requireAuth: true, responseShape: RESPONSE_SHAPE.FACADE },
  meSessionsList: { path: '/me/sessions', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'GET', requireAuth: true, responseShape: RESPONSE_SHAPE.FACADE },

  // Catalog (facade envelope)
  catalogSkills: { path: '/catalog/skills', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'GET', requireAuth: true, responseShape: RESPONSE_SHAPE.FACADE },
  catalogCommands: { path: '/catalog/commands', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'GET', requireAuth: true, responseShape: RESPONSE_SHAPE.FACADE },
  catalogAgents: { path: '/catalog/agents', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'GET', requireAuth: true, responseShape: RESPONSE_SHAPE.FACADE },

  // Debug (raw JSON, not facade envelope)
  workerHealth: { path: '/debug/workers/health', baseUrl: BASE_URLS.ORCHESTRATOR, method: 'GET', requireAuth: false, responseShape: RESPONSE_SHAPE.DEBUG },
};

module.exports = {
  apiRoutes,
  BASE_URL_MAP,
  WS_BASE_URL_MAP,
  BASE_URL_KEYS: BASE_URLS,
  RESPONSE_SHAPE,
};
