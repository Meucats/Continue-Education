@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ========================================
echo   杭职大进校系统 - 部署入口
echo ========================================
echo.
echo  [1] 本机启动 admin-server
echo  [2] 推送到 GitHub（需已建远程仓库）
echo  [3] 打开部署指南 部署指南.md
echo.
set /p CHOICE=请选择 1-3:

if "%CHOICE%"=="1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0webadmin\admin-server\start.ps1"
  goto end
)
if "%CHOICE%"=="2" (
  set /p REPO=输入仓库地址 https://github.com/user/repo.git:
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0webadmin\push-github.ps1" -RepoUrl "%REPO%"
  goto end
)
if "%CHOICE%"=="3" (
  start "" "%~dp0部署指南.md"
  goto end
)
echo 无效选择
pause
exit /b 1

:end
echo.
pause
