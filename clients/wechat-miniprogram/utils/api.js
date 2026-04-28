// utils/api.js - 统一请求封装（JWT、loading、错误处理、401 跳转）

const { apiRoutes, BASE_URL_MAP } = require('../apiRoutes');

// --- JWT Token 管理 ---
const TOKEN_KEY = 'nano_agent_token';
const REFRESH_TOKEN_KEY = 'nano_agent_refresh_token';

function getJwtToken() {
  try {
    return wx.getStorageSync(TOKEN_KEY);
  } catch (e) {
    console.error('Error getting JWT token from storage', e);
    return null;
  }
}

function setJwtToken(token) {
  try {
    wx.setStorageSync(TOKEN_KEY, token);
  } catch (e) {
    console.error('Error setting JWT token to storage', e);
  }
}

function getRefreshToken() {
  try {
    return wx.getStorageSync(REFRESH_TOKEN_KEY);
  } catch (e) {
    console.error('Error getting refresh token from storage', e);
    return null;
  }
}

function setRefreshToken(token) {
  try {
    wx.setStorageSync(REFRESH_TOKEN_KEY, token);
  } catch (e) {
    console.error('Error setting refresh token to storage', e);
  }
}

function removeJwtToken() {
  try {
    wx.removeStorageSync(TOKEN_KEY);
    wx.removeStorageSync(REFRESH_TOKEN_KEY);
  } catch (e) {
    console.error('Error removing JWT token from storage', e);
  }
}

// --- Trace UUID 生成 ---
function generateTraceUuid() {
  const hex = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  hex[6] = (hex[6] & 0x0f) | 0x40;
  hex[8] = (hex[8] & 0x3f) | 0x80;
  const h = hex.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// --- Token 刷新 ---
let isRefreshing = false;
let refreshSubscribers = [];

function onTokenRefreshed(newToken) {
  refreshSubscribers.forEach((callback) => callback(newToken));
  refreshSubscribers = [];
}

function addRefreshSubscriber(callback) {
  refreshSubscribers.push(callback);
}

async function doRefreshToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }

  return new Promise((resolve, reject) => {
    const routeInfo = apiRoutes.refresh;
    const baseUrl = BASE_URL_MAP[routeInfo.baseUrl];
    const url = `${baseUrl}${routeInfo.path}`;

    wx.request({
      url,
      method: 'POST',
      data: { refresh_token: refreshToken },
      header: {
        'content-type': 'application/json',
        'x-trace-uuid': generateTraceUuid(),
      },
      success: (res) => {
        const body = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300 && body.ok !== false) {
          const newAccessToken = body.data?.tokens?.access_token;
          const newRefreshToken = body.data?.tokens?.refresh_token;
          if (newAccessToken) {
            setJwtToken(newAccessToken);
            if (newRefreshToken) setRefreshToken(newRefreshToken);
            resolve(newAccessToken);
          } else {
            reject(new Error('Refresh response missing access_token'));
          }
        } else {
          reject(new Error(body.error?.message || 'Token refresh failed'));
        }
      },
      fail: (err) => {
        reject(new Error(`Network error during refresh: ${err.errMsg}`));
      },
    });
  });
}

async function refreshAccessToken() {
  if (isRefreshing) {
    return new Promise((resolve) => {
      addRefreshSubscriber((newToken) => resolve(newToken));
    });
  }

  isRefreshing = true;
  try {
    const newToken = await doRefreshToken();
    onTokenRefreshed(newToken);
    return newToken;
  } catch (error) {
    refreshSubscribers = [];
    throw error;
  } finally {
    isRefreshing = false;
  }
}

