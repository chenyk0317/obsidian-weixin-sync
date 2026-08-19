import { ParsedArticle } from "../utils";

// 内容解析器统一接口：输入网页 HTML，输出标题 / 正文(Markdown) / 图片列表。
// 各平台（微信公众号 / 小红书 / 知乎 / 稀土掘金 / 今日头条）分别实现该接口，
// 彼此独立、互不依赖——新增平台只需新增一个实现类并在 parsers/index.ts 注册。
export interface ContentParser {
  // 对应的 content_kind 取值（与后端枚举、小程序保持一致）
  kind: string;
  parse(html: string): ParsedArticle;
  // 可选：直接按 URL 拉取并解析正文（适用于站点对纯 HTML 抓取有反爬、
  // 但提供公开只读 API 的平台，如知乎 answers API）。
  // 返回 null 表示该 URL 形态不支持或拉取失败，由调用方回退到 parse(html)。
  parseFromUrl?(url: string): Promise<ParsedArticle | null>;
}
