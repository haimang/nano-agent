// app.js - 全局入口

const api = require('./utils/api');
const { verifyToken } = require('./api/auth');

App({
  globalData: {
    userInfo: null,
    isLoggedIn: false,
    isLoadingProfile: false,
    baseUrl: 'https://nano-agent-orchestrator-core-preview.haimang.workers.dev',
  },

  async onLaunch() {
    console.log('App Launch');
    // 尝试恢复登录状态
    const token = api.getJwtToken();
    if (token) {
      console.log('Token found in storage on launch, validating...');
      try {
        const result = await verifyToken(token);
        if (result.ok) {
          this.globalData.isLoggedIn = true;
          this.globalData.userInfo = result.data || null;
          console.log('Token validation passed');
        } else {
          console.warn('Token validation failed:', result.error);
          this.clearLoginState();
        }
      } catch (error) {
        console.error('Token validation error:', error);
        this.clearLoginState();
      }
    }
  },

  onShow() {
    console.log('App Show');
  },

  onHide() {
    console.log('App Hide');
  },

  // 设置登录状态
  setLoginState(userInfo, token, refreshToken) {
    this.globalData.isLoggedIn = true;
    this.globalData.userInfo = userInfo;
    api.setJwtToken(token);
    if (refreshToken) {
      api.setRefreshToken(refreshToken);
    }
  },

  // 清除登录状态
  clearLoginState() {
    this.globalData.isLoggedIn = false;
    this.globalData.userInfo = null;
    api.removeJwtToken();
  },

  // 更新用户信息
  updateUserInfo(userInfo) {
    this.globalData.userInfo = userInfo;
  },
});
