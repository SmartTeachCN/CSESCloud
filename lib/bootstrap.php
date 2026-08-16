<?php
/**
 * CSES Cloud - 启动引导
 */

// 错误显示（开发模式）
error_reporting(E_ALL);
ini_set('display_errors', '1');

// 时区
date_default_timezone_set('Asia/Shanghai');

// 自动加载 lib 目录下的类
spl_autoload_register(function ($class) {
    // 类名到文件名的映射（处理合并在同一文件中的类）
    $map = [
        'Helpers' => 'response.php',
        'Response' => 'response.php',
    ];
    if (isset($map[$class])) {
        require __DIR__ . DIRECTORY_SEPARATOR . $map[$class];
        return;
    }
    $candidates = [
        __DIR__ . DIRECTORY_SEPARATOR . $class . '.php',
        __DIR__ . DIRECTORY_SEPARATOR . strtolower($class) . '.php',
    ];
    foreach ($candidates as $path) {
        if (file_exists($path)) {
            require $path;
            return;
        }
    }
});

// 引导数据库（首次会自动建表 + seed）
DB::pdo();

// 初始化会话
Auth::init();
