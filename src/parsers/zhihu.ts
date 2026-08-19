import { elementToMarkdown, fetchHtml, ParsedArticle } from "../utils";
import { ContentParser } from "./types";

// 知乎解析器：优先走官方只读 API 拉取回答正文，失败/非回答形态回退 HTML 选择器。
//
// 背景：www.zhihu.com / zhuanlan.zhihu.com 对非浏览器请求一律返回 JS 反爬验证页
// （zse-ck challenge，HTTP 403），直接 fetchHtml 拿不到正文 DOM，现有
// .RichText 等选择器必然落空。而知乎回答 API 无需签名、公开可读：
//   GET https://www.zhihu.com/api/v4/answers/{answer_id}?include=content,excerpt,author,question,voteup_count,comment_count
//   返回 JSON：content 为正文 HTML（含图片、外链），question.title 为问题标题，
//   author.name 为回答者。故回答链接（/question/{qid}/answer/{aid}、?answer_id={aid}）
//   走 API；专栏文章 / 想法 / 问题页等形态无此 API，回退 HTML 解析（现状）。
export class ZhihuParser implements ContentParser {
  kind = "知乎";

  // 从 URL 中提取知乎回答 ID，支持两种形态：
  //   https://www.zhihu.com/question/{qid}/answer/{aid}         （path）
  //   https://www.zhihu.com/question/{qid}?answer_id={aid}      （query）
  static extractAnswerId(url: string): string | null {
    const u = url || "";
    const m = u.match(/\/answer\/(\d+)/) || u.match(/[?&]answer_id=(\d+)/);
    return m ? m[1] : null;
  }

  async parseFromUrl(url: string): Promise<ParsedArticle | null> {
    const aid = ZhihuParser.extractAnswerId(url);
    if (!aid) return null; // 专栏文章/想法/问题页等形态，回退 HTML 解析
    try {
      const json = await fetchHtml(
        `https://www.zhihu.com/api/v4/answers/${aid}?include=content,excerpt,author,question,voteup_count,comment_count`
      );
      const data = JSON.parse(json);
      const rawHtml = data && data.content;
      if (!rawHtml) return null;
      // 知乎对未登录游客的长回答做服务端裁剪（content_need_truncated=true），
      // 仅返回开头片段，API 与网页行为一致、无法绕过。检测到截断时在正文末尾
      // 追加提示，避免笔记呈现为"不完整的半截内容"却无解释。
      const truncated = !!(data && data.content_need_truncated);

      // 知乎正文外链统一包在 https://link.zhihu.com/?target=<urlencoded> 里，
      // 先还原为真实目标地址，避免笔记里残留跳转壳。
      const html = rawHtml.replace(
        /https:\/\/link\.zhihu\.com\/\?target=([^"'<>\s]+)/g,
        (_m: string, t: string) => decodeURIComponent(t)
      );

      // 包一层容器再交给 elementToMarkdown（其按块级容器输出 Markdown）
      const doc = new DOMParser().parseFromString(
        `<div id="zhihu-content">${html}</div>`,
        "text/html"
      );
      const root = doc.getElementById("zhihu-content") as HTMLElement;
      const { content, images } = elementToMarkdown(root);

      const title = (data.question && data.question.title) || "知乎";
      if (!truncated) return { title, content, images };
      return {
        title,
        content:
          `${content}\n\n---\n\n` +
          `> ⚠️ 该回答较长，知乎对未登录访问仅提供开头片段（本文为部分内容）。` +
          `完整回答请打开原文查看：${url}\n`,
        images,
      };
    } catch (e) {
      // API 异常（网络/JSON 解析/限流）不阻断：回退 HTML 解析
      return null;
    }
  }

  parse(html: string): ParsedArticle {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const titleEl =
      doc.querySelector(".Post-Title") ||
      doc.querySelector("h1") ||
      doc.querySelector("title");
    const title = (titleEl?.textContent || doc.title || "知乎文章").trim();

    const root =
      doc.querySelector(".RichText") ||
      doc.querySelector(".Post-RichText") ||
      doc.querySelector(".ArticleItem-content") ||
      doc.querySelector("article") ||
      doc.body;
    const { content, images } = elementToMarkdown(root as HTMLElement);
    return { title, content, images };
  }
}
