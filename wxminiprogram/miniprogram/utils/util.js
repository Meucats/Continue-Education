const formatDate = date => {
  if (!date) return '';
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${year}-${formatNumber(month)}-${formatNumber(day)}`;
};

const formatDateTime = date => {
  if (!date) return '';
  const d = new Date(date);
  const hour = d.getHours();
  const minute = d.getMinutes();
  return `${formatDate(d)} ${formatNumber(hour)}:${formatNumber(minute)}`;
};

const formatNumber = n => {
  n = n.toString();
  return n[1] ? n : `0${n}`;
};

// 检查课程是否过期（优先用 courseEndDate，没有则用 deadline）
const isCourseExpired = (deadline, courseEndDate) => {
  const dateStr = courseEndDate || deadline;
  if (!dateStr) return true;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const endDate = new Date(dateStr);
  return now > endDate;
};

// 检查学员是否有有效课程
const hasActiveCourse = (students) => {
  if (!students || students.length === 0) return false;
  return students.some(s => !isCourseExpired(s.deadline, s.courseEndDate));
};

const isRequestExpired = req => !!(req && req.status === 'approved' &&
  (!req.entryDate || new Date() > new Date((req.entryDate + ' ' + (req.entryEndTime || '23:59')).replace(/-/g, '/'))));

const ensureAdmin = () => {
  const app = getApp();
  if (!app.globalData.isAdmin) {
    wx.reLaunch({ url: '/pages/admin/admin' });
    return false;
  }
  return true;
};

const setWarmNavColor = isWarm => {
  wx.setNavigationBarColor({
    frontColor: '#ffffff',
    backgroundColor: isWarm ? '#C2410C' : '#1558C7',
    animation: { duration: 300, timingFunc: 'easeIn' }
  });
};

module.exports = {
  formatDate,
  formatDateTime,
  isCourseExpired,
  hasActiveCourse,
  isRequestExpired,
  ensureAdmin,
  setWarmNavColor
};