// --- 主请求函数 ---
function request(routeKey, options = {}) {
  return new Promise((resolve, reject) => {
    const routeInfo = apiRoutes[routeKey];
    if (!routeInfo) {
      console.error(`API route "${routeKey}" not found.`);
      wx.showToast({ title: '请求配置错误', icon: 'none' });
      return reject(new Error(`API route "${routeKey}" not found.`));
    }

    const baseUrl = BASE_URL_MAP[routeInfo.baseUrl];
    if (!baseUrl) {
      console.error(`Base URL for key "${routeInfo.baseUrl}" not found.`);
      wx.showToast({ title: '基础URL配置错误', icon: 'none' });
      return reject(new Error(`Base URL for key "${routeInfo.baseUrl}" not found.`));
    }

    // 处理路径参数
    let path = routeInfo.path;
    if (options.pathParams) {
      Object.entries(options.pathParams).forEach(([key, value]) => {
        path = path.replace(`{${key}}`, encodeURIComponent(value));
      });
    }
    const url = `${baseUrl}${path}`;
    const method = options.method || routeInfo.method || 'GET';
    const data = options.data;
    let headers = options.headers || {};
    const requireAuth = options.requireAuth !== false;

    if (requireAuth) {
      const token = getJwtToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      } else {
        console.warn(`Attempted to access authenticated route "${routeKey}" without JWT.`);
        wx.showModal({
          title: '需要登录',
          content: '此功能需要登录后才能使用，是否前往登录？',
          confirmText: '去登录',
          cancelText: '取消',
          success: (res) => {
            if (res.confirm) {
              wx.navigateTo({ url: '/pages/auth/index' });
            }
          },
        });
        const authError = new Error('Authentication required but no token found.');
        authError.code = 'AUTH_REQUIRED';
        return reject(authError);
      }
    }

    // 自动添加 trace-uuid
    if (!headers['x-trace-uuid']) {
      headers['x-trace-uuid'] = generateTraceUuid();
    }

    // content-type
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      if (!headers['content-type']) {
        headers['content-type'] = 'application/json';
      }
    }

    if (options.showLoading !== false) {
      wx.showLoading({
        title: options.loadingText || '加载中...',
        mask: true,
      });
    }

    function doRequest(currentToken) {
      if (currentToken && requireAuth) {
        headers['Authorization'] = `Bearer ${currentToken}`;
      }

      wx.request({
        url,
        method,
        data,
        header: headers,
        timeout: options.timeout || 30000,
        success: (res) => {
          if (options.showLoading !== false) {
            wx.hideLoading();
          }

          const body = res.data || {};

          // nano-agent 后端格式：{ ok: true, data: ... } 或 { ok: false, error: { code, message, status } }
          if (res.statusCode >= 200 && res.statusCode < 300 && body.ok !== false) {
            resolve(body);
          } else {
            console.error(`API request failed for "${routeKey}"`, res);
            const error = body.error || {};
            const errorMsg = error.message || body.message || `请求失败: ${res.statusCode}`;
            const errorCode = error.code || `HTTP_${res.statusCode}`;

            const apiError = new Error(errorMsg);
            apiError.statusCode = res.statusCode;
            apiError.code = errorCode;
            apiError.response = body;

            // 处理 401/403：尝试刷新 token，或跳转登录
            if (res.statusCode === 401 || res.statusCode === 403) {
              if (routeKey !== 'refresh' && routeKey !== 'login' && routeKey !== 'register' && routeKey !== 'wechatLogin') {
                // 尝试刷新 token
                refreshAccessToken()
                  .then((newToken) => {
                    doRequest(newToken);
                  })
                  .catch(() => {
                    removeJwtToken();
                    wx.showModal({
                      title: '登录失效',
                      content: '请重新登录',
                      showCancel: false,
                      success: () => {
                        wx.navigateTo({ url: '/pages/auth/index' });
                      },
                    });
                    apiError.code = 'AUTH_FAILURE';
                    reject(apiError);
                  });
                return;
              } else {
                removeJwtToken();
                wx.showModal({
                  title: '登录失效',
                  content: '请重新登录',
                  showCancel: false,
                  success: () => {
                    wx.navigateTo({ url: '/pages/auth/index' });
                  },
                });
                apiError.code = 'AUTH_FAILURE';
              }
            } else {
              wx.showToast({ title: errorMsg, icon: 'none', duration: 2000 });
            }

            reject(apiError);
          }
        },
        fail: (err) => {
          if (options.showLoading !== false) {
            wx.hideLoading();
          }
          console.error(`API request failed (network error) for "${routeKey}"`, err);
          wx.showToast({ title: '网络请求失败', icon: 'none', duration: 2000 });
          const networkError = new Error(`Network request failed: ${err.errMsg}`);
          networkError.code = 'NETWORK_ERROR';
          reject(networkError);
        },
      });
    }

    doRequest(getJwtToken());
  });
}

