@echo off
chcp 65001 >nul 2>&1
title CSES Cloud - 智教云平台

echo ============================================
echo   CSES Cloud 智教云平台 - 启动脚本
echo ============================================
echo.

set "PROJECT_ROOT=%~dp0"
set "DOC_ROOT=%PROJECT_ROOT%public"
set "ROUTER=%DOC_ROOT%\router.php"
set "INI_FILE=%PROJECT_ROOT%php.ini"

REM ---- 查找 PHP ----
set "PHP_CMD="

where php >nul 2>&1
if %ERRORLEVEL%==0 (
    for /f "delims=" %%i in ('where php 2^>nul') do set "PHP_CMD=%%i"
    goto :php_found
)

REM 检查常见路径
if exist "C:\php\php.exe" set "PHP_CMD=C:\php\php.exe"
if exist "%PHP_CMD%" goto :php_found

if exist "C:\Program Files\PHP\php.exe" set "PHP_CMD=C:\Program Files\PHP\php.exe"
if exist "%PHP_CMD%" goto :php_found

if exist "C:\Program Files (x86)\PHP\php.exe" set "PHP_CMD=C:\Program Files (x86)\PHP\php.exe"
if exist "%PHP_CMD%" goto :php_found

if exist "C:\xampp\php\php.exe" set "PHP_CMD=C:\xampp\php\php.exe"
if exist "%PHP_CMD%" goto :php_found

if exist "C:\wamp64\bin\php\php8.3.0\php.exe" set "PHP_CMD=C:\wamp64\bin\php\php8.3.0\php.exe"
if exist "%PHP_CMD%" goto :php_found

if exist "D:\php\php.exe" set "PHP_CMD=D:\php\php.exe"
if exist "%PHP_CMD%" goto :php_found

if exist "D:\xampp\php\php.exe" set "PHP_CMD=D:\xampp\php\php.exe"
if exist "%PHP_CMD%" goto :php_found

if exist "E:\php\php.exe" set "PHP_CMD=E:\php\php.exe"
if exist "%PHP_CMD%" goto :php_found

REM 项目自带的 php
if exist "%PROJECT_ROOT%php\php.exe" set "PHP_CMD=%PROJECT_ROOT%php\php.exe"
if exist "%PHP_CMD%" goto :php_found

REM ---- PHP 未找到 ----
echo [错误] 未检测到 PHP 运行环境！
echo.
echo 本项目需要 PHP 7.4+ (需包含 PDO SQLite 扩展) 才能运行。
echo.
echo 安装方式：
echo   1. 访问 https://windows.php.net/download/ 下载 PHP
echo   2. 解压到任意目录（如 C:\php）
echo   3. 将 PHP 目录添加到系统 PATH 环境变量
echo   4. 重新运行此脚本
echo.
echo   或者使用 XAMPP / WAMP 等集成环境：
echo   - XAMPP: https://www.apachefriends.org/
echo   - WAMP:  https://www.wampserver.com/
echo.
pause
exit /b 1

:php_found
echo [信息] 找到 PHP: %PHP_CMD%
"%PHP_CMD%" -v
echo.

REM ---- 检查必要扩展 ----
echo [信息] 检查必要扩展...
"%PHP_CMD%" -m 2>nul | findstr /I "pdo_sqlite" >nul
if %ERRORLEVEL%==0 (
    echo [信息] pdo_sqlite 扩展已启用
) else (
    echo [警告] 未检测到 pdo_sqlite 扩展，项目可能无法正常运行
)

"%PHP_CMD%" -m 2>nul | findstr /I "mbstring" >nul
if %ERRORLEVEL%==0 (
    echo [信息] mbstring 扩展已启用
) else (
    echo [警告] 未检测到 mbstring 扩展，项目可能无法正常运行
)

"%PHP_CMD%" -m 2>nul | findstr /I "openssl" >nul
if %ERRORLEVEL%==0 (
    echo [信息] openssl 扩展已启用
) else (
    echo [警告] 未检测到 openssl 扩展，项目可能无法正常运行
)

REM ---- 检查必要文件 ----
if not exist "%DOC_ROOT%\index.php" (
    echo [错误] 找不到 public\index.php，请确认项目文件完整
    pause
    exit /b 1
)

if not exist "%ROUTER%" (
    echo [错误] 找不到 public\router.php，请确认项目文件完整
    pause
    exit /b 1
)

if not exist "%PROJECT_ROOT%data" (
    mkdir "%PROJECT_ROOT%data" 2>nul
)

REM ---- 启动服务器 ----
set "HOST=0.0.0.0"
set "PORT=8000"

echo.
echo ============================================
echo   正在启动 PHP 内置开发服务器...
echo   地址: http://localhost:%PORT%
echo   文档根目录: %DOC_ROOT%
echo ============================================
echo.
echo 提示: 关闭 "CSES Cloud Server" 窗口即可停止
echo.

if exist "%INI_FILE%" (
    start "CSES Cloud Server" /min "%PHP_CMD%" -c "%INI_FILE%" -S %HOST%:%PORT% -t "%DOC_ROOT%" "%ROUTER%"
) else (
    start "CSES Cloud Server" /min "%PHP_CMD%" -S %HOST%:%PORT% -t "%DOC_ROOT%" "%ROUTER%"
)

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