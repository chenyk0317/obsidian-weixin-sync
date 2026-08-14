import { Notice, Plugin } from "obsidian";
import { ApiClient } from "./api";
import { DEFAULT_SETTINGS, WinxinSyncSettingTab, WinxinSyncSettings } from "./settings";
import { syncOnce } from "./sync";

export default class WinxinSyncPlugin extends Plugin {
  declare settings: WinxinSyncSettings;
  api!: ApiClient;
  settingTab!: WinxinSyncSettingTab;
  private syncTimer: number | null = null;
  private syncing: boolean = false;

  async onload() {
    await this.loadSettings();
    this.api = new ApiClient(this.settings.serverUrl);
    this.api.setApiKeys(this.settings.apiKeys);

    // 左侧工具栏「立即同步」按钮
    this.addRibbonIcon("book-down", "Weixin Sync 同步", () => this.sync());

    this.addCommand({
      id: "weixin-sync-now",
      name: "Weixin Sync: 立即同步",
      callback: () => this.sync(),
    });

    this.settingTab = new WinxinSyncSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    this.registerSyncTimer();

    if (!this.settings.apiKeys || this.settings.apiKeys.length === 0) {
      new Notice("Weixin Sync：尚未配置 API Key，请在设置中添加微信生成的 Key");
    }
  }

  onunload() {
    this.clearSyncTimer();
  }

  // 设备名称默认值：仓库名 的 obsidian
  effectiveDeviceName(): string {
    return this.settings.deviceName || `${this.app.vault.getName()}的obsidian`;
  }

  // 供设置页在变更 API Key 后同步到 ApiClient
  applyApiKeys() {
    this.api.setApiKeys(this.settings.apiKeys);
  }

  async sync() {
    if (this.syncing) {
      new Notice("正在同步中，请稍候");
      return;
    }
    if (!this.settings.apiKeys || this.settings.apiKeys.length === 0) {
      new Notice("尚未配置 API Key，无法同步");
      return;
    }
    this.syncing = true;
    try {
      const results = await syncOnce(this);
      const succ = results.filter((r) => r.success).length;
      const fail = results.length - succ;
      if (results.length === 0) {
        new Notice("同步完成：当前没有需要同步的内容");
      } else {
        new Notice(`同步完成：成功 ${succ}，失败 ${fail}`);
      }
    } catch (e) {
      console.error("[weixin-sync] 同步失败", e);
      new Notice("同步失败，请检查网络或服务端连接是否正常，稍后重试");
    } finally {
      this.syncing = false;
    }
  }

  // 按同步间隔注册定时任务（0 表示仅手动）
  registerSyncTimer() {
    this.clearSyncTimer();
    const minutes = this.settings.syncInterval;
    if (!minutes || minutes <= 0) return;
    this.syncTimer = window.setInterval(() => this.sync(), minutes * 60 * 1000);
  }

  private clearSyncTimer() {
    if (this.syncTimer !== null) {
      window.clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
