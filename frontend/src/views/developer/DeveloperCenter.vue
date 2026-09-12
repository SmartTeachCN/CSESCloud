<template>
  <div class="developer-center">
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">{{ pageTitle }}</h1>
        <p class="page-description">{{ pageDescription }}</p>
      </div>
      <div class="page-header-right">
        <button class="btn btn-ghost" @click="goMarket">
          <Icon icon="ri-share-circle-line" :size="14" />
          共享市场
        </button>
        <button v-if="currentView !== 'overview'" class="btn btn-primary" @click="currentView === 'plugins' ? (showCreatePluginDialog = true) : (showCreateDialog = true)">
          <Icon icon="ri-add-line" :size="14" />
          {{ currentView === 'apps' ? '创建应用' : currentView === 'plugins' ? '创建插件' : '创建套餐' }}
        </button>
      </div>
    </div>

    <!-- 概览视图 -->
    <div v-if="currentView === 'overview'" class="overview-view">
      <div class="overview-cards">
        <div class="overview-card" @click="goTo('apps')">
          <div class="card-icon apps">
            <Icon icon="ri-apps-2-line" :size="32" />
          </div>
          <div class="card-content">
            <h3 class="card-title">实例侧应用</h3>
            <p class="card-desc">管理运行在单个实例上的应用，配置编辑器、存储和接口</p>
            <div class="card-stat">
              <span class="stat-label">应用总数</span>
              <span class="stat-value">{{ appsList.length }}</span>
            </div>
          </div>
          <Icon icon="ri-arrow-right-s-line" class="card-arrow" :size="20" />
        </div>

        <div class="overview-card" @click="goTo('plugins')">
          <div class="card-icon plugins">
            <Icon icon="ri-plug-line" :size="32" />
          </div>
          <div class="card-content">
            <h3 class="card-title">编辑器插件</h3>
            <p class="card-desc">注册文件后缀与自定义编辑器，在轻编辑器中自动调用</p>
            <div class="card-stat">
              <span class="stat-label">插件总数</span>
              <span class="stat-value">{{ pluginsList.length }}</span>
            </div>
          </div>
          <Icon icon="ri-arrow-right-s-line" class="card-arrow" :size="20" />
        </div>

        <div class="overview-card" @click="goTo('packages')">
          <div class="card-icon packages">
            <Icon icon="ri-box-3-line" :size="32" />
          </div>
          <div class="card-content">
            <h3 class="card-title">集控侧套餐</h3>
            <p class="card-desc">管理面向校园集控的套餐，配置调用实例、编辑器和变量</p>
            <div class="card-stat">
              <span class="stat-label">套餐总数</span>
              <span class="stat-value">{{ packagesList.length }}</span>
            </div>
          </div>
          <Icon icon="ri-arrow-right-s-line" class="card-arrow" :size="20" />
        </div>

        <div class="overview-card" @click="goToControlApi">
          <div class="card-icon control">
            <Icon icon="ri-remote-control-line" :size="32" />
          </div>
          <div class="card-content">
            <h3 class="card-title">设备控制 API</h3>
            <p class="card-desc">内置 REST 设备控制能力，支持客户端注册、命令下发、状态上报</p>
            <div class="card-stat">
              <span class="stat-label">协议</span>
              <span class="stat-value">REST v1</span>
            </div>
          </div>
          <Icon icon="ri-arrow-right-s-line" class="card-arrow" :size="20" />
        </div>
      </div>

      <div class="overview-section">
        <h2 class="section-title">快速开始</h2>
        <div class="quick-start-grid">
          <div class="quick-start-card">
            <Icon icon="ri-file-code-line" :size="24" />
            <h4>阅读开发文档</h4>
            <p>了解应用清单、接口规范和开发流程</p>
          </div>
          <div class="quick-start-card">
            <Icon icon="ri-rocket-line" :size="24" />
            <h4>创建第一个应用</h4>
            <p>从实例侧应用开始，定义编辑器与存储结构</p>
          </div>
          <div class="quick-start-card">
            <Icon icon="ri-share-circle-line" :size="24" />
            <h4>共享到市场</h4>
            <p>将应用共享给其他开发者使用与修改</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 应用列表视图 -->
    <div v-else-if="currentView === 'apps'" class="list-view">
      <div class="filter-bar">
        <div class="filter-tabs">
          <button
            v-for="status in statusFilters"
            :key="status.key"
            class="filter-tab"
            :class="{ active: activeStatus === status.key }"
            @click="activeStatus = status.key"
          >
            {{ status.label }}
            <span class="filter-count">{{ getCountByStatus(status.key) }}</span>
          </button>
        </div>
        <div class="filter-search">
          <Icon icon="ri-search-line" :size="14" />
          <input v-model="searchKeyword" placeholder="搜索名称或 Key..." />
        </div>
      </div>

      <div v-if="loading" class="loading-state">
        <Icon icon="ri-loader-4-line" :size="24" class="spin" />
        <span>加载中...</span>
      </div>

      <div v-else class="data-table">
        <div class="table-header">
          <div class="col-name">名称</div>
          <div class="col-key">Key</div>
          <div class="col-version">版本</div>
          <div class="col-status">状态</div>
          <div class="col-shared">共享</div>
          <div class="col-updated">更新时间</div>
          <div class="col-actions">操作</div>
        </div>
        <div v-if="filteredList.length > 0">
          <div
            v-for="item in filteredList"
            :key="item.id"
            class="table-row"
          >
            <div class="col-name">
              <div class="name-icon" :class="{ asset: item.icon?.startsWith('asset:') }">
                <AppIcon :icon="item.icon" :app-key="item.app_key" :size="20" fallback="ri-apps-2-line" />
              </div>
              <div class="name-text">
                <div class="name-title">
                  {{ item.name }}
                  <span v-if="item.forked_from" class="fork-badge" title="派生应用">
                    <Icon icon="ri-git-branch-line" :size="10" />
                  </span>
                </div>
                <div class="name-desc">{{ item.description || '暂无描述' }}</div>
              </div>
            </div>
            <div class="col-key"><code>{{ item.app_key }}</code></div>
            <div class="col-version">{{ item.version }}</div>
            <div class="col-status">
              <span class="status-pill" :class="item.status">{{ getStatusLabel(item.status) }}</span>
            </div>
            <div class="col-shared">
              <button
                class="shared-toggle"
                :class="{ on: item.is_shared }"
                :title="item.is_shared ? '已共享到市场 - 点击取消' : '未共享 - 点击共享'"
                @click="toggleShare(item)"
                :disabled="busy"
              >
                <Icon :icon="item.is_shared ? 'ri-share-circle-fill' : 'ri-share-line'" :size="14" />
              </button>
            </div>
            <div class="col-updated">{{ item.updated_at }}</div>
            <div class="col-actions">
              <button class="icon-btn-sm" title="编辑" @click="editApp(item)">
                <Icon icon="ri-edit-2-line" :size="14" />
              </button>
              <button v-if="item.status === 'draft'" class="icon-btn-sm" title="发布" @click="publishApp(item)" :disabled="busy">
                <Icon icon="ri-rocket-line" :size="14" />
              </button>
              <button v-else-if="item.status === 'published'" class="icon-btn-sm" title="归档" @click="archiveApp(item)" :disabled="busy">
                <Icon icon="ri-archive-line" :size="14" />
              </button>
              <button class="icon-btn-sm danger" title="删除" @click="deleteApp(item)" :disabled="busy">
                <Icon icon="ri-delete-bin-line" :size="14" />
              </button>
            </div>
          </div>
        </div>
        <div v-else class="empty-state">
          <div class="empty-icon"><Icon icon="ri-inbox-line" :size="48" /></div>
          <div class="empty-text">暂无应用</div>
          <button class="btn btn-primary" @click="showCreateDialog = true">
            <Icon icon="ri-add-line" :size="14" />
            创建应用
          </button>
        </div>
      </div>
    </div>

    <!-- 套餐列表视图（简化） -->
    <div v-else-if="currentView === 'packages'" class="list-view">
      <div class="empty-state">
        <div class="empty-icon"><Icon icon="ri-box-3-line" :size="48" /></div>
        <div class="empty-text">集控侧套餐管理</div>
        <p class="empty-hint">集控套餐相关功能将在后续阶段开放</p>
      </div>
    </div>

    <!-- 插件列表视图 -->
    <div v-else-if="currentView === 'plugins'" class="list-view">
      <div class="filter-bar">
        <div class="filter-tabs">
          <button
            v-for="status in pluginStatusFilters"
            :key="status.key"
            class="filter-tab"
            :class="{ active: activePluginStatus === status.key }"
            @click="activePluginStatus = status.key"
          >
            {{ status.label }}
            <span class="filter-count">{{ getPluginCountByStatus(status.key) }}</span>
          </button>
        </div>
      </div>

      <div v-if="loading" class="loading-state">
        <Icon icon="ri-loader-4-line" :size="24" class="spin" />
        <span>加载中...</span>
      </div>

      <div v-else class="data-table">
        <div class="table-header">
          <div class="col-name">名称</div>
          <div class="col-key">Plugin Key</div>
          <div class="col-version">版本</div>
          <div class="col-extensions">注册后缀</div>
          <div class="col-status">状态</div>
          <div class="col-updated">更新时间</div>
          <div class="col-actions">操作</div>
        </div>
        <div v-if="filteredPlugins.length > 0">
          <div
            v-for="item in filteredPlugins"
            :key="item.id"
            class="table-row"
          >
            <div class="col-name">
              <div class="name-icon" :class="{ asset: item.icon?.startsWith('asset:') }">
                <AppIcon :icon="item.icon" :plugin-key="item.plugin_key" :size="20" fallback="ri-plug-line" />
              </div>
              <div class="name-text">
                <div class="name-title">{{ item.name }}</div>
                <div class="name-desc">{{ item.description || '暂无描述' }}</div>
              </div>
            </div>
            <div class="col-key"><code>{{ item.plugin_key }}</code></div>
            <div class="col-version">{{ item.version }}</div>
            <div class="col-extensions">
              <span v-for="ext in item.extensions" :key="ext" class="ext-tag">.{{ ext }}</span>
              <span v-if="!item.extensions || item.extensions.length === 0" class="ext-tag empty">无</span>
            </div>
            <div class="col-status">
              <span class="status-pill" :class="item.status">{{ getStatusLabel(item.status) }}</span>
            </div>
            <div class="col-updated">{{ item.updated_at }}</div>
            <div class="col-actions">
              <button class="icon-btn-sm" title="编辑" @click="editPlugin(item)">
                <Icon icon="ri-edit-2-line" :size="14" />
              </button>
              <button v-if="item.status === 'draft'" class="icon-btn-sm" title="发布" @click="publishPlugin(item)" :disabled="busy">
                <Icon icon="ri-rocket-line" :size="14" />
              </button>
              <button v-else-if="item.status === 'published'" class="icon-btn-sm" title="归档" @click="archivePlugin(item)" :disabled="busy">
                <Icon icon="ri-archive-line" :size="14" />
              </button>
              <button class="icon-btn-sm danger" title="删除" @click="deletePlugin(item)" :disabled="busy">
                <Icon icon="ri-delete-bin-line" :size="14" />
              </button>
            </div>
          </div>
        </div>
        <div v-else class="empty-state">
          <div class="empty-icon"><Icon icon="ri-plug-line" :size="48" /></div>
          <div class="empty-text">暂无编辑器插件</div>
          <button class="btn btn-primary" @click="showCreatePluginDialog = true">
            <Icon icon="ri-add-line" :size="14" />
            创建插件
          </button>
        </div>
      </div>
    </div>

    <!-- 创建对话框 -->
    <Teleport to="body">
      <div v-if="showControlApiDialog" class="dialog-overlay" @click.self="showControlApiDialog = false">
        <div class="dialog control-api-dialog">
          <div class="dialog-header">
            <h3>
              <Icon icon="ri-remote-control-line" :size="18" />
              设备控制 API
              <span class="control-badge">v1</span>
            </h3>
            <button class="dialog-close" @click="showControlApiDialog = false">
              <Icon icon="ri-close-line" :size="18" />
            </button>
          </div>
          <div class="dialog-body">
            <div class="api-intro">
              <Icon icon="ri-information-line" :size="16" />
              <span>CSES Cloud 平台内置 REST 设备控制能力，非 EA2 专属。任何实例侧应用均可通过以下 API 实现客户端远程控制（设备注册、命令下发、状态上报）。</span>
            </div>

            <div class="api-section">
              <h4>API 端点</h4>
              <code class="api-url">POST /api/control?instance_uid={uid}&action={action}</code>
            </div>

            <div class="api-section">
              <h4>可用 Action</h4>
              <div class="api-table">
                <div class="api-tr api-th">
                  <div class="api-td method">方法</div>
                  <div class="api-td action">Action</div>
                  <div class="api-td desc">说明</div>
                  <div class="api-td auth">认证</div>
                </div>
                <div class="api-tr" v-for="ep in controlApiEndpoints" :key="ep.action">
                  <div class="api-td method"><span class="method-badge" :class="ep.method">{{ ep.method }}</span></div>
                  <div class="api-td action"><code>{{ ep.action }}</code></div>
                  <div class="api-td desc">{{ ep.desc }}</div>
                  <div class="api-td auth">{{ ep.auth }}</div>
                </div>
              </div>
            </div>

            <div class="api-section">
              <h4>认证方式</h4>
              <ul class="auth-list">
                <li><strong>设备注册</strong>：使用注册码（<code>EA2-xxx</code>）验证</li>
                <li><strong>客户端操作</strong>：<code>x-device-id</code> + <code>x-device-credential</code> 请求头</li>
                <li><strong>管理操作</strong>：需实例管理员权限</li>
              </ul>
            </div>

            <div class="api-section">
              <h4>如何使用</h4>
              <ol class="howto-list">
                <li>在<strong>实例侧应用</strong>编辑器中，进入「设备控制」Tab，启用设备控制并声明支持的指令类型</li>
                <li>在<strong>实例详情 → 设备控制</strong>中生成注册码</li>
                <li>客户端使用注册码调用 <code>device_register</code> 注册设备</li>
                <li>客户端轮询 <code>command_poll</code> 获取待执行命令</li>
                <li>通过 <code>command_report</code> 上报执行结果</li>
              </ol>
            </div>
          </div>
          <div class="dialog-footer">
            <button class="btn btn-ghost" @click="showControlApiDialog = false">关闭</button>
            <button class="btn btn-primary" @click="showControlApiDialog = false; router.push('/console/developer/apps')">
              <Icon icon="ri-apps-2-line" :size="14" /> 管理实例侧应用
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 创建对话框 -->
    <Teleport to="body">
      <div v-if="showCreateDialog" class="dialog-overlay" @click.self="showCreateDialog = false">
        <div class="dialog">
          <div class="dialog-header">
            <h3>创建应用</h3>
            <button class="dialog-close" @click="showCreateDialog = false">
              <Icon icon="ri-close-line" :size="18" />
            </button>
          </div>
          <div class="dialog-body">
            <div class="form-group">
              <label>名称</label>
              <input v-model="createForm.name" placeholder="请输入应用名称" />
            </div>
            <div class="form-group">
              <label>版本</label>
              <input v-model="createForm.version" placeholder="1.0.0" />
            </div>
            <div class="form-group">
              <label>分类</label>
              <input v-model="createForm.category" list="create-category-suggestions" placeholder="考试管理 / 教学服务 / 评测服务 / AI 服务 / 通用" />
              <datalist id="create-category-suggestions">
                <option v-for="c in categorySuggestions" :key="c" :value="c" />
              </datalist>
            </div>
            <div class="form-group">
              <label>描述</label>
              <textarea v-model="createForm.description" placeholder="可选描述" rows="3"></textarea>
            </div>
            <div v-if="isSuperAdmin" class="form-group">
              <label class="checkbox-label">
                <input type="checkbox" v-model="createForm.is_official" />
                <span>设为官方项目</span>
              </label>
              <span class="form-hint">官方项目将在共享市场中优先展示，并带有官方标识</span>
            </div>
          </div>
          <div class="dialog-footer">
            <button class="btn btn-ghost" @click="showCreateDialog = false">取消</button>
            <button class="btn btn-primary" @click="createApp" :disabled="!createForm.name.trim() || busy">
              创建
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 创建插件对话框 -->
    <Teleport to="body">
      <div v-if="showCreatePluginDialog" class="dialog-overlay" @click.self="showCreatePluginDialog = false">
        <div class="dialog">
          <div class="dialog-header">
            <h3>创建编辑器插件</h3>
            <button class="dialog-close" @click="showCreatePluginDialog = false">
              <Icon icon="ri-close-line" :size="18" />
            </button>
          </div>
          <div class="dialog-body">
            <div class="form-group">
              <label>插件名称</label>
              <input v-model="pluginCreateForm.name" placeholder="如：CSES 编辑器" />
            </div>
            <div class="form-group">
              <label>版本</label>
              <input v-model="pluginCreateForm.version" placeholder="1.0.0" />
            </div>
            <div class="form-group">
              <label>注册文件后缀（逗号分隔）</label>
              <input v-model="pluginCreateForm.extensionsStr" placeholder="如：cses, json" />
            </div>
            <div class="form-group">
              <label>描述</label>
              <textarea v-model="pluginCreateForm.description" placeholder="可选描述" rows="2"></textarea>
            </div>
          </div>
          <div class="dialog-footer">
            <button class="btn btn-ghost" @click="showCreatePluginDialog = false">取消</button>
            <button class="btn btn-primary" @click="createPlugin" :disabled="!pluginCreateForm.name.trim() || busy">
              创建
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { devApi, pluginApi } from '../../api';
import { useAuth } from '../../composables/useAuth';

