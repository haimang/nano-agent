// pages/profile/index.js
const { getMe } = require('../../api/auth');

Page({
  data: {
    isLoggedIn: false,
    userInfo: null,
    avatarText: '?',
    displayName: '未登录',
    hasEmail: false,
    userEmail: '',
    isLoading: false,
  },

  onShow() {
    this.checkLoginStatus();
  },

  onPullDownRefresh() {
    if (this.data.isLoggedIn) {
      this.fetchUserProfile().finally(() => {
        wx.stopPullDownRefresh();
      });
    } else {
      wx.stopPullDownRefresh();
    }
  },

  checkLoginStatus() {
    const app = getApp();
    const isLoggedIn = app.globalData.isLoggedIn;
    const userInfo = app.globalData.userInfo;
    
    this.setData({
      isLoggedIn,
      userInfo: userInfo,
      displayName: userInfo ? (userInfo.display_name || '未登录') : '未登录',
      hasEmail: userInfo ? !!userInfo.email : false,
      userEmail: userInfo ? (userInfo.email || '') : '',
    });

    if (isLoggedIn) {
      this.updateAvatarText(userInfo);
      this.fetchUserProfile();
    } else {
      this.setData({ avatarText: '?' });
    }
  },

  updateAvatarText(userInfo) {
    if (!userInfo) {
      this.setData({ avatarText: '?' });
      return;
    }
    const name = userInfo.display_name || userInfo.email || 'U';
    this.setData({ avatarText: name.charAt(0).toUpperCase() });
  },

  async fetchUserProfile() {
    this.setData({ isLoading: true });
    
    try {
      const result = await getMe();

      if (result.ok) {
        const userInfo = result.data?.user || result.data;
        const app = getApp();
        app.updateUserInfo(userInfo);
        this.setData({
          userInfo: userInfo,
          displayName: userInfo ? (userInfo.display_name || '未登录') : '未登录',
          hasEmail: userInfo ? !!userInfo.email : false,
          userEmail: userInfo ? (userInfo.email || '') : '',
        });
        this.updateAvatarText(userInfo);
      } else {
        console.error('Fetch profile failed:', result.error);
        if (result.error?.code === 'invalid-auth' || result.error?.status === 401) {
          this.handleLogout();
        }
      }
    } catch (error) {
      console.error('Fetch profile error:', error);
      if (error.code === 'AUTH_FAILURE' || error.statusCode === 401) {
        this.handleLogout();
      }
    } finally {
      this.setData({ isLoading: false });
    }
  },

  goToLogin() {
    wx.navigateTo({ url: '/pages/auth/index' });
  },

  handleLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      success: (res) => {
        if (res.confirm) {
          const app = getApp();
          app.clearLoginState();
          this.setData({
            isLoggedIn: false,
            userInfo: null,
            avatarText: '?',
          });
          wx.showToast({ title: '已退出登录', icon: 'none' });
        }
      },
    });
  },

  refreshProfile() {
    if (!this.data.isLoggedIn) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    this.fetchUserProfile();
  },

  goToDebug() {
    wx.navigateTo({ url: '/pages/index/index' });
  },

  showAbout() {
    wx.showModal({
      title: '关于 Nano Agent',
      content: 'Nano Agent 是一个智能对话助手，基于 Cloudflare Workers 和 D1 构建。\n\n版本: v1.0.0',
      showCancel: false,
    });
  },
});
