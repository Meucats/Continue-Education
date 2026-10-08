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
    if (isLoggedIn) {
      // loadCourses 返回班级 promise，loadTip 复用，避免同屏重复 getStudentSelf
      const selfP = this.loadCourses(userInfo.phone);
      this.loadRequestInfo(userInfo.phone);
      this.loadTip(userInfo, selfP);
    } else {
      this.setData({ courses: [], hasCourse: false, requestInfo: null, isRequestExpired: false, isWarm: false });
      util.setWarmNavColor(false);
      this.loadTip(userInfo);
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

    const mondayStr = util.formatDate(monday);
    const sundayStr = util.formatDate(sunday);

    return callUserApi('getStudentSelf').then(res => {
      const list = res && res.success && res.data ? [res.data] : [];
      const courseCards = [];
      let className = '';
      const todayStr = util.formatDate(new Date());
      list.forEach(item => {
        if (!className) className = item.className || '';
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
      return className;
    }).catch(err => {
      console.error('加载课程失败', err);
      if (!err || err.code !== 'UNAUTHORIZED') wx.showToast({ title: '课程加载失败，请重试', icon: 'none' });
      return '';
    });
  },

  loadRequestInfo: function (phone) {
    callUserApi('getMyRequests', { limit: 20 }).then(res => {
      const list = (res && res.success && res.data) ? res.data : [];
      const newest = list[0] || null;
      // 展示最新一条申请；暖色只看「是否有申请正处于有效时段内」
      const warmReq = list.some(r => util.isWithinEntryWindow(r));
      if (newest) {
        this.setData({ requestInfo: newest, isRequestExpired: !!newest.isExpired, isWarm: warmReq });
      } else {
        this.setData({ requestInfo: null, isRequestExpired: false, isWarm: false });
      }
      util.setWarmNavColor(warmReq);
    }).catch(err => {
      console.error('加载申请信息失败', err);
      if (!err || err.code !== 'UNAUTHORIZED') wx.showToast({ title: '申请信息加载失败，请重试', icon: 'none' });
    });
  },

  loadTip: function (userInfo, selfPromise) {
    const defaultTip = '欢迎来到杭州职业技术大学继续教育学院！请遵守校园管理规定，按时到校上课。如有疑问请联系：56700015。';
    if (!userInfo || !userInfo.phone) {
      this.setData({ tipContent: defaultTip, hasTip: true });
      return;
    }
    // 优先复用 loadCourses 已发起的 getStudentSelf，避免同屏二次调用
    const classNameP = selfPromise || callUserApi('getStudentSelf').then(res => (res && res.success && res.data && res.data.className) || '');
    classNameP.then(className => {
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