const route = useRoute();
const router = useRouter();
const { user } = useAuth();

const loading = ref(false);
const busy = ref(false);
const showCreateDialog = ref(false);
const showControlApiDialog = ref(false);
const searchKeyword = ref('');
const activeStatus = ref('all');

const createForm = ref({
  name: '',
  version: '1.0.0',
  category: '通用',
  description: '',
  is_official: false
});

const categorySuggestions = ['考试管理', '教学服务', '评测服务', 'AI 服务', '通用'];

interface DevItem {
  id: number;
  name: string;
  description: string;
  version: string;
  status: 'draft' | 'published' | 'archived';
  is_shared: number;
  forked_from: number | null;
  forked_by?: string;
  app_key?: string;
  package_key?: string;
  category?: string;
  created_at: string;
  updated_at: string;
}

const appsList = ref<DevItem[]>([]);
const packagesList = ref<DevItem[]>([]);

// ===== 插件 =====
const pluginsList = ref<any[]>([]);
const showCreatePluginDialog = ref(false);
const activePluginStatus = ref('all');
const pluginCreateForm = ref({
  name: '',
  version: '1.0.0',
  extensionsStr: '',
  description: ''
});

const pluginStatusFilters = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'published', label: '已发布' },
  { key: 'archived', label: '已归档' }
];

