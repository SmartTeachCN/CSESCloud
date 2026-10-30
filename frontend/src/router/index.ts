import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from '../composables/useAuth';

const { fetchMe, user } = useAuth();

const routes = [
  {
    path: '/',
    name: 'Landing',
    component: () => import('../views/landing/LandingPage.vue'),
    meta: { title: 'CSES Cloud 智教云', requiresAuth: false }
  },
  {
    path: '/share/preview',
    name: 'SharePreview',
    component: () => import('../views/share/SharePreviewPage.vue'),
    meta: { title: '分享预览', requiresAuth: false }
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/auth/LoginPage.vue'),
    meta: { title: '登录', requiresAuth: false }
  },
  {
    path: '/console',
    component: () => import('../layouts/ConsoleLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'Home',
        component: () => import('../views/home/HomePage.vue'),
        meta: { title: '首页', icon: 'ri-home-5-line' }
      },
      {
        path: 'editor/light',
        name: 'LightEditor',
        component: () => import('../views/editor/LightEditor.vue'),
        meta: { title: '轻编辑器', icon: 'ri-edit-2-line' }
      },
      {
        path: 'editor/standard/:type?/:id?',
        name: 'StandardEditor',
        component: () => import('../views/editor/StandardEditor.vue'),
        meta: { title: '标准编辑器', icon: 'ri-code-s-slash-line' }
      },
      {
        path: 'profile',
        name: 'Profile',
        component: () => import('../views/profile/ProfilePage.vue'),
        meta: { title: '个人中心', icon: 'ri-user-line' }
      },
      {
        path: 'notifications',
        name: 'Notifications',
        component: () => import('../views/notifications/NotificationPage.vue'),
        meta: { title: '通知中心', icon: 'ri-notification-3-line' }
      },
      {
        path: 'audit-log',
        name: 'AuditLog',
        component: () => import('../views/audit/AuditLogPage.vue'),
        meta: { title: '操作日志', icon: 'ri-file-list-3-line' }
      },
      {
        path: 'data-export',
        name: 'DataExport',
        component: () => import('../views/export/DataExportPage.vue'),
        meta: { title: '数据导出', icon: 'ri-download-line' }
      },
      {
        path: 'help',
        name: 'HelpCenter',
        component: () => import('../views/help/HelpCenter.vue'),
        meta: { title: '帮助中心', icon: 'ri-question-line' }
      },
      {
        path: 'developer',
        name: 'DeveloperCenter',
        component: () => import('../views/developer/DeveloperCenter.vue'),
        meta: { title: '开发者中心', icon: 'ri-key-2-line' }
      },
      {
        path: 'developer/apps',
        name: 'DevApps',
        component: () => import('../views/developer/DeveloperCenter.vue'),
        meta: { title: '实例侧应用', icon: 'ri-apps-2-line' }
      },
      {
        path: 'developer/apps/:id/edit',
        name: 'DevAppEditor',
        component: () => import('../views/developer/DevAppEditor.vue'),
        meta: { title: '应用编辑器', icon: 'ri-edit-box-line' }
      },
      {
        path: 'developer/market',
        name: 'DevSharedMarket',
        component: () => import('../views/developer/SharedAppsMarket.vue'),
        meta: { title: '共享市场', icon: 'ri-store-2-line' }
      },
      {
        path: 'developer/plugins',
        name: 'DevPlugins',
        component: () => import('../views/developer/DeveloperCenter.vue'),
        meta: { title: '编辑器插件', icon: 'ri-plug-line' }
      },
      {
        path: 'developer/plugins/:id/edit',
        name: 'DevPluginEditor',
        component: () => import('../views/developer/DevPluginEditor.vue'),
        meta: { title: '插件编辑器', icon: 'ri-edit-box-line' }
      },
      {
        path: 'dataspace',
        name: 'DataSpace',
        component: () => import('../views/dataspace/DataSpace.vue'),
        meta: { title: '数据空间', icon: 'ri-folder-3-line' }
      },
      {
        path: 'ai',
        name: 'AiAssistant',
        component: () => import('../views/ai/AiAssistantPage.vue'),
        meta: { title: 'AI 助理', icon: 'ri-brain-line' }
      },
      {
        path: 'admin',
        name: 'AdminPanel',
        component: () => import('../views/admin/AdminPanel.vue'),
        meta: { title: '管理后台', icon: 'ri-shield-keyhole-line' }
      },
      {
        path: 'admin/users',
        name: 'AdminUsers',
        component: () => import('../views/admin/AdminPanel.vue'),
        meta: { title: '用户管理', icon: 'ri-team-line' }
      },
      {
        path: 'admin/notifications',
        name: 'AdminNotifications',
        component: () => import('../views/admin/AdminPanel.vue'),
        meta: { title: '通知管理', icon: 'ri-notification-3-line' }
      },
      {
        path: 'admin/ai-config',
        name: 'AdminAiConfig',
        component: () => import('../views/admin/AdminPanel.vue'),
        meta: { title: 'AI 配置', icon: 'ri-brain-line' }
      },
      {
        path: 'admin/web-hosting',
        name: 'AdminWebHosting',
        component: () => import('../views/admin/AdminPanel.vue'),
        meta: { title: '网页空间', icon: 'ri-global-line' }
      },
      {
        path: 'admin/dataspace',
        name: 'AdminDataSpace',
        component: () => import('../views/admin/AdminPanel.vue'),
        meta: { title: '数据空间', icon: 'ri-hard-drive-2-line' }
      },
      {
        path: 'admin/help',
        name: 'AdminHelp',
        component: () => import('../views/admin/AdminPanel.vue'),
        meta: { title: '帮助中心', icon: 'ri-book-open-line' }
      }
    ]
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

router.beforeEach(async (to, _from, next) => {
  // 已登录态由 cookie 维护；首次进入 /console 时拉一次 me.php
  if (to.meta.requiresAuth === false) {
    next();
    return;
  }
  if (to.path.startsWith('/console')) {
    if (!user.value) {
      const me = await fetchMe();
      if (!me) {
        next({ name: 'Login', query: { redirect: to.fullPath } });
        return;
      }
    }
  }
  next();
});

export default router;
