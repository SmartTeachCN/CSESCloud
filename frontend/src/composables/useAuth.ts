import { ref, computed } from 'vue';
import { authApi } from '../api';

export interface CurrentUser {
  type: 'alliance' | 'sub' | 'instance_sub' | 'temp_admin';
  user_id: number;
  school_id: number;
  school_name: string;
  instance_id: number;
  instance_uid: string;
  username: string;
  display_name: string;
  role: string;
  email: string;
  is_alliance: boolean;
  is_instance_sub: boolean;
  is_temp_admin: boolean;
  is_super_admin: boolean;
  owner_key: string;
  bindings?: any[];
  joined_schools?: any[];
  saved_logins?: any[];
}

const user = ref<CurrentUser | null>(null);
const ready = ref(false);
const isLoggedIn = computed(() => !!user.value);

export function useAuth() {
  async function fetchMe(): Promise<CurrentUser | null> {
    try {
      const data = await authApi.me();
      user.value = data as CurrentUser;
      ready.value = true;
      return data as CurrentUser;
    } catch (e) {
      user.value = null;
      ready.value = true;
      return null;
    }
  }

  function clear() {
    user.value = null;
  }

  return { user, ready, isLoggedIn, fetchMe, clear };
}
