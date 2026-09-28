const formatTime = date => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours();
  const minute = date.getMinutes();
  const second = date.getSeconds();

  return `${[year, month, day].map(formatNumber).join('/')} ${[hour, minute, second].map(formatNumber).join(':')}`;
};

const formatDate = date => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${year}-${formatNumber(month)}-${formatNumber(day)}`;
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

module.exports = {
  formatTime,
  formatDate,
  isCourseExpired,
  hasActiveCourse
};
