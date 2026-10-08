// 排课日期生成单源（R4 收敛，评审优化项）：单时间段 generateCourseDates + 逗号多段 generateCourseDatesMulti。
// 形态（硬要求① 双形态挂载）：
//   - Node：server.js / adminApi 云函数 require('./shared/course-dates')
//   - 浏览器：global HgdCourseDates（index.html 中本文件必须晚于 shared/import-tools.js 加载）
// 依赖注入（裁决 a 方案）：日期解析 parseExcelDate/formatDateStr 来自 import-tools（硬要求③ 加载失败即 throw，
// 不做降级内联 parse——降级=回到重复）。
// 实现语义（差异表选边记档）：
//   #1 日期解析统一取正则+replace 版（import-tools.parseExcelDate）
//   #2 多段 String(schedule || '') 包裹（消 undefined 裸 split 抛点）
//   #3 单段含 schedule 空检查（adminApi 版语义；调用路径内本不可达，纯防御增强）
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(require('./import-tools')); }
  else { root.HgdCourseDates = factory(root.HgdImportTools); }
})(typeof self !== 'undefined' ? self : this, function (importTools) {
  if (!importTools || typeof importTools.parseExcelDate !== 'function' || typeof importTools.formatDateStr !== 'function') {
    throw new Error('HgdCourseDates 依赖 HgdImportTools：必须先加载 shared/import-tools.js（Node: require ./import-tools；浏览器: import-tools 的 script 须先于 course-dates），不做降级内联 parse');
  }
  const parseExcelDate = importTools.parseExcelDate;
  const formatDateStr = importTools.formatDateStr;

// 根据上课时间段+开始结束日期，自动生成具体上课日期（单个时间段）
function generateCourseDates(schedule, startDate, endDate) {
  if (!schedule || !startDate || !endDate) return [];
  const dayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0 };
  let targetDay = -1;
  for (const [key, val] of Object.entries(dayMap)) {
    if (schedule.includes(key)) { targetDay = val; break; }
  }
  if (targetDay < 0) return [];
  const timeMatch = schedule.match(/(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})/);
  const timeSlot = timeMatch ? timeMatch[0] : schedule;
  const start = parseExcelDate(startDate);
  const end = parseExcelDate(endDate);
  if (!start || !end) return [];
  const dates = [];
  const d = new Date(start);
  while (d.getDay() !== targetDay && d <= end) d.setDate(d.getDate() + 1);
  while (d <= end) {
    dates.push({ date: formatDateStr(d), timeSlot });
    d.setDate(d.getDate() + 7);
  }
  return dates;
}

// 支持逗号分隔的多时间段
function generateCourseDatesMulti(schedule, startDate, endDate) {
  const allDates = [];
  const parts = String(schedule || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
  parts.forEach(part => {
    const dates = generateCourseDates(part, startDate, endDate);
    allDates.push(...dates);
  });
  allDates.sort((a, b) => a.date.localeCompare(b.date));
  return allDates;
}

return { generateCourseDates: generateCourseDates, generateCourseDatesMulti: generateCourseDatesMulti };
});
