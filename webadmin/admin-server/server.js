const express = require('express');
const XLSX = require('xlsx');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
// R3 单源：学生导入工具（表头映射/取值/字符串化/Excel日期解析/日期格式化）——权威源 shared/import-tools.js（UMD）
const { detectFieldMapping, getField, asStr, parseExcelDate, formatDateStr } = require('./shared/import-tools');
// R4 单源：排课日期生成（单段+多段）——权威源 shared/course-dates.js（UMD，依赖 import-tools 由其内部注入）
const { generateCourseDates, generateCourseDatesMulti } = require('./shared/course-dates');

// 读取配置
const configPath = path.join(__dirname, 'config.json');
let config = { env: 'cloud1-d6gio7v8iff39bab7', appId: '', appSecret: '', adminApiSecret: '' };
if (fs.existsSync(configPath)) {
  config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
}

const app = express();
// CORS：默认不下发跨域头（页面与接口同源，跨域请求由浏览器拦截）；如需放开，在 config.json 配 corsOrigins
const corsOrigins = Array.isArray(config.corsOrigins) ? config.corsOrigins : [];
app.use(cors(corsOrigins.length ? { origin: corsOrigins } : { origin: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ====== 登录 Token（HMAC，无第三方依赖） ======
const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天
const secretPath = path.join(__dirname, '.token-secret');
const tokenStatePath = path.join(__dirname, '.token-state.json');
let TOKEN_SECRET;
if (fs.existsSync(secretPath)) {
  TOKEN_SECRET = fs.readFileSync(secretPath, 'utf8').trim();
} else {
  TOKEN_SECRET = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretPath, TOKEN_SECRET, 'utf8');
}

// 每个账号最近一次改密时间：改密后签发的旧 token 全部失效
function loadTokenState() {
  try { return JSON.parse(fs.readFileSync(tokenStatePath, 'utf8')); } catch (e) { return {}; }
}
function setTokenNotBefore(phone) {
  try {
    const state = loadTokenState();
    state[phone] = Date.now();
    fs.writeFileSync(tokenStatePath, JSON.stringify(state), 'utf8');
  } catch (e) {}
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + TOKEN_TTL })).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  const sigBuf = Buffer.from(String(sig || ''));
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!data.exp || data.exp < Date.now()) return null;
    const state = loadTokenState();
    if (data.phone && state[data.phone] && (data.iat || 0) < state[data.phone]) return null;
    return data;
  } catch (e) { return null; }
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ success: false, message: '未登录或登录已过期' });
  req.admin = payload;
  next();
}

function requireSuperadmin(req, res, next) {
  if (!req.admin || req.admin.role !== 'superadmin') {
    return res.status(403).json({ success: false, message: '需要超级管理员权限' });
  }
  next();
}

