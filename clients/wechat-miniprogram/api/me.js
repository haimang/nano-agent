/**
 * api/me.js - 用户 Session 管理代理层
 *
 * 覆盖后端路由: POST /me/sessions, GET /me/sessions
 *
 * 注意：
 * - createSession() 返回的 pending session 在调用 /start 前不会出现在 listSessions() 中
 * - listSessions() 当前上限 200 条，无分页，pending session 不在列表中
 *
 * NOT YET AVAILABLE (后端未实现):
 * - GET /me/conversations
 */

const { request } = require('../utils/api');
const { RESPONSE_SHAPE } = require('../apiRoutes');

function normalizeResponse(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: { code: 'invalid-response', message: 'Invalid response body' } };
  }
  return {
    ok: body.ok === true,
    data: body.ok === true ? body.data : undefined,
    error: body.ok === false ? body.error : undefined,
    traceUuid: body.trace_uuid,
  };
}

/**
 * 创建新会话（server-mint UUID）
 * 注意：返回的 pending session 在调用 session.start() 前不会出现在 listSessions() 中
 * @returns {Promise<{ok, data: {session_uuid, status, ttl_seconds, created_at, start_url}, error, traceUuid}>}
 */
async function createSession() {
  const body = await request('meSessionsCreate', {
    data: {},
    showLoading: false,
  });
  return normalizeResponse(body);
}

/**
 * 列出当前用户的会话列表
 * 注意：当前上限 200 条，无分页；pending session（尚未 /start 的）不会出现在列表中
 * @returns {Promise<{ok, data: {sessions, next_cursor}, error, traceUuid}>}
 */
async function listSessions() {
  const body = await request('meSessionsList', { showLoading: false });
  return normalizeResponse(body);
}

module.exports = {
  createSession,
  listSessions,
};
