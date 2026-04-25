// pages/chat/index.js
const api = require('../../utils/api');

Page({
  data: {
    isLoggedIn: false,
    isConnected: false,
    displayName: '未登录',
    avatarText: '?',
    recentSessions: [],
    stats: {
      sessionCount: 0,
      messageCount: 0,
      toolCount: 0,
    },
    isLoading: false,
  },

  onShow() {
    const app = getApp();
    const isLoggedIn = app.globalData.isLoggedIn;
    const userInfo = app.globalData.userInfo;
    
    this.setData({
      isLoggedIn,
      displayName: userInfo ? (userInfo.display_name || '用户') : '未登录',
      avatarText: userInfo ? (userInfo.display_name || 'U').charAt(0).toUpperCase() : '?',
    });
    
    if (isLoggedIn) {
      this.loadRecentSessions();
    }
  },

  // 开始新会话
  async startNewSession() {
    const app = getApp();
    
    if (!app.globalData.isLoggedIn) {
      wx.showModal({
        title: '需要登录',
        content: '开始对话需要登录，是否前往登录？',
        confirmText: '去登录',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ 
              url: '/pages/auth/index'
            });
          }
        },
      });
      return;
    }

    this.setData({ isLoading: true });
    
    try {
      const sessionUuid = this.generateUuid();
      
      await api.request('sessionStart', {
        pathParams: { sessionUuid },
        data: { initial_input: '' },
      });

      wx.navigateTo({
        url: '/pages/session/index?sessionUuid=' + sessionUuid,
      });
    } catch (error) {
      console.error('Start session error:', error);
      wx.showToast({ title: '创建会话失败', icon: 'none' });
    } finally {
      this.setData({ isLoading: false });
    }
  },

  generateUuid() {
    const hex = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
    hex[6] = (hex[6] & 0x0f) | 0x40;
    hex[8] = (hex[8] & 0x3f) | 0x80;
    const h = hex.map((b) => b.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  },

  // 查看历史记录
  viewHistory() {
    wx.showToast({ title: '历史记录功能开发中', icon: 'none' });
  },

  // 打开已有会话
  openSession(e) {
    const uuid = e.currentTarget.dataset.uuid;
    wx.navigateTo({
      url: '/pages/session/index?sessionUuid=' + uuid,
    });
  },

  // 去登录
  goToLogin() {
    wx.navigateTo({ url: '/pages/auth/index' });
  },

  // 去个人中心
  goToProfile() {
    wx.switchTab({ url: '/pages/profile/index' });
  },

  // 加载最近会话（预留）
  async loadRecentSessions() {
    this.setData({ recentSessions: [] });
  },

  // 去调试页面
  goToDebug() {
    wx.navigateTo({ url: '/pages/index/index' });
  },
});
