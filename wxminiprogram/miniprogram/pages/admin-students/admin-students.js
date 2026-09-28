const util = require('../../utils/util.js');
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
    students: [],
    allStudents: [],
    searchKey: ''
  },

  onLoad: function () {
    if (!ensureAdmin()) return;
    this.loadStudents();
  },

  onShow: function () {
    if (!ensureAdmin()) return;
    this.loadStudents();
  },

  loadStudents: function () {
    wx.showLoading({ title: '加载中...' });
    callAdminApi('getStudents').then(res => {
      wx.hideLoading();
      const students = (res.data || []).map(item => ({
        ...item,
        expired: util.isCourseExpired(item.deadline, item.courseEndDate)
      }));
      this.setData({
        students: students,
        allStudents: students
      });
    }).catch(err => {
      wx.hideLoading();
      wx.showToast({ title: '加载失败', icon: 'none' });
      console.error(err);
    });
  },

  onSearchInput: function (e) {
    this.setData({ searchKey: e.detail.value });
    if (!e.detail.value) {
      this.setData({ students: this.data.allStudents });
    }
  },

  onSearch: function () {
    const key = this.data.searchKey.trim().toLowerCase();
    if (!key) {
      this.setData({ students: this.data.allStudents });
      return;
    }
    const filtered = this.data.allStudents.filter(item =>
      item.name.toLowerCase().includes(key) ||
      item.phone.includes(key) ||
      (item.className && item.className.toLowerCase().includes(key)) ||
      (item.idCard && item.idCard.includes(key)) ||
      (item.company && item.company.toLowerCase().includes(key))
    );
    this.setData({ students: filtered });
  },

  onEdit: function (e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/admin-add/admin-add?id=' + id });
  },

  onResetPwd: function (e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '重置密码',
      content: `确定要重置「${name}」的密码吗？\n重置后密码为身份证后6位。`,
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '重置中...' });
          callAdminApi('resetPassword', null, { id: id }).then(res => {
            wx.hideLoading();
            if (res && res.success) {
              wx.showModal({
                title: '重置成功',
                content: '新密码为：' + res.newPassword,
                showCancel: false
              });
            } else {
              wx.showToast({ title: (res && res.message) || '重置失败', icon: 'none' });
            }
          }).catch(err => {
            wx.hideLoading();
            wx.showToast({ title: '重置失败', icon: 'none' });
            console.error(err);
          });
        }
      }
    });
  },

  onDelete: function (e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认删除',
      content: `确定要删除学员"${name}"吗？此操作不可恢复。`,
      confirmColor: '#dc3545',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          callAdminApi('deleteStudent', null, { id: id }).then(() => {
            wx.hideLoading();
            wx.showToast({ title: '删除成功', icon: 'success' });
            this.loadStudents();
          }).catch(err => {
            wx.hideLoading();
            wx.showToast({ title: '删除失败', icon: 'none' });
            console.error(err);
          });
        }
      }
    });
  },

  goToAdd: function () {
    wx.navigateTo({ url: '/pages/admin-add/admin-add' });
  }
});
