const XLSX = require('xlsx');
const { options, callCloudFunction } = require('../../_lib/cloud');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
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
};
