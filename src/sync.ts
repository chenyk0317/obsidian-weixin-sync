import { Article, ConfirmResult } from "./types";
import type WinxinSyncPlugin from "./main";
import {
  buildMarkdown,
  buildMemoMarkdown,
  dirFromTemplate,
  downloadBinary,
  ensureFolder,
  escapeRegExp,
  extFromBinary,
  fetchHtml,
  fileNameFromTemplate,
  formatDate,
} from "./utils";
import { getParser } from "./parsers";
// 执行一次同步：按每个 API Key（对应用户）拉取待同步列表 -> 本地解析写入 -> 回写结果。
export async function syncOnce(plugin: WinxinSyncPlugin): Promise<ConfirmResult[]> {
  const keys = plugin.api.getApiKeys();
  const all: ConfirmResult[] = [];
  for (const key of keys) {
    try {
      const list = await plugin.api.listArticles(key, "submitted", 1, 50);
      const articles = list.list || [];
      const results: ConfirmResult[] = [];
      for (const a of articles) {
        try {
          if (a.content_kind === "随笔" && a.content) {
            await writeMemo(plugin, a);
          } else if (a.source_url) {
            await writeArticle(plugin, a);
          } else {
            throw new Error("缺少原文链接且非随笔");
          }
          results.push({ sync_id: a.sync_id, success: true });
        } catch (e) {
          results.push({ sync_id: a.sync_id, success: false, message: String(e) });
        }
      }
      if (results.length) {
        const failed = results.filter((r) => !r.success).length;
        // 成功的标记为 synced；失败的保持 submitted（不回写失败，便于重试）
        const ok = results.filter((r) => r.success);
        if (ok.length) await plugin.api.confirm(ok, "synced", key);
        if (failed > 0) console.warn(`[weixin-sync] ${failed} 篇同步失败`);
      }
      all.push(...results);
    } catch (e) {
      // 单个 Key（如已失效/未绑定设备，后端返回 code=401）出错时跳过，不中断其余 Key 的同步
      console.warn(
        `[weixin-sync] API Key ${key.slice(0, 4)}… 同步失败，已跳过：${(e as Error).message}`
      );
    }
  }
  return all;
}

async function resolveFolder(plugin: WinxinSyncPlugin, fields: Record<string, string>): Promise<{ dir: string; att: string }> {
  const s = plugin.settings;
  // 同步目录支持变量模板（如 {{saved_date}}/{{source}}），按段清洗保留层级
  const dir = dirFromTemplate(s.syncDir, fields);
  // 图片存储目录完全由「图片存储路径」模板决定（可含 {{title}} 等变量，默认按标题分桶），
  // 不再额外追加标题子目录，避免配置里已含 {{title}} 时出现「附件资源/标题/标题」两级标题。
  const att = dirFromTemplate(s.imageDir || "附件资源/{{title}}", fields);
  return { dir, att };
}

async function writeArticle(plugin: WinxinSyncPlugin, a: Article) {
  const html = await fetchHtml(a.source_url as string);

  const fields = {
    saved_date: formatDate(new Date()),
    title: a.title,
    source: a.source || "",
    author: a.author || "",
    url: a.source_url || "",
    sync_id: a.sync_id,
  };
  const { dir, att } = await resolveFolder(plugin, fields);

  // 按 content_kind（未知时按域名）选择对应平台解析器，提取正文与图片，
  // 并就地把正文中的远程图片 URL 替换为本地附件路径（wikilink 嵌入，按仓库根解析）。
  const parser = getParser(a.content_kind, a.source_url || "");
  const { content, images } = parser.parse(html);
  let body = content;
  if (plugin.settings.imageLocalization && images.length) {
    await ensureFolder(plugin.app, att);
    const map: Record<string, string> = {};
    for (let i = 0; i < images.length; i++) {
      const url = images[i];
      try {
        const { data, contentType } = await downloadBinary(url);
        const fname = `img_${i + 1}.${extFromBinary(url, contentType, data)}`;
        const full = `${att}/${fname}`;
        if (!(await plugin.app.vault.adapter.exists(full))) {
          await plugin.app.vault.createBinary(full, data);
        }
        map[url] = full;
      } catch (e) {
        // 单张图片失败保留原远程地址，不阻断整体
      }
    }
    // 用 Obsidian wikilink 嵌入 ![[path]]：路径按仓库根解析，
    // 无论笔记位于哪个同步子目录都能正确找到图片（避免 ![](相对路径) 因笔记不在根目录而失效）。
    for (const url of Object.keys(map)) {
      const local = map[url];
      const re = new RegExp(`!\\[[^\\]]*\\]\\(${escapeRegExp(url)}\\)`, "g");
      body = body.replace(re, `![[${local}]]`);
    }
  }

  const md = buildMarkdown(a, body);
  const fname = fileNameFromTemplate(plugin.settings.fileNameFormat, fields) + ".md";
  const full = dir ? `${dir}/${fname}` : fname;
  if (await plugin.app.vault.adapter.exists(full)) return; // 去重，不覆盖
  await ensureFolder(plugin.app, dir);
  await plugin.app.vault.create(full, md);
}

async function writeMemo(plugin: WinxinSyncPlugin, a: Article) {
  const md = buildMemoMarkdown(a);
  const fields = {
    saved_date: formatDate(new Date()),
    title: a.title,
    source: "",
    author: "",
    url: "",
    sync_id: a.sync_id,
  };
  const dir = dirFromTemplate(plugin.settings.syncDir, fields);
  const fname = fileNameFromTemplate(plugin.settings.fileNameFormat, fields) + ".md";
  const full = dir ? `${dir}/${fname}` : fname;
  if (await plugin.app.vault.adapter.exists(full)) return;
  await ensureFolder(plugin.app, dir);
  await plugin.app.vault.create(full, md);
}
