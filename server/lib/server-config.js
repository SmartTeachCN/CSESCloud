/**
 * CSES Cloud - 服务器配置文件（1:1 复刻 lib/server-config.php）
 * php_bin / extension_dir 仅用于 instance-php 沙箱（执行开发者编写的实例 PHP 后端）
 */
module.exports = {
  temp_admin: {
    enabled: true,
    username: 'temp_admin',
    password_hash: '$2y$12$RleQfEL0Gr0Vj4f9mcesKOKsNqq0QylpLBMQj19XaFEfnmWkZ1aMi',
  },
  ai: {
    default_model: 'DeepSeek',
  },
  // PHP CLI（实例自定义 PHP 后端沙箱用；找不到时该功能返回错误）
  php: {
    bin: process.env.PHP_BIN || 'php',
    // 可选：显式指定 extension_dir（与原 npm 脚本一致的机器可填 D:\phps\php-8.5.9-nts-Win32-vs17-x64\ext）
    extension_dir: process.env.PHP_EXTENSION_DIR || '',
  },
  // 智教联盟 OAuth2 SSO（非 dev 模式的真实登录，对齐 CsesWebEditor 的实现）
  // client_secret 不入库（同 CsesWebEditor 的 config.prod.php），部署时在此处或环境变量配置
  alliance_oauth: {
    enabled: true,
    authorize_url: 'https://auth.smart-teach.cn/login/oauth/authorize',
    token_url: 'https://auth.smart-teach.cn/api/login/oauth/access_token',
    userinfo_url: 'https://auth.smart-teach.cn/api/userinfo',
    scope: 'openid profile email',
    client_id: process.env.ALLIANCE_OAUTH_CLIENT_ID || '3e92d3464c6adb036f8e',
    client_secret: process.env.ALLIANCE_OAUTH_CLIENT_SECRET || '',
    // 留空则按请求自动推导 {origin}/api/auth/alliance-callback；反代环境可显式指定
    redirect_uri: process.env.ALLIANCE_OAUTH_REDIRECT_URI || '',
  },
};
