# 进校系统迁移设计方案：微信云开发 → 云服务器 + MySQL

> 状态：**设计稿 v1**（2026-09-30，仅设计不涉及代码改动）
> 目标：小程序与 Web 后台统一由自建服务器提供 API，数据唯一落在 MySQL，微信云开发最终退役（云空间费用归零）。

---

## 1. 目标架构

```
微信小程序 ──wx.request──┐  HTTPS(备案域名)
                         ├──→ 云服务器 Express ──→ MySQL（唯一数据源）
Web 管理后台 ────────────┘
微信云开发（云函数/云数据库/云存储）→ 迁移完成后退役
```

- 两端**不是「同步」，是共用一份 MySQL**：读写同源，天然一致，不需要同步脚本。
- 服务器：阿里云 ECS 99 计划（2核2G/3M，Ubuntu 22.04）；域名 `hzjjy.top`（需 ICP 备案）。
- 免费 Let's Encrypt HTTPS；自装 MySQL 8；pm2 守护进程；Nginx 反代。

## 2. 现状盘点（改造前的准确底账）

### 2.1 三端调用链（现状）

```
小程序 ──wx.cloud.callFunction──→ 云函数 adminApi ──→ 云数据库 6 集合
Web后台 ──微信HTTP invokecloudfunction（appId/appSecret + ADMIN_API_SECRET）──→ 同一云函数
```

### 2.2 云资源清单

| 资源 | 说明 | 迁移去向 |
|------|------|---------|
| 云函数 `adminApi` | 770 行，35 个 action，含鉴权/限速/密码哈希 | **整体移植进 Express**（见 §6） |
| 云函数 `getExcelTemplate` | 生成 Excel 模板到云存储 | **废弃**，Express 已有 `/api/template/download` |
| 云数据库 6 集合 | students / admins / sessions / entry_requests / users / tips | **→ MySQL 6 张表**（见 §5） |
| 云存储 `imports/` 等 | 小程序导入 Excel 的中转文件 | **废弃**，改 HTTP 直传（见 §8） |

### 2.3 关键结论（三个省工点）

1. **登录体系无 openid**：全部登录都是「手机号 + 密码」，**不需要 code2Session 改造**，迁移对登录逻辑零影响。
2. **小程序调用高度集中**：26/31 处走 `utils/api.js` 的两个封装函数（`callAdminApi` / `callUserApi`），**改 1 个文件即可覆盖大半**，其余直调点仅 5 处。
3. **Express 是天然单点**：Web 后台所有路由都经 `callCloudFunction()`（server.js:134）一个函数出去——**只要把这个函数从「调微信」换成「调本地 MySQL 版分发器」，Web 后台路由一行不用改**。

## 3. 接口对照表（35 个 action）

两端最终统一走 Express，分发器 = 移植后的 `adminApi.main`（MySQL 版）：

| 调用方 | 路径 | 说明 |
|--------|------|------|
| 小程序 | `POST /api/wx`，body `{ action, data, token, ... }` | 新增入口，返回结构与云函数**完全一致**（`{success, data, message, code}`） |
| Web 后台 | 现有全部 REST 路由 | **路径、请求、响应全不变**，仅内部 `callCloudFunction` → 本地 `dispatch` |

action 鉴权分级（沿用云函数逻辑，整体移植）：

| 级别 | action | 新入口归属 |
|------|--------|-----------|
| 公开（免登录） | `loginAdmin` `loginStudent` `changePassword` `getTips` `addRequest` | `/api/wx` |
| 登录前（验原密码+限速） | `changeAdminPassword` | `/api/wx` |
| 学员会话 | `getStudentSelf` `getMyRequests` `upsertMyUser` `logout`(student) | `/api/wx` |
| 管理会话 | `getStudents` `getStudent` `addStudent` `updateStudent` `deleteStudent` `batchDeleteStudents` `resetPassword` `getRequests` `approveRequest` `rejectRequest` `getAccounts` `syncAccounts` `getStats` `importStudents` `getAdmins` `getAllTips` `updateTip` `deleteTip` `getClasses` `logout`(admin) | `/api/wx` 或既有 REST |
| 仅超管 | `addAdmin` `updateAdmin` `deleteAdmin` `resetAdminPassword` `importAdmins` `initDefaultAdmin` | 同上（`requireSuperadmin` 保留） |

