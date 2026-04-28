// pages/auth/index.js
const { register, login, wechatLogin } = require('../../api/auth');
const { collectWechatLoginPayload } = require('../../utils/wechat-auth');

Page({
  data: {
    activeTab: 'login',
    email: '',
    password: '',
    displayName: '',
    isLoading: false,
  },

  onLoad(options) {
    if (options.redirect) {
      this.redirectUrl = decodeURIComponent(options.redirect);
    }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
  },

  onEmailInput(e) {
    this.setData({ email: e.detail.value });
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },

  onDisplayNameInput(e) {
    this.setData({ displayName: e.detail.value });
  },

  async handleSubmit() {
    const { activeTab, email, password, displayName } = this.data;

    if (!email || !password) {
      wx.showToast({ title: '请填写邮箱和密码', icon: 'none' });
      return;
    }

    this.setData({ isLoading: true });

    try {
      if (activeTab === 'register') {
        await this.doRegister(email, password, displayName);
      } else {
        await this.doLogin(email, password);
      }
    } catch (error) {
      console.error('Auth error:', error);
      wx.showToast({ title: error.message || '操作失败', icon: 'none' });
    } finally {
      this.setData({ isLoading: false });
    }
  },

  async doRegister(email, password, displayName) {
    const result = await register(email, password, displayName);

    if (result.ok) {
      wx.showToast({ title: '注册成功', icon: 'success' });
      await this.doLogin(email, password);
    } else {
      throw new Error(result.error?.message || '注册失败');
    }
  },

  async doLogin(email, password) {
    const result = await login(email, password);

    if (result.ok) {
      const token = result.data?.tokens?.access_token;
      const refreshToken = result.data?.tokens?.refresh_token;
      const user = result.data?.user;

      if (token) {
        const app = getApp();
        app.setLoginState(user, token, refreshToken);
        wx.showToast({ title: '登录成功', icon: 'success' });
        this.navigateAfterAuth();
      } else {
        throw new Error('登录响应缺少 token');
      }
    } else {
      throw new Error(result.error?.message || '登录失败');
    }
  },

  async handleWechatLogin() {
    if (this.data.isLoading) return;
    this.setData({ isLoading: true });
    try {
      const loginPayload = await collectWechatLoginPayload();
      const result = await wechatLogin(
        loginPayload.code,
        loginPayload.encrypted_data,
        loginPayload.iv,
        loginPayload.display_name
      );

      if (result.ok) {
        const token = result.data?.tokens?.access_token;
        const refreshToken = result.data?.tokens?.refresh_token;
        const user = result.data?.user;

        if (token) {
          const app = getApp();
          app.setLoginState(user, token, refreshToken);
          wx.showToast({ title: '登录成功', icon: 'success' });
          this.navigateAfterAuth();
        } else {
          throw new Error('微信登录响应缺少 token');
        }
      } else {
        throw new Error(result.error?.message || '微信登录失败');
      }
    } catch (error) {
      console.error('Wechat login error:', error);
      wx.showToast({ title: error.message || '微信登录失败', icon: 'none' });
    } finally {
      this.setData({ isLoading: false });
    }
  },

  navigateAfterAuth() {
    if (this.redirectUrl) {
      wx.redirectTo({ url: this.redirectUrl });
    } else {
      wx.switchTab({ url: '/pages/chat/index' });
    }
  },

  goBack() {
    wx.switchTab({ url: '/pages/chat/index' });
  },
});
