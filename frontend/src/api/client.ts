const API_BASE = '/api';

export interface ApiResult<T = any> {
  code: number;
  message: string;
  data: T;
}

export async function request<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...(options.headers as Record<string, string>)
  };

  const response = await fetch(`${API_BASE}${url}`, {
    credentials: 'include',
    ...options,
    headers
  });

  if (response.status === 401) {
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
    }
    throw new Error('未登录或登录已过期');
  }

  if (!response.ok) {
    // 尝试读取服务器返回的错误信息
    let serverMsg = '';
    try {
      const errBody = await response.json();
      serverMsg = errBody.message || '';
    } catch (_) { /* ignore parse error */ }
    throw new Error(serverMsg || `请求失败 (HTTP ${response.status})`);
  }

  const data: ApiResult<T> = await response.json();
  if (data.code !== 0 && data.code !== undefined) {
    throw new Error(data.message || '请求失败');
  }
  return data.data ?? data;
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: any) => request<T>(url, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined
  }),
  delete: <T>(url: string) => request<T>(url, { method: 'DELETE' })
};
