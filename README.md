# 杭职大继教院进校系统

- **线上管理后台**：`webadmin/admin-server` → 腾讯云服务器，见 [`腾讯云部署教程.md`](./腾讯云部署教程.md)
- **本机管理后台**：`webadmin/admin-server` → Express（localhost:3000）
- **小程序**：`wxminiprogram` → 微信开发者工具

部署总览见根目录 [`部署指南.md`](./部署指南.md)，或双击 [`部署.bat`](./部署.bat)。

## 测试与检查

- **静态检查**：`cd webadmin/admin-server && npm run check`（JS 语法 + `public/index.html` 结构检查，零依赖；推送时 CI 自动执行，见 `.github/workflows/ci.yml`）
- **E2E 测试**：先启动本地服务，再在 `webadmin/admin-server` 下运行（凭据走环境变量，不在仓库中保存）：
  ```powershell
  $env:ADMIN_PASS='你的超管密码'   # 可选 ADMIN_USER（默认 admin）、BASE_URL（默认 http://127.0.0.1:3000/api）
  npm run e2e:profile       # 批次A：个人主页/自助修改/权限矩阵
  npm run e2e:classmatrix   # 批次B：班级隔离矩阵（需 config.json 与云函数已部署）
  ```
- 用例会真实创建/删除临时账号并走「改密码→改回」链路，**不要在生产库运行**。
