const express = require('express');
const XLSX = require('xlsx');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

// 读取配置
const configPath = path.join(__dirname, 'config.json');
let config = { env: 'cloud1-d6gio7v8iff39bab7', secretId: '', secretKey: '', appId: '', appSecret: '' };
if (fs.existsSync(configPath)) {
  config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: 'uploads/' });
if (!fs.existsSync(path.join(__dirname, 'uploads'))) fs.mkdirSync(path.join(__dirname, 'uploads'));

// ====== 本地管理员数据 ======
const adminsPath = path.join(__dirname, 'admins.json');
function loadAdmins() {
  if (fs.existsSync(adminsPath)) return JSON.parse(fs.readFileSync(adminsPath, 'utf8'));
  const defaults = [{ id: 'admin-default', name: '系统管理员', phone: 'admin', password: 'admin123', role: 'superadmin', createdAt: new Date().toISOString() }];
  fs.writeFileSync(adminsPath, JSON.stringify(defaults, null, 2), 'utf8');
  return defaults;
}
function saveAdmins(admins) {
  fs.writeFileSync(adminsPath, JSON.stringify(admins, null, 2), 'utf8');
}
loadAdmins();

// ====== 云函数调用封装 ======
let accessToken = '';
let tokenExpiry = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;
  if (!config.appId || !config.appSecret) {
    throw new Error('请在 config.json 中配置 appId 和 appSecret');
  }
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${config.appId}&secret=${config.appSecret}`;
  const result = await httpGet(url);
  if (result.access_token) {
    accessToken = result.access_token;
    tokenExpiry = Date.now() + (result.expires_in - 60) * 1000;
    return accessToken;
  }
  throw new Error('获取 access_token 失败: ' + JSON.stringify(result));
}

async function callCloudFunction(action, params = {}) {
  const token = await getAccessToken();
  const url = `https://api.weixin.qq.com/tcb/invokecloudfunction?access_token=${token}&env=${config.env}&name=adminApi`;
  const body = JSON.stringify({ action, ...params });
  const result = await httpPost(url, body);
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

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
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
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ====== 管理员登录 ======
app.post('/api/admin/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.json({ success: false, message: '请输入账号和密码' });
  const admins = loadAdmins();
  const admin = admins.find(a => a.phone === phone && a.password === password);
  if (admin) return res.json({ success: true, data: { name: admin.name, phone: admin.phone, role: admin.role } });
  res.json({ success: false, message: '账号或密码错误' });
});

// ====== 管理员管理 ======
app.get('/api/admins', (req, res) => {
  const admins = loadAdmins().map(({ password, ...rest }) => rest);
  res.json({ success: true, data: admins });
});

app.post('/api/admins', (req, res) => {
  const { name, phone, password, role } = req.body;
  if (!name || !phone || !password) return res.json({ success: false, message: '请填写所有字段' });
  const admins = loadAdmins();
  if (admins.find(a => a.phone === phone)) return res.json({ success: false, message: '该账号已存在' });
  admins.push({ id: 'admin-' + Date.now(), name, phone, password, role: role || 'admin', createdAt: new Date().toISOString() });
  saveAdmins(admins);
  res.json({ success: true, message: '添加成功' });
});

app.put('/api/admins/:id', (req, res) => {
  const admins = loadAdmins();
  const idx = admins.findIndex(a => a.id === req.params.id);
  if (idx < 0) return res.json({ success: false, message: '管理员不存在' });
  const { name, phone, password, role } = req.body;
  admins[idx].name = name || admins[idx].name;
  admins[idx].phone = phone || admins[idx].phone;
  if (password) admins[idx].password = password;
  if (role) admins[idx].role = role;
  saveAdmins(admins);
  res.json({ success: true, message: '更新成功' });
});

