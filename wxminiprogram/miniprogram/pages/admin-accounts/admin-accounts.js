const util = require('../../utils/util.js');
const { callAdminApi } = require('../../utils/api.js');

Page({
  data: {
    accounts: [],
    filteredAccounts: [],
    searchKey: ''
  },

  onShow: function () {
    if (!util.ensureAdmin()) return;
    this.loadAccounts();
  },

  loadAccounts: function () {
    wx.showLoading({ title: '加载中...' });
    callAdminApi('getAccounts').then(res => {
      wx.hideLoading();
      const accounts = (res.data || []).map(item => ({
        ...item,
        createdAtText: util.formatDate(item.createdAt)
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

    // 3列CSV快速复制（姓名,手机,角色）；10列正式Excel导出在Web端 /api/export/students（server.js 同名路由处有互链注释）
    // 生成导出文本（密码为哈希值，不再导出明文）
    const csvCell = v => {
      const s = v == null ? '' : String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    let text = '姓名,手机号,角色\n';
    accounts.forEach(item => {
      text += `${csvCell(item.name)},${csvCell(item.phone)},${csvCell(item.role === 'admin' ? '管理员' : '学员')}\n`;
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