const filteredPlugins = computed(() => {
  let list = pluginsList.value;
  if (activePluginStatus.value !== 'all') {
    list = list.filter(item => item.status === activePluginStatus.value);
  }
  return list;
});

function getPluginCountByStatus(status: string): number {
  if (status === 'all') return pluginsList.value.length;
  return pluginsList.value.filter(item => item.status === status).length;
}

function editPlugin(item: any) {
  router.push(`/console/developer/plugins/${item.id}/edit`);
}

async function loadPlugins() {
  loading.value = true;
  try {
    pluginsList.value = await pluginApi.list();
  } catch (e: any) {
    console.error('加载插件列表失败', e);
  } finally {
    loading.value = false;
  }
}

async function createPlugin() {
  if (!pluginCreateForm.value.name.trim() || busy.value) return;
  busy.value = true;
  try {
    const extensions = pluginCreateForm.value.extensionsStr
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(s => s.length > 0);
    const res = await pluginApi.create({
      name: pluginCreateForm.value.name,
      version: pluginCreateForm.value.version,
      extensions,
      description: pluginCreateForm.value.description
    });
    showCreatePluginDialog.value = false;
    pluginCreateForm.value = { name: '', version: '1.0.0', extensionsStr: '', description: '' };
    alert(`插件创建成功，plugin_key: ${res.plugin_key}`);
    await loadPlugins();
    if (res.id) {
      router.push(`/console/developer/plugins/${res.id}/edit`);
    }
  } catch (e: any) {
    alert(e.message || '创建失败');
  } finally {
    busy.value = false;
  }
}

