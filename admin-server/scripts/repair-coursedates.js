// 一次性数据修复：按 schedule+课程起止日期重算所有学员 courseDates（修复多时段只存首段的历史问题）
// 前提：adminApi 已包含 repairCourseDates action 并「上传并部署」，config.json 配好 appId/appSecret/adminApiSecret
// 用法：node scripts/repair-coursedates.js
// 说明：幂等，可重复执行（已一致的学员不会被改动）
const fs = require('fs');
const path = require('path');
const https = require('https');

const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  if (!config.appId || !config.appSecret) throw new Error('config.json 缺少 appId/appSecret');
  if (!config.adminApiSecret) throw new Error('config.json 缺少 adminApiSecret');

  const tok = await httpGet(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${config.appId}&secret=${config.appSecret}`);
  if (!tok.access_token) throw new Error('获取 access_token 失败: ' + JSON.stringify(tok));

  const body = JSON.stringify({ action: 'repairCourseDates', secret: config.adminApiSecret });
  const res = await httpPost(`https://api.weixin.qq.com/tcb/invokecloudfunction?access_token=${tok.access_token}&env=${config.env}&name=adminApi`, body);

  const raw = res.resp_data || res.response;
  if (!raw) throw new Error('云函数返回异常: ' + JSON.stringify(res));
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!parsed.success) throw new Error('repairCourseDates 失败: ' + (parsed.message || JSON.stringify(parsed)));

  console.log(parsed.message);
  console.log(JSON.stringify(parsed.data));
}

main().catch(e => { console.error('修复失败:', e.message); process.exit(1); });