// 超管，或「操作对象==当前登录人」的普通管理员（个人主页自助修改用）。
// 无论谁调用都会先取目标管理员：既判 self，也给「改他人角色/班级/密码吊销 token」用。
async function requireSuperadminOrSelf(req, res, next) {
  try {
    const list = await callCloudFunction('getAdmins');
    const target = ((list && list.data) || []).find(a => a._id === req.params.id);
    if (!target) return res.status(404).json({ success: false, message: '管理员不存在' });
    req.targetAdmin = target;
    const isSelf = (!!req.admin._id && target._id === req.admin._id) || target.phone === req.admin.phone;
    req.selfUpdate = isSelf;
    if (!isSelf && (!req.admin || req.admin.role !== 'superadmin')) {
      return res.status(403).json({ success: false, message: '只能修改自己的账号信息' });
    }
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// 除登录外，所有 /api 请求均需鉴权
app.use('/api', (req, res, next) => {
  const urlPath = (req.originalUrl || req.url || '').split('?')[0];
  if (req.method === 'POST' && (req.path === '/admin/login' || urlPath === '/api/admin/login')) return next();
  if (req.method === 'OPTIONS') return next();
  requireAuth(req, res, next);
});

const upload = multer({ dest: 'uploads/' });
if (!fs.existsSync(path.join(__dirname, 'uploads'))) fs.mkdirSync(path.join(__dirname, 'uploads'));

// ====== 登录限速（服务端，best-effort 边缘防抖） ======
// 权威限速在云函数 adminApi（rate_limits 集合持久化，多实例共享、重启不清零，复审 #9）；
// 本层仅进程内存，Express 重启即清零 —— 只用于挡住明显刷接口，不承担最终安全职责。
const loginAttempts = new Map();
function loginRateLimited(key) {
  const now = Date.now();
  const rec = loginAttempts.get(key);
  if (!rec) return false;
  if (rec.until > now) return true;
  if (now - rec.first > 10 * 60 * 1000) { loginAttempts.delete(key); return false; }
  return false;
}
function recordLoginFail(key) {
  const now = Date.now();
  const rec = loginAttempts.get(key);
  if (!rec || now - rec.first > 10 * 60 * 1000) {
    loginAttempts.set(key, { count: 1, first: now, until: 0 });
    return;
  }
  rec.count++;
  if (rec.count >= 5) rec.until = now + 10 * 60 * 1000;
}
function clearLoginFails(key) { loginAttempts.delete(key); }

// ====== 云函数调用封装 ======
let accessToken = '';
let tokenExpiry = 0;
let tokenFetch = null;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;
  if (!config.appId || !config.appSecret) {
    throw new Error('请在 config.json 中配置 appId 和 appSecret');
  }
  // 单飞行锁：并发调用共用同一次换 token 请求，避免互相挤掉（40001）
  if (tokenFetch) return tokenFetch;
  tokenFetch = (async () => {
    try {
      const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${config.appId}&secret=${config.appSecret}`;
      const result = await httpGet(url);
      if (result.access_token) {
        accessToken = result.access_token;
        tokenExpiry = Date.now() + (result.expires_in - 60) * 1000;
        return accessToken;
      }
      throw new Error('获取 access_token 失败: ' + JSON.stringify(result));
    } finally {
      tokenFetch = null;
    }
  })();
  return tokenFetch;
}

async function callCloudFunction(action, params = {}) {
  if (!config.adminApiSecret) {
    throw new Error('未配置 adminApiSecret：请在 config.json 中设置与云函数环境变量 ADMIN_API_SECRET 一致的值');
  }
  const body = JSON.stringify({ action, secret: config.adminApiSecret, ...params });
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let result;
    try {
      const token = await getAccessToken();
      const url = `https://api.weixin.qq.com/tcb/invokecloudfunction?access_token=${token}&env=${config.env}&name=adminApi`;
      result = await httpPost(url, body);
    } catch (err) {
      // 网络级错误（超时/断连/换 token 失败）→ 重试一次
      lastErr = err;
      if (attempt === 0) continue;
      throw err;
    }
    // access_token 失效（被其他调用方挤掉）或瞬时错误 → 刷缓存重试一次
    const retriable = result && [40001, 42001, 40014, -601008].includes(result.errcode);
    if (retriable && attempt === 0) {
      accessToken = '';
      tokenExpiry = 0;
      lastErr = result;
      continue;
    }
    // 云函数返回格式可能是 resp_data 或 response
    const respData = result.resp_data || result.response;
    if (respData) {
      return typeof respData === 'string' ? JSON.parse(respData) : respData;
    }
    if (result.errcode === 0) {
      return { success: true };
    }
    throw new Error('云函数调用失败: ' + JSON.stringify(result));
  }
    throw new Error('云函数调用失败: ' + JSON.stringify(lastErr));
}

// ====== 云函数代理工厂 ======
// 同构路由统一：try/catch + callCloudFunction + res.json；middlewares 前置鉴权，
// before 返回真 = 已自行写响应即短路（如「不能删自己」前置）。
function proxy(action, pickParams, middlewares = [], before) {
  const handler = async (req, res) => {
    try {
      if (before && await before(req, res)) return;
      const result = await callCloudFunction(action, pickParams(req));
      res.json(result);
    } catch (err) {
      res.json({ success: false, message: err.message });
    }
  };
  return [...middlewares, handler];
}

// 人员范围过滤参数（getStudents/getRequests/getAccounts/getStats/getClasses 共用）
const actorParams = req => ({ actorRole: req.admin.role, actorClasses: req.admin.classes || [] });

// before 钩子：目标管理员 == 当前登录人则按给定文案拒绝（deleteAdmin / resetAdminPassword 同构前置）
const rejectSelf = message => async (req, res) => {
  const list = await callCloudFunction('getAdmins');
  const target = (list && list.data || []).find(a => a._id === req.params.id);
  if (target && target.phone === req.admin.phone) {
    res.json({ success: false, message });
    return true;
  }
  return false;
};

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.setTimeout(10000, () => req.destroy(new Error('请求超时（10秒）')));
    req.on('error', reject);
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.setTimeout(10000, () => req.destroy(new Error('请求超时（10秒）')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ====== 管理员登录（代理云函数，密码仅在云端校验） ======
app.post('/api/admin/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.json({ success: false, message: '请输入账号和密码' });
  const limiterKey = String(req.ip || '') + '|' + phone;
  if (loginRateLimited(limiterKey)) {
    return res.json({ success: false, message: '尝试次数过多，请10分钟后再试' });
  }
  try {
    const result = await callCloudFunction('loginAdmin', { data: { phone, password } });
    if (!result || !result.success) {
      recordLoginFail(limiterKey);
      return res.json({ success: false, message: (result && result.message) || '账号或密码错误' });
    }
    clearLoginFails(limiterKey);
    const admin = result.data;
    const token = signToken({
      _id: admin._id,
      phone: admin.phone,
      name: admin.name,
      role: admin.role || 'admin',
      classes: admin.classes || [],
      mustChangePassword: !!admin.mustChangePassword
    });
    return res.json({
      success: true,
      data: { _id: admin._id, name: admin.name, phone: admin.phone, role: admin.role, classes: admin.classes || [], mustChangePassword: !!admin.mustChangePassword, token }
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ====== 当前登录管理员（会话校验） ======
app.get('/api/admin/me', (req, res) => {
  const { _id, phone, name, role, classes, mustChangePassword } = req.admin;
  res.json({ success: true, data: { _id, name, phone, role, classes: classes || [], mustChangePassword: !!mustChangePassword } });
});

// ====== 退出登录：立即作废该账号本机签发的所有 token ======
app.post('/api/admin/logout', (req, res) => {
  setTokenNotBefore(req.admin.phone);
  res.json({ success: true, message: '已退出登录' });
});

// ====== 修改当前管理员密码（代理云函数，改密后旧 token 全部失效） ======
app.post('/api/admin/change-password', async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.json({ success: false, message: '请填写完整信息' });
  if (String(newPassword).length < 8) return res.json({ success: false, message: '新密码至少8位' });
  try {
    const result = await callCloudFunction('changeAdminPassword', {
      data: { phone: req.admin.phone, oldPassword, newPassword }
    });
    if (!result || !result.success) return res.json(result || { success: false, message: '修改失败' });
    setTokenNotBefore(req.admin.phone);
    const token = signToken({
      _id: req.admin._id,
      phone: req.admin.phone,
      name: req.admin.name,
      role: req.admin.role || 'admin',
      classes: req.admin.classes || [],
      mustChangePassword: false
    });
    res.json({ success: true, message: result.message || '密码修改成功', data: { token } });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ====== 管理员管理（数据统一存云端 admins 集合，需超管权限） ======
app.get('/api/admins', ...proxy('getAdmins', () => ({})));

app.post('/api/admins', ...proxy('addAdmin', req => ({ data: req.body }), [requireSuperadmin]));

app.put('/api/admins/:id', requireSuperadminOrSelf, async (req, res) => {
  try {
    const body = { ...(req.body || {}) };
    if (req.selfUpdate) {
      // 自助修改只允许姓名/账号：密码走 change-password，权限字段仅超管可动
      delete body.role;
      delete body.classes;
      delete body.password;
      delete body.mustChangePassword;
    }
    const target = req.targetAdmin || null;
    const result = await callCloudFunction('updateAdmin', { data: { _id: req.params.id, ...body } });
    if (result && result.success && req.selfUpdate && target) {
      const phoneChanged = !!(body.phone && body.phone !== target.phone);
      if (phoneChanged) {
        // 改账号：旧手机号全部 token 立即失效（含当前）→ 前端提示用新账号重新登录
        setTokenNotBefore(target.phone);
        return res.json({ ...result, data: { relogin: true } });
      }
      if (body.name && body.name !== target.name) {
        // 改姓名：签发带新姓名的 token，当前页不掉线
        const token = signToken({
          _id: req.admin._id,
          phone: req.admin.phone,
          name: body.name,
          role: req.admin.role || 'admin',
          classes: req.admin.classes || [],
          mustChangePassword: !!req.admin.mustChangePassword
        });
        return res.json({ ...result, data: { token } });
      }
    }
    if (result && result.success && !req.selfUpdate && target) {
      // 超管改他人：角色/班级变更、改密码、改账号 → 对方旧 token 全部失效，重新登录获取新权限
      const roleChanged = !!(body.role && body.role !== target.role);
      const classesChanged = JSON.stringify(body.classes || []) !== JSON.stringify(target.classes || []);
      const phoneChanged = !!(body.phone && body.phone !== target.phone);
      if (roleChanged || classesChanged || body.password || phoneChanged) setTokenNotBefore(target.phone);
    }
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.delete('/api/admins/:id', ...proxy('deleteAdmin', req => ({ id: req.params.id }), [requireSuperadmin], rejectSelf('不能删除自己的账号')));

// ====== 重置管理员密码（账号=密码=手机号，重置后对方首登强制改密） ======
app.post('/api/admins/:id/reset-password', ...proxy('resetAdminPassword', req => ({ id: req.params.id }), [requireSuperadmin], rejectSelf('不能重置自己的账号，请使用修改密码功能')));

app.post('/api/admins/init', ...proxy('initDefaultAdmin', () => ({}), [requireSuperadmin]));

// ====== 学员管理 ======
app.get('/api/students', ...proxy('getStudents', req => ({ keyword: req.query.keyword, ...actorParams(req) })));

app.post('/api/students', ...proxy('addStudent', req => ({ data: req.body })));

app.put('/api/students/:id', ...proxy('updateStudent', req => ({ data: { _id: req.params.id, ...req.body } })));

app.delete('/api/students/:id', ...proxy('deleteStudent', req => ({ id: req.params.id })));

app.post('/api/students/batch-delete', ...proxy('batchDeleteStudents', req => ({ data: req.body })));

// ====== Excel 导入 ======
app.post('/api/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.json({ success: false, message: '请上传文件' });
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);
    const headers = XLSX.utils.sheet_to_json(worksheet, { header: 1 })[0] || [];
    const fieldMap = detectFieldMapping(headers);

    let added = 0, updated = 0, failed = 0;
    const errors = [];

    for (let i = 0; i < jsonData.length; i++) {
      const row = jsonData[i];
      const rowNum = i + 2;
      try {
        const name = asStr(getField(row, fieldMap, 'name'));
        const phone = asStr(getField(row, fieldMap, 'phone'));
        const idCard = asStr(getField(row, fieldMap, 'idCard'));
        const company = asStr(getField(row, fieldMap, 'company'));
        const className = asStr(getField(row, fieldMap, 'className'));
        const schedule = asStr(getField(row, fieldMap, 'schedule'));
        const courseStartDate = getField(row, fieldMap, 'courseStartDate'); // 原始值：字符串或 Excel 日期序列号
        const courseEndDate = getField(row, fieldMap, 'courseEndDate');
        const deadline = getField(row, fieldMap, 'deadline');
        const location = asStr(getField(row, fieldMap, 'location'));

        if (!name) { errors.push(`第${rowNum}行：姓名为空`); failed++; continue; }
        if (!phone || phone.length !== 11) { errors.push(`第${rowNum}行：手机号格式错误`); failed++; continue; }
        if (!className) { errors.push(`第${rowNum}行：班级名称为空`); failed++; continue; }
        if (!schedule) { errors.push(`第${rowNum}行：上课时间段为空`); failed++; continue; }
        if (!location) { errors.push(`第${rowNum}行：上课地点为空`); failed++; continue; }

        // 自动生成 courseDates（支持逗号分隔多时间段）
        const courseDates = generateCourseDatesMulti(schedule, courseStartDate, courseEndDate);

        // 确保日期字段为字符串格式
        const startD = parseExcelDate(courseStartDate);
        const endD = parseExcelDate(courseEndDate);
        const startStr = formatDateStr(startD) || String(courseStartDate || '');
        const endStr = formatDateStr(endD) || String(courseEndDate || '');

        const studentData = { name, phone, idCard: idCard || '', company: company || '', className, schedule, deadline: formatDateStr(parseExcelDate(deadline)) || endStr || '', location, courseDates, courseStartDate: startStr, courseEndDate: endStr };
        const result = await callCloudFunction('addStudent', { data: studentData });
        if (result.message && result.message.includes('更新')) updated++; else added++;
      } catch (err) {
        errors.push(`第${rowNum}行：${err.message}`);
        failed++;
      }
    }

    res.json({ success: true, data: { total: jsonData.length, added, updated, failed, errors } });
  } catch (err) {
    res.json({ success: false, message: err.message });
  } finally {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
  }
});

// ====== 入校申请 ======
app.get('/api/requests', ...proxy('getRequests', req => ({ status: req.query.status, ...actorParams(req) })));

app.post('/api/requests', ...proxy('addRequest', req => ({ data: req.body })));

app.post('/api/requests/:id/approve', ...proxy('approveRequest', req => ({ id: req.params.id })));

app.post('/api/requests/:id/reject', ...proxy('rejectRequest', req => ({ id: req.params.id, reason: req.body.reason })));

// ====== 账户管理 ======
app.post('/api/students/:id/reset-password', ...proxy('resetPassword', req => ({ id: req.params.id })));

app.get('/api/accounts', ...proxy('getAccounts', req => actorParams(req)));

app.post('/api/accounts/sync', ...proxy('syncAccounts', () => ({})));

// ====== 统计 ======
app.get('/api/stats/detail', ...proxy('getStats', req => actorParams(req)));

// ====== 导出/下载 ======
// 10列正式Excel导出；3列CSV快速复制在小程序 admin-accounts.onExport（互链，两处口径不同勿合并）

// 学员导出与导入模板共用 10 列列宽；表头字面两处不同（导出用「身份证/公司」短名、模板用「身份证号码/公司名称」全名）勿合并，改动时两处互相同步
const STUDENT_XLSX_COLS = [{ wch: 10 }, { wch: 15 }, { wch: 22 }, { wch: 25 }, { wch: 20 }, { wch: 40 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 20 }];
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// xlsx 下载组装：aoa → sheet(+列宽) → workbook → 附件响应
function sendXlsx(res, { rows, cols, sheetName, disposition }) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (cols) ws['!cols'] = cols;
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', disposition);
  res.setHeader('Content-Type', XLSX_MIME);
  res.send(buf);
}

app.get('/api/export/students', async (req, res) => {
  try {
    const result = await callCloudFunction('getStudents', actorParams(req));
    if (!result.success) return res.status(500).send('导出失败');
    const rows = [['姓名', '联系电话', '身份证', '公司', '班级名称', '上课时间段', '课程开始日期', '课程结束日期', '上课截止时间', '上课地点']];
    result.data.forEach(s => rows.push([s.name, s.phone, s.idCard || '', s.company || '', s.className, s.schedule, s.courseStartDate || '', s.courseEndDate || '', s.deadline, s.location]));
    sendXlsx(res, { rows, cols: STUDENT_XLSX_COLS, sheetName: '学员信息', disposition: 'attachment; filename=students.xlsx' });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/api/template/download', (req, res) => {
  const rows = [
    ['姓名', '联系电话', '身份证号码', '公司名称', '班级名称', '上课时间段', '课程开始日期', '课程结束日期', '上课截止时间', '上课地点'],
    ['张三', '13800138001', '330102199001011234', '杭州科技有限公司', '计算机基础班', '周一上午 9:00-11:00', '2026-09-01', '2026-12-31', '2026-12-31', '教学楼301教室'],
    ['李四', '13800138002', '330102199505052345', '浙江信息工程有限公司', '会计实务班', '周三下午 14:00-16:00, 周五上午 9:00-11:00', '2026-09-01', '2026-12-31', '2026-12-31', '实训楼205教室'],
    ['王五', '13800138003', '330102198808083456', '杭州教育发展有限公司', '英语提高班', '周二晚上 18:30-20:30, 周四晚上 18:30-20:30', '2026-09-01', '2026-12-31', '2026-12-31', '外语楼102教室']
  ];
  sendXlsx(res, { rows, cols: STUDENT_XLSX_COLS, sheetName: '学员信息', disposition: "attachment; filename*=UTF-8''%E5%AD%A6%E5%91%98%E4%BF%A1%E6%81%AF%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx" });
});

// ====== 温馨提示 ======
// 管理员导入模板（姓名 / 电话 / 负责班级）
app.get('/api/template/admins', (req, res) => {
  const rows = [
    ['姓名', '电话', '负责班级'],
    ['张三', '13800138001', '计算机基础班,会计实务班'],
    ['李四', '13800138002', '英语提高班']
  ];
  sendXlsx(res, { rows, cols: [{ wch: 12 }, { wch: 16 }, { wch: 40 }], sheetName: '管理员', disposition: 'attachment; filename=admins.xlsx' });
});

app.get('/api/tips', ...proxy('getAllTips', () => ({})));

app.post('/api/tips', ...proxy('updateTip', req => ({ data: req.body })));

app.delete('/api/tips/:id', ...proxy('deleteTip', req => ({ data: { id: req.params.id } })));

// ====== 班级列表 ======
app.get('/api/classes', ...proxy('getClasses', req => actorParams(req)));

// ====== 管理员批量导入 ======
app.post('/api/admins/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.json({ success: false, message: '请上传文件' });
    const workbook = XLSX.readFile(req.file.path);
    const ws = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(ws);
    const headers = XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || [];
    const fieldMap = {};
    const aliases = { name: ['姓名', '名称'], phone: ['账号', '手机', '电话'], password: ['密码'], role: ['角色'], classes: ['班级', '负责班级'] };
    headers.forEach((h, i) => {
      const header = String(h).trim();
      for (const [field, names] of Object.entries(aliases)) {
        if (names.some(n => header.includes(n))) { fieldMap[field] = i; break; }
      }
    });
    const admins = jsonData.map(row => {
      const keys = Object.keys(row);
      return {
        name: fieldMap.name !== undefined ? String(row[keys[fieldMap.name]] || '').trim() : '',
        phone: fieldMap.phone !== undefined ? String(row[keys[fieldMap.phone]] || '').trim() : '',
        password: fieldMap.password !== undefined ? String(row[keys[fieldMap.password]] || '').trim() : '',
        role: fieldMap.role !== undefined ? String(row[keys[fieldMap.role]] || '').trim() : 'admin',
        classes: fieldMap.classes !== undefined ? String(row[keys[fieldMap.classes]] || '').split(/[,，]/).map(s => s.trim()).filter(Boolean) : []
      };
    });
    const result = await callCloudFunction('importAdmins', { data: { admins } });
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  } finally {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
  }
});

// ====== 启动 ======
const PORT = 3000;
app.listen(PORT, async () => {
  console.log('');
  console.log('==========================================');
  console.log('  杭职大继续教育学院 - 管理后台');
  console.log('==========================================');
  console.log('');
  console.log('  打开浏览器访问: http://localhost:' + PORT);
  console.log('');
  if (!config.adminApiSecret) {
    console.log('  ❌ 未配置 adminApiSecret：登录等接口将全部失败');
    console.log('     请在 config.json 中补充 adminApiSecret（与云函数 ADMIN_API_SECRET 一致）');
  }
  console.log('  提示: 普通管理员/被重置账号首登强制改密；超管不强制改密');
  console.log('        部署后请立即手动修改默认口令 admin/admin123（默认账号首次登录也会强制改密一次）');
  console.log('');
  console.log('==========================================');

  // 云端预热：拿 access_token + 触发云函数冷启动，失败退避重试，避免用户首屏踩冷启动
  let warmOk = false;
  for (let i = 0; i < 3 && !warmOk; i++) {
    try {
      await callCloudFunction('initDefaultAdmin');
      warmOk = true;
      console.log('  ✅ 默认管理员初始化 + 云端预热完成');
    } catch (e) {
      if (i < 2) {
        console.log(`  ⏳ 云端预热失败，${600 * (i + 1)}ms 后重试（${i + 1}/2）...`);
        await new Promise(r => setTimeout(r, 600 * (i + 1)));
      } else {
        console.log('  ❌ 云端预热失败（首页数据可能无法加载）:', e.message);
      }
    }
  }
});
