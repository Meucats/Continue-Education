const cloud = require('wx-server-sdk');
const xlsx = require('xlsx');

cloud.init({ env: 'cloud1-d6gio7v8iff39bab7' });

exports.main = async (event, context) => {
  try {
    // 创建工作簿
    const wb = xlsx.utils.book_new();

    // 模板数据（支持逗号分隔的多时间段）
    const data = [
      ['姓名', '联系电话', '身份证号码', '公司名称', '班级名称', '上课时间段', '课程开始日期', '课程结束日期', '上课截止时间', '上课地点'],
      ['张三', '13800138001', '330102199001011234', '杭州科技有限公司', '计算机基础班', '周一上午 9:00-11:00', '2026-09-01', '2026-12-31', '2026-12-31', '教学楼301教室'],
      ['李四', '13800138002', '330102199505052345', '浙江信息工程有限公司', '会计实务班', '周三下午 14:00-16:00, 周五上午 9:00-11:00', '2026-09-01', '2026-12-31', '2026-12-31', '实训楼205教室'],
      ['王五', '13800138003', '330102198808083456', '杭州教育发展有限公司', '英语提高班', '周二晚上 18:30-20:30, 周四晚上 18:30-20:30', '2026-09-01', '2026-12-31', '2026-12-31', '外语楼102教室']
    ];

    // 创建工作表
    const ws = xlsx.utils.aoa_to_sheet(data);

    // 设置列宽
    ws['!cols'] = [
      { wch: 10 },  // 姓名
      { wch: 15 },  // 联系电话
      { wch: 22 },  // 身份证号码
      { wch: 25 },  // 公司名称
      { wch: 20 },  // 班级名称
      { wch: 40 },  // 上课时间段
      { wch: 15 },  // 课程开始日期
      { wch: 15 },  // 课程结束日期
      { wch: 15 },  // 上课截止时间
      { wch: 20 }   // 上课地点
    ];

    // 添加工作表到工作簿
    xlsx.utils.book_append_sheet(wb, ws, '学员信息');

    // 生成Excel文件 buffer
    const xlsxBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // 上传到云存储
    const timestamp = Date.now();
    const cloudPath = `templates/学员信息导入模板_${timestamp}.xlsx`;

    const uploadResult = await cloud.uploadFile({
      cloudPath: cloudPath,
      fileContent: xlsxBuffer
    });

    return {
      success: true,
      fileID: uploadResult.fileID
    };

  } catch (err) {
    console.error('生成模板失败', err);
    return {
      success: false,
      message: err.message
    };
  }
};
