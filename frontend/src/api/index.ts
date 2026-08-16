import { api } from './client';

export const authApi = {
  me: () => api.get<any>('/auth/me.php'),
  schools: () => api.get<any[]>('/auth/schools.php'),
  savedLogins: () => api.get<any[]>('/auth/saved-logins.php'),
  removeSavedLogin: (id: number) => api.delete(`/auth/saved-logins.php?id=${id}`),
  loginSub: (schoolId: number, username: string, password: string, rememberInList?: boolean) =>
    api.post('/auth/login.php', { school_id: schoolId, username, password, remember_in_list: rememberInList }),
  loginInstanceSub: (instanceUid: string, username: string, password: string, rememberInList?: boolean) =>
    api.post('/auth/login.php', { instance_uid: instanceUid, username, password, remember_in_list: rememberInList }),
  loginAlliance: (username: string) =>
    api.post('/auth/alliance-login.php', { username }),
  loginTempAdmin: (username: string, password: string) =>
    api.post('/auth/temp-admin-login.php', { username, password }),
  logout: () => api.post('/auth/logout.php'),
  bindSubUser: (subUserId: number, alias?: string, permissions?: any) =>
    api.post('/auth/bind-sub-user.php', { sub_user_id: subUserId, alias, permissions }),
  listBindings: () => api.get('/auth/bind-sub-user.php?action=list'),
  unbind: (bindingId: number) => api.post('/auth/bind-sub-user.php', { action: 'unbind', binding_id: bindingId })
};

export const instancesApi = {
  list: () => api.get<any[]>('/instances.php?action=list'),
  get: (id: number) => api.get<any>(`/instances.php?action=get&id=${id}`),
  create: (body: any) => api.post('/instances.php?action=create', body),
  start: (id: number) => api.post('/instances.php?action=start', { id }),
  stop: (id: number) => api.post('/instances.php?action=stop', { id }),
  restart: (id: number) => api.post('/instances.php?action=restart', { id }),
  delete: (id: number) => api.post('/instances.php?action=delete', { id }),
  share: (id: number, body: any) => api.post('/instances.php?action=share', { id, ...body }),
  batch: (action: string, ids: number[]) => api.post('/instances.php?action=batch', { action, ids }),
  setConfig: (id: number, config: any) => api.post('/instances.php?action=set-config', { id, config })
};

export const groupsApi = {
  list: () => api.get<any[]>('/instance-groups.php?action=list'),
  create: (name: string) => api.post('/instance-groups.php?action=create', { name }),
  update: (id: number, body: any) => api.post('/instance-groups.php?action=update', { id, ...body }),
  delete: (id: number) => api.post('/instance-groups.php?action=delete', { id }),
  move: (instanceId: number, groupId: number | null) => api.post('/instance-groups.php?action=move', { instance_id: instanceId, group_id: groupId })
};

export const schoolsApi = {
  joined: () => api.get<any[]>('/schools.php?action=joined'),
  all: () => api.get<any[]>('/auth/schools.php'),
  requestJoin: (schoolId: number, displayName?: string) => api.post('/schools.php?action=request-join', { school_id: schoolId, display_name: displayName }),
  myRequests: () => api.get('/schools.php?action=my-requests'),
  listRequests: (schoolId: number) => api.get(`/schools.php?action=join-requests&school_id=${schoolId}`),
  approve: (requestId: number, approve: boolean) => api.post('/schools.php?action=approve', { request_id: requestId, approve }),
  switch: (schoolId: number) => api.post('/schools.php?action=switch', { school_id: schoolId })
};

