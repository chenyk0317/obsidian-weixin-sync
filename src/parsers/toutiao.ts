import { elementToMarkdown, fetchHtml, MOBILE_BROWSER_UA, ParsedArticle } from "../utils";
import { ContentParser } from "./types";

// 今日头条解析器。
//
// 背景：www.toutiao.com 对非浏览器请求（含桌面 UA）一律返回 JS 反爬壳
// （_$jsvmprt 混淆脚本，正文为空）；而**移动 UA 请求 m.toutiao.com 返回真实 H5 页面**，
// 文章标题/正文/作者内嵌在 <script id="RENDER_DATA"> 的 URL 编码 JSON 中：
//   articleInfo.title / articleInfo.content（正文 HTML）/ articleInfo.mediaUser.screenName（作者）。
// 分享短链（m.toutiao.com/is/XXXX/）用移动 UA 请求会 302 到 m 域 H5 页，无需预解析短码。
export class ToutiaoParser implements ContentParser {
  kind = "今日头条";

  // 直接用移动 UA 拉取（自动跟随短链跳转 → m 域 H5 页），解析 RENDER_DATA。
  async parseFromUrl(url: string): Promise<ParsedArticle | null> {
    try {
      const html = await fetchHtml(url, MOBILE_BROWSER_UA);
      return parseToutiaoHtml(html);
    } catch (e) {
      // 网络异常等不阻断：由调用方回退 HTML 解析
      return null;
    }
  }

  parse(html: string): ParsedArticle {
    return parseToutiaoHtml(html);
  }
}

// 提取并解析 <script id="RENDER_DATA"> 的 URL 编码 JSON。
function parseRenderData(html: string): any | null {
  const m = html.match(/id="RENDER_DATA"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(decodeURIComponent(m[1].trim()));
  } catch (e) {
    return null;
  }
}

// 主解析：RENDER_DATA JSON 优先，DOM 兜底。
function parseToutiaoHtml(html: string): ParsedArticle {
  const state = parseRenderData(html);
  const info = state && state.articleInfo;
  if (info && info.content) {
    const title = ((info.title || "").trim()) || "今日头条文章";
    // content 为正文 HTML，直接交给通用 Markdown 引擎转换
    const doc = new DOMParser().parseFromString(
      `<div id="tt-content">${info.content}</div>`,
      "text/html"
    );
    const root = doc.getElementById("tt-content") as HTMLElement;
    const { content, images } = elementToMarkdown(root);
    return { title, content, images };
  }

  // 兜底：DOM 选择器（旧页面结构 / RENDER_DATA 缺失时）
  const doc = new DOMParser().parseFromString(html, "text/html");
  const titleEl =
    doc.querySelector(".article-title") ||
    doc.querySelector("h1") ||
    doc.querySelector("title");
  const title = (titleEl?.textContent || doc.title || "今日头条文章")
    .replace(/\s*-\s*今日头条\s*$/, "")
    .trim();

  const root =
    doc.querySelector(".article-content") ||
    doc.querySelector(".tt-article-content") ||
    doc.querySelector("article") ||
    doc.body;
  const { content, images } = elementToMarkdown(root as HTMLElement);
  return { title, content, images };
}
