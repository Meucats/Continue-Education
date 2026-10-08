const util = require('../../utils/util.js');
const { callAdminApi } = require('../../utils/api.js');

Page({
  data: {
    filteredAccounts: [],
    searchKey: ''
  },
  accounts: [], // 全量源放实例字段，避免与列表双份 setData 序列化

  onShow: function () {
    if (!util.ensureAdmin()) return;
    this.loadAccounts();
  },

  applySearch: function (list) {
    const key = this.data.searchKey.trim().toLowerCase();
    if (!key) return list;
    // 字段统一转字符串再匹配：脏数据缺字段时过滤不能抛 TypeError 中断渲染（二轮审查）
    return list.filter(item => {
      const name = String(item.name || '').toLowerCase();
      const phone = String(item.phone || '');
      return name.includes(key) || phone.includes(key);
    });
  },

  loadAccounts: function () {
    wx.showLoading({ title: '加载中...' });
    callAdminApi('getAccounts').then(res => {
      wx.hideLoading();
      const accounts = (res.data || []).map(item => ({
        ...item,
        createdAtText: util.formatDate(item.createdAt)
      }));
      this.accounts = accounts;
      // 返回后重载也按当前搜索词过滤
      this.setData({ filteredAccounts: this.applySearch(accounts) });
      if (res.truncated) {
        wx.showToast({ title: '数据已截断：仅显示前 ' + accounts.length + ' 条' + (res.total ? '（共 ' + res.total + ' 条）' : ''), icon: 'none', duration: 2500 });
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
      this.setData({ filteredAccounts: this.accounts });
    }
  },

  onSearch: function () {
    this.setData({ filteredAccounts: this.applySearch(this.accounts) });
  },

  onExport: function () {
    // 导出与界面同口径：导出当前筛选结果，避免「界面 3 条、导出全量」的不一致（二轮审查）
    const accounts = this.applySearch(this.accounts);
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
