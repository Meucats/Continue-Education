// 一次性迁移工具：从微信云函数全量导出 6 集合（不含 sessions）
// 前提：adminApi 已包含 exportAll action 并「上传并部署」，config.json 配好 appId/appSecret/adminApiSecret
// 用法：node scripts/export-cloud.js
// 产出：scripts/out/cloud-export-<时间戳>.json
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

  const body = JSON.stringify({ action: 'exportAll', secret: config.adminApiSecret });
  const res = await httpPost(`https://api.weixin.qq.com/tcb/invokecloudfunction?access_token=${tok.access_token}&env=${config.env}&name=adminApi`, body);

  const raw = res.resp_data || res.response;
  if (!raw) throw new Error('云函数返回异常: ' + JSON.stringify(res));
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!parsed.success) throw new Error('exportAll 失败: ' + (parsed.message || JSON.stringify(parsed)));

  const outDir = path.join(__dirname, 'out');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `cloud-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outFile, JSON.stringify(parsed.data, null, 2), 'utf8');

  const d = parsed.data || {};
  console.log('导出成功: ' + outFile);
  for (const k of ['students', 'admins', 'entry_requests', 'users', 'tips']) {
    console.log(`  ${k}: ${(d[k] || []).length} 条`);
  }
}

main().catch(e => { console.error('导出失败:', e.message); process.exit(1); });