**Web 后台既有 REST 路由与 action 的对应（全部保留，无需新增）**：
`/api/admin/login|me|logout|change-password`、`/api/admins*`、`/api/students*`、`/api/import`、`/api/requests*`、`/api/accounts*`、`/api/stats*`、`/api/export/students`、`/api/template/*`、`/api/tips*`、`/api/classes`。

> 小程序侧**不需要**为每个 action 建 REST 路由——统一 `/api/wx` 分发，这是本设计把改动压到最小的核心。

## 4. 目标技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| 数据库驱动 | `mysql2/promise` 连接池 | Node 生态标准，支持 JSON 列 |
| 密码哈希 | **沿用 scrypt（`scrypt$salt$hash`）** | 云库密码散列**原样拷贝即用**，无需重哈希 |
| 会话 token | 沿用随机 64 位 hex + `sessions` 表 | 与云函数逻辑一致，小程序端零改动 |
| Web 后台鉴权 | 沿用现有 HMAC token（`.token-secret`） | 不动 |
| 登录限速 | 沿用内存 Map（单机足够） | 重启清零可接受 |
| 进程守护 | pm2 | 自动重启、日志 |
| 反向代理 | Nginx + Let's Encrypt | 免费 HTTPS、静态资源 |

## 5. MySQL 表结构（DDL 草案）

设计原则：
- **主键沿用 `_id VARCHAR(64)`**（存云库原 `_id`），迁移后旧数据 ID 不变，**前端所有 `_id` 引用零改动**；新行生成 uuid/hex。
- 日期字段中，**业务逻辑按字符串比较的保持 VARCHAR**（`deadline`、`courseStartDate/EndDate`、`entryDate`），避免改动过期判断等既有逻辑；纯时间戳用 `DATETIME(3)`。
- 数组字段（`courseDates`、`classes`）用 MySQL `JSON` 列。
- `password` 为 scrypt 散列串（约 90 字符）。