async function publishPlugin(item: any) {
  if (!confirm(`确认发布插件「${item.name}」？发布后将在轻编辑器中生效。`)) return;
  busy.value = true;
  try {
    await pluginApi.publish(item.id);
    await loadPlugins();
    alert('已发布');
  } catch (e: any) {
    alert(e.message || '发布失败');
  } finally {
    busy.value = false;
  }
}

async function archivePlugin(item: any) {
  if (!confirm(`确认归档插件「${item.name}」？`)) return;
  busy.value = true;
  try {
    await pluginApi.archive(item.id);
    await loadPlugins();
    alert('已归档');
  } catch (e: any) {
    alert(e.message || '归档失败');
  } finally {
    busy.value = false;
  }
}

async function deletePlugin(item: any) {
  if (!confirm(`确认删除插件「${item.name}」？此操作不可恢复。`)) return;
  busy.value = true;
  try {
    await pluginApi.delete(item.id);
    await loadPlugins();
    alert('已删除');
  } catch (e: any) {
    alert(e.message || '删除失败');
  } finally {
    busy.value = false;
  }
}

const currentView = computed<'overview' | 'apps' | 'packages' | 'plugins'>(() => {
  if (route.path.endsWith('/apps')) return 'apps';
  if (route.path.endsWith('/packages')) return 'packages';
  if (route.path.endsWith('/plugins')) return 'plugins';
  return 'overview';
});

