import { api } from './client';

export const authApi = {
  me: () => api.get<any>('/auth/me'),
  schools: () => api.get<any[]>('/auth/schools'),
  savedLogins: () => api.get<any[]>('/auth/saved-logins'),
  removeSavedLogin: (id: number) => api.delete(`/auth/saved-logins?id=${id}`),
  loginSub: (schoolId: number, username: string, password: string, rememberInList?: boolean) =>
    api.post('/auth/login', { school_id: schoolId, username, password, remember_in_list: rememberInList }),
  loginInstanceSub: (instanceUid: string, username: string, password: string, rememberInList?: boolean) =>
    api.post('/auth/login', { instance_uid: instanceUid, username, password, remember_in_list: rememberInList }),
  loginAlliance: (username: string) =>
    api.post('/auth/alliance-login', { username }),
  allianceLoginConfig: (redirect?: string) =>
    api.get<any>(`/auth/alliance-login-config${redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''}`),
  loginTempAdmin: (username: string, password: string) =>
    api.post('/auth/temp-admin-login', { username, password }),
  logout: () => api.post('/auth/logout'),
  bindSubUser: (subUserId: number, alias?: string, permissions?: any) =>
    api.post('/auth/bind-sub-user', { sub_user_id: subUserId, alias, permissions }),
  listBindings: () => api.get('/auth/bind-sub-user?action=list'),
  unbind: (bindingId: number) => api.post('/auth/bind-sub-user', { action: 'unbind', binding_id: bindingId })
};

export const instancesApi = {
  list: () => api.get<any[]>('/instances?action=list'),
  get: (id: number) => api.get<any>(`/instances?action=get&id=${id}`),
  create: (body: any) => api.post('/instances?action=create', body),
  start: (id: number) => api.post('/instances?action=start', { id }),
  stop: (id: number) => api.post('/instances?action=stop', { id }),
  restart: (id: number) => api.post('/instances?action=restart', { id }),
  delete: (id: number) => api.post('/instances?action=delete', { id }),
  share: (id: number, body: any) => api.post('/instances?action=share', { id, ...body }),
  batch: (action: string, ids: number[]) => api.post('/instances?action=batch', { action, ids }),
  setConfig: (id: number, config: any) => api.post('/instances?action=set-config', { id, config })
};

export const groupsApi = {
  list: () => api.get<any[]>('/instance-groups?action=list'),
  create: (name: string) => api.post('/instance-groups?action=create', { name }),
  update: (id: number, body: any) => api.post('/instance-groups?action=update', { id, ...body }),
  delete: (id: number) => api.post('/instance-groups?action=delete', { id }),
  move: (instanceId: number, groupId: number | null) => api.post('/instance-groups?action=move', { instance_id: instanceId, group_id: groupId })
};

export const schoolsApi = {
  joined: () => api.get<any[]>('/schools?action=joined'),
  all: () => api.get<any[]>('/auth/schools'),
  requestJoin: (schoolId: number, displayName?: string) => api.post('/schools?action=request-join', { school_id: schoolId, display_name: displayName }),
  myRequests: () => api.get('/schools?action=my-requests'),
  listRequests: (schoolId: number) => api.get(`/schools?action=join-requests&school_id=${schoolId}`),
  approve: (requestId: number, approve: boolean) => api.post('/schools?action=approve', { request_id: requestId, approve }),
  switch: (schoolId: number) => api.post('/schools?action=switch', { school_id: schoolId })
};

export const aiApi = {
  listSessions: (scope?: string) => api.get<any[]>(`/ai/chat?action=sessions${scope ? `&scope=${scope}` : ''}`),
  listMessages: (sessionId: number) => api.get<any[]>(`/ai/chat?action=messages&session_id=${sessionId}`),
  send: (sessionId: number | null, content: string, scope: string, scopeRef?: number, model?: string) =>
    api.post('/ai/chat?action=send', { session_id: sessionId, content, scope, scope_ref: scopeRef, model }),
  deleteSession: (sessionId: number) => api.post('/ai/chat?action=delete', { session_id: sessionId }),
  // 流式发送（通过 Vite 代理，避免跨域 cookie 问题）
  sendStream: (sessionId: number | null, content: string, scope: string, scopeRef?: number, model?: string) =>
    fetch('/api/ai/chat?action=send_stream', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, content, scope, scope_ref: scopeRef, model }),
    }),
  // 模型管理
  listModels: () => api.get<any[]>('/ai/models?action=list'),
  createModel: (data: any) => api.post('/ai/models?action=create', data),
  updateModel: (id: number, data: any) => api.post('/ai/models?action=update', { id, ...data }),
  deleteModel: (id: number) => api.post('/ai/models?action=delete', { id }),
  testModel: (id: number) => api.post('/ai/models?action=test', { id }),
};

