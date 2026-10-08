const util = require('../../utils/util.js');
const { callAdminApi } = require('../../utils/api.js');

Page({
  data: {
    students: [],
    searchKey: ''
  },
  allStudents: [], // 全量源放实例字段，避免与 students 双份 setData 序列化

  onShow: function () {
    if (!util.ensureAdmin()) return;
    this.loadStudents();
  },

  applySearch: function (list) {
    const key = this.data.searchKey.trim().toLowerCase();
    if (!key) return list;
    // 字段统一转字符串再匹配：脏数据缺字段时过滤不能抛 TypeError 中断渲染（二轮审查）
    return list.filter(item => {
      const name = String(item.name || '').toLowerCase();
      const phone = String(item.phone || '');
      const className = String(item.className || '').toLowerCase();
      const idCard = String(item.idCard || '');
      const company = String(item.company || '').toLowerCase();
      return name.includes(key) || phone.includes(key) ||
        className.includes(key) || idCard.includes(key) || company.includes(key);
    });
  },

  loadStudents: function () {
    wx.showLoading({ title: '加载中...' });
    callAdminApi('getStudents').then(res => {
      wx.hideLoading();
      const students = (res.data || []).map(item => ({
        ...item,
        expired: util.isCourseExpired(item.deadline, item.courseEndDate)
      }));
      this.allStudents = students;
      // 返回后重载也按当前搜索词过滤，避免「输入框有词但列表是全量」的失效错觉
      this.setData({ students: this.applySearch(students) });
      if (res.truncated) {
        wx.showToast({ title: '数据已截断：仅显示前 ' + students.length + ' 条' + (res.total ? '（共 ' + res.total + ' 条）' : ''), icon: 'none', duration: 2500 });
      }
    }).catch(err => {
      wx.hideLoading();
      if (!err || err.code !== 'UNAUTHORIZED') wx.showToast({ title: '加载失败', icon: 'none' });
      console.error(err);
    });
  },

  onSearchInput: function (e) {
    this.setData({ searchKey: e.detail.value });
    if (!e.detail.value) {
      this.setData({ students: this.allStudents });
    }
  },

  onSearch: function () {
    this.setData({ students: this.applySearch(this.allStudents) });
  },

  onEdit: function (e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/admin-add/admin-add?id=' + id });
  },

  onResetPwd: function (e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '重置密码',
        content: `确定要重置「${name}」的密码吗？\n重置后密码为身份证后6位（无身份证则为手机号后6位）。`,
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
            if (!err || err.code !== 'UNAUTHORIZED') wx.showToast({ title: '重置失败', icon: 'none' });
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
      content: `确定要删除学员"${name}"吗？其登录账户将同步删除，此操作不可恢复。`,
      confirmColor: '#dc3545',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          callAdminApi('deleteStudent', null, { id: id }).then(res => {
            wx.hideLoading();
            if (res && res.success) {
              wx.showToast({ title: res.message || '删除成功', icon: 'success' });
              // 延迟重载：loadStudents 的 showLoading 会顶掉刚弹的成功 toast（二轮审查）
              setTimeout(() => this.loadStudents(), 1500);
            } else {
              wx.showToast({ title: (res && res.message) || '删除失败', icon: 'none' });
            }
          }).catch(err => {
            wx.hideLoading();
            if (!err || err.code !== 'UNAUTHORIZED') wx.showToast({ title: '删除失败', icon: 'none' });
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
