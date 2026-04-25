// pages/session/index.js
const api = require('../../utils/api');
const { connectStream } = require('../../utils/nano-client');

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

  socket: null,
  messageIdCounter: 0,
  currentAssistantMessageId: null,

  onLoad(options) {
    const sessionUuid = options.sessionUuid || this.generateUuid();
    this.setData({ sessionUuid });
    
    if (options.initialInput) {
      this.setData({ inputValue: options.initialInput });
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

  // 连接 WebSocket
  connectWebSocket() {
    const token = api.getJwtToken();
    if (!token) {
      this.log('未登录，无法连接 WebSocket');
      return;
    }

    const baseUrl = 'https://nano-agent-orchestrator-core-preview.haimang.workers.dev';
    
    this.log('正在连接 WebSocket...');
    
    try {
      this.socket = connectStream(
        baseUrl,
        token,
        this.data.sessionUuid,
        (event) => this.handleWebSocketMessage(event),
        (state) => this.handleWebSocketState(state),
        0
      );
    } catch (error) {
      this.log(`WebSocket 连接失败: ${error.message}`);
    }
  },

  // 断开 WebSocket
  disconnectWebSocket() {
    if (this.socket) {
      this.socket.close?.();
      this.socket = null;
      this.setData({ isConnected: false });
      this.log('WebSocket 已断开');
    }
  },

  // 处理 WebSocket 消息
  handleWebSocketMessage(event) {
    this.log(`收到: ${JSON.stringify(event).slice(0, 300)}`);

    // Agentic Loop 消息处理
    const { message_type, body } = event;

    switch (message_type) {
      case 'session.stream.event':
        this.handleStreamEvent(body);
        break;
      
      case 'session.stream.chunk':
        // 兼容旧格式
        this.appendAssistantText(body?.text || '');
        break;
      
      case 'session.stream.done':
        this.finalizeAssistantMessage();
        break;
      
      case 'session.error':
        this.showError(body?.message || '会话错误');
        break;
      
      case 'session.heartbeat':
        // 心跳，忽略
        break;
      
      default:
        // 尝试从 body 解析
        if (body?.text) {
          this.appendAssistantText(body.text);
        }
        if (body?.kind) {
          this.handleStreamEvent(body);
        }
    }
  },

  // 处理流事件（Agentic Loop）
  handleStreamEvent(body) {
    if (!body || !body.kind) return;

    const { kind } = body;

    switch (kind) {
      case 'llm.delta':
        this.handleLlmDelta(body);
        break;
      
      case 'tool.call.progress':
        this.handleToolProgress(body);
        break;
      
      case 'tool.call.result':
        this.handleToolResult(body);
        break;
      
      case 'turn.begin':
        this.handleTurnBegin(body);
        break;
      
      case 'turn.end':
        this.handleTurnEnd(body);
        break;
      
      case 'system.notify':
        this.addSystemMessage(body.message || '系统通知');
        break;
      
      case 'session.update':
        // 会话更新，可忽略或更新标题
        break;
      
      default:
        this.log(`未处理的事件类型: ${kind}`);
    }
  },

  // 处理 LLM 增量
  handleLlmDelta(body) {
    const contentType = body.content_type;
    const content = body.content || '';

    if (contentType === 'tool_use_start') {
      // 工具调用开始
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

  // 处理工具进度
  handleToolProgress(body) {
    const { tool_name, progress } = body;
    this.log(`工具执行中: ${tool_name} - ${progress}%`);
    // 可以更新工具调用状态
  },

  // 处理工具结果
  handleToolResult(body) {
    const { tool_name, result, error } = body;
    
    if (error) {
      this.updateToolResult(tool_name, null, error);
    } else {
      this.updateToolResult(tool_name, result, null);
    }
  },

  // 回合开始
  handleTurnBegin(body) {
    this.log('回合开始');
    // 可以添加回合开始标记
  },

  // 回合结束
  handleTurnEnd(body) {
    this.log('回合结束');
    this.finalizeAssistantMessage();
  },

  // 开始工具调用（UI 状态）
  startToolCall(toolInfo) {
    const messages = this.data.messages;
    const lastMessage = messages[messages.length - 1];
    
    // 如果上一条是 assistant 消息，更新为工具调用状态
    if (lastMessage && lastMessage.role === 'assistant') {
      lastMessage.status = 'tool_calling';
      lastMessage.toolInfo = {
        name: toolInfo.name,
        arguments: JSON.stringify(toolInfo.arguments, null, 2),
        result: null,
      };
      this.setData({ messages: [...messages] });
    } else {
      // 创建新的工具调用消息
      this.addMessage('assistant', '', 'tool_calling', {
        name: toolInfo.name,
        arguments: JSON.stringify(toolInfo.arguments, null, 2),
        result: null,
      });
    }
    this.scrollToBottom();
  },

  // 更新工具结果
  updateToolResult(toolName, result, error) {
    const messages = this.data.messages;
    
    // 找到最近的工具调用消息
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

  // 追加文本到 assistant 消息
  appendAssistantText(text) {
    const messages = this.data.messages;
    const lastMessage = messages[messages.length - 1];
    
    if (lastMessage && lastMessage.role === 'assistant' && 
        (lastMessage.status === 'sending' || lastMessage.status === 'thinking')) {
      // 追加到现有消息
      lastMessage.content += text;
      this.setData({ messages: [...messages] });
    } else {
      // 创建新消息（可能是思考过程）
      this.addMessage('assistant', text, 'thinking', null, true);
    }
    this.scrollToBottom();
  },

  // 添加系统消息
  addSystemMessage(content) {
    this.addMessage('system', content, 'success');
  },

  // 输入变化
  onInputChange(e) {
    this.setData({ inputValue: e.detail.value });
  },

  // 发送消息
  async sendMessage() {
    const { inputValue, sessionUuid, isSending } = this.data;
    
    if (!inputValue.trim() || isSending) return;

    // 添加用户消息
    this.addMessage('user', inputValue.trim());
    this.setData({ inputValue: '', isSending: true });
    this.scrollToBottom();

    try {
      if (this.socket && this.data.isConnected) {
        const frame = JSON.stringify({
          message_type: 'session.input',
          body: { text: inputValue.trim() },
        });
        this.socket.send({ data: frame });
        this.log('通过 WebSocket 发送消息');
      } else {
        await api.request('sessionInput', {
          pathParams: { sessionUuid },
          data: { text: inputValue.trim() },
        });
        this.log('通过 HTTP 发送消息');
      }

      // 添加 AI 消息占位
      this.currentAssistantMessageId = this.addMessage('assistant', '', 'sending');
      this.scrollToBottom();
    } catch (error) {
      console.error('Send message error:', error);
      this.showError('发送失败: ' + (error.message || '未知错误'));
      this.setData({ isSending: false });
    }
  },

  // 添加消息
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

  // 完成 AI 消息
  finalizeAssistantMessage() {
    const messages = this.data.messages;
    const lastMessage = messages[messages.length - 1];
    
    if (lastMessage && lastMessage.role === 'assistant' && lastMessage.status !== 'tool_calling') {
      lastMessage.status = 'success';
      lastMessage.isThinking = false; // 思考完成
      this.setData({ messages: [...messages], isSending: false });
    }
    this.currentAssistantMessageId = null;
  },

  // 显示错误
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

  // 滚动到底部
  scrollToBottom() {
    this.setData({ scrollToView: 'bottom-anchor' });
  },

  // 切换连接
  toggleConnection() {
    if (this.data.isConnected) {
      this.disconnectWebSocket();
    } else {
      this.connectWebSocket();
    }
  },

  // 返回上一页
  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  // 日志相关
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