```sql
-- 学员（对应 students 集合）
CREATE TABLE students (
  _id                VARCHAR(64) PRIMARY KEY,
  name               VARCHAR(50)  NOT NULL,
  phone              VARCHAR(20)  NOT NULL UNIQUE,
  className          VARCHAR(100) NOT NULL DEFAULT '',
  schedule           VARCHAR(255) NOT NULL DEFAULT '',
  deadline           VARCHAR(20)  NOT NULL DEFAULT '',   -- 'YYYY-MM-DD'，字符串比较沿用
  location           VARCHAR(100) NOT NULL DEFAULT '',
  courseDates        JSON,                               -- [{date, timeSlot}]
  courseStartDate    VARCHAR(20)  NOT NULL DEFAULT '',
  courseEndDate      VARCHAR(20)  NOT NULL DEFAULT '',
  idCard             VARCHAR(30)  NOT NULL DEFAULT '',
  company            VARCHAR(100) NOT NULL DEFAULT '',
  password           VARCHAR(255) NOT NULL DEFAULT '',
  mustChangePassword TINYINT(1)   NOT NULL DEFAULT 0,
  createdAt          DATETIME(3),
  updatedAt          DATETIME(3),
  KEY idx_classname (className)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 管理员（admins）
CREATE TABLE admins (
  _id                VARCHAR(64) PRIMARY KEY,
  name               VARCHAR(50)  NOT NULL,
  phone              VARCHAR(30)  NOT NULL UNIQUE,        -- 含 'admin' 特殊账号
  password           VARCHAR(255) NOT NULL,
  role               VARCHAR(20)  NOT NULL DEFAULT 'admin',  -- superadmin | admin
  classes            JSON,                               -- 负责班级数组
  mustChangePassword TINYINT(1)   NOT NULL DEFAULT 0,
  createdAt          DATETIME(3),
  updatedAt          DATETIME(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 会话（sessions）：迁移时建议不搬，切换后全员重登一次
CREATE TABLE sessions (
  _id                VARCHAR(64) PRIMARY KEY,
  token              CHAR(64)     NOT NULL UNIQUE,
  type               VARCHAR(10)  NOT NULL,               -- admin | student
  phone              VARCHAR(30)  NOT NULL,
  name               VARCHAR(50)  NOT NULL DEFAULT '',
  role               VARCHAR(20)  NOT NULL DEFAULT '',
  mustChangePassword TINYINT(1)   NOT NULL DEFAULT 0,
  expiresAt          BIGINT       NOT NULL,               -- 毫秒时间戳（沿用云函数逻辑）
  createdAt          DATETIME(3),
  KEY idx_phone_type (phone, type),
  KEY idx_expires (expiresAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 进校申请（entry_requests）
CREATE TABLE entry_requests (
  _id            VARCHAR(64) PRIMARY KEY,
  name           VARCHAR(50)  NOT NULL,
  phone          VARCHAR(20)  NOT NULL,
  carPlate       VARCHAR(20)  NOT NULL DEFAULT '',
  entryDate      VARCHAR(12)  NOT NULL DEFAULT '',        -- 'YYYY-MM-DD'，过期判断做字符串拼接
  entryStartTime VARCHAR(8)   NOT NULL DEFAULT '',
  entryEndTime   VARCHAR(8)   NOT NULL DEFAULT '',
  status         VARCHAR(10)  NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  rejectReason   VARCHAR(255) NOT NULL DEFAULT '',
  createdAt      DATETIME(3),
  processedAt    DATETIME(3) NULL,
  KEY idx_status_created (status, createdAt),
  KEY idx_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 用户账户（users，账户管理页展示用）
CREATE TABLE users (
  _id       VARCHAR(64) PRIMARY KEY,
  phone     VARCHAR(20) NOT NULL UNIQUE,
  name      VARCHAR(50) NOT NULL DEFAULT '',
  role      VARCHAR(20) NOT NULL DEFAULT 'student',
  password  VARCHAR(255) NOT NULL DEFAULT '',
  createdAt DATETIME(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 温馨提示（tips）
CREATE TABLE tips (
  _id       VARCHAR(64) PRIMARY KEY,
  className VARCHAR(100) NOT NULL UNIQUE,
  content   TEXT,
  createdBy VARCHAR(30) NOT NULL DEFAULT '',
  createdAt DATETIME(3),
  updatedAt DATETIME(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`isExpired`（进校申请过期）**不落库**，沿用 `isRequestExpired()` 在查询时计算，逻辑不动。

## 6. Express 改造清单（服务端）

| # | 改动点 | 位置 | 说明 |
|---|--------|------|------|
| 1 | 新增 `lib/db.js` | 新文件 | mysql2 连接池，读 `config.json` 的 `db` 段 |
| 2 | 新增 `lib/dispatcher.js` | 新文件 | **移植 `adminApi/index.js` 全部 action**：`switch(action)`、鉴权分级、`hashPassword/verifyPassword`、限速、会话 CRUD —— 业务代码几乎原样，仅把 `db.collection(x).where().get()` 等换成 SQL |
| 3 | `callCloudFunction()` 改为本地调用 | server.js:134 | 函数签名不变（`action, params`），内部 `dispatch(action, params)` → **既有 REST 路由零改动** |
| 4 | 删除微信 HTTP 调用链 | server.js:119-180 | `getAccessToken` / `httpPost` / `invokecloudfunction` 全删；`config.json` 不再需要 `env / secretId / secretKey / appId / appSecret / adminApiSecret` |
| 5 | 新增 `POST /api/wx` | server.js | 小程序统一入口：解析 `{action, data, token}` → `dispatch`；鉴权分级复用 dispatcher 内逻辑 |
| 6 | `/api/import` 响应结构对齐 | server.js:368 | 云函数 `importStudents` 返回平铺 `{success,total,added,updated,failed,errors}`，Express 现包在 `data` 里——**统一为平铺**（见 §8.5） |
| 7 | 上传鉴权兼容 | server.js:83 | `wx.uploadFile` 走 `Authorization: Bearer` 头，与现逻辑一致即可 |
| 8 | 依赖 | package.json | `+ mysql2`（保留 express/multer/xlsx/cors）；`xlsx` 已升 0.20.3（CDN 版，修 CVE-2023-30533） |
| 9 | 数据源开关 | config.json | `dataSource: "cloud" \| "mysql"`：`mysql` 为终态；保留 `cloud` 分支用于**回滚**（切换初期可一键切回云） |
| 10 | 列表分页/规模上限 | dispatcher 移植时 | 现云函数 `getStudents` 一次性 limit 1000、`getRequests/getAccounts` limit 200（09-30 已补 `count/total/truncated` 与前端截断提示条，复审 #7 统计侧）；`getStats` 超管已改 `count()`、班级受限走字段裁剪明细聚合（09-30，原「全量拉内存」已除）。P2 移植时给 SQL 加 `LIMIT/OFFSET` 分页并把聚合改写为 `COUNT/GROUP BY`；前端表格若暂不分页则保留现有上限并在超限时提示导出 |
| 11 | 会话表 TTL 清理 | dispatcher 移植时 | 云侧现状：`getSession` 过期即删 + `createSession` 约 5% 概率顺手清（2026-09-30 已加，复审 #14）；MySQL 侧建 `sessions.expiresAt` 索引，P2 加定时 `DELETE WHERE expires_at < NOW()`（cron 或启动时一次） |

新增文件结构：

```
admin-server/
  server.js            # 路由层（基本不动）
  config.json          # db 连接 + dataSource 开关
  lib/db.js            # mysql2 连接池
  lib/dispatcher.js    # 35 个 action 的 MySQL 版（移植自 adminApi）
  sql/schema.sql       # §5 DDL
  scripts/export-cloud.js   # 一次性：云库全量导出（迁移工具）
  scripts/import-mysql.js   # 一次性：导入 MySQL + 校验（迁移工具）
