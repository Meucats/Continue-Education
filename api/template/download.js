const XLSX = require('xlsx');
const { options } = require('../_lib/cloud');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
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
};
