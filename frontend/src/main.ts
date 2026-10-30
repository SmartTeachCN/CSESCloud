import { createApp } from 'vue';
import { Icon } from '@iconify/vue';
import App from './App.vue';
import AppIcon from './components/AppIcon.vue';
import router from './router';
import { installAppAlert } from './composables/useAppAlert';
import './styles/theme.css';
import './styles/app.css';
import './styles/buttons.css';
import './styles/forms.css';
import './styles/layout.css';
import './styles/dialogs.css';
import './styles/editor.css';
import './styles/components.css';

const app = createApp(App);
app.component('Icon', Icon);
app.component('AppIcon', AppIcon);
app.use(router);

// 全局替换 window.alert 为应用内自定义提示（入队，由 AppAlertHost 展示）
installAppAlert();

app.mount('#app');