```

## 7. 小程序改造清单（逐文件）

| # | 文件 | 现状 | 改造 |
|---|------|------|------|
| 1 | `utils/api.js` | `wx.cloud.callFunction({name:'adminApi'})` ×2 | 改为 `wx.request({url: BASE+'/api/wx', method:'POST', data:{action,data,token,...}})`；返回 `res.data`（结构同构，**UNAUTHORIZED / FORCE_PASSWORD_CHANGE 分支原样保留**）；文件头新增 `BASE` 常量 |
| 2 | `app.js` | `wx.cloud.init(...)` | **删除 init**（保留 `restoreSession` 等） |
| 3 | `pages/index/index.js:136` | 直调 `getTips` | 改用 `callUserApi('getTips', {className})`（public action，带不带 token 均可） |
| 4 | `pages/login/login.js:214` | 直调 `changePassword` | 改用 `callUserApi('changePassword', ...)` |
| 5 | `pages/admin-import/admin-import.js` | ① `callFunction('getExcelTemplate')` + `cloud.downloadFile` 模板下载；② `cloud.uploadFile` + `importStudents` | ① 模板：`wx.downloadFile({url: BASE+'/api/template/download'})` + `openDocument`；② 导入：`wx.uploadFile({url: BASE+'/api/import', header:{Authorization}})` 直传，**无需云存储中转** |
| 6 | 各页面 | 26 处 `callUserApi/callAdminApi` | **零改动**（action 名、参数、返回结构全部不变） |
| 7 | `project.config.json` | `cloudfunctionRoot` 等 | 可移除云函数相关配置（非必须） |
| 8 | 微信公众平台 | — | 「开发管理 → 服务器域名 → request 合法域名」加 `https://api.xxx`（**需备案完成后**）；开发期工具勾选「不校验合法域名」 |