export const storageApi = {
  list: (instanceId: number, collectionKey: string) => api.get<any[]>(`/instance-storage?action=list&instance_id=${instanceId}&collection_key=${encodeURIComponent(collectionKey)}`),
  save: (instanceId: number, collectionKey: string, record: any) => api.post('/instance-storage?action=save', { instance_id: instanceId, collection_key: collectionKey, record }),
  delete: (instanceId: number, collectionKey: string, recordId: string) => api.post('/instance-storage?action=delete', { instance_id: instanceId, collection_key: collectionKey, record_id: recordId })
};

/** 将 FS 返回的 _id 映射为 id，保持前端兼容 */
function normalizeItem(item: any): any {
  if (!item) return item;
  if (item._id !== undefined && item.id === undefined) item.id = item._id;
  return item;
}

export const devApi = {
  listApps: async () => { const r = await api.get<any[]>('/dev/apps?action=list'); return (r || []).map(normalizeItem); },
  getApp: async (id: number) => { const r = await api.get<any>(`/dev/apps?action=get&id=${id}`); return normalizeItem(r); },
  publishedApps: async () => { const r = await api.get<any[]>('/dev/apps?action=published'); return (r || []).map(normalizeItem); },
  createApp: async (body: any) => { const r = await api.post('/dev/apps?action=create', body); return normalizeItem(r); },
  updateApp: (id: number, body: any) => api.post('/dev/apps?action=update', { id, ...body }),
  saveManifest: (id: number, type: string, value: any) => api.post('/dev/apps?action=save-manifest', { id, type, value }),
  publishApp: (id: number) => api.post('/dev/apps?action=publish', { id }),
  archiveApp: (id: number) => api.post('/dev/apps?action=archive', { id }),
  deleteApp: (id: number) => api.post('/dev/apps?action=delete', { id }),
  // 共享市场
  sharedList: async (keyword?: string) => {
    const r = await api.get<any[]>(`/dev/apps?action=shared-list${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ''}`);
    return (r || []).map(normalizeItem);
  },
  sharedGet: async (id: number) => { const r = await api.get<any>(`/dev/apps?action=shared-get&id=${id}`); return normalizeItem(r); },
  toggleShare: (id: number) => api.post('/dev/apps?action=share', { id }),
  forkApp: async (id: number) => { const r = await api.post('/dev/apps?action=fork', { id }); return normalizeItem(r); },
  // 市场 - 插件
  pluginSharedList: async (keyword?: string) => {
    const r = await api.get<any[]>(`/dev/plugins?action=shared-list${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ''}`);
    return (r || []).map(normalizeItem);
  },
};

export const subUsersApi = {
  list: () => api.get<any[]>('/sub-users?action=list'),
  schoolBindings: () => api.get<any[]>('/sub-users?action=school-bindings'),
  create: (body: any) => api.post('/sub-users?action=create', body),
  update: (id: number, body: any) => api.post('/sub-users?action=update', { id, ...body }),
  delete: (id: number) => api.post('/sub-users?action=delete', { id }),
  resetPassword: (id: number, password: string) =>
    api.post('/sub-users?action=reset-password', { id, password }),
  schoolUnbind: (bindingId: number) =>
    api.post('/sub-users?action=school-unbind', { binding_id: bindingId })
};

export const pluginApi = {
  list: async () => { const r = await api.get<any[]>('/dev/plugins?action=list'); return (r || []).map(normalizeItem); },
  get: async (id: number) => { const r = await api.get<any>(`/dev/plugins?action=get&id=${id}`); return normalizeItem(r); },
  published: async () => { const r = await api.get<any[]>('/dev/plugins?action=published'); return (r || []).map(normalizeItem); },
  resolver: async (ext: string) => {
    const result = await api.get<any>(`/dev/plugins?action=resolver&ext=${encodeURIComponent(ext)}`);
    return result?._id || result?.id ? normalizeItem(result) : null;
  },
  create: async (body: any) => { const r = await api.post('/dev/plugins?action=create', body); return normalizeItem(r); },
  update: (id: number, body: any) => api.post('/dev/plugins?action=update', { id, ...body }),
  publish: (id: number) => api.post('/dev/plugins?action=publish', { id }),
  archive: (id: number) => api.post('/dev/plugins?action=archive', { id }),
  delete: (id: number) => api.post('/dev/plugins?action=delete', { id })
};

