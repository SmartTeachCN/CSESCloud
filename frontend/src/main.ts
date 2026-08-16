import { createApp } from 'vue';
import { Icon } from '@iconify/vue';
import App from './App.vue';
import router from './router';
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
app.use(router);
app.mount('#app');
