# Weixin Sync · Obsidian 插件

将微信小程序暂存的文章/随笔自动同步到 Obsidian 本地库，支持图片本地化与去重。

> 插件 ID：`weixin-sync` ｜ 最低 Obsidian 版本：`1.5.0` ｜ 支持桌面端与移动端

## 功能
- 在设置中填入一个或多个 API Key（由微信小程序端生成），自动完成设备绑定
- 按设定间隔自动同步（默认 5 分钟，0 仅手动）+ 命令面板「立即同步」
- 本地抓取微信原文并解析为 Markdown，图片下载到可配置目录并替换为 Wikilink
- 基于 `sync_id` 去重，已存在文件不覆盖
- 可配置：同步目录、按公众号建目录、图片本地化、文件名格式

## 使用前依赖（重要）
本插件**依赖配套的微信小程序「Obsidian同步」与后端服务**，并非开箱即用：
1. 微信中搜索小程序「Obsidian同步」（或扫描插件设置页提供的小程序码）；
2. 在小程序「我的 → API Key 管理」中生成 API Key；
3. 回到 Obsidian 插件设置，粘贴 API Key 完成绑定，即可开始同步。

后端默认地址为 `https://obsync.569988.xyz/`（由服务端集中托管，无需用户自建）。

## 安装
### 方式一：Obsidian 社区插件市场（上架后）
Obsidian 设置 → 第三方插件 → 关闭安全模式 → 浏览 → 搜索「Weixin Sync」→ 安装并启用。

### 方式二：BRAT（推荐先这样测试）
1. 安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 插件；
2. BRAT → Add a beta plugin → 填入本仓库地址 → 安装。

### 方式三：手动安装
下载仓库根目录的 `manifest.json`、`main.js`、`versions.json` 三个文件，放入
`你的库/.obsidian/plugins/weixin-sync/` 后启用。

## 开发
```bash
npm install
npm run dev      # 监听构建，输出到本地测试 vault 的插件目录
npm run build    # 生产构建（含 tsc 类型检查）
```
开发态构建产物位于 `weixin-sync-test-vault/.obsidian/plugins/weixin-sync/`，
可直接在本地测试库热重载。**发布时**请将根目录的 `manifest.json` + `main.js` + `versions.json`
作为 Release 资源提交/上传。

## 与后端对接
- 插件使用 `X-Api-Key` 请求头调用 `/article/list` 与 `/article/confirm`
- 绑定流程：设置中填入 API Key → 自动调用 `/bind/verify` 完成设备绑定（无需扫码/轮询）

## 许可证
[MIT](./LICENSE)
