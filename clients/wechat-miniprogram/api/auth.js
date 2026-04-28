/**
 * api/auth.js - Auth 业务代理层
 *
 * 覆盖后端路由: /auth/register, /auth/login, /auth/wechat/login, /auth/refresh,
 *               /auth/verify, /auth/me, /me, /auth/password/reset
 *
 * NOT YET AVAILABLE (后端未实现):
 * - POST /me/devices/revoke
 */

const { request, getJwtToken, setJwtToken, setRefreshToken } = require('../utils/api');
const { RESPONSE_SHAPE } = require('../apiRoutes');

/**
 * 标准化返回格式
 * @param {Object} body - 后端原始响应
 * @param {string} shape - 响应格式类型 (facade|legacy|debug)
 * @returns {Object} {ok, data, error, traceUuid}
 */
function normalizeResponse(body, shape = RESPONSE_SHAPE.FACADE) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: { code: 'invalid-response', message: 'Invalid response body' } };
  }

  // Facade envelope: {ok, data, trace_uuid} 或 {ok, error, trace_uuid}
  if (shape === RESPONSE_SHAPE.FACADE || shape === RESPONSE_SHAPE.DEBUG) {
    return {
      ok: body.ok === true,
      data: body.ok === true ? body.data : undefined,
      error: body.ok === false ? body.error : undefined,
      traceUuid: body.trace_uuid,
    };
  }

  // Legacy action payload: {ok, action, ..., trace_uuid}
  // 提取所有非 ok/trace_uuid 字段到 data 中
  if (shape === RESPONSE_SHAPE.LEGACY) {
    const { ok, trace_uuid, ...rest } = body;
    return {
      ok: ok === true,
      data: ok === true ? rest : undefined,
      error: ok === false ? rest.error || rest : undefined,
      traceUuid: trace_uuid,
    };
  }

  return body;
}

/**
 * 注册新用户
 * @param {string} email
 * @param {string} password
 * @param {string} [displayName]
 * @returns {Promise<{ok, data: AuthFlowResult, error, traceUuid}>}
 */
async function register(email, password, displayName) {
  const body = await request('register', {
    requireAuth: false,
    data: { email, password, display_name: displayName || email.split('@')[0] },
    showLoading: false,
  });
  return normalizeResponse(body);
}

/**
 * 邮箱密码登录
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ok, data: AuthFlowResult, error, traceUuid}>}
 */
async function login(email, password) {
  const body = await request('login', {
    requireAuth: false,
    data: { email, password },
    showLoading: false,
  });
  return normalizeResponse(body);
}

/**
 * 微信登录
 * @param {string} code - wx.login() 获取的 code
 * @param {string} [encryptedData] - wx.getUserProfile() 获取的 encryptedData
 * @param {string} [iv] - wx.getUserProfile() 获取的 iv
 * @param {string} [displayName] - 备用昵称
 * @returns {Promise<{ok, data: AuthFlowResult, error, traceUuid}>}
 */
async function wechatLogin(code, encryptedData, iv, displayName) {
  const payload = { code };
  if (encryptedData && iv) {
    payload.encrypted_data = encryptedData;
    payload.iv = iv;
  }
  if (displayName) {
    payload.display_name = displayName;
  }
  const body = await request('wechatLogin', {
    requireAuth: false,
    data: payload,
    showLoading: false,
  });
  return normalizeResponse(body);
}

/**
 * 刷新 access token
 * 注意：此函数必须调用 utils/api.js 的 request() 以复用现有 token 刷新队列，不得自行发请求
 * @param {string} [refreshToken] - 如不传，自动从 storage 读取
 * @returns {Promise<{ok, data: AuthFlowResult, error, traceUuid}>}
 */
async function refresh(refreshToken) {
  const token = refreshToken || require('../utils/api').getRefreshToken();
  const body = await request('refresh', {
    requireAuth: false,
    data: { refresh_token: token },
    showLoading: false,
  });
  return normalizeResponse(body);
}

/**
 * 校验 access token 有效性
 * 推荐使用场景：App 冷启动时校验 storage 中的 token 是否仍然有效
 * @param {string} [accessToken] - 如不传，自动从 storage 读取
 * @returns {Promise<{ok, data: {valid, ...AuthView}, error, traceUuid}>}
 */
async function verifyToken(accessToken) {
  const token = accessToken || getJwtToken();
  if (!token) {
    return { ok: false, error: { code: 'AUTH_REQUIRED', message: 'No token found' } };
  }
  const body = await request('verifyToken', {
    requireAuth: false,
    headers: { Authorization: `Bearer ${token}` },
    showLoading: false,
  });
  return normalizeResponse(body);
}

/**
 * 获取当前用户信息
 * 等效于 GET /me
 * @returns {Promise<{ok, data: AuthView, error, traceUuid}>}
 */
async function getMe() {
  const body = await request('me', { showLoading: false });
  return normalizeResponse(body);
}

/**
 * 修改密码
 * @param {string} oldPassword
 * @param {string} newPassword
 * @returns {Promise<{ok, data: {password_reset, ...AuthView}, error, traceUuid}>}
 */
async function resetPassword(oldPassword, newPassword) {
  const body = await request('resetPassword', {
    data: { old_password: oldPassword, new_password: newPassword },
    showLoading: false,
  });
  return normalizeResponse(body);
}

module.exports = {
  register,
  login,
  wechatLogin,
  refresh,
  verifyToken,
  getMe,
  resetPassword,
};
