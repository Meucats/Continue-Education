const XLSX = require('xlsx');
const { callCloudFunction, json, options, parseExcelDate, formatDateStr, generateCourseDates, detectFieldMapping, getField } = require('../_lib/cloud');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return options(res);

  const url = new URL(req.url, 'http://localhost');
  const slug = url.searchParams.get('path') || '';
  const parts = slug.split('/').filter(Boolean);
  let action = parts[0] || '';
  const id = parts[1] || '';
  const sub = parts[2] || '';

  if (action === 'admins') action = 'admin';

  try {
    switch (action) {

      case 'admin':
        if (id === 'login') {
          if (req.method !== 'POST') return json(res, { success: false, message: 'Method not allowed' }, 405);
          const { phone, password } = req.body;
          if (!phone || !password) return json(res, { success: false, message: '请输入账号和密码' });
          try {
            const result = await callCloudFunction('loginAdmin', { data: { phone, password } });
            if (result.success) return json(res, result);
          } catch (e) {}
          if (phone === 'admin' && password === 'admin123') {
            return json(res, { success: true, data: { name: '系统管理员', phone: 'admin', role: 'superadmin' } });
          }
          return json(res, { success: false, message: '账号或密码错误' });
        }
        if (id && id !== 'login') {
          if (req.method === 'PUT') {
            const result = await callCloudFunction('updateAdmin', { data: { _id: id, ...req.body } });
            return json(res, result);
          }
          if (req.method === 'DELETE') {
            const target = (await callCloudFunction('getAdmins')).data?.find(a => a.id === id || a._id === id);
            if (target && target.phone === 'admin') return json(res, { success: false, message: '不能删除默认管理员' });
            const loginPhone = req.headers['x-admin-phone'];
            if (target && target.phone === loginPhone) return json(res, { success: false, message: '不能删除自己的账号' });
            const result = await callCloudFunction('deleteAdmin', { id });
            return json(res, result);
          }
          return json(res, { success: false, message: 'Method not allowed' }, 405);
        }
        if (req.method === 'GET') {
          try {
            const result = await callCloudFunction('getAdmins');
            return json(res, result);
          } catch (e) {
            return json(res, { success: true, data: [{ id: 'admin-default', name: '系统管理员', phone: 'admin', role: 'superadmin', createdAt: '' }] });
          }
        }
        if (req.method === 'POST') {
          const result = await callCloudFunction('addAdmin', { data: req.body });
          return json(res, result);
        }
        return json(res, { success: false, message: 'Method not allowed' }, 405);

      case 'students':
        if (id === 'batch-delete') {
          if (req.method !== 'POST') return json(res, { success: false, message: 'Method not allowed' }, 405);
          const result = await callCloudFunction('batchDeleteStudents', { data: req.body });
          return json(res, result);
        }
        if (id) {
          if (req.method === 'PUT') {
            const result = await callCloudFunction('updateStudent', { data: { _id: id, ...req.body } });
            return json(res, result);
          }
          if (req.method === 'DELETE') {
            const result = await callCloudFunction('deleteStudent', { id });
            return json(res, result);
          }
          return json(res, { success: false, message: 'Method not allowed' }, 405);
        }
        if (req.method === 'GET') {
          const result = await callCloudFunction('getStudents', { keyword: req.query.keyword });
          return json(res, result);
        }
        if (req.method === 'POST') {
          const result = await callCloudFunction('addStudent', { data: req.body });
          return json(res, result);
        }
        return json(res, { success: false, message: 'Method not allowed' }, 405);

      case 'requests':
        if (id && sub === 'approve') {
          if (req.method !== 'POST') return json(res, { success: false, message: 'Method not allowed' }, 405);
          const result = await callCloudFunction('approveRequest', { id });
          return json(res, result);
        }
        if (id && sub === 'reject') {
          if (req.method !== 'POST') return json(res, { success: false, message: 'Method not allowed' }, 405);
          const result = await callCloudFunction('rejectRequest', { id, reason: req.body.reason });
          return json(res, result);
        }
        if (req.method === 'GET') {
          const result = await callCloudFunction('getRequests', { status: req.query.status });
          return json(res, result);
        }
        if (req.method === 'POST') {
          const result = await callCloudFunction('addRequest', { data: req.body });
          return json(res, result);
        }
        return json(res, { success: false, message: 'Method not allowed' }, 405);

      case 'accounts':
        if (id === 'sync') {
          if (req.method !== 'POST') return json(res, { success: false, message: 'Method not allowed' }, 405);
          const result = await callCloudFunction('syncAccounts');
          return json(res, result);
        }
        if (req.method === 'GET') {
          const result = await callCloudFunction('getAccounts');
          return json(res, result);
        }
        return json(res, { success: false, message: 'Method not allowed' }, 405);

      case 'stats':
        if (req.method === 'GET') {
          const result = await callCloudFunction('getStats');
          return json(res, result);
        }
        return json(res, { success: false, message: 'Method not allowed' }, 405);

      case 'import':
        if (req.method !== 'POST') return json(res, { success: false, message: 'Method not allowed' }, 405);
        return handleImport(req, res);

      case 'template':
        if (req.method === 'GET') return handleTemplate(req, res);
        return json(res, { success: false, message: 'Method not allowed' }, 405);

      case 'export':
        if (req.method === 'GET') return handleExport(req, res);
        return json(res, { success: false, message: 'Method not allowed' }, 405);

      default:
        return json(res, { success: false, message: 'Not found' }, 404);
    }
  } catch (err) {
    return json(res, { success: false, message: err.message }, 500);
  }
};

async function handleImport(req, res) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return json(res, { success: false, message: '请上传Excel文件' }, 400);
  }

  const busboy = require('busboy');
  const bb = busboy({ headers: req.headers });
  const fileChunks = [];
  let jsonData = [];
  let headers = [];

  await new Promise((resolve, reject) => {
    bb.on('file', (name, file, info) => {
      file.on('data', chunk => fileChunks.push(chunk));
      file.on('end', () => {
        const buffer = Buffer.concat(fileChunks);
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        jsonData = XLSX.utils.sheet_to_json(worksheet);
        headers = XLSX.utils.sheet_to_json(worksheet, { header: 1 })[0] || [];
      });
    });
    bb.on('finish', resolve);
    bb.on('error', reject);
    req.pipe(bb);
  });

  if (jsonData.length === 0) {
    return json(res, { success: false, message: '文件内容为空' });
  }

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

      const courseDates = generateCourseDates(schedule, courseStartDate, courseEndDate);
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

  return json(res, { success: true, data: { total: jsonData.length, added, updated, failed, errors } });
}

function handleTemplate(req, res) {
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''%E5%AD%A6%E5%91%98%E4%BF%A1%E6%81%AF%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx");
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
}

async function handleExport(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const result = await callCloudFunction('getStudents');
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
}
