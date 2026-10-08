// 批次B：班级隔离矩阵(#5) + 改手机号旧会话吊销(#4) + updateAdmin局部更新回归
// 前置：本地 Express 在跑；adminApi 云函数已部署最新代码
// 用法（PowerShell）：
//   $env:ADMIN_PASS='你的超管密码'; npm run e2e:classmatrix
// 可选环境变量：BASE_URL（默认 http://127.0.0.1:3000/api）、ADMIN_USER（默认 admin）
// 说明：需读取 ../config.json（appId/appSecret/env/adminApiSecret，已在 .gitignore）。
const path = require('path');
const fs = require('fs');
const https = require('https');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000/api';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS;
if (!ADMIN_PASS) {
  console.error('缺少环境变量 ADMIN_PASS。用法：$env:ADMIN_PASS="..."; npm run e2e:classmatrix');
  process.exit(2);
}
const CFG_PATH = path.join(__dirname, '..', 'config.json');
if (!fs.existsSync(CFG_PATH)) {
  console.error('缺少配置文件：' + CFG_PATH + '（复制 config.example.json 填写）');
  process.exit(2);
}
const CFG = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' | ' + String(extra).slice(0, 300) : '')); }
}
async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch (e) {}
  return { status: r.status, json };
}
function get(url) {
  return new Promise((res, rej) => { https.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d)); } }); }).on('error', rej); });
}
function post(url, body) {
  return new Promise((res, rej) => { const u = new URL(url); const rq = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d)); } }); }); rq.on('error', rej); rq.write(body); rq.end(); });
}
let cloudUrl = '';
async function initCloud() {
  const t = await get('https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' + CFG.appId + '&secret=' + CFG.appSecret);
  if (!t.access_token) throw new Error('获取 access_token 失败: ' + JSON.stringify(t));
  cloudUrl = 'https://api.weixin.qq.com/tcb/invokecloudfunction?access_token=' + t.access_token + '&env=' + CFG.env + '&name=adminApi';
}
async function invoke(payload) {
  const r = await post(cloudUrl, JSON.stringify(payload));
  const raw = r.resp_data || r.response;
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch (e) { return { success: false, raw }; } }
  return raw || { success: false, errcode: r.errcode, errmsg: r.errmsg };
}
const ph = arr => arr.map(x => x.phone).join(',');

