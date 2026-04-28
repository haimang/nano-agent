// pages/chat/index.js
const { createSession, listSessions } = require('../../api/me');

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
            wx.navigateTo({ url: '/pages/auth/index' });
          }
        },
      });
      return;
    }

    this.setData({ isLoading: true });
    
    try {
      const result = await createSession();
      if (!result.ok) {
        throw new Error(result.error?.message || '创建会话失败');
      }
      
      const sessionUuid = result.data?.session_uuid;
      if (!sessionUuid) {
        throw new Error('服务器未返回会话ID');
      }

      wx.navigateTo({
        url: '/pages/session/index?sessionUuid=' + sessionUuid,
      });
    } catch (error) {
      console.error('Start session error:', error);
      wx.showToast({ title: '创建会话失败: ' + (error.message || ''), icon: 'none' });
    } finally {
      this.setData({ isLoading: false });
    }
  },

  viewHistory() {
    wx.showToast({ title: '历史记录功能开发中', icon: 'none' });
  },

  openSession(e) {
    const uuid = e.currentTarget.dataset.uuid;
    wx.navigateTo({
      url: '/pages/session/index?sessionUuid=' + uuid,
    });
  },

  goToLogin() {
    wx.navigateTo({ url: '/pages/auth/index' });
  },

  goToProfile() {
    wx.switchTab({ url: '/pages/profile/index' });
  },

  async loadRecentSessions() {
    try {
      const result = await listSessions();
      if (!result.ok) {
        console.error('Load sessions error:', result.error);
        this.setData({ recentSessions: [] });
        return;
      }
      
      const sessions = (result.data?.sessions || []).slice(0, 10).map((s) => ({
        session_uuid: s.session_uuid,
        title: s.status || '对话',
        updated_at: s.last_seen_at
          ? new Date(s.last_seen_at).toLocaleString('zh-CN')
          : '',
        status: s.status,
        last_phase: s.last_phase,
      }));
      
      this.setData({ recentSessions: sessions });
    } catch (error) {
      console.error('Load recent sessions error:', error);
      this.setData({ recentSessions: [] });
    }
  },

  goToDebug() {
    wx.navigateTo({ url: '/pages/index/index' });
  },
});