const isSuperAdmin = computed(() => user.value?.is_super_admin || user.value?.is_temp_admin || false);

const pageTitle = computed(() => {
  if (currentView.value === 'apps') return '实例侧应用';
  if (currentView.value === 'packages') return '集控侧套餐';
  if (currentView.value === 'plugins') return '编辑器插件';
  return '开发者中心';
});

const pageDescription = computed(() => {
  if (currentView.value === 'apps') return '管理运行在单个实例上的应用';
  if (currentView.value === 'packages') return '管理面向校园集控的套餐';
  if (currentView.value === 'plugins') return '注册文件后缀与自定义编辑器，在轻编辑器中自动调用';
  return '接入平台，管理应用与套餐';
});

const statusFilters = [
  { key: 'all', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'published', label: '已发布' },
  { key: 'archived', label: '已归档' }
];

const controlApiEndpoints = [
  { method: 'POST', action: 'device_register', desc: '设备注册（注册码验证）', auth: '注册码' },
  { method: 'POST', action: 'command_poll', desc: '设备轮询待执行命令', auth: '设备凭证' },
  { method: 'POST', action: 'command_report', desc: '设备上报命令执行结果', auth: '设备凭证' },
  { method: 'POST', action: 'device_update_state', desc: '更新设备状态（心跳）', auth: '设备凭证' },
  { method: 'POST', action: 'device_errors', desc: '上报设备错误', auth: '设备凭证' },
  { method: 'POST', action: 'command_create', desc: '创建命令（支持广播、呼叫监考、部署考试）', auth: '管理员' },
  { method: 'POST', action: 'enrollment_create', desc: '创建注册码', auth: '管理员' },
  { method: 'GET', action: 'enrollment_list', desc: '列出注册码', auth: '管理员' },
  { method: 'POST', action: 'enrollment_revoke', desc: '吊销注册码', auth: '管理员' },
  { method: 'GET', action: 'command_list', desc: '列出命令', auth: '管理员' },
  { method: 'GET', action: 'device_list', desc: '列出所有设备', auth: '管理员' },
  { method: 'POST', action: 'device_unregister', desc: '注销设备', auth: '管理员' },
  { method: 'GET', action: 'events_stream', desc: 'SSE 事件流', auth: '管理员' },
];

