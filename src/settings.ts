import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import weappcodeUrl from "./assets/weappcode.jpg";
import type { ApiKeyInfo } from "./types";
import type WinxinSyncPlugin from "./main";

export interface WinxinSyncSettings {
  serverUrl: string;
  deviceName: string;
  deviceCode: string; // 设备唯一编码（绑定后由后端返回并持久化，后续绑定复用同一设备）
  apiKeys: string[]; // 微信生成的 API Key 列表（每个对应一个绑定账号）
  syncDir: string;
  imageDir: string;
  fileNameFormat: string;
  imageLocalization: boolean;
  syncInterval: number; // 分钟，0 表示仅手动同步
}

export const DEFAULT_SETTINGS: WinxinSyncSettings = {
  serverUrl: "https://obsync.569988.xyz/",
  deviceName: "",
  deviceCode: "",
  apiKeys: [],
  syncDir: "WX同步/{{source}}",
  imageDir: "WX同步/{{source}}/附件资源/{{title}}",
  fileNameFormat: "{{saved_date}}-{{title}}",
  imageLocalization: true,
  syncInterval: 5,
};

export class WinxinSyncSettingTab extends PluginSettingTab {
  plugin: WinxinSyncPlugin;
  private newKey = "";

  constructor(app: App, plugin: WinxinSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    void this.render();
  }