export const aiApi = {
  listSessions: (scope?: string) => api.get<any[]>(`/ai/chat.php?action=sessions${scope ? `&scope=${scope}` : ''}`),
  listMessages: (sessionId: number) => api.get<any[]>(`/ai/chat.php?action=messages&session_id=${sessionId}`),
  send: (sessionId: number | null, content: string, scope: string, scopeRef?: number, model?: string) =>
    api.post('/ai/chat.php?action=send', { session_id: sessionId, content, scope, scope_ref: scopeRef, model }),
  deleteSession: (sessionId: number) => api.post('/ai/chat.php?action=delete', { session_id: sessionId }),
  // 流式发送（通过 Vite 代理，避免跨域 cookie 问题）
  sendStream: (sessionId: number | null, content: string, scope: string, scopeRef?: number, model?: string) =>
    fetch('/api/ai/chat.php?action=send_stream', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, content, scope, scope_ref: scopeRef, model }),
    }),
  // 模型管理
  listModels: () => api.get<any[]>('/ai/models.php?action=list'),
  createModel: (data: any) => api.post('/ai/models.php?action=create', data),
  updateModel: (id: number, data: any) => api.post('/ai/models.php?action=update', { id, ...data }),
  deleteModel: (id: number) => api.post('/ai/models.php?action=delete', { id }),
  testModel: (id: number) => api.post('/ai/models.php?action=test', { id }),
};

export const storageApi = {
  list: (instanceId: number, collectionKey: string) => api.get<any[]>(`/instance-storage.php?action=list&instance_id=${instanceId}&collection_key=${encodeURIComponent(collectionKey)}`),
  save: (instanceId: number, collectionKey: string, record: any) => api.post('/instance-storage.php?action=save', { instance_id: instanceId, collection_key: collectionKey, record }),
  delete: (instanceId: number, collectionKey: string, recordId: string) => api.post('/instance-storage.php?action=delete', { instance_id: instanceId, collection_key: collectionKey, record_id: recordId })
};

export const devApi = {
  listApps: () => api.get<any[]>('/dev/apps.php?action=list'),
  getApp: (id: number) => api.get<any>(`/dev/apps.php?action=get&id=${id}`),
  publishedApps: () => api.get<any[]>('/dev/apps.php?action=published'),
  createApp: (body: any) => api.post('/dev/apps.php?action=create', body),
  updateApp: (id: number, body: any) => api.post('/dev/apps.php?action=update', { id, ...body }),
  saveManifest: (id: number, type: string, value: any) => api.post('/dev/apps.php?action=save-manifest', { id, type, value }),
  publishApp: (id: number) => api.post('/dev/apps.php?action=publish', { id }),
  archiveApp: (id: number) => api.post('/dev/apps.php?action=archive', { id }),
  deleteApp: (id: number) => api.post('/dev/apps.php?action=delete', { id }),
  // 共享市场
  sharedList: (keyword?: string) =>
    api.get<any[]>(`/dev/apps.php?action=shared-list${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ''}`),
  sharedGet: (id: number) => api.get<any>(`/dev/apps.php?action=shared-get&id=${id}`),
  toggleShare: (id: number) => api.post('/dev/apps.php?action=share', { id }),
  forkApp: (id: number) => api.post('/dev/apps.php?action=fork', { id }),
  // 市场 - 插件
  pluginSharedList: (keyword?: string) =>
    api.get<any[]>(`/dev/plugins.php?action=shared-list${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ''}`),
};

export const subUsersApi = {
  list: () => api.get<any[]>('/sub-users.php?action=list'),
  schoolBindings: () => api.get<any[]>('/sub-users.php?action=school-bindings'),
  create: (body: any) => api.post('/sub-users.php?action=create', body),
  update: (id: number, body: any) => api.post('/sub-users.php?action=update', { id, ...body }),
  delete: (id: number) => api.post('/sub-users.php?action=delete', { id }),
  resetPassword: (id: number, password: string) =>
    api.post('/sub-users.php?action=reset-password', { id, password }),
  schoolUnbind: (bindingId: number) =>
    api.post('/sub-users.php?action=school-unbind', { binding_id: bindingId })
};

