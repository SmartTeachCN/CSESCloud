<template>
  <div class="help-center">
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">帮助中心</h1>
        <p class="page-description">查找常见问题解答，或联系我们的支持团队</p>
      </div>
    </div>

    <div class="search-section">
      <div class="search-box">
        <svg class="search-icon" width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
          <path d="M6.5 12.0032C9.53757 12.0032 12 9.54079 12 6.50323C12 3.46566 9.53757 1.00323 6.5 1.00323C3.46243 1.00323 1 3.46566 1 6.50323C1 9.54079 3.46243 12.0032 6.5 12.0032Z M7.06135 11.3855C8.86395 10.8993 10.399 9.65071 11.1805 8.03318L14.2715 11.1242C14.4668 11.3194 14.4668 11.636 14.2715 11.8313C14.0763 12.0265 13.7597 12.0265 13.5644 11.8313L10.4734 8.74026C9.67115 10.3708 8.11256 11.6344 6.27498 12.1328L5.79157 11.1596Z" />
        </svg>
        <input type="text" v-model="searchQuery" placeholder="搜索帮助文档、FAQ..." />
        <button class="btn btn-primary" @click="handleSearch">搜索</button>
      </div>
      <div class="popular-tags">
        <span class="tags-label">热门搜索：</span>
        <button
          v-for="tag in popularTags"
          :key="tag"
          class="tag"
          @click="searchQuery = tag"
        >{{ tag }}</button>
      </div>
    </div>

    <div class="help-layout">
      <div class="faq-section">
        <div class="section-header">
          <h2 class="section-title">常见问题</h2>
          <div class="section-tabs">
            <button
              v-for="cat in categories"
              :key="cat.key"
              class="tab-btn"
              :class="{ active: activeCategory === cat.key }"
              @click="activeCategory = cat.key"
            >{{ cat.label }}</button>
          </div>
        </div>

        <div class="accordion-list">
          <div
            v-for="(item, idx) in filteredFaqs"
            :key="item.id"
            class="accordion-item"
            :class="{ open: openIndex === idx }"
          >
            <button class="accordion-header" @click="openIndex = openIndex === idx ? -1 : idx">
              <span class="accordion-q">{{ item.question }}</span>
              <svg
                class="accordion-icon"
                :class="{ rotated: openIndex === idx }"
                width="14" height="14" viewBox="0 0 16 16" fill="currentColor"
              >
                <path d="M4.42784 5.42843C4.62352 5.23325 4.93724 5.23285 5.13305 5.42767L7.99935 8.28882L10.8653 5.42767C11.0611 5.23285 11.3748 5.23325 11.5705 5.42843C11.7662 5.62361 11.7666 5.9373 11.5715 6.13311L8.35762 9.34703C8.16244 9.5427 7.84876 9.54231 7.65295 9.34703L4.43906 6.13311C4.24325 5.9373 4.24285 5.62361 4.42784 5.42843Z" />
              </svg>
            </button>
            <div v-if="openIndex === idx" class="accordion-body">
              <div class="accordion-a">{{ item.answer }}</div>
              <div class="accordion-footer">
                <span class="accordion-meta">有用 · {{ item.helpful }}</span>
                <div class="accordion-actions">
                  <button class="btn-ghost-sm" @click="markHelpful(item)"><Icon icon="ri-thumb-up-line" :size="14" /> 有用</button>
                  <button class="btn-ghost-sm"><Icon icon="ri-book-open-line" :size="14" /> 查看文档</button>
                </div>
              </div>
            </div>
          </div>
          <div v-if="filteredFaqs.length === 0" class="empty-state">
            <div class="empty-icon"><Icon icon="ri-search-line" :size="48" /></div>
            <div class="empty-text">未找到相关问题，试试其他关键词</div>
          </div>
        </div>
      </div>

      <div class="sidebar-section">
        <div class="panel contact-card">
          <div class="panel-header">
            <h3 class="panel-title">联系支持</h3>
          </div>
          <div class="panel-body">
            <div class="contact-icon"><Icon icon="ri-question-answer-line" :size="40" /></div>
            <div class="contact-title">需要更多帮助？</div>
            <div class="contact-desc">我们的支持团队随时为您解答疑问</div>
            <div class="contact-methods">
              <div class="method-row">
                <span class="method-icon"><Icon icon="ri-mail-line" :size="18" /></span>
                <div>
                  <div class="method-label">邮件支持</div>
                  <div class="method-value">support@cses-cloud.edu</div>
                </div>
              </div>
              <div class="method-row">
                <span class="method-icon"><Icon icon="ri-customer-service-2-line" :size="18" /></span>
                <div>
                  <div class="method-label">在线客服</div>
                  <div class="method-value">工作日 9:00 - 18:00</div>
                </div>
              </div>
              <div class="method-row">
                <span class="method-icon"><Icon icon="ri-phone-line" :size="18" /></span>
                <div>
                  <div class="method-label">技术热线</div>
                  <div class="method-value">400-888-0001</div>
                </div>
              </div>
            </div>
            <button class="btn btn-primary btn-full">提交工单</button>
          </div>
        </div>

        <div class="panel resources-card">
          <div class="panel-header">
            <h3 class="panel-title">快速链接</h3>
          </div>
          <div class="panel-body">
            <div class="resource-item">
              <span class="resource-icon"><Icon icon="ri-book-2-line" :size="24" /></span>
              <div>
                <div class="resource-title">API 文档</div>
                <div class="resource-desc">REST API 参考</div>
              </div>
            </div>
            <div class="resource-item">
              <span class="resource-icon"><Icon icon="ri-graduation-cap-line" :size="24" /></span>
              <div>
                <div class="resource-title">视频教程</div>
                <div class="resource-desc">入门到精通</div>
              </div>
            </div>
            <div class="resource-item">
              <span class="resource-icon"><Icon icon="ri-code-s-slash-line" :size="24" /></span>
              <div>
                <div class="resource-title">开发者社区</div>
                <div class="resource-desc">GitHub Discussions</div>
              </div>
            </div>
            <div class="resource-item">
              <span class="resource-icon"><Icon icon="ri-file-list-3-line" :size="24" /></span>
              <div>
                <div class="resource-title">更新日志</div>
                <div class="resource-desc">版本发布说明</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

