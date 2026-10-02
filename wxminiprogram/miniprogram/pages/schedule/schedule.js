const app = getApp();
const util = require('../../utils/util.js');
const { callUserApi, fetchRequestWarm } = require('../../utils/api.js');

Page({
  data: {
    isLoggedIn: false,
    isWarm: false,
    currentYear: 2026,
    currentMonth: 9,
    weekdays: ['日', '一', '二', '三', '四', '五', '六'],
    calendarDays: [],
    selectedDate: null,
    selectedDateStr: '',
    weekCourses: [],
    weekRange: '',
    allCourses: [],
    courseDatesSet: []
  },

  onLoad: function () {
    const today = new Date();
    this.setData({
      currentYear: today.getFullYear(),
      currentMonth: today.getMonth() + 1,
      selectedDate: util.formatDate(today)
    });
  },

  onShow: function () {
    const userInfo = app.globalData.userInfo;
    const isLoggedIn = !!userInfo;
    this.setData({ isLoggedIn: isLoggedIn });
    if (isLoggedIn) {
      this.loadCourses(userInfo.phone);
      this.loadWarmStatus(userInfo.phone);
    } else {
      this.setData({ allCourses: [], weekCourses: [], courseDatesSet: [], isWarm: false });
      util.setWarmNavColor(false);
      this.buildCalendar();
      this.updateWeekRange();
    }
  },

  loadWarmStatus: function (phone) {
    fetchRequestWarm().then(isWarm => {
      this.setData({ isWarm: isWarm });
      util.setWarmNavColor(isWarm);
    }).catch(() => {});
  },

  goToLogin: function () {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  loadCourses: function (phone) {
    callUserApi('getStudentSelf').then(res => {
      const list = res && res.success && res.data ? [res.data] : [];
      const courses = list.map(item => ({
        ...item,
        expired: util.isCourseExpired(item.deadline, item.courseEndDate)
      }));

      // 收集所有有课的日期
      const datesSet = new Set();
      courses.forEach(c => {
        // 优先用 courseDates
        if (c.courseDates && c.courseDates.length > 0) {
          c.courseDates.forEach(d => {
            const date = typeof d === 'string' ? d : d.date;
            if (date) datesSet.add(date);
          });
        } else {
          // 没有 courseDates 时，从 schedule 解析星期几（支持逗号分隔多时间段）
          const scheduleStr = c.schedule || '';
          const dayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0 };
          const parts = scheduleStr.split(/[,，]/).map(s => s.trim()).filter(Boolean);
          parts.forEach(part => {
            let matchedDay = -1;
            for (const [key, val] of Object.entries(dayMap)) {
              if (part.includes(key)) { matchedDay = val; break; }
            }
            if (matchedDay >= 0) {
              const today = new Date();
              const deadline = c.deadline ? new Date(c.deadline) : new Date(today.getTime() + 90 * 24 * 3600 * 1000);
              const d = new Date(today);
              while (d.getDay() !== matchedDay) d.setDate(d.getDate() + 1);
              while (d <= deadline) {
                datesSet.add(util.formatDate(d));
                d.setDate(d.getDate() + 7);
              }
            }
          });
          if (c.deadline) datesSet.add(c.deadline);
        }
      });

      this.setData({
        allCourses: courses,
        courseDatesSet: Array.from(datesSet)
      });
      this.buildCalendar();
      this.updateWeekRange();
      this.filterWeekCourses();
    }).catch(err => {
      console.error('加载课程失败', err);
    });
  },

  buildCalendar: function () {
    const { currentYear, currentMonth, courseDatesSet } = this.data;
    const today = new Date();
    const todayStr = util.formatDate(today);

    const firstDay = new Date(currentYear, currentMonth - 1, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const daysInPrevMonth = new Date(currentYear, currentMonth - 1, 0).getDate();

    const days = [];

    for (let i = firstDay - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i;
      days.push({ day, date: '', isCurrentMonth: false, isToday: false, isSelected: false, hasCourse: false });
    }

    for (let i = 1; i <= daysInMonth; i++) {
      const dateStr = currentYear + '-' + String(currentMonth).padStart(2, '0') + '-' + String(i).padStart(2, '0');
      days.push({
        day: i, date: dateStr, isCurrentMonth: true,
        isToday: dateStr === todayStr, isSelected: dateStr === this.data.selectedDate,
        hasCourse: courseDatesSet.indexOf(dateStr) !== -1
      });
    }

    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({ day: i, date: '', isCurrentMonth: false, isToday: false, isSelected: false, hasCourse: false });
    }

    this.setData({ calendarDays: days });
  },

  getWeekRange: function (dateStr) {
    const parts = dateStr.split('-');
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    const dayOfWeek = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const wd = new Date(monday);
      wd.setDate(monday.getDate() + i);
      weekDays.push(util.formatDate(wd));
    }

    return {
      start: util.formatDate(monday),
      end: util.formatDate(sunday),
      startLabel: (monday.getMonth() + 1) + '/' + monday.getDate(),
      endLabel: (sunday.getMonth() + 1) + '/' + sunday.getDate(),
      weekDays: weekDays
    };
  },

  updateWeekRange: function () {
    const { selectedDate } = this.data;
    if (!selectedDate) return;
    const range = this.getWeekRange(selectedDate);
    this.setData({ weekRange: range.startLabel + ' - ' + range.endLabel });
  },

  // 获取某个日期对应的星期几匹配课程
  getCoursesForDate: function (dateStr) {
    const { allCourses } = this.data;
    const result = [];
    const d = new Date(dateStr.replace(/-/g, '/'));
    const dayOfWeek = d.getDay();
    const dayNames = ['日', '一', '二', '三', '四', '五', '六'];

    allCourses.forEach(c => {
      // 优先用 courseDates 精确匹配
      if (c.courseDates && c.courseDates.length > 0) {
        c.courseDates.forEach(cd => {
          const cdDate = typeof cd === 'string' ? cd : cd.date;
          const cdTime = typeof cd === 'object' ? cd.timeSlot : '';
          if (cdDate === dateStr) {
            result.push({ ...c, timeSlot: cdTime || c.schedule, dateKey: dateStr, weekday: '周' + dayNames[dayOfWeek] });
          }
        });
        return;
      }

      // 没有 courseDates → 从 schedule 解析（支持逗号分隔多时间段）
      const scheduleStr = c.schedule || '';
      const parts = scheduleStr.split(/[,，]/).map(s => s.trim()).filter(Boolean);
      const matchedParts = parts.filter(p => p.includes(dayNames[dayOfWeek]));
      if (matchedParts.length > 0) {
        matchedParts.forEach(mp => {
          result.push({ ...c, timeSlot: mp, dateKey: dateStr, weekday: '周' + dayNames[dayOfWeek] });
        });
      }
    });

    return result;
  },

  filterWeekCourses: function () {
    const { selectedDate, allCourses } = this.data;
    if (!selectedDate) {
      this.setData({ weekCourses: [], selectedDateStr: '' });
      return;
    }

    const parts = selectedDate.split('-');
    const selectedDateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    // 计算本周周一到周日
    const dayOfWeek = selectedDateObj.getDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(selectedDateObj);
    monday.setDate(selectedDateObj.getDate() - mondayOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = util.formatDate(today);

    // 收集整周所有课程，按日期+时间去重
    const weekCourseList = [];
    const addedKeys = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = util.formatDate(d);
      const courses = this.getCoursesForDate(dateStr);
      courses.forEach(c => {
        const key = dateStr + '_' + (c.timeSlot || '') + '_' + c.className;
        if (!addedKeys[key]) {
          addedKeys[key] = true;
          const dp = dateStr.split('-');
          weekCourseList.push({
            ...c,
            dateKey: dateStr,
            dateMonth: parseInt(dp[1]) + '月',
            dateDay: parseInt(dp[2]) + '日',
            isEnded: dateStr < todayStr,
            isSelected: dateStr === selectedDate
          });
        }
      });
    }

    // 按日期+时间排序
    weekCourseList.sort((a, b) => {
      if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
      return (a.timeSlot || '').localeCompare(b.timeSlot || '');
    });

    const monthDay = parseInt(parts[1]) + '月' + parseInt(parts[2]) + '日 ' + weekdays[selectedDateObj.getDay()];

    this.setData({
      weekCourses: weekCourseList,
      selectedDateStr: monthDay,
      weekRange: (monday.getMonth() + 1) + '/' + monday.getDate() + ' - ' + (sunday.getMonth() + 1) + '/' + sunday.getDate()
    });
  },

  prevMonth: function () {
    let { currentYear, currentMonth } = this.data;
    currentMonth--;
    if (currentMonth < 1) { currentMonth = 12; currentYear--; }
    this.setData({ currentYear, currentMonth });
    this.buildCalendar();
  },

  nextMonth: function () {
    let { currentYear, currentMonth } = this.data;
    currentMonth++;
    if (currentMonth > 12) { currentMonth = 1; currentYear++; }
    this.setData({ currentYear, currentMonth });
    this.buildCalendar();
  },

  selectDay: function (e) {
    const day = e.currentTarget.dataset.day;
    if (!day.isCurrentMonth || !day.date) return;
    this.setData({ selectedDate: day.date });
    this.buildCalendar();
    this.updateWeekRange();
    if (this.data.isLoggedIn) this.filterWeekCourses();
  }
});
