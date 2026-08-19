import { elementToMarkdown, fetchHtml, ParsedArticle } from "../utils";
import { ContentParser } from "./types";

// 小红书笔记解析器。
//
// 背景：小红书分享短链（xhslink.cn/xhslink.com/o/xxx）302 跳转到笔记详情页
// （xiaohongshu.com/discovery/item/{note_id}?xsec_token=...），笔记正文/图片/作者
// 以 SSR JSON 形式内嵌在 window.__INITIAL_STATE__ 中；DOM 正文容器（.note-content）
// 依赖 JS 渲染且图片懒加载，稳定性不如直接读初始状态。故优先解析初始状态 JSON，
// 失败时回退 DOM 选择器。
//
// 注意：__INITIAL_STATE__ 并非严格 JSON（含 undefined / !0 / !1 等 JS 字面量），
// 解析前需清洗为 null/true/false。
export class XiaohongshuParser implements ContentParser {
  kind = "小红书";

  // 直接按 URL 拉取：fetchHtml 自动跟随短链 302，取到带 xsec_token 的笔记详情页。
  async parseFromUrl(url: string): Promise<ParsedArticle | null> {
    try {
      const html = await fetchHtml(url);
      return parseXiaohongshuHtml(html);
    } catch (e) {
      // 网络异常等不阻断：由调用方回退 HTML 解析
      return null;
    }
  }

  parse(html: string): ParsedArticle {
    return parseXiaohongshuHtml(html);
  }
}

// 提取并解析 window.__INITIAL_STATE__（清洗 JS 字面量后 JSON.parse）。
function parseInitialState(html: string): any | null {
  const start = html.indexOf("window.__INITIAL_STATE__");
  if (start === -1) return null;
  const eq = html.indexOf("=", start);
  if (eq === -1) return null;
  const end = html.indexOf("</script>", eq);
  if (end === -1) return null;
  let s = html.slice(eq + 1, end).trim();
  if (s.endsWith(";")) s = s.slice(0, -1);
  // 小红书 SSR JSON 偶发非严格字面量：undefined / !0 / !1
  s = s
    .replace(/:undefined(?=[,}])/g, ":null")
    .replace(/:!0(?=[,}])/g, ":true")
    .replace(/:!1(?=[,}])/g, ":false");
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

// 笔记图片 URL 归一化：http:// 与 // 前缀统一转 https://（CDN 均支持 https）。
function normalizeImageUrl(u: string): string {
  if (!u) return "";
  if (u.startsWith("//")) return "https:" + u;
  if (u.startsWith("http://")) return "https://" + u.slice(7);
  return u;
}

// 主解析：SSR JSON 优先，DOM 兜底。
function parseXiaohongshuHtml(html: string): ParsedArticle {
  const state = parseInitialState(html);
  const noteMap = (state && state.note && state.note.noteDetailMap) || {};
  const keys = Object.keys(noteMap);
  const note = keys.length ? noteMap[keys[0]].note : null;
  if (note) {
    const title = ((note.title || "").trim()) || "小红书笔记";
    // 笔记正文：desc 为纯文本（含换行与 [话题] 标签标记），去标记保留 #话题
    const desc = (note.desc || "")
      .replace(/\[话题\]/g, "")
      .trim();
    // 图片：urlDefault 为笔记原图（web 端无水印），统一 https
    const images = ((note.imageList as any[]) || [])
      .map((i) => normalizeImageUrl(i.urlDefault || i.url || ""))
      .filter((u) => /^https?:/.test(u));
    const imgMd = images.map((u, i) => `![图片${i + 1}](${u})`).join("\n\n");
    const content = [desc, imgMd].filter(Boolean).join("\n\n");
    return { title, content, images };
  }

  // 兜底：DOM 选择器（旧页面结构 / 初始状态缺失时）
  const doc = new DOMParser().parseFromString(html, "text/html");
  const titleEl =
    doc.querySelector(".note-title") ||
    doc.querySelector("#detail-title") ||
    doc.querySelector("h1") ||
    doc.querySelector("title");
  const title = (titleEl?.textContent || doc.title || "小红书笔记")
    .replace(/\s*-\s*小红书\s*$/, "")
    .trim();

  const root =
    doc.querySelector(".note-content") ||
    doc.querySelector(".desc") ||
    doc.querySelector("article") ||
    doc.body;
  const { content, images } = elementToMarkdown(root as HTMLElement);
  return { title, content, images };
}
