<?php
/**
 * CSES Cloud - API 响应与工具函数
 */

class Response
{
    /** JSON 成功响应 */
    public static function success($data = null, $message = 'ok')
    {
        self::json(['code' => 0, 'message' => $message, 'data' => $data]);
    }

    /** JSON 错误响应 */
    public static function error($message, $code = 1, $httpStatus = 400)
    {
        http_response_code($httpStatus);
        self::json(['code' => $code, 'message' => $message, 'data' => null]);
    }

    /** 输出 JSON 并终止 */
    public static function json($payload)
    {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($payload, JSON_UNESCAPED_UNICODE);
        exit;
    }
}

class Helpers
{
    /** HTML 转义 */
    public static function e($value)
    {
        return htmlspecialchars($value ?? '', ENT_QUOTES, 'UTF-8');
    }

    /** 取输入（POST 优先） */
    public static function input($key, $default = null)
    {
        if (isset($_POST[$key])) return $_POST[$key];
        if (isset($_GET[$key])) return $_GET[$key];
        return $default;
    }

    /** 取 JSON 请求体 */
    public static function jsonBody()
    {
        $raw = file_get_contents('php://input');
        if (!$raw) return [];
        $data = json_decode($raw, true);
        return is_array($data) ? $data : [];
    }

    /** 当前请求是否 POST */
    public static function isPost()
    {
        return $_SERVER['REQUEST_METHOD'] === 'POST';
    }

    /** 生成随机字符串 */
    public static function randomStr($length = 16)
    {
        return bin2hex(random_bytes($length / 2));
    }

    /** 生成 UUID v4 */
    public static function uuid()
    {
        $data = random_bytes(16);
        $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
        $data[8] = chr(ord($data[8]) & 0x3f | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
    }

    /** 格式化数字（千分位） */
    public static function formatNum($n)
    {
        return number_format($n);
    }

    /** 相对时间 */
    public static function timeAgo($datetime)
    {
        $now = time();
        $ts = strtotime($datetime);
        $diff = $now - $ts;
        if ($diff < 60) return '刚刚';
        if ($diff < 3600) return floor($diff / 60) . ' 分钟前';
        if ($diff < 86400) return floor($diff / 3600) . ' 小时前';
        if ($diff < 2592000) return floor($diff / 86400) . ' 天前';
        return date('Y-m-d', $ts);
    }
}
