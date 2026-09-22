const XLSX = require('xlsx');
const { json, options, callCloudFunction, generateCourseDates, detectFieldMapping, getField, parseExcelDate, formatDateStr } = require('../_lib/cloud');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return options(res);
  if (req.method !== 'POST') return json(res, { success: false, message: 'Method not allowed' }, 405);
  try {
    // Vercel parses multipart form data with body-parser
    // The file is sent as multipart/form-data by the browser
    const contentType = req.headers['content-type'] || '';

    let jsonData = [];
    let headers = [];

    if (contentType.includes('multipart/form-data')) {
      // For Vercel, we need to handle multipart differently
      // Use busboy or parse manually
      const busboy = require('busboy');
      const bb = busboy({ headers: req.headers });
      const fileChunks = [];

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
    } else {
      return json(res, { success: false, message: '请上传Excel文件' }, 400);
    }

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

    json(res, { success: true, data: { total: jsonData.length, added, updated, failed, errors } });
  } catch (err) {
    json(res, { success: false, message: err.message }, 500);
  }
};