  private async render(): Promise<void> {
    const { containerEl } = this;

    containerEl.createEl("h2", { text: "设备绑定（API Key）" });
    new Setting(containerEl)
      .setName("设备名称")
      .setDesc("显示在绑定关系中的名称（默认「仓库名 的 obsidian」）")
      .addText((t) =>
        t.setValue(this.plugin.effectiveDeviceName()).onChange(async (v) => {
          this.plugin.settings.deviceName = v;
          await this.plugin.saveSettings();
        })
      );

    // 新增 API Key
    new Setting(containerEl)
      .setName("添加 API Key")
      .setDesc("在微信小程序「API Key 管理」中生成后粘贴到这里，点击添加即完成绑定")
      .addText((t) =>
        t.setPlaceholder("wx_sk_xxxx...").setValue(this.newKey).onChange((v) => {
          this.newKey = v.trim();
        })
      )
      .addButton((btn) =>
        btn
          .setButtonText("添加并绑定")
          .setCta()
          .onClick(async () => {
            const key = this.newKey.trim();
            if (!key) {
              new Notice("请先粘贴 API Key");
              return;
            }
            btn.setDisabled(true);
            btn.setButtonText("绑定中…");
            try {
              const resp = await this.plugin.api.bindVerify(
                key,
                this.plugin.effectiveDeviceName(),
                this.plugin.settings.deviceCode
              );
              // 持久化设备码：下次绑定（含其它账号的 Key）将复用同一设备，避免重复建设备
              if (resp.device_code) {
                this.plugin.settings.deviceCode = resp.device_code;
              }
              if (!this.plugin.settings.apiKeys.includes(key)) {
                this.plugin.settings.apiKeys.push(key);
              }
              this.plugin.applyApiKeys();
              await this.plugin.saveSettings();
              new Notice(`已绑定设备：${resp.device_name || "Obsidian"} ✓`);
              this.newKey = "";
              this.display();
            } catch (e) {
              const msg = (e as Error)?.message || "";
              if (msg.includes("已失效") || msg.includes("已吊销") || msg.includes("已过期")) {
                new Notice("该 API Key 已吊销/失效，请在微信小程序中重新生成后再绑定");
              } else {
                new Notice("绑定失败：" + msg);
              }
            } finally {
              btn.setDisabled(false);
              btn.setButtonText("添加并绑定");
            }
          })
      );

    // 已配置的 API Key 列表（与「添加 API Key」同属一个区域）
    const keys = this.plugin.settings.apiKeys;
    if (keys.length) {
      const bound = keys.length;
      containerEl.createEl("h3", { text: `已绑定 Key（${bound}）` });

      // 一次性批量拉取所有 Key 的状态（失败则用回退值）
      const statusMap = new Map<string, ApiKeyInfo>();
      try {
        const res = await this.plugin.api.getKeyStatuses(keys);
        for (const info of res.list || []) {
          if (info?.key_masked) statusMap.set(info.key_masked, info);
        }
      } catch {
        // 忽略批量查询错误，使用回退名称与状态
      }

      // 自动移除已失效的 Key（invalid/revoked/已过期），避免后续同步反复报错；未绑定(active 无设备)的保留
      const invalidMasked = new Set<string>();
      for (const info of statusMap.values()) {
        if (!info) continue;
        const exp = info.expires_at ? new Date(info.expires_at) : null;
        const expired =
          exp && !isNaN(exp.getTime()) && exp.getFullYear() > 2000 && exp.getTime() < Date.now();
        if (info.status === "invalid" || info.status === "revoked" || expired) {
          invalidMasked.add(info.key_masked);
        }
      }
      if (invalidMasked.size) {
        const before = this.plugin.settings.apiKeys.length;
        this.plugin.settings.apiKeys = this.plugin.settings.apiKeys.filter(
          (k) => !invalidMasked.has(this.maskKey(k))
        );
        // 当所有 Key 都被移除时，重置设备码，避免持有失效设备码
        if (this.plugin.settings.apiKeys.length === 0) {
          this.plugin.settings.deviceCode = "";
        }
        this.plugin.applyApiKeys();
        await this.plugin.saveSettings();
        new Notice(`已自动移除 ${before - this.plugin.settings.apiKeys.length} 个失效 Key`);
        this.display(); // 重新渲染，避免展示已移除的 Key
        return;
      }

      const tagMeta = (info?: ApiKeyInfo): { label: string; color: string } => {
        if (!info) return { label: "状态未知", color: "#6b7280" };
        if ((info.status as string) === "invalid") return { label: "无效", color: "#b0312f" };
        if (info.status === "revoked") return { label: "已吊销", color: "#b0312f" };
        // 仅当 expires_at 是合理日期（年份 > 2000，排除零值 0001-01-01）且小于当前时间才视为已过期
        const exp = info.expires_at ? new Date(info.expires_at) : null;
        if (
          exp &&
          !isNaN(exp.getTime()) &&
          exp.getFullYear() > 2000 &&
          exp.getTime() < Date.now()
        )
          return { label: "已过期", color: "#b26a00" };
        if (info.device_id) return { label: "有效", color: "#1e7e34" };
        return { label: "未绑定", color: "#b26a00" };
      };

      for (let idx = 0; idx < keys.length; idx++) {
        const k = keys[idx];
        const info = statusMap.get(this.maskKey(k));
        const name = info?.name || `Key #${idx + 1}`;
        const meta = tagMeta(info);
        const keySetting = new Setting(containerEl)
          .setName(`${name}(${this.maskKey(k)})`);
        // 状态标签（彩色 pill，放在移除绑定按钮前）
        const tag = keySetting.controlEl.createSpan({ text: meta.label, cls: "wx-key-status" });
        tag.style.cssText =
          `color:${meta.color};border:1px solid ${meta.color};` +
          "display:inline-block;padding:1px 8px;margin-right:8px;border-radius:10px;font-size:12px;line-height:1.6;";
        keySetting.addButton((btn) =>
          btn
            .setButtonText("移除绑定")
            .setWarning()
            .onClick(async () => {
              try {
                await this.plugin.api.removeBinding(k);
              } catch {
                // 即便接口失败也允许本地移除
              }
              this.plugin.settings.apiKeys = this.plugin.settings.apiKeys.filter(
                (x) => x !== k
              );
              // 当所有 Key 都被移除时，重置设备码，避免持有失效设备码
              if (this.plugin.settings.apiKeys.length === 0) {
                this.plugin.settings.deviceCode = "";
              }
              this.plugin.applyApiKeys();
              await this.plugin.saveSettings();
              new Notice("已移除该 Key");
              this.display();
            })
        );
      }
    } else {
      containerEl.createEl("p", {
        text: "尚未配置任何 API Key。添加后插件即可拉取对应微信账号的待同步文章。",
      });
    }

    // 打开小程序引导（位于「已绑定 Key」下方）
    this.renderMiniGuide(containerEl);

    containerEl.createEl("h2", { text: "同步设置" });
    new Setting(containerEl)
      .setName("自动同步间隔（分钟）")
      .setDesc("0 表示仅手动同步；默认 5 分钟")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.syncInterval)).onChange(async (v) => {
          this.plugin.settings.syncInterval = parseInt(v) || 0;
          this.plugin.registerSyncTimer();
          await this.plugin.saveSettings();
        })
      )
      .addButton((btn) =>
        btn
          .setButtonText("立即同步")
          .setCta()
          .onClick(async () => {
            btn.setDisabled(true);
            const prev = btn.buttonEl.textContent;
            btn.setButtonText("同步中…");
            try {
              await this.plugin.sync();
            } finally {
              btn.setButtonText(prev || "立即同步");
              btn.setDisabled(false);
            }
          })
      );
    new Setting(containerEl)
      .setName("文章同步目录")
      .setDesc(
        "文章写入目录。默认「WX同步/{{source}}」，即按来源公众号分目录。支持变量：{{saved_date}} {{title}} {{source}} {{author}} {{sync_id}} {{url}}（用 / 分隔层级）"
      )
      .addText((t) =>
        t.setValue(this.plugin.settings.syncDir).onChange(async (v) => {
          this.plugin.settings.syncDir = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("文件名格式")
      .setDesc(
        "笔记文件名模板。默认「{{saved_date}}-{{title}}」。可用变量：{{saved_date}} {{title}} {{source}} {{sync_id}} {{author}} {{url}}"
      )
      .addText((t) =>
        t.setValue(this.plugin.settings.fileNameFormat).onChange(async (v) => {
          this.plugin.settings.fileNameFormat = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("图片本地化")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.imageLocalization).onChange(async (v) => {
          this.plugin.settings.imageLocalization = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("图片存储路径")
      .setDesc(
        "图片附件所在目录（笔记内以 wikilink 引用）。默认「WX同步/{{source}}/附件资源/{{title}}」，即按来源账号 + 标题分桶。支持变量：{{saved_date}} {{title}} {{source}} {{author}} {{sync_id}} {{url}}（用 / 分隔层级）"
      )
      .addText((t) =>
        t.setValue(this.plugin.settings.imageDir).onChange(async (v) => {
          this.plugin.settings.imageDir = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(containerEl)
      .setName("服务器地址")
      .addText((t) =>
        t.setValue(this.plugin.settings.serverUrl).onChange(async (v) => {
          this.plugin.settings.serverUrl = v;
          this.plugin.api.setBase(v);
          await this.plugin.saveSettings();
        })
      );
  }

  private renderMiniGuide(containerEl: HTMLElement): void {
    // 引导卡片：左侧文案 + 右侧小程序码的横向布局，压低区域高度
    const guide = containerEl.createDiv({ cls: "wx-mini-guide" });
    guide.style.cssText =
      "display:flex;align-items:center;gap:16px;margin:12px 0 16px;padding:12px 14px;" +
      "border:1px solid var(--background-modifier-border);border-radius:8px;" +
      "background:var(--background-secondary);";

    const textWrap = guide.createDiv({ cls: "wx-mini-guide-text" });
    textWrap.style.cssText = "flex:1;min-width:0;";

    const title = textWrap.createEl("div", { text: "如何获取 API Key？" });
    title.style.cssText = "font-weight:500;margin-bottom:6px;";

    const desc = textWrap.createEl("p", {
      text:
        "打开微信 → 搜索小程序「Obsidian同步」，或直接用微信扫描右侧小程序码；进入后在「我的」-「API Key 管理」中生成并复制，再回到此处粘贴绑定。",
    });
    desc.style.cssText = "margin:0;line-height:1.6;";

    const img = guide.createEl("img", {
      attr: { alt: "Obsidian同步 小程序码", src: weappcodeUrl },
      cls: "wx-mini-code",
    });
    img.style.cssText =
      "flex:0 0 auto;width:120px;height:120px;object-fit:contain;border-radius:8px;" +
      "border:1px solid var(--background-modifier-border);";
  }

  private maskKey(key: string): string {
    if (key.length <= 12) return "****";
    return key.slice(0, 8) + "****" + key.slice(-4);
  }
}
