import { elementToMarkdown, ParsedArticle } from "../utils";
import { ContentParser } from "./types";

// 稀土掘金解析器：独立选择 markdown 正文容器与标题，与微信逻辑解耦。
export class JuejinParser implements ContentParser {
  kind = "稀土掘金";
  parse(html: string): ParsedArticle {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const titleEl =
      doc.querySelector(".article-title") ||
      doc.querySelector("h1") ||
      doc.querySelector("title");
    const title = (titleEl?.textContent || doc.title || "稀土掘金文章").trim();

    const root =
      doc.querySelector(".markdown-body") ||
      doc.querySelector(".article-content") ||
      doc.querySelector("article") ||
      doc.body;
    const { content, images } = elementToMarkdown(root as HTMLElement);
    return { title, content, images };
  }
}
