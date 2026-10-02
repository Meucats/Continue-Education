// 防漂移守卫：学生导入的表头映射在 server.js 与 adminApi/index.js 各有一份实现，
// 本脚本在 npm run check 中比对两份源码是否逐字一致，并跑一组行为自检；
// 任何一端改了别名表/匹配策略/取值方式而忘了同步，检查即失败。
const fs = require('fs');
const path = require('path');

const SERVER = path.join(__dirname, '..', 'server.js');
const CLOUD = path.join(__dirname, '..', '..', '..', 'wxminiprogram', 'cloudfunctions', 'adminApi', 'index.js');

const failures = [];

// 从 marker 起做花括号配对，提取 function 声明全文（目标源码字符串内不含花括号）
function extractFn(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) return null;
  const first = src.indexOf('{', start);
  if (first < 0) return null;
  let depth = 0;
  for (let i = first; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

// 提取 const asStr = ...; 单行
function extractLine(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) return null;
  const end = src.indexOf('\n', start);
  return end < 0 ? src.slice(start) : src.slice(start, end);
}

const norm = s => (s || '').replace(/\s+/g, ' ').trim();

function compare(name, a, b) {
  if (a === null || b === null) {
    failures.push(name + '：至少一端找不到（marker 丢失，是否改名了？）');
    return;
  }
  if (norm(a) !== norm(b)) {
    failures.push(name + '：两端实现不一致——server.js 与 adminApi/index.js 必须逐字相同');
  }
}

const serverSrc = fs.readFileSync(SERVER, 'utf8');
const cloudSrc = fs.readFileSync(CLOUD, 'utf8');

compare('detectFieldMapping', extractFn(serverSrc, 'function detectFieldMapping('), extractFn(cloudSrc, 'function detectFieldMapping('));
compare('getField', extractFn(serverSrc, 'function getField('), extractFn(cloudSrc, 'function getField('));
compare('asStr', extractLine(serverSrc, 'const asStr ='), extractLine(cloudSrc, 'const asStr ='));

// 行为自检（用 server 端实现执行；两端一致已由上面保证）
if (failures.length === 0) {
  try {
    const detect = new Function(extractFn(serverSrc, 'function detectFieldMapping(') + '; return detectFieldMapping;')();
    const getField = new Function(extractFn(serverSrc, 'function getField(') + '; return getField;')();
    const asStr = new Function(extractLine(serverSrc, 'const asStr =') + '; return asStr;')();
    const assert = (cond, msg) => { if (!cond) failures.push('自检失败：' + msg); };

    let fm = detect(['姓名', '联系电话', '上课截止时间', '上课地点']);
    assert(fm.name === '姓名' && fm.phone === '联系电话' && fm.deadline === '上课截止时间' && fm.location === '上课地点', '精确命中');
    assert(Object.keys(fm).length === 4, '精确命中不应多认领（得到 ' + JSON.stringify(fm) + '）');

    fm = detect(['学员姓名（备注）', '课程时间安排', '截止时间说明', '']);
    assert(fm.name === '学员姓名（备注）', '包含兑底认领姓名（得到 ' + JSON.stringify(fm.name) + '）');
    assert(fm.schedule === '课程时间安排', '最长别名优先 schedule（得到 ' + JSON.stringify(fm.schedule) + '）');
    assert(fm.className === undefined, '「课程时间安排」不应被 className 的短别名抢走（得到 ' + JSON.stringify(fm.className) + '）');
    assert(fm.deadline === '截止时间说明', '最长别名优先 deadline（得到 ' + JSON.stringify(fm.deadline) + '）');
    assert(fm.location === undefined, '空表头不应认领字段');

    const fm2 = detect(['姓名', '课程开始日期']);
    const row = { '姓名': ' 张三 ', '课程开始日期': 46308 };
    assert(getField(row, fm2, 'name') === '张三', '字符串去空白');
    assert(getField(row, fm2, 'courseStartDate') === 46308, 'Excel 序列号按数字保留');
    assert(asStr(getField(row, fm2, 'courseStartDate')) === '46308', 'asStr 统一转字符串');
    assert(getField({}, fm2, 'deadline') === '', '缺列返回空串');

    const fm3 = detect([' 姓名 ']);
    assert(fm3.name === ' 姓名 ', '映射保存原始表头（供 row 取值）');
    assert(getField({ ' 姓名 ': '李四' }, fm3, 'name') === '李四', '带空格表头可取值');
  } catch (e) {
    failures.push('自检执行异常：' + e.message);
  }
}

if (failures.length) {
  console.error('check-excel-aliases FAILED');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('check-excel-aliases OK（两端一致 + 4 组行为自检通过）');
