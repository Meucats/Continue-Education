# Git 推送到 GitHub（需先在 GitHub 建好空仓库）
# 用法: .\push-github.ps1 -RepoUrl https://github.com/你的用户名/仓库名.git
param(
  [Parameter(Mandatory = $true)]
  [string]$RepoUrl
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if ((Split-Path -Leaf $PSScriptRoot) -ne "webadmin") {
  $root = "G:\杭职大继教院进校系统1"
}
Set-Location -LiteralPath $root

Write-Host "=== 敏感文件应被忽略（不应出现在 git status）===" -ForegroundColor Cyan
git status --short
$bad = git status --short | Select-String -Pattern "config\.json|token-secret|node_modules|admins\.json"
if ($bad) {
  throw "发现不应提交的敏感文件，请先检查 .gitignore"
}

if (-not (Test-Path ".git")) {
  git init
  git branch -M main
}

git add .
git commit -m "初始化：进校系统 Web后台 + 小程序"
git remote remove origin 2>$null
git remote add origin $RepoUrl
git push -u origin main --force

Write-Host "推送完成: $RepoUrl" -ForegroundColor Green
