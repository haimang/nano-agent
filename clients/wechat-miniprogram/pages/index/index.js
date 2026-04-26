const { uuid, request, authHeaders, connectStream, readErrMessage } = require("../../utils/nano-client");
const { collectWechatLoginPayload } = require("../../utils/wechat-auth");
const app = getApp();

Page({
  data: {
    baseUrl: app.globalData.baseUrl,
    email: `z4-${Date.now()}@nano-agent.test`,
    password: "NanoAgent!z4-mini",
    prompt: "Reply with one short sentence and, if useful, call pwd.",
    sessionUuid: uuid(),
    token: "",
    lastSeenSeq: 0,
    logs: []
  },

  onBaseUrl(event) { this.setData({ baseUrl: event.detail.value }); },
  onEmail(event) { this.setData({ email: event.detail.value }); },
  onPassword(event) { this.setData({ password: event.detail.value }); },
  onPrompt(event) { this.setData({ prompt: event.detail.value }); },
  onSessionUuid(event) { this.setData({ sessionUuid: event.detail.value }); },

  log(entry) {
    const line = typeof entry === "string" ? entry : JSON.stringify(entry, null, 2);
    this.setData({ logs: [line, ...this.data.logs].slice(0, 50) });
  },

  async register() {
    try {
      await request(this.data.baseUrl, "/auth/register", {
        method: "POST",
        header: { "content-type": "application/json", "x-trace-uuid": uuid() },
        data: { email: this.data.email, password: this.data.password, display_name: "Z4 Mini User" }
      });
      await this.login();
    } catch (error) {
      this.log({ kind: "register.error", ...readErrMessage(error) });
    }
  },

  async login() {
    try {
      const body = await request(this.data.baseUrl, "/auth/login", {
        method: "POST",
        header: { "content-type": "application/json", "x-trace-uuid": uuid() },
        data: { email: this.data.email, password: this.data.password }
      });
      const token = body.data?.tokens?.access_token || "";
      this.setData({ token });
      this.log({ kind: "login.ok", team: body.data?.team });
    } catch (error) {
      this.log({ kind: "login.error", ...readErrMessage(error) });
    }
  },

  async wechatLogin() {
    try {
      const body = await request(this.data.baseUrl, "/auth/wechat/login", {
        method: "POST",
        header: { "content-type": "application/json", "x-trace-uuid": uuid() },
        data: await collectWechatLoginPayload()
      });
      const token = body.data?.tokens?.access_token || "";
      this.setData({ token });
      this.log({ kind: "wechat.login.ok", team: body.data?.team });
    } catch (error) {
      this.log({ kind: "wechat.login.error", ...readErrMessage(error) });
    }
  },

  async workerHealth() {
    try {
      const body = await request(this.data.baseUrl, "/debug/workers/health");
      this.log({ kind: "worker.health.ok", summary: body.summary, workers: body.workers });
    } catch (error) {
      this.log({ kind: "worker.health.error", ...readErrMessage(error) });
    }
  },

  async start() {
    await this.callSession("start", { initial_input: this.data.prompt });
  },

  async sendInput() {
    await this.callSession("input", { text: this.data.prompt, session_uuid: this.data.sessionUuid });
  },

  async timeline() {
    try {
      const body = await request(this.data.baseUrl, `/sessions/${this.data.sessionUuid}/timeline`, {
        header: authHeaders(this.data.token)
      });
      this.log({ kind: "timeline.ok", events: body.events || [] });
    } catch (error) {
      this.log({ kind: "timeline.error", ...readErrMessage(error) });
    }
  },

  stream() {
    if (!this.data.token) {
      this.log("login first");
      return;
    }
    this.socket?.close();
    this.socket = connectStream(
      this.data.baseUrl,
      this.data.token,
      this.data.sessionUuid,
      (event) => {
        if (typeof event.seq === "number" && event.seq > this.data.lastSeenSeq) {
          this.setData({ lastSeenSeq: event.seq });
        }
        this.log(event);
      },
      (state) => this.log(`ws ${state}`),
      this.data.lastSeenSeq
    );
  },

  async callSession(action, data) {
    try {
      const body = await request(this.data.baseUrl, `/sessions/${this.data.sessionUuid}/${action}`, {
        method: "POST",
        header: authHeaders(this.data.token, true),
        data
      });
      this.log({ kind: `${action}.ok`, body });
    } catch (error) {
      this.log({ kind: `${action}.error`, ...readErrMessage(error) });
    }
  }
});
