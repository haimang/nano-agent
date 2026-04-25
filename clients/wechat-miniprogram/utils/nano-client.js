function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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
          reject(new Error(res.data?.message || `HTTP ${res.statusCode}`));
          return;
        }
        resolve(res.data || {});
      },
      fail(err) {
        reject(new Error(err.errMsg || "request failed"));
      }
    });
  });
}

function authHeaders(token, json = false) {
  return {
    authorization: `Bearer ${token}`,
    "x-trace-uuid": uuid(),
    ...(json ? { "content-type": "application/json" } : {})
  };
}

function connectStream(baseUrl, token, sessionUuid, onMessage, onState) {
  const wsUrl = `${baseUrl.replace(/^http/, "ws")}/sessions/${sessionUuid}/ws?access_token=${encodeURIComponent(token)}&trace_uuid=${uuid()}`;
  const task = wx.connectSocket({ url: wsUrl });
  task.onOpen(() => onState?.("open"));
  task.onClose(() => onState?.("close"));
  task.onError((err) => onState?.(`error: ${err.errMsg || "unknown"}`));
  task.onMessage((event) => {
    try {
      onMessage(JSON.parse(event.data));
    } catch {
      onMessage({ kind: "client.invalid_json", raw: event.data });
    }
  });
  return task;
}

module.exports = {
  uuid,
  request,
  authHeaders,
  connectStream
};
