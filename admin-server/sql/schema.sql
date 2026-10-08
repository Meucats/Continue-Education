-- 杭职大继续教育培训服务管理系统 MySQL 表结构（设计文档 §5）
-- 用法：mysql -u root -p < sql/schema.sql   或由 scripts/import-mysql.js 自动执行
CREATE DATABASE IF NOT EXISTS entry_system
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE entry_system;

-- 学员（students 集合）
CREATE TABLE IF NOT EXISTS students (
  _id                VARCHAR(64) PRIMARY KEY,
  name               VARCHAR(50)  NOT NULL,
  phone              VARCHAR(20)  NOT NULL UNIQUE,
  className          VARCHAR(100) NOT NULL DEFAULT '',
  schedule           VARCHAR(255) NOT NULL DEFAULT '',
  deadline           VARCHAR(20)  NOT NULL DEFAULT '',
  location           VARCHAR(100) NOT NULL DEFAULT '',
  courseDates        JSON,
  courseStartDate    VARCHAR(20)  NOT NULL DEFAULT '',
  courseEndDate      VARCHAR(20)  NOT NULL DEFAULT '',
  idCard             VARCHAR(30)  NOT NULL DEFAULT '',
  company            VARCHAR(100) NOT NULL DEFAULT '',
  password           VARCHAR(255) NOT NULL DEFAULT '',
  mustChangePassword TINYINT(1)   NOT NULL DEFAULT 0,
  createdAt          DATETIME(3) NULL,
  updatedAt          DATETIME(3) NULL,
  KEY idx_classname (className)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 管理员（admins 集合）
CREATE TABLE IF NOT EXISTS admins (
  _id                VARCHAR(64) PRIMARY KEY,
  name               VARCHAR(50)  NOT NULL,
  phone              VARCHAR(30)  NOT NULL UNIQUE,
  password           VARCHAR(255) NOT NULL,
  role               VARCHAR(20)  NOT NULL DEFAULT 'admin',
  classes            JSON,
  mustChangePassword TINYINT(1)   NOT NULL DEFAULT 0,
  createdAt          DATETIME(3) NULL,
  updatedAt          DATETIME(3) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 会话（sessions 集合）：迁移时不搬数据，仅建表供新系统使用
CREATE TABLE IF NOT EXISTS sessions (
  _id                VARCHAR(64) PRIMARY KEY,
  token              CHAR(64)     NOT NULL UNIQUE,
  type               VARCHAR(10)  NOT NULL,
  phone              VARCHAR(30)  NOT NULL,
  name               VARCHAR(50)  NOT NULL DEFAULT '',
  role               VARCHAR(20)  NOT NULL DEFAULT '',
  mustChangePassword TINYINT(1)   NOT NULL DEFAULT 0,
  expiresAt          BIGINT       NOT NULL,
  createdAt          DATETIME(3) NULL,
  KEY idx_phone_type (phone, type),
  KEY idx_expires (expiresAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 进校申请（entry_requests 集合）
CREATE TABLE IF NOT EXISTS entry_requests (
  _id            VARCHAR(64) PRIMARY KEY,
  name           VARCHAR(50)  NOT NULL,
  phone          VARCHAR(20)  NOT NULL,
  carPlate       VARCHAR(20)  NOT NULL DEFAULT '',
  entryDate      VARCHAR(12)  NOT NULL DEFAULT '',
  entryStartTime VARCHAR(8)   NOT NULL DEFAULT '',
  entryEndTime   VARCHAR(8)   NOT NULL DEFAULT '',
  status         VARCHAR(10)  NOT NULL DEFAULT 'pending',
  rejectReason   VARCHAR(255) NOT NULL DEFAULT '',
  createdAt      DATETIME(3) NULL,
  processedAt    DATETIME(3) NULL,
  KEY idx_status_created (status, createdAt),
  KEY idx_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 用户账户（users 集合）
CREATE TABLE IF NOT EXISTS users (
  _id       VARCHAR(64) PRIMARY KEY,
  phone     VARCHAR(20) NOT NULL UNIQUE,
  name      VARCHAR(50) NOT NULL DEFAULT '',
  role      VARCHAR(20) NOT NULL DEFAULT 'student',
  password  VARCHAR(255) NOT NULL DEFAULT '',
  createdAt DATETIME(3) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 温馨提示（tips 集合）
CREATE TABLE IF NOT EXISTS tips (
  _id       VARCHAR(64) PRIMARY KEY,
  className VARCHAR(100) NOT NULL UNIQUE,
  content   TEXT,
  createdBy VARCHAR(30) NOT NULL DEFAULT '',
  createdAt DATETIME(3) NULL,
  updatedAt DATETIME(3) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
