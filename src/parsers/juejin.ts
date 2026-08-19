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
    // 掘金 markdown 渲染会把行内图片与相邻文本粘连（<p><img>text</p> 或 <p>text<img></p>
    // → ![..](..)text / text![..](..)），在图片与文本之间补换行，保证 Obsidian 渲染时图片独立成行。
    const fixed = content
      .replace(/(!\[[^\]]*\]\([^)]*\))(?=\S)/g, "$1\n\n") // 图片后紧跟文本
      .replace(/(\S)(!\[[^\]]*\]\([^)]*\))/g, "$1\n\n$2"); // 文本后紧跟图片
    return { title, content: fixed, images };
  }
}
