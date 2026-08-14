# 发布指南 · Weixin Sync 上架 Obsidian 社区插件市场

> ⚠️ **结构说明**：本插件 **开发与发布同源**，都在 `weixin-sync-plugin/` 目录。
> 不再维护单独的 `obsidian-weixin-sync` 发布副本目录（已废弃删除）。
> 本地开发目录名为 `weixin-sync-plugin`，但推送到 GitHub 的**仓库名**为 `chenyk0317/obsidian-weixin-sync`，两者名字不同是正常的——GitHub 仓库名是历史确定的，本地目录名是开发代号。

上架到 GitHub 的发布文件仅包含插件端代码：
`manifest.json` · `main.js` · `versions.json` · `README.md` · `LICENSE` · 源码 `src/` · 构建配置。

> ⚠️ **切勿把四端项目根目录推到 GitHub**：发布脚本只会把 `weixin-sync-plugin/` 内的发布文件推到 `chenyk0317/obsidian-weixin-sync`，不会触碰 server-be / miniprogram / server-fe。

## 一、发布流程（创建仓库 + 构建 + 打 Release + 社区后台提交）

> ⚠️ **流程已更新（2026-05 起）**：Obsidian 社区插件不再通过 `obsidianmd/obsidian-releases` 提 PR，改为在 [community.obsidian.md](https://community.obsidian.md) 开发者后台提交。

### 方式 A：一键脚本（推荐）

```bash
# 进入插件开发（即发布源）目录
cd code/weixin-sync-plugin

# 运行发布脚本
bash publish.sh            # 版本号默认取 manifest.json
bash publish.sh 1.0.2      # 传入版本号：先改 manifest.json 的 version 与 versions.json，再走全流程
```

脚本全自动完成以下全流程（兼容首次发布与后续迭代）：
1. **确定版本**：未传参则读 `manifest.json`；传入则先 `sed` 改 `manifest.json` 的 `version`，并给 `versions.json` 追加新版本条目。
2. **生产构建**：在本目录执行 `npm install` + `npm run build`（生成 `weixin-sync-test-vault/.../main.js`）。
3. **克隆远程仓库**到临时目录（仓库很小，重克隆很快），并清理旧发布文件。
4. **拷贝发布文件**：`manifest.json` / `main.js` / `versions.json` / `src/` / `LICENSE` / `README.md` / `package.json` 等覆盖进临时目录。
5. **提交 Git**：有改动才 `commit`。
6. **推送 GitHub**：普通推送失败（本地落后）时自动 `git pull --rebase` 再推。
7. **打 Release**：`gh release create`，已存在的版本自动跳过（需覆盖可用 `gh release delete <版本>` 后重跑）。
8. **输出社区后台提交指引**，并尝试打开 https://community.obsidian.md 。
9. 清理临时目录。

### 方式 B：手动分步

```bash
cd code/weixin-sync-plugin
npm install && npm run build

# 准备一个干净的发布工作区（克隆你的 GitHub 仓库）
rm -rf /tmp/obsidian-weixin-sync-publish
gh repo clone chenyk0317/obsidian-weixin-sync /tmp/obsidian-weixin-sync-publish
cd /tmp/obsidian-weixin-sync-publish
# 删掉除 .git/.gitignore 外的旧文件，再把本目录发布文件拷入
find . -mindepth 1 -maxdepth 1 ! -name '.git' ! -name '.gitignore' -exec rm -rf {} +
cp ../weixin-sync-plugin/manifest.json .
cp ../weixin-sync-plugin/weixin-sync-test-vault/.obsidian/plugins/weixin-sync/main.js .
cp ../weixin-sync-plugin/versions.json .
cp -r ../weixin-sync-plugin/src .
cp ../weixin-sync-plugin/LICENSE ../weixin-sync-plugin/README.md ../weixin-sync-plugin/package.json ../weixin-sync-plugin/esbuild.config.mjs ../weixin-sync-plugin/tsconfig.json .

git add -A && git commit -m "Release vX.Y.Z" && git push origin master
gh release create X.Y.Z --title "vX.Y.Z" --notes "..." manifest.json main.js versions.json

# 到 community.obsidian.md 后台提交/更新插件
```

## 二、插件介绍文案（提交后台时参考）

向社区目录提交时，可在插件介绍里说明：将微信小程序「Obsidian同步」中暂存的文章自动同步到 Obsidian 本地库；需在设置中填入由小程序生成的 API Key 完成绑定；支持定时/手动同步、微信原文解析为 Markdown、图片本地化与去重。详细见 `README.md`。

## 三、上架审核注意点
- 仓库必须**公开**，且根目录含 `manifest.json` / `main.js` / `versions.json`。
- `manifest.json` 字段需齐全：`id` `name` `version` `minAppVersion` `description` `author` `isDesktopOnly`。
- **`manifest.json` 的 `description` 不能包含 "Obsidian" 字样**（官方规则：描述中写 "Obsidian" 属于冗余），否则自动审核会报错 `Plugin description must not include the word "Obsidian"`。
- 插件依赖配套微信小程序与后端服务，已在 README「使用前依赖」中如实说明。
- 审核会跑自动化检查（manifest 合法性、构建可复现等），确保 `npm run build` 可无错通过。