// --- 上传文件（保留扩展） ---
function uploadFile(routeKey, filePath, name, options = {}) {
  return new Promise((resolve, reject) => {
    const routeInfo = apiRoutes[routeKey];
    if (!routeInfo || !routeInfo.baseUrl) {
      console.error(`Upload API route "${routeKey}" not found or missing base URL.`);
      wx.showToast({ title: '上传配置错误', icon: 'none' });
      return reject(new Error(`Upload API route "${routeKey}" not found.`));
    }

    const baseUrl = BASE_URL_MAP[routeInfo.baseUrl];
    if (!baseUrl) {
      wx.showToast({ title: '基础URL配置错误', icon: 'none' });
      return reject(new Error(`Base URL not found.`));
    }
    const url = `${baseUrl}${routeInfo.path}`;

    let headers = options.headers || {};
    const requireAuth = options.requireAuth !== false;

    if (requireAuth) {
      const token = getJwtToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      } else {
        wx.showModal({
          title: '需要登录',
          content: '此功能需要登录后才能使用',
          showCancel: false,
          success: () => {
            wx.navigateTo({ url: '/pages/auth/index' });
          },
        });
        const authError = new Error('Authentication required but no token found.');
        authError.code = 'AUTH_REQUIRED';
        return reject(authError);
      }
    }

    if (options.showLoading !== false) {
      wx.showLoading({
        title: options.loadingText || '上传中...',
        mask: true,
      });
    }

    wx.uploadFile({
      url,
      filePath,
      name,
      header: headers,
      formData: options.formData || {},
      timeout: options.timeout || 60000,
      success: (res) => {
        if (options.showLoading !== false) {
          wx.hideLoading();
        }
        try {
          const data = JSON.parse(res.data);
          if (res.statusCode >= 200 && res.statusCode < 300 && data.ok !== false) {
            resolve(data);
          } else {
            const errorMsg = data.error?.message || data.message || `上传失败: ${res.statusCode}`;
            wx.showToast({ title: errorMsg, icon: 'none', duration: 2000 });
            const apiError = new Error(errorMsg);
            apiError.statusCode = res.statusCode;
            apiError.response = data;
            if (res.statusCode === 401 || res.statusCode === 403) {
              removeJwtToken();
              apiError.code = 'AUTH_FAILURE';
            }
            reject(apiError);
          }
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, rawData: res.data });
          } else {
            wx.showToast({ title: '上传响应处理失败', icon: 'none' });
            const parseError = new Error(`Failed to parse upload response: ${e.message}`);
            parseError.code = 'PARSE_ERROR';
            reject(parseError);
          }
        }
      },
      fail: (err) => {
        if (options.showLoading !== false) {
          wx.hideLoading();
        }
        wx.showToast({ title: '上传网络请求失败', icon: 'none' });
        const networkError = new Error(`Network upload failed: ${err.errMsg}`);
        networkError.code = 'NETWORK_UPLOAD_ERROR';
        reject(networkError);
      },
    });
  });
}

module.exports = {
  request,
  uploadFile,
  getJwtToken,
  setJwtToken,
  getRefreshToken,
  setRefreshToken,
  removeJwtToken,
  generateTraceUuid,
  apiRoutes,
};
