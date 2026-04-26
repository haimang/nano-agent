function getWechatCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (res.code) {
          resolve(res.code);
          return;
        }
        reject(new Error("获取微信登录凭证失败"));
      },
      fail: (err) => reject(new Error(err.errMsg || "微信登录接口调用失败")),
    });
  });
}

function getWechatProfile() {
  return new Promise((resolve) => {
    if (typeof wx.getUserProfile !== "function") {
      resolve({});
      return;
    }
    wx.getUserProfile({
      desc: "用于完善微信登录身份并自动填充昵称",
      success: (res) => {
        resolve({
          encrypted_data: res.encryptedData || undefined,
          iv: res.iv || undefined,
          display_name: res.userInfo?.nickName || undefined,
        });
      },
      fail: () => resolve({}),
    });
  });
}

async function collectWechatLoginPayload() {
  const [code, profile] = await Promise.all([getWechatCode(), getWechatProfile()]);
  return {
    code,
    ...profile,
  };
}

module.exports = {
  collectWechatLoginPayload,
};
