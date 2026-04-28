/**
 * api/session.js - Session 业务代理层
 *
 * 覆盖后端路由: /sessions/{uuid}/start, /input, /cancel, /status,
 *               /timeline, /history, /verify, /resume, /usage
 *
 * Legacy → Facade 转换策略:
 * - Legacy action routes (start, input, cancel, status, timeline, history, verify):
 *   后端返回: {ok, action, session_uuid, session_status|status, ..., trace_uuid}
 *   代理层转换: 提取所有非 ok/trace_uuid 字段到 data 中
 *   → {ok, data: {action, session_uuid, status, ...}, trace_uuid}
 *   特别处理: session_status → status（统一字段名）
 *
 * - Facade envelope routes (resume, usage):
 *   后端返回: {ok, data: {...}, trace_uuid}
 *   代理层: 直接透传，无需转换
 *
 * NOT YET AVAILABLE (后端未实现):
 * - POST /sessions/{id}/messages
 * - GET /sessions/{id}/files
 */

const { request } = require('../utils/api');
const { RESPONSE_SHAPE } = require('../apiRoutes');

/**
 * 标准化返回格式（处理 legacy action payload → facade envelope）
 * @param {Object} body - 后端原始响应
 * @param {string} shape - 响应格式类型 (facade|legacy)
 * @returns {Object} {ok, data, error, traceUuid}
 */
function normalizeResponse(body, shape = RESPONSE_SHAPE.LEGACY) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: { code: 'invalid-response', message: 'Invalid response body' } };
  }

  // Facade envelope: {ok, data, trace_uuid}
  if (shape === RESPONSE_SHAPE.FACADE) {
    return {
      ok: body.ok === true,
      data: body.ok === true ? body.data : undefined,
      error: body.ok === false ? body.error : undefined,
      traceUuid: body.trace_uuid,
    };
  }

  // Legacy action payload: {ok, action, session_uuid, session_status|status, ..., trace_uuid}
  if (shape === RESPONSE_SHAPE.LEGACY) {
    const { ok, trace_uuid, ...rest } = body;
    
    // 统一字段名: session_status → status
    if (rest.session_status !== undefined) {
      rest.status = rest.session_status;
      delete rest.session_status;
    }

    return {
      ok: ok === true,
      data: ok === true ? rest : undefined,
      error: ok === false 
        ? (rest.error || { code: rest.code || 'unknown', message: rest.message || 'Unknown error' })
        : undefined,
      traceUuid: trace_uuid,
    };
  }

  return body;
}

/**
 * 启动会话
 * @param {string} sessionUuid
 * @param {string} [initialInput]
 * @returns {Promise<{ok, data, error, traceUuid}>}
 */
async function start(sessionUuid, initialInput = '') {
  const body = await request('sessionStart', {
    pathParams: { sessionUuid },
    data: { initial_input: initialInput },
    showLoading: false,
  });
  return normalizeResponse(body, RESPONSE_SHAPE.LEGACY);
}

/**
 * 发送输入
 * @param {string} sessionUuid
 * @param {string} text
 * @returns {Promise<{ok, data, error, traceUuid}>}
 */
async function input(sessionUuid, text) {
  const body = await request('sessionInput', {
    pathParams: { sessionUuid },
    data: { text },
    showLoading: false,
  });
  return normalizeResponse(body, RESPONSE_SHAPE.LEGACY);
}

/**
 * 取消会话
 * @param {string} sessionUuid
 * @param {string} [reason]
 * @returns {Promise<{ok, data, error, traceUuid}>}
 */
async function cancel(sessionUuid, reason = 'user cancelled') {
  const body = await request('sessionCancel', {
    pathParams: { sessionUuid },
    data: { reason },
    showLoading: false,
  });
  return normalizeResponse(body, RESPONSE_SHAPE.LEGACY);
}

/**
 * 获取会话状态
 * @param {string} sessionUuid
 * @returns {Promise<{ok, data, error, traceUuid}>}
 */
async function getStatus(sessionUuid) {
  const body = await request('sessionStatus', {
    pathParams: { sessionUuid },
    showLoading: false,
  });
  return normalizeResponse(body, RESPONSE_SHAPE.LEGACY);
}

/**
 * 获取事件时间线
 * @param {string} sessionUuid
 * @returns {Promise<{ok, data: {events}, error, traceUuid}>}
 */
async function getTimeline(sessionUuid) {
  const body = await request('sessionTimeline', {
    pathParams: { sessionUuid },
    showLoading: false,
  });
  return normalizeResponse(body, RESPONSE_SHAPE.LEGACY);
}

/**
 * 获取消息历史
 * @param {string} sessionUuid
 * @returns {Promise<{ok, data: {messages}, error, traceUuid}>}
 */
async function getHistory(sessionUuid) {
  const body = await request('sessionHistory', {
    pathParams: { sessionUuid },
    showLoading: false,
  });
  return normalizeResponse(body, RESPONSE_SHAPE.LEGACY);
}

/**
 * 调试验证
 * @param {string} sessionUuid
 * @param {string} check - 如 'initial-context', 'capability-call' 等
 * @returns {Promise<{ok, data, error, traceUuid}>}
 */
async function verify(sessionUuid, check) {
  const body = await request('sessionVerify', {
    pathParams: { sessionUuid },
    data: { check },
    showLoading: false,
  });
  return normalizeResponse(body, RESPONSE_SHAPE.LEGACY);
}

/**
 * 显式恢复（HTTP 版 resume）
 * @param {string} sessionUuid
 * @param {number} [lastSeenSeq=0]
 * @returns {Promise<{ok, data, error, traceUuid}>}
 */
async function resume(sessionUuid, lastSeenSeq = 0) {
  const body = await request('sessionResume', {
    pathParams: { sessionUuid },
    data: { last_seen_seq: lastSeenSeq },
    showLoading: false,
  });
  return normalizeResponse(body, RESPONSE_SHAPE.FACADE);
}

/**
 * 获取会话用量快照
 * 注意：当前 usage 字段（llm_input_tokens, llm_output_tokens, tool_calls 等）全为 null（placeholder）
 * 但 durable_truth 字段可用（message_count, activity_count, last_event_seq）
 * @param {string} sessionUuid
 * @returns {Promise<{ok, data, error, traceUuid}>}
 */
async function usage(sessionUuid) {
  const body = await request('sessionUsage', {
    pathParams: { sessionUuid },
    showLoading: false,
  });
  return normalizeResponse(body, RESPONSE_SHAPE.FACADE);
}

module.exports = {
  start,
  input,
  cancel,
  getStatus,
  getTimeline,
  getHistory,
  verify,
  resume,
  usage,
};
