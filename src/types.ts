// 与后端交互的共享类型定义

export interface Article {
  id: string;
  user_id: string;
  device_id?: string;
  sync_id: string;
  title: string;
  source_url?: string;
  source?: string;
  author?: string;
  content?: string;
  content_kind: string; // 微信公众号 | 小红书 | 知乎 | 稀土掘金 | 今日头条 | 随笔 | 其他
  status: string; // submitted | synced | updated
  created_at: string;
  synced_at?: string;
  updated_at: string;
}

export interface Paged<T> {
  list: T[];
  total: number;
  page: number;
  size: number;
}

// 对外展示的 API Key（key 已掩码）
export interface ApiKeyInfo {
  id: string;
  name?: string;
  key_masked: string;
  status: 'active' | 'revoked' | 'invalid';
  device_id?: string;
  device_name?: string;
  last_used_at?: string;
  expires_at?: string;
  created_at: string;
}

// 插件调用 /bind/verify 的返回
export interface BindVerifyResponse {
  bound: boolean;
  device_id: string;
  device_code: string; // 后端返回的设备唯一编码
  device_name: string;
  user_id: string;
}

export interface ConfirmResult {
  sync_id: string;
  success: boolean;
  message?: string;
}

export interface ConfirmResp {
  success: number;
  failed: number;
}
