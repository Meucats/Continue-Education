# Cloudflare Workers 部署指南（免费）

## 一键部署（推荐）
在仓库根目录 PowerShell 执行：

```powershell
powershell -ExecutionPolicy Bypass -File "G:\杭职大继教院进校系统1\webadmin\cloudflare\deploy.ps1"
```

会依次：安装依赖 → `wrangler login` 浏览器授权 → 创建 KV → 提示填入 `wrangler.toml` → 设置 `WX_APP_SECRET` → `wrangler deploy`。

完整说明见仓库根目录 [`部署指南.md`](../../部署指南.md)。

## 手动步骤
1. 注册 Cloudflare：https://dash.cloudflare.com
2. `npm install`
3. `npx wrangler login`
4. `npx wrangler kv namespace create ADMIN_KV` → 把 `id` 填入 `wrangler.toml`
5. `npx wrangler secret put WX_APP_SECRET`（微信 AppSecret）
6. `npx wrangler deploy`
7. 访问 `https://hgd-edu-admin.xxx.workers.dev`

## 更新部署
```powershell
cd webadmin/cloudflare
npx wrangler deploy
```

## 免费额度
- 每天 100,000 次请求
- 每次 10ms CPU 时间
- 免费 SSL、无限带宽

## 注意事项
- Excel 导入由前端 SheetJS 解析后发 JSON 给 Worker
- 导出为 CSV（非 xlsx）
- 管理员数据在 KV（首次登录自动创建 admin/admin123）
- AppSecret 只存在 Worker Secret，不写进代码仓库
