/**
 * api/stream.js - WebSocket 会话流高级封装
 *
 * 基于 utils/nano-client.js 底层驱动，提供业务友好的事件订阅接口
 *
 * 当前 WS 限制（重要）：
 * - WS 是单向流：服务端推送事件，客户端发送的 heartbeat/resume/ack 仅用于保持连接活跃
 * - 服务端不会真正消费/解析客户端发来的消息内容
 * - 输入发送仍需通过 HTTP POST /sessions/{uuid}/input
 *
 * 预留未来帧类型回调（当前后端未发送，但已预留接口）：
 * - onOpened(meta) — meta(opened) 连接建立确认
 * - onPermissionRequest(request) — session.permission.request
 * - onUsageUpdate(usage) — session.usage.update
 * - onElicitationRequest(elicitation) — session.elicitation.request
 */

const { connectStream } = require('../utils/nano-client');
const { getJwtToken } = require('../utils/api');
const { WS_BASE_URL_MAP } = require('../apiRoutes');

const RECONNECT_INITIAL_DELAY = 1000;   // 初始重连延迟 1s
const RECONNECT_MAX_DELAY = 30000;      // 最大重连延迟 30s
const RECONNECT_MAX_ATTEMPTS = 5;       // 最大重连次数

const STORAGE_KEY_PREFIX = 'lastSeenSeq_';

/**
 * 从 storage 读取 lastSeenSeq
 * @param {string} sessionUuid
 * @returns {number}
 */
