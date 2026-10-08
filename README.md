# 杭职大继续教育培训服务管理系统

面向杭州职业技术大学继续教育学院的进校培训服务管理系统，由三部分组成：

| 目录 | 内容 | 运行形态 |
|------|------|----------|
| `admin-server/` | Web 管理后台（Node + Express），全部数据操作经云函数 `adminApi` 完成 | 本机 / 局域网 / 云服务器常驻 |
| `wxminiprogram/` | 微信小程序（学员端 + 管理员端）与云函数 | 微信开发者工具 / 微信云开发 |
| `docs/` | 设计与界面留档（历史文档，非运行所需） | — |

另有 `wx小程序云空间的配置信息/`（本地目录，已入 `.gitignore`，不入库）：存放云空间配置说明与数据库导出 JSON，见其中 `云空间配置说明.md`。

## 管理后台快速启动

```powershell
cd admin-server
copy config.example.json config.json   # 填 appId / appSecret / adminApiSecret / env（见配置说明）
npm install
node server.js                          # 或 start.ps1 / 启动管理后台.bat
```

浏览器访问 `http://localhost:3000`。首次部署的默认种子账号逻辑见 `server.js` 启动横幅与 `adminApi` 的 `initDefaultAdmin`（首登强制改密），**部署后立即修改默认口令**。

云函数部署：在微信开发者工具中打开 `wxminiprogram/`，对 `cloudfunctions/adminApi`、`cloudfunctions/getExcelTemplate` 分别「上传并部署」。两处 `ADMIN_API_SECRET`（云函数环境变量）与 `config.json` 的 `adminApiSecret` 必须完全一致，否则登录全部失败。

## 部署到全新云环境（交接部署步骤）

两个云函数内部已改用 `cloud.DYNAMIC_CURRENT_ENV`（按函数所在环境自动初始化），**云函数源码不需要改环境 ID**。以下按实际操作顺序展开，每步写明改哪里、怎么验证。

### 第 0 步 · 前置准备（装软件、备齐信息）

1. **Node.js**：nodejs.org 下载 LTS 版，安装一路下一步；命令行敲 `node -v` 出版本号即就绪。仓库已带 `node_modules`，一般无需再 `npm install`。
2. **微信开发者工具**：微信官方工具，装好后用小程序账号扫码登录。
3. **小程序账号**：微信公众平台注册，后台「开发设置」里拿到 `AppID` 和 `AppSecret`。
4. **想好一串“暗号”**（第 3 步两边要填完全相同的一串）：任意字母数字串，如 `HDj4mP9xQ2w7`；要随机生成可用 PowerShell 敲 `[guid]::NewGuid().ToString('N')`。

### 第 1 步 · 换 AppID

微信开发者工具「导入项目」时填你自己的 AppID；或记事本修改 `wxminiprogram/project.config.json` 的 `appid` 字段。

### 第 2 步 · 新建云环境，拿环境 ID 填 3 处

1. 开发者工具点「云开发」打开控制台 →「新建环境」，得到形如 `cloud1-xxxxxxxx` 的环境 ID；
2. 填入 3 处：
   - `wxminiprogram/miniprogram/app.js` → `wx.cloud.init({ env: '<新环境ID>' })`
   - `wxminiprogram/project.config.json` → `cloudfunctionTemplateEnv`
   - `admin-server/config.json` → `env` 字段

### 第 3 步 · 配置“暗号”（两半边，值必须一字不差）

管理后台调用云函数时要携带一串接头暗号，云函数拿云上保存的值比对，对不上一律拒绝——所以**两边不一致 = 登录全部失败**。暗号内容随便，唯一要求是完全相同。

**云上半边**（微信云开发控制台）：

1. 开发者工具点「云开发」打开控制台 → 左侧「云函数」→ 点 `adminApi` 进详情；
2. 找「配置」（有的版本叫「版本与配置」）→「环境变量」→ 编辑/添加一条：
   - 键：`ADMIN_API_SECRET`
   - 值：第 0 步想好的那串暗号
3. 保存。界面措辞各版本略有差异，找不到按钮就直接找“环境变量”四个字。

**本地半边**（记事本打开 `admin-server/config.json`）：

1. 同时填齐 4 个字段：`env`（第 2 步的环境 ID）、`appId`、`appSecret`、`adminApiSecret`（=暗号，与云上一字不差）；
2. 每行的双引号、末尾逗号都保留，别把 JSON 格式改坏（改坏后台会启动即报错退出）；
3. `db` 段是将来做 MySQL 迁移才用的，**本阶段忽略即可**（后台运行不连 MySQL）。

### 第 4 步 · 上传云函数

开发者工具中分别右键 `cloudfunctions/adminApi`、`cloudfunctions/getExcelTemplate` →「上传并部署：云端安装依赖」。

> 如果云上环境变量是在**已经上传过之后**才设置的，把 `adminApi` 再上传部署一次，确保新实例读到暗号。

### 第 5 步 · 建 7 个数据库集合（名字一字不差）

云开发控制台 →「数据库」，逐个新建：`students`、`admins`、`entry_requests`、`users`、`tips`、`sessions`、`rate_limits`（若运行时报“集合不存在”，按报错名补建即可）。

### 第 6 步 · 启动管理后台

1. 打开 `admin-server/` 文件夹，**双击 `启动管理后台.bat`**（或 `node server.js` / 运行 `start.ps1`）；
2. **只要改过 `config.json`，先关掉原来的黑窗口再重新启动**——后台只在启动时读一次配置，不重启就一直在用旧值；
3. 等黑窗口出现 `Open browser` 字样，浏览器访问 `http://localhost:3000`。

启动/登录自检：

