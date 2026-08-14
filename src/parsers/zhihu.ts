import { elementToMarkdown, ParsedArticle } from "../utils";
import { ContentParser } from "./types";

// 知乎解析器：独立选择回答/文章正文容器与标题，与微信逻辑解耦。
export class ZhihuParser implements ContentParser {
  kind = "知乎";
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
