# Web 管理后台（webadmin）

进校系统的 Web 管理端（Node + Express），不直接读写数据库，全部通过云函数 `adminApi` 完成登录与数据操作：

| 目录 | 形态 | 说明 |
|------|------|------|
| `admin-server/` | Node + Express | 腾讯云服务器 / 本机 / 局域网主用，`pm2` 常驻 |

## 统一鉴权模型（与小程序一致）

1. 服务端调用云函数时携带 `secret`，云函数校验它与环境变量 `ADMIN_API_SECRET` 是否一致；**未配置则全部失败（fail-closed）**。
2. 浏览器侧不保存任何密码，只保存云函数签发的 **7 天随机 token**（`sessions` 集合），改密后全部撤销。
3. 管理员密码在库里是 **scrypt 加盐哈希**（`scrypt$salt$hash`），登录时自动把旧明文数据重哈希。
4. 登录限速：同账号 10 分钟内失败 5 次 → 锁 10 分钟。
5. 首次登录 `admin/admin123` 会被**强制修改密码**（不可跳过，只能退出登录）。
6. 超级管理员才能增删管理员、导入管理员账号；普通管理员只能看被分配的班级。

两处 `ADMIN_API_SECRET` 必须完全一致：

- 云函数 `adminApi` → 环境变量 `ADMIN_API_SECRET`
- admin-server → `config.json` 的 `adminApiSecret`

## admin-server（腾讯云 / 本机）

```powershell
cd webadmin/admin-server
copy config.example.json config.json   # 填 appSecret 与 adminApiSecret
npm install
node server.js                          # 或 start.ps1 / 启动管理后台.bat
```

上线用 `pm2 start server.js --name admin-api`。浏览器打开 `http://IP:3000`。

- 接口前缀 `/api`（前端相对路径，本机与云上通用）
- 登录签发本地 HMAC token（含角色、`iat`），改密后旧 token 立即失效
- 上传用 `multer` 存 `uploads/`，临时文件用完即删；`data/`、`uploads/`、`config.json`、`.token-secret` 均在 `.gitignore` 中

完整步骤见根目录 [`部署指南.md`](../部署指南.md) 与 [`腾讯云部署教程.md`](../腾讯云部署教程.md)。

## 功能清单

仪表盘统计、学员管理（增删改查/重置密码/批量删除/Excel 导入导出）、入校申请审批、账户管理（学员账号同步）、班级管理、管理员账号（超管，含重置密码）、登录日志、温馨提示（按班级）。

导出与模板下载走带 `Authorization` 的 blob 下载；表格中的姓名、身份证等用户输入在渲染时统一转义（XSS 防护）；身份证完整号码仅超管后台可见，小程序学生端显示时脱敏。

## 常见问题

| 现象 | 处理 |
|------|------|
| 登录提示「云函数调用失败」 | `ADMIN_API_SECRET` 是否一致；云函数是否已上传 |
| 部署后打开是旧页面 | 服务器 `pm2 restart admin-api` |
| 端口 3000 被占用 | 改 `server.js` 末尾 `PORT`，安全组同步放行 |
| 忘记管理员密码 | 超管在「管理员管理」点重置（新密码=账号本身，对方首登需改）；库中无超管时用初始账号 `admin/admin123`（仅当 `admins` 集合为空时可用，登录后强制改密） |
