import { elementToMarkdown, ParsedArticle } from "../utils";
import { ContentParser } from "./types";

// 今日头条解析器：独立选择正文容器与标题，与微信逻辑解耦。
export class ToutiaoParser implements ContentParser {
  kind = "今日头条";
  parse(html: string): ParsedArticle {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const titleEl =
      doc.querySelector(".article-title") ||
      doc.querySelector("h1") ||
      doc.querySelector("title");
    const title = (titleEl?.textContent || doc.title || "今日头条文章").trim();

    const root =
      doc.querySelector(".article-content") ||
      doc.querySelector(".tt-article-content") ||
      doc.querySelector("article") ||
      doc.body;
    const { content, images } = elementToMarkdown(root as HTMLElement);
    return { title, content, images };
  }
}
