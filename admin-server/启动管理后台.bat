@echo off
cd /d "%~dp0"

echo ========================================
echo   Starting admin server...
echo ========================================
echo.

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo Install failed! Please install Node.js first.
        echo Download: https://nodejs.org/
        pause
        exit /b
    )
)

echo Starting server...
echo.
echo Open browser: http://localhost:3000
echo.

node server.js

pause
