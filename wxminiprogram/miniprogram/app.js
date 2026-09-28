App({
  onLaunch: function () {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: 'cloud1-d6gio7v8iff39bab7',
        traceUser: true,
      });
    }

    this.restoreSession();
  },

  globalData: {
    userInfo: null,
    isAdmin: false,
    adminInfo: null
  },

  // 恢复本地登录态
  restoreSession: function () {
    try {
      const adminSession = wx.getStorageSync('adminSession');
      if (adminSession && adminSession.phone) {
        this.globalData.isAdmin = true;
        this.globalData.adminInfo = adminSession;
      }
      const userSession = wx.getStorageSync('userSession');
      if (userSession && userSession.phone) {
        this.globalData.userInfo = userSession;
      }
    } catch (e) {
      console.error('恢复登录态失败', e);
    }
  },

  // 清除管理员登录态
  clearAdminSession: function () {
    this.globalData.isAdmin = false;
    this.globalData.adminInfo = null;
    try { wx.removeStorageSync('adminSession'); } catch (e) {}
  },

  // 清除学员登录态
  clearUserSession: function () {
    this.globalData.userInfo = null;
    try { wx.removeStorageSync('userSession'); } catch (e) {}
  }
});