export const campusApi = {
  overview: () => api.get<any>('/campus-control?action=overview'),
  listUnits: () => api.get<any[]>('/campus-control?action=list'),
  getUnit: (id: number) => api.get<any>(`/campus-control?action=get&id=${id}`),
  createUnit: (body: any) => api.post('/campus-control?action=create', body),
  updateUnit: (id: number, body: any) => api.post('/campus-control?action=update', { id, ...body }),
  deleteUnit: (id: number) => api.post('/campus-control?action=delete', { id }),
  saveVariables: (id: number, variables: any) => api.post('/campus-control?action=save-variables', { id, variables })
};

export const hostingApi = {
  getSpace: () => api.get<any>('/web-hosting?action=get'),
  updateSpace: (body: any) => api.post('/web-hosting?action=update', body),
  listFiles: () => api.get<any>('/web-hosting?action=list-files'),
  getFile: (path: string) => api.post<any>('/web-hosting?action=get-file', { path }),
  saveFile: (body: any) => api.post('/web-hosting?action=save-file', body),
  deleteFile: (path: string) => api.post('/web-hosting?action=delete-file', { path }),
  createDirectory: (path: string) => api.post('/web-hosting?action=create-directory', { path }),
  getUsage: () => api.get<any>('/web-hosting?action=usage'),
  getReviewStatus: () => api.get<any>('/web-hosting?action=get-review-status'),
  upload: (file: File, dir?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (dir) form.append('dir', dir);
    return request<any>('/web-hosting?action=upload', {
      method: 'POST',
      body: form,
      headers: {} as any,
    });
  },
  downloadUrl: (path: string) => `/api/web-hosting?action=download&path=${encodeURIComponent(path)}`,
};

export const adminApi = {
  users: () => api.get<any[]>('/admin/manage?action=users'),
  config: () => api.get<any>('/admin/manage?action=config'),
  setSuperAdmin: (userId: number, isSuperAdmin: boolean) =>
    api.post('/admin/manage?action=set-super-admin', { user_id: userId, is_super_admin: isSuperAdmin }),
  setRole: (userId: number, role: string) =>
    api.post('/admin/manage?action=set-role', { user_id: userId, role }),
  toggleTempAdmin: (enabled: boolean) =>
    api.post('/admin/manage?action=toggle-temp-admin', { enabled }),
  resetPassword: (userId: number, password: string) =>
    api.post('/admin/manage?action=reset-password', { user_id: userId, password }),
  schools: () => api.get<any[]>('/admin/manage?action=schools'),
  createNotification: (body: any) => api.post('/admin/manage?action=create-notification', body),
  // AI 配置
  aiConfig: () => api.get<any>('/admin/manage?action=ai-config'),
  saveAiConfig: (data: any) => api.post('/admin/manage?action=save-ai-config', data),
  listAiModels: () => api.get<any[]>('/admin/manage?action=list-ai-models'),
  createAiModel: (data: any) => api.post('/admin/manage?action=create-ai-model', data),
  updateAiModel: (id: number, data: any) => api.post('/admin/manage?action=update-ai-model', { id, ...data }),
  deleteAiModel: (id: number) => api.post('/admin/manage?action=delete-ai-model', { id }),
  // 知识库
  listKbEntries: () => api.get<any[]>('/admin/manage?action=list-kb'),
  createKbEntry: (data: any) => api.post('/admin/manage?action=create-kb', data),
  updateKbEntry: (id: number, data: any) => api.post('/admin/manage?action=update-kb', { id, ...data }),
  deleteKbEntry: (id: number) => api.post('/admin/manage?action=delete-kb', { id }),
  // 网页空间管理
  listWebSpaces: () => api.get<any[]>('/admin/manage?action=list-web-spaces'),
  toggleWebSpaceAdmin: (spaceId: number, disabled: boolean, reason: string) =>
    api.post('/admin/manage?action=toggle-web-space-admin', { space_id: spaceId, disabled, reason }),
  deleteWebSpace: (spaceId: number) =>
    api.post('/admin/manage?action=delete-web-space', { space_id: spaceId }),
  listPendingReviews: () => api.get<any[]>('/admin/manage?action=list-pending-reviews'),
  approveReview: (spaceId: number) =>
    api.post('/admin/manage?action=approve-review', { space_id: spaceId }),
  getReviewDiff: (fileId: number) =>
    api.get<any>(`/admin/manage?action=get-review-diff&file_id=${fileId}`),
  // 数据空间管理
  listDataSpaces: (sortBy?: string, sortOrder?: string) =>
    api.get<any[]>(`/admin/manage?action=list-data-spaces&sort_by=${sortBy || 'used'}&sort_order=${sortOrder || 'desc'}`),
};

