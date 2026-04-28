/**
 * api/permission.js - 权限业务代理层
 *
 * 覆盖后端路由: POST /sessions/{uuid}/permission/decision,
 *               POST /sessions/{uuid}/policy/permission_mode
 *
 * 注意：
 * - submitDecision() 当前只记录到服务端 hot state，不会实际拦截工具执行
 * - setMode() 当前只记录到服务端 hot state，未成为 agent runtime 的强制执行入口
 * - 工具执行是否需要审批取决于服务端的 policy 设置，而非客户端决策
 *
 * NOT YET AVAILABLE (后端未实现 WS round-trip):
 * - WS session.permission.request / session.permission.decision
 */

const { request } = require('../utils/api');

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
 * 提交权限决策
 * 注意：当前只记录到服务端 hot state，不会实际拦截正在运行中的工具执行
 * @param {string} sessionUuid
 * @param {string} requestUuid
 * @param {string} decision - 'allow' | 'deny'
 * @param {string} [scope='once'] - 'once' | 'always' | 'session'
 * @param {string} [reason]
 * @returns {Promise<{ok, data, error, traceUuid}>}
 */
async function submitDecision(sessionUuid, requestUuid, decision, scope = 'once', reason = '') {
  const body = await request('permissionDecision', {
    pathParams: { sessionUuid },
    data: { request_uuid: requestUuid, decision, scope, reason },
    showLoading: false,
  });
  return normalizeResponse(body);
}

/**
 * 设置会话默认权限模式
 * 注意：当前只记录到服务端 hot state，未成为 agent runtime 的强制执行入口
 * @param {string} sessionUuid
 * @param {string} mode - 'auto-allow' | 'ask' | 'deny' | 'always_allow'
 * @returns {Promise<{ok, data, error, traceUuid}>}
 */
async function setMode(sessionUuid, mode) {
  const body = await request('permissionMode', {
    pathParams: { sessionUuid },
    data: { mode },
    showLoading: false,
  });
  return normalizeResponse(body);
}

module.exports = {
  submitDecision,
  setMode,
};
