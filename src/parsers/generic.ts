import { elementToMarkdown, ParsedArticle } from "../utils";
import { ContentParser } from "./types";

// 通用兜底解析器：无法匹配具体平台时使用，按主流语义容器（main/article/body）提取正文。
export class GenericParser implements ContentParser {
  kind = "其他";
  parse(html: string): ParsedArticle {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const title = (doc.querySelector("h1")?.textContent || doc.title || "网页文章").trim();
    const root =
      doc.querySelector("main") ||
      doc.querySelector("article") ||
      doc.body;
    const { content, images } = elementToMarkdown(root as HTMLElement);
    return { title, content, images };
  }
}
