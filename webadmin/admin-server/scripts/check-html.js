// HTML/CSS 静态检查（零依赖）：内联脚本语法、id 唯一性、样式花括号平衡、关键 id/函数、本地资源引用
// 用法：npm run check（相对本脚本定位文件，可在任意 cwd 下运行）
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const HTML_PATH = path.join(PUB, 'index.html');
const CSS_PATH = path.join(PUB, 'admin.css');
let ok = true;
const fail = msg => { ok = false; console.log('FAIL: ' + msg); };

const html = fs.readFileSync(HTML_PATH, 'utf8');

// 1) 内联脚本语法
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
scripts.forEach((m, i) => {
  try { new Function(m[1]); } catch (e) { fail(`inline script #${i} SYNTAX ERROR: ${e.message}`); }
});
console.log(`inline scripts: ${scripts.length}`);

// 2) id 唯一性
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
if (dup.length) fail('DUPLICATE IDS: ' + [...new Set(dup)].join(', '));

// 3) 关键 id 必须存在
const needIds = [
  'loginPhone', 'loginPassword', 'adminNameDisplay', 'adminAvatar', 'forcePwdModal',
  'dashboardErrorBar', 'statStudents', 'classListContainer', 'welcomeGreeting',
  'studentTableBody', 'profileName', 'profileNewPwd'
];
const missingIds = needIds.filter(id => !ids.includes(id));
if (missingIds.length) fail('MISSING IDS: ' + missingIds.join(', '));

// 4) 关键函数必须存在
const needFns = [
  'apiFetch', 'enterAdmin', 'switchPage', 'showToast',
  'loadDashboard', 'startDashboardLoad', 'fetchJsonWithRetry', 'retryDashboard',
  'loadStudents', 'loadProfile', 'saveProfilePassword', 'submitForcePasswordChange'
];
const missingFns = needFns.filter(fn => !new RegExp('function\\s+' + fn + '\\s*\\(').test(html));
if (missingFns.length) fail('MISSING FN: ' + missingFns.join(', '));

// 5) 花括号平衡（内联 <style> 与独立 admin.css；admin.css 有无取决于 #15 拆分进度）
function braceBalance(css, label) {
  const o = (css.match(/\{/g) || []).length, c = (css.match(/\}/g) || []).length;
  if (o !== c) fail(`${label} BRACE MISMATCH: { ${o} } ${c}`);
}
[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].forEach((m, i) => braceBalance(m[1], `style #${i}`));
const cssLinked = /href="admin\.css"/.test(html);
if (cssLinked && !fs.existsSync(CSS_PATH)) fail('index.html 引用了 admin.css 但文件不存在');
if (fs.existsSync(CSS_PATH)) {
  braceBalance(fs.readFileSync(CSS_PATH, 'utf8'), 'admin.css');
  if (!cssLinked) fail('admin.css 已存在但 index.html 未外链');
}

// 6) 本地资源引用存在
const refs = [
  ...[...html.matchAll(/<script\s+src="([^"]+)"/g)].map(m => m[1]),
  ...[...html.matchAll(/<link\s[^>]*href="([^"]+)"/g)].map(m => m[1]),
  ...[...html.matchAll(/<img\s[^>]*src="([^"]+)"/g)].map(m => m[1])
].filter(u => !/^(https?:)?\/\//.test(u) && !u.startsWith('data:'));
[...new Set(refs)].forEach(u => {
  const p = path.join(PUB, u.split('?')[0].split('#')[0]);
  if (!fs.existsSync(p)) fail('MISSING LOCAL REF: ' + u);
});

console.log(ok ? 'ALL OK' : 'FAILED');
process.exit(ok ? 0 : 1);
