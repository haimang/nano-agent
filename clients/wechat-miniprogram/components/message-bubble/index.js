// components/message-bubble/index.js
Component({
  properties: {
    role: {
      type: String,
      value: 'assistant',
    },
    content: {
      type: String,
      value: '',
    },
    status: {
      type: String,
      value: 'success',
    },
    toolInfo: {
      type: Object,
      value: null,
    },
    isThinking: {
      type: Boolean,
      value: false,
    },
    timestamp: {
      type: Number,
      value: 0,
    },
  },

  data: {
    formattedTime: '',
    showThinking: false,
    showToolDetails: false,
    isToolRelated: false,
    toolDisplayName: '',
    errorText: '',
    showFinalResponse: false,
    hasContent: false,
  },

  lifetimes: {
    attached() {
      this.formatTime();
      this.computeDerivedData();
    },
  },

  observers: {
    timestamp() {
      this.formatTime();
    },
    status() {
      this.computeDerivedData();
    },
    toolInfo() {
      this.computeDerivedData();
    },
    content() {
      this.computeDerivedData();
    },
    isThinking() {
      this.computeDerivedData();
    },
  },

  methods: {
    formatTime() {
      const ts = this.properties.timestamp;
      if (!ts) {
        const now = new Date();
        this.setData({
          formattedTime: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`,
        });
        return;
      }
      const date = new Date(ts);
      this.setData({
        formattedTime: `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`,
      });
    },

    computeDerivedData() {
      const { status, toolInfo, content, isThinking } = this.properties;
      const isToolRelated = status === 'tool_calling' || status === 'tool_result';
      const toolDisplayName = (toolInfo && toolInfo.name) ? toolInfo.name : '工具调用';
      const errorText = content || '发送失败，点击重试';
      const hasContent = !!(content && content.length > 0);
      const showFinalResponse = hasContent && !isThinking && status !== 'tool_calling';

      this.setData({
        isToolRelated,
        toolDisplayName,
        errorText,
        hasContent,
        showFinalResponse,
      });
    },

    toggleThinking() {
      this.setData({ showThinking: !this.data.showThinking });
    },

    toggleToolDetails() {
      this.setData({ showToolDetails: !this.data.showToolDetails });
    },
  },
});
