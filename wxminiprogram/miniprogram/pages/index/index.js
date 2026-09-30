const app = getApp();
const util = require('../../utils/util.js');
const { callUserApi } = require('../../utils/api.js');

Page({
  data: {
    isLoggedIn: false,
    userInfo: null,
    courses: [],
    hasCourse: false,
    requestInfo: null,
    isRequestExpired: false,
    isWarm: false,
    tipContent: '',
    hasTip: false
  },

  onShow: function () {
    const userInfo = app.globalData.userInfo;
    const isLoggedIn = !!userInfo;
    this.setData({ isLoggedIn: isLoggedIn, userInfo: userInfo });
    this.loadTip(userInfo);
    if (isLoggedIn) {
      this.loadCourses(userInfo.phone);
      this.loadRequestInfo(userInfo.phone);
    } else {
      this.setData({ courses: [], hasCourse: false, requestInfo: null, isRequestExpired: false, isWarm: false });
      wx.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: '#1558C7', animation: { duration: 300, timingFunc: 'easeIn' } });
    }
  },

  loadCourses: function (phone) {
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    // 计算本周范围（周一到周日）
    const today = new Date();
    const dayOfWeek = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const formatDate = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const mondayStr = formatDate(monday);
    const sundayStr = formatDate(sunday);

    callUserApi('getStudentSelf').then(res => {
      const list = res && res.success && res.data ? [res.data] : [];
      const courseCards = [];
      const todayStr = formatDate(new Date());
      list.forEach(item => {
        const expired = util.isCourseExpired(item.deadline, item.courseEndDate);
        if (item.courseDates && item.courseDates.length > 0) {
          item.courseDates.forEach(cd => {
            const dateStr = typeof cd === 'string' ? cd : cd.date;
            // 只显示本周的课程
            if (dateStr >= mondayStr && dateStr <= sundayStr) {
              const timeSlot = typeof cd === 'object' ? cd.timeSlot : '';
              const d = new Date(dateStr.replace(/-/g, '/'));
              const dayOfWeekName = dayNames[d.getDay()];
              const timeMatch = (timeSlot || '').match(/(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})/);
              courseCards.push({
                _id: item._id + '_' + dateStr,
                className: item.className,
                location: item.location,
                schedule: item.schedule,
                date: dateStr,
                dayOfWeek: dayOfWeekName,
                timeSlot: timeSlot,
                timeStart: timeMatch ? timeMatch[1] : '',
                timeEnd: timeMatch ? timeMatch[2] : '',
                expired: expired,
                dayEnded: dateStr < todayStr,
                deadline: item.deadline
              });
            }
          });
        }
      });
      // 按日期排序
      courseCards.sort((a, b) => a.date.localeCompare(b.date));
      const hasCourse = courseCards.length > 0;
      this.setData({ courses: courseCards, hasCourse: hasCourse });
    }).catch(err => {
      console.error('加载课程失败', err);
    });
  },

  loadRequestInfo: function (phone) {
    callUserApi('getMyRequests', { limit: 1 }).then(res => {
      const list = (res && res.success && res.data) ? res.data : [];
      if (list.length > 0) {
        const req = list[0];
        // 已通过且已过 进校日期+结束时间（无进校日期的旧申请视为过期）
        const isExpired = req.status === 'approved' &&
          (!req.entryDate || new Date() > new Date((req.entryDate + ' ' + (req.entryEndTime || '23:59')).replace(/-/g, '/')));
        const isWarm = req.status === 'approved' && !isExpired;
        this.setData({ requestInfo: req, isRequestExpired: isExpired, isWarm: isWarm });
          wx.setNavigationBarColor({
            frontColor: '#ffffff',
            backgroundColor: isWarm ? '#C2410C' : '#1558C7',
            animation: { duration: 300, timingFunc: 'easeIn' }
          });
        } else {
          this.setData({ requestInfo: null, isRequestExpired: false, isWarm: false });
          wx.setNavigationBarColor({
            frontColor: '#ffffff',
            backgroundColor: '#1558C7',
            animation: { duration: 300, timingFunc: 'easeIn' }
          });
        }
      }).catch(err => {
        console.error('加载申请信息失败', err);
      });
  },

  loadTip: function (userInfo) {
    const defaultTip = '欢迎来到杭州职业技术大学继续教育学院！请遵守校园管理规定，按时到校上课。如有疑问请联系：56700015。';
    if (!userInfo || !userInfo.phone) {
      this.setData({ tipContent: defaultTip, hasTip: true });
      return;
    }
    callUserApi('getStudentSelf').then(res => {
      const className = res && res.success && res.data && res.data.className;
      if (!className) {
        this.setData({ tipContent: defaultTip, hasTip: true });
        return;
      }
      wx.cloud.callFunction({
        name: 'adminApi',
        data: { action: 'getTips', data: { className: className } }
      }).then(tipRes => {
        if (tipRes.result && tipRes.result.success && tipRes.result.data && tipRes.result.data.content) {
          this.setData({ tipContent: tipRes.result.data.content, hasTip: true });
        } else {
          this.setData({ tipContent: defaultTip, hasTip: true });
        }
      }).catch(() => {
        this.setData({ tipContent: defaultTip, hasTip: true });
      });
    }).catch(() => {
      this.setData({ tipContent: defaultTip, hasTip: true });
    });
  },

  goToLogin: function () {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  goToSchedule: function () {
    wx.switchTab({ url: '/pages/schedule/schedule' });
  },

  goToConsult: function () {
    wx.navigateTo({ url: '/pages/consult/consult' });
  },

  onCallPhone: function () {
    wx.makePhoneCall({ phoneNumber: '56700015' });
  }
});
