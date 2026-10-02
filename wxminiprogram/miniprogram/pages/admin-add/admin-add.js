const { callAdminApi } = require('../../utils/api.js');
const util = require('../../utils/util.js');
// R4 单源：排课日期生成（shared 副本由 admin-server scripts/sync-shared.js 复制，course-dates 内部依赖同目录 import-tools）
const courseDatesUtil = require('../../shared/course-dates.js');

Page({
  data: {
    isEdit: false,
    editId: '',
    formData: {
      name: '',
      phone: '',
      idCard: '',
      company: '',
      className: '',
      schedule: '',
      courseStartDate: '',
      courseEndDate: '',
      deadline: '',
      location: '',
      courseDates: []
    },
    generatedDates: [],
    submitting: false
  },

  onLoad: function (options) {
    if (!util.ensureAdmin()) return;
    if (options.id) {
      this.setData({ isEdit: true, editId: options.id });
      this.loadStudentData(options.id);
      wx.setNavigationBarTitle({ title: '编辑学员' });
    } else {
      wx.setNavigationBarTitle({ title: '添加学员' });
    }
  },

  loadStudentData: function (id) {
    wx.showLoading({ title: '加载中...' });
    callAdminApi('getStudent', null, { id: id }).then(res => {
      wx.hideLoading();
      const data = res.data;
      if (!data) { wx.showToast({ title: '学员不存在', icon: 'none' }); return; }
      if (!data.courseDates) data.courseDates = [];
      this.setData({ formData: data });
      this.previewDates();
    }).catch(err => {
      wx.hideLoading();
      wx.showToast({ title: '加载失败', icon: 'none' });
      console.error(err);
    });
  },

  onInput: function (e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`formData.${field}`]: e.detail.value });
    this.previewDates();
  },

  onCourseStartDateChange: function (e) {
    this.setData({ 'formData.courseStartDate': e.detail.value });
    this.previewDates();
  },

  onCourseEndDateChange: function (e) {
    this.setData({ 'formData.courseEndDate': e.detail.value });
    this.previewDates();
  },

  onDeadlineChange: function (e) {
    this.setData({ 'formData.deadline': e.detail.value });
  },

  // 预览自动生成的上课日期
  previewDates: function () {
    const { schedule, courseStartDate, courseEndDate } = this.data.formData;
    if (!schedule || !courseStartDate || !courseEndDate) {
      this.setData({ generatedDates: [] });
      return;
    }
    this.setData({ generatedDates: courseDatesUtil.generateCourseDatesMulti(schedule, courseStartDate, courseEndDate) });
  },

  onSubmit: function () {
    const { formData, isEdit, editId } = this.data;

    if (!formData.name.trim()) { wx.showToast({ title: '请输入姓名', icon: 'none' }); return; }
    if (!formData.phone.trim() || formData.phone.length !== 11) { wx.showToast({ title: '请输入正确的手机号码', icon: 'none' }); return; }
    if (!formData.className.trim()) { wx.showToast({ title: '请输入班级名称', icon: 'none' }); return; }
    if (!formData.schedule.trim()) { wx.showToast({ title: '请输入上课时间段', icon: 'none' }); return; }
    if (!formData.courseStartDate) { wx.showToast({ title: '请选择课程开始日期', icon: 'none' }); return; }
    if (!formData.courseEndDate) { wx.showToast({ title: '请选择课程结束日期', icon: 'none' }); return; }
    if (!formData.location.trim()) { wx.showToast({ title: '请输入上课地点', icon: 'none' }); return; }
    if (formData.courseStartDate && formData.courseEndDate && formData.courseStartDate > formData.courseEndDate) {
      wx.showToast({ title: '课程结束日期必须大于等于开始日期', icon: 'none' }); return;
    }
    const deadline = formData.deadline || formData.courseEndDate;
    if (deadline && formData.courseEndDate && deadline < formData.courseEndDate) {
      wx.showToast({ title: '截止时间必须大于等于课程结束日期', icon: 'none' }); return;
    }

    this.setData({ submitting: true });

    const courseDates = courseDatesUtil.generateCourseDatesMulti(formData.schedule, formData.courseStartDate, formData.courseEndDate);

    const data = {
      name: formData.name.trim(),
      phone: formData.phone.trim(),
      idCard: formData.idCard.trim(),
      company: formData.company.trim(),
      className: formData.className.trim(),
      schedule: formData.schedule.trim(),
      courseStartDate: formData.courseStartDate,
      courseEndDate: formData.courseEndDate,
      deadline: deadline,
      location: formData.location.trim(),
      courseDates: courseDates
    };

    if (isEdit) {
      data._id = editId;
      callAdminApi('updateStudent', data).then(() => {
        wx.showToast({ title: '保存成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 1500);
      }).catch(err => {
        wx.showToast({ title: '保存失败', icon: 'none' });
        console.error(err);
      }).finally(() => { this.setData({ submitting: false }); });
    } else {
      callAdminApi('addStudent', data).then(res => {
        if (res && res.initPassword) {
          wx.showModal({
            title: '添加成功',
            content: '初始密码：' + res.initPassword + '（学员首次登录需修改）',
            showCancel: false
          });
        } else {
          wx.showToast({ title: '添加成功', icon: 'success' });
        }
        this.setData({
          formData: { name: '', phone: '', idCard: '', company: '', className: '', schedule: '', courseStartDate: '', courseEndDate: '', deadline: '', location: '', courseDates: [] },
          generatedDates: []
        });
        setTimeout(() => wx.navigateBack(), 1500);
      }).catch(err => {
        wx.showToast({ title: '添加失败', icon: 'none' });
        console.error(err);
      }).finally(() => { this.setData({ submitting: false }); });
    }
  },

  onCancel: function () { wx.navigateBack(); }
});
