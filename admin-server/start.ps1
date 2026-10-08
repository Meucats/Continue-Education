# 本机启动管理后台（admin-server / Express）
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath "$PSScriptRoot"

if (-not (Test-Path "node_modules")) {
  Write-Host "安装依赖..." -ForegroundColor Cyan
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install 失败，请先安装 Node.js LTS" }
}

Write-Host "启动: http://localhost:3000" -ForegroundColor Green
Write-Host "账号 admin / admin123（首次登录后请改密）" -ForegroundColor Yellow
node server.js
