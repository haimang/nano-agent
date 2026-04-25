function uuid() {
  const random = typeof crypto !== "undefined" && crypto.getRandomValues
    ? Array.from(crypto.getRandomValues(new Uint8Array(16)))
    : Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  random[6] = (random[6] & 0x0f) | 0x40;
  random[8] = (random[8] & 0x3f) | 0x80;
  const hex = random.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function classifyError(statusCode, data) {
  const error = data?.error && typeof data.error === "object" ? data.error : data || {};
  const code = typeof error.code === "string" ? error.code : typeof data?.error === "string" ? data.error : "";
  return {
    kind: statusCode === 401
      ? "auth.expired"
      : code === "QUOTA_EXCEEDED" || statusCode === 429
        ? "quota.exceeded"
        : statusCode >= 500
          ? "runtime.error"
          : "request.error",
    status: statusCode,
    code,
    message: error.message || data?.message || `HTTP ${statusCode}`,
    quotaKind: error.quota_kind,
    remaining: error.remaining,
    limitValue: error.limit_value
  };
}

function clientError(details) {
  const err = new Error(details.message);
  err.details = details;
  return err;
}

function updateLastSeen(current, event) {
  if (event && typeof event.seq === "number" && Number.isFinite(event.seq) && event.seq > current) {
    return event.seq;
  }
  return current;
}

function heartbeatFrame() {
  return JSON.stringify({ message_type: "session.heartbeat", body: { ts: Date.now() } });
}

function resumeFrame(lastSeenSeq) {
  return JSON.stringify({
    message_type: "session.resume",
    body: { last_seen_seq: Math.max(0, Math.trunc(lastSeenSeq || 0)) }
  });
}

function ackFrame(seq) {
  return JSON.stringify({
    message_type: "session.stream.ack",
    body: { stream_uuid: "main", acked_seq: seq }
  });
}

function safeSend(task, data) {
  try {
    task.send({ data });
  } catch {
    // The socket may have closed between timer ticks; close handlers clear the timer.
  }
}

function normalizeSocketTask(task) {
  return typeof task?.send === "function" ? task : wx;
}

function readErrMessage(error) {
  if (error?.details) return error.details;
  return { kind: "request.error", message: error?.message || String(error) };
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function randomTraceUuid() {
  const value = uuid();
  if (!isUuid(value)) {
    throw new Error("generated trace uuid is invalid");
  }
  return value;
}

function onSocketMessage(task, event, onMessage, getLastSeenSeq, setLastSeenSeq) {
  try {
    const parsed = JSON.parse(event.data);
    const nextSeq = updateLastSeen(getLastSeenSeq(), parsed);
    if (nextSeq !== getLastSeenSeq()) {
      setLastSeenSeq(nextSeq);
      safeSend(task, ackFrame(nextSeq));
    }
    onMessage(parsed);
  } catch {
    onMessage({ kind: "client.invalid_json", raw: event.data });
  }
}

function bindSocketLifecycle(task, onMessage, onState, initialLastSeenSeq) {
  let lastSeenSeq = Math.max(0, Math.trunc(initialLastSeenSeq || 0));
  let heartbeatTimer = null;
  const getLastSeenSeq = () => lastSeenSeq;
  const setLastSeenSeq = (seq) => {
    lastSeenSeq = seq;
  };
  const clearHeartbeat = () => {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };
  task.onOpen(() => {
    onState?.("open");
    safeSend(task, resumeFrame(lastSeenSeq));
    safeSend(task, heartbeatFrame());
    heartbeatTimer = setInterval(() => safeSend(task, heartbeatFrame()), 15000);
  });
  task.onClose(() => {
    clearHeartbeat();
    onState?.("close");
  });
  task.onError((err) => {
    clearHeartbeat();
    onState?.(`error: ${err.errMsg || "unknown"}`);
  });
  task.onMessage((event) => onSocketMessage(task, event, onMessage, getLastSeenSeq, setLastSeenSeq));
  task.getLastSeenSeq = getLastSeenSeq;
  return task;
}

function request(baseUrl, path, options = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl}${path}`,
      method: options.method || "GET",
      data: options.data,
      header: options.header || {},
      success(res) {
        if (res.statusCode < 200 || res.statusCode >= 300 || res.data?.ok === false) {
          reject(clientError(classifyError(res.statusCode, res.data)));
          return;
        }
        resolve(res.data || {});
      },
      fail(err) {
        reject(clientError({ kind: "request.error", status: 0, message: err.errMsg || "request failed" }));
      }
    });
  });
}

function authHeaders(token, json = false) {
  return {
    authorization: `Bearer ${token}`,
    "x-trace-uuid": randomTraceUuid(),
    ...(json ? { "content-type": "application/json" } : {})
  };
}

function connectStream(baseUrl, token, sessionUuid, onMessage, onState, lastSeenSeq = 0) {
  const wsUrl = `${baseUrl.replace(/^http/, "ws")}/sessions/${sessionUuid}/ws?access_token=${encodeURIComponent(token)}&trace_uuid=${randomTraceUuid()}&last_seen_seq=${Math.max(0, Math.trunc(lastSeenSeq || 0))}`;
  const task = normalizeSocketTask(wx.connectSocket({ url: wsUrl }));
  return bindSocketLifecycle(task, onMessage, onState, lastSeenSeq);
}

module.exports = {
  uuid,
  request,
  authHeaders,
  connectStream,
  readErrMessage
};
