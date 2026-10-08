const app = getApp();
const { callAdminApi, callUserApi } = require('../../utils/api.js');

Page({
  data: {
    phone: '',
    password: '',
    submitting: false,
    showPasswordModal: false,
    changeOldPwd: '',
    changeNewPwd: '',
    changeConfirmPwd: '',
    pendingStudent: null,
    pendingAdmin: null,
    pwdStrength: '',
    pwdStrengthLabel: ''
  },

  onInput: function (e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },

  onLogin: function () {
    if (this.data.submitting) return; // 防双击重复提交（两路登录会各发一次云函数）
    const phone = this.data.phone.trim();
    const password = this.data.password.trim();
    if (!phone) {
      wx.showToast({ title: '请输入手机号码', icon: 'none' });
      return;
    }
    if (!password) {
      wx.showToast({ title: '请输入密码', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '登录中...' });

    // 先尝试管理员登录（密码校验在云函数完成）
    callAdminApi('loginAdmin', { phone: phone, password: password }).then(res => {
      wx.hideLoading();
      if (res && res.success) {
        const admin = res.data;
        const safeAdmin = { _id: admin._id, phone: admin.phone, name: admin.name, role: admin.role || 'admin', classes: admin.classes || [], token: admin.token };
        if (admin.mustChangePassword) {
          // 首次登录强制修改密码；此时不落登录态，杀掉 App 下次登录仍会被拦
          this.setData({ password: '', showPasswordModal: true, pendingAdmin: admin, pendingStudent: null, submitting: false });
          wx.showToast({ title: '请先修改初始密码', icon: 'none' });
          return;
        }
        app.globalData.isAdmin = true;
        app.globalData.adminInfo = safeAdmin;
        wx.setStorageSync('adminSession', safeAdmin);
        this.setData({ submitting: false }); // reLaunch 失败兜底：按钮不卡死（二轮审查）
        wx.reLaunch({ url: '/pages/admin/admin' });
        return;
      }
      // 不是管理员（或密码错误），尝试学员登录
      this.studentLogin(phone, password);
    }).catch(() => {
      // 云函数被限速/网络错误时也尝试学员登录
      this.studentLogin(phone, password);
    });
  },

  studentLogin: function (phone, password) {
    if (phone.length !== 11) {
      wx.hideLoading();
      this.setData({ submitting: false });
      wx.showToast({ title: '请输入正确的手机号码', icon: 'none' });
      return;
    }

    callUserApi('loginStudent', { phone: phone, password: password }).then(res => {
      wx.hideLoading();
      if (!res || !res.success) {
        this.setData({ submitting: false });
        const msg = (res && res.message) || '登录失败';
        if (msg.indexOf('未找到') >= 0 || msg.indexOf('不存在') >= 0) {
          wx.showModal({
            title: '提示',
            content: '未找到学员信息，请先咨询报名',
            showCancel: false,
            success: () => { wx.navigateTo({ url: '/pages/consult/consult' }); }
          });
        } else {
          wx.showToast({ title: msg, icon: 'none' });
        }
        return;
      }
      const student = res.data;

      // 检查课程是否已结束
      const courseEndDate = student.courseEndDate;
      if (courseEndDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endDate = new Date(courseEndDate.replace(/-/g, '/'));
        endDate.setHours(23, 59, 59, 999);
        if (today > endDate) {
          this.setData({ submitting: false });
          wx.showModal({
            title: '账号已失效',
            content: '您的课程已于 ' + courseEndDate + ' 结束，账号已无法登录。如需继续学习，请联系管理员。',
            showCancel: false
          });
          return;
        }
      }

      const safe = { _id: student._id, phone: student.phone, name: student.name, role: 'student', token: student.token };

      // 首次登录需要修改密码：不落登录态（改密不可跳过，杀掉 App 下次登录仍会被拦）
      if (student.mustChangePassword) {
        this.setData({ password: '', showPasswordModal: true, pendingStudent: student, pendingAdmin: null, submitting: false });
        return;
      }

      app.globalData.userInfo = safe;
      wx.setStorageSync('userSession', safe);
      this.setData({ submitting: false });
      this.createOrUpdateUser(phone, student.name);
    }).catch(err => {
      wx.hideLoading();
      this.setData({ submitting: false });
      if (err && err.message && err.code !== 'UNAUTHORIZED') {
        wx.showToast({ title: err.message, icon: 'none' });
      } else {
        wx.showToast({ title: '登录失败', icon: 'none' });
      }
      console.error(err);
    });
  },

  // 修改密码
  onNewPwdInput: function (e) {
    const val = e.detail.value;
    let strength = '';
    let label = '';
    if (val.length >= 6) {
      let score = 0;
      if (/[a-z]/.test(val)) score++;
      if (/[A-Z]/.test(val)) score++;
      if (/[0-9]/.test(val)) score++;
      if (/[^a-zA-Z0-9]/.test(val)) score++;
      if (val.length >= 10) score++;
      if (score <= 1) { strength = 'weak'; label = '弱'; }
      else if (score <= 2) { strength = 'medium'; label = '中'; }
      else { strength = 'strong'; label = '强'; }
    }
    this.setData({ changeNewPwd: val, pwdStrength: strength, pwdStrengthLabel: label });
  },

  onSubmitPassword: function () {
    if (this._pwdSubmitting) return; // 防双击重复提交（二轮审查）
    const { changeOldPwd, changeNewPwd, changeConfirmPwd, pendingStudent, pendingAdmin } = this.data;
    const isAdminChange = !!pendingAdmin;
    if (!changeOldPwd) {
      wx.showToast({ title: '请输入原密码', icon: 'none' });
      return;
    }
    const minLen = isAdminChange ? 8 : 6;
    if (!changeNewPwd || changeNewPwd.length < minLen) {
      wx.showToast({ title: '新密码至少' + minLen + '位', icon: 'none' });
      return;
    }
    if (changeNewPwd !== changeConfirmPwd) {
      wx.showToast({ title: '两次密码不一致', icon: 'none' });
      return;
    }

    this._pwdSubmitting = true;
    wx.showLoading({ title: '修改中...' });

    const finish = () => {
      wx.hideLoading();
      this._pwdSubmitting = false;
      if (isAdminChange) {
        // 改密后旧会话已全部吊销，清掉本地登录态要求重新登录
        app.clearAdminSession();
      }
      wx.showToast({ title: '密码修改成功，请重新登录', icon: 'none', duration: 2000 });
      this.setData({
        showPasswordModal: false,
        changeOldPwd: '',
        changeNewPwd: '',
        changeConfirmPwd: '',
        pwdStrength: '',
        pwdStrengthLabel: '',
        pendingStudent: null,
        pendingAdmin: null,
        password: ''
      });
    };

    const fail = (msg) => {
      wx.hideLoading();
      this._pwdSubmitting = false;
      wx.showToast({ title: msg || '修改失败', icon: 'none' });
    };

    if (isAdminChange) {
      // 管理员改密（登录前，凭 phone+原密码，云函数有限速）
      callAdminApi('changeAdminPassword', {
        phone: pendingAdmin.phone,
        oldPassword: changeOldPwd,
        newPassword: changeNewPwd
      }).then(res => {
        if (res && res.success) finish();
        else fail(res && res.message);
      }).catch(err => fail(err && err.message));
      return;
    }

    wx.cloud.callFunction({
      name: 'adminApi',
      data: {
        action: 'changePassword',
        data: {
          phone: pendingStudent.phone,
          oldPassword: changeOldPwd,
          newPassword: changeNewPwd
        }
      }
    }).then(res => {
      if (res.result && res.result.success) finish();
      else fail(res.result && res.result.message);
    }).catch(err => {
      console.error(err);
      fail('修改失败');
    });
  },

  onCancelPassword: function () {
    // 学员改密不可跳过（取消按钮已隐藏，改密前不建立登录态）；管理员「返回登录」= 放弃本次登录
    if (this.data.pendingAdmin) {
      app.clearAdminSession();
      this.setData({ showPasswordModal: false, pendingAdmin: null, changeOldPwd: '', changeNewPwd: '', changeConfirmPwd: '' });
      return;
    }
    // 兜底：即便被误调用，学员也不会带着未改的初始密码进入系统
    this.setData({
      showPasswordModal: false,
      changeOldPwd: '',
      changeNewPwd: '',
      changeConfirmPwd: '',
      pendingStudent: null
    });
    app.clearUserSession();
    this.setData({ password: '' });
  },

  createOrUpdateUser: function (phone, name) {
    callUserApi('upsertMyUser').then(res => {
      const user = (res && res.success && res.data) ? res.data : {};
      const token = wx.getStorageSync('userSession').token;
      app.globalData.userInfo = Object.assign({}, user, { phone: phone, name: name || user.name, token: token });
      wx.switchTab({ url: '/pages/index/index' });
    }).catch(err => {
      console.error(err);
      if (err && err.code === 'UNAUTHORIZED') {
        // 会话已失效：callUserApi 已清会话并回登录页，这里不能再 switchTab 抢跳（二轮审查）
        return;
      }
      // 用户表同步失败不阻断登录
      const token = wx.getStorageSync('userSession').token;
      app.globalData.userInfo = Object.assign({}, app.globalData.userInfo, { phone: phone, name: name, token: token });
      wx.switchTab({ url: '/pages/index/index' });
    });
  },

  goToAdmin: function () {
    wx.navigateTo({ url: '/pages/admin/admin' });
  }
});
