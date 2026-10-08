const { callAdminApi } = require('../../utils/api.js');
const util = require('../../utils/util.js');

Page({
  data: {
    fileName: '',
    filePath: '',
    importing: false,
    importResult: null,
    downloading: false
  },

  onLoad: function () {
    util.ensureAdmin();
  },

  onShow: function () {
    util.ensureAdmin();
  },

  downloadTemplate: function () {
    if (!util.ensureAdmin()) return;
    this.setData({ downloading: true });
    wx.showLoading({ title: '正在生成模板...' });

    wx.cloud.callFunction({
      name: 'getExcelTemplate'
    }).then(res => {
      if (res && res.result && res.result.success) {
        const fileID = res.result.fileID;
        wx.cloud.downloadFile({
          fileID: fileID,
          success: (downloadRes) => {
            wx.hideLoading();
            const filePath = downloadRes.tempFilePath;
            wx.openDocument({
              filePath: filePath,
              fileType: 'xlsx',
              showMenu: true,
              success: () => {
                wx.showToast({ title: '模板已打开', icon: 'success' });
                setTimeout(() => {
                  wx.showModal({
                    title: '保存模板',
                    content: '请在打开的文件中点击右上角「...」→「保存为副本」，然后在副本中填写学员信息。',
                    showCancel: false,
                    confirmText: '我知道了'
                  });
                }, 500);
              },
              fail: (err) => {
                console.error('打开文件失败', err);
                wx.showToast({ title: '打开失败，请重试', icon: 'none' });
              }
            });
            this.setData({ downloading: false });
          },
          fail: (err) => {
            wx.hideLoading();
            wx.showToast({ title: '下载失败', icon: 'none' });
            this.setData({ downloading: false });
          }
        });
      } else {
        wx.hideLoading();
        wx.showToast({ title: '生成失败', icon: 'none' });
        this.setData({ downloading: false });
      }
    }).catch(err => {
      wx.hideLoading();
      wx.showToast({ title: '生成模板失败', icon: 'none' });
      this.setData({ downloading: false });
    });
  },

  chooseFile: function () {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx', 'xls'],
      success: (res) => {
        const file = res.tempFiles[0];
        this.setData({
          fileName: file.name,
          filePath: file.path,
          importResult: null
        });
      }
    });
  },

  onImport: function () {
    if (!this.data.filePath) {
      wx.showToast({ title: '请先选择文件', icon: 'none' });
      return;
    }

    this.setData({ importing: true, importResult: null });
    wx.showLoading({ title: '正在导入...' });

    const cloudPath = 'imports/' + Date.now() + '-' + this.data.fileName;
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: this.data.filePath,
      success: (uploadRes) => {
        callAdminApi('importStudents', null, { fileID: uploadRes.fileID }).then(result => {
          wx.hideLoading();
          if (result && result.success) {
            this.setData({
              importResult: {
                total: result.total || 0,
                added: result.added || 0,
                updated: result.updated || 0,
                failed: result.failed || 0,
                errors: result.errors || []
              },
              importing: false
            });
            wx.showToast({ title: '新增' + (result.added || 0) + '条', icon: 'success' });
          } else {
            this.setData({
              importResult: {
                total: 0, added: 0, updated: 0, failed: 1,
                errors: [(result && result.message) || '导入失败，请检查云函数是否已部署']
              },
              importing: false
            });
            wx.showToast({ title: (result && result.message) || '导入失败', icon: 'none' });
          }
        }).catch(err => {
          wx.hideLoading();
          console.error('云函数调用失败', err);
          this.setData({
            importResult: {
              total: 0, added: 0, updated: 0, failed: 1,
              errors: ['云函数调用失败: ' + ((err && err.message) || '未知错误') + '。请确认已重新部署adminApi云函数。']
            },
            importing: false
          });
          wx.showToast({ title: '云函数调用失败', icon: 'none' });
        });
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('文件上传失败', err);
        this.setData({ importing: false });
        wx.showToast({ title: '文件上传失败', icon: 'none' });
      }
    });
  }
});
