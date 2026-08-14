import { elementToMarkdown, ParsedArticle } from "../utils";
import { ContentParser } from "./types";

// 小红书解析器：独立选择笔记正文容器与标题，正文化统一交由通用 Markdown 引擎。
// 与微信公众号解析逻辑完全解耦，仅复用底层 DOM->Markdown 原语。
export class XiaohongshuParser implements ContentParser {
  kind = "小红书";
  parse(html: string): ParsedArticle {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const titleEl =
      doc.querySelector(".note-title") ||
      doc.querySelector("#detail-title") ||
      doc.querySelector("h1") ||
      doc.querySelector("title");
    const title = (titleEl?.textContent || doc.title || "小红书笔记").trim();

    const root =
      doc.querySelector(".note-content") ||
      doc.querySelector(".desc") ||
      doc.querySelector("article") ||
      doc.body;
    const { content, images } = elementToMarkdown(root as HTMLElement);
    return { title, content, images };
  }
}
