const app = getApp();
const { callUserApi, callAdminApi } = require('../../utils/api.js');

Page({
  data: {
    name: '',
    phone: '',
    carPlate: '',
    entryDate: '',
    entryStartTime: '',
    entryEndTime: '',
    submitting: false,
    existingRequest: null,
    isExpired: false,
    historyRequests: []
  },

  onLoad: function () {
    const userInfo = app.globalData.userInfo;
    if (userInfo) {
      this.setData({
        name: userInfo.name || '',
        phone: userInfo.phone || ''
      });
      this.checkExistingRequest(userInfo.phone);
      this.loadHistory(userInfo.phone);
    }
  },

  onNameInput: function (e) {
    this.setData({ name: e.detail.value });
  },

  onPhoneInput: function (e) {
    this.setData({ phone: e.detail.value });
  },

  onCarPlateInput: function (e) {
    this.setData({ carPlate: e.detail.value });
  },

  onDateChange: function (e) {
    this.setData({ entryDate: e.detail.value });
  },

  onStartTimeChange: function (e) {
    this.setData({ entryStartTime: e.detail.value });
  },

  onEndTimeChange: function (e) {
    this.setData({ entryEndTime: e.detail.value });
  },

  checkExistingRequest: function (phone) {
    const now = new Date();
    this.fetchMyRequests().then(list => {
      if (list.length > 0) {
        const req = list[0];
        const isExpired = req.status === 'approved' &&
          (!req.entryDate || now > new Date((req.entryDate + ' ' + (req.entryEndTime || '23:59')).replace(/-/g, '/')));
        this.setData({ existingRequest: req, isExpired: isExpired });
      } else {
        this.setData({ existingRequest: null, isExpired: false });
      }
    }).catch(() => {});
  },

  fetchMyRequests: function () {
    // 仅登录学员可查看；未登录时 consult 页不加载历史
    if (!app.globalData.userInfo) return Promise.resolve([]);
    return callUserApi('getMyRequests', { limit: 50 }).then(res => (res && res.success && res.data) ? res.data : []);
  },

  loadHistory: function (phone) {
    const now = new Date();
    this.fetchMyRequests().then(list => {
      const history = list.slice(0, 20).map(item => {
        const isExpired = item.status === 'approved' &&
          (!item.entryDate || now > new Date((item.entryDate + ' ' + (item.entryEndTime || '23:59')).replace(/-/g, '/')));
        return { ...item, isExpired };
      });
      this.setData({ historyRequests: history });
    }).catch(() => {});
  },

  onSubmit: function () {
    const { name, phone, carPlate, entryDate, entryStartTime, entryEndTime } = this.data;

    if (!name.trim()) {
      wx.showToast({ title: '请输入姓名', icon: 'none' });
      return;
    }

    if (!phone.trim()) {
      wx.showToast({ title: '请输入联系电话', icon: 'none' });
      return;
    }

    if (phone.length !== 11) {
      wx.showToast({ title: '请输入正确的手机号码', icon: 'none' });
      return;
    }

    if (!entryDate) {
      wx.showToast({ title: '请选择进校日期', icon: 'none' });
      return;
    }

    if (!entryStartTime) {
      wx.showToast({ title: '请选择开始时间', icon: 'none' });
      return;
    }

    if (!entryEndTime) {
      wx.showToast({ title: '请选择结束时间', icon: 'none' });
      return;
    }

    if (entryStartTime >= entryEndTime) {
      wx.showToast({ title: '结束时间必须晚于开始时间', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });

    this.fetchMyRequests().then(list => {
      const hasPending = list.some(r => r.status === 'pending');
      if (hasPending) {
        wx.showToast({ title: '您已有待审核的申请', icon: 'none' });
        this.setData({ submitting: false });
        return;
      }
      return callAdminApi('addRequest', {
        name: name.trim(),
        phone: phone.trim(),
        carPlate: carPlate.trim(),
        entryDate: entryDate,
        entryStartTime: entryStartTime,
        entryEndTime: entryEndTime
      }).then(res => {
        if (res && res.success) {
          wx.showToast({ title: '申请已提交', icon: 'success' });
          this.checkExistingRequest(phone);
          this.loadHistory(phone);
        } else {
          wx.showToast({ title: (res && res.message) || '提交失败，请重试', icon: 'none' });
        }
        this.setData({ submitting: false });
      }).catch(err => {
        wx.showToast({ title: '提交失败，请重试', icon: 'none' });
        this.setData({ submitting: false });
        console.error(err);
      });
    }).catch(() => { this.setData({ submitting: false }); });
  },

  goBack: function () {
    wx.navigateBack();
  }
});
