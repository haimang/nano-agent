// app.js - 全局入口

const api = require('./utils/api');

App({
  globalData: {
    userInfo: null,
    isLoggedIn: false,
    isLoadingProfile: false,
  },

  onLaunch() {
    console.log('App Launch');
    // 尝试恢复登录状态
    const token = api.getJwtToken();
    if (token) {
      console.log('Token found in storage on launch, will validate on first page show');
      this.globalData.isLoggedIn = true;
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
