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
    accounts: [],
    filteredAccounts: [],
    searchKey: ''
  },

  onLoad: function () {
    if (!ensureAdmin()) return;
    this.loadAccounts();
  },

  onShow: function () {
    if (!ensureAdmin()) return;
    this.loadAccounts();
  },

  loadAccounts: function () {
    wx.showLoading({ title: '加载中...' });
    callAdminApi('getAccounts').then(res => {
      wx.hideLoading();
      const accounts = (res.data || []).map(item => ({
        ...item,
        createdAtText: this.formatDate(item.createdAt)
      }));
      this.setData({
        accounts: accounts,
        filteredAccounts: accounts
      });
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
    return `${year}-${month}-${day}`;
  },

  onSearchInput: function (e) {
    this.setData({ searchKey: e.detail.value });
    if (!e.detail.value) {
      this.setData({ filteredAccounts: this.data.accounts });
    }
  },

  onSearch: function () {
    const key = this.data.searchKey.trim().toLowerCase();
    if (!key) {
      this.setData({ filteredAccounts: this.data.accounts });
      return;
    }
    const filtered = this.data.accounts.filter(item =>
      item.name.toLowerCase().includes(key) ||
      item.phone.includes(key)
    );
    this.setData({ filteredAccounts: filtered });
  },

  onExport: function () {
    const { accounts } = this.data;
    if (accounts.length === 0) {
      wx.showToast({ title: '没有可导出的数据', icon: 'none' });
      return;
    }

    // 生成导出文本（密码为哈希值，不再导出明文）
    let text = '姓名,手机号,角色\n';
    accounts.forEach(item => {
      text += `${item.name},${item.phone},${item.role === 'admin' ? '管理员' : '学员'}\n`;
    });

    // 复制到剪贴板
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({ title: '账户信息已复制到剪贴板', icon: 'none', duration: 3000 });
      }
    });
  }
});
