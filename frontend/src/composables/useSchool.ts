import { ref, computed } from 'vue';
import { useAuth } from './useAuth';
import { schoolsApi } from '../api';

export interface School {
  id: number;
  name: string;
  short_name?: string;
  admin_username?: string;
  status?: string;
  address?: string;
  is_current?: boolean;
}

const { user, fetchMe } = useAuth();

// 当前选中的学校（来自 me.php 中的 school_id/school_name）
const currentSchool = computed<School | null>(() => {
  const u = user.value;
  if (!u) return null;
  if (!u.school_id) return null;
  return {
    id: u.school_id,
    name: u.school_name || `学校 #${u.school_id}`
  };
});

// 联盟账户已加入的学校（来自 joined_schools）；子用户则返回其所属学校
const joinedSchools = computed<School[]>(() => {
  const u = user.value;
  if (!u) return [];
  if (u.is_alliance && u.joined_schools) {
    return u.joined_schools.map((s: any) => ({
      id: s.id,
      name: s.name,
      short_name: s.short_name ?? '',
      address: s.address ?? '',
      admin_username: s.admin_username ?? '',
      status: s.status ?? 'active',
      is_current: s.id === u.school_id
    }));
  }
  if (!u.is_alliance && u.school_id) {
    return [{
      id: u.school_id,
      name: u.school_name || `学校 #${u.school_id}`,
      is_current: true
    }];
  }
  return [];
});

// 是否已加入任何学校
const hasJoinedSchool = computed(() => joinedSchools.value.length > 0);

const loading = ref(false);

export function useSchool() {
  async function switchSchool(schoolId: number): Promise<boolean> {
    loading.value = true;
    try {
      await schoolsApi.switch(schoolId);
      // 切换后重新拉取当前用户信息（更新 school_id 与 school_name）
      await fetchMe();
      return true;
    } catch (e) {
      console.error('切换学校失败', e);
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function refreshJoinedSchools(): Promise<void> {
    await fetchMe();
  }

  return {
    currentSchool,
    joinedSchools,
    hasJoinedSchool,
    loading,
    switchSchool,
    refreshJoinedSchools
  };
}
