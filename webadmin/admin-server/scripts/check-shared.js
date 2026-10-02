// shared/ 单源总守卫（R3+R4）：
//   ① 权威源 UMD 双形态与依赖结构（import-tools 挂 global；course-dates 经注入依赖 import-tools、缺失即 throw 不降级、
//      自身不内联 parseExcelDate——防回到重复）
//   ② 全部消费端副本与权威源逐字节一致（sync-shared.js 复制后比对）
//   ③ gen 行为自检（硬要求：闰年/月界/单位数月日/非法串 + 多段合并排序/timeSlot 回退/选边#1 带时间拒绝/Excel 序列号）
// 用法：npm run check（在 scripts/ 下相对定位，任意 cwd 可跑）
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHARED_DIR = path.join(ROOT, 'shared');
const SRC_TOOLS = path.join(SHARED_DIR, 'import-tools.js');
const SRC_DATES = path.join(SHARED_DIR, 'course-dates.js');
// 消费端副本目录（与 scripts/sync-shared.js TARGETS 一致）
const COPY_DIRS = [
  path.join(ROOT, '..', '..', 'wxminiprogram', 'cloudfunctions', 'adminApi', 'shared'),
  path.join(ROOT, 'public', 'shared'),
  path.join(ROOT, '..', '..', 'wxminiprogram', 'miniprogram', 'shared')
];

const failures = [];
const assert = (cond, msg) => { if (!cond) failures.push(msg); };

// ① 源结构
const toolsSrc = fs.readFileSync(SRC_TOOLS, 'utf8');
const datesSrc = fs.readFileSync(SRC_DATES, 'utf8');
assert(toolsSrc.includes('module.exports = factory()'), 'import-tools 缺 Node 导出分支');
assert(toolsSrc.includes('root.HgdImportTools = factory()'), 'import-tools 缺浏览器 global 挂载 HgdImportTools');
assert(datesSrc.includes("factory(require('./import-tools'))"), 'course-dates 缺 Node 依赖注入 require(./import-tools)');
assert(datesSrc.includes('root.HgdCourseDates = factory(root.HgdImportTools)'), 'course-dates 缺浏览器 global 挂载 HgdCourseDates（依赖 HgdImportTools）');
assert(datesSrc.includes('throw new Error'), 'course-dates 缺依赖缺失即 throw（硬要求③ 不做降级）');
assert(!/function\s+parseExcelDate\s*\(/.test(datesSrc), 'course-dates 内联了 parseExcelDate（违背单源，降级=回到重复）');
assert(!/function\s+formatDateStr\s*\(/.test(datesSrc), 'course-dates 内联了 formatDateStr（违背单源）');

// ② 副本逐字节
const bufTools = fs.readFileSync(SRC_TOOLS);
const bufDates = fs.readFileSync(SRC_DATES);
let copies = 0;
for (const dir of COPY_DIRS) {
  for (const [name, buf] of [['import-tools.js', bufTools], ['course-dates.js', bufDates]]) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) { failures.push('副本缺失：' + p + '——先跑 node scripts/sync-shared.js'); continue; }
    if (!buf.equals(fs.readFileSync(p))) failures.push('副本与权威源不一致：' + p + '——先跑 node scripts/sync-shared.js');
    copies++;
  }
}

