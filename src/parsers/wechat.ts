import { parseWechatArticle, ParsedArticle } from "../utils";
import { ContentParser } from "./types";

// 微信公众号解析器：复用既有 parseWechatArticle（微信专属容器选择器与兜底逻辑）。
// 作为 ContentParser 的适配器，使微信逻辑与新增平台走同一套调度入口。
export class WechatParser implements ContentParser {
  kind = "微信公众号";
  parse(html: string): ParsedArticle {
    return parseWechatArticle(html);
  }
}
