// ZX5 Lane C C6 — wechat-miniprogram heartbeat adapter.
//
// 微信小程序 runtime 不能直接 import npm package(没有 bundler);本文件
// 是 `@haimang/nacp-session/heartbeat.ts` HeartbeatTracker 的 1:1 JS 镜像,
// 接口签名和 timing 阈值完全一致。
//
// 等小程序 build pipeline 接到 `@haimang/nacp-session` 时,本文件可以直接
// 删除并切到 root export(per Q3 owner direction:"以 @haimang/nacp-session
// root export 为准;必要时先补 browser/wechat adapter")。
//
// API mirror — must stay 1:1 with packages/nacp-session/src/heartbeat.ts:
//   new HeartbeatTracker({intervalMs?, timeoutMs?})
//   tracker.recordHeartbeat()
//   tracker.getStatus()           — 'healthy' | 'stale' | 'timeout'
//   tracker.isTimedOut()
//   tracker.getElapsedMs()
//   tracker.shouldSendHeartbeat(lastSentAt)
//   tracker.interval              (getter)
//   tracker.timeout               (getter)

class HeartbeatTracker {
  constructor(opts = {}) {
    this.intervalMs = opts.intervalMs ?? 15000;
    this.timeoutMs = opts.timeoutMs ?? 45000;
    this.lastReceivedAt = Date.now();
  }

  recordHeartbeat() {
    this.lastReceivedAt = Date.now();
  }

  getStatus() {
    const elapsed = Date.now() - this.lastReceivedAt;
    if (elapsed <= this.intervalMs * 1.5) return "healthy";
    if (elapsed <= this.timeoutMs) return "stale";
    return "timeout";
  }

  isTimedOut() {
    return this.getStatus() === "timeout";
  }

  getElapsedMs() {
    return Date.now() - this.lastReceivedAt;
  }

  shouldSendHeartbeat(lastSentAt) {
    return Date.now() - lastSentAt >= this.intervalMs;
  }

  get interval() {
    return this.intervalMs;
  }

  get timeout() {
    return this.timeoutMs;
  }
}

module.exports = { HeartbeatTracker };
