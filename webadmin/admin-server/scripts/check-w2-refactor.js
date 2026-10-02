// W2 重构守卫：index.html 收敛后不回潮（makeFilter/loadTable/confirmThen/改密/导入工厂 + wrapper 真透传 + D5）
// 校验：旧实现清零、工厂定义与调用计数、HTML 内联引用↔function 定义对应、点名 wrapper 保留、单行透传、rowStore.students
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
    else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function count(re) { const m = html.match(re); return m ? m.length : 0; }

// ---- A. 旧实现清零 ----
ok('A1 allStudents.find 清零 (D5)', count(/allStudents\.find/g) === 0, 'n=' + count(/allStudents\.find/g));
ok('A2 handleFileSelected 全局清零', count(/\bhandleFileSelected\b/g) === 0, 'n=' + count(/\bhandleFileSelected\b/g));
ok('A3 handleAdminFileSelected 清零', count(/\bhandleAdminFileSelected\b/g) === 0, 'n=' + count(/\bhandleAdminFileSelected\b/g));
ok('A4 let selectedFile 清零', count(/let selectedFile = null/g) === 0 && count(/let adminSelectedFile = null/g) === 0);
ok('A5 R5 内联公式清零', count(/now > new Date\(\(r\.entryDate/g) === 0 && count(/entryEndTime \|\| '23:59'/g) === 0, 'n=' + count(/entryEndTime \|\| '23:59'/g));
ok('A6 旧 filter 字面量 countId 清零', count(/setFilterCount\('(stu|acc|adm)FilterCount'/g) === 0, 'n=' + count(/setFilterCount\('(stu|acc|adm)FilterCount'/g));
ok('A7 nameHit 定义仅工厂 1 处', count(/const nameHit = /g) === 1, 'n=' + count(/const nameHit = /g));
ok('A8 旧 zone 顶层绑定清零 (uploadZone/adminUploadZone 变量)', count(/const uploadZone = document/g) === 0 && count(/const adminUploadZone = document/g) === 0);
ok('A9 旧三段式 loadX 清零 (字面量列数 skeletonRows)', count(/skeletonRows\(\d/g) === 0, 'n=' + count(/skeletonRows\(\d/g));
ok('A10 旧 confirm+DELETE 内联清零', count(/if \(!confirm\(`确定要删除学员/g) === 0 && count(/if \(!confirm\(`确定要删除管理员/g) === 0 && count(/if \(!confirm\(`确定删除/g) === 0);

// ---- B. 工厂定义与调用计数 ----
ok('B1 makeFilter 定义1+调用3', count(/^function makeFilter\(/gm) === 1 && count(/= makeFilter\(/g) === 3, 'def=' + count(/^function makeFilter\(/gm) + ' call=' + count(/= makeFilter\(/g));
ok('B2 makeImportController 定义1+调用2', count(/^function makeImportController\(/gm) === 1 && count(/= makeImportController\(/g) === 2);
ok('B3 loadTable 定义1+调用5', count(/^function loadTable\(/gm) === 1 && count(/return loadTable\(/g) === 5, 'call=' + count(/return loadTable\(/g));
ok('B4 confirmThen 定义1+调用3', count(/^function confirmThen\(/gm) === 1 && count(/confirmThen\(\{/g) === 3);
ok('B5 changePasswordFlow 定义1+调用2', count(/^function changePasswordFlow\(/gm) === 1 && count(/changePasswordFlow\((forcePwdCfg|profilePwdCfg)\)/g) === 2);
ok('B6 saveSelfField 定义1+调用2', count(/^function saveSelfField\(/gm) === 1 && count(/saveSelfField\('(name|phone)'/g) === 2);

// ---- C. HTML 内联引用的函数名 vs function 定义 ----
const refNames = new Set();
const attrRe = /on(?:click|change|keydown|input|focus|blur|submit)\s*=\s*"([^"]*)"/g;
let m;
while ((m = attrRe.exec(html))) {
    const fnRe = /([A-Za-z_$][\w$]*)\s*\(/g;
    let f;
    while ((f = fnRe.exec(m[1]))) refNames.add(f[1]);
}
const kw = new Set(['if', 'for', 'while', 'switch', 'return', 'new', 'typeof', 'function', 'confirm', 'prompt',
    'querySelectorAll', 'setTimeout', 'preventDefault']);
const missing = [...refNames].filter(n => !kw.has(n) && !new RegExp('function\\s+' + n.replace(/\$/g, '\\$') + '\\s*\\(').test(html));
ok('C1 HTML 内联引用全部有 function 定义', missing.length === 0, 'refs=' + refNames.size + (missing.length ? ' missing=' + missing.join(',') : ''));

const must = ['showImportModal', 'closeImportModal', 'confirmImport', 'handleFileSelect', 'clearSelectedFile',
    'showAdminImportModal', 'closeAdminImportModal', 'confirmAdminImport', 'handleAdminFileSelect', 'clearAdminSelectedFile',
    'filterStudents', 'filterAccounts', 'filterAdmins',
    'resetStuFilter', 'resetStuFilterUI', 'resetAccFilter', 'resetAccFilterUI', 'resetAdmFilter', 'resetAdmFilterUI',
    'editStudent', 'resetPassword', 'deleteStudent', 'deleteAdmin', 'deleteTip',
    'loadStudents', 'loadRequests', 'loadAccounts', 'loadAdmins', 'loadTips',
    'saveProfileName', 'saveProfilePhone', 'saveProfilePassword', 'submitForcePasswordChange'];
const stillMissing = must.filter(n => !new RegExp('function\\s+' + n + '\\s*\\(').test(html));
ok('C2 点名 wrapper 33 个全部 function 声明', stillMissing.length === 0, 'missing=' + (stillMissing.join(',') || '无'));

// ---- D. wrapper 真透传（函数体单行且直调对象/工厂） ----
const wrappers = {
    filterStudents: 'studentsFilter.filter()',
    resetStuFilterUI: 'studentsFilter.resetUI()',
    resetStuFilter: 'studentsFilter.reset()',
    filterAccounts: 'accountsFilter.filter()',
    resetAccFilterUI: 'accountsFilter.resetUI()',
    resetAccFilter: 'accountsFilter.reset()',
    filterAdmins: 'adminsFilter.filter()',
    resetAdmFilterUI: 'adminsFilter.resetUI()',
    resetAdmFilter: 'adminsFilter.reset()',
    loadStudents: 'return loadTable(studentsTbl)',
    loadRequests: 'return loadTable(requestsTbl)',
    loadAccounts: 'return loadTable(accountsTbl)',
    loadAdmins: 'return loadTable(adminsTbl)',
    loadTips: 'return loadTable(tipsTbl)',
    showImportModal: 'studentImportCtrl.open()',
    closeImportModal: 'studentImportCtrl.close()',
    handleFileSelect: 'studentImportCtrl.handleSelect(e)',
    clearSelectedFile: 'studentImportCtrl.clear()',
    confirmImport: 'studentImportCtrl.confirmUpload()',
    showAdminImportModal: 'adminImportCtrl.open()',
    closeAdminImportModal: 'adminImportCtrl.close()',
    handleAdminFileSelect: 'adminImportCtrl.handleSelect(e)',
    clearAdminSelectedFile: 'adminImportCtrl.clear()',
    confirmAdminImport: 'adminImportCtrl.confirmUpload()',
    submitForcePasswordChange: 'changePasswordFlow(forcePwdCfg)',
    saveProfilePassword: 'changePasswordFlow(profilePwdCfg)'
};
const badWrap = Object.keys(wrappers).filter(n => {
    const re = new RegExp('function\\s+' + n + '\\s*\\([^)]*\\)\\s*\\{\\s*' + wrappers[n].replace(/[().]/g, '\\$&') + ';\\s*\\}', 'g');
    return !re.test(html);
});
ok('D1 26 个 wrapper 单行真透传', badWrap.length === 0, 'bad=' + (badWrap.join(',') || '无'));

// ---- E. D5 rowStore ----
ok('E1 rowStore.students 存整行', /rowStore\.students\[s\._id\] = s;/.test(html));
ok('E2 rowStore 三键声明', /const rowStore = \{ tips: \{\}, admins: \{\}, students: \{\} \};/.test(html));
ok('E3 renderStudents 重置 rowStore.students', /rowStore\.students = \{\};/.test(html));

console.log('');
console.log(fail === 0 ? ('ALL PASS  ' + pass + '/' + (pass + fail)) : ('FAIL ' + fail + ' / PASS ' + pass));
process.exit(fail === 0 ? 0 : 1);