export const pluginApi = {
  list: () => api.get<any[]>('/dev/plugins.php?action=list'),
  get: (id: number) => api.get<any>(`/dev/plugins.php?action=get&id=${id}`),
  published: () => api.get<any[]>('/dev/plugins.php?action=published'),
  resolver: async (ext: string) => {
    const result = await api.get<any>(`/dev/plugins.php?action=resolver&ext=${encodeURIComponent(ext)}`);
    return result?.id ? result : null;
  },
  create: (body: any) => api.post('/dev/plugins.php?action=create', body),
  update: (id: number, body: any) => api.post('/dev/plugins.php?action=update', { id, ...body }),
  publish: (id: number) => api.post('/dev/plugins.php?action=publish', { id }),
  archive: (id: number) => api.post('/dev/plugins.php?action=archive', { id }),
  delete: (id: number) => api.post('/dev/plugins.php?action=delete', { id })
};

export const campusApi = {
  overview: () => api.get<any>('/campus-control.php?action=overview'),
  listUnits: () => api.get<any[]>('/campus-control.php?action=list'),
  getUnit: (id: number) => api.get<any>(`/campus-control.php?action=get&id=${id}`),
  createUnit: (body: any) => api.post('/campus-control.php?action=create', body),
  updateUnit: (id: number, body: any) => api.post('/campus-control.php?action=update', { id, ...body }),
  deleteUnit: (id: number) => api.post('/campus-control.php?action=delete', { id }),
  saveVariables: (id: number, variables: any) => api.post('/campus-control.php?action=save-variables', { id, variables })
};

export const hostingApi = {
  getSpace: () => api.get<any>('/web-hosting.php?action=get'),
  updateSpace: (body: any) => api.post('/web-hosting.php?action=update', body),
  listFiles: () => api.get<any>('/web-hosting.php?action=list-files'),
  getFile: (path: string) => api.post<any>('/web-hosting.php?action=get-file', { path }),
  saveFile: (body: any) => api.post('/web-hosting.php?action=save-file', body),
  deleteFile: (path: string) => api.post('/web-hosting.php?action=delete-file', { path }),
  createDirectory: (path: string) => api.post('/web-hosting.php?action=create-directory', { path }),
  getUsage: () => api.get<any>('/web-hosting.php?action=usage'),
  upload: (file: File, dir?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (dir) form.append('dir', dir);
    return request<any>('/web-hosting.php?action=upload', {
      method: 'POST',
      body: form,
      headers: {} as any,
    });
  },
  downloadUrl: (path: string) => `/api/web-hosting.php?action=download&path=${encodeURIComponent(path)}`,
};

export const adminApi = {
  users: () => api.get<any[]>('/admin/manage.php?action=users'),
  config: () => api.get<any>('/admin/manage.php?action=config'),
  setSuperAdmin: (userId: number, isSuperAdmin: boolean) =>
    api.post('/admin/manage.php?action=set-super-admin', { user_id: userId, is_super_admin: isSuperAdmin }),
  setRole: (userId: number, role: string) =>
    api.post('/admin/manage.php?action=set-role', { user_id: userId, role }),
  toggleTempAdmin: (enabled: boolean) =>
    api.post('/admin/manage.php?action=toggle-temp-admin', { enabled }),
  resetPassword: (userId: number, password: string) =>
    api.post('/admin/manage.php?action=reset-password', { user_id: userId, password }),
  schools: () => api.get<any[]>('/admin/manage.php?action=schools'),
  createNotification: (body: any) => api.post('/admin/manage.php?action=create-notification', body),
  // AI 配置
  aiConfig: () => api.get<any>('/admin/manage.php?action=ai-config'),
  saveAiConfig: (data: any) => api.post('/admin/manage.php?action=save-ai-config', data),
  listAiModels: () => api.get<any[]>('/admin/manage.php?action=list-ai-models'),
  createAiModel: (data: any) => api.post('/admin/manage.php?action=create-ai-model', data),
  updateAiModel: (id: number, data: any) => api.post('/admin/manage.php?action=update-ai-model', { id, ...data }),
  deleteAiModel: (id: number) => api.post('/admin/manage.php?action=delete-ai-model', { id }),
  // 知识库
  listKbEntries: () => api.get<any[]>('/admin/manage.php?action=list-kb'),
  createKbEntry: (data: any) => api.post('/admin/manage.php?action=create-kb', data),
  updateKbEntry: (id: number, data: any) => api.post('/admin/manage.php?action=update-kb', { id, ...data }),
  deleteKbEntry: (id: number) => api.post('/admin/manage.php?action=delete-kb', { id })
};

