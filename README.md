# 杭职大继续教育学院 - 管理后台部署指南

## 项目说明

本项目为杭职大继续教育学院进校系统的Web管理后台，基于微信云开发 + Vercel Serverless 部署。

## 一、环境准备

### 1. 注册必要账号
| 平台 | 用途 | 网址 |
|------|------|------|
| 微信公众平台 | 小程序管理 | https://mp.weixin.qq.com |
| Vercel | 后台托管 | https://vercel.com |
| GitHub（推荐） | 代码托管+自动部署 | https://github.com |
| Node.js | 本地开发 | https://nodejs.org |

### 2. 安装工具
```bash
# 安装 Vercel CLI
npm install -g vercel

# 安装 Git（如未安装）
# Windows 下载：https://git-scm.com/download/win
```

## 二、获取 appSecret

1. 登录 https://mp.weixin.qq.com
2. 左侧菜单 → 开发 → 开发管理 → 开发设置
3. 找到「AppSecret」，点击「重置」获取
4. **务必保存好，只显示一次**

## 三、本地测试

```bash
cd vercel-admin
npm install
vercel dev
```

浏览器打开 http://localhost:3000 测试功能是否正常。

## 四、部署到 Vercel

### 方式一：通过 CLI 部署

```bash
cd vercel-admin

# 首次登录
vercel login

# 部署（按提示操作）
vercel

# 部署到生产环境
vercel --prod
```

### 方式二：通过 GitHub 自动部署（推荐）

#### 步骤 1：创建 GitHub 仓库
1. 登录 https://github.com
2. 点击右上角「+」→「New repository」
3. 仓库名填 `vercel-admin`
4. 选择 Public 或 Private
5. 点击「Create repository」

#### 步骤 2：上传代码
```bash
cd vercel-admin
git init
git add .
git commit -m "初始部署"
git remote add origin https://github.com/你的用户名/vercel-admin.git
git push -u origin main
```

#### 步骤 3：Vercel 关联 GitHub
1. 登录 https://vercel.com
2. 点击「Add New...」→「Project」
3. 选择「Import Git Repository」
4. 选择刚才创建的 `vercel-admin` 仓库
5. 点击「Import」

#### 步骤 4：配置环境变量
在 Vercel 项目设置 → Settings → Environment Variables 中添加：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `WX_ENV` | `cloud1-d6gio7v8iff39bab7` | 云开发环境ID |
| `WX_APPID` | `wxcde7f3fd1d5fc715` | 小程序AppID |
| `WX_APPSECRET` | （你的appSecret） | 小程序AppSecret |

#### 步骤 5：部署
- 点击「Deploy」按钮
- 等待部署完成（约1-2分钟）
- 部署成功后会分配一个域名如 `xxx.vercel.app`

#### 步骤 6：后续更新
以后修改代码后，只需：
```bash
git add .
git commit -m "修改说明"
git push
```
Vercel 会**自动检测代码变化并重新部署**，无需手动操作。

## 五、绑定自定义域名（可选）

1. 在域名服务商购买域名
2. Vercel 项目 → Settings → Domains
3. 输入你的域名，按提示添加 DNS 记录
4. 等待生效（通常几分钟）

## 六、常见问题

### Q: 环境变量在哪里配置？
A: Vercel 控制台 → 你的项目 → Settings → Environment Variables

### Q: 部署后数据会丢吗？
A: 不会。数据存在微信云数据库，Vercel 只是托管前端页面和API逻辑。

### Q: 免费额度够用吗？
A: Vercel 免费版支持：
- 每月 100GB 流量
- 无限次部署
- 无限个域名
对于学校管理系统完全够用。

### Q: 小程序端需要改吗？
A: 不需要。小程序端直接调用云函数，不经过 Vercel。

### Q: 本地还能用吗？
A: 可以。运行 `vercel dev` 启动本地开发服务器，和之前 `node server.js` 效果一样。

## 七、项目结构

```
vercel-admin/
├── api/                    # Vercel Serverless Functions
│   ├── _lib/
│   │   └── cloud.js        # 公共工具（云函数调用、Excel解析等）
│   ├── admin/
│   │   ├── login.js        # 管理员登录
│   │   ├── index.js        # 管理员列表/添加
│   │   └── [id].js         # 管理员编辑/删除
│   ├── students.js         # 学员列表/添加
│   ├── students/
│   │   ├── [id].js         # 学员编辑/删除
│   │   └── batch-delete.js # 批量删除
│   ├── import.js           # Excel导入
│   ├── requests.js         # 入校申请列表
│   ├── requests/
│   │   └── [id]/
│   │       ├── approve.js  # 审批通过
│   │       └── reject.js   # 审批拒绝
│   ├── accounts.js         # 账户列表
│   ├── accounts/
│   │   └── sync.js         # 账户同步
│   ├── stats.js            # 统计数据
│   ├── stats/
│   │   └── detail.js       # 详细统计
│   ├── export/
│   │   └── students.js     # 导出Excel
│   └── template/
│       └── download.js     # 下载模板
├── public/                 # 静态文件
│   └── index.html          # 管理后台页面
├── vercel.json             # Vercel 配置
├── package.json            # 依赖配置
└── .env.example            # 环境变量示例
```

## 八、技术支持

如有问题，请联系项目开发者。
