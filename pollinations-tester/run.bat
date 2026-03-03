@echo off
cd /d "%~dp0"
title Pollinations Model Tester — LOG
echo.
echo  ============================================
echo   Pollinations Model Tester
echo  ============================================
echo.
node_modules\.bin\electron .
echo.
echo  [Приложение закрыто]
pause
