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

两个云函数内部已改用 `cloud.DYNAMIC_CURRENT_ENV`（按函数所在环境自动初始化），**云函数源码不需要改环境 ID**；需要放入新环境信息的位置如下，按序操作：

1. **换 AppID**：微信开发者工具「导入项目」时填你自己的 AppID；或修改 `wxminiprogram/project.config.json` 的 `appid` 字段。
2. **新建云环境并拿环境 ID**：云开发控制台 →「新建环境」，得到形如 `cloud1-xxxxxxxx` 的环境 ID，填入 3 处：
   - `wxminiprogram/miniprogram/app.js` → `wx.cloud.init({ env: '<新环境ID>' })`
   - `wxminiprogram/project.config.json` → `cloudfunctionTemplateEnv`
   - `admin-server/config.json` → `env` 字段（此文件由 `config.example.json` 复制而来，同时填入你自己的 `appId` / `appSecret` / `adminApiSecret` / MySQL 连接）
3. **上传云函数**：开发者工具中分别右键 `cloudfunctions/adminApi`、`cloudfunctions/getExcelTemplate` →「上传并部署：云端安装依赖」。
4. **配置云函数环境变量**：云开发控制台 → 云函数 → adminApi → 环境变量 `ADMIN_API_SECRET` = 自定义随机串，**必须与 `admin-server/config.json` 的 `adminApiSecret` 完全一致**。
5. **创建数据库集合**：云开发控制台 → 数据库，按代码实际使用的 7 个集合建好：`students`、`admins`、`entry_requests`、`users`、`tips`、`sessions`、`rate_limits`（若调用时报集合不存在，按报错集合名在控制台补建即可）。
6. **启动管理后台**：`admin-server` 下 `npm install` → `node server.js`（或 `start.ps1`），访问 `http://localhost:3000`。
7. **首登初始化超管**：全新环境 `admins` 集合为空，用默认种子账号首次登录会自动创建超管并**强制改密**后才能进入系统（逻辑见 `adminApi` 的 `initDefaultAdmin` 与 `server.js` 启动横幅，种子账号口令不写入本文件，交接时另行告知）。

> 注意：本人机器当前环境的 3 处旧环境 ID（`cloud1-d6gio7v8iff39bab7`）已在上述位置原样保留——自己本机继续可用；交给他人部署时才按本节替换。

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
