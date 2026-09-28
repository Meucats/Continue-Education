const app = getApp();
const { callUserApi } = require('../../utils/api.js');

Page({
  data: {
    isLoggedIn: false,
    userInfo: null,
    isWarm: false,
    maskedIdCard: ''
  },

  onShow: function () {
    const userInfo = app.globalData.userInfo;
    const isLoggedIn = !!userInfo;
    this.setData({ isLoggedIn: isLoggedIn, userInfo: userInfo });
    if (isLoggedIn) {
      this.loadWarmStatus(userInfo.phone);
      this.loadIdCard(userInfo.phone);
    } else {
      this.setData({ isWarm: false, maskedIdCard: '' });
      wx.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: '#1558C7', animation: { duration: 300, timingFunc: 'easeIn' } });
    }
  },

  loadWarmStatus: function (phone) {
    callUserApi('getMyRequests', { limit: 1 }).then(res => {
      let isWarm = false;
      const list = (res && res.success && res.data) ? res.data : [];
      if (list.length > 0) {
        const req = list[0];
        let isExpired = false;
        if (req.status === 'approved' && req.entryEndTime) {
          isExpired = new Date() > new Date(req.entryEndTime);
        }
        isWarm = req.status === 'approved' && !isExpired;
      }
      this.setData({ isWarm: isWarm });
      wx.setNavigationBarColor({
        frontColor: '#ffffff',
        backgroundColor: isWarm ? '#C2410C' : '#1558C7',
        animation: { duration: 300, timingFunc: 'easeIn' }
      });
    }).catch(() => {});
  },

  loadIdCard: function (phone) {
    callUserApi('getStudentSelf').then(res => {
      if (res && res.success && res.data && res.data.idCard) {
        const masked = this.maskIdCard(res.data.idCard);
        this.setData({ maskedIdCard: masked });
      }
    }).catch(() => {});
  },

  maskIdCard: function (idCard) {
    if (!idCard || idCard.length < 9) return idCard || '';
    const front = idCard.substring(0, 3);
    const back = idCard.substring(idCard.length - 6);
    return front + '***' + back;
  },

  goToLogin: function () {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  goToSchedule: function () {
    wx.switchTab({ url: '/pages/schedule/schedule' });
  },

  goToConsult: function () {
    wx.navigateTo({ url: '/pages/consult/consult' });
  },

  callPhone: function () {
    wx.makePhoneCall({ phoneNumber: '56700015' });
  },

  onLogout: function () {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          callUserApi('logout').catch(() => {});
          app.clearUserSession();
          this.setData({ isLoggedIn: false, userInfo: null });
          wx.showToast({ title: '已退出', icon: 'success' });
        }
      }
    });
  }
});