export const helpApi = {
  // 公开读取（需登录）
  tree: () => api.get<any[]>('/help?action=tree'),
  get: (id: number) => api.get<any>(`/help?action=get&id=${id}`),
  // 管理后台（需最高管理员）
  list: () => api.get<any[]>('/admin/manage?action=list-help'),
  createCategory: (data: any) => api.post('/admin/manage?action=create-help-category', data),
  updateCategory: (id: number, data: any) => api.post('/admin/manage?action=update-help-category', { id, ...data }),
  deleteCategory: (id: number) => api.post('/admin/manage?action=delete-help-category', { id }),
  createArticle: (data: any) => api.post('/admin/manage?action=create-help-article', data),
  updateArticle: (id: number, data: any) => api.post('/admin/manage?action=update-help-article', { id, ...data }),
  deleteArticle: (id: number) => api.post('/admin/manage?action=delete-help-article', { id }),
};

export const profileApi = {
  get: () => api.get<any>('/profile?action=profile'),
  update: (body: { display_name: string; email: string; phone: string; department: string }) =>
    api.post('/profile?action=update-profile', body),
  changePassword: (oldPassword: string, newPassword: string) =>
    api.post('/profile?action=change-password', { old_password: oldPassword, new_password: newPassword }),
  updateAvatar: (avatar: string) =>
    api.post('/profile?action=update-avatar', { avatar }),
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<any>('/profile?action=upload-avatar', {
      method: 'POST',
      body: form,
      headers: {} as any,
    });
  },
  savePreferences: (preferences: any) =>
    api.post('/profile?action=save-preferences', { preferences }),
};

export const notificationsApi = {
  list: (type?: string) => api.get<any[]>(`/notifications?action=list${type ? `&type=${type}` : ''}`),
  stats: () => api.get<any>('/notifications?action=stats'),
  markRead: (id?: number) => api.post('/notifications?action=mark-read', { id: id || 0 }),
  delete: (id: number) => api.post('/notifications?action=delete', { id }),
  create: (body: any) => api.post('/notifications?action=create', body),
  recipients: () => api.get<any>('/notifications?action=recipients')
};

export const instanceFilesApi = {
  list: (instanceId: number, dir?: string) =>
    api.get<any>(`/instance-files?action=list&instance_id=${instanceId}${dir ? `&dir=${encodeURIComponent(dir)}` : ''}`),
  get: (id: number) =>
    api.get<any>(`/instance-files?action=get&id=${id}`),
  save: (body: { id?: number; instance_id: number; directory?: string; name: string; content: string; file_type?: string; file_category?: string }) =>
    api.post('/instance-files?action=save', body),
  delete: (id: number) =>
    api.post('/instance-files?action=delete', { id }),
  resolveEditor: (ext: string) =>
    api.get<any>(`/instance-files?action=resolve-editor&ext=${encodeURIComponent(ext)}`),
  storageStats: (instanceId: number) =>
    api.get<any>(`/instance-files?action=storage-stats&instance_id=${instanceId}`),
  fileTree: (instanceId: number) =>
    api.get<any>(`/instance-files?action=file-tree&instance_id=${instanceId}`),
};

export const dataSpaceApi = {
  tree: () => api.get<any>('/data-space?action=tree'),
  get: (params: Record<string, any>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    return api.get<any>(`/data-space?action=get&${qs.toString()}`);
  },
  save: (body: any) => api.post('/data-space?action=save', body),
  delete: (body: any) => api.post('/data-space?action=delete', body),
  usage: () => api.get<any>('/data-space?action=usage'),
  createWebSpace: (body: any) => api.post('/data-space?action=create-webspace', body),
  updateWebSpace: (body: any) => api.post('/data-space?action=update-webspace', body),
  webspaceCreateFile: (body: any) => api.post('/data-space?action=webspace-create-file', body),
  webspaceCreateDir: (body: any) => api.post('/data-space?action=webspace-create-dir', body),
  webspaceUpload: (file: File, spaceId: number, dir?: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('space_id', String(spaceId));
    if (dir) form.append('dir', dir);
    return request<any>('/data-space?action=webspace-upload', {
      method: 'POST',
      body: form,
      headers: {} as any,
    });
  },
};

export const dataExportApi = {
  history: () => api.get<any[]>('/data-export?action=history'),
  exportDataspace: (body: any) => api.post<any>('/data-export?action=export-dataspace', body),
};
