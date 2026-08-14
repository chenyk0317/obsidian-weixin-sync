import { ContentParser } from "./types";
import { WechatParser } from "./wechat";
import { XiaohongshuParser } from "./xiaohongshu";
import { ZhihuParser } from "./zhihu";
import { JuejinParser } from "./juejin";
import { ToutiaoParser } from "./toutiao";
import { GenericParser } from "./generic";

// content_kind -> 解析器 注册表。新增平台：实现一个 ContentParser 并在此注册即可，
// 无需改动 sync.ts 的调度逻辑（开闭原则）。
const registry: Record<string, ContentParser> = {
  "微信公众号": new WechatParser(),
  "小红书": new XiaohongshuParser(),
  "知乎": new ZhihuParser(),
  "稀土掘金": new JuejinParser(),
  "今日头条": new ToutiaoParser(),
  "其他": new GenericParser(),
};

// 按 URL 域名推断应使用哪个解析器（用于 content_kind 为「其他」或未知的情况）。
function detectByUrl(url: string): ContentParser {
  const u = (url || "").toLowerCase();
  if (u.includes("mp.weixin.qq.com") || u.includes("weixin.qq.com")) return registry["微信公众号"];
  if (u.includes("xiaohongshu.com") || u.includes("xhslink.com")) return registry["小红书"];
  if (u.includes("zhihu.com")) return registry["知乎"];
  if (u.includes("juejin.cn")) return registry["稀土掘金"];
  if (u.includes("toutiao.com")) return registry["今日头条"];
  return new GenericParser();
}

// 选取解析器：优先按 content_kind；未知/其他时按域名兜底；最终兜底通用解析器。
export function getParser(kind: string, url = ""): ContentParser {
  if (kind && registry[kind]) return registry[kind];
  return detectByUrl(url);
}

export type { ContentParser };
