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
3. **拷贝 main.js**：把构建产物 `weixin-sync-test-vault/.obsidian/plugins/weixin-sync/main.js` 复制为仓库根目录的 `main.js`（发布需要它位于根目录）。
4. **提交 Git**：确保本目录是独立 git 仓库（首次会自动 `git init` 并关联 `chenyk0317/obsidian-weixin-sync`），有改动才 `commit`。
5. **推送 GitHub**：普通推送失败（本地落后）时自动 `git pull --rebase` 再推；若与远程历史分叉（首次从不同源发布）则退回 `--force-with-lease` 覆盖你自己的仓库。
6. **打 Tag + 创建 Release**：先 `git tag -a v<版本>` + `git push --tags`（已存在的 tag 跳过），再用 `gh release create` 创建带附件的 GitHub Release（已存在则跳过），附件为 `manifest.json` / `main.js` / `styles.css` / `versions.json` 四个文件。Obsidian 社区目录正是从这些 Release 附件读取插件文件。
7. **输出社区后台提交指引**，并尝试打开 https://community.obsidian.md 。

> 说明：脚本依赖 `gh`（需 `gh auth login`），不再克隆远程仓库到临时目录，而是直接在本目录（`weixin-sync-plugin`，它自身就是独立 git 仓库）完成构建、提交、推送、打 tag 与创建带附件的 Release。

### 方式 B：手动分步

```bash
cd code/weixin-sync-plugin
npm install && npm run build

# 构建产物 main.js 在本地测试 vault 内，复制到仓库根目录用于发布
cp weixin-sync-test-vault/.obsidian/plugins/weixin-sync/main.js ./main.js

# 本目录即独立 git 仓库（首次需 git init 并关联远程）
git init                                                       # 若尚未初始化
git remote add origin https://github.com/chenyk0317/obsidian-weixin-sync.git   # 若尚未关联
git add -A && git commit -m "Release vX.Y.Z"
git push -u origin master       # 首次若与远程历史分叉，用：git push -u origin master --force-with-lease
git tag -a vX.Y.Z -m "Release vX.Y.Z" && git push origin --tags

# 创建带附件的 GitHub Release（社区目录读取这些附件）：
gh release create vX.Y.Z --title "vX.Y.Z" --notes "Weixin Sync vX.Y.Z" \
  manifest.json main.js styles.css versions.json
# （或到网页端手动创建：打开 https://github.com/chenyk0317/obsidian-weixin-sync/releases/new?tag=vX.Y.Z）
# 随后到 community.obsidian.md 后台提交/更新插件
```

## 二、插件介绍文案（提交后台时参考）

向社区目录提交时，可在插件介绍里说明：将微信小程序「Obsidian同步」中暂存的文章自动同步到 Obsidian 本地库；需在设置中填入由小程序生成的 API Key 完成绑定；支持定时/手动同步、微信原文解析为 Markdown、图片本地化与去重。详细见 `README.md`。

## 三、上架审核注意点
- 仓库必须**公开**，且根目录含 `manifest.json` / `main.js` / `versions.json`。
- `manifest.json` 字段需齐全：`id` `name` `version` `minAppVersion` `description` `author` `isDesktopOnly`。
- **`manifest.json` 的 `description` 不能包含 "Obsidian" 字样**（官方规则：描述中写 "Obsidian" 属于冗余），否则自动审核会报错 `Plugin description must not include the word "Obsidian"`。
- **`description` 必须以 ASCII 标点结尾**（`.` / `!` / `?`）。中文全角句号 `。` 不被规则接受，触发 `Plugin description should end with punctuation (., !, or ?)`。
- **`minAppVersion` 必须 ≥ 实际用到的最新 Obsidian API**。本插件用到的 `ButtonComponent.setDisabled` 与 `Vault.adapter.exists` 都是 **Obsidian 1.5.0** 引入，因此 `minAppVersion` 不得低于 `1.5.0`；过低会触发 `Uses Obsidian APIs newer than the declared minAppVersion`。
- 插件依赖配套微信小程序与后端服务，已在 README「使用前依赖」中如实说明。
- 审核会跑自动化检查（manifest 合法性、构建可复现等），确保 `npm run build` 可无错通过。
