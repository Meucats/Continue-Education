// Cloudflare Workers 版 - 杭职大继续教育学院管理后台
// 免费额度：每天10万次请求

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      // 静态文件：首页
      if (path === '/' || path === '/index.html') {
        return new Response(HTML_PAGE, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() }
        });
      }

      // ====== API 路由 ======

      // 管理员登录
      if (path === '/api/admin/login' && request.method === 'POST') {
        const body = await request.json();
        const { phone, password } = body;
        if (!phone || !password) return json({ success: false, message: '请输入账号和密码' });
        const admins = await getAdmins(env);
        const admin = admins.find(a => a.phone === phone && a.password === password);
        if (admin) return json({ success: true, data: { name: admin.name, phone: admin.phone, role: admin.role, classes: admin.classes || [] } });
        return json({ success: false, message: '账号或密码错误' });
      }

      // 管理员列表
      if (path === '/api/admins' && request.method === 'GET') {
        const admins = (await getAdmins(env)).map(({ password, ...rest }) => rest);
        return json({ success: true, data: admins });
      }

      // 添加管理员
      if (path === '/api/admins' && request.method === 'POST') {
        const body = await request.json();
        const { name, phone, password, role, classes } = body;
        if (!name || !phone || !password) return json({ success: false, message: '请填写所有字段' });
        const admins = await getAdmins(env);
        if (admins.find(a => a.phone === phone)) return json({ success: false, message: '该账号已存在' });
        admins.push({ id: 'admin-' + Date.now(), name, phone, password, role: role || 'admin', classes: classes || [], createdAt: new Date().toISOString() });
        await env.ADMIN_KV.put('admins', JSON.stringify(admins));
        return json({ success: true, message: '添加成功' });
      }

      // 删除管理员
      if (path.startsWith('/api/admins/') && request.method === 'DELETE') {
        const id = path.split('/').pop();
        const admins = await getAdmins(env);
        const target = admins.find(a => a.id === id);
        if (target && target.phone === 'admin') return json({ success: false, message: '不能删除默认管理员' });
        const filtered = admins.filter(a => a.id !== id);
        await env.ADMIN_KV.put('admins', JSON.stringify(filtered));
        return json({ success: true, message: '删除成功' });
      }

      // 学员列表
      if (path === '/api/students' && request.method === 'GET') {
        const result = await callCloud(env, 'getStudents');
        return json(result);
      }

      // 添加/更新学员
      if (path === '/api/students' && request.method === 'POST') {
        const body = await request.json();
        const result = await callCloud(env, 'addStudent', { data: body });
        return json(result);
      }

      // 删除学员
      if (path.startsWith('/api/students/') && path.endsWith('/reset-password') && request.method === 'POST') {
        const id = path.split('/')[3];
        const result = await callCloud(env, 'resetPassword', { id });
        return json(result);
      }
      if (path.startsWith('/api/students/') && request.method === 'DELETE') {
        const id = path.split('/')[3];
        const result = await callCloud(env, 'deleteStudent', { id });
        return json(result);
      }

      // 批量删除
      if (path === '/api/students/batch-delete' && request.method === 'POST') {
        const body = await request.json();
        const result = await callCloud(env, 'batchDeleteStudents', { data: body });
        return json(result);
      }

      // 导入（前端解析Excel后发JSON）
      if (path === '/api/import' && request.method === 'POST') {
        const body = await request.json();
        const { students } = body;
        if (!students || students.length === 0) return json({ success: false, message: '没有数据' });
        let added = 0, updated = 0, failed = 0;
        const errors = [];
        for (let i = 0; i < students.length; i++) {
          try {
            const result = await callCloud(env, 'addStudent', { data: students[i] });
            if (result.message && result.message.includes('更新')) updated++; else added++;
          } catch (err) {
            errors.push(`第${i + 2}行：${err.message}`);
            failed++;
          }
        }
        return json({ success: true, data: { total: students.length, added, updated, failed, errors } });
      }

      // 入校申请列表
      if (path === '/api/requests' && request.method === 'GET') {
        const url2 = new URL(request.url);
        const status = url2.searchParams.get('status');
        const result = await callCloud(env, 'getRequests', { status });
        return json(result);
      }

      // 审批通过
      if (path.match(/^\/api\/requests\/[^/]+\/approve$/) && request.method === 'POST') {
        const id = path.split('/')[3];
        const result = await callCloud(env, 'approveRequest', { id });
        return json(result);
      }

      // 审批拒绝
      if (path.match(/^\/api\/requests\/[^/]+\/reject$/) && request.method === 'POST') {
        const id = path.split('/')[3];
        const body = await request.json();
        const result = await callCloud(env, 'rejectRequest', { id, reason: body.reason });
        return json(result);
      }

      // 统计
      if (path === '/api/stats' && request.method === 'GET') {
        const result = await callCloud(env, 'getStats');
        return json(result);
      }

      // 账户列表
      if (path === '/api/accounts' && request.method === 'GET') {
        const result = await callCloud(env, 'getAccounts');
        return json(result);
      }

      // 账户同步
      if (path === '/api/accounts/sync' && request.method === 'POST') {
        const result = await callCloud(env, 'syncAccounts');
        return json(result);
      }

      // 模板下载（CSV格式）
      if (path === '/api/template/download' && request.method === 'GET') {
        const csv = generateTemplateCSV();
        return new Response(csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': "attachment; filename*=UTF-8''%E5%AD%A6%E5%91%98%E4%BF%A1%E6%81%AF%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.csv",
            ...corsHeaders()
          }
        });
      }

      // 导出学员（CSV）
      if (path === '/api/export/students' && request.method === 'GET') {
        const result = await callCloud(env, 'getStudents');
        if (!result.success) return new Response('导出失败', { status: 500 });
        const csv = generateExportCSV(result.data);
        return new Response(csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename=students.csv',
            ...corsHeaders()
          }
        });
      }

      // ====== 温馨提示 ======
      if (path === '/api/tips' && request.method === 'GET') {
        const result = await callCloud(env, 'getAllTips');
        return json(result);
      }
      if (path === '/api/tips' && request.method === 'POST') {
        const body = await request.json();
        const result = await callCloud(env, 'updateTip', { data: body });
        return json(result);
      }
      if (path.match(/^\/api\/tips\/[^/]+$/) && request.method === 'DELETE') {
        const id = path.split('/').pop();
        const result = await callCloud(env, 'deleteTip', { data: { id } });
        return json(result);
      }

      // ====== 班级列表 ======
      if (path === '/api/classes' && request.method === 'GET') {
        const result = await callCloud(env, 'getClasses');
        return json(result);
      }

      // ====== 管理员批量导入 ======
      if (path === '/api/admins/import' && request.method === 'POST') {
        const body = await request.json();
        const { admins: adminList } = body;
        if (!adminList || adminList.length === 0) return json({ success: false, message: '没有数据' });
        let added = 0, failed = 0;
        const errors = [];
        const admins = await getAdmins(env);
        for (let i = 0; i < adminList.length; i++) {
          const a = adminList[i];
          try {
            if (!a.name || !a.phone || !a.password) { errors.push(`第${i + 2}行：缺少必填字段`); failed++; continue; }
            if (admins.find(x => x.phone === a.phone)) { errors.push(`第${i + 2}行：账号已存在`); failed++; continue; }
            admins.push({ id: 'admin-' + Date.now() + '-' + i, name: a.name, phone: a.phone, password: a.password, role: a.role || 'admin', classes: a.classes || [], createdAt: new Date().toISOString() });
            added++;
          } catch (err) {
            errors.push(`第${i + 2}行：${err.message}`);
            failed++;
          }
        }
        await env.ADMIN_KV.put('admins', JSON.stringify(admins));
        return json({ success: true, data: { total: adminList.length, added, failed, errors } });
      }

      return new Response('Not Found', { status: 404 });
    } catch (err) {
      return json({ success: false, message: err.message }, 500);
    }
  }
};

