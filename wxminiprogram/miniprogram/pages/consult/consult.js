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
      this.refreshList();
    }
  },

  onInput: function (e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },

  fetchMyRequests: function () {
    // 仅登录学员可查看；未登录时 consult 页不加载历史
    if (!app.globalData.userInfo) return Promise.resolve([]);
    return callUserApi('getMyRequests', { limit: 50 }).then(res => (res && res.success && res.data) ? res.data : []);
  },

  refreshList: function () {
    return this.fetchMyRequests().then(list => {
      const req = list.length > 0 ? list[0] : null;
      this.setData({
        existingRequest: req,
        isExpired: req ? !!req.isExpired : false,
        historyRequests: list.slice(0, 20)
      });
      return list;
    }).catch(err => { console.error('refreshList error:', err); });
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

    const hasPending = (this.data.historyRequests || []).some(r => r.status === 'pending');
    if (hasPending) {
      wx.showToast({ title: '您已有待审核的申请', icon: 'none' });
      this.setData({ submitting: false });
      return;
    }

    callAdminApi('addRequest', {
      name: name.trim(),
      phone: phone.trim(),
      carPlate: carPlate.trim(),
      entryDate: entryDate,
      entryStartTime: entryStartTime,
      entryEndTime: entryEndTime
    }).then(res => {
      if (res && res.success) {
        wx.showToast({ title: '申请已提交', icon: 'success' });
        this.refreshList();
      } else {
        wx.showToast({ title: (res && res.message) || '提交失败，请重试', icon: 'none' });
      }
      this.setData({ submitting: false });
    }).catch(err => {
      wx.showToast({ title: '提交失败，请重试', icon: 'none' });
      this.setData({ submitting: false });
      console.error(err);
    });
  },

  goBack: function () {
    wx.navigateBack();
  }
});
