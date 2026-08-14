import { requestUrl } from "obsidian";
import {
  Article,
  ApiKeyInfo,
  BindVerifyResponse,
  ConfirmResult,
  ConfirmResp,
  Paged,
} from "./types";

// ApiClient 封装与后端 obsync-server 的通信。
// 插件使用 Obsidian 提供的 requestUrl 以绕过浏览器 CORS 限制。
// 鉴权方式：通过 X-Api-Key 头携带微信生成的 API Key（支持配置多个）。

// 递归脱敏：api_key / token / secret 等敏感字段一律完全隐藏，不泄露明文。
function maskSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(maskSensitive);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/api_key|apikey|token|secret/i.test(k)) {
        out[k] = "****";
      } else {
        out[k] = maskSensitive(v);
      }
    }
    return out;
  }
  return value;
}

// 脱敏请求头：X-Api-Key 携带完整 API Key，日志中必须隐藏。
function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...headers };
  if (out["X-Api-Key"]) out["X-Api-Key"] = "****";
  return out;
}

// 出参可能较大（如文章列表），转为 JSON 后截断，避免刷屏。
function truncateJSON(value: unknown, limit = 2000): string {
  try {
    const s = JSON.stringify(value);
    return s.length > limit ? s.slice(0, limit) + `…(截断 ${s.length - limit} 字符)` : s;
  } catch {
    return "[无法序列化]";
  }
}

export class ApiClient {
  private base = "";
  private apiKeys: string[] = [];

  constructor(base: string) {
    this.base = base;
  }

  setBase(url: string) {
    this.base = url;
  }

  setApiKeys(keys: string[]) {
    this.apiKeys = (keys || []).filter((k) => !!k);
  }

  getApiKeys(): string[] {
    return this.apiKeys;
  }

  private async req<T>(
    method: string,
    path: string,
    body?: unknown,
    key?: string
  ): Promise<T> {
    // 候选 Key 列表：
    // - 显式传入 key（数据类接口，需按用户隔离）→ 只用该 key，鉴权失败不跨 Key 重试（否则会串号）
    // - 未传 key（管理类接口，任一有效 Key 均可鉴权）→ 用全部 Key，遇鉴权失败自动切换下一个有效 Key
    const candidates = key ? [key] : this.apiKeys.slice();
    // 防御：若没有任何候选 Key（如首次绑定前 this.apiKeys 仍为空），
    // 仍以「不带 X-Api-Key 头」的方式发起一次请求，避免 candidates 为空时
    // for 循环不执行、最终 throw undefined 导致调用方完全无反馈（点击无反应）。
    if (candidates.length === 0) candidates.push("");
    let lastErr: unknown;
    for (let i = 0; i < candidates.length; i++) {
      try {
        return await this.doRequest<T>(method, path, body, candidates[i]);
      } catch (e) {
        // 后端业务异常统一 HTTP 200，以响应体 code 标识；故按 code 判定是否可重试
        const code = (e as { code?: number }).code;
        // 仅当业务 code 为鉴权/Key 失效(401/403/404) 且还有其它候选 Key 时重试；
        // 400(参数)/500(系统) 等直接抛出，不重试
        const authFail = code === 401 || code === 403 || code === 404;
        if (authFail && candidates.length > 1 && i < candidates.length - 1) {
          lastErr = e;
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  private async doRequest<T>(
    method: string,
    path: string,
    body: unknown | undefined,
    apiKey: string
  ): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["X-Api-Key"] = apiKey;

    const url = this.base + path;
    console.log(`[weixin-sync] 请求入参 ${method} ${url}`, body);

    try {
      const resp = await requestUrl({
        url,
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = resp.json as { code: number; msg: string; data: T };
      if (data.code !== 0) {
        // 后端统一返回 HTTP 200，业务结果以 Body.Code 标识（0 成功；401/403/404 鉴权或 Key 失效）
        console.error(`[weixin-sync] 请求失败 ${method} ${url} -> code=${data.code} msg=${data.msg}`);
        // 透传业务 code 供上层（req 重试 / 调用方判断）使用
        throw Object.assign(new Error(data.msg || "请求失败"), { code: data.code });
      }
      console.log(`[weixin-sync] 响应 ${method} ${url}`, truncateJSON(data.data));
      return data.data;
    } catch (e) {
      // Obsidian 的 requestUrl 仅在实际 HTTP>=400（如 ServerError 500 / 网络错误）时抛出；
      // 业务异常（HTTP 200 + code!=0）走上面的 data.code 分支，已带 code。
      const err = e as {
        message?: string;
        code?: number;
        status?: number;
        response?: { status?: number; json?: { code?: number; msg?: string } };
      };
      // 优先用响应体业务 code；其次用真实 HTTP 状态码（仅 500 类系统/网络错误会到这）
      const code = err?.code ?? err?.response?.json?.code ?? err?.status ?? err?.response?.status;
      const backendMsg = err?.response?.json?.msg ?? err?.message;
      console.error(
        `[weixin-sync] 请求异常 ${method} ${url} -> code=${code ?? "?"} msg=${backendMsg}`,
        err?.response?.json ?? e
      );
      throw Object.assign(new Error(backendMsg || "请求失败"), { code });
    }
  }

  /** 输入 API Key 完成绑定（无需登录）。 */
  bindVerify(apiKey: string, deviceName: string, deviceCode?: string): Promise<BindVerifyResponse> {
    // 把待绑定的 apiKey 自身作为候选鉴权 Key 传入：
    // 后端 /bind/verify 用请求体里的 api_key 完成绑定（无需已配置的 Key），
    // 此处传入可保证「首次绑定、this.apiKeys 仍为空」时 req 仍能真正发出请求。
    return this.req("POST", "/api/v1/bind/verify", {
      api_key: apiKey,
      device_name: deviceName,
      device_code: deviceCode,
    }, apiKey);
  }

  /** 查询当前 API Key 已绑定的设备与绑定关系。 */
  listBindings(key?: string): Promise<{ device: any; bindings: ApiKeyInfo[] }> {
    return this.req("GET", "/api/v1/bind/list", undefined, key);
  }

  /** 批量查询一组 API Key 的真实状态，一次调用返回列表（不要求已绑定/有效）。 */
  getKeyStatuses(keys: string[]): Promise<{ list: ApiKeyInfo[] }> {
    return this.req("POST", "/api/v1/apikey/status", { keys });
  }

  /** 解除当前 API Key 与设备的绑定。 */
  removeBinding(key?: string): Promise<{ ok: boolean }> {
    return this.req("POST", "/api/v1/bind/remove", undefined, key);
  }

  /** 拉取待同步文章（按指定 API Key 归属用户过滤）。 */
  listArticles(
    key: string,
    status = "submitted",
    page = 1,
    size = 50
  ): Promise<Paged<Article>> {
    return this.req(
      "GET",
      `/api/v1/article/list?status=${status}&page=${page}&size=${size}`,
      undefined,
      key
    );
  }

  /** 回写同步结果（按指定 API Key 归属用户回写）。 */
  confirm(results: ConfirmResult[], status: string, key: string): Promise<ConfirmResp> {
    return this.req("POST", "/api/v1/article/confirm", { status, results }, key);
  }
}
