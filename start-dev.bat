@echo off
echo =====================================
echo NCD 报价系统 - 本地开发环境
echo =====================================

REM 后端使用随机可用端口
set PORT=3000

echo 正在启动后端...
start "NCD Backend" cmd /k "cd backend && node src/index.js"
timeout /t 2 /nobreak >nul

echo 正在启动前端...
start "NCD Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo 启动完成！
echo 前端地址：http://localhost:5173/
echo 后端地址：http://localhost:3000/
echo.
echo 前端会自动代理到服务器后端 (121.40.35.46)
pause
