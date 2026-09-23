# Cloudflare Workers 部署指南（免费）

## 前置准备
1. 注册 Cloudflare 账号：https://dash.cloudflare.com
2. 安装 Node.js（https://nodejs.org）

## 部署步骤

### 1. 安装依赖
```bash
cd cloudflare
npm install
```

### 2. 登录 Cloudflare
```bash
npx wrangler login
```

### 3. 创建 KV 命名空间
```bash
npx wrangler kv namespace create ADMIN_KV
```
复制返回的 `id`，填入 `wrangler.toml` 的 `id` 字段。

### 4. 设置密钥
```bash
npx wrangler secret put WX_APP_SECRET
```
输入你的微信小程序 AppSecret（mp.weixin.qq.com → 开发 → 开发设置）

### 5. 部署
```bash
npx wrangler deploy
```

### 6. 访问
部署后会得到一个 URL，如：`https://hgd-edu-admin.xxx.workers.dev`

## 免费额度
- 每天 100,000 次请求
- 每次 10ms CPU 时间
- 免费 SSL
- 无限带宽

## 注意事项
- 导入功能需要前端解析 Excel（用 SheetJS CDN），然后发 JSON 给 Worker
- 导出为 CSV 格式（不是 Excel）
- 管理员数据存在 KV 中（首次登录自动创建 admin/admin123）
