// pages/auth/index.js
const api = require('../../utils/api');

Page({
  data: {
    activeTab: 'login',
    email: '',
    password: '',
    displayName: '',
    isLoading: false,
  },

  onLoad(options) {
    // 如果带有 redirect 参数，记录跳转目标
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
    const res = await api.request('register', {
      method: 'POST',
      data: {
        email,
        password,
        display_name: displayName || email.split('@')[0],
      },
      requireAuth: false,
      showLoading: false,
    });

    if (res.ok) {
      wx.showToast({ title: '注册成功', icon: 'success' });
      // 注册成功后自动登录
      await this.doLogin(email, password);
    } else {
      throw new Error(res.error?.message || '注册失败');
    }
  },

  async doLogin(email, password) {
    const res = await api.request('login', {
      method: 'POST',
      data: { email, password },
      requireAuth: false,
      showLoading: false,
    });

    if (res.ok) {
      const token = res.data?.tokens?.access_token;
      const refreshToken = res.data?.tokens?.refresh_token;
      const user = res.data?.user;

      if (token) {
        const app = getApp();
        app.setLoginState(user, token, refreshToken);
        wx.showToast({ title: '登录成功', icon: 'success' });
        this.navigateAfterAuth();
      } else {
        throw new Error('登录响应缺少 token');
      }
    } else {
      throw new Error(res.error?.message || '登录失败');
    }
  },

  handleWechatLogin() {
    if (this.data.isLoading) return;
    this.setData({ isLoading: true });

    wx.login({
      success: async (res) => {
        if (res.code) {
          try {
            const loginRes = await api.request('wechatLogin', {
              method: 'POST',
              data: { code: res.code },
              requireAuth: false,
              showLoading: false,
            });

            if (loginRes.ok) {
              const token = loginRes.data?.tokens?.access_token;
              const refreshToken = loginRes.data?.tokens?.refresh_token;
              const user = loginRes.data?.user;

              if (token) {
                const app = getApp();
                app.setLoginState(user, token, refreshToken);
                wx.showToast({ title: '登录成功', icon: 'success' });
                this.navigateAfterAuth();
              } else {
                throw new Error('微信登录响应缺少 token');
              }
            } else {
              throw new Error(loginRes.error?.message || '微信登录失败');
            }
          } catch (error) {
            console.error('Wechat login error:', error);
            wx.showToast({ title: error.message || '微信登录失败', icon: 'none' });
          } finally {
            this.setData({ isLoading: false });
          }
        } else {
          wx.showToast({ title: '获取微信登录凭证失败', icon: 'none' });
          this.setData({ isLoading: false });
        }
      },
      fail: (err) => {
        console.error('wx.login failed:', err);
        wx.showToast({ title: '微信登录接口调用失败', icon: 'none' });
        this.setData({ isLoading: false });
      },
    });
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
