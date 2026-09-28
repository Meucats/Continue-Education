// 统一云函数调用：自动携带会话 token
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
      wx.showToast({ title: result.message || '登录已过期，请重新登录', icon: 'none' });
      return Promise.reject(result);
    }
    return result;
  });
}

function callUserApi(action, data, extra) {
  return wx.cloud.callFunction({
    name: 'adminApi',
    data: Object.assign({ action: action, token: getToken('user') }, extra || {}, data ? { data: data } : {})
  }).then(res => {
    const result = res.result || {};
    if (result.code === 'UNAUTHORIZED') {
      wx.removeStorageSync('userSession');
      getApp().globalData.userInfo = null;
      wx.showToast({ title: '登录已过期，请重新登录', icon: 'none' });
      return Promise.reject(result);
    }
    return result;
  });
}

module.exports = { callAdminApi, callUserApi, getToken };
