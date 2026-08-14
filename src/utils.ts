import { App, requestUrl } from "obsidian";
import { Article } from "./types";

// 清理文件名中的非法字符
export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|#^[\]]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80);
}

// 确保文件夹存在
export async function ensureFolder(app: App, path: string): Promise<void> {
  if (!path) return;
  try {
    const exists = await app.vault.adapter.exists(path);
    if (!exists) await app.vault.createFolder(path);
  } catch (e) {
    // 已存在等情况忽略
  }
}

// 按模板生成文件名，支持 {{saved_date}}/{{title}}/{{source}}/{{sync_id}}/{{author}}/{{url}}
export function fileNameFromTemplate(template: string, fields: Record<string, string>): string {
  return sanitizeFileName(
    template.replace(/\{\{(\w+)\}\}/g, (_, k) => fields[k] || "")
  );
}

// 按模板生成目录路径，支持与文件名字段相同的变量（{{saved_date}}/{{title}}/...）。
// 与 fileNameFromTemplate 不同：保留 "/" 作为层级分隔，仅对每个分段做清洗，避免把路径分隔符误清成下划线。
export function dirFromTemplate(template: string, fields: Record<string, string>): string {
  if (!template) return "";
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, k) => fields[k] || "")
    .split("/")
    .map((seg) => sanitizeSegment(seg))
    .filter((seg) => seg.length > 0)
    .join("/");
}