> 改造后云相关代码清零：`wx.cloud.*` 全部消失（api.js / app.js / index.js / login.js / admin-import.js 五处）。

## 8. 数据迁移方案

### 8.1 导出（源：微信云数据库）

两条路，推荐 A：

- **A. 云开发控制台导出**（稳）：数据库 → 各集合「导出」→ JSON。规避现有 action 的 limit 限制（students 1000 / requests 200 / accounts 200 / tips 100）。
- B. 临时 `exportAll` action：用 `invokecloudfunction` HTTP 全量拉取，**用完即删**（仅限控制台不可用时）。

### 8.2 转换与导入

- `_id`：原样保留（含迁移前的全部历史 ID）。
- 日期：云导出的 `{"$date": ...}` / ISO 串 → `DATETIME(3)`；`deadline / courseStartDate / courseEndDate / entryDate` **保持字符串原样**。
- `courseDates / classes`：JSON 原样入 JSON 列。
- `password`：scrypt 散列串**直接拷贝**（两端算法一致）。
- `sessions`：**不迁移** → 切换后管理员/学员重登一次（token 本就 7 天过期，代价可接受）。

### 8.3 校验清单

1. 六表行数 == 云集合文档数
2. 抽样 10 条/表逐字段比对（`scripts/import-mysql.js` 自带 `--verify`）
3. 冒烟：超管登录、学员登录、改密、进校申请提交/审批、Excel 导入导出、温馨提示读写

### 8.4 增量与切换窗口

切换日流程（选深夜低峰，提前 1 天在首页 Tips 发维护公告）：

```
T0  云库最终导出（增量）→ 导入 MySQL（几分钟内完成）
T1  云集合权限改为「仅管理端可读写」→ 旧版小程序写入被拒（影响窗口极小）
T2  服务器 dataSource=mysql 上线；Web 后台立即切到新数据源（无审核）
T3  新版小程序发布生效（需提前过审）
T4  观察 24h → 删除云函数/云库/云存储 → 关闭云开发环境（费用归零）
```

> ⚠️ **小程序发版有微信审核（1–2 天）**：新版本须**先提审**、审核通过后在切换窗口发布。窗口内旧版小程序对云的写入会被 T1 拦住，产生的差异数据量极小（深夜），可人工核对补齐。

### 8.5 响应结构统一约定

| 接口 | 云函数现状 | 目标 |
|------|-----------|------|
| `/api/wx` 全部 action | `{success, data, message, code}` | **完全一致** |
| `/api/import` | 平铺 `{success,total,added,updated,failed,errors}` | 改平铺（前端少改） |
| 其余既有 REST | 云函数透传 | 不变 |

## 9. 实施阶段（依赖关系）

| 阶段 | 内容 | 依赖 | 可否先行 |
|------|------|------|---------|
| P0 | 本设计文档 | — | ✅ 已完成 |
| P1 | 采购服务器 + 域名 + **提交备案** | — | ✅ **立即启动，备案 1–2 周是最长路径** |
| P2 | Express 改造（DDL + dispatcher 移植 + `/api/wx` + 数据源开关） | P0 | ✅ 可先行（本地 MySQL 自测） |
| P3 | 数据迁移演练（云导出 → 本地 MySQL → 校验脚本） | P2 | ✅ 可先行 |
| P4 | 小程序改造（5 个文件 + 合法域名占位） | P0 | ✅ 代码可先行；**真机联调等 P5** |
| P5 | 服务器部署（Node+MySQL+pm2+Nginx+HTTPS） | P1, P2 | 等采购/备案 |
| P6 | 联调 → 切换窗口 → 数据终迁 → 云退役 | P3, P4, P5 | — |