export const profileApi = {
  get: () => api.get<any>('/profile.php?action=profile'),
  update: (body: { display_name: string; email: string; phone: string; department: string }) =>
    api.post('/profile.php?action=update-profile', body),
  changePassword: (oldPassword: string, newPassword: string) =>
    api.post('/profile.php?action=change-password', { old_password: oldPassword, new_password: newPassword }),
  updateAvatar: (avatar: string) =>
    api.post('/profile.php?action=update-avatar', { avatar }),
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<any>('/profile.php?action=upload-avatar', {
      method: 'POST',
      body: form,
      headers: {} as any,
    });
  },
  savePreferences: (preferences: any) =>
    api.post('/profile.php?action=save-preferences', { preferences }),
};

export const notificationsApi = {
  list: (type?: string) => api.get<any[]>(`/notifications.php?action=list${type ? `&type=${type}` : ''}`),
  stats: () => api.get<any>('/notifications.php?action=stats'),
  markRead: (id?: number) => api.post('/notifications.php?action=mark-read', { id: id || 0 }),
  delete: (id: number) => api.post('/notifications.php?action=delete', { id }),
  create: (body: any) => api.post('/notifications.php?action=create', body),
  recipients: () => api.get<any>('/notifications.php?action=recipients')
};

export const instanceFilesApi = {
  list: (instanceId: number, dir?: string) =>
    api.get<any>(`/instance-files.php?action=list&instance_id=${instanceId}${dir ? `&dir=${encodeURIComponent(dir)}` : ''}`),
  get: (id: number) =>
    api.get<any>(`/instance-files.php?action=get&id=${id}`),
  save: (body: { id?: number; instance_id: number; directory?: string; name: string; content: string; file_type?: string; file_category?: string }) =>
    api.post('/instance-files.php?action=save', body),
  delete: (id: number) =>
    api.post('/instance-files.php?action=delete', { id }),
  resolveEditor: (ext: string) =>
    api.get<any>(`/instance-files.php?action=resolve-editor&ext=${encodeURIComponent(ext)}`),
  storageStats: (instanceId: number) =>
    api.get<any>(`/instance-files.php?action=storage-stats&instance_id=${instanceId}`),
  fileTree: (instanceId: number) =>
    api.get<any>(`/instance-files.php?action=file-tree&instance_id=${instanceId}`),
};

export const dataSpaceApi = {
  tree: () => api.get<any>('/data-space.php?action=tree'),
  get: (params: Record<string, any>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    return api.get<any>(`/data-space.php?action=get&${qs.toString()}`);
  },
  save: (body: any) => api.post('/data-space.php?action=save', body),
  delete: (body: any) => api.post('/data-space.php?action=delete', body),
  usage: () => api.get<any>('/data-space.php?action=usage'),
  createWebSpace: (body: any) => api.post('/data-space.php?action=create-webspace', body),
  updateWebSpace: (body: any) => api.post('/data-space.php?action=update-webspace', body),
  webspaceCreateFile: (body: any) => api.post('/data-space.php?action=webspace-create-file', body),
  webspaceCreateDir: (body: any) => api.post('/data-space.php?action=webspace-create-dir', body),
  webspaceUpload: (file: File, spaceId: number, dir?: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('space_id', String(spaceId));
    if (dir) form.append('dir', dir);
    return request<any>('/data-space.php?action=webspace-upload', {
      method: 'POST',
      body: form,
      headers: {} as any,
    });
  },
};
