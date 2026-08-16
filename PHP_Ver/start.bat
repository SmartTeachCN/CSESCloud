@echo off
chcp 65001 >nul 2>&1
title CSES Cloud - 智教云平台

echo ============================================
echo   CSES Cloud 智教云平台 - 启动脚本
echo ============================================
echo.

set "PROJECT_ROOT=%~dp0"

REM ---- 查找 Node ----
set "NODE_CMD="

where node >nul 2>&1
if %ERRORLEVEL%==0 (
    for /f "delims=" %%i in ('where node 2^>nul') do set "NODE_CMD=%%i"
    goto :node_found
)

if exist "C:\Program Files\nodejs\node.exe" set "NODE_CMD=C:\Program Files\nodejs\node.exe"
if exist "%NODE_CMD%" goto :node_found

REM ---- Node 未找到 ----
echo [错误] 未检测到 Node.js 运行环境！
echo.
echo 本项目需要 Node.js 18+ 才能运行。
echo.
echo 安装方式：
echo   1. 访问 https://nodejs.org/ 下载 Node.js LTS
echo   2. 安装后重新运行此脚本
echo.
pause
exit /b 1

:node_found
echo [信息] 找到 Node: %NODE_CMD%
"%NODE_CMD%" -v
echo.

REM ---- 检查依赖 ----
if not exist "%PROJECT_ROOT%node_modules\express" (
    echo [信息] 安装依赖...
    cd /d "%PROJECT_ROOT%"
    call pnpm install
)

if not exist "%PROJECT_ROOT%server\index.js" (
    echo [错误] 找不到 server\index.js，请确认项目文件完整
    pause
    exit /b 1
)

if not exist "%PROJECT_ROOT%data" mkdir "%PROJECT_ROOT%data"

REM ---- 启动服务器 ----
set "HOST=0.0.0.0"
set "PORT=8000"

echo.
echo ============================================
echo   正在启动 CSES Cloud API Server (NodeJS)...
echo   地址: http://localhost:%PORT%/
echo ============================================
echo.
echo 提示: 关闭 "CSES Cloud Server" 窗口即可停止
echo.

start "CSES Cloud Server" /min "%NODE_CMD%" "%PROJECT_ROOT%server\index.js"

REM 等待服务器启动
timeout /t 2 /nobreak >nul

REM 打开浏览器
start "" "http://localhost:%PORT%/"

echo.
echo [成功] CSES Cloud 已启动！
echo 如果浏览器没有自动打开，请访问: http://localhost:%PORT%/
echo.
echo 如需停止服务器，关闭标题为 "CSES Cloud Server" 的窗口即可。
echo.
pause