function getStoredLastSeenSeq(sessionUuid) {
  try {
    const value = wx.getStorageSync(STORAGE_KEY_PREFIX + sessionUuid);
    return typeof value === 'number' ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * 将 lastSeenSeq 持久化到 storage
 * @param {string} sessionUuid
 * @param {number} seq
 */
function setStoredLastSeenSeq(sessionUuid, seq) {
  try {
    wx.setStorageSync(STORAGE_KEY_PREFIX + sessionUuid, seq);
  } catch (e) {
    console.warn('Failed to persist lastSeenSeq:', e);
  }
}

/**
 * 指数退避计算延迟
 * @param {number} attempt
 * @returns {number}
 */
function backoffDelay(attempt) {
  return Math.min(RECONNECT_INITIAL_DELAY * Math.pow(2, attempt), RECONNECT_MAX_DELAY);
}

/**
 * 将后端 WS frame 转换为内部标准事件
 * @param {Object} frame
 * @returns {Object|null} {type, data, seq} 或 null（未知类型）
 */
function convertFrame(frame) {
  if (!frame || !frame.kind) return null;

  switch (frame.kind) {
    case 'event':
      if (frame.name === 'session.stream.event' && frame.payload) {
        return { type: frame.payload.kind || 'unknown', data: frame.payload, seq: frame.seq };
      }
      return { type: 'unknown.event', data: frame, seq: frame.seq };

    case 'session.heartbeat':
      return { type: 'heartbeat', data: { ts: frame.ts }, seq: frame.seq };

    case 'attachment_superseded':
      return { type: 'superseded', data: { reason: frame.reason, new_attachment_at: frame.new_attachment_at }, seq: frame.seq };

    case 'terminal':
      return { type: 'terminal', data: { terminal: frame.terminal, session_uuid: frame.session_uuid, last_phase: frame.last_phase }, seq: frame.seq };

    default:
      // 未知帧类型，透传
      return { type: `unknown.${frame.kind}`, data: frame, seq: frame.seq };
  }
}

/**
 * 建立 WebSocket 连接
 *
 * @param {string} sessionUuid
 * @param {Object} callbacks - 事件回调
 *   @param {Function} callbacks.onEvent({type, data, seq}) - 流事件（llm.delta, tool.call.progress 等）
 *   @param {Function} callbacks.onHeartbeat({ts}) - 心跳
 *   @param {Function} callbacks.onSuperseded({reason, new_attachment_at}) - 连接被替换
 *   @param {Function} callbacks.onTerminal({terminal, session_uuid, last_phase}) - 会话终态
 *   @param {Function} [callbacks.onError] - 错误
 *   @param {Function} [callbacks.onState] - 连接状态变化 ('open' | 'close' | 'error: ...')
 *   @param {Function} [callbacks.onPermanentDisconnect] - 永久断开（重连失败超过阈值）
 *   // 以下为预留，当前后端未发送
 *   @param {Function} [callbacks.onOpened] - meta(opened)
 *   @param {Function} [callbacks.onPermissionRequest] - session.permission.request
 *   @param {Function} [callbacks.onUsageUpdate] - session.usage.update
 *   @param {Function} [callbacks.onElicitationRequest] - session.elicitation.request
 * @param {Object} [options]
 *   @param {string} [options.baseUrl] - WS base URL，默认从 apiRoutes.js 读取
 * @returns {Object} {disconnect, getLastSeenSeq}
 */
function connect(sessionUuid, callbacks, options = {}) {
  const token = getJwtToken();
  if (!token) {
    console.error('[stream] No JWT token found, cannot connect WS');
    callbacks.onError && callbacks.onError({ code: 'AUTH_REQUIRED', message: 'No token found' });
    return { disconnect: () => {}, getLastSeenSeq: () => 0 };
  }

  const baseUrl = options.baseUrl || WS_BASE_URL_MAP.ORCHESTRATOR;
  let lastSeenSeq = getStoredLastSeenSeq(sessionUuid);
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let isManuallyDisconnected = false;
  let socketTask = null;

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (isManuallyDisconnected) return;
    if (reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      console.error(`[stream] Reconnect failed after ${RECONNECT_MAX_ATTEMPTS} attempts`);
      callbacks.onPermanentDisconnect && callbacks.onPermanentDisconnect({ reason: 'max_attempts_exceeded' });
      return;
    }

    const delay = backoffDelay(reconnectAttempts);
    reconnectAttempts++;
    console.log(`[stream] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})`);

    reconnectTimer = setTimeout(() => {
      if (!isManuallyDisconnected) {
        doConnect();
      }
    }, delay);
  };

  const handleMessage = (frame) => {
    // 更新 lastSeenSeq
    if (typeof frame.seq === 'number' && frame.seq > lastSeenSeq) {
      lastSeenSeq = frame.seq;
      setStoredLastSeenSeq(sessionUuid, lastSeenSeq);
    }

    // 转换并分发
    const event = convertFrame(frame);
    if (!event) return;

    switch (event.type) {
      case 'heartbeat':
        callbacks.onHeartbeat && callbacks.onHeartbeat(event.data);
        break;
      case 'superseded':
        callbacks.onSuperseded && callbacks.onSuperseded(event.data);
        break;
      case 'terminal':
        callbacks.onTerminal && callbacks.onTerminal(event.data);
        break;
      default:
        // 所有流事件都走 onEvent
        callbacks.onEvent && callbacks.onEvent(event);
        break;
    }
  };

  const handleState = (state) => {
    callbacks.onState && callbacks.onState(state);

    if (state === 'open') {
      reconnectAttempts = 0; // 连接成功后重置重连计数
    } else if (state === 'close' || state.startsWith('error:')) {
      scheduleReconnect();
    }
  };

  const doConnect = () => {
    if (isManuallyDisconnected) return;
    try {
      socketTask = connectStream(baseUrl, token, sessionUuid, handleMessage, handleState, lastSeenSeq);
    } catch (error) {
      console.error('[stream] Failed to connect:', error);
      callbacks.onError && callbacks.onError({ code: 'connect_failed', message: error.message });
      scheduleReconnect();
    }
  };

  const disconnect = () => {
    isManuallyDisconnected = true;
    clearReconnectTimer();
    if (socketTask && typeof socketTask.close === 'function') {
      try {
        socketTask.close();
      } catch (e) {
        // ignore
      }
    }
    socketTask = null;
  };

  const getLastSeenSeq = () => lastSeenSeq;

  // 立即开始首次连接
  doConnect();

  return { disconnect, getLastSeenSeq };
}

module.exports = {
  connect,
  getStoredLastSeenSeq,
  setStoredLastSeenSeq,
};
