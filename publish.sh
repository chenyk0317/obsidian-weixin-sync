#!/usr/bin/env bash
# Weixin Sync 全流程一键发布脚本
# 本脚本位于插件开发目录 weixin-sync-plugin/，开发即发布源，无需额外的发布副本目录。
# 用法：
#   bash publish.sh            # 版本号默认取 manifest.json
#   bash publish.sh 1.0.2      # 传入版本号：先改 manifest.json 的 version，再走全流程
#
# 全流程：构建(npm install + build) → 克隆远程仓库到临时目录 → 拷贝发布文件 → git 提交 → 推送 GitHub → 打 Release
# 兼容首次发布（自动建仓库）与后续迭代（跳过已存在的 Release）。
# 远程仓库固定为 chenyk0317/obsidian-weixin-sync（GitHub 上的仓库名，与本地目录名不同是正常的）。
#
# 前置：本机已安装 gh 且 gh auth login 完成；已安装 Node.js(npm)。
set -uo pipefail

# ---------- 路径 ----------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"   # = weixin-sync-plugin
REPO="chenyk0317/obsidian-weixin-sync"
PUBLISH_TMP="${TMPDIR:-/tmp}/obsidian-weixin-sync-publish"

# ---------- 0. 前置检查 ----------
if ! command -v gh >/dev/null 2>&1; then
  echo "❌ 未检测到 gh，请先执行：brew install gh && gh auth login"
  exit 1
fi
gh auth status >/dev/null 2>&1 || { echo "❌ 请先登录 GitHub：gh auth login"; exit 1; }
if ! command -v npm >/dev/null 2>&1; then
  echo "❌ 未检测到 npm，请先安装 Node.js"
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ 未检测到 python3（用于更新 versions.json），请先安装"
  exit 1
fi

