// pages/session/index.js
const { start, input } = require('../../api/session');
const { connect } = require('../../api/stream');

Page({
  data: {
    sessionUuid: '',
    sessionTitle: '',
    messages: [],
    inputValue: '',
    isSending: false,
    isConnected: false,
    scrollToView: '',
    logs: [],
    showLogPanel: false,
  },

  socketController: null,
  messageIdCounter: 0,
  currentAssistantMessageId: null,

  async onLoad(options) {
    const sessionUuid = options.sessionUuid || this.generateUuid();
    this.setData({ sessionUuid });
    
    if (options.initialInput) {
      this.setData({ inputValue: options.initialInput });
    }
    
    // 尝试自动启动 session（如果还没启动）
    await this.ensureSessionStarted(options.initialInput || '');
  },

  async ensureSessionStarted(initialInput) {
    try {
      const result = await start(this.data.sessionUuid, initialInput);
      if (result.ok) {
        this.log('Session 自动启动成功');
      } else if (result.error?.code === 'session-already-started') {
        this.log('Session 已启动');
      } else {
        this.log('Session 启动检查: ' + (result.error?.message || result.error?.code || 'unknown'));
      }
    } catch (error) {
      this.log('Session 启动检查: ' + (error.message || error.code || 'unknown'));
    }
  },

  onShow() {
    this.connectWebSocket();
  },

  onHide() {
    this.disconnectWebSocket();
  },

  onUnload() {
    this.disconnectWebSocket();
  },

  generateUuid() {
    const hex = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
    hex[6] = (hex[6] & 0x0f) | 0x40;
    hex[8] = (hex[8] & 0x3f) | 0x80;
    const h = hex.map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  },

  connectWebSocket() {
    this.log('正在连接 WebSocket...');
    
    try {
      this.socketController = connect(
        this.data.sessionUuid,
        {
          onEvent: (event) => this.handleStreamEvent(event),
          onHeartbeat: () => {
            // 心跳，忽略
          },
          onSuperseded: (data) => {
            this.log(`连接被替换: ${data.reason || 'new attachment'}`);
            this.showError('此会话已在其他设备上打开');
            this.disconnectWebSocket();
          },
          onTerminal: (data) => {
            this.log(`会话终态: ${data.terminal}, phase: ${data.last_phase}`);
            this.finalizeAssistantMessage();
            this.setData({ isSending: false });
          },
          onError: (err) => {
            this.log(`WebSocket 错误: ${err.message || err.code || 'unknown'}`);
          },
          onState: (state) => {
            const connected = state === 'open';
            this.setData({ isConnected: connected });
            this.log(`WebSocket 状态: ${state}`);
          },
          onPermanentDisconnect: (data) => {
            this.log(`永久断开: ${data.reason}`);
            this.showError('连接已断开，请重试');
          },
        }
      );
    } catch (error) {
      this.log(`WebSocket 连接失败: ${error.message}`);
    }
  },

  disconnectWebSocket() {
    if (this.socketController) {
      this.socketController.disconnect();
      this.socketController = null;
      this.setData({ isConnected: false });
      this.log('WebSocket 已断开');
    }
  },

  handleStreamEvent(event) {
    this.log(`收到: ${JSON.stringify(event).slice(0, 300)}`);
    
    const { type, data } = event;
    
    switch (type) {
      case 'llm.delta':
        this.handleLlmDelta(data);
        break;
      
      case 'tool.call.progress':
        this.handleToolProgress(data);
        break;
      
      case 'tool.call.result':
        this.handleToolResult(data);
        break;
      
      case 'turn.begin':
        this.handleTurnBegin(data);
        break;
      
      case 'turn.end':
        this.handleTurnEnd(data);
        break;
      
      case 'system.notify':
        this.addSystemMessage(data.message || '系统通知');
        break;
      
      case 'session.update':
        // 会话更新，可忽略或更新标题
        break;
      
      default:
        this.log(`未处理的事件类型: ${type}`);
    }
  },

  handleLlmDelta(body) {
    const contentType = body.content_type;
    const content = body.content || '';

    if (contentType === 'tool_use_start') {
      try {
        const toolInfo = JSON.parse(content);
        this.startToolCall(toolInfo);
      } catch (e) {
        this.log(`解析工具调用失败: ${e.message}`);
      }
    } else if (contentType === 'tool_use_delta') {
      // 工具调用参数增量（暂不处理，等待完整结果）
    } else {
      // 普通文本（思考过程或最终回复）
      this.appendAssistantText(content);
    }
  },

  handleToolProgress(body) {
    const { tool_name, progress } = body;
    this.log(`工具执行中: ${tool_name} - ${progress}%`);
  },

  handleToolResult(body) {
    const { tool_name, result, error } = body;
    
    if (error) {
      this.updateToolResult(tool_name, null, error);
    } else {
      this.updateToolResult(tool_name, result, null);
    }
  },

  handleTurnBegin(body) {
    this.log('回合开始');
  },

  handleTurnEnd(body) {
    this.log('回合结束');
    this.finalizeAssistantMessage();
  },

  startToolCall(toolInfo) {
    const messages = this.data.messages;
    const lastMessage = messages[messages.length - 1];
    
    if (lastMessage && lastMessage.role === 'assistant') {
      lastMessage.status = 'tool_calling';
      lastMessage.toolInfo = {
        name: toolInfo.name,
        arguments: JSON.stringify(toolInfo.arguments, null, 2),
        result: null,
      };
      this.setData({ messages: [...messages] });
    } else {
      this.addMessage('assistant', '', 'tool_calling', {
        name: toolInfo.name,
        arguments: JSON.stringify(toolInfo.arguments, null, 2),
        result: null,
      });
    }
    this.scrollToBottom();
  },

  updateToolResult(toolName, result, error) {
    const messages = this.data.messages;
    
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && msg.status === 'tool_calling' && msg.toolInfo?.name === toolName) {
        msg.status = 'tool_result';
        msg.toolInfo.result = error 
          ? `错误: ${error}` 
          : JSON.stringify(result, null, 2);
        this.setData({ messages: [...messages] });
        break;
      }
    }
  },

  appendAssistantText(text) {
    const messages = this.data.messages;
    const lastMessage = messages[messages.length - 1];
    
    if (lastMessage && lastMessage.role === 'assistant' && 
        (lastMessage.status === 'sending' || lastMessage.status === 'thinking')) {
      lastMessage.content += text;
      this.setData({ messages: [...messages] });
    } else {
      this.addMessage('assistant', text, 'thinking', null, true);
    }
    this.scrollToBottom();
  },

  addSystemMessage(content) {
    this.addMessage('system', content, 'success');
  },

  onInputChange(e) {
    this.setData({ inputValue: e.detail.value });
  },

  async sendMessage() {
    const { inputValue, sessionUuid, isSending } = this.data;
    
    if (!inputValue.trim() || isSending) return;

    const text = inputValue.trim();

    // 添加用户消息
    this.addMessage('user', text);
    this.setData({ inputValue: '', isSending: true });
    this.scrollToBottom();

    try {
      // 当前 public WS 不会真正解析/消费客户端发来的 input body
      // authoritative 发送入口仍是 HTTP POST /sessions/{uuid}/input
      const result = await input(sessionUuid, text);
      if (!result.ok) {
        throw new Error(result.error?.message || '发送失败');
      }
      this.log('通过 HTTP 发送消息');

      // 添加 AI 消息占位
      this.currentAssistantMessageId = this.addMessage('assistant', '', 'sending');
      this.scrollToBottom();
    } catch (error) {
      console.error('Send message error:', error);
      this.showError('发送失败: ' + (error.message || '未知错误'));
      this.setData({ isSending: false });
    }
  },

  addMessage(role, content, status = 'success', toolInfo = null, isThinking = false) {
    const id = ++this.messageIdCounter;
    const messages = [...this.data.messages, {
      id,
      role,
      content,
      status,
      toolInfo,
      isThinking,
      timestamp: Date.now(),
    }];
    this.setData({ messages });
    return id;
  },

  finalizeAssistantMessage() {
    const messages = this.data.messages;
    const lastMessage = messages[messages.length - 1];
    
    if (lastMessage && lastMessage.role === 'assistant' && lastMessage.status !== 'tool_calling') {
      lastMessage.status = 'success';
      lastMessage.isThinking = false;
      this.setData({ messages: [...messages], isSending: false });
    }
    this.currentAssistantMessageId = null;
  },

  showError(message) {
    const messages = this.data.messages;
    const lastMessage = messages[messages.length - 1];
    
    if (lastMessage && lastMessage.role === 'assistant' && 
        (lastMessage.status === 'sending' || lastMessage.status === 'thinking')) {
      lastMessage.status = 'error';
      lastMessage.content = message;
      this.setData({ messages: [...messages], isSending: false });
    } else {
      this.addMessage('assistant', message, 'error');
      this.setData({ isSending: false });
    }
  },

  scrollToBottom() {
    this.setData({ scrollToView: 'bottom-anchor' });
  },

  toggleConnection() {
    if (this.data.isConnected) {
      this.disconnectWebSocket();
    } else {
      this.connectWebSocket();
    }
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  log(entry) {
    const line = typeof entry === 'string' ? entry : JSON.stringify(entry, null, 2);
    const logs = [line, ...this.data.logs].slice(0, 50);
    this.setData({ logs });
  },

  showLogs() {
    this.setData({ showLogPanel: true });
  },

  hideLogs() {
    this.setData({ showLogPanel: false });
  },

  clearLogs() {
    this.setData({ logs: [] });
  },
});
