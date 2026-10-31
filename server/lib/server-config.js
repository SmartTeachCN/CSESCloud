/**
 * CSES Cloud - 服务器配置文件（移植自旧实现）
 */
module.exports = {
  temp_admin: {
    enabled: true,
    // 临时管理员账密（默认 admin / admin，部署后请尽快在管理后台改密或禁用临时管理员模式）
    username: 'admin',
    password_hash: '$2b$12$ZCqkUL08rusjE0qBJDamxeeq3eju1ClEYqdAxcEYLTuCpQHFeyD2e',
  },
  ai: {
    default_model: 'DeepSeek',
  },
  // 智教联盟 OAuth2 SSO（非 dev 模式的真实登录，对齐 CsesWebEditor 的实现）
  // client_secret 不入库（同 CsesWebEditor 的配置文件），部署时在此处或环境变量配置
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