read_version() { grep -oE '"version"[[:space:]]*:[[:space:]]*"[0-9]+\.[0-9]+\.[0-9]+"' "$1" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+'; }

# ---------- 1. 确定版本号 ----------
if [ -n "${1:-}" ]; then
  VERSION="$1"
  if ! echo "${VERSION}" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    echo "❌ 版本号格式错误：应为 X.Y.Z（如 1.0.2）"
    exit 1
  fi
  echo "📦 传入版本：${VERSION} —— 先更新 manifest.json 与 versions.json"
  sed -i.bak -E "s/(\"version\"[[:space:]]*:[[:space:]]*\")[0-9]+\.[0-9]+\.[0-9]+(\")/\1${VERSION}\2/" "$SCRIPT_DIR/manifest.json"
  rm -f "$SCRIPT_DIR/manifest.json.bak"
  for vf in "$SCRIPT_DIR/versions.json"; do
    python3 - "$vf" "${VERSION}" <<'PY'
import json, sys
f, ver = sys.argv[1], sys.argv[2]
d = json.load(open(f, encoding="utf-8"))
if ver not in d:
    last_key = sorted(d)[-1]
    d[ver] = d[last_key]
    json.dump(d, open(f, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"✅ {f} 追加版本 {ver} -> minAppVersion {d[ver]}")
else:
    print(f"ℹ️  {f} 已有版本 {ver}，跳过")
PY
  done
else
  VERSION="$(read_version "$SCRIPT_DIR/manifest.json")"
  if [ -z "${VERSION:-}" ]; then
    echo "❌ 无法从 manifest.json 读取版本号，请传入版本号参数，或检查 manifest.json"
    exit 1
  fi
  echo "📦 版本号取自 manifest.json：${VERSION}"
fi

# ---------- 2. 生产构建 ----------
echo "🔨 构建插件（npm install + npm run build）..."
( cd "$SCRIPT_DIR" && npm install >/dev/null 2>&1; npm run build ) || { echo "❌ 构建失败，已中止"; exit 1; }
echo "✅ 构建完成"

# ---------- 3. 克隆/准备远程仓库到临时目录 ----------
echo "🔁 准备发布工作区（克隆 $REPO 到临时目录）..."
rm -rf "$PUBLISH_TMP"
if ! gh repo clone "$REPO" "$PUBLISH_TMP" 2>/dev/null; then
  echo "⚠️  仓库 $REPO 不存在或克隆失败，尝试创建..."
  gh repo create "$REPO" --public --clone "$PUBLISH_TMP" || { echo "❌ 无法创建仓库，请检查 gh 权限"; exit 1; }
fi
cd "$PUBLISH_TMP" || exit 1

# 清理旧发布文件（保留 .git / .gitignore），避免残留
find "$PUBLISH_TMP" -mindepth 1 -maxdepth 1 ! -name '.git' ! -name '.gitignore' -exec rm -rf {} +

# ---------- 4. 拷贝发布文件 ----------
echo "📋 拷贝发布文件..."
MAIN_JS="$SCRIPT_DIR/weixin-sync-test-vault/.obsidian/plugins/weixin-sync/main.js"
[ -f "$MAIN_JS" ] || { echo "❌ 未找到构建产物 main.js：$MAIN_JS（请确认 npm run build 已生成）"; exit 1; }
cp "$SCRIPT_DIR/manifest.json"        "$PUBLISH_TMP/manifest.json"
cp "$MAIN_JS"                         "$PUBLISH_TMP/main.js"
cp "$SCRIPT_DIR/versions.json"        "$PUBLISH_TMP/versions.json"
cp -r "$SCRIPT_DIR/src"               "$PUBLISH_TMP/src"
for f in LICENSE README.md package.json package-lock.json esbuild.config.mjs tsconfig.json; do
  [ -e "$SCRIPT_DIR/$f" ] && cp "$SCRIPT_DIR/$f" "$PUBLISH_TMP/$f"
done
echo "✅ 拷贝完成（manifest 版本：$(read_version "$PUBLISH_TMP/manifest.json")）"

# ---------- 5. Git 提交 ----------
git add -A
if git diff --cached --quiet; then
  echo "ℹ️  无待提交变更"
else
  git commit -q -m "Release v${VERSION}: Weixin Sync"
  echo "✅ 已提交 v${VERSION}"
fi

# ---------- 6. 推送（失败自动 rebase 重试） ----------
CUR_BRANCH="$(git branch --show-current 2>/dev/null || echo master)"
push_branch() {
  if git push -u origin "$1"; then return 0; fi
  echo "⚠️  普通推送被拒（本地落后于远程），尝试 git pull --rebase 后重试..."
  if git pull --rebase origin "$1" && git push -u origin "$1"; then
    echo "✅ 已 rebase 并重推成功"; return 0
  fi
  echo "⚠️  push 仍失败，请手动处理"; return 1
}
push_branch "$CUR_BRANCH"

# ---------- 7. 打 Release（已存在则跳过） ----------
if gh release view "${VERSION}" >/dev/null 2>&1; then
  echo "ℹ️  Release ${VERSION} 已存在，跳过（如需覆盖请先执行：gh release delete ${VERSION}）"
else
  gh release create "${VERSION}" --title "v${VERSION}" --notes "Weixin Sync v${VERSION}：微信文章暂存后自动同步至本地知识库。" manifest.json main.js versions.json \
    && echo "✅ 已创建 Release ${VERSION}"
fi

# ---------- 8. 清理临时目录 ----------
rm -rf "$PUBLISH_TMP"

# ---------- 9. 社区后台提交指引 ----------
SUBMIT_URL="https://community.obsidian.md"
echo ""
echo "🚀 GitHub 仓库与 Release 已就绪。现在请到 Obsidian 社区目录提交/更新插件："
echo "   1) 打开 ${SUBMIT_URL} 并用你的 Obsidian 账号登录"
echo "   2) 在个人资料里绑定 GitHub 账号：chenyk0317"
echo "   3) 开发者后台 → 你的插件下会出现新版本 ${VERSION}，点击 Review / 重新审核"
echo ""
echo "   插件 ID：weixin-sync"
echo "   仓库：${REPO}（GitHub 仓库名，对应本地开发目录 weixin-sync-plugin）"
echo "   版本：${VERSION}"
echo "   注意：manifest 的 description 不能包含 'Obsidian' 字样（官方自动审核规则）"
echo ""
if command -v open >/dev/null 2>&1; then
  open "${SUBMIT_URL}" >/dev/null 2>&1 && echo "ℹ️  已尝试打开社区目录"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "${SUBMIT_URL}" >/dev/null 2>&1 && echo "ℹ️  已尝试打开社区目录"
fi
echo "🎉 脚本执行完毕"
