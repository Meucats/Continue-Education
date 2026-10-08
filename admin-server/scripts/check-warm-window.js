// 暖色窗口守卫：isWithinEntryWindow 是唯一判据，行为语义与引用不回潮
// 校验：函数在位+可执行行为断言、api.js/index.js 两处 warm 均引用它、不回退到旧的状态+过期日混合判据
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
    else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function day(offset) {
    const d = new Date(); d.setDate(d.getDate() + offset);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
const utilSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'wxminiprogram', 'miniprogram', 'utils', 'util.js'), 'utf8');
const apiSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'wxminiprogram', 'miniprogram', 'utils', 'api.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'wxminiprogram', 'miniprogram', 'pages', 'index', 'index.js'), 'utf8');

// ---- A. 定义与引用 ----
ok('A1 isWithinEntryWindow 定义1', (utilSrc.match(/const isWithinEntryWindow = /g) || []).length === 1);
ok('A2 util.js 导出', /isWithinEntryWindow\s*\n?\s*\}/.test(utilSrc) && /exports\s*=\s*\{[\s\S]*isWithinEntryWindow/.test(utilSrc));
ok('A3 api.js fetchRequestWarm 引用它', apiSrc.includes('util.isWithinEntryWindow(r)'));
ok('A4 index.js warmReq 引用它', /const warmReq = list\.some\(r => util\.isWithinEntryWindow\(r\)\)/.test(indexSrc));

// ---- B. 行为断言（可执行）----
const util = require(path.join(__dirname, '..', '..', 'wxminiprogram', 'miniprogram', 'utils', 'util.js'));
ok('B1 可 require 且为函数', typeof util.isWithinEntryWindow === 'function');
const f = util.isWithinEntryWindow;
ok('B2 approved 且今天全窗口 -> true', f({ status: 'approved', entryDate: day(0), entryStartTime: '00:00', entryEndTime: '23:59' }) === true);
ok('B3 未到进校日(明天) -> false', f({ status: 'approved', entryDate: day(1), entryStartTime: '00:00', entryEndTime: '23:59' }) === false);
ok('B4 已过进校日(昨天) -> false', f({ status: 'approved', entryDate: day(-1), entryStartTime: '00:00', entryEndTime: '23:59' }) === false);
ok('B5 缺进校日期 -> false', f({ status: 'approved', entryStartTime: '00:00', entryEndTime: '23:59' }) === false);
ok('B6 非 approved -> false', f({ status: 'pending', entryDate: day(0), entryStartTime: '00:00', entryEndTime: '23:59' }) === false);
ok('B7 缺开始时间按 00:00 -> true', f({ status: 'approved', entryDate: day(0), entryEndTime: '23:59' }) === true);
ok('B8 缺结束时间按 23:59 -> true', f({ status: 'approved', entryDate: day(0), entryStartTime: '00:00' }) === true);
ok('B9 空/非法输入 -> false', f(null) === false && f({}) === false && f({ status: 'approved', entryDate: '1999/13/45' }) === false);

// ---- C. 不回潮到旧判据 ----
// 旧暖色曾混用「status approved + deadline/过期字段」；现在 warm 行只允许经 isWithinEntryWindow
ok('C1 index.js warm 行不含 isRequestExpired', !/warmReq = .*isRequestExpired/.test(indexSrc));
ok('C2 api.js warm 行不含 isCourseExpired/deadline', !/fetchRequestWarm[\s\S]{0,400}isCourseExpired/.test(apiSrc) || !apiSrc.split('function fetchRequestWarm')[1].includes('isCourseExpired'));
ok('C3 setWarmNavColor 调用点仍存在', /setWarmNavColor\(/.test(indexSrc));

console.log('warm-window check: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