app.delete('/api/admins/:id', (req, res) => {
  const admins = loadAdmins();
  const target = admins.find(a => a.id === req.params.id);
  if (target && target.phone === 'admin') return res.json({ success: false, message: '不能删除默认管理员' });
  // 检查是否删除自己
  const loginPhone = req.headers['x-admin-phone'];
  if (target && target.phone === loginPhone) return res.json({ success: false, message: '不能删除自己的账号' });
  const filtered = admins.filter(a => a.id !== req.params.id);
  if (filtered.length === admins.length) return res.json({ success: false, message: '管理员不存在' });
  saveAdmins(filtered);
  res.json({ success: true, message: '删除成功' });
});

app.post('/api/admins/init', async (req, res) => {
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
    const result = await callCloudFunction('getStudents', { keyword: req.query.keyword });
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

        // 自动生成 courseDates
        const courseDates = generateCourseDates(schedule, courseStartDate, courseEndDate);

        // 确保日期字段为字符串格式
        const startD = parseExcelDate(courseStartDate);
        const endD = parseExcelDate(courseEndDate);
        const startStr = formatDateStr(startD) || String(courseStartDate || '');
        const endStr = formatDateStr(endD) || String(courseEndDate || '');

        const studentData = { name, phone, className, schedule, deadline: endStr || '', location, courseDates, courseStartDate: startStr, courseEndDate: endStr };
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
  }
});

function detectFieldMapping(headers) {
  const map = {};
  const aliases = {
    name: ['姓名', '名字', 'name', '学员姓名', '学生姓名'],
    phone: ['联系电话', '手机号', '手机', '电话', 'phone', '手机号码', '联系手机'],
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

// 根据上课时间段+开始结束日期，自动生成具体上课日期
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

// 根据上课时间段+日期范围生成 courseDates（用于小程序端）
function generateCourseDatesFromSchedule(schedule, startDate, endDate) {
  return generateCourseDates(schedule, startDate, endDate);
}

// ====== 入校申请 ======
app.get('/api/requests', async (req, res) => {
  try {
    const result = await callCloudFunction('getRequests', { status: req.query.status });
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
    const result = await callCloudFunction('getStats');
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

app.get('/api/stats/detail', async (req, res) => {
  try {
    const result = await callCloudFunction('getStats');
    res.json(result);
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// ====== 导出/下载 ======
app.get('/api/export/students', async (req, res) => {
  try {
    const result = await callCloudFunction('getStudents');
    if (!result.success) return res.status(500).send('导出失败');
    const data = [['姓名', '联系电话', '班级名称', '上课时间段', '课程开始日期', '课程结束日期', '上课截止时间', '上课地点']];
    result.data.forEach(s => data.push([s.name, s.phone, s.className, s.schedule, s.courseStartDate || '', s.courseEndDate || '', s.deadline, s.location]));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 10 }, { wch: 15 }, { wch: 20 }, { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 20 }];
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
    ['姓名', '联系电话', '班级名称', '上课时间段', '课程开始日期', '课程结束日期', '上课截止时间', '上课地点'],
    ['张三', '13800138001', '计算机基础班', '周一上午 9:00-11:00', '2026-09-01', '2026-12-31', '2026-12-31', '教学楼301教室'],
    ['李四', '13800138002', '会计实务班', '周三下午 14:00-16:00', '2026-09-01', '2026-12-31', '2026-12-31', '实训楼205教室'],
    ['王五', '13800138003', '英语提高班', '周五晚上 18:30-20:30', '2026-09-01', '2026-12-31', '2026-12-31', '外语楼102教室']
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 10 }, { wch: 15 }, { wch: 20 }, { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws, '学员信息');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''%E5%AD%A6%E5%91%98%E4%BF%A1%E6%81%AF%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx");
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
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
  console.log('  默认管理员: admin / admin123');
  console.log('');
  console.log('==========================================');

  // 初始化默认管理员
  try {
    await callCloudFunction('initDefaultAdmin');
    console.log('  ✅ 默认管理员初始化完成');
  } catch (e) {
    console.log('  ⚠️ 默认管理员初始化失败（首次需配置 appId/appSecret）:', e.message);
  }
});
