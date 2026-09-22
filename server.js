const express = require('express');
const path = require('path');
const XLSX = require('xlsx');
const { callCloudFunction, parseExcelDate, formatDateStr, generateCourseDates, detectFieldMapping, getField } = require('./api/_lib/cloud');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Phone');
}

function json(res, data, status = 200) {
  cors(res);
  res.status(status).json(data);
}

app.options('/api/*', (req, res) => { cors(res); res.status(200).end(); });

app.all('/api/admin/login', async (req, res) => {
  if (req.method !== 'POST') return json(res, { success: false, message: 'Method not allowed' }, 405);
  try {
    const { phone, password } = req.body;
    if (!phone || !password) return json(res, { success: false, message: '请输入账号和密码' });
    try {
      const result = await callCloudFunction('loginAdmin', { data: { phone, password } });
      if (result.success) return json(res, result);
    } catch (e) {}
    if (phone === 'admin' && password === 'admin123') {
      return json(res, { success: true, data: { name: '系统管理员', phone: 'admin', role: 'superadmin' } });
    }
    json(res, { success: false, message: '账号或密码错误' });
  } catch (err) { json(res, { success: false, message: err.message }, 500); }
});

app.all('/api/admins', async (req, res) => {
  try {
    if (req.method === 'GET') {
      try { const r = await callCloudFunction('getAdmins'); return json(res, r); }
      catch (e) { return json(res, { success: true, data: [{ id: 'admin-default', name: '系统管理员', phone: 'admin', role: 'superadmin', createdAt: '' }] }); }
    }
    if (req.method === 'POST') { const r = await callCloudFunction('addAdmin', { data: req.body }); return json(res, r); }
    json(res, { success: false, message: 'Method not allowed' }, 405);
  } catch (err) { json(res, { success: false, message: err.message }, 500); }
});

app.all('/api/admins/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (req.method === 'PUT') { const r = await callCloudFunction('updateAdmin', { data: { _id: id, ...req.body } }); return json(res, r); }
    if (req.method === 'DELETE') {
      const target = (await callCloudFunction('getAdmins')).data?.find(a => a.id === id || a._id === id);
      if (target && target.phone === 'admin') return json(res, { success: false, message: '不能删除默认管理员' });
      const loginPhone = req.headers['x-admin-phone'];
      if (target && target.phone === loginPhone) return json(res, { success: false, message: '不能删除自己的账号' });
      const r = await callCloudFunction('deleteAdmin', { id }); return json(res, r);
    }
    json(res, { success: false, message: 'Method not allowed' }, 405);
  } catch (err) { json(res, { success: false, message: err.message }, 500); }
});

app.all('/api/students', async (req, res) => {
  try {
    if (req.method === 'GET') { const r = await callCloudFunction('getStudents', { keyword: req.query.keyword }); return json(res, r); }
    if (req.method === 'POST') { const r = await callCloudFunction('addStudent', { data: req.body }); return json(res, r); }
    json(res, { success: false, message: 'Method not allowed' }, 405);
  } catch (err) { json(res, { success: false, message: err.message }, 500); }
});

app.all('/api/students/batch-delete', async (req, res) => {
  if (req.method !== 'POST') return json(res, { success: false, message: 'Method not allowed' }, 405);
  try { const r = await callCloudFunction('batchDeleteStudents', { data: req.body }); json(res, r); }
  catch (err) { json(res, { success: false, message: err.message }, 500); }
});

app.all('/api/students/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (req.method === 'PUT') { const r = await callCloudFunction('updateStudent', { data: { _id: id, ...req.body } }); return json(res, r); }
    if (req.method === 'DELETE') { const r = await callCloudFunction('deleteStudent', { id }); return json(res, r); }
    json(res, { success: false, message: 'Method not allowed' }, 405);
  } catch (err) { json(res, { success: false, message: err.message }, 500); }
});

app.all('/api/requests', async (req, res) => {
  try {
    if (req.method === 'GET') { const r = await callCloudFunction('getRequests', { status: req.query.status }); return json(res, r); }
    if (req.method === 'POST') { const r = await callCloudFunction('addRequest', { data: req.body }); return json(res, r); }
    json(res, { success: false, message: 'Method not allowed' }, 405);
  } catch (err) { json(res, { success: false, message: err.message }, 500); }
});

app.all('/api/requests/:id/approve', async (req, res) => {
  if (req.method !== 'POST') return json(res, { success: false, message: 'Method not allowed' }, 405);
  try { const r = await callCloudFunction('approveRequest', { id: req.params.id }); json(res, r); }
  catch (err) { json(res, { success: false, message: err.message }, 500); }
});