const currentList = computed(() => currentView.value === 'apps' ? appsList.value : packagesList.value);

function getCountByStatus(status: string): number {
  if (status === 'all') return currentList.value.length;
  return currentList.value.filter(item => item.status === status).length;
}

const filteredList = computed(() => {
  let list = currentList.value;
  if (activeStatus.value !== 'all') {
    list = list.filter(item => item.status === activeStatus.value);
  }
  if (searchKeyword.value.trim()) {
    const q = searchKeyword.value.toLowerCase();
    list = list.filter(item =>
      item.name.toLowerCase().includes(q) ||
      (item.app_key || item.package_key || '').toLowerCase().includes(q)
    );
  }
  return list;
});

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = { draft: '草稿', published: '已发布', archived: '已归档' };
  return labels[status] || status;
}

function goTo(view: 'apps' | 'packages' | 'plugins') {
  router.push(`/console/developer/${view}`);
}

function goMarket() {
  router.push('/console/developer/market');
}

function goToControlApi() {
  showControlApiDialog.value = true;
}

function editApp(item: DevItem) {
  router.push(`/console/developer/apps/${item.id}/edit`);
}

async function loadApps() {
  loading.value = true;
  try {
    appsList.value = await devApi.listApps();
  } catch (e: any) {
    console.error('加载应用列表失败', e);
  } finally {
    loading.value = false;
  }
}

async function createApp() {
  if (!createForm.value.name.trim() || busy.value) return;
  busy.value = true;
  try {
    const res = await devApi.createApp({
      ...createForm.value,
      is_official: createForm.value.is_official ? 1 : 0
    });
    showCreateDialog.value = false;
    createForm.value = { name: '', version: '1.0.0', category: '通用', description: '', is_official: false };
    alert(`应用创建成功，app_key: ${res.app_key}`);
    await loadApps();
    // 直接进入编辑器
    if (res.id) {
      router.push(`/console/developer/apps/${res.id}/edit`);
    }
  } catch (e: any) {
    alert(e.message || '创建失败');
  } finally {
    busy.value = false;
  }
}

async function publishApp(item: DevItem) {
  if (!confirm(`确认发布应用「${item.name}」？发布后才能在实例创建时被选择。`)) return;
  busy.value = true;
  try {
    await devApi.publishApp(item.id);
    await loadApps();
    alert('已发布');
  } catch (e: any) {
    alert(e.message || '发布失败');
  } finally {
    busy.value = false;
  }
}

async function archiveApp(item: DevItem) {
  if (!confirm(`确认归档应用「${item.name}」？`)) return;
  busy.value = true;
  try {
    await devApi.archiveApp(item.id);
    await loadApps();
    alert('已归档');
  } catch (e: any) {
    alert(e.message || '归档失败');
  } finally {
    busy.value = false;
  }
}

async function deleteApp(item: DevItem) {
  if (!confirm(`确认删除应用「${item.name}」？此操作不可恢复。`)) return;
  busy.value = true;
  try {
    await devApi.deleteApp(item.id);
    await loadApps();
    alert('已删除');
  } catch (e: any) {
    alert(e.message || '删除失败');
  } finally {
    busy.value = false;
  }
}