// 目录分段清洗：去掉路径非法字符但保留层级，过长才截断
function sanitizeSegment(name: string): string {
  return name.replace(/[\\:*?"<>|#^[\]]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80);
}

// 日期格式化 YYYY-MM-DD
export function formatDate(d: Date): string {
  const p = (n: number) => (n < 10 ? "0" + n : "" + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 转义正则特殊字符，用于把 URL 安全地拼进 RegExp
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 由 URL 推断图片扩展名（仅看 URL 中的显式后缀，兜底 png）
export function extFromUrl(url: string): string {
  const m = url.match(/\.(png|jpe?g|gif|webp|bmp|svg)(?:[?#]|$)/i);
  return m ? m[1].toLowerCase() : "png";
}

// 下载结果：二进制数据 + 响应 Content-Type
export interface DownloadResult {
  data: ArrayBuffer;
  contentType: string;
}

// 综合推断图片真实扩展名，优先级：
// 1) 微信 data-src 的 wx_fmt 参数（最可靠）
// 2) URL 中显式后缀
// 3) 响应 Content-Type
// 4) 文件头魔术字节
// 微信图片 URL 通常无后缀（如 mmbiz_jpg/...?wx_fmt=jpeg），用错扩展名会导致 Obsidian 无法渲染。
export function extFromBinary(url: string, contentType: string, buf: ArrayBuffer): string {
  const wf = url.match(/[?&]wx_fmt=([a-z0-9]+)/i);
  if (wf) {
    const f = wf[1].toLowerCase();
    if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(f)) {
      return f === "jpeg" ? "jpg" : f;
    }
  }
  const m = url.match(/\.(png|jpe?g|gif|webp|bmp|svg)(?:[?#]|$)/i);
  if (m) return m[1].toLowerCase();
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("jpeg")) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("bmp")) return "bmp";
  if (ct.includes("svg")) return "svg";
  const bytes = new Uint8Array(buf.slice(0, 12));
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "webp";
  return "png";
}

// 拉取网页 HTML 文本
// 注意：微信公众号等站点会校验 User-Agent，默认 Obsidian UA 会被判为异常并返回
// 302 验证页（#js_content 为空），导致正文解析结果为空。这里统一带上浏览器 UA
// 与 Accept 头，并显式跟随重定向，确保拿到真实正文 HTML。
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function fetchHtml(url: string): Promise<string> {
  const r = await requestUrl({
    url,
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });
  return r.text;
}

// 下载二进制（图片）。微信等站点的图片需带 Referer 否则返回 403，
// 这里对微信域名自动补 Referer / UA，提升本地化成功率；同时返回 Content-Type 用于推断扩展名。
export async function downloadBinary(url: string): Promise<DownloadResult> {
  const headers: Record<string, string> = {};
  if (/mp\.weixin\.qq\.com|qq\.com/i.test(url)) {
    headers["Referer"] = "https://mp.weixin.qq.com/";
    headers["User-Agent"] =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1";
  }
  const r = await requestUrl({ url, headers });
  const ct = (r.headers && (r.headers["content-type"] || r.headers["Content-Type"])) || "";
  return { data: r.arrayBuffer, contentType: ct };
}

// 微信公众号 HTML -> Markdown：用 DOMParser 解析真实结构，按语义转换为 Markdown 语法，
// 保留标题层级、粗体/斜体/删除线、链接、列表、引用、代码、分割线、表格与图片位置。
export interface ParsedArticle {
  title: string;
  content: string; // Markdown 文本
  images: string[]; // 图片 URL（data-src 优先）
}

export function parseWechatArticle(html: string): ParsedArticle {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const titleEl =
    doc.querySelector("#activity-name") ||
    doc.querySelector("h1") ||
    doc.querySelector("title");
  const title = (titleEl?.textContent || doc.title || "微信文章").trim();

  let root: HTMLElement | null =
    doc.querySelector("#js_content") ||
    doc.querySelector(".rich_media_content") ||
    doc.querySelector("#js_article") ||
    doc.body;
  if (!root) root = doc.body;

  const images: string[] = [];
  let content = nodeToMarkdown(root, images).replace(/\n{3,}/g, "\n\n").trim();

  // 兜底：若 DOM 解析后正文仍为空（例如个别页面结构异常、DOMParser 不可用等），
  // 退而求其次用正则从原始 HTML 抽取 #js_content 文本，保证正文不空白。
  if (!content) {
    const m = html.match(/<div[^>]*id=["']js_content["'][^>]*>([\s\S]*?)<\/div>/i);
    const raw = m ? m[1] : html;
    content = raw
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return { title, content, images };
}

export const SKIP_TAGS = ["script", "style", "head", "meta", "link", "noscript", "template", "iframe"];

export function nodeToMarkdown(node: Node, images: string[]): string {
  if (node.nodeType === 3) {
    // 文本节点：折叠多余空白
    return (node.textContent || "").replace(/\s+/g, " ");
  }
  if (node.nodeType !== 1) return "";
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.includes(tag)) return "";

  // 图片：优先懒加载真实地址（data-src / data-original / data-lazy-src），回退 src。
  // 兼容微信公众号、知乎、小红书、稀土掘金、今日头条等各平台的图片懒加载属性。
  if (tag === "img") {
    const src = el.getAttribute("data-src") || el.getAttribute("data-original") || el.getAttribute("data-lazy-src") || el.getAttribute("src") || "";
    if (/^https?:/i.test(src)) {
      if (!images.includes(src)) images.push(src);
      const alt = el.getAttribute("alt") || "";
      return `![${alt}](${src})`;
    }
    return "";
  }

  if (tag === "br") return "\n";
  if (tag === "hr") return "\n\n---\n\n";

  if (tag === "a") {
    const href = el.getAttribute("href") || "";
    const text = childrenToMarkdown(el, images);
    if (!href || /^javascript:/i.test(href) || href.startsWith("#")) return text;
    return `[${text}](${href})`;
  }

  if (tag === "strong" || tag === "b") return `**${childrenToMarkdown(el, images)}**`;
  if (tag === "em" || tag === "i") return `*${childrenToMarkdown(el, images)}*`;
  if (tag === "del" || tag === "s") return `~~${childrenToMarkdown(el, images)}~~`;
  if (tag === "code") return `\`${childrenToMarkdown(el, images)}\``;
  if (tag === "pre") {
    // 代码块内常含 <br> 换行（微信编辑器渲染的代码块），
    // 不能用 textContent（会把 <br> 当空串、把所有行粘成一行）。
    // 递归提取内部文本并保留 <br> 为换行。
    const codeEl = el.querySelector("code") || el;
    const code = preInnerText(codeEl)
      .replace(/\r/g, "")
      .replace(/^\n+|\n+$/g, "");
    return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`;
  }

  if (tag === "h1") return `\n\n# ${childrenToMarkdown(el, images).trim()}\n\n`;
  if (tag === "h2") return `\n\n## ${childrenToMarkdown(el, images).trim()}\n\n`;
  if (tag === "h3") return `\n\n### ${childrenToMarkdown(el, images).trim()}\n\n`;
  if (tag === "h4") return `\n\n#### ${childrenToMarkdown(el, images).trim()}\n\n`;
  if (tag === "h5") return `\n\n##### ${childrenToMarkdown(el, images).trim()}\n\n`;
  if (tag === "h6") return `\n\n###### ${childrenToMarkdown(el, images).trim()}\n\n`;

  if (tag === "blockquote") {
    const inner = childrenToMarkdown(el, images).trim();
    return `\n\n> ${inner.replace(/\n+/g, "\n> ")}\n\n`;
  }

  if (tag === "ul" || tag === "ol") {
    return `\n\n${listToMarkdown(el, tag === "ol", images)}\n\n`;
  }

  if (tag === "table") {
    return `\n\n${tableToMarkdown(el, images)}\n\n`;
  }

  // 段落 / 容器：作为块级处理
  let inner = childrenToMarkdown(el, images);
  // 归并「圆点字符 + 文本」型伪列表（微信公众号常用符号 + 段落模拟列表，
  // 而非真正的 <ul><li>），将其还原为 Markdown 无序列表，避免圆点孤立成行、文本散落。
  inner = postProcessBulletLists(inner);
  if (["p", "div", "section", "figure", "article"].includes(tag)) {
    return `\n\n${inner}\n\n`;
  }
  return inner;
}

export function childrenToMarkdown(el: HTMLElement, images: string[]): string {
  let out = "";
  el.childNodes.forEach((c) => {
    out += nodeToMarkdown(c, images);
  });
  return out;
}

// 归并「圆点/项目符号字符 + 文本」型伪列表为 Markdown 无序列表。
// 微信公众号等文章常不使用 <ul><li>，而是用「•」「·」等符号配合
// 段落 / <br> / 独立块 模拟列表：符号与文本可能分处不同块级元素，也可能在
// 同一块内以符号前缀开头。本函数在块级容器转换后、按行识别并归并：
//   - 符号独占一行：与下一非空行合并为一条列表项
//   - 符号前缀同行（"• 文本"）：直接转为 "- 文本"
//   - 列表项之间的空行被移除，保证 Obsidian/CommonMark 视作同一列表
// 不匹配的行（标题、分割线、普通段落等）原样保留，不影响其它结构。
export function postProcessBulletLists(md: string): string {
  const BULLET = /^[ \t]*[•·▪◦‣◉○●・][ \t]*$/;
  const BULLET_PREFIX = /^[ \t]*[•·▪◦‣◉○●・][ \t]+/;
  const lines = md.split("\n");
  const out: string[] = [];
  const n = lines.length;
  let i = 0;
  while (i < n) {
    const ln = lines[i];
    if (ln.trim() === "") {
      // 若上一行是列表项、且下一非空行也是列表项，跳过该空行，避免列表被拆碎
      if (out.length && out[out.length - 1].startsWith("- ")) {
        let k = i + 1;
        while (k < n && lines[k].trim() === "") k++;
        if (k < n && (BULLET.test(lines[k].trim()) || BULLET_PREFIX.test(lines[k].trim()))) {
          i++;
          continue;
        }
      }
      out.push(ln);
      i++;
      continue;
    }
    if (BULLET.test(ln.trim())) {
      // 符号独占一行：与下一非空行合并为同一条列表项。
      // 注意：微信公众号常用 <section style="display:flex"> 模拟列表，
      // 符号（•）和文本可能分别位于并列的子 <section> 中。若在当前块内
      // 找不到后续文本，说明该符号行只是 flex 布局里的「符号列」，应保留原
      // 符号，让外层容器把符号与后续文本行合并，避免提前转成孤立的 "- "。
      let j = i + 1;
      while (j < n && lines[j].trim() === "") j++;
      const next = j < n ? lines[j].trim() : "";
      if (next) {
        out.push(`- ${next}`);
        i = j + 1;
      } else {
        out.push(ln);
        i++;
      }
      continue;
    }
    if (BULLET_PREFIX.test(ln.trim())) {
      out.push(`- ${ln.trim().replace(BULLET_PREFIX, "")}`);
      i++;
      continue;
    }
    out.push(ln);
    i++;
  }
  return out.join("\n");
}

// 递归提取节点内的纯文本，保留 <br> 为换行（用于 <pre> 代码块，
// 避免 textContent 把 <br> 当空串导致多行粘连成一行）。
export function preInnerText(node: Node): string {
  if (node.nodeType === 3) return node.textContent || "";
  if (node.nodeType !== 1) return "";
  const el = node as HTMLElement;
  if (el.tagName.toLowerCase() === "br") return "\n";
  let out = "";
  el.childNodes.forEach((c) => {
    out += preInnerText(c);
  });
  return out;
}

export function listToMarkdown(listEl: HTMLElement, ordered: boolean, images: string[]): string {
  let res = "";
  let idx = 1;
  for (const child of Array.from(listEl.children)) {
    if (child.tagName.toLowerCase() !== "li") continue;
    const li = child as HTMLElement;
    // 递归转换列表项内部（含嵌套列表、段落、代码块等），得到该项的完整 Markdown 块
    let inner = childrenToMarkdown(li, images);
    // 剥掉列表项文本自身携带的编号/项目符号，避免与外层 Markdown 标记重复。
    // 例如微信文章 <li> 文本本身已是 "1. 速度极快"，不处理会变成 "1. 1. 速度极快"。
    inner = inner.replace(/^\s*(?:\d+[.)、]\s+|[-*+]\s+)/, "");
    // 规范化：折叠多余空行，避免项内多段落时残留大量空行
    inner = inner.replace(/\n{3,}/g, "\n\n").trim();
    const marker = ordered ? `${idx}. ` : "- ";
    // 续行/嵌套缩进：首行加标记，其余行按标记宽度缩进，
    // 使「项内含多段」「项内嵌套子列表」都能正确归属到同一列表项
    // （Obsidian/CommonMark 按缩进判定从属关系，否则子列表会脱离父项变成平铺）。
    const indent = ordered ? "   " : "  ";
    const lines = inner.split("\n");
    const outLines = lines.map((ln, i) => (i === 0 ? marker + ln : indent + ln));
    res += outLines.join("\n") + "\n";
    idx++;
  }
  return res;
}

export function tableToMarkdown(tableEl: HTMLElement, images: string[]): string {
  const rows = Array.from(tableEl.querySelectorAll("tr"));
  if (!rows.length) return "";
  const lines: string[] = [];
  rows.forEach((tr, ri) => {
    const cells = Array.from(tr.querySelectorAll("th,td")).map((c) =>
      childrenToMarkdown(c as HTMLElement, images).replace(/\n+/g, " ").trim()
    );
    lines.push(`| ${cells.join(" | ")} |`);
    if (ri === 0 && cells.length) {
      lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
    }
  });
  return lines.join("\n");
}

// 通用：把任意容器元素转换为 Markdown（标题/列表/引用/图片等）。
// 各平台解析模块（parsers/*）统一用它把正文 DOM 转为 Markdown，避免重复实现转换引擎。
export function elementToMarkdown(el: HTMLElement): ParsedArticle {
  const images: string[] = [];
  const content = nodeToMarkdown(el, images).replace(/\n{3,}/g, "\n\n").trim();
  return { title: "", content, images };
}

// 组装带 frontmatter 的 Markdown 内容。
// body 已是最终正文：高保真模式下为带内联样式的 HTML 片段，
// 兼容模式下为 Markdown 文本（图片 wikilink 已拼入 body）。
export function buildMarkdown(a: Article, body: string): string {
  const savedDate = formatDate(new Date());
  const fm = [
    "---",
    `title: ${a.title}`,
    `source: ${a.source || ""}`,
    `content_kind: ${a.content_kind}`,
    `saved_date: ${savedDate}`,
    `sync_id: ${a.sync_id}`,
    `url: ${a.source_url || ""}`,
    "---",
  ].join("\n");

  let content = body;

  return `${fm}\n\n# ${a.title}\n\n${content}\n`;
}

// 随笔（memo）本地化保存
export function buildMemoMarkdown(a: Article): string {
  const savedDate = formatDate(new Date());
  const fm = [
    "---",
    `title: ${a.title}`,
    `content_kind: 随笔`,
    `saved_date: ${savedDate}`,
    `sync_id: ${a.sync_id}`,
    "---",
  ].join("\n");
  return `${fm}\n\n# ${a.title}\n\n${a.content || ""}\n`;
}
