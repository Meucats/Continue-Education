const app = getApp();
const util = require('../../utils/util.js');
const { callUserApi, fetchRequestWarm } = require('../../utils/api.js');

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
      util.setWarmNavColor(false);
    }
  },

  loadWarmStatus: function (phone) {
    fetchRequestWarm().then(isWarm => {
      this.setData({ isWarm: isWarm });
      util.setWarmNavColor(isWarm);
    }).catch(err => { console.error('loadWarmStatus error:', err); });
  },

  loadIdCard: function (phone) {
    callUserApi('getStudentSelf').then(res => {
      if (res && res.success && res.data && res.data.idCard) {
        const masked = this.maskIdCard(res.data.idCard);
        this.setData({ maskedIdCard: masked });
      }
    }).catch(err => { console.error('loadIdCard error:', err); });
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
