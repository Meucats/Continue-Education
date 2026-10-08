// 防漂移守卫（R3 收敛后）：学生导入工具五函数（detectFieldMapping/getField/asStr/parseExcelDate/formatDateStr）
// 单源于 shared/import-tools.js（UMD，权威源）；adminApi 副本由 scripts/sync-shared.js 复制；
// server.js 与 adminApi/index.js 均 require、不再本地定义。本脚本四段：
//   ① 权威源内 5 个定义在位
//   ② 两端 require 在位、本地定义清零
//   ③ adminApi 副本与权威源逐字节一致
//   ④ 行为自检：表头映射/取值 4 组（原守卫语义）+ 硬要求边界组（闰年/月界/单位数月日/非法串）
const fs = require('fs');
const path = require('path');

const SHARED = path.join(__dirname, '..', 'shared', 'import-tools.js');
const SERVER = path.join(__dirname, '..', 'server.js');
const CLOUD = path.join(__dirname, '..', '..', 'wxminiprogram', 'cloudfunctions', 'adminApi', 'index.js');
const CLOUD_SHARED = path.join(__dirname, '..', '..', 'wxminiprogram', 'cloudfunctions', 'adminApi', 'shared', 'import-tools.js');

const failures = [];

// ① 权威源 5 定义在位
const sharedSrc = fs.readFileSync(SHARED, 'utf8');
const defs = [
  'function detectFieldMapping(',
  'function getField(',
  'const asStr =',
  'function parseExcelDate(',
  'function formatDateStr('
];
for (const d of defs) {
  if (!sharedSrc.includes(d)) failures.push('权威源缺定义：' + d);
}
if (!sharedSrc.includes('HgdImportTools')) failures.push('权威源缺浏览器 global 挂载（HgdImportTools）');

// ② 两端 require 在位、本地定义清零
const serverSrc = fs.readFileSync(SERVER, 'utf8');
const cloudSrc = fs.readFileSync(CLOUD, 'utf8');
for (const [name, src, req] of [
  ['server.js', serverSrc, "require('./shared/import-tools')"],
  ['adminApi/index.js', cloudSrc, "require('./shared/import-tools')"]
]) {
  if (!src.includes(req)) failures.push(name + ' 缺 require shared/import-tools');
  for (const d of defs) {
    if (src.includes(d)) failures.push(name + ' 仍有本地定义（应清零走单源）：' + d);
  }
}

// ③ 副本逐字节一致
const a = fs.readFileSync(SHARED);
const b = fs.readFileSync(CLOUD_SHARED);
if (!a.equals(b)) failures.push('adminApi/shared/import-tools.js 与权威源不一致——先跑 node scripts/sync-shared.js');

// ④ 行为自检（直接 require 权威源；两端一致性已由②③保证）
if (failures.length === 0) {
  try {
    const t = require(SHARED);
    const assert = (cond, msg) => { if (!cond) failures.push('自检失败：' + msg); };

    // —— 表头映射/取值（原守卫 4 组，语义不变）——
    let fm = t.detectFieldMapping(['姓名', '联系电话', '上课截止时间', '上课地点']);
    assert(fm.name === '姓名' && fm.phone === '联系电话' && fm.deadline === '上课截止时间' && fm.location === '上课地点', '精确命中');
    assert(Object.keys(fm).length === 4, '精确命中不应多认领（得到 ' + JSON.stringify(fm) + '）');

    fm = t.detectFieldMapping(['学员姓名（备注）', '课程时间安排', '截止时间说明', '']);
    assert(fm.name === '学员姓名（备注）', '包含兑底认领姓名（得到 ' + JSON.stringify(fm.name) + '）');
    assert(fm.schedule === '课程时间安排', '最长别名优先 schedule（得到 ' + JSON.stringify(fm.schedule) + '）');
    assert(fm.className === undefined, '「课程时间安排」不应被 className 的短别名抢走（得到 ' + JSON.stringify(fm.className) + '）');
    assert(fm.deadline === '截止时间说明', '最长别名优先 deadline（得到 ' + JSON.stringify(fm.deadline) + '）');
    assert(fm.location === undefined, '空表头不应认领字段');

    const fm2 = t.detectFieldMapping(['姓名', '课程开始日期']);
    const row = { '姓名': ' 张三 ', '课程开始日期': 46308 };
    assert(t.getField(row, fm2, 'name') === '张三', '字符串去空白');
    assert(t.getField(row, fm2, 'courseStartDate') === 46308, 'Excel 序列号按数字保留');
    assert(t.asStr(t.getField(row, fm2, 'courseStartDate')) === '46308', 'asStr 统一转字符串');
    assert(t.getField({}, fm2, 'deadline') === '', '缺列返回空串');

    const fm3 = t.detectFieldMapping([' 姓名 ']);
    assert(fm3.name === ' 姓名 ', '映射保存原始表头（供 row 取值）');
    assert(t.getField({ ' 姓名 ': '李四' }, fm3, 'name') === '李四', '带空格表头可取值');

    // —— parseExcelDate/formatDateStr 硬要求边界组（R3：闰年/月界/单位数月日/非法串）——
    const fmt = v => t.formatDateStr(t.parseExcelDate(v));
    // 闰年
    assert(fmt('2028-02-29') === '2028-02-29', '闰年有效日 2028-02-29（得 ' + fmt('2028-02-29') + '）');
    assert(fmt('2027-02-29') === '2027-03-01', '非闰年 02-29 溢出为 03-01（JS Date 语义，得 ' + fmt('2027-02-29') + '）');
    // 月界
    assert(fmt('2026-12-31') === '2026-12-31', '月界 2026-12-31');
    assert(fmt('2026-01-01') === '2026-01-01', '月界 2026-01-01');
    // 单位数月日
    assert(fmt('2026-1-1') === '2026-01-01', '单位数月日 2026-1-1');
    assert(fmt('2026/1/1') === '2026-01-01', '斜杠分隔单位数 2026/1/1');
    assert(fmt('2026-01-1') === '2026-01-01', '单位数日 2026-01-1');
    // 非法串 → null → 格式化空串（组装层回退原值由两端 import 逻辑承担）
    assert(t.parseExcelDate('abc') === null, '非法串 → null');
    assert(t.parseExcelDate('2026-10-01 09:00') === null, '带时间串 → null（正则只认纯日期，实证选边 #1）');
    assert(t.parseExcelDate('') === null, '空串 → null');
    assert(t.parseExcelDate(null) === null, 'null → null');
    assert(t.parseExcelDate(undefined) === null, 'undefined → null');
    assert(t.formatDateStr(null) === '', 'formatDateStr(null) → 空串');
    assert(t.formatDateStr(new Date('abc')) === '', 'formatDateStr(Invalid) → 空串');
    // Excel 序列号（number 路径，UTC 毫秒语义）
    assert(fmt(44927) === '2023-01-01', 'Excel 序列号 44927 → 2023-01-01（得 ' + fmt(44927) + '）');
  } catch (e) {
    failures.push('自检执行异常：' + e.message);
  }
}

if (failures.length) {
  console.error('check-excel-aliases FAILED');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('check-excel-aliases OK（shared 5 定义在位 + 两端 require/清零 + 副本逐字节 + 行为自检 表头4组+边界17断言）');
