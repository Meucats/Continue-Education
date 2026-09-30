const express = require('express');
const XLSX = require('xlsx');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');

// 读取配置
const configPath = path.join(__dirname, 'config.json');
let config = { env: 'cloud1-d6gio7v8iff39bab7', secretId: '', secretKey: '', appId: '', appSecret: '', adminApiSecret: '' };
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
  return rec.count >= 5 && rec.until > now;
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
app.get('/api/admins', async (req, res) => {
  try {
    const result = await callCloudFunction('getAdmins');
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/admins', requireSuperadmin, async (req, res) => {
  try {
    const result = await callCloudFunction('addAdmin', { data: req.body });
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

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

app.delete('/api/admins/:id', requireSuperadmin, async (req, res) => {
  try {
    const list = await callCloudFunction('getAdmins');
    const target = (list && list.data || []).find(a => a._id === req.params.id);
    if (target && target.phone === req.admin.phone) {
      return res.json({ success: false, message: '不能删除自己的账号' });
    }
    const result = await callCloudFunction('deleteAdmin', { id: req.params.id });
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ====== 重置管理员密码（账号=密码=手机号，重置后对方首登强制改密） ======
app.post('/api/admins/:id/reset-password', requireSuperadmin, async (req, res) => {
  try {
    const list = await callCloudFunction('getAdmins');
    const target = (list && list.data || []).find(a => a._id === req.params.id);
    if (target && target.phone === req.admin.phone) {
      return res.json({ success: false, message: '不能重置自己的账号，请使用修改密码功能' });
    }
    const result = await callCloudFunction('resetAdminPassword', { id: req.params.id });
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/admins/init', requireSuperadmin, async (req, res) => {
  try {
    const result = await callCloudFunction('initDefaultAdmin');
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ====== 学员管理 ======
app.get('/api/students', async (req, res) => {
  try {
    const result = await callCloudFunction('getStudents', { keyword: req.query.keyword, actorRole: req.admin.role, actorClasses: req.admin.classes || [] });
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/students', async (req, res) => {
  try {
    const result = await callCloudFunction('addStudent', { data: req.body });
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.put('/api/students/:id', async (req, res) => {
  try {
    const result = await callCloudFunction('updateStudent', { data: { _id: req.params.id, ...req.body } });
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.delete('/api/students/:id', async (req, res) => {
  try {
    const result = await callCloudFunction('deleteStudent', { id: req.params.id });
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/students/batch-delete', async (req, res) => {
  try {
    const result = await callCloudFunction('batchDeleteStudents', { data: req.body });
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

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
        const name = getField(row, fieldMap, 'name');
        const phone = String(getField(row, fieldMap, 'phone') || '').trim();
        const idCard = getField(row, fieldMap, 'idCard');
        const company = getField(row, fieldMap, 'company');
        const className = getField(row, fieldMap, 'className');
        const schedule = getField(row, fieldMap, 'schedule');
        const courseStartDate = getField(row, fieldMap, 'courseStartDate');
        const courseEndDate = getField(row, fieldMap, 'courseEndDate');
        const deadline = getField(row, fieldMap, 'deadline');
        const location = getField(row, fieldMap, 'location');

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

        const studentData = { name, phone, idCard: idCard || '', company: company || '', className, schedule, deadline: endStr || '', location, courseDates, courseStartDate: startStr, courseEndDate: endStr };
        const result = await callCloudFunction('addStudent', { data: studentData });
        if (result.message && result.message.includes('更新')) updated++; else added++;
      } catch (err) {
        errors.push(`第${rowNum}行：${err.message}`);
        failed++;
      }
    }

    fs.unlinkSync(req.file.path);
    res.json({ success: true, data: { total: jsonData.length, added, updated, failed, errors } });
  } catch (err) {
    res.json({ success: false, message: err.message });
  } finally {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} }
  }
});

function detectFieldMapping(headers) {
  const map = {};
  const aliases = {
    name: ['姓名', '名字', 'name', '学员姓名', '学生姓名'],
    phone: ['联系电话', '手机号', '手机', '电话', 'phone', '手机号码', '联系手机'],
    idCard: ['身份证号码', '身份证', '身份证号', 'idCard', '身份证件号码'],
    company: ['公司名称', '公司', '单位', 'company', '所属公司', '工作单位'],
    className: ['班级名称', '班级', '课程名称', '课程', 'className', '班名'],
    schedule: ['上课时间段', '上课时间', '时间', 'schedule', '时间段', '课程时间'],
    courseStartDate: ['课程开始日期', '开始日期', '课程开始', 'courseStartDate'],
    courseEndDate: ['课程结束日期', '结束日期', '课程结束', 'courseEndDate'],
    deadline: ['上课截止时间', '截止时间', '截止日期', 'deadline', '结束时间', '到期时间'],
    location: ['上课地点', '地点', '教室', 'location', '校区', '上课教室']
  };
  for (const [field, names] of Object.entries(aliases)) {
    for (const name of names) {
      if (headers.find(h => String(h).trim() === name)) { map[field] = name; break; }
    }
  }
  return map;
}

function getField(row, fieldMap, field) {
  return fieldMap[field] ? (row[fieldMap[field]] || '') : '';
}

// 将Excel日期值（字符串或序列号数字）统一转为 Date 对象
function parseExcelDate(val) {
  if (!val) return null;
  if (typeof val === 'number') {
    // Excel序列号：1 = 1900-01-01（但有1900闰年bug，需减1天偏移）
    const d = new Date((val - 25569) * 86400 * 1000);
    return d;
  }
  const s = String(val).trim();
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(s)) {
    return new Date(s.replace(/-/g, '/'));
  }
  return null;
}

function formatDateStr(d) {
  if (!d || isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 根据上课时间段+开始结束日期，自动生成具体上课日期（单个时间段）
function generateCourseDates(schedule, startDate, endDate) {
  if (!startDate || !endDate) return [];
  const dayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0 };
  let targetDay = -1;
  for (const [key, val] of Object.entries(dayMap)) {
    if (schedule.includes(key)) { targetDay = val; break; }
  }
  if (targetDay < 0) return [];

  const timeMatch = schedule.match(/(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})/);
  const timeSlot = timeMatch ? timeMatch[0] : schedule;

  const start = parseExcelDate(startDate);
  const end = parseExcelDate(endDate);
  if (!start || !end) return [];

  const dates = [];
  const d = new Date(start);
  while (d.getDay() !== targetDay && d <= end) {
    d.setDate(d.getDate() + 1);
  }
  while (d <= end) {
    dates.push({ date: formatDateStr(d), timeSlot: timeSlot });
    d.setDate(d.getDate() + 7);
  }
  return dates;
}

// 支持逗号分隔的多时间段
function generateCourseDatesMulti(schedule, startDate, endDate) {
  const allDates = [];
  const parts = schedule.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  parts.forEach(part => {
    const dates = generateCourseDates(part, startDate, endDate);
    allDates.push(...dates);
  });
  allDates.sort((a, b) => a.date.localeCompare(b.date));
  return allDates;
}

// 根据上课时间段+日期范围生成 courseDates（用于小程序端）
function generateCourseDatesFromSchedule(schedule, startDate, endDate) {
  return generateCourseDates(schedule, startDate, endDate);
}

// ====== 入校申请 ======
app.get('/api/requests', async (req, res) => {
  try {
    const result = await callCloudFunction('getRequests', { status: req.query.status, actorRole: req.admin.role, actorClasses: req.admin.classes || [] });
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/requests', async (req, res) => {
  try {
    const result = await callCloudFunction('addRequest', { data: req.body });
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/requests/:id/approve', async (req, res) => {
  try {
    const result = await callCloudFunction('approveRequest', { id: req.params.id });
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/requests/:id/reject', async (req, res) => {
  try {
    const result = await callCloudFunction('rejectRequest', { id: req.params.id, reason: req.body.reason });
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ====== 账户管理 ======
app.post('/api/students/:id/reset-password', async (req, res) => {
  try {
    const result = await callCloudFunction('resetPassword', { id: req.params.id });
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.get('/api/accounts', async (req, res) => {
  try {
    const result = await callCloudFunction('getAccounts');
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/accounts/sync', async (req, res) => {
  try {
    const result = await callCloudFunction('syncAccounts');
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ====== 统计 ======
app.get('/api/stats', async (req, res) => {
  try {
    const result = await callCloudFunction('getStats', { actorRole: req.admin.role, actorClasses: req.admin.classes || [] });
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.get('/api/stats/detail', async (req, res) => {
  try {
    const result = await callCloudFunction('getStats', { actorRole: req.admin.role, actorClasses: req.admin.classes || [] });
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ====== 导出/下载 ======
app.get('/api/export/students', async (req, res) => {
  try {
    const result = await callCloudFunction('getStudents', { actorRole: req.admin.role, actorClasses: req.admin.classes || [] });
    if (!result.success) return res.status(500).send('导出失败');
    const data = [['姓名', '联系电话', '身份证', '公司', '班级名称', '上课时间段', '课程开始日期', '课程结束日期', '上课截止时间', '上课地点']];
    result.data.forEach(s => data.push([s.name, s.phone, s.idCard || '', s.company || '', s.className, s.schedule, s.courseStartDate || '', s.courseEndDate || '', s.deadline, s.location]));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 10 }, { wch: 15 }, { wch: 22 }, { wch: 25 }, { wch: 20 }, { wch: 40 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, '学员信息');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename=students.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/api/template/download', (req, res) => {
  const data = [
    ['姓名', '联系电话', '身份证号码', '公司名称', '班级名称', '上课时间段', '课程开始日期', '课程结束日期', '上课截止时间', '上课地点'],
    ['张三', '13800138001', '330102199001011234', '杭州科技有限公司', '计算机基础班', '周一上午 9:00-11:00', '2026-09-01', '2026-12-31', '2026-12-31', '教学楼301教室'],
    ['李四', '13800138002', '330102199505052345', '浙江信息工程有限公司', '会计实务班', '周三下午 14:00-16:00, 周五上午 9:00-11:00', '2026-09-01', '2026-12-31', '2026-12-31', '实训楼205教室'],
    ['王五', '13800138003', '330102198808083456', '杭州教育发展有限公司', '英语提高班', '周二晚上 18:30-20:30, 周四晚上 18:30-20:30', '2026-09-01', '2026-12-31', '2026-12-31', '外语楼102教室']
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 10 }, { wch: 15 }, { wch: 22 }, { wch: 25 }, { wch: 20 }, { wch: 40 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws, '学员信息');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''%E5%AD%A6%E5%91%98%E4%BF%A1%E6%81%AF%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx");
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ====== 温馨提示 ======
// 管理员导入模板（姓名 / 电话 / 负责班级）
app.get('/api/template/admins', (req, res) => {
  const data = [
    ['姓名', '电话', '负责班级'],
    ['张三', '13800138001', '计算机基础班,会计实务班'],
    ['李四', '13800138002', '英语提高班']
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, ws, '管理员');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename=admins.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

app.get('/api/tips', async (req, res) => {
  try {
    const result = await callCloudFunction('getAllTips');
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.post('/api/tips', async (req, res) => {
  try {
    const result = await callCloudFunction('updateTip', { data: req.body });
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.delete('/api/tips/:id', async (req, res) => {
  try {
    const result = await callCloudFunction('deleteTip', { data: { id: req.params.id } });
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ====== 班级列表 ======
app.get('/api/classes', async (req, res) => {
  try {
    const result = await callCloudFunction('getClasses', { actorRole: req.admin.role, actorClasses: req.admin.classes || [] });
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

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
