// 批次A：个人主页 / 自助修改 / 权限矩阵（需本地 Express 在跑）
// 用法（PowerShell）：
//   $env:ADMIN_PASS='你的超管密码'; npm run e2e:profile
// 可选环境变量：BASE_URL（默认 http://127.0.0.1:3000/api）、ADMIN_USER（默认 admin）
// 注意：用例会真实走「改密码→改回」链路，请勿在生产库上运行。
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000/api';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS;
if (!ADMIN_PASS) {
  console.error('缺少环境变量 ADMIN_PASS。用法：$env:ADMIN_PASS="..."; npm run e2e:profile');
  process.exit(2);
}
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' | ' + extra : '')); }
}
async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await r.json(); } catch (e) {}
  return { status: r.status, json };
}

(async () => {
  // 1. 登录
  let r = await req('POST', '/admin/login', { phone: ADMIN_USER, password: ADMIN_PASS });
  ok('登录 ' + ADMIN_USER, r.json && r.json.success, JSON.stringify(r.json).slice(0, 120));
  if (!r.json || !r.json.success) throw new Error('abort: 超管登录失败（检查服务是否在跑、ADMIN_PASS 是否正确）');
  const d = r.json.data;
  ok('登录响应含 _id', !!(d && d._id), JSON.stringify(d && Object.keys(d)));
  let token = d.token;
  const origName = d.name;

  // 2. /admin/me 返回 _id
  r = await req('GET', '/admin/me', null, token);
  ok('/admin/me 含 _id 且与登录一致', r.json.success && r.json.data._id === d._id);
  ok('me.role=superadmin', r.json.data.role === 'superadmin');

  // 3. 自助改姓名 → 返回新 token，当前页不掉线
  const newName = origName + '·测';
  r = await req('PUT', '/admins/' + encodeURIComponent(d._id), { name: newName }, token);
  ok('PUT self 改姓名成功', r.json && r.json.success, JSON.stringify(r.json));
  ok('响应带新 token', !!(r.json.data && r.json.data.token), JSON.stringify(r.json.data));
  if (r.json.data && r.json.data.token) token = r.json.data.token;
  r = await req('GET', '/admin/me', null, token);
  ok('新 token 生效且姓名已更新', r.json.success && r.json.data.name === newName, JSON.stringify(r.json.data));

  // 4. 自助路径禁止带 password/role 字段（应被忽略）
  r = await req('PUT', '/admins/' + encodeURIComponent(d._id), { name: newName, password: 'Hacked#12345', role: 'admin' }, token);
  ok('夹带 password/role 请求成功返回', r.json && r.json.success, JSON.stringify(r.json));
  if (r.json.data && r.json.data.token) token = r.json.data.token;
  r = await req('POST', '/admin/login', { phone: ADMIN_USER, password: ADMIN_PASS });
  ok('password/role 字段被忽略（原密码仍可登录）', r.json && r.json.success);
  if (r.json && r.json.success) token = r.json.data.token;
  r = await req('GET', '/admin/me', null, token);
  ok('role 仍为 superadmin', r.json.data.role === 'superadmin', JSON.stringify(r.json.data));

  // 5. 改密码（真实链路，改回原值）
  r = await req('POST', '/admin/change-password', { oldPassword: ADMIN_PASS, newPassword: 'TempTest#2026' }, token);
  ok('改密码 TempTest#2026', r.json && r.json.success, JSON.stringify(r.json));
  ok('改密码响应含新 token', !!(r.json.data && r.json.data.token));
  r = await req('POST', '/admin/login', { phone: ADMIN_USER, password: 'TempTest#2026' });
  ok('新密码可登录', r.json && r.json.success, JSON.stringify(r.json));
  if (r.json && r.json.success) token = r.json.data.token;
  r = await req('POST', '/admin/change-password', { oldPassword: 'TempTest#2026', newPassword: ADMIN_PASS }, token);
  ok('改回原密码', r.json && r.json.success, JSON.stringify(r.json));
  r = await req('POST', '/admin/login', { phone: ADMIN_USER, password: ADMIN_PASS });
  ok('原密码恢复可登录', r.json && r.json.success);
  if (r.json && r.json.success) token = r.json.data.token;

  // 6. 建普通管理员测权限矩阵
  r = await req('POST', '/admins', { name: '临时测试管', phone: 'testmgr01', password: 'Test#45678', role: 'admin', classes: ['测试班A'] }, token);
  ok('创建临时普通管理员', r.json && r.json.success, JSON.stringify(r.json));
  r = await req('GET', '/admins', null, token);
  const list = (r.json && r.json.data) || [];
  const testMgr = list.find(a => a.phone === 'testmgr01');
  ok('临时管理员已存在', !!testMgr);
  const selfId = d._id;

  let mgrToken = null;
  if (testMgr) {
    // 普通管理员登录
    r = await req('POST', '/admin/login', { phone: 'testmgr01', password: 'Test#45678' });
    ok('普通管理员登录', r.json && r.json.success, JSON.stringify(r.json));
    mgrToken = r.json.data && r.json.data.token;

    // 改自己 → 允许
    r = await req('PUT', '/admins/' + encodeURIComponent(testMgr._id), { name: '临时测试管2' }, mgrToken);
    ok('普通管理员改自己姓名=允许', r.json && r.json.success, JSON.stringify(r.json));

    // 改别人（超管）→ 403
    r = await req('PUT', '/admins/' + encodeURIComponent(selfId), { name: '越权改名' }, mgrToken);
    ok('普通管理员改超管=403', r.status === 403, 'status=' + r.status + ' ' + JSON.stringify(r.json));

    // 普通管理员建人 → 403（requireSuperadmin 路由不受影响）
    r = await req('POST', '/admins', { name: 'x', phone: 'x2', password: 'x' }, mgrToken);
    ok('普通管理员建人=403', r.status === 403, 'status=' + r.status);

    // 清理：确保超管姓名没被越权改动
    r = await req('GET', '/admin/me', null, token);
    ok('超管姓名未被越权修改', r.json.data.name === newName, JSON.stringify(r.json.data));
  }

  // 7. 清理测试管理员
  if (testMgr) {
    r = await req('DELETE', '/admins/' + encodeURIComponent(testMgr._id), null, token);
    ok('删除临时管理员', r.json && r.json.success, JSON.stringify(r.json));
  }

  // 8. 还原超管姓名
  r = await req('PUT', '/admins/' + encodeURIComponent(selfId), { name: origName }, token);
  ok('还原超管姓名 ' + origName, r.json && r.json.success, JSON.stringify(r.json));
  if (r.json.data && r.json.data.token) token = r.json.data.token;
  r = await req('GET', '/admin/me', null, token);
  ok('最终姓名=' + origName, r.json.data.name === origName, JSON.stringify(r.json.data));

  console.log('');
  console.log('=== 批次A: ' + pass + ' passed, ' + fail + ' failed ===');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2); });
