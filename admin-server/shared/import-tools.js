// 学生导入工具单源（R3 收敛，评审优化项）：表头映射 / 取值 / 字符串化 / Excel 日期解析 / 日期格式化。
// 形态（硬要求① 双形态挂载）：
//   - Node：server.js 与 adminApi 云函数 require('./shared/import-tools')（adminApi 侧为 sync-shared.js 复制的副本）
//   - 浏览器：global HgdImportTools（R4 course-dates 经依赖注入使用；index.html 中本文件必须先于 course-dates 加载）
// 权威源 = 本文件；adminApi 副本由 scripts/sync-shared.js 复制，scripts/check-excel-aliases.js 比对逐字节并跑行为自检。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.HgdImportTools = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {

// 表头→字段映射：先精确命中别名，再按“最长别名包含”兑底（本文件为单源，副本逐字节一致性由 check-excel-aliases.js 守卫）
function detectFieldMapping(headers) {
  const map = {};
  const aliases = {
    name: ['姓名', '名字', 'name', '学员姓名', '学生姓名'],
    phone: ['联系电话', '手机号', '手机', '电话', 'phone', '手机号码', '联系手机'],
    idCard: ['身份证号码', '身份证', '身份证号', '身份证件号码', '证件号', 'idCard'],
    company: ['公司名称', '公司', '单位', 'company', '所属公司', '工作单位'],
    className: ['班级名称', '班级', '课程名称', '课程', 'className', '班名'],
    schedule: ['上课时间段', '上课时间', '时间', 'schedule', '时间段', '课程时间'],
    courseStartDate: ['课程开始日期', '开始日期', '课程开始', 'courseStartDate'],
    courseEndDate: ['课程结束日期', '结束日期', '课程结束', 'courseEndDate'],
    deadline: ['上课截止时间', '截止时间', '截止日期', '结束时间', '到期时间', 'deadline', '截止'],
    location: ['上课地点', '地点', '教室', 'location', '校区', '上课教室']
  };
  const fields = Object.keys(aliases);
  const raw = headers.map(h => (h === undefined || h === null) ? '' : h);
  const clean = raw.map(h => String(h).trim());
  // 1) 精确命中：每个表头最多认领一个字段
  clean.forEach((h, i) => {
    if (!h) return;
    for (const f of fields) {
      if (!map[f] && aliases[f].indexOf(h) > -1) { map[f] = raw[i]; return; }
    }
  });
  // 2) 包含兑底：剩余表头按最长别名命中优先，避免短别名抢走更贴切的字段
  const candidates = [];
  clean.forEach((h, i) => {
    if (!h) return;
    for (const f of fields) {
      if (map[f]) continue;
      let best = '';
      for (const n of aliases[f]) {
        if (h.indexOf(n) > -1 && n.length > best.length) best = n;
      }
      if (best) candidates.push({ i: i, f: f, len: best.length });
    }
  });
  candidates.sort((a, b) => b.len - a.len || a.i - b.i);
  const used = {};
  for (const f of fields) { if (map[f] !== undefined) used[map[f]] = true; }
  for (const c of candidates) {
    const hdr = raw[c.i];
    if (map[c.f] !== undefined || used[hdr]) continue;
    map[c.f] = hdr;
    used[hdr] = true;
  }
  return map;
}

// 按映射表头取值：字符串去空白，数字原样保留（Excel 日期序列号依赖数字）
function getField(row, fieldMap, field) {
  const key = fieldMap[field];
  if (key === undefined || key === null) return '';
  const v = row[key];
  if (v === undefined || v === null) return '';
  return typeof v === 'string' ? v.trim() : v;
}

// 文本字段统一转字符串（电话等数字单元格导入时走这里）
const asStr = v => (v === undefined || v === null ? '' : String(v).trim());

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

return { detectFieldMapping: detectFieldMapping, getField: getField, asStr: asStr, parseExcelDate: parseExcelDate, formatDateStr: formatDateStr };
});