// ③ 行为自检（require 权威源，course-dates 内部 require 同目录 import-tools）
try {
  const cd = require(SRC_DATES);
  const fmt = arr => arr.map(d => d.date + ' ' + d.timeSlot);
  const eq = (name, got, want) => assert(JSON.stringify(got) === JSON.stringify(want),
    name + '：期望 ' + JSON.stringify(want) + ' 实得 ' + JSON.stringify(got));

  // 纯日期/多段/月界/单位数/闰年——取自 11 组实证输出（parse-diff-check 同值）
  const a = cd.generateCourseDatesMulti('周一 9:00-11:00', '2026-10-01', '2026-10-31');
  assert(a.length === 4 && a[0].date === '2026-10-05' && a[0].timeSlot === '9:00-11:00', '纯日期周一区间 4 节自 10-05（实得 ' + a.length + ' 节）');
  const b = cd.generateCourseDatesMulti('周三 9:00-11:00', '2026-1-1', '2026-2-28');
  assert(b.length === 8 && b[0].date === '2026-01-07', '单位数月日 8 节首 01-07（实得 ' + b.length + ' 首 ' + (b[0] && b[0].date) + '）');
  const c = cd.generateCourseDatesMulti('周二 9:00-11:00', '2028-2-1', '2028-3-1');
  assert(c.length === 5 && c.some(x => x.date === '2028-02-29'), '闰年 2028-02-29 在列（实得含 ' + (c.map(x => x.date).join(',') || '无') + '）');
  const d = cd.generateCourseDatesMulti('周四 9:00-11:00', '2026-12-1', '2027-1-31');
  assert(d.length === 9 && d[0].date === '2026-12-03', '跨年月界 9 节首 12-03（实得 ' + d.length + '）');

  // 选边#1：带时间串/非法串 → []（正则+replace 版语义）
  assert(cd.generateCourseDatesMulti('周一 9:00-11:00', '2026-10-01 09:00', '2026-10-31').length === 0, '带时间串应拒绝为[]（选边#1）');
  assert(cd.generateCourseDatesMulti('周一 9:00-11:00', 'abc', '2026-10-31').length === 0, '非法串 start → []');
  assert(cd.generateCourseDatesMulti('周一 9:00-11:00', '2026-10-31', '2026-10-01').length === 0, 'start>end → []');
  assert(cd.generateCourseDatesMulti('9:00-11:00', '2026-10-01', '2026-10-31').length === 0, '无星期词 → []');

  // Excel 序列号（number 路径，实证 A 策略同值）
  const e = cd.generateCourseDatesMulti('周一 9:00-11:00', 45931, 45961);
  assert(e.length === 4 && e[0].date === '2025-10-06', '序列号 45931→2025-10-06 起 4 节（实得 ' + e.length + ' 首 ' + (e[0] && e[0].date) + '）');

  // 多段合并排序（交错）
  const f = cd.generateCourseDatesMulti('周一 9:00-11:00, 周三 14:00-16:00', '2026-10-01', '2026-10-31');
  eq('多段交错排序', fmt(f).slice(0, 2), ['2026-10-05 9:00-11:00', '2026-10-07 14:00-16:00']);
  assert(f.length === 8, '多段共 8 节（实得 ' + f.length + '）');

  // 选边#2/#3 防御：空/undefined 不抛
  assert(cd.generateCourseDatesMulti('', '2026-10-01', '2026-10-31').length === 0, '空 schedule multi → [] 不抛（选边#2）');
  assert(cd.generateCourseDatesMulti(undefined, '2026-10-01', '2026-10-31').length === 0, 'undefined schedule multi → [] 不抛（选边#2）');
  assert(cd.generateCourseDates('', '2026-10-01', '2026-10-31').length === 0, '空 schedule 单段 → []（选边#3）');

  // timeSlot 无时间匹配时回退原文
  const g = cd.generateCourseDates('周一', '2026-10-01', '2026-10-07');
  assert(g.length === 1 && g[0].timeSlot === '周一', 'timeSlot 回退 schedule 原文（实得 ' + JSON.stringify(g[0]) + '）');

  // 依赖缺失即 throw（硬要求③：不降级回内置 parse）
  const wrapped = datesSrc.replace("factory(require('./import-tools'))", 'factory({})');
  let threw = false;
  try { new Function('module', 'require', wrapped)({ exports: {} }, () => ({})); }
  catch (err) { threw = /HgdImportTools/.test(err.message); }
  assert(threw, '依赖缺失必须 throw 且信息含 HgdImportTools');
} catch (e) {
  failures.push('行为自检执行异常：' + e.message);
}

if (failures.length) {
  console.error('check-shared FAILED');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('check-shared OK（源UMD×2 + 副本逐字节×' + copies + ' + 依赖注入/无降级 + gen行为自检13组）');
