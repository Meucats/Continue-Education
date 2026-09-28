# Cloudflare Workers 部署指南（免费）

## 一键部署（推荐）
在仓库根目录 PowerShell 执行：

```powershell
powershell -ExecutionPolicy Bypass -File "G:\杭职大继教院进校系统1\webadmin\cloudflare\deploy.ps1"
```

会依次：安装依赖 → `wrangler login` 浏览器授权 → 创建 KV → 提示填入 `wrangler.toml` → 设置 `WX_APP_SECRET` → 设置 `ADMIN_API_SECRET` → `wrangler deploy`。

完整说明见仓库根目录 [`部署指南.md`](../../部署指南.md)。

## 手动步骤
1. 注册 Cloudflare：https://dash.cloudflare.com
2. `npm install`
3. `npx wrangler login`
4. `npx wrangler kv namespace create ADMIN_KV` → 把 `id` 填入 `wrangler.toml`
5. `npx wrangler secret put WX_APP_SECRET`（微信 AppSecret）
6. `npx wrangler secret put ADMIN_API_SECRET`（服务端调用共享密钥，必须与云函数 `adminApi` 环境变量 `ADMIN_API_SECRET`、admin-server `config.json` 的 `adminApiSecret` 完全一致）
7. `npx wrangler deploy`
8. 访问 `https://hgd-edu-admin.xxx.workers.dev`

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
- 管理员账号在微信云数据库 `admins` 集合（scrypt 哈希存储）；`admins` 为空时用 `admin/admin123` 登录会自动创建并强制改密
- `sessions` 集合保存 7 天登录会话，改密后全部撤销
- AppSecret 与 `ADMIN_API_SECRET` 只存在 Worker Secret，不写进代码仓库
