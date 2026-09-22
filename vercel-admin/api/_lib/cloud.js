const https = require('https');

const config = {
  env: process.env.WX_ENV || 'cloud1-d6gio7v8iff39bab7',
  appId: process.env.WX_APPID || '',
  appSecret: process.env.WX_APPSECRET || ''
};

let accessToken = '';
let tokenExpiry = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;
  if (!config.appId || !config.appSecret) {
    throw new Error('请在 Vercel 环境变量中配置 WX_APPID 和 WX_APPSECRET');
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

function json(res, data, status = 200) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Phone');
  res.status(status).json(data);
}

function options(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Phone');
  res.status(200).end();
}

// ====== Excel helpers ======
function parseExcelDate(val) {
  if (!val) return null;
  if (typeof val === 'number') return new Date((val - 25569) * 86400 * 1000);
  const s = String(val).trim();
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(s)) return new Date(s.replace(/-/g, '/'));
  return null;
}

function formatDateStr(d) {
  if (!d || isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

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
  while (d.getDay() !== targetDay && d <= end) d.setDate(d.getDate() + 1);
  while (d <= end) {
    dates.push({ date: formatDateStr(d), timeSlot });
    d.setDate(d.getDate() + 7);
  }
  return dates;
}

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

module.exports = {
  config, callCloudFunction, httpGet, httpPost,
  json, options, parseExcelDate, formatDateStr,
  generateCourseDates, detectFieldMapping, getField
};