app.all('/api/requests/:id/reject', async (req, res) => {
  if (req.method !== 'POST') return json(res, { success: false, message: 'Method not allowed' }, 405);
  try { const r = await callCloudFunction('rejectRequest', { id: req.params.id, reason: req.body.reason }); json(res, r); }
  catch (err) { json(res, { success: false, message: err.message }, 500); }
});

app.all('/api/accounts', async (req, res) => {
  try {
    if (req.method === 'GET') { const r = await callCloudFunction('getAccounts'); return json(res, r); }
    json(res, { success: false, message: 'Method not allowed' }, 405);
  } catch (err) { json(res, { success: false, message: err.message }, 500); }
});

app.all('/api/accounts/sync', async (req, res) => {
  if (req.method !== 'POST') return json(res, { success: false, message: 'Method not allowed' }, 405);
  try { const r = await callCloudFunction('syncAccounts'); json(res, r); }
  catch (err) { json(res, { success: false, message: err.message }, 500); }
});

app.all('/api/stats', async (req, res) => {
  try { const r = await callCloudFunction('getStats'); json(res, r); }
  catch (err) { json(res, { success: false, message: err.message }, 500); }
});

app.all('/api/stats/detail', async (req, res) => {
  try { const r = await callCloudFunction('getStats'); json(res, r); }
  catch (err) { json(res, { success: false, message: err.message }, 500); }
});

app.all('/api/import', async (req, res) => {
  if (req.method !== 'POST') return json(res, { success: false, message: 'Method not allowed' }, 405);
  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) return json(res, { success: false, message: '请上传Excel文件' }, 400);
    const busboy = require('busboy');
    const bb = busboy({ headers: req.headers });
    const fileChunks = [];
    let jsonData = [], headers = [];
    await new Promise((resolve, reject) => {
      bb.on('file', (name, file) => {
        file.on('data', chunk => fileChunks.push(chunk));
        file.on('end', () => {
          const buffer = Buffer.concat(fileChunks);
          const wb = XLSX.read(buffer, { type: 'buffer' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          jsonData = XLSX.utils.sheet_to_json(ws);
          headers = XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || [];
        });
      });
      bb.on('finish', resolve);
      bb.on('error', reject);
      req.pipe(bb);
    });
    if (jsonData.length === 0) return json(res, { success: false, message: '文件内容为空' });
    const fieldMap = detectFieldMapping(headers);
    let added = 0, updated = 0, failed = 0;
    const errors = [];
    for (let i = 0; i < jsonData.length; i++) {
      const row = jsonData[i], rowNum = i + 2;
      try {
        const name = getField(row, fieldMap, 'name');
        const phone = String(getField(row, fieldMap, 'phone') || '').trim();
        const className = getField(row, fieldMap, 'className');
        const schedule = getField(row, fieldMap, 'schedule');
        const courseStartDate = getField(row, fieldMap, 'courseStartDate');
        const courseEndDate = getField(row, fieldMap, 'courseEndDate');
        const location = getField(row, fieldMap, 'location');
        if (!name) { errors.push(`第${rowNum}行：姓名为空`); failed++; continue; }
        if (!phone || phone.length !== 11) { errors.push(`第${rowNum}行：手机号格式错误`); failed++; continue; }
        if (!className) { errors.push(`第${rowNum}行：班级名称为空`); failed++; continue; }
        if (!schedule) { errors.push(`第${rowNum}行：上课时间段为空`); failed++; continue; }
        if (!location) { errors.push(`第${rowNum}行：上课地点为空`); failed++; continue; }
        const courseDates = generateCourseDates(schedule, courseStartDate, courseEndDate);
        const startD = parseExcelDate(courseStartDate);
        const endD = parseExcelDate(courseEndDate);
        const startStr = formatDateStr(startD) || String(courseStartDate || '');
        const endStr = formatDateStr(endD) || String(courseEndDate || '');
        const studentData = { name, phone, className, schedule, deadline: endStr || '', location, courseDates, courseStartDate: startStr, courseEndDate: endStr };
        const result = await callCloudFunction('addStudent', { data: studentData });
        if (result.message && result.message.includes('更新')) updated++; else added++;
      } catch (err) { errors.push(`第${rowNum}行：${err.message}`); failed++; }
    }
    json(res, { success: true, data: { total: jsonData.length, added, updated, failed, errors } });
  } catch (err) { json(res, { success: false, message: err.message }, 500); }
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
  cors(res);
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''%E5%AD%A6%E5%91%98%E4%BF%A1%E6%81%AF%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx");
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

app.get('/api/export/students', async (req, res) => {
  cors(res);
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
  } catch (err) { res.status(500).send(err.message); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