// ====== 工具函数 ======

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Phone'
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

// 调用微信云函数
async function callCloud(env, action, params = {}) {
  const token = await getAccessToken(env);
  const url = `https://api.weixin.qq.com/tcb/invokecloudfunction?access_token=${token}&env=${env.CLOUD_ENV}&name=adminApi`;
  const body = JSON.stringify({ action, ...params });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  const result = await res.json();
  const respData = result.resp_data || result.response;
  if (respData) {
    return typeof respData === 'string' ? JSON.parse(respData) : respData;
  }
  if (result.errcode === 0) return { success: true };
  throw new Error('云函数调用失败: ' + JSON.stringify(result));
}

let accessTokenCache = '';
let tokenExpiry = 0;

async function getAccessToken(env) {
  if (accessTokenCache && Date.now() < tokenExpiry) return accessTokenCache;
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${env.WX_APPID}&secret=${env.WX_APP_SECRET}`;
  const res = await fetch(url);
  const result = await res.json();
  if (result.access_token) {
    accessTokenCache = result.access_token;
    tokenExpiry = Date.now() + (result.expires_in - 60) * 1000;
    return accessTokenCache;
  }
  throw new Error('获取 access_token 失败: ' + JSON.stringify(result));
}

// 管理员数据（用KV存储）
async function getAdmins(env) {
  const data = await env.ADMIN_KV.get('admins', 'json');
  if (data) return data;
  const defaults = [{ id: 'admin-default', name: '系统管理员', phone: 'admin', password: 'admin123', role: 'superadmin', createdAt: new Date().toISOString() }];
  await env.ADMIN_KV.put('admins', JSON.stringify(defaults));
  return defaults;
}

// CSV模板生成
function generateTemplateCSV() {
  const rows = [
    ['姓名', '联系电话', '身份证号码', '公司名称', '班级名称', '上课时间段', '课程开始日期', '课程结束日期', '上课截止时间', '上课地点'],
    ['张三', '13800138001', '330102199001011234', '杭州科技有限公司', '计算机基础班', '周一上午 9:00-11:00', '2026-09-01', '2026-12-31', '2026-12-31', '教学楼301教室'],
    ['李四', '13800138002', '330102199505052345', '浙江信息工程有限公司', '会计实务班', '周三下午 14:00-16:00, 周五上午 9:00-11:00', '2026-09-01', '2026-12-31', '2026-12-31', '实训楼205教室'],
    ['王五', '13800138003', '330102198808083456', '杭州教育发展有限公司', '英语提高班', '周二晚上 18:30-20:30, 周四晚上 18:30-20:30', '2026-09-01', '2026-12-31', '2026-12-31', '外语楼102教室']
  ];
  return '\uFEFF' + rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
}

function generateExportCSV(students) {
  const header = ['姓名', '联系电话', '身份证', '公司', '班级名称', '上课时间段', '课程开始日期', '课程结束日期', '上课截止时间', '上课地点'];
  const rows = students.map(s => [s.name, s.phone, s.idCard || '', s.company || '', s.className, s.schedule, s.courseStartDate || '', s.courseEndDate || '', s.deadline, s.location]);
  return '\uFEFF' + [header, ...rows].map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
}

// ====== 前端HTML ======
const HTML_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>杭职大继续教育学院 - 管理后台</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--primary:#1a73e8;--success:#28a745;--danger:#dc3545;--warning:#ff9800;--bg:#f0f2f5;--card:#fff;--text:#333;--text2:#666;--text3:#999;--border:#e8e8e8;--radius:12px}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text)}
.login-page{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1a73e8,#0d47a1)}
.login-box{background:#fff;border-radius:var(--radius);padding:40px;width:400px;max-width:90vw}
.login-box h2{text-align:center;margin-bottom:30px;color:var(--primary)}
.form-group{margin-bottom:20px}
.form-group label{display:block;font-size:14px;color:var(--text2);margin-bottom:6px}
.form-group input{width:100%;height:44px;border:1px solid var(--border);border-radius:8px;padding:0 12px;font-size:15px}
.btn{display:inline-flex;align-items:center;justify-content:center;height:40px;border:none;border-radius:8px;font-size:14px;cursor:pointer;padding:0 20px;gap:6px}
.btn-primary{background:var(--primary);color:#fff}
.btn-success{background:var(--success);color:#fff}
.btn-danger{background:var(--danger);color:#fff}
.btn-warning{background:var(--warning);color:#fff}
.btn-ghost{background:transparent;color:var(--primary);border:1px solid var(--primary)}
.btn-sm{height:32px;font-size:12px;padding:0 12px}
.btn-block{width:100%}
.hidden{display:none!important}
.app{display:flex;min-height:100vh}
.sidebar{width:220px;background:#fff;border-right:1px solid var(--border);padding:20px 0;flex-shrink:0}
.sidebar .logo{text-align:center;padding:20px;font-size:16px;font-weight:bold;color:var(--primary)}
.nav-item{padding:12px 24px;cursor:pointer;font-size:14px;display:flex;align-items:center;gap:8px;min-height:44px}
.nav-item:hover,.nav-item.active{background:#e8f0fe;color:var(--primary)}
.backdrop{position:fixed;inset:0;background:rgba(16,24,40,.45);z-index:45;opacity:0;pointer-events:none;transition:opacity .2s ease}
.backdrop.show{opacity:1;pointer-events:auto}
.menu-btn{display:none;width:40px;height:40px;border:1px solid var(--border);background:#fff;border-radius:10px;cursor:pointer;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;color:var(--text2)}
.menu-btn:hover{background:#f8f9ff;border-color:#d0d7e2}
.main{flex:1;padding:24px;overflow-y:auto;min-width:0}
.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;gap:12px}
.topbar-left{display:flex;align-items:center;gap:10px;min-width:0}
.page-title{font-size:20px;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card{background:#fff;border-radius:var(--radius);padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.stats-row{display:flex;gap:16px;margin-bottom:24px}
.stat-card{flex:1;background:#fff;border-radius:var(--radius);padding:20px;text-align:center}
.stat-num{font-size:28px;font-weight:bold;color:var(--primary)}
.stat-label{font-size:13px;color:var(--text3);margin-top:4px}
.table-container{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--border)}
th{background:#fafafa;font-weight:600;color:var(--text2)}
.tag{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:12px}
.tag-pending{background:#fff3e0;color:#ff9800}
.tag-approved{background:#e8f5e9;color:#28a745}
.tag-rejected{background:#ffebee;color:#dc3545}
.tag-expired{background:#f0f0f0;color:#999}
.tag-dot{width:6px;height:6px;border-radius:50%;background:currentColor}
.toolbar{display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap}
.toolbar input,.toolbar select{height:36px;border:1px solid var(--border);border-radius:8px;padding:0 12px;font-size:13px}
.toolbar input{flex:1;min-width:200px}
.modal-mask{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:1000}
.modal-box{background:#fff;border-radius:var(--radius);padding:24px;width:420px;max-width:90vw}
.modal-box h3{margin-bottom:16px}
.modal-box .form-group{margin-bottom:12px}
.modal-btns{display:flex;gap:10px;justify-content:flex-end;margin-top:20px}
.upload-zone{border:2px dashed var(--border);border-radius:var(--radius);padding:40px;text-align:center;cursor:pointer}
.upload-zone:hover{border-color:var(--primary);background:#f8f9ff}
.info-banner{background:#fff3e0;border-radius:var(--radius);padding:16px;margin-bottom:16px;font-size:13px}
.toast{position:fixed;top:20px;right:20px;background:#333;color:#fff;padding:12px 24px;border-radius:8px;z-index:9999;font-size:14px;animation:fadeIn .3s}
@keyframes fadeIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}
@keyframes pageIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes modalIn{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
.page-content:not(.hidden){animation:pageIn .3s cubic-bezier(.16,1,.3,1) both}
.modal-mask:not(.hidden){animation:fadeIn .2s ease both}
.modal-mask:not(.hidden) .modal-box{animation:modalIn .32s cubic-bezier(.16,1,.3,1) both}
.nav-item,.btn,.stat-card,.card{transition:background-color .15s ease,color .15s ease,transform .15s ease,box-shadow .15s ease}
.btn:active{transform:scale(.98)}
html.lenis,html.lenis body{height:auto}
.lenis.lenis-smooth{scroll-behavior:auto !important}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms !important;animation-iteration-count:1 !important;transition-duration:.01ms !important}}
@media(max-width:768px){
.menu-btn{display:inline-flex}
.sidebar{position:fixed;top:0;left:0;bottom:0;z-index:50;width:min(260px,84vw);transform:translateX(-105%);transition:transform .22s cubic-bezier(.16,1,.3,1);box-shadow:none;overflow-y:auto;visibility:hidden;pointer-events:none}
.app.nav-open .sidebar{transform:translateX(0);box-shadow:12px 0 32px -12px rgba(16,24,40,.35);visibility:visible;pointer-events:auto}
.nav-item{padding:12px 16px;justify-content:flex-start}
.main{padding:12px}
.stats-row{flex-direction:column;gap:12px}
.toolbar{flex-direction:column;align-items:stretch}
.toolbar input{min-width:0;width:100%}
.toolbar .btn{width:100%}
.topbar{flex-wrap:wrap;gap:10px}
.modal-mask{align-items:flex-end;padding:12px}
.modal-box{width:100%;max-width:min(480px,100%);max-height:min(90vh,720px);overflow-y:auto;border-radius:16px 16px 12px 12px}
.table-container{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{min-width:640px}
.upload-zone{padding:24px 14px}
.login-box{padding:28px 20px}
.card{padding:16px}
.nav-item,.btn{min-height:44px}
}
@media(max-width:480px){
.page-title{font-size:17px}
.stat-num{font-size:24px}
.topbar{flex-direction:column;align-items:flex-start}
}
</style>
</head>
<body>
<!-- 登录页 -->
<div id="loginPage" class="login-page">
<div class="login-box">
<h2>管理后台</h2>
<div class="form-group"><label>账号</label><input id="loginPhone" placeholder="管理员账号"></div>
<div class="form-group"><label>密码</label><input id="loginPwd" type="password" placeholder="密码"></div>
<button class="btn btn-primary btn-block" onclick="doLogin()">登录</button>
</div>
</div>

<!-- 主界面 -->
<div id="appPage" class="app hidden">
<div class="backdrop" id="navBackdrop" onclick="closeSidebar()"></div>
<div class="sidebar" id="sidebar" data-lenis-prevent>
<div class="logo">杭职大继教院</div>
<div class="nav-item active" onclick="switchPage('dashboard',this)">📊 首页概览</div>
<div class="nav-item" onclick="switchPage('students',this)">👥 学员管理</div>
<div class="nav-item" onclick="switchPage('import',this)">📥 批量导入</div>
<div class="nav-item" onclick="switchPage('requests',this)">🏫 进校申请</div>
<div class="nav-item" onclick="switchPage('admin-manage',this)">⚙️ 管理员</div>
<div class="nav-item" onclick="switchPage('tips',this)">💡 温馨提示</div>
<div class="nav-item" onclick="doLogout()" style="color:var(--danger)">🚪 退出登录</div>
</div>
<div class="main" data-lenis-prevent>
<!-- 首页概览 -->
<div id="page-dashboard" class="page-content">
<div class="topbar"><div class="topbar-left"><button type="button" class="menu-btn" id="menuBtn" aria-label="打开导航菜单" aria-expanded="false" onclick="toggleSidebar()">☰</button><div class="page-title">首页概览</div></div></div>
<div class="stats-row">
<div class="stat-card"><div class="stat-num" id="statStudents">-</div><div class="stat-label">学员总数</div></div>
<div class="stat-card"><div class="stat-num" id="statActive">-</div><div class="stat-label">有效课程</div></div>
<div class="stat-card"><div class="stat-num" id="statRequests">-</div><div class="stat-label">待审核申请</div></div>
</div>
</div>
<!-- 学员管理 -->
<div id="page-students" class="page-content hidden">
<div class="topbar"><div class="topbar-left"><button type="button" class="menu-btn" aria-label="打开导航菜单" onclick="toggleSidebar()">☰</button><div class="page-title">学员管理</div></div></div>
<div class="card">
<div class="toolbar">
<input id="studentSearch" placeholder="搜索姓名/手机/身份证/公司/班级" onkeyup="searchStudents()">
<button class="btn btn-primary btn-sm" onclick="loadStudents()">搜索</button>
<button class="btn btn-danger btn-sm" onclick="batchDeleteStudents()">批量删除</button>
<button class="btn btn-success btn-sm" onclick="location.href='/api/export/students'">导出Excel</button>
</div>
<div class="table-container"><table>
<thead><tr><th><input type="checkbox" id="checkAll" onchange="toggleCheckAll()"></th><th>姓名</th><th>联系电话</th><th>身份证</th><th>公司</th><th>班级</th><th>上课时间</th><th>地点</th><th>课程开始</th><th>课程结束</th><th>截止</th><th>操作</th></tr></thead>
<tbody id="studentTableBody"></tbody>
</table></div>
</div>
</div>
<!-- 批量导入 -->
<div id="page-import" class="page-content hidden">
<div class="topbar"><div class="topbar-left"><button type="button" class="menu-btn" aria-label="打开导航菜单" onclick="toggleSidebar()">☰</button><div class="page-title">批量导入</div></div></div>
<div class="info-banner">💡 支持 Excel 文件，系统自动识别表头。必须包含：姓名、联系电话、班级名称、上课时间段、课程开始日期、课程结束日期、上课地点。可选：身份证号码、公司名称。</div>
<div class="card">
<div style="display:flex;gap:10px;margin-bottom:16px">
<button class="btn btn-primary btn-sm" onclick="location.href='/api/template/download'">下载导入模板</button>
</div>
<div class="upload-zone" onclick="document.getElementById('fileInput').click()">
<div style="font-size:40px;margin-bottom:8px">📄</div>
<div>点击选择 Excel 文件（.xlsx/.xls）</div>
</div>
<input type="file" id="fileInput" accept=".xlsx,.xls" style="display:none" onchange="handleFileSelect(event)">
<div id="importResult" style="margin-top:16px"></div>
</div>
</div>
<!-- 进校申请 -->
<div id="page-requests" class="page-content hidden">
<div class="topbar"><div class="topbar-left"><button type="button" class="menu-btn" aria-label="打开导航菜单" onclick="toggleSidebar()">☰</button><div class="page-title">进校申请</div></div></div>
<div class="card">
<div class="toolbar">
<select id="requestFilter" onchange="loadRequests()">
<option value="all">全部</option><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已拒绝</option>
</select>
</div>
<div class="table-container"><table>
<thead><tr><th>姓名</th><th>联系电话</th><th>车牌号</th><th>进校日期</th><th>有效时段</th><th>申请时间</th><th>状态</th><th>操作</th></tr></thead>
<tbody id="requestTableBody"></tbody>
</table></div>
</div>
</div>
<!-- 管理员 -->
<div id="page-admin-manage" class="page-content hidden">
<div class="topbar"><div class="topbar-left"><button type="button" class="menu-btn" aria-label="打开导航菜单" onclick="toggleSidebar()">☰</button><div class="page-title">管理员管理</div></div><div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn btn-secondary btn-sm" onclick="showAdminImportModal()">📥 导入</button><button class="btn btn-primary btn-sm" onclick="showAddAdminModal()">+ 添加</button></div></div>
<div class="card"><div class="table-container"><table>
<thead><tr><th>名称</th><th>账号</th><th>角色</th><th>负责班级</th><th>创建时间</th><th>操作</th></tr></thead>
<tbody id="adminTableBody"></tbody>
</table></div></div>
</div>
<!-- 温馨提示 -->
<div id="page-tips" class="page-content hidden">
<div class="topbar"><div class="topbar-left"><button type="button" class="menu-btn" aria-label="打开导航菜单" onclick="toggleSidebar()">☰</button><div class="page-title">温馨提示</div></div></div>
<div class="info-banner">💡 为每个班级设置温馨提示，学员登录小程序后将在首页看到对应提示。</div>
<div class="card">
<div style="margin-bottom:12px;"><button class="btn btn-primary btn-sm" onclick="showAddTipModal()">+ 添加温馨提示</button></div>
<div class="table-container"><table>
<thead><tr><th>班级名称</th><th>温馨提示内容</th><th>更新时间</th><th>操作</th></tr></thead>
<tbody id="tipTableBody"></tbody>
</table></div>
</div>
</div>
</div>
</div>

<!-- 添加管理员弹窗 -->
<div id="adminModal" class="modal-mask hidden">
<div class="modal-box">
<h3>添加管理员</h3>
<div class="form-group"><label>名称</label><input id="adminName"></div>
<div class="form-group"><label>账号(手机)</label><input id="adminPhone"></div>
<div class="form-group"><label>密码</label><input id="adminPwd" type="password"></div>
<div class="form-group"><label>角色</label><select id="adminRole"><option value="admin">管理员</option><option value="superadmin">超级管理员</option></select></div>
<div class="form-group"><label>负责班级</label><div id="adminClassesBox" style="max-height:100px;overflow-y:auto;border:1px solid #e8e8e8;border-radius:8px;padding:8px;font-size:13px;">加载中...</div></div>
<div class="modal-btns">
<button class="btn btn-ghost" onclick="hideModal('adminModal')">取消</button>
<button class="btn btn-primary" onclick="addAdmin()">确认</button>
</div>
</div>
</div>
<!-- 温馨提示弹窗 -->
<div id="tipModal" class="modal-mask hidden">
<div class="modal-box">
<h3>编辑温馨提示</h3>
<div class="form-group"><label>班级名称</label><select id="tipClassName"><option value="">请选择班级</option></select></div>
<div class="form-group"><label>温馨提示内容</label><textarea id="tipContent" rows="4" style="width:100%;border:1px solid #e8e8e8;border-radius:8px;padding:8px;font-size:13px;" placeholder="请输入温馨提示内容..."></textarea></div>
<div class="modal-btns">
<button class="btn btn-ghost" onclick="hideModal('tipModal')">取消</button>
<button class="btn btn-primary" onclick="saveTip()">保存</button>
</div>
</div>
</div>
<!-- 管理员导入弹窗 -->
<div id="adminImportModal" class="modal-mask hidden">
<div class="modal-box">
<h3>批量导入管理员</h3>
<div class="info-banner" style="font-size:12px;">Excel表头：姓名、账号、密码、角色、班级（逗号分隔）</div>
<div class="upload-zone" onclick="document.getElementById('adminFileInput').click()" style="border:2px dashed #e8e8e8;border-radius:12px;padding:20px;text-align:center;cursor:pointer;margin:12px 0;">📄 点击选择 Excel 文件</div>
<input type="file" id="adminFileInput" accept=".xlsx,.xls" style="display:none" onchange="handleAdminFile(event)">
<div id="adminImportResult"></div>
<div class="modal-btns">
<button class="btn btn-ghost" onclick="hideModal('adminImportModal')">关闭</button>
</div>
</div>
</div>

<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/lenis@1.1.18/dist/lenis.min.js"></script>
<script>
const API=location.origin;
let allStudents=[];

// 动效基座：taste 参数 + Lenis/ScrollTrigger 同步 + cleanup（模板内禁用反引号与模板插值）
const Motion=(()=>{
const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let lenis=null,tickerCb=null,ctx=null;
function ready(){return typeof gsap!=='undefined'}
function initScroll(){
if(reduce||!ready()||typeof Lenis==='undefined'||typeof ScrollTrigger==='undefined'||lenis)return;
gsap.registerPlugin(ScrollTrigger);
lenis=new Lenis({duration:1.1,smoothWheel:true,syncTouch:false});
lenis.on('scroll',ScrollTrigger.update);
tickerCb=function(t){if(lenis)lenis.raf(t*1000)};
gsap.ticker.add(tickerCb);
gsap.ticker.lagSmoothing(0);
ScrollTrigger.refresh();
}
function destroy(){
if(tickerCb){gsap.ticker.remove(tickerCb);tickerCb=null}
if(lenis){lenis.destroy();lenis=null}
if(ctx){ctx.revert();ctx=null}
if(typeof ScrollTrigger!=='undefined')ScrollTrigger.getAll().forEach(function(t){t.kill()});
}
function loginEntrance(){
if(reduce||!ready())return;
const root=document.getElementById('loginPage');
if(!root||root.classList.contains('hidden'))return;
if(ctx)ctx.revert();
ctx=gsap.context(function(){
gsap.timeline({defaults:{ease:'expo.out'}})
.from('.login-box',{y:20,autoAlpha:0,duration:.55});
},root);
}
function adminEntrance(){
if(reduce||!ready())return;
const root=document.getElementById('appPage');
if(!root||root.classList.contains('hidden'))return;
if(ctx)ctx.revert();
ctx=gsap.context(function(){
gsap.timeline({defaults:{ease:'expo.out'}})
.from('.sidebar .logo',{x:-12,autoAlpha:0,duration:.4})
.from('.sidebar .nav-item',{x:-10,autoAlpha:0,duration:.35,stagger:.04},'-=.2')
.from('.main .topbar',{y:-8,autoAlpha:0,duration:.4},'-=.3')
.from('#page-dashboard .stat-card',{y:14,autoAlpha:0,duration:.45,stagger:.05},'-=.2');
},root);
if(typeof ScrollTrigger!=='undefined')ScrollTrigger.refresh();
}
function pageEntrance(pageId){
if(reduce||!ready())return;
const el=document.getElementById('page-'+pageId);
if(!el||el.classList.contains('hidden'))return;
const targets=el.querySelectorAll('.card,.info-banner,.stat-card');
if(!targets.length)return;
gsap.fromTo(targets,{y:10,autoAlpha:0},{y:0,autoAlpha:1,duration:.4,stagger:.05,ease:'expo.out',overwrite:'auto'});
if(typeof ScrollTrigger!=='undefined')ScrollTrigger.refresh();
}
return{reduce:reduce,initScroll:initScroll,destroy:destroy,loginEntrance:loginEntrance,adminEntrance:adminEntrance,pageEntrance:pageEntrance};
})();

function toast(msg){const d=document.createElement('div');d.className='toast';d.textContent=msg;document.body.appendChild(d);setTimeout(()=>d.remove(),3000)}
function hideModal(id){document.getElementById(id).classList.add('hidden')}
function showAddAdminModal(){document.getElementById('adminModal').classList.remove('hidden')}

function isDrawerMode(){return window.matchMedia('(max-width:768px)').matches}
function toggleSidebar(){
const app=document.getElementById('appPage');
const backdrop=document.getElementById('navBackdrop');
if(!app||!backdrop)return;
const open=app.classList.toggle('nav-open');
backdrop.classList.toggle('show',open);
const btn=document.getElementById('menuBtn');
if(btn)btn.setAttribute('aria-expanded',open?'true':'false');
document.documentElement.style.overflow=open?'hidden':'';
}
function closeSidebar(){
const app=document.getElementById('appPage');
const backdrop=document.getElementById('navBackdrop');
if(!app||!backdrop)return;
app.classList.remove('nav-open');
backdrop.classList.remove('show');
const btn=document.getElementById('menuBtn');
if(btn)btn.setAttribute('aria-expanded','false');
document.documentElement.style.overflow='';
}
document.querySelectorAll('#sidebar .nav-item').forEach(function(item){
item.addEventListener('click',function(){if(isDrawerMode())closeSidebar()});
});
window.matchMedia('(min-width:769px)').addEventListener('change',function(e){if(e.matches)closeSidebar()});
document.addEventListener('keydown',function(e){
if(e.key==='Escape'){
const app=document.getElementById('appPage');
if(app&&app.classList.contains('nav-open')){closeSidebar();return}
}
});

async function api(path,body){
const opt=body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{};
const r=await fetch(API+path,opt);
return r.json();
}

// 登录
async function doLogin(){
const phone=document.getElementById('loginPhone').value.trim();
const pwd=document.getElementById('loginPwd').value.trim();
if(!phone||!pwd)return toast('请输入账号密码');
const r=await api('/api/admin/login',{phone,password:pwd});
if(r.success){localStorage.setItem('admin',JSON.stringify(r.data));closeSidebar();document.getElementById('loginPage').classList.add('hidden');document.getElementById('appPage').classList.remove('hidden');loadDashboard();requestAnimationFrame(function(){Motion.adminEntrance()});}
else toast(r.message);
}
function doLogout(){localStorage.removeItem('admin');location.reload();}

// 页面切换
function switchPage(page,el){
document.querySelectorAll('.page-content').forEach(p=>p.classList.add('hidden'));
document.getElementById('page-'+page).classList.remove('hidden');
document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
if(el)el.classList.add('active');
closeSidebar();
if(page==='dashboard')loadDashboard();
if(page==='students')loadStudents();
if(page==='requests')loadRequests();
if(page==='admin-manage')loadAdmins();
if(page==='tips')loadTips();
requestAnimationFrame(function(){Motion.pageEntrance(page)});
}

// 首页统计
async function loadDashboard(){
const r=await api('/api/stats');
if(r.success){
document.getElementById('statStudents').textContent=r.data.totalStudents||0;
document.getElementById('statActive').textContent=r.data.activeCourses||0;
document.getElementById('statRequests').textContent=r.data.pendingRequests||0;
}
}

// 学员管理
async function loadStudents(){
const r=await api('/api/students');
if(r.success){allStudents=r.data||[];renderStudents(allStudents);}
}
function renderStudents(students){
const tbody=document.getElementById('studentTableBody');
if(!students.length){tbody.innerHTML='<tr><td colspan="12"><div style="text-align:center;padding:40px;color:#999">暂无学员数据</div></td></tr>';return;}
tbody.innerHTML=students.map(s=>{
const cdc=(s.courseDates&&s.courseDates.length)?s.courseDates.length:0;
return '<tr><td><input type="checkbox" class="stu-check" value="'+s._id+'"></td><td><b>'+s.name+'</b></td><td>'+s.phone+'</td><td>'+(s.idCard||'-')+'</td><td>'+(s.company||'-')+'</td><td>'+s.className+'</td><td>'+s.schedule+'</td><td>'+s.location+'</td><td>'+(s.courseStartDate||'-')+'</td><td>'+(s.courseEndDate||'-')+'</td><td>'+(s.deadline||'-')+(cdc>0?'<br><small style="color:var(--primary)">'+cdc+'节课</small>':'')+'</td><td><button class="btn btn-ghost btn-sm" onclick="resetPwd(\\''+s._id+'\\',\\''+s.name+'\\')">🔑</button> <button class="btn btn-ghost btn-sm" onclick="delStudent(\\''+s._id+'\\',\\''+s.name+'\\')">🗑️</button></td></tr>';
}).join('');
}
function searchStudents(){
const k=document.getElementById('studentSearch').value.trim().toLowerCase();
if(!k)return renderStudents(allStudents);
renderStudents(allStudents.filter(s=>s.name.toLowerCase().includes(k)||s.phone.includes(k)||(s.idCard&&s.idCard.includes(k))||(s.company&&s.company.toLowerCase().includes(k))||(s.className&&s.className.toLowerCase().includes(k))));
}
function toggleCheckAll(){const c=document.getElementById('checkAll').checked;document.querySelectorAll('.stu-check').forEach(cb=>cb.checked=c)}
async function delStudent(id,name){if(!confirm('确定删除「'+name+'」？'))return;const r=await api('/api/students/'+id,{method:'DELETE'});if(r.success){toast('已删除');loadStudents();}else toast(r.message);}
async function resetPwd(id,name){if(!confirm('重置「'+name+'」的密码？'))return;const r=await fetch(API+'/api/students/'+id+'/reset-password',{method:'POST'});const d=await r.json();if(d.success)toast('新密码：'+d.newPassword);else toast(d.message);}
async function batchDeleteStudents(){
const ids=[...document.querySelectorAll('.stu-check:checked')].map(cb=>cb.value);
if(!ids.length)return toast('请先勾选');
if(!confirm('确定删除'+ids.length+'个学员？'))return;
const r=await fetch(API+'/api/students/batch-delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})});
const d=await r.json();if(d.success){toast('已删除');loadStudents();}else toast(d.message);
}

// 导入
async function handleFileSelect(e){
const file=e.target.files[0];if(!file)return;
document.getElementById('importResult').innerHTML='<div style="color:var(--primary)">正在解析文件...</div>';
try{
const data=await file.arrayBuffer();
const workbook=XLSX.read(data,{type:'array'});
const ws=workbook.Sheets[workbook.SheetNames[0]];
const jsonData=XLSX.utils.sheet_to_json(ws);
const headers=XLSX.utils.sheet_to_json(ws,{header:1})[0]||[];
const fm=detectFieldMapping(headers);
const students=jsonData.map(row=>({
name:getF(row,fm,'name'),phone:String(getF(row,fm,'phone')||'').trim(),
idCard:getF(row,fm,'idCard'),company:getF(row,fm,'company'),
className:getF(row,fm,'className'),schedule:getF(row,fm,'schedule'),
courseStartDate:getF(row,fm,'courseStartDate'),courseEndDate:getF(row,fm,'courseEndDate'),
deadline:getF(row,fm,'deadline'),location:getF(row,fm,'location')
}));
document.getElementById('importResult').innerHTML='<div style="color:var(--text2)">解析完成，共'+students.length+'条，正在导入...</div>';
const r=await fetch(API+'/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({students})});
const res=await r.json();
if(res.success){
const d=res.data;
document.getElementById('importResult').innerHTML='<div style="color:var(--success)">导入完成：新增'+d.added+'条，更新'+d.updated+'条，失败'+d.failed+'条'+(d.errors.length?'<br>'+d.errors.join('<br>':'')+'</div>');
}else toast(res.message);
}catch(err){document.getElementById('importResult').innerHTML='<div style="color:var(--danger)">导入失败：'+err.message+'</div>';}
}
function detectFieldMapping(headers){
const map={};
const a={name:['姓名','名字'],phone:['联系电话','手机号','手机','电话'],idCard:['身份证号码','身份证'],company:['公司名称','公司','单位'],className:['班级名称','班级','课程名称'],schedule:['上课时间段','上课时间','时间'],courseStartDate:['课程开始日期','开始日期'],courseEndDate:['课程结束日期','结束日期'],deadline:['上课截止时间','截止时间','截止日期'],location:['上课地点','地点','教室']};
for(const[f,ns]of Object.entries(a))for(const n of ns)if(headers.find(h=>String(h).trim()===n)){map[f]=n;break;}
return map;
}
function getF(row,fm,f){return fm[f]?(row[fm[f]]||''):'';}

// 入校申请
async function loadRequests(){
const status=document.getElementById('requestFilter').value;
const r=await api('/api/requests?status='+status);
if(r.success)renderRequests(r.data||[]);
}
function renderRequests(requests){
const tbody=document.getElementById('requestTableBody');
const now=new Date();
const sm={pending:['待审核','tag-pending'],approved:['已通过','tag-approved'],rejected:['已拒绝','tag-rejected']};
if(!requests.length){tbody.innerHTML='<tr><td colspan="8"><div style="text-align:center;padding:40px;color:#999">暂无数据</div></td></tr>';return;}
tbody.innerHTML=requests.map(r=>{
const exp=r.status==='approved'&&r.entryEndTime&&now>new Date(r.entryEndTime);
let st,sc;if(exp){st='已过期';sc='tag-expired';}else{[st,sc]=sm[r.status]||['未知',''];}
const t=r.createdAt?new Date(r.createdAt).toLocaleString('zh-CN'):'-';
return '<tr><td><b>'+r.name+'</b></td><td>'+r.phone+'</td><td>'+(r.carPlate||'-')+'</td><td>'+(r.entryDate||'-')+'</td><td>'+(r.entryStartTime?r.entryStartTime+' - '+r.entryEndTime:'-')+'</td><td>'+t+'</td><td><span class="tag '+sc+'"><span class="tag-dot"></span>'+st+'</span></td><td>'+(r.status==='pending'?'<button class="btn btn-success btn-sm" onclick="approveReq(\\''+r._id+'\\')">通过</button> <button class="btn btn-danger btn-sm" onclick="rejectReq(\\''+r._id+'\\')">拒绝</button>':r.status==='approved'?'<span class="tag tag-approved"><span class="tag-dot"></span>已通过</span>':r.status==='rejected'?'<span class="tag tag-rejected"><span class="tag-dot"></span>已拒绝</span>':'-')+'</td></tr>';
}).join('');
}
async function approveReq(id){if(!confirm('通过此申请？'))return;const r=await api('/api/requests/'+id+'/approve',{});if(r.success){toast('已通过');loadRequests();}else toast(r.message);}
async function rejectReq(id){const reason=prompt('拒绝原因（选填）');const r=await api('/api/requests/'+id+'/reject',{reason});if(r.success){toast('已拒绝');loadRequests();}else toast(r.message);}

// 管理员管理
let allClasses=[];
async function loadAdmins(){
const r=await api('/api/admins');
const cr=await api('/api/classes');
if(cr.success)allClasses=cr.data||[];
if(r.success){
const tbody=document.getElementById('adminTableBody');
tbody.innerHTML=(r.data||[]).map(a=>{
const cls=(a.classes&&a.classes.length>0)?a.classes.join('、'):'<span style="color:#999">未分配</span>';
return '<tr><td><b>'+a.name+'</b></td><td>'+a.phone+'</td><td>'+(a.role==='superadmin'?'超级管理员':'管理员')+'</td><td style="font-size:12px;">'+cls+'</td><td>'+(a.createdAt||'-')+'</td><td>'+(a.phone==='admin'?'<span style="color:#999">默认</span>':'<button class="btn btn-ghost btn-sm" onclick="delAdmin(\\''+a.id+'\\',\\''+a.name+'\\')">删除</button>')+'</td></tr>';
}).join('');
}
}
function showAddAdminModal(){
document.getElementById('adminName').value='';
document.getElementById('adminPhone').value='';
document.getElementById('adminPwd').value='';
document.getElementById('adminRole').value='admin';
loadClassesCheckboxes([]);
document.getElementById('adminModal').classList.remove('hidden');
}
function loadClassesCheckboxes(selected){
const box=document.getElementById('adminClassesBox');
if(!allClasses.length){box.innerHTML='<span style="color:#999">暂无班级</span>';return;}
box.innerHTML=allClasses.map(c=>'<label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:13px;cursor:pointer;"><input type="checkbox" class="admin-class-cb" value="'+c+'" '+(selected.includes(c)?'checked':'')+'>'+c+'</label>').join('');
}
function getCheckedClasses(){return[...document.querySelectorAll('.admin-class-cb:checked')].map(cb=>cb.value);}
async function addAdmin(){
const name=document.getElementById('adminName').value.trim();
const phone=document.getElementById('adminPhone').value.trim();
const pwd=document.getElementById('adminPwd').value.trim();
const role=document.getElementById('adminRole').value;
const classes=getCheckedClasses();
if(!name||!phone||!pwd)return toast('请填写所有字段');
const r=await api('/api/admins',{name,phone,password:pwd,role,classes});
if(r.success){toast('添加成功');hideModal('adminModal');loadAdmins();}else toast(r.message);
}
async function delAdmin(id,name){if(!confirm('删除管理员「'+name+'」？'))return;const r=await fetch(API+'/api/admins/'+id,{method:'DELETE'});const d=await r.json();if(d.success){toast('已删除');loadAdmins();}else toast(d.message);}

// 温馨提示管理
async function loadTips(){
const r=await api('/api/tips');
const tbody=document.getElementById('tipTableBody');
if(!r.success||!r.data||!r.data.length){tbody.innerHTML='<tr><td colspan="4"><div style="text-align:center;padding:30px;color:#999">暂无温馨提示，请点击右上角添加</div></td></tr>';return;}
tbody.innerHTML=r.data.map(t=>{
const time=t.updatedAt?new Date(t.updatedAt).toLocaleString('zh-CN'):'-';
const sc=(t.content||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n');
return '<tr><td><b>'+t.className+'</b></td><td style="max-width:300px;white-space:pre-wrap;">'+(t.content||'<span style="color:#999">空</span>')+'</td><td>'+time+'</td><td><button class="btn btn-ghost btn-sm" onclick="editTip(\\''+t._id+'\\',\\''+t.className+'\\',\\''+sc+'\\')">✏️</button> <button class="btn btn-ghost btn-sm" onclick="delTip(\\''+t._id+'\\',\\''+t.className+'\\')">🗑️</button></td></tr>';
}).join('');
}
function showAddTipModal(){
document.getElementById('editTipId')&&(document.getElementById('editTipId').value='');
document.getElementById('tipClassName').value='';
document.getElementById('tipContent').value='欢迎来到杭州职业技术大学继续教育学院！请遵守校园管理规定，按时到校上课。如有疑问请联系：56700015。';
loadTipClassOptions();
document.getElementById('tipModal').classList.remove('hidden');
}
function editTip(id,className,content){
document.getElementById('tipModal').classList.remove('hidden');
document.getElementById('tipClassName').value=className;
document.getElementById('tipContent').value=content;
}
function loadTipClassOptions(){
const sel=document.getElementById('tipClassName');
sel.innerHTML='<option value="">请选择班级</option>';
allClasses.forEach(c=>{sel.innerHTML+='<option value="'+c+'">'+c+'</option>';});
}
async function saveTip(){
const className=document.getElementById('tipClassName').value;
const content=document.getElementById('tipContent').value.trim();
if(!className)return toast('请选择班级');
const r=await api('/api/tips',{className,content});
if(r.success){toast('保存成功');hideModal('tipModal');loadTips();}else toast(r.message);
}
async function delTip(id,className){if(!confirm('删除「'+className+'」的温馨提示？'))return;const r=await fetch(API+'/api/tips/'+id,{method:'DELETE'});const d=await r.json();if(d.success){toast('已删除');loadTips();}else toast(d.message);}

// 管理员导入
function showAdminImportModal(){document.getElementById('adminImportResult').innerHTML='';document.getElementById('adminFileInput').value='';document.getElementById('adminImportModal').classList.remove('hidden');}
async function handleAdminFile(e){
const file=e.target.files[0];if(!file)return;
document.getElementById('adminImportResult').innerHTML='<div style="color:#1a73e8">正在解析...</div>';
try{
const data=await file.arrayBuffer();
const workbook=XLSX.read(data,{type:'array'});
const ws=workbook.Sheets[workbook.SheetNames[0]];
const jsonData=XLSX.utils.sheet_to_json(ws);
const headers=XLSX.utils.sheet_to_json(ws,{header:1})[0]||[];
const fm={};
const aliases={name:['姓名','名称'],phone:['账号','手机','电话'],password:['密码'],role:['角色'],classes:['班级','负责班级']};
headers.forEach((h,i)=>{const header=String(h).trim();for(const[f,ns]of Object.entries(aliases))if(ns.some(n=>header.includes(n))){fm[f]=i;break;}});
const admins=jsonData.map(row=>{const keys=Object.keys(row);return{
name:fm.name!==undefined?String(row[keys[fm.name]]||'').trim():'',
phone:fm.phone!==undefined?String(row[keys[fm.phone]]||'').trim():'',
password:fm.password!==undefined?String(row[keys[fm.password]]||'').trim():'',
role:fm.role!==undefined?String(row[keys[fm.role]]||'').trim():'admin',
classes:fm.classes!==undefined?String(row[keys[fm.classes]]||'').split(/[,，]/).map(s=>s.trim()).filter(Boolean):[]
};});
const r=await fetch(API+'/api/admins/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({admins})});
const res=await r.json();
if(res.success){const d=res.data;document.getElementById('adminImportResult').innerHTML='<div style="color:#28a745">导入完成：共'+d.total+'条，成功'+d.added+'条，失败'+d.failed+'条</div>'+(d.errors&&d.errors.length?'<div style="color:#dc3545;font-size:12px;margin-top:8px;">'+d.errors.join('<br>')+'</div>':'');loadAdmins();}
else toast(res.message);
}catch(err){document.getElementById('adminImportResult').innerHTML='<div style="color:#dc3545">导入失败：'+err.message+'</div>';}
}

// 初始化
Motion.initScroll();
if(localStorage.getItem('admin')){document.getElementById('loginPage').classList.add('hidden');document.getElementById('appPage').classList.remove('hidden');loadDashboard();requestAnimationFrame(function(){Motion.adminEntrance()});}
else{requestAnimationFrame(function(){Motion.loginEntrance()});}
window.addEventListener('pagehide',function(){Motion.destroy()});
window.addEventListener('beforeunload',function(){Motion.destroy()});
</script>
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
</body>
</html>`;
