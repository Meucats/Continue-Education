// 统一云函数调用：自动携带会话 token
const util = require('./util.js');
let authToastAt = 0; // 过期提示去重：同屏并发多个请求只弹一次
let authToastMsg = ''; // 按文案去重：不同错误文案不被时间窗吞掉（二轮审查）
function authToast(msg) {
  if (Date.now() - authToastAt > 3000 || msg !== authToastMsg) {
    authToastAt = Date.now();
    authToastMsg = msg;
    wx.showToast({ title: msg, icon: 'none' });
  }
}

function getToken(type) {
  try {
    const key = type === 'admin' ? 'adminSession' : 'userSession';
    const s = wx.getStorageSync(key);
    return (s && s.token) || '';
  } catch (e) { return ''; }
}

function callAdminApi(action, data, extra) {
  return wx.cloud.callFunction({
    name: 'adminApi',
    data: Object.assign({ action: action, token: getToken('admin') }, extra || {}, data ? { data: data } : {})
  }).then(res => {
    const result = res.result || {};
    if (result.code === 'UNAUTHORIZED' || result.code === 'FORCE_PASSWORD_CHANGE') {
      wx.removeStorageSync('adminSession');
      getApp().globalData.isAdmin = false;
      getApp().globalData.adminInfo = null;
      wx.reLaunch({ url: '/pages/admin/admin' });
      authToast(result.message || '登录已过期，请重新登录');
      return Promise.reject(result);
    }
    return result;
  });
}

function callUserApi(action, data, extra) {
  const hadSession = !!getToken('user'); // 未登录页面的静默失败不强制跳转
  return wx.cloud.callFunction({
    name: 'adminApi',
    data: Object.assign({ action: action, token: getToken('user') }, extra || {}, data ? { data: data } : {})
  }).then(res => {
    const result = res.result || {};
    if (result.code === 'UNAUTHORIZED') {
      wx.removeStorageSync('userSession');
      getApp().globalData.userInfo = null;
      if (hadSession) wx.reLaunch({ url: '/pages/login/login' });
      authToast(result.message || '登录已过期，请重新登录');
      return Promise.reject(result);
    }
    return result;
  });
}

function fetchRequestWarm() {
  // 暖色唯一判据 = 存在处于有效时段内的通过申请（时段外/未到日期/已过期都不暖）
  return callUserApi('getMyRequests', { limit: 20 }).then(res => {
    const list = (res && res.success && res.data) ? res.data : [];
    return list.some(r => util.isWithinEntryWindow(r));
  });
}

module.exports = { callAdminApi, callUserApi, getToken, fetchRequestWarm };
