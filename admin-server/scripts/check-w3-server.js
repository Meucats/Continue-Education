// W3-commit1 守卫：server.js 代理工厂与 xlsx 收编不回潮
// 校验：proxy 收编 22 路由（20 纯代理 + 2 precheck 变体）、残留 async 路由恰为 6 个非代理特例、
//      sendXlsx 收编 3 份组装、precheck 消息与 disposition 逐字不变、actorParams 收编 5 处
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('PASS  ' + name + (detail ? '  [' + detail + ']' : '')); }
    else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function count(re) { const m = src.match(re); return m ? m.length : 0; }

// ---- A. proxy 收编 ----
ok('A1 proxy 定义1', count(/^function proxy\(/m) === 1);
ok('A2 proxy 调用22（20纯+2precheck）', count(/\.\.\.proxy\(/g) === 22, 'n=' + count(/\.\.\.proxy\(/g));
ok('A3 残留 async 路由白名单6个在位+总数8（6特例+proxy handler+rejectSelf）',
    ["app.post('/api/admin/login'", "app.post('/api/admin/change-password'", "app.put('/api/admins/:id'",
        "app.post('/api/import'", "app.get('/api/export/students'", "app.post('/api/admins/import'"].every(s => src.includes(s)) &&
    count(/async \(req, res\) =>/g) === 8, // 6特例 + proxy handler + rejectSelf
    'asyncTotal=' + count(/async \(req, res\) =>/g));
ok('A4 precheck rejectSelf 定义1+调用2+消息逐字',
    count(/const rejectSelf = /g) === 1 && count(/rejectSelf\('/g) === 2 &&
    src.includes("rejectSelf('不能删除自己的账号')") &&
    src.includes("rejectSelf('不能重置自己的账号，请使用修改密码功能')"));
ok('A5 precheck 判断顺序不变（getAdmins→find→phone→消息）',
    /const target = \(list && list\.data \|\| \[\]\)\.find\(a => a\._id === req\.params\.id\);\s*\n\s*if \(target && target\.phone === req\.admin\.phone\) \{\s*\n\s*res\.json\(\{ success: false, message \}\);/.test(src));
ok('A6 actorParams 定义1+调用19（6读+7写路由+1学员导入+3提示+1管理员导入+1同步，二轮L1/L2/H1后）', count(/const actorParams = /g) === 1 && count(/actorParams\(req\)/g) === 19,
    'call=' + count(/actorParams\(req\)/g));
ok('A7 actorRole 字面仅剩 actorParams 定义1处', count(/actorRole: req\.admin\.role/g) === 1, 'n=' + count(/actorRole: req\.admin\.role/g));

// ---- B. sendXlsx 收编 ----
ok('B1 xlsx 组装收进 sendXlsx（aoa/book/write 各1）',
    count(/aoa_to_sheet\(/g) === 1 && count(/book_new\(/g) === 1 && count(/XLSX\.write\(/g) === 1);
ok('B2 setHeader xlsx 仅 sendXlsx 内1处', count(/setHeader\('Content-Type', XLSX_MIME\)/g) === 1);
ok('B3 disposition 三处逐字',
    src.includes('attachment; filename=students.xlsx') &&
    src.includes("attachment; filename*=UTF-8''%E5%AD%A6%E5%91%98%E4%BF%A1%E6%81%AF%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx") &&
    src.includes('attachment; filename=admins.xlsx'));
ok('B4 STUDENT_XLSX_COLS 定义1+使用2', count(/STUDENT_XLSX_COLS/g) === 3, 'n=' + count(/STUDENT_XLSX_COLS/g));

console.log('');
console.log(fail === 0 ? ('ALL PASS  ' + pass + '/' + (pass + fail)) : ('FAIL ' + fail + ' / PASS ' + pass));
process.exit(fail === 0 ? 0 : 1);