async function toggleShare(item: DevItem) {
  busy.value = true;
  try {
    const res = await devApi.toggleShare(item.id);
    item.is_shared = res.is_shared;
    alert(res.is_shared ? '已共享到市场' : '已取消共享');
  } catch (e: any) {
    alert(e.message || '操作失败');
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  if (currentView.value === 'apps') {
    loadApps();
  }
  if (currentView.value === 'plugins') {
    loadPlugins();
  }
});
</script>

<style scoped>
.developer-center {
  padding: var(--spacer-5);
  max-width: 1200px;
  margin: 0 auto;
}

/* 概览视图 */

.card-icon {
  width: 64px;
  height: 64px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.card-icon.apps { background: rgba(0, 103, 192, 0.1); color: #0067C0; }
.card-icon.packages { background: rgba(16, 124, 16, 0.1); color: #107C10; }
.card-icon.plugins { background: rgba(120, 90, 240, 0.1); color: #785AF0; }
.card-icon.control { background: rgba(0, 120, 212, 0.1); color: #0078D4; }
.card-icon.market { background: rgba(202, 143, 4, 0.1); color: #CA8F04; }

.card-content { flex: 1; min-width: 0; }

.card-title {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 var(--spacer-1);
}

.card-desc {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin: 0 0 var(--spacer-2);
  line-height: 1.5;
}

.card-stat {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
}

.stat-label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.stat-value {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--text-primary);
  display: inline-flex;
  align-items: center;
}

.card-arrow {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.overview-section { margin-top: var(--spacer-6); }



.quick-start-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--spacer-3);
}

.quick-start-card {
  padding: var(--spacer-4);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-md);
  color: var(--accent-base);
}

.quick-start-card h4 {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  margin: var(--spacer-2) 0 var(--spacer-1);
}

.quick-start-card p {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin: 0;
  line-height: 1.5;
}

/* 列表视图 */
.list-view { display: flex; flex-direction: column; gap: var(--spacer-4); }

.filter-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacer-3);
}

.filter-tabs {
  display: flex;
  gap: var(--spacer-1);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-md);
  padding: var(--spacer-1);
}

.filter-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
  padding: var(--spacer-2) var(--spacer-3);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.filter-tab:hover { background: var(--subtle-secondary); color: var(--text-primary); }

.filter-tab.active {
  background: var(--accent-base);
  color: var(--accent-text);
}

.filter-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  font-size: 10px;
  font-weight: 600;
  background: var(--subtle-secondary);
  color: var(--text-tertiary);
  border-radius: var(--radius-full);
}

.filter-tab.active .filter-count {
  background: var(--accent-text);
  color: var(--accent-base);
}

.filter-search {
  position: relative;
  display: flex;
  align-items: center;
}

.filter-search > :first-child {
  position: absolute;
  left: var(--spacer-3);
  color: var(--text-tertiary);
  pointer-events: none;
}

.filter-search input {
  height: 36px;
  padding: 0 var(--spacer-3) 0 calc(var(--spacer-3) + 20px);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  outline: none;
  width: 240px;
  transition: border-color var(--fast-duration);
}

.filter-search input:focus { border-color: var(--accent-base); }

.loading-state, .empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacer-2);
  padding: var(--spacer-12);
  color: var(--text-tertiary);
}

.empty-state p, .empty-hint {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin: 0;
}

.data-table {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.table-header,
.table-row {
  display: grid;
  grid-template-columns: 2fr 1.5fr 0.7fr 0.9fr 0.6fr 1.2fr 1.3fr;
  gap: var(--spacer-3);
  padding: var(--spacer-3) var(--spacer-4);
  align-items: center;
}

.table-header {
  background: var(--subtle-secondary);
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.table-row {
  border-top: 1px solid var(--divider-stroke);
  transition: background var(--fast-duration);
}

.table-row:hover { background: var(--subtle-secondary); }

.col-name {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  min-width: 0;
}

.name-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--subtle-secondary);
  border-radius: var(--radius-sm);
  color: var(--accent-base);
  flex-shrink: 0;
}

/* 应用自带真实图标时不使用底色 */
.name-icon.asset {
  background: transparent;
  overflow: hidden;
}

.name-text { min-width: 0; }

.name-title {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-sm);
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fork-badge {
  display: inline-flex;
  color: var(--text-tertiary);
}

.name-desc {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-key code {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  background: var(--subtle-secondary);
  padding: 2px var(--spacer-1);
  border-radius: var(--radius-xs);
}

.col-extensions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.ext-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  background: var(--subtle-secondary);
  border-radius: var(--radius-full);
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  color: var(--text-secondary);
}

.ext-tag.empty {
  color: var(--text-tertiary);
  font-style: italic;
}