| 现象 | 原因与处理 |
|------|-----------|
| 黑窗出现 ❌「未配置 adminApiSecret：登录等接口将全部失败」 | `config.json` 的 `adminApiSecret` 没填；补填后**重启后台** |
| 启动立刻报错退出（带 JSON 解析错误堆栈） | `config.json` JSON 格式被改坏（缺引号/逗号）；按黑窗报错修正后重启 |
| 登录时报错、登不进 | 暗号两边不一致，或云上没设环境变量，或 `adminApi` 设完变量后没有重新上传部署 |

### 第 7 步 · 首登初始化超管

全新环境 `admins` 集合为空，用默认种子账号首次登录会自动创建超管并**强制改密**后才能进入系统（逻辑见 `adminApi` 的 `initDefaultAdmin` 与 `server.js` 启动横幅，种子账号口令不写入本文件，交接时另行告知）。

> 注意：本人机器当前环境的 3 处旧环境 ID（`cloud1-d6gio7v8iff39bab7`）已在上述位置原样保留——自己本机继续可用；交给他人部署时才按本节替换。

## 部署到服务器（含域名与 HTTPS，可选）

第 0–5 步与第 7 步和本机部署**完全相同**（换 AppID、环境 ID、暗号、上传云函数、建集合、首登都在微信云端或项目文件里做，与运行机器无关）。唯一不同的是把**第 6 步“启动后台”换成服务器做法**，按需再加域名。

### 服务器启动（替代第 6 步，以 Linux 为例）

1. **服务器装 Node.js**：`nodejs.org` 下载或系统包管理器安装，`node -v` 验证；
2. **代码上机**：把整个项目 zip 传到服务器（scp / FTP / 面板均可）解压；进 `admin-server/` 重新 `npm install` 一次（包内自带的 `node_modules` 是 Windows 下生成的，跨平台稳妥起见重装）；
3. **改好 `admin-server/config.json`**：4 个字段同第 3 步（`env` / `appId` / `appSecret` / `adminApiSecret`，暗号与云上一字不差），`db` 段照旧忽略；
4. **常驻运行**（服务器没有图形界面，双击不可用）：

   ```bash
   npm install -g pm2          # 一次性安装
   cd admin-server
   pm2 start server.js --name admin-api
   pm2 save                    # 记住当前进程列表
   pm2 startup                 # 可选：开机自启，按它输出的提示再执行一条命令
   ```

   仅想临时试跑：`nohup node server.js &`（服务器一重启就没了）；Windows 服务器则继续用 `启动管理后台.bat`，常驻同样可用 pm2；
5. **放行端口**：云厂商控制台「安全组 / 防火墙」放行 TCP 3000；
6. **访问**：浏览器打开 `http://服务器公网IP:3000`。`server.js` 默认监听所有网卡（`app.listen(3000)` 未限定 host），**无需改任何代码**；
7. **改过 `config.json` 后重启**：`pm2 restart admin-api`（与本机“必须重启”同一条规则）。

> 换端口：改 `admin-server/server.js` 里的 `const PORT = 3000`（写死、不读环境变量），安全组同步放行新端口。

### 域名 + HTTPS（可选，地址栏变成 https://）

系统本身是纯 HTTP，域名与证书放在前面的 nginx 反向代理上即可，后台不用动：

1. **解析域名**：域名控制台加 A 记录 → 服务器公网 IP；
2. **安装 nginx**（`apt install nginx` 或 `yum install nginx`）；
3. **站点配置反代到本机 3000**，关键几行：

   ```nginx
   server {
       listen 80;
       server_name your.domain.com;
       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       }
   }
   ```

4. **HTTPS 证书**：`certbot --nginx -d your.domain.com`（apt 装 `certbot python3-certbot-nginx`）自动签发并续期；安全组放行 80 与 443；
5. **反代之后 `config.json` 改 1 处**：`"trustProxy": true`（让登录限速等功能取到访客真实 IP，`config.example.json` 中有注释）；`corsOrigins` 一般不动——页面与接口同源，不存在跨域；
6. **重启**：`pm2 restart admin-api`，浏览器访问 `https://your.domain.com`。

> 走域名后，`localhost:3000` 只在服务器本机有效，外部一律用域名访问；暗号、云函数、首登等其余步骤不受影响。服务器没有公网 IP 时（如校内内网机），可用内网穿透（frp / cpolar 等）或只在校园网内访问。

## 测试与检查

- **静态检查**（零依赖，推送时 CI 自动执行，见 `.github/workflows/ci.yml`）：

  ```powershell
  cd admin-server
  npm run check    # HTML 结构 + W2/W3 重构守卫 + node --check + 共享单源守卫 + adminApi 防漂移 + 暖色窗口行为断言
  ```

- **E2E 测试**：先启动本地服务，再在 `admin-server` 下运行（凭据走环境变量本地注入，**不入库**）：

  ```powershell
  $env:ADMIN_PASS='<你的超管密码>'   # 可选 ADMIN_USER（默认 admin）、BASE_URL（默认 http://127.0.0.1:3000/api）
  npm run e2e          # 三批次全跑（A 权限矩阵 / B 班级隔离 / C 并发）
  npm run e2e:profile  # 仅批次A：个人主页/自助修改/权限矩阵
  ```

  用例会在库中真实创建/删除临时夹具账号并走「改密码→改回」链路，**不要在生产库运行**。

## 环境与凭据

- 所有凭据（`appSecret`、`adminApiSecret`、超管密码）一律经本地 `config.json` 或环境变量注入；`config.json` 已被 `.gitignore` 排除，仓库内仅有 `config.example.json` 占位模板。
- 管理员密码在库中为 scrypt 加盐哈希；浏览器仅保存 7 天随机 token，改密即全部失效。
