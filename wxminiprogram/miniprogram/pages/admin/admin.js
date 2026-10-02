const app = getApp();
const { callAdminApi } = require('../../utils/api.js');

Page({
  data: {
    isAdmin: false,
    adminPhone: '',
    adminPassword: '',
    adminInfo: null,
    stats: {
      studentCount: 0,
      requestCount: 0
    }
  },

  onLoad: function () {
    // 检查是否已登录为管理员
    if (app.globalData.isAdmin) {
      this.setData({
        isAdmin: true,
        adminInfo: app.globalData.adminInfo
      });
    }
  },

  onShow: function () {
    if (this.data.isAdmin) {
      this.loadStats();
    }
  },

  onAdminPhoneInput: function (e) {
    this.setData({ adminPhone: e.detail.value });
  },

  onAdminPasswordInput: function (e) {
    this.setData({ adminPassword: e.detail.value });
  },

  onAdminLogin: function () {
    const { adminPhone, adminPassword } = this.data;

    if (!adminPhone.trim()) {
      wx.showToast({ title: '请输入管理员账号', icon: 'none' });
      return;
    }

    if (!adminPassword.trim()) {
      wx.showToast({ title: '请输入密码', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '登录中...' });

    callAdminApi('loginAdmin', { phone: adminPhone.trim(), password: adminPassword.trim() }).then(res => {
      wx.hideLoading();
      if (res && res.success) {
        const admin = res.data;
        const safeAdmin = { _id: admin._id, phone: admin.phone, name: admin.name, role: admin.role || 'admin', classes: admin.classes || [], token: admin.token };
        app.globalData.isAdmin = true;
        app.globalData.adminInfo = safeAdmin;
        wx.setStorageSync('adminSession', safeAdmin);
        if (admin.mustChangePassword) {
          this.setData({ adminPassword: '' });
          wx.reLaunch({ url: '/pages/login/login' });
          return;
        }
        this.setData({
          isAdmin: true,
          adminInfo: safeAdmin,
          adminPassword: ''
        });
        this.loadStats();
        wx.showToast({ title: '登录成功', icon: 'success' });
      } else {
        wx.showToast({ title: (res && res.message) || '账号或密码错误', icon: 'none' });
      }
    }).catch(err => {
      wx.hideLoading();
      wx.showToast({ title: (err && err.message) || '登录失败', icon: 'none' });
      console.error(err);
    });
  },

  loadStats: function () {
    callAdminApi('getStats').then(res => {
      if (res && res.success) {
        this.setData({
          'stats.studentCount': res.data.studentCount || 0,
          'stats.requestCount': res.data.requestCount || 0
        });
      }
    }).catch(() => {});
  },

  goToStudents: function () {
    wx.navigateTo({ url: '/pages/admin-students/admin-students' });
  },

  goToAddStudent: function () {
    wx.navigateTo({ url: '/pages/admin-add/admin-add' });
  },

  goToImport: function () {
    wx.navigateTo({ url: '/pages/admin-import/admin-import' });
  },

  goToRequests: function () {
    wx.navigateTo({ url: '/pages/admin-requests/admin-requests' });
  },

  goToAccounts: function () {
    wx.navigateTo({ url: '/pages/admin-accounts/admin-accounts' });
  },

  onLogout: function () {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          callAdminApi('logout').catch(() => {});
          app.clearAdminSession();
          this.setData({ isAdmin: false, adminInfo: null, adminPassword: '' });
          wx.reLaunch({ url: '/pages/login/login' });
        }
      }
    });
  }
});