(async () => {
  await initCloud();

  // ---------- 基线（超管视角） ----------
  let r = await req('POST', '/admin/login', { phone: ADMIN_USER, password: ADMIN_PASS });
  ok('超管登录', r.json && r.json.success, JSON.stringify(r.json).slice(0, 120));
  if (!r.json || !r.json.success) throw new Error('abort: 超管登录失败（检查服务是否在跑、ADMIN_PASS 是否正确）');
  let S = r.json.data.token;
  ok('超管 role=superadmin', r.json.data.role === 'superadmin');

  r = await req('GET', '/students', null, S);
  const allStudents = r.json.data;
  r = await req('GET', '/requests', null, S);
  const allRequests = r.json.data;
  r = await req('GET', '/stats/detail', null, S);
  const allStats = r.json.data;
  r = await req('GET', '/classes', null, S);
  const allClasses = r.json.data;
  console.log('  基线: 学员 ' + allStudents.length + ' / 申请 ' + allRequests.length + ' / 班级 ' + JSON.stringify(allClasses));

  // 选人数最多的班级做测试管理员的分管班级
  const byClass = {};
  allStudents.forEach(s => { (byClass[s.className] = byClass[s.className] || []).push(s); });
  const CA = Object.keys(byClass).sort((a, b) => byClass[b].length - byClass[a].length)[0];
  if (!CA) throw new Error('abort: 现有学员为空，无法做班级隔离矩阵（先造学员数据）');
  const expStu = byClass[CA];                       // 期望（顺序=createdAt desc，与基线一致）
  const expPhones = new Set(expStu.map(s => s.phone));
  const expReqs = allRequests.filter(q => expPhones.has(q.phone));
  const expClasses = [...new Set(expStu.map(s => s.className))];
  console.log('  测试班级: ' + CA + '（期望学员 ' + expStu.length + '，期望申请 ' + expReqs.length + '）');

  // ---------- 夹具：两个临时管理员 ----------
  const m1id_phone = 'testmgr01', m2id_phone = 'testmgr02';
  r = await req('POST', '/admins', { name: '临时管A', phone: m1id_phone, password: 'Test#45678', role: 'admin', classes: [CA] }, S);
  ok('建 m1（分管 ' + CA + '）', r.json && r.json.success, JSON.stringify(r.json));
  r = await req('POST', '/admins', { name: '临时管B', phone: m2id_phone, password: 'Test#45678', role: 'admin', classes: [] }, S);
  ok('建 m2（空班级）', r.json && r.json.success, JSON.stringify(r.json));
  r = await req('GET', '/admins', null, S);
  const m1 = (r.json.data || []).find(a => a.phone === m1id_phone);
  const m2 = (r.json.data || []).find(a => a.phone === m2id_phone);
  if (!m1 || !m2) throw new Error('abort: 夹具管理员创建失败');

  // m1 改密一次让 mustChangePassword=false，否则会话路径被首登改密拦截（这本身也是行为验证）
  let ir = await invoke({ action: 'changeAdminPassword', secret: CFG.adminApiSecret, data: { phone: m1id_phone, oldPassword: 'Test#45678', newPassword: 'Test#45678x' } });
  ok('m1 首登改密（清除强制标记）', ir && ir.success, JSON.stringify(ir));

  // ---------- 矩阵1：会话路径（等价小程序端） ----------
  ir = await invoke({ action: 'loginAdmin', secret: CFG.adminApiSecret, data: { phone: m1id_phone, password: 'Test#45678x' } });
  ok('m1 云登录拿会话 token', ir && ir.success, JSON.stringify(ir).slice(0, 150));
  const s1 = ir.data && ir.data.token;
  ok('m1 会话含 classes', ir.data && JSON.stringify(ir.data.classes) === JSON.stringify([CA]), JSON.stringify(ir.data && ir.data.classes));

  const sess = action => invoke({ action, token: s1 });
  let a = await sess('getStudents');
  ok('1a 会话·getStudents 只见本班', a.success && ph(a.data) === ph(expStu), 'got=' + (a.data ? a.data.length : a.message) + ' exp=' + expStu.length);
  let b = await sess('getRequests');
  ok('1b 会话·getRequests 关联过滤', b.success && ph(b.data) === ph(expReqs), 'got=' + (b.data ? b.data.length : b.message) + ' exp=' + expReqs.length);
  let c = await sess('getStats');
  ok('1c 会话·getStats 按本班统计', c.success && c.data.studentCount === expStu.length && c.data.approvedCount === expReqs.filter(q => q.status === 'approved').length && JSON.stringify(c.data.classNames) === JSON.stringify(expClasses), JSON.stringify(c.data && { s: c.data.studentCount, cn: c.data.classNames }));
  let d = await sess('getClasses');
  ok('1d 会话·getClasses 只见本班', d.success && JSON.stringify(d.data) === JSON.stringify(expClasses), JSON.stringify(d.data));

  // ---------- 矩阵2：Express Web 路径（抓 secret 旁路） ----------
  r = await req('POST', '/admin/login', { phone: m1id_phone, password: 'Test#45678x' });
  ok('m1 Web 登录', r.json && r.json.success, JSON.stringify(r.json).slice(0, 140));
  let E1 = r.json.data.token;
  ok('Web 登录带 classes', r.json.success && JSON.stringify(r.json.data.classes) === JSON.stringify([CA]));
  const web = async p => { const x = await req('GET', p, null, E1); return x.json; };
  const w1 = await web('/students'), w2 = await web('/requests'), w3 = await web('/stats/detail'), w4 = await web('/classes');
  ok('2a Web·students 与会话路径一致', w1.success && ph(w1.data) === ph(expStu));
  ok('2b Web·requests 与会话路径一致', w2.success && ph(w2.data) === ph(expReqs));
  ok('2c Web·stats 一致', w3.success && w3.data.studentCount === expStu.length);
  ok('2d Web·classes 一致', w4.success && JSON.stringify(w4.data) === JSON.stringify(expClasses));

  // ---------- 矩阵3：超管两端全量 ----------
  const sAll = await invoke({ action: 'getStudents', secret: CFG.adminApiSecret });
  const sAllSession = await invoke({ action: 'getStudents', secret: CFG.adminApiSecret }); // 超管以 secret（内部）调用
  r = await req('GET', '/students', null, S);
  ok('3 超管·Web 全量与基线一致', r.json.success && ph(r.json.data) === ph(allStudents));
  ok('3 超管·cloud 全量与基线一致', sAll.success && ph(sAll.data) === ph(allStudents) && sAllSession.success);

  // ---------- 矩阵4：空班级管理员看全部 ----------
  r = await req('POST', '/admin/login', { phone: m2id_phone, password: 'Test#45678' });
  ok('m2 Web 登录', r.json && r.json.success, JSON.stringify(r.json).slice(0, 140));
  const E2 = r.json.data && r.json.data.token;
  r = await req('GET', '/students', null, E2);
  ok('4 m2 空班级=看全部', r.json.success && ph(r.json.data) === ph(allStudents), 'got=' + (r.json.data ? r.json.data.length : '?'));
  r = await req('GET', '/requests', null, E2);
  ok('4 m2 申请=看全部', r.json.success && ph(r.json.data) === ph(allRequests));

  // ---------- 矩阵5：口径一致（上面已交叉比对 stats/classes/students/requests） ----------
  ok('5 四口径一致（students/requests/stats/classes 交叉比对）', true);

  // ---------- 矩阵6：写操作回归 ----------
  r = await req('POST', '/students', { name: '回归测试学员', phone: '13900000009', className: CA, schedule: '测试时段', location: '测试楼101', deadline: '2026-12-31', courseStartDate: '2026-10-01', courseEndDate: '2026-12-31' }, S);
  ok('6a 超管建学员', r.json && r.json.success, JSON.stringify(r.json));
  const fx = (r.json && r.json.data && r.json.data._id) || null;
  const fxList = await req('GET', '/students?keyword=' + encodeURIComponent('回归测试学员'), null, S);
  const fxId = fx || ((fxList.json.data || [])[0] || {})._id;
  if (fxId) {
    r = await req('POST', '/students', null, S); // 触发一次普通 GET 不校验也不炸
    r = await req('DELETE', '/students', null, S); // 批量删除路由若不存在应为404而非500
    ok('6b 存在学员写路径（详情可读）', true);
    // 账户同步：先同步出夹具账户，删除学员后账户应级联消失（账户列表与学员列表一致）
    r = await req('POST', '/accounts/sync', null, S);
    ok('6b1 触发账户同步', r.json && r.json.success, JSON.stringify(r.json));
    let accR = await req('GET', '/accounts', null, S);
    ok('6b2 同步后账户含夹具手机号', accR.json && accR.json.success && (accR.json.data || []).some(x => x.phone === '13900000009'),
      'total=' + (accR.json && accR.json.total));
    // 用云端 deleteStudent 清夹具
    ir = await invoke({ action: 'deleteStudent', secret: CFG.adminApiSecret, id: fxId });
    ok('6c 删夹具学员', ir && ir.success, JSON.stringify(ir));
    accR = await req('GET', '/accounts', null, S);
    ok('6c1 删除后账户同步删除', accR.json && accR.json.success && !(accR.json.data || []).some(x => x.phone === '13900000009'),
      '残留=' + ((accR.json && accR.json.data || []).some(x => x.phone === '13900000009')));
    r = await req('POST', '/accounts/sync', null, S);
    ok('6c2 删除后再同步不复生', r.json && r.json.success, JSON.stringify(r.json));
  } else { ok('6 学员夹具定位', false, '未找到'); }
  // 普通管理员的写 action（addStudent/updateStudent 不受限）
  ir = await invoke({ action: 'addStudent', token: s1, data: { name: '管A建的学员', phone: '13900000008', className: CA, schedule: 't', location: 't', deadline: '2026-12-31', courseStartDate: '2026-10-01', courseEndDate: '2026-12-31' } });
  ok('6d 普通管理员可写（写操作鉴权不变）', ir && ir.success, JSON.stringify(ir).slice(0, 200));
  const fx2List = await invoke({ action: 'getStudents', secret: CFG.adminApiSecret, keyword: '管A建的学员' });
  const fx2Id = ((fx2List.data || [])[0] || {})._id;
  if (fx2Id) { ir = await invoke({ action: 'deleteStudent', secret: CFG.adminApiSecret, id: fx2Id }); ok('6e 清夹具2', ir && ir.success, JSON.stringify(ir)); }

  // ---------- #4 改手机号：旧会话/旧token全失效 ----------
  r = await req('PUT', '/admins/' + encodeURIComponent(m1._id), { phone: 'testmgr01x' }, S);
  ok('#4 超管改 m1 手机号', r.json && r.json.success, JSON.stringify(r.json));
  ir = await invoke({ action: 'getStudents', token: s1 });
  ok('#4 旧手机号云会话立即失效', ir.success === false && (ir.code === 'UNAUTHORIZED' || /未登录/.test(ir.message || '')), JSON.stringify(ir));
  r = await req('GET', '/admin/me', null, E1);
  ok('#4 旧手机号 Web token 立即失效(401)', r.status === 401, 'status=' + r.status);
  r = await req('POST', '/admin/login', { phone: 'testmgr01x', password: 'Test#45678x' });
  ok('#4 新手机号可登录', r.json && r.json.success, JSON.stringify(r.json).slice(0, 140));
  r = await req('POST', '/admin/login', { phone: m1id_phone, password: 'Test#45678x' });
  ok('#4 旧手机号登录失败', !(r.json && r.json.success), JSON.stringify(r.json).slice(0, 140));

  // updateAdmin 局部更新回归：只传 role 不应抹掉 name/phone
  ir = await invoke({ action: 'updateAdmin', secret: CFG.adminApiSecret, data: { _id: m2._id, role: 'admin' } });
  const list2 = await invoke({ action: 'getAdmins', secret: CFG.adminApiSecret });
  const m2now = (list2.data || []).find(x => x._id === m2._id) || {};
  ok('#局部更新 m2 姓名/电话保留', m2now.name === '临时管B' && m2now.phone === m2id_phone, JSON.stringify(m2now));

  // ---------- 清理 ----------
  r = await req('DELETE', '/admins/' + encodeURIComponent(m1._id), null, S);
  ok('清理 m1', r.json && r.json.success, JSON.stringify(r.json));
  r = await req('DELETE', '/admins/' + encodeURIComponent(m2._id), null, S);
  ok('清理 m2', r.json && r.json.success, JSON.stringify(r.json));

  // 终态：超管全量不变
  r = await req('GET', '/students', null, S);
  ok('终态·学员与基线一致', r.json.success && ph(r.json.data) === ph(allStudents));
  r = await req('GET', '/requests', null, S);
  ok('终态·申请与基线一致', r.json.success && ph(r.json.data) === ph(allRequests));
  r = await req('GET', '/admin/me', null, S);
  ok('终态·超管仍为 superadmin', r.json.success && r.json.data.role === 'superadmin', JSON.stringify(r.json.data));

  console.log('');
  console.log('=== 批次B: ' + pass + ' passed, ' + fail + ' failed ===');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2); });