interface FaqItem {
  id: string;
  category: string;
  question: string;
  answer: string;
  helpful: number;
}

const searchQuery = ref('');
const activeCategory = ref('getting-started');
const openIndex = ref(-1);

const popularTags = ['如何登录', '重置密码', '部署服务', 'API 密钥', '数据导出'];

const categories = [
  { key: 'getting-started', label: '入门指南' },
  { key: 'teacher', label: '教师指南' },
  { key: 'developer', label: '开发者指南' }
];

const faqs = ref<FaqItem[]>([
  { id: 'f1', category: 'getting-started', question: '如何首次登录系统？', answer: '使用管理员提供的账号信息登录。首次登录后请立即修改密码并完善个人信息。系统支持多种登录方式，包括学号/工号登录、邮箱登录和手机登录。', helpful: 24 },
  { id: 'f2', category: 'getting-started', question: '忘记密码怎么办？', answer: '在登录页面点击"忘记密码"链接，通过绑定的手机或邮箱接收验证码即可重置密码。如果无法接收验证码，请联系系统管理员进行人工重置。', helpful: 18 },
  { id: 'f3', category: 'getting-started', question: '如何创建新班级？', answer: '进入"校园集控 > 班级列表"页面，点击"新建班级"按钮，填写班级名称、所属课程、任课教师等信息即可创建。支持批量导入学生名单。', helpful: 31 },
  { id: 'f4', category: 'teacher', question: '如何管理学生名单？', answer: '在班级详情页面可以查看和管理学生名单。支持单个添加、批量导入(Excel/CSV)、从其他班级转入等多种方式。', helpful: 15 },
  { id: 'f5', category: 'teacher', question: '如何发布课程资料？', answer: '在班级主页的"资料"标签页中，点击"上传文件"按钮，支持 PDF、PPT、视频等多种格式。可设置学生查看权限和下载权限。', helpful: 12 },
  { id: 'f6', category: 'teacher', question: '如何查看学生学习数据？', answer: '进入班级详情后，切换到"数据统计"标签页，可以查看学生的登录时长、任务完成率、活跃度等关键指标。支持按日/周/月查看趋势。', helpful: 9 },
  { id: 'f7', category: 'developer', question: '如何获取 API 密钥？', answer: '进入"开发者中心"页面，点击"创建 API 密钥"按钮。请妥善保管密钥，不要泄露给第三方。密钥仅在创建时显示一次。', helpful: 42 },
  { id: 'f8', category: 'developer', question: 'API 请求频率限制是多少？', answer: '免费版用户每分钟最多 60 次请求，专业版每分钟 300 次，企业版不限。如需更高配额，请联系商务团队。', helpful: 28 },
  { id: 'f9', category: 'developer', question: '如何配置 Webhook？', answer: '在"开发者中心 > Webhook 配置"页面，添加 Webhook URL 并选择需要接收的事件类型。系统会将事件推送到指定的 HTTPS 端点。', helpful: 21 }
]);

const filteredFaqs = computed(() => {
  const query = searchQuery.value.toLowerCase();
  let items = faqs.value;
  if (activeCategory.value) {
    items = items.filter(f => f.category === activeCategory.value);
  }
  if (query) {
    items = items.filter(f =>
      f.question.toLowerCase().includes(query) ||
      f.answer.toLowerCase().includes(query)
    );
  }
  return items;
});

function handleSearch() {
  openIndex.value = -1;
}

function markHelpful(item: FaqItem) {
  item.helpful++;
}
</script>

