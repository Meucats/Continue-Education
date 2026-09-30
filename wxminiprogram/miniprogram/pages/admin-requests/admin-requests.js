const { callAdminApi } = require('../../utils/api.js');
const app = getApp();

function ensureAdmin() {
  if (!app.globalData.isAdmin) {
    wx.reLaunch({ url: '/pages/admin/admin' });
    return false;
  }
  return true;
}

Page({
  data: {
    requests: [],
    filteredRequests: [],
    currentTab: 'pending',
    pendingCount: 0
  },

  onLoad: function () {
    if (!ensureAdmin()) return;
    this.loadRequests();
  },

  onShow: function () {
    if (!ensureAdmin()) return;
    this.loadRequests();
  },

  loadRequests: function () {
    wx.showLoading({ title: '加载中...' });
    callAdminApi('getRequests').then(res => {
      wx.hideLoading();
      const now = new Date();
      const requests = (res.data || []).map(item => {
          const isExpired = item.status === 'approved' &&
            (!item.entryDate || now > new Date((item.entryDate + ' ' + (item.entryEndTime || '23:59')).replace(/-/g, '/')));
          return {
            ...item,
            createdAtText: this.formatDate(item.createdAt),
            isExpired: isExpired
          };
        });
        this.setData({ requests: requests });
        this.filterRequests();
        this.updatePendingCount();
      }).catch(err => {
        wx.hideLoading();
        wx.showToast({ title: '加载失败', icon: 'none' });
        console.error(err);
      });
  },

  formatDate: function (date) {
    if (!date) return '';
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const minute = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
  },

  switchTab: function (e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab });
    this.filterRequests();
  },

  filterRequests: function () {
    const { requests, currentTab } = this.data;
    let filtered;
    if (currentTab === 'all') {
      filtered = requests;
    } else if (currentTab === 'expired') {
      filtered = requests.filter(item => item.status === 'approved' && item.isExpired);
    } else {
      filtered = requests.filter(item => item.status === currentTab);
    }
    this.setData({ filteredRequests: filtered });
  },

  updatePendingCount: function () {
    const pendingCount = this.data.requests.filter(item => item.status === 'pending').length;
    this.setData({ pendingCount: pendingCount });
  },

  onApprove: function (e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认通过',
      content: '确定要通过此入校申请吗？',
      success: (res) => {
        if (res.confirm) {
          this.updateRequestStatus(id, 'approved');
        }
      }
    });
  },

  onReject: function (e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认拒绝',
      content: '确定要拒绝此入校申请吗？',
      editable: true,
      placeholderText: '请输入拒绝原因（选填）',
      success: (res) => {
        if (res.confirm) {
          const data = { status: 'rejected' };
          if (res.content) {
            data.rejectReason = res.content;
          }
          this.updateRequestStatus(id, 'rejected', data);
        }
      }
    });
  },

  updateRequestStatus: function (id, status, extraData = {}) {
    wx.showLoading({ title: '处理中...' });
    const action = status === 'approved' ? 'approveRequest' : 'rejectRequest';
    const extra = { id: id };
    if (extraData && extraData.rejectReason) extra.reason = extraData.rejectReason;
    callAdminApi(action, null, extra).then(() => {
      wx.hideLoading();
      wx.showToast({ title: '操作成功', icon: 'success' });
      this.loadRequests();
    }).catch(err => {
      wx.hideLoading();
      wx.showToast({ title: '操作失败', icon: 'none' });
      console.error(err);
    });
  }
});