.col-shared {
  display: flex;
  justify-content: center;
}

.shared-toggle {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all var(--fast-duration);
}

.shared-toggle:hover {
  background: var(--subtle-secondary);
  color: var(--text-primary);
}

.shared-toggle.on {
  color: var(--accent-base);
  background: var(--accent-bg);
}

.shared-toggle:disabled { opacity: 0.5; cursor: not-allowed; }

.status-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px var(--spacer-2);
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  font-weight: 500;
}

.status-pill.draft { background: rgba(202, 143, 4, 0.1); color: #CA8F04; }
.status-pill.published { background: rgba(16, 124, 16, 0.1); color: #107C10; }
.status-pill.archived { background: rgba(0, 0, 0, 0.08); color: var(--text-tertiary); }

.col-updated {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.col-actions {
  display: flex;
  gap: var(--spacer-1);
  justify-content: flex-end;
}

.icon-btn-sm {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.icon-btn-sm:hover { background: var(--subtle-pressed); color: var(--text-primary); }
.icon-btn-sm.danger:hover { color: var(--status-error); }
.icon-btn-sm:disabled { opacity: 0.5; cursor: not-allowed; }

.empty-icon {
  font-size: 48px;
  color: var(--text-tertiary);
}

.empty-text {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

/* 对话框 */
.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacer-4) var(--spacer-5);
  border-bottom: 1px solid var(--divider-stroke);
}

.dialog-header h3 {
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.dialog-close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  cursor: pointer;
}

.dialog-close:hover { background: var(--subtle-secondary); color: var(--text-primary); }

.dialog-body {
  padding: var(--spacer-5);
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  cursor: pointer;
  font-weight: 500;
  color: var(--text-secondary);
}

.checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: var(--accent-base);
  cursor: pointer;
}

.form-hint {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacer-2);
  padding: var(--spacer-4) var(--spacer-5);
  border-top: 1px solid var(--divider-stroke);
}

/* 设备控制 API 对话框 */
.control-api-dialog {
  max-width: 680px;
}

.control-api-dialog .dialog-header h3 {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
}

.control-badge {
  display: inline-flex;
  padding: 1px 8px;
  background: var(--accent-bg);
  color: var(--accent-base);
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: 600;
}

.api-intro {
  display: flex;
  align-items: flex-start;
  gap: var(--spacer-2);
  padding: var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  line-height: 1.5;
}

.api-intro > :first-child {
  color: var(--accent-base);
  flex-shrink: 0;
  margin-top: 2px;
}

.api-section {
  margin-top: var(--spacer-3);
}

.api-section h4 {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 var(--spacer-2);
}

.api-url {
  display: block;
  padding: var(--spacer-2) var(--spacer-3);
  background: var(--subtle-secondary);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-family: var(--font-mono, monospace);
  color: var(--text-secondary);
  word-break: break-all;
}

.api-table {
  border: 1px solid var(--divider-stroke);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.api-tr {
  display: grid;
  grid-template-columns: 70px 1.4fr 1.6fr 80px;
  gap: var(--spacer-2);
  padding: var(--spacer-1) var(--spacer-2);
  align-items: center;
  font-size: var(--font-size-xs);
}

.api-tr.api-th {
  background: var(--subtle-secondary);
  font-weight: 600;
  color: var(--text-tertiary);
}

.api-tr:not(.api-th) {
  border-top: 1px solid var(--divider-stroke);
}

.api-td code {
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  background: var(--subtle-secondary);
  padding: 1px 4px;
  border-radius: var(--radius-xs);
  color: var(--text-secondary);
}

.method-badge {
  display: inline-flex;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: 600;
  font-family: var(--font-mono, monospace);
}

.method-badge.POST { background: rgba(0, 103, 192, 0.1); color: #0067C0; }
.method-badge.GET { background: rgba(16, 124, 16, 0.1); color: #107C10; }

.auth-list {
  margin: 0;
  padding: 0 0 0 var(--spacer-4);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  line-height: 1.8;
}

.auth-list code {
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  background: var(--subtle-secondary);
  padding: 1px 4px;
  border-radius: var(--radius-xs);
}

.howto-list {
  margin: 0;
  padding: 0 0 0 var(--spacer-4);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  line-height: 1.8;
}

.howto-list code {
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  background: var(--subtle-secondary);
  padding: 1px 4px;
  border-radius: var(--radius-xs);
}

@media (max-width: 768px) {
  .table-header { display: none; }
  .table-row { grid-template-columns: 1fr; gap: var(--spacer-2); }
  .filter-search input { width: 100%; }
  .filter-bar { flex-direction: column; align-items: stretch; }
}
</style>