<style scoped>
.help-center {
  padding: var(--spacer-5);
  max-width: 1300px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--spacer-5);
}

.page-title {
  font-size: var(--font-size-3xl);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.page-description {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
  margin: var(--spacer-1) 0 0;
}

.search-section {
  margin-bottom: var(--spacer-6);
}

.search-box {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-1) var(--spacer-1) var(--spacer-1) var(--spacer-4);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-xl);
}

.search-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.search-box input {
  flex: 1;
  height: 36px;
  background: transparent;
  border: none;
  outline: none;
  font-size: var(--font-size-base);
  color: var(--text-primary);
  font-family: var(--font-family);
}

.search-box input::placeholder {
  color: var(--text-tertiary);
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-2);
  padding: var(--spacer-2) var(--spacer-4);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--fast-duration);
  border: none;
}

.btn-primary {
  background: var(--accent-base);
  color: var(--accent-text);
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-full {
  width: 100%;
  justify-content: center;
  padding: var(--spacer-3) var(--spacer-4);
}

.btn-ghost-sm {
  padding: var(--spacer-1) var(--spacer-2);
  background: var(--subtle-secondary);
  color: var(--text-secondary);
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.btn-ghost-sm:hover {
  background: var(--subtle-pressed);
  color: var(--text-primary);
}

.popular-tags {
  display: flex;
  align-items: center;
  gap: var(--spacer-2);
  margin-top: var(--spacer-3);
  flex-wrap: wrap;
}

.tags-label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.tag {
  padding: var(--spacer-1) var(--spacer-2);
  font-size: var(--font-size-xs);
  font-weight: 500;
  background: var(--subtle-secondary);
  border: none;
  border-radius: var(--radius-full);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.tag:hover {
  background: var(--accent-base);
  color: var(--accent-text);
}

.help-layout {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: var(--spacer-5);
}

@media (max-width: 1024px) {
  .help-layout {
    grid-template-columns: 1fr;
  }
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacer-3);
  flex-wrap: wrap;
  gap: var(--spacer-2);
}

.section-title {
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.section-tabs {
  display: flex;
  gap: var(--spacer-1);
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-md);
  padding: 2px;
}

.tab-btn {
  padding: var(--spacer-1) var(--spacer-3);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-weight: 500;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background var(--fast-duration), color var(--fast-duration);
}

.tab-btn.active {
  background: var(--subtle-secondary);
  color: var(--text-primary);
  font-weight: 600;
}

.accordion-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-2);
}

.accordion-item {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-md);
  overflow: hidden;
  transition: box-shadow var(--fast-duration);
}

.accordion-item.open {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
}

.accordion-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: var(--spacer-3) var(--spacer-4);
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background var(--fast-duration);
}

.accordion-header:hover {
  background: var(--subtle-secondary);
}

.accordion-q {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.accordion-icon {
  color: var(--text-tertiary);
  transition: transform var(--fast-duration);
  flex-shrink: 0;
}

.accordion-icon.rotated {
  transform: rotate(180deg);
}

.accordion-body {
  padding: 0 var(--spacer-4) var(--spacer-4);
}

.accordion-a {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  line-height: 1.7;
  padding-top: var(--spacer-2);
}

.accordion-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: var(--spacer-3);
  padding-top: var(--spacer-3);
  border-top: 1px solid var(--divider-stroke);
}

.accordion-meta {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.accordion-actions {
  display: flex;
  gap: var(--spacer-2);
}

.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-4);
}

.panel {
  background: var(--card-bg);
  border: 1px solid var(--card-stroke);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.panel-header {
  padding: var(--spacer-4);
  border-bottom: 1px solid var(--divider-stroke);
}

.panel-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.panel-body {
  padding: var(--spacer-4);
}

.contact-card {
  text-align: center;
}

.contact-icon {
  font-size: 40px;
  margin-bottom: var(--spacer-2);
}

.contact-title {
  font-size: var(--font-size-base);
  font-weight: 600;
  color: var(--text-primary);
}

.contact-desc {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: var(--spacer-1);
}

.contact-methods {
  display: flex;
  flex-direction: column;
  gap: var(--spacer-3);
  margin: var(--spacer-4) 0;
}

.method-row {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-2);
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
  text-align: left;
}

.method-icon {
  font-size: 20px;
}

.method-label {
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--text-primary);
}

.method-value {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.resource-item {
  display: flex;
  align-items: center;
  gap: var(--spacer-3);
  padding: var(--spacer-2);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--fast-duration);
}

.resource-item:hover {
  background: var(--subtle-secondary);
}

.resource-icon {
  font-size: 24px;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--subtle-secondary);
  border-radius: var(--radius-md);
  flex-shrink: 0;
}

.resource-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.resource-desc {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.empty-state {
  text-align: center;
  padding: var(--spacer-12);
}

.empty-icon {
  font-size: 48px;
  margin-bottom: var(--spacer-3);
}

.empty-text {
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}
</style>