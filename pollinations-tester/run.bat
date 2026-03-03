@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Pollinations Model Tester
echo.
echo  ============================================
echo   Pollinations Model Tester
echo  ============================================
echo.
if not exist "node_modules\.bin\electron.cmd" (
    echo [ERROR] Run npm install first!
    pause
    exit /b 1
)
echo [LOG] Launching...
"node_modules\.bin\electron.cmd" .
echo.
echo [LOG] Application closed.
pause
