# Cloudflare Workers 一键部署（已登录则跳过浏览器授权）
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath "$PSScriptRoot"

Write-Host "=== 1/5 安装依赖 ===" -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install 失败" }

Write-Host "=== 2/5 检查 Cloudflare 登录 ===" -ForegroundColor Cyan
$who = npx wrangler whoami 2>&1 | Out-String
if ($who -match "logged in") {
  Write-Host "已登录，跳过浏览器授权。" -ForegroundColor Green
} else {
  Write-Host "浏览器会弹出授权页，请点 Allow..." -ForegroundColor Yellow
  npx wrangler login
  if ($LASTEXITCODE -ne 0) { throw "wrangler login 失败" }
}

Write-Host "=== 3/5 创建 KV 命名空间 ADMIN_KV ===" -ForegroundColor Cyan
$cfg = Get-Content -LiteralPath "wrangler.toml" -Raw
if ($cfg -notmatch 'REPLACE_WITH_KV_NAMESPACE_ID') {
  Write-Host "wrangler.toml 已有 KV id，跳过创建。" -ForegroundColor Green
} else {
  Write-Host "若提示已存在，复制其 id 填入 wrangler.toml 后重跑本脚本。" -ForegroundColor Yellow
  $kvOut = npx wrangler kv namespace create ADMIN_KV 2>&1 | Out-String
  Write-Host $kvOut
  if ($kvOut -match '(?i)\bid\s*[:=]\s*"([a-f0-9]+)"') {
    $kvId = $Matches[1]
    $cfg = Get-Content -LiteralPath "wrangler.toml" -Raw
    $cfg = $cfg -replace 'REPLACE_WITH_KV_NAMESPACE_ID', $kvId
    Set-Content -LiteralPath "wrangler.toml" -Value $cfg -Encoding UTF8
    Write-Host "已自动填入 KV id: $kvId" -ForegroundColor Green
  } else {
    Write-Host "请把上面输出的 id 填入 wrangler.toml 的 [[kv_namespaces]].id，然后按回车继续..." -ForegroundColor Yellow
    Read-Host | Out-Null
  }
}

$cfg = Get-Content -LiteralPath "wrangler.toml" -Raw
if ($cfg -match 'REPLACE_WITH_KV_NAMESPACE_ID' -or $cfg -match '你的KV_ID') {
  throw "wrangler.toml 中 KV id 仍是占位符，请先填好真实 id 再重跑"
}

Write-Host "=== 4/5 设置密钥 WX_APP_SECRET ===" -ForegroundColor Cyan
Write-Host "输入微信小程序 AppSecret（mp.weixin.qq.com → 开发 → 开发设置）" -ForegroundColor Yellow
npx wrangler secret put WX_APP_SECRET
if ($LASTEXITCODE -ne 0) { throw "设置密钥失败" }

Write-Host "=== 5/5 部署 ===" -ForegroundColor Cyan
npx wrangler deploy
if ($LASTEXITCODE -ne 0) { throw "部署失败" }

Write-Host ""
Write-Host "部署完成。打开上面输出的 *.workers.dev 地址验证登录。" -ForegroundColor Green