**关键路径：备案（1–2 周）**；P2–P4 均可与备案并行，总日历时间主要取决于备案。

## 10. 风险与回滚

| 风险 | 对策 |
|------|------|
| 小程序审核延误，切换窗口错过 | 新版先提审拿到「审核通过」；窗口仅是「发布」动作，可当天执行 |
| 切换后发现数据不一致 | 保留云环境只读备份 30 天；`dataSource=cloud` 一键回滚（云数据窗口内只读，无写入损失需评估） |
| 双写数据分裂 | **不做双写**，采用 §8.4 的单写停机窗口（本系统规模下窗口成本极低） |
| MySQL 挂了/误删 | 每日 `mysqldump` cron 到同机 + 异地（对象存储/本机）；2核2G 上数据量极小，全量 < 100MB |
| 密码散列不兼容 | 已确认两端同为 scrypt 格式，**原样搬运**；冒烟登录验证覆盖 |
| 限速 Map 重启清零 | 云函数侧已迁 `rate_limits` 集合持久化（09-30，阈值不变、异常不阻断，清单 #9）；Express 侧仍内存 Map（弱兜底，重启清零可接受） |

## 11. 明确不做的事

- ❌ 不做云库与 MySQL **双写/同步脚本**（单写切换替代）
- ❌ 不引入 code2Session / openid（现体系用不到）
- ❌ 不买云数据库 RDS、不买付费证书、不保留云开发（终态费用归零）
- ❌ 不改前端页面逻辑与 action 命名（迁移 ≠ 重构）

## 12. 收尾清单（迁移完全完成后再执行）

- [ ] 云函数临时 `exportAll` action **保留至迁移完全完成**（新老版本稳定运行、云开发环境正式退役确认无回滚需要）后，再从 `adminApi/index.js` 删除并最后上传一次部署 —— 用户已明确此顺序
- [ ] 删除 `scripts/export-cloud.js` / `scripts/out/` 旧导出 JSON（含真实身份证手机号）
- [ ] 云存储 `imports/`（导入的 Excel）、`templates/`（模板文件）等历史文件一并清理（复审 #10：云存储此前只增不删）
- [ ] `config.json` 清理 `env / appId / appSecret / adminApiSecret`（服务器阶段不再需要微信侧调用）
- [ ] `dataSource` 开关固定为 `mysql`，移除 `cloud` 分支（回滚窗口关闭后）

## 13. 工程化 backlog（非迁移范围，复审记录）

- `webadmin/admin-server/public/index.html` 拆分（复审/清单 #15）→ **两步走，第一步已完成（09-30 夜）**：样式抽离为 `public/admin.css`（1620 行），index.html 3794 → 2163 行，check-html 覆盖外链与花括号一致性，抽离后登录页/dashboard 冒烟核验无样式损失；JS/结构组件化仍需引入构建工具或原生拆分，另立项
- 列表分页（复审/清单 #7）→ 云侧统计与截断标记已先行完成（09-30），SQL 分页仍并入 §6 改造清单第 10 项，随 P2 一并做
- 测试与 CI（清单 #12）→ 已入库（09-30 夜）：`test/e2e-profile.js`、`test/e2e-classmatrix.js`（`ADMIN_PASS/ADMIN_USER/BASE_URL` 环境变量凭据）、`scripts/check-html.js`、`package.json` 的 `check/e2e` 族、`.github/workflows/ci.yml`（零依赖 `node --check` + check-html）
- 登录日志/操作审计 → 功能未实现（复审 #12 从 README 删掉了夸大描述），需要时另立项
- 后台同步多人在线等大数据量优化（复审 #14 提及）→ 当前数据量级（数百学员）用不到，不排队
